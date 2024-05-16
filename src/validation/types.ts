import { EntityRecordTypeFromSchema, EntitySchema, TEntityOpsInputSchemas as EntityOperationsInputSchemas } from "../entity";
import { Narrow, OmitNever, ValueOf } from '../utils/types';

import { Request } from '../interfaces/request';

export type CustomMessageOrMessageId = {
    customMessage?: string,
    customMessageId?: string,
}

export type ValidationExpectedAndReceived = {
    expected ?: [validationName: string, validationValue: any],
    received ?: [received: any, refinedReceived?: any],
}

export type TestValidationResult = {
    pass: boolean
} & ValidationExpectedAndReceived;

export type TestComplexValidationResult = TestValidationResult & CustomMessageOrMessageId;


export type ValidationError = {
    message ?: string,
    messageIds ?: Array<string>,
    path ?: Array<string>,
} & CustomMessageOrMessageId & ValidationExpectedAndReceived;

export type TestValidationRuleResult = {
    pass: boolean, 
    errors ?: Array<ValidationError>
};

export type TestComplexValidationRuleResult = TestValidationRuleResult & CustomMessageOrMessageId;

export type InputValidationErrors<I extends InputType = InputType> = {
    [K in keyof I] ?: Array<ValidationError>
};

export type InputValidationResult<I extends InputType = InputType> = {
    pass: boolean, 
    errors ?: InputValidationErrors<I>
};

export interface ValidatorResult {
    pass: boolean;
    errors ?: Array<ValidationError>,
}

export type OpValidatorOptions<
    Sch extends EntitySchema<any, any, any>, 
    OpName extends keyof Sch['model']['entityOperations'],
    ConditionsMap extends MapOfValidationCondition<any, any>, 
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = {
    readonly operationName: OpName,
    readonly entityName: Sch['model']['entity'],
    readonly entityValidations?: EntityValidations<Sch, ConditionsMap, OpsInpSch> | EntityInputValidations<Sch, OpsInpSch>,
    readonly input?: InputType,
    readonly actor?: Actor,
    readonly record?: RecordType, 
    readonly collectErrors ?: boolean,
    readonly verboseErrors ?: boolean,
    readonly overriddenErrorMessages ?: Map<string, string>
}


export type ValidateHttpRequestOptions<
    Header extends InputType = InputType, 
    Body extends InputType = InputType,
    Param extends InputType = InputType,
    Query extends InputType = InputType,
> = {
    readonly validations: HttpRequestValidations<Header, Body, Param, Query>, 
    readonly requestContext: Request, 
    readonly collectErrors ?: boolean,
    readonly verboseErrors ?: boolean,
    readonly overriddenErrorMessages ?: Map<string, string>,
}
export interface IValidator {
    validateEntity<
        Sch extends EntitySchema<any, any, any>, 
        OpName extends keyof Sch['model']['entityOperations'],
        ConditionsMap extends MapOfValidationCondition<any, any>, 
        OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
    >(options: OpValidatorOptions< Sch, OpName, ConditionsMap, OpsInpSch> ): Promise<ValidatorResult>;

    validateInput<I extends InputType>(
        input: I | undefined,
        rules?: InputValidationRule<I>, 
        collectErrors?: boolean,
    ): Promise<InputValidationResult<I>>;

    validateHttpRequest<
        Header extends InputType = InputType, 
        Body extends InputType = InputType,
        Param extends InputType = InputType,
        Query extends InputType = InputType,
    >(
        options: ValidateHttpRequestOptions<Header, Body, Param, Query>
    ): Promise<ValidatorResult>
}


/**
 * Actor interface defines the shape of an actor object.
 * An actor represents a user or entity performing an action in the system.
*/
export type Actor = {
	// 'role': string,
	// 'userId': string,
	// 'tenantId': string,
    [key: string]: any,
}

export type InputType = {
    readonly [key: string]: any,
}

export type RecordType = {
    readonly [key: string]: any,
}

// export type TValidationValue<T = unknown > = T;
/**
 * Represents a validation value that can be either of type T or a complex validation value.
 * @template T - The type of the validation value.
 */
export type TValidationValue<T > = T | TComplexValidationValue<T>;

/**
 * Represents a complex validation value with an optional message or message ID.
 * @template T - The type of the value being validated.
 */
