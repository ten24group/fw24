import { BaseProviderOptions, ClassConstructor, DepIdentifier, DIModuleOptions, InjectOptions, ProviderOptions } from './types';
import { DIContainer } from './di-container';
import { PartialBy } from '../utils';
import { getModuleMetadata, registerConstructorDependency, RegisterDIModuleMetadataOptions, registerModuleMetadata, registerOnInitHook, registerPropertyDependency } from './utils';

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
