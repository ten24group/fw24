import { Response } from '../../interfaces/response';
import { APIGatewayProxyResult } from 'aws-lambda';
import { ResponseConfig, DEFAULT_RESPONSE_CONFIG, mergeResponseConfig } from './response-config';

export interface RequestMetrics {
    startTime: number;
    endTime?: number;
    duration?: number;
    statusCode?: number;
    memoryUsage?: NodeJS.MemoryUsage;
    coldStart?: boolean;
}

export interface ResponseMetadata {
    requestId?: string;
    timestamp?: string;
    environment?: string;
    version?: string;
    traceId?: string;
    route?: string;
    [ key: string ]: any;
}

export interface CacheOptions {
    maxAge?: number;
    etag?: string;
    lastModified?: Date;
    private?: boolean;
    noCache?: boolean;
}

export type ResponseContextOptions = {
    timestamp?: string;
    environment?: string;
    version?: string;
    traceId?: string;
    requestId?: string;
    debugMode?: boolean;
    isBase64Encoded?: boolean;
    headers?: Record<string, string>;
    statusCode?: number;
    route?: string;
    config?: Partial<ResponseConfig>;
}

/**
 * ResponseContext builds and serializes API Gateway responses with sensible defaults.
 *
 * By default it applies:
 *   - CORS headers (Access-Control-Allow-Origin)
 *   - Default Content-Type header from config
 *   - Metrics and metadata based on debug settings
 *
 * Example usage in a controller:
 * ```ts
 * // return a JSON response with envelope, metrics, and cache-control
 * return res
 *   .json({ message: 'Hello World' })
 *   .cache({ maxAge: 60 })
 *   .withMetrics()
 *
 * // return plain text
 * return res
 *   .text('OK')
 *   .status(200)
 *
 * // return binary payload
 * return res
 *   .binary(dataBuffer, 'application/octet-stream')
 *   .cache({ maxAge: 3600, private: true })
 * ```
 */
export class ResponseContext implements Response {
    public headers: Record<string, string> = {};
    public body: string = '';
    public statusCode: number = 200;
    public isBase64Encoded: boolean = false;

    private metrics: RequestMetrics;
    private responseData: any | null = null;
    private responseMetadata: ResponseMetadata = {};
    private config: ResponseConfig;
    private debugMode: boolean = false;

    constructor(options: ResponseContextOptions = {}) {
        const {
            timestamp,
            environment,
            version,
            traceId,
            route,
            requestId,
            debugMode = false,
            isBase64Encoded = false,
            headers = {},
            statusCode = 200,
            config = {}
        } = options;

        this.config = mergeResponseConfig(config);
        this.debugMode = debugMode;
        this.headers = { ...this.config.defaultHeaders, ...headers };
        this.statusCode = statusCode;
        this.isBase64Encoded = isBase64Encoded;

        // Initialize metrics
        this.metrics = {
            startTime: Date.now(),
            statusCode: this.statusCode,
            memoryUsage: process.memoryUsage(),
            coldStart: process.env.AWS_LAMBDA_FUNCTION_VERSION === '$LATEST'
        };

        // Initialize metadata
        this.responseMetadata = {
            requestId,
            route,
            timestamp: timestamp || new Date().toISOString(),
            environment: environment || process.env.NODE_ENV || 'development',
            version,
            traceId,
            debugMode
        };

        // Apply default cache settings if configured
        if (this.config.defaultCacheControl) {
            this.cache(this.config.defaultCacheControl);
        }

        // Apply default CORS if enabled
        if (this.config.corsEnabled) {
            this.cors(this.config.corsOrigin);
        }
    }

    // Response Type Helpers
    json<T>(data: T) {
        this.responseData = data;
        this.headers[ 'Content-Type' ] = 'application/json';
        return this;
    }

    text(content: string) {
        this.body = content;
        this.headers[ 'Content-Type' ] = 'text/plain';
        return this;
    }

    binary(data: Buffer | string, contentType?: string) {
        this.body = Buffer.isBuffer(data) ? data.toString('base64') : data;
        this.isBase64Encoded = true;
        if (contentType) {
            this.headers[ 'Content-Type' ] = contentType;
        }
        return this;
    }

    // Response Modifiers
    status(code: number) {
        this.statusCode = code;
        this.metrics.statusCode = code;
        return this;
    }

    redirect(location: string) {
        return this.status(302).header('Location', location);
    }

    header(key: string, value: string) {
        this.headers[ key ] = value;
        return this;
    }

    cors(origin?: string, headers?: string[]) {
        this.headers[ 'Access-Control-Allow-Origin' ] = origin || this.config.corsOrigin || '*';
        if (headers?.length || this.config.corsHeaders?.length) {
            this.headers[ 'Access-Control-Allow-Headers' ] =
                (headers || this.config.corsHeaders || []).join(', ');
        }
        return this;
    }

    cache(options: CacheOptions) {
        if (options.maxAge !== undefined) {
            this.headers[ 'Cache-Control' ] = `max-age=${options.maxAge}${options.private ? ', private' : ''}${options.noCache ? ', no-cache' : ''}`;
        }
        if (options.etag) {
            this.headers[ 'ETag' ] = options.etag;
        }
        if (options.lastModified) {
            this.headers[ 'Last-Modified' ] = options.lastModified.toUTCString();
        }
        return this;
    }

    // Metadata & Metrics
    withMetadata() {
        this.config = { ...this.config, includeMetadataOnDebug: true };
        return this;
    }

    withMetrics() {
        this.config = { ...this.config, alwaysIncludeMetrics: true };
        return this;
    }

    setMetadata(key: string, value: any) {
        this.responseMetadata[ key ] = value;
        return this;
    }

    // Build Final Response
    build(): APIGatewayProxyResult {

        // If we have response data, serialize it with optional envelope
        if (this.responseData !== null) {
            const shouldIncludeMetadata = this.debugMode && this.config.includeMetadataOnDebug;
            const shouldIncludeMetrics = this.config.alwaysIncludeMetrics ||
                (this.debugMode && this.config.includeMetricsOnDebug);

            let responseBody: any = this.responseData;

            if (shouldIncludeMetadata || shouldIncludeMetrics) {
                responseBody = { ...this.responseData };

                if (shouldIncludeMetadata) {
                    responseBody.__metadata = this.responseMetadata;
                }
                if (shouldIncludeMetrics) {
                    this.finalizeMetrics();
                    responseBody.__metrics = this.metrics;
                }
            }

            this.body = JSON.stringify(responseBody, null,
                this.config.prettyPrintJson ? 2 : undefined);
        }

        return {
            statusCode: this.statusCode,
            headers: this.headers,
            body: this.body,
            isBase64Encoded: this.isBase64Encoded
        };
    }

    private finalizeMetrics(): void {
        this.metrics.endTime = Date.now();
        this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
        this.metrics.statusCode = this.statusCode;
        this.metrics.memoryUsage = process.memoryUsage();
    }

    // Legacy Support - these will be deprecated
    /** @deprecated use .text() or .build() instead */
    send(body: string) { return this.text(body); }
    /** @deprecated use .build() or .text() instead */
    end(body: string) { this.body = body; return this; }
    /** @deprecated use .status().text() instead */
    set(body: string, statusCode: number = 200) {
        return this.status(statusCode).text(body);
    }
    /** @deprecated use .header() instead */
    setHeader = this.header;
    getHeader = (key: string) => this.headers[ key ];
    getHeaders = () => this.headers;
    /** @deprecated use .body property directly */
    getBody = () => this.body;
    /** @deprecated use .statusCode property directly */
    getStatusCode = () => this.statusCode;
}