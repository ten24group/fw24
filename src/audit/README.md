# FW24 Audit System

A serverless audit logging system for FW24 framework applications. Provides automatic audit trail capture for API controllers, queue processors, and scheduled tasks.

## 🎯 Design Principles

- **Non-blocking**: Audit failures don't break business logic
- **Configurable**: Enable/disable per controller with fine-grained control  
- **Sampling**: Reduce overhead in high-traffic scenarios
- **Correlation**: Track requests across service boundaries
- **Performance**: Minimal impact on Lambda execution
****
## 🏗️ Architecture

```mermaid
graph TB
    subgraph "Controllers"
        API[APIController]
        Queue[QueueController] 
        Task[TaskController]
    end
    
    subgraph "Audit Core"
        Capture[AuditCaptureService]
        Helper[captureLog/captureError]
        Factory[AuditLoggerFactory]
    end
    
    subgraph "Loggers"
        DDB[DynamoDB Logger]
        CW[CloudWatch Logger]
        Console[Console Logger]
        Dummy[Dummy Logger]
    end
    
    API --> Capture
    Queue --> Capture
    Task --> Capture
    
    Capture --> Helper
    Helper --> Factory
    
    Factory --> DDB
    Factory --> CW
    Factory --> Console
    Factory --> Dummy
```

## 📊 Data Model

```typescript
interface AuditEntry {
  // Core fields
  auditId?: string;                    // Auto-generated UUID
  timestamp?: string;                  // ISO timestamp
  timestampMs?: number;               // Unix timestamp for sorting
  
  // Classification
  logType?: 'audit' | 'log' | 'event' | 'metric';
  subType?: string;                   // api_request, payment_processed, etc.
  severity?: 'info' | 'warn' | 'error' | 'critical';
  category?: string;                  // business, security, performance
  
  // Entity tracking
  entityName?: string;                // user, payment, order
  entityId?: string;                  // Specific entity ID
  eventType?: string;                 // create, update, delete, login
  operation?: string;                 // Alias for eventType
  
  // Context & tracking
  correlationId?: string;             // Request chain tracking
  actor?: Actor;                      // Who performed the action
  status?: string;                    // completed, failed, pending
  success?: boolean;                  // Operation success flag
  
  // Flexible data
  data?: any;                         // Main payload
  metadata?: any;                     // Additional context
  context?: any;                      // Request/response context
  metrics?: Record<string, any>;      // Performance/business metrics
}
```

### DynamoDB Indexes

```mermaid
graph LR
    subgraph "Table: audit-logs"
        PK[PK: auditId]
    end
    
    subgraph "GSI1: Entity Queries"
        G1PK[PK: entityName]
        G1SK[SK: timestampMs]
    end
    
    subgraph "GSI2: Type Queries" 
        G2PK[PK: logType]
        G2SK[SK: timestampMs]
    end
    
    subgraph "GSI3: Chronological"
        G3PK[PK: auditType='audit']
        G3SK[SK: timestampMs ↓]
    end
    
    subgraph "GSI4: Request Tracing"
        G4PK[PK: correlationId]
        G4SK[SK: timestampMs]
    end
```

## ⚙️ Configuration

### API Controller
```typescript
@Controller('/users', {
  audit: {
    enabled: true,
    category: 'user_management',
    samplingFn: createHashBasedSampling(0.1),
    includes: {
      request: ['headers', 'body'],
      response: ['headers']
    },
    skipStart: false,
    skipEnd: false,
    skipErrors: false,
    customContext: { team: 'backend' }
  }
})
export class UserController extends APIController { 
  
  @Get('/profile')
  getProfile() {
    // Uses controller-level audit config
    return { profile: 'data' };
  }

  @Post('/login', {
    audit: {
      category: 'authentication',
      includes: {
        request: ['headers', 'body'],
        response: ['headers'] // No response body for security
      },
      dataProtection: {
        deepRedact: {
          blacklistedKeys: ['password', 'token'],
          replacement: '[SECURITY-REDACTED]'
        }
      }
    }
  })
  login() {
    // Method-level config overrides/enhances controller config
    return { token: 'jwt-token' };
  }

  @Get('/sensitive-data', {
    audit: {
      enabled: false // Completely disable audit for this endpoint
    }
  })
  getSensitiveData() {
    // No audit logs will be generated
    return { sensitiveData: 'classified' };
  }
}
```

### Queue Controller
```typescript
@Queue('user-notifications', {
  audit: {
    enabled: true,
    category: 'notifications',
    samplingFn: createHashBasedSampling(0.05)
  }
})
export class NotificationQueueController extends QueueController { }
```

### Task Controller
```typescript
@Task('daily-cleanup', {
  schedule: 'cron(0 2 * * ? *)',
  audit: {
    enabled: true,
    category: 'maintenance',
    skipStart: true
  }
})
export class CleanupTaskController extends TaskController { }
```

