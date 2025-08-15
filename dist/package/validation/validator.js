"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Validator = void 0;
const logging_1 = require("../logging");
const utils_1 = require("../utils");
const utils_2 = require("./utils");
/**
 * Validates input data against a set of validation rules.
 * Supports validating against different criteria via the CriteriaSet.
 * Handles validating at multiple levels (actor, input, record).
 * Returns whether validation passed and any errors.
*/
class Validator {
    logger = (0, logging_1.createLogger)(Validator.name);
    DEFAULT_MAX_STRING_LENGTH = 1000000; // 1M chars
    DEFAULT_MAX_ARRAY_LENGTH = 10000; // 10K items
    /**
     * Validates input data against a set of validation rules with criteria.
     * Handles validating at multiple levels (actor, input, record) based on the options passed in.
     * Returns whether validation passed and any errors.
    */
    async validateEntity(options) {
        const { entityValidations, entityName, operationName, input, actor, record, collectErrors = true, verboseErrors = false, overriddenErrorMessages } = options;
        const result = {
            pass: true,
            errors: []
        };
        if (!entityValidations) {
            return result;
        }
        const opsValidationRules = (0, utils_2.extractOpValidationFromEntityValidations)(operationName, entityValidations);
        const { conditions } = opsValidationRules;
        for (const ruleType of ['actor', 'input', 'record']) {
            const typeRules = opsValidationRules['opValidations'][ruleType];
            if (!typeRules) {
                continue;
            }
            for (const key in typeRules) {
                const validationsWithCriteria = typeRules[key];
                if (!validationsWithCriteria) {
                    continue;
                }
                const inputVal = ruleType == 'actor' ? actor?.[key]
                    : ruleType == 'input' ? input?.[key]
                        : ruleType == 'record' ? record?.[key]
                            : undefined;
                const res = await this.validateConditionalRules({
                    actor,
                    input,
                    record,
                    rules: validationsWithCriteria,
                    inputVal: inputVal,
                    allConditions: conditions,
                });
                result.pass = result.pass && res.pass;
                if (collectErrors && res.errors?.length) {
                    res.errors.forEach(err => {
                        err.messageIds = (0, utils_2.makeEntityValidationMessageIds)(entityName, ruleType, key, err.messageIds ?? []);
                        err.path = err.path ?? [];
                        err.path.push(key);
                        err.path.push(ruleType);
                        err['message'] = (0, utils_2.makeValidationErrorMessage)(err, overriddenErrorMessages);
                        result.errors?.push(verboseErrors ? err : { path: err.path, message: err.message });
                    });
                }
            }
        }
        return result;
    }
    /**
     * Tests validations rules for the given input object against the provided validation rules.
     *
     * @param input - The input object to validate.
     * @param rules - The validation rules to test, where each key is a key on the input object.
     * @returns Whether the input passed all the validation rules.
     */
    async validateInput(input, rules, collectErrors = true) {
        if (!rules) {
            return { pass: true, errors: {} };
        }
        const result = {
            pass: true,
            errors: {},
        };
        for (const key in rules) {
            const thisRule = rules[key];
            if (!thisRule) {
                continue;
            }
            const thisVal = input ? input[key] : undefined;
            // Add safety check for extremely large values
            if (thisVal !== undefined) {
                if (typeof thisVal === 'string' && thisVal.length > this.DEFAULT_MAX_STRING_LENGTH) {
                    result.pass = false;
                    if (collectErrors) {
                        result.errors[key] = [{
                                messageIds: ['validation.error.string.toolong'],
                                customMessage: `String exceeds maximum length of ${this.DEFAULT_MAX_STRING_LENGTH} characters`
                            }];
                    }
                    continue;
                }
                if (Array.isArray(thisVal) && thisVal.length > this.DEFAULT_MAX_ARRAY_LENGTH) {
                    result.pass = false;
                    if (collectErrors) {
                        result.errors[key] = [{
                                messageIds: ['validation.error.array.toolong'],
                                customMessage: `Array exceeds maximum length of ${this.DEFAULT_MAX_ARRAY_LENGTH} items`
                            }];
                    }
                    continue;
                }
            }
            const validationRes = await this.testComplexValidationRule(thisRule, thisVal);
            result.pass = result.pass && validationRes.pass;
            if (collectErrors && validationRes.errors && validationRes.errors.length) {
                result.errors[key] = validationRes.errors?.map(err => {
                    const path = err.path ?? [];
                    if (!path.includes(key)) {
                        path.push(key);
                    }
                    return { ...err, path };
                });
            }
        }
        return result;
    }
    /**
     * Tests validations rules for the given input object against the provided validation rules.
     *
     * @param input - The input object to validate.
     * @param rules - The validation rules to test, where each key is a key on the input object.
     * @returns Whether the input passed all the validation rules.
     */
    async validateHttpRequest(options) {
        const { requestContext, validations, collectErrors = true, verboseErrors = false, overriddenErrorMessages } = options;
        const res = {
            pass: true,
            errors: [],
        };
        for (const validationType of ['body', 'param', 'query', 'header']) {
            const typeValidationRules = validations[validationType];
            if (!typeValidationRules) {
                continue;
            }
            let validationInput = {};
            if (validationType == 'body') {
                validationInput = requestContext.body;
            }
            else if (validationType == 'param') {
                validationInput = requestContext.pathParameters;
            }
            else if (validationType == 'query') {
                validationInput = requestContext.queryStringParameters;
            }
            else if (validationType == 'header') {
                validationInput = requestContext.headers;
            }
            const inputValidationResult = await this.validateInput(validationInput, typeValidationRules);
            res.pass = res.pass && inputValidationResult.pass;
            if (collectErrors && !inputValidationResult.pass) {
                for (const prop in inputValidationResult.errors) {
                    const propErrors = inputValidationResult.errors[prop] ?? [];
                    propErrors.forEach(error => {
                        error.path = error.path ?? [];
                        error.path.push(validationType);
                        const httpValidationMessageIds = (0, utils_2.makeHttpValidationMessageIds)({
                            validationType,
                            propertyName: prop,
                            errorMessageIds: error.messageIds || []
                        });
                        error.messageIds = httpValidationMessageIds;
                        error.message = (0, utils_2.makeValidationErrorMessage)(error, overriddenErrorMessages);
                        res.errors?.push(verboseErrors ? error : { path: error.path, message: error.message });
                    });
                }
            }
        }
        return res;
    }
    /**
     * Validates an array of validation rules with criteria against the provided input value, input object, record object, and actor.
     *
     * @param rules - The array of validation rules with criteria to validate
     * @param inputVal - The input value to validate
     * @param input - The input object containing the full input
     * @param record - The record object containing the full record
     * @param actor - The actor object containing actor information
     * @returns A promise resolving to an object containing a boolean indicating if validation passed, and any validation errors
     */
    async validateConditionalRules(options) {
        const { rules, allConditions, inputVal, input, record, actor } = options;
        const result = {
            pass: true,
            errors: [],
        };
        const results = await Promise.all(rules.map(async (rule) => {
            return this.validateConditionalRule({
                rule,
                input,
                actor,
                record,
                inputVal,
                allConditions,
            });
        }));
        for (const ruleResult of results) {
            result.pass = result.pass && ruleResult.pass;
            if (ruleResult.errors) {
                result.errors.push(...ruleResult.errors);
            }
            if (ruleResult.customMessage || ruleResult.customMessageId) {
                result.errors.push({
                    customMessage: ruleResult.customMessage,
                    customMessageId: ruleResult.customMessageId,
                });
            }
        }
        return result;
    }
    /**
     * Validates a validation rule that has criteria, to determine if the
     * criteria is met before running the validation.
     *
     * Checks if the criteria conditions match the input, record, and actor.
     * If criteria passes, runs the validation rule and returns errors.
     * Handles 'any' and 'all' criteria conditions.
     *
     * @param rule - The validation rule with criteria
     * @param allConditions - map of entity-validation-conditions that are used by the rule
     * @param inputVal - The input value to validate
     * @param input - The full input object
     * @param record - The record to check criteria against
     * @param actor - The actor to check criteria against
     * @returns A promise resolving to validation results
     */
    async validateConditionalRule(options) {
        const { rule, allConditions, inputVal, input, record, actor } = options;
        const { conditions: ruleConditions, ...partialValidation } = rule;
        const criteriaPassed = await this.testConditions({
            conditions: ruleConditions,
            allConditions,
            inputVal,
            input,
            record,
            actor,
        });
        const result = {
            pass: true,
        };
        if (criteriaPassed) {
            let validation = await this.testComplexValidationRule(partialValidation, inputVal);
            result.pass = result.pass && validation.pass;
            result.errors = validation.errors;
            if (validation.customMessage) {
                result.customMessage = validation.customMessage;
            }
            if (validation.customMessageId) {
                result.customMessageId = validation.customMessageId;
            }
        }
        return result;
    }
    async testConditions(options) {
        const { conditions, allConditions, inputVal, input, record, actor } = options;
        let criteriaPassed = true;
        const formattedConditions = {
            scope: 'all',
            conditionNames: [],
        };
        /**
         * Conditions ==> ['actorIs123', 'ppp', 'qqq'] | [ ['actorIs123', 'ppp', 'qqq'], 'all' ]
         */
        if (Array.isArray(conditions)) {
            if ((0, utils_2.isConditionsAndScopeTuple)(conditions)) {
                const [conditionNames, scope] = conditions;
                formattedConditions.scope = scope,
                    formattedConditions.conditionNames = conditionNames;
            }
            else {
                formattedConditions.conditionNames = conditions;
            }
        }
        if (formattedConditions.conditionNames.length) {
            if (formattedConditions.scope == 'any') {
                criteriaPassed = false;
                for (const conditionName of formattedConditions.conditionNames) {
                    const ctRule = allConditions[conditionName];
                    const applicable = await this.testCondition(ctRule, input, record, actor);
                    if (applicable) {
                        // * test for applicability
                        // if any of them passes, we are good to go
                        // else continue
                        criteriaPassed = true;
                        break;
                    }
                }
            }
            else {
                criteriaPassed = true;
                for (const conditionName of formattedConditions.conditionNames) {
                    const ctRule = allConditions[conditionName];
                    const applicable = await this.testCondition(ctRule, input, record, actor);
                    // * test for applicability
                    // if any of them passes the validation does not apply
                    // else continue
                    if (formattedConditions.scope == 'none' && applicable) {
                        criteriaPassed = false;
                        break;
                    }
                    // * test for NOT-applicability
                    // if any of them fails the validation does not apply
                    // else continue;
                    else if (formattedConditions.scope == 'all' && !applicable) {
                        criteriaPassed = false;
                        break;
                    }
                }
            }
        }
        return criteriaPassed;
    }
    /**
     * Tests if the given criteria is applicable for the provided input, record
     * and actor. Evaluates the actorRules, inputRules and recordRules in the
     * criteria to determine if it is applicable.
     */
    async testCondition(criteria, input, record, actor) {
        const { actor: actorRules, input: inputRules, record: recordRules } = criteria;
        let applicable = true;
        if (actorRules) {
            const result = await this.validateInput(actor, actorRules, false);
            applicable = applicable && result.pass;
        }
        if (applicable && inputRules) {
            const result = await this.validateInput(input, inputRules, false);
            applicable = applicable && result.pass;
        }
        if (applicable && recordRules) {
            const result = await this.validateInput(record, recordRules, false);
            applicable = applicable && result.pass;
        }
        return applicable;
    }
    async testComplexValidationRule(complexValidationRule, val, collectErrors = true) {
        let res = {
            pass: true,
            errors: []
        };
        const { message: customMessage, validator: customValidatorForRule, messageId: customMessageId, ...validationRule } = complexValidationRule;
        if (customValidatorForRule) {
            res = await customValidatorForRule(val, collectErrors);
        }
        else {
            res = await this.testValidationRule(validationRule, val, collectErrors);
        }
        res.customMessage = customMessage ?? res.customMessage;
        res.customMessageId = customMessageId ?? res.customMessageId;
        return res;
    }
    /**
     * Validates the given partial validation rules against the provided value,
     * returning a result indicating if it passed and any validation errors.
     *
     * Loops through the partial validation rules object, running each validation
     * rule against the value. Collects any errors and tracks if any validation failed.
     *
     * Returns an object containing a boolean indicating if all validations passed,
     * and any errors encountered.
    */
    async testValidationRule(validationRule, val, collectErrors = true) {
        const res = {
            pass: true,
            errors: []
        };
        // * validate one rule at a time
        for (const validationName in validationRule) {
            let testValidationResult;
            let validationValue = validationRule[validationName];
            if ((0, utils_2.isComplexValidationValue)(validationValue)) {
                testValidationResult = await this.testComplexValidation(validationName, validationValue, val);
            }
            else {
                testValidationResult = await this.testValidation(validationName, validationValue, val);
            }
            res.pass = res.pass && testValidationResult.pass;
            if (collectErrors && !testValidationResult.pass) {
                const errorMessageIds = (0, utils_2.makeValidationErrorMessageIds)(validationName, validationValue);
                const validationError = {
                    messageIds: errorMessageIds,
                    expected: testValidationResult.expected,
                    received: testValidationResult.received,
                };
                if ((0, utils_2.isTestComplexValidationResult)(testValidationResult)) {
                    if (testValidationResult.customMessageId) {
                        validationError.customMessageId = testValidationResult.customMessageId;
                    }
                    if (testValidationResult.customMessage) {
                        validationError.customMessage = testValidationResult.customMessage;
                    }
                }
                res.errors.push(validationError);
            }
        }
        return res;
    }
    async testComplexValidation(validationName, validationValue, val) {
        let result = { pass: true };
        if ((0, utils_2.isComplexValidationValueWithValidator)(validationValue)) {
            result = await validationValue.validator(val);
        }
        else if ((0, utils_2.isComplexValidationValueWithMessage)(validationValue)) {
            result = await this.testValidation(validationName, validationValue.value, val);
        }
        // validator fn can return it's own message or it can be defined at the validation level
        result.customMessage = result.customMessage || validationValue.message;
        result.customMessageId = result.customMessageId || validationValue.messageId;
        return result;
    }
    /**
     * Validates a value against a set of validation rules.
     *
     * @param partialValidation - The validation rules to check, e.g. {required: true, minLength: 5}.
     * @param val - The value to validate.
     * @returns True if the value passes all validations, false otherwise. Can also return validation error objects.
    */
    async testValidation(validationName, validationValue, val) {
        const result = {
            pass: true,
            received: [val],
            expected: [validationName, validationValue],
        };
        try {
            switch (validationName) {
                case 'required':
                    result.pass = (val !== undefined && val !== null);
                    break;
                case 'minLength':
                    result.pass = val && val.length >= validationValue;
                    result.received = [val, val?.length || 0];
                    break;
                case 'maxLength':
                    result.pass = val && val.length <= validationValue;
                    result.received = [val, val?.length || 0];
                    break;
                case 'pattern':
                    result.pass = val && validationValue.test(String(val));
                    break;
                case 'eq':
                    result.pass = val === validationValue;
                    break;
                case 'neq':
                    result.pass = val !== validationValue;
                    break;
                case 'gt':
                    result.pass = Number(val) > Number(validationValue);
                    break;
                case 'gte':
                    result.pass = Number(val) >= Number(validationValue);
                    break;
                case 'lt':
                    result.pass = Number(val) < Number(validationValue);
                    break;
                case 'lte':
                    result.pass = Number(val) <= Number(validationValue);
                    break;
                case 'inList':
                    result.pass = Array.isArray(validationValue) && validationValue.includes(val);
                    break;
                case 'notInList':
                    result.pass = Array.isArray(validationValue) && !validationValue.includes(val);
                    break;
                case 'unique':
                    result.pass = (0, utils_1.isUnique)(val);
                    break;
                case 'custom':
                    if (typeof validationValue !== 'function') {
                        this.logger.warn(new Error(`Invalid custom validation rule: ${JSON.stringify({ [validationName]: validationValue })}`));
                        result.pass = false;
                    }
                    else {
                        result.pass = await validationValue(val);
                    }
                    break;
                case 'datatype':
                    result.pass = await this.validateDataType(validationValue, val);
                    break;
                default:
                    this.logger.warn(`Unknown validation type: ${validationName}`);
                    result.pass = false;
            }
        }
        catch (error) {
            this.logger.error('Validation error:', error);
            result.pass = false;
            result.error = error instanceof Error ? error.message : 'Unknown validation error';
        }
        return result;
    }
    async validateDataType(type, val) {
        if (val === undefined || val === null) {
            return false;
        }
        switch (type) {
            case 'number':
                return (0, utils_1.isNumericString)(val);
            case 'email':
                return (0, utils_1.isEmail)(val);
            case 'ip':
                return (0, utils_1.isIP)(val);
            case 'ipv4':
                return (0, utils_1.isIPv4)(val);
            case 'ipv6':
                return (0, utils_1.isIPv6)(val);
            case 'uuid':
                return (0, utils_1.isUUID)(val);
            case 'json':
                return (0, utils_1.isJsonString)(val);
            case 'date':
                return (0, utils_1.isDateString)(val);
            case 'httpUrl':
                return (0, utils_1.isHttpUrlString)(val);
            default:
                return typeof val === type;
        }
    }
}
exports.Validator = Validator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3ZhbGlkYXRpb24vdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUtBLHdDQUEwQztBQUMxQyxvQ0FBeUk7QUFFekksbUNBQTRWO0FBRTVWOzs7OztFQUtFO0FBQ0YsTUFBYSxTQUFTO0lBQ1QsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDOUIseUJBQXlCLEdBQUcsT0FBTyxDQUFDLENBQUMsV0FBVztJQUNoRCx3QkFBd0IsR0FBRyxLQUFLLENBQUMsQ0FBQyxZQUFZO0lBRS9EOzs7O01BSUU7SUFDRixLQUFLLENBQUMsY0FBYyxDQU1oQixPQUFrRTtRQUlsRSxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsVUFBVSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFDdEUsYUFBYSxHQUFHLElBQUksRUFDcEIsYUFBYSxHQUFHLEtBQUssRUFDckIsdUJBQXVCLEVBQzFCLEdBQUcsT0FBTyxDQUFDO1FBRVosTUFBTSxNQUFNLEdBQW9CO1lBQzVCLElBQUksRUFBRSxJQUFJO1lBQ1YsTUFBTSxFQUFFLEVBQUU7U0FDYixDQUFBO1FBRUQsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDckIsT0FBTyxNQUFNLENBQUE7UUFDakIsQ0FBQztRQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBQSxnREFBd0MsRUFBQyxhQUFhLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztRQUV0RyxNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsa0JBQWtCLENBQUM7UUFFMUMsS0FBSyxNQUFNLFFBQVEsSUFBSSxDQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFXLEVBQUUsQ0FBQztZQUM3RCxNQUFNLFNBQVMsR0FBRyxrQkFBa0IsQ0FBRSxlQUFlLENBQUUsQ0FBRSxRQUFRLENBQUUsQ0FB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QUFTO2dCQUNWLE9BQU8sSUFBQSx1QkFBZSxFQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2hDO2dCQUNJLE9BQU8sT0FBTyxHQUFHLEtBQUssSUFBSSxDQUFDO1FBQ25DLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUF2cUJELDhCQXVxQkMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIERlZmluZXMgdmFsaWRhdGlvbiBydWxlcyBhbmQgY3JpdGVyaWEgdGhhdCBjYW4gYmUgdXNlZCB0byB2YWxpZGF0ZSBpbnB1dCwgcmVjb3JkLCBhbmQgYWN0b3IgZGF0YS5cbiAqIFByb3ZpZGVzIGEgVmFsaWRhdG9yIGNsYXNzIHRoYXQgdmFsaWRhdGVzIGRhdGEgYWdhaW5zdCBkZWZpbmVkIHZhbGlkYXRpb24gcnVsZXMgYW5kIGNyaXRlcmlhLlxuICovXG5pbXBvcnQgeyBFbnRpdHlTY2hlbWEsIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMgfSBmcm9tIFwiLi4vZW50aXR5XCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgaXNEYXRlU3RyaW5nLCBpc0VtYWlsLCBpc0h0dHBVcmxTdHJpbmcsIGlzSVAsIGlzSVB2NCwgaXNJUHY2LCBpc0pzb25TdHJpbmcsIGlzTnVtZXJpY1N0cmluZywgaXNVVUlELCBpc1VuaXF1ZSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgQWN0b3IsIENvbXBsZXhWYWxpZGF0aW9uUnVsZSwgQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZSwgRW50aXR5VmFsaWRhdGlvbkNvbmRpdGlvbiwgVmFsaWRhdG9yUmVzdWx0LCBJVmFsaWRhdG9yLCBJbnB1dFR5cGUsIElucHV0VmFsaWRhdGlvblJlc3VsdCwgSW5wdXRWYWxpZGF0aW9uUnVsZSwgTWFwT2ZWYWxpZGF0aW9uQ29uZGl0aW9uLCBPcFZhbGlkYXRvck9wdGlvbnMsIFJlY29yZFR5cGUsIFRDb21wbGV4VmFsaWRhdGlvblZhbHVlLCBUVmFsaWRhdGlvblZhbHVlLCBUZXN0Q29tcGxleFZhbGlkYXRpb25SZXN1bHQsIFRlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGVSZXN1bHQsIFRlc3RWYWxpZGF0aW9uUmVzdWx0LCBUZXN0VmFsaWRhdGlvblJ1bGVSZXN1bHQsIFZhbGlkYXRlSHR0cFJlcXVlc3RPcHRpb25zLCBWYWxpZGF0aW9uRXJyb3IsIFZhbGlkYXRpb25SdWxlLCBWYWxpZGF0aW9ucyB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zLCBpc0NvbXBsZXhWYWxpZGF0aW9uVmFsdWUsIGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZVdpdGhNZXNzYWdlLCBpc0NvbXBsZXhWYWxpZGF0aW9uVmFsdWVXaXRoVmFsaWRhdG9yLCBpc0NvbmRpdGlvbnNBbmRTY29wZVR1cGxlLCBpc1Rlc3RDb21wbGV4VmFsaWRhdGlvblJlc3VsdCwgbWFrZUVudGl0eVZhbGlkYXRpb25NZXNzYWdlSWRzLCBtYWtlSHR0cFZhbGlkYXRpb25NZXNzYWdlSWRzLCBtYWtlVmFsaWRhdGlvbkVycm9yTWVzc2FnZSwgbWFrZVZhbGlkYXRpb25FcnJvck1lc3NhZ2VJZHMgfSBmcm9tIFwiLi91dGlsc1wiO1xuXG4vKipcbiAqIFZhbGlkYXRlcyBpbnB1dCBkYXRhIGFnYWluc3QgYSBzZXQgb2YgdmFsaWRhdGlvbiBydWxlcy4gXG4gKiBTdXBwb3J0cyB2YWxpZGF0aW5nIGFnYWluc3QgZGlmZmVyZW50IGNyaXRlcmlhIHZpYSB0aGUgQ3JpdGVyaWFTZXQuXG4gKiBIYW5kbGVzIHZhbGlkYXRpbmcgYXQgbXVsdGlwbGUgbGV2ZWxzIChhY3RvciwgaW5wdXQsIHJlY29yZCkuXG4gKiBSZXR1cm5zIHdoZXRoZXIgdmFsaWRhdGlvbiBwYXNzZWQgYW5kIGFueSBlcnJvcnMuXG4qL1xuZXhwb3J0IGNsYXNzIFZhbGlkYXRvciBpbXBsZW1lbnRzIElWYWxpZGF0b3Ige1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihWYWxpZGF0b3IubmFtZSk7XG4gICAgcHJpdmF0ZSByZWFkb25seSBERUZBVUxUX01BWF9TVFJJTkdfTEVOR1RIID0gMTAwMDAwMDsgLy8gMU0gY2hhcnNcbiAgICBwcml2YXRlIHJlYWRvbmx5IERFRkFVTFRfTUFYX0FSUkFZX0xFTkdUSCA9IDEwMDAwOyAvLyAxMEsgaXRlbXNcblxuICAgIC8qKlxuICAgICAqIFZhbGlkYXRlcyBpbnB1dCBkYXRhIGFnYWluc3QgYSBzZXQgb2YgdmFsaWRhdGlvbiBydWxlcyB3aXRoIGNyaXRlcmlhLlxuICAgICAqIEhhbmRsZXMgdmFsaWRhdGluZyBhdCBtdWx0aXBsZSBsZXZlbHMgKGFjdG9yLCBpbnB1dCwgcmVjb3JkKSBiYXNlZCBvbiB0aGUgb3B0aW9ucyBwYXNzZWQgaW4uXG4gICAgICogUmV0dXJucyB3aGV0aGVyIHZhbGlkYXRpb24gcGFzc2VkIGFuZCBhbnkgZXJyb3JzLlxuICAgICovXG4gICAgYXN5bmMgdmFsaWRhdGVFbnRpdHk8XG4gICAgICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICAgICAgT3BOYW1lIGV4dGVuZHMga2V5b2YgU2NoWyAnbW9kZWwnIF1bICdlbnRpdHlPcGVyYXRpb25zJyBdLFxuICAgICAgICBDb25kaXRpb25zTWFwIGV4dGVuZHMgTWFwT2ZWYWxpZGF0aW9uQ29uZGl0aW9uPGFueSwgYW55PixcbiAgICAgICAgT3BzSW5wU2NoIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuICAgID4oXG4gICAgICAgIG9wdGlvbnM6IE9wVmFsaWRhdG9yT3B0aW9uczxTY2gsIE9wTmFtZSwgQ29uZGl0aW9uc01hcCwgT3BzSW5wU2NoPlxuXG4gICAgKTogUHJvbWlzZTxWYWxpZGF0b3JSZXN1bHQ+IHtcblxuICAgICAgICBjb25zdCB7IGVudGl0eVZhbGlkYXRpb25zLCBlbnRpdHlOYW1lLCBvcGVyYXRpb25OYW1lLCBpbnB1dCwgYWN0b3IsIHJlY29yZCxcbiAgICAgICAgICAgIGNvbGxlY3RFcnJvcnMgPSB0cnVlLFxuICAgICAgICAgICAgdmVyYm9zZUVycm9ycyA9IGZhbHNlLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXNcbiAgICAgICAgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0OiBWYWxpZGF0b3JSZXN1bHQgPSB7XG4gICAgICAgICAgICBwYXNzOiB0cnVlLFxuICAgICAgICAgICAgZXJyb3JzOiBbXVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFlbnRpdHlWYWxpZGF0aW9ucykge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgb3BzVmFsaWRhdGlvblJ1bGVzID0gZXh0cmFjdE9wVmFsaWRhdGlvbkZyb21FbnRpdHlWYWxpZGF0aW9ucyhvcGVyYXRpb25OYW1lLCBlbnRpdHlWYWxpZGF0aW9ucyk7XG5cbiAgICAgICAgY29uc3QgeyBjb25kaXRpb25zIH0gPSBvcHNWYWxpZGF0aW9uUnVsZXM7XG5cbiAgICAgICAgZm9yIChjb25zdCBydWxlVHlwZSBvZiBbICdhY3RvcicsICdpbnB1dCcsICdyZWNvcmQnIF0gYXMgY29uc3QpIHtcbiAgICAgICAgICAgIGNvbnN0IHR5cGVSdWxlcyA9IG9wc1ZhbGlkYXRpb25SdWxlc1sgJ29wVmFsaWRhdGlvbnMnIF1bIHJ1bGVUeXBlIF07XG4gICAgICAgICAgICBpZiAoIXR5cGVSdWxlcykgeyBjb250aW51ZTsgfVxuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiB0eXBlUnVsZXMpIHtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkYXRpb25zV2l0aENyaXRlcmlhID0gdHlwZVJ1bGVzWyBrZXkgYXMga2V5b2YgdHlwZW9mIHR5cGVSdWxlcyBdO1xuICAgICAgICAgICAgICAgIGlmICghdmFsaWRhdGlvbnNXaXRoQ3JpdGVyaWEpIHsgY29udGludWU7IH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGlucHV0VmFsID0gcnVsZVR5cGUgPT0gJ2FjdG9yJyA/IGFjdG9yPy5bIGtleSBdXG4gICAgICAgICAgICAgICAgICAgIDogcnVsZVR5cGUgPT0gJ2lucHV0JyA/IGlucHV0Py5bIGtleSBdXG4gICAgICAgICAgICAgICAgICAgICAgICA6IHJ1bGVUeXBlID09ICdyZWNvcmQnID8gcmVjb3JkPy5bIGtleSBdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLnZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlcyh7XG4gICAgICAgICAgICAgICAgICAgIGFjdG9yLFxuICAgICAgICAgICAgICAgICAgICBpbnB1dCxcbiAgICAgICAgICAgICAgICAgICAgcmVjb3JkLFxuICAgICAgICAgICAgICAgICAgICBydWxlczogdmFsaWRhdGlvbnNXaXRoQ3JpdGVyaWEsXG4gICAgICAgICAgICAgICAgICAgIGlucHV0VmFsOiBpbnB1dFZhbCxcbiAgICAgICAgICAgICAgICAgICAgYWxsQ29uZGl0aW9uczogY29uZGl0aW9ucyBhcyBNYXBPZlZhbGlkYXRpb25Db25kaXRpb24sXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IHJlc3VsdC5wYXNzICYmIHJlcy5wYXNzO1xuXG4gICAgICAgICAgICAgICAgaWYgKGNvbGxlY3RFcnJvcnMgJiYgcmVzLmVycm9ycz8ubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcy5lcnJvcnMuZm9yRWFjaChlcnIgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyLm1lc3NhZ2VJZHMgPSBtYWtlRW50aXR5VmFsaWRhdGlvbk1lc3NhZ2VJZHMoZW50aXR5TmFtZSwgcnVsZVR5cGUsIGtleSwgZXJyLm1lc3NhZ2VJZHMgPz8gW10pO1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyLnBhdGggPSBlcnIucGF0aCA/PyBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVyci5wYXRoLnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVyci5wYXRoLnB1c2gocnVsZVR5cGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyWyAnbWVzc2FnZScgXSA9IG1ha2VWYWxpZGF0aW9uRXJyb3JNZXNzYWdlKGVyciwgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXMpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQuZXJyb3JzPy5wdXNoKHZlcmJvc2VFcnJvcnMgPyBlcnIgOiB7IHBhdGg6IGVyci5wYXRoLCBtZXNzYWdlOiBlcnIubWVzc2FnZSB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUZXN0cyB2YWxpZGF0aW9ucyBydWxlcyBmb3IgdGhlIGdpdmVuIGlucHV0IG9iamVjdCBhZ2FpbnN0IHRoZSBwcm92aWRlZCB2YWxpZGF0aW9uIHJ1bGVzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpbnB1dCAtIFRoZSBpbnB1dCBvYmplY3QgdG8gdmFsaWRhdGUuXG4gICAgICogQHBhcmFtIHJ1bGVzIC0gVGhlIHZhbGlkYXRpb24gcnVsZXMgdG8gdGVzdCwgd2hlcmUgZWFjaCBrZXkgaXMgYSBrZXkgb24gdGhlIGlucHV0IG9iamVjdC5cbiAgICAgKiBAcmV0dXJucyBXaGV0aGVyIHRoZSBpbnB1dCBwYXNzZWQgYWxsIHRoZSB2YWxpZGF0aW9uIHJ1bGVzLlxuICAgICAqL1xuICAgIGFzeW5jIHZhbGlkYXRlSW5wdXQ8SSBleHRlbmRzIElucHV0VHlwZT4oXG4gICAgICAgIGlucHV0OiBJIHwgdW5kZWZpbmVkLFxuICAgICAgICBydWxlcz86IElucHV0VmFsaWRhdGlvblJ1bGU8ST4sXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IGJvb2xlYW4gPSB0cnVlXG4gICAgKTogUHJvbWlzZTxJbnB1dFZhbGlkYXRpb25SZXN1bHQ8ST4+IHtcbiAgICAgICAgaWYgKCFydWxlcykge1xuICAgICAgICAgICAgcmV0dXJuIHsgcGFzczogdHJ1ZSwgZXJyb3JzOiB7fSB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzdWx0OiBJbnB1dFZhbGlkYXRpb25SZXN1bHQ8ST4gPSB7XG4gICAgICAgICAgICBwYXNzOiB0cnVlLFxuICAgICAgICAgICAgZXJyb3JzOiB7fSxcbiAgICAgICAgfTtcblxuICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBydWxlcykge1xuICAgICAgICAgICAgY29uc3QgdGhpc1J1bGUgPSBydWxlc1sga2V5IF07XG4gICAgICAgICAgICBpZiAoIXRoaXNSdWxlKSB7IGNvbnRpbnVlOyB9XG5cbiAgICAgICAgICAgIGNvbnN0IHRoaXNWYWwgPSBpbnB1dCA/IGlucHV0WyBrZXkgXSA6IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgLy8gQWRkIHNhZmV0eSBjaGVjayBmb3IgZXh0cmVtZWx5IGxhcmdlIHZhbHVlc1xuICAgICAgICAgICAgaWYgKHRoaXNWYWwgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpc1ZhbCA9PT0gJ3N0cmluZycgJiYgdGhpc1ZhbC5sZW5ndGggPiB0aGlzLkRFRkFVTFRfTUFYX1NUUklOR19MRU5HVEgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbGxlY3RFcnJvcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5lcnJvcnMhWyBrZXkgXSA9IFsge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VJZHM6IFsgJ3ZhbGlkYXRpb24uZXJyb3Iuc3RyaW5nLnRvb2xvbmcnIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VzdG9tTWVzc2FnZTogYFN0cmluZyBleGNlZWRzIG1heGltdW0gbGVuZ3RoIG9mICR7dGhpcy5ERUZBVUxUX01BWF9TVFJJTkdfTEVOR1RIfSBjaGFyYWN0ZXJzYFxuICAgICAgICAgICAgICAgICAgICAgICAgfSBdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh0aGlzVmFsKSAmJiB0aGlzVmFsLmxlbmd0aCA+IHRoaXMuREVGQVVMVF9NQVhfQVJSQVlfTEVOR1RIKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjb2xsZWN0RXJyb3JzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQuZXJyb3JzIVsga2V5IF0gPSBbIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlSWRzOiBbICd2YWxpZGF0aW9uLmVycm9yLmFycmF5LnRvb2xvbmcnIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VzdG9tTWVzc2FnZTogYEFycmF5IGV4Y2VlZHMgbWF4aW11bSBsZW5ndGggb2YgJHt0aGlzLkRFRkFVTFRfTUFYX0FSUkFZX0xFTkdUSH0gaXRlbXNgXG4gICAgICAgICAgICAgICAgICAgICAgICB9IF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzID0gYXdhaXQgdGhpcy50ZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlPGFueT4odGhpc1J1bGUsIHRoaXNWYWwpO1xuICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSByZXN1bHQucGFzcyAmJiB2YWxpZGF0aW9uUmVzLnBhc3M7XG5cbiAgICAgICAgICAgIGlmIChjb2xsZWN0RXJyb3JzICYmIHZhbGlkYXRpb25SZXMuZXJyb3JzICYmIHZhbGlkYXRpb25SZXMuZXJyb3JzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5lcnJvcnMhWyBrZXkgXSA9IHZhbGlkYXRpb25SZXMuZXJyb3JzPy5tYXAoZXJyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGF0aCA9IGVyci5wYXRoID8/IFtdO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXBhdGguaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5wdXNoKGtleSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgLi4uZXJyLCBwYXRoIH07XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRlc3RzIHZhbGlkYXRpb25zIHJ1bGVzIGZvciB0aGUgZ2l2ZW4gaW5wdXQgb2JqZWN0IGFnYWluc3QgdGhlIHByb3ZpZGVkIHZhbGlkYXRpb24gcnVsZXMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGlucHV0IG9iamVjdCB0byB2YWxpZGF0ZS5cbiAgICAgKiBAcGFyYW0gcnVsZXMgLSBUaGUgdmFsaWRhdGlvbiBydWxlcyB0byB0ZXN0LCB3aGVyZSBlYWNoIGtleSBpcyBhIGtleSBvbiB0aGUgaW5wdXQgb2JqZWN0LlxuICAgICAqIEByZXR1cm5zIFdoZXRoZXIgdGhlIGlucHV0IHBhc3NlZCBhbGwgdGhlIHZhbGlkYXRpb24gcnVsZXMuXG4gICAgICovXG4gICAgYXN5bmMgdmFsaWRhdGVIdHRwUmVxdWVzdDxcbiAgICAgICAgSGVhZGVyIGV4dGVuZHMgSW5wdXRUeXBlID0gSW5wdXRUeXBlLFxuICAgICAgICBCb2R5IGV4dGVuZHMgSW5wdXRUeXBlID0gSW5wdXRUeXBlLFxuICAgICAgICBQYXJhbSBleHRlbmRzIElucHV0VHlwZSA9IElucHV0VHlwZSxcbiAgICAgICAgUXVlcnkgZXh0ZW5kcyBJbnB1dFR5cGUgPSBJbnB1dFR5cGUsXG4gICAgPihcblxuICAgICAgICBvcHRpb25zOiBWYWxpZGF0ZUh0dHBSZXF1ZXN0T3B0aW9uczxIZWFkZXIsIEJvZHksIFBhcmFtLCBRdWVyeT5cblxuICAgICk6IFByb21pc2U8VmFsaWRhdG9yUmVzdWx0PiB7XG5cbiAgICAgICAgY29uc3QgeyByZXF1ZXN0Q29udGV4dCwgdmFsaWRhdGlvbnMsIGNvbGxlY3RFcnJvcnMgPSB0cnVlLCB2ZXJib3NlRXJyb3JzID0gZmFsc2UsIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IHJlczogVmFsaWRhdG9yUmVzdWx0ID0ge1xuICAgICAgICAgICAgcGFzczogdHJ1ZSxcbiAgICAgICAgICAgIGVycm9yczogW10sXG4gICAgICAgIH07XG5cbiAgICAgICAgZm9yIChjb25zdCB2YWxpZGF0aW9uVHlwZSBvZiBbICdib2R5JywgJ3BhcmFtJywgJ3F1ZXJ5JywgJ2hlYWRlcicgXSBhcyBjb25zdCkge1xuICAgICAgICAgICAgY29uc3QgdHlwZVZhbGlkYXRpb25SdWxlcyA9IHZhbGlkYXRpb25zWyB2YWxpZGF0aW9uVHlwZSBdO1xuICAgICAgICAgICAgaWYgKCF0eXBlVmFsaWRhdGlvblJ1bGVzKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCB2YWxpZGF0aW9uSW5wdXQ6IGFueSA9IHt9O1xuXG4gICAgICAgICAgICBpZiAodmFsaWRhdGlvblR5cGUgPT0gJ2JvZHknKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvbklucHV0ID0gcmVxdWVzdENvbnRleHQuYm9keTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodmFsaWRhdGlvblR5cGUgPT0gJ3BhcmFtJykge1xuICAgICAgICAgICAgICAgIHZhbGlkYXRpb25JbnB1dCA9IHJlcXVlc3RDb250ZXh0LnBhdGhQYXJhbWV0ZXJzO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh2YWxpZGF0aW9uVHlwZSA9PSAncXVlcnknKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvbklucHV0ID0gcmVxdWVzdENvbnRleHQucXVlcnlTdHJpbmdQYXJhbWV0ZXJzO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh2YWxpZGF0aW9uVHlwZSA9PSAnaGVhZGVyJykge1xuICAgICAgICAgICAgICAgIHZhbGlkYXRpb25JbnB1dCA9IHJlcXVlc3RDb250ZXh0LmhlYWRlcnM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGlucHV0VmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGVJbnB1dDx0eXBlb2YgdmFsaWRhdGlvbklucHV0Pih2YWxpZGF0aW9uSW5wdXQsIHR5cGVWYWxpZGF0aW9uUnVsZXMpO1xuXG4gICAgICAgICAgICByZXMucGFzcyA9IHJlcy5wYXNzICYmIGlucHV0VmFsaWRhdGlvblJlc3VsdC5wYXNzO1xuXG4gICAgICAgICAgICBpZiAoY29sbGVjdEVycm9ycyAmJiAhaW5wdXRWYWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcblxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcHJvcCBpbiBpbnB1dFZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb3BFcnJvcnMgPSBpbnB1dFZhbGlkYXRpb25SZXN1bHQuZXJyb3JzWyBwcm9wIF0gPz8gW107XG5cbiAgICAgICAgICAgICAgICAgICAgcHJvcEVycm9ycy5mb3JFYWNoKGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLnBhdGggPSBlcnJvci5wYXRoID8/IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IucGF0aC5wdXNoKHZhbGlkYXRpb25UeXBlKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaHR0cFZhbGlkYXRpb25NZXNzYWdlSWRzID0gbWFrZUh0dHBWYWxpZGF0aW9uTWVzc2FnZUlkcyh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvblR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydHlOYW1lOiBwcm9wLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZUlkczogZXJyb3IubWVzc2FnZUlkcyB8fCBbXVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5tZXNzYWdlSWRzID0gaHR0cFZhbGlkYXRpb25NZXNzYWdlSWRzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5tZXNzYWdlID0gbWFrZVZhbGlkYXRpb25FcnJvck1lc3NhZ2UoZXJyb3IsIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzLmVycm9ycz8ucHVzaCh2ZXJib3NlRXJyb3JzID8gZXJyb3IgOiB7IHBhdGg6IGVycm9yLnBhdGgsIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVmFsaWRhdGVzIGFuIGFycmF5IG9mIHZhbGlkYXRpb24gcnVsZXMgd2l0aCBjcml0ZXJpYSBhZ2FpbnN0IHRoZSBwcm92aWRlZCBpbnB1dCB2YWx1ZSwgaW5wdXQgb2JqZWN0LCByZWNvcmQgb2JqZWN0LCBhbmQgYWN0b3IuXG4gICAgICogXG4gICAgICogQHBhcmFtIHJ1bGVzIC0gVGhlIGFycmF5IG9mIHZhbGlkYXRpb24gcnVsZXMgd2l0aCBjcml0ZXJpYSB0byB2YWxpZGF0ZVxuICAgICAqIEBwYXJhbSBpbnB1dFZhbCAtIFRoZSBpbnB1dCB2YWx1ZSB0byB2YWxpZGF0ZVxuICAgICAqIEBwYXJhbSBpbnB1dCAtIFRoZSBpbnB1dCBvYmplY3QgY29udGFpbmluZyB0aGUgZnVsbCBpbnB1dFxuICAgICAqIEBwYXJhbSByZWNvcmQgLSBUaGUgcmVjb3JkIG9iamVjdCBjb250YWluaW5nIHRoZSBmdWxsIHJlY29yZFxuICAgICAqIEBwYXJhbSBhY3RvciAtIFRoZSBhY3RvciBvYmplY3QgY29udGFpbmluZyBhY3RvciBpbmZvcm1hdGlvblxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSByZXNvbHZpbmcgdG8gYW4gb2JqZWN0IGNvbnRhaW5pbmcgYSBib29sZWFuIGluZGljYXRpbmcgaWYgdmFsaWRhdGlvbiBwYXNzZWQsIGFuZCBhbnkgdmFsaWRhdGlvbiBlcnJvcnNcbiAgICAgKi9cbiAgICBhc3luYyB2YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZXM8SSBleHRlbmRzIElucHV0VHlwZSA9IGFueSwgUiBleHRlbmRzIFJlY29yZFR5cGUgPSBhbnk+KFxuICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICBydWxlczogQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZTxhbnksIGFueT5bXSxcbiAgICAgICAgICAgIGFsbENvbmRpdGlvbnM6IE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbixcbiAgICAgICAgICAgIGlucHV0VmFsPzogYW55LFxuICAgICAgICAgICAgaW5wdXQ/OiBJLFxuICAgICAgICAgICAgcmVjb3JkPzogUixcbiAgICAgICAgICAgIGFjdG9yPzogQWN0b3JcbiAgICAgICAgfVxuICAgICk6IFByb21pc2U8VGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdD4ge1xuXG4gICAgICAgIGNvbnN0IHsgcnVsZXMsIGFsbENvbmRpdGlvbnMsIGlucHV0VmFsLCBpbnB1dCwgcmVjb3JkLCBhY3RvciB9ID0gb3B0aW9ucztcblxuICAgICAgICBjb25zdCByZXN1bHQ6IFRlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGVSZXN1bHQgPSB7XG4gICAgICAgICAgICBwYXNzOiB0cnVlLFxuICAgICAgICAgICAgZXJyb3JzOiBbXSxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwocnVsZXMubWFwKGFzeW5jIChydWxlKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZSh7XG4gICAgICAgICAgICAgICAgcnVsZSxcbiAgICAgICAgICAgICAgICBpbnB1dCxcbiAgICAgICAgICAgICAgICBhY3RvcixcbiAgICAgICAgICAgICAgICByZWNvcmQsXG4gICAgICAgICAgICAgICAgaW5wdXRWYWwsXG4gICAgICAgICAgICAgICAgYWxsQ29uZGl0aW9ucyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBydWxlUmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gcmVzdWx0LnBhc3MgJiYgcnVsZVJlc3VsdC5wYXNzO1xuICAgICAgICAgICAgaWYgKHJ1bGVSZXN1bHQuZXJyb3JzKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LmVycm9ycyEucHVzaCguLi5ydWxlUmVzdWx0LmVycm9ycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocnVsZVJlc3VsdC5jdXN0b21NZXNzYWdlIHx8IHJ1bGVSZXN1bHQuY3VzdG9tTWVzc2FnZUlkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LmVycm9ycyEucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIGN1c3RvbU1lc3NhZ2U6IHJ1bGVSZXN1bHQuY3VzdG9tTWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgY3VzdG9tTWVzc2FnZUlkOiBydWxlUmVzdWx0LmN1c3RvbU1lc3NhZ2VJZCxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBWYWxpZGF0ZXMgYSB2YWxpZGF0aW9uIHJ1bGUgdGhhdCBoYXMgY3JpdGVyaWEsIHRvIGRldGVybWluZSBpZiB0aGUgXG4gICAgICogY3JpdGVyaWEgaXMgbWV0IGJlZm9yZSBydW5uaW5nIHRoZSB2YWxpZGF0aW9uLlxuICAgICAqIFxuICAgICAqIENoZWNrcyBpZiB0aGUgY3JpdGVyaWEgY29uZGl0aW9ucyBtYXRjaCB0aGUgaW5wdXQsIHJlY29yZCwgYW5kIGFjdG9yLlxuICAgICAqIElmIGNyaXRlcmlhIHBhc3NlcywgcnVucyB0aGUgdmFsaWRhdGlvbiBydWxlIGFuZCByZXR1cm5zIGVycm9ycy5cbiAgICAgKiBIYW5kbGVzICdhbnknIGFuZCAnYWxsJyBjcml0ZXJpYSBjb25kaXRpb25zLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBydWxlIC0gVGhlIHZhbGlkYXRpb24gcnVsZSB3aXRoIGNyaXRlcmlhXG4gICAgICogQHBhcmFtIGFsbENvbmRpdGlvbnMgLSBtYXAgb2YgZW50aXR5LXZhbGlkYXRpb24tY29uZGl0aW9ucyB0aGF0IGFyZSB1c2VkIGJ5IHRoZSBydWxlXG4gICAgICogQHBhcmFtIGlucHV0VmFsIC0gVGhlIGlucHV0IHZhbHVlIHRvIHZhbGlkYXRlXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGZ1bGwgaW5wdXQgb2JqZWN0XG4gICAgICogQHBhcmFtIHJlY29yZCAtIFRoZSByZWNvcmQgdG8gY2hlY2sgY3JpdGVyaWEgYWdhaW5zdCBcbiAgICAgKiBAcGFyYW0gYWN0b3IgLSBUaGUgYWN0b3IgdG8gY2hlY2sgY3JpdGVyaWEgYWdhaW5zdFxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSByZXNvbHZpbmcgdG8gdmFsaWRhdGlvbiByZXN1bHRzXG4gICAgICovXG4gICAgYXN5bmMgdmFsaWRhdGVDb25kaXRpb25hbFJ1bGU8SSBleHRlbmRzIElucHV0VHlwZSA9IGFueSwgUiBleHRlbmRzIFJlY29yZFR5cGUgPSBhbnk+KFxuICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICBydWxlOiBDb25kaXRpb25hbFZhbGlkYXRpb25SdWxlPGFueSwgYW55PixcbiAgICAgICAgICAgIGFsbENvbmRpdGlvbnM6IE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbixcbiAgICAgICAgICAgIGlucHV0VmFsPzogYW55LFxuICAgICAgICAgICAgaW5wdXQ/OiBJLFxuICAgICAgICAgICAgcmVjb3JkPzogUixcbiAgICAgICAgICAgIGFjdG9yPzogQWN0b3JcbiAgICAgICAgfVxuICAgICk6IFByb21pc2U8VGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdD4ge1xuXG4gICAgICAgIGNvbnN0IHsgcnVsZSwgYWxsQ29uZGl0aW9ucywgaW5wdXRWYWwsIGlucHV0LCByZWNvcmQsIGFjdG9yIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IHsgY29uZGl0aW9uczogcnVsZUNvbmRpdGlvbnMsIC4uLnBhcnRpYWxWYWxpZGF0aW9uIH0gPSBydWxlO1xuXG4gICAgICAgIGNvbnN0IGNyaXRlcmlhUGFzc2VkID0gYXdhaXQgdGhpcy50ZXN0Q29uZGl0aW9ucyh7XG4gICAgICAgICAgICBjb25kaXRpb25zOiBydWxlQ29uZGl0aW9ucyxcbiAgICAgICAgICAgIGFsbENvbmRpdGlvbnMsXG4gICAgICAgICAgICBpbnB1dFZhbCxcbiAgICAgICAgICAgIGlucHV0LFxuICAgICAgICAgICAgcmVjb3JkLFxuICAgICAgICAgICAgYWN0b3IsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDogVGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdCA9IHtcbiAgICAgICAgICAgIHBhc3M6IHRydWUsXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKGNyaXRlcmlhUGFzc2VkKSB7XG4gICAgICAgICAgICBsZXQgdmFsaWRhdGlvbiA9IGF3YWl0IHRoaXMudGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZShwYXJ0aWFsVmFsaWRhdGlvbiwgaW5wdXRWYWwpO1xuXG4gICAgICAgICAgICByZXN1bHQucGFzcyA9IHJlc3VsdC5wYXNzICYmIHZhbGlkYXRpb24ucGFzcztcbiAgICAgICAgICAgIHJlc3VsdC5lcnJvcnMgPSB2YWxpZGF0aW9uLmVycm9ycztcblxuICAgICAgICAgICAgaWYgKHZhbGlkYXRpb24uY3VzdG9tTWVzc2FnZSkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5jdXN0b21NZXNzYWdlID0gdmFsaWRhdGlvbi5jdXN0b21NZXNzYWdlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHZhbGlkYXRpb24uY3VzdG9tTWVzc2FnZUlkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LmN1c3RvbU1lc3NhZ2VJZCA9IHZhbGlkYXRpb24uY3VzdG9tTWVzc2FnZUlkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBhc3luYyB0ZXN0Q29uZGl0aW9uczxJIGV4dGVuZHMgSW5wdXRUeXBlID0gYW55LCBSIGV4dGVuZHMgUmVjb3JkVHlwZSA9IGFueT4oXG4gICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgIGNvbmRpdGlvbnM6IENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGU8YW55LCBhbnk+WyAnY29uZGl0aW9ucycgXSxcbiAgICAgICAgICAgIGFsbENvbmRpdGlvbnM6IE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbixcbiAgICAgICAgICAgIGlucHV0VmFsPzogYW55LFxuICAgICAgICAgICAgaW5wdXQ/OiBJLFxuICAgICAgICAgICAgcmVjb3JkPzogUixcbiAgICAgICAgICAgIGFjdG9yPzogQWN0b3JcbiAgICAgICAgfVxuICAgICk6IFByb21pc2U8Ym9vbGVhbj4ge1xuXG4gICAgICAgIGNvbnN0IHsgY29uZGl0aW9ucywgYWxsQ29uZGl0aW9ucywgaW5wdXRWYWwsIGlucHV0LCByZWNvcmQsIGFjdG9yIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBjcml0ZXJpYVBhc3NlZCA9IHRydWU7XG4gICAgICAgIGNvbnN0IGZvcm1hdHRlZENvbmRpdGlvbnMgPSB7XG4gICAgICAgICAgICBzY29wZTogJ2FsbCcsXG4gICAgICAgICAgICBjb25kaXRpb25OYW1lczogW10gYXMgc3RyaW5nW10sXG4gICAgICAgIH07XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENvbmRpdGlvbnMgPT0+IFsnYWN0b3JJczEyMycsICdwcHAnLCAncXFxJ10gfCBbIFsnYWN0b3JJczEyMycsICdwcHAnLCAncXFxJ10sICdhbGwnIF0gXG4gICAgICAgICAqL1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjb25kaXRpb25zKSkge1xuICAgICAgICAgICAgaWYgKGlzQ29uZGl0aW9uc0FuZFNjb3BlVHVwbGUoY29uZGl0aW9ucykpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIGNvbmRpdGlvbk5hbWVzLCBzY29wZSBdID0gY29uZGl0aW9ucztcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRDb25kaXRpb25zLnNjb3BlID0gc2NvcGUsXG4gICAgICAgICAgICAgICAgICAgIGZvcm1hdHRlZENvbmRpdGlvbnMuY29uZGl0aW9uTmFtZXMgPSBjb25kaXRpb25OYW1lcztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZm9ybWF0dGVkQ29uZGl0aW9ucy5jb25kaXRpb25OYW1lcyA9IGNvbmRpdGlvbnMgYXMgc3RyaW5nW107XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZm9ybWF0dGVkQ29uZGl0aW9ucy5jb25kaXRpb25OYW1lcy5sZW5ndGgpIHtcblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZENvbmRpdGlvbnMuc2NvcGUgPT0gJ2FueScpIHtcblxuICAgICAgICAgICAgICAgIGNyaXRlcmlhUGFzc2VkID0gZmFsc2U7XG5cbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGNvbmRpdGlvbk5hbWUgb2YgZm9ybWF0dGVkQ29uZGl0aW9ucy5jb25kaXRpb25OYW1lcykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjdFJ1bGUgPSBhbGxDb25kaXRpb25zWyBjb25kaXRpb25OYW1lIF07XG5cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXBwbGljYWJsZSA9IGF3YWl0IHRoaXMudGVzdENvbmRpdGlvbihjdFJ1bGUsIGlucHV0LCByZWNvcmQsIGFjdG9yKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFwcGxpY2FibGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vICogdGVzdCBmb3IgYXBwbGljYWJpbGl0eVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gaWYgYW55IG9mIHRoZW0gcGFzc2VzLCB3ZSBhcmUgZ29vZCB0byBnb1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZWxzZSBjb250aW51ZVxuICAgICAgICAgICAgICAgICAgICAgICAgY3JpdGVyaWFQYXNzZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgICAgICBjcml0ZXJpYVBhc3NlZCA9IHRydWU7XG5cbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGNvbmRpdGlvbk5hbWUgb2YgZm9ybWF0dGVkQ29uZGl0aW9ucy5jb25kaXRpb25OYW1lcykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjdFJ1bGUgPSBhbGxDb25kaXRpb25zWyBjb25kaXRpb25OYW1lIF07XG5cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXBwbGljYWJsZSA9IGF3YWl0IHRoaXMudGVzdENvbmRpdGlvbihjdFJ1bGUsIGlucHV0LCByZWNvcmQsIGFjdG9yKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gKiB0ZXN0IGZvciBhcHBsaWNhYmlsaXR5XG4gICAgICAgICAgICAgICAgICAgIC8vIGlmIGFueSBvZiB0aGVtIHBhc3NlcyB0aGUgdmFsaWRhdGlvbiBkb2VzIG5vdCBhcHBseVxuICAgICAgICAgICAgICAgICAgICAvLyBlbHNlIGNvbnRpbnVlXG4gICAgICAgICAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRDb25kaXRpb25zLnNjb3BlID09ICdub25lJyAmJiBhcHBsaWNhYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjcml0ZXJpYVBhc3NlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gKiB0ZXN0IGZvciBOT1QtYXBwbGljYWJpbGl0eVxuICAgICAgICAgICAgICAgICAgICAvLyBpZiBhbnkgb2YgdGhlbSBmYWlscyB0aGUgdmFsaWRhdGlvbiBkb2VzIG5vdCBhcHBseVxuICAgICAgICAgICAgICAgICAgICAvLyBlbHNlIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChmb3JtYXR0ZWRDb25kaXRpb25zLnNjb3BlID09ICdhbGwnICYmICFhcHBsaWNhYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjcml0ZXJpYVBhc3NlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3JpdGVyaWFQYXNzZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGVzdHMgaWYgdGhlIGdpdmVuIGNyaXRlcmlhIGlzIGFwcGxpY2FibGUgZm9yIHRoZSBwcm92aWRlZCBpbnB1dCwgcmVjb3JkIFxuICAgICAqIGFuZCBhY3Rvci4gRXZhbHVhdGVzIHRoZSBhY3RvclJ1bGVzLCBpbnB1dFJ1bGVzIGFuZCByZWNvcmRSdWxlcyBpbiB0aGVcbiAgICAgKiBjcml0ZXJpYSB0byBkZXRlcm1pbmUgaWYgaXQgaXMgYXBwbGljYWJsZS5cbiAgICAgKi9cbiAgICBhc3luYyB0ZXN0Q29uZGl0aW9uPEkgZXh0ZW5kcyBJbnB1dFR5cGUsIFIgZXh0ZW5kcyBSZWNvcmRUeXBlPihcbiAgICAgICAgY3JpdGVyaWE6IEVudGl0eVZhbGlkYXRpb25Db25kaXRpb248SSwgUj4sXG4gICAgICAgIGlucHV0PzogSSxcbiAgICAgICAgcmVjb3JkPzogUixcbiAgICAgICAgYWN0b3I/OiBBY3RvclxuICAgICkge1xuXG4gICAgICAgIGNvbnN0IHsgYWN0b3I6IGFjdG9yUnVsZXMsIGlucHV0OiBpbnB1dFJ1bGVzLCByZWNvcmQ6IHJlY29yZFJ1bGVzIH0gPSBjcml0ZXJpYTtcblxuICAgICAgICBsZXQgYXBwbGljYWJsZSA9IHRydWU7XG5cbiAgICAgICAgaWYgKGFjdG9yUnVsZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGVJbnB1dDxBY3Rvcj4oYWN0b3IsIGFjdG9yUnVsZXMsIGZhbHNlKTtcbiAgICAgICAgICAgIGFwcGxpY2FibGUgPSBhcHBsaWNhYmxlICYmIHJlc3VsdC5wYXNzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFwcGxpY2FibGUgJiYgaW5wdXRSdWxlcykge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy52YWxpZGF0ZUlucHV0PEk+KGlucHV0LCBpbnB1dFJ1bGVzLCBmYWxzZSk7XG5cbiAgICAgICAgICAgIGFwcGxpY2FibGUgPSBhcHBsaWNhYmxlICYmIHJlc3VsdC5wYXNzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFwcGxpY2FibGUgJiYgcmVjb3JkUnVsZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGVJbnB1dDxSPihyZWNvcmQsIHJlY29yZFJ1bGVzLCBmYWxzZSk7XG4gICAgICAgICAgICBhcHBsaWNhYmxlID0gYXBwbGljYWJsZSAmJiByZXN1bHQucGFzcztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhcHBsaWNhYmxlO1xuICAgIH1cblxuICAgIGFzeW5jIHRlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGU8VD4oY29tcGxleFZhbGlkYXRpb25SdWxlOiBDb21wbGV4VmFsaWRhdGlvblJ1bGU8VD4sIHZhbDogVCwgY29sbGVjdEVycm9ycyA9IHRydWUpOiBQcm9taXNlPFRlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGVSZXN1bHQ+IHtcbiAgICAgICAgbGV0IHJlczogVGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdCA9IHtcbiAgICAgICAgICAgIHBhc3M6IHRydWUsXG4gICAgICAgICAgICBlcnJvcnM6IFtdXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgeyBtZXNzYWdlOiBjdXN0b21NZXNzYWdlLCB2YWxpZGF0b3I6IGN1c3RvbVZhbGlkYXRvckZvclJ1bGUsIG1lc3NhZ2VJZDogY3VzdG9tTWVzc2FnZUlkLCAuLi52YWxpZGF0aW9uUnVsZSB9ID0gY29tcGxleFZhbGlkYXRpb25SdWxlO1xuXG4gICAgICAgIGlmIChjdXN0b21WYWxpZGF0b3JGb3JSdWxlKSB7XG4gICAgICAgICAgICByZXMgPSBhd2FpdCBjdXN0b21WYWxpZGF0b3JGb3JSdWxlKHZhbCwgY29sbGVjdEVycm9ycyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXMgPSBhd2FpdCB0aGlzLnRlc3RWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9uUnVsZSwgdmFsLCBjb2xsZWN0RXJyb3JzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcy5jdXN0b21NZXNzYWdlID0gY3VzdG9tTWVzc2FnZSA/PyByZXMuY3VzdG9tTWVzc2FnZTtcbiAgICAgICAgcmVzLmN1c3RvbU1lc3NhZ2VJZCA9IGN1c3RvbU1lc3NhZ2VJZCA/PyByZXMuY3VzdG9tTWVzc2FnZUlkO1xuXG4gICAgICAgIHJldHVybiByZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVmFsaWRhdGVzIHRoZSBnaXZlbiBwYXJ0aWFsIHZhbGlkYXRpb24gcnVsZXMgYWdhaW5zdCB0aGUgcHJvdmlkZWQgdmFsdWUsIFxuICAgICAqIHJldHVybmluZyBhIHJlc3VsdCBpbmRpY2F0aW5nIGlmIGl0IHBhc3NlZCBhbmQgYW55IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgICAqIFxuICAgICAqIExvb3BzIHRocm91Z2ggdGhlIHBhcnRpYWwgdmFsaWRhdGlvbiBydWxlcyBvYmplY3QsIHJ1bm5pbmcgZWFjaCB2YWxpZGF0aW9uIFxuICAgICAqIHJ1bGUgYWdhaW5zdCB0aGUgdmFsdWUuIENvbGxlY3RzIGFueSBlcnJvcnMgYW5kIHRyYWNrcyBpZiBhbnkgdmFsaWRhdGlvbiBmYWlsZWQuXG4gICAgICogXG4gICAgICogUmV0dXJucyBhbiBvYmplY3QgY29udGFpbmluZyBhIGJvb2xlYW4gaW5kaWNhdGluZyBpZiBhbGwgdmFsaWRhdGlvbnMgcGFzc2VkLCBcbiAgICAgKiBhbmQgYW55IGVycm9ycyBlbmNvdW50ZXJlZC5cbiAgICAqL1xuICAgIGFzeW5jIHRlc3RWYWxpZGF0aW9uUnVsZTxUPih2YWxpZGF0aW9uUnVsZTogVmFsaWRhdGlvblJ1bGU8VD4sIHZhbDogVCwgY29sbGVjdEVycm9ycyA9IHRydWUpOiBQcm9taXNlPFRlc3RWYWxpZGF0aW9uUnVsZVJlc3VsdD4ge1xuXG4gICAgICAgIGNvbnN0IHJlczogVGVzdFZhbGlkYXRpb25SdWxlUmVzdWx0ID0ge1xuICAgICAgICAgICAgcGFzczogdHJ1ZSxcbiAgICAgICAgICAgIGVycm9yczogW11cbiAgICAgICAgfTtcblxuICAgICAgICAvLyAqIHZhbGlkYXRlIG9uZSBydWxlIGF0IGEgdGltZVxuICAgICAgICBmb3IgKGNvbnN0IHZhbGlkYXRpb25OYW1lIGluIHZhbGlkYXRpb25SdWxlKSB7XG5cbiAgICAgICAgICAgIGxldCB0ZXN0VmFsaWRhdGlvblJlc3VsdDogVGVzdFZhbGlkYXRpb25SZXN1bHQ7XG4gICAgICAgICAgICBsZXQgdmFsaWRhdGlvblZhbHVlID0gdmFsaWRhdGlvblJ1bGVbIHZhbGlkYXRpb25OYW1lIGFzIGtleW9mIFZhbGlkYXRpb25SdWxlPFQ+IF07XG5cbiAgICAgICAgICAgIGlmIChpc0NvbXBsZXhWYWxpZGF0aW9uVmFsdWUodmFsaWRhdGlvblZhbHVlKSkge1xuICAgICAgICAgICAgICAgIHRlc3RWYWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy50ZXN0Q29tcGxleFZhbGlkYXRpb24odmFsaWRhdGlvbk5hbWUgYXMga2V5b2YgVmFsaWRhdGlvblJ1bGU8VD4sIHZhbGlkYXRpb25WYWx1ZSwgdmFsKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGVzdFZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnRlc3RWYWxpZGF0aW9uKHZhbGlkYXRpb25OYW1lIGFzIGtleW9mIFZhbGlkYXRpb25SdWxlPFQ+LCB2YWxpZGF0aW9uVmFsdWUsIHZhbCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlcy5wYXNzID0gcmVzLnBhc3MgJiYgdGVzdFZhbGlkYXRpb25SZXN1bHQucGFzcztcblxuICAgICAgICAgICAgaWYgKGNvbGxlY3RFcnJvcnMgJiYgIXRlc3RWYWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZUlkcyA9IG1ha2VWYWxpZGF0aW9uRXJyb3JNZXNzYWdlSWRzKHZhbGlkYXRpb25OYW1lLCB2YWxpZGF0aW9uVmFsdWUpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcjogVmFsaWRhdGlvbkVycm9yID0ge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlSWRzOiBlcnJvck1lc3NhZ2VJZHMsXG4gICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkOiB0ZXN0VmFsaWRhdGlvblJlc3VsdC5leHBlY3RlZCxcbiAgICAgICAgICAgICAgICAgICAgcmVjZWl2ZWQ6IHRlc3RWYWxpZGF0aW9uUmVzdWx0LnJlY2VpdmVkLFxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChpc1Rlc3RDb21wbGV4VmFsaWRhdGlvblJlc3VsdCh0ZXN0VmFsaWRhdGlvblJlc3VsdCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRlc3RWYWxpZGF0aW9uUmVzdWx0LmN1c3RvbU1lc3NhZ2VJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbkVycm9yLmN1c3RvbU1lc3NhZ2VJZCA9IHRlc3RWYWxpZGF0aW9uUmVzdWx0LmN1c3RvbU1lc3NhZ2VJZDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAodGVzdFZhbGlkYXRpb25SZXN1bHQuY3VzdG9tTWVzc2FnZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbkVycm9yLmN1c3RvbU1lc3NhZ2UgPSB0ZXN0VmFsaWRhdGlvblJlc3VsdC5jdXN0b21NZXNzYWdlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmVzLmVycm9ycyEucHVzaCh2YWxpZGF0aW9uRXJyb3IpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9XG5cbiAgICBhc3luYyB0ZXN0Q29tcGxleFZhbGlkYXRpb248VCBleHRlbmRzIHVua25vd24+KFxuICAgICAgICB2YWxpZGF0aW9uTmFtZToga2V5b2YgVmFsaWRhdGlvblJ1bGU8VD4sXG4gICAgICAgIHZhbGlkYXRpb25WYWx1ZTogVENvbXBsZXhWYWxpZGF0aW9uVmFsdWU8VD4sXG4gICAgICAgIHZhbDogVFxuICAgICk6IFByb21pc2U8VGVzdENvbXBsZXhWYWxpZGF0aW9uUmVzdWx0PiB7XG5cbiAgICAgICAgbGV0IHJlc3VsdDogVGVzdENvbXBsZXhWYWxpZGF0aW9uUmVzdWx0ID0geyBwYXNzOiB0cnVlIH07XG5cbiAgICAgICAgaWYgKGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZVdpdGhWYWxpZGF0b3IodmFsaWRhdGlvblZhbHVlKSkge1xuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdGlvblZhbHVlLnZhbGlkYXRvcih2YWwpO1xuICAgICAgICB9IGVsc2UgaWYgKGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZVdpdGhNZXNzYWdlKHZhbGlkYXRpb25WYWx1ZSkpIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMudGVzdFZhbGlkYXRpb24odmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZS52YWx1ZSwgdmFsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZhbGlkYXRvciBmbiBjYW4gcmV0dXJuIGl0J3Mgb3duIG1lc3NhZ2Ugb3IgaXQgY2FuIGJlIGRlZmluZWQgYXQgdGhlIHZhbGlkYXRpb24gbGV2ZWxcbiAgICAgICAgcmVzdWx0LmN1c3RvbU1lc3NhZ2UgPSByZXN1bHQuY3VzdG9tTWVzc2FnZSB8fCB2YWxpZGF0aW9uVmFsdWUubWVzc2FnZTtcbiAgICAgICAgcmVzdWx0LmN1c3RvbU1lc3NhZ2VJZCA9IHJlc3VsdC5jdXN0b21NZXNzYWdlSWQgfHwgdmFsaWRhdGlvblZhbHVlLm1lc3NhZ2VJZDtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFZhbGlkYXRlcyBhIHZhbHVlIGFnYWluc3QgYSBzZXQgb2YgdmFsaWRhdGlvbiBydWxlcy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGFydGlhbFZhbGlkYXRpb24gLSBUaGUgdmFsaWRhdGlvbiBydWxlcyB0byBjaGVjaywgZS5nLiB7cmVxdWlyZWQ6IHRydWUsIG1pbkxlbmd0aDogNX0uXG4gICAgICogQHBhcmFtIHZhbCAtIFRoZSB2YWx1ZSB0byB2YWxpZGF0ZS5cbiAgICAgKiBAcmV0dXJucyBUcnVlIGlmIHRoZSB2YWx1ZSBwYXNzZXMgYWxsIHZhbGlkYXRpb25zLCBmYWxzZSBvdGhlcndpc2UuIENhbiBhbHNvIHJldHVybiB2YWxpZGF0aW9uIGVycm9yIG9iamVjdHMuXG4gICAgKi9cbiAgICBhc3luYyB0ZXN0VmFsaWRhdGlvbihcbiAgICAgICAgdmFsaWRhdGlvbk5hbWU6IGtleW9mIFZhbGlkYXRpb25zPGFueT4sXG4gICAgICAgIHZhbGlkYXRpb25WYWx1ZTogVFZhbGlkYXRpb25WYWx1ZTxhbnk+LFxuICAgICAgICB2YWw6IGFueVxuICAgICk6IFByb21pc2U8VGVzdFZhbGlkYXRpb25SZXN1bHQ+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0OiBUZXN0VmFsaWRhdGlvblJlc3VsdCA9IHtcbiAgICAgICAgICAgIHBhc3M6IHRydWUsXG4gICAgICAgICAgICByZWNlaXZlZDogWyB2YWwgXSxcbiAgICAgICAgICAgIGV4cGVjdGVkOiBbIHZhbGlkYXRpb25OYW1lLCB2YWxpZGF0aW9uVmFsdWUgXSxcbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgc3dpdGNoICh2YWxpZGF0aW9uTmFtZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3JlcXVpcmVkJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSAodmFsICE9PSB1bmRlZmluZWQgJiYgdmFsICE9PSBudWxsKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdtaW5MZW5ndGgnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IHZhbCAmJiB2YWwubGVuZ3RoID49IHZhbGlkYXRpb25WYWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnJlY2VpdmVkID0gWyB2YWwsIHZhbD8ubGVuZ3RoIHx8IDAgXTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdtYXhMZW5ndGgnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IHZhbCAmJiB2YWwubGVuZ3RoIDw9IHZhbGlkYXRpb25WYWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnJlY2VpdmVkID0gWyB2YWwsIHZhbD8ubGVuZ3RoIHx8IDAgXTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdwYXR0ZXJuJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSB2YWwgJiYgdmFsaWRhdGlvblZhbHVlLnRlc3QoU3RyaW5nKHZhbCkpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ2VxJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSB2YWwgPT09IHZhbGlkYXRpb25WYWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICduZXEnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IHZhbCAhPT0gdmFsaWRhdGlvblZhbHVlO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ2d0JzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBOdW1iZXIodmFsKSA+IE51bWJlcih2YWxpZGF0aW9uVmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ2d0ZSc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gTnVtYmVyKHZhbCkgPj0gTnVtYmVyKHZhbGlkYXRpb25WYWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAnbHQnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IE51bWJlcih2YWwpIDwgTnVtYmVyKHZhbGlkYXRpb25WYWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAnbHRlJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBOdW1iZXIodmFsKSA8PSBOdW1iZXIodmFsaWRhdGlvblZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdpbkxpc3QnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IEFycmF5LmlzQXJyYXkodmFsaWRhdGlvblZhbHVlKSAmJiB2YWxpZGF0aW9uVmFsdWUuaW5jbHVkZXModmFsKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdub3RJbkxpc3QnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IEFycmF5LmlzQXJyYXkodmFsaWRhdGlvblZhbHVlKSAmJiAhdmFsaWRhdGlvblZhbHVlLmluY2x1ZGVzKHZhbCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAndW5pcXVlJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBpc1VuaXF1ZSh2YWwpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ2N1c3RvbSc6XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsaWRhdGlvblZhbHVlICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKG5ldyBFcnJvcihgSW52YWxpZCBjdXN0b20gdmFsaWRhdGlvbiBydWxlOiAke0pTT04uc3RyaW5naWZ5KHsgWyB2YWxpZGF0aW9uTmFtZSBdOiB2YWxpZGF0aW9uVmFsdWUgfSl9YCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gYXdhaXQgdmFsaWRhdGlvblZhbHVlKHZhbCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdkYXRhdHlwZSc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gYXdhaXQgdGhpcy52YWxpZGF0ZURhdGFUeXBlKHZhbGlkYXRpb25WYWx1ZSwgdmFsKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBVbmtub3duIHZhbGlkYXRpb24gdHlwZTogJHt2YWxpZGF0aW9uTmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdWYWxpZGF0aW9uIGVycm9yOicsIGVycm9yKTtcbiAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gZmFsc2U7XG4gICAgICAgICAgICByZXN1bHQuZXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIHZhbGlkYXRpb24gZXJyb3InO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlRGF0YVR5cGUodHlwZTogc3RyaW5nLCB2YWw6IGFueSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ251bWJlcic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzTnVtZXJpY1N0cmluZyh2YWwpO1xuICAgICAgICAgICAgY2FzZSAnZW1haWwnOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc0VtYWlsKHZhbCk7XG4gICAgICAgICAgICBjYXNlICdpcCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzSVAodmFsKTtcbiAgICAgICAgICAgIGNhc2UgJ2lwdjQnOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc0lQdjQodmFsKTtcbiAgICAgICAgICAgIGNhc2UgJ2lwdjYnOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc0lQdjYodmFsKTtcbiAgICAgICAgICAgIGNhc2UgJ3V1aWQnOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc1VVSUQodmFsKTtcbiAgICAgICAgICAgIGNhc2UgJ2pzb24nOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc0pzb25TdHJpbmcodmFsKTtcbiAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc0RhdGVTdHJpbmcodmFsKTtcbiAgICAgICAgICAgIGNhc2UgJ2h0dHBVcmwnOlxuICAgICAgICAgICAgICAgIHJldHVybiBpc0h0dHBVcmxTdHJpbmcodmFsKTtcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiB2YWwgPT09IHR5cGU7XG4gICAgICAgIH1cbiAgICB9XG59XG5cblxuXG4iXX0=