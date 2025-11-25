import { createLogger } from '../logging';
import {
  DefaultSamplingConfig,
  ObservabilityBackend,
  ObservabilityConfig,
  ObservabilityEvent,
  ObservabilityLevel,
} from './types';
import { DynamoDBObservabilityBackend } from './backends/dynamodb';
import { OTELObservabilityBackend } from './backends/otel';
import { stringToLevel } from './utils/level-utils';
import { detectSource, mergeTags } from './utils/source-utils';

const logger = createLogger('ObservabilityManager');

export class ObservabilityManager {
  private static config: ObservabilityConfig | null = null;
  private static backends: ObservabilityBackend[] = [];

  static initialize(config: ObservabilityConfig, backends: ObservabilityBackend[]) {
    this.validateConfig(config);
    this.config = config;
    this.backends = backends;
  }

  private static validateConfig(config: ObservabilityConfig): void {
    // Validate minLevel
    const validLevels = Object.values(ObservabilityLevel).filter((v) => typeof v === 'number');
    if (!validLevels.includes(config.minLevel)) {
      throw new Error(
        `Invalid minLevel: ${config.minLevel}. Must be one of: ${Object.keys(ObservabilityLevel).join(', ')}`,
      );
    }

    // Validate sampling rates
    if (config.sampling.enabled) {
      Object.entries(config.sampling.rates).forEach(([level, rate]) => {
        if (typeof rate !== 'number' || rate < 0 || rate > 1) {
          throw new Error(`Invalid sampling rate for ${level}: ${rate}. Must be between 0 and 1.`);
        }
      });
    }

    // Validate backend types
    const validBackends = ['cloudwatch', 'dynamodb', 'otel', 'mock'];
    config.backends.forEach((backend) => {
      if (!validBackends.includes(backend.type)) {
        throw new Error(
          `Invalid backend type: ${backend.type}. Must be one of: ${validBackends.join(', ')}`,
        );
      }
    });
  }

  static getConfig(): ObservabilityConfig {
    this.ensureInitialized();
    return this.config!;
  }

  static registerBackend(backend: ObservabilityBackend) {
    if (!this.backends.find((b) => b.name === backend.name)) {
      this.backends.push(backend);
    }
  }

  static initializeInvocation() {
    this.ensureInitialized();
    this.backends.forEach((backend) => backend.initializeInvocation?.());
  }

  static capture(event: ObservabilityEvent): void {
    // Defensive checks
    if (!event || typeof event !== 'object') {
      logger.warn('Invalid event passed to capture');
      return;
    }

    if (!event.type) {
      logger.warn('Event missing required field: type');
      return;
    }

    if (!event.correlationId) {
      logger.warn('Event missing required field: correlationId');
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) return;

    // Auto-inject source if not provided
    if (!event.source) {
      event.source = detectSource();
    }

    // Auto-merge environment tags with event tags
    event.tags = mergeTags(event.tags, true);

    if (!ObservabilityManager.shouldCapture(event, config)) {
      return;
    }

    // Get backends for this specific type
    const backends = this.getBackendsForType(event.type);

    // Fire-and-forget (don't await)
    void Promise.all(
      backends.map(async (backend) => {
        try {
          if (
            backend.minLevel !== undefined &&
            ObservabilityManager.getLevelValue(event.level) < backend.minLevel
          ) {
            return;
          }
          await backend.capture(event);
        } catch (error) {
          logger.error(`Failed to capture event in backend ${backend.name}`, error);
        }
      }),
    );
  }

  private static getBackendsForType(type: string): ObservabilityBackend[] {
    const typeCategory = this.getTypeCategory(type);
    const typeConfig = this.config?.types?.[typeCategory];

    if (typeConfig?.backends) {
      // Use type-specific backends
      return this.backends.filter((b) => typeConfig.backends!.includes(b.name as any));
    }

    // Fall back to all enabled backends
    return this.backends;
  }

  private static getTypeCategory(
    type: string,
  ): keyof NonNullable<ObservabilityConfig['types']> {
    if (type.startsWith('span.')) return 'span';
    if (type === 'metric') return 'metric';
    if (type.startsWith('audit.')) return 'audit';
    if (type.startsWith('workflow.')) return 'workflow';
    if (type.startsWith('decision.')) return 'decision';
    return 'log';
  }

  static async flush() {
    await Promise.all(
      this.backends.map(async (backend) => {
        if (backend.flush) {
          try {
            await backend.flush();
          } catch (error) {
            logger.error(`Failed to flush backend ${backend.name}`, error);
          }
        }
      }),
    );
  }

