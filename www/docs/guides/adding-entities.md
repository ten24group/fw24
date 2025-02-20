---
sidebar_position: 3
---

# Entity Management

An entity symbolizes a unique business object. Unlike a traditional relational database that requires a separate table for each entity, a single DynamoDB table can accommodate countless entities.

## Entity Schema

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
    import { BaseEntityService, defaultMetaContainer } from '@ten24group/fw24';
    import { Dynamo } from '../db/[project-name].dynamo.client';
    import { Book } from '../entities/book';

    export class Service extends BaseEntityService<Book.BookSchemaType> {
        // your custom code goes here
        async businessFuncOne(){

            // make sure user service is registered in the container before calling this logic.
            // the standard code to do that would be in the `initDI()` function of your controller.
            const userService = defaultMetaContainer.getServiceByEntityName('user');

            const user = await userService.get({'userId': 'aaa-bbb--ccc'});

            // do something with the user 

        }
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
    import { Controller, defaultMetaContainer, BaseEntityController, ILogger } from '@ten24group/fw24';
    import { Book } from '../entities/book';
    import { BookService } from '../services/book';

    @Controller('book', { resourceAccess: { tables: ['my-table'] } })
    export class BookController extends BaseEntityController<Book.BookSchemaType> {
        
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

### Entity APIs

The `BaseEntityController` provides a set of pre-defined API endpoints for performing CRUD operations on an entity.

- `GET /:entity/:id` - to get an entity by it's Identifiers.
- `POST /:entity` - to create a new entity.
- `PUT /:entity/:id` - to update a specific entity by its Identifiers.
- `DELETE /:entity/:id` - to delete a specific entity by its Identifiers.
- `GET /:entity`  - to retrieve a list of entities, supports pagination, filtering and term-search.
- `POST /:entity/query` - to fetch a list of entity using advance filters; supports pagination, term-search.

### Examples of Entity APIs

#### Creating a New Book (`POST /book`)

To create a new book, make a `POST` request to the `/books` endpoint.

- Request

    ```shell
    curl -X POST 'https://<api-url>/books' \
    -H 'Content-Type: application/json' \
    -d '{
    "title": "New Book Title",
    "author": "New Book Author",
    "publishedDate": "2022-01-01"
    }'
    ```

- Response

    ```json
    {
        book: {
            title: 'New Book Title',
            author: 'New Book Author',
            publishedDate: '2022-01-01',
            // ... other attributes of the book
        },
        message: 'Created successfully',
    }
    ```

#### Retrieving a Book by Identifier (`GET /book/:bookIdentifier`)

To retrieve a book by its identifier, make a `GET` request to the `/books/:bookIdentifier` endpoint.

- Request

    ```shell
    curl -X GET 'https://<api-url>/books/   <book-identifier>'
    ```

#### Listing Books (`GET /book`)

The /books endpoint allows you to list all books based on provided filters, search terms, and pagination options. You can also specify the attributes to be returned for each book in the response.

- Request

  ```shell
    curl -X GET 'https://<api-url>/books?attribtues=<attribtues-to-return>&search=<search-term>&searchAttributes=<attributes-to-search>&limit=<limit>&cursor=<cursor>&order=<desc|asc>'
  ```

- Response

    ```json
    {
        "items": [
            {
            "bookId": "<book-id>",
            "title": "<book-title>",
            "author": "<book-author>",
            "publishedDate": "<published-date>"
            },
            // ...
        ],
        "cursor": "<last-evaluated-cursor>"
    }
    ```

- Examples

  - Retrieve all books:

    ```shell
    curl -X GET 'https://<api-url>/books
    ```

  - Search all `searchable-attributes` of the book for the term `abc`:

    >Default searchable attributes can be defined by the backend code.

    ```shell
        curl -X GET 'https://<api-url>/books?search=abc
    ```

    - Limit the search attributes:

        ```shell
            curl -X GET 'https://<api-url>/books?search=abc&searchAttributes=bookName,authorName
        ```

  - Limit the returned attributes:
      >Default returned attributes can be defined by the backend code.

      ```shell
        curl -X GET 'https://<api-url>/books?attributes=bookName,authorName
      ```

  - Filter on specific attributes:

    ```shell
        curl -X GET 'https://<api-url>/books?bookName.eq=Awesome Book
    ```

  - Filter on multiple attributes:

    ```shell
        curl -X GET 'https://<api-url>/books?bookName.neq=Awesome Book&authorName.inList=Auth One,Auth Two
    ```

  - Use logical grouping for filters (e.g. ```[ bookName == 'Awesome Book' OR authorName == 'Auth One' ]```)

    ```shell
        curl -X GET 'https://<api-url>/books?or[].bookName.eq=Awesome Book&or[].authorName.eq=Auth One
    ```

#### Querying Books (`POST /book/query`)

The Query API retrieves a list of books according to a supplied query. This query utilizes a JSON-based Domain Specific Language (DSL) to articulate intricate filters in various logical groupings. It also supports search functionality, attribute selection, pagination, and more. While it operates similarly to the aforementioned Listing API, it differs in two key aspects: it is accessed via a POST method, and it allows for more expressive and potent filtering capabilities..

- Request

  ```shell 
    curl -X POST 'https://<api-url>/books/query' \
    -H 'Content-Type: application/json' \
    -d '{
    "query": {
        "publishedYear": "<year>"
    },
    "limit": <limit>,
    "cursor": "<aa-bb-cc>"
    }'
  ```

- Response

  ```json
    {
        "items": [
            {
            "bookId": "<book-id>",
            "title": "<book-title>",
            "author": "<book-author>",
            "publishedDate": "<published-date>"
            },
            // ...
        ],
        "cursor": "<last-evaluated-cursor>"
    }
  ```

- Example query payload:

    ```js
    {
        filters: {
            authorName: { eq: 'John Doe' },
        },
        attributes: ['title', 'authorName'],
        pagination: {
            order: 'desc',
            cursor: 'aaa-bbb-ccc',
            count: 10,
        },
        search: 'Programming',
        searchAttributes: ['title', 'description'],
    }
    ```

- The filters accommodate various syntaxes, including:

  - Simple filters, where entity-attributes serve as keys. The object adjacent to the key signifies a set of filters that apply to that attribute. Optionally, you can include a `logicalOp` for the group, which defaults to `and`. In a similar fashion, you can establish a logical group for the filters of all entity-attributes.

    ```json
    {
        "pagination": {
            "limit": 40
        },
        "filters": {
            "logicalOp": "or", // default is and, and applies to all prop in the object
            "authorName" : {
                "logicalOp": "or", // default is and, and applies all the filters for this prop
                "eq": "Author Name 002",
                "contains": "004"
            },
            "bookName": {
                "neq": "Book Name 000",
                "inList": ["Book Name 005"]
            }
        }
    }
    ```

    > will translate something equivalent to

    ```sql
    ( authorName = '...' OR authorName like %004% )
    OR ( bookName != '...' AND bookName IN ['...', '...'] )
    ```

  - You have the option to define your query using a more intricate structure that allows for the grouping and unlimited nesting of filters.

    ```json
    {
        "pagination": {
            "limit": 40
        },
        "filters": {
            "or": [
                {
                    "and": [{
                        "authorName" : {
                            "eq": "Author Name 002"
                        },
                        "bookName": {
                            "neq": "Book Name 000"
                        }
                    }]
                },
                {
                    "authorName": {
                        "contains": "004"
                    }
                },
                {
                    "bookName": {
                        "inList": ["Book Name 005"]
                    }
                }
            ]
        }
    }
    ```

    > will translate to something equivalent to

    ``` sql
    ( 
        ( authorName = '...' AND bookName != '...' ) 
        OR authorName CONTAINS '004' 
        OR bookName in ['Book Name 005'] 
    ) 
    ```