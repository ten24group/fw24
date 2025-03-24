---
sidebar_position: 6
---

# Entity System

The fw24 Entity System provides a powerful, convention-based CRUD system for DynamoDB with TypeScript support. It automatically handles table creation, relationships, validation, and more.

## Overview

The entity system consists of three main components:

1. Base Entity - Schema and type definitions
2. Base Service - CRUD operations and business logic
3. CRUD Service - Core database operations

## Quick Start

```typescript
// 1. Define your entity schema
interface UserSchema extends EntitySchema<string, string, string> {
    model: {
        entity: "user",
        version: "1",
        service: "users"
    },
    attributes: {
        id: EntityAttribute<string>,
        email: EntityAttribute<string>,
        name: EntityAttribute<string>
    }
}

// 2. Create your service
class UserService extends BaseEntityService<UserSchema> {
    constructor() {
        super(userSchema, entityConfigurations);
    }
}

// 3. Create your controller
class UserController extends BaseEntityController<UserSchema> {
    constructor() {
        super("user");
    }
}
```

## Features

### Automatic CRUD Operations

The system automatically provides these operations for each entity:

- `create` - Create new entities
- `get` - Retrieve single entities
- `update` - Update existing entities
- `delete` - Remove entities
- `list` - List/query entities
- `upsert` - Create or update entities

### DynamoDB Integration

- Automatic table creation based on schema
- Efficient querying using access patterns
- Support for complex queries and filters
- Batch operations
- Transaction support

### Type Safety

- Full TypeScript support
- Type inference for queries
- Type-safe relationships
- Validation at compile time

### Relationships

Support for entity relationships:

```typescript
interface UserSchema extends EntitySchema<string, string, string> {
    attributes: {
        id: EntityAttribute<string>,
        posts: Relation<PostSchema>({
            type: 'one-to-many',
            entityName: 'post',
            identifiers: {
                source: 'id',
                target: 'userId'
            }
        })
    }
}
```

### Validation

Built-in validation support:

```typescript
interface UserValidation extends EntityValidations<UserSchema> {
    email: {
        required: true,
        format: 'email'
    },
    name: {
        minLength: 2,
        maxLength: 50
    }
}
```

### Query Building

Flexible query building:

```typescript
const users = await userService.query({
    filter: {
        age: { gt: 18 },
        status: { eq: 'active' }
    },
    sort: { field: 'createdAt', order: 'desc' },
    limit: 10
});
```

### Event System

Built-in event dispatching:

```typescript
// Pre/Post operation events
eventDispatcher.on('beforeCreate', async (data) => {
    // Pre-create logic
});

eventDispatcher.on('afterUpdate', async (data) => {
    // Post-update logic
});
```

### Audit Logging

Automatic audit trail:

```typescript
// Configuration
{
    auditLogger: {
        enabled: true,
        fields: ['email', 'status']
    }
}

// Automatic logging
// [2024-03-14 10:00:00] User updated: id=123, changed={email: 'old@test.com' -> 'new@test.com'}
```

### Authorization

Role-based access control:

```typescript
// Define permissions
{
    authorizer: {
        create: ['admin'],
        update: ['admin', 'owner'],
        delete: ['admin'],
        read: ['*']
    }
}
```

## Advanced Features

### Field Metadata

Define field metadata for UI rendering:

```typescript
{
    attributes: {
        email: {
            type: 'string',
            label: 'Email Address',
            placeholder: 'Enter your email',
            validation: {
                required: true,
                format: 'email'
            }
        }
    }
}
```

### Relationship Hydration

Control data loading:

```typescript
// Get user with related posts
const user = await userService.get(id, {
    hydrate: {
        posts: {
            attributes: ['title', 'content']
        }
    }
});
```

### Search and Filtering

Complex search capabilities:

```typescript
const results = await userService.search({
    keywords: 'john developer',
    filters: {
        status: 'active',
        skills: { contains: 'typescript' }
    },
    sort: { field: 'relevance' }
});
```

### Pagination

Built-in pagination support:

```typescript
const page = await userService.list({
    page: 2,
    pageSize: 20,
    sort: { field: 'createdAt', order: 'desc' }
});
```

## Best Practices

1. Schema Design
   - Use meaningful entity names
   - Define proper relationships
   - Include field metadata
   - Set appropriate validations

2. Service Implementation
   - Extend base service for custom logic
   - Use dependency injection
   - Implement proper error handling
   - Add business logic validations

3. Controller Design
   - Keep controllers thin
   - Use proper route naming
   - Implement proper request validation
   - Handle errors gracefully

## Examples

### Basic Entity

```typescript
// Schema
interface ProductSchema extends EntitySchema<string, string, string> {
    model: {
        entity: "product",
        version: "1"
    },
    attributes: {
        id: EntityAttribute<string>,
        name: EntityAttribute<string>,
        price: EntityAttribute<number>,
        category: EntityAttribute<string>
    }
}

// Service
class ProductService extends BaseEntityService<ProductSchema> {
    async validatePrice(price: number) {
        if (price <= 0) {
            throw new Error('Price must be positive');
        }
    }

    async create(data: CreateEntityItemTypeFromSchema<ProductSchema>) {
        await this.validatePrice(data.price);
        return super.create(data);
    }
}

// Controller
class ProductController extends BaseEntityController<ProductSchema> {
    constructor() {
        super("product");
    }

    @Post('/products/bulk')
    async bulkCreate(req: Request, res: Response) {
        const products = req.body;
        const results = await this.getEntityService().bulkCreate(products);
        return res.json(results);
    }
}
```

### Complex Relationships

```typescript
// Order system example
interface OrderSchema extends EntitySchema<string, string, string> {
    model: {
        entity: "order"
    },
    attributes: {
        id: EntityAttribute<string>,
        customer: Relation<CustomerSchema>({
            type: 'many-to-one',
            entityName: 'customer'
        }),
        items: Relation<OrderItemSchema>({
            type: 'one-to-many',
            entityName: 'orderItem'
        }),
        status: EntityAttribute<string>,
        total: EntityAttribute<number>
    }
}
```

## Troubleshooting

Common issues and solutions:

1. Type Errors
   ```typescript
   // Problem: Type 'string' is not assignable to type 'number'
   // Solution: Check schema definitions and use correct types
   ```

2. Query Performance
   ```typescript
   // Problem: Slow queries
   // Solution: Use proper indexes and access patterns
   ```

3. Relationship Issues
   ```typescript
   // Problem: Circular dependencies
   // Solution: Use lazy loading or restructure relationships
   ```

## API Reference

See the detailed API documentation for:
- BaseEntityService
- BaseEntityController
- EntitySchema
- Query Types
- Validation Types
- Event Types

## Contributing

Guidelines for contributing to the entity system:
1. Follow TypeScript best practices
2. Add proper documentation
3. Include tests
4. Follow the existing code style 