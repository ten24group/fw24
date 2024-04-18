import { expect } from '@jest/globals';
/**
 * Defines validation rules and criteria that can be used to validate input, record, and actor data.
 * Provides a Validator class that validates data against defined validation rules and criteria.
 */
import { IValidator, IValidatorResponse, OpValidatorOptions, ValidationRule, ValidationRules, InputValidationResponse, TestValidationRuleResponse, InputValidationErrors, Validation_Keys, HttpRequestValidations, ValidationError, HttpRequestValidationResponse, TComplexValidationValue, TValidationValue, TestValidationResult, ComplexValidationRule, TComplexValidationValueWithMessage, TComplexValidationValueWithValidator, TestComplexValidationRuleResponse, TestComplexValidationResult, EntityOpsInputValidations } from "./validator.type";
import { DeepWritable, ValueOf } from '../utils/types';
import { Actor, EntityValidations, InputType, RecordType, TConditionalValidationRule, TEntityOpValidations, TEntityValidationCondition, TMapOfValidationConditions, Validations } from "./validator.type";
import { TDefaultEntityOperations, EntitySchema, TEntityOpsInputSchemas } from "../entity";
import { createLogger } from "../logging";

import { Request } from '../interfaces/request';

const logger = createLogger('Validator');

export function isValidationRule<T extends unknown>( rule: any): rule is ValidationRule<T> {
    const res = typeof rule === 'object' 
        && rule !== null
        && Object.keys(rule).every(key => Validation_Keys.includes(key) || 'operations' === key );

    return res;
}
export type ConditionsAndScopeTuple = [ conditions: string[], scope: string ];

export function isConditionsAndScopeTuple(conditions: any): conditions is [ conditions: string[], scope: string ] {
    return conditions
        && Array.isArray(conditions) 
        && conditions.length == 2 
        && Array.isArray(conditions[0]) 
        && ['all', 'any', 'none'].includes(conditions[1] as string) 
}

export function isInputValidationRule<Input extends InputType = InputType>( rules: any): rules is ValidationRules<Input> {
    return typeof rules === 'object' 
        && rules !== null
        && Object.keys(rules).every(key => isValidationRule(rules[key]))
}

export function isArrayOfValidationRule<Input extends InputType = InputType>( rules: any): rules is ValidationRules<Input> {
    const res = typeof rules === 'object' 
        && rules !== null
        && Array.isArray(rules) 
        && rules.every(isValidationRule)
    return res;
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
    return isComplexValidationWithMessage(val) || isComplexValidationWithValidator(val);
}

export function isTestComplexValidationResult(val: any): val is TestComplexValidationResult {
    return typeof val === 'object' 
        && val !== null 
        && (val.hasOwnProperty('customMessage') || val.hasOwnProperty('customMessageId') )
}

export function isComplexValidationWithMessage<T = unknown>(val: any): val is TComplexValidationValueWithMessage<T> {
    return typeof val === 'object' 
        && val !== null 
        && val.hasOwnProperty('value') 
        && (val.hasOwnProperty('message') || val.hasOwnProperty('messageId'))
}

export function isComplexValidationWithValidator<T = unknown>(val: any): val is TComplexValidationValueWithValidator<T> {
    return typeof val === 'object' 
        && val !== null 
        && val.hasOwnProperty('validator')
}

export function isComplexValidationRule<T = unknown>(val: any): val is ComplexValidationRule<T> {
    return typeof val === 'object' 
        && val !== null 
        && ( 
            val.hasOwnProperty('validator')
            || 
            (val.hasOwnProperty('message') || val.hasOwnProperty('messageId') ) 
        )
}

export function isEntityValidations<
  Sch extends EntitySchema<any, any, any, Ops>, 
  ConditionsMap extends TMapOfValidationConditions<any, any>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
