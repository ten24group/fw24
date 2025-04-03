import type { EntityResponseItemTypeFromSchema, EntitySchema, EntityServiceTypeFromSchema, TDefaultEntityOperations, TEntityOpsInputSchemas } from "./base-entity";
import type { EntityQuery } from "./query-types";
import { IAuditLogger, NullAuditLogger } from "../audit";
import { Authorizer } from "../authorize";
import { EventDispatcher } from "../event";
import { ILogger, createLogger } from "../logging";
import { isEmptyObject, removeEmpty } from "../utils";
import { DefaultValidator, type IValidator } from "../validation";
import { entityFilterCriteriaToExpression } from "./query";
import { EntityValidationError } from "./errors/validation-error";

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
    entityService: EntityServiceTypeFromSchema<S>;

    crudType?: keyof TDefaultEntityOperations;
    actor?: any; // todo: define actor context: [ User+Tenant OR System on behalf of some User+Tenant] trying to perform the operation
    tenant?: any; // todo: define tenant context

    logger?: ILogger;
    validator?: IValidator;
    authorizer?: Authorizer.IAuthorizer;        // todo: define authorizer signature
    auditLogger?: IAuditLogger;       // todo: define audit logger signature
    eventDispatcher?: EventDispatcher.IEventDispatcher;  // todo define event dispatcher signature

    // telemetry
}

/**
 * Represents the arguments for retrieving an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface GetEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    /**
     * The ID of the entity to retrieve.
     */
    id: OpsSchema[ 'get' ];
    /**
     * Optional array of attributes to include in the retrieved entity.
     */
    attributes?: Array<string>;
}

/**
 * Retrieves an entity based on the provided options.
 * @param options - The options for retrieving the entity.
 * @returns The retrieved entity.
 */
export async function getEntity<S extends EntitySchema<any, any, any>>(options: GetEntityArgs<S>) {

    const {
        id,
        attributes,
        entityName,
        entityService,

        actor,
        tenant,

        crudType = 'get',
        logger = createLogger('CRUD-service:getEntity'),
        validator = DefaultValidator,
        authorizer = Authorizer.Default,
        auditLogger = NullAuditLogger,
        eventDispatcher = EventDispatcher.Default,

    } = options;

    logger.debug(`Called EntityCrud ~ getEntity ~ entityName: ${entityName}:`, { id, attributes });

    // await eventDispatcher.dispatch({event: 'beforeGet', context: arguments });

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor
    // const authorization = await authorizer.authorize({entityName, crudType, identifiers, actor, tenant});
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for get: " + { cause: authorization });
    // }


    // // validate
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: identifiers,
        actor: actor
    });

    if (!validation.pass) {
        throw new EntityValidationError(validation.errors);
    }

    const entity = await entityService.getRepository().get(identifiers).go({ attributes });

    // await eventDispatcher.dispatch({event: 'afterGet', context: arguments});

    // create audit
    // auditLogger.audit({entityName, crudType, identifiers, entity, actor, tenant});

    logger.debug(`Completed EntityCrud ~ getEntity ~ entityName: ${entityName} ~ id:`, id);

    return entity;
}

/**
 * Represents the arguments for creating an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface CreateEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    /**
     * The data for creating the entity.
     */
    data: OpsSchema[ 'create' ];
}

export type CreateEntityResponse<Sch extends EntitySchema<any, any, any>> = {
    data?: EntityResponseItemTypeFromSchema<Sch>
}

/**
 * Creates an entity using the provided options.
 * 
 * @param options - The options for creating the entity.
 * @returns The created entity.
 * @throws Error if no data is provided for create operation, validation fails, or authorization fails.
 */
