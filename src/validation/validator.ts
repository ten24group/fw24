import { expect } from '@jest/globals';
/**
 * Defines validation rules and criteria that can be used to validate input, record, and actor data.
 * Provides a Validator class that validates data against defined validation rules and criteria.
 */
import { IValidator, IValidatorResponse, OpValidatorOptions, ValidationRule, ValidationRules, InputValidationResponse, TestValidationRuleResponse, InputValidationErrors, validations, HttpRequestValidations, ValidationError, HttpRequestValidationResponse, TComplexValidationValue, TValidationValue, TestValidationResult } from "./validator.type";
import { DeepWritable, ValueOf } from '../utils/types';
import { Actor, EntityValidations, InputType, RecordType, TConditionalValidationRule, TEntityOpValidations, TEntityValidationCondition, TMapOfValidationConditions, Validations } from "./validator.type";
import { TDefaultEntityOperations, EntitySchema, TEntityOpsInputSchemas } from "../entity";
import { createLogger } from "../logging";

import { Request } from '../interfaces/request';


const logger = createLogger('Validator');

export function isValidationRule<T extends unknown>( rule: any): rule is ValidationRule<T> {
    return typeof rule === 'object' 
        && rule !== null
        && validations.some(key => rule.hasOwnProperty(key))
}

export function isInputValidationRule<Input extends InputType = InputType>( rules: any): rules is ValidationRules<Input> {
    return typeof rules === 'object' 
        && rules !== null
        && Object.keys(rules).every(key => isValidationRule(rules[key]))
}

export function isHttpRequestValidationRule( rule: any): rule is HttpRequestValidations {
    return typeof rule === 'object' 
        && rule !== null
        && (
            (rule.hasOwnProperty('body') && isInputValidationRule(rule.body))
            || 
            (rule.hasOwnProperty('query') && isInputValidationRule(rule.query))
            || 
            (rule.hasOwnProperty('param') && isInputValidationRule(rule.param))
            || 
            (rule.hasOwnProperty('header') && isInputValidationRule(rule.header))
        )
}

export function isComplexValidation<T = unknown>(val: any): val is TComplexValidationValue<T> {
    return typeof val === 'object' && val !== null 
        && (
            val.hasOwnProperty('value') 
            &&
            (val.hasOwnProperty('message') || val.hasOwnProperty('validator'))
        )
}


export function extractOpValidationFromEntityValidations<
  Sch extends EntitySchema<any, any, any, Ops>, 
  ConditionsMap extends TMapOfValidationConditions<any, any>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
>( 
  operationName: keyof OpsInpSch, 
  entityValidations: EntityValidations<Sch, ConditionsMap, OpsInpSch>
){

	const validations: DeepWritable<TEntityOpValidations<any, any, ConditionsMap>> = {
		actorRules: {},
		inputRules: {},
		recordRules: {},
	}

	for(const validationGroupKey of ['actorRules', 'inputRules', 'recordRules' ] as const ){
		
        const groupValidationRules = entityValidations[validationGroupKey];
		if(!groupValidationRules){ continue; }

		for(const propertyName in groupValidationRules){

			const propertyRules = groupValidationRules[propertyName as keyof typeof groupValidationRules];
			if(!propertyRules){ continue; }
			
			const formattedPropertyRules = [];
			
			for(const rule of propertyRules as Array<any>){
				if(!rule){ continue;}

				const{operations, ...restOfTheValidations} = rule;
			
				for(const thisOp of operations ?? ['*']){
					if (Array.isArray(thisOp) && thisOp[0] === operationName ) {
                        const [thisOpName, conditions] = thisOp;

						/**
						 * 
						 * ['update', ['recordIsNotNew', 'tenantIsXYZ']],
						 * ['update', [['recordIsNotNew', 'inputIsNitin'], 'any']]
						 * 
						 */
						let thisRuleValidations: any = {
							...restOfTheValidations,
                            conditions,
						};

						formattedPropertyRules.push(thisRuleValidations);
					} else if( thisOp === '*' || thisOp === operationName){
						formattedPropertyRules.push({ ...restOfTheValidations });
					}
				}

				if(formattedPropertyRules.length){
					validations[validationGroupKey]![propertyName] = formattedPropertyRules;
				} else {
					logger.debug("No applicable rules found for op: prop: group: from-rule:", [operationName, propertyName, validationGroupKey, rule]);
				}
			}
		}
	}
    
	return {
		opValidations: {...validations} as TEntityOpValidations<any, any, ConditionsMap>, 
		conditions: entityValidations.conditions
	}
}

