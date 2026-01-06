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
exports.VALID_BACKENDS = ['cloudwatch', 'dynamodb', 'otel'];
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
    // Noise reduction defaults: enabled in framework configs (can be disabled per preset/app).
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
        emitSummaries: false,
        // Bounds (match the policy engine defaults)
        maxCheckpointsPerSpan: 500,
        maxAggregateKeysPerSpan: 200,
        maxAggregateExamplesPerKey: 5,
        maxAggregateErrorExamplesPerKey: 3,
        // Production defaults: checkpoints yes, debug metadata no
        includeDebugMetadata: false,
        includeExamples: false,
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
    const isValidBackend = (v) => v === 'cloudwatch' || v === 'dynamodb' || v === 'otel';
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
function normalizeNoiseReduction(input, globalMinLevel) {
    const d = exports.CONFIG_DEFAULTS.noiseReduction;
    const presets = Array.isArray(input?.presets)
        ? input.presets.filter((p) => typeof p === 'string')
        : d.presets;
    const rules = Array.isArray(input?.rules)
        ? input.rules.filter((r) => {
            return isRecord(r)
                && typeof r.id === 'string'
                && typeof r.decision === 'string'
                && isRecord(r.match);
        })
        : d.rules;
    // Normalize hardSignals to ensure slowThresholds has no undefined values
    const hardSignals = input?.hardSignals ? {
        levels: input.hardSignals.levels,
        includeWarn: input.hardSignals.includeWarn,
        slowThresholdMs: input.hardSignals.slowThresholdMs,
        slowThresholds: input.hardSignals.slowThresholds
            ? Object.fromEntries(Object.entries(input.hardSignals.slowThresholds).filter(([_, v]) => v !== undefined))
            : undefined,
    } : d.hardSignals;
    return {
        enabled: input?.enabled ?? d.enabled,
        minLevel: input?.minLevel ?? globalMinLevel,
        hardSignals,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUE4UEgsb0NBTUM7QUEwQkQsOERBOEJDO0FBaVRELHdDQThDQztBQXpwQkQsbUNBb0JpQjtBQUNqQiw2REFBbUU7QUFFbkUsMENBQXVDO0FBRXZDLFNBQVMsUUFBUSxDQUFDLEtBQWM7SUFDOUIsT0FBTyxDQUFDLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDdkUsQ0FBQztBQUVEOztHQUVHO0FBQ1UsUUFBQSxjQUFjLEdBQUcsQ0FBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLE1BQU0sQ0FBVyxDQUFDO0FBRzVFOztHQUVHO0FBQ1UsUUFBQSxlQUFlLEdBQUc7SUFDN0IsV0FBVyxFQUFFLGNBQWM7SUFDM0IsbUJBQW1CLEVBQUUsTUFBTTtJQUMzQixnRUFBZ0U7SUFDaEUsb0RBQW9EO0lBQ3BELFFBQVEsRUFBRSxtQkFBbUI7SUFDN0IsT0FBTyxFQUFFLEVBQUU7SUFDWCxRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSTtJQUNqQyxPQUFPLEVBQUUsS0FBSztJQUNkLGdCQUFnQixFQUFFLEtBQUs7SUFDdkIsS0FBSyxFQUFFO1FBQ0wsYUFBYSxFQUFFLEVBQUU7UUFDakIsU0FBUyxFQUFFLElBQUk7S0FDaEI7SUFDRCxnQkFBZ0IsRUFBRTtRQUNoQixPQUFPLEVBQUUsSUFBSTtRQUNiLGFBQWEsRUFBRSxFQUFFLEdBQUcsSUFBSSxFQUFFLFlBQVk7UUFDdEMsbUJBQW1CLEVBQUUsSUFBSSxFQUFFLHFCQUFxQjtRQUNoRCxtQkFBbUIsRUFBRSxHQUFHLEVBQUUsdUJBQXVCO1FBQ2pELHVCQUF1QixFQUFFLElBQUk7UUFDN0IsYUFBYSxFQUFFLEtBQUs7UUFD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QUM3RCxDQUFDO0lBRUQsZ0NBQWdDO0lBQ2hDLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxFQUFFLFNBQVMsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQztRQUMvRSxNQUFNLENBQUMsSUFBSSxDQUFDLHNEQUFzRCxDQUFDLENBQUM7SUFDdEUsQ0FBQztJQUVELDZCQUE2QjtJQUM3QixJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7UUFDekUsTUFBTSxDQUFDLElBQUksQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFFRCw0QkFBNEI7SUFDNUIsSUFBSSxNQUFNLENBQUMsUUFBUSxJQUFJLENBQUMsT0FBTyxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUNwRyxNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sOEJBQThCLENBQUMsQ0FBQztJQUNsRyxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBDb25maWd1cmF0aW9uXG4gKiBcbiAqIEZhY3RvcnkgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIHR5cGVkLCB2YWxpZGF0ZWQgb2JzZXJ2YWJpbGl0eSBjb25maWcuXG4gKi9cblxuaW1wb3J0IHtcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsLFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBTYW1wbGluZ0NvbmZpZyxcbiAgU2FtcGxpbmdSdWxlLFxuICBEYXRhUHJvdGVjdGlvbkNvbmZpZyxcbiAgVHJ1bmNhdGlvbkNvbmZpZyxcbiAgRHluYW1vREJDb25maWcsXG4gIE5vaXNlUmVkdWN0aW9uQ29uZmlnLFxuICBIYXJkU2lnbmFsQ29uZmlnLFxuICBUeXBlU3BlY2lmaWNDb25maWcsXG4gIFF1ZXJ5UGVyZm9ybWFuY2VDb25maWcsXG4gIE9wZXJhdGlvblRpbWluZ0NvbmZpZyxcbiAgRW50aXR5UXVlcnlUaW1pbmdPdmVycmlkZSxcbiAgQ2xvdWRXYXRjaENvbmZpZyxcbiAgVGFnRmlsdGVyaW5nQ29uZmlnLFxuICBOYW1lc3BhY2VTdHJhdGVneSxcbiAgT3BlcmF0aW9uTWV0cmljUnVsZSxcbn0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVMgfSBmcm9tICcuL3V0aWxzL2RhdGEtcHJvdGVjdGlvbic7XG5pbXBvcnQgdHlwZSB7IERlZXBQYXJ0aWFsIH0gZnJvbSAnLi4vdXRpbHMvdHlwZXMnO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tICcuLi91dGlscy9tZXJnZSc7XG5cbmZ1bmN0aW9uIGlzUmVjb3JkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cblxuLyoqXG4gKiBWYWxpZCBiYWNrZW5kIHR5cGVzXG4gKi9cbmV4cG9ydCBjb25zdCBWQUxJRF9CQUNLRU5EUyA9IFsgJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInLCAnb3RlbCcgXSBhcyBjb25zdDtcbmV4cG9ydCB0eXBlIFZhbGlkQmFja2VuZCA9IHR5cGVvZiBWQUxJRF9CQUNLRU5EU1sgbnVtYmVyIF07XG5cbi8qKlxuICogQ2VudHJhbGl6ZWQgY29uZmlndXJhdGlvbiBkZWZhdWx0c1xuICovXG5leHBvcnQgY29uc3QgQ09ORklHX0RFRkFVTFRTID0ge1xuICBzZXJ2aWNlTmFtZTogJ2Z3MjQtc2VydmljZScsXG4gIGNsb3Vkd2F0Y2hOYW1lc3BhY2U6ICdGVzI0JyxcbiAgLy8gdGFibGVLZXkgaXMgdGhlIGxvZ2ljYWwgdGFibGUgbmFtZSB1c2VkIHRvIGRlcml2ZSBlbnYgdmFyIGtleVxuICAvLyBFbnYgdmFyOiB7dGFibGVLZXl9X3RhYmxlID0gYWN0dWFsIENESyB0YWJsZSBuYW1lXG4gIHRhYmxlS2V5OiAnb2JzZXJ2YWJpbGl0eWxvZ3MnLFxuICB0dGxEYXlzOiA5MCxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICBlbmFibGVkOiBmYWxzZSxcbiAgc291cmNlTWFwRW5hYmxlZDogZmFsc2UsXG4gIHNwYW5zOiB7XG4gICAgbWluRHVyYXRpb25NczogNTAsXG4gICAgc2tpcEVtcHR5OiB0cnVlLFxuICB9LFxuICBxdWVyeVBlcmZvcm1hbmNlOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzbG93VGhyZXNob2xkOiAzMCAqIDEwMDAsIC8vIDMwIHNlY29uZFxuICAgIGZhc3RRdWVyeVNhbXBsZVJhdGU6IDAuMDEsIC8vIDElIG9mIGZhc3QgcXVlcmllc1xuICAgIHNsb3dRdWVyeVNhbXBsZVJhdGU6IDEuMCwgLy8gMTAwJSBvZiBzbG93IHF1ZXJpZXNcbiAgICBjYXB0dXJlU2xvd1F1ZXJ5RGV0YWlsczogdHJ1ZSxcbiAgICB0cmFja0NhcGFjaXR5OiBmYWxzZSxcbiAgICAvLyBTZW5zaWJsZSBvcGVyYXRpb24tc3BlY2lmaWMgdGhyZXNob2xkc1xuICAgIG9wZXJhdGlvblRocmVzaG9sZHM6IFtcbiAgICAgIHsgb3BlcmF0aW9uOiAnZ2V0Jywgc2xvd1RocmVzaG9sZDogMTUgKiAxMDAwIH0sICAgICAgIC8vIFNpbmdsZSBpdGVtIC0gc2hvdWxkIGJlIGZhc3RcbiAgICAgIHsgb3BlcmF0aW9uOiAnYmF0Y2hHZXQnLCBzbG93VGhyZXNob2xkOiAzMCAqIDEwMDAgfSwgLy8gQmF0Y2ggLSBiaXQgc2xvd2VyIE9LXG4gICAgICB7IG9wZXJhdGlvbjogJ2xpc3QnLCBzbG93VGhyZXNob2xkOiAyMCAqIDEwMDAgfSwgICAgIC8vIExpc3Qgd2l0aCBpbmRleCAtIDFzIE9LXG4gICAgICB7IG9wZXJhdGlvbjogJ3F1ZXJ5Jywgc2xvd1RocmVzaG9sZDogMzAgKiAxMDAwIH0sICAgIC8vIFF1ZXJ5IHdpdGggaW5kZXggLSAxcyBPS1xuICAgICAgeyBvcGVyYXRpb246ICdzY2FuJywgc2xvd1RocmVzaG9sZDogNjAgKiAxMDAwIH0sICAgICAvLyBGdWxsIHNjYW4gLSBuYXR1cmFsbHkgc2xvd1xuICAgICAgeyBvcGVyYXRpb246ICdjcmVhdGUnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICd1cGRhdGUnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICd1cHNlcnQnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICdkZWxldGUnLCBzbG93VGhyZXNob2xkOiAxNSAqIDEwMDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICdiYXRjaERlbGV0ZScsIHNsb3dUaHJlc2hvbGQ6IDMwICogMTAwMCB9LCAvLyBCYXRjaCB3cml0ZVxuICAgIF0sXG4gIH0sXG4gIG9wZXJhdGlvbk5vcm1hbGl6YXRpb246IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHN0b3JlT3JpZ2luYWw6IHRydWUsXG4gIH0sXG4gIC8vIE5vaXNlIHJlZHVjdGlvbiBkZWZhdWx0czogZW5hYmxlZCBpbiBmcmFtZXdvcmsgY29uZmlncyAoY2FuIGJlIGRpc2FibGVkIHBlciBwcmVzZXQvYXBwKS5cbiAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICBlbmFibGVkOiBmYWxzZSxcbiAgICBoYXJkU2lnbmFsczoge1xuICAgICAgbGV2ZWxzOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSxcbiAgICAgIGluY2x1ZGVXYXJuOiBmYWxzZSxcbiAgICAgIHNsb3dUaHJlc2hvbGRNczogNTAwMCxcbiAgICAgIHNsb3dUaHJlc2hvbGRzOiB7XG4gICAgICAgICdkYXRhYmFzZS5xdWVyeSc6IDEwMCxcbiAgICAgICAgJ2V4dGVybmFsLmFwaSc6IDEwMDAwLFxuICAgICAgICAnYmF0Y2gucHJvY2Vzcyc6IDMwMDAwLFxuICAgICAgfSxcbiAgICB9LFxuICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnLCAnZncyNC5iYXRjaF9wcm9jZXNzb3JzJyBdLFxuICAgIHJ1bGVzOiBbXSxcbiAgICBlbWl0U3VtbWFyaWVzOiBmYWxzZSxcbiAgICAvLyBCb3VuZHMgKG1hdGNoIHRoZSBwb2xpY3kgZW5naW5lIGRlZmF1bHRzKVxuICAgIG1heENoZWNrcG9pbnRzUGVyU3BhbjogNTAwLFxuICAgIG1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuOiAyMDAsXG4gICAgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXk6IDUsXG4gICAgbWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleTogMyxcbiAgICAvLyBQcm9kdWN0aW9uIGRlZmF1bHRzOiBjaGVja3BvaW50cyB5ZXMsIGRlYnVnIG1ldGFkYXRhIG5vXG4gICAgaW5jbHVkZURlYnVnTWV0YWRhdGE6IGZhbHNlLFxuICAgIGluY2x1ZGVFeGFtcGxlczogZmFsc2UsXG4gIH0gc2F0aXNmaWVzIE5vaXNlUmVkdWN0aW9uQ29uZmlnLFxuICAvLyBEeW5hbW9EQiBzaXplIG1hbmFnZW1lbnQgZGVmYXVsdHNcbiAgdHJ1bmNhdGlvbjoge1xuICAgIGVuYWJsZWQ6IGZhbHNlLCAgICAgICAgICAgICAvLyDinYwgT0ZGIGJ5IGRlZmF1bHQgLSBsb3NzeSwgb25seSBhcyBhbHRlcm5hdGl2ZVxuICAgIG1heEJ5dGVzOiAzNTAgKiAxMDI0LCAgICAgICAvLyAzNTBLQiBpZiBlbmFibGVkXG4gICAgZmllbGRzOiBbICdhY3RvcicsICdkYXRhJywgJ2F0dHJpYnV0ZXMnLCAnbWV0YWRhdGEnLCAnY29udGV4dCcgXSxcbiAgfSBzYXRpc2ZpZXMgVHJ1bmNhdGlvbkNvbmZpZyxcblxuICAvLyBEeW5hbW9EQiBvcGVyYXRpb25hbCBsaW1pdHNcbiAgZHluYW1vTWF4SXRlbVNpemU6IDQwMCAqIDEwMjQsICAgIC8vIDQwMEtCIC0gRHluYW1vREIgaGFyZCBsaW1pdFxuICBkeW5hbW9NYXhCYXRjaFNpemU6IDI1LCAgICAgICAgICAgLy8gMjUgLSBEeW5hbW9EQiBCYXRjaFdyaXRlSXRlbSBsaW1pdFxuICBkeW5hbW9NYXhCdWZmZXJTaXplOiAxMDAwLCAgICAgICAgLy8gMTAwMCAtIGZvcmNlIGZsdXNoIHNhZmV0eVxuXG4gIC8vIFBoYXNlIDI6IFRhZyBmaWx0ZXJpbmcgZGVmYXVsdHMgKGZyYW1ld29yay1sZXZlbClcbiAgdGFnRmlsdGVyaW5nOiB7XG4gICAgaW5jbHVkZTogWyAnc3RhZ2UnLCAndGVuYW50SWQnLCAnb3BlcmF0aW9uQ2F0ZWdvcnknIF0gYXMgc3RyaW5nW10sICAvLyBCYWxhbmNlZFxuICAgIG1heFRhZ3M6IDEwLFxuICB9LFxuICBtZXRyaWNGaWx0ZXJpbmc6IHtcbiAgICBlbmFibGVkOiBmYWxzZSwgICAgICAgICAgICAgICAgICAvLyBEaXNhYmxlZCBieSBkZWZhdWx0IChwdWJsaXNoIGFsbClcbiAgICBtb2RlOiAnd2hpdGVsaXN0JyBhcyBjb25zdCxcbiAgfSxcbiAgbWV0cmljU2FtcGxpbmc6IHtcbiAgICBlbmFibGVkOiBmYWxzZSwgICAgICAgICAgICAgICAgICAvLyBEaXNhYmxlZCBieSBkZWZhdWx0IChubyBzYW1wbGluZylcbiAgICByYXRlOiAwLjEsICAgICAgICAgICAgICAgICAgICAgICAvLyAxMCUgc2FtcGxlIHJhdGUgd2hlbiBlbmFibGVkXG4gICAgYWx3YXlzUHVibGlzaE9uOiAnYm90aCcgYXMgY29uc3QsIC8vIEFsd2F5cyBwdWJsaXNoIGVycm9ycyBhbmQgc2xvdyByZXF1ZXN0c1xuICAgIHRocmVzaG9sZHM6IHtcbiAgICAgIHNsb3dEdXJhdGlvbk1zOiAxMDAwLCAgICAgICAgICAvLyA+IDEgc2Vjb25kID0gc2xvd1xuICAgIH0sXG4gIH0sXG4gIC8vIFBoYXNlIDM6IENsb3VkV2F0Y2ggbmFtZXNwYWNlIGRlZmF1bHRzXG4gIGNsb3Vkd2F0Y2hOYW1lc3BhY2VTdHJhdGVneTogJ3NpbmdsZScgYXMgY29uc3QsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9PUEVSQVRJT05fTk9STUFMSVpBVElPTl9SVUxFUzogTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF0+WyAncnVsZXMnIF0gPSBbXG4gIHtcbiAgICBpZDogJ2Z3MjQuaHR0cC51dWlkJyxcbiAgICBtYXRjaDogJy9cXFxcYlswLTlhLWZdezh9LVswLTlhLWZdezR9LVswLTlhLWZdezR9LVswLTlhLWZdezR9LVswLTlhLWZdezEyfVxcXFxiL2dpJyxcbiAgICByZXBsYWNlOiAnOnV1aWQnLFxuICAgIHJlYXNvbjogJ1JlZHVjZSBjYXJkaW5hbGl0eSBieSBub3JtYWxpemluZyBVVUlEcyBpbiBvcGVyYXRpb24gbmFtZXMnLFxuICB9LFxuICB7XG4gICAgaWQ6ICdmdzI0Lmh0dHAuaGV4MTYnLFxuICAgIG1hdGNoOiAnL1xcXFxiWzAtOWEtZl17MTZ9XFxcXGIvZ2knLFxuICAgIHJlcGxhY2U6ICc6aWQnLFxuICAgIHJlYXNvbjogJ1JlZHVjZSBjYXJkaW5hbGl0eSBieSBub3JtYWxpemluZyAxNi1oZXggSURzIGluIG9wZXJhdGlvbiBuYW1lcycsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2Z3MjQuaHR0cC5udW1lcmljJyxcbiAgICBtYXRjaDogJy9cXFxcYlxcXFxkezQsfVxcXFxiL2cnLFxuICAgIHJlcGxhY2U6ICc6bicsXG4gICAgcmVhc29uOiAnUmVkdWNlIGNhcmRpbmFsaXR5IGJ5IG5vcm1hbGl6aW5nIGxhcmdlIG51bWVyaWMgSURzIGluIG9wZXJhdGlvbiBuYW1lcycsXG4gIH0sXG5dO1xuXG4vKipcbiAqIElucHV0IHR5cGUgZm9yIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgLSBhbGwgZmllbGRzIG9wdGlvbmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgT2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0IHtcbiAgZW5hYmxlZD86IGJvb2xlYW47XG4gIG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuICBzZXJ2aWNlTmFtZT86IHN0cmluZztcbiAgLyoqXG4gICAqIEJhY2tlbmQgY29uZmlncyAoaW5wdXQgZm9ybSkuXG4gICAqXG4gICAqIEFjY2VwdHMgZnVsbCBiYWNrZW5kIGNvbmZpZ3MgKGluY2x1ZGluZyBgdHlwZXNgIGZpbHRlcnMpIGJ1dCBhbGxvd3MgYGVuYWJsZWRgIHRvIGJlIG9taXR0ZWQuXG4gICAqIFRoaXMga2VlcHMgcHJlc2V0cyBhbmQgYXBwIGNvbmZpZ3MgZXhwcmVzc2l2ZSB3aXRob3V0IGNhc3RpbmcuXG4gICAqL1xuICBiYWNrZW5kcz86IE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnSW5wdXRbXTtcbiAgc2FtcGxpbmc/OiBQYXJ0aWFsPFNhbXBsaW5nQ29uZmlnPjtcbiAgY2xvdWR3YXRjaD86IFBhcnRpYWw8Q2xvdWRXYXRjaENvbmZpZz47XG4gIHRhZ0ZpbHRlcmluZz86IFBhcnRpYWw8VGFnRmlsdGVyaW5nQ29uZmlnPjtcbiAgZHluYW1vZGI/OiB7XG4gICAgLyoqIExvZ2ljYWwgdGFibGUga2V5IC0gcmVzb2x2ZWQgdG8gYWN0dWFsIHRhYmxlIG5hbWUgdmlhIGVudiB2YXIge3RhYmxlS2V5fV90YWJsZSAqL1xuICAgIHRhYmxlS2V5Pzogc3RyaW5nO1xuICAgIHR0bERheXM/OiBudW1iZXI7XG4gICAgLyoqIFRydW5jYXRpb24gY29uZmlndXJhdGlvbiAob3B0aW9uYWwgLSBsb3NzeSBmYWxsYmFjaykgKi9cbiAgICB0cnVuY2F0aW9uPzogUGFydGlhbDxUcnVuY2F0aW9uQ29uZmlnPjtcbiAgICAvKiogTWF4aW11bSBpdGVtIHNpemUgaW4gYnl0ZXMgKGRlZmF1bHQ6IDQwMEtCIC0gRHluYW1vREIgbGltaXQpICovXG4gICAgbWF4SXRlbVNpemU/OiBudW1iZXI7XG4gICAgLyoqIEJhdGNoIHdyaXRlIHNpemUgKGRlZmF1bHQ6IDI1IC0gRHluYW1vREIgQmF0Y2hXcml0ZUl0ZW0gbGltaXQpICovXG4gICAgbWF4QmF0Y2hTaXplPzogbnVtYmVyO1xuICAgIC8qKiBNYXhpbXVtIGJ1ZmZlciBzaXplIGJlZm9yZSBmb3JjaW5nIGZsdXNoIChkZWZhdWx0OiAxMDAwKSAqL1xuICAgIG1heEJ1ZmZlclNpemU/OiBudW1iZXI7XG4gIH07XG4gIGRhdGFQcm90ZWN0aW9uPzogUGFydGlhbDxEYXRhUHJvdGVjdGlvbkNvbmZpZz47XG4gIHR5cGVzPzogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdO1xuICBzb3VyY2VNYXA/OiB7XG4gICAgLyoqIEVuYWJsZSBzb3VyY2UtbWFwLXN1cHBvcnQgZm9yIGJldHRlciBlcnJvciBzdGFjayB0cmFjZXMgKHJlcXVpcmVzIHNvdXJjZS1tYXAtc3VwcG9ydCBwYWNrYWdlKSAqL1xuICAgIGVuYWJsZWQ/OiBib29sZWFuO1xuICB9O1xuICAvKipcbiAgICogU3Bhbi1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBzcGFucz86IHtcbiAgICAvKiogU2tpcCBzcGFucyBmYXN0ZXIgdGhhbiB0aGlzIChtcykuIERlZmF1bHQ6IDUwICovXG4gICAgbWluRHVyYXRpb25Ncz86IG51bWJlcjtcbiAgICAvKiogU2tpcCBzcGFucyB3aXRoIG5vIGV2ZW50cy9lcnJvcnMuIERlZmF1bHQ6IHRydWUgKi9cbiAgICBza2lwRW1wdHk/OiBib29sZWFuO1xuICB9O1xuXG4gIC8qKlxuICAgKiBRdWVyeSBwZXJmb3JtYW5jZSB0cmFja2luZyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBxdWVyeVBlcmZvcm1hbmNlPzogUGFydGlhbDxRdWVyeVBlcmZvcm1hbmNlQ29uZmlnPjtcblxuICAvKipcbiAgICogTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb24gKG1lcmdlL2Ryb3AvYWdncmVnYXRlKS5cbiAgICovXG4gIG5vaXNlUmVkdWN0aW9uPzogUGFydGlhbDxOb2lzZVJlZHVjdGlvbkNvbmZpZz47XG5cbiAgLyoqXG4gICAqIE9wZXJhdGlvbiBub3JtYWxpemF0aW9uIC8gcmVuYW1pbmcuXG4gICAqL1xuICBvcGVyYXRpb25Ob3JtYWxpemF0aW9uPzogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF07XG59XG5cbnR5cGUgV2l0aE9wdGlvbmFsRW5hYmxlZDxUPiA9XG4gIFQgZXh0ZW5kcyB7IGVuYWJsZWQ6IGJvb2xlYW4gfVxuICA/IChPbWl0PFQsICdlbmFibGVkJz4gJiB7IGVuYWJsZWQ/OiBib29sZWFuIH0pXG4gIDogVDtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWdJbnB1dCA9IFdpdGhPcHRpb25hbEVuYWJsZWQ8T2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWc+O1xuXG4vKipcbiAqIEV4dGVuZCBhIHByZXNldCB3aXRoIHRhcmdldGVkIG92ZXJyaWRlcy5cbiAqIFxuICogVXNlcyBmcmFtZXdvcmsncyBkZWVwIG1lcmdlIHV0aWxpdHkgZm9yIGNsZWFuIGNvbmZpZyBjb21wb3NpdGlvbi5cbiAqIFxuICogQHBhcmFtIHByZXNldCAtIEJhc2UgcHJlc2V0IGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBvdmVycmlkZXMgLSBUYXJnZXRlZCBvdmVycmlkZXMgdG8gYXBwbHlcbiAqIEByZXR1cm5zIENvbXBsZXRlIG1lcmdlZCBjb25maWd1cmF0aW9uXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBleHRlbmRQcmVzZXQsIHByb2R1Y3Rpb25QcmVzZXQgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0JztcbiAqIFxuICogRElDb250YWluZXIuUk9PVC5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAqICAgcHJvdmlkZTogJ29ic2VydmFiaWxpdHknLFxuICogICB1c2VDb25maWc6IGV4dGVuZFByZXNldChwcm9kdWN0aW9uUHJlc2V0LCB7XG4gKiAgICAgc2VydmljZU5hbWU6ICdteS1hcHAnLFxuICogICAgIGNsb3Vkd2F0Y2g6IHsgbmFtZXNwYWNlOiAnTXlBcHAnIH0sXG4gKiAgICAgZGF0YVByb3RlY3Rpb246IHtcbiAqICAgICAgIGJsYWNrbGlzdGVkS2V5czogWydhcGlLZXknXSAvLyBNZXJnZWQgd2l0aCBwcmVzZXRcbiAqICAgICB9LFxuICogICAgIHNhbXBsaW5nOiB7IG1heEJ1ZmZlclNpemU6IDUwMDAgfSAvLyBNZXJnZWQgd2l0aCBwcmVzZXRcbiAqICAgfSksXG4gKiAgIHByaW9yaXR5OiAxMFxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dGVuZFByZXNldChcbiAgcHJlc2V0OiBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBvdmVycmlkZXM6IERlZXBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWdJbnB1dD5cbik6IE9ic2VydmFiaWxpdHlDb25maWcge1xuICBjb25zdCBtZXJnZWQgPSBtZXJnZShbIHByZXNldCwgb3ZlcnJpZGVzIF0pITtcbiAgcmV0dXJuIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcobWVyZ2VkKTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBjb21wbGV0ZSwgdmFsaWRhdGVkIE9ic2VydmFiaWxpdHlDb25maWcgZnJvbSBwYXJ0aWFsIGlucHV0XG4gKiBcbiAqIEBwYXJhbSBpbnB1dCAtIFBhcnRpYWwgY29uZmlnIGZyb20gYXBwbGljYXRpb25cbiAqIEByZXR1cm5zIENvbXBsZXRlIE9ic2VydmFiaWxpdHlDb25maWcgd2l0aCBkZWZhdWx0cyBtZXJnZWRcbiAqIEB0aHJvd3MgRXJyb3IgaWYgdmFsaWRhdGlvbiBmYWlsc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gSW4geW91ciBhcHAncyBkaS50czpcbiAqIGltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNCc7XG4gKiBpbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNC9vYnNlcnZhYmlsaXR5JztcbiAqIFxuICogRElDb250YWluZXIuUk9PVC5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAqICAgcHJvdmlkZTogJ29ic2VydmFiaWxpdHknLFxuICogICB1c2VDb25maWc6IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICogICAgIHNlcnZpY2VOYW1lOiAnbXktYXBwJyxcbiAqICAgICBiYWNrZW5kczogW3sgdHlwZTogJ2Nsb3Vkd2F0Y2gnIH0sIHsgdHlwZTogJ2R5bmFtb2RiJyB9XSxcbiAqICAgICAvLyB0YWJsZUtleSBkZWZhdWx0cyB0byAnb2JzZXJ2YWJpbGl0eWxvZ3MnXG4gKiAgIH0pLFxuICogICBwcmlvcml0eTogMTBcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKGlucHV0OiBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQ+ID0ge30pOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgY29uc3Qgc2VydmljZU5hbWUgPSBpbnB1dC5zZXJ2aWNlTmFtZSA/PyBDT05GSUdfREVGQVVMVFMuc2VydmljZU5hbWU7XG4gIGNvbnN0IG1pbkxldmVsID0gaW5wdXQubWluTGV2ZWwgPz8gQ09ORklHX0RFRkFVTFRTLm1pbkxldmVsO1xuXG4gIGNvbnN0IGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IHtcbiAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IENPTkZJR19ERUZBVUxUUy5lbmFibGVkLFxuICAgIG1pbkxldmVsLFxuICAgIHNlcnZpY2VOYW1lLFxuICAgIGJhY2tlbmRzOiBub3JtYWxpemVCYWNrZW5kcyhpbnB1dC5iYWNrZW5kcyksXG4gICAgc2FtcGxpbmc6IG5vcm1hbGl6ZVNhbXBsaW5nKGlucHV0LnNhbXBsaW5nKSxcbiAgICBjbG91ZHdhdGNoOiBub3JtYWxpemVDbG91ZFdhdGNoKGlucHV0LmNsb3Vkd2F0Y2gpLFxuICAgIGR5bmFtb2RiOiBub3JtYWxpemVEeW5hbW9EYihpbnB1dC5keW5hbW9kYiksXG4gICAgZGF0YVByb3RlY3Rpb246IG5vcm1hbGl6ZURhdGFQcm90ZWN0aW9uKGlucHV0LmRhdGFQcm90ZWN0aW9uKSxcbiAgICBzb3VyY2VNYXA6IHsgZW5hYmxlZDogaW5wdXQuc291cmNlTWFwPy5lbmFibGVkID8/IENPTkZJR19ERUZBVUxUUy5zb3VyY2VNYXBFbmFibGVkIH0sXG4gICAgdHlwZXM6IG5vcm1hbGl6ZVR5cGVzKGlucHV0LnR5cGVzKSxcbiAgICBzcGFuczogbm9ybWFsaXplU3BhbkNvbmZpZyhpbnB1dC5zcGFucyksXG4gICAgdGFnRmlsdGVyaW5nOiBub3JtYWxpemVUYWdGaWx0ZXJpbmcoaW5wdXQudGFnRmlsdGVyaW5nKSxcbiAgICBxdWVyeVBlcmZvcm1hbmNlOiBub3JtYWxpemVRdWVyeVBlcmZvcm1hbmNlQ29uZmlnKGlucHV0LnF1ZXJ5UGVyZm9ybWFuY2UpLFxuICAgIC8vIENlbnRyYWxpemVkIGRlZmF1bHRzOiBub2lzZVJlZHVjdGlvbiBpcyBhbHdheXMgcHJlc2VudCAoZW5hYmxlZCBjYW4gYmUgdG9nZ2xlZCBwZXIgcHJlc2V0L2FwcCkuXG4gICAgbm9pc2VSZWR1Y3Rpb246IG5vcm1hbGl6ZU5vaXNlUmVkdWN0aW9uKGlucHV0Lm5vaXNlUmVkdWN0aW9uLCBtaW5MZXZlbCksXG4gICAgb3BlcmF0aW9uTm9ybWFsaXphdGlvbjogbm9ybWFsaXplT3BlcmF0aW9uTm9ybWFsaXphdGlvbihpbnB1dC5vcGVyYXRpb25Ob3JtYWxpemF0aW9uKSxcbiAgfTtcblxuICAvLyBWYWxpZGF0ZVxuICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb2JzZXJ2YWJpbGl0eSBjb25maWc6ICR7ZXJyb3JzLmpvaW4oJywgJyl9YCk7XG4gIH1cblxuICByZXR1cm4gY29uZmlnO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVTYW1wbGluZyhpbnB1dD86IERlZXBQYXJ0aWFsPFNhbXBsaW5nQ29uZmlnPik6IFNhbXBsaW5nQ29uZmlnIHtcbiAgY29uc3Qgb3BlcmF0aW9uc0luID0gaW5wdXQ/Lm9wZXJhdGlvbnM7XG4gIGNvbnN0IG9wZXJhdGlvbnM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQgPSBpc1JlY29yZChvcGVyYXRpb25zSW4pXG4gICAgPyAoKCkgPT4ge1xuICAgICAgY29uc3Qgb3V0OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKG9wZXJhdGlvbnNJbikpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgb3V0WyBrIF0gPSB2O1xuICAgICAgfVxuICAgICAgcmV0dXJuIG91dDtcbiAgICB9KSgpXG4gICAgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgcmF0ZXNJbiA9IGlucHV0Py5yYXRlcztcbiAgY29uc3QgcmF0ZXM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQgPSBpc1JlY29yZChyYXRlc0luKVxuICAgID8gKCgpID0+IHtcbiAgICAgIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhyYXRlc0luKSkge1xuICAgICAgICBpZiAodHlwZW9mIHYgPT09ICdudW1iZXInKSBvdXRbIGsgXSA9IHY7XG4gICAgICB9XG4gICAgICByZXR1cm4gb3V0O1xuICAgIH0pKClcbiAgICA6IHVuZGVmaW5lZDtcblxuICBjb25zdCBpc1NhbXBsaW5nVGFyZ2V0ID0gKHY6IHVua25vd24pOiB2IGlzIFNhbXBsaW5nUnVsZVsgJ3RhcmdldCcgXSA9PlxuICAgIHYgPT09ICdzb3VyY2UnIHx8IHYgPT09ICd0ZW5hbnQnIHx8IHYgPT09ICdyb3V0ZScgfHwgdiA9PT0gJ3RhZycgfHwgdiA9PT0gJ2FjdG9yJztcblxuICBjb25zdCBpc1NhbXBsaW5nUnVsZSA9ICh2OiB1bmtub3duKTogdiBpcyBTYW1wbGluZ1J1bGUgPT4ge1xuICAgIGlmICghaXNSZWNvcmQodikpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoIWlzU2FtcGxpbmdUYXJnZXQodi50YXJnZXQpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCEodHlwZW9mIHYucGF0dGVybiA9PT0gJ3N0cmluZycgfHwgdi5wYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh0eXBlb2Ygdi5yYXRlICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIGNvbnN0IHJ1bGVzOiBTYW1wbGluZ1J1bGVbXSB8IHVuZGVmaW5lZCA9IEFycmF5LmlzQXJyYXkoaW5wdXQ/LnJ1bGVzKVxuICAgID8gaW5wdXQucnVsZXMuZmlsdGVyKGlzU2FtcGxpbmdSdWxlKVxuICAgIDogdW5kZWZpbmVkO1xuXG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogaW5wdXQ/LmVuYWJsZWQgPz8gZmFsc2UsXG4gICAgc21hcnQ6IGlucHV0Py5zbWFydCxcbiAgICBtYXhCdWZmZXJTaXplOiBpbnB1dD8ubWF4QnVmZmVyU2l6ZSxcbiAgICBtaW5MZXZlbE9uRXJyb3I6IGlucHV0Py5taW5MZXZlbE9uRXJyb3IsXG4gICAgcmF0ZXMsXG4gICAgb3BlcmF0aW9ucyxcbiAgICBydWxlcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVHlwZVNwZWNpZmljQ29uZmlnKGlucHV0PzogRGVlcFBhcnRpYWw8VHlwZVNwZWNpZmljQ29uZmlnPik6IFR5cGVTcGVjaWZpY0NvbmZpZyB8IHVuZGVmaW5lZCB7XG4gIGlmICghaW5wdXQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICghaXNSZWNvcmQoaW5wdXQpKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIGNvbnN0IHNhbXBsaW5nSW4gPSBpbnB1dC5zYW1wbGluZztcbiAgbGV0IHNhbXBsaW5nOiBUeXBlU3BlY2lmaWNDb25maWdbICdzYW1wbGluZycgXSB8IHVuZGVmaW5lZDtcbiAgaWYgKHNhbXBsaW5nSW4gIT09IHVuZGVmaW5lZCkge1xuICAgIGlmICghaXNSZWNvcmQoc2FtcGxpbmdJbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBvYnNlcnZhYmlsaXR5LnR5cGVzLiouc2FtcGxpbmc6IG11c3QgYmUgYW4gb2JqZWN0Jyk7XG4gICAgfVxuICAgIGlmICh0eXBlb2Ygc2FtcGxpbmdJbi5lbmFibGVkICE9PSAnYm9vbGVhbicgfHwgdHlwZW9mIHNhbXBsaW5nSW4ucmF0ZSAhPT0gJ251bWJlcicpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBvYnNlcnZhYmlsaXR5LnR5cGVzLiouc2FtcGxpbmc6IHJlcXVpcmVzIHsgZW5hYmxlZDogYm9vbGVhbiwgcmF0ZTogbnVtYmVyIH0nKTtcbiAgICB9XG4gICAgc2FtcGxpbmcgPSB7IGVuYWJsZWQ6IHNhbXBsaW5nSW4uZW5hYmxlZCwgcmF0ZTogc2FtcGxpbmdJbi5yYXRlIH07XG4gIH1cblxuICB0eXBlIEJhY2tlbmROYW1lID0gJ2Nsb3Vkd2F0Y2gnIHwgJ2R5bmFtb2RiJyB8ICdvdGVsJztcbiAgY29uc3QgaXNWYWxpZEJhY2tlbmQgPSAodjogdW5rbm93bik6IHYgaXMgQmFja2VuZE5hbWUgPT5cbiAgICB2ID09PSAnY2xvdWR3YXRjaCcgfHwgdiA9PT0gJ2R5bmFtb2RiJyB8fCB2ID09PSAnb3RlbCc7XG5cbiAgY29uc3QgYmFja2VuZHMgPSBBcnJheS5pc0FycmF5KGlucHV0LmJhY2tlbmRzKVxuICAgID8gaW5wdXQuYmFja2VuZHMuZmlsdGVyKGlzVmFsaWRCYWNrZW5kKVxuICAgIDogdW5kZWZpbmVkO1xuXG4gIHJldHVybiB7XG4gICAgYmFja2VuZHMsXG4gICAgbWluTGV2ZWw6IGlucHV0Lm1pbkxldmVsLFxuICAgIHNhbXBsaW5nLFxuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVUeXBlcyhpbnB1dD86IERlZXBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWdbICd0eXBlcycgXT4pOiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAndHlwZXMnIF0ge1xuICBpZiAoIWlucHV0IHx8ICFpc1JlY29yZChpbnB1dCkpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHNwYW4gPSBub3JtYWxpemVUeXBlU3BlY2lmaWNDb25maWcoaW5wdXQuc3Bhbik7XG4gIGNvbnN0IG1ldHJpYyA9IG5vcm1hbGl6ZVR5cGVTcGVjaWZpY0NvbmZpZyhpbnB1dC5tZXRyaWMpO1xuICBjb25zdCBhdWRpdCA9IG5vcm1hbGl6ZVR5cGVTcGVjaWZpY0NvbmZpZyhpbnB1dC5hdWRpdCk7XG4gIGNvbnN0IGxvZyA9IG5vcm1hbGl6ZVR5cGVTcGVjaWZpY0NvbmZpZyhpbnB1dC5sb2cpO1xuICBpZiAoIXNwYW4gJiYgIW1ldHJpYyAmJiAhYXVkaXQgJiYgIWxvZykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHsgc3BhbiwgbWV0cmljLCBhdWRpdCwgbG9nIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNsb3VkV2F0Y2goaW5wdXQ/OiBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQ+WyAnY2xvdWR3YXRjaCcgXSk6IE9ic2VydmFiaWxpdHlDb25maWdbICdjbG91ZHdhdGNoJyBdIHtcbiAgY29uc3QgbmFtZXNwYWNlU3RyYXRlZ3kgPSBpbnB1dD8ubmFtZXNwYWNlU3RyYXRlZ3kgYXMgTmFtZXNwYWNlU3RyYXRlZ3kgfCB1bmRlZmluZWQ7XG4gIGNvbnN0IG9wZXJhdGlvblJ1bGVzID0gaW5wdXQ/Lm1ldHJpY0ZpbHRlcmluZz8ub3BlcmF0aW9uUnVsZXMgYXMgT3BlcmF0aW9uTWV0cmljUnVsZVtdIHwgdW5kZWZpbmVkO1xuXG4gIHJldHVybiB7XG4gICAgbmFtZXNwYWNlOiBpbnB1dD8ubmFtZXNwYWNlID8/IENPTkZJR19ERUZBVUxUUy5jbG91ZHdhdGNoTmFtZXNwYWNlLFxuICAgIG5hbWVzcGFjZVN0cmF0ZWd5OiBuYW1lc3BhY2VTdHJhdGVneSA/PyBDT05GSUdfREVGQVVMVFMuY2xvdWR3YXRjaE5hbWVzcGFjZVN0cmF0ZWd5LFxuICAgIG1ldHJpY0ZpbHRlcmluZzoge1xuICAgICAgZW5hYmxlZDogaW5wdXQ/Lm1ldHJpY0ZpbHRlcmluZz8uZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMubWV0cmljRmlsdGVyaW5nLmVuYWJsZWQsXG4gICAgICBtb2RlOiBpbnB1dD8ubWV0cmljRmlsdGVyaW5nPy5tb2RlID8/IENPTkZJR19ERUZBVUxUUy5tZXRyaWNGaWx0ZXJpbmcubW9kZSxcbiAgICAgIHdoaXRlbGlzdDogaW5wdXQ/Lm1ldHJpY0ZpbHRlcmluZz8ud2hpdGVsaXN0LFxuICAgICAgYmxhY2tsaXN0OiBpbnB1dD8ubWV0cmljRmlsdGVyaW5nPy5ibGFja2xpc3QsXG4gICAgICBwYXR0ZXJuczogaW5wdXQ/Lm1ldHJpY0ZpbHRlcmluZz8ucGF0dGVybnMsXG4gICAgICBvcGVyYXRpb25SdWxlcyxcbiAgICB9LFxuICAgIG1ldHJpY1NhbXBsaW5nOiB7XG4gICAgICBlbmFibGVkOiBpbnB1dD8ubWV0cmljU2FtcGxpbmc/LmVuYWJsZWQgPz8gQ09ORklHX0RFRkFVTFRTLm1ldHJpY1NhbXBsaW5nLmVuYWJsZWQsXG4gICAgICByYXRlOiBpbnB1dD8ubWV0cmljU2FtcGxpbmc/LnJhdGUgPz8gQ09ORklHX0RFRkFVTFRTLm1ldHJpY1NhbXBsaW5nLnJhdGUsXG4gICAgICBhbHdheXNQdWJsaXNoT246IGlucHV0Py5tZXRyaWNTYW1wbGluZz8uYWx3YXlzUHVibGlzaE9uID8/IENPTkZJR19ERUZBVUxUUy5tZXRyaWNTYW1wbGluZy5hbHdheXNQdWJsaXNoT24sXG4gICAgICB0aHJlc2hvbGRzOiB7XG4gICAgICAgIHNsb3dEdXJhdGlvbk1zOiBpbnB1dD8ubWV0cmljU2FtcGxpbmc/LnRocmVzaG9sZHM/LnNsb3dEdXJhdGlvbk1zID8/IENPTkZJR19ERUZBVUxUUy5tZXRyaWNTYW1wbGluZy50aHJlc2hvbGRzLnNsb3dEdXJhdGlvbk1zLFxuICAgICAgfSxcbiAgICAgIG5ldmVyU2FtcGxlOiBpbnB1dD8ubWV0cmljU2FtcGxpbmc/Lm5ldmVyU2FtcGxlLFxuICAgICAgYWx3YXlzU2FtcGxlOiBpbnB1dD8ubWV0cmljU2FtcGxpbmc/LmFsd2F5c1NhbXBsZSxcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVUYWdGaWx0ZXJpbmcoaW5wdXQ/OiBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQ+WyAndGFnRmlsdGVyaW5nJyBdKTogVGFnRmlsdGVyaW5nQ29uZmlnIHtcbiAgY29uc3QgY3VzdG9tVGFncyA9IGlucHV0Py5jdXN0b20gYXMgUmVjb3JkPHN0cmluZywgKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IHN0cmluZz4gfCB1bmRlZmluZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBpbmNsdWRlOiBpbnB1dD8uaW5jbHVkZSA/PyBDT05GSUdfREVGQVVMVFMudGFnRmlsdGVyaW5nLmluY2x1ZGUsXG4gICAgY3VzdG9tOiBjdXN0b21UYWdzLFxuICAgIG1heFRhZ3M6IGlucHV0Py5tYXhUYWdzID8/IENPTkZJR19ERUZBVUxUUy50YWdGaWx0ZXJpbmcubWF4VGFncyxcbiAgfTtcbn1cblxuXG5mdW5jdGlvbiBub3JtYWxpemVEeW5hbW9EYihpbnB1dD86IE9ic2VydmFiaWxpdHlDb25maWdJbnB1dFsgJ2R5bmFtb2RiJyBdKTogRHluYW1vREJDb25maWcge1xuICByZXR1cm4ge1xuICAgIHRhYmxlS2V5OiBpbnB1dD8udGFibGVLZXkgPz8gQ09ORklHX0RFRkFVTFRTLnRhYmxlS2V5LFxuICAgIHR0bERheXM6IGlucHV0Py50dGxEYXlzID8/IENPTkZJR19ERUZBVUxUUy50dGxEYXlzLFxuICAgIHRydW5jYXRpb246IHtcbiAgICAgIGVuYWJsZWQ6IGlucHV0Py50cnVuY2F0aW9uPy5lbmFibGVkID8/IENPTkZJR19ERUZBVUxUUy50cnVuY2F0aW9uLmVuYWJsZWQsXG4gICAgICBtYXhCeXRlczogaW5wdXQ/LnRydW5jYXRpb24/Lm1heEJ5dGVzID8/IENPTkZJR19ERUZBVUxUUy50cnVuY2F0aW9uLm1heEJ5dGVzLFxuICAgICAgZmllbGRzOiBpbnB1dD8udHJ1bmNhdGlvbj8uZmllbGRzID8/IFsgLi4uQ09ORklHX0RFRkFVTFRTLnRydW5jYXRpb24uZmllbGRzIF0sXG4gICAgfSxcbiAgICBtYXhJdGVtU2l6ZTogaW5wdXQ/Lm1heEl0ZW1TaXplID8/IENPTkZJR19ERUZBVUxUUy5keW5hbW9NYXhJdGVtU2l6ZSxcbiAgICBtYXhCYXRjaFNpemU6IGlucHV0Py5tYXhCYXRjaFNpemUgPz8gQ09ORklHX0RFRkFVTFRTLmR5bmFtb01heEJhdGNoU2l6ZSxcbiAgICBtYXhCdWZmZXJTaXplOiBpbnB1dD8ubWF4QnVmZmVyU2l6ZSA/PyBDT05GSUdfREVGQVVMVFMuZHluYW1vTWF4QnVmZmVyU2l6ZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRGF0YVByb3RlY3Rpb24oaW5wdXQ/OiBEZWVwUGFydGlhbDxEYXRhUHJvdGVjdGlvbkNvbmZpZz4pOiBEYXRhUHJvdGVjdGlvbkNvbmZpZyB7XG4gIGNvbnN0IGJsYWNrbGlzdGVkS2V5cyA9IEFycmF5LmlzQXJyYXkoaW5wdXQ/LmJsYWNrbGlzdGVkS2V5cylcbiAgICA/IGlucHV0LmJsYWNrbGlzdGVkS2V5cy5maWx0ZXIoKGs6IHVua25vd24pOiBrIGlzIHN0cmluZyB8IFJlZ0V4cCA9PiBrICE9PSB1bmRlZmluZWQgJiYgayAhPT0gbnVsbClcbiAgICA6IERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUztcbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBpbnB1dD8uZW5hYmxlZCA/PyB0cnVlLFxuICAgIGJsYWNrbGlzdGVkS2V5cyxcbiAgICBmdXp6eUtleU1hdGNoOiBpbnB1dD8uZnV6enlLZXlNYXRjaCA/PyB0cnVlLFxuICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogaW5wdXQ/LmNhc2VTZW5zaXRpdmVLZXlNYXRjaCA/PyBmYWxzZSxcbiAgICByZXBsYWNlbWVudDogaW5wdXQ/LnJlcGxhY2VtZW50ID8/ICdbUkVEQUNURURdJyxcbiAgICBmaWVsZHM6IGlucHV0Py5maWVsZHMgPz8gWyAnZGF0YScsICdhdHRyaWJ1dGVzJywgJ21ldGFkYXRhJywgJ2NvbnRleHQnIF0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNwYW5Db25maWcoaW5wdXQ/OiB7IG1pbkR1cmF0aW9uTXM/OiBudW1iZXI7IHNraXBFbXB0eT86IGJvb2xlYW4gfSk6IE9ic2VydmFiaWxpdHlDb25maWdbICdzcGFucycgXSB7XG4gIHJldHVybiB7XG4gICAgbWluRHVyYXRpb25NczogaW5wdXQ/Lm1pbkR1cmF0aW9uTXMgPz8gQ09ORklHX0RFRkFVTFRTLnNwYW5zLm1pbkR1cmF0aW9uTXMsXG4gICAgc2tpcEVtcHR5OiBpbnB1dD8uc2tpcEVtcHR5ID8/IENPTkZJR19ERUZBVUxUUy5zcGFucy5za2lwRW1wdHksXG4gIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU5vaXNlUmVkdWN0aW9uKFxuICBpbnB1dD86IERlZXBQYXJ0aWFsPE5vaXNlUmVkdWN0aW9uQ29uZmlnPixcbiAgZ2xvYmFsTWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWxcbik6IE5vaXNlUmVkdWN0aW9uQ29uZmlnIHtcbiAgY29uc3QgZCA9IENPTkZJR19ERUZBVUxUUy5ub2lzZVJlZHVjdGlvbjtcbiAgY29uc3QgcHJlc2V0cyA9IEFycmF5LmlzQXJyYXkoaW5wdXQ/LnByZXNldHMpXG4gICAgPyBpbnB1dC5wcmVzZXRzLmZpbHRlcigocCk6IHAgaXMgTm9pc2VSZWR1Y3Rpb25Db25maWdbICdwcmVzZXRzJyBdWyBudW1iZXIgXSA9PiB0eXBlb2YgcCA9PT0gJ3N0cmluZycpXG4gICAgOiBkLnByZXNldHM7XG5cbiAgY29uc3QgcnVsZXMgPSBBcnJheS5pc0FycmF5KGlucHV0Py5ydWxlcylcbiAgICA/IGlucHV0LnJ1bGVzLmZpbHRlcigocik6IHIgaXMgTm9pc2VSZWR1Y3Rpb25Db25maWdbICdydWxlcycgXVsgbnVtYmVyIF0gPT4ge1xuICAgICAgcmV0dXJuIGlzUmVjb3JkKHIpXG4gICAgICAgICYmIHR5cGVvZiByLmlkID09PSAnc3RyaW5nJ1xuICAgICAgICAmJiB0eXBlb2Ygci5kZWNpc2lvbiA9PT0gJ3N0cmluZydcbiAgICAgICAgJiYgaXNSZWNvcmQoci5tYXRjaCk7XG4gICAgfSlcbiAgICA6IGQucnVsZXM7XG5cbiAgLy8gTm9ybWFsaXplIGhhcmRTaWduYWxzIHRvIGVuc3VyZSBzbG93VGhyZXNob2xkcyBoYXMgbm8gdW5kZWZpbmVkIHZhbHVlc1xuICBjb25zdCBoYXJkU2lnbmFsczogSGFyZFNpZ25hbENvbmZpZyB8IHVuZGVmaW5lZCA9IGlucHV0Py5oYXJkU2lnbmFscyA/IHtcbiAgICBsZXZlbHM6IGlucHV0LmhhcmRTaWduYWxzLmxldmVscyxcbiAgICBpbmNsdWRlV2FybjogaW5wdXQuaGFyZFNpZ25hbHMuaW5jbHVkZVdhcm4sXG4gICAgc2xvd1RocmVzaG9sZE1zOiBpbnB1dC5oYXJkU2lnbmFscy5zbG93VGhyZXNob2xkTXMsXG4gICAgc2xvd1RocmVzaG9sZHM6IGlucHV0LmhhcmRTaWduYWxzLnNsb3dUaHJlc2hvbGRzXG4gICAgICA/IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoaW5wdXQuaGFyZFNpZ25hbHMuc2xvd1RocmVzaG9sZHMpLmZpbHRlcigoWyBfLCB2IF0pID0+IHYgIT09IHVuZGVmaW5lZClcbiAgICAgICkgYXMgUmVjb3JkPHN0cmluZywgbnVtYmVyPlxuICAgICAgOiB1bmRlZmluZWQsXG4gIH0gOiBkLmhhcmRTaWduYWxzO1xuXG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogaW5wdXQ/LmVuYWJsZWQgPz8gZC5lbmFibGVkLFxuICAgIG1pbkxldmVsOiBpbnB1dD8ubWluTGV2ZWwgPz8gZ2xvYmFsTWluTGV2ZWwsXG4gICAgaGFyZFNpZ25hbHMsXG4gICAgcHJlc2V0cyxcbiAgICBydWxlcyxcbiAgICBlbWl0U3VtbWFyaWVzOiBpbnB1dD8uZW1pdFN1bW1hcmllcyA/PyBkLmVtaXRTdW1tYXJpZXMsXG4gICAgbWF4Q2hlY2twb2ludHNQZXJTcGFuOiBpbnB1dD8ubWF4Q2hlY2twb2ludHNQZXJTcGFuID8/IGQubWF4Q2hlY2twb2ludHNQZXJTcGFuLFxuICAgIG1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuOiBpbnB1dD8ubWF4QWdncmVnYXRlS2V5c1BlclNwYW4gPz8gZC5tYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbixcbiAgICBtYXhBZ2dyZWdhdGVFeGFtcGxlc1BlcktleTogaW5wdXQ/Lm1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5ID8/IGQubWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXksXG4gICAgbWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleTogaW5wdXQ/Lm1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXkgPz8gZC5tYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5LFxuICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiBpbnB1dD8uaW5jbHVkZURlYnVnTWV0YWRhdGEgPz8gZC5pbmNsdWRlRGVidWdNZXRhZGF0YSxcbiAgICBpbmNsdWRlRXhhbXBsZXM6IGlucHV0Py5pbmNsdWRlRXhhbXBsZXMgPz8gZC5pbmNsdWRlRXhhbXBsZXMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU9wZXJhdGlvbk5vcm1hbGl6YXRpb24oXG4gIGlucHV0PzogRGVlcFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF0+XG4pOiBOb25OdWxsYWJsZTxPYnNlcnZhYmlsaXR5Q29uZmlnWyAnb3BlcmF0aW9uTm9ybWFsaXphdGlvbicgXT4ge1xuICBjb25zdCBydWxlcyA9IEFycmF5LmlzQXJyYXkoaW5wdXQ/LnJ1bGVzKVxuICAgID8gaW5wdXQucnVsZXMuZmlsdGVyKChyKTogciBpcyBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnb3BlcmF0aW9uTm9ybWFsaXphdGlvbicgXVsgJ3J1bGVzJyBdWyBudW1iZXIgXSA9PiB7XG4gICAgICByZXR1cm4gaXNSZWNvcmQocilcbiAgICAgICAgJiYgdHlwZW9mIHIuaWQgPT09ICdzdHJpbmcnXG4gICAgICAgICYmIHR5cGVvZiByLm1hdGNoID09PSAnc3RyaW5nJ1xuICAgICAgICAmJiB0eXBlb2Ygci5yZXBsYWNlID09PSAnc3RyaW5nJztcbiAgICB9KVxuICAgIDogREVGQVVMVF9PUEVSQVRJT05fTk9STUFMSVpBVElPTl9SVUxFUztcblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGlucHV0Py5lbmFibGVkID8/IENPTkZJR19ERUZBVUxUUy5vcGVyYXRpb25Ob3JtYWxpemF0aW9uLmVuYWJsZWQsXG4gICAgcnVsZXMsXG4gICAgc3RvcmVPcmlnaW5hbDogaW5wdXQ/LnN0b3JlT3JpZ2luYWwgPz8gQ09ORklHX0RFRkFVTFRTLm9wZXJhdGlvbk5vcm1hbGl6YXRpb24uc3RvcmVPcmlnaW5hbCxcbiAgfTtcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgcXVlcnkgcGVyZm9ybWFuY2UgY29uZmlndXJhdGlvblxuICovXG5mdW5jdGlvbiBub3JtYWxpemVRdWVyeVBlcmZvcm1hbmNlQ29uZmlnKGlucHV0PzogRGVlcFBhcnRpYWw8UXVlcnlQZXJmb3JtYW5jZUNvbmZpZz4pOiBRdWVyeVBlcmZvcm1hbmNlQ29uZmlnIHtcbiAgY29uc3QgZCA9IENPTkZJR19ERUZBVUxUUy5xdWVyeVBlcmZvcm1hbmNlO1xuXG4gIC8vIENhc3QgcmVhZG9ubHkgZGVmYXVsdCB0byBtdXRhYmxlIG9yIHVzZSBpbnB1dFxuICBjb25zdCBvcGVyYXRpb25UaHJlc2hvbGRzID0gKGlucHV0Py5vcGVyYXRpb25UaHJlc2hvbGRzXG4gICAgPyBpbnB1dC5vcGVyYXRpb25UaHJlc2hvbGRzLmZpbHRlcigodCk6IHQgaXMgT3BlcmF0aW9uVGltaW5nQ29uZmlnID0+ICEhdCAmJiAhIXQub3BlcmF0aW9uICYmIHR5cGVvZiB0LnNsb3dUaHJlc2hvbGQgPT09ICdudW1iZXInKVxuICAgIDogZC5vcGVyYXRpb25UaHJlc2hvbGRzKSBhcyBPcGVyYXRpb25UaW1pbmdDb25maWdbXTtcblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGlucHV0Py5lbmFibGVkID8/IGQuZW5hYmxlZCxcbiAgICBzbG93VGhyZXNob2xkOiBpbnB1dD8uc2xvd1RocmVzaG9sZCA/PyBkLnNsb3dUaHJlc2hvbGQsXG4gICAgZmFzdFF1ZXJ5U2FtcGxlUmF0ZTogaW5wdXQ/LmZhc3RRdWVyeVNhbXBsZVJhdGUgPz8gZC5mYXN0UXVlcnlTYW1wbGVSYXRlLFxuICAgIHNsb3dRdWVyeVNhbXBsZVJhdGU6IGlucHV0Py5zbG93UXVlcnlTYW1wbGVSYXRlID8/IGQuc2xvd1F1ZXJ5U2FtcGxlUmF0ZSxcbiAgICBvcGVyYXRpb25UaHJlc2hvbGRzLFxuICAgIGVudGl0eU92ZXJyaWRlczogaW5wdXQ/LmVudGl0eU92ZXJyaWRlcyBhcyBFbnRpdHlRdWVyeVRpbWluZ092ZXJyaWRlW10gfCB1bmRlZmluZWQsXG4gICAgZXhjbHVkZUVudGl0aWVzOiBpbnB1dD8uZXhjbHVkZUVudGl0aWVzIGFzIHN0cmluZ1tdIHwgdW5kZWZpbmVkLFxuICAgIGFsd2F5c1RyYWNrRW50aXRpZXM6IGlucHV0Py5hbHdheXNUcmFja0VudGl0aWVzIGFzIHN0cmluZ1tdIHwgdW5kZWZpbmVkLFxuICAgIGNhcHR1cmVTbG93UXVlcnlEZXRhaWxzOiBpbnB1dD8uY2FwdHVyZVNsb3dRdWVyeURldGFpbHMgPz8gZC5jYXB0dXJlU2xvd1F1ZXJ5RGV0YWlscyxcbiAgICB0cmFja0NhcGFjaXR5OiBpbnB1dD8udHJhY2tDYXBhY2l0eSA/PyBkLnRyYWNrQ2FwYWNpdHksXG4gIH07XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGJhY2tlbmRzIGlucHV0IHRvIGZ1bGwgQmFja2VuZENvbmZpZyBhcnJheVxuICovXG5mdW5jdGlvbiBub3JtYWxpemVCYWNrZW5kcyhcbiAgaW5wdXQ/OiBBcnJheTxEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZ0lucHV0PiB8IHVuZGVmaW5lZD5cbik6IE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnW10ge1xuICBjb25zdCBsaXN0ID0gKGlucHV0ID8/IFtdKS5maWx0ZXIoKGIpOiBiIGlzIERlZXBQYXJ0aWFsPE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnSW5wdXQ+ID0+ICEhYik7XG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBbIHsgdHlwZTogJ2Nsb3Vkd2F0Y2gnLCBlbmFibGVkOiB0cnVlIH0gXTtcbiAgfVxuXG4gIHJldHVybiBsaXN0Lm1hcCgoYik6IE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnID0+IHtcbiAgICBpZiAoIWIudHlwZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIG9ic2VydmFiaWxpdHkgYmFja2VuZCBjb25maWc6IG1pc3NpbmcgYHR5cGVgJyk7XG4gICAgfVxuICAgIHN3aXRjaCAoYi50eXBlKSB7XG4gICAgICBjYXNlICdjbG91ZHdhdGNoJzpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eXBlOiAnY2xvdWR3YXRjaCcsXG4gICAgICAgICAgZW5hYmxlZDogYi5lbmFibGVkID8/IHRydWUsXG4gICAgICAgICAgbWluTGV2ZWw6IGIubWluTGV2ZWwsXG4gICAgICAgICAgY29uZmlnOiBiLmNvbmZpZyxcbiAgICAgICAgICB0eXBlczogYi50eXBlcyxcbiAgICAgICAgfTtcbiAgICAgIGNhc2UgJ2R5bmFtb2RiJzpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eXBlOiAnZHluYW1vZGInLFxuICAgICAgICAgIGVuYWJsZWQ6IGIuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICAgIG1pbkxldmVsOiBiLm1pbkxldmVsLFxuICAgICAgICAgIGNvbmZpZzogYi5jb25maWcsXG4gICAgICAgICAgdHlwZXM6IGIudHlwZXMsXG4gICAgICAgIH07XG4gICAgICBjYXNlICdvdGVsJzpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eXBlOiAnb3RlbCcsXG4gICAgICAgICAgZW5hYmxlZDogYi5lbmFibGVkID8/IHRydWUsXG4gICAgICAgICAgbWluTGV2ZWw6IGIubWluTGV2ZWwsXG4gICAgICAgICAgY29uZmlnOiBiLmNvbmZpZyxcbiAgICAgICAgICB0eXBlczogYi50eXBlcyxcbiAgICAgICAgfTtcbiAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFZhbGlkYXRlIG9ic2VydmFiaWxpdHkgY29uZmlndXJhdGlvblxuICogUmV0dXJucyBhcnJheSBvZiB2YWxpZGF0aW9uIGVycm9ycyAoZW1wdHkgaWYgdmFsaWQpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNvbmZpZyhjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAvLyBWYWxpZGF0ZSBtaW5MZXZlbFxuICBjb25zdCB2YWxpZExldmVscyA9IE9iamVjdC52YWx1ZXMoT2JzZXJ2YWJpbGl0eUxldmVsKS5maWx0ZXIoKHYpID0+IHR5cGVvZiB2ID09PSAnbnVtYmVyJyk7XG4gIGlmICghdmFsaWRMZXZlbHMuaW5jbHVkZXMoY29uZmlnLm1pbkxldmVsKSkge1xuICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIG1pbkxldmVsOiAke2NvbmZpZy5taW5MZXZlbH1gKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHNhbXBsaW5nIHJhdGVzXG4gIGlmIChjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQgJiYgY29uZmlnLnNhbXBsaW5nLnJhdGVzKSB7XG4gICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLnNhbXBsaW5nLnJhdGVzKS5mb3JFYWNoKChbIGxldmVsLCByYXRlIF0pID0+IHtcbiAgICAgIGlmICh0eXBlb2YgcmF0ZSAhPT0gJ251bWJlcicgfHwgcmF0ZSA8IDAgfHwgcmF0ZSA+IDEpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYEludmFsaWQgc2FtcGxpbmcgcmF0ZSBmb3IgJHtsZXZlbH06ICR7cmF0ZX0uIE11c3QgYmUgYmV0d2VlbiAwIGFuZCAxLmApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgYmFja2VuZCB0eXBlc1xuICBjb25maWcuYmFja2VuZHM/LmZvckVhY2goKGJhY2tlbmQsIGluZGV4KSA9PiB7XG4gICAgaWYgKCFWQUxJRF9CQUNLRU5EUy5pbmNsdWRlcyhiYWNrZW5kLnR5cGUgYXMgVmFsaWRCYWNrZW5kKSkge1xuICAgICAgZXJyb3JzLnB1c2goYEludmFsaWQgYmFja2VuZCB0eXBlIGF0IGluZGV4ICR7aW5kZXh9OiAke2JhY2tlbmQudHlwZX1gKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIFZhbGlkYXRlIHNlcnZpY2VOYW1lXG4gIGlmICghY29uZmlnLnNlcnZpY2VOYW1lIHx8IGNvbmZpZy5zZXJ2aWNlTmFtZS50cmltKCkgPT09ICcnKSB7XG4gICAgZXJyb3JzLnB1c2goJ3NlcnZpY2VOYW1lIGlzIHJlcXVpcmVkIGFuZCBjYW5ub3QgYmUgZW1wdHknKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGNsb3Vkd2F0Y2gubmFtZXNwYWNlXG4gIGlmICghY29uZmlnLmNsb3Vkd2F0Y2g/Lm5hbWVzcGFjZSB8fCBjb25maWcuY2xvdWR3YXRjaC5uYW1lc3BhY2UudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdjbG91ZHdhdGNoLm5hbWVzcGFjZSBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBkeW5hbW9kYi50YWJsZUtleVxuICBpZiAoIWNvbmZpZy5keW5hbW9kYj8udGFibGVLZXkgfHwgY29uZmlnLmR5bmFtb2RiLnRhYmxlS2V5LnRyaW0oKSA9PT0gJycpIHtcbiAgICBlcnJvcnMucHVzaCgnZHluYW1vZGIudGFibGVLZXkgaXMgcmVxdWlyZWQgYW5kIGNhbm5vdCBiZSBlbXB0eScpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgZHluYW1vZGIudHRsRGF5c1xuICBpZiAoY29uZmlnLmR5bmFtb2RiICYmICh0eXBlb2YgY29uZmlnLmR5bmFtb2RiLnR0bERheXMgIT09ICdudW1iZXInIHx8IGNvbmZpZy5keW5hbW9kYi50dGxEYXlzIDwgMSkpIHtcbiAgICBlcnJvcnMucHVzaChgSW52YWxpZCBkeW5hbW9kYi50dGxEYXlzOiAke2NvbmZpZy5keW5hbW9kYi50dGxEYXlzfS4gTXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlci5gKTtcbiAgfVxuXG4gIHJldHVybiBlcnJvcnM7XG59XG4iXX0=