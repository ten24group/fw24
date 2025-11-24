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
export declare class OTELObservabilityBackend implements ObservabilityBackend {
    private readonly options;
    readonly name = "otel";
    readonly minLevel?: ObservabilityLevel;
    private tracer;
    private trace;
    private SpanStatusCode;
    private activeSpans;
    private isOTELAvailable;
    private invocationCount;
    constructor(options: OTELBackendOptions);
    private initializeOpenTelemetry;
    initializeInvocation(): void;
    capture(event: ObservabilityEvent): Promise<void>;
    private handleSpanStart;
    private handleSpanEvent;
    private handleSpanEnd;
    flush(): Promise<void>;
    destroy(): void;
}
