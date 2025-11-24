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

import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
import { createLogger } from '../../logging';
import { getSpanKind } from '../utils/span-utils';

const logger = createLogger('OTELObservabilityBackend');

// Module-level cold start flag (per-container, not per-class)
let coldStartFlag = true;

export interface OTELBackendOptions {
  serviceName: string;
  minLevel?: ObservabilityLevel;
}

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
export class OTELObservabilityBackend implements ObservabilityBackend {
  public readonly name = 'otel';
  public readonly minLevel?: ObservabilityLevel;
  
  private tracer: any;
  private trace: any;
  private SpanStatusCode: any;
  private activeSpans = new Map<string, any>();
  private isOTELAvailable: boolean = false;
  
  private invocationCount: number = 0;

  constructor(private readonly options: OTELBackendOptions) {
    this.minLevel = options.minLevel;
    this.initializeOpenTelemetry();
  }

  private initializeOpenTelemetry(): void {
    try {
      // Try to load OpenTelemetry API (provided by ADOT layer at runtime)
      const otel = require('@opentelemetry/api');
      this.trace = otel.trace;
      this.SpanStatusCode = otel.SpanStatusCode;
      
      // Get the tracer from the global provider (initialized by ADOT layer)
      this.tracer = this.trace.getTracer(
        this.options.serviceName,
        process.env.npm_package_version || '1.0.0'
      );
      
      this.isOTELAvailable = true;
      logger.info('OpenTelemetry API available - custom instrumentation enabled');
      logger.info(`Service: ${this.options.serviceName}, X-Ray Trace ID: ${process.env._X_AMZN_TRACE_ID}`);
    } catch (error) {
      // OpenTelemetry not available - this is fine in local development without ADOT layer
      this.isOTELAvailable = false;
      logger.warn('OpenTelemetry API not available - OTEL backend disabled. Install ADOT layer for production.');
    }
  }

  initializeInvocation(): void {
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
        } catch (error) {
          logger.error(`Error ending orphaned span ${entityId}:`, error);
        }
      });
      this.activeSpans.clear();
    }
  }

  async capture(event: ObservabilityEvent): Promise<void> {
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

  private handleSpanStart(event: ObservabilityEvent): void {
    if (!event.entityId || !this.tracer) return;

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
      const span = this.tracer.startSpan(
        event.operation || 'operation',
        {
          kind: getSpanKind(event.subType),
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
        },
        context, // Pass parent context
      );

      // Store the span for future events/end
      this.activeSpans.set(event.entityId, span);

      logger.debug(`Created OpenTelemetry span: ${event.operation} (${event.entityId})`, {
        coldStart: isRootSpan ? isColdStart : undefined,
        invocation: this.invocationCount,
      });
    } catch (error) {
      logger.error('Error creating OpenTelemetry span:', error);
    }
  }

  private handleSpanEvent(event: ObservabilityEvent): void {
    if (!event.entityId) return;

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
    } catch (error) {
      logger.error('Error adding event to OpenTelemetry span:', error);
    }
  }

  private async handleSpanEnd(event: ObservabilityEvent): Promise<void> {
    if (!event.entityId) return;

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
      } else if (event.success === false) {
        span.setStatus({
          code: this.SpanStatusCode.ERROR,
          message: event.status || 'Operation failed',
        });
      } else {
        span.setStatus({ code: this.SpanStatusCode.OK });
      }

      // End the span with the correct timestamp
      span.end(event.timestampMs);
      
      // Remove from active spans
      this.activeSpans.delete(event.entityId);

      logger.debug(`Ended OpenTelemetry span: ${event.entityId}`);
    } catch (error) {
      logger.error('Error ending OpenTelemetry span:', error);
    }
  }

  async flush(): Promise<void> {
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
        } catch (error) {
          logger.error(`Error force-ending span ${entityId}:`, error);
        }
      });
      this.activeSpans.clear();
    }

    // The ADOT layer's OpenTelemetry Collector handles flushing automatically
    // We don't need to manually flush - the collector batches and exports to X-Ray
    logger.debug('OTEL backend flush complete (ADOT collector handles export)');
  }

  destroy(): void {
    this.activeSpans.clear();
  }
}
