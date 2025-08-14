import { ENV_KEYS } from '../../const';
import { resolveEnvValueFor } from '../../utils';
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
  // Debug & Monitoring
  includeMetadataOnDebug?: boolean;
  includeMetricsOnDebug?: boolean;
  alwaysIncludeMetrics?: boolean;

  // CORS
  corsEnabled?: boolean;
  corsOrigin?: string;
  corsHeaders?: string[];

  // Caching
  defaultCacheControl?: CacheOptions;

  // Formatting
  prettyPrintJson?: boolean;

  // Headers
  defaultHeaders?: Record<string, string>;
}

export const DEFAULT_RESPONSE_CONFIG: ResponseConfig = {
  includeMetadataOnDebug: resolveEnvValueFor<boolean>({ key: ENV_KEYS.RESPONSE_INCLUDE_METADATA, defaultValue: true }),
  includeMetricsOnDebug: resolveEnvValueFor<boolean>({ key: ENV_KEYS.RESPONSE_INCLUDE_METRICS_ON_DEBUG, defaultValue: true }),
  alwaysIncludeMetrics: resolveEnvValueFor<boolean>({ key: ENV_KEYS.RESPONSE_ALWAYS_INCLUDE_METRICS, defaultValue: false }),
  corsEnabled: true,
  corsOrigin: '*',
  prettyPrintJson: resolveEnvValueFor<boolean>({ key: ENV_KEYS.RESPONSE_PRETTY_PRINT_JSON, defaultValue: false }),
  defaultHeaders: { 'Content-Type': 'application/json' }
};

export function mergeResponseConfig(config?: Partial<ResponseConfig>): ResponseConfig {
  return { ...DEFAULT_RESPONSE_CONFIG, ...config };
} 