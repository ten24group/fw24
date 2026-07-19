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
 * Every record also carries `account` + `region` (from the forwarder's own ARN) so deployments that
 * share app + env names — e.g. multiple developers each running `plusfan-trials` (APP_ENVIRONMENT=local)
 * in their OWN account — stay distinguishable instead of colliding under one `service` label.
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
// AWS account + region disambiguate deployments that share app + env names — e.g. several developers
// each deploying the SAME app (`plusfan-trials`, APP_ENVIRONMENT=local) to their OWN account. Without
// this, all their logs would collide under one `service` label. Region is set by the Lambda runtime;
// account is parsed from the invoked function ARN on the first invocation and cached.
const REGION = process.env.AWS_REGION?.trim() || '';
let RESOLVED_ACCOUNT = '';
function accountFromArn(arn) {
    // arn:aws:lambda:<region>:<ACCOUNT>:function:<name>
    const parts = (arn || '').split(':');
    return parts.length > 4 ? parts[4] : '';
}
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
    let correlationId;
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
                if (typeof meta.correlationId === 'string' && meta.correlationId.trim())
                    correlationId = meta.correlationId.trim();
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
        ...(RESOLVED_ACCOUNT ? { account: RESOLVED_ACCOUNT } : {}),
        ...(REGION ? { region: REGION } : {}),
        host: shortHost(logGroup, logStream),
        ...(logger ? { logger } : {}),
        ...(requestId ? { requestId } : {}),
        ...(correlationId ? { correlationId } : {}),
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
const handler = async (event, context) => {
    // Resolve the account from this forwarder's own ARN once (same for every invocation).
    if (!RESOLVED_ACCOUNT && context?.invokedFunctionArn) {
        RESOLVED_ACCOUNT = accountFromArn(context.invokedFunctionArn);
    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F5Qkc7QUFDSCx5Q0FBaUQ7QUFDakQsZ0RBQWtDO0FBQ2xDLGtEQUFvQztBQUNwQyx1Q0FBK0I7QUFFL0IsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUM1RCxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLElBQUksRUFBRSxJQUFJLFNBQVMsQ0FBQztBQUN4RSxxR0FBcUc7QUFDckcsZ0dBQWdHO0FBQ2hHLE1BQU0sR0FBRyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxJQUFJLFNBQVMsQ0FBQztBQUMzRCx1R0FBdUc7QUFDdkcscUdBQXFHO0FBQ3JHLGtGQUFrRjtBQUNsRixNQUFNLE9BQU8sR0FBRyxHQUFHLElBQUksR0FBRyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxZQUFZLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQztBQUNuRixNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixFQUFFLElBQUksRUFBRSxDQUFDO0FBRWpFLHFHQUFxRztBQUNyRyxzR0FBc0c7QUFDdEcscUdBQXFHO0FBQ3JHLHNGQUFzRjtBQUN0RixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDcEQsSUFBSSxnQkFBZ0IsR0FBRyxFQUFFLENB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QUFLLENBQUMsRUFBRSxDQUFDO1FBQ3ZDLE1BQU0sT0FBTyxHQUFHLElBQUEsb0JBQVEsRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDekQsTUFBTSxFQUFFLEdBQUcsTUFBTSxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDeEMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ1QsT0FBTyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDekIsQ0FBQztJQUNGLENBQUM7SUFDRCxJQUFJLE9BQU8sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNqQixpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM1QixDQUFDO0FBQ0YsQ0FBQyxDQUFDO0FBL0NXLFFBQUEsT0FBTyxXQStDbEIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENsb3VkV2F0Y2ggTG9ncyAtPiBWZWN0b3IvTG9ndHJhaWwgZm9yd2FyZGVyIChvdXQtb2YtYmFuZCBsb2cgc2hpcHBpbmcpLlxuICpcbiAqIEFwcCBMYW1iZGFzIG9ubHkgd3JpdGUgdG8gc3Rkb3V0IChDbG91ZFdhdGNoKSDigJQgbm90aGluZyBydW5zIGluIHRoZWlyIHJlcXVlc3QgcGF0aC4gQSBDbG91ZFdhdGNoXG4gKiBMb2dzIHN1YnNjcmlwdGlvbiBmaWx0ZXIgc3RyZWFtcyBiYXRjaGVkLCBnemlwcGVkIGV2ZW50cyB0byB0aGlzIGZ1bmN0aW9uLCB3aGljaCByZXNoYXBlcyB0aGVtIHRvXG4gKiBjbGVhbiBWZWN0b3IgSlNPTiByZWNvcmRzIGFuZCBzaGlwcyB0aGVtIHRvIHRoZSBpbmdlc3QgZW5kcG9pbnQgb3ZlciBhIGtlZXAtYWxpdmUgY29ubmVjdGlvbixcbiAqIGd6aXAtY29tcHJlc3NlZCBhbmQgc3BsaXQgaW50byBib3VuZGVkIHN1Yi1iYXRjaGVzLlxuICpcbiAqIFByb2Nlc3NpbmcgcGlwZWxpbmUgcGVyIGV2ZW50IChzZWUgYExvZ0ZvcndhcmRlckNvbnN0cnVjdGApOlxuICogICAxLiBOT1JNQUxJWkUgIOKAlCBwZWVsIEFXUyBMYW1iZGEncyB0ZXh0IHByZWZpeCwgbGlmdCBmdzI0IHRzbG9nIEpTT04sIHN0cmlwIEFOU0ksIHNob3J0ZW4gaG9zdC5cbiAqICAgMi4gUkVDTEFTU0lGWSDigJQgZXJyb3ItaXNoIGxpbmVzIG1hdGNoaW5nIGEgXCJiZW5pZ25cIiBwYXR0ZXJuIOKGkiBgd2FybmAgKGByZWNsYXNzaWZpZWQ6IFwiYmVuaWduXCJgKS5cbiAqICAgMy4gRFJPUCAgICAgICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRyb3BcIiBwYXR0ZXJuIGFyZSByZW1vdmVkIGVudGlyZWx5IChzYXZlZCBiYW5kd2lkdGggYXQgc291cmNlKS5cbiAqICAgNC4gRE9XTkdSQURFICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRvd25ncmFkZVwiIHBhdHRlcm4g4oaSIGBkZWJ1Z2AgKGByZWNsYXNzaWZpZWQ6IFwibm9pc2VcImApLlxuICogU3RlcHMgMuKAkzQgYXJlIGFwcC1vd25lZCBydWxlIGxpc3RzIChlbnYtaW5qZWN0ZWQgYnkgdGhlIGNvbnN0cnVjdCksIGNvbXBsZW1lbnRhcnkgdG8gYW55IGdsb2JhbFxuICogc2V2ZXJpdHkvbm9pc2UgaGFuZGxpbmcgYSBzaGFyZWQgVmVjdG9yIGluZ2VzdCBtYXkgYWxzbyBhcHBseS5cbiAqXG4gKiBFdmVyeSByZWNvcmQgYWxzbyBjYXJyaWVzIGBhY2NvdW50YCArIGByZWdpb25gIChmcm9tIHRoZSBmb3J3YXJkZXIncyBvd24gQVJOKSBzbyBkZXBsb3ltZW50cyB0aGF0XG4gKiBzaGFyZSBhcHAgKyBlbnYgbmFtZXMg4oCUIGUuZy4gbXVsdGlwbGUgZGV2ZWxvcGVycyBlYWNoIHJ1bm5pbmcgYHBsdXNmYW4tdHJpYWxzYCAoQVBQX0VOVklST05NRU5UPWxvY2FsKVxuICogaW4gdGhlaXIgT1dOIGFjY291bnQg4oCUIHN0YXkgZGlzdGluZ3Vpc2hhYmxlIGluc3RlYWQgb2YgY29sbGlkaW5nIHVuZGVyIG9uZSBgc2VydmljZWAgbGFiZWwuXG4gKlxuICogRU5WIE5BTUVTUEFDRTogdGhpcyBmdW5jdGlvbiByZWFkcyBPTkxZIGBGT1JXQVJERVJfKmAgZW52IHZhcnMg4oCUIGRlbGliZXJhdGVseSBOT1QgdGhlIGBMT0dUUkFJTF8qYFxuICoga2V5cyB1c2VkIGJ5IGZ3MjQncyBpbi1wcm9jZXNzIGxvZyB0cmFuc3BvcnQuIFRoYXQgZ3VhcmFudGVlcyB0aGUgZm9yd2FyZGVyIGNhbiBuZXZlciBjb2xsaWRlIHdpdGgsXG4gKiBvciBhY2NpZGVudGFsbHkgYWN0aXZhdGUsIGZ3MjQncyBpbi1wcm9jZXNzIExvZ3RyYWlsIG1hY2hpbmVyeS5cbiAqXG4gKiBERVBFTkRFTkNZLUZSRUUgKG5vZGUgYnVpbHQtaW5zIG9ubHkpIHNvIHRoZSBmb3J3YXJkZXIgYnVuZGxlIHN0YXlzIHRpbnkgYW5kIGNoZWFwLlxuICovXG5pbXBvcnQgeyBndW56aXBTeW5jLCBnemlwU3luYyB9IGZyb20gJ25vZGU6emxpYic7XG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCc7XG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdub2RlOmh0dHBzJztcbmltcG9ydCB7IFVSTCB9IGZyb20gJ25vZGU6dXJsJztcblxuY29uc3QgSU5HRVNUX1VSTCA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfVVJMPy50cmltKCk7XG5jb25zdCBCQVNFX1NFUlZJQ0UgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfU0VSVklDRT8udHJpbSgpIHx8ICd1bmtub3duJztcbi8vIFN0YWdlL293bmVyIGxhYmVsIChlLmcuIGBkZXZlbG9wYCwgYHByb2RgLCBgc2FuZGJveC1uaXRpbmApIHNvIGRldmVsb3AvcHJvZC9wZXItZGV2ZWxvcGVyIGxvZ3MgYXJlXG4vLyBkaXN0aW5ndWlzaGFibGUg4oCUIHRoZXJlIGNhbiBiZSBzZXZlcmFsIGRlcGxveW1lbnRzIG9mIG9uZSBzZXJ2aWNlIGFjcm9zcyBlbnZzIGFuZCBkZXZlbG9wZXJzLlxuY29uc3QgRU5WID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0VOVj8udHJpbSgpIHx8ICd1bmtub3duJztcbi8vIFRoZSBgc2VydmljZWAgbGFiZWwgaXMgd2hhdCdzIHByb21vdGVkIHRvIGEgTG9raSBsYWJlbCAoYW5kIHNob3duIGluIExvZ3RyYWlsKSwgc28gZm9sZCB0aGUgZW52IGludG9cbi8vIGl0IOKAlCBgcGx1c2Zhbi10cmlhbHMtZGV2ZWxvcGAsIGBwbHVzZmFuLXRyaWFscy1zYW5kYm94LW5pdGluYCwg4oCmIOKAlCBndWFyYW50ZWVpbmcgZWFjaCBkZXBsb3ltZW50IGlzXG4vLyBkaXN0aW5jdCBhdCBhIGdsYW5jZS4gYGVudmAgaXMgYWxzbyBlbWl0dGVkIGFzIGEgc3RydWN0dXJlZCBmaWVsZCBmb3IgcXVlcnlpbmcuXG5jb25zdCBTRVJWSUNFID0gRU5WICYmIEVOViAhPT0gJ3Vua25vd24nID8gYCR7QkFTRV9TRVJWSUNFfS0ke0VOVn1gIDogQkFTRV9TRVJWSUNFO1xuY29uc3QgWF9BUElfS0VZID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk/LnRyaW0oKTtcblxuLy8gQVdTIGFjY291bnQgKyByZWdpb24gZGlzYW1iaWd1YXRlIGRlcGxveW1lbnRzIHRoYXQgc2hhcmUgYXBwICsgZW52IG5hbWVzIOKAlCBlLmcuIHNldmVyYWwgZGV2ZWxvcGVyc1xuLy8gZWFjaCBkZXBsb3lpbmcgdGhlIFNBTUUgYXBwIChgcGx1c2Zhbi10cmlhbHNgLCBBUFBfRU5WSVJPTk1FTlQ9bG9jYWwpIHRvIHRoZWlyIE9XTiBhY2NvdW50LiBXaXRob3V0XG4vLyB0aGlzLCBhbGwgdGhlaXIgbG9ncyB3b3VsZCBjb2xsaWRlIHVuZGVyIG9uZSBgc2VydmljZWAgbGFiZWwuIFJlZ2lvbiBpcyBzZXQgYnkgdGhlIExhbWJkYSBydW50aW1lO1xuLy8gYWNjb3VudCBpcyBwYXJzZWQgZnJvbSB0aGUgaW52b2tlZCBmdW5jdGlvbiBBUk4gb24gdGhlIGZpcnN0IGludm9jYXRpb24gYW5kIGNhY2hlZC5cbmNvbnN0IFJFR0lPTiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04/LnRyaW0oKSB8fCAnJztcbmxldCBSRVNPTFZFRF9BQ0NPVU5UID0gJyc7XG5mdW5jdGlvbiBhY2NvdW50RnJvbUFybihhcm46IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG5cdC8vIGFybjphd3M6bGFtYmRhOjxyZWdpb24+OjxBQ0NPVU5UPjpmdW5jdGlvbjo8bmFtZT5cblx0Y29uc3QgcGFydHMgPSAoYXJuIHx8ICcnKS5zcGxpdCgnOicpO1xuXHRyZXR1cm4gcGFydHMubGVuZ3RoID4gNCA/IHBhcnRzWzRdIDogJyc7XG59XG4vLyBUaGUgZncyNCBMb2d0cmFpbC9WZWN0b3IgaW5nZXN0IGRlY29kZXMgYSBKU09OIGFycmF5IGludG8gaW5kaXZpZHVhbCBldmVudHMgYW5kIFJFSkVDVFMgTkRKU09OICg0MDApLFxuLy8gc28gYGpzb24tYXJyYXlgIGlzIHRoZSBkZWZhdWx0LiBPdmVycmlkZSB0byBgbmRqc29uYCBvbmx5IGZvciBhbiBpbmdlc3QgY29uZmlndXJlZCB3aXRoIG5ld2xpbmUgZnJhbWluZy5cbmNvbnN0IEJBVENIX0ZPUk1BVCA9IChwcm9jZXNzLmVudi5GT1JXQVJERVJfQkFUQ0hfRk9STUFUPy50cmltKCkgfHwgJ2pzb24tYXJyYXknKSBhcyAnbmRqc29uJyB8ICdqc29uLWFycmF5Jztcbi8qKiBNYXggdW5jb21wcmVzc2VkIGJ5dGVzIHBlciBQT1NUIOKAlCBib3VuZHMgcmVxdWVzdCBzaXplIHNvIGEgbGFyZ2UgQ2xvdWRXYXRjaCBiYXRjaCBjYW4ndCA0MTMgdGhlIGluZ2VzdC4gKi9cbmNvbnN0IE1BWF9CQVRDSF9CWVRFUyA9IE51bWJlcihwcm9jZXNzLmVudi5GT1JXQVJERVJfTUFYX0JBVENIX0JZVEVTKSB8fCAxXzAwMF8wMDA7XG5jb25zdCBQT1NUX1RJTUVPVVRfTVMgPSBOdW1iZXIocHJvY2Vzcy5lbnYuRk9SV0FSREVSX1BPU1RfVElNRU9VVF9NUykgfHwgNTAwMDtcbmNvbnN0IE1BWF9SRVRSSUVTID0gMTtcblxuLy8g4pSA4pSAIEFwcC1sZXZlbCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzIChsYXllcnMgMuKAkzQpLiBFYWNoIGVudiB2YXIgaXMgYSBKU09OIGFycmF5IG9mIHJlZ2V4IHNvdXJjZVxuLy8gICAgc3RyaW5nczsgY29tcGlsZWQgY2FzZS1pbnNlbnNpdGl2ZWx5IG9uY2UsIGhlcmUsIGF0IGNvbGQgc3RhcnQuIEVtcHR5L21hbGZvcm1lZCDihpIgbm8gcnVsZXMuIOKUgOKUgFxuZnVuY3Rpb24gY29tcGlsZVJ1bGVzKHJhd0pzb246IHN0cmluZyB8IHVuZGVmaW5lZCk6IFJlZ0V4cFtdIHtcblx0aWYgKCFyYXdKc29uKSByZXR1cm4gW107XG5cdGxldCBhcnI6IHVua25vd247XG5cdHRyeSB7XG5cdFx0YXJyID0gSlNPTi5wYXJzZShyYXdKc29uKTtcblx0fSBjYXRjaCB7XG5cdFx0cmV0dXJuIFtdO1xuXHR9XG5cdGlmICghQXJyYXkuaXNBcnJheShhcnIpKSByZXR1cm4gW107XG5cdGNvbnN0IG91dDogUmVnRXhwW10gPSBbXTtcblx0Zm9yIChjb25zdCBzcmMgb2YgYXJyKSB7XG5cdFx0aWYgKHR5cGVvZiBzcmMgIT09ICdzdHJpbmcnIHx8IHNyYy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuXHRcdHRyeSB7XG5cdFx0XHRvdXQucHVzaChuZXcgUmVnRXhwKHNyYywgJ2knKSk7XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyBBIGJhZCBwYXR0ZXJuIG11c3QgbmV2ZXIgYnJlYWsgdGhlIGZvcndhcmRlciDigJQgc2tpcCBpdC5cblx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRjb25zb2xlLndhcm4oJ1tsb2ctZm9yd2FyZGVyXSBpZ25vcmluZyBpbnZhbGlkIG5vaXNlIHBhdHRlcm46Jywgc3JjKTtcblx0XHR9XG5cdH1cblx0cmV0dXJuIG91dDtcbn1cblxuY29uc3QgQkVOSUdOX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9CRU5JR04pO1xuY29uc3QgRFJPUF9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfRFJPUCk7XG5jb25zdCBET1dOR1JBREVfUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0RPV05HUkFERSk7XG5jb25zdCBIQVNfTk9JU0VfUlVMRVMgPSBCRU5JR05fUlVMRVMubGVuZ3RoID4gMCB8fCBEUk9QX1JVTEVTLmxlbmd0aCA+IDAgfHwgRE9XTkdSQURFX1JVTEVTLmxlbmd0aCA+IDA7XG5cbi8vIExldmVscyB0aGF0IGNvdW50IGFzIFwiZXJyb3ItaXNoXCIgZm9yIHRoZSBiZW5pZ24gZG93bmdyYWRlIChtaXJyb3JzIHRoZSBWZWN0b3IgQTEgbGlzdCkuXG5jb25zdCBFUlJPUklTSCA9IG5ldyBTZXQoWyAnZXJyb3InLCAnZXJyJywgJ2ZhdGFsJywgJ2NyaXRpY2FsJywgJ2NyaXQnLCAnZW1lcmcnLCAnYWxlcnQnLCAncGFuaWMnIF0pO1xuZnVuY3Rpb24gYW55TWF0Y2gocnVsZXM6IFJlZ0V4cFtdLCBtc2c6IHN0cmluZyk6IGJvb2xlYW4ge1xuXHRmb3IgKGNvbnN0IHJlIG9mIHJ1bGVzKSB7XG5cdFx0aWYgKHJlLnRlc3QobXNnKSkgcmV0dXJuIHRydWU7XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vLyBSZXVzZWQgYWNyb3NzIHdhcm0gaW52b2NhdGlvbnMgc28gd2UgZG9uJ3QgcGF5IFRDUC9UTFMgc2V0dXAgcGVyIGJhdGNoLlxuY29uc3QgaHR0cEFnZW50ID0gbmV3IGh0dHAuQWdlbnQoeyBrZWVwQWxpdmU6IHRydWUsIG1heFNvY2tldHM6IDE2IH0pO1xuY29uc3QgaHR0cHNBZ2VudCA9IG5ldyBodHRwcy5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSwgbWF4U29ja2V0czogMTYgfSk7XG5cbmludGVyZmFjZSBDbG91ZFdhdGNoTG9nc0V2ZW50IHtcblx0YXdzbG9nczogeyBkYXRhOiBzdHJpbmcgfTtcbn1cblxuaW50ZXJmYWNlIERlY29kZWRQYXlsb2FkIHtcblx0bWVzc2FnZVR5cGU6IHN0cmluZztcblx0bG9nR3JvdXA6IHN0cmluZztcblx0bG9nU3RyZWFtOiBzdHJpbmc7XG5cdGxvZ0V2ZW50czogQXJyYXk8eyBpZDogc3RyaW5nOyB0aW1lc3RhbXA6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0+O1xufVxuXG4vLyBMYW1iZGEgcGxhdGZvcm0gbGluZXMgdGhhdCBhcmUgcHVyZSBub2lzZS4gUkVQT1JUIGlzIGtlcHQgYnkgZGVmYXVsdCAoY2FycmllcyBkdXJhdGlvbi9tZW1vcnkpO1xuLy8gc2V0IEZPUldBUkRFUl9EUk9QX1JFUE9SVD10cnVlIHRvIGRyb3AgaXQgdG9vLlxuY29uc3QgRFJPUF9SRVBPUlQgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfRFJPUF9SRVBPUlQ/LnRyaW0oKSA9PT0gJ3RydWUnO1xuZnVuY3Rpb24gaXNQbGF0Zm9ybU5vaXNlKHJhdzogc3RyaW5nKTogYm9vbGVhbiB7XG5cdGlmIChyYXcuc3RhcnRzV2l0aCgnU1RBUlQgUmVxdWVzdElkJykgfHwgcmF3LnN0YXJ0c1dpdGgoJ0VORCBSZXF1ZXN0SWQnKSB8fCByYXcuc3RhcnRzV2l0aCgnSU5JVF9TVEFSVCcpKSB7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblx0aWYgKERST1BfUkVQT1JUICYmIHJhdy5zdGFydHNXaXRoKCdSRVBPUlQgUmVxdWVzdElkJykpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8vIGZ3MjQncyB0c2xvZyBjb2xvcml6ZXMgb3V0cHV0IHdpdGggQU5TSSBTR1IgY29kZXMgKGUuZy4gRVNDWzMybSDigKYgRVNDWzM5bSkgd2hpY2ggb3RoZXJ3aXNlIHNoaXAgYXNcbi8vIGxpdGVyYWwgYFszMm1gIG5vaXNlIGluIExvZ3RyYWlsLiBTdHJpcCBhbGwgQU5TSSBlc2NhcGUgc2VxdWVuY2VzIGZyb20gc2hpcHBlZCB0ZXh0LlxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnRyb2wtcmVnZXhcbmNvbnN0IEFOU0lfUkUgPSAvXFx4MWJcXFtbMC05O10qW0EtWmEtel0vZztcbmZ1bmN0aW9uIHN0cmlwQW5zaShzOiBzdHJpbmcpOiBzdHJpbmcge1xuXHRyZXR1cm4gcy5pbmNsdWRlcygnXFx4MWInKSA/IHMucmVwbGFjZShBTlNJX1JFLCAnJykgOiBzO1xufVxuXG5mdW5jdGlvbiBmYWxsYmFja0xldmVsKHJhdzogc3RyaW5nKTogc3RyaW5nIHtcblx0aWYgKC9cXGIoPzpFUlJPUnxGQVRBTClcXGIvLnRlc3QocmF3KSkgcmV0dXJuICdlcnJvcic7XG5cdGlmICgvXFxiV0FSTig/OklORyk/XFxiLy50ZXN0KHJhdykpIHJldHVybiAnd2Fybic7XG5cdHJldHVybiAnaW5mbyc7XG59XG5cbmNvbnN0IEtOT1dOX0xFVkVMUyA9IG5ldyBTZXQoWyAndHJhY2UnLCAnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ3dhcm5pbmcnLCAnZXJyb3InLCAnZmF0YWwnIF0pO1xuY29uc3QgSVNPX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfS87XG5cbi8qKlxuICogQVdTIExhbWJkYSBlbWl0cyB0ZXh0IGxvZ3MgYXMgYOKAuWlzb+KAulxcdOKAuXJlcXVlc3RJZOKAulxcdOKAuUxFVkVM4oC6XFx04oC5bWVzc2FnZeKAumAuIFBlZWwgdGhhdCBwcmVmaXggb2ZmIHNvIHRoZVxuICogbWVzc2FnZSBpcyBqdXN0IHRoZSB0ZXh0LCBhbmQgbGlmdCByZXF1ZXN0SWQvbGV2ZWwgb3V0IGFzIGZpZWxkcyAodGhleSdyZSBhbHJlYWR5IHNob3duIGFzIGNvbHVtbnMpLlxuICogUmV0dXJucyBudWxsIGlmIHRoZSBsaW5lIGlzbid0IGluIHRoYXQgZm9ybWF0LlxuICovXG5mdW5jdGlvbiBwYXJzZUxhbWJkYVByZWZpeChyYXc6IHN0cmluZyk6IHsgcmVxdWVzdElkOiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IG1lc3NhZ2U6IHN0cmluZyB9IHwgbnVsbCB7XG5cdGNvbnN0IHBhcnRzID0gcmF3LnNwbGl0KCdcXHQnKTtcblx0aWYgKHBhcnRzLmxlbmd0aCA8IDQpIHJldHVybiBudWxsO1xuXHRjb25zdCBbIHRzLCByZXF1ZXN0SWQsIGx2bCwgLi4ucmVzdCBdID0gcGFydHM7XG5cdGlmICghSVNPX1JFLnRlc3QodHMpIHx8ICFLTk9XTl9MRVZFTFMuaGFzKGx2bC50cmltKCkudG9Mb3dlckNhc2UoKSkpIHJldHVybiBudWxsO1xuXHRyZXR1cm4geyByZXF1ZXN0SWQsIGxldmVsOiBsdmwudHJpbSgpLnRvTG93ZXJDYXNlKCksIG1lc3NhZ2U6IHJlc3Quam9pbignXFx0JykudHJpbSgpIH07XG59XG5cbi8qKlxuICogVHVybiBhIHZlcmJvc2UgQ2xvdWRXYXRjaCBsb2ctZ3JvdXAgLyBsb2ctc3RyZWFtIGludG8gYSBzaG9ydCBmdW5jdGlvbiBuYW1lIGZvciB0aGUgYGhvc3RgIGxhYmVsLFxuICogZS5nLiBg4oCmLXBsdXNmYW50cmlhbHNzdHJlYW1wcm9jZXNzb3LigKZMb2dHcm91cOKApmAg4oaSIGBwbHVzZmFudHJpYWxzc3RyZWFtcHJvY2Vzc29yYC4gRmFsbHMgYmFjayB0byB0aGVcbiAqIHJhdyBsb2cgZ3JvdXAuIFRoZSBmdWxsIGxvZyBncm91cCBpcyBzdGlsbCBlbWl0dGVkIHNlcGFyYXRlbHkgYXMgYGxvZ0dyb3VwYC5cbiAqL1xuZnVuY3Rpb24gc2hvcnRIb3N0KGxvZ0dyb3VwOiBzdHJpbmcsIGxvZ1N0cmVhbTogc3RyaW5nKTogc3RyaW5nIHtcblx0Ly8gTGFtYmRhIGxvZyBzdHJlYW06IFwiWVlZWS9NTS9ERC88ZnVuY3Rpb25OYW1lPlskTEFURVNUXTxpZD5cIiDigJQgdGhlIGNsZWFuZXN0IHNvdXJjZSBvZiB0aGUgZm4gbmFtZS5cblx0Y29uc3Qgc20gPSBsb2dTdHJlYW0ubWF0Y2goL15cXGR7NH1cXC9cXGR7Mn1cXC9cXGR7Mn1cXC8oLis/KVxcW1xcJExBVEVTVFxcXS8pO1xuXHRpZiAoc20gJiYgc21bMV0pIHtcblx0XHRyZXR1cm4gc21bMV0ucmVwbGFjZSgvLVtBLVphLXowLTldezYsfSQvLCAnJyk7IC8vIGRyb3AgdGhlIENsb3VkRm9ybWF0aW9uIHJhbmRvbSBzdWZmaXhcblx0fVxuXHQvLyBGYWxsYmFjazogcGFyc2UgdGhlIGxvZyBncm91cCDigJQgc3RyaXAgdGhlIGDigKZMb2dHcm91cDxoYXNoPi08c3VmZml4PmAgdGFpbCwgdGFrZSB0aGUgbGFzdCBzZWdtZW50LFxuXHQvLyBhbmQgZGUtZHVwbGljYXRlIENESydzIGRvdWJsZWQgY29uc3RydWN0IG5hbWUgKGBmb29CYXJmb29CYXJgIOKGkiBgZm9vQmFyYCkuXG5cdGxldCBzID0gbG9nR3JvdXA7XG5cdGNvbnN0IGxnID0gcy5pbmRleE9mKCdMb2dHcm91cCcpO1xuXHRpZiAobGcgPiAwKSBzID0gcy5zbGljZSgwLCBsZyk7XG5cdGNvbnN0IG0gPSBzLm1hdGNoKC8oPzpzdGFjay18TmVzdGVkU3RhY2tSZXNvdXJjZVswLTlBLUZhLWZdKi0pKFteLV0rKSQvKTtcblx0aWYgKG0pIHMgPSBtWzFdO1xuXHRpZiAocy5sZW5ndGggPiAwICYmIHMubGVuZ3RoICUgMiA9PT0gMCkge1xuXHRcdGNvbnN0IGhhbGYgPSBzLmxlbmd0aCAvIDI7XG5cdFx0aWYgKHMuc2xpY2UoMCwgaGFsZikgPT09IHMuc2xpY2UoaGFsZikpIHMgPSBzLnNsaWNlKDAsIGhhbGYpO1xuXHR9XG5cdHJldHVybiBzIHx8IGxvZ0dyb3VwO1xufVxuXG4vKipcbiAqIFJlc2hhcGUgb25lIENsb3VkV2F0Y2ggbG9nIGV2ZW50IGludG8gYSBjbGVhbiBWZWN0b3IgcmVjb3JkLCB0aGVuIGFwcGx5IHRoZSBhcHAtbGV2ZWwgbm9pc2Uvc2V2ZXJpdHlcbiAqIHJ1bGVzLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBldmVudCBzaG91bGQgYmUgZHJvcHBlZCAocGxhdGZvcm0gbm9pc2Ugb3IgYSBcImRyb3BcIiBydWxlIG1hdGNoKS5cbiAqXG4gKiBmdzI0IGxvZ3MgYXJlIHRzbG9nIEpTT04gbGlrZSBge1wiMFwiOlwidGhlIG1lc3NhZ2VcIixcIjFcIjp7Li4uYXJnfSxcIl9tZXRhXCI6e1wibmFtZVwiOlwiQVBJQ29uc3RydWN0XCIsXG4gKiBcImxvZ0xldmVsTmFtZVwiOlwiSU5GT1wiLFwiZGF0ZVwiOlwiLi4uXCJ9fWAuIFdlIGxpZnQgdGhlIHJlYWwgbWVzc2FnZSBvdXQgb2YgdGhlIHBvc2l0aW9uYWwga2V5cyBhbmQgdGhlXG4gKiBjb21wb25lbnQvbGV2ZWwvdGltZSBvdXQgb2YgYF9tZXRhYCwgc28gTG9ndHJhaWwgc2hvd3MgcmVhZGFibGUgbGluZXMgaW5zdGVhZCBvZiBhIHJhdyBKU09OIGJsb2IuXG4gKiBOb24tSlNPTiBsaW5lcyAoTGFtYmRhIFNUQVJUL0VORC9SRVBPUlQsIHBsYWluIHRleHQpIHBhc3MgdGhyb3VnaCB1bmNoYW5nZWQuXG4gKi9cbmZ1bmN0aW9uIHRvVmVjdG9yUmVjb3JkKFxuXHRlOiB7IHRpbWVzdGFtcDogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfSxcblx0bG9nR3JvdXA6IHN0cmluZyxcblx0bG9nU3RyZWFtOiBzdHJpbmcsXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwge1xuXHRjb25zdCByYXcgPSAoZS5tZXNzYWdlID8/ICcnKS5yZXBsYWNlKC9cXHMrJC8sICcnKTtcblxuXHQvLyDilIDilIAgMSkgRFJPUDogTGFtYmRhIHBsYXRmb3JtIGxpbmVzIHRoYXQgYXJlIHB1cmUgbm9pc2UuIOKUgOKUgFxuXHRpZiAoaXNQbGF0Zm9ybU5vaXNlKHJhdy50cmltU3RhcnQoKSkpIHtcblx0XHRyZXR1cm4gbnVsbDtcblx0fVxuXG5cdGxldCBtZXNzYWdlID0gcmF3O1xuXHRsZXQgbGV2ZWw6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGxvZ2dlcjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgcmVxdWVzdElkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBjb3JyZWxhdGlvbklkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCB0c0lzbzogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG5cdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IHBlZWwgQVdTIExhbWJkYSdzIGDigLlpc2/igLpcXHTigLlyZXF1ZXN0SWTigLpcXHTigLlMRVZFTOKAulxcdOKAuW1lc3NhZ2XigLpgIHRleHQgcHJlZml4LCBpZiBwcmVzZW50LlxuXHRjb25zdCBsYW1iZGEgPSBwYXJzZUxhbWJkYVByZWZpeChyYXcpO1xuXHRpZiAobGFtYmRhKSB7XG5cdFx0cmVxdWVzdElkID0gbGFtYmRhLnJlcXVlc3RJZDtcblx0XHRsZXZlbCA9IGxhbWJkYS5sZXZlbDtcblx0XHRtZXNzYWdlID0gbGFtYmRhLm1lc3NhZ2U7XG5cdH1cblxuXHQvLyDilIDilIAgMSkgTk9STUFMSVpFOiBpZiB0aGUgcmVtYWluaW5nIG1lc3NhZ2UgaXMgZncyNCB0c2xvZyBKU09OLCBsaWZ0IHRoZSByZWFsIHRleHQgKyBjb21wb25lbnQvbGV2ZWwvdGltZS5cblx0Y29uc3QgYm9keSA9IG1lc3NhZ2U7XG5cdGlmIChib2R5LmNoYXJDb2RlQXQoMCkgPT09IDB4N2IgLyogeyAqLykge1xuXHRcdHRyeSB7XG5cdFx0XHRjb25zdCBvID0gSlNPTi5wYXJzZShib2R5KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblx0XHRcdGNvbnN0IG1ldGEgPSBvLl9tZXRhIGFzIHsgbmFtZT86IHVua25vd247IGxvZ0xldmVsTmFtZT86IHVua25vd247IGRhdGU/OiB1bmtub3duOyBjb3JyZWxhdGlvbklkPzogdW5rbm93biB9IHwgdW5kZWZpbmVkO1xuXHRcdFx0aWYgKG1ldGEgJiYgdHlwZW9mIG1ldGEgPT09ICdvYmplY3QnKSB7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5uYW1lID09PSAnc3RyaW5nJykgbG9nZ2VyID0gbWV0YS5uYW1lO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEubG9nTGV2ZWxOYW1lID09PSAnc3RyaW5nJykgbGV2ZWwgPSBtZXRhLmxvZ0xldmVsTmFtZS50b0xvd2VyQ2FzZSgpO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuZGF0ZSA9PT0gJ3N0cmluZycgJiYgIU51bWJlci5pc05hTihEYXRlLnBhcnNlKG1ldGEuZGF0ZSkpKSB7XG5cdFx0XHRcdFx0dHNJc28gPSBuZXcgRGF0ZShtZXRhLmRhdGUpLnRvSVNPU3RyaW5nKCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIG1ldGEuY29ycmVsYXRpb25JZC50cmltKCkpIGNvcnJlbGF0aW9uSWQgPSBtZXRhLmNvcnJlbGF0aW9uSWQudHJpbSgpO1xuXHRcdFx0fVxuXHRcdFx0Ly8gUG9zaXRpb25hbCBhcmdzIFwiMFwiLi5cIm5cIiBob2xkIHRoZSBsb2dnZWQgbWVzc2FnZSArIHBhcmFtcy5cblx0XHRcdGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuXHRcdFx0Zm9yIChsZXQgaSA9IDA7IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvLCBTdHJpbmcoaSkpOyBpKyspIHtcblx0XHRcdFx0Y29uc3QgdiA9IG9bU3RyaW5nKGkpXTtcblx0XHRcdFx0cGFydHMucHVzaCh0eXBlb2YgdiA9PT0gJ3N0cmluZycgPyB2IDogSlNPTi5zdHJpbmdpZnkodikpO1xuXHRcdFx0fVxuXHRcdFx0aWYgKHBhcnRzLmxlbmd0aCA+IDApIG1lc3NhZ2UgPSBwYXJ0cy5qb2luKCcgJyk7XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyBub3QgSlNPTiBhZnRlciBhbGwg4oCUIGtlZXAgdGhlIChwcmVmaXgtc3RyaXBwZWQpIG1lc3NhZ2Vcblx0XHR9XG5cdH1cblxuXHRjb25zdCBjbGVhbk1lc3NhZ2UgPSBzdHJpcEFuc2kobWVzc2FnZSk7XG5cdGxldCByZXNvbHZlZExldmVsID0gbGV2ZWwgPz8gZmFsbGJhY2tMZXZlbChyYXcpO1xuXHRsZXQgcmVjbGFzc2lmaWVkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cblx0Ly8g4pSA4pSAIExheWVycyAy4oCTNDogYXBwLWxldmVsIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMsIGFwcGxpZWQgdG8gdGhlIG5vcm1hbGl6ZWQgbWVzc2FnZS4g4pSA4pSAXG5cdGlmIChIQVNfTk9JU0VfUlVMRVMpIHtcblx0XHQvLyAyKSBSRUNMQVNTSUZZOiBiZW5pZ24gXCJlcnJvcnNcIiDihpIgd2FybiAob25seSBkb3duZ3JhZGUsIG5ldmVyIHVwZ3JhZGUpLlxuXHRcdGlmIChFUlJPUklTSC5oYXMocmVzb2x2ZWRMZXZlbCkgJiYgYW55TWF0Y2goQkVOSUdOX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXNvbHZlZExldmVsID0gJ3dhcm4nO1xuXHRcdFx0cmVjbGFzc2lmaWVkID0gJ2Jlbmlnbic7XG5cdFx0fVxuXHRcdC8vIDMpIERST1A6IG5vaXNlIHJlbW92ZWQgZW50aXJlbHkgKG5ldmVyIHNoaXBwZWQg4oCUIHNhdmVzIGluZ2VzdCBiYW5kd2lkdGggYXQgdGhlIHNvdXJjZSkuXG5cdFx0aWYgKGFueU1hdGNoKERST1BfUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJldHVybiBudWxsO1xuXHRcdH1cblx0XHQvLyA0KSBET1dOR1JBREU6IG5vaXNlIGtlcHQgYnV0IGRlLWVtcGhhc2lzZWQgdG8gZGVidWcuXG5cdFx0aWYgKGFueU1hdGNoKERPV05HUkFERV9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmVzb2x2ZWRMZXZlbCA9ICdkZWJ1Zyc7XG5cdFx0XHRyZWNsYXNzaWZpZWQgPSAnbm9pc2UnO1xuXHRcdH1cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0c2VydmljZTogU0VSVklDRSxcblx0XHRlbnY6IEVOVixcblx0XHQuLi4oUkVTT0xWRURfQUNDT1VOVCA/IHsgYWNjb3VudDogUkVTT0xWRURfQUNDT1VOVCB9IDoge30pLFxuXHRcdC4uLihSRUdJT04gPyB7IHJlZ2lvbjogUkVHSU9OIH0gOiB7fSksXG5cdFx0aG9zdDogc2hvcnRIb3N0KGxvZ0dyb3VwLCBsb2dTdHJlYW0pLFxuXHRcdC4uLihsb2dnZXIgPyB7IGxvZ2dlciB9IDoge30pLFxuXHRcdC4uLihyZXF1ZXN0SWQgPyB7IHJlcXVlc3RJZCB9IDoge30pLFxuXHRcdC4uLihjb3JyZWxhdGlvbklkID8geyBjb3JyZWxhdGlvbklkIH0gOiB7fSksXG5cdFx0bGV2ZWw6IHJlc29sdmVkTGV2ZWwsXG5cdFx0Li4uKHJlY2xhc3NpZmllZCA/IHsgcmVjbGFzc2lmaWVkIH0gOiB7fSksXG5cdFx0bWVzc2FnZTogY2xlYW5NZXNzYWdlLFxuXHRcdHRpbWVzdGFtcDogdHNJc28gPz8gbmV3IERhdGUoZS50aW1lc3RhbXApLnRvSVNPU3RyaW5nKCksXG5cdFx0bG9nR3JvdXAsXG5cdFx0bG9nU3RyZWFtLFxuXHR9O1xufVxuXG4vKiogU3BsaXQgcHJlLXNlcmlhbGl6ZWQgbGluZXMgaW50byBzdWItYmF0Y2hlcyB1bmRlciBNQVhfQkFUQ0hfQllURVMgKHVuY29tcHJlc3NlZCkuICovXG5mdW5jdGlvbiBjaHVua0xpbmVzKGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZ1tdW10ge1xuXHRjb25zdCBjaHVua3M6IHN0cmluZ1tdW10gPSBbXTtcblx0bGV0IGN1cnJlbnQ6IHN0cmluZ1tdID0gW107XG5cdGxldCBzaXplID0gMDtcblx0Zm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG5cdFx0Y29uc3QgbGluZUJ5dGVzID0gQnVmZmVyLmJ5dGVMZW5ndGgobGluZSkgKyAxOyAvLyArMSBmb3IgdGhlIGRlbGltaXRlclxuXHRcdGlmIChjdXJyZW50Lmxlbmd0aCA+IDAgJiYgc2l6ZSArIGxpbmVCeXRlcyA+IE1BWF9CQVRDSF9CWVRFUykge1xuXHRcdFx0Y2h1bmtzLnB1c2goY3VycmVudCk7XG5cdFx0XHRjdXJyZW50ID0gW107XG5cdFx0XHRzaXplID0gMDtcblx0XHR9XG5cdFx0Y3VycmVudC5wdXNoKGxpbmUpO1xuXHRcdHNpemUgKz0gbGluZUJ5dGVzO1xuXHR9XG5cdGlmIChjdXJyZW50Lmxlbmd0aCA+IDApIHtcblx0XHRjaHVua3MucHVzaChjdXJyZW50KTtcblx0fVxuXHRyZXR1cm4gY2h1bmtzO1xufVxuXG5mdW5jdGlvbiBlbmNvZGVCb2R5KGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG5cdC8vIGxpbmVzIGFyZSBhbHJlYWR5IEpTT04gc3RyaW5nc1xuXHRyZXR1cm4gQkFUQ0hfRk9STUFUID09PSAnanNvbi1hcnJheScgPyBgWyR7bGluZXMuam9pbignLCcpfV1gIDogbGluZXMuam9pbignXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHBvc3QoZ3ppcHBlZDogQnVmZmVyKTogUHJvbWlzZTx2b2lkPiB7XG5cdHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0Y29uc3QgdXJsID0gbmV3IFVSTChJTkdFU1RfVVJMISk7XG5cdFx0Y29uc3QgaXNIdHRwcyA9IHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOic7XG5cdFx0Y29uc3QgbGliID0gaXNIdHRwcyA/IGh0dHBzIDogaHR0cDtcblx0XHRjb25zdCByZXEgPSBsaWIucmVxdWVzdChcblx0XHRcdHVybCxcblx0XHRcdHtcblx0XHRcdFx0bWV0aG9kOiAnUE9TVCcsXG5cdFx0XHRcdGFnZW50OiBpc0h0dHBzID8gaHR0cHNBZ2VudCA6IGh0dHBBZ2VudCxcblx0XHRcdFx0aGVhZGVyczoge1xuXHRcdFx0XHRcdCdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG5cdFx0XHRcdFx0J0NvbnRlbnQtRW5jb2RpbmcnOiAnZ3ppcCcsXG5cdFx0XHRcdFx0J0NvbnRlbnQtTGVuZ3RoJzogZ3ppcHBlZC5sZW5ndGgsXG5cdFx0XHRcdFx0Li4uKFhfQVBJX0tFWSA/IHsgJ3gtYXBpLWtleSc6IFhfQVBJX0tFWSB9IDoge30pLFxuXHRcdFx0XHR9LFxuXHRcdFx0fSxcblx0XHRcdChyZXMpID0+IHtcblx0XHRcdFx0cmVzLnJlc3VtZSgpOyAvLyBkcmFpbiBzbyB0aGUgc29ja2V0IGNhbiBiZSByZXVzZWRcblx0XHRcdFx0Y29uc3Qgc3RhdHVzID0gcmVzLnN0YXR1c0NvZGUgPz8gMDtcblx0XHRcdFx0aWYgKHN0YXR1cyA+PSAyMDAgJiYgc3RhdHVzIDwgMzAwKSB7XG5cdFx0XHRcdFx0cmVzb2x2ZSgpO1xuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlamVjdChuZXcgRXJyb3IoYGluZ2VzdCByZXNwb25kZWQgJHtzdGF0dXN9YCkpO1xuXHRcdFx0XHR9XG5cdFx0XHR9LFxuXHRcdCk7XG5cdFx0cmVxLm9uKCdlcnJvcicsIHJlamVjdCk7XG5cdFx0cmVxLnNldFRpbWVvdXQoUE9TVF9USU1FT1VUX01TLCAoKSA9PiByZXEuZGVzdHJveShuZXcgRXJyb3IoJ2luZ2VzdCB0aW1lb3V0JykpKTtcblx0XHRyZXEuZW5kKGd6aXBwZWQpO1xuXHR9KTtcbn1cblxuLyoqIFBPU1Qgb25lIGNodW5rIHdpdGggYSBzaW5nbGUgcmV0cnkuIFJldHVybnMgZmFsc2UgaWYgdGhlIGNodW5rIHdhcyBkcm9wcGVkIGFmdGVyIHJldHJpZXMuICovXG5hc3luYyBmdW5jdGlvbiBzaGlwV2l0aFJldHJ5KGd6aXBwZWQ6IEJ1ZmZlcik6IFByb21pc2U8Ym9vbGVhbj4ge1xuXHRmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8PSBNQVhfUkVUUklFUzsgYXR0ZW1wdCsrKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IHBvc3QoZ3ppcHBlZCk7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9IGNhdGNoIChlcnIpIHtcblx0XHRcdGlmIChhdHRlbXB0ID09PSBNQVhfUkVUUklFUykge1xuXHRcdFx0XHQvLyBTd2FsbG93IGFmdGVyIHJldHJpZXM6IGEgcGVyc2lzdGVudCBpbmdlc3Qgb3V0YWdlIG11c3Qgbm90IGNyZWF0ZSBhIENsb3VkV2F0Y2ggcmV0cnkgc3Rvcm0uXG5cdFx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBzaGlwIGZhaWxlZCwgZHJvcHBpbmcgY2h1bms6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vKiogRW1pdCBhbiBhbGFybWFibGUgQ2xvdWRXYXRjaCBtZXRyaWMgKEVNRikgd2hlbiByZWNvcmRzIGFyZSBkcm9wcGVkIOKAlCBubyBTREssIGp1c3Qgc3RydWN0dXJlZCBzdGRvdXQuICovXG5mdW5jdGlvbiBlbWl0RHJvcHBlZE1ldHJpYyhyZWNvcmRzOiBudW1iZXIpOiB2b2lkIHtcblx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0Y29uc29sZS5sb2coXG5cdFx0SlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0X2F3czoge1xuXHRcdFx0XHRUaW1lc3RhbXA6IERhdGUubm93KCksXG5cdFx0XHRcdENsb3VkV2F0Y2hNZXRyaWNzOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0TmFtZXNwYWNlOiAnTG9nRm9yd2FyZGVyJyxcblx0XHRcdFx0XHRcdERpbWVuc2lvbnM6IFsgWyAnc2VydmljZScgXSBdLFxuXHRcdFx0XHRcdFx0TWV0cmljczogWyB7IE5hbWU6ICdEcm9wcGVkUmVjb3JkcycsIFVuaXQ6ICdDb3VudCcgfSBdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cdFx0XHR9LFxuXHRcdFx0c2VydmljZTogU0VSVklDRSxcblx0XHRcdERyb3BwZWRSZWNvcmRzOiByZWNvcmRzLFxuXHRcdH0pLFxuXHQpO1xufVxuXG5pbnRlcmZhY2UgTGFtYmRhQ29udGV4dExpa2Uge1xuXHRpbnZva2VkRnVuY3Rpb25Bcm4/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBDbG91ZFdhdGNoTG9nc0V2ZW50LCBjb250ZXh0PzogTGFtYmRhQ29udGV4dExpa2UpOiBQcm9taXNlPHZvaWQ+ID0+IHtcblx0Ly8gUmVzb2x2ZSB0aGUgYWNjb3VudCBmcm9tIHRoaXMgZm9yd2FyZGVyJ3Mgb3duIEFSTiBvbmNlIChzYW1lIGZvciBldmVyeSBpbnZvY2F0aW9uKS5cblx0aWYgKCFSRVNPTFZFRF9BQ0NPVU5UICYmIGNvbnRleHQ/Lmludm9rZWRGdW5jdGlvbkFybikge1xuXHRcdFJFU09MVkVEX0FDQ09VTlQgPSBhY2NvdW50RnJvbUFybihjb250ZXh0Lmludm9rZWRGdW5jdGlvbkFybik7XG5cdH1cblx0aWYgKCFJTkdFU1RfVVJMKSB7XG5cdFx0cmV0dXJuOyAvLyBub3QgY29uZmlndXJlZCB5ZXQg4oCUIG5vLW9wIChzYWZlIHRvIGRlcGxveSBiZWZvcmUgd2lyaW5nIHRoZSBpbmdlc3QgVVJMKVxuXHR9XG5cblx0bGV0IHBheWxvYWQ6IERlY29kZWRQYXlsb2FkO1xuXHR0cnkge1xuXHRcdHBheWxvYWQgPSBKU09OLnBhcnNlKGd1bnppcFN5bmMoQnVmZmVyLmZyb20oZXZlbnQuYXdzbG9ncy5kYXRhLCAnYmFzZTY0JykpLnRvU3RyaW5nKCd1dGY4JykpIGFzIERlY29kZWRQYXlsb2FkO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBmYWlsZWQgdG8gZGVjb2RlIHBheWxvYWQ6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0aWYgKHBheWxvYWQubWVzc2FnZVR5cGUgPT09ICdDT05UUk9MX01FU1NBR0UnKSB7XG5cdFx0cmV0dXJuOyAvLyBzdWJzY3JpcHRpb24gbGl2ZW5lc3MgcGluZ1xuXHR9XG5cdGNvbnN0IGV2ZW50cyA9IHBheWxvYWQubG9nRXZlbnRzO1xuXHRpZiAoIUFycmF5LmlzQXJyYXkoZXZlbnRzKSB8fCBldmVudHMubGVuZ3RoID09PSAwKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG5cdGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcblx0XHRjb25zdCByZWNvcmQgPSB0b1ZlY3RvclJlY29yZChlLCBwYXlsb2FkLmxvZ0dyb3VwLCBwYXlsb2FkLmxvZ1N0cmVhbSk7XG5cdFx0aWYgKHJlY29yZCAhPT0gbnVsbCkge1xuXHRcdFx0bGluZXMucHVzaChKU09OLnN0cmluZ2lmeShyZWNvcmQpKTtcblx0XHR9XG5cdH1cblx0aWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkge1xuXHRcdHJldHVybjsgLy8gd2hvbGUgYmF0Y2ggd2FzIG5vaXNlIC8gZHJvcHBlZFxuXHR9XG5cdGxldCBkcm9wcGVkID0gMDtcblx0Zm9yIChjb25zdCBjaHVuayBvZiBjaHVua0xpbmVzKGxpbmVzKSkge1xuXHRcdGNvbnN0IGd6aXBwZWQgPSBnemlwU3luYyhCdWZmZXIuZnJvbShlbmNvZGVCb2R5KGNodW5rKSkpO1xuXHRcdGNvbnN0IG9rID0gYXdhaXQgc2hpcFdpdGhSZXRyeShnemlwcGVkKTtcblx0XHRpZiAoIW9rKSB7XG5cdFx0XHRkcm9wcGVkICs9IGNodW5rLmxlbmd0aDtcblx0XHR9XG5cdH1cblx0aWYgKGRyb3BwZWQgPiAwKSB7XG5cdFx0ZW1pdERyb3BwZWRNZXRyaWMoZHJvcHBlZCk7XG5cdH1cbn07XG4iXX0=