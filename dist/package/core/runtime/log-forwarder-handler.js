"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
/**
 * CloudWatch Logs -> Vector/Logtrail forwarder (out-of-band log shipping).
 *
 * App Lambdas only write to stdout (CloudWatch) — nothing runs in their request path. A CloudWatch
 * Logs subscription filter streams batched, gzipped events to this function, which reshapes them to
 * clean Vector JSON records and ships them to the ingest endpoint over a keep-alive connection,
 * gzip-compressed and split into bounded sub-batches.
 *
 * Processing pipeline per event (see `LogForwarderConstruct`):
 *   1. NORMALIZE  — peel AWS Lambda's text prefix, lift fw24 tslog JSON, strip ANSI, shorten host.
 *   2. RECLASSIFY — error-ish lines matching a "benign" pattern → `warn` (`reclassified: "benign"`).
 *   3. DROP       — lines matching a "drop" pattern are removed entirely (saved bandwidth at source).
 *   4. DOWNGRADE  — lines matching a "downgrade" pattern → `debug` (`reclassified: "noise"`).
 * Steps 2–4 are app-owned rule lists (env-injected by the construct), complementary to any global
 * severity/noise handling a shared Vector ingest may also apply.
 *
 * ENV NAMESPACE: this function reads ONLY `FORWARDER_*` env vars — deliberately NOT the `LOGTRAIL_*`
 * keys used by fw24's in-process log transport. That guarantees the forwarder can never collide with,
 * or accidentally activate, fw24's in-process Logtrail machinery.
 *
 * DEPENDENCY-FREE (node built-ins only) so the forwarder bundle stays tiny and cheap.
 */
const node_zlib_1 = require("node:zlib");
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const node_url_1 = require("node:url");
const INGEST_URL = process.env.FORWARDER_INGEST_URL?.trim();
const BASE_SERVICE = process.env.FORWARDER_SERVICE?.trim() || 'unknown';
// Stage/owner label (e.g. `develop`, `prod`, `sandbox-nitin`) so develop/prod/per-developer logs are
// distinguishable — there can be several deployments of one service across envs and developers.
const ENV = process.env.FORWARDER_ENV?.trim() || 'unknown';
// The `service` label is what's promoted to a Loki label (and shown in Logtrail), so fold the env into
// it — `plusfan-trials-develop`, `plusfan-trials-sandbox-nitin`, … — guaranteeing each deployment is
// distinct at a glance. `env` is also emitted as a structured field for querying.
const SERVICE = ENV && ENV !== 'unknown' ? `${BASE_SERVICE}-${ENV}` : BASE_SERVICE;
const X_API_KEY = process.env.FORWARDER_INGEST_X_API_KEY?.trim();
// The fw24 Logtrail/Vector ingest decodes a JSON array into individual events and REJECTS NDJSON (400),
// so `json-array` is the default. Override to `ndjson` only for an ingest configured with newline framing.
const BATCH_FORMAT = (process.env.FORWARDER_BATCH_FORMAT?.trim() || 'json-array');
/** Max uncompressed bytes per POST — bounds request size so a large CloudWatch batch can't 413 the ingest. */
const MAX_BATCH_BYTES = Number(process.env.FORWARDER_MAX_BATCH_BYTES) || 1_000_000;
const POST_TIMEOUT_MS = Number(process.env.FORWARDER_POST_TIMEOUT_MS) || 5000;
const MAX_RETRIES = 1;
// ── App-level noise / severity rules (layers 2–4). Each env var is a JSON array of regex source
//    strings; compiled case-insensitively once, here, at cold start. Empty/malformed → no rules. ──
function compileRules(rawJson) {
    if (!rawJson)
        return [];
    let arr;
    try {
        arr = JSON.parse(rawJson);
    }
    catch {
        return [];
    }
    if (!Array.isArray(arr))
        return [];
    const out = [];
    for (const src of arr) {
        if (typeof src !== 'string' || src.length === 0)
            continue;
        try {
            out.push(new RegExp(src, 'i'));
        }
        catch {
            // A bad pattern must never break the forwarder — skip it.
            // eslint-disable-next-line no-console
            console.warn('[log-forwarder] ignoring invalid noise pattern:', src);
        }
    }
    return out;
}
const BENIGN_RULES = compileRules(process.env.FORWARDER_NOISE_BENIGN);
const DROP_RULES = compileRules(process.env.FORWARDER_NOISE_DROP);
const DOWNGRADE_RULES = compileRules(process.env.FORWARDER_NOISE_DOWNGRADE);
const HAS_NOISE_RULES = BENIGN_RULES.length > 0 || DROP_RULES.length > 0 || DOWNGRADE_RULES.length > 0;
// Levels that count as "error-ish" for the benign downgrade (mirrors the Vector A1 list).
const ERRORISH = new Set(['error', 'err', 'fatal', 'critical', 'crit', 'emerg', 'alert', 'panic']);
function anyMatch(rules, msg) {
    for (const re of rules) {
        if (re.test(msg))
            return true;
    }
    return false;
}
// Reused across warm invocations so we don't pay TCP/TLS setup per batch.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
// Lambda platform lines that are pure noise. REPORT is kept by default (carries duration/memory);
// set FORWARDER_DROP_REPORT=true to drop it too.
const DROP_REPORT = process.env.FORWARDER_DROP_REPORT?.trim() === 'true';
function isPlatformNoise(raw) {
    if (raw.startsWith('START RequestId') || raw.startsWith('END RequestId') || raw.startsWith('INIT_START')) {
        return true;
    }
    if (DROP_REPORT && raw.startsWith('REPORT RequestId')) {
        return true;
    }
    return false;
}
// fw24's tslog colorizes output with ANSI SGR codes (e.g. ESC[32m … ESC[39m) which otherwise ship as
// literal `[32m` noise in Logtrail. Strip all ANSI escape sequences from shipped text.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(s) {
    return s.includes('\x1b') ? s.replace(ANSI_RE, '') : s;
}
function fallbackLevel(raw) {
    if (/\b(?:ERROR|FATAL)\b/.test(raw))
        return 'error';
    if (/\bWARN(?:ING)?\b/.test(raw))
        return 'warn';
    return 'info';
}
const KNOWN_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'warning', 'error', 'fatal']);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
/**
 * AWS Lambda emits text logs as `‹iso›\t‹requestId›\t‹LEVEL›\t‹message›`. Peel that prefix off so the
 * message is just the text, and lift requestId/level out as fields (they're already shown as columns).
 * Returns null if the line isn't in that format.
 */
function parseLambdaPrefix(raw) {
    const parts = raw.split('\t');
    if (parts.length < 4)
        return null;
    const [ts, requestId, lvl, ...rest] = parts;
    if (!ISO_RE.test(ts) || !KNOWN_LEVELS.has(lvl.trim().toLowerCase()))
        return null;
    return { requestId, level: lvl.trim().toLowerCase(), message: rest.join('\t').trim() };
}
/**
 * Turn a verbose CloudWatch log-group / log-stream into a short function name for the `host` label,
 * e.g. `…-plusfantrialsstreamprocessor…LogGroup…` → `plusfantrialsstreamprocessor`. Falls back to the
 * raw log group. The full log group is still emitted separately as `logGroup`.
 */
