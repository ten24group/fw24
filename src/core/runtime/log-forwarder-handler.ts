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
import { gunzipSync, gzipSync } from 'node:zlib';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

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
function accountFromArn(arn: string | undefined): string {
	// arn:aws:lambda:<region>:<ACCOUNT>:function:<name>
	const parts = (arn || '').split(':');
	return parts.length > 4 ? parts[4] : '';
}
// The fw24 Logtrail/Vector ingest decodes a JSON array into individual events and REJECTS NDJSON (400),
// so `json-array` is the default. Override to `ndjson` only for an ingest configured with newline framing.
const BATCH_FORMAT = (process.env.FORWARDER_BATCH_FORMAT?.trim() || 'json-array') as 'ndjson' | 'json-array';
/** Max uncompressed bytes per POST — bounds request size so a large CloudWatch batch can't 413 the ingest. */
const MAX_BATCH_BYTES = Number(process.env.FORWARDER_MAX_BATCH_BYTES) || 1_000_000;
const POST_TIMEOUT_MS = Number(process.env.FORWARDER_POST_TIMEOUT_MS) || 5000;
const MAX_RETRIES = 1;

// ── App-level noise / severity rules (layers 2–4). Each env var is a JSON array of regex source
//    strings; compiled case-insensitively once, here, at cold start. Empty/malformed → no rules. ──
function compileRules(rawJson: string | undefined): RegExp[] {
	if (!rawJson) return [];
	let arr: unknown;
	try {
		arr = JSON.parse(rawJson);
	} catch {
		return [];
	}
	if (!Array.isArray(arr)) return [];
	const out: RegExp[] = [];
	for (const src of arr) {
		if (typeof src !== 'string' || src.length === 0) continue;
		try {
			out.push(new RegExp(src, 'i'));
		} catch {
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
function parseFieldList(rawJson: string | undefined): string[] {
	if (!rawJson) return [];
	try {
		const arr = JSON.parse(rawJson);
		if (!Array.isArray(arr)) return [];
		return [ ...new Set(arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())) ];
	} catch {
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
const DEFAULT_DROP_FIELDS = [ 'logStream', 'logGroup', 'source_type', 'reason' ];
const NEVER_DROP = new Set([ 'service', 'level', 'message', 'timestamp' ]);
const DROP_SET = new Set(
	(process.env.FORWARDER_DROP_FIELDS !== undefined
		? parseFieldList(process.env.FORWARDER_DROP_FIELDS)
		: DEFAULT_DROP_FIELDS
	).filter((k) => !NEVER_DROP.has(k)),
);

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
function extractLiftedFields(o: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	const take = (k: string, v: unknown): void => {
		if (out[k] !== undefined || RESERVED_FIELD_KEYS.has(k) || !LIFT_SET.has(k)) return;
		if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
			const s = String(v).trim();
			if (s) out[k] = s;
		}
	};
	for (const [ k, v ] of Object.entries(o)) {
		if (k === '_meta') continue;
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			for (const [ k2, v2 ] of Object.entries(v as Record<string, unknown>)) take(k2, v2);
		} else {
			take(k, v);
		}
	}
	return out;
}

// Levels that count as "error-ish" for the benign downgrade (mirrors the Vector A1 list).
const ERRORISH = new Set([ 'error', 'err', 'fatal', 'critical', 'crit', 'emerg', 'alert', 'panic' ]);
function anyMatch(rules: RegExp[], msg: string): boolean {
	for (const re of rules) {
		if (re.test(msg)) return true;
	}
	return false;
}

// Reused across warm invocations so we don't pay TCP/TLS setup per batch.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });

interface CloudWatchLogsEvent {
	awslogs: { data: string };
}

interface DecodedPayload {
	messageType: string;
	logGroup: string;
	logStream: string;
	logEvents: Array<{ id: string; timestamp: number; message: string }>;
}

// Lambda platform lines that are pure noise. REPORT is kept by default (carries duration/memory);
// set FORWARDER_DROP_REPORT=true to drop it too.
const DROP_REPORT = process.env.FORWARDER_DROP_REPORT?.trim() === 'true';
function isPlatformNoise(raw: string): boolean {
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
function stripAnsi(s: string): string {
	return s.includes('\x1b') ? s.replace(ANSI_RE, '') : s;
}

function fallbackLevel(raw: string): string {
	if (/\b(?:ERROR|FATAL)\b/.test(raw)) return 'error';
	if (/\bWARN(?:ING)?\b/.test(raw)) return 'warn';
	return 'info';
}

const KNOWN_LEVELS = new Set([ 'trace', 'debug', 'info', 'warn', 'warning', 'error', 'fatal' ]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// tslog's "pretty" (non-JSON) console format: `YYYY-MM-DD HH:MM:SS.mmm LEVEL rest…`. The date + level
// it prints duplicate what Logtrail already shows in the dedicated TIME/LVL columns — peel them off
// the message like the Lambda-prefix / tslog-JSON branches already do for their own shapes.
const PRETTY_TSLOG_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\s+(.*)$/;

/** Peel a tslog "pretty" `‹date› ‹time› LEVEL ‹rest›` prefix, if the line matches. */
function parsePrettyTslogPrefix(raw: string): { level: string; message: string } | null {
	const m = raw.match(PRETTY_TSLOG_RE);
	if (!m) return null;
	const [ , lvl, rest ] = m;
	const level = lvl.toLowerCase().startsWith('warn') ? 'warn' : lvl.toLowerCase();
	return { level, message: rest };
}

/**
 * AWS Lambda emits text logs as `‹iso›\t‹requestId›\t‹LEVEL›\t‹message›`. Peel that prefix off so the
 * message is just the text, and lift requestId/level out as fields (they're already shown as columns).
 * Returns null if the line isn't in that format.
 */
function parseLambdaPrefix(raw: string): { requestId: string; level: string; message: string } | null {
	const parts = raw.split('\t');
	if (parts.length < 4) return null;
	const [ ts, requestId, lvl, ...rest ] = parts;
	if (!ISO_RE.test(ts) || !KNOWN_LEVELS.has(lvl.trim().toLowerCase())) return null;
	return { requestId, level: lvl.trim().toLowerCase(), message: rest.join('\t').trim() };
}

/**
 * Turn a verbose CloudWatch log-group / log-stream into a short function name for the `host` label,
 * e.g. `…-plusfantrialsstreamprocessor…LogGroup…` → `plusfantrialsstreamprocessor`. Falls back to the
 * raw log group. The full log group is still emitted separately as `logGroup`.
 */
function shortHost(logGroup: string, logStream: string): string {
	// Lambda log stream: "YYYY/MM/DD/<functionName>[$LATEST]<id>" — the cleanest source of the fn name.
	const sm = logStream.match(/^\d{4}\/\d{2}\/\d{2}\/(.+?)\[\$LATEST\]/);
	if (sm && sm[1]) {
		return sm[1].replace(/-[A-Za-z0-9]{6,}$/, ''); // drop the CloudFormation random suffix
	}
	// Fallback: parse the log group — strip the `…LogGroup<hash>-<suffix>` tail, take the last segment,
	// and de-duplicate CDK's doubled construct name (`fooBarfooBar` → `fooBar`).
	let s = logGroup;
	const lg = s.indexOf('LogGroup');
	if (lg > 0) s = s.slice(0, lg);
	const m = s.match(/(?:stack-|NestedStackResource[0-9A-Fa-f]*-)([^-]+)$/);
	if (m) s = m[1];
	if (s.length > 0 && s.length % 2 === 0) {
		const half = s.length / 2;
		if (s.slice(0, half) === s.slice(half)) s = s.slice(0, half);
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
function toVectorRecord(
	e: { timestamp: number; message: string },
	logGroup: string,
	logStream: string,
): Record<string, unknown> | null {
	const raw = (e.message ?? '').replace(/\s+$/, '');

	// ── 1) DROP: Lambda platform lines that are pure noise. ──
	if (isPlatformNoise(raw.trimStart())) {
		return null;
	}

	let message = raw;
	let level: string | undefined;
	let logger: string | undefined;
	let requestId: string | undefined;
	let correlationId: string | undefined;
	let tsIso: string | undefined;
	let lifted: Record<string, string> | undefined;
	let codeLoc: string | undefined;

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
			const o = JSON.parse(body) as Record<string, unknown>;
			const meta = o._meta as {
				name?: unknown; logLevelName?: unknown; date?: unknown; correlationId?: unknown;
				path?: { filePathWithLine?: unknown; fileName?: unknown; fileLine?: unknown };
			} | undefined;
			if (meta && typeof meta === 'object') {
				if (typeof meta.name === 'string') logger = meta.name;
				if (typeof meta.logLevelName === 'string') level = meta.logLevelName.toLowerCase();
				if (typeof meta.date === 'string' && !Number.isNaN(Date.parse(meta.date))) {
					tsIso = new Date(meta.date).toISOString();
				}
				if (typeof meta.correlationId === 'string' && meta.correlationId.trim()) correlationId = meta.correlationId.trim();
				// tslog native source position (mode 'all'): _meta.path.
				const p = meta.path;
				if (p && typeof p === 'object') {
					if (typeof p.filePathWithLine === 'string') codeLoc = p.filePathWithLine;
					else if (typeof p.fileName === 'string' && p.fileLine != null) codeLoc = `${p.fileName}:${p.fileLine}`;
				}
			}
			// Positional args "0".."n" hold the logged message + params. A `{ _srcloc }` arg (mode
			// 'warn-error') carries the caller's source position — lift it, keep it out of the message.
			const parts: string[] = [];
			for (let i = 0; Object.prototype.hasOwnProperty.call(o, String(i)); i++) {
				const v = o[String(i)];
				if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { _srcloc?: unknown })._srcloc === 'string') {
					if (!codeLoc) codeLoc = (v as { _srcloc: string })._srcloc;
					continue;
				}
				parts.push(typeof v === 'string' ? v : JSON.stringify(v));
			}
			if (parts.length > 0) message = parts.join(' ');

			// Lift app-declared structured fields (correlationId, orderId, …) into queryable record fields.
			if (HAS_LIFT_FIELDS) {
				const f = extractLiftedFields(o);
				if (Object.keys(f).length > 0) lifted = f;
			}
		} catch {
			// not JSON after all — keep the (prefix-stripped) message
		}
	} else {
		// ── 1) NORMALIZE: tslog's "pretty" (non-JSON) console format — strip its own duplicate date+level.
		const pretty = parsePrettyTslogPrefix(body);
		if (pretty) {
			if (!level) level = pretty.level;
			message = pretty.message;
		}
	}

	const cleanMessage = stripAnsi(message);
	let resolvedLevel = level ?? fallbackLevel(raw);
	let reclassified: string | undefined;

	// Split the captured source position into queryable `codeFile` + `codeLine` (for "open the exact
	// culprit line" links). Path is made repo-relative (kept from its last `src/` segment).
	let codeFile: string | undefined;
	let codeLine: string | undefined;
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

	const rec: Record<string, unknown> = {
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
	if (DROP_SET.size) for (const k of DROP_SET) delete rec[k];
	return rec;
}

/** Split pre-serialized lines into sub-batches under MAX_BATCH_BYTES (uncompressed). */
function chunkLines(lines: string[]): string[][] {
	const chunks: string[][] = [];
	let current: string[] = [];
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

function encodeBody(lines: string[]): string {
	// lines are already JSON strings
	return BATCH_FORMAT === 'json-array' ? `[${lines.join(',')}]` : lines.join('\n');
}

function post(gzipped: Buffer): Promise<void> {
	return new Promise((resolve, reject) => {
		const url = new URL(INGEST_URL!);
		const isHttps = url.protocol === 'https:';
		const lib = isHttps ? https : http;
		const req = lib.request(
			url,
			{
				method: 'POST',
				agent: isHttps ? httpsAgent : httpAgent,
				headers: {
					'Content-Type': 'application/json',
					'Content-Encoding': 'gzip',
					'Content-Length': gzipped.length,
					...(X_API_KEY ? { 'x-api-key': X_API_KEY } : {}),
				},
			},
			(res) => {
				res.resume(); // drain so the socket can be reused
				const status = res.statusCode ?? 0;
				if (status >= 200 && status < 300) {
					resolve();
				} else {
					reject(new Error(`ingest responded ${status}`));
				}
			},
		);
		req.on('error', reject);
		req.setTimeout(POST_TIMEOUT_MS, () => req.destroy(new Error('ingest timeout')));
		req.end(gzipped);
	});
}

/** POST one chunk with a single retry. Returns false if the chunk was dropped after retries. */
async function shipWithRetry(gzipped: Buffer): Promise<boolean> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			await post(gzipped);
			return true;
		} catch (err) {
			if (attempt === MAX_RETRIES) {
				// Swallow after retries: a persistent ingest outage must not create a CloudWatch retry storm.
				// eslint-disable-next-line no-console
				console.error('[log-forwarder] ship failed, dropping chunk:', (err as Error).message);
				return false;
			}
		}
	}
	return false;
}

/** Emit an alarmable CloudWatch metric (EMF) when records are dropped — no SDK, just structured stdout. */
function emitDroppedMetric(records: number): void {
	// eslint-disable-next-line no-console
	console.log(
		JSON.stringify({
			_aws: {
				Timestamp: Date.now(),
				CloudWatchMetrics: [
					{
						Namespace: 'LogForwarder',
						Dimensions: [ [ 'service' ] ],
						Metrics: [ { Name: 'DroppedRecords', Unit: 'Count' } ],
					},
				],
			},
			service: SERVICE,
			DroppedRecords: records,
		}),
	);
}

interface LambdaContextLike {
	invokedFunctionArn?: string;
}

export const handler = async (event: CloudWatchLogsEvent, context?: LambdaContextLike): Promise<void> => {
	// Resolve the account from this forwarder's own ARN once (same for every invocation).
	if (!RESOLVED_ACCOUNT && context?.invokedFunctionArn) {
		RESOLVED_ACCOUNT = accountFromArn(context.invokedFunctionArn);
	}
	if (!INGEST_URL) {
		return; // not configured yet — no-op (safe to deploy before wiring the ingest URL)
	}

	let payload: DecodedPayload;
	try {
		payload = JSON.parse(gunzipSync(Buffer.from(event.awslogs.data, 'base64')).toString('utf8')) as DecodedPayload;
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error('[log-forwarder] failed to decode payload:', (err as Error).message);
		return;
	}

	if (payload.messageType === 'CONTROL_MESSAGE') {
		return; // subscription liveness ping
	}
	const events = payload.logEvents;
	if (!Array.isArray(events) || events.length === 0) {
		return;
	}

	const lines: string[] = [];
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
		const gzipped = gzipSync(Buffer.from(encodeBody(chunk)));
		const ok = await shipWithRetry(gzipped);
		if (!ok) {
			dropped += chunk.length;
		}
	}
	if (dropped > 0) {
		emitDroppedMetric(dropped);
	}
};
