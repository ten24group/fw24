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
 * ## Architecture
 *
 * Span lifecycle is handled via SpanLifecycleHook (direct calls from SpanObserver),
 * NOT through the buffered capture() pipeline. This ensures:
 * - OTEL spans are opened/closed in real time with correct parent context
 * - No span.start events pollute the buffer or noise reduction pipeline
 * - capture() only handles metrics and logs
 *
 * ## Setup in CDK/SAM
 *
 * ```typescript
 * const fn = new NodejsFunction(this, 'MyFunction', {
 *   layers: [
 *     LayerVersion.fromLayerVersionArn(this, 'AdotLayer',
 *       'arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-amd64-ver-1-30-2:1'
 *     )
 *   ],
 *   environment: {
 *     AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-handler',
 *     OBSERVABILITY_BACKENDS: 'otel',
 *   },
 *   tracing: Tracing.ACTIVE,
 *   bundling: {
 *     externalModules: ['@opentelemetry/*'],
 *   },
 * });
 * ```
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
const propagation_1 = require("../../core/runtime/execution-context/propagation");
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
// ═══════════════════════════════════════════════════════════════════════════
// causedBy link builder (merged from otel-links.ts)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Build OTEL SpanLinks for FW24's cross-invocation causation.
 *
 * FW24 contract:
 * - correlationId: local invocation id (slice)
 * - causedBy: upstream invocation correlationId (cross-invocation link)
 *
 * We model causedBy as an OTEL link (NOT parent-child).
 */
