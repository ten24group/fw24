import { EntityRecordTypeFromSchema, EntitySchema, TEntityOpsInputSchemas } from "../entity";
import { Narrow, OmitNever, ValueOf } from '../utils/types';

import { Request } from '../interfaces/request';

export type TestValidationResult = {
    pass: boolean,
    message?: string,
    expected?: any,
    received?: any,
}

export type ValidationError = {
    message: string,
    expected ?: any,                           
    received ?: any,
    path ?: string,
}

export type TestValidationRuleResponse = {
    pass: boolean, 
    message ?: string,
    errors ?: Array<ValidationError>
};

export type InputValidationErrors<I extends InputType = InputType> = {
    [K in keyof I] ?: Array<ValidationError>
};

export type InputValidationResponse<I extends InputType = InputType> = {
    pass: boolean, 
    errors ?: InputValidationErrors<I>
};

export interface IValidatorResponse<
    A extends Actor = Actor,
    I extends InputType = InputType,
    R extends RecordType = RecordType,
> {
    pass: boolean;
    errors ?: {
        actor ?: InputValidationErrors<A>
        input ?: InputValidationErrors<I>
        record ?: InputValidationErrors<R>
    },
}

export type OpValidatorOptions<
    Sch extends EntitySchema<any, any, any>, 
    OpName extends keyof Sch['model']['entityOperations'],
    ConditionsMap extends TMapOfValidationConditions<any, any>, 
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = {
    readonly operationName: OpName,
    readonly entityValidations?: EntityValidations<Sch, ConditionsMap, OpsInpSch>
    readonly input?: InputType,
    readonly actor?: Actor,
    readonly record?: RecordType, 
}

export interface IValidator {
    validate<
        Sch extends EntitySchema<any, any, any>, 
        OpName extends keyof Sch['model']['entityOperations'],
        ConditionsMap extends TMapOfValidationConditions<any, any>, 
        OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
    >(options: OpValidatorOptions< Sch, OpName, ConditionsMap, OpsInpSch> ): Promise<IValidatorResponse>;

    validateInput<I extends InputType>(
        input: I | undefined,
        rules?: ValidationRules<I>, 
        collectErrors?: boolean,
    ): Promise<InputValidationResponse<I>>;

    validateHttpRequest<
        Header extends InputType = InputType, 
        Body extends InputType = InputType,
        Param extends InputType = InputType,
        Query extends InputType = InputType,
    >(
        requestContext: Request, 
        validations: HttpRequestValidations<Header, Body, Param, Query>, 
    ): Promise<HttpRequestValidationResponse<Header, Body, Param, Query>>
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
    message: string,
}
export type TComplexValidationValueWithValidator<T> = {
    validator: (inputValue: T, ctx?: any) => Promise<TestValidationResult>,
    message?: string,
}

export type TComplexValidationValue<T> = TComplexValidationValueWithMessage<T> | TComplexValidationValueWithValidator<T>

