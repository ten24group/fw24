"use strict";
/**
 * OpenTelemetry Backend for AWS X-Ray Integration
 *
 * IMPORTANT: This backend is designed to work with AWS Lambda's managed ADOT layer.
 *
 * ## Why ADOT/OpenTelemetry (Not X-Ray SDK)
 *
 * AWS X-Ray SDK is being deprecated (end-of-support: Feb 25, 2027):
 * https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-nodejs.html
 *
 * AWS recommends migrating to OpenTelemetry:
 * https://docs.aws.amazon.com/xray/latest/devguide/xray-instrumenting-your-app.html#xray-instrumenting-opentel
 *
 * ## AWS ADOT Lambda Layer
 *
 * AWS provides a managed Lambda layer that includes OpenTelemetry instrumentation:
 * - ARN: arn:aws:lambda:<region>:901920570463:layer:aws-otel-nodejs-<arch>-ver-1-30-2:1
 * - Automatically instruments AWS SDK, HTTP, and Lambda invocations
 * - Exports to X-Ray via OpenTelemetry Collector
 * - W3C Trace Context + X-Ray propagation
 *
 * ## Architecture
 *
 * The ADOT layer provides OpenTelemetry packages at runtime:
 * - @opentelemetry/api (for getting tracers and creating spans)
 * - @opentelemetry/sdk-trace-node (for tracer configuration)
 * - ADOT Collector running as Lambda extension
 *
 * We import these packages but mark them as external in bundling, so:
 * - Development: Can test locally with OTEL packages installed
 * - Production: Uses packages from ADOT layer (zero bundle size)
 *
 * ## Supported Event Types
 *
 * This backend handles the following events:
 * - span.* → OTEL Traces (spans with parent-child relationships)
 * - metric → OTEL Metrics (counters, gauges, histograms)
 * - log → OTEL Logs (structured log events)
 *
 * NOT handled (use DynamoDB backend for persistence):
 * - audit.* → Business records (not telemetry)
 * - decision.* → Business records (not telemetry)
 * - access.* → Business records (not telemetry)
 * - workflow.* → Long-running state (doesn't fit OTEL's ephemeral span model)
 *
 * ## Setup in CDK/SAM
 *
 * ```typescript
 * import { Tracing } from 'aws-cdk-lib/aws-lambda';
 *
 * const fn = new NodejsFunction(this, 'MyFunction', {
 *   layers: [
 *     LayerVersion.fromLayerVersionArn(this, 'AdotLayer',
 *       'arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-amd64-ver-1-30-2:1'
 *     )
 *   ],
 *   environment: {
 *     AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-handler',
 *     OBSERVABILITY_BACKENDS: 'otel', // FW24 config
 *   },
 *   tracing: Tracing.ACTIVE, // Enable X-Ray
 *   bundling: {
 *     externalModules: [
 *       '@opentelemetry/*', // Provided by Lambda layer
 *     ],
 *   },
 * });
 * ```
 *
 * References:
 * - https://aws-otel.github.io/docs/getting-started/lambda/lambda-js
 * - https://docs.aws.amazon.com/lambda/latest/dg/typescript-tracing.html
 * - https://opentelemetry.io/docs/languages/js/
 */
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var OTELObservabilityBackend_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTELObservabilityBackend = void 0;
exports.resetColdStartFlag = resetColdStartFlag;
const di_1 = require("../../di");
const logging_1 = require("../../logging");
const span_utils_1 = require("../utils/span-utils");
const logger = (0, logging_1.createLogger)('OTELObservabilityBackend');
// Module-level cold start flag
let coldStartFlag = true;
// OTEL Severity mapping for logs
const LOG_LEVEL_TO_SEVERITY = {
    trace: 1, // TRACE
    debug: 5, // DEBUG
    info: 9, // INFO
    warn: 13, // WARN
    error: 17, // ERROR
    critical: 21, // FATAL
};
let OTELObservabilityBackend = class OTELObservabilityBackend {
    static { OTELObservabilityBackend_1 = this; }
    name = 'otel';
    minLevel;
    serviceName;
    // Trace components
    tracer = null;
    trace = null;
    contextApi = null;
    spanStatusCode = null;
    activeSpans = new Map();
    // Metrics component
    meter = null;
    // Logs components
    otelLogger = null;
    // State
    isOTELAvailable = false;
    isMetricsAvailable = false;
    isLogsAvailable = false;
    invocationCount = 0;
    initializationPromise = null;
    constructor(serviceName, minLevel) {
        this.serviceName = serviceName;
        this.minLevel = minLevel;
        // Lazy initialization - do not start async process in constructor
    }
    async initializeOpenTelemetry() {
        if (this.isOTELAvailable)
            return;
        // Initialize Traces
        try {
            // Dynamic import wrapped in try-catch to safely handle missing layer
            const otel = await Promise.resolve().then(() => __importStar(require('@opentelemetry/api')));
            this.trace = otel.trace;
            this.contextApi = otel.context;
            this.spanStatusCode = otel.SpanStatusCode;
            this.tracer = otel.trace.getTracer(this.serviceName, process.env.npm_package_version || '1.0.0');
            this.isOTELAvailable = true;
            logger.info('OpenTelemetry Traces API available');
        }
        catch (error) {
            this.isOTELAvailable = false;
            // Only warn once
            if (!this.initializationPromise) {
                logger.warn('OpenTelemetry Traces API not available', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        // Initialize Metrics
        try {
            const otelMetrics = await Promise.resolve().then(() => __importStar(require('@opentelemetry/api')));
            if (otelMetrics.metrics) {
                this.meter = otelMetrics.metrics.getMeter(this.serviceName, process.env.npm_package_version || '1.0.0');
                this.isMetricsAvailable = true;
                logger.info('OpenTelemetry Metrics API available');
            }
        }
        catch (error) {
            this.isMetricsAvailable = false;
            logger.debug('OpenTelemetry Metrics API not available', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        // Initialize Logs
        try {
            const otelLogs = await Promise.resolve().then(() => __importStar(require('@opentelemetry/api-logs')));
            if (otelLogs.logs) {
                this.otelLogger = otelLogs.logs.getLogger(this.serviceName, process.env.npm_package_version || '1.0.0');
                this.isLogsAvailable = true;
                logger.info('OpenTelemetry Logs API available');
            }
        }
        catch (error) {
            this.isLogsAvailable = false;
            logger.debug('OpenTelemetry Logs API not available', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        if (this.isOTELAvailable) {
            logger.info(`OTEL Backend initialized for: ${this.serviceName}`, {
                traces: this.isOTELAvailable,
                metrics: this.isMetricsAvailable,
                logs: this.isLogsAvailable,
                xrayTraceId: process.env._X_AMZN_TRACE_ID,
            });
        }
    }
    async ensureInitialized() {
        if (!this.initializationPromise) {
            this.initializationPromise = this.initializeOpenTelemetry();
        }
        await this.initializationPromise;
    }
    initializeInvocation() {
        this.invocationCount++;
        const isColdStart = coldStartFlag;
        if (coldStartFlag) {
            coldStartFlag = false;
            logger.info('Cold start detected', {
                invocation: this.invocationCount,
                coldStart: true,
            });
        }
        if (this.activeSpans.size > 0) {
            logger.warn(`Cleaning up ${this.activeSpans.size} orphaned spans from previous invocation`);
            this.activeSpans.forEach((span, entityId) => {
                try {
                    span.end();
                }
                catch (error) {
                    logger.error(`Error ending orphaned span ${entityId}:`, error);
                }
            });
            this.activeSpans.clear();
        }
    }
    async capture(event) {
        await this.ensureInitialized();
        const type = event.type;
        if (type.startsWith('span.')) {
            if (!this.isOTELAvailable)
                return;
            await this.handleSpanEvent(event);
            return;
        }
        if (type === 'metric') {
            if (!this.isMetricsAvailable)
                return;
            this.handleMetricEvent(event);
            return;
        }
        if (type === 'log') {
            if (!this.isLogsAvailable)
                return;
            this.handleLogEvent(event);
            return;
        }
    }
    // ==================== SPAN HANDLING ====================
    async handleSpanEvent(event) {
        if (event.entityName !== 'span')
            return;
        switch (event.type) {
            case 'span.start':
                this.handleSpanStart(event);
                break;
            case 'span.event':
                this.handleSpanEventInternal(event);
                break;
            case 'span.end':
                this.handleSpanEnd(event);
                break;
        }
    }
    handleSpanStart(event) {
        if (!event.entityId || !this.tracer || !this.trace || !this.contextApi)
            return;
        try {
            const isRootSpan = !event.parentObservabilityLogId;
            const isColdStart = this.invocationCount === 1;
            let context = this.contextApi.active();
            if (event.parentObservabilityLogId) {
                const parentSpan = this.activeSpans.get(event.parentObservabilityLogId);
                if (parentSpan) {
                    context = this.trace.setSpan(context, parentSpan);
                }
            }
            const spanAttributes = {
                'service.name': this.serviceName,
                'fw24.correlation_id': event.correlationId,
                'fw24.invocation': this.invocationCount,
            };
            if (isRootSpan) {
                spanAttributes['coldStart'] = isColdStart;
            }
            if (event.entityId)
                spanAttributes['fw24.entity_id'] = event.entityId;
            if (event.entityName)
                spanAttributes['fw24.entity_name'] = event.entityName;
            if (event.parentObservabilityLogId)
                spanAttributes['fw24.parent_observability_log_id'] = event.parentObservabilityLogId;
            Object.assign(spanAttributes, this.toOtelAttributes(event.attributes));
            if (process.env.AWS_LAMBDA_FUNCTION_NAME)
                spanAttributes['faas.name'] = process.env.AWS_LAMBDA_FUNCTION_NAME;
            if (process.env.AWS_LAMBDA_FUNCTION_VERSION)
                spanAttributes['faas.version'] = process.env.AWS_LAMBDA_FUNCTION_VERSION;
            if (process.env.AWS_LAMBDA_LOG_STREAM_NAME)
                spanAttributes['faas.instance'] = process.env.AWS_LAMBDA_LOG_STREAM_NAME;
            if (process.env.AWS_ACCOUNT_ID)
                spanAttributes['cloud.account.id'] = process.env.AWS_ACCOUNT_ID;
            if (process.env.AWS_REGION)
                spanAttributes['cloud.region'] = process.env.AWS_REGION;
            const span = this.tracer.startSpan(event.operation || 'operation', {
                kind: (0, span_utils_1.getSpanKind)(event.subType),
                attributes: spanAttributes,
                startTime: event.timestampMs,
            }, context);
            this.activeSpans.set(event.entityId, span);
            logger.debug(`Created OpenTelemetry span: ${event.operation} (${event.entityId})`, {
                coldStart: isRootSpan ? isColdStart : undefined,
                invocation: this.invocationCount,
            });
        }
        catch (error) {
            logger.error('Error creating OpenTelemetry span:', error);
        }
    }
    handleSpanEventInternal(event) {
        if (!event.entityId)
            return;
        const span = this.activeSpans.get(event.entityId);
        if (!span) {
            logger.warn(`No active span found for event: ${event.entityId}`);
            return;
        }
        try {
            const attrs = this.toOtelAttributes(event.attributes);
            span.addEvent(event.operation || 'event', attrs, event.timestampMs);
            logger.debug(`Added event to span ${event.entityId}: ${event.operation}`);
        }
        catch (error) {
            logger.error('Error adding event to OpenTelemetry span:', error);
        }
    }
    handleSpanEnd(event) {
        if (!event.entityId || !this.spanStatusCode)
            return;
        const span = this.activeSpans.get(event.entityId);
        if (!span) {
            logger.warn(`No active span found for end event: ${event.entityId}`);
            return;
        }
        try {
            if (event.attributes) {
                span.setAttributes(this.toOtelAttributes(event.attributes));
            }
            if (event.metrics) {
                Object.entries(event.metrics).forEach(([key, value]) => {
                    span.setAttribute(`metric.${key}`, value);
                });
            }
            if (event.durationMs) {
                span.setAttribute('duration_ms', event.durationMs);
            }
            const statusCode = this.spanStatusCode;
            if (event.error) {
                span.setStatus({
                    code: statusCode.ERROR,
                    message: event.error.message,
                });
                span.recordException({
                    name: event.error.type,
                    message: event.error.message,
                    stack: event.error.stack,
                });
            }
            else if (event.success === false) {
                span.setStatus({
                    code: statusCode.ERROR,
                    message: event.status || 'Operation failed',
                });
            }
            else {
                span.setStatus({ code: statusCode.OK });
            }
            span.end(event.timestampMs);
            this.activeSpans.delete(event.entityId);
            logger.debug(`Ended OpenTelemetry span: ${event.entityId}`);
        }
        catch (error) {
            logger.error('Error ending OpenTelemetry span:', error);
        }
    }
    // ==================== METRIC HANDLING ====================
    handleMetricEvent(event) {
        if (!this.meter || !event.metrics)
            return;
        try {
            const metricType = event.subType || 'counter';
            const attrs = this.toOtelAttributes(event.attributes);
            for (const [name, value] of Object.entries(event.metrics)) {
                switch (metricType) {
                    case 'counter':
                        if (value < 0) {
                            this.meter.createUpDownCounter(name).add(value, attrs);
                        }
                        else {
                            this.meter.createCounter(name).add(value, attrs);
                        }
                        break;
                    case 'gauge':
                        this.meter.createGauge(name).record(value, attrs);
                        break;
                    case 'timing':
                    case 'histogram':
                        this.meter.createHistogram(name).record(value, attrs);
                        break;
                    default:
                        if (value >= 0) {
                            this.meter.createCounter(name).add(value, attrs);
                        }
                        else {
                            this.meter.createUpDownCounter(name).add(value, attrs);
                        }
                }
            }
        }
        catch (error) {
            logger.error('Error recording OpenTelemetry metric:', error);
        }
    }
    // ==================== LOG HANDLING ====================
    handleLogEvent(event) {
        if (!this.otelLogger)
            return;
        try {
            const severity = LOG_LEVEL_TO_SEVERITY[event.level] || 9;
            const message = this.extractLogMessage(event);
            const logAttributes = {
                ...this.toOtelAttributes(event.attributes),
                ...this.toOtelAttributes(event.data),
                'fw24.correlation_id': event.correlationId,
                'fw24.observability_log_id': event.observabilityLogId,
            };
            if (event.source)
                logAttributes['fw24.source'] = event.source;
            if (event.error) {
                if (event.error.type)
                    logAttributes['exception.type'] = event.error.type;
                if (event.error.message)
                    logAttributes['exception.message'] = event.error.message;
                if (event.error.stack)
                    logAttributes['exception.stacktrace'] = event.error.stack;
            }
            this.otelLogger.emit({
                severityNumber: severity,
                severityText: event.level.toUpperCase(),
                body: message,
                attributes: logAttributes,
                timestamp: event.timestampMs,
            });
            logger.debug(`Emitted OTEL log: ${event.level} - ${event.operation}`);
        }
        catch (error) {
            logger.error('Error emitting OpenTelemetry log:', error);
        }
    }
    extractLogMessage(event) {
        if (event.data && typeof event.data.message === 'string') {
            return event.data.message;
        }
        return event.operation || 'log';
    }
    // ==================== UTILITY METHODS ====================
    isStringArray(arr) {
        return arr.every((v) => typeof v === 'string');
    }
    isNumberArray(arr) {
        return arr.every((v) => typeof v === 'number');
    }
    isBooleanArray(arr) {
        return arr.every((v) => typeof v === 'boolean');
    }
    static MAX_ATTRIBUTE_SIZE = 4000;
    toOtelAttributes(attrs) {
        if (!attrs)
            return {};
        const result = {};
        for (const [key, value] of Object.entries(attrs)) {
            if (typeof value === 'string') {
                result[key] = value.length > OTELObservabilityBackend_1.MAX_ATTRIBUTE_SIZE
                    ? value.substring(0, OTELObservabilityBackend_1.MAX_ATTRIBUTE_SIZE) + '...[truncated]'
                    : value;
            }
            else if (typeof value === 'number' || typeof value === 'boolean') {
                result[key] = value;
            }
            else if (Array.isArray(value)) {
                if (value.length === 0) {
                    result[key] = [];
                }
                else if (this.isStringArray(value)) {
                    result[key] = value;
                }
                else if (this.isNumberArray(value)) {
                    result[key] = value;
                }
                else if (this.isBooleanArray(value)) {
                    result[key] = value;
                }
                else {
                    result[key] = this.safeJsonStringify(value);
                }
            }
            else if (value !== null && value !== undefined) {
                result[key] = this.safeJsonStringify(value);
            }
        }
        return result;
    }
    safeJsonStringify(value) {
        try {
            const json = JSON.stringify(value);
            if (json.length > OTELObservabilityBackend_1.MAX_ATTRIBUTE_SIZE) {
                return json.substring(0, OTELObservabilityBackend_1.MAX_ATTRIBUTE_SIZE) + '...[truncated]';
            }
            return json;
        }
        catch {
            return '[unserializable]';
        }
    }
    async flush() {
        if (this.activeSpans.size > 0 && this.spanStatusCode) {
            logger.warn(`Force ending ${this.activeSpans.size} active spans`);
            const statusCode = this.spanStatusCode;
            this.activeSpans.forEach((span, entityId) => {
                try {
                    span.setStatus({
                        code: statusCode.ERROR,
                        message: 'Span force-closed due to Lambda shutdown',
                    });
                    span.end();
                }
                catch (error) {
                    logger.error(`Error force-ending span ${entityId}:`, error);
                }
            });
            this.activeSpans.clear();
        }
        logger.debug('OTEL backend flush complete (ADOT collector handles export)');
    }
    destroy() {
        this.activeSpans.clear();
    }
};
exports.OTELObservabilityBackend = OTELObservabilityBackend;
exports.OTELObservabilityBackend = OTELObservabilityBackend = OTELObservabilityBackend_1 = __decorate([
    (0, di_1.Injectable)({
        provide: 'ObservabilityBackend',
        providedIn: 'ROOT',
        tags: ['observability', 'backend', 'otel']
    }),
    __param(0, (0, di_1.InjectConfig)('observability.serviceName')),
    __param(1, (0, di_1.InjectConfig)('observability.minLevel'))
], OTELObservabilityBackend);
/** Reset cold start flag (for testing) */
function resetColdStartFlag() {
    coldStartFlag = true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL290ZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUVHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBbWdCSCxnREFFQztBQW5nQkQsaUNBQW9EO0FBRXBELDJDQUE2QztBQUM3QyxvREFBa0Q7QUFPbEQsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLDBCQUEwQixDQUFDLENBQUM7QUFFeEQsK0JBQStCO0FBQy9CLElBQUksYUFBYSxHQUFHLElBQUksQ0FBQztBQUV6QixpQ0FBaUM7QUFDakMsTUFBTSxxQkFBcUIsR0FBNkM7SUFDdEUsS0FBSyxFQUFFLENBQUMsRUFBSSxRQUFRO0lBQ3BCLEtBQUssRUFBRSxDQUFDLEVBQUksUUFBUTtJQUNwQixJQUFJLEVBQUUsQ0FBQyxFQUFLLE9BQU87SUFDbkIsSUFBSSxFQUFFLEVBQUUsRUFBSSxPQUFPO0lBQ25CLEtBQUssRUFBRSxFQUFFLEVBQUcsUUFBUTtJQUNwQixRQUFRLEVBQUUsRUFBRSxFQUFFLFFBQVE7Q0FDdkIsQ0FBQztBQU9LLElBQU0sd0JBQXdCLEdBQTlCLE1BQU0sd0JBQXdCOztJQUNuQixJQUFJLEdBQUcsTUFBTSxDQUFDO0lBQ2QsUUFBUSxDQUFzQjtJQUU3QixXQUFXLENBQVM7SUFFckMsbUJBQW1CO0lBQ1gsTUFBTSxHQUFrQixJQUFJLENBQUM7SUFDN0IsS0FBSyxHQUFvQixJQUFJLENBQUM7SUFDOUIsVUFBVSxHQUFzQixJQUFJLENBQUM7SUFDckMsY0FBYyxHQUFpQyxJQUFJLENBQUM7SUFDcEQsV0FBVyxHQUFHLElBQUksR0FBRyxFQUFnQixDQUFDO0lBRTlD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QUMsd0JBQXdCLENBQUMsQ0FBQTtHQTVCOUIsd0JBQXdCLENBZ2VwQztBQUVELDBDQUEwQztBQUMxQyxTQUFnQixrQkFBa0I7SUFDaEMsYUFBYSxHQUFHLElBQUksQ0FBQztBQUN2QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPcGVuVGVsZW1ldHJ5IEJhY2tlbmQgZm9yIEFXUyBYLVJheSBJbnRlZ3JhdGlvblxuICogXG4gKiBJTVBPUlRBTlQ6IFRoaXMgYmFja2VuZCBpcyBkZXNpZ25lZCB0byB3b3JrIHdpdGggQVdTIExhbWJkYSdzIG1hbmFnZWQgQURPVCBsYXllci5cbiAqIFxuICogIyMgV2h5IEFET1QvT3BlblRlbGVtZXRyeSAoTm90IFgtUmF5IFNESylcbiAqIFxuICogQVdTIFgtUmF5IFNESyBpcyBiZWluZyBkZXByZWNhdGVkIChlbmQtb2Ytc3VwcG9ydDogRmViIDI1LCAyMDI3KTpcbiAqIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS94cmF5L2xhdGVzdC9kZXZndWlkZS94cmF5LXNkay1ub2RlanMuaHRtbFxuICogXG4gKiBBV1MgcmVjb21tZW5kcyBtaWdyYXRpbmcgdG8gT3BlblRlbGVtZXRyeTpcbiAqIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS94cmF5L2xhdGVzdC9kZXZndWlkZS94cmF5LWluc3RydW1lbnRpbmcteW91ci1hcHAuaHRtbCN4cmF5LWluc3RydW1lbnRpbmctb3BlbnRlbFxuICogXG4gKiAjIyBBV1MgQURPVCBMYW1iZGEgTGF5ZXJcbiAqIFxuICogQVdTIHByb3ZpZGVzIGEgbWFuYWdlZCBMYW1iZGEgbGF5ZXIgdGhhdCBpbmNsdWRlcyBPcGVuVGVsZW1ldHJ5IGluc3RydW1lbnRhdGlvbjpcbiAqIC0gQVJOOiBhcm46YXdzOmxhbWJkYTo8cmVnaW9uPjo5MDE5MjA1NzA0NjM6bGF5ZXI6YXdzLW90ZWwtbm9kZWpzLTxhcmNoPi12ZXItMS0zMC0yOjFcbiAqIC0gQXV0b21hdGljYWxseSBpbnN0cnVtZW50cyBBV1MgU0RLLCBIVFRQLCBhbmQgTGFtYmRhIGludm9jYXRpb25zXG4gKiAtIEV4cG9ydHMgdG8gWC1SYXkgdmlhIE9wZW5UZWxlbWV0cnkgQ29sbGVjdG9yXG4gKiAtIFczQyBUcmFjZSBDb250ZXh0ICsgWC1SYXkgcHJvcGFnYXRpb25cbiAqIFxuICogIyMgQXJjaGl0ZWN0dXJlXG4gKiBcbiAqIFRoZSBBRE9UIGxheWVyIHByb3ZpZGVzIE9wZW5UZWxlbWV0cnkgcGFja2FnZXMgYXQgcnVudGltZTpcbiAqIC0gQG9wZW50ZWxlbWV0cnkvYXBpIChmb3IgZ2V0dGluZyB0cmFjZXJzIGFuZCBjcmVhdGluZyBzcGFucylcbiAqIC0gQG9wZW50ZWxlbWV0cnkvc2RrLXRyYWNlLW5vZGUgKGZvciB0cmFjZXIgY29uZmlndXJhdGlvbilcbiAqIC0gQURPVCBDb2xsZWN0b3IgcnVubmluZyBhcyBMYW1iZGEgZXh0ZW5zaW9uXG4gKiBcbiAqIFdlIGltcG9ydCB0aGVzZSBwYWNrYWdlcyBidXQgbWFyayB0aGVtIGFzIGV4dGVybmFsIGluIGJ1bmRsaW5nLCBzbzpcbiAqIC0gRGV2ZWxvcG1lbnQ6IENhbiB0ZXN0IGxvY2FsbHkgd2l0aCBPVEVMIHBhY2thZ2VzIGluc3RhbGxlZFxuICogLSBQcm9kdWN0aW9uOiBVc2VzIHBhY2thZ2VzIGZyb20gQURPVCBsYXllciAoemVybyBidW5kbGUgc2l6ZSlcbiAqIFxuICogIyMgU3VwcG9ydGVkIEV2ZW50IFR5cGVzXG4gKiBcbiAqIFRoaXMgYmFja2VuZCBoYW5kbGVzIHRoZSBmb2xsb3dpbmcgZXZlbnRzOlxuICogLSBzcGFuLiog4oaSIE9URUwgVHJhY2VzIChzcGFucyB3aXRoIHBhcmVudC1jaGlsZCByZWxhdGlvbnNoaXBzKVxuICogLSBtZXRyaWMg4oaSIE9URUwgTWV0cmljcyAoY291bnRlcnMsIGdhdWdlcywgaGlzdG9ncmFtcylcbiAqIC0gbG9nIOKGkiBPVEVMIExvZ3MgKHN0cnVjdHVyZWQgbG9nIGV2ZW50cylcbiAqIFxuICogTk9UIGhhbmRsZWQgKHVzZSBEeW5hbW9EQiBiYWNrZW5kIGZvciBwZXJzaXN0ZW5jZSk6XG4gKiAtIGF1ZGl0Liog4oaSIEJ1c2luZXNzIHJlY29yZHMgKG5vdCB0ZWxlbWV0cnkpXG4gKiAtIGRlY2lzaW9uLiog4oaSIEJ1c2luZXNzIHJlY29yZHMgKG5vdCB0ZWxlbWV0cnkpXG4gKiAtIGFjY2Vzcy4qIOKGkiBCdXNpbmVzcyByZWNvcmRzIChub3QgdGVsZW1ldHJ5KVxuICogLSB3b3JrZmxvdy4qIOKGkiBMb25nLXJ1bm5pbmcgc3RhdGUgKGRvZXNuJ3QgZml0IE9URUwncyBlcGhlbWVyYWwgc3BhbiBtb2RlbClcbiAqIFxuICogIyMgU2V0dXAgaW4gQ0RLL1NBTVxuICogXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBUcmFjaW5nIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG4gKiBcbiAqIGNvbnN0IGZuID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdNeUZ1bmN0aW9uJywge1xuICogICBsYXllcnM6IFtcbiAqICAgICBMYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybih0aGlzLCAnQWRvdExheWVyJyxcbiAqICAgICAgICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6OTAxOTIwNTcwNDYzOmxheWVyOmF3cy1vdGVsLW5vZGVqcy1hbWQ2NC12ZXItMS0zMC0yOjEnXG4gKiAgICAgKVxuICogICBdLFxuICogICBlbnZpcm9ubWVudDoge1xuICogICAgIEFXU19MQU1CREFfRVhFQ19XUkFQUEVSOiAnL29wdC9vdGVsLWhhbmRsZXInLFxuICogICAgIE9CU0VSVkFCSUxJVFlfQkFDS0VORFM6ICdvdGVsJywgLy8gRlcyNCBjb25maWdcbiAqICAgfSxcbiAqICAgdHJhY2luZzogVHJhY2luZy5BQ1RJVkUsIC8vIEVuYWJsZSBYLVJheVxuICogICBidW5kbGluZzoge1xuICogICAgIGV4dGVybmFsTW9kdWxlczogW1xuICogICAgICAgJ0BvcGVudGVsZW1ldHJ5LyonLCAvLyBQcm92aWRlZCBieSBMYW1iZGEgbGF5ZXJcbiAqICAgICBdLFxuICogICB9LFxuICogfSk7XG4gKiBgYGBcbiAqIFxuICogUmVmZXJlbmNlczpcbiAqIC0gaHR0cHM6Ly9hd3Mtb3RlbC5naXRodWIuaW8vZG9jcy9nZXR0aW5nLXN0YXJ0ZWQvbGFtYmRhL2xhbWJkYS1qc1xuICogLSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vbGFtYmRhL2xhdGVzdC9kZy90eXBlc2NyaXB0LXRyYWNpbmcuaHRtbFxuICogLSBodHRwczovL29wZW50ZWxlbWV0cnkuaW8vZG9jcy9sYW5ndWFnZXMvanMvXG4gKi9cblxuaW1wb3J0IHsgSW5qZWN0YWJsZSwgSW5qZWN0Q29uZmlnIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsIE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsLCBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IGdldFNwYW5LaW5kIH0gZnJvbSAnLi4vdXRpbHMvc3Bhbi11dGlscyc7XG5cbi8vIEltcG9ydCB0eXBlcyBmcm9tIEBvcGVudGVsZW1ldHJ5L2FwaVxuaW1wb3J0IHR5cGUgeyBUcmFjZXIsIFNwYW4sIFNwYW5TdGF0dXNDb2RlLCBUcmFjZUFQSSwgQ29udGV4dEFQSSwgQXR0cmlidXRlcyB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaSc7XG5pbXBvcnQgdHlwZSB7IE1ldGVyIH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB0eXBlIHsgTG9nZ2VyIGFzIE9URUxMb2dnZXIgfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGktbG9ncyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kJyk7XG5cbi8vIE1vZHVsZS1sZXZlbCBjb2xkIHN0YXJ0IGZsYWdcbmxldCBjb2xkU3RhcnRGbGFnID0gdHJ1ZTtcblxuLy8gT1RFTCBTZXZlcml0eSBtYXBwaW5nIGZvciBsb2dzXG5jb25zdCBMT0dfTEVWRUxfVE9fU0VWRVJJVFk6IFJlY29yZDxPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsIG51bWJlcj4gPSB7XG4gIHRyYWNlOiAxLCAgIC8vIFRSQUNFXG4gIGRlYnVnOiA1LCAgIC8vIERFQlVHXG4gIGluZm86IDksICAgIC8vIElORk9cbiAgd2FybjogMTMsICAgLy8gV0FSTlxuICBlcnJvcjogMTcsICAvLyBFUlJPUlxuICBjcml0aWNhbDogMjEsIC8vIEZBVEFMXG59O1xuXG5ASW5qZWN0YWJsZSh7XG4gIHByb3ZpZGU6ICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gIHByb3ZpZGVkSW46ICdST09UJyxcbiAgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgJ290ZWwnIF1cbn0pXG5leHBvcnQgY2xhc3MgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kIGltcGxlbWVudHMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwdWJsaWMgcmVhZG9ubHkgbmFtZSA9ICdvdGVsJztcbiAgcHVibGljIHJlYWRvbmx5IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgc2VydmljZU5hbWU6IHN0cmluZztcblxuICAvLyBUcmFjZSBjb21wb25lbnRzXG4gIHByaXZhdGUgdHJhY2VyOiBUcmFjZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0cmFjZTogVHJhY2VBUEkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb250ZXh0QXBpOiBDb250ZXh0QVBJIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3BhblN0YXR1c0NvZGU6IHR5cGVvZiBTcGFuU3RhdHVzQ29kZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGFjdGl2ZVNwYW5zID0gbmV3IE1hcDxzdHJpbmcsIFNwYW4+KCk7XG5cbiAgLy8gTWV0cmljcyBjb21wb25lbnRcbiAgcHJpdmF0ZSBtZXRlcjogTWV0ZXIgfCBudWxsID0gbnVsbDtcblxuICAvLyBMb2dzIGNvbXBvbmVudHNcbiAgcHJpdmF0ZSBvdGVsTG9nZ2VyOiBPVEVMTG9nZ2VyIHwgbnVsbCA9IG51bGw7XG5cbiAgLy8gU3RhdGVcbiAgcHJpdmF0ZSBpc09URUxBdmFpbGFibGU6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBpc01ldHJpY3NBdmFpbGFibGU6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBpc0xvZ3NBdmFpbGFibGU6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBpbnZvY2F0aW9uQ291bnQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgaW5pdGlhbGl6YXRpb25Qcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5zZXJ2aWNlTmFtZScpIHNlcnZpY2VOYW1lOiBzdHJpbmcsXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5taW5MZXZlbCcpIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxcbiAgKSB7XG4gICAgdGhpcy5zZXJ2aWNlTmFtZSA9IHNlcnZpY2VOYW1lO1xuICAgIHRoaXMubWluTGV2ZWwgPSBtaW5MZXZlbDtcbiAgICAvLyBMYXp5IGluaXRpYWxpemF0aW9uIC0gZG8gbm90IHN0YXJ0IGFzeW5jIHByb2Nlc3MgaW4gY29uc3RydWN0b3JcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaW5pdGlhbGl6ZU9wZW5UZWxlbWV0cnkoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuaXNPVEVMQXZhaWxhYmxlKSByZXR1cm47XG5cbiAgICAvLyBJbml0aWFsaXplIFRyYWNlc1xuICAgIHRyeSB7XG4gICAgICAvLyBEeW5hbWljIGltcG9ydCB3cmFwcGVkIGluIHRyeS1jYXRjaCB0byBzYWZlbHkgaGFuZGxlIG1pc3NpbmcgbGF5ZXJcbiAgICAgIGNvbnN0IG90ZWwgPSBhd2FpdCBpbXBvcnQoJ0BvcGVudGVsZW1ldHJ5L2FwaScpO1xuICAgICAgdGhpcy50cmFjZSA9IG90ZWwudHJhY2U7XG4gICAgICB0aGlzLmNvbnRleHRBcGkgPSBvdGVsLmNvbnRleHQ7XG4gICAgICB0aGlzLnNwYW5TdGF0dXNDb2RlID0gb3RlbC5TcGFuU3RhdHVzQ29kZTtcblxuICAgICAgdGhpcy50cmFjZXIgPSBvdGVsLnRyYWNlLmdldFRyYWNlcihcbiAgICAgICAgdGhpcy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgcHJvY2Vzcy5lbnYubnBtX3BhY2thZ2VfdmVyc2lvbiB8fCAnMS4wLjAnXG4gICAgICApO1xuXG4gICAgICB0aGlzLmlzT1RFTEF2YWlsYWJsZSA9IHRydWU7XG4gICAgICBsb2dnZXIuaW5mbygnT3BlblRlbGVtZXRyeSBUcmFjZXMgQVBJIGF2YWlsYWJsZScpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmlzT1RFTEF2YWlsYWJsZSA9IGZhbHNlO1xuICAgICAgLy8gT25seSB3YXJuIG9uY2VcbiAgICAgIGlmICghdGhpcy5pbml0aWFsaXphdGlvblByb21pc2UpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ09wZW5UZWxlbWV0cnkgVHJhY2VzIEFQSSBub3QgYXZhaWxhYmxlJywge1xuICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgTWV0cmljc1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBvdGVsTWV0cmljcyA9IGF3YWl0IGltcG9ydCgnQG9wZW50ZWxlbWV0cnkvYXBpJyk7XG4gICAgICBpZiAob3RlbE1ldHJpY3MubWV0cmljcykge1xuICAgICAgICB0aGlzLm1ldGVyID0gb3RlbE1ldHJpY3MubWV0cmljcy5nZXRNZXRlcihcbiAgICAgICAgICB0aGlzLnNlcnZpY2VOYW1lLFxuICAgICAgICAgIHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzEuMC4wJ1xuICAgICAgICApO1xuICAgICAgICB0aGlzLmlzTWV0cmljc0F2YWlsYWJsZSA9IHRydWU7XG4gICAgICAgIGxvZ2dlci5pbmZvKCdPcGVuVGVsZW1ldHJ5IE1ldHJpY3MgQVBJIGF2YWlsYWJsZScpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmlzTWV0cmljc0F2YWlsYWJsZSA9IGZhbHNlO1xuICAgICAgbG9nZ2VyLmRlYnVnKCdPcGVuVGVsZW1ldHJ5IE1ldHJpY3MgQVBJIG5vdCBhdmFpbGFibGUnLCB7XG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBJbml0aWFsaXplIExvZ3NcbiAgICB0cnkge1xuICAgICAgY29uc3Qgb3RlbExvZ3MgPSBhd2FpdCBpbXBvcnQoJ0BvcGVudGVsZW1ldHJ5L2FwaS1sb2dzJyk7XG4gICAgICBpZiAob3RlbExvZ3MubG9ncykge1xuICAgICAgICB0aGlzLm90ZWxMb2dnZXIgPSBvdGVsTG9ncy5sb2dzLmdldExvZ2dlcihcbiAgICAgICAgICB0aGlzLnNlcnZpY2VOYW1lLFxuICAgICAgICAgIHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzEuMC4wJ1xuICAgICAgICApO1xuICAgICAgICB0aGlzLmlzTG9nc0F2YWlsYWJsZSA9IHRydWU7XG4gICAgICAgIGxvZ2dlci5pbmZvKCdPcGVuVGVsZW1ldHJ5IExvZ3MgQVBJIGF2YWlsYWJsZScpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmlzTG9nc0F2YWlsYWJsZSA9IGZhbHNlO1xuICAgICAgbG9nZ2VyLmRlYnVnKCdPcGVuVGVsZW1ldHJ5IExvZ3MgQVBJIG5vdCBhdmFpbGFibGUnLCB7XG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc09URUxBdmFpbGFibGUpIHtcbiAgICAgIGxvZ2dlci5pbmZvKGBPVEVMIEJhY2tlbmQgaW5pdGlhbGl6ZWQgZm9yOiAke3RoaXMuc2VydmljZU5hbWV9YCwge1xuICAgICAgICB0cmFjZXM6IHRoaXMuaXNPVEVMQXZhaWxhYmxlLFxuICAgICAgICBtZXRyaWNzOiB0aGlzLmlzTWV0cmljc0F2YWlsYWJsZSxcbiAgICAgICAgbG9nczogdGhpcy5pc0xvZ3NBdmFpbGFibGUsXG4gICAgICAgIHhyYXlUcmFjZUlkOiBwcm9jZXNzLmVudi5fWF9BTVpOX1RSQUNFX0lELFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVJbml0aWFsaXplZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuaW5pdGlhbGl6YXRpb25Qcm9taXNlKSB7XG4gICAgICB0aGlzLmluaXRpYWxpemF0aW9uUHJvbWlzZSA9IHRoaXMuaW5pdGlhbGl6ZU9wZW5UZWxlbWV0cnkoKTtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5pbml0aWFsaXphdGlvblByb21pc2U7XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICB0aGlzLmludm9jYXRpb25Db3VudCsrO1xuXG4gICAgY29uc3QgaXNDb2xkU3RhcnQgPSBjb2xkU3RhcnRGbGFnO1xuICAgIGlmIChjb2xkU3RhcnRGbGFnKSB7XG4gICAgICBjb2xkU3RhcnRGbGFnID0gZmFsc2U7XG4gICAgICBsb2dnZXIuaW5mbygnQ29sZCBzdGFydCBkZXRlY3RlZCcsIHtcbiAgICAgICAgaW52b2NhdGlvbjogdGhpcy5pbnZvY2F0aW9uQ291bnQsXG4gICAgICAgIGNvbGRTdGFydDogdHJ1ZSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmFjdGl2ZVNwYW5zLnNpemUgPiAwKSB7XG4gICAgICBsb2dnZXIud2FybihgQ2xlYW5pbmcgdXAgJHt0aGlzLmFjdGl2ZVNwYW5zLnNpemV9IG9ycGhhbmVkIHNwYW5zIGZyb20gcHJldmlvdXMgaW52b2NhdGlvbmApO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5mb3JFYWNoKChzcGFuLCBlbnRpdHlJZCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHNwYW4uZW5kKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBFcnJvciBlbmRpbmcgb3JwaGFuZWQgc3BhbiAke2VudGl0eUlkfTpgLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5jbGVhcigpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKTtcblxuICAgIGNvbnN0IHR5cGUgPSBldmVudC50eXBlO1xuXG4gICAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnc3Bhbi4nKSkge1xuICAgICAgaWYgKCF0aGlzLmlzT1RFTEF2YWlsYWJsZSkgcmV0dXJuO1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVTcGFuRXZlbnQoZXZlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAnbWV0cmljJykge1xuICAgICAgaWYgKCF0aGlzLmlzTWV0cmljc0F2YWlsYWJsZSkgcmV0dXJuO1xuICAgICAgdGhpcy5oYW5kbGVNZXRyaWNFdmVudChldmVudCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICdsb2cnKSB7XG4gICAgICBpZiAoIXRoaXMuaXNMb2dzQXZhaWxhYmxlKSByZXR1cm47XG4gICAgICB0aGlzLmhhbmRsZUxvZ0V2ZW50KGV2ZW50KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PSBTUEFOIEhBTkRMSU5HID09PT09PT09PT09PT09PT09PT09XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTcGFuRXZlbnQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChldmVudC5lbnRpdHlOYW1lICE9PSAnc3BhbicpIHJldHVybjtcblxuICAgIHN3aXRjaCAoZXZlbnQudHlwZSkge1xuICAgICAgY2FzZSAnc3Bhbi5zdGFydCc6XG4gICAgICAgIHRoaXMuaGFuZGxlU3BhblN0YXJ0KGV2ZW50KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdzcGFuLmV2ZW50JzpcbiAgICAgICAgdGhpcy5oYW5kbGVTcGFuRXZlbnRJbnRlcm5hbChldmVudCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnc3Bhbi5lbmQnOlxuICAgICAgICB0aGlzLmhhbmRsZVNwYW5FbmQoZXZlbnQpO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVNwYW5TdGFydChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5lbnRpdHlJZCB8fCAhdGhpcy50cmFjZXIgfHwgIXRoaXMudHJhY2UgfHwgIXRoaXMuY29udGV4dEFwaSkgcmV0dXJuO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGlzUm9vdFNwYW4gPSAhZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgY29uc3QgaXNDb2xkU3RhcnQgPSB0aGlzLmludm9jYXRpb25Db3VudCA9PT0gMTtcblxuICAgICAgbGV0IGNvbnRleHQgPSB0aGlzLmNvbnRleHRBcGkuYWN0aXZlKCk7XG4gICAgICBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgICBpZiAocGFyZW50U3Bhbikge1xuICAgICAgICAgIGNvbnRleHQgPSB0aGlzLnRyYWNlLnNldFNwYW4oY29udGV4dCwgcGFyZW50U3Bhbik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3BhbkF0dHJpYnV0ZXM6IEF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICdzZXJ2aWNlLm5hbWUnOiB0aGlzLnNlcnZpY2VOYW1lLFxuICAgICAgICAnZncyNC5jb3JyZWxhdGlvbl9pZCc6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICdmdzI0Lmludm9jYXRpb24nOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgIH07XG5cbiAgICAgIGlmIChpc1Jvb3RTcGFuKSB7XG4gICAgICAgIHNwYW5BdHRyaWJ1dGVzWyAnY29sZFN0YXJ0JyBdID0gaXNDb2xkU3RhcnQ7XG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudC5lbnRpdHlJZCkgc3BhbkF0dHJpYnV0ZXNbICdmdzI0LmVudGl0eV9pZCcgXSA9IGV2ZW50LmVudGl0eUlkO1xuICAgICAgaWYgKGV2ZW50LmVudGl0eU5hbWUpIHNwYW5BdHRyaWJ1dGVzWyAnZncyNC5lbnRpdHlfbmFtZScgXSA9IGV2ZW50LmVudGl0eU5hbWU7XG4gICAgICBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSBzcGFuQXR0cmlidXRlc1sgJ2Z3MjQucGFyZW50X29ic2VydmFiaWxpdHlfbG9nX2lkJyBdID0gZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuXG4gICAgICBPYmplY3QuYXNzaWduKHNwYW5BdHRyaWJ1dGVzLCB0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcykpO1xuXG4gICAgICBpZiAocHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9OQU1FKSBzcGFuQXR0cmlidXRlc1sgJ2ZhYXMubmFtZScgXSA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRTtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0ZVTkNUSU9OX1ZFUlNJT04pIHNwYW5BdHRyaWJ1dGVzWyAnZmFhcy52ZXJzaW9uJyBdID0gcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9WRVJTSU9OO1xuICAgICAgaWYgKHByb2Nlc3MuZW52LkFXU19MQU1CREFfTE9HX1NUUkVBTV9OQU1FKSBzcGFuQXR0cmlidXRlc1sgJ2ZhYXMuaW5zdGFuY2UnIF0gPSBwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0xPR19TVFJFQU1fTkFNRTtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5BV1NfQUNDT1VOVF9JRCkgc3BhbkF0dHJpYnV0ZXNbICdjbG91ZC5hY2NvdW50LmlkJyBdID0gcHJvY2Vzcy5lbnYuQVdTX0FDQ09VTlRfSUQ7XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuQVdTX1JFR0lPTikgc3BhbkF0dHJpYnV0ZXNbICdjbG91ZC5yZWdpb24nIF0gPSBwcm9jZXNzLmVudi5BV1NfUkVHSU9OO1xuXG4gICAgICBjb25zdCBzcGFuID0gdGhpcy50cmFjZXIuc3RhcnRTcGFuKFxuICAgICAgICBldmVudC5vcGVyYXRpb24gfHwgJ29wZXJhdGlvbicsXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiBnZXRTcGFuS2luZChldmVudC5zdWJUeXBlKSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiBzcGFuQXR0cmlidXRlcyxcbiAgICAgICAgICBzdGFydFRpbWU6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0LFxuICAgICAgKTtcblxuICAgICAgdGhpcy5hY3RpdmVTcGFucy5zZXQoZXZlbnQuZW50aXR5SWQsIHNwYW4pO1xuXG4gICAgICBsb2dnZXIuZGVidWcoYENyZWF0ZWQgT3BlblRlbGVtZXRyeSBzcGFuOiAke2V2ZW50Lm9wZXJhdGlvbn0gKCR7ZXZlbnQuZW50aXR5SWR9KWAsIHtcbiAgICAgICAgY29sZFN0YXJ0OiBpc1Jvb3RTcGFuID8gaXNDb2xkU3RhcnQgOiB1bmRlZmluZWQsXG4gICAgICAgIGludm9jYXRpb246IHRoaXMuaW52b2NhdGlvbkNvdW50LFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRXJyb3IgY3JlYXRpbmcgT3BlblRlbGVtZXRyeSBzcGFuOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVNwYW5FdmVudEludGVybmFsKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBpZiAoIWV2ZW50LmVudGl0eUlkKSByZXR1cm47XG5cbiAgICBjb25zdCBzcGFuID0gdGhpcy5hY3RpdmVTcGFucy5nZXQoZXZlbnQuZW50aXR5SWQpO1xuICAgIGlmICghc3Bhbikge1xuICAgICAgbG9nZ2VyLndhcm4oYE5vIGFjdGl2ZSBzcGFuIGZvdW5kIGZvciBldmVudDogJHtldmVudC5lbnRpdHlJZH1gKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgYXR0cnMgPSB0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcyk7XG4gICAgICBzcGFuLmFkZEV2ZW50KGV2ZW50Lm9wZXJhdGlvbiB8fCAnZXZlbnQnLCBhdHRycywgZXZlbnQudGltZXN0YW1wTXMpO1xuICAgICAgbG9nZ2VyLmRlYnVnKGBBZGRlZCBldmVudCB0byBzcGFuICR7ZXZlbnQuZW50aXR5SWR9OiAke2V2ZW50Lm9wZXJhdGlvbn1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdFcnJvciBhZGRpbmcgZXZlbnQgdG8gT3BlblRlbGVtZXRyeSBzcGFuOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVNwYW5FbmQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQuZW50aXR5SWQgfHwgIXRoaXMuc3BhblN0YXR1c0NvZGUpIHJldHVybjtcblxuICAgIGNvbnN0IHNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChldmVudC5lbnRpdHlJZCk7XG4gICAgaWYgKCFzcGFuKSB7XG4gICAgICBsb2dnZXIud2FybihgTm8gYWN0aXZlIHNwYW4gZm91bmQgZm9yIGVuZCBldmVudDogJHtldmVudC5lbnRpdHlJZH1gKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKGV2ZW50LmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGVzKHRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudC5tZXRyaWNzKSB7XG4gICAgICAgIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoYG1ldHJpYy4ke2tleX1gLCB2YWx1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnQuZHVyYXRpb25Ncykge1xuICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnZHVyYXRpb25fbXMnLCBldmVudC5kdXJhdGlvbk1zKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3RhdHVzQ29kZSA9IHRoaXMuc3BhblN0YXR1c0NvZGU7XG5cbiAgICAgIGlmIChldmVudC5lcnJvcikge1xuICAgICAgICBzcGFuLnNldFN0YXR1cyh7XG4gICAgICAgICAgY29kZTogc3RhdHVzQ29kZS5FUlJPUixcbiAgICAgICAgICBtZXNzYWdlOiBldmVudC5lcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcblxuICAgICAgICBzcGFuLnJlY29yZEV4Y2VwdGlvbih7XG4gICAgICAgICAgbmFtZTogZXZlbnQuZXJyb3IudHlwZSxcbiAgICAgICAgICBtZXNzYWdlOiBldmVudC5lcnJvci5tZXNzYWdlLFxuICAgICAgICAgIHN0YWNrOiBldmVudC5lcnJvci5zdGFjayxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgICAgIHNwYW4uc2V0U3RhdHVzKHtcbiAgICAgICAgICBjb2RlOiBzdGF0dXNDb2RlLkVSUk9SLFxuICAgICAgICAgIG1lc3NhZ2U6IGV2ZW50LnN0YXR1cyB8fCAnT3BlcmF0aW9uIGZhaWxlZCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBzdGF0dXNDb2RlLk9LIH0pO1xuICAgICAgfVxuXG4gICAgICBzcGFuLmVuZChldmVudC50aW1lc3RhbXBNcyk7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmRlbGV0ZShldmVudC5lbnRpdHlJZCk7XG4gICAgICBsb2dnZXIuZGVidWcoYEVuZGVkIE9wZW5UZWxlbWV0cnkgc3BhbjogJHtldmVudC5lbnRpdHlJZH1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdFcnJvciBlbmRpbmcgT3BlblRlbGVtZXRyeSBzcGFuOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PSBNRVRSSUMgSEFORExJTkcgPT09PT09PT09PT09PT09PT09PT1cblxuICBwcml2YXRlIGhhbmRsZU1ldHJpY0V2ZW50KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubWV0ZXIgfHwgIWV2ZW50Lm1ldHJpY3MpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBtZXRyaWNUeXBlID0gZXZlbnQuc3ViVHlwZSB8fCAnY291bnRlcic7XG4gICAgICBjb25zdCBhdHRycyA9IHRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKTtcblxuICAgICAgZm9yIChjb25zdCBbIG5hbWUsIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQubWV0cmljcykpIHtcbiAgICAgICAgc3dpdGNoIChtZXRyaWNUeXBlKSB7XG4gICAgICAgICAgY2FzZSAnY291bnRlcic6XG4gICAgICAgICAgICBpZiAodmFsdWUgPCAwKSB7XG4gICAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlVXBEb3duQ291bnRlcihuYW1lKS5hZGQodmFsdWUsIGF0dHJzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlQ291bnRlcihuYW1lKS5hZGQodmFsdWUsIGF0dHJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgY2FzZSAnZ2F1Z2UnOlxuICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVHYXVnZShuYW1lKS5yZWNvcmQodmFsdWUsIGF0dHJzKTtcbiAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgY2FzZSAndGltaW5nJzpcbiAgICAgICAgICBjYXNlICdoaXN0b2dyYW0nOlxuICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVIaXN0b2dyYW0obmFtZSkucmVjb3JkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBpZiAodmFsdWUgPj0gMCkge1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZUNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZVVwRG93bkNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdFcnJvciByZWNvcmRpbmcgT3BlblRlbGVtZXRyeSBtZXRyaWM6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09IExPRyBIQU5ETElORyA9PT09PT09PT09PT09PT09PT09PVxuXG4gIHByaXZhdGUgaGFuZGxlTG9nRXZlbnQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5vdGVsTG9nZ2VyKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc2V2ZXJpdHkgPSBMT0dfTEVWRUxfVE9fU0VWRVJJVFlbIGV2ZW50LmxldmVsIF0gfHwgOTtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLmV4dHJhY3RMb2dNZXNzYWdlKGV2ZW50KTtcblxuICAgICAgY29uc3QgbG9nQXR0cmlidXRlczogQXR0cmlidXRlcyA9IHtcbiAgICAgICAgLi4udGhpcy50b090ZWxBdHRyaWJ1dGVzKGV2ZW50LmF0dHJpYnV0ZXMpLFxuICAgICAgICAuLi50aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuZGF0YSksXG4gICAgICAgICdmdzI0LmNvcnJlbGF0aW9uX2lkJzogZXZlbnQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgJ2Z3MjQub2JzZXJ2YWJpbGl0eV9sb2dfaWQnOiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICB9O1xuXG4gICAgICBpZiAoZXZlbnQuc291cmNlKSBsb2dBdHRyaWJ1dGVzWyAnZncyNC5zb3VyY2UnIF0gPSBldmVudC5zb3VyY2U7XG5cbiAgICAgIGlmIChldmVudC5lcnJvcikge1xuICAgICAgICBpZiAoZXZlbnQuZXJyb3IudHlwZSkgbG9nQXR0cmlidXRlc1sgJ2V4Y2VwdGlvbi50eXBlJyBdID0gZXZlbnQuZXJyb3IudHlwZTtcbiAgICAgICAgaWYgKGV2ZW50LmVycm9yLm1lc3NhZ2UpIGxvZ0F0dHJpYnV0ZXNbICdleGNlcHRpb24ubWVzc2FnZScgXSA9IGV2ZW50LmVycm9yLm1lc3NhZ2U7XG4gICAgICAgIGlmIChldmVudC5lcnJvci5zdGFjaykgbG9nQXR0cmlidXRlc1sgJ2V4Y2VwdGlvbi5zdGFja3RyYWNlJyBdID0gZXZlbnQuZXJyb3Iuc3RhY2s7XG4gICAgICB9XG5cbiAgICAgIHRoaXMub3RlbExvZ2dlci5lbWl0KHtcbiAgICAgICAgc2V2ZXJpdHlOdW1iZXI6IHNldmVyaXR5LFxuICAgICAgICBzZXZlcml0eVRleHQ6IGV2ZW50LmxldmVsLnRvVXBwZXJDYXNlKCksXG4gICAgICAgIGJvZHk6IG1lc3NhZ2UsXG4gICAgICAgIGF0dHJpYnV0ZXM6IGxvZ0F0dHJpYnV0ZXMsXG4gICAgICAgIHRpbWVzdGFtcDogZXZlbnQudGltZXN0YW1wTXMsXG4gICAgICB9KTtcblxuICAgICAgbG9nZ2VyLmRlYnVnKGBFbWl0dGVkIE9URUwgbG9nOiAke2V2ZW50LmxldmVsfSAtICR7ZXZlbnQub3BlcmF0aW9ufWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGVtaXR0aW5nIE9wZW5UZWxlbWV0cnkgbG9nOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RMb2dNZXNzYWdlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBzdHJpbmcge1xuICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZXZlbnQuZGF0YS5tZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXZlbnQub3BlcmF0aW9uIHx8ICdsb2cnO1xuICB9XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT0gVVRJTElUWSBNRVRIT0RTID09PT09PT09PT09PT09PT09PT09XG5cbiAgcHJpdmF0ZSBpc1N0cmluZ0FycmF5KGFycjogdW5rbm93bltdKTogYXJyIGlzIHN0cmluZ1tdIHtcbiAgICByZXR1cm4gYXJyLmV2ZXJ5KCh2KTogdiBpcyBzdHJpbmcgPT4gdHlwZW9mIHYgPT09ICdzdHJpbmcnKTtcbiAgfVxuXG4gIHByaXZhdGUgaXNOdW1iZXJBcnJheShhcnI6IHVua25vd25bXSk6IGFyciBpcyBudW1iZXJbXSB7XG4gICAgcmV0dXJuIGFyci5ldmVyeSgodik6IHYgaXMgbnVtYmVyID0+IHR5cGVvZiB2ID09PSAnbnVtYmVyJyk7XG4gIH1cblxuICBwcml2YXRlIGlzQm9vbGVhbkFycmF5KGFycjogdW5rbm93bltdKTogYXJyIGlzIGJvb2xlYW5bXSB7XG4gICAgcmV0dXJuIGFyci5ldmVyeSgodik6IHYgaXMgYm9vbGVhbiA9PiB0eXBlb2YgdiA9PT0gJ2Jvb2xlYW4nKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IE1BWF9BVFRSSUJVVEVfU0laRSA9IDQwMDA7XG5cbiAgcHJpdmF0ZSB0b090ZWxBdHRyaWJ1dGVzKGF0dHJzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBBdHRyaWJ1dGVzIHtcbiAgICBpZiAoIWF0dHJzKSByZXR1cm4ge307XG4gICAgY29uc3QgcmVzdWx0OiBBdHRyaWJ1dGVzID0ge307XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhhdHRycykpIHtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZS5sZW5ndGggPiBPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQuTUFYX0FUVFJJQlVURV9TSVpFXG4gICAgICAgICAgPyB2YWx1ZS5zdWJzdHJpbmcoMCwgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kLk1BWF9BVFRSSUJVVEVfU0laRSkgKyAnLi4uW3RydW5jYXRlZF0nXG4gICAgICAgICAgOiB2YWx1ZTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyB8fCB0eXBlb2YgdmFsdWUgPT09ICdib29sZWFuJykge1xuICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWU7XG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIGlmICh2YWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICByZXN1bHRbIGtleSBdID0gW107XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5pc1N0cmluZ0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmlzTnVtYmVyQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXNCb29sZWFuQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB0aGlzLnNhZmVKc29uU3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdFsga2V5IF0gPSB0aGlzLnNhZmVKc29uU3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgc2FmZUpzb25TdHJpbmdpZnkodmFsdWU6IHVua25vd24pOiBzdHJpbmcge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBqc29uID0gSlNPTi5zdHJpbmdpZnkodmFsdWUpO1xuICAgICAgaWYgKGpzb24ubGVuZ3RoID4gT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kLk1BWF9BVFRSSUJVVEVfU0laRSkge1xuICAgICAgICByZXR1cm4ganNvbi5zdWJzdHJpbmcoMCwgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kLk1BWF9BVFRSSUJVVEVfU0laRSkgKyAnLi4uW3RydW5jYXRlZF0nO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGpzb247XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gJ1t1bnNlcmlhbGl6YWJsZV0nO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmFjdGl2ZVNwYW5zLnNpemUgPiAwICYmIHRoaXMuc3BhblN0YXR1c0NvZGUpIHtcbiAgICAgIGxvZ2dlci53YXJuKGBGb3JjZSBlbmRpbmcgJHt0aGlzLmFjdGl2ZVNwYW5zLnNpemV9IGFjdGl2ZSBzcGFuc2ApO1xuICAgICAgY29uc3Qgc3RhdHVzQ29kZSA9IHRoaXMuc3BhblN0YXR1c0NvZGU7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmZvckVhY2goKHNwYW4sIGVudGl0eUlkKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3Bhbi5zZXRTdGF0dXMoe1xuICAgICAgICAgICAgY29kZTogc3RhdHVzQ29kZS5FUlJPUixcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdTcGFuIGZvcmNlLWNsb3NlZCBkdWUgdG8gTGFtYmRhIHNodXRkb3duJyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzcGFuLmVuZCgpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGxvZ2dlci5lcnJvcihgRXJyb3IgZm9yY2UtZW5kaW5nIHNwYW4gJHtlbnRpdHlJZH06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHRoaXMuYWN0aXZlU3BhbnMuY2xlYXIoKTtcbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoJ09URUwgYmFja2VuZCBmbHVzaCBjb21wbGV0ZSAoQURPVCBjb2xsZWN0b3IgaGFuZGxlcyBleHBvcnQpJyk7XG4gIH1cblxuICBkZXN0cm95KCk6IHZvaWQge1xuICAgIHRoaXMuYWN0aXZlU3BhbnMuY2xlYXIoKTtcbiAgfVxufVxuXG4vKiogUmVzZXQgY29sZCBzdGFydCBmbGFnIChmb3IgdGVzdGluZykgKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNldENvbGRTdGFydEZsYWcoKTogdm9pZCB7XG4gIGNvbGRTdGFydEZsYWcgPSB0cnVlO1xufVxuIl19