function shortHost(logGroup, logStream) {
    // Lambda log stream: "YYYY/MM/DD/<functionName>[$LATEST]<id>" — the cleanest source of the fn name.
    const sm = logStream.match(/^\d{4}\/\d{2}\/\d{2}\/(.+?)\[\$LATEST\]/);
    if (sm && sm[1]) {
        return sm[1].replace(/-[A-Za-z0-9]{6,}$/, ''); // drop the CloudFormation random suffix
    }
    // Fallback: parse the log group — strip the `…LogGroup<hash>-<suffix>` tail, take the last segment,
    // and de-duplicate CDK's doubled construct name (`fooBarfooBar` → `fooBar`).
    let s = logGroup;
    const lg = s.indexOf('LogGroup');
    if (lg > 0)
        s = s.slice(0, lg);
    const m = s.match(/(?:stack-|NestedStackResource[0-9A-Fa-f]*-)([^-]+)$/);
    if (m)
        s = m[1];
    if (s.length > 0 && s.length % 2 === 0) {
        const half = s.length / 2;
        if (s.slice(0, half) === s.slice(half))
            s = s.slice(0, half);
    }
    return s || logGroup;
}
/**
 * Reshape one CloudWatch log event into a clean Vector record, then apply the app-level noise/severity
 * rules. Returns `null` when the event should be dropped (platform noise or a "drop" rule match).
 *
 * fw24 logs are tslog JSON like `{"0":"the message","1":{...arg},"_meta":{"name":"APIConstruct",
 * "logLevelName":"INFO","date":"..."}}`. We lift the real message out of the positional keys and the
 * component/level/time out of `_meta`, so Logtrail shows readable lines instead of a raw JSON blob.
 * Non-JSON lines (Lambda START/END/REPORT, plain text) pass through unchanged.
 */
