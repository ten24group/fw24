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
    readonly entityValidations?: EntityValidations<Sch, ConditionsMap, OpsInpSch> | EntityOpsInputValidations<Sch, OpsInpSch>,
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
export type TValidationValue<T > = T | TComplexValidationValue<T>;

export type TComplexValidationValueWithMessage<T> = {
    value: T,
    message?: string,
    messageId?: string, // Optional error-message-id, that is supposed to be used by error message translators
}
export type TComplexValidationValueWithValidator<T> = {
    validator: (inputValue: T, ctx?: any) => Promise<TestValidationResult>,
    messageId?: string, // Optional error-message-id, that is supposed to be used by error message translators
    message?: string,
}

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

export const Validation_Keys = [
    'minLength', 'maxLength', 'required', 'pattern', 'datatype', 'unique', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'inList', 'notInList', 'custom'
];

export type ValidationRule<T> = {
    // TODO: narrow validation rules by type like ['string', 'number', 'boolean' etc]
    readonly [V in keyof Validations<T>] ?: TValidationValue<Validations<T>[V]>;
}

export type ComplexValidationRule<T> = ValidationRule<T> & {
    readonly message ?: string,
    readonly messageId ?: string,
    readonly validator ?: (value: T, collectErrors?: boolean) => Promise<TestComplexValidationRuleResult>,
}

export type InputValidationRule<Input extends InputType = InputType> = {
    [K in keyof Input] ?: ValidationRule<Input[K]> | ComplexValidationRule<Input[K]>;
}

export type ConditionsAndScopeTuple = [ conditions: string[], scope: string ];

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


export type EntityValidationCondition<I extends InputType, R extends RecordType> = {
    readonly actor ?: InputValidationRule<Actor>,
    readonly input ?: InputValidationRule<I>,
    readonly record ?: InputValidationRule<R>,
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

export type OperationConditionsTuple<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends MapOfValidationCondition<any, any>,
    OppName extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = [ 
    op: OppName, 
    /** array of condition names like ['xxx', 'yyyy'] */
    conditions ?: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
    scope ?: 'all' | 'any' | 'none' /* default: [all] all conditions must be satisfied */
]

export type OperationConditions<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends MapOfValidationCondition<any, any>,
    OppName extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = {
    /** array of condition names like ['xxx', 'yyyy']  default: all conditions must be satisfied */
    conditions: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
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

export type ConditionalValidationRule<T, ConditionsMap extends MapOfValidationCondition<InputType, RecordType>> = {
    readonly conditions ?: 
        Array<keyof ConditionsMap> /** default: all conditions must be satisfied */
        | 
        [ Array<keyof ConditionsMap>, 'all' | 'any' | 'none'], /** specify how conditions must be satisfied */
} & ComplexValidationRule<T>;

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

export type EntityOperationsValidation<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends MapOfValidationCondition<any, any>,
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = Narrow<{
    readonly [oppName in keyof OpsInpSch] ?: EntityOperationValidation<
        Narrow<OpsInpSch[oppName]>, // operation input schema
        EntityRecordTypeFromSchema<Sch>, // entity record type
        // filter out the conditions that require any additional prop which isn't provided in the input
        OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[oppName]>, ConditionsMap>>
    >
} & {
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

export type EntityOpsInputValidations<
    Sch extends EntitySchema<any, any, any, any>,
    OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = {
    [Prop in keyof EntityRecordTypeFromSchema<Sch>] ?: Array< ValidationRule<EntityRecordTypeFromSchema<Sch>[Prop]> & {
        readonly operations: Array<keyof PropertyApplicableEntityOperations<Prop, Sch, OpsInpSch>>
    }>
}


export type PropertyApplicableEntityOperations<
  Prop, 
  Sch extends EntitySchema<any, any, any, any>, 
  OpsInpSch extends EntityOperationsInputSchemas<Sch> = EntityOperationsInputSchemas<Sch>,
> = OmitNever<{
  [OppName in keyof Sch['model']['entityOperations']]: Prop extends keyof OpsInpSch[OppName] ? OpsInpSch[OppName] : never;
}>