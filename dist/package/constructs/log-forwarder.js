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
        // service/env default to what fw24 already knows (hydrated from APP_NAME / APP_ENVIRONMENT), so a
        // backend usually doesn't pass them. Precedence: explicit option > FORWARDER_* env > fw24 config.
        const cfg = this.fw24.getConfig();
        const ingestHttpUrl = o.ingestHttpUrl ?? process.env.FORWARDER_INGEST_URL?.trim() ?? '';
        const service = o.service ?? (process.env.FORWARDER_SERVICE?.trim() || this.fw24.appName || '');
        const env = o.env ?? (process.env.FORWARDER_ENV?.trim() || cfg.environment || '');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2xvZy1mb3J3YXJkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQWtDO0FBQ2xDLHFDQUFxQztBQUNyQyw2Q0FBb0Y7QUFDcEYsaURBQXVEO0FBQ3ZELHVEQUE2RTtBQUM3RSxxRUFBK0Q7QUFDL0QsbURBQXVIO0FBQ3ZILDZFQUFzRTtBQUV0RSx1Q0FBb0M7QUFHcEMsd0NBQTBDO0FBeUUxQzs7OztHQUlHO0FBQ1UsUUFBQSx1QkFBdUIsR0FBMEQ7SUFDN0YsMkRBQTJEO0lBQzNELE1BQU0sRUFBRTtRQUNQLGtCQUFrQjtRQUNsQixhQUFhO1FBQ2IsYUFBYTtRQUNiLHdDQUF3QztRQUN4QywwQkFBMEI7UUFDMUIsa0JBQWtCO1FBQ2xCLGlCQUFpQjtLQUNqQjtJQUNELGdDQUFnQztJQUNoQyxJQUFJLEVBQUU7UUFDTCw4Q0FBOEM7UUFDOUMsa0JBQWtCO1FBQ2xCLG1CQUFtQjtLQUNuQjtJQUNELGlEQUFpRDtJQUNqRCxTQUFTLEVBQUU7UUFDVixzQkFBc0I7UUFDdEIsZ0JBQWdCO0tBQ2hCO0NBQ0QsQ0FBQztBQUVGLDhGQUE4RjtBQUM5RixxRkFBcUY7QUFDckYsTUFBTSx1QkFBdUIsR0FBRztJQUMvQixjQUFjO0lBQ2QsVUFBVTtJQUNWLG1CQUFtQjtJQUNuQixXQUFXO0lBQ1gsNEJBQTRCO0lBQzVCLFVBQVU7SUFDVixjQUFjO0NBQ2QsQ0FBQztBQUVGLE1BQU0saUJBQWlCO0lBRUo7SUFDQTtJQUNBO0lBSGxCLFlBQ2tCLFNBQXlCLEVBQ3pCLGFBQTZCLEVBQzdCLGNBQXdCO1FBRnhCLGNBQVMsR0FBVCxTQUFTLENBQWdCO1FBQ3pCLGtCQUFhLEdBQWIsYUFBYSxDQUFnQjtRQUM3QixtQkFBYyxHQUFkLGNBQWMsQ0FBVTtJQUN2QyxDQUFDO0lB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Q3JDLFNBQVMsRUFBRSxnQkFBZ0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLGNBQWM7U0FDeEYsQ0FBQyxDQUFDO1FBRUgsTUFBTSxJQUFJLEdBQUcsQ0FBRSxHQUFHLHVCQUF1QixFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsNkJBQTZCLElBQUksRUFBRSxDQUFDLENBQUUsQ0FBQztRQUN4RiwwRkFBMEY7UUFDMUYsMkRBQTJEO1FBQzNELE1BQU0sU0FBUyxHQUNkLENBQUMsQ0FBQyxjQUFjLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDeEUscUJBQU8sQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxDQUN4QixJQUFJLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUMsYUFBYSxJQUFJLHdCQUFhLENBQUMsU0FBUyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQ3BGLENBQUM7UUFFRixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQXlCLENBQUM7SUFDekMsQ0FBQztDQUNEO0FBdkdELHNEQXVHQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IEFzcGVjdHMsIER1cmF0aW9uLCBSZW1vdmFsUG9saWN5LCBTdGFjaywgdHlwZSBJQXNwZWN0IH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgU2VydmljZVByaW5jaXBhbCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgRnVuY3Rpb24gYXMgTGFtYmRhRnVuY3Rpb24sIFJ1bnRpbWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xuaW1wb3J0IHsgRmlsdGVyUGF0dGVybiwgdHlwZSBJRmlsdGVyUGF0dGVybiwgTG9nR3JvdXAsIFJldGVudGlvbkRheXMsIFN1YnNjcmlwdGlvbkZpbHRlciB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IExhbWJkYURlc3RpbmF0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MtZGVzdGluYXRpb25zJztcbmltcG9ydCB0eXBlIHsgSUNvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gJy4uL2NvcmUvZncyNCc7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0IH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QnO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gJy4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcblxuLyoqXG4gKiBBcHAtb3duZWQgbm9pc2UgLyBzZXZlcml0eSBydWxlcywgYXBwbGllZCBwZXIgbG9nIGxpbmUgaW5zaWRlIHRoZSBmb3J3YXJkZXIgTGFtYmRhIChsYXllcnMgMuKAkzQgb2YgdGhlXG4gKiBwaXBlbGluZTsgc2VlIGBMb2dGb3J3YXJkZXJDb25zdHJ1Y3RgKS4gRWFjaCBsaXN0IGlzIGFuIGFycmF5IG9mIHJlZ2V4IHNvdXJjZSBzdHJpbmdzLCBtYXRjaGVkXG4gKiBjYXNlLWluc2Vuc2l0aXZlbHkgYWdhaW5zdCB0aGUgbm9ybWFsaXplZCBtZXNzYWdlLiBUaGVzZSBhcmUgY29tcGxlbWVudGFyeSB0byBhbnkgZ2xvYmFsIHNldmVyaXR5L1xuICogbm9pc2UgaGFuZGxpbmcgYSBzaGFyZWQgVmVjdG9yIGluZ2VzdCBtYXkgYWxzbyBydW4g4oCUIHRoaXMgbGF5ZXIgbGV0cyBlYWNoIGFwcCBvd24gaXRzIG93biBydWxlcyBhbmQsXG4gKiBmb3IgYGRyb3BgLCBzYXZlcyBpbmdlc3QgYmFuZHdpZHRoIGJ5IHJlbW92aW5nIG5vaXNlIGF0IHRoZSBzb3VyY2UuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9nRm9yd2FyZGVyTm9pc2VSdWxlcyB7XG5cdC8qKiBFcnJvci1pc2ggbGluZXMgbWF0Y2hpbmcgdGhlc2UgYXJlIGRvd25ncmFkZWQgdG8gYHdhcm5gICh0YWdnZWQgYHJlY2xhc3NpZmllZDogXCJiZW5pZ25cImApLiAqL1xuXHRiZW5pZ24/OiBzdHJpbmdbXTtcblx0LyoqIExpbmVzIG1hdGNoaW5nIHRoZXNlIGFyZSBkcm9wcGVkIGVudGlyZWx5IOKAlCBuZXZlciBzaGlwcGVkLiAqL1xuXHRkcm9wPzogc3RyaW5nW107XG5cdC8qKiBMaW5lcyBtYXRjaGluZyB0aGVzZSBhcmUgZG93bmdyYWRlZCB0byBgZGVidWdgICh0YWdnZWQgYHJlY2xhc3NpZmllZDogXCJub2lzZVwiYCkuICovXG5cdGRvd25ncmFkZT86IHN0cmluZ1tdO1xuXHQvKipcblx0ICogV2hlbiB0cnVlIChkZWZhdWx0KSwgdGhlIGJ1aWx0LWluIHtAbGluayBERUZBVUxUX0xPR19OT0lTRV9SVUxFU30gYXJlIG1lcmdlZCB3aXRoIHRoZSBsaXN0cyBhYm92ZS5cblx0ICogU2V0IGZhbHNlIHRvIHVzZSBPTkxZIHRoZSBsaXN0cyB5b3UgcHJvdmlkZSAob3Igbm9uZSkuXG5cdCAqL1xuXHR1c2VEZWZhdWx0cz86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTG9nRm9yd2FyZGVyQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG5cdC8qKiBWZWN0b3IvTG9ndHJhaWwgSFRUUCBKU09OIGluZ2VzdCBVUkwuIERlZmF1bHRzIHRvIGBGT1JXQVJERVJfSU5HRVNUX1VSTGAgYXQgZGVwbG95IHRpbWUuICovXG5cdGluZ2VzdEh0dHBVcmw/OiBzdHJpbmc7XG5cdC8qKlxuXHQgKiBCYXNlIGBzZXJ2aWNlYCBsYWJlbCBmb3Igc2hpcHBlZCBsb2dzIChlbnYgaXMgZm9sZGVkIGluKS4gVXN1YWxseSBvbWl0IOKAlCBkZWZhdWx0cyB0byB0aGUgZncyNFxuXHQgKiBhcHAgbmFtZSAoYEFQUF9OQU1FYCk7IG92ZXJyaWRlIHdpdGggdGhpcyBvcHRpb24gb3IgYEZPUldBUkRFUl9TRVJWSUNFYC5cblx0ICovXG5cdHNlcnZpY2U/OiBzdHJpbmc7XG5cdC8qKlxuXHQgKiBTdGFnZS9vd25lciBsYWJlbCAoZS5nLiBgZGV2ZWxvcGAsIGBwcm9kYCwgYHNhbmRib3gtbml0aW5gKSDigJQgZm9sZGVkIGludG8gdGhlIGBzZXJ2aWNlYCBsYWJlbFxuXHQgKiAoYG15c2VydmljZS1kZXZlbG9wYCkgYW5kIGVtaXR0ZWQgYXMgYGVudmAgc28gZGV2ZWxvcC9wcm9kL3Blci1kZXZlbG9wZXIgbG9ncyBhcmUgZGlzdGluZ3Vpc2hhYmxlXG5cdCAqIGluIExvZ3RyYWlsLiBVc3VhbGx5IG9taXQg4oCUIGRlZmF1bHRzIHRvIHRoZSBmdzI0IGVudmlyb25tZW50IChgQVBQX0VOVklST05NRU5UYCk7IG92ZXJyaWRlIHdpdGhcblx0ICogdGhpcyBvcHRpb24gb3IgYEZPUldBUkRFUl9FTlZgLlxuXHQgKi9cblx0ZW52Pzogc3RyaW5nO1xuXHQvKiogT3B0aW9uYWwgYHgtYXBpLWtleWAgd2hlbiB0aGUgaW5nZXN0IGZyb250IHJlcXVpcmVzIGl0LiBEZWZhdWx0cyB0byBgRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVlgLiAqL1xuXHR4QXBpS2V5Pzogc3RyaW5nO1xuXHQvKiogQmF0Y2ggd2lyZSBmb3JtYXQg4oCUIG11c3QgbWF0Y2ggeW91ciBWZWN0b3IgaHR0cCBzb3VyY2UgZGVjb2RpbmcuIERlZmF1bHQ6IGBqc29uLWFycmF5YC4gKi9cblx0YmF0Y2hGb3JtYXQ/OiAnbmRqc29uJyB8ICdqc29uLWFycmF5Jztcblx0LyoqIE1heCB1bmNvbXByZXNzZWQgYnl0ZXMgcGVyIFBPU1QgKHRoZSBmb3J3YXJkZXIgc3BsaXRzIGxhcmdlciBiYXRjaGVzKS4gRGVmYXVsdDogMSwwMDAsMDAwLiAqL1xuXHRtYXhCYXRjaEJ5dGVzPzogbnVtYmVyO1xuXHQvKiogQ2xvdWRXYXRjaCBzdWJzY3JpcHRpb24tZmlsdGVyIHBhdHRlcm4g4oCUIHRoZSB2b2x1bWUvY29zdCBsZXZlciAoZS5nLiBvbmx5IFdBUk4vRVJST1IpLiBEZWZhdWx0OiBhbGwgZXZlbnRzLiAqL1xuXHRmaWx0ZXJQYXR0ZXJuPzogSUZpbHRlclBhdHRlcm47XG5cdC8qKiBFeHRyYSBmdW5jdGlvbiBjb25zdHJ1Y3QtcGF0aCBzdWJzdHJpbmdzIHRvIHNraXAgKG5ldmVyIHN1YnNjcmliZSkuICovXG5cdGV4Y2x1ZGVGdW5jdGlvblBhdGhTdWJzdHJpbmdzPzogc3RyaW5nW107XG5cdC8qKiBBcHAtb3duZWQgbm9pc2Uvc2V2ZXJpdHkgcnVsZXMgYXBwbGllZCBpbnNpZGUgdGhlIGZvcndhcmRlciAobGF5ZXJzIDLigJM0KS4gKi9cblx0bm9pc2U/OiBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzO1xuXHQvKipcblx0ICogV2hpY2ggY29uc3RydWN0IHRyZWUgdG8gc3Vic2NyaWJlLlxuXHQgKiAtIGAnc3RhY2snYCAoZGVmYXVsdCk6IHRoZSBmb3J3YXJkZXIncyBzdGFjayBhbmQgYW55IG5lc3RlZCBzdGFja3MgdW5kZXIgaXQgKGNvdmVycyB0aGUgY29tbW9uXG5cdCAqICAgc2F0ZWxsaXRlIGFwcCwgaW5jbHVkaW5nIHBlci1jb250cm9sbGVyIG5lc3RlZCBzdGFja3MgcGFyZW50ZWQgdG8gdGhlIGRlZmF1bHQgc3RhY2spLlxuXHQgKiAtIGAnYXBwJ2A6IHRoZSB3aG9sZSBDREsgYXBwIOKAlCB1c2Ugd2hlbiBhIGJhY2tlbmQgaGFzIGluZGVwZW5kZW50IHRvcC1sZXZlbCBzdGFja3MgKGUuZy4gYSBzZXBhcmF0ZVxuXHQgKiAgIGBwZXJzaXN0ZW50YC9kYXRhIHN0YWNrKS4gTm90ZSB0aGlzIGNyZWF0ZXMgY3Jvc3Mtc3RhY2sgc3Vic2NyaXB0aW9u4oaSZm9yd2FyZGVyIHJlZmVyZW5jZXMsIHNvXG5cdCAqICAgdmVyaWZ5IHN5bnRoIGRvZXNuJ3QgaW50cm9kdWNlIGEgY3ljbGljIHN0YWNrIGRlcGVuZGVuY3kuXG5cdCAqL1xuXHRzdWJzY3JpYmVTY29wZT86ICdzdGFjaycgfCAnYXBwJztcblx0LyoqIEZvcndhcmRlciBmdW5jdGlvbiBtZW1vcnkgKE1CKS4gRGVmYXVsdCAyNTYuICovXG5cdG1lbW9yeVNpemU/OiBudW1iZXI7XG5cdC8qKiBGb3J3YXJkZXIgZnVuY3Rpb24gdGltZW91dCAoc2Vjb25kcykuIERlZmF1bHQgMzAuICovXG5cdHRpbWVvdXRTZWNvbmRzPzogbnVtYmVyO1xuXHQvKipcblx0ICogQ2FwIGZvcndhcmRlciBjb25jdXJyZW5jeSB0byBwcm90ZWN0IHRoZSBpbmdlc3QgZnJvbSBhIGxvZyBzdG9ybS4gT3B0LWluOiByZXNlcnZpbmcgY29uY3VycmVuY3lcblx0ICogc3VidHJhY3RzIGZyb20gdGhlIGFjY291bnQncyBzaGFyZWQgcG9vbCwgc28gYSBiYWQgdmFsdWUgY2FuIGZhaWwgZGVwbG95cyBpbiBjb25zdHJhaW5lZCBhY2NvdW50cy5cblx0ICogUmVjb21tZW5kZWQgaW4gcHJvZCAoZS5nLiAxMOKAkzIwKS5cblx0ICovXG5cdHJlc2VydmVkQ29uY3VycmVuY3k/OiBudW1iZXI7XG5cdC8qKiBGb3J3YXJkZXIncyBvd24gbG9nIHJldGVudGlvbi4gRGVmYXVsdDogb25lIHdlZWsuICovXG5cdGxvZ1JldGVudGlvbj86IFJldGVudGlvbkRheXM7XG59XG5cbi8qKlxuICogQ3VyYXRlZCwgZ2VuZXJhbGx5LXNhZmUgZGVmYXVsdCBub2lzZS9zZXZlcml0eSBydWxlcyDigJQgbWlycm9ycyB0aGUgTG9ndHJhaWwgVmVjdG9yIFwiQTFcIiBsaXN0IHNvIGFcbiAqIGJhY2tlbmQgZ2V0cyBzZW5zaWJsZSBsb2cgaHlnaWVuZSBvdXQgb2YgdGhlIGJveC4gTWVyZ2UtaW4gYnkgZGVmYXVsdDsgb3ZlcnJpZGUgdmlhXG4gKiB7QGxpbmsgTG9nRm9yd2FyZGVyTm9pc2VSdWxlcy51c2VEZWZhdWx0c30uIEV4cG9ydGVkIHNvIGFwcHMgY2FuIGluc3BlY3QgLyBleHRlbmQgdGhlIGxpc3RzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVM6IFJlcXVpcmVkPE9taXQ8TG9nRm9yd2FyZGVyTm9pc2VSdWxlcywgJ3VzZURlZmF1bHRzJz4+ID0ge1xuXHQvLyBCZW5pZ24gXCJlcnJvcnNcIiDihpIgd2Fybiwgc28gZXJyb3IgY291bnRzIHN0YXkgbWVhbmluZ2Z1bC5cblx0YmVuaWduOiBbXG5cdFx0J1xcXFxiRUNPTk5SRVNFVFxcXFxiJyxcblx0XHQnXFxcXGJFUElQRVxcXFxiJyxcblx0XHQnYnJva2VuIHBpcGUnLFxuXHRcdCdjbGllbnQgKD86Y2xvc2VkIHJlcXVlc3R8ZGlzY29ubmVjdGVkKScsXG5cdFx0J2Nvbm5lY3Rpb24gcmVzZXQgYnkgcGVlcicsXG5cdFx0J2NvbnRleHQgY2FuY2VsZWQnLFxuXHRcdCdyZXF1ZXN0IGFib3J0ZWQnLFxuXHRdLFxuXHQvLyBIZWFsdGgvcHJvYmUgbm9pc2Ug4oaSIGRyb3BwZWQuXG5cdGRyb3A6IFtcblx0XHQnR0VUIC8oPzpoZWFsdGh8aGVhbHRoenxyZWFkeXp8bGl2ZXp8cGluZylcXFxcYicsXG5cdFx0J1xcXFxia3ViZS1wcm9iZVxcXFxiJyxcblx0XHQnRUxCLUhlYWx0aENoZWNrZXInLFxuXHRdLFxuXHQvLyBMb3ctdmFsdWUgbm9pc2Ug4oaSIGRlYnVnIChrZXB0LCBkZS1lbXBoYXNpc2VkKS5cblx0ZG93bmdyYWRlOiBbXG5cdFx0J2RlcHJlY2F0aW9uLj93YXJuaW5nJyxcblx0XHQnL2Zhdmljb25cXFxcLmljbycsXG5cdF0sXG59O1xuXG4vLyBDREstaW50ZXJuYWwgLyBjdXN0b20tcmVzb3VyY2UgbGFtYmRhcyB3ZSBuZXZlciBzdWJzY3JpYmUgKG5vaXNlICsgY3Jvc3Mtc3RhY2sgc2luZ2xldG9ucyksXG4vLyBwbHVzIHRoZSBmb3J3YXJkZXIgaXRzZWxmIChiZWx0LWFuZC1zdXNwZW5kZXJzOyBpdCBpcyBhbHNvIGV4Y2x1ZGVkIGJ5IHJlZmVyZW5jZSkuXG5jb25zdCBERUZBVUxUX1NLSVBfU1VCU1RSSU5HUyA9IFtcblx0J0xvZ1JldGVudGlvbicsXG5cdCdDdXN0b206OicsXG5cdCdmcmFtZXdvcmstb25FdmVudCcsXG5cdCdBV1NDREtDZm4nLFxuXHQnQnVja2V0Tm90aWZpY2F0aW9uc0hhbmRsZXInLFxuXHQnUHJvdmlkZXInLFxuXHQnTG9nRm9yd2FyZGVyJyxcbl07XG5cbmNsYXNzIExvZ1NoaXBwaW5nQXNwZWN0IGltcGxlbWVudHMgSUFzcGVjdCB7XG5cdGNvbnN0cnVjdG9yKFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgZm9yd2FyZGVyOiBMYW1iZGFGdW5jdGlvbixcblx0XHRwcml2YXRlIHJlYWRvbmx5IGZpbHRlclBhdHRlcm46IElGaWx0ZXJQYXR0ZXJuLFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgc2tpcFN1YnN0cmluZ3M6IHN0cmluZ1tdLFxuXHQpIHt9XG5cblx0dmlzaXQobm9kZTogSUNvbnN0cnVjdCk6IHZvaWQge1xuXHRcdGlmICghKG5vZGUgaW5zdGFuY2VvZiBMYW1iZGFGdW5jdGlvbikpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aWYgKG5vZGUgPT09IHRoaXMuZm9yd2FyZGVyKSB7XG5cdFx0XHRyZXR1cm47IC8vIG5ldmVyIHN1YnNjcmliZSB0aGUgZm9yd2FyZGVyIHRvIGl0c2VsZiDigJQgaW5maW5pdGUgbG9vcFxuXHRcdH1cblx0XHRjb25zdCBub2RlUGF0aCA9IG5vZGUubm9kZS5wYXRoO1xuXHRcdGlmICh0aGlzLnNraXBTdWJzdHJpbmdzLnNvbWUoKHMpID0+IG5vZGVQYXRoLmluY2x1ZGVzKHMpKSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAobm9kZS5ub2RlLnRyeUZpbmRDaGlsZCgnTG9nU2hpcFN1YnNjcmlwdGlvbicpKSB7XG5cdFx0XHRyZXR1cm47IC8vIGFzcGVjdHMgY2FuIHZpc2l0IGEgbm9kZSBtb3JlIHRoYW4gb25jZTsgYWRkIHRoZSBmaWx0ZXIgb25seSBvbmNlXG5cdFx0fVxuXHRcdHRyeSB7XG5cdFx0XHRuZXcgU3Vic2NyaXB0aW9uRmlsdGVyKG5vZGUsICdMb2dTaGlwU3Vic2NyaXB0aW9uJywge1xuXHRcdFx0XHRsb2dHcm91cDogbm9kZS5sb2dHcm91cCxcblx0XHRcdFx0Ly8gYWRkUGVybWlzc2lvbnM6ZmFsc2Ug4oCUIGEgc2luZ2xlIHdpbGRjYXJkIGludm9rZSBwZXJtaXNzaW9uIGlzIGFkZGVkIG9uIHRoZSBmb3J3YXJkZXIgaW5cblx0XHRcdFx0Ly8gY29uc3RydWN0KCksIHNvIHdlIGRvbid0IGFjY3VtdWxhdGUgb25lIENmblBlcm1pc3Npb24gcGVyIGxvZyBncm91cC5cblx0XHRcdFx0ZGVzdGluYXRpb246IG5ldyBMYW1iZGFEZXN0aW5hdGlvbih0aGlzLmZvcndhcmRlciwgeyBhZGRQZXJtaXNzaW9uczogZmFsc2UgfSksXG5cdFx0XHRcdGZpbHRlclBhdHRlcm46IHRoaXMuZmlsdGVyUGF0dGVybixcblx0XHRcdH0pO1xuXHRcdH0gY2F0Y2ggKGVycikge1xuXHRcdFx0Ly8gQSBsYW1iZGEgd2l0aG91dCBhbiBhZGRyZXNzYWJsZSBsb2cgZ3JvdXAgKHJhcmUgQ0RLIGludGVybmFscykgbXVzdCBuZXZlciBicmVhayBzeW50aC5cblx0XHRcdC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG5cdFx0XHRjb25zb2xlLndhcm4oYFtMb2dGb3J3YXJkZXJdIHNraXBwZWQgJHtub2RlUGF0aH06ICR7KGVyciBhcyBFcnJvcikubWVzc2FnZX1gKTtcblx0XHR9XG5cdH1cbn1cblxuLyoqXG4gKiBPdXQtb2YtYmFuZCBsb2cgc2hpcHBpbmcgZm9yIGV2ZXJ5IExhbWJkYSBpbiB0aGUgYXBwLlxuICpcbiAqIEF0dGFjaGVzIGEgQ2xvdWRXYXRjaCBMb2dzIHN1YnNjcmlwdGlvbiBmaWx0ZXIgdG8gZWFjaCBmdW5jdGlvbidzIGxvZyBncm91cCAodmlhIGFuIEFzcGVjdCksIHJvdXRpbmdcbiAqIGJhdGNoZWQsIGd6aXBwZWQgZXZlbnRzIHRvIGEgc2luZ2xlIHRpbnkgZm9yd2FyZGVyIExhbWJkYSB0aGF0IHNoaXBzIHRoZW0gdG8gYSBWZWN0b3IvTG9ndHJhaWwgSFRUUFxuICogaW5nZXN0LiBOb3RoaW5nIHJ1bnMgaW4gdGhlIGFwcCByZXF1ZXN0IHBhdGggKGZ1bmN0aW9ucyBvbmx5IHdyaXRlIHN0ZG91dCksIHNvIGxvZyB2b2x1bWUgbmV2ZXJcbiAqIGRlZ3JhZGVzIHJlcXVlc3QgbGF0ZW5jeSBhbmQgdGhlcmUgYXJlIG5vIHBlci1sb2cgSFRUUCBjYWxscyBmcm9tIHRoZSBoYW5kbGVycy5cbiAqXG4gKiBJbnNpZGUgdGhlIGZvcndhcmRlciwgZWFjaCBsaW5lIHJ1bnMgdGhyb3VnaCBhIDQtc3RlcCBwaXBlbGluZTogTk9STUFMSVpFIChwZWVsIExhbWJkYSBwcmVmaXgsIGxpZnRcbiAqIGZ3MjQgdHNsb2cgSlNPTiwgc3RyaXAgQU5TSSkg4oaSIFJFQ0xBU1NJRlkgYmVuaWduIGVycm9ycyDihpIgRFJPUCBub2lzZSDihpIgRE9XTkdSQURFIG5vaXNlLiBTdGVwcyAy4oCTNCBhcmVcbiAqIGFwcC1vd25lZCBydWxlIGxpc3RzIChzZWUge0BsaW5rIExvZ0ZvcndhcmRlck5vaXNlUnVsZXN9IC8ge0BsaW5rIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTfSkuXG4gKlxuICogRGVwbG95LXRpbWUgY29uZmlnIGlzIHJlYWQgZnJvbSBgRk9SV0FSREVSXypgIGVudiB3aGVuIG5vdCBwYXNzZWQgZXhwbGljaXRseS4gYEZPUldBUkRFUl8qYCBpcyB1c2VkXG4gKiAobmV2ZXIgYExPR1RSQUlMXypgKSBvbiBwdXJwb3NlOiBzZXR0aW5nIGBMT0dUUkFJTF8qYCBpbiB0aGUgZGVwbG95IHNoZWxsIHdvdWxkIGFjdGl2YXRlIGZ3MjQnc1xuICogaW4tcHJvY2VzcyBsb2cgdHJhbnNwb3J0IGFuZCBsZWFrIGxvY2FsIENESy9zeW50aCBsb2dzIHRvIHRoZSBpbmdlc3QuXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dGb3J3YXJkZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcblx0cmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblx0cmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKExvZ0ZvcndhcmRlckNvbnN0cnVjdC5uYW1lKTtcblx0bmFtZSA9IExvZ0ZvcndhcmRlckNvbnN0cnVjdC5uYW1lO1xuXHRkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG5cdG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cdG1haW5TdGFjayE6IFN0YWNrO1xuXG5cdGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgY29uZmlnOiBMb2dGb3J3YXJkZXJDb25zdHJ1Y3RDb25maWcgPSB7fSkge31cblxuXHRwcml2YXRlIHJlc29sdmVOb2lzZUVudigpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcblx0XHRjb25zdCBydWxlcyA9IHRoaXMuY29uZmlnLm5vaXNlID8/IHt9O1xuXHRcdGNvbnN0IHVzZURlZmF1bHRzID0gcnVsZXMudXNlRGVmYXVsdHMgIT09IGZhbHNlO1xuXHRcdGNvbnN0IG1lcmdlID0gKGxpc3Q6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLCBkZWZhdWx0czogc3RyaW5nW10pOiBzdHJpbmdbXSA9PiB7XG5cdFx0XHRjb25zdCBiYXNlID0gdXNlRGVmYXVsdHMgPyBkZWZhdWx0cyA6IFtdO1xuXHRcdFx0Ly8gRGUtZHVwIHdoaWxlIHByZXNlcnZpbmcgb3JkZXIgKGRlZmF1bHRzIGZpcnN0LCB0aGVuIGFwcCBhZGRpdGlvbnMpLlxuXHRcdFx0cmV0dXJuIFsgLi4ubmV3IFNldChbIC4uLmJhc2UsIC4uLihsaXN0ID8/IFtdKSBdKSBdO1xuXHRcdH07XG5cdFx0Y29uc3QgYmVuaWduID0gbWVyZ2UocnVsZXMuYmVuaWduLCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUy5iZW5pZ24pO1xuXHRcdGNvbnN0IGRyb3AgPSBtZXJnZShydWxlcy5kcm9wLCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUy5kcm9wKTtcblx0XHRjb25zdCBkb3duZ3JhZGUgPSBtZXJnZShydWxlcy5kb3duZ3JhZGUsIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmRvd25ncmFkZSk7XG5cdFx0Y29uc3QgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cdFx0aWYgKGJlbmlnbi5sZW5ndGgpIGVudi5GT1JXQVJERVJfTk9JU0VfQkVOSUdOID0gSlNPTi5zdHJpbmdpZnkoYmVuaWduKTtcblx0XHRpZiAoZHJvcC5sZW5ndGgpIGVudi5GT1JXQVJERVJfTk9JU0VfRFJPUCA9IEpTT04uc3RyaW5naWZ5KGRyb3ApO1xuXHRcdGlmIChkb3duZ3JhZGUubGVuZ3RoKSBlbnYuRk9SV0FSREVSX05PSVNFX0RPV05HUkFERSA9IEpTT04uc3RyaW5naWZ5KGRvd25ncmFkZSk7XG5cdFx0cmV0dXJuIGVudjtcblx0fVxuXG5cdGFzeW5jIGNvbnN0cnVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcblx0XHQvLyBEZWZhdWx0IHN0YWNrIChubyBoYXJkY29kZWQgbmFtZSkg4oCUIHJlc3BlY3RzIHN0YWNrTmFtZS9wYXJlbnRTdGFja05hbWUgaWYgdGhlIGFwcCBzZXRzIHRoZW0uXG5cdFx0dGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5jb25maWcuc3RhY2tOYW1lLCB0aGlzLmNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXHRcdGNvbnN0IG8gPSB0aGlzLmNvbmZpZztcblxuXHRcdGNvbnN0IGZvcndhcmRlckxvZ0dyb3VwID0gbmV3IExvZ0dyb3VwKHRoaXMubWFpblN0YWNrLCAnTG9nRm9yd2FyZGVyRnVuY3Rpb25Mb2dHcm91cCcsIHtcblx0XHRcdHJldGVudGlvbjogby5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcblx0XHRcdHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcblx0XHR9KTtcblxuXHRcdC8vIHNlcnZpY2UvZW52IGRlZmF1bHQgdG8gd2hhdCBmdzI0IGFscmVhZHkga25vd3MgKGh5ZHJhdGVkIGZyb20gQVBQX05BTUUgLyBBUFBfRU5WSVJPTk1FTlQpLCBzbyBhXG5cdFx0Ly8gYmFja2VuZCB1c3VhbGx5IGRvZXNuJ3QgcGFzcyB0aGVtLiBQcmVjZWRlbmNlOiBleHBsaWNpdCBvcHRpb24gPiBGT1JXQVJERVJfKiBlbnYgPiBmdzI0IGNvbmZpZy5cblx0XHRjb25zdCBjZmcgPSB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCk7XG5cdFx0Y29uc3QgaW5nZXN0SHR0cFVybCA9IG8uaW5nZXN0SHR0cFVybCA/PyBwcm9jZXNzLmVudi5GT1JXQVJERVJfSU5HRVNUX1VSTD8udHJpbSgpID8/ICcnO1xuXHRcdGNvbnN0IHNlcnZpY2UgPSBvLnNlcnZpY2UgPz8gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9TRVJWSUNFPy50cmltKCkgfHwgdGhpcy5mdzI0LmFwcE5hbWUgfHwgJycpO1xuXHRcdGNvbnN0IGVudiA9IG8uZW52ID8/IChwcm9jZXNzLmVudi5GT1JXQVJERVJfRU5WPy50cmltKCkgfHwgY2ZnLmVudmlyb25tZW50IHx8ICcnKTtcblx0XHRjb25zdCB4QXBpS2V5ID0gby54QXBpS2V5ID8/IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZPy50cmltKCk7XG5cblx0XHRpZiAoIWluZ2VzdEh0dHBVcmwpIHtcblx0XHRcdC8vIE5vbi1mYXRhbDogdGhlIGZvcndhcmRlciBoYW5kbGVyIG5vLW9wcyB3aXRob3V0IGFuIGluZ2VzdCBVUkwsIHNvIGEgYmFja2VuZCBjYW4gYWRvcHQgdGhlXG5cdFx0XHQvLyBjb25zdHJ1Y3QgYmVmb3JlIHRoZSBpbmdlc3QgaXMgd2lyZWQuIFdhcm4gc28gaXQgaXNuJ3QgYSBzaWxlbnQgbm8tb3AuXG5cdFx0XHR0aGlzLmxvZ2dlci53YXJuKFxuXHRcdFx0XHQnTG9nRm9yd2FyZGVyQ29uc3RydWN0OiBubyBpbmdlc3QgVVJMIChjb25maWcuaW5nZXN0SHR0cFVybCAvIEZPUldBUkRFUl9JTkdFU1RfVVJMKS4gJ1xuXHRcdFx0XHRcdCsgJ0ZvcndhcmRlciBkZXBsb3lzIGJ1dCBzaGlwcyBub3RoaW5nIHVudGlsIG9uZSBpcyBzZXQuJyxcblx0XHRcdCk7XG5cdFx0fVxuXG5cdFx0Ly8gRnJhbWV3b3JrLW93bmVkIGhhbmRsZXIgc2hpcHBlZCBjb21waWxlZCBpbiBkaXN0IChtaXJyb3JzIG1haWxlci9keW5hbW8gaGFuZGxlcnMpLiBSZXNvbHZlIHRoZVxuXHRcdC8vIGNvbXBpbGVkIGAuanNgIHdoZW4gaW5zdGFsbGVkIChkaXN0KSwgZmFsbGluZyBiYWNrIHRvIHRoZSBgLnRzYCBzb3VyY2Ugd2hlbiBydW5uaW5nIGZyb20gZncyNCdzXG5cdFx0Ly8gb3duIHNyYyAodW5pdCB0ZXN0cyAvIHRzLW5vZGUgZGV2KSB3aGVyZSB0aGUgYC5qc2AgaGFzbid0IGJlZW4gZW1pdHRlZC5cblx0XHRjb25zdCBoYW5kbGVyQmFzZSA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9jb3JlL3J1bnRpbWUvbG9nLWZvcndhcmRlci1oYW5kbGVyJyk7XG5cdFx0Y29uc3QgaGFuZGxlckVudHJ5ID0gZXhpc3RzU3luYyhgJHtoYW5kbGVyQmFzZX0uanNgKSA/IGAke2hhbmRsZXJCYXNlfS5qc2AgOiBgJHtoYW5kbGVyQmFzZX0udHNgO1xuXG5cdFx0Y29uc3QgZm9yd2FyZGVyID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMubWFpblN0YWNrLCAnTG9nRm9yd2FyZGVyRnVuY3Rpb24nLCB7XG5cdFx0XHRlbnRyeTogaGFuZGxlckVudHJ5LFxuXHRcdFx0aGFuZGxlcjogJ2hhbmRsZXInLFxuXHRcdFx0cnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcblx0XHRcdG1lbW9yeVNpemU6IG8ubWVtb3J5U2l6ZSA/PyAyNTYsXG5cdFx0XHR0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKG8udGltZW91dFNlY29uZHMgPz8gMzApLFxuXHRcdFx0Li4uKG8ucmVzZXJ2ZWRDb25jdXJyZW5jeSAhPSBudWxsID8geyByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiBvLnJlc2VydmVkQ29uY3VycmVuY3kgfSA6IHt9KSxcblx0XHRcdGxvZ0dyb3VwOiBmb3J3YXJkZXJMb2dHcm91cCxcblx0XHRcdGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWyAnQGF3cy1zZGsnIF0sIG1pbmlmeTogdHJ1ZSB9LFxuXHRcdFx0Ly8gRm9yd2FyZGVyIHJ1bnRpbWUgZW52IGlzIGZ1bGx5IEZPUldBUkRFUl8qLW5hbWVzcGFjZWQg4oCUIG5vIExPR1RSQUlMXyoga2V5cywgc28gaXQgY2FuIG5ldmVyXG5cdFx0XHQvLyBjb2xsaWRlIHdpdGggZncyNCdzIGluLXByb2Nlc3MgdHJhbnNwb3J0LlxuXHRcdFx0ZW52aXJvbm1lbnQ6IHtcblx0XHRcdFx0Rk9SV0FSREVSX0lOR0VTVF9VUkw6IGluZ2VzdEh0dHBVcmwsXG5cdFx0XHRcdEZPUldBUkRFUl9TRVJWSUNFOiBzZXJ2aWNlLFxuXHRcdFx0XHRGT1JXQVJERVJfRU5WOiBlbnYsXG5cdFx0XHRcdC4uLih4QXBpS2V5ID8geyBGT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWTogeEFwaUtleSB9IDoge30pLFxuXHRcdFx0XHQuLi4oby5iYXRjaEZvcm1hdCA/IHsgRk9SV0FSREVSX0JBVENIX0ZPUk1BVDogby5iYXRjaEZvcm1hdCB9IDoge30pLFxuXHRcdFx0XHQuLi4oby5tYXhCYXRjaEJ5dGVzICE9IG51bGwgPyB7IEZPUldBUkRFUl9NQVhfQkFUQ0hfQllURVM6IFN0cmluZyhvLm1heEJhdGNoQnl0ZXMpIH0gOiB7fSksXG5cdFx0XHRcdC4uLnRoaXMucmVzb2x2ZU5vaXNlRW52KCksXG5cdFx0XHR9LFxuXHRcdH0pO1xuXG5cdFx0Ly8gT25lIGJyb2FkIGludm9rZSBwZXJtaXNzaW9uIGluc3RlYWQgb2Ygb25lIHBlciBsb2cgZ3JvdXA6IGtlZXBzIHRoZSBmb3J3YXJkZXIncyByZXNvdXJjZVxuXHRcdC8vIHBvbGljeSBzbWFsbCAoTGFtYmRhIGNhcHMgaXQgYXQgfjIwS0IpIGFzIHRoZSBudW1iZXIgb2Ygc3Vic2NyaWJlZCBmdW5jdGlvbnMgZ3Jvd3MuXG5cdFx0Zm9yd2FyZGVyLmFkZFBlcm1pc3Npb24oJ0FsbG93Q2xvdWRXYXRjaExvZ3NJbnZva2UnLCB7XG5cdFx0XHRwcmluY2lwYWw6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKCdsb2dzLmFtYXpvbmF3cy5jb20nKSxcblx0XHRcdGFjdGlvbjogJ2xhbWJkYTpJbnZva2VGdW5jdGlvbicsXG5cdFx0XHRzb3VyY2VBY2NvdW50OiB0aGlzLm1haW5TdGFjay5hY2NvdW50LFxuXHRcdFx0c291cmNlQXJuOiBgYXJuOmF3czpsb2dzOiR7dGhpcy5tYWluU3RhY2sucmVnaW9ufToke3RoaXMubWFpblN0YWNrLmFjY291bnR9OmxvZy1ncm91cDoqYCxcblx0XHR9KTtcblxuXHRcdGNvbnN0IHNraXAgPSBbIC4uLkRFRkFVTFRfU0tJUF9TVUJTVFJJTkdTLCAuLi4oby5leGNsdWRlRnVuY3Rpb25QYXRoU3Vic3RyaW5ncyA/PyBbXSkgXTtcblx0XHQvLyAnYXBwJyDihpIgc3Vic2NyaWJlIGV2ZXJ5IExhbWJkYSBpbiB0aGUgd2hvbGUgQ0RLIGFwcCAoaW5kZXBlbmRlbnQgdG9wLWxldmVsIHN0YWNrcyB0b28pO1xuXHRcdC8vICdzdGFjaycgKGRlZmF1bHQpIOKGkiB0aGlzIHN0YWNrICsgbmVzdGVkIHN0YWNrcyB1bmRlciBpdC5cblx0XHRjb25zdCBzY29wZVJvb3Q6IElDb25zdHJ1Y3QgPVxuXHRcdFx0by5zdWJzY3JpYmVTY29wZSA9PT0gJ2FwcCcgPyB0aGlzLm1haW5TdGFjay5ub2RlLnJvb3QgOiB0aGlzLm1haW5TdGFjaztcblx0XHRBc3BlY3RzLm9mKHNjb3BlUm9vdCkuYWRkKFxuXHRcdFx0bmV3IExvZ1NoaXBwaW5nQXNwZWN0KGZvcndhcmRlciwgby5maWx0ZXJQYXR0ZXJuID8/IEZpbHRlclBhdHRlcm4uYWxsRXZlbnRzKCksIHNraXApLFxuXHRcdCk7XG5cblx0XHR0aGlzLm91dHB1dCA9IHt9IGFzIEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cdH1cbn1cbiJdfQ==