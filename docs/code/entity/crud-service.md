# Documentation for crud-service.ts

# Entity CRUD Operations Documentation
This documentation outlines the functionality and usage of the entity CRUD operations implemented in TypeScript.

## Components and Dependencies
The entity CRUD operations rely on the following components and dependencies:
- **Serializer/Formatter** - [Micro Transform](https://github.com/dkzlv/micro-transform)
- **Event Dispatcher** - [ts-event-dispatcher](https://github.com/FoxAndFly/ts-event-dispatcher/blob/master/src/index.ts), [ts-bus](https://github.com/ryardley/ts-bus), [tiny-typed-emitter](https://github.com/binier/tiny-typed-emitter/tree/master)
- **Router** - [tiny-request-router](https://github.com/berstend/tiny-request-router/blob/master/src/router.ts)
- **Dependency Injection (DI)** - [typed-inject](https://github.com/nicojs/typed-inject), [tsyringe](https://github.com/microsoft/tsyringe), [ioc](https://github.com/owja/ioc)

## Types and Constants
- **CRUD:** Defines the types of CRUD operations supported - 'create', 'get', 'update', 'delete', 'list'
- **BaseEntityCrudArgs:** Defines the base arguments for the entity CRUD operations, including entity name, service, CRUD type, logging level, actor, tenant, and various handlers for validation, authorization, logging, and event dispatching.
  
## Entity CRUD Operations

### `getEntity`
- **Description:** Retrieves an entity by its identifier.
- **Parameters:**
  - `options`: GetEntityArgs<S>
    - `id`: Entity identifier
    - Other base entity CRUD arguments like entityName, entityService, actor, tenant, etc.
- **Returns:** The retrieved entity.

### `createEntity`
- **Description:** Creates a new entity.
- **Parameters:**
  - `options`: CreateEntityArgs<S>
    - `data`: Data of the new entity
    - Other base entity CRUD arguments like entityName, entityService, actor, tenant, etc.
- **Returns:** The created entity.

### `listEntity`
- **Description:** Lists entities with optional filters and paging parameters.
- **Parameters:**
  - `options`: ListEntityArgs<S>
    - `filters`: Entity filters
    - Other base entity CRUD arguments like entityName, entityService, actor, tenant, etc.
- **Returns:** An array of entities that match the filters.

### `updateEntity`
- **Description:** Updates an existing entity with new data.
- **Parameters:**
  - `options`: UpdateEntityArgs<S>
    - `id`: Entity identifier
    - `data`: New data to update the entity
    - Other base entity CRUD arguments like entityName, entityService, actor, tenant, etc.
- **Returns:** The updated entity.

### `deleteEntity`
- **Description:** Deletes an entity by its identifier.
- **Parameters:**
  - `options`: DeleteEntityArgs<S>
    - `id`: Entity identifier
    - Other base entity CRUD arguments like entityName, entityService, actor, tenant, etc.
- **Returns:** The deleted entity.

### Additional Functionality
- **Event Handlers:** Before and after event dispatching for each CRUD operation.
- **Validation:** Validation of data before create and update operations.
- **Authorization:** Authorization checks before every CRUD operation.
- **Audit Logging:** Audit logging for all CRUD operations.

## Usage
To use the entity CRUD operations, create instances of the arguments interfaces (`GetEntityArgs`, `CreateEntityArgs`, etc.) with required parameters and call the respective CRUD method (`getEntity`, `createEntity`, etc.) with the options.

## Example
```typescript
const getEntityArgs: GetEntityArgs<YourSchema> = { id: entityId, entityName: 'YourEntity', ... };
const retrievedEntity = await getEntity(getEntityArgs);
```
  
This documentation provides an overview of the Entity CRUD operations and their usage in TypeScript. Please refer to the source code for detailed implementation and configurations.