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

import { Injectable, InjectConfig } from '../../di';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel, ObservabilityLevelString } from '../types';
import { createLogger } from '../../logging';
import { getSpanKind } from '../utils/span-utils';
import { buildCausedByLinks } from './otel-links';

// Import types from @opentelemetry/api
import type { Tracer, Span, SpanStatusCode, TraceAPI, ContextAPI, Attributes } from '@opentelemetry/api';
import type { Meter } from '@opentelemetry/api';
import type { Logger as OTELLogger } from '@opentelemetry/api-logs';

const logger = createLogger('OTELObservabilityBackend');

// Module-level cold start flag
let coldStartFlag = true;

// OTEL Severity mapping for logs
const LOG_LEVEL_TO_SEVERITY: Record<ObservabilityLevelString, number> = {
  trace: 1,   // TRACE
  debug: 5,   // DEBUG
  info: 9,    // INFO
  warn: 13,   // WARN
  error: 17,  // ERROR
  critical: 21, // FATAL
};

@Injectable({
  provide: 'ObservabilityBackend',
  providedIn: 'ROOT',
  tags: [ 'observability', 'backend', 'otel' ]
})
export class OTELObservabilityBackend implements ObservabilityBackend {
  public readonly name = 'otel';
  public readonly minLevel?: ObservabilityLevel;

  private readonly serviceName: string;

  // Trace components
  private tracer: Tracer | null = null;
  private trace: TraceAPI | null = null;
  private contextApi: ContextAPI | null = null;
  private spanStatusCode: typeof SpanStatusCode | null = null;
  private activeSpans = new Map<string, Span>();

  // Metrics component
  private meter: Meter | null = null;

  // Logs components
  private otelLogger: OTELLogger | null = null;

