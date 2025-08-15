/**
 *
 * Modified from
 * https://github.com/ichernetskii/merge-deep-ts/
 *
 */
export type Merged<T1, T2> = T1 extends Nullable ? T2 : T2 extends Nullable ? T1 : T1 extends MergeableObject ? T2 extends MergeableObject ? MergedObject<T1, T2> : T2 : T1 extends Readonly<MergeableArray> ? T2 extends Readonly<MergeableArray> ? MergedArray<T1, T2> : T2 : T1 extends MergeableMap ? T2 extends MergeableMap ? MergedMap<T1, T2> : T2 : T1 extends MergeableSet ? T2 extends MergeableSet ? MergedSet<T1, T2> : T2 : T2;
type MergedObject<T1 extends MergeableObject, T2 extends MergeableObject> = {
    [Key in keyof T1 | keyof T2]: Key extends keyof T2 ? Key extends keyof T1 ? Merged<T1[Key], T2[Key]> : T2[Key] : Key extends keyof T1 ? T1[Key] : never;
};
type MergedArray<T1, T2> = T1 extends Readonly<[infer First1, ...infer Rest1]> ? T2 extends Readonly<[infer First2, ...infer Rest2]> ? [Merged<First1, First2>, ...MergedArray<Rest1, Rest2>] : T1 : T2;
type MergedMap<T1 extends MergeableMap, T2 extends MergeableMap> = T1 extends Map<infer K1, infer V1> ? T2 extends Map<infer K2, infer V2> ? Map<K1 | K2, V1 | V2> : never : never;
type MergedSet<T1 extends MergeableSet, T2 extends MergeableSet> = Set<(T1 extends Set<infer Value1> ? Value1 : never) | (T2 extends Set<infer Value2> ? Value2 : never)>;
type MergedMany<T extends unknown[]> = T extends [infer T1, ...infer Rest] ? Rest extends [] ? T1 : T1 extends Nullable ? MergedMany<Rest> : Rest extends [infer T2, ...infer Rest2] ? Rest2 extends [] ? Merged<T1, T2> : Merged<Merged<T1, T2>, MergedMany<Rest2>> : never : null;
type MergeableObject = Record<PropertyKey, unknown>;
type MergeableArray = unknown[];
type MergeableMap = Map<unknown, unknown>;
type MergeableSet = Set<unknown>;
type Mergeable = MergeableObject | MergeableArray | MergeableMap | MergeableSet;
type Nullable = null | undefined;
type NonMergeable<T> = T extends Mergeable | Nullable ? never : T;
/**
 * Deep merges all arguments into a single object. Objects could have circular references.
 * @param args Array of objects to merge
 * @returns The deeply merged object.
 * @example
 * import merge from "merge-fast";
 * merge([{ a: 1 }, { b: 2 }]); // { a: 1, b: 2 }
 * merge([{ a: 1 }, { a: 2 }]); // { a: 2 }
 */
export declare function merge<T extends [...Rest], // → Tuple
Rest extends Params[], RestArrayType extends Rest, MergeableObjectType extends Record<PropertyKey, Params>, MergeableMapType extends Map<Params, Params>, MergeableSet extends Set<Params>, Params extends [...RestArrayType] | MergeableObjectType | MergeableMapType | MergeableSet | NonMergeable<Rest> | Nullable>(args: T): MergedMany<T>;
export {};
