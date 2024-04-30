import {
	type Mergeable,
	type MergeableArray,
	type MergeableMap,
	type MergeableObject,
	type MergeableSet,
	MergeableType,
	type Nullable,
} from "./types";

export const isObject = (obj: unknown): obj is MergeableObject =>
	Object.prototype.toString.call(obj) === "[object Object]";
export const isArray = (obj: unknown): obj is MergeableArray => Array.isArray(obj);
export const isMap = (obj: unknown): obj is MergeableMap => !!obj && Object.getPrototypeOf(obj) === Map.prototype;
export const isSet = (obj: unknown): obj is MergeableSet => !!obj && Object.getPrototypeOf(obj) === Set.prototype;
export const isNullable = (obj: unknown): obj is Nullable => obj === null || obj === undefined;
export const isMergeable = (obj: unknown): obj is Mergeable => isObject(obj) || isArray(obj) || isMap(obj) || isSet(obj);
export const getType = (obj: unknown): MergeableType => {
	if (isObject(obj)) { return MergeableType.Object; }
	if (isArray(obj)) { return MergeableType.Array; }
	if (isMap(obj)) { return MergeableType.Map; }
	if (isSet(obj)) { return MergeableType.Set; }
	if (isNullable(obj)) { return MergeableType.Nullable; }
	return MergeableType.NonMergeable;
};

export const getCounter = (() => {
	let counter = -1;
	return (reset = false) => reset ? counter = 0 : ++counter;
})();

export const ERROR_NOT_ARRAY = "Argument must be an array" as const;