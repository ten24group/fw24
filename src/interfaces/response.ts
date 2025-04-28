import { APIGatewayProxyResult } from 'aws-lambda';
import { CacheOptions, RequestMetrics, ResponseMetadata } from '../core/runtime/response-context';
import { Readable } from 'stream';
import { SerializeOptions } from 'cookie';


/**
 * Response is the fluent, builder-style API for constructing
 * AWS API Gateway responses with automatic CORS, metrics,
 * metadata and caching support.
 *
 * You can chain calls like:
 * ```ts
 * return res
 *   .json({ foo: 'bar' })
 *   .cache({ maxAge: 120 })
 *   .withMetrics()
 * ```
 */
export interface Response {
    // Required Properties
    headers: Record<string, string>;
    body: string;
    statusCode: number;
    isBase64Encoded: boolean;

    // Legacy Methods (to be deprecated)
    /** @deprecated use `.text()` or `.build()` */
    send(body: string): this;
    /** @deprecated use `.build()` or `.text()` */
    end(body: string): this;
    /** @deprecated use `.status().text()` */
    set(body: string, statusCode?: number): this;
    /** @deprecated use `.header()` */
    setHeader(key: string, value: string): this;

    getHeader(key: string): string | undefined;
    getHeaders(): Record<string, string>;
    getBody(): string;
    getStatusCode(): number;

    // Fluent Methods
    json<T>(data: T): this;
    text(content: string): this;
    html(content: string): this;
    xml(content: string): this;
    binary(data: Buffer | string, contentType?: string): this;
    download(content: Buffer | Readable | string, filename: string, options?: {
        contentType?: string;
        contentLength?: number;
        inline?: boolean;
    }): Promise<this>;

    status(code: number): this;
    header(key: string, value: string): this;
    cookie(name: string, value: string, options?: SerializeOptions): this;
    cors(origin?: string, headers?: string[]): this;
    cache(options: CacheOptions): this;
    redirect(location: string): this;

    withMetadata(): this;
    withMetrics(): this;

    setMetadata(key: string, value: any): this;
    build(): APIGatewayProxyResult;
}