/**
 * Validates input data against a set of validation rules. 
 * Supports validating against different criteria via the CriteriaSet.
 * Handles validating at multiple levels (actor, input, record).
 * Returns whether validation passed and any errors.
*/
export class Validator implements IValidator {
    /**
     * Validates input data against a set of validation rules with criteria.
     * Handles validating at multiple levels (actor, input, record) based on the options passed in.
     * Returns whether validation passed and any errors.
    */
    async validate<
        Sch extends EntitySchema<any, any, any>, 
        OpName extends keyof Sch['model']['entityOperations'],
        ConditionsMap extends TMapOfValidationConditions<any, any>, 
        OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
    >(
        options: OpValidatorOptions<Sch, OpName, ConditionsMap, OpsInpSch>

    ): Promise<IValidatorResponse> {
        
        const { entityValidations, operationName, input, actor, record } = options;


        if(!entityValidations){
            return {
                pass: true,
                errors: {}
            }
        }

        const opsValidationRules = extractOpValidationFromEntityValidations(operationName, entityValidations);
        logger.debug("validate ~ rules, input, actor, record:", JSON.stringify({ opsValidationRules, input, actor, record}));
        
        const { opValidations: {inputRules, actorRules, recordRules}, conditions } = opsValidationRules;
        
        let pass = true;
        const actorErrors: InputValidationErrors<Actor> = {};
        const inputErrors: InputValidationErrors<any> = {};
        const recordErrors: InputValidationErrors<any> = {};
        
        if(actorRules){
            for(const key in actorRules){

                const validationsWithCriteria = actorRules[key];
                if(!validationsWithCriteria){ continue; }

                const res = await this.validateConditionalRules({
                    actor,
                    input, 
                    record, 
                    rules:          validationsWithCriteria, 
                    inputVal:       actor?.[key], 
                    allConditions:  conditions as TMapOfValidationConditions,
                });
                
                pass = pass && res.pass;
                if(res.errors?.length){
                    actorErrors[key] = res.errors
                }
            }
        }

        if(inputRules){
            for(const key in inputRules){

                const validationsWithCriteria = inputRules[key];
                if(!validationsWithCriteria){ continue; }

                const res = await this.validateConditionalRules({
                    actor,
                    input, 
                    record, 
                    rules:          validationsWithCriteria, 
                    inputVal:       input?.[key], 
                    allConditions:  conditions as TMapOfValidationConditions,
                });

                pass = pass && res.pass;

                if(res.errors?.length){
                    inputErrors[key] = res.errors
                }
            }
        }

        if(recordRules){
            
            for(const key in recordRules){
                const validationsWithCriteria = recordRules[key];
                if(!validationsWithCriteria){ continue; }

                const res = await this.validateConditionalRules({
                    actor,
                    input, 
                    record, 
                    rules:          validationsWithCriteria, 
                    inputVal:       record?.[key], 
                    allConditions:  conditions as TMapOfValidationConditions,
                });

                pass = pass && res.pass;
                if(res.errors?.length){
                    recordErrors[key] = res.errors
                }
            }
        }

        logger.debug("validate ~ result:", JSON.stringify({ pass, actorErrors, inputErrors, recordErrors}));

        return Promise.resolve({
            pass,
            errors: {
                actor: actorErrors, 
                input: inputErrors, 
                record: recordErrors
            },
        });
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
        rules?: ValidationRules<I>, 
        collectErrors: boolean = true
    ): Promise<InputValidationResponse<I>> {

        const res: InputValidationResponse<I> = {
            pass: true,
            errors: {},
        };
        
        if(rules) {
            for(const key in rules){
                const thisRule = rules[key];
                if(!thisRule){
                    continue;
                }

                const validationRes = await this.testValidationRule<any>(thisRule, input?.[key] );                    
                res.pass = res.pass && validationRes.pass

                if(collectErrors && validationRes.errors && validationRes.errors.length){
                    res.errors![key] = validationRes.errors?.map( err => ({...err, path: key}) );
                }
            }
        }

        return res;
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
        request: Request, 
        validations: HttpRequestValidations<Header, Body, Param, Query>,
        collectErrors: boolean = true

    ): Promise<HttpRequestValidationResponse<Header, Body, Param, Query>> {

        const res: HttpRequestValidationResponse<Header, Body, Param, Query> = {
            pass: true,
            errors: {},
        };

        logger.debug("called validateHttpRequest", {request, validations});

        for(const validationType of ['body', 'param', 'query', 'header'] as const){
            const typeValidationRules = validations[validationType];  
            if(!typeValidationRules){
                continue;
            }

            let validationInput: any = {};
            if(validationType == 'body'){
                validationInput = request.body;
            } else if(validationType == 'param'){
                validationInput = request.pathParameters;
            } else if(validationType == 'query'){
                validationInput = request.queryStringParameters;
            } else if(validationType == 'header'){
                validationInput = request.headers;
            }

            const validationResult = await this.validateInput(validationInput, typeValidationRules);
        
            for(const prop in validationResult.errors){
                validationResult.errors[prop]?.forEach( error => error.path ? error.path = `${validationType}.${error.path}` : undefined );
            }

            res.pass = res.pass && validationResult.pass;

            if(collectErrors){
                res.errors![validationType] = validationResult.errors
            }
        }

        logger.info("validateHttpRequest validationResult: ", res );

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
            rules: TConditionalValidationRule<any, any>[],
            allConditions: TMapOfValidationConditions,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ): Promise<TestValidationRuleResponse>{

        logger.debug("validateConditionalRules ~ arguments:", JSON.stringify(options) );
        
        const {rules, allConditions, inputVal, input, record, actor} = options;

        let validationPassed = true;
        let errors: Array<ValidationError> = [];

        await Promise.all( rules.map(async (rule) => {
            return this.validateConditionalRule({
                rule, 
                input, 
                actor,
                record, 
                inputVal, 
                allConditions,
            });
        })).then( results => {
            for(const res of results){
                validationPassed = validationPassed && res.pass;
                if(res.errors){
                    errors.push(...res.errors);
                }
            }
        });

        return { 
            pass: validationPassed,
            errors,
        };
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
            rule: TConditionalValidationRule<any, any>,
            allConditions: TMapOfValidationConditions,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ): Promise<TestValidationRuleResponse> {

        logger.debug("validateConditionalRules ~ arguments:", JSON.stringify(options) );
        
        const {rule, allConditions, inputVal, input, record, actor} = options;
        
        const { conditions: ruleConditions, ...partialValidation } = rule;
        /**
         * 
         * Conditions ==> ['actorIs123', 'ppp', 'qqq'] | [ ['actorIs123', 'ppp', 'qqq'], 'all' ]
         * 
         * 
         */

        // const conditionsOrConditionsTuple: string[] = conditions as string[];
        
        let formattedConditions: {applicable: string, conditionNames: string[]} = {
            applicable: 'all',
            conditionNames: [],
        };

        if(Array.isArray(ruleConditions)){
            if(ruleConditions.length == 2){
                const [conditions, applicability] = ruleConditions;
                formattedConditions.applicable = applicability as string,
                formattedConditions.conditionNames = conditions as string[];
            } else {
                formattedConditions.conditionNames = ruleConditions as string[];
            }
        }

        // record and actor are only required to test the criteria, and probably should be handled in  a separate function
        let criteriaPassed = true;
        
        if(formattedConditions.conditionNames.length){
            
            if(formattedConditions.applicable == 'any'){

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
                    if(formattedConditions.applicable == 'none' && applicable ){
                        
                        // * test for applicability
                        // if any of them passes the validation does not apply
                        // else continue
                        criteriaPassed = false;
                        break;

                    } else if(formattedConditions.applicable == 'all' && !applicable){
                        
                        // * test for NOT-applicability
                        // if any of them fails the validation does not apply
                        // else continue;
                        criteriaPassed = false;
                        break;

                    }
                }
            }

        }

