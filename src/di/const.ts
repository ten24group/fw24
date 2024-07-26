// export const INJECTABLE_KEY = 'INJECTABLE';
// export const DEPENDENCIES_KEY = 'DEPENDENCIES';
// export const INJECT_KEY = 'INJECT';
// export const LAZY_KEY = 'LAZY';
// export const ON_INIT_KEY = 'ON_INIT';
// export const ON_DESTROY_KEY = 'ON_DESTROY';

import { createToken } from "./utils";



export const INJECTABLE_KEY = createToken('INJECTABLE');
export const DEPENDENCIES_KEY = createToken('DEPENDENCIES');
export const INJECT_KEY = createToken('INJECT');
export const ON_INIT_KEY = createToken('ON_INIT');
