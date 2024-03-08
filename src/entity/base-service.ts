import { EntityConfiguration, Schema } from "electrodb";
import { CreateEntityItemTypeFromSchema, EntityIdentifiersTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, UpdateEntityItemTypeFromSchema, createElectroDBEntity } from "./base-entity";
import { createEntity, deleteEntity, getEntity, listEntity, updateEntity } from "./crud-service";

export abstract class BaseEntityService<S extends Schema<any, any, any>>{

    protected entityRepository ?: EntityRepositoryTypeFromSchema<S>;

    constructor(
        protected readonly schema: S,
        protected readonly entityConfigurations: EntityConfiguration,
    ){
        return this;
    }

    public getEntityName(): S['model']['entity'] { return this.schema.model.entity; }
    
    public getEntitySchema(): S { return this.schema;}

    public getRepository(){

        if(!this.entityRepository){
            const {entity} = createElectroDBEntity({ 
                schema: this.getEntitySchema(), 
                entityConfigurations: this.entityConfigurations 
            });
            this.entityRepository = entity as EntityRepositoryTypeFromSchema<S>;
        }

        return this.entityRepository!;
    }


    /**
     * return an object containing all the required attributes/values to fulfill an index
     * e.g. entityId, tenantId, partition-keys.... etc
     * this will be used by the BaseEntityService to find the right entity for get/update/delete operations
     * 
     * @param options
     * @returns object containing all the required attributes/values to fulfill an index
     * e.g. 
     * IN   ==> `Request` object with headers, body, auth-context etc
     * OUT  ==> { tenantId: xxx, email: xxx@yyy.com, some-partition-key: xx-yy-zz }
     *
     *  */ 
    abstract extractEntityIdentifiers(options: any ): EntityIdentifiersTypeFromSchema<S>;

    /**
     * 
     * helper function to return all the attributes that can be used to find an entity 
     * [i.e. combo of primary-key attributes and secondary-key attributes for all indexes]
     * 
     */
    abstract getFilterAttributes(): any;
    abstract getValidationRules( options: { opContext: 'update' | 'delete' | 'process' } ): any;
    abstract getPermissionRules( options: { opContext: 'update' | 'delete' | 'process' } ): any;

    public async get( identifiers: EntityIdentifiersTypeFromSchema<S> ) {
        console.log(`Called BaseEntityService<E ~ get ~ entityName: ${this.getEntityName()} ~ id:`, identifiers);

        const entity =  await getEntity<S>({
            id: identifiers, 
            entityName: this.getEntityName(),
        });

        return entity?.data;
    }
    
    public async create(data: CreateEntityItemTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ create ~ entityName: ${this.getEntityName()} ~ data:`, data);

        const entity =  await createEntity<S>({
            data: data, 
            entityName: this.getEntityName(),  
        });

        return entity;
    }

    public async list(data: EntityIdentifiersTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ list ~ entityName: ${this.getEntityName()} ~ data:`, data);

        const entities =  await listEntity<S>({
            filters: data,
            entityName: this.getEntityName(),  
        });

        return entities;
    }

    public async update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ update ~ entityName: ${this.getEntityName()} ~ identifiers:, data:`, identifiers, data);

        const updatedEntity =  await updateEntity<S>({
            id: identifiers,
            data: data, 
            entityName: this.getEntityName(),  
        });

	    return updatedEntity;
    }

    public async delete(identifiers: EntityIdentifiersTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);
        
        const deletedEntity =  await deleteEntity<S>({
            id: identifiers,
            entityName: this.getEntityName(),  
        });

        return deletedEntity;
    }
}

