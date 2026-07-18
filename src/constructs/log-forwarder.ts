import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { Aspects, Duration, RemovalPolicy, Stack, type IAspect } from 'aws-cdk-lib';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { FilterPattern, type IFilterPattern, LogGroup, RetentionDays, SubscriptionFilter } from 'aws-cdk-lib/aws-logs';
import { LambdaDestination } from 'aws-cdk-lib/aws-logs-destinations';
import type { IConstruct } from 'constructs';
import { Fw24 } from '../core/fw24';
import { FW24Construct, FW24ConstructOutput } from '../interfaces/construct';
import { IConstructConfig } from '../interfaces/construct-config';
import { createLogger } from '../logging';

/**
 * App-owned noise / severity rules, applied per log line inside the forwarder Lambda (layers 2–4 of the
 * pipeline; see `LogForwarderConstruct`). Each list is an array of regex source strings, matched
 * case-insensitively against the normalized message. These are complementary to any global severity/
 * noise handling a shared Vector ingest may also run — this layer lets each app own its own rules and,
 * for `drop`, saves ingest bandwidth by removing noise at the source.
 */
export interface LogForwarderNoiseRules {
	/** Error-ish lines matching these are downgraded to `warn` (tagged `reclassified: "benign"`). */
	benign?: string[];
	/** Lines matching these are dropped entirely — never shipped. */
	drop?: string[];
	/** Lines matching these are downgraded to `debug` (tagged `reclassified: "noise"`). */
	downgrade?: string[];
	/**
	 * When true (default), the built-in {@link DEFAULT_LOG_NOISE_RULES} are merged with the lists above.
	 * Set false to use ONLY the lists you provide (or none).
	 */
	useDefaults?: boolean;
}

export interface LogForwarderConstructConfig extends IConstructConfig {
	/** Vector/Logtrail HTTP JSON ingest URL. Defaults to `FORWARDER_INGEST_URL` at deploy time. */
	ingestHttpUrl?: string;
	/** Base `service` label for shipped logs (env is folded in). Defaults to `FORWARDER_SERVICE`. */
	service?: string;
	/**
	 * Stage/owner label (e.g. `develop`, `prod`, `sandbox-nitin`) — folded into the `service` label
	 * (`myservice-develop`) and emitted as `env` so develop/prod/per-developer logs are distinguishable
	 * in Logtrail. Defaults to `FORWARDER_ENV` at deploy time.
	 */
	env?: string;
	/** Optional `x-api-key` when the ingest front requires it. Defaults to `FORWARDER_INGEST_X_API_KEY`. */
	xApiKey?: string;
	/** Batch wire format — must match your Vector http source decoding. Default: `json-array`. */
	batchFormat?: 'ndjson' | 'json-array';
	/** Max uncompressed bytes per POST (the forwarder splits larger batches). Default: 1,000,000. */
	maxBatchBytes?: number;
	/** CloudWatch subscription-filter pattern — the volume/cost lever (e.g. only WARN/ERROR). Default: all events. */
	filterPattern?: IFilterPattern;
	/** Extra function construct-path substrings to skip (never subscribe). */
	excludeFunctionPathSubstrings?: string[];
	/** App-owned noise/severity rules applied inside the forwarder (layers 2–4). */
	noise?: LogForwarderNoiseRules;
	/**
	 * Which construct tree to subscribe.
	 * - `'stack'` (default): the forwarder's stack and any nested stacks under it (covers the common
	 *   satellite app, including per-controller nested stacks parented to the default stack).
	 * - `'app'`: the whole CDK app — use when a backend has independent top-level stacks (e.g. a separate
	 *   `persistent`/data stack). Note this creates cross-stack subscription→forwarder references, so
	 *   verify synth doesn't introduce a cyclic stack dependency.
	 */
	subscribeScope?: 'stack' | 'app';
	/** Forwarder function memory (MB). Default 256. */
	memorySize?: number;
	/** Forwarder function timeout (seconds). Default 30. */
	timeoutSeconds?: number;
	/**
	 * Cap forwarder concurrency to protect the ingest from a log storm. Opt-in: reserving concurrency
	 * subtracts from the account's shared pool, so a bad value can fail deploys in constrained accounts.
	 * Recommended in prod (e.g. 10–20).
	 */
	reservedConcurrency?: number;
	/** Forwarder's own log retention. Default: one week. */
	logRetention?: RetentionDays;
}

/**
 * Curated, generally-safe default noise/severity rules — mirrors the Logtrail Vector "A1" list so a
 * backend gets sensible log hygiene out of the box. Merge-in by default; override via
 * {@link LogForwarderNoiseRules.useDefaults}. Exported so apps can inspect / extend the lists.
 */
