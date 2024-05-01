/**
 * Defines validation rules and criteria that can be used to validate input, record, and actor data.
 * Provides a Validator class that validates data against defined validation rules and criteria.
 */
import { EntitySchema, TEntityOpsInputSchemas } from "../entity";
import { createLogger } from "../logging";
import { isDateString, isEmail, isHttpUrlString, isIP, isIPv4, isIPv6, isJsonString, isNumeric, isNumericString, isUUID, isUnique } from "../utils";
import { Actor, ComplexValidationRule, ConditionalValidationRule, EntityValidationCondition, ValidatorResult, IValidator, InputType, InputValidationResult, InputValidationRule, MapOfValidationCondition, OpValidatorOptions, RecordType, TComplexValidationValue, TValidationValue, TestComplexValidationResult, TestComplexValidationRuleResult, TestValidationResult, TestValidationRuleResult, ValidateHttpRequestOptions, ValidationError, ValidationRule, Validations } from "./types";
import { extractOpValidationFromEntityValidations, isComplexValidationValue, isComplexValidationValueWithMessage, isComplexValidationValueWithValidator, isConditionsAndScopeTuple, isTestComplexValidationResult, makeEntityValidationMessageIds, makeHttpValidationMessageIds, makeValidationErrorMessage, makeValidationErrorMessageIds } from "./utils";

/**
 * Validates input data against a set of validation rules. 
 * Supports validating against different criteria via the CriteriaSet.
 * Handles validating at multiple levels (actor, input, record).
 * Returns whether validation passed and any errors.
*/
export class Validator implements IValidator {
    readonly logger = createLogger(Validator.name);

    /**
     * Validates input data against a set of validation rules with criteria.
     * Handles validating at multiple levels (actor, input, record) based on the options passed in.
     * Returns whether validation passed and any errors.
    */
    async validateEntity<
        Sch extends EntitySchema<any, any, any>, 
        OpName extends keyof Sch['model']['entityOperations'],
        ConditionsMap extends MapOfValidationCondition<any, any>, 
        OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
    >(
        options: OpValidatorOptions<Sch, OpName, ConditionsMap, OpsInpSch>

    ): Promise<ValidatorResult> {
        
        const { entityValidations, entityName, operationName, input, actor, record, 
            collectErrors = true, 
            verboseErrors = false,
            overriddenErrorMessages 
        } = options;
        
        const result: ValidatorResult = {
            pass: true,
            errors: []
        }

        if(!entityValidations){
            return result
        }

        const opsValidationRules = extractOpValidationFromEntityValidations(operationName, entityValidations);

        this.logger.debug("validate ~ rules, input, actor, record:", JSON.stringify({ opsValidationRules, input, actor, record}));
        
        const { conditions } = opsValidationRules;

        for( const ruleType of ['actor', 'input', 'record'] as const){
            const typeRules = opsValidationRules['opValidations'][ruleType];
            if(!typeRules){ continue; } 

            for(const key in typeRules){

                const validationsWithCriteria = typeRules[key as keyof typeof typeRules];
                if(!validationsWithCriteria){ continue; }

                const inputVal = ruleType == 'actor' ? actor?.[key]
                                : ruleType == 'input' ? input?.[key]
                                : ruleType == 'record' ? record?.[key] 
                                : undefined;

                const res = await this.validateConditionalRules({
                    actor,
                    input, 
                    record, 
                    rules:          validationsWithCriteria, 
                    inputVal:       inputVal, 
                    allConditions:  conditions as MapOfValidationCondition,
                });
                
                result.pass = result.pass && res.pass;

                if( collectErrors && res.errors?.length){
                    res.errors.forEach( err => {
                        err.messageIds = makeEntityValidationMessageIds(entityName, ruleType, key, err.messageIds ?? []);
                        err.path = err.path ?? [];``
                        err.path.push(key);
                        err.path.push(ruleType);
                        err['message'] = makeValidationErrorMessage(err, overriddenErrorMessages);

                        result.errors?.push( verboseErrors ? err : {path: err.path, message: err.message} );
                    });
                }
            }
        }

        this.logger.info("validate ~ result:", { result });

        return result;
    }

