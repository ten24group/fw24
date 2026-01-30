import { EntitySchema, TDefaultEntityOperations, TEntityOpsInputSchemas } from "../entity";
import { ComplexValidationRule, ConditionsAndScopeTuple, EntityOperationValidation, EntityInputValidations, EntityValidations, HttpRequestValidations, InputType, InputValidationRule, MapOfValidationCondition, TComplexValidationValue as ComplexValidationValue, TComplexValidationValueWithMessage as ComplexValidationValueWithMessage, TComplexValidationValueWithValidator as ComplexValidationValueWithValidator, TValidationValue, TestComplexValidationResult, ValidationError, ValidationRule } from "./types";
export declare function isValidationRule<T extends unknown>(rule: any): rule is ValidationRule<T>;
export declare function isArrayOfValidationRule<T>(rules: any): rules is Array<ValidationRule<T>>;
export declare function isConditionsAndScopeTuple(conditions: any): conditions is ConditionsAndScopeTuple;
export declare function isInputValidationRule<Input extends InputType = InputType>(rules: any): rules is InputValidationRule<Input>;
export declare function isHttpRequestValidationRule(rule: any): rule is HttpRequestValidations;
export declare function isTestComplexValidationResult(val: any): val is TestComplexValidationResult;
export declare function isComplexValidationValue<T = unknown>(val: any): val is ComplexValidationValue<T>;
export declare function isComplexValidationValueWithMessage<T = unknown>(val: any): val is ComplexValidationValueWithMessage<T>;
export declare function isComplexValidationValueWithValidator<T = unknown>(val: any): val is ComplexValidationValueWithValidator<T>;
export declare function isComplexValidationRule<T = unknown>(val: any): val is ComplexValidationRule<T>;
export declare function isEntityValidations<Sch extends EntitySchema<any, any, any, Ops>, ConditionsMap extends MapOfValidationCondition<any, any>, Ops extends TDefaultEntityOperations = TDefaultEntityOperations, OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>>(validations: any): validations is EntityValidations<Sch, ConditionsMap, OpsInpSch>;
export declare function isEntityOpsInputValidations<Sch extends EntitySchema<any, any, any>, OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>>(validations: any): validations is EntityInputValidations<Sch, OpsInpSch>;
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
export declare function extractOpValidationFromEntityValidations<Sch extends EntitySchema<any, any, any, Ops>, ConditionsMap extends MapOfValidationCondition<any, any>, Ops extends TDefaultEntityOperations = TDefaultEntityOperations, OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>>(operationName: keyof OpsInpSch, entityValidations: EntityValidations<Sch, ConditionsMap, OpsInpSch> | EntityInputValidations<Sch, OpsInpSch>): {
    opValidations: EntityOperationValidation<any, any, ConditionsMap>;
    conditions: MapOfValidationCondition<any, any> | (ConditionsMap & MapOfValidationCondition<any, any>) | undefined;
};
/**
 * Generates a validation error message based on the provided error object and optional overridden error messages.
 * @param error - The validation error object.
 * @param overriddenErrorMessages - Optional map of overridden error messages.
 * @returns The generated validation error message.
 */
export declare function makeValidationErrorMessage(error: ValidationError, overriddenErrorMessages?: Map<string, string>): string;
/**
 * Creates validation message IDs for a given prefix.
 * @param key - The prefix key.
 * @param errorMessageIds - An array of existing error message IDs.
 * @returns An array of new error message IDs with the prefix key.
 */
export declare function makeValidationMessageIdsForPrefix(key: string, errorMessageIds: Array<string>): Array<string>;
/**
 * Generates an array of validation error message IDs based on the provided validation name and value.
 * @param validationName - The name of the validation.
 * @param validationValue - The value of the validation.
 * @returns An array of validation error message IDs.
 */
export declare function makeValidationErrorMessageIds(validationName: string, validationValue: TValidationValue<any>): Array<string>;
/**
 * Generates an array of HTTP validation message IDs.
 * @param options - The options for generating the validation message IDs.
 * @returns An array of validation message IDs.
 */
export declare function makeHttpValidationMessageIds(options: {
    validationType: 'body' | 'param' | 'query' | 'header';
    errorMessageIds: Array<string>;
    propertyName?: string;
}): Array<string>;
/**
 * Generates an array of validation message IDs for a given entity, validation type, property, and error message IDs.
 * @param entityName - The name of the entity.
 * @param validationType - The type of validation ('input', 'actor', or 'record').
 * @param propertyName - The name of the property.
 * @param errorMessageIds - An array of error message IDs.
 * @returns An array of validation message IDs.
 */
export declare function makeEntityValidationMessageIds(entityName: string, validationType: 'input' | 'actor' | 'record', propertyName: string, errorMessageIds: Array<string>): Array<string>;
