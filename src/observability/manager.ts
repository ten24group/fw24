/**
 * ObservabilityManager - Core Observer for the observability system
 * 
 * All config and backends resolved from DI - no manual instantiation.
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
import { stringToLevel, levelToString } from './utils/level-utils';
import { detectSource, mergeTags } from './utils/source-utils';
import { redactSensitiveData } from './utils/data-protection';
import { getCurrentContext, getCorrelationIdIfExists } from './context';
import { initializeCapturer, resetCapturer } from './observers/base';
import { DIContainer } from '../di';
import { NoProviderFoundError } from '../di/errors';

const logger = createLogger('ObservabilityManager');

interface ValidationError {
  field: string;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE MODULE STATE
// ═══════════════════════════════════════════════════════════════════════════

let config: ObservabilityConfig | null = null;
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
  dataProtection?: ObservabilityConfig[ 'dataProtection' ]
): {
  data?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  error?: ObservabilityError;
} {
  if (!dataProtection?.enabled) {
    return {
      data: input.data,
      attributes: input.attributes,
      metadata: input.metadata,
      context: input.context,
      error: input.error,
    };
  }

  const fields = dataProtection.fields ?? [ 'data', 'attributes', 'metadata', 'context' ];

  return {
    data: fields.includes('data') && input.data
      ? redactSensitiveData(input.data, dataProtection)
      : input.data,
    attributes: fields.includes('attributes') && input.attributes
      ? redactSensitiveData(input.attributes, dataProtection)
      : input.attributes,
    metadata: fields.includes('metadata') && input.metadata
      ? redactSensitiveData(input.metadata, dataProtection)
      : input.metadata,
    context: fields.includes('context') && input.context
      ? redactSensitiveData(input.context, dataProtection)
      : input.context,
    error: fields.includes('error') && input.error
      ? redactSensitiveData(input.error, dataProtection)
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

  const { data, attributes, metadata, context: eventContext, error } = applyDataProtection(
    input,
    config?.dataProtection
  );

  return {
    type: input.type,
    level: input.level,
    correlationId,
    timestampMs: input.timestampMs ?? now,
    observabilityLogId: input.observabilityLogId ?? randomUUID(),
    // null = explicitly no parent (don't fall back), undefined = use context
    parentObservabilityLogId: input.parentObservabilityLogId === null 
      ? undefined 
      : (input.parentObservabilityLogId ?? context?.parentObservabilityLogId),
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

function getTypeCategory(type: string): 'span' | 'metric' | 'audit' | 'log' {
  if (type.startsWith('span.')) return 'span';
  if (type === 'metric') return 'metric';
  if (type.startsWith('audit')) return 'audit';
  return 'log';
}

function getBackendsForType(type: string): ObservabilityBackend[] {
  const typeCategory = getTypeCategory(type);
  const typeConfig = config?.types?.[ typeCategory ];

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

function getEffectiveLevelForType(type: 'span' | 'metric' | 'audit' | 'log'): ObservabilityLevel {
  const typeConfig = config?.types?.[ type ];
  return typeConfig?.minLevel ?? config?.minLevel ?? ObservabilityLevel.INFO;
}

function shouldCapture(event: ObservabilityEvent, cfg: ObservabilityConfig): boolean {
  const levelValue = stringToLevel(event.level);
  const typeCategory = getTypeCategory(event.type);
  const effectiveLevel = getEffectiveLevelForType(typeCategory);

  if (levelValue < effectiveLevel) {
    return false;
  }

  if (levelValue === ObservabilityLevel.CRITICAL) {
    return true;
  }

  if (!cfg.sampling?.enabled) {
    return true;
  }

  const typeConfig = cfg.types?.[ typeCategory ];
  if (typeConfig?.sampling?.enabled) {
    return Math.random() < typeConfig.sampling.rate;
  }

  if (event.operation && cfg.sampling.operations) {
    for (const [ pattern, rate ] of Object.entries(cfg.sampling.operations)) {
      const regex = getOrCreateSamplingRegex(pattern);
      if (regex.test(event.operation)) {
        return Math.random() < rate;
      }
    }
  }

  const levelName = levelToString(levelValue);
  const rate = cfg.sampling.rates?.[ levelName ];
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

/**
 * Initialize backends from DI based on config
 */
