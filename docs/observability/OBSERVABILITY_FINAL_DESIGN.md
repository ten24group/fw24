# FW24 Observer System: Comprehensive Design Document

**Version**: 2.0  
**Date**: November 2025  
**Status**: Final Design  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Design Principles](#3-design-principles)
4. [Architecture Overview](#4-architecture-overview)
5. [Core Observer System](#5-core-observer-system)
6. [Specialized Observers](#6-specialized-observers)
7. [Storage Layer](#7-storage-layer)
8. [Backend System](#8-backend-system)
9. [Query & Analysis](#9-query--analysis)
10. [Context & Correlation](#10-context--correlation)
11. [Migration Plan](#11-migration-plan)
12. [Implementation Phases](#12-implementation-phases)

---

## 1. Executive Summary

### 1.1 Goals

Design a unified observability system that:

1. **Uses existing FW24 infrastructure** - Actor, EntityService, EntityQuery, etc.
2. **Provides specialized observers** - SpanObserver, AuditObserver, WorkflowObserver, etc.
3. **No redundant types** - Reuse Actor from ExecutionContext, not create new ones
4. **Extensible foundation** - Applications can build complex features on top
5. **Production-ready** - Lambda optimized, cost-aware, battle-tested patterns

### 1.2 Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│ Application Layer (User Code)                               │
│ - Complex workflows, sagas, feature flags, analytics       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Specialized Observers (Framework)                           │
│ - SpanObserver      - WorkflowObserver                     │
│ - AuditObserver     - AccessLogObserver                    │
│ - MetricObserver    - DecisionObserver                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Core Observer (Foundation)                                  │
│ - observe(event)    - flush()                              │
│ - initializeInvocation()                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Backend Layer (Storage/Export)                              │
│ - DynamoDB (via BaseEntityService)                         │
│ - CloudWatch (Powertools Logger/Metrics)                   │
│ - OTEL/X-Ray (AWS ADOT Layer)                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Current State Analysis

### 2.1 Existing FW24 Infrastructure to Reuse

#### Actor Type (from `core/types/execution-context.ts`)
```typescript
// REUSE THIS - DO NOT CREATE NEW ACTOR TYPE
export interface Actor {
  actorId?: string;
  actorType?: 'user' | 'service' | 'anonymous';
  authMethod?: 'cognito' | 'iam' | 'api-key' | 'anonymous' | 'system';
  requestId: string;
  timestamp: string;
  sourceIp?: string;
  userAgent?: string;
  correlationId?: string;
  email?: string;
  cognito?: { sub?: string; username?: string; groups?: string[]; customAttributes?: Record<string, any> };
  apiKey?: { id?: string; source?: 'request-context' | 'header' };
  iam?: { userArn?: string; userId?: string; accountId?: string; caller?: string };
  sessionId?: string;
  tenantId?: string;
  apiStage?: string;
  apiId?: string;
  rawAuthContext?: any;
  [key: string]: any;
}
```

#### BaseEntityService (from `entity/base-service.ts`)
- `get()`, `create()`, `update()`, `delete()`, `list()`, `query()`, `batchGet()`, `batchDelete()`
- Full query support with filters, pagination, search
- Hydration support for relationships

#### EntityQuery (from `entity/query-types.ts`)
```typescript
// REUSE THIS FOR QUERIES
export type EntityQuery<E> = {
  attributes?: EntitySelections<E>;
  filters?: EntityFilterCriteria<E>;
  search?: string | Array<string>;
  searchAttributes?: Array<string>;
  pagination?: Pagination;
  index?: { name: string; filters?: Record<string, any> };
}
```

#### Existing Audit System (from `audit/`)
- `AuditEntry` - comprehensive log structure
- `DynamoDBAuditEntitySchema` - ElectroDB schema with indexes
- `IAuditLogger` - backend interface
- `captureLog()` - helper function

### 2.2 Current Observability Implementation

**Files to Keep (with modifications):**
- `types.ts` - Core types (ObservabilityEvent, Level, etc.)
- `manager.ts` - Core Observer (rename to `observer.ts`)
- `span.ts` - Span API
- `workflow.ts` - WorkflowRun API
- `storage/log-entity.ts` - Entity schema
- `backends/*.ts` - Backend implementations

**Files to Refactor:**
- `query-service.ts` - Replace with EntityService-based queries
- `crud-hooks.ts` - Integrate with AuditObserver

**What Works Well (Keep):**
✅ Entity schema with 6 GSIs  
✅ Fire-and-forget capture  
✅ Type-specific backend routing  
✅ Lambda lifecycle management  
✅ Source and tags auto-injection  

**What Needs Fixing:**
❌ Custom Actor type instead of reusing existing  
❌ Custom query service instead of using EntityService  
❌ Audit system duplication (audit/ vs observability/crud-hooks.ts)  

---

## 3. Design Principles

### 3.1 Use What Exists

```typescript
// ❌ BAD - Creating redundant types
interface ObservabilityActor {
  userId?: string;
  role?: string;
  // ... duplicating Actor
}

// ✅ GOOD - Import from existing
import { Actor } from '../core/types/execution-context';
```

### 3.2 Specialized Observers

Instead of one monolithic `ObservabilityManager.capture()`, provide specialized observers:

```typescript
// ❌ BAD - Generic, unclear
ObservabilityManager.capture({ type: 'audit', subType: 'entity.create', ... });

// ✅ GOOD - Clear, type-safe, specialized
AuditObserver.entityCreate(entityName, entityId, data, ctx);
SpanObserver.start('operation', options);
MetricObserver.record('metric.name', value, tags);
WorkflowObserver.step(workflowId, stepName, data);
DecisionObserver.record(decisionName, context, result, reasoning);
AccessLogObserver.request(request, response, actor);
```

### 3.3 EntityService for Storage

```typescript
// ❌ BAD - Direct ElectroDB usage
const entity = ObservabilityLogEntity();
await entity.query.byTrace({ correlationId }).go();

// ✅ GOOD - Use BaseEntityService with EntityQuery
class ObservabilityLogService extends BaseEntityService<ObservabilityLogSchema> {
  async getByTrace(correlationId: string, query?: EntityQuery<Schema>) {
    return this.query({
      ...query,
      filters: { correlationId: { eq: correlationId } },
    });
  }
}
```

---

## 4. Architecture Overview

### 4.1 Module Structure

```
src/observability/
├── index.ts                     # Public exports
│
├── core/                        # Core Observer System
│   ├── observer.ts             # Core Observer class
│   ├── context.ts              # AsyncLocalStorage context
│   ├── config.ts               # Configuration management
│   └── types.ts                # Core types
│
├── observers/                   # Specialized Observers
│   ├── span.ts                 # SpanObserver
│   ├── audit.ts                # AuditObserver
│   ├── metric.ts               # MetricObserver
│   ├── workflow.ts             # WorkflowObserver
│   ├── decision.ts             # DecisionObserver
│   ├── access-log.ts           # AccessLogObserver
│   └── index.ts                # Observer registry
│
├── backends/                    # Backend Implementations
│   ├── base.ts                 # Base backend class
│   ├── cloudwatch.ts           # CloudWatch backend
│   ├── dynamodb.ts             # DynamoDB backend
│   ├── otel.ts                 # OTEL backend
│   └── index.ts                # Backend registry
│
├── storage/                     # Storage Layer
│   ├── schema.ts               # Entity schema
│   └── service.ts              # EntityService implementation
│
├── utils/                       # Utilities
│   ├── level-utils.ts          # Level mapping
│   ├── source-utils.ts         # Source detection
│   └── payload.ts              # Payload truncation
│
└── decorators/                  # Decorators
    ├── traced.ts               # @Traced decorator
    └── audited.ts              # @Audited decorator
```

### 4.2 Dependency Graph

```
                    ┌──────────────────┐
                    │   Application    │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  SpanObserver   │ │  AuditObserver  │ │ MetricObserver  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Core Observer  │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    DynamoDB     │ │   CloudWatch    │ │      OTEL       │
│    Backend      │ │    Backend      │ │    Backend      │
└────────┬────────┘ └─────────────────┘ └─────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  ObservabilityLogService            │
│  (extends BaseEntityService)        │
└─────────────────────────────────────┘
```

---

## 5. Core Observer System

### 5.1 Types (Updated)

```typescript
// src/observability/core/types.ts

import { Actor } from '../../core/types/execution-context';

export enum ObservabilityLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  CRITICAL = 5,
  OFF = 99,
}

// Extensible event types - base types + custom
export type BaseEventType =
  | 'span.start' | 'span.event' | 'span.end'
  | 'log'
  | 'metric'
  | 'audit' | 'audit.entity' | 'audit.access' | 'audit.compliance'
  | 'workflow.start' | 'workflow.step' | 'workflow.end'
  | 'decision' | 'decision.rule' | 'decision.algorithm'
  | 'access.request' | 'access.response';

// Allow custom types via string
export type ObservabilityEventType = BaseEventType | `custom.${string}`;

/**
 * Universal observation event
 * 
 * Uses existing Actor type from ExecutionContext
 */
export interface ObservabilityEvent {
  // === REQUIRED ===
  type: ObservabilityEventType;
  level: keyof typeof ObservabilityLevel | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
  correlationId: string;
  timestampMs: number;

  // === IDENTITY ===
  logId?: string;        // Auto-generated if not provided
  parentLogId?: string;  // For hierarchical relationships

  // === ENTITY CONTEXT ===
  entityName?: string;   // Entity being observed (user, order, span, workflow)
  entityId?: string;     // Specific instance ID

  // === OPERATION ===
  operation?: string;    // What action is being performed
  subType?: string;      // More specific classification
  status?: string;       // pending, completed, failed, etc.
  success?: boolean;     // Operation outcome

  // === TIMING ===
  durationMs?: number;

  // === ACTOR (uses existing Actor type!) ===
  actor?: Actor;         // WHO did this - REUSE from ExecutionContext

  // === METADATA ===
  source?: string;       // lambda:functionName, controller:Class.method
  tags?: Record<string, string>;  // High-cardinality metadata

  // === PAYLOADS ===
  data?: Record<string, any>;      // Main payload
  attributes?: Record<string, any>; // Additional attributes
  metadata?: Record<string, any>;   // System metadata
  metrics?: Record<string, number>; // Numeric metrics
  context?: Record<string, any>;    // Request/response context

  // === ERROR ===
  error?: {
    type: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Observation context for AsyncLocalStorage
 * Automatically injected into all observations
 */
export interface ObservationContext {
  correlationId: string;
  parentLogId?: string;
  actor?: Actor;        // REUSE Actor type
  tags?: Record<string, string>;
  source?: string;
  tenantId?: string;    // From Actor
  sessionId?: string;   // From Actor
}
```

### 5.2 Core Observer Class

```typescript
// src/observability/core/observer.ts

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'crypto';
import { createLogger } from '../../logging';
import { Actor } from '../../core/types/execution-context';
import { 
  ObservabilityEvent, 
  ObservabilityLevel, 
  ObservationContext 
} from './types';
import { ObserverConfig, ConfigManager } from './config';
import { ObservabilityBackend } from '../backends/base';
import { detectSource, mergeTags } from '../utils/source-utils';
import { stringToLevel } from '../utils/level-utils';

const logger = createLogger('Observer');

/**
 * Core Observer - Foundation for all observability
 * 
 * Responsibilities:
 * - Context management (AsyncLocalStorage)
 * - Event enrichment (source, tags, timestamps)
 * - Sampling decisions
 * - Backend routing
 * - Lambda lifecycle (init, flush)
 * 
 * Usage:
 * ```typescript
 * // Direct usage (low-level)
 * Observer.observe({ type: 'log', level: 'info', ... });
 * 
 * // Via specialized observers (recommended)
 * SpanObserver.start('operation', options);
 * AuditObserver.entityCreate('user', userId, data, ctx);
 * ```
 */
export class Observer {
  // AsyncLocalStorage for automatic context propagation
  private static storage = new AsyncLocalStorage<ObservationContext>();
  
  // Configuration
  private static config: ConfigManager | null = null;
  
  // Registered backends
  private static backends: ObservabilityBackend[] = [];
  
  // Invocation counter (for cold start detection)
  private static invocationCount = 0;

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize Observer with configuration
   */
  static initialize(config: Partial<ObserverConfig>, backends?: ObservabilityBackend[]): void {
    this.config = new ConfigManager(config);
    if (backends) {
      this.backends = backends;
    }
    logger.info('Observer initialized', { 
      enabled: this.config.get('enabled'),
      backends: this.backends.map(b => b.name),
    });
  }

  /**
   * Lazy initialization from environment
   */
  private static ensureInitialized(): void {
    if (this.config) return;
    
    // Parse from environment variables
    const config = ConfigManager.fromEnvironment();
    this.config = new ConfigManager(config);
    
    // Initialize backends from environment
    this.initializeBackendsFromEnv();
  }

  private static async initializeBackendsFromEnv(): Promise<void> {
    const backendNames = (process.env.OBSERVABILITY_BACKENDS ?? 'cloudwatch')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean);

    for (const name of backendNames) {
      await this.registerBackendByName(name);
    }

    if (this.backends.length === 0) {
      await this.registerBackendByName('cloudwatch');
    }
  }

  private static async registerBackendByName(name: string): Promise<void> {
    const minLevel = this.config?.get('minLevel') ?? ObservabilityLevel.INFO;
    
    switch (name) {
      case 'dynamodb': {
        const { DynamoDBObservabilityBackend } = await import('../backends/dynamodb');
        this.backends.push(new DynamoDBObservabilityBackend({ minLevel }));
        break;
      }
      case 'cloudwatch': {
        const { CloudWatchBackend } = await import('../backends/cloudwatch');
        this.backends.push(new CloudWatchBackend({ 
          serviceName: process.env.SERVICE_NAME || 'fw24-service',
          minLevel,
        }));
        break;
      }
      case 'otel': {
        const { OTELObservabilityBackend } = await import('../backends/otel');
        this.backends.push(new OTELObservabilityBackend({
          serviceName: process.env.SERVICE_NAME || 'fw24-service',
          minLevel,
        }));
        break;
      }
      default:
        logger.warn(`Unknown backend: ${name}`);
    }
  }

  // ============================================
  // CORE OBSERVATION METHOD
  // ============================================

  /**
   * Record an observation event
   * 
   * This is the low-level method. Prefer specialized observers:
   * - SpanObserver.start()
   * - AuditObserver.entityCreate()
   * - MetricObserver.record()
   * 
   * @param event - Partial event (missing fields auto-filled)
   * @param options - Capture options
   */
  static observe(event: Partial<ObservabilityEvent>, options?: {
    critical?: boolean;  // Bypass sampling
    sync?: boolean;      // Wait for backends
  }): string | undefined {
    this.ensureInitialized();
    
    if (!this.config?.get('enabled')) {
      return undefined;
    }

    // Validate required fields
    if (!event.type) {
      logger.warn('Event missing required field: type');
      return undefined;
    }

    // Enrich event
    const enriched = this.enrichEvent(event);
    
    // Check if should capture (sampling, level)
    if (!options?.critical && !this.shouldCapture(enriched)) {
      return undefined;
    }

    // Route to backends
    const backends = this.getBackendsForType(enriched.type);
    
    const capturePromise = Promise.all(
      backends.map(async (backend) => {
        try {
          const levelValue = stringToLevel(enriched.level);
          if (backend.minLevel !== undefined && levelValue < backend.minLevel) {
            return;
          }
          await backend.capture(enriched);
        } catch (error) {
          logger.error(`Backend ${backend.name} capture failed`, error);
        }
      })
    );

    if (options?.sync) {
      // Synchronous - wait for backends
      void capturePromise;
    } else {
      // Fire-and-forget
      void capturePromise;
    }

    return enriched.logId;
  }

  /**
   * Enrich event with context, defaults, source, tags
   */
  private static enrichEvent(event: Partial<ObservabilityEvent>): ObservabilityEvent {
    const context = this.storage.getStore();
    const now = Date.now();

    return {
      // Defaults
      logId: randomUUID(),
      timestampMs: now,
      level: 'info',
      
      // Context injection
      correlationId: context?.correlationId ?? randomUUID(),
      parentLogId: event.parentLogId ?? context?.parentLogId,
      actor: event.actor ?? context?.actor,
      
      // Source detection
      source: event.source ?? context?.source ?? detectSource(),
      
      // Tag merging
      tags: mergeTags(event.tags, context?.tags),
      
      // User-provided values (override defaults)
      ...event,
      type: event.type!, // Required, validated above
    } as ObservabilityEvent;
  }

  /**
   * Determine if event should be captured based on level and sampling
   */
  private static shouldCapture(event: ObservabilityEvent): boolean {
    const config = this.config!;
    const levelValue = stringToLevel(event.level);

    // Level filter
    if (levelValue < config.get('minLevel')) {
      return false;
    }

    // Critical always captured
    if (levelValue >= ObservabilityLevel.CRITICAL) {
      return true;
    }

    // Sampling
    const sampling = config.get('sampling');
    if (!sampling?.enabled) {
      return true;
    }

    // Operation-specific sampling
    if (event.operation && sampling.operations) {
      for (const [pattern, rate] of Object.entries(sampling.operations)) {
        if (new RegExp(`^${pattern.replace(/\*/g, '.*')}$`).test(event.operation)) {
          return Math.random() < rate;
        }
      }
    }

    // Level-based sampling
    const rate = sampling.rates?.[levelValue] ?? 1.0;
    return Math.random() < rate;
  }

  /**
   * Get backends for specific event type
   */
  private static getBackendsForType(type: string): ObservabilityBackend[] {
    const typeCategory = this.getTypeCategory(type);
    const typeConfig = this.config?.get('types')?.[typeCategory];

    if (typeConfig?.backends) {
      return this.backends.filter(b => typeConfig.backends!.includes(b.name as any));
    }

    return this.backends;
  }

  private static getTypeCategory(type: string): string {
    if (type.startsWith('span.')) return 'span';
    if (type === 'metric') return 'metric';
    if (type.startsWith('audit')) return 'audit';
    if (type.startsWith('workflow.')) return 'workflow';
    if (type.startsWith('decision')) return 'decision';
    if (type.startsWith('access.')) return 'access';
    return 'log';
  }

  // ============================================
  // CONTEXT MANAGEMENT
  // ============================================

  /**
   * Create observation context
   */
  static createContext(options?: {
    correlationId?: string;
    parentLogId?: string;
    actor?: Actor;
    tags?: Record<string, string>;
    source?: string;
  }): ObservationContext {
    return {
      correlationId: options?.correlationId ?? randomUUID(),
      parentLogId: options?.parentLogId,
      actor: options?.actor,
      tags: options?.tags,
      source: options?.source,
      tenantId: options?.actor?.tenantId,
      sessionId: options?.actor?.sessionId,
    };
  }

  /**
   * Get current context from AsyncLocalStorage
   */
  static currentContext(): ObservationContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Run function with observation context
   * 
   * All observations within the function automatically inherit context
   */
  static async withContext<T>(
    context: ObservationContext,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.storage.run(context, fn);
  }

  /**
   * Set actor on current context (for mid-flow actor injection)
   */
  static setActor(actor: Actor): void {
    const current = this.storage.getStore();
    if (current) {
      current.actor = actor;
      current.tenantId = actor.tenantId;
      current.sessionId = actor.sessionId;
    }
  }

  // ============================================
  // LAMBDA LIFECYCLE
  // ============================================

  /**
   * Initialize Lambda invocation
   * 
   * Call at start of Lambda handler:
   * - Clears state from previous warm invocation
   * - Increments invocation counter
   * - Initializes backends
   */
  static initializeInvocation(): void {
    this.ensureInitialized();
    this.invocationCount++;
    
    this.backends.forEach(backend => {
      backend.initializeInvocation?.();
    });
  }

  /**
   * Flush all backends
   * 
   * Call before Lambda handler returns:
   * - Ensures all buffered events are written
   * - REQUIRED for DynamoDB backend batch writes
   */
  static async flush(): Promise<void> {
    await Promise.all(
      this.backends.map(async (backend) => {
        try {
          await backend.flush?.();
        } catch (error) {
          logger.error(`Backend ${backend.name} flush failed`, error);
        }
      })
    );
  }

  /**
   * Check if this is a cold start
   */
  static isColdStart(): boolean {
    return this.invocationCount === 1;
  }

  // ============================================
  // BACKEND MANAGEMENT
  // ============================================

  /**
   * Register a custom backend
   */
  static registerBackend(backend: ObservabilityBackend): void {
    if (!this.backends.find(b => b.name === backend.name)) {
      this.backends.push(backend);
    }
  }

  /**
   * Unregister a backend
   */
  static unregisterBackend(name: string): void {
    this.backends = this.backends.filter(b => b.name !== name);
  }

  // ============================================
  // CONFIGURATION
  // ============================================

  static configure(config: Partial<ObserverConfig>): void {
    this.ensureInitialized();
    this.config?.update(config);
  }

  static getConfig(): ObserverConfig {
    this.ensureInitialized();
    return this.config!.getAll();
  }
}

/**
 * Lambda handler wrapper with observability
 */
export const withObservability = <T extends (...args: any[]) => Promise<any>>(
  handler: T
): T => {
  return (async (...args: Parameters<T>) => {
    try {
      Observer.initializeInvocation();
      return await handler(...args);
    } finally {
      await Observer.flush();
    }
  }) as T;
};
```

---

## 6. Specialized Observers

### 6.1 SpanObserver

```typescript
// src/observability/observers/span.ts

import { randomUUID } from 'crypto';
import { Actor } from '../../core/types/execution-context';
import { Observer } from '../core/observer';
import { ObservabilityLevel } from '../core/types';

export interface SpanOptions {
  correlationId?: string;
  parentSpanId?: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  attributes?: Record<string, any>;
  source?: string;
  tags?: Record<string, string>;
  actor?: Actor;
}

/**
 * Span Observer - For distributed tracing
 * 
 * Usage:
 * ```typescript
 * // Create span manually
 * const span = SpanObserver.start('processOrder', { 
 *   tags: { orderId: '123' } 
 * });
 * try {
 *   // ... work
 *   span.end({ success: true });
 * } catch (error) {
 *   span.end({ success: false, error });
 * }
 * 
 * // Or use withSpan helper
 * await SpanObserver.withSpan('processOrder', async (span) => {
 *   span.addEvent('validation_complete');
 *   // ... more work
 * });
 * ```
 */
export class SpanObserver {
  private readonly spanId: string;
  private readonly correlationId: string;
  private readonly parentSpanId?: string;
  private readonly level: SpanOptions['level'];
  private readonly startTime: number;
  private readonly source?: string;
  private readonly tags?: Record<string, string>;
  private readonly actor?: Actor;
  private attributes: Record<string, any>;
  private operation: string;
  private ended = false;

  private constructor(operation: string, options: SpanOptions = {}) {
    this.operation = operation;
    this.spanId = randomUUID();
    this.correlationId = options.correlationId ?? Observer.currentContext()?.correlationId ?? randomUUID();
    this.parentSpanId = options.parentSpanId ?? Observer.currentContext()?.parentLogId;
    this.level = options.level ?? 'info';
    this.attributes = options.attributes ?? {};
    this.source = options.source;
    this.tags = options.tags;
    this.actor = options.actor;
    this.startTime = Date.now();

    // Emit span.start
    Observer.observe({
      type: 'span.start',
      level: this.level,
      correlationId: this.correlationId,
      parentLogId: this.parentSpanId,
      entityName: 'span',
      entityId: this.spanId,
      timestampMs: this.startTime,
      operation: this.operation,
      attributes: this.attributes,
      source: this.source,
      tags: this.tags,
      actor: this.actor,
    });
  }

  /**
   * Start a new span
   */
  static start(operation: string, options?: SpanOptions): SpanObserver {
    return new SpanObserver(operation, options);
  }

  /**
   * Execute function within a span
   */
  static async withSpan<T>(
    operation: string,
    fn: (span: SpanObserver) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    const span = SpanObserver.start(operation, options);
    try {
      const result = await fn(span);
      span.end({ success: true });
      return result;
    } catch (error) {
      span.end({ success: false, error: error as Error });
      throw error;
    }
  }

  // Instance methods
  get id(): string { return this.spanId; }
  get traceId(): string { return this.correlationId; }

  setAttribute(key: string, value: any): this {
    this.attributes[key] = value;
    return this;
  }

  addEvent(name: string, eventAttributes?: Record<string, any>): this {
    Observer.observe({
      type: 'span.event',
      level: this.level,
      correlationId: this.correlationId,
      parentLogId: this.spanId,
      entityName: 'span',
      entityId: this.spanId,
      timestampMs: Date.now(),
      operation: name,
      attributes: eventAttributes,
      source: this.source,
      tags: this.tags,
    });
    return this;
  }

  end(options?: { success?: boolean; error?: Error }): void {
    if (this.ended) return;
    this.ended = true;

    const endTime = Date.now();
    const duration = endTime - this.startTime;

    Observer.observe({
      type: 'span.end',
      level: options?.error ? 'error' : this.level,
      correlationId: this.correlationId,
      parentLogId: this.parentSpanId,
      entityName: 'span',
      entityId: this.spanId,
      timestampMs: endTime,
      durationMs: duration,
      operation: this.operation,
      success: options?.success ?? !options?.error,
      status: options?.error ? 'failed' : 'completed',
      attributes: this.attributes,
      source: this.source,
      tags: this.tags,
      actor: this.actor,
      error: options?.error ? {
        type: options.error.name,
        message: options.error.message,
        stack: options.error.stack,
      } : undefined,
      metrics: { duration },
    });
  }

  /**
   * Create child span
   */
  async withChild<T>(
    operation: string,
    fn: (span: SpanObserver) => Promise<T>,
    options?: Omit<SpanOptions, 'correlationId' | 'parentSpanId'>
  ): Promise<T> {
    return SpanObserver.withSpan(operation, fn, {
      ...options,
      correlationId: this.correlationId,
      parentSpanId: this.spanId,
      source: options?.source ?? this.source,
      tags: { ...this.tags, ...options?.tags },
      actor: options?.actor ?? this.actor,
    });
  }
}
```

### 6.2 AuditObserver

```typescript
// src/observability/observers/audit.ts

import { randomUUID } from 'crypto';
import { Actor } from '../../core/types/execution-context';
import { ExecutionContext } from '../../core/types/execution-context';
import { Observer } from '../core/observer';

export interface AuditOptions {
  correlationId?: string;
  actor?: Actor;
  source?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Audit Observer - For entity and action auditing
 * 
 * Usage:
 * ```typescript
 * // Entity operations
 * AuditObserver.entityCreate('User', userId, userData, ctx);
 * AuditObserver.entityUpdate('User', userId, { before, after }, ctx);
 * AuditObserver.entityDelete('User', userId, ctx);
 * 
 * // Custom audits
 * AuditObserver.record({
 *   operation: 'permission.granted',
 *   entityName: 'User',
 *   entityId: userId,
 *   data: { role: 'admin' },
 *   actor: ctx.actor,
 * });
 * ```
 */
export class AuditObserver {
  /**
   * Record entity creation
   */
  static entityCreate(
    entityName: string,
    entityId: string,
    data: any,
    ctx?: ExecutionContext | AuditOptions
  ): string | undefined {
    const options = this.extractOptions(ctx);
    
    return Observer.observe({
      type: 'audit.entity',
      subType: 'create',
      level: 'info',
      correlationId: options.correlationId ?? Observer.currentContext()?.correlationId,
      operation: `${entityName}.create`,
      entityName,
      entityId,
      data: { created: data },
      actor: options.actor,
      source: options.source,
      tags: { ...options.tags, audit: 'true', entityOperation: 'create' },
      metadata: options.metadata,
      timestampMs: Date.now(),
    }, { critical: true }); // Audits are always captured
  }

  /**
   * Record entity update
   */
  static entityUpdate(
    entityName: string,
    entityId: string,
    changes: { before?: any; after?: any; diff?: any },
    ctx?: ExecutionContext | AuditOptions
  ): string | undefined {
    const options = this.extractOptions(ctx);
    
    return Observer.observe({
      type: 'audit.entity',
      subType: 'update',
      level: 'info',
      correlationId: options.correlationId ?? Observer.currentContext()?.correlationId,
      operation: `${entityName}.update`,
      entityName,
      entityId,
      data: changes,
      actor: options.actor,
      source: options.source,
      tags: { ...options.tags, audit: 'true', entityOperation: 'update' },
      metadata: options.metadata,
      timestampMs: Date.now(),
    }, { critical: true });
  }

  /**
   * Record entity deletion
   */
  static entityDelete(
    entityName: string,
    entityId: string,
    ctx?: ExecutionContext | AuditOptions,
    deletedData?: any
  ): string | undefined {
    const options = this.extractOptions(ctx);
    
    return Observer.observe({
      type: 'audit.entity',
      subType: 'delete',
      level: 'warn', // Deletions are notable
      correlationId: options.correlationId ?? Observer.currentContext()?.correlationId,
      operation: `${entityName}.delete`,
      entityName,
      entityId,
      data: deletedData ? { deleted: deletedData } : undefined,
      actor: options.actor,
      source: options.source,
      tags: { ...options.tags, audit: 'true', entityOperation: 'delete' },
      metadata: options.metadata,
      timestampMs: Date.now(),
    }, { critical: true });
  }

  /**
   * Record entity read (optional - high volume)
   */
  static entityRead(
    entityName: string,
    entityId: string,
    ctx?: ExecutionContext | AuditOptions
  ): string | undefined {
    const options = this.extractOptions(ctx);
    
    return Observer.observe({
      type: 'audit.entity',
      subType: 'read',
      level: 'debug', // Lower level - high volume
      correlationId: options.correlationId ?? Observer.currentContext()?.correlationId,
      operation: `${entityName}.read`,
      entityName,
      entityId,
      actor: options.actor,
      source: options.source,
      tags: { ...options.tags, audit: 'true', entityOperation: 'read' },
      timestampMs: Date.now(),
    }); // Not critical - can be sampled
  }

  /**
   * Record custom audit event
   */
  static record(options: {
    operation: string;
    entityName?: string;
    entityId?: string;
    subType?: string;
    data?: any;
    actor?: Actor;
    source?: string;
    tags?: Record<string, string>;
    metadata?: Record<string, any>;
    correlationId?: string;
    level?: 'info' | 'warn' | 'error';
  }): string | undefined {
    return Observer.observe({
      type: 'audit',
      subType: options.subType,
      level: options.level ?? 'info',
      correlationId: options.correlationId ?? Observer.currentContext()?.correlationId,
      operation: options.operation,
      entityName: options.entityName,
      entityId: options.entityId,
      data: options.data,
      actor: options.actor,
      source: options.source,
      tags: { ...options.tags, audit: 'true' },
      metadata: options.metadata,
      timestampMs: Date.now(),
    }, { critical: true });
  }

  /**
   * Record compliance audit (PII access, data export, etc.)
   */
  static compliance(options: {
    operation: string;
    subType: 'pii_access' | 'data_export' | 'consent_change' | 'data_deletion' | string;
    entityName?: string;
    entityId?: string;
    data?: any;
    actor?: Actor;
    tags?: Record<string, string>;
    metadata?: {
      reason?: string;
      justification?: string;
      affectedFields?: string[];
      [key: string]: any;
    };
  }): string | undefined {
    return Observer.observe({
      type: 'audit.compliance',
      subType: options.subType,
      level: 'info',
      correlationId: Observer.currentContext()?.correlationId,
      operation: options.operation,
      entityName: options.entityName,
      entityId: options.entityId,
      data: options.data,
      actor: options.actor,
      tags: { ...options.tags, audit: 'true', compliance: 'true' },
      metadata: options.metadata,
      timestampMs: Date.now(),
    }, { critical: true, sync: true }); // Compliance always sync
  }

  private static extractOptions(ctx?: ExecutionContext | AuditOptions): AuditOptions {
    if (!ctx) return {};
    
    // Check if it's ExecutionContext
    if ('event' in ctx && 'lambdaContext' in ctx) {
      return {
        correlationId: ctx.actor?.correlationId,
        actor: ctx.actor,
      };
    }
    
    // It's AuditOptions
    return ctx as AuditOptions;
  }
}
```

### 6.3 MetricObserver

```typescript
// src/observability/observers/metric.ts

import { Observer } from '../core/observer';

/**
 * Metric Observer - For business and technical metrics
 * 
 * Usage:
 * ```typescript
 * // Simple counter
 * MetricObserver.increment('orders.created');
 * 
 * // Counter with value
 * MetricObserver.increment('orders.items', 5);
 * 
 * // Gauge value
 * MetricObserver.gauge('queue.depth', 42);
 * 
 * // Timing
 * MetricObserver.timing('api.latency', 145);
 * 
 * // Custom with tags
 * MetricObserver.record('payment.amount', 99.99, {
 *   tags: { currency: 'USD', method: 'card' },
 *   unit: 'dollars',
 * });
 * ```
 */
export class MetricObserver {
  /**
   * Increment counter
   */
  static increment(
    name: string,
    value: number = 1,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, value, { ...options, type: 'counter' });
  }

  /**
   * Set gauge value
   */
  static gauge(
    name: string,
    value: number,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, value, { ...options, type: 'gauge' });
  }

  /**
   * Record timing (milliseconds)
   */
  static timing(
    name: string,
    durationMs: number,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, durationMs, { 
      ...options, 
      type: 'timing',
      unit: options?.unit ?? 'milliseconds',
    });
  }

  /**
   * Record custom metric
   */
  static record(
    name: string,
    value: number,
    options?: MetricOptions
  ): string | undefined {
    return Observer.observe({
      type: 'metric',
      subType: options?.type ?? 'custom',
      level: options?.level ?? 'info',
      correlationId: Observer.currentContext()?.correlationId,
      operation: name,
      metrics: { [name]: value },
      attributes: {
        unit: options?.unit,
        type: options?.type,
        ...options?.attributes,
      },
      tags: options?.tags,
      source: options?.source,
      entityName: options?.entityName,
      entityId: options?.entityId,
      timestampMs: Date.now(),
    });
  }

  /**
   * Record multiple metrics at once
   */
  static recordBatch(
    metrics: Record<string, number>,
    options?: MetricOptions
  ): string | undefined {
    return Observer.observe({
      type: 'metric',
      subType: 'batch',
      level: options?.level ?? 'info',
      correlationId: Observer.currentContext()?.correlationId,
      operation: 'metrics.batch',
      metrics,
      attributes: options?.attributes,
      tags: options?.tags,
      source: options?.source,
      timestampMs: Date.now(),
    });
  }
}

interface MetricOptions {
  type?: 'counter' | 'gauge' | 'timing' | 'histogram' | 'custom';
  unit?: string;
  level?: 'debug' | 'info' | 'warn';
  tags?: Record<string, string>;
  attributes?: Record<string, any>;
  source?: string;
  entityName?: string;
  entityId?: string;
}
```

### 6.4 WorkflowObserver

```typescript
// src/observability/observers/workflow.ts

import { randomUUID } from 'crypto';
import { Actor } from '../../core/types/execution-context';
import { Observer } from '../core/observer';

/**
 * Workflow Observer - For long-running and distributed workflows
 * 
 * Usage:
 * ```typescript
 * const workflow = WorkflowObserver.start('order-fulfillment', {
 *   entityName: 'Order',
 *   entityId: orderId,
 * });
 * 
 * await workflow.step('validate', async () => {
 *   // validation logic
 * });
 * 
 * await workflow.step('payment', async () => {
 *   // payment logic
 * });
 * 
 * workflow.complete({ result: 'fulfilled' });
 * ```
 */
export class WorkflowObserver {
  private readonly workflowId: string;
  private readonly correlationId: string;
  private readonly workflowName: string;
  private readonly startTime: number;
  private readonly entityName?: string;
  private readonly entityId?: string;
  private readonly actor?: Actor;
  private readonly tags?: Record<string, string>;
  private stepCount = 0;
  private status: 'running' | 'completed' | 'failed' | 'paused' = 'running';

  private constructor(workflowName: string, options?: WorkflowOptions) {
    this.workflowId = randomUUID();
    this.correlationId = options?.correlationId ?? Observer.currentContext()?.correlationId ?? randomUUID();
    this.workflowName = workflowName;
    this.entityName = options?.entityName;
    this.entityId = options?.entityId;
    this.actor = options?.actor;
    this.tags = options?.tags;
    this.startTime = Date.now();

    Observer.observe({
      type: 'workflow.start',
      level: 'info',
      correlationId: this.correlationId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: workflowName,
      data: {
        workflowName,
        targetEntityName: this.entityName,
        targetEntityId: this.entityId,
      },
      actor: this.actor,
      tags: { ...this.tags, workflow: workflowName },
      timestampMs: this.startTime,
    });
  }

  static start(workflowName: string, options?: WorkflowOptions): WorkflowObserver {
    return new WorkflowObserver(workflowName, options);
  }

  get id(): string { return this.workflowId; }
  get traceId(): string { return this.correlationId; }

  /**
   * Execute and record a workflow step
   */
  async step<T>(
    stepName: string,
    fn: () => Promise<T>,
    options?: StepOptions
  ): Promise<T> {
    this.stepCount++;
    const stepId = randomUUID();
    const stepStart = Date.now();

    Observer.observe({
      type: 'workflow.step',
      level: 'info',
      correlationId: this.correlationId,
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: stepName,
      status: 'started',
      data: {
        stepId,
        stepNumber: this.stepCount,
        input: options?.input,
      },
      tags: { ...this.tags, workflow: this.workflowName, step: stepName },
      timestampMs: stepStart,
    });

    try {
      const result = await fn();
      
      Observer.observe({
        type: 'workflow.step',
        level: 'info',
        correlationId: this.correlationId,
        parentLogId: this.workflowId,
        entityName: 'workflow',
        entityId: this.workflowId,
        operation: stepName,
        status: 'completed',
        success: true,
        durationMs: Date.now() - stepStart,
        data: {
          stepId,
          stepNumber: this.stepCount,
          output: options?.captureOutput ? result : undefined,
        },
        tags: { ...this.tags, workflow: this.workflowName, step: stepName },
        timestampMs: Date.now(),
      });

      return result;
    } catch (error) {
      Observer.observe({
        type: 'workflow.step',
        level: 'error',
        correlationId: this.correlationId,
        parentLogId: this.workflowId,
        entityName: 'workflow',
        entityId: this.workflowId,
        operation: stepName,
        status: 'failed',
        success: false,
        durationMs: Date.now() - stepStart,
        data: { stepId, stepNumber: this.stepCount },
        error: {
          type: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
        tags: { ...this.tags, workflow: this.workflowName, step: stepName },
        timestampMs: Date.now(),
      });

      if (!options?.continueOnError) {
        this.status = 'failed';
        throw error;
      }
      
      return undefined as T;
    }
  }

  /**
   * Record decision point in workflow
   */
  decision(
    decisionName: string,
    result: any,
    options?: { reasoning?: string; rules?: any[] }
  ): void {
    Observer.observe({
      type: 'workflow.step',
      subType: 'decision',
      level: 'info',
      correlationId: this.correlationId,
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: decisionName,
      status: 'completed',
      data: {
        decision: result,
        reasoning: options?.reasoning,
        rules: options?.rules,
      },
      tags: { ...this.tags, workflow: this.workflowName },
      timestampMs: Date.now(),
    });
  }

  /**
   * Pause workflow (e.g., waiting for external input)
   */
  pause(reason: string, resumeData?: any): void {
    this.status = 'paused';
    Observer.observe({
      type: 'workflow.step',
      subType: 'pause',
      level: 'info',
      correlationId: this.correlationId,
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: 'pause',
      status: 'paused',
      data: { reason, resumeData },
      tags: { ...this.tags, workflow: this.workflowName },
      timestampMs: Date.now(),
    });
  }

  /**
   * Complete workflow successfully
   */
  complete(options?: { result?: any; metadata?: any }): void {
    this.status = 'completed';
    const duration = Date.now() - this.startTime;

    Observer.observe({
      type: 'workflow.end',
      level: 'info',
      correlationId: this.correlationId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: this.workflowName,
      status: 'completed',
      success: true,
      durationMs: duration,
      data: {
        result: options?.result,
        stepCount: this.stepCount,
      },
      metadata: options?.metadata,
      actor: this.actor,
      tags: { ...this.tags, workflow: this.workflowName },
      metrics: { duration, stepCount: this.stepCount },
      timestampMs: Date.now(),
    });
  }

  /**
   * Mark workflow as failed
   */
  fail(error: Error, options?: { metadata?: any }): void {
    this.status = 'failed';
    const duration = Date.now() - this.startTime;

    Observer.observe({
      type: 'workflow.end',
      level: 'error',
      correlationId: this.correlationId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: this.workflowName,
      status: 'failed',
      success: false,
      durationMs: duration,
      data: { stepCount: this.stepCount },
      error: {
        type: error.name,
        message: error.message,
        stack: error.stack,
      },
      metadata: options?.metadata,
      actor: this.actor,
      tags: { ...this.tags, workflow: this.workflowName },
      metrics: { duration, stepCount: this.stepCount },
      timestampMs: Date.now(),
    });
  }
}

interface WorkflowOptions {
  correlationId?: string;
  entityName?: string;
  entityId?: string;
  actor?: Actor;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}

interface StepOptions {
  input?: any;
  captureOutput?: boolean;
  continueOnError?: boolean;
}
```

### 6.5 DecisionObserver

```typescript
// src/observability/observers/decision.ts

import { Actor } from '../../core/types/execution-context';
import { Observer } from '../core/observer';

/**
 * Decision Observer - For algorithm/rule decisions
 * 
 * Usage:
 * ```typescript
 * DecisionObserver.record({
 *   name: 'pricing.discount',
 *   input: { customerId, orderTotal },
 *   output: { discountPercent: 15, reason: 'loyalty' },
 *   rules: [
 *     { rule: 'loyalty_tier', matched: true, value: 'gold' },
 *     { rule: 'order_threshold', matched: true, value: 100 },
 *   ],
 * });
 * 
 * // For feature flags
 * DecisionObserver.featureFlag({
 *   flag: 'new_checkout',
 *   enabled: true,
 *   variant: 'B',
 *   userId: user.id,
 * });
 * ```
 */
export class DecisionObserver {
  /**
   * Record a decision
   */
  static record(options: {
    name: string;
    input?: any;
    output: any;
    rules?: Array<{ rule: string; matched: boolean; value?: any }>;
    reasoning?: string;
    algorithm?: string;
    durationMs?: number;
    actor?: Actor;
    tags?: Record<string, string>;
  }): string | undefined {
    return Observer.observe({
      type: 'decision',
      level: 'info',
      correlationId: Observer.currentContext()?.correlationId,
      operation: options.name,
      data: {
        input: options.input,
        output: options.output,
        rules: options.rules,
        reasoning: options.reasoning,
        algorithm: options.algorithm,
      },
      durationMs: options.durationMs,
      actor: options.actor,
      tags: { ...options.tags, decision: options.name },
      timestampMs: Date.now(),
    });
  }

  /**
   * Record feature flag evaluation
   */
  static featureFlag(options: {
    flag: string;
    enabled: boolean;
    variant?: string;
    userId?: string;
    context?: Record<string, any>;
    tags?: Record<string, string>;
  }): string | undefined {
    return Observer.observe({
      type: 'decision',
      subType: 'feature_flag',
      level: 'debug', // Feature flags are high-volume
      correlationId: Observer.currentContext()?.correlationId,
      operation: `feature.${options.flag}`,
      data: {
        flag: options.flag,
        enabled: options.enabled,
        variant: options.variant,
        userId: options.userId,
        context: options.context,
      },
      tags: { 
        ...options.tags, 
        feature_flag: options.flag,
        variant: options.variant ?? (options.enabled ? 'enabled' : 'disabled'),
      },
      timestampMs: Date.now(),
    });
  }

  /**
   * Record A/B test participation
   */
  static abTest(options: {
    experiment: string;
    variant: string;
    userId: string;
    metadata?: Record<string, any>;
  }): string | undefined {
    return Observer.observe({
      type: 'decision',
      subType: 'ab_test',
      level: 'debug',
      correlationId: Observer.currentContext()?.correlationId,
      operation: `experiment.${options.experiment}`,
      data: {
        experiment: options.experiment,
        variant: options.variant,
        userId: options.userId,
        metadata: options.metadata,
      },
      tags: {
        experiment: options.experiment,
        variant: options.variant,
      },
      timestampMs: Date.now(),
    });
  }
}
```

### 6.6 AccessLogObserver

```typescript
// src/observability/observers/access-log.ts

import { Actor } from '../../core/types/execution-context';
import { Request, Response } from '../../interfaces';
import { Observer } from '../core/observer';

/**
 * Access Log Observer - For API access logging
 * 
 * Usage:
 * ```typescript
 * // In middleware
 * AccessLogObserver.request({
 *   method: 'POST',
 *   path: '/api/orders',
 *   actor: ctx.actor,
 *   responseCode: 201,
 *   durationMs: 145,
 * });
 * ```
 */
export class AccessLogObserver {
  /**
   * Record API request
   */
  static request(options: {
    method: string;
    path: string;
    responseCode: number;
    durationMs: number;
    actor?: Actor;
    requestId?: string;
    correlationId?: string;
    contentLength?: number;
    userAgent?: string;
    sourceIp?: string;
    error?: Error;
    tags?: Record<string, string>;
  }): string | undefined {
    const success = options.responseCode < 400;
    
    return Observer.observe({
      type: 'access.request',
      level: success ? 'info' : (options.responseCode >= 500 ? 'error' : 'warn'),
      correlationId: options.correlationId ?? options.requestId ?? Observer.currentContext()?.correlationId,
      operation: `${options.method} ${options.path}`,
      status: options.responseCode.toString(),
      success,
      durationMs: options.durationMs,
      actor: options.actor,
      data: {
        method: options.method,
        path: options.path,
        responseCode: options.responseCode,
        contentLength: options.contentLength,
        userAgent: options.userAgent ?? options.actor?.userAgent,
        sourceIp: options.sourceIp ?? options.actor?.sourceIp,
      },
      error: options.error ? {
        type: options.error.name,
        message: options.error.message,
        stack: options.error.stack,
      } : undefined,
      tags: {
        ...options.tags,
        method: options.method,
        statusCode: options.responseCode.toString(),
        statusClass: `${Math.floor(options.responseCode / 100)}xx`,
      },
      metrics: {
        responseTime: options.durationMs,
        statusCode: options.responseCode,
      },
      timestampMs: Date.now(),
    });
  }

  /**
   * Record from FW24 Request/Response objects
   */
  static fromContext(
    request: Request,
    response: Response,
    actor?: Actor,
    durationMs?: number
  ): string | undefined {
    return this.request({
      method: request.method || 'UNKNOWN',
      path: request.path || request.resource || '/',
      responseCode: response.statusCode || 200,
      durationMs: durationMs ?? 0,
      actor,
      requestId: request.requestContext?.requestId,
      contentLength: response.body ? Buffer.byteLength(JSON.stringify(response.body)) : 0,
    });
  }
}
```

---

## 7. Storage Layer

### 7.1 Entity Schema (Updated)

```typescript
// src/observability/storage/schema.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { EntityConfiguration } from 'electrodb';
import { DefaultEntityOperations, createEntitySchema } from '../../entity/base-entity';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    convertClassInstanceToMap: true,
    removeUndefinedValues: true,
    convertEmptyValues: true,
  },
});

const TABLE_ENV = process.env.OBSERVABILITY_TABLE_NAME ?? process.env.AUDIT_TABLE_NAME ?? 'ObservabilityLogs';

export const ObservabilityLogEntityConfig: EntityConfiguration = {
  table: process.env[`${TABLE_ENV.toUpperCase()}_TABLE`] ?? TABLE_ENV,
  client: docClient,
};

export const ObservabilityLogEntitySchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'observabilityLog',
    entityNamePlural: 'observabilityLogs',
    service: 'observability',
    entityOperations: DefaultEntityOperations,
    excludeFromAdminMenu: true,
    excludeFromAdminCreate: true,
    excludeFromAdminUpdate: true,
    excludeFromAdminDelete: true,
    CRUDApiPath: '/system/observability',
    search: {
      enabled: true,
      indexConfig: {
        primaryKey: 'logId',
      }
    },
  },
  attributes: {
    // === IDENTITY ===
    logId: {
      type: 'string',
      required: true,
      isIdentifier: true,
      default: () => randomUUID(),
    },
    parentLogId: {
      type: 'string',
      required: false,
    },
    correlationId: {
      type: 'string',
      required: true,
      default: () => randomUUID(),
    },

    // === CLASSIFICATION ===
    type: {
      type: 'string',
      required: true,
    },
    subType: {
      type: 'string',
      required: false,
    },
    level: {
      type: 'string',
      required: true,
      default: () => 'info',
    },

    // === ENTITY CONTEXT ===
    entityName: {
      type: 'string',
      required: false,
    },
    entityId: {
      type: 'string',
      required: false,
    },

    // === OPERATION ===
    operation: {
      type: 'string',
      required: false,
    },
    status: {
      type: 'string',
      required: false,
    },
    success: {
      type: 'boolean',
      required: false,
    },

    // === TIMING ===
    timestampMs: {
      type: 'number',
      required: true,
      default: () => Date.now(),
    },
    durationMs: {
      type: 'number',
      required: false,
    },

    // === SOURCE & TAGS ===
    source: {
      type: 'string',
      required: false,
    },
    tags: {
      type: 'any', // Flexible map
      required: false,
    },

    // === PAYLOADS ===
    data: {
      type: 'any',
      required: false,
    },
    attributes: {
      type: 'any',
      required: false,
    },
    metadata: {
      type: 'any',
      required: false,
    },
    metrics: {
      type: 'any',
      required: false,
    },
    context: {
      type: 'any',
      required: false,
    },

    // === ERROR ===
    error: {
      type: 'map',
      required: false,
      properties: {
        type: { type: 'string' },
        message: { type: 'string' },
        stack: { type: 'string' },
        code: { type: 'string' },
      },
    },

    // === ACTOR (stored as-is from existing Actor type) ===
    actor: {
      type: 'any',
      required: false,
    },

    // === DERIVED FIELDS (for indexing) ===
    actorId: {
      type: 'string',
      required: false,
      watch: ['actor'],
      set: (_: any, { actor }: any) => actor?.actorId || undefined,
    },
    tenantId: {
      type: 'string',
      required: false,
      watch: ['actor'],
      set: (_: any, { actor }: any) => actor?.tenantId || undefined,
    },

    // === TTL ===
    ttl: {
      type: 'number',
      required: false,
      default: () => {
        const ttlDays = parseInt(process.env.OBSERVABILITY_TTL_DAYS || '90');
        return Math.floor(Date.now() / 1000) + (ttlDays * 24 * 60 * 60);
      },
    },
  },
  indexes: {
    // Primary - by logId
    primary: {
      pk: { field: 'pk', composite: ['logId'] },
      sk: { field: 'sk', composite: [] },
    },
    // GSI1 - by correlation (trace)
    byTrace: {
      index: 'gsi1',
      pk: { field: 'gsi1pk', composite: ['correlationId'] },
      sk: { field: 'gsi1sk', composite: ['timestampMs'] },
    },
    // GSI2 - by parent (hierarchy)
    byParent: {
      index: 'gsi2',
      pk: { field: 'gsi2pk', composite: ['parentLogId'] },
      sk: { field: 'gsi2sk', composite: ['timestampMs'] },
    },
    // GSI3 - by entity
    byEntity: {
      index: 'gsi3',
      pk: { field: 'gsi3pk', composite: ['entityName', 'entityId'] },
      sk: { field: 'gsi3sk', composite: ['timestampMs'] },
    },
    // GSI4 - by type
    byType: {
      index: 'gsi4',
      pk: { field: 'gsi4pk', composite: ['type'] },
      sk: { field: 'gsi4sk', composite: ['timestampMs'] },
    },
    // GSI5 - by source
    bySource: {
      index: 'gsi5',
      pk: { field: 'gsi5pk', composite: ['source'] },
      sk: { field: 'gsi5sk', composite: ['timestampMs'] },
    },
    // GSI6 - by tenant
    byTenant: {
      index: 'gsi6',
      pk: { field: 'gsi6pk', composite: ['tenantId'] },
      sk: { field: 'gsi6sk', composite: ['timestampMs'] },
    },
  },
} as const);

export type ObservabilityLogSchema = typeof ObservabilityLogEntitySchema;
```

### 7.2 Entity Service

```typescript
// src/observability/storage/service.ts

import { BaseEntityService } from '../../entity/base-service';
import { EntityQuery } from '../../entity/query-types';
import { 
  ObservabilityLogEntitySchema, 
  ObservabilityLogEntityConfig,
  ObservabilityLogSchema 
} from './schema';

/**
 * Observability Log Service
 * 
 * Extends BaseEntityService - uses existing FW24 query infrastructure
 */
export class ObservabilityLogService extends BaseEntityService<ObservabilityLogSchema> {
  private static instance: ObservabilityLogService;

  constructor() {
    super(
      ObservabilityLogEntitySchema,
      ObservabilityLogEntityConfig
    );
  }

  static getInstance(): ObservabilityLogService {
    if (!this.instance) {
      this.instance = new ObservabilityLogService();
    }
    return this.instance;
  }

  // === CONVENIENCE QUERY METHODS ===

  /**
   * Get all logs for a trace/correlation
   */
  async getByTrace(correlationId: string, options?: QueryOptions) {
    return this.query({
      ...options,
      filters: {
        ...options?.filters,
        correlationId: { eq: correlationId },
      },
      pagination: {
        order: 'asc',
        ...options?.pagination,
      },
      index: { name: 'byTrace' },
    });
  }

  /**
   * Get logs by entity
   */
  async getByEntity(entityName: string, entityId: string, options?: QueryOptions) {
    return this.query({
      ...options,
      filters: {
        ...options?.filters,
        entityName: { eq: entityName },
        entityId: { eq: entityId },
      },
      index: { name: 'byEntity' },
    });
  }

  /**
   * Get logs by type
   */
  async getByType(type: string, options?: QueryOptions) {
    return this.query({
      ...options,
      filters: {
        ...options?.filters,
        type: { eq: type },
      },
      index: { name: 'byType' },
    });
  }

  /**
   * Get child logs
   */
  async getChildren(parentLogId: string, options?: QueryOptions) {
    return this.query({
      ...options,
      filters: {
        ...options?.filters,
        parentLogId: { eq: parentLogId },
      },
      index: { name: 'byParent' },
    });
  }

  /**
   * Get logs by source
   */
  async getBySource(source: string, options?: QueryOptions) {
    return this.query({
      ...options,
      filters: {
        ...options?.filters,
        source: { eq: source },
      },
      index: { name: 'bySource' },
    });
  }

  /**
   * Get logs by tenant
   */
  async getByTenant(tenantId: string, options?: QueryOptions) {
    return this.query({
      ...options,
      filters: {
        ...options?.filters,
        tenantId: { eq: tenantId },
      },
      index: { name: 'byTenant' },
    });
  }

  /**
   * Reconstruct span hierarchy from flat records
   */
  reconstructSpans(records: any[]): ReconstructedSpan[] {
    const spanMap = new Map<string, ReconstructedSpan>();
    
    // Group by entityId for span records
    const grouped = new Map<string, any[]>();
    for (const record of records) {
      if (record.entityName !== 'span' || !record.entityId) continue;
      
      if (!grouped.has(record.entityId)) {
        grouped.set(record.entityId, []);
      }
      grouped.get(record.entityId)!.push(record);
    }

    // Build span objects
    for (const [spanId, spanRecords] of grouped) {
      const startRecord = spanRecords.find(r => r.type === 'span.start');
      const endRecord = spanRecords.find(r => r.type === 'span.end');
      const eventRecords = spanRecords.filter(r => r.type === 'span.event');

      if (!startRecord) continue;

      spanMap.set(spanId, {
        spanId,
        traceId: startRecord.correlationId,
        parentSpanId: startRecord.parentLogId,
        operation: startRecord.operation || 'unknown',
        startTime: startRecord.timestampMs,
        endTime: endRecord?.timestampMs,
        duration: endRecord?.durationMs,
        status: endRecord?.status,
        success: endRecord?.success,
        attributes: { ...(startRecord.data || {}), ...(endRecord?.data || {}) },
        events: eventRecords.map(e => ({
          name: e.operation || 'event',
          timestamp: e.timestampMs,
          attributes: e.data || {},
        })),
        metrics: endRecord?.metrics || {},
        children: [],
      });
    }

    // Build tree
    const roots: ReconstructedSpan[] = [];
    for (const span of spanMap.values()) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        spanMap.get(span.parentSpanId)!.children.push(span);
      } else {
        roots.push(span);
      }
    }

    return roots;
  }

  /**
   * Get complete trace with span hierarchy
   */
  async getTraceWithSpans(correlationId: string): Promise<ReconstructedSpan[]> {
    const result = await this.getByTrace(correlationId);
    return this.reconstructSpans(result.data || []);
  }
}

interface QueryOptions {
  filters?: Record<string, any>;
  pagination?: {
    count?: number;
    cursor?: string;
    order?: 'asc' | 'desc';
  };
}

interface ReconstructedSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: string;
  success?: boolean;
  attributes: Record<string, any>;
  events: Array<{ name: string; timestamp: number; attributes: Record<string, any> }>;
  metrics: Record<string, number>;
  children: ReconstructedSpan[];
}
```

---

## 8. Backend System

### 8.1 Base Backend

```typescript
// src/observability/backends/base.ts

import { ObservabilityEvent, ObservabilityLevel } from '../core/types';

export interface ObservabilityBackend {
  name: string;
  minLevel?: ObservabilityLevel;
  
  capture(event: ObservabilityEvent): Promise<void>;
  flush?(): Promise<void>;
  initializeInvocation?(): void;
}

export interface BackendOptions {
  minLevel?: ObservabilityLevel;
  serviceName?: string;
}
```

### 8.2 DynamoDB Backend (Updated)

```typescript
// src/observability/backends/dynamodb.ts

import { createLogger } from '../../logging';
import { ObservabilityEvent, ObservabilityLevel } from '../core/types';
import { ObservabilityBackend, BackendOptions } from './base';
import { ObservabilityLogService } from '../storage/service';
import { truncatePayload } from '../utils/payload';

const logger = createLogger('DynamoDBBackend');

const BATCH_SIZE = 25;

/**
 * DynamoDB Backend using ObservabilityLogService
 * 
 * Uses existing FW24 EntityService infrastructure
 */
export class DynamoDBObservabilityBackend implements ObservabilityBackend {
  name = 'dynamodb';
  minLevel?: ObservabilityLevel;
  
  private buffer: ObservabilityEvent[] = [];
  private service: ObservabilityLogService;
  private ttlDays: number;

  constructor(options: BackendOptions & { ttlDays?: number }) {
    this.minLevel = options.minLevel;
    this.ttlDays = options.ttlDays ?? 90;
    this.service = ObservabilityLogService.getInstance();
  }

  initializeInvocation(): void {
    // Clear buffer from previous invocation
    this.buffer = [];
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    this.buffer.push(event);
    
    if (this.buffer.length >= BATCH_SIZE) {
      await this.flushBuffer();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    try {
      const ttl = Math.floor(Date.now() / 1000) + this.ttlDays * 24 * 60 * 60;
      
      const items = events.map(event => ({
        logId: event.logId,
        parentLogId: event.parentLogId,
        correlationId: event.correlationId,
        type: event.type,
        subType: event.subType,
        level: event.level,
        entityName: event.entityName,
        entityId: event.entityId,
        operation: event.operation,
        success: event.success,
        status: event.status,
        durationMs: event.durationMs,
        timestampMs: event.timestampMs,
        source: event.source,
        tags: event.tags,
        actor: event.actor ? truncatePayload(event.actor) : undefined,
        data: event.data ? truncatePayload(event.data) : undefined,
        attributes: event.attributes ? truncatePayload(event.attributes) : undefined,
        metadata: event.metadata ? truncatePayload(event.metadata) : undefined,
        metrics: event.metrics,
        error: event.error,
        context: event.context ? truncatePayload(event.context) : undefined,
        ttl,
      }));

      // Use EntityService batch write
      const repository = this.service.getRepository();
      await repository.put(items).go();
      
      logger.debug(`Wrote ${items.length} events to DynamoDB`);
    } catch (error) {
      logger.error('DynamoDB batch write failed', error);
      // Re-add to buffer for retry (up to limit)
      if (this.buffer.length < BATCH_SIZE * 2) {
        this.buffer.unshift(...events.slice(0, BATCH_SIZE));
      }
    }
  }
}
```

---

## 9. Query & Analysis

All queries go through `ObservabilityLogService` which extends `BaseEntityService`.

This provides:
- Full `EntityQuery` support (filters, pagination, search)
- All filter operators (eq, contains, between, etc.)
- Index selection
- Hydration support

```typescript
// Example queries using existing EntityQuery infrastructure

const service = ObservabilityLogService.getInstance();

// Get all errors in last hour
const errors = await service.query({
  filters: {
    level: { eq: 'error' },
    timestampMs: { gte: Date.now() - 3600000 },
  },
  pagination: { count: 100, order: 'desc' },
});

// Get audits for specific user
const userAudits = await service.query({
  filters: {
    type: { startsWith: 'audit' },
    actorId: { eq: userId },
  },
});

// Search logs
const searchResults = await service.query({
  search: 'payment failed',
  searchAttributes: ['operation', 'data'],
  filters: {
    type: { eq: 'log' },
  },
});
```

---

## 10. Context & Correlation

### 10.1 Automatic Context Propagation

```typescript
// Controller integration
export class OrderController extends BaseEntityController<OrderSchema> {
  async handleRequest(event: APIGatewayEvent, context: Context) {
    // Create observation context from request
    const actor = this.extractActorContext(event, request);
    const obsContext = Observer.createContext({
      correlationId: event.requestContext.requestId,
      actor,
      tags: {
        api: 'orders',
        stage: event.requestContext.stage,
      },
    });

    // All observations within this context automatically inherit correlationId, actor, tags
    return Observer.withContext(obsContext, async () => {
      // These all get the same correlationId
      const span = SpanObserver.start('createOrder');
      MetricObserver.increment('orders.created');
      AuditObserver.entityCreate('Order', orderId, data);
      span.end();
    });
  }
}
```

### 10.2 Cross-Service Propagation

```typescript
// Extract from incoming request
const correlationId = 
  event.headers['x-correlation-id'] ||
  event.headers['x-amzn-trace-id'] ||
  event.requestContext.requestId;

// Propagate to outgoing requests
const response = await fetch(url, {
  headers: {
    'x-correlation-id': Observer.currentContext()?.correlationId,
  },
});
```

---

## 11. Migration Plan

### 11.1 Phase 1: Refactor Core (Non-Breaking)

1. Create `src/observability/core/` directory
2. Move `manager.ts` → `core/observer.ts`
3. Update types to use existing `Actor`
4. Create `storage/service.ts` extending `BaseEntityService`

### 11.2 Phase 2: Add Specialized Observers

1. Create `src/observability/observers/` directory
2. Implement each observer (SpanObserver, AuditObserver, etc.)
3. Update existing `span.ts`, `workflow.ts` to use new observers
4. Deprecate direct `ObservabilityManager.capture()` calls

### 11.3 Phase 3: Migrate Audit System

1. Deprecate `src/audit/` directory (keep for backwards compatibility)
2. Add compatibility shim: `captureLog()` → `AuditObserver.record()`
3. Update `DynamoDBAuditEntitySchema` reference to use new schema
4. Migrate controllers to use `AuditObserver`

### 11.4 Phase 4: Clean Up

1. Remove deprecated `query-service.ts`
2. Remove duplicate actor types
3. Update documentation
4. Release v2.0

---

## 12. Implementation Phases

### Phase 1: Core Observer (Week 1)
- [ ] Create `core/observer.ts`
- [ ] Create `core/types.ts` (using existing Actor)
- [ ] Create `core/config.ts`
- [ ] Create `core/context.ts`
- [ ] Update `storage/schema.ts`
- [ ] Create `storage/service.ts`
- [ ] Tests for core Observer

### Phase 2: Specialized Observers (Week 2)
- [ ] `observers/span.ts` - SpanObserver
- [ ] `observers/audit.ts` - AuditObserver
- [ ] `observers/metric.ts` - MetricObserver
- [ ] `observers/workflow.ts` - WorkflowObserver
- [ ] `observers/decision.ts` - DecisionObserver
- [ ] `observers/access-log.ts` - AccessLogObserver
- [ ] Tests for each observer

### Phase 3: Backend Updates (Week 3)
- [ ] Update `backends/dynamodb.ts` to use ObservabilityLogService
- [ ] Update `backends/cloudwatch.ts`
- [ ] Update `backends/otel.ts`
- [ ] Integration tests

### Phase 4: Migration & Documentation (Week 4)
- [ ] Audit system migration shim
- [ ] Controller integration examples
- [ ] API documentation
- [ ] Migration guide
- [ ] Performance testing

---

## Summary

This design:

1. **Uses existing FW24 infrastructure**
   - `Actor` from `ExecutionContext` (not new type)
   - `BaseEntityService` for storage (not direct ElectroDB)
   - `EntityQuery` for queries (not custom query service)

2. **Provides specialized observers**
   - `SpanObserver` - Distributed tracing
   - `AuditObserver` - Entity auditing
   - `MetricObserver` - Business/technical metrics
   - `WorkflowObserver` - Long-running workflows
   - `DecisionObserver` - Algorithm/rule decisions
   - `AccessLogObserver` - API access logging

3. **Is extensible**
   - Custom event types via `custom.${string}`
   - Custom backends via `ObservabilityBackend` interface
   - Applications can build complex systems on top

4. **Is Lambda-optimized**
   - Fire-and-forget capture
   - Batch writes
   - Proper flush on handler exit
   - Cold start detection

5. **Is cost-aware**
   - Level-based sampling
   - Operation-specific sampling
   - TTL for automatic data cleanup