### Environment Variables
```bash
AUDIT_ENABLED=true
AUDIT_TYPE=dynamodb
AUDIT_TABLE_NAME=my-app-audit-logs
```

## 🔧 Usage

### Manual Logging
```typescript
import { captureLog, captureError } from '@ten24group/fw24/audit';

// Log business event
await captureLog({
  logType: 'event',
  subType: 'payment_processed',
  entityName: 'payment',
  entityId: 'pay_123',
  operation: 'create',
  status: 'completed',
  metrics: {
    duration: 1200,
    amount: 150000
  }
});

// Log error
await captureError(new Error('Payment failed'), {
  entityName: 'payment',
  entityId: 'pay_123'
});
```

### Automatic Controller Auditing
Controllers automatically capture:
- **Start events**: When processing begins
- **End events**: When processing completes
- **Error events**: When errors occur

```typescript
@Controller('/payments', {
  audit: { enabled: true, category: 'financial' }
})
export class PaymentController extends APIController {
  async createPayment(request: Request): Promise<Response> {
    // Start event automatically captured
    
    const payment = await this.paymentService.create(request.body);
    
    // Optional manual business event
    await captureLog({
      logType: 'event',
      subType: 'payment_created',
      entityName: 'payment',
      entityId: payment.id
    });
    
    return { payment };
    // End event automatically captured
  }
}
```

## 🔒 Data Protection

The audit system includes automatic data redaction to protect sensitive information in logs.

### Default Protection
Automatically redacts common sensitive fields:
```typescript
// These fields are redacted by default:
const sensitiveFields = [
  'password', 'secret', 'privateKey', 'authorization', 'token',
  'accessToken', 'refreshToken', 'apiKey', 'clientSecret',
  'creditCard', 'cardNumber', 'ssn', 'bankAccount', 'routingNumber', 'cvv',
  'cookie', 'email', 'set-cookie'
];
```

### Configuration
```typescript
@Controller('/users', {
  audit: {
    enabled: true,
    dataProtection: {
      enabled: true,  // Default: true
      deepRedact: {
        blacklistedKeys: ['password', 'secret', 'apiKey'], // Custom sensitive fields
        caseSensitiveKeyMatch: false,  // Default: false
        replacement: '[REDACTED]'      // Default: '[REDACTED]'
      }
    }
  }
})
export class UserController extends APIController { }
```

### Custom Protection Function
```typescript
@Controller('/payments', {
  audit: {
    enabled: true,
    dataProtection: {
      customProtectionFn: (auditEntry, config) => {
        // Custom business logic for data protection
        if (auditEntry.data?.paymentMethod) {
          auditEntry.data.paymentMethod = {
            type: auditEntry.data.paymentMethod.type,
            last4: '****'  // Keep only safe fields
          };
        }
        return auditEntry;
      }
    }
  }
})
export class PaymentController extends APIController { }
```

### Protected Audit Example
```typescript
// Before protection:
{
  "data": {
    "user": {
      "email": "user@example.com",
      "password": "mySecretPassword",
      "profile": { "name": "John Doe" }
    },
    "headers": {
      "authorization": "Bearer abc123",
      "cookie": "session=xyz789"
    }
  }
}

// After protection:
{
  "data": {
    "user": {
      "email": "[REDACTED]",
      "password": "[REDACTED]",
      "profile": { "name": "John Doe" }
    },
    "headers": {
      "authorization": "[REDACTED]",
      "cookie": "[REDACTED]"
    }
  }
}
```

### Manual Data Protection
```typescript
import { protectAuditData } from '@ten24group/fw24/audit';

// Protect sensitive data manually
const auditEntry = {
  data: {
    user: {
      email: 'user@example.com',
      password: 'secret123',
      profile: { name: 'John Doe' }
    }
  }
};

const protectedEntry = protectAuditData(auditEntry, {
  enabled: true,
  deepRedact: {
    blacklistedKeys: ['password', 'email', 'creditCard'],
    replacement: '[PROTECTED]'
  }
});

// Result: { data: { user: { email: '[PROTECTED]', password: '[PROTECTED]', profile: { name: 'John Doe' } } } }
```

### Best Practices
- **Always enabled**: Data protection is enabled by default
- **Custom fields**: Add business-specific sensitive fields to `blacklistedKeys`
- **Custom functions**: Use for complex redaction logic beyond simple field matching
- **Test thoroughly**: Verify your protection rules work as expected
- **Manual protection**: Use `protectAuditData()` for non-audit data that needs protection

## 🎯 Audit Strategies

### Single vs Separate Entry Strategies

