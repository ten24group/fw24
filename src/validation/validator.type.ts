import { Schema } from "electrodb";
import { Narrow, OmitNever, ValueOf } from '../utils/types';
import { DefaultEntityOperations, EntityRecordTypeFromSchema, TEntityOpsInputSchemas } from "../entity";


export interface IValidatorResponse {
    pass: boolean;
    errors?: Error[] 
}

export type ValidatorOptions<
    OpName extends keyof OpsInpSch,
    EntitySchema extends Schema<any, any, any>, 
    ConditionsMap extends TMapOfValidationConditions<any, any>, 
    Ops extends DefaultEntityOperations = DefaultEntityOperations,
    OpsInpSch extends TEntityOpsInputSchemas<EntitySchema, Ops> = TEntityOpsInputSchemas<EntitySchema, Ops>,
> = {
    readonly operationName: OpName,
    readonly entityValidations?: EntityValidations<EntitySchema, ConditionsMap, Ops, OpsInpSch>
    readonly input?: InputType,
    readonly actor?: Actor,
    readonly record?: RecordType, 
}

export interface IValidator {
    validate<
        OpName extends keyof OpsInpSch,
        EntitySchema extends Schema<any, any, any>, 
        ConditionsMap extends TMapOfValidationConditions<any, any>, 
        Ops extends DefaultEntityOperations = DefaultEntityOperations,
        OpsInpSch extends TEntityOpsInputSchemas<EntitySchema, Ops> = TEntityOpsInputSchemas<EntitySchema, Ops>,
    >(options: ValidatorOptions<OpName, EntitySchema, ConditionsMap, Ops, OpsInpSch> ): Promise<IValidatorResponse>;
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

export type Validations<T = unknown> = {
	readonly 'minLength' ?: number,
    readonly 'maxLength' ?: number,
    readonly 'required' ?: boolean,
    readonly 'pattern' ?: RegExp,
    readonly 'datatype' ?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'email' | 'ipv4' | 'ipv6' | 'uri' | 'url' | 'uuid' | 'json' | 'date' | 'date-time',
    readonly 'unique' ?: boolean,
    readonly 'eq' ?: T | string | any,
    readonly 'neq' ?: T | string | any,
    readonly 'gt' ?: T | string | any,
    readonly 'gte' ?: T | string | any,
    readonly 'lt' ?: T | string | any,
    readonly 'lte' ?: T | string | any,
}

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

export type TValidationRuleForType<T extends unknown> = {
    // TODO; narrow validation rules by type like ['string', 'number', 'boolean' etc]
    readonly [V in keyof Validations<T>] ?: Validations<T>[V];
};

export type TValidationRuleForOperations<
    T extends unknown, 
    EntitySchema extends Schema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    OpsInpSch extends TEntityOpsInputSchemas<EntitySchema, DefaultEntityOperations> = TEntityOpsInputSchemas<EntitySchema, DefaultEntityOperations>,
> = {

    readonly operations ?: Narrow<Array< '*' | ValueOf<{
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

} & TValidationRuleForType<T>;


/**
 * 
 * Similar to `TValidationRuleForOperations` except 
 * - the available rules for property are limited to if that key is present in the input-schema
 * - and the available conditions are limited to the conditions applicable to the input-schema
 *  i.e to the conditions that do not utilize any additional keys for input-validations, except whatever keys are available in the input-schema.
 * 
 */
export type TValidationRuleForOperationsAndInput<
    T extends unknown, 
    EntitySchema extends Schema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    OpsInpSch extends TEntityOpsInputSchemas<EntitySchema, DefaultEntityOperations> = TEntityOpsInputSchemas<EntitySchema, DefaultEntityOperations>,
> = {
    readonly operations ?: Narrow<Array< '*' | ValueOf<{
        readonly [OppName in keyof OpsInpSch]: OppName | [ 
            OppName, 
            
            /** array of condition names like ['xxx', 'yyyy']  default: all conditions must be satisfied */
            Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> > 
            | 
            /** array of tuple of condition names + applicability like [ ['xxx', 'yyyy'], 'all' ]  ==> specify how conditions must be satisfied */
            [ Array<keyof OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[OppName]>, OmitNever<ConditionsMap>>> >, 'all' | 'any' | 'none'], 
        ]
    }>>>,

} & TValidationRuleForType<T>;


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


export type TConditionalValidationRule<T extends unknown, ConditionsMap extends TMapOfValidationConditions<InputType, RecordType>> = {
    readonly conditions ?: 
        Array<keyof ConditionsMap> /** default: all conditions must be satisfied */
        | 
        [ Array<keyof ConditionsMap>, 'all' | 'any' | 'none'], /** specify how conditions must be satisfied */
} & TValidationRuleForType<T>;

export type TEntityOpValidations<I extends InputType, R extends RecordType, C extends TMapOfValidationConditions<I, R> > = {
    readonly actorRules ?: {
        [K in keyof Actor]?: TConditionalValidationRule<I, C>[];
    },
    readonly inputRules ?: {
        [InputKey in keyof I] ?: TConditionalValidationRule<I, C>[];
    },
    readonly recordRules ?: {
        [RecordKey in keyof R] ?: TConditionalValidationRule<R, C>[];
    },
}

export type EntityOpsValidations<
    EntitySchema extends Schema<any, any, any>,
    ConditionsMap extends TMapOfValidationConditions<any, any>,
    Ops extends DefaultEntityOperations = DefaultEntityOperations,
    OpsInpSch extends TEntityOpsInputSchemas<EntitySchema, Ops> = TEntityOpsInputSchemas<EntitySchema, Ops>,
> = Narrow<{
    readonly [oppName in keyof OpsInpSch] ?: TEntityOpValidations<
        Narrow<OpsInpSch[oppName]>, // operation input schema
        EntityRecordTypeFromSchema<EntitySchema>, // entity record type
        // filter out the conditions that require any additional prop which isn't provided in the input
        OmitNever<InputApplicableConditionsMap<Narrow<OpsInpSch[oppName]>, ConditionsMap>>
    >
} & {
    readonly conditions?: TMapOfValidationConditions<any, EntityRecordTypeFromSchema<EntitySchema>>
}>

export type EntityValidations< 
    EntitySchema extends Schema<any, any, any>, 
    ConditionsMap extends TMapOfValidationConditions<any, any>, 
    OPs extends DefaultEntityOperations = DefaultEntityOperations,
    OpsInpSch extends TEntityOpsInputSchemas<EntitySchema, OPs> = TEntityOpsInputSchemas<EntitySchema, OPs>,
> = {
    readonly actorRules ?: {
        [ActorKey in keyof Actor] ?: Narrow<
            TValidationRuleForOperations<
                Actor[ActorKey], 
                EntitySchema, 
                ConditionsMap, 
                OpsInpSch
            >
        >[];
    },
    readonly recordRules ?: {
        [RecordKey in keyof EntityRecordTypeFromSchema<EntitySchema>] ?: Narrow<
            TValidationRuleForOperations<
                EntityRecordTypeFromSchema<EntitySchema>[RecordKey], 
                EntitySchema, 
                ConditionsMap, 
                OpsInpSch
            >
        >[];
    },
    readonly inputRules?: {
        [Prop in keyof EntityRecordTypeFromSchema<EntitySchema>] ?: Array<
            TValidationRuleForOperationsAndInput<
                Prop, 
                EntitySchema,
                ConditionsMap,
                OmitNever<{
                    // only operations that have the prop in their input schema
                    [OppName in keyof OpsInpSch]: Prop extends keyof Narrow<OpsInpSch[OppName]> ? OpsInpSch[OppName] : never;
                }>
            >
        >
    }
} & {
    conditions?: ConditionsMap,
}