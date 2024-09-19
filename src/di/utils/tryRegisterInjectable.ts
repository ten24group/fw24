import type { PartialBy } from '../../utils/types';
import type { BaseProviderOptions, ClassConstructor, IDIContainer, ProviderOptions } from './../../interfaces/di';
import { getModuleMetadata } from '../metadata';
import { DIContainer } from './../container';
import { DefaultLogger } from '../../logging';


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
    let diContainerHasBeenInitialized = true;

    if(!options.providedIn || options.providedIn === 'ROOT'){

        container = DIContainer.ROOT;
    } 
    else if(options.providedIn instanceof DIContainer){

        container = options.providedIn!;
    }
    else if(typeof options.providedIn === 'function') {

        // Check if the providedIn is a class constructor
        const moduleMetadata = getModuleMetadata(options.providedIn);
        
        if (!moduleMetadata) {
            throw new Error(
                `Invalid providedIn option for ${target.name}. No module metadata found for ${options.providedIn.name}; ensure the class is decorated with @DIModule({...}).`
            );
        }

        moduleMetadata.addProvider(optionsCopy);
        
        diContainerHasBeenInitialized = !!moduleMetadata.container;

        container = moduleMetadata.container;
    }

    if(container){
        
        try {
            container.register(optionsCopy);
        } catch (error) {
            DefaultLogger.error(`tryRegisterInjectable:: Error registering ${target.name} with container:`, container);
            throw error;
        }

    } else if(diContainerHasBeenInitialized) {

        throw new Error(
            `Invalid providedIn option for ${target.name}, no container could be resolved. Ensure it is either 'ROOT' or an instance of DI-container or a class decorated with @DIModule({...}).`
        );
    }
}