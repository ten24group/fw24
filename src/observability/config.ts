/**
 * Configuration Management for Observability
 * 
 * Provides a structured way to manage observability configuration
 * with environment variable parsing and runtime updates.
 */

import { createLogger } from '../logging';
import {
  ObservabilityConfig,
  ObservabilityLevel,
  SamplingConfig,
  TypeSpecificConfig,
  DefaultSamplingConfig,
} from './types';

const logger = createLogger('ObservabilityConfig');

/**
 * Centralized configuration defaults
 * All magic strings in one place for easy reference and modification
 */
export const CONFIG_DEFAULTS = {
  serviceName: 'fw24-service',
  cloudwatchNamespace: 'FW24',
  tableName: 'ObservabilityLogs',
  ttlDays: 90,
  backends: [ 'cloudwatch' ] as const,
  minLevel: ObservabilityLevel.INFO,
  enabled: true,
} as const;

/**
 * Valid backend types
 */
export const VALID_BACKENDS = [ 'cloudwatch', 'dynamodb', 'otel' ] as const;
export type ValidBackend = typeof VALID_BACKENDS[ number ];

/**
 * Configuration Manager for Observability
 * 
 * Handles:
 * - Environment variable parsing (cached to avoid repeated parsing)
 * - Configuration validation
 * - Runtime configuration updates
 * - Type-specific configuration
 */
export class ConfigManager {
  private config: ObservabilityConfig;

  /** Cached environment config to avoid double parsing */
  private static cachedEnvConfig: ObservabilityConfig | null = null;

