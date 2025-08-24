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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3ZhbGlkYXRpb24vdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQU1BLHdDQUEwQztBQUMxQyxvQ0FBeUk7QUFFekksbUNBQTRWO0FBRTVWOzs7OztFQUtFO0FBQ0YsTUFBYSxTQUFTO0lBQ1QsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDOUIseUJBQXlCLEdBQUcsT0FBTyxDQUFDLENBQUMsV0FBVztJQUNoRCx3QkFBd0IsR0FBRyxLQUFLLENBQUMsQ0FBQyxZQUFZO0lBRS9EOzs7O01BSUU7SUFDRixLQUFLLENBQUMsY0FBYyxDQU1oQixPQUFrRTtRQUlsRSxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsVUFBVSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFDdEUsYUFBYSxHQUFHLElBQUksRUFDcEIsYUFBYSxHQUFHLEtBQUssRUFDckIsdUJBQXVCLEVBQzFCLEdBQUcsT0FBTyxDQUFDO1FBRVosTUFBTSxNQUFNLEdBQW9CO1lBQzVCLElBQUksRUFBRSxJQUFJO1lBQ1YsTUFBTSxFQUFFLEVBQUU7U0FDYixDQUFBO1FBRUQsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDckIsT0FBTyxNQUFNLENBQUE7UUFDakIsQ0FBQztRQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBQSxnREFBd0MsRUFBQyxhQUFhLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztRQUV0RyxNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsa0JBQWtCLENBQUM7UUFFMUMsS0FBSyxNQUFNLFFBQVEsSUFBSSxDQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFXLEVBQUUsQ0FBQztZQUM3RCxNQUFNLFNBQVMsR0FBRyxrQkFBa0IsQ0FBRSxlQUFlLENBQUUsQ0FBRSxRQUFRLENBQUUsQ0FB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QUFTO2dCQUNWLE9BQU8sSUFBQSx1QkFBZSxFQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2hDO2dCQUNJLE9BQU8sT0FBTyxHQUFHLEtBQUssSUFBSSxDQUFDO1FBQ25DLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUF2cUJELDhCQXVxQkMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIERlZmluZXMgdmFsaWRhdGlvbiBydWxlcyBhbmQgY3JpdGVyaWEgdGhhdCBjYW4gYmUgdXNlZCB0byB2YWxpZGF0ZSBpbnB1dCwgcmVjb3JkLCBhbmQgYWN0b3IgZGF0YS5cbiAqIFByb3ZpZGVzIGEgVmFsaWRhdG9yIGNsYXNzIHRoYXQgdmFsaWRhdGVzIGRhdGEgYWdhaW5zdCBkZWZpbmVkIHZhbGlkYXRpb24gcnVsZXMgYW5kIGNyaXRlcmlhLlxuICovXG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzXCI7XG5pbXBvcnQgeyBFbnRpdHlTY2hlbWEsIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMgfSBmcm9tIFwiLi4vZW50aXR5XCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgaXNEYXRlU3RyaW5nLCBpc0VtYWlsLCBpc0h0dHBVcmxTdHJpbmcsIGlzSVAsIGlzSVB2NCwgaXNJUHY2LCBpc0pzb25TdHJpbmcsIGlzTnVtZXJpY1N0cmluZywgaXNVVUlELCBpc1VuaXF1ZSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgQ29tcGxleFZhbGlkYXRpb25SdWxlLCBDb25kaXRpb25hbFZhbGlkYXRpb25SdWxlLCBFbnRpdHlWYWxpZGF0aW9uQ29uZGl0aW9uLCBWYWxpZGF0b3JSZXN1bHQsIElWYWxpZGF0b3IsIElucHV0VHlwZSwgSW5wdXRWYWxpZGF0aW9uUmVzdWx0LCBJbnB1dFZhbGlkYXRpb25SdWxlLCBNYXBPZlZhbGlkYXRpb25Db25kaXRpb24sIE9wVmFsaWRhdG9yT3B0aW9ucywgUmVjb3JkVHlwZSwgVENvbXBsZXhWYWxpZGF0aW9uVmFsdWUsIFRWYWxpZGF0aW9uVmFsdWUsIFRlc3RDb21wbGV4VmFsaWRhdGlvblJlc3VsdCwgVGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdCwgVGVzdFZhbGlkYXRpb25SZXN1bHQsIFRlc3RWYWxpZGF0aW9uUnVsZVJlc3VsdCwgVmFsaWRhdGVIdHRwUmVxdWVzdE9wdGlvbnMsIFZhbGlkYXRpb25FcnJvciwgVmFsaWRhdGlvblJ1bGUsIFZhbGlkYXRpb25zIH0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IGV4dHJhY3RPcFZhbGlkYXRpb25Gcm9tRW50aXR5VmFsaWRhdGlvbnMsIGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZSwgaXNDb21wbGV4VmFsaWRhdGlvblZhbHVlV2l0aE1lc3NhZ2UsIGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZVdpdGhWYWxpZGF0b3IsIGlzQ29uZGl0aW9uc0FuZFNjb3BlVHVwbGUsIGlzVGVzdENvbXBsZXhWYWxpZGF0aW9uUmVzdWx0LCBtYWtlRW50aXR5VmFsaWRhdGlvbk1lc3NhZ2VJZHMsIG1ha2VIdHRwVmFsaWRhdGlvbk1lc3NhZ2VJZHMsIG1ha2VWYWxpZGF0aW9uRXJyb3JNZXNzYWdlLCBtYWtlVmFsaWRhdGlvbkVycm9yTWVzc2FnZUlkcyB9IGZyb20gXCIuL3V0aWxzXCI7XG5cbi8qKlxuICogVmFsaWRhdGVzIGlucHV0IGRhdGEgYWdhaW5zdCBhIHNldCBvZiB2YWxpZGF0aW9uIHJ1bGVzLiBcbiAqIFN1cHBvcnRzIHZhbGlkYXRpbmcgYWdhaW5zdCBkaWZmZXJlbnQgY3JpdGVyaWEgdmlhIHRoZSBDcml0ZXJpYVNldC5cbiAqIEhhbmRsZXMgdmFsaWRhdGluZyBhdCBtdWx0aXBsZSBsZXZlbHMgKGFjdG9yLCBpbnB1dCwgcmVjb3JkKS5cbiAqIFJldHVybnMgd2hldGhlciB2YWxpZGF0aW9uIHBhc3NlZCBhbmQgYW55IGVycm9ycy5cbiovXG5leHBvcnQgY2xhc3MgVmFsaWRhdG9yIGltcGxlbWVudHMgSVZhbGlkYXRvciB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFZhbGlkYXRvci5uYW1lKTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IERFRkFVTFRfTUFYX1NUUklOR19MRU5HVEggPSAxMDAwMDAwOyAvLyAxTSBjaGFyc1xuICAgIHByaXZhdGUgcmVhZG9ubHkgREVGQVVMVF9NQVhfQVJSQVlfTEVOR1RIID0gMTAwMDA7IC8vIDEwSyBpdGVtc1xuXG4gICAgLyoqXG4gICAgICogVmFsaWRhdGVzIGlucHV0IGRhdGEgYWdhaW5zdCBhIHNldCBvZiB2YWxpZGF0aW9uIHJ1bGVzIHdpdGggY3JpdGVyaWEuXG4gICAgICogSGFuZGxlcyB2YWxpZGF0aW5nIGF0IG11bHRpcGxlIGxldmVscyAoYWN0b3IsIGlucHV0LCByZWNvcmQpIGJhc2VkIG9uIHRoZSBvcHRpb25zIHBhc3NlZCBpbi5cbiAgICAgKiBSZXR1cm5zIHdoZXRoZXIgdmFsaWRhdGlvbiBwYXNzZWQgYW5kIGFueSBlcnJvcnMuXG4gICAgKi9cbiAgICBhc3luYyB2YWxpZGF0ZUVudGl0eTxcbiAgICAgICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgICAgICBPcE5hbWUgZXh0ZW5kcyBrZXlvZiBTY2hbICdtb2RlbCcgXVsgJ2VudGl0eU9wZXJhdGlvbnMnIF0sXG4gICAgICAgIENvbmRpdGlvbnNNYXAgZXh0ZW5kcyBNYXBPZlZhbGlkYXRpb25Db25kaXRpb248YW55LCBhbnk+LFxuICAgICAgICBPcHNJbnBTY2ggZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4gICAgPihcbiAgICAgICAgb3B0aW9uczogT3BWYWxpZGF0b3JPcHRpb25zPFNjaCwgT3BOYW1lLCBDb25kaXRpb25zTWFwLCBPcHNJbnBTY2g+XG5cbiAgICApOiBQcm9taXNlPFZhbGlkYXRvclJlc3VsdD4ge1xuXG4gICAgICAgIGNvbnN0IHsgZW50aXR5VmFsaWRhdGlvbnMsIGVudGl0eU5hbWUsIG9wZXJhdGlvbk5hbWUsIGlucHV0LCBhY3RvciwgcmVjb3JkLFxuICAgICAgICAgICAgY29sbGVjdEVycm9ycyA9IHRydWUsXG4gICAgICAgICAgICB2ZXJib3NlRXJyb3JzID0gZmFsc2UsXG4gICAgICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlc1xuICAgICAgICB9ID0gb3B0aW9ucztcblxuICAgICAgICBjb25zdCByZXN1bHQ6IFZhbGlkYXRvclJlc3VsdCA9IHtcbiAgICAgICAgICAgIHBhc3M6IHRydWUsXG4gICAgICAgICAgICBlcnJvcnM6IFtdXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWVudGl0eVZhbGlkYXRpb25zKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBvcHNWYWxpZGF0aW9uUnVsZXMgPSBleHRyYWN0T3BWYWxpZGF0aW9uRnJvbUVudGl0eVZhbGlkYXRpb25zKG9wZXJhdGlvbk5hbWUsIGVudGl0eVZhbGlkYXRpb25zKTtcblxuICAgICAgICBjb25zdCB7IGNvbmRpdGlvbnMgfSA9IG9wc1ZhbGlkYXRpb25SdWxlcztcblxuICAgICAgICBmb3IgKGNvbnN0IHJ1bGVUeXBlIG9mIFsgJ2FjdG9yJywgJ2lucHV0JywgJ3JlY29yZCcgXSBhcyBjb25zdCkge1xuICAgICAgICAgICAgY29uc3QgdHlwZVJ1bGVzID0gb3BzVmFsaWRhdGlvblJ1bGVzWyAnb3BWYWxpZGF0aW9ucycgXVsgcnVsZVR5cGUgXTtcbiAgICAgICAgICAgIGlmICghdHlwZVJ1bGVzKSB7IGNvbnRpbnVlOyB9XG5cbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIHR5cGVSdWxlcykge1xuXG4gICAgICAgICAgICAgICAgY29uc3QgdmFsaWRhdGlvbnNXaXRoQ3JpdGVyaWEgPSB0eXBlUnVsZXNbIGtleSBhcyBrZXlvZiB0eXBlb2YgdHlwZVJ1bGVzIF07XG4gICAgICAgICAgICAgICAgaWYgKCF2YWxpZGF0aW9uc1dpdGhDcml0ZXJpYSkgeyBjb250aW51ZTsgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5wdXRWYWwgPSBydWxlVHlwZSA9PSAnYWN0b3InID8gYWN0b3I/Llsga2V5IF1cbiAgICAgICAgICAgICAgICAgICAgOiBydWxlVHlwZSA9PSAnaW5wdXQnID8gaW5wdXQ/Llsga2V5IF1cbiAgICAgICAgICAgICAgICAgICAgICAgIDogcnVsZVR5cGUgPT0gJ3JlY29yZCcgPyByZWNvcmQ/Llsga2V5IF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMudmFsaWRhdGVDb25kaXRpb25hbFJ1bGVzKHtcbiAgICAgICAgICAgICAgICAgICAgYWN0b3IsXG4gICAgICAgICAgICAgICAgICAgIGlucHV0LFxuICAgICAgICAgICAgICAgICAgICByZWNvcmQsXG4gICAgICAgICAgICAgICAgICAgIHJ1bGVzOiB2YWxpZGF0aW9uc1dpdGhDcml0ZXJpYSxcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRWYWw6IGlucHV0VmFsLFxuICAgICAgICAgICAgICAgICAgICBhbGxDb25kaXRpb25zOiBjb25kaXRpb25zIGFzIE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbixcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gcmVzdWx0LnBhc3MgJiYgcmVzLnBhc3M7XG5cbiAgICAgICAgICAgICAgICBpZiAoY29sbGVjdEVycm9ycyAmJiByZXMuZXJyb3JzPy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzLmVycm9ycy5mb3JFYWNoKGVyciA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnIubWVzc2FnZUlkcyA9IG1ha2VFbnRpdHlWYWxpZGF0aW9uTWVzc2FnZUlkcyhlbnRpdHlOYW1lLCBydWxlVHlwZSwga2V5LCBlcnIubWVzc2FnZUlkcyA/PyBbXSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnIucGF0aCA9IGVyci5wYXRoID8/IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyLnBhdGgucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyLnBhdGgucHVzaChydWxlVHlwZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJbICdtZXNzYWdlJyBdID0gbWFrZVZhbGlkYXRpb25FcnJvck1lc3NhZ2UoZXJyLCBvdmVycmlkZGVuRXJyb3JNZXNzYWdlcyk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5lcnJvcnM/LnB1c2godmVyYm9zZUVycm9ycyA/IGVyciA6IHsgcGF0aDogZXJyLnBhdGgsIG1lc3NhZ2U6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRlc3RzIHZhbGlkYXRpb25zIHJ1bGVzIGZvciB0aGUgZ2l2ZW4gaW5wdXQgb2JqZWN0IGFnYWluc3QgdGhlIHByb3ZpZGVkIHZhbGlkYXRpb24gcnVsZXMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGlucHV0IG9iamVjdCB0byB2YWxpZGF0ZS5cbiAgICAgKiBAcGFyYW0gcnVsZXMgLSBUaGUgdmFsaWRhdGlvbiBydWxlcyB0byB0ZXN0LCB3aGVyZSBlYWNoIGtleSBpcyBhIGtleSBvbiB0aGUgaW5wdXQgb2JqZWN0LlxuICAgICAqIEByZXR1cm5zIFdoZXRoZXIgdGhlIGlucHV0IHBhc3NlZCBhbGwgdGhlIHZhbGlkYXRpb24gcnVsZXMuXG4gICAgICovXG4gICAgYXN5bmMgdmFsaWRhdGVJbnB1dDxJIGV4dGVuZHMgSW5wdXRUeXBlPihcbiAgICAgICAgaW5wdXQ6IEkgfCB1bmRlZmluZWQsXG4gICAgICAgIHJ1bGVzPzogSW5wdXRWYWxpZGF0aW9uUnVsZTxJPixcbiAgICAgICAgY29sbGVjdEVycm9yczogYm9vbGVhbiA9IHRydWVcbiAgICApOiBQcm9taXNlPElucHV0VmFsaWRhdGlvblJlc3VsdDxJPj4ge1xuICAgICAgICBpZiAoIXJ1bGVzKSB7XG4gICAgICAgICAgICByZXR1cm4geyBwYXNzOiB0cnVlLCBlcnJvcnM6IHt9IH07XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXN1bHQ6IElucHV0VmFsaWRhdGlvblJlc3VsdDxJPiA9IHtcbiAgICAgICAgICAgIHBhc3M6IHRydWUsXG4gICAgICAgICAgICBlcnJvcnM6IHt9LFxuICAgICAgICB9O1xuXG4gICAgICAgIGZvciAoY29uc3Qga2V5IGluIHJ1bGVzKSB7XG4gICAgICAgICAgICBjb25zdCB0aGlzUnVsZSA9IHJ1bGVzWyBrZXkgXTtcbiAgICAgICAgICAgIGlmICghdGhpc1J1bGUpIHsgY29udGludWU7IH1cblxuICAgICAgICAgICAgY29uc3QgdGhpc1ZhbCA9IGlucHV0ID8gaW5wdXRbIGtleSBdIDogdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAvLyBBZGQgc2FmZXR5IGNoZWNrIGZvciBleHRyZW1lbHkgbGFyZ2UgdmFsdWVzXG4gICAgICAgICAgICBpZiAodGhpc1ZhbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzVmFsID09PSAnc3RyaW5nJyAmJiB0aGlzVmFsLmxlbmd0aCA+IHRoaXMuREVGQVVMVF9NQVhfU1RSSU5HX0xFTkdUSCkge1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29sbGVjdEVycm9ycykge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LmVycm9ycyFbIGtleSBdID0gWyB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZUlkczogWyAndmFsaWRhdGlvbi5lcnJvci5zdHJpbmcudG9vbG9uZycgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdXN0b21NZXNzYWdlOiBgU3RyaW5nIGV4Y2VlZHMgbWF4aW11bSBsZW5ndGggb2YgJHt0aGlzLkRFRkFVTFRfTUFYX1NUUklOR19MRU5HVEh9IGNoYXJhY3RlcnNgXG4gICAgICAgICAgICAgICAgICAgICAgICB9IF07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHRoaXNWYWwpICYmIHRoaXNWYWwubGVuZ3RoID4gdGhpcy5ERUZBVUxUX01BWF9BUlJBWV9MRU5HVEgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNvbGxlY3RFcnJvcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5lcnJvcnMhWyBrZXkgXSA9IFsge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VJZHM6IFsgJ3ZhbGlkYXRpb24uZXJyb3IuYXJyYXkudG9vbG9uZycgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdXN0b21NZXNzYWdlOiBgQXJyYXkgZXhjZWVkcyBtYXhpbXVtIGxlbmd0aCBvZiAke3RoaXMuREVGQVVMVF9NQVhfQVJSQVlfTEVOR1RIfSBpdGVtc2BcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHZhbGlkYXRpb25SZXMgPSBhd2FpdCB0aGlzLnRlc3RDb21wbGV4VmFsaWRhdGlvblJ1bGU8YW55Pih0aGlzUnVsZSwgdGhpc1ZhbCk7XG4gICAgICAgICAgICByZXN1bHQucGFzcyA9IHJlc3VsdC5wYXNzICYmIHZhbGlkYXRpb25SZXMucGFzcztcblxuICAgICAgICAgICAgaWYgKGNvbGxlY3RFcnJvcnMgJiYgdmFsaWRhdGlvblJlcy5lcnJvcnMgJiYgdmFsaWRhdGlvblJlcy5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LmVycm9ycyFbIGtleSBdID0gdmFsaWRhdGlvblJlcy5lcnJvcnM/Lm1hcChlcnIgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXRoID0gZXJyLnBhdGggPz8gW107XG4gICAgICAgICAgICAgICAgICAgIGlmICghcGF0aC5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoLnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyAuLi5lcnIsIHBhdGggfTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGVzdHMgdmFsaWRhdGlvbnMgcnVsZXMgZm9yIHRoZSBnaXZlbiBpbnB1dCBvYmplY3QgYWdhaW5zdCB0aGUgcHJvdmlkZWQgdmFsaWRhdGlvbiBydWxlcy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaW5wdXQgLSBUaGUgaW5wdXQgb2JqZWN0IHRvIHZhbGlkYXRlLlxuICAgICAqIEBwYXJhbSBydWxlcyAtIFRoZSB2YWxpZGF0aW9uIHJ1bGVzIHRvIHRlc3QsIHdoZXJlIGVhY2gga2V5IGlzIGEga2V5IG9uIHRoZSBpbnB1dCBvYmplY3QuXG4gICAgICogQHJldHVybnMgV2hldGhlciB0aGUgaW5wdXQgcGFzc2VkIGFsbCB0aGUgdmFsaWRhdGlvbiBydWxlcy5cbiAgICAgKi9cbiAgICBhc3luYyB2YWxpZGF0ZUh0dHBSZXF1ZXN0PFxuICAgICAgICBIZWFkZXIgZXh0ZW5kcyBJbnB1dFR5cGUgPSBJbnB1dFR5cGUsXG4gICAgICAgIEJvZHkgZXh0ZW5kcyBJbnB1dFR5cGUgPSBJbnB1dFR5cGUsXG4gICAgICAgIFBhcmFtIGV4dGVuZHMgSW5wdXRUeXBlID0gSW5wdXRUeXBlLFxuICAgICAgICBRdWVyeSBleHRlbmRzIElucHV0VHlwZSA9IElucHV0VHlwZSxcbiAgICA+KFxuXG4gICAgICAgIG9wdGlvbnM6IFZhbGlkYXRlSHR0cFJlcXVlc3RPcHRpb25zPEhlYWRlciwgQm9keSwgUGFyYW0sIFF1ZXJ5PlxuXG4gICAgKTogUHJvbWlzZTxWYWxpZGF0b3JSZXN1bHQ+IHtcblxuICAgICAgICBjb25zdCB7IHJlcXVlc3RDb250ZXh0LCB2YWxpZGF0aW9ucywgY29sbGVjdEVycm9ycyA9IHRydWUsIHZlcmJvc2VFcnJvcnMgPSBmYWxzZSwgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXMgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgY29uc3QgcmVzOiBWYWxpZGF0b3JSZXN1bHQgPSB7XG4gICAgICAgICAgICBwYXNzOiB0cnVlLFxuICAgICAgICAgICAgZXJyb3JzOiBbXSxcbiAgICAgICAgfTtcblxuICAgICAgICBmb3IgKGNvbnN0IHZhbGlkYXRpb25UeXBlIG9mIFsgJ2JvZHknLCAncGFyYW0nLCAncXVlcnknLCAnaGVhZGVyJyBdIGFzIGNvbnN0KSB7XG4gICAgICAgICAgICBjb25zdCB0eXBlVmFsaWRhdGlvblJ1bGVzID0gdmFsaWRhdGlvbnNbIHZhbGlkYXRpb25UeXBlIF07XG4gICAgICAgICAgICBpZiAoIXR5cGVWYWxpZGF0aW9uUnVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IHZhbGlkYXRpb25JbnB1dDogYW55ID0ge307XG5cbiAgICAgICAgICAgIGlmICh2YWxpZGF0aW9uVHlwZSA9PSAnYm9keScpIHtcbiAgICAgICAgICAgICAgICB2YWxpZGF0aW9uSW5wdXQgPSByZXF1ZXN0Q29udGV4dC5ib2R5O1xuICAgICAgICAgICAgfSBlbHNlIGlmICh2YWxpZGF0aW9uVHlwZSA9PSAncGFyYW0nKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvbklucHV0ID0gcmVxdWVzdENvbnRleHQucGF0aFBhcmFtZXRlcnM7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHZhbGlkYXRpb25UeXBlID09ICdxdWVyeScpIHtcbiAgICAgICAgICAgICAgICB2YWxpZGF0aW9uSW5wdXQgPSByZXF1ZXN0Q29udGV4dC5xdWVyeVN0cmluZ1BhcmFtZXRlcnM7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHZhbGlkYXRpb25UeXBlID09ICdoZWFkZXInKSB7XG4gICAgICAgICAgICAgICAgdmFsaWRhdGlvbklucHV0ID0gcmVxdWVzdENvbnRleHQuaGVhZGVycztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5wdXRWYWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy52YWxpZGF0ZUlucHV0PHR5cGVvZiB2YWxpZGF0aW9uSW5wdXQ+KHZhbGlkYXRpb25JbnB1dCwgdHlwZVZhbGlkYXRpb25SdWxlcyk7XG5cbiAgICAgICAgICAgIHJlcy5wYXNzID0gcmVzLnBhc3MgJiYgaW5wdXRWYWxpZGF0aW9uUmVzdWx0LnBhc3M7XG5cbiAgICAgICAgICAgIGlmIChjb2xsZWN0RXJyb3JzICYmICFpbnB1dFZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBwcm9wIGluIGlucHV0VmFsaWRhdGlvblJlc3VsdC5lcnJvcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvcEVycm9ycyA9IGlucHV0VmFsaWRhdGlvblJlc3VsdC5lcnJvcnNbIHByb3AgXSA/PyBbXTtcblxuICAgICAgICAgICAgICAgICAgICBwcm9wRXJyb3JzLmZvckVhY2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IucGF0aCA9IGVycm9yLnBhdGggPz8gW107XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5wYXRoLnB1c2godmFsaWRhdGlvblR5cGUpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBodHRwVmFsaWRhdGlvbk1lc3NhZ2VJZHMgPSBtYWtlSHR0cFZhbGlkYXRpb25NZXNzYWdlSWRzKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uVHlwZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0eU5hbWU6IHByb3AsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlSWRzOiBlcnJvci5tZXNzYWdlSWRzIHx8IFtdXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLm1lc3NhZ2VJZHMgPSBodHRwVmFsaWRhdGlvbk1lc3NhZ2VJZHM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLm1lc3NhZ2UgPSBtYWtlVmFsaWRhdGlvbkVycm9yTWVzc2FnZShlcnJvciwgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXMpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICByZXMuZXJyb3JzPy5wdXNoKHZlcmJvc2VFcnJvcnMgPyBlcnJvciA6IHsgcGF0aDogZXJyb3IucGF0aCwgbWVzc2FnZTogZXJyb3IubWVzc2FnZSB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBWYWxpZGF0ZXMgYW4gYXJyYXkgb2YgdmFsaWRhdGlvbiBydWxlcyB3aXRoIGNyaXRlcmlhIGFnYWluc3QgdGhlIHByb3ZpZGVkIGlucHV0IHZhbHVlLCBpbnB1dCBvYmplY3QsIHJlY29yZCBvYmplY3QsIGFuZCBhY3Rvci5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcnVsZXMgLSBUaGUgYXJyYXkgb2YgdmFsaWRhdGlvbiBydWxlcyB3aXRoIGNyaXRlcmlhIHRvIHZhbGlkYXRlXG4gICAgICogQHBhcmFtIGlucHV0VmFsIC0gVGhlIGlucHV0IHZhbHVlIHRvIHZhbGlkYXRlXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGlucHV0IG9iamVjdCBjb250YWluaW5nIHRoZSBmdWxsIGlucHV0XG4gICAgICogQHBhcmFtIHJlY29yZCAtIFRoZSByZWNvcmQgb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGZ1bGwgcmVjb3JkXG4gICAgICogQHBhcmFtIGFjdG9yIC0gVGhlIGFjdG9yIG9iamVjdCBjb250YWluaW5nIGFjdG9yIGluZm9ybWF0aW9uXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHJlc29sdmluZyB0byBhbiBvYmplY3QgY29udGFpbmluZyBhIGJvb2xlYW4gaW5kaWNhdGluZyBpZiB2YWxpZGF0aW9uIHBhc3NlZCwgYW5kIGFueSB2YWxpZGF0aW9uIGVycm9yc1xuICAgICAqL1xuICAgIGFzeW5jIHZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlczxJIGV4dGVuZHMgSW5wdXRUeXBlID0gYW55LCBSIGV4dGVuZHMgUmVjb3JkVHlwZSA9IGFueT4oXG4gICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgIHJ1bGVzOiBDb25kaXRpb25hbFZhbGlkYXRpb25SdWxlPGFueSwgYW55PltdLFxuICAgICAgICAgICAgYWxsQ29uZGl0aW9uczogTWFwT2ZWYWxpZGF0aW9uQ29uZGl0aW9uLFxuICAgICAgICAgICAgaW5wdXRWYWw/OiBhbnksXG4gICAgICAgICAgICBpbnB1dD86IEksXG4gICAgICAgICAgICByZWNvcmQ/OiBSLFxuICAgICAgICAgICAgYWN0b3I/OiBBY3RvclxuICAgICAgICB9XG4gICAgKTogUHJvbWlzZTxUZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlUmVzdWx0PiB7XG5cbiAgICAgICAgY29uc3QgeyBydWxlcywgYWxsQ29uZGl0aW9ucywgaW5wdXRWYWwsIGlucHV0LCByZWNvcmQsIGFjdG9yIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdDogVGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdCA9IHtcbiAgICAgICAgICAgIHBhc3M6IHRydWUsXG4gICAgICAgICAgICBlcnJvcnM6IFtdLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChydWxlcy5tYXAoYXN5bmMgKHJ1bGUpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZhbGlkYXRlQ29uZGl0aW9uYWxSdWxlKHtcbiAgICAgICAgICAgICAgICBydWxlLFxuICAgICAgICAgICAgICAgIGlucHV0LFxuICAgICAgICAgICAgICAgIGFjdG9yLFxuICAgICAgICAgICAgICAgIHJlY29yZCxcbiAgICAgICAgICAgICAgICBpbnB1dFZhbCxcbiAgICAgICAgICAgICAgICBhbGxDb25kaXRpb25zLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHJ1bGVSZXN1bHQgb2YgcmVzdWx0cykge1xuICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSByZXN1bHQucGFzcyAmJiBydWxlUmVzdWx0LnBhc3M7XG4gICAgICAgICAgICBpZiAocnVsZVJlc3VsdC5lcnJvcnMpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQuZXJyb3JzIS5wdXNoKC4uLnJ1bGVSZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChydWxlUmVzdWx0LmN1c3RvbU1lc3NhZ2UgfHwgcnVsZVJlc3VsdC5jdXN0b21NZXNzYWdlSWQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQuZXJyb3JzIS5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgY3VzdG9tTWVzc2FnZTogcnVsZVJlc3VsdC5jdXN0b21NZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICBjdXN0b21NZXNzYWdlSWQ6IHJ1bGVSZXN1bHQuY3VzdG9tTWVzc2FnZUlkLFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFZhbGlkYXRlcyBhIHZhbGlkYXRpb24gcnVsZSB0aGF0IGhhcyBjcml0ZXJpYSwgdG8gZGV0ZXJtaW5lIGlmIHRoZSBcbiAgICAgKiBjcml0ZXJpYSBpcyBtZXQgYmVmb3JlIHJ1bm5pbmcgdGhlIHZhbGlkYXRpb24uXG4gICAgICogXG4gICAgICogQ2hlY2tzIGlmIHRoZSBjcml0ZXJpYSBjb25kaXRpb25zIG1hdGNoIHRoZSBpbnB1dCwgcmVjb3JkLCBhbmQgYWN0b3IuXG4gICAgICogSWYgY3JpdGVyaWEgcGFzc2VzLCBydW5zIHRoZSB2YWxpZGF0aW9uIHJ1bGUgYW5kIHJldHVybnMgZXJyb3JzLlxuICAgICAqIEhhbmRsZXMgJ2FueScgYW5kICdhbGwnIGNyaXRlcmlhIGNvbmRpdGlvbnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIHJ1bGUgLSBUaGUgdmFsaWRhdGlvbiBydWxlIHdpdGggY3JpdGVyaWFcbiAgICAgKiBAcGFyYW0gYWxsQ29uZGl0aW9ucyAtIG1hcCBvZiBlbnRpdHktdmFsaWRhdGlvbi1jb25kaXRpb25zIHRoYXQgYXJlIHVzZWQgYnkgdGhlIHJ1bGVcbiAgICAgKiBAcGFyYW0gaW5wdXRWYWwgLSBUaGUgaW5wdXQgdmFsdWUgdG8gdmFsaWRhdGVcbiAgICAgKiBAcGFyYW0gaW5wdXQgLSBUaGUgZnVsbCBpbnB1dCBvYmplY3RcbiAgICAgKiBAcGFyYW0gcmVjb3JkIC0gVGhlIHJlY29yZCB0byBjaGVjayBjcml0ZXJpYSBhZ2FpbnN0IFxuICAgICAqIEBwYXJhbSBhY3RvciAtIFRoZSBhY3RvciB0byBjaGVjayBjcml0ZXJpYSBhZ2FpbnN0XG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHJlc29sdmluZyB0byB2YWxpZGF0aW9uIHJlc3VsdHNcbiAgICAgKi9cbiAgICBhc3luYyB2YWxpZGF0ZUNvbmRpdGlvbmFsUnVsZTxJIGV4dGVuZHMgSW5wdXRUeXBlID0gYW55LCBSIGV4dGVuZHMgUmVjb3JkVHlwZSA9IGFueT4oXG4gICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgIHJ1bGU6IENvbmRpdGlvbmFsVmFsaWRhdGlvblJ1bGU8YW55LCBhbnk+LFxuICAgICAgICAgICAgYWxsQ29uZGl0aW9uczogTWFwT2ZWYWxpZGF0aW9uQ29uZGl0aW9uLFxuICAgICAgICAgICAgaW5wdXRWYWw/OiBhbnksXG4gICAgICAgICAgICBpbnB1dD86IEksXG4gICAgICAgICAgICByZWNvcmQ/OiBSLFxuICAgICAgICAgICAgYWN0b3I/OiBBY3RvclxuICAgICAgICB9XG4gICAgKTogUHJvbWlzZTxUZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlUmVzdWx0PiB7XG5cbiAgICAgICAgY29uc3QgeyBydWxlLCBhbGxDb25kaXRpb25zLCBpbnB1dFZhbCwgaW5wdXQsIHJlY29yZCwgYWN0b3IgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgY29uc3QgeyBjb25kaXRpb25zOiBydWxlQ29uZGl0aW9ucywgLi4ucGFydGlhbFZhbGlkYXRpb24gfSA9IHJ1bGU7XG5cbiAgICAgICAgY29uc3QgY3JpdGVyaWFQYXNzZWQgPSBhd2FpdCB0aGlzLnRlc3RDb25kaXRpb25zKHtcbiAgICAgICAgICAgIGNvbmRpdGlvbnM6IHJ1bGVDb25kaXRpb25zLFxuICAgICAgICAgICAgYWxsQ29uZGl0aW9ucyxcbiAgICAgICAgICAgIGlucHV0VmFsLFxuICAgICAgICAgICAgaW5wdXQsXG4gICAgICAgICAgICByZWNvcmQsXG4gICAgICAgICAgICBhY3RvcixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0OiBUZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlUmVzdWx0ID0ge1xuICAgICAgICAgICAgcGFzczogdHJ1ZSxcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoY3JpdGVyaWFQYXNzZWQpIHtcbiAgICAgICAgICAgIGxldCB2YWxpZGF0aW9uID0gYXdhaXQgdGhpcy50ZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlKHBhcnRpYWxWYWxpZGF0aW9uLCBpbnB1dFZhbCk7XG5cbiAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gcmVzdWx0LnBhc3MgJiYgdmFsaWRhdGlvbi5wYXNzO1xuICAgICAgICAgICAgcmVzdWx0LmVycm9ycyA9IHZhbGlkYXRpb24uZXJyb3JzO1xuXG4gICAgICAgICAgICBpZiAodmFsaWRhdGlvbi5jdXN0b21NZXNzYWdlKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LmN1c3RvbU1lc3NhZ2UgPSB2YWxpZGF0aW9uLmN1c3RvbU1lc3NhZ2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodmFsaWRhdGlvbi5jdXN0b21NZXNzYWdlSWQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQuY3VzdG9tTWVzc2FnZUlkID0gdmFsaWRhdGlvbi5jdXN0b21NZXNzYWdlSWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGFzeW5jIHRlc3RDb25kaXRpb25zPEkgZXh0ZW5kcyBJbnB1dFR5cGUgPSBhbnksIFIgZXh0ZW5kcyBSZWNvcmRUeXBlID0gYW55PihcbiAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgY29uZGl0aW9uczogQ29uZGl0aW9uYWxWYWxpZGF0aW9uUnVsZTxhbnksIGFueT5bICdjb25kaXRpb25zJyBdLFxuICAgICAgICAgICAgYWxsQ29uZGl0aW9uczogTWFwT2ZWYWxpZGF0aW9uQ29uZGl0aW9uLFxuICAgICAgICAgICAgaW5wdXRWYWw/OiBhbnksXG4gICAgICAgICAgICBpbnB1dD86IEksXG4gICAgICAgICAgICByZWNvcmQ/OiBSLFxuICAgICAgICAgICAgYWN0b3I/OiBBY3RvclxuICAgICAgICB9XG4gICAgKTogUHJvbWlzZTxib29sZWFuPiB7XG5cbiAgICAgICAgY29uc3QgeyBjb25kaXRpb25zLCBhbGxDb25kaXRpb25zLCBpbnB1dFZhbCwgaW5wdXQsIHJlY29yZCwgYWN0b3IgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGNyaXRlcmlhUGFzc2VkID0gdHJ1ZTtcbiAgICAgICAgY29uc3QgZm9ybWF0dGVkQ29uZGl0aW9ucyA9IHtcbiAgICAgICAgICAgIHNjb3BlOiAnYWxsJyxcbiAgICAgICAgICAgIGNvbmRpdGlvbk5hbWVzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgICAgfTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZGl0aW9ucyA9PT4gWydhY3RvcklzMTIzJywgJ3BwcCcsICdxcXEnXSB8IFsgWydhY3RvcklzMTIzJywgJ3BwcCcsICdxcXEnXSwgJ2FsbCcgXSBcbiAgICAgICAgICovXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNvbmRpdGlvbnMpKSB7XG4gICAgICAgICAgICBpZiAoaXNDb25kaXRpb25zQW5kU2NvcGVUdXBsZShjb25kaXRpb25zKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgY29uZGl0aW9uTmFtZXMsIHNjb3BlIF0gPSBjb25kaXRpb25zO1xuICAgICAgICAgICAgICAgIGZvcm1hdHRlZENvbmRpdGlvbnMuc2NvcGUgPSBzY29wZSxcbiAgICAgICAgICAgICAgICAgICAgZm9ybWF0dGVkQ29uZGl0aW9ucy5jb25kaXRpb25OYW1lcyA9IGNvbmRpdGlvbk5hbWVzO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRDb25kaXRpb25zLmNvbmRpdGlvbk5hbWVzID0gY29uZGl0aW9ucyBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmb3JtYXR0ZWRDb25kaXRpb25zLmNvbmRpdGlvbk5hbWVzLmxlbmd0aCkge1xuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQ29uZGl0aW9ucy5zY29wZSA9PSAnYW55Jykge1xuXG4gICAgICAgICAgICAgICAgY3JpdGVyaWFQYXNzZWQgPSBmYWxzZTtcblxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY29uZGl0aW9uTmFtZSBvZiBmb3JtYXR0ZWRDb25kaXRpb25zLmNvbmRpdGlvbk5hbWVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGN0UnVsZSA9IGFsbENvbmRpdGlvbnNbIGNvbmRpdGlvbk5hbWUgXTtcblxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhcHBsaWNhYmxlID0gYXdhaXQgdGhpcy50ZXN0Q29uZGl0aW9uKGN0UnVsZSwgaW5wdXQsIHJlY29yZCwgYWN0b3IpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXBwbGljYWJsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gKiB0ZXN0IGZvciBhcHBsaWNhYmlsaXR5XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBpZiBhbnkgb2YgdGhlbSBwYXNzZXMsIHdlIGFyZSBnb29kIHRvIGdvXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBlbHNlIGNvbnRpbnVlXG4gICAgICAgICAgICAgICAgICAgICAgICBjcml0ZXJpYVBhc3NlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgICAgIGNyaXRlcmlhUGFzc2VkID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY29uZGl0aW9uTmFtZSBvZiBmb3JtYXR0ZWRDb25kaXRpb25zLmNvbmRpdGlvbk5hbWVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGN0UnVsZSA9IGFsbENvbmRpdGlvbnNbIGNvbmRpdGlvbk5hbWUgXTtcblxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhcHBsaWNhYmxlID0gYXdhaXQgdGhpcy50ZXN0Q29uZGl0aW9uKGN0UnVsZSwgaW5wdXQsIHJlY29yZCwgYWN0b3IpO1xuICAgICAgICAgICAgICAgICAgICAvLyAqIHRlc3QgZm9yIGFwcGxpY2FiaWxpdHlcbiAgICAgICAgICAgICAgICAgICAgLy8gaWYgYW55IG9mIHRoZW0gcGFzc2VzIHRoZSB2YWxpZGF0aW9uIGRvZXMgbm90IGFwcGx5XG4gICAgICAgICAgICAgICAgICAgIC8vIGVsc2UgY29udGludWVcbiAgICAgICAgICAgICAgICAgICAgaWYgKGZvcm1hdHRlZENvbmRpdGlvbnMuc2NvcGUgPT0gJ25vbmUnICYmIGFwcGxpY2FibGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNyaXRlcmlhUGFzc2VkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAvLyAqIHRlc3QgZm9yIE5PVC1hcHBsaWNhYmlsaXR5XG4gICAgICAgICAgICAgICAgICAgIC8vIGlmIGFueSBvZiB0aGVtIGZhaWxzIHRoZSB2YWxpZGF0aW9uIGRvZXMgbm90IGFwcGx5XG4gICAgICAgICAgICAgICAgICAgIC8vIGVsc2UgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGZvcm1hdHRlZENvbmRpdGlvbnMuc2NvcGUgPT0gJ2FsbCcgJiYgIWFwcGxpY2FibGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNyaXRlcmlhUGFzc2VkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjcml0ZXJpYVBhc3NlZDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUZXN0cyBpZiB0aGUgZ2l2ZW4gY3JpdGVyaWEgaXMgYXBwbGljYWJsZSBmb3IgdGhlIHByb3ZpZGVkIGlucHV0LCByZWNvcmQgXG4gICAgICogYW5kIGFjdG9yLiBFdmFsdWF0ZXMgdGhlIGFjdG9yUnVsZXMsIGlucHV0UnVsZXMgYW5kIHJlY29yZFJ1bGVzIGluIHRoZVxuICAgICAqIGNyaXRlcmlhIHRvIGRldGVybWluZSBpZiBpdCBpcyBhcHBsaWNhYmxlLlxuICAgICAqL1xuICAgIGFzeW5jIHRlc3RDb25kaXRpb248SSBleHRlbmRzIElucHV0VHlwZSwgUiBleHRlbmRzIFJlY29yZFR5cGU+KFxuICAgICAgICBjcml0ZXJpYTogRW50aXR5VmFsaWRhdGlvbkNvbmRpdGlvbjxJLCBSPixcbiAgICAgICAgaW5wdXQ/OiBJLFxuICAgICAgICByZWNvcmQ/OiBSLFxuICAgICAgICBhY3Rvcj86IEFjdG9yXG4gICAgKSB7XG5cbiAgICAgICAgY29uc3QgeyBhY3RvcjogYWN0b3JSdWxlcywgaW5wdXQ6IGlucHV0UnVsZXMsIHJlY29yZDogcmVjb3JkUnVsZXMgfSA9IGNyaXRlcmlhO1xuXG4gICAgICAgIGxldCBhcHBsaWNhYmxlID0gdHJ1ZTtcblxuICAgICAgICBpZiAoYWN0b3JSdWxlcykge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy52YWxpZGF0ZUlucHV0PEFjdG9yPihhY3RvciwgYWN0b3JSdWxlcywgZmFsc2UpO1xuICAgICAgICAgICAgYXBwbGljYWJsZSA9IGFwcGxpY2FibGUgJiYgcmVzdWx0LnBhc3M7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYXBwbGljYWJsZSAmJiBpbnB1dFJ1bGVzKSB7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlSW5wdXQ8ST4oaW5wdXQsIGlucHV0UnVsZXMsIGZhbHNlKTtcblxuICAgICAgICAgICAgYXBwbGljYWJsZSA9IGFwcGxpY2FibGUgJiYgcmVzdWx0LnBhc3M7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYXBwbGljYWJsZSAmJiByZWNvcmRSdWxlcykge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy52YWxpZGF0ZUlucHV0PFI+KHJlY29yZCwgcmVjb3JkUnVsZXMsIGZhbHNlKTtcbiAgICAgICAgICAgIGFwcGxpY2FibGUgPSBhcHBsaWNhYmxlICYmIHJlc3VsdC5wYXNzO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGFwcGxpY2FibGU7XG4gICAgfVxuXG4gICAgYXN5bmMgdGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZTxUPihjb21wbGV4VmFsaWRhdGlvblJ1bGU6IENvbXBsZXhWYWxpZGF0aW9uUnVsZTxUPiwgdmFsOiBULCBjb2xsZWN0RXJyb3JzID0gdHJ1ZSk6IFByb21pc2U8VGVzdENvbXBsZXhWYWxpZGF0aW9uUnVsZVJlc3VsdD4ge1xuICAgICAgICBsZXQgcmVzOiBUZXN0Q29tcGxleFZhbGlkYXRpb25SdWxlUmVzdWx0ID0ge1xuICAgICAgICAgICAgcGFzczogdHJ1ZSxcbiAgICAgICAgICAgIGVycm9yczogW11cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCB7IG1lc3NhZ2U6IGN1c3RvbU1lc3NhZ2UsIHZhbGlkYXRvcjogY3VzdG9tVmFsaWRhdG9yRm9yUnVsZSwgbWVzc2FnZUlkOiBjdXN0b21NZXNzYWdlSWQsIC4uLnZhbGlkYXRpb25SdWxlIH0gPSBjb21wbGV4VmFsaWRhdGlvblJ1bGU7XG5cbiAgICAgICAgaWYgKGN1c3RvbVZhbGlkYXRvckZvclJ1bGUpIHtcbiAgICAgICAgICAgIHJlcyA9IGF3YWl0IGN1c3RvbVZhbGlkYXRvckZvclJ1bGUodmFsLCBjb2xsZWN0RXJyb3JzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcyA9IGF3YWl0IHRoaXMudGVzdFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25SdWxlLCB2YWwsIGNvbGxlY3RFcnJvcnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzLmN1c3RvbU1lc3NhZ2UgPSBjdXN0b21NZXNzYWdlID8/IHJlcy5jdXN0b21NZXNzYWdlO1xuICAgICAgICByZXMuY3VzdG9tTWVzc2FnZUlkID0gY3VzdG9tTWVzc2FnZUlkID8/IHJlcy5jdXN0b21NZXNzYWdlSWQ7XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBWYWxpZGF0ZXMgdGhlIGdpdmVuIHBhcnRpYWwgdmFsaWRhdGlvbiBydWxlcyBhZ2FpbnN0IHRoZSBwcm92aWRlZCB2YWx1ZSwgXG4gICAgICogcmV0dXJuaW5nIGEgcmVzdWx0IGluZGljYXRpbmcgaWYgaXQgcGFzc2VkIGFuZCBhbnkgdmFsaWRhdGlvbiBlcnJvcnMuXG4gICAgICogXG4gICAgICogTG9vcHMgdGhyb3VnaCB0aGUgcGFydGlhbCB2YWxpZGF0aW9uIHJ1bGVzIG9iamVjdCwgcnVubmluZyBlYWNoIHZhbGlkYXRpb24gXG4gICAgICogcnVsZSBhZ2FpbnN0IHRoZSB2YWx1ZS4gQ29sbGVjdHMgYW55IGVycm9ycyBhbmQgdHJhY2tzIGlmIGFueSB2YWxpZGF0aW9uIGZhaWxlZC5cbiAgICAgKiBcbiAgICAgKiBSZXR1cm5zIGFuIG9iamVjdCBjb250YWluaW5nIGEgYm9vbGVhbiBpbmRpY2F0aW5nIGlmIGFsbCB2YWxpZGF0aW9ucyBwYXNzZWQsIFxuICAgICAqIGFuZCBhbnkgZXJyb3JzIGVuY291bnRlcmVkLlxuICAgICovXG4gICAgYXN5bmMgdGVzdFZhbGlkYXRpb25SdWxlPFQ+KHZhbGlkYXRpb25SdWxlOiBWYWxpZGF0aW9uUnVsZTxUPiwgdmFsOiBULCBjb2xsZWN0RXJyb3JzID0gdHJ1ZSk6IFByb21pc2U8VGVzdFZhbGlkYXRpb25SdWxlUmVzdWx0PiB7XG5cbiAgICAgICAgY29uc3QgcmVzOiBUZXN0VmFsaWRhdGlvblJ1bGVSZXN1bHQgPSB7XG4gICAgICAgICAgICBwYXNzOiB0cnVlLFxuICAgICAgICAgICAgZXJyb3JzOiBbXVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vICogdmFsaWRhdGUgb25lIHJ1bGUgYXQgYSB0aW1lXG4gICAgICAgIGZvciAoY29uc3QgdmFsaWRhdGlvbk5hbWUgaW4gdmFsaWRhdGlvblJ1bGUpIHtcblxuICAgICAgICAgICAgbGV0IHRlc3RWYWxpZGF0aW9uUmVzdWx0OiBUZXN0VmFsaWRhdGlvblJlc3VsdDtcbiAgICAgICAgICAgIGxldCB2YWxpZGF0aW9uVmFsdWUgPSB2YWxpZGF0aW9uUnVsZVsgdmFsaWRhdGlvbk5hbWUgYXMga2V5b2YgVmFsaWRhdGlvblJ1bGU8VD4gXTtcblxuICAgICAgICAgICAgaWYgKGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZSh2YWxpZGF0aW9uVmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgdGVzdFZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnRlc3RDb21wbGV4VmFsaWRhdGlvbih2YWxpZGF0aW9uTmFtZSBhcyBrZXlvZiBWYWxpZGF0aW9uUnVsZTxUPiwgdmFsaWRhdGlvblZhbHVlLCB2YWwpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0ZXN0VmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudGVzdFZhbGlkYXRpb24odmFsaWRhdGlvbk5hbWUgYXMga2V5b2YgVmFsaWRhdGlvblJ1bGU8VD4sIHZhbGlkYXRpb25WYWx1ZSwgdmFsKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmVzLnBhc3MgPSByZXMucGFzcyAmJiB0ZXN0VmFsaWRhdGlvblJlc3VsdC5wYXNzO1xuXG4gICAgICAgICAgICBpZiAoY29sbGVjdEVycm9ycyAmJiAhdGVzdFZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuXG4gICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlSWRzID0gbWFrZVZhbGlkYXRpb25FcnJvck1lc3NhZ2VJZHModmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZSk7XG4gICAgICAgICAgICAgICAgY29uc3QgdmFsaWRhdGlvbkVycm9yOiBWYWxpZGF0aW9uRXJyb3IgPSB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VJZHM6IGVycm9yTWVzc2FnZUlkcyxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IHRlc3RWYWxpZGF0aW9uUmVzdWx0LmV4cGVjdGVkLFxuICAgICAgICAgICAgICAgICAgICByZWNlaXZlZDogdGVzdFZhbGlkYXRpb25SZXN1bHQucmVjZWl2ZWQsXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGlzVGVzdENvbXBsZXhWYWxpZGF0aW9uUmVzdWx0KHRlc3RWYWxpZGF0aW9uUmVzdWx0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGVzdFZhbGlkYXRpb25SZXN1bHQuY3VzdG9tTWVzc2FnZUlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uRXJyb3IuY3VzdG9tTWVzc2FnZUlkID0gdGVzdFZhbGlkYXRpb25SZXN1bHQuY3VzdG9tTWVzc2FnZUlkO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh0ZXN0VmFsaWRhdGlvblJlc3VsdC5jdXN0b21NZXNzYWdlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uRXJyb3IuY3VzdG9tTWVzc2FnZSA9IHRlc3RWYWxpZGF0aW9uUmVzdWx0LmN1c3RvbU1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXMuZXJyb3JzIS5wdXNoKHZhbGlkYXRpb25FcnJvcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH1cblxuICAgIGFzeW5jIHRlc3RDb21wbGV4VmFsaWRhdGlvbjxUIGV4dGVuZHMgdW5rbm93bj4oXG4gICAgICAgIHZhbGlkYXRpb25OYW1lOiBrZXlvZiBWYWxpZGF0aW9uUnVsZTxUPixcbiAgICAgICAgdmFsaWRhdGlvblZhbHVlOiBUQ29tcGxleFZhbGlkYXRpb25WYWx1ZTxUPixcbiAgICAgICAgdmFsOiBUXG4gICAgKTogUHJvbWlzZTxUZXN0Q29tcGxleFZhbGlkYXRpb25SZXN1bHQ+IHtcblxuICAgICAgICBsZXQgcmVzdWx0OiBUZXN0Q29tcGxleFZhbGlkYXRpb25SZXN1bHQgPSB7IHBhc3M6IHRydWUgfTtcblxuICAgICAgICBpZiAoaXNDb21wbGV4VmFsaWRhdGlvblZhbHVlV2l0aFZhbGlkYXRvcih2YWxpZGF0aW9uVmFsdWUpKSB7XG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB2YWxpZGF0aW9uVmFsdWUudmFsaWRhdG9yKHZhbCk7XG4gICAgICAgIH0gZWxzZSBpZiAoaXNDb21wbGV4VmFsaWRhdGlvblZhbHVlV2l0aE1lc3NhZ2UodmFsaWRhdGlvblZhbHVlKSkge1xuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy50ZXN0VmFsaWRhdGlvbih2YWxpZGF0aW9uTmFtZSwgdmFsaWRhdGlvblZhbHVlLnZhbHVlLCB2YWwpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdmFsaWRhdG9yIGZuIGNhbiByZXR1cm4gaXQncyBvd24gbWVzc2FnZSBvciBpdCBjYW4gYmUgZGVmaW5lZCBhdCB0aGUgdmFsaWRhdGlvbiBsZXZlbFxuICAgICAgICByZXN1bHQuY3VzdG9tTWVzc2FnZSA9IHJlc3VsdC5jdXN0b21NZXNzYWdlIHx8IHZhbGlkYXRpb25WYWx1ZS5tZXNzYWdlO1xuICAgICAgICByZXN1bHQuY3VzdG9tTWVzc2FnZUlkID0gcmVzdWx0LmN1c3RvbU1lc3NhZ2VJZCB8fCB2YWxpZGF0aW9uVmFsdWUubWVzc2FnZUlkO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVmFsaWRhdGVzIGEgdmFsdWUgYWdhaW5zdCBhIHNldCBvZiB2YWxpZGF0aW9uIHJ1bGVzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBwYXJ0aWFsVmFsaWRhdGlvbiAtIFRoZSB2YWxpZGF0aW9uIHJ1bGVzIHRvIGNoZWNrLCBlLmcuIHtyZXF1aXJlZDogdHJ1ZSwgbWluTGVuZ3RoOiA1fS5cbiAgICAgKiBAcGFyYW0gdmFsIC0gVGhlIHZhbHVlIHRvIHZhbGlkYXRlLlxuICAgICAqIEByZXR1cm5zIFRydWUgaWYgdGhlIHZhbHVlIHBhc3NlcyBhbGwgdmFsaWRhdGlvbnMsIGZhbHNlIG90aGVyd2lzZS4gQ2FuIGFsc28gcmV0dXJuIHZhbGlkYXRpb24gZXJyb3Igb2JqZWN0cy5cbiAgICAqL1xuICAgIGFzeW5jIHRlc3RWYWxpZGF0aW9uKFxuICAgICAgICB2YWxpZGF0aW9uTmFtZToga2V5b2YgVmFsaWRhdGlvbnM8YW55PixcbiAgICAgICAgdmFsaWRhdGlvblZhbHVlOiBUVmFsaWRhdGlvblZhbHVlPGFueT4sXG4gICAgICAgIHZhbDogYW55XG4gICAgKTogUHJvbWlzZTxUZXN0VmFsaWRhdGlvblJlc3VsdD4ge1xuICAgICAgICBjb25zdCByZXN1bHQ6IFRlc3RWYWxpZGF0aW9uUmVzdWx0ID0ge1xuICAgICAgICAgICAgcGFzczogdHJ1ZSxcbiAgICAgICAgICAgIHJlY2VpdmVkOiBbIHZhbCBdLFxuICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgdmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZSBdLFxuICAgICAgICB9O1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBzd2l0Y2ggKHZhbGlkYXRpb25OYW1lKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAncmVxdWlyZWQnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9ICh2YWwgIT09IHVuZGVmaW5lZCAmJiB2YWwgIT09IG51bGwpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ21pbkxlbmd0aCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gdmFsICYmIHZhbC5sZW5ndGggPj0gdmFsaWRhdGlvblZhbHVlO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQucmVjZWl2ZWQgPSBbIHZhbCwgdmFsPy5sZW5ndGggfHwgMCBdO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ21heExlbmd0aCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gdmFsICYmIHZhbC5sZW5ndGggPD0gdmFsaWRhdGlvblZhbHVlO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQucmVjZWl2ZWQgPSBbIHZhbCwgdmFsPy5sZW5ndGggfHwgMCBdO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ3BhdHRlcm4nOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IHZhbCAmJiB2YWxpZGF0aW9uVmFsdWUudGVzdChTdHJpbmcodmFsKSk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAnZXEnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IHZhbCA9PT0gdmFsaWRhdGlvblZhbHVlO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ25lcSc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gdmFsICE9PSB2YWxpZGF0aW9uVmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAnZ3QnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IE51bWJlcih2YWwpID4gTnVtYmVyKHZhbGlkYXRpb25WYWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAnZ3RlJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBOdW1iZXIodmFsKSA+PSBOdW1iZXIodmFsaWRhdGlvblZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdsdCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gTnVtYmVyKHZhbCkgPCBOdW1iZXIodmFsaWRhdGlvblZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICdsdGUnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IE51bWJlcih2YWwpIDw9IE51bWJlcih2YWxpZGF0aW9uVmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ2luTGlzdCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gQXJyYXkuaXNBcnJheSh2YWxpZGF0aW9uVmFsdWUpICYmIHZhbGlkYXRpb25WYWx1ZS5pbmNsdWRlcyh2YWwpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ25vdEluTGlzdCc6XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wYXNzID0gQXJyYXkuaXNBcnJheSh2YWxpZGF0aW9uVmFsdWUpICYmICF2YWxpZGF0aW9uVmFsdWUuaW5jbHVkZXModmFsKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgICAgICBjYXNlICd1bmlxdWUnOlxuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IGlzVW5pcXVlKHZhbCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICAgICAgY2FzZSAnY3VzdG9tJzpcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWxpZGF0aW9uVmFsdWUgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4obmV3IEVycm9yKGBJbnZhbGlkIGN1c3RvbSB2YWxpZGF0aW9uIHJ1bGU6ICR7SlNPTi5zdHJpbmdpZnkoeyBbIHZhbGlkYXRpb25OYW1lIF06IHZhbGlkYXRpb25WYWx1ZSB9KX1gKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBhd2FpdCB2YWxpZGF0aW9uVmFsdWUodmFsKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGF0eXBlJzpcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBhd2FpdCB0aGlzLnZhbGlkYXRlRGF0YVR5cGUodmFsaWRhdGlvblZhbHVlLCB2YWwpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFVua25vd24gdmFsaWRhdGlvbiB0eXBlOiAke3ZhbGlkYXRpb25OYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQucGFzcyA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ1ZhbGlkYXRpb24gZXJyb3I6JywgZXJyb3IpO1xuICAgICAgICAgICAgcmVzdWx0LnBhc3MgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlc3VsdC5lcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gdmFsaWRhdGlvbiBlcnJvcic7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgdmFsaWRhdGVEYXRhVHlwZSh0eXBlOiBzdHJpbmcsIHZhbDogYW55KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgICAgIGlmICh2YWwgPT09IHVuZGVmaW5lZCB8fCB2YWwgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gaXNOdW1lcmljU3RyaW5nKHZhbCk7XG4gICAgICAgICAgICBjYXNlICdlbWFpbCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzRW1haWwodmFsKTtcbiAgICAgICAgICAgIGNhc2UgJ2lwJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gaXNJUCh2YWwpO1xuICAgICAgICAgICAgY2FzZSAnaXB2NCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzSVB2NCh2YWwpO1xuICAgICAgICAgICAgY2FzZSAnaXB2Nic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzSVB2Nih2YWwpO1xuICAgICAgICAgICAgY2FzZSAndXVpZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzVVVJRCh2YWwpO1xuICAgICAgICAgICAgY2FzZSAnanNvbic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzSnNvblN0cmluZyh2YWwpO1xuICAgICAgICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzRGF0ZVN0cmluZyh2YWwpO1xuICAgICAgICAgICAgY2FzZSAnaHR0cFVybCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzSHR0cFVybFN0cmluZyh2YWwpO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gdHlwZW9mIHZhbCA9PT0gdHlwZTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuXG5cbiJdfQ==