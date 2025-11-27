/**
 * ObservabilityManager - Core Observer for the observability system
 * 
 * DESIGN PRINCIPLES:
 * - Required fields (correlationId, type, level) must be provided - no auto-generation
 * - Never crash the application - log errors and continue
 * - Synchronous initialization from environment
 * - Fire-and-forget capture for non-blocking operation
 * 
 * Usage:
 * ```typescript
 * // REQUIRED: Establish context with correlationId first
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Then use observers
 *     SpanObserver.start('operation');
 *     AuditObserver.entityCreate('User', userId, data);
 *   }
 * );
 * ```
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../logging';
import { Actor } from '../core/types/execution-context';
import {
  CaptureInput,
  CaptureOptions,
  IEventCapture,
  ObservabilityBackend,
  ObservabilityBackendConfig,
  ObservabilityConfig,
  ObservabilityEvent,
  ObservabilityLevel,
  ObservationContext,
} from './types';
import { ConfigManager, validateConfig } from './config';
import { stringToLevel } from './utils/level-utils';
import { detectSource, mergeTags } from './utils/source-utils';
import {
  getCurrentContext,
  createObservationContext,
  runWithContext,
  runWithContextSync,
  setContextActor,
  addContextTags,
  getCorrelationIdIfExists,
} from './context';

// Static imports for backends (enables tree-shaking and compile-time type checking)
import { CloudWatchBackend } from './backends/cloudwatch';
import { DynamoDBObservabilityBackend } from './backends/dynamodb';
import { OTELObservabilityBackend } from './backends/otel';

// Import base observer utilities to inject ourselves
import { initializeCapturer, resetCapturer } from './observers/base';

const logger = createLogger('ObservabilityManager');

/**
 * Validation error structure
 */
interface ValidationError {
  field: string;
  message: string;
}

/**
 * ObservabilityManager - core static class for the observability system.
 * 
 * For testability, use the IEventCapture interface via base.ts setCapturer().
 * This class's static methods satisfy IEventCapture when wrapped.
 */
export class ObservabilityManager {
  private static configManager: ConfigManager | null = null;
  private static backends: ObservabilityBackend[] = [];
  private static invocationCount = 0;
  private static initialized = false;

  // Pre-compiled sampling regexes for operation patterns
  private static samplingRegexCache = new Map<string, RegExp>();

  /**
   * Initialize with explicit configuration
   */
  static initialize(config: Partial<ObservabilityConfig>, backends?: ObservabilityBackend[]): void {
    const fullConfig = new ConfigManager(config).getAll();
    const errors = validateConfig(fullConfig);
    if (errors.length > 0) {
      logger.error('Invalid observability config:', errors);
      throw new Error(`Invalid observability config: ${errors.join(', ')}`);
    }
    this.configManager = new ConfigManager(config);
    if (backends) {
      this.backends = backends;
    }
    this.initialized = true;
  }

  /**
   * Get current configuration
   * Initializes from environment if not already initialized
   */
  static getConfig(): ObservabilityConfig {
    this.ensureInitialized();
    return this.configManager!.getAll();
  }

  /**
   * Update configuration at runtime
   */
  static configure(updates: Partial<ObservabilityConfig>): void {
    this.ensureInitialized();
    this.configManager!.update(updates);
  }

  /**
   * Register a backend
   */
  static registerBackend(backend: ObservabilityBackend): void {
    if (this.backends.find((b) => b.name === backend.name)) {
      logger.warn(`Backend ${backend.name} already registered`);
      return;
    }
    this.backends.push(backend);
  }

  /**
   * Unregister a backend
   */
  static unregisterBackend(name: string): void {
    this.backends = this.backends.filter((b) => b.name !== name);
  }

  /**
   * Initialize for a new Lambda invocation
   * Called at the start of each invocation
   */
  static initializeInvocation(): void {
    this.ensureInitialized();
    this.invocationCount++;

    for (const backend of this.backends) {
      try {
        backend.initializeInvocation?.();
      } catch (error) {
        logger.error(`Backend ${backend.name} failed to initialize invocation:`, error);
        // Don't throw - continue with other backends
      }
    }
  }

  /**
   * Check if this is a cold start
   */
  static isColdStart(): boolean {
    return this.invocationCount === 1;
  }

