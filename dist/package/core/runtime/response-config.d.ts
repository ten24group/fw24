import { CacheOptions } from './response-context';
/**
 * ResponseConfig controls default behavior for ResponseContext:
 *  - includeMetadataOnDebug: include metadata envelope when debugMode=true
 *  - includeMetricsOnDebug: include metrics envelope when debugMode=true
 *  - alwaysIncludeMetrics: always include metrics envelope regardless of debugMode
 *  - corsEnabled, corsOrigin, corsHeaders: CORS header defaults
 *  - defaultCacheControl: default Cache-Control settings
 *  - prettyPrintJson: enable 2-space formatted JSON output
 *  - defaultHeaders: default headers (e.g. Content-Type) applied to every response
 *
 * You can override behavior via ENV variables (see ENV_KEYS.RESPONSE_*),
 * or programmatically by passing 'responseConfig' into your controller constructor.
 */
export interface ResponseConfig {
    includeMetadataOnDebug?: boolean;
    includeMetricsOnDebug?: boolean;
    alwaysIncludeMetrics?: boolean;
    corsEnabled?: boolean;
    corsOrigin?: string;
    corsHeaders?: string[];
    defaultCacheControl?: CacheOptions;
    prettyPrintJson?: boolean;
    defaultHeaders?: Record<string, string>;
}
export declare const DEFAULT_RESPONSE_CONFIG: ResponseConfig;
export declare function mergeResponseConfig(config?: Partial<ResponseConfig>): ResponseConfig;
