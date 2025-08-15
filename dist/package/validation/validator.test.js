"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const validator_1 = require("./validator");
(0, globals_1.describe)('Validator', () => {
    (0, globals_1.describe)('validateEntity()', () => {
        const validator = new validator_1.Validator();
        (0, globals_1.it)('should return validation passed if no rules', async () => {
            const result = await validator.validateEntity({
                operationName: 'create',
                entityName: 'test',
                entityValidations: {},
            });
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toEqual([]);
        });
        (0, globals_1.it)('should validate actor rules', async () => {
            const actor = {
                role: 'admin'
            };
            const result = await validator.validateEntity({
                operationName: 'create',
                entityName: 'test',
                entityValidations: {
                    actor: {
                        role: [{ eq: 'admin' }]
                    }
                },
                actor
            });
            console.warn('should validate actor rules result:', result);
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toEqual([]);
        });
        (0, globals_1.it)('should return actor rule errors', async () => {
            const actor = {
                role: 'user'
            };
            const result = await validator.validateEntity({
                operationName: 'create',
                entityName: 'test',
                collectErrors: true,
                verboseErrors: true,
                entityValidations: {
                    actor: {
                        role: [{ eq: 'admin' }]
                    }
                },
                actor
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
            (0, globals_1.expect)(result.errors?.[0]?.messageIds).toContain('validation.entity.test.actor.role.eq.admin');
        });
        (0, globals_1.it)('should validate input rules', async () => {
            const input = {
                email: 'test@example.com'
            };
            const result = await validator.validateEntity({
                operationName: 'create',
                entityName: 'test',
                entityValidations: {
                    input: {
                        email: [{ datatype: 'email' }]
                    }
                },
                input
            });
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toEqual([]);
        });
        (0, globals_1.it)('should return input rule errors', async () => {
            const input = {
                firstName: 'xxx'
            };
            const result = await validator.validateEntity({
                operationName: 'create',
                entityName: 'test',
                collectErrors: true,
                verboseErrors: true,
                entityValidations: {
                    input: {
                        firstName: [{ minLength: 10 }]
                    }
                },
                input
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
            (0, globals_1.expect)(result.errors?.[0]?.messageIds).toContain('validation.entity.test.firstname.minlength');
        });
    });
    (0, globals_1.describe)('validateInput()', () => {
        const validator = new validator_1.Validator();
        (0, globals_1.it)('should return passed result when input passes validation', async () => {
            const input = {
                name: 'John',
                age: 30
            };
            const rules = {
                name: { required: true },
                age: { gt: 18 }
            };
            const result = await validator.validateInput(input, rules);
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toEqual({});
        });
        (0, globals_1.it)('should return failed result when input fails validation', async () => {
            const input = {
                name: 'John'
            };
            const rules = {
                name: { required: true },
                age: { gt: 18, required: true }
            };
            const result = await validator.validateInput(input, rules);
            console.log({ result });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toEqual({
                age: globals_1.expect.any(Array)
            });
        });
        (0, globals_1.it)('should not collect errors when collectErrors is false', async () => {
            const input = {
                name: 'John'
            };
            const rules = {
                name: { required: true },
                age: { gt: 18 }
            };
            const result = await validator.validateInput(input, rules, false);
            (0, globals_1.expect)(result.errors).toEqual({});
        });
    });
    (0, globals_1.describe)('validateHttpRequest()', () => {
        const validator = new validator_1.Validator();
        (0, globals_1.it)('should validate request body', async () => {
            const requestContext = {
                body: {
                    name: 'John',
                    age: 20
                }
            };
            const validations = {
                body: {
                    name: { required: true },
                    age: { gt: 18, required: true }
                }
            };
            const result = await validator.validateHttpRequest({ requestContext, validations });
            console.log(result);
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toEqual([]);
        });
        (0, globals_1.it)('should validate request parameters', async () => {
            const requestContext = {
                pathParameters: {
                    id: '123'
                }
            };
            const validations = {
                param: {
                    id: { required: true }
                }
            };
            const result = await validator.validateHttpRequest({ requestContext, validations });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should collect errors for failed validations', async () => {
            const requestContext = {
                body: {
                    name: 'John',
                }
            };
            const validations = {
                body: {
                    name: { required: true },
                    age: { gt: 40, required: true }
                }
            };
            const overriddenErrorMessages = new Map(Object.entries({
                'validation.http.body.age.gt': 'Age must be greater than 40....'
            }));
            const result = await validator.validateHttpRequest({ requestContext, validations, collectErrors: true, verboseErrors: true, overriddenErrorMessages });
            console.log({ result });
            (0, globals_1.expect)(result.errors).toEqual(globals_1.expect.any(Array));
            (0, globals_1.expect)(result.errors).toHaveLength(2);
            (0, globals_1.expect)(result.errors?.[0]?.messageIds).toContain('validation.http.body.age.gt');
        });
    });
    (0, globals_1.describe)('validateConditionalRules()', () => {
        const validator = new validator_1.Validator();
        const allConditions = {
            condition1: {
                input: {
                    name: { eq: 'abc' }
                }
            },
            condition2: {
                input: {
                    age: { eq: 18 }
                }
            }
        };
        (0, globals_1.it)('should validate rules when all conditions pass', async () => {
            const rules = [{
                    minLength: 8,
                    conditions: [['condition1', 'condition2'], 'all']
                }];
            const result = await validator.validateConditionalRules({
                rules,
                allConditions,
                inputVal: "something_long",
                input: {
                    name: 'abc',
                    age: 18
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
            const result_fail = await validator.validateConditionalRules({
                rules,
                allConditions,
                inputVal: "sort",
                input: {
                    name: 'abc',
                    age: 18
                }
            });
            console.log(result_fail);
            (0, globals_1.expect)(result_fail.pass).toBe(false);
        });
        (0, globals_1.it)('should skip validation if any condition fails when scope is "all"', async () => {
            const rules = [{
                    minLength: 8,
                    conditions: [['condition1', 'condition2'], 'all']
                }];
            const result = await validator.validateConditionalRules({
                rules,
                allConditions,
                inputVal: "sort", // validation should have failed for this input
                input: {
                    name: 'pqr', // the condition won't be applied for this input
                    age: 18
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should validate if any condition fails when scope is "any"', async () => {
            const rules = [{
                    minLength: 8,
                    conditions: [['condition1', 'condition2'], 'any']
                }];
            const result = await validator.validateConditionalRules({
                rules,
                allConditions,
                inputVal: "sort",
                input: {
                    name: 'pqr',
                    age: 18
                }
            });
            (0, globals_1.expect)(result.pass).toBe(false);
        });
        (0, globals_1.it)('should skip validation if any condition passes when scope is "none"', async () => {
            const rules = [{
                    minLength: 8,
                    conditions: [['condition1', 'condition2'], 'none']
                }];
            const result = await validator.validateConditionalRules({
                rules,
                allConditions,
                inputVal: "sort", // invalid input
                input: {
                    name: 'pqr',
                    age: 18
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should validate when all condition fail; when scope is "none"', async () => {
            const rules = [{
                    minLength: 8,
                    conditions: [['condition1', 'condition2'], 'none']
                }];
            const result = await validator.validateConditionalRules({
                rules,
                allConditions,
                inputVal: "sort", // invalid input
                input: {
                    name: 'pqr',
                    age: 24
                }
            });
            (0, globals_1.expect)(result.pass).toBe(false);
        });
    });
    (0, globals_1.describe)('validateConditionalRule()', () => {
        const CONDITION = {
            actorIs123: {
                actor: {
                    actorId: { eq: '123' }
                },
            }
        };
        (0, globals_1.it)('should validate rules if criteria rules pass', async () => {
            const validator = new validator_1.Validator();
            const validationRule = {
                conditions: [['actorIs123'], 'all'],
                minLength: 10
            };
            const actor = {
                actorId: '123'
            };
            const result = await validator.validateConditionalRule({
                rule: validationRule,
                allConditions: CONDITION,
                inputVal: 'input',
                input: {},
                record: {},
                actor: actor
            });
            // console.warn(JSON.stringify({result}));
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
            (0, globals_1.expect)(result.errors?.[0]?.messageIds).toContain('minlength');
        });
        (0, globals_1.it)('should skip validation if criteria rules fail', async () => {
            const validator = new validator_1.Validator();
            const validationRule = {
                conditions: [['actorIs123'], 'all'],
                minLength: 5
            };
            const actor = {
                actorId: '456'
            };
            const result = await validator.validateConditionalRule({
                rule: validationRule,
                allConditions: CONDITION,
                inputVal: 'in',
                input: {},
                record: {},
                actor: actor
            });
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toBe(undefined);
        });
    });
    (0, globals_1.describe)('testComplexValidationRule', () => {
        (0, globals_1.it)('should call custom validator if provided', async () => {
            const validator = new validator_1.Validator();
            const customValidator = jest.fn().mockResolvedValue({
                pass: true
            });
            const rule = {
                validator: customValidator
            };
            const value = 'test';
            const result = await validator.testComplexValidationRule(rule, value);
            (0, globals_1.expect)(customValidator).toHaveBeenCalledWith(value, true);
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should call default validator if custom not provided', async () => {
            const validator = new validator_1.Validator();
            const defaultValidator = jest.fn().mockResolvedValue({
                pass: false,
                errors: ['Error!']
            });
            validator.testValidationRule = defaultValidator;
            const rule = {
                maxLength: 5
            };
            const value = 'test';
            const result = await validator.testComplexValidationRule(rule, value);
            (0, globals_1.expect)(defaultValidator).toHaveBeenCalledWith(rule, value, true);
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toEqual(['Error!']);
        });
        (0, globals_1.it)('should use custom message if provided', async () => {
            const validator = new validator_1.Validator();
            const rule = {
                message: 'Custom error'
            };
            const value = 'test';
            const result = await validator.testComplexValidationRule(rule, value);
            (0, globals_1.expect)(result.customMessage).toBe('Custom error');
        });
    });
    (0, globals_1.describe)('testValidationRule()', () => {
        (0, globals_1.it)('should return validation passed if no rules', async () => {
            const validator = new validator_1.Validator();
            const result = await validator.testValidationRule({}, 'test');
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toEqual([]);
        });
        (0, globals_1.it)('should return validation errors if rules fail', async () => {
            const validator = new validator_1.Validator();
            const partialValidation = {
                required: true
            };
            const result = await validator.testValidationRule(partialValidation, undefined);
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
        });
        (0, globals_1.it)('should collect multiple validation errors', async () => {
            const validator = new validator_1.Validator();
            const partialValidation = {
                required: true,
                minLength: 5,
                maxLength: 2
            };
            const result = await validator.testValidationRule(partialValidation, 'abc');
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(2);
        });
    });
    (0, globals_1.describe)('testComplexValidation', () => {
        (0, globals_1.it)('should call validator function if provided', async () => {
            const validator = new validator_1.Validator();
            const validatorFn = jest.fn().mockResolvedValue({ pass: true });
            const validationName = 'custom';
            const validationValue = { validator: validatorFn };
            const val = 'test';
            const result = await validator.testComplexValidation(validationName, validationValue, val);
            (0, globals_1.expect)(validatorFn).toHaveBeenCalledWith(val);
            (0, globals_1.expect)(result).toEqual({ pass: true });
        });
        (0, globals_1.it)('should call testValidation if no validator provided', async () => {
            const validator = new validator_1.Validator();
            const testValidationFn = jest.fn().mockResolvedValue({ pass: false });
            validator.testValidation = testValidationFn;
            const validationName = 'maxLength';
            const validationValue = { value: 5, message: "custom msg" };
            const val = 'test';
            const result = await validator.testComplexValidation(validationName, validationValue, val);
            (0, globals_1.expect)(testValidationFn).toHaveBeenCalledWith(validationName, validationValue.value, val);
            (0, globals_1.expect)(result).toEqual({ pass: false, customMessage: "custom msg" });
        });
        (0, globals_1.it)('should set custom message if provided', async () => {
            const validator = new validator_1.Validator();
            const validationName = 'maxLength';
            const message = 'Custom error message';
            const validationValue = { value: 5, message };
            const val = 'test';
            const result = await validator.testComplexValidation(validationName, validationValue, val);
            (0, globals_1.expect)(result.customMessage).toEqual(message);
        });
    });
    (0, globals_1.describe)('testValidation()', () => {
        const validator = new validator_1.Validator();
        (0, globals_1.it)('should validate required', async () => {
            const result_false = await validator.testValidation('required', true, undefined);
            (0, globals_1.expect)(result_false.pass).toBe(false);
            const result_true = await validator.testValidation('required', true, '');
            (0, globals_1.expect)(result_true.pass).toBe(true);
        });
        (0, globals_1.it)('should validate minLength', async () => {
            const result_false = await validator.testValidation('minLength', 5, 'abc');
            (0, globals_1.expect)(result_false.pass).toBe(false);
            const result_true = await validator.testValidation('minLength', 3, 'abc');
            (0, globals_1.expect)(result_true.pass).toBe(true);
        });
        (0, globals_1.it)('should validate maxLength', async () => {
            const result_false = await validator.testValidation('maxLength', 5, 'abcdef');
            (0, globals_1.expect)(result_false.pass).toBe(false);
            const result_true = await validator.testValidation('maxLength', 6, 'abcdef');
            (0, globals_1.expect)(result_true.pass).toBe(true);
        });
        (0, globals_1.it)('should validate pattern', async () => {
            const result = await validator.testValidation('pattern', /^[0-9]+$/, 'abc123');
            (0, globals_1.expect)(result.pass).toBe(false);
            const result2 = await validator.testValidation('pattern', /^[0-9]+$/, '12323232323');
            (0, globals_1.expect)(result2.pass).toBe(true);
        });
        (0, globals_1.it)('should validate datatype', async () => {
            const result = await validator.testValidation('datatype', 'number', '123');
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.describe)('validate data types', () => {
            (0, globals_1.it)('validates email', async () => {
                const result = await validator.testValidation('datatype', 'email', 'test@example.com');
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'email', 'invalid');
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
            (0, globals_1.it)('validates IP address', async () => {
                const result = await validator.testValidation('datatype', 'ip', '127.0.0.1');
                console.log(result);
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'ip', 'invalid');
                console.log(result2);
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
            (0, globals_1.it)('validates IPv4 address', async () => {
                const result = await validator.testValidation('datatype', 'ipv4', '127.0.0.1');
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'ipv4', '2001:db8::1');
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
            (0, globals_1.it)('validates IPv6 address', async () => {
                const result = await validator.testValidation('datatype', 'ipv6', '2001:db8::1');
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'ipv6', '127.0.0.1');
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
            (0, globals_1.it)('validates UUID', async () => {
                const result = await validator.testValidation('datatype', 'uuid', '123e4567-e89b-12d3-a456-426614174000');
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'uuid', 'invalid');
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
            (0, globals_1.it)('validates JSON', async () => {
                const result = await validator.testValidation('datatype', 'json', '{"x": "Y"}');
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'json', '{+}');
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
            (0, globals_1.it)('validates HttpURL', async () => {
                const result = await validator.testValidation('datatype', 'httpUrl', 'http://www.google.com');
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'httpUrl', 'httpqinv://www.google.com');
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
            (0, globals_1.it)('validates Date', async () => {
                const result = await validator.testValidation('datatype', 'date', '05/05/2000');
                (0, globals_1.expect)(result.pass).toBe(true);
                const result2 = await validator.testValidation('datatype', 'date', '144/155/2323');
                (0, globals_1.expect)(result2.pass).toBe(false);
            });
        });
        (0, globals_1.it)('should validate equality', async () => {
            const result_eq = await validator.testValidation('eq', 'abc', 'abc');
            (0, globals_1.expect)(result_eq.pass).toBe(true);
            const result_neq = await validator.testValidation('neq', 'abc', 'xxxx');
            (0, globals_1.expect)(result_neq.pass).toBe(true);
            const result_gt = await validator.testValidation('gt', 3232, 445454);
            (0, globals_1.expect)(result_gt.pass).toBe(true);
            const result_gte = await validator.testValidation('gte', 3232, 3232);
            (0, globals_1.expect)(result_gte.pass).toBe(true);
            const result_lt = await validator.testValidation('lt', 445454, 3232);
            (0, globals_1.expect)(result_lt.pass).toBe(true);
            const result_lte = await validator.testValidation('lte', 3232, 3232);
            (0, globals_1.expect)(result_lte.pass).toBe(true);
        });
        (0, globals_1.it)('should validate lists', async () => {
            const result_inList = await validator.testValidation('inList', ['a', 'b'], 'b');
            (0, globals_1.expect)(result_inList.pass).toBe(true);
            const result_notInList = await validator.testValidation('notInList', ['a', 'b'], 'c');
            (0, globals_1.expect)(result_notInList.pass).toBe(true);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdmFsaWRhdGlvbi92YWxpZGF0b3IudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUdBLDJDQUFxRDtBQUVyRCwyQ0FBdUM7QUFFdkMsSUFBQSxrQkFBUSxFQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUU7SUFFekIsSUFBQSxrQkFBUSxFQUFDLGtCQUFrQixFQUFFLEdBQUcsRUFBRTtRQUNoQyxNQUFNLFNBQVMsR0FBRyxJQUFJLHFCQUFTLEVBQUUsQ0FBQztRQUVsQyxJQUFBLFlBQUUsRUFBQyw2Q0FBNkMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMzRCxNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7Z0JBQzVDLGFBQWEsRUFBRSxRQUFRO2dCQUN2QixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsaUJBQWlCLEVBQUUsRUFBRTthQUN0QixDQUFDLENBQUM7WUFDSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUMvQixJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUNwQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLDZCQUE2QixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzNDLE1BQU0sS0FBSyxHQUFHO2dCQUNaLElBQUksRUFBRSxPQUFPO2FBQ2QsQ0FBQztZQUNGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLFFBQVE7Z0JBQ3ZCLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixpQkFBaUIsRUFBRTtvQkFDakIsS0FBSyxFQUFFO3dCQUNMLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFB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QUFDO0FBRUwsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBSZXF1ZXN0IH0gZnJvbSAnLi8uLi9pbnRlcmZhY2VzL3JlcXVlc3QnO1xuaW1wb3J0IHsgQ29tcGxleFZhbGlkYXRpb25SdWxlLCBFbnRpdHlWYWxpZGF0aW9ucywgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZSwgTWFwT2ZWYWxpZGF0aW9uQ29uZGl0aW9uLCBWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0IH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5pbXBvcnQgeyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgfSBmcm9tIFwiLi4vZW50aXR5XCI7XG5pbXBvcnQgeyBWYWxpZGF0b3J9IGZyb20gXCIuL3ZhbGlkYXRvclwiO1xuXG5kZXNjcmliZSgnVmFsaWRhdG9yJywgKCkgPT4ge1xuXG4gIGRlc2NyaWJlKCd2YWxpZGF0ZUVudGl0eSgpJywgKCkgPT4ge1xuICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIHZhbGlkYXRpb24gcGFzc2VkIGlmIG5vIHJ1bGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2NyZWF0ZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICd0ZXN0JyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGFjdG9yIHJ1bGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWN0b3IgPSB7XG4gICAgICAgIHJvbGU6ICdhZG1pbicgIFxuICAgICAgfTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdjcmVhdGUnLFxuICAgICAgICBlbnRpdHlOYW1lOiAndGVzdCcsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiB7XG4gICAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgIHJvbGU6IFt7IGVxOiAnYWRtaW4nIH1dXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBhY3RvclxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLndhcm4oJ3Nob3VsZCB2YWxpZGF0ZSBhY3RvciBydWxlcyByZXN1bHQ6JywgcmVzdWx0KTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGFjdG9yIHJ1bGUgZXJyb3JzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWN0b3IgPSB7XG4gICAgICAgIHJvbGU6ICd1c2VyJ1xuICAgICAgfTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdjcmVhdGUnLFxuICAgICAgICBlbnRpdHlOYW1lOiAndGVzdCcsXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsIFxuICAgICAgICB2ZXJib3NlRXJyb3JzOiB0cnVlLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczoge1xuICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICByb2xlOiBbeyBlcTogJ2FkbWluJyB9XSAgXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBhY3RvclxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzPy5bMF0/Lm1lc3NhZ2VJZHMpLnRvQ29udGFpbigndmFsaWRhdGlvbi5lbnRpdHkudGVzdC5hY3Rvci5yb2xlLmVxLmFkbWluJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGlucHV0IHJ1bGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5wdXQgPSB7XG4gICAgICAgIGVtYWlsOiAndGVzdEBleGFtcGxlLmNvbSdcbiAgICAgIH07XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnY3JlYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczoge1xuICAgICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgICBlbWFpbDogW3sgZGF0YXR5cGU6ICdlbWFpbCcgfV1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0ICBcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvRXF1YWwoW10pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gaW5wdXQgcnVsZSBlcnJvcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpbnB1dCA9IHtcbiAgICAgICAgZmlyc3ROYW1lOiAneHh4J1xuICAgICAgfTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdjcmVhdGUnLFxuICAgICAgICBlbnRpdHlOYW1lOiAndGVzdCcsXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsIFxuICAgICAgICB2ZXJib3NlRXJyb3JzOiB0cnVlLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczoge1xuICAgICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgICBmaXJzdE5hbWU6IFt7IG1pbkxlbmd0aDogMTAgfV1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnM/LlswXT8ubWVzc2FnZUlkcykudG9Db250YWluKCd2YWxpZGF0aW9uLmVudGl0eS50ZXN0LmZpcnN0bmFtZS5taW5sZW5ndGgnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3ZhbGlkYXRlSW5wdXQoKScsICgpID0+IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBwYXNzZWQgcmVzdWx0IHdoZW4gaW5wdXQgcGFzc2VzIHZhbGlkYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpbnB1dCA9IHtcbiAgICAgICAgbmFtZTogJ0pvaG4nLFxuICAgICAgICBhZ2U6IDMwXG4gICAgICB9O1xuICAgICAgY29uc3QgcnVsZXMgPSB7XG4gICAgICAgIG5hbWU6IHsgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgICAgYWdlOiB7IGd0OiAxOCB9ICBcbiAgICAgIH07XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVJbnB1dChpbnB1dCwgcnVsZXMpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbCh7fSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBmYWlsZWQgcmVzdWx0IHdoZW4gaW5wdXQgZmFpbHMgdmFsaWRhdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGlucHV0ID0geyAgXG4gICAgICAgIG5hbWU6ICdKb2huJ1xuICAgICAgfTtcbiAgICAgIGNvbnN0IHJ1bGVzID0ge1xuICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgIGFnZTogeyBndDogMTgsIHJlcXVpcmVkOiB0cnVlIH1cbiAgICAgIH07XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUlucHV0KGlucHV0LCBydWxlcyk7XG5cbiAgICAgIGNvbnNvbGUubG9nKHtyZXN1bHR9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKHtcbiAgICAgICAgYWdlOiBleHBlY3QuYW55KEFycmF5KSBcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBub3QgY29sbGVjdCBlcnJvcnMgd2hlbiBjb2xsZWN0RXJyb3JzIGlzIGZhbHNlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5wdXQgPSB7XG4gICAgICAgIG5hbWU6ICdKb2huJ1xuICAgICAgfTtcbiAgICAgIGNvbnN0IHJ1bGVzID0ge1xuICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgIGFnZTogeyBndDogMTggfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlSW5wdXQoaW5wdXQsIHJ1bGVzLCBmYWxzZSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKHt9KTtcbiAgICB9KTtcblxuICB9KTtcblxuICBkZXNjcmliZSgndmFsaWRhdGVIdHRwUmVxdWVzdCgpJywgKCkgPT4ge1xuICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgcmVxdWVzdCBib2R5JywgYXN5bmMgKCkgPT4ge1xuXG4gICAgICBjb25zdCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdCA9IHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIG5hbWU6ICdKb2huJyxcbiAgICAgICAgICBhZ2U6IDIwICBcbiAgICAgICAgfVxuICAgICAgfSBhcyBSZXF1ZXN0O1xuXG4gICAgICBjb25zdCB2YWxpZGF0aW9uczogSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyA9IHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIG5hbWU6IHsgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgICAgICBhZ2U6IHsgZ3Q6IDE4LCByZXF1aXJlZDogdHJ1ZSB9XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHsgcmVxdWVzdENvbnRleHQsIHZhbGlkYXRpb25zIH0pO1xuICAgICAgY29uc29sZS5sb2cocmVzdWx0KTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgcmVxdWVzdCBwYXJhbWV0ZXJzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3QgPSB7XG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgaWQ6ICcxMjMnXG4gICAgICAgIH1cbiAgICAgIH0gYXMgdW5rbm93biBhcyBSZXF1ZXN0O1xuICAgICAgY29uc3QgdmFsaWRhdGlvbnM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB7XG4gICAgICAgIHBhcmFtOiB7XG4gICAgICAgICAgaWQ6IHsgcmVxdWlyZWQ6IHRydWUgfSAgXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHtyZXF1ZXN0Q29udGV4dCwgdmFsaWRhdGlvbnN9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb2xsZWN0IGVycm9ycyBmb3IgZmFpbGVkIHZhbGlkYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3QgPSB7XG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBuYW1lOiAnSm9obicsXG4gICAgICAgIH1cbiAgICAgIH0gYXMgUmVxdWVzdDtcblxuICAgICAgY29uc3QgdmFsaWRhdGlvbnM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB7XG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgYWdlOiB7IGd0OiA0MCwgcmVxdWlyZWQ6IHRydWUgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBvdmVycmlkZGVuRXJyb3JNZXNzYWdlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KE9iamVjdC5lbnRyaWVzKHtcbiAgICAgICAgJ3ZhbGlkYXRpb24uaHR0cC5ib2R5LmFnZS5ndCc6ICdBZ2UgbXVzdCBiZSBncmVhdGVyIHRoYW4gNDAuLi4uJ1xuICAgICAgfSkpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7IHJlcXVlc3RDb250ZXh0LCB2YWxpZGF0aW9ucywgY29sbGVjdEVycm9yczogdHJ1ZSwgdmVyYm9zZUVycm9yczogdHJ1ZSwgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXMgfSk7XG5cbiAgICAgIGNvbnNvbGUubG9nKHtyZXN1bHR9KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvRXF1YWwoZXhwZWN0LmFueShBcnJheSkpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzPy5bMF0/Lm1lc3NhZ2VJZHMpLnRvQ29udGFpbigndmFsaWRhdGlvbi5odHRwLmJvZHkuYWdlLmd0Jyk7XG4gICAgfSk7XG5cbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3ZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlcygpJywgKCkgPT4ge1xuICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcbiAgICBjb25zdCBhbGxDb25kaXRpb25zOiBNYXBPZlZhbGlkYXRpb25Db25kaXRpb24gPSB7XG4gICAgICBjb25kaXRpb24xOiB7XG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgbmFtZTogeyBlcTogJ2FiYycgfVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgY29uZGl0aW9uMjoge1xuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFnZTogeyBlcTogMTggfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgcnVsZXMgd2hlbiBhbGwgY29uZGl0aW9ucyBwYXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcnVsZXM6IENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGU8YW55LCBhbnk+W10gPSBbe1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIGNvbmRpdGlvbnM6IFsgWydjb25kaXRpb24xJywgJ2NvbmRpdGlvbjInXSwgJ2FsbCddXG4gICAgICB9XTtcblxuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGVzKHtcbiAgICAgICAgcnVsZXMsXG4gICAgICAgIGFsbENvbmRpdGlvbnMsXG4gICAgICAgIGlucHV0VmFsOiBcInNvbWV0aGluZ19sb25nXCIsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgbmFtZTogJ2FiYycsXG4gICAgICAgICAgYWdlOiAxOFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICBjb25zdCByZXN1bHRfZmFpbCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZXMoe1xuICAgICAgICBydWxlcyxcbiAgICAgICAgYWxsQ29uZGl0aW9ucyxcbiAgICAgICAgaW5wdXRWYWw6IFwic29ydFwiLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG5hbWU6ICdhYmMnLFxuICAgICAgICAgIGFnZTogMThcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLmxvZyhyZXN1bHRfZmFpbCk7XG4gICAgICBleHBlY3QocmVzdWx0X2ZhaWwucGFzcykudG9CZShmYWxzZSk7XG5cbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2tpcCB2YWxpZGF0aW9uIGlmIGFueSBjb25kaXRpb24gZmFpbHMgd2hlbiBzY29wZSBpcyBcImFsbFwiJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcnVsZXM6IENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGU8YW55LCBhbnk+W10gPSBbe1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIGNvbmRpdGlvbnM6IFtbJ2NvbmRpdGlvbjEnLCAnY29uZGl0aW9uMiddLCAnYWxsJ11cbiAgICAgIH1dO1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGVzKHtcbiAgICAgICAgcnVsZXMsIFxuICAgICAgICBhbGxDb25kaXRpb25zLFxuICAgICAgICBpbnB1dFZhbDogXCJzb3J0XCIsIC8vIHZhbGlkYXRpb24gc2hvdWxkIGhhdmUgZmFpbGVkIGZvciB0aGlzIGlucHV0XG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgbmFtZTogJ3BxcicsIC8vIHRoZSBjb25kaXRpb24gd29uJ3QgYmUgYXBwbGllZCBmb3IgdGhpcyBpbnB1dFxuICAgICAgICAgIGFnZTogMThcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgaWYgYW55IGNvbmRpdGlvbiBmYWlscyB3aGVuIHNjb3BlIGlzIFwiYW55XCInLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBydWxlczogQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZTxhbnksIGFueT5bXSA9IFt7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgY29uZGl0aW9uczogW1snY29uZGl0aW9uMScsICdjb25kaXRpb24yJ10sICdhbnknXVxuICAgICAgfV07XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZXMoe1xuICAgICAgICBydWxlcywgXG4gICAgICAgIGFsbENvbmRpdGlvbnMsXG4gICAgICAgIGlucHV0VmFsOiBcInNvcnRcIixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBuYW1lOiAncHFyJyxcbiAgICAgICAgICBhZ2U6IDE4XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBza2lwIHZhbGlkYXRpb24gaWYgYW55IGNvbmRpdGlvbiBwYXNzZXMgd2hlbiBzY29wZSBpcyBcIm5vbmVcIicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJ1bGVzOiBDb25kaXRpb25hbFZhbGlkYXRpb25SdWxlPGFueSwgYW55PltdID0gW3tcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICBjb25kaXRpb25zOiBbWydjb25kaXRpb24xJywgJ2NvbmRpdGlvbjInXSwgJ25vbmUnXVxuICAgICAgfV07XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZXMoe1xuICAgICAgICBydWxlcywgXG4gICAgICAgIGFsbENvbmRpdGlvbnMsXG4gICAgICAgIGlucHV0VmFsOiBcInNvcnRcIiwgLy8gaW52YWxpZCBpbnB1dFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG5hbWU6ICdwcXInLFxuICAgICAgICAgIGFnZTogMThcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgd2hlbiBhbGwgY29uZGl0aW9uIGZhaWw7IHdoZW4gc2NvcGUgaXMgXCJub25lXCInLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBydWxlczogQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZTxhbnksIGFueT5bXSA9IFt7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgY29uZGl0aW9uczogW1snY29uZGl0aW9uMScsICdjb25kaXRpb24yJ10sICdub25lJ11cbiAgICAgIH1dO1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGVzKHtcbiAgICAgICAgcnVsZXMsIFxuICAgICAgICBhbGxDb25kaXRpb25zLFxuICAgICAgICBpbnB1dFZhbDogXCJzb3J0XCIsIC8vIGludmFsaWQgaW5wdXRcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBuYW1lOiAncHFyJyxcbiAgICAgICAgICBhZ2U6IDI0XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgndmFsaWRhdGVDb25kaXRpb25hbFJ1bGUoKScsICgpID0+IHtcbiAgICBjb25zdCBDT05ESVRJT046IE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbjxhbnksIHt9PiA9IHtcbiAgICAgICAgYWN0b3JJczEyMzoge1xuICAgICAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgICAgICBhY3RvcklkOiB7IGVxOiAnMTIzJyB9IFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfVxuICAgIH0gYXMgY29uc3Q7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJ1bGVzIGlmIGNyaXRlcmlhIHJ1bGVzIHBhc3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25SdWxlOiBDb25kaXRpb25hbFZhbGlkYXRpb25SdWxlPGFueSwgdHlwZW9mIENPTkRJVElPTj4gID0ge1xuICAgICAgICBjb25kaXRpb25zOiBbWydhY3RvcklzMTIzJ10sICdhbGwnXSxcbiAgICAgICAgbWluTGVuZ3RoOiAxMFxuICAgICAgfTtcblxuICAgICAgY29uc3QgYWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICcxMjMnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGUoe1xuICAgICAgICBydWxlOiB2YWxpZGF0aW9uUnVsZSwgXG4gICAgICAgIGFsbENvbmRpdGlvbnM6IENPTkRJVElPTiwgXG4gICAgICAgIGlucHV0VmFsOiAnaW5wdXQnLCBcbiAgICAgICAgaW5wdXQ6IHt9LCBcbiAgICAgICAgcmVjb3JkOiB7fSwgXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgICAgfSk7XG5cbiAgICAgIC8vIGNvbnNvbGUud2FybihKU09OLnN0cmluZ2lmeSh7cmVzdWx0fSkpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycz8uWzBdPy5tZXNzYWdlSWRzKS50b0NvbnRhaW4oJ21pbmxlbmd0aCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBza2lwIHZhbGlkYXRpb24gaWYgY3JpdGVyaWEgcnVsZXMgZmFpbCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcbiAgICAgIFxuICAgICAgY29uc3QgdmFsaWRhdGlvblJ1bGU6IENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGU8YW55LCB0eXBlb2YgQ09ORElUSU9OPiA9IHtcbiAgICAgICAgY29uZGl0aW9uczogW1snYWN0b3JJczEyMyddLCAnYWxsJ10sXG4gICAgICAgIG1pbkxlbmd0aDogNVxuICAgICAgfTtcblxuICAgICAgY29uc3QgYWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICc0NTYnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGUoe1xuICAgICAgICBydWxlOiB2YWxpZGF0aW9uUnVsZSwgXG4gICAgICAgIGFsbENvbmRpdGlvbnM6IENPTkRJVElPTiwgXG4gICAgICAgIGlucHV0VmFsOiAnaW4nLCBcbiAgICAgICAgaW5wdXQ6IHt9LCBcbiAgICAgICAgcmVjb3JkOiB7fSwgXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0JlKHVuZGVmaW5lZCk7XG4gICAgfSk7XG5cbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3Rlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGUnLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBjYWxsIGN1c3RvbSB2YWxpZGF0b3IgaWYgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCBjdXN0b21WYWxpZGF0b3IgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICBwYXNzOiB0cnVlXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgcnVsZTogQ29tcGxleFZhbGlkYXRpb25SdWxlPHN0cmluZz4gPSB7XG4gICAgICAgIHZhbGlkYXRvcjogY3VzdG9tVmFsaWRhdG9yXG4gICAgICB9O1xuICAgICAgXG4gICAgICBjb25zdCB2YWx1ZSA9ICd0ZXN0JztcbiAgICAgIFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGUocnVsZSwgdmFsdWUpO1xuICAgICAgXG4gICAgICBleHBlY3QoY3VzdG9tVmFsaWRhdG9yKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh2YWx1ZSwgdHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNhbGwgZGVmYXVsdCB2YWxpZGF0b3IgaWYgY3VzdG9tIG5vdCBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcbiAgICAgIGNvbnN0IGRlZmF1bHRWYWxpZGF0b3IgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICBwYXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3JzOiBbJ0Vycm9yISddXG4gICAgICB9KTtcblxuICAgICAgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uUnVsZSA9IGRlZmF1bHRWYWxpZGF0b3I7XG5cbiAgICAgIGNvbnN0IHJ1bGU6IFZhbGlkYXRpb25SdWxlPHN0cmluZz4gPSB7XG4gICAgICAgIG1heExlbmd0aDogNSBcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gJ3Rlc3QnO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZShydWxlLCB2YWx1ZSk7XG5cbiAgICAgIGV4cGVjdChkZWZhdWx0VmFsaWRhdG9yKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChydWxlLCB2YWx1ZSwgdHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvRXF1YWwoWydFcnJvciEnXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBjdXN0b20gbWVzc2FnZSBpZiBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcbiAgICAgIGNvbnN0IHJ1bGU6IENvbXBsZXhWYWxpZGF0aW9uUnVsZTxzdHJpbmc+ID0ge1xuICAgICAgICBtZXNzYWdlOiAnQ3VzdG9tIGVycm9yJ1xuICAgICAgfTtcbiAgICAgIFxuICAgICAgY29uc3QgdmFsdWUgPSAndGVzdCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlKHJ1bGUsIHZhbHVlKTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5jdXN0b21NZXNzYWdlKS50b0JlKCdDdXN0b20gZXJyb3InKTtcbiAgICB9KTtcblxuICB9KTtcblxuXG4gIGRlc2NyaWJlKCd0ZXN0VmFsaWRhdGlvblJ1bGUoKScsICgpID0+IHtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIHZhbGlkYXRpb24gcGFzc2VkIGlmIG5vIHJ1bGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uUnVsZSh7fSwgJ3Rlc3QnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIHZhbGlkYXRpb24gZXJyb3JzIGlmIHJ1bGVzIGZhaWwnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCBwYXJ0aWFsVmFsaWRhdGlvbiA9IHtcbiAgICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICAgIH07XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb25SdWxlKHBhcnRpYWxWYWxpZGF0aW9uLCB1bmRlZmluZWQpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNvbGxlY3QgbXVsdGlwbGUgdmFsaWRhdGlvbiBlcnJvcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCBwYXJ0aWFsVmFsaWRhdGlvbiA9IHtcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIG1pbkxlbmd0aDogNSxcbiAgICAgICAgbWF4TGVuZ3RoOiAyXG4gICAgICB9O1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uUnVsZShwYXJ0aWFsVmFsaWRhdGlvbiwgJ2FiYycpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgfSk7XG5cbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3Rlc3RDb21wbGV4VmFsaWRhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNhbGwgdmFsaWRhdG9yIGZ1bmN0aW9uIGlmIHByb3ZpZGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuICAgICAgY29uc3QgdmFsaWRhdG9yRm4gPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe3Bhc3M6IHRydWV9KTtcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25OYW1lID0gJ2N1c3RvbSc7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uVmFsdWUgPSB7dmFsaWRhdG9yOiB2YWxpZGF0b3JGbn07XG4gICAgICBjb25zdCB2YWwgPSAndGVzdCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0Q29tcGxleFZhbGlkYXRpb24odmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZSwgdmFsIGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdCh2YWxpZGF0b3JGbikudG9IYXZlQmVlbkNhbGxlZFdpdGgodmFsKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe3Bhc3M6IHRydWV9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY2FsbCB0ZXN0VmFsaWRhdGlvbiBpZiBubyB2YWxpZGF0b3IgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCB0ZXN0VmFsaWRhdGlvbkZuID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHtwYXNzOiBmYWxzZX0pO1xuICAgICAgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uID0gdGVzdFZhbGlkYXRpb25GbjtcblxuICAgICAgY29uc3QgdmFsaWRhdGlvbk5hbWUgPSAnbWF4TGVuZ3RoJztcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25WYWx1ZSA9IHt2YWx1ZTogNSwgbWVzc2FnZTogXCJjdXN0b20gbXNnXCJ9O1xuICAgICAgY29uc3QgdmFsID0gJ3Rlc3QnO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdENvbXBsZXhWYWxpZGF0aW9uKHZhbGlkYXRpb25OYW1lLCB2YWxpZGF0aW9uVmFsdWUsIHZhbCBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QodGVzdFZhbGlkYXRpb25GbikudG9IYXZlQmVlbkNhbGxlZFdpdGgodmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZS52YWx1ZSwgdmFsKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe3Bhc3M6IGZhbHNlLCBjdXN0b21NZXNzYWdlOiBcImN1c3RvbSBtc2dcIn0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzZXQgY3VzdG9tIG1lc3NhZ2UgaWYgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25OYW1lID0gJ21heExlbmd0aCc7XG4gICAgICBjb25zdCBtZXNzYWdlID0gJ0N1c3RvbSBlcnJvciBtZXNzYWdlJztcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25WYWx1ZSA9IHt2YWx1ZTogNSwgbWVzc2FnZX07XG4gICAgICBjb25zdCB2YWwgPSAndGVzdCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0Q29tcGxleFZhbGlkYXRpb24odmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZSwgdmFsIGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuY3VzdG9tTWVzc2FnZSkudG9FcXVhbChtZXNzYWdlKTtcbiAgICB9KTtcblxuICB9KTtcblxuICBkZXNjcmliZSgndGVzdFZhbGlkYXRpb24oKScsICgpID0+IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJlcXVpcmVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0X2ZhbHNlID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdyZXF1aXJlZCcsIHRydWUsIHVuZGVmaW5lZCk7XG4gICAgICBleHBlY3QocmVzdWx0X2ZhbHNlLnBhc3MpLnRvQmUoZmFsc2UpO1xuXG4gICAgICBjb25zdCByZXN1bHRfdHJ1ZSA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbiggJ3JlcXVpcmVkJywgdHJ1ZSwgJycpO1xuICAgICAgZXhwZWN0KHJlc3VsdF90cnVlLnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG1pbkxlbmd0aCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdF9mYWxzZSA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignbWluTGVuZ3RoJywgNSwgJ2FiYycpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9mYWxzZS5wYXNzKS50b0JlKGZhbHNlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X3RydWUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdtaW5MZW5ndGgnLCAzLCAnYWJjJyk7XG4gICAgICBleHBlY3QocmVzdWx0X3RydWUucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgbWF4TGVuZ3RoJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0X2ZhbHNlID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCAnbWF4TGVuZ3RoJywgNSwgJ2FiY2RlZicpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9mYWxzZS5wYXNzKS50b0JlKGZhbHNlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X3RydWUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdtYXhMZW5ndGgnLCAgNiwgJ2FiY2RlZicpO1xuICAgICAgZXhwZWN0KHJlc3VsdF90cnVlLnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHBhdHRlcm4nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdwYXR0ZXJuJywgL15bMC05XSskLywgJ2FiYzEyMycpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcblxuICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbigncGF0dGVybicsIC9eWzAtOV0rJC8sICcxMjMyMzIzMjMyMycpO1xuICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgZGF0YXR5cGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdkYXRhdHlwZScsICdudW1iZXInLCAnMTIzJyk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgndmFsaWRhdGUgZGF0YSB0eXBlcycsICgpID0+IHtcblxuICAgICAgaXQoJ3ZhbGlkYXRlcyBlbWFpbCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdlbWFpbCcsICd0ZXN0QGV4YW1wbGUuY29tJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgICBjb25zdCByZXN1bHQyID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdlbWFpbCcsICdpbnZhbGlkJyk7ICBcbiAgICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZShmYWxzZSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3ZhbGlkYXRlcyBJUCBhZGRyZXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwJywgJzEyNy4wLjAuMScpO1xuICAgICAgICBjb25zb2xlLmxvZyhyZXN1bHQpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnaXAnLCAnaW52YWxpZCcpO1xuICAgICAgICBjb25zb2xlLmxvZyhyZXN1bHQyKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZShmYWxzZSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3ZhbGlkYXRlcyBJUHY0IGFkZHJlc3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnaXB2NCcsICcxMjcuMC4wLjEnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwdjQnLCAnMjAwMTpkYjg6OjEnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZShmYWxzZSk7IFxuICAgICAgfSk7XG5cbiAgICAgIGl0KCd2YWxpZGF0ZXMgSVB2NiBhZGRyZXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwdjYnLCAnMjAwMTpkYjg6OjEnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwdjYnLCAnMTI3LjAuMC4xJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQyLnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCd2YWxpZGF0ZXMgVVVJRCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICd1dWlkJywgJzEyM2U0NTY3LWU4OWItMTJkMy1hNDU2LTQyNjYxNDE3NDAwMCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAndXVpZCcsICdpbnZhbGlkJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQyLnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCd2YWxpZGF0ZXMgSlNPTicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdqc29uJywgJ3tcInhcIjogXCJZXCJ9Jyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgICBjb25zdCByZXN1bHQyID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdqc29uJywgJ3srfScpO1xuICAgICAgICBleHBlY3QocmVzdWx0Mi5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgndmFsaWRhdGVzIEh0dHBVUkwnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnaHR0cFVybCcsICdodHRwOi8vd3d3Lmdvb2dsZS5jb20nKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2h0dHBVcmwnLCAnaHR0cHFpbnY6Ly93d3cuZ29vZ2xlLmNvbScpO1xuICAgICAgICBleHBlY3QocmVzdWx0Mi5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgndmFsaWRhdGVzIERhdGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnZGF0ZScsICcwNS8wNS8yMDAwJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgICBjb25zdCByZXN1bHQyID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdkYXRlJywgJzE0NC8xNTUvMjMyMycpO1xuICAgICAgICBleHBlY3QocmVzdWx0Mi5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIH0pO1xuXG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGVxdWFsaXR5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0X2VxID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdlcScsICdhYmMnLCAnYWJjJyk7XG4gICAgICBleHBlY3QocmVzdWx0X2VxLnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdF9uZXEgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ25lcScsICdhYmMnLCAneHh4eCcpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9uZXEucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X2d0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdndCcsIDMyMzIsIDQ0NTQ1NCk7XG4gICAgICBleHBlY3QocmVzdWx0X2d0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdF9ndGUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2d0ZScsIDMyMzIsIDMyMzIpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9ndGUucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X2x0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdsdCcsIDQ0NTQ1NCwgMzIzMik7XG4gICAgICBleHBlY3QocmVzdWx0X2x0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdF9sdGUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2x0ZScsIDMyMzIsIDMyMzIpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9sdGUucGFzcykudG9CZSh0cnVlKTtcblxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBsaXN0cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdF9pbkxpc3QgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2luTGlzdCcsIFsnYScsICdiJ10sICdiJyk7XG4gICAgICBleHBlY3QocmVzdWx0X2luTGlzdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICBjb25zdCByZXN1bHRfbm90SW5MaXN0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdub3RJbkxpc3QnLCBbJ2EnLCAnYiddLCAnYycpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9ub3RJbkxpc3QucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICB9KTtcblxufSk7Il19