  /**
   * Get current invocation count
   */
  static getInvocationCount(): number {
    return this.invocationCount;
  }

  /**
   * Capture an observability event
   * 
   * REQUIRED fields (must be in input or context):
   * - type: Event type
   * - level: Severity level
   * - correlationId: From context or explicit
   * 
   * @param input - Event input
   * @param options - Capture options (critical, sync)
   * @returns logId if captured, undefined if filtered/sampled out or invalid
   */
  static capture(input: CaptureInput, options?: CaptureOptions): string | undefined {
    try {
      // Validate required fields
      const errors = this.validateInput(input);
      if (errors.length > 0) {
        logger.warn('Invalid capture input:', { errors, type: input.type });
        return undefined;
      }

      const config = this.getConfig();
      if (!config.enabled) return undefined;

      // Build complete event
      const event = this.buildEvent(input);

      // Check if should capture (sampling, level) - skip if critical
      if (!options?.critical && !this.shouldCapture(event, config)) {
        return undefined;
      }

      // Get backends for this specific type
      const backends = this.getBackendsForType(event.type);

      // Dispatch to backends (fire-and-forget, batched by flush())
      // Use captureAsync() if you need guaranteed persistence
      this.dispatchToBackends(event, backends);

      return event.logId;
    } catch (error) {
      // NEVER crash the application
      logger.error('Unexpected error in capture:', error);
      return undefined;
    }
  }

  /**
   * Capture an observability event asynchronously
   * 
   * Use this when you need to await backend completion (e.g., for critical audits).
   * 
   * @param input - Event input
   * @param options - Capture options (critical bypasses sampling)
   * @returns Promise<logId> if captured, undefined if filtered/sampled out or invalid
   */
  static async captureAsync(input: CaptureInput, options?: Omit<CaptureOptions, 'sync'>): Promise<string | undefined> {
    try {
      const errors = this.validateInput(input);
      if (errors.length > 0) {
        logger.warn('Invalid capture input:', { errors, type: input.type });
        return undefined;
      }

      const config = this.getConfig();
      if (!config.enabled) return undefined;

      const event = this.buildEvent(input);

      if (!options?.critical && !this.shouldCapture(event, config)) {
        return undefined;
      }

      const backends = this.getBackendsForType(event.type);
      await this.dispatchToBackendsSync(event, backends);

      return event.logId;
    } catch (error) {
      logger.error('Unexpected error in captureAsync:', error);
      return undefined;
    }
  }

