/**
 * Observability Configuration
 * 
 * Factory function for creating typed, validated observability config.
 */

import {
  ObservabilityConfig,
  ObservabilityLevel,
  ObservabilityBackendConfig,
  SamplingConfig,
  ObservabilityDataProtectionConfig,
} from './types';
import { DEFAULT_BLACKLISTED_KEYS } from './utils/data-protection';

/**
 * Valid backend types
 */
export const VALID_BACKENDS = [ 'cloudwatch', 'dynamodb', 'otel' ] as const;
export type ValidBackend = typeof VALID_BACKENDS[ number ];

/**
 * Centralized configuration defaults
 */
export const CONFIG_DEFAULTS = {
  serviceName: 'fw24-service',
  cloudwatchNamespace: 'FW24',
  // tableKey is the logical table name used to derive env var key
  // Env var: {tableKey}_table = actual CDK table name
  tableKey: 'observabilitylogs',
  ttlDays: 90,
  minLevel: ObservabilityLevel.INFO,
  enabled: false,
} as const;

/**
 * Input type for createObservabilityConfig - all fields optional
 */
export interface ObservabilityConfigInput {
  enabled?: boolean;
  minLevel?: ObservabilityLevel;
  serviceName?: string;
  backends?: Array<{ type: ValidBackend; enabled?: boolean; minLevel?: ObservabilityLevel }>;
  sampling?: Partial<SamplingConfig>;
  cloudwatch?: { namespace?: string };
  dynamodb?: {
    /** Logical table key - resolved to actual table name via env var {tableKey}_table */
    tableKey?: string;
    ttlDays?: number;
  };
  dataProtection?: Partial<ObservabilityDataProtectionConfig>;
  types?: ObservabilityConfig[ 'types' ];
}

/**
 * Create a complete, validated ObservabilityConfig from partial input
 * 
 * @param input - Partial config from application
 * @returns Complete ObservabilityConfig with defaults merged
 * @throws Error if validation fails
 * 
 * @example
 * ```typescript
 * // In your app's di.ts:
 * import { DIContainer } from '@ten24group/fw24';
 * import { createObservabilityConfig } from '@ten24group/fw24/observability';
 * 
 * DIContainer.ROOT.registerConfigProvider({
 *   provide: 'observability',
 *   useConfig: createObservabilityConfig({
 *     serviceName: 'my-app',
 *     backends: [{ type: 'cloudwatch' }, { type: 'dynamodb' }],
 *     // tableKey defaults to 'observabilitylogs'
 *   }),
 *   priority: 10
 * });
 * ```
 */
export function createObservabilityConfig(input: ObservabilityConfigInput = {}): ObservabilityConfig {
  const serviceName = input.serviceName ?? CONFIG_DEFAULTS.serviceName;
  const defaultTableKey = CONFIG_DEFAULTS.tableKey;

  // Build complete config with defaults
  const config: ObservabilityConfig = {
    enabled: input.enabled ?? CONFIG_DEFAULTS.enabled,
    minLevel: input.minLevel ?? CONFIG_DEFAULTS.minLevel,
    serviceName,
    backends: normalizeBackends(input.backends),
    sampling: {
      enabled: input.sampling?.enabled ?? false,
      rates: input.sampling?.rates,
      operations: input.sampling?.operations,
    },
    cloudwatch: {
      namespace: input.cloudwatch?.namespace ?? CONFIG_DEFAULTS.cloudwatchNamespace,
    },
    dynamodb: {
      tableKey: input.dynamodb?.tableKey ?? defaultTableKey,
      ttlDays: input.dynamodb?.ttlDays ?? CONFIG_DEFAULTS.ttlDays,
    },
    dataProtection: {
      enabled: input.dataProtection?.enabled ?? true,
      blacklistedKeys: input.dataProtection?.blacklistedKeys ?? DEFAULT_BLACKLISTED_KEYS,
      fuzzyKeyMatch: input.dataProtection?.fuzzyKeyMatch ?? true,
      caseSensitiveKeyMatch: input.dataProtection?.caseSensitiveKeyMatch ?? false,
      replacement: input.dataProtection?.replacement ?? '[REDACTED]',
      fields: input.dataProtection?.fields ?? [ 'data', 'attributes', 'metadata', 'context' ],
    },
    types: input.types,
  };

  // Validate
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid observability config: ${errors.join(', ')}`);
  }

  return config;
}

/**
 * Normalize backends input to full BackendConfig array
 */
function normalizeBackends(
  input?: Array<{ type: ValidBackend; enabled?: boolean; minLevel?: ObservabilityLevel }>
): ObservabilityBackendConfig[] {
  if (!input || input.length === 0) {
    return [ { type: 'cloudwatch', enabled: true } ];
  }

  return input.map(b => ({
    type: b.type,
    enabled: b.enabled ?? true,
    minLevel: b.minLevel,
  })) as ObservabilityBackendConfig[];
}

/**
 * Validate observability configuration
 * Returns array of validation errors (empty if valid)
 */
export function validateConfig(config: ObservabilityConfig): string[] {
  const errors: string[] = [];

  // Validate minLevel
  const validLevels = Object.values(ObservabilityLevel).filter((v) => typeof v === 'number');
  if (!validLevels.includes(config.minLevel)) {
    errors.push(`Invalid minLevel: ${config.minLevel}`);
  }

  // Validate sampling rates
  if (config.sampling?.enabled && config.sampling.rates) {
    Object.entries(config.sampling.rates).forEach(([ level, rate ]) => {
      if (typeof rate !== 'number' || rate < 0 || rate > 1) {
        errors.push(`Invalid sampling rate for ${level}: ${rate}. Must be between 0 and 1.`);
      }
    });
  }

  // Validate backend types
  config.backends?.forEach((backend, index) => {
    if (!VALID_BACKENDS.includes(backend.type as ValidBackend)) {
      errors.push(`Invalid backend type at index ${index}: ${backend.type}`);
    }
  });

  // Validate serviceName
  if (!config.serviceName || config.serviceName.trim() === '') {
    errors.push('serviceName is required and cannot be empty');
  }

  // Validate cloudwatch.namespace
  if (!config.cloudwatch?.namespace || config.cloudwatch.namespace.trim() === '') {
    errors.push('cloudwatch.namespace is required and cannot be empty');
  }

  // Validate dynamodb.tableKey
  if (!config.dynamodb?.tableKey || config.dynamodb.tableKey.trim() === '') {
    errors.push('dynamodb.tableKey is required and cannot be empty');
  }

  // Validate dynamodb.ttlDays
  if (config.dynamodb && (typeof config.dynamodb.ttlDays !== 'number' || config.dynamodb.ttlDays < 1)) {
    errors.push(`Invalid dynamodb.ttlDays: ${config.dynamodb.ttlDays}. Must be a positive number.`);
  }

  return errors;
}
