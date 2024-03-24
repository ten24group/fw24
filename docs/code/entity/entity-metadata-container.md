# Documentation for entity-metadata-container.ts

# MetadataContainer Class

The `MetadataContainer` class is used to manage entity services and cache them for efficient retrieval.

### Properties

- `entityServices`: A `Map` that stores entity names as keys and `ServiceOrFactory` objects as values.
- `entityServicesCache`: A `Map` that stores entity names as keys and `BaseEntityService` objects as values.

### Methods

#### `getEntityServiceByEntityName<Srv extends BaseEntityService<any>>(entityName: string): Srv`

- Retrieves an entity service by entity name.
- Returns the entity service if found in cache, otherwise creates the service using the factory function.
- Parameters:
  - `entityName`: The name of the entity for which the service is requested.
- Returns:
  - The entity service of type `Srv`.

#### `hasEntityServiceByEntityName(entityName: string): boolean`

- Checks if an entity service exists for a given entity name.
- Parameters:
  - `entityName`: The name of the entity to check.
- Returns:
  - `true` if the entity service exists, `false` otherwise.

#### `setEntityServiceByEntityName<S extends ServiceOrFactory<any>>(entityName: string, service: S): void`

- Sets an entity service for a given entity name.
- Parameters:
  - `entityName`: The name of the entity for which the service is being set.
  - `service`: The entity service or factory function to be set.

### Types

- `Returns<T>`: A function type that returns a value of type `T`.
- `ServiceOrFactory<Srv extends BaseEntityService<any>>`: Union type representing either an instance of `BaseEntityService` or a function that returns `BaseEntityService`.

### Usage

```typescript
import { BaseEntityService } from "./base-service";

// Define MetadataContainer instance
export const defaultMetaContainer = new MetadataContainer();

// Example usage
defaultMetaContainer.setEntityServiceByEntityName("entity1", new Entity1Service());
const entityService = defaultMetaContainer.getEntityServiceByEntityName<Entity1Service>("entity1");
```

In summary, the `MetadataContainer` class provides methods to manage and cache entity services based on entity names. It offers ways to retrieve, check for existence, and set entity services efficiently.