---
sidebar_position: 2
---

# Validating Requests

FW24 boasts a robust validation framework, offering two types of validation for API endpoints:

- `InputValidationRule<{...some-type...}>` allows for straightforward validations for any input or type.

    ```ts
        const myInputValidation: InputValidationRule<{a: string, b: string}> = {
            a: {
                required: true,
                minLength: 5
            },
            b: {
                required: true,
                dataType: 'email'
            }
        }
    ```

- `HttpRequestValidations` offers validation rules for the entire HTTP request, including the body, header, param, and query.

    ```ts
        type Body = {
            a: string,
            b: string,
        };

        type Param = {
            id: string,
        };

        type Header = {
            'xxx-api-key': string,
            'xxx-client-id': string,
        };

        type Query = {
            cursor: string,
            sort: 'asc' | 'desc',
        };

        const myHttpRequestValidations: HttpRequestValidations<Header, Body, Param, Query> = {
            body: {
                a: {
                    required: true,
                    maxLength: 100,
                },
                b: {
                    required: true,
                    inList: ['My Auth 1', 'My Auth 2'] // The author must be one of the two names
                }
            },
            path: {
                id: {
                    required: true,
                    dataType: 'uuid',
                }
            },
            query: {
                cursor: {
                    required: true,
                },
                sort: {
                    inList: ['asc', 'desc']
                }
            },
            header: {
                'xxx-api-key': {
                    eq: 'xxx-yyy-zzz'
                },
                'client-id': {
                    required: true
                }
            }
        }
    ```

## Implementing Validations for Routes

FW24 supports the addition of validation in method decorators and also offers a dedicated `@Validations()` decorator for those who prefer this approach..

### Implementing Validation in the Method Decorator

For methods of type [`POST`, `PATCH`, `PUT`], the validations apply to the request body. For other types, they apply to the query parameters.

```ts

    type RequestInputSchema = {
        bookName: string,
        authorName: string,
    };

    @Controller('demo')
    export class MyController extends APIController {
        
        @Get('/my-endpoint', {
            validations: {
                bookName: {
                    required: true,
                    maxLength: 100,
                },
                authorName: {
                    required: true,
                    inList: ['My Auth 1', 'My Auth 2'] // The author must be one of the two names
                }
            }
        })
        private myEndpointHandler(req: Request, res: Response): Promise<Response>{
            const {bookName, authorName} = req.queryString as RequestInputSchema;
            return res.json({bookName, authorName});
        }

        @Post('/my-endpoint', {
            validations: {
                bookName: {
                    required: true,
                    maxLength: 100,
                },
                authorName: {
                    required: true,
                    inList: ['My Auth 1', 'My Auth 2'] // The author must be one of the two names
                }
            }
        })
        private myEndpointHandler(req: Request, res: Response): Promise<Response>{
            const {bookName, authorName} = req.body as RequestInputSchema;
            return res.json({bookName, authorName});
        }
    }
```

### Implementing Validation in the `Validations()` Decorator

The `@Validations()` decorator supersedes the validations defined in the Method decorator. If the validations are of type `InputValidation` and the request method is one of [`POST`, `PATCH`, `PUT`], the validations apply to the `request-body`. Otherwise, they apply to the `request-query-params`.

```ts
{

    type RequestInputSchema = {
        bookName: string,
        authorName: string,
    };

    // Validate the input. For POST, PATCH, and PUT, it's the body; otherwise, it's the query parameters.
    @Validations({
        bookName: {
            required: true,
            maxLength: 100,
        },
        authorName: {
            required: true,
            inList: ['My Auth 1', 'My Auth 2'] // Author can have only one of the 2 names
        }
    })
    @Post('/another-endpoint')
    private anotherHandler(req: Request, res: Response): Promise<Response>{

        const { bookName, authorName } = req.body as RequestInputSchema;

        return res.json({ bookName, authorName });
    }

    @Validations(myHttpRequestValidations)
    @Post('/awesome-endpoint/{id}')
    private awesomeHandler(req: Request, res: Response): Promise<Response>{

        const { a, b } = req.body as RequestInputSchema;
        const { id } = req.path as any;
        const { cursor, sort } = req.query as any;

        return res.json({a, b, id, cursor, sort});
    }
}
```
