# Documentation for api-gateway-controller.ts

# APIGatewayController Class

The `APIGatewayController` class is a base controller class for handling API Gateway events.

### Constructor

```typescript
constructor()
```

- Binds the `LambdaHandler` method to the instance of the class.

### Methods

#### LambdaHandler

```typescript
async LambdaHandler(event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult>
```

- Lambda handler for the controller.
- Handles incoming API Gateway events.
- Parameters:
  - `event`: The event object from the API Gateway.
  - `context`: The context object from the API Gateway.
- Returns: The API Gateway response object.

#### findMatchingRoute

```typescript
private findMatchingRoute(requestData: Request): Route | null
```

- Finds the route that matches the HTTP method and resource.
- Parameters:
  - `requestData`: The request data object.
- Returns: The matching route or null if not found.

#### getRouteFunction

```typescript
private getRouteFunction(route: Route | null): Function
```

- Retrieves the function associated with the route.
- Parameters:
  - `route`: The matched route.
- Returns: The function associated with the route.

#### handleNotFound

```typescript
private handleNotFound(_req: Request): APIGatewayProxyResult
```

- Handles the NotFound route.
- Parameters:
  - `_req`: The request object.
- Returns: The response object with a 404 status code.

#### handleException

```typescript
private handleException(_req: Request, err: Error): APIGatewayProxyResult
```

- Handles exceptions and returns a JSON response with the error message.
- Parameters:
  - `_req`: The request object.
  - `err`: The error object.
- Returns: The response object with a 500 status code.

#### handleResponse

```typescript
private handleResponse(res: APIGatewayProxyResult): APIGatewayProxyResult
```

- Handles the API Gateway response.
- Parameters:
  - `res`: The API Gateway response object.
- Returns: The modified API Gateway response object with CORS headers.

#### CreateHandler

```typescript
static CreateHandler( constructorFunc: { new (): APIGatewayController} )
```

- Creates a new instance of the controller and returns its `LambdaHandler` method.
- Parameters:
  - `constructorFunc`: The constructor function of `APIGatewayController`.

### Static Properties

- None

### Instance Properties

- None

### Usage

To create an instance of the controller:

```typescript
const controller = new APIGatewayController();
```

To handle API Gateway events using the `LambdaHandler` method:

```typescript
const response = await controller.LambdaHandler(event, context);
```

This documentation provides an overview of the `APIGatewayController` class and its methods for handling API Gateway events.