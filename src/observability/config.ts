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
  SamplingRule,
  ObservabilityDataProtectionConfig,
  NoiseReductionConfig,
  TypeSpecificConfig,
} from './types';
import { DEFAULT_BLACKLISTED_KEYS } from './utils/data-protection';
import type { DeepPartial } from '../utils/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

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
  sourceMapEnabled: false,
  spans: {
    minDurationMs: 50,
    skipEmpty: true,
  },
  operationNormalization: {
    enabled: true,
    storeOriginal: true,
  },
  // Noise reduction defaults: enabled in framework configs (can be disabled per preset/app).
  noiseReduction: {
    enabled: false,
    presets: [ 'fw24.hotpaths', 'fw24.batch_processors' ],
    rules: [],
    emitSummaries: true,
    // Bounds (match the policy engine defaults)
    maxCheckpointsPerSpan: 500,
    maxAggregateKeysPerSpan: 200,
    maxAggregateExamplesPerKey: 5,
    maxAggregateErrorExamplesPerKey: 3,
    // Production defaults: checkpoints yes, debug metadata no
    includeDebugMetadata: false,
    includeExamples: false,
  } satisfies NoiseReductionConfig,
  // DynamoDB compression defaults
  compression: {
    enabled: false,
    threshold: 50 * 1024, // 50KB - only compress large payloads
    fields: [ 'data', 'attributes', 'metadata', 'context' ] as const,
  },
} as const;

export const DEFAULT_OPERATION_NORMALIZATION_RULES: NonNullable<ObservabilityConfig[ 'operationNormalization' ]>[ 'rules' ] = [
  {
    id: 'fw24.http.uuid',
    match: '/\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b/gi',
    replace: ':uuid',
    reason: 'Reduce cardinality by normalizing UUIDs in operation names',
  },
  {
    id: 'fw24.http.hex16',
    match: '/\\b[0-9a-f]{16}\\b/gi',
    replace: ':id',
    reason: 'Reduce cardinality by normalizing 16-hex IDs in operation names',
  },
  {
    id: 'fw24.http.numeric',
    match: '/\\b\\d{4,}\\b/g',
    replace: ':n',
    reason: 'Reduce cardinality by normalizing large numeric IDs in operation names',
  },
];

/**
 * Input type for createObservabilityConfig - all fields optional
 */
export interface ObservabilityConfigInput {
  enabled?: boolean;
  minLevel?: ObservabilityLevel;
  serviceName?: string;
  /**
   * Backend configs (input form).
   *
   * Accepts full backend configs (including `types` filters) but allows `enabled` to be omitted.
   * This keeps presets and app configs expressive without casting.
   */
  backends?: ObservabilityBackendConfigInput[];
  sampling?: Partial<SamplingConfig>;
  cloudwatch?: { namespace?: string };
  dynamodb?: {
    /** Logical table key - resolved to actual table name via env var {tableKey}_table */
    tableKey?: string;
    ttlDays?: number;
    /** Compression configuration for large payloads */
    compression?: {
      enabled?: boolean;
      threshold?: number;
      fields?: Array<'data' | 'attributes' | 'metadata' | 'context'>;
    };
  };
  dataProtection?: Partial<ObservabilityDataProtectionConfig>;
  types?: ObservabilityConfig[ 'types' ];
  sourceMap?: {
    /** Enable source-map-support for better error stack traces (requires source-map-support package) */
    enabled?: boolean;
  };
  /**
   * Span-specific configuration
   */
  spans?: {
    /** Skip spans faster than this (ms). Default: 50 */
    minDurationMs?: number;
    /** Skip spans with no events/errors. Default: true */
    skipEmpty?: boolean;
  };

  /**
   * Noise reduction configuration (merge/drop/aggregate).
   */
  noiseReduction?: Partial<NoiseReductionConfig>;

  /**
   * Operation normalization / renaming.
   */
  operationNormalization?: ObservabilityConfig[ 'operationNormalization' ];
}

type WithOptionalEnabled<T> =
  T extends { enabled: boolean }
  ? (Omit<T, 'enabled'> & { enabled?: boolean })
  : T;

