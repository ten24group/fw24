import { EntitySchema, TDefaultEntityOperations, TEntityOpsInputSchemas } from '../entity';
import { createLogger } from '../logging';
import { DeepWritable } from '../utils';
import {
  ComplexValidationRule,
  ConditionsAndScopeTuple,
  EntityOperationValidation,
  EntityInputValidations,
  EntityValidations,
  HttpRequestValidations,
  InputType,
  InputValidationRule,
  MapOfValidationCondition,
  TComplexValidationValue as ComplexValidationValue,
  TComplexValidationValueWithMessage as ComplexValidationValueWithMessage,
  TComplexValidationValueWithValidator as ComplexValidationValueWithValidator,
  TValidationValue,
  TestComplexValidationResult,
  ValidationError,
  ValidationRule,
  Validation_Keys,
} from './types';

import genericErrorMessages from './messages';

const logger = createLogger('ValidatorUtils');

export function isValidationRule<T>(rule: any): rule is ValidationRule<T> {
  const res =
    typeof rule === 'object' &&
    rule !== null &&
    Object.keys(rule).every(key => Validation_Keys.includes(key as any) || 'operations' === key);

  return res;
}

export function isArrayOfValidationRule<T>(rules: any): rules is Array<ValidationRule<T>> {
  const res = typeof rules === 'object' && rules !== null && Array.isArray(rules) && rules.every(isValidationRule);
  return res;
}

export function isConditionsAndScopeTuple(conditions: any): conditions is ConditionsAndScopeTuple {
  return (
    conditions &&
    Array.isArray(conditions) &&
    conditions.length == 2 &&
    Array.isArray(conditions[0]) &&
    ['all', 'any', 'none'].includes(conditions[1] as string)
  );
}

export function isInputValidationRule<Input extends InputType = InputType>(
  rules: any,
): rules is InputValidationRule<Input> {
  return typeof rules === 'object' && rules !== null && Object.keys(rules).every(key => isValidationRule(rules[key]));
}

export function isHttpRequestValidationRule(rule: any): rule is HttpRequestValidations {
  return (
    typeof rule === 'object' &&
    rule !== null &&
    ((Object.prototype.hasOwnProperty.call(rule, 'body') && isInputValidationRule(rule.body)) ||
      (Object.prototype.hasOwnProperty.call(rule, 'query') && isInputValidationRule(rule.query)) ||
      (Object.prototype.hasOwnProperty.call(rule, 'param') && isInputValidationRule(rule.param)) ||
      (Object.prototype.hasOwnProperty.call(rule, 'header') && isInputValidationRule(rule.header)))
  );
}

export function isTestComplexValidationResult(val: any): val is TestComplexValidationResult {
  return (
    typeof val === 'object' &&
    val !== null &&
    (Object.prototype.hasOwnProperty.call(val, 'customMessage') ||
      Object.prototype.hasOwnProperty.call(val, 'customMessageId'))
  );
}

export function isComplexValidationValue<T = unknown>(val: any): val is ComplexValidationValue<T> {
  return isComplexValidationValueWithMessage(val) || isComplexValidationValueWithValidator(val);
}

export function isComplexValidationValueWithMessage<T = unknown>(
  val: any,
): val is ComplexValidationValueWithMessage<T> {
  return (
    typeof val === 'object' &&
    val !== null &&
    Object.prototype.hasOwnProperty.call(val, 'value') &&
    (Object.prototype.hasOwnProperty.call(val, 'message') || Object.prototype.hasOwnProperty.call(val, 'messageId'))
  );
}

export function isComplexValidationValueWithValidator<T = unknown>(
  val: any,
): val is ComplexValidationValueWithValidator<T> {
  return typeof val === 'object' && val !== null && Object.prototype.hasOwnProperty.call(val, 'validator');
}

export function isComplexValidationRule<T = unknown>(val: any): val is ComplexValidationRule<T> {
  return (
    typeof val === 'object' &&
    val !== null &&
    (Object.prototype.hasOwnProperty.call(val, 'validator') ||
      Object.prototype.hasOwnProperty.call(val, 'message') ||
      Object.prototype.hasOwnProperty.call(val, 'messageId'))
  );
}

export function isEntityValidations<
  Sch extends EntitySchema<any, any, any, Ops>,
  ConditionsMap extends MapOfValidationCondition<any, any>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
>(validations: any): validations is EntityValidations<Sch, ConditionsMap, OpsInpSch> {
  const res =
    typeof validations === 'object' &&
    validations !== null &&
    Object.keys(validations).every(
      validationType =>
        ['conditions', 'input', 'record', 'actor'].includes(validationType) &&
        (!validations[validationType] ||
          validationType === 'conditions' ||
          (typeof validations[validationType] === 'object' &&
            Object.keys(validations[validationType]).every(prop =>
              isArrayOfValidationRule(validations[validationType][prop]),
            ))),
    );
  return res;
}

