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
exports.LogForwarderConstruct = exports.DEFAULT_DROP_FIELDS = exports.DEFAULT_LIFT_FIELDS = exports.DEFAULT_LOG_NOISE_RULES = void 0;
const path = __importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_logs_destinations_1 = require("aws-cdk-lib/aws-logs-destinations");
const fw24_1 = require("../core/fw24");
const logging_1 = require("../logging");
/**
 * Curated, generally-safe default noise/severity rules — mirrors the Logtrail Vector "A1" list so a
 * backend gets sensible log hygiene out of the box. Merge-in by default; override via
 * {@link LogForwarderNoiseRules.useDefaults}. Exported so apps can inspect / extend the lists.
 */
exports.DEFAULT_LOG_NOISE_RULES = {
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
/**
 * Fields lifted from tslog args into queryable record fields by default. `correlationId` is fw24's
 * cross-service trace id, so lifting it out of the box lets Logtrail follow a request across services
 * the moment an app logs it. Apps add their own business ids (orderId, userId, …) via `liftFields`.
 */
exports.DEFAULT_LIFT_FIELDS = ['correlationId'];
/**
 * Low-value record keys dropped by default to cut ingest/storage size. `host` is derived from
 * logGroup/logStream and kept, so dropping the raw group/stream loses nothing actionable.
 */
exports.DEFAULT_DROP_FIELDS = ['logStream', 'logGroup', 'source_type', 'reason'];
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
class LogShippingAspect {
    forwarder;
    invokePermission;
    filterPattern;
    skipSubstrings;
    constructor(forwarder, invokePermission, filterPattern, skipSubstrings) {
        this.forwarder = forwarder;
        this.invokePermission = invokePermission;
        this.filterPattern = filterPattern;
        this.skipSubstrings = skipSubstrings;
    }
    visit(node) {
        if (!(node instanceof aws_lambda_1.Function)) {
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
            const filter = new aws_logs_1.SubscriptionFilter(node, 'LogShipSubscription', {
                logGroup: node.logGroup,
                // addPermissions:false — a single wildcard invoke permission is added on the forwarder in
                // construct(), so we don't accumulate one CfnPermission per log group.
                destination: new aws_logs_destinations_1.LambdaDestination(this.forwarder, { addPermissions: false }),
                filterPattern: this.filterPattern,
            });
            // CRITICAL: with addPermissions:false there is no automatic dependency between the filter and
            // the (single, wildcard) invoke permission. On a FRESH deploy CloudFormation would otherwise
            // race and create the filter before the permission, so CloudWatch Logs can't invoke the
            // forwarder → "Could not execute the lambda function" 400. Force the ordering explicitly.
            filter.node.addDependency(this.invokePermission);
        }
        catch (err) {
            // A lambda without an addressable log group (rare CDK internals) must never break synth.
            // eslint-disable-next-line no-console
            console.warn(`[LogForwarder] skipped ${nodePath}: ${err.message}`);
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
class LogForwarderConstruct {
    config;
    fw24 = fw24_1.Fw24.getInstance();
    logger = (0, logging_1.createLogger)(LogForwarderConstruct.name);
    name = LogForwarderConstruct.name;
    dependencies = [];
    output;
    mainStack;
    constructor(config = {}) {
        this.config = config;
    }
    resolveNoiseEnv() {
        const rules = this.config.noise ?? {};
        const useDefaults = rules.useDefaults !== false;
        const merge = (list, defaults) => {
            const base = useDefaults ? defaults : [];
            // De-dup while preserving order (defaults first, then app additions).
            return [...new Set([...base, ...(list ?? [])])];
        };
        const benign = merge(rules.benign, exports.DEFAULT_LOG_NOISE_RULES.benign);
        const drop = merge(rules.drop, exports.DEFAULT_LOG_NOISE_RULES.drop);
        const downgrade = merge(rules.downgrade, exports.DEFAULT_LOG_NOISE_RULES.downgrade);
        const env = {};
        if (benign.length)
            env.FORWARDER_NOISE_BENIGN = JSON.stringify(benign);
        if (drop.length)
            env.FORWARDER_NOISE_DROP = JSON.stringify(drop);
        if (downgrade.length)
            env.FORWARDER_NOISE_DOWNGRADE = JSON.stringify(downgrade);
        return env;
    }
    /** App-declared fields to lift, merged with {@link DEFAULT_LIFT_FIELDS} unless liftFieldDefaults is false. */
    /**
     * Resolve the version stamp automatically — no app code or CI wiring to maintain:
     *   explicit config / `FORWARDER_VERSION` → `GITHUB_SHA` (auto in GitHub Actions, first 12) →
     *   the app's package.json version (auto-bumped by release CI, read at synth) → '' (omitted).
     */
    resolveVersion() {
        const explicit = this.config.version?.trim() || process.env.FORWARDER_VERSION?.trim();
        if (explicit)
            return explicit;
        const sha = process.env.GITHUB_SHA?.trim();
        if (sha)
            return sha.slice(0, 12);
        try {
            const pkgPath = path.join(process.cwd(), 'package.json');
            if ((0, node_fs_1.existsSync)(pkgPath)) {
                const pkg = JSON.parse((0, node_fs_1.readFileSync)(pkgPath, 'utf8'));
                if (typeof pkg.version === 'string' && pkg.version.trim())
                    return pkg.version.trim();
            }
        }
        catch {
            /* version is best-effort — never fail synth over it */
        }
        return '';
    }
    resolveLiftFields() {
        const useDefaults = this.config.liftFieldDefaults !== false;
        const base = useDefaults ? exports.DEFAULT_LIFT_FIELDS : [];
        return [...new Set([...base, ...(this.config.liftFields ?? [])].map((s) => s.trim()).filter(Boolean))];
    }
    /** Record keys to drop, merged with {@link DEFAULT_DROP_FIELDS} unless dropFieldDefaults is false. */
    resolveDropFields() {
        const useDefaults = this.config.dropFieldDefaults !== false;
        const base = useDefaults ? exports.DEFAULT_DROP_FIELDS : [];
        return [...new Set([...base, ...(this.config.dropFields ?? [])].map((s) => s.trim()).filter(Boolean))];
    }
    async construct() {
        // Default stack (no hardcoded name) — respects stackName/parentStackName if the app sets them.
        this.mainStack = this.fw24.getStack(this.config.stackName, this.config.parentStackName);
        const o = this.config;
        const forwarderLogGroup = new aws_logs_1.LogGroup(this.mainStack, 'LogForwarderFunctionLogGroup', {
            retention: o.logRetention ?? aws_logs_1.RetentionDays.ONE_WEEK,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        // service/env default to what fw24 already knows (hydrated from APP_NAME / APP_ENVIRONMENT), so a
        // backend usually doesn't pass them. Precedence: explicit option > FORWARDER_* env > fw24 config.
        const cfg = this.fw24.getConfig();
        const ingestHttpUrl = o.ingestHttpUrl ?? process.env.FORWARDER_INGEST_URL?.trim() ?? '';
        const service = o.service ?? (process.env.FORWARDER_SERVICE?.trim() || this.fw24.appName || '');
        const env = o.env ?? (process.env.FORWARDER_ENV?.trim() || cfg.environment || '');
        const xApiKey = o.xApiKey ?? process.env.FORWARDER_INGEST_X_API_KEY?.trim();
        const liftFields = this.resolveLiftFields();
        const dropFields = this.resolveDropFields();
        const version = this.resolveVersion();
        if (!ingestHttpUrl) {
            // Non-fatal: the forwarder handler no-ops without an ingest URL, so a backend can adopt the
            // construct before the ingest is wired. Warn so it isn't a silent no-op.
            this.logger.warn('LogForwarderConstruct: no ingest URL (config.ingestHttpUrl / FORWARDER_INGEST_URL). '
                + 'Forwarder deploys but ships nothing until one is set.');
        }
        // Framework-owned handler shipped compiled in dist (mirrors mailer/dynamo handlers). Resolve the
        // compiled `.js` when installed (dist), falling back to the `.ts` source when running from fw24's
        // own src (unit tests / ts-node dev) where the `.js` hasn't been emitted.
        const handlerBase = path.join(__dirname, '../core/runtime/log-forwarder-handler');
        const handlerEntry = (0, node_fs_1.existsSync)(`${handlerBase}.js`) ? `${handlerBase}.js` : `${handlerBase}.ts`;
        const forwarder = new aws_lambda_nodejs_1.NodejsFunction(this.mainStack, 'LogForwarderFunction', {
            entry: handlerEntry,
            handler: 'handler',
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
            memorySize: o.memorySize ?? 256,
            timeout: aws_cdk_lib_1.Duration.seconds(o.timeoutSeconds ?? 30),
            ...(o.reservedConcurrency != null ? { reservedConcurrentExecutions: o.reservedConcurrency } : {}),
            logGroup: forwarderLogGroup,
            bundling: { externalModules: ['@aws-sdk'], minify: true },
            // Forwarder runtime env is fully FORWARDER_*-namespaced — no LOGTRAIL_* keys, so it can never
            // collide with fw24's in-process transport.
            environment: {
                FORWARDER_INGEST_URL: ingestHttpUrl,
                FORWARDER_SERVICE: service,
                FORWARDER_ENV: env,
                ...(xApiKey ? { FORWARDER_INGEST_X_API_KEY: xApiKey } : {}),
                ...(o.batchFormat ? { FORWARDER_BATCH_FORMAT: o.batchFormat } : {}),
                ...(o.maxBatchBytes != null ? { FORWARDER_MAX_BATCH_BYTES: String(o.maxBatchBytes) } : {}),
                ...(liftFields.length ? { FORWARDER_FIELDS: JSON.stringify(liftFields) } : {}),
                // Always set (even when empty) so the handler drops exactly what the config says, not its own default.
                FORWARDER_DROP_FIELDS: JSON.stringify(dropFields),
                ...(version ? { FORWARDER_VERSION: version } : {}),
                ...this.resolveNoiseEnv(),
            },
        });
        // One broad invoke permission instead of one per log group: keeps the forwarder's resource policy
        // small (Lambda caps it at ~20KB) as the number of subscribed functions grows. Created as an
        // explicit CfnPermission so every subscription filter can `addDependency` on it (the aspect) —
        // without that, a fresh deploy races and creates filters before the permission (a 400).
        const invokePermission = new aws_lambda_1.CfnPermission(forwarder, 'AllowCloudWatchLogsInvoke', {
            principal: 'logs.amazonaws.com',
            action: 'lambda:InvokeFunction',
            functionName: forwarder.functionName,
            sourceAccount: this.mainStack.account,
            sourceArn: `arn:aws:logs:${this.mainStack.region}:${this.mainStack.account}:log-group:*`,
        });
        const skip = [...DEFAULT_SKIP_SUBSTRINGS, ...(o.excludeFunctionPathSubstrings ?? [])];
        // 'app' → subscribe every Lambda in the whole CDK app (independent top-level stacks too);
        // 'stack' (default) → this stack + nested stacks under it.
        const scopeRoot = o.subscribeScope === 'app' ? this.mainStack.node.root : this.mainStack;
        aws_cdk_lib_1.Aspects.of(scopeRoot).add(new LogShippingAspect(forwarder, invokePermission, o.filterPattern ?? aws_logs_1.FilterPattern.allEvents(), skip));
        this.output = {};
    }
}
exports.LogForwarderConstruct = LogForwarderConstruct;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2xvZy1mb3J3YXJkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQWtDO0FBQ2xDLHFDQUFtRDtBQUNuRCw2Q0FBb0Y7QUFDcEYsdURBQTRGO0FBQzVGLHFFQUErRDtBQUMvRCxtREFBdUg7QUFDdkgsNkVBQXNFO0FBRXRFLHVDQUFvQztBQUdwQyx3Q0FBMEM7QUFtRzFDOzs7O0dBSUc7QUFDVSxRQUFBLHVCQUF1QixHQUEwRDtJQUM3RiwyREFBMkQ7SUFDM0QsTUFBTSxFQUFFO1FBQ1Asa0JBQWtCO1FBQ2xCLGFBQWE7UUFDYixhQUFhO1FBQ2Isd0NBQXdDO1FBQ3hDLDBCQUEwQjtRQUMxQixrQkFBa0I7UUFDbEIsaUJBQWlCO0tBQ2pCO0lBQ0QsZ0NBQWdDO0lBQ2hDLElBQUksRUFBRTtRQUNMLDhDQUE4QztRQUM5QyxrQkFBa0I7UUFDbEIsbUJBQW1CO0tBQ25CO0lBQ0QsaURBQWlEO0lBQ2pELFNBQVMsRUFBRTtRQUNWLHNCQUFzQjtRQUN0QixnQkFBZ0I7S0FDaEI7Q0FDRCxDQUFDO0FBRUY7Ozs7R0FJRztBQUNVLFFBQUEsbUJBQW1CLEdBQUcsQ0FBRSxlQUFlLENBQUUsQ0FBQztBQUV2RDs7O0dBR0c7QUFDVSxRQUFBLG1CQUFtQixHQUFHLENBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxhQUFhLEVBQUUsUUFBUSxDQUFFLENBQUM7QUFFeEYsOEZBQThGO0FBQzlGLHFGQUFxRjtBQUNyRixNQUFNLHVCQUF1QixHQUFHO0lBQy9CLGNBQWM7SUFDZCxVQUFVO0lBQ1YsbUJBQW1CO0lBQ25CLFdBQVc7SUFDWCw0QkFBNEI7SUFDNUIsVUFBVTtJQUNWLGNBQWM7Q0FDZCxDQUFDO0FBRUYsTUFBTSxpQkFBaUI7SUFFSjtJQUNBO0lBQ0E7SUFDQTtJQUpsQixZQUNrQixTQUF5QixFQUN6QixnQkFBNEIsRUFDNUIsYUFBNkIsRUFDN0IsY0FBd0I7UUFIeEIsY0FBUyxHQUFULFNBQVMsQ0FBZ0I7UUFDekIscUJBQWdCLEdBQWhCLGdCQUFnQixDQUFZO1FBQzVCLGtCQUFhLEdBQWIsYUFBYSxDQUFnQjtRQUM3QixtQkFBYyxHQUFkLGNBQWMsQ0FBVTtJQUN2QyxDQUFDO0lBRUosS0FBSyxDQUFDLElBQWdCO1FBQ3JCLElBQUksQ0FBQyxDQUFDLElBQUksWUFBWSxxQkFBYyxDQUFDLEVBQUUsQ0FBQztZQUN2QyxPQUFPO1FBQ1IsQ0FBQztRQUNELElBQUksSUFBSSxLQUFLLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUM3QixPQUFPLENBQUMsMERBQTBEO1FBQ25FLENBQUM7UUFDRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztRQUNoQyxJQUFJLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUMzRCxPQUFPO1FBQ1IsQ0FBQztRQUNELElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMscUJBQXFCLENBQUMsRUFBRSxDQUFDO1lBQ25ELE9BQU8sQ0FBQyxvRUFBb0U7UUFDN0UsQ0FBQztRQUNELElBQUksQ0FBQztZQUNKLE1BQU0sTUFBTSxHQUFHLElBQUksNkJBQWtCLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO2dCQUNsRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVE7Z0JBQ3ZCLDBGQUEwRjtnQkFDMUYsdUVBQXVFO2dCQUN2RSxXQUFXLEVBQUUsSUFBSSx5Q0FBaUIsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEVBQUUsY0FBYyxFQUFFLEtBQUssRUFBRSxDQUFDO2dCQUM3RSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7YUFDakMsQ0FBQyxDQUFDO1lBQ0gsOEZBQThGO1lBQzlGLDZGQUE2RjtZQUM3Rix3RkFBd0Y7WUFDeEYsMEZBQTBGO1lBQzFGLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ2xELENBQUM7UUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1lBQ2QseUZBQXlGO1lBQ3pGLHNDQUFzQztZQUN0QyxPQUFPLENBQUMsSUFBSSxDQUFDLDBCQUEwQixRQUFRLEtBQU0sR0FBYSxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFDL0UsQ0FBQztJQUNGLENBQUM7Q0FDRDtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7R0FlRztBQUNILE1BQWEscUJBQXFCO0lBUUo7SUFQcEIsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNoQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzNELElBQUksR0FBRyxxQkFBcUIsQ0FBQyxJQUFJLENBQUM7SUFDbEMsWUFBWSxHQUFhLEVBQUUsQ0FBQztJQUM1QixNQUFNLENBQXVCO0lBQzdCLFNBQVMsQ0FBUztJQUVsQixZQUE2QixTQUFzQyxFQUFFO1FBQXhDLFdBQU0sR0FBTixNQUFNLENBQWtDO0lBQUcsQ0FBQztJQUVqRSxlQUFlO1FBQ3RCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQztRQUN0QyxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsV0FBVyxLQUFLLEtBQUssQ0FBQztRQUNoRCxNQUFNLEtBQUssR0FBRyxDQUFDLElBQTBCLEVBQUUsUUFBa0IsRUFBWSxFQUFFO1lBQzFFLE1BQU0sSUFBSSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDekMsc0VBQXNFO1lBQ3RFLE9BQU8sQ0FBRSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUUsR0FBRyxJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsQ0FBRSxDQUFDLENBQUUsQ0FBQztRQUNyRCxDQUFDLENBQUM7UUFDRixNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSwrQkFBdUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNuRSxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSwrQkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUM3RCxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRSwrQkFBdUIsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUM1RSxNQUFNLEdBQUcsR0FBMkIsRUFBRSxDQUFDO1FBQ3ZDLElBQUksTUFBTSxDQUFDLE1BQU07WUFBRSxHQUFHLENBQUMsc0JBQXNCLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN2RSxJQUFJLElBQUksQ0FBQyxNQUFNO1lBQUUsR0FBRyxDQUFDLG9CQUFvQixHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDakUsSUFBSSxTQUFTLENBQUMsTUFBTTtZQUFFLEdBQUcsQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ2hGLE9BQU8sR0FBRyxDQUFDO0lBQ1osQ0FBQztJQUVELDhHQUE4RztJQUM5Rzs7OztPQUlHO0lBQ0ssY0FBYztRQUNyQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLElBQUksRUFBRSxDQUFDO1FBQ3RGLElBQUksUUFBUTtZQUFFLE9BQU8sUUFBUSxDQUFDO1FBQzlCLE1BQU0sR0FBRyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxDQUFDO1FBQzNDLElBQUksR0FBRztZQUFFLE9BQU8sR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakMsSUFBSSxDQUFDO1lBQ0osTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsY0FBYyxDQUFDLENBQUM7WUFDekQsSUFBSSxJQUFBLG9CQUFVLEVBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDekIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFBLHNCQUFZLEVBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUEwQixDQUFDO2dCQUMvRSxJQUFJLE9BQU8sR0FBRyxDQUFDLE9BQU8sS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUU7b0JBQUUsT0FBTyxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3RGLENBQUM7UUFDRixDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1IsdURBQXVEO1FBQ3hELENBQUM7UUFDRCxPQUFPLEVBQUUsQ0FBQztJQUNYLENBQUM7SUFFTyxpQkFBaUI7UUFDeEIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsS0FBSyxLQUFLLENBQUM7UUFDNUQsTUFBTSxJQUFJLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQywyQkFBbUIsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3BELE9BQU8sQ0FBRSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUUsR0FBRyxJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQyxDQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBRSxDQUFDO0lBQzVHLENBQUM7SUFFRCxzR0FBc0c7SUFDOUYsaUJBQWlCO1FBQ3hCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEtBQUssS0FBSyxDQUFDO1FBQzVELE1BQU0sSUFBSSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsMkJBQW1CLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUNwRCxPQUFPLENBQUUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFFLEdBQUcsSUFBSSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUMsQ0FBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUUsQ0FBQztJQUM1RyxDQUFDO0lBRUQsS0FBSyxDQUFDLFNBQVM7UUFDZCwrRkFBK0Y7UUFDL0YsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQ3hGLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7UUFFdEIsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLG1CQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSw4QkFBOEIsRUFBRTtZQUN0RixTQUFTLEVBQUUsQ0FBQyxDQUFDLFlBQVksSUFBSSx3QkFBYSxDQUFDLFFBQVE7WUFDbkQsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FBTztTQUNwQyxDQUFDLENBQUM7UUFFSCxrR0FBa0c7UUFDbEcsa0dBQWtHO1FBQ2xHLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDbEMsTUFBTSxhQUFhLEdBQUcsQ0FBQyxDQUFDLGFBQWEsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQztRQUN4RixNQUFNLE9BQU8sR0FBRyxDQUFDLENBQUMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNoRyxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsSUFBSSxFQUFFLElBQUksR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNsRixNQUFNLE9BQU8sR0FBRyxDQUFDLENBQUMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLEVBQUUsSUFBSSxFQUFFLENBQUM7UUFDNUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDNUMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDNUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBRXRDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNwQiw0RkFBNEY7WUFDNUYseUVBQXlFO1lBQ3pFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUNmLHNGQUFzRjtrQkFDbkYsdURBQXVELENBQzFELENBQUM7UUFDSCxDQUFDO1FBRUQsaUdBQWlHO1FBQ2pHLGtHQUFrRztRQUNsRywwRUFBMEU7UUFDMUUsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsdUNBQXVDLENBQUMsQ0FBQztRQUNsRixNQUFNLFlBQVksR0FBRyxJQUFBLG9CQUFVLEVBQUMsR0FBRyxXQUFXLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLFdBQVcsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLFdBQVcsS0FBSyxDQUFDO1FBRWpHLE1BQU0sU0FBUyxHQUFHLElBQUksa0NBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLHNCQUFzQixFQUFFO1lBQzVFLEtBQUssRUFBRSxZQUFZO1lBQ25CLE9BQU8sRUFBRSxTQUFTO1lBQ2xCLE9BQU8sRUFBRSxvQkFBTyxDQUFDLFdBQVc7WUFDNUIsVUFBVSxFQUFFLENBQUMsQ0FBQyxVQUFVLElBQUksR0FBRztZQUMvQixPQUFPLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUM7WUFDakQsR0FBRyxDQUFDLENBQUMsQ0FBQyxtQkFBbUIsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsNEJBQTRCLEVBQUUsQ0FBQyxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNqRyxRQUFRLEVBQUUsaUJBQWlCO1lBQzNCLFFBQVEsRUFBRSxFQUFFLGVBQWUsRUFBRSxDQUFFLFVBQVUsQ0FBRSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUU7WUFDM0QsOEZBQThGO1lBQzlGLDRDQUE0QztZQUM1QyxXQUFXLEVBQUU7Z0JBQ1osb0JBQW9CLEVBQUUsYUFBYTtnQkFDbkMsaUJBQWlCLEVBQUUsT0FBTztnQkFDMUIsYUFBYSxFQUFFLEdBQUc7Z0JBQ2xCLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsMEJBQTBCLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDM0QsR0FBRyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUUsc0JBQXNCLEVBQUUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ25FLEdBQUcsQ0FBQyxDQUFDLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSx5QkFBeUIsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDMUYsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQzlFLHVHQUF1RztnQkFDdkcscUJBQXFCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUM7Z0JBQ2pELEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsaUJBQWlCLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDbEQsR0FBRyxJQUFJLENBQUMsZUFBZSxFQUFFO2FBQ3pCO1NBQ0QsQ0FBQyxDQUFDO1FBRUgsa0dBQWtHO1FBQ2xHLDZGQUE2RjtRQUM3RiwrRkFBK0Y7UUFDL0Ysd0ZBQXdGO1FBQ3hGLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSwwQkFBYSxDQUFDLFNBQVMsRUFBRSwyQkFBMkIsRUFBRTtZQUNsRixTQUFTLEVBQUUsb0JBQW9CO1lBQy9CLE1BQU0sRUFBRSx1QkFBdUI7WUFDL0IsWUFBWSxFQUFFLFNBQVMsQ0FBQyxZQUFZO1lBQ3BDLGFBQWEsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU87WUFDckMsU0FBUyxFQUFFLGdCQUFnQixJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sY0FBYztTQUN4RixDQUFDLENBQUM7UUFFSCxNQUFNLElBQUksR0FBRyxDQUFFLEdBQUcsdUJBQXVCLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsSUFBSSxFQUFFLENBQUMsQ0FBRSxDQUFDO1FBQ3hGLDBGQUEwRjtRQUMxRiwyREFBMkQ7UUFDM0QsTUFBTSxTQUFTLEdBQ2QsQ0FBQyxDQUFDLGNBQWMsS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztRQUN4RSxxQkFBTyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxHQUFHLENBQ3hCLElBQUksaUJBQWlCLENBQUMsU0FBUyxFQUFFLGdCQUFnQixFQUFFLENBQUMsQ0FBQyxhQUFhLElBQUksd0JBQWEsQ0FBQyxTQUFTLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FDdEcsQ0FBQztRQUVGLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBeUIsQ0FBQztJQUN6QyxDQUFDO0NBQ0Q7QUFySkQsc0RBcUpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgZXhpc3RzU3luYywgcmVhZEZpbGVTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBBc3BlY3RzLCBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2ssIHR5cGUgSUFzcGVjdCB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENmblBlcm1pc3Npb24sIEZ1bmN0aW9uIGFzIExhbWJkYUZ1bmN0aW9uLCBSdW50aW1lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCB7IEZpbHRlclBhdHRlcm4sIHR5cGUgSUZpbHRlclBhdHRlcm4sIExvZ0dyb3VwLCBSZXRlbnRpb25EYXlzLCBTdWJzY3JpcHRpb25GaWx0ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBMYW1iZGFEZXN0aW5hdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzLWRlc3RpbmF0aW9ucyc7XG5pbXBvcnQgdHlwZSB7IElDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uc3RydWN0JztcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWcnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5cbi8qKlxuICogQXBwLW93bmVkIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMsIGFwcGxpZWQgcGVyIGxvZyBsaW5lIGluc2lkZSB0aGUgZm9yd2FyZGVyIExhbWJkYSAobGF5ZXJzIDLigJM0IG9mIHRoZVxuICogcGlwZWxpbmU7IHNlZSBgTG9nRm9yd2FyZGVyQ29uc3RydWN0YCkuIEVhY2ggbGlzdCBpcyBhbiBhcnJheSBvZiByZWdleCBzb3VyY2Ugc3RyaW5ncywgbWF0Y2hlZFxuICogY2FzZS1pbnNlbnNpdGl2ZWx5IGFnYWluc3QgdGhlIG5vcm1hbGl6ZWQgbWVzc2FnZS4gVGhlc2UgYXJlIGNvbXBsZW1lbnRhcnkgdG8gYW55IGdsb2JhbCBzZXZlcml0eS9cbiAqIG5vaXNlIGhhbmRsaW5nIGEgc2hhcmVkIFZlY3RvciBpbmdlc3QgbWF5IGFsc28gcnVuIOKAlCB0aGlzIGxheWVyIGxldHMgZWFjaCBhcHAgb3duIGl0cyBvd24gcnVsZXMgYW5kLFxuICogZm9yIGBkcm9wYCwgc2F2ZXMgaW5nZXN0IGJhbmR3aWR0aCBieSByZW1vdmluZyBub2lzZSBhdCB0aGUgc291cmNlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExvZ0ZvcndhcmRlck5vaXNlUnVsZXMge1xuXHQvKiogRXJyb3ItaXNoIGxpbmVzIG1hdGNoaW5nIHRoZXNlIGFyZSBkb3duZ3JhZGVkIHRvIGB3YXJuYCAodGFnZ2VkIGByZWNsYXNzaWZpZWQ6IFwiYmVuaWduXCJgKS4gKi9cblx0YmVuaWduPzogc3RyaW5nW107XG5cdC8qKiBMaW5lcyBtYXRjaGluZyB0aGVzZSBhcmUgZHJvcHBlZCBlbnRpcmVseSDigJQgbmV2ZXIgc2hpcHBlZC4gKi9cblx0ZHJvcD86IHN0cmluZ1tdO1xuXHQvKiogTGluZXMgbWF0Y2hpbmcgdGhlc2UgYXJlIGRvd25ncmFkZWQgdG8gYGRlYnVnYCAodGFnZ2VkIGByZWNsYXNzaWZpZWQ6IFwibm9pc2VcImApLiAqL1xuXHRkb3duZ3JhZGU/OiBzdHJpbmdbXTtcblx0LyoqXG5cdCAqIFdoZW4gdHJ1ZSAoZGVmYXVsdCksIHRoZSBidWlsdC1pbiB7QGxpbmsgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVN9IGFyZSBtZXJnZWQgd2l0aCB0aGUgbGlzdHMgYWJvdmUuXG5cdCAqIFNldCBmYWxzZSB0byB1c2UgT05MWSB0aGUgbGlzdHMgeW91IHByb3ZpZGUgKG9yIG5vbmUpLlxuXHQgKi9cblx0dXNlRGVmYXVsdHM/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIExvZ0ZvcndhcmRlckNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuXHQvKiogVmVjdG9yL0xvZ3RyYWlsIEhUVFAgSlNPTiBpbmdlc3QgVVJMLiBEZWZhdWx0cyB0byBgRk9SV0FSREVSX0lOR0VTVF9VUkxgIGF0IGRlcGxveSB0aW1lLiAqL1xuXHRpbmdlc3RIdHRwVXJsPzogc3RyaW5nO1xuXHQvKipcblx0ICogQmFzZSBgc2VydmljZWAgbGFiZWwgZm9yIHNoaXBwZWQgbG9ncyAoZW52IGlzIGZvbGRlZCBpbikuIFVzdWFsbHkgb21pdCDigJQgZGVmYXVsdHMgdG8gdGhlIGZ3MjRcblx0ICogYXBwIG5hbWUgKGBBUFBfTkFNRWApOyBvdmVycmlkZSB3aXRoIHRoaXMgb3B0aW9uIG9yIGBGT1JXQVJERVJfU0VSVklDRWAuXG5cdCAqL1xuXHRzZXJ2aWNlPzogc3RyaW5nO1xuXHQvKipcblx0ICogU3RhZ2Uvb3duZXIgbGFiZWwgKGUuZy4gYGRldmVsb3BgLCBgcHJvZGAsIGBzYW5kYm94LW5pdGluYCkg4oCUIGZvbGRlZCBpbnRvIHRoZSBgc2VydmljZWAgbGFiZWxcblx0ICogKGBteXNlcnZpY2UtZGV2ZWxvcGApIGFuZCBlbWl0dGVkIGFzIGBlbnZgIHNvIGRldmVsb3AvcHJvZC9wZXItZGV2ZWxvcGVyIGxvZ3MgYXJlIGRpc3Rpbmd1aXNoYWJsZVxuXHQgKiBpbiBMb2d0cmFpbC4gVXN1YWxseSBvbWl0IOKAlCBkZWZhdWx0cyB0byB0aGUgZncyNCBlbnZpcm9ubWVudCAoYEFQUF9FTlZJUk9OTUVOVGApOyBvdmVycmlkZSB3aXRoXG5cdCAqIHRoaXMgb3B0aW9uIG9yIGBGT1JXQVJERVJfRU5WYC5cblx0ICovXG5cdGVudj86IHN0cmluZztcblx0LyoqIE9wdGlvbmFsIGB4LWFwaS1rZXlgIHdoZW4gdGhlIGluZ2VzdCBmcm9udCByZXF1aXJlcyBpdC4gRGVmYXVsdHMgdG8gYEZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZYC4gKi9cblx0eEFwaUtleT86IHN0cmluZztcblx0LyoqIEJhdGNoIHdpcmUgZm9ybWF0IOKAlCBtdXN0IG1hdGNoIHlvdXIgVmVjdG9yIGh0dHAgc291cmNlIGRlY29kaW5nLiBEZWZhdWx0OiBganNvbi1hcnJheWAuICovXG5cdGJhdGNoRm9ybWF0PzogJ25kanNvbicgfCAnanNvbi1hcnJheSc7XG5cdC8qKiBNYXggdW5jb21wcmVzc2VkIGJ5dGVzIHBlciBQT1NUICh0aGUgZm9yd2FyZGVyIHNwbGl0cyBsYXJnZXIgYmF0Y2hlcykuIERlZmF1bHQ6IDEsMDAwLDAwMC4gKi9cblx0bWF4QmF0Y2hCeXRlcz86IG51bWJlcjtcblx0LyoqIENsb3VkV2F0Y2ggc3Vic2NyaXB0aW9uLWZpbHRlciBwYXR0ZXJuIOKAlCB0aGUgdm9sdW1lL2Nvc3QgbGV2ZXIgKGUuZy4gb25seSBXQVJOL0VSUk9SKS4gRGVmYXVsdDogYWxsIGV2ZW50cy4gKi9cblx0ZmlsdGVyUGF0dGVybj86IElGaWx0ZXJQYXR0ZXJuO1xuXHQvKiogRXh0cmEgZnVuY3Rpb24gY29uc3RydWN0LXBhdGggc3Vic3RyaW5ncyB0byBza2lwIChuZXZlciBzdWJzY3JpYmUpLiAqL1xuXHRleGNsdWRlRnVuY3Rpb25QYXRoU3Vic3RyaW5ncz86IHN0cmluZ1tdO1xuXHQvKiogQXBwLW93bmVkIG5vaXNlL3NldmVyaXR5IHJ1bGVzIGFwcGxpZWQgaW5zaWRlIHRoZSBmb3J3YXJkZXIgKGxheWVycyAy4oCTNCkuICovXG5cdG5vaXNlPzogTG9nRm9yd2FyZGVyTm9pc2VSdWxlcztcblx0LyoqXG5cdCAqIFN0cnVjdHVyZWQgZmllbGRzIHRvIGxpZnQgZnJvbSB0c2xvZyBhcmdzIGludG8gcXVlcnlhYmxlIHRvcC1sZXZlbCByZWNvcmQgZmllbGRzLCBzbyBMb2d0cmFpbCBjYW5cblx0ICogZm9sbG93IG9uZSByZXF1ZXN0IGFjcm9zcyBzZXJ2aWNlcyBvciBmaWx0ZXIgXCJhbGwgbG9ncyBmb3Igb3JkZXIgOTkxXCIuIE9ubHkgZmllbGRzIHRoZSBhcHAgYWN0dWFsbHlcblx0ICogbG9ncyBhcyBzdHJ1Y3R1cmVkIGFyZ3MgKGUuZy4gYGxvZ2dlci5pbmZvKCdjaGFyZ2UgZmFpbGVkJywgeyBvcmRlcklkLCBjb3JyZWxhdGlvbklkIH0pYCkgYXJlIGxpZnRlZFxuXHQgKiDigJQgdGhlIGZvcndhcmRlciBuZXZlciBzY3JhcGVzIGZyZWUgdGV4dC4ge0BsaW5rIERFRkFVTFRfTElGVF9GSUVMRFN9IChjb3JyZWxhdGlvbklkKSBpcyBtZXJnZWQgaW5cblx0ICogdW5sZXNzIHtAbGluayBsaWZ0RmllbGREZWZhdWx0c30gaXMgZmFsc2UuXG5cdCAqL1xuXHRsaWZ0RmllbGRzPzogc3RyaW5nW107XG5cdC8qKiBNZXJnZSB7QGxpbmsgREVGQVVMVF9MSUZUX0ZJRUxEU30gd2l0aCB7QGxpbmsgbGlmdEZpZWxkc30uIERlZmF1bHQgdHJ1ZS4gU2V0IGZhbHNlIHRvIGxpZnQgT05MWSB5b3VyIGxpc3QuICovXG5cdGxpZnRGaWVsZERlZmF1bHRzPzogYm9vbGVhbjtcblx0LyoqXG5cdCAqIFJlY29yZCBrZXlzIHRvIERST1AgYmVmb3JlIHNoaXBwaW5nLCB0byBjdXQgaW5nZXN0L3N0b3JhZ2Ugc2l6ZSBvbiBsb3ctdmFsdWUgZmllbGRzLiBNZXJnZWQgd2l0aFxuXHQgKiB7QGxpbmsgREVGQVVMVF9EUk9QX0ZJRUxEU30gKGxvZ1N0cmVhbSwgbG9nR3JvdXAsIHNvdXJjZV90eXBlLCByZWFzb24pIHVubGVzcyB7QGxpbmsgZHJvcEZpZWxkRGVmYXVsdHN9XG5cdCAqIGlzIGZhbHNlLiBgaG9zdGAgKGRlcml2ZWQgZnJvbSBsb2dHcm91cC9sb2dTdHJlYW0pIGlzIGFsd2F5cyBrZXB0LCBhbmQgY29yZSBrZXlzIGNhbiBuZXZlciBiZSBkcm9wcGVkLlxuXHQgKi9cblx0ZHJvcEZpZWxkcz86IHN0cmluZ1tdO1xuXHQvKiogTWVyZ2Uge0BsaW5rIERFRkFVTFRfRFJPUF9GSUVMRFN9IHdpdGgge0BsaW5rIGRyb3BGaWVsZHN9LiBEZWZhdWx0IHRydWUuIFNldCBmYWxzZSB0byBkcm9wIE9OTFkgeW91ciBsaXN0LiAqL1xuXHRkcm9wRmllbGREZWZhdWx0cz86IGJvb2xlYW47XG5cdC8qKlxuXHQgKiBSZWxlYXNlL3ZlcnNpb24gc3RhbXBlZCBvbiBldmVyeSBzaGlwcGVkIGxpbmUgKGB2ZXJzaW9uYCBmaWVsZCkgc28gYmVoYXZpb3IgY2hhbmdlcyBjYW4gYmUgYXR0cmlidXRlZFxuXHQgKiB0byBhIGRlcGxveS4gUmVzb2x2ZWQgQVVUT01BVElDQUxMWSBzbyBuZWl0aGVyIHRoZSBhcHAgbm9yIENJIGhhcyB0byBtYWludGFpbiBpdCAoc2VlXG5cdCAqIHtAbGluayBMb2dGb3J3YXJkZXJDb25zdHJ1Y3QucmVzb2x2ZVZlcnNpb259KTogZXhwbGljaXQgdmFsdWUgLyBgRk9SV0FSREVSX1ZFUlNJT05gIOKGkiB0aGUgQ0kgY29tbWl0XG5cdCAqIChgR0lUSFVCX1NIQWAsIHNldCBhdXRvbWF0aWNhbGx5IGJ5IEdpdEh1YiBBY3Rpb25zKSDihpIgdGhlIGFwcCdzIGBwYWNrYWdlLmpzb25gIHZlcnNpb24g4oaSIG9taXR0ZWQuXG5cdCAqIE9ubHkgc2V0IHRoaXMgdG8gZm9yY2UgYSBzcGVjaWZpYyB2YWx1ZS5cblx0ICovXG5cdHZlcnNpb24/OiBzdHJpbmc7XG5cdC8qKlxuXHQgKiBXaGljaCBjb25zdHJ1Y3QgdHJlZSB0byBzdWJzY3JpYmUuXG5cdCAqIC0gYCdzdGFjaydgIChkZWZhdWx0KTogdGhlIGZvcndhcmRlcidzIHN0YWNrIGFuZCBhbnkgbmVzdGVkIHN0YWNrcyB1bmRlciBpdCAoY292ZXJzIHRoZSBjb21tb25cblx0ICogICBzYXRlbGxpdGUgYXBwLCBpbmNsdWRpbmcgcGVyLWNvbnRyb2xsZXIgbmVzdGVkIHN0YWNrcyBwYXJlbnRlZCB0byB0aGUgZGVmYXVsdCBzdGFjaykuXG5cdCAqIC0gYCdhcHAnYDogdGhlIHdob2xlIENESyBhcHAg4oCUIHVzZSB3aGVuIGEgYmFja2VuZCBoYXMgaW5kZXBlbmRlbnQgdG9wLWxldmVsIHN0YWNrcyAoZS5nLiBhIHNlcGFyYXRlXG5cdCAqICAgYHBlcnNpc3RlbnRgL2RhdGEgc3RhY2spLiBOb3RlIHRoaXMgY3JlYXRlcyBjcm9zcy1zdGFjayBzdWJzY3JpcHRpb27ihpJmb3J3YXJkZXIgcmVmZXJlbmNlcywgc29cblx0ICogICB2ZXJpZnkgc3ludGggZG9lc24ndCBpbnRyb2R1Y2UgYSBjeWNsaWMgc3RhY2sgZGVwZW5kZW5jeS5cblx0ICovXG5cdHN1YnNjcmliZVNjb3BlPzogJ3N0YWNrJyB8ICdhcHAnO1xuXHQvKiogRm9yd2FyZGVyIGZ1bmN0aW9uIG1lbW9yeSAoTUIpLiBEZWZhdWx0IDI1Ni4gKi9cblx0bWVtb3J5U2l6ZT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlciBmdW5jdGlvbiB0aW1lb3V0IChzZWNvbmRzKS4gRGVmYXVsdCAzMC4gKi9cblx0dGltZW91dFNlY29uZHM/OiBudW1iZXI7XG5cdC8qKlxuXHQgKiBDYXAgZm9yd2FyZGVyIGNvbmN1cnJlbmN5IHRvIHByb3RlY3QgdGhlIGluZ2VzdCBmcm9tIGEgbG9nIHN0b3JtLiBPcHQtaW46IHJlc2VydmluZyBjb25jdXJyZW5jeVxuXHQgKiBzdWJ0cmFjdHMgZnJvbSB0aGUgYWNjb3VudCdzIHNoYXJlZCBwb29sLCBzbyBhIGJhZCB2YWx1ZSBjYW4gZmFpbCBkZXBsb3lzIGluIGNvbnN0cmFpbmVkIGFjY291bnRzLlxuXHQgKiBSZWNvbW1lbmRlZCBpbiBwcm9kIChlLmcuIDEw4oCTMjApLlxuXHQgKi9cblx0cmVzZXJ2ZWRDb25jdXJyZW5jeT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlcidzIG93biBsb2cgcmV0ZW50aW9uLiBEZWZhdWx0OiBvbmUgd2Vlay4gKi9cblx0bG9nUmV0ZW50aW9uPzogUmV0ZW50aW9uRGF5cztcbn1cblxuLyoqXG4gKiBDdXJhdGVkLCBnZW5lcmFsbHktc2FmZSBkZWZhdWx0IG5vaXNlL3NldmVyaXR5IHJ1bGVzIOKAlCBtaXJyb3JzIHRoZSBMb2d0cmFpbCBWZWN0b3IgXCJBMVwiIGxpc3Qgc28gYVxuICogYmFja2VuZCBnZXRzIHNlbnNpYmxlIGxvZyBoeWdpZW5lIG91dCBvZiB0aGUgYm94LiBNZXJnZS1pbiBieSBkZWZhdWx0OyBvdmVycmlkZSB2aWFcbiAqIHtAbGluayBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLnVzZURlZmF1bHRzfS4gRXhwb3J0ZWQgc28gYXBwcyBjYW4gaW5zcGVjdCAvIGV4dGVuZCB0aGUgbGlzdHMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUzogUmVxdWlyZWQ8T21pdDxMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLCAndXNlRGVmYXVsdHMnPj4gPSB7XG5cdC8vIEJlbmlnbiBcImVycm9yc1wiIOKGkiB3YXJuLCBzbyBlcnJvciBjb3VudHMgc3RheSBtZWFuaW5nZnVsLlxuXHRiZW5pZ246IFtcblx0XHQnXFxcXGJFQ09OTlJFU0VUXFxcXGInLFxuXHRcdCdcXFxcYkVQSVBFXFxcXGInLFxuXHRcdCdicm9rZW4gcGlwZScsXG5cdFx0J2NsaWVudCAoPzpjbG9zZWQgcmVxdWVzdHxkaXNjb25uZWN0ZWQpJyxcblx0XHQnY29ubmVjdGlvbiByZXNldCBieSBwZWVyJyxcblx0XHQnY29udGV4dCBjYW5jZWxlZCcsXG5cdFx0J3JlcXVlc3QgYWJvcnRlZCcsXG5cdF0sXG5cdC8vIEhlYWx0aC9wcm9iZSBub2lzZSDihpIgZHJvcHBlZC5cblx0ZHJvcDogW1xuXHRcdCdHRVQgLyg/OmhlYWx0aHxoZWFsdGh6fHJlYWR5enxsaXZlenxwaW5nKVxcXFxiJyxcblx0XHQnXFxcXGJrdWJlLXByb2JlXFxcXGInLFxuXHRcdCdFTEItSGVhbHRoQ2hlY2tlcicsXG5cdF0sXG5cdC8vIExvdy12YWx1ZSBub2lzZSDihpIgZGVidWcgKGtlcHQsIGRlLWVtcGhhc2lzZWQpLlxuXHRkb3duZ3JhZGU6IFtcblx0XHQnZGVwcmVjYXRpb24uP3dhcm5pbmcnLFxuXHRcdCcvZmF2aWNvblxcXFwuaWNvJyxcblx0XSxcbn07XG5cbi8qKlxuICogRmllbGRzIGxpZnRlZCBmcm9tIHRzbG9nIGFyZ3MgaW50byBxdWVyeWFibGUgcmVjb3JkIGZpZWxkcyBieSBkZWZhdWx0LiBgY29ycmVsYXRpb25JZGAgaXMgZncyNCdzXG4gKiBjcm9zcy1zZXJ2aWNlIHRyYWNlIGlkLCBzbyBsaWZ0aW5nIGl0IG91dCBvZiB0aGUgYm94IGxldHMgTG9ndHJhaWwgZm9sbG93IGEgcmVxdWVzdCBhY3Jvc3Mgc2VydmljZXNcbiAqIHRoZSBtb21lbnQgYW4gYXBwIGxvZ3MgaXQuIEFwcHMgYWRkIHRoZWlyIG93biBidXNpbmVzcyBpZHMgKG9yZGVySWQsIHVzZXJJZCwg4oCmKSB2aWEgYGxpZnRGaWVsZHNgLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9MSUZUX0ZJRUxEUyA9IFsgJ2NvcnJlbGF0aW9uSWQnIF07XG5cbi8qKlxuICogTG93LXZhbHVlIHJlY29yZCBrZXlzIGRyb3BwZWQgYnkgZGVmYXVsdCB0byBjdXQgaW5nZXN0L3N0b3JhZ2Ugc2l6ZS4gYGhvc3RgIGlzIGRlcml2ZWQgZnJvbVxuICogbG9nR3JvdXAvbG9nU3RyZWFtIGFuZCBrZXB0LCBzbyBkcm9wcGluZyB0aGUgcmF3IGdyb3VwL3N0cmVhbSBsb3NlcyBub3RoaW5nIGFjdGlvbmFibGUuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0RST1BfRklFTERTID0gWyAnbG9nU3RyZWFtJywgJ2xvZ0dyb3VwJywgJ3NvdXJjZV90eXBlJywgJ3JlYXNvbicgXTtcblxuLy8gQ0RLLWludGVybmFsIC8gY3VzdG9tLXJlc291cmNlIGxhbWJkYXMgd2UgbmV2ZXIgc3Vic2NyaWJlIChub2lzZSArIGNyb3NzLXN0YWNrIHNpbmdsZXRvbnMpLFxuLy8gcGx1cyB0aGUgZm9yd2FyZGVyIGl0c2VsZiAoYmVsdC1hbmQtc3VzcGVuZGVyczsgaXQgaXMgYWxzbyBleGNsdWRlZCBieSByZWZlcmVuY2UpLlxuY29uc3QgREVGQVVMVF9TS0lQX1NVQlNUUklOR1MgPSBbXG5cdCdMb2dSZXRlbnRpb24nLFxuXHQnQ3VzdG9tOjonLFxuXHQnZnJhbWV3b3JrLW9uRXZlbnQnLFxuXHQnQVdTQ0RLQ2ZuJyxcblx0J0J1Y2tldE5vdGlmaWNhdGlvbnNIYW5kbGVyJyxcblx0J1Byb3ZpZGVyJyxcblx0J0xvZ0ZvcndhcmRlcicsXG5dO1xuXG5jbGFzcyBMb2dTaGlwcGluZ0FzcGVjdCBpbXBsZW1lbnRzIElBc3BlY3Qge1xuXHRjb25zdHJ1Y3Rvcihcblx0XHRwcml2YXRlIHJlYWRvbmx5IGZvcndhcmRlcjogTGFtYmRhRnVuY3Rpb24sXG5cdFx0cHJpdmF0ZSByZWFkb25seSBpbnZva2VQZXJtaXNzaW9uOiBJQ29uc3RydWN0LFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgZmlsdGVyUGF0dGVybjogSUZpbHRlclBhdHRlcm4sXG5cdFx0cHJpdmF0ZSByZWFkb25seSBza2lwU3Vic3RyaW5nczogc3RyaW5nW10sXG5cdCkge31cblxuXHR2aXNpdChub2RlOiBJQ29uc3RydWN0KTogdm9pZCB7XG5cdFx0aWYgKCEobm9kZSBpbnN0YW5jZW9mIExhbWJkYUZ1bmN0aW9uKSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAobm9kZSA9PT0gdGhpcy5mb3J3YXJkZXIpIHtcblx0XHRcdHJldHVybjsgLy8gbmV2ZXIgc3Vic2NyaWJlIHRoZSBmb3J3YXJkZXIgdG8gaXRzZWxmIOKAlCBpbmZpbml0ZSBsb29wXG5cdFx0fVxuXHRcdGNvbnN0IG5vZGVQYXRoID0gbm9kZS5ub2RlLnBhdGg7XG5cdFx0aWYgKHRoaXMuc2tpcFN1YnN0cmluZ3Muc29tZSgocykgPT4gbm9kZVBhdGguaW5jbHVkZXMocykpKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGlmIChub2RlLm5vZGUudHJ5RmluZENoaWxkKCdMb2dTaGlwU3Vic2NyaXB0aW9uJykpIHtcblx0XHRcdHJldHVybjsgLy8gYXNwZWN0cyBjYW4gdmlzaXQgYSBub2RlIG1vcmUgdGhhbiBvbmNlOyBhZGQgdGhlIGZpbHRlciBvbmx5IG9uY2Vcblx0XHR9XG5cdFx0dHJ5IHtcblx0XHRcdGNvbnN0IGZpbHRlciA9IG5ldyBTdWJzY3JpcHRpb25GaWx0ZXIobm9kZSwgJ0xvZ1NoaXBTdWJzY3JpcHRpb24nLCB7XG5cdFx0XHRcdGxvZ0dyb3VwOiBub2RlLmxvZ0dyb3VwLFxuXHRcdFx0XHQvLyBhZGRQZXJtaXNzaW9uczpmYWxzZSDigJQgYSBzaW5nbGUgd2lsZGNhcmQgaW52b2tlIHBlcm1pc3Npb24gaXMgYWRkZWQgb24gdGhlIGZvcndhcmRlciBpblxuXHRcdFx0XHQvLyBjb25zdHJ1Y3QoKSwgc28gd2UgZG9uJ3QgYWNjdW11bGF0ZSBvbmUgQ2ZuUGVybWlzc2lvbiBwZXIgbG9nIGdyb3VwLlxuXHRcdFx0XHRkZXN0aW5hdGlvbjogbmV3IExhbWJkYURlc3RpbmF0aW9uKHRoaXMuZm9yd2FyZGVyLCB7IGFkZFBlcm1pc3Npb25zOiBmYWxzZSB9KSxcblx0XHRcdFx0ZmlsdGVyUGF0dGVybjogdGhpcy5maWx0ZXJQYXR0ZXJuLFxuXHRcdFx0fSk7XG5cdFx0XHQvLyBDUklUSUNBTDogd2l0aCBhZGRQZXJtaXNzaW9uczpmYWxzZSB0aGVyZSBpcyBubyBhdXRvbWF0aWMgZGVwZW5kZW5jeSBiZXR3ZWVuIHRoZSBmaWx0ZXIgYW5kXG5cdFx0XHQvLyB0aGUgKHNpbmdsZSwgd2lsZGNhcmQpIGludm9rZSBwZXJtaXNzaW9uLiBPbiBhIEZSRVNIIGRlcGxveSBDbG91ZEZvcm1hdGlvbiB3b3VsZCBvdGhlcndpc2Vcblx0XHRcdC8vIHJhY2UgYW5kIGNyZWF0ZSB0aGUgZmlsdGVyIGJlZm9yZSB0aGUgcGVybWlzc2lvbiwgc28gQ2xvdWRXYXRjaCBMb2dzIGNhbid0IGludm9rZSB0aGVcblx0XHRcdC8vIGZvcndhcmRlciDihpIgXCJDb3VsZCBub3QgZXhlY3V0ZSB0aGUgbGFtYmRhIGZ1bmN0aW9uXCIgNDAwLiBGb3JjZSB0aGUgb3JkZXJpbmcgZXhwbGljaXRseS5cblx0XHRcdGZpbHRlci5ub2RlLmFkZERlcGVuZGVuY3kodGhpcy5pbnZva2VQZXJtaXNzaW9uKTtcblx0XHR9IGNhdGNoIChlcnIpIHtcblx0XHRcdC8vIEEgbGFtYmRhIHdpdGhvdXQgYW4gYWRkcmVzc2FibGUgbG9nIGdyb3VwIChyYXJlIENESyBpbnRlcm5hbHMpIG11c3QgbmV2ZXIgYnJlYWsgc3ludGguXG5cdFx0XHQvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuXHRcdFx0Y29uc29sZS53YXJuKGBbTG9nRm9yd2FyZGVyXSBza2lwcGVkICR7bm9kZVBhdGh9OiAkeyhlcnIgYXMgRXJyb3IpLm1lc3NhZ2V9YCk7XG5cdFx0fVxuXHR9XG59XG5cbi8qKlxuICogT3V0LW9mLWJhbmQgbG9nIHNoaXBwaW5nIGZvciBldmVyeSBMYW1iZGEgaW4gdGhlIGFwcC5cbiAqXG4gKiBBdHRhY2hlcyBhIENsb3VkV2F0Y2ggTG9ncyBzdWJzY3JpcHRpb24gZmlsdGVyIHRvIGVhY2ggZnVuY3Rpb24ncyBsb2cgZ3JvdXAgKHZpYSBhbiBBc3BlY3QpLCByb3V0aW5nXG4gKiBiYXRjaGVkLCBnemlwcGVkIGV2ZW50cyB0byBhIHNpbmdsZSB0aW55IGZvcndhcmRlciBMYW1iZGEgdGhhdCBzaGlwcyB0aGVtIHRvIGEgVmVjdG9yL0xvZ3RyYWlsIEhUVFBcbiAqIGluZ2VzdC4gTm90aGluZyBydW5zIGluIHRoZSBhcHAgcmVxdWVzdCBwYXRoIChmdW5jdGlvbnMgb25seSB3cml0ZSBzdGRvdXQpLCBzbyBsb2cgdm9sdW1lIG5ldmVyXG4gKiBkZWdyYWRlcyByZXF1ZXN0IGxhdGVuY3kgYW5kIHRoZXJlIGFyZSBubyBwZXItbG9nIEhUVFAgY2FsbHMgZnJvbSB0aGUgaGFuZGxlcnMuXG4gKlxuICogSW5zaWRlIHRoZSBmb3J3YXJkZXIsIGVhY2ggbGluZSBydW5zIHRocm91Z2ggYSA0LXN0ZXAgcGlwZWxpbmU6IE5PUk1BTElaRSAocGVlbCBMYW1iZGEgcHJlZml4LCBsaWZ0XG4gKiBmdzI0IHRzbG9nIEpTT04sIHN0cmlwIEFOU0kpIOKGkiBSRUNMQVNTSUZZIGJlbmlnbiBlcnJvcnMg4oaSIERST1Agbm9pc2Ug4oaSIERPV05HUkFERSBub2lzZS4gU3RlcHMgMuKAkzQgYXJlXG4gKiBhcHAtb3duZWQgcnVsZSBsaXN0cyAoc2VlIHtAbGluayBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzfSAvIHtAbGluayBERUZBVUxUX0xPR19OT0lTRV9SVUxFU30pLlxuICpcbiAqIERlcGxveS10aW1lIGNvbmZpZyBpcyByZWFkIGZyb20gYEZPUldBUkRFUl8qYCBlbnYgd2hlbiBub3QgcGFzc2VkIGV4cGxpY2l0bHkuIGBGT1JXQVJERVJfKmAgaXMgdXNlZFxuICogKG5ldmVyIGBMT0dUUkFJTF8qYCkgb24gcHVycG9zZTogc2V0dGluZyBgTE9HVFJBSUxfKmAgaW4gdGhlIGRlcGxveSBzaGVsbCB3b3VsZCBhY3RpdmF0ZSBmdzI0J3NcbiAqIGluLXByb2Nlc3MgbG9nIHRyYW5zcG9ydCBhbmQgbGVhayBsb2NhbCBDREsvc3ludGggbG9ncyB0byB0aGUgaW5nZXN0LlxuICovXG5leHBvcnQgY2xhc3MgTG9nRm9yd2FyZGVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG5cdHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cdHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihMb2dGb3J3YXJkZXJDb25zdHJ1Y3QubmFtZSk7XG5cdG5hbWUgPSBMb2dGb3J3YXJkZXJDb25zdHJ1Y3QubmFtZTtcblx0ZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuXHRvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXHRtYWluU3RhY2shOiBTdGFjaztcblxuXHRjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogTG9nRm9yd2FyZGVyQ29uc3RydWN0Q29uZmlnID0ge30pIHt9XG5cblx0cHJpdmF0ZSByZXNvbHZlTm9pc2VFbnYoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG5cdFx0Y29uc3QgcnVsZXMgPSB0aGlzLmNvbmZpZy5ub2lzZSA/PyB7fTtcblx0XHRjb25zdCB1c2VEZWZhdWx0cyA9IHJ1bGVzLnVzZURlZmF1bHRzICE9PSBmYWxzZTtcblx0XHRjb25zdCBtZXJnZSA9IChsaXN0OiBzdHJpbmdbXSB8IHVuZGVmaW5lZCwgZGVmYXVsdHM6IHN0cmluZ1tdKTogc3RyaW5nW10gPT4ge1xuXHRcdFx0Y29uc3QgYmFzZSA9IHVzZURlZmF1bHRzID8gZGVmYXVsdHMgOiBbXTtcblx0XHRcdC8vIERlLWR1cCB3aGlsZSBwcmVzZXJ2aW5nIG9yZGVyIChkZWZhdWx0cyBmaXJzdCwgdGhlbiBhcHAgYWRkaXRpb25zKS5cblx0XHRcdHJldHVybiBbIC4uLm5ldyBTZXQoWyAuLi5iYXNlLCAuLi4obGlzdCA/PyBbXSkgXSkgXTtcblx0XHR9O1xuXHRcdGNvbnN0IGJlbmlnbiA9IG1lcmdlKHJ1bGVzLmJlbmlnbiwgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVMuYmVuaWduKTtcblx0XHRjb25zdCBkcm9wID0gbWVyZ2UocnVsZXMuZHJvcCwgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVMuZHJvcCk7XG5cdFx0Y29uc3QgZG93bmdyYWRlID0gbWVyZ2UocnVsZXMuZG93bmdyYWRlLCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUy5kb3duZ3JhZGUpO1xuXHRcdGNvbnN0IGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXHRcdGlmIChiZW5pZ24ubGVuZ3RoKSBlbnYuRk9SV0FSREVSX05PSVNFX0JFTklHTiA9IEpTT04uc3RyaW5naWZ5KGJlbmlnbik7XG5cdFx0aWYgKGRyb3AubGVuZ3RoKSBlbnYuRk9SV0FSREVSX05PSVNFX0RST1AgPSBKU09OLnN0cmluZ2lmeShkcm9wKTtcblx0XHRpZiAoZG93bmdyYWRlLmxlbmd0aCkgZW52LkZPUldBUkRFUl9OT0lTRV9ET1dOR1JBREUgPSBKU09OLnN0cmluZ2lmeShkb3duZ3JhZGUpO1xuXHRcdHJldHVybiBlbnY7XG5cdH1cblxuXHQvKiogQXBwLWRlY2xhcmVkIGZpZWxkcyB0byBsaWZ0LCBtZXJnZWQgd2l0aCB7QGxpbmsgREVGQVVMVF9MSUZUX0ZJRUxEU30gdW5sZXNzIGxpZnRGaWVsZERlZmF1bHRzIGlzIGZhbHNlLiAqL1xuXHQvKipcblx0ICogUmVzb2x2ZSB0aGUgdmVyc2lvbiBzdGFtcCBhdXRvbWF0aWNhbGx5IOKAlCBubyBhcHAgY29kZSBvciBDSSB3aXJpbmcgdG8gbWFpbnRhaW46XG5cdCAqICAgZXhwbGljaXQgY29uZmlnIC8gYEZPUldBUkRFUl9WRVJTSU9OYCDihpIgYEdJVEhVQl9TSEFgIChhdXRvIGluIEdpdEh1YiBBY3Rpb25zLCBmaXJzdCAxMikg4oaSXG5cdCAqICAgdGhlIGFwcCdzIHBhY2thZ2UuanNvbiB2ZXJzaW9uIChhdXRvLWJ1bXBlZCBieSByZWxlYXNlIENJLCByZWFkIGF0IHN5bnRoKSDihpIgJycgKG9taXR0ZWQpLlxuXHQgKi9cblx0cHJpdmF0ZSByZXNvbHZlVmVyc2lvbigpOiBzdHJpbmcge1xuXHRcdGNvbnN0IGV4cGxpY2l0ID0gdGhpcy5jb25maWcudmVyc2lvbj8udHJpbSgpIHx8IHByb2Nlc3MuZW52LkZPUldBUkRFUl9WRVJTSU9OPy50cmltKCk7XG5cdFx0aWYgKGV4cGxpY2l0KSByZXR1cm4gZXhwbGljaXQ7XG5cdFx0Y29uc3Qgc2hhID0gcHJvY2Vzcy5lbnYuR0lUSFVCX1NIQT8udHJpbSgpO1xuXHRcdGlmIChzaGEpIHJldHVybiBzaGEuc2xpY2UoMCwgMTIpO1xuXHRcdHRyeSB7XG5cdFx0XHRjb25zdCBwa2dQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICdwYWNrYWdlLmpzb24nKTtcblx0XHRcdGlmIChleGlzdHNTeW5jKHBrZ1BhdGgpKSB7XG5cdFx0XHRcdGNvbnN0IHBrZyA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKHBrZ1BhdGgsICd1dGY4JykpIGFzIHsgdmVyc2lvbj86IHVua25vd24gfTtcblx0XHRcdFx0aWYgKHR5cGVvZiBwa2cudmVyc2lvbiA9PT0gJ3N0cmluZycgJiYgcGtnLnZlcnNpb24udHJpbSgpKSByZXR1cm4gcGtnLnZlcnNpb24udHJpbSgpO1xuXHRcdFx0fVxuXHRcdH0gY2F0Y2gge1xuXHRcdFx0LyogdmVyc2lvbiBpcyBiZXN0LWVmZm9ydCDigJQgbmV2ZXIgZmFpbCBzeW50aCBvdmVyIGl0ICovXG5cdFx0fVxuXHRcdHJldHVybiAnJztcblx0fVxuXG5cdHByaXZhdGUgcmVzb2x2ZUxpZnRGaWVsZHMoKTogc3RyaW5nW10ge1xuXHRcdGNvbnN0IHVzZURlZmF1bHRzID0gdGhpcy5jb25maWcubGlmdEZpZWxkRGVmYXVsdHMgIT09IGZhbHNlO1xuXHRcdGNvbnN0IGJhc2UgPSB1c2VEZWZhdWx0cyA/IERFRkFVTFRfTElGVF9GSUVMRFMgOiBbXTtcblx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KFsgLi4uYmFzZSwgLi4uKHRoaXMuY29uZmlnLmxpZnRGaWVsZHMgPz8gW10pIF0ubWFwKChzKSA9PiBzLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pKSBdO1xuXHR9XG5cblx0LyoqIFJlY29yZCBrZXlzIHRvIGRyb3AsIG1lcmdlZCB3aXRoIHtAbGluayBERUZBVUxUX0RST1BfRklFTERTfSB1bmxlc3MgZHJvcEZpZWxkRGVmYXVsdHMgaXMgZmFsc2UuICovXG5cdHByaXZhdGUgcmVzb2x2ZURyb3BGaWVsZHMoKTogc3RyaW5nW10ge1xuXHRcdGNvbnN0IHVzZURlZmF1bHRzID0gdGhpcy5jb25maWcuZHJvcEZpZWxkRGVmYXVsdHMgIT09IGZhbHNlO1xuXHRcdGNvbnN0IGJhc2UgPSB1c2VEZWZhdWx0cyA/IERFRkFVTFRfRFJPUF9GSUVMRFMgOiBbXTtcblx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KFsgLi4uYmFzZSwgLi4uKHRoaXMuY29uZmlnLmRyb3BGaWVsZHMgPz8gW10pIF0ubWFwKChzKSA9PiBzLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pKSBdO1xuXHR9XG5cblx0YXN5bmMgY29uc3RydWN0KCk6IFByb21pc2U8dm9pZD4ge1xuXHRcdC8vIERlZmF1bHQgc3RhY2sgKG5vIGhhcmRjb2RlZCBuYW1lKSDigJQgcmVzcGVjdHMgc3RhY2tOYW1lL3BhcmVudFN0YWNrTmFtZSBpZiB0aGUgYXBwIHNldHMgdGhlbS5cblx0XHR0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLmNvbmZpZy5zdGFja05hbWUsIHRoaXMuY29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cdFx0Y29uc3QgbyA9IHRoaXMuY29uZmlnO1xuXG5cdFx0Y29uc3QgZm9yd2FyZGVyTG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcy5tYWluU3RhY2ssICdMb2dGb3J3YXJkZXJGdW5jdGlvbkxvZ0dyb3VwJywge1xuXHRcdFx0cmV0ZW50aW9uOiBvLmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuXHRcdFx0cmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuXHRcdH0pO1xuXG5cdFx0Ly8gc2VydmljZS9lbnYgZGVmYXVsdCB0byB3aGF0IGZ3MjQgYWxyZWFkeSBrbm93cyAoaHlkcmF0ZWQgZnJvbSBBUFBfTkFNRSAvIEFQUF9FTlZJUk9OTUVOVCksIHNvIGFcblx0XHQvLyBiYWNrZW5kIHVzdWFsbHkgZG9lc24ndCBwYXNzIHRoZW0uIFByZWNlZGVuY2U6IGV4cGxpY2l0IG9wdGlvbiA+IEZPUldBUkRFUl8qIGVudiA+IGZ3MjQgY29uZmlnLlxuXHRcdGNvbnN0IGNmZyA9IHRoaXMuZncyNC5nZXRDb25maWcoKTtcblx0XHRjb25zdCBpbmdlc3RIdHRwVXJsID0gby5pbmdlc3RIdHRwVXJsID8/IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfVVJMPy50cmltKCkgPz8gJyc7XG5cdFx0Y29uc3Qgc2VydmljZSA9IG8uc2VydmljZSA/PyAocHJvY2Vzcy5lbnYuRk9SV0FSREVSX1NFUlZJQ0U/LnRyaW0oKSB8fCB0aGlzLmZ3MjQuYXBwTmFtZSB8fCAnJyk7XG5cdFx0Y29uc3QgZW52ID0gby5lbnYgPz8gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9FTlY/LnRyaW0oKSB8fCBjZmcuZW52aXJvbm1lbnQgfHwgJycpO1xuXHRcdGNvbnN0IHhBcGlLZXkgPSBvLnhBcGlLZXkgPz8gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk/LnRyaW0oKTtcblx0XHRjb25zdCBsaWZ0RmllbGRzID0gdGhpcy5yZXNvbHZlTGlmdEZpZWxkcygpO1xuXHRcdGNvbnN0IGRyb3BGaWVsZHMgPSB0aGlzLnJlc29sdmVEcm9wRmllbGRzKCk7XG5cdFx0Y29uc3QgdmVyc2lvbiA9IHRoaXMucmVzb2x2ZVZlcnNpb24oKTtcblxuXHRcdGlmICghaW5nZXN0SHR0cFVybCkge1xuXHRcdFx0Ly8gTm9uLWZhdGFsOiB0aGUgZm9yd2FyZGVyIGhhbmRsZXIgbm8tb3BzIHdpdGhvdXQgYW4gaW5nZXN0IFVSTCwgc28gYSBiYWNrZW5kIGNhbiBhZG9wdCB0aGVcblx0XHRcdC8vIGNvbnN0cnVjdCBiZWZvcmUgdGhlIGluZ2VzdCBpcyB3aXJlZC4gV2FybiBzbyBpdCBpc24ndCBhIHNpbGVudCBuby1vcC5cblx0XHRcdHRoaXMubG9nZ2VyLndhcm4oXG5cdFx0XHRcdCdMb2dGb3J3YXJkZXJDb25zdHJ1Y3Q6IG5vIGluZ2VzdCBVUkwgKGNvbmZpZy5pbmdlc3RIdHRwVXJsIC8gRk9SV0FSREVSX0lOR0VTVF9VUkwpLiAnXG5cdFx0XHRcdFx0KyAnRm9yd2FyZGVyIGRlcGxveXMgYnV0IHNoaXBzIG5vdGhpbmcgdW50aWwgb25lIGlzIHNldC4nLFxuXHRcdFx0KTtcblx0XHR9XG5cblx0XHQvLyBGcmFtZXdvcmstb3duZWQgaGFuZGxlciBzaGlwcGVkIGNvbXBpbGVkIGluIGRpc3QgKG1pcnJvcnMgbWFpbGVyL2R5bmFtbyBoYW5kbGVycykuIFJlc29sdmUgdGhlXG5cdFx0Ly8gY29tcGlsZWQgYC5qc2Agd2hlbiBpbnN0YWxsZWQgKGRpc3QpLCBmYWxsaW5nIGJhY2sgdG8gdGhlIGAudHNgIHNvdXJjZSB3aGVuIHJ1bm5pbmcgZnJvbSBmdzI0J3Ncblx0XHQvLyBvd24gc3JjICh1bml0IHRlc3RzIC8gdHMtbm9kZSBkZXYpIHdoZXJlIHRoZSBgLmpzYCBoYXNuJ3QgYmVlbiBlbWl0dGVkLlxuXHRcdGNvbnN0IGhhbmRsZXJCYXNlID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXInKTtcblx0XHRjb25zdCBoYW5kbGVyRW50cnkgPSBleGlzdHNTeW5jKGAke2hhbmRsZXJCYXNlfS5qc2ApID8gYCR7aGFuZGxlckJhc2V9LmpzYCA6IGAke2hhbmRsZXJCYXNlfS50c2A7XG5cblx0XHRjb25zdCBmb3J3YXJkZXIgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssICdMb2dGb3J3YXJkZXJGdW5jdGlvbicsIHtcblx0XHRcdGVudHJ5OiBoYW5kbGVyRW50cnksXG5cdFx0XHRoYW5kbGVyOiAnaGFuZGxlcicsXG5cdFx0XHRydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuXHRcdFx0bWVtb3J5U2l6ZTogby5tZW1vcnlTaXplID8/IDI1Nixcblx0XHRcdHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoby50aW1lb3V0U2Vjb25kcyA/PyAzMCksXG5cdFx0XHQuLi4oby5yZXNlcnZlZENvbmN1cnJlbmN5ICE9IG51bGwgPyB7IHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IG8ucmVzZXJ2ZWRDb25jdXJyZW5jeSB9IDoge30pLFxuXHRcdFx0bG9nR3JvdXA6IGZvcndhcmRlckxvZ0dyb3VwLFxuXHRcdFx0YnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbICdAYXdzLXNkaycgXSwgbWluaWZ5OiB0cnVlIH0sXG5cdFx0XHQvLyBGb3J3YXJkZXIgcnVudGltZSBlbnYgaXMgZnVsbHkgRk9SV0FSREVSXyotbmFtZXNwYWNlZCDigJQgbm8gTE9HVFJBSUxfKiBrZXlzLCBzbyBpdCBjYW4gbmV2ZXJcblx0XHRcdC8vIGNvbGxpZGUgd2l0aCBmdzI0J3MgaW4tcHJvY2VzcyB0cmFuc3BvcnQuXG5cdFx0XHRlbnZpcm9ubWVudDoge1xuXHRcdFx0XHRGT1JXQVJERVJfSU5HRVNUX1VSTDogaW5nZXN0SHR0cFVybCxcblx0XHRcdFx0Rk9SV0FSREVSX1NFUlZJQ0U6IHNlcnZpY2UsXG5cdFx0XHRcdEZPUldBUkRFUl9FTlY6IGVudixcblx0XHRcdFx0Li4uKHhBcGlLZXkgPyB7IEZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZOiB4QXBpS2V5IH0gOiB7fSksXG5cdFx0XHRcdC4uLihvLmJhdGNoRm9ybWF0ID8geyBGT1JXQVJERVJfQkFUQ0hfRk9STUFUOiBvLmJhdGNoRm9ybWF0IH0gOiB7fSksXG5cdFx0XHRcdC4uLihvLm1heEJhdGNoQnl0ZXMgIT0gbnVsbCA/IHsgRk9SV0FSREVSX01BWF9CQVRDSF9CWVRFUzogU3RyaW5nKG8ubWF4QmF0Y2hCeXRlcykgfSA6IHt9KSxcblx0XHRcdFx0Li4uKGxpZnRGaWVsZHMubGVuZ3RoID8geyBGT1JXQVJERVJfRklFTERTOiBKU09OLnN0cmluZ2lmeShsaWZ0RmllbGRzKSB9IDoge30pLFxuXHRcdFx0XHQvLyBBbHdheXMgc2V0IChldmVuIHdoZW4gZW1wdHkpIHNvIHRoZSBoYW5kbGVyIGRyb3BzIGV4YWN0bHkgd2hhdCB0aGUgY29uZmlnIHNheXMsIG5vdCBpdHMgb3duIGRlZmF1bHQuXG5cdFx0XHRcdEZPUldBUkRFUl9EUk9QX0ZJRUxEUzogSlNPTi5zdHJpbmdpZnkoZHJvcEZpZWxkcyksXG5cdFx0XHRcdC4uLih2ZXJzaW9uID8geyBGT1JXQVJERVJfVkVSU0lPTjogdmVyc2lvbiB9IDoge30pLFxuXHRcdFx0XHQuLi50aGlzLnJlc29sdmVOb2lzZUVudigpLFxuXHRcdFx0fSxcblx0XHR9KTtcblxuXHRcdC8vIE9uZSBicm9hZCBpbnZva2UgcGVybWlzc2lvbiBpbnN0ZWFkIG9mIG9uZSBwZXIgbG9nIGdyb3VwOiBrZWVwcyB0aGUgZm9yd2FyZGVyJ3MgcmVzb3VyY2UgcG9saWN5XG5cdFx0Ly8gc21hbGwgKExhbWJkYSBjYXBzIGl0IGF0IH4yMEtCKSBhcyB0aGUgbnVtYmVyIG9mIHN1YnNjcmliZWQgZnVuY3Rpb25zIGdyb3dzLiBDcmVhdGVkIGFzIGFuXG5cdFx0Ly8gZXhwbGljaXQgQ2ZuUGVybWlzc2lvbiBzbyBldmVyeSBzdWJzY3JpcHRpb24gZmlsdGVyIGNhbiBgYWRkRGVwZW5kZW5jeWAgb24gaXQgKHRoZSBhc3BlY3QpIOKAlFxuXHRcdC8vIHdpdGhvdXQgdGhhdCwgYSBmcmVzaCBkZXBsb3kgcmFjZXMgYW5kIGNyZWF0ZXMgZmlsdGVycyBiZWZvcmUgdGhlIHBlcm1pc3Npb24gKGEgNDAwKS5cblx0XHRjb25zdCBpbnZva2VQZXJtaXNzaW9uID0gbmV3IENmblBlcm1pc3Npb24oZm9yd2FyZGVyLCAnQWxsb3dDbG91ZFdhdGNoTG9nc0ludm9rZScsIHtcblx0XHRcdHByaW5jaXBhbDogJ2xvZ3MuYW1hem9uYXdzLmNvbScsXG5cdFx0XHRhY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nLFxuXHRcdFx0ZnVuY3Rpb25OYW1lOiBmb3J3YXJkZXIuZnVuY3Rpb25OYW1lLFxuXHRcdFx0c291cmNlQWNjb3VudDogdGhpcy5tYWluU3RhY2suYWNjb3VudCxcblx0XHRcdHNvdXJjZUFybjogYGFybjphd3M6bG9nczoke3RoaXMubWFpblN0YWNrLnJlZ2lvbn06JHt0aGlzLm1haW5TdGFjay5hY2NvdW50fTpsb2ctZ3JvdXA6KmAsXG5cdFx0fSk7XG5cblx0XHRjb25zdCBza2lwID0gWyAuLi5ERUZBVUxUX1NLSVBfU1VCU1RSSU5HUywgLi4uKG8uZXhjbHVkZUZ1bmN0aW9uUGF0aFN1YnN0cmluZ3MgPz8gW10pIF07XG5cdFx0Ly8gJ2FwcCcg4oaSIHN1YnNjcmliZSBldmVyeSBMYW1iZGEgaW4gdGhlIHdob2xlIENESyBhcHAgKGluZGVwZW5kZW50IHRvcC1sZXZlbCBzdGFja3MgdG9vKTtcblx0XHQvLyAnc3RhY2snIChkZWZhdWx0KSDihpIgdGhpcyBzdGFjayArIG5lc3RlZCBzdGFja3MgdW5kZXIgaXQuXG5cdFx0Y29uc3Qgc2NvcGVSb290OiBJQ29uc3RydWN0ID1cblx0XHRcdG8uc3Vic2NyaWJlU2NvcGUgPT09ICdhcHAnID8gdGhpcy5tYWluU3RhY2subm9kZS5yb290IDogdGhpcy5tYWluU3RhY2s7XG5cdFx0QXNwZWN0cy5vZihzY29wZVJvb3QpLmFkZChcblx0XHRcdG5ldyBMb2dTaGlwcGluZ0FzcGVjdChmb3J3YXJkZXIsIGludm9rZVBlcm1pc3Npb24sIG8uZmlsdGVyUGF0dGVybiA/PyBGaWx0ZXJQYXR0ZXJuLmFsbEV2ZW50cygpLCBza2lwKSxcblx0XHQpO1xuXG5cdFx0dGhpcy5vdXRwdXQgPSB7fSBhcyBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXHR9XG59XG4iXX0=