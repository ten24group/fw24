/**
 * Observability Configuration
 *
 * Factory function for creating typed, validated observability config.
 */
import { ObservabilityConfig, ObservabilityLevel, SamplingConfig, ObservabilityDataProtectionConfig } from './types';
/**
 * Valid backend types
 */
export declare const VALID_BACKENDS: readonly ["cloudwatch", "dynamodb", "otel"];
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
};
/**
 * Input type for createObservabilityConfig - all fields optional
 */
export interface ObservabilityConfigInput {
    enabled?: boolean;
    minLevel?: ObservabilityLevel;
    serviceName?: string;
    backends?: Array<{
        type: ValidBackend;
        enabled?: boolean;
        minLevel?: ObservabilityLevel;
    }>;
    sampling?: Partial<SamplingConfig>;
    cloudwatch?: {
        namespace?: string;
    };
    dynamodb?: {
        /** Logical table key - resolved to actual table name via env var {tableKey}_table */
        tableKey?: string;
        ttlDays?: number;
    };
    dataProtection?: Partial<ObservabilityDataProtectionConfig>;
    types?: ObservabilityConfig['types'];
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
export declare function createObservabilityConfig(input?: ObservabilityConfigInput): ObservabilityConfig;
/**
 * Validate observability configuration
 * Returns array of validation errors (empty if valid)
 */
export declare function validateConfig(config: ObservabilityConfig): string[];
