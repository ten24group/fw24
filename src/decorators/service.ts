import type { ClassConstructor } from './../interfaces/di';


import { tryRegisterInjectable, type InjectableOptions } from './../di/utils/tryRegisterInjectable';

export function Service(
    options: InjectableOptions = { 
        providedIn: 'ROOT' 
    } 
): ClassDecorator {
    return (constructor: Function) => {
        tryRegisterInjectable(constructor as ClassConstructor, {
            ...options, 
            type: 'service'
        });
    };
}