export type ObservabilityBackendConfigInput = WithOptionalEnabled<ObservabilityBackendConfig>;

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
export function createObservabilityConfig(input: DeepPartial<ObservabilityConfigInput> = {}): ObservabilityConfig {
  const serviceName = input.serviceName ?? CONFIG_DEFAULTS.serviceName;

  const config: ObservabilityConfig = {
    enabled: input.enabled ?? CONFIG_DEFAULTS.enabled,
    minLevel: input.minLevel ?? CONFIG_DEFAULTS.minLevel,
    serviceName,
    backends: normalizeBackends(input.backends),
    sampling: normalizeSampling(input.sampling),
    cloudwatch: normalizeCloudWatch(input.cloudwatch),
    dynamodb: normalizeDynamoDb(input.dynamodb),
    dataProtection: normalizeDataProtection(input.dataProtection),
    sourceMap: { enabled: input.sourceMap?.enabled ?? CONFIG_DEFAULTS.sourceMapEnabled },
    types: normalizeTypes(input.types),
    spans: normalizeSpanConfig(input.spans),
    // Centralized defaults: noiseReduction is always present (enabled can be toggled per preset/app).
    noiseReduction: normalizeNoiseReduction(input.noiseReduction),
    operationNormalization: normalizeOperationNormalization(input.operationNormalization),
  };

  // Validate
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid observability config: ${errors.join(', ')}`);
  }

  return config;
}

function normalizeSampling(input?: DeepPartial<SamplingConfig>): SamplingConfig {
  const operationsIn = input?.operations;
  const operations: Record<string, number> | undefined = isRecord(operationsIn)
    ? (() => {
      const out: Record<string, number> = {};
      for (const [ k, v ] of Object.entries(operationsIn)) {
        if (typeof v === 'number') out[ k ] = v;
      }
      return out;
    })()
    : undefined;

  const ratesIn = input?.rates;
  const rates: Record<string, number> | undefined = isRecord(ratesIn)
    ? (() => {
      const out: Record<string, number> = {};
      for (const [ k, v ] of Object.entries(ratesIn)) {
        if (typeof v === 'number') out[ k ] = v;
      }
      return out;
    })()
    : undefined;

  const isSamplingTarget = (v: unknown): v is SamplingRule[ 'target' ] =>
    v === 'source' || v === 'tenant' || v === 'route' || v === 'tag' || v === 'actor';

  const isSamplingRule = (v: unknown): v is SamplingRule => {
    if (!isRecord(v)) return false;
    if (!isSamplingTarget(v.target)) return false;
    if (!(typeof v.pattern === 'string' || v.pattern instanceof RegExp)) return false;
    if (typeof v.rate !== 'number') return false;
    return true;
  };

  const rules: SamplingRule[] | undefined = Array.isArray(input?.rules)
    ? input.rules.filter(isSamplingRule)
    : undefined;

  return {
    enabled: input?.enabled ?? false,
    smart: input?.smart,
    maxBufferSize: input?.maxBufferSize,
    minLevelOnError: input?.minLevelOnError,
    rates,
    operations,
    rules,
  };
}

function normalizeTypeSpecificConfig(input?: DeepPartial<TypeSpecificConfig>): TypeSpecificConfig | undefined {
  if (!input) return undefined;
  if (!isRecord(input)) return undefined;

  const samplingIn = input.sampling;
  let sampling: TypeSpecificConfig[ 'sampling' ] | undefined;
  if (samplingIn !== undefined) {
    if (!isRecord(samplingIn)) {
      throw new Error('Invalid observability.types.*.sampling: must be an object');
    }
    if (typeof samplingIn.enabled !== 'boolean' || typeof samplingIn.rate !== 'number') {
      throw new Error('Invalid observability.types.*.sampling: requires { enabled: boolean, rate: number }');
    }
    sampling = { enabled: samplingIn.enabled, rate: samplingIn.rate };
  }

  type BackendName = 'cloudwatch' | 'dynamodb' | 'otel';
  const isValidBackend = (v: unknown): v is BackendName =>
    v === 'cloudwatch' || v === 'dynamodb' || v === 'otel';

  const backends = Array.isArray(input.backends)
    ? input.backends.filter(isValidBackend)
    : undefined;

  return {
    backends,
    minLevel: input.minLevel,
    sampling,
  };
}

function normalizeTypes(input?: DeepPartial<ObservabilityConfig[ 'types' ]>): ObservabilityConfig[ 'types' ] {
  if (!input || !isRecord(input)) return undefined;
  const span = normalizeTypeSpecificConfig(input.span);
  const metric = normalizeTypeSpecificConfig(input.metric);
  const audit = normalizeTypeSpecificConfig(input.audit);
  const log = normalizeTypeSpecificConfig(input.log);
  if (!span && !metric && !audit && !log) return undefined;
  return { span, metric, audit, log };
}

function normalizeCloudWatch(input?: { namespace?: string }): ObservabilityConfig[ 'cloudwatch' ] {
  return { namespace: input?.namespace ?? CONFIG_DEFAULTS.cloudwatchNamespace };
}

function normalizeDynamoDb(input?: {
  tableKey?: string;
  ttlDays?: number;
  compression?: {
    enabled?: boolean;
    threshold?: number;
    fields?: Array<'data' | 'attributes' | 'metadata' | 'context'>;
  };
}): ObservabilityConfig[ 'dynamodb' ] {
  return {
    tableKey: input?.tableKey ?? CONFIG_DEFAULTS.tableKey,
    ttlDays: input?.ttlDays ?? CONFIG_DEFAULTS.ttlDays,
    compression: {
      enabled: input?.compression?.enabled ?? CONFIG_DEFAULTS.compression.enabled,
      threshold: input?.compression?.threshold ?? CONFIG_DEFAULTS.compression.threshold,
      fields: input?.compression?.fields ?? [ ...CONFIG_DEFAULTS.compression.fields ],
    },
  };
}

function normalizeDataProtection(input?: DeepPartial<ObservabilityDataProtectionConfig>): ObservabilityDataProtectionConfig {
  const blacklistedKeys = Array.isArray(input?.blacklistedKeys)
    ? input.blacklistedKeys.filter((k): k is string | RegExp => k !== undefined && k !== null)
    : DEFAULT_BLACKLISTED_KEYS;
  return {
    enabled: input?.enabled ?? true,
    blacklistedKeys,
    fuzzyKeyMatch: input?.fuzzyKeyMatch ?? true,
    caseSensitiveKeyMatch: input?.caseSensitiveKeyMatch ?? false,
    replacement: input?.replacement ?? '[REDACTED]',
    fields: input?.fields ?? [ 'data', 'attributes', 'metadata', 'context' ],
  };
}

function normalizeSpanConfig(input?: { minDurationMs?: number; skipEmpty?: boolean }): ObservabilityConfig[ 'spans' ] {
  return {
    minDurationMs: input?.minDurationMs ?? CONFIG_DEFAULTS.spans.minDurationMs,
    skipEmpty: input?.skipEmpty ?? CONFIG_DEFAULTS.spans.skipEmpty,
  };
}

function normalizeNoiseReduction(input?: DeepPartial<NoiseReductionConfig>): NoiseReductionConfig {
  const d = CONFIG_DEFAULTS.noiseReduction;
  const presets = Array.isArray(input?.presets)
    ? input.presets.filter((p): p is NoiseReductionConfig[ 'presets' ][ number ] => typeof p === 'string')
    : d.presets;

  const rules = Array.isArray(input?.rules)
    ? input.rules.filter((r): r is NoiseReductionConfig[ 'rules' ][ number ] => {
      return isRecord(r)
        && typeof r.id === 'string'
        && typeof r.decision === 'string'
        && isRecord(r.match);
    })
    : d.rules;

  return {
    enabled: input?.enabled ?? d.enabled,
    presets,
    rules,
    emitSummaries: input?.emitSummaries ?? d.emitSummaries,
    maxCheckpointsPerSpan: input?.maxCheckpointsPerSpan ?? d.maxCheckpointsPerSpan,
    maxAggregateKeysPerSpan: input?.maxAggregateKeysPerSpan ?? d.maxAggregateKeysPerSpan,
    maxAggregateExamplesPerKey: input?.maxAggregateExamplesPerKey ?? d.maxAggregateExamplesPerKey,
    maxAggregateErrorExamplesPerKey: input?.maxAggregateErrorExamplesPerKey ?? d.maxAggregateErrorExamplesPerKey,
    includeDebugMetadata: input?.includeDebugMetadata ?? d.includeDebugMetadata,
    includeExamples: input?.includeExamples ?? d.includeExamples,
  };
}

function normalizeOperationNormalization(
  input?: DeepPartial<ObservabilityConfig[ 'operationNormalization' ]>
): NonNullable<ObservabilityConfig[ 'operationNormalization' ]> {
  const rules = Array.isArray(input?.rules)
    ? input.rules.filter((r): r is ObservabilityConfig[ 'operationNormalization' ][ 'rules' ][ number ] => {
      return isRecord(r)
        && typeof r.id === 'string'
        && typeof r.match === 'string'
        && typeof r.replace === 'string';
    })
    : DEFAULT_OPERATION_NORMALIZATION_RULES;

  return {
    enabled: input?.enabled ?? CONFIG_DEFAULTS.operationNormalization.enabled,
    rules,
    storeOriginal: input?.storeOriginal ?? CONFIG_DEFAULTS.operationNormalization.storeOriginal,
  };
}

/**
 * Normalize backends input to full BackendConfig array
 */
function normalizeBackends(
  input?: Array<DeepPartial<ObservabilityBackendConfigInput> | undefined>
): ObservabilityBackendConfig[] {
  const list = (input ?? []).filter((b): b is DeepPartial<ObservabilityBackendConfigInput> => !!b);
  if (list.length === 0) {
    return [ { type: 'cloudwatch', enabled: true } ];
  }

  return list.map((b): ObservabilityBackendConfig => {
    if (!b.type) {
      throw new Error('Invalid observability backend config: missing `type`');
    }
    switch (b.type) {
      case 'cloudwatch':
        return {
          type: 'cloudwatch',
          enabled: b.enabled ?? true,
          minLevel: b.minLevel,
          config: b.config,
          types: b.types,
        };
      case 'dynamodb':
        return {
          type: 'dynamodb',
          enabled: b.enabled ?? true,
          minLevel: b.minLevel,
          config: b.config,
          types: b.types,
        };
      case 'otel':
        return {
          type: 'otel',
          enabled: b.enabled ?? true,
          minLevel: b.minLevel,
          config: b.config,
          types: b.types,
        };
    }
  });
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
