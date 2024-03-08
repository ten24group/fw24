import { Schema } from "electrodb";
import { Authorizer } from "../authorize";
import { CreateEntityItemTypeFromSchema, EntityIdentifiersTypeFromSchema, EntityServiceTypeFromSchema, UpdateEntityItemTypeFromSchema } from "./base-entity";
import { defaultMetaContainer } from ".";
import { Validator } from "../validation";
import { Logger } from "../logging";
import { Auditor } from "../audit";
import { EventDispatcher } from "../event";

export type CRUD = 'create' | 'get' | 'update' | 'delete' | 'list';

/**
 * 
 * Serializer/formatter
 *  - https://github.com/dkzlv/micro-transform
 *  
 * Event dispatcher
 * - https://github.com/FoxAndFly/ts-event-dispatcher/blob/master/src/index.ts
 * - https://github.com/ryardley/ts-bus
 * - https://github.com/binier/tiny-typed-emitter/tree/master
 * 
 * Router
 * - https://github.com/berstend/tiny-request-router/blob/master/src/router.ts
 * 
 * DI
 * - https://github.com/nicojs/typed-inject
 * - https://github.com/microsoft/tsyringe
 * - https://github.com/owja/ioc
 * 
 * 
 */

export interface BaseEntityCrudArgs<S extends Schema<any, any, any>> {
    entityName: string;
    entityService?: EntityServiceTypeFromSchema<S>;

    crudType?: CRUD;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    actor?: any; // todo: define actor context: [ User+Tenant OR System on behalf of some User+Tenant] trying to perform the operation
    tenant?: any; // todo: define tenant context

    logger?: Logger.ILogger;
    validator?: Validator.IValidator;        // todo: define validator signature
    authorizer?: Authorizer.IAuthorizer;        // todo: define authorizer signature
    auditLogger?: Auditor.IAuditor;       // todo: define audit logger signature
    eventDispatcher?: EventDispatcher.IEventDispatcher;  // todo define event dispatcher signature

    // input/output OR serializer/sanitizer ?: any; // todo: define serializer/sanitizer signature [maybe it should be the part of entity-model or controller]
    // telemetry
}


export interface GetEntityArgs<S extends Schema<any, any, any>> extends BaseEntityCrudArgs<S> {
    id: EntityIdentifiersTypeFromSchema<S>;
}

export async function getEntity<S extends Schema<any, any, any>>( options: GetEntityArgs<S>){

    const { 
        id,
        entityName, 
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 
        
        actor,
        tenant,
        
        crudType = 'get',
        logger = Logger.Default,
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,
            
    } = options;

    logger.debug(`Called EntityCrud ~ getEntity ~ entityName: ${entityName} ~ id:`, id);

    await eventDispatcher.dispatch({event: 'beforeGet', context: arguments });

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor
    const authorization = await authorizer.authorize({entityName, crudType, identifiers, actor, tenant});
    if(!authorization.pass){
        throw new Error("Authorization failed: " + { cause: authorization });
    }

    const entity = await entityService.getRepository().get(identifiers).go();

    await eventDispatcher.dispatch({event: 'afterGet', context: arguments});

    // create audit
    auditLogger.audit({entityName, crudType, identifiers, entity, actor, tenant});

    logger.debug(`Completed EntityCrud ~ getEntity ~ entityName: ${entityName} ~ id:`, id);

    return entity;
}

