"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEntity = getEntity;
exports.getBatchEntity = getBatchEntity;
exports.createEntity = createEntity;
exports.upsertEntity = upsertEntity;
exports.findMatchingIndex = findMatchingIndex;
exports.listEntity = listEntity;
exports.queryEntity = queryEntity;
exports.updateEntity = updateEntity;
exports.deleteEntity = deleteEntity;
exports.simplifyFilters = simplifyFilters;
const authorize_1 = require("../authorize");
const event_1 = require("../event");
const logging_1 = require("../logging");
const utils_1 = require("../utils");
const validation_1 = require("../validation");
const query_1 = require("./query");
const validation_error_1 = require("./errors/validation-error");
/**
 * Retrieves an entity based on the provided options.
 * @param options - The options for retrieving the entity.
 * @returns The retrieved entity.
 */
async function getEntity(options) {
    const { id, attributes, entityName, entityService, actor, tenant, crudType = 'get', logger = (0, logging_1.createLogger)('CRUD-service:getEntity'), validator = validation_1.DefaultValidator, authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, } = options;
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
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    const entity = await entityService.getRepository().get(identifiers).go({ attributes });
    // await eventDispatcher.dispatch({event: 'afterGet', context: arguments});
    logger.debug(`Completed EntityCrud ~ getEntity ~ entityName: ${entityName} ~ id:`, id);
    return entity;
}
/**
 * Retrieves multiple entities in a batch operation.
 * @param options - The options for retrieving the entities.
 * @returns The retrieved entities and any unprocessed items.
 */
async function getBatchEntity(options) {
    const { ids, attributes, entityName, entityService, concurrent = 1, actor, tenant, crudType = 'get', logger = (0, logging_1.createLogger)('CRUD-service:getBatchEntity'), validator = validation_1.DefaultValidator, authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, } = options;
    logger.debug(`Called EntityCrud ~ getBatchEntity ~ entityName: ${entityName}:`, { ids, attributes });
    // Extract identifiers for all items in the batch
    const identifiersBatch = ids.map(id => entityService.extractEntityIdentifiers(id));
    // Validate each item in the batch
    const validations = await Promise.all(identifiersBatch.map(async (identifiers) => validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: identifiers,
        actor: actor
    })));
    // Check for validation errors
    const validationErrors = validations
        .map((validation, index) => ({ validation, index }))
        .filter(({ validation }) => !validation.pass);
    if (validationErrors.length > 0) {
        throw new validation_error_1.EntityValidationError(validationErrors.flatMap(({ validation, index }) => (validation.errors || []).map(error => ({
            ...error,
            message: `Item ${index}: ${error.message}`
        }))));
    }
    // Perform batch get operation with concurrency control
    const result = await entityService.getRepository().get(identifiersBatch).go({
        attributes,
        concurrent
    });
    logger.debug(`Completed EntityCrud ~ getBatchEntity ~ entityName: ${entityName} ~ ids:`, ids);
    return {
        data: Array.isArray(result.data) ? result.data : (result.data ? [result.data] : []),
        unprocessed: [] // ElectroDB doesn't support unprocessed items tracking, so we return empty array
    };
}
/**
 * Creates an entity using the provided options.
 *
 * @param options - The options for creating the entity.
 * @returns The created entity.
 * @throws Error if no data is provided for create operation, validation fails, or authorization fails.
 */
async function createEntity(options) {
    const { data, entityName, entityService, actor, tenant, crudType = 'create', logger = (0, logging_1.createLogger)('CRUD-service:createEntity'), validator = validation_1.DefaultValidator, authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, } = options;
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
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, data, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for create: " + { cause: authorization });
    // }
    const entity = await entityService.getRepository().create(data).go();
    // post events
    // await eventDispatcher?.dispatch({ event: 'afterCreate', context: {...arguments, entity} });
    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, data, entity.data);
    return entity;
}
/**
 * Creates an entity using the provided options.
 *
 * @param options - The options for creating-OR-updating the entity.
 * @returns The created entity.
 * @throws Error if no data is provided for upsert operation, validation fails, or authorization fails.
 */
async function upsertEntity(options) {
    const { data, entityName, entityService, actor, tenant, crudType = 'upsert', logger = (0, logging_1.createLogger)('CRUD-service:upsertEntity'), validator = validation_1.DefaultValidator, authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, } = options;
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
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, data, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for upsert: " + { cause: authorization });
    // }
    const entity = await entityService.getRepository().upsert(data).go();
    // post events
    // await eventDispatcher?.dispatch({ event: 'afterUpsert', context: {...arguments, entity} });
    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ upsert ~ entityName: ${entityName} ~ data:`, data, entity.data);
    return entity;
}
/**
 * Finds a matching index based on the provided filters and schema.
 * @param schema - The entity schema
 * @param filters - The filters to match against
 * @param entityName - The name of the entity
 * @param entityService - The entity service
 * @returns The name of the matching index and the filters used to match it or undefined if no match is found
 */
function findMatchingIndex(schema, filters, entityName, entityService) {
    const logger = (0, logging_1.createLogger)('CRUD-service:findMatchingIndex');
    if (!filters)
        filters = {};
    // First try ElectroDB's index matching
    const repository = entityService.getRepository();
    const { keys, index, shouldScan } = repository._findBestIndexKeyMatch(filters);
    logger.debug(`Found ElectroDB index: ${index} with ${keys.length} attribute matches for entity: ${entityName} with filters and scan: ${shouldScan} - `, keys, filters);
    // If we found a matching index, use it
    if (!shouldScan) {
        const indexFilters = {};
        // Add matched keys to indexFilters
        keys.forEach((key) => {
            const filterValue = filters[key.name];
            if (filterValue) {
                // Handle both { eq: value } and direct value formats
                indexFilters[key.name] = filterValue.eq !== undefined ? filterValue.eq : filterValue;
            }
        });
        // Map ElectroDB's internal index name back to our schema's index name
        let schemaIndexName = index;
        if (index === '') {
            schemaIndexName = 'primary';
        }
        else {
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
async function listEntity(options) {
    const { entityName, entityService, actor, tenant, crudType = 'list', logger = (0, logging_1.createLogger)('CRUD-service:listEntity'), authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, query = {}, } = options;
    const { filters = {}, attributes = [], pagination = { order: 'asc', pager: 'cursor', cursor: null, count: 25, pages: undefined, limit: undefined }, index: specifiedIndex } = query;
    logger.debug(`Called EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);
    // await eventDispatcher.dispatch({event: 'beforeList', context: arguments });
    // authorize the actor
    // const authorization = await authorizer.authorize({entityName, crudType, actor, tenant});
    // if(!authorization.pass){
    //     throw new Error("Authorization failed: " + { cause: authorization });
    // }
    // Check if we have a filter that matches an index
    const schema = entityService.getEntitySchema();
    const matchResult = specifiedIndex
        ? { indexName: specifiedIndex.name, indexFilters: specifiedIndex.filters || {} }
        : findMatchingIndex(schema, filters, entityName, entityService);
    logger.debug(`Match result:`, matchResult);
    // Use the appropriate index if available
    const repository = entityService.getRepository();
    let entities;
    if (matchResult) {
        // Use index query if we have a match
        const indexQuery = repository.query[matchResult.indexName](matchResult.indexFilters);
        if (filters && !(0, utils_1.isEmptyObject)(filters)) {
            indexQuery.where((attr, op) => (0, query_1.entityFilterCriteriaToExpression)(filters, attr, op));
        }
        entities = await indexQuery.go({ attributes: attributes, ...(0, utils_1.removeEmpty)(pagination) });
    }
    else {
        // Use match for full scan
        logger.warn(`WARNING: No matching index found for entity: ${entityName}, using match for full scan`, filters);
        const scanQuery = repository.scan;
        if (filters && !(0, utils_1.isEmptyObject)(filters)) {
            scanQuery.where((attr, op) => (0, query_1.entityFilterCriteriaToExpression)(filters, attr, op));
        }
        // TODO: add attributes to scan query
        entities = await scanQuery.go((0, utils_1.removeEmpty)(pagination));
    }
    // await eventDispatcher.dispatch({ event: 'afterList', context: arguments });
    logger.debug(`Completed EntityCrud ~ listEntity ~ entityName: ${entityName} ~ filters+paging:`);
    return entities;
}
/**
 * Executes a query on the specified entity.
 * @param options - The options for the query.
 * @returns A promise that resolves to the result of the query.
 */
