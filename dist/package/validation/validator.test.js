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
                role: 'admin',
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z'
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
                role: 'user',
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z'
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
                actorId: '123',
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z'
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
                actorId: '456',
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z'
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdmFsaWRhdGlvbi92YWxpZGF0b3IudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUdBLDJDQUFxRDtBQUVyRCwyQ0FBdUM7QUFHdkMsSUFBQSxrQkFBUSxFQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUU7SUFFekIsSUFBQSxrQkFBUSxFQUFDLGtCQUFrQixFQUFFLEdBQUcsRUFBRTtRQUNoQyxNQUFNLFNBQVMsR0FBRyxJQUFJLHFCQUFTLEVBQUUsQ0FBQztRQUVsQyxJQUFBLFlBQUUsRUFBQyw2Q0FBNkMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMzRCxNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7Z0JBQzVDLGFBQWEsRUFBRSxRQUFRO2dCQUN2QixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsaUJBQWlCLEVBQUUsRUFBRTthQUN0QixDQUFDLENBQUM7WUFDSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUMvQixJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUNwQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLDZCQUE2QixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzNDLE1BQU0sS0FBSyxHQUFHO2dCQUNaLElBQUksRUFBRSxPQUFPO2dCQUNiLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixTQUFTLEVBQUUsMEJBQTBCO2FBQzdCLENBQUM7WUFDWCxNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7Z0JBQzVDLGFBQWEsRUFBRSxRQUFRO2dCQUN2QixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsaUJBQWlCLEVBQUU7b0JBQ2pCLEtBQUssRUFB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QyxJQUFJLENBQUMsQ0FBQztZQUVuQyxNQUFNLFNBQVMsR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztZQUNyRSxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUVsQyxNQUFNLFVBQVUsR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNyRSxJQUFBLGdCQUFNLEVBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUVuQyxNQUFNLFNBQVMsR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNyRSxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUVsQyxNQUFNLFVBQVUsR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNyRSxJQUFBLGdCQUFNLEVBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVyQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLHVCQUF1QixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3JDLE1BQU0sYUFBYSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDaEYsSUFBQSxnQkFBTSxFQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFFdEMsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUMsV0FBVyxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQ3RGLElBQUEsZ0JBQU0sRUFBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDM0MsQ0FBQyxDQUFDLENBQUM7SUFFTCxDQUFDLENBQUMsQ0FBQztBQUVMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUmVxdWVzdCB9IGZyb20gJy4vLi4vaW50ZXJmYWNlcy9yZXF1ZXN0JztcbmltcG9ydCB7IENvbXBsZXhWYWxpZGF0aW9uUnVsZSwgRW50aXR5VmFsaWRhdGlvbnMsIEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGUsIE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbiwgVmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbXBvcnQgeyBkZXNjcmliZSwgZXhwZWN0LCBpdCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xuaW1wb3J0IHsgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zIH0gZnJvbSBcIi4uL2VudGl0eVwiO1xuaW1wb3J0IHsgVmFsaWRhdG9yfSBmcm9tIFwiLi92YWxpZGF0b3JcIjtcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vY29yZS90eXBlcy9hY3Rvcic7XG5cbmRlc2NyaWJlKCdWYWxpZGF0b3InLCAoKSA9PiB7XG5cbiAgZGVzY3JpYmUoJ3ZhbGlkYXRlRW50aXR5KCknLCAoKSA9PiB7XG4gICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gdmFsaWRhdGlvbiBwYXNzZWQgaWYgbm8gcnVsZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnY3JlYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYWN0b3IgcnVsZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhY3RvciA9IHtcbiAgICAgICAgcm9sZTogJ2FkbWluJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWidcbiAgICAgIH0gYXMgQWN0b3I7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnY3JlYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczoge1xuICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICByb2xlOiBbeyBlcTogJ2FkbWluJyB9XVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgYWN0b3JcbiAgICAgIH0pO1xuICAgICAgY29uc29sZS53YXJuKCdzaG91bGQgdmFsaWRhdGUgYWN0b3IgcnVsZXMgcmVzdWx0OicsIHJlc3VsdCk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBhY3RvciBydWxlIGVycm9ycycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFjdG9yID0ge1xuICAgICAgICByb2xlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonXG4gICAgICB9IGFzIEFjdG9yO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnY3JlYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QnLFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLCBcbiAgICAgICAgdmVyYm9zZUVycm9yczogdHJ1ZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IHtcbiAgICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgcm9sZTogW3sgZXE6ICdhZG1pbicgfV0gIFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgYWN0b3JcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycz8uWzBdPy5tZXNzYWdlSWRzKS50b0NvbnRhaW4oJ3ZhbGlkYXRpb24uZW50aXR5LnRlc3QuYWN0b3Iucm9sZS5lcS5hZG1pbicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBpbnB1dCBydWxlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGlucHV0ID0ge1xuICAgICAgICBlbWFpbDogJ3Rlc3RAZXhhbXBsZS5jb20nXG4gICAgICB9O1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2NyZWF0ZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICd0ZXN0JyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IHtcbiAgICAgICAgICBpbnB1dDoge1xuICAgICAgICAgICAgZW1haWw6IFt7IGRhdGF0eXBlOiAnZW1haWwnIH1dXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dCAgXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGlucHV0IHJ1bGUgZXJyb3JzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5wdXQgPSB7XG4gICAgICAgIGZpcnN0TmFtZTogJ3h4eCdcbiAgICAgIH07XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnY3JlYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QnLFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLCBcbiAgICAgICAgdmVyYm9zZUVycm9yczogdHJ1ZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IHtcbiAgICAgICAgICBpbnB1dDoge1xuICAgICAgICAgICAgZmlyc3ROYW1lOiBbeyBtaW5MZW5ndGg6IDEwIH1dXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dFxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzPy5bMF0/Lm1lc3NhZ2VJZHMpLnRvQ29udGFpbigndmFsaWRhdGlvbi5lbnRpdHkudGVzdC5maXJzdG5hbWUubWlubGVuZ3RoJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCd2YWxpZGF0ZUlucHV0KCknLCAoKSA9PiB7XG4gICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gcGFzc2VkIHJlc3VsdCB3aGVuIGlucHV0IHBhc3NlcyB2YWxpZGF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5wdXQgPSB7XG4gICAgICAgIG5hbWU6ICdKb2huJyxcbiAgICAgICAgYWdlOiAzMFxuICAgICAgfTtcbiAgICAgIGNvbnN0IHJ1bGVzID0ge1xuICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgIGFnZTogeyBndDogMTggfSAgXG4gICAgICB9O1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlSW5wdXQoaW5wdXQsIHJ1bGVzKTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvRXF1YWwoe30pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gZmFpbGVkIHJlc3VsdCB3aGVuIGlucHV0IGZhaWxzIHZhbGlkYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpbnB1dCA9IHsgIFxuICAgICAgICBuYW1lOiAnSm9obidcbiAgICAgIH07XG4gICAgICBjb25zdCBydWxlcyA9IHtcbiAgICAgICAgbmFtZTogeyByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgICBhZ2U6IHsgZ3Q6IDE4LCByZXF1aXJlZDogdHJ1ZSB9XG4gICAgICB9O1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVJbnB1dChpbnB1dCwgcnVsZXMpO1xuXG4gICAgICBjb25zb2xlLmxvZyh7cmVzdWx0fSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbCh7XG4gICAgICAgIGFnZTogZXhwZWN0LmFueShBcnJheSkgXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbm90IGNvbGxlY3QgZXJyb3JzIHdoZW4gY29sbGVjdEVycm9ycyBpcyBmYWxzZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGlucHV0ID0ge1xuICAgICAgICBuYW1lOiAnSm9obidcbiAgICAgIH07XG4gICAgICBjb25zdCBydWxlcyA9IHtcbiAgICAgICAgbmFtZTogeyByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgICBhZ2U6IHsgZ3Q6IDE4IH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUlucHV0KGlucHV0LCBydWxlcywgZmFsc2UpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbCh7fSk7XG4gICAgfSk7XG5cbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3ZhbGlkYXRlSHR0cFJlcXVlc3QoKScsICgpID0+IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJlcXVlc3QgYm9keScsIGFzeW5jICgpID0+IHtcblxuICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3QgPSB7XG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBuYW1lOiAnSm9obicsXG4gICAgICAgICAgYWdlOiAyMCAgXG4gICAgICAgIH1cbiAgICAgIH0gYXMgUmVxdWVzdDtcblxuICAgICAgY29uc3QgdmFsaWRhdGlvbnM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB7XG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgYWdlOiB7IGd0OiAxOCwgcmVxdWlyZWQ6IHRydWUgfVxuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7IHJlcXVlc3RDb250ZXh0LCB2YWxpZGF0aW9ucyB9KTtcbiAgICAgIGNvbnNvbGUubG9nKHJlc3VsdCk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJlcXVlc3QgcGFyYW1ldGVycycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0ID0ge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGlkOiAnMTIzJ1xuICAgICAgICB9XG4gICAgICB9IGFzIHVua25vd24gYXMgUmVxdWVzdDtcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25zOiBIdHRwUmVxdWVzdFZhbGlkYXRpb25zID0ge1xuICAgICAgICBwYXJhbToge1xuICAgICAgICAgIGlkOiB7IHJlcXVpcmVkOiB0cnVlIH0gIFxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7cmVxdWVzdENvbnRleHQsIHZhbGlkYXRpb25zfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29sbGVjdCBlcnJvcnMgZm9yIGZhaWxlZCB2YWxpZGF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0ID0ge1xuICAgICAgICBib2R5OiB7XG4gICAgICAgICAgbmFtZTogJ0pvaG4nLFxuICAgICAgICB9XG4gICAgICB9IGFzIFJlcXVlc3Q7XG5cbiAgICAgIGNvbnN0IHZhbGlkYXRpb25zOiBIdHRwUmVxdWVzdFZhbGlkYXRpb25zID0ge1xuICAgICAgICBib2R5OiB7XG4gICAgICAgICAgbmFtZTogeyByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgICAgIGFnZTogeyBndDogNDAsIHJlcXVpcmVkOiB0cnVlIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPihPYmplY3QuZW50cmllcyh7XG4gICAgICAgICd2YWxpZGF0aW9uLmh0dHAuYm9keS5hZ2UuZ3QnOiAnQWdlIG11c3QgYmUgZ3JlYXRlciB0aGFuIDQwLi4uLidcbiAgICAgIH0pKTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlSHR0cFJlcXVlc3QoeyByZXF1ZXN0Q29udGV4dCwgdmFsaWRhdGlvbnMsIGNvbGxlY3RFcnJvcnM6IHRydWUsIHZlcmJvc2VFcnJvcnM6IHRydWUsIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzIH0pO1xuXG4gICAgICBjb25zb2xlLmxvZyh7cmVzdWx0fSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKGV4cGVjdC5hbnkoQXJyYXkpKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycz8uWzBdPy5tZXNzYWdlSWRzKS50b0NvbnRhaW4oJ3ZhbGlkYXRpb24uaHR0cC5ib2R5LmFnZS5ndCcpO1xuICAgIH0pO1xuXG4gIH0pO1xuXG4gIGRlc2NyaWJlKCd2YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZXMoKScsICgpID0+IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgY29uc3QgYWxsQ29uZGl0aW9uczogTWFwT2ZWYWxpZGF0aW9uQ29uZGl0aW9uID0ge1xuICAgICAgY29uZGl0aW9uMToge1xuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG5hbWU6IHsgZXE6ICdhYmMnIH1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGNvbmRpdGlvbjI6IHtcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBhZ2U6IHsgZXE6IDE4IH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJ1bGVzIHdoZW4gYWxsIGNvbmRpdGlvbnMgcGFzcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJ1bGVzOiBDb25kaXRpb25hbFZhbGlkYXRpb25SdWxlPGFueSwgYW55PltdID0gW3tcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICBjb25kaXRpb25zOiBbIFsnY29uZGl0aW9uMScsICdjb25kaXRpb24yJ10sICdhbGwnXVxuICAgICAgfV07XG5cblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlcyh7XG4gICAgICAgIHJ1bGVzLFxuICAgICAgICBhbGxDb25kaXRpb25zLFxuICAgICAgICBpbnB1dFZhbDogXCJzb21ldGhpbmdfbG9uZ1wiLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG5hbWU6ICdhYmMnLFxuICAgICAgICAgIGFnZTogMThcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X2ZhaWwgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGVzKHtcbiAgICAgICAgcnVsZXMsXG4gICAgICAgIGFsbENvbmRpdGlvbnMsXG4gICAgICAgIGlucHV0VmFsOiBcInNvcnRcIixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBuYW1lOiAnYWJjJyxcbiAgICAgICAgICBhZ2U6IDE4XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5sb2cocmVzdWx0X2ZhaWwpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9mYWlsLnBhc3MpLnRvQmUoZmFsc2UpO1xuXG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHNraXAgdmFsaWRhdGlvbiBpZiBhbnkgY29uZGl0aW9uIGZhaWxzIHdoZW4gc2NvcGUgaXMgXCJhbGxcIicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJ1bGVzOiBDb25kaXRpb25hbFZhbGlkYXRpb25SdWxlPGFueSwgYW55PltdID0gW3tcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICBjb25kaXRpb25zOiBbWydjb25kaXRpb24xJywgJ2NvbmRpdGlvbjInXSwgJ2FsbCddXG4gICAgICB9XTtcbiAgICAgIFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlcyh7XG4gICAgICAgIHJ1bGVzLCBcbiAgICAgICAgYWxsQ29uZGl0aW9ucyxcbiAgICAgICAgaW5wdXRWYWw6IFwic29ydFwiLCAvLyB2YWxpZGF0aW9uIHNob3VsZCBoYXZlIGZhaWxlZCBmb3IgdGhpcyBpbnB1dFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG5hbWU6ICdwcXInLCAvLyB0aGUgY29uZGl0aW9uIHdvbid0IGJlIGFwcGxpZWQgZm9yIHRoaXMgaW5wdXRcbiAgICAgICAgICBhZ2U6IDE4XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGlmIGFueSBjb25kaXRpb24gZmFpbHMgd2hlbiBzY29wZSBpcyBcImFueVwiJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcnVsZXM6IENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGU8YW55LCBhbnk+W10gPSBbe1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIGNvbmRpdGlvbnM6IFtbJ2NvbmRpdGlvbjEnLCAnY29uZGl0aW9uMiddLCAnYW55J11cbiAgICAgIH1dO1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGVzKHtcbiAgICAgICAgcnVsZXMsIFxuICAgICAgICBhbGxDb25kaXRpb25zLFxuICAgICAgICBpbnB1dFZhbDogXCJzb3J0XCIsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgbmFtZTogJ3BxcicsXG4gICAgICAgICAgYWdlOiAxOFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2tpcCB2YWxpZGF0aW9uIGlmIGFueSBjb25kaXRpb24gcGFzc2VzIHdoZW4gc2NvcGUgaXMgXCJub25lXCInLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBydWxlczogQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZTxhbnksIGFueT5bXSA9IFt7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgY29uZGl0aW9uczogW1snY29uZGl0aW9uMScsICdjb25kaXRpb24yJ10sICdub25lJ11cbiAgICAgIH1dO1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGVzKHtcbiAgICAgICAgcnVsZXMsIFxuICAgICAgICBhbGxDb25kaXRpb25zLFxuICAgICAgICBpbnB1dFZhbDogXCJzb3J0XCIsIC8vIGludmFsaWQgaW5wdXRcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBuYW1lOiAncHFyJyxcbiAgICAgICAgICBhZ2U6IDE4XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHdoZW4gYWxsIGNvbmRpdGlvbiBmYWlsOyB3aGVuIHNjb3BlIGlzIFwibm9uZVwiJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcnVsZXM6IENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGU8YW55LCBhbnk+W10gPSBbe1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIGNvbmRpdGlvbnM6IFtbJ2NvbmRpdGlvbjEnLCAnY29uZGl0aW9uMiddLCAnbm9uZSddXG4gICAgICB9XTtcbiAgICAgIFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlcyh7XG4gICAgICAgIHJ1bGVzLCBcbiAgICAgICAgYWxsQ29uZGl0aW9ucyxcbiAgICAgICAgaW5wdXRWYWw6IFwic29ydFwiLCAvLyBpbnZhbGlkIGlucHV0XG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgbmFtZTogJ3BxcicsXG4gICAgICAgICAgYWdlOiAyNFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3ZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlKCknLCAoKSA9PiB7XG4gICAgY29uc3QgQ09ORElUSU9OOiBNYXBPZlZhbGlkYXRpb25Db25kaXRpb248YW55LCB7fT4gPSB7XG4gICAgICAgIGFjdG9ySXMxMjM6IHtcbiAgICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICAgICAgYWN0b3JJZDogeyBlcTogJzEyMycgfSBcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH1cbiAgICB9IGFzIGNvbnN0O1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBydWxlcyBpZiBjcml0ZXJpYSBydWxlcyBwYXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuICAgICAgXG4gICAgICBjb25zdCB2YWxpZGF0aW9uUnVsZTogQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZTxhbnksIHR5cGVvZiBDT05ESVRJT04+ICA9IHtcbiAgICAgICAgY29uZGl0aW9uczogW1snYWN0b3JJczEyMyddLCAnYWxsJ10sXG4gICAgICAgIG1pbkxlbmd0aDogMTBcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnMTIzJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZSh7XG4gICAgICAgIHJ1bGU6IHZhbGlkYXRpb25SdWxlLCBcbiAgICAgICAgYWxsQ29uZGl0aW9uczogQ09ORElUSU9OLCBcbiAgICAgICAgaW5wdXRWYWw6ICdpbnB1dCcsIFxuICAgICAgICBpbnB1dDoge30sIFxuICAgICAgICByZWNvcmQ6IHt9LCBcbiAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgICB9KTtcblxuICAgICAgLy8gY29uc29sZS53YXJuKEpTT04uc3RyaW5naWZ5KHtyZXN1bHR9KSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzPy5bMF0/Lm1lc3NhZ2VJZHMpLnRvQ29udGFpbignbWlubGVuZ3RoJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHNraXAgdmFsaWRhdGlvbiBpZiBjcml0ZXJpYSBydWxlcyBmYWlsJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuICAgICAgXG4gICAgICBjb25zdCB2YWxpZGF0aW9uUnVsZTogQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZTxhbnksIHR5cGVvZiBDT05ESVRJT04+ID0ge1xuICAgICAgICBjb25kaXRpb25zOiBbWydhY3RvcklzMTIzJ10sICdhbGwnXSxcbiAgICAgICAgbWluTGVuZ3RoOiA1XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJzQ1NicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVDb25kaXRpb25hbFJ1bGUoe1xuICAgICAgICBydWxlOiB2YWxpZGF0aW9uUnVsZSwgXG4gICAgICAgIGFsbENvbmRpdGlvbnM6IENPTkRJVElPTiwgXG4gICAgICAgIGlucHV0VmFsOiAnaW4nLCBcbiAgICAgICAgaW5wdXQ6IHt9LCBcbiAgICAgICAgcmVjb3JkOiB7fSwgXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0JlKHVuZGVmaW5lZCk7XG4gICAgfSk7XG5cbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3Rlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGUnLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBjYWxsIGN1c3RvbSB2YWxpZGF0b3IgaWYgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCBjdXN0b21WYWxpZGF0b3IgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICBwYXNzOiB0cnVlXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgcnVsZTogQ29tcGxleFZhbGlkYXRpb25SdWxlPHN0cmluZz4gPSB7XG4gICAgICAgIHZhbGlkYXRvcjogY3VzdG9tVmFsaWRhdG9yXG4gICAgICB9O1xuICAgICAgXG4gICAgICBjb25zdCB2YWx1ZSA9ICd0ZXN0JztcbiAgICAgIFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGUocnVsZSwgdmFsdWUpO1xuICAgICAgXG4gICAgICBleHBlY3QoY3VzdG9tVmFsaWRhdG9yKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh2YWx1ZSwgdHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNhbGwgZGVmYXVsdCB2YWxpZGF0b3IgaWYgY3VzdG9tIG5vdCBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcbiAgICAgIGNvbnN0IGRlZmF1bHRWYWxpZGF0b3IgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe1xuICAgICAgICBwYXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3JzOiBbJ0Vycm9yISddXG4gICAgICB9KTtcblxuICAgICAgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uUnVsZSA9IGRlZmF1bHRWYWxpZGF0b3I7XG5cbiAgICAgIGNvbnN0IHJ1bGU6IFZhbGlkYXRpb25SdWxlPHN0cmluZz4gPSB7XG4gICAgICAgIG1heExlbmd0aDogNSBcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gJ3Rlc3QnO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZShydWxlLCB2YWx1ZSk7XG5cbiAgICAgIGV4cGVjdChkZWZhdWx0VmFsaWRhdG9yKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChydWxlLCB2YWx1ZSwgdHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvRXF1YWwoWydFcnJvciEnXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBjdXN0b20gbWVzc2FnZSBpZiBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3IoKTtcbiAgICAgIGNvbnN0IHJ1bGU6IENvbXBsZXhWYWxpZGF0aW9uUnVsZTxzdHJpbmc+ID0ge1xuICAgICAgICBtZXNzYWdlOiAnQ3VzdG9tIGVycm9yJ1xuICAgICAgfTtcbiAgICAgIFxuICAgICAgY29uc3QgdmFsdWUgPSAndGVzdCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlKHJ1bGUsIHZhbHVlKTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5jdXN0b21NZXNzYWdlKS50b0JlKCdDdXN0b20gZXJyb3InKTtcbiAgICB9KTtcblxuICB9KTtcblxuXG4gIGRlc2NyaWJlKCd0ZXN0VmFsaWRhdGlvblJ1bGUoKScsICgpID0+IHtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIHZhbGlkYXRpb24gcGFzc2VkIGlmIG5vIHJ1bGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uUnVsZSh7fSwgJ3Rlc3QnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIHZhbGlkYXRpb24gZXJyb3JzIGlmIHJ1bGVzIGZhaWwnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCBwYXJ0aWFsVmFsaWRhdGlvbiA9IHtcbiAgICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICAgIH07XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb25SdWxlKHBhcnRpYWxWYWxpZGF0aW9uLCB1bmRlZmluZWQpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNvbGxlY3QgbXVsdGlwbGUgdmFsaWRhdGlvbiBlcnJvcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCBwYXJ0aWFsVmFsaWRhdGlvbiA9IHtcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIG1pbkxlbmd0aDogNSxcbiAgICAgICAgbWF4TGVuZ3RoOiAyXG4gICAgICB9O1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uUnVsZShwYXJ0aWFsVmFsaWRhdGlvbiwgJ2FiYycpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgfSk7XG5cbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3Rlc3RDb21wbGV4VmFsaWRhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNhbGwgdmFsaWRhdG9yIGZ1bmN0aW9uIGlmIHByb3ZpZGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuICAgICAgY29uc3QgdmFsaWRhdG9yRm4gPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe3Bhc3M6IHRydWV9KTtcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25OYW1lID0gJ2N1c3RvbSc7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uVmFsdWUgPSB7dmFsaWRhdG9yOiB2YWxpZGF0b3JGbn07XG4gICAgICBjb25zdCB2YWwgPSAndGVzdCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0Q29tcGxleFZhbGlkYXRpb24odmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZSwgdmFsIGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdCh2YWxpZGF0b3JGbikudG9IYXZlQmVlbkNhbGxlZFdpdGgodmFsKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe3Bhc3M6IHRydWV9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY2FsbCB0ZXN0VmFsaWRhdGlvbiBpZiBubyB2YWxpZGF0b3IgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBjb25zdCB0ZXN0VmFsaWRhdGlvbkZuID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHtwYXNzOiBmYWxzZX0pO1xuICAgICAgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uID0gdGVzdFZhbGlkYXRpb25GbjtcblxuICAgICAgY29uc3QgdmFsaWRhdGlvbk5hbWUgPSAnbWF4TGVuZ3RoJztcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25WYWx1ZSA9IHt2YWx1ZTogNSwgbWVzc2FnZTogXCJjdXN0b20gbXNnXCJ9O1xuICAgICAgY29uc3QgdmFsID0gJ3Rlc3QnO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdENvbXBsZXhWYWxpZGF0aW9uKHZhbGlkYXRpb25OYW1lLCB2YWxpZGF0aW9uVmFsdWUsIHZhbCBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QodGVzdFZhbGlkYXRpb25GbikudG9IYXZlQmVlbkNhbGxlZFdpdGgodmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZS52YWx1ZSwgdmFsKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe3Bhc3M6IGZhbHNlLCBjdXN0b21NZXNzYWdlOiBcImN1c3RvbSBtc2dcIn0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzZXQgY3VzdG9tIG1lc3NhZ2UgaWYgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG4gICAgICBcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25OYW1lID0gJ21heExlbmd0aCc7XG4gICAgICBjb25zdCBtZXNzYWdlID0gJ0N1c3RvbSBlcnJvciBtZXNzYWdlJztcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25WYWx1ZSA9IHt2YWx1ZTogNSwgbWVzc2FnZX07XG4gICAgICBjb25zdCB2YWwgPSAndGVzdCc7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0Q29tcGxleFZhbGlkYXRpb24odmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZSwgdmFsIGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuY3VzdG9tTWVzc2FnZSkudG9FcXVhbChtZXNzYWdlKTtcbiAgICB9KTtcblxuICB9KTtcblxuICBkZXNjcmliZSgndGVzdFZhbGlkYXRpb24oKScsICgpID0+IHtcbiAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJlcXVpcmVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0X2ZhbHNlID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdyZXF1aXJlZCcsIHRydWUsIHVuZGVmaW5lZCk7XG4gICAgICBleHBlY3QocmVzdWx0X2ZhbHNlLnBhc3MpLnRvQmUoZmFsc2UpO1xuXG4gICAgICBjb25zdCByZXN1bHRfdHJ1ZSA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbiggJ3JlcXVpcmVkJywgdHJ1ZSwgJycpO1xuICAgICAgZXhwZWN0KHJlc3VsdF90cnVlLnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG1pbkxlbmd0aCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdF9mYWxzZSA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignbWluTGVuZ3RoJywgNSwgJ2FiYycpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9mYWxzZS5wYXNzKS50b0JlKGZhbHNlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X3RydWUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdtaW5MZW5ndGgnLCAzLCAnYWJjJyk7XG4gICAgICBleHBlY3QocmVzdWx0X3RydWUucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgbWF4TGVuZ3RoJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0X2ZhbHNlID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCAnbWF4TGVuZ3RoJywgNSwgJ2FiY2RlZicpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9mYWxzZS5wYXNzKS50b0JlKGZhbHNlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X3RydWUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdtYXhMZW5ndGgnLCAgNiwgJ2FiY2RlZicpO1xuICAgICAgZXhwZWN0KHJlc3VsdF90cnVlLnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHBhdHRlcm4nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdwYXR0ZXJuJywgL15bMC05XSskLywgJ2FiYzEyMycpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcblxuICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbigncGF0dGVybicsIC9eWzAtOV0rJC8sICcxMjMyMzIzMjMyMycpO1xuICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgZGF0YXR5cGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oICdkYXRhdHlwZScsICdudW1iZXInLCAnMTIzJyk7XG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgndmFsaWRhdGUgZGF0YSB0eXBlcycsICgpID0+IHtcblxuICAgICAgaXQoJ3ZhbGlkYXRlcyBlbWFpbCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdlbWFpbCcsICd0ZXN0QGV4YW1wbGUuY29tJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgICBjb25zdCByZXN1bHQyID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdlbWFpbCcsICdpbnZhbGlkJyk7ICBcbiAgICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZShmYWxzZSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3ZhbGlkYXRlcyBJUCBhZGRyZXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwJywgJzEyNy4wLjAuMScpO1xuICAgICAgICBjb25zb2xlLmxvZyhyZXN1bHQpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnaXAnLCAnaW52YWxpZCcpO1xuICAgICAgICBjb25zb2xlLmxvZyhyZXN1bHQyKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZShmYWxzZSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3ZhbGlkYXRlcyBJUHY0IGFkZHJlc3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnaXB2NCcsICcxMjcuMC4wLjEnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwdjQnLCAnMjAwMTpkYjg6OjEnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdDIucGFzcykudG9CZShmYWxzZSk7IFxuICAgICAgfSk7XG5cbiAgICAgIGl0KCd2YWxpZGF0ZXMgSVB2NiBhZGRyZXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwdjYnLCAnMjAwMTpkYjg6OjEnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2lwdjYnLCAnMTI3LjAuMC4xJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQyLnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCd2YWxpZGF0ZXMgVVVJRCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICd1dWlkJywgJzEyM2U0NTY3LWU4OWItMTJkMy1hNDU2LTQyNjYxNDE3NDAwMCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAndXVpZCcsICdpbnZhbGlkJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQyLnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCd2YWxpZGF0ZXMgSlNPTicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdqc29uJywgJ3tcInhcIjogXCJZXCJ9Jyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgICBjb25zdCByZXN1bHQyID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdqc29uJywgJ3srfScpO1xuICAgICAgICBleHBlY3QocmVzdWx0Mi5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgndmFsaWRhdGVzIEh0dHBVUkwnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnaHR0cFVybCcsICdodHRwOi8vd3d3Lmdvb2dsZS5jb20nKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2RhdGF0eXBlJywgJ2h0dHBVcmwnLCAnaHR0cHFpbnY6Ly93d3cuZ29vZ2xlLmNvbScpO1xuICAgICAgICBleHBlY3QocmVzdWx0Mi5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgndmFsaWRhdGVzIERhdGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci50ZXN0VmFsaWRhdGlvbignZGF0YXR5cGUnLCAnZGF0ZScsICcwNS8wNS8yMDAwJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgICBjb25zdCByZXN1bHQyID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdkYXRhdHlwZScsICdkYXRlJywgJzE0NC8xNTUvMjMyMycpO1xuICAgICAgICBleHBlY3QocmVzdWx0Mi5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIH0pO1xuXG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGVxdWFsaXR5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0X2VxID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdlcScsICdhYmMnLCAnYWJjJyk7XG4gICAgICBleHBlY3QocmVzdWx0X2VxLnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdF9uZXEgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ25lcScsICdhYmMnLCAneHh4eCcpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9uZXEucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X2d0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdndCcsIDMyMzIsIDQ0NTQ1NCk7XG4gICAgICBleHBlY3QocmVzdWx0X2d0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdF9ndGUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2d0ZScsIDMyMzIsIDMyMzIpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9ndGUucGFzcykudG9CZSh0cnVlKTtcblxuICAgICAgY29uc3QgcmVzdWx0X2x0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdsdCcsIDQ0NTQ1NCwgMzIzMik7XG4gICAgICBleHBlY3QocmVzdWx0X2x0LnBhc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdF9sdGUgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2x0ZScsIDMyMzIsIDMyMzIpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9sdGUucGFzcykudG9CZSh0cnVlKTtcblxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBsaXN0cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdF9pbkxpc3QgPSBhd2FpdCB2YWxpZGF0b3IudGVzdFZhbGlkYXRpb24oJ2luTGlzdCcsIFsnYScsICdiJ10sICdiJyk7XG4gICAgICBleHBlY3QocmVzdWx0X2luTGlzdC5wYXNzKS50b0JlKHRydWUpO1xuXG4gICAgICBjb25zdCByZXN1bHRfbm90SW5MaXN0ID0gYXdhaXQgdmFsaWRhdG9yLnRlc3RWYWxpZGF0aW9uKCdub3RJbkxpc3QnLCBbJ2EnLCAnYiddLCAnYycpO1xuICAgICAgZXhwZWN0KHJlc3VsdF9ub3RJbkxpc3QucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICB9KTtcblxufSk7Il19