  /**
   * Observe an event (alias for capture with Partial<ObservabilityEvent>)
   * 
   * This is the primary method for recording observations.
   * Prefer using specialized observers (SpanObserver, AuditObserver, etc.)
   * 
   * @param event - Partial event (correlationId, type, level required)
   * @param options - Capture options
   * @returns logId if captured, undefined if filtered/sampled out
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

    return this.capture({
      ...event,
      correlationId,
      type: event.type as CaptureInput[ 'type' ],
      level: event.level as CaptureInput[ 'level' ],
    }, options);
  }

  /**
   * Validate capture input
   */
  private static validateInput(input: CaptureInput): ValidationError[] {
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

  /**
   * Build complete event from input
   */
  private static buildEvent(input: CaptureInput): ObservabilityEvent {
    const context = getCurrentContext();
    const now = Date.now();

    // correlationId is validated to exist in either input or context before buildEvent is called
    const correlationId = input.correlationId ?? context?.correlationId;
    if (!correlationId) {
      // This should never happen due to validateInput, but TypeScript needs assurance
      throw new Error('correlationId is required - this should have been caught by validation');
    }

    return {
      // Required fields
      type: input.type,
      level: input.level,
      correlationId,
      timestampMs: input.timestampMs ?? now,
      logId: input.logId ?? randomUUID(),

      // Context inheritance (input takes precedence)
      parentLogId: input.parentLogId ?? context?.parentLogId,
      actor: input.actor ?? context?.actor,
      source: input.source ?? context?.source ?? detectSource(),
      tags: mergeTags({ ...context?.tags, ...input.tags }, true),

      // Pass through optional fields
      entityName: input.entityName,
      entityId: input.entityId,
      operation: input.operation,
      subType: input.subType,
      status: input.status,
      success: input.success,
      durationMs: input.durationMs,
      data: input.data,
      attributes: input.attributes,
      metadata: input.metadata,
      metrics: input.metrics,
      context: input.context,
      error: input.error,
    };
  }

  /**
   * Dispatch event to backends (fire-and-forget)
   */
  private static dispatchToBackends(event: ObservabilityEvent, backends: ObservabilityBackend[]): void {
    // Fire-and-forget - don't await
    void Promise.all(
      backends.map(async (backend) => {
        try {
          // Check backend-specific level filter
          if (backend.minLevel !== undefined) {
            const eventLevel = stringToLevel(event.level);
            if (eventLevel < backend.minLevel) {
              return;
            }
          }
          await backend.capture(event);
        } catch (error) {
          logger.error(`Failed to capture in backend ${backend.name}:`, error);
          // Don't throw - continue with other backends
        }
      }),
    );
  }

  /**
   * Dispatch event to backends (synchronous - waits for completion)
   */
  private static async dispatchToBackendsSync(event: ObservabilityEvent, backends: ObservabilityBackend[]): Promise<void> {
    await Promise.all(
      backends.map(async (backend) => {
        try {
          // Check backend-specific level filter
          if (backend.minLevel !== undefined) {
            const eventLevel = stringToLevel(event.level);
            if (eventLevel < backend.minLevel) {
              return;
            }
          }
          await backend.capture(event);
        } catch (error) {
          logger.error(`Failed to capture in backend ${backend.name}:`, error);
          // Don't throw - continue with other backends
        }
      }),
    );
  }

  /**
   * Get backends configured for a specific event type
   */
  private static getBackendsForType(type: string): ObservabilityBackend[] {
    const typeCategory = this.getTypeCategory(type);
    const typeConfig = this.configManager?.getTypeConfig(typeCategory);

    if (typeConfig?.backends && typeConfig.backends.length > 0) {
      // Use type-specific backends
      return this.backends.filter((b) => typeConfig.backends!.includes(b.name as 'cloudwatch' | 'dynamodb' | 'otel'));
    }

    // Use all backends
    return this.backends;
  }

  /**
   * Map event type to category
   */
  private static getTypeCategory(type: string): keyof NonNullable<ObservabilityConfig[ 'types' ]> {
    if (type.startsWith('span.')) return 'span';
    if (type === 'metric') return 'metric';
    if (type.startsWith('audit')) return 'audit';
    if (type.startsWith('workflow.')) return 'workflow';
    if (type.startsWith('decision')) return 'decision';
    if (type.startsWith('access.')) return 'access';
    return 'log';
  }

  /**
   * Flush all backends
   * Called before Lambda returns
   */
  static async flush(): Promise<void> {
    const flushPromises = this.backends.map(async (backend) => {
      if (backend.flush) {
        try {
          await backend.flush();
        } catch (error) {
          logger.error(`Failed to flush backend ${backend.name}:`, error);
          // Don't throw - continue with other backends
        }
      }
    });

    await Promise.all(flushPromises);
  }

  /**
   * Check if event should be captured based on level and sampling
   */
  private static shouldCapture(event: ObservabilityEvent, config: ObservabilityConfig): boolean {
    const levelValue = stringToLevel(event.level);

    // Check type-specific level first
    const typeCategory = this.getTypeCategory(event.type);
    const effectiveLevel = this.configManager?.getEffectiveLevelForType(typeCategory) ?? config.minLevel;

    // Level check
    if (levelValue < effectiveLevel) {
      return false;
    }

    // CRITICAL always captured
    if (levelValue === ObservabilityLevel.CRITICAL) {
      return true;
    }

    // Sampling disabled = capture all
    if (!config.sampling.enabled) {
      return true;
    }

    // Type-specific sampling
    const typeConfig = this.configManager?.getTypeConfig(typeCategory);
    if (typeConfig?.sampling?.enabled) {
      return Math.random() < typeConfig.sampling.rate;
    }

    // Operation-specific sampling (with cached regex)
    if (event.operation && config.sampling.operations) {
      for (const [ pattern, rate ] of Object.entries(config.sampling.operations)) {
        const regex = this.getOrCreateSamplingRegex(pattern);
        if (regex.test(event.operation)) {
          return Math.random() < rate;
        }
      }
    }

    // Level-based sampling
    const rate = config.sampling.rates[ levelValue ];
    if (rate === undefined || rate >= 1) return true;
    if (rate <= 0) return false;

    return Math.random() < rate;
  }

  /**
   * Initialize from environment (synchronous)
   */
  private static ensureInitialized(): void {
    if (this.initialized) return;

    // Parse environment configuration using ConfigManager
    const envConfig = ConfigManager.fromEnvironment();
    this.configManager = new ConfigManager(envConfig);

    const config = this.configManager.getAll();
    const minLevel = config.minLevel;
    const backendConfigs = config.backends;
    const backendNames = backendConfigs.map(b => b.type);

    // Initialize backend instances using static imports (enables tree-shaking)
    for (const type of backendNames) {
      try {
        switch (type) {
          case 'dynamodb':
            this.backends.push(
              new DynamoDBObservabilityBackend({
                minLevel,
                ttlDays: config.dynamodb.ttlDays,
              }),
            );
            break;
          case 'otel':
            this.backends.push(
              new OTELObservabilityBackend({
                serviceName: config.serviceName,
                minLevel,
              }),
            );
            break;
          case 'cloudwatch':
            this.backends.push(
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

    // Default to cloudwatch if no backends configured
    if (this.backends.length === 0) {
      try {
        this.backends.push(
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

    this.initialized = true;

    // Inject ourselves into base.ts to break circular dependency
    // This allows observers to use capture() without importing manager directly
    initializeCapturer({
      capture: (input, options) => this.capture(input, options),
      captureAsync: (input, options) => this.captureAsync(input, options),
    });
  }

  /**
   * Get or create a cached regex for sampling pattern
   */
  private static getOrCreateSamplingRegex(pattern: string): RegExp {
    let regex = this.samplingRegexCache.get(pattern);
    if (!regex) {
      regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      this.samplingRegexCache.set(pattern, regex);
    }
    return regex;
  }

  /**
   * Reset manager state (for testing)
   * 
   * IMPORTANT: This also resets the capturer in base.ts to ensure
   * observers can be properly re-initialized in tests.
   */
  static reset(): void {
    this.configManager = null;
    this.backends = [];
    this.invocationCount = 0;
    this.initialized = false;
    this.samplingRegexCache.clear();

    // Also reset the capturer in base.ts - critical for test isolation
    resetCapturer();
  }

  // ============================================
  // CONTEXT CONVENIENCE METHODS
  // These delegate to context.ts but provide a unified API
  // ============================================

  /**
   * Create a new observation context
   * 
   * @param correlationId - REQUIRED - the trace/correlation ID
   * @param options - Optional context options
   */
  static createContext(
    correlationId: string,
    options?: {
      parentLogId?: string;
      actor?: Actor;
      tags?: Record<string, string>;
      source?: string;
    }
  ): ObservationContext {
    return createObservationContext(correlationId, options);
  }

  /**
   * Get current observation context
   */
  static currentContext(): ObservationContext | undefined {
    return getCurrentContext();
  }

  /**
   * Run a function within an observation context
   * 
   * @example
   * ```typescript
   * await Observer.withContext(
   *   Observer.createContext(requestId, { actor }),
   *   async () => {
   *     // All observations here share correlationId
   *   }
   * );
   * ```
   */
  static async withContext<T>(
    context: ObservationContext,
    fn: () => Promise<T>
  ): Promise<T> {
    return runWithContext(context, fn);
  }

  /**
   * Run a function within an observation context (sync)
   */
  static withContextSync<T>(
    context: ObservationContext,
    fn: () => T
  ): T {
    return runWithContextSync(context, fn);
  }

  /**
   * Set actor on current context
   * 
   * Useful when actor becomes available mid-flow (e.g., after authentication)
   */
  static setActor(actor: Actor): void {
    setContextActor(actor);
  }

  /**
   * Add tags to current context
   */
  static addTags(tags: Record<string, string>): void {
    addContextTags(tags);
  }
}

/**
 * Lambda handler wrapper with observability lifecycle management
 * 
 * Ensures:
 * - Manager is initialized
 * - Invocation is tracked
 * - Backends are flushed before returning
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
