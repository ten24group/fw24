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
const otel_links_1 = require("./otel-links");
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
        // FW24 span export: consolidated span records + OTEL-only span.start markers.
        if (type === 'span' || type === 'span.start') {
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
        switch (event.type) {
            case 'span':
                // Consolidated span: single record containing start+events+end
                this.handleConsolidatedSpan(event);
                break;
            case 'span.start':
                this.handleSpanStart(event);
                break;
        }
    }
    /**
     * Handle consolidated span (single record with all span data).
     *
     * In consolidated mode:
     * 1. span.start was already sent (OTEL-only) to establish parent context
     * 2. This 'span' event contains all data and signals completion
     * 3. We find the existing OTEL span, update it, and end it
     */
    handleConsolidatedSpan(event) {
        if (!event.observabilityLogId || !this.spanStatusCode)
            return;
        const spanId = event.observabilityLogId;
        // IMPORTANT: FW24 consolidated spans store timestampMs as the *start* time (for UI ordering).
        // End time is derived from (start + durationMs).
        const startTime = event.timestampMs ?? Date.now();
        const durationMs = event.durationMs ?? 0;
        const endTime = durationMs > 0 ? startTime + durationMs : Date.now();
        const statusCode = this.spanStatusCode;
        // Look for existing span (created by span.start in consolidated mode)
        const existingSpan = this.activeSpans.get(spanId);
        if (existingSpan) {
            // Found existing span - update and end it
            try {
                // Add tags/attributes as OTEL span attributes.
                if (event.tags) {
                    existingSpan.setAttributes(this.toOtelAttributes(event.tags));
                }
                if (event.attributes) {
                    existingSpan.setAttributes(this.toOtelAttributes(event.attributes));
                }
                // Add metrics as prefixed attributes
                if (event.metrics) {
                    Object.entries(event.metrics).forEach(([key, value]) => {
                        existingSpan.setAttribute(`metric.${key}`, value);
                    });
                }
                if (event.durationMs) {
                    existingSpan.setAttribute('duration_ms', event.durationMs);
                }
                // Add checkpoints as OTEL events (from data.checkpoints).
                const data = event.data;
                if (data?.checkpoints && Array.isArray(data.checkpoints)) {
                    for (const cp of data.checkpoints) {
                        const checkpoint = cp;
                        const name = typeof checkpoint.name === 'string' ? checkpoint.name : 'checkpoint';
                        const ts = typeof checkpoint.ts === 'number' ? checkpoint.ts : undefined;
                        // OTEL Attributes do not support nested objects; encode structured checkpoint details as JSON strings.
                        const attrs = {};
                        if (checkpoint.tags && typeof checkpoint.tags === 'object')
                            attrs['fw24.checkpoint.tags'] = JSON.stringify(checkpoint.tags);
                        if (checkpoint.metrics && typeof checkpoint.metrics === 'object')
                            attrs['fw24.checkpoint.metrics'] = JSON.stringify(checkpoint.metrics);
                        if (checkpoint.data && typeof checkpoint.data === 'object')
                            attrs['fw24.checkpoint.data'] = JSON.stringify(checkpoint.data);
                        if (checkpoint.error && typeof checkpoint.error === 'object')
                            attrs['fw24.checkpoint.error'] = JSON.stringify(checkpoint.error);
                        existingSpan.addEvent(name, attrs, ts);
                    }
                }
                // Set status
                if (event.error) {
                    existingSpan.setStatus({
                        code: statusCode.ERROR,
                        message: event.error.message ?? event.status ?? 'Error',
                    });
                    existingSpan.recordException({
                        name: event.error.type,
                        message: event.error.message,
                        stack: event.error.stack,
                    });
                }
                else if (event.success === false) {
                    existingSpan.setStatus({
                        code: statusCode.ERROR,
                        message: event.status ?? 'Failed',
                    });
                }
                else {
                    existingSpan.setStatus({ code: statusCode.OK });
                }
                existingSpan.end(endTime);
                this.activeSpans.delete(spanId);
                logger.debug(`Ended consolidated OTEL span: ${event.operation} (${spanId})`);
            }
            catch (error) {
                logger.warn('Failed to end consolidated span:', error);
            }
            return;
        }
        // Fallback: No existing span found (span.start might have been filtered)
        // Create a new span with all data and end it immediately
        if (!this.tracer || !this.trace || !this.contextApi)
            return;
        try {
            const isColdStart = this.invocationCount === 1;
            // In fallback mode we still treat timestampMs as start time.
            const duration = event.durationMs ?? 0;
            const startTime = event.timestampMs ?? Date.now();
            const endTime = duration > 0 ? startTime + duration : Date.now();
            let context = this.contextApi.active();
            if (event.parentObservabilityLogId) {
                const parentSpan = this.activeSpans.get(event.parentObservabilityLogId);
                if (parentSpan) {
                    context = this.trace.setSpan(context, parentSpan);
                }
            }
            const spanAttributes = {
                'operation.name': event.operation ?? 'unknown',
                'trace.id': event.correlationId,
                'span.id': spanId,
                ...(event.actor?.actorId && { 'user.id': event.actor.actorId }),
                ...(event.actor?.tenantId && { 'tenant.id': event.actor.tenantId }),
                ...(event.source && { 'code.function': event.source }),
                ...(isColdStart && { 'faas.coldstart': true }),
                ...this.toOtelAttributes(event.tags), // Clean API
                ...this.toOtelAttributes(event.attributes), // Legacy
            };
            // Add metrics as prefixed attributes
            if (event.metrics) {
                Object.entries(event.metrics).forEach(([key, value]) => {
                    spanAttributes[`metric.${key}`] = value;
                });
            }
            const span = this.tracer.startSpan(event.operation ?? 'unknown', {
                kind: (0, span_utils_1.getSpanKind)(event.subType),
                startTime: startTime,
                attributes: spanAttributes,
                links: (0, otel_links_1.buildCausedByLinks)(event),
            }, context);
            // Add checkpoints from data (canonical).
            const data = event.data;
            if (data?.checkpoints && Array.isArray(data.checkpoints)) {
                for (const cp of data.checkpoints) {
                    const checkpoint = cp;
                    const name = typeof checkpoint.name === 'string' ? checkpoint.name : 'checkpoint';
                    const ts = typeof checkpoint.ts === 'number' ? checkpoint.ts : undefined;
                    // OTEL Attributes do not support nested objects; encode structured checkpoint details as JSON strings.
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
            }
            // Set status and end
            if (event.success === false || event.error) {
                span.setStatus({
                    code: statusCode.ERROR,
                    message: event.error?.message ?? event.status ?? 'Error',
                });
                if (event.error) {
                    span.recordException({
                        name: event.error.type,
                        message: event.error.message,
                        stack: event.error.stack,
                    });
                }
            }
            else {
                span.setStatus({ code: statusCode.OK });
            }
            span.end(endTime);
            logger.debug(`Created and ended consolidated OTEL span (fallback): ${event.operation} (${spanId})`);
        }
        catch (error) {
            logger.warn('Failed to handle consolidated span (fallback):', error);
        }
    }
    handleSpanStart(event) {
        // Use observabilityLogId as span ID (consistent with consolidated mode)
        const spanId = event.observabilityLogId;
        if (!spanId || !this.tracer || !this.trace || !this.contextApi)
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
                'fw24.span_id': spanId,
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
                links: (0, otel_links_1.buildCausedByLinks)(event),
            }, context);
            this.activeSpans.set(spanId, span);
            logger.debug(`Created OpenTelemetry span: ${event.operation} (${spanId})`, {
                coldStart: isRootSpan ? isColdStart : undefined,
                invocation: this.invocationCount,
            });
        }
        catch (error) {
            logger.error('Error creating OpenTelemetry span:', error);
        }
    }
    // Legacy span.event/span.end are intentionally not supported.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL290ZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUVHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBb25CSCxnREFFQztBQXBuQkQsaUNBQW9EO0FBRXBELDJDQUE2QztBQUM3QyxvREFBa0Q7QUFDbEQsNkNBQWtEO0FBT2xELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQywwQkFBMEIsQ0FBQyxDQUFDO0FBRXhELCtCQUErQjtBQUMvQixJQUFJLGFBQWEsR0FBRyxJQUFJLENBQUM7QUFFekIsaUNBQWlDO0FBQ2pDLE1BQU0scUJBQXFCLEdBQTZDO0lBQ3RFLEtBQUssRUFBRSxDQUFDLEVBQUksUUFBUTtJQUNwQixLQUFLLEVBQUUsQ0FBQyxFQUFJLFFBQVE7SUFDcEIsSUFBSSxFQUFFLENBQUMsRUFBSyxPQUFPO0lBQ25CLElBQUksRUFBRSxFQUFFLEVBQUksT0FBTztJQUNuQixLQUFLLEVBQUUsRUFBRSxFQUFHLFFBQVE7SUFDcEIsUUFBUSxFQUFFLEVBQUUsRUFBRSxRQUFRO0NBQ3ZCLENBQUM7QUFPSyxJQUFNLHdCQUF3QixHQUE5QixNQUFNLHdCQUF3Qjs7SUFDbkIsSUFBSSxHQUFHLE1BQU0sQ0FBQztJQUNkLFFBQVEsQ0FBc0I7SUFFN0IsV0FBVyxDQUFTO0lBRXJDLG1CQUFtQjtJQUNYLE1BQU0sR0FBa0IsSUFBSSxDQUFDO0lBQzdCLEtBQUssR0FBb0IsSUFBSSxDQUFDO0lBQzlCLFVBQVUsR0FBc0IsSUFBSSxDQUFDO0lBQ3JDLGNBQWMsR0FBaUMsSUFBSSxDQUFDO0lBQ3BELFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFB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T0FBTyxFQUFFLHNCQUFzQjtRQUMvQixVQUFVLEVBQUUsTUFBTTtRQUNsQixJQUFJLEVBQUUsQ0FBRSxlQUFlLEVBQUUsU0FBUyxFQUFFLE1BQU0sQ0FBRTtLQUM3QyxDQUFDO0lBNEJHLFdBQUEsSUFBQSxpQkFBWSxFQUFDLDJCQUEyQixDQUFDLENBQUE7SUFDekMsV0FBQSxJQUFBLGlCQUFZLEVBQUMsd0JBQXdCLENBQUMsQ0FBQTtHQTVCOUIsd0JBQXdCLENBZ2xCcEM7QUFFRCwwQ0FBMEM7QUFDMUMsU0FBZ0Isa0JBQWtCO0lBQ2hDLGFBQWEsR0FBRyxJQUFJLENBQUM7QUFDdkIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT3BlblRlbGVtZXRyeSBCYWNrZW5kIGZvciBBV1MgWC1SYXkgSW50ZWdyYXRpb25cbiAqIFxuICogSU1QT1JUQU5UOiBUaGlzIGJhY2tlbmQgaXMgZGVzaWduZWQgdG8gd29yayB3aXRoIEFXUyBMYW1iZGEncyBtYW5hZ2VkIEFET1QgbGF5ZXIuXG4gKiBcbiAqICMjIFdoeSBBRE9UL09wZW5UZWxlbWV0cnkgKE5vdCBYLVJheSBTREspXG4gKiBcbiAqIEFXUyBYLVJheSBTREsgaXMgYmVpbmcgZGVwcmVjYXRlZCAoZW5kLW9mLXN1cHBvcnQ6IEZlYiAyNSwgMjAyNyk6XG4gKiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20veHJheS9sYXRlc3QvZGV2Z3VpZGUveHJheS1zZGstbm9kZWpzLmh0bWxcbiAqIFxuICogQVdTIHJlY29tbWVuZHMgbWlncmF0aW5nIHRvIE9wZW5UZWxlbWV0cnk6XG4gKiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20veHJheS9sYXRlc3QvZGV2Z3VpZGUveHJheS1pbnN0cnVtZW50aW5nLXlvdXItYXBwLmh0bWwjeHJheS1pbnN0cnVtZW50aW5nLW9wZW50ZWxcbiAqIFxuICogIyMgQVdTIEFET1QgTGFtYmRhIExheWVyXG4gKiBcbiAqIEFXUyBwcm92aWRlcyBhIG1hbmFnZWQgTGFtYmRhIGxheWVyIHRoYXQgaW5jbHVkZXMgT3BlblRlbGVtZXRyeSBpbnN0cnVtZW50YXRpb246XG4gKiAtIEFSTjogYXJuOmF3czpsYW1iZGE6PHJlZ2lvbj46OTAxOTIwNTcwNDYzOmxheWVyOmF3cy1vdGVsLW5vZGVqcy08YXJjaD4tdmVyLTEtMzAtMjoxXG4gKiAtIEF1dG9tYXRpY2FsbHkgaW5zdHJ1bWVudHMgQVdTIFNESywgSFRUUCwgYW5kIExhbWJkYSBpbnZvY2F0aW9uc1xuICogLSBFeHBvcnRzIHRvIFgtUmF5IHZpYSBPcGVuVGVsZW1ldHJ5IENvbGxlY3RvclxuICogLSBXM0MgVHJhY2UgQ29udGV4dCArIFgtUmF5IHByb3BhZ2F0aW9uXG4gKiBcbiAqICMjIEFyY2hpdGVjdHVyZVxuICogXG4gKiBUaGUgQURPVCBsYXllciBwcm92aWRlcyBPcGVuVGVsZW1ldHJ5IHBhY2thZ2VzIGF0IHJ1bnRpbWU6XG4gKiAtIEBvcGVudGVsZW1ldHJ5L2FwaSAoZm9yIGdldHRpbmcgdHJhY2VycyBhbmQgY3JlYXRpbmcgc3BhbnMpXG4gKiAtIEBvcGVudGVsZW1ldHJ5L3Nkay10cmFjZS1ub2RlIChmb3IgdHJhY2VyIGNvbmZpZ3VyYXRpb24pXG4gKiAtIEFET1QgQ29sbGVjdG9yIHJ1bm5pbmcgYXMgTGFtYmRhIGV4dGVuc2lvblxuICogXG4gKiBXZSBpbXBvcnQgdGhlc2UgcGFja2FnZXMgYnV0IG1hcmsgdGhlbSBhcyBleHRlcm5hbCBpbiBidW5kbGluZywgc286XG4gKiAtIERldmVsb3BtZW50OiBDYW4gdGVzdCBsb2NhbGx5IHdpdGggT1RFTCBwYWNrYWdlcyBpbnN0YWxsZWRcbiAqIC0gUHJvZHVjdGlvbjogVXNlcyBwYWNrYWdlcyBmcm9tIEFET1QgbGF5ZXIgKHplcm8gYnVuZGxlIHNpemUpXG4gKiBcbiAqICMjIFN1cHBvcnRlZCBFdmVudCBUeXBlc1xuICogXG4gKiBUaGlzIGJhY2tlbmQgaGFuZGxlcyB0aGUgZm9sbG93aW5nIGV2ZW50czpcbiAqIC0gc3Bhbi4qIOKGkiBPVEVMIFRyYWNlcyAoc3BhbnMgd2l0aCBwYXJlbnQtY2hpbGQgcmVsYXRpb25zaGlwcylcbiAqIC0gbWV0cmljIOKGkiBPVEVMIE1ldHJpY3MgKGNvdW50ZXJzLCBnYXVnZXMsIGhpc3RvZ3JhbXMpXG4gKiAtIGxvZyDihpIgT1RFTCBMb2dzIChzdHJ1Y3R1cmVkIGxvZyBldmVudHMpXG4gKiBcbiAqIE5PVCBoYW5kbGVkICh1c2UgRHluYW1vREIgYmFja2VuZCBmb3IgcGVyc2lzdGVuY2UpOlxuICogLSBhdWRpdC4qIOKGkiBCdXNpbmVzcyByZWNvcmRzIChub3QgdGVsZW1ldHJ5KVxuICogLSBkZWNpc2lvbi4qIOKGkiBCdXNpbmVzcyByZWNvcmRzIChub3QgdGVsZW1ldHJ5KVxuICogLSBhY2Nlc3MuKiDihpIgQnVzaW5lc3MgcmVjb3JkcyAobm90IHRlbGVtZXRyeSlcbiAqIC0gd29ya2Zsb3cuKiDihpIgTG9uZy1ydW5uaW5nIHN0YXRlIChkb2Vzbid0IGZpdCBPVEVMJ3MgZXBoZW1lcmFsIHNwYW4gbW9kZWwpXG4gKiBcbiAqICMjIFNldHVwIGluIENESy9TQU1cbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgVHJhY2luZyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuICogXG4gKiBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnTXlGdW5jdGlvbicsIHtcbiAqICAgbGF5ZXJzOiBbXG4gKiAgICAgTGF5ZXJWZXJzaW9uLmZyb21MYXllclZlcnNpb25Bcm4odGhpcywgJ0Fkb3RMYXllcicsXG4gKiAgICAgICAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjkwMTkyMDU3MDQ2MzpsYXllcjphd3Mtb3RlbC1ub2RlanMtYW1kNjQtdmVyLTEtMzAtMjoxJ1xuICogICAgIClcbiAqICAgXSxcbiAqICAgZW52aXJvbm1lbnQ6IHtcbiAqICAgICBBV1NfTEFNQkRBX0VYRUNfV1JBUFBFUjogJy9vcHQvb3RlbC1oYW5kbGVyJyxcbiAqICAgICBPQlNFUlZBQklMSVRZX0JBQ0tFTkRTOiAnb3RlbCcsIC8vIEZXMjQgY29uZmlnXG4gKiAgIH0sXG4gKiAgIHRyYWNpbmc6IFRyYWNpbmcuQUNUSVZFLCAvLyBFbmFibGUgWC1SYXlcbiAqICAgYnVuZGxpbmc6IHtcbiAqICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAqICAgICAgICdAb3BlbnRlbGVtZXRyeS8qJywgLy8gUHJvdmlkZWQgYnkgTGFtYmRhIGxheWVyXG4gKiAgICAgXSxcbiAqICAgfSxcbiAqIH0pO1xuICogYGBgXG4gKiBcbiAqIFJlZmVyZW5jZXM6XG4gKiAtIGh0dHBzOi8vYXdzLW90ZWwuZ2l0aHViLmlvL2RvY3MvZ2V0dGluZy1zdGFydGVkL2xhbWJkYS9sYW1iZGEtanNcbiAqIC0gaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2xhbWJkYS9sYXRlc3QvZGcvdHlwZXNjcmlwdC10cmFjaW5nLmh0bWxcbiAqIC0gaHR0cHM6Ly9vcGVudGVsZW1ldHJ5LmlvL2RvY3MvbGFuZ3VhZ2VzL2pzL1xuICovXG5cbmltcG9ydCB7IEluamVjdGFibGUsIEluamVjdENvbmZpZyB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCwgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBnZXRTcGFuS2luZCB9IGZyb20gJy4uL3V0aWxzL3NwYW4tdXRpbHMnO1xuaW1wb3J0IHsgYnVpbGRDYXVzZWRCeUxpbmtzIH0gZnJvbSAnLi9vdGVsLWxpbmtzJztcblxuLy8gSW1wb3J0IHR5cGVzIGZyb20gQG9wZW50ZWxlbWV0cnkvYXBpXG5pbXBvcnQgdHlwZSB7IFRyYWNlciwgU3BhbiwgU3BhblN0YXR1c0NvZGUsIFRyYWNlQVBJLCBDb250ZXh0QVBJLCBBdHRyaWJ1dGVzIH0gZnJvbSAnQG9wZW50ZWxlbWV0cnkvYXBpJztcbmltcG9ydCB0eXBlIHsgTWV0ZXIgfSBmcm9tICdAb3BlbnRlbGVtZXRyeS9hcGknO1xuaW1wb3J0IHR5cGUgeyBMb2dnZXIgYXMgT1RFTExvZ2dlciB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaS1sb2dzJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQnKTtcblxuLy8gTW9kdWxlLWxldmVsIGNvbGQgc3RhcnQgZmxhZ1xubGV0IGNvbGRTdGFydEZsYWcgPSB0cnVlO1xuXG4vLyBPVEVMIFNldmVyaXR5IG1hcHBpbmcgZm9yIGxvZ3NcbmNvbnN0IExPR19MRVZFTF9UT19TRVZFUklUWTogUmVjb3JkPE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZywgbnVtYmVyPiA9IHtcbiAgdHJhY2U6IDEsICAgLy8gVFJBQ0VcbiAgZGVidWc6IDUsICAgLy8gREVCVUdcbiAgaW5mbzogOSwgICAgLy8gSU5GT1xuICB3YXJuOiAxMywgICAvLyBXQVJOXG4gIGVycm9yOiAxNywgIC8vIEVSUk9SXG4gIGNyaXRpY2FsOiAyMSwgLy8gRkFUQUxcbn07XG5cbkBJbmplY3RhYmxlKHtcbiAgcHJvdmlkZTogJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgcHJvdmlkZWRJbjogJ1JPT1QnLFxuICB0YWdzOiBbICdvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCAnb3RlbCcgXVxufSlcbmV4cG9ydCBjbGFzcyBPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ290ZWwnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBzZXJ2aWNlTmFtZTogc3RyaW5nO1xuXG4gIC8vIFRyYWNlIGNvbXBvbmVudHNcbiAgcHJpdmF0ZSB0cmFjZXI6IFRyYWNlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRyYWNlOiBUcmFjZUFQSSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNvbnRleHRBcGk6IENvbnRleHRBUEkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzcGFuU3RhdHVzQ29kZTogdHlwZW9mIFNwYW5TdGF0dXNDb2RlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgYWN0aXZlU3BhbnMgPSBuZXcgTWFwPHN0cmluZywgU3Bhbj4oKTtcblxuICAvLyBNZXRyaWNzIGNvbXBvbmVudFxuICBwcml2YXRlIG1ldGVyOiBNZXRlciB8IG51bGwgPSBudWxsO1xuXG4gIC8vIExvZ3MgY29tcG9uZW50c1xuICBwcml2YXRlIG90ZWxMb2dnZXI6IE9URUxMb2dnZXIgfCBudWxsID0gbnVsbDtcblxuICAvLyBTdGF0ZVxuICBwcml2YXRlIGlzT1RFTEF2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGlzTWV0cmljc0F2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGlzTG9nc0F2YWlsYWJsZTogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGludm9jYXRpb25Db3VudDogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSBpbml0aWFsaXphdGlvblByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LnNlcnZpY2VOYW1lJykgc2VydmljZU5hbWU6IHN0cmluZyxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5Lm1pbkxldmVsJykgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFxuICApIHtcbiAgICB0aGlzLnNlcnZpY2VOYW1lID0gc2VydmljZU5hbWU7XG4gICAgdGhpcy5taW5MZXZlbCA9IG1pbkxldmVsO1xuICAgIC8vIExhenkgaW5pdGlhbGl6YXRpb24gLSBkbyBub3Qgc3RhcnQgYXN5bmMgcHJvY2VzcyBpbiBjb25zdHJ1Y3RvclxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpbml0aWFsaXplT3BlblRlbGVtZXRyeSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5pc09URUxBdmFpbGFibGUpIHJldHVybjtcblxuICAgIC8vIEluaXRpYWxpemUgVHJhY2VzXG4gICAgdHJ5IHtcbiAgICAgIC8vIER5bmFtaWMgaW1wb3J0IHdyYXBwZWQgaW4gdHJ5LWNhdGNoIHRvIHNhZmVseSBoYW5kbGUgbWlzc2luZyBsYXllclxuICAgICAgY29uc3Qgb3RlbCA9IGF3YWl0IGltcG9ydCgnQG9wZW50ZWxlbWV0cnkvYXBpJyk7XG4gICAgICB0aGlzLnRyYWNlID0gb3RlbC50cmFjZTtcbiAgICAgIHRoaXMuY29udGV4dEFwaSA9IG90ZWwuY29udGV4dDtcbiAgICAgIHRoaXMuc3BhblN0YXR1c0NvZGUgPSBvdGVsLlNwYW5TdGF0dXNDb2RlO1xuXG4gICAgICB0aGlzLnRyYWNlciA9IG90ZWwudHJhY2UuZ2V0VHJhY2VyKFxuICAgICAgICB0aGlzLnNlcnZpY2VOYW1lLFxuICAgICAgICBwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcxLjAuMCdcbiAgICAgICk7XG5cbiAgICAgIHRoaXMuaXNPVEVMQXZhaWxhYmxlID0gdHJ1ZTtcbiAgICAgIGxvZ2dlci5pbmZvKCdPcGVuVGVsZW1ldHJ5IFRyYWNlcyBBUEkgYXZhaWxhYmxlJyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaXNPVEVMQXZhaWxhYmxlID0gZmFsc2U7XG4gICAgICAvLyBPbmx5IHdhcm4gb25jZVxuICAgICAgaWYgKCF0aGlzLmluaXRpYWxpemF0aW9uUHJvbWlzZSkge1xuICAgICAgICBsb2dnZXIud2FybignT3BlblRlbGVtZXRyeSBUcmFjZXMgQVBJIG5vdCBhdmFpbGFibGUnLCB7XG4gICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSBNZXRyaWNzXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG90ZWxNZXRyaWNzID0gYXdhaXQgaW1wb3J0KCdAb3BlbnRlbGVtZXRyeS9hcGknKTtcbiAgICAgIGlmIChvdGVsTWV0cmljcy5tZXRyaWNzKSB7XG4gICAgICAgIHRoaXMubWV0ZXIgPSBvdGVsTWV0cmljcy5tZXRyaWNzLmdldE1ldGVyKFxuICAgICAgICAgIHRoaXMuc2VydmljZU5hbWUsXG4gICAgICAgICAgcHJvY2Vzcy5lbnYubnBtX3BhY2thZ2VfdmVyc2lvbiB8fCAnMS4wLjAnXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuaXNNZXRyaWNzQXZhaWxhYmxlID0gdHJ1ZTtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ09wZW5UZWxlbWV0cnkgTWV0cmljcyBBUEkgYXZhaWxhYmxlJyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaXNNZXRyaWNzQXZhaWxhYmxlID0gZmFsc2U7XG4gICAgICBsb2dnZXIuZGVidWcoJ09wZW5UZWxlbWV0cnkgTWV0cmljcyBBUEkgbm90IGF2YWlsYWJsZScsIHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgTG9nc1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBvdGVsTG9ncyA9IGF3YWl0IGltcG9ydCgnQG9wZW50ZWxlbWV0cnkvYXBpLWxvZ3MnKTtcbiAgICAgIGlmIChvdGVsTG9ncy5sb2dzKSB7XG4gICAgICAgIHRoaXMub3RlbExvZ2dlciA9IG90ZWxMb2dzLmxvZ3MuZ2V0TG9nZ2VyKFxuICAgICAgICAgIHRoaXMuc2VydmljZU5hbWUsXG4gICAgICAgICAgcHJvY2Vzcy5lbnYubnBtX3BhY2thZ2VfdmVyc2lvbiB8fCAnMS4wLjAnXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuaXNMb2dzQXZhaWxhYmxlID0gdHJ1ZTtcbiAgICAgICAgbG9nZ2VyLmluZm8oJ09wZW5UZWxlbWV0cnkgTG9ncyBBUEkgYXZhaWxhYmxlJyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaXNMb2dzQXZhaWxhYmxlID0gZmFsc2U7XG4gICAgICBsb2dnZXIuZGVidWcoJ09wZW5UZWxlbWV0cnkgTG9ncyBBUEkgbm90IGF2YWlsYWJsZScsIHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmlzT1RFTEF2YWlsYWJsZSkge1xuICAgICAgbG9nZ2VyLmluZm8oYE9URUwgQmFja2VuZCBpbml0aWFsaXplZCBmb3I6ICR7dGhpcy5zZXJ2aWNlTmFtZX1gLCB7XG4gICAgICAgIHRyYWNlczogdGhpcy5pc09URUxBdmFpbGFibGUsXG4gICAgICAgIG1ldHJpY3M6IHRoaXMuaXNNZXRyaWNzQXZhaWxhYmxlLFxuICAgICAgICBsb2dzOiB0aGlzLmlzTG9nc0F2YWlsYWJsZSxcbiAgICAgICAgeHJheVRyYWNlSWQ6IHByb2Nlc3MuZW52Ll9YX0FNWk5fVFJBQ0VfSUQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuc3VyZUluaXRpYWxpemVkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5pbml0aWFsaXphdGlvblByb21pc2UpIHtcbiAgICAgIHRoaXMuaW5pdGlhbGl6YXRpb25Qcm9taXNlID0gdGhpcy5pbml0aWFsaXplT3BlblRlbGVtZXRyeSgpO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLmluaXRpYWxpemF0aW9uUHJvbWlzZTtcbiAgfVxuXG4gIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIHRoaXMuaW52b2NhdGlvbkNvdW50Kys7XG5cbiAgICBjb25zdCBpc0NvbGRTdGFydCA9IGNvbGRTdGFydEZsYWc7XG4gICAgaWYgKGNvbGRTdGFydEZsYWcpIHtcbiAgICAgIGNvbGRTdGFydEZsYWcgPSBmYWxzZTtcbiAgICAgIGxvZ2dlci5pbmZvKCdDb2xkIHN0YXJ0IGRldGVjdGVkJywge1xuICAgICAgICBpbnZvY2F0aW9uOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgICAgY29sZFN0YXJ0OiB0cnVlLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYWN0aXZlU3BhbnMuc2l6ZSA+IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKGBDbGVhbmluZyB1cCAke3RoaXMuYWN0aXZlU3BhbnMuc2l6ZX0gb3JwaGFuZWQgc3BhbnMgZnJvbSBwcmV2aW91cyBpbnZvY2F0aW9uYCk7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmZvckVhY2goKHNwYW4sIGVudGl0eUlkKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3Bhbi5lbmQoKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIGVuZGluZyBvcnBoYW5lZCBzcGFuICR7ZW50aXR5SWR9OmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmNsZWFyKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpO1xuXG4gICAgY29uc3QgdHlwZSA9IGV2ZW50LnR5cGU7XG5cbiAgICAvLyBGVzI0IHNwYW4gZXhwb3J0OiBjb25zb2xpZGF0ZWQgc3BhbiByZWNvcmRzICsgT1RFTC1vbmx5IHNwYW4uc3RhcnQgbWFya2Vycy5cbiAgICBpZiAodHlwZSA9PT0gJ3NwYW4nIHx8IHR5cGUgPT09ICdzcGFuLnN0YXJ0Jykge1xuICAgICAgaWYgKCF0aGlzLmlzT1RFTEF2YWlsYWJsZSkgcmV0dXJuO1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVTcGFuRXZlbnQoZXZlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAnbWV0cmljJykge1xuICAgICAgaWYgKCF0aGlzLmlzTWV0cmljc0F2YWlsYWJsZSkgcmV0dXJuO1xuICAgICAgdGhpcy5oYW5kbGVNZXRyaWNFdmVudChldmVudCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICdsb2cnKSB7XG4gICAgICBpZiAoIXRoaXMuaXNMb2dzQXZhaWxhYmxlKSByZXR1cm47XG4gICAgICB0aGlzLmhhbmRsZUxvZ0V2ZW50KGV2ZW50KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PSBTUEFOIEhBTkRMSU5HID09PT09PT09PT09PT09PT09PT09XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTcGFuRXZlbnQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHN3aXRjaCAoZXZlbnQudHlwZSkge1xuICAgICAgY2FzZSAnc3Bhbic6XG4gICAgICAgIC8vIENvbnNvbGlkYXRlZCBzcGFuOiBzaW5nbGUgcmVjb3JkIGNvbnRhaW5pbmcgc3RhcnQrZXZlbnRzK2VuZFxuICAgICAgICB0aGlzLmhhbmRsZUNvbnNvbGlkYXRlZFNwYW4oZXZlbnQpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3NwYW4uc3RhcnQnOlxuICAgICAgICB0aGlzLmhhbmRsZVNwYW5TdGFydChldmVudCk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGUgY29uc29saWRhdGVkIHNwYW4gKHNpbmdsZSByZWNvcmQgd2l0aCBhbGwgc3BhbiBkYXRhKS5cbiAgICogXG4gICAqIEluIGNvbnNvbGlkYXRlZCBtb2RlOlxuICAgKiAxLiBzcGFuLnN0YXJ0IHdhcyBhbHJlYWR5IHNlbnQgKE9URUwtb25seSkgdG8gZXN0YWJsaXNoIHBhcmVudCBjb250ZXh0XG4gICAqIDIuIFRoaXMgJ3NwYW4nIGV2ZW50IGNvbnRhaW5zIGFsbCBkYXRhIGFuZCBzaWduYWxzIGNvbXBsZXRpb25cbiAgICogMy4gV2UgZmluZCB0aGUgZXhpc3RpbmcgT1RFTCBzcGFuLCB1cGRhdGUgaXQsIGFuZCBlbmQgaXRcbiAgICovXG4gIHByaXZhdGUgaGFuZGxlQ29uc29saWRhdGVkU3BhbihldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQgfHwgIXRoaXMuc3BhblN0YXR1c0NvZGUpIHJldHVybjtcblxuICAgIGNvbnN0IHNwYW5JZCA9IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAvLyBJTVBPUlRBTlQ6IEZXMjQgY29uc29saWRhdGVkIHNwYW5zIHN0b3JlIHRpbWVzdGFtcE1zIGFzIHRoZSAqc3RhcnQqIHRpbWUgKGZvciBVSSBvcmRlcmluZykuXG4gICAgLy8gRW5kIHRpbWUgaXMgZGVyaXZlZCBmcm9tIChzdGFydCArIGR1cmF0aW9uTXMpLlxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IGV2ZW50LnRpbWVzdGFtcE1zID8/IERhdGUubm93KCk7XG4gICAgY29uc3QgZHVyYXRpb25NcyA9IGV2ZW50LmR1cmF0aW9uTXMgPz8gMDtcbiAgICBjb25zdCBlbmRUaW1lID0gZHVyYXRpb25NcyA+IDAgPyBzdGFydFRpbWUgKyBkdXJhdGlvbk1zIDogRGF0ZS5ub3coKTtcbiAgICBjb25zdCBzdGF0dXNDb2RlID0gdGhpcy5zcGFuU3RhdHVzQ29kZTtcblxuICAgIC8vIExvb2sgZm9yIGV4aXN0aW5nIHNwYW4gKGNyZWF0ZWQgYnkgc3Bhbi5zdGFydCBpbiBjb25zb2xpZGF0ZWQgbW9kZSlcbiAgICBjb25zdCBleGlzdGluZ1NwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChzcGFuSWQpO1xuXG4gICAgaWYgKGV4aXN0aW5nU3Bhbikge1xuICAgICAgLy8gRm91bmQgZXhpc3Rpbmcgc3BhbiAtIHVwZGF0ZSBhbmQgZW5kIGl0XG4gICAgICB0cnkge1xuICAgICAgICAvLyBBZGQgdGFncy9hdHRyaWJ1dGVzIGFzIE9URUwgc3BhbiBhdHRyaWJ1dGVzLlxuICAgICAgICBpZiAoZXZlbnQudGFncykge1xuICAgICAgICAgIGV4aXN0aW5nU3Bhbi5zZXRBdHRyaWJ1dGVzKHRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC50YWdzKSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGV2ZW50LmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBleGlzdGluZ1NwYW4uc2V0QXR0cmlidXRlcyh0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcykpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIG1ldHJpY3MgYXMgcHJlZml4ZWQgYXR0cmlidXRlc1xuICAgICAgICBpZiAoZXZlbnQubWV0cmljcykge1xuICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgICBleGlzdGluZ1NwYW4uc2V0QXR0cmlidXRlKGBtZXRyaWMuJHtrZXl9YCwgdmFsdWUpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMpIHtcbiAgICAgICAgICBleGlzdGluZ1NwYW4uc2V0QXR0cmlidXRlKCdkdXJhdGlvbl9tcycsIGV2ZW50LmR1cmF0aW9uTXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIGNoZWNrcG9pbnRzIGFzIE9URUwgZXZlbnRzIChmcm9tIGRhdGEuY2hlY2twb2ludHMpLlxuICAgICAgICBjb25zdCBkYXRhID0gZXZlbnQuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKGRhdGE/LmNoZWNrcG9pbnRzICYmIEFycmF5LmlzQXJyYXkoZGF0YS5jaGVja3BvaW50cykpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNwIG9mIGRhdGEuY2hlY2twb2ludHMpIHtcbiAgICAgICAgICAgIGNvbnN0IGNoZWNrcG9pbnQgPSBjcCBhcyB7IG5hbWU/OiB1bmtub3duOyB0cz86IHVua25vd247IHRhZ3M/OiB1bmtub3duOyBtZXRyaWNzPzogdW5rbm93bjsgZGF0YT86IHVua25vd247IGVycm9yPzogdW5rbm93biB9O1xuICAgICAgICAgICAgY29uc3QgbmFtZSA9IHR5cGVvZiBjaGVja3BvaW50Lm5hbWUgPT09ICdzdHJpbmcnID8gY2hlY2twb2ludC5uYW1lIDogJ2NoZWNrcG9pbnQnO1xuICAgICAgICAgICAgY29uc3QgdHMgPSB0eXBlb2YgY2hlY2twb2ludC50cyA9PT0gJ251bWJlcicgPyBjaGVja3BvaW50LnRzIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgLy8gT1RFTCBBdHRyaWJ1dGVzIGRvIG5vdCBzdXBwb3J0IG5lc3RlZCBvYmplY3RzOyBlbmNvZGUgc3RydWN0dXJlZCBjaGVja3BvaW50IGRldGFpbHMgYXMgSlNPTiBzdHJpbmdzLlxuICAgICAgICAgICAgY29uc3QgYXR0cnM6IEF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgICAgIGlmIChjaGVja3BvaW50LnRhZ3MgJiYgdHlwZW9mIGNoZWNrcG9pbnQudGFncyA9PT0gJ29iamVjdCcpIGF0dHJzWyAnZncyNC5jaGVja3BvaW50LnRhZ3MnIF0gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50LnRhZ3MpO1xuICAgICAgICAgICAgaWYgKGNoZWNrcG9pbnQubWV0cmljcyAmJiB0eXBlb2YgY2hlY2twb2ludC5tZXRyaWNzID09PSAnb2JqZWN0JykgYXR0cnNbICdmdzI0LmNoZWNrcG9pbnQubWV0cmljcycgXSA9IEpTT04uc3RyaW5naWZ5KGNoZWNrcG9pbnQubWV0cmljcyk7XG4gICAgICAgICAgICBpZiAoY2hlY2twb2ludC5kYXRhICYmIHR5cGVvZiBjaGVja3BvaW50LmRhdGEgPT09ICdvYmplY3QnKSBhdHRyc1sgJ2Z3MjQuY2hlY2twb2ludC5kYXRhJyBdID0gSlNPTi5zdHJpbmdpZnkoY2hlY2twb2ludC5kYXRhKTtcbiAgICAgICAgICAgIGlmIChjaGVja3BvaW50LmVycm9yICYmIHR5cGVvZiBjaGVja3BvaW50LmVycm9yID09PSAnb2JqZWN0JykgYXR0cnNbICdmdzI0LmNoZWNrcG9pbnQuZXJyb3InIF0gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50LmVycm9yKTtcbiAgICAgICAgICAgIGV4aXN0aW5nU3Bhbi5hZGRFdmVudChuYW1lLCBhdHRycywgdHMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCBzdGF0dXNcbiAgICAgICAgaWYgKGV2ZW50LmVycm9yKSB7XG4gICAgICAgICAgZXhpc3RpbmdTcGFuLnNldFN0YXR1cyh7XG4gICAgICAgICAgICBjb2RlOiBzdGF0dXNDb2RlLkVSUk9SLFxuICAgICAgICAgICAgbWVzc2FnZTogZXZlbnQuZXJyb3IubWVzc2FnZSA/PyBldmVudC5zdGF0dXMgPz8gJ0Vycm9yJyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBleGlzdGluZ1NwYW4ucmVjb3JkRXhjZXB0aW9uKHtcbiAgICAgICAgICAgIG5hbWU6IGV2ZW50LmVycm9yLnR5cGUsXG4gICAgICAgICAgICBtZXNzYWdlOiBldmVudC5lcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgc3RhY2s6IGV2ZW50LmVycm9yLnN0YWNrLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgICAgICAgZXhpc3RpbmdTcGFuLnNldFN0YXR1cyh7XG4gICAgICAgICAgICBjb2RlOiBzdGF0dXNDb2RlLkVSUk9SLFxuICAgICAgICAgICAgbWVzc2FnZTogZXZlbnQuc3RhdHVzID8/ICdGYWlsZWQnLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGV4aXN0aW5nU3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBzdGF0dXNDb2RlLk9LIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZXhpc3RpbmdTcGFuLmVuZChlbmRUaW1lKTtcbiAgICAgICAgdGhpcy5hY3RpdmVTcGFucy5kZWxldGUoc3BhbklkKTtcblxuICAgICAgICBsb2dnZXIuZGVidWcoYEVuZGVkIGNvbnNvbGlkYXRlZCBPVEVMIHNwYW46ICR7ZXZlbnQub3BlcmF0aW9ufSAoJHtzcGFuSWR9KWApO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBlbmQgY29uc29saWRhdGVkIHNwYW46JywgZXJyb3IpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrOiBObyBleGlzdGluZyBzcGFuIGZvdW5kIChzcGFuLnN0YXJ0IG1pZ2h0IGhhdmUgYmVlbiBmaWx0ZXJlZClcbiAgICAvLyBDcmVhdGUgYSBuZXcgc3BhbiB3aXRoIGFsbCBkYXRhIGFuZCBlbmQgaXQgaW1tZWRpYXRlbHlcbiAgICBpZiAoIXRoaXMudHJhY2VyIHx8ICF0aGlzLnRyYWNlIHx8ICF0aGlzLmNvbnRleHRBcGkpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBpc0NvbGRTdGFydCA9IHRoaXMuaW52b2NhdGlvbkNvdW50ID09PSAxO1xuICAgICAgLy8gSW4gZmFsbGJhY2sgbW9kZSB3ZSBzdGlsbCB0cmVhdCB0aW1lc3RhbXBNcyBhcyBzdGFydCB0aW1lLlxuICAgICAgY29uc3QgZHVyYXRpb24gPSBldmVudC5kdXJhdGlvbk1zID8/IDA7XG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBldmVudC50aW1lc3RhbXBNcyA/PyBEYXRlLm5vdygpO1xuICAgICAgY29uc3QgZW5kVGltZSA9IGR1cmF0aW9uID4gMCA/IHN0YXJ0VGltZSArIGR1cmF0aW9uIDogRGF0ZS5ub3coKTtcblxuICAgICAgbGV0IGNvbnRleHQgPSB0aGlzLmNvbnRleHRBcGkuYWN0aXZlKCk7XG4gICAgICBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgICBpZiAocGFyZW50U3Bhbikge1xuICAgICAgICAgIGNvbnRleHQgPSB0aGlzLnRyYWNlLnNldFNwYW4oY29udGV4dCwgcGFyZW50U3Bhbik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3BhbkF0dHJpYnV0ZXM6IEF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICdvcGVyYXRpb24ubmFtZSc6IGV2ZW50Lm9wZXJhdGlvbiA/PyAndW5rbm93bicsXG4gICAgICAgICd0cmFjZS5pZCc6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICdzcGFuLmlkJzogc3BhbklkLFxuICAgICAgICAuLi4oZXZlbnQuYWN0b3I/LmFjdG9ySWQgJiYgeyAndXNlci5pZCc6IGV2ZW50LmFjdG9yLmFjdG9ySWQgfSksXG4gICAgICAgIC4uLihldmVudC5hY3Rvcj8udGVuYW50SWQgJiYgeyAndGVuYW50LmlkJzogZXZlbnQuYWN0b3IudGVuYW50SWQgfSksXG4gICAgICAgIC4uLihldmVudC5zb3VyY2UgJiYgeyAnY29kZS5mdW5jdGlvbic6IGV2ZW50LnNvdXJjZSB9KSxcbiAgICAgICAgLi4uKGlzQ29sZFN0YXJ0ICYmIHsgJ2ZhYXMuY29sZHN0YXJ0JzogdHJ1ZSB9KSxcbiAgICAgICAgLi4udGhpcy50b090ZWxBdHRyaWJ1dGVzKGV2ZW50LnRhZ3MpLCAgICAgICAgLy8gQ2xlYW4gQVBJXG4gICAgICAgIC4uLnRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKSwgIC8vIExlZ2FjeVxuICAgICAgfTtcblxuICAgICAgLy8gQWRkIG1ldHJpY3MgYXMgcHJlZml4ZWQgYXR0cmlidXRlc1xuICAgICAgaWYgKGV2ZW50Lm1ldHJpY3MpIHtcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoZXZlbnQubWV0cmljcykuZm9yRWFjaCgoWyBrZXksIHZhbHVlIF0pID0+IHtcbiAgICAgICAgICAoc3BhbkF0dHJpYnV0ZXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pWyBgbWV0cmljLiR7a2V5fWAgXSA9IHZhbHVlO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3BhbiA9IHRoaXMudHJhY2VyLnN0YXJ0U3BhbihcbiAgICAgICAgZXZlbnQub3BlcmF0aW9uID8/ICd1bmtub3duJyxcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6IGdldFNwYW5LaW5kKGV2ZW50LnN1YlR5cGUpLFxuICAgICAgICAgIHN0YXJ0VGltZTogc3RhcnRUaW1lLFxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHNwYW5BdHRyaWJ1dGVzLFxuICAgICAgICAgIGxpbmtzOiBidWlsZENhdXNlZEJ5TGlua3MoZXZlbnQpLFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0XG4gICAgICApO1xuXG4gICAgICAvLyBBZGQgY2hlY2twb2ludHMgZnJvbSBkYXRhIChjYW5vbmljYWwpLlxuICAgICAgY29uc3QgZGF0YSA9IGV2ZW50LmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgICBpZiAoZGF0YT8uY2hlY2twb2ludHMgJiYgQXJyYXkuaXNBcnJheShkYXRhLmNoZWNrcG9pbnRzKSkge1xuICAgICAgICBmb3IgKGNvbnN0IGNwIG9mIGRhdGEuY2hlY2twb2ludHMpIHtcbiAgICAgICAgICBjb25zdCBjaGVja3BvaW50ID0gY3AgYXMgeyBuYW1lPzogdW5rbm93bjsgdHM/OiB1bmtub3duOyB0YWdzPzogdW5rbm93bjsgbWV0cmljcz86IHVua25vd247IGRhdGE/OiB1bmtub3duOyBlcnJvcj86IHVua25vd24gfTtcbiAgICAgICAgICBjb25zdCBuYW1lID0gdHlwZW9mIGNoZWNrcG9pbnQubmFtZSA9PT0gJ3N0cmluZycgPyBjaGVja3BvaW50Lm5hbWUgOiAnY2hlY2twb2ludCc7XG4gICAgICAgICAgY29uc3QgdHMgPSB0eXBlb2YgY2hlY2twb2ludC50cyA9PT0gJ251bWJlcicgPyBjaGVja3BvaW50LnRzIDogdW5kZWZpbmVkO1xuICAgICAgICAgIC8vIE9URUwgQXR0cmlidXRlcyBkbyBub3Qgc3VwcG9ydCBuZXN0ZWQgb2JqZWN0czsgZW5jb2RlIHN0cnVjdHVyZWQgY2hlY2twb2ludCBkZXRhaWxzIGFzIEpTT04gc3RyaW5ncy5cbiAgICAgICAgICBjb25zdCBhdHRyczogQXR0cmlidXRlcyA9IHt9O1xuICAgICAgICAgIGlmIChjaGVja3BvaW50LnRhZ3MgJiYgdHlwZW9mIGNoZWNrcG9pbnQudGFncyA9PT0gJ29iamVjdCcpIGF0dHJzWyAnZncyNC5jaGVja3BvaW50LnRhZ3MnIF0gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50LnRhZ3MpO1xuICAgICAgICAgIGlmIChjaGVja3BvaW50Lm1ldHJpY3MgJiYgdHlwZW9mIGNoZWNrcG9pbnQubWV0cmljcyA9PT0gJ29iamVjdCcpIGF0dHJzWyAnZncyNC5jaGVja3BvaW50Lm1ldHJpY3MnIF0gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50Lm1ldHJpY3MpO1xuICAgICAgICAgIGlmIChjaGVja3BvaW50LmRhdGEgJiYgdHlwZW9mIGNoZWNrcG9pbnQuZGF0YSA9PT0gJ29iamVjdCcpIGF0dHJzWyAnZncyNC5jaGVja3BvaW50LmRhdGEnIF0gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50LmRhdGEpO1xuICAgICAgICAgIGlmIChjaGVja3BvaW50LmVycm9yICYmIHR5cGVvZiBjaGVja3BvaW50LmVycm9yID09PSAnb2JqZWN0JykgYXR0cnNbICdmdzI0LmNoZWNrcG9pbnQuZXJyb3InIF0gPSBKU09OLnN0cmluZ2lmeShjaGVja3BvaW50LmVycm9yKTtcbiAgICAgICAgICBzcGFuLmFkZEV2ZW50KG5hbWUsIGF0dHJzLCB0cyk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gU2V0IHN0YXR1cyBhbmQgZW5kXG4gICAgICBpZiAoZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgZXZlbnQuZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5zZXRTdGF0dXMoe1xuICAgICAgICAgIGNvZGU6IHN0YXR1c0NvZGUuRVJST1IsXG4gICAgICAgICAgbWVzc2FnZTogZXZlbnQuZXJyb3I/Lm1lc3NhZ2UgPz8gZXZlbnQuc3RhdHVzID8/ICdFcnJvcicsXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgICAgICBzcGFuLnJlY29yZEV4Y2VwdGlvbih7XG4gICAgICAgICAgICBuYW1lOiBldmVudC5lcnJvci50eXBlLFxuICAgICAgICAgICAgbWVzc2FnZTogZXZlbnQuZXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgIHN0YWNrOiBldmVudC5lcnJvci5zdGFjayxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiBzdGF0dXNDb2RlLk9LIH0pO1xuICAgICAgfVxuXG4gICAgICBzcGFuLmVuZChlbmRUaW1lKTtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgQ3JlYXRlZCBhbmQgZW5kZWQgY29uc29saWRhdGVkIE9URUwgc3BhbiAoZmFsbGJhY2spOiAke2V2ZW50Lm9wZXJhdGlvbn0gKCR7c3BhbklkfSlgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBoYW5kbGUgY29uc29saWRhdGVkIHNwYW4gKGZhbGxiYWNrKTonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVTcGFuU3RhcnQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIC8vIFVzZSBvYnNlcnZhYmlsaXR5TG9nSWQgYXMgc3BhbiBJRCAoY29uc2lzdGVudCB3aXRoIGNvbnNvbGlkYXRlZCBtb2RlKVxuICAgIGNvbnN0IHNwYW5JZCA9IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICBpZiAoIXNwYW5JZCB8fCAhdGhpcy50cmFjZXIgfHwgIXRoaXMudHJhY2UgfHwgIXRoaXMuY29udGV4dEFwaSkgcmV0dXJuO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGlzUm9vdFNwYW4gPSAhZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgY29uc3QgaXNDb2xkU3RhcnQgPSB0aGlzLmludm9jYXRpb25Db3VudCA9PT0gMTtcblxuICAgICAgbGV0IGNvbnRleHQgPSB0aGlzLmNvbnRleHRBcGkuYWN0aXZlKCk7XG4gICAgICBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgICBpZiAocGFyZW50U3Bhbikge1xuICAgICAgICAgIGNvbnRleHQgPSB0aGlzLnRyYWNlLnNldFNwYW4oY29udGV4dCwgcGFyZW50U3Bhbik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3BhbkF0dHJpYnV0ZXM6IEF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICdzZXJ2aWNlLm5hbWUnOiB0aGlzLnNlcnZpY2VOYW1lLFxuICAgICAgICAnZncyNC5jb3JyZWxhdGlvbl9pZCc6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICdmdzI0Lmludm9jYXRpb24nOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgICAgJ2Z3MjQuc3Bhbl9pZCc6IHNwYW5JZCxcbiAgICAgIH07XG5cbiAgICAgIGlmIChpc1Jvb3RTcGFuKSB7XG4gICAgICAgIHNwYW5BdHRyaWJ1dGVzWyAnY29sZFN0YXJ0JyBdID0gaXNDb2xkU3RhcnQ7XG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudC5lbnRpdHlJZCkgc3BhbkF0dHJpYnV0ZXNbICdmdzI0LmVudGl0eV9pZCcgXSA9IGV2ZW50LmVudGl0eUlkO1xuICAgICAgaWYgKGV2ZW50LmVudGl0eU5hbWUpIHNwYW5BdHRyaWJ1dGVzWyAnZncyNC5lbnRpdHlfbmFtZScgXSA9IGV2ZW50LmVudGl0eU5hbWU7XG4gICAgICBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSBzcGFuQXR0cmlidXRlc1sgJ2Z3MjQucGFyZW50X29ic2VydmFiaWxpdHlfbG9nX2lkJyBdID0gZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuXG4gICAgICBPYmplY3QuYXNzaWduKHNwYW5BdHRyaWJ1dGVzLCB0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcykpO1xuXG4gICAgICBpZiAocHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9OQU1FKSBzcGFuQXR0cmlidXRlc1sgJ2ZhYXMubmFtZScgXSA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRTtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0ZVTkNUSU9OX1ZFUlNJT04pIHNwYW5BdHRyaWJ1dGVzWyAnZmFhcy52ZXJzaW9uJyBdID0gcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9WRVJTSU9OO1xuICAgICAgaWYgKHByb2Nlc3MuZW52LkFXU19MQU1CREFfTE9HX1NUUkVBTV9OQU1FKSBzcGFuQXR0cmlidXRlc1sgJ2ZhYXMuaW5zdGFuY2UnIF0gPSBwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0xPR19TVFJFQU1fTkFNRTtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5BV1NfQUNDT1VOVF9JRCkgc3BhbkF0dHJpYnV0ZXNbICdjbG91ZC5hY2NvdW50LmlkJyBdID0gcHJvY2Vzcy5lbnYuQVdTX0FDQ09VTlRfSUQ7XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuQVdTX1JFR0lPTikgc3BhbkF0dHJpYnV0ZXNbICdjbG91ZC5yZWdpb24nIF0gPSBwcm9jZXNzLmVudi5BV1NfUkVHSU9OO1xuXG4gICAgICBjb25zdCBzcGFuID0gdGhpcy50cmFjZXIuc3RhcnRTcGFuKFxuICAgICAgICBldmVudC5vcGVyYXRpb24gfHwgJ29wZXJhdGlvbicsXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiBnZXRTcGFuS2luZChldmVudC5zdWJUeXBlKSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiBzcGFuQXR0cmlidXRlcyxcbiAgICAgICAgICBzdGFydFRpbWU6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgICAgIGxpbmtzOiBidWlsZENhdXNlZEJ5TGlua3MoZXZlbnQpLFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0LFxuICAgICAgKTtcblxuICAgICAgdGhpcy5hY3RpdmVTcGFucy5zZXQoc3BhbklkLCBzcGFuKTtcblxuICAgICAgbG9nZ2VyLmRlYnVnKGBDcmVhdGVkIE9wZW5UZWxlbWV0cnkgc3BhbjogJHtldmVudC5vcGVyYXRpb259ICgke3NwYW5JZH0pYCwge1xuICAgICAgICBjb2xkU3RhcnQ6IGlzUm9vdFNwYW4gPyBpc0NvbGRTdGFydCA6IHVuZGVmaW5lZCxcbiAgICAgICAgaW52b2NhdGlvbjogdGhpcy5pbnZvY2F0aW9uQ291bnQsXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdFcnJvciBjcmVhdGluZyBPcGVuVGVsZW1ldHJ5IHNwYW46JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIExlZ2FjeSBzcGFuLmV2ZW50L3NwYW4uZW5kIGFyZSBpbnRlbnRpb25hbGx5IG5vdCBzdXBwb3J0ZWQuXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT0gTUVUUklDIEhBTkRMSU5HID09PT09PT09PT09PT09PT09PT09XG5cbiAgcHJpdmF0ZSBoYW5kbGVNZXRyaWNFdmVudChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLm1ldGVyIHx8ICFldmVudC5tZXRyaWNzKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgbWV0cmljVHlwZSA9IGV2ZW50LnN1YlR5cGUgfHwgJ2NvdW50ZXInO1xuICAgICAgY29uc3QgYXR0cnMgPSB0aGlzLnRvT3RlbEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcyk7XG5cbiAgICAgIGZvciAoY29uc3QgWyBuYW1lLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpKSB7XG4gICAgICAgIHN3aXRjaCAobWV0cmljVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ2NvdW50ZXInOlxuICAgICAgICAgICAgaWYgKHZhbHVlIDwgMCkge1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZVVwRG93bkNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLm1ldGVyLmNyZWF0ZUNvdW50ZXIobmFtZSkuYWRkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ2dhdWdlJzpcbiAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlR2F1Z2UobmFtZSkucmVjb3JkKHZhbHVlLCBhdHRycyk7XG4gICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgIGNhc2UgJ3RpbWluZyc6XG4gICAgICAgICAgY2FzZSAnaGlzdG9ncmFtJzpcbiAgICAgICAgICAgIHRoaXMubWV0ZXIuY3JlYXRlSGlzdG9ncmFtKG5hbWUpLnJlY29yZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgaWYgKHZhbHVlID49IDApIHtcbiAgICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVDb3VudGVyKG5hbWUpLmFkZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5tZXRlci5jcmVhdGVVcERvd25Db3VudGVyKG5hbWUpLmFkZCh2YWx1ZSwgYXR0cnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRXJyb3IgcmVjb3JkaW5nIE9wZW5UZWxlbWV0cnkgbWV0cmljOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PSBMT0cgSEFORExJTkcgPT09PT09PT09PT09PT09PT09PT1cblxuICBwcml2YXRlIGhhbmRsZUxvZ0V2ZW50KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMub3RlbExvZ2dlcikgcmV0dXJuO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHNldmVyaXR5ID0gTE9HX0xFVkVMX1RPX1NFVkVSSVRZWyBldmVudC5sZXZlbCBdIHx8IDk7XG4gICAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5leHRyYWN0TG9nTWVzc2FnZShldmVudCk7XG5cbiAgICAgIGNvbnN0IGxvZ0F0dHJpYnV0ZXM6IEF0dHJpYnV0ZXMgPSB7XG4gICAgICAgIC4uLnRoaXMudG9PdGVsQXR0cmlidXRlcyhldmVudC5hdHRyaWJ1dGVzKSxcbiAgICAgICAgLi4udGhpcy50b090ZWxBdHRyaWJ1dGVzKGV2ZW50LmRhdGEpLFxuICAgICAgICAnZncyNC5jb3JyZWxhdGlvbl9pZCc6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICdmdzI0Lm9ic2VydmFiaWxpdHlfbG9nX2lkJzogZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgfTtcblxuICAgICAgaWYgKGV2ZW50LnNvdXJjZSkgbG9nQXR0cmlidXRlc1sgJ2Z3MjQuc291cmNlJyBdID0gZXZlbnQuc291cmNlO1xuXG4gICAgICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgICAgaWYgKGV2ZW50LmVycm9yLnR5cGUpIGxvZ0F0dHJpYnV0ZXNbICdleGNlcHRpb24udHlwZScgXSA9IGV2ZW50LmVycm9yLnR5cGU7XG4gICAgICAgIGlmIChldmVudC5lcnJvci5tZXNzYWdlKSBsb2dBdHRyaWJ1dGVzWyAnZXhjZXB0aW9uLm1lc3NhZ2UnIF0gPSBldmVudC5lcnJvci5tZXNzYWdlO1xuICAgICAgICBpZiAoZXZlbnQuZXJyb3Iuc3RhY2spIGxvZ0F0dHJpYnV0ZXNbICdleGNlcHRpb24uc3RhY2t0cmFjZScgXSA9IGV2ZW50LmVycm9yLnN0YWNrO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm90ZWxMb2dnZXIuZW1pdCh7XG4gICAgICAgIHNldmVyaXR5TnVtYmVyOiBzZXZlcml0eSxcbiAgICAgICAgc2V2ZXJpdHlUZXh0OiBldmVudC5sZXZlbC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICBib2R5OiBtZXNzYWdlLFxuICAgICAgICBhdHRyaWJ1dGVzOiBsb2dBdHRyaWJ1dGVzLFxuICAgICAgICB0aW1lc3RhbXA6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgfSk7XG5cbiAgICAgIGxvZ2dlci5kZWJ1ZyhgRW1pdHRlZCBPVEVMIGxvZzogJHtldmVudC5sZXZlbH0gLSAke2V2ZW50Lm9wZXJhdGlvbn1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdFcnJvciBlbWl0dGluZyBPcGVuVGVsZW1ldHJ5IGxvZzonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBleHRyYWN0TG9nTWVzc2FnZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogc3RyaW5nIHtcbiAgICBpZiAoZXZlbnQuZGF0YSAmJiB0eXBlb2YgZXZlbnQuZGF0YS5tZXNzYWdlID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGV2ZW50LmRhdGEubWVzc2FnZTtcbiAgICB9XG4gICAgcmV0dXJuIGV2ZW50Lm9wZXJhdGlvbiB8fCAnbG9nJztcbiAgfVxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09IFVUSUxJVFkgTUVUSE9EUyA9PT09PT09PT09PT09PT09PT09PVxuXG4gIHByaXZhdGUgaXNTdHJpbmdBcnJheShhcnI6IHVua25vd25bXSk6IGFyciBpcyBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIGFyci5ldmVyeSgodik6IHYgaXMgc3RyaW5nID0+IHR5cGVvZiB2ID09PSAnc3RyaW5nJyk7XG4gIH1cblxuICBwcml2YXRlIGlzTnVtYmVyQXJyYXkoYXJyOiB1bmtub3duW10pOiBhcnIgaXMgbnVtYmVyW10ge1xuICAgIHJldHVybiBhcnIuZXZlcnkoKHYpOiB2IGlzIG51bWJlciA9PiB0eXBlb2YgdiA9PT0gJ251bWJlcicpO1xuICB9XG5cbiAgcHJpdmF0ZSBpc0Jvb2xlYW5BcnJheShhcnI6IHVua25vd25bXSk6IGFyciBpcyBib29sZWFuW10ge1xuICAgIHJldHVybiBhcnIuZXZlcnkoKHYpOiB2IGlzIGJvb2xlYW4gPT4gdHlwZW9mIHYgPT09ICdib29sZWFuJyk7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBNQVhfQVRUUklCVVRFX1NJWkUgPSA0MDAwO1xuXG4gIHByaXZhdGUgdG9PdGVsQXR0cmlidXRlcyhhdHRycz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogQXR0cmlidXRlcyB7XG4gICAgaWYgKCFhdHRycykgcmV0dXJuIHt9O1xuICAgIGNvbnN0IHJlc3VsdDogQXR0cmlidXRlcyA9IHt9O1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cnMpKSB7XG4gICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWUubGVuZ3RoID4gT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kLk1BWF9BVFRSSUJVVEVfU0laRVxuICAgICAgICAgID8gdmFsdWUuc3Vic3RyaW5nKDAsIE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpICsgJy4uLlt0cnVuY2F0ZWRdJ1xuICAgICAgICAgIDogdmFsdWU7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHwgdHlwZW9mIHZhbHVlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICBpZiAodmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IFtdO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXNTdHJpbmdBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWU7XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5pc051bWJlckFycmF5KHZhbHVlKSkge1xuICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmlzQm9vbGVhbkFycmF5KHZhbHVlKSkge1xuICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRbIGtleSBdID0gdGhpcy5zYWZlSnNvblN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodmFsdWUgIT09IG51bGwgJiYgdmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHRbIGtleSBdID0gdGhpcy5zYWZlSnNvblN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIHNhZmVKc29uU3RyaW5naWZ5KHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QganNvbiA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgIGlmIChqc29uLmxlbmd0aCA+IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpIHtcbiAgICAgICAgcmV0dXJuIGpzb24uc3Vic3RyaW5nKDAsIE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZC5NQVhfQVRUUklCVVRFX1NJWkUpICsgJy4uLlt0cnVuY2F0ZWRdJztcbiAgICAgIH1cbiAgICAgIHJldHVybiBqc29uO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuICdbdW5zZXJpYWxpemFibGVdJztcbiAgICB9XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5hY3RpdmVTcGFucy5zaXplID4gMCAmJiB0aGlzLnNwYW5TdGF0dXNDb2RlKSB7XG4gICAgICBsb2dnZXIud2FybihgRm9yY2UgZW5kaW5nICR7dGhpcy5hY3RpdmVTcGFucy5zaXplfSBhY3RpdmUgc3BhbnNgKTtcbiAgICAgIGNvbnN0IHN0YXR1c0NvZGUgPSB0aGlzLnNwYW5TdGF0dXNDb2RlO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5mb3JFYWNoKChzcGFuLCBlbnRpdHlJZCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHNwYW4uc2V0U3RhdHVzKHtcbiAgICAgICAgICAgIGNvZGU6IHN0YXR1c0NvZGUuRVJST1IsXG4gICAgICAgICAgICBtZXNzYWdlOiAnU3BhbiBmb3JjZS1jbG9zZWQgZHVlIHRvIExhbWJkYSBzaHV0ZG93bicsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgc3Bhbi5lbmQoKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIGZvcmNlLWVuZGluZyBzcGFuICR7ZW50aXR5SWR9OmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmNsZWFyKCk7XG4gICAgfVxuXG4gICAgbG9nZ2VyLmRlYnVnKCdPVEVMIGJhY2tlbmQgZmx1c2ggY29tcGxldGUgKEFET1QgY29sbGVjdG9yIGhhbmRsZXMgZXhwb3J0KScpO1xuICB9XG5cbiAgZGVzdHJveSgpOiB2b2lkIHtcbiAgICB0aGlzLmFjdGl2ZVNwYW5zLmNsZWFyKCk7XG4gIH1cbn1cblxuLyoqIFJlc2V0IGNvbGQgc3RhcnQgZmxhZyAoZm9yIHRlc3RpbmcpICovXG5leHBvcnQgZnVuY3Rpb24gcmVzZXRDb2xkU3RhcnRGbGFnKCk6IHZvaWQge1xuICBjb2xkU3RhcnRGbGFnID0gdHJ1ZTtcbn1cbiJdfQ==