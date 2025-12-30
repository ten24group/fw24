/**
 * ObservabilityManager - Core Observer for the observability system
 * 
 * All config and backends resolved from DI - no manual instantiation.
 */

import { generateSpanId, generateObservabilityLogId } from './utils/id-generator';
import { createLogger } from '../logging';
import {
  CaptureControl,
  CaptureInput,
  ObservabilityBackend,
  ObservabilityConfig,
  ObservabilityError,
  ObservabilityEvent,
  ObservabilityLevel,
  SamplingRule,
} from './types';
import type { ObservabilitySummary } from '../core/runtime/execution-context/types';
import { stringToLevel, levelToString } from './utils/level-utils';
import { detectSource, mergeTags } from './utils/source-utils';
import { redactSensitiveData } from './utils/data-protection';
import { getCurrentContext, getCorrelationIdIfExists } from './context';
import { initializeCapturer, resetCapturer } from './observers/base';
import { DIContainer } from '../di';
import { NoProviderFoundError } from '../di/errors';
import { applyNoiseReduction } from './noise-reduction';
import { buildTraceGraph } from './trace-graph';
import { createObservabilityConfig, type ObservabilityConfigInput } from './config';
import { setCurrentObservabilityConfig, runSpanFinalizer } from './runtime-state';
import { matchesPattern, replacePattern } from './utils/pattern-utils';

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

/**
 * Pre-initialization hooks - callbacks that run before backends are initialized.
 * Used to register schemas/services needed by backends without circular dependencies.
 */
