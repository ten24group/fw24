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
  SamplingRule,
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
let backendConfigs = new Map<string, ObservabilityConfig[ 'backends' ][ 0 ]>();
let invocationCount = 0;
let initialized = false;
const samplingRegexCache = new Map<string, RegExp>();
const pendingDispatches: Promise<void>[] = []; // Track fire-and-forget promises for flush()

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

function buildEvent(input: CaptureInput, context: ReturnType<typeof getCurrentContext> | null = null): ObservabilityEvent {
  const ctx = context ?? getCurrentContext();
  const now = Date.now();

  const correlationId = input.correlationId ?? ctx?.correlationId;
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
      : (input.parentObservabilityLogId ?? ctx?.parentObservabilityLogId),
    causedBy: input.causedBy,
    relatedTraces: input.relatedTraces,
    actor: input.actor ?? ctx?.actor,
    source: input.source ?? ctx?.source ?? detectSource(),
    tags: mergeTags({ ...ctx?.tags, ...input.tags }, true),
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
    critical: input.critical,
  };
}

/**
 * Categorize event type for backend routing and sampling
 * 
 * Custom event types are supported! Use any naming convention:
 * - 'business.order_placed' → categorized as 'log'
 * - 'payment.transaction' → categorized as 'log'
 * - 'notification.sent' → categorized as 'log'
 * 
 * To control backend routing for custom types, use type-specific config:
 * ```
 * observability: {
 *   types: {
 *     log: { backends: ['cloudwatch', 'dynamodb'] }
 *   }
 * }
 * ```
 */