>(
    validations: any

): validations is EntityValidations<Sch, ConditionsMap, OpsInpSch> {
    const res = typeof validations === 'object' 
        && validations !== null
        &&  Object.keys(validations).every( validationType =>
            ['conditions', 'input', 'record', 'actor'].includes(validationType)
            && ( 
                !validations[validationType] || validationType === 'conditions'
                || (
                    typeof validations[validationType] === 'object' 
                    && Object.keys(validations[validationType]).every( prop => 
                        isArrayOfValidationRule(validations[validationType][prop])
                    )
                )
            )
    );
    return res;
}

export function isEntityInputValidations<
    Sch extends EntitySchema<any, any, any>,
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>
>(
    validations: any

): validations is EntityOpsInputValidations<Sch, OpsInpSch> {
    return typeof validations === 'object' && validations !== null
        &&  Object.keys(validations).every( prop => isArrayOfValidationRule(validations[prop]))
}

export function extractOpValidationFromEntityValidations<
  Sch extends EntitySchema<any, any, any, Ops>, 
  ConditionsMap extends TMapOfValidationConditions<any, any>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
>( 
  operationName: keyof OpsInpSch, 
  entityValidations: EntityValidations<Sch, ConditionsMap, OpsInpSch> | EntityOpsInputValidations<Sch, OpsInpSch>
){

	const entityOpValidations: DeepWritable<TEntityOpValidations<any, any, ConditionsMap>> = {
		actor: {},
		input: {},
		record: {},
	}

    if(isEntityInputValidations(entityValidations)){
        entityValidations = {
            input: entityValidations as EntityValidations<Sch, ConditionsMap, OpsInpSch>['input']
        }
    } 

    if(!isEntityValidations(entityValidations)){
        throw(`Invalid entity validations ${entityValidations}`);
    }

	for(const validationGroupKey of ['actor', 'input', 'record' ] as const ){
		
        const groupValidationRules = entityValidations[validationGroupKey];
		if(!groupValidationRules){ continue; }

		for(const propertyName in groupValidationRules){

			const propertyRules = groupValidationRules[propertyName as keyof typeof groupValidationRules];
			if(!propertyRules){ continue; }

			const formattedPropertyRules = [];
			
			for(const rule of propertyRules as Array<any>){
				if(!rule){ continue;}

				let{operations, ...restOfTheValidations} = rule;

                if(!operations){
                    operations = ['*'];
                }

                if(!Array.isArray(operations)){
                    for(const opName in operations){
                        if( !operations.hasOwnProperty(opName) || opName !== operationName ){
                            continue;
                        }

                        const opConditionRules: any[] = operations[opName];

                        if(!Array.isArray(opConditionRules)){
                            throw new Error(`Invalid operations definition for ${opName} in ${operations}`);
                        }

                        opConditionRules.forEach( (rule: any) => {
                            let thisRuleValidations = {
                                ...restOfTheValidations,
                                conditions: [ rule['conditions'], rule['scope'] ?? 'all' ],
                            };
                            formattedPropertyRules.push(thisRuleValidations);
                        });
                    }

                } else if (Array.isArray(operations)){
                    for(const thisOp of operations){
                        if (Array.isArray(thisOp) && thisOp[0] === operationName ) {
                            const [thisOpName, conditions= undefined, scope = 'all'] = thisOp;
    
                            /**
                             * 
                             * ['update', ['recordIsNotNew', 'tenantIsXYZ']],
                             * ['update', [['recordIsNotNew', 'inputIsNitin'], 'any']]
                             * 
                             */
                            let thisRuleValidations: any = {
                                ...restOfTheValidations,
                                conditions: conditions ? [ conditions, scope] : undefined,
                            };
    
                            formattedPropertyRules.push(thisRuleValidations);
                        } else if( thisOp === '*' || thisOp === operationName){
                            formattedPropertyRules.push({ ...restOfTheValidations });
                        }
                    }
                }
			

				if(formattedPropertyRules.length){
					entityOpValidations[validationGroupKey]![propertyName] = formattedPropertyRules;
				} else {
					logger.debug("No applicable rules found for op: prop: group: from-rule:", [operationName, propertyName, validationGroupKey, rule]);
				}
			}
		}
	}
    
	return {
		opValidations: {...entityOpValidations} as TEntityOpValidations<any, any, ConditionsMap>, 
		conditions: entityValidations.conditions
	}
}