```typescript
// Default: Separate entries (start + end + error)
@Controller('/api', {
  audit: {
    enabled: true,
    strategy: 'separate' // Creates multiple audit entries per operation
  }
})

// Single comprehensive entry (more efficient)
@Controller('/api', {
  audit: {
    enabled: true,
    strategy: 'single' // Creates one audit entry with all data
  }
})
```

**Separate Strategy (Default):**
- Creates `api_request_start` entry when operation begins
- Creates `api_request_complete` or `api_request_error` entry when operation ends
- Better for real-time monitoring
- More audit entries in database

**Single Strategy:**
- Creates only one `api_request` entry when operation completes
- Contains comprehensive data: request, response, timing, errors
- More efficient storage and querying
- Better for high-volume APIs

### Single Strategy Data Structure

```typescript
{
  "subType": "api_request",
  "eventType": "completed", // or "failed"
  "success": true,
  "data": {
    "request": {
      "method": "POST",
      "path": "/api/users",
      "headers": {...},
      "body": {...}
    },
    "response": {
      "statusCode": 201,
      "headers": {...},
      "body": {...}
    },
    "timing": {
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-01-01T00:00:01.234Z", 
      "duration": 1234
    },
    "error": { // Only if operation failed
      "name": "ValidationError",
      "message": "Invalid input"
    }
  }
}
```

## 🎯 Selective Field Auditing

Control exactly which fields are included in audit logs for fine-grained privacy and performance control.

### Basic vs Selective Includes

```typescript
// Legacy: All-or-nothing approach
@Controller('/api', {
  audit: {
    enabled: true,
    includes: {
      request: ['headers', 'body', 'query'],   // Include entire objects
      response: ['headers', 'body']
    }
  }
})

// New: Selective field-level control
@Controller('/api', {
  audit: {
    enabled: true,
    includes: {
      request: {
        headers: ['content-type', 'user-agent'],    // Only specific headers
        body: ['email', 'name'],                    // Only specific body fields
        query: ['page', 'limit']                    // Only specific query params
      },
      response: {
        headers: ['content-type', 'x-response-time'],
        body: ['id', 'status', 'message']          // Only specific response fields
      }
    }
  }
})
```

### Security & Privacy Benefits

**Exclude Sensitive Data:**
```typescript
@Controller('/api/auth', {
  audit: {
    enabled: true,
    includes: {
      request: {
        headers: ['user-agent', 'content-type'],  // Skip authorization header
        body: ['email', 'username']               // Skip password field
      },
      response: {
        body: ['success', 'message', 'userId']    // Skip access tokens
      }
    }
  }
})
```

**Performance Optimization:**
```typescript
@Controller('/api/reports', {
  audit: {
    enabled: true,
    includes: {
      request: {
        query: ['reportId', 'format']             // Skip large filter objects
      },
      response: {
        headers: ['content-type'],                // Skip large response bodies
        body: ['id', 'status', 'downloadUrl']
      }
    }
  }
})
```

### Backward Compatibility

All existing audit configurations continue to work unchanged:

```typescript
// These all still work exactly as before
includes: { request: ['headers', 'body'] }        // Legacy array format
includes: { request: true }                       // Boolean format
includes: { request: ['headers'], response: true } // Mixed formats
```

### Configuration Options

**Request Includes:**
- `headers: string[]` - Specific header names to include
- `body: string[]` - Specific body field names to include  
- `query: string[]` - Specific query parameter names to include

**Response Includes:**
- `headers: string[]` - Specific response header names to include
- `body: string[]` - Specific response body field names to include

**Empty Arrays:**
```typescript
includes: {
  request: {
    headers: [],  // Empty array = include all headers
    body: []      // Empty array = include all body fields
  }
}
```

### Real-World Examples

**Healthcare API (HIPAA Compliance):**
```typescript
@Controller('/api/patients', {
  audit: {
    enabled: true,
    includes: {
      request: {
        headers: ['content-type', 'user-agent'],
        body: ['patientId', 'visitType']          // Exclude medical details
      },
      response: {
        body: ['appointmentId', 'status']         // Exclude patient data
      }
    }
  }
})
```

**Payment API (PCI DSS Compliance):**
```typescript
@Controller('/api/payments', {
  audit: {
    enabled: true,
    includes: {
      request: {
        headers: ['content-type'],
        body: ['amount', 'currency', 'orderId']   // Exclude card numbers
      },
      response: {
        body: ['transactionId', 'status']         // Exclude payment details
      }
    }
  }
})
```

**High-Volume Analytics API:**
```typescript
@Controller('/api/analytics', {
  audit: {
    enabled: true,
    includes: {
      request: {
        query: ['metric', 'dateRange']            // Skip large data payloads
      },
      response: {
        headers: ['content-type'],                // Skip large result sets
        body: ['queryId', 'recordCount']
      }
    }
  }
})
```