export const DEFAULT_LOG_NOISE_RULES: Required<Omit<LogForwarderNoiseRules, 'useDefaults'>> = {
	// Benign "errors" → warn, so error counts stay meaningful.
	benign: [
		'\\bECONNRESET\\b',
		'\\bEPIPE\\b',
		'broken pipe',
		'client (?:closed request|disconnected)',
		'connection reset by peer',
		'context canceled',
		'request aborted',
	],
	// Health/probe noise → dropped.
	drop: [
		'GET /(?:health|healthz|readyz|livez|ping)\\b',
		'\\bkube-probe\\b',
		'ELB-HealthChecker',
	],
	// Low-value noise → debug (kept, de-emphasised).
	downgrade: [
		'deprecation.?warning',
		'/favicon\\.ico',
	],
};

// CDK-internal / custom-resource lambdas we never subscribe (noise + cross-stack singletons),
// plus the forwarder itself (belt-and-suspenders; it is also excluded by reference).
const DEFAULT_SKIP_SUBSTRINGS = [
	'LogRetention',
	'Custom::',
	'framework-onEvent',
	'AWSCDKCfn',
	'BucketNotificationsHandler',
	'Provider',
	'LogForwarder',
];

class LogShippingAspect implements IAspect {
	constructor(
		private readonly forwarder: LambdaFunction,
		private readonly filterPattern: IFilterPattern,
		private readonly skipSubstrings: string[],
	) {}

	visit(node: IConstruct): void {
		if (!(node instanceof LambdaFunction)) {
			return;
		}
		if (node === this.forwarder) {
			return; // never subscribe the forwarder to itself — infinite loop
		}
		const nodePath = node.node.path;
		if (this.skipSubstrings.some((s) => nodePath.includes(s))) {
			return;
		}
		if (node.node.tryFindChild('LogShipSubscription')) {
			return; // aspects can visit a node more than once; add the filter only once
		}
		try {
			new SubscriptionFilter(node, 'LogShipSubscription', {
				logGroup: node.logGroup,
				// addPermissions:false — a single wildcard invoke permission is added on the forwarder in
				// construct(), so we don't accumulate one CfnPermission per log group.
				destination: new LambdaDestination(this.forwarder, { addPermissions: false }),
				filterPattern: this.filterPattern,
			});
		} catch (err) {
			// A lambda without an addressable log group (rare CDK internals) must never break synth.
			// eslint-disable-next-line no-console
			console.warn(`[LogForwarder] skipped ${nodePath}: ${(err as Error).message}`);
		}
	}
}

/**
 * Out-of-band log shipping for every Lambda in the app.
 *
 * Attaches a CloudWatch Logs subscription filter to each function's log group (via an Aspect), routing
 * batched, gzipped events to a single tiny forwarder Lambda that ships them to a Vector/Logtrail HTTP
 * ingest. Nothing runs in the app request path (functions only write stdout), so log volume never
 * degrades request latency and there are no per-log HTTP calls from the handlers.
 *
 * Inside the forwarder, each line runs through a 4-step pipeline: NORMALIZE (peel Lambda prefix, lift
 * fw24 tslog JSON, strip ANSI) → RECLASSIFY benign errors → DROP noise → DOWNGRADE noise. Steps 2–4 are
 * app-owned rule lists (see {@link LogForwarderNoiseRules} / {@link DEFAULT_LOG_NOISE_RULES}).
 *
 * Deploy-time config is read from `FORWARDER_*` env when not passed explicitly. `FORWARDER_*` is used
 * (never `LOGTRAIL_*`) on purpose: setting `LOGTRAIL_*` in the deploy shell would activate fw24's
 * in-process log transport and leak local CDK/synth logs to the ingest.
 */
export class LogForwarderConstruct implements FW24Construct {
	readonly fw24: Fw24 = Fw24.getInstance();
	readonly logger = createLogger(LogForwarderConstruct.name);
	name = LogForwarderConstruct.name;
	dependencies: string[] = [];
	output!: FW24ConstructOutput;
	mainStack!: Stack;

	constructor(private readonly config: LogForwarderConstructConfig = {}) {}

	private resolveNoiseEnv(): Record<string, string> {
		const rules = this.config.noise ?? {};
		const useDefaults = rules.useDefaults !== false;
		const merge = (list: string[] | undefined, defaults: string[]): string[] => {
			const base = useDefaults ? defaults : [];
			// De-dup while preserving order (defaults first, then app additions).
			return [ ...new Set([ ...base, ...(list ?? []) ]) ];
		};
		const benign = merge(rules.benign, DEFAULT_LOG_NOISE_RULES.benign);
		const drop = merge(rules.drop, DEFAULT_LOG_NOISE_RULES.drop);
		const downgrade = merge(rules.downgrade, DEFAULT_LOG_NOISE_RULES.downgrade);
		const env: Record<string, string> = {};
		if (benign.length) env.FORWARDER_NOISE_BENIGN = JSON.stringify(benign);
		if (drop.length) env.FORWARDER_NOISE_DROP = JSON.stringify(drop);
		if (downgrade.length) env.FORWARDER_NOISE_DOWNGRADE = JSON.stringify(downgrade);
		return env;
	}

