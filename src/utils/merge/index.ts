/**
 * 
 * Modified from 
 * https://github.com/ichernetskii/merge-deep-ts/
 * 
 */

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

type MergedObject<T1 extends MergeableObject, T2 extends MergeableObject> = {
    [Key in keyof T1 | keyof T2]:
        Key extends keyof T2
            ? Key extends keyof T1
                ? Merged<T1[Key], T2[Key]>
                : T2[Key]
            : Key extends keyof T1
                ? T1[Key]
                : never;
};

type MergedArray<T1, T2> =
    T1 extends Readonly<[infer First1, ...infer Rest1]>
        ? T2 extends Readonly<[infer First2, ...infer Rest2]>
            ? [Merged<First1, First2>, ...MergedArray<Rest1, Rest2>]
            : T1
        : T2;

type MergedMap<T1 extends MergeableMap, T2 extends MergeableMap> = T1 extends Map<infer K1, infer V1>
    ? T2 extends Map<infer K2, infer V2>
        ? Map<K1 | K2, V1 | V2>
        : never
    : never;

type MergedSet<T1 extends MergeableSet, T2 extends MergeableSet> = Set<
    (T1 extends Set<infer Value1> ? Value1 : never)
    | (T2 extends Set<infer Value2> ? Value2 : never)
>;

type MergedMany<T extends unknown[]> =
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

type MergeableObject = Record<PropertyKey, unknown>;
type MergeableArray = unknown[];
type MergeableMap = Map<unknown, unknown>;
type MergeableSet = Set<unknown>;
type Mergeable = MergeableObject | MergeableArray | MergeableMap | MergeableSet;
type Nullable = null | undefined;
type NonMergeable<T> = T extends Mergeable | Nullable ? never : T;
enum MergeableType {
    Object = "Object",
    Array = "Array",
    Set = "Set",
    Map = "Map",
    Nullable = "Nullable",
    NonMergeable = "NonMergeable",
}

interface WithValue<T> {
    value: T;
}

const isObject = (obj: unknown): obj is MergeableObject =>
	Object.prototype.toString.call(obj) === "[object Object]";
const isArray = (obj: unknown): obj is MergeableArray => Array.isArray(obj);
const isMap = (obj: unknown): obj is MergeableMap => !!obj && Object.getPrototypeOf(obj) === Map.prototype;
const isSet = (obj: unknown): obj is MergeableSet => !!obj && Object.getPrototypeOf(obj) === Set.prototype;
const isNullable = (obj: unknown): obj is Nullable => obj === null || obj === undefined;
const isMergeable = (obj: unknown): obj is Mergeable => isObject(obj) || isArray(obj) || isMap(obj) || isSet(obj);
const getType = (obj: unknown): MergeableType => {
	if (isObject(obj)) { return MergeableType.Object; }
	if (isArray(obj)) { return MergeableType.Array; }
	if (isMap(obj)) { return MergeableType.Map; }
	if (isSet(obj)) { return MergeableType.Set; }
	if (isNullable(obj)) { return MergeableType.Nullable; }
	return MergeableType.NonMergeable;
};

const getCounter = (() => {
	let counter = -1;
	return (reset = false) => reset ? counter = 0 : ++counter;
})();

const ERROR_NOT_ARRAY = "Argument must be an array" as const;

/**
 * Merge objects with circular references
 * @param result - result object
 * @param args - array of objects to merge
 * @param cache - cached results of merging. Key - sorted string with ids of objects (e.g. "1:3:4:9"), value - result of merging
 * @param objects - map of traversed objects to their ids. Key - object, value - id
 */
