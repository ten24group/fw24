---
sidebar_position: 4
---

# Entity Validation

FW24 offers a robust validation framework that extends beyond API validations to include validations for entity operations. These validations are triggered when the base-entity-service attempts to perform an operation on an entity or entities. FW24 supports two types of entity validations:

- `EntityInputValidations<EntitySchema>` This provides simple validations for the operation input. For each entity attribute, you can declare an array of validation rules. Each rule requires a list of operations to which it applies.

  ```ts
    const myInputValidation: EntityInputValidations<any> = {
        attOne: [{
            operations: ['create', 'update'],
            required: true,
            minLength: 5
        }],
        attTwo: [{
            operations: ['create'],
            required: true,
            dataType: 'email'
        }]
    }
  ```

- `EntityValidations<EntitySchema>` This provides validation rules for both the operation input and the persisted entity record (when applied, for example, for `delete`, `update` operations). This type defines advanced validation rules with powerful features. For each rule, you can define some `operations` and their `conditions`. The validation rule applies only when the conditions are satisfied (if any). The default scope for conditions is `all`, but it can be one of [`any`, `all`, `none`]. The framework supports two syntaxes to define operations:

  - tuple: `operations` can be defined as a tuple

  ```ts
    operations: [ 
        'opName' 
        | [ 'opName', Array<conditions> ] 
        | [ 'opName', Array<conditions>, 'scope' ] 
    ]
  ```

  - object: or operations can be defined as an object with operation-name as keys and conditions as values.

  ```ts
    operations: {
        op1: [{conditions: [], scope?: 'any' | 'all' | 'none' }],
        op2: [{conditions: [], scope?: 'any' | 'all' | 'none' }]
    }
  ```

  ```ts
    const myConditions = {
        inputIsJohnDoe: { 
            input: { 
                email: { eq: 'john@doe.com' }
            }
        },
        recordIsNotNew: { 
            record: {
                userId: { neq: '' }
            }
        },
    } as const;

    const myHttpRequestValidations: EntityValidations<any> = {
        actor: {
            tenantId: [{
                eq: 'xxx-yyy-zzz',
                operations: [
                    // no conditions are defined for `create` operation, hence this rule will applies.
                    'create', 

                    // for `update` operation this rule only applies when `any` of the ['recordIsNotNew', 'inputIsJohnDoe'] evaluates to true
                    ['update', ['recordIsNotNew', 'inputIsJohnDoe'], 'any'],
                    
                    // for `delete` operation this rule only applies when `all` of the ['recordIsNotNew', 'inputIsJohnDoe'] evaluates to true
                    ['delete', ['recordIsNotNew', 'inputIsJohnDoe'], 'all' ]
                ],
            }],
        },
        input: {
            email: [{
                eq: 'nitin@gmail.com',
                operations: [
                    // applies to `create` operation only when none of the provided conditions evaluates to true
                    ['create', ['inputIsNitin', 'recordIsNotNew'], 'none']
                ],
            }],
            lastName:[{
                required: true,
                operations: {
                    // alternate syntax to define the operation conditions
                    create: [{
                        conditions: ['recordIsNotNew', 'recordIsNotNew'],
                        scope: 'any',
                    }],
                }
            }]
        },
        record: {
            userId: [{
                required: true,
                operations:['xxx']
            }]
        }

    }  
  ```

## Adding Entity Validations

To add validations for an entity, override the `getEntityValidations()` function in the entity service as shown below:

```ts
    class MyEntityService extends BaseEntityService {

        getEntityValidations(): EntityInputValidations<any> | EntityValidations<any> {
            return {
                bookName: [{
                    operations: ['create'],
                    required: true,
                    maxLength: 100,
                    minLength: 1
                },
                {
                    operations: ['update'],
                    required: true,
                    maxLength: 50,
                    minLength: 5
                }]
            };
        }
    }
```

## Customizing validation error messages

For each validation error message, the framework calculates multiple message keys and resolves them in reverse order. The leftmost key is the most generic, and the rightmost key is the most specific. The error message keys follow a simple convention.

