/**
 * Configuration Management for Observability
 *
 * Provides a structured way to manage observability configuration
 * with environment variable parsing and runtime updates.
 */
import { ObservabilityConfig, ObservabilityLevel, TypeSpecificConfig } from './types';
/**
 * Centralized configuration defaults
 * All magic strings in one place for easy reference and modification
 */
export declare const CONFIG_DEFAULTS: {
    readonly serviceName: "fw24-service";
    readonly cloudwatchNamespace: "FW24";
    readonly tableName: "ObservabilityLogs";
    readonly ttlDays: 90;
    readonly backends: readonly ["cloudwatch"];
    readonly minLevel: ObservabilityLevel.INFO;
    readonly enabled: true;
};
/**
 * Valid backend types
 */
export declare const VALID_BACKENDS: readonly ["cloudwatch", "dynamodb", "otel"];
export type ValidBackend = typeof VALID_BACKENDS[number];
/**
 * Configuration Manager for Observability
 *
 * Handles:
 * - Environment variable parsing (cached to avoid repeated parsing)
 * - Configuration validation
 * - Runtime configuration updates
 * - Type-specific configuration
 */
export declare class ConfigManager {
    private config;
    /** Cached environment config to avoid double parsing */
    private static cachedEnvConfig;
    constructor(config: Partial<ObservabilityConfig>);
    /**
     * Create ConfigManager from environment variables.
     * Results are cached to avoid repeated parsing on each instantiation.
     */
    static fromEnvironment(): ObservabilityConfig;
    /**
     * Clear the cached environment config (for testing)
     */
    static clearCache(): void;
    /**
     * Parse sampling configuration from environment
     */
    private static parseSamplingConfig;
    /**
     * Parse type-specific backend configuration
     */
    private static parseTypeSpecificConfig;
    /**
     * Build complete configuration
     *
     * Uses fromEnvironment() defaults if partial config is incomplete.
     * This ensures all fields are always populated.
     */
    private buildConfig;
    /**
     * Get a specific configuration value
     */
    get<K extends keyof ObservabilityConfig>(key: K): ObservabilityConfig[K];
    /**
     * Get the full configuration
     */
    getAll(): ObservabilityConfig;
    /**
     * Update configuration at runtime
     * @param updates - Partial configuration to merge
     * @param validate - Whether to validate the resulting config (default: true)
     * @throws Error if validation is enabled and config is invalid
     */
    update(updates: Partial<ObservabilityConfig>, validate?: boolean): void;
    /**
     * Get type-specific configuration
     */
    getTypeConfig(type: keyof NonNullable<ObservabilityConfig['types']>): TypeSpecificConfig | undefined;
    /**
     * Check if a specific backend is enabled for a type
     */
    isBackendEnabledForType(backendName: 'cloudwatch' | 'dynamodb' | 'otel', type: keyof NonNullable<ObservabilityConfig['types']>): boolean;
    /**
     * Get effective minimum level for a type
     */
    getEffectiveLevelForType(type: keyof NonNullable<ObservabilityConfig['types']>): ObservabilityLevel;
}
/**
 * Validate observability configuration
 * Returns array of validation errors (empty if valid)
 */
export declare function validateConfig(config: ObservabilityConfig): string[];
