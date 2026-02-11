"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidationRule = isValidationRule;
exports.isArrayOfValidationRule = isArrayOfValidationRule;
exports.isConditionsAndScopeTuple = isConditionsAndScopeTuple;
exports.isInputValidationRule = isInputValidationRule;
exports.isHttpRequestValidationRule = isHttpRequestValidationRule;
exports.isTestComplexValidationResult = isTestComplexValidationResult;
exports.isComplexValidationValue = isComplexValidationValue;
exports.isComplexValidationValueWithMessage = isComplexValidationValueWithMessage;
exports.isComplexValidationValueWithValidator = isComplexValidationValueWithValidator;
exports.isComplexValidationRule = isComplexValidationRule;
exports.isEntityValidations = isEntityValidations;
exports.isEntityOpsInputValidations = isEntityOpsInputValidations;
exports.extractOpValidationFromEntityValidations = extractOpValidationFromEntityValidations;
exports.makeValidationErrorMessage = makeValidationErrorMessage;
exports.makeValidationMessageIdsForPrefix = makeValidationMessageIdsForPrefix;
exports.makeValidationErrorMessageIds = makeValidationErrorMessageIds;
exports.makeHttpValidationMessageIds = makeHttpValidationMessageIds;
exports.makeEntityValidationMessageIds = makeEntityValidationMessageIds;
const logging_1 = require("../logging");
const types_1 = require("./types");
const messages_1 = __importDefault(require("./messages"));
const logger = (0, logging_1.createLogger)('ValidatorUtils');
function isValidationRule(rule) {
    const res = typeof rule === 'object'
        && rule !== null
        && Object.keys(rule).every(key => types_1.Validation_Keys.includes(key) || 'operations' === key);
    return res;
}
function isArrayOfValidationRule(rules) {
    const res = typeof rules === 'object'
        && rules !== null
        && Array.isArray(rules)
        && rules.every(isValidationRule);
    return res;
}
function isConditionsAndScopeTuple(conditions) {
    return conditions
        && Array.isArray(conditions)
        && conditions.length == 2
        && Array.isArray(conditions[0])
        && ['all', 'any', 'none'].includes(conditions[1]);
}
function isInputValidationRule(rules) {
    return typeof rules === 'object'
        && rules !== null
        && Object.keys(rules).every(key => isValidationRule(rules[key]));
}
function isHttpRequestValidationRule(rule) {
    return typeof rule === 'object'
        && rule !== null
        && ((rule.hasOwnProperty('body') && isInputValidationRule(rule.body))
            ||
                (rule.hasOwnProperty('query') && isInputValidationRule(rule.query))
            ||
                (rule.hasOwnProperty('param') && isInputValidationRule(rule.param))
            ||
                (rule.hasOwnProperty('header') && isInputValidationRule(rule.header)));
}
function isTestComplexValidationResult(val) {
    return typeof val === 'object'
        && val !== null
        && (val.hasOwnProperty('customMessage') || val.hasOwnProperty('customMessageId'));
}
function isComplexValidationValue(val) {
    return isComplexValidationValueWithMessage(val) || isComplexValidationValueWithValidator(val);
}
function isComplexValidationValueWithMessage(val) {
    return typeof val === 'object'
        && val !== null
        && val.hasOwnProperty('value')
        && (val.hasOwnProperty('message') || val.hasOwnProperty('messageId'));
}
function isComplexValidationValueWithValidator(val) {
    return typeof val === 'object'
        && val !== null
        && val.hasOwnProperty('validator');
}
function isComplexValidationRule(val) {
    return typeof val === 'object'
        && val !== null
        && (val.hasOwnProperty('validator')
            ||
                (val.hasOwnProperty('message') || val.hasOwnProperty('messageId')));
}
function isEntityValidations(validations) {
    const res = typeof validations === 'object'
        && validations !== null
        && Object.keys(validations).every(validationType => ['conditions', 'input', 'record', 'actor'].includes(validationType)
            && (!validations[validationType] || validationType === 'conditions'
                || (typeof validations[validationType] === 'object'
                    && Object.keys(validations[validationType]).every(prop => isArrayOfValidationRule(validations[validationType][prop])))));
    return res;
}
function isEntityOpsInputValidations(validations) {
    return typeof validations === 'object' && validations !== null
        && Object.keys(validations).every(prop => isArrayOfValidationRule(validations[prop]));
}
/**
 * Extracts operation-specific validations from entity validations.
 *
 * @template Sch - The entity schema type.
 * @template ConditionsMap - The map of validation conditions.
 * @template Ops - The default entity operations type.
 * @template OpsInpSch - The entity operations input schemas type.
 *
 * @param {keyof OpsInpSch} operationName - The name of the operation.
 * @param {EntityValidations<Sch, ConditionsMap, OpsInpSch> | EntityInputValidations<Sch, OpsInpSch>} entityValidations - The entity validations or entity input validations.
 *
 * @returns {{ opValidations: EntityOperationValidation<any, any, ConditionsMap>, conditions: any }} - The extracted operation validations and conditions.
 */
function extractOpValidationFromEntityValidations(operationName, entityValidations) {
    const entityOpValidations = {
        actor: {},
        input: {},
        record: {},
    };
    if (isEntityOpsInputValidations(entityValidations)) {
        entityValidations = {
            input: entityValidations
        };
    }
    if (!isEntityValidations(entityValidations)) {
        throw (`Invalid entity validations ${entityValidations}`);
    }
    for (const validationGroupKey of ['actor', 'input', 'record']) {
        const groupValidationRules = entityValidations[validationGroupKey];
        if (!groupValidationRules) {
            continue;
        }
        for (const propertyName in groupValidationRules) {
            const propertyRules = groupValidationRules[propertyName];
            if (!propertyRules) {
                continue;
            }
            const formattedPropertyRules = [];
            for (const rule of propertyRules) {
                if (!rule) {
                    continue;
                }
                let { operations, ...restOfTheValidations } = rule;
                if (!operations) {
                    operations = ['*'];
                }
                if (!Array.isArray(operations)) {
                    for (const opName in operations) {
                        if (!operations.hasOwnProperty(opName) || opName !== operationName) {
                            continue;
                        }
                        const opConditionRules = operations[opName];
                        if (!Array.isArray(opConditionRules)) {
                            throw new Error(`Invalid operations definition for ${opName} in ${operations}`);
                        }
                        opConditionRules.forEach((rule) => {
                            let thisRuleValidations = {
                                ...restOfTheValidations,
                                conditions: [rule['conditions'], rule['scope'] ?? 'all'],
                            };
                            formattedPropertyRules.push(thisRuleValidations);
                        });
                    }
                }
                else if (Array.isArray(operations)) {
                    for (const thisOp of operations) {
                        if (Array.isArray(thisOp) && thisOp[0] === operationName) {
                            const [thisOpName, conditions = undefined, scope = 'all'] = thisOp;
                            /**
                             *
                             * ['update', ['recordIsNotNew', 'tenantIsXYZ']],
                             * ['update', [['recordIsNotNew', 'inputIsNitin'], 'any']]
                             *
                             */
                            let thisRuleValidations = {
                                ...restOfTheValidations,
                                conditions: conditions ? [conditions, scope] : undefined,
                            };
                            formattedPropertyRules.push(thisRuleValidations);
                        }
                        else if (thisOp === '*' || thisOp === operationName) {
                            formattedPropertyRules.push({ ...restOfTheValidations });
                        }
                    }
                }
                if (formattedPropertyRules.length) {
                    entityOpValidations[validationGroupKey][propertyName] = formattedPropertyRules;
                }
                else {
                    logger.debug("No applicable rules found for op: prop: group: from-rule:", [operationName, propertyName, validationGroupKey, rule]);
                }
            }
        }
    }
    return {
        opValidations: { ...entityOpValidations },
        conditions: entityValidations.conditions
    };
}
/**
 * Generates a validation error message based on the provided error object and optional overridden error messages.
 * @param error - The validation error object.
 * @param overriddenErrorMessages - Optional map of overridden error messages.
 * @returns The generated validation error message.
 */