export interface CreateEntityArgs<S extends Schema<any, any, any>> extends BaseEntityCrudArgs<S> {
    data: CreateEntityItemTypeFromSchema<S>
}
export async function createEntity<S extends Schema<any, any, any>>(options : CreateEntityArgs<S>) {
    const { 
        data,
        entityName, 
        
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 
        
        actor,
        tenant,
        
        crudType = 'create',
        logger = Logger.Default,
        validator = Validator.Default,
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,

    } = options;

    logger.debug(`Called EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, data);
    
    // pre events
    await eventDispatcher?.dispatch({ event: 'beforeCreate', context: arguments });

    // validate
    const validation = await validator.validate({entityName, crudType, data });
    if(!validation.pass){
        throw new Error("Validation failed: " + { cause: validation });
    }

    // authorize the actor 
    const authorization = await authorizer.authorize({ entityName, crudType, data, actor, tenant });
    if(!authorization.pass){
        throw new Error("Authorization failed: " + { cause: authorization });
    }

    const entity = await entityService.getRepository().create(data).go();

    // post events
    await eventDispatcher?.dispatch({ event: 'afterCreate', context: {...arguments, entity} });

    // create audit
    auditLogger.audit({ entityName, crudType, data, entity, actor, tenant});

    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, data, entity.data);

    return entity;
}

export interface ListEntityArgs<S extends Schema<any, any, any>> extends BaseEntityCrudArgs<S> {
    filters: EntityIdentifiersTypeFromSchema<S>;
}
/**
 * 
 * TODO; Filters, Paging etc
 * @param options 
 * 
 * @returns 
 */
export async function listEntity<S extends Schema<any, any, any>>( options: ListEntityArgs<S>){

    const { 
        entityName, 
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 

        actor,
        tenant,

        crudType = 'list',
        logger = Logger.Default,
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,
            
    } = options;

    logger.debug(`Called EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);

    await eventDispatcher.dispatch({event: 'beforeList', context: arguments });

    // authorize the actor
    const authorization = await authorizer.authorize({entityName, crudType, actor, tenant});
    if(!authorization.pass){
        throw new Error("Authorization failed: " + { cause: authorization });
    }

    const entities = await entityService.getRepository().scan.go();

    await eventDispatcher.dispatch({ event: 'afterList', context: arguments });

    // create audit
    auditLogger.audit({ entityName, crudType, entities, actor, tenant });

    logger.debug(`Completed EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);

    return entities;
}

export interface UpdateEntityArgs<S extends Schema<any, any, any>> extends BaseEntityCrudArgs<S> {
    id: EntityIdentifiersTypeFromSchema<S>,
    data: UpdateEntityItemTypeFromSchema<S>
}
export async function updateEntity<S extends Schema<any, any, any>>(options : UpdateEntityArgs<S>) {
    const { 
        id,
        data,
        entityName, 

        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 

        actor,
        tenant,

        crudType = 'update',
        logger = Logger.Default,
        validator = Validator.Default,
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,

    } = options;

    logger.debug(`Called EntityCrudService<E ~ update ~ entityName: ${entityName} ~ data:`, data);
    
    // pre events
    await eventDispatcher?.dispatch({ event: 'beforeUpdate', context: arguments });

    // validate
    const validation = await validator.validate({entityName, crudType, data });
    if(!validation.pass){
        throw new Error("Validation failed: " + { cause: validation });
    }

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor 
    const authorization = await authorizer.authorize({ entityName, crudType, identifiers, data, actor, tenant });
    if(!authorization.pass){
        throw new Error("Authorization failed: " + { cause: authorization });
    }

    const entity = await entityService.getRepository().patch(identifiers).set(data).go();

    // post events
    await eventDispatcher?.dispatch({ event: 'afterUpdate', context: {...arguments, entity} });

    // create audit
    auditLogger.audit({ entityName, crudType, data, entity, actor, tenant});

    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ update ~ entityName: ${entityName} ~ data:`, data, entity.data);

    return entity;
}

export interface DeleteEntityArgs<S extends Schema<any, any, any>> extends BaseEntityCrudArgs<S> {
    id: EntityIdentifiersTypeFromSchema<S>;
}
export async function deleteEntity<S extends Schema<any, any, any>>( options: DeleteEntityArgs<S>){

    const { 
        id,
        entityName, 
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 

        actor,
        tenant,

        crudType = 'delete',
        logger = Logger.Default,
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,
            
    } = options;

    logger.debug(`Called EntityCrud ~ deleteEntity ~ entityName: ${entityName} ~ id:`, id);

    await eventDispatcher.dispatch({event: 'beforeGet', context: arguments });

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor
    const authorization = await authorizer.authorize({entityName, crudType, identifiers, actor, tenant});
    if(!authorization.pass){
        throw new Error("Authorization failed: " + { cause: authorization });
    }

    const entity = await entityService.getRepository().delete(identifiers).go();

    await eventDispatcher.dispatch({event: 'afterGet', context: arguments});

    // create audit
    auditLogger.audit({entityName, crudType, identifiers, entity, actor, tenant});

    logger.debug(`Completed EntityCrud ~ deleteEntity ~ entityName: ${entityName} ~ id:`, id);

    return entity;
}

// export class EntityCrudService<S extends Schema<any, any, any>>{

//     public async list(options: ListEntityArgs<S>) {
//         return await listEntity(options);
//     }

//     public async create(options: CreateEntityArgs<S>) {
//         return await createEntity(options);
//     }

//     public async update(options: UpdateEntityArgs<S>) {
//         return await updateEntity(options);
//     }

//     public async get(options: GetEntityArgs<S>) {
//         return await getEntity(options);
//     }

//     public async delete(options: DeleteEntityArgs<S>) {
//         return await deleteEntity(options);
//     }
// }


// export const DefaultEntityCrudService = new EntityCrudService();