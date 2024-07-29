
import { makeDIToken } from "./utils";

export const PROPERTY_INJECT_KEY = makeDIToken('PROPERTY_DEPENDENCY_INJECT');
export const CONSTRUCTOR_INJECT_KEY = makeDIToken('CONSTRUCTOR_DEPENDENCY_INJECT');
export const ON_INIT_METHOD_KEY = makeDIToken('ON_INIT_METHOD');