  // State
  private isOTELAvailable: boolean = false;
  private isMetricsAvailable: boolean = false;
  private isLogsAvailable: boolean = false;
  private invocationCount: number = 0;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    @InjectConfig('observability.serviceName') serviceName: string,
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel
  ) {
    this.serviceName = serviceName;
    this.minLevel = minLevel;
    // Lazy initialization - do not start async process in constructor
  }

  private async initializeOpenTelemetry(): Promise<void> {
    if (this.isOTELAvailable) return;

    // Initialize Traces
    try {
      // Dynamic import wrapped in try-catch to safely handle missing layer
      const otel = await import('@opentelemetry/api');
      this.trace = otel.trace;
      this.contextApi = otel.context;
      this.spanStatusCode = otel.SpanStatusCode;

      this.tracer = otel.trace.getTracer(
        this.serviceName,
        process.env.npm_package_version || '1.0.0'
      );

      this.isOTELAvailable = true;
      logger.info('OpenTelemetry Traces API available');
    } catch (error) {
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
      const otelMetrics = await import('@opentelemetry/api');
      if (otelMetrics.metrics) {
        this.meter = otelMetrics.metrics.getMeter(
          this.serviceName,
          process.env.npm_package_version || '1.0.0'
        );
        this.isMetricsAvailable = true;
        logger.info('OpenTelemetry Metrics API available');
      }
    } catch (error) {
      this.isMetricsAvailable = false;
      logger.debug('OpenTelemetry Metrics API not available', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize Logs
    try {
      const otelLogs = await import('@opentelemetry/api-logs');
      if (otelLogs.logs) {
        this.otelLogger = otelLogs.logs.getLogger(
          this.serviceName,
          process.env.npm_package_version || '1.0.0'
        );
        this.isLogsAvailable = true;
        logger.info('OpenTelemetry Logs API available');
      }
    } catch (error) {
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

  private async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeOpenTelemetry();
    }
    await this.initializationPromise;
  }

  initializeInvocation(): void {
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
        } catch (error) {
          logger.error(`Error ending orphaned span ${entityId}:`, error);
        }
      });
      this.activeSpans.clear();
    }
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    await this.ensureInitialized();

    const type = event.type;

    // FW24 span export: consolidated span records + OTEL-only span.start markers.
    if (type === 'span' || type === 'span.start') {
      if (!this.isOTELAvailable) return;
      await this.handleSpanEvent(event);
      return;
    }

    if (type === 'metric') {
      if (!this.isMetricsAvailable) return;
      this.handleMetricEvent(event);
      return;
    }

    if (type === 'log') {
      if (!this.isLogsAvailable) return;
      this.handleLogEvent(event);
      return;
    }
  }

  // ==================== SPAN HANDLING ====================

  private async handleSpanEvent(event: ObservabilityEvent): Promise<void> {
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
  private handleConsolidatedSpan(event: ObservabilityEvent): void {
    if (!event.observabilityLogId || !this.spanStatusCode) return;

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
          Object.entries(event.metrics).forEach(([ key, value ]) => {
            existingSpan.setAttribute(`metric.${key}`, value);
          });
        }

        if (event.durationMs) {
          existingSpan.setAttribute('duration_ms', event.durationMs);
        }

        // Add checkpoints as OTEL events (from data.checkpoints).
        const data = event.data as Record<string, unknown> | undefined;
        if (data?.checkpoints && Array.isArray(data.checkpoints)) {
          for (const cp of data.checkpoints) {
            const checkpoint = cp as { name?: unknown; ts?: unknown; tags?: unknown; metrics?: unknown; data?: unknown; error?: unknown };
            const name = typeof checkpoint.name === 'string' ? checkpoint.name : 'checkpoint';
            const ts = typeof checkpoint.ts === 'number' ? checkpoint.ts : undefined;
            // OTEL Attributes do not support nested objects; encode structured checkpoint details as JSON strings.
            const attrs: Attributes = {};
            if (checkpoint.tags && typeof checkpoint.tags === 'object') attrs[ 'fw24.checkpoint.tags' ] = JSON.stringify(checkpoint.tags);
            if (checkpoint.metrics && typeof checkpoint.metrics === 'object') attrs[ 'fw24.checkpoint.metrics' ] = JSON.stringify(checkpoint.metrics);
            if (checkpoint.data && typeof checkpoint.data === 'object') attrs[ 'fw24.checkpoint.data' ] = JSON.stringify(checkpoint.data);
            if (checkpoint.error && typeof checkpoint.error === 'object') attrs[ 'fw24.checkpoint.error' ] = JSON.stringify(checkpoint.error);
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
        } else if (event.success === false) {
          existingSpan.setStatus({
            code: statusCode.ERROR,
            message: event.status ?? 'Failed',
          });
        } else {
          existingSpan.setStatus({ code: statusCode.OK });
        }

        existingSpan.end(endTime);
        this.activeSpans.delete(spanId);

        logger.debug(`Ended consolidated OTEL span: ${event.operation} (${spanId})`);
      } catch (error) {
        logger.warn('Failed to end consolidated span:', error);
      }
      return;
    }

    // Fallback: No existing span found (span.start might have been filtered)
    // Create a new span with all data and end it immediately
    if (!this.tracer || !this.trace || !this.contextApi) return;

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

      const spanAttributes: Attributes = {
        'operation.name': event.operation ?? 'unknown',
        'trace.id': event.correlationId,
        'span.id': spanId,
        ...(event.actor?.actorId && { 'user.id': event.actor.actorId }),
        ...(event.actor?.tenantId && { 'tenant.id': event.actor.tenantId }),
        ...(event.source && { 'code.function': event.source }),
        ...(isColdStart && { 'faas.coldstart': true }),
        ...this.toOtelAttributes(event.tags),        // Clean API
        ...this.toOtelAttributes(event.attributes),  // Legacy
      };

      // Add metrics as prefixed attributes
      if (event.metrics) {
        Object.entries(event.metrics).forEach(([ key, value ]) => {
          (spanAttributes as Record<string, unknown>)[ `metric.${key}` ] = value;
        });
      }

      const span = this.tracer.startSpan(
        event.operation ?? 'unknown',
        {
          kind: getSpanKind(event.subType),
          startTime: startTime,
          attributes: spanAttributes,
          links: buildCausedByLinks(event),
        },
        context
      );

      // Add checkpoints from data (canonical).
      const data = event.data as Record<string, unknown> | undefined;
      if (data?.checkpoints && Array.isArray(data.checkpoints)) {
        for (const cp of data.checkpoints) {
          const checkpoint = cp as { name?: unknown; ts?: unknown; tags?: unknown; metrics?: unknown; data?: unknown; error?: unknown };
          const name = typeof checkpoint.name === 'string' ? checkpoint.name : 'checkpoint';
          const ts = typeof checkpoint.ts === 'number' ? checkpoint.ts : undefined;
          // OTEL Attributes do not support nested objects; encode structured checkpoint details as JSON strings.
          const attrs: Attributes = {};
          if (checkpoint.tags && typeof checkpoint.tags === 'object') attrs[ 'fw24.checkpoint.tags' ] = JSON.stringify(checkpoint.tags);
          if (checkpoint.metrics && typeof checkpoint.metrics === 'object') attrs[ 'fw24.checkpoint.metrics' ] = JSON.stringify(checkpoint.metrics);
          if (checkpoint.data && typeof checkpoint.data === 'object') attrs[ 'fw24.checkpoint.data' ] = JSON.stringify(checkpoint.data);
          if (checkpoint.error && typeof checkpoint.error === 'object') attrs[ 'fw24.checkpoint.error' ] = JSON.stringify(checkpoint.error);
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
      } else {
        span.setStatus({ code: statusCode.OK });
      }

      span.end(endTime);
      logger.debug(`Created and ended consolidated OTEL span (fallback): ${event.operation} (${spanId})`);
    } catch (error) {
      logger.warn('Failed to handle consolidated span (fallback):', error);
    }
  }

  private handleSpanStart(event: ObservabilityEvent): void {
    // Use observabilityLogId as span ID (consistent with consolidated mode)
    const spanId = event.observabilityLogId;
    if (!spanId || !this.tracer || !this.trace || !this.contextApi) return;

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

      const spanAttributes: Attributes = {
        'service.name': this.serviceName,
        'fw24.correlation_id': event.correlationId,
        'fw24.invocation': this.invocationCount,
        'fw24.span_id': spanId,
      };

      if (isRootSpan) {
        spanAttributes[ 'coldStart' ] = isColdStart;
      }

      if (event.entityId) spanAttributes[ 'fw24.entity_id' ] = event.entityId;
      if (event.entityName) spanAttributes[ 'fw24.entity_name' ] = event.entityName;
      if (event.parentObservabilityLogId) spanAttributes[ 'fw24.parent_observability_log_id' ] = event.parentObservabilityLogId;

      Object.assign(spanAttributes, this.toOtelAttributes(event.attributes));

      if (process.env.AWS_LAMBDA_FUNCTION_NAME) spanAttributes[ 'faas.name' ] = process.env.AWS_LAMBDA_FUNCTION_NAME;
      if (process.env.AWS_LAMBDA_FUNCTION_VERSION) spanAttributes[ 'faas.version' ] = process.env.AWS_LAMBDA_FUNCTION_VERSION;
      if (process.env.AWS_LAMBDA_LOG_STREAM_NAME) spanAttributes[ 'faas.instance' ] = process.env.AWS_LAMBDA_LOG_STREAM_NAME;
      if (process.env.AWS_ACCOUNT_ID) spanAttributes[ 'cloud.account.id' ] = process.env.AWS_ACCOUNT_ID;
      if (process.env.AWS_REGION) spanAttributes[ 'cloud.region' ] = process.env.AWS_REGION;

      const span = this.tracer.startSpan(
        event.operation || 'operation',
        {
          kind: getSpanKind(event.subType),
          attributes: spanAttributes,
          startTime: event.timestampMs,
          links: buildCausedByLinks(event),
        },
        context,
      );

      this.activeSpans.set(spanId, span);

      logger.debug(`Created OpenTelemetry span: ${event.operation} (${spanId})`, {
        coldStart: isRootSpan ? isColdStart : undefined,
        invocation: this.invocationCount,
      });
    } catch (error) {
      logger.error('Error creating OpenTelemetry span:', error);
    }
  }

  // Legacy span.event/span.end are intentionally not supported.

  // ==================== METRIC HANDLING ====================

  private handleMetricEvent(event: ObservabilityEvent): void {
    if (!this.meter || !event.metrics) return;

    try {
      const metricType = event.subType || 'counter';
      const attrs = this.toOtelAttributes(event.attributes);

      for (const [ name, value ] of Object.entries(event.metrics)) {
        switch (metricType) {
          case 'counter':
            if (value < 0) {
              this.meter.createUpDownCounter(name).add(value, attrs);
            } else {
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
      const severity = LOG_LEVEL_TO_SEVERITY[ event.level ] || 9;
      const message = this.extractLogMessage(event);

      const logAttributes: Attributes = {
        ...this.toOtelAttributes(event.attributes),
        ...this.toOtelAttributes(event.data),
        'fw24.correlation_id': event.correlationId,
        'fw24.observability_log_id': event.observabilityLogId,
      };

      if (event.source) logAttributes[ 'fw24.source' ] = event.source;

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

  private extractLogMessage(event: ObservabilityEvent): string {
    if (event.data && typeof event.data.message === 'string') {
      return event.data.message;
    }
    return event.operation || 'log';
  }

  // ==================== UTILITY METHODS ====================

  private isStringArray(arr: unknown[]): arr is string[] {
    return arr.every((v): v is string => typeof v === 'string');
  }

  private isNumberArray(arr: unknown[]): arr is number[] {
    return arr.every((v): v is number => typeof v === 'number');
  }

  private isBooleanArray(arr: unknown[]): arr is boolean[] {
    return arr.every((v): v is boolean => typeof v === 'boolean');
  }

  private static readonly MAX_ATTRIBUTE_SIZE = 4000;

  private toOtelAttributes(attrs?: Record<string, unknown>): Attributes {
    if (!attrs) return {};
    const result: Attributes = {};
    for (const [ key, value ] of Object.entries(attrs)) {
      if (typeof value === 'string') {
        result[ key ] = value.length > OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE
          ? value.substring(0, OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) + '...[truncated]'
          : value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        result[ key ] = value;
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          result[ key ] = [];
        } else if (this.isStringArray(value)) {
          result[ key ] = value;
        } else if (this.isNumberArray(value)) {
          result[ key ] = value;
        } else if (this.isBooleanArray(value)) {
          result[ key ] = value;
        } else {
          result[ key ] = this.safeJsonStringify(value);
        }
      } else if (value !== null && value !== undefined) {
        result[ key ] = this.safeJsonStringify(value);
      }
    }
    return result;
  }

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

    logger.debug('OTEL backend flush complete (ADOT collector handles export)');
  }

  destroy(): void {
    this.activeSpans.clear();
  }
}

/** Reset cold start flag (for testing) */
export function resetColdStartFlag(): void {
  coldStartFlag = true;
}
