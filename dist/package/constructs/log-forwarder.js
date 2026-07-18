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
exports.LogForwarderConstruct = exports.DEFAULT_LOG_NOISE_RULES = void 0;
const path = __importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
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
    filterPattern;
    skipSubstrings;
    constructor(forwarder, filterPattern, skipSubstrings) {
        this.forwarder = forwarder;
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
            new aws_logs_1.SubscriptionFilter(node, 'LogShipSubscription', {
                logGroup: node.logGroup,
                // addPermissions:false — a single wildcard invoke permission is added on the forwarder in
                // construct(), so we don't accumulate one CfnPermission per log group.
                destination: new aws_logs_destinations_1.LambdaDestination(this.forwarder, { addPermissions: false }),
                filterPattern: this.filterPattern,
            });
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
    async construct() {
        // Default stack (no hardcoded name) — respects stackName/parentStackName if the app sets them.
        this.mainStack = this.fw24.getStack(this.config.stackName, this.config.parentStackName);
        const o = this.config;
        const forwarderLogGroup = new aws_logs_1.LogGroup(this.mainStack, 'LogForwarderFunctionLogGroup', {
            retention: o.logRetention ?? aws_logs_1.RetentionDays.ONE_WEEK,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        const ingestHttpUrl = o.ingestHttpUrl ?? process.env.FORWARDER_INGEST_URL?.trim() ?? '';
        const service = o.service ?? process.env.FORWARDER_SERVICE?.trim() ?? '';
        const env = o.env ?? process.env.FORWARDER_ENV?.trim() ?? '';
        const xApiKey = o.xApiKey ?? process.env.FORWARDER_INGEST_X_API_KEY?.trim();
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
                ...this.resolveNoiseEnv(),
            },
        });
        // One broad invoke permission instead of one per log group: keeps the forwarder's resource
        // policy small (Lambda caps it at ~20KB) as the number of subscribed functions grows.
        forwarder.addPermission('AllowCloudWatchLogsInvoke', {
            principal: new aws_iam_1.ServicePrincipal('logs.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceAccount: this.mainStack.account,
            sourceArn: `arn:aws:logs:${this.mainStack.region}:${this.mainStack.account}:log-group:*`,
        });
        const skip = [...DEFAULT_SKIP_SUBSTRINGS, ...(o.excludeFunctionPathSubstrings ?? [])];
        // 'app' → subscribe every Lambda in the whole CDK app (independent top-level stacks too);
        // 'stack' (default) → this stack + nested stacks under it.
        const scopeRoot = o.subscribeScope === 'app' ? this.mainStack.node.root : this.mainStack;
        aws_cdk_lib_1.Aspects.of(scopeRoot).add(new LogShippingAspect(forwarder, o.filterPattern ?? aws_logs_1.FilterPattern.allEvents(), skip));
        this.output = {};
    }
}
exports.LogForwarderConstruct = LogForwarderConstruct;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2xvZy1mb3J3YXJkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQWtDO0FBQ2xDLHFDQUFxQztBQUNyQyw2Q0FBb0Y7QUFDcEYsaURBQXVEO0FBQ3ZELHVEQUE2RTtBQUM3RSxxRUFBK0Q7QUFDL0QsbURBQXVIO0FBQ3ZILDZFQUFzRTtBQUV0RSx1Q0FBb0M7QUFHcEMsd0NBQTBDO0FBcUUxQzs7OztHQUlHO0FBQ1UsUUFBQSx1QkFBdUIsR0FBMEQ7SUFDN0YsMkRBQTJEO0lBQzNELE1BQU0sRUFBRTtRQUNQLGtCQUFrQjtRQUNsQixhQUFhO1FBQ2IsYUFBYTtRQUNiLHdDQUF3QztRQUN4QywwQkFBMEI7UUFDMUIsa0JBQWtCO1FBQ2xCLGlCQUFpQjtLQUNqQjtJQUNELGdDQUFnQztJQUNoQyxJQUFJLEVBQUU7UUFDTCw4Q0FBOEM7UUFDOUMsa0JBQWtCO1FBQ2xCLG1CQUFtQjtLQUNuQjtJQUNELGlEQUFpRDtJQUNqRCxTQUFTLEVBQUU7UUFDVixzQkFBc0I7UUFDdEIsZ0JBQWdCO0tBQ2hCO0NBQ0QsQ0FBQztBQUVGLDhGQUE4RjtBQUM5RixxRkFBcUY7QUFDckYsTUFBTSx1QkFBdUIsR0FBRztJQUMvQixjQUFjO0lBQ2QsVUFBVTtJQUNWLG1CQUFtQjtJQUNuQixXQUFXO0lBQ1gsNEJBQTRCO0lBQzVCLFVBQVU7SUFDVixjQUFjO0NBQ2QsQ0FBQztBQUVGLE1BQU0saUJBQWlCO0lBRUo7SUFDQTtJQUNBO0lBSGxCLFlBQ2tCLFNBQXlCLEVBQ3pCLGFBQTZCLEVBQzdCLGNBQXdCO1FBRnhCLGNBQVMsR0FBVCxTQUFTLENBQWdCO1FBQ3pCLGtCQUFhLEdBQWIsYUFBYSxDQUFnQjtRQUM3QixtQkFBYyxHQUFkLGNBQWMsQ0FBVTtJQUN2QyxDQUFDO0lB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QyxDQUFDLDZCQUE2QixJQUFJLEVBQUUsQ0FBQyxDQUFFLENBQUM7UUFDeEYsMEZBQTBGO1FBQzFGLDJEQUEyRDtRQUMzRCxNQUFNLFNBQVMsR0FDZCxDQUFDLENBQUMsY0FBYyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO1FBQ3hFLHFCQUFPLENBQUMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsQ0FDeEIsSUFBSSxpQkFBaUIsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLGFBQWEsSUFBSSx3QkFBYSxDQUFDLFNBQVMsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUNwRixDQUFDO1FBRUYsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUF5QixDQUFDO0lBQ3pDLENBQUM7Q0FDRDtBQXBHRCxzREFvR0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBBc3BlY3RzLCBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2ssIHR5cGUgSUFzcGVjdCB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFNlcnZpY2VQcmluY2lwYWwgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IEZ1bmN0aW9uIGFzIExhbWJkYUZ1bmN0aW9uLCBSdW50aW1lIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCB7IEZpbHRlclBhdHRlcm4sIHR5cGUgSUZpbHRlclBhdHRlcm4sIExvZ0dyb3VwLCBSZXRlbnRpb25EYXlzLCBTdWJzY3JpcHRpb25GaWx0ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBMYW1iZGFEZXN0aW5hdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzLWRlc3RpbmF0aW9ucyc7XG5pbXBvcnQgdHlwZSB7IElDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uc3RydWN0JztcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWcnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5cbi8qKlxuICogQXBwLW93bmVkIG5vaXNlIC8gc2V2ZXJpdHkgcnVsZXMsIGFwcGxpZWQgcGVyIGxvZyBsaW5lIGluc2lkZSB0aGUgZm9yd2FyZGVyIExhbWJkYSAobGF5ZXJzIDLigJM0IG9mIHRoZVxuICogcGlwZWxpbmU7IHNlZSBgTG9nRm9yd2FyZGVyQ29uc3RydWN0YCkuIEVhY2ggbGlzdCBpcyBhbiBhcnJheSBvZiByZWdleCBzb3VyY2Ugc3RyaW5ncywgbWF0Y2hlZFxuICogY2FzZS1pbnNlbnNpdGl2ZWx5IGFnYWluc3QgdGhlIG5vcm1hbGl6ZWQgbWVzc2FnZS4gVGhlc2UgYXJlIGNvbXBsZW1lbnRhcnkgdG8gYW55IGdsb2JhbCBzZXZlcml0eS9cbiAqIG5vaXNlIGhhbmRsaW5nIGEgc2hhcmVkIFZlY3RvciBpbmdlc3QgbWF5IGFsc28gcnVuIOKAlCB0aGlzIGxheWVyIGxldHMgZWFjaCBhcHAgb3duIGl0cyBvd24gcnVsZXMgYW5kLFxuICogZm9yIGBkcm9wYCwgc2F2ZXMgaW5nZXN0IGJhbmR3aWR0aCBieSByZW1vdmluZyBub2lzZSBhdCB0aGUgc291cmNlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExvZ0ZvcndhcmRlck5vaXNlUnVsZXMge1xuXHQvKiogRXJyb3ItaXNoIGxpbmVzIG1hdGNoaW5nIHRoZXNlIGFyZSBkb3duZ3JhZGVkIHRvIGB3YXJuYCAodGFnZ2VkIGByZWNsYXNzaWZpZWQ6IFwiYmVuaWduXCJgKS4gKi9cblx0YmVuaWduPzogc3RyaW5nW107XG5cdC8qKiBMaW5lcyBtYXRjaGluZyB0aGVzZSBhcmUgZHJvcHBlZCBlbnRpcmVseSDigJQgbmV2ZXIgc2hpcHBlZC4gKi9cblx0ZHJvcD86IHN0cmluZ1tdO1xuXHQvKiogTGluZXMgbWF0Y2hpbmcgdGhlc2UgYXJlIGRvd25ncmFkZWQgdG8gYGRlYnVnYCAodGFnZ2VkIGByZWNsYXNzaWZpZWQ6IFwibm9pc2VcImApLiAqL1xuXHRkb3duZ3JhZGU/OiBzdHJpbmdbXTtcblx0LyoqXG5cdCAqIFdoZW4gdHJ1ZSAoZGVmYXVsdCksIHRoZSBidWlsdC1pbiB7QGxpbmsgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVN9IGFyZSBtZXJnZWQgd2l0aCB0aGUgbGlzdHMgYWJvdmUuXG5cdCAqIFNldCBmYWxzZSB0byB1c2UgT05MWSB0aGUgbGlzdHMgeW91IHByb3ZpZGUgKG9yIG5vbmUpLlxuXHQgKi9cblx0dXNlRGVmYXVsdHM/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIExvZ0ZvcndhcmRlckNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuXHQvKiogVmVjdG9yL0xvZ3RyYWlsIEhUVFAgSlNPTiBpbmdlc3QgVVJMLiBEZWZhdWx0cyB0byBgRk9SV0FSREVSX0lOR0VTVF9VUkxgIGF0IGRlcGxveSB0aW1lLiAqL1xuXHRpbmdlc3RIdHRwVXJsPzogc3RyaW5nO1xuXHQvKiogQmFzZSBgc2VydmljZWAgbGFiZWwgZm9yIHNoaXBwZWQgbG9ncyAoZW52IGlzIGZvbGRlZCBpbikuIERlZmF1bHRzIHRvIGBGT1JXQVJERVJfU0VSVklDRWAuICovXG5cdHNlcnZpY2U/OiBzdHJpbmc7XG5cdC8qKlxuXHQgKiBTdGFnZS9vd25lciBsYWJlbCAoZS5nLiBgZGV2ZWxvcGAsIGBwcm9kYCwgYHNhbmRib3gtbml0aW5gKSDigJQgZm9sZGVkIGludG8gdGhlIGBzZXJ2aWNlYCBsYWJlbFxuXHQgKiAoYG15c2VydmljZS1kZXZlbG9wYCkgYW5kIGVtaXR0ZWQgYXMgYGVudmAgc28gZGV2ZWxvcC9wcm9kL3Blci1kZXZlbG9wZXIgbG9ncyBhcmUgZGlzdGluZ3Vpc2hhYmxlXG5cdCAqIGluIExvZ3RyYWlsLiBEZWZhdWx0cyB0byBgRk9SV0FSREVSX0VOVmAgYXQgZGVwbG95IHRpbWUuXG5cdCAqL1xuXHRlbnY/OiBzdHJpbmc7XG5cdC8qKiBPcHRpb25hbCBgeC1hcGkta2V5YCB3aGVuIHRoZSBpbmdlc3QgZnJvbnQgcmVxdWlyZXMgaXQuIERlZmF1bHRzIHRvIGBGT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWWAuICovXG5cdHhBcGlLZXk/OiBzdHJpbmc7XG5cdC8qKiBCYXRjaCB3aXJlIGZvcm1hdCDigJQgbXVzdCBtYXRjaCB5b3VyIFZlY3RvciBodHRwIHNvdXJjZSBkZWNvZGluZy4gRGVmYXVsdDogYGpzb24tYXJyYXlgLiAqL1xuXHRiYXRjaEZvcm1hdD86ICduZGpzb24nIHwgJ2pzb24tYXJyYXknO1xuXHQvKiogTWF4IHVuY29tcHJlc3NlZCBieXRlcyBwZXIgUE9TVCAodGhlIGZvcndhcmRlciBzcGxpdHMgbGFyZ2VyIGJhdGNoZXMpLiBEZWZhdWx0OiAxLDAwMCwwMDAuICovXG5cdG1heEJhdGNoQnl0ZXM/OiBudW1iZXI7XG5cdC8qKiBDbG91ZFdhdGNoIHN1YnNjcmlwdGlvbi1maWx0ZXIgcGF0dGVybiDigJQgdGhlIHZvbHVtZS9jb3N0IGxldmVyIChlLmcuIG9ubHkgV0FSTi9FUlJPUikuIERlZmF1bHQ6IGFsbCBldmVudHMuICovXG5cdGZpbHRlclBhdHRlcm4/OiBJRmlsdGVyUGF0dGVybjtcblx0LyoqIEV4dHJhIGZ1bmN0aW9uIGNvbnN0cnVjdC1wYXRoIHN1YnN0cmluZ3MgdG8gc2tpcCAobmV2ZXIgc3Vic2NyaWJlKS4gKi9cblx0ZXhjbHVkZUZ1bmN0aW9uUGF0aFN1YnN0cmluZ3M/OiBzdHJpbmdbXTtcblx0LyoqIEFwcC1vd25lZCBub2lzZS9zZXZlcml0eSBydWxlcyBhcHBsaWVkIGluc2lkZSB0aGUgZm9yd2FyZGVyIChsYXllcnMgMuKAkzQpLiAqL1xuXHRub2lzZT86IExvZ0ZvcndhcmRlck5vaXNlUnVsZXM7XG5cdC8qKlxuXHQgKiBXaGljaCBjb25zdHJ1Y3QgdHJlZSB0byBzdWJzY3JpYmUuXG5cdCAqIC0gYCdzdGFjaydgIChkZWZhdWx0KTogdGhlIGZvcndhcmRlcidzIHN0YWNrIGFuZCBhbnkgbmVzdGVkIHN0YWNrcyB1bmRlciBpdCAoY292ZXJzIHRoZSBjb21tb25cblx0ICogICBzYXRlbGxpdGUgYXBwLCBpbmNsdWRpbmcgcGVyLWNvbnRyb2xsZXIgbmVzdGVkIHN0YWNrcyBwYXJlbnRlZCB0byB0aGUgZGVmYXVsdCBzdGFjaykuXG5cdCAqIC0gYCdhcHAnYDogdGhlIHdob2xlIENESyBhcHAg4oCUIHVzZSB3aGVuIGEgYmFja2VuZCBoYXMgaW5kZXBlbmRlbnQgdG9wLWxldmVsIHN0YWNrcyAoZS5nLiBhIHNlcGFyYXRlXG5cdCAqICAgYHBlcnNpc3RlbnRgL2RhdGEgc3RhY2spLiBOb3RlIHRoaXMgY3JlYXRlcyBjcm9zcy1zdGFjayBzdWJzY3JpcHRpb27ihpJmb3J3YXJkZXIgcmVmZXJlbmNlcywgc29cblx0ICogICB2ZXJpZnkgc3ludGggZG9lc24ndCBpbnRyb2R1Y2UgYSBjeWNsaWMgc3RhY2sgZGVwZW5kZW5jeS5cblx0ICovXG5cdHN1YnNjcmliZVNjb3BlPzogJ3N0YWNrJyB8ICdhcHAnO1xuXHQvKiogRm9yd2FyZGVyIGZ1bmN0aW9uIG1lbW9yeSAoTUIpLiBEZWZhdWx0IDI1Ni4gKi9cblx0bWVtb3J5U2l6ZT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlciBmdW5jdGlvbiB0aW1lb3V0IChzZWNvbmRzKS4gRGVmYXVsdCAzMC4gKi9cblx0dGltZW91dFNlY29uZHM/OiBudW1iZXI7XG5cdC8qKlxuXHQgKiBDYXAgZm9yd2FyZGVyIGNvbmN1cnJlbmN5IHRvIHByb3RlY3QgdGhlIGluZ2VzdCBmcm9tIGEgbG9nIHN0b3JtLiBPcHQtaW46IHJlc2VydmluZyBjb25jdXJyZW5jeVxuXHQgKiBzdWJ0cmFjdHMgZnJvbSB0aGUgYWNjb3VudCdzIHNoYXJlZCBwb29sLCBzbyBhIGJhZCB2YWx1ZSBjYW4gZmFpbCBkZXBsb3lzIGluIGNvbnN0cmFpbmVkIGFjY291bnRzLlxuXHQgKiBSZWNvbW1lbmRlZCBpbiBwcm9kIChlLmcuIDEw4oCTMjApLlxuXHQgKi9cblx0cmVzZXJ2ZWRDb25jdXJyZW5jeT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlcidzIG93biBsb2cgcmV0ZW50aW9uLiBEZWZhdWx0OiBvbmUgd2Vlay4gKi9cblx0bG9nUmV0ZW50aW9uPzogUmV0ZW50aW9uRGF5cztcbn1cblxuLyoqXG4gKiBDdXJhdGVkLCBnZW5lcmFsbHktc2FmZSBkZWZhdWx0IG5vaXNlL3NldmVyaXR5IHJ1bGVzIOKAlCBtaXJyb3JzIHRoZSBMb2d0cmFpbCBWZWN0b3IgXCJBMVwiIGxpc3Qgc28gYVxuICogYmFja2VuZCBnZXRzIHNlbnNpYmxlIGxvZyBoeWdpZW5lIG91dCBvZiB0aGUgYm94LiBNZXJnZS1pbiBieSBkZWZhdWx0OyBvdmVycmlkZSB2aWFcbiAqIHtAbGluayBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLnVzZURlZmF1bHRzfS4gRXhwb3J0ZWQgc28gYXBwcyBjYW4gaW5zcGVjdCAvIGV4dGVuZCB0aGUgbGlzdHMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUzogUmVxdWlyZWQ8T21pdDxMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLCAndXNlRGVmYXVsdHMnPj4gPSB7XG5cdC8vIEJlbmlnbiBcImVycm9yc1wiIOKGkiB3YXJuLCBzbyBlcnJvciBjb3VudHMgc3RheSBtZWFuaW5nZnVsLlxuXHRiZW5pZ246IFtcblx0XHQnXFxcXGJFQ09OTlJFU0VUXFxcXGInLFxuXHRcdCdcXFxcYkVQSVBFXFxcXGInLFxuXHRcdCdicm9rZW4gcGlwZScsXG5cdFx0J2NsaWVudCAoPzpjbG9zZWQgcmVxdWVzdHxkaXNjb25uZWN0ZWQpJyxcblx0XHQnY29ubmVjdGlvbiByZXNldCBieSBwZWVyJyxcblx0XHQnY29udGV4dCBjYW5jZWxlZCcsXG5cdFx0J3JlcXVlc3QgYWJvcnRlZCcsXG5cdF0sXG5cdC8vIEhlYWx0aC9wcm9iZSBub2lzZSDihpIgZHJvcHBlZC5cblx0ZHJvcDogW1xuXHRcdCdHRVQgLyg/OmhlYWx0aHxoZWFsdGh6fHJlYWR5enxsaXZlenxwaW5nKVxcXFxiJyxcblx0XHQnXFxcXGJrdWJlLXByb2JlXFxcXGInLFxuXHRcdCdFTEItSGVhbHRoQ2hlY2tlcicsXG5cdF0sXG5cdC8vIExvdy12YWx1ZSBub2lzZSDihpIgZGVidWcgKGtlcHQsIGRlLWVtcGhhc2lzZWQpLlxuXHRkb3duZ3JhZGU6IFtcblx0XHQnZGVwcmVjYXRpb24uP3dhcm5pbmcnLFxuXHRcdCcvZmF2aWNvblxcXFwuaWNvJyxcblx0XSxcbn07XG5cbi8vIENESy1pbnRlcm5hbCAvIGN1c3RvbS1yZXNvdXJjZSBsYW1iZGFzIHdlIG5ldmVyIHN1YnNjcmliZSAobm9pc2UgKyBjcm9zcy1zdGFjayBzaW5nbGV0b25zKSxcbi8vIHBsdXMgdGhlIGZvcndhcmRlciBpdHNlbGYgKGJlbHQtYW5kLXN1c3BlbmRlcnM7IGl0IGlzIGFsc28gZXhjbHVkZWQgYnkgcmVmZXJlbmNlKS5cbmNvbnN0IERFRkFVTFRfU0tJUF9TVUJTVFJJTkdTID0gW1xuXHQnTG9nUmV0ZW50aW9uJyxcblx0J0N1c3RvbTo6Jyxcblx0J2ZyYW1ld29yay1vbkV2ZW50Jyxcblx0J0FXU0NES0NmbicsXG5cdCdCdWNrZXROb3RpZmljYXRpb25zSGFuZGxlcicsXG5cdCdQcm92aWRlcicsXG5cdCdMb2dGb3J3YXJkZXInLFxuXTtcblxuY2xhc3MgTG9nU2hpcHBpbmdBc3BlY3QgaW1wbGVtZW50cyBJQXNwZWN0IHtcblx0Y29uc3RydWN0b3IoXG5cdFx0cHJpdmF0ZSByZWFkb25seSBmb3J3YXJkZXI6IExhbWJkYUZ1bmN0aW9uLFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgZmlsdGVyUGF0dGVybjogSUZpbHRlclBhdHRlcm4sXG5cdFx0cHJpdmF0ZSByZWFkb25seSBza2lwU3Vic3RyaW5nczogc3RyaW5nW10sXG5cdCkge31cblxuXHR2aXNpdChub2RlOiBJQ29uc3RydWN0KTogdm9pZCB7XG5cdFx0aWYgKCEobm9kZSBpbnN0YW5jZW9mIExhbWJkYUZ1bmN0aW9uKSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAobm9kZSA9PT0gdGhpcy5mb3J3YXJkZXIpIHtcblx0XHRcdHJldHVybjsgLy8gbmV2ZXIgc3Vic2NyaWJlIHRoZSBmb3J3YXJkZXIgdG8gaXRzZWxmIOKAlCBpbmZpbml0ZSBsb29wXG5cdFx0fVxuXHRcdGNvbnN0IG5vZGVQYXRoID0gbm9kZS5ub2RlLnBhdGg7XG5cdFx0aWYgKHRoaXMuc2tpcFN1YnN0cmluZ3Muc29tZSgocykgPT4gbm9kZVBhdGguaW5jbHVkZXMocykpKSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGlmIChub2RlLm5vZGUudHJ5RmluZENoaWxkKCdMb2dTaGlwU3Vic2NyaXB0aW9uJykpIHtcblx0XHRcdHJldHVybjsgLy8gYXNwZWN0cyBjYW4gdmlzaXQgYSBub2RlIG1vcmUgdGhhbiBvbmNlOyBhZGQgdGhlIGZpbHRlciBvbmx5IG9uY2Vcblx0XHR9XG5cdFx0dHJ5IHtcblx0XHRcdG5ldyBTdWJzY3JpcHRpb25GaWx0ZXIobm9kZSwgJ0xvZ1NoaXBTdWJzY3JpcHRpb24nLCB7XG5cdFx0XHRcdGxvZ0dyb3VwOiBub2RlLmxvZ0dyb3VwLFxuXHRcdFx0XHQvLyBhZGRQZXJtaXNzaW9uczpmYWxzZSDigJQgYSBzaW5nbGUgd2lsZGNhcmQgaW52b2tlIHBlcm1pc3Npb24gaXMgYWRkZWQgb24gdGhlIGZvcndhcmRlciBpblxuXHRcdFx0XHQvLyBjb25zdHJ1Y3QoKSwgc28gd2UgZG9uJ3QgYWNjdW11bGF0ZSBvbmUgQ2ZuUGVybWlzc2lvbiBwZXIgbG9nIGdyb3VwLlxuXHRcdFx0XHRkZXN0aW5hdGlvbjogbmV3IExhbWJkYURlc3RpbmF0aW9uKHRoaXMuZm9yd2FyZGVyLCB7IGFkZFBlcm1pc3Npb25zOiBmYWxzZSB9KSxcblx0XHRcdFx0ZmlsdGVyUGF0dGVybjogdGhpcy5maWx0ZXJQYXR0ZXJuLFxuXHRcdFx0fSk7XG5cdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHQvLyBBIGxhbWJkYSB3aXRob3V0IGFuIGFkZHJlc3NhYmxlIGxvZyBncm91cCAocmFyZSBDREsgaW50ZXJuYWxzKSBtdXN0IG5ldmVyIGJyZWFrIHN5bnRoLlxuXHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdGNvbnNvbGUud2FybihgW0xvZ0ZvcndhcmRlcl0gc2tpcHBlZCAke25vZGVQYXRofTogJHsoZXJyIGFzIEVycm9yKS5tZXNzYWdlfWApO1xuXHRcdH1cblx0fVxufVxuXG4vKipcbiAqIE91dC1vZi1iYW5kIGxvZyBzaGlwcGluZyBmb3IgZXZlcnkgTGFtYmRhIGluIHRoZSBhcHAuXG4gKlxuICogQXR0YWNoZXMgYSBDbG91ZFdhdGNoIExvZ3Mgc3Vic2NyaXB0aW9uIGZpbHRlciB0byBlYWNoIGZ1bmN0aW9uJ3MgbG9nIGdyb3VwICh2aWEgYW4gQXNwZWN0KSwgcm91dGluZ1xuICogYmF0Y2hlZCwgZ3ppcHBlZCBldmVudHMgdG8gYSBzaW5nbGUgdGlueSBmb3J3YXJkZXIgTGFtYmRhIHRoYXQgc2hpcHMgdGhlbSB0byBhIFZlY3Rvci9Mb2d0cmFpbCBIVFRQXG4gKiBpbmdlc3QuIE5vdGhpbmcgcnVucyBpbiB0aGUgYXBwIHJlcXVlc3QgcGF0aCAoZnVuY3Rpb25zIG9ubHkgd3JpdGUgc3Rkb3V0KSwgc28gbG9nIHZvbHVtZSBuZXZlclxuICogZGVncmFkZXMgcmVxdWVzdCBsYXRlbmN5IGFuZCB0aGVyZSBhcmUgbm8gcGVyLWxvZyBIVFRQIGNhbGxzIGZyb20gdGhlIGhhbmRsZXJzLlxuICpcbiAqIEluc2lkZSB0aGUgZm9yd2FyZGVyLCBlYWNoIGxpbmUgcnVucyB0aHJvdWdoIGEgNC1zdGVwIHBpcGVsaW5lOiBOT1JNQUxJWkUgKHBlZWwgTGFtYmRhIHByZWZpeCwgbGlmdFxuICogZncyNCB0c2xvZyBKU09OLCBzdHJpcCBBTlNJKSDihpIgUkVDTEFTU0lGWSBiZW5pZ24gZXJyb3JzIOKGkiBEUk9QIG5vaXNlIOKGkiBET1dOR1JBREUgbm9pc2UuIFN0ZXBzIDLigJM0IGFyZVxuICogYXBwLW93bmVkIHJ1bGUgbGlzdHMgKHNlZSB7QGxpbmsgTG9nRm9yd2FyZGVyTm9pc2VSdWxlc30gLyB7QGxpbmsgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVN9KS5cbiAqXG4gKiBEZXBsb3ktdGltZSBjb25maWcgaXMgcmVhZCBmcm9tIGBGT1JXQVJERVJfKmAgZW52IHdoZW4gbm90IHBhc3NlZCBleHBsaWNpdGx5LiBgRk9SV0FSREVSXypgIGlzIHVzZWRcbiAqIChuZXZlciBgTE9HVFJBSUxfKmApIG9uIHB1cnBvc2U6IHNldHRpbmcgYExPR1RSQUlMXypgIGluIHRoZSBkZXBsb3kgc2hlbGwgd291bGQgYWN0aXZhdGUgZncyNCdzXG4gKiBpbi1wcm9jZXNzIGxvZyB0cmFuc3BvcnQgYW5kIGxlYWsgbG9jYWwgQ0RLL3N5bnRoIGxvZ3MgdG8gdGhlIGluZ2VzdC5cbiAqL1xuZXhwb3J0IGNsYXNzIExvZ0ZvcndhcmRlckNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuXHRyZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXHRyZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoTG9nRm9yd2FyZGVyQ29uc3RydWN0Lm5hbWUpO1xuXHRuYW1lID0gTG9nRm9yd2FyZGVyQ29uc3RydWN0Lm5hbWU7XG5cdGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcblx0b3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblx0bWFpblN0YWNrITogU3RhY2s7XG5cblx0Y29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjb25maWc6IExvZ0ZvcndhcmRlckNvbnN0cnVjdENvbmZpZyA9IHt9KSB7fVxuXG5cdHByaXZhdGUgcmVzb2x2ZU5vaXNlRW52KCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuXHRcdGNvbnN0IHJ1bGVzID0gdGhpcy5jb25maWcubm9pc2UgPz8ge307XG5cdFx0Y29uc3QgdXNlRGVmYXVsdHMgPSBydWxlcy51c2VEZWZhdWx0cyAhPT0gZmFsc2U7XG5cdFx0Y29uc3QgbWVyZ2UgPSAobGlzdDogc3RyaW5nW10gfCB1bmRlZmluZWQsIGRlZmF1bHRzOiBzdHJpbmdbXSk6IHN0cmluZ1tdID0+IHtcblx0XHRcdGNvbnN0IGJhc2UgPSB1c2VEZWZhdWx0cyA/IGRlZmF1bHRzIDogW107XG5cdFx0XHQvLyBEZS1kdXAgd2hpbGUgcHJlc2VydmluZyBvcmRlciAoZGVmYXVsdHMgZmlyc3QsIHRoZW4gYXBwIGFkZGl0aW9ucykuXG5cdFx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KFsgLi4uYmFzZSwgLi4uKGxpc3QgPz8gW10pIF0pIF07XG5cdFx0fTtcblx0XHRjb25zdCBiZW5pZ24gPSBtZXJnZShydWxlcy5iZW5pZ24sIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmJlbmlnbik7XG5cdFx0Y29uc3QgZHJvcCA9IG1lcmdlKHJ1bGVzLmRyb3AsIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmRyb3ApO1xuXHRcdGNvbnN0IGRvd25ncmFkZSA9IG1lcmdlKHJ1bGVzLmRvd25ncmFkZSwgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVMuZG93bmdyYWRlKTtcblx0XHRjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblx0XHRpZiAoYmVuaWduLmxlbmd0aCkgZW52LkZPUldBUkRFUl9OT0lTRV9CRU5JR04gPSBKU09OLnN0cmluZ2lmeShiZW5pZ24pO1xuXHRcdGlmIChkcm9wLmxlbmd0aCkgZW52LkZPUldBUkRFUl9OT0lTRV9EUk9QID0gSlNPTi5zdHJpbmdpZnkoZHJvcCk7XG5cdFx0aWYgKGRvd25ncmFkZS5sZW5ndGgpIGVudi5GT1JXQVJERVJfTk9JU0VfRE9XTkdSQURFID0gSlNPTi5zdHJpbmdpZnkoZG93bmdyYWRlKTtcblx0XHRyZXR1cm4gZW52O1xuXHR9XG5cblx0YXN5bmMgY29uc3RydWN0KCk6IFByb21pc2U8dm9pZD4ge1xuXHRcdC8vIERlZmF1bHQgc3RhY2sgKG5vIGhhcmRjb2RlZCBuYW1lKSDigJQgcmVzcGVjdHMgc3RhY2tOYW1lL3BhcmVudFN0YWNrTmFtZSBpZiB0aGUgYXBwIHNldHMgdGhlbS5cblx0XHR0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLmNvbmZpZy5zdGFja05hbWUsIHRoaXMuY29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cdFx0Y29uc3QgbyA9IHRoaXMuY29uZmlnO1xuXG5cdFx0Y29uc3QgZm9yd2FyZGVyTG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcy5tYWluU3RhY2ssICdMb2dGb3J3YXJkZXJGdW5jdGlvbkxvZ0dyb3VwJywge1xuXHRcdFx0cmV0ZW50aW9uOiBvLmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuXHRcdFx0cmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuXHRcdH0pO1xuXG5cdFx0Y29uc3QgaW5nZXN0SHR0cFVybCA9IG8uaW5nZXN0SHR0cFVybCA/PyBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1VSTD8udHJpbSgpID8/ICcnO1xuXHRcdGNvbnN0IHNlcnZpY2UgPSBvLnNlcnZpY2UgPz8gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX1NFUlZJQ0U/LnRyaW0oKSA/PyAnJztcblx0XHRjb25zdCBlbnYgPSBvLmVudiA/PyBwcm9jZXNzLmVudi5GT1JXQVJERVJfRU5WPy50cmltKCkgPz8gJyc7XG5cdFx0Y29uc3QgeEFwaUtleSA9IG8ueEFwaUtleSA/PyBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWT8udHJpbSgpO1xuXG5cdFx0aWYgKCFpbmdlc3RIdHRwVXJsKSB7XG5cdFx0XHQvLyBOb24tZmF0YWw6IHRoZSBmb3J3YXJkZXIgaGFuZGxlciBuby1vcHMgd2l0aG91dCBhbiBpbmdlc3QgVVJMLCBzbyBhIGJhY2tlbmQgY2FuIGFkb3B0IHRoZVxuXHRcdFx0Ly8gY29uc3RydWN0IGJlZm9yZSB0aGUgaW5nZXN0IGlzIHdpcmVkLiBXYXJuIHNvIGl0IGlzbid0IGEgc2lsZW50IG5vLW9wLlxuXHRcdFx0dGhpcy5sb2dnZXIud2Fybihcblx0XHRcdFx0J0xvZ0ZvcndhcmRlckNvbnN0cnVjdDogbm8gaW5nZXN0IFVSTCAoY29uZmlnLmluZ2VzdEh0dHBVcmwgLyBGT1JXQVJERVJfSU5HRVNUX1VSTCkuICdcblx0XHRcdFx0XHQrICdGb3J3YXJkZXIgZGVwbG95cyBidXQgc2hpcHMgbm90aGluZyB1bnRpbCBvbmUgaXMgc2V0LicsXG5cdFx0XHQpO1xuXHRcdH1cblxuXHRcdC8vIEZyYW1ld29yay1vd25lZCBoYW5kbGVyIHNoaXBwZWQgY29tcGlsZWQgaW4gZGlzdCAobWlycm9ycyBtYWlsZXIvZHluYW1vIGhhbmRsZXJzKS4gUmVzb2x2ZSB0aGVcblx0XHQvLyBjb21waWxlZCBgLmpzYCB3aGVuIGluc3RhbGxlZCAoZGlzdCksIGZhbGxpbmcgYmFjayB0byB0aGUgYC50c2Agc291cmNlIHdoZW4gcnVubmluZyBmcm9tIGZ3MjQnc1xuXHRcdC8vIG93biBzcmMgKHVuaXQgdGVzdHMgLyB0cy1ub2RlIGRldikgd2hlcmUgdGhlIGAuanNgIGhhc24ndCBiZWVuIGVtaXR0ZWQuXG5cdFx0Y29uc3QgaGFuZGxlckJhc2UgPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vY29yZS9ydW50aW1lL2xvZy1mb3J3YXJkZXItaGFuZGxlcicpO1xuXHRcdGNvbnN0IGhhbmRsZXJFbnRyeSA9IGV4aXN0c1N5bmMoYCR7aGFuZGxlckJhc2V9LmpzYCkgPyBgJHtoYW5kbGVyQmFzZX0uanNgIDogYCR7aGFuZGxlckJhc2V9LnRzYDtcblxuXHRcdGNvbnN0IGZvcndhcmRlciA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgJ0xvZ0ZvcndhcmRlckZ1bmN0aW9uJywge1xuXHRcdFx0ZW50cnk6IGhhbmRsZXJFbnRyeSxcblx0XHRcdGhhbmRsZXI6ICdoYW5kbGVyJyxcblx0XHRcdHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG5cdFx0XHRtZW1vcnlTaXplOiBvLm1lbW9yeVNpemUgPz8gMjU2LFxuXHRcdFx0dGltZW91dDogRHVyYXRpb24uc2Vjb25kcyhvLnRpbWVvdXRTZWNvbmRzID8/IDMwKSxcblx0XHRcdC4uLihvLnJlc2VydmVkQ29uY3VycmVuY3kgIT0gbnVsbCA/IHsgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogby5yZXNlcnZlZENvbmN1cnJlbmN5IH0gOiB7fSksXG5cdFx0XHRsb2dHcm91cDogZm9yd2FyZGVyTG9nR3JvdXAsXG5cdFx0XHRidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsgJ0Bhd3Mtc2RrJyBdLCBtaW5pZnk6IHRydWUgfSxcblx0XHRcdC8vIEZvcndhcmRlciBydW50aW1lIGVudiBpcyBmdWxseSBGT1JXQVJERVJfKi1uYW1lc3BhY2VkIOKAlCBubyBMT0dUUkFJTF8qIGtleXMsIHNvIGl0IGNhbiBuZXZlclxuXHRcdFx0Ly8gY29sbGlkZSB3aXRoIGZ3MjQncyBpbi1wcm9jZXNzIHRyYW5zcG9ydC5cblx0XHRcdGVudmlyb25tZW50OiB7XG5cdFx0XHRcdEZPUldBUkRFUl9JTkdFU1RfVVJMOiBpbmdlc3RIdHRwVXJsLFxuXHRcdFx0XHRGT1JXQVJERVJfU0VSVklDRTogc2VydmljZSxcblx0XHRcdFx0Rk9SV0FSREVSX0VOVjogZW52LFxuXHRcdFx0XHQuLi4oeEFwaUtleSA/IHsgRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk6IHhBcGlLZXkgfSA6IHt9KSxcblx0XHRcdFx0Li4uKG8uYmF0Y2hGb3JtYXQgPyB7IEZPUldBUkRFUl9CQVRDSF9GT1JNQVQ6IG8uYmF0Y2hGb3JtYXQgfSA6IHt9KSxcblx0XHRcdFx0Li4uKG8ubWF4QmF0Y2hCeXRlcyAhPSBudWxsID8geyBGT1JXQVJERVJfTUFYX0JBVENIX0JZVEVTOiBTdHJpbmcoby5tYXhCYXRjaEJ5dGVzKSB9IDoge30pLFxuXHRcdFx0XHQuLi50aGlzLnJlc29sdmVOb2lzZUVudigpLFxuXHRcdFx0fSxcblx0XHR9KTtcblxuXHRcdC8vIE9uZSBicm9hZCBpbnZva2UgcGVybWlzc2lvbiBpbnN0ZWFkIG9mIG9uZSBwZXIgbG9nIGdyb3VwOiBrZWVwcyB0aGUgZm9yd2FyZGVyJ3MgcmVzb3VyY2Vcblx0XHQvLyBwb2xpY3kgc21hbGwgKExhbWJkYSBjYXBzIGl0IGF0IH4yMEtCKSBhcyB0aGUgbnVtYmVyIG9mIHN1YnNjcmliZWQgZnVuY3Rpb25zIGdyb3dzLlxuXHRcdGZvcndhcmRlci5hZGRQZXJtaXNzaW9uKCdBbGxvd0Nsb3VkV2F0Y2hMb2dzSW52b2tlJywge1xuXHRcdFx0cHJpbmNpcGFsOiBuZXcgU2VydmljZVByaW5jaXBhbCgnbG9ncy5hbWF6b25hd3MuY29tJyksXG5cdFx0XHRhY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nLFxuXHRcdFx0c291cmNlQWNjb3VudDogdGhpcy5tYWluU3RhY2suYWNjb3VudCxcblx0XHRcdHNvdXJjZUFybjogYGFybjphd3M6bG9nczoke3RoaXMubWFpblN0YWNrLnJlZ2lvbn06JHt0aGlzLm1haW5TdGFjay5hY2NvdW50fTpsb2ctZ3JvdXA6KmAsXG5cdFx0fSk7XG5cblx0XHRjb25zdCBza2lwID0gWyAuLi5ERUZBVUxUX1NLSVBfU1VCU1RSSU5HUywgLi4uKG8uZXhjbHVkZUZ1bmN0aW9uUGF0aFN1YnN0cmluZ3MgPz8gW10pIF07XG5cdFx0Ly8gJ2FwcCcg4oaSIHN1YnNjcmliZSBldmVyeSBMYW1iZGEgaW4gdGhlIHdob2xlIENESyBhcHAgKGluZGVwZW5kZW50IHRvcC1sZXZlbCBzdGFja3MgdG9vKTtcblx0XHQvLyAnc3RhY2snIChkZWZhdWx0KSDihpIgdGhpcyBzdGFjayArIG5lc3RlZCBzdGFja3MgdW5kZXIgaXQuXG5cdFx0Y29uc3Qgc2NvcGVSb290OiBJQ29uc3RydWN0ID1cblx0XHRcdG8uc3Vic2NyaWJlU2NvcGUgPT09ICdhcHAnID8gdGhpcy5tYWluU3RhY2subm9kZS5yb290IDogdGhpcy5tYWluU3RhY2s7XG5cdFx0QXNwZWN0cy5vZihzY29wZVJvb3QpLmFkZChcblx0XHRcdG5ldyBMb2dTaGlwcGluZ0FzcGVjdChmb3J3YXJkZXIsIG8uZmlsdGVyUGF0dGVybiA/PyBGaWx0ZXJQYXR0ZXJuLmFsbEV2ZW50cygpLCBza2lwKSxcblx0XHQpO1xuXG5cdFx0dGhpcy5vdXRwdXQgPSB7fSBhcyBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXHR9XG59XG4iXX0=