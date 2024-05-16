import { BaseEntityService } from "./base-service";

export interface Returns<T> {
  (): T
}

export type ServiceOrFactory<Srv extends BaseEntityService<any>> = Srv | Returns<Srv>;

/**
 *  a container for entity services.
 */
export class MetadataContainer {

    private entityServices: Map<string, ServiceOrFactory<any>> = new Map();
    private entityServicesCache: Map<string, BaseEntityService<any>> = new Map();

    /**
     * Retrieves the entity service by entity name.
     * @param entityName - The name of the entity.
     * @returns The entity service associated with the entity name.
     */
    getEntityServiceByEntityName<Srv extends BaseEntityService<any>>(entityName: string) {
        
        const serviceOrFactory =  this.entityServices.get(entityName);

        if( serviceOrFactory && typeof serviceOrFactory === 'function'){

            if(!this.entityServicesCache.has(entityName)){
                const service = serviceOrFactory();
                this.entityServicesCache.set(entityName, service);
            }

            return this.entityServicesCache.get(entityName) as Srv;
        }

        return serviceOrFactory as Srv;
    }

    /**
     * Checks if an entity service exists for the given entity name.
     * @param entityName - The name of the entity.
     * @returns A boolean indicating whether an entity service exists for the entity name.
     */
    hasEntityServiceByEntityName(entityName: string) {
        return this.entityServices.has(entityName);
    }

    /**
     * Sets the entity service for the given entity name.
     * @param entityName - The name of the entity.
     * @param service - The entity service or factory function.
     */
    setEntityServiceByEntityName<S extends ServiceOrFactory<any>>(entityName: string, service: S) { 
        this.entityServices.set(entityName, service);
    }
}

export const defaultMetaContainer = new MetadataContainer();