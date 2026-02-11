/**
 * Observability Configuration
 * 
 * Factory function for creating typed, validated observability config.
 */

import {
  ObservabilityConfig,
  ObservabilityLevel,
  ObservabilityBackendConfig,
  ObservabilityEvent,
  SamplingConfig,
  SamplingRule,
  DataProtectionConfig,
  TruncationConfig,
  DynamoDBConfig,
  NoiseReductionConfig,
  NoiseReductionPresetLevel,
  NoiseRule,
  HardSignalConfig,
  TypeSpecificConfig,
  QueryPerformanceConfig,
  OperationTimingConfig,
  EntityQueryTimingOverride,
  CloudWatchConfig,
  TagFilteringConfig,
  NamespaceStrategy,
  OperationMetricRule,
} from './types';
import { DEFAULT_BLACKLISTED_KEYS } from './utils/data-protection';
import type { DeepPartial } from '../utils/types';
import { merge } from '../utils/merge';

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
  queryPerformance: {
    enabled: true,
    slowThreshold: 30 * 1000, // 30 second
    fastQuerySampleRate: 0.01, // 1% of fast queries
    slowQuerySampleRate: 1.0, // 100% of slow queries
    captureSlowQueryDetails: true,
    trackCapacity: false,
    // Sensible operation-specific thresholds
    operationThresholds: [
      { operation: 'get', slowThreshold: 15 * 1000 },       // Single item - should be fast
      { operation: 'batchGet', slowThreshold: 30 * 1000 }, // Batch - bit slower OK
      { operation: 'list', slowThreshold: 20 * 1000 },     // List with index - 1s OK
      { operation: 'query', slowThreshold: 30 * 1000 },    // Query with index - 1s OK
      { operation: 'scan', slowThreshold: 60 * 1000 },     // Full scan - naturally slow
      { operation: 'create', slowThreshold: 15 * 1000 },    // Write - should be fast
      { operation: 'update', slowThreshold: 15 * 1000 },    // Write - should be fast
      { operation: 'upsert', slowThreshold: 15 * 1000 },    // Write - should be fast
      { operation: 'delete', slowThreshold: 15 * 1000 },    // Write - should be fast
      { operation: 'batchDelete', slowThreshold: 30 * 1000 }, // Batch write
    ],
  },
  operationNormalization: {
    enabled: true,
    storeOriginal: true,
  },
  // Noise reduction defaults (v2: three-decision model).
  noiseReduction: {
    enabled: false,
    hardSignals: {
      levels: [ 'error', 'critical' ],
      includeWarn: false,
      slowThresholdMs: 5000,
      slowThresholds: {
        'database.query': 100,
        'external.api': 10000,
        'batch.process': 30000,
      },
    },
    presets: [ 'fw24.hotpaths', 'fw24.batch_processors' ],
    rules: [],
    // Absorption bounds (prevent unbounded growth of absorbed data)
    maxAbsorbedErrorsPerSpan: 20,
    maxAbsorbedCausedByLinksPerSpan: 50,
    maxAbsorbedEntityIdsPerSpan: 100,
    maxAbsorbedOperationKeysPerSpan: 50,
    maxAbsorbedCheckpointsPerSpan: 100,
  } satisfies NoiseReductionConfig,
  // DynamoDB size management defaults
  truncation: {
    enabled: false,             // ❌ OFF by default - lossy, only as alternative
    maxBytes: 350 * 1024,       // 350KB if enabled
    fields: [ 'actor', 'data', 'attributes', 'metadata', 'context' ],
  } satisfies TruncationConfig,

  // DynamoDB operational limits
  dynamoMaxItemSize: 400 * 1024,    // 400KB - DynamoDB hard limit
  dynamoMaxBatchSize: 25,           // 25 - DynamoDB BatchWriteItem limit
  dynamoMaxBufferSize: 1000,        // 1000 - force flush safety

  // Phase 2: Tag filtering defaults (framework-level)
  tagFiltering: {
    include: [ 'stage', 'tenantId', 'operationCategory' ] as string[],  // Balanced
    maxTags: 10,
  },
  metricFiltering: {
    enabled: false,                  // Disabled by default (publish all)
    mode: 'whitelist' as const,
  },
  metricSampling: {
    enabled: false,                  // Disabled by default (no sampling)
    rate: 0.1,                       // 10% sample rate when enabled
    alwaysPublishOn: 'both' as const, // Always publish errors and slow requests
    thresholds: {
      slowDurationMs: 1000,          // > 1 second = slow
    },
  },
  // Phase 3: CloudWatch namespace defaults
  cloudwatchNamespaceStrategy: 'single' as const,
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
  cloudwatch?: Partial<CloudWatchConfig>;
  tagFiltering?: Partial<TagFilteringConfig>;
  dynamodb?: {
    /** Logical table key - resolved to actual table name via env var {tableKey}_table */
    tableKey?: string;
    ttlDays?: number;
    /** Truncation configuration (optional - lossy fallback) */
    truncation?: Partial<TruncationConfig>;
    /** Maximum item size in bytes (default: 400KB - DynamoDB limit) */
    maxItemSize?: number;
    /** Batch write size (default: 25 - DynamoDB BatchWriteItem limit) */
    maxBatchSize?: number;
    /** Maximum buffer size before forcing flush (default: 1000) */
    maxBufferSize?: number;
  };
  dataProtection?: Partial<DataProtectionConfig>;
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
    /** Tag spans slower than this (ms) with `_slow=true`. Disabled by default. */
    slowTagThresholdMs?: number;
  };

  /**
   * Query performance tracking configuration
   */
  queryPerformance?: Partial<QueryPerformanceConfig>;

  /**
   * Noise reduction configuration (emit/absorb/silent).
   * Set `noiseReduction.preset` to `'recommended'` or `'aggressive'` for sensible defaults.
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
 * Extend a preset with targeted overrides.
 * 
 * Uses framework's deep merge utility for clean config composition.
 * 
 * @param preset - Base preset configuration
 * @param overrides - Targeted overrides to apply
 * @returns Complete merged configuration
 * 
 * @example
 * ```typescript
 * import { extendPreset, productionPreset } from '@ten24group/fw24';
 * 
 * DIContainer.ROOT.registerConfigProvider({
 *   provide: 'observability',
 *   useConfig: extendPreset(productionPreset, {
 *     serviceName: 'my-app',
 *     cloudwatch: { namespace: 'MyApp' },
 *     dataProtection: {
 *       blacklistedKeys: ['apiKey'] // Merged with preset
 *     },
 *     sampling: { maxBufferSize: 5000 } // Merged with preset
 *   }),
 *   priority: 10
 * });
 * ```
 */
