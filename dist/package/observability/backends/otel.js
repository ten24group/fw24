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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTELObservabilityBackend = void 0;
const logging_1 = require("../../logging");
const span_utils_1 = require("../utils/span-utils");
const logger = (0, logging_1.createLogger)('OTELObservabilityBackend');
// Module-level cold start flag (per-container, not per-class)
let coldStartFlag = true;
/**
 * OTEL/ADOT Backend - Uses OpenTelemetry API for custom instrumentation
 *
 * This backend works alongside the AWS ADOT Lambda layer to add custom
 * spans, events, and attributes to traces.
 *
 * The ADOT layer handles:
 * - Automatic instrumentation of AWS SDK, HTTP, and Lambda
 * - Exporting traces to X-Ray via OTLP
 * - Context propagation (W3C Trace Context + X-Ray)
 * - Trace ID generation (X-Ray format)
 *
 * This backend adds:
 * - Custom spans for our Span API
 * - Span events from our observability events
 * - Attributes and metrics from our universal logging system
 * - Integration with workflows, decisions, and audits
 */
class OTELObservabilityBackend {
    options;
    name = 'otel';
    minLevel;
    tracer;
    trace;
    SpanStatusCode;
    activeSpans = new Map();
    isOTELAvailable = false;
    invocationCount = 0;
    constructor(options) {
        this.options = options;
        this.minLevel = options.minLevel;
        this.initializeOpenTelemetry();
    }
    initializeOpenTelemetry() {
        try {
            // Try to load OpenTelemetry API (provided by ADOT layer at runtime)
            const otel = require('@opentelemetry/api');
            this.trace = otel.trace;
            this.SpanStatusCode = otel.SpanStatusCode;
            // Get the tracer from the global provider (initialized by ADOT layer)
            this.tracer = this.trace.getTracer(this.options.serviceName, process.env.npm_package_version || '1.0.0');
            this.isOTELAvailable = true;
            logger.info('OpenTelemetry API available - custom instrumentation enabled');
            logger.info(`Service: ${this.options.serviceName}, X-Ray Trace ID: ${process.env._X_AMZN_TRACE_ID}`);
        }
        catch (error) {
            // OpenTelemetry not available - this is fine in local development without ADOT layer
            this.isOTELAvailable = false;
            logger.warn('OpenTelemetry API not available - OTEL backend disabled. Install ADOT layer for production.');
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
        // If OpenTelemetry is not available, do nothing
        // The ADOT layer will still auto-instrument AWS SDK and HTTP calls
        if (!this.isOTELAvailable) {
            return;
        }
        // Only handle span events for OTEL backend
        // Other events (logs, metrics, audits) go to DynamoDB backend
        if (event.entityName !== 'span') {
            return;
        }
        switch (event.type) {
            case 'span.start':
                this.handleSpanStart(event);
                break;
            case 'span.event':
                this.handleSpanEvent(event);
                break;
            case 'span.end':
                await this.handleSpanEnd(event);
                break;
            default:
                break;
        }
    }
    handleSpanStart(event) {
        if (!event.entityId || !this.tracer)
            return;
        try {
            // Detect if this is a root span (no parent)
            const isRootSpan = !event.parentLogId;
            const isColdStart = this.invocationCount === 1;
            // Get parent context if exists
            let context = this.trace.context.active();
            if (event.parentLogId) {
                const parentSpan = this.activeSpans.get(event.parentLogId);
                if (parentSpan) {
                    context = this.trace.setSpan(context, parentSpan);
                }
            }
            // Create a new span using OpenTelemetry API with parent context
            const span = this.tracer.startSpan(event.operation || 'operation', {
                kind: (0, span_utils_1.getSpanKind)(event.subType),
                attributes: {
                    // Service name annotation (inspired by AWS Powertools)
                    'service.name': this.options.serviceName,
                    // Cold start annotation (inspired by AWS Powertools)
                    ...(isRootSpan && { 'coldStart': isColdStart }),
                    // Add FW24-specific attributes
                    'fw24.correlation_id': event.correlationId,
                    'fw24.entity_id': event.entityId,
                    'fw24.entity_name': event.entityName,
                    'fw24.parent_log_id': event.parentLogId,
                    'fw24.invocation': this.invocationCount,
                    // Add custom attributes from event
                    ...(event.attributes || {}),
                    // Add Lambda context (OTEL semantic conventions)
                    'faas.name': process.env.AWS_LAMBDA_FUNCTION_NAME,
                    'faas.version': process.env.AWS_LAMBDA_FUNCTION_VERSION,
                    'faas.instance': process.env.AWS_LAMBDA_LOG_STREAM_NAME,
                    'cloud.account.id': process.env.AWS_ACCOUNT_ID,
                    'cloud.region': process.env.AWS_REGION,
                },
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
    handleSpanEvent(event) {
        if (!event.entityId)
            return;
        const span = this.activeSpans.get(event.entityId);
        if (!span) {
            logger.warn(`No active span found for event: ${event.entityId}`);
            return;
        }
        try {
            // Add event to span
            span.addEvent(event.operation || 'event', {
                timestamp: event.timestampMs,
                attributes: event.attributes || {},
            });
            logger.debug(`Added event to span ${event.entityId}: ${event.operation}`);
        }
        catch (error) {
            logger.error('Error adding event to OpenTelemetry span:', error);
        }
    }
    async handleSpanEnd(event) {
        if (!event.entityId)
            return;
        const span = this.activeSpans.get(event.entityId);
        if (!span) {
            logger.warn(`No active span found for end event: ${event.entityId}`);
            return;
        }
        try {
            // Add final attributes
            if (event.attributes) {
                span.setAttributes(event.attributes);
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
            // Set status based on success/error
            if (event.error) {
                span.setStatus({
                    code: this.SpanStatusCode.ERROR,
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
                    code: this.SpanStatusCode.ERROR,
                    message: event.status || 'Operation failed',
                });
            }
            else {
                span.setStatus({ code: this.SpanStatusCode.OK });
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
    async flush() {
        // End any remaining active spans
        if (this.activeSpans.size > 0) {
            logger.warn(`Force ending ${this.activeSpans.size} active spans`);
            this.activeSpans.forEach((span, entityId) => {
                try {
                    span.setStatus({
                        code: this.SpanStatusCode.ERROR,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL290ZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0REc7OztBQUdILDJDQUE2QztBQUM3QyxvREFBa0Q7QUFFbEQsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLDBCQUEwQixDQUFDLENBQUM7QUFFeEQsOERBQThEO0FBQzlELElBQUksYUFBYSxHQUFHLElBQUksQ0FBQztBQU96Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFDSCxNQUFhLHdCQUF3QjtJQVlOO0lBWGIsSUFBSSxHQUFHLE1BQU0sQ0FBQztJQUNkLFFBQVEsQ0FBc0I7SUFFdEMsTUFBTSxDQUFNO0lBQ1osS0FBSyxDQUFNO0lBQ1gsY0FBYyxDQUFNO0lBQ3BCLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBZSxDQUFDO0lBQ3JDLGVBQWUsR0FBWSxLQUFLLENBQUM7SUFFakMsZUFBZSxHQUFXLENBQUMsQ0FBQztJQUVwQyxZQUE2QixPQUEyQjtRQUEzQixZQUFPLEdBQVAsT0FBTyxDQUFvQjtRQUN0RCxJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUM7UUFDakMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUM7SUFDakMsQ0FBQztJQUVPLHVCQUF1QjtRQUM3QixJQUFJLENBQUM7WUFDSCxvRUFBb0U7WUFDcEUsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLG9CQUFvQixDQUFDLENBQUM7WUFDM0MsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO1lBQ3hCLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQztZQUUxQyxzRUFBc0U7WUFDdEUsSUFBSSxDQUFDLE1BQU0s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QUMxRSwrRUFBK0U7UUFDL0UsTUFBTSxDQUFDLEtBQUssQ0FBQyw2REFBNkQsQ0FBQyxDQUFDO0lBQzlFLENBQUM7SUFFRCxPQUFPO1FBQ0wsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUMzQixDQUFDO0NBQ0Y7QUE1UUQsNERBNFFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPcGVuVGVsZW1ldHJ5IEJhY2tlbmQgZm9yIEFXUyBYLVJheSBJbnRlZ3JhdGlvblxuICogXG4gKiBJTVBPUlRBTlQ6IFRoaXMgYmFja2VuZCBpcyBkZXNpZ25lZCB0byB3b3JrIHdpdGggQVdTIExhbWJkYSdzIG1hbmFnZWQgQURPVCBsYXllci5cbiAqIFxuICogIyMgV2h5IEFET1QvT3BlblRlbGVtZXRyeSAoTm90IFgtUmF5IFNESylcbiAqIFxuICogQVdTIFgtUmF5IFNESyBpcyBiZWluZyBkZXByZWNhdGVkIChlbmQtb2Ytc3VwcG9ydDogRmViIDI1LCAyMDI3KTpcbiAqIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS94cmF5L2xhdGVzdC9kZXZndWlkZS94cmF5LXNkay1ub2RlanMuaHRtbFxuICogXG4gKiBBV1MgcmVjb21tZW5kcyBtaWdyYXRpbmcgdG8gT3BlblRlbGVtZXRyeTpcbiAqIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS94cmF5L2xhdGVzdC9kZXZndWlkZS94cmF5LWluc3RydW1lbnRpbmcteW91ci1hcHAuaHRtbCN4cmF5LWluc3RydW1lbnRpbmctb3BlbnRlbFxuICogXG4gKiAjIyBBV1MgQURPVCBMYW1iZGEgTGF5ZXJcbiAqIFxuICogQVdTIHByb3ZpZGVzIGEgbWFuYWdlZCBMYW1iZGEgbGF5ZXIgdGhhdCBpbmNsdWRlcyBPcGVuVGVsZW1ldHJ5IGluc3RydW1lbnRhdGlvbjpcbiAqIC0gQVJOOiBhcm46YXdzOmxhbWJkYTo8cmVnaW9uPjo5MDE5MjA1NzA0NjM6bGF5ZXI6YXdzLW90ZWwtbm9kZWpzLTxhcmNoPi12ZXItMS0zMC0yOjFcbiAqIC0gQXV0b21hdGljYWxseSBpbnN0cnVtZW50cyBBV1MgU0RLLCBIVFRQLCBhbmQgTGFtYmRhIGludm9jYXRpb25zXG4gKiAtIEV4cG9ydHMgdG8gWC1SYXkgdmlhIE9wZW5UZWxlbWV0cnkgQ29sbGVjdG9yXG4gKiAtIFczQyBUcmFjZSBDb250ZXh0ICsgWC1SYXkgcHJvcGFnYXRpb25cbiAqIFxuICogIyMgQXJjaGl0ZWN0dXJlXG4gKiBcbiAqIFRoZSBBRE9UIGxheWVyIHByb3ZpZGVzIE9wZW5UZWxlbWV0cnkgcGFja2FnZXMgYXQgcnVudGltZTpcbiAqIC0gQG9wZW50ZWxlbWV0cnkvYXBpIChmb3IgZ2V0dGluZyB0cmFjZXJzIGFuZCBjcmVhdGluZyBzcGFucylcbiAqIC0gQG9wZW50ZWxlbWV0cnkvc2RrLXRyYWNlLW5vZGUgKGZvciB0cmFjZXIgY29uZmlndXJhdGlvbilcbiAqIC0gQURPVCBDb2xsZWN0b3IgcnVubmluZyBhcyBMYW1iZGEgZXh0ZW5zaW9uXG4gKiBcbiAqIFdlIGltcG9ydCB0aGVzZSBwYWNrYWdlcyBidXQgbWFyayB0aGVtIGFzIGV4dGVybmFsIGluIGJ1bmRsaW5nLCBzbzpcbiAqIC0gRGV2ZWxvcG1lbnQ6IENhbiB0ZXN0IGxvY2FsbHkgd2l0aCBPVEVMIHBhY2thZ2VzIGluc3RhbGxlZFxuICogLSBQcm9kdWN0aW9uOiBVc2VzIHBhY2thZ2VzIGZyb20gQURPVCBsYXllciAoemVybyBidW5kbGUgc2l6ZSlcbiAqIFxuICogIyMgU2V0dXAgaW4gQ0RLL1NBTVxuICogXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBUcmFjaW5nIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG4gKiBcbiAqIGNvbnN0IGZuID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdNeUZ1bmN0aW9uJywge1xuICogICBsYXllcnM6IFtcbiAqICAgICBMYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybih0aGlzLCAnQWRvdExheWVyJyxcbiAqICAgICAgICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6OTAxOTIwNTcwNDYzOmxheWVyOmF3cy1vdGVsLW5vZGVqcy1hbWQ2NC12ZXItMS0zMC0yOjEnXG4gKiAgICAgKVxuICogICBdLFxuICogICBlbnZpcm9ubWVudDoge1xuICogICAgIEFXU19MQU1CREFfRVhFQ19XUkFQUEVSOiAnL29wdC9vdGVsLWhhbmRsZXInLFxuICogICAgIE9CU0VSVkFCSUxJVFlfQkFDS0VORFM6ICdvdGVsJywgLy8gRlcyNCBjb25maWdcbiAqICAgfSxcbiAqICAgdHJhY2luZzogVHJhY2luZy5BQ1RJVkUsIC8vIEVuYWJsZSBYLVJheVxuICogICBidW5kbGluZzoge1xuICogICAgIGV4dGVybmFsTW9kdWxlczogW1xuICogICAgICAgJ0BvcGVudGVsZW1ldHJ5LyonLCAvLyBQcm92aWRlZCBieSBMYW1iZGEgbGF5ZXJcbiAqICAgICBdLFxuICogICB9LFxuICogfSk7XG4gKiBgYGBcbiAqIFxuICogUmVmZXJlbmNlczpcbiAqIC0gaHR0cHM6Ly9hd3Mtb3RlbC5naXRodWIuaW8vZG9jcy9nZXR0aW5nLXN0YXJ0ZWQvbGFtYmRhL2xhbWJkYS1qc1xuICogLSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vbGFtYmRhL2xhdGVzdC9kZy90eXBlc2NyaXB0LXRyYWNpbmcuaHRtbFxuICogLSBodHRwczovL29wZW50ZWxlbWV0cnkuaW8vZG9jcy9sYW5ndWFnZXMvanMvXG4gKi9cblxuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsIE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBnZXRTcGFuS2luZCB9IGZyb20gJy4uL3V0aWxzL3NwYW4tdXRpbHMnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09URUxPYnNlcnZhYmlsaXR5QmFja2VuZCcpO1xuXG4vLyBNb2R1bGUtbGV2ZWwgY29sZCBzdGFydCBmbGFnIChwZXItY29udGFpbmVyLCBub3QgcGVyLWNsYXNzKVxubGV0IGNvbGRTdGFydEZsYWcgPSB0cnVlO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9URUxCYWNrZW5kT3B0aW9ucyB7XG4gIHNlcnZpY2VOYW1lOiBzdHJpbmc7XG4gIG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xufVxuXG4vKipcbiAqIE9URUwvQURPVCBCYWNrZW5kIC0gVXNlcyBPcGVuVGVsZW1ldHJ5IEFQSSBmb3IgY3VzdG9tIGluc3RydW1lbnRhdGlvblxuICogXG4gKiBUaGlzIGJhY2tlbmQgd29ya3MgYWxvbmdzaWRlIHRoZSBBV1MgQURPVCBMYW1iZGEgbGF5ZXIgdG8gYWRkIGN1c3RvbVxuICogc3BhbnMsIGV2ZW50cywgYW5kIGF0dHJpYnV0ZXMgdG8gdHJhY2VzLlxuICogXG4gKiBUaGUgQURPVCBsYXllciBoYW5kbGVzOlxuICogLSBBdXRvbWF0aWMgaW5zdHJ1bWVudGF0aW9uIG9mIEFXUyBTREssIEhUVFAsIGFuZCBMYW1iZGFcbiAqIC0gRXhwb3J0aW5nIHRyYWNlcyB0byBYLVJheSB2aWEgT1RMUFxuICogLSBDb250ZXh0IHByb3BhZ2F0aW9uIChXM0MgVHJhY2UgQ29udGV4dCArIFgtUmF5KVxuICogLSBUcmFjZSBJRCBnZW5lcmF0aW9uIChYLVJheSBmb3JtYXQpXG4gKiBcbiAqIFRoaXMgYmFja2VuZCBhZGRzOlxuICogLSBDdXN0b20gc3BhbnMgZm9yIG91ciBTcGFuIEFQSVxuICogLSBTcGFuIGV2ZW50cyBmcm9tIG91ciBvYnNlcnZhYmlsaXR5IGV2ZW50c1xuICogLSBBdHRyaWJ1dGVzIGFuZCBtZXRyaWNzIGZyb20gb3VyIHVuaXZlcnNhbCBsb2dnaW5nIHN5c3RlbVxuICogLSBJbnRlZ3JhdGlvbiB3aXRoIHdvcmtmbG93cywgZGVjaXNpb25zLCBhbmQgYXVkaXRzXG4gKi9cbmV4cG9ydCBjbGFzcyBPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ290ZWwnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG4gIFxuICBwcml2YXRlIHRyYWNlcjogYW55O1xuICBwcml2YXRlIHRyYWNlOiBhbnk7XG4gIHByaXZhdGUgU3BhblN0YXR1c0NvZGU6IGFueTtcbiAgcHJpdmF0ZSBhY3RpdmVTcGFucyA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gIHByaXZhdGUgaXNPVEVMQXZhaWxhYmxlOiBib29sZWFuID0gZmFsc2U7XG4gIFxuICBwcml2YXRlIGludm9jYXRpb25Db3VudDogbnVtYmVyID0gMDtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IE9URUxCYWNrZW5kT3B0aW9ucykge1xuICAgIHRoaXMubWluTGV2ZWwgPSBvcHRpb25zLm1pbkxldmVsO1xuICAgIHRoaXMuaW5pdGlhbGl6ZU9wZW5UZWxlbWV0cnkoKTtcbiAgfVxuXG4gIHByaXZhdGUgaW5pdGlhbGl6ZU9wZW5UZWxlbWV0cnkoKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRyeSB0byBsb2FkIE9wZW5UZWxlbWV0cnkgQVBJIChwcm92aWRlZCBieSBBRE9UIGxheWVyIGF0IHJ1bnRpbWUpXG4gICAgICBjb25zdCBvdGVsID0gcmVxdWlyZSgnQG9wZW50ZWxlbWV0cnkvYXBpJyk7XG4gICAgICB0aGlzLnRyYWNlID0gb3RlbC50cmFjZTtcbiAgICAgIHRoaXMuU3BhblN0YXR1c0NvZGUgPSBvdGVsLlNwYW5TdGF0dXNDb2RlO1xuICAgICAgXG4gICAgICAvLyBHZXQgdGhlIHRyYWNlciBmcm9tIHRoZSBnbG9iYWwgcHJvdmlkZXIgKGluaXRpYWxpemVkIGJ5IEFET1QgbGF5ZXIpXG4gICAgICB0aGlzLnRyYWNlciA9IHRoaXMudHJhY2UuZ2V0VHJhY2VyKFxuICAgICAgICB0aGlzLm9wdGlvbnMuc2VydmljZU5hbWUsXG4gICAgICAgIHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzEuMC4wJ1xuICAgICAgKTtcbiAgICAgIFxuICAgICAgdGhpcy5pc09URUxBdmFpbGFibGUgPSB0cnVlO1xuICAgICAgbG9nZ2VyLmluZm8oJ09wZW5UZWxlbWV0cnkgQVBJIGF2YWlsYWJsZSAtIGN1c3RvbSBpbnN0cnVtZW50YXRpb24gZW5hYmxlZCcpO1xuICAgICAgbG9nZ2VyLmluZm8oYFNlcnZpY2U6ICR7dGhpcy5vcHRpb25zLnNlcnZpY2VOYW1lfSwgWC1SYXkgVHJhY2UgSUQ6ICR7cHJvY2Vzcy5lbnYuX1hfQU1aTl9UUkFDRV9JRH1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gT3BlblRlbGVtZXRyeSBub3QgYXZhaWxhYmxlIC0gdGhpcyBpcyBmaW5lIGluIGxvY2FsIGRldmVsb3BtZW50IHdpdGhvdXQgQURPVCBsYXllclxuICAgICAgdGhpcy5pc09URUxBdmFpbGFibGUgPSBmYWxzZTtcbiAgICAgIGxvZ2dlci53YXJuKCdPcGVuVGVsZW1ldHJ5IEFQSSBub3QgYXZhaWxhYmxlIC0gT1RFTCBiYWNrZW5kIGRpc2FibGVkLiBJbnN0YWxsIEFET1QgbGF5ZXIgZm9yIHByb2R1Y3Rpb24uJyk7XG4gICAgfVxuICB9XG5cbiAgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgLy8gSW5jcmVtZW50IGludm9jYXRpb24gY291bnRcbiAgICB0aGlzLmludm9jYXRpb25Db3VudCsrO1xuICAgIFxuICAgIC8vIERldGVjdCBjb2xkIHN0YXJ0IChtb2R1bGUtbGV2ZWwgZmxhZylcbiAgICBjb25zdCBpc0NvbGRTdGFydCA9IGNvbGRTdGFydEZsYWc7XG4gICAgaWYgKGNvbGRTdGFydEZsYWcpIHtcbiAgICAgIGNvbGRTdGFydEZsYWcgPSBmYWxzZTtcbiAgICAgIGxvZ2dlci5pbmZvKCdDb2xkIHN0YXJ0IGRldGVjdGVkJywge1xuICAgICAgICBpbnZvY2F0aW9uOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgICAgY29sZFN0YXJ0OiB0cnVlLFxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIC8vIENsZWFuIHVwIGFueSBvcnBoYW5lZCBzcGFucyBmcm9tIHByZXZpb3VzIGludm9jYXRpb25zICh3YXJtIHN0YXJ0KVxuICAgIGlmICh0aGlzLmFjdGl2ZVNwYW5zLnNpemUgPiAwKSB7XG4gICAgICBsb2dnZXIud2FybihgQ2xlYW5pbmcgdXAgJHt0aGlzLmFjdGl2ZVNwYW5zLnNpemV9IG9ycGhhbmVkIHNwYW5zIGZyb20gcHJldmlvdXMgaW52b2NhdGlvbmApO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5mb3JFYWNoKChzcGFuLCBlbnRpdHlJZCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHNwYW4uZW5kKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBFcnJvciBlbmRpbmcgb3JwaGFuZWQgc3BhbiAke2VudGl0eUlkfTpgLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5jbGVhcigpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIElmIE9wZW5UZWxlbWV0cnkgaXMgbm90IGF2YWlsYWJsZSwgZG8gbm90aGluZ1xuICAgIC8vIFRoZSBBRE9UIGxheWVyIHdpbGwgc3RpbGwgYXV0by1pbnN0cnVtZW50IEFXUyBTREsgYW5kIEhUVFAgY2FsbHNcbiAgICBpZiAoIXRoaXMuaXNPVEVMQXZhaWxhYmxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gT25seSBoYW5kbGUgc3BhbiBldmVudHMgZm9yIE9URUwgYmFja2VuZFxuICAgIC8vIE90aGVyIGV2ZW50cyAobG9ncywgbWV0cmljcywgYXVkaXRzKSBnbyB0byBEeW5hbW9EQiBiYWNrZW5kXG4gICAgaWYgKGV2ZW50LmVudGl0eU5hbWUgIT09ICdzcGFuJykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHN3aXRjaCAoZXZlbnQudHlwZSkge1xuICAgICAgY2FzZSAnc3Bhbi5zdGFydCc6XG4gICAgICAgIHRoaXMuaGFuZGxlU3BhblN0YXJ0KGV2ZW50KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdzcGFuLmV2ZW50JzpcbiAgICAgICAgdGhpcy5oYW5kbGVTcGFuRXZlbnQoZXZlbnQpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3NwYW4uZW5kJzpcbiAgICAgICAgYXdhaXQgdGhpcy5oYW5kbGVTcGFuRW5kKGV2ZW50KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVNwYW5TdGFydChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5lbnRpdHlJZCB8fCAhdGhpcy50cmFjZXIpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICAvLyBEZXRlY3QgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KVxuICAgICAgY29uc3QgaXNSb290U3BhbiA9ICFldmVudC5wYXJlbnRMb2dJZDtcbiAgICAgIGNvbnN0IGlzQ29sZFN0YXJ0ID0gdGhpcy5pbnZvY2F0aW9uQ291bnQgPT09IDE7XG4gICAgICBcbiAgICAgIC8vIEdldCBwYXJlbnQgY29udGV4dCBpZiBleGlzdHNcbiAgICAgIGxldCBjb250ZXh0ID0gdGhpcy50cmFjZS5jb250ZXh0LmFjdGl2ZSgpO1xuICAgICAgaWYgKGV2ZW50LnBhcmVudExvZ0lkKSB7XG4gICAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChldmVudC5wYXJlbnRMb2dJZCk7XG4gICAgICAgIGlmIChwYXJlbnRTcGFuKSB7XG4gICAgICAgICAgY29udGV4dCA9IHRoaXMudHJhY2Uuc2V0U3Bhbihjb250ZXh0LCBwYXJlbnRTcGFuKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBDcmVhdGUgYSBuZXcgc3BhbiB1c2luZyBPcGVuVGVsZW1ldHJ5IEFQSSB3aXRoIHBhcmVudCBjb250ZXh0XG4gICAgICBjb25zdCBzcGFuID0gdGhpcy50cmFjZXIuc3RhcnRTcGFuKFxuICAgICAgICBldmVudC5vcGVyYXRpb24gfHwgJ29wZXJhdGlvbicsXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiBnZXRTcGFuS2luZChldmVudC5zdWJUeXBlKSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAvLyBTZXJ2aWNlIG5hbWUgYW5ub3RhdGlvbiAoaW5zcGlyZWQgYnkgQVdTIFBvd2VydG9vbHMpXG4gICAgICAgICAgICAnc2VydmljZS5uYW1lJzogdGhpcy5vcHRpb25zLnNlcnZpY2VOYW1lLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb2xkIHN0YXJ0IGFubm90YXRpb24gKGluc3BpcmVkIGJ5IEFXUyBQb3dlcnRvb2xzKVxuICAgICAgICAgICAgLi4uKGlzUm9vdFNwYW4gJiYgeyAnY29sZFN0YXJ0JzogaXNDb2xkU3RhcnQgfSksXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEFkZCBGVzI0LXNwZWNpZmljIGF0dHJpYnV0ZXNcbiAgICAgICAgICAgICdmdzI0LmNvcnJlbGF0aW9uX2lkJzogZXZlbnQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgICAgICdmdzI0LmVudGl0eV9pZCc6IGV2ZW50LmVudGl0eUlkLFxuICAgICAgICAgICAgJ2Z3MjQuZW50aXR5X25hbWUnOiBldmVudC5lbnRpdHlOYW1lLFxuICAgICAgICAgICAgJ2Z3MjQucGFyZW50X2xvZ19pZCc6IGV2ZW50LnBhcmVudExvZ0lkLFxuICAgICAgICAgICAgJ2Z3MjQuaW52b2NhdGlvbic6IHRoaXMuaW52b2NhdGlvbkNvdW50LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBBZGQgY3VzdG9tIGF0dHJpYnV0ZXMgZnJvbSBldmVudFxuICAgICAgICAgICAgLi4uKGV2ZW50LmF0dHJpYnV0ZXMgfHwge30pLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBBZGQgTGFtYmRhIGNvbnRleHQgKE9URUwgc2VtYW50aWMgY29udmVudGlvbnMpXG4gICAgICAgICAgICAnZmFhcy5uYW1lJzogcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9OQU1FLFxuICAgICAgICAgICAgJ2ZhYXMudmVyc2lvbic6IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fVkVSU0lPTixcbiAgICAgICAgICAgICdmYWFzLmluc3RhbmNlJzogcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9MT0dfU1RSRUFNX05BTUUsXG4gICAgICAgICAgICAnY2xvdWQuYWNjb3VudC5pZCc6IHByb2Nlc3MuZW52LkFXU19BQ0NPVU5UX0lELFxuICAgICAgICAgICAgJ2Nsb3VkLnJlZ2lvbic6IHByb2Nlc3MuZW52LkFXU19SRUdJT04sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdGFydFRpbWU6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0LCAvLyBQYXNzIHBhcmVudCBjb250ZXh0XG4gICAgICApO1xuXG4gICAgICAvLyBTdG9yZSB0aGUgc3BhbiBmb3IgZnV0dXJlIGV2ZW50cy9lbmRcbiAgICAgIHRoaXMuYWN0aXZlU3BhbnMuc2V0KGV2ZW50LmVudGl0eUlkLCBzcGFuKTtcblxuICAgICAgbG9nZ2VyLmRlYnVnKGBDcmVhdGVkIE9wZW5UZWxlbWV0cnkgc3BhbjogJHtldmVudC5vcGVyYXRpb259ICgke2V2ZW50LmVudGl0eUlkfSlgLCB7XG4gICAgICAgIGNvbGRTdGFydDogaXNSb290U3BhbiA/IGlzQ29sZFN0YXJ0IDogdW5kZWZpbmVkLFxuICAgICAgICBpbnZvY2F0aW9uOiB0aGlzLmludm9jYXRpb25Db3VudCxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGNyZWF0aW5nIE9wZW5UZWxlbWV0cnkgc3BhbjonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVTcGFuRXZlbnQoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQuZW50aXR5SWQpIHJldHVybjtcblxuICAgIGNvbnN0IHNwYW4gPSB0aGlzLmFjdGl2ZVNwYW5zLmdldChldmVudC5lbnRpdHlJZCk7XG4gICAgaWYgKCFzcGFuKSB7XG4gICAgICBsb2dnZXIud2FybihgTm8gYWN0aXZlIHNwYW4gZm91bmQgZm9yIGV2ZW50OiAke2V2ZW50LmVudGl0eUlkfWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBBZGQgZXZlbnQgdG8gc3BhblxuICAgICAgc3Bhbi5hZGRFdmVudChldmVudC5vcGVyYXRpb24gfHwgJ2V2ZW50Jywge1xuICAgICAgICB0aW1lc3RhbXA6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgICBhdHRyaWJ1dGVzOiBldmVudC5hdHRyaWJ1dGVzIHx8IHt9LFxuICAgICAgfSk7XG5cbiAgICAgIGxvZ2dlci5kZWJ1ZyhgQWRkZWQgZXZlbnQgdG8gc3BhbiAke2V2ZW50LmVudGl0eUlkfTogJHtldmVudC5vcGVyYXRpb259YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRXJyb3IgYWRkaW5nIGV2ZW50IHRvIE9wZW5UZWxlbWV0cnkgc3BhbjonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTcGFuRW5kKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWV2ZW50LmVudGl0eUlkKSByZXR1cm47XG5cbiAgICBjb25zdCBzcGFuID0gdGhpcy5hY3RpdmVTcGFucy5nZXQoZXZlbnQuZW50aXR5SWQpO1xuICAgIGlmICghc3Bhbikge1xuICAgICAgbG9nZ2VyLndhcm4oYE5vIGFjdGl2ZSBzcGFuIGZvdW5kIGZvciBlbmQgZXZlbnQ6ICR7ZXZlbnQuZW50aXR5SWR9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEFkZCBmaW5hbCBhdHRyaWJ1dGVzXG4gICAgICBpZiAoZXZlbnQuYXR0cmlidXRlcykge1xuICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZXMoZXZlbnQuYXR0cmlidXRlcyk7XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCBtZXRyaWNzIGFzIGF0dHJpYnV0ZXMgKFgtUmF5IGRvZXNuJ3QgaGF2ZSBzZXBhcmF0ZSBtZXRyaWMgY29uY2VwdClcbiAgICAgIGlmIChldmVudC5tZXRyaWNzKSB7XG4gICAgICAgIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKGBtZXRyaWMuJHtrZXl9YCwgdmFsdWUpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIGR1cmF0aW9uXG4gICAgICBpZiAoZXZlbnQuZHVyYXRpb25Ncykge1xuICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnZHVyYXRpb25fbXMnLCBldmVudC5kdXJhdGlvbk1zKTtcbiAgICAgIH1cblxuICAgICAgLy8gU2V0IHN0YXR1cyBiYXNlZCBvbiBzdWNjZXNzL2Vycm9yXG4gICAgICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5zZXRTdGF0dXMoe1xuICAgICAgICAgIGNvZGU6IHRoaXMuU3BhblN0YXR1c0NvZGUuRVJST1IsXG4gICAgICAgICAgbWVzc2FnZTogZXZlbnQuZXJyb3IubWVzc2FnZSxcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZWNvcmQgZXhjZXB0aW9uIHdpdGggZnVsbCBzdGFjayB0cmFjZVxuICAgICAgICBzcGFuLnJlY29yZEV4Y2VwdGlvbih7XG4gICAgICAgICAgbmFtZTogZXZlbnQuZXJyb3IudHlwZSxcbiAgICAgICAgICBtZXNzYWdlOiBldmVudC5lcnJvci5tZXNzYWdlLFxuICAgICAgICAgIHN0YWNrOiBldmVudC5lcnJvci5zdGFjayxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgICAgIHNwYW4uc2V0U3RhdHVzKHtcbiAgICAgICAgICBjb2RlOiB0aGlzLlNwYW5TdGF0dXNDb2RlLkVSUk9SLFxuICAgICAgICAgIG1lc3NhZ2U6IGV2ZW50LnN0YXR1cyB8fCAnT3BlcmF0aW9uIGZhaWxlZCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3Bhbi5zZXRTdGF0dXMoeyBjb2RlOiB0aGlzLlNwYW5TdGF0dXNDb2RlLk9LIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBFbmQgdGhlIHNwYW4gd2l0aCB0aGUgY29ycmVjdCB0aW1lc3RhbXBcbiAgICAgIHNwYW4uZW5kKGV2ZW50LnRpbWVzdGFtcE1zKTtcbiAgICAgIFxuICAgICAgLy8gUmVtb3ZlIGZyb20gYWN0aXZlIHNwYW5zXG4gICAgICB0aGlzLmFjdGl2ZVNwYW5zLmRlbGV0ZShldmVudC5lbnRpdHlJZCk7XG5cbiAgICAgIGxvZ2dlci5kZWJ1ZyhgRW5kZWQgT3BlblRlbGVtZXRyeSBzcGFuOiAke2V2ZW50LmVudGl0eUlkfWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0Vycm9yIGVuZGluZyBPcGVuVGVsZW1ldHJ5IHNwYW46JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEVuZCBhbnkgcmVtYWluaW5nIGFjdGl2ZSBzcGFuc1xuICAgIGlmICh0aGlzLmFjdGl2ZVNwYW5zLnNpemUgPiAwKSB7XG4gICAgICBsb2dnZXIud2FybihgRm9yY2UgZW5kaW5nICR7dGhpcy5hY3RpdmVTcGFucy5zaXplfSBhY3RpdmUgc3BhbnNgKTtcbiAgICAgIHRoaXMuYWN0aXZlU3BhbnMuZm9yRWFjaCgoc3BhbiwgZW50aXR5SWQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzcGFuLnNldFN0YXR1cyh7XG4gICAgICAgICAgICBjb2RlOiB0aGlzLlNwYW5TdGF0dXNDb2RlLkVSUk9SLFxuICAgICAgICAgICAgbWVzc2FnZTogJ1NwYW4gZm9yY2UtY2xvc2VkIGR1ZSB0byBMYW1iZGEgc2h1dGRvd24nLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHNwYW4uZW5kKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBFcnJvciBmb3JjZS1lbmRpbmcgc3BhbiAke2VudGl0eUlkfTpgLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGhpcy5hY3RpdmVTcGFucy5jbGVhcigpO1xuICAgIH1cblxuICAgIC8vIFRoZSBBRE9UIGxheWVyJ3MgT3BlblRlbGVtZXRyeSBDb2xsZWN0b3IgaGFuZGxlcyBmbHVzaGluZyBhdXRvbWF0aWNhbGx5XG4gICAgLy8gV2UgZG9uJ3QgbmVlZCB0byBtYW51YWxseSBmbHVzaCAtIHRoZSBjb2xsZWN0b3IgYmF0Y2hlcyBhbmQgZXhwb3J0cyB0byBYLVJheVxuICAgIGxvZ2dlci5kZWJ1ZygnT1RFTCBiYWNrZW5kIGZsdXNoIGNvbXBsZXRlIChBRE9UIGNvbGxlY3RvciBoYW5kbGVzIGV4cG9ydCknKTtcbiAgfVxuXG4gIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgdGhpcy5hY3RpdmVTcGFucy5jbGVhcigpO1xuICB9XG59XG4iXX0=