export const genericErrorMessages: {[k:string]: string} = {
    'validation.eq':            "Provided value '{received}' for '{key}' should be equal to '{expected}'",
    'validation.gt':            "Provided value '{received}' for '{key}' should be greater than '{expected}'",
    'validation.lt':            "Provided value '{received}' for '{key}' should be less than '{expected}'",
    'validation.gte':           "Provided value '{received}' for '{key}' should be greater than or equal to '{expected}'",
    'validation.lte':           "Provided value '{received}' for '{key}' should be less than or equal to '{expected}'",
    'validation.neq':           "Provided value '{received}' for '{key}' should not be equal to '{expected}'",
    'validation.custom':        "Provided value '{received}' for '{key}' is invalid",
    'validation.inlist':        "Provided value '{received}' for '{key}' should be one of '{expected}'",
    'validation.unique':        "Provided value '{received}' for '{key}' should be unique",
    'validation.pattern':       "Provided value '{received}' for '{key}' should match '{expected}' pattern",
    'validation.datatype':      "Provided value '{received}' for '{key}' should be '{expected}'",
    'validation.required':      "Provided value '{received}' for '{key}' is required",
    'validation.maxlength':     "Provided value '{received[0]}' for '{key}' should have maximum length of '{expected}'; instead of '{received[1]}'",
    'validation.minlength':     "Provided value '{received[0]}' for '{key}' should have minimum length of '{expected}'; instead of '{received[1]}'",
    'validation.notinlist':     "Provided value '{received}' for '{key}' should not be one of '{expected}'",
}

