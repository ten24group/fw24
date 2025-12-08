# FW24 Observability System

Unified observability for distributed tracing, logging, metrics, and auditing in serverless AWS Lambda environments.

---

## Quick Start

### 1. Setup (CDK)

```typescript
// index.ts
const app = new Application({
  observability: {
    table: { name: 'observability' },
    ttlDays: 90,
  },
});
```

### 2. Configure (DI Layer)

```typescript
// di.ts
import { registerObservabilityConfig } from '@ten24group/fw24/observability';

registerObservabilityConfig(DIContainer.ROOT, {
  backends: ['dynamodb', 'cloudwatch'],
  dataProtection: { enabled: true },
  sampling: { enabled: false },
});
```

### 3. Use in Code

```typescript
import { SpanObserver, AuditObserver, MetricObserver } from '@ten24group/fw24/observability';

// Context is auto-established in controllers
const span = SpanObserver.start('processOrder');
try {
  await processOrder(orderId);
  AuditObserver.entityCreate('Order', orderId, data);
  MetricObserver.increment('orders.created');
  span.end({ success: true });
} catch (error) {
  span.end({ success: false, error });
  throw error;
}
```

---

## Core Concepts

### Context Management

Observability requires a correlation ID for distributed tracing. Context is automatically established in:
- API Gateway controllers
- SQS handlers
- Task handlers
- DynamoDB stream processors

**Manual context:**
```typescript
import { runWithContext, createObservationContext } from '@ten24group/fw24/observability';

await runWithContext(
  createObservationContext(requestId, { actor }),
  async () => {
    // All observability calls here inherit context
    SpanObserver.start('operation');
  }
);
```

### Trace Propagation

Automatically propagates trace context across:
- HTTP requests (W3C Trace Context)
- SQS messages
- SNS messages
- EventBridge events
- Step Functions
- DynamoDB Streams

**Outgoing HTTP:**
```typescript
import { createPropagationHeaders, getCurrentContext } from '@ten24group/fw24/observability';

const ctx = getCurrentContext();
const response = await fetch(url, {
  headers: {
    ...createPropagationHeaders(ctx),
    'Content-Type': 'application/json',
  },
});
```

---

## Observers

### SpanObserver - Distributed Tracing

```typescript
// Manual span
const span = SpanObserver.start('processOrder', {
  level: 'info',
  attributes: { orderId: '123' },
});
span.setAttribute('status', 'validated');
span.addEvent('payment_processed');
span.end({ success: true });

// Auto span
await withSpan('processOrder', async (span) => {
  span.setAttribute('orderId', '123');
  // Auto-ends on success/error
});

// Nested spans
await span.withChild('validateOrder', async (child) => {
  // Automatically linked to parent
});
```

### AuditObserver - Entity Auditing

```typescript
// Entity lifecycle
AuditObserver.entityCreate('User', userId, userData);
AuditObserver.entityUpdate('User', userId, { before, after, diff });
AuditObserver.entityDelete('User', userId, deletedData);

// Custom audit
AuditObserver.record({
  operation: 'permission.granted',
  entityName: 'User',
  entityId: userId,
  data: { role: 'admin', grantedBy: adminId },
  level: 'warn',
});

// Compliance audit
AuditObserver.compliance({
  operation: 'pii.access',
  subType: 'pii_access',
  entityName: 'User',
  entityId: userId,
  data: { fields: ['ssn', 'email'], reason: 'customer_support' },
});
```

### MetricObserver - Business Metrics

```typescript
// Counter
MetricObserver.increment('orders.created');
MetricObserver.increment('items.sold', 5);

// Gauge
MetricObserver.gauge('queue.depth', 42);

// Timing
MetricObserver.timing('api.latency', 145);

// Custom with tags
MetricObserver.record('payment.amount', 99.99, {
  tags: { currency: 'USD', method: 'card' },
  unit: 'dollars',
});
```

---

## Building Specialized Observers

The framework provides core observers (Span, Audit, Metric, Log). Applications can build
specialized observers on top of these primitives:

```typescript
// Example: WorkflowObserver (application-specific)
class WorkflowObserver {
  static start(name: string, options: { entityName: string; entityId: string }) {
    const span = SpanObserver.start(`workflow.${name}`, {
      attributes: { 'workflow.name': name, ...options }
    });
    
    return {
      step: async (stepName: string, fn: () => Promise<any>) => {
        const stepSpan = span.createChild(`step.${stepName}`);
        try {
          const result = await fn();
          stepSpan.end({ success: true });
          return result;
        } catch (error) {
          stepSpan.end({ success: false, error });
          throw error;
        }
      },
      complete: (result: any) => {
        span.end({ success: true, attributes: { result } });
      }
    };
  }
}

// Example: DecisionObserver (application-specific)
class DecisionObserver {
  static record(decision: { name: string; input: any; output: any }) {
    return AuditObserver.record({
      operation: `decision.${decision.name}`,
      subType: 'algorithm_decision',
      data: { input: decision.input, output: decision.output }
    });
  }
}
```

