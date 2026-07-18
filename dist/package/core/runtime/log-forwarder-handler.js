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
        ...(RESOLVED_ACCOUNT ? { account: RESOLVED_ACCOUNT } : {}),
        ...(REGION ? { region: REGION } : {}),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F5Qkc7QUFDSCx5Q0FBaUQ7QUFDakQsZ0RBQWtDO0FBQ2xDLGtEQUFvQztBQUNwQyx1Q0FBK0I7QUFFL0IsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUM1RCxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLElBQUksRUFBRSxJQUFJLFNBQVMsQ0FBQztBQUN4RSxxR0FBcUc7QUFDckcsZ0dBQWdHO0FBQ2hHLE1BQU0sR0FBRyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxJQUFJLFNBQVMsQ0FBQztBQUMzRCx1R0FBdUc7QUFDdkcscUdBQXFHO0FBQ3JHLGtGQUFrRjtBQUNsRixNQUFNLE9BQU8sR0FBRyxHQUFHLElBQUksR0FBRyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxZQUFZLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQztBQUNuRixNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixFQUFFLElBQUksRUFBRSxDQUFDO0FBRWpFLHFHQUFxRztBQUNyRyxzR0FBc0c7QUFDdEcscUdBQXFHO0FBQ3JHLHNGQUFzRjtBQUN0RixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDcEQsSUFBSSxnQkFBZ0IsR0FBRyxFQUFFLENB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QztRQUN6QixDQUFDO0lBQ0YsQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pCLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzVCLENBQUM7QUFDRixDQUFDLENBQUM7QUEvQ1csUUFBQSxPQUFPLFdBK0NsQiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xvdWRXYXRjaCBMb2dzIC0+IFZlY3Rvci9Mb2d0cmFpbCBmb3J3YXJkZXIgKG91dC1vZi1iYW5kIGxvZyBzaGlwcGluZykuXG4gKlxuICogQXBwIExhbWJkYXMgb25seSB3cml0ZSB0byBzdGRvdXQgKENsb3VkV2F0Y2gpIOKAlCBub3RoaW5nIHJ1bnMgaW4gdGhlaXIgcmVxdWVzdCBwYXRoLiBBIENsb3VkV2F0Y2hcbiAqIExvZ3Mgc3Vic2NyaXB0aW9uIGZpbHRlciBzdHJlYW1zIGJhdGNoZWQsIGd6aXBwZWQgZXZlbnRzIHRvIHRoaXMgZnVuY3Rpb24sIHdoaWNoIHJlc2hhcGVzIHRoZW0gdG9cbiAqIGNsZWFuIFZlY3RvciBKU09OIHJlY29yZHMgYW5kIHNoaXBzIHRoZW0gdG8gdGhlIGluZ2VzdCBlbmRwb2ludCBvdmVyIGEga2VlcC1hbGl2ZSBjb25uZWN0aW9uLFxuICogZ3ppcC1jb21wcmVzc2VkIGFuZCBzcGxpdCBpbnRvIGJvdW5kZWQgc3ViLWJhdGNoZXMuXG4gKlxuICogUHJvY2Vzc2luZyBwaXBlbGluZSBwZXIgZXZlbnQgKHNlZSBgTG9nRm9yd2FyZGVyQ29uc3RydWN0YCk6XG4gKiAgIDEuIE5PUk1BTElaRSAg4oCUIHBlZWwgQVdTIExhbWJkYSdzIHRleHQgcHJlZml4LCBsaWZ0IGZ3MjQgdHNsb2cgSlNPTiwgc3RyaXAgQU5TSSwgc2hvcnRlbiBob3N0LlxuICogICAyLiBSRUNMQVNTSUZZIOKAlCBlcnJvci1pc2ggbGluZXMgbWF0Y2hpbmcgYSBcImJlbmlnblwiIHBhdHRlcm4g4oaSIGB3YXJuYCAoYHJlY2xhc3NpZmllZDogXCJiZW5pZ25cImApLlxuICogICAzLiBEUk9QICAgICAgIOKAlCBsaW5lcyBtYXRjaGluZyBhIFwiZHJvcFwiIHBhdHRlcm4gYXJlIHJlbW92ZWQgZW50aXJlbHkgKHNhdmVkIGJhbmR3aWR0aCBhdCBzb3VyY2UpLlxuICogICA0LiBET1dOR1JBREUgIOKAlCBsaW5lcyBtYXRjaGluZyBhIFwiZG93bmdyYWRlXCIgcGF0dGVybiDihpIgYGRlYnVnYCAoYHJlY2xhc3NpZmllZDogXCJub2lzZVwiYCkuXG4gKiBTdGVwcyAy4oCTNCBhcmUgYXBwLW93bmVkIHJ1bGUgbGlzdHMgKGVudi1pbmplY3RlZCBieSB0aGUgY29uc3RydWN0KSwgY29tcGxlbWVudGFyeSB0byBhbnkgZ2xvYmFsXG4gKiBzZXZlcml0eS9ub2lzZSBoYW5kbGluZyBhIHNoYXJlZCBWZWN0b3IgaW5nZXN0IG1heSBhbHNvIGFwcGx5LlxuICpcbiAqIEV2ZXJ5IHJlY29yZCBhbHNvIGNhcnJpZXMgYGFjY291bnRgICsgYHJlZ2lvbmAgKGZyb20gdGhlIGZvcndhcmRlcidzIG93biBBUk4pIHNvIGRlcGxveW1lbnRzIHRoYXRcbiAqIHNoYXJlIGFwcCArIGVudiBuYW1lcyDigJQgZS5nLiBtdWx0aXBsZSBkZXZlbG9wZXJzIGVhY2ggcnVubmluZyBgcGx1c2Zhbi10cmlhbHNgIChBUFBfRU5WSVJPTk1FTlQ9bG9jYWwpXG4gKiBpbiB0aGVpciBPV04gYWNjb3VudCDigJQgc3RheSBkaXN0aW5ndWlzaGFibGUgaW5zdGVhZCBvZiBjb2xsaWRpbmcgdW5kZXIgb25lIGBzZXJ2aWNlYCBsYWJlbC5cbiAqXG4gKiBFTlYgTkFNRVNQQUNFOiB0aGlzIGZ1bmN0aW9uIHJlYWRzIE9OTFkgYEZPUldBUkRFUl8qYCBlbnYgdmFycyDigJQgZGVsaWJlcmF0ZWx5IE5PVCB0aGUgYExPR1RSQUlMXypgXG4gKiBrZXlzIHVzZWQgYnkgZncyNCdzIGluLXByb2Nlc3MgbG9nIHRyYW5zcG9ydC4gVGhhdCBndWFyYW50ZWVzIHRoZSBmb3J3YXJkZXIgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCxcbiAqIG9yIGFjY2lkZW50YWxseSBhY3RpdmF0ZSwgZncyNCdzIGluLXByb2Nlc3MgTG9ndHJhaWwgbWFjaGluZXJ5LlxuICpcbiAqIERFUEVOREVOQ1ktRlJFRSAobm9kZSBidWlsdC1pbnMgb25seSkgc28gdGhlIGZvcndhcmRlciBidW5kbGUgc3RheXMgdGlueSBhbmQgY2hlYXAuXG4gKi9cbmltcG9ydCB7IGd1bnppcFN5bmMsIGd6aXBTeW5jIH0gZnJvbSAnbm9kZTp6bGliJztcbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJztcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnO1xuaW1wb3J0IHsgVVJMIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5jb25zdCBJTkdFU1RfVVJMID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9VUkw/LnRyaW0oKTtcbmNvbnN0IEJBU0VfU0VSVklDRSA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9TRVJWSUNFPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gU3RhZ2Uvb3duZXIgbGFiZWwgKGUuZy4gYGRldmVsb3BgLCBgcHJvZGAsIGBzYW5kYm94LW5pdGluYCkgc28gZGV2ZWxvcC9wcm9kL3Blci1kZXZlbG9wZXIgbG9ncyBhcmVcbi8vIGRpc3Rpbmd1aXNoYWJsZSDigJQgdGhlcmUgY2FuIGJlIHNldmVyYWwgZGVwbG95bWVudHMgb2Ygb25lIHNlcnZpY2UgYWNyb3NzIGVudnMgYW5kIGRldmVsb3BlcnMuXG5jb25zdCBFTlYgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfRU5WPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gVGhlIGBzZXJ2aWNlYCBsYWJlbCBpcyB3aGF0J3MgcHJvbW90ZWQgdG8gYSBMb2tpIGxhYmVsIChhbmQgc2hvd24gaW4gTG9ndHJhaWwpLCBzbyBmb2xkIHRoZSBlbnYgaW50b1xuLy8gaXQg4oCUIGBwbHVzZmFuLXRyaWFscy1kZXZlbG9wYCwgYHBsdXNmYW4tdHJpYWxzLXNhbmRib3gtbml0aW5gLCDigKYg4oCUIGd1YXJhbnRlZWluZyBlYWNoIGRlcGxveW1lbnQgaXNcbi8vIGRpc3RpbmN0IGF0IGEgZ2xhbmNlLiBgZW52YCBpcyBhbHNvIGVtaXR0ZWQgYXMgYSBzdHJ1Y3R1cmVkIGZpZWxkIGZvciBxdWVyeWluZy5cbmNvbnN0IFNFUlZJQ0UgPSBFTlYgJiYgRU5WICE9PSAndW5rbm93bicgPyBgJHtCQVNFX1NFUlZJQ0V9LSR7RU5WfWAgOiBCQVNFX1NFUlZJQ0U7XG5jb25zdCBYX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWT8udHJpbSgpO1xuXG4vLyBBV1MgYWNjb3VudCArIHJlZ2lvbiBkaXNhbWJpZ3VhdGUgZGVwbG95bWVudHMgdGhhdCBzaGFyZSBhcHAgKyBlbnYgbmFtZXMg4oCUIGUuZy4gc2V2ZXJhbCBkZXZlbG9wZXJzXG4vLyBlYWNoIGRlcGxveWluZyB0aGUgU0FNRSBhcHAgKGBwbHVzZmFuLXRyaWFsc2AsIEFQUF9FTlZJUk9OTUVOVD1sb2NhbCkgdG8gdGhlaXIgT1dOIGFjY291bnQuIFdpdGhvdXRcbi8vIHRoaXMsIGFsbCB0aGVpciBsb2dzIHdvdWxkIGNvbGxpZGUgdW5kZXIgb25lIGBzZXJ2aWNlYCBsYWJlbC4gUmVnaW9uIGlzIHNldCBieSB0aGUgTGFtYmRhIHJ1bnRpbWU7XG4vLyBhY2NvdW50IGlzIHBhcnNlZCBmcm9tIHRoZSBpbnZva2VkIGZ1bmN0aW9uIEFSTiBvbiB0aGUgZmlyc3QgaW52b2NhdGlvbiBhbmQgY2FjaGVkLlxuY29uc3QgUkVHSU9OID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTj8udHJpbSgpIHx8ICcnO1xubGV0IFJFU09MVkVEX0FDQ09VTlQgPSAnJztcbmZ1bmN0aW9uIGFjY291bnRGcm9tQXJuKGFybjogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcblx0Ly8gYXJuOmF3czpsYW1iZGE6PHJlZ2lvbj46PEFDQ09VTlQ+OmZ1bmN0aW9uOjxuYW1lPlxuXHRjb25zdCBwYXJ0cyA9IChhcm4gfHwgJycpLnNwbGl0KCc6Jyk7XG5cdHJldHVybiBwYXJ0cy5sZW5ndGggPiA0ID8gcGFydHNbNF0gOiAnJztcbn1cbi8vIFRoZSBmdzI0IExvZ3RyYWlsL1ZlY3RvciBpbmdlc3QgZGVjb2RlcyBhIEpTT04gYXJyYXkgaW50byBpbmRpdmlkdWFsIGV2ZW50cyBhbmQgUkVKRUNUUyBOREpTT04gKDQwMCksXG4vLyBzbyBganNvbi1hcnJheWAgaXMgdGhlIGRlZmF1bHQuIE92ZXJyaWRlIHRvIGBuZGpzb25gIG9ubHkgZm9yIGFuIGluZ2VzdCBjb25maWd1cmVkIHdpdGggbmV3bGluZSBmcmFtaW5nLlxuY29uc3QgQkFUQ0hfRk9STUFUID0gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9CQVRDSF9GT1JNQVQ/LnRyaW0oKSB8fCAnanNvbi1hcnJheScpIGFzICduZGpzb24nIHwgJ2pzb24tYXJyYXknO1xuLyoqIE1heCB1bmNvbXByZXNzZWQgYnl0ZXMgcGVyIFBPU1Qg4oCUIGJvdW5kcyByZXF1ZXN0IHNpemUgc28gYSBsYXJnZSBDbG91ZFdhdGNoIGJhdGNoIGNhbid0IDQxMyB0aGUgaW5nZXN0LiAqL1xuY29uc3QgTUFYX0JBVENIX0JZVEVTID0gTnVtYmVyKHByb2Nlc3MuZW52LkZPUldBUkRFUl9NQVhfQkFUQ0hfQllURVMpIHx8IDFfMDAwXzAwMDtcbmNvbnN0IFBPU1RfVElNRU9VVF9NUyA9IE51bWJlcihwcm9jZXNzLmVudi5GT1JXQVJERVJfUE9TVF9USU1FT1VUX01TKSB8fCA1MDAwO1xuY29uc3QgTUFYX1JFVFJJRVMgPSAxO1xuXG4vLyDilIDilIAgQXBwLWxldmVsIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMgKGxheWVycyAy4oCTNCkuIEVhY2ggZW52IHZhciBpcyBhIEpTT04gYXJyYXkgb2YgcmVnZXggc291cmNlXG4vLyAgICBzdHJpbmdzOyBjb21waWxlZCBjYXNlLWluc2Vuc2l0aXZlbHkgb25jZSwgaGVyZSwgYXQgY29sZCBzdGFydC4gRW1wdHkvbWFsZm9ybWVkIOKGkiBubyBydWxlcy4g4pSA4pSAXG5mdW5jdGlvbiBjb21waWxlUnVsZXMocmF3SnNvbjogc3RyaW5nIHwgdW5kZWZpbmVkKTogUmVnRXhwW10ge1xuXHRpZiAoIXJhd0pzb24pIHJldHVybiBbXTtcblx0bGV0IGFycjogdW5rbm93bjtcblx0dHJ5IHtcblx0XHRhcnIgPSBKU09OLnBhcnNlKHJhd0pzb24pO1xuXHR9IGNhdGNoIHtcblx0XHRyZXR1cm4gW107XG5cdH1cblx0aWYgKCFBcnJheS5pc0FycmF5KGFycikpIHJldHVybiBbXTtcblx0Y29uc3Qgb3V0OiBSZWdFeHBbXSA9IFtdO1xuXHRmb3IgKGNvbnN0IHNyYyBvZiBhcnIpIHtcblx0XHRpZiAodHlwZW9mIHNyYyAhPT0gJ3N0cmluZycgfHwgc3JjLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cdFx0dHJ5IHtcblx0XHRcdG91dC5wdXNoKG5ldyBSZWdFeHAoc3JjLCAnaScpKTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vIEEgYmFkIHBhdHRlcm4gbXVzdCBuZXZlciBicmVhayB0aGUgZm9yd2FyZGVyIOKAlCBza2lwIGl0LlxuXHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdGNvbnNvbGUud2FybignW2xvZy1mb3J3YXJkZXJdIGlnbm9yaW5nIGludmFsaWQgbm9pc2UgcGF0dGVybjonLCBzcmMpO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gb3V0O1xufVxuXG5jb25zdCBCRU5JR05fUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0JFTklHTik7XG5jb25zdCBEUk9QX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9EUk9QKTtcbmNvbnN0IERPV05HUkFERV9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfRE9XTkdSQURFKTtcbmNvbnN0IEhBU19OT0lTRV9SVUxFUyA9IEJFTklHTl9SVUxFUy5sZW5ndGggPiAwIHx8IERST1BfUlVMRVMubGVuZ3RoID4gMCB8fCBET1dOR1JBREVfUlVMRVMubGVuZ3RoID4gMDtcblxuLy8gTGV2ZWxzIHRoYXQgY291bnQgYXMgXCJlcnJvci1pc2hcIiBmb3IgdGhlIGJlbmlnbiBkb3duZ3JhZGUgKG1pcnJvcnMgdGhlIFZlY3RvciBBMSBsaXN0KS5cbmNvbnN0IEVSUk9SSVNIID0gbmV3IFNldChbICdlcnJvcicsICdlcnInLCAnZmF0YWwnLCAnY3JpdGljYWwnLCAnY3JpdCcsICdlbWVyZycsICdhbGVydCcsICdwYW5pYycgXSk7XG5mdW5jdGlvbiBhbnlNYXRjaChydWxlczogUmVnRXhwW10sIG1zZzogc3RyaW5nKTogYm9vbGVhbiB7XG5cdGZvciAoY29uc3QgcmUgb2YgcnVsZXMpIHtcblx0XHRpZiAocmUudGVzdChtc2cpKSByZXR1cm4gdHJ1ZTtcblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8vIFJldXNlZCBhY3Jvc3Mgd2FybSBpbnZvY2F0aW9ucyBzbyB3ZSBkb24ndCBwYXkgVENQL1RMUyBzZXR1cCBwZXIgYmF0Y2guXG5jb25zdCBodHRwQWdlbnQgPSBuZXcgaHR0cC5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSwgbWF4U29ja2V0czogMTYgfSk7XG5jb25zdCBodHRwc0FnZW50ID0gbmV3IGh0dHBzLkFnZW50KHsga2VlcEFsaXZlOiB0cnVlLCBtYXhTb2NrZXRzOiAxNiB9KTtcblxuaW50ZXJmYWNlIENsb3VkV2F0Y2hMb2dzRXZlbnQge1xuXHRhd3Nsb2dzOiB7IGRhdGE6IHN0cmluZyB9O1xufVxuXG5pbnRlcmZhY2UgRGVjb2RlZFBheWxvYWQge1xuXHRtZXNzYWdlVHlwZTogc3RyaW5nO1xuXHRsb2dHcm91cDogc3RyaW5nO1xuXHRsb2dTdHJlYW06IHN0cmluZztcblx0bG9nRXZlbnRzOiBBcnJheTx7IGlkOiBzdHJpbmc7IHRpbWVzdGFtcDogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfT47XG59XG5cbi8vIExhbWJkYSBwbGF0Zm9ybSBsaW5lcyB0aGF0IGFyZSBwdXJlIG5vaXNlLiBSRVBPUlQgaXMga2VwdCBieSBkZWZhdWx0IChjYXJyaWVzIGR1cmF0aW9uL21lbW9yeSk7XG4vLyBzZXQgRk9SV0FSREVSX0RST1BfUkVQT1JUPXRydWUgdG8gZHJvcCBpdCB0b28uXG5jb25zdCBEUk9QX1JFUE9SVCA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9EUk9QX1JFUE9SVD8udHJpbSgpID09PSAndHJ1ZSc7XG5mdW5jdGlvbiBpc1BsYXRmb3JtTm9pc2UocmF3OiBzdHJpbmcpOiBib29sZWFuIHtcblx0aWYgKHJhdy5zdGFydHNXaXRoKCdTVEFSVCBSZXF1ZXN0SWQnKSB8fCByYXcuc3RhcnRzV2l0aCgnRU5EIFJlcXVlc3RJZCcpIHx8IHJhdy5zdGFydHNXaXRoKCdJTklUX1NUQVJUJykpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXHRpZiAoRFJPUF9SRVBPUlQgJiYgcmF3LnN0YXJ0c1dpdGgoJ1JFUE9SVCBSZXF1ZXN0SWQnKSkge1xuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLy8gZncyNCdzIHRzbG9nIGNvbG9yaXplcyBvdXRwdXQgd2l0aCBBTlNJIFNHUiBjb2RlcyAoZS5nLiBFU0NbMzJtIOKApiBFU0NbMzltKSB3aGljaCBvdGhlcndpc2Ugc2hpcCBhc1xuLy8gbGl0ZXJhbCBgWzMybWAgbm9pc2UgaW4gTG9ndHJhaWwuIFN0cmlwIGFsbCBBTlNJIGVzY2FwZSBzZXF1ZW5jZXMgZnJvbSBzaGlwcGVkIHRleHQuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29udHJvbC1yZWdleFxuY29uc3QgQU5TSV9SRSA9IC9cXHgxYlxcW1swLTk7XSpbQS1aYS16XS9nO1xuZnVuY3Rpb24gc3RyaXBBbnNpKHM6IHN0cmluZyk6IHN0cmluZyB7XG5cdHJldHVybiBzLmluY2x1ZGVzKCdcXHgxYicpID8gcy5yZXBsYWNlKEFOU0lfUkUsICcnKSA6IHM7XG59XG5cbmZ1bmN0aW9uIGZhbGxiYWNrTGV2ZWwocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuXHRpZiAoL1xcYig/OkVSUk9SfEZBVEFMKVxcYi8udGVzdChyYXcpKSByZXR1cm4gJ2Vycm9yJztcblx0aWYgKC9cXGJXQVJOKD86SU5HKT9cXGIvLnRlc3QocmF3KSkgcmV0dXJuICd3YXJuJztcblx0cmV0dXJuICdpbmZvJztcbn1cblxuY29uc3QgS05PV05fTEVWRUxTID0gbmV3IFNldChbICd0cmFjZScsICdkZWJ1ZycsICdpbmZvJywgJ3dhcm4nLCAnd2FybmluZycsICdlcnJvcicsICdmYXRhbCcgXSk7XG5jb25zdCBJU09fUkUgPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9LztcblxuLyoqXG4gKiBBV1MgTGFtYmRhIGVtaXRzIHRleHQgbG9ncyBhcyBg4oC5aXNv4oC6XFx04oC5cmVxdWVzdElk4oC6XFx04oC5TEVWRUzigLpcXHTigLltZXNzYWdl4oC6YC4gUGVlbCB0aGF0IHByZWZpeCBvZmYgc28gdGhlXG4gKiBtZXNzYWdlIGlzIGp1c3QgdGhlIHRleHQsIGFuZCBsaWZ0IHJlcXVlc3RJZC9sZXZlbCBvdXQgYXMgZmllbGRzICh0aGV5J3JlIGFscmVhZHkgc2hvd24gYXMgY29sdW1ucykuXG4gKiBSZXR1cm5zIG51bGwgaWYgdGhlIGxpbmUgaXNuJ3QgaW4gdGhhdCBmb3JtYXQuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlTGFtYmRhUHJlZml4KHJhdzogc3RyaW5nKTogeyByZXF1ZXN0SWQ6IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgbWVzc2FnZTogc3RyaW5nIH0gfCBudWxsIHtcblx0Y29uc3QgcGFydHMgPSByYXcuc3BsaXQoJ1xcdCcpO1xuXHRpZiAocGFydHMubGVuZ3RoIDwgNCkgcmV0dXJuIG51bGw7XG5cdGNvbnN0IFsgdHMsIHJlcXVlc3RJZCwgbHZsLCAuLi5yZXN0IF0gPSBwYXJ0cztcblx0aWYgKCFJU09fUkUudGVzdCh0cykgfHwgIUtOT1dOX0xFVkVMUy5oYXMobHZsLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgcmV0dXJuIG51bGw7XG5cdHJldHVybiB7IHJlcXVlc3RJZCwgbGV2ZWw6IGx2bC50cmltKCkudG9Mb3dlckNhc2UoKSwgbWVzc2FnZTogcmVzdC5qb2luKCdcXHQnKS50cmltKCkgfTtcbn1cblxuLyoqXG4gKiBUdXJuIGEgdmVyYm9zZSBDbG91ZFdhdGNoIGxvZy1ncm91cCAvIGxvZy1zdHJlYW0gaW50byBhIHNob3J0IGZ1bmN0aW9uIG5hbWUgZm9yIHRoZSBgaG9zdGAgbGFiZWwsXG4gKiBlLmcuIGDigKYtcGx1c2ZhbnRyaWFsc3N0cmVhbXByb2Nlc3NvcuKApkxvZ0dyb3Vw4oCmYCDihpIgYHBsdXNmYW50cmlhbHNzdHJlYW1wcm9jZXNzb3JgLiBGYWxscyBiYWNrIHRvIHRoZVxuICogcmF3IGxvZyBncm91cC4gVGhlIGZ1bGwgbG9nIGdyb3VwIGlzIHN0aWxsIGVtaXR0ZWQgc2VwYXJhdGVseSBhcyBgbG9nR3JvdXBgLlxuICovXG5mdW5jdGlvbiBzaG9ydEhvc3QobG9nR3JvdXA6IHN0cmluZywgbG9nU3RyZWFtOiBzdHJpbmcpOiBzdHJpbmcge1xuXHQvLyBMYW1iZGEgbG9nIHN0cmVhbTogXCJZWVlZL01NL0RELzxmdW5jdGlvbk5hbWU+WyRMQVRFU1RdPGlkPlwiIOKAlCB0aGUgY2xlYW5lc3Qgc291cmNlIG9mIHRoZSBmbiBuYW1lLlxuXHRjb25zdCBzbSA9IGxvZ1N0cmVhbS5tYXRjaCgvXlxcZHs0fVxcL1xcZHsyfVxcL1xcZHsyfVxcLyguKz8pXFxbXFwkTEFURVNUXFxdLyk7XG5cdGlmIChzbSAmJiBzbVsxXSkge1xuXHRcdHJldHVybiBzbVsxXS5yZXBsYWNlKC8tW0EtWmEtejAtOV17Nix9JC8sICcnKTsgLy8gZHJvcCB0aGUgQ2xvdWRGb3JtYXRpb24gcmFuZG9tIHN1ZmZpeFxuXHR9XG5cdC8vIEZhbGxiYWNrOiBwYXJzZSB0aGUgbG9nIGdyb3VwIOKAlCBzdHJpcCB0aGUgYOKApkxvZ0dyb3VwPGhhc2g+LTxzdWZmaXg+YCB0YWlsLCB0YWtlIHRoZSBsYXN0IHNlZ21lbnQsXG5cdC8vIGFuZCBkZS1kdXBsaWNhdGUgQ0RLJ3MgZG91YmxlZCBjb25zdHJ1Y3QgbmFtZSAoYGZvb0JhcmZvb0JhcmAg4oaSIGBmb29CYXJgKS5cblx0bGV0IHMgPSBsb2dHcm91cDtcblx0Y29uc3QgbGcgPSBzLmluZGV4T2YoJ0xvZ0dyb3VwJyk7XG5cdGlmIChsZyA+IDApIHMgPSBzLnNsaWNlKDAsIGxnKTtcblx0Y29uc3QgbSA9IHMubWF0Y2goLyg/OnN0YWNrLXxOZXN0ZWRTdGFja1Jlc291cmNlWzAtOUEtRmEtZl0qLSkoW14tXSspJC8pO1xuXHRpZiAobSkgcyA9IG1bMV07XG5cdGlmIChzLmxlbmd0aCA+IDAgJiYgcy5sZW5ndGggJSAyID09PSAwKSB7XG5cdFx0Y29uc3QgaGFsZiA9IHMubGVuZ3RoIC8gMjtcblx0XHRpZiAocy5zbGljZSgwLCBoYWxmKSA9PT0gcy5zbGljZShoYWxmKSkgcyA9IHMuc2xpY2UoMCwgaGFsZik7XG5cdH1cblx0cmV0dXJuIHMgfHwgbG9nR3JvdXA7XG59XG5cbi8qKlxuICogUmVzaGFwZSBvbmUgQ2xvdWRXYXRjaCBsb2cgZXZlbnQgaW50byBhIGNsZWFuIFZlY3RvciByZWNvcmQsIHRoZW4gYXBwbHkgdGhlIGFwcC1sZXZlbCBub2lzZS9zZXZlcml0eVxuICogcnVsZXMuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGV2ZW50IHNob3VsZCBiZSBkcm9wcGVkIChwbGF0Zm9ybSBub2lzZSBvciBhIFwiZHJvcFwiIHJ1bGUgbWF0Y2gpLlxuICpcbiAqIGZ3MjQgbG9ncyBhcmUgdHNsb2cgSlNPTiBsaWtlIGB7XCIwXCI6XCJ0aGUgbWVzc2FnZVwiLFwiMVwiOnsuLi5hcmd9LFwiX21ldGFcIjp7XCJuYW1lXCI6XCJBUElDb25zdHJ1Y3RcIixcbiAqIFwibG9nTGV2ZWxOYW1lXCI6XCJJTkZPXCIsXCJkYXRlXCI6XCIuLi5cIn19YC4gV2UgbGlmdCB0aGUgcmVhbCBtZXNzYWdlIG91dCBvZiB0aGUgcG9zaXRpb25hbCBrZXlzIGFuZCB0aGVcbiAqIGNvbXBvbmVudC9sZXZlbC90aW1lIG91dCBvZiBgX21ldGFgLCBzbyBMb2d0cmFpbCBzaG93cyByZWFkYWJsZSBsaW5lcyBpbnN0ZWFkIG9mIGEgcmF3IEpTT04gYmxvYi5cbiAqIE5vbi1KU09OIGxpbmVzIChMYW1iZGEgU1RBUlQvRU5EL1JFUE9SVCwgcGxhaW4gdGV4dCkgcGFzcyB0aHJvdWdoIHVuY2hhbmdlZC5cbiAqL1xuZnVuY3Rpb24gdG9WZWN0b3JSZWNvcmQoXG5cdGU6IHsgdGltZXN0YW1wOiBudW1iZXI7IG1lc3NhZ2U6IHN0cmluZyB9LFxuXHRsb2dHcm91cDogc3RyaW5nLFxuXHRsb2dTdHJlYW06IHN0cmluZyxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB7XG5cdGNvbnN0IHJhdyA9IChlLm1lc3NhZ2UgPz8gJycpLnJlcGxhY2UoL1xccyskLywgJycpO1xuXG5cdC8vIOKUgOKUgCAxKSBEUk9QOiBMYW1iZGEgcGxhdGZvcm0gbGluZXMgdGhhdCBhcmUgcHVyZSBub2lzZS4g4pSA4pSAXG5cdGlmIChpc1BsYXRmb3JtTm9pc2UocmF3LnRyaW1TdGFydCgpKSkge1xuXHRcdHJldHVybiBudWxsO1xuXHR9XG5cblx0bGV0IG1lc3NhZ2UgPSByYXc7XG5cdGxldCBsZXZlbDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgbG9nZ2VyOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCByZXF1ZXN0SWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IHRzSXNvOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cblx0Ly8g4pSA4pSAIDEpIE5PUk1BTElaRTogcGVlbCBBV1MgTGFtYmRhJ3MgYOKAuWlzb+KAulxcdOKAuXJlcXVlc3RJZOKAulxcdOKAuUxFVkVM4oC6XFx04oC5bWVzc2FnZeKAumAgdGV4dCBwcmVmaXgsIGlmIHByZXNlbnQuXG5cdGNvbnN0IGxhbWJkYSA9IHBhcnNlTGFtYmRhUHJlZml4KHJhdyk7XG5cdGlmIChsYW1iZGEpIHtcblx0XHRyZXF1ZXN0SWQgPSBsYW1iZGEucmVxdWVzdElkO1xuXHRcdGxldmVsID0gbGFtYmRhLmxldmVsO1xuXHRcdG1lc3NhZ2UgPSBsYW1iZGEubWVzc2FnZTtcblx0fVxuXG5cdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IGlmIHRoZSByZW1haW5pbmcgbWVzc2FnZSBpcyBmdzI0IHRzbG9nIEpTT04sIGxpZnQgdGhlIHJlYWwgdGV4dCArIGNvbXBvbmVudC9sZXZlbC90aW1lLlxuXHRjb25zdCBib2R5ID0gbWVzc2FnZTtcblx0aWYgKGJvZHkuY2hhckNvZGVBdCgwKSA9PT0gMHg3YiAvKiB7ICovKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGNvbnN0IG8gPSBKU09OLnBhcnNlKGJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXHRcdFx0Y29uc3QgbWV0YSA9IG8uX21ldGEgYXMgeyBuYW1lPzogdW5rbm93bjsgbG9nTGV2ZWxOYW1lPzogdW5rbm93bjsgZGF0ZT86IHVua25vd24gfSB8IHVuZGVmaW5lZDtcblx0XHRcdGlmIChtZXRhICYmIHR5cGVvZiBtZXRhID09PSAnb2JqZWN0Jykge1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEubmFtZSA9PT0gJ3N0cmluZycpIGxvZ2dlciA9IG1ldGEubmFtZTtcblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLmxvZ0xldmVsTmFtZSA9PT0gJ3N0cmluZycpIGxldmVsID0gbWV0YS5sb2dMZXZlbE5hbWUudG9Mb3dlckNhc2UoKTtcblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLmRhdGUgPT09ICdzdHJpbmcnICYmICFOdW1iZXIuaXNOYU4oRGF0ZS5wYXJzZShtZXRhLmRhdGUpKSkge1xuXHRcdFx0XHRcdHRzSXNvID0gbmV3IERhdGUobWV0YS5kYXRlKS50b0lTT1N0cmluZygpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHQvLyBQb3NpdGlvbmFsIGFyZ3MgXCIwXCIuLlwiblwiIGhvbGQgdGhlIGxvZ2dlZCBtZXNzYWdlICsgcGFyYW1zLlxuXHRcdFx0Y29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG5cdFx0XHRmb3IgKGxldCBpID0gMDsgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIFN0cmluZyhpKSk7IGkrKykge1xuXHRcdFx0XHRjb25zdCB2ID0gb1tTdHJpbmcoaSldO1xuXHRcdFx0XHRwYXJ0cy5wdXNoKHR5cGVvZiB2ID09PSAnc3RyaW5nJyA/IHYgOiBKU09OLnN0cmluZ2lmeSh2KSk7XG5cdFx0XHR9XG5cdFx0XHRpZiAocGFydHMubGVuZ3RoID4gMCkgbWVzc2FnZSA9IHBhcnRzLmpvaW4oJyAnKTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vIG5vdCBKU09OIGFmdGVyIGFsbCDigJQga2VlcCB0aGUgKHByZWZpeC1zdHJpcHBlZCkgbWVzc2FnZVxuXHRcdH1cblx0fVxuXG5cdGNvbnN0IGNsZWFuTWVzc2FnZSA9IHN0cmlwQW5zaShtZXNzYWdlKTtcblx0bGV0IHJlc29sdmVkTGV2ZWwgPSBsZXZlbCA/PyBmYWxsYmFja0xldmVsKHJhdyk7XG5cdGxldCByZWNsYXNzaWZpZWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuXHQvLyDilIDilIAgTGF5ZXJzIDLigJM0OiBhcHAtbGV2ZWwgbm9pc2UgLyBzZXZlcml0eSBydWxlcywgYXBwbGllZCB0byB0aGUgbm9ybWFsaXplZCBtZXNzYWdlLiDilIDilIBcblx0aWYgKEhBU19OT0lTRV9SVUxFUykge1xuXHRcdC8vIDIpIFJFQ0xBU1NJRlk6IGJlbmlnbiBcImVycm9yc1wiIOKGkiB3YXJuIChvbmx5IGRvd25ncmFkZSwgbmV2ZXIgdXBncmFkZSkuXG5cdFx0aWYgKEVSUk9SSVNILmhhcyhyZXNvbHZlZExldmVsKSAmJiBhbnlNYXRjaChCRU5JR05fUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJlc29sdmVkTGV2ZWwgPSAnd2Fybic7XG5cdFx0XHRyZWNsYXNzaWZpZWQgPSAnYmVuaWduJztcblx0XHR9XG5cdFx0Ly8gMykgRFJPUDogbm9pc2UgcmVtb3ZlZCBlbnRpcmVseSAobmV2ZXIgc2hpcHBlZCDigJQgc2F2ZXMgaW5nZXN0IGJhbmR3aWR0aCBhdCB0aGUgc291cmNlKS5cblx0XHRpZiAoYW55TWF0Y2goRFJPUF9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmV0dXJuIG51bGw7XG5cdFx0fVxuXHRcdC8vIDQpIERPV05HUkFERTogbm9pc2Uga2VwdCBidXQgZGUtZW1waGFzaXNlZCB0byBkZWJ1Zy5cblx0XHRpZiAoYW55TWF0Y2goRE9XTkdSQURFX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXNvbHZlZExldmVsID0gJ2RlYnVnJztcblx0XHRcdHJlY2xhc3NpZmllZCA9ICdub2lzZSc7XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRzZXJ2aWNlOiBTRVJWSUNFLFxuXHRcdGVudjogRU5WLFxuXHRcdC4uLihSRVNPTFZFRF9BQ0NPVU5UID8geyBhY2NvdW50OiBSRVNPTFZFRF9BQ0NPVU5UIH0gOiB7fSksXG5cdFx0Li4uKFJFR0lPTiA/IHsgcmVnaW9uOiBSRUdJT04gfSA6IHt9KSxcblx0XHRob3N0OiBzaG9ydEhvc3QobG9nR3JvdXAsIGxvZ1N0cmVhbSksXG5cdFx0Li4uKGxvZ2dlciA/IHsgbG9nZ2VyIH0gOiB7fSksXG5cdFx0Li4uKHJlcXVlc3RJZCA/IHsgcmVxdWVzdElkIH0gOiB7fSksXG5cdFx0bGV2ZWw6IHJlc29sdmVkTGV2ZWwsXG5cdFx0Li4uKHJlY2xhc3NpZmllZCA/IHsgcmVjbGFzc2lmaWVkIH0gOiB7fSksXG5cdFx0bWVzc2FnZTogY2xlYW5NZXNzYWdlLFxuXHRcdHRpbWVzdGFtcDogdHNJc28gPz8gbmV3IERhdGUoZS50aW1lc3RhbXApLnRvSVNPU3RyaW5nKCksXG5cdFx0bG9nR3JvdXAsXG5cdFx0bG9nU3RyZWFtLFxuXHR9O1xufVxuXG4vKiogU3BsaXQgcHJlLXNlcmlhbGl6ZWQgbGluZXMgaW50byBzdWItYmF0Y2hlcyB1bmRlciBNQVhfQkFUQ0hfQllURVMgKHVuY29tcHJlc3NlZCkuICovXG5mdW5jdGlvbiBjaHVua0xpbmVzKGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZ1tdW10ge1xuXHRjb25zdCBjaHVua3M6IHN0cmluZ1tdW10gPSBbXTtcblx0bGV0IGN1cnJlbnQ6IHN0cmluZ1tdID0gW107XG5cdGxldCBzaXplID0gMDtcblx0Zm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG5cdFx0Y29uc3QgbGluZUJ5dGVzID0gQnVmZmVyLmJ5dGVMZW5ndGgobGluZSkgKyAxOyAvLyArMSBmb3IgdGhlIGRlbGltaXRlclxuXHRcdGlmIChjdXJyZW50Lmxlbmd0aCA+IDAgJiYgc2l6ZSArIGxpbmVCeXRlcyA+IE1BWF9CQVRDSF9CWVRFUykge1xuXHRcdFx0Y2h1bmtzLnB1c2goY3VycmVudCk7XG5cdFx0XHRjdXJyZW50ID0gW107XG5cdFx0XHRzaXplID0gMDtcblx0XHR9XG5cdFx0Y3VycmVudC5wdXNoKGxpbmUpO1xuXHRcdHNpemUgKz0gbGluZUJ5dGVzO1xuXHR9XG5cdGlmIChjdXJyZW50Lmxlbmd0aCA+IDApIHtcblx0XHRjaHVua3MucHVzaChjdXJyZW50KTtcblx0fVxuXHRyZXR1cm4gY2h1bmtzO1xufVxuXG5mdW5jdGlvbiBlbmNvZGVCb2R5KGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG5cdC8vIGxpbmVzIGFyZSBhbHJlYWR5IEpTT04gc3RyaW5nc1xuXHRyZXR1cm4gQkFUQ0hfRk9STUFUID09PSAnanNvbi1hcnJheScgPyBgWyR7bGluZXMuam9pbignLCcpfV1gIDogbGluZXMuam9pbignXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHBvc3QoZ3ppcHBlZDogQnVmZmVyKTogUHJvbWlzZTx2b2lkPiB7XG5cdHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0Y29uc3QgdXJsID0gbmV3IFVSTChJTkdFU1RfVVJMISk7XG5cdFx0Y29uc3QgaXNIdHRwcyA9IHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOic7XG5cdFx0Y29uc3QgbGliID0gaXNIdHRwcyA/IGh0dHBzIDogaHR0cDtcblx0XHRjb25zdCByZXEgPSBsaWIucmVxdWVzdChcblx0XHRcdHVybCxcblx0XHRcdHtcblx0XHRcdFx0bWV0aG9kOiAnUE9TVCcsXG5cdFx0XHRcdGFnZW50OiBpc0h0dHBzID8gaHR0cHNBZ2VudCA6IGh0dHBBZ2VudCxcblx0XHRcdFx0aGVhZGVyczoge1xuXHRcdFx0XHRcdCdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG5cdFx0XHRcdFx0J0NvbnRlbnQtRW5jb2RpbmcnOiAnZ3ppcCcsXG5cdFx0XHRcdFx0J0NvbnRlbnQtTGVuZ3RoJzogZ3ppcHBlZC5sZW5ndGgsXG5cdFx0XHRcdFx0Li4uKFhfQVBJX0tFWSA/IHsgJ3gtYXBpLWtleSc6IFhfQVBJX0tFWSB9IDoge30pLFxuXHRcdFx0XHR9LFxuXHRcdFx0fSxcblx0XHRcdChyZXMpID0+IHtcblx0XHRcdFx0cmVzLnJlc3VtZSgpOyAvLyBkcmFpbiBzbyB0aGUgc29ja2V0IGNhbiBiZSByZXVzZWRcblx0XHRcdFx0Y29uc3Qgc3RhdHVzID0gcmVzLnN0YXR1c0NvZGUgPz8gMDtcblx0XHRcdFx0aWYgKHN0YXR1cyA+PSAyMDAgJiYgc3RhdHVzIDwgMzAwKSB7XG5cdFx0XHRcdFx0cmVzb2x2ZSgpO1xuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlamVjdChuZXcgRXJyb3IoYGluZ2VzdCByZXNwb25kZWQgJHtzdGF0dXN9YCkpO1xuXHRcdFx0XHR9XG5cdFx0XHR9LFxuXHRcdCk7XG5cdFx0cmVxLm9uKCdlcnJvcicsIHJlamVjdCk7XG5cdFx0cmVxLnNldFRpbWVvdXQoUE9TVF9USU1FT1VUX01TLCAoKSA9PiByZXEuZGVzdHJveShuZXcgRXJyb3IoJ2luZ2VzdCB0aW1lb3V0JykpKTtcblx0XHRyZXEuZW5kKGd6aXBwZWQpO1xuXHR9KTtcbn1cblxuLyoqIFBPU1Qgb25lIGNodW5rIHdpdGggYSBzaW5nbGUgcmV0cnkuIFJldHVybnMgZmFsc2UgaWYgdGhlIGNodW5rIHdhcyBkcm9wcGVkIGFmdGVyIHJldHJpZXMuICovXG5hc3luYyBmdW5jdGlvbiBzaGlwV2l0aFJldHJ5KGd6aXBwZWQ6IEJ1ZmZlcik6IFByb21pc2U8Ym9vbGVhbj4ge1xuXHRmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8PSBNQVhfUkVUUklFUzsgYXR0ZW1wdCsrKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IHBvc3QoZ3ppcHBlZCk7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9IGNhdGNoIChlcnIpIHtcblx0XHRcdGlmIChhdHRlbXB0ID09PSBNQVhfUkVUUklFUykge1xuXHRcdFx0XHQvLyBTd2FsbG93IGFmdGVyIHJldHJpZXM6IGEgcGVyc2lzdGVudCBpbmdlc3Qgb3V0YWdlIG11c3Qgbm90IGNyZWF0ZSBhIENsb3VkV2F0Y2ggcmV0cnkgc3Rvcm0uXG5cdFx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBzaGlwIGZhaWxlZCwgZHJvcHBpbmcgY2h1bms6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vKiogRW1pdCBhbiBhbGFybWFibGUgQ2xvdWRXYXRjaCBtZXRyaWMgKEVNRikgd2hlbiByZWNvcmRzIGFyZSBkcm9wcGVkIOKAlCBubyBTREssIGp1c3Qgc3RydWN0dXJlZCBzdGRvdXQuICovXG5mdW5jdGlvbiBlbWl0RHJvcHBlZE1ldHJpYyhyZWNvcmRzOiBudW1iZXIpOiB2b2lkIHtcblx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0Y29uc29sZS5sb2coXG5cdFx0SlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0X2F3czoge1xuXHRcdFx0XHRUaW1lc3RhbXA6IERhdGUubm93KCksXG5cdFx0XHRcdENsb3VkV2F0Y2hNZXRyaWNzOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0TmFtZXNwYWNlOiAnTG9nRm9yd2FyZGVyJyxcblx0XHRcdFx0XHRcdERpbWVuc2lvbnM6IFsgWyAnc2VydmljZScgXSBdLFxuXHRcdFx0XHRcdFx0TWV0cmljczogWyB7IE5hbWU6ICdEcm9wcGVkUmVjb3JkcycsIFVuaXQ6ICdDb3VudCcgfSBdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cdFx0XHR9LFxuXHRcdFx0c2VydmljZTogU0VSVklDRSxcblx0XHRcdERyb3BwZWRSZWNvcmRzOiByZWNvcmRzLFxuXHRcdH0pLFxuXHQpO1xufVxuXG5pbnRlcmZhY2UgTGFtYmRhQ29udGV4dExpa2Uge1xuXHRpbnZva2VkRnVuY3Rpb25Bcm4/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBDbG91ZFdhdGNoTG9nc0V2ZW50LCBjb250ZXh0PzogTGFtYmRhQ29udGV4dExpa2UpOiBQcm9taXNlPHZvaWQ+ID0+IHtcblx0Ly8gUmVzb2x2ZSB0aGUgYWNjb3VudCBmcm9tIHRoaXMgZm9yd2FyZGVyJ3Mgb3duIEFSTiBvbmNlIChzYW1lIGZvciBldmVyeSBpbnZvY2F0aW9uKS5cblx0aWYgKCFSRVNPTFZFRF9BQ0NPVU5UICYmIGNvbnRleHQ/Lmludm9rZWRGdW5jdGlvbkFybikge1xuXHRcdFJFU09MVkVEX0FDQ09VTlQgPSBhY2NvdW50RnJvbUFybihjb250ZXh0Lmludm9rZWRGdW5jdGlvbkFybik7XG5cdH1cblx0aWYgKCFJTkdFU1RfVVJMKSB7XG5cdFx0cmV0dXJuOyAvLyBub3QgY29uZmlndXJlZCB5ZXQg4oCUIG5vLW9wIChzYWZlIHRvIGRlcGxveSBiZWZvcmUgd2lyaW5nIHRoZSBpbmdlc3QgVVJMKVxuXHR9XG5cblx0bGV0IHBheWxvYWQ6IERlY29kZWRQYXlsb2FkO1xuXHR0cnkge1xuXHRcdHBheWxvYWQgPSBKU09OLnBhcnNlKGd1bnppcFN5bmMoQnVmZmVyLmZyb20oZXZlbnQuYXdzbG9ncy5kYXRhLCAnYmFzZTY0JykpLnRvU3RyaW5nKCd1dGY4JykpIGFzIERlY29kZWRQYXlsb2FkO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBmYWlsZWQgdG8gZGVjb2RlIHBheWxvYWQ6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0aWYgKHBheWxvYWQubWVzc2FnZVR5cGUgPT09ICdDT05UUk9MX01FU1NBR0UnKSB7XG5cdFx0cmV0dXJuOyAvLyBzdWJzY3JpcHRpb24gbGl2ZW5lc3MgcGluZ1xuXHR9XG5cdGNvbnN0IGV2ZW50cyA9IHBheWxvYWQubG9nRXZlbnRzO1xuXHRpZiAoIUFycmF5LmlzQXJyYXkoZXZlbnRzKSB8fCBldmVudHMubGVuZ3RoID09PSAwKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG5cdGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcblx0XHRjb25zdCByZWNvcmQgPSB0b1ZlY3RvclJlY29yZChlLCBwYXlsb2FkLmxvZ0dyb3VwLCBwYXlsb2FkLmxvZ1N0cmVhbSk7XG5cdFx0aWYgKHJlY29yZCAhPT0gbnVsbCkge1xuXHRcdFx0bGluZXMucHVzaChKU09OLnN0cmluZ2lmeShyZWNvcmQpKTtcblx0XHR9XG5cdH1cblx0aWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkge1xuXHRcdHJldHVybjsgLy8gd2hvbGUgYmF0Y2ggd2FzIG5vaXNlIC8gZHJvcHBlZFxuXHR9XG5cdGxldCBkcm9wcGVkID0gMDtcblx0Zm9yIChjb25zdCBjaHVuayBvZiBjaHVua0xpbmVzKGxpbmVzKSkge1xuXHRcdGNvbnN0IGd6aXBwZWQgPSBnemlwU3luYyhCdWZmZXIuZnJvbShlbmNvZGVCb2R5KGNodW5rKSkpO1xuXHRcdGNvbnN0IG9rID0gYXdhaXQgc2hpcFdpdGhSZXRyeShnemlwcGVkKTtcblx0XHRpZiAoIW9rKSB7XG5cdFx0XHRkcm9wcGVkICs9IGNodW5rLmxlbmd0aDtcblx0XHR9XG5cdH1cblx0aWYgKGRyb3BwZWQgPiAwKSB7XG5cdFx0ZW1pdERyb3BwZWRNZXRyaWMoZHJvcHBlZCk7XG5cdH1cbn07XG4iXX0=