async function queryEntity(options) {
    const { entityName, entityService, actor, tenant, crudType = 'query', logger = (0, logging_1.createLogger)('CRUD-service:queryEntity'), authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, query = {} } = options;
    const { filters = {}, attributes = [], pagination = { order: 'asc', pager: 'cursor', cursor: null, count: 25, pages: undefined, limit: undefined }, index: specifiedIndex } = query;
    logger.debug(`Called EntityCrud ~ queryEntity ~ entityName: ${entityName} ~ filters+paging:`);
    // await eventDispatcher.dispatch({event: 'beforeQuery', context: arguments});
    // // authorize the actor
    // const authorization = await authorizer.authorize({entityName, crudType, actor, tenant});
    // if(!authorization.pass){
    //     throw new Error("Authorization failed: " + { cause: authorization });
    // }
    // Check if we have a filter that matches an index
    const schema = entityService.getEntitySchema();
    const matchResult = specifiedIndex
        ? { indexName: specifiedIndex.name, indexFilters: specifiedIndex.filters || {} }
        : findMatchingIndex(schema, filters, entityName, entityService);
    // Use the appropriate index if available
    const repository = entityService.getRepository();
    let entities;
    if (matchResult) {
        // Use index query if we have a match
        const indexQuery = repository.query[matchResult.indexName](matchResult.indexFilters);
        if (filters && !(0, utils_1.isEmptyObject)(filters)) {
            indexQuery.where((attr, op) => (0, query_1.entityFilterCriteriaToExpression)(filters, attr, op));
        }
        entities = await indexQuery.go({ attributes: attributes, ...(0, utils_1.removeEmpty)(pagination) });
    }
    else {
        // Use match for full scan
        logger.warn(`WARNING: No matching index found for entity: ${entityName}, using match for full scan`, filters);
        const scanQuery = repository.scan;
        if (filters && !(0, utils_1.isEmptyObject)(filters)) {
            scanQuery.where((attr, op) => (0, query_1.entityFilterCriteriaToExpression)(filters, attr, op));
        }
        // TODO: add attributes to scan query
        entities = await scanQuery.go((0, utils_1.removeEmpty)(pagination));
    }
    // await eventDispatcher.dispatch({ event: 'afterQuery', context: arguments });
    logger.debug(`Completed EntityCrud ~ queryEntity ~ entityName: ${entityName} ~ filters+paging:`);
    return entities;
}
async function prepareCompositeAttributesForUpdate(args) {
    const { entityService, identifiers, data, requiredCompositeAttributes, logger, } = args;
    const compositeKeyValues = {};
    const attributesToFetch = new Set();
    const dataAsRecord = data; // Cast for dynamic access
    if (requiredCompositeAttributes.size === 0) {
        return {}; // No composite attributes needed
    }
    // only include what's not already in data or identifiers
    requiredCompositeAttributes.forEach(attr => {
        if (!dataAsRecord.hasOwnProperty(attr) && !identifiers.hasOwnProperty(attr)) {
            attributesToFetch.add(attr);
        }
    });
    if (attributesToFetch.size > 0) {
        logger.debug(`Need to fetch attributes for composite keys:`, Array.from(attributesToFetch));
        try {
            const existingRecordContainer = await entityService.getRepository()
                .get(identifiers)
                .go({ attributes: Array.from(attributesToFetch), consistentRead: true });
            const existingRecordData = existingRecordContainer.data;
            if (!existingRecordData) {
                logger.warn(`No existing record found for composite keys:`, Array.from(attributesToFetch));
            }
            else {
                attributesToFetch.forEach(attr => {
                    if (existingRecordData.hasOwnProperty(attr)) {
                        compositeKeyValues[attr] = existingRecordData[attr];
                    }
                    else {
                        logger.warn(`Composite key attribute "${attr}" (ID: ${JSON.stringify(identifiers)}) was not found in payload, identifiers, or existing record.`);
                    }
                });
            }
        }
        catch (error) {
            logger.error(`Error fetching attributes for composite keys (ID: ${JSON.stringify(identifiers)}):`, error);
            throw error;
        }
    }
    logger.debug(`Prepared composite key values:`, compositeKeyValues);
    return compositeKeyValues;
}
/**
 * Updates an entity in the database.
 *
 * @template S - The entity schema type.
 * @param {UpdateEntityArgs<S>} options - The options for updating the entity.
 * @returns {Promise<Entity>} - A promise that resolves to the updated entity.
 * @throws {Error} - If no data is provided for the update operation, or if validation or authorization fails.
 */
