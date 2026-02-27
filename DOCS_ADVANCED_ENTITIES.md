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
- `move({ id, newParentId })`: Moves a record (and its entire sub-tree) to a new parent.

#### The `move` Operation
Moving a branch in a tree is notoriously difficult in DynamoDB. FW24 handles this automatically:
1. It updates the `parentId` of the target record.
2. If using `path` strategy, it performs a prefix query to find all descendants.
3. It recalculates the `__path` for every descendant based on the new parent's path.
4. It executes the updates in a single transaction to ensure consistency.

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
  - `relation`: The attribute name defining the M:N relationship.
  - `id`: The identifiers of the source entity.
  - `targetId`: The identifiers of the target entity.
  - `data`: (Optional) Extra attributes to store on the bridge record (e.g., `assignedAt`, `role`).
- `detach({ relation, id, targetId })`: Removes a link.

---

## Geospatial Search

FW24 provides native spatial indexing and proximity search using geohashes. Unlike standard DynamoDB scans, FW24 uses **Sort Key Prefixing** to query only the relevant "tiles" of the earth, making it extremely efficient even with millions of records.

### How it Works
1. **Precision Scaling**: When you perform a `geoSearch`, FW24 calculates the required geohash precision based on your radius.
2. **Neighbor Querying**: It queries the target geohash and its 8 neighbors to handle edge cases where a point is near the boundary of a geohash tile.
3. **SK Filtering**: The `__geohash` is stored in the **Sort Key**. FW24 uses the `begins_with` operator to find all points in a specific tile in a single efficient query.
4. **Distance Re-ranking**: Results from DynamoDB are deduplicated and then re-ranked in memory by their exact Haversine distance before being returned.

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

## Dependency Tracking (Denormalization - Subscription Model)

FW24 uses a **Subscription Model** to propagate data changes from one entity to another. This decouples the source entity from its consumers, allowing you to add new denormalized fields without modifying the source entity's schema.

### Configuration

Declare the dependency on the **Dependent** attribute using the `denormalize` property.

```typescript
// In Player Schema (the Dependent)
teamName: {
  type: 'string',
  denormalize: {
    sourceEntity: 'team',
    sourceAttribute: 'name',
    /**
     * How to find records in THIS entity to update.
     * player.teamId === team.teamId
     */
    matchBy: { teamId: 'teamId' },
    mode: 'async' // 'sync' or 'async' (default: 'async')
  }
}
```

When a `Team`'s `name` is updated, FW24 automatically identifies all `Player` records with a matching `teamId` and updates their `teamName` attribute.

### Key Benefits
- **Decoupling**: The `Team` schema doesn't need to know about `Player`, `Coach`, or `Fan` entities that might be denormalizing its name.
- **Maintainability**: Add or remove denormalized fields by simply updating the schema of the interested entity.
- **Reliability**: Future support for DynamoDB Streams will allow these updates to happen reliably in the background.

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
