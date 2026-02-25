# Advanced Entity Features Documentation

This document covers the advanced entity features available in FW24, including hierarchical data, many-to-many relationships, geospatial search, and advanced validation rules.

## Table of Contents
1. [Hierarchical Data (Trees)](#hierarchical-data-trees)
2. [Many-to-Many (M:N) Relationships](#many-to-many-mn-relationships)
3. [Geospatial Search](#geospatial-search)
4. [Advanced Validation Rules](#advanced-validation-rules)
5. [Dependency Tracking (Denormalization)](#dependency-tracking-denormalization)
6. [Schema Versioning & Evolution](#schema-versioning--evolution)
7. [Attribute Compression](#attribute-compression)
8. [Field Level Security (FLS)](#field-level-security-fls)

---

## Hierarchical Data (Trees)

FW24 supports managing tree-like structures (parent-child relationships) within a single entity using two primary strategies: **Path Enumeration** and **Ancestry (Closure Table)**.

### Configuration

Add a `tree` configuration to your entity's `model` and define the hierarchy in your attributes.

```typescript
export const CategorySchema = createEntitySchema({
  model: {
    entity: 'category',
    tree: {
      strategy: 'both', // 'path', 'ancestry', or 'both'
      parentAttribute: 'parentId',
      pathAttribute: '__path', // Default for path strategy
      depthAttribute: 'depth'   // Default for ancestry strategy
    }
  },
  attributes: {
    categoryId: { type: 'string', required: true, isIdentifier: true },
    name: { type: 'string', required: true },
    parentId: {
      type: 'string',
      relation: createEntityRelation<CategorySchema>({
        entityName: 'category',
        type: 'many-to-one',
        identifiers: { source: 'parentId', target: 'categoryId' }
      })
    }
  }
});
```

### Strategies
- **Path Enumeration (`path`)**: Stores the full path from root to the current node (e.g., `electronics/computers/laptops`). Best for breadcrumbs and finding all descendants via a prefix query.
- **Ancestry (`ancestry`)**: Uses a separate sidecar entity (e.g., `CategoryAncestry`) to store every ancestor-descendant pair. Best for deep graph traversals and finding ancestors efficiently.

### Service Methods
- `getAncestors(ids)`: Returns all parents up to the root.
- `getDescendants(ids)`: Returns all children and their children.

---

## Many-to-Many (M:N) Relationships

Many-to-Many relationships are handled via a declarative bridge pattern. FW24 automatically manages the bridge entity records.

### Configuration

```typescript
// In User Schema
groups: {
  type: 'list',
  items: { type: 'string' },
  relation: createManyToManyRelation<GroupSchema>({
    entityName: 'group',
    identifiers: { source: 'userId', target: 'groupId' },
    bridgeEntityName: 'UserGroup' // Optional, defaults to UserGroup
  })
}
```

### Bridge Schema Helper
Use `createManyToManyBridgeSchema` to quickly define the required sidecar entity:

```typescript
export const UserGroupSchema = createManyToManyBridgeSchema('user', 'group');
```

### Service Methods
- `attach({ relation, id, targetId, data })`: Creates a link in the bridge table.
- `detach({ relation, id, targetId })`: Removes a link.

---

## Geospatial Search

FW24 provides native spatial indexing and proximity search using geohashes.

### Configuration

1. Mark an attribute with `geo: true`.
2. Add a Geo index using the `createGeoIndex` helper.

```typescript
export const StoreSchema = createEntitySchema({
  model: { entity: 'store' },
  attributes: {
    storeId: { type: 'string', isIdentifier: true },
    location: { type: 'map', geo: true, required: true }, // { lat: number, lng: number }
  },
  indexes: {
    primary: { pk: { composite: ['storeId'] }, sk: { composite: [] } },
    spatial: createGeoIndex() // Automatically indexes the geohash
  }
});
```

### Service Methods
- `geoSearch({ attribute, center, radiusInMeters, filters })`: Returns entities within the specified radius, sorted by distance.

---

## Advanced Validation Rules

Beyond simple types, FW24 supports cross-attribute logic and conditional requirements.

### Cross-Attribute Logic
```typescript
attributes: {
  startDate: { type: 'string' },
  endDate: {
    type: 'string',
    validations: [
      { greaterThanField: 'startDate', message: 'End date must be after start date' }
    ]
  }
}
```

### Conditional Requirements (`requiredIf`)
```typescript
type: { type: 'string', items: ['standard', 'other'] },
reason: {
  type: 'string',
  validations: [
    {
      requiredIf: { field: 'type', value: 'other' },
      message: 'Reason is required for type "other"'
    }
  ]
}
```

---

## Dependency Tracking (Denormalization)

Automatically propagate data changes from one entity to another to keep denormalized views in sync.

```typescript
// In Team Schema
name: {
  type: 'string',
  dependencies: [
    {
      entityName: 'player',
      attributeName: 'teamName',
      mapping: { teamId: 'teamId' }
    }
  ]
}
```
When a team's name is updated, all associated players will have their `teamName` attribute updated automatically.

---

## Schema Versioning & Evolution

Gracefully handle data migrations without downtime or complex scripts.

```typescript
versioning: {
  version: '2',
  versionAttribute: '__v',
  transformers: {
    '1': (oldData) => ({
       ...oldData,
       fullName: `${oldData.firstName} ${oldData.lastName}`
    })
  }
}
```
Data is transformed on-the-fly when read and updated to the latest version when saved.

---

## Attribute Compression

Reduce DynamoDB storage costs and stay within the 400KB item limit by compressing large JSON or text fields.

```typescript
metadata: {
  type: 'map',
  compressed: true // Uses default 10KB threshold
},
history: {
  type: 'list',
  compressed: { threshold: 50 * 1024 } // Compress if > 50KB
}
```
Compression and decompression happen transparently in the service layer.

---

## Field Level Security (FLS)

Define granular read/write permissions at the attribute level using roles or conditions.

```typescript
salary: {
  type: 'number',
  permissions: {
    read: ['admin', 'hr'],
    write: { ref: 'isManagerOfRecord' } // Condition reference
  }
}
```
Attributes are automatically stripped from responses or blocked during writes based on the current actor's context.
