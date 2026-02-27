# Brainstorming: The Evolution of the FW24 Data Layer

This document outlines the next generation of data-centric features for the FW24 framework. These proposals focus strictly on enhancing the **Entity/Data Layer**, providing advanced architectural primitives that solve complex DynamoDB patterns out-of-the-box.

---

## 1. Distributed Aggregate Rollups (Real-time Counters/Sums)

### **The Value**
Currently, calculating an aggregate (e.g., `totalOrderAmount` on a Customer or `playerCount` on a Team) requires performing a `list` or `query` operation and summing the values in memory. As data scales, this becomes slow and expensive. A Rollup makes this a simple O(1) `get` on the parent entity.

### **Implementation Proposal**
Extend the `denormalize` attribute property to support aggregate functions.

```typescript
// In Customer Schema
totalOrdersAmount: {
  type: 'number',
  rollup: {
    sourceEntity: 'order',
    sourceAttribute: 'totalPrice',
    matchBy: { customerId: 'customerId' },
    operation: 'sum', // 'sum', 'count', 'min', 'max', 'average'
    mode: 'async' // or 'sync' using TRANS_WRITE
  }
}
```

**Mechanism:** When an `Order` is saved, the `OrderService` emits an internal event. The `CustomerService` (the subscriber) receives it. It calculates the *delta* (NewValue - OldValue) and performs an atomic `update` (using DynamoDB `ADD` operation) on the Customer record.

### **Pros/Cons**
| Pros | Cons |
| :--- | :--- |
| **Instant Reads**: Dashboard stats are pre-calculated. | **Eventual Consistency**: If async, the total might lag by milliseconds. |
| **Efficient**: No expensive scans or large queries. | **Write Overhead**: Every child write triggers a parent update. |

### **Alternates**
- **Compute-on-read**: Only viable for small datasets.
- **MeiliSearch Facets**: Great for UI, but unavailable to backend business logic (e.g., "Don't allow order if customer has > $10k debt").

---

## 2. Temporal Entity Snapshots ("Time-Travel")

### **The Value**
Provides the ability to query an entity's state at any specific point in history. Essential for auditing, data recovery, and "Record Comparison" UIs.

### **Implementation Proposal**
Add a `temporal: true` flag to the entity schema.

```typescript
export const ContractSchema = createEntitySchema({
  model: {
    entity: 'contract',
    temporal: {
      strategy: 'snapshot-delta',
      retentionDays: 365
    }
  },
  // ...
});

// API Usage:
const oldContract = await contractService.getAt(contractId, '2023-01-01T12:00:00Z');
```

**Mechanism:**
1. The framework uses the existing `ObservabilityLog` as the source of truth.
2. Every change triggers a log entry with the delta.
3. Every *N* changes, a full snapshot is stored.
4. `getAt` finds the nearest snapshot before the target timestamp and "replays" the deltas to reconstruct the state.

### **Pros/Cons**
| Pros | Cons |
| :--- | :--- |
| **Full Traceability**: See exactly what changed and when. | **Storage Cost**: Storing snapshots and logs increases S3/Dynamo usage. |
| **Native Audit UI**: Visual "Diff" view between any two dates. | **Reconstruction Latency**: Replaying many deltas can be slow for "hot" records. |

### **Alternates**
- **Full Event Sourcing**: Much more complex to implement and maintain.
- **Manual History Tables**: Requires significant boilerplate code for every entity.

---

## 3. Graph-lite Path Traversal

### **The Value**
Simplifies complex relational queries like "Find all permissions for all groups this user belongs to" into a single service call, avoiding "Waterfall" code and manual ID mapping.

### **Implementation Proposal**
Introduce a `traverse` API that navigates relationships using existing metadata.

```typescript
// Fetch all permissions across all groups for a user
const permissions = await userService.traverse(userId, [
  'memberships', // Many-to-many to Group
  'group',       // One-to-one link
  'permissions'  // One-to-many to Permission entity
]);
```

**Mechanism:**
The framework traverses the path step-by-step. At each hop, it uses the `relation` metadata to:
1. Extract IDs from the current result set.
2. Perform a `batchGet` or `query` on the next entity.
3. Deduplicate results before moving to the next hop.

### **Pros/Cons**
| Pros | Cons |
| :--- | :--- |
| **Zero Boilerplate**: No manual loops or `Promise.all` batches. | **Result Set Explosion**: A single root could lead to thousands of leaf nodes. |
| **Performance**: Automatically uses `batchGet` for efficiency. | **Read Consistency**: Hops are performed sequentially, not in a single transaction. |

### **Alternates**
- **GraphQL**: Requires a separate layer and resolver maintenance.
- **AppSync**: Powerful, but ties the architecture strictly to AWS AppSync.

---

## 4. Declarative Hierarchical Integrity

### **The Value**
Moving a branch (implemented in the foundation) is only half the battle. Real-world trees need constraints to prevent data corruption and maintain business rules.

### **Implementation Proposal**
Add declarative constraints to the `tree` configuration.

```typescript
tree: {
  strategy: 'path',
  constraints: {
    maxDepth: 5,
    preventCycles: true,
    uniqueSiblingNames: 'name', // Ensure no two children of same parent have same name
    onDelete: 'restrict' // already in relations, but unified here
  }
}
```

**Mechanism:**
- **Cycle Prevention**: During `create` or `move`, the framework checks if the `newParentId` exists in the record's own `getDescendants()` list.
- **Unique Siblings**: Uses a DynamoDB `conditionExpression` during write to check if another record exists with `parentId == X` and `name == Y`.

### **Pros/Cons**
| Pros | Cons |
| :--- | :--- |
| **Robust Trees**: Prevents "infinite loops" and "orphaned branches". | **Performance**: Depth checks and cycle detection require extra reads before writes. |
| **Clean Data**: Enforces logical naming (like a filesystem). | |

### **Alternates**
- **Manual Guards**: Writing custom service methods for every tree-like entity.
- **Relational DB (RDS)**: Recursive CTEs are native in SQL, but this brings DynamoDB closer to that power without the management overhead.
