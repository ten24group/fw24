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
    'codeFile', 'codeLine',
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
// tslog's "pretty" (non-JSON) console format: `YYYY-MM-DD HH:MM:SS.mmm LEVEL rest…`. The date + level
// it prints duplicate what Logtrail already shows in the dedicated TIME/LVL columns — peel them off
// the message like the Lambda-prefix / tslog-JSON branches already do for their own shapes.
const PRETTY_TSLOG_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\s+(.*)$/;
/** Peel a tslog "pretty" `‹date› ‹time› LEVEL ‹rest›` prefix, if the line matches. */
function parsePrettyTslogPrefix(raw) {
    const m = raw.match(PRETTY_TSLOG_RE);
    if (!m)
        return null;
    const [, lvl, rest] = m;
    const level = lvl.toLowerCase().startsWith('warn') ? 'warn' : lvl.toLowerCase();
    return { level, message: rest };
}
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
    let codeLoc;
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
                // tslog native source position (mode 'all'): _meta.path.
                const p = meta.path;
                if (p && typeof p === 'object') {
                    if (typeof p.filePathWithLine === 'string')
                        codeLoc = p.filePathWithLine;
                    else if (typeof p.fileName === 'string' && p.fileLine != null)
                        codeLoc = `${p.fileName}:${p.fileLine}`;
                }
            }
            // Positional args "0".."n" hold the logged message + params. A `{ _srcloc }` arg (mode
            // 'warn-error') carries the caller's source position — lift it, keep it out of the message.
            const parts = [];
            for (let i = 0; Object.prototype.hasOwnProperty.call(o, String(i)); i++) {
                const v = o[String(i)];
                if (v && typeof v === 'object' && !Array.isArray(v) && typeof v._srcloc === 'string') {
                    if (!codeLoc)
                        codeLoc = v._srcloc;
                    continue;
                }
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
    else {
        // ── 1) NORMALIZE: tslog's "pretty" (non-JSON) console format — strip its own duplicate date+level.
        const pretty = parsePrettyTslogPrefix(body);
        if (pretty) {
            if (!level)
                level = pretty.level;
            message = pretty.message;
        }
    }
    const cleanMessage = stripAnsi(message);
    let resolvedLevel = level ?? fallbackLevel(raw);
    let reclassified;
    // Split the captured source position into queryable `codeFile` + `codeLine` (for "open the exact
    // culprit line" links). Path is made repo-relative (kept from its last `src/` segment).
    let codeFile;
    let codeLine;
    if (codeLoc) {
        const m = codeLoc.match(/^(.*?):(\d+)(?::\d+)?$/);
        if (m) {
            // Absolute path (…/src/…) → make repo-relative from the last `src/`. Already-relative paths
            // (the logging layer emits `src/…`) are kept as-is.
            const srcIdx = m[1].lastIndexOf('/src/');
            codeFile = srcIdx >= 0 ? m[1].slice(srcIdx + 1) : m[1];
            codeLine = m[2];
        }
    }
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
        ...(codeFile ? { codeFile } : {}),
        ...(codeLine ? { codeLine } : {}),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBZ0NHO0FBQ0gseUNBQWlEO0FBQ2pELGdEQUFrQztBQUNsQyxrREFBb0M7QUFDcEMsdUNBQStCO0FBRS9CLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDeEUscUdBQXFHO0FBQ3JHLGdHQUFnRztBQUNoRyxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDM0QsdUdBQXVHO0FBQ3ZHLHFHQUFxRztBQUNyRyxrRkFBa0Y7QUFDbEYsTUFBTSxPQUFPLEdBQUcsR0FBRyxJQUFJLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDbkYsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUVqRSxxR0FBcUc7QUFDckcsc0dBQXNHO0FBQ3RHLHFHQUFxRztBQUNyRyxzRkFBc0Y7QUFDdEYsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDO0FBQ3BELElBQUksZ0JBQWdCLEdBQUcs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L0NXLFFBQUEsT0FBTyxXQStDbEIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENsb3VkV2F0Y2ggTG9ncyAtPiBWZWN0b3IvTG9ndHJhaWwgZm9yd2FyZGVyIChvdXQtb2YtYmFuZCBsb2cgc2hpcHBpbmcpLlxuICpcbiAqIEFwcCBMYW1iZGFzIG9ubHkgd3JpdGUgdG8gc3Rkb3V0IChDbG91ZFdhdGNoKSDigJQgbm90aGluZyBydW5zIGluIHRoZWlyIHJlcXVlc3QgcGF0aC4gQSBDbG91ZFdhdGNoXG4gKiBMb2dzIHN1YnNjcmlwdGlvbiBmaWx0ZXIgc3RyZWFtcyBiYXRjaGVkLCBnemlwcGVkIGV2ZW50cyB0byB0aGlzIGZ1bmN0aW9uLCB3aGljaCByZXNoYXBlcyB0aGVtIHRvXG4gKiBjbGVhbiBWZWN0b3IgSlNPTiByZWNvcmRzIGFuZCBzaGlwcyB0aGVtIHRvIHRoZSBpbmdlc3QgZW5kcG9pbnQgb3ZlciBhIGtlZXAtYWxpdmUgY29ubmVjdGlvbixcbiAqIGd6aXAtY29tcHJlc3NlZCBhbmQgc3BsaXQgaW50byBib3VuZGVkIHN1Yi1iYXRjaGVzLlxuICpcbiAqIFByb2Nlc3NpbmcgcGlwZWxpbmUgcGVyIGV2ZW50IChzZWUgYExvZ0ZvcndhcmRlckNvbnN0cnVjdGApOlxuICogICAxLiBOT1JNQUxJWkUgIOKAlCBwZWVsIEFXUyBMYW1iZGEncyB0ZXh0IHByZWZpeCwgbGlmdCBmdzI0IHRzbG9nIEpTT04sIHN0cmlwIEFOU0ksIHNob3J0ZW4gaG9zdC5cbiAqICAgMi4gUkVDTEFTU0lGWSDigJQgZXJyb3ItaXNoIGxpbmVzIG1hdGNoaW5nIGEgXCJiZW5pZ25cIiBwYXR0ZXJuIOKGkiBgd2FybmAgKGByZWNsYXNzaWZpZWQ6IFwiYmVuaWduXCJgKS5cbiAqICAgMy4gRFJPUCAgICAgICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRyb3BcIiBwYXR0ZXJuIGFyZSByZW1vdmVkIGVudGlyZWx5IChzYXZlZCBiYW5kd2lkdGggYXQgc291cmNlKS5cbiAqICAgNC4gRE9XTkdSQURFICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRvd25ncmFkZVwiIHBhdHRlcm4g4oaSIGBkZWJ1Z2AgKGByZWNsYXNzaWZpZWQ6IFwibm9pc2VcImApLlxuICogU3RlcHMgMuKAkzQgYXJlIGFwcC1vd25lZCBydWxlIGxpc3RzIChlbnYtaW5qZWN0ZWQgYnkgdGhlIGNvbnN0cnVjdCksIGNvbXBsZW1lbnRhcnkgdG8gYW55IGdsb2JhbFxuICogc2V2ZXJpdHkvbm9pc2UgaGFuZGxpbmcgYSBzaGFyZWQgVmVjdG9yIGluZ2VzdCBtYXkgYWxzbyBhcHBseS5cbiAqXG4gKiBFdmVyeSByZWNvcmQgYWxzbyBjYXJyaWVzIGBhY2NvdW50YCArIGByZWdpb25gIChmcm9tIHRoZSBmb3J3YXJkZXIncyBvd24gQVJOKSBzbyBkZXBsb3ltZW50cyB0aGF0XG4gKiBzaGFyZSBhcHAgKyBlbnYgbmFtZXMg4oCUIGUuZy4gbXVsdGlwbGUgZGV2ZWxvcGVycyBlYWNoIHJ1bm5pbmcgYHBsdXNmYW4tdHJpYWxzYCAoQVBQX0VOVklST05NRU5UPWxvY2FsKVxuICogaW4gdGhlaXIgT1dOIGFjY291bnQg4oCUIHN0YXkgZGlzdGluZ3Vpc2hhYmxlIGluc3RlYWQgb2YgY29sbGlkaW5nIHVuZGVyIG9uZSBgc2VydmljZWAgbGFiZWwuXG4gKlxuICogVHdvIG1vcmUgYXBwLW93bmVkIGVucmljaG1lbnRzLCBib3RoIGNvbmZpZy1kcml2ZW4gKHRoZSBmb3J3YXJkZXIgbmV2ZXIgZ3Vlc3NlcyBmcm9tIGZyZWUgdGV4dCk6XG4gKiAgIOKAoiBGSUVMRCBMSUZUSU5HIChgRk9SV0FSREVSX0ZJRUxEU2ApIOKAlCBwcm9tb3RlIGFwcC1kZWNsYXJlZCBzdHJ1Y3R1cmVkIGZpZWxkcyAoZS5nLiBgY29ycmVsYXRpb25JZGAsXG4gKiAgICAgYG9yZGVySWRgLCBgdXNlcklkYCkgb3V0IG9mIHRoZSB0c2xvZyBKU09OIGFyZ3MgaW50byBxdWVyeWFibGUgdG9wLWxldmVsIHJlY29yZCBmaWVsZHMuIFRoaXMgaXNcbiAqICAgICB3aGF0IGxldHMgTG9ndHJhaWwgZm9sbG93IG9uZSByZXF1ZXN0IGFjcm9zcyBzZXJ2aWNlcywgb3IgZmlsdGVyIFwiYWxsIGxvZ3MgZm9yIG9yZGVyIDk5MVwiLlxuICogICDigKIgVkVSU0lPTiAoYEZPUldBUkRFUl9WRVJTSU9OYCkg4oCUIHN0YW1wIGV2ZXJ5IGxpbmUgd2l0aCB0aGUgcmVsZWFzZSB0aGF0IHByb2R1Y2VkIGl0LCBzbyBiZWhhdmlvclxuICogICAgIGNoYW5nZXMgY2FuIGJlIGF0dHJpYnV0ZWQgdG8gYSBkZXBsb3kuXG4gKlxuICogRU5WIE5BTUVTUEFDRTogdGhpcyBmdW5jdGlvbiByZWFkcyBPTkxZIGBGT1JXQVJERVJfKmAgZW52IHZhcnMg4oCUIGRlbGliZXJhdGVseSBOT1QgdGhlIGBMT0dUUkFJTF8qYFxuICoga2V5cyB1c2VkIGJ5IGZ3MjQncyBpbi1wcm9jZXNzIGxvZyB0cmFuc3BvcnQuIFRoYXQgZ3VhcmFudGVlcyB0aGUgZm9yd2FyZGVyIGNhbiBuZXZlciBjb2xsaWRlIHdpdGgsXG4gKiBvciBhY2NpZGVudGFsbHkgYWN0aXZhdGUsIGZ3MjQncyBpbi1wcm9jZXNzIExvZ3RyYWlsIG1hY2hpbmVyeS5cbiAqXG4gKiBERVBFTkRFTkNZLUZSRUUgKG5vZGUgYnVpbHQtaW5zIG9ubHkpIHNvIHRoZSBmb3J3YXJkZXIgYnVuZGxlIHN0YXlzIHRpbnkgYW5kIGNoZWFwLlxuICovXG5pbXBvcnQgeyBndW56aXBTeW5jLCBnemlwU3luYyB9IGZyb20gJ25vZGU6emxpYic7XG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCc7XG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdub2RlOmh0dHBzJztcbmltcG9ydCB7IFVSTCB9IGZyb20gJ25vZGU6dXJsJztcblxuY29uc3QgSU5HRVNUX1VSTCA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfVVJMPy50cmltKCk7XG5jb25zdCBCQVNFX1NFUlZJQ0UgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfU0VSVklDRT8udHJpbSgpIHx8ICd1bmtub3duJztcbi8vIFN0YWdlL293bmVyIGxhYmVsIChlLmcuIGBkZXZlbG9wYCwgYHByb2RgLCBgc2FuZGJveC1uaXRpbmApIHNvIGRldmVsb3AvcHJvZC9wZXItZGV2ZWxvcGVyIGxvZ3MgYXJlXG4vLyBkaXN0aW5ndWlzaGFibGUg4oCUIHRoZXJlIGNhbiBiZSBzZXZlcmFsIGRlcGxveW1lbnRzIG9mIG9uZSBzZXJ2aWNlIGFjcm9zcyBlbnZzIGFuZCBkZXZlbG9wZXJzLlxuY29uc3QgRU5WID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0VOVj8udHJpbSgpIHx8ICd1bmtub3duJztcbi8vIFRoZSBgc2VydmljZWAgbGFiZWwgaXMgd2hhdCdzIHByb21vdGVkIHRvIGEgTG9raSBsYWJlbCAoYW5kIHNob3duIGluIExvZ3RyYWlsKSwgc28gZm9sZCB0aGUgZW52IGludG9cbi8vIGl0IOKAlCBgcGx1c2Zhbi10cmlhbHMtZGV2ZWxvcGAsIGBwbHVzZmFuLXRyaWFscy1zYW5kYm94LW5pdGluYCwg4oCmIOKAlCBndWFyYW50ZWVpbmcgZWFjaCBkZXBsb3ltZW50IGlzXG4vLyBkaXN0aW5jdCBhdCBhIGdsYW5jZS4gYGVudmAgaXMgYWxzbyBlbWl0dGVkIGFzIGEgc3RydWN0dXJlZCBmaWVsZCBmb3IgcXVlcnlpbmcuXG5jb25zdCBTRVJWSUNFID0gRU5WICYmIEVOViAhPT0gJ3Vua25vd24nID8gYCR7QkFTRV9TRVJWSUNFfS0ke0VOVn1gIDogQkFTRV9TRVJWSUNFO1xuY29uc3QgWF9BUElfS0VZID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk/LnRyaW0oKTtcblxuLy8gQVdTIGFjY291bnQgKyByZWdpb24gZGlzYW1iaWd1YXRlIGRlcGxveW1lbnRzIHRoYXQgc2hhcmUgYXBwICsgZW52IG5hbWVzIOKAlCBlLmcuIHNldmVyYWwgZGV2ZWxvcGVyc1xuLy8gZWFjaCBkZXBsb3lpbmcgdGhlIFNBTUUgYXBwIChgcGx1c2Zhbi10cmlhbHNgLCBBUFBfRU5WSVJPTk1FTlQ9bG9jYWwpIHRvIHRoZWlyIE9XTiBhY2NvdW50LiBXaXRob3V0XG4vLyB0aGlzLCBhbGwgdGhlaXIgbG9ncyB3b3VsZCBjb2xsaWRlIHVuZGVyIG9uZSBgc2VydmljZWAgbGFiZWwuIFJlZ2lvbiBpcyBzZXQgYnkgdGhlIExhbWJkYSBydW50aW1lO1xuLy8gYWNjb3VudCBpcyBwYXJzZWQgZnJvbSB0aGUgaW52b2tlZCBmdW5jdGlvbiBBUk4gb24gdGhlIGZpcnN0IGludm9jYXRpb24gYW5kIGNhY2hlZC5cbmNvbnN0IFJFR0lPTiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04/LnRyaW0oKSB8fCAnJztcbmxldCBSRVNPTFZFRF9BQ0NPVU5UID0gJyc7XG5mdW5jdGlvbiBhY2NvdW50RnJvbUFybihhcm46IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG5cdC8vIGFybjphd3M6bGFtYmRhOjxyZWdpb24+OjxBQ0NPVU5UPjpmdW5jdGlvbjo8bmFtZT5cblx0Y29uc3QgcGFydHMgPSAoYXJuIHx8ICcnKS5zcGxpdCgnOicpO1xuXHRyZXR1cm4gcGFydHMubGVuZ3RoID4gNCA/IHBhcnRzWzRdIDogJyc7XG59XG4vLyBUaGUgZncyNCBMb2d0cmFpbC9WZWN0b3IgaW5nZXN0IGRlY29kZXMgYSBKU09OIGFycmF5IGludG8gaW5kaXZpZHVhbCBldmVudHMgYW5kIFJFSkVDVFMgTkRKU09OICg0MDApLFxuLy8gc28gYGpzb24tYXJyYXlgIGlzIHRoZSBkZWZhdWx0LiBPdmVycmlkZSB0byBgbmRqc29uYCBvbmx5IGZvciBhbiBpbmdlc3QgY29uZmlndXJlZCB3aXRoIG5ld2xpbmUgZnJhbWluZy5cbmNvbnN0IEJBVENIX0ZPUk1BVCA9IChwcm9jZXNzLmVudi5GT1JXQVJERVJfQkFUQ0hfRk9STUFUPy50cmltKCkgfHwgJ2pzb24tYXJyYXknKSBhcyAnbmRqc29uJyB8ICdqc29uLWFycmF5Jztcbi8qKiBNYXggdW5jb21wcmVzc2VkIGJ5dGVzIHBlciBQT1NUIOKAlCBib3VuZHMgcmVxdWVzdCBzaXplIHNvIGEgbGFyZ2UgQ2xvdWRXYXRjaCBiYXRjaCBjYW4ndCA0MTMgdGhlIGluZ2VzdC4gKi9cbmNvbnN0IE1BWF9CQVRDSF9CWVRFUyA9IE51bWJlcihwcm9jZXNzLmVudi5GT1JXQVJERVJfTUFYX0JBVENIX0JZVEVTKSB8fCAxXzAwMF8wMDA7XG5jb25zdCBQT1NUX1RJTUVPVVRfTVMgPSBOdW1iZXIocHJvY2Vzcy5lbnYuRk9SV0FSREVSX1BPU1RfVElNRU9VVF9NUykgfHwgNTAwMDtcbmNvbnN0IE1BWF9SRVRSSUVTID0gMTtcblxuLy8g4pSA4pSAIEFwcC1sZXZlbCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzIChsYXllcnMgMuKAkzQpLiBFYWNoIGVudiB2YXIgaXMgYSBKU09OIGFycmF5IG9mIHJlZ2V4IHNvdXJjZVxuLy8gICAgc3RyaW5nczsgY29tcGlsZWQgY2FzZS1pbnNlbnNpdGl2ZWx5IG9uY2UsIGhlcmUsIGF0IGNvbGQgc3RhcnQuIEVtcHR5L21hbGZvcm1lZCDihpIgbm8gcnVsZXMuIOKUgOKUgFxuZnVuY3Rpb24gY29tcGlsZVJ1bGVzKHJhd0pzb246IHN0cmluZyB8IHVuZGVmaW5lZCk6IFJlZ0V4cFtdIHtcblx0aWYgKCFyYXdKc29uKSByZXR1cm4gW107XG5cdGxldCBhcnI6IHVua25vd247XG5cdHRyeSB7XG5cdFx0YXJyID0gSlNPTi5wYXJzZShyYXdKc29uKTtcblx0fSBjYXRjaCB7XG5cdFx0cmV0dXJuIFtdO1xuXHR9XG5cdGlmICghQXJyYXkuaXNBcnJheShhcnIpKSByZXR1cm4gW107XG5cdGNvbnN0IG91dDogUmVnRXhwW10gPSBbXTtcblx0Zm9yIChjb25zdCBzcmMgb2YgYXJyKSB7XG5cdFx0aWYgKHR5cGVvZiBzcmMgIT09ICdzdHJpbmcnIHx8IHNyYy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuXHRcdHRyeSB7XG5cdFx0XHRvdXQucHVzaChuZXcgUmVnRXhwKHNyYywgJ2knKSk7XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyBBIGJhZCBwYXR0ZXJuIG11c3QgbmV2ZXIgYnJlYWsgdGhlIGZvcndhcmRlciDigJQgc2tpcCBpdC5cblx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRjb25zb2xlLndhcm4oJ1tsb2ctZm9yd2FyZGVyXSBpZ25vcmluZyBpbnZhbGlkIG5vaXNlIHBhdHRlcm46Jywgc3JjKTtcblx0XHR9XG5cdH1cblx0cmV0dXJuIG91dDtcbn1cblxuY29uc3QgQkVOSUdOX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9CRU5JR04pO1xuY29uc3QgRFJPUF9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfRFJPUCk7XG5jb25zdCBET1dOR1JBREVfUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0RPV05HUkFERSk7XG5jb25zdCBIQVNfTk9JU0VfUlVMRVMgPSBCRU5JR05fUlVMRVMubGVuZ3RoID4gMCB8fCBEUk9QX1JVTEVTLmxlbmd0aCA+IDAgfHwgRE9XTkdSQURFX1JVTEVTLmxlbmd0aCA+IDA7XG5cbi8vIOKUgOKUgCBBcHAtZGVjbGFyZWQgZmllbGQgbGlmdGluZyAoRk9SV0FSREVSX0ZJRUxEUyk6IGEgSlNPTiBhcnJheSBvZiBmaWVsZCBuYW1lcyB0aGUgYXBwIHdhbnRzIHByb21vdGVkXG4vLyAgICBmcm9tIGl0cyBzdHJ1Y3R1cmVkIHRzbG9nIGFyZ3MgdG8gcXVlcnlhYmxlIHRvcC1sZXZlbCByZWNvcmQgZmllbGRzIChlLmcuIGNvcnJlbGF0aW9uSWQsIG9yZGVySWQpLlxuLy8gICAgVGhlIGFwcCBvd25zIHRoaXMgbGlzdCB2aWEgdGhlIGNvbnN0cnVjdDsgdGhlIGZvcndhcmRlciBuZXZlciBzY3JhcGVzIGZyZWUgdGV4dCBmb3IgdGhlbS4g4pSA4pSAXG5mdW5jdGlvbiBwYXJzZUZpZWxkTGlzdChyYXdKc29uOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmdbXSB7XG5cdGlmICghcmF3SnNvbikgcmV0dXJuIFtdO1xuXHR0cnkge1xuXHRcdGNvbnN0IGFyciA9IEpTT04ucGFyc2UocmF3SnNvbik7XG5cdFx0aWYgKCFBcnJheS5pc0FycmF5KGFycikpIHJldHVybiBbXTtcblx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KGFyci5maWx0ZXIoKHMpOiBzIGlzIHN0cmluZyA9PiB0eXBlb2YgcyA9PT0gJ3N0cmluZycgJiYgcy50cmltKCkubGVuZ3RoID4gMCkubWFwKChzKSA9PiBzLnRyaW0oKSkpIF07XG5cdH0gY2F0Y2gge1xuXHRcdHJldHVybiBbXTtcblx0fVxufVxuY29uc3QgTElGVF9TRVQgPSBuZXcgU2V0KHBhcnNlRmllbGRMaXN0KHByb2Nlc3MuZW52LkZPUldBUkRFUl9GSUVMRFMpKTtcbmNvbnN0IEhBU19MSUZUX0ZJRUxEUyA9IExJRlRfU0VULnNpemUgPiAwO1xuXG4vLyBSZWxlYXNlL3ZlcnNpb24gc3RhbXAgc28gZXZlcnkgc2hpcHBlZCBsaW5lIGlzIGF0dHJpYnV0YWJsZSB0byB0aGUgZGVwbG95IHRoYXQgcHJvZHVjZWQgaXQuIFNldCBieSB0aGVcbi8vIGNvbnN0cnVjdCBhdCBkZXBsb3kgdGltZSAoc2VtdmVyIG9yIGdpdCBzaGEpOyBvbWl0dGVkIGZyb20gcmVjb3JkcyB3aGVuIHVuc2V0LlxuY29uc3QgVkVSU0lPTiA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9WRVJTSU9OPy50cmltKCkgfHwgJyc7XG5cbi8vIFJlY29yZCBrZXlzIHRoZSBmb3J3YXJkZXIgb3ducyDigJQgYSBsaWZ0ZWQgYXBwIGZpZWxkIG11c3QgbmV2ZXIgb3ZlcndyaXRlIG9uZSBvZiB0aGVzZS5cbmNvbnN0IFJFU0VSVkVEX0ZJRUxEX0tFWVMgPSBuZXcgU2V0KFtcblx0J3NlcnZpY2UnLCAnZW52JywgJ2FjY291bnQnLCAncmVnaW9uJywgJ3ZlcnNpb24nLCAnaG9zdCcsICdsb2dnZXInLCAncmVxdWVzdElkJyxcblx0J2xldmVsJywgJ3JlY2xhc3NpZmllZCcsICdtZXNzYWdlJywgJ3RpbWVzdGFtcCcsICdsb2dHcm91cCcsICdsb2dTdHJlYW0nLFxuXHQnY29kZUZpbGUnLCAnY29kZUxpbmUnLFxuXSk7XG5cbi8qKlxuICogTGlmdCB0aGUgYXBwLWRlY2xhcmVkIHtAbGluayBMSUZUX1NFVH0gZmllbGRzIG91dCBvZiBhIHBhcnNlZCB0c2xvZyBvYmplY3QgaW50byBmbGF0IGB7a2V5OiB2YWx1ZX1gXG4gKiBzdHJpbmcgcGFpcnMuIFNjYW5zIHRoZSBvYmplY3QncyBvd24gc2NhbGFyIGtleXMgQU5EIG9uZSBsZXZlbCBpbnRvIGl0cyBwb3NpdGlvbmFsLWFyZ3VtZW50IG9iamVjdHNcbiAqIChcIjBcIi4uXCJuXCIpLCBzbyBgbG9nZ2VyLmluZm8oJ2NoYXJnZSBmYWlsZWQnLCB7IG9yZGVySWQsIGNvcnJlbGF0aW9uSWQgfSlgIHN1cmZhY2VzIGJvdGguIFJlc2VydmVkXG4gKiByZWNvcmQga2V5cyBhcmUgbmV2ZXIgbGlmdGVkOyB2YWx1ZXMgYXJlIGNvZXJjZWQgdG8gdHJpbW1lZCBzdHJpbmdzOyBmaXJzdCBvY2N1cnJlbmNlIHdpbnMuXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RMaWZ0ZWRGaWVsZHMobzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcblx0Y29uc3Qgb3V0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cdGNvbnN0IHRha2UgPSAoazogc3RyaW5nLCB2OiB1bmtub3duKTogdm9pZCA9PiB7XG5cdFx0aWYgKG91dFtrXSAhPT0gdW5kZWZpbmVkIHx8IFJFU0VSVkVEX0ZJRUxEX0tFWVMuaGFzKGspIHx8ICFMSUZUX1NFVC5oYXMoaykpIHJldHVybjtcblx0XHRpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnIHx8IHR5cGVvZiB2ID09PSAnbnVtYmVyJyB8fCB0eXBlb2YgdiA9PT0gJ2Jvb2xlYW4nKSB7XG5cdFx0XHRjb25zdCBzID0gU3RyaW5nKHYpLnRyaW0oKTtcblx0XHRcdGlmIChzKSBvdXRba10gPSBzO1xuXHRcdH1cblx0fTtcblx0Zm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhvKSkge1xuXHRcdGlmIChrID09PSAnX21ldGEnKSBjb250aW51ZTtcblx0XHRpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodikpIHtcblx0XHRcdGZvciAoY29uc3QgWyBrMiwgdjIgXSBvZiBPYmplY3QuZW50cmllcyh2IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkgdGFrZShrMiwgdjIpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHR0YWtlKGssIHYpO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gb3V0O1xufVxuXG4vLyBMZXZlbHMgdGhhdCBjb3VudCBhcyBcImVycm9yLWlzaFwiIGZvciB0aGUgYmVuaWduIGRvd25ncmFkZSAobWlycm9ycyB0aGUgVmVjdG9yIEExIGxpc3QpLlxuY29uc3QgRVJST1JJU0ggPSBuZXcgU2V0KFsgJ2Vycm9yJywgJ2VycicsICdmYXRhbCcsICdjcml0aWNhbCcsICdjcml0JywgJ2VtZXJnJywgJ2FsZXJ0JywgJ3BhbmljJyBdKTtcbmZ1bmN0aW9uIGFueU1hdGNoKHJ1bGVzOiBSZWdFeHBbXSwgbXNnOiBzdHJpbmcpOiBib29sZWFuIHtcblx0Zm9yIChjb25zdCByZSBvZiBydWxlcykge1xuXHRcdGlmIChyZS50ZXN0KG1zZykpIHJldHVybiB0cnVlO1xuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLy8gUmV1c2VkIGFjcm9zcyB3YXJtIGludm9jYXRpb25zIHNvIHdlIGRvbid0IHBheSBUQ1AvVExTIHNldHVwIHBlciBiYXRjaC5cbmNvbnN0IGh0dHBBZ2VudCA9IG5ldyBodHRwLkFnZW50KHsga2VlcEFsaXZlOiB0cnVlLCBtYXhTb2NrZXRzOiAxNiB9KTtcbmNvbnN0IGh0dHBzQWdlbnQgPSBuZXcgaHR0cHMuQWdlbnQoeyBrZWVwQWxpdmU6IHRydWUsIG1heFNvY2tldHM6IDE2IH0pO1xuXG5pbnRlcmZhY2UgQ2xvdWRXYXRjaExvZ3NFdmVudCB7XG5cdGF3c2xvZ3M6IHsgZGF0YTogc3RyaW5nIH07XG59XG5cbmludGVyZmFjZSBEZWNvZGVkUGF5bG9hZCB7XG5cdG1lc3NhZ2VUeXBlOiBzdHJpbmc7XG5cdGxvZ0dyb3VwOiBzdHJpbmc7XG5cdGxvZ1N0cmVhbTogc3RyaW5nO1xuXHRsb2dFdmVudHM6IEFycmF5PHsgaWQ6IHN0cmluZzsgdGltZXN0YW1wOiBudW1iZXI7IG1lc3NhZ2U6IHN0cmluZyB9Pjtcbn1cblxuLy8gTGFtYmRhIHBsYXRmb3JtIGxpbmVzIHRoYXQgYXJlIHB1cmUgbm9pc2UuIFJFUE9SVCBpcyBrZXB0IGJ5IGRlZmF1bHQgKGNhcnJpZXMgZHVyYXRpb24vbWVtb3J5KTtcbi8vIHNldCBGT1JXQVJERVJfRFJPUF9SRVBPUlQ9dHJ1ZSB0byBkcm9wIGl0IHRvby5cbmNvbnN0IERST1BfUkVQT1JUID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0RST1BfUkVQT1JUPy50cmltKCkgPT09ICd0cnVlJztcbmZ1bmN0aW9uIGlzUGxhdGZvcm1Ob2lzZShyYXc6IHN0cmluZyk6IGJvb2xlYW4ge1xuXHRpZiAocmF3LnN0YXJ0c1dpdGgoJ1NUQVJUIFJlcXVlc3RJZCcpIHx8IHJhdy5zdGFydHNXaXRoKCdFTkQgUmVxdWVzdElkJykgfHwgcmF3LnN0YXJ0c1dpdGgoJ0lOSVRfU1RBUlQnKSkge1xuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cdGlmIChEUk9QX1JFUE9SVCAmJiByYXcuc3RhcnRzV2l0aCgnUkVQT1JUIFJlcXVlc3RJZCcpKSB7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vLyBmdzI0J3MgdHNsb2cgY29sb3JpemVzIG91dHB1dCB3aXRoIEFOU0kgU0dSIGNvZGVzIChlLmcuIEVTQ1szMm0g4oCmIEVTQ1szOW0pIHdoaWNoIG90aGVyd2lzZSBzaGlwIGFzXG4vLyBsaXRlcmFsIGBbMzJtYCBub2lzZSBpbiBMb2d0cmFpbC4gU3RyaXAgYWxsIEFOU0kgZXNjYXBlIHNlcXVlbmNlcyBmcm9tIHNoaXBwZWQgdGV4dC5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb250cm9sLXJlZ2V4XG5jb25zdCBBTlNJX1JFID0gL1xceDFiXFxbWzAtOTtdKltBLVphLXpdL2c7XG5mdW5jdGlvbiBzdHJpcEFuc2koczogc3RyaW5nKTogc3RyaW5nIHtcblx0cmV0dXJuIHMuaW5jbHVkZXMoJ1xceDFiJykgPyBzLnJlcGxhY2UoQU5TSV9SRSwgJycpIDogcztcbn1cblxuZnVuY3Rpb24gZmFsbGJhY2tMZXZlbChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG5cdGlmICgvXFxiKD86RVJST1J8RkFUQUwpXFxiLy50ZXN0KHJhdykpIHJldHVybiAnZXJyb3InO1xuXHRpZiAoL1xcYldBUk4oPzpJTkcpP1xcYi8udGVzdChyYXcpKSByZXR1cm4gJ3dhcm4nO1xuXHRyZXR1cm4gJ2luZm8nO1xufVxuXG5jb25zdCBLTk9XTl9MRVZFTFMgPSBuZXcgU2V0KFsgJ3RyYWNlJywgJ2RlYnVnJywgJ2luZm8nLCAnd2FybicsICd3YXJuaW5nJywgJ2Vycm9yJywgJ2ZhdGFsJyBdKTtcbmNvbnN0IElTT19SRSA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn0vO1xuXG4vLyB0c2xvZydzIFwicHJldHR5XCIgKG5vbi1KU09OKSBjb25zb2xlIGZvcm1hdDogYFlZWVktTU0tREQgSEg6TU06U1MubW1tIExFVkVMIHJlc3TigKZgLiBUaGUgZGF0ZSArIGxldmVsXG4vLyBpdCBwcmludHMgZHVwbGljYXRlIHdoYXQgTG9ndHJhaWwgYWxyZWFkeSBzaG93cyBpbiB0aGUgZGVkaWNhdGVkIFRJTUUvTFZMIGNvbHVtbnMg4oCUIHBlZWwgdGhlbSBvZmZcbi8vIHRoZSBtZXNzYWdlIGxpa2UgdGhlIExhbWJkYS1wcmVmaXggLyB0c2xvZy1KU09OIGJyYW5jaGVzIGFscmVhZHkgZG8gZm9yIHRoZWlyIG93biBzaGFwZXMuXG5jb25zdCBQUkVUVFlfVFNMT0dfUkUgPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9IFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9XFxzKyhUUkFDRXxERUJVR3xJTkZPfFdBUk4oPzpJTkcpP3xFUlJPUnxGQVRBTClcXHMrKC4qKSQvO1xuXG4vKiogUGVlbCBhIHRzbG9nIFwicHJldHR5XCIgYOKAuWRhdGXigLog4oC5dGltZeKAuiBMRVZFTCDigLlyZXN04oC6YCBwcmVmaXgsIGlmIHRoZSBsaW5lIG1hdGNoZXMuICovXG5mdW5jdGlvbiBwYXJzZVByZXR0eVRzbG9nUHJlZml4KHJhdzogc3RyaW5nKTogeyBsZXZlbDogc3RyaW5nOyBtZXNzYWdlOiBzdHJpbmcgfSB8IG51bGwge1xuXHRjb25zdCBtID0gcmF3Lm1hdGNoKFBSRVRUWV9UU0xPR19SRSk7XG5cdGlmICghbSkgcmV0dXJuIG51bGw7XG5cdGNvbnN0IFsgLCBsdmwsIHJlc3QgXSA9IG07XG5cdGNvbnN0IGxldmVsID0gbHZsLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aCgnd2FybicpID8gJ3dhcm4nIDogbHZsLnRvTG93ZXJDYXNlKCk7XG5cdHJldHVybiB7IGxldmVsLCBtZXNzYWdlOiByZXN0IH07XG59XG5cbi8qKlxuICogQVdTIExhbWJkYSBlbWl0cyB0ZXh0IGxvZ3MgYXMgYOKAuWlzb+KAulxcdOKAuXJlcXVlc3RJZOKAulxcdOKAuUxFVkVM4oC6XFx04oC5bWVzc2FnZeKAumAuIFBlZWwgdGhhdCBwcmVmaXggb2ZmIHNvIHRoZVxuICogbWVzc2FnZSBpcyBqdXN0IHRoZSB0ZXh0LCBhbmQgbGlmdCByZXF1ZXN0SWQvbGV2ZWwgb3V0IGFzIGZpZWxkcyAodGhleSdyZSBhbHJlYWR5IHNob3duIGFzIGNvbHVtbnMpLlxuICogUmV0dXJucyBudWxsIGlmIHRoZSBsaW5lIGlzbid0IGluIHRoYXQgZm9ybWF0LlxuICovXG5mdW5jdGlvbiBwYXJzZUxhbWJkYVByZWZpeChyYXc6IHN0cmluZyk6IHsgcmVxdWVzdElkOiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IG1lc3NhZ2U6IHN0cmluZyB9IHwgbnVsbCB7XG5cdGNvbnN0IHBhcnRzID0gcmF3LnNwbGl0KCdcXHQnKTtcblx0aWYgKHBhcnRzLmxlbmd0aCA8IDQpIHJldHVybiBudWxsO1xuXHRjb25zdCBbIHRzLCByZXF1ZXN0SWQsIGx2bCwgLi4ucmVzdCBdID0gcGFydHM7XG5cdGlmICghSVNPX1JFLnRlc3QodHMpIHx8ICFLTk9XTl9MRVZFTFMuaGFzKGx2bC50cmltKCkudG9Mb3dlckNhc2UoKSkpIHJldHVybiBudWxsO1xuXHRyZXR1cm4geyByZXF1ZXN0SWQsIGxldmVsOiBsdmwudHJpbSgpLnRvTG93ZXJDYXNlKCksIG1lc3NhZ2U6IHJlc3Quam9pbignXFx0JykudHJpbSgpIH07XG59XG5cbi8qKlxuICogVHVybiBhIHZlcmJvc2UgQ2xvdWRXYXRjaCBsb2ctZ3JvdXAgLyBsb2ctc3RyZWFtIGludG8gYSBzaG9ydCBmdW5jdGlvbiBuYW1lIGZvciB0aGUgYGhvc3RgIGxhYmVsLFxuICogZS5nLiBg4oCmLXBsdXNmYW50cmlhbHNzdHJlYW1wcm9jZXNzb3LigKZMb2dHcm91cOKApmAg4oaSIGBwbHVzZmFudHJpYWxzc3RyZWFtcHJvY2Vzc29yYC4gRmFsbHMgYmFjayB0byB0aGVcbiAqIHJhdyBsb2cgZ3JvdXAuIFRoZSBmdWxsIGxvZyBncm91cCBpcyBzdGlsbCBlbWl0dGVkIHNlcGFyYXRlbHkgYXMgYGxvZ0dyb3VwYC5cbiAqL1xuZnVuY3Rpb24gc2hvcnRIb3N0KGxvZ0dyb3VwOiBzdHJpbmcsIGxvZ1N0cmVhbTogc3RyaW5nKTogc3RyaW5nIHtcblx0Ly8gTGFtYmRhIGxvZyBzdHJlYW06IFwiWVlZWS9NTS9ERC88ZnVuY3Rpb25OYW1lPlskTEFURVNUXTxpZD5cIiDigJQgdGhlIGNsZWFuZXN0IHNvdXJjZSBvZiB0aGUgZm4gbmFtZS5cblx0Y29uc3Qgc20gPSBsb2dTdHJlYW0ubWF0Y2goL15cXGR7NH1cXC9cXGR7Mn1cXC9cXGR7Mn1cXC8oLis/KVxcW1xcJExBVEVTVFxcXS8pO1xuXHRpZiAoc20gJiYgc21bMV0pIHtcblx0XHRyZXR1cm4gc21bMV0ucmVwbGFjZSgvLVtBLVphLXowLTldezYsfSQvLCAnJyk7IC8vIGRyb3AgdGhlIENsb3VkRm9ybWF0aW9uIHJhbmRvbSBzdWZmaXhcblx0fVxuXHQvLyBGYWxsYmFjazogcGFyc2UgdGhlIGxvZyBncm91cCDigJQgc3RyaXAgdGhlIGDigKZMb2dHcm91cDxoYXNoPi08c3VmZml4PmAgdGFpbCwgdGFrZSB0aGUgbGFzdCBzZWdtZW50LFxuXHQvLyBhbmQgZGUtZHVwbGljYXRlIENESydzIGRvdWJsZWQgY29uc3RydWN0IG5hbWUgKGBmb29CYXJmb29CYXJgIOKGkiBgZm9vQmFyYCkuXG5cdGxldCBzID0gbG9nR3JvdXA7XG5cdGNvbnN0IGxnID0gcy5pbmRleE9mKCdMb2dHcm91cCcpO1xuXHRpZiAobGcgPiAwKSBzID0gcy5zbGljZSgwLCBsZyk7XG5cdGNvbnN0IG0gPSBzLm1hdGNoKC8oPzpzdGFjay18TmVzdGVkU3RhY2tSZXNvdXJjZVswLTlBLUZhLWZdKi0pKFteLV0rKSQvKTtcblx0aWYgKG0pIHMgPSBtWzFdO1xuXHRpZiAocy5sZW5ndGggPiAwICYmIHMubGVuZ3RoICUgMiA9PT0gMCkge1xuXHRcdGNvbnN0IGhhbGYgPSBzLmxlbmd0aCAvIDI7XG5cdFx0aWYgKHMuc2xpY2UoMCwgaGFsZikgPT09IHMuc2xpY2UoaGFsZikpIHMgPSBzLnNsaWNlKDAsIGhhbGYpO1xuXHR9XG5cdHJldHVybiBzIHx8IGxvZ0dyb3VwO1xufVxuXG4vKipcbiAqIFJlc2hhcGUgb25lIENsb3VkV2F0Y2ggbG9nIGV2ZW50IGludG8gYSBjbGVhbiBWZWN0b3IgcmVjb3JkLCB0aGVuIGFwcGx5IHRoZSBhcHAtbGV2ZWwgbm9pc2Uvc2V2ZXJpdHlcbiAqIHJ1bGVzLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBldmVudCBzaG91bGQgYmUgZHJvcHBlZCAocGxhdGZvcm0gbm9pc2Ugb3IgYSBcImRyb3BcIiBydWxlIG1hdGNoKS5cbiAqXG4gKiBmdzI0IGxvZ3MgYXJlIHRzbG9nIEpTT04gbGlrZSBge1wiMFwiOlwidGhlIG1lc3NhZ2VcIixcIjFcIjp7Li4uYXJnfSxcIl9tZXRhXCI6e1wibmFtZVwiOlwiQVBJQ29uc3RydWN0XCIsXG4gKiBcImxvZ0xldmVsTmFtZVwiOlwiSU5GT1wiLFwiZGF0ZVwiOlwiLi4uXCJ9fWAuIFdlIGxpZnQgdGhlIHJlYWwgbWVzc2FnZSBvdXQgb2YgdGhlIHBvc2l0aW9uYWwga2V5cyBhbmQgdGhlXG4gKiBjb21wb25lbnQvbGV2ZWwvdGltZSBvdXQgb2YgYF9tZXRhYCwgc28gTG9ndHJhaWwgc2hvd3MgcmVhZGFibGUgbGluZXMgaW5zdGVhZCBvZiBhIHJhdyBKU09OIGJsb2IuXG4gKiBOb24tSlNPTiBsaW5lcyAoTGFtYmRhIFNUQVJUL0VORC9SRVBPUlQsIHBsYWluIHRleHQpIHBhc3MgdGhyb3VnaCB1bmNoYW5nZWQuXG4gKi9cbmZ1bmN0aW9uIHRvVmVjdG9yUmVjb3JkKFxuXHRlOiB7IHRpbWVzdGFtcDogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfSxcblx0bG9nR3JvdXA6IHN0cmluZyxcblx0bG9nU3RyZWFtOiBzdHJpbmcsXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwge1xuXHRjb25zdCByYXcgPSAoZS5tZXNzYWdlID8/ICcnKS5yZXBsYWNlKC9cXHMrJC8sICcnKTtcblxuXHQvLyDilIDilIAgMSkgRFJPUDogTGFtYmRhIHBsYXRmb3JtIGxpbmVzIHRoYXQgYXJlIHB1cmUgbm9pc2UuIOKUgOKUgFxuXHRpZiAoaXNQbGF0Zm9ybU5vaXNlKHJhdy50cmltU3RhcnQoKSkpIHtcblx0XHRyZXR1cm4gbnVsbDtcblx0fVxuXG5cdGxldCBtZXNzYWdlID0gcmF3O1xuXHRsZXQgbGV2ZWw6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGxvZ2dlcjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgcmVxdWVzdElkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBjb3JyZWxhdGlvbklkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCB0c0lzbzogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgbGlmdGVkOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkO1xuXHRsZXQgY29kZUxvYzogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG5cdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IHBlZWwgQVdTIExhbWJkYSdzIGDigLlpc2/igLpcXHTigLlyZXF1ZXN0SWTigLpcXHTigLlMRVZFTOKAulxcdOKAuW1lc3NhZ2XigLpgIHRleHQgcHJlZml4LCBpZiBwcmVzZW50LlxuXHRjb25zdCBsYW1iZGEgPSBwYXJzZUxhbWJkYVByZWZpeChyYXcpO1xuXHRpZiAobGFtYmRhKSB7XG5cdFx0cmVxdWVzdElkID0gbGFtYmRhLnJlcXVlc3RJZDtcblx0XHRsZXZlbCA9IGxhbWJkYS5sZXZlbDtcblx0XHRtZXNzYWdlID0gbGFtYmRhLm1lc3NhZ2U7XG5cdH1cblxuXHQvLyDilIDilIAgMSkgTk9STUFMSVpFOiBpZiB0aGUgcmVtYWluaW5nIG1lc3NhZ2UgaXMgZncyNCB0c2xvZyBKU09OLCBsaWZ0IHRoZSByZWFsIHRleHQgKyBjb21wb25lbnQvbGV2ZWwvdGltZS5cblx0Y29uc3QgYm9keSA9IG1lc3NhZ2U7XG5cdGlmIChib2R5LmNoYXJDb2RlQXQoMCkgPT09IDB4N2IgLyogeyAqLykge1xuXHRcdHRyeSB7XG5cdFx0XHRjb25zdCBvID0gSlNPTi5wYXJzZShib2R5KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblx0XHRcdGNvbnN0IG1ldGEgPSBvLl9tZXRhIGFzIHtcblx0XHRcdFx0bmFtZT86IHVua25vd247IGxvZ0xldmVsTmFtZT86IHVua25vd247IGRhdGU/OiB1bmtub3duOyBjb3JyZWxhdGlvbklkPzogdW5rbm93bjtcblx0XHRcdFx0cGF0aD86IHsgZmlsZVBhdGhXaXRoTGluZT86IHVua25vd247IGZpbGVOYW1lPzogdW5rbm93bjsgZmlsZUxpbmU/OiB1bmtub3duIH07XG5cdFx0XHR9IHwgdW5kZWZpbmVkO1xuXHRcdFx0aWYgKG1ldGEgJiYgdHlwZW9mIG1ldGEgPT09ICdvYmplY3QnKSB7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5uYW1lID09PSAnc3RyaW5nJykgbG9nZ2VyID0gbWV0YS5uYW1lO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEubG9nTGV2ZWxOYW1lID09PSAnc3RyaW5nJykgbGV2ZWwgPSBtZXRhLmxvZ0xldmVsTmFtZS50b0xvd2VyQ2FzZSgpO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuZGF0ZSA9PT0gJ3N0cmluZycgJiYgIU51bWJlci5pc05hTihEYXRlLnBhcnNlKG1ldGEuZGF0ZSkpKSB7XG5cdFx0XHRcdFx0dHNJc28gPSBuZXcgRGF0ZShtZXRhLmRhdGUpLnRvSVNPU3RyaW5nKCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIG1ldGEuY29ycmVsYXRpb25JZC50cmltKCkpIGNvcnJlbGF0aW9uSWQgPSBtZXRhLmNvcnJlbGF0aW9uSWQudHJpbSgpO1xuXHRcdFx0XHQvLyB0c2xvZyBuYXRpdmUgc291cmNlIHBvc2l0aW9uIChtb2RlICdhbGwnKTogX21ldGEucGF0aC5cblx0XHRcdFx0Y29uc3QgcCA9IG1ldGEucGF0aDtcblx0XHRcdFx0aWYgKHAgJiYgdHlwZW9mIHAgPT09ICdvYmplY3QnKSB7XG5cdFx0XHRcdFx0aWYgKHR5cGVvZiBwLmZpbGVQYXRoV2l0aExpbmUgPT09ICdzdHJpbmcnKSBjb2RlTG9jID0gcC5maWxlUGF0aFdpdGhMaW5lO1xuXHRcdFx0XHRcdGVsc2UgaWYgKHR5cGVvZiBwLmZpbGVOYW1lID09PSAnc3RyaW5nJyAmJiBwLmZpbGVMaW5lICE9IG51bGwpIGNvZGVMb2MgPSBgJHtwLmZpbGVOYW1lfToke3AuZmlsZUxpbmV9YDtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0Ly8gUG9zaXRpb25hbCBhcmdzIFwiMFwiLi5cIm5cIiBob2xkIHRoZSBsb2dnZWQgbWVzc2FnZSArIHBhcmFtcy4gQSBgeyBfc3JjbG9jIH1gIGFyZyAobW9kZVxuXHRcdFx0Ly8gJ3dhcm4tZXJyb3InKSBjYXJyaWVzIHRoZSBjYWxsZXIncyBzb3VyY2UgcG9zaXRpb24g4oCUIGxpZnQgaXQsIGtlZXAgaXQgb3V0IG9mIHRoZSBtZXNzYWdlLlxuXHRcdFx0Y29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG5cdFx0XHRmb3IgKGxldCBpID0gMDsgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIFN0cmluZyhpKSk7IGkrKykge1xuXHRcdFx0XHRjb25zdCB2ID0gb1tTdHJpbmcoaSldO1xuXHRcdFx0XHRpZiAodiAmJiB0eXBlb2YgdiA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodikgJiYgdHlwZW9mICh2IGFzIHsgX3NyY2xvYz86IHVua25vd24gfSkuX3NyY2xvYyA9PT0gJ3N0cmluZycpIHtcblx0XHRcdFx0XHRpZiAoIWNvZGVMb2MpIGNvZGVMb2MgPSAodiBhcyB7IF9zcmNsb2M6IHN0cmluZyB9KS5fc3JjbG9jO1xuXHRcdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0XHR9XG5cdFx0XHRcdHBhcnRzLnB1c2godHlwZW9mIHYgPT09ICdzdHJpbmcnID8gdiA6IEpTT04uc3RyaW5naWZ5KHYpKTtcblx0XHRcdH1cblx0XHRcdGlmIChwYXJ0cy5sZW5ndGggPiAwKSBtZXNzYWdlID0gcGFydHMuam9pbignICcpO1xuXG5cdFx0XHQvLyBMaWZ0IGFwcC1kZWNsYXJlZCBzdHJ1Y3R1cmVkIGZpZWxkcyAoY29ycmVsYXRpb25JZCwgb3JkZXJJZCwg4oCmKSBpbnRvIHF1ZXJ5YWJsZSByZWNvcmQgZmllbGRzLlxuXHRcdFx0aWYgKEhBU19MSUZUX0ZJRUxEUykge1xuXHRcdFx0XHRjb25zdCBmID0gZXh0cmFjdExpZnRlZEZpZWxkcyhvKTtcblx0XHRcdFx0aWYgKE9iamVjdC5rZXlzKGYpLmxlbmd0aCA+IDApIGxpZnRlZCA9IGY7XG5cdFx0XHR9XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyBub3QgSlNPTiBhZnRlciBhbGwg4oCUIGtlZXAgdGhlIChwcmVmaXgtc3RyaXBwZWQpIG1lc3NhZ2Vcblx0XHR9XG5cdH0gZWxzZSB7XG5cdFx0Ly8g4pSA4pSAIDEpIE5PUk1BTElaRTogdHNsb2cncyBcInByZXR0eVwiIChub24tSlNPTikgY29uc29sZSBmb3JtYXQg4oCUIHN0cmlwIGl0cyBvd24gZHVwbGljYXRlIGRhdGUrbGV2ZWwuXG5cdFx0Y29uc3QgcHJldHR5ID0gcGFyc2VQcmV0dHlUc2xvZ1ByZWZpeChib2R5KTtcblx0XHRpZiAocHJldHR5KSB7XG5cdFx0XHRpZiAoIWxldmVsKSBsZXZlbCA9IHByZXR0eS5sZXZlbDtcblx0XHRcdG1lc3NhZ2UgPSBwcmV0dHkubWVzc2FnZTtcblx0XHR9XG5cdH1cblxuXHRjb25zdCBjbGVhbk1lc3NhZ2UgPSBzdHJpcEFuc2kobWVzc2FnZSk7XG5cdGxldCByZXNvbHZlZExldmVsID0gbGV2ZWwgPz8gZmFsbGJhY2tMZXZlbChyYXcpO1xuXHRsZXQgcmVjbGFzc2lmaWVkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cblx0Ly8gU3BsaXQgdGhlIGNhcHR1cmVkIHNvdXJjZSBwb3NpdGlvbiBpbnRvIHF1ZXJ5YWJsZSBgY29kZUZpbGVgICsgYGNvZGVMaW5lYCAoZm9yIFwib3BlbiB0aGUgZXhhY3Rcblx0Ly8gY3VscHJpdCBsaW5lXCIgbGlua3MpLiBQYXRoIGlzIG1hZGUgcmVwby1yZWxhdGl2ZSAoa2VwdCBmcm9tIGl0cyBsYXN0IGBzcmMvYCBzZWdtZW50KS5cblx0bGV0IGNvZGVGaWxlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBjb2RlTGluZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRpZiAoY29kZUxvYykge1xuXHRcdGNvbnN0IG0gPSBjb2RlTG9jLm1hdGNoKC9eKC4qPyk6KFxcZCspKD86OlxcZCspPyQvKTtcblx0XHRpZiAobSkge1xuXHRcdFx0Ly8gQWJzb2x1dGUgcGF0aCAo4oCmL3NyYy/igKYpIOKGkiBtYWtlIHJlcG8tcmVsYXRpdmUgZnJvbSB0aGUgbGFzdCBgc3JjL2AuIEFscmVhZHktcmVsYXRpdmUgcGF0aHNcblx0XHRcdC8vICh0aGUgbG9nZ2luZyBsYXllciBlbWl0cyBgc3JjL+KApmApIGFyZSBrZXB0IGFzLWlzLlxuXHRcdFx0Y29uc3Qgc3JjSWR4ID0gbVsxXS5sYXN0SW5kZXhPZignL3NyYy8nKTtcblx0XHRcdGNvZGVGaWxlID0gc3JjSWR4ID49IDAgPyBtWzFdLnNsaWNlKHNyY0lkeCArIDEpIDogbVsxXTtcblx0XHRcdGNvZGVMaW5lID0gbVsyXTtcblx0XHR9XG5cdH1cblxuXHQvLyDilIDilIAgTGF5ZXJzIDLigJM0OiBhcHAtbGV2ZWwgbm9pc2UgLyBzZXZlcml0eSBydWxlcywgYXBwbGllZCB0byB0aGUgbm9ybWFsaXplZCBtZXNzYWdlLiDilIDilIBcblx0aWYgKEhBU19OT0lTRV9SVUxFUykge1xuXHRcdC8vIDIpIFJFQ0xBU1NJRlk6IGJlbmlnbiBcImVycm9yc1wiIOKGkiB3YXJuIChvbmx5IGRvd25ncmFkZSwgbmV2ZXIgdXBncmFkZSkuXG5cdFx0aWYgKEVSUk9SSVNILmhhcyhyZXNvbHZlZExldmVsKSAmJiBhbnlNYXRjaChCRU5JR05fUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJlc29sdmVkTGV2ZWwgPSAnd2Fybic7XG5cdFx0XHRyZWNsYXNzaWZpZWQgPSAnYmVuaWduJztcblx0XHR9XG5cdFx0Ly8gMykgRFJPUDogbm9pc2UgcmVtb3ZlZCBlbnRpcmVseSAobmV2ZXIgc2hpcHBlZCDigJQgc2F2ZXMgaW5nZXN0IGJhbmR3aWR0aCBhdCB0aGUgc291cmNlKS5cblx0XHRpZiAoYW55TWF0Y2goRFJPUF9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmV0dXJuIG51bGw7XG5cdFx0fVxuXHRcdC8vIDQpIERPV05HUkFERTogbm9pc2Uga2VwdCBidXQgZGUtZW1waGFzaXNlZCB0byBkZWJ1Zy5cblx0XHRpZiAoYW55TWF0Y2goRE9XTkdSQURFX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXNvbHZlZExldmVsID0gJ2RlYnVnJztcblx0XHRcdHJlY2xhc3NpZmllZCA9ICdub2lzZSc7XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRzZXJ2aWNlOiBTRVJWSUNFLFxuXHRcdGVudjogRU5WLFxuXHRcdC4uLihSRVNPTFZFRF9BQ0NPVU5UID8geyBhY2NvdW50OiBSRVNPTFZFRF9BQ0NPVU5UIH0gOiB7fSksXG5cdFx0Li4uKFJFR0lPTiA/IHsgcmVnaW9uOiBSRUdJT04gfSA6IHt9KSxcblx0XHQuLi4oVkVSU0lPTiA/IHsgdmVyc2lvbjogVkVSU0lPTiB9IDoge30pLFxuXHRcdGhvc3Q6IHNob3J0SG9zdChsb2dHcm91cCwgbG9nU3RyZWFtKSxcblx0XHQuLi4obG9nZ2VyID8geyBsb2dnZXIgfSA6IHt9KSxcblx0XHQuLi4ocmVxdWVzdElkID8geyByZXF1ZXN0SWQgfSA6IHt9KSxcblx0XHQuLi4obGlmdGVkID8/IHt9KSxcblx0XHQuLi4oY29ycmVsYXRpb25JZCA/IHsgY29ycmVsYXRpb25JZCB9IDoge30pLFxuXHRcdC4uLihjb2RlRmlsZSA/IHsgY29kZUZpbGUgfSA6IHt9KSxcblx0XHQuLi4oY29kZUxpbmUgPyB7IGNvZGVMaW5lIH0gOiB7fSksXG5cdFx0bGV2ZWw6IHJlc29sdmVkTGV2ZWwsXG5cdFx0Li4uKHJlY2xhc3NpZmllZCA/IHsgcmVjbGFzc2lmaWVkIH0gOiB7fSksXG5cdFx0bWVzc2FnZTogY2xlYW5NZXNzYWdlLFxuXHRcdHRpbWVzdGFtcDogdHNJc28gPz8gbmV3IERhdGUoZS50aW1lc3RhbXApLnRvSVNPU3RyaW5nKCksXG5cdFx0bG9nR3JvdXAsXG5cdFx0bG9nU3RyZWFtLFxuXHR9O1xufVxuXG4vKiogU3BsaXQgcHJlLXNlcmlhbGl6ZWQgbGluZXMgaW50byBzdWItYmF0Y2hlcyB1bmRlciBNQVhfQkFUQ0hfQllURVMgKHVuY29tcHJlc3NlZCkuICovXG5mdW5jdGlvbiBjaHVua0xpbmVzKGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZ1tdW10ge1xuXHRjb25zdCBjaHVua3M6IHN0cmluZ1tdW10gPSBbXTtcblx0bGV0IGN1cnJlbnQ6IHN0cmluZ1tdID0gW107XG5cdGxldCBzaXplID0gMDtcblx0Zm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG5cdFx0Y29uc3QgbGluZUJ5dGVzID0gQnVmZmVyLmJ5dGVMZW5ndGgobGluZSkgKyAxOyAvLyArMSBmb3IgdGhlIGRlbGltaXRlclxuXHRcdGlmIChjdXJyZW50Lmxlbmd0aCA+IDAgJiYgc2l6ZSArIGxpbmVCeXRlcyA+IE1BWF9CQVRDSF9CWVRFUykge1xuXHRcdFx0Y2h1bmtzLnB1c2goY3VycmVudCk7XG5cdFx0XHRjdXJyZW50ID0gW107XG5cdFx0XHRzaXplID0gMDtcblx0XHR9XG5cdFx0Y3VycmVudC5wdXNoKGxpbmUpO1xuXHRcdHNpemUgKz0gbGluZUJ5dGVzO1xuXHR9XG5cdGlmIChjdXJyZW50Lmxlbmd0aCA+IDApIHtcblx0XHRjaHVua3MucHVzaChjdXJyZW50KTtcblx0fVxuXHRyZXR1cm4gY2h1bmtzO1xufVxuXG5mdW5jdGlvbiBlbmNvZGVCb2R5KGxpbmVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG5cdC8vIGxpbmVzIGFyZSBhbHJlYWR5IEpTT04gc3RyaW5nc1xuXHRyZXR1cm4gQkFUQ0hfRk9STUFUID09PSAnanNvbi1hcnJheScgPyBgWyR7bGluZXMuam9pbignLCcpfV1gIDogbGluZXMuam9pbignXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHBvc3QoZ3ppcHBlZDogQnVmZmVyKTogUHJvbWlzZTx2b2lkPiB7XG5cdHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0Y29uc3QgdXJsID0gbmV3IFVSTChJTkdFU1RfVVJMISk7XG5cdFx0Y29uc3QgaXNIdHRwcyA9IHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOic7XG5cdFx0Y29uc3QgbGliID0gaXNIdHRwcyA/IGh0dHBzIDogaHR0cDtcblx0XHRjb25zdCByZXEgPSBsaWIucmVxdWVzdChcblx0XHRcdHVybCxcblx0XHRcdHtcblx0XHRcdFx0bWV0aG9kOiAnUE9TVCcsXG5cdFx0XHRcdGFnZW50OiBpc0h0dHBzID8gaHR0cHNBZ2VudCA6IGh0dHBBZ2VudCxcblx0XHRcdFx0aGVhZGVyczoge1xuXHRcdFx0XHRcdCdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG5cdFx0XHRcdFx0J0NvbnRlbnQtRW5jb2RpbmcnOiAnZ3ppcCcsXG5cdFx0XHRcdFx0J0NvbnRlbnQtTGVuZ3RoJzogZ3ppcHBlZC5sZW5ndGgsXG5cdFx0XHRcdFx0Li4uKFhfQVBJX0tFWSA/IHsgJ3gtYXBpLWtleSc6IFhfQVBJX0tFWSB9IDoge30pLFxuXHRcdFx0XHR9LFxuXHRcdFx0fSxcblx0XHRcdChyZXMpID0+IHtcblx0XHRcdFx0cmVzLnJlc3VtZSgpOyAvLyBkcmFpbiBzbyB0aGUgc29ja2V0IGNhbiBiZSByZXVzZWRcblx0XHRcdFx0Y29uc3Qgc3RhdHVzID0gcmVzLnN0YXR1c0NvZGUgPz8gMDtcblx0XHRcdFx0aWYgKHN0YXR1cyA+PSAyMDAgJiYgc3RhdHVzIDwgMzAwKSB7XG5cdFx0XHRcdFx0cmVzb2x2ZSgpO1xuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdHJlamVjdChuZXcgRXJyb3IoYGluZ2VzdCByZXNwb25kZWQgJHtzdGF0dXN9YCkpO1xuXHRcdFx0XHR9XG5cdFx0XHR9LFxuXHRcdCk7XG5cdFx0cmVxLm9uKCdlcnJvcicsIHJlamVjdCk7XG5cdFx0cmVxLnNldFRpbWVvdXQoUE9TVF9USU1FT1VUX01TLCAoKSA9PiByZXEuZGVzdHJveShuZXcgRXJyb3IoJ2luZ2VzdCB0aW1lb3V0JykpKTtcblx0XHRyZXEuZW5kKGd6aXBwZWQpO1xuXHR9KTtcbn1cblxuLyoqIFBPU1Qgb25lIGNodW5rIHdpdGggYSBzaW5nbGUgcmV0cnkuIFJldHVybnMgZmFsc2UgaWYgdGhlIGNodW5rIHdhcyBkcm9wcGVkIGFmdGVyIHJldHJpZXMuICovXG5hc3luYyBmdW5jdGlvbiBzaGlwV2l0aFJldHJ5KGd6aXBwZWQ6IEJ1ZmZlcik6IFByb21pc2U8Ym9vbGVhbj4ge1xuXHRmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8PSBNQVhfUkVUUklFUzsgYXR0ZW1wdCsrKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGF3YWl0IHBvc3QoZ3ppcHBlZCk7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9IGNhdGNoIChlcnIpIHtcblx0XHRcdGlmIChhdHRlbXB0ID09PSBNQVhfUkVUUklFUykge1xuXHRcdFx0XHQvLyBTd2FsbG93IGFmdGVyIHJldHJpZXM6IGEgcGVyc2lzdGVudCBpbmdlc3Qgb3V0YWdlIG11c3Qgbm90IGNyZWF0ZSBhIENsb3VkV2F0Y2ggcmV0cnkgc3Rvcm0uXG5cdFx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBzaGlwIGZhaWxlZCwgZHJvcHBpbmcgY2h1bms6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0XHRcdHJldHVybiBmYWxzZTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vKiogRW1pdCBhbiBhbGFybWFibGUgQ2xvdWRXYXRjaCBtZXRyaWMgKEVNRikgd2hlbiByZWNvcmRzIGFyZSBkcm9wcGVkIOKAlCBubyBTREssIGp1c3Qgc3RydWN0dXJlZCBzdGRvdXQuICovXG5mdW5jdGlvbiBlbWl0RHJvcHBlZE1ldHJpYyhyZWNvcmRzOiBudW1iZXIpOiB2b2lkIHtcblx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0Y29uc29sZS5sb2coXG5cdFx0SlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0X2F3czoge1xuXHRcdFx0XHRUaW1lc3RhbXA6IERhdGUubm93KCksXG5cdFx0XHRcdENsb3VkV2F0Y2hNZXRyaWNzOiBbXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0TmFtZXNwYWNlOiAnTG9nRm9yd2FyZGVyJyxcblx0XHRcdFx0XHRcdERpbWVuc2lvbnM6IFsgWyAnc2VydmljZScgXSBdLFxuXHRcdFx0XHRcdFx0TWV0cmljczogWyB7IE5hbWU6ICdEcm9wcGVkUmVjb3JkcycsIFVuaXQ6ICdDb3VudCcgfSBdLFxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdF0sXG5cdFx0XHR9LFxuXHRcdFx0c2VydmljZTogU0VSVklDRSxcblx0XHRcdERyb3BwZWRSZWNvcmRzOiByZWNvcmRzLFxuXHRcdH0pLFxuXHQpO1xufVxuXG5pbnRlcmZhY2UgTGFtYmRhQ29udGV4dExpa2Uge1xuXHRpbnZva2VkRnVuY3Rpb25Bcm4/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBDbG91ZFdhdGNoTG9nc0V2ZW50LCBjb250ZXh0PzogTGFtYmRhQ29udGV4dExpa2UpOiBQcm9taXNlPHZvaWQ+ID0+IHtcblx0Ly8gUmVzb2x2ZSB0aGUgYWNjb3VudCBmcm9tIHRoaXMgZm9yd2FyZGVyJ3Mgb3duIEFSTiBvbmNlIChzYW1lIGZvciBldmVyeSBpbnZvY2F0aW9uKS5cblx0aWYgKCFSRVNPTFZFRF9BQ0NPVU5UICYmIGNvbnRleHQ/Lmludm9rZWRGdW5jdGlvbkFybikge1xuXHRcdFJFU09MVkVEX0FDQ09VTlQgPSBhY2NvdW50RnJvbUFybihjb250ZXh0Lmludm9rZWRGdW5jdGlvbkFybik7XG5cdH1cblx0aWYgKCFJTkdFU1RfVVJMKSB7XG5cdFx0cmV0dXJuOyAvLyBub3QgY29uZmlndXJlZCB5ZXQg4oCUIG5vLW9wIChzYWZlIHRvIGRlcGxveSBiZWZvcmUgd2lyaW5nIHRoZSBpbmdlc3QgVVJMKVxuXHR9XG5cblx0bGV0IHBheWxvYWQ6IERlY29kZWRQYXlsb2FkO1xuXHR0cnkge1xuXHRcdHBheWxvYWQgPSBKU09OLnBhcnNlKGd1bnppcFN5bmMoQnVmZmVyLmZyb20oZXZlbnQuYXdzbG9ncy5kYXRhLCAnYmFzZTY0JykpLnRvU3RyaW5nKCd1dGY4JykpIGFzIERlY29kZWRQYXlsb2FkO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdGNvbnNvbGUuZXJyb3IoJ1tsb2ctZm9yd2FyZGVyXSBmYWlsZWQgdG8gZGVjb2RlIHBheWxvYWQ6JywgKGVyciBhcyBFcnJvcikubWVzc2FnZSk7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0aWYgKHBheWxvYWQubWVzc2FnZVR5cGUgPT09ICdDT05UUk9MX01FU1NBR0UnKSB7XG5cdFx0cmV0dXJuOyAvLyBzdWJzY3JpcHRpb24gbGl2ZW5lc3MgcGluZ1xuXHR9XG5cdGNvbnN0IGV2ZW50cyA9IHBheWxvYWQubG9nRXZlbnRzO1xuXHRpZiAoIUFycmF5LmlzQXJyYXkoZXZlbnRzKSB8fCBldmVudHMubGVuZ3RoID09PSAwKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG5cdGZvciAoY29uc3QgZSBvZiBldmVudHMpIHtcblx0XHRjb25zdCByZWNvcmQgPSB0b1ZlY3RvclJlY29yZChlLCBwYXlsb2FkLmxvZ0dyb3VwLCBwYXlsb2FkLmxvZ1N0cmVhbSk7XG5cdFx0aWYgKHJlY29yZCAhPT0gbnVsbCkge1xuXHRcdFx0bGluZXMucHVzaChKU09OLnN0cmluZ2lmeShyZWNvcmQpKTtcblx0XHR9XG5cdH1cblx0aWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkge1xuXHRcdHJldHVybjsgLy8gd2hvbGUgYmF0Y2ggd2FzIG5vaXNlIC8gZHJvcHBlZFxuXHR9XG5cdGxldCBkcm9wcGVkID0gMDtcblx0Zm9yIChjb25zdCBjaHVuayBvZiBjaHVua0xpbmVzKGxpbmVzKSkge1xuXHRcdGNvbnN0IGd6aXBwZWQgPSBnemlwU3luYyhCdWZmZXIuZnJvbShlbmNvZGVCb2R5KGNodW5rKSkpO1xuXHRcdGNvbnN0IG9rID0gYXdhaXQgc2hpcFdpdGhSZXRyeShnemlwcGVkKTtcblx0XHRpZiAoIW9rKSB7XG5cdFx0XHRkcm9wcGVkICs9IGNodW5rLmxlbmd0aDtcblx0XHR9XG5cdH1cblx0aWYgKGRyb3BwZWQgPiAwKSB7XG5cdFx0ZW1pdERyb3BwZWRNZXRyaWMoZHJvcHBlZCk7XG5cdH1cbn07XG4iXX0=