## 🎯 Method-Level Audit Configuration

Override or enhance controller-level audit settings on individual routes for fine-grained control.

### How Method-Level Config Works

```typescript
@Controller('/api', {
  audit: {
    enabled: true,
    category: 'general-api',
    includes: { request: ['headers'] }
  }
})
export class ApiController extends APIController {
  
  @Get('/public-data')
  getPublicData() {
    // Uses controller config: category='general-api', includes=['headers']
  }
  
  @Post('/secure-action', {
    audit: {
      category: 'security',           // Overrides controller category
      includes: {
        request: ['headers', 'body'], // Enhances controller includes
        response: ['headers']
      },
      dataProtection: {
        deepRedact: {
          blacklistedKeys: ['apiKey', 'secret'] // Adds to controller blacklist
        }
      }
    }
  })
  secureAction() {
    // Final config: category='security', includes merged, blacklist combined
  }
  
  @Get('/internal', {
    audit: { enabled: false }        // Completely disables audit for this route
  })
  internalEndpoint() {
    // No audit logs generated
  }
}
```

### Configuration Merging Rules

1. **Method config takes precedence** over controller config
2. **Arrays are merged and deduplicated** (e.g., `blacklistedKeys`, `includes.request`)
3. **Objects are deep merged** with method values overriding controller values
4. **Disabled audit** (`enabled: false`) stops all logging for that route

### Common Use Cases

**High-Security Endpoints:**
```typescript
@Post('/auth/login', {
  audit: {
    category: 'authentication',
    samplingFn: createAlwaysSample(), // Never sample auth events
    dataProtection: {
      deepRedact: {
        blacklistedKeys: ['password', 'mfa', 'recoveryCode'],
        replacement: '[AUTH-REDACTED]'
      }
    }
  }
})
```

**Performance-Critical Endpoints:**
```typescript
@Get('/health', {
  audit: {
    enabled: false // No audit overhead for health checks
  }
})
```

**Debug/Development Endpoints:**
```typescript
@Post('/debug/test', {
  audit: {
    category: 'debug',
    includes: {
      request: ['headers', 'body', 'query'],
      response: ['headers', 'body'] // Include everything for debugging
    },
    customContext: {
      environment: 'development',
      debug: true
    }
  }
})
```

## 🎛️ Sampling

```typescript
// Hash-based (deterministic)
samplingFn: createHashBasedSampling(0.1)  // 10%

// Random sampling  
samplingFn: createRandomSampling(0.05)    // 5%

// Custom logic
samplingFn: (correlationId: string, operation: string) => {
  return operation.includes('error') || Math.random() < 0.01;
}

// Always/never
samplingFn: createAlwaysSample()   // Debug mode
samplingFn: createNeverSample()    // Disable
```

## 🔍 Querying

### Using Audit Service
```typescript
import { DynamoDBAuditEntityService } from '@ten24group/fw24/audit';

const auditService = new DynamoDBAuditEntityService();

// Latest audits (uses GSI3, descending by timestampMs)
const latestAudits = await auditService.list();

// Find by entity (uses GSI1)
const userAudits = await auditService.query('gsi1')
  .where(({ entityName }, { eq }) => eq(entityName, 'user'))
  .go();

// Find by correlation ID (uses GSI4)  
const requestTrace = await auditService.query('gsi4')
  .where(({ correlationId }, { eq }) => eq(correlationId, 'req-123'))
  .go();

// Find by log type (uses GSI2)
const events = await auditService.query('gsi2')
  .where(({ logType }, { eq }) => eq(logType, 'event'))
  .go();
```

## 📋 API Reference

### Core Functions
- `captureLog(options)`: Manual audit logging
- `captureError(error, options)`: Error logging with context
- `AuditCaptureService.captureStart()`: Operation start (automatic)
- `AuditCaptureService.captureEnd()`: Operation end (automatic)

### Data Protection Functions
- `protectAuditData(auditEntry, config)`: Apply data protection to audit entries
- `DataProtectionConfig`: Configuration interface for data redaction
- `DeepRedactConfig`: Deep redact library configuration options

### Sampling Functions
- `createHashBasedSampling(rate)`: Deterministic sampling
- `createRandomSampling(rate)`: Random sampling
- `createAlwaysSample()`: Always log (debug)
- `createNeverSample()`: Never log (disable)

### Interfaces
```typescript
interface DataProtectionConfig {
  enabled?: boolean;
  deepRedact?: DeepRedactConfig;
  customProtectionFn?: (auditEntry: AuditEntry, config: DataProtectionConfig) => AuditEntry;
}

interface DeepRedactConfig {
  blacklistedKeys?: string[];
  caseSensitiveKeyMatch?: boolean;
  remove?: boolean;
  replacement?: string;
}
```