function initializeBackendsFromConfig(cfg: ObservabilityConfig): void {
  backends = [];
  const enabledTypes = cfg.backends?.filter(b => b.enabled !== false).map(b => b.type) ?? [ 'cloudwatch' ];

  for (const type of enabledTypes) {
    try {
      const backend = DIContainer.ROOT.resolve<ObservabilityBackend>(
        'ObservabilityBackend',
        { tags: [ 'observability', 'backend', type ] }
      );
      backends.push(backend);
      logger.debug(`Initialized backend: ${backend.name}`);
    } catch (error) {
      if (error instanceof NoProviderFoundError) {
        logger.warn(`Backend '${type}' not found in DI, skipping`);
      } else {
        logger.error(`Failed to initialize backend '${type}':`, error);
      }
    }
  }

  // Fallback to CloudWatch if no backends enabled
  if (backends.length === 0) {
    logger.warn('No backends enabled, attempting CloudWatch fallback');
    try {
      const backend = DIContainer.ROOT.resolve<ObservabilityBackend>(
        'ObservabilityBackend',
        { tags: [ 'observability', 'backend', 'cloudwatch' ] }
      );
      backends.push(backend);
    } catch (error) {
      logger.error('Failed to resolve fallback CloudWatch backend:', error);
    }
  }
}

function doInitialize(): void {
  // Resolve config from DI (defaults registered in index.ts guarantee all required fields)
  config = DIContainer.ROOT.resolveConfig<ObservabilityConfig>('observability') as ObservabilityConfig;
  logger.debug('Observability config loaded from DI');

  // Initialize backends from DI
  initializeBackendsFromConfig(config!);

  // Register capturer for observers
  initializeCapturer({
    capture: (input, options) => ObservabilityManager.capture(input, options),
    captureAsync: (input, options) => ObservabilityManager.captureAsync(input, options),
  });

  initialized = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API - ObservabilityManager
// ═══════════════════════════════════════════════════════════════════════════

export class ObservabilityManager {

  private constructor() { }

  /**
   * Initialize for a new Lambda invocation
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

  static isInitialized(): boolean {
    return initialized;
  }

  static isColdStart(): boolean {
    return invocationCount === 1;
  }

  static getInvocationCount(): number {
    return invocationCount;
  }

  static getConfig(): ObservabilityConfig | null {
    return config;
  }

  static configure(updates: Partial<ObservabilityConfig>): void {
    if (!config) {
      throw new Error('ObservabilityManager not initialized');
    }
    config = { ...config, ...updates };
  }

  static registerBackend(backend: ObservabilityBackend): void {
    if (backends.find((b) => b.name === backend.name)) {
      logger.warn(`Backend ${backend.name} already registered`);
      return;
    }
    backends.push(backend);
  }

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

      if (!config?.enabled) return undefined;

      const event = buildEvent(input);

      if (!options?.critical && !shouldCapture(event, config)) {
        return undefined;
      }

      const targetBackends = getBackendsForType(event.type);
      dispatchToBackends(event, targetBackends);

      return event.observabilityLogId;
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

      if (!config?.enabled) return undefined;

      const event = buildEvent(input);

      if (!options?.critical && !shouldCapture(event, config)) {
        return undefined;
      }

      const targetBackends = getBackendsForType(event.type);
      await dispatchToBackendsSync(event, targetBackends);

      return event.observabilityLogId;
    } catch (error) { 
      logger.error('Unexpected error in captureAsync:', error);
      return undefined;
    }
  }

  /**
   * Observe an event
   */
  static observe(
    event: Partial<ObservabilityEvent> & { type: string; level: string; correlationId?: string },
    options?: CaptureOptions
  ): string | undefined {
    const correlationId = event.correlationId ?? getCorrelationIdIfExists();

    if (!correlationId) {
      logger.warn('observe() called without correlationId');
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
   * Flush all backends
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
    config = null;
    backends = [];
    invocationCount = 0;
    initialized = false;
    samplingRegexCache.clear();
    resetCapturer();
  }

  /**
   * Initialize for testing with mock config and backends
   */
  static initializeForTesting(
    testConfig: ObservabilityConfig,
    testBackends: ObservabilityBackend[] = []
  ): void {
    ObservabilityManager.reset();
    config = testConfig;
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

export const Observer = ObservabilityManager;
