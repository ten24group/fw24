"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEntity = getEntity;
exports.getBatchEntity = getBatchEntity;
exports.createEntity = createEntity;
exports.upsertEntity = upsertEntity;
exports.filterGroupToSimpleFormat = filterGroupToSimpleFormat;
exports.findMatchingIndex = findMatchingIndex;
exports.listEntity = listEntity;
exports.queryEntity = queryEntity;
exports.updateEntity = updateEntity;
exports.deleteEntity = deleteEntity;
exports.deleteBatchEntity = deleteBatchEntity;
exports.simplifyFilters = simplifyFilters;
const authorize_1 = require("../authorize");
const event_1 = require("../event");
const logging_1 = require("../logging");
const utils_1 = require("../utils");
const validation_1 = require("../validation");
const validation_error_1 = require("./errors/validation-error");
const query_1 = require("./query");
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
 * @returns The created entity with wasCreated flag indicating if it was a new record.
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
    // Use "all_old" to get the previous item state - allows us to detect create vs update
    // If oldData is empty/null, it was a CREATE. If it has data, it was an UPDATE.
    const entity = await entityService.getRepository().upsert(data).go({ response: "all_old" });
    const wasCreated = !entity.data || Object.keys(entity.data).length === 0;
    const oldData = wasCreated ? undefined : entity.data;
    // post events
    // await eventDispatcher?.dispatch({ event: 'afterUpsert', context: {...arguments, entity} });
    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ upsert ~ entityName: ${entityName} ~ wasCreated: ${wasCreated}`);
    // Note: with "all_old", entity.data contains the OLD data, we need to return the NEW data
    // Since we don't have the new data from DynamoDB, we return the input data as the new data
    return {
        data: data, // The new data we just upserted
        wasCreated,
        oldData
    };
}
/**
 * Operators that should NOT be used for index matching.
 * These operators look for records where the attribute doesn't exist or is empty,
 * but those records won't be in a sparse GSI where that attribute is the PK.
 */
const INDEX_EXCLUDED_OPERATORS = new Set([
    'notExists', 'exists', 'isNull', 'notNull', 'empty', 'notEmpty'
]);
/**
 * Convert FilterGroup format to simple object format for index matching.
 * FilterGroup: { and: [{ attribute: 'foo', eq: 'bar' }] }
 * Simple: { foo: { eq: 'bar' } }
 *
 * Only extracts filters from the 'and' array as those are the ones
 * that can be used for GSI partition key matching.
 *
 * Excludes existence/null filters (notExists, isNull, empty, etc.) from index
 * matching since records with missing attributes won't be in sparse GSIs.
 *
 * @param filters - The filters in FilterGroup or simple format
 * @returns Filters in simple object format { attr: { op: val } }
 */
function filterGroupToSimpleFormat(filters) {
    // Already in simple format or empty
    if (!filters || !('and' in filters)) {
        return filters || {};
    }
    const simple = {};
    // Extract from 'and' array - these are AND conditions that could match GSI PK
    for (const item of filters.and || []) {
        if (item.attribute) {
            const operators = {};
            for (const [key, value] of Object.entries(item)) {
                // Skip the 'attribute' key and exclude existence/null operators from index matching
                // Records with missing attributes won't be in sparse GSIs
                if (key !== 'attribute' && !INDEX_EXCLUDED_OPERATORS.has(key)) {
                    operators[key] = value;
                }
            }
            if (Object.keys(operators).length > 0) {
                simple[item.attribute] = operators;
            }
        }
    }
    return simple;
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
    // Convert FilterGroup format to simple format for index matching
    const simpleFilters = filterGroupToSimpleFormat(filters);
    logger.debug(`Converted filters for index matching:`, { original: filters, simple: simpleFilters });
    // First try ElectroDB's index matching
    const repository = entityService.getRepository();
    const { keys, index, shouldScan } = repository._findBestIndexKeyMatch(simpleFilters);
    logger.debug(`Found ElectroDB index: ${index} with ${keys.length} attribute matches for entity: ${entityName} with filters and scan: ${shouldScan} - `, keys, simpleFilters);
    // If we found a matching index, use it
    if (!shouldScan) {
        const indexFilters = {};
        // Add matched keys to indexFilters (use simpleFilters which has the right format)
        keys.forEach((key) => {
            const filterValue = simpleFilters[key.name];
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
 * Deletes multiple entities in a batch operation.
 * @param options - The options for deleting the entities.
 * @returns The unprocessed items that couldn't be deleted.
 */
async function deleteBatchEntity(options) {
    const { ids, entityName, entityService, concurrent = 1, actor, tenant, crudType = 'delete', logger = (0, logging_1.createLogger)('CRUD-service:deleteBatchEntity'), validator = validation_1.DefaultValidator, authorizer = authorize_1.Authorizer.Default, eventDispatcher = event_1.EventDispatcher.Default, } = options;
    logger.debug(`Called EntityCrud ~ deleteBatchEntity ~ entityName: ${entityName}:`, { ids, concurrent });
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
    // Perform batch delete operation with concurrency control
    // Per ElectroDB docs: http://electrodb.dev/en/mutations/batch-delete/
    // Note: ElectroDB types use 'concurrency' while docs show 'concurrent'
    const bulkOptions = {
        concurrency: concurrent
    };
    const electroResult = await entityService.getRepository().delete(identifiersBatch).go(bulkOptions);
    logger.debug(`Completed EntityCrud ~ deleteBatchEntity ~ entityName: ${entityName} ~ ids:`, ids);
    return electroResult;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUF5RUEsOEJBcURDO0FBOEJELHdDQTZEQztBQTRCRCxvQ0F1REM7QUErQkQsb0NBa0VDO0FBaUNELDhEQTBCQztBQVVELDhDQWtFQztBQVFELGdDQW9FQztBQVdELGtDQW9FQztBQW9IRCxvQ0F3SUM7QUFzQkQsb0NBbURDO0FBMEJELDhDQTREQztBQVFELDBDQVlDO0FBN2xDRCw0Q0FBMEM7QUFDMUMsb0NBQTJDO0FBQzNDLHdDQUFtRDtBQUNuRCxvQ0FBc0Q7QUFDdEQsOENBQWtFO0FBRWxFLGdFQUFrRTtBQUVsRSxtQ0FBMkQ7QUEyRDNEOzs7O0dBSUc7QUFDSSxLQUFLLFVBQVUsU0FBUyxDQUF3QyxPQUF5QjtJQUU1RixNQUFNLEVBQ0YsRUFBRSxFQUNGLFVBQVUsRUFDVixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLEtBQUssRUFDaEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyx3QkFBd0IsQ0FBQyxFQUMvQyxTQUFTLEdBQUcsNkJBQWdCLEVBQzVCLFVBQVUsR0FBRyxzQkFBVSxDQUFDLE9BQU8sRUFDL0IsZUFBZSxHQUFHLHVCQUFlLENBQUMsT0FBTyxHQUU1QyxHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sQ0FBQyxLQUFLLENBQUMsK0NBQStDLFVBQVUsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFL0YsNkVBQTZFO0lBRTdFLE1BQU0sV0FBVyxHQUFHLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUUvRCxzQkFBc0I7SUFDdEIsd0dBQXdHO0lBQ3hHLDJCQUEyQjtJQUMzQixvRkFBb0Y7SUFDcEYsSUFBSTtJQUdKLGNBQWM7SUFDZCxNQUFNLFVB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QW1FIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBCdWxrT3B0aW9ucyB9IGZyb20gXCJlbGVjdHJvZGJcIjtcbmltcG9ydCB7IEF1dGhvcml6ZXIgfSBmcm9tIFwiLi4vYXV0aG9yaXplXCI7XG5pbXBvcnQgeyBFdmVudERpc3BhdGNoZXIgfSBmcm9tIFwiLi4vZXZlbnRcIjtcbmltcG9ydCB7IElMb2dnZXIsIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBpc0VtcHR5T2JqZWN0LCByZW1vdmVFbXB0eSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgRGVmYXVsdFZhbGlkYXRvciwgdHlwZSBJVmFsaWRhdG9yIH0gZnJvbSBcIi4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSwgRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hLCBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHsgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSBcIi4vZXJyb3JzL3ZhbGlkYXRpb24tZXJyb3JcIjtcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uIH0gZnJvbSBcIi4vcXVlcnlcIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5UXVlcnkgfSBmcm9tIFwiLi9xdWVyeS10eXBlc1wiO1xuXG4vKipcbiAqIFxuICogU2VyaWFsaXplci9mb3JtYXR0ZXJcbiAqICAtIGh0dHBzOi8vZ2l0aHViLmNvbS9ka3psdi9taWNyby10cmFuc2Zvcm1cbiAqICBcbiAqIEV2ZW50IGRpc3BhdGNoZXJcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL0ZveEFuZEZseS90cy1ldmVudC1kaXNwYXRjaGVyL2Jsb2IvbWFzdGVyL3NyYy9pbmRleC50c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vcnlhcmRsZXkvdHMtYnVzXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9iaW5pZXIvdGlueS10eXBlZC1lbWl0dGVyL3RyZWUvbWFzdGVyXG4gKiBcbiAqIFJvdXRlclxuICogLSBodHRwczovL2dpdGh1Yi5jb20vYmVyc3RlbmQvdGlueS1yZXF1ZXN0LXJvdXRlci9ibG9iL21hc3Rlci9zcmMvcm91dGVyLnRzXG4gKiBcbiAqIERJXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9uaWNvanMvdHlwZWQtaW5qZWN0XG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9taWNyb3NvZnQvdHN5cmluZ2VcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL293amEvaW9jXG4gKiBcbiAqIFxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFzZUVudGl0eUNydWRBcmdzPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IHtcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmc7XG4gICAgZW50aXR5U2VydmljZTogRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hPFM+O1xuXG4gICAgY3J1ZFR5cGU/OiBrZXlvZiBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnM7XG4gICAgYWN0b3I/OiBBY3RvcjsgLy8gQWN0b3IgY29udGV4dDogY29tcHJlaGVuc2l2ZSBhY3RvciBpbmZvcm1hdGlvbiBpbmNsdWRpbmcgYXV0aGVudGljYXRpb24gZGV0YWlsc1xuICAgIHRlbmFudD86IGFueTsgLy8gdG9kbzogZGVmaW5lIHRlbmFudCBjb250ZXh0XG5cbiAgICBsb2dnZXI/OiBJTG9nZ2VyO1xuICAgIHZhbGlkYXRvcj86IElWYWxpZGF0b3I7XG4gICAgYXV0aG9yaXplcj86IEF1dGhvcml6ZXIuSUF1dGhvcml6ZXI7ICAgICAgICAvLyB0b2RvOiBkZWZpbmUgYXV0aG9yaXplciBzaWduYXR1cmVcbiAgICBldmVudERpc3BhdGNoZXI/OiBFdmVudERpc3BhdGNoZXIuSUV2ZW50RGlzcGF0Y2hlcjsgIC8vIHRvZG8gZGVmaW5lIGV2ZW50IGRpc3BhdGNoZXIgc2lnbmF0dXJlXG5cbiAgICAvLyB0ZWxlbWV0cnlcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIHJldHJpZXZpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdldEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElEIG9mIHRoZSBlbnRpdHkgdG8gcmV0cmlldmUuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2dldCcgXTtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgaW4gdGhlIHJldHJpZXZlZCBlbnRpdHkuXG4gICAgICovXG4gICAgYXR0cmlidXRlcz86IEFycmF5PHN0cmluZz47XG59XG5cbi8qKlxuICogUmV0cmlldmVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHJldHJpZXZpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IEdldEVudGl0eUFyZ3M8Uz4pIHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgaWQsXG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdnZXQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpnZXRFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBnZXRFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9OmAsIHsgaWQsIGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlR2V0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGdldDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuXG4gICAgLy8gLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZ2V0KGlkZW50aWZpZXJzKS5nbyh7IGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYWZ0ZXJHZXQnLCBjb250ZXh0OiBhcmd1bWVudHN9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBnZXRFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWQ6YCwgaWQpO1xuXG4gICAgcmV0dXJuIGVudGl0eTtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIHJldHJpZXZpbmcgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaC5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRCYXRjaEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgZW50aXR5IElEcyB0byByZXRyaWV2ZS5cbiAgICAgKi9cbiAgICBpZHM6IEFycmF5PE9wc1NjaGVtYVsgJ2dldCcgXT47XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byBpbmNsdWRlIGluIHRoZSByZXRyaWV2ZWQgZW50aXRpZXMuXG4gICAgICovXG4gICAgYXR0cmlidXRlcz86IEFycmF5PHN0cmluZz47XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyAoZGVmYXVsdDogMSkuXG4gICAgICovXG4gICAgY29uY3VycmVudD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZXMgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciByZXRyaWV2aW5nIHRoZSBlbnRpdGllcy5cbiAqIEByZXR1cm5zIFRoZSByZXRyaWV2ZWQgZW50aXRpZXMgYW5kIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEJhdGNoRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IEdldEJhdGNoRW50aXR5QXJnczxTPikge1xuICAgIGNvbnN0IHtcbiAgICAgICAgaWRzLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICBjb25jdXJyZW50ID0gMSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2dldCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmdldEJhdGNoRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGdldEJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkcywgYXR0cmlidXRlcyB9KTtcblxuICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZm9yIGFsbCBpdGVtcyBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaWRzLm1hcChpZCA9PiBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCkpO1xuXG4gICAgLy8gVmFsaWRhdGUgZWFjaCBpdGVtIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IHZhbGlkYXRpb25zID0gYXdhaXQgUHJvbWlzZS5hbGwoaWRlbnRpZmllcnNCYXRjaC5tYXAoYXN5bmMgaWRlbnRpZmllcnMgPT5cbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgICAgIGlucHV0OiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGFjdG9yOiBhY3RvclxuICAgICAgICB9KVxuICAgICkpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHZhbGlkYXRpb24gZXJyb3JzXG4gICAgY29uc3QgdmFsaWRhdGlvbkVycm9ycyA9IHZhbGlkYXRpb25zXG4gICAgICAgIC5tYXAoKHZhbGlkYXRpb24sIGluZGV4KSA9PiAoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSlcbiAgICAgICAgLmZpbHRlcigoeyB2YWxpZGF0aW9uIH0pID0+ICF2YWxpZGF0aW9uLnBhc3MpO1xuXG4gICAgaWYgKHZhbGlkYXRpb25FcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb25FcnJvcnMuZmxhdE1hcCgoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSA9PlxuICAgICAgICAgICAgKHZhbGlkYXRpb24uZXJyb3JzIHx8IFtdKS5tYXAoZXJyb3IgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5lcnJvcixcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBgSXRlbSAke2luZGV4fTogJHtlcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgIH0pKVxuICAgICAgICApKTtcbiAgICB9XG5cbiAgICAvLyBQZXJmb3JtIGJhdGNoIGdldCBvcGVyYXRpb24gd2l0aCBjb25jdXJyZW5jeSBjb250cm9sXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZ2V0KGlkZW50aWZpZXJzQmF0Y2gpLmdvKHtcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgY29uY3VycmVudFxuICAgIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGdldEJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkczpgLCBpZHMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZGF0YTogQXJyYXkuaXNBcnJheShyZXN1bHQuZGF0YSkgPyByZXN1bHQuZGF0YSA6IChyZXN1bHQuZGF0YSA/IFsgcmVzdWx0LmRhdGEgXSA6IFtdKSxcbiAgICAgICAgdW5wcm9jZXNzZWQ6IFtdICAvLyBFbGVjdHJvREIgZG9lc24ndCBzdXBwb3J0IHVucHJvY2Vzc2VkIGl0ZW1zIHRyYWNraW5nLCBzbyB3ZSByZXR1cm4gZW1wdHkgYXJyYXlcbiAgICB9O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENyZWF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAnY3JlYXRlJyBdO1xufVxuXG5leHBvcnQgdHlwZSBDcmVhdGVFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgdXNpbmcgdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkuXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIGNyZWF0ZSBvcGVyYXRpb24sIHZhbGlkYXRpb24gZmFpbHMsIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogQ3JlYXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8Q3JlYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdjcmVhdGUnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpjcmVhdGVFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiBjcmVhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhKTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciBjcmVhdGUgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVDcmVhdGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3IsXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBkYXRhLCBhY3RvciwgdGVuYW50IH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgY3JlYXRlOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuY3JlYXRlKGRhdGEpLmdvKCk7XG5cbiAgICAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyQ3JlYXRlJywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IGNyZWF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEsIGVudGl0eS5kYXRhKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgQ3JlYXRlRW50aXR5UmVzcG9uc2U8Uz47XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGNyZWF0aW5nLU9SLXVwZGF0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVcHNlcnRFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBkYXRhIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqL1xuICAgIGRhdGE6IE9wc1NjaGVtYVsgJ3Vwc2VydCcgXTtcbn1cblxuZXhwb3J0IHR5cGUgVXBzZXJ0RW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxuICAgIHdhc0NyZWF0ZWQ/OiBib29sZWFuICAvLyB0cnVlIGlmIHJlY29yZCB3YXMgY3JlYXRlZCwgZmFsc2UgaWYgYWxyZWFkeSBleGlzdGVkXG4gICAgb2xkRGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD4gIC8vIHByZXZpb3VzIGRhdGEgaWYgaXQgd2FzIGFuIHVwZGF0ZSAodW5kZWZpbmVkIGZvciBjcmVhdGVzKVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gZW50aXR5IHVzaW5nIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMgVGhlIGNyZWF0ZWQgZW50aXR5IHdpdGggd2FzQ3JlYXRlZCBmbGFnIGluZGljYXRpbmcgaWYgaXQgd2FzIGEgbmV3IHJlY29yZC5cbiAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gZGF0YSBpcyBwcm92aWRlZCBmb3IgdXBzZXJ0IG9wZXJhdGlvbiwgdmFsaWRhdGlvbiBmYWlscywgb3IgYXV0aG9yaXphdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwc2VydEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBVcHNlcnRFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxVcHNlcnRFbnRpdHlSZXNwb25zZTxTPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ3Vwc2VydCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwc2VydEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEpO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIHVwc2VydCBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgLy8gcHJlIGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2JlZm9yZVVwc2VydCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGRhdGEsXG4gICAgICAgIGFjdG9yOiBhY3RvcixcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3IgXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHsgZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciB1cHNlcnQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBVc2UgXCJhbGxfb2xkXCIgdG8gZ2V0IHRoZSBwcmV2aW91cyBpdGVtIHN0YXRlIC0gYWxsb3dzIHVzIHRvIGRldGVjdCBjcmVhdGUgdnMgdXBkYXRlXG4gICAgLy8gSWYgb2xkRGF0YSBpcyBlbXB0eS9udWxsLCBpdCB3YXMgYSBDUkVBVEUuIElmIGl0IGhhcyBkYXRhLCBpdCB3YXMgYW4gVVBEQVRFLlxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLnVwc2VydChkYXRhIGFzIGFueSkuZ28oeyByZXNwb25zZTogXCJhbGxfb2xkXCIgfSk7XG5cbiAgICBjb25zdCB3YXNDcmVhdGVkID0gIWVudGl0eS5kYXRhIHx8IE9iamVjdC5rZXlzKGVudGl0eS5kYXRhKS5sZW5ndGggPT09IDA7XG4gICAgY29uc3Qgb2xkRGF0YSA9IHdhc0NyZWF0ZWQgPyB1bmRlZmluZWQgOiBlbnRpdHkuZGF0YTtcblxuICAgIC8vIHBvc3QgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJVcHNlcnQnLCBjb250ZXh0OiB7Li4uYXJndW1lbnRzLCBlbnRpdHl9IH0pO1xuXG4gICAgLy8gcmV0dXJuIGVudGl0eTtcbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IHdhc0NyZWF0ZWQ6ICR7d2FzQ3JlYXRlZH1gKTtcblxuICAgIC8vIE5vdGU6IHdpdGggXCJhbGxfb2xkXCIsIGVudGl0eS5kYXRhIGNvbnRhaW5zIHRoZSBPTEQgZGF0YSwgd2UgbmVlZCB0byByZXR1cm4gdGhlIE5FVyBkYXRhXG4gICAgLy8gU2luY2Ugd2UgZG9uJ3QgaGF2ZSB0aGUgbmV3IGRhdGEgZnJvbSBEeW5hbW9EQiwgd2UgcmV0dXJuIHRoZSBpbnB1dCBkYXRhIGFzIHRoZSBuZXcgZGF0YVxuICAgIHJldHVybiB7XG4gICAgICAgIGRhdGE6IGRhdGEgYXMgYW55LCAgLy8gVGhlIG5ldyBkYXRhIHdlIGp1c3QgdXBzZXJ0ZWRcbiAgICAgICAgd2FzQ3JlYXRlZCxcbiAgICAgICAgb2xkRGF0YVxuICAgIH0gYXMgVXBzZXJ0RW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBsaXN0aW5nIGVudGl0aWVzLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGlzdEVudGl0eUFyZ3M8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICBxdWVyeTogRW50aXR5UXVlcnk8U2NoPlxufVxuXG4vKipcbiAqIE9wZXJhdG9ycyB0aGF0IHNob3VsZCBOT1QgYmUgdXNlZCBmb3IgaW5kZXggbWF0Y2hpbmcuXG4gKiBUaGVzZSBvcGVyYXRvcnMgbG9vayBmb3IgcmVjb3JkcyB3aGVyZSB0aGUgYXR0cmlidXRlIGRvZXNuJ3QgZXhpc3Qgb3IgaXMgZW1wdHksXG4gKiBidXQgdGhvc2UgcmVjb3JkcyB3b24ndCBiZSBpbiBhIHNwYXJzZSBHU0kgd2hlcmUgdGhhdCBhdHRyaWJ1dGUgaXMgdGhlIFBLLlxuICovXG5jb25zdCBJTkRFWF9FWENMVURFRF9PUEVSQVRPUlMgPSBuZXcgU2V0KFtcbiAgICAnbm90RXhpc3RzJywgJ2V4aXN0cycsICdpc051bGwnLCAnbm90TnVsbCcsICdlbXB0eScsICdub3RFbXB0eSdcbl0pO1xuXG4vKipcbiAqIENvbnZlcnQgRmlsdGVyR3JvdXAgZm9ybWF0IHRvIHNpbXBsZSBvYmplY3QgZm9ybWF0IGZvciBpbmRleCBtYXRjaGluZy5cbiAqIEZpbHRlckdyb3VwOiB7IGFuZDogW3sgYXR0cmlidXRlOiAnZm9vJywgZXE6ICdiYXInIH1dIH1cbiAqIFNpbXBsZTogeyBmb286IHsgZXE6ICdiYXInIH0gfVxuICogXG4gKiBPbmx5IGV4dHJhY3RzIGZpbHRlcnMgZnJvbSB0aGUgJ2FuZCcgYXJyYXkgYXMgdGhvc2UgYXJlIHRoZSBvbmVzXG4gKiB0aGF0IGNhbiBiZSB1c2VkIGZvciBHU0kgcGFydGl0aW9uIGtleSBtYXRjaGluZy5cbiAqIFxuICogRXhjbHVkZXMgZXhpc3RlbmNlL251bGwgZmlsdGVycyAobm90RXhpc3RzLCBpc051bGwsIGVtcHR5LCBldGMuKSBmcm9tIGluZGV4XG4gKiBtYXRjaGluZyBzaW5jZSByZWNvcmRzIHdpdGggbWlzc2luZyBhdHRyaWJ1dGVzIHdvbid0IGJlIGluIHNwYXJzZSBHU0lzLlxuICogXG4gKiBAcGFyYW0gZmlsdGVycyAtIFRoZSBmaWx0ZXJzIGluIEZpbHRlckdyb3VwIG9yIHNpbXBsZSBmb3JtYXRcbiAqIEByZXR1cm5zIEZpbHRlcnMgaW4gc2ltcGxlIG9iamVjdCBmb3JtYXQgeyBhdHRyOiB7IG9wOiB2YWwgfSB9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4pOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICAvLyBBbHJlYWR5IGluIHNpbXBsZSBmb3JtYXQgb3IgZW1wdHlcbiAgICBpZiAoIWZpbHRlcnMgfHwgISgnYW5kJyBpbiBmaWx0ZXJzKSkge1xuICAgICAgICByZXR1cm4gZmlsdGVycyB8fCB7fTtcbiAgICB9XG5cbiAgICBjb25zdCBzaW1wbGU6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIC8vIEV4dHJhY3QgZnJvbSAnYW5kJyBhcnJheSAtIHRoZXNlIGFyZSBBTkQgY29uZGl0aW9ucyB0aGF0IGNvdWxkIG1hdGNoIEdTSSBQS1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBmaWx0ZXJzLmFuZCB8fCBbXSkge1xuICAgICAgICBpZiAoaXRlbS5hdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdG9yczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhpdGVtKSkge1xuICAgICAgICAgICAgICAgIC8vIFNraXAgdGhlICdhdHRyaWJ1dGUnIGtleSBhbmQgZXhjbHVkZSBleGlzdGVuY2UvbnVsbCBvcGVyYXRvcnMgZnJvbSBpbmRleCBtYXRjaGluZ1xuICAgICAgICAgICAgICAgIC8vIFJlY29yZHMgd2l0aCBtaXNzaW5nIGF0dHJpYnV0ZXMgd29uJ3QgYmUgaW4gc3BhcnNlIEdTSXNcbiAgICAgICAgICAgICAgICBpZiAoa2V5ICE9PSAnYXR0cmlidXRlJyAmJiAhSU5ERVhfRVhDTFVERURfT1BFUkFUT1JTLmhhcyhrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIG9wZXJhdG9yc1sga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMob3BlcmF0b3JzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc2ltcGxlWyBpdGVtLmF0dHJpYnV0ZSBdID0gb3BlcmF0b3JzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNpbXBsZTtcbn1cblxuLyoqXG4gKiBGaW5kcyBhIG1hdGNoaW5nIGluZGV4IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBmaWx0ZXJzIGFuZCBzY2hlbWEuXG4gKiBAcGFyYW0gc2NoZW1hIC0gVGhlIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBmaWx0ZXJzIC0gVGhlIGZpbHRlcnMgdG8gbWF0Y2ggYWdhaW5zdFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgZW50aXR5XG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIFRoZSBlbnRpdHkgc2VydmljZVxuICogQHJldHVybnMgVGhlIG5hbWUgb2YgdGhlIG1hdGNoaW5nIGluZGV4IGFuZCB0aGUgZmlsdGVycyB1c2VkIHRvIG1hdGNoIGl0IG9yIHVuZGVmaW5lZCBpZiBubyBtYXRjaCBpcyBmb3VuZFxuICovXG5leHBvcnQgZnVuY3Rpb24gZmluZE1hdGNoaW5nSW5kZXgoXG4gICAgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5U2VydmljZTogRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hPGFueT5cbik6IHsgaW5kZXhOYW1lOiBzdHJpbmc7IGluZGV4RmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB9IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpmaW5kTWF0Y2hpbmdJbmRleCcpO1xuICAgIGlmICghZmlsdGVycykgZmlsdGVycyA9IHt9O1xuXG4gICAgLy8gQ29udmVydCBGaWx0ZXJHcm91cCBmb3JtYXQgdG8gc2ltcGxlIGZvcm1hdCBmb3IgaW5kZXggbWF0Y2hpbmdcbiAgICBjb25zdCBzaW1wbGVGaWx0ZXJzID0gZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJzKTtcbiAgICBsb2dnZXIuZGVidWcoYENvbnZlcnRlZCBmaWx0ZXJzIGZvciBpbmRleCBtYXRjaGluZzpgLCB7IG9yaWdpbmFsOiBmaWx0ZXJzLCBzaW1wbGU6IHNpbXBsZUZpbHRlcnMgfSk7XG5cbiAgICAvLyBGaXJzdCB0cnkgRWxlY3Ryb0RCJ3MgaW5kZXggbWF0Y2hpbmdcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG4gICAgY29uc3QgeyBrZXlzLCBpbmRleCwgc2hvdWxkU2NhbiB9ID0gKHJlcG9zaXRvcnkgYXMgYW55KS5fZmluZEJlc3RJbmRleEtleU1hdGNoKHNpbXBsZUZpbHRlcnMpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBGb3VuZCBFbGVjdHJvREIgaW5kZXg6ICR7aW5kZXh9IHdpdGggJHtrZXlzLmxlbmd0aH0gYXR0cmlidXRlIG1hdGNoZXMgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSB3aXRoIGZpbHRlcnMgYW5kIHNjYW46ICR7c2hvdWxkU2Nhbn0gLSBgLCBrZXlzLCBzaW1wbGVGaWx0ZXJzKTtcblxuICAgIC8vIElmIHdlIGZvdW5kIGEgbWF0Y2hpbmcgaW5kZXgsIHVzZSBpdFxuICAgIGlmICghc2hvdWxkU2Nhbikge1xuICAgICAgICBjb25zdCBpbmRleEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgICAgICAvLyBBZGQgbWF0Y2hlZCBrZXlzIHRvIGluZGV4RmlsdGVycyAodXNlIHNpbXBsZUZpbHRlcnMgd2hpY2ggaGFzIHRoZSByaWdodCBmb3JtYXQpXG4gICAgICAgIGtleXMuZm9yRWFjaCgoa2V5OiB7IG5hbWU6IHN0cmluZzsgdHlwZTogc3RyaW5nIH0pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlclZhbHVlID0gc2ltcGxlRmlsdGVyc1sga2V5Lm5hbWUgXTtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJWYWx1ZSkge1xuICAgICAgICAgICAgICAgIC8vIEhhbmRsZSBib3RoIHsgZXE6IHZhbHVlIH0gYW5kIGRpcmVjdCB2YWx1ZSBmb3JtYXRzXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzWyBrZXkubmFtZSBdID0gZmlsdGVyVmFsdWUuZXEgIT09IHVuZGVmaW5lZCA/IGZpbHRlclZhbHVlLmVxIDogZmlsdGVyVmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIE1hcCBFbGVjdHJvREIncyBpbnRlcm5hbCBpbmRleCBuYW1lIGJhY2sgdG8gb3VyIHNjaGVtYSdzIGluZGV4IG5hbWVcbiAgICAgICAgbGV0IHNjaGVtYUluZGV4TmFtZSA9IGluZGV4O1xuICAgICAgICBpZiAoaW5kZXggPT09ICcnKSB7XG4gICAgICAgICAgICBzY2hlbWFJbmRleE5hbWUgPSAncHJpbWFyeSc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBGaW5kIHRoZSBpbmRleCBpbiBvdXIgc2NoZW1hIHRoYXQgbWF0Y2hlcyB0aGlzIEdTSVxuICAgICAgICAgICAgY29uc3QgaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIG5hbWUsIGluZGV4RGVmIF0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXhlcykpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXhEZWYuaW5kZXggPT09IGluZGV4KSB7XG4gICAgICAgICAgICAgICAgICAgIHNjaGVtYUluZGV4TmFtZSA9IG5hbWU7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgRWxlY3Ryb0RCIG1hdGNoZWQgaW5kZXg6ICR7c2NoZW1hSW5kZXhOYW1lfSAoaW50ZXJuYWw6ICR7aW5kZXh9KSB3aXRoICR7a2V5cy5sZW5ndGh9IGF0dHJpYnV0ZSBtYXRjaGVzIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0gd2l0aCBmaWx0ZXJzOmAsIGluZGV4RmlsdGVycyk7XG4gICAgICAgIHJldHVybiB7IGluZGV4TmFtZTogc2NoZW1hSW5kZXhOYW1lLCBpbmRleEZpbHRlcnMgfTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBpbmRleCBtYXRjaCBmb3VuZCwgY2hlY2sgZm9yIHRlbXBsYXRlIG1hdGNoXG4gICAgY29uc3QgaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgIGZvciAoY29uc3QgWyBpbmRleE5hbWUsIGluZGV4RGVmIF0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXhlcykpIHtcbiAgICAgICAgaWYgKGluZGV4RGVmLnBrLnRlbXBsYXRlICYmXG4gICAgICAgICAgICB0eXBlb2YgaW5kZXhEZWYucGsudGVtcGxhdGUgPT09ICdzdHJpbmcnICYmXG4gICAgICAgICAgICBpbmRleERlZi5way50ZW1wbGF0ZS50b0xvd2VyQ2FzZSgpID09PSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCkpIHtcbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgdGVtcGxhdGUgbWF0Y2hpbmcgaW5kZXg6ICR7aW5kZXhOYW1lfSBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZXMgYSBsaXN0IG9mIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICpcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGxpc3RpbmcgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBhcnJheSBvZiBlbnRpdGllcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxpc3RFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogTGlzdEVudGl0eUFyZ3M8Uz4pIHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2xpc3QnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpsaXN0RW50aXR5JyksXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgICAgIHF1ZXJ5ID0ge30sXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGZpbHRlcnMgPSB7fSxcbiAgICAgICAgYXR0cmlidXRlcyA9IFtdLFxuICAgICAgICBwYWdpbmF0aW9uID0geyBvcmRlcjogJ2FzYycsIHBhZ2VyOiAnY3Vyc29yJywgY3Vyc29yOiBudWxsLCBjb3VudDogMjUsIHBhZ2VzOiB1bmRlZmluZWQsIGxpbWl0OiB1bmRlZmluZWQgfSxcbiAgICAgICAgaW5kZXg6IHNwZWNpZmllZEluZGV4XG4gICAgfSA9IHF1ZXJ5O1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGxpc3RFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZmlsdGVycytwYWdpbmc6YCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlTGlzdCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3JcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoe2VudGl0eU5hbWUsIGNydWRUeXBlLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgLy8gQ2hlY2sgaWYgd2UgaGF2ZSBhIGZpbHRlciB0aGF0IG1hdGNoZXMgYW4gaW5kZXhcbiAgICBjb25zdCBzY2hlbWEgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpO1xuICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gc3BlY2lmaWVkSW5kZXhcbiAgICAgICAgPyB7IGluZGV4TmFtZTogc3BlY2lmaWVkSW5kZXgubmFtZSwgaW5kZXhGaWx0ZXJzOiBzcGVjaWZpZWRJbmRleC5maWx0ZXJzIHx8IHt9IH1cbiAgICAgICAgOiBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlcnMsIGVudGl0eU5hbWUsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBNYXRjaCByZXN1bHQ6YCwgbWF0Y2hSZXN1bHQpO1xuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgaW5kZXhRdWVyeS5nbyh7IGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXMgYXMgYW55LCAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBVc2UgbWF0Y2ggZm9yIGZ1bGwgc2NhblxuICAgICAgICBsb2dnZXIud2FybihgV0FSTklORzogTm8gbWF0Y2hpbmcgaW5kZXggZm91bmQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSwgdXNpbmcgbWF0Y2ggZm9yIGZ1bGwgc2NhbmAsIGZpbHRlcnMpO1xuICAgICAgICBjb25zdCBzY2FuUXVlcnkgPSByZXBvc2l0b3J5LnNjYW47XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBzY2FuUXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUT0RPOiBhZGQgYXR0cmlidXRlcyB0byBzY2FuIHF1ZXJ5XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgc2NhblF1ZXJ5LmdvKHJlbW92ZUVtcHR5KHBhZ2luYXRpb24pKTtcbiAgICB9XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyTGlzdCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBsaXN0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFF1ZXJ5RW50aXR5QXJnczxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIHF1ZXJ5OiBFbnRpdHlRdWVyeTxTY2g+XG59XG5cbi8qKlxuICogRXhlY3V0ZXMgYSBxdWVyeSBvbiB0aGUgc3BlY2lmaWVkIGVudGl0eS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHRoZSBxdWVyeS5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXN1bHQgb2YgdGhlIHF1ZXJ5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcXVlcnlFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogUXVlcnlFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdxdWVyeScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnF1ZXJ5RW50aXR5JyksXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgICAgIHF1ZXJ5ID0ge31cblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgY29uc3Qge1xuICAgICAgICBmaWx0ZXJzID0ge30sXG4gICAgICAgIGF0dHJpYnV0ZXMgPSBbXSxcbiAgICAgICAgcGFnaW5hdGlvbiA9IHsgb3JkZXI6ICdhc2MnLCBwYWdlcjogJ2N1cnNvcicsIGN1cnNvcjogbnVsbCwgY291bnQ6IDI1LCBwYWdlczogdW5kZWZpbmVkLCBsaW1pdDogdW5kZWZpbmVkIH0sXG4gICAgICAgIGluZGV4OiBzcGVjaWZpZWRJbmRleFxuICAgIH0gPSBxdWVyeTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBxdWVyeUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVRdWVyeScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgLy8gLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IHNwZWNpZmllZEluZGV4LmZpbHRlcnMgfHwge30gfVxuICAgICAgICA6IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgZW50aXR5TmFtZSwgZW50aXR5U2VydmljZSk7XG5cbiAgICAvLyBVc2UgdGhlIGFwcHJvcHJpYXRlIGluZGV4IGlmIGF2YWlsYWJsZVxuICAgIGNvbnN0IHJlcG9zaXRvcnkgPSBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKTtcblxuICAgIGxldCBlbnRpdGllcztcbiAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgLy8gVXNlIGluZGV4IHF1ZXJ5IGlmIHdlIGhhdmUgYSBtYXRjaFxuICAgICAgICBjb25zdCBpbmRleFF1ZXJ5ID0gcmVwb3NpdG9yeS5xdWVyeVsgbWF0Y2hSZXN1bHQuaW5kZXhOYW1lIF0obWF0Y2hSZXN1bHQuaW5kZXhGaWx0ZXJzKTtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIGluZGV4UXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IGluZGV4UXVlcnkuZ28oeyBhdHRyaWJ1dGVzOiBhdHRyaWJ1dGVzIGFzIGFueSwgLi4ucmVtb3ZlRW1wdHkocGFnaW5hdGlvbikgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoIGZvciBmdWxsIHNjYW5cbiAgICAgICAgbG9nZ2VyLndhcm4oYFdBUk5JTkc6IE5vIG1hdGNoaW5nIGluZGV4IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0sIHVzaW5nIG1hdGNoIGZvciBmdWxsIHNjYW5gLCBmaWx0ZXJzKTtcbiAgICAgICAgY29uc3Qgc2NhblF1ZXJ5ID0gcmVwb3NpdG9yeS5zY2FuO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgc2NhblF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogYWRkIGF0dHJpYnV0ZXMgdG8gc2NhbiBxdWVyeVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IHNjYW5RdWVyeS5nbyhyZW1vdmVFbXB0eShwYWdpbmF0aW9uKSk7XG4gICAgfVxuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgdG8gdXBkYXRlIHRoZSBlbnRpdHkgd2l0aC5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cGRhdGUnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXR0cmlidXRlcyBmb3IgcGF0Y2ggb3BlcmF0aW9uLlxuICAgICAqL1xuICAgIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycztcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjb25kaXRpb25zIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvbi5cbiAgICAgKi9cbiAgICBjb25kaXRpb25zPzogYW55OyAvLyBUT0RPXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJlLWNhbGN1bGF0ZWQgY29tcG9zaXRlIGtleSBkYXRhLiBJZiBwcm92aWRlZCwgdGhpcyB3aWxsIGJlIHVzZWQgZGlyZWN0bHkuXG4gICAgICogSWYgbm90IHByb3ZpZGVkIGFuZCBjb21wb3NpdGUga2V5cyBhcmUgbmVlZGVkLCB0aGV5IHdpbGwgYmUgY2FsY3VsYXRlZCBpbnRlcm5hbGx5LlxuICAgICAqL1xuICAgIGNvbXBvc2l0ZUtleURhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eU9wZXJhdG9ycyB7XG4gICAgcmVtb3ZlPzogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBQcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0FyZ3M8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICBlbnRpdHlTZXJ2aWNlOiBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8Uz47XG4gICAgaWRlbnRpZmllcnM6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gICAgZGF0YTogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXM6IFNldDxzdHJpbmc+O1xuICAgIGxvZ2dlcjogSUxvZ2dlcjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNGb3JVcGRhdGU8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgYXJnczogUHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNBcmdzPFM+XG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGlkZW50aWZpZXJzLFxuICAgICAgICBkYXRhLFxuICAgICAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgIGxvZ2dlcixcbiAgICB9ID0gYXJncztcblxuICAgIGNvbnN0IGNvbXBvc2l0ZUtleVZhbHVlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGNvbnN0IGF0dHJpYnV0ZXNUb0ZldGNoID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgY29uc3QgZGF0YUFzUmVjb3JkID0gZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+OyAvLyBDYXN0IGZvciBkeW5hbWljIGFjY2Vzc1xuXG4gICAgaWYgKHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcy5zaXplID09PSAwKSB7XG4gICAgICAgIHJldHVybiB7fTsgLy8gTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgbmVlZGVkXG4gICAgfVxuXG4gICAgLy8gb25seSBpbmNsdWRlIHdoYXQncyBub3QgYWxyZWFkeSBpbiBkYXRhIG9yIGlkZW50aWZpZXJzXG4gICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmZvckVhY2goYXR0ciA9PiB7XG4gICAgICAgIGlmICghZGF0YUFzUmVjb3JkLmhhc093blByb3BlcnR5KGF0dHIpICYmICFpZGVudGlmaWVycy5oYXNPd25Qcm9wZXJ0eShhdHRyKSkge1xuICAgICAgICAgICAgYXR0cmlidXRlc1RvRmV0Y2guYWRkKGF0dHIpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoYXR0cmlidXRlc1RvRmV0Y2guc2l6ZSA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBOZWVkIHRvIGZldGNoIGF0dHJpYnV0ZXMgZm9yIGNvbXBvc2l0ZSBrZXlzOmAsIEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdSZWNvcmRDb250YWluZXIgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKVxuICAgICAgICAgICAgICAgIC5nZXQoaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgLmdvKHsgYXR0cmlidXRlczogQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCksIGNvbnNpc3RlbnRSZWFkOiB0cnVlIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlY29yZERhdGEgPSBleGlzdGluZ1JlY29yZENvbnRhaW5lci5kYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIGlmICghZXhpc3RpbmdSZWNvcmREYXRhKSB7XG5cbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgTm8gZXhpc3RpbmcgcmVjb3JkIGZvdW5kIGZvciBjb21wb3NpdGUga2V5czpgLCBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSk7XG5cbiAgICAgICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzVG9GZXRjaC5mb3JFYWNoKGF0dHIgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmdSZWNvcmREYXRhLmhhc093blByb3BlcnR5KGF0dHIpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb3NpdGVLZXlWYWx1ZXNbIGF0dHIgXSA9IGV4aXN0aW5nUmVjb3JkRGF0YVsgYXR0ciBdO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYENvbXBvc2l0ZSBrZXkgYXR0cmlidXRlIFwiJHthdHRyfVwiIChJRDogJHtKU09OLnN0cmluZ2lmeShpZGVudGlmaWVycyl9KSB3YXMgbm90IGZvdW5kIGluIHBheWxvYWQsIGlkZW50aWZpZXJzLCBvciBleGlzdGluZyByZWNvcmQuYCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGBFcnJvciBmZXRjaGluZyBhdHRyaWJ1dGVzIGZvciBjb21wb3NpdGUga2V5cyAoSUQ6ICR7SlNPTi5zdHJpbmdpZnkoaWRlbnRpZmllcnMpfSk6YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoYFByZXBhcmVkIGNvbXBvc2l0ZSBrZXkgdmFsdWVzOmAsIGNvbXBvc2l0ZUtleVZhbHVlcyk7XG4gICAgcmV0dXJuIGNvbXBvc2l0ZUtleVZhbHVlcztcbn1cblxuLyoqXG4gKiBVcGRhdGVzIGFuIGVudGl0eSBpbiB0aGUgZGF0YWJhc2UuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEBwYXJhbSB7VXBkYXRlRW50aXR5QXJnczxTPn0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciB1cGRhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMge1Byb21pc2U8RW50aXR5Pn0gLSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgdXBkYXRlZCBlbnRpdHkuXG4gKiBAdGhyb3dzIHtFcnJvcn0gLSBJZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvbiwgb3IgaWYgdmFsaWRhdGlvbiBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IFVwZGF0ZUVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBkYXRhLFxuICAgICAgICBvcGVyYXRvcnMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG4gICAgICAgIGNydWRUeXBlID0gJ3VwZGF0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwZGF0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICAgICAgY29tcG9zaXRlS2V5RGF0YSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCB7IGRhdGEsIHByb3ZpZGVkQ29tcG9zaXRlS2V5RGF0YTogY29tcG9zaXRlS2V5RGF0YSB9KTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciB1cGRhdGUgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVVcGRhdGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciB1cGRhdGU6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyAtLS0gQ29tcG9zaXRlIEtleSBIYW5kbGluZyAtLS1cbiAgICBjb25zdCBzY2hlbWEgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpO1xuICAgIGNvbnN0IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBpZiAoc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBpbmRleE5hbWUgaW4gc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4RGVmaW5pdGlvbiA9IHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChpbmRleERlZmluaXRpb24pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwa0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5waz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChwa0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHBrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBwa0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3Qgc2tDb21wb3NpdGUgPSBpbmRleERlZmluaXRpb24uc2s/LmNvbXBvc2l0ZTtcbiAgICAgICAgICAgICAgICBpZiAoc2tDb21wb3NpdGUgJiYgQXJyYXkuaXNBcnJheShza0NvbXBvc2l0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2tDb21wb3NpdGUuZm9yRWFjaChhdHRyID0+IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmFkZChhdHRyKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBpZiAoYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuc2l6ZSA+IDApIHtcbiAgICAgICAgaWYgKGNvbXBvc2l0ZUtleURhdGEgJiYgdHlwZW9mIGNvbXBvc2l0ZUtleURhdGEgPT09ICdvYmplY3QnKSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBmb3IgdXBkYXRlLmAsIGNvbXBvc2l0ZUtleURhdGEpO1xuXG4gICAgICAgICAgICBmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQiA9IGNvbXBvc2l0ZUtleURhdGE7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgY292ZXJzIGFsbCBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlc1xuICAgICAgICAgICAgY29uc3QgbWlzc2luZ0Zyb21Qcm92aWRlZCA9IEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpLmZpbHRlcihhdHRyID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAhZGF0YS5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhaWRlbnRpZmllcnMuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAgICAgIWZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCLmhhc093blByb3BlcnR5KGF0dHIpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAobWlzc2luZ0Zyb21Qcm92aWRlZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYFByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgaXMgbWlzc2luZyBzb21lIHJlcXVpcmVkIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzOiAke21pc3NpbmdGcm9tUHJvdmlkZWQuam9pbignLCAnKX0uIFVwZGF0ZSBtYXkgZmFpbCBpZiB0aGVzZSBhcmUgbmVlZGVkIGJ5IEVsZWN0cm9EQi5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICBsb2dnZXIuZGVidWcoYE5vIGNvbXBvc2l0ZUtleURhdGEgcHJvdmlkZWQsIHByZXBhcmluZyBjb21wb3NpdGUgYXR0cmlidXRlcyBpbnRlcm5hbGx5LiBSZXF1aXJlZDpgLCBBcnJheS5mcm9tKGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzKSk7XG5cbiAgICAgICAgICAgIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCID0gYXdhaXQgcHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNGb3JVcGRhdGUoe1xuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZGF0YTogZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+LFxuICAgICAgICAgICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgbG9nZ2VyLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgZGVmaW5lZCBpbiBzY2hlbWEgb3IgbmVlZGVkIGZvciB0aGlzIHVwZGF0ZS5gKTtcbiAgICB9XG4gICAgLy8gLS0tIEVuZCBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuXG5cblxuICAgIC8vIFVzZSBFbGVjdHJvREIgZm9yIGFsbCBmaWVsZHMgaW5jbHVkaW5nIF9hY3RvciAobm93IGluIHNjaGVtYSlcbiAgICBjb25zdCBxdWVyeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLnBhdGNoKGlkZW50aWZpZXJzKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBjb21wb3NpdGUgdmFsdWVzIGZvciBFbGVjdHJvREIgcGF0Y2g6YCwgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgICAgICBxdWVyeS5jb21wb3NpdGUoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRvcnM/LnJlbW92ZSkge1xuICAgICAgICBxdWVyeS5yZW1vdmUob3BlcmF0b3JzLnJlbW92ZSBhcyBhbnkpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IHF1ZXJ5LmdvKCk7XG5cblxuXG4gICAgLy8gLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclVwZGF0ZScsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5O1xufVxuXG4vKipcbiAqIHRoZSBhcmd1bWVudHMgZm9yIGRlbGV0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2RlbGV0ZScgXTtcbn1cblxuLyoqXG4gKiBEZWxldGVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgZGVsZXRlZCBlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogRGVsZXRlRW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBpZCxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2RlbGV0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmRlbGV0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlRGVsZXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGRlbGV0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVycykuZ28oKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdhZnRlckRlbGV0ZScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICByZXR1cm4gZW50aXR5O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgYmF0Y2ggZGVsZXRpbmcgZW50aXRpZXMuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlQmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gZGVsZXRlLlxuICAgICAqL1xuICAgIGlkczogQXJyYXk8T3BzU2NoZW1hWyAnZGVsZXRlJyBdPjtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKi9cbiAgICBjb25jdXJyZW50PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIERlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgdW5wcm9jZXNzZWQgaXRlbXMgdGhhdCBjb3VsZG4ndCBiZSBkZWxldGVkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlQmF0Y2hFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogRGVsZXRlQmF0Y2hFbnRpdHlBcmdzPFM+KSB7XG4gICAgY29uc3Qge1xuICAgICAgICBpZHMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGNvbmN1cnJlbnQgPSAxLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZGVsZXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZGVsZXRlQmF0Y2hFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZGVsZXRlQmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9OmAsIHsgaWRzLCBjb25jdXJyZW50IH0pO1xuXG4gICAgLy8gRXh0cmFjdCBpZGVudGlmaWVycyBmb3IgYWxsIGl0ZW1zIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IGlkZW50aWZpZXJzQmF0Y2ggPSBpZHMubWFwKGlkID0+IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKSk7XG5cbiAgICAvLyBWYWxpZGF0ZSBlYWNoIGl0ZW0gaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgdmFsaWRhdGlvbnMgPSBhd2FpdCBQcm9taXNlLmFsbChpZGVudGlmaWVyc0JhdGNoLm1hcChhc3luYyBpZGVudGlmaWVycyA9PlxuICAgICAgICB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgICAgIH0pXG4gICAgKSk7XG5cbiAgICAvLyBDaGVjayBmb3IgdmFsaWRhdGlvbiBlcnJvcnNcbiAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbnNcbiAgICAgICAgLm1hcCgodmFsaWRhdGlvbiwgaW5kZXgpID0+ICh7IHZhbGlkYXRpb24sIGluZGV4IH0pKVxuICAgICAgICAuZmlsdGVyKCh7IHZhbGlkYXRpb24gfSkgPT4gIXZhbGlkYXRpb24ucGFzcyk7XG5cbiAgICBpZiAodmFsaWRhdGlvbkVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbkVycm9ycy5mbGF0TWFwKCh7IHZhbGlkYXRpb24sIGluZGV4IH0pID0+XG4gICAgICAgICAgICAodmFsaWRhdGlvbi5lcnJvcnMgfHwgW10pLm1hcChlcnJvciA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmVycm9yLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBJdGVtICR7aW5kZXh9OiAke2Vycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgfSkpXG4gICAgICAgICkpO1xuICAgIH1cblxuICAgIC8vIFBlcmZvcm0gYmF0Y2ggZGVsZXRlIG9wZXJhdGlvbiB3aXRoIGNvbmN1cnJlbmN5IGNvbnRyb2xcbiAgICAvLyBQZXIgRWxlY3Ryb0RCIGRvY3M6IGh0dHA6Ly9lbGVjdHJvZGIuZGV2L2VuL211dGF0aW9ucy9iYXRjaC1kZWxldGUvXG4gICAgLy8gTm90ZTogRWxlY3Ryb0RCIHR5cGVzIHVzZSAnY29uY3VycmVuY3knIHdoaWxlIGRvY3Mgc2hvdyAnY29uY3VycmVudCdcbiAgICBjb25zdCBidWxrT3B0aW9uczogUGFydGlhbDxCdWxrT3B0aW9ucz4gPSB7XG4gICAgICAgIGNvbmN1cnJlbmN5OiBjb25jdXJyZW50XG4gICAgfTtcblxuICAgIGNvbnN0IGVsZWN0cm9SZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS5kZWxldGUoaWRlbnRpZmllcnNCYXRjaCkuZ28oYnVsa09wdGlvbnMpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkczpgLCBpZHMpO1xuXG4gICAgcmV0dXJuIGVsZWN0cm9SZXN1bHQ7XG59XG5cbi8qKlxuICogQ29udmVydHMgYSBmaWx0ZXIgb2JqZWN0IHdpdGggZXEgb3BlcmF0b3JzIHRvIGEgc2ltcGxpZmllZCBmb3JtLlxuICogRXhhbXBsZTogeyBhZ2U6IHsgZXE6IDY1IH0gfSBiZWNvbWVzIHsgYWdlOiA2NSB9XG4gKiBAcGFyYW0gZmlsdGVycyAtIFRoZSBmaWx0ZXIgb2JqZWN0IHRvIHNpbXBsaWZ5XG4gKiBAcmV0dXJucyBBIG5ldyBmaWx0ZXIgb2JqZWN0IHdpdGggZXEgb3BlcmF0b3JzIGNvbnZlcnRlZCB0byBkaXJlY3QgdmFsdWVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW1wbGlmeUZpbHRlcnMoZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGlmICghZmlsdGVycykgcmV0dXJuIHt9O1xuXG4gICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhmaWx0ZXJzKSkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAnZXEnIGluIHZhbHVlKSB7XG4gICAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWUuZXE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gZXhwb3J0IGNsYXNzIEVudGl0eUNydWRTZXJ2aWNlPFMgZXh0ZW5kcyBTY2hlbWE8YW55LCBhbnksIGFueT4+e1xuXG4vLyAgICAgcHVibGljIGFzeW5jIGxpc3Qob3B0aW9uczogTGlzdEVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGxpc3RFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIGNyZWF0ZShvcHRpb25zOiBDcmVhdGVFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBjcmVhdGVFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIHVwZGF0ZShvcHRpb25zOiBVcGRhdGVFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCB1cGRhdGVFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIGdldChvcHRpb25zOiBHZXRFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBnZXRFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIGRlbGV0ZShvcHRpb25zOiBEZWxldGVFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBkZWxldGVFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuLy8gfVxuXG5cbi8vIGV4cG9ydCBjb25zdCBEZWZhdWx0RW50aXR5Q3J1ZFNlcnZpY2UgPSBuZXcgRW50aXR5Q3J1ZFNlcnZpY2UoKTsiXX0=