### LogObserver - Structured Logging

```typescript
// Standard levels
LogObserver.info('Order processed', { orderId, amount });
LogObserver.warn('Rate limit approaching', { current: 95, limit: 100 });
LogObserver.error('Payment failed', { error, orderId });

// With child logs
const parent = LogObserver.info('Processing batch', { batchId });
parent.child('Processing item 1', { itemId: '1' });
parent.child('Processing item 2', { itemId: '2' });
```

---

## Decorators

### @Traced - Automatic Span Tracing

```typescript
class OrderService {
  @Traced()
  async processOrder(orderId: string): Promise<Order> {
    // Method automatically traced
  }
  
  @Traced({ 
    name: 'custom-operation',
    level: 'debug',
    captureArgs: true,
    captureResult: true 
  })
  async internalProcess(): Promise<void> {
    // Custom span configuration
  }
}
```

### @Audited - Automatic Audit Logging

```typescript
class UserService {
  @Audited({ operation: 'permission.change' })
  async updatePermissions(userId: string, permissions: string[]): Promise<void> {
    // Method automatically audited
  }
  
  @Audited({ 
    operation: 'sensitive.access',
    level: 'warn',
    captureArgs: true 
  })
  async accessSensitiveData(userId: string): Promise<Data> {
    // Audit with arguments captured
  }
}
```

### @Observed - Unified Observability

```typescript
class OrderService {
  @Observed({ 
    trace: true,
    audit: { action: 'order.create' },
    metric: { name: 'orders.created', type: 'counter' }
  })
  async createOrder(order: Order): Promise<Order> {
    // Method is traced, audited, and metered
  }
}
```

### @ObservedClass - Class-Level Configuration

```typescript
@ObservedClass({ 
  traceAll: true,
  sourceType: 'service',
  exclude: ['internalHelper']
})
class OrderService {
  // All methods automatically traced except excluded ones
  async createOrder(order: Order): Promise<Order> { ... }
  async updateOrder(id: string, data: Partial<Order>): Promise<Order> { ... }
  private internalHelper(): void { ... } // Excluded
}
```

---

## Configuration

### Application Config (CDK)

```typescript
const app = new Application({
  observability: {
    enabled: true,
    table: {
      name: 'observability',
      // Full DynamoDB config support
      searchIndexing: [{
        enabled: true,
        engineConfig: { type: 'meili', host: '...', masterKey: '...' },
      }],
    },
    ttlDays: 90,
  },
});
```

### Runtime Config (DI)

```typescript
registerObservabilityConfig(DIContainer.ROOT, {
  // Backends
  backends: ['dynamodb', 'cloudwatch', 'otel'],
  
  // Service name
  serviceName: 'my-service',
  
  // Minimum level
  minLevel: 'info',
  
  // Sampling
  sampling: {
    enabled: true,
    rates: {
      trace: 0.01,
      debug: 0.1,
      info: 1.0,
      warn: 1.0,
      error: 1.0,
      critical: 1.0,
    },
    operations: {
      'payment.*': 1.0,      // Always capture
      'healthCheck': 0.01,   // 1% sampling
    },
  },
  
  // Data protection
  dataProtection: {
    enabled: true,
    additionalKeys: ['apiKey', 'secret', 'token'],
    fuzzyKeyMatch: true,
    caseSensitiveKeyMatch: false,
  },
  
  // CloudWatch
  cloudwatch: {
    namespace: 'MyApp',
  },
  
  // DynamoDB
  dynamodb: {
    ttlDays: 90,
  },
});
```

### Environment Variables

```bash
# Table name (set automatically by Application)
OBSERVABILITY_TABLE_NAME=myapp-observability
OBSERVABILITY_TTL_DAYS=90

# Service name
SERVICE_NAME=my-service

# Backends (comma-separated)
OBSERVABILITY_BACKENDS=cloudwatch,dynamodb,otel

# Minimum level
OBSERVABILITY_LEVEL=info

# CloudWatch
CLOUDWATCH_METRICS_NAMESPACE=MyApp
```

---

## Backends

### CloudWatch
- Structured logs → CloudWatch Logs
- Metrics → CloudWatch Metrics (EMF format, FREE!)
- Auto-injects Lambda context

