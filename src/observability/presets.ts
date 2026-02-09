/**
 * Observability Configuration Presets
 * 
 * Pre-configured observability settings for common environments.
 * Provides sensible defaults that can be overridden as needed.
 */

import { ObservabilityConfig, ObservabilityLevel } from './types';
import { createObservabilityConfig as createObservabilityConfigFromInput } from './config';

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
 * - Spans < 100ms are skipped (unless they have errors)
 */
export const productionPreset: ObservabilityConfig = createObservabilityConfigFromInput({
  enabled: true,
  minLevel: ObservabilityLevel.INFO,
  // NOTE: presets use framework defaults for serviceName / namespaces / tableKey.
  // Apps can override serviceName via createObservabilityConfig({ serviceName: 'my-app', ... }).

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
      minLevel: ObservabilityLevel.INFO, // Only WARN+ to DynamoDB
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

  dynamodb: { ttlDays: 30 },

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

  // Span-specific config for production
  spans: {
    minDurationMs: 100,   // Skip spans < 100ms (production: focus on slow ops)
    skipEmpty: true,      // Skip spans with no events/errors
  },

  // Noise reduction defaults for FW24 hot paths
  noiseReduction: {
    enabled: true,
    presets: [ 'fw24.hotpaths', 'fw24.batch_processors' ],
  },
});

/**
 * Development preset: Balanced visibility and cost
 * - More verbose than production
 * - 50% sampling for most events
 * - All backends enabled
 * - Spans < 50ms skipped (lower threshold than production)
 * - Good for staging environments
 */
export const developmentPreset: ObservabilityConfig = createObservabilityConfigFromInput({
  enabled: true,
  minLevel: ObservabilityLevel.DEBUG,

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

  dynamodb: { ttlDays: 7 },

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

  // Span-specific config for development
  spans: {
    minDurationMs: 50,    // Skip spans < 50ms (dev: more visibility)
    skipEmpty: true,      // Still skip empty spans
  },

  // Noise reduction defaults (keep dev usable under hot paths)
  noiseReduction: {
    enabled: true,
    presets: [ 'fw24.hotpaths', 'fw24.batch_processors' ],
  },
});

/**
 * Debug preset: Maximum visibility, no sampling
 * - All events captured
 * - All log levels enabled
 * - ALL spans captured regardless of duration
 * - Useful for troubleshooting
 * - ⚠️ WARNING: Very expensive, use only for debugging
 */
export const debugPreset: ObservabilityConfig = createObservabilityConfigFromInput({
  enabled: true,
  minLevel: ObservabilityLevel.TRACE,

  sampling: {
    enabled: false, // No sampling in debug mode
    smart: false,
    maxBufferSize: 5000,
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

  dynamodb: { ttlDays: 1 },

  dataProtection: {
    enabled: false, // No redaction in debug mode
  },

  sourceMap: {
    enabled: true, // Enable for maximum debugging
  },

  // Span-specific config for debug - capture EVERYTHING
  spans: {
    minDurationMs: 0,     // Capture ALL spans regardless of duration
    skipEmpty: false,     // Don't skip empty spans in debug
  },

  // Debug: do not reduce noise unless developer explicitly turns it on
  noiseReduction: {
    enabled: false,
  },

  // Debug: keep raw operation names for maximum fidelity unless developer opts-in.
  operationNormalization: {
    enabled: false,
    rules: [],
    storeOriginal: true,
  },
});

/**
 * Minimal preset: Bare minimum observability
 * - Only errors and critical events
 * - No sampling needed (already filtered by level)
 * - CloudWatch only
 * - Only capture failed/slow spans
 * - Lowest cost option
 */
export const minimalPreset: ObservabilityConfig = createObservabilityConfigFromInput({
  enabled: true,
  minLevel: ObservabilityLevel.ERROR,

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

  dynamodb: { ttlDays: 7 },

  dataProtection: {
    enabled: true,
    blacklistedKeys: [ 'password', 'token', 'secret' ],
  },

  // Span-specific config for minimal - only capture slow/failed spans
  spans: {
    minDurationMs: 500,   // Only capture spans > 500ms (slow operations)
    skipEmpty: true,      // Skip empty spans
  },

  noiseReduction: {
    enabled: true,
    presets: [ 'fw24.hotpaths', 'fw24.batch_processors' ],
  },

  sourceMap: {
    enabled: false, // Minimal preset disables optional features
  },
});

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