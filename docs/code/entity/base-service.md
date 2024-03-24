# Documentation for base-service.ts

# BaseEntityService

The `BaseEntityService` class is an abstract class that provides a base implementation for interacting with entities using ElectroDB and CRUD operations. It contains methods for common CRUD operations such as creating, reading, updating, and deleting entities.

## Import Statements
```typescript
import { EntityConfiguration, Schema } from "electrodb";
import { CreateEntityItemTypeFromSchema, EntityIdentifiersTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, UpdateEntityItemTypeFromSchema, createElectroDBEntity } from "./base-entity";
import { createEntity, deleteEntity, getEntity, listEntity, updateEntity } from "./crud-service";
```

## Class Definition
```typescript
export abstract class BaseEntityService<S extends Schema<any, any, any>> {

    protected entityRepository?: EntityRepositoryTypeFromSchema<S>;

    constructor(
        protected readonly schema: S,
        protected readonly entityConfigurations: EntityConfiguration,
    ) {
        return this;
    }

    public getEntityName(): S['model']['entity'] { return this.schema.model.entity; }
    
    public getEntitySchema(): S { return this.schema; }

    public getRepository(){

        if(!this.entityRepository){
            const {entity} = createElectroDBEntity({ 
                schema: this.getEntitySchema(), 
                entityConfigurations: this.entityConfigurations 
            });
            this.entityRepository = entity as EntityRepositoryTypeFromSchema<S>;
        }

        return this.entityRepository!;
    }

    /**
     * Returns an object containing all the required attributes/values to fulfill an index.
     *
     * @param options - Object containing options for extracting entity identifiers.
     * @returns Object containing all the required attributes/values to fulfill an index.
     */
    abstract extractEntityIdentifiers(options: any ): EntityIdentifiersTypeFromSchema<S>;

    /**
     * Helper function to return all the attributes that can be used to find an entity.
     */
    abstract getFilterAttributes(): any;

    abstract getValidationRules( options: { opContext: 'update' | 'delete' | 'process' } ): any;

    abstract getPermissionRules( options: { opContext: 'update' | 'delete' | 'process' } ): any;

    public async get(identifiers: EntityIdentifiersTypeFromSchema<S>) {
        // Method implementation
    }
    
    public async create(data: CreateEntityItemTypeFromSchema<S>) {
        // Method implementation
    }

    public async list(data: EntityIdentifiersTypeFromSchema<S>) {
        // Method implementation
    }

    public async update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>) {
        // Method implementation
    }

    public async delete(identifiers: EntityIdentifiersTypeFromSchema<S>) {
        // Method implementation
    }
}
```

## Description
- The `BaseEntityService` class is an abstract class that provides a base implementation for service classes that interact with entities.
- It abstracts common CRUD operations such as creating, reading, updating, and deleting entities.
- It contains methods to get the entity name, schema, and repository.
- The class provides abstract methods for extracting entity identifiers, getting filter attributes, validation rules, and permission rules.
- It also contains asynchronous methods for CRUD operations (`get`, `create`, `list`, `update`, `delete`) that interact with the ElectroDB and CRUD service functions.

## Methods

### `getEntityName()`
- Returns the entity name from the schema.
- Returns: `S['model']['entity']`

### `getEntitySchema()`
- Returns the schema used by the service.
- Returns: `S`

### `getRepository()`
- Returns the entity repository if not already initialized.
- Initializes the entity repository using `createElectroDBEntity` function.
- Returns: `EntityRepositoryTypeFromSchema<S>`

### `extractEntityIdentifiers(options: any)`
- Abstract method for extracting entity identifiers.
- Returns an object containing required attributes/values to fulfill an index.

### `getFilterAttributes()`
- Abstract method to return attributes that can be used to find an entity.

### `getValidationRules(options: { opContext: 'update' | 'delete' | 'process' })`
- Abstract method to return validation rules based on the operation context.

### `getPermissionRules(options: { opContext: 'update' | 'delete' | 'process' })`
- Abstract method to return permission rules based on the operation context.

### `get(identifiers: EntityIdentifiersTypeFromSchema<S>)`
- Asynchronous method to retrieve an entity based on the identifiers.
- Calls `getEntity` function from `crud-service`.
- Returns the entity data.

### `create(data: CreateEntityItemTypeFromSchema<S>)`
- Asynchronous method to create a new entity with the provided data.
- Calls `createEntity` function from `crud-service`.
- Returns the created entity.

### `list(data: EntityIdentifiersTypeFromSchema<S>)`
- Asynchronous method to list entities based on the provided data.
- Calls `listEntity` function from `crud-service`.
- Returns a list of entities.

### `update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>)`
- Asynchronous method to update an entity with the provided data.
- Calls `updateEntity` function from `crud-service`.
- Returns the updated entity.

### `delete(identifiers: EntityIdentifiersTypeFromSchema<S>)`
- Asynchronous method to delete an entity based on the identifiers.
- Calls `deleteEntity` function from `crud-service`.
- Returns the deleted entity.

This class serves as a base for implementing services that encapsulate data access to entities in an ElectroDB system.