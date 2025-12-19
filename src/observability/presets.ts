/**
 * Observability Configuration Presets
 * 
 * Pre-configured observability settings for common environments.
 * Provides sensible defaults that can be overridden as needed.
 */

import { ObservabilityConfig, ObservabilityLevel } from './types';

/**
 * Preset names for common environments
 */
export type ObservabilityPreset = 'production' | 'development' | 'debug' | 'minimal';

/**
 * Production preset: Cost-optimized with smart sampling
 * - Smart sampling enabled with error context capture
 * - 10% sampling for normal traffic
 * - DynamoDB only for WARN+ logs
 * - Critical events always captured
 */
export const productionPreset: ObservabilityConfig = {
  enabled: true,
  minLevel: ObservabilityLevel.INFO,
  serviceName: '', // Must be provided by user

  sampling: {
    enabled: true,
    smart: true,
    maxBufferSize: 1000,
    rates: {
      trace: 0.01,    // 1% trace logs
      debug: 0.01,    // 1% debug logs
      info: 0.1,      // 10% info logs
      warn: 0.5,      // 50% warnings
      error: 1.0,     // 100% errors
      critical: 1.0,  // 100% critical (always)
    },
  },

  backends: [
    {
      type: 'cloudwatch',
      enabled: true,
      minLevel: ObservabilityLevel.INFO,
    },
    {
      type: 'dynamodb',
      enabled: true,
      minLevel: ObservabilityLevel.WARN, // Only WARN+ to DynamoDB
      types: {
        metric: { enabled: false }, // No metrics to DynamoDB
      },
    },
    {
      type: 'otel',
      enabled: true,
      minLevel: ObservabilityLevel.INFO,
    },
  ],

  types: {
    span: {
      minLevel: ObservabilityLevel.INFO,
      sampling: { enabled: true, rate: 0.1 }, // 10% of spans
    },
    metric: {
      minLevel: ObservabilityLevel.INFO,
      sampling: { enabled: false, rate: 1.0 }, // All metrics (no sampling)
    },
    audit: {
      minLevel: ObservabilityLevel.INFO,
      sampling: { enabled: false, rate: 1.0 }, // All audit logs
    },
    log: {
      minLevel: ObservabilityLevel.INFO,
      sampling: { enabled: true, rate: 0.1 }, // 10% of logs
    },
  },

  cloudwatch: {
    namespace: 'Application',
  },

  dynamodb: {
    tableKey: 'observability',
    ttlDays: 30,
  },

  dataProtection: {
    enabled: true,
    fuzzyKeyMatch: true,
    caseSensitiveKeyMatch: false,
    blacklistedKeys: [
      'password',
      'token',
      'secret',
      'apiKey',
      'authorization',
      'creditCard',
      'ssn',
      /private/i,
    ],
  },

  sourceMap: {
    enabled: true, // Enable in production for better error debugging
  },
};

/**
 * Development preset: Balanced visibility and cost
 * - More verbose than production
 * - 50% sampling for most events
 * - All backends enabled
 * - Good for staging environments
 */
export const developmentPreset: ObservabilityConfig = {
  enabled: true,
  minLevel: ObservabilityLevel.DEBUG,
  serviceName: '', // Must be provided by user

  sampling: {
    enabled: true,
    smart: true,
    maxBufferSize: 1000,
    rates: {
      trace: 0.1,    // 10% trace logs
      debug: 0.3,    // 30% debug logs
      info: 0.5,     // 50% info logs
      warn: 1.0,     // 100% warnings
      error: 1.0,    // 100% errors
      critical: 1.0, // 100% critical
    },
  },

  backends: [
    {
      type: 'cloudwatch',
      enabled: true,
      minLevel: ObservabilityLevel.DEBUG,
    },
    {
      type: 'dynamodb',
      enabled: true,
      minLevel: ObservabilityLevel.INFO,
    },
    {
      type: 'otel',
      enabled: true,
      minLevel: ObservabilityLevel.DEBUG,
    },
  ],

  types: {
    span: {
      minLevel: ObservabilityLevel.DEBUG,
      sampling: { enabled: true, rate: 0.5 }, // 50% of spans
    },
    metric: {
      minLevel: ObservabilityLevel.DEBUG,
      sampling: { enabled: false, rate: 1.0 }, // All metrics
    },
    audit: {
      minLevel: ObservabilityLevel.DEBUG,
      sampling: { enabled: false, rate: 1.0 }, // All audit logs
    },
    log: {
      minLevel: ObservabilityLevel.DEBUG,
      sampling: { enabled: true, rate: 0.5 }, // 50% of logs
    },
  },

  cloudwatch: {
    namespace: 'Application',
  },

  dynamodb: {
    tableKey: 'observability',
    ttlDays: 7,
  },

  dataProtection: {
    enabled: true,
    fuzzyKeyMatch: true,
    caseSensitiveKeyMatch: false,
    blacklistedKeys: [
      'password',
      'token',
      'secret',
      'apiKey',
      'authorization',
      'creditCard',
      'ssn',
    ],
  },

  sourceMap: {
    enabled: true, // Enable for better error debugging
  },
};

/**
 * Debug preset: Maximum visibility, no sampling
 * - All events captured
 * - All log levels enabled
 * - Useful for troubleshooting
 * - ⚠️ WARNING: Very expensive, use only for debugging
 */
