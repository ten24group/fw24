/**
 * Used to narrow the inferred generic type for readability
 * @param INPUT Type
 * @returns Type
 */
export type Narrow<INPUT> = INPUT extends Promise<infer AWAITED>
  ? Promise<Narrow<AWAITED>>
  : INPUT extends (...args: infer ARGS) => infer RETURN? (...args: Narrow<ARGS>) => Narrow<RETURN>
  : INPUT extends [] ? INPUT
  : INPUT extends object ? { [KEY in keyof INPUT]: Narrow<INPUT[KEY]> }
  : INPUT extends string | number | boolean | bigint ? INPUT
  : never;

export const asConst = <INPUT>(input: Narrow<INPUT>): Narrow<INPUT> => input;


export type Writable<T> = { -readonly [P in keyof T]: T[P] };

export type Primitives = string | number | boolean | undefined | null;
export type FunctionOrDateOrRegex = ((...args: unknown[]) => unknown) | Date | RegExp


/**
 * Recursively sets all type properties as DeepWritable (non-readonly)
 * @param TYPE Type
 * @returns Type
 */
export type DeepWritable<TYPE> = TYPE extends Primitives & FunctionOrDateOrRegex 
  ? TYPE
  : // maps
    TYPE extends ReadonlyMap<infer KEYS, infer VALUES>
    ? Map<DeepWritable<KEYS>, DeepWritable<VALUES>>
    : // sets
      TYPE extends ReadonlySet<infer VALUES>
      ? Set<DeepWritable<VALUES>>
      : TYPE extends ReadonlyArray<unknown>
        ? // tuples
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents
          `${bigint}` extends `${keyof TYPE & any}`
          ? { -readonly [KEY in keyof TYPE]: DeepWritable<TYPE[KEY]> }
          : // arrays
            DeepWritable<TYPE[number]>[]
        : // objects
          TYPE extends object
          ? { -readonly [KEY in keyof TYPE]: DeepWritable<TYPE[KEY]> }
          : // primitive or literal value
            TYPE;

export type DeepReadonly<T> = T extends Primitives & FunctionOrDateOrRegex ? T
  : T extends Map<infer KEYS, infer VALUES> ? DeepReadonlyMap< KEYS, VALUES>
  : T extends Set<infer VALUES> ? DeepReadonlySet<VALUES>
  : T extends Array<infer ITEMS> ? DeepReadonlyArray<ITEMS>
  : DeepReadonlyObject<T>;

export type DeepReadonlySet<T> = ReadonlySet<DeepReadonly<T>>;
export type DeepReadonlyArray<T> = ReadonlyArray<DeepReadonly<T>>;
export type DeepReadonlyMap<K, V> = ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>;

export type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export type DeepPartial<T> = {
    [P in keyof T]?: DeepPartial<T[P]>;
};

/**
 * Return `THEN` if `CONDITION` extends `true`, `ELSE` otherwise
 * @param CONDITION Boolean
 * @param THEN Type
 * @param ELSE Type
 * @returns Type
 */
export type If<
  CONDITION extends boolean,
  THEN,
  ELSE = never,
> = CONDITION extends true ? THEN : ELSE;


type Has<U, U1> = [U1] extends [U] ? true : false;

export type PrettyPrint<A, Seen = never> = If<
  Has<Seen, A>,
  A,
  A extends Record<string | number | symbol, unknown>
    ? { [K in keyof A]: PrettyPrint<A[K], A | Seen> } & unknown
    : A
>

export type ArrayElement<ArrayType extends readonly unknown[] | undefined> = 
  ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

   
export type AnyClass = new (...args: any[]) => any;

export type AnyFunction = (...args: any[]) => any;

export type PlainObject = Record<string | number | symbol, any>;

export type Nullish = null | undefined;

export type IfOptional<T, TypeIfTrue, TypeIfFalse> =  T extends undefined | never ? TypeIfTrue : TypeIfFalse;

/**
 * Return `true` if `A` and `B` extend `true`, `false` otherwise
 * @param A Type
 * @param B Type
 * @returns Boolean
 */
export type And<CONDITION_A, CONDITION_B> = CONDITION_A extends true
  ? CONDITION_B extends true
    ? true
    : false
  : false;


export type ValueOf<T> = T[keyof T];

export type PickKeysByType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

export type PickPropertiesByType<T, U> = {
  [K in PickKeysByType<T, U>]: T[K];
};

export type OmitNever<T> = { [K in keyof T as T[K] extends never | undefined ? never : K]: T[K] }

export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

type AllKeys<T> = T extends unknown ? keyof T : never;
type Id<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;
type _ExclusiveUnion<T, K extends PropertyKey> =
    T extends unknown ? Id<T & Partial<Record<Exclude<K, keyof T>, never>>> : never;

export type ExclusiveUnion<T> = _ExclusiveUnion<T, AllKeys<T>>;

// concatenates two strings with a dot in the middle, unless the last string is empty. 
// So Join<"a","b.c"> is "a.b.c" while Join<"a",""> is "a"
export type Join<K, P> = K extends string | number ? P extends string | number 
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never 
  : never;
  
// export type Paths<T, D extends number = 10> = [D] extends [never] ? never 
//   : T extends object ? { 
//     [K in keyof T]-?: K extends string | number ? `${K}` | Join<K, Paths<T[K], Prev[D]>>
//     : never
//   }[keyof T] 
//   : "";

// export type Leaves<T, D extends number = 10> = [D] extends [never] ? never 
//   : T extends object ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T] 
//   : "";

// type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, ...0[]];

export type Paths<T> = T extends object ? { [K in keyof T]:
  `${Exclude<K, symbol>}${"" | `.${Paths<T[K]>}`}`
}[keyof T] : never

export type Leaves<T> = T extends object ? { [K in keyof T]:
  `${Exclude<K, symbol>}${Leaves<T[K]> extends never ? "" : `.${Leaves<T[K]>}`}`
}[keyof T] : never

// example
type NestedObjectType = {
  a: string; b: string;
  nest: { c: string; };
  otherNest: { c: string; };
};

type NestedObjectPaths = Paths<NestedObjectType>;
// type NestedObjectPaths = "a" | "b" | "nest" | "otherNest" | "nest.c" | "otherNest.c"
type NestedObjectLeaves = Leaves<NestedObjectType>
// type NestedObjectLeaves = "a" | "b" | "nest.c" | "otherNest.c"