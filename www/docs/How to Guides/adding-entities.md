---
sidebar_position: 3
---

# Entity Management

An entity symbolizes a unique business object. Unlike a traditional relational database that requires a separate table for each entity, a single DynamoDB table can accommodate countless entities.

## Defining Entity Schema

DynamoDB is schemaless, which means users are responsible for enforcing constraints, constructing indexes, and validating data. This is where the entity-schema becomes indispensable. The schema defines your entity's attributes, operations, access patterns, and more.
>Fw24 utilizes [ElectroDB](https://electrodb.dev/) internally. [Learn more](https://electrodb.dev/en/modeling/schema/)

### Sample Schema

```ts
{   
    // metadata about the entity
    model: {
        version: '1',
        // the name of the entity
        entity: 'user',             
        // used by auto generated UI
        entityNamePlural: 'Users', 
         // the operations that can be performed on the entity
        entityOperations: DefaultEntityOperations,
        // ElectroDB service name [for logical grouping of entities]
        service: 'users', 
    },  

    attributes: {
       userId: {
        type: 'string',
        required: true,  
        readOnly: true,
        default: () => randomUUID()
      },
     // ... 
    },    

   // the access patterns for the entity
    indexes: {
        primary: {
            pk: {
                field: 'primary_pk',    
                composite: ['userId'],
            }
        },
        // ...
    },        
} as const
```

## Incorporating a New Entity into Your Project

To add a new entity to your project execute the following command:

```shell
    cli24 add-dynamodb-entity book -t my-table -p books -ep bookName,authorName
```

> Note: Replace  `book` with the desired entity name, `books` with the desired plural form of the entity name, and `bookName,authorName` with the desired entity attributes.

This will add an entity `book.ts` in the `./src/entities/` directory, a service for this entity `book.ts` in the `./src/services/` directory, and a controller `book.ts` for this entity in the `./src/controller/` directory; This command creates a complete CRUD implementation out of the box.

### book entity

```ts
    import { randomUUID } from 'crypto';

    import {
        createEntitySchema,
        DefaultEntityOperations,
        EntityTypeFromSchema,
        EntityInputValidations,
        Narrow,
        TEntityOpsInputSchemas,
    } from '@ten24group/fw24';

    export const createBookSchema = () => createEntitySchema({
        model: {
            version: '1',
            entity: 'book',
            entityNamePlural: 'books',
            entityOperations: DefaultEntityOperations,
            service: 'books', 
        },
        attributes: {
            bookId: {
                type: 'string',
                required: true,
                readOnly: true,
                isIdentifier: true, // Used by the entity-listing-actions
                default: () => randomUUID()
            },
            bookName: {
                type: 'string', 
                required: true
            },
            authorName: {
                type: 'string', 
                required: true
            },
            
            createdAt: {
                // will be set once at the time of create
                type: "string",
                readOnly: true,
                required: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            updatedAt:{
                type: "string",
                watch: "*", // Will be set every time any prop is updated
                required: true,
                readOnly: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
        },
        indexes: {
            primary: {
                pk: {
                    field: 'pk',
                    composite: ['bookId'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                },
            },
        },

    } as const);

    export type BookSchemaType = ReturnType<typeof createBookSchema>
    export type BookEntityType = EntityTypeFromSchema<BookSchemaType>
    export type BookOpsInputSchemas = Narrow<TEntityOpsInputSchemas<BookSchemaType>>


    export const BookValidations: EntityInputValidations<BookSchemaType> = {
        bookId: [{
            required: true,
            operations: ['get', 'delete'],
        }],
    }
```

### Entity Services

This is where you write your business logic; the `BaseEntityService` provides default implementation for CRUD operations [get, create, update, list, delete, query] and some helpers like `getListingAttributeNames`,  `getSearchableAttributeNames` etc. You can override these and control what the list API return's, and what attributes are searched by default when the client passes sends a keyword-search `?search=awesome+book`.

```ts
    import { BaseEntityService } from '@ten24group/fw24';
    import { Dynamo } from '../db/[project-name].dynamo.client';
    import { Book } from '../entities/book';

    export class Service extends BaseEntityService<Book.BookSchemaType> {
        // your custom code goes here
    }

    export const factory = () => {
        console.log("called: bookService factory");
        const schema = Book.createBookSchema();
        return new Service(schema, Dynamo.DefaultEntityConfiguration);
    }
```

### Entity Controllers

This is where you write you create/override the API's for your entity the `BaseEntityController` provides default implementation for CRUD APIs [get, create, update, list, delete, query].

```ts
    import { Controller, defaultMetaContainer, BaseEntityController, ILogger, createLogger } from '@ten24group/fw24';
    import { Book } from '../entities/book';
    import { BookService } from '../services/book';

    @Controller('book', { resourceAccess: { tables: ['my-table'] } })
    export class BookController extends BaseEntityController<Book.BookSchemaType> {
        readonly logger: ILogger = createLogger('BookController');
        
        constructor() {
            super('book');
        }
        
        async initDI() {
            this.logger.debug('BookController.initDI');
            
            // register DI factories
            defaultMetaContainer.setEntityServiceByEntityName('book', BookService.factory);

            this.logger.debug('BookController.initDI - done');
            return Promise.resolve();
        }
    }

    export const handler = BookController.CreateHandler(BookController);
```
