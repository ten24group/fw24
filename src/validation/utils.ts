import { EntitySchema, TDefaultEntityOperations, TEntityOpsInputSchemas } from "../entity";
import { createLogger } from "../logging";
import { DeepWritable } from "../utils";
import { ComplexValidationRule, ConditionsAndScopeTuple, EntityOperationValidation, EntityInputValidations, EntityValidations, HttpRequestValidations, InputType, InputValidationRule, MapOfValidationCondition, TComplexValidationValue as ComplexValidationValue, TComplexValidationValueWithMessage as ComplexValidationValueWithMessage, TComplexValidationValueWithValidator as ComplexValidationValueWithValidator, TValidationValue, TestComplexValidationResult, ValidationError, ValidationRule, Validation_Keys } from "./types";

import genericErrorMessages from './messages';

const logger = createLogger('ValidatorUtils');

export function isValidationRule<T extends unknown>( rule: any): rule is ValidationRule<T> {
    const res = typeof rule === 'object' 
        && rule !== null
        && Object.keys(rule).every(key => Validation_Keys.includes(key) || 'operations' === key );

    return res;
}

export function isArrayOfValidationRule<T>( rules: any): rules is Array<ValidationRule<T>> {
    const res = typeof rules === 'object' 
        && rules !== null
        && Array.isArray(rules) 
        && rules.every(isValidationRule)
    return res;
}

export function isConditionsAndScopeTuple(conditions: any): conditions is ConditionsAndScopeTuple {
    return conditions
        && Array.isArray(conditions) 
        && conditions.length == 2 
        && Array.isArray(conditions[0]) 
        && ['all', 'any', 'none'].includes(conditions[1] as string) 
}

export function isInputValidationRule<Input extends InputType = InputType>( rules: any): rules is InputValidationRule<Input> {
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

export function isTestComplexValidationResult(val: any): val is TestComplexValidationResult {
    return typeof val === 'object' 
        && val !== null 
        && (val.hasOwnProperty('customMessage') || val.hasOwnProperty('customMessageId') )
}

export function isComplexValidationValue<T = unknown>(val: any): val is ComplexValidationValue<T> {
    return isComplexValidationValueWithMessage(val) || isComplexValidationValueWithValidator(val);
}

export function isComplexValidationValueWithMessage<T = unknown>(val: any): val is ComplexValidationValueWithMessage<T> {
    return typeof val === 'object' 
        && val !== null 
        && val.hasOwnProperty('value') 
        && (val.hasOwnProperty('message') || val.hasOwnProperty('messageId'))
}

export function isComplexValidationValueWithValidator<T = unknown>(val: any): val is ComplexValidationValueWithValidator<T> {
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
  ConditionsMap extends MapOfValidationCondition<any, any>,
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

export function isEntityOpsInputValidations<
    Sch extends EntitySchema<any, any, any>,
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>
>(
    validations: any

): validations is EntityInputValidations<Sch, OpsInpSch> {
    return typeof validations === 'object' && validations !== null
        &&  Object.keys(validations).every( prop => isArrayOfValidationRule(validations[prop]))
}

export function extractOpValidationFromEntityValidations<
  Sch extends EntitySchema<any, any, any, Ops>, 
  ConditionsMap extends MapOfValidationCondition<any, any>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
>( 
  operationName: keyof OpsInpSch, 
  entityValidations: EntityValidations<Sch, ConditionsMap, OpsInpSch> | EntityInputValidations<Sch, OpsInpSch>
){

	const entityOpValidations: DeepWritable<EntityOperationValidation<any, any, ConditionsMap>> = {
		actor: {},
		input: {},
		record: {},
	}

    if(isEntityOpsInputValidations(entityValidations)){
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
		opValidations: {...entityOpValidations} as EntityOperationValidation<any, any, ConditionsMap>, 
		conditions: entityValidations.conditions
	}
}

export function makeValidationErrorMessage(error: ValidationError, overriddenErrorMessages ?: Map<string, string>){

    if(error.customMessage){
        return error.customMessage;
    }
    
    // customMessageId, or the first key 
    let messageId = error.customMessageId 
        || error.messageIds?.reverse().find( (messageId) => overriddenErrorMessages?.has(messageId) || genericErrorMessages.has(messageId) )
        || ( error.messageIds?.length ? error.messageIds.at(-1) : undefined)

    let message = "Validation failed for '{key}'; expected '{validationName}/{validationValue}', received '{received}/{refinedReceived}'.";

    if(messageId && ( overriddenErrorMessages?.has(messageId) || genericErrorMessages.has(messageId)) ){
        message = overriddenErrorMessages?.get(messageId) ?? genericErrorMessages.get(messageId)!;
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

export function makeValidationMessageIdsForPrefix(
    key: string, 
    errorMessageIds: Array<string>,
): Array<string> {
    // make new keys by prepending the new key all existing ids
    const keyIds = errorMessageIds.map(id => `${key.toLowerCase()}.${id}`);
    return keyIds;
}

export function makeValidationErrorMessageIds(
    validationName: string, 
    validationValue: TValidationValue<any>,
    // inputValue: any,
): Array<string> {

    const keys: Array<string> = [ validationName.toLowerCase() ];

    const ids: string[] = [ keys.join('.') ];

    if(isComplexValidationValueWithMessage(validationValue)){
        keys.push( ( validationValue.value+'' ).toLowerCase() );
    } else if(isComplexValidationValueWithValidator(validationValue)) {
        keys.push('validator');
    } else {
        keys.push( (validationValue+'').toLowerCase() );
    }
    ids.push( keys.join('.') );

    // add the custom id to the very last
    if(validationValue.messageId){
        ids.push(validationValue.messageId);
    }

    return ids;
}

export function makeHttpValidationMessageIds(
    options: {
        validationType: 'body' | 'param' | 'query' | 'header',
        errorMessageIds: Array<string>,
        propertyName ?: string,
    }
): Array<string> {

    const { validationType, propertyName, errorMessageIds } = options;

    const keys = ['http', validationType];
    if(propertyName){
        keys.push(propertyName.toLowerCase());
    }

    const propIds = makeValidationMessageIdsForPrefix( keys.join('.'), errorMessageIds);
    
    // prefix everything with 'validation.'
    return errorMessageIds.concat(propIds).map( id => `validation.${id}`);
}

export function makeEntityValidationMessageIds(
    entityName: string,
    validationType: 'input' | 'actor' | 'record', 
    propertyName: string,
    errorMessageIds: Array<string>,
): Array<string> {

    // error messages with property names prefixes
    const propIds = makeValidationMessageIdsForPrefix(propertyName, errorMessageIds);
    // error messages with validation type and property names prefixes
    const validationTypeIds = makeValidationMessageIdsForPrefix(validationType, propIds);

    // error messages with entity.[entityName].[property/[inputType.property]] prefixes
    const entityValidationIds = makeValidationMessageIdsForPrefix(`entity.${entityName}`, errorMessageIds.concat(propIds.concat(validationTypeIds)));
    
    // all messages with validation prefixes
    return errorMessageIds.concat(entityValidationIds).map( id => `validation.${id}`);
}