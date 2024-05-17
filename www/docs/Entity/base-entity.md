# BaseEntity

## electroDB Entity Examples
This TypeScript code defines utilities for creating electroDB entities, defining types for electroDB entity components, and extracting types from schemas. Below are some links to examples of electroDB entities:
- [PlayerStorage.ts](https://github.com/nljms/ssia/blob/main/packages/database/storages/PlayerStorage.ts)
- [ratelimit.ts](https://github.com/tywalch/electro-demo/blob/main/netlify/functions/share/ratelimit.ts)
- [gist.github.com/tywalch](https://gist.github.com/tywalch/8040087e0fc886ca5f742aa99b623e1b)
- [Modeling Graph Relationships in DynamoDB](https://medium.com/developing-koan/modeling-graph-relationships-in-dynamodb-c06141612a70)
- [gist.github.com/severi](https://gist.github.com/severi/5d181a3e779f41a5e5fce1b7dcd17a89)
- [family-car-booking-backend](https://github.com/ikushlianski/family-car-booking-backend/blob/main/services/core/booking/booking.repository.ts)

## Types

### `CreateEntityOptions`
- `schema`: Represents the schema of the entity.
- `entityConfigurations`: Represents the configuration for the entity.

### `createElectroDBEntity`
This function creates an electroDB entity with the provided `schema` and `entityConfigurations`.

### Typing Utilities
- `EntityTypeFromSchema<TSchema>`: Infers the entity type from a given schema.
- `EntityServiceTypeFromSchema<TSchema>`: Denotes the entity service type derived from a schema.
- `EntityIdentifiersTypeFromSchema<TSchema>`: Represents the entity identifiers type from a schema.
- `CreateEntityItemTypeFromSchema<TSchema>`: Represents the type for creating an entity item from a schema.
- `UpdateEntityItemTypeFromSchema<TSchema>`: Represents the type for updating an entity item from a schema. 

## Example Usage
```ts
import { Entity, EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem } from "electrodb";
import { BaseEntityService } from "./base-service";

// Define schema and configurations
const schema = new Schema({...});
const entityConfigurations = new EntityConfiguration({...});

// Create electroDB entity
const entityOptions = createElectroDBEntity({
    schema,
    entityConfigurations
});

// Access entity properties
const { name, entity, schema, symbol } = entityOptions;

// Use typing utilities
type EntityItem = CreateEntityItemTypeFromSchema<typeof schema>;
type UpdateItem = UpdateEntityItemTypeFromSchema<typeof schema>;
type Service = EntityServiceTypeFromSchema<typeof schema>;
type Identifiers = EntityIdentifiersTypeFromSchema<typeof schema>;
```

This code snippet showcases the creation of electroDB entities and the usage of typing utilities for working with schema entities.