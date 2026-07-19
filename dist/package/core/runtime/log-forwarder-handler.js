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
 * Two more app-owned enrichments, both config-driven (the forwarder never guesses from free text):
 *   • FIELD LIFTING (`FORWARDER_FIELDS`) — promote app-declared structured fields (e.g. `correlationId`,
 *     `orderId`, `userId`) out of the tslog JSON args into queryable top-level record fields. This is
 *     what lets Logtrail follow one request across services, or filter "all logs for order 991".
 *   • VERSION (`FORWARDER_VERSION`) — stamp every line with the release that produced it, so behavior
 *     changes can be attributed to a deploy.
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
// ── App-declared field lifting (FORWARDER_FIELDS): a JSON array of field names the app wants promoted
//    from its structured tslog args to queryable top-level record fields (e.g. correlationId, orderId).
//    The app owns this list via the construct; the forwarder never scrapes free text for them. ──
function parseFieldList(rawJson) {
    if (!rawJson)
        return [];
    try {
        const arr = JSON.parse(rawJson);
        if (!Array.isArray(arr))
            return [];
        return [...new Set(arr.filter((s) => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()))];
    }
    catch {
        return [];
    }
}
const LIFT_SET = new Set(parseFieldList(process.env.FORWARDER_FIELDS));
const HAS_LIFT_FIELDS = LIFT_SET.size > 0;
// Release/version stamp so every shipped line is attributable to the deploy that produced it. Set by the
// construct at deploy time (semver or git sha); omitted from records when unset.
const VERSION = process.env.FORWARDER_VERSION?.trim() || '';
// Record keys the forwarder owns — a lifted app field must never overwrite one of these.
const RESERVED_FIELD_KEYS = new Set([
    'service', 'env', 'account', 'region', 'version', 'host', 'logger', 'requestId',
    'level', 'reclassified', 'message', 'timestamp', 'logGroup', 'logStream',
]);
/**
 * Lift the app-declared {@link LIFT_SET} fields out of a parsed tslog object into flat `{key: value}`
 * string pairs. Scans the object's own scalar keys AND one level into its positional-argument objects
 * ("0".."n"), so `logger.info('charge failed', { orderId, correlationId })` surfaces both. Reserved
 * record keys are never lifted; values are coerced to trimmed strings; first occurrence wins.
 */