export type TComplexValidationValueWithMessage<T> = {
    value: T,
    message?: string,
    messageId?: string, // Optional error-message-id, that is supposed to be used by error message translators
}
/**
 * Represents a complex validation value with a validator function.
 * @template T The type of the input value to be validated.
 */
export type TComplexValidationValueWithValidator<T> = {
    /**
     * The validator function that performs the validation on the input value.
     * @param inputValue The input value to be validated.
     * @param ctx An optional context object that can be used during validation.
     * @returns A promise that resolves to a TestValidationResult.
     */
    validator: (inputValue: T, ctx?: any) => Promise<TestValidationResult>,
    /**
     * An optional error message ID that is supposed to be used by error message translators.
     */
    messageId?: string,
    /**
     * An optional error message that provides additional information about the validation failure.
     */
    message?: string,
}

/**
 * Represents a complex validation value that can either have a custom error message or a custom validator function.
 * @template T - The type of the value being validated.
 */
export type TComplexValidationValue<T> = TComplexValidationValueWithMessage<T> | TComplexValidationValueWithValidator<T>

export type Validations<T> = {
	readonly 'minLength' ?: number,
    readonly 'maxLength' ?: number,
    readonly 'required' ?: boolean,
    readonly 'pattern' ?: RegExp,
    readonly 'datatype' ?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'email' | 'ip' | 'ipv4' | 'ipv6' | 'httpUrl' | 'uuid' | 'json' | 'date',
    readonly 'unique' ?: boolean,
    readonly 'eq' ?: T,
    readonly 'neq' ?: T,
    readonly 'gt' ?: T,
    readonly 'gte' ?: T,
    readonly 'lt' ?: T,
    readonly 'lte' ?: T,
    readonly 'inList' ?: Array<T>,
    readonly 'notInList' ?: Array<T>,
    readonly 'custom' ?: (inputValue: T, ctx?: any) => boolean | Promise<boolean>,
}

export const Validation_Keys: Array<keyof Validations<any>> = [
    'minLength', 'maxLength', 'required', 'pattern', 'datatype', 'unique', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'inList', 'notInList', 'custom'
];

/**
 * Represents a validation rule for a specific type.
 * @template T - The type to be validated.
 */
export type ValidationRule<T> = {
    // TODO: narrow validation rules by type like ['string', 'number', 'boolean' etc]
    readonly [V in keyof Validations<T>] ?: TValidationValue<Validations<T>[V]>;
}

/**
 * Represents a complex validation rule.
 * @template T The type of value being validated.
 */
export type ComplexValidationRule<T> = ValidationRule<T> & {
    /**
     * The custom error message for the validation rule.
     */
    readonly message?: string,
    /**
     * The custom error message ID for the validation rule.
     */
    readonly messageId?: string,
    /**
     * The custom validator function for the validation rule.
     * @param value The value to be validated.
     * @param collectErrors A flag indicating whether to collect all errors or stop at the first error.
     * @returns A promise that resolves to the result of the complex validation rule.
     */
    readonly validator?: (value: T, collectErrors?: boolean) => Promise<TestComplexValidationRuleResult>,
}

/**
 * Represents a validation rule for an object/schema.
 * @template Input - The input type for which the validation rule is defined.
 */
export type InputValidationRule<Input extends InputType = InputType> = {
    [K in keyof Input] ?: ValidationRule<Input[K]> | ComplexValidationRule<Input[K]>;
}

export type ConditionsAndScopeTuple = [ conditions: string[], scope: string ];

/**
 * Represents the validation rules for an HTTP request.
 * @template Header - The type of the request header.
 * @template Body - The type of the request body.
 * @template Param - The type of the request parameters.
 * @template Query - The type of the request query parameters.
 */
export type HttpRequestValidations< 
    Header extends InputType = InputType, 
    Body extends InputType = InputType,
    Param extends InputType = InputType,
    Query extends InputType = InputType,
> = {
    readonly body ?: InputValidationRule<Body>,
    readonly query ?: InputValidationRule<Query>,
    readonly param ?: InputValidationRule<Param>,
    readonly header ?: InputValidationRule<Header>,
}


/**
 * Represents a validation condition for an entity.
 * @template I The input type.
 * @template R The record type.
 */
