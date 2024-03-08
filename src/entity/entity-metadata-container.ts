import { BaseEntityService } from "./base-service";

export interface Returns<T> {
  (): T
}

export type ServiceOrFactory<Srv extends BaseEntityService<any>> = Srv | Returns<Srv>;

export class MetadataContainer{

    private entityServices: Map<string, ServiceOrFactory<any>> = new Map();
    private entityServicesCache: Map<string, BaseEntityService<any>> = new Map();

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

    hasEntityServiceByEntityName(entityName: string) {
        return this.entityServices.has(entityName);
    }

    setEntityServiceByEntityName<S extends ServiceOrFactory<any>>(entityName: string, service: S) { 
        this.entityServices.set(entityName, service);
    }
}

export const defaultMetaContainer = new MetadataContainer();