    /**
     * Tests validations rules for the given input object against the provided validation rules.
     * 
     * @param input - The input object to validate.
     * @param rules - The validation rules to test, where each key is a key on the input object.
     * @returns Whether the input passed all the validation rules.
     */
    async validateInput<I extends InputType>(
        input: I | undefined,
        rules?: InputValidationRule<I>, 
        collectErrors: boolean = true
    ): Promise<InputValidationResult<I>> {

        const result: InputValidationResult<I> = {
            pass: true,
            errors: {},
        };

        for(const key in rules){
            const thisRule = rules[key];
            if(!thisRule){ continue; }

            const validationRes = await this.testComplexValidationRule<any>(thisRule, input?.[key] );                    
            result.pass = result.pass && validationRes.pass;

            if(collectErrors && validationRes.errors && validationRes.errors.length){
                result.errors![key] = validationRes.errors?.map( err => {
                    const path = err.path ?? [];
                    if(!path.includes(key)){
                        path.push(key);
                    }
                    return {...err, path};
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
    async validateHttpRequest<
        Header extends InputType = InputType, 
        Body extends InputType = InputType,
        Param extends InputType = InputType,
        Query extends InputType = InputType,
    >(
        
        options: ValidateHttpRequestOptions<Header, Body, Param, Query>

    ): Promise<ValidatorResult> {

        const { requestContext, validations, collectErrors = true, verboseErrors=false, overriddenErrorMessages } = options;

        const res: ValidatorResult = {
            pass: true,
            errors: [],
        };

        this.logger.debug("called validateHttpRequest", {requestContext, validations});

        for(const validationType of ['body', 'param', 'query', 'header'] as const){
            const typeValidationRules = validations[validationType];  
            if(!typeValidationRules){
                continue;
            }

            let validationInput: any = {};

            if(validationType == 'body'){
                validationInput = requestContext.body;
            } else if(validationType == 'param'){
                validationInput = requestContext.pathParameters;
            } else if(validationType == 'query'){
                validationInput = requestContext.queryStringParameters;
            } else if(validationType == 'header'){
                validationInput = requestContext.headers;
            }

            const inputValidationResult = await this.validateInput<typeof validationInput>(validationInput, typeValidationRules);

            res.pass = res.pass && inputValidationResult.pass;

            if(collectErrors && !inputValidationResult.pass){

                for(const prop in inputValidationResult.errors){
                    const propErrors = inputValidationResult.errors[prop] ?? [];

                    propErrors.forEach( error => {
                        error.path = error.path ?? [];
                        error.path.push(validationType);

                        const httpValidationMessageIds = makeHttpValidationMessageIds({
                            validationType, 
                            propertyName: prop,
                            errorMessageIds: error.messageIds || []
                        });
                        error.messageIds = httpValidationMessageIds;

                        error.message = makeValidationErrorMessage(error, overriddenErrorMessages);

                        res.errors?.push( verboseErrors ? error : {path: error.path, message: error.message} );
                    });
                }
            }
        }

        this.logger.info("validateHttpRequest result: ", res );

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
    async validateConditionalRules<I extends InputType = any, R extends RecordType = any>(
        options: {
            rules: ConditionalValidationRule<any, any>[],
            allConditions: MapOfValidationCondition,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ): Promise<TestComplexValidationRuleResult>{

        this.logger.debug("validateConditionalRules ~ arguments:", JSON.stringify(options) );
        
        const {rules, allConditions, inputVal, input, record, actor} = options;

        const result: TestComplexValidationRuleResult = {
            pass: true,
            errors: [],
        };

        const results = await Promise.all( rules.map(async (rule) => {
            return this.validateConditionalRule({
                rule, 
                input, 
                actor,
                record, 
                inputVal, 
                allConditions,
            });
        }));

        for(const ruleResult of results){
            result.pass = result.pass && ruleResult.pass;
            if(ruleResult.errors){
                result.errors!.push(...ruleResult.errors);
            }
            if(ruleResult.customMessage || ruleResult.customMessageId){
                result.errors!.push({
                    customMessage: ruleResult.customMessage,
                    customMessageId: ruleResult.customMessageId,
                })
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
    async validateConditionalRule<I extends InputType =  any, R extends RecordType = any >(
        options: {
            rule: ConditionalValidationRule<any, any>,
            allConditions: MapOfValidationCondition,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ): Promise<TestComplexValidationRuleResult> {

        this.logger.debug("validateConditionalRules ~ arguments:", JSON.stringify(options) );
        
        const {rule, allConditions, inputVal, input, record, actor} = options;
        
        const { conditions: ruleConditions, ...partialValidation } = rule;
 
        const criteriaPassed = await this.testConditions({
            conditions: ruleConditions,
            allConditions,
            inputVal,
            input,
            record,
            actor,
        });

        const result: TestComplexValidationRuleResult = {
            pass: true,
        };

        this.logger.debug("validateConditionalRules ~ criteriaPassed:", criteriaPassed);

        if(criteriaPassed){
            let validation = await this.testComplexValidationRule(partialValidation, inputVal);
            this.logger.debug("validateConditionalRules ~ validation-result:", validation);

            result.pass = result.pass && validation.pass;
            result.errors = validation.errors;

            if(validation.customMessage){
                result.customMessage = validation.customMessage;
            }
            if(validation.customMessageId){
                result.customMessageId = validation.customMessageId;
            }
        }

        this.logger.debug("validateConditionalRules ~ result:", { result });

        return result;
    }

    async testConditions<I extends InputType =  any, R extends RecordType = any >(
        options: {
            conditions: ConditionalValidationRule<any, any>['conditions'],
            allConditions: MapOfValidationCondition,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ): Promise<boolean> {

        const {conditions, allConditions, inputVal, input, record, actor} = options;

        let criteriaPassed = true;
        const formattedConditions = {
            scope: 'all',
            conditionNames: [] as string[],
        };

        /**
         * Conditions ==> ['actorIs123', 'ppp', 'qqq'] | [ ['actorIs123', 'ppp', 'qqq'], 'all' ] 
         */
        if(Array.isArray(conditions)){
            if( isConditionsAndScopeTuple(conditions) ){
                const [conditionNames, scope] = conditions;
                formattedConditions.scope = scope,
                formattedConditions.conditionNames = conditionNames;
            } else {
                formattedConditions.conditionNames = conditions as string[];
            }
        }
        
        if(formattedConditions.conditionNames.length){
            
            if(formattedConditions.scope == 'any'){

                criteriaPassed = false;
        
                for(const conditionName of formattedConditions.conditionNames ){
                    const ctRule = allConditions[conditionName];

                    const applicable = await this.testCondition( ctRule, input, record, actor);
                    if(applicable){
                        // * test for applicability
                        // if any of them passes, we are good to go
                        // else continue
                        criteriaPassed = true; 
                        break;
                    }
                }

            } else {

                criteriaPassed = true; 

                for(const conditionName of formattedConditions.conditionNames ){
                    const ctRule = allConditions[conditionName];
                    
                    const applicable = await this.testCondition( ctRule, input, record, actor);
                    // * test for applicability
                    // if any of them passes the validation does not apply
                    // else continue
                    if(formattedConditions.scope == 'none' && applicable ){
                        criteriaPassed = false;
                        break;
                    } 
                    // * test for NOT-applicability
                    // if any of them fails the validation does not apply
                    // else continue;
                    else if(formattedConditions.scope == 'all' && !applicable){
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
    async testCondition<I extends InputType, R extends RecordType>(
        criteria: EntityValidationCondition<I, R>, 
        input?: I, 
        record?: R, 
        actor?: Actor
    ) {

        const{ actor:actorRules, input:inputRules, record:recordRules } = criteria;

        let applicable = true;

        if(actorRules){
            const result = await this.validateInput<Actor>(actor, actorRules, false);
            applicable = applicable &&  result.pass;
        }

        if(applicable && inputRules){
            const result = await this.validateInput<I>( input, inputRules, false);

            applicable = applicable && result.pass;
        }

        if(applicable && recordRules){
            const result = await this.validateInput<R>(record, recordRules, false);
            applicable = applicable && result.pass;
        }

        return applicable;
    }

    async testComplexValidationRule<T>(complexValidationRule: ComplexValidationRule<T>, val: T, collectErrors = true ): Promise<TestComplexValidationRuleResult>{
        let res: TestComplexValidationRuleResult = {
            pass: true,
            errors: []
        };

        const { message: customMessage, validator: customValidatorForRule, messageId: customMessageId, ...validationRule } = complexValidationRule;

        if(customValidatorForRule){
            res = await customValidatorForRule(val, collectErrors);
        } else {
            res = await this.testValidationRule(validationRule, val, collectErrors);
        }

        res.customMessage =  customMessage ?? res.customMessage;
        res.customMessageId = customMessageId ?? res.customMessageId ;

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
    async testValidationRule<T>(validationRule: ValidationRule<T>, val: T, collectErrors = true): Promise<TestValidationRuleResult> {
        this.logger.info("testValidationRule ~ arguments:", {validationRule, val});

        const res: TestValidationRuleResult = {
            pass: true,
            errors: []
        };
        
        // * validate one rule at a time
        for(const validationName in validationRule){

            let testValidationResult: TestValidationResult;
            let validationValue = validationRule[validationName as keyof ValidationRule<T>];

            if(isComplexValidationValue(validationValue)){
                testValidationResult = await this.testComplexValidation(validationName as keyof ValidationRule<T>, validationValue, val );
                this.logger.debug("testValidationRule ~ testComplexValidation result: ", {validationValue, val, testValidationResult});
            } else {
                testValidationResult = await this.testValidation(validationName as keyof ValidationRule<T>, validationValue, val);
                this.logger.debug("testValidationRule ~ testValidation result: ", {validationValue, val, testValidationResult});
            }
            
            res.pass = res.pass && testValidationResult.pass;

            if(collectErrors && !testValidationResult.pass){

                const errorMessageIds = makeValidationErrorMessageIds(validationName, validationValue);
                const validationError: ValidationError = {
                    messageIds: errorMessageIds,
                    expected: testValidationResult.expected,                           
                    received: testValidationResult.received,
                }

                if(isTestComplexValidationResult(testValidationResult)){
                    if(testValidationResult.customMessageId){
                        validationError.customMessageId = testValidationResult.customMessageId;
                    }
                    if(testValidationResult.customMessage){
                        validationError.customMessage = testValidationResult.customMessage;
                    }
                }

                res.errors!.push(validationError);
            }
        }

        this.logger.info("testValidationRule ~ results:", {res});

        return res;
    }

    async testComplexValidation<T extends unknown>( 
        validationName: keyof ValidationRule<T>, 
        validationValue: TComplexValidationValue<T>, 
        val: T 
    ): Promise<TestComplexValidationResult> {
        this.logger.info("testComplexValidation ~ partialValidation:, val: ", {validationName, validationValue, val});

        let result: TestComplexValidationResult = { pass: true};

        if( isComplexValidationValueWithValidator(validationValue) ){
            result = await validationValue.validator(val);
        } else if(isComplexValidationValueWithMessage(validationValue)) {
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
    async testValidation(
        validationName: keyof Validations<any>, 
        validationValue: TValidationValue<any>, 
        val: any 
    ): Promise<TestValidationResult>{

        this.logger.debug("testValidation ~ ", {validationName, validationValue, val} );

        const result: TestValidationResult = { 
            pass: true, 
            received: [val],
            expected: [validationName, validationValue],
        }
        
        if(validationName === 'required' ){

            result.pass = (val !== undefined && val !== null);

        } else if( validationName === 'minLength' ) {

            result.pass = val && val.length >= validationValue;
            result.received = [val, val?.length || 0];

        } else if( validationName === 'maxLength') {

            result.pass = val && val.length <= validationValue;
            result.received = [val, val?.length || 0];

        } else if( validationName === 'pattern') {

            result.pass = val && validationValue.test(val as unknown as string);

        } else if( validationName === 'eq' ){

            result.pass = val === validationValue;

        } else if(validationName === 'neq') {

            result.pass = val !== validationValue;

        } else if(validationName === 'gt') {

            result.pass = val > validationValue;
            
        } else if(validationName === 'gte') {
            
            result.pass = val >= validationValue;

        } else if(validationName === 'lt') {

            result.pass = val < validationValue;

        } else if(validationName === 'lte') {

            result.pass = val <= validationValue;

        } else if(validationName === 'inList') {

            result.pass = validationValue.includes(val);

        } else if(validationName === 'notInList') {

            result.pass = !validationValue.includes(val);

        } else if( validationName === 'unique' ) {

            result.pass = isUnique(val);

        } else if(validationName === 'custom'){

            if(typeof validationValue !== 'function'){
                this.logger.warn(new Error(`Invalid custom validation rule: ${ {[validationName]: validationValue} }`));
                result.pass = false;
            } else {
                result.pass = await validationValue(val);
            }

        } if( validationName === 'datatype' ) {

            if(validationValue === 'number'){

                result.pass = isNumericString(val);

            } else if(validationValue === 'email'){

                result.pass = isEmail(val);

            } else if(validationValue === 'ip'){

                result.pass =  isIP(val);

            } else if(validationValue === 'ipv4'){

                result.pass = isIPv4(val);

            } else if(validationValue === 'ipv6'){

                result.pass = isIPv6(val);

            } else if(validationValue === 'uuid'){

                result.pass = isUUID(val);

            } else if(validationValue === 'json'){

                result.pass = isJsonString(val);

            } else if(validationValue === 'date'){

                result.pass = isDateString(val);

            } else if(validationValue === 'httpUrl'){

                result.pass =  isHttpUrlString(val);

            } else if( typeof val !== validationValue ) {

                result.pass = false;
            }

        } 

        this.logger.debug("testValidation ~ result ", {validationName, validationValue, val, result} );

        return result;
    }
}