        let validationPassed = true;
        let errors: Array<ValidationError> | undefined;

        logger.debug("validateConditionalRules ~ criteriaPassed:", criteriaPassed);

        if(criteriaPassed){
            let validation = await this.testValidationRule(partialValidation, inputVal);
            logger.debug("validateConditionalRules ~ validation-result:", validation);

            validationPassed = validationPassed && validation.pass;
            errors = validation.errors
        }

        logger.debug("validateConditionalRules ~ result:", { validationPassed, errors});

        return Promise.resolve({ 
            pass: validationPassed,
            errors,
        });
    }

    /**
     * Tests if the given criteria is applicable for the provided input, record 
     * and actor. Evaluates the actorRules, inputRules and recordRules in the
     * criteria to determine if it is applicable.
     */
    async testCondition<I extends InputType, R extends RecordType>(
        criteria: TEntityValidationCondition<I, R>, 
        input?: I, 
        record?: R, 
        actor?: Actor
    ) {

        const{ actorRules, inputRules, recordRules } = criteria;

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
    async testValidationRule<T>(validationRule: ValidationRule<T>, val: T, collectErrors = true): Promise<TestValidationRuleResponse> {
        logger.info("testValidationRule ~ arguments:", {validationRule, val});

        const res: TestValidationRuleResponse = {
            pass: true,
            errors: []
        };
        
        // * validate one rule at a time
        for(const key in validationRule){

            let result: TestValidationResult;
            let validationValue = validationRule[key as keyof ValidationRule<T>];

            if(isComplexValidation(validationValue)){
                result = await this.testComplexValidation(key as keyof ValidationRule<T>, validationValue, val );
                logger.debug("testValidationRule ~ testComplexValidation result: ", {validationValue, val, result});
            } else {
                result = await this.testValidation(key as keyof ValidationRule<T>, validationValue, val);
                logger.debug("testValidationRule ~ testValidation result: ", {validationValue, val, result});
            }
            
            res.pass = res.pass && result.pass;

            if(!res.pass && collectErrors){
                res.errors!.push({
                    message: result.message || `Validation failed for rule ${key}`, // TODO: generic message provider
                    expected: result.expected,                           
                    received: result.received,
                });
            }
        }

        logger.info("testValidationRule ~ results:", {res});

        return res;
    }

    isNumeric(num: any){
        return !isNaN(num)
    }

    isEmail(val: string){
        const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return pattern.test(val);
    }

    isUnique(val: any): boolean {
        throw(new Error(`isUnique not implemented yet: ${val}`));
    }

    isIP(val: any){
        return !!require('net').isIP(val)
    }

    isIPv4(val: any){
        return require('net').isIPv4(val)
    }

    isIPv6(val: any){
        return require('net').isIPv6(val)
    }

    isUUID(val: string){
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
    }

    isJson(val: string) {
        try {
            JSON.parse(val);
        } catch (e) {
            return false;
        }
        return true;
    }

    isDate(val: string) {
        return !isNaN(new Date(val).getDate());
    }

    isHttpUrl(val: string) {
        let url;
        try {
            url = new URL(val);
        } catch (_) {
            return false;  
        }

        return url?.protocol === "http:" || url?.protocol === "https:";
    }

    async testComplexValidation<T extends unknown>( 
        validationName: keyof ValidationRule<T>, 
        validationValue: TComplexValidationValue<T>, 
        val: T 
    ): Promise<TestValidationResult> {

        logger.info("testComplexValidation ~ partialValidation:, val: ", {validationName, validationValue, val});

        let result: TestValidationResult;

        if(validationValue.validator){

            result = await validationValue.validator(val);

        } else {

            result = await this.testValidation(validationName, validationValue.value, val);
            result.message = validationValue.message;
        }

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

        logger.debug("testValidation ~ ", {validationName, validationValue, val} );

        const result: TestValidationResult = { 
            pass: true, 
            received: val,
            expected: { [validationName]: validationValue},
        }
        
        if(validationName === 'required' && (val === undefined || val === null) ){
            result.pass = false;
            result.received = val;
        } else if( validationName === 'minLength' && val && val.length < validationValue ) {
            result.pass = false;
            result.received = val.length;
        } else if( validationName === 'maxLength' && val && val.length > validationValue) {
            result.pass = false;
            result.received = val.length;
        } else if( validationName === 'pattern' && val && !validationValue.test(val as unknown as string)) {
            result.pass = false;
            result.received = val;
        } else if( validationName === 'eq' && val !== validationValue ){
            result.pass = false;
        } else if(validationName === 'neq' && val === validationValue) {
            result.pass = false;
        } else if(validationName === 'gt' && val <= validationValue) {
            result.pass = false;
        } else if(validationName === 'gte' && val < validationValue) {
            result.pass = false;
        } else if(validationName === 'lt' && val >= validationValue) {
            result.pass = false;
        } else if(validationName === 'lte' && val > validationValue) {
            result.pass = false;
        } else if(validationName === 'inList' && !validationValue.includes(val)) {
            result.pass = false;
        } else if(validationName === 'notInList' && validationValue.includes(val)) {
            result.pass = false;
        } else if( validationName === 'unique' ) {
            result.pass = this.isUnique(val);
        } else if(validationName === 'custom'){
            if(typeof validationValue !== 'function'){
                logger.warn(new Error(`Invalid custom validation rule: ${ {[validationName]: validationValue} }`));
                result.pass = false;
            }
            result.pass = await validationValue(val);
        } if( validationName === 'datatype' ) {

            if(validationValue === 'number'){
                result.pass = this.isNumeric(val);
            } else if(validationValue === 'email'){
                result.pass = this.isEmail(val);
            } else if(validationValue === 'ip'){
                result.pass =  this.isIP(val);
            } else if(validationValue === 'ipv4'){
                result.pass = this.isIPv4(val);
            } else if(validationValue === 'ipv6'){
                result.pass = this.isIPv6(val);
            } else if(validationValue === 'uuid'){
                result.pass = this.isUUID(val);
            } else if(validationValue === 'json'){
                result.pass = this.isJson(val);
            } else if(validationValue === 'date'){
                result.pass = this.isDate(val);
            } else if(validationValue === 'httpUrl'){
                result.pass =  this.isHttpUrl(val);
            } else if( typeof val !== validationValue ) {
                result.pass = false;
            }

            // TODO: 'uri' | 'date-time'
        } 

        logger.debug("testValidation ~ result ", {validationName, validationValue, val, result} );

        return result;
    }
}



