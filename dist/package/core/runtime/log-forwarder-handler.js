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
// Literal "empty value" tokens — never a legitimate id, but easy to end up with one anyway. The
// concrete case this guards: AWS Lambda's Node.js runtime has no request id yet during the INIT
// phase (module load / DI container construction, before the first invocation), so a line logged
// then still gets the usual `‹iso›\t‹requestId›\t‹LEVEL›\t‹message›` shape, but with the runtime's
// own still-unset id stringified to the literal text "undefined" — an AWS platform quirk, not an
// app bug. Left unguarded, this forwarder would faithfully lift that text as a real `requestId`,
// and Logtrail's Recent Traces would show a bogus trace with every INIT-phase log line from every
// Lambda in the app grouped under the fake id "undefined". Same idea as fw24's
// `sanitizeTraceId`/`isLiteralEmptyValueToken` (execution-context/propagation.ts) — kept as its own
// tiny local copy here rather than an import, since this forwarder is deliberately
// dependency-free (see file header) and never pulls in the rest of the execution-context module graph.
const LITERAL_EMPTY_ID_TOKENS = new Set(['undefined', 'null', 'nan']);
function isLiteralEmptyIdToken(v) {
    return LITERAL_EMPTY_ID_TOKENS.has(v.trim().toLowerCase());
}
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
    // INIT-phase lines carry the literal text "undefined" here (see LITERAL_EMPTY_ID_TOKENS) — treat
    // that as "no request id" rather than a real one, same as if the prefix had no id at all.
    return {
        requestId: isLiteralEmptyIdToken(requestId) ? '' : requestId,
        level: lvl.trim().toLowerCase(),
        message: rest.join('\t').trim(),
    };
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
                // Reject the same literal empty-value tokens as the Lambda-prefix requestId above — a
                // producer upstream stringifying an unset id (`` `${x.correlationId}` `` / `String(x)`)
                // is just as capable of poisoning these fw24-emitted `_meta` fields as it is an
                // AWS-emitted request id, and this forwarder is the single place shipping ALL of them
                // into Logtrail's queryable fields, so it's the natural backstop.
                if (typeof meta.correlationId === 'string' && meta.correlationId.trim() && !isLiteralEmptyIdToken(meta.correlationId))
                    correlationId = meta.correlationId.trim();
                if (typeof meta.causedBy === 'string' && meta.causedBy.trim() && !isLiteralEmptyIdToken(meta.causedBy))
                    causedBy = meta.causedBy.trim();
                if (typeof meta.actorId === 'string' && meta.actorId.trim() && !isLiteralEmptyIdToken(meta.actorId))
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBZ0NHO0FBQ0gseUNBQWlEO0FBQ2pELGdEQUFrQztBQUNsQyxrREFBb0M7QUFDcEMsdUNBQStCO0FBRS9CLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLEVBQUUsSUFBSSxFQUFFLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDeEUscUdBQXFHO0FBQ3JHLGdHQUFnRztBQUNoRyxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxTQUFTLENBQUM7QUFDM0QsdUdBQXVHO0FBQ3ZHLHFHQUFxRztBQUNyRyxrRkFBa0Y7QUFDbEYsTUFBTSxPQUFPLEdBQUcsR0FBRyxJQUFJLEdBQUcsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEdBQUcsWUFBWSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDbkYsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsRUFBRSxJQUFJLEVBQUUsQ0FBQztBQUVqRSxxR0FBcUc7QUFDckcsc0dBQXNHO0FBQ3RHLHFHQUFxRztBQUNyRyxzRkFBc0Y7QUFDdEYsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDO0FBQ3BELElBQUksZ0JBQWdCLEdBQUcs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RCxPQUFPO0lBQ1IsQ0FBQztJQUVELE1BQU0sS0FBSyxHQUFhLEVBQUUsQ0FBQztJQUMzQixLQUFLLE1BQU0sQ0FBQyxJQUFJLE1BQU0sRUFBRSxDQUFDO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxDQUFDLEVBQUUsT0FBTyxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDdEUsSUFBSSxNQUFNLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDckIsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7UUFDcEMsQ0FBQztJQUNGLENBQUM7SUFDRCxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDeEIsT0FBTyxDQUFDLGtDQUFrQztJQUMzQyxDQUFDO0lBQ0QsSUFBSSxPQUFPLEdBQUcsQ0FBQyxDQUFDO0lBQ2hCLEtBQUssTUFBTSxLQUFLLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDdkMsTUFBTSxPQUFPLEdBQUcsSUFBQSxvQkFBUSxFQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN6RCxNQUFNLEVBQUUsR0FBRyxNQUFNLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN4QyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDVCxPQUFPLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQztRQUN6QixDQUFDO0lBQ0YsQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pCLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzVCLENBQUM7QUFDRixDQUFDLENBQUM7QUEvQ1csUUFBQSxPQUFPLFdBK0NsQiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xvdWRXYXRjaCBMb2dzIC0+IFZlY3Rvci9Mb2d0cmFpbCBmb3J3YXJkZXIgKG91dC1vZi1iYW5kIGxvZyBzaGlwcGluZykuXG4gKlxuICogQXBwIExhbWJkYXMgb25seSB3cml0ZSB0byBzdGRvdXQgKENsb3VkV2F0Y2gpIOKAlCBub3RoaW5nIHJ1bnMgaW4gdGhlaXIgcmVxdWVzdCBwYXRoLiBBIENsb3VkV2F0Y2hcbiAqIExvZ3Mgc3Vic2NyaXB0aW9uIGZpbHRlciBzdHJlYW1zIGJhdGNoZWQsIGd6aXBwZWQgZXZlbnRzIHRvIHRoaXMgZnVuY3Rpb24sIHdoaWNoIHJlc2hhcGVzIHRoZW0gdG9cbiAqIGNsZWFuIFZlY3RvciBKU09OIHJlY29yZHMgYW5kIHNoaXBzIHRoZW0gdG8gdGhlIGluZ2VzdCBlbmRwb2ludCBvdmVyIGEga2VlcC1hbGl2ZSBjb25uZWN0aW9uLFxuICogZ3ppcC1jb21wcmVzc2VkIGFuZCBzcGxpdCBpbnRvIGJvdW5kZWQgc3ViLWJhdGNoZXMuXG4gKlxuICogUHJvY2Vzc2luZyBwaXBlbGluZSBwZXIgZXZlbnQgKHNlZSBgTG9nRm9yd2FyZGVyQ29uc3RydWN0YCk6XG4gKiAgIDEuIE5PUk1BTElaRSAg4oCUIHBlZWwgQVdTIExhbWJkYSdzIHRleHQgcHJlZml4LCBsaWZ0IGZ3MjQgdHNsb2cgSlNPTiwgc3RyaXAgQU5TSSwgc2hvcnRlbiBob3N0LlxuICogICAyLiBSRUNMQVNTSUZZIOKAlCBlcnJvci1pc2ggbGluZXMgbWF0Y2hpbmcgYSBcImJlbmlnblwiIHBhdHRlcm4g4oaSIGB3YXJuYCAoYHJlY2xhc3NpZmllZDogXCJiZW5pZ25cImApLlxuICogICAzLiBEUk9QICAgICAgIOKAlCBsaW5lcyBtYXRjaGluZyBhIFwiZHJvcFwiIHBhdHRlcm4gYXJlIHJlbW92ZWQgZW50aXJlbHkgKHNhdmVkIGJhbmR3aWR0aCBhdCBzb3VyY2UpLlxuICogICA0LiBET1dOR1JBREUgIOKAlCBsaW5lcyBtYXRjaGluZyBhIFwiZG93bmdyYWRlXCIgcGF0dGVybiDihpIgYGRlYnVnYCAoYHJlY2xhc3NpZmllZDogXCJub2lzZVwiYCkuXG4gKiBTdGVwcyAy4oCTNCBhcmUgYXBwLW93bmVkIHJ1bGUgbGlzdHMgKGVudi1pbmplY3RlZCBieSB0aGUgY29uc3RydWN0KSwgY29tcGxlbWVudGFyeSB0byBhbnkgZ2xvYmFsXG4gKiBzZXZlcml0eS9ub2lzZSBoYW5kbGluZyBhIHNoYXJlZCBWZWN0b3IgaW5nZXN0IG1heSBhbHNvIGFwcGx5LlxuICpcbiAqIEV2ZXJ5IHJlY29yZCBhbHNvIGNhcnJpZXMgYGFjY291bnRgICsgYHJlZ2lvbmAgKGZyb20gdGhlIGZvcndhcmRlcidzIG93biBBUk4pIHNvIGRlcGxveW1lbnRzIHRoYXRcbiAqIHNoYXJlIGFwcCArIGVudiBuYW1lcyDigJQgZS5nLiBtdWx0aXBsZSBkZXZlbG9wZXJzIGVhY2ggcnVubmluZyBgcGx1c2Zhbi10cmlhbHNgIChBUFBfRU5WSVJPTk1FTlQ9bG9jYWwpXG4gKiBpbiB0aGVpciBPV04gYWNjb3VudCDigJQgc3RheSBkaXN0aW5ndWlzaGFibGUgaW5zdGVhZCBvZiBjb2xsaWRpbmcgdW5kZXIgb25lIGBzZXJ2aWNlYCBsYWJlbC5cbiAqXG4gKiBUd28gbW9yZSBhcHAtb3duZWQgZW5yaWNobWVudHMsIGJvdGggY29uZmlnLWRyaXZlbiAodGhlIGZvcndhcmRlciBuZXZlciBndWVzc2VzIGZyb20gZnJlZSB0ZXh0KTpcbiAqICAg4oCiIEZJRUxEIExJRlRJTkcgKGBGT1JXQVJERVJfRklFTERTYCkg4oCUIHByb21vdGUgYXBwLWRlY2xhcmVkIHN0cnVjdHVyZWQgZmllbGRzIChlLmcuIGBjb3JyZWxhdGlvbklkYCxcbiAqICAgICBgb3JkZXJJZGAsIGB1c2VySWRgKSBvdXQgb2YgdGhlIHRzbG9nIEpTT04gYXJncyBpbnRvIHF1ZXJ5YWJsZSB0b3AtbGV2ZWwgcmVjb3JkIGZpZWxkcy4gVGhpcyBpc1xuICogICAgIHdoYXQgbGV0cyBMb2d0cmFpbCBmb2xsb3cgb25lIHJlcXVlc3QgYWNyb3NzIHNlcnZpY2VzLCBvciBmaWx0ZXIgXCJhbGwgbG9ncyBmb3Igb3JkZXIgOTkxXCIuXG4gKiAgIOKAoiBWRVJTSU9OIChgRk9SV0FSREVSX1ZFUlNJT05gKSDigJQgc3RhbXAgZXZlcnkgbGluZSB3aXRoIHRoZSByZWxlYXNlIHRoYXQgcHJvZHVjZWQgaXQsIHNvIGJlaGF2aW9yXG4gKiAgICAgY2hhbmdlcyBjYW4gYmUgYXR0cmlidXRlZCB0byBhIGRlcGxveS5cbiAqXG4gKiBFTlYgTkFNRVNQQUNFOiB0aGlzIGZ1bmN0aW9uIHJlYWRzIE9OTFkgYEZPUldBUkRFUl8qYCBlbnYgdmFycyDigJQgZGVsaWJlcmF0ZWx5IE5PVCB0aGUgYExPR1RSQUlMXypgXG4gKiBrZXlzIHVzZWQgYnkgZncyNCdzIGluLXByb2Nlc3MgbG9nIHRyYW5zcG9ydC4gVGhhdCBndWFyYW50ZWVzIHRoZSBmb3J3YXJkZXIgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCxcbiAqIG9yIGFjY2lkZW50YWxseSBhY3RpdmF0ZSwgZncyNCdzIGluLXByb2Nlc3MgTG9ndHJhaWwgbWFjaGluZXJ5LlxuICpcbiAqIERFUEVOREVOQ1ktRlJFRSAobm9kZSBidWlsdC1pbnMgb25seSkgc28gdGhlIGZvcndhcmRlciBidW5kbGUgc3RheXMgdGlueSBhbmQgY2hlYXAuXG4gKi9cbmltcG9ydCB7IGd1bnppcFN5bmMsIGd6aXBTeW5jIH0gZnJvbSAnbm9kZTp6bGliJztcbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJztcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnO1xuaW1wb3J0IHsgVVJMIH0gZnJvbSAnbm9kZTp1cmwnO1xuXG5jb25zdCBJTkdFU1RfVVJMID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9VUkw/LnRyaW0oKTtcbmNvbnN0IEJBU0VfU0VSVklDRSA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9TRVJWSUNFPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gU3RhZ2Uvb3duZXIgbGFiZWwgKGUuZy4gYGRldmVsb3BgLCBgcHJvZGAsIGBzYW5kYm94LW5pdGluYCkgc28gZGV2ZWxvcC9wcm9kL3Blci1kZXZlbG9wZXIgbG9ncyBhcmVcbi8vIGRpc3Rpbmd1aXNoYWJsZSDigJQgdGhlcmUgY2FuIGJlIHNldmVyYWwgZGVwbG95bWVudHMgb2Ygb25lIHNlcnZpY2UgYWNyb3NzIGVudnMgYW5kIGRldmVsb3BlcnMuXG5jb25zdCBFTlYgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfRU5WPy50cmltKCkgfHwgJ3Vua25vd24nO1xuLy8gVGhlIGBzZXJ2aWNlYCBsYWJlbCBpcyB3aGF0J3MgcHJvbW90ZWQgdG8gYSBMb2tpIGxhYmVsIChhbmQgc2hvd24gaW4gTG9ndHJhaWwpLCBzbyBmb2xkIHRoZSBlbnYgaW50b1xuLy8gaXQg4oCUIGBwbHVzZmFuLXRyaWFscy1kZXZlbG9wYCwgYHBsdXNmYW4tdHJpYWxzLXNhbmRib3gtbml0aW5gLCDigKYg4oCUIGd1YXJhbnRlZWluZyBlYWNoIGRlcGxveW1lbnQgaXNcbi8vIGRpc3RpbmN0IGF0IGEgZ2xhbmNlLiBgZW52YCBpcyBhbHNvIGVtaXR0ZWQgYXMgYSBzdHJ1Y3R1cmVkIGZpZWxkIGZvciBxdWVyeWluZy5cbmNvbnN0IFNFUlZJQ0UgPSBFTlYgJiYgRU5WICE9PSAndW5rbm93bicgPyBgJHtCQVNFX1NFUlZJQ0V9LSR7RU5WfWAgOiBCQVNFX1NFUlZJQ0U7XG5jb25zdCBYX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWT8udHJpbSgpO1xuXG4vLyBBV1MgYWNjb3VudCArIHJlZ2lvbiBkaXNhbWJpZ3VhdGUgZGVwbG95bWVudHMgdGhhdCBzaGFyZSBhcHAgKyBlbnYgbmFtZXMg4oCUIGUuZy4gc2V2ZXJhbCBkZXZlbG9wZXJzXG4vLyBlYWNoIGRlcGxveWluZyB0aGUgU0FNRSBhcHAgKGBwbHVzZmFuLXRyaWFsc2AsIEFQUF9FTlZJUk9OTUVOVD1sb2NhbCkgdG8gdGhlaXIgT1dOIGFjY291bnQuIFdpdGhvdXRcbi8vIHRoaXMsIGFsbCB0aGVpciBsb2dzIHdvdWxkIGNvbGxpZGUgdW5kZXIgb25lIGBzZXJ2aWNlYCBsYWJlbC4gUmVnaW9uIGlzIHNldCBieSB0aGUgTGFtYmRhIHJ1bnRpbWU7XG4vLyBhY2NvdW50IGlzIHBhcnNlZCBmcm9tIHRoZSBpbnZva2VkIGZ1bmN0aW9uIEFSTiBvbiB0aGUgZmlyc3QgaW52b2NhdGlvbiBhbmQgY2FjaGVkLlxuY29uc3QgUkVHSU9OID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTj8udHJpbSgpIHx8ICcnO1xubGV0IFJFU09MVkVEX0FDQ09VTlQgPSAnJztcbmZ1bmN0aW9uIGFjY291bnRGcm9tQXJuKGFybjogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcblx0Ly8gYXJuOmF3czpsYW1iZGE6PHJlZ2lvbj46PEFDQ09VTlQ+OmZ1bmN0aW9uOjxuYW1lPlxuXHRjb25zdCBwYXJ0cyA9IChhcm4gfHwgJycpLnNwbGl0KCc6Jyk7XG5cdHJldHVybiBwYXJ0cy5sZW5ndGggPiA0ID8gcGFydHNbNF0gOiAnJztcbn1cbi8vIFRoZSBmdzI0IExvZ3RyYWlsL1ZlY3RvciBpbmdlc3QgZGVjb2RlcyBhIEpTT04gYXJyYXkgaW50byBpbmRpdmlkdWFsIGV2ZW50cyBhbmQgUkVKRUNUUyBOREpTT04gKDQwMCksXG4vLyBzbyBganNvbi1hcnJheWAgaXMgdGhlIGRlZmF1bHQuIE92ZXJyaWRlIHRvIGBuZGpzb25gIG9ubHkgZm9yIGFuIGluZ2VzdCBjb25maWd1cmVkIHdpdGggbmV3bGluZSBmcmFtaW5nLlxuY29uc3QgQkFUQ0hfRk9STUFUID0gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9CQVRDSF9GT1JNQVQ/LnRyaW0oKSB8fCAnanNvbi1hcnJheScpIGFzICduZGpzb24nIHwgJ2pzb24tYXJyYXknO1xuLyoqIE1heCB1bmNvbXByZXNzZWQgYnl0ZXMgcGVyIFBPU1Qg4oCUIGJvdW5kcyByZXF1ZXN0IHNpemUgc28gYSBsYXJnZSBDbG91ZFdhdGNoIGJhdGNoIGNhbid0IDQxMyB0aGUgaW5nZXN0LiAqL1xuY29uc3QgTUFYX0JBVENIX0JZVEVTID0gTnVtYmVyKHByb2Nlc3MuZW52LkZPUldBUkRFUl9NQVhfQkFUQ0hfQllURVMpIHx8IDFfMDAwXzAwMDtcbmNvbnN0IFBPU1RfVElNRU9VVF9NUyA9IE51bWJlcihwcm9jZXNzLmVudi5GT1JXQVJERVJfUE9TVF9USU1FT1VUX01TKSB8fCA1MDAwO1xuY29uc3QgTUFYX1JFVFJJRVMgPSAxO1xuXG4vLyDilIDilIAgQXBwLWxldmVsIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMgKGxheWVycyAy4oCTNCkuIEVhY2ggZW52IHZhciBpcyBhIEpTT04gYXJyYXkgb2YgcmVnZXggc291cmNlXG4vLyAgICBzdHJpbmdzOyBjb21waWxlZCBjYXNlLWluc2Vuc2l0aXZlbHkgb25jZSwgaGVyZSwgYXQgY29sZCBzdGFydC4gRW1wdHkvbWFsZm9ybWVkIOKGkiBubyBydWxlcy4g4pSA4pSAXG5mdW5jdGlvbiBjb21waWxlUnVsZXMocmF3SnNvbjogc3RyaW5nIHwgdW5kZWZpbmVkKTogUmVnRXhwW10ge1xuXHRpZiAoIXJhd0pzb24pIHJldHVybiBbXTtcblx0bGV0IGFycjogdW5rbm93bjtcblx0dHJ5IHtcblx0XHRhcnIgPSBKU09OLnBhcnNlKHJhd0pzb24pO1xuXHR9IGNhdGNoIHtcblx0XHRyZXR1cm4gW107XG5cdH1cblx0aWYgKCFBcnJheS5pc0FycmF5KGFycikpIHJldHVybiBbXTtcblx0Y29uc3Qgb3V0OiBSZWdFeHBbXSA9IFtdO1xuXHRmb3IgKGNvbnN0IHNyYyBvZiBhcnIpIHtcblx0XHRpZiAodHlwZW9mIHNyYyAhPT0gJ3N0cmluZycgfHwgc3JjLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cdFx0dHJ5IHtcblx0XHRcdG91dC5wdXNoKG5ldyBSZWdFeHAoc3JjLCAnaScpKTtcblx0XHR9IGNhdGNoIHtcblx0XHRcdC8vIEEgYmFkIHBhdHRlcm4gbXVzdCBuZXZlciBicmVhayB0aGUgZm9yd2FyZGVyIOKAlCBza2lwIGl0LlxuXHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdGNvbnNvbGUud2FybignW2xvZy1mb3J3YXJkZXJdIGlnbm9yaW5nIGludmFsaWQgbm9pc2UgcGF0dGVybjonLCBzcmMpO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gb3V0O1xufVxuXG5jb25zdCBCRU5JR05fUlVMRVMgPSBjb21waWxlUnVsZXMocHJvY2Vzcy5lbnYuRk9SV0FSREVSX05PSVNFX0JFTklHTik7XG5jb25zdCBEUk9QX1JVTEVTID0gY29tcGlsZVJ1bGVzKHByb2Nlc3MuZW52LkZPUldBUkRFUl9OT0lTRV9EUk9QKTtcbmNvbnN0IERPV05HUkFERV9SVUxFUyA9IGNvbXBpbGVSdWxlcyhwcm9jZXNzLmVudi5GT1JXQVJERVJfTk9JU0VfRE9XTkdSQURFKTtcbmNvbnN0IEhBU19OT0lTRV9SVUxFUyA9IEJFTklHTl9SVUxFUy5sZW5ndGggPiAwIHx8IERST1BfUlVMRVMubGVuZ3RoID4gMCB8fCBET1dOR1JBREVfUlVMRVMubGVuZ3RoID4gMDtcblxuLy8g4pSA4pSAIEFwcC1kZWNsYXJlZCBmaWVsZCBsaWZ0aW5nIChGT1JXQVJERVJfRklFTERTKTogYSBKU09OIGFycmF5IG9mIGZpZWxkIG5hbWVzIHRoZSBhcHAgd2FudHMgcHJvbW90ZWRcbi8vICAgIGZyb20gaXRzIHN0cnVjdHVyZWQgdHNsb2cgYXJncyB0byBxdWVyeWFibGUgdG9wLWxldmVsIHJlY29yZCBmaWVsZHMgKGUuZy4gY29ycmVsYXRpb25JZCwgb3JkZXJJZCkuXG4vLyAgICBUaGUgYXBwIG93bnMgdGhpcyBsaXN0IHZpYSB0aGUgY29uc3RydWN0OyB0aGUgZm9yd2FyZGVyIG5ldmVyIHNjcmFwZXMgZnJlZSB0ZXh0IGZvciB0aGVtLiDilIDilIBcbmZ1bmN0aW9uIHBhcnNlRmllbGRMaXN0KHJhd0pzb246IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZ1tdIHtcblx0aWYgKCFyYXdKc29uKSByZXR1cm4gW107XG5cdHRyeSB7XG5cdFx0Y29uc3QgYXJyID0gSlNPTi5wYXJzZShyYXdKc29uKTtcblx0XHRpZiAoIUFycmF5LmlzQXJyYXkoYXJyKSkgcmV0dXJuIFtdO1xuXHRcdHJldHVybiBbIC4uLm5ldyBTZXQoYXJyLmZpbHRlcigocyk6IHMgaXMgc3RyaW5nID0+IHR5cGVvZiBzID09PSAnc3RyaW5nJyAmJiBzLnRyaW0oKS5sZW5ndGggPiAwKS5tYXAoKHMpID0+IHMudHJpbSgpKSkgXTtcblx0fSBjYXRjaCB7XG5cdFx0cmV0dXJuIFtdO1xuXHR9XG59XG5jb25zdCBMSUZUX1NFVCA9IG5ldyBTZXQocGFyc2VGaWVsZExpc3QocHJvY2Vzcy5lbnYuRk9SV0FSREVSX0ZJRUxEUykpO1xuY29uc3QgSEFTX0xJRlRfRklFTERTID0gTElGVF9TRVQuc2l6ZSA+IDA7XG5cbi8vIFJlbGVhc2UvdmVyc2lvbiBzdGFtcCBzbyBldmVyeSBzaGlwcGVkIGxpbmUgaXMgYXR0cmlidXRhYmxlIHRvIHRoZSBkZXBsb3kgdGhhdCBwcm9kdWNlZCBpdC4gU2V0IGJ5IHRoZVxuLy8gY29uc3RydWN0IGF0IGRlcGxveSB0aW1lIChzZW12ZXIgb3IgZ2l0IHNoYSk7IG9taXR0ZWQgZnJvbSByZWNvcmRzIHdoZW4gdW5zZXQuXG5jb25zdCBWRVJTSU9OID0gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX1ZFUlNJT04/LnRyaW0oKSB8fCAnJztcblxuLy8g4pSA4pSAIEZpZWxkIGRyb3AtbGlzdCAoRk9SV0FSREVSX0RST1BfRklFTERTKTogcmVjb3JkIGtleXMgdG8gT01JVCBiZWZvcmUgc2hpcHBpbmcsIHRvIGN1dCBpbmdlc3Qvc3RvcmFnZVxuLy8gICAgc2l6ZSBvbiBsb3ctdmFsdWUgZmllbGRzLiBEZWZhdWx0IGRyb3BzIGxvZ1N0cmVhbS9sb2dHcm91cC9zb3VyY2VfdHlwZS9yZWFzb24gKGhvc3QgaXMgc3RpbGwga2VwdCkuXG4vLyAgICBUaGUgY29uc3RydWN0IHNldHMgdGhpcyBmcm9tIHRoZSBgZHJvcEZpZWxkc2AgY29uZmlnOyB1bnNldCDihpIgdGhlIGRlZmF1bHRzIGJlbG93LiBDb3JlIGtleXMgY2FuXG4vLyAgICBuZXZlciBiZSBkcm9wcGVkIChiZWx0LWFuZC1zdXNwZW5kZXJzIGFnYWluc3QgbWlzY29uZmlnKS4g4pSA4pSAXG5jb25zdCBERUZBVUxUX0RST1BfRklFTERTID0gWyAnbG9nU3RyZWFtJywgJ2xvZ0dyb3VwJywgJ3NvdXJjZV90eXBlJywgJ3JlYXNvbicgXTtcbmNvbnN0IE5FVkVSX0RST1AgPSBuZXcgU2V0KFsgJ3NlcnZpY2UnLCAnbGV2ZWwnLCAnbWVzc2FnZScsICd0aW1lc3RhbXAnIF0pO1xuY29uc3QgRFJPUF9TRVQgPSBuZXcgU2V0KFxuXHQocHJvY2Vzcy5lbnYuRk9SV0FSREVSX0RST1BfRklFTERTICE9PSB1bmRlZmluZWRcblx0XHQ/IHBhcnNlRmllbGRMaXN0KHByb2Nlc3MuZW52LkZPUldBUkRFUl9EUk9QX0ZJRUxEUylcblx0XHQ6IERFRkFVTFRfRFJPUF9GSUVMRFNcblx0KS5maWx0ZXIoKGspID0+ICFORVZFUl9EUk9QLmhhcyhrKSksXG4pO1xuXG4vLyBSZWNvcmQga2V5cyB0aGUgZm9yd2FyZGVyIG93bnMg4oCUIGEgbGlmdGVkIGFwcCBmaWVsZCBtdXN0IG5ldmVyIG92ZXJ3cml0ZSBvbmUgb2YgdGhlc2UuXG5jb25zdCBSRVNFUlZFRF9GSUVMRF9LRVlTID0gbmV3IFNldChbXG5cdCdzZXJ2aWNlJywgJ2VudicsICdhY2NvdW50JywgJ3JlZ2lvbicsICd2ZXJzaW9uJywgJ2hvc3QnLCAnbG9nZ2VyJywgJ3JlcXVlc3RJZCcsXG5cdCdsZXZlbCcsICdyZWNsYXNzaWZpZWQnLCAnbWVzc2FnZScsICd0aW1lc3RhbXAnLCAnbG9nR3JvdXAnLCAnbG9nU3RyZWFtJyxcblx0J2NvZGVGaWxlJywgJ2NvZGVMaW5lJyxcbl0pO1xuXG4vKipcbiAqIExpZnQgdGhlIGFwcC1kZWNsYXJlZCB7QGxpbmsgTElGVF9TRVR9IGZpZWxkcyBvdXQgb2YgYSBwYXJzZWQgdHNsb2cgb2JqZWN0IGludG8gZmxhdCBge2tleTogdmFsdWV9YFxuICogc3RyaW5nIHBhaXJzLiBTY2FucyB0aGUgb2JqZWN0J3Mgb3duIHNjYWxhciBrZXlzIEFORCBvbmUgbGV2ZWwgaW50byBpdHMgcG9zaXRpb25hbC1hcmd1bWVudCBvYmplY3RzXG4gKiAoXCIwXCIuLlwiblwiKSwgc28gYGxvZ2dlci5pbmZvKCdjaGFyZ2UgZmFpbGVkJywgeyBvcmRlcklkLCBjb3JyZWxhdGlvbklkIH0pYCBzdXJmYWNlcyBib3RoLiBSZXNlcnZlZFxuICogcmVjb3JkIGtleXMgYXJlIG5ldmVyIGxpZnRlZDsgdmFsdWVzIGFyZSBjb2VyY2VkIHRvIHRyaW1tZWQgc3RyaW5nczsgZmlyc3Qgb2NjdXJyZW5jZSB3aW5zLlxuICovXG5mdW5jdGlvbiBleHRyYWN0TGlmdGVkRmllbGRzKG86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG5cdGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXHRjb25zdCB0YWtlID0gKGs6IHN0cmluZywgdjogdW5rbm93bik6IHZvaWQgPT4ge1xuXHRcdGlmIChvdXRba10gIT09IHVuZGVmaW5lZCB8fCBSRVNFUlZFRF9GSUVMRF9LRVlTLmhhcyhrKSB8fCAhTElGVF9TRVQuaGFzKGspKSByZXR1cm47XG5cdFx0aWYgKHR5cGVvZiB2ID09PSAnc3RyaW5nJyB8fCB0eXBlb2YgdiA9PT0gJ251bWJlcicgfHwgdHlwZW9mIHYgPT09ICdib29sZWFuJykge1xuXHRcdFx0Y29uc3QgcyA9IFN0cmluZyh2KS50cmltKCk7XG5cdFx0XHRpZiAocykgb3V0W2tdID0gcztcblx0XHR9XG5cdH07XG5cdGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMobykpIHtcblx0XHRpZiAoayA9PT0gJ19tZXRhJykgY29udGludWU7XG5cdFx0aWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHYpKSB7XG5cdFx0XHRmb3IgKGNvbnN0IFsgazIsIHYyIF0gb2YgT2JqZWN0LmVudHJpZXModiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHRha2UoazIsIHYyKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0dGFrZShrLCB2KTtcblx0XHR9XG5cdH1cblx0cmV0dXJuIG91dDtcbn1cblxuLy8gTGV2ZWxzIHRoYXQgY291bnQgYXMgXCJlcnJvci1pc2hcIiBmb3IgdGhlIGJlbmlnbiBkb3duZ3JhZGUgKG1pcnJvcnMgdGhlIFZlY3RvciBBMSBsaXN0KS5cbmNvbnN0IEVSUk9SSVNIID0gbmV3IFNldChbICdlcnJvcicsICdlcnInLCAnZmF0YWwnLCAnY3JpdGljYWwnLCAnY3JpdCcsICdlbWVyZycsICdhbGVydCcsICdwYW5pYycgXSk7XG5mdW5jdGlvbiBhbnlNYXRjaChydWxlczogUmVnRXhwW10sIG1zZzogc3RyaW5nKTogYm9vbGVhbiB7XG5cdGZvciAoY29uc3QgcmUgb2YgcnVsZXMpIHtcblx0XHRpZiAocmUudGVzdChtc2cpKSByZXR1cm4gdHJ1ZTtcblx0fVxuXHRyZXR1cm4gZmFsc2U7XG59XG5cbi8vIFJldXNlZCBhY3Jvc3Mgd2FybSBpbnZvY2F0aW9ucyBzbyB3ZSBkb24ndCBwYXkgVENQL1RMUyBzZXR1cCBwZXIgYmF0Y2guXG5jb25zdCBodHRwQWdlbnQgPSBuZXcgaHR0cC5BZ2VudCh7IGtlZXBBbGl2ZTogdHJ1ZSwgbWF4U29ja2V0czogMTYgfSk7XG5jb25zdCBodHRwc0FnZW50ID0gbmV3IGh0dHBzLkFnZW50KHsga2VlcEFsaXZlOiB0cnVlLCBtYXhTb2NrZXRzOiAxNiB9KTtcblxuaW50ZXJmYWNlIENsb3VkV2F0Y2hMb2dzRXZlbnQge1xuXHRhd3Nsb2dzOiB7IGRhdGE6IHN0cmluZyB9O1xufVxuXG5pbnRlcmZhY2UgRGVjb2RlZFBheWxvYWQge1xuXHRtZXNzYWdlVHlwZTogc3RyaW5nO1xuXHRsb2dHcm91cDogc3RyaW5nO1xuXHRsb2dTdHJlYW06IHN0cmluZztcblx0bG9nRXZlbnRzOiBBcnJheTx7IGlkOiBzdHJpbmc7IHRpbWVzdGFtcDogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfT47XG59XG5cbi8vIExhbWJkYSBwbGF0Zm9ybSBsaW5lcyB0aGF0IGFyZSBwdXJlIG5vaXNlLiBSRVBPUlQgaXMga2VwdCBieSBkZWZhdWx0IChjYXJyaWVzIGR1cmF0aW9uL21lbW9yeSk7XG4vLyBzZXQgRk9SV0FSREVSX0RST1BfUkVQT1JUPXRydWUgdG8gZHJvcCBpdCB0b28uXG5jb25zdCBEUk9QX1JFUE9SVCA9IHByb2Nlc3MuZW52LkZPUldBUkRFUl9EUk9QX1JFUE9SVD8udHJpbSgpID09PSAndHJ1ZSc7XG5mdW5jdGlvbiBpc1BsYXRmb3JtTm9pc2UocmF3OiBzdHJpbmcpOiBib29sZWFuIHtcblx0aWYgKHJhdy5zdGFydHNXaXRoKCdTVEFSVCBSZXF1ZXN0SWQnKSB8fCByYXcuc3RhcnRzV2l0aCgnRU5EIFJlcXVlc3RJZCcpIHx8IHJhdy5zdGFydHNXaXRoKCdJTklUX1NUQVJUJykpIHtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXHRpZiAoRFJPUF9SRVBPUlQgJiYgcmF3LnN0YXJ0c1dpdGgoJ1JFUE9SVCBSZXF1ZXN0SWQnKSkge1xuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLy8gZncyNCdzIHRzbG9nIGNvbG9yaXplcyBvdXRwdXQgd2l0aCBBTlNJIFNHUiBjb2RlcyAoZS5nLiBFU0NbMzJtIOKApiBFU0NbMzltKSB3aGljaCBvdGhlcndpc2Ugc2hpcCBhc1xuLy8gbGl0ZXJhbCBgWzMybWAgbm9pc2UgaW4gTG9ndHJhaWwuIFN0cmlwIGFsbCBBTlNJIGVzY2FwZSBzZXF1ZW5jZXMgZnJvbSBzaGlwcGVkIHRleHQuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29udHJvbC1yZWdleFxuY29uc3QgQU5TSV9SRSA9IC9cXHgxYlxcW1swLTk7XSpbQS1aYS16XS9nO1xuZnVuY3Rpb24gc3RyaXBBbnNpKHM6IHN0cmluZyk6IHN0cmluZyB7XG5cdHJldHVybiBzLmluY2x1ZGVzKCdcXHgxYicpID8gcy5yZXBsYWNlKEFOU0lfUkUsICcnKSA6IHM7XG59XG5cbi8vIExhbWJkYSBwbGF0Zm9ybS9ydW50aW1lIGZhaWx1cmVzIHRoYXQgY3Jhc2ggb3Iga2lsbCB0aGUgaW52b2NhdGlvbiBvdXRyaWdodCDigJQgYSB0aW1lb3V0LCBhbiBPT01cbi8vIGtpbGwsIG9yIHRoZSBydW50aW1lIGV4aXRpbmcgZWFybHkuIE5vbmUgb2YgdGhlc2UgY2FycnkgYW4gRVJST1IvRkFUQUwvV0FSTiB0b2tlbiBvZiB0aGVpciBvd24sIHNvXG4vLyB3aXRob3V0IHRoaXMgdGhleSdkIGZhbGwgdGhyb3VnaCB0byB0aGUgYGluZm9gIGRlZmF1bHQgYW5kIGJlIGludmlzaWJsZSB0byBlcnJvci1zaWduYXR1cmUgc2Nhbm5pbmcuXG5jb25zdCBMQU1CREFfQ1JBU0hfUkUgPSAvdGFzayB0aW1lZCBvdXQgYWZ0ZXJ8cHJvY2VzcyBleGl0ZWQgYmVmb3JlIGNvbXBsZXRpbmcgcmVxdWVzdHxydW50aW1lIGV4aXRlZCB3aXRoIGVycm9yfHJ1bnRpbWVcXC4oPzpleGl0ZXJyb3J8b3V0b2ZtZW1vcnkpfG91dCBvZiBtZW1vcnl8c2lnbmFsOlxccypraWxsZWQvaTtcblxuZnVuY3Rpb24gZmFsbGJhY2tMZXZlbChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG5cdGlmICgvXFxiKD86RVJST1J8RkFUQUwpXFxiLy50ZXN0KHJhdykpIHJldHVybiAnZXJyb3InO1xuXHRpZiAoTEFNQkRBX0NSQVNIX1JFLnRlc3QocmF3KSkgcmV0dXJuICdlcnJvcic7XG5cdGlmICgvXFxiV0FSTig/OklORyk/XFxiLy50ZXN0KHJhdykpIHJldHVybiAnd2Fybic7XG5cdHJldHVybiAnaW5mbyc7XG59XG5cbmNvbnN0IEtOT1dOX0xFVkVMUyA9IG5ldyBTZXQoWyAndHJhY2UnLCAnZGVidWcnLCAnaW5mbycsICd3YXJuJywgJ3dhcm5pbmcnLCAnZXJyb3InLCAnZmF0YWwnIF0pO1xuY29uc3QgSVNPX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfS87XG5cbi8vIExpdGVyYWwgXCJlbXB0eSB2YWx1ZVwiIHRva2VucyDigJQgbmV2ZXIgYSBsZWdpdGltYXRlIGlkLCBidXQgZWFzeSB0byBlbmQgdXAgd2l0aCBvbmUgYW55d2F5LiBUaGVcbi8vIGNvbmNyZXRlIGNhc2UgdGhpcyBndWFyZHM6IEFXUyBMYW1iZGEncyBOb2RlLmpzIHJ1bnRpbWUgaGFzIG5vIHJlcXVlc3QgaWQgeWV0IGR1cmluZyB0aGUgSU5JVFxuLy8gcGhhc2UgKG1vZHVsZSBsb2FkIC8gREkgY29udGFpbmVyIGNvbnN0cnVjdGlvbiwgYmVmb3JlIHRoZSBmaXJzdCBpbnZvY2F0aW9uKSwgc28gYSBsaW5lIGxvZ2dlZFxuLy8gdGhlbiBzdGlsbCBnZXRzIHRoZSB1c3VhbCBg4oC5aXNv4oC6XFx04oC5cmVxdWVzdElk4oC6XFx04oC5TEVWRUzigLpcXHTigLltZXNzYWdl4oC6YCBzaGFwZSwgYnV0IHdpdGggdGhlIHJ1bnRpbWUnc1xuLy8gb3duIHN0aWxsLXVuc2V0IGlkIHN0cmluZ2lmaWVkIHRvIHRoZSBsaXRlcmFsIHRleHQgXCJ1bmRlZmluZWRcIiDigJQgYW4gQVdTIHBsYXRmb3JtIHF1aXJrLCBub3QgYW5cbi8vIGFwcCBidWcuIExlZnQgdW5ndWFyZGVkLCB0aGlzIGZvcndhcmRlciB3b3VsZCBmYWl0aGZ1bGx5IGxpZnQgdGhhdCB0ZXh0IGFzIGEgcmVhbCBgcmVxdWVzdElkYCxcbi8vIGFuZCBMb2d0cmFpbCdzIFJlY2VudCBUcmFjZXMgd291bGQgc2hvdyBhIGJvZ3VzIHRyYWNlIHdpdGggZXZlcnkgSU5JVC1waGFzZSBsb2cgbGluZSBmcm9tIGV2ZXJ5XG4vLyBMYW1iZGEgaW4gdGhlIGFwcCBncm91cGVkIHVuZGVyIHRoZSBmYWtlIGlkIFwidW5kZWZpbmVkXCIuIFNhbWUgaWRlYSBhcyBmdzI0J3Ncbi8vIGBzYW5pdGl6ZVRyYWNlSWRgL2Bpc0xpdGVyYWxFbXB0eVZhbHVlVG9rZW5gIChleGVjdXRpb24tY29udGV4dC9wcm9wYWdhdGlvbi50cykg4oCUIGtlcHQgYXMgaXRzIG93blxuLy8gdGlueSBsb2NhbCBjb3B5IGhlcmUgcmF0aGVyIHRoYW4gYW4gaW1wb3J0LCBzaW5jZSB0aGlzIGZvcndhcmRlciBpcyBkZWxpYmVyYXRlbHlcbi8vIGRlcGVuZGVuY3ktZnJlZSAoc2VlIGZpbGUgaGVhZGVyKSBhbmQgbmV2ZXIgcHVsbHMgaW4gdGhlIHJlc3Qgb2YgdGhlIGV4ZWN1dGlvbi1jb250ZXh0IG1vZHVsZSBncmFwaC5cbmNvbnN0IExJVEVSQUxfRU1QVFlfSURfVE9LRU5TID0gbmV3IFNldChbICd1bmRlZmluZWQnLCAnbnVsbCcsICduYW4nIF0pO1xuZnVuY3Rpb24gaXNMaXRlcmFsRW1wdHlJZFRva2VuKHY6IHN0cmluZyk6IGJvb2xlYW4ge1xuXHRyZXR1cm4gTElURVJBTF9FTVBUWV9JRF9UT0tFTlMuaGFzKHYudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xufVxuXG4vLyB0c2xvZydzIFwicHJldHR5XCIgKG5vbi1KU09OKSBjb25zb2xlIGZvcm1hdDogYFlZWVktTU0tREQgSEg6TU06U1MubW1tIExFVkVMIHJlc3TigKZgLiBUaGUgZGF0ZSArIGxldmVsXG4vLyBpdCBwcmludHMgZHVwbGljYXRlIHdoYXQgTG9ndHJhaWwgYWxyZWFkeSBzaG93cyBpbiB0aGUgZGVkaWNhdGVkIFRJTUUvTFZMIGNvbHVtbnMg4oCUIHBlZWwgdGhlbSBvZmZcbi8vIHRoZSBtZXNzYWdlIGxpa2UgdGhlIExhbWJkYS1wcmVmaXggLyB0c2xvZy1KU09OIGJyYW5jaGVzIGFscmVhZHkgZG8gZm9yIHRoZWlyIG93biBzaGFwZXMuXG5jb25zdCBQUkVUVFlfVFNMT0dfUkUgPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9IFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9XFxzKyhUUkFDRXxERUJVR3xJTkZPfFdBUk4oPzpJTkcpP3xFUlJPUnxGQVRBTClcXHMrKC4qKSQvO1xuXG4vKiogUGVlbCBhIHRzbG9nIFwicHJldHR5XCIgYOKAuWRhdGXigLog4oC5dGltZeKAuiBMRVZFTCDigLlyZXN04oC6YCBwcmVmaXgsIGlmIHRoZSBsaW5lIG1hdGNoZXMuICovXG5mdW5jdGlvbiBwYXJzZVByZXR0eVRzbG9nUHJlZml4KHJhdzogc3RyaW5nKTogeyBsZXZlbDogc3RyaW5nOyBtZXNzYWdlOiBzdHJpbmcgfSB8IG51bGwge1xuXHRjb25zdCBtID0gcmF3Lm1hdGNoKFBSRVRUWV9UU0xPR19SRSk7XG5cdGlmICghbSkgcmV0dXJuIG51bGw7XG5cdGNvbnN0IFsgLCBsdmwsIHJlc3QgXSA9IG07XG5cdGNvbnN0IGxldmVsID0gbHZsLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aCgnd2FybicpID8gJ3dhcm4nIDogbHZsLnRvTG93ZXJDYXNlKCk7XG5cdHJldHVybiB7IGxldmVsLCBtZXNzYWdlOiByZXN0IH07XG59XG5cbi8qKlxuICogQVdTIExhbWJkYSBlbWl0cyB0ZXh0IGxvZ3MgYXMgYOKAuWlzb+KAulxcdOKAuXJlcXVlc3RJZOKAulxcdOKAuUxFVkVM4oC6XFx04oC5bWVzc2FnZeKAumAuIFBlZWwgdGhhdCBwcmVmaXggb2ZmIHNvIHRoZVxuICogbWVzc2FnZSBpcyBqdXN0IHRoZSB0ZXh0LCBhbmQgbGlmdCByZXF1ZXN0SWQvbGV2ZWwgb3V0IGFzIGZpZWxkcyAodGhleSdyZSBhbHJlYWR5IHNob3duIGFzIGNvbHVtbnMpLlxuICogUmV0dXJucyBudWxsIGlmIHRoZSBsaW5lIGlzbid0IGluIHRoYXQgZm9ybWF0LlxuICovXG5mdW5jdGlvbiBwYXJzZUxhbWJkYVByZWZpeChyYXc6IHN0cmluZyk6IHsgcmVxdWVzdElkOiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IG1lc3NhZ2U6IHN0cmluZyB9IHwgbnVsbCB7XG5cdGNvbnN0IHBhcnRzID0gcmF3LnNwbGl0KCdcXHQnKTtcblx0aWYgKHBhcnRzLmxlbmd0aCA8IDQpIHJldHVybiBudWxsO1xuXHRjb25zdCBbIHRzLCByZXF1ZXN0SWQsIGx2bCwgLi4ucmVzdCBdID0gcGFydHM7XG5cdGlmICghSVNPX1JFLnRlc3QodHMpIHx8ICFLTk9XTl9MRVZFTFMuaGFzKGx2bC50cmltKCkudG9Mb3dlckNhc2UoKSkpIHJldHVybiBudWxsO1xuXHQvLyBJTklULXBoYXNlIGxpbmVzIGNhcnJ5IHRoZSBsaXRlcmFsIHRleHQgXCJ1bmRlZmluZWRcIiBoZXJlIChzZWUgTElURVJBTF9FTVBUWV9JRF9UT0tFTlMpIOKAlCB0cmVhdFxuXHQvLyB0aGF0IGFzIFwibm8gcmVxdWVzdCBpZFwiIHJhdGhlciB0aGFuIGEgcmVhbCBvbmUsIHNhbWUgYXMgaWYgdGhlIHByZWZpeCBoYWQgbm8gaWQgYXQgYWxsLlxuXHRyZXR1cm4ge1xuXHRcdHJlcXVlc3RJZDogaXNMaXRlcmFsRW1wdHlJZFRva2VuKHJlcXVlc3RJZCkgPyAnJyA6IHJlcXVlc3RJZCxcblx0XHRsZXZlbDogbHZsLnRyaW0oKS50b0xvd2VyQ2FzZSgpLFxuXHRcdG1lc3NhZ2U6IHJlc3Quam9pbignXFx0JykudHJpbSgpLFxuXHR9O1xufVxuXG4vKipcbiAqIFR1cm4gYSB2ZXJib3NlIENsb3VkV2F0Y2ggbG9nLWdyb3VwIC8gbG9nLXN0cmVhbSBpbnRvIGEgc2hvcnQgZnVuY3Rpb24gbmFtZSBmb3IgdGhlIGBob3N0YCBsYWJlbCxcbiAqIGUuZy4gYOKApi1wbHVzZmFudHJpYWxzc3RyZWFtcHJvY2Vzc29y4oCmTG9nR3JvdXDigKZgIOKGkiBgcGx1c2ZhbnRyaWFsc3N0cmVhbXByb2Nlc3NvcmAuIEZhbGxzIGJhY2sgdG8gdGhlXG4gKiByYXcgbG9nIGdyb3VwLiBUaGUgZnVsbCBsb2cgZ3JvdXAgaXMgc3RpbGwgZW1pdHRlZCBzZXBhcmF0ZWx5IGFzIGBsb2dHcm91cGAuXG4gKi9cbmZ1bmN0aW9uIHNob3J0SG9zdChsb2dHcm91cDogc3RyaW5nLCBsb2dTdHJlYW06IHN0cmluZyk6IHN0cmluZyB7XG5cdC8vIExhbWJkYSBsb2cgc3RyZWFtOiBcIllZWVkvTU0vREQvPGZ1bmN0aW9uTmFtZT5bJExBVEVTVF08aWQ+XCIg4oCUIHRoZSBjbGVhbmVzdCBzb3VyY2Ugb2YgdGhlIGZuIG5hbWUuXG5cdGNvbnN0IHNtID0gbG9nU3RyZWFtLm1hdGNoKC9eXFxkezR9XFwvXFxkezJ9XFwvXFxkezJ9XFwvKC4rPylcXFtcXCRMQVRFU1RcXF0vKTtcblx0aWYgKHNtICYmIHNtWzFdKSB7XG5cdFx0cmV0dXJuIHNtWzFdLnJlcGxhY2UoLy1bQS1aYS16MC05XXs2LH0kLywgJycpOyAvLyBkcm9wIHRoZSBDbG91ZEZvcm1hdGlvbiByYW5kb20gc3VmZml4XG5cdH1cblx0Ly8gRmFsbGJhY2s6IHBhcnNlIHRoZSBsb2cgZ3JvdXAg4oCUIHN0cmlwIHRoZSBg4oCmTG9nR3JvdXA8aGFzaD4tPHN1ZmZpeD5gIHRhaWwsIHRha2UgdGhlIGxhc3Qgc2VnbWVudCxcblx0Ly8gYW5kIGRlLWR1cGxpY2F0ZSBDREsncyBkb3VibGVkIGNvbnN0cnVjdCBuYW1lIChgZm9vQmFyZm9vQmFyYCDihpIgYGZvb0JhcmApLlxuXHRsZXQgcyA9IGxvZ0dyb3VwO1xuXHRjb25zdCBsZyA9IHMuaW5kZXhPZignTG9nR3JvdXAnKTtcblx0aWYgKGxnID4gMCkgcyA9IHMuc2xpY2UoMCwgbGcpO1xuXHRjb25zdCBtID0gcy5tYXRjaCgvKD86c3RhY2stfE5lc3RlZFN0YWNrUmVzb3VyY2VbMC05QS1GYS1mXSotKShbXi1dKykkLyk7XG5cdGlmIChtKSBzID0gbVsxXTtcblx0aWYgKHMubGVuZ3RoID4gMCAmJiBzLmxlbmd0aCAlIDIgPT09IDApIHtcblx0XHRjb25zdCBoYWxmID0gcy5sZW5ndGggLyAyO1xuXHRcdGlmIChzLnNsaWNlKDAsIGhhbGYpID09PSBzLnNsaWNlKGhhbGYpKSBzID0gcy5zbGljZSgwLCBoYWxmKTtcblx0fVxuXHRyZXR1cm4gcyB8fCBsb2dHcm91cDtcbn1cblxuLyoqXG4gKiBSZXNoYXBlIG9uZSBDbG91ZFdhdGNoIGxvZyBldmVudCBpbnRvIGEgY2xlYW4gVmVjdG9yIHJlY29yZCwgdGhlbiBhcHBseSB0aGUgYXBwLWxldmVsIG5vaXNlL3NldmVyaXR5XG4gKiBydWxlcy4gUmV0dXJucyBgbnVsbGAgd2hlbiB0aGUgZXZlbnQgc2hvdWxkIGJlIGRyb3BwZWQgKHBsYXRmb3JtIG5vaXNlIG9yIGEgXCJkcm9wXCIgcnVsZSBtYXRjaCkuXG4gKlxuICogZncyNCBsb2dzIGFyZSB0c2xvZyBKU09OIGxpa2UgYHtcIjBcIjpcInRoZSBtZXNzYWdlXCIsXCIxXCI6ey4uLmFyZ30sXCJfbWV0YVwiOntcIm5hbWVcIjpcIkFQSUNvbnN0cnVjdFwiLFxuICogXCJsb2dMZXZlbE5hbWVcIjpcIklORk9cIixcImRhdGVcIjpcIi4uLlwifX1gLiBXZSBsaWZ0IHRoZSByZWFsIG1lc3NhZ2Ugb3V0IG9mIHRoZSBwb3NpdGlvbmFsIGtleXMgYW5kIHRoZVxuICogY29tcG9uZW50L2xldmVsL3RpbWUgb3V0IG9mIGBfbWV0YWAsIHNvIExvZ3RyYWlsIHNob3dzIHJlYWRhYmxlIGxpbmVzIGluc3RlYWQgb2YgYSByYXcgSlNPTiBibG9iLlxuICogTm9uLUpTT04gbGluZXMgKExhbWJkYSBTVEFSVC9FTkQvUkVQT1JULCBwbGFpbiB0ZXh0KSBwYXNzIHRocm91Z2ggdW5jaGFuZ2VkLlxuICovXG5mdW5jdGlvbiB0b1ZlY3RvclJlY29yZChcblx0ZTogeyB0aW1lc3RhbXA6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0sXG5cdGxvZ0dyb3VwOiBzdHJpbmcsXG5cdGxvZ1N0cmVhbTogc3RyaW5nLFxuKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsIHtcblx0Y29uc3QgcmF3ID0gKGUubWVzc2FnZSA/PyAnJykucmVwbGFjZSgvXFxzKyQvLCAnJyk7XG5cblx0Ly8g4pSA4pSAIDEpIERST1A6IExhbWJkYSBwbGF0Zm9ybSBsaW5lcyB0aGF0IGFyZSBwdXJlIG5vaXNlLiDilIDilIBcblx0aWYgKGlzUGxhdGZvcm1Ob2lzZShyYXcudHJpbVN0YXJ0KCkpKSB7XG5cdFx0cmV0dXJuIG51bGw7XG5cdH1cblxuXHRsZXQgbWVzc2FnZSA9IHJhdztcblx0bGV0IGxldmVsOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBsb2dnZXI6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IHJlcXVlc3RJZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgY29ycmVsYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgY2F1c2VkQnk6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IGFjdG9ySWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0bGV0IHRzSXNvOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cdGxldCBsaWZ0ZWQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQ7XG5cdGxldCBjb2RlTG9jOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cblx0Ly8g4pSA4pSAIDEpIE5PUk1BTElaRTogcGVlbCBBV1MgTGFtYmRhJ3MgYOKAuWlzb+KAulxcdOKAuXJlcXVlc3RJZOKAulxcdOKAuUxFVkVM4oC6XFx04oC5bWVzc2FnZeKAumAgdGV4dCBwcmVmaXgsIGlmIHByZXNlbnQuXG5cdGNvbnN0IGxhbWJkYSA9IHBhcnNlTGFtYmRhUHJlZml4KHJhdyk7XG5cdGlmIChsYW1iZGEpIHtcblx0XHRyZXF1ZXN0SWQgPSBsYW1iZGEucmVxdWVzdElkO1xuXHRcdGxldmVsID0gbGFtYmRhLmxldmVsO1xuXHRcdG1lc3NhZ2UgPSBsYW1iZGEubWVzc2FnZTtcblx0fVxuXG5cdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IGlmIHRoZSByZW1haW5pbmcgbWVzc2FnZSBpcyBmdzI0IHRzbG9nIEpTT04sIGxpZnQgdGhlIHJlYWwgdGV4dCArIGNvbXBvbmVudC9sZXZlbC90aW1lLlxuXHRjb25zdCBib2R5ID0gbWVzc2FnZTtcblx0aWYgKGJvZHkuY2hhckNvZGVBdCgwKSA9PT0gMHg3YiAvKiB7ICovKSB7XG5cdFx0dHJ5IHtcblx0XHRcdGNvbnN0IG8gPSBKU09OLnBhcnNlKGJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXHRcdFx0Y29uc3QgbWV0YSA9IG8uX21ldGEgYXMge1xuXHRcdFx0XHRuYW1lPzogdW5rbm93bjsgbG9nTGV2ZWxOYW1lPzogdW5rbm93bjsgZGF0ZT86IHVua25vd247IGNvcnJlbGF0aW9uSWQ/OiB1bmtub3duOyBjYXVzZWRCeT86IHVua25vd247IGFjdG9ySWQ/OiB1bmtub3duO1xuXHRcdFx0XHRwYXRoPzogeyBmaWxlUGF0aFdpdGhMaW5lPzogdW5rbm93bjsgZmlsZU5hbWU/OiB1bmtub3duOyBmaWxlTGluZT86IHVua25vd24gfTtcblx0XHRcdH0gfCB1bmRlZmluZWQ7XG5cdFx0XHRpZiAobWV0YSAmJiB0eXBlb2YgbWV0YSA9PT0gJ29iamVjdCcpIHtcblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLm5hbWUgPT09ICdzdHJpbmcnKSBsb2dnZXIgPSBtZXRhLm5hbWU7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5sb2dMZXZlbE5hbWUgPT09ICdzdHJpbmcnKSBsZXZlbCA9IG1ldGEubG9nTGV2ZWxOYW1lLnRvTG93ZXJDYXNlKCk7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5kYXRlID09PSAnc3RyaW5nJyAmJiAhTnVtYmVyLmlzTmFOKERhdGUucGFyc2UobWV0YS5kYXRlKSkpIHtcblx0XHRcdFx0XHR0c0lzbyA9IG5ldyBEYXRlKG1ldGEuZGF0ZSkudG9JU09TdHJpbmcoKTtcblx0XHRcdFx0fVxuXHRcdFx0XHQvLyBSZWplY3QgdGhlIHNhbWUgbGl0ZXJhbCBlbXB0eS12YWx1ZSB0b2tlbnMgYXMgdGhlIExhbWJkYS1wcmVmaXggcmVxdWVzdElkIGFib3ZlIOKAlCBhXG5cdFx0XHRcdC8vIHByb2R1Y2VyIHVwc3RyZWFtIHN0cmluZ2lmeWluZyBhbiB1bnNldCBpZCAoYGAgYCR7eC5jb3JyZWxhdGlvbklkfWAgYGAgLyBgU3RyaW5nKHgpYClcblx0XHRcdFx0Ly8gaXMganVzdCBhcyBjYXBhYmxlIG9mIHBvaXNvbmluZyB0aGVzZSBmdzI0LWVtaXR0ZWQgYF9tZXRhYCBmaWVsZHMgYXMgaXQgaXMgYW5cblx0XHRcdFx0Ly8gQVdTLWVtaXR0ZWQgcmVxdWVzdCBpZCwgYW5kIHRoaXMgZm9yd2FyZGVyIGlzIHRoZSBzaW5nbGUgcGxhY2Ugc2hpcHBpbmcgQUxMIG9mIHRoZW1cblx0XHRcdFx0Ly8gaW50byBMb2d0cmFpbCdzIHF1ZXJ5YWJsZSBmaWVsZHMsIHNvIGl0J3MgdGhlIG5hdHVyYWwgYmFja3N0b3AuXG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5jb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJyAmJiBtZXRhLmNvcnJlbGF0aW9uSWQudHJpbSgpICYmICFpc0xpdGVyYWxFbXB0eUlkVG9rZW4obWV0YS5jb3JyZWxhdGlvbklkKSkgY29ycmVsYXRpb25JZCA9IG1ldGEuY29ycmVsYXRpb25JZC50cmltKCk7XG5cdFx0XHRcdGlmICh0eXBlb2YgbWV0YS5jYXVzZWRCeSA9PT0gJ3N0cmluZycgJiYgbWV0YS5jYXVzZWRCeS50cmltKCkgJiYgIWlzTGl0ZXJhbEVtcHR5SWRUb2tlbihtZXRhLmNhdXNlZEJ5KSkgY2F1c2VkQnkgPSBtZXRhLmNhdXNlZEJ5LnRyaW0oKTtcblx0XHRcdFx0aWYgKHR5cGVvZiBtZXRhLmFjdG9ySWQgPT09ICdzdHJpbmcnICYmIG1ldGEuYWN0b3JJZC50cmltKCkgJiYgIWlzTGl0ZXJhbEVtcHR5SWRUb2tlbihtZXRhLmFjdG9ySWQpKSBhY3RvcklkID0gbWV0YS5hY3RvcklkLnRyaW0oKTtcblx0XHRcdFx0Ly8gdHNsb2cgbmF0aXZlIHNvdXJjZSBwb3NpdGlvbiAobW9kZSAnYWxsJyk6IF9tZXRhLnBhdGguXG5cdFx0XHRcdGNvbnN0IHAgPSBtZXRhLnBhdGg7XG5cdFx0XHRcdGlmIChwICYmIHR5cGVvZiBwID09PSAnb2JqZWN0Jykge1xuXHRcdFx0XHRcdGlmICh0eXBlb2YgcC5maWxlUGF0aFdpdGhMaW5lID09PSAnc3RyaW5nJykgY29kZUxvYyA9IHAuZmlsZVBhdGhXaXRoTGluZTtcblx0XHRcdFx0XHRlbHNlIGlmICh0eXBlb2YgcC5maWxlTmFtZSA9PT0gJ3N0cmluZycgJiYgcC5maWxlTGluZSAhPSBudWxsKSBjb2RlTG9jID0gYCR7cC5maWxlTmFtZX06JHtwLmZpbGVMaW5lfWA7XG5cdFx0XHRcdH1cblx0XHRcdH0gZWxzZSBpZiAodHlwZW9mIG8uZXJyb3JUeXBlID09PSAnc3RyaW5nJyAmJiB0eXBlb2Ygby5lcnJvck1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG5cdFx0XHRcdC8vIExhbWJkYSdzIG93biBpbnZvY2F0aW9uLWVycm9yIGVudmVsb3BlIChjcmFzaC90aW1lb3V0L09PTSByZXBvcnRlZCBieSB0aGUgcGxhdGZvcm0sIG5vdFxuXHRcdFx0XHQvLyBieSBhcHAgY29kZSkg4oCUIG5vIGBfbWV0YWAsIHNvIGl0J2Qgb3RoZXJ3aXNlIGZhbGwgdGhyb3VnaCB0byB0aGUgYGluZm9gIGRlZmF1bHQuXG5cdFx0XHRcdGxldmVsID0gJ2Vycm9yJztcblx0XHRcdH1cblx0XHRcdC8vIExpZnQgYXBwLWRlY2xhcmVkIHN0cnVjdHVyZWQgZmllbGRzIChjb3JyZWxhdGlvbklkLCBvcmRlcklkLCDigKYpIEZJUlNULCBzbyB0aG9zZSBrZXlzIGNhbiBiZVxuXHRcdFx0Ly8ga2VwdCBPVVQgb2YgdGhlIGh1bWFuIG1lc3NhZ2UgYmVsb3cgKG5vIGR1cGxpY2F0aW5nIGEgbGlmdGVkIGlkIGluIGJvdGggdGhlIGZpZWxkIGFuZCB0aGUgdGV4dCkuXG5cdFx0XHRpZiAoSEFTX0xJRlRfRklFTERTKSB7XG5cdFx0XHRcdGNvbnN0IGYgPSBleHRyYWN0TGlmdGVkRmllbGRzKG8pO1xuXHRcdFx0XHRpZiAoT2JqZWN0LmtleXMoZikubGVuZ3RoID4gMCkgbGlmdGVkID0gZjtcblx0XHRcdH1cblx0XHRcdGNvbnN0IGxpZnRlZEtleXMgPSBsaWZ0ZWQgPyBuZXcgU2V0KE9iamVjdC5rZXlzKGxpZnRlZCkpIDogbmV3IFNldDxzdHJpbmc+KCk7XG5cblx0XHRcdC8vIFBvc2l0aW9uYWwgYXJncyBcIjBcIi4uXCJuXCIgaG9sZCB0aGUgbG9nZ2VkIG1lc3NhZ2UgKyBwYXJhbXMuIEJ1aWxkIHRoZSBodW1hbiBtZXNzYWdlIGZyb20gdGhlXG5cdFx0XHQvLyBzdHJpbmcgYXJncyBwbHVzIHRoZSBOT04tbGlmdGVkIGtleXMgb2Ygb2JqZWN0IGFyZ3MgKGxpZnRlZCBpZHMgYmVjb21lIGZpZWxkcywgbm90IG1lc3NhZ2Vcblx0XHRcdC8vIG5vaXNlKS4gQSBgeyBfc3JjbG9jIH1gIGFyZyBjYXJyaWVzIHRoZSBjYWxsZXIncyBzb3VyY2UgcG9zaXRpb24g4oCUIGxpZnRlZCwga2VwdCBvdXQgb2YgdGhlIHRleHQuXG5cdFx0XHRjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcblx0XHRcdGZvciAobGV0IGkgPSAwOyBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgU3RyaW5nKGkpKTsgaSsrKSB7XG5cdFx0XHRcdGNvbnN0IHYgPSBvW1N0cmluZyhpKV07XG5cdFx0XHRcdGlmICh0eXBlb2YgdiA9PT0gJ3N0cmluZycpIHsgcGFydHMucHVzaCh2KTsgY29udGludWU7IH1cblx0XHRcdFx0aWYgKHYgJiYgdHlwZW9mIHYgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHYpKSB7XG5cdFx0XHRcdFx0Y29uc3Qgb2JqID0gdiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblx0XHRcdFx0XHRpZiAodHlwZW9mIG9iai5fc3JjbG9jID09PSAnc3RyaW5nJykgeyBpZiAoIWNvZGVMb2MpIGNvZGVMb2MgPSBvYmouX3NyY2xvYyBhcyBzdHJpbmc7IGNvbnRpbnVlOyB9XG5cdFx0XHRcdFx0Y29uc3QgcmVzdDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcblx0XHRcdFx0XHRmb3IgKGNvbnN0IFsgaywgdmFsIF0gb2YgT2JqZWN0LmVudHJpZXMob2JqKSkgaWYgKCFsaWZ0ZWRLZXlzLmhhcyhrKSkgcmVzdFsgayBdID0gdmFsO1xuXHRcdFx0XHRcdGlmIChPYmplY3Qua2V5cyhyZXN0KS5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKEpTT04uc3RyaW5naWZ5KHJlc3QpKTtcblx0XHRcdFx0XHRjb250aW51ZTtcblx0XHRcdFx0fVxuXHRcdFx0XHRwYXJ0cy5wdXNoKEpTT04uc3RyaW5naWZ5KHYpKTtcblx0XHRcdH1cblx0XHRcdGlmIChwYXJ0cy5sZW5ndGggPiAwKSBtZXNzYWdlID0gcGFydHMuam9pbignICcpO1xuXHRcdH0gY2F0Y2gge1xuXHRcdFx0Ly8gbm90IEpTT04gYWZ0ZXIgYWxsIOKAlCBrZWVwIHRoZSAocHJlZml4LXN0cmlwcGVkKSBtZXNzYWdlXG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdC8vIOKUgOKUgCAxKSBOT1JNQUxJWkU6IHRzbG9nJ3MgXCJwcmV0dHlcIiAobm9uLUpTT04pIGNvbnNvbGUgZm9ybWF0IOKAlCBzdHJpcCBpdHMgb3duIGR1cGxpY2F0ZSBkYXRlK2xldmVsLlxuXHRcdGNvbnN0IHByZXR0eSA9IHBhcnNlUHJldHR5VHNsb2dQcmVmaXgoYm9keSk7XG5cdFx0aWYgKHByZXR0eSkge1xuXHRcdFx0aWYgKCFsZXZlbCkgbGV2ZWwgPSBwcmV0dHkubGV2ZWw7XG5cdFx0XHRtZXNzYWdlID0gcHJldHR5Lm1lc3NhZ2U7XG5cdFx0fVxuXHR9XG5cblx0Y29uc3QgY2xlYW5NZXNzYWdlID0gc3RyaXBBbnNpKG1lc3NhZ2UpO1xuXHRsZXQgcmVzb2x2ZWRMZXZlbCA9IGxldmVsID8/IGZhbGxiYWNrTGV2ZWwocmF3KTtcblx0bGV0IHJlY2xhc3NpZmllZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG5cdC8vIFNwbGl0IHRoZSBjYXB0dXJlZCBzb3VyY2UgcG9zaXRpb24gaW50byBxdWVyeWFibGUgYGNvZGVGaWxlYCArIGBjb2RlTGluZWAgKGZvciBcIm9wZW4gdGhlIGV4YWN0XG5cdC8vIGN1bHByaXQgbGluZVwiIGxpbmtzKS4gUGF0aCBpcyBtYWRlIHJlcG8tcmVsYXRpdmUgKGtlcHQgZnJvbSBpdHMgbGFzdCBgc3JjL2Agc2VnbWVudCkuXG5cdGxldCBjb2RlRmlsZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXHRsZXQgY29kZUxpbmU6IHN0cmluZyB8IHVuZGVmaW5lZDtcblx0aWYgKGNvZGVMb2MpIHtcblx0XHRjb25zdCBtID0gY29kZUxvYy5tYXRjaCgvXiguKj8pOihcXGQrKSg/OjpcXGQrKT8kLyk7XG5cdFx0aWYgKG0pIHtcblx0XHRcdC8vIEFic29sdXRlIHBhdGggKOKApi9zcmMv4oCmKSDihpIgbWFrZSByZXBvLXJlbGF0aXZlIGZyb20gdGhlIGxhc3QgYHNyYy9gLiBBbHJlYWR5LXJlbGF0aXZlIHBhdGhzXG5cdFx0XHQvLyAodGhlIGxvZ2dpbmcgbGF5ZXIgZW1pdHMgYHNyYy/igKZgKSBhcmUga2VwdCBhcy1pcy5cblx0XHRcdGNvbnN0IHNyY0lkeCA9IG1bMV0ubGFzdEluZGV4T2YoJy9zcmMvJyk7XG5cdFx0XHRjb2RlRmlsZSA9IHNyY0lkeCA+PSAwID8gbVsxXS5zbGljZShzcmNJZHggKyAxKSA6IG1bMV07XG5cdFx0XHRjb2RlTGluZSA9IG1bMl07XG5cdFx0fVxuXHR9XG5cblx0Ly8g4pSA4pSAIExheWVycyAy4oCTNDogYXBwLWxldmVsIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMsIGFwcGxpZWQgdG8gdGhlIG5vcm1hbGl6ZWQgbWVzc2FnZS4g4pSA4pSAXG5cdGlmIChIQVNfTk9JU0VfUlVMRVMpIHtcblx0XHQvLyAyKSBSRUNMQVNTSUZZOiBiZW5pZ24gXCJlcnJvcnNcIiDihpIgd2FybiAob25seSBkb3duZ3JhZGUsIG5ldmVyIHVwZ3JhZGUpLlxuXHRcdGlmIChFUlJPUklTSC5oYXMocmVzb2x2ZWRMZXZlbCkgJiYgYW55TWF0Y2goQkVOSUdOX1JVTEVTLCBjbGVhbk1lc3NhZ2UpKSB7XG5cdFx0XHRyZXNvbHZlZExldmVsID0gJ3dhcm4nO1xuXHRcdFx0cmVjbGFzc2lmaWVkID0gJ2Jlbmlnbic7XG5cdFx0fVxuXHRcdC8vIDMpIERST1A6IG5vaXNlIHJlbW92ZWQgZW50aXJlbHkgKG5ldmVyIHNoaXBwZWQg4oCUIHNhdmVzIGluZ2VzdCBiYW5kd2lkdGggYXQgdGhlIHNvdXJjZSkuXG5cdFx0aWYgKGFueU1hdGNoKERST1BfUlVMRVMsIGNsZWFuTWVzc2FnZSkpIHtcblx0XHRcdHJldHVybiBudWxsO1xuXHRcdH1cblx0XHQvLyA0KSBET1dOR1JBREU6IG5vaXNlIGtlcHQgYnV0IGRlLWVtcGhhc2lzZWQgdG8gZGVidWcuXG5cdFx0aWYgKGFueU1hdGNoKERPV05HUkFERV9SVUxFUywgY2xlYW5NZXNzYWdlKSkge1xuXHRcdFx0cmVzb2x2ZWRMZXZlbCA9ICdkZWJ1Zyc7XG5cdFx0XHRyZWNsYXNzaWZpZWQgPSAnbm9pc2UnO1xuXHRcdH1cblx0fVxuXG5cdGNvbnN0IHJlYzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG5cdFx0c2VydmljZTogU0VSVklDRSxcblx0XHRlbnY6IEVOVixcblx0XHQuLi4oUkVTT0xWRURfQUNDT1VOVCA/IHsgYWNjb3VudDogUkVTT0xWRURfQUNDT1VOVCB9IDoge30pLFxuXHRcdC4uLihSRUdJT04gPyB7IHJlZ2lvbjogUkVHSU9OIH0gOiB7fSksXG5cdFx0Li4uKFZFUlNJT04gPyB7IHZlcnNpb246IFZFUlNJT04gfSA6IHt9KSxcblx0XHRob3N0OiBzaG9ydEhvc3QobG9nR3JvdXAsIGxvZ1N0cmVhbSksXG5cdFx0Li4uKGxvZ2dlciA/IHsgbG9nZ2VyIH0gOiB7fSksXG5cdFx0Li4uKHJlcXVlc3RJZCA/IHsgcmVxdWVzdElkIH0gOiB7fSksXG5cdFx0Li4uKGxpZnRlZCA/PyB7fSksXG5cdFx0Li4uKGNvcnJlbGF0aW9uSWQgPyB7IGNvcnJlbGF0aW9uSWQgfSA6IHt9KSxcblx0XHQuLi4oY2F1c2VkQnkgPyB7IGNhdXNlZEJ5IH0gOiB7fSksXG5cdFx0Li4uKGFjdG9ySWQgPyB7IGFjdG9ySWQgfSA6IHt9KSxcblx0XHQuLi4oY29kZUZpbGUgPyB7IGNvZGVGaWxlIH0gOiB7fSksXG5cdFx0Li4uKGNvZGVMaW5lID8geyBjb2RlTGluZSB9IDoge30pLFxuXHRcdGxldmVsOiByZXNvbHZlZExldmVsLFxuXHRcdC4uLihyZWNsYXNzaWZpZWQgPyB7IHJlY2xhc3NpZmllZCB9IDoge30pLFxuXHRcdG1lc3NhZ2U6IGNsZWFuTWVzc2FnZSxcblx0XHR0aW1lc3RhbXA6IHRzSXNvID8/IG5ldyBEYXRlKGUudGltZXN0YW1wKS50b0lTT1N0cmluZygpLFxuXHRcdGxvZ0dyb3VwLFxuXHRcdGxvZ1N0cmVhbSxcblx0fTtcblx0Ly8gRHJvcCBsb3ctdmFsdWUgZmllbGRzIChGT1JXQVJERVJfRFJPUF9GSUVMRFMpIHRvIGN1dCBpbmdlc3Qvc3RvcmFnZSBzaXplLiBgaG9zdGAgKGRlcml2ZWQgZnJvbVxuXHQvLyBsb2dHcm91cC9sb2dTdHJlYW0pIGlzIGtlcHQsIHNvIGRyb3BwaW5nIHRoZSByYXcgZ3JvdXAvc3RyZWFtIGxvc2VzIG5vdGhpbmcgYWN0aW9uYWJsZS5cblx0aWYgKERST1BfU0VULnNpemUpIGZvciAoY29uc3QgayBvZiBEUk9QX1NFVCkgZGVsZXRlIHJlY1trXTtcblx0cmV0dXJuIHJlYztcbn1cblxuLyoqIFNwbGl0IHByZS1zZXJpYWxpemVkIGxpbmVzIGludG8gc3ViLWJhdGNoZXMgdW5kZXIgTUFYX0JBVENIX0JZVEVTICh1bmNvbXByZXNzZWQpLiAqL1xuZnVuY3Rpb24gY2h1bmtMaW5lcyhsaW5lczogc3RyaW5nW10pOiBzdHJpbmdbXVtdIHtcblx0Y29uc3QgY2h1bmtzOiBzdHJpbmdbXVtdID0gW107XG5cdGxldCBjdXJyZW50OiBzdHJpbmdbXSA9IFtdO1xuXHRsZXQgc2l6ZSA9IDA7XG5cdGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuXHRcdGNvbnN0IGxpbmVCeXRlcyA9IEJ1ZmZlci5ieXRlTGVuZ3RoKGxpbmUpICsgMTsgLy8gKzEgZm9yIHRoZSBkZWxpbWl0ZXJcblx0XHRpZiAoY3VycmVudC5sZW5ndGggPiAwICYmIHNpemUgKyBsaW5lQnl0ZXMgPiBNQVhfQkFUQ0hfQllURVMpIHtcblx0XHRcdGNodW5rcy5wdXNoKGN1cnJlbnQpO1xuXHRcdFx0Y3VycmVudCA9IFtdO1xuXHRcdFx0c2l6ZSA9IDA7XG5cdFx0fVxuXHRcdGN1cnJlbnQucHVzaChsaW5lKTtcblx0XHRzaXplICs9IGxpbmVCeXRlcztcblx0fVxuXHRpZiAoY3VycmVudC5sZW5ndGggPiAwKSB7XG5cdFx0Y2h1bmtzLnB1c2goY3VycmVudCk7XG5cdH1cblx0cmV0dXJuIGNodW5rcztcbn1cblxuZnVuY3Rpb24gZW5jb2RlQm9keShsaW5lczogc3RyaW5nW10pOiBzdHJpbmcge1xuXHQvLyBsaW5lcyBhcmUgYWxyZWFkeSBKU09OIHN0cmluZ3Ncblx0cmV0dXJuIEJBVENIX0ZPUk1BVCA9PT0gJ2pzb24tYXJyYXknID8gYFske2xpbmVzLmpvaW4oJywnKX1dYCA6IGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG5mdW5jdGlvbiBwb3N0KGd6aXBwZWQ6IEJ1ZmZlcik6IFByb21pc2U8dm9pZD4ge1xuXHRyZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuXHRcdGNvbnN0IHVybCA9IG5ldyBVUkwoSU5HRVNUX1VSTCEpO1xuXHRcdGNvbnN0IGlzSHR0cHMgPSB1cmwucHJvdG9jb2wgPT09ICdodHRwczonO1xuXHRcdGNvbnN0IGxpYiA9IGlzSHR0cHMgPyBodHRwcyA6IGh0dHA7XG5cdFx0Y29uc3QgcmVxID0gbGliLnJlcXVlc3QoXG5cdFx0XHR1cmwsXG5cdFx0XHR7XG5cdFx0XHRcdG1ldGhvZDogJ1BPU1QnLFxuXHRcdFx0XHRhZ2VudDogaXNIdHRwcyA/IGh0dHBzQWdlbnQgOiBodHRwQWdlbnQsXG5cdFx0XHRcdGhlYWRlcnM6IHtcblx0XHRcdFx0XHQnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuXHRcdFx0XHRcdCdDb250ZW50LUVuY29kaW5nJzogJ2d6aXAnLFxuXHRcdFx0XHRcdCdDb250ZW50LUxlbmd0aCc6IGd6aXBwZWQubGVuZ3RoLFxuXHRcdFx0XHRcdC4uLihYX0FQSV9LRVkgPyB7ICd4LWFwaS1rZXknOiBYX0FQSV9LRVkgfSA6IHt9KSxcblx0XHRcdFx0fSxcblx0XHRcdH0sXG5cdFx0XHQocmVzKSA9PiB7XG5cdFx0XHRcdHJlcy5yZXN1bWUoKTsgLy8gZHJhaW4gc28gdGhlIHNvY2tldCBjYW4gYmUgcmV1c2VkXG5cdFx0XHRcdGNvbnN0IHN0YXR1cyA9IHJlcy5zdGF0dXNDb2RlID8/IDA7XG5cdFx0XHRcdGlmIChzdGF0dXMgPj0gMjAwICYmIHN0YXR1cyA8IDMwMCkge1xuXHRcdFx0XHRcdHJlc29sdmUoKTtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRyZWplY3QobmV3IEVycm9yKGBpbmdlc3QgcmVzcG9uZGVkICR7c3RhdHVzfWApKTtcblx0XHRcdFx0fVxuXHRcdFx0fSxcblx0XHQpO1xuXHRcdHJlcS5vbignZXJyb3InLCByZWplY3QpO1xuXHRcdHJlcS5zZXRUaW1lb3V0KFBPU1RfVElNRU9VVF9NUywgKCkgPT4gcmVxLmRlc3Ryb3kobmV3IEVycm9yKCdpbmdlc3QgdGltZW91dCcpKSk7XG5cdFx0cmVxLmVuZChnemlwcGVkKTtcblx0fSk7XG59XG5cbi8qKiBQT1NUIG9uZSBjaHVuayB3aXRoIGEgc2luZ2xlIHJldHJ5LiBSZXR1cm5zIGZhbHNlIGlmIHRoZSBjaHVuayB3YXMgZHJvcHBlZCBhZnRlciByZXRyaWVzLiAqL1xuYXN5bmMgZnVuY3Rpb24gc2hpcFdpdGhSZXRyeShnemlwcGVkOiBCdWZmZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcblx0Zm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPD0gTUFYX1JFVFJJRVM7IGF0dGVtcHQrKykge1xuXHRcdHRyeSB7XG5cdFx0XHRhd2FpdCBwb3N0KGd6aXBwZWQpO1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHRpZiAoYXR0ZW1wdCA9PT0gTUFYX1JFVFJJRVMpIHtcblx0XHRcdFx0Ly8gU3dhbGxvdyBhZnRlciByZXRyaWVzOiBhIHBlcnNpc3RlbnQgaW5nZXN0IG91dGFnZSBtdXN0IG5vdCBjcmVhdGUgYSBDbG91ZFdhdGNoIHJldHJ5IHN0b3JtLlxuXHRcdFx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdFx0XHRjb25zb2xlLmVycm9yKCdbbG9nLWZvcndhcmRlcl0gc2hpcCBmYWlsZWQsIGRyb3BwaW5nIGNodW5rOicsIChlcnIgYXMgRXJyb3IpLm1lc3NhZ2UpO1xuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cdHJldHVybiBmYWxzZTtcbn1cblxuLyoqIEVtaXQgYW4gYWxhcm1hYmxlIENsb3VkV2F0Y2ggbWV0cmljIChFTUYpIHdoZW4gcmVjb3JkcyBhcmUgZHJvcHBlZCDigJQgbm8gU0RLLCBqdXN0IHN0cnVjdHVyZWQgc3Rkb3V0LiAqL1xuZnVuY3Rpb24gZW1pdERyb3BwZWRNZXRyaWMocmVjb3JkczogbnVtYmVyKTogdm9pZCB7XG5cdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdGNvbnNvbGUubG9nKFxuXHRcdEpTT04uc3RyaW5naWZ5KHtcblx0XHRcdF9hd3M6IHtcblx0XHRcdFx0VGltZXN0YW1wOiBEYXRlLm5vdygpLFxuXHRcdFx0XHRDbG91ZFdhdGNoTWV0cmljczogW1xuXHRcdFx0XHRcdHtcblx0XHRcdFx0XHRcdE5hbWVzcGFjZTogJ0xvZ0ZvcndhcmRlcicsXG5cdFx0XHRcdFx0XHREaW1lbnNpb25zOiBbIFsgJ3NlcnZpY2UnIF0gXSxcblx0XHRcdFx0XHRcdE1ldHJpY3M6IFsgeyBOYW1lOiAnRHJvcHBlZFJlY29yZHMnLCBVbml0OiAnQ291bnQnIH0gXSxcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRdLFxuXHRcdFx0fSxcblx0XHRcdHNlcnZpY2U6IFNFUlZJQ0UsXG5cdFx0XHREcm9wcGVkUmVjb3JkczogcmVjb3Jkcyxcblx0XHR9KSxcblx0KTtcbn1cblxuaW50ZXJmYWNlIExhbWJkYUNvbnRleHRMaWtlIHtcblx0aW52b2tlZEZ1bmN0aW9uQXJuPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogQ2xvdWRXYXRjaExvZ3NFdmVudCwgY29udGV4dD86IExhbWJkYUNvbnRleHRMaWtlKTogUHJvbWlzZTx2b2lkPiA9PiB7XG5cdC8vIFJlc29sdmUgdGhlIGFjY291bnQgZnJvbSB0aGlzIGZvcndhcmRlcidzIG93biBBUk4gb25jZSAoc2FtZSBmb3IgZXZlcnkgaW52b2NhdGlvbikuXG5cdGlmICghUkVTT0xWRURfQUNDT1VOVCAmJiBjb250ZXh0Py5pbnZva2VkRnVuY3Rpb25Bcm4pIHtcblx0XHRSRVNPTFZFRF9BQ0NPVU5UID0gYWNjb3VudEZyb21Bcm4oY29udGV4dC5pbnZva2VkRnVuY3Rpb25Bcm4pO1xuXHR9XG5cdGlmICghSU5HRVNUX1VSTCkge1xuXHRcdHJldHVybjsgLy8gbm90IGNvbmZpZ3VyZWQgeWV0IOKAlCBuby1vcCAoc2FmZSB0byBkZXBsb3kgYmVmb3JlIHdpcmluZyB0aGUgaW5nZXN0IFVSTClcblx0fVxuXG5cdGxldCBwYXlsb2FkOiBEZWNvZGVkUGF5bG9hZDtcblx0dHJ5IHtcblx0XHRwYXlsb2FkID0gSlNPTi5wYXJzZShndW56aXBTeW5jKEJ1ZmZlci5mcm9tKGV2ZW50LmF3c2xvZ3MuZGF0YSwgJ2Jhc2U2NCcpKS50b1N0cmluZygndXRmOCcpKSBhcyBEZWNvZGVkUGF5bG9hZDtcblx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRjb25zb2xlLmVycm9yKCdbbG9nLWZvcndhcmRlcl0gZmFpbGVkIHRvIGRlY29kZSBwYXlsb2FkOicsIChlcnIgYXMgRXJyb3IpLm1lc3NhZ2UpO1xuXHRcdHJldHVybjtcblx0fVxuXG5cdGlmIChwYXlsb2FkLm1lc3NhZ2VUeXBlID09PSAnQ09OVFJPTF9NRVNTQUdFJykge1xuXHRcdHJldHVybjsgLy8gc3Vic2NyaXB0aW9uIGxpdmVuZXNzIHBpbmdcblx0fVxuXHRjb25zdCBldmVudHMgPSBwYXlsb2FkLmxvZ0V2ZW50cztcblx0aWYgKCFBcnJheS5pc0FycmF5KGV2ZW50cykgfHwgZXZlbnRzLmxlbmd0aCA9PT0gMCkge1xuXHRcdHJldHVybjtcblx0fVxuXG5cdGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuXHRmb3IgKGNvbnN0IGUgb2YgZXZlbnRzKSB7XG5cdFx0Y29uc3QgcmVjb3JkID0gdG9WZWN0b3JSZWNvcmQoZSwgcGF5bG9hZC5sb2dHcm91cCwgcGF5bG9hZC5sb2dTdHJlYW0pO1xuXHRcdGlmIChyZWNvcmQgIT09IG51bGwpIHtcblx0XHRcdGxpbmVzLnB1c2goSlNPTi5zdHJpbmdpZnkocmVjb3JkKSk7XG5cdFx0fVxuXHR9XG5cdGlmIChsaW5lcy5sZW5ndGggPT09IDApIHtcblx0XHRyZXR1cm47IC8vIHdob2xlIGJhdGNoIHdhcyBub2lzZSAvIGRyb3BwZWRcblx0fVxuXHRsZXQgZHJvcHBlZCA9IDA7XG5cdGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtMaW5lcyhsaW5lcykpIHtcblx0XHRjb25zdCBnemlwcGVkID0gZ3ppcFN5bmMoQnVmZmVyLmZyb20oZW5jb2RlQm9keShjaHVuaykpKTtcblx0XHRjb25zdCBvayA9IGF3YWl0IHNoaXBXaXRoUmV0cnkoZ3ppcHBlZCk7XG5cdFx0aWYgKCFvaykge1xuXHRcdFx0ZHJvcHBlZCArPSBjaHVuay5sZW5ndGg7XG5cdFx0fVxuXHR9XG5cdGlmIChkcm9wcGVkID4gMCkge1xuXHRcdGVtaXREcm9wcGVkTWV0cmljKGRyb3BwZWQpO1xuXHR9XG59O1xuIl19