async function updateEntity(options) {
    const { id, data, operators, entityName, entityService, actor, tenant, crudType = 'update', logger = (0, logging_1.createLogger)('CRUD-service:updateEntity'), validator = validation_1.DefaultValidator, authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, compositeKeyData, } = options;
    logger.debug(`Called EntityCrudService<E ~ update ~ entityName: ${entityName} ~ data:`, { data, providedCompositeKeyData: compositeKeyData });
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
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    const identifiers = entityService.extractEntityIdentifiers(id);
    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, identifiers, data, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for update: " + { cause: authorization });
    // }
    // --- Composite Key Handling ---
    const schema = entityService.getEntitySchema();
    const allReferencedCompositeAttributes = new Set();
    if (schema.indexes) {
        for (const indexName in schema.indexes) {
            const indexDefinition = schema.indexes[indexName];
            if (indexDefinition) {
                const pkComposite = indexDefinition.pk?.composite;
                if (pkComposite && Array.isArray(pkComposite)) {
                    pkComposite.forEach(attr => allReferencedCompositeAttributes.add(attr));
                }
                const skComposite = indexDefinition.sk?.composite;
                if (skComposite && Array.isArray(skComposite)) {
                    skComposite.forEach(attr => allReferencedCompositeAttributes.add(attr));
                }
            }
        }
    }
    let finalCompositeKeyValuesForElectroDB = {};
    if (allReferencedCompositeAttributes.size > 0) {
        if (compositeKeyData && typeof compositeKeyData === 'object') {
            logger.debug(`Using provided compositeKeyData for update.`, compositeKeyData);
            finalCompositeKeyValuesForElectroDB = compositeKeyData;
            // Check if provided compositeKeyData covers all allReferencedCompositeAttributes
            const missingFromProvided = Array.from(allReferencedCompositeAttributes).filter(attr => {
                return (!data.hasOwnProperty(attr)
                    &&
                        !identifiers.hasOwnProperty(attr)
                    &&
                        !finalCompositeKeyValuesForElectroDB.hasOwnProperty(attr));
            });
            if (missingFromProvided.length > 0) {
                logger.warn(`Provided compositeKeyData is missing some required composite attributes: ${missingFromProvided.join(', ')}. Update may fail if these are needed by ElectroDB.`);
            }
        }
        else {
            logger.debug(`No compositeKeyData provided, preparing composite attributes internally. Required:`, Array.from(allReferencedCompositeAttributes));
            finalCompositeKeyValuesForElectroDB = await prepareCompositeAttributesForUpdate({
                entityName,
                entityService,
                identifiers: identifiers,
                data: data,
                requiredCompositeAttributes: allReferencedCompositeAttributes,
                logger,
            });
        }
    }
    else {
        logger.debug(`No composite attributes defined in schema or needed for this update.`);
    }
    // --- End Composite Key Handling ---
    // Use ElectroDB for all fields including _actor (now in schema)
    const query = entityService.getRepository().patch(identifiers).set(data);
    if (Object.keys(finalCompositeKeyValuesForElectroDB).length > 0) {
        logger.debug(`Using composite values for ElectroDB patch:`, finalCompositeKeyValuesForElectroDB);
        query.composite(finalCompositeKeyValuesForElectroDB);
    }
    if (operators?.remove) {
        query.remove(operators.remove);
    }
    const entity = await query.go();
    // // post events
    // await eventDispatcher?.dispatch({ event: 'afterUpdate', context: {...arguments, entity} });
    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ update ~ entityName: ${entityName} ~ data:`, data, entity.data);
    return entity;
}
/**
 * Deletes an entity based on the provided options.
 * @param options - The options for deleting the entity.
 * @returns The deleted entity.
 */
async function deleteEntity(options) {
    const { id, entityName, entityService, actor, tenant, crudType = 'delete', logger = (0, logging_1.createLogger)('CRUD-service:deleteEntity'), validator = validation_1.DefaultValidator, authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, } = options;
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
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    const entity = await entityService.getRepository().delete(identifiers).go();
    // await eventDispatcher.dispatch({event: 'afterDelete', context: arguments});
    logger.debug(`Completed EntityCrud ~ deleteEntity ~ entityName: ${entityName} ~ id:`, id);
    return entity;
}
/**
 * Converts a filter object with eq operators to a simplified form.
 * Example: { age: { eq: 65 } } becomes { age: 65 }
 * @param filters - The filter object to simplify
 * @returns A new filter object with eq operators converted to direct values
 */
function simplifyFilters(filters) {
    if (!filters)
        return {};
    const result = {};
    for (const [key, value] of Object.entries(filters)) {
        if (value && typeof value === 'object' && 'eq' in value) {
            result[key] = value.eq;
        }
        else {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUF3RUEsOEJBcURDO0FBOEJELHdDQTZEQztBQTRCRCxvQ0F1REM7QUE2QkQsb0NBdURDO0FBa0JELDhDQThEQztBQVFELGdDQW9FQztBQVdELGtDQW9FQztBQW9IRCxvQ0F3SUM7QUFzQkQsb0NBbURDO0FBUUQsMENBWUM7QUFqOEJELDRDQUEwQztBQUMxQyxvQ0FBMkM7QUFDM0Msd0NBQW1EO0FBQ25ELG9DQUFzRDtBQUN0RCw4Q0FBa0U7QUFDbEUsbUNBQTJEO0FBQzNELGdFQUFrRTtBQTJEbEU7Ozs7R0FJRztBQUNJLEtBQUssVUFBVSxTQUFTLENBQXdDLE9BQXlCO0lBRTVGLE1BQU0sRUFDRixFQUFFLEVBQ0YsVUFBVSxFQUNWLFVBQVUsRUFDVixhQUFhLEVBRWIsS0FBSyxFQUNMLE1BQU0sRUFFTixRQUFRLEdBQUcsS0FBSyxFQUNoQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLHdCQUF3QixDQUFDLEVBQy9DLFNBQVMsR0FBRyw2QkFBZ0IsRUFDNUIsVUFBVSxHQUFHLHNCQUFVLENBQUMsT0FBTyxFQUMvQixlQUFlLEdBQUcsdUJBQWUsQ0FBQyxPQUFPLEdBRTVDLEdBQUcsT0FBTyxDQUFDO0lBRVosTUFBTSxDQUFDLEtBQUssQ0FBQywrQ0FBK0MsVUFBVSxHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztJQUUvRiw2RUFBNkU7SUFFN0UsTUFBTSxXQUFXLEdBQUcsYUFBYSxDQUFDLHdCQUF3QixDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBRS9ELHNCQUFzQjtJQUN0Qix3R0FBd0c7SUFDeEcsMkJBQTJCO0lBQzNCLG9GQUFvRjtJQUNwRixJQUFJO0lBR0osY0FBYztJQUNkLE1BQU0sVUFBVSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNB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QU0sTUFBTSxHQUF3QixFQUFFLENBQUM7SUFDdkMsS0FBSyxNQUFNLENBQUUsR0FBRyxFQUFFLEtBQUssQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNuRCxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3RELE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzdCLENBQUM7YUFBTSxDQUFDO1lBQ0osTUFBTSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztRQUMxQixDQUFDO0lBQ0wsQ0FBQztJQUNELE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUM7QUFFRCxtRUFBbUU7QUFFbkUsc0RBQXNEO0FBQ3RELDRDQUE0QztBQUM1QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsb0RBQW9EO0FBQ3BELDJDQUEyQztBQUMzQyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBQ1IsSUFBSTtBQUdKLG1FQUFtRSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSwgRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hLCBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMsIEVudGl0eVR5cGVGcm9tU2NoZW1hIH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5UXVlcnkgfSBmcm9tIFwiLi9xdWVyeS10eXBlc1wiO1xuaW1wb3J0IHsgQXV0aG9yaXplciB9IGZyb20gXCIuLi9hdXRob3JpemVcIjtcbmltcG9ydCB7IEV2ZW50RGlzcGF0Y2hlciB9IGZyb20gXCIuLi9ldmVudFwiO1xuaW1wb3J0IHsgSUxvZ2dlciwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IGlzRW1wdHlPYmplY3QsIHJlbW92ZUVtcHR5IH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCB0eXBlIElWYWxpZGF0b3IgfSBmcm9tIFwiLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24gfSBmcm9tIFwiLi9xdWVyeVwiO1xuaW1wb3J0IHsgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSBcIi4vZXJyb3JzL3ZhbGlkYXRpb24tZXJyb3JcIjtcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXMvYWN0b3JcIjtcblxuLyoqXG4gKiBcbiAqIFNlcmlhbGl6ZXIvZm9ybWF0dGVyXG4gKiAgLSBodHRwczovL2dpdGh1Yi5jb20vZGt6bHYvbWljcm8tdHJhbnNmb3JtXG4gKiAgXG4gKiBFdmVudCBkaXNwYXRjaGVyXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9Gb3hBbmRGbHkvdHMtZXZlbnQtZGlzcGF0Y2hlci9ibG9iL21hc3Rlci9zcmMvaW5kZXgudHNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL3J5YXJkbGV5L3RzLWJ1c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vYmluaWVyL3RpbnktdHlwZWQtZW1pdHRlci90cmVlL21hc3RlclxuICogXG4gKiBSb3V0ZXJcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL2JlcnN0ZW5kL3RpbnktcmVxdWVzdC1yb3V0ZXIvYmxvYi9tYXN0ZXIvc3JjL3JvdXRlci50c1xuICogXG4gKiBESVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbmljb2pzL3R5cGVkLWluamVjdFxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbWljcm9zb2Z0L3RzeXJpbmdlXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9vd2phL2lvY1xuICogXG4gKiBcbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhc2VFbnRpdHlDcnVkQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcblxuICAgIGNydWRUeXBlPzoga2V5b2YgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuICAgIGFjdG9yPzogQWN0b3I7IC8vIEFjdG9yIGNvbnRleHQ6IGNvbXByZWhlbnNpdmUgYWN0b3IgaW5mb3JtYXRpb24gaW5jbHVkaW5nIGF1dGhlbnRpY2F0aW9uIGRldGFpbHNcbiAgICB0ZW5hbnQ/OiBhbnk7IC8vIHRvZG86IGRlZmluZSB0ZW5hbnQgY29udGV4dFxuXG4gICAgbG9nZ2VyPzogSUxvZ2dlcjtcbiAgICB2YWxpZGF0b3I/OiBJVmFsaWRhdG9yO1xuICAgIGF1dGhvcml6ZXI/OiBBdXRob3JpemVyLklBdXRob3JpemVyOyAgICAgICAgLy8gdG9kbzogZGVmaW5lIGF1dGhvcml6ZXIgc2lnbmF0dXJlXG4gICAgZXZlbnREaXNwYXRjaGVyPzogRXZlbnREaXNwYXRjaGVyLklFdmVudERpc3BhdGNoZXI7ICAvLyB0b2RvIGRlZmluZSBldmVudCBkaXNwYXRjaGVyIHNpZ25hdHVyZVxuXG4gICAgLy8gdGVsZW1ldHJ5XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIHJldHJpZXZlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byBpbmNsdWRlIGluIHRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciByZXRyaWV2aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZ2V0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Z2V0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkLCBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZUdldCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGlkZW50aWZpZXJzLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciBnZXQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cblxuICAgIC8vIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVycykuZ28oeyBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2FmdGVyR2V0JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIHJldHVybiBlbnRpdHk7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2guXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gcmV0cmlldmUuXG4gICAgICovXG4gICAgaWRzOiBBcnJheTxPcHNTY2hlbWFbICdnZXQnIF0+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmV0cmlldmVkIGVudGl0aWVzLlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqL1xuICAgIGNvbmN1cnJlbnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgcmV0cmlldmluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRCYXRjaEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRCYXRjaEVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkcyxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgY29uY3VycmVudCA9IDEsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdnZXQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpnZXRCYXRjaEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZHMsIGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZvciBhbGwgaXRlbXMgaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlkcy5tYXAoaWQgPT4gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuICAgIC8vIFZhbGlkYXRlIGVhY2ggaXRlbSBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCB2YWxpZGF0aW9ucyA9IGF3YWl0IFByb21pc2UuYWxsKGlkZW50aWZpZXJzQmF0Y2gubWFwKGFzeW5jIGlkZW50aWZpZXJzID0+XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhY3RvcjogYWN0b3JcbiAgICAgICAgfSlcbiAgICApKTtcblxuICAgIC8vIENoZWNrIGZvciB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uc1xuICAgICAgICAubWFwKCh2YWxpZGF0aW9uLCBpbmRleCkgPT4gKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgdmFsaWRhdGlvbiB9KSA9PiAhdmFsaWRhdGlvbi5wYXNzKTtcblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uRXJyb3JzLmZsYXRNYXAoKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkgPT5cbiAgICAgICAgICAgICh2YWxpZGF0aW9uLmVycm9ycyB8fCBbXSkubWFwKGVycm9yID0+ICh7XG4gICAgICAgICAgICAgICAgLi4uZXJyb3IsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYEl0ZW0gJHtpbmRleH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgKSk7XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBiYXRjaCBnZXQgb3BlcmF0aW9uIHdpdGggY29uY3VycmVuY3kgY29udHJvbFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVyc0JhdGNoKS5nbyh7XG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIGNvbmN1cnJlbnRcbiAgICB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZHM6YCwgaWRzKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGRhdGE6IEFycmF5LmlzQXJyYXkocmVzdWx0LmRhdGEpID8gcmVzdWx0LmRhdGEgOiAocmVzdWx0LmRhdGEgPyBbIHJlc3VsdC5kYXRhIF0gOiBbXSksXG4gICAgICAgIHVucHJvY2Vzc2VkOiBbXSAgLy8gRWxlY3Ryb0RCIGRvZXNuJ3Qgc3VwcG9ydCB1bnByb2Nlc3NlZCBpdGVtcyB0cmFja2luZywgc28gd2UgcmV0dXJuIGVtcHR5IGFycmF5XG4gICAgfTtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGNyZWF0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDcmVhdGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBkYXRhIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqL1xuICAgIGRhdGE6IE9wc1NjaGVtYVsgJ2NyZWF0ZScgXTtcbn1cblxuZXhwb3J0IHR5cGUgQ3JlYXRlRW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gZW50aXR5IHVzaW5nIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMgVGhlIGNyZWF0ZWQgZW50aXR5LlxuICogQHRocm93cyBFcnJvciBpZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciBjcmVhdGUgb3BlcmF0aW9uLCB2YWxpZGF0aW9uIGZhaWxzLCBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IENyZWF0ZUVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPENyZWF0ZUVudGl0eVJlc3BvbnNlPFM+PiB7XG4gICAgY29uc3Qge1xuICAgICAgICBkYXRhLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnY3JlYXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Y3JlYXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gY3JlYXRlIH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSk7XG5cbiAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YSBwcm92aWRlZCBmb3IgY3JlYXRlIG9wZXJhdGlvblwiKTtcbiAgICB9XG5cbiAgICAvLyBwcmUgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYmVmb3JlQ3JlYXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogZGF0YSxcbiAgICAgICAgYWN0b3I6IGFjdG9yLFxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGNyZWF0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmNyZWF0ZShkYXRhKS5nbygpO1xuXG4gICAgLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlckNyZWF0ZScsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiBjcmVhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5IGFzIENyZWF0ZUVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyBhbiBlbnRpdHkuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBzZXJ0RW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGF0YSBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cHNlcnQnIF07XG59XG5cbmV4cG9ydCB0eXBlIFVwc2VydEVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGVudGl0eSB1c2luZyB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eS5cbiAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gZGF0YSBpcyBwcm92aWRlZCBmb3IgdXBzZXJ0IG9wZXJhdGlvbiwgdmFsaWRhdGlvbiBmYWlscywgb3IgYXV0aG9yaXphdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwc2VydEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBVcHNlcnRFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxVcHNlcnRFbnRpdHlSZXNwb25zZTxTPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ3Vwc2VydCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwc2VydEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEpO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIHVwc2VydCBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgLy8gcHJlIGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2JlZm9yZVVwc2VydCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGRhdGEsXG4gICAgICAgIGFjdG9yOiBhY3RvcixcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3IgXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHsgZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciB1cHNlcnQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS51cHNlcnQoZGF0YSBhcyBhbnkpLmdvKCk7XG5cbiAgICAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyVXBzZXJ0JywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEsIGVudGl0eS5kYXRhKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgVXBzZXJ0RW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBsaXN0aW5nIGVudGl0aWVzLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGlzdEVudGl0eUFyZ3M8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICBxdWVyeTogRW50aXR5UXVlcnk8U2NoPlxufVxuXG4vKipcbiAqIEZpbmRzIGEgbWF0Y2hpbmcgaW5kZXggYmFzZWQgb24gdGhlIHByb3ZpZGVkIGZpbHRlcnMgYW5kIHNjaGVtYS5cbiAqIEBwYXJhbSBzY2hlbWEgLSBUaGUgZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVycyB0byBtYXRjaCBhZ2FpbnN0XG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBlbnRpdHlcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gVGhlIGVudGl0eSBzZXJ2aWNlXG4gKiBAcmV0dXJucyBUaGUgbmFtZSBvZiB0aGUgbWF0Y2hpbmcgaW5kZXggYW5kIHRoZSBmaWx0ZXJzIHVzZWQgdG8gbWF0Y2ggaXQgb3IgdW5kZWZpbmVkIGlmIG5vIG1hdGNoIGlzIGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaW5kTWF0Y2hpbmdJbmRleChcbiAgICBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8YW55PlxuKTogeyBpbmRleE5hbWU6IHN0cmluZzsgaW5kZXhGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IH0gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmZpbmRNYXRjaGluZ0luZGV4Jyk7XG4gICAgaWYgKCFmaWx0ZXJzKSBmaWx0ZXJzID0ge307XG5cbiAgICAvLyBGaXJzdCB0cnkgRWxlY3Ryb0RCJ3MgaW5kZXggbWF0Y2hpbmdcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG4gICAgY29uc3QgeyBrZXlzLCBpbmRleCwgc2hvdWxkU2NhbiB9ID0gKHJlcG9zaXRvcnkgYXMgYW55KS5fZmluZEJlc3RJbmRleEtleU1hdGNoKGZpbHRlcnMpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBGb3VuZCBFbGVjdHJvREIgaW5kZXg6ICR7aW5kZXh9IHdpdGggJHtrZXlzLmxlbmd0aH0gYXR0cmlidXRlIG1hdGNoZXMgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSB3aXRoIGZpbHRlcnMgYW5kIHNjYW46ICR7c2hvdWxkU2Nhbn0gLSBgLCBrZXlzLCBmaWx0ZXJzKTtcblxuICAgIC8vIElmIHdlIGZvdW5kIGEgbWF0Y2hpbmcgaW5kZXgsIHVzZSBpdFxuICAgIGlmICghc2hvdWxkU2Nhbikge1xuICAgICAgICBjb25zdCBpbmRleEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgICAgICAvLyBBZGQgbWF0Y2hlZCBrZXlzIHRvIGluZGV4RmlsdGVyc1xuICAgICAgICBrZXlzLmZvckVhY2goKGtleTogeyBuYW1lOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJWYWx1ZSA9IGZpbHRlcnMhWyBrZXkubmFtZSBdO1xuICAgICAgICAgICAgaWYgKGZpbHRlclZhbHVlKSB7XG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIGJvdGggeyBlcTogdmFsdWUgfSBhbmQgZGlyZWN0IHZhbHVlIGZvcm1hdHNcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnNbIGtleS5uYW1lIF0gPSBmaWx0ZXJWYWx1ZS5lcSAhPT0gdW5kZWZpbmVkID8gZmlsdGVyVmFsdWUuZXEgOiBmaWx0ZXJWYWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gTWFwIEVsZWN0cm9EQidzIGludGVybmFsIGluZGV4IG5hbWUgYmFjayB0byBvdXIgc2NoZW1hJ3MgaW5kZXggbmFtZVxuICAgICAgICBsZXQgc2NoZW1hSW5kZXhOYW1lID0gaW5kZXg7XG4gICAgICAgIGlmIChpbmRleCA9PT0gJycpIHtcbiAgICAgICAgICAgIHNjaGVtYUluZGV4TmFtZSA9ICdwcmltYXJ5JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGluZGV4IGluIG91ciBzY2hlbWEgdGhhdCBtYXRjaGVzIHRoaXMgR1NJXG4gICAgICAgICAgICBjb25zdCBpbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgbmFtZSwgaW5kZXhEZWYgXSBvZiBPYmplY3QuZW50cmllcyhpbmRleGVzKSkge1xuICAgICAgICAgICAgICAgIGlmIChpbmRleERlZi5pbmRleCA9PT0gaW5kZXgpIHtcbiAgICAgICAgICAgICAgICAgICAgc2NoZW1hSW5kZXhOYW1lID0gbmFtZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBFbGVjdHJvREIgbWF0Y2hlZCBpbmRleDogJHtzY2hlbWFJbmRleE5hbWV9IChpbnRlcm5hbDogJHtpbmRleH0pIHdpdGggJHtrZXlzLmxlbmd0aH0gYXR0cmlidXRlIG1hdGNoZXMgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSB3aXRoIGZpbHRlcnM6YCwgaW5kZXhGaWx0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHsgaW5kZXhOYW1lOiBzY2hlbWFJbmRleE5hbWUsIGluZGV4RmlsdGVycyB9O1xuICAgIH1cblxuICAgIC8vIElmIG5vIGluZGV4IG1hdGNoIGZvdW5kLCBjaGVjayBmb3IgdGVtcGxhdGUgbWF0Y2hcbiAgICBjb25zdCBpbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgZm9yIChjb25zdCBbIGluZGV4TmFtZSwgaW5kZXhEZWYgXSBvZiBPYmplY3QuZW50cmllcyhpbmRleGVzKSkge1xuICAgICAgICBpZiAoaW5kZXhEZWYucGsudGVtcGxhdGUgJiZcbiAgICAgICAgICAgIHR5cGVvZiBpbmRleERlZi5way50ZW1wbGF0ZSA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgICAgIGluZGV4RGVmLnBrLnRlbXBsYXRlLnRvTG93ZXJDYXNlKCkgPT09IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyB0ZW1wbGF0ZSBtYXRjaGluZyBpbmRleDogJHtpbmRleE5hbWV9IGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lLFxuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgbGlzdGluZyBlbnRpdGllcy5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIGFycmF5IG9mIGVudGl0aWVzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBMaXN0RW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnbGlzdCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmxpc3RFbnRpdHknKSxcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICAgICAgcXVlcnkgPSB7fSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZmlsdGVycyA9IHt9LFxuICAgICAgICBhdHRyaWJ1dGVzID0gW10sXG4gICAgICAgIHBhZ2luYXRpb24gPSB7IG9yZGVyOiAnYXNjJywgcGFnZXI6ICdjdXJzb3InLCBjdXJzb3I6IG51bGwsIGNvdW50OiAyNSwgcGFnZXM6IHVuZGVmaW5lZCwgbGltaXQ6IHVuZGVmaW5lZCB9LFxuICAgICAgICBpbmRleDogc3BlY2lmaWVkSW5kZXhcbiAgICB9ID0gcXVlcnk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gbGlzdEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVMaXN0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IHNwZWNpZmllZEluZGV4LmZpbHRlcnMgfHwge30gfVxuICAgICAgICA6IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgZW50aXR5TmFtZSwgZW50aXR5U2VydmljZSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYE1hdGNoIHJlc3VsdDpgLCBtYXRjaFJlc3VsdCk7XG4gICAgLy8gVXNlIHRoZSBhcHByb3ByaWF0ZSBpbmRleCBpZiBhdmFpbGFibGVcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICBsZXQgZW50aXRpZXM7XG4gICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgIC8vIFVzZSBpbmRleCBxdWVyeSBpZiB3ZSBoYXZlIGEgbWF0Y2hcbiAgICAgICAgY29uc3QgaW5kZXhRdWVyeSA9IHJlcG9zaXRvcnkucXVlcnlbIG1hdGNoUmVzdWx0LmluZGV4TmFtZSBdKG1hdGNoUmVzdWx0LmluZGV4RmlsdGVycyk7XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBpbmRleFF1ZXJ5LmdvKHsgYXR0cmlidXRlczogYXR0cmlidXRlcyBhcyBhbnksIC4uLnJlbW92ZUVtcHR5KHBhZ2luYXRpb24pIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVzZSBtYXRjaCBmb3IgZnVsbCBzY2FuXG4gICAgICAgIGxvZ2dlci53YXJuKGBXQVJOSU5HOiBObyBtYXRjaGluZyBpbmRleCBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9LCB1c2luZyBtYXRjaCBmb3IgZnVsbCBzY2FuYCwgZmlsdGVycyk7XG4gICAgICAgIGNvbnN0IHNjYW5RdWVyeSA9IHJlcG9zaXRvcnkuc2NhbjtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIHNjYW5RdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IGFkZCBhdHRyaWJ1dGVzIHRvIHNjYW4gcXVlcnlcbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBzY2FuUXVlcnkuZ28ocmVtb3ZlRW1wdHkocGFnaW5hdGlvbikpO1xuICAgIH1cblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJMaXN0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGxpc3RFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZmlsdGVycytwYWdpbmc6YCk7XG5cbiAgICByZXR1cm4gZW50aXRpZXM7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUXVlcnlFbnRpdHlBcmdzPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgcXVlcnk6IEVudGl0eVF1ZXJ5PFNjaD5cbn1cblxuLyoqXG4gKiBFeGVjdXRlcyBhIHF1ZXJ5IG9uIHRoZSBzcGVjaWZpZWQgZW50aXR5LlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgdGhlIHF1ZXJ5LlxuICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJlc3VsdCBvZiB0aGUgcXVlcnkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBxdWVyeUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBRdWVyeUVudGl0eUFyZ3M8Uz4pIHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ3F1ZXJ5JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6cXVlcnlFbnRpdHknKSxcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICAgICAgcXVlcnkgPSB7fVxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGZpbHRlcnMgPSB7fSxcbiAgICAgICAgYXR0cmlidXRlcyA9IFtdLFxuICAgICAgICBwYWdpbmF0aW9uID0geyBvcmRlcjogJ2FzYycsIHBhZ2VyOiAnY3Vyc29yJywgY3Vyc29yOiBudWxsLCBjb3VudDogMjUsIHBhZ2VzOiB1bmRlZmluZWQsIGxpbWl0OiB1bmRlZmluZWQgfSxcbiAgICAgICAgaW5kZXg6IHNwZWNpZmllZEluZGV4XG4gICAgfSA9IHF1ZXJ5O1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZVF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICAvLyAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIENoZWNrIGlmIHdlIGhhdmUgYSBmaWx0ZXIgdGhhdCBtYXRjaGVzIGFuIGluZGV4XG4gICAgY29uc3Qgc2NoZW1hID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICBjb25zdCBtYXRjaFJlc3VsdCA9IHNwZWNpZmllZEluZGV4XG4gICAgICAgID8geyBpbmRleE5hbWU6IHNwZWNpZmllZEluZGV4Lm5hbWUsIGluZGV4RmlsdGVyczogc3BlY2lmaWVkSW5kZXguZmlsdGVycyB8fCB7fSB9XG4gICAgICAgIDogZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCBlbnRpdHlOYW1lLCBlbnRpdHlTZXJ2aWNlKTtcblxuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgaW5kZXhRdWVyeS5nbyh7IGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXMgYXMgYW55LCAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBVc2UgbWF0Y2ggZm9yIGZ1bGwgc2NhblxuICAgICAgICBsb2dnZXIud2FybihgV0FSTklORzogTm8gbWF0Y2hpbmcgaW5kZXggZm91bmQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSwgdXNpbmcgbWF0Y2ggZm9yIGZ1bGwgc2NhbmAsIGZpbHRlcnMpO1xuICAgICAgICBjb25zdCBzY2FuUXVlcnkgPSByZXBvc2l0b3J5LnNjYW47XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBzY2FuUXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUT0RPOiBhZGQgYXR0cmlidXRlcyB0byBzY2FuIHF1ZXJ5XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgc2NhblF1ZXJ5LmdvKHJlbW92ZUVtcHR5KHBhZ2luYXRpb24pKTtcbiAgICB9XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyUXVlcnknLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gcXVlcnlFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZmlsdGVycytwYWdpbmc6YCk7XG5cbiAgICByZXR1cm4gZW50aXRpZXM7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciB1cGRhdGluZyBhbiBlbnRpdHkuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBkYXRlRW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBUaGUgSWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byB1cGRhdGUuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2dldCcgXTtcbiAgICAvKipcbiAgICAgKiBUaGUgZGF0YSB0byB1cGRhdGUgdGhlIGVudGl0eSB3aXRoLlxuICAgICAqL1xuICAgIGRhdGE6IE9wc1NjaGVtYVsgJ3VwZGF0ZScgXTtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBhdHRyaWJ1dGVzIGZvciBwYXRjaCBvcGVyYXRpb24uXG4gICAgICovXG4gICAgb3BlcmF0b3JzPzogVXBkYXRlRW50aXR5T3BlcmF0b3JzO1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGNvbmRpdGlvbnMgZm9yIHRoZSB1cGRhdGUgb3BlcmF0aW9uLlxuICAgICAqL1xuICAgIGNvbmRpdGlvbnM/OiBhbnk7IC8vIFRPRE9cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcmUtY2FsY3VsYXRlZCBjb21wb3NpdGUga2V5IGRhdGEuIElmIHByb3ZpZGVkLCB0aGlzIHdpbGwgYmUgdXNlZCBkaXJlY3RseS5cbiAgICAgKiBJZiBub3QgcHJvdmlkZWQgYW5kIGNvbXBvc2l0ZSBrZXlzIGFyZSBuZWVkZWQsIHRoZXkgd2lsbCBiZSBjYWxjdWxhdGVkIGludGVybmFsbHkuXG4gICAgICovXG4gICAgY29tcG9zaXRlS2V5RGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVXBkYXRlRW50aXR5T3BlcmF0b3JzIHtcbiAgICByZW1vdmU/OiBzdHJpbmdbXTtcbn1cblxuaW50ZXJmYWNlIFByZXBhcmVDb21wb3NpdGVBdHRyaWJ1dGVzQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICBpZGVudGlmaWVyczogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICBkYXRhOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogU2V0PHN0cmluZz47XG4gICAgbG9nZ2VyOiBJTG9nZ2VyO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBhcmdzOiBQcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0FyZ3M8Uz5cbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgaWRlbnRpZmllcnMsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcyxcbiAgICAgICAgbG9nZ2VyLFxuICAgIH0gPSBhcmdzO1xuXG4gICAgY29uc3QgY29tcG9zaXRlS2V5VmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgYXR0cmlidXRlc1RvRmV0Y2ggPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBkYXRhQXNSZWNvcmQgPSBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT47IC8vIENhc3QgZm9yIGR5bmFtaWMgYWNjZXNzXG5cbiAgICBpZiAocmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLnNpemUgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHt9OyAvLyBObyBjb21wb3NpdGUgYXR0cmlidXRlcyBuZWVkZWRcbiAgICB9XG5cbiAgICAvLyBvbmx5IGluY2x1ZGUgd2hhdCdzIG5vdCBhbHJlYWR5IGluIGRhdGEgb3IgaWRlbnRpZmllcnNcbiAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuZm9yRWFjaChhdHRyID0+IHtcbiAgICAgICAgaWYgKCFkYXRhQXNSZWNvcmQuaGFzT3duUHJvcGVydHkoYXR0cikgJiYgIWlkZW50aWZpZXJzLmhhc093blByb3BlcnR5KGF0dHIpKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzVG9GZXRjaC5hZGQoYXR0cik7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChhdHRyaWJ1dGVzVG9GZXRjaC5zaXplID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYE5lZWQgdG8gZmV0Y2ggYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXM6YCwgQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlY29yZENvbnRhaW5lciA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpXG4gICAgICAgICAgICAgICAgLmdldChpZGVudGlmaWVycylcbiAgICAgICAgICAgICAgICAuZ28oeyBhdHRyaWJ1dGVzOiBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSwgY29uc2lzdGVudFJlYWQ6IHRydWUgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUmVjb3JkRGF0YSA9IGV4aXN0aW5nUmVjb3JkQ29udGFpbmVyLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgaWYgKCFleGlzdGluZ1JlY29yZERhdGEpIHtcblxuICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBObyBleGlzdGluZyByZWNvcmQgZm91bmQgZm9yIGNvbXBvc2l0ZSBrZXlzOmAsIEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpKTtcblxuICAgICAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNUb0ZldGNoLmZvckVhY2goYXR0ciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1JlY29yZERhdGEuaGFzT3duUHJvcGVydHkoYXR0cikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZUtleVZhbHVlc1sgYXR0ciBdID0gZXhpc3RpbmdSZWNvcmREYXRhWyBhdHRyIF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgQ29tcG9zaXRlIGtleSBhdHRyaWJ1dGUgXCIke2F0dHJ9XCIgKElEOiAke0pTT04uc3RyaW5naWZ5KGlkZW50aWZpZXJzKX0pIHdhcyBub3QgZm91bmQgaW4gcGF5bG9hZCwgaWRlbnRpZmllcnMsIG9yIGV4aXN0aW5nIHJlY29yZC5gKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dnZXIuZXJyb3IoYEVycm9yIGZldGNoaW5nIGF0dHJpYnV0ZXMgZm9yIGNvbXBvc2l0ZSBrZXlzIChJRDogJHtKU09OLnN0cmluZ2lmeShpZGVudGlmaWVycyl9KTpgLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvZ2dlci5kZWJ1ZyhgUHJlcGFyZWQgY29tcG9zaXRlIGtleSB2YWx1ZXM6YCwgY29tcG9zaXRlS2V5VmFsdWVzKTtcbiAgICByZXR1cm4gY29tcG9zaXRlS2V5VmFsdWVzO1xufVxuXG4vKipcbiAqIFVwZGF0ZXMgYW4gZW50aXR5IGluIHRoZSBkYXRhYmFzZS5cbiAqIFxuICogQHRlbXBsYXRlIFMgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHBhcmFtIHtVcGRhdGVFbnRpdHlBcmdzPFM+fSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxFbnRpdHk+fSAtIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSB1cGRhdGVkIGVudGl0eS5cbiAqIEB0aHJvd3Mge0Vycm9yfSAtIElmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIHRoZSB1cGRhdGUgb3BlcmF0aW9uLCBvciBpZiB2YWxpZGF0aW9uIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPikge1xuICAgIGNvbnN0IHtcbiAgICAgICAgaWQsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIG9wZXJhdG9ycyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcbiAgICAgICAgY3J1ZFR5cGUgPSAndXBkYXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6dXBkYXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuICAgICAgICBjb21wb3NpdGVLZXlEYXRhLFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwZGF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIHsgZGF0YSwgcHJvdmlkZWRDb21wb3NpdGVLZXlEYXRhOiBjb21wb3NpdGVLZXlEYXRhIH0pO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIHVwZGF0ZSBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgLy8gcHJlIGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2JlZm9yZVVwZGF0ZScsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGRhdGEsXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBpZGVudGlmaWVycywgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIHVwZGF0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIC0tLSBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgIGlmIChzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICBmb3IgKGNvbnN0IGluZGV4TmFtZSBpbiBzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICAgICAgY29uc3QgaW5kZXhEZWZpbml0aW9uID0gc2NoZW1hLmluZGV4ZXNbIGluZGV4TmFtZSBdO1xuICAgICAgICAgICAgaWYgKGluZGV4RGVmaW5pdGlvbikge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBrQ29tcG9zaXRlID0gaW5kZXhEZWZpbml0aW9uLnBrPy5jb21wb3NpdGU7XG4gICAgICAgICAgICAgICAgaWYgKHBrQ29tcG9zaXRlICYmIEFycmF5LmlzQXJyYXkocGtDb21wb3NpdGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHBrQ29tcG9zaXRlLmZvckVhY2goYXR0ciA9PiBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcy5hZGQoYXR0cikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb25zdCBza0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5zaz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChza0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHNrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBza0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREI6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIGlmIChhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcy5zaXplID4gMCkge1xuICAgICAgICBpZiAoY29tcG9zaXRlS2V5RGF0YSAmJiB0eXBlb2YgY29tcG9zaXRlS2V5RGF0YSA9PT0gJ29iamVjdCcpIHtcblxuICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBwcm92aWRlZCBjb21wb3NpdGVLZXlEYXRhIGZvciB1cGRhdGUuYCwgY29tcG9zaXRlS2V5RGF0YSk7XG5cbiAgICAgICAgICAgIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCID0gY29tcG9zaXRlS2V5RGF0YTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBjb3ZlcnMgYWxsIGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzXG4gICAgICAgICAgICBjb25zdCBtaXNzaW5nRnJvbVByb3ZpZGVkID0gQXJyYXkuZnJvbShhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcykuZmlsdGVyKGF0dHIgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICFkYXRhLmhhc093blByb3BlcnR5KGF0dHIpXG4gICAgICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgICAgICFpZGVudGlmaWVycy5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChtaXNzaW5nRnJvbVByb3ZpZGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgUHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBpcyBtaXNzaW5nIHNvbWUgcmVxdWlyZWQgY29tcG9zaXRlIGF0dHJpYnV0ZXM6ICR7bWlzc2luZ0Zyb21Qcm92aWRlZC5qb2luKCcsICcpfS4gVXBkYXRlIG1heSBmYWlsIGlmIHRoZXNlIGFyZSBuZWVkZWQgYnkgRWxlY3Ryb0RCLmApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlS2V5RGF0YSBwcm92aWRlZCwgcHJlcGFyaW5nIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzIGludGVybmFsbHkuIFJlcXVpcmVkOmAsIEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpKTtcblxuICAgICAgICAgICAgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIgPSBhd2FpdCBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBkYXRhOiBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT4sXG4gICAgICAgICAgICAgICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzOiBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICBsb2dnZXIsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBObyBjb21wb3NpdGUgYXR0cmlidXRlcyBkZWZpbmVkIGluIHNjaGVtYSBvciBuZWVkZWQgZm9yIHRoaXMgdXBkYXRlLmApO1xuICAgIH1cbiAgICAvLyAtLS0gRW5kIENvbXBvc2l0ZSBLZXkgSGFuZGxpbmcgLS0tXG5cblxuICAgIFxuICAgIC8vIFVzZSBFbGVjdHJvREIgZm9yIGFsbCBmaWVsZHMgaW5jbHVkaW5nIF9hY3RvciAobm93IGluIHNjaGVtYSlcbiAgICBjb25zdCBxdWVyeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLnBhdGNoKGlkZW50aWZpZXJzKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBjb21wb3NpdGUgdmFsdWVzIGZvciBFbGVjdHJvREIgcGF0Y2g6YCwgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgICAgICBxdWVyeS5jb21wb3NpdGUoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRvcnM/LnJlbW92ZSkge1xuICAgICAgICBxdWVyeS5yZW1vdmUob3BlcmF0b3JzLnJlbW92ZSBhcyBhbnkpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IHF1ZXJ5LmdvKCk7XG5cblxuXG4gICAgLy8gLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclVwZGF0ZScsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5O1xufVxuXG4vKipcbiAqIHRoZSBhcmd1bWVudHMgZm9yIGRlbGV0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2RlbGV0ZScgXTtcbn1cblxuLyoqXG4gKiBEZWxldGVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgZGVsZXRlZCBlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogRGVsZXRlRW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBpZCxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2RlbGV0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmRlbGV0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlRGVsZXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGRlbGV0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVycykuZ28oKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdhZnRlckRlbGV0ZScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICByZXR1cm4gZW50aXR5O1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsdGVyIG9iamVjdCB3aXRoIGVxIG9wZXJhdG9ycyB0byBhIHNpbXBsaWZpZWQgZm9ybS5cbiAqIEV4YW1wbGU6IHsgYWdlOiB7IGVxOiA2NSB9IH0gYmVjb21lcyB7IGFnZTogNjUgfVxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVyIG9iamVjdCB0byBzaW1wbGlmeVxuICogQHJldHVybnMgQSBuZXcgZmlsdGVyIG9iamVjdCB3aXRoIGVxIG9wZXJhdG9ycyBjb252ZXJ0ZWQgdG8gZGlyZWN0IHZhbHVlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gc2ltcGxpZnlGaWx0ZXJzKGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBpZiAoIWZpbHRlcnMpIHJldHVybiB7fTtcblxuICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVycykpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgJ2VxJyBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlLmVxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIGV4cG9ydCBjbGFzcyBFbnRpdHlDcnVkU2VydmljZTxTIGV4dGVuZHMgU2NoZW1hPGFueSwgYW55LCBhbnk+PntcblxuLy8gICAgIHB1YmxpYyBhc3luYyBsaXN0KG9wdGlvbnM6IExpc3RFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBsaXN0RW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBjcmVhdGUob3B0aW9uczogQ3JlYXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgY3JlYXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyB1cGRhdGUob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgdXBkYXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBnZXQob3B0aW9uczogR2V0RW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgZ2V0RW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBkZWxldGUob3B0aW9uczogRGVsZXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgZGVsZXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cbi8vIH1cblxuXG4vLyBleHBvcnQgY29uc3QgRGVmYXVsdEVudGl0eUNydWRTZXJ2aWNlID0gbmV3IEVudGl0eUNydWRTZXJ2aWNlKCk7Il19