function makeValidationErrorMessage(error, overriddenErrorMessages) {
    if (error.customMessage) {
        return error.customMessage;
    }
    // customMessageId, or the first key 
    let messageId = error.customMessageId
        || error.messageIds?.reverse().find((messageId) => overriddenErrorMessages?.has(messageId) || messages_1.default.has(messageId))
        || (error.messageIds?.length ? error.messageIds.at(-1) : undefined);
    let message = "Validation failed for '{key}'; expected '{validationName}/{validationValue}', received '{received}/{refinedReceived}'.";
    if (messageId && (overriddenErrorMessages?.has(messageId) || messages_1.default.has(messageId))) {
        message = overriddenErrorMessages?.get(messageId) ?? messages_1.default.get(messageId);
    }
    error.path = error.path ?? [''];
    const [inputKey] = error.path;
    message = message.replace('{key}', inputKey);
    message = message.replace('{path}', error.path.reverse().toString());
    const [validationName, validationValue] = error.expected ?? [];
    message = message.replace('{validationName}', validationName ? validationName + '' : '');
    message = message.replace('{validationValue}', validationValue ? validationValue + '' : '');
    const [received, refinedReceived] = error.received ?? [];
    message = message.replace('{received}', received ? received + '' : '');
    message = message.replace('{refinedReceived}', refinedReceived ? refinedReceived + '' : '');
    return message;
}
/**
 * Creates validation message IDs for a given prefix.
 * @param key - The prefix key.
 * @param errorMessageIds - An array of existing error message IDs.
 * @returns An array of new error message IDs with the prefix key.
 */
function makeValidationMessageIdsForPrefix(key, errorMessageIds) {
    // make new keys by prepending the new key all existing ids
    const keyIds = errorMessageIds.map(id => `${key.toLowerCase()}.${id}`);
    return keyIds;
}
/**
 * Generates an array of validation error message IDs based on the provided validation name and value.
 * @param validationName - The name of the validation.
 * @param validationValue - The value of the validation.
 * @returns An array of validation error message IDs.
 */
function makeValidationErrorMessageIds(validationName, validationValue) {
    const keys = [validationName.toLowerCase()];
    const ids = [keys.join('.')];
    if (isComplexValidationValueWithMessage(validationValue)) {
        keys.push((validationValue.value + '').toLowerCase());
    }
    else if (isComplexValidationValueWithValidator(validationValue)) {
        keys.push('validator');
    }
    else {
        keys.push((validationValue + '').toLowerCase());
    }
    ids.push(keys.join('.'));
    // add the custom id to the very last
    if (validationValue.messageId) {
        ids.push(validationValue.messageId);
    }
    return ids;
}
/**
 * Generates an array of HTTP validation message IDs.
 * @param options - The options for generating the validation message IDs.
 * @returns An array of validation message IDs.
 */
function makeHttpValidationMessageIds(options) {
    const { validationType, propertyName, errorMessageIds } = options;
    const keys = ['http', validationType];
    if (propertyName) {
        keys.push(propertyName.toLowerCase());
    }
    const propIds = makeValidationMessageIdsForPrefix(keys.join('.'), errorMessageIds);
    // prefix everything with 'validation.'
    return errorMessageIds.concat(propIds).map(id => `validation.${id}`);
}
/**
 * Generates an array of validation message IDs for a given entity, validation type, property, and error message IDs.
 * @param entityName - The name of the entity.
 * @param validationType - The type of validation ('input', 'actor', or 'record').
 * @param propertyName - The name of the property.
 * @param errorMessageIds - An array of error message IDs.
 * @returns An array of validation message IDs.
 */
