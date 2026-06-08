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
import type { ObservabilityBackend, ObservabilityEvent, SpanLifecycleHook, SpanStartInfo, SpanEndInfo } from '../types';
import { ObservabilityLevel } from '../types';
export declare class OTELObservabilityBackend implements ObservabilityBackend, SpanLifecycleHook {
    readonly name = "otel";
    readonly minLevel?: ObservabilityLevel;
    private readonly serviceName;
    private tracer;
    private trace;
    private contextApi;
    private spanStatusCode;
    private activeSpans;
    private meter;
    private otelLogger;
    private isOTELAvailable;
    private isMetricsAvailable;
    private isLogsAvailable;
    private invocationCount;
    private initializationPromise;
    /**
     * Lambda resource attributes - resolved once from standard AWS Lambda env vars.
     * These are always available in Lambda runtime without custom configuration.
     */
    private readonly lambdaAttributes;
    constructor(serviceName: string, minLevel: ObservabilityLevel);
    private initializeOpenTelemetry;
    private ensureInitialized;
    /**
     * Synchronous initialization check.
     * Returns true if OTEL was already initialized (for lifecycle hook fast path).
     */
    private get isInitialized();
    initializeInvocation(): void;
    onSpanStart(info: SpanStartInfo): void;
    onSpanEnd(info: SpanEndInfo): void;
    /**
     * Fallback: create a span from end info alone (for late-init scenarios).
     * Mirrors onSpanStart attributes as closely as possible from SpanEndInfo.
     */
    private createOneShotSpan;
    private addCheckpointEvent;
    capture(event: ObservabilityEvent): Promise<void>;
    private handleMetricEvent;
    private handleLogEvent;
    private extractLogMessage;
    private static readonly MAX_ATTRIBUTE_SIZE;
    private toOtelAttributes;
    private safeJsonStringify;
    flush(): Promise<void>;
    destroy(): void;
}
/** Reset cold start flag (for testing) */
export declare function resetColdStartFlag(): void;
