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
exports.LogForwarderConstruct = exports.DEFAULT_LIFT_FIELDS = exports.DEFAULT_LOG_NOISE_RULES = void 0;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2xvZy1mb3J3YXJkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQWtDO0FBQ2xDLHFDQUFtRDtBQUNuRCw2Q0FBb0Y7QUFDcEYsdURBQTRGO0FBQzVGLHFFQUErRDtBQUMvRCxtREFBdUg7QUFDdkgsNkVBQXNFO0FBRXRFLHVDQUFvQztBQUdwQyx3Q0FBMEM7QUEyRjFDOzs7O0dBSUc7QUFDVSxRQUFBLHVCQUF1QixHQUEwRDtJQUM3RiwyREFBMkQ7SUFDM0QsTUFBTSxFQUFFO1FBQ1Asa0JBQWtCO1FBQ2xCLGFBQWE7UUFDYixhQUFhO1FBQ2Isd0NBQXdDO1FBQ3hDLDBCQUEwQjtRQUMxQixrQkFBa0I7UUFDbEIsaUJBQWlCO0tBQ2pCO0lBQ0QsZ0NBQWdDO0lBQ2hDLElBQUksRUFBRTtRQUNMLDhDQUE4QztRQUM5QyxrQkFBa0I7UUFDbEIsbUJBQW1CO0tBQ25CO0lBQ0QsaURBQWlEO0lBQ2pELFNBQVMsRUFBRTtRQUNWLHNCQUFzQjtRQUN0QixnQkFBZ0I7S0FDaEI7Q0FDRCxDQUFDO0FBRUY7Ozs7R0FJRztBQUNVLFFBQUEsbUJBQW1CLEdBQUcsQ0FBRSxlQUFlLENBQUUsQ0FBQztBQUV2RCw4RkFBOEY7QUFDOUYscUZBQXFGO0FBQ3JGLE1BQU0sdUJBQXVCLEdBQUc7SUFDL0IsY0FBYztJQUNkLFVBQVU7SUFDVixtQkFBbUI7SUFDbkIsV0FBVztJQUNYLDRCQUE0QjtJQUM1QixVQUFVO0lBQ1YsY0FBYztDQUNkLENBQUM7QUFFRixNQUFNLGlCQUFpQjtJQUVKO0lBQ0E7SUFDQTtJQUNBO0lBSmxCLFlBQ2tCLFNBQXlCLEVBQ3pCLGdCQUE0QixFQUM1QixhQUE2QixFQUM3QixjQUF3QjtRQUh4QixjQUFTLEdBQVQsU0FBUyxDQUFnQjtRQUN6Qixx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QUFPLGNBQWM7U0FDeEYsQ0FBQyxDQUFDO1FBRUgsTUFBTSxJQUFJLEdBQUcsQ0FBRSxHQUFHLHVCQUF1QixFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsNkJBQTZCLElBQUksRUFBRSxDQUFDLENBQUUsQ0FBQztRQUN4RiwwRkFBMEY7UUFDMUYsMkRBQTJEO1FBQzNELE1BQU0sU0FBUyxHQUNkLENBQUMsQ0FBQyxjQUFjLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDeEUscUJBQU8sQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxDQUN4QixJQUFJLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDLENBQUMsYUFBYSxJQUFJLHdCQUFhLENBQUMsU0FBUyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQ3RHLENBQUM7UUFFRixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQXlCLENBQUM7SUFDekMsQ0FBQztDQUNEO0FBM0lELHNEQTJJQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGV4aXN0c1N5bmMsIHJlYWRGaWxlU3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgQXNwZWN0cywgRHVyYXRpb24sIFJlbW92YWxQb2xpY3ksIFN0YWNrLCB0eXBlIElBc3BlY3QgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDZm5QZXJtaXNzaW9uLCBGdW5jdGlvbiBhcyBMYW1iZGFGdW5jdGlvbiwgUnVudGltZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgeyBGaWx0ZXJQYXR0ZXJuLCB0eXBlIElGaWx0ZXJQYXR0ZXJuLCBMb2dHcm91cCwgUmV0ZW50aW9uRGF5cywgU3Vic2NyaXB0aW9uRmlsdGVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgTGFtYmRhRGVzdGluYXRpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncy1kZXN0aW5hdGlvbnMnO1xuaW1wb3J0IHR5cGUgeyBJQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSAnLi4vY29yZS9mdzI0JztcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdCc7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuXG4vKipcbiAqIEFwcC1vd25lZCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzLCBhcHBsaWVkIHBlciBsb2cgbGluZSBpbnNpZGUgdGhlIGZvcndhcmRlciBMYW1iZGEgKGxheWVycyAy4oCTNCBvZiB0aGVcbiAqIHBpcGVsaW5lOyBzZWUgYExvZ0ZvcndhcmRlckNvbnN0cnVjdGApLiBFYWNoIGxpc3QgaXMgYW4gYXJyYXkgb2YgcmVnZXggc291cmNlIHN0cmluZ3MsIG1hdGNoZWRcbiAqIGNhc2UtaW5zZW5zaXRpdmVseSBhZ2FpbnN0IHRoZSBub3JtYWxpemVkIG1lc3NhZ2UuIFRoZXNlIGFyZSBjb21wbGVtZW50YXJ5IHRvIGFueSBnbG9iYWwgc2V2ZXJpdHkvXG4gKiBub2lzZSBoYW5kbGluZyBhIHNoYXJlZCBWZWN0b3IgaW5nZXN0IG1heSBhbHNvIHJ1biDigJQgdGhpcyBsYXllciBsZXRzIGVhY2ggYXBwIG93biBpdHMgb3duIHJ1bGVzIGFuZCxcbiAqIGZvciBgZHJvcGAsIHNhdmVzIGluZ2VzdCBiYW5kd2lkdGggYnkgcmVtb3Zpbmcgbm9pc2UgYXQgdGhlIHNvdXJjZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzIHtcblx0LyoqIEVycm9yLWlzaCBsaW5lcyBtYXRjaGluZyB0aGVzZSBhcmUgZG93bmdyYWRlZCB0byBgd2FybmAgKHRhZ2dlZCBgcmVjbGFzc2lmaWVkOiBcImJlbmlnblwiYCkuICovXG5cdGJlbmlnbj86IHN0cmluZ1tdO1xuXHQvKiogTGluZXMgbWF0Y2hpbmcgdGhlc2UgYXJlIGRyb3BwZWQgZW50aXJlbHkg4oCUIG5ldmVyIHNoaXBwZWQuICovXG5cdGRyb3A/OiBzdHJpbmdbXTtcblx0LyoqIExpbmVzIG1hdGNoaW5nIHRoZXNlIGFyZSBkb3duZ3JhZGVkIHRvIGBkZWJ1Z2AgKHRhZ2dlZCBgcmVjbGFzc2lmaWVkOiBcIm5vaXNlXCJgKS4gKi9cblx0ZG93bmdyYWRlPzogc3RyaW5nW107XG5cdC8qKlxuXHQgKiBXaGVuIHRydWUgKGRlZmF1bHQpLCB0aGUgYnVpbHQtaW4ge0BsaW5rIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTfSBhcmUgbWVyZ2VkIHdpdGggdGhlIGxpc3RzIGFib3ZlLlxuXHQgKiBTZXQgZmFsc2UgdG8gdXNlIE9OTFkgdGhlIGxpc3RzIHlvdSBwcm92aWRlIChvciBub25lKS5cblx0ICovXG5cdHVzZURlZmF1bHRzPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBMb2dGb3J3YXJkZXJDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcblx0LyoqIFZlY3Rvci9Mb2d0cmFpbCBIVFRQIEpTT04gaW5nZXN0IFVSTC4gRGVmYXVsdHMgdG8gYEZPUldBUkRFUl9JTkdFU1RfVVJMYCBhdCBkZXBsb3kgdGltZS4gKi9cblx0aW5nZXN0SHR0cFVybD86IHN0cmluZztcblx0LyoqXG5cdCAqIEJhc2UgYHNlcnZpY2VgIGxhYmVsIGZvciBzaGlwcGVkIGxvZ3MgKGVudiBpcyBmb2xkZWQgaW4pLiBVc3VhbGx5IG9taXQg4oCUIGRlZmF1bHRzIHRvIHRoZSBmdzI0XG5cdCAqIGFwcCBuYW1lIChgQVBQX05BTUVgKTsgb3ZlcnJpZGUgd2l0aCB0aGlzIG9wdGlvbiBvciBgRk9SV0FSREVSX1NFUlZJQ0VgLlxuXHQgKi9cblx0c2VydmljZT86IHN0cmluZztcblx0LyoqXG5cdCAqIFN0YWdlL293bmVyIGxhYmVsIChlLmcuIGBkZXZlbG9wYCwgYHByb2RgLCBgc2FuZGJveC1uaXRpbmApIOKAlCBmb2xkZWQgaW50byB0aGUgYHNlcnZpY2VgIGxhYmVsXG5cdCAqIChgbXlzZXJ2aWNlLWRldmVsb3BgKSBhbmQgZW1pdHRlZCBhcyBgZW52YCBzbyBkZXZlbG9wL3Byb2QvcGVyLWRldmVsb3BlciBsb2dzIGFyZSBkaXN0aW5ndWlzaGFibGVcblx0ICogaW4gTG9ndHJhaWwuIFVzdWFsbHkgb21pdCDigJQgZGVmYXVsdHMgdG8gdGhlIGZ3MjQgZW52aXJvbm1lbnQgKGBBUFBfRU5WSVJPTk1FTlRgKTsgb3ZlcnJpZGUgd2l0aFxuXHQgKiB0aGlzIG9wdGlvbiBvciBgRk9SV0FSREVSX0VOVmAuXG5cdCAqL1xuXHRlbnY/OiBzdHJpbmc7XG5cdC8qKiBPcHRpb25hbCBgeC1hcGkta2V5YCB3aGVuIHRoZSBpbmdlc3QgZnJvbnQgcmVxdWlyZXMgaXQuIERlZmF1bHRzIHRvIGBGT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWWAuICovXG5cdHhBcGlLZXk/OiBzdHJpbmc7XG5cdC8qKiBCYXRjaCB3aXJlIGZvcm1hdCDigJQgbXVzdCBtYXRjaCB5b3VyIFZlY3RvciBodHRwIHNvdXJjZSBkZWNvZGluZy4gRGVmYXVsdDogYGpzb24tYXJyYXlgLiAqL1xuXHRiYXRjaEZvcm1hdD86ICduZGpzb24nIHwgJ2pzb24tYXJyYXknO1xuXHQvKiogTWF4IHVuY29tcHJlc3NlZCBieXRlcyBwZXIgUE9TVCAodGhlIGZvcndhcmRlciBzcGxpdHMgbGFyZ2VyIGJhdGNoZXMpLiBEZWZhdWx0OiAxLDAwMCwwMDAuICovXG5cdG1heEJhdGNoQnl0ZXM/OiBudW1iZXI7XG5cdC8qKiBDbG91ZFdhdGNoIHN1YnNjcmlwdGlvbi1maWx0ZXIgcGF0dGVybiDigJQgdGhlIHZvbHVtZS9jb3N0IGxldmVyIChlLmcuIG9ubHkgV0FSTi9FUlJPUikuIERlZmF1bHQ6IGFsbCBldmVudHMuICovXG5cdGZpbHRlclBhdHRlcm4/OiBJRmlsdGVyUGF0dGVybjtcblx0LyoqIEV4dHJhIGZ1bmN0aW9uIGNvbnN0cnVjdC1wYXRoIHN1YnN0cmluZ3MgdG8gc2tpcCAobmV2ZXIgc3Vic2NyaWJlKS4gKi9cblx0ZXhjbHVkZUZ1bmN0aW9uUGF0aFN1YnN0cmluZ3M/OiBzdHJpbmdbXTtcblx0LyoqIEFwcC1vd25lZCBub2lzZS9zZXZlcml0eSBydWxlcyBhcHBsaWVkIGluc2lkZSB0aGUgZm9yd2FyZGVyIChsYXllcnMgMuKAkzQpLiAqL1xuXHRub2lzZT86IExvZ0ZvcndhcmRlck5vaXNlUnVsZXM7XG5cdC8qKlxuXHQgKiBTdHJ1Y3R1cmVkIGZpZWxkcyB0byBsaWZ0IGZyb20gdHNsb2cgYXJncyBpbnRvIHF1ZXJ5YWJsZSB0b3AtbGV2ZWwgcmVjb3JkIGZpZWxkcywgc28gTG9ndHJhaWwgY2FuXG5cdCAqIGZvbGxvdyBvbmUgcmVxdWVzdCBhY3Jvc3Mgc2VydmljZXMgb3IgZmlsdGVyIFwiYWxsIGxvZ3MgZm9yIG9yZGVyIDk5MVwiLiBPbmx5IGZpZWxkcyB0aGUgYXBwIGFjdHVhbGx5XG5cdCAqIGxvZ3MgYXMgc3RydWN0dXJlZCBhcmdzIChlLmcuIGBsb2dnZXIuaW5mbygnY2hhcmdlIGZhaWxlZCcsIHsgb3JkZXJJZCwgY29ycmVsYXRpb25JZCB9KWApIGFyZSBsaWZ0ZWRcblx0ICog4oCUIHRoZSBmb3J3YXJkZXIgbmV2ZXIgc2NyYXBlcyBmcmVlIHRleHQuIHtAbGluayBERUZBVUxUX0xJRlRfRklFTERTfSAoY29ycmVsYXRpb25JZCkgaXMgbWVyZ2VkIGluXG5cdCAqIHVubGVzcyB7QGxpbmsgbGlmdEZpZWxkRGVmYXVsdHN9IGlzIGZhbHNlLlxuXHQgKi9cblx0bGlmdEZpZWxkcz86IHN0cmluZ1tdO1xuXHQvKiogTWVyZ2Uge0BsaW5rIERFRkFVTFRfTElGVF9GSUVMRFN9IHdpdGgge0BsaW5rIGxpZnRGaWVsZHN9LiBEZWZhdWx0IHRydWUuIFNldCBmYWxzZSB0byBsaWZ0IE9OTFkgeW91ciBsaXN0LiAqL1xuXHRsaWZ0RmllbGREZWZhdWx0cz86IGJvb2xlYW47XG5cdC8qKlxuXHQgKiBSZWxlYXNlL3ZlcnNpb24gc3RhbXBlZCBvbiBldmVyeSBzaGlwcGVkIGxpbmUgKGB2ZXJzaW9uYCBmaWVsZCkgc28gYmVoYXZpb3IgY2hhbmdlcyBjYW4gYmUgYXR0cmlidXRlZFxuXHQgKiB0byBhIGRlcGxveS4gUmVzb2x2ZWQgQVVUT01BVElDQUxMWSBzbyBuZWl0aGVyIHRoZSBhcHAgbm9yIENJIGhhcyB0byBtYWludGFpbiBpdCAoc2VlXG5cdCAqIHtAbGluayBMb2dGb3J3YXJkZXJDb25zdHJ1Y3QucmVzb2x2ZVZlcnNpb259KTogZXhwbGljaXQgdmFsdWUgLyBgRk9SV0FSREVSX1ZFUlNJT05gIOKGkiB0aGUgQ0kgY29tbWl0XG5cdCAqIChgR0lUSFVCX1NIQWAsIHNldCBhdXRvbWF0aWNhbGx5IGJ5IEdpdEh1YiBBY3Rpb25zKSDihpIgdGhlIGFwcCdzIGBwYWNrYWdlLmpzb25gIHZlcnNpb24g4oaSIG9taXR0ZWQuXG5cdCAqIE9ubHkgc2V0IHRoaXMgdG8gZm9yY2UgYSBzcGVjaWZpYyB2YWx1ZS5cblx0ICovXG5cdHZlcnNpb24/OiBzdHJpbmc7XG5cdC8qKlxuXHQgKiBXaGljaCBjb25zdHJ1Y3QgdHJlZSB0byBzdWJzY3JpYmUuXG5cdCAqIC0gYCdzdGFjaydgIChkZWZhdWx0KTogdGhlIGZvcndhcmRlcidzIHN0YWNrIGFuZCBhbnkgbmVzdGVkIHN0YWNrcyB1bmRlciBpdCAoY292ZXJzIHRoZSBjb21tb25cblx0ICogICBzYXRlbGxpdGUgYXBwLCBpbmNsdWRpbmcgcGVyLWNvbnRyb2xsZXIgbmVzdGVkIHN0YWNrcyBwYXJlbnRlZCB0byB0aGUgZGVmYXVsdCBzdGFjaykuXG5cdCAqIC0gYCdhcHAnYDogdGhlIHdob2xlIENESyBhcHAg4oCUIHVzZSB3aGVuIGEgYmFja2VuZCBoYXMgaW5kZXBlbmRlbnQgdG9wLWxldmVsIHN0YWNrcyAoZS5nLiBhIHNlcGFyYXRlXG5cdCAqICAgYHBlcnNpc3RlbnRgL2RhdGEgc3RhY2spLiBOb3RlIHRoaXMgY3JlYXRlcyBjcm9zcy1zdGFjayBzdWJzY3JpcHRpb27ihpJmb3J3YXJkZXIgcmVmZXJlbmNlcywgc29cblx0ICogICB2ZXJpZnkgc3ludGggZG9lc24ndCBpbnRyb2R1Y2UgYSBjeWNsaWMgc3RhY2sgZGVwZW5kZW5jeS5cblx0ICovXG5cdHN1YnNjcmliZVNjb3BlPzogJ3N0YWNrJyB8ICdhcHAnO1xuXHQvKiogRm9yd2FyZGVyIGZ1bmN0aW9uIG1lbW9yeSAoTUIpLiBEZWZhdWx0IDI1Ni4gKi9cblx0bWVtb3J5U2l6ZT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlciBmdW5jdGlvbiB0aW1lb3V0IChzZWNvbmRzKS4gRGVmYXVsdCAzMC4gKi9cblx0dGltZW91dFNlY29uZHM/OiBudW1iZXI7XG5cdC8qKlxuXHQgKiBDYXAgZm9yd2FyZGVyIGNvbmN1cnJlbmN5IHRvIHByb3RlY3QgdGhlIGluZ2VzdCBmcm9tIGEgbG9nIHN0b3JtLiBPcHQtaW46IHJlc2VydmluZyBjb25jdXJyZW5jeVxuXHQgKiBzdWJ0cmFjdHMgZnJvbSB0aGUgYWNjb3VudCdzIHNoYXJlZCBwb29sLCBzbyBhIGJhZCB2YWx1ZSBjYW4gZmFpbCBkZXBsb3lzIGluIGNvbnN0cmFpbmVkIGFjY291bnRzLlxuXHQgKiBSZWNvbW1lbmRlZCBpbiBwcm9kIChlLmcuIDEw4oCTMjApLlxuXHQgKi9cblx0cmVzZXJ2ZWRDb25jdXJyZW5jeT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlcidzIG93biBsb2cgcmV0ZW50aW9uLiBEZWZhdWx0OiBvbmUgd2Vlay4gKi9cblx0bG9nUmV0ZW50aW9uPzogUmV0ZW50aW9uRGF5cztcbn1cblxuLyoqXG4gKiBDdXJhdGVkLCBnZW5lcmFsbHktc2FmZSBkZWZhdWx0IG5vaXNlL3NldmVyaXR5IHJ1bGVzIOKAlCBtaXJyb3JzIHRoZSBMb2d0cmFpbCBWZWN0b3IgXCJBMVwiIGxpc3Qgc28gYVxuICogYmFja2VuZCBnZXRzIHNlbnNpYmxlIGxvZyBoeWdpZW5lIG91dCBvZiB0aGUgYm94LiBNZXJnZS1pbiBieSBkZWZhdWx0OyBvdmVycmlkZSB2aWFcbiAqIHtAbGluayBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLnVzZURlZmF1bHRzfS4gRXhwb3J0ZWQgc28gYXBwcyBjYW4gaW5zcGVjdCAvIGV4dGVuZCB0aGUgbGlzdHMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUzogUmVxdWlyZWQ8T21pdDxMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLCAndXNlRGVmYXVsdHMnPj4gPSB7XG5cdC8vIEJlbmlnbiBcImVycm9yc1wiIOKGkiB3YXJuLCBzbyBlcnJvciBjb3VudHMgc3RheSBtZWFuaW5nZnVsLlxuXHRiZW5pZ246IFtcblx0XHQnXFxcXGJFQ09OTlJFU0VUXFxcXGInLFxuXHRcdCdcXFxcYkVQSVBFXFxcXGInLFxuXHRcdCdicm9rZW4gcGlwZScsXG5cdFx0J2NsaWVudCAoPzpjbG9zZWQgcmVxdWVzdHxkaXNjb25uZWN0ZWQpJyxcblx0XHQnY29ubmVjdGlvbiByZXNldCBieSBwZWVyJyxcblx0XHQnY29udGV4dCBjYW5jZWxlZCcsXG5cdFx0J3JlcXVlc3QgYWJvcnRlZCcsXG5cdF0sXG5cdC8vIEhlYWx0aC9wcm9iZSBub2lzZSDihpIgZHJvcHBlZC5cblx0ZHJvcDogW1xuXHRcdCdHRVQgLyg/OmhlYWx0aHxoZWFsdGh6fHJlYWR5enxsaXZlenxwaW5nKVxcXFxiJyxcblx0XHQnXFxcXGJrdWJlLXByb2JlXFxcXGInLFxuXHRcdCdFTEItSGVhbHRoQ2hlY2tlcicsXG5cdF0sXG5cdC8vIExvdy12YWx1ZSBub2lzZSDihpIgZGVidWcgKGtlcHQsIGRlLWVtcGhhc2lzZWQpLlxuXHRkb3duZ3JhZGU6IFtcblx0XHQnZGVwcmVjYXRpb24uP3dhcm5pbmcnLFxuXHRcdCcvZmF2aWNvblxcXFwuaWNvJyxcblx0XSxcbn07XG5cbi8qKlxuICogRmllbGRzIGxpZnRlZCBmcm9tIHRzbG9nIGFyZ3MgaW50byBxdWVyeWFibGUgcmVjb3JkIGZpZWxkcyBieSBkZWZhdWx0LiBgY29ycmVsYXRpb25JZGAgaXMgZncyNCdzXG4gKiBjcm9zcy1zZXJ2aWNlIHRyYWNlIGlkLCBzbyBsaWZ0aW5nIGl0IG91dCBvZiB0aGUgYm94IGxldHMgTG9ndHJhaWwgZm9sbG93IGEgcmVxdWVzdCBhY3Jvc3Mgc2VydmljZXNcbiAqIHRoZSBtb21lbnQgYW4gYXBwIGxvZ3MgaXQuIEFwcHMgYWRkIHRoZWlyIG93biBidXNpbmVzcyBpZHMgKG9yZGVySWQsIHVzZXJJZCwg4oCmKSB2aWEgYGxpZnRGaWVsZHNgLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9MSUZUX0ZJRUxEUyA9IFsgJ2NvcnJlbGF0aW9uSWQnIF07XG5cbi8vIENESy1pbnRlcm5hbCAvIGN1c3RvbS1yZXNvdXJjZSBsYW1iZGFzIHdlIG5ldmVyIHN1YnNjcmliZSAobm9pc2UgKyBjcm9zcy1zdGFjayBzaW5nbGV0b25zKSxcbi8vIHBsdXMgdGhlIGZvcndhcmRlciBpdHNlbGYgKGJlbHQtYW5kLXN1c3BlbmRlcnM7IGl0IGlzIGFsc28gZXhjbHVkZWQgYnkgcmVmZXJlbmNlKS5cbmNvbnN0IERFRkFVTFRfU0tJUF9TVUJTVFJJTkdTID0gW1xuXHQnTG9nUmV0ZW50aW9uJyxcblx0J0N1c3RvbTo6Jyxcblx0J2ZyYW1ld29yay1vbkV2ZW50Jyxcblx0J0FXU0NES0NmbicsXG5cdCdCdWNrZXROb3RpZmljYXRpb25zSGFuZGxlcicsXG5cdCdQcm92aWRlcicsXG5cdCdMb2dGb3J3YXJkZXInLFxuXTtcblxuY2xhc3MgTG9nU2hpcHBpbmdBc3BlY3QgaW1wbGVtZW50cyBJQXNwZWN0IHtcblx0Y29uc3RydWN0b3IoXG5cdFx0cHJpdmF0ZSByZWFkb25seSBmb3J3YXJkZXI6IExhbWJkYUZ1bmN0aW9uLFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgaW52b2tlUGVybWlzc2lvbjogSUNvbnN0cnVjdCxcblx0XHRwcml2YXRlIHJlYWRvbmx5IGZpbHRlclBhdHRlcm46IElGaWx0ZXJQYXR0ZXJuLFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgc2tpcFN1YnN0cmluZ3M6IHN0cmluZ1tdLFxuXHQpIHt9XG5cblx0dmlzaXQobm9kZTogSUNvbnN0cnVjdCk6IHZvaWQge1xuXHRcdGlmICghKG5vZGUgaW5zdGFuY2VvZiBMYW1iZGFGdW5jdGlvbikpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aWYgKG5vZGUgPT09IHRoaXMuZm9yd2FyZGVyKSB7XG5cdFx0XHRyZXR1cm47IC8vIG5ldmVyIHN1YnNjcmliZSB0aGUgZm9yd2FyZGVyIHRvIGl0c2VsZiDigJQgaW5maW5pdGUgbG9vcFxuXHRcdH1cblx0XHRjb25zdCBub2RlUGF0aCA9IG5vZGUubm9kZS5wYXRoO1xuXHRcdGlmICh0aGlzLnNraXBTdWJzdHJpbmdzLnNvbWUoKHMpID0+IG5vZGVQYXRoLmluY2x1ZGVzKHMpKSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAobm9kZS5ub2RlLnRyeUZpbmRDaGlsZCgnTG9nU2hpcFN1YnNjcmlwdGlvbicpKSB7XG5cdFx0XHRyZXR1cm47IC8vIGFzcGVjdHMgY2FuIHZpc2l0IGEgbm9kZSBtb3JlIHRoYW4gb25jZTsgYWRkIHRoZSBmaWx0ZXIgb25seSBvbmNlXG5cdFx0fVxuXHRcdHRyeSB7XG5cdFx0XHRjb25zdCBmaWx0ZXIgPSBuZXcgU3Vic2NyaXB0aW9uRmlsdGVyKG5vZGUsICdMb2dTaGlwU3Vic2NyaXB0aW9uJywge1xuXHRcdFx0XHRsb2dHcm91cDogbm9kZS5sb2dHcm91cCxcblx0XHRcdFx0Ly8gYWRkUGVybWlzc2lvbnM6ZmFsc2Ug4oCUIGEgc2luZ2xlIHdpbGRjYXJkIGludm9rZSBwZXJtaXNzaW9uIGlzIGFkZGVkIG9uIHRoZSBmb3J3YXJkZXIgaW5cblx0XHRcdFx0Ly8gY29uc3RydWN0KCksIHNvIHdlIGRvbid0IGFjY3VtdWxhdGUgb25lIENmblBlcm1pc3Npb24gcGVyIGxvZyBncm91cC5cblx0XHRcdFx0ZGVzdGluYXRpb246IG5ldyBMYW1iZGFEZXN0aW5hdGlvbih0aGlzLmZvcndhcmRlciwgeyBhZGRQZXJtaXNzaW9uczogZmFsc2UgfSksXG5cdFx0XHRcdGZpbHRlclBhdHRlcm46IHRoaXMuZmlsdGVyUGF0dGVybixcblx0XHRcdH0pO1xuXHRcdFx0Ly8gQ1JJVElDQUw6IHdpdGggYWRkUGVybWlzc2lvbnM6ZmFsc2UgdGhlcmUgaXMgbm8gYXV0b21hdGljIGRlcGVuZGVuY3kgYmV0d2VlbiB0aGUgZmlsdGVyIGFuZFxuXHRcdFx0Ly8gdGhlIChzaW5nbGUsIHdpbGRjYXJkKSBpbnZva2UgcGVybWlzc2lvbi4gT24gYSBGUkVTSCBkZXBsb3kgQ2xvdWRGb3JtYXRpb24gd291bGQgb3RoZXJ3aXNlXG5cdFx0XHQvLyByYWNlIGFuZCBjcmVhdGUgdGhlIGZpbHRlciBiZWZvcmUgdGhlIHBlcm1pc3Npb24sIHNvIENsb3VkV2F0Y2ggTG9ncyBjYW4ndCBpbnZva2UgdGhlXG5cdFx0XHQvLyBmb3J3YXJkZXIg4oaSIFwiQ291bGQgbm90IGV4ZWN1dGUgdGhlIGxhbWJkYSBmdW5jdGlvblwiIDQwMC4gRm9yY2UgdGhlIG9yZGVyaW5nIGV4cGxpY2l0bHkuXG5cdFx0XHRmaWx0ZXIubm9kZS5hZGREZXBlbmRlbmN5KHRoaXMuaW52b2tlUGVybWlzc2lvbik7XG5cdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHQvLyBBIGxhbWJkYSB3aXRob3V0IGFuIGFkZHJlc3NhYmxlIGxvZyBncm91cCAocmFyZSBDREsgaW50ZXJuYWxzKSBtdXN0IG5ldmVyIGJyZWFrIHN5bnRoLlxuXHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdGNvbnNvbGUud2FybihgW0xvZ0ZvcndhcmRlcl0gc2tpcHBlZCAke25vZGVQYXRofTogJHsoZXJyIGFzIEVycm9yKS5tZXNzYWdlfWApO1xuXHRcdH1cblx0fVxufVxuXG4vKipcbiAqIE91dC1vZi1iYW5kIGxvZyBzaGlwcGluZyBmb3IgZXZlcnkgTGFtYmRhIGluIHRoZSBhcHAuXG4gKlxuICogQXR0YWNoZXMgYSBDbG91ZFdhdGNoIExvZ3Mgc3Vic2NyaXB0aW9uIGZpbHRlciB0byBlYWNoIGZ1bmN0aW9uJ3MgbG9nIGdyb3VwICh2aWEgYW4gQXNwZWN0KSwgcm91dGluZ1xuICogYmF0Y2hlZCwgZ3ppcHBlZCBldmVudHMgdG8gYSBzaW5nbGUgdGlueSBmb3J3YXJkZXIgTGFtYmRhIHRoYXQgc2hpcHMgdGhlbSB0byBhIFZlY3Rvci9Mb2d0cmFpbCBIVFRQXG4gKiBpbmdlc3QuIE5vdGhpbmcgcnVucyBpbiB0aGUgYXBwIHJlcXVlc3QgcGF0aCAoZnVuY3Rpb25zIG9ubHkgd3JpdGUgc3Rkb3V0KSwgc28gbG9nIHZvbHVtZSBuZXZlclxuICogZGVncmFkZXMgcmVxdWVzdCBsYXRlbmN5IGFuZCB0aGVyZSBhcmUgbm8gcGVyLWxvZyBIVFRQIGNhbGxzIGZyb20gdGhlIGhhbmRsZXJzLlxuICpcbiAqIEluc2lkZSB0aGUgZm9yd2FyZGVyLCBlYWNoIGxpbmUgcnVucyB0aHJvdWdoIGEgNC1zdGVwIHBpcGVsaW5lOiBOT1JNQUxJWkUgKHBlZWwgTGFtYmRhIHByZWZpeCwgbGlmdFxuICogZncyNCB0c2xvZyBKU09OLCBzdHJpcCBBTlNJKSDihpIgUkVDTEFTU0lGWSBiZW5pZ24gZXJyb3JzIOKGkiBEUk9QIG5vaXNlIOKGkiBET1dOR1JBREUgbm9pc2UuIFN0ZXBzIDLigJM0IGFyZVxuICogYXBwLW93bmVkIHJ1bGUgbGlzdHMgKHNlZSB7QGxpbmsgTG9nRm9yd2FyZGVyTm9pc2VSdWxlc30gLyB7QGxpbmsgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVN9KS5cbiAqXG4gKiBEZXBsb3ktdGltZSBjb25maWcgaXMgcmVhZCBmcm9tIGBGT1JXQVJERVJfKmAgZW52IHdoZW4gbm90IHBhc3NlZCBleHBsaWNpdGx5LiBgRk9SV0FSREVSXypgIGlzIHVzZWRcbiAqIChuZXZlciBgTE9HVFJBSUxfKmApIG9uIHB1cnBvc2U6IHNldHRpbmcgYExPR1RSQUlMXypgIGluIHRoZSBkZXBsb3kgc2hlbGwgd291bGQgYWN0aXZhdGUgZncyNCdzXG4gKiBpbi1wcm9jZXNzIGxvZyB0cmFuc3BvcnQgYW5kIGxlYWsgbG9jYWwgQ0RLL3N5bnRoIGxvZ3MgdG8gdGhlIGluZ2VzdC5cbiAqL1xuZXhwb3J0IGNsYXNzIExvZ0ZvcndhcmRlckNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuXHRyZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXHRyZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoTG9nRm9yd2FyZGVyQ29uc3RydWN0Lm5hbWUpO1xuXHRuYW1lID0gTG9nRm9yd2FyZGVyQ29uc3RydWN0Lm5hbWU7XG5cdGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcblx0b3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblx0bWFpblN0YWNrITogU3RhY2s7XG5cblx0Y29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjb25maWc6IExvZ0ZvcndhcmRlckNvbnN0cnVjdENvbmZpZyA9IHt9KSB7fVxuXG5cdHByaXZhdGUgcmVzb2x2ZU5vaXNlRW52KCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuXHRcdGNvbnN0IHJ1bGVzID0gdGhpcy5jb25maWcubm9pc2UgPz8ge307XG5cdFx0Y29uc3QgdXNlRGVmYXVsdHMgPSBydWxlcy51c2VEZWZhdWx0cyAhPT0gZmFsc2U7XG5cdFx0Y29uc3QgbWVyZ2UgPSAobGlzdDogc3RyaW5nW10gfCB1bmRlZmluZWQsIGRlZmF1bHRzOiBzdHJpbmdbXSk6IHN0cmluZ1tdID0+IHtcblx0XHRcdGNvbnN0IGJhc2UgPSB1c2VEZWZhdWx0cyA/IGRlZmF1bHRzIDogW107XG5cdFx0XHQvLyBEZS1kdXAgd2hpbGUgcHJlc2VydmluZyBvcmRlciAoZGVmYXVsdHMgZmlyc3QsIHRoZW4gYXBwIGFkZGl0aW9ucykuXG5cdFx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KFsgLi4uYmFzZSwgLi4uKGxpc3QgPz8gW10pIF0pIF07XG5cdFx0fTtcblx0XHRjb25zdCBiZW5pZ24gPSBtZXJnZShydWxlcy5iZW5pZ24sIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmJlbmlnbik7XG5cdFx0Y29uc3QgZHJvcCA9IG1lcmdlKHJ1bGVzLmRyb3AsIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmRyb3ApO1xuXHRcdGNvbnN0IGRvd25ncmFkZSA9IG1lcmdlKHJ1bGVzLmRvd25ncmFkZSwgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVMuZG93bmdyYWRlKTtcblx0XHRjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblx0XHRpZiAoYmVuaWduLmxlbmd0aCkgZW52LkZPUldBUkRFUl9OT0lTRV9CRU5JR04gPSBKU09OLnN0cmluZ2lmeShiZW5pZ24pO1xuXHRcdGlmIChkcm9wLmxlbmd0aCkgZW52LkZPUldBUkRFUl9OT0lTRV9EUk9QID0gSlNPTi5zdHJpbmdpZnkoZHJvcCk7XG5cdFx0aWYgKGRvd25ncmFkZS5sZW5ndGgpIGVudi5GT1JXQVJERVJfTk9JU0VfRE9XTkdSQURFID0gSlNPTi5zdHJpbmdpZnkoZG93bmdyYWRlKTtcblx0XHRyZXR1cm4gZW52O1xuXHR9XG5cblx0LyoqIEFwcC1kZWNsYXJlZCBmaWVsZHMgdG8gbGlmdCwgbWVyZ2VkIHdpdGgge0BsaW5rIERFRkFVTFRfTElGVF9GSUVMRFN9IHVubGVzcyBsaWZ0RmllbGREZWZhdWx0cyBpcyBmYWxzZS4gKi9cblx0LyoqXG5cdCAqIFJlc29sdmUgdGhlIHZlcnNpb24gc3RhbXAgYXV0b21hdGljYWxseSDigJQgbm8gYXBwIGNvZGUgb3IgQ0kgd2lyaW5nIHRvIG1haW50YWluOlxuXHQgKiAgIGV4cGxpY2l0IGNvbmZpZyAvIGBGT1JXQVJERVJfVkVSU0lPTmAg4oaSIGBHSVRIVUJfU0hBYCAoYXV0byBpbiBHaXRIdWIgQWN0aW9ucywgZmlyc3QgMTIpIOKGklxuXHQgKiAgIHRoZSBhcHAncyBwYWNrYWdlLmpzb24gdmVyc2lvbiAoYXV0by1idW1wZWQgYnkgcmVsZWFzZSBDSSwgcmVhZCBhdCBzeW50aCkg4oaSICcnIChvbWl0dGVkKS5cblx0ICovXG5cdHByaXZhdGUgcmVzb2x2ZVZlcnNpb24oKTogc3RyaW5nIHtcblx0XHRjb25zdCBleHBsaWNpdCA9IHRoaXMuY29uZmlnLnZlcnNpb24/LnRyaW0oKSB8fCBwcm9jZXNzLmVudi5GT1JXQVJERVJfVkVSU0lPTj8udHJpbSgpO1xuXHRcdGlmIChleHBsaWNpdCkgcmV0dXJuIGV4cGxpY2l0O1xuXHRcdGNvbnN0IHNoYSA9IHByb2Nlc3MuZW52LkdJVEhVQl9TSEE/LnRyaW0oKTtcblx0XHRpZiAoc2hhKSByZXR1cm4gc2hhLnNsaWNlKDAsIDEyKTtcblx0XHR0cnkge1xuXHRcdFx0Y29uc3QgcGtnUGF0aCA9IHBhdGguam9pbihwcm9jZXNzLmN3ZCgpLCAncGFja2FnZS5qc29uJyk7XG5cdFx0XHRpZiAoZXhpc3RzU3luYyhwa2dQYXRoKSkge1xuXHRcdFx0XHRjb25zdCBwa2cgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhwa2dQYXRoLCAndXRmOCcpKSBhcyB7IHZlcnNpb24/OiB1bmtub3duIH07XG5cdFx0XHRcdGlmICh0eXBlb2YgcGtnLnZlcnNpb24gPT09ICdzdHJpbmcnICYmIHBrZy52ZXJzaW9uLnRyaW0oKSkgcmV0dXJuIHBrZy52ZXJzaW9uLnRyaW0oKTtcblx0XHRcdH1cblx0XHR9IGNhdGNoIHtcblx0XHRcdC8qIHZlcnNpb24gaXMgYmVzdC1lZmZvcnQg4oCUIG5ldmVyIGZhaWwgc3ludGggb3ZlciBpdCAqL1xuXHRcdH1cblx0XHRyZXR1cm4gJyc7XG5cdH1cblxuXHRwcml2YXRlIHJlc29sdmVMaWZ0RmllbGRzKCk6IHN0cmluZ1tdIHtcblx0XHRjb25zdCB1c2VEZWZhdWx0cyA9IHRoaXMuY29uZmlnLmxpZnRGaWVsZERlZmF1bHRzICE9PSBmYWxzZTtcblx0XHRjb25zdCBiYXNlID0gdXNlRGVmYXVsdHMgPyBERUZBVUxUX0xJRlRfRklFTERTIDogW107XG5cdFx0cmV0dXJuIFsgLi4ubmV3IFNldChbIC4uLmJhc2UsIC4uLih0aGlzLmNvbmZpZy5saWZ0RmllbGRzID8/IFtdKSBdLm1hcCgocykgPT4gcy50cmltKCkpLmZpbHRlcihCb29sZWFuKSkgXTtcblx0fVxuXG5cdGFzeW5jIGNvbnN0cnVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcblx0XHQvLyBEZWZhdWx0IHN0YWNrIChubyBoYXJkY29kZWQgbmFtZSkg4oCUIHJlc3BlY3RzIHN0YWNrTmFtZS9wYXJlbnRTdGFja05hbWUgaWYgdGhlIGFwcCBzZXRzIHRoZW0uXG5cdFx0dGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5jb25maWcuc3RhY2tOYW1lLCB0aGlzLmNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXHRcdGNvbnN0IG8gPSB0aGlzLmNvbmZpZztcblxuXHRcdGNvbnN0IGZvcndhcmRlckxvZ0dyb3VwID0gbmV3IExvZ0dyb3VwKHRoaXMubWFpblN0YWNrLCAnTG9nRm9yd2FyZGVyRnVuY3Rpb25Mb2dHcm91cCcsIHtcblx0XHRcdHJldGVudGlvbjogby5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcblx0XHRcdHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcblx0XHR9KTtcblxuXHRcdC8vIHNlcnZpY2UvZW52IGRlZmF1bHQgdG8gd2hhdCBmdzI0IGFscmVhZHkga25vd3MgKGh5ZHJhdGVkIGZyb20gQVBQX05BTUUgLyBBUFBfRU5WSVJPTk1FTlQpLCBzbyBhXG5cdFx0Ly8gYmFja2VuZCB1c3VhbGx5IGRvZXNuJ3QgcGFzcyB0aGVtLiBQcmVjZWRlbmNlOiBleHBsaWNpdCBvcHRpb24gPiBGT1JXQVJERVJfKiBlbnYgPiBmdzI0IGNvbmZpZy5cblx0XHRjb25zdCBjZmcgPSB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCk7XG5cdFx0Y29uc3QgaW5nZXN0SHR0cFVybCA9IG8uaW5nZXN0SHR0cFVybCA/PyBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1VSTD8udHJpbSgpID8/ICcnO1xuXHRcdGNvbnN0IHNlcnZpY2UgPSBvLnNlcnZpY2UgPz8gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9TRVJWSUNFPy50cmltKCkgfHwgdGhpcy5mdzI0LmFwcE5hbWUgfHwgJycpO1xuXHRcdGNvbnN0IGVudiA9IG8uZW52ID8/IChwcm9jZXNzLmVudi5GT1JXQVJERVJfRU5WPy50cmltKCkgfHwgY2ZnLmVudmlyb25tZW50IHx8ICcnKTtcblx0XHRjb25zdCB4QXBpS2V5ID0gby54QXBpS2V5ID8/IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZPy50cmltKCk7XG5cdFx0Y29uc3QgbGlmdEZpZWxkcyA9IHRoaXMucmVzb2x2ZUxpZnRGaWVsZHMoKTtcblx0XHRjb25zdCB2ZXJzaW9uID0gdGhpcy5yZXNvbHZlVmVyc2lvbigpO1xuXG5cdFx0aWYgKCFpbmdlc3RIdHRwVXJsKSB7XG5cdFx0XHQvLyBOb24tZmF0YWw6IHRoZSBmb3J3YXJkZXIgaGFuZGxlciBuby1vcHMgd2l0aG91dCBhbiBpbmdlc3QgVVJMLCBzbyBhIGJhY2tlbmQgY2FuIGFkb3B0IHRoZVxuXHRcdFx0Ly8gY29uc3RydWN0IGJlZm9yZSB0aGUgaW5nZXN0IGlzIHdpcmVkLiBXYXJuIHNvIGl0IGlzbid0IGEgc2lsZW50IG5vLW9wLlxuXHRcdFx0dGhpcy5sb2dnZXIud2Fybihcblx0XHRcdFx0J0xvZ0ZvcndhcmRlckNvbnN0cnVjdDogbm8gaW5nZXN0IFVSTCAoY29uZmlnLmluZ2VzdEh0dHBVcmwgLyBGT1JXQVJERVJfSU5HRVNUX1VSTCkuICdcblx0XHRcdFx0XHQrICdGb3J3YXJkZXIgZGVwbG95cyBidXQgc2hpcHMgbm90aGluZyB1bnRpbCBvbmUgaXMgc2V0LicsXG5cdFx0XHQpO1xuXHRcdH1cblxuXHRcdC8vIEZyYW1ld29yay1vd25lZCBoYW5kbGVyIHNoaXBwZWQgY29tcGlsZWQgaW4gZGlzdCAobWlycm9ycyBtYWlsZXIvZHluYW1vIGhhbmRsZXJzKS4gUmVzb2x2ZSB0aGVcblx0XHQvLyBjb21waWxlZCBgLmpzYCB3aGVuIGluc3RhbGxlZCAoZGlzdCksIGZhbGxpbmcgYmFjayB0byB0aGUgYC50c2Agc291cmNlIHdoZW4gcnVubmluZyBmcm9tIGZ3MjQnc1xuXHRcdC8vIG93biBzcmMgKHVuaXQgdGVzdHMgLyB0cy1ub2RlIGRldikgd2hlcmUgdGhlIGAuanNgIGhhc24ndCBiZWVuIGVtaXR0ZWQuXG5cdFx0Y29uc3QgaGFuZGxlckJhc2UgPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vY29yZS9ydW50aW1lL2xvZy1mb3J3YXJkZXItaGFuZGxlcicpO1xuXHRcdGNvbnN0IGhhbmRsZXJFbnRyeSA9IGV4aXN0c1N5bmMoYCR7aGFuZGxlckJhc2V9LmpzYCkgPyBgJHtoYW5kbGVyQmFzZX0uanNgIDogYCR7aGFuZGxlckJhc2V9LnRzYDtcblxuXHRcdGNvbnN0IGZvcndhcmRlciA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgJ0xvZ0ZvcndhcmRlckZ1bmN0aW9uJywge1xuXHRcdFx0ZW50cnk6IGhhbmRsZXJFbnRyeSxcblx0XHRcdGhhbmRsZXI6ICdoYW5kbGVyJyxcblx0XHRcdHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG5cdFx0XHRtZW1vcnlTaXplOiBvLm1lbW9yeVNpemUgPz8gMjU2LFxuXHRcdFx0dGltZW91dDogRHVyYXRpb24uc2Vjb25kcyhvLnRpbWVvdXRTZWNvbmRzID8/IDMwKSxcblx0XHRcdC4uLihvLnJlc2VydmVkQ29uY3VycmVuY3kgIT0gbnVsbCA/IHsgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogby5yZXNlcnZlZENvbmN1cnJlbmN5IH0gOiB7fSksXG5cdFx0XHRsb2dHcm91cDogZm9yd2FyZGVyTG9nR3JvdXAsXG5cdFx0XHRidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsgJ0Bhd3Mtc2RrJyBdLCBtaW5pZnk6IHRydWUgfSxcblx0XHRcdC8vIEZvcndhcmRlciBydW50aW1lIGVudiBpcyBmdWxseSBGT1JXQVJERVJfKi1uYW1lc3BhY2VkIOKAlCBubyBMT0dUUkFJTF8qIGtleXMsIHNvIGl0IGNhbiBuZXZlclxuXHRcdFx0Ly8gY29sbGlkZSB3aXRoIGZ3MjQncyBpbi1wcm9jZXNzIHRyYW5zcG9ydC5cblx0XHRcdGVudmlyb25tZW50OiB7XG5cdFx0XHRcdEZPUldBUkRFUl9JTkdFU1RfVVJMOiBpbmdlc3RIdHRwVXJsLFxuXHRcdFx0XHRGT1JXQVJERVJfU0VSVklDRTogc2VydmljZSxcblx0XHRcdFx0Rk9SV0FSREVSX0VOVjogZW52LFxuXHRcdFx0XHQuLi4oeEFwaUtleSA/IHsgRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk6IHhBcGlLZXkgfSA6IHt9KSxcblx0XHRcdFx0Li4uKG8uYmF0Y2hGb3JtYXQgPyB7IEZPUldBUkRFUl9CQVRDSF9GT1JNQVQ6IG8uYmF0Y2hGb3JtYXQgfSA6IHt9KSxcblx0XHRcdFx0Li4uKG8ubWF4QmF0Y2hCeXRlcyAhPSBudWxsID8geyBGT1JXQVJERVJfTUFYX0JBVENIX0JZVEVTOiBTdHJpbmcoby5tYXhCYXRjaEJ5dGVzKSB9IDoge30pLFxuXHRcdFx0XHQuLi4obGlmdEZpZWxkcy5sZW5ndGggPyB7IEZPUldBUkRFUl9GSUVMRFM6IEpTT04uc3RyaW5naWZ5KGxpZnRGaWVsZHMpIH0gOiB7fSksXG5cdFx0XHRcdC4uLih2ZXJzaW9uID8geyBGT1JXQVJERVJfVkVSU0lPTjogdmVyc2lvbiB9IDoge30pLFxuXHRcdFx0XHQuLi50aGlzLnJlc29sdmVOb2lzZUVudigpLFxuXHRcdFx0fSxcblx0XHR9KTtcblxuXHRcdC8vIE9uZSBicm9hZCBpbnZva2UgcGVybWlzc2lvbiBpbnN0ZWFkIG9mIG9uZSBwZXIgbG9nIGdyb3VwOiBrZWVwcyB0aGUgZm9yd2FyZGVyJ3MgcmVzb3VyY2UgcG9saWN5XG5cdFx0Ly8gc21hbGwgKExhbWJkYSBjYXBzIGl0IGF0IH4yMEtCKSBhcyB0aGUgbnVtYmVyIG9mIHN1YnNjcmliZWQgZnVuY3Rpb25zIGdyb3dzLiBDcmVhdGVkIGFzIGFuXG5cdFx0Ly8gZXhwbGljaXQgQ2ZuUGVybWlzc2lvbiBzbyBldmVyeSBzdWJzY3JpcHRpb24gZmlsdGVyIGNhbiBgYWRkRGVwZW5kZW5jeWAgb24gaXQgKHRoZSBhc3BlY3QpIOKAlFxuXHRcdC8vIHdpdGhvdXQgdGhhdCwgYSBmcmVzaCBkZXBsb3kgcmFjZXMgYW5kIGNyZWF0ZXMgZmlsdGVycyBiZWZvcmUgdGhlIHBlcm1pc3Npb24gKGEgNDAwKS5cblx0XHRjb25zdCBpbnZva2VQZXJtaXNzaW9uID0gbmV3IENmblBlcm1pc3Npb24oZm9yd2FyZGVyLCAnQWxsb3dDbG91ZFdhdGNoTG9nc0ludm9rZScsIHtcblx0XHRcdHByaW5jaXBhbDogJ2xvZ3MuYW1hem9uYXdzLmNvbScsXG5cdFx0XHRhY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nLFxuXHRcdFx0ZnVuY3Rpb25OYW1lOiBmb3J3YXJkZXIuZnVuY3Rpb25OYW1lLFxuXHRcdFx0c291cmNlQWNjb3VudDogdGhpcy5tYWluU3RhY2suYWNjb3VudCxcblx0XHRcdHNvdXJjZUFybjogYGFybjphd3M6bG9nczoke3RoaXMubWFpblN0YWNrLnJlZ2lvbn06JHt0aGlzLm1haW5TdGFjay5hY2NvdW50fTpsb2ctZ3JvdXA6KmAsXG5cdFx0fSk7XG5cblx0XHRjb25zdCBza2lwID0gWyAuLi5ERUZBVUxUX1NLSVBfU1VCU1RSSU5HUywgLi4uKG8uZXhjbHVkZUZ1bmN0aW9uUGF0aFN1YnN0cmluZ3MgPz8gW10pIF07XG5cdFx0Ly8gJ2FwcCcg4oaSIHN1YnNjcmliZSBldmVyeSBMYW1iZGEgaW4gdGhlIHdob2xlIENESyBhcHAgKGluZGVwZW5kZW50IHRvcC1sZXZlbCBzdGFja3MgdG9vKTtcblx0XHQvLyAnc3RhY2snIChkZWZhdWx0KSDihpIgdGhpcyBzdGFjayArIG5lc3RlZCBzdGFja3MgdW5kZXIgaXQuXG5cdFx0Y29uc3Qgc2NvcGVSb290OiBJQ29uc3RydWN0ID1cblx0XHRcdG8uc3Vic2NyaWJlU2NvcGUgPT09ICdhcHAnID8gdGhpcy5tYWluU3RhY2subm9kZS5yb290IDogdGhpcy5tYWluU3RhY2s7XG5cdFx0QXNwZWN0cy5vZihzY29wZVJvb3QpLmFkZChcblx0XHRcdG5ldyBMb2dTaGlwcGluZ0FzcGVjdChmb3J3YXJkZXIsIGludm9rZVBlcm1pc3Npb24sIG8uZmlsdGVyUGF0dGVybiA/PyBGaWx0ZXJQYXR0ZXJuLmFsbEV2ZW50cygpLCBza2lwKSxcblx0XHQpO1xuXG5cdFx0dGhpcy5vdXRwdXQgPSB7fSBhcyBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXHR9XG59XG4iXX0=