export async function createEntity<S extends EntitySchema<any, any, any>>(options: CreateEntityArgs<S>): Promise<CreateEntityResponse<S>> {
    const {
        data,
        entityName,
        entityService,

        actor,
        tenant,

        crudType = 'create',
        logger = createLogger('CRUD-service:createEntity'),
        validator = DefaultValidator,
        authorizer = Authorizer.Default,
        auditLogger = NullAuditLogger,
        eventDispatcher = EventDispatcher.Default,

    } = options;

    logger.debug(`Called EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, data);

    if (!data) {
        throw new Error("No data provided for create operation");
    }

    // pre events
    // await eventDispatcher?.dispatch({ event: 'beforeCreate', context: arguments });

    // validate
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: data,
        actor: actor,
    });

    if (!validation.pass) {
        throw new EntityValidationError(validation.errors);
    }

    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, data, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for create: " + { cause: authorization });
    // }

    const entity = await entityService.getRepository().create(data).go();

    // post events
    // await eventDispatcher?.dispatch({ event: 'afterCreate', context: {...arguments, entity} });

    // create audit
    // auditLogger.audit({});

    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, data, entity.data);

    return entity as CreateEntityResponse<S>;
}


/**
 * Represents the arguments for creating-OR-updating an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface UpsertEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    /**
     * The data for creating the entity.
     */
    data: OpsSchema[ 'upsert' ];
}

export type UpsertEntityResponse<Sch extends EntitySchema<any, any, any>> = {
    data?: EntityResponseItemTypeFromSchema<Sch>
}

/**
 * Creates an entity using the provided options.
 * 
 * @param options - The options for creating-OR-updating the entity.
 * @returns The created entity.
 * @throws Error if no data is provided for upsert operation, validation fails, or authorization fails.
 */
export async function upsertEntity<S extends EntitySchema<any, any, any>>(options: UpsertEntityArgs<S>): Promise<UpsertEntityResponse<S>> {
    const {
        data,
        entityName,
        entityService,

        actor,
        tenant,

        crudType = 'upsert',
        logger = createLogger('CRUD-service:upsertEntity'),
        validator = DefaultValidator,
        authorizer = Authorizer.Default,
        auditLogger = NullAuditLogger,
        eventDispatcher = EventDispatcher.Default,

    } = options;

    logger.debug(`Called EntityCrudService<E ~ upsert ~ entityName: ${entityName} ~ data:`, data);

    if (!data) {
        throw new Error("No data provided for upsert operation");
    }

    // pre events
    // await eventDispatcher?.dispatch({ event: 'beforeUpsert', context: arguments });

    // validate
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: data,
        actor: actor,
    });

    if (!validation.pass) {
        throw new EntityValidationError(validation.errors);
    }

    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, data, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for upsert: " + { cause: authorization });
    // }

    const entity = await entityService.getRepository().upsert(data as any).go();

    // post events
    // await eventDispatcher?.dispatch({ event: 'afterUpsert', context: {...arguments, entity} });

    // create audit
    // auditLogger.audit({ entityName, crudType, data, entity, actor, tenant});

    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ upsert ~ entityName: ${entityName} ~ data:`, data, entity.data);

    return entity as UpsertEntityResponse<S>;
}

/**
 * Represents the arguments for listing entities.
 * @template Sch - The entity schema type.
 */
export interface ListEntityArgs<Sch extends EntitySchema<any, any, any>> extends BaseEntityCrudArgs<Sch> {
    query: EntityQuery<Sch>
}

/**
 * Finds a matching index based on the provided filters and schema.
 * @param schema - The entity schema
 * @param filters - The filters to match against
 * @param entityName - The name of the entity
 * @param entityService - The entity service
 * @returns The name of the matching index and the filters used to match it or undefined if no match is found
 */
export function findMatchingIndex(
    schema: EntitySchema<any, any, any>, 
    filters: Record<string, any> | undefined,
    entityName: string,
    entityService: EntityServiceTypeFromSchema<any>
): { indexName: string; indexFilters: Record<string, any> } | undefined {
    const logger = createLogger('CRUD-service:findMatchingIndex');
    if (!filters) filters = {};

    // First try ElectroDB's index matching
    const repository = entityService.getRepository();
    const { keys, index, shouldScan } = (repository as any)._findBestIndexKeyMatch(filters);

    logger.debug(`Found ElectroDB index: ${index} with ${keys.length} attribute matches for entity: ${entityName} with filters and scan: ${shouldScan} - `, keys, filters);
    
    // If we found a matching index, use it
    if (!shouldScan) {
        const indexFilters: Record<string, any> = {};
        
        // Add matched keys to indexFilters
        keys.forEach((key: { name: string; type: string }) => {
            const filterValue = filters![key.name];
            if (filterValue) {
                // Handle both { eq: value } and direct value formats
                indexFilters[key.name] = filterValue.eq !== undefined ? filterValue.eq : filterValue;
            }
        });

        // Map ElectroDB's internal index name back to our schema's index name
        let schemaIndexName = index;
        if (index === '') {
            schemaIndexName = 'primary';
        } else {
            // Find the index in our schema that matches this GSI
            const indexes = schema.indexes;
            for (const [name, indexDef] of Object.entries(indexes)) {
                if (indexDef.index === index) {
                    schemaIndexName = name;
                    break;
                }
            }
        }

        logger.debug(`Using ElectroDB matched index: ${schemaIndexName} (internal: ${index}) with ${keys.length} attribute matches for entity: ${entityName} with filters:`, indexFilters);
        return { indexName: schemaIndexName, indexFilters };
    }

    // If no index match found, check for template match
    const indexes = schema.indexes;
    for (const [indexName, indexDef] of Object.entries(indexes)) {
        if (indexDef.pk.template && 
            typeof indexDef.pk.template === 'string' && 
            indexDef.pk.template.toLowerCase() === entityName.toLowerCase()) {
            logger.debug(`Using template matching index: ${indexName} for entity: ${entityName}`);
            return { 
                indexName, 
                indexFilters: {}
            };
        }
    }

    return undefined;
}