### DynamoDB
- Universal storage for all events
- 8 GSIs for querying (trace, parent, entity, type, source, tenant, actor, level)
- TTL for automatic cleanup
- Batch writes (25 items per batch)

### OTEL/X-Ray
- Spans → X-Ray traces
- Proper parent-child relationships
- Service maps and performance analysis
- Requires AWS ADOT Lambda layer

---

## Querying

```typescript
import { ObservabilityLogService } from '@ten24group/fw24/observability';

const service = ObservabilityLogService.getInstance();

// Get all logs in a trace
const logs = await service.getByTrace(correlationId);

// Get logs by entity
const entityLogs = await service.getByEntity('User', userId);

// Get logs by type
const audits = await service.getByType('audit.entity');

// Get child logs
const children = await service.getChildren(parentLogId);

// Reconstruct span hierarchy
const spans = await service.getTraceWithSpans(correlationId);
```

---

## DynamoDB Stream Auditing

Automatically audit entity changes from DynamoDB streams:

```typescript
// In DynamoDB construct
audit: {
  enabled: true,
  allowedEntityNames: ['user', 'order', 'payment'],
  excludedEntityNames: ['auditLog', 'observabilityLog'],
}
```

**Environment variables:**
```bash
AUDIT_ALLOWED_ENTITY_NAMES=user,order,payment
AUDIT_EXCLUDED_ENTITY_NAMES=auditLog,observabilityLog
```

---

## Data Protection

Automatically redacts sensitive data in logs:

**Default protected keys:**
- password, secret, token, apiKey, privateKey
- accessToken, refreshToken, sessionToken, jwt
- creditCard, ssn, pin, cvv, securityCode
- 30+ patterns

**Custom protection:**
```typescript
dataProtection: {
  enabled: true,
  additionalKeys: ['mySecret', /custom.*key/],
  fuzzyKeyMatch: true,  // Matches "userPassword" for "password"
}
```

---

## Best Practices

### 1. Always Establish Context
```typescript
// ✅ Good - context established
await runWithContext(createObservationContext(requestId), async () => {
  SpanObserver.start('operation');
});

// ❌ Bad - no context, creates NoOp span
SpanObserver.start('operation');
```

### 2. Use Appropriate Levels
- `trace` - Very detailed, high-volume
- `debug` - Debugging information
- `info` - Normal operations
- `warn` - Warning conditions
- `error` - Error conditions
- `critical` - Critical failures

### 3. Sample High-Volume Operations
```typescript
sampling: {
  enabled: true,
  operations: {
    'healthCheck': 0.01,  // 1% of health checks
    'payment.*': 1.0,     // 100% of payments
  },
}
```

### 4. Propagate Trace Context
```typescript
// HTTP
const headers = createPropagationHeaders(getCurrentContext());

// SQS
await sendQueueMessage(queueUrl, message, {
  context: getCurrentContext(),
});
```

### 5. Use Decorators for Consistency
```typescript
@ObservedClass({ traceAll: true, sourceType: 'service' })
class MyService {
  // All methods automatically traced
}
```

---

## Testing

```typescript
import { 
  setupTestObservability, 
  cleanupTestObservability,
  assertEventCaptured,
  MockBackend 
} from '@ten24group/fw24/observability';

beforeEach(() => {
  setupTestObservability();
});

afterEach(() => {
  cleanupTestObservability();
});

test('captures audit event', async () => {
  await runWithContext(createObservationContext('test-123'), async () => {
    AuditObserver.entityCreate('User', 'user-1', { name: 'Test' });
  });
  
  assertEventCaptured(event => 
    event.type === 'audit.entity' && 
    event.entityId === 'user-1'
  );
});
```

---

## Production Checklist

- ✅ Configure observability table in Application
- ✅ Register config in DI layer
- ✅ Set appropriate sampling rates
- ✅ Enable data protection
- ✅ Configure TTL for automatic cleanup
- ✅ Set up CloudWatch/OTEL backends
- ✅ Test trace propagation across services
- ✅ Monitor DynamoDB WCU/RCU usage
- ✅ Set up alerts on error rates

---

## Performance

- **Latency Impact**: ~0ms (fire-and-forget capture)
- **Flush Time**: ~50-200ms (batched writes, happens after response)
- **DynamoDB Cost**: 96% savings with batch writes (25 items/batch)
- **CloudWatch Metrics**: FREE (EMF format)

---

## References

- [AWS ADOT Lambda](https://aws-otel.github.io/docs/getting-started/lambda/lambda-js)
- [AWS Powertools TypeScript](https://docs.aws.amazon.com/powertools/typescript/latest/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)