  constructor(config: Partial<ObservabilityConfig>) {
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
  static fromEnvironment(): ObservabilityConfig {
    // Return cached config if available
    if (ConfigManager.cachedEnvConfig) {
      return ConfigManager.cachedEnvConfig;
    }

    const enabled = (process.env.OBSERVABILITY_ENABLED ?? String(CONFIG_DEFAULTS.enabled)).toLowerCase() !== 'false';
    const levelName = (process.env.OBSERVABILITY_LEVEL ?? 'INFO').toUpperCase();
    const parsedLevel = ObservabilityLevel[ levelName as keyof typeof ObservabilityLevel ];
    if (parsedLevel === undefined && process.env.OBSERVABILITY_LEVEL) {
      logger.warn(
        `Invalid OBSERVABILITY_LEVEL: '${process.env.OBSERVABILITY_LEVEL}'. ` +
        `Valid values: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL, OFF. Using default INFO.`
      );
    }
    const minLevel = parsedLevel ?? CONFIG_DEFAULTS.minLevel;

    // Parse sampling configuration
    const sampling = ConfigManager.parseSamplingConfig();

    // Parse type-specific backends
    const types = ConfigManager.parseTypeSpecificConfig();

    // Parse backend list (just names for config, actual instances created separately)
    const rawBackendNames = (process.env.OBSERVABILITY_BACKENDS ?? CONFIG_DEFAULTS.backends.join(','))
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);

    // Validate and filter backend names
    const backendNames = rawBackendNames.filter((name) => {
      if (VALID_BACKENDS.includes(name as ValidBackend)) {
        return true;
      }
      logger.warn(
        `Invalid backend '${name}' in OBSERVABILITY_BACKENDS. ` +
        `Valid values: ${VALID_BACKENDS.join(', ')}. Ignoring.`
      );
      return false;
    });

    // Warn if no backends are configured (likely misconfiguration)
    if (backendNames.length === 0 && process.env.OBSERVABILITY_BACKENDS !== undefined) {
      logger.warn(
        'No valid backends configured via OBSERVABILITY_BACKENDS. ' +
        'Observability events will not be captured. ' +
        'Remove the env var to use default (cloudwatch) or set valid backends.'
      );
    }

    // Service name (used by CloudWatch, OTEL, etc.)
    const serviceName = process.env.SERVICE_NAME ?? CONFIG_DEFAULTS.serviceName;

    // CloudWatch configuration
    const cloudwatch = {
      namespace: process.env.CLOUDWATCH_METRICS_NAMESPACE ?? CONFIG_DEFAULTS.cloudwatchNamespace,
    };

    const rawTtl = process.env.OBSERVABILITY_TTL_DAYS;
    let ttlDays: number = CONFIG_DEFAULTS.ttlDays;
    if (rawTtl) {
      const parsed = parseInt(rawTtl, 10);
      if (isNaN(parsed) || parsed < 1) {
        logger.warn(`Invalid OBSERVABILITY_TTL_DAYS: '${rawTtl}'. Using default ${CONFIG_DEFAULTS.ttlDays}.`);
      } else {
        ttlDays = parsed;
      }
    }

    // DynamoDB configuration
    const dynamodb = {
      tableName: process.env.OBSERVABILITY_TABLE_NAME ?? CONFIG_DEFAULTS.tableName,
      ttlDays,
    };

    const config: ObservabilityConfig = {
      enabled,
      minLevel,
      sampling,
      backends: backendNames.map(type => ({
        type: type as ValidBackend,
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
  static clearCache(): void {
    ConfigManager.cachedEnvConfig = null;
  }

  /**
   * Parse sampling configuration from environment
   */
  private static parseSamplingConfig(): SamplingConfig {
    const enabled = process.env.OBSERVABILITY_SAMPLING_ENABLED === 'true';

    if (!enabled) {
      return DefaultSamplingConfig;
    }

    const rates: Record<ObservabilityLevel, number> = {
      [ ObservabilityLevel.CRITICAL ]: 1,
      [ ObservabilityLevel.ERROR ]: 1,
      [ ObservabilityLevel.WARN ]: 1,
      [ ObservabilityLevel.INFO ]: 1,
      [ ObservabilityLevel.DEBUG ]: 1,
      [ ObservabilityLevel.TRACE ]: 1,
      [ ObservabilityLevel.OFF ]: 0,
    };

    // Parse level-specific rates
    const levelEnvMappings: Array<[ string, ObservabilityLevel ]> = [
      [ 'OBSERVABILITY_SAMPLING_TRACE', ObservabilityLevel.TRACE ],
      [ 'OBSERVABILITY_SAMPLING_DEBUG', ObservabilityLevel.DEBUG ],
      [ 'OBSERVABILITY_SAMPLING_INFO', ObservabilityLevel.INFO ],
      [ 'OBSERVABILITY_SAMPLING_WARN', ObservabilityLevel.WARN ],
      [ 'OBSERVABILITY_SAMPLING_ERROR', ObservabilityLevel.ERROR ],
    ];

    for (const [ envVar, level ] of levelEnvMappings) {
      const value = process.env[ envVar ];
      if (value) {
        const rate = parseFloat(value);
        if (!isNaN(rate) && rate >= 0 && rate <= 1) {
          rates[ level ] = rate;
        } else {
          logger.warn(
            `Invalid sampling rate for ${envVar}: '${value}'. ` +
            'Must be a number between 0 and 1. Using default rate 1.0.'
          );
        }
      }
    }

    // Parse operation-specific rates (JSON format)
    let operations: Record<string, number> | undefined;
    const operationsJson = process.env.OBSERVABILITY_SAMPLING_OPERATIONS;
    if (operationsJson) {
      try {
        const parsed = JSON.parse(operationsJson);
        // Validate structure
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          logger.warn(
            'Invalid OBSERVABILITY_SAMPLING_OPERATIONS: expected JSON object. ' +
            `Got: ${typeof parsed}. Using default sampling.`
          );
        } else {
          // Validate each rate is a number between 0 and 1
          let valid = true;
          for (const [ key, value ] of Object.entries(parsed)) {
            if (typeof value !== 'number' || value < 0 || value > 1) {
              logger.warn(
                `Invalid sampling rate for operation '${key}': ${value}. ` +
                'Must be a number between 0 and 1. Ignoring this operation.'
              );
              valid = false;
            }
          }
          if (valid) {
            operations = parsed;
          } else {
            // Filter out invalid entries
            operations = Object.fromEntries(
              Object.entries(parsed).filter(
                ([ , v ]) => typeof v === 'number' && v >= 0 && v <= 1
              )
            ) as Record<string, number>;
          }
        }
      } catch (error) {
        logger.warn(
          `Failed to parse OBSERVABILITY_SAMPLING_OPERATIONS: ${error instanceof Error ? error.message : 'Invalid JSON'}. ` +
          'Using default sampling. Expected format: {"operation.pattern": 0.5}'
        );
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
  private static parseTypeSpecificConfig(): NonNullable<ObservabilityConfig[ 'types' ]> {
    const types: NonNullable<ObservabilityConfig[ 'types' ]> = {};

    const typeEnvMappings: Array<[ string, keyof NonNullable<ObservabilityConfig[ 'types' ]> ]> = [
      [ 'OBSERVABILITY_SPAN_BACKENDS', 'span' ],
      [ 'OBSERVABILITY_METRIC_BACKENDS', 'metric' ],
      [ 'OBSERVABILITY_AUDIT_BACKENDS', 'audit' ],
      [ 'OBSERVABILITY_LOG_BACKENDS', 'log' ],
      [ 'OBSERVABILITY_DECISION_BACKENDS', 'decision' ],
      [ 'OBSERVABILITY_WORKFLOW_BACKENDS', 'workflow' ],
      [ 'OBSERVABILITY_ACCESS_BACKENDS', 'access' ],
    ];

    for (const [ envVar, typeKey ] of typeEnvMappings) {
      const value = process.env[ envVar ];
      if (value) {
        const rawBackends = value.split(',').map((b) => b.trim().toLowerCase());
        // Validate backend names
        const validBackends = rawBackends.filter((name) => {
          if (VALID_BACKENDS.includes(name as ValidBackend)) {
            return true;
          }
          logger.warn(
            `Invalid backend '${name}' in ${envVar}. ` +
            `Valid values: ${VALID_BACKENDS.join(', ')}. Ignoring.`
          );
          return false;
        }) as ('cloudwatch' | 'dynamodb' | 'otel')[];

        if (validBackends.length > 0) {
          types[ typeKey ] = { backends: validBackends };
        }
      }
    }

    // Parse type-specific levels
    const levelEnvMappings: Array<[ string, keyof NonNullable<ObservabilityConfig[ 'types' ]> ]> = [
      [ 'OBSERVABILITY_SPAN_LEVEL', 'span' ],
      [ 'OBSERVABILITY_METRIC_LEVEL', 'metric' ],
      [ 'OBSERVABILITY_AUDIT_LEVEL', 'audit' ],
      [ 'OBSERVABILITY_LOG_LEVEL', 'log' ],
      [ 'OBSERVABILITY_DECISION_LEVEL', 'decision' ],
      [ 'OBSERVABILITY_WORKFLOW_LEVEL', 'workflow' ],
      [ 'OBSERVABILITY_ACCESS_LEVEL', 'access' ],
    ];

    for (const [ envVar, typeKey ] of levelEnvMappings) {
      const value = process.env[ envVar ]?.toUpperCase();
      if (value) {
        const parsedLevel = ObservabilityLevel[ value as keyof typeof ObservabilityLevel ];
        if (parsedLevel !== undefined) {
          types[ typeKey ] = {
            ...types[ typeKey ],
            minLevel: parsedLevel,
          };
        } else {
          logger.warn(
            `Invalid ${envVar}: '${process.env[ envVar ]}'. ` +
            `Valid values: TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL, OFF. Using default.`
          );
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
  private buildConfig(partial: Partial<ObservabilityConfig>): ObservabilityConfig {
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
  get<K extends keyof ObservabilityConfig>(key: K): ObservabilityConfig[ K ] {
    return this.config[ key ];
  }

  /**
   * Get the full configuration
   */
  getAll(): ObservabilityConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime
   * @param updates - Partial configuration to merge
   * @param validate - Whether to validate the resulting config (default: true)
   * @throws Error if validation is enabled and config is invalid
   */
  update(updates: Partial<ObservabilityConfig>, validate = true): void {
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
  getTypeConfig(type: keyof NonNullable<ObservabilityConfig[ 'types' ]>): TypeSpecificConfig | undefined {
    return this.config.types?.[ type ];
  }

  /**
   * Check if a specific backend is enabled for a type
   */
  isBackendEnabledForType(
    backendName: 'cloudwatch' | 'dynamodb' | 'otel',
    type: keyof NonNullable<ObservabilityConfig[ 'types' ]>
  ): boolean {
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
  getEffectiveLevelForType(type: keyof NonNullable<ObservabilityConfig[ 'types' ]>): ObservabilityLevel {
    const typeConfig = this.getTypeConfig(type);
    return typeConfig?.minLevel ?? this.config.minLevel;
  }
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
  if (config.sampling.enabled) {
    Object.entries(config.sampling.rates).forEach(([ level, rate ]) => {
      if (typeof rate !== 'number' || rate < 0 || rate > 1) {
        errors.push(`Invalid sampling rate for ${level}: ${rate}. Must be between 0 and 1.`);
      }
    });
  }

  // Validate backend types
  const validBackendTypes = [ 'cloudwatch', 'dynamodb', 'otel' ];
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

