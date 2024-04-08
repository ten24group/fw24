/**
 * Defines validation rules and criteria that can be used to validate input, record, and actor data.
 * Provides a Validator class that validates data against defined validation rules and criteria.
 */
import { Schema } from "electrodb";
import { IValidator, IValidatorResponse, ValidatorOptions } from "./validator.type";
import { DeepWritable } from '../utils/types';
import { Actor, EntityValidations, InputType, RecordType, TConditionalValidationRule, TEntityOpValidations, TEntityValidationCondition, TMapOfValidationConditions, Validations } from "./validator.type";
import { TDefaultEntityOperations, EntitySchema, TEntityOpsInputSchemas } from "../entity";

if (!('toJSON' in Error.prototype)){
    Object.defineProperty(Error.prototype, 'toJSON', {
        value: function () {
            var alt: any = {};
    
            Object.getOwnPropertyNames(this).forEach(function (key) {
                //@ts-ignore
                alt[key] = this[key];
            }, this);
    
            return alt;
        },
        configurable: true,
        writable: true
    });
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
					console.log("No applicable rules found for op: prop: group: from-rule:", [operationName, propertyName, validationGroupKey, rule]);
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
        OpName extends keyof OpsInpSch,
        Sch extends EntitySchema<any, any, any, Ops>, 
        ConditionsMap extends TMapOfValidationConditions<any, any>, 
        Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
        OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
    >(
        options: ValidatorOptions<OpName, Sch, ConditionsMap, OpsInpSch>
    ): Promise<IValidatorResponse> {
        
        const { entityValidations, operationName, input, actor, record } = options;

        if(!entityValidations){
            return {
                pass: true,
                errors: []
            }
        }

        const opsValidationRules = extractOpValidationFromEntityValidations(operationName, entityValidations);
        console.log("🚀 ~ Validator.validate ~ rules, input, actor, record:", JSON.stringify({ opsValidationRules, input, actor, record}));
        
        const { opValidations: {inputRules, actorRules, recordRules}, conditions } = opsValidationRules;
        
        let pass = true;
        const errors: Array<Error> = [];
        
        if(actorRules){
            for(const key in actorRules){

                const validationsWithCriteria = actorRules[key];
                if(!validationsWithCriteria){ continue; }

                const res = await this.validateRulesWithCriteria({
                    actor,
                    input, 
                    record, 
                    rules:          validationsWithCriteria, 
                    inputVal:       actor?.[key], 
                    allConditions:  conditions as TMapOfValidationConditions,
                });
                
                pass = pass && res.pass;
                if(res.errors?.length){
                    // errors.push(new Error(`Validation failed for actor.${key}`, { cause: res.errors+''}));
                    errors.push(new Error(`Validation failed for actor.${key} ::: ${ JSON.stringify({cause: res.errors}) }`));
                }
            }
        }

        if(inputRules){
            for(const key in inputRules){

                const validationsWithCriteria = inputRules[key];
                if(!validationsWithCriteria){ continue; }

                const res = await this.validateRulesWithCriteria({
                    actor,
                    input, 
                    record, 
                    rules:          validationsWithCriteria, 
                    inputVal:       input?.[key], 
                    allConditions:  conditions as TMapOfValidationConditions,
                });

                pass = pass && res.pass;
                if(res.errors?.length){
                    errors.push(new Error(`Validation failed for input.${key} ::: ${ JSON.stringify({ cause: res.errors}) }` ));
                }
            }
        }

        if(recordRules){
            
            for(const key in recordRules){
                const validationsWithCriteria = recordRules[key];
                if(!validationsWithCriteria){ continue; }

                const res = await this.validateRulesWithCriteria({
                    actor,
                    input, 
                    record, 
                    rules:          validationsWithCriteria, 
                    inputVal:       record?.[key], 
                    allConditions:  conditions as TMapOfValidationConditions,
                });

                pass = pass && res.pass;
                if(res.errors?.length){
                    errors.push(new Error(`Validation failed for record.${key} ::: ${ JSON.stringify({ cause: res.errors}) }`));
                }
            }
        }

        console.log("🚀 ~ Validator.validate ~ result:", JSON.stringify({ pass, errors}));

        const formattedErrors:string[] = [];

        for(const err of errors){
            formattedErrors.push(`${err.name}:  ${err.message}`);
        }

        return Promise.resolve({
            pass,
            errors: formattedErrors,
        });
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
    async validateRulesWithCriteria<I extends InputType = any, R extends RecordType = any>(
        options: {
            rules: TConditionalValidationRule<any, any>[],
            allConditions: TMapOfValidationConditions,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ){

        console.log( "🚀 ~ Validator: validateRulesWithCriteria ~ arguments:", JSON.stringify(options) );
        
        const {rules, allConditions, inputVal, input, record, actor} = options;

        let validationPassed = true;
        const errors: any = [];

        await Promise.all( rules.map(async (rule) => {
            return this.validateRuleWithCriteria({
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
    async validateRuleWithCriteria<I extends InputType =  any, R extends RecordType = any >(
        options: {
            rule: TConditionalValidationRule<any, any>,
            allConditions: TMapOfValidationConditions,
            inputVal?: any,
            input?: I, 
            record?: R, 
            actor?: Actor
        }
    ): Promise<IValidatorResponse> {

        console.log( "🚀 ~ Validator: validateRuleWithCriteria ~ arguments:", JSON.stringify(options) );
        
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

                    const applicable =  this.testIsCriteriaApplicable( ctRule, input, record, actor);
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
                    
                    const applicable =  this.testIsCriteriaApplicable( ctRule, input, record, actor);
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
        const errors = [];


        console.log("🚀 ~ Validator: validateRuleWithCriteria ~ criteriaPassed:", criteriaPassed);
        if(criteriaPassed){
            let validation = this.testAllValidationsWithErrors(partialValidation, inputVal);
            console.log("🚀 ~ Validator: validateRuleWithCriteria ~ validation-result:", validation);

            validationPassed = validationPassed && validation.pass;
            errors.push(...validation.errors);  
        }

        console.log("🚀 ~ Validator: validateRuleWithCriteria ~ result:", { validationPassed, errors});

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
    testIsCriteriaApplicable<I extends InputType, R extends RecordType>(criteria: TEntityValidationCondition<I, R>, input?: I, record?: R, actor?: Actor) {

        const{ actorRules, inputRules, recordRules } = criteria;

        let applicable = true;

        if(actorRules){
            applicable = applicable && this.testAllValidations<Actor>(actor, actorRules);
        }

        if(applicable && inputRules){
            applicable = applicable && this.testAllValidations<I>( input, inputRules);
        }

        if(applicable && recordRules){
            applicable = applicable && this.testAllValidations<R>(record, recordRules);
        }

        return applicable;
    }

    /**
     * Tests all validations for the given input object against the provided validation rules.
     * 
     * @param input - The input object to validate.
     * @param rules - The validation rules to test, where each key is a key on the input object.
     * @returns Whether the input passed all the validation rules.
     */
    testAllValidations<I extends InputType>(
        input: I | undefined,
        rules?: { [K in  keyof I] ?: Validations<I[K]> }, 
    ) {
        let pass = true;
        
        if(!rules) {
            return pass;
        }

        for(const key in rules){
            const validations = rules[key];
            if(validations){
                const result = this.testValidation(validations!, input?.[key] );
                pass = typeof result == 'boolean' ? result : false;
            }
        }

        return pass;
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
    testAllValidationsWithErrors(partialValidation: Validations, val: any) {
        console.log("🚀 ~ Validator ~ testAllValidationsWithErrors ~ arguments:", {partialValidation, val});
        let pass = true;
        const errors: Array<any> = [];
        
        if(partialValidation) {
            // * validate one rule ar a time
            for(const key in partialValidation){
                //@ts-ignore
                const validationRule = { [key]: partialValidation[key] } as Validations;
                
                const result = this.testValidation(validationRule, val );

                console.log("🚀 ~ Validator ~ testAllValidationsWithErrors ~ testValidation result: ", {validationRule, result});
                
                if(typeof result == 'boolean'){
                    pass = pass && result;
                    if(!result){
                        errors.push( new Error(`Validation '${key}' failed`) );
                    }
                } else {
                    pass = false;
                    errors.push(result);
                }
            }
        }

        console.log("🚀 ~ Validator ~ testAllValidationsWithErrors ~ results:", {pass, errors});

        return {
            pass,
            errors,
        };

    }

    isNumeric(num: any){
        return !isNaN(num)
    }

    /**
     * Validates a value against a set of validation rules.
     * 
     * @param partialValidation - The validation rules to check, e.g. {required: true, minLength: 5}.
     * @param val - The value to validate.
     * @returns True if the value passes all validations, false otherwise. Can also return validation error objects.
    */
    testValidation(partialValidation: Validations, val: any){
        console.log("🚀 ~ Validator ~ testValidation ~ partialValidation:, val: ", partialValidation, val);
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
                const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
                return pattern.test(val);
            }

            // TODO: | 'ipv4' | 'ipv6' | 'uri' | 'url' | 'uuid' | 'json' | 'date' | 'date-time'

            return typeof val === datatype;
        }
        if(unique && val && val.length > 1) {
            return true; // TODO: 
        }
        if(eq && val && val !== eq) {
            return false;
        }
        if(neq && val && val === neq) {
            return false;
        }
        if(gt && val && val <= gt) {
            return false;
        }
        if(gte && val && val < gte) {
            return false;
        }
        if(lt && val && val >= lt) {
            return false;
        }
        if(lte && val && val > lte) {
            return false;
        }

        return true;
    }   
}