/**
 * Retrieves a list of entities based on the provided options.
 *
 * @param options - The options for listing entities.
 * @returns A promise that resolves to an array of entities.
 */
export async function listEntity<S extends EntitySchema<any, any, any>>(options: ListEntityArgs<S>) {

    const {
        entityName,
        entityService,

        actor,
        tenant,

        crudType = 'list',
        logger = createLogger('CRUD-service:listEntity'),
        authorizer = Authorizer.Default,
        auditLogger = NullAuditLogger,
        eventDispatcher = EventDispatcher.Default,

        query = {},
    } = options;

    const {
        filters = {},
        pagination = { order: 'asc', pager: 'cursor', cursor: null, count: 25, pages: undefined, limit: undefined },
    } = query;

    logger.debug(`Called EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);

    // await eventDispatcher.dispatch({event: 'beforeList', context: arguments });
    
    // authorize the actor
    // const authorization = await authorizer.authorize({entityName, crudType, actor, tenant});
    // if(!authorization.pass){
    //     throw new Error("Authorization failed: " + { cause: authorization });
    // }

    // Check if we have a filter that matches an index
    const schema = entityService.getEntitySchema();
    const matchResult = findMatchingIndex(schema, filters, entityName, entityService);
    logger.debug(`Match result:`, matchResult);
    // Use the appropriate index if available
    const repository = entityService.getRepository();
    
    let entities;
    if (matchResult) {
        // Use index query if we have a match
        const indexQuery = repository.query[matchResult.indexName](matchResult.indexFilters);
        if (filters && !isEmptyObject(filters)) {
            indexQuery.where((attr: any, op: any) => entityFilterCriteriaToExpression(filters, attr, op));
        }
        entities = await indexQuery.go(removeEmpty(pagination));
    } else {
        // Use match for full scan
        const scanQuery = repository.match({});
        if (filters && !isEmptyObject(filters)) {
            scanQuery.where((attr: any, op: any) => entityFilterCriteriaToExpression(filters, attr, op));
        }
        entities = await scanQuery.go(removeEmpty(pagination));
    }

    // await eventDispatcher.dispatch({ event: 'afterList', context: arguments });

    // create audit
    // auditLogger.audit({ entityName, crudType, entities, actor, tenant });

    logger.debug(`Completed EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);

    return entities;
}

export interface QueryEntityArgs<Sch extends EntitySchema<any, any, any>> extends BaseEntityCrudArgs<Sch> {
    query: EntityQuery<Sch>
}

/**
 * Executes a query on the specified entity.
 * @param options - The options for the query.
 * @returns A promise that resolves to the result of the query.
 */
export async function queryEntity<S extends EntitySchema<any, any, any>>(options: QueryEntityArgs<S>) {

    const {
        entityName,
        entityService,

        actor,
        tenant,

        crudType = 'query',
        logger = createLogger('CRUD-service:queryEntity'),
        authorizer = Authorizer.Default,
        auditLogger = NullAuditLogger,
        eventDispatcher = EventDispatcher.Default,

        query = {}

    } = options;

    const {
        filters = {},
        pagination = { order: 'asc', pager: 'cursor', cursor: null, count: 25, pages: undefined, limit: undefined }
    } = query;

    logger.debug(`Called EntityCrud ~ queryEntity ~ entityName: ${entityName} ~ filters+paging:`);

    // await eventDispatcher.dispatch({event: 'beforeQuery', context: arguments });

    // // authorize the actor
    // const authorization = await authorizer.authorize({entityName, crudType, actor, tenant});
    // if(!authorization.pass){
    //     throw new Error("Authorization failed: " + { cause: authorization });
    // }

    // Check if we have a filter that matches an index
    const schema = entityService.getEntitySchema();
    const matchResult = findMatchingIndex(schema, filters, entityName, entityService);

    // Use the appropriate index if available
    const repository = entityService.getRepository();
    
    let entities;
    if (matchResult) {
        // Use index query if we have a match
        const indexQuery = repository.query[matchResult.indexName](matchResult.indexFilters);
        if (filters && !isEmptyObject(filters)) {
            indexQuery.where((attr: any, op: any) => entityFilterCriteriaToExpression(filters, attr, op));
        }
        entities = await indexQuery.go(removeEmpty(pagination));
    } else {
        // Use match for full scan
        const scanQuery = repository.match({});
        if (filters && !isEmptyObject(filters)) {
            scanQuery.where((attr: any, op: any) => entityFilterCriteriaToExpression(filters, attr, op));
        }
        entities = await scanQuery.go(removeEmpty(pagination));
    }

    // await eventDispatcher.dispatch({ event: 'afterQuery', context: arguments });

    // // create audit
    // auditLogger.audit({ entityName, crudType, entities, actor, tenant });

    logger.debug(`Completed EntityCrud ~ queryEntity ~ entityName: ${entityName} ~ filters+paging:`);

    return entities;
}