export const debugPreset: ObservabilityConfig = {
  enabled: true,
  minLevel: ObservabilityLevel.TRACE,
  serviceName: '', // Must be provided by user

  sampling: {
    enabled: false, // No sampling in debug mode
    smart: false,
    maxBufferSize: 2000,
  },

  backends: [
    {
      type: 'cloudwatch',
      enabled: true,
      minLevel: ObservabilityLevel.TRACE,
    },
    {
      type: 'dynamodb',
      enabled: true,
      minLevel: ObservabilityLevel.DEBUG,
    },
    {
      type: 'otel',
      enabled: true,
      minLevel: ObservabilityLevel.TRACE,
    },
  ],

  types: {
    span: {
      minLevel: ObservabilityLevel.TRACE,
      sampling: { enabled: false, rate: 1.0 },
    },
    metric: {
      minLevel: ObservabilityLevel.TRACE,
      sampling: { enabled: false, rate: 1.0 },
    },
    audit: {
      minLevel: ObservabilityLevel.TRACE,
      sampling: { enabled: false, rate: 1.0 },
    },
    log: {
      minLevel: ObservabilityLevel.TRACE,
      sampling: { enabled: false, rate: 1.0 },
    },
  },

  cloudwatch: {
    namespace: 'Application',
  },

  dynamodb: {
    tableKey: 'observability',
    ttlDays: 1,
  },

  dataProtection: {
    enabled: false, // No redaction in debug mode
  },

  sourceMap: {
    enabled: true, // Enable for maximum debugging
  },
};

/**
 * Minimal preset: Bare minimum observability
 * - Only errors and critical events
 * - No sampling needed (already filtered by level)
 * - CloudWatch only
 * - Lowest cost option
 */
export const minimalPreset: ObservabilityConfig = {
  enabled: true,
  minLevel: ObservabilityLevel.ERROR,
  serviceName: '', // Must be provided by user

  sampling: {
    enabled: false,
    smart: false,
  },

  backends: [
    {
      type: 'cloudwatch',
      enabled: true,
      minLevel: ObservabilityLevel.ERROR,
    },
  ],

  types: {
    span: {
      minLevel: ObservabilityLevel.ERROR,
      sampling: { enabled: false, rate: 1.0 },
    },
    metric: {
      minLevel: ObservabilityLevel.ERROR,
      sampling: { enabled: false, rate: 1.0 },
    },
    audit: {
      minLevel: ObservabilityLevel.ERROR,
      sampling: { enabled: false, rate: 1.0 },
    },
    log: {
      minLevel: ObservabilityLevel.ERROR,
      sampling: { enabled: false, rate: 1.0 },
    },
  },

  cloudwatch: {
    namespace: 'Application',
  },

  dynamodb: {
    tableKey: 'observability',
    ttlDays: 7,
  },

  dataProtection: {
    enabled: true,
    blacklistedKeys: [ 'password', 'token', 'secret' ],
  },

  sourceMap: {
    enabled: false, // Minimal preset disables optional features
  },
};

/**
 * Get preset configuration by name
 */
export function getPreset(preset: ObservabilityPreset): ObservabilityConfig {
  switch (preset) {
    case 'production':
      return { ...productionPreset };
    case 'development':
      return { ...developmentPreset };
    case 'debug':
      return { ...debugPreset };
    case 'minimal':
      return { ...minimalPreset };
    default:
      throw new Error(`Unknown observability preset: ${preset}`);
  }
}

/**
 * Deep merge helper for nested objects
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[ key ];
    const targetValue = result[ key ];

    if (sourceValue === undefined) {
      continue;
    }

    if (Array.isArray(sourceValue)) {
      result[ key ] = sourceValue as any;
    } else if (typeof sourceValue === 'object' && sourceValue !== null && !Array.isArray(sourceValue)) {
      if (typeof targetValue === 'object' && targetValue !== null) {
        result[ key ] = deepMerge(targetValue, sourceValue) as any;
      } else {
        result[ key ] = sourceValue as any;
      }
    } else {
      result[ key ] = sourceValue as any;
    }
  }

  return result;
}

/**
 * Create observability configuration with preset and overrides
 * 
 * @example
 * ```typescript
 * // Use production preset with custom service name
 * const config = createObservabilityConfig({
 *   preset: 'production',
 *   serviceName: 'my-api'
 * });
 * 
 * // Use development preset with custom sampling
 * const config = createObservabilityConfig({
 *   preset: 'development',
 *   serviceName: 'my-api',
 *   sampling: {
 *     smart: true,
 *     rates: { info: 0.8 }
 *   }
 * });
 * 
 * // Use debug preset temporarily
 * const config = createObservabilityConfig({
 *   preset: 'debug',
 *   serviceName: 'my-api'
 * });
 * ```
 */
export function createObservabilityConfig(options: {
  preset: ObservabilityPreset;
  serviceName: string;
  overrides?: Partial<ObservabilityConfig>;
}): ObservabilityConfig {
  const { preset, serviceName, overrides = {} } = options;

  if (!serviceName) {
    throw new Error('serviceName is required for observability configuration');
  }

  // Get base preset config
  const baseConfig = getPreset(preset);

  // Set service name
  baseConfig.serviceName = serviceName;

  // Apply overrides if provided
  if (Object.keys(overrides).length > 0) {
    return deepMerge(baseConfig, overrides);
  }

  return baseConfig;
}