export function isEntityOpsInputValidations<
  Sch extends EntitySchema<any, any, any>,
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
>(validations: any): validations is EntityInputValidations<Sch, OpsInpSch> {
  return (
    typeof validations === 'object' &&
    validations !== null &&
    Object.keys(validations).every(prop => isArrayOfValidationRule(validations[prop]))
  );
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
export function extractOpValidationFromEntityValidations<
  Sch extends EntitySchema<any, any, any, Ops>,
  ConditionsMap extends MapOfValidationCondition<any, any>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
>(
  operationName: keyof OpsInpSch,
  entityValidations: EntityValidations<Sch, ConditionsMap, OpsInpSch> | EntityInputValidations<Sch, OpsInpSch>,
) {
  const entityOpValidations: DeepWritable<EntityOperationValidation<any, any, ConditionsMap>> = {
    actor: {},
    input: {},
    record: {},
  };

  if (isEntityOpsInputValidations(entityValidations)) {
    entityValidations = {
      input: entityValidations as EntityValidations<Sch, ConditionsMap, OpsInpSch>['input'],
    };
  }

  if (!isEntityValidations(entityValidations)) {
    throw `Invalid entity validations ${entityValidations}`;
  }

  for (const validationGroupKey of ['actor', 'input', 'record'] as const) {
    const groupValidationRules = entityValidations[validationGroupKey];
    if (!groupValidationRules) {
      continue;
    }

    for (const propertyName in groupValidationRules) {
      const propertyRules = groupValidationRules[propertyName as keyof typeof groupValidationRules];
      if (!propertyRules) {
        continue;
      }

      const formattedPropertyRules = [];

      for (const rule of propertyRules as Array<any>) {
        if (!rule) {
          continue;
        }

        let { operations, ...restOfTheValidations } = rule;

        if (!operations) {
          operations = ['*'];
        }

        if (!Array.isArray(operations)) {
          for (const opName in operations) {
            if (!Object.prototype.hasOwnProperty.call(operations, opName) || opName !== operationName) {
              continue;
            }

            const opConditionRules: any[] = operations[opName];

            if (!Array.isArray(opConditionRules)) {
              throw new Error(`Invalid operations definition for ${opName} in ${operations}`);
            }

            opConditionRules.forEach((rule: any) => {
              const thisRuleValidations = {
                ...restOfTheValidations,
                conditions: [rule['conditions'], rule['scope'] ?? 'all'],
              };
              formattedPropertyRules.push(thisRuleValidations);
            });
          }
        } else if (Array.isArray(operations)) {
          for (const thisOp of operations) {
            if (Array.isArray(thisOp) && thisOp[0] === operationName) {
              const [thisOpName, conditions = undefined, scope = 'all'] = thisOp;

              /**
               *
               * ['update', ['recordIsNotNew', 'tenantIsXYZ']],
               * ['update', [['recordIsNotNew', 'inputIsNitin'], 'any']]
               *
               */
              const thisRuleValidations: any = {
                ...restOfTheValidations,
                conditions: conditions ? [conditions, scope] : undefined,
              };

              formattedPropertyRules.push(thisRuleValidations);
            } else if (thisOp === '*' || thisOp === operationName) {
              formattedPropertyRules.push({ ...restOfTheValidations });
            }
          }
        }

        if (formattedPropertyRules.length) {
          entityOpValidations[validationGroupKey]![propertyName] = formattedPropertyRules;
        } else {
          logger.debug('No applicable rules found for op: prop: group: from-rule:', [
            operationName,
            propertyName,
            validationGroupKey,
            rule,
          ]);
        }
      }
    }
  }

  return {
    opValidations: { ...entityOpValidations } as EntityOperationValidation<any, any, ConditionsMap>,
    conditions: entityValidations.conditions,
  };
}

/**
 * Generates a validation error message based on the provided error object and optional overridden error messages.
 * @param error - The validation error object.
 * @param overriddenErrorMessages - Optional map of overridden error messages.
 * @returns The generated validation error message.
 */
export function makeValidationErrorMessage(error: ValidationError, overriddenErrorMessages?: Map<string, string>) {
  if (error.customMessage) {
    return error.customMessage;
  }

  // customMessageId, or the first key
  const messageId =
    error.customMessageId ||
    error.messageIds
      ?.reverse()
      .find(messageId => overriddenErrorMessages?.has(messageId) || genericErrorMessages.has(messageId)) ||
    (error.messageIds?.length ? error.messageIds.at(-1) : undefined);

  let message =
    "Validation failed for '{key}'; expected '{validationName}/{validationValue}', received '{received}/{refinedReceived}'.";

  if (messageId && (overriddenErrorMessages?.has(messageId) || genericErrorMessages.has(messageId))) {
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

/**
 * Creates validation message IDs for a given prefix.
 * @param key - The prefix key.
 * @param errorMessageIds - An array of existing error message IDs.
 * @returns An array of new error message IDs with the prefix key.
 */
export function makeValidationMessageIdsForPrefix(key: string, errorMessageIds: Array<string>): Array<string> {
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
export function makeValidationErrorMessageIds(
  validationName: string,
  validationValue: TValidationValue<any>,
  // inputValue: any,
): Array<string> {
  const keys: Array<string> = [validationName.toLowerCase()];

  const ids: string[] = [keys.join('.')];

  if (isComplexValidationValueWithMessage(validationValue)) {
    keys.push((validationValue.value + '').toLowerCase());
  } else if (isComplexValidationValueWithValidator(validationValue)) {
    keys.push('validator');
  } else {
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
export function makeHttpValidationMessageIds(options: {
  validationType: 'body' | 'param' | 'query' | 'header';
  errorMessageIds: Array<string>;
  propertyName?: string;
}): Array<string> {
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
  const entityValidationIds = makeValidationMessageIdsForPrefix(
    `entity.${entityName}`,
    errorMessageIds.concat(propIds.concat(validationTypeIds)),
  );

  // all messages with validation prefixes
  return errorMessageIds.concat(entityValidationIds).map(id => `validation.${id}`);
}