function extractLiftedFields(o) {
    const out = {};
    const take = (k, v) => {
        if (out[k] !== undefined || RESERVED_FIELD_KEYS.has(k) || !LIFT_SET.has(k))
            return;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            const s = String(v).trim();
            if (s)
                out[k] = s;
        }
    };
    for (const [k, v] of Object.entries(o)) {
        if (k === '_meta')
            continue;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (const [k2, v2] of Object.entries(v))
                take(k2, v2);
        }
        else {
            take(k, v);
        }
    }
    return out;
}
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
    let lifted;
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
            // Lift app-declared structured fields (correlationId, orderId, …) into queryable record fields.
            if (HAS_LIFT_FIELDS) {
                const f = extractLiftedFields(o);
                if (Object.keys(f).length > 0)
                    lifted = f;
            }
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
        ...(VERSION ? { version: VERSION } : {}),
        host: shortHost(logGroup, logStream),
        ...(logger ? { logger } : {}),
        ...(requestId ? { requestId } : {}),
        ...(lifted ?? {}),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBZ0NHO0FBQ0gseUNBQWlEO0FBQ2pELGdEQUFrQztBQUNsQyxrREFBb0M7QUFDcEMsdUNBQStCO0FBRS9CLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDeEUscUdBQXFHO0FBQ3JHLGdHQUFnRztBQUNoRyxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDM0QsdUdBQXVHO0FBQ3ZHLHFHQUFxRztBQUNyRyxrRkFBa0Y7QUFDbEYsTUFBTSxPQUFPLEdBQUcsR0FBRyxJQUFJLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDbkYsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUVqRSxxR0FBcUc7QUFDckcsc0dBQXNHO0FBQ3RHLHFHQUFxRztBQUNyRyxzRkFBc0Y7QUFDdEYsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDO0FBQ3BELElBQUksZ0JBQWdCLEdBQUcs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RUFBRSxDQUFDO1FBQ25ELE9BQU87SUFDUixDQUFDO0lBRUQsTUFBTSxLQUFLLEdBQWEsRUFBRSxDQUFDO0lBQzNCLEtBQUssTUFBTSxDQUFDLElBQUksTUFBTSxFQUFFLENBQUM7UUFDeEIsTUFBTSxNQUFNLEdBQUcsY0FBYyxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN0RSxJQUFJLE1BQU0sS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUNyQixLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNwQyxDQUFDO0lBQ0YsQ0FBQztJQUNELElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN4QixPQUFPLENBQUMsa0NBQWtDO0lBQzNDLENBQUM7SUFDRCxJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUM7SUFDaEIsS0FBSyxNQUFNLEtBQUssSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN2QyxNQUFNLE9BQU8sR0FBRyxJQUFBLG9CQUFRLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3pELE1BQU0sRUFBRSxHQUFHLE1BQU0sYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3hDLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUNULE9BQU8sSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDO1FBQ3pCLENBQUM7SUFDRixDQUFDO0lBQ0QsSUFBSSxPQUFPLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakIsaUJBQWlCLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDNUIsQ0FBQztBQUNGLENBQUMsQ0FBQztBQS9DVyxRQUFBLE9BQU8sV0ErQ2xCIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDbG91ZFdhdGNoIExvZ3MgLT4gVmVjdG9yL0xvZ3RyYWlsIGZvcndhcmRlciAob3V0LW9mLWJhbmQgbG9nIHNoaXBwaW5nKS5cbiAqXG4gKiBBcHAgTGFtYmRhcyBvbmx5IHdyaXRlIHRvIHN0ZG91dCAoQ2xvdWRXYXRjaCkg4oCUIG5vdGhpbmcgcnVucyBpbiB0aGVpciByZXF1ZXN0IHBhdGguIEEgQ2xvdWRXYXRjaFxuICogTG9ncyBzdWJzY3JpcHRpb24gZmlsdGVyIHN0cmVhbXMgYmF0Y2hlZCwgZ3ppcHBlZCBldmVudHMgdG8gdGhpcyBmdW5jdGlvbiwgd2hpY2ggcmVzaGFwZXMgdGhlbSB0b1xuICogY2xlYW4gVmVjdG9yIEpTT04gcmVjb3JkcyBhbmQgc2hpcHMgdGhlbSB0byB0aGUgaW5nZXN0IGVuZHBvaW50IG92ZXIgYSBrZWVwLWFsaXZlIGNvbm5lY3Rpb24sXG4gKiBnemlwLWNvbXByZXNzZWQgYW5kIHNwbGl0IGludG8gYm91bmRlZCBzdWItYmF0Y2hlcy5cbiAqXG4gKiBQcm9jZXNzaW5nIHBpcGVsaW5lIHBlciBldmVudCAoc2VlIGBMb2dGb3J3YXJkZXJDb25zdHJ1Y3RgKTpcbiAqICAgMS4gTk9STUFMSVpFICDigJQgcGVlbCBBV1MgTGFtYmRhJ3MgdGV4dCBwcmVmaXgsIGxpZnQgZncyNCB0c2xvZyBKU09OLCBzdHJpcCBBTlNJLCBzaG9ydGVuIGhvc3QuXG4gKiAgIDIuIFJFQ0xBU1NJRlkg4oCUIGVycm9yLWlzaCBsaW5lcyBtYXRjaGluZyBhIFwiYmVuaWduXCIgcGF0dGVybiDihpIgYHdhcm5gIChgcmVjbGFzc2lmaWVkOiBcImJlbmlnblwiYCkuXG4gKiAgIDMuIERST1AgICAgICAg4oCUIGxpbmVzIG1hdGNoaW5nIGEgXCJkcm9wXCIgcGF0dGVybiBhcmUgcmVtb3ZlZCBlbnRpcmVseSAoc2F2ZWQgYmFuZHdpZHRoIGF0IHNvdXJjZSkuXG4gKiAgIDQuIERPV05HUkFERSAg4oCUIGxpbmVzIG1hdGNoaW5nIGEgXCJkb3duZ3JhZGVcIiBwYXR0ZXJuIOKGkiBgZGVidWdgIChgcmVjbGFzc2lmaWVkOiBcIm5vaXNlXCJgKS5cbiAqIFN0ZXBzIDLigJM0IGFyZSBhcHAtb3duZWQgcnVsZSBsaXN0cyAoZW52LWluamVjdGVkIGJ5IHRoZSBjb25zdHJ1Y3QpLCBjb21wbGVtZW50YXJ5IHRvIGFueSBnbG9iYWxcbiAqIHNldmVyaXR5L25vaXNlIGhhbmRsaW5nIGEgc2hhcmVkIFZlY3RvciBpbmdlc3QgbWF5IGFsc28gYXBwbHkuXG4gKlxuICogRXZlcnkgcmVjb3JkIGFsc28gY2FycmllcyBgYWNjb3VudGAgKyBgcmVnaW9uYCAoZnJvbSB0aGUgZm9yd2FyZGVyJ3Mgb3duIEFSTikgc28gZGVwbG95bWVudHMgdGhhdFxuICogc2hhcmUgYXBwICsgZW52IG5hbWVzIOKAlCBlLmcuIG11bHRpcGxlIGRldmVsb3BlcnMgZWFjaCBydW5uaW5nIGBwbHVzZmFuLXRyaWFsc2AgKEFQUF9FTlZJUk9OTUVOVD1sb2NhbClcbiAqIGluIHRoZWlyIE9XTiBhY2NvdW50IOKAlCBzdGF5IGRpc3Rpbmd1aXNoYWJsZSBpbnN0ZWFkIG9mIGNvbGxpZGluZyB1bmRlciBvbmUgYHNlcnZpY2VgIGxhYmVsLlxuICpcbiAqIFR3byBtb3JlIGFwcC1vd25lZCBlbnJpY2htZW50cywgYm90aCBjb25maWctZHJpdmVuICh0aGUgZm9yd2FyZGVyIG5ldmVyIGd1ZXNzZXMgZnJvbSBmcmVlIHRleHQpOlxuICogICDigKIgRklFTEQgTElGVElORyAoYEZPUldBUkRFUl9GSUVMRFNgKSDigJQgcHJvbW90ZSBhcHAtZGVjbGFyZWQgc3RydWN0dXJlZCBmaWVsZHMgKGUuZy4gYGNvcnJlbGF0aW9uSWRgLFxuICogICAgIGBvcmRlcklkYCwgYHVzZXJJZGApIG91dCBvZiB0aGUgdHNsb2cgSlNPTiBhcmdzIGludG8gcXVlcnlhYmxlIHRvcC1sZXZlbCByZWNvcmQgZmllbGRzLiBUaGlzIGlzXG4gKiAgICAgd2hhdCBsZXRzIExvZ3RyYWlsIGZvbGxvdyBvbmUgcmVxdWVzdCBhY3Jvc3Mgc2VydmljZXMsIG9yIGZpbHRlciBcImFsbCBsb2dzIGZvciBvcmRlciA5OTFcIi5cbiAqICAg4oCiIFZFUlNJT04gKGBGT1JXQVJERVJfVkVSU0lPTmApIOKAlCBzdGFtcCBldmVyeSBsaW5lIHdpdGggdGhlIHJlbGVhc2UgdGhhdCBwcm9kdWNlZCBpdCwgc28gYmVoYXZpb3JcbiAqICAgICBjaGFuZ2VzIGNhbiBiZSBhdHRyaWJ1dGVkIHRvIGEgZGVwbG95LlxuICpcbiAqIEVOViBOQU1FU1BBQ0U6IHRoaXMgZnVuY3Rpb24gcmVhZHMgT05MWSBgRk9SV0FSREVSXypgIGVudiB2YXJzIOKAlCBkZWxpYmVyYXRlbHkgTk9UIHRoZSBgTE9HVFJBSUxfKmBcbiAqIGtleXMgdXNlZCBieSBmdzI0J3MgaW4tcHJvY2VzcyBsb2cgdHJhbnNwb3J0LiBUaGF0IGd1YXJhbnRlZXMgdGhlIGZvcndhcmRlciBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoLFxuICogb3IgYWNjaWRlbnRhbGx5IGFjdGl2YXRlLCBmdzI0J3MgaW4tcHJvY2VzcyBMb2d0cmFpbCBtYWNoaW5lcnkuXG4gKlxuICogREVQRU5ERU5DWS1GUkVFIChub2RlIGJ1aWx0LWlucyBvbmx5KSBzbyB0aGUgZm9yd2FyZGVyIGJ1bmRsZSBzdGF5cyB0aW55IGFuZCBjaGVhcC5cbiAqL1xuaW1wb3J0IHsgZ3VuemlwU3luYywgZ3ppcFN5bmMgfSBmcm9tICdub2RlOnpsaWInO1xuaW1wb3J0ICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnO1xuaW1wb3J0ICogYXMgaHR0cHMgZnJvbSAnbm9kZTpodHRwcyc7XG5pbXBvcnQgeyBVUkwgfSBmcm9tICdub2RlOnVybCc7XG5cbmNvbnN0IElOR0VTVF9VUkwgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1VSTD8udHJpbSgpO1xuY29uc3QgQkFTRV9TRVJWSUNFID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX1NFUlZJQ0U/LnRyaW0oKSB8fCAndW5rbm93bic7XG4vLyBTdGFnZS9vd25lciBsYWJlbCAoZS5nLiBgZGV2ZWxvcGAsIGBwcm9kYCwgYHNhbmRib3gtbml0aW5gKSBzbyBkZXZlbG9wL3Byb2QvcGVyLWRldmVsb3BlciBsb2dzIGFyZVxuLy8gZGlzdGluZ3Vpc2hhYmxlIOKAlCB0aGVyZSBjYW4gYmUgc2V2ZXJhbCBkZXBsb3ltZW50cyBvZiBvbmUgc2VydmljZSBhY3Jvc3MgZW52cyBhbmQgZGV2ZWxvcGVycy5cbmNvbnN0IEVOViA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9FTlY/LnRyaW0oKSB8fCAndW5rbm93bic7XG4vLyBUaGUgYHNlcnZpY2VgIGxhYmVsIGlzIHdoYXQncyBwcm9tb3RlZCB0byBhIExva2kgbGFiZWwgKGFuZCBzaG93biBpbiBMb2d0cmFpbCksIHNvIGZvbGQgdGhlIGVudiBpbnRvXG4vLyBpdCDigJQgYHBsdXNmYW4tdHJpYWxzLWRldmVsb3BgLCBgcGx1c2Zhbi10cmlhbHMtc2FuZGJveC1uaXRpbmAsIOKApiDigJQgZ3VhcmFudGVlaW5nIGVhY2ggZGVwbG95bWVudCBpc1xuLy8gZGlzdGluY3QgYXQgYSBnbGFuY2UuIGBlbnZgIGlzIGFsc28gZW1pdHRlZCBhcyBhIHN0cnVjdHVyZWQgZmllbGQgZm9yIHF1ZXJ5aW5nLlxuY29uc3QgU0VSVklDRSA9IEVOViAmJiBFTlYgIT09ICd1bmtub3duJyA/IGAke0JBU0VfU0VSVklDRX0tJHtFTlZ9YCA6IEJBU0VfU0VSVklDRTtcbmNvbnN0IFhfQVBJX0tFWSA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZPy50cmltKCk7XG5cbi8vIEFXUyBhY2NvdW50ICsgcmVnaW9uIGRpc2FtYmlndWF0ZSBkZXBsb3ltZW50cyB0aGF0IHNoYXJlIGFwcCArIGVudiBuYW1lcyDigJQgZS5nLiBzZXZlcmFsIGRldmVsb3BlcnNcbi8vIGVhY2ggZGVwbG95aW5nIHRoZSBTQU1FIGFwcCAoYHBsdXNmYW4tdHJpYWxzYCwgQVBQX0VOVklST05NRU5UPWxvY2FsKSB0byB0aGVpciBPV04gYWNjb3VudC4gV2l0aG91dFxuLy8gdGhpcywgYWxsIHRoZWlyIGxvZ3Mgd291bGQgY29sbGlkZSB1bmRlciBvbmUgYHNlcnZpY2VgIGxhYmVsLiBSZWdpb24gaXMgc2V0IGJ5IHRoZSBMYW1iZGEgcnVudGltZTtcbi8vIGFjY291bnQgaXMgcGFyc2VkIGZyb20gdGhlIGludm9rZWQgZnVuY3Rpb24gQVJOIG9uIHRoZSBmaXJzdCBpbnZvY2F0aW9uIGFuZCBjYWNoZWQuXG5jb25zdCBSRUdJT04gPSBwcm9jZXNzLmVudi5BV1NfUkVHSU9OPy50cmltKCkgfHwgJyc7XG5sZXQgUkVTT0xWRURfQUNDT1VOVCA9ICcnO1xuZnVuY3Rpb24gYWNjb3VudEZyb21Bcm4oYXJuOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcge1xuXHQvLyBhcm46YXdzOmxhbWJkYTo8cmVnaW9uPjo8QUNDT1VOVD46ZnVuY3Rpb246PG5hbWU+XG5cdGNvbnN0IHBhcnRzID0gKGFybiB8fCAnJykuc3BsaXQoJzonKTtcblx0cmV0dXJuIHBhcnRzLmxlbmd0aCA+IDQgPyBwYXJ0c1s0XSA6ICcnO1xufVxuLy8gVGhlIGZ3MjQgTG9ndHJhaWwvVmVjdG9yIGluZ2VzdCBkZWNvZGVzIGEgSlNPTiBhcnJheSBpbnRvIGluZGl2aWR1YWwgZXZlbnRzIGFuZCBSRUpFQ1RTIE5ESlNPTiAoNDAwKSxcbi8vIHNvIGBqc29uLWFycmF5YCBpcyB0aGUgZGVmYXVsdC4gT3ZlcnJpZGUgdG8gYG5kanNvbmAgb25seSBmb3IgYW4gaW5nZXN0IGNvbmZpZ3VyZWQgd2l0aCBuZXdsaW5lIGZyYW1pbmcuXG5jb25zdCBCQVRDSF9GT1JNQVQgPSAocHJvY2Vzcy5lbnYuRk9SV0FSREVSX0JBVENIX0ZPUk1BVD8udHJpbSgpIHx8ICdqc29uLWFycmF5JykgYXMgJ25kanNvbicgfCAnanNvbi1hcnJheSc7XG4vKiogTWF4IHVuY29tcHJlc3NlZCBieXRlcyBwZXIgUE9TVCDigJQgYm91bmRzIHJlcXVlc3Qgc2l6ZSBzbyBhIGxhcmdlIENsb3VkV2F0Y2ggYmF0Y2ggY2FuJ3QgNDEzIHRoZSBpbmdlc3QuICovXG5jb25zdCBNQVhfQkFUQ0hfQllURVMgPSBOdW1iZXIocHJvY2Vzcy5lbnYuRk9SV0FSREVSX01BWF9CQVRDSF9CWVRFUykgfHwgMV8wMDBfMDAwO1xuY29uc3QgUE9TVF9USU1FT1VUX01TID0gTnVtYmVyKHByb2Nlc3MuZW52LkZPUldBUkRFUl9QT1NUX1RJTUVPVVRfTVMpIHx8IDUwMDA7XG5jb25zdCBNQVhfUkVUUklFUyA9IDE7XG5cbi8vIOKUgOKUgCBBcHAtbGV2ZWwgbm9pc2UgLyBzZXZlcml0eSBydWxlcyAobGF5ZXJzIDLigJM0KS4gRWFjaCBlbnYgdmFyIGlzIGEgSlNPTiBhcnJheSBvZiByZWdleCBzb3VyY2Vcbi8vICAgIHN0cmluZ3M7IGNvbXBpbGVkIGNhc2UtaW5zZW5zaXRpdmVseSBvbmNlLCBoZXJlLCBhdCBjb2xkIHN0YXJ0LiBFbXB0eS9tYWxmb3JtZWQg4oaSIG5vIHJ1bGVzLiDilIDilIBcbmZ1bmN0aW9uIGNvbXBpbGVSdWxlcyhyYXdKc29uOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBSZWdFeHBbXSB7XG5cdGlmICghcmF3SnNvbikgcmV0dXJuIFtdO1xuXHRsZXQgYXJyOiB1bmtub3duO1xuXHR0cnkge1xuXHRcdGFyciA9IEpTT04ucGFyc2UocmF3SnNvbik7XG5cdH0gY2F0Y2gge1xuXHRcdHJldHVybiBbXTtcblx0fVxuXHRpZiAoIUFycmF5LmlzQXJyYXkoYXJyKSkgcmV0dXJuIFtdO1xuXHRjb25zdCBvdXQ6IFJlZ0V4cFtdID0gW107XG5cdGZvciAoY29uc3Qgc3JjIG9mIGFycikge1xuXHRcdGlmICh0eXBlb2Ygc3JjICE9PSAnc3RyaW5nJyB8fCBzcmMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblx0XHR0cnkge1xuXHRcdFx0b3V0LnB1c2gobmV3IFJlZ0V4cChzcmMsICdpJykpO1xuXHRcdH0gY2F0Y2gge1xuXHRcdFx0Ly8gQSBiYWQgcGF0dGVybiBtdXN0IG5ldmVyIGJyZWFrIHRoZSBmb3J3YXJkZXIg4oCUIHNraXAgaXQuXG5cdFx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdFx0Y29uc29sZS53YXJuKCdbbG9nLWZvcndhcmRlcl0gaWdub3JpbmcgaW52YWxpZCBub2lzZSBwYXR0ZXJuOicsIHNyYyk7XG5cdFx0fVxuXHR9XG5cdHJldHVybiBvdXQ7XG59XG5cbmNvbnN0IEJFTklHTl9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfQkVOSUdOKTtcbmNvbnN0IERST1BfUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0RST1ApO1xuY29uc3QgRE9XTkdSQURFX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9ET1dOR1JBREUpO1xuY29uc3QgSEFTX05PSVNFX1JVTEVTID0gQkVOSUdOX1JVTEVTLmxlbmd0aCA+IDAgfHwgRFJPUF9SVUxFUy5sZW5ndGggPiAwIHx8IERPV05HUkFERV9SVUxFUy5sZW5ndGggPiAwO1xuXG4vLyDilIDilIAgQXBwLWRlY2xhcmVkIGZpZWxkIGxpZnRpbmcgKEZPUldBUkRFUl9GSUVMRFMpOiBhIEpTT04gYXJyYXkgb2YgZmllbGQgbmFtZXMgdGhlIGFwcCB3YW50cyBwcm9tb3RlZFxuLy8gICAgZnJvbSBpdHMgc3RydWN0dXJlZCB0c2xvZyBhcmdzIHRvIHF1ZXJ5YWJsZSB0b3AtbGV2ZWwgcmVjb3JkIGZpZWxkcyAoZS5nLiBjb3JyZWxhdGlvbklkLCBvcmRlcklkKS5cbi8vICAgIFRoZSBhcHAgb3ducyB0aGlzIGxpc3QgdmlhIHRoZSBjb25zdHJ1Y3Q7IHRoZSBmb3J3YXJkZXIgbmV2ZXIgc2NyYXBlcyBmcmVlIHRleHQgZm9yIHRoZW0uIOKUgOKUgFxuZnVuY3Rpb24gcGFyc2VGaWVsZExpc3QocmF3SnNvbjogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nW10ge1xuXHRpZiAoIXJhd0pzb24pIHJldHVybiBbXTtcblx0dHJ5IHtcblx0XHRjb25zdCBhcnIgPSBKU09OLnBhcnNlKHJhd0pzb24pO1xuXHRcdGlmICghQXJyYXkuaXNBcnJheShhcnIpKSByZXR1cm4gW107XG5cdFx0cmV0dXJuIFsgLi4ubmV3IFNldChhcnIuZmlsdGVyKChzKTogcyBpcyBzdHJpbmcgPT4gdHlwZW9mIHMgPT09ICdzdHJpbmcnICYmIHMudHJpbSgpLmxlbmd0aCA+IDApLm1hcCgocykgPT4gcy50cmltKCkpKSBdO1xuXHR9IGNhdGNoIHtcblx0XHRyZXR1cm4gW107XG5cdH1cbn1cbmNvbnN0IExJRlRfU0VUID0gbmV3IFNldChwYXJzZUZpZWxkTGlzdChwcm9jZXNzLmVudi5GT1JXQVJERVJfRklFTERTKSk7XG5jb25zdCBIQVNfTElGVF9GSUVMRFMgPSBMSUZUX1NFVC5zaXplID4gMDtcblxuLy8gUmVsZWFzZS92ZXJzaW9uIHN0YW1wIHNvIGV2ZXJ5IHNoaXBwZWQgbGluZSBpcyBhdHRyaWJ1dGFibGUgdG8gdGhlIGRlcGxveSB0aGF0IHByb2R1Y2VkIGl0LiBTZXQgYnkgdGhlXG4vLyBjb25zdHJ1Y3QgYXQgZGVwbG95IHRpbWUgKHNlbXZlciBvciBnaXQgc2hhKTsgb21pdHRlZCBmcm9tIHJlY29yZHMgd2hlbiB1bnNldC5cbmNvbnN0IFZFUlNJT04gPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfVkVSU0lPTj8udHJpbSgpIHx8ICcnO1xuXG4vLyBSZWNvcmQga2V5cyB0aGUgZm9yd2FyZGVyIG93bnMg4oCUIGEgbGlmdGVkIGFwcCBmaWVsZCBtdXN0IG5ldmVyIG92ZXJ3cml0ZSBvbmUgb2YgdGhlc2UuXG5jb25zdCBSRVNFUlZFRF9GSUVMRF9LRVlTID0gbmV3IFNldChbXG5cdCdzZXJ2aWNlJywgJ2VudicsICdhY2NvdW50JywgJ3JlZ2lvbicsICd2ZXJzaW9uJywgJ2hvc3QnLCAnbG9nZ2VyJywgJ3JlcXVlc3RJZCcsXG5cdCdsZXZlbCcsICdyZWNsYXNzaWZpZWQnLCAnbWVzc2FnZScsICd0aW1lc3RhbXAnLCAnbG9nR3JvdXAnLCAnbG9nU3RyZWFtJyxcbl0pO1xuXG4vKipcbiAqIExpZnQgdGhlIGFwcC1kZWNsYXJlZCB7QGxpbmsgTElGVF9TRVR9IGZpZWxkcyBvdXQgb2YgYSBwYXJzZWQgdHNsb2cgb2JqZWN0IGludG8gZmxhdCBge2tleTogdmFsdWV9YFxuICogc3RyaW5nIHBhaXJzLiBTY2FucyB0aGUgb2JqZWN0J3Mgb3duIHNjYWxhciBrZXlzIEFORCBvbmUgbGV2ZWwgaW50byBpdHMgcG9zaXRpb25hbC1hcmd1bWVudCBvYmplY3RzXG4gKiAoXCIwXCIuLlwiblwiKSwgc28gYGxvZ2dlci5pbmZvKCdjaGFyZ2UgZmFpbGVkJywgeyBvcmRlcklkLCBjb3JyZWxhdGlvbklkIH0pYCBzdXJmYWNlcyBib3RoLiBSZXNlcnZlZFxuICogcmVjb3JkIGtleXMgYXJlIG5ldmVyIGxpZnRlZDsgdmFsdWVzIGFyZSBjb2VyY2VkIHRvIHRyaW1tZWQgc3RyaW5nczsgZmlyc3Qgb2NjdXJyZW5jZSB3aW5zLlxuICovXG5mdW5jdGlvbiBleHRyYWN0TGlmdGVkRmllbGRzKG86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG5cdGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXHRjb25zdCB0YWtlID0gKGs6IHN0cmluZywgdjogdW5rbm93bik6IHZvaWQgPT4ge1xuXHRcdGlmIChvdXRba10gIT09IHVuZGVmaW5lZCB8fCBSRVNFUlZFRF9GSUVMRF9LRVlTLmhhcyhrKSB8fCAhTElGVF9TRVQuaGFzKGspKSByZXR1cm47XG5cdFx0aWYgKHR5cGVvZiB2ID09PSAnc3RyaW5nJyB8fCB0eXBlb2YgdiA9PT0gJ251bWJlcicgfHwgdHlwZW9mIHYgPT09ICdib29sZWFuJykge1xuXHRcdFx0Y29uc3QgcyA9IFN0cmluZyh2KS50cmltKCk7XG5cdFx0XHRpZiAocykgb3V0W2tdID0gcztcblx0XHR9XG5cdH07XG5cdGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMobykpIHtcblx0XHRpZiAoayA9PT0gJ19tZXRhJykgY29udGludWU7XG5cdFx0aWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHYpKSB7XG5cdFx0XHRmb3IgKGNvbnN0IFsgazIsIHYyIF0gb2YgT2JqZWN0LmVudHJpZXModiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHRha2UoazIsIHYyKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0dGFrZShrLCB2KTtcblx0XHR9XG5cdH1cblx0cmV0dXJuIG91dDtcbn1cblxuLy8gTGV2ZWxzIHRoYXQgY291bnQgYXMgXCJlcnJvci1pc2hcIiBmb3IgdGhlIGJlbmlnbiBkb3duZ3JhZGUgKG1pcnJvcnMgdGhlIFZlY3RvciBBMSBsaXN0KS5cbmNvbnN0IEVSUk9SSVNIID0gbmV3IFNldChbICdlcnJvcicsICdlcnInLCAnZmF0YWwnLCAnY3JpdGljYWwnLCAnY3JpdCcsICdlbWVyZycsICdhbGVydCcsICdwYW5pYycgXSk7XG5mdW5jdGlvbiBhbnlNYXRjaChydWxlczogUmVnRXhwW10sIG1zZzogc3RyaW5nKTogYm9vbGVhbiB7XG5cdGZvciAoY29uc3QgcmUgb2YgcnVsZXMpIHtcblx0XHRpZiAocmUudGVzdChtc2cpKSByZXR1cm4gdHJ1ZTtcblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8vIFJldXNlZCBhY3Jvc3Mgd2FybSBpbnZvY2F0aW9ucyBzbyB3ZSBkb24ndCBwYXkgVENQL1RMUyBzZXR1cCBwZXIgYmF0Y2guXG5jb25zdCBodHRwQWdlbnQgPSBuZXcgaHR0cC5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSwgbWF4U29ja2V0czogMTYgfSk7XG5jb25zdCBodHRwc0FnZW50ID0gbmV3IGh0dHBzLkFnZW50KHsga2VlcEFsaXZlOiB0cnVlLCBtYXhTb2NrZXRzOiAxNiB9KTtcblxuaW50ZXJmYWNlIENsb3VkV2F0Y2hMb2dzRXZlbnQge1xuXHRhd3Nsb2dzOiB7IGRhdGE6IHN0cmluZyB9O1xufVxuXG5pbnRlcmZhY2UgRGVjb2RlZFBheWxvYWQge1xuXHRtZXNzYWdlVHlwZTogc3RyaW5nO1xuXHRsb2dHcm91cDogc3RyaW5nO1xuXHRsb2dTdHJlYW06IHN0cmluZztcblx0bG9nRXZlbnRzOiBBcnJheTx7IGlkOiBzdHJpbmc7IHRpbWVzdGFtcDogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfT47XG59XG5cbi8vIExhbWJkYSBwbGF0Zm9ybSBsaW5lcyB0aGF0IGFyZSBwdXJlIG5vaXNlLiBSRVBPUlQgaXMga2VwdCBieSBkZWZhdWx0IChjYXJyaWVzIGR1cmF0aW9uL21lbW9yeSk7XG4vLyBzZXQgRk9SV0FSREVSX0RST1BfUkVQT1JUPXRydWUgdG8gZHJvcCBpdCB0b28uXG5jb25zdCBEUk9QX1JFUE9SVCA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9EUk9QX1JFUE9SVD8udHJpbSgpID09PSAndHJ1ZSc7XG5mdW5jdGlvbiBpc1BsYXRmb3JtTm9pc2UocmF3OiBzdHJpbmcpOiBib29sZWFuIHtcblx0aWYgKHJhdy5zdGFydHNXaXRoKCdTVEFSVCBSZXF1ZXN0SWQnKSB8fCByYXcuc3RhcnRzV2l0aCgnRU5EIFJlcXVlc3RJZCcpIHx8IHJhdy5zdGFydHNXaXRoKCdJTklUX1NUQVJUJykpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXHRpZiAoRFJPUF9SRVBPUlQgJiYgcmF3LnN0YXJ0c1dpdGgoJ1JFUE9SVCBSZXF1ZXN0SWQnKSkge1xuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLy8gZncyNCdzIHRzbG9nIGNvbG9yaXplcyBvdXRwdXQgd2l0aCBBTlNJIFNHUiBjb2RlcyAoZS5nLiBFU0NbMzJtIOKApiBFU0NbMzltKSB3aGljaCBvdGhlcndpc2Ugc2hpcCBhc1xuLy8gbGl0ZXJhbCBgWzMybWAgbm9pc2UgaW4gTG9ndHJhaWwuIFN0cmlwIGFsbCBBTlNJIGVzY2FwZSBzZXF1ZW5jZXMgZnJvbSBzaGlwcGVkIHRleHQuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29udHJvbC1yZWdleFxuY29uc3QgQU5TSV9SRSA9IC9cXHgxYlxcW1swLTk7XSpbQS1aYS16XS9nO1xuZnVuY3Rpb24gc3RyaXBBbnNpKHM6IHN0cmluZyk6IHN0cmluZyB7XG5cdHJldHVybiBzLmluY2x1ZGVzKCdcXHgxYicpID8gcy5yZXBsYWNlKEFOU0lfUkUsICcnKSA6IHM7XG59XG5cbmZ1bmN0aW9uIGZhbGxiYWNrTGV2ZWwocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuXHRpZiAoL1xcYig/OkVSUk9SfEZBVEFMKVxcYi8udGVzdChyYXcpKSByZXR1cm4gJ2Vycm9yJztcblx0aWYgKC9cXGJXQVJOKD86SU5HKT9cXGIvLnRlc3QocmF3KSkgcmV0dXJuICd3YXJuJztcblx0cmV0dXJuICdpbmZvJztcbn1cblxuY29uc3QgS05PV05fTEVWRUxTID0gbmV3IFNldChbICd0cmFjZScsICdkZWJ1ZycsICdpbmZvJywgJ3dhcm4nLCAnd2FybmluZycsICdlcnJvcicsICdmYXRhbCcgXSk7XG5jb25zdCBJU09fUkUgPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9LztcblxuLyoqXG4gKiBBV1MgTGFtYmRhIGVtaXRzIHRleHQgbG9ncyBhcyBg4oC5aXNv4oC6XFx04oC5cmVxdWVzdElk4oC6XFx04oC5TEVWRUzigLpcXHTigLltZXNzYWdl4oC6YC4gUGVlbCB0aGF0IHByZWZpeCBvZmYgc28gdGhlXG4gKiBtZXNzYWdlIGlzIGp1c3QgdGhlIHRleHQsIGFuZCBsaWZ0IHJlcXVlc3RJZC9sZXZlbCBvdXQgYXMgZmllbGRzICh0aGV5J3JlIGFscmVhZHkgc2hvd24gYXMgY29sdW1ucykuXG4gKiBSZXR1cm5zIG51bGwgaWYgdGhlIGxpbmUgaXNuJ3QgaW4gdGhhdCBmb3JtYXQuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlTGFtYmRhUHJlZml4KHJhdzogc3RyaW5nKTogeyByZXF1ZXN0SWQ6IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgbWVzc2FnZTogc3RyaW5nIH0gfCBudWxsIHtcblx0Y29uc3QgcGFydHMgPSByYXcuc3BsaXQoJ1xcdCcpO1xuXHRpZiAocGFydHMubGVuZ3RoIDwgNCkgcmV0dXJuIG51bGw7XG5cdGNvbnN0IFsgdHMsIHJlcXVlc3RJZCwgbHZsLCAuLi5yZXN0IF0gPSBwYXJ0cztcblx0aWYgKCFJU09fUkUudGVzdCh0cykgfHwgIUtOT1dOX0xFVkVMUy5oYXMobHZsLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgcmV0dXJuIG51bGw7XG5cdHJldHVybiB7IHJlcXVlc3RJZCwgbGV2ZWw6IGx2bC50cmltKCkudG9Mb3dlckNhc2UoKSwgbWVzc2FnZTogcmVzdC5qb2luKCdcXHQnKS50cmltKCkgfTtcbn1cblxuLyoqXG4gKiBUdXJuIGEgdmVyYm9zZSBDbG91ZFdhdGNoIGxvZy1ncm91cCAvIGxvZy1zdHJlYW0gaW50byBhIHNob3J0IGZ1bmN0aW9uIG5hbWUgZm9yIHRoZSBgaG9zdGAgbGFiZWwsXG4gKiBlLmcuIGDigKYtcGx1c2ZhbnRyaWFsc3N0cmVhbXByb2Nlc3NvcuKApkxvZ0dyb3Vw4oCmYCDihpIgYHBsdXNmYW50cmlhbHNzdHJlYW1wcm9jZXNzb3JgLiBGYWxscyBiYWNrIHRvIHRoZVxuICogcmF3IGxvZyBncm91cC4gVGhlIGZ1bGwgbG9nIGdyb3VwIGlzIHN0aWxsIGVtaXR0ZWQgc2VwYXJhdGVseSBhcyBgbG9nR3JvdXBgLlxuICovXG5mdW5jdGlvbiBzaG9ydEhvc3QobG9nR3JvdXA6IHN0cmluZywgbG9nU3RyZWFtOiBzdHJpbmcpOiBzdHJpbmcge1xuXHQvLyBMYW1iZGEgbG9nIHN0cmVhbTogXCJZWVlZL01NL0RELzxmdW5jdGlvbk5hbWU+WyRMQVRFU1RdPGlkPlwiIOKAlCB0aGUgY2xlYW5lc3Qgc291cmNlIG9mIHRoZSBmbiBuYW1lLlxuXHRjb25zdCBzbSA9IGxvZ1N0cmVhbS5tYXRjaCgvXlxcZHs0fVxcL1xcZHsyfVxcL1xcZHsyfVxcLyguKz8pXFxbXFwkTEFURVNUXFxdLyk7XG5cdGlmIChzbSAmJiBzbVsxXSkge1xuXHRcdHJldHVybiBzbVsxXS5yZXBsYWNlKC8tW0EtWmEtejAtOV17Nix9JC8sICcnKTsgLy8gZHJvcCB0aGUgQ2xvdWRGb3JtYXRpb24gcmFuZG9tIHN1ZmZpeFxuXHR9XG5cdC8vIEZhbGxiYWNrOiBwYXJzZSB0aGUgbG9nIGdyb3VwIOKAlCBzdHJpcCB0aGUgYOKApkxvZ0dyb3VwPGhhc2g+LTxzdWZmaXg+YCB0YWlsLCB0YWtlIHRoZSBsYXN0IHNlZ21lbnQsXG5cdC8vIGFuZCBkZS1kdXBsaWNhdGUgQ0RLJ3MgZG91YmxlZCBjb25zdHJ1Y3QgbmFtZSAoYGZvb0JhcmZvb0JhcmAg4oaSIGBmb29CYXJgKS5cblx0bGV0IHMgPSBsb2dHcm91cDtcblx0Y29uc3QgbGcgPSBzLmluZGV4T2YoJ0xvZ0dyb3VwJyk7XG5cdGlmIChsZyA+IDApIHMgPSBzLnNsaWNlKDAsIGxnKTtcblx0Y29uc3QgbSA9IHMubWF0Y2goLyg/OnN0YWNrLXxOZXN0ZWRTdGFja1Jlc291cmNlWzAtOUEtRmEtZl0qLSkoW14tXSspJC8pO1xuXHRpZiAobSkgcyA9IG1bMV07XG5cdGlmIChzLmxlbmd0aCA+IDAgJiYgcy5sZW5ndGggJSAyID09PSAwKSB7XG5cdFx0Y29uc3QgaGFsZiA9IHMubGVuZ3RoIC8gMjtcblx0XHRpZiAocy5zbGljZSgwLCBoYWxmKSA9PT0gcy5zbGljZShoYWxmKSkgcyA9IHMuc2xpY2UoMCwgaGFsZik7XG5cdH1cblx0cmV0dXJuIHMgfHwgbG9nR3JvdXA7XG59XG5cbi8qKlxuICogUmVzaGFwZSBvbmUgQ2xvdWRXYXRjaCBsb2cgZXZlbnQgaW50byBhIGNsZWFuIFZlY3RvciByZWNvcmQsIHRoZW4gYXBwbHkgdGhlIGFwcC1sZXZlbCBub2lzZS9zZXZlcml0eVxuICogcnVsZXMuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGV2ZW50IHNob3VsZCBiZSBkcm9wcGVkIChwbGF0Zm9ybSBub2lzZSBvciBhIFwiZHJvcFwiIHJ1bGUgbWF0Y2gpLlxuICpcbiAqIGZ3MjQgbG9ncyBhcmUgdHNsb2cgSlNPTiBsaWtlIGB7XCIwXCI6XCJ0aGUgbWVzc2FnZVwiLFwiMVwiOnsuLi5hcmd9LFwiX21ldGFcIjp7XCJuYW1lXCI6XCJBUElDb25zdHJ1Y3RcIixcbiAqIFwibG9nTGV2ZWxOYW1lXCI6XCJJTkZPXCIsXCJkYXRlXCI6XCIuLi5cIn19YC4gV2UgbGlmdCB0aGUgcmVhbCBtZXNzYWdlIG91dCBvZiB0aGUgcG9zaXRpb25hbCBrZXlzIGFuZCB0aGVcbiAqIGNvbXBvbmVudC9sZXZlbC90aW1lIG91dCBvZiBgX21ldGFgLCBzbyBMb2d0cmFpbCBzaG93cyByZWFkYWJsZSBsaW5lcyBpbnN0ZWFkIG9mIGEgcmF3IEpTT04gYmxvYi5cbiAqIE5vbi1KU09OIGxpbmVzIChMYW1iZGEgU1RBUlQvRU5EL1JFUE9SVCwgcGxhaW4gdGV4dCkgcGFzcyB0aHJvdWdoIHVuY2hhbmdlZC5cbiAqL1xuZnVuY3Rpb24gdG9WZWN0b3JSZWNvcmQoXG5cdGU6IHsgdGltZXN0YW1wOiBudW1iZXI7IG1lc3NhZ2U6IHN0cmluZyB9LFxuXHRsb2dHcm91cDogc3RyaW5nLFxuXHRsb2dTdHJlYW06IHN0cmluZyxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB7XG5cdGNvbnN0IHJhdyA9IChlLm1lc3NhZ2UgPz8gJycpLnJlcGxhY2UoL1xccyskLywgJycpO1xuXG5cdC8vIOKUgOKUgCAxKSBEUk9QOiBMYW1iZGEgcGxhdGZvcm0gbGluZXMgdGhhdCBhcmUgcHVyZSBub2lzZS4g4pSA4pSAXG5cdGlmIChpc1BsYXRmb3JtTm9pc2UocmF3LnRyaW1TdGFydCgpKSkge1xuXHRcdHJldHVybiBudWxsO1xuXHR9XG5cblx0bGV0IG1lc3NhZ2UgPSByYXc7XG5cdGxldCBsZXZlbDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgbG9nZ2VyOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCByZXF1ZXN0SWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGNvcnJlbGF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IHRzSXNvOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBsaWZ0ZWQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQ7XG5cblx0Ly8g4pSA4pSAIDEpIE5PUk1BTElaRTogcGVlbCBBV1MgTGFtYmRhJ3MgYOKAuWlzb+KAulxcdOKAuXJlcXVlc3RJZOKAulxcdOKAuUxFVkVM4oC6XFx04oC5bWVzc2FnZeKAumAgdGV4dCBwcmVmaXgsIGlmIHByZXNlbnQuXG5cdGNvbnN0IGxhbWJkYSA9IHBhcnNlTGFtYmRhUHJlZml4KHJhdyk7XG5cdGlmIChsYW1iZGEpIHtcblx0XHRyZXF1ZXN0SWQgPSBsYW1iZGEucmVxdWVzdElkO1xuXHRcdGxldmVsID0gbGFtYmRhLmxldmVsO1xuXHRcdG1lc3NhZ2UgPSBsYW1iZGEubWVzc2FnZTtcblx0fVxuXG5cdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IGlmIHRoZSByZW1haW5pbmcgbWVzc2FnZSBpcyBmdzI0IHRzbG9nIEpTT04sIGxpZnQgdGhlIHJlYWwgdGV4dCArIGNvbXBvbmVudC9sZXZlbC90aW1lLlxuXHRjb25zdCBib2R5ID0gbWVzc2FnZTtcblx0aWYgKGJvZHkuY2hhckNvZGVBdCgwKSA9PT0gMHg3YiAvKiB7ICovKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGNvbnN0IG8gPSBKU09OLnBhcnNlKGJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXHRcdFx0Y29uc3QgbWV0YSA9IG8uX21ldGEgYXMgeyBuYW1lPzogdW5rbm93bjsgbG9nTGV2ZWxOYW1lPzogdW5rbm93bjsgZGF0ZT86IHVua25vd247IGNvcnJlbGF0aW9uSWQ/OiB1bmtub3duIH0gfCB1bmRlZmluZWQ7XG5cdFx0XHRpZiAobWV0YSAmJiB0eXBlb2YgbWV0YSA9PT0gJ29iamVjdCcpIHtcblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLm5hbWUgPT09ICdzdHJpbmcnKSBsb2dnZXIgPSBtZXRhLm5hbWU7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5sb2dMZXZlbE5hbWUgPT09ICdzdHJpbmcnKSBsZXZlbCA9IG1ldGEubG9nTGV2ZWxOYW1lLnRvTG93ZXJDYXNlKCk7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5kYXRlID09PSAnc3RyaW5nJyAmJiAhTnVtYmVyLmlzTmFOKERhdGUucGFyc2UobWV0YS5kYXRlKSkpIHtcblx0XHRcdFx0XHR0c0lzbyA9IG5ldyBEYXRlKG1ldGEuZGF0ZSkudG9JU09TdHJpbmcoKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgbWV0YS5jb3JyZWxhdGlvbklkLnRyaW0oKSkgY29ycmVsYXRpb25JZCA9IG1ldGEuY29ycmVsYXRpb25JZC50cmltKCk7XG5cdFx0XHR9XG5cdFx0XHQvLyBQb3NpdGlvbmFsIGFyZ3MgXCIwXCIuLlwiblwiIGhvbGQgdGhlIGxvZ2dlZCBtZXNzYWdlICsgcGFyYW1zLlxuXHRcdFx0Y29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG5cdFx0XHRmb3IgKGxldCBpID0gMDsgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIFN0cmluZyhpKSk7IGkrKykge1xuXHRcdFx0XHRjb25zdCB2ID0gb1tTdHJpbmcoaSldO1xuXHRcdFx0XHRwYXJ0cy5wdXNoKHR5cGVvZiB2ID09PSAnc3RyaW5nJyA/IHYgOiBKU09OLnN0cmluZ2lmeSh2KSk7XG5cdFx0XHR9XG5cdFx0XHRpZiAocGFydHMubGVuZ3RoID4gMCkgbWVzc2FnZSA9IHBhcnRzLmpvaW4oJyAnKTtcblxuXHRcdFx0Ly8gTGlmdCBhcHAtZGVjbGFyZWQgc3RydWN0dXJlZCBmaWVsZHMgKGNvcnJlbGF0aW9uSWQsIG9yZGVySWQsIOKApikgaW50byBxdWVyeWFibGUgcmVjb3JkIGZpZWxkcy5cblx0XHRcdGlmIChIQVNfTElGVF9GSUVMRFMpIHtcblx0XHRcdFx0Y29uc3QgZiA9IGV4dHJhY3RMaWZ0ZWRGaWVsZHMobyk7XG5cdFx0XHRcdGlmIChPYmplY3Qua2V5cyhmKS5sZW5ndGggPiAwKSBsaWZ0ZWQgPSBmO1xuXHRcdFx0fVxuXHRcdH0gY2F0Y2gge1xuXHRcdFx0Ly8gbm90IEpTT04gYWZ0ZXIgYWxsIOKAlCBrZWVwIHRoZSAocHJlZml4LXN0cmlwcGVkKSBtZXNzYWdlXG5cdFx0fVxuXHR9XG5cblx0Y29uc3QgY2xlYW5NZXNzYWdlID0gc3RyaXBBbnNpKG1lc3NhZ2UpO1xuXHRsZXQgcmVzb2x2ZWRMZXZlbCA9IGxldmVsID8/IGZhbGxiYWNrTGV2ZWwocmF3KTtcblx0bGV0IHJlY2xhc3NpZmllZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG5cdC8vIOKUgOKUgCBMYXllcnMgMuKAkzQ6IGFwcC1sZXZlbCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzLCBhcHBsaWVkIHRvIHRoZSBub3JtYWxpemVkIG1lc3NhZ2UuIOKUgOKUgFxuXHRpZiAoSEFTX05PSVNFX1JVTEVTKSB7XG5cdFx0Ly8gMikgUkVDTEFTU0lGWTogYmVuaWduIFwiZXJyb3JzXCIg4oaSIHdhcm4gKG9ubHkgZG93bmdyYWRlLCBuZXZlciB1cGdyYWRlKS5cblx0XHRpZiAoRVJST1JJU0guaGFzKHJlc29sdmVkTGV2ZWwpICYmIGFueU1hdGNoKEJFTklHTl9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmVzb2x2ZWRMZXZlbCA9ICd3YXJuJztcblx0XHRcdHJlY2xhc3NpZmllZCA9ICdiZW5pZ24nO1xuXHRcdH1cblx0XHQvLyAzKSBEUk9QOiBub2lzZSByZW1vdmVkIGVudGlyZWx5IChuZXZlciBzaGlwcGVkIOKAlCBzYXZlcyBpbmdlc3QgYmFuZHdpZHRoIGF0IHRoZSBzb3VyY2UpLlxuXHRcdGlmIChhbnlNYXRjaChEUk9QX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXR1cm4gbnVsbDtcblx0XHR9XG5cdFx0Ly8gNCkgRE9XTkdSQURFOiBub2lzZSBrZXB0IGJ1dCBkZS1lbXBoYXNpc2VkIHRvIGRlYnVnLlxuXHRcdGlmIChhbnlNYXRjaChET1dOR1JBREVfUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJlc29sdmVkTGV2ZWwgPSAnZGVidWcnO1xuXHRcdFx0cmVjbGFzc2lmaWVkID0gJ25vaXNlJztcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHNlcnZpY2U6IFNFUlZJQ0UsXG5cdFx0ZW52OiBFTlYsXG5cdFx0Li4uKFJFU09MVkVEX0FDQ09VTlQgPyB7IGFjY291bnQ6IFJFU09MVkVEX0FDQ09VTlQgfSA6IHt9KSxcblx0XHQuLi4oUkVHSU9OID8geyByZWdpb246IFJFR0lPTiB9IDoge30pLFxuXHRcdC4uLihWRVJTSU9OID8geyB2ZXJzaW9uOiBWRVJTSU9OIH0gOiB7fSksXG5cdFx0aG9zdDogc2hvcnRIb3N0KGxvZ0dyb3VwLCBsb2dTdHJlYW0pLFxuXHRcdC4uLihsb2dnZXIgPyB7IGxvZ2dlciB9IDoge30pLFxuXHRcdC4uLihyZXF1ZXN0SWQgPyB7IHJlcXVlc3RJZCB9IDoge30pLFxuXHRcdC4uLihsaWZ0ZWQgPz8ge30pLFxuXHRcdC4uLihjb3JyZWxhdGlvbklkID8geyBjb3JyZWxhdGlvbklkIH0gOiB7fSksXG5cdFx0bGV2ZWw6IHJlc29sdmVkTGV2ZWwsXG5cdFx0Li4uKHJlY2xhc3NpZmllZCA/IHsgcmVjbGFzc2lmaWVkIH0gOiB7fSksXG5cdFx0bWVzc2FnZTogY2xlYW5NZXNzYWdlLFxuXHRcdHRpbWVzdGFtcDogdHNJc28gPz8gbmV3IERhdGUoZS50aW1lc3RhbXApLnRvSVNPU3RyaW5nKCksXG5cdFx0bG9nR3JvdXAsXG5cdFx0bG9nU3RyZWFtLFxuXHR9O1xufVxuXG4vKiogU3BsaXQgcHJlLXNlcmlhbGl6ZWQgbGluZXMgaW50byBzdWItYmF0Y2hlcyB1bmRlciBNQVhfQkFUQ0hfQllURVMgKHVuY29tcHJlc3NlZCkuICovXG5mdW5jdGlvbiBjaHVua0xpbmVzKGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZ1tdW10ge1xuXHRjb25zdCBjaHVua3M6IHN0cmluZ1tdW10gPSBbXTtcblx0bGV0IGN1cnJlbnQ6IHN0cmluZ1tdID0gW107XG5cdGxldCBzaXplID0gMDtcblx0Zm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG5cdFx0Y29uc3QgbGluZUJ5dGVzID0gQnVmZmVyLmJ5dGVMZW5ndGgobGluZSkgKyAxOyAvLyArMSBmb3IgdGhlIGRlbGltaXRlclxuXHRcdGlmIChjdXJyZW50Lmxlbmd0aCA+IDAgJiYgc2l6ZSArIGxpbmVCeXRlcyA+IE1BWF9CQVRDSF9CWVRFUykge1xuXHRcdFx0Y2h1bmtzLnB1c2goY3VycmVudCk7XG5cdFx0XHRjdXJyZW50ID0gW107XG5cdFx0XHRzaXplID0gMDtcblx0XHR9XG5cdFx0Y3VycmVudC5wdXNoKGxpbmUpO1xuXHRcdHNpemUgKz0gbGluZUJ5dGVzO1xuXHR9XG5cdGlmIChjdXJyZW50Lmxlbmd0aCA+IDApIHtcblx0XHRjaHVua3MucHVzaChjdXJyZW50KTtcblx0fVxuXHRyZXR1cm4gY2h1bmtzO1xufVxuXG5mdW5jdGlvbiBlbmNvZGVCb2R5KGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG5cdC8vIGxpbmVzIGFyZSBhbHJlYWR5IEpTT04gc3RyaW5nc1xuXHRyZXR1cm4gQkFUQ0hfRk9STUFUID09PSAnanNvbi1hcnJheScgPyBgWyR7bGluZXMuam9pbignLCcpfV1gIDogbGluZXMuam9pbignXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHBvc3QoZ3ppcHBlZDogQnVmZmVyKTogUHJvbWlzZTx2b2lkPiB7XG5cdHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0Y29uc3QgdXJsID0gbmV3IFVSTChJTkdFU1RfVVJMISk7XG5cdFx0Y29uc3QgaXNIdHRwcyA9IHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOic7XG5cdFx0Y29uc3QgbGliID0gaXNIdHRwcyA/IGh0dHBzIDogaHR0cDtcblx0XHRjb25zdCByZXEgPSBsaWIucmVxdWVzdChcblx0XHRcdHVybCxcblx0XHRcdHtcblx0XHRcdFx0bWV0aG9kOiAnUE9TVCcsXG5cdFx0XHRcdGFnZW50OiBpc0h0dHBzID8gaHR0cHNBZ2VudCA6IGh0dHBBZ2VudCxcblx0XHRcdFx0aGVhZGVyczoge1xuXHRcdFx0XHRcdCdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG5cdFx0XHRcdFx0J0NvbnRlbnQtRW5jb2RpbmcnOiAnZ3ppcCcsXG5cdFx0XHRcdFx0J0NvbnRlbnQtTGVuZ3RoJzogZ3ppcHBlZC5sZW5ndGgsXG5cdFx0XHRcdFx0Li4uKFhfQVBJX0tFWSA/IHsgJ3gtYXBpLWtleSc6IFhfQVBJX0tFWSB9IDoge30pLFxuXHRcdFx0XHR9LFxuXHRcdFx0fSxcblx0XHRcdChyZXMpID0+IHtcblx0XHRcdFx0cmVzLnJlc3VtZSgpOyAvLyBkcmFpbiBzbyB0aGUgc29ja2V0IGNhbiBiZSByZXVzZWRcblx0XHRcdFx0Y29uc3Qgc3RhdHVzID0gcmVzLnN0YXR1c0NvZGUgPz8gMDtcblx0XHRcdFx0aWYgKHN0YXR1cyA+PSAyMDAgJiYgc3RhdHVzIDwgMzAwKSB7XG5cdFx0XHRcdFx0cmVzb2x2ZSgpO1xuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlamVjdChuZXcgRXJyb3IoYGluZ2VzdCByZXNwb25kZWQgJHtzdGF0dXN9YCkpO1xuXHRcdFx0XHR9XG5cdFx0XHR9LFxuXHRcdCk7XG5cdFx0cmVxLm9uKCdlcnJvcicsIHJlamVjdCk7XG5cdFx0cmVxLnNldFRpbWVvdXQoUE9TVF9USU1FT1VUX01TLCAoKSA9PiByZXEuZGVzdHJveShuZXcgRXJyb3IoJ2luZ2VzdCB0aW1lb3V0JykpKTtcblx0XHRyZXEuZW5kKGd6aXBwZWQpO1xuXHR9KTtcbn1cblxuLyoqIFBPU1Qgb25lIGNodW5rIHdpdGggYSBzaW5nbGUgcmV0cnkuIFJldHVybnMgZmFsc2UgaWYgdGhlIGNodW5rIHdhcyBkcm9wcGVkIGFmdGVyIHJldHJpZXMuICovXG5hc3luYyBmdW5jdGlvbiBzaGlwV2l0aFJldHJ5KGd6aXBwZWQ6IEJ1ZmZlcik6IFByb21pc2U8Ym9vbGVhbj4ge1xuXHRmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8PSBNQVhfUkVUUklFUzsgYXR0ZW1wdCsrKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IHBvc3QoZ3ppcHBlZCk7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9IGNhdGNoIChlcnIpIHtcblx0XHRcdGlmIChhdHRlbXB0ID09PSBNQVhfUkVUUklFUykge1xuXHRcdFx0XHQvLyBTd2FsbG93IGFmdGVyIHJldHJpZXM6IGEgcGVyc2lzdGVudCBpbmdlc3Qgb3V0YWdlIG11c3Qgbm90IGNyZWF0ZSBhIENsb3VkV2F0Y2ggcmV0cnkgc3Rvcm0uXG5cdFx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBzaGlwIGZhaWxlZCwgZHJvcHBpbmcgY2h1bms6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vKiogRW1pdCBhbiBhbGFybWFibGUgQ2xvdWRXYXRjaCBtZXRyaWMgKEVNRikgd2hlbiByZWNvcmRzIGFyZSBkcm9wcGVkIOKAlCBubyBTREssIGp1c3Qgc3RydWN0dXJlZCBzdGRvdXQuICovXG5mdW5jdGlvbiBlbWl0RHJvcHBlZE1ldHJpYyhyZWNvcmRzOiBudW1iZXIpOiB2b2lkIHtcblx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0Y29uc29sZS5sb2coXG5cdFx0SlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0X2F3czoge1xuXHRcdFx0XHRUaW1lc3RhbXA6IERhdGUubm93KCksXG5cdFx0XHRcdENsb3VkV2F0Y2hNZXRyaWNzOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0TmFtZXNwYWNlOiAnTG9nRm9yd2FyZGVyJyxcblx0XHRcdFx0XHRcdERpbWVuc2lvbnM6IFsgWyAnc2VydmljZScgXSBdLFxuXHRcdFx0XHRcdFx0TWV0cmljczogWyB7IE5hbWU6ICdEcm9wcGVkUmVjb3JkcycsIFVuaXQ6ICdDb3VudCcgfSBdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cdFx0XHR9LFxuXHRcdFx0c2VydmljZTogU0VSVklDRSxcblx0XHRcdERyb3BwZWRSZWNvcmRzOiByZWNvcmRzLFxuXHRcdH0pLFxuXHQpO1xufVxuXG5pbnRlcmZhY2UgTGFtYmRhQ29udGV4dExpa2Uge1xuXHRpbnZva2VkRnVuY3Rpb25Bcm4/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBDbG91ZFdhdGNoTG9nc0V2ZW50LCBjb250ZXh0PzogTGFtYmRhQ29udGV4dExpa2UpOiBQcm9taXNlPHZvaWQ+ID0+IHtcblx0Ly8gUmVzb2x2ZSB0aGUgYWNjb3VudCBmcm9tIHRoaXMgZm9yd2FyZGVyJ3Mgb3duIEFSTiBvbmNlIChzYW1lIGZvciBldmVyeSBpbnZvY2F0aW9uKS5cblx0aWYgKCFSRVNPTFZFRF9BQ0NPVU5UICYmIGNvbnRleHQ/Lmludm9rZWRGdW5jdGlvbkFybikge1xuXHRcdFJFU09MVkVEX0FDQ09VTlQgPSBhY2NvdW50RnJvbUFybihjb250ZXh0Lmludm9rZWRGdW5jdGlvbkFybik7XG5cdH1cblx0aWYgKCFJTkdFU1RfVVJMKSB7XG5cdFx0cmV0dXJuOyAvLyBub3QgY29uZmlndXJlZCB5ZXQg4oCUIG5vLW9wIChzYWZlIHRvIGRlcGxveSBiZWZvcmUgd2lyaW5nIHRoZSBpbmdlc3QgVVJMKVxuXHR9XG5cblx0bGV0IHBheWxvYWQ6IERlY29kZWRQYXlsb2FkO1xuXHR0cnkge1xuXHRcdHBheWxvYWQgPSBKU09OLnBhcnNlKGd1bnppcFN5bmMoQnVmZmVyLmZyb20oZXZlbnQuYXdzbG9ncy5kYXRhLCAnYmFzZTY0JykpLnRvU3RyaW5nKCd1dGY4JykpIGFzIERlY29kZWRQYXlsb2FkO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBmYWlsZWQgdG8gZGVjb2RlIHBheWxvYWQ6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0aWYgKHBheWxvYWQubWVzc2FnZVR5cGUgPT09ICdDT05UUk9MX01FU1NBR0UnKSB7XG5cdFx0cmV0dXJuOyAvLyBzdWJzY3JpcHRpb24gbGl2ZW5lc3MgcGluZ1xuXHR9XG5cdGNvbnN0IGV2ZW50cyA9IHBheWxvYWQubG9nRXZlbnRzO1xuXHRpZiAoIUFycmF5LmlzQXJyYXkoZXZlbnRzKSB8fCBldmVudHMubGVuZ3RoID09PSAwKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG5cdGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcblx0XHRjb25zdCByZWNvcmQgPSB0b1ZlY3RvclJlY29yZChlLCBwYXlsb2FkLmxvZ0dyb3VwLCBwYXlsb2FkLmxvZ1N0cmVhbSk7XG5cdFx0aWYgKHJlY29yZCAhPT0gbnVsbCkge1xuXHRcdFx0bGluZXMucHVzaChKU09OLnN0cmluZ2lmeShyZWNvcmQpKTtcblx0XHR9XG5cdH1cblx0aWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkge1xuXHRcdHJldHVybjsgLy8gd2hvbGUgYmF0Y2ggd2FzIG5vaXNlIC8gZHJvcHBlZFxuXHR9XG5cdGxldCBkcm9wcGVkID0gMDtcblx0Zm9yIChjb25zdCBjaHVuayBvZiBjaHVua0xpbmVzKGxpbmVzKSkge1xuXHRcdGNvbnN0IGd6aXBwZWQgPSBnemlwU3luYyhCdWZmZXIuZnJvbShlbmNvZGVCb2R5KGNodW5rKSkpO1xuXHRcdGNvbnN0IG9rID0gYXdhaXQgc2hpcFdpdGhSZXRyeShnemlwcGVkKTtcblx0XHRpZiAoIW9rKSB7XG5cdFx0XHRkcm9wcGVkICs9IGNodW5rLmxlbmd0aDtcblx0XHR9XG5cdH1cblx0aWYgKGRyb3BwZWQgPiAwKSB7XG5cdFx0ZW1pdERyb3BwZWRNZXRyaWMoZHJvcHBlZCk7XG5cdH1cbn07XG4iXX0=