function getTypeCategory(type: string): 'span' | 'metric' | 'audit' | 'log' {
  if (type.startsWith('span.')) return 'span';
  if (type === 'metric') return 'metric';
  if (type.startsWith('audit')) return 'audit';
  // All custom event types default to 'log' category
  // This includes: 'business.*', 'payment.*', 'notification.*', etc.
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

/**
 * Check if backend should capture this event based on type filtering
 */
function shouldBackendCaptureType(
  backend: ObservabilityBackend,
  event: ObservabilityEvent
): boolean {
  const backendCfg = backendConfigs.get(backend.name);
  if (!backendCfg) return true; // No config = allow all

  const typeCategory = getTypeCategory(event.type);
  const typeFilter = backendCfg.types?.[ typeCategory ];

  // Check if type is explicitly disabled for this backend
  if (typeFilter?.enabled === false) {
    return false;
  }

  const eventLevel = stringToLevel(event.level);

  // Check per-type minLevel (overrides backend-level minLevel)
  if (typeFilter?.minLevel !== undefined) {
    if (eventLevel < typeFilter.minLevel) {
      return false;
    }
  } else if (backend.minLevel !== undefined) {
    // Fall back to backend-level minLevel
    if (eventLevel < backend.minLevel) {
      return false;
    }
  }

  // Check per-type sampling
  if (typeFilter?.sampling !== undefined) {
    return Math.random() < typeFilter.sampling;
  }

  return true; // Passed all filters
}

function dispatchToBackends(event: ObservabilityEvent, targetBackends: ObservabilityBackend[]): void {
  const promise = Promise.all(
    targetBackends.map(async (backend) => {
      try {
        if (!shouldBackendCaptureType(backend, event)) {
          return;
        }
        await backend.capture(event);
      } catch (error) {
        logger.error(`Failed to capture in backend ${backend.name}:`, error);
      }
    }),
  ).then(() => { }); // Convert to Promise<void>

  // Track promise so flush() can wait for it
  pendingDispatches.push(promise);
}

async function dispatchToBackendsSync(event: ObservabilityEvent, targetBackends: ObservabilityBackend[]): Promise<void> {
  await Promise.all(
    targetBackends.map(async (backend) => {
      try {
        if (!shouldBackendCaptureType(backend, event)) {
          return;
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

/**
 * Check if an event matches a sampling rule
 */
function matchesRule(event: ObservabilityEvent, rule: SamplingRule): boolean {
  const { target, pattern } = rule;

  let valueToMatch: string | undefined;

  switch (target) {
    case 'tenant':
      // Check actor.tenantId or tags.tenantId
      valueToMatch = event.actor?.tenantId ?? event.tags?.tenantId;
      break;

    case 'route':
      // Check source (e.g., "OrderController.create") or operation
      valueToMatch = event.source ?? event.operation;
      break;

    case 'tag':
      // Pattern format: "key:value" or "key:*"
      if (typeof pattern === 'string' && pattern.includes(':')) {
        const [ key, valuePattern ] = pattern.split(':', 2);
        const tagValue = event.tags?.[ key ];
        if (!tagValue) return false;

        if (valuePattern === '*') return true;

        // Test against value pattern (supports wildcards)
        const regex = getOrCreateSamplingRegex(valuePattern);
        return regex.test(tagValue);
      }
      return false;

    case 'actor':
      // Check actorId or actorType
      valueToMatch = event.actor?.actorId ?? event.actor?.actorType;
      break;

    case 'source':
      valueToMatch = event.source;
      break;

    default:
      return false;
  }

  if (!valueToMatch) return false;

  // Match against pattern (string or RegExp)
  if (pattern instanceof RegExp) {
    return pattern.test(valueToMatch);
  }

  // String pattern with wildcard support
  const regex = getOrCreateSamplingRegex(pattern);
  return regex.test(valueToMatch);
}

function shouldCapture(event: ObservabilityEvent, cfg: ObservabilityConfig): boolean {
  const levelValue = stringToLevel(event.level);
  const typeCategory = getTypeCategory(event.type);
  const effectiveLevel = getEffectiveLevelForType(typeCategory);

  // Check minimum level first
  if (levelValue < effectiveLevel) {
    return false;
  }

  // CRITICAL always captured
  if (levelValue === ObservabilityLevel.CRITICAL) {
    return true;
  }

  // If sampling disabled, capture everything
  if (!cfg.sampling?.enabled) {
    return true;
  }

  // === RULE-BASED SAMPLING (Highest Priority) ===
  // Rules are evaluated in order. First match wins.
  if (cfg.sampling.rules && cfg.sampling.rules.length > 0) {
    for (const rule of cfg.sampling.rules) {
      if (matchesRule(event, rule)) {
        return Math.random() < rule.rate;
      }
    }
  }

  // === TYPE-SPECIFIC SAMPLING ===
  const typeConfig = cfg.types?.[ typeCategory ];
  if (typeConfig?.sampling?.enabled) {
    return Math.random() < typeConfig.sampling.rate;
  }

  // === OPERATION-BASED SAMPLING ===
  if (event.operation && cfg.sampling.operations) {
    for (const [ pattern, rate ] of Object.entries(cfg.sampling.operations)) {
      const regex = getOrCreateSamplingRegex(pattern);
      if (regex.test(event.operation)) {
        return Math.random() < rate;
      }
    }
  }

  // === LEVEL-BASED SAMPLING (Fallback) ===
  const levelName = levelToString(levelValue);
  const rate = cfg.sampling.rates?.[ levelName ];
  if (rate === undefined || rate >= 1) return true;
  if (rate <= 0) return false;

  return Math.random() < rate;
}

function getOrCreateSamplingRegex(pattern: string): RegExp {
  const MAX_REGEX_CACHE_SIZE = 100;

  let regex = samplingRegexCache.get(pattern);
  if (!regex) {
    // Evict oldest entry if cache is full (FIFO eviction)
    if (samplingRegexCache.size >= MAX_REGEX_CACHE_SIZE) {
      const firstKey = samplingRegexCache.keys().next().value;
      if (firstKey !== undefined) {
        samplingRegexCache.delete(firstKey);
      }
    }

    regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    samplingRegexCache.set(pattern, regex);
  }
  return regex;
}

/**
 * Calculate priority for buffer eviction.
 * Higher priority = keep in buffer
 */
function getEventPriority(event: ObservabilityEvent): number {
  // CRITICAL events NEVER get evicted (max priority)
  if (event.critical) {
    return Infinity;
  }

  let priority = 0;

  const level = stringToLevel(event.level);

  // Higher log levels = higher priority
  priority += level * 10;

  // Audit events are high priority
  if (event.type.startsWith('audit')) {
    priority += 50;
  }

  // Spans with errors are high priority
  if (event.type.startsWith('span') && event.success === false) {
    priority += 30;
  }

  // Long duration operations are interesting
  if (event.durationMs && event.durationMs > 1000) {
    priority += 20;
  }

  return priority;
}

/**
 * Evict lowest priority event from buffer
 * Returns metadata about the evicted event for logging
 */
function evictLowestPriority(buffer: ObservabilityEvent[]): { type: string; correlationId: string; operation?: string; level: string } | null {
  if (buffer.length === 0) return null;

  // Find lowest priority event
  let lowestPriority = Infinity;
  let lowestIndex = 0;

  for (let i = 0; i < buffer.length; i++) {
    const priority = getEventPriority(buffer[ i ]);
    if (priority < lowestPriority) {
      lowestPriority = priority;
      lowestIndex = i;
    }
  }

  // Remove and return info about evicted event
  const evicted = buffer.splice(lowestIndex, 1)[ 0 ];
  return {
    type: evicted.type,
    correlationId: evicted.correlationId,
    operation: evicted.operation,
    level: evicted.level,
  };
}

/**
 * Handle tail-based sampling logic for an event (sync version)
 * Returns: 'captured' if event was captured, 'buffered' if buffered, 'skip' if not using tail-based
 */
function handleTailBasedSamplingSync(
  event: ObservabilityEvent,
  context: ReturnType<typeof getCurrentContext>
): 'captured' | 'buffered' | 'skip' {
  if (!config?.sampling?.smart || !context) {
    return 'skip';
  }

  const isError = stringToLevel(event.level) >= ObservabilityLevel.ERROR;

  // ERROR PATH: Flush buffer + capture error + set flag
  if (isError) {
    if (context.observabilityBuffer?.length) {
      const buffer = context.observabilityBuffer as ObservabilityEvent[];
      context.observabilitySummary = context.observabilitySummary || { evicted: 0, buffered: 0, captured: 0 };
      context.observabilityBuffer = [];

      // Apply level filtering to avoid overwhelming backends with thousands of debug/trace events
      // On error, capture INFO+ events, drop TRACE/DEBUG to prevent cost spikes
      const minLevelOnError = config.sampling?.minLevelOnError ?? ObservabilityLevel.INFO;
      let dropped = 0;

      for (const bufferedEvent of buffer) {
        const eventLevel = stringToLevel(bufferedEvent.level);
        if (eventLevel >= minLevelOnError) {
          const targets = getBackendsForType(bufferedEvent.type);
          dispatchToBackends(bufferedEvent, targets);
        } else {
          dropped++;
        }
      }

      if (dropped > 0) {
        logger.debug(`Dropped ${dropped} low-level events from error buffer flush`, {
          minLevel: levelToString(minLevelOnError),
          correlationId: context.correlationId,
        });
      }
    }

    context.errorOccurred = true;
    const targetBackends = getBackendsForType(event.type);
    dispatchToBackends(event, targetBackends);

    // Track captured count
    if (!context.observabilitySummary) {
      context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
    }
    context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;

    return 'captured';
  }

  // POST-ERROR PATH: Capture immediately
  if (context.errorOccurred) {
    const targetBackends = getBackendsForType(event.type);
    dispatchToBackends(event, targetBackends);

    // Track captured count
    if (!context.observabilitySummary) {
      context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
    }
    context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;

    return 'captured';
  }

  // NORMAL PATH: Buffer everything
  if (!context.observabilityBuffer) context.observabilityBuffer = [];
  const buffer = context.observabilityBuffer as ObservabilityEvent[];

  // Initialize summary if needed
  if (!context.observabilitySummary) {
    context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
  }

  // Buffer size management: evict lowest priority if full
  const maxSize = config.sampling.maxBufferSize ?? 1000;
  if (buffer.length >= maxSize) {
    const evictedInfo = evictLowestPriority(buffer);
    context.observabilitySummary.evicted = (context.observabilitySummary.evicted || 0) + 1;

    // Log warning with evicted event details
    if (context.observabilitySummary.evicted === 1 || context.observabilitySummary.evicted % 100 === 0) {
      logger.warn('Observability buffer full, evicting lowest priority events', {
        evicted: context.observabilitySummary.evicted,
        bufferSize: buffer.length,
        correlationId: context.correlationId,
        evictedEvent: evictedInfo,
      });
    } else if (evictedInfo) {
      // Log each eviction at debug level for troubleshooting
      logger.debug('Evicted observability event from buffer', {
        ...evictedInfo,
        totalEvicted: context.observabilitySummary.evicted,
      });
    }
  }

  buffer.push(event);
  context.observabilitySummary.buffered = (context.observabilitySummary.buffered || 0) + 1;
  return 'buffered';
}

/**
 * Handle tail-based sampling logic for an event (async version)
 */
async function handleTailBasedSamplingAsync(
  event: ObservabilityEvent,
  context: ReturnType<typeof getCurrentContext>
): Promise<'captured' | 'buffered' | 'skip'> {
  if (!config?.sampling?.smart || !context) {
    return 'skip';
  }

  const isError = stringToLevel(event.level) >= ObservabilityLevel.ERROR;

  // ERROR PATH: Flush buffer + capture error + set flag
  if (isError) {
    if (context.observabilityBuffer?.length) {
      const buffer = context.observabilityBuffer as ObservabilityEvent[];
      context.observabilitySummary = context.observabilitySummary || { evicted: 0, buffered: 0, captured: 0 };
      context.observabilityBuffer = [];

      // Apply level filtering to avoid overwhelming backends
      const minLevelOnError = config.sampling?.minLevelOnError ?? ObservabilityLevel.INFO;
      let dropped = 0;

      const filteredEvents = buffer.filter(bufferedEvent => {
        const eventLevel = stringToLevel(bufferedEvent.level);
        if (eventLevel >= minLevelOnError) {
          return true;
        }
        dropped++;
        return false;
      });

      await Promise.all(filteredEvents.map(bufferedEvent => {
        const targets = getBackendsForType(bufferedEvent.type);
        return dispatchToBackendsSync(bufferedEvent, targets);
      }));

      if (dropped > 0) {
        logger.debug(`Dropped ${dropped} low-level events from error buffer flush`, {
          minLevel: levelToString(minLevelOnError),
          correlationId: context.correlationId,
        });
      }
    }

    context.errorOccurred = true;
    const targetBackends = getBackendsForType(event.type);
    await dispatchToBackendsSync(event, targetBackends);

    // Track captured count
    if (!context.observabilitySummary) {
      context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
    }
    context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;

    return 'captured';
  }

  // POST-ERROR PATH: Capture immediately
  if (context.errorOccurred) {
    const targetBackends = getBackendsForType(event.type);
    await dispatchToBackendsSync(event, targetBackends);

    // Track captured count
    if (!context.observabilitySummary) {
      context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
    }
    context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;

    return 'captured';
  }

  // NORMAL PATH: Buffer everything
  if (!context.observabilityBuffer) context.observabilityBuffer = [];
  const buffer = context.observabilityBuffer as ObservabilityEvent[];

  // Initialize summary if needed
  if (!context.observabilitySummary) {
    context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
  }

  // Buffer size management: evict lowest priority if full
  const maxSize = config.sampling.maxBufferSize ?? 1000;
  if (buffer.length >= maxSize) {
    evictLowestPriority(buffer);
    context.observabilitySummary.evicted = (context.observabilitySummary.evicted || 0) + 1;

    // Log warning if evicting a lot
    if (context.observabilitySummary.evicted === 1 || context.observabilitySummary.evicted % 100 === 0) {
      logger.warn('Observability buffer full, evicting lowest priority events', {
        evicted: context.observabilitySummary.evicted,
        bufferSize: buffer.length,
        correlationId: context.correlationId
      });
    }
  }

  buffer.push(event);
  context.observabilitySummary.buffered = (context.observabilitySummary.buffered || 0) + 1;
  return 'buffered';
}

/**
 * Initialize backends from DI based on config
 */
function initializeBackendsFromConfig(cfg: ObservabilityConfig): void {
  backends = [];
  backendConfigs.clear();
  const enabledBackends = cfg.backends?.filter(b => b.enabled !== false) ?? [];
  const enabledTypes = enabledBackends.map(b => b.type);

  for (const backendCfg of enabledBackends) {
    try {
      const backend = DIContainer.ROOT.resolve<ObservabilityBackend>(
        'ObservabilityBackend',
        { tags: [ 'observability', 'backend', backendCfg.type ] }
      );
      backends.push(backend);
      backendConfigs.set(backend.name, backendCfg);
      logger.debug(`Initialized backend: ${backend.name}`);
    } catch (error) {
      if (error instanceof NoProviderFoundError) {
        logger.warn(`Backend '${backendCfg.type}' not found in DI, skipping`);
      } else {
        logger.error(`Failed to initialize backend '${backendCfg.type}':`, error);
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
      // Create default config for fallback
      backendConfigs.set(backend.name, { type: 'cloudwatch', enabled: true });
    } catch (error) {
      logger.error('Failed to resolve fallback CloudWatch backend:', error);
    }
  }
}

function doInitialize(): void {
  try {
    logger.info('=== OBSERVABILITY INITIALIZATION START ===');

    // Resolve config from DI (defaults registered in index.ts guarantee all required fields)
    config = DIContainer.ROOT.resolveConfig<ObservabilityConfig>('observability') as ObservabilityConfig;
    logger.info('Observability config loaded from DI', {
      enabled: config.enabled,
      serviceName: config.serviceName,
      backends: config.backends?.map(b => b.type),
      sampling: { enabled: config.sampling?.enabled, smart: config.sampling?.smart },
    });

    // Initialize backends from DI
    initializeBackendsFromConfig(config!);
    logger.info(`Initialized ${backends.length} backend(s):`, backends.map(b => b.name));

    // Register capturer for observers
    initializeCapturer({
      capture: (input, options) => ObservabilityManager.capture(input, options),
      captureAsync: (input, options) => ObservabilityManager.captureAsync(input, options),
    });

    initialized = true;
    logger.info('=== OBSERVABILITY INITIALIZATION COMPLETE ===');
  } catch (error) {
    logger.error('!!! OBSERVABILITY INITIALIZATION FAILED !!!', error);
    // Set initialized = true anyway to prevent repeated init attempts
    initialized = true;
    // Re-throw so we know something is broken
    throw error;
  }
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
    logger.debug('ObservabilityManager.initializeInvocation() called', { initialized, invocationCount });

    if (!initialized) {
      logger.debug('Not initialized yet, calling doInitialize()...');
      doInitialize();
    }

    invocationCount++;
    logger.debug(`Invocation ${invocationCount} starting, initializing ${backends.length} backend(s)`);

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
      logger.warn('❌ Observability not initialized, skipping capture', { type: input.type, level: input.level });
      return undefined;
    }

    try {
      const errors = validateInput(input);
      if (errors.length > 0) {
        logger.warn('Invalid capture input:', { errors, type: input.type });
        return undefined;
      }

      if (!config?.enabled) {
        logger.debug('Observability disabled, skipping capture', { type: input.type });
        return undefined;
      }

      const context = getCurrentContext();
      // Merge critical flag from options into input for event creation
      const eventInput = options?.critical ? { ...input, critical: true } : input;
      const event = buildEvent(eventInput, context);

      // Try tail-based sampling first
      const tailResult = handleTailBasedSamplingSync(event, context);
      if (tailResult === 'captured') {
        return event.observabilityLogId;
      }
      if (tailResult === 'buffered') {
        return undefined;
      }

      // HEAD-BASED SAMPLING (Standard)
      const isSampled = event.critical || shouldCapture(event, config);
      if (!isSampled) {
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
   * Capture an observability event asynchronously (waits for backend capture)
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

      const context = getCurrentContext();
      // Merge critical flag from options into input for event creation
      const eventInput = options?.critical ? { ...input, critical: true } : input;
      const event = buildEvent(eventInput, context);

      // Try tail-based sampling first
      const tailResult = await handleTailBasedSamplingAsync(event, context);
      if (tailResult === 'captured') {
        return event.observabilityLogId;
      }
      if (tailResult === 'buffered') {
        return undefined;
      }

      // HEAD-BASED SAMPLING (Standard)
      const isSampled = event.critical || shouldCapture(event, config);
      if (!isSampled) {
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
   * Flush all backends and buffered events (called at end of Lambda invocation)
   */
  static async flush(): Promise<void> {
    logger.debug('=== FLUSH START ===', {
      pendingDispatches: pendingDispatches.length,
      backends: backends.length,
      smartSampling: config?.sampling?.smart,
    });

    // Wait for all pending fire-and-forget dispatches (from error path in capture())
    if (pendingDispatches.length > 0) {
      logger.debug(`Waiting for ${pendingDispatches.length} pending dispatches`);
      await Promise.all(pendingDispatches);
      pendingDispatches.length = 0; // Clear for next invocation
      logger.debug('Pending dispatches completed');
    }

    // If smart sampling is enabled, flush buffered events with sampling applied
    if (config?.sampling?.smart) {
      const context = getCurrentContext();

      if (context?.observabilityBuffer?.length && !context.errorOccurred) {
        // No error occurred: apply sampling to buffer before flushing
        const buffer = context.observabilityBuffer as ObservabilityEvent[];
        context.observabilityBuffer = []; // Clear buffer

        for (const event of buffer) {
          // Apply sampling rules to buffered event
          const isSampled = shouldCapture(event, config);
          if (isSampled) {
            const targets = getBackendsForType(event.type);
            await dispatchToBackendsSync(event, targets);
          }
          // else: dropped by sampling
        }
      }
      // If errorOccurred=true, buffer was already flushed during capture
    }

    // Flush all backends with retry logic
    const MAX_FLUSH_RETRIES = 2;
    const flushPromises = backends.map(async (backend) => {
      if (!backend.flush) {
        return;
      }

      for (let attempt = 1; attempt <= MAX_FLUSH_RETRIES; attempt++) {
        try {
          await backend.flush();
          break; // Success
        } catch (error) {
          if (attempt === MAX_FLUSH_RETRIES) {
            logger.error(`Backend ${backend.name} flush failed after ${attempt} attempts:`, error);
            // Events may be lost, but we've done our best
          } else {
            logger.warn(`Backend ${backend.name} flush failed (attempt ${attempt}/${MAX_FLUSH_RETRIES}), retrying...`, error);
            // Simple exponential backoff
            await new Promise(resolve => setTimeout(resolve, 100 * attempt));
          }
        }
      }
    });

    await Promise.all(flushPromises);
    logger.debug('=== FLUSH COMPLETE ===');
  }

  /**
   * Reset manager state (for testing)
   */
  static reset(): void {
    config = null;
    backends = [];
    backendConfigs.clear();
    invocationCount = 0;
    initialized = false;
    samplingRegexCache.clear();
    pendingDispatches.length = 0;
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