export function extendPreset(
  preset: ObservabilityConfig,
  overrides: DeepPartial<ObservabilityConfigInput>
): ObservabilityConfig {
  const merged = merge([ preset, overrides ])!;
  return createObservabilityConfig(merged);
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
export function createObservabilityConfig(input: DeepPartial<ObservabilityConfigInput> = {}): ObservabilityConfig {
  const serviceName = input.serviceName ?? CONFIG_DEFAULTS.serviceName;
  const minLevel = input.minLevel ?? CONFIG_DEFAULTS.minLevel;

  const config: ObservabilityConfig = {
    enabled: input.enabled ?? CONFIG_DEFAULTS.enabled,
    minLevel,
    serviceName,
    backends: normalizeBackends(input.backends),
    sampling: normalizeSampling(input.sampling),
    cloudwatch: normalizeCloudWatch(input.cloudwatch),
    dynamodb: normalizeDynamoDb(input.dynamodb),
    dataProtection: normalizeDataProtection(input.dataProtection),
    sourceMap: { enabled: input.sourceMap?.enabled ?? CONFIG_DEFAULTS.sourceMapEnabled },
    types: normalizeTypes(input.types),
    spans: normalizeSpanConfig(input.spans),
    tagFiltering: normalizeTagFiltering(input.tagFiltering),
    queryPerformance: normalizeQueryPerformanceConfig(input.queryPerformance),
    // Centralized defaults: noiseReduction is always present (enabled can be toggled per preset/app).
    noiseReduction: normalizeNoiseReduction(input.noiseReduction, minLevel),
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

function normalizeCloudWatch(input?: DeepPartial<ObservabilityConfigInput>[ 'cloudwatch' ]): ObservabilityConfig[ 'cloudwatch' ] {
  const namespaceStrategy = input?.namespaceStrategy as NamespaceStrategy | undefined;
  const operationRules = input?.metricFiltering?.operationRules as OperationMetricRule[] | undefined;

  return {
    namespace: input?.namespace ?? CONFIG_DEFAULTS.cloudwatchNamespace,
    namespaceStrategy: namespaceStrategy ?? CONFIG_DEFAULTS.cloudwatchNamespaceStrategy,
    metricFiltering: {
      enabled: input?.metricFiltering?.enabled ?? CONFIG_DEFAULTS.metricFiltering.enabled,
      mode: input?.metricFiltering?.mode ?? CONFIG_DEFAULTS.metricFiltering.mode,
      whitelist: input?.metricFiltering?.whitelist,
      blacklist: input?.metricFiltering?.blacklist,
      patterns: input?.metricFiltering?.patterns,
      operationRules,
    },
    metricSampling: {
      enabled: input?.metricSampling?.enabled ?? CONFIG_DEFAULTS.metricSampling.enabled,
      rate: input?.metricSampling?.rate ?? CONFIG_DEFAULTS.metricSampling.rate,
      alwaysPublishOn: input?.metricSampling?.alwaysPublishOn ?? CONFIG_DEFAULTS.metricSampling.alwaysPublishOn,
      thresholds: {
        slowDurationMs: input?.metricSampling?.thresholds?.slowDurationMs ?? CONFIG_DEFAULTS.metricSampling.thresholds.slowDurationMs,
      },
      neverSample: input?.metricSampling?.neverSample,
      alwaysSample: input?.metricSampling?.alwaysSample,
    },
  };
}

function normalizeTagFiltering(input?: DeepPartial<ObservabilityConfigInput>[ 'tagFiltering' ]): TagFilteringConfig {
  const customTags = input?.custom as Record<string, (event: ObservabilityEvent) => string> | undefined;

  return {
    include: input?.include ?? CONFIG_DEFAULTS.tagFiltering.include,
    custom: customTags,
    maxTags: input?.maxTags ?? CONFIG_DEFAULTS.tagFiltering.maxTags,
  };
}


function normalizeDynamoDb(input?: ObservabilityConfigInput[ 'dynamodb' ]): DynamoDBConfig {
  return {
    tableKey: input?.tableKey ?? CONFIG_DEFAULTS.tableKey,
    ttlDays: input?.ttlDays ?? CONFIG_DEFAULTS.ttlDays,
    truncation: {
      enabled: input?.truncation?.enabled ?? CONFIG_DEFAULTS.truncation.enabled,
      maxBytes: input?.truncation?.maxBytes ?? CONFIG_DEFAULTS.truncation.maxBytes,
      fields: input?.truncation?.fields ?? [ ...CONFIG_DEFAULTS.truncation.fields ],
    },
    maxItemSize: input?.maxItemSize ?? CONFIG_DEFAULTS.dynamoMaxItemSize,
    maxBatchSize: input?.maxBatchSize ?? CONFIG_DEFAULTS.dynamoMaxBatchSize,
    maxBufferSize: input?.maxBufferSize ?? CONFIG_DEFAULTS.dynamoMaxBufferSize,
  };
}

function normalizeDataProtection(input?: DeepPartial<DataProtectionConfig>): DataProtectionConfig {
  const blacklistedKeys = Array.isArray(input?.blacklistedKeys)
    ? input.blacklistedKeys.filter((k: unknown): k is string | RegExp => k !== undefined && k !== null)
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

/**
 * Aggressive preset overrides — tighter absorption bounds and lower slow thresholds.
 */
const AGGRESSIVE_NOISE_OVERRIDES = {
  maxAbsorbedErrorsPerSpan: 10,
  maxAbsorbedCausedByLinksPerSpan: 25,
  maxAbsorbedEntityIdsPerSpan: 50,
  maxAbsorbedOperationKeysPerSpan: 25,
  maxAbsorbedCheckpointsPerSpan: 50,
  hardSignals: {
    slowThresholdMs: 2000,
  },
} as const;

function normalizeNoiseReduction(
  input?: DeepPartial<NoiseReductionConfig>,
  _globalMinLevel?: ObservabilityLevel,
): NoiseReductionConfig {
  const d = CONFIG_DEFAULTS.noiseReduction;

  // Resolve preset level — explicit `enabled` overrides preset
  const presetLevel = input?.preset as NoiseReductionPresetLevel | undefined;
  const isEnabled = input?.enabled ?? (presetLevel === 'recommended' || presetLevel === 'aggressive' ? true : d.enabled);
  const isAggressive = presetLevel === 'aggressive';

  const presets = Array.isArray(input?.presets)
    ? input.presets.filter((p): p is NoiseReductionConfig['presets'][number] => typeof p === 'string')
    : d.presets;

  const rules: NoiseRule[] = Array.isArray(input?.rules)
    ? (input.rules.filter(r => {
      return isRecord(r)
        && typeof r.id === 'string'
        && typeof r.decision === 'string'
        && isRecord(r.match);
    }) as NoiseRule[])
    : [...d.rules];

  // Normalize hardSignals to ensure slowThresholds has no undefined values
  const hardSignalInput = input?.hardSignals;
  const aggressiveHS = isAggressive ? AGGRESSIVE_NOISE_OVERRIDES.hardSignals : undefined;
  const hardSignals: HardSignalConfig | undefined = hardSignalInput ? {
    levels: hardSignalInput.levels,
    includeWarn: hardSignalInput.includeWarn,
    slowThresholdMs: hardSignalInput.slowThresholdMs ?? aggressiveHS?.slowThresholdMs,
    slowThresholds: hardSignalInput.slowThresholds
      ? Object.fromEntries(
        Object.entries(hardSignalInput.slowThresholds).filter(([_, v]) => v !== undefined),
      ) as Record<string, number>
      : undefined,
  } : {
    ...d.hardSignals,
    ...(aggressiveHS ? { slowThresholdMs: aggressiveHS.slowThresholdMs } : {}),
  };

  const aggressiveBounds = isAggressive ? AGGRESSIVE_NOISE_OVERRIDES : undefined;

  return {
    enabled: isEnabled,
    preset: presetLevel,
    hardSignals,
    presets,
    rules,
    maxAbsorbedErrorsPerSpan: input?.maxAbsorbedErrorsPerSpan ?? aggressiveBounds?.maxAbsorbedErrorsPerSpan ?? d.maxAbsorbedErrorsPerSpan,
    maxAbsorbedCausedByLinksPerSpan: input?.maxAbsorbedCausedByLinksPerSpan ?? aggressiveBounds?.maxAbsorbedCausedByLinksPerSpan ?? d.maxAbsorbedCausedByLinksPerSpan,
    maxAbsorbedEntityIdsPerSpan: input?.maxAbsorbedEntityIdsPerSpan ?? aggressiveBounds?.maxAbsorbedEntityIdsPerSpan ?? d.maxAbsorbedEntityIdsPerSpan,
    maxAbsorbedOperationKeysPerSpan: input?.maxAbsorbedOperationKeysPerSpan ?? aggressiveBounds?.maxAbsorbedOperationKeysPerSpan ?? d.maxAbsorbedOperationKeysPerSpan,
    maxAbsorbedCheckpointsPerSpan: input?.maxAbsorbedCheckpointsPerSpan ?? aggressiveBounds?.maxAbsorbedCheckpointsPerSpan ?? d.maxAbsorbedCheckpointsPerSpan,
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
 * Normalize query performance configuration
 */
function normalizeQueryPerformanceConfig(input?: DeepPartial<QueryPerformanceConfig>): QueryPerformanceConfig {
  const d = CONFIG_DEFAULTS.queryPerformance;

  // Cast readonly default to mutable or use input
  const operationThresholds = (input?.operationThresholds
    ? input.operationThresholds.filter((t): t is OperationTimingConfig => !!t && !!t.operation && typeof t.slowThreshold === 'number')
    : d.operationThresholds) as OperationTimingConfig[];

  return {
    enabled: input?.enabled ?? d.enabled,
    slowThreshold: input?.slowThreshold ?? d.slowThreshold,
    fastQuerySampleRate: input?.fastQuerySampleRate ?? d.fastQuerySampleRate,
    slowQuerySampleRate: input?.slowQuerySampleRate ?? d.slowQuerySampleRate,
    operationThresholds,
    entityOverrides: input?.entityOverrides as EntityQueryTimingOverride[] | undefined,
    excludeEntities: input?.excludeEntities as string[] | undefined,
    alwaysTrackEntities: input?.alwaysTrackEntities as string[] | undefined,
    captureSlowQueryDetails: input?.captureSlowQueryDetails ?? d.captureSlowQueryDetails,
    trackCapacity: input?.trackCapacity ?? d.trackCapacity,
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
