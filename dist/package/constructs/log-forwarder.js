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
        const version = o.version ?? process.env.FORWARDER_VERSION?.trim() ?? '';
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2xvZy1mb3J3YXJkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQWtDO0FBQ2xDLHFDQUFxQztBQUNyQyw2Q0FBb0Y7QUFDcEYsdURBQTRGO0FBQzVGLHFFQUErRDtBQUMvRCxtREFBdUg7QUFDdkgsNkVBQXNFO0FBRXRFLHVDQUFvQztBQUdwQyx3Q0FBMEM7QUF3RjFDOzs7O0dBSUc7QUFDVSxRQUFBLHVCQUF1QixHQUEwRDtJQUM3RiwyREFBMkQ7SUFDM0QsTUFBTSxFQUFFO1FBQ1Asa0JBQWtCO1FBQ2xCLGFBQWE7UUFDYixhQUFhO1FBQ2Isd0NBQXdDO1FBQ3hDLDBCQUEwQjtRQUMxQixrQkFBa0I7UUFDbEIsaUJBQWlCO0tBQ2pCO0lBQ0QsZ0NBQWdDO0lBQ2hDLElBQUksRUFBRTtRQUNMLDhDQUE4QztRQUM5QyxrQkFBa0I7UUFDbEIsbUJBQW1CO0tBQ25CO0lBQ0QsaURBQWlEO0lBQ2pELFNBQVMsRUFBRTtRQUNWLHNCQUFzQjtRQUN0QixnQkFBZ0I7S0FDaEI7Q0FDRCxDQUFDO0FBRUY7Ozs7R0FJRztBQUNVLFFBQUEsbUJBQW1CLEdBQUcsQ0FBRSxlQUFlLENBQUUsQ0FBQztBQUV2RCw4RkFBOEY7QUFDOUYscUZBQXFGO0FBQ3JGLE1BQU0sdUJBQXVCLEdBQUc7SUFDL0IsY0FBYztJQUNkLFVBQVU7SUFDVixtQkFBbUI7SUFDbkIsV0FBVztJQUNYLDRCQUE0QjtJQUM1QixVQUFVO0lBQ1YsY0FBYztDQUNkLENBQUM7QUFFRixNQUFNLGlCQUFpQjtJQUVKO0lBQ0E7SUFDQTtJQUNBO0lBSmxCLFlBQ2tCLFNBQXlCLEVBQ3pCLGdCQUE0QixFQUM1QixhQUE2QixFQUM3QixjQUF3QjtRQUh4QixjQUFTLEdBQVQsU0FBUyxDQUFnQjtRQUN6Qixx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QixFQUFFO1lBQ2xGLFNBQVMsRUFBRSxvQkFBb0I7WUFDL0IsTUFBTSxFQUFFLHVCQUF1QjtZQUMvQixZQUFZLEVBQUUsU0FBUyxDQUFDLFlBQVk7WUFDcEMsYUFBYSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTztZQUNyQyxTQUFTLEVBQUUsZ0JBQWdCLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxjQUFjO1NBQ3hGLENBQUMsQ0FBQztRQUVILE1BQU0sSUFBSSxHQUFHLENBQUUsR0FBRyx1QkFBdUIsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLDZCQUE2QixJQUFJLEVBQUUsQ0FBQyxDQUFFLENBQUM7UUFDeEYsMEZBQTBGO1FBQzFGLDJEQUEyRDtRQUMzRCxNQUFNLFNBQVMsR0FDZCxDQUFDLENBQUMsY0FBYyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO1FBQ3hFLHFCQUFPLENBQUMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsQ0FDeEIsSUFBSSxpQkFBaUIsQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDLGFBQWEsSUFBSSx3QkFBYSxDQUFDLFNBQVMsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUN0RyxDQUFDO1FBRUYsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUF5QixDQUFDO0lBQ3pDLENBQUM7Q0FDRDtBQXJIRCxzREFxSEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBBc3BlY3RzLCBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2ssIHR5cGUgSUFzcGVjdCB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENmblBlcm1pc3Npb24sIEZ1bmN0aW9uIGFzIExhbWJkYUZ1bmN0aW9uLCBSdW50aW1lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCB7IEZpbHRlclBhdHRlcm4sIHR5cGUgSUZpbHRlclBhdHRlcm4sIExvZ0dyb3VwLCBSZXRlbnRpb25EYXlzLCBTdWJzY3JpcHRpb25GaWx0ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBMYW1iZGFEZXN0aW5hdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzLWRlc3RpbmF0aW9ucyc7XG5pbXBvcnQgdHlwZSB7IElDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uc3RydWN0JztcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWcnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5cbi8qKlxuICogQXBwLW93bmVkIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMsIGFwcGxpZWQgcGVyIGxvZyBsaW5lIGluc2lkZSB0aGUgZm9yd2FyZGVyIExhbWJkYSAobGF5ZXJzIDLigJM0IG9mIHRoZVxuICogcGlwZWxpbmU7IHNlZSBgTG9nRm9yd2FyZGVyQ29uc3RydWN0YCkuIEVhY2ggbGlzdCBpcyBhbiBhcnJheSBvZiByZWdleCBzb3VyY2Ugc3RyaW5ncywgbWF0Y2hlZFxuICogY2FzZS1pbnNlbnNpdGl2ZWx5IGFnYWluc3QgdGhlIG5vcm1hbGl6ZWQgbWVzc2FnZS4gVGhlc2UgYXJlIGNvbXBsZW1lbnRhcnkgdG8gYW55IGdsb2JhbCBzZXZlcml0eS9cbiAqIG5vaXNlIGhhbmRsaW5nIGEgc2hhcmVkIFZlY3RvciBpbmdlc3QgbWF5IGFsc28gcnVuIOKAlCB0aGlzIGxheWVyIGxldHMgZWFjaCBhcHAgb3duIGl0cyBvd24gcnVsZXMgYW5kLFxuICogZm9yIGBkcm9wYCwgc2F2ZXMgaW5nZXN0IGJhbmR3aWR0aCBieSByZW1vdmluZyBub2lzZSBhdCB0aGUgc291cmNlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExvZ0ZvcndhcmRlck5vaXNlUnVsZXMge1xuXHQvKiogRXJyb3ItaXNoIGxpbmVzIG1hdGNoaW5nIHRoZXNlIGFyZSBkb3duZ3JhZGVkIHRvIGB3YXJuYCAodGFnZ2VkIGByZWNsYXNzaWZpZWQ6IFwiYmVuaWduXCJgKS4gKi9cblx0YmVuaWduPzogc3RyaW5nW107XG5cdC8qKiBMaW5lcyBtYXRjaGluZyB0aGVzZSBhcmUgZHJvcHBlZCBlbnRpcmVseSDigJQgbmV2ZXIgc2hpcHBlZC4gKi9cblx0ZHJvcD86IHN0cmluZ1tdO1xuXHQvKiogTGluZXMgbWF0Y2hpbmcgdGhlc2UgYXJlIGRvd25ncmFkZWQgdG8gYGRlYnVnYCAodGFnZ2VkIGByZWNsYXNzaWZpZWQ6IFwibm9pc2VcImApLiAqL1xuXHRkb3duZ3JhZGU/OiBzdHJpbmdbXTtcblx0LyoqXG5cdCAqIFdoZW4gdHJ1ZSAoZGVmYXVsdCksIHRoZSBidWlsdC1pbiB7QGxpbmsgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVN9IGFyZSBtZXJnZWQgd2l0aCB0aGUgbGlzdHMgYWJvdmUuXG5cdCAqIFNldCBmYWxzZSB0byB1c2UgT05MWSB0aGUgbGlzdHMgeW91IHByb3ZpZGUgKG9yIG5vbmUpLlxuXHQgKi9cblx0dXNlRGVmYXVsdHM/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIExvZ0ZvcndhcmRlckNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuXHQvKiogVmVjdG9yL0xvZ3RyYWlsIEhUVFAgSlNPTiBpbmdlc3QgVVJMLiBEZWZhdWx0cyB0byBgRk9SV0FSREVSX0lOR0VTVF9VUkxgIGF0IGRlcGxveSB0aW1lLiAqL1xuXHRpbmdlc3RIdHRwVXJsPzogc3RyaW5nO1xuXHQvKipcblx0ICogQmFzZSBgc2VydmljZWAgbGFiZWwgZm9yIHNoaXBwZWQgbG9ncyAoZW52IGlzIGZvbGRlZCBpbikuIFVzdWFsbHkgb21pdCDigJQgZGVmYXVsdHMgdG8gdGhlIGZ3MjRcblx0ICogYXBwIG5hbWUgKGBBUFBfTkFNRWApOyBvdmVycmlkZSB3aXRoIHRoaXMgb3B0aW9uIG9yIGBGT1JXQVJERVJfU0VSVklDRWAuXG5cdCAqL1xuXHRzZXJ2aWNlPzogc3RyaW5nO1xuXHQvKipcblx0ICogU3RhZ2Uvb3duZXIgbGFiZWwgKGUuZy4gYGRldmVsb3BgLCBgcHJvZGAsIGBzYW5kYm94LW5pdGluYCkg4oCUIGZvbGRlZCBpbnRvIHRoZSBgc2VydmljZWAgbGFiZWxcblx0ICogKGBteXNlcnZpY2UtZGV2ZWxvcGApIGFuZCBlbWl0dGVkIGFzIGBlbnZgIHNvIGRldmVsb3AvcHJvZC9wZXItZGV2ZWxvcGVyIGxvZ3MgYXJlIGRpc3Rpbmd1aXNoYWJsZVxuXHQgKiBpbiBMb2d0cmFpbC4gVXN1YWxseSBvbWl0IOKAlCBkZWZhdWx0cyB0byB0aGUgZncyNCBlbnZpcm9ubWVudCAoYEFQUF9FTlZJUk9OTUVOVGApOyBvdmVycmlkZSB3aXRoXG5cdCAqIHRoaXMgb3B0aW9uIG9yIGBGT1JXQVJERVJfRU5WYC5cblx0ICovXG5cdGVudj86IHN0cmluZztcblx0LyoqIE9wdGlvbmFsIGB4LWFwaS1rZXlgIHdoZW4gdGhlIGluZ2VzdCBmcm9udCByZXF1aXJlcyBpdC4gRGVmYXVsdHMgdG8gYEZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZYC4gKi9cblx0eEFwaUtleT86IHN0cmluZztcblx0LyoqIEJhdGNoIHdpcmUgZm9ybWF0IOKAlCBtdXN0IG1hdGNoIHlvdXIgVmVjdG9yIGh0dHAgc291cmNlIGRlY29kaW5nLiBEZWZhdWx0OiBganNvbi1hcnJheWAuICovXG5cdGJhdGNoRm9ybWF0PzogJ25kanNvbicgfCAnanNvbi1hcnJheSc7XG5cdC8qKiBNYXggdW5jb21wcmVzc2VkIGJ5dGVzIHBlciBQT1NUICh0aGUgZm9yd2FyZGVyIHNwbGl0cyBsYXJnZXIgYmF0Y2hlcykuIERlZmF1bHQ6IDEsMDAwLDAwMC4gKi9cblx0bWF4QmF0Y2hCeXRlcz86IG51bWJlcjtcblx0LyoqIENsb3VkV2F0Y2ggc3Vic2NyaXB0aW9uLWZpbHRlciBwYXR0ZXJuIOKAlCB0aGUgdm9sdW1lL2Nvc3QgbGV2ZXIgKGUuZy4gb25seSBXQVJOL0VSUk9SKS4gRGVmYXVsdDogYWxsIGV2ZW50cy4gKi9cblx0ZmlsdGVyUGF0dGVybj86IElGaWx0ZXJQYXR0ZXJuO1xuXHQvKiogRXh0cmEgZnVuY3Rpb24gY29uc3RydWN0LXBhdGggc3Vic3RyaW5ncyB0byBza2lwIChuZXZlciBzdWJzY3JpYmUpLiAqL1xuXHRleGNsdWRlRnVuY3Rpb25QYXRoU3Vic3RyaW5ncz86IHN0cmluZ1tdO1xuXHQvKiogQXBwLW93bmVkIG5vaXNlL3NldmVyaXR5IHJ1bGVzIGFwcGxpZWQgaW5zaWRlIHRoZSBmb3J3YXJkZXIgKGxheWVycyAy4oCTNCkuICovXG5cdG5vaXNlPzogTG9nRm9yd2FyZGVyTm9pc2VSdWxlcztcblx0LyoqXG5cdCAqIFN0cnVjdHVyZWQgZmllbGRzIHRvIGxpZnQgZnJvbSB0c2xvZyBhcmdzIGludG8gcXVlcnlhYmxlIHRvcC1sZXZlbCByZWNvcmQgZmllbGRzLCBzbyBMb2d0cmFpbCBjYW5cblx0ICogZm9sbG93IG9uZSByZXF1ZXN0IGFjcm9zcyBzZXJ2aWNlcyBvciBmaWx0ZXIgXCJhbGwgbG9ncyBmb3Igb3JkZXIgOTkxXCIuIE9ubHkgZmllbGRzIHRoZSBhcHAgYWN0dWFsbHlcblx0ICogbG9ncyBhcyBzdHJ1Y3R1cmVkIGFyZ3MgKGUuZy4gYGxvZ2dlci5pbmZvKCdjaGFyZ2UgZmFpbGVkJywgeyBvcmRlcklkLCBjb3JyZWxhdGlvbklkIH0pYCkgYXJlIGxpZnRlZFxuXHQgKiDigJQgdGhlIGZvcndhcmRlciBuZXZlciBzY3JhcGVzIGZyZWUgdGV4dC4ge0BsaW5rIERFRkFVTFRfTElGVF9GSUVMRFN9IChjb3JyZWxhdGlvbklkKSBpcyBtZXJnZWQgaW5cblx0ICogdW5sZXNzIHtAbGluayBsaWZ0RmllbGREZWZhdWx0c30gaXMgZmFsc2UuXG5cdCAqL1xuXHRsaWZ0RmllbGRzPzogc3RyaW5nW107XG5cdC8qKiBNZXJnZSB7QGxpbmsgREVGQVVMVF9MSUZUX0ZJRUxEU30gd2l0aCB7QGxpbmsgbGlmdEZpZWxkc30uIERlZmF1bHQgdHJ1ZS4gU2V0IGZhbHNlIHRvIGxpZnQgT05MWSB5b3VyIGxpc3QuICovXG5cdGxpZnRGaWVsZERlZmF1bHRzPzogYm9vbGVhbjtcblx0LyoqXG5cdCAqIFJlbGVhc2UvdmVyc2lvbiBzdGFtcGVkIG9uIGV2ZXJ5IHNoaXBwZWQgbGluZSAoYHZlcnNpb25gIGZpZWxkKSBzbyBiZWhhdmlvciBjaGFuZ2VzIGNhbiBiZSBhdHRyaWJ1dGVkXG5cdCAqIHRvIGEgZGVwbG95LiBQYXNzIGEgc2VtdmVyIG9yIGdpdCBzaGEuIERlZmF1bHRzIHRvIGBGT1JXQVJERVJfVkVSU0lPTmAgYXQgZGVwbG95IHRpbWU7IG9taXR0ZWQgaWYgdW5zZXQuXG5cdCAqL1xuXHR2ZXJzaW9uPzogc3RyaW5nO1xuXHQvKipcblx0ICogV2hpY2ggY29uc3RydWN0IHRyZWUgdG8gc3Vic2NyaWJlLlxuXHQgKiAtIGAnc3RhY2snYCAoZGVmYXVsdCk6IHRoZSBmb3J3YXJkZXIncyBzdGFjayBhbmQgYW55IG5lc3RlZCBzdGFja3MgdW5kZXIgaXQgKGNvdmVycyB0aGUgY29tbW9uXG5cdCAqICAgc2F0ZWxsaXRlIGFwcCwgaW5jbHVkaW5nIHBlci1jb250cm9sbGVyIG5lc3RlZCBzdGFja3MgcGFyZW50ZWQgdG8gdGhlIGRlZmF1bHQgc3RhY2spLlxuXHQgKiAtIGAnYXBwJ2A6IHRoZSB3aG9sZSBDREsgYXBwIOKAlCB1c2Ugd2hlbiBhIGJhY2tlbmQgaGFzIGluZGVwZW5kZW50IHRvcC1sZXZlbCBzdGFja3MgKGUuZy4gYSBzZXBhcmF0ZVxuXHQgKiAgIGBwZXJzaXN0ZW50YC9kYXRhIHN0YWNrKS4gTm90ZSB0aGlzIGNyZWF0ZXMgY3Jvc3Mtc3RhY2sgc3Vic2NyaXB0aW9u4oaSZm9yd2FyZGVyIHJlZmVyZW5jZXMsIHNvXG5cdCAqICAgdmVyaWZ5IHN5bnRoIGRvZXNuJ3QgaW50cm9kdWNlIGEgY3ljbGljIHN0YWNrIGRlcGVuZGVuY3kuXG5cdCAqL1xuXHRzdWJzY3JpYmVTY29wZT86ICdzdGFjaycgfCAnYXBwJztcblx0LyoqIEZvcndhcmRlciBmdW5jdGlvbiBtZW1vcnkgKE1CKS4gRGVmYXVsdCAyNTYuICovXG5cdG1lbW9yeVNpemU/OiBudW1iZXI7XG5cdC8qKiBGb3J3YXJkZXIgZnVuY3Rpb24gdGltZW91dCAoc2Vjb25kcykuIERlZmF1bHQgMzAuICovXG5cdHRpbWVvdXRTZWNvbmRzPzogbnVtYmVyO1xuXHQvKipcblx0ICogQ2FwIGZvcndhcmRlciBjb25jdXJyZW5jeSB0byBwcm90ZWN0IHRoZSBpbmdlc3QgZnJvbSBhIGxvZyBzdG9ybS4gT3B0LWluOiByZXNlcnZpbmcgY29uY3VycmVuY3lcblx0ICogc3VidHJhY3RzIGZyb20gdGhlIGFjY291bnQncyBzaGFyZWQgcG9vbCwgc28gYSBiYWQgdmFsdWUgY2FuIGZhaWwgZGVwbG95cyBpbiBjb25zdHJhaW5lZCBhY2NvdW50cy5cblx0ICogUmVjb21tZW5kZWQgaW4gcHJvZCAoZS5nLiAxMOKAkzIwKS5cblx0ICovXG5cdHJlc2VydmVkQ29uY3VycmVuY3k/OiBudW1iZXI7XG5cdC8qKiBGb3J3YXJkZXIncyBvd24gbG9nIHJldGVudGlvbi4gRGVmYXVsdDogb25lIHdlZWsuICovXG5cdGxvZ1JldGVudGlvbj86IFJldGVudGlvbkRheXM7XG59XG5cbi8qKlxuICogQ3VyYXRlZCwgZ2VuZXJhbGx5LXNhZmUgZGVmYXVsdCBub2lzZS9zZXZlcml0eSBydWxlcyDigJQgbWlycm9ycyB0aGUgTG9ndHJhaWwgVmVjdG9yIFwiQTFcIiBsaXN0IHNvIGFcbiAqIGJhY2tlbmQgZ2V0cyBzZW5zaWJsZSBsb2cgaHlnaWVuZSBvdXQgb2YgdGhlIGJveC4gTWVyZ2UtaW4gYnkgZGVmYXVsdDsgb3ZlcnJpZGUgdmlhXG4gKiB7QGxpbmsgTG9nRm9yd2FyZGVyTm9pc2VSdWxlcy51c2VEZWZhdWx0c30uIEV4cG9ydGVkIHNvIGFwcHMgY2FuIGluc3BlY3QgLyBleHRlbmQgdGhlIGxpc3RzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVM6IFJlcXVpcmVkPE9taXQ8TG9nRm9yd2FyZGVyTm9pc2VSdWxlcywgJ3VzZURlZmF1bHRzJz4+ID0ge1xuXHQvLyBCZW5pZ24gXCJlcnJvcnNcIiDihpIgd2Fybiwgc28gZXJyb3IgY291bnRzIHN0YXkgbWVhbmluZ2Z1bC5cblx0YmVuaWduOiBbXG5cdFx0J1xcXFxiRUNPTk5SRVNFVFxcXFxiJyxcblx0XHQnXFxcXGJFUElQRVxcXFxiJyxcblx0XHQnYnJva2VuIHBpcGUnLFxuXHRcdCdjbGllbnQgKD86Y2xvc2VkIHJlcXVlc3R8ZGlzY29ubmVjdGVkKScsXG5cdFx0J2Nvbm5lY3Rpb24gcmVzZXQgYnkgcGVlcicsXG5cdFx0J2NvbnRleHQgY2FuY2VsZWQnLFxuXHRcdCdyZXF1ZXN0IGFib3J0ZWQnLFxuXHRdLFxuXHQvLyBIZWFsdGgvcHJvYmUgbm9pc2Ug4oaSIGRyb3BwZWQuXG5cdGRyb3A6IFtcblx0XHQnR0VUIC8oPzpoZWFsdGh8aGVhbHRoenxyZWFkeXp8bGl2ZXp8cGluZylcXFxcYicsXG5cdFx0J1xcXFxia3ViZS1wcm9iZVxcXFxiJyxcblx0XHQnRUxCLUhlYWx0aENoZWNrZXInLFxuXHRdLFxuXHQvLyBMb3ctdmFsdWUgbm9pc2Ug4oaSIGRlYnVnIChrZXB0LCBkZS1lbXBoYXNpc2VkKS5cblx0ZG93bmdyYWRlOiBbXG5cdFx0J2RlcHJlY2F0aW9uLj93YXJuaW5nJyxcblx0XHQnL2Zhdmljb25cXFxcLmljbycsXG5cdF0sXG59O1xuXG4vKipcbiAqIEZpZWxkcyBsaWZ0ZWQgZnJvbSB0c2xvZyBhcmdzIGludG8gcXVlcnlhYmxlIHJlY29yZCBmaWVsZHMgYnkgZGVmYXVsdC4gYGNvcnJlbGF0aW9uSWRgIGlzIGZ3MjQnc1xuICogY3Jvc3Mtc2VydmljZSB0cmFjZSBpZCwgc28gbGlmdGluZyBpdCBvdXQgb2YgdGhlIGJveCBsZXRzIExvZ3RyYWlsIGZvbGxvdyBhIHJlcXVlc3QgYWNyb3NzIHNlcnZpY2VzXG4gKiB0aGUgbW9tZW50IGFuIGFwcCBsb2dzIGl0LiBBcHBzIGFkZCB0aGVpciBvd24gYnVzaW5lc3MgaWRzIChvcmRlcklkLCB1c2VySWQsIOKApikgdmlhIGBsaWZ0RmllbGRzYC5cbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfTElGVF9GSUVMRFMgPSBbICdjb3JyZWxhdGlvbklkJyBdO1xuXG4vLyBDREstaW50ZXJuYWwgLyBjdXN0b20tcmVzb3VyY2UgbGFtYmRhcyB3ZSBuZXZlciBzdWJzY3JpYmUgKG5vaXNlICsgY3Jvc3Mtc3RhY2sgc2luZ2xldG9ucyksXG4vLyBwbHVzIHRoZSBmb3J3YXJkZXIgaXRzZWxmIChiZWx0LWFuZC1zdXNwZW5kZXJzOyBpdCBpcyBhbHNvIGV4Y2x1ZGVkIGJ5IHJlZmVyZW5jZSkuXG5jb25zdCBERUZBVUxUX1NLSVBfU1VCU1RSSU5HUyA9IFtcblx0J0xvZ1JldGVudGlvbicsXG5cdCdDdXN0b206OicsXG5cdCdmcmFtZXdvcmstb25FdmVudCcsXG5cdCdBV1NDREtDZm4nLFxuXHQnQnVja2V0Tm90aWZpY2F0aW9uc0hhbmRsZXInLFxuXHQnUHJvdmlkZXInLFxuXHQnTG9nRm9yd2FyZGVyJyxcbl07XG5cbmNsYXNzIExvZ1NoaXBwaW5nQXNwZWN0IGltcGxlbWVudHMgSUFzcGVjdCB7XG5cdGNvbnN0cnVjdG9yKFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgZm9yd2FyZGVyOiBMYW1iZGFGdW5jdGlvbixcblx0XHRwcml2YXRlIHJlYWRvbmx5IGludm9rZVBlcm1pc3Npb246IElDb25zdHJ1Y3QsXG5cdFx0cHJpdmF0ZSByZWFkb25seSBmaWx0ZXJQYXR0ZXJuOiBJRmlsdGVyUGF0dGVybixcblx0XHRwcml2YXRlIHJlYWRvbmx5IHNraXBTdWJzdHJpbmdzOiBzdHJpbmdbXSxcblx0KSB7fVxuXG5cdHZpc2l0KG5vZGU6IElDb25zdHJ1Y3QpOiB2b2lkIHtcblx0XHRpZiAoIShub2RlIGluc3RhbmNlb2YgTGFtYmRhRnVuY3Rpb24pKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGlmIChub2RlID09PSB0aGlzLmZvcndhcmRlcikge1xuXHRcdFx0cmV0dXJuOyAvLyBuZXZlciBzdWJzY3JpYmUgdGhlIGZvcndhcmRlciB0byBpdHNlbGYg4oCUIGluZmluaXRlIGxvb3Bcblx0XHR9XG5cdFx0Y29uc3Qgbm9kZVBhdGggPSBub2RlLm5vZGUucGF0aDtcblx0XHRpZiAodGhpcy5za2lwU3Vic3RyaW5ncy5zb21lKChzKSA9PiBub2RlUGF0aC5pbmNsdWRlcyhzKSkpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aWYgKG5vZGUubm9kZS50cnlGaW5kQ2hpbGQoJ0xvZ1NoaXBTdWJzY3JpcHRpb24nKSkge1xuXHRcdFx0cmV0dXJuOyAvLyBhc3BlY3RzIGNhbiB2aXNpdCBhIG5vZGUgbW9yZSB0aGFuIG9uY2U7IGFkZCB0aGUgZmlsdGVyIG9ubHkgb25jZVxuXHRcdH1cblx0XHR0cnkge1xuXHRcdFx0Y29uc3QgZmlsdGVyID0gbmV3IFN1YnNjcmlwdGlvbkZpbHRlcihub2RlLCAnTG9nU2hpcFN1YnNjcmlwdGlvbicsIHtcblx0XHRcdFx0bG9nR3JvdXA6IG5vZGUubG9nR3JvdXAsXG5cdFx0XHRcdC8vIGFkZFBlcm1pc3Npb25zOmZhbHNlIOKAlCBhIHNpbmdsZSB3aWxkY2FyZCBpbnZva2UgcGVybWlzc2lvbiBpcyBhZGRlZCBvbiB0aGUgZm9yd2FyZGVyIGluXG5cdFx0XHRcdC8vIGNvbnN0cnVjdCgpLCBzbyB3ZSBkb24ndCBhY2N1bXVsYXRlIG9uZSBDZm5QZXJtaXNzaW9uIHBlciBsb2cgZ3JvdXAuXG5cdFx0XHRcdGRlc3RpbmF0aW9uOiBuZXcgTGFtYmRhRGVzdGluYXRpb24odGhpcy5mb3J3YXJkZXIsIHsgYWRkUGVybWlzc2lvbnM6IGZhbHNlIH0pLFxuXHRcdFx0XHRmaWx0ZXJQYXR0ZXJuOiB0aGlzLmZpbHRlclBhdHRlcm4sXG5cdFx0XHR9KTtcblx0XHRcdC8vIENSSVRJQ0FMOiB3aXRoIGFkZFBlcm1pc3Npb25zOmZhbHNlIHRoZXJlIGlzIG5vIGF1dG9tYXRpYyBkZXBlbmRlbmN5IGJldHdlZW4gdGhlIGZpbHRlciBhbmRcblx0XHRcdC8vIHRoZSAoc2luZ2xlLCB3aWxkY2FyZCkgaW52b2tlIHBlcm1pc3Npb24uIE9uIGEgRlJFU0ggZGVwbG95IENsb3VkRm9ybWF0aW9uIHdvdWxkIG90aGVyd2lzZVxuXHRcdFx0Ly8gcmFjZSBhbmQgY3JlYXRlIHRoZSBmaWx0ZXIgYmVmb3JlIHRoZSBwZXJtaXNzaW9uLCBzbyBDbG91ZFdhdGNoIExvZ3MgY2FuJ3QgaW52b2tlIHRoZVxuXHRcdFx0Ly8gZm9yd2FyZGVyIOKGkiBcIkNvdWxkIG5vdCBleGVjdXRlIHRoZSBsYW1iZGEgZnVuY3Rpb25cIiA0MDAuIEZvcmNlIHRoZSBvcmRlcmluZyBleHBsaWNpdGx5LlxuXHRcdFx0ZmlsdGVyLm5vZGUuYWRkRGVwZW5kZW5jeSh0aGlzLmludm9rZVBlcm1pc3Npb24pO1xuXHRcdH0gY2F0Y2ggKGVycikge1xuXHRcdFx0Ly8gQSBsYW1iZGEgd2l0aG91dCBhbiBhZGRyZXNzYWJsZSBsb2cgZ3JvdXAgKHJhcmUgQ0RLIGludGVybmFscykgbXVzdCBuZXZlciBicmVhayBzeW50aC5cblx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRjb25zb2xlLndhcm4oYFtMb2dGb3J3YXJkZXJdIHNraXBwZWQgJHtub2RlUGF0aH06ICR7KGVyciBhcyBFcnJvcikubWVzc2FnZX1gKTtcblx0XHR9XG5cdH1cbn1cblxuLyoqXG4gKiBPdXQtb2YtYmFuZCBsb2cgc2hpcHBpbmcgZm9yIGV2ZXJ5IExhbWJkYSBpbiB0aGUgYXBwLlxuICpcbiAqIEF0dGFjaGVzIGEgQ2xvdWRXYXRjaCBMb2dzIHN1YnNjcmlwdGlvbiBmaWx0ZXIgdG8gZWFjaCBmdW5jdGlvbidzIGxvZyBncm91cCAodmlhIGFuIEFzcGVjdCksIHJvdXRpbmdcbiAqIGJhdGNoZWQsIGd6aXBwZWQgZXZlbnRzIHRvIGEgc2luZ2xlIHRpbnkgZm9yd2FyZGVyIExhbWJkYSB0aGF0IHNoaXBzIHRoZW0gdG8gYSBWZWN0b3IvTG9ndHJhaWwgSFRUUFxuICogaW5nZXN0LiBOb3RoaW5nIHJ1bnMgaW4gdGhlIGFwcCByZXF1ZXN0IHBhdGggKGZ1bmN0aW9ucyBvbmx5IHdyaXRlIHN0ZG91dCksIHNvIGxvZyB2b2x1bWUgbmV2ZXJcbiAqIGRlZ3JhZGVzIHJlcXVlc3QgbGF0ZW5jeSBhbmQgdGhlcmUgYXJlIG5vIHBlci1sb2cgSFRUUCBjYWxscyBmcm9tIHRoZSBoYW5kbGVycy5cbiAqXG4gKiBJbnNpZGUgdGhlIGZvcndhcmRlciwgZWFjaCBsaW5lIHJ1bnMgdGhyb3VnaCBhIDQtc3RlcCBwaXBlbGluZTogTk9STUFMSVpFIChwZWVsIExhbWJkYSBwcmVmaXgsIGxpZnRcbiAqIGZ3MjQgdHNsb2cgSlNPTiwgc3RyaXAgQU5TSSkg4oaSIFJFQ0xBU1NJRlkgYmVuaWduIGVycm9ycyDihpIgRFJPUCBub2lzZSDihpIgRE9XTkdSQURFIG5vaXNlLiBTdGVwcyAy4oCTNCBhcmVcbiAqIGFwcC1vd25lZCBydWxlIGxpc3RzIChzZWUge0BsaW5rIExvZ0ZvcndhcmRlck5vaXNlUnVsZXN9IC8ge0BsaW5rIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTfSkuXG4gKlxuICogRGVwbG95LXRpbWUgY29uZmlnIGlzIHJlYWQgZnJvbSBgRk9SV0FSREVSXypgIGVudiB3aGVuIG5vdCBwYXNzZWQgZXhwbGljaXRseS4gYEZPUldBUkRFUl8qYCBpcyB1c2VkXG4gKiAobmV2ZXIgYExPR1RSQUlMXypgKSBvbiBwdXJwb3NlOiBzZXR0aW5nIGBMT0dUUkFJTF8qYCBpbiB0aGUgZGVwbG95IHNoZWxsIHdvdWxkIGFjdGl2YXRlIGZ3MjQnc1xuICogaW4tcHJvY2VzcyBsb2cgdHJhbnNwb3J0IGFuZCBsZWFrIGxvY2FsIENESy9zeW50aCBsb2dzIHRvIHRoZSBpbmdlc3QuXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dGb3J3YXJkZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcblx0cmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblx0cmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKExvZ0ZvcndhcmRlckNvbnN0cnVjdC5uYW1lKTtcblx0bmFtZSA9IExvZ0ZvcndhcmRlckNvbnN0cnVjdC5uYW1lO1xuXHRkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG5cdG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cdG1haW5TdGFjayE6IFN0YWNrO1xuXG5cdGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgY29uZmlnOiBMb2dGb3J3YXJkZXJDb25zdHJ1Y3RDb25maWcgPSB7fSkge31cblxuXHRwcml2YXRlIHJlc29sdmVOb2lzZUVudigpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcblx0XHRjb25zdCBydWxlcyA9IHRoaXMuY29uZmlnLm5vaXNlID8/IHt9O1xuXHRcdGNvbnN0IHVzZURlZmF1bHRzID0gcnVsZXMudXNlRGVmYXVsdHMgIT09IGZhbHNlO1xuXHRcdGNvbnN0IG1lcmdlID0gKGxpc3Q6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBkZWZhdWx0czogc3RyaW5nW10pOiBzdHJpbmdbXSA9PiB7XG5cdFx0XHRjb25zdCBiYXNlID0gdXNlRGVmYXVsdHMgPyBkZWZhdWx0cyA6IFtdO1xuXHRcdFx0Ly8gRGUtZHVwIHdoaWxlIHByZXNlcnZpbmcgb3JkZXIgKGRlZmF1bHRzIGZpcnN0LCB0aGVuIGFwcCBhZGRpdGlvbnMpLlxuXHRcdFx0cmV0dXJuIFsgLi4ubmV3IFNldChbIC4uLmJhc2UsIC4uLihsaXN0ID8/IFtdKSBdKSBdO1xuXHRcdH07XG5cdFx0Y29uc3QgYmVuaWduID0gbWVyZ2UocnVsZXMuYmVuaWduLCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUy5iZW5pZ24pO1xuXHRcdGNvbnN0IGRyb3AgPSBtZXJnZShydWxlcy5kcm9wLCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUy5kcm9wKTtcblx0XHRjb25zdCBkb3duZ3JhZGUgPSBtZXJnZShydWxlcy5kb3duZ3JhZGUsIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmRvd25ncmFkZSk7XG5cdFx0Y29uc3QgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cdFx0aWYgKGJlbmlnbi5sZW5ndGgpIGVudi5GT1JXQVJERVJfTk9JU0VfQkVOSUdOID0gSlNPTi5zdHJpbmdpZnkoYmVuaWduKTtcblx0XHRpZiAoZHJvcC5sZW5ndGgpIGVudi5GT1JXQVJERVJfTk9JU0VfRFJPUCA9IEpTT04uc3RyaW5naWZ5KGRyb3ApO1xuXHRcdGlmIChkb3duZ3JhZGUubGVuZ3RoKSBlbnYuRk9SV0FSREVSX05PSVNFX0RPV05HUkFERSA9IEpTT04uc3RyaW5naWZ5KGRvd25ncmFkZSk7XG5cdFx0cmV0dXJuIGVudjtcblx0fVxuXG5cdC8qKiBBcHAtZGVjbGFyZWQgZmllbGRzIHRvIGxpZnQsIG1lcmdlZCB3aXRoIHtAbGluayBERUZBVUxUX0xJRlRfRklFTERTfSB1bmxlc3MgbGlmdEZpZWxkRGVmYXVsdHMgaXMgZmFsc2UuICovXG5cdHByaXZhdGUgcmVzb2x2ZUxpZnRGaWVsZHMoKTogc3RyaW5nW10ge1xuXHRcdGNvbnN0IHVzZURlZmF1bHRzID0gdGhpcy5jb25maWcubGlmdEZpZWxkRGVmYXVsdHMgIT09IGZhbHNlO1xuXHRcdGNvbnN0IGJhc2UgPSB1c2VEZWZhdWx0cyA/IERFRkFVTFRfTElGVF9GSUVMRFMgOiBbXTtcblx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KFsgLi4uYmFzZSwgLi4uKHRoaXMuY29uZmlnLmxpZnRGaWVsZHMgPz8gW10pIF0ubWFwKChzKSA9PiBzLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pKSBdO1xuXHR9XG5cblx0YXN5bmMgY29uc3RydWN0KCk6IFByb21pc2U8dm9pZD4ge1xuXHRcdC8vIERlZmF1bHQgc3RhY2sgKG5vIGhhcmRjb2RlZCBuYW1lKSDigJQgcmVzcGVjdHMgc3RhY2tOYW1lL3BhcmVudFN0YWNrTmFtZSBpZiB0aGUgYXBwIHNldHMgdGhlbS5cblx0XHR0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLmNvbmZpZy5zdGFja05hbWUsIHRoaXMuY29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cdFx0Y29uc3QgbyA9IHRoaXMuY29uZmlnO1xuXG5cdFx0Y29uc3QgZm9yd2FyZGVyTG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcy5tYWluU3RhY2ssICdMb2dGb3J3YXJkZXJGdW5jdGlvbkxvZ0dyb3VwJywge1xuXHRcdFx0cmV0ZW50aW9uOiBvLmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuXHRcdFx0cmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuXHRcdH0pO1xuXG5cdFx0Ly8gc2VydmljZS9lbnYgZGVmYXVsdCB0byB3aGF0IGZ3MjQgYWxyZWFkeSBrbm93cyAoaHlkcmF0ZWQgZnJvbSBBUFBfTkFNRSAvIEFQUF9FTlZJUk9OTUVOVCksIHNvIGFcblx0XHQvLyBiYWNrZW5kIHVzdWFsbHkgZG9lc24ndCBwYXNzIHRoZW0uIFByZWNlZGVuY2U6IGV4cGxpY2l0IG9wdGlvbiA+IEZPUldBUkRFUl8qIGVudiA+IGZ3MjQgY29uZmlnLlxuXHRcdGNvbnN0IGNmZyA9IHRoaXMuZncyNC5nZXRDb25maWcoKTtcblx0XHRjb25zdCBpbmdlc3RIdHRwVXJsID0gby5pbmdlc3RIdHRwVXJsID8/IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfVVJMPy50cmltKCkgPz8gJyc7XG5cdFx0Y29uc3Qgc2VydmljZSA9IG8uc2VydmljZSA/PyAocHJvY2Vzcy5lbnYuRk9SV0FSREVSX1NFUlZJQ0U/LnRyaW0oKSB8fCB0aGlzLmZ3MjQuYXBwTmFtZSB8fCAnJyk7XG5cdFx0Y29uc3QgZW52ID0gby5lbnYgPz8gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9FTlY/LnRyaW0oKSB8fCBjZmcuZW52aXJvbm1lbnQgfHwgJycpO1xuXHRcdGNvbnN0IHhBcGlLZXkgPSBvLnhBcGlLZXkgPz8gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk/LnRyaW0oKTtcblx0XHRjb25zdCBsaWZ0RmllbGRzID0gdGhpcy5yZXNvbHZlTGlmdEZpZWxkcygpO1xuXHRcdGNvbnN0IHZlcnNpb24gPSBvLnZlcnNpb24gPz8gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX1ZFUlNJT04/LnRyaW0oKSA/PyAnJztcblxuXHRcdGlmICghaW5nZXN0SHR0cFVybCkge1xuXHRcdFx0Ly8gTm9uLWZhdGFsOiB0aGUgZm9yd2FyZGVyIGhhbmRsZXIgbm8tb3BzIHdpdGhvdXQgYW4gaW5nZXN0IFVSTCwgc28gYSBiYWNrZW5kIGNhbiBhZG9wdCB0aGVcblx0XHRcdC8vIGNvbnN0cnVjdCBiZWZvcmUgdGhlIGluZ2VzdCBpcyB3aXJlZC4gV2FybiBzbyBpdCBpc24ndCBhIHNpbGVudCBuby1vcC5cblx0XHRcdHRoaXMubG9nZ2VyLndhcm4oXG5cdFx0XHRcdCdMb2dGb3J3YXJkZXJDb25zdHJ1Y3Q6IG5vIGluZ2VzdCBVUkwgKGNvbmZpZy5pbmdlc3RIdHRwVXJsIC8gRk9SV0FSREVSX0lOR0VTVF9VUkwpLiAnXG5cdFx0XHRcdFx0KyAnRm9yd2FyZGVyIGRlcGxveXMgYnV0IHNoaXBzIG5vdGhpbmcgdW50aWwgb25lIGlzIHNldC4nLFxuXHRcdFx0KTtcblx0XHR9XG5cblx0XHQvLyBGcmFtZXdvcmstb3duZWQgaGFuZGxlciBzaGlwcGVkIGNvbXBpbGVkIGluIGRpc3QgKG1pcnJvcnMgbWFpbGVyL2R5bmFtbyBoYW5kbGVycykuIFJlc29sdmUgdGhlXG5cdFx0Ly8gY29tcGlsZWQgYC5qc2Agd2hlbiBpbnN0YWxsZWQgKGRpc3QpLCBmYWxsaW5nIGJhY2sgdG8gdGhlIGAudHNgIHNvdXJjZSB3aGVuIHJ1bm5pbmcgZnJvbSBmdzI0J3Ncblx0XHQvLyBvd24gc3JjICh1bml0IHRlc3RzIC8gdHMtbm9kZSBkZXYpIHdoZXJlIHRoZSBgLmpzYCBoYXNuJ3QgYmVlbiBlbWl0dGVkLlxuXHRcdGNvbnN0IGhhbmRsZXJCYXNlID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXInKTtcblx0XHRjb25zdCBoYW5kbGVyRW50cnkgPSBleGlzdHNTeW5jKGAke2hhbmRsZXJCYXNlfS5qc2ApID8gYCR7aGFuZGxlckJhc2V9LmpzYCA6IGAke2hhbmRsZXJCYXNlfS50c2A7XG5cblx0XHRjb25zdCBmb3J3YXJkZXIgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssICdMb2dGb3J3YXJkZXJGdW5jdGlvbicsIHtcblx0XHRcdGVudHJ5OiBoYW5kbGVyRW50cnksXG5cdFx0XHRoYW5kbGVyOiAnaGFuZGxlcicsXG5cdFx0XHRydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuXHRcdFx0bWVtb3J5U2l6ZTogby5tZW1vcnlTaXplID8/IDI1Nixcblx0XHRcdHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoby50aW1lb3V0U2Vjb25kcyA/PyAzMCksXG5cdFx0XHQuLi4oby5yZXNlcnZlZENvbmN1cnJlbmN5ICE9IG51bGwgPyB7IHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IG8ucmVzZXJ2ZWRDb25jdXJyZW5jeSB9IDoge30pLFxuXHRcdFx0bG9nR3JvdXA6IGZvcndhcmRlckxvZ0dyb3VwLFxuXHRcdFx0YnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbICdAYXdzLXNkaycgXSwgbWluaWZ5OiB0cnVlIH0sXG5cdFx0XHQvLyBGb3J3YXJkZXIgcnVudGltZSBlbnYgaXMgZnVsbHkgRk9SV0FSREVSXyotbmFtZXNwYWNlZCDigJQgbm8gTE9HVFJBSUxfKiBrZXlzLCBzbyBpdCBjYW4gbmV2ZXJcblx0XHRcdC8vIGNvbGxpZGUgd2l0aCBmdzI0J3MgaW4tcHJvY2VzcyB0cmFuc3BvcnQuXG5cdFx0XHRlbnZpcm9ubWVudDoge1xuXHRcdFx0XHRGT1JXQVJERVJfSU5HRVNUX1VSTDogaW5nZXN0SHR0cFVybCxcblx0XHRcdFx0Rk9SV0FSREVSX1NFUlZJQ0U6IHNlcnZpY2UsXG5cdFx0XHRcdEZPUldBUkRFUl9FTlY6IGVudixcblx0XHRcdFx0Li4uKHhBcGlLZXkgPyB7IEZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZOiB4QXBpS2V5IH0gOiB7fSksXG5cdFx0XHRcdC4uLihvLmJhdGNoRm9ybWF0ID8geyBGT1JXQVJERVJfQkFUQ0hfRk9STUFUOiBvLmJhdGNoRm9ybWF0IH0gOiB7fSksXG5cdFx0XHRcdC4uLihvLm1heEJhdGNoQnl0ZXMgIT0gbnVsbCA/IHsgRk9SV0FSREVSX01BWF9CQVRDSF9CWVRFUzogU3RyaW5nKG8ubWF4QmF0Y2hCeXRlcykgfSA6IHt9KSxcblx0XHRcdFx0Li4uKGxpZnRGaWVsZHMubGVuZ3RoID8geyBGT1JXQVJERVJfRklFTERTOiBKU09OLnN0cmluZ2lmeShsaWZ0RmllbGRzKSB9IDoge30pLFxuXHRcdFx0XHQuLi4odmVyc2lvbiA/IHsgRk9SV0FSREVSX1ZFUlNJT046IHZlcnNpb24gfSA6IHt9KSxcblx0XHRcdFx0Li4udGhpcy5yZXNvbHZlTm9pc2VFbnYoKSxcblx0XHRcdH0sXG5cdFx0fSk7XG5cblx0XHQvLyBPbmUgYnJvYWQgaW52b2tlIHBlcm1pc3Npb24gaW5zdGVhZCBvZiBvbmUgcGVyIGxvZyBncm91cDoga2VlcHMgdGhlIGZvcndhcmRlcidzIHJlc291cmNlIHBvbGljeVxuXHRcdC8vIHNtYWxsIChMYW1iZGEgY2FwcyBpdCBhdCB+MjBLQikgYXMgdGhlIG51bWJlciBvZiBzdWJzY3JpYmVkIGZ1bmN0aW9ucyBncm93cy4gQ3JlYXRlZCBhcyBhblxuXHRcdC8vIGV4cGxpY2l0IENmblBlcm1pc3Npb24gc28gZXZlcnkgc3Vic2NyaXB0aW9uIGZpbHRlciBjYW4gYGFkZERlcGVuZGVuY3lgIG9uIGl0ICh0aGUgYXNwZWN0KSDigJRcblx0XHQvLyB3aXRob3V0IHRoYXQsIGEgZnJlc2ggZGVwbG95IHJhY2VzIGFuZCBjcmVhdGVzIGZpbHRlcnMgYmVmb3JlIHRoZSBwZXJtaXNzaW9uIChhIDQwMCkuXG5cdFx0Y29uc3QgaW52b2tlUGVybWlzc2lvbiA9IG5ldyBDZm5QZXJtaXNzaW9uKGZvcndhcmRlciwgJ0FsbG93Q2xvdWRXYXRjaExvZ3NJbnZva2UnLCB7XG5cdFx0XHRwcmluY2lwYWw6ICdsb2dzLmFtYXpvbmF3cy5jb20nLFxuXHRcdFx0YWN0aW9uOiAnbGFtYmRhOkludm9rZUZ1bmN0aW9uJyxcblx0XHRcdGZ1bmN0aW9uTmFtZTogZm9yd2FyZGVyLmZ1bmN0aW9uTmFtZSxcblx0XHRcdHNvdXJjZUFjY291bnQ6IHRoaXMubWFpblN0YWNrLmFjY291bnQsXG5cdFx0XHRzb3VyY2VBcm46IGBhcm46YXdzOmxvZ3M6JHt0aGlzLm1haW5TdGFjay5yZWdpb259OiR7dGhpcy5tYWluU3RhY2suYWNjb3VudH06bG9nLWdyb3VwOipgLFxuXHRcdH0pO1xuXG5cdFx0Y29uc3Qgc2tpcCA9IFsgLi4uREVGQVVMVF9TS0lQX1NVQlNUUklOR1MsIC4uLihvLmV4Y2x1ZGVGdW5jdGlvblBhdGhTdWJzdHJpbmdzID8/IFtdKSBdO1xuXHRcdC8vICdhcHAnIOKGkiBzdWJzY3JpYmUgZXZlcnkgTGFtYmRhIGluIHRoZSB3aG9sZSBDREsgYXBwIChpbmRlcGVuZGVudCB0b3AtbGV2ZWwgc3RhY2tzIHRvbyk7XG5cdFx0Ly8gJ3N0YWNrJyAoZGVmYXVsdCkg4oaSIHRoaXMgc3RhY2sgKyBuZXN0ZWQgc3RhY2tzIHVuZGVyIGl0LlxuXHRcdGNvbnN0IHNjb3BlUm9vdDogSUNvbnN0cnVjdCA9XG5cdFx0XHRvLnN1YnNjcmliZVNjb3BlID09PSAnYXBwJyA/IHRoaXMubWFpblN0YWNrLm5vZGUucm9vdCA6IHRoaXMubWFpblN0YWNrO1xuXHRcdEFzcGVjdHMub2Yoc2NvcGVSb290KS5hZGQoXG5cdFx0XHRuZXcgTG9nU2hpcHBpbmdBc3BlY3QoZm9yd2FyZGVyLCBpbnZva2VQZXJtaXNzaW9uLCBvLmZpbHRlclBhdHRlcm4gPz8gRmlsdGVyUGF0dGVybi5hbGxFdmVudHMoKSwgc2tpcCksXG5cdFx0KTtcblxuXHRcdHRoaXMub3V0cHV0ID0ge30gYXMgRlcyNENvbnN0cnVjdE91dHB1dDtcblx0fVxufVxuIl19