function mergeCircular(
	result: WithValue<Mergeable | Nullable>,
	args: any[],
	cache: Map<string, WithValue<Mergeable | Nullable>>,
	objects: WeakMap<Mergeable, number>,
): void {
	if (!Array.isArray(args)) {
		throw new Error(ERROR_NOT_ARRAY);
	}

	if (args.length === 0) {
		result.value = null;
		return;
	}

	// filter out null and undefined
	const nonNullableArgs = args.filter(obj => !isNullable(obj));
	if (nonNullableArgs.length === 0) {
		result.value = args[args.length - 1];
		return;
	}
	// store mergeable arguments in the `objects` map
	for (const obj of nonNullableArgs) {
		if (!objects.has(obj) && isMergeable(obj)) {
			objects.set(obj, getCounter());
		}
	}
	// if there is only one or zero arguments, return it
	if (nonNullableArgs.length <= 1) {
		result.value = nonNullableArgs[0];
		return;
	}
	const lastArg = nonNullableArgs[nonNullableArgs.length - 1];
	// if last argument isn't mergeable, return it
	const type = getType(lastArg);
	if (type === MergeableType.NonMergeable || type === MergeableType.Nullable) {
		result.value = lastArg;
		return;
	}
	// collect all mergeable arguments with the same type from the end
	let count = 1;
	for (let i = nonNullableArgs.length - 2; i >= 0; i--) {
		if (type !== getType(nonNullableArgs[i])) { break; }
		count++;
	}
	const mergeableArgs = nonNullableArgs.slice(-count);

	// check if we already have the result in cache
	const ids = mergeableArgs
		.map(obj => objects.get(obj))
		.sort()
		.join(":");
	const cached = cache.get(ids)?.value;
	if (cached) {
		result.value = cached;
		return;
	} else {
		// store result in cache
		cache.set(ids, result);
	}

	// merge all mergeable arguments
	switch (type) {
		case MergeableType.Object: {
			// find all keys
			const keys = mergeableArgs.reduce(
				(acc, obj) => {
					for (const key of [...Object.getOwnPropertyNames(obj), ...Object.getOwnPropertySymbols(obj)]) {
						acc.add(key);
					}
					return acc;
				},
				new Set<string | number | symbol>(),
			);

			result.value = {};
			for (const key of keys) {
				// merge objects with the same key
				const values = mergeableArgs.map(obj => obj[key]);
				const mergedValues = { value: undefined };
				mergeCircular(mergedValues, values, cache, objects);
				result.value[key] = mergedValues.value;
			}
			break;
		}
		case MergeableType.Array: {
			result.value = [];
			const maxLength = mergeableArgs.reduce((acc, arr) => Math.max(acc, arr.length), 0);
			for (let i = 0; i < maxLength; i++) {
				// merge objects with the same index
				const values = mergeableArgs.map(obj => obj[i]).filter(obj => obj !== undefined);
				const mergedValues = { value: undefined };
				mergeCircular(mergedValues, values, cache, objects);
				result.value[i] = mergedValues.value;
			}
			break;
		}
		case MergeableType.Map: {
			// find all keys
			const keys = mergeableArgs.reduce(
				(acc, obj) => {
					for (const key of obj.keys()) {
						acc.add(key);
					}
					return acc;
				},
				new Set(),
			);

			result.value = new Map();
			for (const key of keys) {
				// merge objects with the same key
				const values = mergeableArgs.map(obj => obj.get(key));
				const mergedValues = { value: undefined };
				mergeCircular(mergedValues, values, cache, objects);
				result.value.set(key, mergedValues.value);
			}
			break;
		}
		case MergeableType.Set: {
			result.value = mergeableArgs.reduce((acc, set) => {
				for (const value of set) {
					acc.add(value);
				}
				return acc;
			}, new Set());
			break;
		}
	}
}

/**
 * Deep merges all arguments into a single object. Objects could have circular references.
 * @param args Array of objects to merge
 * @returns The deeply merged object.
 * @example
 * import merge from "merge-fast";
 * merge([{ a: 1 }, { b: 2 }]); // { a: 1, b: 2 }
 * merge([{ a: 1 }, { a: 2 }]); // { a: 2 }
 */
export function merge<
	T extends [...Rest], // → Tuple
	Rest extends Params[],
	RestArrayType extends Rest,
	MergeableObjectType extends Record<PropertyKey, Params>,
	MergeableMapType extends Map<Params, Params>,
	MergeableSet extends Set<Params>,
	Params extends [...RestArrayType] | MergeableObjectType | MergeableMapType | MergeableSet | NonMergeable<Rest> | Nullable,
>(args: T): MergedMany<T> {
	const result: WithValue<any> = { value: undefined };
	mergeCircular(result, args, new Map(), new WeakMap());
	return result.value;
}