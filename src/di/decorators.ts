import { BaseProviderOptions, ClassConstructor, DepIdentifier, DIModuleOptions, InjectOptions } from './types';
import { DIContainer } from './di-container';
import { PartialBy } from '../utils';
import { registerConstructorDependency, registerModuleMetadata, registerOnInitHook, registerPropertyDependency } from './utils';

export function Injectable(
    options:  PartialBy<BaseProviderOptions, 'provide'> = {}, 
    container: DIContainer = DIContainer.ROOT
): ClassDecorator {

    return (constructor: Function) => {
        container.register({
            ...options,
            useClass: constructor as ClassConstructor,
            provide: options.provide || constructor,
        });
    };
}

export function DIModule(options: PartialBy<DIModuleOptions, 'identifier'>): ClassDecorator {
    return function (constructor: Function) {
        registerModuleMetadata(constructor, options);
    };
}

export function Inject<T>(depNameOrToken: DepIdentifier<T>, options: InjectOptions<T> = {}): PropertyDecorator & ParameterDecorator {

    return (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        
        if (typeof parameterIndex === 'number') {

            registerConstructorDependency(target.prototype.constructor, parameterIndex, depNameOrToken, { ...options });

        } else if (propertyKey !== undefined) {

            registerPropertyDependency(
                target.constructor as ClassConstructor, 
                propertyKey, 
                depNameOrToken, 
                { ...options }
            );
        }
    };
}

export function OnInit(): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerOnInitHook(target.constructor as ClassConstructor, propertyKey);
    };
}
