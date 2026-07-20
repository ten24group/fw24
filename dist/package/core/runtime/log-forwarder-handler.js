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
// ── Field drop-list (FORWARDER_DROP_FIELDS): record keys to OMIT before shipping, to cut ingest/storage
//    size on low-value fields. Default drops logStream/logGroup/source_type/reason (host is still kept).
//    The construct sets this from the `dropFields` config; unset → the defaults below. Core keys can
//    never be dropped (belt-and-suspenders against misconfig). ──
const DEFAULT_DROP_FIELDS = ['logStream', 'logGroup', 'source_type', 'reason'];
const NEVER_DROP = new Set(['service', 'level', 'message', 'timestamp']);
const DROP_SET = new Set((process.env.FORWARDER_DROP_FIELDS !== undefined
    ? parseFieldList(process.env.FORWARDER_DROP_FIELDS)
    : DEFAULT_DROP_FIELDS).filter((k) => !NEVER_DROP.has(k)));
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
            // Lift app-declared structured fields (correlationId, orderId, …) FIRST, so those keys can be
            // kept OUT of the human message below (no duplicating a lifted id in both the field and the text).
            if (HAS_LIFT_FIELDS) {
                const f = extractLiftedFields(o);
                if (Object.keys(f).length > 0)
                    lifted = f;
            }
            const liftedKeys = lifted ? new Set(Object.keys(lifted)) : new Set();
            // Positional args "0".."n" hold the logged message + params. Build the human message from the
            // string args plus the NON-lifted keys of object args (lifted ids become fields, not message
            // noise). A `{ _srcloc }` arg carries the caller's source position — lifted, kept out of the text.
            const parts = [];
            for (let i = 0; Object.prototype.hasOwnProperty.call(o, String(i)); i++) {
                const v = o[String(i)];
                if (typeof v === 'string') {
                    parts.push(v);
                    continue;
                }
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    const obj = v;
                    if (typeof obj._srcloc === 'string') {
                        if (!codeLoc)
                            codeLoc = obj._srcloc;
                        continue;
                    }
                    const rest = {};
                    for (const [k, val] of Object.entries(obj))
                        if (!liftedKeys.has(k))
                            rest[k] = val;
                    if (Object.keys(rest).length > 0)
                        parts.push(JSON.stringify(rest));
                    continue;
                }
                parts.push(JSON.stringify(v));
            }
            if (parts.length > 0)
                message = parts.join(' ');
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
    const rec = {
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
    // Drop low-value fields (FORWARDER_DROP_FIELDS) to cut ingest/storage size. `host` (derived from
    // logGroup/logStream) is kept, so dropping the raw group/stream loses nothing actionable.
    if (DROP_SET.size)
        for (const k of DROP_SET)
            delete rec[k];
    return rec;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBZ0NHO0FBQ0gseUNBQWlEO0FBQ2pELGdEQUFrQztBQUNsQyxrREFBb0M7QUFDcEMsdUNBQStCO0FBRS9CLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDeEUscUdBQXFHO0FBQ3JHLGdHQUFnRztBQUNoRyxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDM0QsdUdBQXVHO0FBQ3ZHLHFHQUFxRztBQUNyRyxrRkFBa0Y7QUFDbEYsTUFBTSxPQUFPLEdBQUcsR0FBRyxJQUFJLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDbkYsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUVqRSxxR0FBcUc7QUFDckcsc0dBQXNHO0FBQ3RHLHFHQUFxRztBQUNyRyxzRkFBc0Y7QUFDdEYsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDO0FBQ3BELElBQUksZ0JBQWdCLEdBQUcs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QU0sT0FBTyxHQUFHLElBQUEsb0JBQVEsRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDekQsTUFBTSxFQUFFLEdBQUcsTUFBTSxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDeEMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ1QsT0FBTyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDekIsQ0FBQztJQUNGLENBQUM7SUFDRCxJQUFJLE9BQU8sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNqQixpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM1QixDQUFDO0FBQ0YsQ0FBQyxDQUFDO0FBL0NXLFFBQUEsT0FBTyxXQStDbEIiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENsb3VkV2F0Y2ggTG9ncyAtPiBWZWN0b3IvTG9ndHJhaWwgZm9yd2FyZGVyIChvdXQtb2YtYmFuZCBsb2cgc2hpcHBpbmcpLlxuICpcbiAqIEFwcCBMYW1iZGFzIG9ubHkgd3JpdGUgdG8gc3Rkb3V0IChDbG91ZFdhdGNoKSDigJQgbm90aGluZyBydW5zIGluIHRoZWlyIHJlcXVlc3QgcGF0aC4gQSBDbG91ZFdhdGNoXG4gKiBMb2dzIHN1YnNjcmlwdGlvbiBmaWx0ZXIgc3RyZWFtcyBiYXRjaGVkLCBnemlwcGVkIGV2ZW50cyB0byB0aGlzIGZ1bmN0aW9uLCB3aGljaCByZXNoYXBlcyB0aGVtIHRvXG4gKiBjbGVhbiBWZWN0b3IgSlNPTiByZWNvcmRzIGFuZCBzaGlwcyB0aGVtIHRvIHRoZSBpbmdlc3QgZW5kcG9pbnQgb3ZlciBhIGtlZXAtYWxpdmUgY29ubmVjdGlvbixcbiAqIGd6aXAtY29tcHJlc3NlZCBhbmQgc3BsaXQgaW50byBib3VuZGVkIHN1Yi1iYXRjaGVzLlxuICpcbiAqIFByb2Nlc3NpbmcgcGlwZWxpbmUgcGVyIGV2ZW50IChzZWUgYExvZ0ZvcndhcmRlckNvbnN0cnVjdGApOlxuICogICAxLiBOT1JNQUxJWkUgIOKAlCBwZWVsIEFXUyBMYW1iZGEncyB0ZXh0IHByZWZpeCwgbGlmdCBmdzI0IHRzbG9nIEpTT04sIHN0cmlwIEFOU0ksIHNob3J0ZW4gaG9zdC5cbiAqICAgMi4gUkVDTEFTU0lGWSDigJQgZXJyb3ItaXNoIGxpbmVzIG1hdGNoaW5nIGEgXCJiZW5pZ25cIiBwYXR0ZXJuIOKGkiBgd2FybmAgKGByZWNsYXNzaWZpZWQ6IFwiYmVuaWduXCJgKS5cbiAqICAgMy4gRFJPUCAgICAgICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRyb3BcIiBwYXR0ZXJuIGFyZSByZW1vdmVkIGVudGlyZWx5IChzYXZlZCBiYW5kd2lkdGggYXQgc291cmNlKS5cbiAqICAgNC4gRE9XTkdSQURFICDigJQgbGluZXMgbWF0Y2hpbmcgYSBcImRvd25ncmFkZVwiIHBhdHRlcm4g4oaSIGBkZWJ1Z2AgKGByZWNsYXNzaWZpZWQ6IFwibm9pc2VcImApLlxuICogU3RlcHMgMuKAkzQgYXJlIGFwcC1vd25lZCBydWxlIGxpc3RzIChlbnYtaW5qZWN0ZWQgYnkgdGhlIGNvbnN0cnVjdCksIGNvbXBsZW1lbnRhcnkgdG8gYW55IGdsb2JhbFxuICogc2V2ZXJpdHkvbm9pc2UgaGFuZGxpbmcgYSBzaGFyZWQgVmVjdG9yIGluZ2VzdCBtYXkgYWxzbyBhcHBseS5cbiAqXG4gKiBFdmVyeSByZWNvcmQgYWxzbyBjYXJyaWVzIGBhY2NvdW50YCArIGByZWdpb25gIChmcm9tIHRoZSBmb3J3YXJkZXIncyBvd24gQVJOKSBzbyBkZXBsb3ltZW50cyB0aGF0XG4gKiBzaGFyZSBhcHAgKyBlbnYgbmFtZXMg4oCUIGUuZy4gbXVsdGlwbGUgZGV2ZWxvcGVycyBlYWNoIHJ1bm5pbmcgYHBsdXNmYW4tdHJpYWxzYCAoQVBQX0VOVklST05NRU5UPWxvY2FsKVxuICogaW4gdGhlaXIgT1dOIGFjY291bnQg4oCUIHN0YXkgZGlzdGluZ3Vpc2hhYmxlIGluc3RlYWQgb2YgY29sbGlkaW5nIHVuZGVyIG9uZSBgc2VydmljZWAgbGFiZWwuXG4gKlxuICogVHdvIG1vcmUgYXBwLW93bmVkIGVucmljaG1lbnRzLCBib3RoIGNvbmZpZy1kcml2ZW4gKHRoZSBmb3J3YXJkZXIgbmV2ZXIgZ3Vlc3NlcyBmcm9tIGZyZWUgdGV4dCk6XG4gKiAgIOKAoiBGSUVMRCBMSUZUSU5HIChgRk9SV0FSREVSX0ZJRUxEU2ApIOKAlCBwcm9tb3RlIGFwcC1kZWNsYXJlZCBzdHJ1Y3R1cmVkIGZpZWxkcyAoZS5nLiBgY29ycmVsYXRpb25JZGAsXG4gKiAgICAgYG9yZGVySWRgLCBgdXNlcklkYCkgb3V0IG9mIHRoZSB0c2xvZyBKU09OIGFyZ3MgaW50byBxdWVyeWFibGUgdG9wLWxldmVsIHJlY29yZCBmaWVsZHMuIFRoaXMgaXNcbiAqICAgICB3aGF0IGxldHMgTG9ndHJhaWwgZm9sbG93IG9uZSByZXF1ZXN0IGFjcm9zcyBzZXJ2aWNlcywgb3IgZmlsdGVyIFwiYWxsIGxvZ3MgZm9yIG9yZGVyIDk5MVwiLlxuICogICDigKIgVkVSU0lPTiAoYEZPUldBUkRFUl9WRVJTSU9OYCkg4oCUIHN0YW1wIGV2ZXJ5IGxpbmUgd2l0aCB0aGUgcmVsZWFzZSB0aGF0IHByb2R1Y2VkIGl0LCBzbyBiZWhhdmlvclxuICogICAgIGNoYW5nZXMgY2FuIGJlIGF0dHJpYnV0ZWQgdG8gYSBkZXBsb3kuXG4gKlxuICogRU5WIE5BTUVTUEFDRTogdGhpcyBmdW5jdGlvbiByZWFkcyBPTkxZIGBGT1JXQVJERVJfKmAgZW52IHZhcnMg4oCUIGRlbGliZXJhdGVseSBOT1QgdGhlIGBMT0dUUkFJTF8qYFxuICoga2V5cyB1c2VkIGJ5IGZ3MjQncyBpbi1wcm9jZXNzIGxvZyB0cmFuc3BvcnQuIFRoYXQgZ3VhcmFudGVlcyB0aGUgZm9yd2FyZGVyIGNhbiBuZXZlciBjb2xsaWRlIHdpdGgsXG4gKiBvciBhY2NpZGVudGFsbHkgYWN0aXZhdGUsIGZ3MjQncyBpbi1wcm9jZXNzIExvZ3RyYWlsIG1hY2hpbmVyeS5cbiAqXG4gKiBERVBFTkRFTkNZLUZSRUUgKG5vZGUgYnVpbHQtaW5zIG9ubHkpIHNvIHRoZSBmb3J3YXJkZXIgYnVuZGxlIHN0YXlzIHRpbnkgYW5kIGNoZWFwLlxuICovXG5pbXBvcnQgeyBndW56aXBTeW5jLCBnemlwU3luYyB9IGZyb20gJ25vZGU6emxpYic7XG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCc7XG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdub2RlOmh0dHBzJztcbmltcG9ydCB7IFVSTCB9IGZyb20gJ25vZGU6dXJsJztcblxuY29uc3QgSU5HRVNUX1VSTCA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfVVJMPy50cmltKCk7XG5jb25zdCBCQVNFX1NFUlZJQ0UgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfU0VSVklDRT8udHJpbSgpIHx8ICd1bmtub3duJztcbi8vIFN0YWdlL293bmVyIGxhYmVsIChlLmcuIGBkZXZlbG9wYCwgYHByb2RgLCBgc2FuZGJveC1uaXRpbmApIHNvIGRldmVsb3AvcHJvZC9wZXItZGV2ZWxvcGVyIGxvZ3MgYXJlXG4vLyBkaXN0aW5ndWlzaGFibGUg4oCUIHRoZXJlIGNhbiBiZSBzZXZlcmFsIGRlcGxveW1lbnRzIG9mIG9uZSBzZXJ2aWNlIGFjcm9zcyBlbnZzIGFuZCBkZXZlbG9wZXJzLlxuY29uc3QgRU5WID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0VOVj8udHJpbSgpIHx8ICd1bmtub3duJztcbi8vIFRoZSBgc2VydmljZWAgbGFiZWwgaXMgd2hhdCdzIHByb21vdGVkIHRvIGEgTG9raSBsYWJlbCAoYW5kIHNob3duIGluIExvZ3RyYWlsKSwgc28gZm9sZCB0aGUgZW52IGludG9cbi8vIGl0IOKAlCBgcGx1c2Zhbi10cmlhbHMtZGV2ZWxvcGAsIGBwbHVzZmFuLXRyaWFscy1zYW5kYm94LW5pdGluYCwg4oCmIOKAlCBndWFyYW50ZWVpbmcgZWFjaCBkZXBsb3ltZW50IGlzXG4vLyBkaXN0aW5jdCBhdCBhIGdsYW5jZS4gYGVudmAgaXMgYWxzbyBlbWl0dGVkIGFzIGEgc3RydWN0dXJlZCBmaWVsZCBmb3IgcXVlcnlpbmcuXG5jb25zdCBTRVJWSUNFID0gRU5WICYmIEVOViAhPT0gJ3Vua25vd24nID8gYCR7QkFTRV9TRVJWSUNFfS0ke0VOVn1gIDogQkFTRV9TRVJWSUNFO1xuY29uc3QgWF9BUElfS0VZID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk/LnRyaW0oKTtcblxuLy8gQVdTIGFjY291bnQgKyByZWdpb24gZGlzYW1iaWd1YXRlIGRlcGxveW1lbnRzIHRoYXQgc2hhcmUgYXBwICsgZW52IG5hbWVzIOKAlCBlLmcuIHNldmVyYWwgZGV2ZWxvcGVyc1xuLy8gZWFjaCBkZXBsb3lpbmcgdGhlIFNBTUUgYXBwIChgcGx1c2Zhbi10cmlhbHNgLCBBUFBfRU5WSVJPTk1FTlQ9bG9jYWwpIHRvIHRoZWlyIE9XTiBhY2NvdW50LiBXaXRob3V0XG4vLyB0aGlzLCBhbGwgdGhlaXIgbG9ncyB3b3VsZCBjb2xsaWRlIHVuZGVyIG9uZSBgc2VydmljZWAgbGFiZWwuIFJlZ2lvbiBpcyBzZXQgYnkgdGhlIExhbWJkYSBydW50aW1lO1xuLy8gYWNjb3VudCBpcyBwYXJzZWQgZnJvbSB0aGUgaW52b2tlZCBmdW5jdGlvbiBBUk4gb24gdGhlIGZpcnN0IGludm9jYXRpb24gYW5kIGNhY2hlZC5cbmNvbnN0IFJFR0lPTiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT04/LnRyaW0oKSB8fCAnJztcbmxldCBSRVNPTFZFRF9BQ0NPVU5UID0gJyc7XG5mdW5jdGlvbiBhY2NvdW50RnJvbUFybihhcm46IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG5cdC8vIGFybjphd3M6bGFtYmRhOjxyZWdpb24+OjxBQ0NPVU5UPjpmdW5jdGlvbjo8bmFtZT5cblx0Y29uc3QgcGFydHMgPSAoYXJuIHx8ICcnKS5zcGxpdCgnOicpO1xuXHRyZXR1cm4gcGFydHMubGVuZ3RoID4gNCA/IHBhcnRzWzRdIDogJyc7XG59XG4vLyBUaGUgZncyNCBMb2d0cmFpbC9WZWN0b3IgaW5nZXN0IGRlY29kZXMgYSBKU09OIGFycmF5IGludG8gaW5kaXZpZHVhbCBldmVudHMgYW5kIFJFSkVDVFMgTkRKU09OICg0MDApLFxuLy8gc28gYGpzb24tYXJyYXlgIGlzIHRoZSBkZWZhdWx0LiBPdmVycmlkZSB0byBgbmRqc29uYCBvbmx5IGZvciBhbiBpbmdlc3QgY29uZmlndXJlZCB3aXRoIG5ld2xpbmUgZnJhbWluZy5cbmNvbnN0IEJBVENIX0ZPUk1BVCA9IChwcm9jZXNzLmVudi5GT1JXQVJERVJfQkFUQ0hfRk9STUFUPy50cmltKCkgfHwgJ2pzb24tYXJyYXknKSBhcyAnbmRqc29uJyB8ICdqc29uLWFycmF5Jztcbi8qKiBNYXggdW5jb21wcmVzc2VkIGJ5dGVzIHBlciBQT1NUIOKAlCBib3VuZHMgcmVxdWVzdCBzaXplIHNvIGEgbGFyZ2UgQ2xvdWRXYXRjaCBiYXRjaCBjYW4ndCA0MTMgdGhlIGluZ2VzdC4gKi9cbmNvbnN0IE1BWF9CQVRDSF9CWVRFUyA9IE51bWJlcihwcm9jZXNzLmVudi5GT1JXQVJERVJfTUFYX0JBVENIX0JZVEVTKSB8fCAxXzAwMF8wMDA7XG5jb25zdCBQT1NUX1RJTUVPVVRfTVMgPSBOdW1iZXIocHJvY2Vzcy5lbnYuRk9SV0FSREVSX1BPU1RfVElNRU9VVF9NUykgfHwgNTAwMDtcbmNvbnN0IE1BWF9SRVRSSUVTID0gMTtcblxuLy8g4pSA4pSAIEFwcC1sZXZlbCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzIChsYXllcnMgMuKAkzQpLiBFYWNoIGVudiB2YXIgaXMgYSBKU09OIGFycmF5IG9mIHJlZ2V4IHNvdXJjZVxuLy8gICAgc3RyaW5nczsgY29tcGlsZWQgY2FzZS1pbnNlbnNpdGl2ZWx5IG9uY2UsIGhlcmUsIGF0IGNvbGQgc3RhcnQuIEVtcHR5L21hbGZvcm1lZCDihpIgbm8gcnVsZXMuIOKUgOKUgFxuZnVuY3Rpb24gY29tcGlsZVJ1bGVzKHJhd0pzb246IHN0cmluZyB8IHVuZGVmaW5lZCk6IFJlZ0V4cFtdIHtcblx0aWYgKCFyYXdKc29uKSByZXR1cm4gW107XG5cdGxldCBhcnI6IHVua25vd247XG5cdHRyeSB7XG5cdFx0YXJyID0gSlNPTi5wYXJzZShyYXdKc29uKTtcblx0fSBjYXRjaCB7XG5cdFx0cmV0dXJuIFtdO1xuXHR9XG5cdGlmICghQXJyYXkuaXNBcnJheShhcnIpKSByZXR1cm4gW107XG5cdGNvbnN0IG91dDogUmVnRXhwW10gPSBbXTtcblx0Zm9yIChjb25zdCBzcmMgb2YgYXJyKSB7XG5cdFx0aWYgKHR5cGVvZiBzcmMgIT09ICdzdHJpbmcnIHx8IHNyYy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuXHRcdHRyeSB7XG5cdFx0XHRvdXQucHVzaChuZXcgUmVnRXhwKHNyYywgJ2knKSk7XG5cdFx0fSBjYXRjaCB7XG5cdFx0XHQvLyBBIGJhZCBwYXR0ZXJuIG11c3QgbmV2ZXIgYnJlYWsgdGhlIGZvcndhcmRlciDigJQgc2tpcCBpdC5cblx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRjb25zb2xlLndhcm4oJ1tsb2ctZm9yd2FyZGVyXSBpZ25vcmluZyBpbnZhbGlkIG5vaXNlIHBhdHRlcm46Jywgc3JjKTtcblx0XHR9XG5cdH1cblx0cmV0dXJuIG91dDtcbn1cblxuY29uc3QgQkVOSUdOX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9CRU5JR04pO1xuY29uc3QgRFJPUF9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfRFJPUCk7XG5jb25zdCBET1dOR1JBREVfUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0RPV05HUkFERSk7XG5jb25zdCBIQVNfTk9JU0VfUlVMRVMgPSBCRU5JR05fUlVMRVMubGVuZ3RoID4gMCB8fCBEUk9QX1JVTEVTLmxlbmd0aCA+IDAgfHwgRE9XTkdSQURFX1JVTEVTLmxlbmd0aCA+IDA7XG5cbi8vIOKUgOKUgCBBcHAtZGVjbGFyZWQgZmllbGQgbGlmdGluZyAoRk9SV0FSREVSX0ZJRUxEUyk6IGEgSlNPTiBhcnJheSBvZiBmaWVsZCBuYW1lcyB0aGUgYXBwIHdhbnRzIHByb21vdGVkXG4vLyAgICBmcm9tIGl0cyBzdHJ1Y3R1cmVkIHRzbG9nIGFyZ3MgdG8gcXVlcnlhYmxlIHRvcC1sZXZlbCByZWNvcmQgZmllbGRzIChlLmcuIGNvcnJlbGF0aW9uSWQsIG9yZGVySWQpLlxuLy8gICAgVGhlIGFwcCBvd25zIHRoaXMgbGlzdCB2aWEgdGhlIGNvbnN0cnVjdDsgdGhlIGZvcndhcmRlciBuZXZlciBzY3JhcGVzIGZyZWUgdGV4dCBmb3IgdGhlbS4g4pSA4pSAXG5mdW5jdGlvbiBwYXJzZUZpZWxkTGlzdChyYXdKc29uOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmdbXSB7XG5cdGlmICghcmF3SnNvbikgcmV0dXJuIFtdO1xuXHR0cnkge1xuXHRcdGNvbnN0IGFyciA9IEpTT04ucGFyc2UocmF3SnNvbik7XG5cdFx0aWYgKCFBcnJheS5pc0FycmF5KGFycikpIHJldHVybiBbXTtcblx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KGFyci5maWx0ZXIoKHMpOiBzIGlzIHN0cmluZyA9PiB0eXBlb2YgcyA9PT0gJ3N0cmluZycgJiYgcy50cmltKCkubGVuZ3RoID4gMCkubWFwKChzKSA9PiBzLnRyaW0oKSkpIF07XG5cdH0gY2F0Y2gge1xuXHRcdHJldHVybiBbXTtcblx0fVxufVxuY29uc3QgTElGVF9TRVQgPSBuZXcgU2V0KHBhcnNlRmllbGRMaXN0KHByb2Nlc3MuZW52LkZPUldBUkRFUl9GSUVMRFMpKTtcbmNvbnN0IEhBU19MSUZUX0ZJRUxEUyA9IExJRlRfU0VULnNpemUgPiAwO1xuXG4vLyBSZWxlYXNlL3ZlcnNpb24gc3RhbXAgc28gZXZlcnkgc2hpcHBlZCBsaW5lIGlzIGF0dHJpYnV0YWJsZSB0byB0aGUgZGVwbG95IHRoYXQgcHJvZHVjZWQgaXQuIFNldCBieSB0aGVcbi8vIGNvbnN0cnVjdCBhdCBkZXBsb3kgdGltZSAoc2VtdmVyIG9yIGdpdCBzaGEpOyBvbWl0dGVkIGZyb20gcmVjb3JkcyB3aGVuIHVuc2V0LlxuY29uc3QgVkVSU0lPTiA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9WRVJTSU9OPy50cmltKCkgfHwgJyc7XG5cbi8vIOKUgOKUgCBGaWVsZCBkcm9wLWxpc3QgKEZPUldBUkRFUl9EUk9QX0ZJRUxEUyk6IHJlY29yZCBrZXlzIHRvIE9NSVQgYmVmb3JlIHNoaXBwaW5nLCB0byBjdXQgaW5nZXN0L3N0b3JhZ2Vcbi8vICAgIHNpemUgb24gbG93LXZhbHVlIGZpZWxkcy4gRGVmYXVsdCBkcm9wcyBsb2dTdHJlYW0vbG9nR3JvdXAvc291cmNlX3R5cGUvcmVhc29uIChob3N0IGlzIHN0aWxsIGtlcHQpLlxuLy8gICAgVGhlIGNvbnN0cnVjdCBzZXRzIHRoaXMgZnJvbSB0aGUgYGRyb3BGaWVsZHNgIGNvbmZpZzsgdW5zZXQg4oaSIHRoZSBkZWZhdWx0cyBiZWxvdy4gQ29yZSBrZXlzIGNhblxuLy8gICAgbmV2ZXIgYmUgZHJvcHBlZCAoYmVsdC1hbmQtc3VzcGVuZGVycyBhZ2FpbnN0IG1pc2NvbmZpZykuIOKUgOKUgFxuY29uc3QgREVGQVVMVF9EUk9QX0ZJRUxEUyA9IFsgJ2xvZ1N0cmVhbScsICdsb2dHcm91cCcsICdzb3VyY2VfdHlwZScsICdyZWFzb24nIF07XG5jb25zdCBORVZFUl9EUk9QID0gbmV3IFNldChbICdzZXJ2aWNlJywgJ2xldmVsJywgJ21lc3NhZ2UnLCAndGltZXN0YW1wJyBdKTtcbmNvbnN0IERST1BfU0VUID0gbmV3IFNldChcblx0KHByb2Nlc3MuZW52LkZPUldBUkRFUl9EUk9QX0ZJRUxEUyAhPT0gdW5kZWZpbmVkXG5cdFx0PyBwYXJzZUZpZWxkTGlzdChwcm9jZXNzLmVudi5GT1JXQVJERVJfRFJPUF9GSUVMRFMpXG5cdFx0OiBERUZBVUxUX0RST1BfRklFTERTXG5cdCkuZmlsdGVyKChrKSA9PiAhTkVWRVJfRFJPUC5oYXMoaykpLFxuKTtcblxuLy8gUmVjb3JkIGtleXMgdGhlIGZvcndhcmRlciBvd25zIOKAlCBhIGxpZnRlZCBhcHAgZmllbGQgbXVzdCBuZXZlciBvdmVyd3JpdGUgb25lIG9mIHRoZXNlLlxuY29uc3QgUkVTRVJWRURfRklFTERfS0VZUyA9IG5ldyBTZXQoW1xuXHQnc2VydmljZScsICdlbnYnLCAnYWNjb3VudCcsICdyZWdpb24nLCAndmVyc2lvbicsICdob3N0JywgJ2xvZ2dlcicsICdyZXF1ZXN0SWQnLFxuXHQnbGV2ZWwnLCAncmVjbGFzc2lmaWVkJywgJ21lc3NhZ2UnLCAndGltZXN0YW1wJywgJ2xvZ0dyb3VwJywgJ2xvZ1N0cmVhbScsXG5cdCdjb2RlRmlsZScsICdjb2RlTGluZScsXG5dKTtcblxuLyoqXG4gKiBMaWZ0IHRoZSBhcHAtZGVjbGFyZWQge0BsaW5rIExJRlRfU0VUfSBmaWVsZHMgb3V0IG9mIGEgcGFyc2VkIHRzbG9nIG9iamVjdCBpbnRvIGZsYXQgYHtrZXk6IHZhbHVlfWBcbiAqIHN0cmluZyBwYWlycy4gU2NhbnMgdGhlIG9iamVjdCdzIG93biBzY2FsYXIga2V5cyBBTkQgb25lIGxldmVsIGludG8gaXRzIHBvc2l0aW9uYWwtYXJndW1lbnQgb2JqZWN0c1xuICogKFwiMFwiLi5cIm5cIiksIHNvIGBsb2dnZXIuaW5mbygnY2hhcmdlIGZhaWxlZCcsIHsgb3JkZXJJZCwgY29ycmVsYXRpb25JZCB9KWAgc3VyZmFjZXMgYm90aC4gUmVzZXJ2ZWRcbiAqIHJlY29yZCBrZXlzIGFyZSBuZXZlciBsaWZ0ZWQ7IHZhbHVlcyBhcmUgY29lcmNlZCB0byB0cmltbWVkIHN0cmluZ3M7IGZpcnN0IG9jY3VycmVuY2Ugd2lucy5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdExpZnRlZEZpZWxkcyhvOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuXHRjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblx0Y29uc3QgdGFrZSA9IChrOiBzdHJpbmcsIHY6IHVua25vd24pOiB2b2lkID0+IHtcblx0XHRpZiAob3V0W2tdICE9PSB1bmRlZmluZWQgfHwgUkVTRVJWRURfRklFTERfS0VZUy5oYXMoaykgfHwgIUxJRlRfU0VULmhhcyhrKSkgcmV0dXJuO1xuXHRcdGlmICh0eXBlb2YgdiA9PT0gJ3N0cmluZycgfHwgdHlwZW9mIHYgPT09ICdudW1iZXInIHx8IHR5cGVvZiB2ID09PSAnYm9vbGVhbicpIHtcblx0XHRcdGNvbnN0IHMgPSBTdHJpbmcodikudHJpbSgpO1xuXHRcdFx0aWYgKHMpIG91dFtrXSA9IHM7XG5cdFx0fVxuXHR9O1xuXHRmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKG8pKSB7XG5cdFx0aWYgKGsgPT09ICdfbWV0YScpIGNvbnRpbnVlO1xuXHRcdGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2KSkge1xuXHRcdFx0Zm9yIChjb25zdCBbIGsyLCB2MiBdIG9mIE9iamVjdC5lbnRyaWVzKHYgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB0YWtlKGsyLCB2Mik7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHRha2Uoaywgdik7XG5cdFx0fVxuXHR9XG5cdHJldHVybiBvdXQ7XG59XG5cbi8vIExldmVscyB0aGF0IGNvdW50IGFzIFwiZXJyb3ItaXNoXCIgZm9yIHRoZSBiZW5pZ24gZG93bmdyYWRlIChtaXJyb3JzIHRoZSBWZWN0b3IgQTEgbGlzdCkuXG5jb25zdCBFUlJPUklTSCA9IG5ldyBTZXQoWyAnZXJyb3InLCAnZXJyJywgJ2ZhdGFsJywgJ2NyaXRpY2FsJywgJ2NyaXQnLCAnZW1lcmcnLCAnYWxlcnQnLCAncGFuaWMnIF0pO1xuZnVuY3Rpb24gYW55TWF0Y2gocnVsZXM6IFJlZ0V4cFtdLCBtc2c6IHN0cmluZyk6IGJvb2xlYW4ge1xuXHRmb3IgKGNvbnN0IHJlIG9mIHJ1bGVzKSB7XG5cdFx0aWYgKHJlLnRlc3QobXNnKSkgcmV0dXJuIHRydWU7XG5cdH1cblx0cmV0dXJuIGZhbHNlO1xufVxuXG4vLyBSZXVzZWQgYWNyb3NzIHdhcm0gaW52b2NhdGlvbnMgc28gd2UgZG9uJ3QgcGF5IFRDUC9UTFMgc2V0dXAgcGVyIGJhdGNoLlxuY29uc3QgaHR0cEFnZW50ID0gbmV3IGh0dHAuQWdlbnQoeyBrZWVwQWxpdmU6IHRydWUsIG1heFNvY2tldHM6IDE2IH0pO1xuY29uc3QgaHR0cHNBZ2VudCA9IG5ldyBodHRwcy5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSwgbWF4U29ja2V0czogMTYgfSk7XG5cbmludGVyZmFjZSBDbG91ZFdhdGNoTG9nc0V2ZW50IHtcblx0YXdzbG9nczogeyBkYXRhOiBzdHJpbmcgfTtcbn1cblxuaW50ZXJmYWNlIERlY29kZWRQYXlsb2FkIHtcblx0bWVzc2FnZVR5cGU6IHN0cmluZztcblx0bG9nR3JvdXA6IHN0cmluZztcblx0bG9nU3RyZWFtOiBzdHJpbmc7XG5cdGxvZ0V2ZW50czogQXJyYXk8eyBpZDogc3RyaW5nOyB0aW1lc3RhbXA6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0+O1xufVxuXG4vLyBMYW1iZGEgcGxhdGZvcm0gbGluZXMgdGhhdCBhcmUgcHVyZSBub2lzZS4gUkVQT1JUIGlzIGtlcHQgYnkgZGVmYXVsdCAoY2FycmllcyBkdXJhdGlvbi9tZW1vcnkpO1xuLy8gc2V0IEZPUldBUkRFUl9EUk9QX1JFUE9SVD10cnVlIHRvIGRyb3AgaXQgdG9vLlxuY29uc3QgRFJPUF9SRVBPUlQgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfRFJPUF9SRVBPUlQ/LnRyaW0oKSA9PT0gJ3RydWUnO1xuZnVuY3Rpb24gaXNQbGF0Zm9ybU5vaXNlKHJhdzogc3RyaW5nKTogYm9vbGVhbiB7XG5cdGlmIChyYXcuc3RhcnRzV2l0aCgnU1RBUlQgUmVxdWVzdElkJykgfHwgcmF3LnN0YXJ0c1dpdGgoJ0VORCBSZXF1ZXN0SWQnKSB8fCByYXcuc3RhcnRzV2l0aCgnSU5JVF9TVEFSVCcpKSB7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblx0aWYgKERST1BfUkVQT1JUICYmIHJhdy5zdGFydHNXaXRoKCdSRVBPUlQgUmVxdWVzdElkJykpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8vIGZ3MjQncyB0c2xvZyBjb2xvcml6ZXMgb3V0cHV0IHdpdGggQU5TSSBTR1IgY29kZXMgKGUuZy4gRVNDWzMybSDigKYgRVNDWzM5bSkgd2hpY2ggb3RoZXJ3aXNlIHNoaXAgYXNcbi8vIGxpdGVyYWwgYFszMm1gIG5vaXNlIGluIExvZ3RyYWlsLiBTdHJpcCBhbGwgQU5TSSBlc2NhcGUgc2VxdWVuY2VzIGZyb20gc2hpcHBlZCB0ZXh0LlxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnRyb2wtcmVnZXhcbmNvbnN0IEFOU0lfUkUgPSAvXFx4MWJcXFtbMC05O10qW0EtWmEtel0vZztcbmZ1bmN0aW9uIHN0cmlwQW5zaShzOiBzdHJpbmcpOiBzdHJpbmcge1xuXHRyZXR1cm4gcy5pbmNsdWRlcygnXFx4MWInKSA/IHMucmVwbGFjZShBTlNJX1JFLCAnJykgOiBzO1xufVxuXG5mdW5jdGlvbiBmYWxsYmFja0xldmVsKHJhdzogc3RyaW5nKTogc3RyaW5nIHtcblx0aWYgKC9cXGIoPzpFUlJPUnxGQVRBTClcXGIvLnRlc3QocmF3KSkgcmV0dXJuICdlcnJvcic7XG5cdGlmICgvXFxiV0FSTig/OklORyk/XFxiLy50ZXN0KHJhdykpIHJldHVybiAnd2Fybic7XG5cdHJldHVybiAnaW5mbyc7XG59XG5cbmNvbnN0IEtOT1dOX0xFVkVMUyA9IG5ldyBTZXQoWyAndHJhY2UnLCAnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ3dhcm5pbmcnLCAnZXJyb3InLCAnZmF0YWwnIF0pO1xuY29uc3QgSVNPX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfS87XG5cbi8vIHRzbG9nJ3MgXCJwcmV0dHlcIiAobm9uLUpTT04pIGNvbnNvbGUgZm9ybWF0OiBgWVlZWS1NTS1ERCBISDpNTTpTUy5tbW0gTEVWRUwgcmVzdOKApmAuIFRoZSBkYXRlICsgbGV2ZWxcbi8vIGl0IHByaW50cyBkdXBsaWNhdGUgd2hhdCBMb2d0cmFpbCBhbHJlYWR5IHNob3dzIGluIHRoZSBkZWRpY2F0ZWQgVElNRS9MVkwgY29sdW1ucyDigJQgcGVlbCB0aGVtIG9mZlxuLy8gdGhlIG1lc3NhZ2UgbGlrZSB0aGUgTGFtYmRhLXByZWZpeCAvIHRzbG9nLUpTT04gYnJhbmNoZXMgYWxyZWFkeSBkbyBmb3IgdGhlaXIgb3duIHNoYXBlcy5cbmNvbnN0IFBSRVRUWV9UU0xPR19SRSA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0gXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31cXHMrKFRSQUNFfERFQlVHfElORk98V0FSTig/OklORyk/fEVSUk9SfEZBVEFMKVxccysoLiopJC87XG5cbi8qKiBQZWVsIGEgdHNsb2cgXCJwcmV0dHlcIiBg4oC5ZGF0ZeKAuiDigLl0aW1l4oC6IExFVkVMIOKAuXJlc3TigLpgIHByZWZpeCwgaWYgdGhlIGxpbmUgbWF0Y2hlcy4gKi9cbmZ1bmN0aW9uIHBhcnNlUHJldHR5VHNsb2dQcmVmaXgocmF3OiBzdHJpbmcpOiB7IGxldmVsOiBzdHJpbmc7IG1lc3NhZ2U6IHN0cmluZyB9IHwgbnVsbCB7XG5cdGNvbnN0IG0gPSByYXcubWF0Y2goUFJFVFRZX1RTTE9HX1JFKTtcblx0aWYgKCFtKSByZXR1cm4gbnVsbDtcblx0Y29uc3QgWyAsIGx2bCwgcmVzdCBdID0gbTtcblx0Y29uc3QgbGV2ZWwgPSBsdmwudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKCd3YXJuJykgPyAnd2FybicgOiBsdmwudG9Mb3dlckNhc2UoKTtcblx0cmV0dXJuIHsgbGV2ZWwsIG1lc3NhZ2U6IHJlc3QgfTtcbn1cblxuLyoqXG4gKiBBV1MgTGFtYmRhIGVtaXRzIHRleHQgbG9ncyBhcyBg4oC5aXNv4oC6XFx04oC5cmVxdWVzdElk4oC6XFx04oC5TEVWRUzigLpcXHTigLltZXNzYWdl4oC6YC4gUGVlbCB0aGF0IHByZWZpeCBvZmYgc28gdGhlXG4gKiBtZXNzYWdlIGlzIGp1c3QgdGhlIHRleHQsIGFuZCBsaWZ0IHJlcXVlc3RJZC9sZXZlbCBvdXQgYXMgZmllbGRzICh0aGV5J3JlIGFscmVhZHkgc2hvd24gYXMgY29sdW1ucykuXG4gKiBSZXR1cm5zIG51bGwgaWYgdGhlIGxpbmUgaXNuJ3QgaW4gdGhhdCBmb3JtYXQuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlTGFtYmRhUHJlZml4KHJhdzogc3RyaW5nKTogeyByZXF1ZXN0SWQ6IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgbWVzc2FnZTogc3RyaW5nIH0gfCBudWxsIHtcblx0Y29uc3QgcGFydHMgPSByYXcuc3BsaXQoJ1xcdCcpO1xuXHRpZiAocGFydHMubGVuZ3RoIDwgNCkgcmV0dXJuIG51bGw7XG5cdGNvbnN0IFsgdHMsIHJlcXVlc3RJZCwgbHZsLCAuLi5yZXN0IF0gPSBwYXJ0cztcblx0aWYgKCFJU09fUkUudGVzdCh0cykgfHwgIUtOT1dOX0xFVkVMUy5oYXMobHZsLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgcmV0dXJuIG51bGw7XG5cdHJldHVybiB7IHJlcXVlc3RJZCwgbGV2ZWw6IGx2bC50cmltKCkudG9Mb3dlckNhc2UoKSwgbWVzc2FnZTogcmVzdC5qb2luKCdcXHQnKS50cmltKCkgfTtcbn1cblxuLyoqXG4gKiBUdXJuIGEgdmVyYm9zZSBDbG91ZFdhdGNoIGxvZy1ncm91cCAvIGxvZy1zdHJlYW0gaW50byBhIHNob3J0IGZ1bmN0aW9uIG5hbWUgZm9yIHRoZSBgaG9zdGAgbGFiZWwsXG4gKiBlLmcuIGDigKYtcGx1c2ZhbnRyaWFsc3N0cmVhbXByb2Nlc3NvcuKApkxvZ0dyb3Vw4oCmYCDihpIgYHBsdXNmYW50cmlhbHNzdHJlYW1wcm9jZXNzb3JgLiBGYWxscyBiYWNrIHRvIHRoZVxuICogcmF3IGxvZyBncm91cC4gVGhlIGZ1bGwgbG9nIGdyb3VwIGlzIHN0aWxsIGVtaXR0ZWQgc2VwYXJhdGVseSBhcyBgbG9nR3JvdXBgLlxuICovXG5mdW5jdGlvbiBzaG9ydEhvc3QobG9nR3JvdXA6IHN0cmluZywgbG9nU3RyZWFtOiBzdHJpbmcpOiBzdHJpbmcge1xuXHQvLyBMYW1iZGEgbG9nIHN0cmVhbTogXCJZWVlZL01NL0RELzxmdW5jdGlvbk5hbWU+WyRMQVRFU1RdPGlkPlwiIOKAlCB0aGUgY2xlYW5lc3Qgc291cmNlIG9mIHRoZSBmbiBuYW1lLlxuXHRjb25zdCBzbSA9IGxvZ1N0cmVhbS5tYXRjaCgvXlxcZHs0fVxcL1xcZHsyfVxcL1xcZHsyfVxcLyguKz8pXFxbXFwkTEFURVNUXFxdLyk7XG5cdGlmIChzbSAmJiBzbVsxXSkge1xuXHRcdHJldHVybiBzbVsxXS5yZXBsYWNlKC8tW0EtWmEtejAtOV17Nix9JC8sICcnKTsgLy8gZHJvcCB0aGUgQ2xvdWRGb3JtYXRpb24gcmFuZG9tIHN1ZmZpeFxuXHR9XG5cdC8vIEZhbGxiYWNrOiBwYXJzZSB0aGUgbG9nIGdyb3VwIOKAlCBzdHJpcCB0aGUgYOKApkxvZ0dyb3VwPGhhc2g+LTxzdWZmaXg+YCB0YWlsLCB0YWtlIHRoZSBsYXN0IHNlZ21lbnQsXG5cdC8vIGFuZCBkZS1kdXBsaWNhdGUgQ0RLJ3MgZG91YmxlZCBjb25zdHJ1Y3QgbmFtZSAoYGZvb0JhcmZvb0JhcmAg4oaSIGBmb29CYXJgKS5cblx0bGV0IHMgPSBsb2dHcm91cDtcblx0Y29uc3QgbGcgPSBzLmluZGV4T2YoJ0xvZ0dyb3VwJyk7XG5cdGlmIChsZyA+IDApIHMgPSBzLnNsaWNlKDAsIGxnKTtcblx0Y29uc3QgbSA9IHMubWF0Y2goLyg/OnN0YWNrLXxOZXN0ZWRTdGFja1Jlc291cmNlWzAtOUEtRmEtZl0qLSkoW14tXSspJC8pO1xuXHRpZiAobSkgcyA9IG1bMV07XG5cdGlmIChzLmxlbmd0aCA+IDAgJiYgcy5sZW5ndGggJSAyID09PSAwKSB7XG5cdFx0Y29uc3QgaGFsZiA9IHMubGVuZ3RoIC8gMjtcblx0XHRpZiAocy5zbGljZSgwLCBoYWxmKSA9PT0gcy5zbGljZShoYWxmKSkgcyA9IHMuc2xpY2UoMCwgaGFsZik7XG5cdH1cblx0cmV0dXJuIHMgfHwgbG9nR3JvdXA7XG59XG5cbi8qKlxuICogUmVzaGFwZSBvbmUgQ2xvdWRXYXRjaCBsb2cgZXZlbnQgaW50byBhIGNsZWFuIFZlY3RvciByZWNvcmQsIHRoZW4gYXBwbHkgdGhlIGFwcC1sZXZlbCBub2lzZS9zZXZlcml0eVxuICogcnVsZXMuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGV2ZW50IHNob3VsZCBiZSBkcm9wcGVkIChwbGF0Zm9ybSBub2lzZSBvciBhIFwiZHJvcFwiIHJ1bGUgbWF0Y2gpLlxuICpcbiAqIGZ3MjQgbG9ncyBhcmUgdHNsb2cgSlNPTiBsaWtlIGB7XCIwXCI6XCJ0aGUgbWVzc2FnZVwiLFwiMVwiOnsuLi5hcmd9LFwiX21ldGFcIjp7XCJuYW1lXCI6XCJBUElDb25zdHJ1Y3RcIixcbiAqIFwibG9nTGV2ZWxOYW1lXCI6XCJJTkZPXCIsXCJkYXRlXCI6XCIuLi5cIn19YC4gV2UgbGlmdCB0aGUgcmVhbCBtZXNzYWdlIG91dCBvZiB0aGUgcG9zaXRpb25hbCBrZXlzIGFuZCB0aGVcbiAqIGNvbXBvbmVudC9sZXZlbC90aW1lIG91dCBvZiBgX21ldGFgLCBzbyBMb2d0cmFpbCBzaG93cyByZWFkYWJsZSBsaW5lcyBpbnN0ZWFkIG9mIGEgcmF3IEpTT04gYmxvYi5cbiAqIE5vbi1KU09OIGxpbmVzIChMYW1iZGEgU1RBUlQvRU5EL1JFUE9SVCwgcGxhaW4gdGV4dCkgcGFzcyB0aHJvdWdoIHVuY2hhbmdlZC5cbiAqL1xuZnVuY3Rpb24gdG9WZWN0b3JSZWNvcmQoXG5cdGU6IHsgdGltZXN0YW1wOiBudW1iZXI7IG1lc3NhZ2U6IHN0cmluZyB9LFxuXHRsb2dHcm91cDogc3RyaW5nLFxuXHRsb2dTdHJlYW06IHN0cmluZyxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB7XG5cdGNvbnN0IHJhdyA9IChlLm1lc3NhZ2UgPz8gJycpLnJlcGxhY2UoL1xccyskLywgJycpO1xuXG5cdC8vIOKUgOKUgCAxKSBEUk9QOiBMYW1iZGEgcGxhdGZvcm0gbGluZXMgdGhhdCBhcmUgcHVyZSBub2lzZS4g4pSA4pSAXG5cdGlmIChpc1BsYXRmb3JtTm9pc2UocmF3LnRyaW1TdGFydCgpKSkge1xuXHRcdHJldHVybiBudWxsO1xuXHR9XG5cblx0bGV0IG1lc3NhZ2UgPSByYXc7XG5cdGxldCBsZXZlbDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgbG9nZ2VyOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCByZXF1ZXN0SWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGNvcnJlbGF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IHRzSXNvOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBsaWZ0ZWQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQ7XG5cdGxldCBjb2RlTG9jOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cblx0Ly8g4pSA4pSAIDEpIE5PUk1BTElaRTogcGVlbCBBV1MgTGFtYmRhJ3MgYOKAuWlzb+KAulxcdOKAuXJlcXVlc3RJZOKAulxcdOKAuUxFVkVM4oC6XFx04oC5bWVzc2FnZeKAumAgdGV4dCBwcmVmaXgsIGlmIHByZXNlbnQuXG5cdGNvbnN0IGxhbWJkYSA9IHBhcnNlTGFtYmRhUHJlZml4KHJhdyk7XG5cdGlmIChsYW1iZGEpIHtcblx0XHRyZXF1ZXN0SWQgPSBsYW1iZGEucmVxdWVzdElkO1xuXHRcdGxldmVsID0gbGFtYmRhLmxldmVsO1xuXHRcdG1lc3NhZ2UgPSBsYW1iZGEubWVzc2FnZTtcblx0fVxuXG5cdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IGlmIHRoZSByZW1haW5pbmcgbWVzc2FnZSBpcyBmdzI0IHRzbG9nIEpTT04sIGxpZnQgdGhlIHJlYWwgdGV4dCArIGNvbXBvbmVudC9sZXZlbC90aW1lLlxuXHRjb25zdCBib2R5ID0gbWVzc2FnZTtcblx0aWYgKGJvZHkuY2hhckNvZGVBdCgwKSA9PT0gMHg3YiAvKiB7ICovKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGNvbnN0IG8gPSBKU09OLnBhcnNlKGJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXHRcdFx0Y29uc3QgbWV0YSA9IG8uX21ldGEgYXMge1xuXHRcdFx0XHRuYW1lPzogdW5rbm93bjsgbG9nTGV2ZWxOYW1lPzogdW5rbm93bjsgZGF0ZT86IHVua25vd247IGNvcnJlbGF0aW9uSWQ/OiB1bmtub3duO1xuXHRcdFx0XHRwYXRoPzogeyBmaWxlUGF0aFdpdGhMaW5lPzogdW5rbm93bjsgZmlsZU5hbWU/OiB1bmtub3duOyBmaWxlTGluZT86IHVua25vd24gfTtcblx0XHRcdH0gfCB1bmRlZmluZWQ7XG5cdFx0XHRpZiAobWV0YSAmJiB0eXBlb2YgbWV0YSA9PT0gJ29iamVjdCcpIHtcblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLm5hbWUgPT09ICdzdHJpbmcnKSBsb2dnZXIgPSBtZXRhLm5hbWU7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5sb2dMZXZlbE5hbWUgPT09ICdzdHJpbmcnKSBsZXZlbCA9IG1ldGEubG9nTGV2ZWxOYW1lLnRvTG93ZXJDYXNlKCk7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5kYXRlID09PSAnc3RyaW5nJyAmJiAhTnVtYmVyLmlzTmFOKERhdGUucGFyc2UobWV0YS5kYXRlKSkpIHtcblx0XHRcdFx0XHR0c0lzbyA9IG5ldyBEYXRlKG1ldGEuZGF0ZSkudG9JU09TdHJpbmcoKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgbWV0YS5jb3JyZWxhdGlvbklkLnRyaW0oKSkgY29ycmVsYXRpb25JZCA9IG1ldGEuY29ycmVsYXRpb25JZC50cmltKCk7XG5cdFx0XHRcdC8vIHRzbG9nIG5hdGl2ZSBzb3VyY2UgcG9zaXRpb24gKG1vZGUgJ2FsbCcpOiBfbWV0YS5wYXRoLlxuXHRcdFx0XHRjb25zdCBwID0gbWV0YS5wYXRoO1xuXHRcdFx0XHRpZiAocCAmJiB0eXBlb2YgcCA9PT0gJ29iamVjdCcpIHtcblx0XHRcdFx0XHRpZiAodHlwZW9mIHAuZmlsZVBhdGhXaXRoTGluZSA9PT0gJ3N0cmluZycpIGNvZGVMb2MgPSBwLmZpbGVQYXRoV2l0aExpbmU7XG5cdFx0XHRcdFx0ZWxzZSBpZiAodHlwZW9mIHAuZmlsZU5hbWUgPT09ICdzdHJpbmcnICYmIHAuZmlsZUxpbmUgIT0gbnVsbCkgY29kZUxvYyA9IGAke3AuZmlsZU5hbWV9OiR7cC5maWxlTGluZX1gO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHQvLyBMaWZ0IGFwcC1kZWNsYXJlZCBzdHJ1Y3R1cmVkIGZpZWxkcyAoY29ycmVsYXRpb25JZCwgb3JkZXJJZCwg4oCmKSBGSVJTVCwgc28gdGhvc2Uga2V5cyBjYW4gYmVcblx0XHRcdC8vIGtlcHQgT1VUIG9mIHRoZSBodW1hbiBtZXNzYWdlIGJlbG93IChubyBkdXBsaWNhdGluZyBhIGxpZnRlZCBpZCBpbiBib3RoIHRoZSBmaWVsZCBhbmQgdGhlIHRleHQpLlxuXHRcdFx0aWYgKEhBU19MSUZUX0ZJRUxEUykge1xuXHRcdFx0XHRjb25zdCBmID0gZXh0cmFjdExpZnRlZEZpZWxkcyhvKTtcblx0XHRcdFx0aWYgKE9iamVjdC5rZXlzKGYpLmxlbmd0aCA+IDApIGxpZnRlZCA9IGY7XG5cdFx0XHR9XG5cdFx0XHRjb25zdCBsaWZ0ZWRLZXlzID0gbGlmdGVkID8gbmV3IFNldChPYmplY3Qua2V5cyhsaWZ0ZWQpKSA6IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG5cdFx0XHQvLyBQb3NpdGlvbmFsIGFyZ3MgXCIwXCIuLlwiblwiIGhvbGQgdGhlIGxvZ2dlZCBtZXNzYWdlICsgcGFyYW1zLiBCdWlsZCB0aGUgaHVtYW4gbWVzc2FnZSBmcm9tIHRoZVxuXHRcdFx0Ly8gc3RyaW5nIGFyZ3MgcGx1cyB0aGUgTk9OLWxpZnRlZCBrZXlzIG9mIG9iamVjdCBhcmdzIChsaWZ0ZWQgaWRzIGJlY29tZSBmaWVsZHMsIG5vdCBtZXNzYWdlXG5cdFx0XHQvLyBub2lzZSkuIEEgYHsgX3NyY2xvYyB9YCBhcmcgY2FycmllcyB0aGUgY2FsbGVyJ3Mgc291cmNlIHBvc2l0aW9uIOKAlCBsaWZ0ZWQsIGtlcHQgb3V0IG9mIHRoZSB0ZXh0LlxuXHRcdFx0Y29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG5cdFx0XHRmb3IgKGxldCBpID0gMDsgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIFN0cmluZyhpKSk7IGkrKykge1xuXHRcdFx0XHRjb25zdCB2ID0gb1tTdHJpbmcoaSldO1xuXHRcdFx0XHRpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSB7IHBhcnRzLnB1c2godik7IGNvbnRpbnVlOyB9XG5cdFx0XHRcdGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2KSkge1xuXHRcdFx0XHRcdGNvbnN0IG9iaiA9IHYgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cdFx0XHRcdFx0aWYgKHR5cGVvZiBvYmouX3NyY2xvYyA9PT0gJ3N0cmluZycpIHsgaWYgKCFjb2RlTG9jKSBjb2RlTG9jID0gb2JqLl9zcmNsb2MgYXMgc3RyaW5nOyBjb250aW51ZTsgfVxuXHRcdFx0XHRcdGNvbnN0IHJlc3Q6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG5cdFx0XHRcdFx0Zm9yIChjb25zdCBbIGssIHZhbCBdIG9mIE9iamVjdC5lbnRyaWVzKG9iaikpIGlmICghbGlmdGVkS2V5cy5oYXMoaykpIHJlc3RbIGsgXSA9IHZhbDtcblx0XHRcdFx0XHRpZiAoT2JqZWN0LmtleXMocmVzdCkubGVuZ3RoID4gMCkgcGFydHMucHVzaChKU09OLnN0cmluZ2lmeShyZXN0KSk7XG5cdFx0XHRcdFx0Y29udGludWU7XG5cdFx0XHRcdH1cblx0XHRcdFx0cGFydHMucHVzaChKU09OLnN0cmluZ2lmeSh2KSk7XG5cdFx0XHR9XG5cdFx0XHRpZiAocGFydHMubGVuZ3RoID4gMCkgbWVzc2FnZSA9IHBhcnRzLmpvaW4oJyAnKTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vIG5vdCBKU09OIGFmdGVyIGFsbCDigJQga2VlcCB0aGUgKHByZWZpeC1zdHJpcHBlZCkgbWVzc2FnZVxuXHRcdH1cblx0fSBlbHNlIHtcblx0XHQvLyDilIDilIAgMSkgTk9STUFMSVpFOiB0c2xvZydzIFwicHJldHR5XCIgKG5vbi1KU09OKSBjb25zb2xlIGZvcm1hdCDigJQgc3RyaXAgaXRzIG93biBkdXBsaWNhdGUgZGF0ZStsZXZlbC5cblx0XHRjb25zdCBwcmV0dHkgPSBwYXJzZVByZXR0eVRzbG9nUHJlZml4KGJvZHkpO1xuXHRcdGlmIChwcmV0dHkpIHtcblx0XHRcdGlmICghbGV2ZWwpIGxldmVsID0gcHJldHR5LmxldmVsO1xuXHRcdFx0bWVzc2FnZSA9IHByZXR0eS5tZXNzYWdlO1xuXHRcdH1cblx0fVxuXG5cdGNvbnN0IGNsZWFuTWVzc2FnZSA9IHN0cmlwQW5zaShtZXNzYWdlKTtcblx0bGV0IHJlc29sdmVkTGV2ZWwgPSBsZXZlbCA/PyBmYWxsYmFja0xldmVsKHJhdyk7XG5cdGxldCByZWNsYXNzaWZpZWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuXHQvLyBTcGxpdCB0aGUgY2FwdHVyZWQgc291cmNlIHBvc2l0aW9uIGludG8gcXVlcnlhYmxlIGBjb2RlRmlsZWAgKyBgY29kZUxpbmVgIChmb3IgXCJvcGVuIHRoZSBleGFjdFxuXHQvLyBjdWxwcml0IGxpbmVcIiBsaW5rcykuIFBhdGggaXMgbWFkZSByZXBvLXJlbGF0aXZlIChrZXB0IGZyb20gaXRzIGxhc3QgYHNyYy9gIHNlZ21lbnQpLlxuXHRsZXQgY29kZUZpbGU6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGNvZGVMaW5lOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGlmIChjb2RlTG9jKSB7XG5cdFx0Y29uc3QgbSA9IGNvZGVMb2MubWF0Y2goL14oLio/KTooXFxkKykoPzo6XFxkKyk/JC8pO1xuXHRcdGlmIChtKSB7XG5cdFx0XHQvLyBBYnNvbHV0ZSBwYXRoICjigKYvc3JjL+KApikg4oaSIG1ha2UgcmVwby1yZWxhdGl2ZSBmcm9tIHRoZSBsYXN0IGBzcmMvYC4gQWxyZWFkeS1yZWxhdGl2ZSBwYXRoc1xuXHRcdFx0Ly8gKHRoZSBsb2dnaW5nIGxheWVyIGVtaXRzIGBzcmMv4oCmYCkgYXJlIGtlcHQgYXMtaXMuXG5cdFx0XHRjb25zdCBzcmNJZHggPSBtWzFdLmxhc3RJbmRleE9mKCcvc3JjLycpO1xuXHRcdFx0Y29kZUZpbGUgPSBzcmNJZHggPj0gMCA/IG1bMV0uc2xpY2Uoc3JjSWR4ICsgMSkgOiBtWzFdO1xuXHRcdFx0Y29kZUxpbmUgPSBtWzJdO1xuXHRcdH1cblx0fVxuXG5cdC8vIOKUgOKUgCBMYXllcnMgMuKAkzQ6IGFwcC1sZXZlbCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzLCBhcHBsaWVkIHRvIHRoZSBub3JtYWxpemVkIG1lc3NhZ2UuIOKUgOKUgFxuXHRpZiAoSEFTX05PSVNFX1JVTEVTKSB7XG5cdFx0Ly8gMikgUkVDTEFTU0lGWTogYmVuaWduIFwiZXJyb3JzXCIg4oaSIHdhcm4gKG9ubHkgZG93bmdyYWRlLCBuZXZlciB1cGdyYWRlKS5cblx0XHRpZiAoRVJST1JJU0guaGFzKHJlc29sdmVkTGV2ZWwpICYmIGFueU1hdGNoKEJFTklHTl9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmVzb2x2ZWRMZXZlbCA9ICd3YXJuJztcblx0XHRcdHJlY2xhc3NpZmllZCA9ICdiZW5pZ24nO1xuXHRcdH1cblx0XHQvLyAzKSBEUk9QOiBub2lzZSByZW1vdmVkIGVudGlyZWx5IChuZXZlciBzaGlwcGVkIOKAlCBzYXZlcyBpbmdlc3QgYmFuZHdpZHRoIGF0IHRoZSBzb3VyY2UpLlxuXHRcdGlmIChhbnlNYXRjaChEUk9QX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXR1cm4gbnVsbDtcblx0XHR9XG5cdFx0Ly8gNCkgRE9XTkdSQURFOiBub2lzZSBrZXB0IGJ1dCBkZS1lbXBoYXNpc2VkIHRvIGRlYnVnLlxuXHRcdGlmIChhbnlNYXRjaChET1dOR1JBREVfUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJlc29sdmVkTGV2ZWwgPSAnZGVidWcnO1xuXHRcdFx0cmVjbGFzc2lmaWVkID0gJ25vaXNlJztcblx0XHR9XG5cdH1cblxuXHRjb25zdCByZWM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuXHRcdHNlcnZpY2U6IFNFUlZJQ0UsXG5cdFx0ZW52OiBFTlYsXG5cdFx0Li4uKFJFU09MVkVEX0FDQ09VTlQgPyB7IGFjY291bnQ6IFJFU09MVkVEX0FDQ09VTlQgfSA6IHt9KSxcblx0XHQuLi4oUkVHSU9OID8geyByZWdpb246IFJFR0lPTiB9IDoge30pLFxuXHRcdC4uLihWRVJTSU9OID8geyB2ZXJzaW9uOiBWRVJTSU9OIH0gOiB7fSksXG5cdFx0aG9zdDogc2hvcnRIb3N0KGxvZ0dyb3VwLCBsb2dTdHJlYW0pLFxuXHRcdC4uLihsb2dnZXIgPyB7IGxvZ2dlciB9IDoge30pLFxuXHRcdC4uLihyZXF1ZXN0SWQgPyB7IHJlcXVlc3RJZCB9IDoge30pLFxuXHRcdC4uLihsaWZ0ZWQgPz8ge30pLFxuXHRcdC4uLihjb3JyZWxhdGlvbklkID8geyBjb3JyZWxhdGlvbklkIH0gOiB7fSksXG5cdFx0Li4uKGNvZGVGaWxlID8geyBjb2RlRmlsZSB9IDoge30pLFxuXHRcdC4uLihjb2RlTGluZSA/IHsgY29kZUxpbmUgfSA6IHt9KSxcblx0XHRsZXZlbDogcmVzb2x2ZWRMZXZlbCxcblx0XHQuLi4ocmVjbGFzc2lmaWVkID8geyByZWNsYXNzaWZpZWQgfSA6IHt9KSxcblx0XHRtZXNzYWdlOiBjbGVhbk1lc3NhZ2UsXG5cdFx0dGltZXN0YW1wOiB0c0lzbyA/PyBuZXcgRGF0ZShlLnRpbWVzdGFtcCkudG9JU09TdHJpbmcoKSxcblx0XHRsb2dHcm91cCxcblx0XHRsb2dTdHJlYW0sXG5cdH07XG5cdC8vIERyb3AgbG93LXZhbHVlIGZpZWxkcyAoRk9SV0FSREVSX0RST1BfRklFTERTKSB0byBjdXQgaW5nZXN0L3N0b3JhZ2Ugc2l6ZS4gYGhvc3RgIChkZXJpdmVkIGZyb21cblx0Ly8gbG9nR3JvdXAvbG9nU3RyZWFtKSBpcyBrZXB0LCBzbyBkcm9wcGluZyB0aGUgcmF3IGdyb3VwL3N0cmVhbSBsb3NlcyBub3RoaW5nIGFjdGlvbmFibGUuXG5cdGlmIChEUk9QX1NFVC5zaXplKSBmb3IgKGNvbnN0IGsgb2YgRFJPUF9TRVQpIGRlbGV0ZSByZWNba107XG5cdHJldHVybiByZWM7XG59XG5cbi8qKiBTcGxpdCBwcmUtc2VyaWFsaXplZCBsaW5lcyBpbnRvIHN1Yi1iYXRjaGVzIHVuZGVyIE1BWF9CQVRDSF9CWVRFUyAodW5jb21wcmVzc2VkKS4gKi9cbmZ1bmN0aW9uIGNodW5rTGluZXMobGluZXM6IHN0cmluZ1tdKTogc3RyaW5nW11bXSB7XG5cdGNvbnN0IGNodW5rczogc3RyaW5nW11bXSA9IFtdO1xuXHRsZXQgY3VycmVudDogc3RyaW5nW10gPSBbXTtcblx0bGV0IHNpemUgPSAwO1xuXHRmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcblx0XHRjb25zdCBsaW5lQnl0ZXMgPSBCdWZmZXIuYnl0ZUxlbmd0aChsaW5lKSArIDE7IC8vICsxIGZvciB0aGUgZGVsaW1pdGVyXG5cdFx0aWYgKGN1cnJlbnQubGVuZ3RoID4gMCAmJiBzaXplICsgbGluZUJ5dGVzID4gTUFYX0JBVENIX0JZVEVTKSB7XG5cdFx0XHRjaHVua3MucHVzaChjdXJyZW50KTtcblx0XHRcdGN1cnJlbnQgPSBbXTtcblx0XHRcdHNpemUgPSAwO1xuXHRcdH1cblx0XHRjdXJyZW50LnB1c2gobGluZSk7XG5cdFx0c2l6ZSArPSBsaW5lQnl0ZXM7XG5cdH1cblx0aWYgKGN1cnJlbnQubGVuZ3RoID4gMCkge1xuXHRcdGNodW5rcy5wdXNoKGN1cnJlbnQpO1xuXHR9XG5cdHJldHVybiBjaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuY29kZUJvZHkobGluZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcblx0Ly8gbGluZXMgYXJlIGFscmVhZHkgSlNPTiBzdHJpbmdzXG5cdHJldHVybiBCQVRDSF9GT1JNQVQgPT09ICdqc29uLWFycmF5JyA/IGBbJHtsaW5lcy5qb2luKCcsJyl9XWAgOiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuZnVuY3Rpb24gcG9zdChnemlwcGVkOiBCdWZmZXIpOiBQcm9taXNlPHZvaWQ+IHtcblx0cmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcblx0XHRjb25zdCB1cmwgPSBuZXcgVVJMKElOR0VTVF9VUkwhKTtcblx0XHRjb25zdCBpc0h0dHBzID0gdXJsLnByb3RvY29sID09PSAnaHR0cHM6Jztcblx0XHRjb25zdCBsaWIgPSBpc0h0dHBzID8gaHR0cHMgOiBodHRwO1xuXHRcdGNvbnN0IHJlcSA9IGxpYi5yZXF1ZXN0KFxuXHRcdFx0dXJsLFxuXHRcdFx0e1xuXHRcdFx0XHRtZXRob2Q6ICdQT1NUJyxcblx0XHRcdFx0YWdlbnQ6IGlzSHR0cHMgPyBodHRwc0FnZW50IDogaHR0cEFnZW50LFxuXHRcdFx0XHRoZWFkZXJzOiB7XG5cdFx0XHRcdFx0J0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcblx0XHRcdFx0XHQnQ29udGVudC1FbmNvZGluZyc6ICdnemlwJyxcblx0XHRcdFx0XHQnQ29udGVudC1MZW5ndGgnOiBnemlwcGVkLmxlbmd0aCxcblx0XHRcdFx0XHQuLi4oWF9BUElfS0VZID8geyAneC1hcGkta2V5JzogWF9BUElfS0VZIH0gOiB7fSksXG5cdFx0XHRcdH0sXG5cdFx0XHR9LFxuXHRcdFx0KHJlcykgPT4ge1xuXHRcdFx0XHRyZXMucmVzdW1lKCk7IC8vIGRyYWluIHNvIHRoZSBzb2NrZXQgY2FuIGJlIHJldXNlZFxuXHRcdFx0XHRjb25zdCBzdGF0dXMgPSByZXMuc3RhdHVzQ29kZSA/PyAwO1xuXHRcdFx0XHRpZiAoc3RhdHVzID49IDIwMCAmJiBzdGF0dXMgPCAzMDApIHtcblx0XHRcdFx0XHRyZXNvbHZlKCk7XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0cmVqZWN0KG5ldyBFcnJvcihgaW5nZXN0IHJlc3BvbmRlZCAke3N0YXR1c31gKSk7XG5cdFx0XHRcdH1cblx0XHRcdH0sXG5cdFx0KTtcblx0XHRyZXEub24oJ2Vycm9yJywgcmVqZWN0KTtcblx0XHRyZXEuc2V0VGltZW91dChQT1NUX1RJTUVPVVRfTVMsICgpID0+IHJlcS5kZXN0cm95KG5ldyBFcnJvcignaW5nZXN0IHRpbWVvdXQnKSkpO1xuXHRcdHJlcS5lbmQoZ3ppcHBlZCk7XG5cdH0pO1xufVxuXG4vKiogUE9TVCBvbmUgY2h1bmsgd2l0aCBhIHNpbmdsZSByZXRyeS4gUmV0dXJucyBmYWxzZSBpZiB0aGUgY2h1bmsgd2FzIGRyb3BwZWQgYWZ0ZXIgcmV0cmllcy4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNoaXBXaXRoUmV0cnkoZ3ppcHBlZDogQnVmZmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG5cdGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDw9IE1BWF9SRVRSSUVTOyBhdHRlbXB0KyspIHtcblx0XHR0cnkge1xuXHRcdFx0YXdhaXQgcG9zdChnemlwcGVkKTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH0gY2F0Y2ggKGVycikge1xuXHRcdFx0aWYgKGF0dGVtcHQgPT09IE1BWF9SRVRSSUVTKSB7XG5cdFx0XHRcdC8vIFN3YWxsb3cgYWZ0ZXIgcmV0cmllczogYSBwZXJzaXN0ZW50IGluZ2VzdCBvdXRhZ2UgbXVzdCBub3QgY3JlYXRlIGEgQ2xvdWRXYXRjaCByZXRyeSBzdG9ybS5cblx0XHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdFx0Y29uc29sZS5lcnJvcignW2xvZy1mb3J3YXJkZXJdIHNoaXAgZmFpbGVkLCBkcm9wcGluZyBjaHVuazonLCAoZXJyIGFzIEVycm9yKS5tZXNzYWdlKTtcblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBFbWl0IGFuIGFsYXJtYWJsZSBDbG91ZFdhdGNoIG1ldHJpYyAoRU1GKSB3aGVuIHJlY29yZHMgYXJlIGRyb3BwZWQg4oCUIG5vIFNESywganVzdCBzdHJ1Y3R1cmVkIHN0ZG91dC4gKi9cbmZ1bmN0aW9uIGVtaXREcm9wcGVkTWV0cmljKHJlY29yZHM6IG51bWJlcik6IHZvaWQge1xuXHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRjb25zb2xlLmxvZyhcblx0XHRKU09OLnN0cmluZ2lmeSh7XG5cdFx0XHRfYXdzOiB7XG5cdFx0XHRcdFRpbWVzdGFtcDogRGF0ZS5ub3coKSxcblx0XHRcdFx0Q2xvdWRXYXRjaE1ldHJpY3M6IFtcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHROYW1lc3BhY2U6ICdMb2dGb3J3YXJkZXInLFxuXHRcdFx0XHRcdFx0RGltZW5zaW9uczogWyBbICdzZXJ2aWNlJyBdIF0sXG5cdFx0XHRcdFx0XHRNZXRyaWNzOiBbIHsgTmFtZTogJ0Ryb3BwZWRSZWNvcmRzJywgVW5pdDogJ0NvdW50JyB9IF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblx0XHRcdH0sXG5cdFx0XHRzZXJ2aWNlOiBTRVJWSUNFLFxuXHRcdFx0RHJvcHBlZFJlY29yZHM6IHJlY29yZHMsXG5cdFx0fSksXG5cdCk7XG59XG5cbmludGVyZmFjZSBMYW1iZGFDb250ZXh0TGlrZSB7XG5cdGludm9rZWRGdW5jdGlvbkFybj86IHN0cmluZztcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IENsb3VkV2F0Y2hMb2dzRXZlbnQsIGNvbnRleHQ/OiBMYW1iZGFDb250ZXh0TGlrZSk6IFByb21pc2U8dm9pZD4gPT4ge1xuXHQvLyBSZXNvbHZlIHRoZSBhY2NvdW50IGZyb20gdGhpcyBmb3J3YXJkZXIncyBvd24gQVJOIG9uY2UgKHNhbWUgZm9yIGV2ZXJ5IGludm9jYXRpb24pLlxuXHRpZiAoIVJFU09MVkVEX0FDQ09VTlQgJiYgY29udGV4dD8uaW52b2tlZEZ1bmN0aW9uQXJuKSB7XG5cdFx0UkVTT0xWRURfQUNDT1VOVCA9IGFjY291bnRGcm9tQXJuKGNvbnRleHQuaW52b2tlZEZ1bmN0aW9uQXJuKTtcblx0fVxuXHRpZiAoIUlOR0VTVF9VUkwpIHtcblx0XHRyZXR1cm47IC8vIG5vdCBjb25maWd1cmVkIHlldCDigJQgbm8tb3AgKHNhZmUgdG8gZGVwbG95IGJlZm9yZSB3aXJpbmcgdGhlIGluZ2VzdCBVUkwpXG5cdH1cblxuXHRsZXQgcGF5bG9hZDogRGVjb2RlZFBheWxvYWQ7XG5cdHRyeSB7XG5cdFx0cGF5bG9hZCA9IEpTT04ucGFyc2UoZ3VuemlwU3luYyhCdWZmZXIuZnJvbShldmVudC5hd3Nsb2dzLmRhdGEsICdiYXNlNjQnKSkudG9TdHJpbmcoJ3V0ZjgnKSkgYXMgRGVjb2RlZFBheWxvYWQ7XG5cdH0gY2F0Y2ggKGVycikge1xuXHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0Y29uc29sZS5lcnJvcignW2xvZy1mb3J3YXJkZXJdIGZhaWxlZCB0byBkZWNvZGUgcGF5bG9hZDonLCAoZXJyIGFzIEVycm9yKS5tZXNzYWdlKTtcblx0XHRyZXR1cm47XG5cdH1cblxuXHRpZiAocGF5bG9hZC5tZXNzYWdlVHlwZSA9PT0gJ0NPTlRST0xfTUVTU0FHRScpIHtcblx0XHRyZXR1cm47IC8vIHN1YnNjcmlwdGlvbiBsaXZlbmVzcyBwaW5nXG5cdH1cblx0Y29uc3QgZXZlbnRzID0gcGF5bG9hZC5sb2dFdmVudHM7XG5cdGlmICghQXJyYXkuaXNBcnJheShldmVudHMpIHx8IGV2ZW50cy5sZW5ndGggPT09IDApIHtcblx0XHRyZXR1cm47XG5cdH1cblxuXHRjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcblx0Zm9yIChjb25zdCBlIG9mIGV2ZW50cykge1xuXHRcdGNvbnN0IHJlY29yZCA9IHRvVmVjdG9yUmVjb3JkKGUsIHBheWxvYWQubG9nR3JvdXAsIHBheWxvYWQubG9nU3RyZWFtKTtcblx0XHRpZiAocmVjb3JkICE9PSBudWxsKSB7XG5cdFx0XHRsaW5lcy5wdXNoKEpTT04uc3RyaW5naWZ5KHJlY29yZCkpO1xuXHRcdH1cblx0fVxuXHRpZiAobGluZXMubGVuZ3RoID09PSAwKSB7XG5cdFx0cmV0dXJuOyAvLyB3aG9sZSBiYXRjaCB3YXMgbm9pc2UgLyBkcm9wcGVkXG5cdH1cblx0bGV0IGRyb3BwZWQgPSAwO1xuXHRmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rTGluZXMobGluZXMpKSB7XG5cdFx0Y29uc3QgZ3ppcHBlZCA9IGd6aXBTeW5jKEJ1ZmZlci5mcm9tKGVuY29kZUJvZHkoY2h1bmspKSk7XG5cdFx0Y29uc3Qgb2sgPSBhd2FpdCBzaGlwV2l0aFJldHJ5KGd6aXBwZWQpO1xuXHRcdGlmICghb2spIHtcblx0XHRcdGRyb3BwZWQgKz0gY2h1bmsubGVuZ3RoO1xuXHRcdH1cblx0fVxuXHRpZiAoZHJvcHBlZCA+IDApIHtcblx0XHRlbWl0RHJvcHBlZE1ldHJpYyhkcm9wcGVkKTtcblx0fVxufTtcbiJdfQ==