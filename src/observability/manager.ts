/**
 * ObservabilityManager - Core Observer for the observability system
 * 
 * DESIGN PRINCIPLES:
 * - Self-initializing: Initializes when module is imported
 * - Never crash the application - log errors and continue
 * - Fire-and-forget capture for non-blocking operation
 * 
 * INITIALIZATION:
 * - Manager auto-initializes when this module is imported
 * - Registers itself with base.ts capturer registry
 * - No circular dependencies: base.ts doesn't import manager.ts
 * 
 * Usage:
 * ```typescript
 * // Establish context with correlationId first
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Use observers (auto-generates correlationId if needed)
 *     SpanObserver.start('operation');
 *     AuditObserver.entityCreate('User', userId, data);
 *   }
 * );
 * ```
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../logging';
import {
  CaptureInput,
  CaptureOptions,
  ObservabilityBackend,
  ObservabilityConfig,
  ObservabilityError,
  ObservabilityEvent,
  ObservabilityLevel,
} from './types';
import { ObservabilityConfigManager } from './config';
import { stringToLevel, levelToString } from './utils/level-utils';
import { detectSource, mergeTags } from './utils/source-utils';
import { redactSensitiveData } from './utils/data-protection';
import { getCurrentContext, getCorrelationIdIfExists } from './context';

// Static imports for backends (enables tree-shaking and compile-time type checking)
import { CloudWatchBackend } from './backends/cloudwatch';
import { DynamoDBObservabilityBackend } from './backends/dynamodb';
import { OTELObservabilityBackend } from './backends/otel';

// Import base observer utilities to inject ourselves
import { initializeCapturer, resetCapturer } from './observers/base';
import { DIContainer } from '../di';
import { DI_TOKENS } from '../const';
import { NoProviderFoundError } from '../di/errors';

const logger = createLogger('ObservabilityManager');

/**
 * Validation error structure
 */
