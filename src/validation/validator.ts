/**
 * Defines validation rules and criteria that can be used to validate input, record, and actor data.
 * Provides a Validator class that validates data against defined validation rules and criteria.
 */
import { IValidator, IValidatorResponse, OpValidatorOptions, ValidationRule, ValidationRules, InputValidationResponse, TestValidationRuleResponse, InputValidationErrors, validations, HttpRequestValidations, ValidationError, HttpRequestValidationResponse } from "./validator.type";
import { DeepWritable } from '../utils/types';
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
    validateInput<I extends InputType>(
        input: I | undefined,
        rules?: ValidationRules<I>, 
        collectErrors: boolean = true
    ): InputValidationResponse<I> {

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

                const validationRes = this.testValidationRule(thisRule, input?.[key] );                    
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
    validateHttpRequest<
        Header extends InputType = InputType, 
        Body extends InputType = InputType,
        Param extends InputType = InputType,
        Query extends InputType = InputType,
    >(
        request: Request, 
        validations: HttpRequestValidations<Header, Body, Param, Query>,
        collectErrors: boolean = true

    ): HttpRequestValidationResponse<Header, Body, Param, Query> {

        const res: HttpRequestValidationResponse<Header, Body, Param, Query> = {
            pass: true,
            errors: {},
        };

        logger.warn("called validateHttpRequest", {request, validations});

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

            const validationResult = this.validateInput(validationInput, typeValidationRules);
        
            logger.warn("validateHttpRequest validationResult: ", { res, validationResult});

            for(const prop in validationResult.errors){
                validationResult.errors[prop]?.forEach( error => error.path ? error.path = `${validationType}.${error.path}` : undefined );
            }

            res.pass = res.pass && validationResult.pass;

            if(collectErrors){
                res.errors![validationType] = validationResult.errors
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

                    const applicable =  this.testCondition( ctRule, input, record, actor);
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
                    
                    const applicable =  this.testCondition( ctRule, input, record, actor);
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
            let validation = this.testValidationRule(partialValidation, inputVal);
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
    testCondition<I extends InputType, R extends RecordType>(
        criteria: TEntityValidationCondition<I, R>, 
        input?: I, 
        record?: R, 
        actor?: Actor
    ) {

        const{ actorRules, inputRules, recordRules } = criteria;

        let applicable = true;

        if(actorRules){
            const result = this.validateInput<Actor>(actor, actorRules, false);
            applicable = applicable &&  result.pass;
        }

        if(applicable && inputRules){
            const result = this.validateInput<I>( input, inputRules, false);

            applicable = applicable && result.pass;
        }

        if(applicable && recordRules){
            const result = this.validateInput<R>(record, recordRules, false);
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
    testValidationRule<T extends unknown>(validationRule: ValidationRule<T>, val: T, collectErrors = true): TestValidationRuleResponse {
        logger.info("testValidationRule ~ arguments:", {validationRule, val});
        let pass = true;
        const errors: Array<ValidationError> = [];
        
        if(validationRule) {

            // * validate one rule at a time
            for(const key in validationRule){

                const thisValidation = { 
                    [key]: validationRule[key as keyof Validations<T>] 
                };
                
                const result = this.testValidation(thisValidation, val );

                logger.info("testValidationRule ~ testValidation result: ", {thisValidation, result});
                
                pass = pass && result;

                if(!result && collectErrors){
                    errors.push( {
                        message: `Validation '${key}' failed`,
                        expected: thisValidation[key],                           
                        provided: val ?? '-undefined',
                    });
                }
            }
        }

        logger.info("testValidationRule ~ results:", {pass, errors});

        return {
            pass,
            errors,
        };
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
        return require('net').isIP(val)
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

    /**
     * Validates a value against a set of validation rules.
     * 
     * @param partialValidation - The validation rules to check, e.g. {required: true, minLength: 5}.
     * @param val - The value to validate.
     * @returns True if the value passes all validations, false otherwise. Can also return validation error objects.
    */
    testValidation(partialValidation: Validations, val: any){
        logger.info("testValidation ~ partialValidation:, val: ", partialValidation, val);
        const{ required, minLength, maxLength, pattern, datatype, unique, eq, neq, gt, gte, lt, lte } = partialValidation;

        if(required && val === undefined) {
            return false;
        }
        if(minLength && val && val.length < minLength) {
            return false;
        }
        if(maxLength && val && val.length > maxLength) {
            return false;
        }
        if(pattern && val && !pattern.test(val as unknown as string)) {
            return false;
        }
        if(datatype) {

            if(datatype == 'number'){
                return this.isNumeric(val);
            }

            if(datatype == 'email'){
                return this.isEmail(val);
            }

            if(datatype == 'ip'){
                return this.isIP(val);
            }

            if(datatype == 'ipv4'){
                return this.isIPv4(val);
            }

            if(datatype == 'ipv6'){
                return this.isIPv6(val);
            } 

            if(datatype == 'uuid'){
                return this.isUUID(val);
            } 

            if(datatype == 'json'){
                return this.isJson(val);
            } 

            if(datatype == 'date'){
                return this.isDate(val);
            }

            if(datatype == 'httpUrl'){
                return this.isHttpUrl(val);
            }

            // TODO: 'uri' | 'date-time'

            return typeof val === datatype;
        }

        if(unique && val && val.length > 1) {
            return this.isUnique(val);
        }
        if(eq && val !== eq) {
            return false;
        }
        if(neq && val === neq) {
            return false;
        }
        if(gt && val <= gt) {
            return false;
        }
        if(gte && val < gte) {
            return false;
        }
        if(lt && val >= lt) {
            return false;
        }
        if(lte && val > lte) {
            return false;
        }

        return true;
    }   
}