function toVectorRecord(e, logGroup, logStream) {
    const raw = (e.message ?? '').replace(/\s+$/, '');
    // ── 1) DROP: Lambda platform lines that are pure noise. ──
    if (isPlatformNoise(raw.trimStart())) {
        return null;
    }
    let message = raw;
    let level;
    let logger;
    let requestId;
    let tsIso;
    // ── 1) NORMALIZE: peel AWS Lambda's `‹iso›\t‹requestId›\t‹LEVEL›\t‹message›` text prefix, if present.
    const lambda = parseLambdaPrefix(raw);
    if (lambda) {
        requestId = lambda.requestId;
        level = lambda.level;
        message = lambda.message;
    }
    // ── 1) NORMALIZE: if the remaining message is fw24 tslog JSON, lift the real text + component/level/time.
    const body = message;
    if (body.charCodeAt(0) === 0x7b /* { */) {
        try {
            const o = JSON.parse(body);
            const meta = o._meta;
            if (meta && typeof meta === 'object') {
                if (typeof meta.name === 'string')
                    logger = meta.name;
                if (typeof meta.logLevelName === 'string')
                    level = meta.logLevelName.toLowerCase();
                if (typeof meta.date === 'string' && !Number.isNaN(Date.parse(meta.date))) {
                    tsIso = new Date(meta.date).toISOString();
                }
            }
            // Positional args "0".."n" hold the logged message + params.
            const parts = [];
            for (let i = 0; Object.prototype.hasOwnProperty.call(o, String(i)); i++) {
                const v = o[String(i)];
                parts.push(typeof v === 'string' ? v : JSON.stringify(v));
            }
            if (parts.length > 0)
                message = parts.join(' ');
        }
        catch {
            // not JSON after all — keep the (prefix-stripped) message
        }
    }
    const cleanMessage = stripAnsi(message);
    let resolvedLevel = level ?? fallbackLevel(raw);
    let reclassified;
    // ── Layers 2–4: app-level noise / severity rules, applied to the normalized message. ──
    if (HAS_NOISE_RULES) {
        // 2) RECLASSIFY: benign "errors" → warn (only downgrade, never upgrade).
        if (ERRORISH.has(resolvedLevel) && anyMatch(BENIGN_RULES, cleanMessage)) {
            resolvedLevel = 'warn';
            reclassified = 'benign';
        }
        // 3) DROP: noise removed entirely (never shipped — saves ingest bandwidth at the source).
        if (anyMatch(DROP_RULES, cleanMessage)) {
            return null;
        }
        // 4) DOWNGRADE: noise kept but de-emphasised to debug.
        if (anyMatch(DOWNGRADE_RULES, cleanMessage)) {
            resolvedLevel = 'debug';
            reclassified = 'noise';
        }
    }
    return {
        service: SERVICE,
        env: ENV,
        host: shortHost(logGroup, logStream),
        ...(logger ? { logger } : {}),
        ...(requestId ? { requestId } : {}),
        level: resolvedLevel,
        ...(reclassified ? { reclassified } : {}),
        message: cleanMessage,
        timestamp: tsIso ?? new Date(e.timestamp).toISOString(),
        logGroup,
        logStream,
    };
}
/** Split pre-serialized lines into sub-batches under MAX_BATCH_BYTES (uncompressed). */
function chunkLines(lines) {
    const chunks = [];
    let current = [];
    let size = 0;
    for (const line of lines) {
        const lineBytes = Buffer.byteLength(line) + 1; // +1 for the delimiter
        if (current.length > 0 && size + lineBytes > MAX_BATCH_BYTES) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(line);
        size += lineBytes;
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks;
}
function encodeBody(lines) {
    // lines are already JSON strings
    return BATCH_FORMAT === 'json-array' ? `[${lines.join(',')}]` : lines.join('\n');
}
function post(gzipped) {
    return new Promise((resolve, reject) => {
        const url = new node_url_1.URL(INGEST_URL);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const req = lib.request(url, {
            method: 'POST',
            agent: isHttps ? httpsAgent : httpAgent,
            headers: {
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
                'Content-Length': gzipped.length,
                ...(X_API_KEY ? { 'x-api-key': X_API_KEY } : {}),
            },
        }, (res) => {
            res.resume(); // drain so the socket can be reused
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) {
                resolve();
            }
            else {
                reject(new Error(`ingest responded ${status}`));
            }
        });
        req.on('error', reject);
        req.setTimeout(POST_TIMEOUT_MS, () => req.destroy(new Error('ingest timeout')));
        req.end(gzipped);
    });
}
/** POST one chunk with a single retry. Returns false if the chunk was dropped after retries. */
async function shipWithRetry(gzipped) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            await post(gzipped);
            return true;
        }
        catch (err) {
            if (attempt === MAX_RETRIES) {
                // Swallow after retries: a persistent ingest outage must not create a CloudWatch retry storm.
                // eslint-disable-next-line no-console
                console.error('[log-forwarder] ship failed, dropping chunk:', err.message);
                return false;
            }
        }
    }
    return false;
}
/** Emit an alarmable CloudWatch metric (EMF) when records are dropped — no SDK, just structured stdout. */
function emitDroppedMetric(records) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
        _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
                {
                    Namespace: 'LogForwarder',
                    Dimensions: [['service']],
                    Metrics: [{ Name: 'DroppedRecords', Unit: 'Count' }],
                },
            ],
        },
        service: SERVICE,
        DroppedRecords: records,
    }));
}
const handler = async (event) => {
    if (!INGEST_URL) {
        return; // not configured yet — no-op (safe to deploy before wiring the ingest URL)
    }
    let payload;
    try {
        payload = JSON.parse((0, node_zlib_1.gunzipSync)(Buffer.from(event.awslogs.data, 'base64')).toString('utf8'));
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[log-forwarder] failed to decode payload:', err.message);
        return;
    }
    if (payload.messageType === 'CONTROL_MESSAGE') {
        return; // subscription liveness ping
    }
    const events = payload.logEvents;
    if (!Array.isArray(events) || events.length === 0) {
        return;
    }
    const lines = [];
    for (const e of events) {
        const record = toVectorRecord(e, payload.logGroup, payload.logStream);
        if (record !== null) {
            lines.push(JSON.stringify(record));
        }
    }
    if (lines.length === 0) {
        return; // whole batch was noise / dropped
    }
    let dropped = 0;
    for (const chunk of chunkLines(lines)) {
        const gzipped = (0, node_zlib_1.gzipSync)(Buffer.from(encodeBody(chunk)));
        const ok = await shipWithRetry(gzipped);
        if (!ok) {
            dropped += chunk.length;
        }
    }
    if (dropped > 0) {
        emitDroppedMetric(dropped);
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILHlDQUFpRDtBQUNqRCxnREFBa0M7QUFDbEMsa0RBQW9DO0FBQ3BDLHVDQUErQjtBQUUvQixNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixFQUFFLElBQUksRUFBRSxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLElBQUksU0FBUyxDQUFDO0FBQ3hFLHFHQUFxRztBQUNyRyxnR0FBZ0c7QUFDaEcsTUFBTSxHQUFHLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsSUFBSSxFQUFFLElBQUksU0FBUyxDQUFDO0FBQzNELHVHQUF1RztBQUN2RyxxR0FBcUc7QUFDckcsa0ZBQWtGO0FBQ2xGLE1BQU0sT0FBTyxHQUFHLEdBQUcsSUFBSSxHQUFHLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxHQUFHLFlBQVksSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDO0FBQ25GLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDakUsd0dBQXdHO0FBQ3hHLDJHQUEyRztBQUMzRyxNQUFNLFlBQVksR0FBRyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLEVBQUUsSUFBSSxFQUFFLElBQUksWUFBWSxDQUE0QixDQUFDO0FBQzdHLDhHQUE4RztBQUM5RyxNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUMsT0FB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TyxHQUFHLElBQUEsb0JBQVEsRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDekQsTUFBTSxFQUFFLEdBQUcsTUFBTSxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDeEMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ1QsT0FBTyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDekIsQ0FBQztJQUNGLENBQUM7SUFDRCxJQUFJLE9BQU8sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNqQixpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM1QixDQUFDO0FBQ0YsQ0FBQyxDQUFDO0FBM0NXLFFBQUEsT0FBTyxXQTJDbEIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENsb3VkV2F0Y2ggTG9ncyAtPiBWZWN0b3IvTG9ndHJhaWwgZm9yd2FyZGVyIChvdXQtb2YtYmFuZCBsb2cgc2hpcHBpbmcpLlxuICpcbiAqIEFwcCBMYW1iZGFzIG9ubHkgd3JpdGUgdG8gc3Rkb3V0IChDbG91ZFdhdGNoKSDigJQgbm90aGluZyBydW5zIGluIHRoZWlyIHJlcXVlc3QgcGF0aC4gQSBDbG91ZFdhdGNoXG4gKiBMb2dzIHN1YnNjcmlwdGlvbiBmaWx0ZXIgc3RyZWFtcyBiYXRjaGVkLCBnemlwcGVkIGV2ZW50cyB0byB0aGlzIGZ1bmN0aW9uLCB3aGljaCByZXNoYXBlcyB0aGVtIHRvXG4gKiBjbGVhbiBWZWN0b3IgSlNPTiByZWNvcmRzIGFuZCBzaGlwcyB0aGVtIHRvIHRoZSBpbmdlc3QgZW5kcG9pbnQgb3ZlciBhIGtlZXAtYWxpdmUgY29ubmVjdGlvbixcbiAqIGd6aXAtY29tcHJlc3NlZCBhbmQgc3BsaXQgaW50byBib3VuZGVkIHN1Yi1iYXRjaGVzLlxuICpcbiAqIFByb2Nlc3NpbmcgcGlwZWxpbmUgcGVyIGV2ZW50IChzZWUgYExvZ0ZvcndhcmRlckNvbnN0cnVjdGApOlxuICogICAxLiBOT1JNQUxJWkUgIOKAlCBwZWVsIEFXUyBMYW1iZGEncyB0ZXh0IHByZWZpeCwgbGlmdCBmdzI0IHRzbG9nIEpTT04sIHN0cmlwIEFOU0ksIHNob3J0ZW4gaG9zdC5cbiAqICAgMi4gUkVDTEFTU0lGWSDigJQgZXJyb3ItaXNoIGxpbmVzIG1hdGNoaW5nIGEgXCJiZW5pZ25cIiBwYXR0ZXJuIOKGkiBgd2FybmAgKGByZWNsYXNzaWZpZWQ6IFwiYmVuaWduXCJgKS5cbiAqICAgMy4gRFJPUCAgICAgICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRyb3BcIiBwYXR0ZXJuIGFyZSByZW1vdmVkIGVudGlyZWx5IChzYXZlZCBiYW5kd2lkdGggYXQgc291cmNlKS5cbiAqICAgNC4gRE9XTkdSQURFICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRvd25ncmFkZVwiIHBhdHRlcm4g4oaSIGBkZWJ1Z2AgKGByZWNsYXNzaWZpZWQ6IFwibm9pc2VcImApLlxuICogU3RlcHMgMuKAkzQgYXJlIGFwcC1vd25lZCBydWxlIGxpc3RzIChlbnYtaW5qZWN0ZWQgYnkgdGhlIGNvbnN0cnVjdCksIGNvbXBsZW1lbnRhcnkgdG8gYW55IGdsb2JhbFxuICogc2V2ZXJpdHkvbm9pc2UgaGFuZGxpbmcgYSBzaGFyZWQgVmVjdG9yIGluZ2VzdCBtYXkgYWxzbyBhcHBseS5cbiAqXG4gKiBFTlYgTkFNRVNQQUNFOiB0aGlzIGZ1bmN0aW9uIHJlYWRzIE9OTFkgYEZPUldBUkRFUl8qYCBlbnYgdmFycyDigJQgZGVsaWJlcmF0ZWx5IE5PVCB0aGUgYExPR1RSQUlMXypgXG4gKiBrZXlzIHVzZWQgYnkgZncyNCdzIGluLXByb2Nlc3MgbG9nIHRyYW5zcG9ydC4gVGhhdCBndWFyYW50ZWVzIHRoZSBmb3J3YXJkZXIgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCxcbiAqIG9yIGFjY2lkZW50YWxseSBhY3RpdmF0ZSwgZncyNCdzIGluLXByb2Nlc3MgTG9ndHJhaWwgbWFjaGluZXJ5LlxuICpcbiAqIERFUEVOREVOQ1ktRlJFRSAobm9kZSBidWlsdC1pbnMgb25seSkgc28gdGhlIGZvcndhcmRlciBidW5kbGUgc3RheXMgdGlueSBhbmQgY2hlYXAuXG4gKi9cbmltcG9ydCB7IGd1bnppcFN5bmMsIGd6aXBTeW5jIH0gZnJvbSAnbm9kZTp6bGliJztcbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJztcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnO1xuaW1wb3J0IHsgVVJMIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5jb25zdCBJTkdFU1RfVVJMID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9VUkw/LnRyaW0oKTtcbmNvbnN0IEJBU0VfU0VSVklDRSA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9TRVJWSUNFPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gU3RhZ2Uvb3duZXIgbGFiZWwgKGUuZy4gYGRldmVsb3BgLCBgcHJvZGAsIGBzYW5kYm94LW5pdGluYCkgc28gZGV2ZWxvcC9wcm9kL3Blci1kZXZlbG9wZXIgbG9ncyBhcmVcbi8vIGRpc3Rpbmd1aXNoYWJsZSDigJQgdGhlcmUgY2FuIGJlIHNldmVyYWwgZGVwbG95bWVudHMgb2Ygb25lIHNlcnZpY2UgYWNyb3NzIGVudnMgYW5kIGRldmVsb3BlcnMuXG5jb25zdCBFTlYgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfRU5WPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gVGhlIGBzZXJ2aWNlYCBsYWJlbCBpcyB3aGF0J3MgcHJvbW90ZWQgdG8gYSBMb2tpIGxhYmVsIChhbmQgc2hvd24gaW4gTG9ndHJhaWwpLCBzbyBmb2xkIHRoZSBlbnYgaW50b1xuLy8gaXQg4oCUIGBwbHVzZmFuLXRyaWFscy1kZXZlbG9wYCwgYHBsdXNmYW4tdHJpYWxzLXNhbmRib3gtbml0aW5gLCDigKYg4oCUIGd1YXJhbnRlZWluZyBlYWNoIGRlcGxveW1lbnQgaXNcbi8vIGRpc3RpbmN0IGF0IGEgZ2xhbmNlLiBgZW52YCBpcyBhbHNvIGVtaXR0ZWQgYXMgYSBzdHJ1Y3R1cmVkIGZpZWxkIGZvciBxdWVyeWluZy5cbmNvbnN0IFNFUlZJQ0UgPSBFTlYgJiYgRU5WICE9PSAndW5rbm93bicgPyBgJHtCQVNFX1NFUlZJQ0V9LSR7RU5WfWAgOiBCQVNFX1NFUlZJQ0U7XG5jb25zdCBYX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWT8udHJpbSgpO1xuLy8gVGhlIGZ3MjQgTG9ndHJhaWwvVmVjdG9yIGluZ2VzdCBkZWNvZGVzIGEgSlNPTiBhcnJheSBpbnRvIGluZGl2aWR1YWwgZXZlbnRzIGFuZCBSRUpFQ1RTIE5ESlNPTiAoNDAwKSxcbi8vIHNvIGBqc29uLWFycmF5YCBpcyB0aGUgZGVmYXVsdC4gT3ZlcnJpZGUgdG8gYG5kanNvbmAgb25seSBmb3IgYW4gaW5nZXN0IGNvbmZpZ3VyZWQgd2l0aCBuZXdsaW5lIGZyYW1pbmcuXG5jb25zdCBCQVRDSF9GT1JNQVQgPSAocHJvY2Vzcy5lbnYuRk9SV0FSREVSX0JBVENIX0ZPUk1BVD8udHJpbSgpIHx8ICdqc29uLWFycmF5JykgYXMgJ25kanNvbicgfCAnanNvbi1hcnJheSc7XG4vKiogTWF4IHVuY29tcHJlc3NlZCBieXRlcyBwZXIgUE9TVCDigJQgYm91bmRzIHJlcXVlc3Qgc2l6ZSBzbyBhIGxhcmdlIENsb3VkV2F0Y2ggYmF0Y2ggY2FuJ3QgNDEzIHRoZSBpbmdlc3QuICovXG5jb25zdCBNQVhfQkFUQ0hfQllURVMgPSBOdW1iZXIocHJvY2Vzcy5lbnYuRk9SV0FSREVSX01BWF9CQVRDSF9CWVRFUykgfHwgMV8wMDBfMDAwO1xuY29uc3QgUE9TVF9USU1FT1VUX01TID0gTnVtYmVyKHByb2Nlc3MuZW52LkZPUldBUkRFUl9QT1NUX1RJTUVPVVRfTVMpIHx8IDUwMDA7XG5jb25zdCBNQVhfUkVUUklFUyA9IDE7XG5cbi8vIOKUgOKUgCBBcHAtbGV2ZWwgbm9pc2UgLyBzZXZlcml0eSBydWxlcyAobGF5ZXJzIDLigJM0KS4gRWFjaCBlbnYgdmFyIGlzIGEgSlNPTiBhcnJheSBvZiByZWdleCBzb3VyY2Vcbi8vICAgIHN0cmluZ3M7IGNvbXBpbGVkIGNhc2UtaW5zZW5zaXRpdmVseSBvbmNlLCBoZXJlLCBhdCBjb2xkIHN0YXJ0LiBFbXB0eS9tYWxmb3JtZWQg4oaSIG5vIHJ1bGVzLiDilIDilIBcbmZ1bmN0aW9uIGNvbXBpbGVSdWxlcyhyYXdKc29uOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBSZWdFeHBbXSB7XG5cdGlmICghcmF3SnNvbikgcmV0dXJuIFtdO1xuXHRsZXQgYXJyOiB1bmtub3duO1xuXHR0cnkge1xuXHRcdGFyciA9IEpTT04ucGFyc2UocmF3SnNvbik7XG5cdH0gY2F0Y2gge1xuXHRcdHJldHVybiBbXTtcblx0fVxuXHRpZiAoIUFycmF5LmlzQXJyYXkoYXJyKSkgcmV0dXJuIFtdO1xuXHRjb25zdCBvdXQ6IFJlZ0V4cFtdID0gW107XG5cdGZvciAoY29uc3Qgc3JjIG9mIGFycikge1xuXHRcdGlmICh0eXBlb2Ygc3JjICE9PSAnc3RyaW5nJyB8fCBzcmMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblx0XHR0cnkge1xuXHRcdFx0b3V0LnB1c2gobmV3IFJlZ0V4cChzcmMsICdpJykpO1xuXHRcdH0gY2F0Y2gge1xuXHRcdFx0Ly8gQSBiYWQgcGF0dGVybiBtdXN0IG5ldmVyIGJyZWFrIHRoZSBmb3J3YXJkZXIg4oCUIHNraXAgaXQuXG5cdFx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdFx0Y29uc29sZS53YXJuKCdbbG9nLWZvcndhcmRlcl0gaWdub3JpbmcgaW52YWxpZCBub2lzZSBwYXR0ZXJuOicsIHNyYyk7XG5cdFx0fVxuXHR9XG5cdHJldHVybiBvdXQ7XG59XG5cbmNvbnN0IEJFTklHTl9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfQkVOSUdOKTtcbmNvbnN0IERST1BfUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0RST1ApO1xuY29uc3QgRE9XTkdSQURFX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9ET1dOR1JBREUpO1xuY29uc3QgSEFTX05PSVNFX1JVTEVTID0gQkVOSUdOX1JVTEVTLmxlbmd0aCA+IDAgfHwgRFJPUF9SVUxFUy5sZW5ndGggPiAwIHx8IERPV05HUkFERV9SVUxFUy5sZW5ndGggPiAwO1xuXG4vLyBMZXZlbHMgdGhhdCBjb3VudCBhcyBcImVycm9yLWlzaFwiIGZvciB0aGUgYmVuaWduIGRvd25ncmFkZSAobWlycm9ycyB0aGUgVmVjdG9yIEExIGxpc3QpLlxuY29uc3QgRVJST1JJU0ggPSBuZXcgU2V0KFsgJ2Vycm9yJywgJ2VycicsICdmYXRhbCcsICdjcml0aWNhbCcsICdjcml0JywgJ2VtZXJnJywgJ2FsZXJ0JywgJ3BhbmljJyBdKTtcbmZ1bmN0aW9uIGFueU1hdGNoKHJ1bGVzOiBSZWdFeHBbXSwgbXNnOiBzdHJpbmcpOiBib29sZWFuIHtcblx0Zm9yIChjb25zdCByZSBvZiBydWxlcykge1xuXHRcdGlmIChyZS50ZXN0KG1zZykpIHJldHVybiB0cnVlO1xuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLy8gUmV1c2VkIGFjcm9zcyB3YXJtIGludm9jYXRpb25zIHNvIHdlIGRvbid0IHBheSBUQ1AvVExTIHNldHVwIHBlciBiYXRjaC5cbmNvbnN0IGh0dHBBZ2VudCA9IG5ldyBodHRwLkFnZW50KHsga2VlcEFsaXZlOiB0cnVlLCBtYXhTb2NrZXRzOiAxNiB9KTtcbmNvbnN0IGh0dHBzQWdlbnQgPSBuZXcgaHR0cHMuQWdlbnQoeyBrZWVwQWxpdmU6IHRydWUsIG1heFNvY2tldHM6IDE2IH0pO1xuXG5pbnRlcmZhY2UgQ2xvdWRXYXRjaExvZ3NFdmVudCB7XG5cdGF3c2xvZ3M6IHsgZGF0YTogc3RyaW5nIH07XG59XG5cbmludGVyZmFjZSBEZWNvZGVkUGF5bG9hZCB7XG5cdG1lc3NhZ2VUeXBlOiBzdHJpbmc7XG5cdGxvZ0dyb3VwOiBzdHJpbmc7XG5cdGxvZ1N0cmVhbTogc3RyaW5nO1xuXHRsb2dFdmVudHM6IEFycmF5PHsgaWQ6IHN0cmluZzsgdGltZXN0YW1wOiBudW1iZXI7IG1lc3NhZ2U6IHN0cmluZyB9Pjtcbn1cblxuLy8gTGFtYmRhIHBsYXRmb3JtIGxpbmVzIHRoYXQgYXJlIHB1cmUgbm9pc2UuIFJFUE9SVCBpcyBrZXB0IGJ5IGRlZmF1bHQgKGNhcnJpZXMgZHVyYXRpb24vbWVtb3J5KTtcbi8vIHNldCBGT1JXQVJERVJfRFJPUF9SRVBPUlQ9dHJ1ZSB0byBkcm9wIGl0IHRvby5cbmNvbnN0IERST1BfUkVQT1JUID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0RST1BfUkVQT1JUPy50cmltKCkgPT09ICd0cnVlJztcbmZ1bmN0aW9uIGlzUGxhdGZvcm1Ob2lzZShyYXc6IHN0cmluZyk6IGJvb2xlYW4ge1xuXHRpZiAocmF3LnN0YXJ0c1dpdGgoJ1NUQVJUIFJlcXVlc3RJZCcpIHx8IHJhdy5zdGFydHNXaXRoKCdFTkQgUmVxdWVzdElkJykgfHwgcmF3LnN0YXJ0c1dpdGgoJ0lOSVRfU1RBUlQnKSkge1xuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cdGlmIChEUk9QX1JFUE9SVCAmJiByYXcuc3RhcnRzV2l0aCgnUkVQT1JUIFJlcXVlc3RJZCcpKSB7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vLyBmdzI0J3MgdHNsb2cgY29sb3JpemVzIG91dHB1dCB3aXRoIEFOU0kgU0dSIGNvZGVzIChlLmcuIEVTQ1szMm0g4oCmIEVTQ1szOW0pIHdoaWNoIG90aGVyd2lzZSBzaGlwIGFzXG4vLyBsaXRlcmFsIGBbMzJtYCBub2lzZSBpbiBMb2d0cmFpbC4gU3RyaXAgYWxsIEFOU0kgZXNjYXBlIHNlcXVlbmNlcyBmcm9tIHNoaXBwZWQgdGV4dC5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb250cm9sLXJlZ2V4XG5jb25zdCBBTlNJX1JFID0gL1xceDFiXFxbWzAtOTtdKltBLVphLXpdL2c7XG5mdW5jdGlvbiBzdHJpcEFuc2koczogc3RyaW5nKTogc3RyaW5nIHtcblx0cmV0dXJuIHMuaW5jbHVkZXMoJ1xceDFiJykgPyBzLnJlcGxhY2UoQU5TSV9SRSwgJycpIDogcztcbn1cblxuZnVuY3Rpb24gZmFsbGJhY2tMZXZlbChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG5cdGlmICgvXFxiKD86RVJST1J8RkFUQUwpXFxiLy50ZXN0KHJhdykpIHJldHVybiAnZXJyb3InO1xuXHRpZiAoL1xcYldBUk4oPzpJTkcpP1xcYi8udGVzdChyYXcpKSByZXR1cm4gJ3dhcm4nO1xuXHRyZXR1cm4gJ2luZm8nO1xufVxuXG5jb25zdCBLTk9XTl9MRVZFTFMgPSBuZXcgU2V0KFsgJ3RyYWNlJywgJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICd3YXJuaW5nJywgJ2Vycm9yJywgJ2ZhdGFsJyBdKTtcbmNvbnN0IElTT19SRSA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn0vO1xuXG4vKipcbiAqIEFXUyBMYW1iZGEgZW1pdHMgdGV4dCBsb2dzIGFzIGDigLlpc2/igLpcXHTigLlyZXF1ZXN0SWTigLpcXHTigLlMRVZFTOKAulxcdOKAuW1lc3NhZ2XigLpgLiBQZWVsIHRoYXQgcHJlZml4IG9mZiBzbyB0aGVcbiAqIG1lc3NhZ2UgaXMganVzdCB0aGUgdGV4dCwgYW5kIGxpZnQgcmVxdWVzdElkL2xldmVsIG91dCBhcyBmaWVsZHMgKHRoZXkncmUgYWxyZWFkeSBzaG93biBhcyBjb2x1bW5zKS5cbiAqIFJldHVybnMgbnVsbCBpZiB0aGUgbGluZSBpc24ndCBpbiB0aGF0IGZvcm1hdC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VMYW1iZGFQcmVmaXgocmF3OiBzdHJpbmcpOiB7IHJlcXVlc3RJZDogc3RyaW5nOyBsZXZlbDogc3RyaW5nOyBtZXNzYWdlOiBzdHJpbmcgfSB8IG51bGwge1xuXHRjb25zdCBwYXJ0cyA9IHJhdy5zcGxpdCgnXFx0Jyk7XG5cdGlmIChwYXJ0cy5sZW5ndGggPCA0KSByZXR1cm4gbnVsbDtcblx0Y29uc3QgWyB0cywgcmVxdWVzdElkLCBsdmwsIC4uLnJlc3QgXSA9IHBhcnRzO1xuXHRpZiAoIUlTT19SRS50ZXN0KHRzKSB8fCAhS05PV05fTEVWRUxTLmhhcyhsdmwudHJpbSgpLnRvTG93ZXJDYXNlKCkpKSByZXR1cm4gbnVsbDtcblx0cmV0dXJuIHsgcmVxdWVzdElkLCBsZXZlbDogbHZsLnRyaW0oKS50b0xvd2VyQ2FzZSgpLCBtZXNzYWdlOiByZXN0LmpvaW4oJ1xcdCcpLnRyaW0oKSB9O1xufVxuXG4vKipcbiAqIFR1cm4gYSB2ZXJib3NlIENsb3VkV2F0Y2ggbG9nLWdyb3VwIC8gbG9nLXN0cmVhbSBpbnRvIGEgc2hvcnQgZnVuY3Rpb24gbmFtZSBmb3IgdGhlIGBob3N0YCBsYWJlbCxcbiAqIGUuZy4gYOKApi1wbHVzZmFudHJpYWxzc3RyZWFtcHJvY2Vzc29y4oCmTG9nR3JvdXDigKZgIOKGkiBgcGx1c2ZhbnRyaWFsc3N0cmVhbXByb2Nlc3NvcmAuIEZhbGxzIGJhY2sgdG8gdGhlXG4gKiByYXcgbG9nIGdyb3VwLiBUaGUgZnVsbCBsb2cgZ3JvdXAgaXMgc3RpbGwgZW1pdHRlZCBzZXBhcmF0ZWx5IGFzIGBsb2dHcm91cGAuXG4gKi9cbmZ1bmN0aW9uIHNob3J0SG9zdChsb2dHcm91cDogc3RyaW5nLCBsb2dTdHJlYW06IHN0cmluZyk6IHN0cmluZyB7XG5cdC8vIExhbWJkYSBsb2cgc3RyZWFtOiBcIllZWVkvTU0vREQvPGZ1bmN0aW9uTmFtZT5bJExBVEVTVF08aWQ+XCIg4oCUIHRoZSBjbGVhbmVzdCBzb3VyY2Ugb2YgdGhlIGZuIG5hbWUuXG5cdGNvbnN0IHNtID0gbG9nU3RyZWFtLm1hdGNoKC9eXFxkezR9XFwvXFxkezJ9XFwvXFxkezJ9XFwvKC4rPylcXFtcXCRMQVRFU1RcXF0vKTtcblx0aWYgKHNtICYmIHNtWzFdKSB7XG5cdFx0cmV0dXJuIHNtWzFdLnJlcGxhY2UoLy1bQS1aYS16MC05XXs2LH0kLywgJycpOyAvLyBkcm9wIHRoZSBDbG91ZEZvcm1hdGlvbiByYW5kb20gc3VmZml4XG5cdH1cblx0Ly8gRmFsbGJhY2s6IHBhcnNlIHRoZSBsb2cgZ3JvdXAg4oCUIHN0cmlwIHRoZSBg4oCmTG9nR3JvdXA8aGFzaD4tPHN1ZmZpeD5gIHRhaWwsIHRha2UgdGhlIGxhc3Qgc2VnbWVudCxcblx0Ly8gYW5kIGRlLWR1cGxpY2F0ZSBDREsncyBkb3VibGVkIGNvbnN0cnVjdCBuYW1lIChgZm9vQmFyZm9vQmFyYCDihpIgYGZvb0JhcmApLlxuXHRsZXQgcyA9IGxvZ0dyb3VwO1xuXHRjb25zdCBsZyA9IHMuaW5kZXhPZignTG9nR3JvdXAnKTtcblx0aWYgKGxnID4gMCkgcyA9IHMuc2xpY2UoMCwgbGcpO1xuXHRjb25zdCBtID0gcy5tYXRjaCgvKD86c3RhY2stfE5lc3RlZFN0YWNrUmVzb3VyY2VbMC05QS1GYS1mXSotKShbXi1dKykkLyk7XG5cdGlmIChtKSBzID0gbVsxXTtcblx0aWYgKHMubGVuZ3RoID4gMCAmJiBzLmxlbmd0aCAlIDIgPT09IDApIHtcblx0XHRjb25zdCBoYWxmID0gcy5sZW5ndGggLyAyO1xuXHRcdGlmIChzLnNsaWNlKDAsIGhhbGYpID09PSBzLnNsaWNlKGhhbGYpKSBzID0gcy5zbGljZSgwLCBoYWxmKTtcblx0fVxuXHRyZXR1cm4gcyB8fCBsb2dHcm91cDtcbn1cblxuLyoqXG4gKiBSZXNoYXBlIG9uZSBDbG91ZFdhdGNoIGxvZyBldmVudCBpbnRvIGEgY2xlYW4gVmVjdG9yIHJlY29yZCwgdGhlbiBhcHBseSB0aGUgYXBwLWxldmVsIG5vaXNlL3NldmVyaXR5XG4gKiBydWxlcy4gUmV0dXJucyBgbnVsbGAgd2hlbiB0aGUgZXZlbnQgc2hvdWxkIGJlIGRyb3BwZWQgKHBsYXRmb3JtIG5vaXNlIG9yIGEgXCJkcm9wXCIgcnVsZSBtYXRjaCkuXG4gKlxuICogZncyNCBsb2dzIGFyZSB0c2xvZyBKU09OIGxpa2UgYHtcIjBcIjpcInRoZSBtZXNzYWdlXCIsXCIxXCI6ey4uLmFyZ30sXCJfbWV0YVwiOntcIm5hbWVcIjpcIkFQSUNvbnN0cnVjdFwiLFxuICogXCJsb2dMZXZlbE5hbWVcIjpcIklORk9cIixcImRhdGVcIjpcIi4uLlwifX1gLiBXZSBsaWZ0IHRoZSByZWFsIG1lc3NhZ2Ugb3V0IG9mIHRoZSBwb3NpdGlvbmFsIGtleXMgYW5kIHRoZVxuICogY29tcG9uZW50L2xldmVsL3RpbWUgb3V0IG9mIGBfbWV0YWAsIHNvIExvZ3RyYWlsIHNob3dzIHJlYWRhYmxlIGxpbmVzIGluc3RlYWQgb2YgYSByYXcgSlNPTiBibG9iLlxuICogTm9uLUpTT04gbGluZXMgKExhbWJkYSBTVEFSVC9FTkQvUkVQT1JULCBwbGFpbiB0ZXh0KSBwYXNzIHRocm91Z2ggdW5jaGFuZ2VkLlxuICovXG5mdW5jdGlvbiB0b1ZlY3RvclJlY29yZChcblx0ZTogeyB0aW1lc3RhbXA6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0sXG5cdGxvZ0dyb3VwOiBzdHJpbmcsXG5cdGxvZ1N0cmVhbTogc3RyaW5nLFxuKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsIHtcblx0Y29uc3QgcmF3ID0gKGUubWVzc2FnZSA/PyAnJykucmVwbGFjZSgvXFxzKyQvLCAnJyk7XG5cblx0Ly8g4pSA4pSAIDEpIERST1A6IExhbWJkYSBwbGF0Zm9ybSBsaW5lcyB0aGF0IGFyZSBwdXJlIG5vaXNlLiDilIDilIBcblx0aWYgKGlzUGxhdGZvcm1Ob2lzZShyYXcudHJpbVN0YXJ0KCkpKSB7XG5cdFx0cmV0dXJuIG51bGw7XG5cdH1cblxuXHRsZXQgbWVzc2FnZSA9IHJhdztcblx0bGV0IGxldmVsOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBsb2dnZXI6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IHJlcXVlc3RJZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgdHNJc286IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuXHQvLyDilIDilIAgMSkgTk9STUFMSVpFOiBwZWVsIEFXUyBMYW1iZGEncyBg4oC5aXNv4oC6XFx04oC5cmVxdWVzdElk4oC6XFx04oC5TEVWRUzigLpcXHTigLltZXNzYWdl4oC6YCB0ZXh0IHByZWZpeCwgaWYgcHJlc2VudC5cblx0Y29uc3QgbGFtYmRhID0gcGFyc2VMYW1iZGFQcmVmaXgocmF3KTtcblx0aWYgKGxhbWJkYSkge1xuXHRcdHJlcXVlc3RJZCA9IGxhbWJkYS5yZXF1ZXN0SWQ7XG5cdFx0bGV2ZWwgPSBsYW1iZGEubGV2ZWw7XG5cdFx0bWVzc2FnZSA9IGxhbWJkYS5tZXNzYWdlO1xuXHR9XG5cblx0Ly8g4pSA4pSAIDEpIE5PUk1BTElaRTogaWYgdGhlIHJlbWFpbmluZyBtZXNzYWdlIGlzIGZ3MjQgdHNsb2cgSlNPTiwgbGlmdCB0aGUgcmVhbCB0ZXh0ICsgY29tcG9uZW50L2xldmVsL3RpbWUuXG5cdGNvbnN0IGJvZHkgPSBtZXNzYWdlO1xuXHRpZiAoYm9keS5jaGFyQ29kZUF0KDApID09PSAweDdiIC8qIHsgKi8pIHtcblx0XHR0cnkge1xuXHRcdFx0Y29uc3QgbyA9IEpTT04ucGFyc2UoYm9keSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cdFx0XHRjb25zdCBtZXRhID0gby5fbWV0YSBhcyB7IG5hbWU/OiB1bmtub3duOyBsb2dMZXZlbE5hbWU/OiB1bmtub3duOyBkYXRlPzogdW5rbm93biB9IHwgdW5kZWZpbmVkO1xuXHRcdFx0aWYgKG1ldGEgJiYgdHlwZW9mIG1ldGEgPT09ICdvYmplY3QnKSB7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5uYW1lID09PSAnc3RyaW5nJykgbG9nZ2VyID0gbWV0YS5uYW1lO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEubG9nTGV2ZWxOYW1lID09PSAnc3RyaW5nJykgbGV2ZWwgPSBtZXRhLmxvZ0xldmVsTmFtZS50b0xvd2VyQ2FzZSgpO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuZGF0ZSA9PT0gJ3N0cmluZycgJiYgIU51bWJlci5pc05hTihEYXRlLnBhcnNlKG1ldGEuZGF0ZSkpKSB7XG5cdFx0XHRcdFx0dHNJc28gPSBuZXcgRGF0ZShtZXRhLmRhdGUpLnRvSVNPU3RyaW5nKCk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdC8vIFBvc2l0aW9uYWwgYXJncyBcIjBcIi4uXCJuXCIgaG9sZCB0aGUgbG9nZ2VkIG1lc3NhZ2UgKyBwYXJhbXMuXG5cdFx0XHRjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcblx0XHRcdGZvciAobGV0IGkgPSAwOyBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgU3RyaW5nKGkpKTsgaSsrKSB7XG5cdFx0XHRcdGNvbnN0IHYgPSBvW1N0cmluZyhpKV07XG5cdFx0XHRcdHBhcnRzLnB1c2godHlwZW9mIHYgPT09ICdzdHJpbmcnID8gdiA6IEpTT04uc3RyaW5naWZ5KHYpKTtcblx0XHRcdH1cblx0XHRcdGlmIChwYXJ0cy5sZW5ndGggPiAwKSBtZXNzYWdlID0gcGFydHMuam9pbignICcpO1xuXHRcdH0gY2F0Y2gge1xuXHRcdFx0Ly8gbm90IEpTT04gYWZ0ZXIgYWxsIOKAlCBrZWVwIHRoZSAocHJlZml4LXN0cmlwcGVkKSBtZXNzYWdlXG5cdFx0fVxuXHR9XG5cblx0Y29uc3QgY2xlYW5NZXNzYWdlID0gc3RyaXBBbnNpKG1lc3NhZ2UpO1xuXHRsZXQgcmVzb2x2ZWRMZXZlbCA9IGxldmVsID8/IGZhbGxiYWNrTGV2ZWwocmF3KTtcblx0bGV0IHJlY2xhc3NpZmllZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG5cdC8vIOKUgOKUgCBMYXllcnMgMuKAkzQ6IGFwcC1sZXZlbCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzLCBhcHBsaWVkIHRvIHRoZSBub3JtYWxpemVkIG1lc3NhZ2UuIOKUgOKUgFxuXHRpZiAoSEFTX05PSVNFX1JVTEVTKSB7XG5cdFx0Ly8gMikgUkVDTEFTU0lGWTogYmVuaWduIFwiZXJyb3JzXCIg4oaSIHdhcm4gKG9ubHkgZG93bmdyYWRlLCBuZXZlciB1cGdyYWRlKS5cblx0XHRpZiAoRVJST1JJU0guaGFzKHJlc29sdmVkTGV2ZWwpICYmIGFueU1hdGNoKEJFTklHTl9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmVzb2x2ZWRMZXZlbCA9ICd3YXJuJztcblx0XHRcdHJlY2xhc3NpZmllZCA9ICdiZW5pZ24nO1xuXHRcdH1cblx0XHQvLyAzKSBEUk9QOiBub2lzZSByZW1vdmVkIGVudGlyZWx5IChuZXZlciBzaGlwcGVkIOKAlCBzYXZlcyBpbmdlc3QgYmFuZHdpZHRoIGF0IHRoZSBzb3VyY2UpLlxuXHRcdGlmIChhbnlNYXRjaChEUk9QX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXR1cm4gbnVsbDtcblx0XHR9XG5cdFx0Ly8gNCkgRE9XTkdSQURFOiBub2lzZSBrZXB0IGJ1dCBkZS1lbXBoYXNpc2VkIHRvIGRlYnVnLlxuXHRcdGlmIChhbnlNYXRjaChET1dOR1JBREVfUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJlc29sdmVkTGV2ZWwgPSAnZGVidWcnO1xuXHRcdFx0cmVjbGFzc2lmaWVkID0gJ25vaXNlJztcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHNlcnZpY2U6IFNFUlZJQ0UsXG5cdFx0ZW52OiBFTlYsXG5cdFx0aG9zdDogc2hvcnRIb3N0KGxvZ0dyb3VwLCBsb2dTdHJlYW0pLFxuXHRcdC4uLihsb2dnZXIgPyB7IGxvZ2dlciB9IDoge30pLFxuXHRcdC4uLihyZXF1ZXN0SWQgPyB7IHJlcXVlc3RJZCB9IDoge30pLFxuXHRcdGxldmVsOiByZXNvbHZlZExldmVsLFxuXHRcdC4uLihyZWNsYXNzaWZpZWQgPyB7IHJlY2xhc3NpZmllZCB9IDoge30pLFxuXHRcdG1lc3NhZ2U6IGNsZWFuTWVzc2FnZSxcblx0XHR0aW1lc3RhbXA6IHRzSXNvID8/IG5ldyBEYXRlKGUudGltZXN0YW1wKS50b0lTT1N0cmluZygpLFxuXHRcdGxvZ0dyb3VwLFxuXHRcdGxvZ1N0cmVhbSxcblx0fTtcbn1cblxuLyoqIFNwbGl0IHByZS1zZXJpYWxpemVkIGxpbmVzIGludG8gc3ViLWJhdGNoZXMgdW5kZXIgTUFYX0JBVENIX0JZVEVTICh1bmNvbXByZXNzZWQpLiAqL1xuZnVuY3Rpb24gY2h1bmtMaW5lcyhsaW5lczogc3RyaW5nW10pOiBzdHJpbmdbXVtdIHtcblx0Y29uc3QgY2h1bmtzOiBzdHJpbmdbXVtdID0gW107XG5cdGxldCBjdXJyZW50OiBzdHJpbmdbXSA9IFtdO1xuXHRsZXQgc2l6ZSA9IDA7XG5cdGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuXHRcdGNvbnN0IGxpbmVCeXRlcyA9IEJ1ZmZlci5ieXRlTGVuZ3RoKGxpbmUpICsgMTsgLy8gKzEgZm9yIHRoZSBkZWxpbWl0ZXJcblx0XHRpZiAoY3VycmVudC5sZW5ndGggPiAwICYmIHNpemUgKyBsaW5lQnl0ZXMgPiBNQVhfQkFUQ0hfQllURVMpIHtcblx0XHRcdGNodW5rcy5wdXNoKGN1cnJlbnQpO1xuXHRcdFx0Y3VycmVudCA9IFtdO1xuXHRcdFx0c2l6ZSA9IDA7XG5cdFx0fVxuXHRcdGN1cnJlbnQucHVzaChsaW5lKTtcblx0XHRzaXplICs9IGxpbmVCeXRlcztcblx0fVxuXHRpZiAoY3VycmVudC5sZW5ndGggPiAwKSB7XG5cdFx0Y2h1bmtzLnB1c2goY3VycmVudCk7XG5cdH1cblx0cmV0dXJuIGNodW5rcztcbn1cblxuZnVuY3Rpb24gZW5jb2RlQm9keShsaW5lczogc3RyaW5nW10pOiBzdHJpbmcge1xuXHQvLyBsaW5lcyBhcmUgYWxyZWFkeSBKU09OIHN0cmluZ3Ncblx0cmV0dXJuIEJBVENIX0ZPUk1BVCA9PT0gJ2pzb24tYXJyYXknID8gYFske2xpbmVzLmpvaW4oJywnKX1dYCA6IGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG5mdW5jdGlvbiBwb3N0KGd6aXBwZWQ6IEJ1ZmZlcik6IFByb21pc2U8dm9pZD4ge1xuXHRyZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuXHRcdGNvbnN0IHVybCA9IG5ldyBVUkwoSU5HRVNUX1VSTCEpO1xuXHRcdGNvbnN0IGlzSHR0cHMgPSB1cmwucHJvdG9jb2wgPT09ICdodHRwczonO1xuXHRcdGNvbnN0IGxpYiA9IGlzSHR0cHMgPyBodHRwcyA6IGh0dHA7XG5cdFx0Y29uc3QgcmVxID0gbGliLnJlcXVlc3QoXG5cdFx0XHR1cmwsXG5cdFx0XHR7XG5cdFx0XHRcdG1ldGhvZDogJ1BPU1QnLFxuXHRcdFx0XHRhZ2VudDogaXNIdHRwcyA/IGh0dHBzQWdlbnQgOiBodHRwQWdlbnQsXG5cdFx0XHRcdGhlYWRlcnM6IHtcblx0XHRcdFx0XHQnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuXHRcdFx0XHRcdCdDb250ZW50LUVuY29kaW5nJzogJ2d6aXAnLFxuXHRcdFx0XHRcdCdDb250ZW50LUxlbmd0aCc6IGd6aXBwZWQubGVuZ3RoLFxuXHRcdFx0XHRcdC4uLihYX0FQSV9LRVkgPyB7ICd4LWFwaS1rZXknOiBYX0FQSV9LRVkgfSA6IHt9KSxcblx0XHRcdFx0fSxcblx0XHRcdH0sXG5cdFx0XHQocmVzKSA9PiB7XG5cdFx0XHRcdHJlcy5yZXN1bWUoKTsgLy8gZHJhaW4gc28gdGhlIHNvY2tldCBjYW4gYmUgcmV1c2VkXG5cdFx0XHRcdGNvbnN0IHN0YXR1cyA9IHJlcy5zdGF0dXNDb2RlID8/IDA7XG5cdFx0XHRcdGlmIChzdGF0dXMgPj0gMjAwICYmIHN0YXR1cyA8IDMwMCkge1xuXHRcdFx0XHRcdHJlc29sdmUoKTtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRyZWplY3QobmV3IEVycm9yKGBpbmdlc3QgcmVzcG9uZGVkICR7c3RhdHVzfWApKTtcblx0XHRcdFx0fVxuXHRcdFx0fSxcblx0XHQpO1xuXHRcdHJlcS5vbignZXJyb3InLCByZWplY3QpO1xuXHRcdHJlcS5zZXRUaW1lb3V0KFBPU1RfVElNRU9VVF9NUywgKCkgPT4gcmVxLmRlc3Ryb3kobmV3IEVycm9yKCdpbmdlc3QgdGltZW91dCcpKSk7XG5cdFx0cmVxLmVuZChnemlwcGVkKTtcblx0fSk7XG59XG5cbi8qKiBQT1NUIG9uZSBjaHVuayB3aXRoIGEgc2luZ2xlIHJldHJ5LiBSZXR1cm5zIGZhbHNlIGlmIHRoZSBjaHVuayB3YXMgZHJvcHBlZCBhZnRlciByZXRyaWVzLiAqL1xuYXN5bmMgZnVuY3Rpb24gc2hpcFdpdGhSZXRyeShnemlwcGVkOiBCdWZmZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcblx0Zm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPD0gTUFYX1JFVFJJRVM7IGF0dGVtcHQrKykge1xuXHRcdHRyeSB7XG5cdFx0XHRhd2FpdCBwb3N0KGd6aXBwZWQpO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHRpZiAoYXR0ZW1wdCA9PT0gTUFYX1JFVFJJRVMpIHtcblx0XHRcdFx0Ly8gU3dhbGxvdyBhZnRlciByZXRyaWVzOiBhIHBlcnNpc3RlbnQgaW5nZXN0IG91dGFnZSBtdXN0IG5vdCBjcmVhdGUgYSBDbG91ZFdhdGNoIHJldHJ5IHN0b3JtLlxuXHRcdFx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdFx0XHRjb25zb2xlLmVycm9yKCdbbG9nLWZvcndhcmRlcl0gc2hpcCBmYWlsZWQsIGRyb3BwaW5nIGNodW5rOicsIChlcnIgYXMgRXJyb3IpLm1lc3NhZ2UpO1xuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLyoqIEVtaXQgYW4gYWxhcm1hYmxlIENsb3VkV2F0Y2ggbWV0cmljIChFTUYpIHdoZW4gcmVjb3JkcyBhcmUgZHJvcHBlZCDigJQgbm8gU0RLLCBqdXN0IHN0cnVjdHVyZWQgc3Rkb3V0LiAqL1xuZnVuY3Rpb24gZW1pdERyb3BwZWRNZXRyaWMocmVjb3JkczogbnVtYmVyKTogdm9pZCB7XG5cdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdGNvbnNvbGUubG9nKFxuXHRcdEpTT04uc3RyaW5naWZ5KHtcblx0XHRcdF9hd3M6IHtcblx0XHRcdFx0VGltZXN0YW1wOiBEYXRlLm5vdygpLFxuXHRcdFx0XHRDbG91ZFdhdGNoTWV0cmljczogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdE5hbWVzcGFjZTogJ0xvZ0ZvcndhcmRlcicsXG5cdFx0XHRcdFx0XHREaW1lbnNpb25zOiBbIFsgJ3NlcnZpY2UnIF0gXSxcblx0XHRcdFx0XHRcdE1ldHJpY3M6IFsgeyBOYW1lOiAnRHJvcHBlZFJlY29yZHMnLCBVbml0OiAnQ291bnQnIH0gXSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRdLFxuXHRcdFx0fSxcblx0XHRcdHNlcnZpY2U6IFNFUlZJQ0UsXG5cdFx0XHREcm9wcGVkUmVjb3JkczogcmVjb3Jkcyxcblx0XHR9KSxcblx0KTtcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IENsb3VkV2F0Y2hMb2dzRXZlbnQpOiBQcm9taXNlPHZvaWQ+ID0+IHtcblx0aWYgKCFJTkdFU1RfVVJMKSB7XG5cdFx0cmV0dXJuOyAvLyBub3QgY29uZmlndXJlZCB5ZXQg4oCUIG5vLW9wIChzYWZlIHRvIGRlcGxveSBiZWZvcmUgd2lyaW5nIHRoZSBpbmdlc3QgVVJMKVxuXHR9XG5cblx0bGV0IHBheWxvYWQ6IERlY29kZWRQYXlsb2FkO1xuXHR0cnkge1xuXHRcdHBheWxvYWQgPSBKU09OLnBhcnNlKGd1bnppcFN5bmMoQnVmZmVyLmZyb20oZXZlbnQuYXdzbG9ncy5kYXRhLCAnYmFzZTY0JykpLnRvU3RyaW5nKCd1dGY4JykpIGFzIERlY29kZWRQYXlsb2FkO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBmYWlsZWQgdG8gZGVjb2RlIHBheWxvYWQ6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0aWYgKHBheWxvYWQubWVzc2FnZVR5cGUgPT09ICdDT05UUk9MX01FU1NBR0UnKSB7XG5cdFx0cmV0dXJuOyAvLyBzdWJzY3JpcHRpb24gbGl2ZW5lc3MgcGluZ1xuXHR9XG5cdGNvbnN0IGV2ZW50cyA9IHBheWxvYWQubG9nRXZlbnRzO1xuXHRpZiAoIUFycmF5LmlzQXJyYXkoZXZlbnRzKSB8fCBldmVudHMubGVuZ3RoID09PSAwKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG5cdGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcblx0XHRjb25zdCByZWNvcmQgPSB0b1ZlY3RvclJlY29yZChlLCBwYXlsb2FkLmxvZ0dyb3VwLCBwYXlsb2FkLmxvZ1N0cmVhbSk7XG5cdFx0aWYgKHJlY29yZCAhPT0gbnVsbCkge1xuXHRcdFx0bGluZXMucHVzaChKU09OLnN0cmluZ2lmeShyZWNvcmQpKTtcblx0XHR9XG5cdH1cblx0aWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkge1xuXHRcdHJldHVybjsgLy8gd2hvbGUgYmF0Y2ggd2FzIG5vaXNlIC8gZHJvcHBlZFxuXHR9XG5cdGxldCBkcm9wcGVkID0gMDtcblx0Zm9yIChjb25zdCBjaHVuayBvZiBjaHVua0xpbmVzKGxpbmVzKSkge1xuXHRcdGNvbnN0IGd6aXBwZWQgPSBnemlwU3luYyhCdWZmZXIuZnJvbShlbmNvZGVCb2R5KGNodW5rKSkpO1xuXHRcdGNvbnN0IG9rID0gYXdhaXQgc2hpcFdpdGhSZXRyeShnemlwcGVkKTtcblx0XHRpZiAoIW9rKSB7XG5cdFx0XHRkcm9wcGVkICs9IGNodW5rLmxlbmd0aDtcblx0XHR9XG5cdH1cblx0aWYgKGRyb3BwZWQgPiAwKSB7XG5cdFx0ZW1pdERyb3BwZWRNZXRyaWMoZHJvcHBlZCk7XG5cdH1cbn07XG4iXX0=