interface ValidationError {
  field: string;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE MODULE STATE
// All state is module-scoped, not class properties
// ═══════════════════════════════════════════════════════════════════════════

let configManager: ObservabilityConfigManager | null = null;
let backends: ObservabilityBackend[] = [];
let invocationCount = 0;
let initialized = false;
const samplingRegexCache = new Map<string, RegExp>();

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function validateInput(input: CaptureInput): ValidationError[] {
  const errors: ValidationError[] = [];
  const context = getCurrentContext();

  if (!input.type) {
    errors.push({ field: 'type', message: 'type is required' });
  }

  if (!input.level) {
    errors.push({ field: 'level', message: 'level is required' });
  }

  // correlationId must come from input or context
  if (!input.correlationId && !context?.correlationId) {
    errors.push({
      field: 'correlationId',
      message: 'correlationId is required. Establish context with runWithContext() or provide explicitly.'
    });
  }

  return errors;
}

function applyDataProtection(
  input: CaptureInput,
  config: ObservabilityConfig[ 'dataProtection' ]
): {
  data?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  error?: ObservabilityError;
} {
  if (!config.enabled) {
    return {
      data: input.data,
      attributes: input.attributes,
      metadata: input.metadata,
      context: input.context,
      error: input.error,
    };
  }

  const fields = config.fields ?? [ 'data', 'attributes', 'metadata', 'context' ];

  return {
    data: fields.includes('data') && input.data
      ? redactSensitiveData(input.data, config)
      : input.data,
    attributes: fields.includes('attributes') && input.attributes
      ? redactSensitiveData(input.attributes, config)
      : input.attributes,
    metadata: fields.includes('metadata') && input.metadata
      ? redactSensitiveData(input.metadata, config)
      : input.metadata,
    context: fields.includes('context') && input.context
      ? redactSensitiveData(input.context, config)
      : input.context,
    error: fields.includes('error') && input.error
      ? redactSensitiveData(input.error, config)
      : input.error,
  };
}

function buildEvent(input: CaptureInput): ObservabilityEvent {
  const context = getCurrentContext();
  const now = Date.now();

  const correlationId = input.correlationId ?? context?.correlationId;
  if (!correlationId) {
    throw new Error('correlationId is required - this should have been caught by validation');
  }

  const config = configManager!.getAll();
  const { data, attributes, metadata, context: eventContext, error } = applyDataProtection(
    input,
    config.dataProtection
  );

  return {
    type: input.type,
    level: input.level,
    correlationId,
    timestampMs: input.timestampMs ?? now,
    logId: input.logId ?? randomUUID(),
    parentLogId: input.parentLogId ?? context?.parentLogId,
    actor: input.actor ?? context?.actor,
    source: input.source ?? context?.source ?? detectSource(),
    tags: mergeTags({ ...context?.tags, ...input.tags }, true),
    entityName: input.entityName,
    entityId: input.entityId,
    operation: input.operation,
    subType: input.subType,
    status: input.status,
    success: input.success,
    durationMs: input.durationMs,
    data,
    attributes,
    metadata,
    metrics: input.metrics,
    context: eventContext,
    error,
  };
}

function getTypeCategory(type: string): keyof NonNullable<ObservabilityConfig[ 'types' ]> {
  if (type.startsWith('span.')) return 'span';
  if (type === 'metric') return 'metric';
  if (type.startsWith('audit')) return 'audit';
  return 'log';
}

function getBackendsForType(type: string): ObservabilityBackend[] {
  const typeCategory = getTypeCategory(type);
  const typeConfig = configManager?.getTypeConfig(typeCategory);

  if (typeConfig?.backends && typeConfig.backends.length > 0) {
    return backends.filter((b) => typeConfig.backends!.includes(b.name as 'cloudwatch' | 'dynamodb' | 'otel'));
  }

  return backends;
}

function dispatchToBackends(event: ObservabilityEvent, targetBackends: ObservabilityBackend[]): void {
  void Promise.all(
    targetBackends.map(async (backend) => {
      try {
        if (backend.minLevel !== undefined) {
          const eventLevel = stringToLevel(event.level);
          if (eventLevel < backend.minLevel) {
            return;
          }
        }
        await backend.capture(event);
      } catch (error) {
        logger.error(`Failed to capture in backend ${backend.name}:`, error);
      }
    }),
  );
}

async function dispatchToBackendsSync(event: ObservabilityEvent, targetBackends: ObservabilityBackend[]): Promise<void> {
  await Promise.all(
    targetBackends.map(async (backend) => {
      try {
        if (backend.minLevel !== undefined) {
          const eventLevel = stringToLevel(event.level);
          if (eventLevel < backend.minLevel) {
            return;
          }
        }
        await backend.capture(event);
      } catch (error) {
        logger.error(`Failed to capture in backend ${backend.name}:`, error);
      }
    }),
  );
}

function shouldCapture(event: ObservabilityEvent, config: ObservabilityConfig): boolean {
  const levelValue = stringToLevel(event.level);
  const typeCategory = getTypeCategory(event.type);
  const effectiveLevel = configManager?.getEffectiveLevelForType(typeCategory) ?? config.minLevel;

  if (levelValue < effectiveLevel) {
    return false;
  }

  if (levelValue === ObservabilityLevel.CRITICAL) {
    return true;
  }

  if (!config.sampling.enabled) {
    return true;
  }

  const typeConfig = configManager?.getTypeConfig(typeCategory);
  if (typeConfig?.sampling?.enabled) {
    return Math.random() < typeConfig.sampling.rate;
  }

  if (event.operation && config.sampling.operations) {
    for (const [ pattern, rate ] of Object.entries(config.sampling.operations)) {
      const regex = getOrCreateSamplingRegex(pattern);
      if (regex.test(event.operation)) {
        return Math.random() < rate;
      }
    }
  }

  const levelName = levelToString(levelValue);
  const rate = config.sampling.rates?.[ levelName ];
  if (rate === undefined || rate >= 1) return true;
  if (rate <= 0) return false;

  return Math.random() < rate;
}

function getOrCreateSamplingRegex(pattern: string): RegExp {
  let regex = samplingRegexCache.get(pattern);
  if (!regex) {
    regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    samplingRegexCache.set(pattern, regex);
  }
  return regex;
}

function initializeBackendsFromConfig(config: ObservabilityConfig): void {
  const minLevel = config.minLevel;
  const backendConfigs = config.backends;
  const backendNames = backendConfigs.map(b => b.type);

  for (const type of backendNames) {
    try {
      switch (type) {
        case 'dynamodb':
          backends.push(
            new DynamoDBObservabilityBackend({
              minLevel,
              ttlDays: config.dynamodb.ttlDays,
            }),
          );
          break;
        case 'otel':
          backends.push(
            new OTELObservabilityBackend({
              serviceName: config.serviceName,
              minLevel,
            }),
          );
          break;
        case 'cloudwatch':
          backends.push(
            new CloudWatchBackend({
              serviceName: config.serviceName,
              minLevel,
              namespace: config.cloudwatch.namespace,
            }),
          );
          break;
        default:
          logger.warn(`Unknown backend type: ${type}`);
      }
    } catch (error) {
      logger.error(`Failed to initialize backend ${type}:`, error);
    }
  }

  if (backends.length === 0) {
    try {
      backends.push(
        new CloudWatchBackend({
          serviceName: config.serviceName,
          minLevel,
          namespace: config.cloudwatch.namespace,
        }),
      );
    } catch (error) {
      logger.error('Failed to initialize default CloudWatch backend:', error);
    }
  }
}

function doInitialize(): void {
  let config: ObservabilityConfig;

  try {
    config = DIContainer.ROOT.resolve(DI_TOKENS.OBSERVABILITY_CONFIG) as ObservabilityConfig;
    logger.debug('Observability config loaded from DI');
  } catch (e) {
    if (!(e instanceof NoProviderFoundError)) {
      logger.warn('Error resolving observability config from DI:', e);
    }
    config = ObservabilityConfigManager.fromEnvironment();
    logger.debug('Observability config loaded from environment');
  }

  configManager = new ObservabilityConfigManager(config);
  initializeBackendsFromConfig(config);

  initializeCapturer({
    capture: (input, options) => ObservabilityManager.capture(input, options),
    captureAsync: (input, options) => ObservabilityManager.captureAsync(input, options),
  });

  initialized = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API - ObservabilityManager
// Clean static methods that use module-scoped state
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ObservabilityManager - core static class for the observability system.
 * 
 * All state is module-scoped for proper encapsulation.
 * Static methods provide the public API.
 */
export class ObservabilityManager {

  // Prevent instantiation
  private constructor() { }

  /**
   * Initialize for a new Lambda invocation.
   * THIS IS THE MAIN ENTRY POINT - called by all controllers.
   */
  static initializeInvocation(): void {
    if (!initialized) {
      doInitialize();
    }

    invocationCount++;
    for (const backend of backends) {
      try {
        backend.initializeInvocation?.();
      } catch (error) {
        logger.error(`Backend ${backend.name} failed to initialize invocation:`, error);
      }
    }
  }

  /**
   * Check if initialized
   */
  static isInitialized(): boolean {
    return initialized;
  }

  /**
   * Check if this is a cold start
   */
  static isColdStart(): boolean {
    return invocationCount === 1;
  }

  /**
   * Get current invocation count
   */
  static getInvocationCount(): number {
    return invocationCount;
  }

  /**
   * Get current configuration
   */
  static getConfig(): ObservabilityConfig {
    if (!initialized) {
      throw new Error('ObservabilityManager not initialized. Controllers must call initializeInvocation() first.');
    }
    return configManager!.getAll();
  }

  /**
   * Update configuration at runtime
   */
  static configure(updates: Partial<ObservabilityConfig>): void {
    if (!initialized) {
      throw new Error('ObservabilityManager not initialized. Controllers must call initializeInvocation() first.');
    }
    configManager!.update(updates);
  }

  /**
   * Register a custom backend
   */
  static registerBackend(backend: ObservabilityBackend): void {
    if (backends.find((b) => b.name === backend.name)) {
      logger.warn(`Backend ${backend.name} already registered`);
      return;
    }
    backends.push(backend);
  }

  /**
   * Unregister a backend
   */
  static unregisterBackend(name: string): void {
    backends = backends.filter((b) => b.name !== name);
  }

  /**
   * Capture an observability event (fire-and-forget)
   */
  static capture(input: CaptureInput, options?: CaptureOptions): string | undefined {
    if (!initialized) {
      logger.debug('Observability not initialized, skipping capture');
      return undefined;
    }

    try {
      const errors = validateInput(input);
      if (errors.length > 0) {
        logger.warn('Invalid capture input:', { errors, type: input.type });
        return undefined;
      }

      const config = configManager!.getAll();
      if (!config.enabled) return undefined;

      const event = buildEvent(input);

      if (!options?.critical && !shouldCapture(event, config)) {
        return undefined;
      }

      const targetBackends = getBackendsForType(event.type);
      dispatchToBackends(event, targetBackends);

      return event.logId;
    } catch (error) {
      logger.error('Unexpected error in capture:', error);
      return undefined;
    }
  }

  /**
   * Capture an observability event asynchronously
   */
  static async captureAsync(input: CaptureInput, options?: Omit<CaptureOptions, 'sync'>): Promise<string | undefined> {
    if (!initialized) {
      logger.debug('Observability not initialized, skipping capture');
      return undefined;
    }

    try {
      const errors = validateInput(input);
      if (errors.length > 0) {
        logger.warn('Invalid capture input:', { errors, type: input.type });
        return undefined;
      }

      const config = configManager!.getAll();
      if (!config.enabled) return undefined;

      const event = buildEvent(input);

      if (!options?.critical && !shouldCapture(event, config)) {
        return undefined;
      }

      const targetBackends = getBackendsForType(event.type);
      await dispatchToBackendsSync(event, targetBackends);

      return event.logId;
    } catch (error) {
      logger.error('Unexpected error in captureAsync:', error);
      return undefined;
    }
  }

  /**
   * Observe an event (alias for capture with Partial<ObservabilityEvent>)
   */
  static observe(
    event: Partial<ObservabilityEvent> & { type: string; level: string; correlationId?: string },
    options?: CaptureOptions
  ): string | undefined {
    const correlationId = event.correlationId ?? getCorrelationIdIfExists();

    if (!correlationId) {
      logger.warn('observe() called without correlationId. Establish context with runWithContext() first.');
      return undefined;
    }

    return ObservabilityManager.capture({
      ...event,
      correlationId,
      type: event.type as CaptureInput[ 'type' ],
      level: event.level as CaptureInput[ 'level' ],
    }, options);
  }

  /**
   * Flush all backends - called before Lambda returns
   */
  static async flush(): Promise<void> {
    const flushPromises = backends.map(async (backend) => {
      if (backend.flush) {
        try {
          await backend.flush();
        } catch (error) {
          logger.error(`Failed to flush backend ${backend.name}:`, error);
        }
      }
    });

    await Promise.all(flushPromises);
  }

  /**
   * Reset manager state (for testing)
   */
  static reset(): void {
    configManager = null;
    backends = [];
    invocationCount = 0;
    initialized = false;
    samplingRegexCache.clear();
    resetCapturer();
  }

  /**
   * Initialize for testing with mock backends.
   * @internal
   */
  static initializeForTesting(
    config: Partial<ObservabilityConfig>,
    testBackends: ObservabilityBackend[] = []
  ): void {
    ObservabilityManager.reset();

    const fullConfig: ObservabilityConfig = {
      enabled: config.enabled ?? true,
      minLevel: config.minLevel ?? ObservabilityLevel.TRACE,
      serviceName: config.serviceName ?? 'test-service',
      sampling: config.sampling ?? { enabled: false },
      backends: config.backends ?? [],
      cloudwatch: config.cloudwatch ?? { namespace: 'test' },
      dynamodb: config.dynamodb ?? { tableName: 'test-table', ttlDays: 1 },
      dataProtection: config.dataProtection ?? { enabled: false },
    };

    configManager = new ObservabilityConfigManager(fullConfig);
    backends = testBackends;
    initialized = true;

    initializeCapturer({
      capture: (input, options) => ObservabilityManager.capture(input, options),
      captureAsync: (input, options) => ObservabilityManager.captureAsync(input, options),
    });
  }
}

/**
 * Lambda handler wrapper with observability lifecycle management
 */
export const withObservability = <T extends (...args: unknown[]) => Promise<unknown>>(handler: T): T => {
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
 * Alias for ObservabilityManager
 */
export const Observer = ObservabilityManager;
