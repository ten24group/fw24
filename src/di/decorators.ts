// decorators.ts

import { PROPERTY_INJECT_KEY, CONSTRUCTOR_INJECT_KEY, ON_INIT_METHOD_KEY } from './const';
import { makeDIToken } from './utils';
import { BaseProviderOptions, DepIdentifier, Token } from './types';
import { DIContainer, registerProvider } from './di-container';


export function Injectable(options: BaseProviderOptions = {}): ClassDecorator {
    return (target: any) => {
        registerProvider({
            ...options,
            useClass: target,
            name: options.name || target.name
        });
    };
}

export type InjectOptions = {
    isOptional?: boolean;
};

export function Inject<T>(depNameOrToken: DepIdentifier<T>, options: InjectOptions = {}): PropertyDecorator & ParameterDecorator {
    const token = makeDIToken(depNameOrToken);

    return (target: Object, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        const registry = DIContainer.INSTANCE;

        if (typeof parameterIndex === 'number') {
            const existingDependencies = registry.getMetadata<{ [key: number]: { token: Token<any>; isOptional?: boolean } }>({
                key: CONSTRUCTOR_INJECT_KEY,
                target: target
            }) || {};

            existingDependencies[parameterIndex] = { ...options, token };

            registry.defineMetadata({
                key: CONSTRUCTOR_INJECT_KEY,
                value: existingDependencies,
                target: target
            });

        } else if (propertyKey !== undefined) {
            const existingDependencies = registry.getMetadata<{ propertyKey: string | symbol; token: Token<any>; isOptional?: boolean }[]>({
                key: PROPERTY_INJECT_KEY,
                target
            }) || [];

            existingDependencies.push({ ...options, token, propertyKey });

            registry.defineMetadata({
                key: PROPERTY_INJECT_KEY,
                value: existingDependencies,
                target
            });
        }
    };
}

export function OnInit(): MethodDecorator {
    return (target, propertyKey) => {
        DIContainer.INSTANCE.defineMetadata({
            key: ON_INIT_METHOD_KEY,
            value: propertyKey,
            target: target
        });
    };
}