	async construct(): Promise<void> {
		// Default stack (no hardcoded name) — respects stackName/parentStackName if the app sets them.
		this.mainStack = this.fw24.getStack(this.config.stackName, this.config.parentStackName);
		const o = this.config;

		const forwarderLogGroup = new LogGroup(this.mainStack, 'LogForwarderFunctionLogGroup', {
			retention: o.logRetention ?? RetentionDays.ONE_WEEK,
			removalPolicy: RemovalPolicy.DESTROY,
		});

		const ingestHttpUrl = o.ingestHttpUrl ?? process.env.FORWARDER_INGEST_URL?.trim() ?? '';
		const service = o.service ?? process.env.FORWARDER_SERVICE?.trim() ?? '';
		const env = o.env ?? process.env.FORWARDER_ENV?.trim() ?? '';
		const xApiKey = o.xApiKey ?? process.env.FORWARDER_INGEST_X_API_KEY?.trim();

		if (!ingestHttpUrl) {
			// Non-fatal: the forwarder handler no-ops without an ingest URL, so a backend can adopt the
			// construct before the ingest is wired. Warn so it isn't a silent no-op.
			this.logger.warn(
				'LogForwarderConstruct: no ingest URL (config.ingestHttpUrl / FORWARDER_INGEST_URL). '
					+ 'Forwarder deploys but ships nothing until one is set.',
			);
		}

		// Framework-owned handler shipped compiled in dist (mirrors mailer/dynamo handlers). Resolve the
		// compiled `.js` when installed (dist), falling back to the `.ts` source when running from fw24's
		// own src (unit tests / ts-node dev) where the `.js` hasn't been emitted.
		const handlerBase = path.join(__dirname, '../core/runtime/log-forwarder-handler');
		const handlerEntry = existsSync(`${handlerBase}.js`) ? `${handlerBase}.js` : `${handlerBase}.ts`;

		const forwarder = new NodejsFunction(this.mainStack, 'LogForwarderFunction', {
			entry: handlerEntry,
			handler: 'handler',
			runtime: Runtime.NODEJS_22_X,
			memorySize: o.memorySize ?? 256,
			timeout: Duration.seconds(o.timeoutSeconds ?? 30),
			...(o.reservedConcurrency != null ? { reservedConcurrentExecutions: o.reservedConcurrency } : {}),
			logGroup: forwarderLogGroup,
			bundling: { externalModules: [ '@aws-sdk' ], minify: true },
			// Forwarder runtime env is fully FORWARDER_*-namespaced — no LOGTRAIL_* keys, so it can never
			// collide with fw24's in-process transport.
			environment: {
				FORWARDER_INGEST_URL: ingestHttpUrl,
				FORWARDER_SERVICE: service,
				FORWARDER_ENV: env,
				...(xApiKey ? { FORWARDER_INGEST_X_API_KEY: xApiKey } : {}),
				...(o.batchFormat ? { FORWARDER_BATCH_FORMAT: o.batchFormat } : {}),
				...(o.maxBatchBytes != null ? { FORWARDER_MAX_BATCH_BYTES: String(o.maxBatchBytes) } : {}),
				...this.resolveNoiseEnv(),
			},
		});

		// One broad invoke permission instead of one per log group: keeps the forwarder's resource
		// policy small (Lambda caps it at ~20KB) as the number of subscribed functions grows.
		forwarder.addPermission('AllowCloudWatchLogsInvoke', {
			principal: new ServicePrincipal('logs.amazonaws.com'),
			action: 'lambda:InvokeFunction',
			sourceAccount: this.mainStack.account,
			sourceArn: `arn:aws:logs:${this.mainStack.region}:${this.mainStack.account}:log-group:*`,
		});

		const skip = [ ...DEFAULT_SKIP_SUBSTRINGS, ...(o.excludeFunctionPathSubstrings ?? []) ];
		// 'app' → subscribe every Lambda in the whole CDK app (independent top-level stacks too);
		// 'stack' (default) → this stack + nested stacks under it.
		const scopeRoot: IConstruct =
			o.subscribeScope === 'app' ? this.mainStack.node.root : this.mainStack;
		Aspects.of(scopeRoot).add(
			new LogShippingAspect(forwarder, o.filterPattern ?? FilterPattern.allEvents(), skip),
		);

		this.output = {} as FW24ConstructOutput;
	}
}
