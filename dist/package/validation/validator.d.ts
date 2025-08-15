/**
 * Defines validation rules and criteria that can be used to validate input, record, and actor data.
 * Provides a Validator class that validates data against defined validation rules and criteria.
 */
import { EntitySchema, TEntityOpsInputSchemas } from "../entity";
import { Actor, ComplexValidationRule, ConditionalValidationRule, EntityValidationCondition, ValidatorResult, IValidator, InputType, InputValidationResult, InputValidationRule, MapOfValidationCondition, OpValidatorOptions, RecordType, TComplexValidationValue, TValidationValue, TestComplexValidationResult, TestComplexValidationRuleResult, TestValidationResult, TestValidationRuleResult, ValidateHttpRequestOptions, ValidationRule, Validations } from "./types";
/**
 * Validates input data against a set of validation rules.
 * Supports validating against different criteria via the CriteriaSet.
 * Handles validating at multiple levels (actor, input, record).
 * Returns whether validation passed and any errors.
*/
export declare class Validator implements IValidator {
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    private readonly DEFAULT_MAX_STRING_LENGTH;
    private readonly DEFAULT_MAX_ARRAY_LENGTH;
    /**
     * Validates input data against a set of validation rules with criteria.
     * Handles validating at multiple levels (actor, input, record) based on the options passed in.
     * Returns whether validation passed and any errors.
    */
    validateEntity<Sch extends EntitySchema<any, any, any>, OpName extends keyof Sch['model']['entityOperations'], ConditionsMap extends MapOfValidationCondition<any, any>, OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>>(options: OpValidatorOptions<Sch, OpName, ConditionsMap, OpsInpSch>): Promise<ValidatorResult>;
    /**
     * Tests validations rules for the given input object against the provided validation rules.
     *
     * @param input - The input object to validate.
     * @param rules - The validation rules to test, where each key is a key on the input object.
     * @returns Whether the input passed all the validation rules.
     */
    validateInput<I extends InputType>(input: I | undefined, rules?: InputValidationRule<I>, collectErrors?: boolean): Promise<InputValidationResult<I>>;
    /**
     * Tests validations rules for the given input object against the provided validation rules.
     *
     * @param input - The input object to validate.
     * @param rules - The validation rules to test, where each key is a key on the input object.
     * @returns Whether the input passed all the validation rules.
     */
    validateHttpRequest<Header extends InputType = InputType, Body extends InputType = InputType, Param extends InputType = InputType, Query extends InputType = InputType>(options: ValidateHttpRequestOptions<Header, Body, Param, Query>): Promise<ValidatorResult>;
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
    validateConditionalRules<I extends InputType = any, R extends RecordType = any>(options: {
        rules: ConditionalValidationRule<any, any>[];
        allConditions: MapOfValidationCondition;
        inputVal?: any;
        input?: I;
        record?: R;
        actor?: Actor;
    }): Promise<TestComplexValidationRuleResult>;
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
    validateConditionalRule<I extends InputType = any, R extends RecordType = any>(options: {
        rule: ConditionalValidationRule<any, any>;
        allConditions: MapOfValidationCondition;
        inputVal?: any;
        input?: I;
        record?: R;
        actor?: Actor;
    }): Promise<TestComplexValidationRuleResult>;
    testConditions<I extends InputType = any, R extends RecordType = any>(options: {
        conditions: ConditionalValidationRule<any, any>['conditions'];
        allConditions: MapOfValidationCondition;
        inputVal?: any;
        input?: I;
        record?: R;
        actor?: Actor;
    }): Promise<boolean>;
    /**
     * Tests if the given criteria is applicable for the provided input, record
     * and actor. Evaluates the actorRules, inputRules and recordRules in the
     * criteria to determine if it is applicable.
     */
    testCondition<I extends InputType, R extends RecordType>(criteria: EntityValidationCondition<I, R>, input?: I, record?: R, actor?: Actor): Promise<boolean>;
    testComplexValidationRule<T>(complexValidationRule: ComplexValidationRule<T>, val: T, collectErrors?: boolean): Promise<TestComplexValidationRuleResult>;
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
    testValidationRule<T>(validationRule: ValidationRule<T>, val: T, collectErrors?: boolean): Promise<TestValidationRuleResult>;
    testComplexValidation<T extends unknown>(validationName: keyof ValidationRule<T>, validationValue: TComplexValidationValue<T>, val: T): Promise<TestComplexValidationResult>;
    /**
     * Validates a value against a set of validation rules.
     *
     * @param partialValidation - The validation rules to check, e.g. {required: true, minLength: 5}.
     * @param val - The value to validate.
     * @returns True if the value passes all validations, false otherwise. Can also return validation error objects.
    */
    testValidation(validationName: keyof Validations<any>, validationValue: TValidationValue<any>, val: any): Promise<TestValidationResult>;
    private validateDataType;
}
