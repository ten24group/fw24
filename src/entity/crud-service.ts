import { Schema } from "electrodb";
import { Authorizer } from "../authorize";
import { DefaultEntityOperations, EntityServiceTypeFromSchema, TEntityOpsInputSchemas } from "./base-entity";
import { defaultMetaContainer } from ".";
import { Validator } from "../validation";
import { Logger } from "../logging";
import { Auditor } from "../audit";
import { EventDispatcher } from "../event";

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

    crudType?: keyof DefaultEntityOperations;
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


export interface GetEntityArgs<
    Sch extends Schema<any, any, any>,
    Opp extends DefaultEntityOperations = DefaultEntityOperations,
    OpsSchema extends TEntityOpsInputSchemas<Sch, Opp> = TEntityOpsInputSchemas<Sch, Opp>,
> extends BaseEntityCrudArgs<Sch> {
    id: OpsSchema['get'];
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
        validator = Validator.Default,
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,
            
    } = options;

    logger.debug(`Called EntityCrud ~ getEntity ~ entityName: ${entityName} ~ id:`, id);

    await eventDispatcher.dispatch({event: 'beforeGet', context: arguments });

    const identifiers = entityService.extractEntityIdentifiers(id);

    // TODO: validation

    // authorize the actor
    const authorization = await authorizer.authorize({entityName, crudType, identifiers, actor, tenant});
    if(!authorization.pass){
        throw new Error("Authorization failed for get: " + { cause: authorization });
    }

    // validate
    const validation = await validator.validate({
        operationName: crudType,
        entityValidations: entityService.getEntityValidations(),
        input: identifiers,
        actor: actor
    });

    if(!validation.pass){
        throw new Error("Validation failed for get: " + JSON.stringify({ cause: validation }));
    }

    const entity = await entityService.getRepository().get(identifiers).go();

    await eventDispatcher.dispatch({event: 'afterGet', context: arguments});

    // create audit
    auditLogger.audit({entityName, crudType, identifiers, entity, actor, tenant});

    logger.debug(`Completed EntityCrud ~ getEntity ~ entityName: ${entityName} ~ id:`, id);

    return entity;
}

export interface CreateEntityArgs<
    Sch extends Schema<any, any, any>,
    Opp extends DefaultEntityOperations = DefaultEntityOperations,
    OpsSchema extends TEntityOpsInputSchemas<Sch, Opp> = TEntityOpsInputSchemas<Sch, Opp>,
> extends BaseEntityCrudArgs<Sch> {
    data: OpsSchema['create'];
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
    
    if(!data){
        throw new Error("No data provided for create operation");
    }

    // pre events
    await eventDispatcher?.dispatch({ event: 'beforeCreate', context: arguments });

    // validate
    const validation = await validator.validate({
        operationName: crudType,
        entityValidations: entityService.getEntityValidations(),
        input: data,
        actor: actor,
    });

    if(!validation.pass){
        throw new Error("Validation failed for create: " + JSON.stringify({ cause: validation }));
    }

    // authorize the actor 
    const authorization = await authorizer.authorize({ entityName, crudType, data, actor, tenant });
    if(!authorization.pass){
        throw new Error("Authorization failed for create: " + { cause: authorization });
    }

    logger.debug(`Found entityService:`, !!entityService);

    const repository = entityService.getRepository();

    logger.debug(`Found entityService:repository`, !!repository);
    logger.debug(`Found entityService:repository:schema`, repository.schema);
    logger.debug(`Found entityService:repository:table-name`, repository.getTableName());

    let entity;
    try{
        logger.debug("Calling repository.create data: ", data);
        logger.debug("Calling repository.create params: ", repository.create(data).params() );
        logger.debug("Calling repository.create scan: ", repository.scan.params() );

        // entity = await repository.create(data).go()
        await repository.scan.go()
        .then( res => {
            logger.debug("Calling repository.create then res: ", res);
            return res;
        }).catch(e => {
            logger.debug("Calling repository.create catch e: ", e);
        }).finally(()=>{
            logger.debug("Calling repository.create finally");
        })

    } catch(e){
        
        logger.error("Exception while trying to create the record e: ", e);
    }

    // post events
    await eventDispatcher?.dispatch({ event: 'afterCreate', context: {...arguments, entity} });

    // create audit
    auditLogger.audit({ entityName, crudType, data, entity, actor, tenant});

    // return entity;
    // logger.debug(`Completed EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, data, entity?.data);

    return entity;
}

export interface ListEntityArgs<
    Sch extends Schema<any, any, any>,
    Opp extends DefaultEntityOperations = DefaultEntityOperations,
    OpsSchema extends TEntityOpsInputSchemas<Sch, Opp> = TEntityOpsInputSchemas<Sch, Opp>,
> extends BaseEntityCrudArgs<Sch> {
    filters: OpsSchema['list']; // TODO: filters and pagination
}
/**
 * 
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

export interface UpdateEntityArgs<
    Sch extends Schema<any, any, any>,
    Opp extends DefaultEntityOperations = DefaultEntityOperations,
    OpsSchema extends TEntityOpsInputSchemas<Sch, Opp> = TEntityOpsInputSchemas<Sch, Opp>,
> extends BaseEntityCrudArgs<Sch> {
    id: OpsSchema['get'],
    data: OpsSchema['update'],
    conditions?: any // TODO
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
    
    if(!data){
        throw new Error("No data provided for update operation");
    }

    // pre events
    await eventDispatcher?.dispatch({ event: 'beforeUpdate', context: arguments });

    // validate
    const validation = await validator.validate({
        operationName: crudType,
        entityValidations: entityService.getEntityValidations(),
        input: data,
        actor: actor
    });

    if(!validation.pass){
        throw new Error("Validation failed for update: " + JSON.stringify({ cause: validation }));
    }

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor 
    const authorization = await authorizer.authorize({ entityName, crudType, identifiers, data, actor, tenant });
    if(!authorization.pass){
        throw new Error("Authorization failed for update: " + { cause: authorization });
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

export interface DeleteEntityArgs<
    Sch extends Schema<any, any, any>,
    Opp extends DefaultEntityOperations = DefaultEntityOperations,
    OpsSchema extends TEntityOpsInputSchemas<Sch, Opp> = TEntityOpsInputSchemas<Sch, Opp>,
> extends BaseEntityCrudArgs<Sch> {
    id: OpsSchema['delete'];
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
        validator = Validator.Default,
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,
            
    } = options;

    logger.debug(`Called EntityCrud ~ deleteEntity ~ entityName: ${entityName} ~ id:`, id);

    await eventDispatcher.dispatch({event: 'beforeDelete', context: arguments });

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor
    const authorization = await authorizer.authorize({entityName, crudType, identifiers, actor, tenant});
    if(!authorization.pass){
        throw new Error("Authorization failed for delete: " + { cause: authorization });
    }

    // validate
    const validation = await validator.validate({
        operationName: crudType,
        entityValidations: entityService.getEntityValidations(),
        input: identifiers,
        actor: actor
    });

    if(!validation.pass){
        throw new Error("Validation failed for delete: " + JSON.stringify({ cause: validation }));
    }

    const entity = await entityService.getRepository().delete(identifiers).go();

    await eventDispatcher.dispatch({event: 'afterDelete', context: arguments});

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