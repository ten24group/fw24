/**
 * Observability DI Setup
 * 
 * Simple config registration - backends are created internally by ObservabilityManager.
 * 
 * Usage:
 * ```typescript
 * // In your DI layer (e.g., src/di.ts):
 * import { DIContainer } from '@ten24group/fw24';
 * import { registerObservabilityConfig } from '@ten24group/fw24/observability';
 * 
 * registerObservabilityConfig(DIContainer.ROOT, {
 *   backends: ['dynamodb', 'cloudwatch'],
 *   dataProtection: { enabled: true },
 * });
 * ```
 */

import { IDIContainer } from '../interfaces/di';
import * as DI_TOKENS from '../const/di';
import { ObservabilityConfig, ObservabilityLevel, ObservabilityLevelString, SamplingConfig } from './types';
import { CONFIG_DEFAULTS, VALID_BACKENDS } from './config';
import { createLogger } from '../logging';

const logger = createLogger('ObservabilityDI');

/**
 * Options for creating observability configuration
 * 
 * ## Configuration Approach
 * 
 * **DI Configuration** - For logical/business configuration:
 * - Which backends to use (dynamodb, cloudwatch, otel)
 * - Sampling rates and levels
 * - Data protection settings
 * - Use this for decisions that don't change per deployment
 * 
 * **Environment Variables** - For operational configuration:
 * - Table names, service names (deployment-specific)
 * - These are read automatically when needed
 * 
 * They work together - not a hierarchy, just different purposes.
 * 
 * @example DI Configuration
 * ```typescript
 * // src/di.ts - logical decisions
 * registerObservabilityConfig(DIContainer.ROOT, {
 *   backends: ['dynamodb', 'cloudwatch'],
 *   minLevel: 'info',
 *   sampling: { enabled: true, rates: { trace: 0.1 } },
 *   dataProtection: { enabled: true }
 * });
 * 
 * // Environment variables - deployment settings
 * // OBSERVABILITY_TABLE_NAME=prod-observability
 * // SERVICE_NAME=my-service-prod
 * ```
 */
export interface ObservabilityConfigOptions {
  /** Minimum level to capture */
  minLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
  
  /** Service name (for CloudWatch, OTEL) */
  serviceName?: string;
  
  /** Backend types to enable */
  backends?: ('dynamodb' | 'cloudwatch' | 'otel')[];
  
  /** DynamoDB configuration */
  dynamodb?: {
    /** TTL in days */
    ttlDays?: number;
  };
  
  /** CloudWatch configuration */
  cloudwatch?: {
    /** Metrics namespace */
    namespace?: string;
  };
  
  /** Sampling configuration */
  sampling?: SamplingConfig;
  
  /** Data protection configuration */
  dataProtection?: {
    enabled?: boolean;
    additionalKeys?: (string | RegExp)[];
    fuzzyKeyMatch?: boolean;
    caseSensitiveKeyMatch?: boolean;
  };
}

/**
 * Create observability config object from options
 */
export function createObservabilityConfig(
  options: ObservabilityConfigOptions = {}
): ObservabilityConfig {
  const minLevel = options.minLevel 
    ? ObservabilityLevel[options.minLevel.toUpperCase() as keyof typeof ObservabilityLevel]
    : CONFIG_DEFAULTS.minLevel;

  const backends = (options.backends || CONFIG_DEFAULTS.backends).map(type => ({
    type: type as (typeof VALID_BACKENDS)[number],
    enabled: true
  }));

  return {
    enabled: true,
    minLevel,
    serviceName: options.serviceName || CONFIG_DEFAULTS.serviceName,
    sampling: {
      enabled: options.sampling?.enabled ?? false,
      rates: options.sampling?.rates,
      operations: options.sampling?.operations
    },
    backends,
    cloudwatch: {
      namespace: options.cloudwatch?.namespace || CONFIG_DEFAULTS.cloudwatchNamespace
    },
    dynamodb: {
      tableName: process.env.OBSERVABILITY_TABLE_NAME || CONFIG_DEFAULTS.tableName,
      ttlDays: options.dynamodb?.ttlDays || CONFIG_DEFAULTS.ttlDays
    },
    dataProtection: {
      enabled: options.dataProtection?.enabled ?? true,
      blacklistedKeys: options.dataProtection?.additionalKeys || [],
      fuzzyKeyMatch: options.dataProtection?.fuzzyKeyMatch ?? true,
      caseSensitiveKeyMatch: options.dataProtection?.caseSensitiveKeyMatch ?? false,
      replacement: '[REDACTED]',
      fields: ['data', 'attributes', 'metadata', 'context']
    }
  };
}

/**
 * Register observability configuration with DI container
 * 
 * This ONLY registers the config - backends are created internally by ObservabilityManager.
 * 
 * @param container - DI container
 * @param options - Configuration options
 */
export function registerObservabilityConfig(
  container: IDIContainer,
  options: ObservabilityConfigOptions = {}
): void {
  const config = createObservabilityConfig(options);
  
  container.register({
    provide: DI_TOKENS.OBSERVABILITY_CONFIG,
    useValue: config
  });

  logger.debug('Observability config registered with DI', {
    backends: config.backends.map(b => b.type),
    minLevel: config.minLevel
  });
}
