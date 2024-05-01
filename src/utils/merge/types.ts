export type Merged<T1, T2> =
    T1 extends Nullable
        ? T2 // [Nullable, T2] -> T2
        : T2 extends Nullable
            ? T1 // [T1, Nullable] -> T1
            : T1 extends MergeableObject
                ? T2 extends MergeableObject
                    ? MergedObject<T1, T2> // [MergeableObject, MergeableObject] -> MergedObject<T1, T2>
                    : T2 // [MergeableObject, T2] -> T2
                : T1 extends Readonly<MergeableArray>
                    ? T2 extends Readonly<MergeableArray>
                        ? MergedArray<T1, T2> // [MergeableArray, MergeableArray] -> MergedArray<T1, T2>
                        : T2 // [MergeableArray, T2] -> T2
                    : T1 extends MergeableMap
                        ? T2 extends MergeableMap
                            ? MergedMap<T1, T2> // [MergeableMap, MergeableMap] -> MergedMap<T1, T2>
                            : T2 // [MergeableMap, T2] -> T2
                        : T1 extends MergeableSet
                            ? T2 extends MergeableSet
                                ? MergedSet<T1, T2> // [MergeableSet, MergeableSet] -> MergedSet<T1, T2>
                                : T2 // [MergeableSet, T2] -> T2
                            : T2; // [NonMergeable, T2] -> T2

export type MergedObject<T1 extends MergeableObject, T2 extends MergeableObject> = {
    [Key in keyof T1 | keyof T2]:
        Key extends keyof T2
            ? Key extends keyof T1
                ? Merged<T1[Key], T2[Key]>
                : T2[Key]
            : Key extends keyof T1
                ? T1[Key]
                : never;
};

export type MergedArray<T1, T2> =
    T1 extends Readonly<[infer First1, ...infer Rest1]>
        ? T2 extends Readonly<[infer First2, ...infer Rest2]>
            ? [Merged<First1, First2>, ...MergedArray<Rest1, Rest2>]
            : T1
        : T2;

export type MergedMap<T1 extends MergeableMap, T2 extends MergeableMap> = T1 extends Map<infer K1, infer V1>
    ? T2 extends Map<infer K2, infer V2>
        ? Map<K1 | K2, V1 | V2>
        : never
    : never;

export type MergedSet<T1 extends MergeableSet, T2 extends MergeableSet> = Set<
    (T1 extends Set<infer Value1> ? Value1 : never)
    | (T2 extends Set<infer Value2> ? Value2 : never)
>;

export type MergedMany<T extends unknown[]> =
    T extends [infer T1, ...infer Rest]
        ? Rest extends []
            ? T1 // [T1] -> T1
            : T1 extends Nullable
                ? MergedMany<Rest> // [Nullable, ...Rest] -> MergedMany<Rest>
                : Rest extends [infer T2, ...infer Rest2]
                    ? Rest2 extends []
                        ? Merged<T1, T2> // [T1, T2] -> Merged<T1, T2>
                        : Merged<Merged<T1, T2>, MergedMany<Rest2>> // [T1, T2, ...Rest2] -> Merged<T1, MergedMany<Rest2>>
                    : never
        : null; // []

export type MergeableObject = Record<PropertyKey, unknown>;
export type MergeableArray = unknown[];
export type MergeableMap = Map<unknown, unknown>;
export type MergeableSet = Set<unknown>;
export type Mergeable = MergeableObject | MergeableArray | MergeableMap | MergeableSet;
export type Nullable = null | undefined;
export type NonMergeable<T> = T extends Mergeable | Nullable ? never : T;
export enum MergeableType {
    Object = "Object",
    Array = "Array",
    Set = "Set",
    Map = "Map",
    Nullable = "Nullable",
    NonMergeable = "NonMergeable",
}

export interface WithValue<T> {
    value: T;
}

export type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends
        (<T>() => T extends Y ? 1 : 2) ? true : false;

export function assert<T extends true>(): T { return true as T; }