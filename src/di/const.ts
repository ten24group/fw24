// export const INJECTABLE_KEY = 'INJECTABLE';
// export const DEPENDENCIES_KEY = 'DEPENDENCIES';
// export const INJECT_KEY = 'INJECT';
// export const LAZY_KEY = 'LAZY';
// export const ON_INIT_KEY = 'ON_INIT';
// export const ON_DESTROY_KEY = 'ON_DESTROY';

import { makeDIToken } from "./utils";



export const INJECTABLE_KEY = makeDIToken('INJECTABLE');
export const DEPENDENCIES_KEY = makeDIToken('DEPENDENCIES');
export const INJECT_KEY = makeDIToken('INJECT');
export const ON_INIT_KEY = makeDIToken('ON_INIT');