export type EntityValidationCondition<I extends InputType, R extends RecordType> = {
    /**
     * The validation rule for the actor.
     */
    readonly actor?: InputValidationRule<Actor>,
    /**
     * The validation rule for the input.
     */
    readonly input?: InputValidationRule<I>,
    /**
     * The validation rule for the record.
     */
    readonly record?: InputValidationRule<R>,
}

export type MapOfValidationCondition<I extends InputType = InputType, R extends RecordType = RecordType> = Record<string, EntityValidationCondition<I, R>>;

/**
 * 
 * Similar to `TValidationRuleForOperations` except 
 * - the available rules for property are limited to if that key is present in the input-schema
 * - and the available conditions are limited to the conditions applicable to the input-schema
 *  i.e to the conditions that do not utilize any additional keys for input-validations, except whatever keys are available in the input-schema.
 * 
 */
export type EntityOperationValidationRuleForInput<
    Input, 
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends MapOfValidationCondition<any, any>,
    OpsKeys extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = {
    readonly operations ?: Narrow<
    Array< OpsKeys | ValueOf<{ readonly [OppName in OpsKeys]: OperationConditionsTuple<Sch, ConditionsMap, OppName, OpsInpSch> }>>
    |
    {
        readonly [OppName in OpsKeys] ?: [{
            conditions: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
            scope ?: 'all' | 'any' | 'none' /* default: [all] all conditions must be satisfied */
        }]
    }>,

} & ValidationRule<Input>;

/**
 * Represents a tuple that defines the conditional applicability of the validation-rule to the operation.
 * i.e. it validation-rule only applies when the condition is satisfied.
 *
 * @template Sch - The entity schema type.
 * @template ConditionsMap - The map of validation conditions.
 * @template OppName - The name of the operation.
 * @template OpsInpSch - The input schemas for entity operations.
 */
export type OperationConditionsTuple<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends MapOfValidationCondition<any, any>,
    OppName extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = [ 
    op: OppName, 
    /** 
     * An array of condition names.
     * Example: ['xxx', 'yyyy']
     */
    conditions ?: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
    /**
     * The scope of the conditions.
     * Possible values: 'all', 'any', 'none'
     * Default: 'all' (all conditions must be satisfied)
     */
    scope ?: 'all' | 'any' | 'none',
]

/**
 * Represents the conditional applicability of the validation-rule to the specific operation.
 *
 * @template Sch - The entity schema type.
 * @template ConditionsMap - The map of validation conditions.
 * @template OppName - The name of the entity operation.
 * @template OpsInpSch - The input schemas for entity operations.
 */
export type OperationConditions<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends MapOfValidationCondition<any, any>,
    OppName extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = {
    /**
     * Array of condition names that must be satisfied for the validation-rule to be applicable for operation.
     * By default, all conditions must be satisfied.
     */
    conditions: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
    
    /**
     * The scope of the conditions.
     * - 'all': All conditions must be satisfied.
     * - 'any': At least one condition must be satisfied.
     * - 'none': No conditions should be satisfied.
     */
    scope: 'all' | 'any' | 'none'
}


export type InputApplicableCondition<Inp extends InputType, C extends EntityValidationCondition<any, any>> = {
  
  readonly actor: C['actor'] extends undefined ? void : C['actor'],
  readonly record: C['record'] extends undefined ? void : C['record'],
  
  readonly input: C['input'] extends undefined 
    ? void 
    : keyof C['input'] extends keyof Inp
      ? C['input']
      : void,
};

export type InputApplicableConditionsMap<Inp extends InputType, ConditionsMap extends MapOfValidationCondition<any, any> > = OmitNever<{
  readonly [ConditionName in keyof ConditionsMap]: InputApplicableCondition<Inp, ConditionsMap[ConditionName]> extends ConditionsMap[ConditionName]
    ? ConditionsMap[ConditionName]
    : never;
}>

/**
 * Represents a conditional validation rule.
 * @template T - The type of the value being validated.
 * @template ConditionsMap - A map of validation conditions.
 */
