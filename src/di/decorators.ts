// decorators.ts

import { DEPENDENCIES_KEY, INJECT_KEY, ON_INIT_KEY } from './const';
import { makeDIToken } from './utils';
import { BaseProviderOptions, DepIdentifier } from './types';
import { DIContainer, registerProvider } from './di-container';


export function Injectable(options: BaseProviderOptions = {}): ClassDecorator {
    return (target: any) => {
        registerProvider({
            ...options,
            useClass: target,
            name: options.name || target.name
        })
    };
}

export function Inject<T>(depNameOrToken: DepIdentifier<T>): PropertyDecorator & ParameterDecorator {
        
    const token = makeDIToken(depNameOrToken);

    return (target: Object, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        
        const registry = DIContainer.INSTANCE;
        
        if (typeof parameterIndex === 'number') {
            
            const existingDependencies = registry.getMetadata({
                key: INJECT_KEY,
                target
            }) || {};

            existingDependencies[parameterIndex] = { token };

            registry.defineMetadata({
                key: INJECT_KEY, 
                value: existingDependencies, 
                target
            });

        } else if (propertyKey !== undefined) {

            const existingDependencies = registry.getMetadata({
                key: DEPENDENCIES_KEY, 
                target
            }) || [];

            existingDependencies.push({ token, propertyKey });

            registry.defineMetadata({
                key: DEPENDENCIES_KEY, 
                value: existingDependencies, 
                target
            });
        }
    };
}

export function OnInit(): MethodDecorator {
    return (target, propertyKey) => {
        DIContainer.INSTANCE.defineMetadata({
            key: ON_INIT_KEY, 
            value: propertyKey, 
            target
        });
    };
}
