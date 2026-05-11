"use strict";
/**
 * Observability Configuration
 *
 * Factory function for creating typed, validated observability config.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_OPERATION_NORMALIZATION_RULES = exports.CONFIG_DEFAULTS = exports.VALID_BACKENDS = void 0;
exports.extendPreset = extendPreset;
exports.createObservabilityConfig = createObservabilityConfig;
exports.validateConfig = validateConfig;
const types_1 = require("./types");
const data_protection_1 = require("./utils/data-protection");
const merge_1 = require("../utils/merge");
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Valid backend types
 */
exports.VALID_BACKENDS = ['cloudwatch', 'dynamodb', 'otel', 'logtrail'];
/**
 * Centralized configuration defaults
 */
exports.CONFIG_DEFAULTS = {
    serviceName: 'fw24-service',
    cloudwatchNamespace: 'FW24',
    // tableKey is the logical table name used to derive env var key
    // Env var: {tableKey}_table = actual CDK table name
    tableKey: 'observabilitylogs',
    ttlDays: 90,
    minLevel: types_1.ObservabilityLevel.INFO,
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
            { operation: 'get', slowThreshold: 15 * 1000 }, // Single item - should be fast
            { operation: 'batchGet', slowThreshold: 30 * 1000 }, // Batch - bit slower OK
            { operation: 'list', slowThreshold: 20 * 1000 }, // List with index - 1s OK
            { operation: 'query', slowThreshold: 30 * 1000 }, // Query with index - 1s OK
            { operation: 'scan', slowThreshold: 60 * 1000 }, // Full scan - naturally slow
            { operation: 'create', slowThreshold: 15 * 1000 }, // Write - should be fast
            { operation: 'update', slowThreshold: 15 * 1000 }, // Write - should be fast
            { operation: 'upsert', slowThreshold: 15 * 1000 }, // Write - should be fast
            { operation: 'delete', slowThreshold: 15 * 1000 }, // Write - should be fast
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
            levels: ['error', 'critical'],
            includeWarn: false,
            slowThresholdMs: 5000,
            slowThresholds: {
                'database.query': 100,
                'external.api': 10000,
                'batch.process': 30000,
            },
        },
        presets: ['fw24.hotpaths', 'fw24.batch_processors'],
        rules: [],
        // Absorption bounds (prevent unbounded growth of absorbed data)
        maxAbsorbedErrorsPerSpan: 20,
        maxAbsorbedCausedByLinksPerSpan: 50,
        maxAbsorbedEntityIdsPerSpan: 100,
        maxAbsorbedOperationKeysPerSpan: 50,
        maxAbsorbedCheckpointsPerSpan: 100,
    },
    // DynamoDB size management defaults
    truncation: {
        enabled: false, // ❌ OFF by default - lossy, only as alternative
        maxBytes: 350 * 1024, // 350KB if enabled
        fields: ['actor', 'data', 'attributes', 'metadata', 'context'],
    },
    // DynamoDB operational limits
    dynamoMaxItemSize: 400 * 1024, // 400KB - DynamoDB hard limit
    dynamoMaxBatchSize: 25, // 25 - DynamoDB BatchWriteItem limit
    dynamoMaxBufferSize: 1000, // 1000 - force flush safety
    // Phase 2: Tag filtering defaults (framework-level)
    tagFiltering: {
        include: ['stage', 'tenantId', 'operationCategory'], // Balanced
        maxTags: 10,
    },
    metricFiltering: {
        enabled: false, // Disabled by default (publish all)
        mode: 'whitelist',
    },
    metricSampling: {
        enabled: false, // Disabled by default (no sampling)
        rate: 0.1, // 10% sample rate when enabled
        alwaysPublishOn: 'both', // Always publish errors and slow requests
        thresholds: {
            slowDurationMs: 1000, // > 1 second = slow
        },
    },
    // Phase 3: CloudWatch namespace defaults
    cloudwatchNamespaceStrategy: 'single',
};
exports.DEFAULT_OPERATION_NORMALIZATION_RULES = [
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
function extendPreset(preset, overrides) {
    const merged = (0, merge_1.merge)([preset, overrides]);
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
function createObservabilityConfig(input = {}) {
    const serviceName = input.serviceName ?? exports.CONFIG_DEFAULTS.serviceName;
    const minLevel = input.minLevel ?? exports.CONFIG_DEFAULTS.minLevel;
    const config = {
        enabled: input.enabled ?? exports.CONFIG_DEFAULTS.enabled,
        minLevel,
        serviceName,
        backends: normalizeBackends(input.backends),
        sampling: normalizeSampling(input.sampling),
        cloudwatch: normalizeCloudWatch(input.cloudwatch),
        dynamodb: normalizeDynamoDb(input.dynamodb),
        dataProtection: normalizeDataProtection(input.dataProtection),
        sourceMap: { enabled: input.sourceMap?.enabled ?? exports.CONFIG_DEFAULTS.sourceMapEnabled },
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
function normalizeSampling(input) {
    const operationsIn = input?.operations;
    const operations = isRecord(operationsIn)
        ? (() => {
            const out = {};
            for (const [k, v] of Object.entries(operationsIn)) {
                if (typeof v === 'number')
                    out[k] = v;
            }
            return out;
        })()
        : undefined;
    const ratesIn = input?.rates;
    const rates = isRecord(ratesIn)
        ? (() => {
            const out = {};
            for (const [k, v] of Object.entries(ratesIn)) {
                if (typeof v === 'number')
                    out[k] = v;
            }
            return out;
        })()
        : undefined;
    const isSamplingTarget = (v) => v === 'source' || v === 'tenant' || v === 'route' || v === 'tag' || v === 'actor';
    const isSamplingRule = (v) => {
        if (!isRecord(v))
            return false;
        if (!isSamplingTarget(v.target))
            return false;
        if (!(typeof v.pattern === 'string' || v.pattern instanceof RegExp))
            return false;
        if (typeof v.rate !== 'number')
            return false;
        return true;
    };
    const rules = Array.isArray(input?.rules)
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
function normalizeTypeSpecificConfig(input) {
    if (!input)
        return undefined;
    if (!isRecord(input))
        return undefined;
    const samplingIn = input.sampling;
    let sampling;
    if (samplingIn !== undefined) {
        if (!isRecord(samplingIn)) {
            throw new Error('Invalid observability.types.*.sampling: must be an object');
        }
        if (typeof samplingIn.enabled !== 'boolean' || typeof samplingIn.rate !== 'number') {
            throw new Error('Invalid observability.types.*.sampling: requires { enabled: boolean, rate: number }');
        }
        sampling = { enabled: samplingIn.enabled, rate: samplingIn.rate };
    }
    const isValidBackend = (v) => v === 'cloudwatch' || v === 'dynamodb' || v === 'otel' || v === 'logtrail';
    const backends = Array.isArray(input.backends)
        ? input.backends.filter(isValidBackend)
        : undefined;
    return {
        backends,
        minLevel: input.minLevel,
        sampling,
    };
}
function normalizeTypes(input) {
    if (!input || !isRecord(input))
        return undefined;
    const span = normalizeTypeSpecificConfig(input.span);
    const metric = normalizeTypeSpecificConfig(input.metric);
    const audit = normalizeTypeSpecificConfig(input.audit);
    const log = normalizeTypeSpecificConfig(input.log);
    if (!span && !metric && !audit && !log)
        return undefined;
    return { span, metric, audit, log };
}
function normalizeCloudWatch(input) {
    const namespaceStrategy = input?.namespaceStrategy;
    const operationRules = input?.metricFiltering?.operationRules;
    return {
        namespace: input?.namespace ?? exports.CONFIG_DEFAULTS.cloudwatchNamespace,
        namespaceStrategy: namespaceStrategy ?? exports.CONFIG_DEFAULTS.cloudwatchNamespaceStrategy,
        metricFiltering: {
            enabled: input?.metricFiltering?.enabled ?? exports.CONFIG_DEFAULTS.metricFiltering.enabled,
            mode: input?.metricFiltering?.mode ?? exports.CONFIG_DEFAULTS.metricFiltering.mode,
            whitelist: input?.metricFiltering?.whitelist,
            blacklist: input?.metricFiltering?.blacklist,
            patterns: input?.metricFiltering?.patterns,
            operationRules,
        },
        metricSampling: {
            enabled: input?.metricSampling?.enabled ?? exports.CONFIG_DEFAULTS.metricSampling.enabled,
            rate: input?.metricSampling?.rate ?? exports.CONFIG_DEFAULTS.metricSampling.rate,
            alwaysPublishOn: input?.metricSampling?.alwaysPublishOn ?? exports.CONFIG_DEFAULTS.metricSampling.alwaysPublishOn,
            thresholds: {
                slowDurationMs: input?.metricSampling?.thresholds?.slowDurationMs ?? exports.CONFIG_DEFAULTS.metricSampling.thresholds.slowDurationMs,
            },
            neverSample: input?.metricSampling?.neverSample,
            alwaysSample: input?.metricSampling?.alwaysSample,
        },
    };
}
function normalizeTagFiltering(input) {
    const customTags = input?.custom;
    return {
        include: input?.include ?? exports.CONFIG_DEFAULTS.tagFiltering.include,
        custom: customTags,
        maxTags: input?.maxTags ?? exports.CONFIG_DEFAULTS.tagFiltering.maxTags,
    };
}
function normalizeDynamoDb(input) {
    return {
        tableKey: input?.tableKey ?? exports.CONFIG_DEFAULTS.tableKey,
        ttlDays: input?.ttlDays ?? exports.CONFIG_DEFAULTS.ttlDays,
        truncation: {
            enabled: input?.truncation?.enabled ?? exports.CONFIG_DEFAULTS.truncation.enabled,
            maxBytes: input?.truncation?.maxBytes ?? exports.CONFIG_DEFAULTS.truncation.maxBytes,
            fields: input?.truncation?.fields ?? [...exports.CONFIG_DEFAULTS.truncation.fields],
        },
        maxItemSize: input?.maxItemSize ?? exports.CONFIG_DEFAULTS.dynamoMaxItemSize,
        maxBatchSize: input?.maxBatchSize ?? exports.CONFIG_DEFAULTS.dynamoMaxBatchSize,
        maxBufferSize: input?.maxBufferSize ?? exports.CONFIG_DEFAULTS.dynamoMaxBufferSize,
    };
}
function normalizeDataProtection(input) {
    const blacklistedKeys = Array.isArray(input?.blacklistedKeys)
        ? input.blacklistedKeys.filter((k) => k !== undefined && k !== null)
        : data_protection_1.DEFAULT_BLACKLISTED_KEYS;
    return {
        enabled: input?.enabled ?? true,
        blacklistedKeys,
        fuzzyKeyMatch: input?.fuzzyKeyMatch ?? true,
        caseSensitiveKeyMatch: input?.caseSensitiveKeyMatch ?? false,
        replacement: input?.replacement ?? '[REDACTED]',
        fields: input?.fields ?? ['data', 'attributes', 'metadata', 'context'],
    };
}
function normalizeSpanConfig(input) {
    return {
        minDurationMs: input?.minDurationMs ?? exports.CONFIG_DEFAULTS.spans.minDurationMs,
        skipEmpty: input?.skipEmpty ?? exports.CONFIG_DEFAULTS.spans.skipEmpty,
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
};
function normalizeNoiseReduction(input, _globalMinLevel) {
    const d = exports.CONFIG_DEFAULTS.noiseReduction;
    // Resolve preset level — explicit `enabled` overrides preset
    const presetLevel = input?.preset;
    const isEnabled = input?.enabled ?? (presetLevel === 'recommended' || presetLevel === 'aggressive' ? true : d.enabled);
    const isAggressive = presetLevel === 'aggressive';
    const presets = Array.isArray(input?.presets)
        ? input.presets.filter((p) => typeof p === 'string')
        : d.presets;
    const rules = Array.isArray(input?.rules)
        ? input.rules.filter(r => {
            return isRecord(r)
                && typeof r.id === 'string'
                && typeof r.decision === 'string'
                && isRecord(r.match);
        })
        : [...d.rules];
    // Normalize hardSignals to ensure slowThresholds has no undefined values
    const hardSignalInput = input?.hardSignals;
    const aggressiveHS = isAggressive ? AGGRESSIVE_NOISE_OVERRIDES.hardSignals : undefined;
    const hardSignals = hardSignalInput ? {
        levels: hardSignalInput.levels,
        includeWarn: hardSignalInput.includeWarn,
        slowThresholdMs: hardSignalInput.slowThresholdMs ?? aggressiveHS?.slowThresholdMs,
        slowThresholds: hardSignalInput.slowThresholds
            ? Object.fromEntries(Object.entries(hardSignalInput.slowThresholds).filter(([_, v]) => v !== undefined))
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
function normalizeOperationNormalization(input) {
    const rules = Array.isArray(input?.rules)
        ? input.rules.filter((r) => {
            return isRecord(r)
                && typeof r.id === 'string'
                && typeof r.match === 'string'
                && typeof r.replace === 'string';
        })
        : exports.DEFAULT_OPERATION_NORMALIZATION_RULES;
    return {
        enabled: input?.enabled ?? exports.CONFIG_DEFAULTS.operationNormalization.enabled,
        rules,
        storeOriginal: input?.storeOriginal ?? exports.CONFIG_DEFAULTS.operationNormalization.storeOriginal,
    };
}
/**
 * Normalize query performance configuration
 */
function normalizeQueryPerformanceConfig(input) {
    const d = exports.CONFIG_DEFAULTS.queryPerformance;
    // Cast readonly default to mutable or use input
    const operationThresholds = (input?.operationThresholds
        ? input.operationThresholds.filter((t) => !!t && !!t.operation && typeof t.slowThreshold === 'number')
        : d.operationThresholds);
    return {
        enabled: input?.enabled ?? d.enabled,
        slowThreshold: input?.slowThreshold ?? d.slowThreshold,
        fastQuerySampleRate: input?.fastQuerySampleRate ?? d.fastQuerySampleRate,
        slowQuerySampleRate: input?.slowQuerySampleRate ?? d.slowQuerySampleRate,
        operationThresholds,
        entityOverrides: input?.entityOverrides,
        excludeEntities: input?.excludeEntities,
        alwaysTrackEntities: input?.alwaysTrackEntities,
        captureSlowQueryDetails: input?.captureSlowQueryDetails ?? d.captureSlowQueryDetails,
        trackCapacity: input?.trackCapacity ?? d.trackCapacity,
    };
}
/**
 * Normalize backends input to full BackendConfig array
 */
function normalizeBackends(input) {
    const list = (input ?? []).filter((b) => !!b);
    if (list.length === 0) {
        return [{ type: 'cloudwatch', enabled: true }];
    }
    return list.map((b) => {
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
            case 'logtrail':
                return {
                    type: 'logtrail',
                    enabled: b.enabled ?? true,
                    minLevel: b.minLevel,
                    config: b.config,
                    types: b.types,
                };
            default: {
                const t = b.type;
                throw new Error(`Invalid observability backend type: ${String(t)}`);
            }
        }
    });
}
/**
 * Validate observability configuration
 * Returns array of validation errors (empty if valid)
 */
function validateConfig(config) {
    const errors = [];
    // Validate minLevel
    const validLevels = Object.values(types_1.ObservabilityLevel).filter((v) => typeof v === 'number');
    if (!validLevels.includes(config.minLevel)) {
        errors.push(`Invalid minLevel: ${config.minLevel}`);
    }
    // Validate sampling rates
    if (config.sampling?.enabled && config.sampling.rates) {
        Object.entries(config.sampling.rates).forEach(([level, rate]) => {
            if (typeof rate !== 'number' || rate < 0 || rate > 1) {
                errors.push(`Invalid sampling rate for ${level}: ${rate}. Must be between 0 and 1.`);
            }
        });
    }
    // Validate backend types
    config.backends?.forEach((backend, index) => {
        if (!exports.VALID_BACKENDS.includes(backend.type)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUFnUUgsb0NBTUM7QUEwQkQsOERBOEJDO0FBc1ZELHdDQThDQztBQWhzQkQsbUNBc0JpQjtBQUNqQiw2REFBbUU7QUFFbkUsMENBQXVDO0FBRXZDLFNBQVMsUUFBUSxDQUFDLEtBQWM7SUFDOUIsT0FBTyxDQUFDLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDdkUsQ0FBQztBQUVEOztHQUVHO0FBQ1UsUUFBQSxjQUFjLEdBQUcsQ0FBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxVQUFVLENBQVcsQ0FBQztBQUd4Rjs7R0FFRztBQUNVLFFBQUEsZUFBZSxHQUFHO0lBQzdCLFdBQVcsRUFBRSxjQUFjO0lBQzNCLG1CQUFtQixFQUFFLE1BQU07SUFDM0IsZ0VBQWdFO0lBQ2hFLG9EQUFvRDtJQUNwRCxRQUFRLEVBQUUsbUJBQW1CO0lBQzdCLE9BQU8sRUFBRSxFQUFFO0lBQ1gsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUk7SUFDakMsT0FBTyxFQUFFLEtBQUs7SUFDZCxnQkFBZ0IsRUFBRSxLQUFLO0lBQ3ZCLEtBQUssRUFBRTtRQUNMLGFBQWEsRUFBRSxFQUFFO1FBQ2pCLFNBQVMsRUFBRSxJQUFJO0tBQ2hCO0lBQ0QsZ0JBQWdCLEVBQUU7UUFDaEIsT0FBTyxFQUFFLElBQUk7UUFDYixhQUFhLEVBQUUsRUFBRSxHQUFHLElBQUksRUFBRSxZQUFZO1FBQ3RDLG1CQUFtQixFQUFFLElBQUksRUFBRSxxQkFBcUI7UUFDaEQsbUJBQW1CLEVBQUUsR0FBRyxFQUFFLHVCQUF1QjtRQUNqRCx1QkFBdUIsRUFBRSxJQUFJO1FBQzdCLGFBQWEsRUFB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QyxXQUFXLElBQUksTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQztRQUM1RCxNQUFNLENBQUMsSUFBSSxDQUFDLDZDQUE2QyxDQUFDLENBQUM7SUFDN0QsQ0FBQztJQUVELGdDQUFnQztJQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxTQUFTLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7UUFDL0UsTUFBTSxDQUFDLElBQUksQ0FBQyxzREFBc0QsQ0FBQyxDQUFDO0lBQ3RFLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO1FBQ3pFLE1BQU0sQ0FBQyxJQUFJLENBQUMsbURBQW1ELENBQUMsQ0FBQztJQUNuRSxDQUFDO0lBRUQsNEJBQTRCO0lBQzVCLElBQUksTUFBTSxDQUFDLFFBQVEsSUFBSSxDQUFDLE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDcEcsTUFBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLDhCQUE4QixDQUFDLENBQUM7SUFDbEcsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgQ29uZmlndXJhdGlvblxuICogXG4gKiBGYWN0b3J5IGZ1bmN0aW9uIGZvciBjcmVhdGluZyB0eXBlZCwgdmFsaWRhdGVkIG9ic2VydmFiaWxpdHkgY29uZmlnLlxuICovXG5cbmltcG9ydCB7XG4gIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWcsXG4gIE9ic2VydmFiaWxpdHlFdmVudCxcbiAgU2FtcGxpbmdDb25maWcsXG4gIFNhbXBsaW5nUnVsZSxcbiAgRGF0YVByb3RlY3Rpb25Db25maWcsXG4gIFRydW5jYXRpb25Db25maWcsXG4gIER5bmFtb0RCQ29uZmlnLFxuICBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbiAgTm9pc2VSZWR1Y3Rpb25QcmVzZXRMZXZlbCxcbiAgTm9pc2VSdWxlLFxuICBIYXJkU2lnbmFsQ29uZmlnLFxuICBUeXBlU3BlY2lmaWNDb25maWcsXG4gIFF1ZXJ5UGVyZm9ybWFuY2VDb25maWcsXG4gIE9wZXJhdGlvblRpbWluZ0NvbmZpZyxcbiAgRW50aXR5UXVlcnlUaW1pbmdPdmVycmlkZSxcbiAgQ2xvdWRXYXRjaENvbmZpZyxcbiAgVGFnRmlsdGVyaW5nQ29uZmlnLFxuICBOYW1lc3BhY2VTdHJhdGVneSxcbiAgT3BlcmF0aW9uTWV0cmljUnVsZSxcbn0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVMgfSBmcm9tICcuL3V0aWxzL2RhdGEtcHJvdGVjdGlvbic7XG5pbXBvcnQgdHlwZSB7IERlZXBQYXJ0aWFsIH0gZnJvbSAnLi4vdXRpbHMvdHlwZXMnO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tICcuLi91dGlscy9tZXJnZSc7XG5cbmZ1bmN0aW9uIGlzUmVjb3JkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cblxuLyoqXG4gKiBWYWxpZCBiYWNrZW5kIHR5cGVzXG4gKi9cbmV4cG9ydCBjb25zdCBWQUxJRF9CQUNLRU5EUyA9IFsgJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInLCAnb3RlbCcsICdsb2d0cmFpbCcgXSBhcyBjb25zdDtcbmV4cG9ydCB0eXBlIFZhbGlkQmFja2VuZCA9IHR5cGVvZiBWQUxJRF9CQUNLRU5EU1sgbnVtYmVyIF07XG5cbi8qKlxuICogQ2VudHJhbGl6ZWQgY29uZmlndXJhdGlvbiBkZWZhdWx0c1xuICovXG5leHBvcnQgY29uc3QgQ09ORklHX0RFRkFVTFRTID0ge1xuICBzZXJ2aWNlTmFtZTogJ2Z3MjQtc2VydmljZScsXG4gIGNsb3Vkd2F0Y2hOYW1lc3BhY2U6ICdGVzI0JyxcbiAgLy8gdGFibGVLZXkgaXMgdGhlIGxvZ2ljYWwgdGFibGUgbmFtZSB1c2VkIHRvIGRlcml2ZSBlbnYgdmFyIGtleVxuICAvLyBFbnYgdmFyOiB7dGFibGVLZXl9X3RhYmxlID0gYWN0dWFsIENESyB0YWJsZSBuYW1lXG4gIHRhYmxlS2V5OiAnb2JzZXJ2YWJpbGl0eWxvZ3MnLFxuICB0dGxEYXlzOiA5MCxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICBlbmFibGVkOiBmYWxzZSxcbiAgc291cmNlTWFwRW5hYmxlZDogZmFsc2UsXG4gIHNwYW5zOiB7XG4gICAgbWluRHVyYXRpb25NczogNTAsXG4gICAgc2tpcEVtcHR5OiB0cnVlLFxuICB9LFxuICBxdWVyeVBlcmZvcm1hbmNlOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzbG93VGhyZXNob2xkOiAzMCAqIDEwMDAsIC8vIDMwIHNlY29uZFxuICAgIGZhc3RRdWVyeVNhbXBsZVJhdGU6IDAuMDEsIC8vIDElIG9mIGZhc3QgcXVlcmllc1xuICAgIHNsb3dRdWVyeVNhbXBsZVJhdGU6IDEuMCwgLy8gMTAwJSBvZiBzbG93IHF1ZXJpZXNcbiAgICBjYXB0dXJlU2xvd1F1ZXJ5RGV0YWlsczogdHJ1ZSxcbiAgICB0cmFja0NhcGFjaXR5OiBmYWxzZSxcbiAgICAvLyBTZW5zaWJsZSBvcGVyYXRpb24tc3BlY2lmaWMgdGhyZXNob2xkc1xuICAgIG9wZXJhdGlvblRocmVzaG9sZHM6IFtcbiAgICAgIHsgb3BlcmF0aW9uOiAnZ2V0Jywgc2xvd1RocmVzaG9sZDogMTUgKiAxMDAwIH0sICAgICAgIC8vIFNpbmdsZSBpdGVtIC0gc2hvdWxkIGJlIGZhc3RcbiAgICAgIHsgb3BlcmF0aW9uOiAnYmF0Y2hHZXQnLCBzbG93VGhyZXNob2xkOiAzMCAqIDEwMDAgfSwgLy8gQmF0Y2ggLSBiaXQgc2xvd2VyIE9LXG4gICAgICB7IG9wZXJhdGlvbjogJ2xpc3QnLCBzbG93VGhyZXNob2xkOiAyMCAqIDEwMDAgfSwgICAgIC8vIExpc3Qgd2l0aCBpbmRleCAtIDFzIE9LXG4gICAgICB7IG9wZXJhdGlvbjogJ3F1ZXJ5Jywgc2xvd1RocmVzaG9sZDogMzAgKiAxMDAwIH0sICAgIC8vIFF1ZXJ5IHdpdGggaW5kZXggLSAxcyBPS1xuICAgICAgeyBvcGVyYXRpb246ICdzY2FuJywgc2xvd1RocmVzaG9sZDogNjAgKiAxMDAwIH0sICAgICAvLyBGdWxsIHNjYW4gLSBuYXR1cmFsbHkgc2xvd1xuICAgICAgeyBvcGVyYXRpb246ICdjcmVhdGUnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICd1cGRhdGUnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICd1cHNlcnQnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICdkZWxldGUnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICdiYXRjaERlbGV0ZScsIHNsb3dUaHJlc2hvbGQ6IDMwICogMTAwMCB9LCAvLyBCYXRjaCB3cml0ZVxuICAgIF0sXG4gIH0sXG4gIG9wZXJhdGlvbk5vcm1hbGl6YXRpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHN0b3JlT3JpZ2luYWw6IHRydWUsXG4gIH0sXG4gIC8vIE5vaXNlIHJlZHVjdGlvbiBkZWZhdWx0cyAodjI6IHRocmVlLWRlY2lzaW9uIG1vZGVsKS5cbiAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICBlbmFibGVkOiBmYWxzZSxcbiAgICBoYXJkU2lnbmFsczoge1xuICAgICAgbGV2ZWxzOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSxcbiAgICAgIGluY2x1ZGVXYXJuOiBmYWxzZSxcbiAgICAgIHNsb3dUaHJlc2hvbGRNczogNTAwMCxcbiAgICAgIHNsb3dUaHJlc2hvbGRzOiB7XG4gICAgICAgICdkYXRhYmFzZS5xdWVyeSc6IDEwMCxcbiAgICAgICAgJ2V4dGVybmFsLmFwaSc6IDEwMDAwLFxuICAgICAgICAnYmF0Y2gucHJvY2Vzcyc6IDMwMDAwLFxuICAgICAgfSxcbiAgICB9LFxuICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnLCAnZncyNC5iYXRjaF9wcm9jZXNzb3JzJyBdLFxuICAgIHJ1bGVzOiBbXSxcbiAgICAvLyBBYnNvcnB0aW9uIGJvdW5kcyAocHJldmVudCB1bmJvdW5kZWQgZ3Jvd3RoIG9mIGFic29yYmVkIGRhdGEpXG4gICAgbWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuOiAyMCxcbiAgICBtYXhBYnNvcmJlZENhdXNlZEJ5TGlua3NQZXJTcGFuOiA1MCxcbiAgICBtYXhBYnNvcmJlZEVudGl0eUlkc1BlclNwYW46IDEwMCxcbiAgICBtYXhBYnNvcmJlZE9wZXJhdGlvbktleXNQZXJTcGFuOiA1MCxcbiAgICBtYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbjogMTAwLFxuICB9IHNhdGlzZmllcyBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbiAgLy8gRHluYW1vREIgc2l6ZSBtYW5hZ2VtZW50IGRlZmF1bHRzXG4gIHRydW5jYXRpb246IHtcbiAgICBlbmFibGVkOiBmYWxzZSwgICAgICAgICAgICAgLy8g4p2MIE9GRiBieSBkZWZhdWx0IC0gbG9zc3ksIG9ubHkgYXMgYWx0ZXJuYXRpdmVcbiAgICBtYXhCeXRlczogMzUwICogMTAyNCwgICAgICAgLy8gMzUwS0IgaWYgZW5hYmxlZFxuICAgIGZpZWxkczogWyAnYWN0b3InLCAnZGF0YScsICdhdHRyaWJ1dGVzJywgJ21ldGFkYXRhJywgJ2NvbnRleHQnIF0sXG4gIH0gc2F0aXNmaWVzIFRydW5jYXRpb25Db25maWcsXG5cbiAgLy8gRHluYW1vREIgb3BlcmF0aW9uYWwgbGltaXRzXG4gIGR5bmFtb01heEl0ZW1TaXplOiA0MDAgKiAxMDI0LCAgICAvLyA0MDBLQiAtIER5bmFtb0RCIGhhcmQgbGltaXRcbiAgZHluYW1vTWF4QmF0Y2hTaXplOiAyNSwgICAgICAgICAgIC8vIDI1IC0gRHluYW1vREIgQmF0Y2hXcml0ZUl0ZW0gbGltaXRcbiAgZHluYW1vTWF4QnVmZmVyU2l6ZTogMTAwMCwgICAgICAgIC8vIDEwMDAgLSBmb3JjZSBmbHVzaCBzYWZldHlcblxuICAvLyBQaGFzZSAyOiBUYWcgZmlsdGVyaW5nIGRlZmF1bHRzIChmcmFtZXdvcmstbGV2ZWwpXG4gIHRhZ0ZpbHRlcmluZzoge1xuICAgIGluY2x1ZGU6IFsgJ3N0YWdlJywgJ3RlbmFudElkJywgJ29wZXJhdGlvbkNhdGVnb3J5JyBdIGFzIHN0cmluZ1tdLCAgLy8gQmFsYW5jZWRcbiAgICBtYXhUYWdzOiAxMCxcbiAgfSxcbiAgbWV0cmljRmlsdGVyaW5nOiB7XG4gICAgZW5hYmxlZDogZmFsc2UsICAgICAgICAgICAgICAgICAgLy8gRGlzYWJsZWQgYnkgZGVmYXVsdCAocHVibGlzaCBhbGwpXG4gICAgbW9kZTogJ3doaXRlbGlzdCcgYXMgY29uc3QsXG4gIH0sXG4gIG1ldHJpY1NhbXBsaW5nOiB7XG4gICAgZW5hYmxlZDogZmFsc2UsICAgICAgICAgICAgICAgICAgLy8gRGlzYWJsZWQgYnkgZGVmYXVsdCAobm8gc2FtcGxpbmcpXG4gICAgcmF0ZTogMC4xLCAgICAgICAgICAgICAgICAgICAgICAgLy8gMTAlIHNhbXBsZSByYXRlIHdoZW4gZW5hYmxlZFxuICAgIGFsd2F5c1B1Ymxpc2hPbjogJ2JvdGgnIGFzIGNvbnN0LCAvLyBBbHdheXMgcHVibGlzaCBlcnJvcnMgYW5kIHNsb3cgcmVxdWVzdHNcbiAgICB0aHJlc2hvbGRzOiB7XG4gICAgICBzbG93RHVyYXRpb25NczogMTAwMCwgICAgICAgICAgLy8gPiAxIHNlY29uZCA9IHNsb3dcbiAgICB9LFxuICB9LFxuICAvLyBQaGFzZSAzOiBDbG91ZFdhdGNoIG5hbWVzcGFjZSBkZWZhdWx0c1xuICBjbG91ZHdhdGNoTmFtZXNwYWNlU3RyYXRlZ3k6ICdzaW5nbGUnIGFzIGNvbnN0LFxufSBhcyBjb25zdDtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfT1BFUkFUSU9OX05PUk1BTElaQVRJT05fUlVMRVM6IE5vbk51bGxhYmxlPE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdPlsgJ3J1bGVzJyBdID0gW1xuICB7XG4gICAgaWQ6ICdmdzI0Lmh0dHAudXVpZCcsXG4gICAgbWF0Y2g6ICcvXFxcXGJbMC05YS1mXXs4fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXsxMn1cXFxcYi9naScsXG4gICAgcmVwbGFjZTogJzp1dWlkJyxcbiAgICByZWFzb246ICdSZWR1Y2UgY2FyZGluYWxpdHkgYnkgbm9ybWFsaXppbmcgVVVJRHMgaW4gb3BlcmF0aW9uIG5hbWVzJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZncyNC5odHRwLmhleDE2JyxcbiAgICBtYXRjaDogJy9cXFxcYlswLTlhLWZdezE2fVxcXFxiL2dpJyxcbiAgICByZXBsYWNlOiAnOmlkJyxcbiAgICByZWFzb246ICdSZWR1Y2UgY2FyZGluYWxpdHkgYnkgbm9ybWFsaXppbmcgMTYtaGV4IElEcyBpbiBvcGVyYXRpb24gbmFtZXMnLFxuICB9LFxuICB7XG4gICAgaWQ6ICdmdzI0Lmh0dHAubnVtZXJpYycsXG4gICAgbWF0Y2g6ICcvXFxcXGJcXFxcZHs0LH1cXFxcYi9nJyxcbiAgICByZXBsYWNlOiAnOm4nLFxuICAgIHJlYXNvbjogJ1JlZHVjZSBjYXJkaW5hbGl0eSBieSBub3JtYWxpemluZyBsYXJnZSBudW1lcmljIElEcyBpbiBvcGVyYXRpb24gbmFtZXMnLFxuICB9LFxuXTtcblxuLyoqXG4gKiBJbnB1dCB0eXBlIGZvciBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIC0gYWxsIGZpZWxkcyBvcHRpb25hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmFiaWxpdHlDb25maWdJbnB1dCB7XG4gIGVuYWJsZWQ/OiBib29sZWFuO1xuICBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcbiAgc2VydmljZU5hbWU/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBCYWNrZW5kIGNvbmZpZ3MgKGlucHV0IGZvcm0pLlxuICAgKlxuICAgKiBBY2NlcHRzIGZ1bGwgYmFja2VuZCBjb25maWdzIChpbmNsdWRpbmcgYHR5cGVzYCBmaWx0ZXJzKSBidXQgYWxsb3dzIGBlbmFibGVkYCB0byBiZSBvbWl0dGVkLlxuICAgKiBUaGlzIGtlZXBzIHByZXNldHMgYW5kIGFwcCBjb25maWdzIGV4cHJlc3NpdmUgd2l0aG91dCBjYXN0aW5nLlxuICAgKi9cbiAgYmFja2VuZHM/OiBPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZ0lucHV0W107XG4gIHNhbXBsaW5nPzogUGFydGlhbDxTYW1wbGluZ0NvbmZpZz47XG4gIGNsb3Vkd2F0Y2g/OiBQYXJ0aWFsPENsb3VkV2F0Y2hDb25maWc+O1xuICB0YWdGaWx0ZXJpbmc/OiBQYXJ0aWFsPFRhZ0ZpbHRlcmluZ0NvbmZpZz47XG4gIGR5bmFtb2RiPzoge1xuICAgIC8qKiBMb2dpY2FsIHRhYmxlIGtleSAtIHJlc29sdmVkIHRvIGFjdHVhbCB0YWJsZSBuYW1lIHZpYSBlbnYgdmFyIHt0YWJsZUtleX1fdGFibGUgKi9cbiAgICB0YWJsZUtleT86IHN0cmluZztcbiAgICB0dGxEYXlzPzogbnVtYmVyO1xuICAgIC8qKiBUcnVuY2F0aW9uIGNvbmZpZ3VyYXRpb24gKG9wdGlvbmFsIC0gbG9zc3kgZmFsbGJhY2spICovXG4gICAgdHJ1bmNhdGlvbj86IFBhcnRpYWw8VHJ1bmNhdGlvbkNvbmZpZz47XG4gICAgLyoqIE1heGltdW0gaXRlbSBzaXplIGluIGJ5dGVzIChkZWZhdWx0OiA0MDBLQiAtIER5bmFtb0RCIGxpbWl0KSAqL1xuICAgIG1heEl0ZW1TaXplPzogbnVtYmVyO1xuICAgIC8qKiBCYXRjaCB3cml0ZSBzaXplIChkZWZhdWx0OiAyNSAtIER5bmFtb0RCIEJhdGNoV3JpdGVJdGVtIGxpbWl0KSAqL1xuICAgIG1heEJhdGNoU2l6ZT86IG51bWJlcjtcbiAgICAvKiogTWF4aW11bSBidWZmZXIgc2l6ZSBiZWZvcmUgZm9yY2luZyBmbHVzaCAoZGVmYXVsdDogMTAwMCkgKi9cbiAgICBtYXhCdWZmZXJTaXplPzogbnVtYmVyO1xuICB9O1xuICBkYXRhUHJvdGVjdGlvbj86IFBhcnRpYWw8RGF0YVByb3RlY3Rpb25Db25maWc+O1xuICB0eXBlcz86IE9ic2VydmFiaWxpdHlDb25maWdbICd0eXBlcycgXTtcbiAgc291cmNlTWFwPzoge1xuICAgIC8qKiBFbmFibGUgc291cmNlLW1hcC1zdXBwb3J0IGZvciBiZXR0ZXIgZXJyb3Igc3RhY2sgdHJhY2VzIChyZXF1aXJlcyBzb3VyY2UtbWFwLXN1cHBvcnQgcGFja2FnZSkgKi9cbiAgICBlbmFibGVkPzogYm9vbGVhbjtcbiAgfTtcbiAgLyoqXG4gICAqIFNwYW4tc3BlY2lmaWMgY29uZmlndXJhdGlvblxuICAgKi9cbiAgc3BhbnM/OiB7XG4gICAgLyoqIFNraXAgc3BhbnMgZmFzdGVyIHRoYW4gdGhpcyAobXMpLiBEZWZhdWx0OiA1MCAqL1xuICAgIG1pbkR1cmF0aW9uTXM/OiBudW1iZXI7XG4gICAgLyoqIFNraXAgc3BhbnMgd2l0aCBubyBldmVudHMvZXJyb3JzLiBEZWZhdWx0OiB0cnVlICovXG4gICAgc2tpcEVtcHR5PzogYm9vbGVhbjtcbiAgICAvKiogVGFnIHNwYW5zIHNsb3dlciB0aGFuIHRoaXMgKG1zKSB3aXRoIGBfc2xvdz10cnVlYC4gRGlzYWJsZWQgYnkgZGVmYXVsdC4gKi9cbiAgICBzbG93VGFnVGhyZXNob2xkTXM/OiBudW1iZXI7XG4gIH07XG5cbiAgLyoqXG4gICAqIFF1ZXJ5IHBlcmZvcm1hbmNlIHRyYWNraW5nIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHF1ZXJ5UGVyZm9ybWFuY2U/OiBQYXJ0aWFsPFF1ZXJ5UGVyZm9ybWFuY2VDb25maWc+O1xuXG4gIC8qKlxuICAgKiBOb2lzZSByZWR1Y3Rpb24gY29uZmlndXJhdGlvbiAoZW1pdC9hYnNvcmIvc2lsZW50KS5cbiAgICogU2V0IGBub2lzZVJlZHVjdGlvbi5wcmVzZXRgIHRvIGAncmVjb21tZW5kZWQnYCBvciBgJ2FnZ3Jlc3NpdmUnYCBmb3Igc2Vuc2libGUgZGVmYXVsdHMuXG4gICAqL1xuICBub2lzZVJlZHVjdGlvbj86IFBhcnRpYWw8Tm9pc2VSZWR1Y3Rpb25Db25maWc+O1xuXG4gIC8qKlxuICAgKiBPcGVyYXRpb24gbm9ybWFsaXphdGlvbiAvIHJlbmFtaW5nLlxuICAgKi9cbiAgb3BlcmF0aW9uTm9ybWFsaXphdGlvbj86IE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdO1xufVxuXG50eXBlIFdpdGhPcHRpb25hbEVuYWJsZWQ8VD4gPVxuICBUIGV4dGVuZHMgeyBlbmFibGVkOiBib29sZWFuIH1cbiAgPyAoT21pdDxULCAnZW5hYmxlZCc+ICYgeyBlbmFibGVkPzogYm9vbGVhbiB9KVxuICA6IFQ7XG5cbmV4cG9ydCB0eXBlIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnSW5wdXQgPSBXaXRoT3B0aW9uYWxFbmFibGVkPE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnPjtcblxuLyoqXG4gKiBFeHRlbmQgYSBwcmVzZXQgd2l0aCB0YXJnZXRlZCBvdmVycmlkZXMuXG4gKiBcbiAqIFVzZXMgZnJhbWV3b3JrJ3MgZGVlcCBtZXJnZSB1dGlsaXR5IGZvciBjbGVhbiBjb25maWcgY29tcG9zaXRpb24uXG4gKiBcbiAqIEBwYXJhbSBwcmVzZXQgLSBCYXNlIHByZXNldCBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gb3ZlcnJpZGVzIC0gVGFyZ2V0ZWQgb3ZlcnJpZGVzIHRvIGFwcGx5XG4gKiBAcmV0dXJucyBDb21wbGV0ZSBtZXJnZWQgY29uZmlndXJhdGlvblxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZXh0ZW5kUHJlc2V0LCBwcm9kdWN0aW9uUHJlc2V0IH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNCc7XG4gKiBcbiAqIERJQ29udGFpbmVyLlJPT1QucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gKiAgIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5JyxcbiAqICAgdXNlQ29uZmlnOiBleHRlbmRQcmVzZXQocHJvZHVjdGlvblByZXNldCwge1xuICogICAgIHNlcnZpY2VOYW1lOiAnbXktYXBwJyxcbiAqICAgICBjbG91ZHdhdGNoOiB7IG5hbWVzcGFjZTogJ015QXBwJyB9LFxuICogICAgIGRhdGFQcm90ZWN0aW9uOiB7XG4gKiAgICAgICBibGFja2xpc3RlZEtleXM6IFsnYXBpS2V5J10gLy8gTWVyZ2VkIHdpdGggcHJlc2V0XG4gKiAgICAgfSxcbiAqICAgICBzYW1wbGluZzogeyBtYXhCdWZmZXJTaXplOiA1MDAwIH0gLy8gTWVyZ2VkIHdpdGggcHJlc2V0XG4gKiAgIH0pLFxuICogICBwcmlvcml0eTogMTBcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRlbmRQcmVzZXQoXG4gIHByZXNldDogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgb3ZlcnJpZGVzOiBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQ+XG4pOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgY29uc3QgbWVyZ2VkID0gbWVyZ2UoWyBwcmVzZXQsIG92ZXJyaWRlcyBdKSE7XG4gIHJldHVybiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKG1lcmdlZCk7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgY29tcGxldGUsIHZhbGlkYXRlZCBPYnNlcnZhYmlsaXR5Q29uZmlnIGZyb20gcGFydGlhbCBpbnB1dFxuICogXG4gKiBAcGFyYW0gaW5wdXQgLSBQYXJ0aWFsIGNvbmZpZyBmcm9tIGFwcGxpY2F0aW9uXG4gKiBAcmV0dXJucyBDb21wbGV0ZSBPYnNlcnZhYmlsaXR5Q29uZmlnIHdpdGggZGVmYXVsdHMgbWVyZ2VkXG4gKiBAdGhyb3dzIEVycm9yIGlmIHZhbGlkYXRpb24gZmFpbHNcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEluIHlvdXIgYXBwJ3MgZGkudHM6XG4gKiBpbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQnO1xuICogaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQvb2JzZXJ2YWJpbGl0eSc7XG4gKiBcbiAqIERJQ29udGFpbmVyLlJPT1QucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gKiAgIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5JyxcbiAqICAgdXNlQ29uZmlnOiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAqICAgICBzZXJ2aWNlTmFtZTogJ215LWFwcCcsXG4gKiAgICAgYmFja2VuZHM6IFt7IHR5cGU6ICdjbG91ZHdhdGNoJyB9LCB7IHR5cGU6ICdkeW5hbW9kYicgfV0sXG4gKiAgICAgLy8gdGFibGVLZXkgZGVmYXVsdHMgdG8gJ29ic2VydmFiaWxpdHlsb2dzJ1xuICogICB9KSxcbiAqICAgcHJpb3JpdHk6IDEwXG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyhpbnB1dDogRGVlcFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0PiA9IHt9KTogT2JzZXJ2YWJpbGl0eUNvbmZpZyB7XG4gIGNvbnN0IHNlcnZpY2VOYW1lID0gaW5wdXQuc2VydmljZU5hbWUgPz8gQ09ORklHX0RFRkFVTFRTLnNlcnZpY2VOYW1lO1xuICBjb25zdCBtaW5MZXZlbCA9IGlucHV0Lm1pbkxldmVsID8/IENPTkZJR19ERUZBVUxUUy5taW5MZXZlbDtcblxuICBjb25zdCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgPSB7XG4gICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMuZW5hYmxlZCxcbiAgICBtaW5MZXZlbCxcbiAgICBzZXJ2aWNlTmFtZSxcbiAgICBiYWNrZW5kczogbm9ybWFsaXplQmFja2VuZHMoaW5wdXQuYmFja2VuZHMpLFxuICAgIHNhbXBsaW5nOiBub3JtYWxpemVTYW1wbGluZyhpbnB1dC5zYW1wbGluZyksXG4gICAgY2xvdWR3YXRjaDogbm9ybWFsaXplQ2xvdWRXYXRjaChpbnB1dC5jbG91ZHdhdGNoKSxcbiAgICBkeW5hbW9kYjogbm9ybWFsaXplRHluYW1vRGIoaW5wdXQuZHluYW1vZGIpLFxuICAgIGRhdGFQcm90ZWN0aW9uOiBub3JtYWxpemVEYXRhUHJvdGVjdGlvbihpbnB1dC5kYXRhUHJvdGVjdGlvbiksXG4gICAgc291cmNlTWFwOiB7IGVuYWJsZWQ6IGlucHV0LnNvdXJjZU1hcD8uZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMuc291cmNlTWFwRW5hYmxlZCB9LFxuICAgIHR5cGVzOiBub3JtYWxpemVUeXBlcyhpbnB1dC50eXBlcyksXG4gICAgc3BhbnM6IG5vcm1hbGl6ZVNwYW5Db25maWcoaW5wdXQuc3BhbnMpLFxuICAgIHRhZ0ZpbHRlcmluZzogbm9ybWFsaXplVGFnRmlsdGVyaW5nKGlucHV0LnRhZ0ZpbHRlcmluZyksXG4gICAgcXVlcnlQZXJmb3JtYW5jZTogbm9ybWFsaXplUXVlcnlQZXJmb3JtYW5jZUNvbmZpZyhpbnB1dC5xdWVyeVBlcmZvcm1hbmNlKSxcbiAgICAvLyBDZW50cmFsaXplZCBkZWZhdWx0czogbm9pc2VSZWR1Y3Rpb24gaXMgYWx3YXlzIHByZXNlbnQgKGVuYWJsZWQgY2FuIGJlIHRvZ2dsZWQgcGVyIHByZXNldC9hcHApLlxuICAgIG5vaXNlUmVkdWN0aW9uOiBub3JtYWxpemVOb2lzZVJlZHVjdGlvbihpbnB1dC5ub2lzZVJlZHVjdGlvbiwgbWluTGV2ZWwpLFxuICAgIG9wZXJhdGlvbk5vcm1hbGl6YXRpb246IG5vcm1hbGl6ZU9wZXJhdGlvbk5vcm1hbGl6YXRpb24oaW5wdXQub3BlcmF0aW9uTm9ybWFsaXphdGlvbiksXG4gIH07XG5cbiAgLy8gVmFsaWRhdGVcbiAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG9ic2VydmFiaWxpdHkgY29uZmlnOiAke2Vycm9ycy5qb2luKCcsICcpfWApO1xuICB9XG5cbiAgcmV0dXJuIGNvbmZpZztcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplU2FtcGxpbmcoaW5wdXQ/OiBEZWVwUGFydGlhbDxTYW1wbGluZ0NvbmZpZz4pOiBTYW1wbGluZ0NvbmZpZyB7XG4gIGNvbnN0IG9wZXJhdGlvbnNJbiA9IGlucHV0Py5vcGVyYXRpb25zO1xuICBjb25zdCBvcGVyYXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHwgdW5kZWZpbmVkID0gaXNSZWNvcmQob3BlcmF0aW9uc0luKVxuICAgID8gKCgpID0+IHtcbiAgICAgIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhvcGVyYXRpb25zSW4pKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIG91dFsgayBdID0gdjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvdXQ7XG4gICAgfSkoKVxuICAgIDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IHJhdGVzSW4gPSBpbnB1dD8ucmF0ZXM7XG4gIGNvbnN0IHJhdGVzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHwgdW5kZWZpbmVkID0gaXNSZWNvcmQocmF0ZXNJbilcbiAgICA/ICgoKSA9PiB7XG4gICAgICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMocmF0ZXNJbikpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgb3V0WyBrIF0gPSB2O1xuICAgICAgfVxuICAgICAgcmV0dXJuIG91dDtcbiAgICB9KSgpXG4gICAgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgaXNTYW1wbGluZ1RhcmdldCA9ICh2OiB1bmtub3duKTogdiBpcyBTYW1wbGluZ1J1bGVbICd0YXJnZXQnIF0gPT5cbiAgICB2ID09PSAnc291cmNlJyB8fCB2ID09PSAndGVuYW50JyB8fCB2ID09PSAncm91dGUnIHx8IHYgPT09ICd0YWcnIHx8IHYgPT09ICdhY3Rvcic7XG5cbiAgY29uc3QgaXNTYW1wbGluZ1J1bGUgPSAodjogdW5rbm93bik6IHYgaXMgU2FtcGxpbmdSdWxlID0+IHtcbiAgICBpZiAoIWlzUmVjb3JkKHYpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCFpc1NhbXBsaW5nVGFyZ2V0KHYudGFyZ2V0KSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghKHR5cGVvZiB2LnBhdHRlcm4gPT09ICdzdHJpbmcnIHx8IHYucGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cCkpIHJldHVybiBmYWxzZTtcbiAgICBpZiAodHlwZW9mIHYucmF0ZSAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICBjb25zdCBydWxlczogU2FtcGxpbmdSdWxlW10gfCB1bmRlZmluZWQgPSBBcnJheS5pc0FycmF5KGlucHV0Py5ydWxlcylcbiAgICA/IGlucHV0LnJ1bGVzLmZpbHRlcihpc1NhbXBsaW5nUnVsZSlcbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGlucHV0Py5lbmFibGVkID8/IGZhbHNlLFxuICAgIHNtYXJ0OiBpbnB1dD8uc21hcnQsXG4gICAgbWF4QnVmZmVyU2l6ZTogaW5wdXQ/Lm1heEJ1ZmZlclNpemUsXG4gICAgbWluTGV2ZWxPbkVycm9yOiBpbnB1dD8ubWluTGV2ZWxPbkVycm9yLFxuICAgIHJhdGVzLFxuICAgIG9wZXJhdGlvbnMsXG4gICAgcnVsZXMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVR5cGVTcGVjaWZpY0NvbmZpZyhpbnB1dD86IERlZXBQYXJ0aWFsPFR5cGVTcGVjaWZpY0NvbmZpZz4pOiBUeXBlU3BlY2lmaWNDb25maWcgfCB1bmRlZmluZWQge1xuICBpZiAoIWlucHV0KSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAoIWlzUmVjb3JkKGlucHV0KSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCBzYW1wbGluZ0luID0gaW5wdXQuc2FtcGxpbmc7XG4gIGxldCBzYW1wbGluZzogVHlwZVNwZWNpZmljQ29uZmlnWyAnc2FtcGxpbmcnIF0gfCB1bmRlZmluZWQ7XG4gIGlmIChzYW1wbGluZ0luICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoIWlzUmVjb3JkKHNhbXBsaW5nSW4pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgb2JzZXJ2YWJpbGl0eS50eXBlcy4qLnNhbXBsaW5nOiBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHNhbXBsaW5nSW4uZW5hYmxlZCAhPT0gJ2Jvb2xlYW4nIHx8IHR5cGVvZiBzYW1wbGluZ0luLnJhdGUgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgb2JzZXJ2YWJpbGl0eS50eXBlcy4qLnNhbXBsaW5nOiByZXF1aXJlcyB7IGVuYWJsZWQ6IGJvb2xlYW4sIHJhdGU6IG51bWJlciB9Jyk7XG4gICAgfVxuICAgIHNhbXBsaW5nID0geyBlbmFibGVkOiBzYW1wbGluZ0luLmVuYWJsZWQsIHJhdGU6IHNhbXBsaW5nSW4ucmF0ZSB9O1xuICB9XG5cbiAgdHlwZSBCYWNrZW5kTmFtZSA9ICdjbG91ZHdhdGNoJyB8ICdkeW5hbW9kYicgfCAnb3RlbCcgfCAnbG9ndHJhaWwnO1xuICBjb25zdCBpc1ZhbGlkQmFja2VuZCA9ICh2OiB1bmtub3duKTogdiBpcyBCYWNrZW5kTmFtZSA9PlxuICAgIHYgPT09ICdjbG91ZHdhdGNoJyB8fCB2ID09PSAnZHluYW1vZGInIHx8IHYgPT09ICdvdGVsJyB8fCB2ID09PSAnbG9ndHJhaWwnO1xuXG4gIGNvbnN0IGJhY2tlbmRzID0gQXJyYXkuaXNBcnJheShpbnB1dC5iYWNrZW5kcylcbiAgICA/IGlucHV0LmJhY2tlbmRzLmZpbHRlcihpc1ZhbGlkQmFja2VuZClcbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGJhY2tlbmRzLFxuICAgIG1pbkxldmVsOiBpbnB1dC5taW5MZXZlbCxcbiAgICBzYW1wbGluZyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVHlwZXMoaW5wdXQ/OiBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnWyAndHlwZXMnIF0+KTogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdIHtcbiAgaWYgKCFpbnB1dCB8fCAhaXNSZWNvcmQoaW5wdXQpKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBzcGFuID0gbm9ybWFsaXplVHlwZVNwZWNpZmljQ29uZmlnKGlucHV0LnNwYW4pO1xuICBjb25zdCBtZXRyaWMgPSBub3JtYWxpemVUeXBlU3BlY2lmaWNDb25maWcoaW5wdXQubWV0cmljKTtcbiAgY29uc3QgYXVkaXQgPSBub3JtYWxpemVUeXBlU3BlY2lmaWNDb25maWcoaW5wdXQuYXVkaXQpO1xuICBjb25zdCBsb2cgPSBub3JtYWxpemVUeXBlU3BlY2lmaWNDb25maWcoaW5wdXQubG9nKTtcbiAgaWYgKCFzcGFuICYmICFtZXRyaWMgJiYgIWF1ZGl0ICYmICFsb2cpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB7IHNwYW4sIG1ldHJpYywgYXVkaXQsIGxvZyB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVDbG91ZFdhdGNoKGlucHV0PzogRGVlcFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0PlsgJ2Nsb3Vkd2F0Y2gnIF0pOiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnY2xvdWR3YXRjaCcgXSB7XG4gIGNvbnN0IG5hbWVzcGFjZVN0cmF0ZWd5ID0gaW5wdXQ/Lm5hbWVzcGFjZVN0cmF0ZWd5IGFzIE5hbWVzcGFjZVN0cmF0ZWd5IHwgdW5kZWZpbmVkO1xuICBjb25zdCBvcGVyYXRpb25SdWxlcyA9IGlucHV0Py5tZXRyaWNGaWx0ZXJpbmc/Lm9wZXJhdGlvblJ1bGVzIGFzIE9wZXJhdGlvbk1ldHJpY1J1bGVbXSB8IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIG5hbWVzcGFjZTogaW5wdXQ/Lm5hbWVzcGFjZSA/PyBDT05GSUdfREVGQVVMVFMuY2xvdWR3YXRjaE5hbWVzcGFjZSxcbiAgICBuYW1lc3BhY2VTdHJhdGVneTogbmFtZXNwYWNlU3RyYXRlZ3kgPz8gQ09ORklHX0RFRkFVTFRTLmNsb3Vkd2F0Y2hOYW1lc3BhY2VTdHJhdGVneSxcbiAgICBtZXRyaWNGaWx0ZXJpbmc6IHtcbiAgICAgIGVuYWJsZWQ6IGlucHV0Py5tZXRyaWNGaWx0ZXJpbmc/LmVuYWJsZWQgPz8gQ09ORklHX0RFRkFVTFRTLm1ldHJpY0ZpbHRlcmluZy5lbmFibGVkLFxuICAgICAgbW9kZTogaW5wdXQ/Lm1ldHJpY0ZpbHRlcmluZz8ubW9kZSA/PyBDT05GSUdfREVGQVVMVFMubWV0cmljRmlsdGVyaW5nLm1vZGUsXG4gICAgICB3aGl0ZWxpc3Q6IGlucHV0Py5tZXRyaWNGaWx0ZXJpbmc/LndoaXRlbGlzdCxcbiAgICAgIGJsYWNrbGlzdDogaW5wdXQ/Lm1ldHJpY0ZpbHRlcmluZz8uYmxhY2tsaXN0LFxuICAgICAgcGF0dGVybnM6IGlucHV0Py5tZXRyaWNGaWx0ZXJpbmc/LnBhdHRlcm5zLFxuICAgICAgb3BlcmF0aW9uUnVsZXMsXG4gICAgfSxcbiAgICBtZXRyaWNTYW1wbGluZzoge1xuICAgICAgZW5hYmxlZDogaW5wdXQ/Lm1ldHJpY1NhbXBsaW5nPy5lbmFibGVkID8/IENPTkZJR19ERUZBVUxUUy5tZXRyaWNTYW1wbGluZy5lbmFibGVkLFxuICAgICAgcmF0ZTogaW5wdXQ/Lm1ldHJpY1NhbXBsaW5nPy5yYXRlID8/IENPTkZJR19ERUZBVUxUUy5tZXRyaWNTYW1wbGluZy5yYXRlLFxuICAgICAgYWx3YXlzUHVibGlzaE9uOiBpbnB1dD8ubWV0cmljU2FtcGxpbmc/LmFsd2F5c1B1Ymxpc2hPbiA/PyBDT05GSUdfREVGQVVMVFMubWV0cmljU2FtcGxpbmcuYWx3YXlzUHVibGlzaE9uLFxuICAgICAgdGhyZXNob2xkczoge1xuICAgICAgICBzbG93RHVyYXRpb25NczogaW5wdXQ/Lm1ldHJpY1NhbXBsaW5nPy50aHJlc2hvbGRzPy5zbG93RHVyYXRpb25NcyA/PyBDT05GSUdfREVGQVVMVFMubWV0cmljU2FtcGxpbmcudGhyZXNob2xkcy5zbG93RHVyYXRpb25NcyxcbiAgICAgIH0sXG4gICAgICBuZXZlclNhbXBsZTogaW5wdXQ/Lm1ldHJpY1NhbXBsaW5nPy5uZXZlclNhbXBsZSxcbiAgICAgIGFsd2F5c1NhbXBsZTogaW5wdXQ/Lm1ldHJpY1NhbXBsaW5nPy5hbHdheXNTYW1wbGUsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVGFnRmlsdGVyaW5nKGlucHV0PzogRGVlcFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0PlsgJ3RhZ0ZpbHRlcmluZycgXSk6IFRhZ0ZpbHRlcmluZ0NvbmZpZyB7XG4gIGNvbnN0IGN1c3RvbVRhZ3MgPSBpbnB1dD8uY3VzdG9tIGFzIFJlY29yZDxzdHJpbmcsIChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBzdHJpbmc+IHwgdW5kZWZpbmVkO1xuXG4gIHJldHVybiB7XG4gICAgaW5jbHVkZTogaW5wdXQ/LmluY2x1ZGUgPz8gQ09ORklHX0RFRkFVTFRTLnRhZ0ZpbHRlcmluZy5pbmNsdWRlLFxuICAgIGN1c3RvbTogY3VzdG9tVGFncyxcbiAgICBtYXhUYWdzOiBpbnB1dD8ubWF4VGFncyA/PyBDT05GSUdfREVGQVVMVFMudGFnRmlsdGVyaW5nLm1heFRhZ3MsXG4gIH07XG59XG5cblxuZnVuY3Rpb24gbm9ybWFsaXplRHluYW1vRGIoaW5wdXQ/OiBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXRbICdkeW5hbW9kYicgXSk6IER5bmFtb0RCQ29uZmlnIHtcbiAgcmV0dXJuIHtcbiAgICB0YWJsZUtleTogaW5wdXQ/LnRhYmxlS2V5ID8/IENPTkZJR19ERUZBVUxUUy50YWJsZUtleSxcbiAgICB0dGxEYXlzOiBpbnB1dD8udHRsRGF5cyA/PyBDT05GSUdfREVGQVVMVFMudHRsRGF5cyxcbiAgICB0cnVuY2F0aW9uOiB7XG4gICAgICBlbmFibGVkOiBpbnB1dD8udHJ1bmNhdGlvbj8uZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMudHJ1bmNhdGlvbi5lbmFibGVkLFxuICAgICAgbWF4Qnl0ZXM6IGlucHV0Py50cnVuY2F0aW9uPy5tYXhCeXRlcyA/PyBDT05GSUdfREVGQVVMVFMudHJ1bmNhdGlvbi5tYXhCeXRlcyxcbiAgICAgIGZpZWxkczogaW5wdXQ/LnRydW5jYXRpb24/LmZpZWxkcyA/PyBbIC4uLkNPTkZJR19ERUZBVUxUUy50cnVuY2F0aW9uLmZpZWxkcyBdLFxuICAgIH0sXG4gICAgbWF4SXRlbVNpemU6IGlucHV0Py5tYXhJdGVtU2l6ZSA/PyBDT05GSUdfREVGQVVMVFMuZHluYW1vTWF4SXRlbVNpemUsXG4gICAgbWF4QmF0Y2hTaXplOiBpbnB1dD8ubWF4QmF0Y2hTaXplID8/IENPTkZJR19ERUZBVUxUUy5keW5hbW9NYXhCYXRjaFNpemUsXG4gICAgbWF4QnVmZmVyU2l6ZTogaW5wdXQ/Lm1heEJ1ZmZlclNpemUgPz8gQ09ORklHX0RFRkFVTFRTLmR5bmFtb01heEJ1ZmZlclNpemUsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZURhdGFQcm90ZWN0aW9uKGlucHV0PzogRGVlcFBhcnRpYWw8RGF0YVByb3RlY3Rpb25Db25maWc+KTogRGF0YVByb3RlY3Rpb25Db25maWcge1xuICBjb25zdCBibGFja2xpc3RlZEtleXMgPSBBcnJheS5pc0FycmF5KGlucHV0Py5ibGFja2xpc3RlZEtleXMpXG4gICAgPyBpbnB1dC5ibGFja2xpc3RlZEtleXMuZmlsdGVyKChrOiB1bmtub3duKTogayBpcyBzdHJpbmcgfCBSZWdFeHAgPT4gayAhPT0gdW5kZWZpbmVkICYmIGsgIT09IG51bGwpXG4gICAgOiBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVM7XG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogaW5wdXQ/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICBibGFja2xpc3RlZEtleXMsXG4gICAgZnV6enlLZXlNYXRjaDogaW5wdXQ/LmZ1enp5S2V5TWF0Y2ggPz8gdHJ1ZSxcbiAgICBjYXNlU2Vuc2l0aXZlS2V5TWF0Y2g6IGlucHV0Py5jYXNlU2Vuc2l0aXZlS2V5TWF0Y2ggPz8gZmFsc2UsXG4gICAgcmVwbGFjZW1lbnQ6IGlucHV0Py5yZXBsYWNlbWVudCA/PyAnW1JFREFDVEVEXScsXG4gICAgZmllbGRzOiBpbnB1dD8uZmllbGRzID8/IFsgJ2RhdGEnLCAnYXR0cmlidXRlcycsICdtZXRhZGF0YScsICdjb250ZXh0JyBdLFxuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVTcGFuQ29uZmlnKGlucHV0PzogeyBtaW5EdXJhdGlvbk1zPzogbnVtYmVyOyBza2lwRW1wdHk/OiBib29sZWFuIH0pOiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnc3BhbnMnIF0ge1xuICByZXR1cm4ge1xuICAgIG1pbkR1cmF0aW9uTXM6IGlucHV0Py5taW5EdXJhdGlvbk1zID8/IENPTkZJR19ERUZBVUxUUy5zcGFucy5taW5EdXJhdGlvbk1zLFxuICAgIHNraXBFbXB0eTogaW5wdXQ/LnNraXBFbXB0eSA/PyBDT05GSUdfREVGQVVMVFMuc3BhbnMuc2tpcEVtcHR5LFxuICB9O1xufVxuXG4vKipcbiAqIEFnZ3Jlc3NpdmUgcHJlc2V0IG92ZXJyaWRlcyDigJQgdGlnaHRlciBhYnNvcnB0aW9uIGJvdW5kcyBhbmQgbG93ZXIgc2xvdyB0aHJlc2hvbGRzLlxuICovXG5jb25zdCBBR0dSRVNTSVZFX05PSVNFX09WRVJSSURFUyA9IHtcbiAgbWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuOiAxMCxcbiAgbWF4QWJzb3JiZWRDYXVzZWRCeUxpbmtzUGVyU3BhbjogMjUsXG4gIG1heEFic29yYmVkRW50aXR5SWRzUGVyU3BhbjogNTAsXG4gIG1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW46IDI1LFxuICBtYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbjogNTAsXG4gIGhhcmRTaWduYWxzOiB7XG4gICAgc2xvd1RocmVzaG9sZE1zOiAyMDAwLFxuICB9LFxufSBhcyBjb25zdDtcblxuZnVuY3Rpb24gbm9ybWFsaXplTm9pc2VSZWR1Y3Rpb24oXG4gIGlucHV0PzogRGVlcFBhcnRpYWw8Tm9pc2VSZWR1Y3Rpb25Db25maWc+LFxuICBfZ2xvYmFsTWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWwsXG4pOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyB7XG4gIGNvbnN0IGQgPSBDT05GSUdfREVGQVVMVFMubm9pc2VSZWR1Y3Rpb247XG5cbiAgLy8gUmVzb2x2ZSBwcmVzZXQgbGV2ZWwg4oCUIGV4cGxpY2l0IGBlbmFibGVkYCBvdmVycmlkZXMgcHJlc2V0XG4gIGNvbnN0IHByZXNldExldmVsID0gaW5wdXQ/LnByZXNldCBhcyBOb2lzZVJlZHVjdGlvblByZXNldExldmVsIHwgdW5kZWZpbmVkO1xuICBjb25zdCBpc0VuYWJsZWQgPSBpbnB1dD8uZW5hYmxlZCA/PyAocHJlc2V0TGV2ZWwgPT09ICdyZWNvbW1lbmRlZCcgfHwgcHJlc2V0TGV2ZWwgPT09ICdhZ2dyZXNzaXZlJyA/IHRydWUgOiBkLmVuYWJsZWQpO1xuICBjb25zdCBpc0FnZ3Jlc3NpdmUgPSBwcmVzZXRMZXZlbCA9PT0gJ2FnZ3Jlc3NpdmUnO1xuXG4gIGNvbnN0IHByZXNldHMgPSBBcnJheS5pc0FycmF5KGlucHV0Py5wcmVzZXRzKVxuICAgID8gaW5wdXQucHJlc2V0cy5maWx0ZXIoKHApOiBwIGlzIE5vaXNlUmVkdWN0aW9uQ29uZmlnWydwcmVzZXRzJ11bbnVtYmVyXSA9PiB0eXBlb2YgcCA9PT0gJ3N0cmluZycpXG4gICAgOiBkLnByZXNldHM7XG5cbiAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gQXJyYXkuaXNBcnJheShpbnB1dD8ucnVsZXMpXG4gICAgPyAoaW5wdXQucnVsZXMuZmlsdGVyKHIgPT4ge1xuICAgICAgcmV0dXJuIGlzUmVjb3JkKHIpXG4gICAgICAgICYmIHR5cGVvZiByLmlkID09PSAnc3RyaW5nJ1xuICAgICAgICAmJiB0eXBlb2Ygci5kZWNpc2lvbiA9PT0gJ3N0cmluZydcbiAgICAgICAgJiYgaXNSZWNvcmQoci5tYXRjaCk7XG4gICAgfSkgYXMgTm9pc2VSdWxlW10pXG4gICAgOiBbLi4uZC5ydWxlc107XG5cbiAgLy8gTm9ybWFsaXplIGhhcmRTaWduYWxzIHRvIGVuc3VyZSBzbG93VGhyZXNob2xkcyBoYXMgbm8gdW5kZWZpbmVkIHZhbHVlc1xuICBjb25zdCBoYXJkU2lnbmFsSW5wdXQgPSBpbnB1dD8uaGFyZFNpZ25hbHM7XG4gIGNvbnN0IGFnZ3Jlc3NpdmVIUyA9IGlzQWdncmVzc2l2ZSA/IEFHR1JFU1NJVkVfTk9JU0VfT1ZFUlJJREVTLmhhcmRTaWduYWxzIDogdW5kZWZpbmVkO1xuICBjb25zdCBoYXJkU2lnbmFsczogSGFyZFNpZ25hbENvbmZpZyB8IHVuZGVmaW5lZCA9IGhhcmRTaWduYWxJbnB1dCA/IHtcbiAgICBsZXZlbHM6IGhhcmRTaWduYWxJbnB1dC5sZXZlbHMsXG4gICAgaW5jbHVkZVdhcm46IGhhcmRTaWduYWxJbnB1dC5pbmNsdWRlV2FybixcbiAgICBzbG93VGhyZXNob2xkTXM6IGhhcmRTaWduYWxJbnB1dC5zbG93VGhyZXNob2xkTXMgPz8gYWdncmVzc2l2ZUhTPy5zbG93VGhyZXNob2xkTXMsXG4gICAgc2xvd1RocmVzaG9sZHM6IGhhcmRTaWduYWxJbnB1dC5zbG93VGhyZXNob2xkc1xuICAgICAgPyBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgIE9iamVjdC5lbnRyaWVzKGhhcmRTaWduYWxJbnB1dC5zbG93VGhyZXNob2xkcykuZmlsdGVyKChbXywgdl0pID0+IHYgIT09IHVuZGVmaW5lZCksXG4gICAgICApIGFzIFJlY29yZDxzdHJpbmcsIG51bWJlcj5cbiAgICAgIDogdW5kZWZpbmVkLFxuICB9IDoge1xuICAgIC4uLmQuaGFyZFNpZ25hbHMsXG4gICAgLi4uKGFnZ3Jlc3NpdmVIUyA/IHsgc2xvd1RocmVzaG9sZE1zOiBhZ2dyZXNzaXZlSFMuc2xvd1RocmVzaG9sZE1zIH0gOiB7fSksXG4gIH07XG5cbiAgY29uc3QgYWdncmVzc2l2ZUJvdW5kcyA9IGlzQWdncmVzc2l2ZSA/IEFHR1JFU1NJVkVfTk9JU0VfT1ZFUlJJREVTIDogdW5kZWZpbmVkO1xuXG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogaXNFbmFibGVkLFxuICAgIHByZXNldDogcHJlc2V0TGV2ZWwsXG4gICAgaGFyZFNpZ25hbHMsXG4gICAgcHJlc2V0cyxcbiAgICBydWxlcyxcbiAgICBtYXhBYnNvcmJlZEVycm9yc1BlclNwYW46IGlucHV0Py5tYXhBYnNvcmJlZEVycm9yc1BlclNwYW4gPz8gYWdncmVzc2l2ZUJvdW5kcz8ubWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuID8/IGQubWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuLFxuICAgIG1heEFic29yYmVkQ2F1c2VkQnlMaW5rc1BlclNwYW46IGlucHV0Py5tYXhBYnNvcmJlZENhdXNlZEJ5TGlua3NQZXJTcGFuID8/IGFnZ3Jlc3NpdmVCb3VuZHM/Lm1heEFic29yYmVkQ2F1c2VkQnlMaW5rc1BlclNwYW4gPz8gZC5tYXhBYnNvcmJlZENhdXNlZEJ5TGlua3NQZXJTcGFuLFxuICAgIG1heEFic29yYmVkRW50aXR5SWRzUGVyU3BhbjogaW5wdXQ/Lm1heEFic29yYmVkRW50aXR5SWRzUGVyU3BhbiA/PyBhZ2dyZXNzaXZlQm91bmRzPy5tYXhBYnNvcmJlZEVudGl0eUlkc1BlclNwYW4gPz8gZC5tYXhBYnNvcmJlZEVudGl0eUlkc1BlclNwYW4sXG4gICAgbWF4QWJzb3JiZWRPcGVyYXRpb25LZXlzUGVyU3BhbjogaW5wdXQ/Lm1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW4gPz8gYWdncmVzc2l2ZUJvdW5kcz8ubWF4QWJzb3JiZWRPcGVyYXRpb25LZXlzUGVyU3BhbiA/PyBkLm1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW4sXG4gICAgbWF4QWJzb3JiZWRDaGVja3BvaW50c1BlclNwYW46IGlucHV0Py5tYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbiA/PyBhZ2dyZXNzaXZlQm91bmRzPy5tYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbiA/PyBkLm1heEFic29yYmVkQ2hlY2twb2ludHNQZXJTcGFuLFxuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVPcGVyYXRpb25Ob3JtYWxpemF0aW9uKFxuICBpbnB1dD86IERlZXBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdPlxuKTogTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF0+IHtcbiAgY29uc3QgcnVsZXMgPSBBcnJheS5pc0FycmF5KGlucHV0Py5ydWxlcylcbiAgICA/IGlucHV0LnJ1bGVzLmZpbHRlcigocik6IHIgaXMgT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF1bICdydWxlcycgXVsgbnVtYmVyIF0gPT4ge1xuICAgICAgcmV0dXJuIGlzUmVjb3JkKHIpXG4gICAgICAgICYmIHR5cGVvZiByLmlkID09PSAnc3RyaW5nJ1xuICAgICAgICAmJiB0eXBlb2Ygci5tYXRjaCA9PT0gJ3N0cmluZydcbiAgICAgICAgJiYgdHlwZW9mIHIucmVwbGFjZSA9PT0gJ3N0cmluZyc7XG4gICAgfSlcbiAgICA6IERFRkFVTFRfT1BFUkFUSU9OX05PUk1BTElaQVRJT05fUlVMRVM7XG5cbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBpbnB1dD8uZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMub3BlcmF0aW9uTm9ybWFsaXphdGlvbi5lbmFibGVkLFxuICAgIHJ1bGVzLFxuICAgIHN0b3JlT3JpZ2luYWw6IGlucHV0Py5zdG9yZU9yaWdpbmFsID8/IENPTkZJR19ERUZBVUxUUy5vcGVyYXRpb25Ob3JtYWxpemF0aW9uLnN0b3JlT3JpZ2luYWwsXG4gIH07XG59XG5cbi8qKlxuICogTm9ybWFsaXplIHF1ZXJ5IHBlcmZvcm1hbmNlIGNvbmZpZ3VyYXRpb25cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUXVlcnlQZXJmb3JtYW5jZUNvbmZpZyhpbnB1dD86IERlZXBQYXJ0aWFsPFF1ZXJ5UGVyZm9ybWFuY2VDb25maWc+KTogUXVlcnlQZXJmb3JtYW5jZUNvbmZpZyB7XG4gIGNvbnN0IGQgPSBDT05GSUdfREVGQVVMVFMucXVlcnlQZXJmb3JtYW5jZTtcblxuICAvLyBDYXN0IHJlYWRvbmx5IGRlZmF1bHQgdG8gbXV0YWJsZSBvciB1c2UgaW5wdXRcbiAgY29uc3Qgb3BlcmF0aW9uVGhyZXNob2xkcyA9IChpbnB1dD8ub3BlcmF0aW9uVGhyZXNob2xkc1xuICAgID8gaW5wdXQub3BlcmF0aW9uVGhyZXNob2xkcy5maWx0ZXIoKHQpOiB0IGlzIE9wZXJhdGlvblRpbWluZ0NvbmZpZyA9PiAhIXQgJiYgISF0Lm9wZXJhdGlvbiAmJiB0eXBlb2YgdC5zbG93VGhyZXNob2xkID09PSAnbnVtYmVyJylcbiAgICA6IGQub3BlcmF0aW9uVGhyZXNob2xkcykgYXMgT3BlcmF0aW9uVGltaW5nQ29uZmlnW107XG5cbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBpbnB1dD8uZW5hYmxlZCA/PyBkLmVuYWJsZWQsXG4gICAgc2xvd1RocmVzaG9sZDogaW5wdXQ/LnNsb3dUaHJlc2hvbGQgPz8gZC5zbG93VGhyZXNob2xkLFxuICAgIGZhc3RRdWVyeVNhbXBsZVJhdGU6IGlucHV0Py5mYXN0UXVlcnlTYW1wbGVSYXRlID8/IGQuZmFzdFF1ZXJ5U2FtcGxlUmF0ZSxcbiAgICBzbG93UXVlcnlTYW1wbGVSYXRlOiBpbnB1dD8uc2xvd1F1ZXJ5U2FtcGxlUmF0ZSA/PyBkLnNsb3dRdWVyeVNhbXBsZVJhdGUsXG4gICAgb3BlcmF0aW9uVGhyZXNob2xkcyxcbiAgICBlbnRpdHlPdmVycmlkZXM6IGlucHV0Py5lbnRpdHlPdmVycmlkZXMgYXMgRW50aXR5UXVlcnlUaW1pbmdPdmVycmlkZVtdIHwgdW5kZWZpbmVkLFxuICAgIGV4Y2x1ZGVFbnRpdGllczogaW5wdXQ/LmV4Y2x1ZGVFbnRpdGllcyBhcyBzdHJpbmdbXSB8IHVuZGVmaW5lZCxcbiAgICBhbHdheXNUcmFja0VudGl0aWVzOiBpbnB1dD8uYWx3YXlzVHJhY2tFbnRpdGllcyBhcyBzdHJpbmdbXSB8IHVuZGVmaW5lZCxcbiAgICBjYXB0dXJlU2xvd1F1ZXJ5RGV0YWlsczogaW5wdXQ/LmNhcHR1cmVTbG93UXVlcnlEZXRhaWxzID8/IGQuY2FwdHVyZVNsb3dRdWVyeURldGFpbHMsXG4gICAgdHJhY2tDYXBhY2l0eTogaW5wdXQ/LnRyYWNrQ2FwYWNpdHkgPz8gZC50cmFja0NhcGFjaXR5LFxuICB9O1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBiYWNrZW5kcyBpbnB1dCB0byBmdWxsIEJhY2tlbmRDb25maWcgYXJyYXlcbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQmFja2VuZHMoXG4gIGlucHV0PzogQXJyYXk8RGVlcFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWdJbnB1dD4gfCB1bmRlZmluZWQ+XG4pOiBPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZ1tdIHtcbiAgY29uc3QgbGlzdCA9IChpbnB1dCA/PyBbXSkuZmlsdGVyKChiKTogYiBpcyBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZ0lucHV0PiA9PiAhIWIpO1xuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gWyB7IHR5cGU6ICdjbG91ZHdhdGNoJywgZW5hYmxlZDogdHJ1ZSB9IF07XG4gIH1cblxuICByZXR1cm4gbGlzdC5tYXAoKGIpOiBPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZyA9PiB7XG4gICAgaWYgKCFiLnR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBvYnNlcnZhYmlsaXR5IGJhY2tlbmQgY29uZmlnOiBtaXNzaW5nIGB0eXBlYCcpO1xuICAgIH1cbiAgICBzd2l0Y2ggKGIudHlwZSkge1xuICAgICAgY2FzZSAnY2xvdWR3YXRjaCc6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgICAgIGVuYWJsZWQ6IGIuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICAgIG1pbkxldmVsOiBiLm1pbkxldmVsLFxuICAgICAgICAgIGNvbmZpZzogYi5jb25maWcsXG4gICAgICAgICAgdHlwZXM6IGIudHlwZXMsXG4gICAgICAgIH07XG4gICAgICBjYXNlICdkeW5hbW9kYic6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ2R5bmFtb2RiJyxcbiAgICAgICAgICBlbmFibGVkOiBiLmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgICBtaW5MZXZlbDogYi5taW5MZXZlbCxcbiAgICAgICAgICBjb25maWc6IGIuY29uZmlnLFxuICAgICAgICAgIHR5cGVzOiBiLnR5cGVzLFxuICAgICAgICB9O1xuICAgICAgY2FzZSAnb3RlbCc6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ290ZWwnLFxuICAgICAgICAgIGVuYWJsZWQ6IGIuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICAgIG1pbkxldmVsOiBiLm1pbkxldmVsLFxuICAgICAgICAgIGNvbmZpZzogYi5jb25maWcsXG4gICAgICAgICAgdHlwZXM6IGIudHlwZXMsXG4gICAgICAgIH07XG4gICAgICBjYXNlICdsb2d0cmFpbCc6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ2xvZ3RyYWlsJyxcbiAgICAgICAgICBlbmFibGVkOiBiLmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgICBtaW5MZXZlbDogYi5taW5MZXZlbCxcbiAgICAgICAgICBjb25maWc6IGIuY29uZmlnLFxuICAgICAgICAgIHR5cGVzOiBiLnR5cGVzLFxuICAgICAgICB9O1xuICAgICAgZGVmYXVsdDoge1xuICAgICAgICBjb25zdCB0ID0gKGIgYXMgeyB0eXBlPzogdW5rbm93biB9KS50eXBlO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb2JzZXJ2YWJpbGl0eSBiYWNrZW5kIHR5cGU6ICR7U3RyaW5nKHQpfWApO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVmFsaWRhdGUgb2JzZXJ2YWJpbGl0eSBjb25maWd1cmF0aW9uXG4gKiBSZXR1cm5zIGFycmF5IG9mIHZhbGlkYXRpb24gZXJyb3JzIChlbXB0eSBpZiB2YWxpZClcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ29uZmlnKGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIC8vIFZhbGlkYXRlIG1pbkxldmVsXG4gIGNvbnN0IHZhbGlkTGV2ZWxzID0gT2JqZWN0LnZhbHVlcyhPYnNlcnZhYmlsaXR5TGV2ZWwpLmZpbHRlcigodikgPT4gdHlwZW9mIHYgPT09ICdudW1iZXInKTtcbiAgaWYgKCF2YWxpZExldmVscy5pbmNsdWRlcyhjb25maWcubWluTGV2ZWwpKSB7XG4gICAgZXJyb3JzLnB1c2goYEludmFsaWQgbWluTGV2ZWw6ICR7Y29uZmlnLm1pbkxldmVsfWApO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgc2FtcGxpbmcgcmF0ZXNcbiAgaWYgKGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCAmJiBjb25maWcuc2FtcGxpbmcucmF0ZXMpIHtcbiAgICBPYmplY3QuZW50cmllcyhjb25maWcuc2FtcGxpbmcucmF0ZXMpLmZvckVhY2goKFsgbGV2ZWwsIHJhdGUgXSkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXRlICE9PSAnbnVtYmVyJyB8fCByYXRlIDwgMCB8fCByYXRlID4gMSkge1xuICAgICAgICBlcnJvcnMucHVzaChgSW52YWxpZCBzYW1wbGluZyByYXRlIGZvciAke2xldmVsfTogJHtyYXRlfS4gTXVzdCBiZSBiZXR3ZWVuIDAgYW5kIDEuYCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBiYWNrZW5kIHR5cGVzXG4gIGNvbmZpZy5iYWNrZW5kcz8uZm9yRWFjaCgoYmFja2VuZCwgaW5kZXgpID0+IHtcbiAgICBpZiAoIVZBTElEX0JBQ0tFTkRTLmluY2x1ZGVzKGJhY2tlbmQudHlwZSBhcyBWYWxpZEJhY2tlbmQpKSB7XG4gICAgICBlcnJvcnMucHVzaChgSW52YWxpZCBiYWNrZW5kIHR5cGUgYXQgaW5kZXggJHtpbmRleH06ICR7YmFja2VuZC50eXBlfWApO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gVmFsaWRhdGUgc2VydmljZU5hbWVcbiAgaWYgKCFjb25maWcuc2VydmljZU5hbWUgfHwgY29uZmlnLnNlcnZpY2VOYW1lLnRyaW0oKSA9PT0gJycpIHtcbiAgICBlcnJvcnMucHVzaCgnc2VydmljZU5hbWUgaXMgcmVxdWlyZWQgYW5kIGNhbm5vdCBiZSBlbXB0eScpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgY2xvdWR3YXRjaC5uYW1lc3BhY2VcbiAgaWYgKCFjb25maWcuY2xvdWR3YXRjaD8ubmFtZXNwYWNlIHx8IGNvbmZpZy5jbG91ZHdhdGNoLm5hbWVzcGFjZS50cmltKCkgPT09ICcnKSB7XG4gICAgZXJyb3JzLnB1c2goJ2Nsb3Vkd2F0Y2gubmFtZXNwYWNlIGlzIHJlcXVpcmVkIGFuZCBjYW5ub3QgYmUgZW1wdHknKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGR5bmFtb2RiLnRhYmxlS2V5XG4gIGlmICghY29uZmlnLmR5bmFtb2RiPy50YWJsZUtleSB8fCBjb25maWcuZHluYW1vZGIudGFibGVLZXkudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdkeW5hbW9kYi50YWJsZUtleSBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBkeW5hbW9kYi50dGxEYXlzXG4gIGlmIChjb25maWcuZHluYW1vZGIgJiYgKHR5cGVvZiBjb25maWcuZHluYW1vZGIudHRsRGF5cyAhPT0gJ251bWJlcicgfHwgY29uZmlnLmR5bmFtb2RiLnR0bERheXMgPCAxKSkge1xuICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIGR5bmFtb2RiLnR0bERheXM6ICR7Y29uZmlnLmR5bmFtb2RiLnR0bERheXN9LiBNdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyLmApO1xuICB9XG5cbiAgcmV0dXJuIGVycm9ycztcbn1cbiJdfQ==