export type ConditionalValidationRule<T, ConditionsMap extends MapOfValidationCondition<InputType, RecordType>> = {
    /**
     * The conditions that must be satisfied for the validation rule to apply.
     * @remarks
     * - If not specified, all conditions must be satisfied.
     * - If specified as an array, all conditions in the array must be satisfied.
     * - If specified as a tuple, the first element is an array of conditions and the second element is a string specifying how the conditions must be satisfied ('all', 'any', or 'none').
     */
    readonly conditions ?: 
        Array<keyof ConditionsMap>
        | 
        [ Array<keyof ConditionsMap>, 'all' | 'any' | 'none'],
} & ComplexValidationRule<T>;

/**
 * Represents the validation rules for an entity-operation.
 * @template I - The input type.
 * @template R - The record type.
 * @template C - The map of validation conditions.
 */
export type EntityOperationValidation<I extends InputType, R extends RecordType, C extends MapOfValidationCondition<I, R> > = {
    readonly actor ?: {
        [K in keyof Actor]?: ConditionalValidationRule<Actor[K], C>[];
    },
    readonly input ?: {
        [K in keyof I] ?: ConditionalValidationRule<I[K], C>[];
    },
    readonly record ?: {
        [K in keyof R] ?: ConditionalValidationRule<R[K], C>[];
    },
}

/**
 * Represents the validation for entity all operations.
 *
 * @template Sch - The entity schema type.
 * @template ConditionsMap - The map of validation conditions.
 * @template OpsInpSch - The entity operations input schemas type.
 */
export type EntityOperationsValidation<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends MapOfValidationCondition<any, any>,
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = Narrow<{
    /**
     * Represents the validation for each entity operation.
     */
    readonly [oppName in keyof OpsInpSch] ?: EntityOperationValidation<
        Narrow<OpsInpSch[oppName]>, // operation input schema
        EntityRecordTypeFromSchema<Sch>, // entity record type
        // filter out the conditions that require any additional prop which isn't provided in the input
        OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[oppName]>, ConditionsMap>>
    >
} & {
    /**
     * Represents the validation conditions for the entity.
     */
    readonly conditions?: MapOfValidationCondition<any, EntityRecordTypeFromSchema<Sch>>
}>

export type EntityValidations< 
    Sch extends EntitySchema<any, any, any, any>, 
    ConditionsMap extends MapOfValidationCondition<any, any> = any, 
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = Narrow<{
    readonly actor ?: {
        [ActorKey in keyof Actor] ?: Narrow<
            EntityOperationValidationRuleForInput<
                Actor[ActorKey], 
                Sch, 
                ConditionsMap, 
                keyof OpsInpSch
            >
        >[];
    },
    readonly record ?: {
        [RecordKey in keyof EntityRecordTypeFromSchema<Sch>] ?: Narrow<
            EntityOperationValidationRuleForInput<
                EntityRecordTypeFromSchema<Sch>[RecordKey], 
                Sch, 
                ConditionsMap, 
                keyof OpsInpSch
            >
        >[];
    },
    readonly input?: {
        [Prop in keyof EntityRecordTypeFromSchema<Sch>] ?: Array<
            EntityOperationValidationRuleForInput<
                EntityRecordTypeFromSchema<Sch>[Prop], 
                Sch,
                ConditionsMap,
                keyof PropertyApplicableEntityOperations<Prop, Sch, OpsInpSch>
            >
        >
    }
}> & {
    conditions?: ConditionsMap,
}

/**
 * Represents the validation rules for each property of an entity input. these validation rules are not conditional.
 * To use conditional validations, use `EntityValidations` instead. 
 * @template Sch - The entity schema type.
 * @template OpsInpSch - The entity operations input schemas type.
 */
export type EntityInputValidations<
    Sch extends EntitySchema<any, any, any, any>,
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = {
    [Prop in keyof EntityRecordTypeFromSchema<Sch>] ?: Array< 
        ValidationRule<EntityRecordTypeFromSchema<Sch>[Prop]> 
        & {
            readonly operations: Array<keyof PropertyApplicableEntityOperations<Prop, Sch, OpsInpSch>>
        }
    >
}


export type PropertyApplicableEntityOperations<
  Prop, 
  Sch extends EntitySchema<any, any, any, any>, 
  OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = OmitNever<{
  [OppName in keyof Sch['model']['entityOperations']]: Prop extends keyof OpsInpSch[OppName] ? OpsInpSch[OppName] : never;
}>