  private static shouldCapture(event: ObservabilityEvent, config: ObservabilityConfig): boolean {
    // Level check FIRST
    const levelValue = this.getLevelValue(event.level);
    if (levelValue < config.minLevel) {
      return false;
    }

    // CRITICAL level always captured
    if (levelValue === ObservabilityLevel.CRITICAL) {
      return true;
    }

    if (!config.sampling.enabled) {
      return true;
    }

    // Check operation-specific sampling
    if (event.operation && config.sampling.operations) {
      const entries = Object.entries(config.sampling.operations);
      for (const [pattern, opRate] of entries) {
        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        if (regex.test(event.operation)) {
          return Math.random() < opRate;
        }
      }
    }

    // Sample by level
    const rate = config.sampling.rates[levelValue] ?? 1.0;
    if (rate >= 1) return true;
    if (rate <= 0) return false;

    return Math.random() < rate;
  }

  private static getLevelValue(level: ObservabilityEvent['level']): ObservabilityLevel {
    return stringToLevel(level);
  }

  private static async ensureInitialized() {
    if (this.config) {
      return;
    }

    const enabled = (process.env.OBSERVABILITY_ENABLED ?? 'true').toLowerCase() !== 'false';
    const levelName = (process.env.OBSERVABILITY_LEVEL ?? 'info').toUpperCase();
    const minLevel = (ObservabilityLevel as any)[levelName] ?? ObservabilityLevel.INFO;

    const backendNames = (process.env.OBSERVABILITY_BACKENDS ?? 'cloudwatch')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);

    const backendInstances: ObservabilityBackend[] = [];
    const backendConfigs: ObservabilityConfig['backends'] = [];

    const registerBackend = async (type: string) => {
      switch (type) {
        case 'dynamodb':
          backendInstances.push(
            new DynamoDBObservabilityBackend({
              minLevel,
              ttlDays: parseInt(process.env.OBSERVABILITY_DYNAMO_TTL_DAYS || '90', 10),
            }),
          );
          backendConfigs.push({ type: 'dynamodb', enabled: true });
          break;
        case 'otel':
          backendInstances.push(
            new OTELObservabilityBackend({
              serviceName: process.env.SERVICE_NAME || 'fw24-service',
              minLevel,
            }),
          );
          backendConfigs.push({ type: 'otel', enabled: true });
          break;
        case 'cloudwatch': {
          const { CloudWatchBackend } = await import('./backends/cloudwatch');
          backendInstances.push(
            new CloudWatchBackend({
              serviceName: process.env.SERVICE_NAME || 'fw24-service',
              minLevel,
              namespace: process.env.CLOUDWATCH_METRICS_NAMESPACE || 'FW24',
            }),
          );
          backendConfigs.push({ type: 'cloudwatch', enabled: true });
          break;
        }
        default:
          logger.warn(`Unknown backend type: ${type}`);
          break;
      }
    };

    if (backendNames.length === 0) {
      await registerBackend('cloudwatch');
    } else {
      for (const backendName of backendNames) {
        await registerBackend(backendName);
      }
    }

    // Parse type-specific backend overrides
    const types: ObservabilityConfig['types'] = {};

    const parseTypeBackends = (envVar: string, typeKey: keyof NonNullable<ObservabilityConfig['types']>) => {
      const value = process.env[envVar];
      if (value) {
        types[typeKey] = {
          backends: value.split(',').map((b) => b.trim()) as any,
        };
      }
    };

    parseTypeBackends('OBSERVABILITY_SPAN_BACKENDS', 'span');
    parseTypeBackends('OBSERVABILITY_METRIC_BACKENDS', 'metric');
    parseTypeBackends('OBSERVABILITY_AUDIT_BACKENDS', 'audit');
    parseTypeBackends('OBSERVABILITY_LOG_BACKENDS', 'log');
    parseTypeBackends('OBSERVABILITY_DECISION_BACKENDS', 'decision');
    parseTypeBackends('OBSERVABILITY_WORKFLOW_BACKENDS', 'workflow');

    const config: ObservabilityConfig = {
      enabled,
      minLevel,
      sampling: DefaultSamplingConfig,
      backends: backendConfigs,
      types: Object.keys(types).length > 0 ? types : undefined,
    };

    this.initialize(config, backendInstances);
  }
}

export const withObservability = <T extends (...args: any[]) => Promise<any>>(handler: T): T => {
  return (async (...args: Parameters<T>) => {
    try {
      ObservabilityManager.initializeInvocation();
      return await handler(...args);
    } finally {
      await ObservabilityManager.flush();
    }
  }) as T;
};

/**
 * Alias for ObservabilityManager (follows Observer design pattern)
 * 
 * Usage:
 * ```typescript
 * import { Observer } from '@ten24group/fw24/observability';
 * 
 * Observer.capture({ ... });
 * await Observer.flush();
 * ```
 */
export const Observer = ObservabilityManager;
