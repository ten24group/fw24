/**
 * Observability Configuration
 *
 * Factory function for creating typed, validated observability config.
 */
import { ObservabilityConfig, ObservabilityLevel, ObservabilityBackendConfig, SamplingConfig, DataProtectionConfig, TruncationConfig, NoiseReductionConfig, QueryPerformanceConfig, CloudWatchConfig, TagFilteringConfig } from './types';
import type { DeepPartial } from '../utils/types';
/**
 * Valid backend types
 */
export declare const VALID_BACKENDS: readonly ["cloudwatch", "dynamodb", "otel", "logtrail"];
export type ValidBackend = typeof VALID_BACKENDS[number];
/**
 * Centralized configuration defaults
 */
export declare const CONFIG_DEFAULTS: {
    readonly serviceName: "fw24-service";
    readonly cloudwatchNamespace: "FW24";
    readonly tableKey: "observabilitylogs";
    readonly ttlDays: 90;
    readonly minLevel: ObservabilityLevel.INFO;
    readonly enabled: false;
    readonly sourceMapEnabled: false;
    readonly spans: {
        readonly minDurationMs: 50;
        readonly skipEmpty: true;
    };
    readonly queryPerformance: {
        readonly enabled: true;
        readonly slowThreshold: number;
        readonly fastQuerySampleRate: 0.01;
        readonly slowQuerySampleRate: 1;
        readonly captureSlowQueryDetails: true;
        readonly trackCapacity: false;
        readonly operationThresholds: readonly [{
            readonly operation: "get";
            readonly slowThreshold: number;
        }, {
            readonly operation: "batchGet";
            readonly slowThreshold: number;
        }, {
            readonly operation: "list";
            readonly slowThreshold: number;
        }, {
            readonly operation: "query";
            readonly slowThreshold: number;
        }, {
            readonly operation: "scan";
            readonly slowThreshold: number;
        }, {
            readonly operation: "create";
            readonly slowThreshold: number;
        }, {
            readonly operation: "update";
            readonly slowThreshold: number;
        }, {
            readonly operation: "upsert";
            readonly slowThreshold: number;
        }, {
            readonly operation: "delete";
            readonly slowThreshold: number;
        }, {
            readonly operation: "batchDelete";
            readonly slowThreshold: number;
        }];
    };
    readonly operationNormalization: {
        readonly enabled: true;
        readonly storeOriginal: true;
    };
    readonly noiseReduction: {
        enabled: false;
        hardSignals: {
            levels: ("error" | "critical")[];
            includeWarn: false;
            slowThresholdMs: number;
            slowThresholds: {
                'database.query': number;
                'external.api': number;
                'batch.process': number;
            };
        };
        presets: ("fw24.hotpaths" | "fw24.batch_processors")[];
        rules: never[];
        maxAbsorbedErrorsPerSpan: number;
        maxAbsorbedCausedByLinksPerSpan: number;
        maxAbsorbedEntityIdsPerSpan: number;
        maxAbsorbedOperationKeysPerSpan: number;
        maxAbsorbedCheckpointsPerSpan: number;
    };
    readonly truncation: {
        enabled: false;
        maxBytes: number;
        fields: ("metadata" | "actor" | "data" | "attributes" | "context")[];
    };
    readonly dynamoMaxItemSize: number;
    readonly dynamoMaxBatchSize: 25;
    readonly dynamoMaxBufferSize: 1000;
    readonly tagFiltering: {
        readonly include: string[];
        readonly maxTags: 10;
    };
    readonly metricFiltering: {
        readonly enabled: false;
        readonly mode: "whitelist";
    };
    readonly metricSampling: {
        readonly enabled: false;
        readonly rate: 0.1;
        readonly alwaysPublishOn: "both";
        readonly thresholds: {
            readonly slowDurationMs: 1000;
        };
    };
    readonly cloudwatchNamespaceStrategy: "single";
};
export declare const DEFAULT_OPERATION_NORMALIZATION_RULES: NonNullable<ObservabilityConfig['operationNormalization']>['rules'];
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
    types?: ObservabilityConfig['types'];
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
    operationNormalization?: ObservabilityConfig['operationNormalization'];
}
type WithOptionalEnabled<T> = T extends {
    enabled: boolean;
} ? (Omit<T, 'enabled'> & {
    enabled?: boolean;
}) : T;
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
export declare function extendPreset(preset: ObservabilityConfig, overrides: DeepPartial<ObservabilityConfigInput>): ObservabilityConfig;
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
export declare function createObservabilityConfig(input?: DeepPartial<ObservabilityConfigInput>): ObservabilityConfig;
/**
 * Validate observability configuration
 * Returns array of validation errors (empty if valid)
 */
export declare function validateConfig(config: ObservabilityConfig): string[];
export {};
