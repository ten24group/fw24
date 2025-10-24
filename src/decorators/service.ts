import 'reflect-metadata';
import type { ClassConstructor } from './../interfaces/di';
import { tryRegisterInjectable, type InjectableOptions } from './../di/utils/tryRegisterInjectable';
import { METADATA_KEYS, type ServiceMetadata } from '../manifest/metadata-keys';

export function Service(options: InjectableOptions = {} ): ClassDecorator {
    return (constructor: Function) => {
        tryRegisterInjectable(constructor as ClassConstructor, {
            ...options, 
            type: 'service'
        });

        // Store comprehensive service metadata using reflect-metadata
        const serviceMetadata: ServiceMetadata = {
            className: constructor.name,
            forEntity: typeof options.forEntity === 'string' ? options.forEntity : undefined,
            priority: options.priority || 0,
            providedIn: typeof options.providedIn === 'string' ? options.providedIn : options.providedIn?.constructor?.name || 'ROOT',
            tags: options.tags || [],
            kind: 'service'
        };

        Reflect.defineMetadata(METADATA_KEYS.SERVICE, serviceMetadata, constructor);
        
        console.log(`[Service] Stored metadata for service: ${constructor.name}`);
    };
}