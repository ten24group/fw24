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

import { Injectable, InjectConfig } from '../../di';
import type {
  ObservabilityBackend,
  ObservabilityEvent,
  ObservabilityLevelString,
  SpanLifecycleHook,
  SpanStartInfo,
  SpanEndInfo,
} from '../types';
import { ObservabilityLevel } from '../types';
import { createLogger } from '../../logging';
import { getSpanKind } from '../utils/span-utils';
import { toW3CParentId, toW3CTraceId } from '../../core/runtime/execution-context/propagation';

// Import types from @opentelemetry/api
import type { Tracer, Span, SpanStatusCode, TraceAPI, ContextAPI, Attributes, Link, SpanContext } from '@opentelemetry/api';
import type { Meter } from '@opentelemetry/api';
import type { Logger as OTELLogger } from '@opentelemetry/api-logs';

const logger = createLogger('OTELObservabilityBackend');

// Module-level cold start flag
let coldStartFlag = true;

// OTEL Severity mapping for logs
const LOG_LEVEL_TO_SEVERITY: Readonly<Record<ObservabilityLevelString, number>> = {
  trace: 1,   // TRACE
  debug: 5,   // DEBUG
  info: 9,    // INFO
  warn: 13,   // WARN
  error: 17,  // ERROR
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
function buildCausedByLinks(correlationId: string, causedBy: string | undefined): Link[] {
  const trimmed = causedBy?.trim();
  if (!trimmed || trimmed === correlationId) return [];

  const context: SpanContext = {
    traceId: toW3CTraceId(trimmed),
    spanId: toW3CParentId(trimmed),
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

@Injectable({
  provide: 'ObservabilityBackend',
  providedIn: 'ROOT',
  tags: ['observability', 'backend', 'otel']
})
export class OTELObservabilityBackend implements ObservabilityBackend, SpanLifecycleHook {
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

  /**
   * Lambda resource attributes - resolved once from standard AWS Lambda env vars.
   * These are always available in Lambda runtime without custom configuration.
   */
  private readonly lambdaAttributes: Readonly<Record<string, string>> = Object.freeze(
    Object.fromEntries(
      [
        ['faas.name',     process.env.AWS_LAMBDA_FUNCTION_NAME],
        ['faas.version',  process.env.AWS_LAMBDA_FUNCTION_VERSION],
        ['faas.instance',  process.env.AWS_LAMBDA_LOG_STREAM_NAME],
        ['cloud.region',  process.env.AWS_REGION],
      ].filter((entry): entry is [string, string] => entry[1] != null)
    )
  );

  constructor(
    @InjectConfig('observability.serviceName') serviceName: string,
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel
  ) {
    this.serviceName = serviceName;
    this.minLevel = minLevel;
  }

  private async initializeOpenTelemetry(): Promise<void> {
    if (this.isOTELAvailable) return;

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

  /**
   * Synchronous initialization check.
   * Returns true if OTEL was already initialized (for lifecycle hook fast path).
   */
  private get isInitialized(): boolean {
    return this.isOTELAvailable;
  }

  initializeInvocation(): void {
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
        } catch (error) {
          logger.error(`Error ending orphaned span ${spanId}:`, error);
        }
      });
      this.activeSpans.clear();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SpanLifecycleHook implementation (direct calls from SpanObserver)
  // ═══════════════════════════════════════════════════════════════════════════

  onSpanStart(info: SpanStartInfo): void {
    if (!this.isInitialized || !this.tracer || !this.trace || !this.contextApi) return;

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

      const spanAttributes: Attributes = {
        'service.name': this.serviceName,
        'fw24.correlation_id': info.correlationId,
        'fw24.invocation': this.invocationCount,
        'fw24.span_id': info.id,
      };

      if (isRootSpan) {
        spanAttributes['coldStart'] = isColdStart;
      }

      if (info.parentId) spanAttributes['fw24.parent_observability_log_id'] = info.parentId;
      if (info.source) spanAttributes['code.function'] = info.source;

      if (info.tags) {
        Object.assign(spanAttributes, this.toOtelAttributes(info.tags as Record<string, unknown>));
      }

      // Lambda resource attributes (resolved once at construction, no per-span env lookups)
      Object.assign(spanAttributes, this.lambdaAttributes);

      const span = this.tracer.startSpan(
        info.operation,
        {
          kind: getSpanKind(info.subType),
          attributes: spanAttributes,
          startTime: info.startTimeMs,
          links: buildCausedByLinks(info.correlationId, info.causedBy),
        },
        context,
      );

      this.activeSpans.set(info.id, span);
      logger.debug(`Created OTEL span: ${info.operation} (${info.id})`);
    } catch (error) {
      logger.error('Error creating OTEL span:', error);
    }
  }

  onSpanEnd(info: SpanEndInfo): void {
    if (!this.isInitialized || !this.spanStatusCode) return;

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
        existingSpan.setAttributes(this.toOtelAttributes(info.tags as Record<string, unknown>));
      }
      if (info.metrics) {
        for (const [key, value] of Object.entries(info.metrics)) {
          existingSpan.setAttribute(`metric.${key}`, value);
        }
      }
      existingSpan.setAttribute('duration_ms', info.durationMs);

      // Add checkpoints as OTEL events
      if (info.data) {
        const checkpoints = (info.data as Record<string, unknown>).checkpoints;
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
      } else if (!info.success) {
        existingSpan.setStatus({ code: statusCode.ERROR, message: 'Failed' });
      } else {
        existingSpan.setStatus({ code: statusCode.OK });
      }

      existingSpan.end(endTime);
      this.activeSpans.delete(info.id);
      logger.debug(`Ended OTEL span: ${info.operation} (${info.id})`);
    } catch (error) {
      logger.warn('Failed to end OTEL span:', error);
    }
  }

  /**
   * Fallback: create a span from end info alone (for late-init scenarios).
   * Mirrors onSpanStart attributes as closely as possible from SpanEndInfo.
   */
  private createOneShotSpan(info: SpanEndInfo): void {
    if (!this.tracer || !this.trace || !this.contextApi || !this.spanStatusCode) return;

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

      const spanAttributes: Attributes = {
        'service.name': this.serviceName,
        'fw24.span_id': info.id,
        'fw24.correlation_id': info.correlationId,
        'fw24.invocation': this.invocationCount,
        'fw24.one_shot': true,
        'duration_ms': info.durationMs,
      };

      if (info.parentId) spanAttributes['fw24.parent_observability_log_id'] = info.parentId;
      if (info.source) spanAttributes['code.function'] = info.source;

      // Lambda resource attributes (resolved once at construction)
      Object.assign(spanAttributes, this.lambdaAttributes);

      if (info.tags) {
        Object.assign(spanAttributes, this.toOtelAttributes(info.tags as Record<string, unknown>));
      }
      if (info.metrics) {
        for (const [key, value] of Object.entries(info.metrics)) {
          spanAttributes[`metric.${key}`] = value;
        }
      }

      const span = this.tracer.startSpan(
        info.operation,
        {
          kind: getSpanKind(info.subType),
          startTime: info.startTimeMs,
          attributes: spanAttributes,
          links: buildCausedByLinks(info.correlationId, info.causedBy),
        },
        context,
      );

      // Add checkpoints
      if (info.data) {
        const checkpoints = (info.data as Record<string, unknown>).checkpoints;
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
      } else if (!info.success) {
        span.setStatus({ code: statusCode.ERROR, message: 'Failed' });
      } else {
        span.setStatus({ code: statusCode.OK });
      }

      span.end(endTime);
      logger.debug(`Created one-shot OTEL span: ${info.operation} (${info.id})`);
    } catch (error) {
      logger.warn('Failed to create one-shot OTEL span:', error);
    }
  }

  private addCheckpointEvent(span: Span, cp: unknown): void {
    const checkpoint = cp as { name?: unknown; ts?: unknown; tags?: unknown; metrics?: unknown; data?: unknown; error?: unknown };
    const name = typeof checkpoint.name === 'string' ? checkpoint.name : 'checkpoint';
    const ts = typeof checkpoint.ts === 'number' ? checkpoint.ts : undefined;
    const attrs: Attributes = {};
    if (checkpoint.tags && typeof checkpoint.tags === 'object') attrs['fw24.checkpoint.tags'] = JSON.stringify(checkpoint.tags);
    if (checkpoint.metrics && typeof checkpoint.metrics === 'object') attrs['fw24.checkpoint.metrics'] = JSON.stringify(checkpoint.metrics);
    if (checkpoint.data && typeof checkpoint.data === 'object') attrs['fw24.checkpoint.data'] = JSON.stringify(checkpoint.data);
    if (checkpoint.error && typeof checkpoint.error === 'object') attrs['fw24.checkpoint.error'] = JSON.stringify(checkpoint.error);
    span.addEvent(name, attrs, ts);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // capture() - Only handles metrics and logs (spans use lifecycle hooks)
  // ═══════════════════════════════════════════════════════════════════════════

  async capture(event: ObservabilityEvent): Promise<void> {
    await this.ensureInitialized();

    const type = event.type;

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

    // span and span.start are no longer handled here - they use SpanLifecycleHook
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Metric handling
  // ═══════════════════════════════════════════════════════════════════════════

  private handleMetricEvent(event: ObservabilityEvent): void {
    if (!this.meter || !event.metrics) return;

    try {
      const metricType = event.subType || 'counter';
      const attrs = this.toOtelAttributes(event.attributes);

      for (const [name, value] of Object.entries(event.metrics)) {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Log handling
  // ═══════════════════════════════════════════════════════════════════════════

  private handleLogEvent(event: ObservabilityEvent): void {
    if (!this.otelLogger) return;

    try {
      const severity = LOG_LEVEL_TO_SEVERITY[event.level] || 9;
      const message = this.extractLogMessage(event);

      const logAttributes: Attributes = {
        ...this.toOtelAttributes(event.attributes),
        ...this.toOtelAttributes(event.data),
        'fw24.correlation_id': event.correlationId,
        'fw24.observability_log_id': event.observabilityLogId,
      };

      if (event.source) logAttributes['fw24.source'] = event.source;

      if (event.error) {
        if (event.error.type) logAttributes['exception.type'] = event.error.type;
        if (event.error.message) logAttributes['exception.message'] = event.error.message;
        if (event.error.stack) logAttributes['exception.stacktrace'] = event.error.stack;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Utility methods
  // ═══════════════════════════════════════════════════════════════════════════

  private static readonly MAX_ATTRIBUTE_SIZE = 4000;

  private toOtelAttributes(attrs?: Record<string, unknown>): Attributes {
    if (!attrs) return {};
    const result: Attributes = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value === 'string') {
        result[key] = value.length > OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE
          ? value.substring(0, OTELObservabilityBackend.MAX_ATTRIBUTE_SIZE) + '...[truncated]'
          : value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value;
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          result[key] = [];
        } else if (value.every((v): v is string => typeof v === 'string')) {
          result[key] = value;
        } else if (value.every((v): v is number => typeof v === 'number')) {
          result[key] = value;
        } else if (value.every((v): v is boolean => typeof v === 'boolean')) {
          result[key] = value;
        } else {
          result[key] = this.safeJsonStringify(value);
        }
      } else if (value !== null && value !== undefined) {
        result[key] = this.safeJsonStringify(value);
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
      this.activeSpans.forEach((span, spanId) => {
        try {
          span.setStatus({
            code: statusCode.ERROR,
            message: 'Span force-closed due to Lambda shutdown',
          });
          span.end();
        } catch (error) {
          logger.error(`Error force-ending span ${spanId}:`, error);
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