function buildCausedByLinks(correlationId, causedBy) {
    const trimmed = causedBy?.trim();
    if (!trimmed || trimmed === correlationId)
        return [];
    const context = {
        traceId: (0, propagation_1.toW3CTraceId)(trimmed),
        spanId: (0, propagation_1.toW3CParentId)(trimmed),
        traceFlags: 1, // sampled (best-effort)
    };
    return [
        {
            context,
            attributes: {
                'fw24.link.kind': 'causedBy',
                'fw24.caused_by': trimmed,
            },
        },
    ];
}
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
    /**
     * Lambda resource attributes - resolved once from standard AWS Lambda env vars.
     * These are always available in Lambda runtime without custom configuration.
     */
    lambdaAttributes = Object.freeze(Object.fromEntries([
        ['faas.name', process.env.AWS_LAMBDA_FUNCTION_NAME],
        ['faas.version', process.env.AWS_LAMBDA_FUNCTION_VERSION],
        ['faas.instance', process.env.AWS_LAMBDA_LOG_STREAM_NAME],
        ['cloud.region', process.env.AWS_REGION],
    ].filter((entry) => entry[1] != null)));
    constructor(serviceName, minLevel) {
        this.serviceName = serviceName;
        this.minLevel = minLevel;
    }
    async initializeOpenTelemetry() {
        if (this.isOTELAvailable)
            return;
        // Initialize Traces
        try {
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
    /**
     * Synchronous initialization check.
     * Returns true if OTEL was already initialized (for lifecycle hook fast path).
     */
    get isInitialized() {
        return this.isOTELAvailable;
    }
    initializeInvocation() {
        this.invocationCount++;
        if (coldStartFlag) {
            coldStartFlag = false;
            logger.info('Cold start detected', {
                invocation: this.invocationCount,
                coldStart: true,
            });
        }
        if (this.activeSpans.size > 0) {
            logger.warn(`Cleaning up ${this.activeSpans.size} orphaned spans from previous invocation`);
            this.activeSpans.forEach((span, spanId) => {
                try {
                    span.end();
                }
                catch (error) {
                    logger.error(`Error ending orphaned span ${spanId}:`, error);
                }
            });
            this.activeSpans.clear();
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SpanLifecycleHook implementation (direct calls from SpanObserver)
    // ═══════════════════════════════════════════════════════════════════════════
    onSpanStart(info) {
        if (!this.isInitialized || !this.tracer || !this.trace || !this.contextApi)
            return;
        try {
            const isColdStart = this.invocationCount === 1;
            const isRootSpan = !info.parentId;
            let context = this.contextApi.active();
            if (info.parentId) {
                const parentSpan = this.activeSpans.get(info.parentId);
                if (parentSpan) {
                    context = this.trace.setSpan(context, parentSpan);
                }
            }
            const spanAttributes = {
                'service.name': this.serviceName,
                'fw24.correlation_id': info.correlationId,
                'fw24.invocation': this.invocationCount,
                'fw24.span_id': info.id,
            };
            if (isRootSpan) {
                spanAttributes['coldStart'] = isColdStart;
            }
            if (info.parentId)
                spanAttributes['fw24.parent_observability_log_id'] = info.parentId;
            if (info.source)
                spanAttributes['code.function'] = info.source;
            if (info.tags) {
                Object.assign(spanAttributes, this.toOtelAttributes(info.tags));
            }
            // Lambda resource attributes (resolved once at construction, no per-span env lookups)
            Object.assign(spanAttributes, this.lambdaAttributes);
            const span = this.tracer.startSpan(info.operation, {
                kind: (0, span_utils_1.getSpanKind)(info.subType),
                attributes: spanAttributes,
                startTime: info.startTimeMs,
                links: buildCausedByLinks(info.correlationId, info.causedBy),
            }, context);
            this.activeSpans.set(info.id, span);
            logger.debug(`Created OTEL span: ${info.operation} (${info.id})`);
        }
        catch (error) {
            logger.error('Error creating OTEL span:', error);
        }
    }
    onSpanEnd(info) {
        if (!this.isInitialized || !this.spanStatusCode)
            return;
        const existingSpan = this.activeSpans.get(info.id);
        if (!existingSpan) {
            // Span may not have been created (e.g., OTEL wasn't initialized at start time).
            // Create a one-shot span from the end info.
            this.createOneShotSpan(info);
            return;
        }
        try {
            const statusCode = this.spanStatusCode;
            const endTime = info.startTimeMs + info.durationMs;
            // Update attributes
            if (info.tags) {
                existingSpan.setAttributes(this.toOtelAttributes(info.tags));
            }
            if (info.metrics) {
                for (const [key, value] of Object.entries(info.metrics)) {
                    existingSpan.setAttribute(`metric.${key}`, value);
                }
            }
            existingSpan.setAttribute('duration_ms', info.durationMs);
            // Add checkpoints as OTEL events
            if (info.data) {
                const checkpoints = info.data.checkpoints;
                if (Array.isArray(checkpoints)) {
                    for (const cp of checkpoints) {
                        this.addCheckpointEvent(existingSpan, cp);
                    }
                }
            }
            // Set status
            if (info.error) {
                existingSpan.setStatus({
                    code: statusCode.ERROR,
                    message: info.error.message ?? 'Error',
                });
                existingSpan.recordException({
                    name: info.error.type,
                    message: info.error.message,
                    stack: info.error.stack,
                });
            }
            else if (!info.success) {
                existingSpan.setStatus({ code: statusCode.ERROR, message: 'Failed' });
            }
            else {
                existingSpan.setStatus({ code: statusCode.OK });
            }
            existingSpan.end(endTime);
            this.activeSpans.delete(info.id);
            logger.debug(`Ended OTEL span: ${info.operation} (${info.id})`);
        }
        catch (error) {
            logger.warn('Failed to end OTEL span:', error);
        }
    }
    /**
     * Fallback: create a span from end info alone (for late-init scenarios).
     * Mirrors onSpanStart attributes as closely as possible from SpanEndInfo.
     */
    createOneShotSpan(info) {
        if (!this.tracer || !this.trace || !this.contextApi || !this.spanStatusCode)
            return;
        try {
            const statusCode = this.spanStatusCode;
            const endTime = info.startTimeMs + info.durationMs;
            // Build context for parent span linking
            let context = this.contextApi.active();
            if (info.parentId) {
                const parentSpan = this.activeSpans.get(info.parentId);
                if (parentSpan) {
                    context = this.trace.setSpan(context, parentSpan);
                }
            }
            const spanAttributes = {
                'service.name': this.serviceName,
                'fw24.span_id': info.id,
                'fw24.correlation_id': info.correlationId,
                'fw24.invocation': this.invocationCount,
                'fw24.one_shot': true,
                'duration_ms': info.durationMs,
            };
            if (info.parentId)
                spanAttributes['fw24.parent_observability_log_id'] = info.parentId;
            if (info.source)
                spanAttributes['code.function'] = info.source;
            // Lambda resource attributes (resolved once at construction)
            Object.assign(spanAttributes, this.lambdaAttributes);
            if (info.tags) {
                Object.assign(spanAttributes, this.toOtelAttributes(info.tags));
            }
            if (info.metrics) {
                for (const [key, value] of Object.entries(info.metrics)) {
                    spanAttributes[`metric.${key}`] = value;
                }
            }
            const span = this.tracer.startSpan(info.operation, {
                kind: (0, span_utils_1.getSpanKind)(info.subType),
                startTime: info.startTimeMs,
                attributes: spanAttributes,
                links: buildCausedByLinks(info.correlationId, info.causedBy),
            }, context);
            // Add checkpoints
            if (info.data) {
                const checkpoints = info.data.checkpoints;
                if (Array.isArray(checkpoints)) {
                    for (const cp of checkpoints) {
                        this.addCheckpointEvent(span, cp);
                    }
                }
            }
            // Set status and end
            if (info.error) {
                span.setStatus({ code: statusCode.ERROR, message: info.error.message ?? 'Error' });
                span.recordException({
                    name: info.error.type,
                    message: info.error.message,
                    stack: info.error.stack,
                });
            }
            else if (!info.success) {
                span.setStatus({ code: statusCode.ERROR, message: 'Failed' });
            }
            else {
                span.setStatus({ code: statusCode.OK });
            }
            span.end(endTime);
            logger.debug(`Created one-shot OTEL span: ${info.operation} (${info.id})`);
        }
        catch (error) {
            logger.warn('Failed to create one-shot OTEL span:', error);
        }
    }
    addCheckpointEvent(span, cp) {
        const checkpoint = cp;
        const name = typeof checkpoint.name === 'string' ? checkpoint.name : 'checkpoint';
        const ts = typeof checkpoint.ts === 'number' ? checkpoint.ts : undefined;
        const attrs = {};
        if (checkpoint.tags && typeof checkpoint.tags === 'object')
            attrs['fw24.checkpoint.tags'] = JSON.stringify(checkpoint.tags);
        if (checkpoint.metrics && typeof checkpoint.metrics === 'object')
            attrs['fw24.checkpoint.metrics'] = JSON.stringify(checkpoint.metrics);
        if (checkpoint.data && typeof checkpoint.data === 'object')
            attrs['fw24.checkpoint.data'] = JSON.stringify(checkpoint.data);
        if (checkpoint.error && typeof checkpoint.error === 'object')
            attrs['fw24.checkpoint.error'] = JSON.stringify(checkpoint.error);
        span.addEvent(name, attrs, ts);
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // capture() - Only handles metrics and logs (spans use lifecycle hooks)
    // ═══════════════════════════════════════════════════════════════════════════
    async capture(event) {
        await this.ensureInitialized();
        const type = event.type;
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
        // span and span.start are no longer handled here - they use SpanLifecycleHook
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Metric handling
    // ═══════════════════════════════════════════════════════════════════════════
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
    // ═══════════════════════════════════════════════════════════════════════════
    // Log handling
    // ═══════════════════════════════════════════════════════════════════════════
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
    // ═══════════════════════════════════════════════════════════════════════════
    // Utility methods
    // ═══════════════════════════════════════════════════════════════════════════
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
                else if (value.every((v) => typeof v === 'string')) {
                    result[key] = value;
                }
                else if (value.every((v) => typeof v === 'number')) {
                    result[key] = value;
                }
                else if (value.every((v) => typeof v === 'boolean')) {
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
            this.activeSpans.forEach((span, spanId) => {
                try {
                    span.setStatus({
                        code: statusCode.ERROR,
                        message: 'Span force-closed due to Lambda shutdown',
                    });
                    span.end();
                }
                catch (error) {
                    logger.error(`Error force-ending span ${spanId}:`, error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL290ZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0NHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBZ29CSCxnREFFQztBQWhvQkQsaUNBQW9EO0FBVXBELDJDQUE2QztBQUM3QyxvREFBa0Q7QUFDbEQsa0ZBQStGO0FBTy9GLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQywwQkFBMEIsQ0FBQyxDQUFDO0FBRXhELCtCQUErQjtBQUMvQixJQUFJLGFBQWEsR0FBRyxJQUFJLENBQUM7QUFFekIsaUNBQWlDO0FBQ2pDLE1BQU0scUJBQXFCLEdBQXVEO0lBQ2hGLEtBQUssRUFBRSxDQUFDLEVBQUksUUFBUTtJQUNwQixLQUFLLEVBQUUsQ0FBQyxFQUFJLFFBQVE7SUFDcEIsSUFBSSxFQUFFLENBQUMsRUFBSyxPQUFPO0lBQ25CLElBQUksRUFBRSxFQUFFLEVBQUksT0FBTztJQUNuQixLQUFLLEVBQUUsRUFBRSxFQUFHLFFBQVE7SUFDcEIsUUFBUSxFQUFFLEVBQUUsRUFBRSxRQUFRO0NBQ3ZCLENBQUM7QUFFRiw4RUFBOEU7QUFDOUUsb0RBQW9EO0FBQ3BELDhFQUE4RTtBQUU5RTs7Ozs7Ozs7R0FRRztBQUNILFNBQVMsa0JBQWtCLENBQUMsYUFBcUIsRUFBRSxRQUE0QjtJQUM3RSxNQUFNLE9BQU8sR0FBRyxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDakMsSUFBSSxDQUFDLE9BQU8sSUFBSSxPQUFPLEtBQUssYUFBYTtRQUFFLE9BQU8sRUFBRSxDQUFDO0lBRXJELE1BQU0sT0FBTyxHQUFnQjtRQUMzQixPQUFPLEVBQUUsSUFBQSwwQkFBWSxFQUFDLE9BQU8sQ0FBQztRQUM5QixNQUFN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Q0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMzQixDQUFDO1FBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyw2REFBNkQsQ0FBQyxDQUFDO0lBQzlFLENBQUM7SUFFRCxPQUFPO1FBQ0wsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUMzQixDQUFDOztBQWpqQlUsNERBQXdCO21DQUF4Qix3QkFBd0I7SUFMcEMsSUFBQSxlQUFVLEVBQUM7UUFDVixPQUFPLEVBQUUsc0JBQXNCO1FBQy9CLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUksRUFBRSxDQUFDLGVBQWUsRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDO0tBQzNDLENBQUM7SUEyQ0csV0FBQSxJQUFBLGlCQUFZLEVBQUMsMkJBQTJCLENBQUMsQ0FBQTtJQUN6QyxXQUFBLElBQUEsaUJBQVksRUFBQyx3QkFBd0IsQ0FBQyxDQUFBO0dBM0M5Qix3QkFBd0IsQ0FrakJwQztBQUVELDBDQUEwQztBQUMxQyxTQUFnQixrQkFBa0I7SUFDaEMsYUFBYSxHQUFHLElBQUksQ0FBQztBQUN2QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPcGVuVGVsZW1ldHJ5IEJhY2tlbmQgZm9yIEFXUyBYLVJheSBJbnRlZ3JhdGlvblxuICogXG4gKiBJTVBPUlRBTlQ6IFRoaXMgYmFja2VuZCBpcyBkZXNpZ25lZCB0byB3b3JrIHdpdGggQVdTIExhbWJkYSdzIG1hbmFnZWQgQURPVCBsYXllci5cbiAqIFxuICogIyMgV2h5IEFET1QvT3BlblRlbGVtZXRyeSAoTm90IFgtUmF5IFNESylcbiAqIFxuICogQVdTIFgtUmF5IFNESyBpcyBiZWluZyBkZXByZWNhdGVkIChlbmQtb2Ytc3VwcG9ydDogRmViIDI1LCAyMDI3KTpcbiAqIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS94cmF5L2xhdGVzdC9kZXZndWlkZS94cmF5LXNkay1ub2RlanMuaHRtbFxuICogXG4gKiBBV1MgcmVjb21tZW5kcyBtaWdyYXRpbmcgdG8gT3BlblRlbGVtZXRyeTpcbiAqIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS94cmF5L2xhdGVzdC9kZXZndWlkZS94cmF5LWluc3RydW1lbnRpbmcteW91ci1hcHAuaHRtbCN4cmF5LWluc3RydW1lbnRpbmctb3BlbnRlbFxuICogXG4gKiAjIyBBcmNoaXRlY3R1cmVcbiAqIFxuICogU3BhbiBsaWZlY3ljbGUgaXMgaGFuZGxlZCB2aWEgU3BhbkxpZmVjeWNsZUhvb2sgKGRpcmVjdCBjYWxscyBmcm9tIFNwYW5PYnNlcnZlciksXG4gKiBOT1QgdGhyb3VnaCB0aGUgYnVmZmVyZWQgY2FwdHVyZSgpIHBpcGVsaW5lLiBUaGlzIGVuc3VyZXM6XG4gKiAtIE9URUwgc3BhbnMgYXJlIG9wZW5lZC9jbG9zZWQgaW4gcmVhbCB0aW1lIHdpdGggY29ycmVjdCBwYXJlbnQgY29udGV4dFxuICogLSBObyBzcGFuLnN0YXJ0IGV2ZW50cyBwb2xsdXRlIHRoZSBidWZmZXIgb3Igbm9pc2UgcmVkdWN0aW9uIHBpcGVsaW5lXG4gKiAtIGNhcHR1cmUoKSBvbmx5IGhhbmRsZXMgbWV0cmljcyBhbmQgbG9nc1xuICogXG4gKiAjIyBTZXR1cCBpbiBDREsvU0FNXG4gKiBcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGZuID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdNeUZ1bmN0aW9uJywge1xuICogICBsYXllcnM6IFtcbiAqICAgICBMYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybih0aGlzLCAnQWRvdExheWVyJyxcbiAqICAgICAgICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6OTAxOTIwNTcwNDYzOmxheWVyOmF3cy1vdGVsLW5vZGVqcy1hbWQ2NC12ZXItMS0zMC0yOjEnXG4gKiAgICAgKVxuICogICBdLFxuICogICBlbnZpcm9ubWVudDoge1xuICogICAgIEFXU19MQU1CREFfRVhFQ19XUkFQUEVSOiAnL29wdC9vdGVsLWhhbmRsZXInLFxuICogICAgIE9CU0VSVkFCSUxJVFlfQkFDS0VORFM6ICdvdGVsJyxcbiAqICAgfSxcbiAqICAgdHJhY2luZzogVHJhY2luZy5BQ1RJVkUsXG4gKiAgIGJ1bmRsaW5nOiB7XG4gKiAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbJ0BvcGVudGVsZW1ldHJ5LyonXSxcbiAqICAgfSxcbiAqIH0pO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgSW5qZWN0YWJsZSwgSW5qZWN0Q29uZmlnIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHR5cGUge1xuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsXG4gIFNwYW5MaWZlY3ljbGVIb29rLFxuICBTcGFuU3RhcnRJbmZvLFxuICBTcGFuRW5kSW5mbyxcbn0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBnZXRTcGFuS2luZCB9IGZyb20gJy4uL3V0aWxzL3NwYW4tdXRpbHMnO1xuaW1wb3J0IHsgdG9XM0NQYXJlbnRJZCwgdG9XM0NUcmFjZUlkIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3Byb3BhZ2F0aW9uJztcblxuLy8gSW1wb3J0IHR5cGVzIGZyb20gQG9wZW50ZWxlbWV0cnkvYXBpXG5pbXBvcnQgdHlwZSB7IFRyYWNlciwgU3BhbiwgU3BhblN0YXR1c0NvZGUsIFRyYWNlQVBJLCBDb250ZXh0QVBJLCBBdHRyaWJ1dGVzLCBMaW5rLCBTcGFuQ29udGV4dCB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaSc7XG5pbXBvcnQgdHlwZSB7IE1ldGVyIH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB0eXBlIHsgTG9nZ2VyIGFzIE9URUxMb2dnZXIgfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGktbG9ncyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kJyk7XG5cbi8vIE1vZHVsZS1sZXZlbCBjb2xkIHN0YXJ0IGZsYWdcbmxldCBjb2xkU3RhcnRGbGFnID0gdHJ1ZTtcblxuLy8gT1RFTCBTZXZlcml0eSBtYXBwaW5nIGZvciBsb2dzXG5jb25zdCBMT0dfTEVWRUxfVE9fU0VWRVJJVFk6IFJlYWRvbmx5PFJlY29yZDxPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsIG51bWJlcj4+ID0ge1xuICB0cmFjZTogMSwgICAvLyBUUkFDRVxuICBkZWJ1ZzogNSwgICAvLyBERUJVR1xuICBpbmZvOiA5LCAgICAvLyBJTkZPXG4gIHdhcm46IDEzLCAgIC8vIFdBUk5cbiAgZXJyb3I6IDE3LCAgLy8gRVJST1JcbiAgY3JpdGljYWw6IDIxLCAvLyBGQVRBTFxufTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBjYXVzZWRCeSBsaW5rIGJ1aWxkZXIgKG1lcmdlZCBmcm9tIG90ZWwtbGlua3MudHMpXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBCdWlsZCBPVEVMIFNwYW5MaW5rcyBmb3IgRlcyNCdzIGNyb3NzLWludm9jYXRpb24gY2F1c2F0aW9uLlxuICpcbiAqIEZXMjQgY29udHJhY3Q6XG4gKiAtIGNvcnJlbGF0aW9uSWQ6IGxvY2FsIGludm9jYXRpb24gaWQgKHNsaWNlKVxuICogLSBjYXVzZWRCeTogdXBzdHJlYW0gaW52b2NhdGlvbiBjb3JyZWxhdGlvbklkIChjcm9zcy1pbnZvY2F0aW9uIGxpbmspXG4gKlxuICogV2UgbW9kZWwgY2F1c2VkQnkgYXMgYW4gT1RFTCBsaW5rIChOT1QgcGFyZW50LWNoaWxkKS5cbiAqL1xuZnVuY3Rpb24gYnVpbGRDYXVzZWRCeUxpbmtzKGNvcnJlbGF0aW9uSWQ6IHN0cmluZywgY2F1c2VkQnk6IHN0cmluZyB8IHVuZGVmaW5lZCk6IExpbmtbXSB7XG4gIGNvbnN0IHRyaW1tZWQgPSBjYXVzZWRCeT8udHJpbSgpO1xuICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZCA9PT0gY29ycmVsYXRpb25JZCkgcmV0dXJuIFtdO1xuXG4gIGNvbnN0IGNvbnRleHQ6IFNwYW5Db250ZXh0ID0ge1xuICAgIHRyYWNlSWQ6IHRvVzNDVHJhY2VJZCh0cmltbWVkKSxcbiAgICBzcGFuSWQ6IHRvVzNDUGFyZW50SWQodHJpbW1lZCksXG4gICAgdHJhY2VGbGFnczogMSwgLy8gc2FtcGxlZCAoYmVzdC1lZmZvcnQpXG4gIH07XG5cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBjb250ZXh0LFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAnZncyNC5saW5rLmtpbmQnOiAnY2F1c2VkQnknLFxuICAgICAgICAnZncyNC5jYXVzZWRfYnknOiB0cmltbWVkLFxuICAgICAgfSxcbiAgICB9LFxuICBdO1xufVxuXG5ASW5qZWN0YWJsZSh7XG4gIHByb3ZpZGU6ICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gIHByb3ZpZGVkSW46ICdST09UJyxcbiAgdGFnczogWydvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCAnb3RlbCddXG59KVxuZXhwb3J0IGNsYXNzIE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZCBpbXBsZW1lbnRzIE9ic2VydmFiaWxpdHlCYWNrZW5kLCBTcGFuTGlmZWN5Y2xlSG9vayB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ290ZWwnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBzZXJ2aWNlTmFtZTogc3RyaW5nO1xuXG4gIC8vIFRyYWNlIGNvbXBvbmVudHNcbiAgcHJpdmF0ZSB0cmFjZXI6IFRyYWNlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRyYWNlOiBUcmFjZUFQSSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNvbnRleHRBcGk6IENvbnRleHRBUEkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzcGFuU3RhdHVzQ29kZTogdHlwZW9mIFNwYW5TdGF0dXNDb2RlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgYWN0aXZlU3BhbnMgPSBuZXcgTWFwPHN0cmluZywgU3Bhbj4oKTtcblxuICAvLyBNZXRyaWNzIGNvbXBvbmVudFxuICBwcml2YXRlIG1ldGVyOiBNZXRlciB8IG51bGwgPSBudWxsO1xuXG4gIC8vIExvZ3MgY29tcG9uZW50c1xuICBwcml2YXRlIG90ZWxMb2dnZXI6IE9URUxMb2dnZXIgfCBudWxsID0gbnVsbDtcblxuICAvLyBTdGF0ZVxuICBwcml2YXRlIGlzT1RFTEF2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGlzTWV0cmljc0F2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGlzTG9nc0F2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGludm9jYXRpb25Db3VudDogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSBpbml0aWFsaXphdGlvblByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsID0gbnVsbDtcblxuICAvKipcbiAgICogTGFtYmRhIHJlc291cmNlIGF0dHJpYnV0ZXMgLSByZXNvbHZlZCBvbmNlIGZyb20gc3RhbmRhcmQgQVdTIExhbWJkYSBlbnYgdmFycy5cbiAgICogVGhlc2UgYXJlIGFsd2F5cyBhdmFpbGFibGUgaW4gTGFtYmRhIHJ1bnRpbWUgd2l0aG91dCBjdXN0b20gY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgbGFtYmRhQXR0cmlidXRlczogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgc3RyaW5nPj4gPSBPYmplY3QuZnJlZXplKFxuICAgIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIFtcbiAgICAgICAgWydmYWFzLm5hbWUnLCAgICAgcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9OQU1FXSxcbiAgICAgICAgWydmYWFzLnZlcnNpb24nLCAgcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9WRVJTSU9OXSxcbiAgICAgICAgWydmYWFzLmluc3RhbmNlJywgIHByb2Nlc3MuZW52LkFXU19MQU1CREFfTE9HX1NUUkVBTV9OQU1FXSxcbiAgICAgICAgWydjbG91ZC5yZWdpb24nLCAgcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTl0sXG4gICAgICBdLmZpbHRlcigoZW50cnkpOiBlbnRyeSBpcyBbc3RyaW5nLCBzdHJpbmddID0+IGVudHJ5WzFdICE9IG51bGwpXG4gICAgKVxuICApO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkuc2VydmljZU5hbWUnKSBzZXJ2aWNlTmFtZTogc3RyaW5nLFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkubWluTGV2ZWwnKSBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsXG4gICkge1xuICAgIHRoaXMuc2VydmljZU5hbWUgPSBzZXJ2aWNlTmFtZTtcbiAgICB0aGlzLm1pbkxldmVsID0gbWluTGV2ZWw7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVPcGVuVGVsZW1ldHJ5KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmlzT1RFTEF2YWlsYWJsZSkgcmV0dXJuO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBUcmFjZXNcbiAgICB0cnkge1xuICAgICAgY29uc3Qgb3RlbCA9IGF3YWl0IGltcG9ydCgnQG9wZW50ZWxlbWV0cnkvYXBpJyk7XG4gICAgICB0aGlzLnRyYWNlID0gb3RlbC50cmFjZTtcbiAgICAgIHRoaXMuY29udGV4dEFwaSA9IG90ZWwuY29udGV4dDtcbiAgICAgIHRoaXMuc3BhblN0YXR1c0NvZGUgPSBvdGVsLlNwYW5TdGF0dXNDb2RlO1xuXG4gICAgICB0aGlzLnRyYWNlciA9IG90ZWwudHJhY2UuZ2V0VHJhY2VyKFxuICAgICAgICB0aGlzLnNlcnZpY2VOYW1lLFxuICAgICAgICBwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcxLjAuMCdcbiAgICAgICk7XG5cbiAgICAgIHRoaXMuaXNPVEVMQXZhaWxhYmxlID0gdHJ1ZTtcbiAgICAgIGxvZ2dlci5pbmZvKCdPcGVuVGVsZW1ldHJ5IFRyYWNlcyBBUEkgYXZhaWxhYmxlJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaXNPVEVMQXZhaWxhYmxlID0gZmFsc2U7XG4gICAgICBpZiAoIXRoaXMuaW5pdGlhbGl6YXRpb25Qcm9taXNlKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdPcGVuVGVsZW1ldHJ5IFRyYWNlcyBBUEkgbm90IGF2YWlsYWJsZScsIHtcbiAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJbml0aWFsaXplIE1ldHJpY3NcbiAgICB0cnkge1xuICAgICAgY29uc3Qgb3RlbE1ldHJpY3MgPSBhd2FpdCBpbXBvcnQoJ0BvcGVudGVsZW1ldHJ5L2FwaScpO1xuICAgICAgaWYgKG90ZWxNZXRyaWNzLm1ldHJpY3MpIHtcbiAgICAgICAgdGhpcy5tZXRlciA9IG90ZWxNZXRyaWNzLm1ldHJpY3MuZ2V0TWV0ZXIoXG4gICAgICAgICAgdGhpcy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICBwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcxLjAuMCdcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5pc01ldHJpY3NBdmFpbGFibGUgPSB0cnVlO1xuICAgICAgICBsb2dnZXIuaW5mbygnT3BlblRlbGVtZXRyeSBNZXRyaWNzIEFQSSBhdmFpbGFibGUnKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5pc01ldHJpY3NBdmFpbGFibGUgPSBmYWxzZTtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnT3BlblRlbGVtZXRyeSBNZXRyaWNzIEFQSSBub3QgYXZhaWxhYmxlJywge1xuICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSBMb2dzXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG90ZWxMb2dzID0gYXdhaXQgaW1wb3J0KCdAb3BlbnRlbGVtZXRyeS9hcGktbG9ncycpO1xuICAgICAgaWYgKG90ZWxMb2dzLmxvZ3MpIHtcbiAgICAgICAgdGhpcy5vdGVsTG9nZ2VyID0gb3RlbExvZ3MubG9ncy5nZXRMb2dnZXIoXG4gICAgICAgICAgdGhpcy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICBwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcxLjAuMCdcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5pc0xvZ3NBdmFpbGFibGUgPSB0cnVlO1xuICAgICAgICBsb2dnZXIuaW5mbygnT3BlblRlbGVtZXRyeSBMb2dzIEFQSSBhdmFpbGFibGUnKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5pc0xvZ3NBdmFpbGFibGUgPSBmYWxzZTtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnT3BlblRlbGVtZXRyeSBMb2dzIEFQSSBub3QgYXZhaWxhYmxlJywge1xuICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNPVEVMQXZhaWxhYmxlKSB7XG4gICAgICBsb2dnZXIuaW5mbyhgT1RFTCBCYWNrZW5kIGluaXRpYWxpemVkIGZvcjogJHt0aGlzLnNlcnZpY2VOYW1lfWAsIHtcbiAgICAgICAgdHJhY2VzOiB0aGlzLmlzT1RFTEF2YWlsYWJsZSxcbiAgICAgICAgbWV0cmljczogdGhpcy5pc01ldHJpY3NBdmFpbGFibGUsXG4gICAgICAgIGxvZ3M6IHRoaXMuaXNMb2dzQXZhaWxhYmxlLFxuICAgICAgICB4cmF5VHJhY2VJZDogcHJvY2Vzcy5lbnYuX1hfQU1aTl9UUkFDRV9JRCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlSW5pdGlhbGl6ZWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmluaXRpYWxpemF0aW9uUHJvbWlzZSkge1xuICAgICAgdGhpcy5pbml0aWFsaXphdGlvblByb21pc2UgPSB0aGlzLmluaXRpYWxpemVPcGVuVGVsZW1ldHJ5KCk7XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6YXRpb25Qcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFN5bmNocm9ub3VzIGluaXRpYWxpemF0aW9uIGNoZWNrLlxuICAgKiBSZXR1cm5zIHRydWUgaWYgT1RFTCB3YXMgYWxyZWFkeSBpbml0aWFsaXplZCAoZm9yIGxpZmVjeWNsZSBob29rIGZhc3QgcGF0aCkuXG4gICAqL1xuICBwcml2YXRlIGdldCBpc0luaXRpYWxpemVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmlzT1RFTEF2YWlsYWJsZTtcbiAgfVxuXG4gIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIHRoaXMuaW52b2NhdGlvbkNvdW50Kys7XG5cbiAgICBpZiAoY29sZFN0YXJ0RmxhZykge1xuICAgICAgY29sZFN0YXJ0RmxhZyA9IGZhbHNlO1xuICAgICAgbG9nZ2VyLmluZm8oJ0NvbGQgc3RhcnQgZGV0ZWN0ZWQnLCB7XG4gICAgICAgIGludm9jYXRpb246IHRoaXMuaW52b2NhdGlvbkNvdW50LFxuICAgICAgICBjb2xkU3RhcnQ6IHRydWUsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5hY3RpdmVTcGFucy5zaXplID4gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oYENsZWFuaW5nIHVwICR7dGhpcy5hY3RpdmVTcGFucy5zaXplfSBvcnBoYW5lZCBzcGFucyBmcm9tIHByZXZpb3VzIGludm9jYXRpb25gKTtcbiAgICAgIHRoaXMuYWN0aXZlU3BhbnMuZm9yRWFjaCgoc3Bhbiwgc3BhbklkKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3Bhbi5lbmQoKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIGVuZGluZyBvcnBoYW5lZCBzcGFuICR7c3BhbklkfTpgLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5jbGVhcigpO1xuICAgIH1cbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBTcGFuTGlmZWN5Y2xlSG9vayBpbXBsZW1lbnRhdGlvbiAoZGlyZWN0IGNhbGxzIGZyb20gU3Bhbk9ic2VydmVyKVxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBvblNwYW5TdGFydChpbmZvOiBTcGFuU3RhcnRJbmZvKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmlzSW5pdGlhbGl6ZWQgfHwgIXRoaXMudHJhY2VyIHx8ICF0aGlzLnRyYWNlIHx8ICF0aGlzLmNvbnRleHRBcGkpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBpc0NvbGRTdGFydCA9IHRoaXMuaW52b2NhdGlvbkNvdW50ID09PSAxO1xuICAgICAgY29uc3QgaXNSb290U3BhbiA9ICFpbmZvLnBhcmVudElkO1xuXG4gICAgICBsZXQgY29udGV4dCA9IHRoaXMuY29udGV4dEFwaS5hY3RpdmUoKTtcbiAgICAgIGlmIChpbmZvLnBhcmVudElkKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChpbmZvLnBhcmVudElkKTtcbiAgICAgICAgaWYgKHBhcmVudFNwYW4pIHtcbiAgICAgICAgICBjb250ZXh0ID0gdGhpcy50cmFjZS5zZXRTcGFuKGNvbnRleHQsIHBhcmVudFNwYW4pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNwYW5BdHRyaWJ1dGVzOiBBdHRyaWJ1dGVzID0ge1xuICAgICAgICAnc2VydmljZS5uYW1lJzogdGhpcy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgJ2Z3MjQuY29ycmVsYXRpb25faWQnOiBpbmZvLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICdmdzI0Lmludm9jYXRpb24nOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgICAgJ2Z3MjQuc3Bhbl9pZCc6IGluZm8uaWQsXG4gICAgICB9O1xuXG4gICAgICBpZiAoaXNSb290U3Bhbikge1xuICAgICAgICBzcGFuQXR0cmlidXRlc1snY29sZFN0YXJ0J10gPSBpc0NvbGRTdGFydDtcbiAgICAgIH1cblxuICAgICAgaWYgKGluZm8ucGFyZW50SWQpIHNwYW5BdHRyaWJ1dGVzWydmdzI0LnBhcmVudF9vYnNlcnZhYmlsaXR5X2xvZ19pZCddID0gaW5mby5wYXJlbnRJZDtcbiAgICAgIGlmIChpbmZvLnNvdXJjZSkgc3BhbkF0dHJpYnV0ZXNbJ2NvZGUuZnVuY3Rpb24nXSA9IGluZm8uc291cmNlO1xuXG4gICAgICBpZiAoaW5mby50YWdzKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24oc3BhbkF0dHJpYnV0ZXMsIHRoaXMudG9PdGVsQXR0cmlidXRlcyhpbmZvLnRhZ3MgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKTtcbiAgICAgIH1cblxuICAgICAgLy8gTGFtYmRhIHJlc291cmNlIGF0dHJpYnV0ZXMgKHJlc29sdmVkIG9uY2UgYXQgY29uc3RydWN0aW9uLCBubyBwZXItc3BhbiBlbnYgbG9va3VwcylcbiAgICAgIE9iamVjdC5hc3NpZ24oc3BhbkF0dHJpYnV0ZXMsIHRoaXMubGFtYmRhQXR0cmlidXRlcyk7XG5cbiAgICAgIGNvbnN0IHNwYW4gPSB0aGlzLnRyYWNlci5zdGFydFNwYW4oXG4gICAgICAgIGluZm8ub3BlcmF0aW9uLFxuICAgICAgICB7XG4gICAgICAgICAga2luZDogZ2V0U3BhbktpbmQoaW5mby5zdWJUeXBlKSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiBzcGFuQXR0cmlidXRlcyxcbiAgICAgICAgICBzdGFydFRpbWU6IGluZm8uc3RhcnRUaW1lTXMsXG4gICAgICAgICAgbGlua3M6IGJ1aWxkQ2F1c2VkQnlMaW5rcyhpbmZvLmNvcnJlbGF0aW9uSWQsIGluZm8uY2F1c2VkQnkpLFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0LFxuICAgICAgKTtcblxuICAgICAgdGhpcy5hY3RpdmVTcGFucy5zZXQoaW5mby5pZCwgc3Bhbik7XG4gICAgICBsb2dnZXIuZGVidWcoYENyZWF0ZWQgT1RFTCBzcGFuOiAke2luZm8ub3BlcmF0aW9ufSAoJHtpbmZvLmlkfSlgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdFcnJvciBjcmVhdGluZyBPVEVMIHNwYW46JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIG9uU3BhbkVuZChpbmZvOiBTcGFuRW5kSW5mbyk6IHZvaWQge1xuICAgIGlmICghdGhpcy5pc0luaXRpYWxpemVkIHx8ICF0aGlzLnNwYW5TdGF0dXNDb2RlKSByZXR1cm47XG5cbiAgICBjb25zdCBleGlzdGluZ1NwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChpbmZvLmlkKTtcbiAgICBpZiAoIWV4aXN0aW5nU3Bhbikge1xuICAgICAgLy8gU3BhbiBtYXkgbm90IGhhdmUgYmVlbiBjcmVhdGVkIChlLmcuLCBPVEVMIHdhc24ndCBpbml0aWFsaXplZCBhdCBzdGFydCB0aW1lKS5cbiAgICAgIC8vIENyZWF0ZSBhIG9uZS1zaG90IHNwYW4gZnJvbSB0aGUgZW5kIGluZm8uXG4gICAgICB0aGlzLmNyZWF0ZU9uZVNob3RTcGFuKGluZm8pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0dXNDb2RlID0gdGhpcy5zcGFuU3RhdHVzQ29kZTtcbiAgICAgIGNvbnN0IGVuZFRpbWUgPSBpbmZvLnN0YXJ0VGltZU1zICsgaW5mby5kdXJhdGlvbk1zO1xuXG4gICAgICAvLyBVcGRhdGUgYXR0cmlidXRlc1xuICAgICAgaWYgKGluZm8udGFncykge1xuICAgICAgICBleGlzdGluZ1NwYW4uc2V0QXR0cmlidXRlcyh0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoaW5mby50YWdzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSk7XG4gICAgICB9XG4gICAgICBpZiAoaW5mby5tZXRyaWNzKSB7XG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGluZm8ubWV0cmljcykpIHtcbiAgICAgICAgICBleGlzdGluZ1NwYW4uc2V0QXR0cmlidXRlKGBtZXRyaWMuJHtrZXl9YCwgdmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBleGlzdGluZ1NwYW4uc2V0QXR0cmlidXRlKCdkdXJhdGlvbl9tcycsIGluZm8uZHVyYXRpb25Ncyk7XG5cbiAgICAgIC8vIEFkZCBjaGVja3BvaW50cyBhcyBPVEVMIGV2ZW50c1xuICAgICAgaWYgKGluZm8uZGF0YSkge1xuICAgICAgICBjb25zdCBjaGVja3BvaW50cyA9IChpbmZvLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmNoZWNrcG9pbnRzO1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjaGVja3BvaW50cykpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNwIG9mIGNoZWNrcG9pbnRzKSB7XG4gICAgICAgICAgICB0aGlzLmFkZENoZWNrcG9pbnRFdmVudChleGlzdGluZ1NwYW4sIGNwKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gU2V0IHN0YXR1c1xuICAgICAgaWYgKGluZm8uZXJyb3IpIHtcbiAgICAgICAgZXhpc3RpbmdTcGFuLnNldFN0YXR1cyh7XG4gICAgICAgICAgY29kZTogc3RhdHVzQ29kZS5FUlJPUixcbiAgICAgICAgICBtZXNzYWdlOiBpbmZvLmVycm9yLm1lc3NhZ2UgPz8gJ0Vycm9yJyxcbiAgICAgICAgfSk7XG4gICAgICAgIGV4aXN0aW5nU3Bhbi5yZWNvcmRFeGNlcHRpb24oe1xuICAgICAgICAgIG5hbWU6IGluZm8uZXJyb3IudHlwZSxcbiAgICAgICAgICBtZXNzYWdlOiBpbmZvLmVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgc3RhY2s6IGluZm8uZXJyb3Iuc3RhY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmICghaW5mby5zdWNjZXNzKSB7XG4gICAgICAgIGV4aXN0aW5nU3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBzdGF0dXNDb2RlLkVSUk9SLCBtZXNzYWdlOiAnRmFpbGVkJyB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4aXN0aW5nU3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBzdGF0dXNDb2RlLk9LIH0pO1xuICAgICAgfVxuXG4gICAgICBleGlzdGluZ1NwYW4uZW5kKGVuZFRpbWUpO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5kZWxldGUoaW5mby5pZCk7XG4gICAgICBsb2dnZXIuZGVidWcoYEVuZGVkIE9URUwgc3BhbjogJHtpbmZvLm9wZXJhdGlvbn0gKCR7aW5mby5pZH0pYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gZW5kIE9URUwgc3BhbjonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZhbGxiYWNrOiBjcmVhdGUgYSBzcGFuIGZyb20gZW5kIGluZm8gYWxvbmUgKGZvciBsYXRlLWluaXQgc2NlbmFyaW9zKS5cbiAgICogTWlycm9ycyBvblNwYW5TdGFydCBhdHRyaWJ1dGVzIGFzIGNsb3NlbHkgYXMgcG9zc2libGUgZnJvbSBTcGFuRW5kSW5mby5cbiAgICovXG4gIHByaXZhdGUgY3JlYXRlT25lU2hvdFNwYW4oaW5mbzogU3BhbkVuZEluZm8pOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMudHJhY2VyIHx8ICF0aGlzLnRyYWNlIHx8ICF0aGlzLmNvbnRleHRBcGkgfHwgIXRoaXMuc3BhblN0YXR1c0NvZGUpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0dXNDb2RlID0gdGhpcy5zcGFuU3RhdHVzQ29kZTtcbiAgICAgIGNvbnN0IGVuZFRpbWUgPSBpbmZvLnN0YXJ0VGltZU1zICsgaW5mby5kdXJhdGlvbk1zO1xuXG4gICAgICAvLyBCdWlsZCBjb250ZXh0IGZvciBwYXJlbnQgc3BhbiBsaW5raW5nXG4gICAgICBsZXQgY29udGV4dCA9IHRoaXMuY29udGV4dEFwaS5hY3RpdmUoKTtcbiAgICAgIGlmIChpbmZvLnBhcmVudElkKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChpbmZvLnBhcmVudElkKTtcbiAgICAgICAgaWYgKHBhcmVudFNwYW4pIHtcbiAgICAgICAgICBjb250ZXh0ID0gdGhpcy50cmFjZS5zZXRTcGFuKGNvbnRleHQsIHBhcmVudFNwYW4pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNwYW5BdHRyaWJ1dGVzOiBBdHRyaWJ1dGVzID0ge1xuICAgICAgICAnc2VydmljZS5uYW1lJzogdGhpcy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgJ2Z3MjQuc3Bhbl9pZCc6IGluZm8uaWQsXG4gICAgICAgICdmdzI0LmNvcnJlbGF0aW9uX2lkJzogaW5mby5jb3JyZWxhdGlvbklkLFxuICAgICAgICAnZncyNC5pbnZvY2F0aW9uJzogdGhpcy5pbnZvY2F0aW9uQ291bnQsXG4gICAgICAgICdmdzI0Lm9uZV9zaG90JzogdHJ1ZSxcbiAgICAgICAgJ2R1cmF0aW9uX21zJzogaW5mby5kdXJhdGlvbk1zLFxuICAgICAgfTtcblxuICAgICAgaWYgKGluZm8ucGFyZW50SWQpIHNwYW5BdHRyaWJ1dGVzWydmdzI0LnBhcmVudF9vYnNlcnZhYmlsaXR5X2xvZ19pZCddID0gaW5mby5wYXJlbnRJZDtcbiAgICAgIGlmIChpbmZvLnNvdXJjZSkgc3BhbkF0dHJpYnV0ZXNbJ2NvZGUuZnVuY3Rpb24nXSA9IGluZm8uc291cmNlO1xuXG4gICAgICAvLyBMYW1iZGEgcmVzb3VyY2UgYXR0cmlidXRlcyAocmVzb2x2ZWQgb25jZSBhdCBjb25zdHJ1Y3Rpb24pXG4gICAgICBPYmplY3QuYXNzaWduKHNwYW5BdHRyaWJ1dGVzLCB0aGlzLmxhbWJkYUF0dHJpYnV0ZXMpO1xuXG4gICAgICBpZiAoaW5mby50YWdzKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24oc3BhbkF0dHJpYnV0ZXMsIHRoaXMudG9PdGVsQXR0cmlidXRlcyhpbmZvLnRhZ3MgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKTtcbiAgICAgIH1cbiAgICAgIGlmIChpbmZvLm1ldHJpY3MpIHtcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoaW5mby5tZXRyaWNzKSkge1xuICAgICAgICAgIHNwYW5BdHRyaWJ1dGVzW2BtZXRyaWMuJHtrZXl9YF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzcGFuID0gdGhpcy50cmFjZXIuc3RhcnRTcGFuKFxuICAgICAgICBpbmZvLm9wZXJhdGlvbixcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6IGdldFNwYW5LaW5kKGluZm8uc3ViVHlwZSksXG4gICAgICAgICAgc3RhcnRUaW1lOiBpbmZvLnN0YXJ0VGltZU1zLFxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHNwYW5BdHRyaWJ1dGVzLFxuICAgICAgICAgIGxpbmtzOiBidWlsZENhdXNlZEJ5TGlua3MoaW5mby5jb3JyZWxhdGlvbklkLCBpbmZvLmNhdXNlZEJ5KSxcbiAgICAgICAgfSxcbiAgICAgICAgY29udGV4dCxcbiAgICAgICk7XG5cbiAgICAgIC8vIEFkZCBjaGVja3BvaW50c1xuICAgICAgaWYgKGluZm8uZGF0YSkge1xuICAgICAgICBjb25zdCBjaGVja3BvaW50cyA9IChpbmZvLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmNoZWNrcG9pbnRzO1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjaGVja3BvaW50cykpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNwIG9mIGNoZWNrcG9pbnRzKSB7XG4gICAgICAgICAgICB0aGlzLmFkZENoZWNrcG9pbnRFdmVudChzcGFuLCBjcCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFNldCBzdGF0dXMgYW5kIGVuZFxuICAgICAgaWYgKGluZm8uZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBzdGF0dXNDb2RlLkVSUk9SLCBtZXNzYWdlOiBpbmZvLmVycm9yLm1lc3NhZ2UgPz8gJ0Vycm9yJyB9KTtcbiAgICAgICAgc3Bhbi5yZWNvcmRFeGNlcHRpb24oe1xuICAgICAgICAgIG5hbWU6IGluZm8uZXJyb3IudHlwZSxcbiAgICAgICAgICBtZXNzYWdlOiBpbmZvLmVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgc3RhY2s6IGluZm8uZXJyb3Iuc3RhY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmICghaW5mby5zdWNjZXNzKSB7XG4gICAgICAgIHNwYW4uc2V0U3RhdHVzKHsgY29kZTogc3RhdHVzQ29kZS5FUlJPUiwgbWVzc2FnZTogJ0ZhaWxlZCcgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGFuLnNldFN0YXR1cyh7IGNvZGU6IHN0YXR1c0NvZGUuT0sgfSk7XG4gICAgICB9XG5cbiAgICAgIHNwYW4uZW5kKGVuZFRpbWUpO1xuICAgICAgbG9nZ2VyLmRlYnVnKGBDcmVhdGVkIG9uZS1zaG90IE9URUwgc3BhbjogJHtpbmZvLm9wZXJhdGlvbn0gKCR7aW5mby5pZH0pYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gY3JlYXRlIG9uZS1zaG90IE9URUwgc3BhbjonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRDaGVja3BvaW50RXZlbnQoc3BhbjogU3BhbiwgY3A6IHVua25vd24pOiB2b2lkIHtcbiAgICBjb25zdCBjaGVja3BvaW50ID0gY3AgYXMgeyBuYW1lPzogdW5rbm93bjsgdHM/OiB1bmtub3duOyB0YWdzPzogdW5rbm93bjsgbWV0cmljcz86IHVua25vd247IGRhdGE/OiB1bmtub3duOyBlcnJvcj86IHVua25vd24gfTtcbiAgICBjb25zdCBuYW1lID0gdHlwZW9mIGNoZWNrcG9pbnQubmFtZSA9PT0gJ3N0cmluZycgPyBjaGVja3BvaW50Lm5hbWUgOiAnY2hlY2twb2ludCc7XG4gICAgY29uc3QgdHMgPSB0eXBlb2YgY2hlY2twb2ludC50cyA9PT0gJ251bWJlcicgPyBjaGVja3BvaW50LnRzIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGF0dHJzOiBBdHRyaWJ1dGVzID0ge307XG4gICAgaWYgKGNoZWNrcG9pbnQudGFncyAmJiB0eXBlb2YgY2hlY2twb2ludC50YWdzID09PSAnb2JqZWN0JykgYXR0cnNbJ2Z3MjQuY2hlY2twb2ludC50YWdzJ10gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50LnRhZ3MpO1xuICAgIGlmIChjaGVja3BvaW50Lm1ldHJpY3MgJiYgdHlwZW9mIGNoZWNrcG9pbnQubWV0cmljcyA9PT0gJ29iamVjdCcpIGF0dHJzWydmdzI0LmNoZWNrcG9pbnQubWV0cmljcyddID0gSlNPTi5zdHJpbmdpZnkoY2hlY2twb2ludC5tZXRyaWNzKTtcbiAgICBpZiAoY2hlY2twb2ludC5kYXRhICYmIHR5cGVvZiBjaGVja3BvaW50LmRhdGEgPT09ICdvYmplY3QnKSBhdHRyc1snZncyNC5jaGVja3BvaW50LmRhdGEnXSA9IEpTT04uc3RyaW5naWZ5KGNoZWNrcG9pbnQuZGF0YSk7XG4gICAgaWYgKGNoZWNrcG9pbnQuZXJyb3IgJiYgdHlwZW9mIGNoZWNrcG9pbnQuZXJyb3IgPT09ICdvYmplY3QnKSBhdHRyc1snZncyNC5jaGVja3BvaW50LmVycm9yJ10gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50LmVycm9yKTtcbiAgICBzcGFuLmFkZEV2ZW50KG5hbWUsIGF0dHJzLCB0cyk7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gY2FwdHVyZSgpIC0gT25seSBoYW5kbGVzIG1ldHJpY3MgYW5kIGxvZ3MgKHNwYW5zIHVzZSBsaWZlY3ljbGUgaG9va3MpXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGFzeW5jIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKTtcblxuICAgIGNvbnN0IHR5cGUgPSBldmVudC50eXBlO1xuXG4gICAgaWYgKHR5cGUgPT09ICdtZXRyaWMnKSB7XG4gICAgICBpZiAoIXRoaXMuaXNNZXRyaWNzQXZhaWxhYmxlKSByZXR1cm47XG4gICAgICB0aGlzLmhhbmRsZU1ldHJpY0V2ZW50KGV2ZW50KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ2xvZycpIHtcbiAgICAgIGlmICghdGhpcy5pc0xvZ3NBdmFpbGFibGUpIHJldHVybjtcbiAgICAgIHRoaXMuaGFuZGxlTG9nRXZlbnQoZXZlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIHNwYW4gYW5kIHNwYW4uc3RhcnQgYXJlIG5vIGxvbmdlciBoYW5kbGVkIGhlcmUgLSB0aGV5IHVzZSBTcGFuTGlmZWN5Y2xlSG9va1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIE1ldHJpYyBoYW5kbGluZ1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBwcml2YXRlIGhhbmRsZU1ldHJpY0V2ZW50KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubWV0ZXIgfHwgIWV2ZW50Lm1ldHJpY3MpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBtZXRyaWNUeXBlID0gZXZlbnQuc3ViVHlwZSB8fCAnY291bnRlcic7XG4gICAgICBjb25zdCBhdHRycyA9IHRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKTtcblxuICAgICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpKSB7XG4gICAgICAgIHN3aXRjaCAobWV0cmljVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ2NvdW50ZXInOlxuICAgICAgICAgICAgaWYgKHZhbHVlIDwgMCkge1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZVVwRG93bkNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZUNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ2dhdWdlJzpcbiAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlR2F1Z2UobmFtZSkucmVjb3JkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ3RpbWluZyc6XG4gICAgICAgICAgY2FzZSAnaGlzdG9ncmFtJzpcbiAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlSGlzdG9ncmFtKG5hbWUpLnJlY29yZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgaWYgKHZhbHVlID49IDApIHtcbiAgICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVDb3VudGVyKG5hbWUpLmFkZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVVcERvd25Db3VudGVyKG5hbWUpLmFkZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRXJyb3IgcmVjb3JkaW5nIE9wZW5UZWxlbWV0cnkgbWV0cmljOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gTG9nIGhhbmRsaW5nXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIHByaXZhdGUgaGFuZGxlTG9nRXZlbnQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5vdGVsTG9nZ2VyKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc2V2ZXJpdHkgPSBMT0dfTEVWRUxfVE9fU0VWRVJJVFlbZXZlbnQubGV2ZWxdIHx8IDk7XG4gICAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5leHRyYWN0TG9nTWVzc2FnZShldmVudCk7XG5cbiAgICAgIGNvbnN0IGxvZ0F0dHJpYnV0ZXM6IEF0dHJpYnV0ZXMgPSB7XG4gICAgICAgIC4uLnRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKSxcbiAgICAgICAgLi4udGhpcy50b090ZWxBdHRyaWJ1dGVzKGV2ZW50LmRhdGEpLFxuICAgICAgICAnZncyNC5jb3JyZWxhdGlvbl9pZCc6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICdmdzI0Lm9ic2VydmFiaWxpdHlfbG9nX2lkJzogZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgfTtcblxuICAgICAgaWYgKGV2ZW50LnNvdXJjZSkgbG9nQXR0cmlidXRlc1snZncyNC5zb3VyY2UnXSA9IGV2ZW50LnNvdXJjZTtcblxuICAgICAgaWYgKGV2ZW50LmVycm9yKSB7XG4gICAgICAgIGlmIChldmVudC5lcnJvci50eXBlKSBsb2dBdHRyaWJ1dGVzWydleGNlcHRpb24udHlwZSddID0gZXZlbnQuZXJyb3IudHlwZTtcbiAgICAgICAgaWYgKGV2ZW50LmVycm9yLm1lc3NhZ2UpIGxvZ0F0dHJpYnV0ZXNbJ2V4Y2VwdGlvbi5tZXNzYWdlJ10gPSBldmVudC5lcnJvci5tZXNzYWdlO1xuICAgICAgICBpZiAoZXZlbnQuZXJyb3Iuc3RhY2spIGxvZ0F0dHJpYnV0ZXNbJ2V4Y2VwdGlvbi5zdGFja3RyYWNlJ10gPSBldmVudC5lcnJvci5zdGFjaztcbiAgICAgIH1cblxuICAgICAgdGhpcy5vdGVsTG9nZ2VyLmVtaXQoe1xuICAgICAgICBzZXZlcml0eU51bWJlcjogc2V2ZXJpdHksXG4gICAgICAgIHNldmVyaXR5VGV4dDogZXZlbnQubGV2ZWwudG9VcHBlckNhc2UoKSxcbiAgICAgICAgYm9keTogbWVzc2FnZSxcbiAgICAgICAgYXR0cmlidXRlczogbG9nQXR0cmlidXRlcyxcbiAgICAgICAgdGltZXN0YW1wOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgIH0pO1xuXG4gICAgICBsb2dnZXIuZGVidWcoYEVtaXR0ZWQgT1RFTCBsb2c6ICR7ZXZlbnQubGV2ZWx9IC0gJHtldmVudC5vcGVyYXRpb259YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRXJyb3IgZW1pdHRpbmcgT3BlblRlbGVtZXRyeSBsb2c6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdExvZ01lc3NhZ2UoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHN0cmluZyB7XG4gICAgaWYgKGV2ZW50LmRhdGEgJiYgdHlwZW9mIGV2ZW50LmRhdGEubWVzc2FnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBldmVudC5kYXRhLm1lc3NhZ2U7XG4gICAgfVxuICAgIHJldHVybiBldmVudC5vcGVyYXRpb24gfHwgJ2xvZyc7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gVXRpbGl0eSBtZXRob2RzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IE1BWF9BVFRSSUJVVEVfU0laRSA9IDQwMDA7XG5cbiAgcHJpdmF0ZSB0b090ZWxBdHRyaWJ1dGVzKGF0dHJzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBBdHRyaWJ1dGVzIHtcbiAgICBpZiAoIWF0dHJzKSByZXR1cm4ge307XG4gICAgY29uc3QgcmVzdWx0OiBBdHRyaWJ1dGVzID0ge307XG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cnMpKSB7XG4gICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXN1bHRba2V5XSA9IHZhbHVlLmxlbmd0aCA+IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkVcbiAgICAgICAgICA/IHZhbHVlLnN1YnN0cmluZygwLCBPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQuTUFYX0FUVFJJQlVURV9TSVpFKSArICcuLi5bdHJ1bmNhdGVkXSdcbiAgICAgICAgICA6IHZhbHVlO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInIHx8IHR5cGVvZiB2YWx1ZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIGlmICh2YWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICByZXN1bHRba2V5XSA9IFtdO1xuICAgICAgICB9IGVsc2UgaWYgKHZhbHVlLmV2ZXJ5KCh2KTogdiBpcyBzdHJpbmcgPT4gdHlwZW9mIHYgPT09ICdzdHJpbmcnKSkge1xuICAgICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgICAgIH0gZWxzZSBpZiAodmFsdWUuZXZlcnkoKHYpOiB2IGlzIG51bWJlciA9PiB0eXBlb2YgdiA9PT0gJ251bWJlcicpKSB7XG4gICAgICAgICAgcmVzdWx0W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh2YWx1ZS5ldmVyeSgodik6IHYgaXMgYm9vbGVhbiA9PiB0eXBlb2YgdiA9PT0gJ2Jvb2xlYW4nKSkge1xuICAgICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0W2tleV0gPSB0aGlzLnNhZmVKc29uU3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdFtrZXldID0gdGhpcy5zYWZlSnNvblN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIHNhZmVKc29uU3RyaW5naWZ5KHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QganNvbiA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgIGlmIChqc29uLmxlbmd0aCA+IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpIHtcbiAgICAgICAgcmV0dXJuIGpzb24uc3Vic3RyaW5nKDAsIE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpICsgJy4uLlt0cnVuY2F0ZWRdJztcbiAgICAgIH1cbiAgICAgIHJldHVybiBqc29uO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuICdbdW5zZXJpYWxpemFibGVdJztcbiAgICB9XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5hY3RpdmVTcGFucy5zaXplID4gMCAmJiB0aGlzLnNwYW5TdGF0dXNDb2RlKSB7XG4gICAgICBsb2dnZXIud2FybihgRm9yY2UgZW5kaW5nICR7dGhpcy5hY3RpdmVTcGFucy5zaXplfSBhY3RpdmUgc3BhbnNgKTtcbiAgICAgIGNvbnN0IHN0YXR1c0NvZGUgPSB0aGlzLnNwYW5TdGF0dXNDb2RlO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5mb3JFYWNoKChzcGFuLCBzcGFuSWQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzcGFuLnNldFN0YXR1cyh7XG4gICAgICAgICAgICBjb2RlOiBzdGF0dXNDb2RlLkVSUk9SLFxuICAgICAgICAgICAgbWVzc2FnZTogJ1NwYW4gZm9yY2UtY2xvc2VkIGR1ZSB0byBMYW1iZGEgc2h1dGRvd24nLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHNwYW4uZW5kKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBFcnJvciBmb3JjZS1lbmRpbmcgc3BhbiAke3NwYW5JZH06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHRoaXMuYWN0aXZlU3BhbnMuY2xlYXIoKTtcbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoJ09URUwgYmFja2VuZCBmbHVzaCBjb21wbGV0ZSAoQURPVCBjb2xsZWN0b3IgaGFuZGxlcyBleHBvcnQpJyk7XG4gIH1cblxuICBkZXN0cm95KCk6IHZvaWQge1xuICAgIHRoaXMuYWN0aXZlU3BhbnMuY2xlYXIoKTtcbiAgfVxufVxuXG4vKiogUmVzZXQgY29sZCBzdGFydCBmbGFnIChmb3IgdGVzdGluZykgKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNldENvbGRTdGFydEZsYWcoKTogdm9pZCB7XG4gIGNvbGRTdGFydEZsYWcgPSB0cnVlO1xufVxuIl19