export function makeValidationErrorMessage(error: ValidationError){

    let messageId = error.customMessageId 
        || error.messageIds?.reverse().find( (messageId) => !!genericErrorMessages[messageId] )
        || ( error.messageIds?.length ? error.messageIds.at(-1) : undefined)

    let message = error.customMessage || messageId ? genericErrorMessages[messageId as keyof typeof messageId] : 'validation.unknown-1';

    message = message || 'validation.unknown-2';

    if(Array.isArray(error.received)){
        message = message.replace('{received[0]}', error.received[0] ?? '');
        message = message.replace('{received[1]}', error.received[1] ?? '');
    } else {
        message = message.replace('{received}', error.received ? error.received + '' : '');
    }

    message = message.replace('{key}', error.path ?? '');
    message = message.replace('{expected}', error.expected ? error.expected + '' : '');

    return message;
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
    async validateEntity<
        Sch extends EntitySchema<any, any, any>, 
        OpName extends keyof Sch['model']['entityOperations'],
        ConditionsMap extends TMapOfValidationConditions<any, any>, 
        OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
    >(
        options: OpValidatorOptions<Sch, OpName, ConditionsMap, OpsInpSch>

    ): Promise<IValidatorResponse> {
        
        const { entityValidations, entityName, operationName, input, actor, record } = options;
        
        const result: IValidatorResponse<Actor, any, any> = {
            pass: true,
            errors: {
                actor: {},
                input:{},
                record: {},
            }
        }

        if(!entityValidations){
            return result
        }

        const opsValidationRules = extractOpValidationFromEntityValidations(operationName, entityValidations);

        logger.debug("validate ~ rules, input, actor, record:", JSON.stringify({ opsValidationRules, input, actor, record}));
        
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
                    allConditions:  conditions as TMapOfValidationConditions,
                });
                
                result.pass = result.pass && res.pass;
                if(res.errors?.length){

                    res.errors.forEach( err => {
                        // TODO: prepare the actual messages here.
                        err.messageIds = this.makeEntityValidationMessageIds(entityName, ruleType, key, err.messageIds ?? []);
                        err.path = `${key}`;
                        //@ts-ignore
                        err['message'] = makeValidationErrorMessage(err);
                    });

                    result.errors![ruleType]![key] = res.errors
                }
            }
        }

        logger.info("validate ~ result:", { result });

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
        rules?: ValidationRules<I>, 
        collectErrors: boolean = true
    ): Promise<InputValidationResponse<I>> {

        const result: InputValidationResponse<I> = {
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
                    return {...err, path: key};
                });
            }
        }

        return result;
    }

    makeValidationMessageIdsForPrefix(
        key: string, 
        errorMessageIds: Array<string>,
    ): Array<string> {

        // make new keys by prepending the new key all existing ids
        const keyIds = errorMessageIds.map( id => [key.toLowerCase()].concat(id).join('.'));

        return keyIds;
    }

    makeValidationErrorMessageIds(
        validationName: string, 
        validationValue: TValidationValue<any>,
        // inputValue: any,
    ): Array<string> {

        const keys: Array<string> = [ validationName.toLowerCase() ];

        const ids: string[] = [ keys.join('.') ];

        if(isComplexValidationWithMessage(validationValue)){
            keys.push( ( validationValue.value+'' ).toLowerCase() );
        } else if(isComplexValidationWithValidator(validationValue)) {
            keys.push('validator');
        } else {
            keys.push( (validationValue+'').toLowerCase() );
        }
        ids.push( keys.join('.') );

        // keys.push( (inputValue+'').toLowerCase() );
        // ids.push( keys.join('.') );

        // add the custom id to the very last
        if(validationValue.messageId){
            ids.push(validationValue.messageId);
        }

        return ids;
    }

    makeHttpValidationMessageIds(
        validationType: 'body' | 'param' | 'query' | 'header',
        propertyName: string,
        errorMessageIds: Array<string>,
    ): Array<string> {

        const propIds = this.makeValidationMessageIdsForPrefix( `http.${validationType}.${propertyName}`, errorMessageIds);
        // prefix everything with 'validation.'
        return errorMessageIds.concat(propIds).map( id => `validation.${id}`);
    }

    makeEntityValidationMessageIds(
        entityName: string,
        validationType: 'input' | 'actor' | 'record', 
        propertyName: string,
        errorMessageIds: Array<string>,
    ): Array<string> {

        // error messages with property names prefixes
        const propIds = this.makeValidationMessageIdsForPrefix(propertyName, errorMessageIds);
        // error messages with validation type and property names prefixes
        const validationTypeIds = this.makeValidationMessageIdsForPrefix(validationType, propIds);

        // error messages with entity.[entityName].[property/[inputType.property]] prefixes
        const entityValidationIds = this.makeValidationMessageIdsForPrefix(`entity.${entityName}`, errorMessageIds.concat(propIds.concat(validationTypeIds)));
        
        // all messages with validation prefixes
        return errorMessageIds.concat(entityValidationIds).map( id => `validation.${id}`);
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

            const validationResult = await this.validateInput<typeof validationInput>(validationInput, typeValidationRules);

            res.pass = res.pass && validationResult.pass;

            if(collectErrors){
                for(const prop in validationResult.errors){
                    const propErrors = validationResult.errors[prop] ?? [];

                    propErrors.forEach( error => {
                        error.path ? error.path = `${validationType}.${error.path}` : undefined;
                        const httpValidationMessageIds = this.makeHttpValidationMessageIds(validationType, prop, error.messageIds || []);
                        error.messageIds = httpValidationMessageIds;

                        //@ts-ignore
                        error['message'] = makeValidationErrorMessage(error);
                        // TODO: prepare the actual messages here.
                        return error;
                    });

                    if(validationResult.customMessage || validationResult.customMessageId){
                        propErrors.push({
                            customMessageId: validationResult.customMessageId,
                            customMessage: validationResult.customMessage,
                            path: `${validationType}.${prop}`,
                        });
                    }
                }
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
    ): Promise<TestComplexValidationRuleResponse>{

        logger.debug("validateConditionalRules ~ arguments:", JSON.stringify(options) );
        
        const {rules, allConditions, inputVal, input, record, actor} = options;

        const result: TestComplexValidationRuleResponse = {
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
            rule: TConditionalValidationRule<any, any>,
            allConditions: TMapOfValidationConditions,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ): Promise<TestComplexValidationRuleResponse> {

        logger.debug("validateConditionalRules ~ arguments:", JSON.stringify(options) );
        
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

        const result: TestComplexValidationRuleResponse = {
            pass: true,
        };

        logger.debug("validateConditionalRules ~ criteriaPassed:", criteriaPassed);

        if(criteriaPassed){
            let validation = await this.testComplexValidationRule(partialValidation, inputVal);
            logger.debug("validateConditionalRules ~ validation-result:", validation);

            result.pass = result.pass && validation.pass;
            result.errors = validation.errors;

            if(validation.customMessage){
                result.customMessage = validation.customMessage;
            }
            if(validation.customMessageId){
                result.customMessageId = validation.customMessageId;
            }
        }

        logger.debug("validateConditionalRules ~ result:", { result });

        return result;
    }

    async testConditions<I extends InputType =  any, R extends RecordType = any >(
        options: {
            conditions: TConditionalValidationRule<any, any>['conditions'],
            allConditions: TMapOfValidationConditions,
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
        criteria: TEntityValidationCondition<I, R>, 
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

    async testComplexValidationRule<T>(complexValidationRule: ComplexValidationRule<T>, val: T, collectErrors = true ): Promise<TestComplexValidationRuleResponse>{
        let res: TestComplexValidationRuleResponse = {
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
    async testValidationRule<T>(validationRule: ValidationRule<T>, val: T, collectErrors = true): Promise<TestValidationRuleResponse> {
        logger.info("testValidationRule ~ arguments:", {validationRule, val});

        const res: TestValidationRuleResponse = {
            pass: true,
            errors: []
        };
        
        // * validate one rule at a time
        for(const validationName in validationRule){

            let testValidationResult: TestValidationResult;
            let validationValue = validationRule[validationName as keyof ValidationRule<T>];

            if(isComplexValidation(validationValue)){
                testValidationResult = await this.testComplexValidation(validationName as keyof ValidationRule<T>, validationValue, val );
                logger.debug("testValidationRule ~ testComplexValidation result: ", {validationValue, val, testValidationResult});
            } else {
                testValidationResult = await this.testValidation(validationName as keyof ValidationRule<T>, validationValue, val);
                logger.debug("testValidationRule ~ testValidation result: ", {validationValue, val, testValidationResult});
            }
            
            res.pass = res.pass && testValidationResult.pass;

            if(!res.pass && collectErrors){

                const errorMessageIds = this.makeValidationErrorMessageIds(validationName, validationValue);
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

        logger.info("testValidationRule ~ results:", {res});

        return res;
    }

    async testComplexValidation<T extends unknown>( 
        validationName: keyof ValidationRule<T>, 
        validationValue: TComplexValidationValue<T>, 
        val: T 
    ): Promise<TestComplexValidationResult> {
        logger.info("testComplexValidation ~ partialValidation:, val: ", {validationName, validationValue, val});

        let result: TestComplexValidationResult = { pass: true};

        if( isComplexValidationWithValidator(validationValue) ){
            result = await validationValue.validator(val);
        } else if(isComplexValidationWithMessage(validationValue)) {
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

        logger.debug("testValidation ~ ", {validationName, validationValue, val} );

        const result: TestValidationResult = { 
            pass: true, 
            received: val,
            expected: validationValue,
        }
        
        if(validationName === 'required' ){

            result.pass = (val !== undefined && val !== null);

        } else if( validationName === 'minLength' ) {

            result.pass = val && val.length >= validationValue;
            result.received = [val, val.length];

        } else if( validationName === 'maxLength') {

            result.pass = val && val.length <= validationValue;
            result.received = [val, val.length];

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

            result.pass = this.isUnique(val);

        } else if(validationName === 'custom'){

            if(typeof validationValue !== 'function'){
                logger.warn(new Error(`Invalid custom validation rule: ${ {[validationName]: validationValue} }`));
                result.pass = false;
            } else {
                result.pass = await validationValue(val);
            }

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

        } 

        logger.debug("testValidation ~ result ", {validationName, validationValue, val, result} );

        return result;
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
}



