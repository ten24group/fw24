# BaseEntityController

The `BaseEntityController` class is an abstract class that extends `APIController`. It serves as a base controller for handling CRUD operations on entities. 

### Constructor
```ts
constructor(entityName: string)
```

- **entityName:** A string representing the name of the entity.

### Properties
```ts
private entityName: any;
```

- **entityName:** Stores the name of the entity.

### Methods

#### initDI()
```ts
abstract initDI(): Promise<void>;
```
- Abstract method to initialize dependency injection. 

#### initialize(event: any, context: any)
```ts
async initialize(event: any, context: any): Promise<void>
```
- Initializes DI and other setup.
- **event:** An event object.
- **context:** A context object.

#### getEntityService extends BaseEntityService()
```ts
public getEntityService<S extends BaseEntityService<Sch>>(): S
```
- Returns the entity service for the entity.

#### create(req: Request, res: Response)
```ts
@Get('/create')
async create(req: Request, res: Response): Promise<void>
```
- Creates a new entity.
- **req:** Request object.
- **res:** Response object.

#### find(req: Request, res: Response)
```ts
@Get('/get/{id}')
async find(req: Request, res: Response): Promise<void>
```
- Finds an entity by ID.
- **req:** Request object.
- **res:** Response object.

#### update(req: Request, res: Response)
```ts
@Get('/update/{id}')
async update(req: Request, res: Response): Promise<void>
```
- Updates an entity by ID.
- **req:** Request object.
- **res:** Response object.

#### delete(req: Request, res: Response)
```ts
@Get('/delete/{id}')
async delete(req: Request, res: Response): Promise<void>
```
- Deletes an entity by ID.
- **req:** Request object.
- **res:** Response object.

#### list(req: Request, res: Response)
```ts
@Get('/list')
async list(req: Request, res: Response): Promise<void>
```
- Lists all entities.
- **req:** Request object.
- **res:** Response object.

### Note
This class is not an ideal place to initialize app state, DI, routes, etc., and should be refactored to an Ideal component.