### Adding a custom error-message

You can provide your custom error message or error message ID in validation rules. Error messages can have several placeholders, such as `{key}`, `{path}`, `{validationName}`, `{validationValue}`, `{received}`, and `{refinedReceived}`.
    - {key}:  then key in for which the validation-rule is defined
    - {path}:  then path for the key e.g ['body', 'password'], ['param', 'bookId']
    - {validationName}: the name of the validation e.g 'eq', 'inList' etc
    - {validationValue}: the value for the validation in the validation-rule e.g. { minLength: 10 } ==> 10
    - {received}: the value received by the validation engine
    - {refinedReceived}: the calculated value by the validation engine; e.g for `minLength` validation the engine will calculate the length of the input

```ts
    type EmailAndPassword = {
        email: string, 
        password: string,
    }

    const emailAndPasswordValidations: InputValidationRule<EmailAndPassword> = {
        email: {
            required: true,
            datatype: { 
                value: 'email',
                customMessage: "data-type is not email",
            }
            customMessage: 'Email is required!!!'
        }, 
        password: {
            required: true,
            minLength: 8,
            maxLength: 20,
            pattern: {
                validator: (inputVal: any) => Promise.resolve(customPasswordValidator(inputVal)),
                customMessageId: 'custom.validation.messages.password.xyz'
            }
        }
    } as const;
```

### Adding a custom Validator

You can provide your custom validator for any validation rule.

```ts
    const customPasswordValidator = (inputValue: any): TestComplexValidationResult => {
        const result: TestComplexValidationResult = {
            pass: true
        };

        const pattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@.#$!%*?&])[A-Za-z\d@.#$!^%*?&]{8,20}$/
        
        result.pass = pattern.test(inputValue);

        if(!result.pass){

            /*
                - At least one lowercase alphabet i.e. [a-z]
                - At least one uppercase alphabet i.e. [A-Z]
                - At least one Numeric digit i.e. [0-9]
                - At least one special character i.e. [`@`, `$`, `.`, `#`, `!`, `%`, `*`, `?`, `&`, `^`]
                - Also, the total length must be in the range [8-20]
            */

            const expected: Array<string> = [];

            if (!/[a-z]/.test(inputValue)) {
                expected.push('one lowercase alphabet');
            }
            if (!/[A-Z]/.test(inputValue)){
                expected.push('one uppercase alphabet');
            }
            if (!/[\d]/.test(inputValue)){
                expected.push('one Numeric digit');
            }
            if (!/[!@#$%^&*.?]/.test(inputValue)){
                expected.push('one special character');
            }

            const strengths = ["Good", "Medium strong", "Weak", "very Weak" ]; 

            result.received = [ '*'.repeat(inputValue?.length ?? 0 ), strengths[expected?.length ] ];
            result.expected = [ 'at least', expected.join(', ')];

            result.customMessageId = "validation.http.body.password.pattern.validator";
        }

        return result;
    }

    type EmailAndPassword = {
        email: string, 
        password: string,
    }

    const emailAndPasswordValidations: InputValidationRule<EmailAndPassword> = {
        email: {
            required: true,
            datatype: 'email',
        }, 
        password: {
            required: true,
            minLength: 8,
            maxLength: 20,
            pattern: {
                validator: (inputVal: any) => Promise.resolve(customPasswordValidator(inputVal)),
            }
        }
    } as const;
```

### Overriding Default Error Messages

You can override the default error messages or provide custom error message keys to the framework. The framework provides placeholder functions in Controllers and Entity-services that can be overridden to return a map of custom error keys and messages.

```ts
    protected getOverriddenHttpRequestValidationErrorMessages(): Promise<Map<string, string>> {
        return Promise.resolve(new Map(
            Object.entries({
                "validation.http.body.password.pattern.validator": 
                    "Password '{received}' is '{refinedReceived}'; Please add {validationName} {validationValue}",
                "validation.http.body.newPassword.pattern.validator":
                     "New password '{received}' is '{refinedReceived}'; Please add {validationName} {validationValue}",
            })
        ))
    }
```
