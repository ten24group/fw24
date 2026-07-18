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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2xvZy1mb3J3YXJkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQWtDO0FBQ2xDLHFDQUFxQztBQUNyQyw2Q0FBb0Y7QUFDcEYsdURBQTRGO0FBQzVGLHFFQUErRDtBQUMvRCxtREFBdUg7QUFDdkgsNkVBQXNFO0FBRXRFLHVDQUFvQztBQUdwQyx3Q0FBMEM7QUF5RTFDOzs7O0dBSUc7QUFDVSxRQUFBLHVCQUF1QixHQUEwRDtJQUM3RiwyREFBMkQ7SUFDM0QsTUFBTSxFQUFFO1FBQ1Asa0JBQWtCO1FBQ2xCLGFBQWE7UUFDYixhQUFhO1FBQ2Isd0NBQXdDO1FBQ3hDLDBCQUEwQjtRQUMxQixrQkFBa0I7UUFDbEIsaUJBQWlCO0tBQ2pCO0lBQ0QsZ0NBQWdDO0lBQ2hDLElBQUksRUFBRTtRQUNMLDhDQUE4QztRQUM5QyxrQkFBa0I7UUFDbEIsbUJBQW1CO0tBQ25CO0lBQ0QsaURBQWlEO0lBQ2pELFNBQVMsRUFBRTtRQUNWLHNCQUFzQjtRQUN0QixnQkFBZ0I7S0FDaEI7Q0FDRCxDQUFDO0FBRUYsOEZBQThGO0FBQzlGLHFGQUFxRjtBQUNyRixNQUFNLHVCQUF1QixHQUFHO0lBQy9CLGNBQWM7SUFDZCxVQUFVO0lBQ1YsbUJBQW1CO0lBQ25CLFdBQVc7SUFDWCw0QkFBNEI7SUFDNUIsVUFBVTtJQUNWLGNBQWM7Q0FDZCxDQUFDO0FBRUYsTUFBTSxpQkFBaUI7SUFFSjtJQUNBO0lBQ0E7SUFDQTtJQUpsQixZQUNrQixTQUF5QixFQUN6QixnQkFBNEIsRUFDNUIsYUFBNkIsRUFDN0IsY0FBd0I7UUFIeEIsY0FBUyxHQUFULFNBQVMsQ0FBZ0I7UUFDekIscUJBQWdCLEdBQWhCLGdCQUFnQixDQUFZO1FBQzVCLGtCQUFhLEdBQWIsYUFBYSxDQUFnQjtRQUM3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QWtHO1FBQ2xHLDZGQUE2RjtRQUM3RiwrRkFBK0Y7UUFDL0Ysd0ZBQXdGO1FBQ3hGLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSwwQkFBYSxDQUFDLFNBQVMsRUFBRSwyQkFBMkIsRUFBRTtZQUNsRixTQUFTLEVBQUUsb0JBQW9CO1lBQy9CLE1BQU0sRUFBRSx1QkFBdUI7WUFDL0IsWUFBWSxFQUFFLFNBQVMsQ0FBQyxZQUFZO1lBQ3BDLGFBQWEsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU87WUFDckMsU0FBUyxFQUFFLGdCQUFnQixJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sY0FBYztTQUN4RixDQUFDLENBQUM7UUFFSCxNQUFNLElBQUksR0FBRyxDQUFFLEdBQUcsdUJBQXVCLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsSUFBSSxFQUFFLENBQUMsQ0FBRSxDQUFDO1FBQ3hGLDBGQUEwRjtRQUMxRiwyREFBMkQ7UUFDM0QsTUFBTSxTQUFTLEdBQ2QsQ0FBQyxDQUFDLGNBQWMsS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztRQUN4RSxxQkFBTyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxHQUFHLENBQ3hCLElBQUksaUJBQWlCLENBQUMsU0FBUyxFQUFFLGdCQUFnQixFQUFFLENBQUMsQ0FBQyxhQUFhLElBQUksd0JBQWEsQ0FBQyxTQUFTLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FDdEcsQ0FBQztRQUVGLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBeUIsQ0FBQztJQUN6QyxDQUFDO0NBQ0Q7QUExR0Qsc0RBMEdDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgQXNwZWN0cywgRHVyYXRpb24sIFJlbW92YWxQb2xpY3ksIFN0YWNrLCB0eXBlIElBc3BlY3QgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDZm5QZXJtaXNzaW9uLCBGdW5jdGlvbiBhcyBMYW1iZGFGdW5jdGlvbiwgUnVudGltZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgeyBGaWx0ZXJQYXR0ZXJuLCB0eXBlIElGaWx0ZXJQYXR0ZXJuLCBMb2dHcm91cCwgUmV0ZW50aW9uRGF5cywgU3Vic2NyaXB0aW9uRmlsdGVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgTGFtYmRhRGVzdGluYXRpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncy1kZXN0aW5hdGlvbnMnO1xuaW1wb3J0IHR5cGUgeyBJQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSAnLi4vY29yZS9mdzI0JztcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdCc7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSAnLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuXG4vKipcbiAqIEFwcC1vd25lZCBub2lzZSAvIHNldmVyaXR5IHJ1bGVzLCBhcHBsaWVkIHBlciBsb2cgbGluZSBpbnNpZGUgdGhlIGZvcndhcmRlciBMYW1iZGEgKGxheWVycyAy4oCTNCBvZiB0aGVcbiAqIHBpcGVsaW5lOyBzZWUgYExvZ0ZvcndhcmRlckNvbnN0cnVjdGApLiBFYWNoIGxpc3QgaXMgYW4gYXJyYXkgb2YgcmVnZXggc291cmNlIHN0cmluZ3MsIG1hdGNoZWRcbiAqIGNhc2UtaW5zZW5zaXRpdmVseSBhZ2FpbnN0IHRoZSBub3JtYWxpemVkIG1lc3NhZ2UuIFRoZXNlIGFyZSBjb21wbGVtZW50YXJ5IHRvIGFueSBnbG9iYWwgc2V2ZXJpdHkvXG4gKiBub2lzZSBoYW5kbGluZyBhIHNoYXJlZCBWZWN0b3IgaW5nZXN0IG1heSBhbHNvIHJ1biDigJQgdGhpcyBsYXllciBsZXRzIGVhY2ggYXBwIG93biBpdHMgb3duIHJ1bGVzIGFuZCxcbiAqIGZvciBgZHJvcGAsIHNhdmVzIGluZ2VzdCBiYW5kd2lkdGggYnkgcmVtb3Zpbmcgbm9pc2UgYXQgdGhlIHNvdXJjZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzIHtcblx0LyoqIEVycm9yLWlzaCBsaW5lcyBtYXRjaGluZyB0aGVzZSBhcmUgZG93bmdyYWRlZCB0byBgd2FybmAgKHRhZ2dlZCBgcmVjbGFzc2lmaWVkOiBcImJlbmlnblwiYCkuICovXG5cdGJlbmlnbj86IHN0cmluZ1tdO1xuXHQvKiogTGluZXMgbWF0Y2hpbmcgdGhlc2UgYXJlIGRyb3BwZWQgZW50aXJlbHkg4oCUIG5ldmVyIHNoaXBwZWQuICovXG5cdGRyb3A/OiBzdHJpbmdbXTtcblx0LyoqIExpbmVzIG1hdGNoaW5nIHRoZXNlIGFyZSBkb3duZ3JhZGVkIHRvIGBkZWJ1Z2AgKHRhZ2dlZCBgcmVjbGFzc2lmaWVkOiBcIm5vaXNlXCJgKS4gKi9cblx0ZG93bmdyYWRlPzogc3RyaW5nW107XG5cdC8qKlxuXHQgKiBXaGVuIHRydWUgKGRlZmF1bHQpLCB0aGUgYnVpbHQtaW4ge0BsaW5rIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTfSBhcmUgbWVyZ2VkIHdpdGggdGhlIGxpc3RzIGFib3ZlLlxuXHQgKiBTZXQgZmFsc2UgdG8gdXNlIE9OTFkgdGhlIGxpc3RzIHlvdSBwcm92aWRlIChvciBub25lKS5cblx0ICovXG5cdHVzZURlZmF1bHRzPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBMb2dGb3J3YXJkZXJDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcblx0LyoqIFZlY3Rvci9Mb2d0cmFpbCBIVFRQIEpTT04gaW5nZXN0IFVSTC4gRGVmYXVsdHMgdG8gYEZPUldBUkRFUl9JTkdFU1RfVVJMYCBhdCBkZXBsb3kgdGltZS4gKi9cblx0aW5nZXN0SHR0cFVybD86IHN0cmluZztcblx0LyoqXG5cdCAqIEJhc2UgYHNlcnZpY2VgIGxhYmVsIGZvciBzaGlwcGVkIGxvZ3MgKGVudiBpcyBmb2xkZWQgaW4pLiBVc3VhbGx5IG9taXQg4oCUIGRlZmF1bHRzIHRvIHRoZSBmdzI0XG5cdCAqIGFwcCBuYW1lIChgQVBQX05BTUVgKTsgb3ZlcnJpZGUgd2l0aCB0aGlzIG9wdGlvbiBvciBgRk9SV0FSREVSX1NFUlZJQ0VgLlxuXHQgKi9cblx0c2VydmljZT86IHN0cmluZztcblx0LyoqXG5cdCAqIFN0YWdlL293bmVyIGxhYmVsIChlLmcuIGBkZXZlbG9wYCwgYHByb2RgLCBgc2FuZGJveC1uaXRpbmApIOKAlCBmb2xkZWQgaW50byB0aGUgYHNlcnZpY2VgIGxhYmVsXG5cdCAqIChgbXlzZXJ2aWNlLWRldmVsb3BgKSBhbmQgZW1pdHRlZCBhcyBgZW52YCBzbyBkZXZlbG9wL3Byb2QvcGVyLWRldmVsb3BlciBsb2dzIGFyZSBkaXN0aW5ndWlzaGFibGVcblx0ICogaW4gTG9ndHJhaWwuIFVzdWFsbHkgb21pdCDigJQgZGVmYXVsdHMgdG8gdGhlIGZ3MjQgZW52aXJvbm1lbnQgKGBBUFBfRU5WSVJPTk1FTlRgKTsgb3ZlcnJpZGUgd2l0aFxuXHQgKiB0aGlzIG9wdGlvbiBvciBgRk9SV0FSREVSX0VOVmAuXG5cdCAqL1xuXHRlbnY/OiBzdHJpbmc7XG5cdC8qKiBPcHRpb25hbCBgeC1hcGkta2V5YCB3aGVuIHRoZSBpbmdlc3QgZnJvbnQgcmVxdWlyZXMgaXQuIERlZmF1bHRzIHRvIGBGT1JXQVJERVJfSU5HRVNUX1hfQVBJX0tFWWAuICovXG5cdHhBcGlLZXk/OiBzdHJpbmc7XG5cdC8qKiBCYXRjaCB3aXJlIGZvcm1hdCDigJQgbXVzdCBtYXRjaCB5b3VyIFZlY3RvciBodHRwIHNvdXJjZSBkZWNvZGluZy4gRGVmYXVsdDogYGpzb24tYXJyYXlgLiAqL1xuXHRiYXRjaEZvcm1hdD86ICduZGpzb24nIHwgJ2pzb24tYXJyYXknO1xuXHQvKiogTWF4IHVuY29tcHJlc3NlZCBieXRlcyBwZXIgUE9TVCAodGhlIGZvcndhcmRlciBzcGxpdHMgbGFyZ2VyIGJhdGNoZXMpLiBEZWZhdWx0OiAxLDAwMCwwMDAuICovXG5cdG1heEJhdGNoQnl0ZXM/OiBudW1iZXI7XG5cdC8qKiBDbG91ZFdhdGNoIHN1YnNjcmlwdGlvbi1maWx0ZXIgcGF0dGVybiDigJQgdGhlIHZvbHVtZS9jb3N0IGxldmVyIChlLmcuIG9ubHkgV0FSTi9FUlJPUikuIERlZmF1bHQ6IGFsbCBldmVudHMuICovXG5cdGZpbHRlclBhdHRlcm4/OiBJRmlsdGVyUGF0dGVybjtcblx0LyoqIEV4dHJhIGZ1bmN0aW9uIGNvbnN0cnVjdC1wYXRoIHN1YnN0cmluZ3MgdG8gc2tpcCAobmV2ZXIgc3Vic2NyaWJlKS4gKi9cblx0ZXhjbHVkZUZ1bmN0aW9uUGF0aFN1YnN0cmluZ3M/OiBzdHJpbmdbXTtcblx0LyoqIEFwcC1vd25lZCBub2lzZS9zZXZlcml0eSBydWxlcyBhcHBsaWVkIGluc2lkZSB0aGUgZm9yd2FyZGVyIChsYXllcnMgMuKAkzQpLiAqL1xuXHRub2lzZT86IExvZ0ZvcndhcmRlck5vaXNlUnVsZXM7XG5cdC8qKlxuXHQgKiBXaGljaCBjb25zdHJ1Y3QgdHJlZSB0byBzdWJzY3JpYmUuXG5cdCAqIC0gYCdzdGFjaydgIChkZWZhdWx0KTogdGhlIGZvcndhcmRlcidzIHN0YWNrIGFuZCBhbnkgbmVzdGVkIHN0YWNrcyB1bmRlciBpdCAoY292ZXJzIHRoZSBjb21tb25cblx0ICogICBzYXRlbGxpdGUgYXBwLCBpbmNsdWRpbmcgcGVyLWNvbnRyb2xsZXIgbmVzdGVkIHN0YWNrcyBwYXJlbnRlZCB0byB0aGUgZGVmYXVsdCBzdGFjaykuXG5cdCAqIC0gYCdhcHAnYDogdGhlIHdob2xlIENESyBhcHAg4oCUIHVzZSB3aGVuIGEgYmFja2VuZCBoYXMgaW5kZXBlbmRlbnQgdG9wLWxldmVsIHN0YWNrcyAoZS5nLiBhIHNlcGFyYXRlXG5cdCAqICAgYHBlcnNpc3RlbnRgL2RhdGEgc3RhY2spLiBOb3RlIHRoaXMgY3JlYXRlcyBjcm9zcy1zdGFjayBzdWJzY3JpcHRpb27ihpJmb3J3YXJkZXIgcmVmZXJlbmNlcywgc29cblx0ICogICB2ZXJpZnkgc3ludGggZG9lc24ndCBpbnRyb2R1Y2UgYSBjeWNsaWMgc3RhY2sgZGVwZW5kZW5jeS5cblx0ICovXG5cdHN1YnNjcmliZVNjb3BlPzogJ3N0YWNrJyB8ICdhcHAnO1xuXHQvKiogRm9yd2FyZGVyIGZ1bmN0aW9uIG1lbW9yeSAoTUIpLiBEZWZhdWx0IDI1Ni4gKi9cblx0bWVtb3J5U2l6ZT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlciBmdW5jdGlvbiB0aW1lb3V0IChzZWNvbmRzKS4gRGVmYXVsdCAzMC4gKi9cblx0dGltZW91dFNlY29uZHM/OiBudW1iZXI7XG5cdC8qKlxuXHQgKiBDYXAgZm9yd2FyZGVyIGNvbmN1cnJlbmN5IHRvIHByb3RlY3QgdGhlIGluZ2VzdCBmcm9tIGEgbG9nIHN0b3JtLiBPcHQtaW46IHJlc2VydmluZyBjb25jdXJyZW5jeVxuXHQgKiBzdWJ0cmFjdHMgZnJvbSB0aGUgYWNjb3VudCdzIHNoYXJlZCBwb29sLCBzbyBhIGJhZCB2YWx1ZSBjYW4gZmFpbCBkZXBsb3lzIGluIGNvbnN0cmFpbmVkIGFjY291bnRzLlxuXHQgKiBSZWNvbW1lbmRlZCBpbiBwcm9kIChlLmcuIDEw4oCTMjApLlxuXHQgKi9cblx0cmVzZXJ2ZWRDb25jdXJyZW5jeT86IG51bWJlcjtcblx0LyoqIEZvcndhcmRlcidzIG93biBsb2cgcmV0ZW50aW9uLiBEZWZhdWx0OiBvbmUgd2Vlay4gKi9cblx0bG9nUmV0ZW50aW9uPzogUmV0ZW50aW9uRGF5cztcbn1cblxuLyoqXG4gKiBDdXJhdGVkLCBnZW5lcmFsbHktc2FmZSBkZWZhdWx0IG5vaXNlL3NldmVyaXR5IHJ1bGVzIOKAlCBtaXJyb3JzIHRoZSBMb2d0cmFpbCBWZWN0b3IgXCJBMVwiIGxpc3Qgc28gYVxuICogYmFja2VuZCBnZXRzIHNlbnNpYmxlIGxvZyBoeWdpZW5lIG91dCBvZiB0aGUgYm94LiBNZXJnZS1pbiBieSBkZWZhdWx0OyBvdmVycmlkZSB2aWFcbiAqIHtAbGluayBMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLnVzZURlZmF1bHRzfS4gRXhwb3J0ZWQgc28gYXBwcyBjYW4gaW5zcGVjdCAvIGV4dGVuZCB0aGUgbGlzdHMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0xPR19OT0lTRV9SVUxFUzogUmVxdWlyZWQ8T21pdDxMb2dGb3J3YXJkZXJOb2lzZVJ1bGVzLCAndXNlRGVmYXVsdHMnPj4gPSB7XG5cdC8vIEJlbmlnbiBcImVycm9yc1wiIOKGkiB3YXJuLCBzbyBlcnJvciBjb3VudHMgc3RheSBtZWFuaW5nZnVsLlxuXHRiZW5pZ246IFtcblx0XHQnXFxcXGJFQ09OTlJFU0VUXFxcXGInLFxuXHRcdCdcXFxcYkVQSVBFXFxcXGInLFxuXHRcdCdicm9rZW4gcGlwZScsXG5cdFx0J2NsaWVudCAoPzpjbG9zZWQgcmVxdWVzdHxkaXNjb25uZWN0ZWQpJyxcblx0XHQnY29ubmVjdGlvbiByZXNldCBieSBwZWVyJyxcblx0XHQnY29udGV4dCBjYW5jZWxlZCcsXG5cdFx0J3JlcXVlc3QgYWJvcnRlZCcsXG5cdF0sXG5cdC8vIEhlYWx0aC9wcm9iZSBub2lzZSDihpIgZHJvcHBlZC5cblx0ZHJvcDogW1xuXHRcdCdHRVQgLyg/OmhlYWx0aHxoZWFsdGh6fHJlYWR5enxsaXZlenxwaW5nKVxcXFxiJyxcblx0XHQnXFxcXGJrdWJlLXByb2JlXFxcXGInLFxuXHRcdCdFTEItSGVhbHRoQ2hlY2tlcicsXG5cdF0sXG5cdC8vIExvdy12YWx1ZSBub2lzZSDihpIgZGVidWcgKGtlcHQsIGRlLWVtcGhhc2lzZWQpLlxuXHRkb3duZ3JhZGU6IFtcblx0XHQnZGVwcmVjYXRpb24uP3dhcm5pbmcnLFxuXHRcdCcvZmF2aWNvblxcXFwuaWNvJyxcblx0XSxcbn07XG5cbi8vIENESy1pbnRlcm5hbCAvIGN1c3RvbS1yZXNvdXJjZSBsYW1iZGFzIHdlIG5ldmVyIHN1YnNjcmliZSAobm9pc2UgKyBjcm9zcy1zdGFjayBzaW5nbGV0b25zKSxcbi8vIHBsdXMgdGhlIGZvcndhcmRlciBpdHNlbGYgKGJlbHQtYW5kLXN1c3BlbmRlcnM7IGl0IGlzIGFsc28gZXhjbHVkZWQgYnkgcmVmZXJlbmNlKS5cbmNvbnN0IERFRkFVTFRfU0tJUF9TVUJTVFJJTkdTID0gW1xuXHQnTG9nUmV0ZW50aW9uJyxcblx0J0N1c3RvbTo6Jyxcblx0J2ZyYW1ld29yay1vbkV2ZW50Jyxcblx0J0FXU0NES0NmbicsXG5cdCdCdWNrZXROb3RpZmljYXRpb25zSGFuZGxlcicsXG5cdCdQcm92aWRlcicsXG5cdCdMb2dGb3J3YXJkZXInLFxuXTtcblxuY2xhc3MgTG9nU2hpcHBpbmdBc3BlY3QgaW1wbGVtZW50cyBJQXNwZWN0IHtcblx0Y29uc3RydWN0b3IoXG5cdFx0cHJpdmF0ZSByZWFkb25seSBmb3J3YXJkZXI6IExhbWJkYUZ1bmN0aW9uLFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgaW52b2tlUGVybWlzc2lvbjogSUNvbnN0cnVjdCxcblx0XHRwcml2YXRlIHJlYWRvbmx5IGZpbHRlclBhdHRlcm46IElGaWx0ZXJQYXR0ZXJuLFxuXHRcdHByaXZhdGUgcmVhZG9ubHkgc2tpcFN1YnN0cmluZ3M6IHN0cmluZ1tdLFxuXHQpIHt9XG5cblx0dmlzaXQobm9kZTogSUNvbnN0cnVjdCk6IHZvaWQge1xuXHRcdGlmICghKG5vZGUgaW5zdGFuY2VvZiBMYW1iZGFGdW5jdGlvbikpIHtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0aWYgKG5vZGUgPT09IHRoaXMuZm9yd2FyZGVyKSB7XG5cdFx0XHRyZXR1cm47IC8vIG5ldmVyIHN1YnNjcmliZSB0aGUgZm9yd2FyZGVyIHRvIGl0c2VsZiDigJQgaW5maW5pdGUgbG9vcFxuXHRcdH1cblx0XHRjb25zdCBub2RlUGF0aCA9IG5vZGUubm9kZS5wYXRoO1xuXHRcdGlmICh0aGlzLnNraXBTdWJzdHJpbmdzLnNvbWUoKHMpID0+IG5vZGVQYXRoLmluY2x1ZGVzKHMpKSkge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZiAobm9kZS5ub2RlLnRyeUZpbmRDaGlsZCgnTG9nU2hpcFN1YnNjcmlwdGlvbicpKSB7XG5cdFx0XHRyZXR1cm47IC8vIGFzcGVjdHMgY2FuIHZpc2l0IGEgbm9kZSBtb3JlIHRoYW4gb25jZTsgYWRkIHRoZSBmaWx0ZXIgb25seSBvbmNlXG5cdFx0fVxuXHRcdHRyeSB7XG5cdFx0XHRjb25zdCBmaWx0ZXIgPSBuZXcgU3Vic2NyaXB0aW9uRmlsdGVyKG5vZGUsICdMb2dTaGlwU3Vic2NyaXB0aW9uJywge1xuXHRcdFx0XHRsb2dHcm91cDogbm9kZS5sb2dHcm91cCxcblx0XHRcdFx0Ly8gYWRkUGVybWlzc2lvbnM6ZmFsc2Ug4oCUIGEgc2luZ2xlIHdpbGRjYXJkIGludm9rZSBwZXJtaXNzaW9uIGlzIGFkZGVkIG9uIHRoZSBmb3J3YXJkZXIgaW5cblx0XHRcdFx0Ly8gY29uc3RydWN0KCksIHNvIHdlIGRvbid0IGFjY3VtdWxhdGUgb25lIENmblBlcm1pc3Npb24gcGVyIGxvZyBncm91cC5cblx0XHRcdFx0ZGVzdGluYXRpb246IG5ldyBMYW1iZGFEZXN0aW5hdGlvbih0aGlzLmZvcndhcmRlciwgeyBhZGRQZXJtaXNzaW9uczogZmFsc2UgfSksXG5cdFx0XHRcdGZpbHRlclBhdHRlcm46IHRoaXMuZmlsdGVyUGF0dGVybixcblx0XHRcdH0pO1xuXHRcdFx0Ly8gQ1JJVElDQUw6IHdpdGggYWRkUGVybWlzc2lvbnM6ZmFsc2UgdGhlcmUgaXMgbm8gYXV0b21hdGljIGRlcGVuZGVuY3kgYmV0d2VlbiB0aGUgZmlsdGVyIGFuZFxuXHRcdFx0Ly8gdGhlIChzaW5nbGUsIHdpbGRjYXJkKSBpbnZva2UgcGVybWlzc2lvbi4gT24gYSBGUkVTSCBkZXBsb3kgQ2xvdWRGb3JtYXRpb24gd291bGQgb3RoZXJ3aXNlXG5cdFx0XHQvLyByYWNlIGFuZCBjcmVhdGUgdGhlIGZpbHRlciBiZWZvcmUgdGhlIHBlcm1pc3Npb24sIHNvIENsb3VkV2F0Y2ggTG9ncyBjYW4ndCBpbnZva2UgdGhlXG5cdFx0XHQvLyBmb3J3YXJkZXIg4oaSIFwiQ291bGQgbm90IGV4ZWN1dGUgdGhlIGxhbWJkYSBmdW5jdGlvblwiIDQwMC4gRm9yY2UgdGhlIG9yZGVyaW5nIGV4cGxpY2l0bHkuXG5cdFx0XHRmaWx0ZXIubm9kZS5hZGREZXBlbmRlbmN5KHRoaXMuaW52b2tlUGVybWlzc2lvbik7XG5cdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHQvLyBBIGxhbWJkYSB3aXRob3V0IGFuIGFkZHJlc3NhYmxlIGxvZyBncm91cCAocmFyZSBDREsgaW50ZXJuYWxzKSBtdXN0IG5ldmVyIGJyZWFrIHN5bnRoLlxuXHRcdFx0Ly8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcblx0XHRcdGNvbnNvbGUud2FybihgW0xvZ0ZvcndhcmRlcl0gc2tpcHBlZCAke25vZGVQYXRofTogJHsoZXJyIGFzIEVycm9yKS5tZXNzYWdlfWApO1xuXHRcdH1cblx0fVxufVxuXG4vKipcbiAqIE91dC1vZi1iYW5kIGxvZyBzaGlwcGluZyBmb3IgZXZlcnkgTGFtYmRhIGluIHRoZSBhcHAuXG4gKlxuICogQXR0YWNoZXMgYSBDbG91ZFdhdGNoIExvZ3Mgc3Vic2NyaXB0aW9uIGZpbHRlciB0byBlYWNoIGZ1bmN0aW9uJ3MgbG9nIGdyb3VwICh2aWEgYW4gQXNwZWN0KSwgcm91dGluZ1xuICogYmF0Y2hlZCwgZ3ppcHBlZCBldmVudHMgdG8gYSBzaW5nbGUgdGlueSBmb3J3YXJkZXIgTGFtYmRhIHRoYXQgc2hpcHMgdGhlbSB0byBhIFZlY3Rvci9Mb2d0cmFpbCBIVFRQXG4gKiBpbmdlc3QuIE5vdGhpbmcgcnVucyBpbiB0aGUgYXBwIHJlcXVlc3QgcGF0aCAoZnVuY3Rpb25zIG9ubHkgd3JpdGUgc3Rkb3V0KSwgc28gbG9nIHZvbHVtZSBuZXZlclxuICogZGVncmFkZXMgcmVxdWVzdCBsYXRlbmN5IGFuZCB0aGVyZSBhcmUgbm8gcGVyLWxvZyBIVFRQIGNhbGxzIGZyb20gdGhlIGhhbmRsZXJzLlxuICpcbiAqIEluc2lkZSB0aGUgZm9yd2FyZGVyLCBlYWNoIGxpbmUgcnVucyB0aHJvdWdoIGEgNC1zdGVwIHBpcGVsaW5lOiBOT1JNQUxJWkUgKHBlZWwgTGFtYmRhIHByZWZpeCwgbGlmdFxuICogZncyNCB0c2xvZyBKU09OLCBzdHJpcCBBTlNJKSDihpIgUkVDTEFTU0lGWSBiZW5pZ24gZXJyb3JzIOKGkiBEUk9QIG5vaXNlIOKGkiBET1dOR1JBREUgbm9pc2UuIFN0ZXBzIDLigJM0IGFyZVxuICogYXBwLW93bmVkIHJ1bGUgbGlzdHMgKHNlZSB7QGxpbmsgTG9nRm9yd2FyZGVyTm9pc2VSdWxlc30gLyB7QGxpbmsgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVN9KS5cbiAqXG4gKiBEZXBsb3ktdGltZSBjb25maWcgaXMgcmVhZCBmcm9tIGBGT1JXQVJERVJfKmAgZW52IHdoZW4gbm90IHBhc3NlZCBleHBsaWNpdGx5LiBgRk9SV0FSREVSXypgIGlzIHVzZWRcbiAqIChuZXZlciBgTE9HVFJBSUxfKmApIG9uIHB1cnBvc2U6IHNldHRpbmcgYExPR1RSQUlMXypgIGluIHRoZSBkZXBsb3kgc2hlbGwgd291bGQgYWN0aXZhdGUgZncyNCdzXG4gKiBpbi1wcm9jZXNzIGxvZyB0cmFuc3BvcnQgYW5kIGxlYWsgbG9jYWwgQ0RLL3N5bnRoIGxvZ3MgdG8gdGhlIGluZ2VzdC5cbiAqL1xuZXhwb3J0IGNsYXNzIExvZ0ZvcndhcmRlckNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuXHRyZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXHRyZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoTG9nRm9yd2FyZGVyQ29uc3RydWN0Lm5hbWUpO1xuXHRuYW1lID0gTG9nRm9yd2FyZGVyQ29uc3RydWN0Lm5hbWU7XG5cdGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcblx0b3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblx0bWFpblN0YWNrITogU3RhY2s7XG5cblx0Y29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBjb25maWc6IExvZ0ZvcndhcmRlckNvbnN0cnVjdENvbmZpZyA9IHt9KSB7fVxuXG5cdHByaXZhdGUgcmVzb2x2ZU5vaXNlRW52KCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuXHRcdGNvbnN0IHJ1bGVzID0gdGhpcy5jb25maWcubm9pc2UgPz8ge307XG5cdFx0Y29uc3QgdXNlRGVmYXVsdHMgPSBydWxlcy51c2VEZWZhdWx0cyAhPT0gZmFsc2U7XG5cdFx0Y29uc3QgbWVyZ2UgPSAobGlzdDogc3RyaW5nW10gfCB1bmRlZmluZWQsIGRlZmF1bHRzOiBzdHJpbmdbXSk6IHN0cmluZ1tdID0+IHtcblx0XHRcdGNvbnN0IGJhc2UgPSB1c2VEZWZhdWx0cyA/IGRlZmF1bHRzIDogW107XG5cdFx0XHQvLyBEZS1kdXAgd2hpbGUgcHJlc2VydmluZyBvcmRlciAoZGVmYXVsdHMgZmlyc3QsIHRoZW4gYXBwIGFkZGl0aW9ucykuXG5cdFx0XHRyZXR1cm4gWyAuLi5uZXcgU2V0KFsgLi4uYmFzZSwgLi4uKGxpc3QgPz8gW10pIF0pIF07XG5cdFx0fTtcblx0XHRjb25zdCBiZW5pZ24gPSBtZXJnZShydWxlcy5iZW5pZ24sIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmJlbmlnbik7XG5cdFx0Y29uc3QgZHJvcCA9IG1lcmdlKHJ1bGVzLmRyb3AsIERFRkFVTFRfTE9HX05PSVNFX1JVTEVTLmRyb3ApO1xuXHRcdGNvbnN0IGRvd25ncmFkZSA9IG1lcmdlKHJ1bGVzLmRvd25ncmFkZSwgREVGQVVMVF9MT0dfTk9JU0VfUlVMRVMuZG93bmdyYWRlKTtcblx0XHRjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblx0XHRpZiAoYmVuaWduLmxlbmd0aCkgZW52LkZPUldBUkRFUl9OT0lTRV9CRU5JR04gPSBKU09OLnN0cmluZ2lmeShiZW5pZ24pO1xuXHRcdGlmIChkcm9wLmxlbmd0aCkgZW52LkZPUldBUkRFUl9OT0lTRV9EUk9QID0gSlNPTi5zdHJpbmdpZnkoZHJvcCk7XG5cdFx0aWYgKGRvd25ncmFkZS5sZW5ndGgpIGVudi5GT1JXQVJERVJfTk9JU0VfRE9XTkdSQURFID0gSlNPTi5zdHJpbmdpZnkoZG93bmdyYWRlKTtcblx0XHRyZXR1cm4gZW52O1xuXHR9XG5cblx0YXN5bmMgY29uc3RydWN0KCk6IFByb21pc2U8dm9pZD4ge1xuXHRcdC8vIERlZmF1bHQgc3RhY2sgKG5vIGhhcmRjb2RlZCBuYW1lKSDigJQgcmVzcGVjdHMgc3RhY2tOYW1lL3BhcmVudFN0YWNrTmFtZSBpZiB0aGUgYXBwIHNldHMgdGhlbS5cblx0XHR0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLmNvbmZpZy5zdGFja05hbWUsIHRoaXMuY29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cdFx0Y29uc3QgbyA9IHRoaXMuY29uZmlnO1xuXG5cdFx0Y29uc3QgZm9yd2FyZGVyTG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcy5tYWluU3RhY2ssICdMb2dGb3J3YXJkZXJGdW5jdGlvbkxvZ0dyb3VwJywge1xuXHRcdFx0cmV0ZW50aW9uOiBvLmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuXHRcdFx0cmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuXHRcdH0pO1xuXG5cdFx0Ly8gc2VydmljZS9lbnYgZGVmYXVsdCB0byB3aGF0IGZ3MjQgYWxyZWFkeSBrbm93cyAoaHlkcmF0ZWQgZnJvbSBBUFBfTkFNRSAvIEFQUF9FTlZJUk9OTUVOVCksIHNvIGFcblx0XHQvLyBiYWNrZW5kIHVzdWFsbHkgZG9lc24ndCBwYXNzIHRoZW0uIFByZWNlZGVuY2U6IGV4cGxpY2l0IG9wdGlvbiA+IEZPUldBUkRFUl8qIGVudiA+IGZ3MjQgY29uZmlnLlxuXHRcdGNvbnN0IGNmZyA9IHRoaXMuZncyNC5nZXRDb25maWcoKTtcblx0XHRjb25zdCBpbmdlc3RIdHRwVXJsID0gby5pbmdlc3RIdHRwVXJsID8/IHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfVVJMPy50cmltKCkgPz8gJyc7XG5cdFx0Y29uc3Qgc2VydmljZSA9IG8uc2VydmljZSA/PyAocHJvY2Vzcy5lbnYuRk9SV0FSREVSX1NFUlZJQ0U/LnRyaW0oKSB8fCB0aGlzLmZ3MjQuYXBwTmFtZSB8fCAnJyk7XG5cdFx0Y29uc3QgZW52ID0gby5lbnYgPz8gKHByb2Nlc3MuZW52LkZPUldBUkRFUl9FTlY/LnRyaW0oKSB8fCBjZmcuZW52aXJvbm1lbnQgfHwgJycpO1xuXHRcdGNvbnN0IHhBcGlLZXkgPSBvLnhBcGlLZXkgPz8gcHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9YX0FQSV9LRVk/LnRyaW0oKTtcblxuXHRcdGlmICghaW5nZXN0SHR0cFVybCkge1xuXHRcdFx0Ly8gTm9uLWZhdGFsOiB0aGUgZm9yd2FyZGVyIGhhbmRsZXIgbm8tb3BzIHdpdGhvdXQgYW4gaW5nZXN0IFVSTCwgc28gYSBiYWNrZW5kIGNhbiBhZG9wdCB0aGVcblx0XHRcdC8vIGNvbnN0cnVjdCBiZWZvcmUgdGhlIGluZ2VzdCBpcyB3aXJlZC4gV2FybiBzbyBpdCBpc24ndCBhIHNpbGVudCBuby1vcC5cblx0XHRcdHRoaXMubG9nZ2VyLndhcm4oXG5cdFx0XHRcdCdMb2dGb3J3YXJkZXJDb25zdHJ1Y3Q6IG5vIGluZ2VzdCBVUkwgKGNvbmZpZy5pbmdlc3RIdHRwVXJsIC8gRk9SV0FSREVSX0lOR0VTVF9VUkwpLiAnXG5cdFx0XHRcdFx0KyAnRm9yd2FyZGVyIGRlcGxveXMgYnV0IHNoaXBzIG5vdGhpbmcgdW50aWwgb25lIGlzIHNldC4nLFxuXHRcdFx0KTtcblx0XHR9XG5cblx0XHQvLyBGcmFtZXdvcmstb3duZWQgaGFuZGxlciBzaGlwcGVkIGNvbXBpbGVkIGluIGRpc3QgKG1pcnJvcnMgbWFpbGVyL2R5bmFtbyBoYW5kbGVycykuIFJlc29sdmUgdGhlXG5cdFx0Ly8gY29tcGlsZWQgYC5qc2Agd2hlbiBpbnN0YWxsZWQgKGRpc3QpLCBmYWxsaW5nIGJhY2sgdG8gdGhlIGAudHNgIHNvdXJjZSB3aGVuIHJ1bm5pbmcgZnJvbSBmdzI0J3Ncblx0XHQvLyBvd24gc3JjICh1bml0IHRlc3RzIC8gdHMtbm9kZSBkZXYpIHdoZXJlIHRoZSBgLmpzYCBoYXNuJ3QgYmVlbiBlbWl0dGVkLlxuXHRcdGNvbnN0IGhhbmRsZXJCYXNlID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2NvcmUvcnVudGltZS9sb2ctZm9yd2FyZGVyLWhhbmRsZXInKTtcblx0XHRjb25zdCBoYW5kbGVyRW50cnkgPSBleGlzdHNTeW5jKGAke2hhbmRsZXJCYXNlfS5qc2ApID8gYCR7aGFuZGxlckJhc2V9LmpzYCA6IGAke2hhbmRsZXJCYXNlfS50c2A7XG5cblx0XHRjb25zdCBmb3J3YXJkZXIgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssICdMb2dGb3J3YXJkZXJGdW5jdGlvbicsIHtcblx0XHRcdGVudHJ5OiBoYW5kbGVyRW50cnksXG5cdFx0XHRoYW5kbGVyOiAnaGFuZGxlcicsXG5cdFx0XHRydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuXHRcdFx0bWVtb3J5U2l6ZTogby5tZW1vcnlTaXplID8/IDI1Nixcblx0XHRcdHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoby50aW1lb3V0U2Vjb25kcyA/PyAzMCksXG5cdFx0XHQuLi4oby5yZXNlcnZlZENvbmN1cnJlbmN5ICE9IG51bGwgPyB7IHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IG8ucmVzZXJ2ZWRDb25jdXJyZW5jeSB9IDoge30pLFxuXHRcdFx0bG9nR3JvdXA6IGZvcndhcmRlckxvZ0dyb3VwLFxuXHRcdFx0YnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbICdAYXdzLXNkaycgXSwgbWluaWZ5OiB0cnVlIH0sXG5cdFx0XHQvLyBGb3J3YXJkZXIgcnVudGltZSBlbnYgaXMgZnVsbHkgRk9SV0FSREVSXyotbmFtZXNwYWNlZCDigJQgbm8gTE9HVFJBSUxfKiBrZXlzLCBzbyBpdCBjYW4gbmV2ZXJcblx0XHRcdC8vIGNvbGxpZGUgd2l0aCBmdzI0J3MgaW4tcHJvY2VzcyB0cmFuc3BvcnQuXG5cdFx0XHRlbnZpcm9ubWVudDoge1xuXHRcdFx0XHRGT1JXQVJERVJfSU5HRVNUX1VSTDogaW5nZXN0SHR0cFVybCxcblx0XHRcdFx0Rk9SV0FSREVSX1NFUlZJQ0U6IHNlcnZpY2UsXG5cdFx0XHRcdEZPUldBUkRFUl9FTlY6IGVudixcblx0XHRcdFx0Li4uKHhBcGlLZXkgPyB7IEZPUldBUkRFUl9JTkdFU1RfWF9BUElfS0VZOiB4QXBpS2V5IH0gOiB7fSksXG5cdFx0XHRcdC4uLihvLmJhdGNoRm9ybWF0ID8geyBGT1JXQVJERVJfQkFUQ0hfRk9STUFUOiBvLmJhdGNoRm9ybWF0IH0gOiB7fSksXG5cdFx0XHRcdC4uLihvLm1heEJhdGNoQnl0ZXMgIT0gbnVsbCA/IHsgRk9SV0FSREVSX01BWF9CQVRDSF9CWVRFUzogU3RyaW5nKG8ubWF4QmF0Y2hCeXRlcykgfSA6IHt9KSxcblx0XHRcdFx0Li4udGhpcy5yZXNvbHZlTm9pc2VFbnYoKSxcblx0XHRcdH0sXG5cdFx0fSk7XG5cblx0XHQvLyBPbmUgYnJvYWQgaW52b2tlIHBlcm1pc3Npb24gaW5zdGVhZCBvZiBvbmUgcGVyIGxvZyBncm91cDoga2VlcHMgdGhlIGZvcndhcmRlcidzIHJlc291cmNlIHBvbGljeVxuXHRcdC8vIHNtYWxsIChMYW1iZGEgY2FwcyBpdCBhdCB+MjBLQikgYXMgdGhlIG51bWJlciBvZiBzdWJzY3JpYmVkIGZ1bmN0aW9ucyBncm93cy4gQ3JlYXRlZCBhcyBhblxuXHRcdC8vIGV4cGxpY2l0IENmblBlcm1pc3Npb24gc28gZXZlcnkgc3Vic2NyaXB0aW9uIGZpbHRlciBjYW4gYGFkZERlcGVuZGVuY3lgIG9uIGl0ICh0aGUgYXNwZWN0KSDigJRcblx0XHQvLyB3aXRob3V0IHRoYXQsIGEgZnJlc2ggZGVwbG95IHJhY2VzIGFuZCBjcmVhdGVzIGZpbHRlcnMgYmVmb3JlIHRoZSBwZXJtaXNzaW9uIChhIDQwMCkuXG5cdFx0Y29uc3QgaW52b2tlUGVybWlzc2lvbiA9IG5ldyBDZm5QZXJtaXNzaW9uKGZvcndhcmRlciwgJ0FsbG93Q2xvdWRXYXRjaExvZ3NJbnZva2UnLCB7XG5cdFx0XHRwcmluY2lwYWw6ICdsb2dzLmFtYXpvbmF3cy5jb20nLFxuXHRcdFx0YWN0aW9uOiAnbGFtYmRhOkludm9rZUZ1bmN0aW9uJyxcblx0XHRcdGZ1bmN0aW9uTmFtZTogZm9yd2FyZGVyLmZ1bmN0aW9uTmFtZSxcblx0XHRcdHNvdXJjZUFjY291bnQ6IHRoaXMubWFpblN0YWNrLmFjY291bnQsXG5cdFx0XHRzb3VyY2VBcm46IGBhcm46YXdzOmxvZ3M6JHt0aGlzLm1haW5TdGFjay5yZWdpb259OiR7dGhpcy5tYWluU3RhY2suYWNjb3VudH06bG9nLWdyb3VwOipgLFxuXHRcdH0pO1xuXG5cdFx0Y29uc3Qgc2tpcCA9IFsgLi4uREVGQVVMVF9TS0lQX1NVQlNUUklOR1MsIC4uLihvLmV4Y2x1ZGVGdW5jdGlvblBhdGhTdWJzdHJpbmdzID8/IFtdKSBdO1xuXHRcdC8vICdhcHAnIOKGkiBzdWJzY3JpYmUgZXZlcnkgTGFtYmRhIGluIHRoZSB3aG9sZSBDREsgYXBwIChpbmRlcGVuZGVudCB0b3AtbGV2ZWwgc3RhY2tzIHRvbyk7XG5cdFx0Ly8gJ3N0YWNrJyAoZGVmYXVsdCkg4oaSIHRoaXMgc3RhY2sgKyBuZXN0ZWQgc3RhY2tzIHVuZGVyIGl0LlxuXHRcdGNvbnN0IHNjb3BlUm9vdDogSUNvbnN0cnVjdCA9XG5cdFx0XHRvLnN1YnNjcmliZVNjb3BlID09PSAnYXBwJyA/IHRoaXMubWFpblN0YWNrLm5vZGUucm9vdCA6IHRoaXMubWFpblN0YWNrO1xuXHRcdEFzcGVjdHMub2Yoc2NvcGVSb290KS5hZGQoXG5cdFx0XHRuZXcgTG9nU2hpcHBpbmdBc3BlY3QoZm9yd2FyZGVyLCBpbnZva2VQZXJtaXNzaW9uLCBvLmZpbHRlclBhdHRlcm4gPz8gRmlsdGVyUGF0dGVybi5hbGxFdmVudHMoKSwgc2tpcCksXG5cdFx0KTtcblxuXHRcdHRoaXMub3V0cHV0ID0ge30gYXMgRlcyNENvbnN0cnVjdE91dHB1dDtcblx0fVxufVxuIl19