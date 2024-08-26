import type { BaseProviderOptions, ClassConstructor, DepIdentifier, DIModuleOptions, InjectOptions, ProviderOptions } from './types';
import type { PartialBy } from '../utils';
import { DIContainer } from './di-container';
import { getModuleMetadata, registerConstructorDependency, RegisterDIModuleMetadataOptions, registerModuleMetadata, registerOnInitHook, registerPropertyDependency } from './utils';
import { setupDIModule } from './utils/setupDIModule';

export type InjectableOptions = PartialBy<BaseProviderOptions, 'provide'> & {
    providedIn?: 'ROOT' | ClassConstructor;
};

export function Injectable(
    options: InjectableOptions = { providedIn: 'ROOT' },
    container?: DIContainer
): ClassDecorator {
    return (constructor: Function) => {

        container = container || DIContainer.ROOT;

        const optionsCopy: ProviderOptions<any> = {
            ...options,
            useClass: constructor as ClassConstructor,
            provide: options.provide || constructor,
        };

        if(!options.providedIn){
            container.register(optionsCopy);
            return;
        }

        if( options.providedIn === 'ROOT'){
            DIContainer.ROOT.register(optionsCopy);
            return;
        } 
        
        if(typeof options.providedIn === 'function') {

            // Check if the providedIn is a class constructor
            const moduleMetadata = getModuleMetadata(options.providedIn) as DIModuleOptions | undefined;
            
            if (!moduleMetadata) {
                throw new Error(
                    `Invalid providedIn option for ${constructor.name}. Ensure the class is decorated with @DIModule({...}).`
                );
            }

            moduleMetadata.providers = [...(moduleMetadata.providers || []), optionsCopy];

            // handle dynamically loaded providers after module has been registered
            if(moduleMetadata.container){
                moduleMetadata.container.register(optionsCopy);
            }

            registerModuleMetadata(options.providedIn, moduleMetadata, true);

        } else {

            throw new Error(
                `Invalid providedIn option for ${constructor.name}. Ensure it is either "ROOT" or a class decorated with @DIModule({...}).`
            );
        }
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