export type Validations<T> = {
	readonly 'minLength' ?: number,
    readonly 'maxLength' ?: number,
    readonly 'required' ?: boolean,
    readonly 'pattern' ?: RegExp,
    readonly 'datatype' ?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'email' | 'ip' | 'ipv4' | 'ipv6' | 'uri' | 'httpUrl' | 'uuid' | 'json' | 'date' | 'date-time',
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

export const validations = [
    'minLength', 'maxLength', 'required', 'pattern', 'datatype', 'unique', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'
];

export type ValidationRule<T> = {
    // TODO: narrow validation rules by type like ['string', 'number', 'boolean' etc]
    readonly [V in keyof Validations<T>] ?: TValidationValue<Validations<T>[V]>;
}

export type ComplexValidationRule<T> = ValidationRule<T> & {
    readonly message ?: string,
    readonly validator ?: (value: T, collectErrors?: boolean) => Promise<TestValidationRuleResponse>,
}

export type ValidationRules<Input extends InputType = InputType> = {
    [K in keyof Input] ?: ValidationRule<Input[K]> | ComplexValidationRule<Input[K]>;
}

export type HttpRequestValidations< 
    Header extends InputType = InputType, 
    Body extends InputType = InputType,
    Param extends InputType = InputType,
    Query extends InputType = InputType,
> = {
    readonly body ?: ValidationRules<Body>,
    readonly query ?: ValidationRules<Query>,
    readonly param ?: ValidationRules<Param>,
    readonly header ?: ValidationRules<Header>,
}

export type HttpRequestValidationResponse<
    Header extends InputType = InputType, 
    Body extends InputType = InputType,
    Param extends InputType = InputType,
    Query extends InputType = InputType,
> = {
    pass: boolean, 
    errors ?: {
        body ?: InputValidationErrors<Body>,
        query ?: InputValidationErrors<Query>,
        param ?: InputValidationErrors<Param>,
        header ?: InputValidationErrors<Header>,
    }
};

export type TEntityValidationCondition<I extends InputType, R extends RecordType> = {
    readonly actorRules ?: {
        [K in keyof Actor]?: Validations<Actor[K]>;
    },
    readonly inputRules ?: { 
        [InputKey in keyof I] ?: Validations<I[InputKey]>;
    },
    readonly recordRules ?: {
        [RecordKey in keyof R] ?: Validations<R[RecordKey]>;
    },
}

export type TMapOfValidationConditions<I extends InputType = InputType, R extends RecordType = RecordType> = Record<string, TEntityValidationCondition<I, R>>;


export type TValidationRuleForOperations<
    T, 
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = {

    readonly operations ?: Narrow<Array<ValueOf<{
        /**
         * for each operation create a tuple like [ 'opp-name', [condition-names that are applicable on the input schema for the opp] ]
         * 
         * However the conditions can be defined in 2 formats
         *  - [array of condition names]     ==> applicability is all i.e all conditions must evaluate to true for the rule to apply
         *  - [[array of condition names], applicability ] ==> a tuple of conditions and their applicability i.e. user can control the applicability of the conditions
         * 
         * e.g. 
         * ['*']                                        ==> applicable to all operations without conditions
         * ['delete', 'update' ]                        ==> applicable to 'delete' and 'update' operations regardless conditions,
         * [ 'delete', ['xxx', 'yyy', 'zzz']        ]   ==> rule applies on 'delete' operation if 'all'   'xxx', 'yyy', 'zzz'     evaluates to 'true'
         * [ 'get',    [['xxx', 'ccc'],     'all']  ]   ==> rule applies on 'get' operation if 'all'      'xxx' and 'ccc'         evaluates to 'true'
         * [ 'get',    [['ppp', 'qqq'],     'none'] ]   ==> rule applies on 'get' operation if 'none-of'  'ppp' and 'qqq'         evaluates to 'true'
         * [ 'get',    [['lll', 'mmm'],     'any']  ]   ==> rule applies on 'get' operation if 'any-of'   'lll' and 'mmm'         evaluates to 'true'
         * 
         * */
        readonly [OppName in keyof OpsInpSch]: OppName | [ 
            OppName, 
            /** array of condition names like ['xxx', 'yyyy']  default: all conditions must be satisfied */
            Array<keyof OmitNever<ConditionsMap>>  
            | 
            /** array of tuple of condition names + applicability like [ ['xxx', 'yyyy'], 'all' ]  ==> specify how conditions must be satisfied */
            [ Array<keyof OmitNever<ConditionsMap>> , 'all' | 'any' | 'none'], 
        ]
    }>>>,

} & ValidationRule<T>;


/**
 * 
 * Similar to `TValidationRuleForOperations` except 
 * - the available rules for property are limited to if that key is present in the input-schema
 * - and the available conditions are limited to the conditions applicable to the input-schema
 *  i.e to the conditions that do not utilize any additional keys for input-validations, except whatever keys are available in the input-schema.
 * 
 */
export type TValidationRuleForOperationsAndInput<
    T, 
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    OpsKeys extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = {
    readonly operations ?: Narrow<Array<ValueOf<{
        readonly [OppName in OpsKeys]: TupleOfOpNameAndApplicableConditions<Sch, ConditionsMap, OppName, OpsInpSch> 
    }>>> 
    |
    Narrow<{
        readonly [OppName in OpsKeys] ?: [{
            conditions: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
            scope ?: 'all' | 'any' | 'none' /* default: [all] all conditions must be satisfied */
        }]
    }>,

} & ValidationRule<T>;

export type TupleOfOpNameAndApplicableConditions<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    OppName extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = [ 
    op: OppName, 
    /** array of condition names like ['xxx', 'yyyy'] */
    conditions ?: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
    scope ?: 'all' | 'any' | 'none' /* default: [all] all conditions must be satisfied */
]

export type OpApplicableConditionsWithScope<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    OppName extends keyof Sch['model']['entityOperations'],
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = {
    /** array of condition names like ['xxx', 'yyyy']  default: all conditions must be satisfied */
    conditions: Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >,
    scope: 'all' | 'any' | 'none'
}


export type TInputApplicableCondition<Inp extends InputType, C extends TEntityValidationCondition<any, any>> = {
  
  readonly actorRules: C['actorRules'] extends undefined ? void : C['actorRules'],
  readonly recordRules: C['recordRules'] extends undefined ? void : C['recordRules'],
  
  readonly inputRules: C['inputRules'] extends undefined 
    ? void 
    : keyof C['inputRules'] extends keyof Inp
      ? C['inputRules']
      : void,
};

export type InputApplicableConditionsMap<Inp extends InputType, ConditionsMap extends TMapOfValidationConditions<any, any> > = OmitNever<{
  readonly [ConditionName in keyof ConditionsMap]: TInputApplicableCondition<Inp, ConditionsMap[ConditionName]> extends ConditionsMap[ConditionName]
    ? ConditionsMap[ConditionName]
    : never;
}>


export type TConditionalValidationRule<T, ConditionsMap extends TMapOfValidationConditions<InputType, RecordType>> = {
    readonly conditions ?: 
        Array<keyof ConditionsMap> /** default: all conditions must be satisfied */
        | 
        [ Array<keyof ConditionsMap>, 'all' | 'any' | 'none'], /** specify how conditions must be satisfied */
} & ComplexValidationRule<T>;

export type TEntityOpValidations<I extends InputType, R extends RecordType, C extends TMapOfValidationConditions<I, R> > = {
    readonly actorRules ?: {
        [K in keyof Actor]?: TConditionalValidationRule<Actor[K], C>[];
    },
    readonly inputRules ?: {
        [K in keyof I] ?: TConditionalValidationRule<I[K], C>[];
    },
    readonly recordRules ?: {
        [K in keyof R] ?: TConditionalValidationRule<R[K], C>[];
    },
}

export type EntityOpsValidations<
    Sch extends EntitySchema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = Narrow<{
    readonly [oppName in keyof OpsInpSch] ?: TEntityOpValidations<
        Narrow<OpsInpSch[oppName]>, // operation input schema
        EntityRecordTypeFromSchema<Sch>, // entity record type
        // filter out the conditions that require any additional prop which isn't provided in the input
        OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[oppName]>, ConditionsMap>>
    >
} & {
    readonly conditions?: TMapOfValidationConditions<any, EntityRecordTypeFromSchema<Sch>>
}>

export type EntityValidations< 
    Sch extends EntitySchema<any, any, any, any>, 
    ConditionsMap extends TMapOfValidationConditions<any, any>, 
    OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = Narrow<{
    readonly actorRules ?: {
        [ActorKey in keyof Actor] ?: Narrow<
            TValidationRuleForOperations<
                Actor[ActorKey], 
                Sch, 
                ConditionsMap, 
                OpsInpSch
            >
        >[];
    },
    readonly recordRules ?: {
        [RecordKey in keyof EntityRecordTypeFromSchema<Sch>] ?: Narrow<
            TValidationRuleForOperations<
                EntityRecordTypeFromSchema<Sch>[RecordKey], 
                Sch, 
                ConditionsMap, 
                OpsInpSch
            >
        >[];
    },
    readonly inputRules?: {
        [Prop in keyof EntityRecordTypeFromSchema<Sch>] ?: Array<
            TValidationRuleForOperationsAndInput<
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


export type PropertyApplicableEntityOperations<
  Prop, 
  Sch extends EntitySchema<any, any, any, any>, 
  OpsInpSch extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> = OmitNever<{
  [OppName in keyof Sch['model']['entityOperations']]: Prop extends keyof OpsInpSch[OppName] ? OpsInpSch[OppName] : never;
}>