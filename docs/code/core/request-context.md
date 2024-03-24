# Documentation for request-context.ts

# RequestContext Class Documentation

The `RequestContext` class implements the `Request` interface and is used to encapsulate the details of an incoming API Gateway event and the context in which the event is being executed.

## Dependencies

- `Request` interface from '../interfaces/request'
- `APIGatewayEvent` and `Context` from "aws-lambda"

## Properties

- `event`: APIGatewayEvent - The API Gateway event object containing details of the incoming request.
- `context`: Context - The context in which the event is being executed.
- `resource`: any - The resource specified in the API Gateway event.
- `body`: any - The parsed body of the incoming request.
- `path`: string - The path specified in the API Gateway event.
- `queryStringParameters`: any - The query string parameters in the API Gateway event.
- `headers`: any - The headers in the API Gateway event.
- `requestContext`: any - The request context in the API Gateway event.
- `stageVariables`: any - The stage variables in the API Gateway event.
- `pathParameters`: any - The path parameters in the API Gateway event.
- `isBase64Encoded`: boolean - Indicates if the body of the request is base64 encoded.
- `httpMethod`: string - The HTTP method of the incoming request.

## Constructor

- `constructor(event: APIGatewayEvent, context: Context)`: Initializes the `RequestContext` with the provided `APIGatewayEvent` and `Context`. It sets the properties based on the information in the event and context.

## Methods

- `get(key: string): any`: Retrieves the value corresponding to the specified key from path parameters, query string parameters, or body.
- `param(key: string): any`: Retrieves the value corresponding to the specified key from path parameters.
- `query(key: string): any`: Retrieves the value corresponding to the specified key from query string parameters.
- `post(key: string): any`: Retrieves the value corresponding to the specified key from the parsed body.

## Parsing Body

The `RequestContext` class includes logic to parse the body of the incoming request based on the content type specified in the headers. It supports parsing of `application/x-www-form-urlencoded`, `application/json`, and other content types. If the content type is `multipart/form-data`, parsing is not implemented yet.

## Error Handling

In case of an error while parsing the body as JSON, the class logs an error message and stores the raw event body as is.

Overall, the `RequestContext` class provides a convenient way to access and handle the details of an incoming API Gateway event in a TypeScript application.