/**
 * Represents the arguments for updating an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface UpdateEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    /**
     * The Identifiers of the entity to update.
     */
    id: OpsSchema[ 'get' ];
    /**
     * The data to update the entity with.
     */
    data: OpsSchema[ 'update' ];
    /**
     * Optional conditions for the update operation.
     */
    conditions?: any; // TODO
}

/**
 * Updates an entity in the database.
 * 
 * @template S - The entity schema type.
 * @param {UpdateEntityArgs<S>} options - The options for updating the entity.
 * @returns {Promise<Entity>} - A promise that resolves to the updated entity.
 * @throws {Error} - If no data is provided for the update operation, or if validation or authorization fails.
 */
export async function updateEntity<S extends EntitySchema<any, any, any>>(options: UpdateEntityArgs<S>) {
    const {
        id,
        data,
        entityName,

        entityService,

        actor,
        tenant,

        crudType = 'update',
        logger = createLogger('CRUD-service:updateEntity'),
        validator = DefaultValidator,
        authorizer = Authorizer.Default,
        auditLogger = NullAuditLogger,
        eventDispatcher = EventDispatcher.Default,

    } = options;

    logger.debug(`Called EntityCrudService<E ~ update ~ entityName: ${entityName} ~ data:`, data);

    if (!data) {
        throw new Error("No data provided for update operation");
    }

    // pre events
    // await eventDispatcher?.dispatch({ event: 'beforeUpdate', context: arguments });

    // validate
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: data,
        actor: actor
    });

    if (!validation.pass) {
        throw new EntityValidationError(validation.errors);
    }

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, identifiers, data, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for update: " + { cause: authorization });
    // }

    const entity = await entityService.getRepository().patch(identifiers).set(data).go();

    // // post events
    // await eventDispatcher?.dispatch({ event: 'afterUpdate', context: {...arguments, entity} });

    // create audit
    // auditLogger.audit({});

    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ update ~ entityName: ${entityName} ~ data:`, data, entity.data);

    return entity;
}

/**
 * the arguments for deleting an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface DeleteEntityArgs<
    Sch extends EntitySchema<any, any, any>,
    OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>,
> extends BaseEntityCrudArgs<Sch> {
    /**
     * The ID of the entity to be deleted.
     */
    id: OpsSchema[ 'delete' ];
}

/**
 * Deletes an entity based on the provided options.
 * @param options - The options for deleting the entity.
 * @returns The deleted entity.
 */
export async function deleteEntity<S extends EntitySchema<any, any, any>>(options: DeleteEntityArgs<S>) {

    const {
        id,
        entityName,
        entityService,

        actor,
        tenant,

        crudType = 'delete',
        logger = createLogger('CRUD-service:deleteEntity'),
        validator = DefaultValidator,
        authorizer = Authorizer.Default,
        auditLogger = NullAuditLogger,
        eventDispatcher = EventDispatcher.Default,

    } = options;

    logger.debug(`Called EntityCrud ~ deleteEntity ~ entityName: ${entityName} ~ id:`, id);

    // await eventDispatcher.dispatch({event: 'beforeDelete', context: arguments });

    const identifiers = entityService.extractEntityIdentifiers(id);

    // authorize the actor
    // const authorization = await authorizer.authorize({entityName, crudType, identifiers, actor, tenant});
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for delete: " + { cause: authorization });
    // }

    // validate
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: identifiers,
        actor: actor
    });

    if (!validation.pass) {
        throw new EntityValidationError(validation.errors);
    }

    const entity = await entityService.getRepository().delete(identifiers).go();

    // await eventDispatcher.dispatch({event: 'afterDelete', context: arguments});

    // create audit
    // auditLogger.audit({ entityName, crudType, data: identifiers, entity: entity.data, actor, tenant });

    logger.debug(`Completed EntityCrud ~ deleteEntity ~ entityName: ${entityName} ~ id:`, id);

    return entity;
}

/**
 * Converts a filter object with eq operators to a simplified form.
 * Example: { age: { eq: 65 } } becomes { age: 65 }
 * @param filters - The filter object to simplify
 * @returns A new filter object with eq operators converted to direct values
 */
export function simplifyFilters(filters: Record<string, any> | undefined): Record<string, any> {
    if (!filters) return {};
    
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(filters)) {
        if (value && typeof value === 'object' && 'eq' in value) {
            result[key] = value.eq;
        } else {
            result[key] = value;
        }
    }
    return result;
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