function makeEntityValidationMessageIds(entityName, validationType, propertyName, errorMessageIds) {
    // error messages with property names prefixes
    const propIds = makeValidationMessageIdsForPrefix(propertyName, errorMessageIds);
    // error messages with validation type and property names prefixes
    const validationTypeIds = makeValidationMessageIdsForPrefix(validationType, propIds);
    // error messages with entity.[entityName].[property/[inputType.property]] prefixes
    const entityValidationIds = makeValidationMessageIdsForPrefix(`entity.${entityName}`, errorMessageIds.concat(propIds.concat(validationTypeIds)));
    // all messages with validation prefixes
    return errorMessageIds.concat(entityValidationIds).map(id => `validation.${id}`);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdmFsaWRhdGlvbi91dGlscy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQVNBLDRDQU1DO0FBRUQsMERBTUM7QUFFRCw4REFNQztBQUVELHNEQUlDO0FBRUQsa0VBWUM7QUFFRCxzRUFJQztBQUVELDREQUVDO0FBRUQsa0ZBS0M7QUFFRCxzRkFJQztBQUVELDBEQVFDO0FBRUQsa0RBd0JDO0FBRUQsa0VBU0M7QUFlRCw0RkF5R0M7QUFRRCxnRUErQkM7QUFRRCw4RUFPQztBQVFELHNFQXlCQztBQU9ELG9FQW1CQztBQVVELHdFQWlCQztBQTVYRCx3Q0FBMEM7QUFFMUMsbUNBQTJnQjtBQUUzZ0IsMERBQThDO0FBRTlDLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxnQkFBZ0IsQ0FBQyxDQUFDO0FBRTlDLFNBQWdCLGdCQUFnQixDQUFxQixJQUFTO0lBQzFELE1BQU0sR0FBRyxHQUFHLE9BQU8sSUFBSSxLQUFLLFFBQVE7V0FDN0IsSUFBSSxLQUFLLElBQUk7V0FDYixNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLHVCQUFlLENBQUMsUUFBUSxDQUFDLEdBQVUsQ0FBQyxJQUFJLFlBQVksS0FBSyxHQUFHLENBQUUsQ0FBQztJQUVyRyxPQUFPLEdBQUcsQ0FBQztBQUNmLENBQUM7QUFFRCxTQUFnQix1QkFBdUIsQ0FBSyxLQUFVO0lBQ2xELE1BQU0sR0FBRyxHQUFHLE9BQU8sS0FBSyxLQUFLLFFBQVE7V0FDOUIsS0FBSyxLQUFLLElBQUk7V0FDZCxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztXQUNwQixLQUFLLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFDcEMsT0FBTyxHQUFHLENBQUM7QUFDZixDQUFDO0FBRUQsU0FBZ0IseUJBQXlCLENBQUMsVUFB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QixFQUNsQixjQUE0QyxFQUM1QyxZQUFvQixFQUNwQixlQUE4QjtJQUc5Qiw4Q0FBOEM7SUFDOUMsTUFBTSxPQUFPLEdBQUcsaUNBQWlDLENBQUMsWUFBWSxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBQ2pGLGtFQUFrRTtJQUNsRSxNQUFNLGlCQUFpQixHQUFHLGlDQUFpQyxDQUFDLGNBQWMsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUVyRixtRkFBbUY7SUFDbkYsTUFBTSxtQkFBbUIsR0FBRyxpQ0FBaUMsQ0FBQyxVQUFVLFVBQVUsRUFBRSxFQUFFLGVBQWUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUVqSix3Q0FBd0M7SUFDeEMsT0FBTyxlQUFlLENBQUMsTUFBTSxDQUFDLG1CQUFtQixDQUFDLENBQUMsR0FBRyxDQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsY0FBYyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQ3RGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFbnRpdHlTY2hlbWEsIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgVEVudGl0eU9wc0lucHV0U2NoZW1hcyB9IGZyb20gXCIuLi9lbnRpdHlcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEZWVwV3JpdGFibGUgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IENvbXBsZXhWYWxpZGF0aW9uUnVsZSwgQ29uZGl0aW9uc0FuZFNjb3BlVHVwbGUsIEVudGl0eU9wZXJhdGlvblZhbGlkYXRpb24sIEVudGl0eUlucHV0VmFsaWRhdGlvbnMsIEVudGl0eVZhbGlkYXRpb25zLCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJbnB1dFR5cGUsIElucHV0VmFsaWRhdGlvblJ1bGUsIE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbiwgVENvbXBsZXhWYWxpZGF0aW9uVmFsdWUgYXMgQ29tcGxleFZhbGlkYXRpb25WYWx1ZSwgVENvbXBsZXhWYWxpZGF0aW9uVmFsdWVXaXRoTWVzc2FnZSBhcyBDb21wbGV4VmFsaWRhdGlvblZhbHVlV2l0aE1lc3NhZ2UsIFRDb21wbGV4VmFsaWRhdGlvblZhbHVlV2l0aFZhbGlkYXRvciBhcyBDb21wbGV4VmFsaWRhdGlvblZhbHVlV2l0aFZhbGlkYXRvciwgVFZhbGlkYXRpb25WYWx1ZSwgVGVzdENvbXBsZXhWYWxpZGF0aW9uUmVzdWx0LCBWYWxpZGF0aW9uRXJyb3IsIFZhbGlkYXRpb25SdWxlLCBWYWxpZGF0aW9uX0tleXMgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5pbXBvcnQgZ2VuZXJpY0Vycm9yTWVzc2FnZXMgZnJvbSAnLi9tZXNzYWdlcyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignVmFsaWRhdG9yVXRpbHMnKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRhdGlvblJ1bGU8VCBleHRlbmRzIHVua25vd24+KCBydWxlOiBhbnkpOiBydWxlIGlzIFZhbGlkYXRpb25SdWxlPFQ+IHtcbiAgICBjb25zdCByZXMgPSB0eXBlb2YgcnVsZSA9PT0gJ29iamVjdCcgXG4gICAgICAgICYmIHJ1bGUgIT09IG51bGxcbiAgICAgICAgJiYgT2JqZWN0LmtleXMocnVsZSkuZXZlcnkoa2V5ID0+IFZhbGlkYXRpb25fS2V5cy5pbmNsdWRlcyhrZXkgYXMgYW55KSB8fCAnb3BlcmF0aW9ucycgPT09IGtleSApO1xuXG4gICAgcmV0dXJuIHJlcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQXJyYXlPZlZhbGlkYXRpb25SdWxlPFQ+KCBydWxlczogYW55KTogcnVsZXMgaXMgQXJyYXk8VmFsaWRhdGlvblJ1bGU8VD4+IHtcbiAgICBjb25zdCByZXMgPSB0eXBlb2YgcnVsZXMgPT09ICdvYmplY3QnIFxuICAgICAgICAmJiBydWxlcyAhPT0gbnVsbFxuICAgICAgICAmJiBBcnJheS5pc0FycmF5KHJ1bGVzKSBcbiAgICAgICAgJiYgcnVsZXMuZXZlcnkoaXNWYWxpZGF0aW9uUnVsZSlcbiAgICByZXR1cm4gcmVzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNDb25kaXRpb25zQW5kU2NvcGVUdXBsZShjb25kaXRpb25zOiBhbnkpOiBjb25kaXRpb25zIGlzIENvbmRpdGlvbnNBbmRTY29wZVR1cGxlIHtcbiAgICByZXR1cm4gY29uZGl0aW9uc1xuICAgICAgICAmJiBBcnJheS5pc0FycmF5KGNvbmRpdGlvbnMpIFxuICAgICAgICAmJiBjb25kaXRpb25zLmxlbmd0aCA9PSAyIFxuICAgICAgICAmJiBBcnJheS5pc0FycmF5KGNvbmRpdGlvbnNbMF0pIFxuICAgICAgICAmJiBbJ2FsbCcsICdhbnknLCAnbm9uZSddLmluY2x1ZGVzKGNvbmRpdGlvbnNbMV0gYXMgc3RyaW5nKSBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzSW5wdXRWYWxpZGF0aW9uUnVsZTxJbnB1dCBleHRlbmRzIElucHV0VHlwZSA9IElucHV0VHlwZT4oIHJ1bGVzOiBhbnkpOiBydWxlcyBpcyBJbnB1dFZhbGlkYXRpb25SdWxlPElucHV0PiB7XG4gICAgcmV0dXJuIHR5cGVvZiBydWxlcyA9PT0gJ29iamVjdCcgXG4gICAgICAgICYmIHJ1bGVzICE9PSBudWxsXG4gICAgICAgICYmIE9iamVjdC5rZXlzKHJ1bGVzKS5ldmVyeShrZXkgPT4gaXNWYWxpZGF0aW9uUnVsZShydWxlc1trZXldKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSggcnVsZTogYW55KTogcnVsZSBpcyBIdHRwUmVxdWVzdFZhbGlkYXRpb25zIHtcbiAgICByZXR1cm4gdHlwZW9mIHJ1bGUgPT09ICdvYmplY3QnIFxuICAgICAgICAmJiBydWxlICE9PSBudWxsXG4gICAgICAgICYmIChcbiAgICAgICAgICAgIChydWxlLmhhc093blByb3BlcnR5KCdib2R5JykgJiYgaXNJbnB1dFZhbGlkYXRpb25SdWxlKHJ1bGUuYm9keSkpXG4gICAgICAgICAgICB8fCBcbiAgICAgICAgICAgIChydWxlLmhhc093blByb3BlcnR5KCdxdWVyeScpICYmIGlzSW5wdXRWYWxpZGF0aW9uUnVsZShydWxlLnF1ZXJ5KSlcbiAgICAgICAgICAgIHx8IFxuICAgICAgICAgICAgKHJ1bGUuaGFzT3duUHJvcGVydHkoJ3BhcmFtJykgJiYgaXNJbnB1dFZhbGlkYXRpb25SdWxlKHJ1bGUucGFyYW0pKVxuICAgICAgICAgICAgfHwgXG4gICAgICAgICAgICAocnVsZS5oYXNPd25Qcm9wZXJ0eSgnaGVhZGVyJykgJiYgaXNJbnB1dFZhbGlkYXRpb25SdWxlKHJ1bGUuaGVhZGVyKSlcbiAgICAgICAgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNUZXN0Q29tcGxleFZhbGlkYXRpb25SZXN1bHQodmFsOiBhbnkpOiB2YWwgaXMgVGVzdENvbXBsZXhWYWxpZGF0aW9uUmVzdWx0IHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgXG4gICAgICAgICYmIHZhbCAhPT0gbnVsbCBcbiAgICAgICAgJiYgKHZhbC5oYXNPd25Qcm9wZXJ0eSgnY3VzdG9tTWVzc2FnZScpIHx8IHZhbC5oYXNPd25Qcm9wZXJ0eSgnY3VzdG9tTWVzc2FnZUlkJykgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNDb21wbGV4VmFsaWRhdGlvblZhbHVlPFQgPSB1bmtub3duPih2YWw6IGFueSk6IHZhbCBpcyBDb21wbGV4VmFsaWRhdGlvblZhbHVlPFQ+IHtcbiAgICByZXR1cm4gaXNDb21wbGV4VmFsaWRhdGlvblZhbHVlV2l0aE1lc3NhZ2UodmFsKSB8fCBpc0NvbXBsZXhWYWxpZGF0aW9uVmFsdWVXaXRoVmFsaWRhdG9yKHZhbCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0NvbXBsZXhWYWxpZGF0aW9uVmFsdWVXaXRoTWVzc2FnZTxUID0gdW5rbm93bj4odmFsOiBhbnkpOiB2YWwgaXMgQ29tcGxleFZhbGlkYXRpb25WYWx1ZVdpdGhNZXNzYWdlPFQ+IHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgXG4gICAgICAgICYmIHZhbCAhPT0gbnVsbCBcbiAgICAgICAgJiYgdmFsLmhhc093blByb3BlcnR5KCd2YWx1ZScpIFxuICAgICAgICAmJiAodmFsLmhhc093blByb3BlcnR5KCdtZXNzYWdlJykgfHwgdmFsLmhhc093blByb3BlcnR5KCdtZXNzYWdlSWQnKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZVdpdGhWYWxpZGF0b3I8VCA9IHVua25vd24+KHZhbDogYW55KTogdmFsIGlzIENvbXBsZXhWYWxpZGF0aW9uVmFsdWVXaXRoVmFsaWRhdG9yPFQ+IHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgXG4gICAgICAgICYmIHZhbCAhPT0gbnVsbCBcbiAgICAgICAgJiYgdmFsLmhhc093blByb3BlcnR5KCd2YWxpZGF0b3InKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNDb21wbGV4VmFsaWRhdGlvblJ1bGU8VCA9IHVua25vd24+KHZhbDogYW55KTogdmFsIGlzIENvbXBsZXhWYWxpZGF0aW9uUnVsZTxUPiB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWwgPT09ICdvYmplY3QnIFxuICAgICAgICAmJiB2YWwgIT09IG51bGwgXG4gICAgICAgICYmICggXG4gICAgICAgICAgICB2YWwuaGFzT3duUHJvcGVydHkoJ3ZhbGlkYXRvcicpXG4gICAgICAgICAgICB8fCBcbiAgICAgICAgICAgICh2YWwuaGFzT3duUHJvcGVydHkoJ21lc3NhZ2UnKSB8fCB2YWwuaGFzT3duUHJvcGVydHkoJ21lc3NhZ2VJZCcpICkgXG4gICAgICAgIClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzRW50aXR5VmFsaWRhdGlvbnM8XG4gIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBPcHM+LCBcbiAgQ29uZGl0aW9uc01hcCBleHRlbmRzIE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbjxhbnksIGFueT4sXG4gIE9wcyBleHRlbmRzIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyA9IFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgT3BzSW5wU2NoIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPihcbiAgICB2YWxpZGF0aW9uczogYW55XG5cbik6IHZhbGlkYXRpb25zIGlzIEVudGl0eVZhbGlkYXRpb25zPFNjaCwgQ29uZGl0aW9uc01hcCwgT3BzSW5wU2NoPiB7XG4gICAgY29uc3QgcmVzID0gdHlwZW9mIHZhbGlkYXRpb25zID09PSAnb2JqZWN0JyBcbiAgICAgICAgJiYgdmFsaWRhdGlvbnMgIT09IG51bGxcbiAgICAgICAgJiYgIE9iamVjdC5rZXlzKHZhbGlkYXRpb25zKS5ldmVyeSggdmFsaWRhdGlvblR5cGUgPT5cbiAgICAgICAgICAgIFsnY29uZGl0aW9ucycsICdpbnB1dCcsICdyZWNvcmQnLCAnYWN0b3InXS5pbmNsdWRlcyh2YWxpZGF0aW9uVHlwZSlcbiAgICAgICAgICAgICYmICggXG4gICAgICAgICAgICAgICAgIXZhbGlkYXRpb25zW3ZhbGlkYXRpb25UeXBlXSB8fCB2YWxpZGF0aW9uVHlwZSA9PT0gJ2NvbmRpdGlvbnMnXG4gICAgICAgICAgICAgICAgfHwgKFxuICAgICAgICAgICAgICAgICAgICB0eXBlb2YgdmFsaWRhdGlvbnNbdmFsaWRhdGlvblR5cGVdID09PSAnb2JqZWN0JyBcbiAgICAgICAgICAgICAgICAgICAgJiYgT2JqZWN0LmtleXModmFsaWRhdGlvbnNbdmFsaWRhdGlvblR5cGVdKS5ldmVyeSggcHJvcCA9PiBcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzQXJyYXlPZlZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zW3ZhbGlkYXRpb25UeXBlXVtwcm9wXSlcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgIClcbiAgICApO1xuICAgIHJldHVybiByZXM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0VudGl0eU9wc0lucHV0VmFsaWRhdGlvbnM8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc0lucFNjaCBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPlxuPihcbiAgICB2YWxpZGF0aW9uczogYW55XG5cbik6IHZhbGlkYXRpb25zIGlzIEVudGl0eUlucHV0VmFsaWRhdGlvbnM8U2NoLCBPcHNJbnBTY2g+IHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbGlkYXRpb25zID09PSAnb2JqZWN0JyAmJiB2YWxpZGF0aW9ucyAhPT0gbnVsbFxuICAgICAgICAmJiAgT2JqZWN0LmtleXModmFsaWRhdGlvbnMpLmV2ZXJ5KCBwcm9wID0+IGlzQXJyYXlPZlZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zW3Byb3BdKSlcbn1cblxuLyoqXG4gKiBFeHRyYWN0cyBvcGVyYXRpb24tc3BlY2lmaWMgdmFsaWRhdGlvbnMgZnJvbSBlbnRpdHkgdmFsaWRhdGlvbnMuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIENvbmRpdGlvbnNNYXAgLSBUaGUgbWFwIG9mIHZhbGlkYXRpb24gY29uZGl0aW9ucy5cbiAqIEB0ZW1wbGF0ZSBPcHMgLSBUaGUgZGVmYXVsdCBlbnRpdHkgb3BlcmF0aW9ucyB0eXBlLlxuICogQHRlbXBsYXRlIE9wc0lucFNjaCAtIFRoZSBlbnRpdHkgb3BlcmF0aW9ucyBpbnB1dCBzY2hlbWFzIHR5cGUuXG4gKiBcbiAqIEBwYXJhbSB7a2V5b2YgT3BzSW5wU2NofSBvcGVyYXRpb25OYW1lIC0gVGhlIG5hbWUgb2YgdGhlIG9wZXJhdGlvbi5cbiAqIEBwYXJhbSB7RW50aXR5VmFsaWRhdGlvbnM8U2NoLCBDb25kaXRpb25zTWFwLCBPcHNJbnBTY2g+IHwgRW50aXR5SW5wdXRWYWxpZGF0aW9uczxTY2gsIE9wc0lucFNjaD59IGVudGl0eVZhbGlkYXRpb25zIC0gVGhlIGVudGl0eSB2YWxpZGF0aW9ucyBvciBlbnRpdHkgaW5wdXQgdmFsaWRhdGlvbnMuXG4gKiBcbiAqIEByZXR1cm5zIHt7IG9wVmFsaWRhdGlvbnM6IEVudGl0eU9wZXJhdGlvblZhbGlkYXRpb248YW55LCBhbnksIENvbmRpdGlvbnNNYXA+LCBjb25kaXRpb25zOiBhbnkgfX0gLSBUaGUgZXh0cmFjdGVkIG9wZXJhdGlvbiB2YWxpZGF0aW9ucyBhbmQgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RPcFZhbGlkYXRpb25Gcm9tRW50aXR5VmFsaWRhdGlvbnM8XG4gIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBPcHM+LCBcbiAgQ29uZGl0aW9uc01hcCBleHRlbmRzIE1hcE9mVmFsaWRhdGlvbkNvbmRpdGlvbjxhbnksIGFueT4sXG4gIE9wcyBleHRlbmRzIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyA9IFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgT3BzSW5wU2NoIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiggXG4gIG9wZXJhdGlvbk5hbWU6IGtleW9mIE9wc0lucFNjaCwgXG4gIGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxTY2gsIENvbmRpdGlvbnNNYXAsIE9wc0lucFNjaD4gfCBFbnRpdHlJbnB1dFZhbGlkYXRpb25zPFNjaCwgT3BzSW5wU2NoPlxuKXtcblxuXHRjb25zdCBlbnRpdHlPcFZhbGlkYXRpb25zOiBEZWVwV3JpdGFibGU8RW50aXR5T3BlcmF0aW9uVmFsaWRhdGlvbjxhbnksIGFueSwgQ29uZGl0aW9uc01hcD4+ID0ge1xuXHRcdGFjdG9yOiB7fSxcblx0XHRpbnB1dDoge30sXG5cdFx0cmVjb3JkOiB7fSxcblx0fVxuXG4gICAgaWYoaXNFbnRpdHlPcHNJbnB1dFZhbGlkYXRpb25zKGVudGl0eVZhbGlkYXRpb25zKSl7XG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zID0ge1xuICAgICAgICAgICAgaW5wdXQ6IGVudGl0eVZhbGlkYXRpb25zIGFzIEVudGl0eVZhbGlkYXRpb25zPFNjaCwgQ29uZGl0aW9uc01hcCwgT3BzSW5wU2NoPlsnaW5wdXQnXVxuICAgICAgICB9XG4gICAgfSBcblxuICAgIGlmKCFpc0VudGl0eVZhbGlkYXRpb25zKGVudGl0eVZhbGlkYXRpb25zKSl7XG4gICAgICAgIHRocm93KGBJbnZhbGlkIGVudGl0eSB2YWxpZGF0aW9ucyAke2VudGl0eVZhbGlkYXRpb25zfWApO1xuICAgIH1cblxuXHRmb3IoY29uc3QgdmFsaWRhdGlvbkdyb3VwS2V5IG9mIFsnYWN0b3InLCAnaW5wdXQnLCAncmVjb3JkJyBdIGFzIGNvbnN0ICl7XG5cdFx0XG4gICAgICAgIGNvbnN0IGdyb3VwVmFsaWRhdGlvblJ1bGVzID0gZW50aXR5VmFsaWRhdGlvbnNbdmFsaWRhdGlvbkdyb3VwS2V5XTtcblx0XHRpZighZ3JvdXBWYWxpZGF0aW9uUnVsZXMpeyBjb250aW51ZTsgfVxuXG5cdFx0Zm9yKGNvbnN0IHByb3BlcnR5TmFtZSBpbiBncm91cFZhbGlkYXRpb25SdWxlcyl7XG5cblx0XHRcdGNvbnN0IHByb3BlcnR5UnVsZXMgPSBncm91cFZhbGlkYXRpb25SdWxlc1twcm9wZXJ0eU5hbWUgYXMga2V5b2YgdHlwZW9mIGdyb3VwVmFsaWRhdGlvblJ1bGVzXTtcblx0XHRcdGlmKCFwcm9wZXJ0eVJ1bGVzKXsgY29udGludWU7IH1cblxuXHRcdFx0Y29uc3QgZm9ybWF0dGVkUHJvcGVydHlSdWxlcyA9IFtdO1xuXHRcdFx0XG5cdFx0XHRmb3IoY29uc3QgcnVsZSBvZiBwcm9wZXJ0eVJ1bGVzIGFzIEFycmF5PGFueT4pe1xuXHRcdFx0XHRpZighcnVsZSl7IGNvbnRpbnVlO31cblxuXHRcdFx0XHRsZXR7b3BlcmF0aW9ucywgLi4ucmVzdE9mVGhlVmFsaWRhdGlvbnN9ID0gcnVsZTtcblxuICAgICAgICAgICAgICAgIGlmKCFvcGVyYXRpb25zKXtcbiAgICAgICAgICAgICAgICAgICAgb3BlcmF0aW9ucyA9IFsnKiddO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmKCFBcnJheS5pc0FycmF5KG9wZXJhdGlvbnMpKXtcbiAgICAgICAgICAgICAgICAgICAgZm9yKGNvbnN0IG9wTmFtZSBpbiBvcGVyYXRpb25zKXtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmKCAhb3BlcmF0aW9ucy5oYXNPd25Qcm9wZXJ0eShvcE5hbWUpIHx8IG9wTmFtZSAhPT0gb3BlcmF0aW9uTmFtZSApe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvcENvbmRpdGlvblJ1bGVzOiBhbnlbXSA9IG9wZXJhdGlvbnNbb3BOYW1lXTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYoIUFycmF5LmlzQXJyYXkob3BDb25kaXRpb25SdWxlcykpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBvcGVyYXRpb25zIGRlZmluaXRpb24gZm9yICR7b3BOYW1lfSBpbiAke29wZXJhdGlvbnN9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG9wQ29uZGl0aW9uUnVsZXMuZm9yRWFjaCggKHJ1bGU6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCB0aGlzUnVsZVZhbGlkYXRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5yZXN0T2ZUaGVWYWxpZGF0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9uczogWyBydWxlWydjb25kaXRpb25zJ10sIHJ1bGVbJ3Njb3BlJ10gPz8gJ2FsbCcgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1hdHRlZFByb3BlcnR5UnVsZXMucHVzaCh0aGlzUnVsZVZhbGlkYXRpb25zKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkob3BlcmF0aW9ucykpe1xuICAgICAgICAgICAgICAgICAgICBmb3IoY29uc3QgdGhpc09wIG9mIG9wZXJhdGlvbnMpe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodGhpc09wKSAmJiB0aGlzT3BbMF0gPT09IG9wZXJhdGlvbk5hbWUgKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgW3RoaXNPcE5hbWUsIGNvbmRpdGlvbnM9IHVuZGVmaW5lZCwgc2NvcGUgPSAnYWxsJ10gPSB0aGlzT3A7XG4gICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICogXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICogWyd1cGRhdGUnLCBbJ3JlY29yZElzTm90TmV3JywgJ3RlbmFudElzWFlaJ11dLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIFsndXBkYXRlJywgW1sncmVjb3JkSXNOb3ROZXcnLCAnaW5wdXRJc05pdGluJ10sICdhbnknXV1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgdGhpc1J1bGVWYWxpZGF0aW9uczogYW55ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5yZXN0T2ZUaGVWYWxpZGF0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9uczogY29uZGl0aW9ucyA/IFsgY29uZGl0aW9ucywgc2NvcGVdIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9ybWF0dGVkUHJvcGVydHlSdWxlcy5wdXNoKHRoaXNSdWxlVmFsaWRhdGlvbnMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmKCB0aGlzT3AgPT09ICcqJyB8fCB0aGlzT3AgPT09IG9wZXJhdGlvbk5hbWUpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1hdHRlZFByb3BlcnR5UnVsZXMucHVzaCh7IC4uLnJlc3RPZlRoZVZhbGlkYXRpb25zIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXHRcdFx0XG5cblx0XHRcdFx0aWYoZm9ybWF0dGVkUHJvcGVydHlSdWxlcy5sZW5ndGgpe1xuXHRcdFx0XHRcdGVudGl0eU9wVmFsaWRhdGlvbnNbdmFsaWRhdGlvbkdyb3VwS2V5XSFbcHJvcGVydHlOYW1lXSA9IGZvcm1hdHRlZFByb3BlcnR5UnVsZXM7XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0bG9nZ2VyLmRlYnVnKFwiTm8gYXBwbGljYWJsZSBydWxlcyBmb3VuZCBmb3Igb3A6IHByb3A6IGdyb3VwOiBmcm9tLXJ1bGU6XCIsIFtvcGVyYXRpb25OYW1lLCBwcm9wZXJ0eU5hbWUsIHZhbGlkYXRpb25Hcm91cEtleSwgcnVsZV0pO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG4gICAgXG5cdHJldHVybiB7XG5cdFx0b3BWYWxpZGF0aW9uczogey4uLmVudGl0eU9wVmFsaWRhdGlvbnN9IGFzIEVudGl0eU9wZXJhdGlvblZhbGlkYXRpb248YW55LCBhbnksIENvbmRpdGlvbnNNYXA+LCBcblx0XHRjb25kaXRpb25zOiBlbnRpdHlWYWxpZGF0aW9ucy5jb25kaXRpb25zXG5cdH1cbn1cblxuLyoqXG4gKiBHZW5lcmF0ZXMgYSB2YWxpZGF0aW9uIGVycm9yIG1lc3NhZ2UgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGVycm9yIG9iamVjdCBhbmQgb3B0aW9uYWwgb3ZlcnJpZGRlbiBlcnJvciBtZXNzYWdlcy5cbiAqIEBwYXJhbSBlcnJvciAtIFRoZSB2YWxpZGF0aW9uIGVycm9yIG9iamVjdC5cbiAqIEBwYXJhbSBvdmVycmlkZGVuRXJyb3JNZXNzYWdlcyAtIE9wdGlvbmFsIG1hcCBvZiBvdmVycmlkZGVuIGVycm9yIG1lc3NhZ2VzLlxuICogQHJldHVybnMgVGhlIGdlbmVyYXRlZCB2YWxpZGF0aW9uIGVycm9yIG1lc3NhZ2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlVmFsaWRhdGlvbkVycm9yTWVzc2FnZShlcnJvcjogVmFsaWRhdGlvbkVycm9yLCBvdmVycmlkZGVuRXJyb3JNZXNzYWdlcyA/OiBNYXA8c3RyaW5nLCBzdHJpbmc+KXtcblxuICAgIGlmKGVycm9yLmN1c3RvbU1lc3NhZ2Upe1xuICAgICAgICByZXR1cm4gZXJyb3IuY3VzdG9tTWVzc2FnZTtcbiAgICB9XG4gICAgXG4gICAgLy8gY3VzdG9tTWVzc2FnZUlkLCBvciB0aGUgZmlyc3Qga2V5IFxuICAgIGxldCBtZXNzYWdlSWQgPSBlcnJvci5jdXN0b21NZXNzYWdlSWQgXG4gICAgICAgIHx8IGVycm9yLm1lc3NhZ2VJZHM/LnJldmVyc2UoKS5maW5kKCAobWVzc2FnZUlkKSA9PiBvdmVycmlkZGVuRXJyb3JNZXNzYWdlcz8uaGFzKG1lc3NhZ2VJZCkgfHwgZ2VuZXJpY0Vycm9yTWVzc2FnZXMuaGFzKG1lc3NhZ2VJZCkgKVxuICAgICAgICB8fCAoIGVycm9yLm1lc3NhZ2VJZHM/Lmxlbmd0aCA/IGVycm9yLm1lc3NhZ2VJZHMuYXQoLTEpIDogdW5kZWZpbmVkKVxuXG4gICAgbGV0IG1lc3NhZ2UgPSBcIlZhbGlkYXRpb24gZmFpbGVkIGZvciAne2tleX0nOyBleHBlY3RlZCAne3ZhbGlkYXRpb25OYW1lfS97dmFsaWRhdGlvblZhbHVlfScsIHJlY2VpdmVkICd7cmVjZWl2ZWR9L3tyZWZpbmVkUmVjZWl2ZWR9Jy5cIjtcblxuICAgIGlmKG1lc3NhZ2VJZCAmJiAoIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzPy5oYXMobWVzc2FnZUlkKSB8fCBnZW5lcmljRXJyb3JNZXNzYWdlcy5oYXMobWVzc2FnZUlkKSkgKXtcbiAgICAgICAgbWVzc2FnZSA9IG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzPy5nZXQobWVzc2FnZUlkKSA/PyBnZW5lcmljRXJyb3JNZXNzYWdlcy5nZXQobWVzc2FnZUlkKSE7XG4gICAgfVxuICAgIFxuICAgIGVycm9yLnBhdGggPSBlcnJvci5wYXRoID8/IFsnJ107XG4gICAgY29uc3QgW2lucHV0S2V5XSA9IGVycm9yLnBhdGg7XG4gICAgbWVzc2FnZSA9IG1lc3NhZ2UucmVwbGFjZSgne2tleX0nLCBpbnB1dEtleSk7XG4gICAgbWVzc2FnZSA9IG1lc3NhZ2UucmVwbGFjZSgne3BhdGh9JywgZXJyb3IucGF0aC5yZXZlcnNlKCkudG9TdHJpbmcoKSk7XG5cbiAgICBjb25zdCBbdmFsaWRhdGlvbk5hbWUsIHZhbGlkYXRpb25WYWx1ZV0gPSBlcnJvci5leHBlY3RlZCA/PyBbXTtcbiAgICBtZXNzYWdlID0gbWVzc2FnZS5yZXBsYWNlKCd7dmFsaWRhdGlvbk5hbWV9JywgdmFsaWRhdGlvbk5hbWUgPyB2YWxpZGF0aW9uTmFtZSArICcnIDogJycpO1xuICAgIG1lc3NhZ2UgPSBtZXNzYWdlLnJlcGxhY2UoJ3t2YWxpZGF0aW9uVmFsdWV9JywgdmFsaWRhdGlvblZhbHVlID8gdmFsaWRhdGlvblZhbHVlICsgJycgOiAnJyk7XG5cbiAgICBjb25zdCBbcmVjZWl2ZWQsIHJlZmluZWRSZWNlaXZlZF0gPSBlcnJvci5yZWNlaXZlZCA/PyBbXTtcbiAgICBtZXNzYWdlID0gbWVzc2FnZS5yZXBsYWNlKCd7cmVjZWl2ZWR9JywgcmVjZWl2ZWQgPyByZWNlaXZlZCArICcnIDogJycpO1xuICAgIG1lc3NhZ2UgPSBtZXNzYWdlLnJlcGxhY2UoJ3tyZWZpbmVkUmVjZWl2ZWR9JywgcmVmaW5lZFJlY2VpdmVkID8gcmVmaW5lZFJlY2VpdmVkICsgJycgOiAnJyk7XG5cbiAgICByZXR1cm4gbWVzc2FnZTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIHZhbGlkYXRpb24gbWVzc2FnZSBJRHMgZm9yIGEgZ2l2ZW4gcHJlZml4LlxuICogQHBhcmFtIGtleSAtIFRoZSBwcmVmaXgga2V5LlxuICogQHBhcmFtIGVycm9yTWVzc2FnZUlkcyAtIEFuIGFycmF5IG9mIGV4aXN0aW5nIGVycm9yIG1lc3NhZ2UgSURzLlxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgbmV3IGVycm9yIG1lc3NhZ2UgSURzIHdpdGggdGhlIHByZWZpeCBrZXkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlVmFsaWRhdGlvbk1lc3NhZ2VJZHNGb3JQcmVmaXgoXG4gICAga2V5OiBzdHJpbmcsIFxuICAgIGVycm9yTWVzc2FnZUlkczogQXJyYXk8c3RyaW5nPixcbik6IEFycmF5PHN0cmluZz4ge1xuICAgIC8vIG1ha2UgbmV3IGtleXMgYnkgcHJlcGVuZGluZyB0aGUgbmV3IGtleSBhbGwgZXhpc3RpbmcgaWRzXG4gICAgY29uc3Qga2V5SWRzID0gZXJyb3JNZXNzYWdlSWRzLm1hcChpZCA9PiBgJHtrZXkudG9Mb3dlckNhc2UoKX0uJHtpZH1gKTtcbiAgICByZXR1cm4ga2V5SWRzO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhbiBhcnJheSBvZiB2YWxpZGF0aW9uIGVycm9yIG1lc3NhZ2UgSURzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCB2YWxpZGF0aW9uIG5hbWUgYW5kIHZhbHVlLlxuICogQHBhcmFtIHZhbGlkYXRpb25OYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHZhbGlkYXRpb24uXG4gKiBAcGFyYW0gdmFsaWRhdGlvblZhbHVlIC0gVGhlIHZhbHVlIG9mIHRoZSB2YWxpZGF0aW9uLlxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgdmFsaWRhdGlvbiBlcnJvciBtZXNzYWdlIElEcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VWYWxpZGF0aW9uRXJyb3JNZXNzYWdlSWRzKFxuICAgIHZhbGlkYXRpb25OYW1lOiBzdHJpbmcsIFxuICAgIHZhbGlkYXRpb25WYWx1ZTogVFZhbGlkYXRpb25WYWx1ZTxhbnk+LFxuICAgIC8vIGlucHV0VmFsdWU6IGFueSxcbik6IEFycmF5PHN0cmluZz4ge1xuXG4gICAgY29uc3Qga2V5czogQXJyYXk8c3RyaW5nPiA9IFsgdmFsaWRhdGlvbk5hbWUudG9Mb3dlckNhc2UoKSBdO1xuXG4gICAgY29uc3QgaWRzOiBzdHJpbmdbXSA9IFsga2V5cy5qb2luKCcuJykgXTtcblxuICAgIGlmKGlzQ29tcGxleFZhbGlkYXRpb25WYWx1ZVdpdGhNZXNzYWdlKHZhbGlkYXRpb25WYWx1ZSkpe1xuICAgICAgICBrZXlzLnB1c2goICggdmFsaWRhdGlvblZhbHVlLnZhbHVlKycnICkudG9Mb3dlckNhc2UoKSApO1xuICAgIH0gZWxzZSBpZihpc0NvbXBsZXhWYWxpZGF0aW9uVmFsdWVXaXRoVmFsaWRhdG9yKHZhbGlkYXRpb25WYWx1ZSkpIHtcbiAgICAgICAga2V5cy5wdXNoKCd2YWxpZGF0b3InKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBrZXlzLnB1c2goICh2YWxpZGF0aW9uVmFsdWUrJycpLnRvTG93ZXJDYXNlKCkgKTtcbiAgICB9XG4gICAgaWRzLnB1c2goIGtleXMuam9pbignLicpICk7XG5cbiAgICAvLyBhZGQgdGhlIGN1c3RvbSBpZCB0byB0aGUgdmVyeSBsYXN0XG4gICAgaWYodmFsaWRhdGlvblZhbHVlLm1lc3NhZ2VJZCl7XG4gICAgICAgIGlkcy5wdXNoKHZhbGlkYXRpb25WYWx1ZS5tZXNzYWdlSWQpO1xuICAgIH1cblxuICAgIHJldHVybiBpZHM7XG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGFuIGFycmF5IG9mIEhUVFAgdmFsaWRhdGlvbiBtZXNzYWdlIElEcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGdlbmVyYXRpbmcgdGhlIHZhbGlkYXRpb24gbWVzc2FnZSBJRHMuXG4gKiBAcmV0dXJucyBBbiBhcnJheSBvZiB2YWxpZGF0aW9uIG1lc3NhZ2UgSURzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFrZUh0dHBWYWxpZGF0aW9uTWVzc2FnZUlkcyhcbiAgICBvcHRpb25zOiB7XG4gICAgICAgIHZhbGlkYXRpb25UeXBlOiAnYm9keScgfCAncGFyYW0nIHwgJ3F1ZXJ5JyB8ICdoZWFkZXInLFxuICAgICAgICBlcnJvck1lc3NhZ2VJZHM6IEFycmF5PHN0cmluZz4sXG4gICAgICAgIHByb3BlcnR5TmFtZSA/OiBzdHJpbmcsXG4gICAgfVxuKTogQXJyYXk8c3RyaW5nPiB7XG5cbiAgICBjb25zdCB7IHZhbGlkYXRpb25UeXBlLCBwcm9wZXJ0eU5hbWUsIGVycm9yTWVzc2FnZUlkcyB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IGtleXMgPSBbJ2h0dHAnLCB2YWxpZGF0aW9uVHlwZV07XG4gICAgaWYocHJvcGVydHlOYW1lKXtcbiAgICAgICAga2V5cy5wdXNoKHByb3BlcnR5TmFtZS50b0xvd2VyQ2FzZSgpKTtcbiAgICB9XG5cbiAgICBjb25zdCBwcm9wSWRzID0gbWFrZVZhbGlkYXRpb25NZXNzYWdlSWRzRm9yUHJlZml4KCBrZXlzLmpvaW4oJy4nKSwgZXJyb3JNZXNzYWdlSWRzKTtcbiAgICBcbiAgICAvLyBwcmVmaXggZXZlcnl0aGluZyB3aXRoICd2YWxpZGF0aW9uLidcbiAgICByZXR1cm4gZXJyb3JNZXNzYWdlSWRzLmNvbmNhdChwcm9wSWRzKS5tYXAoIGlkID0+IGB2YWxpZGF0aW9uLiR7aWR9YCk7XG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGFuIGFycmF5IG9mIHZhbGlkYXRpb24gbWVzc2FnZSBJRHMgZm9yIGEgZ2l2ZW4gZW50aXR5LCB2YWxpZGF0aW9uIHR5cGUsIHByb3BlcnR5LCBhbmQgZXJyb3IgbWVzc2FnZSBJRHMuXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBlbnRpdHkuXG4gKiBAcGFyYW0gdmFsaWRhdGlvblR5cGUgLSBUaGUgdHlwZSBvZiB2YWxpZGF0aW9uICgnaW5wdXQnLCAnYWN0b3InLCBvciAncmVjb3JkJykuXG4gKiBAcGFyYW0gcHJvcGVydHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHByb3BlcnR5LlxuICogQHBhcmFtIGVycm9yTWVzc2FnZUlkcyAtIEFuIGFycmF5IG9mIGVycm9yIG1lc3NhZ2UgSURzLlxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgdmFsaWRhdGlvbiBtZXNzYWdlIElEcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VFbnRpdHlWYWxpZGF0aW9uTWVzc2FnZUlkcyhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgdmFsaWRhdGlvblR5cGU6ICdpbnB1dCcgfCAnYWN0b3InIHwgJ3JlY29yZCcsIFxuICAgIHByb3BlcnR5TmFtZTogc3RyaW5nLFxuICAgIGVycm9yTWVzc2FnZUlkczogQXJyYXk8c3RyaW5nPixcbik6IEFycmF5PHN0cmluZz4ge1xuXG4gICAgLy8gZXJyb3IgbWVzc2FnZXMgd2l0aCBwcm9wZXJ0eSBuYW1lcyBwcmVmaXhlc1xuICAgIGNvbnN0IHByb3BJZHMgPSBtYWtlVmFsaWRhdGlvbk1lc3NhZ2VJZHNGb3JQcmVmaXgocHJvcGVydHlOYW1lLCBlcnJvck1lc3NhZ2VJZHMpO1xuICAgIC8vIGVycm9yIG1lc3NhZ2VzIHdpdGggdmFsaWRhdGlvbiB0eXBlIGFuZCBwcm9wZXJ0eSBuYW1lcyBwcmVmaXhlc1xuICAgIGNvbnN0IHZhbGlkYXRpb25UeXBlSWRzID0gbWFrZVZhbGlkYXRpb25NZXNzYWdlSWRzRm9yUHJlZml4KHZhbGlkYXRpb25UeXBlLCBwcm9wSWRzKTtcblxuICAgIC8vIGVycm9yIG1lc3NhZ2VzIHdpdGggZW50aXR5LltlbnRpdHlOYW1lXS5bcHJvcGVydHkvW2lucHV0VHlwZS5wcm9wZXJ0eV1dIHByZWZpeGVzXG4gICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbklkcyA9IG1ha2VWYWxpZGF0aW9uTWVzc2FnZUlkc0ZvclByZWZpeChgZW50aXR5LiR7ZW50aXR5TmFtZX1gLCBlcnJvck1lc3NhZ2VJZHMuY29uY2F0KHByb3BJZHMuY29uY2F0KHZhbGlkYXRpb25UeXBlSWRzKSkpO1xuICAgIFxuICAgIC8vIGFsbCBtZXNzYWdlcyB3aXRoIHZhbGlkYXRpb24gcHJlZml4ZXNcbiAgICByZXR1cm4gZXJyb3JNZXNzYWdlSWRzLmNvbmNhdChlbnRpdHlWYWxpZGF0aW9uSWRzKS5tYXAoIGlkID0+IGB2YWxpZGF0aW9uLiR7aWR9YCk7XG59Il19