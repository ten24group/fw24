import type { ClassConstructor, DepIdentifier, InjectOptions } from './../interfaces/di';
import { DIContainer } from './container';
import { registerConstructorDependency, RegisterDIModuleMetadataOptions, registerModuleMetadata, registerOnInitHook, registerPropertyDependency } from './metadata';
import { setupDIModule } from './utils/setupDIModule';

import { tryRegisterInjectable, type InjectableOptions } from './utils/tryRegisterInjectable';

export function Injectable( options: InjectableOptions = { providedIn: 'ROOT' }): ClassDecorator {
    return (constructor: Function) => {
        tryRegisterInjectable(constructor as ClassConstructor, options);
    };
}

export function DIModule(options: RegisterDIModuleMetadataOptions): ClassDecorator {
    return function (constructor: Function) {
        registerModuleMetadata(constructor, options);

        // if module metadata has a providedBy option, then make sure to register the container into the providedBy module/container
        if(options.providedBy){
            setupDIModule({
                target: constructor as ClassConstructor, 
                module: options,
                fallbackToRootContainer: false
            });
        }
    };
}

export function Inject<T>(dependencyToken: DepIdentifier<T>, options: InjectOptions<T> = {}): PropertyDecorator & ParameterDecorator {

    return (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        
        if (typeof parameterIndex === 'number') {

            registerConstructorDependency(target.prototype.constructor, parameterIndex, dependencyToken, { ...options });

        } else if (propertyKey !== undefined) {

            registerPropertyDependency(
                target.constructor as ClassConstructor, 
                propertyKey, 
                dependencyToken, 
                { ...options }
            );
        }
    };
}


// Special decorator for injecting the container itself
export function InjectContainer(): PropertyDecorator & ParameterDecorator {
    return (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        if (typeof parameterIndex === 'number') {
            registerConstructorDependency(target.prototype.constructor, parameterIndex, DIContainer, {});
        } else if (propertyKey !== undefined) {
            registerPropertyDependency(
                target.constructor as ClassConstructor,
                propertyKey,
                DIContainer,
            );
        }
    };
}

// Special decorator for injecting configuration paths
export function InjectConfig(configPath: string, options: InjectOptions<any> = {}): PropertyDecorator & ParameterDecorator {
    return (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        if (typeof parameterIndex === 'number') {
            registerConstructorDependency(target.prototype.constructor, parameterIndex, configPath, { ...options, isConfig: true });
        } else if (propertyKey !== undefined) {
            registerPropertyDependency(
                target.constructor as ClassConstructor,
                propertyKey,
                configPath,
                { ...options, isConfig: true }
            );
        }
    };
}

export function OnInit(): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerOnInitHook(target.constructor as ClassConstructor, propertyKey);
    };
}

