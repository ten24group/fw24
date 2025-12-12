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
    this.initializationPromise = this.initializeOpenTelemetry();
  }

  private async initializeOpenTelemetry(): Promise<void> {
    // Initialize Traces
    try {
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
      logger.warn('OpenTelemetry Traces API not available', {
        error: error instanceof Error ? error.message : String(error),
      });
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
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }
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

    if (type.startsWith('span.')) {
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
        },
        context,
      );

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
      if (event.attributes) {
        span.setAttributes(this.toOtelAttributes(event.attributes));
      }

      if (event.metrics) {
        Object.entries(event.metrics).forEach(([ key, value ]) => {
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
      } else if (event.success === false) {
        span.setStatus({
          code: statusCode.ERROR,
          message: event.status || 'Operation failed',
        });
      } else {
        span.setStatus({ code: statusCode.OK });
      }

      span.end(event.timestampMs);
      this.activeSpans.delete(event.entityId);
      logger.debug(`Ended OpenTelemetry span: ${event.entityId}`);
    } catch (error) {
      logger.error('Error ending OpenTelemetry span:', error);
    }
  }

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
