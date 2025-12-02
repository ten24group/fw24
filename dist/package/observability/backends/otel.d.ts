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
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
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
export declare class OTELObservabilityBackend implements ObservabilityBackend {
    private readonly options;
    readonly name = "otel";
    readonly minLevel?: ObservabilityLevel;
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
    constructor(options: OTELBackendOptions);
    private initializeOpenTelemetry;
    /**
     * Ensure initialization is complete before using OTEL
     */
    private ensureInitialized;
    initializeInvocation(): void;
    capture(event: ObservabilityEvent): Promise<void>;
    private handleSpanEvent;
    private handleSpanStart;
    private handleSpanEventInternal;
    private handleSpanEnd;
    /**
     * Handle metric events using OTEL's Metrics API
     *
     * OTEL SDK internally caches instrument instances by name - no manual caching needed.
     */
    private handleMetricEvent;
    private handleLogEvent;
    /**
     * Safely extract log message from event data
     */
    private extractLogMessage;
    /**
     * Type guard for string array
     */
    private isStringArray;
    /**
     * Type guard for number array
     */
    private isNumberArray;
    /**
     * Type guard for boolean array
     */
    private isBooleanArray;
    private static readonly MAX_ATTRIBUTE_SIZE;
    /**
     * Convert Record<string, unknown> to OTEL Attributes (only primitive values allowed)
     */
    private toOtelAttributes;
    /**
     * Safely JSON stringify with size limit for OTEL attributes
     */
    private safeJsonStringify;
    flush(): Promise<void>;
    destroy(): void;
}
