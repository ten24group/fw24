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
        slowThreshold: 1000, // 1 second
        fastQuerySampleRate: 0.01, // 1% of fast queries
        slowQuerySampleRate: 1.0, // 100% of slow queries
        captureSlowQueryDetails: true,
        trackCapacity: false,
        // Sensible operation-specific thresholds
        operationThresholds: [
            { operation: 'get', slowThreshold: 500 }, // Single item - should be fast
            { operation: 'batchGet', slowThreshold: 1000 }, // Batch - bit slower OK
            { operation: 'list', slowThreshold: 1000 }, // List with index - 1s OK
            { operation: 'query', slowThreshold: 1000 }, // Query with index - 1s OK
            { operation: 'scan', slowThreshold: 3000 }, // Full scan - naturally slow
            { operation: 'create', slowThreshold: 500 }, // Write - should be fast
            { operation: 'update', slowThreshold: 500 }, // Write - should be fast
            { operation: 'upsert', slowThreshold: 500 }, // Write - should be fast
            { operation: 'delete', slowThreshold: 500 }, // Write - should be fast
            { operation: 'batchDelete', slowThreshold: 1000 }, // Batch write
        ],
    },
    operationNormalization: {
        enabled: true,
        storeOriginal: true,
    },
    // Noise reduction defaults: enabled in framework configs (can be disabled per preset/app).
    noiseReduction: {
        enabled: false,
        presets: ['fw24.hotpaths', 'fw24.batch_processors'],
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
    const config = {
        enabled: input.enabled ?? exports.CONFIG_DEFAULTS.enabled,
        minLevel: input.minLevel ?? exports.CONFIG_DEFAULTS.minLevel,
        serviceName,
        backends: normalizeBackends(input.backends),
        sampling: normalizeSampling(input.sampling),
        cloudwatch: normalizeCloudWatch(input.cloudwatch),
        dynamodb: normalizeDynamoDb(input.dynamodb),
        dataProtection: normalizeDataProtection(input.dataProtection),
        sourceMap: { enabled: input.sourceMap?.enabled ?? exports.CONFIG_DEFAULTS.sourceMapEnabled },
        types: normalizeTypes(input.types),
        spans: normalizeSpanConfig(input.spans),
        queryPerformance: normalizeQueryPerformanceConfig(input.queryPerformance),
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
    return { namespace: input?.namespace ?? exports.CONFIG_DEFAULTS.cloudwatchNamespace };
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
function normalizeNoiseReduction(input) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUF5Tkgsb0NBTUM7QUEwQkQsOERBNEJDO0FBNlBELHdDQThDQztBQTlqQkQsbUNBY2lCO0FBQ2pCLDZEQUFtRTtBQUVuRSwwQ0FBdUM7QUFFdkMsU0FBUyxRQUFRLENBQUMsS0FBYztJQUM5QixPQUFPLENBQUMsQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUN2RSxDQUFDO0FBRUQ7O0dBRUc7QUFDVSxRQUFBLGNBQWMsR0FBRyxDQUFFLFlBQVksRUFBRSxVQUFVLEVBQUUsTUFBTSxDQUFXLENBQUM7QUFHNUU7O0dBRUc7QUFDVSxRQUFBLGVBQWUsR0FBRztJQUM3QixXQUFXLEVBQUUsY0FBYztJQUMzQixtQkFBbUIsRUFBRSxNQUFNO0lBQzNCLGdFQUFnRTtJQUNoRSxvREFBb0Q7SUFDcEQsUUFBUSxFQUFFLG1CQUFtQjtJQUM3QixPQUFPLEVBQUUsRUFBRTtJQUNYLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO0lBQ2pDLE9BQU8sRUFBRSxLQUFLO0lBQ2QsZ0JBQWdCLEVBQUUsS0FBSztJQUN2QixLQUFLLEVBQUU7UUFDTCxhQUFhLEVBQUUsRUFBRTtRQUNqQixTQUFTLEVBQUUsSUFBSTtLQUNoQjtJQUNELGdCQUFnQixFQUFFO1FBQ2hCLE9BQU8sRUFBRSxJQUFJO1FBQ2IsYUFBYSxFQUFFLElBQUksRUFBRSxXQUFXO1FBQ2hDLG1CQUFtQixFQUFFLElBQUksRUFBRSxxQkFBcUI7UUFDaEQsbUJBQW1CLEVBQUUsR0FBRyxFQUFFLHVCQUF1QjtRQUNqRCx1QkFBdUIsRUFBRSxJQUFJO1FBQzdCLGFBQWEsRUFBRSxLQUFLO1FBQ3BCLHlDQUF5QztR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dCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgQ29uZmlndXJhdGlvblxuICogXG4gKiBGYWN0b3J5IGZ1bmN0aW9uIGZvciBjcmVhdGluZyB0eXBlZCwgdmFsaWRhdGVkIG9ic2VydmFiaWxpdHkgY29uZmlnLlxuICovXG5cbmltcG9ydCB7XG4gIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWcsXG4gIFNhbXBsaW5nQ29uZmlnLFxuICBTYW1wbGluZ1J1bGUsXG4gIERhdGFQcm90ZWN0aW9uQ29uZmlnLFxuICBUcnVuY2F0aW9uQ29uZmlnLFxuICBEeW5hbW9EQkNvbmZpZyxcbiAgTm9pc2VSZWR1Y3Rpb25Db25maWcsXG4gIFR5cGVTcGVjaWZpY0NvbmZpZyxcbiAgUXVlcnlQZXJmb3JtYW5jZUNvbmZpZyxcbiAgT3BlcmF0aW9uVGltaW5nQ29uZmlnLFxuICBFbnRpdHlRdWVyeVRpbWluZ092ZXJyaWRlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUyB9IGZyb20gJy4vdXRpbHMvZGF0YS1wcm90ZWN0aW9uJztcbmltcG9ydCB0eXBlIHsgRGVlcFBhcnRpYWwgfSBmcm9tICcuLi91dGlscy90eXBlcyc7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gJy4uL3V0aWxzL21lcmdlJztcblxuZnVuY3Rpb24gaXNSZWNvcmQodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiAhIXZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpO1xufVxuXG4vKipcbiAqIFZhbGlkIGJhY2tlbmQgdHlwZXNcbiAqL1xuZXhwb3J0IGNvbnN0IFZBTElEX0JBQ0tFTkRTID0gWyAnY2xvdWR3YXRjaCcsICdkeW5hbW9kYicsICdvdGVsJyBdIGFzIGNvbnN0O1xuZXhwb3J0IHR5cGUgVmFsaWRCYWNrZW5kID0gdHlwZW9mIFZBTElEX0JBQ0tFTkRTWyBudW1iZXIgXTtcblxuLyoqXG4gKiBDZW50cmFsaXplZCBjb25maWd1cmF0aW9uIGRlZmF1bHRzXG4gKi9cbmV4cG9ydCBjb25zdCBDT05GSUdfREVGQVVMVFMgPSB7XG4gIHNlcnZpY2VOYW1lOiAnZncyNC1zZXJ2aWNlJyxcbiAgY2xvdWR3YXRjaE5hbWVzcGFjZTogJ0ZXMjQnLFxuICAvLyB0YWJsZUtleSBpcyB0aGUgbG9naWNhbCB0YWJsZSBuYW1lIHVzZWQgdG8gZGVyaXZlIGVudiB2YXIga2V5XG4gIC8vIEVudiB2YXI6IHt0YWJsZUtleX1fdGFibGUgPSBhY3R1YWwgQ0RLIHRhYmxlIG5hbWVcbiAgdGFibGVLZXk6ICdvYnNlcnZhYmlsaXR5bG9ncycsXG4gIHR0bERheXM6IDkwLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gIGVuYWJsZWQ6IGZhbHNlLFxuICBzb3VyY2VNYXBFbmFibGVkOiBmYWxzZSxcbiAgc3BhbnM6IHtcbiAgICBtaW5EdXJhdGlvbk1zOiA1MCxcbiAgICBza2lwRW1wdHk6IHRydWUsXG4gIH0sXG4gIHF1ZXJ5UGVyZm9ybWFuY2U6IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHNsb3dUaHJlc2hvbGQ6IDEwMDAsIC8vIDEgc2Vjb25kXG4gICAgZmFzdFF1ZXJ5U2FtcGxlUmF0ZTogMC4wMSwgLy8gMSUgb2YgZmFzdCBxdWVyaWVzXG4gICAgc2xvd1F1ZXJ5U2FtcGxlUmF0ZTogMS4wLCAvLyAxMDAlIG9mIHNsb3cgcXVlcmllc1xuICAgIGNhcHR1cmVTbG93UXVlcnlEZXRhaWxzOiB0cnVlLFxuICAgIHRyYWNrQ2FwYWNpdHk6IGZhbHNlLFxuICAgIC8vIFNlbnNpYmxlIG9wZXJhdGlvbi1zcGVjaWZpYyB0aHJlc2hvbGRzXG4gICAgb3BlcmF0aW9uVGhyZXNob2xkczogW1xuICAgICAgeyBvcGVyYXRpb246ICdnZXQnLCBzbG93VGhyZXNob2xkOiA1MDAgfSwgICAgICAgLy8gU2luZ2xlIGl0ZW0gLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICdiYXRjaEdldCcsIHNsb3dUaHJlc2hvbGQ6IDEwMDAgfSwgLy8gQmF0Y2ggLSBiaXQgc2xvd2VyIE9LXG4gICAgICB7IG9wZXJhdGlvbjogJ2xpc3QnLCBzbG93VGhyZXNob2xkOiAxMDAwIH0sICAgICAvLyBMaXN0IHdpdGggaW5kZXggLSAxcyBPS1xuICAgICAgeyBvcGVyYXRpb246ICdxdWVyeScsIHNsb3dUaHJlc2hvbGQ6IDEwMDAgfSwgICAgLy8gUXVlcnkgd2l0aCBpbmRleCAtIDFzIE9LXG4gICAgICB7IG9wZXJhdGlvbjogJ3NjYW4nLCBzbG93VGhyZXNob2xkOiAzMDAwIH0sICAgICAvLyBGdWxsIHNjYW4gLSBuYXR1cmFsbHkgc2xvd1xuICAgICAgeyBvcGVyYXRpb246ICdjcmVhdGUnLCBzbG93VGhyZXNob2xkOiA1MDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICd1cGRhdGUnLCBzbG93VGhyZXNob2xkOiA1MDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICd1cHNlcnQnLCBzbG93VGhyZXNob2xkOiA1MDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICdkZWxldGUnLCBzbG93VGhyZXNob2xkOiA1MDAgfSwgICAgLy8gV3JpdGUgLSBzaG91bGQgYmUgZmFzdFxuICAgICAgeyBvcGVyYXRpb246ICdiYXRjaERlbGV0ZScsIHNsb3dUaHJlc2hvbGQ6IDEwMDAgfSwgLy8gQmF0Y2ggd3JpdGVcbiAgICBdLFxuICB9LFxuICBvcGVyYXRpb25Ob3JtYWxpemF0aW9uOiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzdG9yZU9yaWdpbmFsOiB0cnVlLFxuICB9LFxuICAvLyBOb2lzZSByZWR1Y3Rpb24gZGVmYXVsdHM6IGVuYWJsZWQgaW4gZnJhbWV3b3JrIGNvbmZpZ3MgKGNhbiBiZSBkaXNhYmxlZCBwZXIgcHJlc2V0L2FwcCkuXG4gIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgZW5hYmxlZDogZmFsc2UsXG4gICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycsICdmdzI0LmJhdGNoX3Byb2Nlc3NvcnMnIF0sXG4gICAgcnVsZXM6IFtdLFxuICAgIGVtaXRTdW1tYXJpZXM6IHRydWUsXG4gICAgLy8gQm91bmRzIChtYXRjaCB0aGUgcG9saWN5IGVuZ2luZSBkZWZhdWx0cylcbiAgICBtYXhDaGVja3BvaW50c1BlclNwYW46IDUwMCxcbiAgICBtYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbjogMjAwLFxuICAgIG1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5OiA1LFxuICAgIG1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXk6IDMsXG4gICAgLy8gUHJvZHVjdGlvbiBkZWZhdWx0czogY2hlY2twb2ludHMgeWVzLCBkZWJ1ZyBtZXRhZGF0YSBub1xuICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiBmYWxzZSxcbiAgICBpbmNsdWRlRXhhbXBsZXM6IGZhbHNlLFxuICB9IHNhdGlzZmllcyBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbiAgLy8gRHluYW1vREIgc2l6ZSBtYW5hZ2VtZW50IGRlZmF1bHRzXG4gIHRydW5jYXRpb246IHtcbiAgICBlbmFibGVkOiBmYWxzZSwgICAgICAgICAgICAgLy8g4p2MIE9GRiBieSBkZWZhdWx0IC0gbG9zc3ksIG9ubHkgYXMgYWx0ZXJuYXRpdmVcbiAgICBtYXhCeXRlczogMzUwICogMTAyNCwgICAgICAgLy8gMzUwS0IgaWYgZW5hYmxlZFxuICAgIGZpZWxkczogWyAnYWN0b3InLCAnZGF0YScsICdhdHRyaWJ1dGVzJywgJ21ldGFkYXRhJywgJ2NvbnRleHQnIF0sXG4gIH0gc2F0aXNmaWVzIFRydW5jYXRpb25Db25maWcsXG5cbiAgLy8gRHluYW1vREIgb3BlcmF0aW9uYWwgbGltaXRzXG4gIGR5bmFtb01heEl0ZW1TaXplOiA0MDAgKiAxMDI0LCAgICAvLyA0MDBLQiAtIER5bmFtb0RCIGhhcmQgbGltaXRcbiAgZHluYW1vTWF4QmF0Y2hTaXplOiAyNSwgICAgICAgICAgIC8vIDI1IC0gRHluYW1vREIgQmF0Y2hXcml0ZUl0ZW0gbGltaXRcbiAgZHluYW1vTWF4QnVmZmVyU2l6ZTogMTAwMCwgICAgICAgIC8vIDEwMDAgLSBmb3JjZSBmbHVzaCBzYWZldHlcbn0gYXMgY29uc3Q7XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX09QRVJBVElPTl9OT1JNQUxJWkFUSU9OX1JVTEVTOiBOb25OdWxsYWJsZTxPYnNlcnZhYmlsaXR5Q29uZmlnWyAnb3BlcmF0aW9uTm9ybWFsaXphdGlvbicgXT5bICdydWxlcycgXSA9IFtcbiAge1xuICAgIGlkOiAnZncyNC5odHRwLnV1aWQnLFxuICAgIG1hdGNoOiAnL1xcXFxiWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17MTJ9XFxcXGIvZ2knLFxuICAgIHJlcGxhY2U6ICc6dXVpZCcsXG4gICAgcmVhc29uOiAnUmVkdWNlIGNhcmRpbmFsaXR5IGJ5IG5vcm1hbGl6aW5nIFVVSURzIGluIG9wZXJhdGlvbiBuYW1lcycsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2Z3MjQuaHR0cC5oZXgxNicsXG4gICAgbWF0Y2g6ICcvXFxcXGJbMC05YS1mXXsxNn1cXFxcYi9naScsXG4gICAgcmVwbGFjZTogJzppZCcsXG4gICAgcmVhc29uOiAnUmVkdWNlIGNhcmRpbmFsaXR5IGJ5IG5vcm1hbGl6aW5nIDE2LWhleCBJRHMgaW4gb3BlcmF0aW9uIG5hbWVzJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZncyNC5odHRwLm51bWVyaWMnLFxuICAgIG1hdGNoOiAnL1xcXFxiXFxcXGR7NCx9XFxcXGIvZycsXG4gICAgcmVwbGFjZTogJzpuJyxcbiAgICByZWFzb246ICdSZWR1Y2UgY2FyZGluYWxpdHkgYnkgbm9ybWFsaXppbmcgbGFyZ2UgbnVtZXJpYyBJRHMgaW4gb3BlcmF0aW9uIG5hbWVzJyxcbiAgfSxcbl07XG5cbi8qKlxuICogSW5wdXQgdHlwZSBmb3IgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyAtIGFsbCBmaWVsZHMgb3B0aW9uYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQge1xuICBlbmFibGVkPzogYm9vbGVhbjtcbiAgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG4gIHNlcnZpY2VOYW1lPzogc3RyaW5nO1xuICAvKipcbiAgICogQmFja2VuZCBjb25maWdzIChpbnB1dCBmb3JtKS5cbiAgICpcbiAgICogQWNjZXB0cyBmdWxsIGJhY2tlbmQgY29uZmlncyAoaW5jbHVkaW5nIGB0eXBlc2AgZmlsdGVycykgYnV0IGFsbG93cyBgZW5hYmxlZGAgdG8gYmUgb21pdHRlZC5cbiAgICogVGhpcyBrZWVwcyBwcmVzZXRzIGFuZCBhcHAgY29uZmlncyBleHByZXNzaXZlIHdpdGhvdXQgY2FzdGluZy5cbiAgICovXG4gIGJhY2tlbmRzPzogT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWdJbnB1dFtdO1xuICBzYW1wbGluZz86IFBhcnRpYWw8U2FtcGxpbmdDb25maWc+O1xuICBjbG91ZHdhdGNoPzogeyBuYW1lc3BhY2U/OiBzdHJpbmcgfTtcbiAgZHluYW1vZGI/OiB7XG4gICAgLyoqIExvZ2ljYWwgdGFibGUga2V5IC0gcmVzb2x2ZWQgdG8gYWN0dWFsIHRhYmxlIG5hbWUgdmlhIGVudiB2YXIge3RhYmxlS2V5fV90YWJsZSAqL1xuICAgIHRhYmxlS2V5Pzogc3RyaW5nO1xuICAgIHR0bERheXM/OiBudW1iZXI7XG4gICAgLyoqIFRydW5jYXRpb24gY29uZmlndXJhdGlvbiAob3B0aW9uYWwgLSBsb3NzeSBmYWxsYmFjaykgKi9cbiAgICB0cnVuY2F0aW9uPzogUGFydGlhbDxUcnVuY2F0aW9uQ29uZmlnPjtcbiAgICAvKiogTWF4aW11bSBpdGVtIHNpemUgaW4gYnl0ZXMgKGRlZmF1bHQ6IDQwMEtCIC0gRHluYW1vREIgbGltaXQpICovXG4gICAgbWF4SXRlbVNpemU/OiBudW1iZXI7XG4gICAgLyoqIEJhdGNoIHdyaXRlIHNpemUgKGRlZmF1bHQ6IDI1IC0gRHluYW1vREIgQmF0Y2hXcml0ZUl0ZW0gbGltaXQpICovXG4gICAgbWF4QmF0Y2hTaXplPzogbnVtYmVyO1xuICAgIC8qKiBNYXhpbXVtIGJ1ZmZlciBzaXplIGJlZm9yZSBmb3JjaW5nIGZsdXNoIChkZWZhdWx0OiAxMDAwKSAqL1xuICAgIG1heEJ1ZmZlclNpemU/OiBudW1iZXI7XG4gIH07XG4gIGRhdGFQcm90ZWN0aW9uPzogUGFydGlhbDxEYXRhUHJvdGVjdGlvbkNvbmZpZz47XG4gIHR5cGVzPzogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdO1xuICBzb3VyY2VNYXA/OiB7XG4gICAgLyoqIEVuYWJsZSBzb3VyY2UtbWFwLXN1cHBvcnQgZm9yIGJldHRlciBlcnJvciBzdGFjayB0cmFjZXMgKHJlcXVpcmVzIHNvdXJjZS1tYXAtc3VwcG9ydCBwYWNrYWdlKSAqL1xuICAgIGVuYWJsZWQ/OiBib29sZWFuO1xuICB9O1xuICAvKipcbiAgICogU3Bhbi1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBzcGFucz86IHtcbiAgICAvKiogU2tpcCBzcGFucyBmYXN0ZXIgdGhhbiB0aGlzIChtcykuIERlZmF1bHQ6IDUwICovXG4gICAgbWluRHVyYXRpb25Ncz86IG51bWJlcjtcbiAgICAvKiogU2tpcCBzcGFucyB3aXRoIG5vIGV2ZW50cy9lcnJvcnMuIERlZmF1bHQ6IHRydWUgKi9cbiAgICBza2lwRW1wdHk/OiBib29sZWFuO1xuICB9O1xuXG4gIC8qKlxuICAgKiBRdWVyeSBwZXJmb3JtYW5jZSB0cmFja2luZyBjb25maWd1cmF0aW9uXG4gICAqL1xuICBxdWVyeVBlcmZvcm1hbmNlPzogUGFydGlhbDxRdWVyeVBlcmZvcm1hbmNlQ29uZmlnPjtcblxuICAvKipcbiAgICogTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb24gKG1lcmdlL2Ryb3AvYWdncmVnYXRlKS5cbiAgICovXG4gIG5vaXNlUmVkdWN0aW9uPzogUGFydGlhbDxOb2lzZVJlZHVjdGlvbkNvbmZpZz47XG5cbiAgLyoqXG4gICAqIE9wZXJhdGlvbiBub3JtYWxpemF0aW9uIC8gcmVuYW1pbmcuXG4gICAqL1xuICBvcGVyYXRpb25Ob3JtYWxpemF0aW9uPzogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF07XG59XG5cbnR5cGUgV2l0aE9wdGlvbmFsRW5hYmxlZDxUPiA9XG4gIFQgZXh0ZW5kcyB7IGVuYWJsZWQ6IGJvb2xlYW4gfVxuICA/IChPbWl0PFQsICdlbmFibGVkJz4gJiB7IGVuYWJsZWQ/OiBib29sZWFuIH0pXG4gIDogVDtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWdJbnB1dCA9IFdpdGhPcHRpb25hbEVuYWJsZWQ8T2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWc+O1xuXG4vKipcbiAqIEV4dGVuZCBhIHByZXNldCB3aXRoIHRhcmdldGVkIG92ZXJyaWRlcy5cbiAqIFxuICogVXNlcyBmcmFtZXdvcmsncyBkZWVwIG1lcmdlIHV0aWxpdHkgZm9yIGNsZWFuIGNvbmZpZyBjb21wb3NpdGlvbi5cbiAqIFxuICogQHBhcmFtIHByZXNldCAtIEJhc2UgcHJlc2V0IGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBvdmVycmlkZXMgLSBUYXJnZXRlZCBvdmVycmlkZXMgdG8gYXBwbHlcbiAqIEByZXR1cm5zIENvbXBsZXRlIG1lcmdlZCBjb25maWd1cmF0aW9uXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBleHRlbmRQcmVzZXQsIHByb2R1Y3Rpb25QcmVzZXQgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0JztcbiAqIFxuICogRElDb250YWluZXIuUk9PVC5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAqICAgcHJvdmlkZTogJ29ic2VydmFiaWxpdHknLFxuICogICB1c2VDb25maWc6IGV4dGVuZFByZXNldChwcm9kdWN0aW9uUHJlc2V0LCB7XG4gKiAgICAgc2VydmljZU5hbWU6ICdteS1hcHAnLFxuICogICAgIGNsb3Vkd2F0Y2g6IHsgbmFtZXNwYWNlOiAnTXlBcHAnIH0sXG4gKiAgICAgZGF0YVByb3RlY3Rpb246IHtcbiAqICAgICAgIGJsYWNrbGlzdGVkS2V5czogWydhcGlLZXknXSAvLyBNZXJnZWQgd2l0aCBwcmVzZXRcbiAqICAgICB9LFxuICogICAgIHNhbXBsaW5nOiB7IG1heEJ1ZmZlclNpemU6IDUwMDAgfSAvLyBNZXJnZWQgd2l0aCBwcmVzZXRcbiAqICAgfSksXG4gKiAgIHByaW9yaXR5OiAxMFxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dGVuZFByZXNldChcbiAgcHJlc2V0OiBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBvdmVycmlkZXM6IERlZXBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWdJbnB1dD5cbik6IE9ic2VydmFiaWxpdHlDb25maWcge1xuICBjb25zdCBtZXJnZWQgPSBtZXJnZShbIHByZXNldCwgb3ZlcnJpZGVzIF0pITtcbiAgcmV0dXJuIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcobWVyZ2VkKTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBjb21wbGV0ZSwgdmFsaWRhdGVkIE9ic2VydmFiaWxpdHlDb25maWcgZnJvbSBwYXJ0aWFsIGlucHV0XG4gKiBcbiAqIEBwYXJhbSBpbnB1dCAtIFBhcnRpYWwgY29uZmlnIGZyb20gYXBwbGljYXRpb25cbiAqIEByZXR1cm5zIENvbXBsZXRlIE9ic2VydmFiaWxpdHlDb25maWcgd2l0aCBkZWZhdWx0cyBtZXJnZWRcbiAqIEB0aHJvd3MgRXJyb3IgaWYgdmFsaWRhdGlvbiBmYWlsc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gSW4geW91ciBhcHAncyBkaS50czpcbiAqIGltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNCc7XG4gKiBpbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNC9vYnNlcnZhYmlsaXR5JztcbiAqIFxuICogRElDb250YWluZXIuUk9PVC5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAqICAgcHJvdmlkZTogJ29ic2VydmFiaWxpdHknLFxuICogICB1c2VDb25maWc6IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICogICAgIHNlcnZpY2VOYW1lOiAnbXktYXBwJyxcbiAqICAgICBiYWNrZW5kczogW3sgdHlwZTogJ2Nsb3Vkd2F0Y2gnIH0sIHsgdHlwZTogJ2R5bmFtb2RiJyB9XSxcbiAqICAgICAvLyB0YWJsZUtleSBkZWZhdWx0cyB0byAnb2JzZXJ2YWJpbGl0eWxvZ3MnXG4gKiAgIH0pLFxuICogICBwcmlvcml0eTogMTBcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKGlucHV0OiBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQ+ID0ge30pOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgY29uc3Qgc2VydmljZU5hbWUgPSBpbnB1dC5zZXJ2aWNlTmFtZSA/PyBDT05GSUdfREVGQVVMVFMuc2VydmljZU5hbWU7XG5cbiAgY29uc3QgY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnID0ge1xuICAgIGVuYWJsZWQ6IGlucHV0LmVuYWJsZWQgPz8gQ09ORklHX0RFRkFVTFRTLmVuYWJsZWQsXG4gICAgbWluTGV2ZWw6IGlucHV0Lm1pbkxldmVsID8/IENPTkZJR19ERUZBVUxUUy5taW5MZXZlbCxcbiAgICBzZXJ2aWNlTmFtZSxcbiAgICBiYWNrZW5kczogbm9ybWFsaXplQmFja2VuZHMoaW5wdXQuYmFja2VuZHMpLFxuICAgIHNhbXBsaW5nOiBub3JtYWxpemVTYW1wbGluZyhpbnB1dC5zYW1wbGluZyksXG4gICAgY2xvdWR3YXRjaDogbm9ybWFsaXplQ2xvdWRXYXRjaChpbnB1dC5jbG91ZHdhdGNoKSxcbiAgICBkeW5hbW9kYjogbm9ybWFsaXplRHluYW1vRGIoaW5wdXQuZHluYW1vZGIpLFxuICAgIGRhdGFQcm90ZWN0aW9uOiBub3JtYWxpemVEYXRhUHJvdGVjdGlvbihpbnB1dC5kYXRhUHJvdGVjdGlvbiksXG4gICAgc291cmNlTWFwOiB7IGVuYWJsZWQ6IGlucHV0LnNvdXJjZU1hcD8uZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMuc291cmNlTWFwRW5hYmxlZCB9LFxuICAgIHR5cGVzOiBub3JtYWxpemVUeXBlcyhpbnB1dC50eXBlcyksXG4gICAgc3BhbnM6IG5vcm1hbGl6ZVNwYW5Db25maWcoaW5wdXQuc3BhbnMpLFxuICAgIHF1ZXJ5UGVyZm9ybWFuY2U6IG5vcm1hbGl6ZVF1ZXJ5UGVyZm9ybWFuY2VDb25maWcoaW5wdXQucXVlcnlQZXJmb3JtYW5jZSksXG4gICAgLy8gQ2VudHJhbGl6ZWQgZGVmYXVsdHM6IG5vaXNlUmVkdWN0aW9uIGlzIGFsd2F5cyBwcmVzZW50IChlbmFibGVkIGNhbiBiZSB0b2dnbGVkIHBlciBwcmVzZXQvYXBwKS5cbiAgICBub2lzZVJlZHVjdGlvbjogbm9ybWFsaXplTm9pc2VSZWR1Y3Rpb24oaW5wdXQubm9pc2VSZWR1Y3Rpb24pLFxuICAgIG9wZXJhdGlvbk5vcm1hbGl6YXRpb246IG5vcm1hbGl6ZU9wZXJhdGlvbk5vcm1hbGl6YXRpb24oaW5wdXQub3BlcmF0aW9uTm9ybWFsaXphdGlvbiksXG4gIH07XG5cbiAgLy8gVmFsaWRhdGVcbiAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG9ic2VydmFiaWxpdHkgY29uZmlnOiAke2Vycm9ycy5qb2luKCcsICcpfWApO1xuICB9XG5cbiAgcmV0dXJuIGNvbmZpZztcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplU2FtcGxpbmcoaW5wdXQ/OiBEZWVwUGFydGlhbDxTYW1wbGluZ0NvbmZpZz4pOiBTYW1wbGluZ0NvbmZpZyB7XG4gIGNvbnN0IG9wZXJhdGlvbnNJbiA9IGlucHV0Py5vcGVyYXRpb25zO1xuICBjb25zdCBvcGVyYXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHwgdW5kZWZpbmVkID0gaXNSZWNvcmQob3BlcmF0aW9uc0luKVxuICAgID8gKCgpID0+IHtcbiAgICAgIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhvcGVyYXRpb25zSW4pKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIG91dFsgayBdID0gdjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvdXQ7XG4gICAgfSkoKVxuICAgIDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IHJhdGVzSW4gPSBpbnB1dD8ucmF0ZXM7XG4gIGNvbnN0IHJhdGVzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHwgdW5kZWZpbmVkID0gaXNSZWNvcmQocmF0ZXNJbilcbiAgICA/ICgoKSA9PiB7XG4gICAgICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMocmF0ZXNJbikpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgb3V0WyBrIF0gPSB2O1xuICAgICAgfVxuICAgICAgcmV0dXJuIG91dDtcbiAgICB9KSgpXG4gICAgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgaXNTYW1wbGluZ1RhcmdldCA9ICh2OiB1bmtub3duKTogdiBpcyBTYW1wbGluZ1J1bGVbICd0YXJnZXQnIF0gPT5cbiAgICB2ID09PSAnc291cmNlJyB8fCB2ID09PSAndGVuYW50JyB8fCB2ID09PSAncm91dGUnIHx8IHYgPT09ICd0YWcnIHx8IHYgPT09ICdhY3Rvcic7XG5cbiAgY29uc3QgaXNTYW1wbGluZ1J1bGUgPSAodjogdW5rbm93bik6IHYgaXMgU2FtcGxpbmdSdWxlID0+IHtcbiAgICBpZiAoIWlzUmVjb3JkKHYpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCFpc1NhbXBsaW5nVGFyZ2V0KHYudGFyZ2V0KSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghKHR5cGVvZiB2LnBhdHRlcm4gPT09ICdzdHJpbmcnIHx8IHYucGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cCkpIHJldHVybiBmYWxzZTtcbiAgICBpZiAodHlwZW9mIHYucmF0ZSAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICBjb25zdCBydWxlczogU2FtcGxpbmdSdWxlW10gfCB1bmRlZmluZWQgPSBBcnJheS5pc0FycmF5KGlucHV0Py5ydWxlcylcbiAgICA/IGlucHV0LnJ1bGVzLmZpbHRlcihpc1NhbXBsaW5nUnVsZSlcbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGlucHV0Py5lbmFibGVkID8/IGZhbHNlLFxuICAgIHNtYXJ0OiBpbnB1dD8uc21hcnQsXG4gICAgbWF4QnVmZmVyU2l6ZTogaW5wdXQ/Lm1heEJ1ZmZlclNpemUsXG4gICAgbWluTGV2ZWxPbkVycm9yOiBpbnB1dD8ubWluTGV2ZWxPbkVycm9yLFxuICAgIHJhdGVzLFxuICAgIG9wZXJhdGlvbnMsXG4gICAgcnVsZXMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVR5cGVTcGVjaWZpY0NvbmZpZyhpbnB1dD86IERlZXBQYXJ0aWFsPFR5cGVTcGVjaWZpY0NvbmZpZz4pOiBUeXBlU3BlY2lmaWNDb25maWcgfCB1bmRlZmluZWQge1xuICBpZiAoIWlucHV0KSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAoIWlzUmVjb3JkKGlucHV0KSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCBzYW1wbGluZ0luID0gaW5wdXQuc2FtcGxpbmc7XG4gIGxldCBzYW1wbGluZzogVHlwZVNwZWNpZmljQ29uZmlnWyAnc2FtcGxpbmcnIF0gfCB1bmRlZmluZWQ7XG4gIGlmIChzYW1wbGluZ0luICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoIWlzUmVjb3JkKHNhbXBsaW5nSW4pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgb2JzZXJ2YWJpbGl0eS50eXBlcy4qLnNhbXBsaW5nOiBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHNhbXBsaW5nSW4uZW5hYmxlZCAhPT0gJ2Jvb2xlYW4nIHx8IHR5cGVvZiBzYW1wbGluZ0luLnJhdGUgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgb2JzZXJ2YWJpbGl0eS50eXBlcy4qLnNhbXBsaW5nOiByZXF1aXJlcyB7IGVuYWJsZWQ6IGJvb2xlYW4sIHJhdGU6IG51bWJlciB9Jyk7XG4gICAgfVxuICAgIHNhbXBsaW5nID0geyBlbmFibGVkOiBzYW1wbGluZ0luLmVuYWJsZWQsIHJhdGU6IHNhbXBsaW5nSW4ucmF0ZSB9O1xuICB9XG5cbiAgdHlwZSBCYWNrZW5kTmFtZSA9ICdjbG91ZHdhdGNoJyB8ICdkeW5hbW9kYicgfCAnb3RlbCc7XG4gIGNvbnN0IGlzVmFsaWRCYWNrZW5kID0gKHY6IHVua25vd24pOiB2IGlzIEJhY2tlbmROYW1lID0+XG4gICAgdiA9PT0gJ2Nsb3Vkd2F0Y2gnIHx8IHYgPT09ICdkeW5hbW9kYicgfHwgdiA9PT0gJ290ZWwnO1xuXG4gIGNvbnN0IGJhY2tlbmRzID0gQXJyYXkuaXNBcnJheShpbnB1dC5iYWNrZW5kcylcbiAgICA/IGlucHV0LmJhY2tlbmRzLmZpbHRlcihpc1ZhbGlkQmFja2VuZClcbiAgICA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIGJhY2tlbmRzLFxuICAgIG1pbkxldmVsOiBpbnB1dC5taW5MZXZlbCxcbiAgICBzYW1wbGluZyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVHlwZXMoaW5wdXQ/OiBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnWyAndHlwZXMnIF0+KTogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdIHtcbiAgaWYgKCFpbnB1dCB8fCAhaXNSZWNvcmQoaW5wdXQpKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBzcGFuID0gbm9ybWFsaXplVHlwZVNwZWNpZmljQ29uZmlnKGlucHV0LnNwYW4pO1xuICBjb25zdCBtZXRyaWMgPSBub3JtYWxpemVUeXBlU3BlY2lmaWNDb25maWcoaW5wdXQubWV0cmljKTtcbiAgY29uc3QgYXVkaXQgPSBub3JtYWxpemVUeXBlU3BlY2lmaWNDb25maWcoaW5wdXQuYXVkaXQpO1xuICBjb25zdCBsb2cgPSBub3JtYWxpemVUeXBlU3BlY2lmaWNDb25maWcoaW5wdXQubG9nKTtcbiAgaWYgKCFzcGFuICYmICFtZXRyaWMgJiYgIWF1ZGl0ICYmICFsb2cpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB7IHNwYW4sIG1ldHJpYywgYXVkaXQsIGxvZyB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVDbG91ZFdhdGNoKGlucHV0PzogeyBuYW1lc3BhY2U/OiBzdHJpbmcgfSk6IE9ic2VydmFiaWxpdHlDb25maWdbICdjbG91ZHdhdGNoJyBdIHtcbiAgcmV0dXJuIHsgbmFtZXNwYWNlOiBpbnB1dD8ubmFtZXNwYWNlID8/IENPTkZJR19ERUZBVUxUUy5jbG91ZHdhdGNoTmFtZXNwYWNlIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUR5bmFtb0RiKGlucHV0PzogT2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0WyAnZHluYW1vZGInIF0pOiBEeW5hbW9EQkNvbmZpZyB7XG4gIHJldHVybiB7XG4gICAgdGFibGVLZXk6IGlucHV0Py50YWJsZUtleSA/PyBDT05GSUdfREVGQVVMVFMudGFibGVLZXksXG4gICAgdHRsRGF5czogaW5wdXQ/LnR0bERheXMgPz8gQ09ORklHX0RFRkFVTFRTLnR0bERheXMsXG4gICAgdHJ1bmNhdGlvbjoge1xuICAgICAgZW5hYmxlZDogaW5wdXQ/LnRydW5jYXRpb24/LmVuYWJsZWQgPz8gQ09ORklHX0RFRkFVTFRTLnRydW5jYXRpb24uZW5hYmxlZCxcbiAgICAgIG1heEJ5dGVzOiBpbnB1dD8udHJ1bmNhdGlvbj8ubWF4Qnl0ZXMgPz8gQ09ORklHX0RFRkFVTFRTLnRydW5jYXRpb24ubWF4Qnl0ZXMsXG4gICAgICBmaWVsZHM6IGlucHV0Py50cnVuY2F0aW9uPy5maWVsZHMgPz8gWyAuLi5DT05GSUdfREVGQVVMVFMudHJ1bmNhdGlvbi5maWVsZHMgXSxcbiAgICB9LFxuICAgIG1heEl0ZW1TaXplOiBpbnB1dD8ubWF4SXRlbVNpemUgPz8gQ09ORklHX0RFRkFVTFRTLmR5bmFtb01heEl0ZW1TaXplLFxuICAgIG1heEJhdGNoU2l6ZTogaW5wdXQ/Lm1heEJhdGNoU2l6ZSA/PyBDT05GSUdfREVGQVVMVFMuZHluYW1vTWF4QmF0Y2hTaXplLFxuICAgIG1heEJ1ZmZlclNpemU6IGlucHV0Py5tYXhCdWZmZXJTaXplID8/IENPTkZJR19ERUZBVUxUUy5keW5hbW9NYXhCdWZmZXJTaXplLFxuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVEYXRhUHJvdGVjdGlvbihpbnB1dD86IERlZXBQYXJ0aWFsPERhdGFQcm90ZWN0aW9uQ29uZmlnPik6IERhdGFQcm90ZWN0aW9uQ29uZmlnIHtcbiAgY29uc3QgYmxhY2tsaXN0ZWRLZXlzID0gQXJyYXkuaXNBcnJheShpbnB1dD8uYmxhY2tsaXN0ZWRLZXlzKVxuICAgID8gaW5wdXQuYmxhY2tsaXN0ZWRLZXlzLmZpbHRlcigoazogdW5rbm93bik6IGsgaXMgc3RyaW5nIHwgUmVnRXhwID0+IGsgIT09IHVuZGVmaW5lZCAmJiBrICE9PSBudWxsKVxuICAgIDogREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTO1xuICByZXR1cm4ge1xuICAgIGVuYWJsZWQ6IGlucHV0Py5lbmFibGVkID8/IHRydWUsXG4gICAgYmxhY2tsaXN0ZWRLZXlzLFxuICAgIGZ1enp5S2V5TWF0Y2g6IGlucHV0Py5mdXp6eUtleU1hdGNoID8/IHRydWUsXG4gICAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoOiBpbnB1dD8uY2FzZVNlbnNpdGl2ZUtleU1hdGNoID8/IGZhbHNlLFxuICAgIHJlcGxhY2VtZW50OiBpbnB1dD8ucmVwbGFjZW1lbnQgPz8gJ1tSRURBQ1RFRF0nLFxuICAgIGZpZWxkczogaW5wdXQ/LmZpZWxkcyA/PyBbICdkYXRhJywgJ2F0dHJpYnV0ZXMnLCAnbWV0YWRhdGEnLCAnY29udGV4dCcgXSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplU3BhbkNvbmZpZyhpbnB1dD86IHsgbWluRHVyYXRpb25Ncz86IG51bWJlcjsgc2tpcEVtcHR5PzogYm9vbGVhbiB9KTogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3NwYW5zJyBdIHtcbiAgcmV0dXJuIHtcbiAgICBtaW5EdXJhdGlvbk1zOiBpbnB1dD8ubWluRHVyYXRpb25NcyA/PyBDT05GSUdfREVGQVVMVFMuc3BhbnMubWluRHVyYXRpb25NcyxcbiAgICBza2lwRW1wdHk6IGlucHV0Py5za2lwRW1wdHkgPz8gQ09ORklHX0RFRkFVTFRTLnNwYW5zLnNraXBFbXB0eSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTm9pc2VSZWR1Y3Rpb24oaW5wdXQ/OiBEZWVwUGFydGlhbDxOb2lzZVJlZHVjdGlvbkNvbmZpZz4pOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyB7XG4gIGNvbnN0IGQgPSBDT05GSUdfREVGQVVMVFMubm9pc2VSZWR1Y3Rpb247XG4gIGNvbnN0IHByZXNldHMgPSBBcnJheS5pc0FycmF5KGlucHV0Py5wcmVzZXRzKVxuICAgID8gaW5wdXQucHJlc2V0cy5maWx0ZXIoKHApOiBwIGlzIE5vaXNlUmVkdWN0aW9uQ29uZmlnWyAncHJlc2V0cycgXVsgbnVtYmVyIF0gPT4gdHlwZW9mIHAgPT09ICdzdHJpbmcnKVxuICAgIDogZC5wcmVzZXRzO1xuXG4gIGNvbnN0IHJ1bGVzID0gQXJyYXkuaXNBcnJheShpbnB1dD8ucnVsZXMpXG4gICAgPyBpbnB1dC5ydWxlcy5maWx0ZXIoKHIpOiByIGlzIE5vaXNlUmVkdWN0aW9uQ29uZmlnWyAncnVsZXMnIF1bIG51bWJlciBdID0+IHtcbiAgICAgIHJldHVybiBpc1JlY29yZChyKVxuICAgICAgICAmJiB0eXBlb2Ygci5pZCA9PT0gJ3N0cmluZydcbiAgICAgICAgJiYgdHlwZW9mIHIuZGVjaXNpb24gPT09ICdzdHJpbmcnXG4gICAgICAgICYmIGlzUmVjb3JkKHIubWF0Y2gpO1xuICAgIH0pXG4gICAgOiBkLnJ1bGVzO1xuXG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogaW5wdXQ/LmVuYWJsZWQgPz8gZC5lbmFibGVkLFxuICAgIHByZXNldHMsXG4gICAgcnVsZXMsXG4gICAgZW1pdFN1bW1hcmllczogaW5wdXQ/LmVtaXRTdW1tYXJpZXMgPz8gZC5lbWl0U3VtbWFyaWVzLFxuICAgIG1heENoZWNrcG9pbnRzUGVyU3BhbjogaW5wdXQ/Lm1heENoZWNrcG9pbnRzUGVyU3BhbiA/PyBkLm1heENoZWNrcG9pbnRzUGVyU3BhbixcbiAgICBtYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbjogaW5wdXQ/Lm1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuID8/IGQubWF4QWdncmVnYXRlS2V5c1BlclNwYW4sXG4gICAgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXk6IGlucHV0Py5tYXhBZ2dyZWdhdGVFeGFtcGxlc1BlcktleSA/PyBkLm1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5LFxuICAgIG1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXk6IGlucHV0Py5tYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5ID8/IGQubWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleSxcbiAgICBpbmNsdWRlRGVidWdNZXRhZGF0YTogaW5wdXQ/LmluY2x1ZGVEZWJ1Z01ldGFkYXRhID8/IGQuaW5jbHVkZURlYnVnTWV0YWRhdGEsXG4gICAgaW5jbHVkZUV4YW1wbGVzOiBpbnB1dD8uaW5jbHVkZUV4YW1wbGVzID8/IGQuaW5jbHVkZUV4YW1wbGVzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVPcGVyYXRpb25Ob3JtYWxpemF0aW9uKFxuICBpbnB1dD86IERlZXBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdPlxuKTogTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF0+IHtcbiAgY29uc3QgcnVsZXMgPSBBcnJheS5pc0FycmF5KGlucHV0Py5ydWxlcylcbiAgICA/IGlucHV0LnJ1bGVzLmZpbHRlcigocik6IHIgaXMgT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF1bICdydWxlcycgXVsgbnVtYmVyIF0gPT4ge1xuICAgICAgcmV0dXJuIGlzUmVjb3JkKHIpXG4gICAgICAgICYmIHR5cGVvZiByLmlkID09PSAnc3RyaW5nJ1xuICAgICAgICAmJiB0eXBlb2Ygci5tYXRjaCA9PT0gJ3N0cmluZydcbiAgICAgICAgJiYgdHlwZW9mIHIucmVwbGFjZSA9PT0gJ3N0cmluZyc7XG4gICAgfSlcbiAgICA6IERFRkFVTFRfT1BFUkFUSU9OX05PUk1BTElaQVRJT05fUlVMRVM7XG5cbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBpbnB1dD8uZW5hYmxlZCA/PyBDT05GSUdfREVGQVVMVFMub3BlcmF0aW9uTm9ybWFsaXphdGlvbi5lbmFibGVkLFxuICAgIHJ1bGVzLFxuICAgIHN0b3JlT3JpZ2luYWw6IGlucHV0Py5zdG9yZU9yaWdpbmFsID8/IENPTkZJR19ERUZBVUxUUy5vcGVyYXRpb25Ob3JtYWxpemF0aW9uLnN0b3JlT3JpZ2luYWwsXG4gIH07XG59XG5cbi8qKlxuICogTm9ybWFsaXplIHF1ZXJ5IHBlcmZvcm1hbmNlIGNvbmZpZ3VyYXRpb25cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUXVlcnlQZXJmb3JtYW5jZUNvbmZpZyhpbnB1dD86IERlZXBQYXJ0aWFsPFF1ZXJ5UGVyZm9ybWFuY2VDb25maWc+KTogUXVlcnlQZXJmb3JtYW5jZUNvbmZpZyB7XG4gIGNvbnN0IGQgPSBDT05GSUdfREVGQVVMVFMucXVlcnlQZXJmb3JtYW5jZTtcblxuICAvLyBDYXN0IHJlYWRvbmx5IGRlZmF1bHQgdG8gbXV0YWJsZSBvciB1c2UgaW5wdXRcbiAgY29uc3Qgb3BlcmF0aW9uVGhyZXNob2xkcyA9IChpbnB1dD8ub3BlcmF0aW9uVGhyZXNob2xkc1xuICAgID8gaW5wdXQub3BlcmF0aW9uVGhyZXNob2xkcy5maWx0ZXIoKHQpOiB0IGlzIE9wZXJhdGlvblRpbWluZ0NvbmZpZyA9PiAhIXQgJiYgISF0Lm9wZXJhdGlvbiAmJiB0eXBlb2YgdC5zbG93VGhyZXNob2xkID09PSAnbnVtYmVyJylcbiAgICA6IGQub3BlcmF0aW9uVGhyZXNob2xkcykgYXMgT3BlcmF0aW9uVGltaW5nQ29uZmlnW107XG5cbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiBpbnB1dD8uZW5hYmxlZCA/PyBkLmVuYWJsZWQsXG4gICAgc2xvd1RocmVzaG9sZDogaW5wdXQ/LnNsb3dUaHJlc2hvbGQgPz8gZC5zbG93VGhyZXNob2xkLFxuICAgIGZhc3RRdWVyeVNhbXBsZVJhdGU6IGlucHV0Py5mYXN0UXVlcnlTYW1wbGVSYXRlID8/IGQuZmFzdFF1ZXJ5U2FtcGxlUmF0ZSxcbiAgICBzbG93UXVlcnlTYW1wbGVSYXRlOiBpbnB1dD8uc2xvd1F1ZXJ5U2FtcGxlUmF0ZSA/PyBkLnNsb3dRdWVyeVNhbXBsZVJhdGUsXG4gICAgb3BlcmF0aW9uVGhyZXNob2xkcyxcbiAgICBlbnRpdHlPdmVycmlkZXM6IGlucHV0Py5lbnRpdHlPdmVycmlkZXMgYXMgRW50aXR5UXVlcnlUaW1pbmdPdmVycmlkZVtdIHwgdW5kZWZpbmVkLFxuICAgIGV4Y2x1ZGVFbnRpdGllczogaW5wdXQ/LmV4Y2x1ZGVFbnRpdGllcyBhcyBzdHJpbmdbXSB8IHVuZGVmaW5lZCxcbiAgICBhbHdheXNUcmFja0VudGl0aWVzOiBpbnB1dD8uYWx3YXlzVHJhY2tFbnRpdGllcyBhcyBzdHJpbmdbXSB8IHVuZGVmaW5lZCxcbiAgICBjYXB0dXJlU2xvd1F1ZXJ5RGV0YWlsczogaW5wdXQ/LmNhcHR1cmVTbG93UXVlcnlEZXRhaWxzID8/IGQuY2FwdHVyZVNsb3dRdWVyeURldGFpbHMsXG4gICAgdHJhY2tDYXBhY2l0eTogaW5wdXQ/LnRyYWNrQ2FwYWNpdHkgPz8gZC50cmFja0NhcGFjaXR5LFxuICB9O1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBiYWNrZW5kcyBpbnB1dCB0byBmdWxsIEJhY2tlbmRDb25maWcgYXJyYXlcbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQmFja2VuZHMoXG4gIGlucHV0PzogQXJyYXk8RGVlcFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWdJbnB1dD4gfCB1bmRlZmluZWQ+XG4pOiBPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZ1tdIHtcbiAgY29uc3QgbGlzdCA9IChpbnB1dCA/PyBbXSkuZmlsdGVyKChiKTogYiBpcyBEZWVwUGFydGlhbDxPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZ0lucHV0PiA9PiAhIWIpO1xuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gWyB7IHR5cGU6ICdjbG91ZHdhdGNoJywgZW5hYmxlZDogdHJ1ZSB9IF07XG4gIH1cblxuICByZXR1cm4gbGlzdC5tYXAoKGIpOiBPYnNlcnZhYmlsaXR5QmFja2VuZENvbmZpZyA9PiB7XG4gICAgaWYgKCFiLnR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBvYnNlcnZhYmlsaXR5IGJhY2tlbmQgY29uZmlnOiBtaXNzaW5nIGB0eXBlYCcpO1xuICAgIH1cbiAgICBzd2l0Y2ggKGIudHlwZSkge1xuICAgICAgY2FzZSAnY2xvdWR3YXRjaCc6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ2Nsb3Vkd2F0Y2gnLFxuICAgICAgICAgIGVuYWJsZWQ6IGIuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICAgIG1pbkxldmVsOiBiLm1pbkxldmVsLFxuICAgICAgICAgIGNvbmZpZzogYi5jb25maWcsXG4gICAgICAgICAgdHlwZXM6IGIudHlwZXMsXG4gICAgICAgIH07XG4gICAgICBjYXNlICdkeW5hbW9kYic6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ2R5bmFtb2RiJyxcbiAgICAgICAgICBlbmFibGVkOiBiLmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgICBtaW5MZXZlbDogYi5taW5MZXZlbCxcbiAgICAgICAgICBjb25maWc6IGIuY29uZmlnLFxuICAgICAgICAgIHR5cGVzOiBiLnR5cGVzLFxuICAgICAgICB9O1xuICAgICAgY2FzZSAnb3RlbCc6XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogJ290ZWwnLFxuICAgICAgICAgIGVuYWJsZWQ6IGIuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICAgIG1pbkxldmVsOiBiLm1pbkxldmVsLFxuICAgICAgICAgIGNvbmZpZzogYi5jb25maWcsXG4gICAgICAgICAgdHlwZXM6IGIudHlwZXMsXG4gICAgICAgIH07XG4gICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZSBvYnNlcnZhYmlsaXR5IGNvbmZpZ3VyYXRpb25cbiAqIFJldHVybnMgYXJyYXkgb2YgdmFsaWRhdGlvbiBlcnJvcnMgKGVtcHR5IGlmIHZhbGlkKVxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDb25maWcoY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogc3RyaW5nW10ge1xuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgLy8gVmFsaWRhdGUgbWluTGV2ZWxcbiAgY29uc3QgdmFsaWRMZXZlbHMgPSBPYmplY3QudmFsdWVzKE9ic2VydmFiaWxpdHlMZXZlbCkuZmlsdGVyKCh2KSA9PiB0eXBlb2YgdiA9PT0gJ251bWJlcicpO1xuICBpZiAoIXZhbGlkTGV2ZWxzLmluY2x1ZGVzKGNvbmZpZy5taW5MZXZlbCkpIHtcbiAgICBlcnJvcnMucHVzaChgSW52YWxpZCBtaW5MZXZlbDogJHtjb25maWcubWluTGV2ZWx9YCk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzYW1wbGluZyByYXRlc1xuICBpZiAoY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkICYmIGNvbmZpZy5zYW1wbGluZy5yYXRlcykge1xuICAgIE9iamVjdC5lbnRyaWVzKGNvbmZpZy5zYW1wbGluZy5yYXRlcykuZm9yRWFjaCgoWyBsZXZlbCwgcmF0ZSBdKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHJhdGUgIT09ICdudW1iZXInIHx8IHJhdGUgPCAwIHx8IHJhdGUgPiAxKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIHNhbXBsaW5nIHJhdGUgZm9yICR7bGV2ZWx9OiAke3JhdGV9LiBNdXN0IGJlIGJldHdlZW4gMCBhbmQgMS5gKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGJhY2tlbmQgdHlwZXNcbiAgY29uZmlnLmJhY2tlbmRzPy5mb3JFYWNoKChiYWNrZW5kLCBpbmRleCkgPT4ge1xuICAgIGlmICghVkFMSURfQkFDS0VORFMuaW5jbHVkZXMoYmFja2VuZC50eXBlIGFzIFZhbGlkQmFja2VuZCkpIHtcbiAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIGJhY2tlbmQgdHlwZSBhdCBpbmRleCAke2luZGV4fTogJHtiYWNrZW5kLnR5cGV9YCk7XG4gICAgfVxuICB9KTtcblxuICAvLyBWYWxpZGF0ZSBzZXJ2aWNlTmFtZVxuICBpZiAoIWNvbmZpZy5zZXJ2aWNlTmFtZSB8fCBjb25maWcuc2VydmljZU5hbWUudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdzZXJ2aWNlTmFtZSBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBjbG91ZHdhdGNoLm5hbWVzcGFjZVxuICBpZiAoIWNvbmZpZy5jbG91ZHdhdGNoPy5uYW1lc3BhY2UgfHwgY29uZmlnLmNsb3Vkd2F0Y2gubmFtZXNwYWNlLnRyaW0oKSA9PT0gJycpIHtcbiAgICBlcnJvcnMucHVzaCgnY2xvdWR3YXRjaC5uYW1lc3BhY2UgaXMgcmVxdWlyZWQgYW5kIGNhbm5vdCBiZSBlbXB0eScpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgZHluYW1vZGIudGFibGVLZXlcbiAgaWYgKCFjb25maWcuZHluYW1vZGI/LnRhYmxlS2V5IHx8IGNvbmZpZy5keW5hbW9kYi50YWJsZUtleS50cmltKCkgPT09ICcnKSB7XG4gICAgZXJyb3JzLnB1c2goJ2R5bmFtb2RiLnRhYmxlS2V5IGlzIHJlcXVpcmVkIGFuZCBjYW5ub3QgYmUgZW1wdHknKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIGR5bmFtb2RiLnR0bERheXNcbiAgaWYgKGNvbmZpZy5keW5hbW9kYiAmJiAodHlwZW9mIGNvbmZpZy5keW5hbW9kYi50dGxEYXlzICE9PSAnbnVtYmVyJyB8fCBjb25maWcuZHluYW1vZGIudHRsRGF5cyA8IDEpKSB7XG4gICAgZXJyb3JzLnB1c2goYEludmFsaWQgZHluYW1vZGIudHRsRGF5czogJHtjb25maWcuZHluYW1vZGIudHRsRGF5c30uIE11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXIuYCk7XG4gIH1cblxuICByZXR1cm4gZXJyb3JzO1xufVxuIl19