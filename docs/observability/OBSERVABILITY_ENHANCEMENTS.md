# Observability Framework - Enhancement Plan

**Scope**: Links, Sampling, Decorators (Batching already exists)

---

## 1. LINKS

### 1.1 Type Definition

```typescript
// types.ts
export interface ObservabilityLink {
  /** What we're linking to */
  target: {
    type: 'log' | 'entity' | 'external';
    logId?: string;
    entityName?: string;
    entityId?: string;
    externalSystem?: string;
    externalId?: string;
  };
  
  /** Relationship */
  relation: 'causes' | 'caused_by' | 'follows' | 'parent_of' | 'child_of' | 'related' | string;
  
  /** Optional context */
  attributes?: Record<string, unknown>;
}

export interface ObservabilityEvent {
  // ... existing fields ...
  links?: ObservabilityLink[];
}
```

### 1.2 Add to All Observers

**SpanObserver**:
```typescript
interface SpanOptions {
  // ... existing ...
  links?: ObservabilityLink[];
}

interface ISpanObserver {
  // ... existing ...
  addLink(link: ObservabilityLink): this;
}
```

**AuditObserver**:
```typescript
interface AuditObserverOptions {
  // ... existing ...
  links?: ObservabilityLink[];
}
```

**MetricObserver**:
```typescript
interface MetricOptions {
  // ... existing ...
  links?: ObservabilityLink[];
}
```

**WorkflowObserver**:
```typescript
interface WorkflowOptions {
  // ... existing ...
  links?: ObservabilityLink[];
}
```

**DecisionObserver**:
```typescript
// record(), featureFlag(), abTest() options
links?: ObservabilityLink[];
```

**AccessLogObserver**:
```typescript
interface AccessLogOptions {
  // ... existing ...
  links?: ObservabilityLink[];
}
```

**LogObserver**:
```typescript
interface LogOptions {
  // ... existing ...
  links?: ObservabilityLink[];
}
```

### 1.3 Schema Update

```typescript
// storage/log-entity.ts
links: {
  type: 'list',
  required: false,
  items: {
    type: 'map',
    properties: {
      target: {
        type: 'map',
        properties: {
          type: { type: 'string' },
          logId: { type: 'string' },
          entityName: { type: 'string' },
          entityId: { type: 'string' },
          externalSystem: { type: 'string' },
          externalId: { type: 'string' },
        },
      },
      relation: { type: 'string' },
      attributes: { type: 'map', properties: {} },
    },
  },
},
```

### 1.4 Files to Modify

- `types.ts` - Add `ObservabilityLink`, add `links` to `ObservabilityEvent` and `CaptureInput`
- `storage/log-entity.ts` - Add `links` to schema
- `observers/base.ts` - Pass `links` through `captureEvent()`
- `observers/span.ts` - Add `links` to options, add `addLink()` method
- `observers/audit.ts` - Add `links` to all methods
- `observers/metric.ts` - Add `links` to options
- `observers/workflow.ts` - Add `links` to options
- `observers/decision.ts` - Add `links` to all methods
- `observers/access-log.ts` - Add `links` to options
- `observers/log.ts` - Add `links` to options

---

## 2. SAMPLING

### 2.1 Config

```typescript
// types.ts
export interface SamplingConfig {
  enabled: boolean;
  
  /** Default rate (0-1) */
  defaultRate: number;
  
  /** Rate by level (overrides defaultRate) */
  byLevel?: {
    trace?: number;
    debug?: number;
    info?: number;
    warn?: number;
    error?: number;
    critical?: number;
  };
  
  /** Rate by type (overrides byLevel) */
  byType?: Record<string, number>; // e.g., { 'span.*': 0.2, 'metric': 0.5 }
  
  /** Error enrichment - capture more context on errors */
  errorEnrichment?: {
    enabled: boolean;
    /** Preceding events to capture retroactively */
    precedingEvents: number;
    /** Don't truncate payloads on errors */
    fullPayloads: boolean;
  };
}
```

### 2.2 Defaults

