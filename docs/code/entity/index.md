# Documentation for index.ts

# TypeScript Code Documentation

The following TypeScript code exports several modules for use in a project:

```typescript
export * from './base-entity';
export * from './crud-service';
export * from './base-service';
export * from './entity-metadata-container';
export * from './base-entity-controller';
```

## Description

- `base-entity`: This module exports the base entity class which can be extended to create entities.
  
- `crud-service`: This module exports a CRUD (Create, Read, Update, Delete) service class that provides methods to interact with entities.
  
- `base-service`: This module exports the base service class which can be extended to create service classes.
  
- `entity-metadata-container`: This module exports a class that provides methods to manage entity metadata.
  
- `base-entity-controller`: This module exports the base entity controller class which can be extended to create controllers for entities.

These modules can be imported and used in a TypeScript project to create entities, services, controllers, and manage entity metadata efficiently.

## Usage

To use these modules in your project, you can import them as follows:

```typescript
import { BaseEntity } from './base-entity';
import { CrudService } from './crud-service';
import { BaseService } from './base-service';
import { EntityMetadataContainer } from './entity-metadata-container';
import { BaseEntityController } from './base-entity-controller';
```

You can then extend the provided classes, implement interfaces, or use the provided methods to build your application logic in a structured and organized manner.

## Reference

- [BaseEntity Documentation](./base-entity.md)
- [CrudService Documentation](./crud-service.md)
- [BaseService Documentation](./base-service.md)
- [EntityMetadataContainer Documentation](./entity-metadata-container.md)
- [BaseEntityController Documentation](./base-entity-controller.md)

Please refer to the individual documentation files for detailed information on each module.