import type { PartialBy } from '../../utils/types';
import type { BaseProviderOptions, ClassConstructor, DIModuleOptions, IDIContainer, ProviderOptions } from './../../interfaces/di';
import { getModuleMetadata, registerModuleMetadata } from './';
import { DIContainer } from './../di-container';


export type InjectableOptions = PartialBy<BaseProviderOptions, 'provide'> & {
    providedIn?: 'ROOT' | DIContainer | ClassConstructor;
};

export function tryRegisterInjectable(target: ClassConstructor, options: InjectableOptions){
        
    const optionsCopy: ProviderOptions<any> = {
        ...options,
        useClass: target,
        provide: options.provide || target,
    };

    let container: IDIContainer | undefined;

    if(!options.providedIn || options.providedIn === 'ROOT'){

        container = DIContainer.ROOT;
    } 
    else if(options.providedIn instanceof DIContainer){

        container = options.providedIn!;
    }
    else if(typeof options.providedIn === 'function') {

        // Check if the providedIn is a class constructor
        const moduleMetadata = getModuleMetadata(options.providedIn) as DIModuleOptions | undefined;
        
        if (!moduleMetadata) {
            throw new Error(
                `Invalid providedIn option for ${target.name}. Ensure the class is decorated with @DIModule({...}).`
            );
        }

        moduleMetadata.providers = [...(moduleMetadata.providers || []), optionsCopy];
        
        registerModuleMetadata(options.providedIn, moduleMetadata, true);

        container = moduleMetadata.container;
    }

    if(container){
        container.register(optionsCopy);
    } else {

        throw new Error(
            `Invalid providedIn option for ${target.name}. Ensure it is either "ROOT" or an instance of DI-container or a class decorated with @DIModule({...}).`
        );
    }
}