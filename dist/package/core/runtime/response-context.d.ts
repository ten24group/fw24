import { Response } from '../../interfaces/response';
import { APIGatewayProxyResult } from 'aws-lambda';
import { ResponseConfig } from './response-config';
import { Readable } from 'stream';
import { SerializeOptions } from 'cookie';
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
    [key: string]: any;
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
};
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
export declare class ResponseContext implements Response {
    headers: Record<string, string>;
    body: string;
    statusCode: number;
    isBase64Encoded: boolean;
    private metrics;
    private responseData;
    private responseMetadata;
    private config;
    private debugMode;
    private cookies;
    private responseType;
    constructor(options?: ResponseContextOptions);
    json<T>(data: T): this;
    text(content: string): this;
    binary(data: Buffer | string, contentType?: string): this;
    html(content: string): this;
    xml(content: string): this;
    status(code: number): this;
    redirect(location: string): this;
    header(key: string, value: string): this;
    cors(origin?: string, headers?: string[]): this;
    cache(options: CacheOptions): this;
    withMetadata(): this;
    withMetrics(): this;
    setMetadata(key: string, value: any): this;
    cookie(name: string, value: string, options?: SerializeOptions): this;
    clearCookie(name: string, options?: SerializeOptions): this;
    download(content: Buffer | Readable | string, filename: string, options?: {
        contentType?: string;
        contentLength?: number;
        inline?: boolean;
    }): Promise<this>;
    build(): APIGatewayProxyResult;
    private finalizeMetrics;
    /** @deprecated use .text() or .build() instead */
    send(body: string): this;
    /** @deprecated use .build() or .text() instead */
    end(body: string): this;
    /** @deprecated use .status().text() instead */
    set(body: string, statusCode?: number): this;
    /** @deprecated use .header() instead */
    setHeader: (key: string, value: string) => this;
    getHeader: (key: string) => string;
    getHeaders: () => Record<string, string>;
    /** @deprecated use .body property directly */
    getBody: () => string;
    /** @deprecated use .statusCode property directly */
    getStatusCode: () => number;
}
