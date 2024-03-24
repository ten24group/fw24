# Documentation for base-entity-controller.ts

# BaseEntityController Class

The `BaseEntityController` class is an abstract class that extends `APIGatewayController`. It serves as a base controller for handling CRUD operations on entities. 

### Constructor
```typescript
constructor(entityName: string)
```

- **entityName:** A string representing the name of the entity.

### Properties
```typescript
private entityName: any;
```

- **entityName:** Stores the name of the entity.

### Methods

#### initDI()
```typescript
abstract initDI(): Promise<void>;
```
- Abstract method to initialize dependency injection. 

#### initialize(event: any, context: any)
```typescript
async initialize(event: any, context: any): Promise<void>
```
- Initializes DI and other setup.
- **event:** An event object.
- **context:** A context object.

#### getEntityService<S extends BaseEntityService<Sch>>()
```typescript
public getEntityService<S extends BaseEntityService<Sch>>(): S
```
- Returns the entity service for the entity.

#### create(req: Request, res: Response)
```typescript
@Get('/create')
async create(req: Request, res: Response): Promise<void>
```
- Creates a new entity.
- **req:** Request object.
- **res:** Response object.

#### find(req: Request, res: Response)
```typescript
@Get('/get/{id}')
async find(req: Request, res: Response): Promise<void>
```
- Finds an entity by ID.
- **req:** Request object.
- **res:** Response object.

#### update(req: Request, res: Response)
```typescript
@Get('/update/{id}')
async update(req: Request, res: Response): Promise<void>
```
- Updates an entity by ID.
- **req:** Request object.
- **res:** Response object.

#### delete(req: Request, res: Response)
```typescript
@Get('/delete/{id}')
async delete(req: Request, res: Response): Promise<void>
```
- Deletes an entity by ID.
- **req:** Request object.
- **res:** Response object.

#### list(req: Request, res: Response)
```typescript
@Get('/list')
async list(req: Request, res: Response): Promise<void>
```
- Lists all entities.
- **req:** Request object.
- **res:** Response object.

### Note
This class is not an ideal place to initialize app state, DI, routes, etc., and should be refactored to an Ideal component.