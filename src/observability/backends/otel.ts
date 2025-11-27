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

import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel, ObservabilityLevelString } from '../types';
import { createLogger } from '../../logging';
import { getSpanKind } from '../utils/span-utils';

// Import types from @opentelemetry/api (available as devDependency for type checking)
import type { Tracer, Span, SpanStatusCode, TraceAPI, ContextAPI, Attributes } from '@opentelemetry/api';
// Import types for metrics (optional - may not be available in all ADOT versions)
import type { Meter } from '@opentelemetry/api';
// Import types for logs (optional - experimental API)
import type { Logger as OTELLogger } from '@opentelemetry/api-logs';

const logger = createLogger('OTELObservabilityBackend');

// Module-level cold start flag (per-container, not per-class)
let coldStartFlag = true;

export interface OTELBackendOptions {
  serviceName: string;
  minLevel?: ObservabilityLevel;
}

// OTEL Severity mapping for logs
const LOG_LEVEL_TO_SEVERITY: Record<ObservabilityLevelString, number> = {
  trace: 1,   // TRACE
  debug: 5,   // DEBUG
  info: 9,    // INFO
  warn: 13,   // WARN
  error: 17,  // ERROR
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
export class OTELObservabilityBackend implements ObservabilityBackend {
  public readonly name = 'otel';
  public readonly minLevel?: ObservabilityLevel;

  // Trace components
  private tracer: Tracer | null = null;
  private trace: TraceAPI | null = null;
  private contextApi: ContextAPI | null = null;
  private spanStatusCode: typeof SpanStatusCode | null = null;
  private activeSpans = new Map<string, Span>();

  // Metrics component (OTEL SDK handles instrument caching internally)
  private meter: Meter | null = null;

  // Logs components
  private otelLogger: OTELLogger | null = null;

  // State
  private isOTELAvailable: boolean = false;
  private isMetricsAvailable: boolean = false;
  private isLogsAvailable: boolean = false;
  private invocationCount: number = 0;
  private initializationPromise: Promise<void> | null = null;

  constructor(private readonly options: OTELBackendOptions) {
    this.minLevel = options.minLevel;
    // Start async initialization immediately
    this.initializationPromise = this.initializeOpenTelemetry();
  }

  private async initializeOpenTelemetry(): Promise<void> {
    // Initialize Traces
    try {
      const otel = await import('@opentelemetry/api');
      this.trace = otel.trace;
      this.contextApi = otel.context;
      this.spanStatusCode = otel.SpanStatusCode;

      // Get the tracer from the global provider (initialized by ADOT layer)
      this.tracer = otel.trace.getTracer(
        this.options.serviceName,
        process.env.npm_package_version || '1.0.0'
      );

      this.isOTELAvailable = true;
      logger.info('OpenTelemetry Traces API available');
    } catch (error) {
      this.isOTELAvailable = false;
      // Log actual error for debugging
      logger.warn('OpenTelemetry Traces API not available - trace instrumentation disabled', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize Metrics (separate try-catch since it may not be available)
    try {
      const otelMetrics = await import('@opentelemetry/api');
      // metrics API is on the same module in OTEL 1.x
      if (otelMetrics.metrics) {
        this.meter = otelMetrics.metrics.getMeter(
          this.options.serviceName,
          process.env.npm_package_version || '1.0.0'
        );
        this.isMetricsAvailable = true;
        logger.info('OpenTelemetry Metrics API available');
      }
    } catch (error) {
      this.isMetricsAvailable = false;
      logger.debug('OpenTelemetry Metrics API not available - metric instrumentation disabled', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize Logs (experimental API - optional package)
    try {
      const otelLogs = await import('@opentelemetry/api-logs');
      if (otelLogs.logs) {
        this.otelLogger = otelLogs.logs.getLogger(
          this.options.serviceName,
          process.env.npm_package_version || '1.0.0'
        );
        this.isLogsAvailable = true;
        logger.info('OpenTelemetry Logs API available');
      }
    } catch (error) {
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
  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
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
    // Ensure async initialization is complete
    await this.ensureInitialized();

    // Route to appropriate handler based on event type
    const type = event.type;

    // Span events → OTEL Traces
    if (type.startsWith('span.')) {
      if (!this.isOTELAvailable) return;
      await this.handleSpanEvent(event);
      return;
    }

    // Metric events → OTEL Metrics
    if (type === 'metric') {
      if (!this.isMetricsAvailable) return;
      this.handleMetricEvent(event);
      return;
    }

    // Log events → OTEL Logs
    if (type === 'log') {
      if (!this.isLogsAvailable) return;
      this.handleLogEvent(event);
      return;
    }

    // Other event types (audit, decision, access, workflow) are not handled by OTEL
    // They go to DynamoDB backend for persistence
  }

  // ==================== SPAN HANDLING ====================

  private async handleSpanEvent(event: ObservabilityEvent): Promise<void> {
    if (event.entityName !== 'span') return;

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

  private handleSpanStart(event: ObservabilityEvent): void {
    if (!event.entityId || !this.tracer || !this.trace || !this.contextApi) return;

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
      const spanAttributes: Attributes = {
        // Service name annotation (inspired by AWS Powertools)
        'service.name': this.options.serviceName,

        // Add FW24-specific attributes (only if defined)
        'fw24.correlation_id': event.correlationId,
        'fw24.invocation': this.invocationCount,
      };

      // Cold start annotation (only on root spans)
      if (isRootSpan) {
        spanAttributes[ 'coldStart' ] = isColdStart;
      }

      // Add optional FW24 attributes only if defined
      if (event.entityId) spanAttributes[ 'fw24.entity_id' ] = event.entityId;
      if (event.entityName) spanAttributes[ 'fw24.entity_name' ] = event.entityName;
      if (event.parentLogId) spanAttributes[ 'fw24.parent_log_id' ] = event.parentLogId;

      // Add custom attributes from event (converted to OTEL-compatible types)
      Object.assign(spanAttributes, this.toOtelAttributes(event.attributes));

      // Add Lambda context (OTEL semantic conventions) - only if defined
      if (process.env.AWS_LAMBDA_FUNCTION_NAME) spanAttributes[ 'faas.name' ] = process.env.AWS_LAMBDA_FUNCTION_NAME;
      if (process.env.AWS_LAMBDA_FUNCTION_VERSION) spanAttributes[ 'faas.version' ] = process.env.AWS_LAMBDA_FUNCTION_VERSION;
      if (process.env.AWS_LAMBDA_LOG_STREAM_NAME) spanAttributes[ 'faas.instance' ] = process.env.AWS_LAMBDA_LOG_STREAM_NAME;
      if (process.env.AWS_ACCOUNT_ID) spanAttributes[ 'cloud.account.id' ] = process.env.AWS_ACCOUNT_ID;
      if (process.env.AWS_REGION) spanAttributes[ 'cloud.region' ] = process.env.AWS_REGION;

      // Create a new span using OpenTelemetry API with parent context
      const span = this.tracer.startSpan(
        event.operation || 'operation',
        {
          kind: getSpanKind(event.subType),
          attributes: spanAttributes,
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

  private handleSpanEventInternal(event: ObservabilityEvent): void {
    if (!event.entityId) return;

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
    } catch (error) {
      logger.error('Error adding event to OpenTelemetry span:', error);
    }
  }

  private handleSpanEnd(event: ObservabilityEvent): void {
    if (!event.entityId || !this.spanStatusCode) return;

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
        Object.entries(event.metrics).forEach(([ key, value ]) => {
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
      } else if (event.success === false) {
        span.setStatus({
          code: statusCode.ERROR,
          message: event.status || 'Operation failed',
        });
      } else {
        span.setStatus({ code: statusCode.OK });
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

  // ==================== METRIC HANDLING ====================

  /**
   * Handle metric events using OTEL's Metrics API
   * 
   * OTEL SDK internally caches instrument instances by name - no manual caching needed.
   */
  private handleMetricEvent(event: ObservabilityEvent): void {
    if (!this.meter || !event.metrics) return;

    try {
      const metricType = event.subType || 'counter';
      const attrs = this.toOtelAttributes(event.attributes);

      for (const [ name, value ] of Object.entries(event.metrics)) {
        switch (metricType) {
          case 'counter':
            if (value < 0) {
              // OTEL Counter is monotonic - use UpDownCounter for negative values
              this.meter.createUpDownCounter(name).add(value, attrs);
            } else {
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
            } else {
              this.meter.createUpDownCounter(name).add(value, attrs);
            }
        }
      }
    } catch (error) {
      logger.error('Error recording OpenTelemetry metric:', error);
    }
  }

  // ==================== LOG HANDLING ====================

  private handleLogEvent(event: ObservabilityEvent): void {
    if (!this.otelLogger) return;

    try {
      const severity = LOG_LEVEL_TO_SEVERITY[ event.level ] || 9; // Default to INFO

      // Safely extract message (avoid unsafe cast)
      const message = this.extractLogMessage(event);

      // Build attributes (filtering undefined)
      const logAttributes: Attributes = {
        ...this.toOtelAttributes(event.attributes),
        ...this.toOtelAttributes(event.data),
        'fw24.correlation_id': event.correlationId,
        'fw24.log_id': event.logId,
      };

      // Add optional attributes only if defined
      if (event.source) logAttributes[ 'fw24.source' ] = event.source;

      // Add error attributes if present
      if (event.error) {
        if (event.error.type) logAttributes[ 'exception.type' ] = event.error.type;
        if (event.error.message) logAttributes[ 'exception.message' ] = event.error.message;
        if (event.error.stack) logAttributes[ 'exception.stacktrace' ] = event.error.stack;
      }

      this.otelLogger.emit({
        severityNumber: severity,
        severityText: event.level.toUpperCase(),
        body: message,
        attributes: logAttributes,
        timestamp: event.timestampMs,
      });

      logger.debug(`Emitted OTEL log: ${event.level} - ${event.operation}`);
    } catch (error) {
      logger.error('Error emitting OpenTelemetry log:', error);
    }
  }

  /**
   * Safely extract log message from event data
   */
  private extractLogMessage(event: ObservabilityEvent): string {
    if (event.data && typeof event.data.message === 'string') {
      return event.data.message;
    }
    return event.operation || 'log';
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Type guard for string array
   */
  private isStringArray(arr: unknown[]): arr is string[] {
    return arr.every((v): v is string => typeof v === 'string');
  }

  /**
   * Type guard for number array
   */
  private isNumberArray(arr: unknown[]): arr is number[] {
    return arr.every((v): v is number => typeof v === 'number');
  }

  /**
   * Type guard for boolean array
   */
  private isBooleanArray(arr: unknown[]): arr is boolean[] {
    return arr.every((v): v is boolean => typeof v === 'boolean');
  }

  // Max size for JSON stringified attributes (X-Ray has ~4KB limit per attribute)
  private static readonly MAX_ATTRIBUTE_SIZE = 4000;

  /**
   * Convert Record<string, unknown> to OTEL Attributes (only primitive values allowed)
   */
  private toOtelAttributes(attrs?: Record<string, unknown>): Attributes {
    if (!attrs) return {};
    const result: Attributes = {};
    for (const [ key, value ] of Object.entries(attrs)) {
      // OTEL only accepts primitives and homogeneous arrays of primitives
      if (typeof value === 'string') {
        // Truncate long strings
        result[ key ] = value.length > OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE
          ? value.substring(0, OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) + '...[truncated]'
          : value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        result[ key ] = value;
      } else if (Array.isArray(value)) {
        // OTEL requires homogeneous arrays - use type guards
        if (value.length === 0) {
          result[ key ] = [];
        } else if (this.isStringArray(value)) {
          result[ key ] = value;
        } else if (this.isNumberArray(value)) {
          result[ key ] = value;
        } else if (this.isBooleanArray(value)) {
          result[ key ] = value;
        } else {
          // Mixed array - stringify with size limit
          result[ key ] = this.safeJsonStringify(value);
        }
      } else if (value !== null && value !== undefined) {
        // Convert complex values to JSON string with size limit
        result[ key ] = this.safeJsonStringify(value);
      }
    }
    return result;
  }

  /**
   * Safely JSON stringify with size limit for OTEL attributes
   */
  private safeJsonStringify(value: unknown): string {
    try {
      const json = JSON.stringify(value);
      if (json.length > OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) {
        return json.substring(0, OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) + '...[truncated]';
      }
      return json;
    } catch {
      return '[unserializable]';
    }
  }

  async flush(): Promise<void> {
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

/**
 * Reset cold start flag (for testing)
 * @internal
 */
export function resetColdStartFlag(): void {
  coldStartFlag = true;
}