```typescript
// config.ts
export const DEFAULT_SAMPLING: SamplingConfig = {
  enabled: false,
  defaultRate: 1.0,
  byLevel: {
    trace: 0.1,
    debug: 0.5,
    info: 1.0,
    warn: 1.0,
    error: 1.0,
    critical: 1.0,
  },
  errorEnrichment: {
    enabled: true,
    precedingEvents: 10,
    fullPayloads: true,
  },
};
```

### 2.3 Implementation

**Sampling Decision**:
```typescript
// manager.ts
private static shouldCapture(event: ObservabilityEvent): boolean {
  const { sampling } = this.getConfig();
  if (!sampling.enabled) return true;
  
  // Type rate (most specific)
  const typeRate = this.getTypeRate(event.type, sampling.byType);
  if (typeRate !== undefined) return Math.random() < typeRate;
  
  // Level rate
  const levelRate = sampling.byLevel?.[event.level];
  if (levelRate !== undefined) return Math.random() < levelRate;
  
  // Default rate
  return Math.random() < sampling.defaultRate;
}
```

**Error Enrichment**:
```typescript
// manager.ts
private static recentEvents: ObservabilityEvent[] = [];

static capture(input: CaptureInput, options?: CaptureOptions): string | undefined {
  const event = this.buildEvent(input);
  const config = this.getConfig();
  
  // Track recent events for error enrichment
  if (config.sampling.errorEnrichment?.enabled) {
    this.recentEvents.push(event);
    if (this.recentEvents.length > 50) this.recentEvents.shift();
  }
  
  // On error, flush preceding events
  if ((event.level === 'error' || event.level === 'critical') && 
      config.sampling.errorEnrichment?.enabled) {
    this.flushPrecedingEvents(event);
  }
  
  // Sampling check
  if (!options?.critical && !this.shouldCapture(event, config)) {
    return undefined;
  }
  
  // ... dispatch to backends
}
```

### 2.4 Files to Modify

- `types.ts` - Update `SamplingConfig`
- `config.ts` - Add `DEFAULT_SAMPLING`, update `fromEnvironment()`
- `manager.ts` - Update `shouldCapture()`, add error enrichment logic

---

## 3. DECORATORS

### 3.1 @Observed (Unified)

```typescript
// decorators/observed.ts
export interface ObservedOptions {
  /** Operation name (default: method name) */
  name?: string;
  
  /** Create span */
  trace?: boolean | {
    level?: ObservabilityLevelString;
    attributes?: Record<string, unknown>;
  };
  
  /** Create audit */
  audit?: {
    action: string;
    entityName?: string;
    entityIdParam?: number; // Param index for entity ID
  };
  
  /** Record metric */
  metric?: {
    name: string;
    type?: 'counter' | 'timing';
    tags?: Record<string, string>;
  };
  
  /** Links */
  links?: ObservabilityLink[];
  
  /** Capture args */
  captureArgs?: boolean | number[];
  
  /** Capture result */
  captureResult?: boolean;
}
```

### 3.2 @ObservedClass

```typescript
// decorators/observed-class.ts
export interface ObservedClassOptions {
  /** Source identifier */
  source?: string;
  
  /** Default level */
  level?: ObservabilityLevelString;
  
  /** Trace all methods */
  traceAll?: boolean;
  
  /** Methods to exclude */
  exclude?: string[];
}
```

### 3.3 Update Existing

**@Traced** - Add `links` option
**@Audited** - Add `links` option

### 3.4 Files to Modify

- `decorators/traced.ts` - Add `links` to options
- `decorators/audited.ts` - Add `links` to options
- `decorators/observed.ts` - New file
- `decorators/observed-class.ts` - New file
- `decorators/index.ts` - Export new decorators

---

## 4. IMPLEMENTATION ORDER

| # | Feature | Est. Hours | Files |
|---|---------|------------|-------|
| 1 | Links | 2 | types, schema, all observers |
| 2 | Sampling | 2 | types, config, manager |
| 3 | Decorators | 2 | decorators/* |
| **Total** | | **6** | |

---

Ready to implement?
