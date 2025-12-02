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
exports.OTELObservabilityBackend = void 0;
exports.resetColdStartFlag = resetColdStartFlag;
const logging_1 = require("../../logging");
const span_utils_1 = require("../utils/span-utils");
const logger = (0, logging_1.createLogger)('OTELObservabilityBackend');
// Module-level cold start flag (per-container, not per-class)
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
/**
 * OTEL/ADOT Backend - Uses OpenTelemetry API for custom instrumentation
 *
 * This backend works alongside the AWS ADOT Lambda layer to add custom
 * spans, events, and attributes to traces.
 *
 * Supports all three OTEL signals:
 * - Traces: Custom spans from our Span API
 * - Metrics: Counters, gauges, histograms from our Metric API
 * - Logs: Structured logs from our Log API
 *
 * The ADOT layer handles:
 * - Automatic instrumentation of AWS SDK, HTTP, and Lambda
 * - Exporting to X-Ray/CloudWatch via OTLP
 * - Context propagation (W3C Trace Context + X-Ray)
 */
class OTELObservabilityBackend {
    options;
    name = 'otel';
    minLevel;
    // Trace components
    tracer = null;
    trace = null;
    contextApi = null;
    spanStatusCode = null;
    activeSpans = new Map();
    // Metrics component (OTEL SDK handles instrument caching internally)
    meter = null;
    // Logs components
    otelLogger = null;
    // State
    isOTELAvailable = false;
    isMetricsAvailable = false;
    isLogsAvailable = false;
    invocationCount = 0;
    initializationPromise = null;
    constructor(options) {
        this.options = options;
        this.minLevel = options.minLevel;
        // Start async initialization immediately
        this.initializationPromise = this.initializeOpenTelemetry();
    }
    async initializeOpenTelemetry() {
        // Initialize Traces
        try {
            const otel = await Promise.resolve().then(() => __importStar(require('@opentelemetry/api')));
            this.trace = otel.trace;
            this.contextApi = otel.context;
            this.spanStatusCode = otel.SpanStatusCode;
            // Get the tracer from the global provider (initialized by ADOT layer)
            this.tracer = otel.trace.getTracer(this.options.serviceName, process.env.npm_package_version || '1.0.0');
            this.isOTELAvailable = true;
            logger.info('OpenTelemetry Traces API available');
        }
        catch (error) {
            this.isOTELAvailable = false;
            // Log actual error for debugging
            logger.warn('OpenTelemetry Traces API not available - trace instrumentation disabled', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        // Initialize Metrics (separate try-catch since it may not be available)
        try {
            const otelMetrics = await Promise.resolve().then(() => __importStar(require('@opentelemetry/api')));
            // metrics API is on the same module in OTEL 1.x
            if (otelMetrics.metrics) {
                this.meter = otelMetrics.metrics.getMeter(this.options.serviceName, process.env.npm_package_version || '1.0.0');
                this.isMetricsAvailable = true;
                logger.info('OpenTelemetry Metrics API available');
            }
        }
        catch (error) {
            this.isMetricsAvailable = false;
            logger.debug('OpenTelemetry Metrics API not available - metric instrumentation disabled', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        // Initialize Logs (experimental API - optional package)
        try {
            const otelLogs = await Promise.resolve().then(() => __importStar(require('@opentelemetry/api-logs')));
            if (otelLogs.logs) {
                this.otelLogger = otelLogs.logs.getLogger(this.options.serviceName, process.env.npm_package_version || '1.0.0');
                this.isLogsAvailable = true;
                logger.info('OpenTelemetry Logs API available');
            }
        }
        catch (error) {
            this.isLogsAvailable = false;
            logger.debug('OpenTelemetry Logs API not available - log instrumentation disabled', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        if (this.isOTELAvailable) {
            logger.info(`OTEL Backend initialized for: ${this.options.serviceName}`, {
                traces: this.isOTELAvailable,
                metrics: this.isMetricsAvailable,
                logs: this.isLogsAvailable,
                xrayTraceId: process.env._X_AMZN_TRACE_ID,
            });
        }
    }
    /**
     * Ensure initialization is complete before using OTEL
     */
    async ensureInitialized() {
        if (this.initializationPromise) {
            await this.initializationPromise;
            this.initializationPromise = null;
        }
    }
    initializeInvocation() {
        // Increment invocation count
        this.invocationCount++;
        // Detect cold start (module-level flag)
        const isColdStart = coldStartFlag;
        if (coldStartFlag) {
            coldStartFlag = false;
            logger.info('Cold start detected', {
                invocation: this.invocationCount,
                coldStart: true,
            });
        }
        // Clean up any orphaned spans from previous invocations (warm start)
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
        // Ensure async initialization is complete
        await this.ensureInitialized();
        // Route to appropriate handler based on event type
        const type = event.type;
        // Span events → OTEL Traces
        if (type.startsWith('span.')) {
            if (!this.isOTELAvailable)
                return;
            await this.handleSpanEvent(event);
            return;
        }
        // Metric events → OTEL Metrics
        if (type === 'metric') {
            if (!this.isMetricsAvailable)
                return;
            this.handleMetricEvent(event);
            return;
        }
        // Log events → OTEL Logs
        if (type === 'log') {
            if (!this.isLogsAvailable)
                return;
            this.handleLogEvent(event);
            return;
        }
        // Other event types (audit, decision, access, workflow) are not handled by OTEL
        // They go to DynamoDB backend for persistence
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
            // Detect if this is a root span (no parent)
            const isRootSpan = !event.parentLogId;
            const isColdStart = this.invocationCount === 1;
            // Get parent context if exists
            let context = this.contextApi.active();
            if (event.parentLogId) {
                const parentSpan = this.activeSpans.get(event.parentLogId);
                if (parentSpan) {
                    context = this.trace.setSpan(context, parentSpan);
                }
            }
            // Build attributes, filtering out undefined values (OTEL doesn't accept undefined)
            const spanAttributes = {
                // Service name annotation (inspired by AWS Powertools)
                'service.name': this.options.serviceName,
                // Add FW24-specific attributes (only if defined)
                'fw24.correlation_id': event.correlationId,
                'fw24.invocation': this.invocationCount,
            };
            // Cold start annotation (only on root spans)
            if (isRootSpan) {
                spanAttributes['coldStart'] = isColdStart;
            }
            // Add optional FW24 attributes only if defined
            if (event.entityId)
                spanAttributes['fw24.entity_id'] = event.entityId;
            if (event.entityName)
                spanAttributes['fw24.entity_name'] = event.entityName;
            if (event.parentLogId)
                spanAttributes['fw24.parent_log_id'] = event.parentLogId;
            // Add custom attributes from event (converted to OTEL-compatible types)
            Object.assign(spanAttributes, this.toOtelAttributes(event.attributes));
            // Add Lambda context (OTEL semantic conventions) - only if defined
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
            // Create a new span using OpenTelemetry API with parent context
            const span = this.tracer.startSpan(event.operation || 'operation', {
                kind: (0, span_utils_1.getSpanKind)(event.subType),
                attributes: spanAttributes,
                startTime: event.timestampMs,
            }, context);
            // Store the span for future events/end
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
            // Add event to span - OTEL signature: addEvent(name, attributes?, timestamp?)
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
            // Add final attributes
            if (event.attributes) {
                span.setAttributes(this.toOtelAttributes(event.attributes));
            }
            // Add metrics as attributes (X-Ray doesn't have separate metric concept)
            if (event.metrics) {
                Object.entries(event.metrics).forEach(([key, value]) => {
                    span.setAttribute(`metric.${key}`, value);
                });
            }
            // Add duration
            if (event.durationMs) {
                span.setAttribute('duration_ms', event.durationMs);
            }
            const statusCode = this.spanStatusCode;
            // Set status based on success/error
            if (event.error) {
                span.setStatus({
                    code: statusCode.ERROR,
                    message: event.error.message,
                });
                // Record exception with full stack trace
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
            // End the span with the correct timestamp
            span.end(event.timestampMs);
            // Remove from active spans
            this.activeSpans.delete(event.entityId);
            logger.debug(`Ended OpenTelemetry span: ${event.entityId}`);
        }
        catch (error) {
            logger.error('Error ending OpenTelemetry span:', error);
        }
    }
    // ==================== METRIC HANDLING ====================
    /**
     * Handle metric events using OTEL's Metrics API
     *
     * OTEL SDK internally caches instrument instances by name - no manual caching needed.
     */
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
                            // OTEL Counter is monotonic - use UpDownCounter for negative values
                            this.meter.createUpDownCounter(name).add(value, attrs);
                        }
                        else {
                            this.meter.createCounter(name).add(value, attrs);
                        }
                        break;
                    case 'gauge':
                        // OTEL Gauge API (1.4+) - records absolute value
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
            const severity = LOG_LEVEL_TO_SEVERITY[event.level] || 9; // Default to INFO
            // Safely extract message (avoid unsafe cast)
            const message = this.extractLogMessage(event);
            // Build attributes (filtering undefined)
            const logAttributes = {
                ...this.toOtelAttributes(event.attributes),
                ...this.toOtelAttributes(event.data),
                'fw24.correlation_id': event.correlationId,
                'fw24.log_id': event.logId,
            };
            // Add optional attributes only if defined
            if (event.source)
                logAttributes['fw24.source'] = event.source;
            // Add error attributes if present
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
    /**
     * Safely extract log message from event data
     */
    extractLogMessage(event) {
        if (event.data && typeof event.data.message === 'string') {
            return event.data.message;
        }
        return event.operation || 'log';
    }
    // ==================== UTILITY METHODS ====================
    /**
     * Type guard for string array
     */
    isStringArray(arr) {
        return arr.every((v) => typeof v === 'string');
    }
    /**
     * Type guard for number array
     */
    isNumberArray(arr) {
        return arr.every((v) => typeof v === 'number');
    }
    /**
     * Type guard for boolean array
     */
    isBooleanArray(arr) {
        return arr.every((v) => typeof v === 'boolean');
    }
    // Max size for JSON stringified attributes (X-Ray has ~4KB limit per attribute)
    static MAX_ATTRIBUTE_SIZE = 4000;
    /**
     * Convert Record<string, unknown> to OTEL Attributes (only primitive values allowed)
     */
    toOtelAttributes(attrs) {
        if (!attrs)
            return {};
        const result = {};
        for (const [key, value] of Object.entries(attrs)) {
            // OTEL only accepts primitives and homogeneous arrays of primitives
            if (typeof value === 'string') {
                // Truncate long strings
                result[key] = value.length > OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE
                    ? value.substring(0, OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) + '...[truncated]'
                    : value;
            }
            else if (typeof value === 'number' || typeof value === 'boolean') {
                result[key] = value;
            }
            else if (Array.isArray(value)) {
                // OTEL requires homogeneous arrays - use type guards
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
                    // Mixed array - stringify with size limit
                    result[key] = this.safeJsonStringify(value);
                }
            }
            else if (value !== null && value !== undefined) {
                // Convert complex values to JSON string with size limit
                result[key] = this.safeJsonStringify(value);
            }
        }
        return result;
    }
    /**
     * Safely JSON stringify with size limit for OTEL attributes
     */
    safeJsonStringify(value) {
        try {
            const json = JSON.stringify(value);
            if (json.length > OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) {
                return json.substring(0, OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) + '...[truncated]';
            }
            return json;
        }
        catch {
            return '[unserializable]';
        }
    }
    async flush() {
        // End any remaining active spans
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
        // The ADOT layer's OpenTelemetry Collector handles flushing automatically
        // We don't need to manually flush - the collector batches and exports to X-Ray
        logger.debug('OTEL backend flush complete (ADOT collector handles export)');
    }
    destroy() {
        this.activeSpans.clear();
    }
}
exports.OTELObservabilityBackend = OTELObservabilityBackend;
/**
 * Reset cold start flag (for testing)
 * @internal
 */
function resetColdStartFlag() {
    coldStartFlag = true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL290ZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUVHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUEybEJILGdEQUVDO0FBMWxCRCwyQ0FBNkM7QUFDN0Msb0RBQWtEO0FBU2xELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQywwQkFBMEIsQ0FBQyxDQUFDO0FBRXhELDhEQUE4RDtBQUM5RCxJQUFJLGFBQWEsR0FBRyxJQUFJLENBQUM7QUFPekIsaUNBQWlDO0FBQ2pDLE1BQU0scUJBQXFCLEdBQTZDO0lBQ3RFLEtBQUssRUFBRSxDQUFDLEVBQUksUUFBUTtJQUNwQixLQUFLLEVBQUUsQ0FBQyxFQUFJLFFBQVE7SUFDcEIsSUFBSSxFQUFFLENBQUMsRUFBSyxPQUFPO0lBQ25CLElBQUksRUFBRSxFQUFFLEVBQUksT0FBTztJQUNuQixLQUFLLEVBQUUsRUFBRSxFQUFHLFFBQVE7SUFDcEIsUUFBUSxFQUFFLEVBQUUsRUFBRSxRQUFRO0NBQ3ZCLENBQUM7QUFFRjs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7QUFDSCxNQUFhLHdCQUF3QjtJQXdCTjtJQXZCYixJQUFJLEdBQUcsTUFBTSxDQUFDO0lBQ2QsUUFBUSxDQUFzQjtJQUU5QyxtQkFBbUI7SUFDWCxNQUFNLEdBQWtCLElBQUksQ0FBQztJQUM3QixLQUFLLEdBQW9CLElBQUksQ0FBQztJQUM5QixVQUFVLEdBQXNCLElBQUksQ0FBQztJQUNyQyxjQUFjLEdBQWlDLElBQUksQ0FBQztJQUNwRCxXQUFXLEdBQUcsSUFBSSxHQUFHLEVBQWdCLENBQUM7SUFFOUMscUVBQXFFO0lBQzdELEtBQUssR0FBaUIsSUFB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LFVBQVUsQ0FBQyxLQUFLO3dCQUN0QixPQUFPLEVBQUUsMENBQTBDO3FCQUNwRCxDQUFDLENBQUM7b0JBQ0gsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUNiLENBQUM7Z0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztvQkFDZixNQUFNLENBQUMsS0FBSyxDQUFDLDJCQUEyQixRQUFRLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDOUQsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMzQixDQUFDO1FBRUQsMEVBQTBFO1FBQzFFLCtFQUErRTtRQUMvRSxNQUFNLENBQUMsS0FBSyxDQUFDLDZEQUE2RCxDQUFDLENBQUM7SUFDOUUsQ0FBQztJQUVELE9BQU87UUFDTCxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQzNCLENBQUM7O0FBbmlCSCw0REFvaUJDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0Isa0JBQWtCO0lBQ2hDLGFBQWEsR0FBRyxJQUFJLENBQUM7QUFDdkIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT3BlblRlbGVtZXRyeSBCYWNrZW5kIGZvciBBV1MgWC1SYXkgSW50ZWdyYXRpb25cbiAqIFxuICogSU1QT1JUQU5UOiBUaGlzIGJhY2tlbmQgaXMgZGVzaWduZWQgdG8gd29yayB3aXRoIEFXUyBMYW1iZGEncyBtYW5hZ2VkIEFET1QgbGF5ZXIuXG4gKiBcbiAqICMjIFdoeSBBRE9UL09wZW5UZWxlbWV0cnkgKE5vdCBYLVJheSBTREspXG4gKiBcbiAqIEFXUyBYLVJheSBTREsgaXMgYmVpbmcgZGVwcmVjYXRlZCAoZW5kLW9mLXN1cHBvcnQ6IEZlYiAyNSwgMjAyNyk6XG4gKiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20veHJheS9sYXRlc3QvZGV2Z3VpZGUveHJheS1zZGstbm9kZWpzLmh0bWxcbiAqIFxuICogQVdTIHJlY29tbWVuZHMgbWlncmF0aW5nIHRvIE9wZW5UZWxlbWV0cnk6XG4gKiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20veHJheS9sYXRlc3QvZGV2Z3VpZGUveHJheS1pbnN0cnVtZW50aW5nLXlvdXItYXBwLmh0bWwjeHJheS1pbnN0cnVtZW50aW5nLW9wZW50ZWxcbiAqIFxuICogIyMgQVdTIEFET1QgTGFtYmRhIExheWVyXG4gKiBcbiAqIEFXUyBwcm92aWRlcyBhIG1hbmFnZWQgTGFtYmRhIGxheWVyIHRoYXQgaW5jbHVkZXMgT3BlblRlbGVtZXRyeSBpbnN0cnVtZW50YXRpb246XG4gKiAtIEFSTjogYXJuOmF3czpsYW1iZGE6PHJlZ2lvbj46OTAxOTIwNTcwNDYzOmxheWVyOmF3cy1vdGVsLW5vZGVqcy08YXJjaD4tdmVyLTEtMzAtMjoxXG4gKiAtIEF1dG9tYXRpY2FsbHkgaW5zdHJ1bWVudHMgQVdTIFNESywgSFRUUCwgYW5kIExhbWJkYSBpbnZvY2F0aW9uc1xuICogLSBFeHBvcnRzIHRvIFgtUmF5IHZpYSBPcGVuVGVsZW1ldHJ5IENvbGxlY3RvclxuICogLSBXM0MgVHJhY2UgQ29udGV4dCArIFgtUmF5IHByb3BhZ2F0aW9uXG4gKiBcbiAqICMjIEFyY2hpdGVjdHVyZVxuICogXG4gKiBUaGUgQURPVCBsYXllciBwcm92aWRlcyBPcGVuVGVsZW1ldHJ5IHBhY2thZ2VzIGF0IHJ1bnRpbWU6XG4gKiAtIEBvcGVudGVsZW1ldHJ5L2FwaSAoZm9yIGdldHRpbmcgdHJhY2VycyBhbmQgY3JlYXRpbmcgc3BhbnMpXG4gKiAtIEBvcGVudGVsZW1ldHJ5L3Nkay10cmFjZS1ub2RlIChmb3IgdHJhY2VyIGNvbmZpZ3VyYXRpb24pXG4gKiAtIEFET1QgQ29sbGVjdG9yIHJ1bm5pbmcgYXMgTGFtYmRhIGV4dGVuc2lvblxuICogXG4gKiBXZSBpbXBvcnQgdGhlc2UgcGFja2FnZXMgYnV0IG1hcmsgdGhlbSBhcyBleHRlcm5hbCBpbiBidW5kbGluZywgc286XG4gKiAtIERldmVsb3BtZW50OiBDYW4gdGVzdCBsb2NhbGx5IHdpdGggT1RFTCBwYWNrYWdlcyBpbnN0YWxsZWRcbiAqIC0gUHJvZHVjdGlvbjogVXNlcyBwYWNrYWdlcyBmcm9tIEFET1QgbGF5ZXIgKHplcm8gYnVuZGxlIHNpemUpXG4gKiBcbiAqICMjIFN1cHBvcnRlZCBFdmVudCBUeXBlc1xuICogXG4gKiBUaGlzIGJhY2tlbmQgaGFuZGxlcyB0aGUgZm9sbG93aW5nIGV2ZW50czpcbiAqIC0gc3Bhbi4qIOKGkiBPVEVMIFRyYWNlcyAoc3BhbnMgd2l0aCBwYXJlbnQtY2hpbGQgcmVsYXRpb25zaGlwcylcbiAqIC0gbWV0cmljIOKGkiBPVEVMIE1ldHJpY3MgKGNvdW50ZXJzLCBnYXVnZXMsIGhpc3RvZ3JhbXMpXG4gKiAtIGxvZyDihpIgT1RFTCBMb2dzIChzdHJ1Y3R1cmVkIGxvZyBldmVudHMpXG4gKiBcbiAqIE5PVCBoYW5kbGVkICh1c2UgRHluYW1vREIgYmFja2VuZCBmb3IgcGVyc2lzdGVuY2UpOlxuICogLSBhdWRpdC4qIOKGkiBCdXNpbmVzcyByZWNvcmRzIChub3QgdGVsZW1ldHJ5KVxuICogLSBkZWNpc2lvbi4qIOKGkiBCdXNpbmVzcyByZWNvcmRzIChub3QgdGVsZW1ldHJ5KVxuICogLSBhY2Nlc3MuKiDihpIgQnVzaW5lc3MgcmVjb3JkcyAobm90IHRlbGVtZXRyeSlcbiAqIC0gd29ya2Zsb3cuKiDihpIgTG9uZy1ydW5uaW5nIHN0YXRlIChkb2Vzbid0IGZpdCBPVEVMJ3MgZXBoZW1lcmFsIHNwYW4gbW9kZWwpXG4gKiBcbiAqICMjIFNldHVwIGluIENESy9TQU1cbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgVHJhY2luZyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuICogXG4gKiBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnTXlGdW5jdGlvbicsIHtcbiAqICAgbGF5ZXJzOiBbXG4gKiAgICAgTGF5ZXJWZXJzaW9uLmZyb21MYXllclZlcnNpb25Bcm4odGhpcywgJ0Fkb3RMYXllcicsXG4gKiAgICAgICAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjkwMTkyMDU3MDQ2MzpsYXllcjphd3Mtb3RlbC1ub2RlanMtYW1kNjQtdmVyLTEtMzAtMjoxJ1xuICogICAgIClcbiAqICAgXSxcbiAqICAgZW52aXJvbm1lbnQ6IHtcbiAqICAgICBBV1NfTEFNQkRBX0VYRUNfV1JBUFBFUjogJy9vcHQvb3RlbC1oYW5kbGVyJyxcbiAqICAgICBPQlNFUlZBQklMSVRZX0JBQ0tFTkRTOiAnb3RlbCcsIC8vIEZXMjQgY29uZmlnXG4gKiAgIH0sXG4gKiAgIHRyYWNpbmc6IFRyYWNpbmcuQUNUSVZFLCAvLyBFbmFibGUgWC1SYXlcbiAqICAgYnVuZGxpbmc6IHtcbiAqICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAqICAgICAgICdAb3BlbnRlbGVtZXRyeS8qJywgLy8gUHJvdmlkZWQgYnkgTGFtYmRhIGxheWVyXG4gKiAgICAgXSxcbiAqICAgfSxcbiAqIH0pO1xuICogYGBgXG4gKiBcbiAqIFJlZmVyZW5jZXM6XG4gKiAtIGh0dHBzOi8vYXdzLW90ZWwuZ2l0aHViLmlvL2RvY3MvZ2V0dGluZy1zdGFydGVkL2xhbWJkYS9sYW1iZGEtanNcbiAqIC0gaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2xhbWJkYS9sYXRlc3QvZGcvdHlwZXNjcmlwdC10cmFjaW5nLmh0bWxcbiAqIC0gaHR0cHM6Ly9vcGVudGVsZW1ldHJ5LmlvL2RvY3MvbGFuZ3VhZ2VzL2pzL1xuICovXG5cbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCwgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBnZXRTcGFuS2luZCB9IGZyb20gJy4uL3V0aWxzL3NwYW4tdXRpbHMnO1xuXG4vLyBJbXBvcnQgdHlwZXMgZnJvbSBAb3BlbnRlbGVtZXRyeS9hcGkgKGF2YWlsYWJsZSBhcyBkZXZEZXBlbmRlbmN5IGZvciB0eXBlIGNoZWNraW5nKVxuaW1wb3J0IHR5cGUgeyBUcmFjZXIsIFNwYW4sIFNwYW5TdGF0dXNDb2RlLCBUcmFjZUFQSSwgQ29udGV4dEFQSSwgQXR0cmlidXRlcyB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaSc7XG4vLyBJbXBvcnQgdHlwZXMgZm9yIG1ldHJpY3MgKG9wdGlvbmFsIC0gbWF5IG5vdCBiZSBhdmFpbGFibGUgaW4gYWxsIEFET1QgdmVyc2lvbnMpXG5pbXBvcnQgdHlwZSB7IE1ldGVyIH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbi8vIEltcG9ydCB0eXBlcyBmb3IgbG9ncyAob3B0aW9uYWwgLSBleHBlcmltZW50YWwgQVBJKVxuaW1wb3J0IHR5cGUgeyBMb2dnZXIgYXMgT1RFTExvZ2dlciB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaS1sb2dzJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQnKTtcblxuLy8gTW9kdWxlLWxldmVsIGNvbGQgc3RhcnQgZmxhZyAocGVyLWNvbnRhaW5lciwgbm90IHBlci1jbGFzcylcbmxldCBjb2xkU3RhcnRGbGFnID0gdHJ1ZTtcblxuZXhwb3J0IGludGVyZmFjZSBPVEVMQmFja2VuZE9wdGlvbnMge1xuICBzZXJ2aWNlTmFtZTogc3RyaW5nO1xuICBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcbn1cblxuLy8gT1RFTCBTZXZlcml0eSBtYXBwaW5nIGZvciBsb2dzXG5jb25zdCBMT0dfTEVWRUxfVE9fU0VWRVJJVFk6IFJlY29yZDxPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsIG51bWJlcj4gPSB7XG4gIHRyYWNlOiAxLCAgIC8vIFRSQUNFXG4gIGRlYnVnOiA1LCAgIC8vIERFQlVHXG4gIGluZm86IDksICAgIC8vIElORk9cbiAgd2FybjogMTMsICAgLy8gV0FSTlxuICBlcnJvcjogMTcsICAvLyBFUlJPUlxuICBjcml0aWNhbDogMjEsIC8vIEZBVEFMXG59O1xuXG4vKipcbiAqIE9URUwvQURPVCBCYWNrZW5kIC0gVXNlcyBPcGVuVGVsZW1ldHJ5IEFQSSBmb3IgY3VzdG9tIGluc3RydW1lbnRhdGlvblxuICogXG4gKiBUaGlzIGJhY2tlbmQgd29ya3MgYWxvbmdzaWRlIHRoZSBBV1MgQURPVCBMYW1iZGEgbGF5ZXIgdG8gYWRkIGN1c3RvbVxuICogc3BhbnMsIGV2ZW50cywgYW5kIGF0dHJpYnV0ZXMgdG8gdHJhY2VzLlxuICogXG4gKiBTdXBwb3J0cyBhbGwgdGhyZWUgT1RFTCBzaWduYWxzOlxuICogLSBUcmFjZXM6IEN1c3RvbSBzcGFucyBmcm9tIG91ciBTcGFuIEFQSVxuICogLSBNZXRyaWNzOiBDb3VudGVycywgZ2F1Z2VzLCBoaXN0b2dyYW1zIGZyb20gb3VyIE1ldHJpYyBBUElcbiAqIC0gTG9nczogU3RydWN0dXJlZCBsb2dzIGZyb20gb3VyIExvZyBBUElcbiAqIFxuICogVGhlIEFET1QgbGF5ZXIgaGFuZGxlczpcbiAqIC0gQXV0b21hdGljIGluc3RydW1lbnRhdGlvbiBvZiBBV1MgU0RLLCBIVFRQLCBhbmQgTGFtYmRhXG4gKiAtIEV4cG9ydGluZyB0byBYLVJheS9DbG91ZFdhdGNoIHZpYSBPVExQXG4gKiAtIENvbnRleHQgcHJvcGFnYXRpb24gKFczQyBUcmFjZSBDb250ZXh0ICsgWC1SYXkpXG4gKi9cbmV4cG9ydCBjbGFzcyBPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ290ZWwnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgLy8gVHJhY2UgY29tcG9uZW50c1xuICBwcml2YXRlIHRyYWNlcjogVHJhY2VyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdHJhY2U6IFRyYWNlQVBJIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY29udGV4dEFwaTogQ29udGV4dEFQSSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNwYW5TdGF0dXNDb2RlOiB0eXBlb2YgU3BhblN0YXR1c0NvZGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBhY3RpdmVTcGFucyA9IG5ldyBNYXA8c3RyaW5nLCBTcGFuPigpO1xuXG4gIC8vIE1ldHJpY3MgY29tcG9uZW50IChPVEVMIFNESyBoYW5kbGVzIGluc3RydW1lbnQgY2FjaGluZyBpbnRlcm5hbGx5KVxuICBwcml2YXRlIG1ldGVyOiBNZXRlciB8IG51bGwgPSBudWxsO1xuXG4gIC8vIExvZ3MgY29tcG9uZW50c1xuICBwcml2YXRlIG90ZWxMb2dnZXI6IE9URUxMb2dnZXIgfCBudWxsID0gbnVsbDtcblxuICAvLyBTdGF0ZVxuICBwcml2YXRlIGlzT1RFTEF2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGlzTWV0cmljc0F2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGlzTG9nc0F2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGludm9jYXRpb25Db3VudDogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSBpbml0aWFsaXphdGlvblByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IE9URUxCYWNrZW5kT3B0aW9ucykge1xuICAgIHRoaXMubWluTGV2ZWwgPSBvcHRpb25zLm1pbkxldmVsO1xuICAgIC8vIFN0YXJ0IGFzeW5jIGluaXRpYWxpemF0aW9uIGltbWVkaWF0ZWx5XG4gICAgdGhpcy5pbml0aWFsaXphdGlvblByb21pc2UgPSB0aGlzLmluaXRpYWxpemVPcGVuVGVsZW1ldHJ5KCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVPcGVuVGVsZW1ldHJ5KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEluaXRpYWxpemUgVHJhY2VzXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG90ZWwgPSBhd2FpdCBpbXBvcnQoJ0BvcGVudGVsZW1ldHJ5L2FwaScpO1xuICAgICAgdGhpcy50cmFjZSA9IG90ZWwudHJhY2U7XG4gICAgICB0aGlzLmNvbnRleHRBcGkgPSBvdGVsLmNvbnRleHQ7XG4gICAgICB0aGlzLnNwYW5TdGF0dXNDb2RlID0gb3RlbC5TcGFuU3RhdHVzQ29kZTtcblxuICAgICAgLy8gR2V0IHRoZSB0cmFjZXIgZnJvbSB0aGUgZ2xvYmFsIHByb3ZpZGVyIChpbml0aWFsaXplZCBieSBBRE9UIGxheWVyKVxuICAgICAgdGhpcy50cmFjZXIgPSBvdGVsLnRyYWNlLmdldFRyYWNlcihcbiAgICAgICAgdGhpcy5vcHRpb25zLnNlcnZpY2VOYW1lLFxuICAgICAgICBwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcxLjAuMCdcbiAgICAgICk7XG5cbiAgICAgIHRoaXMuaXNPVEVMQXZhaWxhYmxlID0gdHJ1ZTtcbiAgICAgIGxvZ2dlci5pbmZvKCdPcGVuVGVsZW1ldHJ5IFRyYWNlcyBBUEkgYXZhaWxhYmxlJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaXNPVEVMQXZhaWxhYmxlID0gZmFsc2U7XG4gICAgICAvLyBMb2cgYWN0dWFsIGVycm9yIGZvciBkZWJ1Z2dpbmdcbiAgICAgIGxvZ2dlci53YXJuKCdPcGVuVGVsZW1ldHJ5IFRyYWNlcyBBUEkgbm90IGF2YWlsYWJsZSAtIHRyYWNlIGluc3RydW1lbnRhdGlvbiBkaXNhYmxlZCcsIHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgTWV0cmljcyAoc2VwYXJhdGUgdHJ5LWNhdGNoIHNpbmNlIGl0IG1heSBub3QgYmUgYXZhaWxhYmxlKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBvdGVsTWV0cmljcyA9IGF3YWl0IGltcG9ydCgnQG9wZW50ZWxlbWV0cnkvYXBpJyk7XG4gICAgICAvLyBtZXRyaWNzIEFQSSBpcyBvbiB0aGUgc2FtZSBtb2R1bGUgaW4gT1RFTCAxLnhcbiAgICAgIGlmIChvdGVsTWV0cmljcy5tZXRyaWNzKSB7XG4gICAgICAgIHRoaXMubWV0ZXIgPSBvdGVsTWV0cmljcy5tZXRyaWNzLmdldE1ldGVyKFxuICAgICAgICAgIHRoaXMub3B0aW9ucy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICBwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcxLjAuMCdcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5pc01ldHJpY3NBdmFpbGFibGUgPSB0cnVlO1xuICAgICAgICBsb2dnZXIuaW5mbygnT3BlblRlbGVtZXRyeSBNZXRyaWNzIEFQSSBhdmFpbGFibGUnKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5pc01ldHJpY3NBdmFpbGFibGUgPSBmYWxzZTtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnT3BlblRlbGVtZXRyeSBNZXRyaWNzIEFQSSBub3QgYXZhaWxhYmxlIC0gbWV0cmljIGluc3RydW1lbnRhdGlvbiBkaXNhYmxlZCcsIHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgTG9ncyAoZXhwZXJpbWVudGFsIEFQSSAtIG9wdGlvbmFsIHBhY2thZ2UpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG90ZWxMb2dzID0gYXdhaXQgaW1wb3J0KCdAb3BlbnRlbGVtZXRyeS9hcGktbG9ncycpO1xuICAgICAgaWYgKG90ZWxMb2dzLmxvZ3MpIHtcbiAgICAgICAgdGhpcy5vdGVsTG9nZ2VyID0gb3RlbExvZ3MubG9ncy5nZXRMb2dnZXIoXG4gICAgICAgICAgdGhpcy5vcHRpb25zLnNlcnZpY2VOYW1lLFxuICAgICAgICAgIHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzEuMC4wJ1xuICAgICAgICApO1xuICAgICAgICB0aGlzLmlzTG9nc0F2YWlsYWJsZSA9IHRydWU7XG4gICAgICAgIGxvZ2dlci5pbmZvKCdPcGVuVGVsZW1ldHJ5IExvZ3MgQVBJIGF2YWlsYWJsZScpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmlzTG9nc0F2YWlsYWJsZSA9IGZhbHNlO1xuICAgICAgbG9nZ2VyLmRlYnVnKCdPcGVuVGVsZW1ldHJ5IExvZ3MgQVBJIG5vdCBhdmFpbGFibGUgLSBsb2cgaW5zdHJ1bWVudGF0aW9uIGRpc2FibGVkJywge1xuICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNPVEVMQXZhaWxhYmxlKSB7XG4gICAgICBsb2dnZXIuaW5mbyhgT1RFTCBCYWNrZW5kIGluaXRpYWxpemVkIGZvcjogJHt0aGlzLm9wdGlvbnMuc2VydmljZU5hbWV9YCwge1xuICAgICAgICB0cmFjZXM6IHRoaXMuaXNPVEVMQXZhaWxhYmxlLFxuICAgICAgICBtZXRyaWNzOiB0aGlzLmlzTWV0cmljc0F2YWlsYWJsZSxcbiAgICAgICAgbG9nczogdGhpcy5pc0xvZ3NBdmFpbGFibGUsXG4gICAgICAgIHhyYXlUcmFjZUlkOiBwcm9jZXNzLmVudi5fWF9BTVpOX1RSQUNFX0lELFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZSBpbml0aWFsaXphdGlvbiBpcyBjb21wbGV0ZSBiZWZvcmUgdXNpbmcgT1RFTFxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVJbml0aWFsaXplZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5pbml0aWFsaXphdGlvblByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6YXRpb25Qcm9taXNlO1xuICAgICAgdGhpcy5pbml0aWFsaXphdGlvblByb21pc2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIC8vIEluY3JlbWVudCBpbnZvY2F0aW9uIGNvdW50XG4gICAgdGhpcy5pbnZvY2F0aW9uQ291bnQrKztcblxuICAgIC8vIERldGVjdCBjb2xkIHN0YXJ0IChtb2R1bGUtbGV2ZWwgZmxhZylcbiAgICBjb25zdCBpc0NvbGRTdGFydCA9IGNvbGRTdGFydEZsYWc7XG4gICAgaWYgKGNvbGRTdGFydEZsYWcpIHtcbiAgICAgIGNvbGRTdGFydEZsYWcgPSBmYWxzZTtcbiAgICAgIGxvZ2dlci5pbmZvKCdDb2xkIHN0YXJ0IGRldGVjdGVkJywge1xuICAgICAgICBpbnZvY2F0aW9uOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgICAgY29sZFN0YXJ0OiB0cnVlLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ2xlYW4gdXAgYW55IG9ycGhhbmVkIHNwYW5zIGZyb20gcHJldmlvdXMgaW52b2NhdGlvbnMgKHdhcm0gc3RhcnQpXG4gICAgaWYgKHRoaXMuYWN0aXZlU3BhbnMuc2l6ZSA+IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKGBDbGVhbmluZyB1cCAke3RoaXMuYWN0aXZlU3BhbnMuc2l6ZX0gb3JwaGFuZWQgc3BhbnMgZnJvbSBwcmV2aW91cyBpbnZvY2F0aW9uYCk7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmZvckVhY2goKHNwYW4sIGVudGl0eUlkKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3Bhbi5lbmQoKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIGVuZGluZyBvcnBoYW5lZCBzcGFuICR7ZW50aXR5SWR9OmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmNsZWFyKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gRW5zdXJlIGFzeW5jIGluaXRpYWxpemF0aW9uIGlzIGNvbXBsZXRlXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpO1xuXG4gICAgLy8gUm91dGUgdG8gYXBwcm9wcmlhdGUgaGFuZGxlciBiYXNlZCBvbiBldmVudCB0eXBlXG4gICAgY29uc3QgdHlwZSA9IGV2ZW50LnR5cGU7XG5cbiAgICAvLyBTcGFuIGV2ZW50cyDihpIgT1RFTCBUcmFjZXNcbiAgICBpZiAodHlwZS5zdGFydHNXaXRoKCdzcGFuLicpKSB7XG4gICAgICBpZiAoIXRoaXMuaXNPVEVMQXZhaWxhYmxlKSByZXR1cm47XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZVNwYW5FdmVudChldmVudCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gTWV0cmljIGV2ZW50cyDihpIgT1RFTCBNZXRyaWNzXG4gICAgaWYgKHR5cGUgPT09ICdtZXRyaWMnKSB7XG4gICAgICBpZiAoIXRoaXMuaXNNZXRyaWNzQXZhaWxhYmxlKSByZXR1cm47XG4gICAgICB0aGlzLmhhbmRsZU1ldHJpY0V2ZW50KGV2ZW50KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBMb2cgZXZlbnRzIOKGkiBPVEVMIExvZ3NcbiAgICBpZiAodHlwZSA9PT0gJ2xvZycpIHtcbiAgICAgIGlmICghdGhpcy5pc0xvZ3NBdmFpbGFibGUpIHJldHVybjtcbiAgICAgIHRoaXMuaGFuZGxlTG9nRXZlbnQoZXZlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE90aGVyIGV2ZW50IHR5cGVzIChhdWRpdCwgZGVjaXNpb24sIGFjY2Vzcywgd29ya2Zsb3cpIGFyZSBub3QgaGFuZGxlZCBieSBPVEVMXG4gICAgLy8gVGhleSBnbyB0byBEeW5hbW9EQiBiYWNrZW5kIGZvciBwZXJzaXN0ZW5jZVxuICB9XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT0gU1BBTiBIQU5ETElORyA9PT09PT09PT09PT09PT09PT09PVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlU3BhbkV2ZW50KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoZXZlbnQuZW50aXR5TmFtZSAhPT0gJ3NwYW4nKSByZXR1cm47XG5cbiAgICBzd2l0Y2ggKGV2ZW50LnR5cGUpIHtcbiAgICAgIGNhc2UgJ3NwYW4uc3RhcnQnOlxuICAgICAgICB0aGlzLmhhbmRsZVNwYW5TdGFydChldmVudCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnc3Bhbi5ldmVudCc6XG4gICAgICAgIHRoaXMuaGFuZGxlU3BhbkV2ZW50SW50ZXJuYWwoZXZlbnQpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3NwYW4uZW5kJzpcbiAgICAgICAgdGhpcy5oYW5kbGVTcGFuRW5kKGV2ZW50KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVTcGFuU3RhcnQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQuZW50aXR5SWQgfHwgIXRoaXMudHJhY2VyIHx8ICF0aGlzLnRyYWNlIHx8ICF0aGlzLmNvbnRleHRBcGkpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICAvLyBEZXRlY3QgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KVxuICAgICAgY29uc3QgaXNSb290U3BhbiA9ICFldmVudC5wYXJlbnRMb2dJZDtcbiAgICAgIGNvbnN0IGlzQ29sZFN0YXJ0ID0gdGhpcy5pbnZvY2F0aW9uQ291bnQgPT09IDE7XG5cbiAgICAgIC8vIEdldCBwYXJlbnQgY29udGV4dCBpZiBleGlzdHNcbiAgICAgIGxldCBjb250ZXh0ID0gdGhpcy5jb250ZXh0QXBpLmFjdGl2ZSgpO1xuICAgICAgaWYgKGV2ZW50LnBhcmVudExvZ0lkKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChldmVudC5wYXJlbnRMb2dJZCk7XG4gICAgICAgIGlmIChwYXJlbnRTcGFuKSB7XG4gICAgICAgICAgY29udGV4dCA9IHRoaXMudHJhY2Uuc2V0U3Bhbihjb250ZXh0LCBwYXJlbnRTcGFuKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBCdWlsZCBhdHRyaWJ1dGVzLCBmaWx0ZXJpbmcgb3V0IHVuZGVmaW5lZCB2YWx1ZXMgKE9URUwgZG9lc24ndCBhY2NlcHQgdW5kZWZpbmVkKVxuICAgICAgY29uc3Qgc3BhbkF0dHJpYnV0ZXM6IEF0dHJpYnV0ZXMgPSB7XG4gICAgICAgIC8vIFNlcnZpY2UgbmFtZSBhbm5vdGF0aW9uIChpbnNwaXJlZCBieSBBV1MgUG93ZXJ0b29scylcbiAgICAgICAgJ3NlcnZpY2UubmFtZSc6IHRoaXMub3B0aW9ucy5zZXJ2aWNlTmFtZSxcblxuICAgICAgICAvLyBBZGQgRlcyNC1zcGVjaWZpYyBhdHRyaWJ1dGVzIChvbmx5IGlmIGRlZmluZWQpXG4gICAgICAgICdmdzI0LmNvcnJlbGF0aW9uX2lkJzogZXZlbnQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgJ2Z3MjQuaW52b2NhdGlvbic6IHRoaXMuaW52b2NhdGlvbkNvdW50LFxuICAgICAgfTtcblxuICAgICAgLy8gQ29sZCBzdGFydCBhbm5vdGF0aW9uIChvbmx5IG9uIHJvb3Qgc3BhbnMpXG4gICAgICBpZiAoaXNSb290U3Bhbikge1xuICAgICAgICBzcGFuQXR0cmlidXRlc1sgJ2NvbGRTdGFydCcgXSA9IGlzQ29sZFN0YXJ0O1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgb3B0aW9uYWwgRlcyNCBhdHRyaWJ1dGVzIG9ubHkgaWYgZGVmaW5lZFxuICAgICAgaWYgKGV2ZW50LmVudGl0eUlkKSBzcGFuQXR0cmlidXRlc1sgJ2Z3MjQuZW50aXR5X2lkJyBdID0gZXZlbnQuZW50aXR5SWQ7XG4gICAgICBpZiAoZXZlbnQuZW50aXR5TmFtZSkgc3BhbkF0dHJpYnV0ZXNbICdmdzI0LmVudGl0eV9uYW1lJyBdID0gZXZlbnQuZW50aXR5TmFtZTtcbiAgICAgIGlmIChldmVudC5wYXJlbnRMb2dJZCkgc3BhbkF0dHJpYnV0ZXNbICdmdzI0LnBhcmVudF9sb2dfaWQnIF0gPSBldmVudC5wYXJlbnRMb2dJZDtcblxuICAgICAgLy8gQWRkIGN1c3RvbSBhdHRyaWJ1dGVzIGZyb20gZXZlbnQgKGNvbnZlcnRlZCB0byBPVEVMLWNvbXBhdGlibGUgdHlwZXMpXG4gICAgICBPYmplY3QuYXNzaWduKHNwYW5BdHRyaWJ1dGVzLCB0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcykpO1xuXG4gICAgICAvLyBBZGQgTGFtYmRhIGNvbnRleHQgKE9URUwgc2VtYW50aWMgY29udmVudGlvbnMpIC0gb25seSBpZiBkZWZpbmVkXG4gICAgICBpZiAocHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9OQU1FKSBzcGFuQXR0cmlidXRlc1sgJ2ZhYXMubmFtZScgXSA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRTtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0ZVTkNUSU9OX1ZFUlNJT04pIHNwYW5BdHRyaWJ1dGVzWyAnZmFhcy52ZXJzaW9uJyBdID0gcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9WRVJTSU9OO1xuICAgICAgaWYgKHByb2Nlc3MuZW52LkFXU19MQU1CREFfTE9HX1NUUkVBTV9OQU1FKSBzcGFuQXR0cmlidXRlc1sgJ2ZhYXMuaW5zdGFuY2UnIF0gPSBwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0xPR19TVFJFQU1fTkFNRTtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5BV1NfQUNDT1VOVF9JRCkgc3BhbkF0dHJpYnV0ZXNbICdjbG91ZC5hY2NvdW50LmlkJyBdID0gcHJvY2Vzcy5lbnYuQVdTX0FDQ09VTlRfSUQ7XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuQVdTX1JFR0lPTikgc3BhbkF0dHJpYnV0ZXNbICdjbG91ZC5yZWdpb24nIF0gPSBwcm9jZXNzLmVudi5BV1NfUkVHSU9OO1xuXG4gICAgICAvLyBDcmVhdGUgYSBuZXcgc3BhbiB1c2luZyBPcGVuVGVsZW1ldHJ5IEFQSSB3aXRoIHBhcmVudCBjb250ZXh0XG4gICAgICBjb25zdCBzcGFuID0gdGhpcy50cmFjZXIuc3RhcnRTcGFuKFxuICAgICAgICBldmVudC5vcGVyYXRpb24gfHwgJ29wZXJhdGlvbicsXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiBnZXRTcGFuS2luZChldmVudC5zdWJUeXBlKSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiBzcGFuQXR0cmlidXRlcyxcbiAgICAgICAgICBzdGFydFRpbWU6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0LCAvLyBQYXNzIHBhcmVudCBjb250ZXh0XG4gICAgICApO1xuXG4gICAgICAvLyBTdG9yZSB0aGUgc3BhbiBmb3IgZnV0dXJlIGV2ZW50cy9lbmRcbiAgICAgIHRoaXMuYWN0aXZlU3BhbnMuc2V0KGV2ZW50LmVudGl0eUlkLCBzcGFuKTtcblxuICAgICAgbG9nZ2VyLmRlYnVnKGBDcmVhdGVkIE9wZW5UZWxlbWV0cnkgc3BhbjogJHtldmVudC5vcGVyYXRpb259ICgke2V2ZW50LmVudGl0eUlkfSlgLCB7XG4gICAgICAgIGNvbGRTdGFydDogaXNSb290U3BhbiA/IGlzQ29sZFN0YXJ0IDogdW5kZWZpbmVkLFxuICAgICAgICBpbnZvY2F0aW9uOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGNyZWF0aW5nIE9wZW5UZWxlbWV0cnkgc3BhbjonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVTcGFuRXZlbnRJbnRlcm5hbChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5lbnRpdHlJZCkgcmV0dXJuO1xuXG4gICAgY29uc3Qgc3BhbiA9IHRoaXMuYWN0aXZlU3BhbnMuZ2V0KGV2ZW50LmVudGl0eUlkKTtcbiAgICBpZiAoIXNwYW4pIHtcbiAgICAgIGxvZ2dlci53YXJuKGBObyBhY3RpdmUgc3BhbiBmb3VuZCBmb3IgZXZlbnQ6ICR7ZXZlbnQuZW50aXR5SWR9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEFkZCBldmVudCB0byBzcGFuIC0gT1RFTCBzaWduYXR1cmU6IGFkZEV2ZW50KG5hbWUsIGF0dHJpYnV0ZXM/LCB0aW1lc3RhbXA/KVxuICAgICAgY29uc3QgYXR0cnMgPSB0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcyk7XG4gICAgICBzcGFuLmFkZEV2ZW50KGV2ZW50Lm9wZXJhdGlvbiB8fCAnZXZlbnQnLCBhdHRycywgZXZlbnQudGltZXN0YW1wTXMpO1xuXG4gICAgICBsb2dnZXIuZGVidWcoYEFkZGVkIGV2ZW50IHRvIHNwYW4gJHtldmVudC5lbnRpdHlJZH06ICR7ZXZlbnQub3BlcmF0aW9ufWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGFkZGluZyBldmVudCB0byBPcGVuVGVsZW1ldHJ5IHNwYW46JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlU3BhbkVuZChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5lbnRpdHlJZCB8fCAhdGhpcy5zcGFuU3RhdHVzQ29kZSkgcmV0dXJuO1xuXG4gICAgY29uc3Qgc3BhbiA9IHRoaXMuYWN0aXZlU3BhbnMuZ2V0KGV2ZW50LmVudGl0eUlkKTtcbiAgICBpZiAoIXNwYW4pIHtcbiAgICAgIGxvZ2dlci53YXJuKGBObyBhY3RpdmUgc3BhbiBmb3VuZCBmb3IgZW5kIGV2ZW50OiAke2V2ZW50LmVudGl0eUlkfWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBBZGQgZmluYWwgYXR0cmlidXRlc1xuICAgICAgaWYgKGV2ZW50LmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGVzKHRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCBtZXRyaWNzIGFzIGF0dHJpYnV0ZXMgKFgtUmF5IGRvZXNuJ3QgaGF2ZSBzZXBhcmF0ZSBtZXRyaWMgY29uY2VwdClcbiAgICAgIGlmIChldmVudC5tZXRyaWNzKSB7XG4gICAgICAgIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoYG1ldHJpYy4ke2tleX1gLCB2YWx1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgZHVyYXRpb25cbiAgICAgIGlmIChldmVudC5kdXJhdGlvbk1zKSB7XG4gICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKCdkdXJhdGlvbl9tcycsIGV2ZW50LmR1cmF0aW9uTXMpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzdGF0dXNDb2RlID0gdGhpcy5zcGFuU3RhdHVzQ29kZTtcblxuICAgICAgLy8gU2V0IHN0YXR1cyBiYXNlZCBvbiBzdWNjZXNzL2Vycm9yXG4gICAgICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5zZXRTdGF0dXMoe1xuICAgICAgICAgIGNvZGU6IHN0YXR1c0NvZGUuRVJST1IsXG4gICAgICAgICAgbWVzc2FnZTogZXZlbnQuZXJyb3IubWVzc2FnZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUmVjb3JkIGV4Y2VwdGlvbiB3aXRoIGZ1bGwgc3RhY2sgdHJhY2VcbiAgICAgICAgc3Bhbi5yZWNvcmRFeGNlcHRpb24oe1xuICAgICAgICAgIG5hbWU6IGV2ZW50LmVycm9yLnR5cGUsXG4gICAgICAgICAgbWVzc2FnZTogZXZlbnQuZXJyb3IubWVzc2FnZSxcbiAgICAgICAgICBzdGFjazogZXZlbnQuZXJyb3Iuc3RhY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5zdWNjZXNzID09PSBmYWxzZSkge1xuICAgICAgICBzcGFuLnNldFN0YXR1cyh7XG4gICAgICAgICAgY29kZTogc3RhdHVzQ29kZS5FUlJPUixcbiAgICAgICAgICBtZXNzYWdlOiBldmVudC5zdGF0dXMgfHwgJ09wZXJhdGlvbiBmYWlsZWQnLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwYW4uc2V0U3RhdHVzKHsgY29kZTogc3RhdHVzQ29kZS5PSyB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gRW5kIHRoZSBzcGFuIHdpdGggdGhlIGNvcnJlY3QgdGltZXN0YW1wXG4gICAgICBzcGFuLmVuZChldmVudC50aW1lc3RhbXBNcyk7XG5cbiAgICAgIC8vIFJlbW92ZSBmcm9tIGFjdGl2ZSBzcGFuc1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5kZWxldGUoZXZlbnQuZW50aXR5SWQpO1xuXG4gICAgICBsb2dnZXIuZGVidWcoYEVuZGVkIE9wZW5UZWxlbWV0cnkgc3BhbjogJHtldmVudC5lbnRpdHlJZH1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdFcnJvciBlbmRpbmcgT3BlblRlbGVtZXRyeSBzcGFuOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PSBNRVRSSUMgSEFORExJTkcgPT09PT09PT09PT09PT09PT09PT1cblxuICAvKipcbiAgICogSGFuZGxlIG1ldHJpYyBldmVudHMgdXNpbmcgT1RFTCdzIE1ldHJpY3MgQVBJXG4gICAqIFxuICAgKiBPVEVMIFNESyBpbnRlcm5hbGx5IGNhY2hlcyBpbnN0cnVtZW50IGluc3RhbmNlcyBieSBuYW1lIC0gbm8gbWFudWFsIGNhY2hpbmcgbmVlZGVkLlxuICAgKi9cbiAgcHJpdmF0ZSBoYW5kbGVNZXRyaWNFdmVudChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLm1ldGVyIHx8ICFldmVudC5tZXRyaWNzKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgbWV0cmljVHlwZSA9IGV2ZW50LnN1YlR5cGUgfHwgJ2NvdW50ZXInO1xuICAgICAgY29uc3QgYXR0cnMgPSB0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcyk7XG5cbiAgICAgIGZvciAoY29uc3QgWyBuYW1lLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpKSB7XG4gICAgICAgIHN3aXRjaCAobWV0cmljVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ2NvdW50ZXInOlxuICAgICAgICAgICAgaWYgKHZhbHVlIDwgMCkge1xuICAgICAgICAgICAgICAvLyBPVEVMIENvdW50ZXIgaXMgbW9ub3RvbmljIC0gdXNlIFVwRG93bkNvdW50ZXIgZm9yIG5lZ2F0aXZlIHZhbHVlc1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZVVwRG93bkNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZUNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ2dhdWdlJzpcbiAgICAgICAgICAgIC8vIE9URUwgR2F1Z2UgQVBJICgxLjQrKSAtIHJlY29yZHMgYWJzb2x1dGUgdmFsdWVcbiAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlR2F1Z2UobmFtZSkucmVjb3JkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ3RpbWluZyc6XG4gICAgICAgICAgY2FzZSAnaGlzdG9ncmFtJzpcbiAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlSGlzdG9ncmFtKG5hbWUpLnJlY29yZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgaWYgKHZhbHVlID49IDApIHtcbiAgICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVDb3VudGVyKG5hbWUpLmFkZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVVcERvd25Db3VudGVyKG5hbWUpLmFkZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRXJyb3IgcmVjb3JkaW5nIE9wZW5UZWxlbWV0cnkgbWV0cmljOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PSBMT0cgSEFORExJTkcgPT09PT09PT09PT09PT09PT09PT1cblxuICBwcml2YXRlIGhhbmRsZUxvZ0V2ZW50KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMub3RlbExvZ2dlcikgcmV0dXJuO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHNldmVyaXR5ID0gTE9HX0xFVkVMX1RPX1NFVkVSSVRZWyBldmVudC5sZXZlbCBdIHx8IDk7IC8vIERlZmF1bHQgdG8gSU5GT1xuXG4gICAgICAvLyBTYWZlbHkgZXh0cmFjdCBtZXNzYWdlIChhdm9pZCB1bnNhZmUgY2FzdClcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLmV4dHJhY3RMb2dNZXNzYWdlKGV2ZW50KTtcblxuICAgICAgLy8gQnVpbGQgYXR0cmlidXRlcyAoZmlsdGVyaW5nIHVuZGVmaW5lZClcbiAgICAgIGNvbnN0IGxvZ0F0dHJpYnV0ZXM6IEF0dHJpYnV0ZXMgPSB7XG4gICAgICAgIC4uLnRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKSxcbiAgICAgICAgLi4udGhpcy50b090ZWxBdHRyaWJ1dGVzKGV2ZW50LmRhdGEpLFxuICAgICAgICAnZncyNC5jb3JyZWxhdGlvbl9pZCc6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICdmdzI0LmxvZ19pZCc6IGV2ZW50LmxvZ0lkLFxuICAgICAgfTtcblxuICAgICAgLy8gQWRkIG9wdGlvbmFsIGF0dHJpYnV0ZXMgb25seSBpZiBkZWZpbmVkXG4gICAgICBpZiAoZXZlbnQuc291cmNlKSBsb2dBdHRyaWJ1dGVzWyAnZncyNC5zb3VyY2UnIF0gPSBldmVudC5zb3VyY2U7XG5cbiAgICAgIC8vIEFkZCBlcnJvciBhdHRyaWJ1dGVzIGlmIHByZXNlbnRcbiAgICAgIGlmIChldmVudC5lcnJvcikge1xuICAgICAgICBpZiAoZXZlbnQuZXJyb3IudHlwZSkgbG9nQXR0cmlidXRlc1sgJ2V4Y2VwdGlvbi50eXBlJyBdID0gZXZlbnQuZXJyb3IudHlwZTtcbiAgICAgICAgaWYgKGV2ZW50LmVycm9yLm1lc3NhZ2UpIGxvZ0F0dHJpYnV0ZXNbICdleGNlcHRpb24ubWVzc2FnZScgXSA9IGV2ZW50LmVycm9yLm1lc3NhZ2U7XG4gICAgICAgIGlmIChldmVudC5lcnJvci5zdGFjaykgbG9nQXR0cmlidXRlc1sgJ2V4Y2VwdGlvbi5zdGFja3RyYWNlJyBdID0gZXZlbnQuZXJyb3Iuc3RhY2s7XG4gICAgICB9XG5cbiAgICAgIHRoaXMub3RlbExvZ2dlci5lbWl0KHtcbiAgICAgICAgc2V2ZXJpdHlOdW1iZXI6IHNldmVyaXR5LFxuICAgICAgICBzZXZlcml0eVRleHQ6IGV2ZW50LmxldmVsLnRvVXBwZXJDYXNlKCksXG4gICAgICAgIGJvZHk6IG1lc3NhZ2UsXG4gICAgICAgIGF0dHJpYnV0ZXM6IGxvZ0F0dHJpYnV0ZXMsXG4gICAgICAgIHRpbWVzdGFtcDogZXZlbnQudGltZXN0YW1wTXMsXG4gICAgICB9KTtcblxuICAgICAgbG9nZ2VyLmRlYnVnKGBFbWl0dGVkIE9URUwgbG9nOiAke2V2ZW50LmxldmVsfSAtICR7ZXZlbnQub3BlcmF0aW9ufWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGVtaXR0aW5nIE9wZW5UZWxlbWV0cnkgbG9nOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2FmZWx5IGV4dHJhY3QgbG9nIG1lc3NhZ2UgZnJvbSBldmVudCBkYXRhXG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RMb2dNZXNzYWdlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBzdHJpbmcge1xuICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZXZlbnQuZGF0YS5tZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXZlbnQub3BlcmF0aW9uIHx8ICdsb2cnO1xuICB9XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT0gVVRJTElUWSBNRVRIT0RTID09PT09PT09PT09PT09PT09PT09XG5cbiAgLyoqXG4gICAqIFR5cGUgZ3VhcmQgZm9yIHN0cmluZyBhcnJheVxuICAgKi9cbiAgcHJpdmF0ZSBpc1N0cmluZ0FycmF5KGFycjogdW5rbm93bltdKTogYXJyIGlzIHN0cmluZ1tdIHtcbiAgICByZXR1cm4gYXJyLmV2ZXJ5KCh2KTogdiBpcyBzdHJpbmcgPT4gdHlwZW9mIHYgPT09ICdzdHJpbmcnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUeXBlIGd1YXJkIGZvciBudW1iZXIgYXJyYXlcbiAgICovXG4gIHByaXZhdGUgaXNOdW1iZXJBcnJheShhcnI6IHVua25vd25bXSk6IGFyciBpcyBudW1iZXJbXSB7XG4gICAgcmV0dXJuIGFyci5ldmVyeSgodik6IHYgaXMgbnVtYmVyID0+IHR5cGVvZiB2ID09PSAnbnVtYmVyJyk7XG4gIH1cblxuICAvKipcbiAgICogVHlwZSBndWFyZCBmb3IgYm9vbGVhbiBhcnJheVxuICAgKi9cbiAgcHJpdmF0ZSBpc0Jvb2xlYW5BcnJheShhcnI6IHVua25vd25bXSk6IGFyciBpcyBib29sZWFuW10ge1xuICAgIHJldHVybiBhcnIuZXZlcnkoKHYpOiB2IGlzIGJvb2xlYW4gPT4gdHlwZW9mIHYgPT09ICdib29sZWFuJyk7XG4gIH1cblxuICAvLyBNYXggc2l6ZSBmb3IgSlNPTiBzdHJpbmdpZmllZCBhdHRyaWJ1dGVzIChYLVJheSBoYXMgfjRLQiBsaW1pdCBwZXIgYXR0cmlidXRlKVxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBNQVhfQVRUUklCVVRFX1NJWkUgPSA0MDAwO1xuXG4gIC8qKlxuICAgKiBDb252ZXJ0IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHRvIE9URUwgQXR0cmlidXRlcyAob25seSBwcmltaXRpdmUgdmFsdWVzIGFsbG93ZWQpXG4gICAqL1xuICBwcml2YXRlIHRvT3RlbEF0dHJpYnV0ZXMoYXR0cnM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IEF0dHJpYnV0ZXMge1xuICAgIGlmICghYXR0cnMpIHJldHVybiB7fTtcbiAgICBjb25zdCByZXN1bHQ6IEF0dHJpYnV0ZXMgPSB7fTtcbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJzKSkge1xuICAgICAgLy8gT1RFTCBvbmx5IGFjY2VwdHMgcHJpbWl0aXZlcyBhbmQgaG9tb2dlbmVvdXMgYXJyYXlzIG9mIHByaW1pdGl2ZXNcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIFRydW5jYXRlIGxvbmcgc3RyaW5nc1xuICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWUubGVuZ3RoID4gT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kLk1BWF9BVFRSSUJVVEVfU0laRVxuICAgICAgICAgID8gdmFsdWUuc3Vic3RyaW5nKDAsIE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpICsgJy4uLlt0cnVuY2F0ZWRdJ1xuICAgICAgICAgIDogdmFsdWU7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHwgdHlwZW9mIHZhbHVlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAvLyBPVEVMIHJlcXVpcmVzIGhvbW9nZW5lb3VzIGFycmF5cyAtIHVzZSB0eXBlIGd1YXJkc1xuICAgICAgICBpZiAodmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IFtdO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXNTdHJpbmdBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWU7XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5pc051bWJlckFycmF5KHZhbHVlKSkge1xuICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmlzQm9vbGVhbkFycmF5KHZhbHVlKSkge1xuICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBNaXhlZCBhcnJheSAtIHN0cmluZ2lmeSB3aXRoIHNpemUgbGltaXRcbiAgICAgICAgICByZXN1bHRbIGtleSBdID0gdGhpcy5zYWZlSnNvblN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodmFsdWUgIT09IG51bGwgJiYgdmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBDb252ZXJ0IGNvbXBsZXggdmFsdWVzIHRvIEpTT04gc3RyaW5nIHdpdGggc2l6ZSBsaW1pdFxuICAgICAgICByZXN1bHRbIGtleSBdID0gdGhpcy5zYWZlSnNvblN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvKipcbiAgICogU2FmZWx5IEpTT04gc3RyaW5naWZ5IHdpdGggc2l6ZSBsaW1pdCBmb3IgT1RFTCBhdHRyaWJ1dGVzXG4gICAqL1xuICBwcml2YXRlIHNhZmVKc29uU3RyaW5naWZ5KHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QganNvbiA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgIGlmIChqc29uLmxlbmd0aCA+IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpIHtcbiAgICAgICAgcmV0dXJuIGpzb24uc3Vic3RyaW5nKDAsIE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpICsgJy4uLlt0cnVuY2F0ZWRdJztcbiAgICAgIH1cbiAgICAgIHJldHVybiBqc29uO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuICdbdW5zZXJpYWxpemFibGVdJztcbiAgICB9XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBFbmQgYW55IHJlbWFpbmluZyBhY3RpdmUgc3BhbnNcbiAgICBpZiAodGhpcy5hY3RpdmVTcGFucy5zaXplID4gMCAmJiB0aGlzLnNwYW5TdGF0dXNDb2RlKSB7XG4gICAgICBsb2dnZXIud2FybihgRm9yY2UgZW5kaW5nICR7dGhpcy5hY3RpdmVTcGFucy5zaXplfSBhY3RpdmUgc3BhbnNgKTtcbiAgICAgIGNvbnN0IHN0YXR1c0NvZGUgPSB0aGlzLnNwYW5TdGF0dXNDb2RlO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5mb3JFYWNoKChzcGFuLCBlbnRpdHlJZCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHNwYW4uc2V0U3RhdHVzKHtcbiAgICAgICAgICAgIGNvZGU6IHN0YXR1c0NvZGUuRVJST1IsXG4gICAgICAgICAgICBtZXNzYWdlOiAnU3BhbiBmb3JjZS1jbG9zZWQgZHVlIHRvIExhbWJkYSBzaHV0ZG93bicsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgc3Bhbi5lbmQoKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIGZvcmNlLWVuZGluZyBzcGFuICR7ZW50aXR5SWR9OmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmNsZWFyKCk7XG4gICAgfVxuXG4gICAgLy8gVGhlIEFET1QgbGF5ZXIncyBPcGVuVGVsZW1ldHJ5IENvbGxlY3RvciBoYW5kbGVzIGZsdXNoaW5nIGF1dG9tYXRpY2FsbHlcbiAgICAvLyBXZSBkb24ndCBuZWVkIHRvIG1hbnVhbGx5IGZsdXNoIC0gdGhlIGNvbGxlY3RvciBiYXRjaGVzIGFuZCBleHBvcnRzIHRvIFgtUmF5XG4gICAgbG9nZ2VyLmRlYnVnKCdPVEVMIGJhY2tlbmQgZmx1c2ggY29tcGxldGUgKEFET1QgY29sbGVjdG9yIGhhbmRsZXMgZXhwb3J0KScpO1xuICB9XG5cbiAgZGVzdHJveSgpOiB2b2lkIHtcbiAgICB0aGlzLmFjdGl2ZVNwYW5zLmNsZWFyKCk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXNldCBjb2xkIHN0YXJ0IGZsYWcgKGZvciB0ZXN0aW5nKVxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNldENvbGRTdGFydEZsYWcoKTogdm9pZCB7XG4gIGNvbGRTdGFydEZsYWcgPSB0cnVlO1xufVxuIl19