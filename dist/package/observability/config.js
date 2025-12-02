"use strict";
/**
 * Configuration Management for Observability
 *
 * Provides a structured way to manage observability configuration
 * with environment variable parsing and runtime updates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigManager = exports.VALID_BACKENDS = exports.CONFIG_DEFAULTS = void 0;
exports.validateConfig = validateConfig;
const logging_1 = require("../logging");
const types_1 = require("./types");
const logger = (0, logging_1.createLogger)('ObservabilityConfig');
/**
 * Centralized configuration defaults
 * All magic strings in one place for easy reference and modification
 */
exports.CONFIG_DEFAULTS = {
    serviceName: 'fw24-service',
    cloudwatchNamespace: 'FW24',
    tableName: 'ObservabilityLogs',
    ttlDays: 90,
    backends: ['cloudwatch'],
    minLevel: types_1.ObservabilityLevel.INFO,
    enabled: true,
};
/**
 * Valid backend types
 */
exports.VALID_BACKENDS = ['cloudwatch', 'dynamodb', 'otel'];
/**
 * Configuration Manager for Observability
 *
 * Handles:
 * - Environment variable parsing (cached to avoid repeated parsing)
 * - Configuration validation
 * - Runtime configuration updates
 * - Type-specific configuration
 */
class ConfigManager {
    config;
    /** Cached environment config to avoid double parsing */
    static cachedEnvConfig = null;
    constructor(config) {
        this.config = this.buildConfig(config);
        // Validate the constructed config
        const errors = validateConfig(this.config);
        if (errors.length > 0) {
            logger.warn('ConfigManager created with potentially invalid config:', errors);
        }
    }
    /**
     * Create ConfigManager from environment variables.
     * Results are cached to avoid repeated parsing on each instantiation.
     */
    static fromEnvironment() {
        // Return cached config if available
        if (ConfigManager.cachedEnvConfig) {
            return ConfigManager.cachedEnvConfig;
        }
        const enabled = (process.env.OBSERVABILITY_ENABLED ?? String(exports.CONFIG_DEFAULTS.enabled)).toLowerCase() !== 'false';
        const levelName = (process.env.OBSERVABILITY_LEVEL ?? 'INFO').toUpperCase();
        const parsedLevel = types_1.ObservabilityLevel[levelName];
        if (parsedLevel === undefined && process.env.OBSERVABILITY_LEVEL) {
            logger.warn(`Invalid OBSERVABILITY_LEVEL: '${process.env.OBSERVABILITY_LEVEL}'. ` +
                `Valid values: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL, OFF. Using default INFO.`);
        }
        const minLevel = parsedLevel ?? exports.CONFIG_DEFAULTS.minLevel;
        // Parse sampling configuration
        const sampling = ConfigManager.parseSamplingConfig();
        // Parse type-specific backends
        const types = ConfigManager.parseTypeSpecificConfig();
        // Parse backend list (just names for config, actual instances created separately)
        const rawBackendNames = (process.env.OBSERVABILITY_BACKENDS ?? exports.CONFIG_DEFAULTS.backends.join(','))
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean);
        // Validate and filter backend names
        const backendNames = rawBackendNames.filter((name) => {
            if (exports.VALID_BACKENDS.includes(name)) {
                return true;
            }
            logger.warn(`Invalid backend '${name}' in OBSERVABILITY_BACKENDS. ` +
                `Valid values: ${exports.VALID_BACKENDS.join(', ')}. Ignoring.`);
            return false;
        });
        // Warn if no backends are configured (likely misconfiguration)
        if (backendNames.length === 0 && process.env.OBSERVABILITY_BACKENDS !== undefined) {
            logger.warn('No valid backends configured via OBSERVABILITY_BACKENDS. ' +
                'Observability events will not be captured. ' +
                'Remove the env var to use default (cloudwatch) or set valid backends.');
        }
        // Service name (used by CloudWatch, OTEL, etc.)
        const serviceName = process.env.SERVICE_NAME ?? exports.CONFIG_DEFAULTS.serviceName;
        // CloudWatch configuration
        const cloudwatch = {
            namespace: process.env.CLOUDWATCH_METRICS_NAMESPACE ?? exports.CONFIG_DEFAULTS.cloudwatchNamespace,
        };
        const rawTtl = process.env.OBSERVABILITY_TTL_DAYS;
        let ttlDays = exports.CONFIG_DEFAULTS.ttlDays;
        if (rawTtl) {
            const parsed = parseInt(rawTtl, 10);
            if (isNaN(parsed) || parsed < 1) {
                logger.warn(`Invalid OBSERVABILITY_TTL_DAYS: '${rawTtl}'. Using default ${exports.CONFIG_DEFAULTS.ttlDays}.`);
            }
            else {
                ttlDays = parsed;
            }
        }
        // DynamoDB configuration
        const dynamodb = {
            tableName: process.env.OBSERVABILITY_TABLE_NAME ?? exports.CONFIG_DEFAULTS.tableName,
            ttlDays,
        };
        const config = {
            enabled,
            minLevel,
            sampling,
            backends: backendNames.map(type => ({
                type: type,
                enabled: true
            })),
            types: Object.keys(types).length > 0 ? types : undefined,
            serviceName,
            cloudwatch,
            dynamodb,
        };
        // Validate the final configuration
        const errors = validateConfig(config);
        if (errors.length > 0) {
            logger.error('Invalid observability config from environment:', errors);
            // Don't throw - log errors but continue with potentially partial config
            // This allows the application to start even with config issues
        }
        // Cache the result
        ConfigManager.cachedEnvConfig = config;
        return config;
    }
    /**
     * Clear the cached environment config (for testing)
     */
    static clearCache() {
        ConfigManager.cachedEnvConfig = null;
    }
    /**
     * Parse sampling configuration from environment
     */
    static parseSamplingConfig() {
        const enabled = process.env.OBSERVABILITY_SAMPLING_ENABLED === 'true';
        if (!enabled) {
            return types_1.DefaultSamplingConfig;
        }
        const rates = {
            [types_1.ObservabilityLevel.CRITICAL]: 1,
            [types_1.ObservabilityLevel.ERROR]: 1,
            [types_1.ObservabilityLevel.WARN]: 1,
            [types_1.ObservabilityLevel.INFO]: 1,
            [types_1.ObservabilityLevel.DEBUG]: 1,
            [types_1.ObservabilityLevel.TRACE]: 1,
            [types_1.ObservabilityLevel.OFF]: 0,
        };
        // Parse level-specific rates
        const levelEnvMappings = [
            ['OBSERVABILITY_SAMPLING_TRACE', types_1.ObservabilityLevel.TRACE],
            ['OBSERVABILITY_SAMPLING_DEBUG', types_1.ObservabilityLevel.DEBUG],
            ['OBSERVABILITY_SAMPLING_INFO', types_1.ObservabilityLevel.INFO],
            ['OBSERVABILITY_SAMPLING_WARN', types_1.ObservabilityLevel.WARN],
            ['OBSERVABILITY_SAMPLING_ERROR', types_1.ObservabilityLevel.ERROR],
        ];
        for (const [envVar, level] of levelEnvMappings) {
            const value = process.env[envVar];
            if (value) {
                const rate = parseFloat(value);
                if (!isNaN(rate) && rate >= 0 && rate <= 1) {
                    rates[level] = rate;
                }
                else {
                    logger.warn(`Invalid sampling rate for ${envVar}: '${value}'. ` +
                        'Must be a number between 0 and 1. Using default rate 1.0.');
                }
            }
        }
        // Parse operation-specific rates (JSON format)
        let operations;
        const operationsJson = process.env.OBSERVABILITY_SAMPLING_OPERATIONS;
        if (operationsJson) {
            try {
                const parsed = JSON.parse(operationsJson);
                // Validate structure
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    logger.warn('Invalid OBSERVABILITY_SAMPLING_OPERATIONS: expected JSON object. ' +
                        `Got: ${typeof parsed}. Using default sampling.`);
                }
                else {
                    // Validate each rate is a number between 0 and 1
                    let valid = true;
                    for (const [key, value] of Object.entries(parsed)) {
                        if (typeof value !== 'number' || value < 0 || value > 1) {
                            logger.warn(`Invalid sampling rate for operation '${key}': ${value}. ` +
                                'Must be a number between 0 and 1. Ignoring this operation.');
                            valid = false;
                        }
                    }
                    if (valid) {
                        operations = parsed;
                    }
                    else {
                        // Filter out invalid entries
                        operations = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= 1));
                    }
                }
            }
            catch (error) {
                logger.warn(`Failed to parse OBSERVABILITY_SAMPLING_OPERATIONS: ${error instanceof Error ? error.message : 'Invalid JSON'}. ` +
                    'Using default sampling. Expected format: {"operation.pattern": 0.5}');
            }
        }
        return {
            enabled,
            rates,
            operations,
        };
    }
    /**
     * Parse type-specific backend configuration
     */
    static parseTypeSpecificConfig() {
        const types = {};
        const typeEnvMappings = [
            ['OBSERVABILITY_SPAN_BACKENDS', 'span'],
            ['OBSERVABILITY_METRIC_BACKENDS', 'metric'],
            ['OBSERVABILITY_AUDIT_BACKENDS', 'audit'],
            ['OBSERVABILITY_LOG_BACKENDS', 'log'],
            ['OBSERVABILITY_DECISION_BACKENDS', 'decision'],
            ['OBSERVABILITY_WORKFLOW_BACKENDS', 'workflow'],
            ['OBSERVABILITY_ACCESS_BACKENDS', 'access'],
        ];
        for (const [envVar, typeKey] of typeEnvMappings) {
            const value = process.env[envVar];
            if (value) {
                const rawBackends = value.split(',').map((b) => b.trim().toLowerCase());
                // Validate backend names
                const validBackends = rawBackends.filter((name) => {
                    if (exports.VALID_BACKENDS.includes(name)) {
                        return true;
                    }
                    logger.warn(`Invalid backend '${name}' in ${envVar}. ` +
                        `Valid values: ${exports.VALID_BACKENDS.join(', ')}. Ignoring.`);
                    return false;
                });
                if (validBackends.length > 0) {
                    types[typeKey] = { backends: validBackends };
                }
            }
        }
        // Parse type-specific levels
        const levelEnvMappings = [
            ['OBSERVABILITY_SPAN_LEVEL', 'span'],
            ['OBSERVABILITY_METRIC_LEVEL', 'metric'],
            ['OBSERVABILITY_AUDIT_LEVEL', 'audit'],
            ['OBSERVABILITY_LOG_LEVEL', 'log'],
            ['OBSERVABILITY_DECISION_LEVEL', 'decision'],
            ['OBSERVABILITY_WORKFLOW_LEVEL', 'workflow'],
            ['OBSERVABILITY_ACCESS_LEVEL', 'access'],
        ];
        for (const [envVar, typeKey] of levelEnvMappings) {
            const value = process.env[envVar]?.toUpperCase();
            if (value) {
                const parsedLevel = types_1.ObservabilityLevel[value];
                if (parsedLevel !== undefined) {
                    types[typeKey] = {
                        ...types[typeKey],
                        minLevel: parsedLevel,
                    };
                }
                else {
                    logger.warn(`Invalid ${envVar}: '${process.env[envVar]}'. ` +
                        `Valid values: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL, OFF. Using default.`);
                }
            }
        }
        return types;
    }
    /**
     * Build complete configuration
     *
     * Uses fromEnvironment() defaults if partial config is incomplete.
     * This ensures all fields are always populated.
     */
    buildConfig(partial) {
        // Get defaults from environment as baseline
        const defaults = ConfigManager.fromEnvironment();
        return {
            enabled: partial.enabled !== undefined ? partial.enabled : defaults.enabled,
            minLevel: partial.minLevel !== undefined ? partial.minLevel : defaults.minLevel,
            sampling: partial.sampling ?? defaults.sampling,
            backends: partial.backends ?? defaults.backends,
            types: partial.types ?? defaults.types,
            serviceName: partial.serviceName ?? defaults.serviceName,
            cloudwatch: partial.cloudwatch ?? defaults.cloudwatch,
            dynamodb: partial.dynamodb ?? defaults.dynamodb,
        };
    }
    /**
     * Get a specific configuration value
     */
    get(key) {
        return this.config[key];
    }
    /**
     * Get the full configuration
     */
    getAll() {
        return { ...this.config };
    }
    /**
     * Update configuration at runtime
     * @param updates - Partial configuration to merge
     * @param validate - Whether to validate the resulting config (default: true)
     * @throws Error if validation is enabled and config is invalid
     */
    update(updates, validate = true) {
        const newConfig = { ...this.config, ...updates };
        if (validate) {
            const errors = validateConfig(newConfig);
            if (errors.length > 0) {
                throw new Error(`Invalid config update: ${errors.join(', ')}`);
            }
        }
        this.config = newConfig;
    }
    /**
     * Get type-specific configuration
     */
    getTypeConfig(type) {
        return this.config.types?.[type];
    }
    /**
     * Check if a specific backend is enabled for a type
     */
    isBackendEnabledForType(backendName, type) {
        const typeConfig = this.getTypeConfig(type);
        if (typeConfig?.backends) {
            return typeConfig.backends.includes(backendName);
        }
        // If no type-specific config, all backends are enabled
        return true;
    }
    /**
     * Get effective minimum level for a type
     */
    getEffectiveLevelForType(type) {
        const typeConfig = this.getTypeConfig(type);
        return typeConfig?.minLevel ?? this.config.minLevel;
    }
}
exports.ConfigManager = ConfigManager;
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
    if (config.sampling.enabled) {
        Object.entries(config.sampling.rates).forEach(([level, rate]) => {
            if (typeof rate !== 'number' || rate < 0 || rate > 1) {
                errors.push(`Invalid sampling rate for ${level}: ${rate}. Must be between 0 and 1.`);
            }
        });
    }
    // Validate backend types
    const validBackendTypes = ['cloudwatch', 'dynamodb', 'otel'];
    config.backends.forEach((backend, index) => {
        if (!validBackendTypes.includes(backend.type)) {
            errors.push(`Invalid backend type at index ${index}: ${backend.type}`);
        }
    });
    // Validate serviceName
    if (!config.serviceName || config.serviceName.trim() === '') {
        errors.push('serviceName is required and cannot be empty');
    }
    // Validate cloudwatch.namespace
    if (!config.cloudwatch.namespace || config.cloudwatch.namespace.trim() === '') {
        errors.push('cloudwatch.namespace is required and cannot be empty');
    }
    // Validate dynamodb.tableName
    if (!config.dynamodb.tableName || config.dynamodb.tableName.trim() === '') {
        errors.push('dynamodb.tableName is required and cannot be empty');
    }
    // Validate dynamodb.ttlDays
    if (typeof config.dynamodb.ttlDays !== 'number' || config.dynamodb.ttlDays < 1) {
        errors.push(`Invalid dynamodb.ttlDays: ${config.dynamodb.ttlDays}. Must be a positive number.`);
    }
    return errors;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7O0FBdWFILHdDQStDQztBQXBkRCx3Q0FBMEM7QUFDMUMsbUNBTWlCO0FBRWpCLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxxQkFBcUIsQ0FBQyxDQUFDO0FBRW5EOzs7R0FHRztBQUNVLFFBQUEsZUFBZSxHQUFHO0lBQzdCLFdBQVcsRUFBRSxjQUFjO0lBQzNCLG1CQUFtQixFQUFFLE1BQU07SUFDM0IsU0FBUyxFQUFFLG1CQUFtQjtJQUM5QixPQUFPLEVBQUUsRUFBRTtJQUNYLFFBQVEsRUFBRSxDQUFFLFlBQVksQ0FBVztJQUNuQyxRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSTtJQUNqQyxPQUFPLEVBQUUsSUFBSTtDQUNMLENBQUM7QUFFWDs7R0FFRztBQUNVLFFBQUEsY0FBYyxHQUFHLENBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQVcsQ0FBQztBQUc1RTs7Ozs7Ozs7R0FRRztBQUNILE1BQWEsYUFBYTtJQUNoQixNQUFNLENBQXNCO0lBRXBDLHdEQUF3RDtJQUNoRCxNQUFNLENBQUMsZUFBZSxHQUErQixJQUFJLENBQUM7SUFFbEUsWUFBWSxNQUFvQztRQUM5QyxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDdkMsa0NBQWtDO1FBQ2xDLE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDM0MsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sQ0FBQyxJQUFJLENBQUMsd0RBQXdELEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDaEYsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFD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ekUsQ0FBQztJQUNILENBQUMsQ0FBQyxDQUFDO0lBRUgsdUJBQXVCO0lBQ3ZCLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxJQUFJLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7UUFDNUQsTUFBTSxDQUFDLElBQUksQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDO0lBQzdELENBQUM7SUFFRCxnQ0FBZ0M7SUFDaEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsU0FBUyxJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDO1FBQzlFLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0RBQXNELENBQUMsQ0FBQztJQUN0RSxDQUFDO0lBRUQsOEJBQThCO0lBQzlCLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQztRQUMxRSxNQUFNLENBQUMsSUFBSSxDQUFDLG9EQUFvRCxDQUFDLENBQUM7SUFDcEUsQ0FBQztJQUVELDRCQUE0QjtJQUM1QixJQUFJLE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQy9FLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyw4QkFBOEIsQ0FBQyxDQUFDO0lBQ2xHLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDb25maWd1cmF0aW9uIE1hbmFnZW1lbnQgZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogUHJvdmlkZXMgYSBzdHJ1Y3R1cmVkIHdheSB0byBtYW5hZ2Ugb2JzZXJ2YWJpbGl0eSBjb25maWd1cmF0aW9uXG4gKiB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlIHBhcnNpbmcgYW5kIHJ1bnRpbWUgdXBkYXRlcy5cbiAqL1xuXG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7XG4gIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgU2FtcGxpbmdDb25maWcsXG4gIFR5cGVTcGVjaWZpY0NvbmZpZyxcbiAgRGVmYXVsdFNhbXBsaW5nQ29uZmlnLFxufSBmcm9tICcuL3R5cGVzJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPYnNlcnZhYmlsaXR5Q29uZmlnJyk7XG5cbi8qKlxuICogQ2VudHJhbGl6ZWQgY29uZmlndXJhdGlvbiBkZWZhdWx0c1xuICogQWxsIG1hZ2ljIHN0cmluZ3MgaW4gb25lIHBsYWNlIGZvciBlYXN5IHJlZmVyZW5jZSBhbmQgbW9kaWZpY2F0aW9uXG4gKi9cbmV4cG9ydCBjb25zdCBDT05GSUdfREVGQVVMVFMgPSB7XG4gIHNlcnZpY2VOYW1lOiAnZncyNC1zZXJ2aWNlJyxcbiAgY2xvdWR3YXRjaE5hbWVzcGFjZTogJ0ZXMjQnLFxuICB0YWJsZU5hbWU6ICdPYnNlcnZhYmlsaXR5TG9ncycsXG4gIHR0bERheXM6IDkwLFxuICBiYWNrZW5kczogWyAnY2xvdWR3YXRjaCcgXSBhcyBjb25zdCxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICBlbmFibGVkOiB0cnVlLFxufSBhcyBjb25zdDtcblxuLyoqXG4gKiBWYWxpZCBiYWNrZW5kIHR5cGVzXG4gKi9cbmV4cG9ydCBjb25zdCBWQUxJRF9CQUNLRU5EUyA9IFsgJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInLCAnb3RlbCcgXSBhcyBjb25zdDtcbmV4cG9ydCB0eXBlIFZhbGlkQmFja2VuZCA9IHR5cGVvZiBWQUxJRF9CQUNLRU5EU1sgbnVtYmVyIF07XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBNYW5hZ2VyIGZvciBPYnNlcnZhYmlsaXR5XG4gKiBcbiAqIEhhbmRsZXM6XG4gKiAtIEVudmlyb25tZW50IHZhcmlhYmxlIHBhcnNpbmcgKGNhY2hlZCB0byBhdm9pZCByZXBlYXRlZCBwYXJzaW5nKVxuICogLSBDb25maWd1cmF0aW9uIHZhbGlkYXRpb25cbiAqIC0gUnVudGltZSBjb25maWd1cmF0aW9uIHVwZGF0ZXNcbiAqIC0gVHlwZS1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gKi9cbmV4cG9ydCBjbGFzcyBDb25maWdNYW5hZ2VyIHtcbiAgcHJpdmF0ZSBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWc7XG5cbiAgLyoqIENhY2hlZCBlbnZpcm9ubWVudCBjb25maWcgdG8gYXZvaWQgZG91YmxlIHBhcnNpbmcgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgY2FjaGVkRW52Q29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KSB7XG4gICAgdGhpcy5jb25maWcgPSB0aGlzLmJ1aWxkQ29uZmlnKGNvbmZpZyk7XG4gICAgLy8gVmFsaWRhdGUgdGhlIGNvbnN0cnVjdGVkIGNvbmZpZ1xuICAgIGNvbnN0IGVycm9ycyA9IHZhbGlkYXRlQ29uZmlnKHRoaXMuY29uZmlnKTtcbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdDb25maWdNYW5hZ2VyIGNyZWF0ZWQgd2l0aCBwb3RlbnRpYWxseSBpbnZhbGlkIGNvbmZpZzonLCBlcnJvcnMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgQ29uZmlnTWFuYWdlciBmcm9tIGVudmlyb25tZW50IHZhcmlhYmxlcy5cbiAgICogUmVzdWx0cyBhcmUgY2FjaGVkIHRvIGF2b2lkIHJlcGVhdGVkIHBhcnNpbmcgb24gZWFjaCBpbnN0YW50aWF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGZyb21FbnZpcm9ubWVudCgpOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgICAvLyBSZXR1cm4gY2FjaGVkIGNvbmZpZyBpZiBhdmFpbGFibGVcbiAgICBpZiAoQ29uZmlnTWFuYWdlci5jYWNoZWRFbnZDb25maWcpIHtcbiAgICAgIHJldHVybiBDb25maWdNYW5hZ2VyLmNhY2hlZEVudkNvbmZpZztcbiAgICB9XG5cbiAgICBjb25zdCBlbmFibGVkID0gKHByb2Nlc3MuZW52Lk9CU0VSVkFCSUxJVFlfRU5BQkxFRCA/PyBTdHJpbmcoQ09ORklHX0RFRkFVTFRTLmVuYWJsZWQpKS50b0xvd2VyQ2FzZSgpICE9PSAnZmFsc2UnO1xuICAgIGNvbnN0IGxldmVsTmFtZSA9IChwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0xFVkVMID8/ICdJTkZPJykudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBwYXJzZWRMZXZlbCA9IE9ic2VydmFiaWxpdHlMZXZlbFsgbGV2ZWxOYW1lIGFzIGtleW9mIHR5cGVvZiBPYnNlcnZhYmlsaXR5TGV2ZWwgXTtcbiAgICBpZiAocGFyc2VkTGV2ZWwgPT09IHVuZGVmaW5lZCAmJiBwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0xFVkVMKSB7XG4gICAgICBsb2dnZXIud2FybihcbiAgICAgICAgYEludmFsaWQgT0JTRVJWQUJJTElUWV9MRVZFTDogJyR7cHJvY2Vzcy5lbnYuT0JTRVJWQUJJTElUWV9MRVZFTH0nLiBgICtcbiAgICAgICAgYFZhbGlkIHZhbHVlczogVFJBQ0UsIERFQlVHLCBJTkZPLCBXQVJOLCBFUlJPUiwgQ1JJVElDQUwsIE9GRi4gVXNpbmcgZGVmYXVsdCBJTkZPLmBcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IG1pbkxldmVsID0gcGFyc2VkTGV2ZWwgPz8gQ09ORklHX0RFRkFVTFRTLm1pbkxldmVsO1xuXG4gICAgLy8gUGFyc2Ugc2FtcGxpbmcgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IHNhbXBsaW5nID0gQ29uZmlnTWFuYWdlci5wYXJzZVNhbXBsaW5nQ29uZmlnKCk7XG5cbiAgICAvLyBQYXJzZSB0eXBlLXNwZWNpZmljIGJhY2tlbmRzXG4gICAgY29uc3QgdHlwZXMgPSBDb25maWdNYW5hZ2VyLnBhcnNlVHlwZVNwZWNpZmljQ29uZmlnKCk7XG5cbiAgICAvLyBQYXJzZSBiYWNrZW5kIGxpc3QgKGp1c3QgbmFtZXMgZm9yIGNvbmZpZywgYWN0dWFsIGluc3RhbmNlcyBjcmVhdGVkIHNlcGFyYXRlbHkpXG4gICAgY29uc3QgcmF3QmFja2VuZE5hbWVzID0gKHByb2Nlc3MuZW52Lk9CU0VSVkFCSUxJVFlfQkFDS0VORFMgPz8gQ09ORklHX0RFRkFVTFRTLmJhY2tlbmRzLmpvaW4oJywnKSlcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChuYW1lKSA9PiBuYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcblxuICAgIC8vIFZhbGlkYXRlIGFuZCBmaWx0ZXIgYmFja2VuZCBuYW1lc1xuICAgIGNvbnN0IGJhY2tlbmROYW1lcyA9IHJhd0JhY2tlbmROYW1lcy5maWx0ZXIoKG5hbWUpID0+IHtcbiAgICAgIGlmIChWQUxJRF9CQUNLRU5EUy5pbmNsdWRlcyhuYW1lIGFzIFZhbGlkQmFja2VuZCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICBsb2dnZXIud2FybihcbiAgICAgICAgYEludmFsaWQgYmFja2VuZCAnJHtuYW1lfScgaW4gT0JTRVJWQUJJTElUWV9CQUNLRU5EUy4gYCArXG4gICAgICAgIGBWYWxpZCB2YWx1ZXM6ICR7VkFMSURfQkFDS0VORFMuam9pbignLCAnKX0uIElnbm9yaW5nLmBcbiAgICAgICk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSk7XG5cbiAgICAvLyBXYXJuIGlmIG5vIGJhY2tlbmRzIGFyZSBjb25maWd1cmVkIChsaWtlbHkgbWlzY29uZmlndXJhdGlvbilcbiAgICBpZiAoYmFja2VuZE5hbWVzLmxlbmd0aCA9PT0gMCAmJiBwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0JBQ0tFTkRTICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKFxuICAgICAgICAnTm8gdmFsaWQgYmFja2VuZHMgY29uZmlndXJlZCB2aWEgT0JTRVJWQUJJTElUWV9CQUNLRU5EUy4gJyArXG4gICAgICAgICdPYnNlcnZhYmlsaXR5IGV2ZW50cyB3aWxsIG5vdCBiZSBjYXB0dXJlZC4gJyArXG4gICAgICAgICdSZW1vdmUgdGhlIGVudiB2YXIgdG8gdXNlIGRlZmF1bHQgKGNsb3Vkd2F0Y2gpIG9yIHNldCB2YWxpZCBiYWNrZW5kcy4nXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFNlcnZpY2UgbmFtZSAodXNlZCBieSBDbG91ZFdhdGNoLCBPVEVMLCBldGMuKVxuICAgIGNvbnN0IHNlcnZpY2VOYW1lID0gcHJvY2Vzcy5lbnYuU0VSVklDRV9OQU1FID8/IENPTkZJR19ERUZBVUxUUy5zZXJ2aWNlTmFtZTtcblxuICAgIC8vIENsb3VkV2F0Y2ggY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGNsb3Vkd2F0Y2ggPSB7XG4gICAgICBuYW1lc3BhY2U6IHByb2Nlc3MuZW52LkNMT1VEV0FUQ0hfTUVUUklDU19OQU1FU1BBQ0UgPz8gQ09ORklHX0RFRkFVTFRTLmNsb3Vkd2F0Y2hOYW1lc3BhY2UsXG4gICAgfTtcblxuICAgIGNvbnN0IHJhd1R0bCA9IHByb2Nlc3MuZW52Lk9CU0VSVkFCSUxJVFlfVFRMX0RBWVM7XG4gICAgbGV0IHR0bERheXM6IG51bWJlciA9IENPTkZJR19ERUZBVUxUUy50dGxEYXlzO1xuICAgIGlmIChyYXdUdGwpIHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlSW50KHJhd1R0bCwgMTApO1xuICAgICAgaWYgKGlzTmFOKHBhcnNlZCkgfHwgcGFyc2VkIDwgMSkge1xuICAgICAgICBsb2dnZXIud2FybihgSW52YWxpZCBPQlNFUlZBQklMSVRZX1RUTF9EQVlTOiAnJHtyYXdUdGx9Jy4gVXNpbmcgZGVmYXVsdCAke0NPTkZJR19ERUZBVUxUUy50dGxEYXlzfS5gKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHR0bERheXMgPSBwYXJzZWQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRHluYW1vREIgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGR5bmFtb2RiID0ge1xuICAgICAgdGFibGVOYW1lOiBwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX1RBQkxFX05BTUUgPz8gQ09ORklHX0RFRkFVTFRTLnRhYmxlTmFtZSxcbiAgICAgIHR0bERheXMsXG4gICAgfTtcblxuICAgIGNvbnN0IGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyA9IHtcbiAgICAgIGVuYWJsZWQsXG4gICAgICBtaW5MZXZlbCxcbiAgICAgIHNhbXBsaW5nLFxuICAgICAgYmFja2VuZHM6IGJhY2tlbmROYW1lcy5tYXAodHlwZSA9PiAoe1xuICAgICAgICB0eXBlOiB0eXBlIGFzIFZhbGlkQmFja2VuZCxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgfSkpLFxuICAgICAgdHlwZXM6IE9iamVjdC5rZXlzKHR5cGVzKS5sZW5ndGggPiAwID8gdHlwZXMgOiB1bmRlZmluZWQsXG4gICAgICBzZXJ2aWNlTmFtZSxcbiAgICAgIGNsb3Vkd2F0Y2gsXG4gICAgICBkeW5hbW9kYixcbiAgICB9O1xuXG4gICAgLy8gVmFsaWRhdGUgdGhlIGZpbmFsIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgbG9nZ2VyLmVycm9yKCdJbnZhbGlkIG9ic2VydmFiaWxpdHkgY29uZmlnIGZyb20gZW52aXJvbm1lbnQ6JywgZXJyb3JzKTtcbiAgICAgIC8vIERvbid0IHRocm93IC0gbG9nIGVycm9ycyBidXQgY29udGludWUgd2l0aCBwb3RlbnRpYWxseSBwYXJ0aWFsIGNvbmZpZ1xuICAgICAgLy8gVGhpcyBhbGxvd3MgdGhlIGFwcGxpY2F0aW9uIHRvIHN0YXJ0IGV2ZW4gd2l0aCBjb25maWcgaXNzdWVzXG4gICAgfVxuXG4gICAgLy8gQ2FjaGUgdGhlIHJlc3VsdFxuICAgIENvbmZpZ01hbmFnZXIuY2FjaGVkRW52Q29uZmlnID0gY29uZmlnO1xuXG4gICAgcmV0dXJuIGNvbmZpZztcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhciB0aGUgY2FjaGVkIGVudmlyb25tZW50IGNvbmZpZyAoZm9yIHRlc3RpbmcpXG4gICAqL1xuICBzdGF0aWMgY2xlYXJDYWNoZSgpOiB2b2lkIHtcbiAgICBDb25maWdNYW5hZ2VyLmNhY2hlZEVudkNvbmZpZyA9IG51bGw7XG4gIH1cblxuICAvKipcbiAgICogUGFyc2Ugc2FtcGxpbmcgY29uZmlndXJhdGlvbiBmcm9tIGVudmlyb25tZW50XG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBwYXJzZVNhbXBsaW5nQ29uZmlnKCk6IFNhbXBsaW5nQ29uZmlnIHtcbiAgICBjb25zdCBlbmFibGVkID0gcHJvY2Vzcy5lbnYuT0JTRVJWQUJJTElUWV9TQU1QTElOR19FTkFCTEVEID09PSAndHJ1ZSc7XG5cbiAgICBpZiAoIWVuYWJsZWQpIHtcbiAgICAgIHJldHVybiBEZWZhdWx0U2FtcGxpbmdDb25maWc7XG4gICAgfVxuXG4gICAgY29uc3QgcmF0ZXM6IFJlY29yZDxPYnNlcnZhYmlsaXR5TGV2ZWwsIG51bWJlcj4gPSB7XG4gICAgICBbIE9ic2VydmFiaWxpdHlMZXZlbC5DUklUSUNBTCBdOiAxLFxuICAgICAgWyBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IgXTogMSxcbiAgICAgIFsgT2JzZXJ2YWJpbGl0eUxldmVsLldBUk4gXTogMSxcbiAgICAgIFsgT2JzZXJ2YWJpbGl0eUxldmVsLklORk8gXTogMSxcbiAgICAgIFsgT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHIF06IDEsXG4gICAgICBbIE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSBdOiAxLFxuICAgICAgWyBPYnNlcnZhYmlsaXR5TGV2ZWwuT0ZGIF06IDAsXG4gICAgfTtcblxuICAgIC8vIFBhcnNlIGxldmVsLXNwZWNpZmljIHJhdGVzXG4gICAgY29uc3QgbGV2ZWxFbnZNYXBwaW5nczogQXJyYXk8WyBzdHJpbmcsIE9ic2VydmFiaWxpdHlMZXZlbCBdPiA9IFtcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfU0FNUExJTkdfVFJBQ0UnLCBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UgXSxcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfU0FNUExJTkdfREVCVUcnLCBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcgXSxcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfU0FNUExJTkdfSU5GTycsIE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPIF0sXG4gICAgICBbICdPQlNFUlZBQklMSVRZX1NBTVBMSU5HX1dBUk4nLCBPYnNlcnZhYmlsaXR5TGV2ZWwuV0FSTiBdLFxuICAgICAgWyAnT0JTRVJWQUJJTElUWV9TQU1QTElOR19FUlJPUicsIE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUiBdLFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IFsgZW52VmFyLCBsZXZlbCBdIG9mIGxldmVsRW52TWFwcGluZ3MpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcHJvY2Vzcy5lbnZbIGVudlZhciBdO1xuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIGNvbnN0IHJhdGUgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgICAgICAgaWYgKCFpc05hTihyYXRlKSAmJiByYXRlID49IDAgJiYgcmF0ZSA8PSAxKSB7XG4gICAgICAgICAgcmF0ZXNbIGxldmVsIF0gPSByYXRlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxvZ2dlci53YXJuKFxuICAgICAgICAgICAgYEludmFsaWQgc2FtcGxpbmcgcmF0ZSBmb3IgJHtlbnZWYXJ9OiAnJHt2YWx1ZX0nLiBgICtcbiAgICAgICAgICAgICdNdXN0IGJlIGEgbnVtYmVyIGJldHdlZW4gMCBhbmQgMS4gVXNpbmcgZGVmYXVsdCByYXRlIDEuMC4nXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFBhcnNlIG9wZXJhdGlvbi1zcGVjaWZpYyByYXRlcyAoSlNPTiBmb3JtYXQpXG4gICAgbGV0IG9wZXJhdGlvbnM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQ7XG4gICAgY29uc3Qgb3BlcmF0aW9uc0pzb24gPSBwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX1NBTVBMSU5HX09QRVJBVElPTlM7XG4gICAgaWYgKG9wZXJhdGlvbnNKc29uKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG9wZXJhdGlvbnNKc29uKTtcbiAgICAgICAgLy8gVmFsaWRhdGUgc3RydWN0dXJlXG4gICAgICAgIGlmICh0eXBlb2YgcGFyc2VkICE9PSAnb2JqZWN0JyB8fCBwYXJzZWQgPT09IG51bGwgfHwgQXJyYXkuaXNBcnJheShwYXJzZWQpKSB7XG4gICAgICAgICAgbG9nZ2VyLndhcm4oXG4gICAgICAgICAgICAnSW52YWxpZCBPQlNFUlZBQklMSVRZX1NBTVBMSU5HX09QRVJBVElPTlM6IGV4cGVjdGVkIEpTT04gb2JqZWN0LiAnICtcbiAgICAgICAgICAgIGBHb3Q6ICR7dHlwZW9mIHBhcnNlZH0uIFVzaW5nIGRlZmF1bHQgc2FtcGxpbmcuYFxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gVmFsaWRhdGUgZWFjaCByYXRlIGlzIGEgbnVtYmVyIGJldHdlZW4gMCBhbmQgMVxuICAgICAgICAgIGxldCB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhwYXJzZWQpKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnbnVtYmVyJyB8fCB2YWx1ZSA8IDAgfHwgdmFsdWUgPiAxKSB7XG4gICAgICAgICAgICAgIGxvZ2dlci53YXJuKFxuICAgICAgICAgICAgICAgIGBJbnZhbGlkIHNhbXBsaW5nIHJhdGUgZm9yIG9wZXJhdGlvbiAnJHtrZXl9JzogJHt2YWx1ZX0uIGAgK1xuICAgICAgICAgICAgICAgICdNdXN0IGJlIGEgbnVtYmVyIGJldHdlZW4gMCBhbmQgMS4gSWdub3JpbmcgdGhpcyBvcGVyYXRpb24uJ1xuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgICAgIG9wZXJhdGlvbnMgPSBwYXJzZWQ7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZpbHRlciBvdXQgaW52YWxpZCBlbnRyaWVzXG4gICAgICAgICAgICBvcGVyYXRpb25zID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgICAgICAgICBPYmplY3QuZW50cmllcyhwYXJzZWQpLmZpbHRlcihcbiAgICAgICAgICAgICAgICAoWyAsIHYgXSkgPT4gdHlwZW9mIHYgPT09ICdudW1iZXInICYmIHYgPj0gMCAmJiB2IDw9IDFcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKSBhcyBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oXG4gICAgICAgICAgYEZhaWxlZCB0byBwYXJzZSBPQlNFUlZBQklMSVRZX1NBTVBMSU5HX09QRVJBVElPTlM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnSW52YWxpZCBKU09OJ30uIGAgK1xuICAgICAgICAgICdVc2luZyBkZWZhdWx0IHNhbXBsaW5nLiBFeHBlY3RlZCBmb3JtYXQ6IHtcIm9wZXJhdGlvbi5wYXR0ZXJuXCI6IDAuNX0nXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQsXG4gICAgICByYXRlcyxcbiAgICAgIG9wZXJhdGlvbnMsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSB0eXBlLXNwZWNpZmljIGJhY2tlbmQgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgcGFyc2VUeXBlU3BlY2lmaWNDb25maWcoKTogTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdPiB7XG4gICAgY29uc3QgdHlwZXM6IE5vbk51bGxhYmxlPE9ic2VydmFiaWxpdHlDb25maWdbICd0eXBlcycgXT4gPSB7fTtcblxuICAgIGNvbnN0IHR5cGVFbnZNYXBwaW5nczogQXJyYXk8WyBzdHJpbmcsIGtleW9mIE5vbk51bGxhYmxlPE9ic2VydmFiaWxpdHlDb25maWdbICd0eXBlcycgXT4gXT4gPSBbXG4gICAgICBbICdPQlNFUlZBQklMSVRZX1NQQU5fQkFDS0VORFMnLCAnc3BhbicgXSxcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfTUVUUklDX0JBQ0tFTkRTJywgJ21ldHJpYycgXSxcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfQVVESVRfQkFDS0VORFMnLCAnYXVkaXQnIF0sXG4gICAgICBbICdPQlNFUlZBQklMSVRZX0xPR19CQUNLRU5EUycsICdsb2cnIF0sXG4gICAgICBbICdPQlNFUlZBQklMSVRZX0RFQ0lTSU9OX0JBQ0tFTkRTJywgJ2RlY2lzaW9uJyBdLFxuICAgICAgWyAnT0JTRVJWQUJJTElUWV9XT1JLRkxPV19CQUNLRU5EUycsICd3b3JrZmxvdycgXSxcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfQUNDRVNTX0JBQ0tFTkRTJywgJ2FjY2VzcycgXSxcbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCBbIGVudlZhciwgdHlwZUtleSBdIG9mIHR5cGVFbnZNYXBwaW5ncykge1xuICAgICAgY29uc3QgdmFsdWUgPSBwcm9jZXNzLmVudlsgZW52VmFyIF07XG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgY29uc3QgcmF3QmFja2VuZHMgPSB2YWx1ZS5zcGxpdCgnLCcpLm1hcCgoYikgPT4gYi50cmltKCkudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIC8vIFZhbGlkYXRlIGJhY2tlbmQgbmFtZXNcbiAgICAgICAgY29uc3QgdmFsaWRCYWNrZW5kcyA9IHJhd0JhY2tlbmRzLmZpbHRlcigobmFtZSkgPT4ge1xuICAgICAgICAgIGlmIChWQUxJRF9CQUNLRU5EUy5pbmNsdWRlcyhuYW1lIGFzIFZhbGlkQmFja2VuZCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBsb2dnZXIud2FybihcbiAgICAgICAgICAgIGBJbnZhbGlkIGJhY2tlbmQgJyR7bmFtZX0nIGluICR7ZW52VmFyfS4gYCArXG4gICAgICAgICAgICBgVmFsaWQgdmFsdWVzOiAke1ZBTElEX0JBQ0tFTkRTLmpvaW4oJywgJyl9LiBJZ25vcmluZy5gXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0pIGFzICgnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKVtdO1xuXG4gICAgICAgIGlmICh2YWxpZEJhY2tlbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB0eXBlc1sgdHlwZUtleSBdID0geyBiYWNrZW5kczogdmFsaWRCYWNrZW5kcyB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgdHlwZS1zcGVjaWZpYyBsZXZlbHNcbiAgICBjb25zdCBsZXZlbEVudk1hcHBpbmdzOiBBcnJheTxbIHN0cmluZywga2V5b2YgTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdPiBdPiA9IFtcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfU1BBTl9MRVZFTCcsICdzcGFuJyBdLFxuICAgICAgWyAnT0JTRVJWQUJJTElUWV9NRVRSSUNfTEVWRUwnLCAnbWV0cmljJyBdLFxuICAgICAgWyAnT0JTRVJWQUJJTElUWV9BVURJVF9MRVZFTCcsICdhdWRpdCcgXSxcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfTE9HX0xFVkVMJywgJ2xvZycgXSxcbiAgICAgIFsgJ09CU0VSVkFCSUxJVFlfREVDSVNJT05fTEVWRUwnLCAnZGVjaXNpb24nIF0sXG4gICAgICBbICdPQlNFUlZBQklMSVRZX1dPUktGTE9XX0xFVkVMJywgJ3dvcmtmbG93JyBdLFxuICAgICAgWyAnT0JTRVJWQUJJTElUWV9BQ0NFU1NfTEVWRUwnLCAnYWNjZXNzJyBdLFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IFsgZW52VmFyLCB0eXBlS2V5IF0gb2YgbGV2ZWxFbnZNYXBwaW5ncykge1xuICAgICAgY29uc3QgdmFsdWUgPSBwcm9jZXNzLmVudlsgZW52VmFyIF0/LnRvVXBwZXJDYXNlKCk7XG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgY29uc3QgcGFyc2VkTGV2ZWwgPSBPYnNlcnZhYmlsaXR5TGV2ZWxbIHZhbHVlIGFzIGtleW9mIHR5cGVvZiBPYnNlcnZhYmlsaXR5TGV2ZWwgXTtcbiAgICAgICAgaWYgKHBhcnNlZExldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0eXBlc1sgdHlwZUtleSBdID0ge1xuICAgICAgICAgICAgLi4udHlwZXNbIHR5cGVLZXkgXSxcbiAgICAgICAgICAgIG1pbkxldmVsOiBwYXJzZWRMZXZlbCxcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxvZ2dlci53YXJuKFxuICAgICAgICAgICAgYEludmFsaWQgJHtlbnZWYXJ9OiAnJHtwcm9jZXNzLmVudlsgZW52VmFyIF19Jy4gYCArXG4gICAgICAgICAgICBgVmFsaWQgdmFsdWVzOiBUUkFDRSwgREVCVUcsIElORk8sIFdBUk4sIEVSUk9SLCBDUklUSUNBTCwgT0ZGLiBVc2luZyBkZWZhdWx0LmBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHR5cGVzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGNvbXBsZXRlIGNvbmZpZ3VyYXRpb25cbiAgICogXG4gICAqIFVzZXMgZnJvbUVudmlyb25tZW50KCkgZGVmYXVsdHMgaWYgcGFydGlhbCBjb25maWcgaXMgaW5jb21wbGV0ZS5cbiAgICogVGhpcyBlbnN1cmVzIGFsbCBmaWVsZHMgYXJlIGFsd2F5cyBwb3B1bGF0ZWQuXG4gICAqL1xuICBwcml2YXRlIGJ1aWxkQ29uZmlnKHBhcnRpYWw6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZz4pOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgICAvLyBHZXQgZGVmYXVsdHMgZnJvbSBlbnZpcm9ubWVudCBhcyBiYXNlbGluZVxuICAgIGNvbnN0IGRlZmF1bHRzID0gQ29uZmlnTWFuYWdlci5mcm9tRW52aXJvbm1lbnQoKTtcblxuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiBwYXJ0aWFsLmVuYWJsZWQgIT09IHVuZGVmaW5lZCA/IHBhcnRpYWwuZW5hYmxlZCA6IGRlZmF1bHRzLmVuYWJsZWQsXG4gICAgICBtaW5MZXZlbDogcGFydGlhbC5taW5MZXZlbCAhPT0gdW5kZWZpbmVkID8gcGFydGlhbC5taW5MZXZlbCA6IGRlZmF1bHRzLm1pbkxldmVsLFxuICAgICAgc2FtcGxpbmc6IHBhcnRpYWwuc2FtcGxpbmcgPz8gZGVmYXVsdHMuc2FtcGxpbmcsXG4gICAgICBiYWNrZW5kczogcGFydGlhbC5iYWNrZW5kcyA/PyBkZWZhdWx0cy5iYWNrZW5kcyxcbiAgICAgIHR5cGVzOiBwYXJ0aWFsLnR5cGVzID8/IGRlZmF1bHRzLnR5cGVzLFxuICAgICAgc2VydmljZU5hbWU6IHBhcnRpYWwuc2VydmljZU5hbWUgPz8gZGVmYXVsdHMuc2VydmljZU5hbWUsXG4gICAgICBjbG91ZHdhdGNoOiBwYXJ0aWFsLmNsb3Vkd2F0Y2ggPz8gZGVmYXVsdHMuY2xvdWR3YXRjaCxcbiAgICAgIGR5bmFtb2RiOiBwYXJ0aWFsLmR5bmFtb2RiID8/IGRlZmF1bHRzLmR5bmFtb2RiLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogR2V0IGEgc3BlY2lmaWMgY29uZmlndXJhdGlvbiB2YWx1ZVxuICAgKi9cbiAgZ2V0PEsgZXh0ZW5kcyBrZXlvZiBPYnNlcnZhYmlsaXR5Q29uZmlnPihrZXk6IEspOiBPYnNlcnZhYmlsaXR5Q29uZmlnWyBLIF0ge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZ1sga2V5IF07XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBmdWxsIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIGdldEFsbCgpOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgICByZXR1cm4geyAuLi50aGlzLmNvbmZpZyB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBjb25maWd1cmF0aW9uIGF0IHJ1bnRpbWVcbiAgICogQHBhcmFtIHVwZGF0ZXMgLSBQYXJ0aWFsIGNvbmZpZ3VyYXRpb24gdG8gbWVyZ2VcbiAgICogQHBhcmFtIHZhbGlkYXRlIC0gV2hldGhlciB0byB2YWxpZGF0ZSB0aGUgcmVzdWx0aW5nIGNvbmZpZyAoZGVmYXVsdDogdHJ1ZSlcbiAgICogQHRocm93cyBFcnJvciBpZiB2YWxpZGF0aW9uIGlzIGVuYWJsZWQgYW5kIGNvbmZpZyBpcyBpbnZhbGlkXG4gICAqL1xuICB1cGRhdGUodXBkYXRlczogUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnPiwgdmFsaWRhdGUgPSB0cnVlKTogdm9pZCB7XG4gICAgY29uc3QgbmV3Q29uZmlnID0geyAuLi50aGlzLmNvbmZpZywgLi4udXBkYXRlcyB9O1xuICAgIGlmICh2YWxpZGF0ZSkge1xuICAgICAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVDb25maWcobmV3Q29uZmlnKTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29uZmlnIHVwZGF0ZTogJHtlcnJvcnMuam9pbignLCAnKX1gKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5jb25maWcgPSBuZXdDb25maWc7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHR5cGUtc3BlY2lmaWMgY29uZmlndXJhdGlvblxuICAgKi9cbiAgZ2V0VHlwZUNvbmZpZyh0eXBlOiBrZXlvZiBOb25OdWxsYWJsZTxPYnNlcnZhYmlsaXR5Q29uZmlnWyAndHlwZXMnIF0+KTogVHlwZVNwZWNpZmljQ29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWcudHlwZXM/LlsgdHlwZSBdO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGEgc3BlY2lmaWMgYmFja2VuZCBpcyBlbmFibGVkIGZvciBhIHR5cGVcbiAgICovXG4gIGlzQmFja2VuZEVuYWJsZWRGb3JUeXBlKFxuICAgIGJhY2tlbmROYW1lOiAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnLFxuICAgIHR5cGU6IGtleW9mIE5vbk51bGxhYmxlPE9ic2VydmFiaWxpdHlDb25maWdbICd0eXBlcycgXT5cbiAgKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdHlwZUNvbmZpZyA9IHRoaXMuZ2V0VHlwZUNvbmZpZyh0eXBlKTtcbiAgICBpZiAodHlwZUNvbmZpZz8uYmFja2VuZHMpIHtcbiAgICAgIHJldHVybiB0eXBlQ29uZmlnLmJhY2tlbmRzLmluY2x1ZGVzKGJhY2tlbmROYW1lKTtcbiAgICB9XG4gICAgLy8gSWYgbm8gdHlwZS1zcGVjaWZpYyBjb25maWcsIGFsbCBiYWNrZW5kcyBhcmUgZW5hYmxlZFxuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBlZmZlY3RpdmUgbWluaW11bSBsZXZlbCBmb3IgYSB0eXBlXG4gICAqL1xuICBnZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZToga2V5b2YgTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdPik6IE9ic2VydmFiaWxpdHlMZXZlbCB7XG4gICAgY29uc3QgdHlwZUNvbmZpZyA9IHRoaXMuZ2V0VHlwZUNvbmZpZyh0eXBlKTtcbiAgICByZXR1cm4gdHlwZUNvbmZpZz8ubWluTGV2ZWwgPz8gdGhpcy5jb25maWcubWluTGV2ZWw7XG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZSBvYnNlcnZhYmlsaXR5IGNvbmZpZ3VyYXRpb25cbiAqIFJldHVybnMgYXJyYXkgb2YgdmFsaWRhdGlvbiBlcnJvcnMgKGVtcHR5IGlmIHZhbGlkKVxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDb25maWcoY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogc3RyaW5nW10ge1xuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgLy8gVmFsaWRhdGUgbWluTGV2ZWxcbiAgY29uc3QgdmFsaWRMZXZlbHMgPSBPYmplY3QudmFsdWVzKE9ic2VydmFiaWxpdHlMZXZlbCkuZmlsdGVyKCh2KSA9PiB0eXBlb2YgdiA9PT0gJ251bWJlcicpO1xuICBpZiAoIXZhbGlkTGV2ZWxzLmluY2x1ZGVzKGNvbmZpZy5taW5MZXZlbCkpIHtcbiAgICBlcnJvcnMucHVzaChgSW52YWxpZCBtaW5MZXZlbDogJHtjb25maWcubWluTGV2ZWx9YCk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBzYW1wbGluZyByYXRlc1xuICBpZiAoY29uZmlnLnNhbXBsaW5nLmVuYWJsZWQpIHtcbiAgICBPYmplY3QuZW50cmllcyhjb25maWcuc2FtcGxpbmcucmF0ZXMpLmZvckVhY2goKFsgbGV2ZWwsIHJhdGUgXSkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXRlICE9PSAnbnVtYmVyJyB8fCByYXRlIDwgMCB8fCByYXRlID4gMSkge1xuICAgICAgICBlcnJvcnMucHVzaChgSW52YWxpZCBzYW1wbGluZyByYXRlIGZvciAke2xldmVsfTogJHtyYXRlfS4gTXVzdCBiZSBiZXR3ZWVuIDAgYW5kIDEuYCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBiYWNrZW5kIHR5cGVzXG4gIGNvbnN0IHZhbGlkQmFja2VuZFR5cGVzID0gWyAnY2xvdWR3YXRjaCcsICdkeW5hbW9kYicsICdvdGVsJyBdO1xuICBjb25maWcuYmFja2VuZHMuZm9yRWFjaCgoYmFja2VuZCwgaW5kZXgpID0+IHtcbiAgICBpZiAoIXZhbGlkQmFja2VuZFR5cGVzLmluY2x1ZGVzKGJhY2tlbmQudHlwZSkpIHtcbiAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIGJhY2tlbmQgdHlwZSBhdCBpbmRleCAke2luZGV4fTogJHtiYWNrZW5kLnR5cGV9YCk7XG4gICAgfVxuICB9KTtcblxuICAvLyBWYWxpZGF0ZSBzZXJ2aWNlTmFtZVxuICBpZiAoIWNvbmZpZy5zZXJ2aWNlTmFtZSB8fCBjb25maWcuc2VydmljZU5hbWUudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdzZXJ2aWNlTmFtZSBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBjbG91ZHdhdGNoLm5hbWVzcGFjZVxuICBpZiAoIWNvbmZpZy5jbG91ZHdhdGNoLm5hbWVzcGFjZSB8fCBjb25maWcuY2xvdWR3YXRjaC5uYW1lc3BhY2UudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdjbG91ZHdhdGNoLm5hbWVzcGFjZSBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5Jyk7XG4gIH1cblxuICAvLyBWYWxpZGF0ZSBkeW5hbW9kYi50YWJsZU5hbWVcbiAgaWYgKCFjb25maWcuZHluYW1vZGIudGFibGVOYW1lIHx8IGNvbmZpZy5keW5hbW9kYi50YWJsZU5hbWUudHJpbSgpID09PSAnJykge1xuICAgIGVycm9ycy5wdXNoKCdkeW5hbW9kYi50YWJsZU5hbWUgaXMgcmVxdWlyZWQgYW5kIGNhbm5vdCBiZSBlbXB0eScpO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgZHluYW1vZGIudHRsRGF5c1xuICBpZiAodHlwZW9mIGNvbmZpZy5keW5hbW9kYi50dGxEYXlzICE9PSAnbnVtYmVyJyB8fCBjb25maWcuZHluYW1vZGIudHRsRGF5cyA8IDEpIHtcbiAgICBlcnJvcnMucHVzaChgSW52YWxpZCBkeW5hbW9kYi50dGxEYXlzOiAke2NvbmZpZy5keW5hbW9kYi50dGxEYXlzfS4gTXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlci5gKTtcbiAgfVxuXG4gIHJldHVybiBlcnJvcnM7XG59XG5cbiJdfQ==