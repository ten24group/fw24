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
// Lambda platform/runtime failures that crash or kill the invocation outright — a timeout, an OOM
// kill, or the runtime exiting early. None of these carry an ERROR/FATAL/WARN token of their own, so
// without this they'd fall through to the `info` default and be invisible to error-signature scanning.
const LAMBDA_CRASH_RE = /task timed out after|process exited before completing request|runtime exited with error|runtime\.(?:exiterror|outofmemory)|out of memory|signal:\s*killed/i;
function fallbackLevel(raw) {
    if (/\b(?:ERROR|FATAL)\b/.test(raw))
        return 'error';
    if (LAMBDA_CRASH_RE.test(raw))
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
    let causedBy;
    let actorId;
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
                if (typeof meta.causedBy === 'string' && meta.causedBy.trim())
                    causedBy = meta.causedBy.trim();
                if (typeof meta.actorId === 'string' && meta.actorId.trim())
                    actorId = meta.actorId.trim();
                // tslog native source position (mode 'all'): _meta.path.
                const p = meta.path;
                if (p && typeof p === 'object') {
                    if (typeof p.filePathWithLine === 'string')
                        codeLoc = p.filePathWithLine;
                    else if (typeof p.fileName === 'string' && p.fileLine != null)
                        codeLoc = `${p.fileName}:${p.fileLine}`;
                }
            }
            else if (typeof o.errorType === 'string' && typeof o.errorMessage === 'string') {
                // Lambda's own invocation-error envelope (crash/timeout/OOM reported by the platform, not
                // by app code) — no `_meta`, so it'd otherwise fall through to the `info` default.
                level = 'error';
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
        ...(causedBy ? { causedBy } : {}),
        ...(actorId ? { actorId } : {}),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBZ0NHO0FBQ0gseUNBQWlEO0FBQ2pELGdEQUFrQztBQUNsQyxrREFBb0M7QUFDcEMsdUNBQStCO0FBRS9CLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDeEUscUdBQXFHO0FBQ3JHLGdHQUFnRztBQUNoRyxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDM0QsdUdBQXVHO0FBQ3ZHLHFHQUFxRztBQUNyRyxrRkFBa0Y7QUFDbEYsTUFBTSxPQUFPLEdBQUcsR0FBRyxJQUFJLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDbkYsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUVqRSxxR0FBcUc7QUFDckcsc0dBQXNHO0FBQ3RHLHFHQUFxRztBQUNyRyxzRkFBc0Y7QUFDdEYsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDO0FBQ3BELElBQUksZ0JBQWdCLEdBQUcs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QUM7WUFDVCxPQUFPLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQztRQUN6QixDQUFDO0lBQ0YsQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pCLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzVCLENBQUM7QUFDRixDQUFDLENBQUM7QUEvQ1csUUFBQSxPQUFPLFdBK0NsQiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xvdWRXYXRjaCBMb2dzIC0+IFZlY3Rvci9Mb2d0cmFpbCBmb3J3YXJkZXIgKG91dC1vZi1iYW5kIGxvZyBzaGlwcGluZykuXG4gKlxuICogQXBwIExhbWJkYXMgb25seSB3cml0ZSB0byBzdGRvdXQgKENsb3VkV2F0Y2gpIOKAlCBub3RoaW5nIHJ1bnMgaW4gdGhlaXIgcmVxdWVzdCBwYXRoLiBBIENsb3VkV2F0Y2hcbiAqIExvZ3Mgc3Vic2NyaXB0aW9uIGZpbHRlciBzdHJlYW1zIGJhdGNoZWQsIGd6aXBwZWQgZXZlbnRzIHRvIHRoaXMgZnVuY3Rpb24sIHdoaWNoIHJlc2hhcGVzIHRoZW0gdG9cbiAqIGNsZWFuIFZlY3RvciBKU09OIHJlY29yZHMgYW5kIHNoaXBzIHRoZW0gdG8gdGhlIGluZ2VzdCBlbmRwb2ludCBvdmVyIGEga2VlcC1hbGl2ZSBjb25uZWN0aW9uLFxuICogZ3ppcC1jb21wcmVzc2VkIGFuZCBzcGxpdCBpbnRvIGJvdW5kZWQgc3ViLWJhdGNoZXMuXG4gKlxuICogUHJvY2Vzc2luZyBwaXBlbGluZSBwZXIgZXZlbnQgKHNlZSBgTG9nRm9yd2FyZGVyQ29uc3RydWN0YCk6XG4gKiAgIDEuIE5PUk1BTElaRSAg4oCUIHBlZWwgQVdTIExhbWJkYSdzIHRleHQgcHJlZml4LCBsaWZ0IGZ3MjQgdHNsb2cgSlNPTiwgc3RyaXAgQU5TSSwgc2hvcnRlbiBob3N0LlxuICogICAyLiBSRUNMQVNTSUZZIOKAlCBlcnJvci1pc2ggbGluZXMgbWF0Y2hpbmcgYSBcImJlbmlnblwiIHBhdHRlcm4g4oaSIGB3YXJuYCAoYHJlY2xhc3NpZmllZDogXCJiZW5pZ25cImApLlxuICogICAzLiBEUk9QICAgICAgIOKAlCBsaW5lcyBtYXRjaGluZyBhIFwiZHJvcFwiIHBhdHRlcm4gYXJlIHJlbW92ZWQgZW50aXJlbHkgKHNhdmVkIGJhbmR3aWR0aCBhdCBzb3VyY2UpLlxuICogICA0LiBET1dOR1JBREUgIOKAlCBsaW5lcyBtYXRjaGluZyBhIFwiZG93bmdyYWRlXCIgcGF0dGVybiDihpIgYGRlYnVnYCAoYHJlY2xhc3NpZmllZDogXCJub2lzZVwiYCkuXG4gKiBTdGVwcyAy4oCTNCBhcmUgYXBwLW93bmVkIHJ1bGUgbGlzdHMgKGVudi1pbmplY3RlZCBieSB0aGUgY29uc3RydWN0KSwgY29tcGxlbWVudGFyeSB0byBhbnkgZ2xvYmFsXG4gKiBzZXZlcml0eS9ub2lzZSBoYW5kbGluZyBhIHNoYXJlZCBWZWN0b3IgaW5nZXN0IG1heSBhbHNvIGFwcGx5LlxuICpcbiAqIEV2ZXJ5IHJlY29yZCBhbHNvIGNhcnJpZXMgYGFjY291bnRgICsgYHJlZ2lvbmAgKGZyb20gdGhlIGZvcndhcmRlcidzIG93biBBUk4pIHNvIGRlcGxveW1lbnRzIHRoYXRcbiAqIHNoYXJlIGFwcCArIGVudiBuYW1lcyDigJQgZS5nLiBtdWx0aXBsZSBkZXZlbG9wZXJzIGVhY2ggcnVubmluZyBgcGx1c2Zhbi10cmlhbHNgIChBUFBfRU5WSVJPTk1FTlQ9bG9jYWwpXG4gKiBpbiB0aGVpciBPV04gYWNjb3VudCDigJQgc3RheSBkaXN0aW5ndWlzaGFibGUgaW5zdGVhZCBvZiBjb2xsaWRpbmcgdW5kZXIgb25lIGBzZXJ2aWNlYCBsYWJlbC5cbiAqXG4gKiBUd28gbW9yZSBhcHAtb3duZWQgZW5yaWNobWVudHMsIGJvdGggY29uZmlnLWRyaXZlbiAodGhlIGZvcndhcmRlciBuZXZlciBndWVzc2VzIGZyb20gZnJlZSB0ZXh0KTpcbiAqICAg4oCiIEZJRUxEIExJRlRJTkcgKGBGT1JXQVJERVJfRklFTERTYCkg4oCUIHByb21vdGUgYXBwLWRlY2xhcmVkIHN0cnVjdHVyZWQgZmllbGRzIChlLmcuIGBjb3JyZWxhdGlvbklkYCxcbiAqICAgICBgb3JkZXJJZGAsIGB1c2VySWRgKSBvdXQgb2YgdGhlIHRzbG9nIEpTT04gYXJncyBpbnRvIHF1ZXJ5YWJsZSB0b3AtbGV2ZWwgcmVjb3JkIGZpZWxkcy4gVGhpcyBpc1xuICogICAgIHdoYXQgbGV0cyBMb2d0cmFpbCBmb2xsb3cgb25lIHJlcXVlc3QgYWNyb3NzIHNlcnZpY2VzLCBvciBmaWx0ZXIgXCJhbGwgbG9ncyBmb3Igb3JkZXIgOTkxXCIuXG4gKiAgIOKAoiBWRVJTSU9OIChgRk9SV0FSREVSX1ZFUlNJT05gKSDigJQgc3RhbXAgZXZlcnkgbGluZSB3aXRoIHRoZSByZWxlYXNlIHRoYXQgcHJvZHVjZWQgaXQsIHNvIGJlaGF2aW9yXG4gKiAgICAgY2hhbmdlcyBjYW4gYmUgYXR0cmlidXRlZCB0byBhIGRlcGxveS5cbiAqXG4gKiBFTlYgTkFNRVNQQUNFOiB0aGlzIGZ1bmN0aW9uIHJlYWRzIE9OTFkgYEZPUldBUkRFUl8qYCBlbnYgdmFycyDigJQgZGVsaWJlcmF0ZWx5IE5PVCB0aGUgYExPR1RSQUlMXypgXG4gKiBrZXlzIHVzZWQgYnkgZncyNCdzIGluLXByb2Nlc3MgbG9nIHRyYW5zcG9ydC4gVGhhdCBndWFyYW50ZWVzIHRoZSBmb3J3YXJkZXIgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCxcbiAqIG9yIGFjY2lkZW50YWxseSBhY3RpdmF0ZSwgZncyNCdzIGluLXByb2Nlc3MgTG9ndHJhaWwgbWFjaGluZXJ5LlxuICpcbiAqIERFUEVOREVOQ1ktRlJFRSAobm9kZSBidWlsdC1pbnMgb25seSkgc28gdGhlIGZvcndhcmRlciBidW5kbGUgc3RheXMgdGlueSBhbmQgY2hlYXAuXG4gKi9cbmltcG9ydCB7IGd1bnppcFN5bmMsIGd6aXBTeW5jIH0gZnJvbSAnbm9kZTp6bGliJztcbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJztcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnO1xuaW1wb3J0IHsgVVJMIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5jb25zdCBJTkdFU1RfVVJMID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9VUkw/LnRyaW0oKTtcbmNvbnN0IEJBU0VfU0VSVklDRSA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9TRVJWSUNFPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gU3RhZ2Uvb3duZXIgbGFiZWwgKGUuZy4gYGRldmVsb3BgLCBgcHJvZGAsIGBzYW5kYm94LW5pdGluYCkgc28gZGV2ZWxvcC9wcm9kL3Blci1kZXZlbG9wZXIgbG9ncyBhcmVcbi8vIGRpc3Rpbmd1aXNoYWJsZSDigJQgdGhlcmUgY2FuIGJlIHNldmVyYWwgZGVwbG95bWVudHMgb2Ygb25lIHNlcnZpY2UgYWNyb3NzIGVudnMgYW5kIGRldmVsb3BlcnMuXG5jb25zdCBFTlYgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfRU5WPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gVGhlIGBzZXJ2aWNlYCBsYWJlbCBpcyB3aGF0J3MgcHJvbW90ZWQgdG8gYSBMb2tpIGxhYmVsIChhbmQgc2hvd24gaW4gTG9ndHJhaWwpLCBzbyBmb2xkIHRoZSBlbnYgaW50b1xuLy8gaXQg4oCUIGBwbHVzZmFuLXRyaWFscy1kZXZlbG9wYCwgYHBsdXNmYW4tdHJpYWxzLXNhbmRib3gtbml0aW5gLCDigKYg4oCUIGd1YXJhbnRlZWluZyBlYWNoIGRlcGxveW1lbnQgaXNcbi8vIGRpc3RpbmN0IGF0IGEgZ2xhbmNlLiBgZW52YCBpcyBhbHNvIGVtaXR0ZWQgYXMgYSBzdHJ1Y3R1cmVkIGZpZWxkIGZvciBxdWVyeWluZy5cbmNvbnN0IFNFUlZJQ0UgPSBFTlYgJiYgRU5WICE9PSAndW5rbm93bicgPyBgJHtCQVNFX1NFUlZJQ0V9LSR7RU5WfWAgOiBCQVNFX1NFUlZJQ0U7XG5jb25zdCBYX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWT8udHJpbSgpO1xuXG4vLyBBV1MgYWNjb3VudCArIHJlZ2lvbiBkaXNhbWJpZ3VhdGUgZGVwbG95bWVudHMgdGhhdCBzaGFyZSBhcHAgKyBlbnYgbmFtZXMg4oCUIGUuZy4gc2V2ZXJhbCBkZXZlbG9wZXJzXG4vLyBlYWNoIGRlcGxveWluZyB0aGUgU0FNRSBhcHAgKGBwbHVzZmFuLXRyaWFsc2AsIEFQUF9FTlZJUk9OTUVOVD1sb2NhbCkgdG8gdGhlaXIgT1dOIGFjY291bnQuIFdpdGhvdXRcbi8vIHRoaXMsIGFsbCB0aGVpciBsb2dzIHdvdWxkIGNvbGxpZGUgdW5kZXIgb25lIGBzZXJ2aWNlYCBsYWJlbC4gUmVnaW9uIGlzIHNldCBieSB0aGUgTGFtYmRhIHJ1bnRpbWU7XG4vLyBhY2NvdW50IGlzIHBhcnNlZCBmcm9tIHRoZSBpbnZva2VkIGZ1bmN0aW9uIEFSTiBvbiB0aGUgZmlyc3QgaW52b2NhdGlvbiBhbmQgY2FjaGVkLlxuY29uc3QgUkVHSU9OID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTj8udHJpbSgpIHx8ICcnO1xubGV0IFJFU09MVkVEX0FDQ09VTlQgPSAnJztcbmZ1bmN0aW9uIGFjY291bnRGcm9tQXJuKGFybjogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcblx0Ly8gYXJuOmF3czpsYW1iZGE6PHJlZ2lvbj46PEFDQ09VTlQ+OmZ1bmN0aW9uOjxuYW1lPlxuXHRjb25zdCBwYXJ0cyA9IChhcm4gfHwgJycpLnNwbGl0KCc6Jyk7XG5cdHJldHVybiBwYXJ0cy5sZW5ndGggPiA0ID8gcGFydHNbNF0gOiAnJztcbn1cbi8vIFRoZSBmdzI0IExvZ3RyYWlsL1ZlY3RvciBpbmdlc3QgZGVjb2RlcyBhIEpTT04gYXJyYXkgaW50byBpbmRpdmlkdWFsIGV2ZW50cyBhbmQgUkVKRUNUUyBOREpTT04gKDQwMCksXG4vLyBzbyBganNvbi1hcnJheWAgaXMgdGhlIGRlZmF1bHQuIE92ZXJyaWRlIHRvIGBuZGpzb25gIG9ubHkgZm9yIGFuIGluZ2VzdCBjb25maWd1cmVkIHdpdGggbmV3bGluZSBmcmFtaW5nLlxuY29uc3QgQkFUQ0hfRk9STUFUID0gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9CQVRDSF9GT1JNQVQ/LnRyaW0oKSB8fCAnanNvbi1hcnJheScpIGFzICduZGpzb24nIHwgJ2pzb24tYXJyYXknO1xuLyoqIE1heCB1bmNvbXByZXNzZWQgYnl0ZXMgcGVyIFBPU1Qg4oCUIGJvdW5kcyByZXF1ZXN0IHNpemUgc28gYSBsYXJnZSBDbG91ZFdhdGNoIGJhdGNoIGNhbid0IDQxMyB0aGUgaW5nZXN0LiAqL1xuY29uc3QgTUFYX0JBVENIX0JZVEVTID0gTnVtYmVyKHByb2Nlc3MuZW52LkZPUldBUkRFUl9NQVhfQkFUQ0hfQllURVMpIHx8IDFfMDAwXzAwMDtcbmNvbnN0IFBPU1RfVElNRU9VVF9NUyA9IE51bWJlcihwcm9jZXNzLmVudi5GT1JXQVJERVJfUE9TVF9USU1FT1VUX01TKSB8fCA1MDAwO1xuY29uc3QgTUFYX1JFVFJJRVMgPSAxO1xuXG4vLyDilIDilIAgQXBwLWxldmVsIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMgKGxheWVycyAy4oCTNCkuIEVhY2ggZW52IHZhciBpcyBhIEpTT04gYXJyYXkgb2YgcmVnZXggc291cmNlXG4vLyAgICBzdHJpbmdzOyBjb21waWxlZCBjYXNlLWluc2Vuc2l0aXZlbHkgb25jZSwgaGVyZSwgYXQgY29sZCBzdGFydC4gRW1wdHkvbWFsZm9ybWVkIOKGkiBubyBydWxlcy4g4pSA4pSAXG5mdW5jdGlvbiBjb21waWxlUnVsZXMocmF3SnNvbjogc3RyaW5nIHwgdW5kZWZpbmVkKTogUmVnRXhwW10ge1xuXHRpZiAoIXJhd0pzb24pIHJldHVybiBbXTtcblx0bGV0IGFycjogdW5rbm93bjtcblx0dHJ5IHtcblx0XHRhcnIgPSBKU09OLnBhcnNlKHJhd0pzb24pO1xuXHR9IGNhdGNoIHtcblx0XHRyZXR1cm4gW107XG5cdH1cblx0aWYgKCFBcnJheS5pc0FycmF5KGFycikpIHJldHVybiBbXTtcblx0Y29uc3Qgb3V0OiBSZWdFeHBbXSA9IFtdO1xuXHRmb3IgKGNvbnN0IHNyYyBvZiBhcnIpIHtcblx0XHRpZiAodHlwZW9mIHNyYyAhPT0gJ3N0cmluZycgfHwgc3JjLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cdFx0dHJ5IHtcblx0XHRcdG91dC5wdXNoKG5ldyBSZWdFeHAoc3JjLCAnaScpKTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vIEEgYmFkIHBhdHRlcm4gbXVzdCBuZXZlciBicmVhayB0aGUgZm9yd2FyZGVyIOKAlCBza2lwIGl0LlxuXHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdGNvbnNvbGUud2FybignW2xvZy1mb3J3YXJkZXJdIGlnbm9yaW5nIGludmFsaWQgbm9pc2UgcGF0dGVybjonLCBzcmMpO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gb3V0O1xufVxuXG5jb25zdCBCRU5JR05fUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0JFTklHTik7XG5jb25zdCBEUk9QX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9EUk9QKTtcbmNvbnN0IERPV05HUkFERV9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfRE9XTkdSQURFKTtcbmNvbnN0IEhBU19OT0lTRV9SVUxFUyA9IEJFTklHTl9SVUxFUy5sZW5ndGggPiAwIHx8IERST1BfUlVMRVMubGVuZ3RoID4gMCB8fCBET1dOR1JBREVfUlVMRVMubGVuZ3RoID4gMDtcblxuLy8g4pSA4pSAIEFwcC1kZWNsYXJlZCBmaWVsZCBsaWZ0aW5nIChGT1JXQVJERVJfRklFTERTKTogYSBKU09OIGFycmF5IG9mIGZpZWxkIG5hbWVzIHRoZSBhcHAgd2FudHMgcHJvbW90ZWRcbi8vICAgIGZyb20gaXRzIHN0cnVjdHVyZWQgdHNsb2cgYXJncyB0byBxdWVyeWFibGUgdG9wLWxldmVsIHJlY29yZCBmaWVsZHMgKGUuZy4gY29ycmVsYXRpb25JZCwgb3JkZXJJZCkuXG4vLyAgICBUaGUgYXBwIG93bnMgdGhpcyBsaXN0IHZpYSB0aGUgY29uc3RydWN0OyB0aGUgZm9yd2FyZGVyIG5ldmVyIHNjcmFwZXMgZnJlZSB0ZXh0IGZvciB0aGVtLiDilIDilIBcbmZ1bmN0aW9uIHBhcnNlRmllbGRMaXN0KHJhd0pzb246IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZ1tdIHtcblx0aWYgKCFyYXdKc29uKSByZXR1cm4gW107XG5cdHRyeSB7XG5cdFx0Y29uc3QgYXJyID0gSlNPTi5wYXJzZShyYXdKc29uKTtcblx0XHRpZiAoIUFycmF5LmlzQXJyYXkoYXJyKSkgcmV0dXJuIFtdO1xuXHRcdHJldHVybiBbIC4uLm5ldyBTZXQoYXJyLmZpbHRlcigocyk6IHMgaXMgc3RyaW5nID0+IHR5cGVvZiBzID09PSAnc3RyaW5nJyAmJiBzLnRyaW0oKS5sZW5ndGggPiAwKS5tYXAoKHMpID0+IHMudHJpbSgpKSkgXTtcblx0fSBjYXRjaCB7XG5cdFx0cmV0dXJuIFtdO1xuXHR9XG59XG5jb25zdCBMSUZUX1NFVCA9IG5ldyBTZXQocGFyc2VGaWVsZExpc3QocHJvY2Vzcy5lbnYuRk9SV0FSREVSX0ZJRUxEUykpO1xuY29uc3QgSEFTX0xJRlRfRklFTERTID0gTElGVF9TRVQuc2l6ZSA+IDA7XG5cbi8vIFJlbGVhc2UvdmVyc2lvbiBzdGFtcCBzbyBldmVyeSBzaGlwcGVkIGxpbmUgaXMgYXR0cmlidXRhYmxlIHRvIHRoZSBkZXBsb3kgdGhhdCBwcm9kdWNlZCBpdC4gU2V0IGJ5IHRoZVxuLy8gY29uc3RydWN0IGF0IGRlcGxveSB0aW1lIChzZW12ZXIgb3IgZ2l0IHNoYSk7IG9taXR0ZWQgZnJvbSByZWNvcmRzIHdoZW4gdW5zZXQuXG5jb25zdCBWRVJTSU9OID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX1ZFUlNJT04/LnRyaW0oKSB8fCAnJztcblxuLy8g4pSA4pSAIEZpZWxkIGRyb3AtbGlzdCAoRk9SV0FSREVSX0RST1BfRklFTERTKTogcmVjb3JkIGtleXMgdG8gT01JVCBiZWZvcmUgc2hpcHBpbmcsIHRvIGN1dCBpbmdlc3Qvc3RvcmFnZVxuLy8gICAgc2l6ZSBvbiBsb3ctdmFsdWUgZmllbGRzLiBEZWZhdWx0IGRyb3BzIGxvZ1N0cmVhbS9sb2dHcm91cC9zb3VyY2VfdHlwZS9yZWFzb24gKGhvc3QgaXMgc3RpbGwga2VwdCkuXG4vLyAgICBUaGUgY29uc3RydWN0IHNldHMgdGhpcyBmcm9tIHRoZSBgZHJvcEZpZWxkc2AgY29uZmlnOyB1bnNldCDihpIgdGhlIGRlZmF1bHRzIGJlbG93LiBDb3JlIGtleXMgY2FuXG4vLyAgICBuZXZlciBiZSBkcm9wcGVkIChiZWx0LWFuZC1zdXNwZW5kZXJzIGFnYWluc3QgbWlzY29uZmlnKS4g4pSA4pSAXG5jb25zdCBERUZBVUxUX0RST1BfRklFTERTID0gWyAnbG9nU3RyZWFtJywgJ2xvZ0dyb3VwJywgJ3NvdXJjZV90eXBlJywgJ3JlYXNvbicgXTtcbmNvbnN0IE5FVkVSX0RST1AgPSBuZXcgU2V0KFsgJ3NlcnZpY2UnLCAnbGV2ZWwnLCAnbWVzc2FnZScsICd0aW1lc3RhbXAnIF0pO1xuY29uc3QgRFJPUF9TRVQgPSBuZXcgU2V0KFxuXHQocHJvY2Vzcy5lbnYuRk9SV0FSREVSX0RST1BfRklFTERTICE9PSB1bmRlZmluZWRcblx0XHQ/IHBhcnNlRmllbGRMaXN0KHByb2Nlc3MuZW52LkZPUldBUkRFUl9EUk9QX0ZJRUxEUylcblx0XHQ6IERFRkFVTFRfRFJPUF9GSUVMRFNcblx0KS5maWx0ZXIoKGspID0+ICFORVZFUl9EUk9QLmhhcyhrKSksXG4pO1xuXG4vLyBSZWNvcmQga2V5cyB0aGUgZm9yd2FyZGVyIG93bnMg4oCUIGEgbGlmdGVkIGFwcCBmaWVsZCBtdXN0IG5ldmVyIG92ZXJ3cml0ZSBvbmUgb2YgdGhlc2UuXG5jb25zdCBSRVNFUlZFRF9GSUVMRF9LRVlTID0gbmV3IFNldChbXG5cdCdzZXJ2aWNlJywgJ2VudicsICdhY2NvdW50JywgJ3JlZ2lvbicsICd2ZXJzaW9uJywgJ2hvc3QnLCAnbG9nZ2VyJywgJ3JlcXVlc3RJZCcsXG5cdCdsZXZlbCcsICdyZWNsYXNzaWZpZWQnLCAnbWVzc2FnZScsICd0aW1lc3RhbXAnLCAnbG9nR3JvdXAnLCAnbG9nU3RyZWFtJyxcblx0J2NvZGVGaWxlJywgJ2NvZGVMaW5lJyxcbl0pO1xuXG4vKipcbiAqIExpZnQgdGhlIGFwcC1kZWNsYXJlZCB7QGxpbmsgTElGVF9TRVR9IGZpZWxkcyBvdXQgb2YgYSBwYXJzZWQgdHNsb2cgb2JqZWN0IGludG8gZmxhdCBge2tleTogdmFsdWV9YFxuICogc3RyaW5nIHBhaXJzLiBTY2FucyB0aGUgb2JqZWN0J3Mgb3duIHNjYWxhciBrZXlzIEFORCBvbmUgbGV2ZWwgaW50byBpdHMgcG9zaXRpb25hbC1hcmd1bWVudCBvYmplY3RzXG4gKiAoXCIwXCIuLlwiblwiKSwgc28gYGxvZ2dlci5pbmZvKCdjaGFyZ2UgZmFpbGVkJywgeyBvcmRlcklkLCBjb3JyZWxhdGlvbklkIH0pYCBzdXJmYWNlcyBib3RoLiBSZXNlcnZlZFxuICogcmVjb3JkIGtleXMgYXJlIG5ldmVyIGxpZnRlZDsgdmFsdWVzIGFyZSBjb2VyY2VkIHRvIHRyaW1tZWQgc3RyaW5nczsgZmlyc3Qgb2NjdXJyZW5jZSB3aW5zLlxuICovXG5mdW5jdGlvbiBleHRyYWN0TGlmdGVkRmllbGRzKG86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG5cdGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXHRjb25zdCB0YWtlID0gKGs6IHN0cmluZywgdjogdW5rbm93bik6IHZvaWQgPT4ge1xuXHRcdGlmIChvdXRba10gIT09IHVuZGVmaW5lZCB8fCBSRVNFUlZFRF9GSUVMRF9LRVlTLmhhcyhrKSB8fCAhTElGVF9TRVQuaGFzKGspKSByZXR1cm47XG5cdFx0aWYgKHR5cGVvZiB2ID09PSAnc3RyaW5nJyB8fCB0eXBlb2YgdiA9PT0gJ251bWJlcicgfHwgdHlwZW9mIHYgPT09ICdib29sZWFuJykge1xuXHRcdFx0Y29uc3QgcyA9IFN0cmluZyh2KS50cmltKCk7XG5cdFx0XHRpZiAocykgb3V0W2tdID0gcztcblx0XHR9XG5cdH07XG5cdGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMobykpIHtcblx0XHRpZiAoayA9PT0gJ19tZXRhJykgY29udGludWU7XG5cdFx0aWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHYpKSB7XG5cdFx0XHRmb3IgKGNvbnN0IFsgazIsIHYyIF0gb2YgT2JqZWN0LmVudHJpZXModiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHRha2UoazIsIHYyKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0dGFrZShrLCB2KTtcblx0XHR9XG5cdH1cblx0cmV0dXJuIG91dDtcbn1cblxuLy8gTGV2ZWxzIHRoYXQgY291bnQgYXMgXCJlcnJvci1pc2hcIiBmb3IgdGhlIGJlbmlnbiBkb3duZ3JhZGUgKG1pcnJvcnMgdGhlIFZlY3RvciBBMSBsaXN0KS5cbmNvbnN0IEVSUk9SSVNIID0gbmV3IFNldChbICdlcnJvcicsICdlcnInLCAnZmF0YWwnLCAnY3JpdGljYWwnLCAnY3JpdCcsICdlbWVyZycsICdhbGVydCcsICdwYW5pYycgXSk7XG5mdW5jdGlvbiBhbnlNYXRjaChydWxlczogUmVnRXhwW10sIG1zZzogc3RyaW5nKTogYm9vbGVhbiB7XG5cdGZvciAoY29uc3QgcmUgb2YgcnVsZXMpIHtcblx0XHRpZiAocmUudGVzdChtc2cpKSByZXR1cm4gdHJ1ZTtcblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8vIFJldXNlZCBhY3Jvc3Mgd2FybSBpbnZvY2F0aW9ucyBzbyB3ZSBkb24ndCBwYXkgVENQL1RMUyBzZXR1cCBwZXIgYmF0Y2guXG5jb25zdCBodHRwQWdlbnQgPSBuZXcgaHR0cC5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSwgbWF4U29ja2V0czogMTYgfSk7XG5jb25zdCBodHRwc0FnZW50ID0gbmV3IGh0dHBzLkFnZW50KHsga2VlcEFsaXZlOiB0cnVlLCBtYXhTb2NrZXRzOiAxNiB9KTtcblxuaW50ZXJmYWNlIENsb3VkV2F0Y2hMb2dzRXZlbnQge1xuXHRhd3Nsb2dzOiB7IGRhdGE6IHN0cmluZyB9O1xufVxuXG5pbnRlcmZhY2UgRGVjb2RlZFBheWxvYWQge1xuXHRtZXNzYWdlVHlwZTogc3RyaW5nO1xuXHRsb2dHcm91cDogc3RyaW5nO1xuXHRsb2dTdHJlYW06IHN0cmluZztcblx0bG9nRXZlbnRzOiBBcnJheTx7IGlkOiBzdHJpbmc7IHRpbWVzdGFtcDogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfT47XG59XG5cbi8vIExhbWJkYSBwbGF0Zm9ybSBsaW5lcyB0aGF0IGFyZSBwdXJlIG5vaXNlLiBSRVBPUlQgaXMga2VwdCBieSBkZWZhdWx0IChjYXJyaWVzIGR1cmF0aW9uL21lbW9yeSk7XG4vLyBzZXQgRk9SV0FSREVSX0RST1BfUkVQT1JUPXRydWUgdG8gZHJvcCBpdCB0b28uXG5jb25zdCBEUk9QX1JFUE9SVCA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9EUk9QX1JFUE9SVD8udHJpbSgpID09PSAndHJ1ZSc7XG5mdW5jdGlvbiBpc1BsYXRmb3JtTm9pc2UocmF3OiBzdHJpbmcpOiBib29sZWFuIHtcblx0aWYgKHJhdy5zdGFydHNXaXRoKCdTVEFSVCBSZXF1ZXN0SWQnKSB8fCByYXcuc3RhcnRzV2l0aCgnRU5EIFJlcXVlc3RJZCcpIHx8IHJhdy5zdGFydHNXaXRoKCdJTklUX1NUQVJUJykpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXHRpZiAoRFJPUF9SRVBPUlQgJiYgcmF3LnN0YXJ0c1dpdGgoJ1JFUE9SVCBSZXF1ZXN0SWQnKSkge1xuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLy8gZncyNCdzIHRzbG9nIGNvbG9yaXplcyBvdXRwdXQgd2l0aCBBTlNJIFNHUiBjb2RlcyAoZS5nLiBFU0NbMzJtIOKApiBFU0NbMzltKSB3aGljaCBvdGhlcndpc2Ugc2hpcCBhc1xuLy8gbGl0ZXJhbCBgWzMybWAgbm9pc2UgaW4gTG9ndHJhaWwuIFN0cmlwIGFsbCBBTlNJIGVzY2FwZSBzZXF1ZW5jZXMgZnJvbSBzaGlwcGVkIHRleHQuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29udHJvbC1yZWdleFxuY29uc3QgQU5TSV9SRSA9IC9cXHgxYlxcW1swLTk7XSpbQS1aYS16XS9nO1xuZnVuY3Rpb24gc3RyaXBBbnNpKHM6IHN0cmluZyk6IHN0cmluZyB7XG5cdHJldHVybiBzLmluY2x1ZGVzKCdcXHgxYicpID8gcy5yZXBsYWNlKEFOU0lfUkUsICcnKSA6IHM7XG59XG5cbi8vIExhbWJkYSBwbGF0Zm9ybS9ydW50aW1lIGZhaWx1cmVzIHRoYXQgY3Jhc2ggb3Iga2lsbCB0aGUgaW52b2NhdGlvbiBvdXRyaWdodCDigJQgYSB0aW1lb3V0LCBhbiBPT01cbi8vIGtpbGwsIG9yIHRoZSBydW50aW1lIGV4aXRpbmcgZWFybHkuIE5vbmUgb2YgdGhlc2UgY2FycnkgYW4gRVJST1IvRkFUQUwvV0FSTiB0b2tlbiBvZiB0aGVpciBvd24sIHNvXG4vLyB3aXRob3V0IHRoaXMgdGhleSdkIGZhbGwgdGhyb3VnaCB0byB0aGUgYGluZm9gIGRlZmF1bHQgYW5kIGJlIGludmlzaWJsZSB0byBlcnJvci1zaWduYXR1cmUgc2Nhbm5pbmcuXG5jb25zdCBMQU1CREFfQ1JBU0hfUkUgPSAvdGFzayB0aW1lZCBvdXQgYWZ0ZXJ8cHJvY2VzcyBleGl0ZWQgYmVmb3JlIGNvbXBsZXRpbmcgcmVxdWVzdHxydW50aW1lIGV4aXRlZCB3aXRoIGVycm9yfHJ1bnRpbWVcXC4oPzpleGl0ZXJyb3J8b3V0b2ZtZW1vcnkpfG91dCBvZiBtZW1vcnl8c2lnbmFsOlxccypraWxsZWQvaTtcblxuZnVuY3Rpb24gZmFsbGJhY2tMZXZlbChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG5cdGlmICgvXFxiKD86RVJST1J8RkFUQUwpXFxiLy50ZXN0KHJhdykpIHJldHVybiAnZXJyb3InO1xuXHRpZiAoTEFNQkRBX0NSQVNIX1JFLnRlc3QocmF3KSkgcmV0dXJuICdlcnJvcic7XG5cdGlmICgvXFxiV0FSTig/OklORyk/XFxiLy50ZXN0KHJhdykpIHJldHVybiAnd2Fybic7XG5cdHJldHVybiAnaW5mbyc7XG59XG5cbmNvbnN0IEtOT1dOX0xFVkVMUyA9IG5ldyBTZXQoWyAndHJhY2UnLCAnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ3dhcm5pbmcnLCAnZXJyb3InLCAnZmF0YWwnIF0pO1xuY29uc3QgSVNPX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfS87XG5cbi8vIHRzbG9nJ3MgXCJwcmV0dHlcIiAobm9uLUpTT04pIGNvbnNvbGUgZm9ybWF0OiBgWVlZWS1NTS1ERCBISDpNTTpTUy5tbW0gTEVWRUwgcmVzdOKApmAuIFRoZSBkYXRlICsgbGV2ZWxcbi8vIGl0IHByaW50cyBkdXBsaWNhdGUgd2hhdCBMb2d0cmFpbCBhbHJlYWR5IHNob3dzIGluIHRoZSBkZWRpY2F0ZWQgVElNRS9MVkwgY29sdW1ucyDigJQgcGVlbCB0aGVtIG9mZlxuLy8gdGhlIG1lc3NhZ2UgbGlrZSB0aGUgTGFtYmRhLXByZWZpeCAvIHRzbG9nLUpTT04gYnJhbmNoZXMgYWxyZWFkeSBkbyBmb3IgdGhlaXIgb3duIHNoYXBlcy5cbmNvbnN0IFBSRVRUWV9UU0xPR19SRSA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0gXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31cXHMrKFRSQUNFfERFQlVHfElORk98V0FSTig/OklORyk/fEVSUk9SfEZBVEFMKVxccysoLiopJC87XG5cbi8qKiBQZWVsIGEgdHNsb2cgXCJwcmV0dHlcIiBg4oC5ZGF0ZeKAuiDigLl0aW1l4oC6IExFVkVMIOKAuXJlc3TigLpgIHByZWZpeCwgaWYgdGhlIGxpbmUgbWF0Y2hlcy4gKi9cbmZ1bmN0aW9uIHBhcnNlUHJldHR5VHNsb2dQcmVmaXgocmF3OiBzdHJpbmcpOiB7IGxldmVsOiBzdHJpbmc7IG1lc3NhZ2U6IHN0cmluZyB9IHwgbnVsbCB7XG5cdGNvbnN0IG0gPSByYXcubWF0Y2goUFJFVFRZX1RTTE9HX1JFKTtcblx0aWYgKCFtKSByZXR1cm4gbnVsbDtcblx0Y29uc3QgWyAsIGx2bCwgcmVzdCBdID0gbTtcblx0Y29uc3QgbGV2ZWwgPSBsdmwudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKCd3YXJuJykgPyAnd2FybicgOiBsdmwudG9Mb3dlckNhc2UoKTtcblx0cmV0dXJuIHsgbGV2ZWwsIG1lc3NhZ2U6IHJlc3QgfTtcbn1cblxuLyoqXG4gKiBBV1MgTGFtYmRhIGVtaXRzIHRleHQgbG9ncyBhcyBg4oC5aXNv4oC6XFx04oC5cmVxdWVzdElk4oC6XFx04oC5TEVWRUzigLpcXHTigLltZXNzYWdl4oC6YC4gUGVlbCB0aGF0IHByZWZpeCBvZmYgc28gdGhlXG4gKiBtZXNzYWdlIGlzIGp1c3QgdGhlIHRleHQsIGFuZCBsaWZ0IHJlcXVlc3RJZC9sZXZlbCBvdXQgYXMgZmllbGRzICh0aGV5J3JlIGFscmVhZHkgc2hvd24gYXMgY29sdW1ucykuXG4gKiBSZXR1cm5zIG51bGwgaWYgdGhlIGxpbmUgaXNuJ3QgaW4gdGhhdCBmb3JtYXQuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlTGFtYmRhUHJlZml4KHJhdzogc3RyaW5nKTogeyByZXF1ZXN0SWQ6IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgbWVzc2FnZTogc3RyaW5nIH0gfCBudWxsIHtcblx0Y29uc3QgcGFydHMgPSByYXcuc3BsaXQoJ1xcdCcpO1xuXHRpZiAocGFydHMubGVuZ3RoIDwgNCkgcmV0dXJuIG51bGw7XG5cdGNvbnN0IFsgdHMsIHJlcXVlc3RJZCwgbHZsLCAuLi5yZXN0IF0gPSBwYXJ0cztcblx0aWYgKCFJU09fUkUudGVzdCh0cykgfHwgIUtOT1dOX0xFVkVMUy5oYXMobHZsLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgcmV0dXJuIG51bGw7XG5cdHJldHVybiB7IHJlcXVlc3RJZCwgbGV2ZWw6IGx2bC50cmltKCkudG9Mb3dlckNhc2UoKSwgbWVzc2FnZTogcmVzdC5qb2luKCdcXHQnKS50cmltKCkgfTtcbn1cblxuLyoqXG4gKiBUdXJuIGEgdmVyYm9zZSBDbG91ZFdhdGNoIGxvZy1ncm91cCAvIGxvZy1zdHJlYW0gaW50byBhIHNob3J0IGZ1bmN0aW9uIG5hbWUgZm9yIHRoZSBgaG9zdGAgbGFiZWwsXG4gKiBlLmcuIGDigKYtcGx1c2ZhbnRyaWFsc3N0cmVhbXByb2Nlc3NvcuKApkxvZ0dyb3Vw4oCmYCDihpIgYHBsdXNmYW50cmlhbHNzdHJlYW1wcm9jZXNzb3JgLiBGYWxscyBiYWNrIHRvIHRoZVxuICogcmF3IGxvZyBncm91cC4gVGhlIGZ1bGwgbG9nIGdyb3VwIGlzIHN0aWxsIGVtaXR0ZWQgc2VwYXJhdGVseSBhcyBgbG9nR3JvdXBgLlxuICovXG5mdW5jdGlvbiBzaG9ydEhvc3QobG9nR3JvdXA6IHN0cmluZywgbG9nU3RyZWFtOiBzdHJpbmcpOiBzdHJpbmcge1xuXHQvLyBMYW1iZGEgbG9nIHN0cmVhbTogXCJZWVlZL01NL0RELzxmdW5jdGlvbk5hbWU+WyRMQVRFU1RdPGlkPlwiIOKAlCB0aGUgY2xlYW5lc3Qgc291cmNlIG9mIHRoZSBmbiBuYW1lLlxuXHRjb25zdCBzbSA9IGxvZ1N0cmVhbS5tYXRjaCgvXlxcZHs0fVxcL1xcZHsyfVxcL1xcZHsyfVxcLyguKz8pXFxbXFwkTEFURVNUXFxdLyk7XG5cdGlmIChzbSAmJiBzbVsxXSkge1xuXHRcdHJldHVybiBzbVsxXS5yZXBsYWNlKC8tW0EtWmEtejAtOV17Nix9JC8sICcnKTsgLy8gZHJvcCB0aGUgQ2xvdWRGb3JtYXRpb24gcmFuZG9tIHN1ZmZpeFxuXHR9XG5cdC8vIEZhbGxiYWNrOiBwYXJzZSB0aGUgbG9nIGdyb3VwIOKAlCBzdHJpcCB0aGUgYOKApkxvZ0dyb3VwPGhhc2g+LTxzdWZmaXg+YCB0YWlsLCB0YWtlIHRoZSBsYXN0IHNlZ21lbnQsXG5cdC8vIGFuZCBkZS1kdXBsaWNhdGUgQ0RLJ3MgZG91YmxlZCBjb25zdHJ1Y3QgbmFtZSAoYGZvb0JhcmZvb0JhcmAg4oaSIGBmb29CYXJgKS5cblx0bGV0IHMgPSBsb2dHcm91cDtcblx0Y29uc3QgbGcgPSBzLmluZGV4T2YoJ0xvZ0dyb3VwJyk7XG5cdGlmIChsZyA+IDApIHMgPSBzLnNsaWNlKDAsIGxnKTtcblx0Y29uc3QgbSA9IHMubWF0Y2goLyg/OnN0YWNrLXxOZXN0ZWRTdGFja1Jlc291cmNlWzAtOUEtRmEtZl0qLSkoW14tXSspJC8pO1xuXHRpZiAobSkgcyA9IG1bMV07XG5cdGlmIChzLmxlbmd0aCA+IDAgJiYgcy5sZW5ndGggJSAyID09PSAwKSB7XG5cdFx0Y29uc3QgaGFsZiA9IHMubGVuZ3RoIC8gMjtcblx0XHRpZiAocy5zbGljZSgwLCBoYWxmKSA9PT0gcy5zbGljZShoYWxmKSkgcyA9IHMuc2xpY2UoMCwgaGFsZik7XG5cdH1cblx0cmV0dXJuIHMgfHwgbG9nR3JvdXA7XG59XG5cbi8qKlxuICogUmVzaGFwZSBvbmUgQ2xvdWRXYXRjaCBsb2cgZXZlbnQgaW50byBhIGNsZWFuIFZlY3RvciByZWNvcmQsIHRoZW4gYXBwbHkgdGhlIGFwcC1sZXZlbCBub2lzZS9zZXZlcml0eVxuICogcnVsZXMuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGV2ZW50IHNob3VsZCBiZSBkcm9wcGVkIChwbGF0Zm9ybSBub2lzZSBvciBhIFwiZHJvcFwiIHJ1bGUgbWF0Y2gpLlxuICpcbiAqIGZ3MjQgbG9ncyBhcmUgdHNsb2cgSlNPTiBsaWtlIGB7XCIwXCI6XCJ0aGUgbWVzc2FnZVwiLFwiMVwiOnsuLi5hcmd9LFwiX21ldGFcIjp7XCJuYW1lXCI6XCJBUElDb25zdHJ1Y3RcIixcbiAqIFwibG9nTGV2ZWxOYW1lXCI6XCJJTkZPXCIsXCJkYXRlXCI6XCIuLi5cIn19YC4gV2UgbGlmdCB0aGUgcmVhbCBtZXNzYWdlIG91dCBvZiB0aGUgcG9zaXRpb25hbCBrZXlzIGFuZCB0aGVcbiAqIGNvbXBvbmVudC9sZXZlbC90aW1lIG91dCBvZiBgX21ldGFgLCBzbyBMb2d0cmFpbCBzaG93cyByZWFkYWJsZSBsaW5lcyBpbnN0ZWFkIG9mIGEgcmF3IEpTT04gYmxvYi5cbiAqIE5vbi1KU09OIGxpbmVzIChMYW1iZGEgU1RBUlQvRU5EL1JFUE9SVCwgcGxhaW4gdGV4dCkgcGFzcyB0aHJvdWdoIHVuY2hhbmdlZC5cbiAqL1xuZnVuY3Rpb24gdG9WZWN0b3JSZWNvcmQoXG5cdGU6IHsgdGltZXN0YW1wOiBudW1iZXI7IG1lc3NhZ2U6IHN0cmluZyB9LFxuXHRsb2dHcm91cDogc3RyaW5nLFxuXHRsb2dTdHJlYW06IHN0cmluZyxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB7XG5cdGNvbnN0IHJhdyA9IChlLm1lc3NhZ2UgPz8gJycpLnJlcGxhY2UoL1xccyskLywgJycpO1xuXG5cdC8vIOKUgOKUgCAxKSBEUk9QOiBMYW1iZGEgcGxhdGZvcm0gbGluZXMgdGhhdCBhcmUgcHVyZSBub2lzZS4g4pSA4pSAXG5cdGlmIChpc1BsYXRmb3JtTm9pc2UocmF3LnRyaW1TdGFydCgpKSkge1xuXHRcdHJldHVybiBudWxsO1xuXHR9XG5cblx0bGV0IG1lc3NhZ2UgPSByYXc7XG5cdGxldCBsZXZlbDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgbG9nZ2VyOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCByZXF1ZXN0SWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGNvcnJlbGF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGNhdXNlZEJ5OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBhY3RvcklkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCB0c0lzbzogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgbGlmdGVkOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkO1xuXHRsZXQgY29kZUxvYzogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG5cdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IHBlZWwgQVdTIExhbWJkYSdzIGDigLlpc2/igLpcXHTigLlyZXF1ZXN0SWTigLpcXHTigLlMRVZFTOKAulxcdOKAuW1lc3NhZ2XigLpgIHRleHQgcHJlZml4LCBpZiBwcmVzZW50LlxuXHRjb25zdCBsYW1iZGEgPSBwYXJzZUxhbWJkYVByZWZpeChyYXcpO1xuXHRpZiAobGFtYmRhKSB7XG5cdFx0cmVxdWVzdElkID0gbGFtYmRhLnJlcXVlc3RJZDtcblx0XHRsZXZlbCA9IGxhbWJkYS5sZXZlbDtcblx0XHRtZXNzYWdlID0gbGFtYmRhLm1lc3NhZ2U7XG5cdH1cblxuXHQvLyDilIDilIAgMSkgTk9STUFMSVpFOiBpZiB0aGUgcmVtYWluaW5nIG1lc3NhZ2UgaXMgZncyNCB0c2xvZyBKU09OLCBsaWZ0IHRoZSByZWFsIHRleHQgKyBjb21wb25lbnQvbGV2ZWwvdGltZS5cblx0Y29uc3QgYm9keSA9IG1lc3NhZ2U7XG5cdGlmIChib2R5LmNoYXJDb2RlQXQoMCkgPT09IDB4N2IgLyogeyAqLykge1xuXHRcdHRyeSB7XG5cdFx0XHRjb25zdCBvID0gSlNPTi5wYXJzZShib2R5KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblx0XHRcdGNvbnN0IG1ldGEgPSBvLl9tZXRhIGFzIHtcblx0XHRcdFx0bmFtZT86IHVua25vd247IGxvZ0xldmVsTmFtZT86IHVua25vd247IGRhdGU/OiB1bmtub3duOyBjb3JyZWxhdGlvbklkPzogdW5rbm93bjsgY2F1c2VkQnk/OiB1bmtub3duOyBhY3RvcklkPzogdW5rbm93bjtcblx0XHRcdFx0cGF0aD86IHsgZmlsZVBhdGhXaXRoTGluZT86IHVua25vd247IGZpbGVOYW1lPzogdW5rbm93bjsgZmlsZUxpbmU/OiB1bmtub3duIH07XG5cdFx0XHR9IHwgdW5kZWZpbmVkO1xuXHRcdFx0aWYgKG1ldGEgJiYgdHlwZW9mIG1ldGEgPT09ICdvYmplY3QnKSB7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5uYW1lID09PSAnc3RyaW5nJykgbG9nZ2VyID0gbWV0YS5uYW1lO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEubG9nTGV2ZWxOYW1lID09PSAnc3RyaW5nJykgbGV2ZWwgPSBtZXRhLmxvZ0xldmVsTmFtZS50b0xvd2VyQ2FzZSgpO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuZGF0ZSA9PT0gJ3N0cmluZycgJiYgIU51bWJlci5pc05hTihEYXRlLnBhcnNlKG1ldGEuZGF0ZSkpKSB7XG5cdFx0XHRcdFx0dHNJc28gPSBuZXcgRGF0ZShtZXRhLmRhdGUpLnRvSVNPU3RyaW5nKCk7XG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIG1ldGEuY29ycmVsYXRpb25JZC50cmltKCkpIGNvcnJlbGF0aW9uSWQgPSBtZXRhLmNvcnJlbGF0aW9uSWQudHJpbSgpO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuY2F1c2VkQnkgPT09ICdzdHJpbmcnICYmIG1ldGEuY2F1c2VkQnkudHJpbSgpKSBjYXVzZWRCeSA9IG1ldGEuY2F1c2VkQnkudHJpbSgpO1xuXHRcdFx0XHRpZiAodHlwZW9mIG1ldGEuYWN0b3JJZCA9PT0gJ3N0cmluZycgJiYgbWV0YS5hY3RvcklkLnRyaW0oKSkgYWN0b3JJZCA9IG1ldGEuYWN0b3JJZC50cmltKCk7XG5cdFx0XHRcdC8vIHRzbG9nIG5hdGl2ZSBzb3VyY2UgcG9zaXRpb24gKG1vZGUgJ2FsbCcpOiBfbWV0YS5wYXRoLlxuXHRcdFx0XHRjb25zdCBwID0gbWV0YS5wYXRoO1xuXHRcdFx0XHRpZiAocCAmJiB0eXBlb2YgcCA9PT0gJ29iamVjdCcpIHtcblx0XHRcdFx0XHRpZiAodHlwZW9mIHAuZmlsZVBhdGhXaXRoTGluZSA9PT0gJ3N0cmluZycpIGNvZGVMb2MgPSBwLmZpbGVQYXRoV2l0aExpbmU7XG5cdFx0XHRcdFx0ZWxzZSBpZiAodHlwZW9mIHAuZmlsZU5hbWUgPT09ICdzdHJpbmcnICYmIHAuZmlsZUxpbmUgIT0gbnVsbCkgY29kZUxvYyA9IGAke3AuZmlsZU5hbWV9OiR7cC5maWxlTGluZX1gO1xuXHRcdFx0XHR9XG5cdFx0XHR9IGVsc2UgaWYgKHR5cGVvZiBvLmVycm9yVHlwZSA9PT0gJ3N0cmluZycgJiYgdHlwZW9mIG8uZXJyb3JNZXNzYWdlID09PSAnc3RyaW5nJykge1xuXHRcdFx0XHQvLyBMYW1iZGEncyBvd24gaW52b2NhdGlvbi1lcnJvciBlbnZlbG9wZSAoY3Jhc2gvdGltZW91dC9PT00gcmVwb3J0ZWQgYnkgdGhlIHBsYXRmb3JtLCBub3Rcblx0XHRcdFx0Ly8gYnkgYXBwIGNvZGUpIOKAlCBubyBgX21ldGFgLCBzbyBpdCdkIG90aGVyd2lzZSBmYWxsIHRocm91Z2ggdG8gdGhlIGBpbmZvYCBkZWZhdWx0LlxuXHRcdFx0XHRsZXZlbCA9ICdlcnJvcic7XG5cdFx0XHR9XG5cdFx0XHQvLyBMaWZ0IGFwcC1kZWNsYXJlZCBzdHJ1Y3R1cmVkIGZpZWxkcyAoY29ycmVsYXRpb25JZCwgb3JkZXJJZCwg4oCmKSBGSVJTVCwgc28gdGhvc2Uga2V5cyBjYW4gYmVcblx0XHRcdC8vIGtlcHQgT1VUIG9mIHRoZSBodW1hbiBtZXNzYWdlIGJlbG93IChubyBkdXBsaWNhdGluZyBhIGxpZnRlZCBpZCBpbiBib3RoIHRoZSBmaWVsZCBhbmQgdGhlIHRleHQpLlxuXHRcdFx0aWYgKEhBU19MSUZUX0ZJRUxEUykge1xuXHRcdFx0XHRjb25zdCBmID0gZXh0cmFjdExpZnRlZEZpZWxkcyhvKTtcblx0XHRcdFx0aWYgKE9iamVjdC5rZXlzKGYpLmxlbmd0aCA+IDApIGxpZnRlZCA9IGY7XG5cdFx0XHR9XG5cdFx0XHRjb25zdCBsaWZ0ZWRLZXlzID0gbGlmdGVkID8gbmV3IFNldChPYmplY3Qua2V5cyhsaWZ0ZWQpKSA6IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG5cdFx0XHQvLyBQb3NpdGlvbmFsIGFyZ3MgXCIwXCIuLlwiblwiIGhvbGQgdGhlIGxvZ2dlZCBtZXNzYWdlICsgcGFyYW1zLiBCdWlsZCB0aGUgaHVtYW4gbWVzc2FnZSBmcm9tIHRoZVxuXHRcdFx0Ly8gc3RyaW5nIGFyZ3MgcGx1cyB0aGUgTk9OLWxpZnRlZCBrZXlzIG9mIG9iamVjdCBhcmdzIChsaWZ0ZWQgaWRzIGJlY29tZSBmaWVsZHMsIG5vdCBtZXNzYWdlXG5cdFx0XHQvLyBub2lzZSkuIEEgYHsgX3NyY2xvYyB9YCBhcmcgY2FycmllcyB0aGUgY2FsbGVyJ3Mgc291cmNlIHBvc2l0aW9uIOKAlCBsaWZ0ZWQsIGtlcHQgb3V0IG9mIHRoZSB0ZXh0LlxuXHRcdFx0Y29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG5cdFx0XHRmb3IgKGxldCBpID0gMDsgT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIFN0cmluZyhpKSk7IGkrKykge1xuXHRcdFx0XHRjb25zdCB2ID0gb1tTdHJpbmcoaSldO1xuXHRcdFx0XHRpZiAodHlwZW9mIHYgPT09ICdzdHJpbmcnKSB7IHBhcnRzLnB1c2godik7IGNvbnRpbnVlOyB9XG5cdFx0XHRcdGlmICh2ICYmIHR5cGVvZiB2ID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2KSkge1xuXHRcdFx0XHRcdGNvbnN0IG9iaiA9IHYgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cdFx0XHRcdFx0aWYgKHR5cGVvZiBvYmouX3NyY2xvYyA9PT0gJ3N0cmluZycpIHsgaWYgKCFjb2RlTG9jKSBjb2RlTG9jID0gb2JqLl9zcmNsb2MgYXMgc3RyaW5nOyBjb250aW51ZTsgfVxuXHRcdFx0XHRcdGNvbnN0IHJlc3Q6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG5cdFx0XHRcdFx0Zm9yIChjb25zdCBbIGssIHZhbCBdIG9mIE9iamVjdC5lbnRyaWVzKG9iaikpIGlmICghbGlmdGVkS2V5cy5oYXMoaykpIHJlc3RbIGsgXSA9IHZhbDtcblx0XHRcdFx0XHRpZiAoT2JqZWN0LmtleXMocmVzdCkubGVuZ3RoID4gMCkgcGFydHMucHVzaChKU09OLnN0cmluZ2lmeShyZXN0KSk7XG5cdFx0XHRcdFx0Y29udGludWU7XG5cdFx0XHRcdH1cblx0XHRcdFx0cGFydHMucHVzaChKU09OLnN0cmluZ2lmeSh2KSk7XG5cdFx0XHR9XG5cdFx0XHRpZiAocGFydHMubGVuZ3RoID4gMCkgbWVzc2FnZSA9IHBhcnRzLmpvaW4oJyAnKTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vIG5vdCBKU09OIGFmdGVyIGFsbCDigJQga2VlcCB0aGUgKHByZWZpeC1zdHJpcHBlZCkgbWVzc2FnZVxuXHRcdH1cblx0fSBlbHNlIHtcblx0XHQvLyDilIDilIAgMSkgTk9STUFMSVpFOiB0c2xvZydzIFwicHJldHR5XCIgKG5vbi1KU09OKSBjb25zb2xlIGZvcm1hdCDigJQgc3RyaXAgaXRzIG93biBkdXBsaWNhdGUgZGF0ZStsZXZlbC5cblx0XHRjb25zdCBwcmV0dHkgPSBwYXJzZVByZXR0eVRzbG9nUHJlZml4KGJvZHkpO1xuXHRcdGlmIChwcmV0dHkpIHtcblx0XHRcdGlmICghbGV2ZWwpIGxldmVsID0gcHJldHR5LmxldmVsO1xuXHRcdFx0bWVzc2FnZSA9IHByZXR0eS5tZXNzYWdlO1xuXHRcdH1cblx0fVxuXG5cdGNvbnN0IGNsZWFuTWVzc2FnZSA9IHN0cmlwQW5zaShtZXNzYWdlKTtcblx0bGV0IHJlc29sdmVkTGV2ZWwgPSBsZXZlbCA/PyBmYWxsYmFja0xldmVsKHJhdyk7XG5cdGxldCByZWNsYXNzaWZpZWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuXHQvLyBTcGxpdCB0aGUgY2FwdHVyZWQgc291cmNlIHBvc2l0aW9uIGludG8gcXVlcnlhYmxlIGBjb2RlRmlsZWAgKyBgY29kZUxpbmVgIChmb3IgXCJvcGVuIHRoZSBleGFjdFxuXHQvLyBjdWxwcml0IGxpbmVcIiBsaW5rcykuIFBhdGggaXMgbWFkZSByZXBvLXJlbGF0aXZlIChrZXB0IGZyb20gaXRzIGxhc3QgYHNyYy9gIHNlZ21lbnQpLlxuXHRsZXQgY29kZUZpbGU6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGNvZGVMaW5lOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGlmIChjb2RlTG9jKSB7XG5cdFx0Y29uc3QgbSA9IGNvZGVMb2MubWF0Y2goL14oLio/KTooXFxkKykoPzo6XFxkKyk/JC8pO1xuXHRcdGlmIChtKSB7XG5cdFx0XHQvLyBBYnNvbHV0ZSBwYXRoICjigKYvc3JjL+KApikg4oaSIG1ha2UgcmVwby1yZWxhdGl2ZSBmcm9tIHRoZSBsYXN0IGBzcmMvYC4gQWxyZWFkeS1yZWxhdGl2ZSBwYXRoc1xuXHRcdFx0Ly8gKHRoZSBsb2dnaW5nIGxheWVyIGVtaXRzIGBzcmMv4oCmYCkgYXJlIGtlcHQgYXMtaXMuXG5cdFx0XHRjb25zdCBzcmNJZHggPSBtWzFdLmxhc3RJbmRleE9mKCcvc3JjLycpO1xuXHRcdFx0Y29kZUZpbGUgPSBzcmNJZHggPj0gMCA/IG1bMV0uc2xpY2Uoc3JjSWR4ICsgMSkgOiBtWzFdO1xuXHRcdFx0Y29kZUxpbmUgPSBtWzJdO1xuXHRcdH1cblx0fVxuXG5cdC8vIOKUgOKUgCBMYXllcnMgMuKAkzQ6IGFwcC1sZXZlbCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzLCBhcHBsaWVkIHRvIHRoZSBub3JtYWxpemVkIG1lc3NhZ2UuIOKUgOKUgFxuXHRpZiAoSEFTX05PSVNFX1JVTEVTKSB7XG5cdFx0Ly8gMikgUkVDTEFTU0lGWTogYmVuaWduIFwiZXJyb3JzXCIg4oaSIHdhcm4gKG9ubHkgZG93bmdyYWRlLCBuZXZlciB1cGdyYWRlKS5cblx0XHRpZiAoRVJST1JJU0guaGFzKHJlc29sdmVkTGV2ZWwpICYmIGFueU1hdGNoKEJFTklHTl9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmVzb2x2ZWRMZXZlbCA9ICd3YXJuJztcblx0XHRcdHJlY2xhc3NpZmllZCA9ICdiZW5pZ24nO1xuXHRcdH1cblx0XHQvLyAzKSBEUk9QOiBub2lzZSByZW1vdmVkIGVudGlyZWx5IChuZXZlciBzaGlwcGVkIOKAlCBzYXZlcyBpbmdlc3QgYmFuZHdpZHRoIGF0IHRoZSBzb3VyY2UpLlxuXHRcdGlmIChhbnlNYXRjaChEUk9QX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXR1cm4gbnVsbDtcblx0XHR9XG5cdFx0Ly8gNCkgRE9XTkdSQURFOiBub2lzZSBrZXB0IGJ1dCBkZS1lbXBoYXNpc2VkIHRvIGRlYnVnLlxuXHRcdGlmIChhbnlNYXRjaChET1dOR1JBREVfUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJlc29sdmVkTGV2ZWwgPSAnZGVidWcnO1xuXHRcdFx0cmVjbGFzc2lmaWVkID0gJ25vaXNlJztcblx0XHR9XG5cdH1cblxuXHRjb25zdCByZWM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuXHRcdHNlcnZpY2U6IFNFUlZJQ0UsXG5cdFx0ZW52OiBFTlYsXG5cdFx0Li4uKFJFU09MVkVEX0FDQ09VTlQgPyB7IGFjY291bnQ6IFJFU09MVkVEX0FDQ09VTlQgfSA6IHt9KSxcblx0XHQuLi4oUkVHSU9OID8geyByZWdpb246IFJFR0lPTiB9IDoge30pLFxuXHRcdC4uLihWRVJTSU9OID8geyB2ZXJzaW9uOiBWRVJTSU9OIH0gOiB7fSksXG5cdFx0aG9zdDogc2hvcnRIb3N0KGxvZ0dyb3VwLCBsb2dTdHJlYW0pLFxuXHRcdC4uLihsb2dnZXIgPyB7IGxvZ2dlciB9IDoge30pLFxuXHRcdC4uLihyZXF1ZXN0SWQgPyB7IHJlcXVlc3RJZCB9IDoge30pLFxuXHRcdC4uLihsaWZ0ZWQgPz8ge30pLFxuXHRcdC4uLihjb3JyZWxhdGlvbklkID8geyBjb3JyZWxhdGlvbklkIH0gOiB7fSksXG5cdFx0Li4uKGNhdXNlZEJ5ID8geyBjYXVzZWRCeSB9IDoge30pLFxuXHRcdC4uLihhY3RvcklkID8geyBhY3RvcklkIH0gOiB7fSksXG5cdFx0Li4uKGNvZGVGaWxlID8geyBjb2RlRmlsZSB9IDoge30pLFxuXHRcdC4uLihjb2RlTGluZSA/IHsgY29kZUxpbmUgfSA6IHt9KSxcblx0XHRsZXZlbDogcmVzb2x2ZWRMZXZlbCxcblx0XHQuLi4ocmVjbGFzc2lmaWVkID8geyByZWNsYXNzaWZpZWQgfSA6IHt9KSxcblx0XHRtZXNzYWdlOiBjbGVhbk1lc3NhZ2UsXG5cdFx0dGltZXN0YW1wOiB0c0lzbyA/PyBuZXcgRGF0ZShlLnRpbWVzdGFtcCkudG9JU09TdHJpbmcoKSxcblx0XHRsb2dHcm91cCxcblx0XHRsb2dTdHJlYW0sXG5cdH07XG5cdC8vIERyb3AgbG93LXZhbHVlIGZpZWxkcyAoRk9SV0FSREVSX0RST1BfRklFTERTKSB0byBjdXQgaW5nZXN0L3N0b3JhZ2Ugc2l6ZS4gYGhvc3RgIChkZXJpdmVkIGZyb21cblx0Ly8gbG9nR3JvdXAvbG9nU3RyZWFtKSBpcyBrZXB0LCBzbyBkcm9wcGluZyB0aGUgcmF3IGdyb3VwL3N0cmVhbSBsb3NlcyBub3RoaW5nIGFjdGlvbmFibGUuXG5cdGlmIChEUk9QX1NFVC5zaXplKSBmb3IgKGNvbnN0IGsgb2YgRFJPUF9TRVQpIGRlbGV0ZSByZWNba107XG5cdHJldHVybiByZWM7XG59XG5cbi8qKiBTcGxpdCBwcmUtc2VyaWFsaXplZCBsaW5lcyBpbnRvIHN1Yi1iYXRjaGVzIHVuZGVyIE1BWF9CQVRDSF9CWVRFUyAodW5jb21wcmVzc2VkKS4gKi9cbmZ1bmN0aW9uIGNodW5rTGluZXMobGluZXM6IHN0cmluZ1tdKTogc3RyaW5nW11bXSB7XG5cdGNvbnN0IGNodW5rczogc3RyaW5nW11bXSA9IFtdO1xuXHRsZXQgY3VycmVudDogc3RyaW5nW10gPSBbXTtcblx0bGV0IHNpemUgPSAwO1xuXHRmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcblx0XHRjb25zdCBsaW5lQnl0ZXMgPSBCdWZmZXIuYnl0ZUxlbmd0aChsaW5lKSArIDE7IC8vICsxIGZvciB0aGUgZGVsaW1pdGVyXG5cdFx0aWYgKGN1cnJlbnQubGVuZ3RoID4gMCAmJiBzaXplICsgbGluZUJ5dGVzID4gTUFYX0JBVENIX0JZVEVTKSB7XG5cdFx0XHRjaHVua3MucHVzaChjdXJyZW50KTtcblx0XHRcdGN1cnJlbnQgPSBbXTtcblx0XHRcdHNpemUgPSAwO1xuXHRcdH1cblx0XHRjdXJyZW50LnB1c2gobGluZSk7XG5cdFx0c2l6ZSArPSBsaW5lQnl0ZXM7XG5cdH1cblx0aWYgKGN1cnJlbnQubGVuZ3RoID4gMCkge1xuXHRcdGNodW5rcy5wdXNoKGN1cnJlbnQpO1xuXHR9XG5cdHJldHVybiBjaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuY29kZUJvZHkobGluZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcblx0Ly8gbGluZXMgYXJlIGFscmVhZHkgSlNPTiBzdHJpbmdzXG5cdHJldHVybiBCQVRDSF9GT1JNQVQgPT09ICdqc29uLWFycmF5JyA/IGBbJHtsaW5lcy5qb2luKCcsJyl9XWAgOiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuZnVuY3Rpb24gcG9zdChnemlwcGVkOiBCdWZmZXIpOiBQcm9taXNlPHZvaWQ+IHtcblx0cmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcblx0XHRjb25zdCB1cmwgPSBuZXcgVVJMKElOR0VTVF9VUkwhKTtcblx0XHRjb25zdCBpc0h0dHBzID0gdXJsLnByb3RvY29sID09PSAnaHR0cHM6Jztcblx0XHRjb25zdCBsaWIgPSBpc0h0dHBzID8gaHR0cHMgOiBodHRwO1xuXHRcdGNvbnN0IHJlcSA9IGxpYi5yZXF1ZXN0KFxuXHRcdFx0dXJsLFxuXHRcdFx0e1xuXHRcdFx0XHRtZXRob2Q6ICdQT1NUJyxcblx0XHRcdFx0YWdlbnQ6IGlzSHR0cHMgPyBodHRwc0FnZW50IDogaHR0cEFnZW50LFxuXHRcdFx0XHRoZWFkZXJzOiB7XG5cdFx0XHRcdFx0J0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcblx0XHRcdFx0XHQnQ29udGVudC1FbmNvZGluZyc6ICdnemlwJyxcblx0XHRcdFx0XHQnQ29udGVudC1MZW5ndGgnOiBnemlwcGVkLmxlbmd0aCxcblx0XHRcdFx0XHQuLi4oWF9BUElfS0VZID8geyAneC1hcGkta2V5JzogWF9BUElfS0VZIH0gOiB7fSksXG5cdFx0XHRcdH0sXG5cdFx0XHR9LFxuXHRcdFx0KHJlcykgPT4ge1xuXHRcdFx0XHRyZXMucmVzdW1lKCk7IC8vIGRyYWluIHNvIHRoZSBzb2NrZXQgY2FuIGJlIHJldXNlZFxuXHRcdFx0XHRjb25zdCBzdGF0dXMgPSByZXMuc3RhdHVzQ29kZSA/PyAwO1xuXHRcdFx0XHRpZiAoc3RhdHVzID49IDIwMCAmJiBzdGF0dXMgPCAzMDApIHtcblx0XHRcdFx0XHRyZXNvbHZlKCk7XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0cmVqZWN0KG5ldyBFcnJvcihgaW5nZXN0IHJlc3BvbmRlZCAke3N0YXR1c31gKSk7XG5cdFx0XHRcdH1cblx0XHRcdH0sXG5cdFx0KTtcblx0XHRyZXEub24oJ2Vycm9yJywgcmVqZWN0KTtcblx0XHRyZXEuc2V0VGltZW91dChQT1NUX1RJTUVPVVRfTVMsICgpID0+IHJlcS5kZXN0cm95KG5ldyBFcnJvcignaW5nZXN0IHRpbWVvdXQnKSkpO1xuXHRcdHJlcS5lbmQoZ3ppcHBlZCk7XG5cdH0pO1xufVxuXG4vKiogUE9TVCBvbmUgY2h1bmsgd2l0aCBhIHNpbmdsZSByZXRyeS4gUmV0dXJucyBmYWxzZSBpZiB0aGUgY2h1bmsgd2FzIGRyb3BwZWQgYWZ0ZXIgcmV0cmllcy4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNoaXBXaXRoUmV0cnkoZ3ppcHBlZDogQnVmZmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG5cdGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDw9IE1BWF9SRVRSSUVTOyBhdHRlbXB0KyspIHtcblx0XHR0cnkge1xuXHRcdFx0YXdhaXQgcG9zdChnemlwcGVkKTtcblx0XHRcdHJldHVybiB0cnVlO1xuXHRcdH0gY2F0Y2ggKGVycikge1xuXHRcdFx0aWYgKGF0dGVtcHQgPT09IE1BWF9SRVRSSUVTKSB7XG5cdFx0XHRcdC8vIFN3YWxsb3cgYWZ0ZXIgcmV0cmllczogYSBwZXJzaXN0ZW50IGluZ2VzdCBvdXRhZ2UgbXVzdCBub3QgY3JlYXRlIGEgQ2xvdWRXYXRjaCByZXRyeSBzdG9ybS5cblx0XHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdFx0Y29uc29sZS5lcnJvcignW2xvZy1mb3J3YXJkZXJdIHNoaXAgZmFpbGVkLCBkcm9wcGluZyBjaHVuazonLCAoZXJyIGFzIEVycm9yKS5tZXNzYWdlKTtcblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBFbWl0IGFuIGFsYXJtYWJsZSBDbG91ZFdhdGNoIG1ldHJpYyAoRU1GKSB3aGVuIHJlY29yZHMgYXJlIGRyb3BwZWQg4oCUIG5vIFNESywganVzdCBzdHJ1Y3R1cmVkIHN0ZG91dC4gKi9cbmZ1bmN0aW9uIGVtaXREcm9wcGVkTWV0cmljKHJlY29yZHM6IG51bWJlcik6IHZvaWQge1xuXHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRjb25zb2xlLmxvZyhcblx0XHRKU09OLnN0cmluZ2lmeSh7XG5cdFx0XHRfYXdzOiB7XG5cdFx0XHRcdFRpbWVzdGFtcDogRGF0ZS5ub3coKSxcblx0XHRcdFx0Q2xvdWRXYXRjaE1ldHJpY3M6IFtcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHROYW1lc3BhY2U6ICdMb2dGb3J3YXJkZXInLFxuXHRcdFx0XHRcdFx0RGltZW5zaW9uczogWyBbICdzZXJ2aWNlJyBdIF0sXG5cdFx0XHRcdFx0XHRNZXRyaWNzOiBbIHsgTmFtZTogJ0Ryb3BwZWRSZWNvcmRzJywgVW5pdDogJ0NvdW50JyB9IF0sXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XSxcblx0XHRcdH0sXG5cdFx0XHRzZXJ2aWNlOiBTRVJWSUNFLFxuXHRcdFx0RHJvcHBlZFJlY29yZHM6IHJlY29yZHMsXG5cdFx0fSksXG5cdCk7XG59XG5cbmludGVyZmFjZSBMYW1iZGFDb250ZXh0TGlrZSB7XG5cdGludm9rZWRGdW5jdGlvbkFybj86IHN0cmluZztcbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IENsb3VkV2F0Y2hMb2dzRXZlbnQsIGNvbnRleHQ/OiBMYW1iZGFDb250ZXh0TGlrZSk6IFByb21pc2U8dm9pZD4gPT4ge1xuXHQvLyBSZXNvbHZlIHRoZSBhY2NvdW50IGZyb20gdGhpcyBmb3J3YXJkZXIncyBvd24gQVJOIG9uY2UgKHNhbWUgZm9yIGV2ZXJ5IGludm9jYXRpb24pLlxuXHRpZiAoIVJFU09MVkVEX0FDQ09VTlQgJiYgY29udGV4dD8uaW52b2tlZEZ1bmN0aW9uQXJuKSB7XG5cdFx0UkVTT0xWRURfQUNDT1VOVCA9IGFjY291bnRGcm9tQXJuKGNvbnRleHQuaW52b2tlZEZ1bmN0aW9uQXJuKTtcblx0fVxuXHRpZiAoIUlOR0VTVF9VUkwpIHtcblx0XHRyZXR1cm47IC8vIG5vdCBjb25maWd1cmVkIHlldCDigJQgbm8tb3AgKHNhZmUgdG8gZGVwbG95IGJlZm9yZSB3aXJpbmcgdGhlIGluZ2VzdCBVUkwpXG5cdH1cblxuXHRsZXQgcGF5bG9hZDogRGVjb2RlZFBheWxvYWQ7XG5cdHRyeSB7XG5cdFx0cGF5bG9hZCA9IEpTT04ucGFyc2UoZ3VuemlwU3luYyhCdWZmZXIuZnJvbShldmVudC5hd3Nsb2dzLmRhdGEsICdiYXNlNjQnKSkudG9TdHJpbmcoJ3V0ZjgnKSkgYXMgRGVjb2RlZFBheWxvYWQ7XG5cdH0gY2F0Y2ggKGVycikge1xuXHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0Y29uc29sZS5lcnJvcignW2xvZy1mb3J3YXJkZXJdIGZhaWxlZCB0byBkZWNvZGUgcGF5bG9hZDonLCAoZXJyIGFzIEVycm9yKS5tZXNzYWdlKTtcblx0XHRyZXR1cm47XG5cdH1cblxuXHRpZiAocGF5bG9hZC5tZXNzYWdlVHlwZSA9PT0gJ0NPTlRST0xfTUVTU0FHRScpIHtcblx0XHRyZXR1cm47IC8vIHN1YnNjcmlwdGlvbiBsaXZlbmVzcyBwaW5nXG5cdH1cblx0Y29uc3QgZXZlbnRzID0gcGF5bG9hZC5sb2dFdmVudHM7XG5cdGlmICghQXJyYXkuaXNBcnJheShldmVudHMpIHx8IGV2ZW50cy5sZW5ndGggPT09IDApIHtcblx0XHRyZXR1cm47XG5cdH1cblxuXHRjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcblx0Zm9yIChjb25zdCBlIG9mIGV2ZW50cykge1xuXHRcdGNvbnN0IHJlY29yZCA9IHRvVmVjdG9yUmVjb3JkKGUsIHBheWxvYWQubG9nR3JvdXAsIHBheWxvYWQubG9nU3RyZWFtKTtcblx0XHRpZiAocmVjb3JkICE9PSBudWxsKSB7XG5cdFx0XHRsaW5lcy5wdXNoKEpTT04uc3RyaW5naWZ5KHJlY29yZCkpO1xuXHRcdH1cblx0fVxuXHRpZiAobGluZXMubGVuZ3RoID09PSAwKSB7XG5cdFx0cmV0dXJuOyAvLyB3aG9sZSBiYXRjaCB3YXMgbm9pc2UgLyBkcm9wcGVkXG5cdH1cblx0bGV0IGRyb3BwZWQgPSAwO1xuXHRmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rTGluZXMobGluZXMpKSB7XG5cdFx0Y29uc3QgZ3ppcHBlZCA9IGd6aXBTeW5jKEJ1ZmZlci5mcm9tKGVuY29kZUJvZHkoY2h1bmspKSk7XG5cdFx0Y29uc3Qgb2sgPSBhd2FpdCBzaGlwV2l0aFJldHJ5KGd6aXBwZWQpO1xuXHRcdGlmICghb2spIHtcblx0XHRcdGRyb3BwZWQgKz0gY2h1bmsubGVuZ3RoO1xuXHRcdH1cblx0fVxuXHRpZiAoZHJvcHBlZCA+IDApIHtcblx0XHRlbWl0RHJvcHBlZE1ldHJpYyhkcm9wcGVkKTtcblx0fVxufTtcbiJdfQ==