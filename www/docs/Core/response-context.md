# ResponseContext

The `ResponseContext` class implements the `Response` interface and provides methods to manipulate HTTP responses.

## Properties

- `headers`: An object representing the response headers. Default value is an empty object.
- `body`: A string representing the response body. Default value is an empty string.
- `statusCode`: A number representing the HTTP status code. Default value is 200.

## Methods

- `send(body: string): Response`: Sets the response body to the specified string and returns the `Response` object.
- `json(body: any): Response`: Sets the response body to the JSON representation of the provided object, sets the `Content-Type` header to `application/json`, and returns the `Response` object.
- `status(statusCode: number): Response`: Sets the HTTP status code of the response and returns the `Response` object.
- `setHeader(key: string, value: any): Response`: Sets a custom header with the specified key and value, and returns the `Response` object.
- `getHeader(key: any)`: Retrieves the value of a specific header.
- `getHeaders()`: Retrieves all the headers of the response.
- `getBody()`: Retrieves the response body.
- `getStatusCode()`: Retrieves the HTTP status code of the response.
- `set(body: string, statusCode: number = 200): Response`: Sets the response body and HTTP status code simultaneously and returns the `Response` object.
- `redirect(location: string): Response`: Sets the HTTP status code to 302 (Found) and adds a `Location` header with the specified value, then returns the `Response` object.
- `end(body: string): Response`: Sets the response body to the specified string and returns the `Response` object. This method is typically used to end the response stream.

## Example Usage

```ts
import { ResponseContext } from './ResponseContext';

const response = new ResponseContext();

response.send('Hello, World!').status(200).json({ message: 'Success' });
console.log(response.getHeaders());
console.log(response.getBody());
console.log(response.getStatusCode());
```