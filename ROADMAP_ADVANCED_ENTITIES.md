# Roadmap: Next-Level Advanced Entity Enhancements

Following the successful implementation of the core foundation for Trees, M:N relations, Geo data, and Subscriptions, this document outlines the next level of features to be baked into the FW24 entity layer.

## 1. Relational Aggregates (Rollups)
Enable automatic maintenance of summary data from related entities.
- **Declarative Counters**: `postCount: { type: 'number', rollup: { relation: 'posts', type: 'count' } }`.
- **Sum/Avg Rollups**: Automatically maintain `totalOrderValue` on a `Customer` entity by summing `Order` totals.
- **Implementation**: Leverage the `EntityDependencyManager` to listen for lifecycle events (`afterCreate`, `afterDelete`) and increment/decrement counters atomically using DynamoDB's `ADD` operation.

## 2. Advanced Hierarchy Operations
Enhance Tree management for complex organizational structures.
- **Atomic Subtree Move**: A service method to move a node and all its descendants to a new parent in a single transaction, correctly updating all materialized paths and ancestry links.
- **Recursive Hydration Controls**: Fine-grained control over how many levels of a tree are hydrated in a single query.
- **Tree Integrity Guards**: Prevent circular references in tree structures (e.g., making a child the parent of its own ancestor).

## 3. Computed Attributes & Virtual Fields
Support fields derived from other attributes or external data.
- **Sync Computed Fields**: `fullName: { type: 'string', computed: ['firstName', 'lastName'], template: '{firstName} {lastName}' }`.
- **Searchable Computed Fields**: Automatically propagate computed values to the search engine (MeiliSearch) for keyword search and filtering.
- **Virtual Fields**: Fields that only exist in the application layer (not persisted) but are populated during hydration.

## 4. Enhanced Geospatial Capabilities
Move beyond simple point-proximity searches.
- **Bounding Box & Polygon Filters**: Efficient spatial queries for areas and shapes.
- **Geo-Clustering API**: Optimized endpoints for map views that return clustered data points for high-density areas.
- **Spatial Joins**: Finding entities within a radius of *another* entity (e.g., "Find all Stores within 5km of this Customer").

## 5. Reliability via Change Data Capture (CDC)
Offload heavy propagation tasks from the main request cycle.
- **DynamoDB Streams Integration**: Automatically route `async` subscriptions and rollups through DynamoDB Streams and Lambda triggers.
- **Outbox Pattern Support**: Ensure that event emission and database updates are truly atomic, providing 100% reliability for cross-entity data synchronization.

## 6. Advanced Relational Navigation
- **Graph Traversal Helpers**: Simplified API for navigating complex relationships (e.g., `user.get('friends.friends')`).
- **Inverse Relationship Auto-discovery**: Automatically generate the "many" side of a relationship when the "one" side is defined.
- **Conditional Hydration**: Only hydrate relations if certain conditions are met (e.g., based on actor roles).

## 7. Versioned Drafts & Publishing
- **Staging Layer**: Built-in support for "Draft" vs "Published" versions of the same record.
- **Review Workflows**: Integrated state machine transitions for content approval before it becomes visible to standard `list`/`get` operations.
