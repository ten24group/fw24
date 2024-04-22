import { Schema } from "electrodb";
import { Authorizer } from "../authorize";
import { TDefaultEntityOperations, EntitySchema, EntityServiceTypeFromSchema, TEntityOpsInputSchemas } from "./base-entity";
import { defaultMetaContainer } from ".";
import { DefaultValidator, IValidator } from "../validation";
import { Auditor } from "../audit";
import { EventDispatcher } from "../event";
import { ILogger, createLogger } from "../logging";
import { removeEmpty } from "../utils";

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

export interface BaseEntityCrudArgs<S extends EntitySchema<any, any, any>> {
    entityName: string;
    entityService?: EntityServiceTypeFromSchema<S>;

    crudType?: keyof TDefaultEntityOperations;
    actor?: any; // todo: define actor context: [ User+Tenant OR System on behalf of some User+Tenant] trying to perform the operation
    tenant?: any; // todo: define tenant context

    logger?: ILogger;
    validator?: IValidator;        // todo: define validator signature
    authorizer?: Authorizer.IAuthorizer;        // todo: define authorizer signature
    auditLogger?: Auditor.IAuditor;       // todo: define audit logger signature
    eventDispatcher?: EventDispatcher.IEventDispatcher;  // todo define event dispatcher signature

    // input/output OR serializer/sanitizer ?: any; // todo: define serializer/sanitizer signature [maybe it should be the part of entity-model or controller]
    // telemetry
}


export interface GetEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    id: OpsSchema['get'];
}

export async function getEntity<S extends EntitySchema<any, any, any>>( options: GetEntityArgs<S>){

    const { 
        id,
        entityName, 
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 
        
        actor,
        tenant,
        
        crudType = 'get',
        logger = createLogger('CRUD-service:getEntity'),
        validator = DefaultValidator,
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
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
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
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    data: OpsSchema['create'];
}
export async function createEntity<S extends EntitySchema<any, any, any>>(options : CreateEntityArgs<S>) {
    const { 
        data,
        entityName, 
        
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 
        
        actor,
        tenant,
        
        crudType = 'create',
        logger = createLogger('CRUD-service:createEntity'),
        validator = DefaultValidator,
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
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
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

    const entity = await entityService.getRepository().create(data).go();

    // post events
    await eventDispatcher?.dispatch({ event: 'afterCreate', context: {...arguments, entity} });

    // create audit
    auditLogger.audit({ entityName, crudType, data, entity, actor, tenant});

    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, data, entity.data);

    return entity;
}

export type Pagination = {
    limit?: number;
    count?: number;
    pages?: number | 'all';
    pager?: 'raw' | 'cursor',
    order?: 'asc' | 'desc';
    cursor?: string,
}

export interface ListEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    filters: OpsSchema['list']; // TODO: filters and pagination
    attributes?: string[];
    pagination?: Pagination
}
/**
 * 
 * @param options 
 * 
 * @returns 
 */
export async function listEntity<S extends EntitySchema<any, any, any>>( options: ListEntityArgs<S>){

    const { 
        entityName, 
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 

        actor,
        tenant,

        crudType = 'list',
        logger = createLogger('CRUD-service:listEntity'),
        authorizer = Authorizer.Default,
        auditLogger = Auditor.Default,
        eventDispatcher = EventDispatcher.Default,

        filters = {},
        pagination = {
            order: 'asc',
            pager: 'cursor',
            cursor: null,
            count: 25,
            pages: undefined,
            limit: undefined,
        }
    } = options;

    logger.debug(`Called EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);

    await eventDispatcher.dispatch({event: 'beforeList', context: arguments });

    // authorize the actor
    const authorization = await authorizer.authorize({entityName, crudType, actor, tenant});
    if(!authorization.pass){
        throw new Error("Authorization failed: " + { cause: authorization });
    }

    const entities = await entityService.getRepository()
    .match(
        removeEmpty(filters)
    )
    // .where((attr, op) => {

    //     // TODO: add support for custom where clauses
    //     // when the query is not for specific attribute-values
    //     // ${op.eq(attr.cityId, "Atlanta1")} AND ${op.contains(attr.category, "food")}
    //     // const {} = attr;
    //     // const {eq, ne, gt, gte, lt, lte, between, begins, exists, notExists, contains, notContains, value, name, size, type, field, escape } = op;
        
    //     return ``;
    // })
    .go(
        removeEmpty(pagination)
    );

    await eventDispatcher.dispatch({ event: 'afterList', context: arguments });

    // create audit
    auditLogger.audit({ entityName, crudType, entities, actor, tenant });

    logger.debug(`Completed EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);

    return entities;
}

export interface UpdateEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    id: OpsSchema['get'],
    data: OpsSchema['update'],
    conditions?: any // TODO
}

export async function updateEntity<S extends EntitySchema<any, any, any>>(options : UpdateEntityArgs<S>) {
    const { 
        id,
        data,
        entityName, 

        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 

        actor,
        tenant,

        crudType = 'update',
        logger = createLogger('CRUD-service:updateEntity'),
        validator = DefaultValidator,
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
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
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
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    id: OpsSchema['delete'];
}

export async function deleteEntity<S extends EntitySchema<any, any, any>>( options: DeleteEntityArgs<S>){

    const { 
        id,
        entityName, 
        entityService = defaultMetaContainer.getEntityServiceByEntityName<EntityServiceTypeFromSchema<S>>(entityName), 

        actor,
        tenant,

        crudType = 'delete',
        logger = createLogger('CRUD-service:deleteEntity'),
        validator = DefaultValidator,
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
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
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