const preInitHooks: Array<() => void> = [];

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
      message: 'correlationId is required. Context is auto-established in controllers, or use runWithExecutionContext().'
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

  // Operation normalization (reduce cardinality + improve cross-backend consistency)
  const opNorm = config?.operationNormalization;
  let operation = input.operation;
  let operationNormalizationMeta: Record<string, unknown> | undefined;
  if (opNorm?.enabled && operation) {
    const originalOperation = operation;
    const appliedRules: Array<{ id: string; from: string; to: string; reason?: string }> = [];
    const typeMatch = (
      ruleTypes: ObservabilityConfig[ 'operationNormalization' ][ 'rules' ][ number ][ 'types' ] | undefined,
      eventType: string
    ) => {
      if (!ruleTypes) return true;
      const arr = Array.isArray(ruleTypes) ? ruleTypes : [ ruleTypes ];
      // Compare by string to avoid unsafe casting (ObservabilityEventType is string-based anyway).
      return arr.map(String).includes(eventType);
    };

    for (const rule of opNorm.rules ?? []) {
      if (!typeMatch(rule.types, input.type)) continue;
      if (!matchesPattern(operation, rule.match)) continue;
      const next = replacePattern(operation, rule.match, rule.replace);
      if (next !== operation) {
        appliedRules.push({ id: rule.id, from: operation, to: next, reason: rule.reason });
        operation = next;
      }
    }

    // Only attach meta if the operation actually changed
    if (opNorm.storeOriginal !== false && operation !== originalOperation) {
      operationNormalizationMeta = {
        from: originalOperation,
        to: operation,
        ruleIds: appliedRules.map(r => r.id),
        rules: appliedRules,
      };
    }
  }

  return {
    type: input.type,
    level: input.level,
    correlationId,
    timestampMs: input.timestampMs ?? now,
    observabilityLogId: input.observabilityLogId ?? generateObservabilityLogId(correlationId),
    // null = explicitly no parent - parentObservabilityLogId should be resolved by caller (span tree)
    // undefined = use what was provided
    parentObservabilityLogId: input.parentObservabilityLogId === null ? undefined : input.parentObservabilityLogId,
    causedBy: input.causedBy,
    relatedTraces: input.relatedTraces,
    actor: input.actor ?? ctx?.actor,
    source: input.source ?? ctx?.observability?.source ?? detectSource(),
    tags: mergeTags({ ...ctx?.observability?.tags, ...input.tags }, true),
    entityName: input.entityName,
    entityId: input.entityId,
    operation,
    subType: input.subType,
    status: input.status,
    success: input.success,
    durationMs: input.durationMs,
    data: operationNormalizationMeta
      ? { ...(data ?? {}), operationNormalization: operationNormalizationMeta }
      : data,
    attributes,
    metadata,
    metrics: input.metrics,
    context: eventContext,
    error,
    capture: input.capture,
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
  // 'span' = consolidated span record, 'span.start' = OTEL-only start marker.
  // FW24 does NOT support legacy span.* record formats (no compatibility guarantees).
  if (type === 'span' || type === 'span.start') return 'span';
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
  // Per-event backend filter (used for OTEL span tracking in consolidated mode)
  if (event.capture?.backends && event.capture.backends.length > 0) {
    if (!event.capture.backends.includes(backend.name as 'cloudwatch' | 'dynamodb' | 'otel')) {
      return false;
    }
  }

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

function enforceHierarchyIntegrityOrDrop(
  events: ObservabilityEvent[],
  ctxCorrelationId: string,
): ObservabilityEvent[] {
  // Strict contract: parentObservabilityLogId must always refer to an existing span within this slice.
  // If violated (likely due to manual injection), we drop offending events and emit a single error log.
  const graph = buildTraceGraph(events, { strictParents: false });
  if (graph.missingParentSpanIds.size === 0 && graph.crossSliceParentSpanIds.size === 0) return events;

  const missing = graph.missingParentSpanIds;
  const crossSlice = graph.crossSliceParentSpanIds;
  const filtered = events.filter((e) => {
    const pid = e.parentObservabilityLogId ?? undefined;
    return !(pid && (missing.has(pid) || crossSlice.has(pid)));
  });

  const droppedCount = events.length - filtered.length;
  filtered.push({
    type: 'log',
    level: 'error',
    correlationId: ctxCorrelationId,
    timestampMs: Date.now(),
    observabilityLogId: generateObservabilityLogId(ctxCorrelationId),
    operation: 'observability.invariant_violation.missing_parent_span',
    success: false,
    capture: { bypass: true },
    data: {
      droppedCount,
      missingParentSpanIds: Array.from(missing).slice(0, 10),
      crossSliceParentSpanIds: Array.from(crossSlice).slice(0, 10),
    },
    source: 'ObservabilityManager.flush',
  });

  return filtered;
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

function shouldCapture(
  event: ObservabilityEvent,
  cfg: ObservabilityConfig,
  options?: {
    /**
     * When true, spans may be dropped based on cfg.spans.minDurationMs.
     * When false, spans are always kept (needed when we cannot see the full parent/child graph).
     */
    allowSpanMinDurationDrop?: boolean;
    /**
     * Parent span IDs referenced by buffered events.
     * If a span is referenced here, it must NEVER be dropped.
     */
    referencedParentSpanIds?: ReadonlySet<string>;
  }
): boolean {
  const levelValue = stringToLevel(event.level);
  const typeCategory = getTypeCategory(event.type);
  const effectiveLevel = getEffectiveLevelForType(typeCategory);
  const capture = event.capture;
  const isSpanRecord = event.type === 'span';
  const allowSpanMinDurationDrop = options?.allowSpanMinDurationDrop === true;
  const referencedParentSpanIds = options?.referencedParentSpanIds;

  // === BYPASS SAMPLING (always capture) ===
  // Priority order - if any of these match, capture immediately

  // 1. Explicit bypass flag in CaptureControl
  if (capture?.bypass) {
    return true;
  }

  // 2. CRITICAL log level always captured
  if (levelValue === ObservabilityLevel.CRITICAL) {
    return true;
  }

  // 3. Errors always captured
  if (event.error || event.success === false) {
    return true;
  }

  // === SPAN-SPECIFIC FILTERING ===
  if (isSpanRecord) {
    const id = event.observabilityLogId;
    if (id && referencedParentSpanIds?.has(id)) {
      return true;
    }

    if (allowSpanMinDurationDrop && event.durationMs !== undefined) {
      // Per-event minDurationMs overrides global config
      // Set capture.minDurationMs = 0 to capture regardless of duration
      const minDuration = capture?.minDurationMs ?? cfg.spans.minDurationMs;

      if (minDuration > 0 && event.durationMs < minDuration) {
        return false;
      }
    }
  }

  // === CAPTURE CONTROL FILTERING ===

  // 4. Duration threshold for non-span events (e.g., slow queries)
  if (!isSpanRecord && capture?.minDurationMs !== undefined && event.durationMs !== undefined) {
    if (event.durationMs < capture.minDurationMs) {
      return false;
    }
  }

  // 5. Group-based sampling for batch scenarios
  if (capture?.group) {
    const { index, captureFirst = 3, sampleRate = 0.1 } = capture.group;

    // Note: Errors already returned true above (line ~360)
    // Capture first N items
    if (index < captureFirst) {
      return true;
    }

    // Sample the rest
    return Math.random() < sampleRate;
  }

  // === STANDARD FILTERING (may reject) ===
  // Check minimum level
  if (levelValue < effectiveLevel) {
    return false;
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
  // Bypass events NEVER get evicted (max priority)
  if (event.capture?.bypass) {
    return Infinity;
  }

  // Use explicit priority if provided
  let priority = event.capture?.priority ?? 0;

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
function evictLowestPriority(
  buffer: ObservabilityEvent[],
  options?: { allowEvictSpans?: boolean }
): { type: string; correlationId: string; operation?: string; level: string; removedCount?: number } | null {
  if (buffer.length === 0) return null;

  const allowEvictSpans = options?.allowEvictSpans === true;

  // STRICT TREE EVICTION:
  // When the buffer is full, we MUST NOT evict a parent span while keeping its children,
  // otherwise flush() will emit `observability.invariant_violation.missing_parent_span`.
  //
  // We solve this like a real tree problem:
  // 1) Prefer evicting "leaf" events: events that are NOT referenced as a parentObservabilityLogId by any other buffered event.
  // 2) Prefer evicting non-span leaves (logs/metrics) before spans.
  // 3) If no leaves exist (rare), evict an event AND its whole descendant subtree so no orphans remain.

  const referencedAsParent = new Set<string>();
  const childrenByParent = new Map<string, ObservabilityEvent[]>();
  for (const e of buffer) {
    const pid = e.parentObservabilityLogId ?? undefined;
    if (typeof pid === 'string' && pid.length > 0) {
      referencedAsParent.add(pid);
      const arr = childrenByParent.get(pid);
      if (arr) arr.push(e);
      else childrenByParent.set(pid, [ e ]);
    }
  }

  const isSpan = (e: ObservabilityEvent) => e.type === 'span' || e.type === 'span.start';
  const getId = (e: ObservabilityEvent) => e.observabilityLogId;
  const isLeaf = (e: ObservabilityEvent) => {
    const id = getId(e);
    if (!id) return true;
    return !referencedAsParent.has(id);
  };

  const pickLowest = (candidates: ObservabilityEvent[]) => {
    let idx = -1;
    let lowest = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const p = getEventPriority(candidates[ i ]);
      if (p < lowest) {
        lowest = p;
        idx = i;
      }
    }
    return idx;
  };

  // If spans are not allowed to be evicted, constrain candidates to non-span events only.
  const nonSpans = buffer.filter((e) => !isSpan(e));

  // Pass 1: non-span leaves
  const nonSpanLeaves = nonSpans.filter((e) => isLeaf(e));
  let target: ObservabilityEvent | undefined;
  if (nonSpanLeaves.length > 0) {
    const idx = pickLowest(nonSpanLeaves);
    target = nonSpanLeaves[ idx ];
  } else {
    if (!allowEvictSpans) {
      // Pass 2 (non-span only): if we can't find a non-span leaf, evict the lowest-priority non-span.
      // This preserves hierarchy because non-spans are not expected to be parents.
      if (nonSpans.length > 0) {
        const idx = pickLowest(nonSpans);
        target = nonSpans[ idx ];
      } else {
        // Buffer contains only spans - caller must decide whether to allow span eviction or overflow.
        return null;
      }
    } else {
      // Pass 2: any leaves (including spans)
      const anyLeaves = buffer.filter((e) => isLeaf(e));
      if (anyLeaves.length > 0) {
        const idx = pickLowest(anyLeaves);
        target = anyLeaves[ idx ];
      } else {
        // Pass 3: no leaves exist (cycle/degenerate). Pick the overall lowest-priority event.
        const idx = pickLowest(buffer);
        target = buffer[ idx ];
      }
    }
  }

  if (!target) return null;

  const targetId = getId(target);
  let removedCount = 0;

  // If target is referenced as a parent, remove its entire subtree (BFS).
  const toRemove = new Set<ObservabilityEvent>();
  const queue: ObservabilityEvent[] = [ target ];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (toRemove.has(cur)) continue;
    toRemove.add(cur);
    const curId = getId(cur);
    if (curId) {
      const kids = childrenByParent.get(curId);
      if (kids) queue.push(...kids);
    }
  }

  // Filter buffer in-place
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (toRemove.has(buffer[ i ])) {
      buffer.splice(i, 1);
      removedCount++;
    }
  }

  return {
    type: target.type,
    correlationId: target.correlationId,
    operation: target.operation,
    level: target.level,
    removedCount,
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
  const cfg = config;
  if (!cfg) return 'skip';
  const shouldBufferForPolicy = cfg.noiseReduction.enabled;
  const shouldBufferForSampling = !!cfg.sampling?.smart;
  if ((!shouldBufferForSampling && !shouldBufferForPolicy) || !context) {
    return 'skip';
  }

  const isError = stringToLevel(event.level) >= ObservabilityLevel.ERROR;

  // ERROR PATH: Flush buffer + capture error + set flag
  if (isError) {
    const obsState = context.observability;
    if (obsState.buffer.length > 0) {
      const buffer = obsState.buffer;
      obsState.buffer = [];

      const reduced = applyNoiseReduction(buffer, cfg.noiseReduction);
      const reducedBuffer = enforceHierarchyIntegrityOrDrop(reduced.events, context.correlationId);

      // Apply level filtering to avoid overwhelming backends with thousands of debug/trace events
      // On error, capture INFO+ events, drop TRACE/DEBUG to prevent cost spikes
      const minLevelOnError = cfg.sampling?.minLevelOnError ?? ObservabilityLevel.INFO;
      let dropped = 0;

      for (const bufferedEvent of reducedBuffer) {
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

    obsState.errorOccurred = true;
    const targetBackends = getBackendsForType(event.type);
    dispatchToBackends(event, targetBackends);
    obsState.summary.captured++;

    return 'captured';
  }

  // POST-ERROR PATH: Capture immediately
  if (context.observability.errorOccurred) {
    const targetBackends = getBackendsForType(event.type);
    dispatchToBackends(event, targetBackends);
    context.observability.summary.captured++;

    return 'captured';
  }

  // NORMAL PATH: Buffer everything
  const obsState = context.observability;
  const buffer = obsState.buffer;

  // Buffer size management: evict lowest priority if full
  const maxSize = cfg.sampling?.maxBufferSize ?? 1000;
  if (buffer.length >= maxSize) {
    // IMPORTANT:
    // During buffering (noise reduction / smart sampling), spans may be emitted AFTER their children.
    // Evicting spans opportunistically can therefore create future orphan children (missing_parent_span).
    // Prefer evicting non-span events only; if the buffer is spans-only, allow bounded overflow.
    const evictedInfo = evictLowestPriority(buffer, { allowEvictSpans: false });
    if (evictedInfo) {
      obsState.summary.evicted++;
    } else {
      // Spans-only overflow: allow buffer growth up to 2x before evicting span subtrees.
      const hardCap = maxSize * 2;
      if (buffer.length >= hardCap) {
        const evictedSpanInfo = evictLowestPriority(buffer, { allowEvictSpans: true });
        if (evictedSpanInfo) {
          obsState.summary.evicted++;
        }
      }
    }

    // Log warning with evicted event details
    if (obsState.summary.evicted === 1 || obsState.summary.evicted % 100 === 0) {
      logger.warn('Observability buffer full, evicting lowest priority events', {
        evicted: obsState.summary.evicted,
        bufferSize: buffer.length,
        correlationId: context.correlationId,
        evictedEvent: evictedInfo,
      });
    } else if (evictedInfo) {
      // Log each eviction at debug level for troubleshooting
      logger.debug('Evicted observability event from buffer', {
        ...evictedInfo,
        totalEvicted: obsState.summary.evicted,
      });
    }
  }

  buffer.push(event);
  obsState.summary.buffered++;
  return 'buffered';
}

/**
 * Handle tail-based sampling logic for an event (async version)
 */
async function handleTailBasedSamplingAsync(
  event: ObservabilityEvent,
  context: ReturnType<typeof getCurrentContext>
): Promise<'captured' | 'buffered' | 'skip'> {
  const cfg = config;
  if (!cfg) return 'skip';
  const shouldBufferForPolicy = cfg.noiseReduction.enabled;
  const shouldBufferForSampling = !!cfg.sampling?.smart;
  if ((!shouldBufferForSampling && !shouldBufferForPolicy) || !context) {
    return 'skip';
  }

  const isError = stringToLevel(event.level) >= ObservabilityLevel.ERROR;

  // ERROR PATH: Flush buffer + capture error + set flag
  if (isError) {
    const obsState = context.observability;
    if (obsState.buffer.length > 0) {
      const buffer = obsState.buffer;
      obsState.buffer = [];

      const reduced = applyNoiseReduction(buffer, cfg.noiseReduction);
      const reducedBuffer = enforceHierarchyIntegrityOrDrop(reduced.events, context.correlationId);

      // Apply level filtering to avoid overwhelming backends
      const minLevelOnError = cfg.sampling?.minLevelOnError ?? ObservabilityLevel.INFO;
      let dropped = 0;

      const filteredEvents = reducedBuffer.filter(bufferedEvent => {
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

    obsState.errorOccurred = true;
    const targetBackends = getBackendsForType(event.type);
    await dispatchToBackendsSync(event, targetBackends);
    obsState.summary.captured++;

    return 'captured';
  }

  // POST-ERROR PATH: Capture immediately
  if (context.observability.errorOccurred) {
    const targetBackends = getBackendsForType(event.type);
    await dispatchToBackendsSync(event, targetBackends);
    context.observability.summary.captured++;

    return 'captured';
  }

  // NORMAL PATH: Buffer everything
  const obsState = context.observability;
  const buffer = obsState.buffer;

  // Buffer size management: evict lowest priority if full
  const maxSize = cfg.sampling?.maxBufferSize ?? 1000;
  if (buffer.length >= maxSize) {
    const evictedInfo = evictLowestPriority(buffer, { allowEvictSpans: false });
    if (evictedInfo) {
      obsState.summary.evicted++;
    } else {
      const hardCap = maxSize * 2;
      if (buffer.length >= hardCap) {
        const evictedSpanInfo = evictLowestPriority(buffer, { allowEvictSpans: true });
        if (evictedSpanInfo) {
          obsState.summary.evicted++;
        }
      }
    }

    // Log warning if evicting a lot
    if (obsState.summary.evicted === 1 || obsState.summary.evicted % 100 === 0) {
      logger.warn('Observability buffer full, evicting lowest priority events', {
        evicted: obsState.summary.evicted,
        bufferSize: buffer.length,
        correlationId: context.correlationId
      });
    }
  }

  buffer.push(event);
  obsState.summary.buffered++;
  return 'buffered';
}

/**
 * Initialize source-map-support if enabled in config
 * Provides better stack traces for TypeScript/transpiled code in production
 */
function initializeSourceMapSupport(cfg: ObservabilityConfig): void {
  if (!cfg.sourceMap.enabled) {
    logger.debug('Source map support disabled in config');
    return;
  }

  try {
    logger.debug('Attempting to load source-map-support...');
    // Dynamic import to avoid bundling if not needed
    require('source-map-support/register');
    logger.info('Source map support enabled - stack traces will show original TypeScript lines');
  } catch (error: unknown) {
    // Not a critical error - observability still works without source maps
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'MODULE_NOT_FOUND') {
      logger.warn(
        'source-map-support package not found. Install it for better error stack traces: npm install source-map-support'
      );
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to load source-map-support:', msg);
    }
  }
}

/**
 * Initialize backends from DI based on config
 */
function initializeBackendsFromConfig(cfg: ObservabilityConfig): void {
  backends = [];
  backendConfigs.clear();
  const enabledBackends = cfg.backends.filter(b => b.enabled !== false);

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

  if (backends.length === 0) {
    // Soft-fail: do NOT throw and break application flow.
    // Without backends, capture becomes a no-op for this invocation (events are dropped).
    logger.error('Observability misconfigured: no enabled/available backends were resolved from DI. Observability will be disabled for this invocation.', {
      enabledBackendTypes: enabledBackends.map(b => b.type),
    });
  }
}

function doInitialize(): void {
  try {
    logger.debug('=== OBSERVABILITY INITIALIZATION START ===');

    // Run pre-initialization hooks (e.g., schema registration)
    if (preInitHooks.length > 0) {
      logger.debug(`Running ${preInitHooks.length} pre-initialization hook(s)...`);
      for (const hook of preInitHooks) {
        try {
          hook();
        } catch (error) {
          logger.error('Pre-initialization hook failed:', error);
          throw error;
        }
      }
      logger.debug('Pre-initialization hooks completed');
    }

    // Resolve config input from DI, then normalize into a fully-defined ObservabilityConfig.
    // This avoids unsafe casts and ensures the shape is consistent even when apps override partially.
    const input = DIContainer.ROOT.resolveConfig<ObservabilityConfigInput>('observability');
    config = createObservabilityConfig(input);
    setCurrentObservabilityConfig(config);
    logger.debug('Observability config loaded from DI', {
      enabled: config.enabled,
      serviceName: config.serviceName,
      backends: config.backends?.map(b => b.type),
      sampling: { enabled: config.sampling?.enabled, smart: config.sampling?.smart },
      sourceMap: config.sourceMap?.enabled,
    });

    // Initialize source-map-support for better stack traces (if enabled)
    initializeSourceMapSupport(config);

    // Initialize backends from DI
    initializeBackendsFromConfig(config!);

    // Register capturer for observers
    initializeCapturer({
      capture: (input) => ObservabilityManager.capture(input),
      captureAsync: (input) => ObservabilityManager.captureAsync(input),
    });

    initialized = true;
    logger.info('=== OBSERVABILITY INITIALIZATION COMPLETE ===');
  } catch (error) {
    logger.error('!!! OBSERVABILITY INITIALIZATION FAILED !!!', error);
    // Soft-fail: do NOT throw into application flow.
    // Mark initialized to prevent repeated init attempts; leave capturer uninitialized so observers drop events.
    initialized = true;
    config = null;
    setCurrentObservabilityConfig(null);
    backends = [];
    backendConfigs.clear();
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

  /**
   * Get observability summary for the current invocation.
   * Returns buffer stats: evicted, buffered, captured, sampledOut counts.
   * Returns undefined if no execution context exists.
   */
  static getSummary(): ObservabilitySummary | undefined {
    const context = getCurrentContext();
    return context?.observability.summary;
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
   * Register a pre-initialization hook.
   * Hooks run BEFORE backends are initialized, allowing schema/service registration
   * needed by backends without circular dependencies.
   * 
   * @param hook - Callback to execute during initialization
   */
  static registerPreInitHook(hook: () => void): void {
    preInitHooks.push(hook);
  }

  /**
   * Capture an observability event (fire-and-forget)
   * 
   * Capture control is embedded in input.capture - no separate options param.
   * 
   * @param input - Event input with capture control in input.capture
   * @returns observabilityLogId if captured, undefined if filtered/sampled out
   */
  static capture(input: CaptureInput): string | undefined {
    if (!initialized) {
      logger.warn('❌ Observability not initialized, skipping capture', { type: input.type, level: input.level });
      return undefined;
    }

    try {
      // Hard deprecation: FW24 does not support legacy span.* record formats.
      // If anything emits these, it's a bug. Log loudly and drop.
      if (input.type === 'span.end' || input.type === 'span.event') {
        logger.error('Observability invariant violation: legacy span.* event type was emitted (unsupported). Dropping event.', {
          type: input.type,
          operation: input.operation,
          correlationId: input.correlationId,
          parentObservabilityLogId: input.parentObservabilityLogId,
          source: input.source,
        });
        return undefined;
      }

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
      const event = buildEvent(input, context);

      // Try tail-based sampling first
      const tailResult = handleTailBasedSamplingSync(event, context);
      if (tailResult === 'captured') {
        return event.observabilityLogId;
      }
      if (tailResult === 'buffered') {
        return undefined;
      }

      // HEAD-BASED SAMPLING (all bypass/level/sampling logic in shouldCapture)
      if (!shouldCapture(event, config, {
        // No buffered graph here; never drop spans by minDuration in head-based mode
        // because we can't prove they aren't parents of already-emitted child events.
        allowSpanMinDurationDrop: false,
      })) {
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
   * 
   * @param input - Event input with capture control in input.capture
   * @returns Promise<observabilityLogId> if captured, undefined if filtered/sampled out
   */
  static async captureAsync(input: CaptureInput): Promise<string | undefined> {
    if (!initialized) {
      logger.debug('Observability not initialized, skipping capture');
      return undefined;
    }

    try {
      // Hard deprecation: FW24 does not support legacy span.* record formats.
      // If anything emits these, it's a bug. Log loudly and drop.
      if (input.type === 'span.end' || input.type === 'span.event') {
        logger.error('Observability invariant violation: legacy span.* event type was emitted (unsupported). Dropping event.', {
          type: input.type,
          operation: input.operation,
          correlationId: input.correlationId,
          parentObservabilityLogId: input.parentObservabilityLogId,
          source: input.source,
        });
        return undefined;
      }

      const errors = validateInput(input);
      if (errors.length > 0) {
        logger.warn('Invalid capture input:', { errors, type: input.type });
        return undefined;
      }

      if (!config?.enabled) return undefined;

      const context = getCurrentContext();
      const event = buildEvent(input, context);

      // Try tail-based sampling first
      const tailResult = await handleTailBasedSamplingAsync(event, context);
      if (tailResult === 'captured') {
        return event.observabilityLogId;
      }
      if (tailResult === 'buffered') {
        return undefined;
      }

      // HEAD-BASED SAMPLING (all bypass/level/sampling logic in shouldCapture)
      if (!shouldCapture(event, config, {
        allowSpanMinDurationDrop: false,
      })) {
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
   * Observe an event (convenience method)
   * 
   * @param event - Partial event with required type and level
   * @returns observabilityLogId if captured, undefined if filtered/sampled out
   */
  static observe(
    event: Partial<ObservabilityEvent> & { type: string; level: string; correlationId?: string }
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
    });
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

    // Force-end any spans left open in this invocation before flushing buffered events.
    // This guarantees the hierarchy has all parents, even if user/framework code forgot to end a span.
    runSpanFinalizer();

    // Attach observability summary to current span (if any) before flushing
    const summary = ObservabilityManager.getSummary();
    const context = getCurrentContext();
    const currentSpan = context?.observability.currentSpan;
    if (summary && currentSpan && (summary.captured > 0 || summary.buffered > 0 || summary.evicted > 0 || summary.sampledOut > 0)) {
      currentSpan?.metrics?.({
        '_fw24.obs.captured': summary.captured,
        '_fw24.obs.buffered': summary.buffered,
        '_fw24.obs.evicted': summary.evicted,
        '_fw24.obs.sampledOut': summary.sampledOut,
      });
    }

    // If buffering is enabled (smart sampling OR noise reduction), flush buffered events.
    if (config?.sampling?.smart || config?.noiseReduction?.enabled) {
      const context = getCurrentContext();

      if (context && context.observability.buffer.length > 0 && !context.observability.errorOccurred) {
        // No error occurred: apply noise reduction + optional sampling to buffer before flushing
        const obsState = context.observability;
        const buffer = obsState.buffer;
        obsState.buffer = []; // Clear buffer

        const reduced = applyNoiseReduction(buffer, config.noiseReduction);
        const reducedEvents = reduced.events;

        // Compute referenced parent IDs from the buffered set (graph-based, no manual tracking).
        const referencedParentSpanIds = new Set<string>();
        for (const e of reducedEvents) {
          const pid = e.parentObservabilityLogId ?? undefined;
          if (pid) referencedParentSpanIds.add(pid);
        }

        // Drop empty *leaf* spans if configured.
        // A span is a leaf iff nobody references it as parentObservabilityLogId in this buffered set.
        const maybeDropEmptyLeafSpans = config.spans.skipEmpty
          ? reducedEvents.filter((e) => {
            if (e.type !== 'span') return true;
            const id = e.observabilityLogId;
            if (!id) return true;
            if (referencedParentSpanIds.has(id)) return true; // parent => keep
            const d = e.data as Record<string, unknown> | undefined;
            const fw = d?._fw24 as Record<string, unknown> | undefined;
            return fw?.spanEmpty !== true;
          })
          : reducedEvents;

        const finalEvents = enforceHierarchyIntegrityOrDrop(maybeDropEmptyLeafSpans, context.correlationId);

        for (const event of finalEvents) {
          // Bypass events skip sampling (e.g., audit events marked as critical)
          const shouldBypass = event.capture?.bypass === true;

          // Apply sampling rules to buffered event (unless bypass is set)
          const isSampled = shouldBypass
            || !config?.sampling?.enabled
            || shouldCapture(event, config, {
              allowSpanMinDurationDrop: true,
              referencedParentSpanIds,
            });
          if (isSampled) {
            const targets = getBackendsForType(event.type);
            await dispatchToBackendsSync(event, targets);
          } else {
            obsState.summary.sampledOut++;
          }
        }
      }
      // If errorOccurred=true, buffer was already flushed during capture
    }

    // Flush all backends with retry logic
    // Wrap each backend flush in try-catch to ensure all backends attempt to flush
    // even if one fails catastrophically
    const MAX_FLUSH_RETRIES = 2;
    const flushPromises = backends.map(async (backend) => {
      try {
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
              // Don't throw - allow other backends to flush
            } else {
              logger.warn(`Backend ${backend.name} flush failed (attempt ${attempt}/${MAX_FLUSH_RETRIES}), retrying...`, error);
              // Simple exponential backoff
              await new Promise(resolve => setTimeout(resolve, 100 * attempt));
            }
          }
        }
      } catch (error) {
        // Catch any unexpected errors outside the retry loop
        logger.error(`Backend ${backend.name} flush completely failed:`, error);
        // Don't throw - allow other backends to flush
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
    setCurrentObservabilityConfig(null);
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
    setCurrentObservabilityConfig(testConfig);
    backends = testBackends;
    initialized = true;

    initializeCapturer({
      capture: (input) => ObservabilityManager.capture(input),
      captureAsync: (input) => ObservabilityManager.captureAsync(input),
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
