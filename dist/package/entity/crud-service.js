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
const observers_1 = require("../observability/observers");
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
    // If no index match found, check for template match or "all records" index
    const indexes = schema.indexes;
    for (const [indexName, indexDef] of Object.entries(indexes)) {
        if (indexDef.pk.template && typeof indexDef.pk.template === 'string') {
            // Entity-specific template match
            if (indexDef.pk.template.toLowerCase() === entityName.toLowerCase()) {
                logger.debug(`Using template matching index: ${indexName} for entity: ${entityName}`);
                return {
                    indexName,
                    indexFilters: {}
                };
            }
            // "All records" index pattern - constant PK with empty composite
            // Useful for sorted listings without filters (e.g., ALL_EVENTS, ALL_LOGS)
            if (indexDef.pk.composite && indexDef.pk.composite.length === 0) {
                logger.debug(`Using "all records" index: ${indexName} with constant PK template: ${indexDef.pk.template}`);
                return {
                    indexName,
                    indexFilters: {}
                };
            }
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
        // Track full scan - CRITICAL: expensive performance/cost issue
        observers_1.MetricObserver.increment(`entity.full_scan`, 1, {
            tags: { entityName, operation: 'list' },
            level: 'warn',
        });
        // Add span event for visibility
        observers_1.SpanObserver.addEventToCurrentSpan('database.full_scan', {
            level: 'warn',
            metrics: {
                'db.full_scan': 1,
            },
            attributes: {
                'db.entity_name': entityName,
                'db.operation': 'list',
                'db.warning': 'no_index_found',
            },
            data: {
                filters: filters || {},
            },
        });
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
        // Track full scan - CRITICAL: expensive performance/cost issue
        observers_1.MetricObserver.increment(`entity.full_scan`, 1, {
            tags: { entityName, operation: 'query' },
            level: 'warn',
        });
        // Add span event for visibility
        observers_1.SpanObserver.addEventToCurrentSpan('database.full_scan', {
            level: 'warn',
            metrics: {
                'db.full_scan': 1,
            },
            attributes: {
                'db.entity_name': entityName,
                'db.operation': 'query',
                'db.warning': 'no_index_found',
            },
            data: {
                filters: filters || {},
            },
        });
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
            // Track database error metric
            observers_1.MetricObserver.increment(`entity.composite_key.fetch_error`, 1, {
                tags: { entityName: args.entityName },
                level: 'error',
            });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEwRUEsOEJBcURDO0FBOEJELHdDQTZEQztBQTRCRCxvQ0F1REM7QUErQkQsb0NBa0VDO0FBaUNELDhEQTBCQztBQVVELDhDQTZFQztBQVFELGdDQTJGQztBQVdELGtDQTJGQztBQTJIRCxvQ0F3SUM7QUFzQkQsb0NBbURDO0FBMEJELDhDQTREQztBQVFELDBDQVlDO0FBOXBDRCw0Q0FBMEM7QUFDMUMsb0NBQTJDO0FBQzNDLHdDQUFtRDtBQUNuRCxvQ0FBc0Q7QUFDdEQsOENBQWtFO0FBRWxFLGdFQUFrRTtBQUVsRSxtQ0FBMkQ7QUFFM0QsMERBQTBFO0FBMEQxRTs7OztHQUlHO0FBQ0ksS0FBSyxVQUFVLFNBQVMsQ0FBd0MsT0FBeUI7SUFFNUYsTUFBTSxFQUNGLEVBQUUsRUFDRixVQUFVLEVBQ1YsVUFBVSxFQUNWLGFBQWEsRUFFYixLQUFLLEVBQ0wsTUFBTSxFQUVOLFFBQVEsR0FBRyxLQUFLLEVBQ2hCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsd0JBQXdCLENBQUMsRUFDL0MsU0FBUyxHQUFHLDZCQUFnQixFQUM1QixVQUFVLEdBQUcsc0JBQVUsQ0FBQyxPQUFPLEVBQy9CLGVBQWUsR0FBRyx1QkFBZSxDQUFDLE9BQU8sR0FFNUMsR0FBRyxPQUFPLENBQUM7SUFFWixNQUFNLENBQUMsS0FBSyxDQUFDLCtDQUErQyxVQUFVLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBRS9GLDZFQUE2RTtJQUU3RSxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDLENBQUM7SUFFL0Qsc0JBQXNCO0lBQ3RCLHdHQUF3RztJQUN4RywyQkFBMkI7SUFDM0Isb0ZBQW9GO0lBQ3BGLElBQUk7SUFHSixjQUFj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LEtBQUssS0FBSyxRQUFRLElBQUksSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3RELE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzdCLENBQUM7YUFBTSxDQUFDO1lBQ0osTUFBTSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztRQUMxQixDQUFDO0lBQ0wsQ0FBQztJQUNELE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUM7QUFFRCxtRUFBbUU7QUFFbkUsc0RBQXNEO0FBQ3RELDRDQUE0QztBQUM1QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsb0RBQW9EO0FBQ3BELDJDQUEyQztBQUMzQyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBQ1IsSUFBSTtBQUdKLG1FQUFtRSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQnVsa09wdGlvbnMgfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBBdXRob3JpemVyIH0gZnJvbSBcIi4uL2F1dGhvcml6ZVwiO1xuaW1wb3J0IHsgRXZlbnREaXNwYXRjaGVyIH0gZnJvbSBcIi4uL2V2ZW50XCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgaXNFbXB0eU9iamVjdCwgcmVtb3ZlRW1wdHkgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IERlZmF1bHRWYWxpZGF0b3IsIHR5cGUgSVZhbGlkYXRvciB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEsIEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYSwgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBURW50aXR5T3BzSW5wdXRTY2hlbWFzIH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IEVudGl0eVZhbGlkYXRpb25FcnJvciB9IGZyb20gXCIuL2Vycm9ycy92YWxpZGF0aW9uLWVycm9yXCI7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbiB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVF1ZXJ5IH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7IE1ldHJpY09ic2VydmVyLCBTcGFuT2JzZXJ2ZXIgfSBmcm9tIFwiLi4vb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnNcIjtcblxuLyoqXG4gKiBcbiAqIFNlcmlhbGl6ZXIvZm9ybWF0dGVyXG4gKiAgLSBodHRwczovL2dpdGh1Yi5jb20vZGt6bHYvbWljcm8tdHJhbnNmb3JtXG4gKiAgXG4gKiBFdmVudCBkaXNwYXRjaGVyXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9Gb3hBbmRGbHkvdHMtZXZlbnQtZGlzcGF0Y2hlci9ibG9iL21hc3Rlci9zcmMvaW5kZXgudHNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL3J5YXJkbGV5L3RzLWJ1c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vYmluaWVyL3RpbnktdHlwZWQtZW1pdHRlci90cmVlL21hc3RlclxuICogXG4gKiBSb3V0ZXJcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL2JlcnN0ZW5kL3RpbnktcmVxdWVzdC1yb3V0ZXIvYmxvYi9tYXN0ZXIvc3JjL3JvdXRlci50c1xuICogXG4gKiBESVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbmljb2pzL3R5cGVkLWluamVjdFxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbWljcm9zb2Z0L3RzeXJpbmdlXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9vd2phL2lvY1xuICogXG4gKiBcbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhc2VFbnRpdHlDcnVkQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcblxuICAgIGNydWRUeXBlPzoga2V5b2YgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuICAgIGFjdG9yPzogQWN0b3I7IC8vIEFjdG9yIGNvbnRleHQ6IGNvbXByZWhlbnNpdmUgYWN0b3IgaW5mb3JtYXRpb24gaW5jbHVkaW5nIGF1dGhlbnRpY2F0aW9uIGRldGFpbHNcbiAgICB0ZW5hbnQ/OiBhbnk7IC8vIHRvZG86IGRlZmluZSB0ZW5hbnQgY29udGV4dFxuXG4gICAgbG9nZ2VyPzogSUxvZ2dlcjtcbiAgICB2YWxpZGF0b3I/OiBJVmFsaWRhdG9yO1xuICAgIGF1dGhvcml6ZXI/OiBBdXRob3JpemVyLklBdXRob3JpemVyOyAgICAgICAgLy8gdG9kbzogZGVmaW5lIGF1dGhvcml6ZXIgc2lnbmF0dXJlXG4gICAgZXZlbnREaXNwYXRjaGVyPzogRXZlbnREaXNwYXRjaGVyLklFdmVudERpc3BhdGNoZXI7ICAvLyB0b2RvIGRlZmluZSBldmVudCBkaXNwYXRjaGVyIHNpZ25hdHVyZVxuXG4gICAgLy8gdGVsZW1ldHJ5XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIHJldHJpZXZlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byBpbmNsdWRlIGluIHRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciByZXRyaWV2aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZ2V0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Z2V0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkLCBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZUdldCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGlkZW50aWZpZXJzLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciBnZXQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cblxuICAgIC8vIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVycykuZ28oeyBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2FmdGVyR2V0JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIHJldHVybiBlbnRpdHk7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2guXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gcmV0cmlldmUuXG4gICAgICovXG4gICAgaWRzOiBBcnJheTxPcHNTY2hlbWFbICdnZXQnIF0+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmV0cmlldmVkIGVudGl0aWVzLlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqL1xuICAgIGNvbmN1cnJlbnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgcmV0cmlldmluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRCYXRjaEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRCYXRjaEVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkcyxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgY29uY3VycmVudCA9IDEsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdnZXQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpnZXRCYXRjaEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZHMsIGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZvciBhbGwgaXRlbXMgaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlkcy5tYXAoaWQgPT4gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuICAgIC8vIFZhbGlkYXRlIGVhY2ggaXRlbSBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCB2YWxpZGF0aW9ucyA9IGF3YWl0IFByb21pc2UuYWxsKGlkZW50aWZpZXJzQmF0Y2gubWFwKGFzeW5jIGlkZW50aWZpZXJzID0+XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhY3RvcjogYWN0b3JcbiAgICAgICAgfSlcbiAgICApKTtcblxuICAgIC8vIENoZWNrIGZvciB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uc1xuICAgICAgICAubWFwKCh2YWxpZGF0aW9uLCBpbmRleCkgPT4gKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgdmFsaWRhdGlvbiB9KSA9PiAhdmFsaWRhdGlvbi5wYXNzKTtcblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uRXJyb3JzLmZsYXRNYXAoKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkgPT5cbiAgICAgICAgICAgICh2YWxpZGF0aW9uLmVycm9ycyB8fCBbXSkubWFwKGVycm9yID0+ICh7XG4gICAgICAgICAgICAgICAgLi4uZXJyb3IsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYEl0ZW0gJHtpbmRleH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgKSk7XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBiYXRjaCBnZXQgb3BlcmF0aW9uIHdpdGggY29uY3VycmVuY3kgY29udHJvbFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVyc0JhdGNoKS5nbyh7XG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIGNvbmN1cnJlbnRcbiAgICB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZHM6YCwgaWRzKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGRhdGE6IEFycmF5LmlzQXJyYXkocmVzdWx0LmRhdGEpID8gcmVzdWx0LmRhdGEgOiAocmVzdWx0LmRhdGEgPyBbIHJlc3VsdC5kYXRhIF0gOiBbXSksXG4gICAgICAgIHVucHJvY2Vzc2VkOiBbXSAgLy8gRWxlY3Ryb0RCIGRvZXNuJ3Qgc3VwcG9ydCB1bnByb2Nlc3NlZCBpdGVtcyB0cmFja2luZywgc28gd2UgcmV0dXJuIGVtcHR5IGFycmF5XG4gICAgfTtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGNyZWF0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDcmVhdGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBkYXRhIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqL1xuICAgIGRhdGE6IE9wc1NjaGVtYVsgJ2NyZWF0ZScgXTtcbn1cblxuZXhwb3J0IHR5cGUgQ3JlYXRlRW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gZW50aXR5IHVzaW5nIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMgVGhlIGNyZWF0ZWQgZW50aXR5LlxuICogQHRocm93cyBFcnJvciBpZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciBjcmVhdGUgb3BlcmF0aW9uLCB2YWxpZGF0aW9uIGZhaWxzLCBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IENyZWF0ZUVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPENyZWF0ZUVudGl0eVJlc3BvbnNlPFM+PiB7XG4gICAgY29uc3Qge1xuICAgICAgICBkYXRhLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnY3JlYXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Y3JlYXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gY3JlYXRlIH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSk7XG5cbiAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YSBwcm92aWRlZCBmb3IgY3JlYXRlIG9wZXJhdGlvblwiKTtcbiAgICB9XG5cbiAgICAvLyBwcmUgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYmVmb3JlQ3JlYXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogZGF0YSxcbiAgICAgICAgYWN0b3I6IGFjdG9yLFxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGNyZWF0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmNyZWF0ZShkYXRhKS5nbygpO1xuXG4gICAgLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlckNyZWF0ZScsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiBjcmVhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5IGFzIENyZWF0ZUVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyBhbiBlbnRpdHkuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBzZXJ0RW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGF0YSBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cHNlcnQnIF07XG59XG5cbmV4cG9ydCB0eXBlIFVwc2VydEVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICB3YXNDcmVhdGVkPzogYm9vbGVhbiAgLy8gdHJ1ZSBpZiByZWNvcmQgd2FzIGNyZWF0ZWQsIGZhbHNlIGlmIGFscmVhZHkgZXhpc3RlZFxuICAgIG9sZERhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+ICAvLyBwcmV2aW91cyBkYXRhIGlmIGl0IHdhcyBhbiB1cGRhdGUgKHVuZGVmaW5lZCBmb3IgY3JlYXRlcylcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGVudGl0eSB1c2luZyB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eSB3aXRoIHdhc0NyZWF0ZWQgZmxhZyBpbmRpY2F0aW5nIGlmIGl0IHdhcyBhIG5ldyByZWNvcmQuXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIHVwc2VydCBvcGVyYXRpb24sIHZhbGlkYXRpb24gZmFpbHMsIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHNlcnRFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogVXBzZXJ0RW50aXR5QXJnczxTPik6IFByb21pc2U8VXBzZXJ0RW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICd1cHNlcnQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTp1cHNlcnRFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cHNlcnQgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhKTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciB1cHNlcnQgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVVcHNlcnQnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3IsXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBkYXRhLCBhY3RvciwgdGVuYW50IH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgdXBzZXJ0OiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgLy8gVXNlIFwiYWxsX29sZFwiIHRvIGdldCB0aGUgcHJldmlvdXMgaXRlbSBzdGF0ZSAtIGFsbG93cyB1cyB0byBkZXRlY3QgY3JlYXRlIHZzIHVwZGF0ZVxuICAgIC8vIElmIG9sZERhdGEgaXMgZW1wdHkvbnVsbCwgaXQgd2FzIGEgQ1JFQVRFLiBJZiBpdCBoYXMgZGF0YSwgaXQgd2FzIGFuIFVQREFURS5cbiAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS51cHNlcnQoZGF0YSBhcyBhbnkpLmdvKHsgcmVzcG9uc2U6IFwiYWxsX29sZFwiIH0pO1xuXG4gICAgY29uc3Qgd2FzQ3JlYXRlZCA9ICFlbnRpdHkuZGF0YSB8fCBPYmplY3Qua2V5cyhlbnRpdHkuZGF0YSkubGVuZ3RoID09PSAwO1xuICAgIGNvbnN0IG9sZERhdGEgPSB3YXNDcmVhdGVkID8gdW5kZWZpbmVkIDogZW50aXR5LmRhdGE7XG5cbiAgICAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyVXBzZXJ0JywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiB3YXNDcmVhdGVkOiAke3dhc0NyZWF0ZWR9YCk7XG5cbiAgICAvLyBOb3RlOiB3aXRoIFwiYWxsX29sZFwiLCBlbnRpdHkuZGF0YSBjb250YWlucyB0aGUgT0xEIGRhdGEsIHdlIG5lZWQgdG8gcmV0dXJuIHRoZSBORVcgZGF0YVxuICAgIC8vIFNpbmNlIHdlIGRvbid0IGhhdmUgdGhlIG5ldyBkYXRhIGZyb20gRHluYW1vREIsIHdlIHJldHVybiB0aGUgaW5wdXQgZGF0YSBhcyB0aGUgbmV3IGRhdGFcbiAgICByZXR1cm4ge1xuICAgICAgICBkYXRhOiBkYXRhIGFzIGFueSwgIC8vIFRoZSBuZXcgZGF0YSB3ZSBqdXN0IHVwc2VydGVkXG4gICAgICAgIHdhc0NyZWF0ZWQsXG4gICAgICAgIG9sZERhdGFcbiAgICB9IGFzIFVwc2VydEVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgbGlzdGluZyBlbnRpdGllcy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExpc3RFbnRpdHlBcmdzPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgcXVlcnk6IEVudGl0eVF1ZXJ5PFNjaD5cbn1cblxuLyoqXG4gKiBPcGVyYXRvcnMgdGhhdCBzaG91bGQgTk9UIGJlIHVzZWQgZm9yIGluZGV4IG1hdGNoaW5nLlxuICogVGhlc2Ugb3BlcmF0b3JzIGxvb2sgZm9yIHJlY29yZHMgd2hlcmUgdGhlIGF0dHJpYnV0ZSBkb2Vzbid0IGV4aXN0IG9yIGlzIGVtcHR5LFxuICogYnV0IHRob3NlIHJlY29yZHMgd29uJ3QgYmUgaW4gYSBzcGFyc2UgR1NJIHdoZXJlIHRoYXQgYXR0cmlidXRlIGlzIHRoZSBQSy5cbiAqL1xuY29uc3QgSU5ERVhfRVhDTFVERURfT1BFUkFUT1JTID0gbmV3IFNldChbXG4gICAgJ25vdEV4aXN0cycsICdleGlzdHMnLCAnaXNOdWxsJywgJ25vdE51bGwnLCAnZW1wdHknLCAnbm90RW1wdHknXG5dKTtcblxuLyoqXG4gKiBDb252ZXJ0IEZpbHRlckdyb3VwIGZvcm1hdCB0byBzaW1wbGUgb2JqZWN0IGZvcm1hdCBmb3IgaW5kZXggbWF0Y2hpbmcuXG4gKiBGaWx0ZXJHcm91cDogeyBhbmQ6IFt7IGF0dHJpYnV0ZTogJ2ZvbycsIGVxOiAnYmFyJyB9XSB9XG4gKiBTaW1wbGU6IHsgZm9vOiB7IGVxOiAnYmFyJyB9IH1cbiAqIFxuICogT25seSBleHRyYWN0cyBmaWx0ZXJzIGZyb20gdGhlICdhbmQnIGFycmF5IGFzIHRob3NlIGFyZSB0aGUgb25lc1xuICogdGhhdCBjYW4gYmUgdXNlZCBmb3IgR1NJIHBhcnRpdGlvbiBrZXkgbWF0Y2hpbmcuXG4gKiBcbiAqIEV4Y2x1ZGVzIGV4aXN0ZW5jZS9udWxsIGZpbHRlcnMgKG5vdEV4aXN0cywgaXNOdWxsLCBlbXB0eSwgZXRjLikgZnJvbSBpbmRleFxuICogbWF0Y2hpbmcgc2luY2UgcmVjb3JkcyB3aXRoIG1pc3NpbmcgYXR0cmlidXRlcyB3b24ndCBiZSBpbiBzcGFyc2UgR1NJcy5cbiAqIFxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVycyBpbiBGaWx0ZXJHcm91cCBvciBzaW1wbGUgZm9ybWF0XG4gKiBAcmV0dXJucyBGaWx0ZXJzIGluIHNpbXBsZSBvYmplY3QgZm9ybWF0IHsgYXR0cjogeyBvcDogdmFsIH0gfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgLy8gQWxyZWFkeSBpbiBzaW1wbGUgZm9ybWF0IG9yIGVtcHR5XG4gICAgaWYgKCFmaWx0ZXJzIHx8ICEoJ2FuZCcgaW4gZmlsdGVycykpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlcnMgfHwge307XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltcGxlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICAvLyBFeHRyYWN0IGZyb20gJ2FuZCcgYXJyYXkgLSB0aGVzZSBhcmUgQU5EIGNvbmRpdGlvbnMgdGhhdCBjb3VsZCBtYXRjaCBHU0kgUEtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgZmlsdGVycy5hbmQgfHwgW10pIHtcbiAgICAgICAgaWYgKGl0ZW0uYXR0cmlidXRlKSB7XG4gICAgICAgICAgICBjb25zdCBvcGVyYXRvcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoaXRlbSkpIHtcbiAgICAgICAgICAgICAgICAvLyBTa2lwIHRoZSAnYXR0cmlidXRlJyBrZXkgYW5kIGV4Y2x1ZGUgZXhpc3RlbmNlL251bGwgb3BlcmF0b3JzIGZyb20gaW5kZXggbWF0Y2hpbmdcbiAgICAgICAgICAgICAgICAvLyBSZWNvcmRzIHdpdGggbWlzc2luZyBhdHRyaWJ1dGVzIHdvbid0IGJlIGluIHNwYXJzZSBHU0lzXG4gICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gJ2F0dHJpYnV0ZScgJiYgIUlOREVYX0VYQ0xVREVEX09QRVJBVE9SUy5oYXMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBvcGVyYXRvcnNbIGtleSBdID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKG9wZXJhdG9ycykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHNpbXBsZVsgaXRlbS5hdHRyaWJ1dGUgXSA9IG9wZXJhdG9ycztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzaW1wbGU7XG59XG5cbi8qKlxuICogRmluZHMgYSBtYXRjaGluZyBpbmRleCBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgZmlsdGVycyBhbmQgc2NoZW1hLlxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gZmlsdGVycyAtIFRoZSBmaWx0ZXJzIHRvIG1hdGNoIGFnYWluc3RcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGVudGl0eVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBUaGUgZW50aXR5IHNlcnZpY2VcbiAqIEByZXR1cm5zIFRoZSBuYW1lIG9mIHRoZSBtYXRjaGluZyBpbmRleCBhbmQgdGhlIGZpbHRlcnMgdXNlZCB0byBtYXRjaCBpdCBvciB1bmRlZmluZWQgaWYgbm8gbWF0Y2ggaXMgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbmRNYXRjaGluZ0luZGV4KFxuICAgIHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxhbnk+XG4pOiB7IGluZGV4TmFtZTogc3RyaW5nOyBpbmRleEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZmluZE1hdGNoaW5nSW5kZXgnKTtcbiAgICBpZiAoIWZpbHRlcnMpIGZpbHRlcnMgPSB7fTtcblxuICAgIC8vIENvbnZlcnQgRmlsdGVyR3JvdXAgZm9ybWF0IHRvIHNpbXBsZSBmb3JtYXQgZm9yIGluZGV4IG1hdGNoaW5nXG4gICAgY29uc3Qgc2ltcGxlRmlsdGVycyA9IGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVycyk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb252ZXJ0ZWQgZmlsdGVycyBmb3IgaW5kZXggbWF0Y2hpbmc6YCwgeyBvcmlnaW5hbDogZmlsdGVycywgc2ltcGxlOiBzaW1wbGVGaWx0ZXJzIH0pO1xuXG4gICAgLy8gRmlyc3QgdHJ5IEVsZWN0cm9EQidzIGluZGV4IG1hdGNoaW5nXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuICAgIGNvbnN0IHsga2V5cywgaW5kZXgsIHNob3VsZFNjYW4gfSA9IChyZXBvc2l0b3J5IGFzIGFueSkuX2ZpbmRCZXN0SW5kZXhLZXlNYXRjaChzaW1wbGVGaWx0ZXJzKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgRm91bmQgRWxlY3Ryb0RCIGluZGV4OiAke2luZGV4fSB3aXRoICR7a2V5cy5sZW5ndGh9IGF0dHJpYnV0ZSBtYXRjaGVzIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0gd2l0aCBmaWx0ZXJzIGFuZCBzY2FuOiAke3Nob3VsZFNjYW59IC0gYCwga2V5cywgc2ltcGxlRmlsdGVycyk7XG5cbiAgICAvLyBJZiB3ZSBmb3VuZCBhIG1hdGNoaW5nIGluZGV4LCB1c2UgaXRcbiAgICBpZiAoIXNob3VsZFNjYW4pIHtcbiAgICAgICAgY29uc3QgaW5kZXhGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICAgICAgLy8gQWRkIG1hdGNoZWQga2V5cyB0byBpbmRleEZpbHRlcnMgKHVzZSBzaW1wbGVGaWx0ZXJzIHdoaWNoIGhhcyB0aGUgcmlnaHQgZm9ybWF0KVxuICAgICAgICBrZXlzLmZvckVhY2goKGtleTogeyBuYW1lOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJWYWx1ZSA9IHNpbXBsZUZpbHRlcnNbIGtleS5uYW1lIF07XG4gICAgICAgICAgICBpZiAoZmlsdGVyVmFsdWUpIHtcbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgYm90aCB7IGVxOiB2YWx1ZSB9IGFuZCBkaXJlY3QgdmFsdWUgZm9ybWF0c1xuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyc1sga2V5Lm5hbWUgXSA9IGZpbHRlclZhbHVlLmVxICE9PSB1bmRlZmluZWQgPyBmaWx0ZXJWYWx1ZS5lcSA6IGZpbHRlclZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBNYXAgRWxlY3Ryb0RCJ3MgaW50ZXJuYWwgaW5kZXggbmFtZSBiYWNrIHRvIG91ciBzY2hlbWEncyBpbmRleCBuYW1lXG4gICAgICAgIGxldCBzY2hlbWFJbmRleE5hbWUgPSBpbmRleDtcbiAgICAgICAgaWYgKGluZGV4ID09PSAnJykge1xuICAgICAgICAgICAgc2NoZW1hSW5kZXhOYW1lID0gJ3ByaW1hcnknO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmluZCB0aGUgaW5kZXggaW4gb3VyIHNjaGVtYSB0aGF0IG1hdGNoZXMgdGhpcyBHU0lcbiAgICAgICAgICAgIGNvbnN0IGluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBuYW1lLCBpbmRleERlZiBdIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4ZXMpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGluZGV4RGVmLmluZGV4ID09PSBpbmRleCkge1xuICAgICAgICAgICAgICAgICAgICBzY2hlbWFJbmRleE5hbWUgPSBuYW1lO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBsb2dnZXIuZGVidWcoYFVzaW5nIEVsZWN0cm9EQiBtYXRjaGVkIGluZGV4OiAke3NjaGVtYUluZGV4TmFtZX0gKGludGVybmFsOiAke2luZGV4fSkgd2l0aCAke2tleXMubGVuZ3RofSBhdHRyaWJ1dGUgbWF0Y2hlcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9IHdpdGggZmlsdGVyczpgLCBpbmRleEZpbHRlcnMpO1xuICAgICAgICByZXR1cm4geyBpbmRleE5hbWU6IHNjaGVtYUluZGV4TmFtZSwgaW5kZXhGaWx0ZXJzIH07XG4gICAgfVxuXG4gICAgLy8gSWYgbm8gaW5kZXggbWF0Y2ggZm91bmQsIGNoZWNrIGZvciB0ZW1wbGF0ZSBtYXRjaCBvciBcImFsbCByZWNvcmRzXCIgaW5kZXhcbiAgICBjb25zdCBpbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgZm9yIChjb25zdCBbIGluZGV4TmFtZSwgaW5kZXhEZWYgXSBvZiBPYmplY3QuZW50cmllcyhpbmRleGVzKSkge1xuICAgICAgICBpZiAoaW5kZXhEZWYucGsudGVtcGxhdGUgJiYgdHlwZW9mIGluZGV4RGVmLnBrLnRlbXBsYXRlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgLy8gRW50aXR5LXNwZWNpZmljIHRlbXBsYXRlIG1hdGNoXG4gICAgICAgICAgICBpZiAoaW5kZXhEZWYucGsudGVtcGxhdGUudG9Mb3dlckNhc2UoKSA9PT0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyB0ZW1wbGF0ZSBtYXRjaGluZyBpbmRleDogJHtpbmRleE5hbWV9IGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBcIkFsbCByZWNvcmRzXCIgaW5kZXggcGF0dGVybiAtIGNvbnN0YW50IFBLIHdpdGggZW1wdHkgY29tcG9zaXRlXG4gICAgICAgICAgICAvLyBVc2VmdWwgZm9yIHNvcnRlZCBsaXN0aW5ncyB3aXRob3V0IGZpbHRlcnMgKGUuZy4sIEFMTF9FVkVOVFMsIEFMTF9MT0dTKVxuICAgICAgICAgICAgaWYgKGluZGV4RGVmLnBrLmNvbXBvc2l0ZSAmJiBpbmRleERlZi5way5jb21wb3NpdGUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBcImFsbCByZWNvcmRzXCIgaW5kZXg6ICR7aW5kZXhOYW1lfSB3aXRoIGNvbnN0YW50IFBLIHRlbXBsYXRlOiAke2luZGV4RGVmLnBrLnRlbXBsYXRlfWApO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgbGlzdGluZyBlbnRpdGllcy5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIGFycmF5IG9mIGVudGl0aWVzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBMaXN0RW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnbGlzdCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmxpc3RFbnRpdHknKSxcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICAgICAgcXVlcnkgPSB7fSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZmlsdGVycyA9IHt9LFxuICAgICAgICBhdHRyaWJ1dGVzID0gW10sXG4gICAgICAgIHBhZ2luYXRpb24gPSB7IG9yZGVyOiAnYXNjJywgcGFnZXI6ICdjdXJzb3InLCBjdXJzb3I6IG51bGwsIGNvdW50OiAyNSwgcGFnZXM6IHVuZGVmaW5lZCwgbGltaXQ6IHVuZGVmaW5lZCB9LFxuICAgICAgICBpbmRleDogc3BlY2lmaWVkSW5kZXhcbiAgICB9ID0gcXVlcnk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gbGlzdEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVMaXN0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IHNwZWNpZmllZEluZGV4LmZpbHRlcnMgfHwge30gfVxuICAgICAgICA6IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgZW50aXR5TmFtZSwgZW50aXR5U2VydmljZSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYE1hdGNoIHJlc3VsdDpgLCBtYXRjaFJlc3VsdCk7XG4gICAgLy8gVXNlIHRoZSBhcHByb3ByaWF0ZSBpbmRleCBpZiBhdmFpbGFibGVcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICBsZXQgZW50aXRpZXM7XG4gICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgIC8vIFVzZSBpbmRleCBxdWVyeSBpZiB3ZSBoYXZlIGEgbWF0Y2hcbiAgICAgICAgY29uc3QgaW5kZXhRdWVyeSA9IHJlcG9zaXRvcnkucXVlcnlbIG1hdGNoUmVzdWx0LmluZGV4TmFtZSBdKG1hdGNoUmVzdWx0LmluZGV4RmlsdGVycyk7XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBpbmRleFF1ZXJ5LmdvKHsgYXR0cmlidXRlczogYXR0cmlidXRlcyBhcyBhbnksIC4uLnJlbW92ZUVtcHR5KHBhZ2luYXRpb24pIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVzZSBtYXRjaCBmb3IgZnVsbCBzY2FuXG4gICAgICAgIGxvZ2dlci53YXJuKGBXQVJOSU5HOiBObyBtYXRjaGluZyBpbmRleCBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9LCB1c2luZyBtYXRjaCBmb3IgZnVsbCBzY2FuYCwgZmlsdGVycyk7XG5cbiAgICAgICAgLy8gVHJhY2sgZnVsbCBzY2FuIC0gQ1JJVElDQUw6IGV4cGVuc2l2ZSBwZXJmb3JtYW5jZS9jb3N0IGlzc3VlXG4gICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChgZW50aXR5LmZ1bGxfc2NhbmAsIDEsIHtcbiAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZSwgb3BlcmF0aW9uOiAnbGlzdCcgfSxcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBzcGFuIGV2ZW50IGZvciB2aXNpYmlsaXR5XG4gICAgICAgIFNwYW5PYnNlcnZlci5hZGRFdmVudFRvQ3VycmVudFNwYW4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmZ1bGxfc2Nhbic6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgICAgICdkYi5lbnRpdHlfbmFtZSc6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgJ2RiLm9wZXJhdGlvbic6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAnZGIud2FybmluZyc6ICdub19pbmRleF9mb3VuZCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgIGZpbHRlcnM6IGZpbHRlcnMgfHwge30sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBzY2FuUXVlcnkgPSByZXBvc2l0b3J5LnNjYW47XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBzY2FuUXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUT0RPOiBhZGQgYXR0cmlidXRlcyB0byBzY2FuIHF1ZXJ5XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgc2NhblF1ZXJ5LmdvKHJlbW92ZUVtcHR5KHBhZ2luYXRpb24pKTtcbiAgICB9XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyTGlzdCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBsaXN0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFF1ZXJ5RW50aXR5QXJnczxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIHF1ZXJ5OiBFbnRpdHlRdWVyeTxTY2g+XG59XG5cbi8qKlxuICogRXhlY3V0ZXMgYSBxdWVyeSBvbiB0aGUgc3BlY2lmaWVkIGVudGl0eS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHRoZSBxdWVyeS5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXN1bHQgb2YgdGhlIHF1ZXJ5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcXVlcnlFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogUXVlcnlFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdxdWVyeScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnF1ZXJ5RW50aXR5JyksXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgICAgIHF1ZXJ5ID0ge31cblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgY29uc3Qge1xuICAgICAgICBmaWx0ZXJzID0ge30sXG4gICAgICAgIGF0dHJpYnV0ZXMgPSBbXSxcbiAgICAgICAgcGFnaW5hdGlvbiA9IHsgb3JkZXI6ICdhc2MnLCBwYWdlcjogJ2N1cnNvcicsIGN1cnNvcjogbnVsbCwgY291bnQ6IDI1LCBwYWdlczogdW5kZWZpbmVkLCBsaW1pdDogdW5kZWZpbmVkIH0sXG4gICAgICAgIGluZGV4OiBzcGVjaWZpZWRJbmRleFxuICAgIH0gPSBxdWVyeTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBxdWVyeUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVRdWVyeScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgLy8gLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IHNwZWNpZmllZEluZGV4LmZpbHRlcnMgfHwge30gfVxuICAgICAgICA6IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgZW50aXR5TmFtZSwgZW50aXR5U2VydmljZSk7XG5cbiAgICAvLyBVc2UgdGhlIGFwcHJvcHJpYXRlIGluZGV4IGlmIGF2YWlsYWJsZVxuICAgIGNvbnN0IHJlcG9zaXRvcnkgPSBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKTtcblxuICAgIGxldCBlbnRpdGllcztcbiAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgLy8gVXNlIGluZGV4IHF1ZXJ5IGlmIHdlIGhhdmUgYSBtYXRjaFxuICAgICAgICBjb25zdCBpbmRleFF1ZXJ5ID0gcmVwb3NpdG9yeS5xdWVyeVsgbWF0Y2hSZXN1bHQuaW5kZXhOYW1lIF0obWF0Y2hSZXN1bHQuaW5kZXhGaWx0ZXJzKTtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIGluZGV4UXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IGluZGV4UXVlcnkuZ28oeyBhdHRyaWJ1dGVzOiBhdHRyaWJ1dGVzIGFzIGFueSwgLi4ucmVtb3ZlRW1wdHkocGFnaW5hdGlvbikgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoIGZvciBmdWxsIHNjYW5cbiAgICAgICAgbG9nZ2VyLndhcm4oYFdBUk5JTkc6IE5vIG1hdGNoaW5nIGluZGV4IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0sIHVzaW5nIG1hdGNoIGZvciBmdWxsIHNjYW5gLCBmaWx0ZXJzKTtcblxuICAgICAgICAvLyBUcmFjayBmdWxsIHNjYW4gLSBDUklUSUNBTDogZXhwZW5zaXZlIHBlcmZvcm1hbmNlL2Nvc3QgaXNzdWVcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KGBlbnRpdHkuZnVsbF9zY2FuYCwgMSwge1xuICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lLCBvcGVyYXRpb246ICdxdWVyeScgfSxcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBzcGFuIGV2ZW50IGZvciB2aXNpYmlsaXR5XG4gICAgICAgIFNwYW5PYnNlcnZlci5hZGRFdmVudFRvQ3VycmVudFNwYW4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmZ1bGxfc2Nhbic6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgICAgICdkYi5lbnRpdHlfbmFtZSc6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgJ2RiLm9wZXJhdGlvbic6ICdxdWVyeScsXG4gICAgICAgICAgICAgICAgJ2RiLndhcm5pbmcnOiAnbm9faW5kZXhfZm91bmQnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiBmaWx0ZXJzIHx8IHt9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3Qgc2NhblF1ZXJ5ID0gcmVwb3NpdG9yeS5zY2FuO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgc2NhblF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogYWRkIGF0dHJpYnV0ZXMgdG8gc2NhbiBxdWVyeVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IHNjYW5RdWVyeS5nbyhyZW1vdmVFbXB0eShwYWdpbmF0aW9uKSk7XG4gICAgfVxuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgdG8gdXBkYXRlIHRoZSBlbnRpdHkgd2l0aC5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cGRhdGUnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXR0cmlidXRlcyBmb3IgcGF0Y2ggb3BlcmF0aW9uLlxuICAgICAqL1xuICAgIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycztcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjb25kaXRpb25zIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvbi5cbiAgICAgKi9cbiAgICBjb25kaXRpb25zPzogYW55OyAvLyBUT0RPXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJlLWNhbGN1bGF0ZWQgY29tcG9zaXRlIGtleSBkYXRhLiBJZiBwcm92aWRlZCwgdGhpcyB3aWxsIGJlIHVzZWQgZGlyZWN0bHkuXG4gICAgICogSWYgbm90IHByb3ZpZGVkIGFuZCBjb21wb3NpdGUga2V5cyBhcmUgbmVlZGVkLCB0aGV5IHdpbGwgYmUgY2FsY3VsYXRlZCBpbnRlcm5hbGx5LlxuICAgICAqL1xuICAgIGNvbXBvc2l0ZUtleURhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eU9wZXJhdG9ycyB7XG4gICAgcmVtb3ZlPzogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBQcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0FyZ3M8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICBlbnRpdHlTZXJ2aWNlOiBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8Uz47XG4gICAgaWRlbnRpZmllcnM6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gICAgZGF0YTogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXM6IFNldDxzdHJpbmc+O1xuICAgIGxvZ2dlcjogSUxvZ2dlcjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNGb3JVcGRhdGU8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgYXJnczogUHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNBcmdzPFM+XG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGlkZW50aWZpZXJzLFxuICAgICAgICBkYXRhLFxuICAgICAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgIGxvZ2dlcixcbiAgICB9ID0gYXJncztcblxuICAgIGNvbnN0IGNvbXBvc2l0ZUtleVZhbHVlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGNvbnN0IGF0dHJpYnV0ZXNUb0ZldGNoID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgY29uc3QgZGF0YUFzUmVjb3JkID0gZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+OyAvLyBDYXN0IGZvciBkeW5hbWljIGFjY2Vzc1xuXG4gICAgaWYgKHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcy5zaXplID09PSAwKSB7XG4gICAgICAgIHJldHVybiB7fTsgLy8gTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgbmVlZGVkXG4gICAgfVxuXG4gICAgLy8gb25seSBpbmNsdWRlIHdoYXQncyBub3QgYWxyZWFkeSBpbiBkYXRhIG9yIGlkZW50aWZpZXJzXG4gICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmZvckVhY2goYXR0ciA9PiB7XG4gICAgICAgIGlmICghZGF0YUFzUmVjb3JkLmhhc093blByb3BlcnR5KGF0dHIpICYmICFpZGVudGlmaWVycy5oYXNPd25Qcm9wZXJ0eShhdHRyKSkge1xuICAgICAgICAgICAgYXR0cmlidXRlc1RvRmV0Y2guYWRkKGF0dHIpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoYXR0cmlidXRlc1RvRmV0Y2guc2l6ZSA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBOZWVkIHRvIGZldGNoIGF0dHJpYnV0ZXMgZm9yIGNvbXBvc2l0ZSBrZXlzOmAsIEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdSZWNvcmRDb250YWluZXIgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKVxuICAgICAgICAgICAgICAgIC5nZXQoaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgLmdvKHsgYXR0cmlidXRlczogQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCksIGNvbnNpc3RlbnRSZWFkOiB0cnVlIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlY29yZERhdGEgPSBleGlzdGluZ1JlY29yZENvbnRhaW5lci5kYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIGlmICghZXhpc3RpbmdSZWNvcmREYXRhKSB7XG5cbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgTm8gZXhpc3RpbmcgcmVjb3JkIGZvdW5kIGZvciBjb21wb3NpdGUga2V5czpgLCBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSk7XG5cbiAgICAgICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzVG9GZXRjaC5mb3JFYWNoKGF0dHIgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmdSZWNvcmREYXRhLmhhc093blByb3BlcnR5KGF0dHIpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb3NpdGVLZXlWYWx1ZXNbIGF0dHIgXSA9IGV4aXN0aW5nUmVjb3JkRGF0YVsgYXR0ciBdO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYENvbXBvc2l0ZSBrZXkgYXR0cmlidXRlIFwiJHthdHRyfVwiIChJRDogJHtKU09OLnN0cmluZ2lmeShpZGVudGlmaWVycyl9KSB3YXMgbm90IGZvdW5kIGluIHBheWxvYWQsIGlkZW50aWZpZXJzLCBvciBleGlzdGluZyByZWNvcmQuYCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGBFcnJvciBmZXRjaGluZyBhdHRyaWJ1dGVzIGZvciBjb21wb3NpdGUga2V5cyAoSUQ6ICR7SlNPTi5zdHJpbmdpZnkoaWRlbnRpZmllcnMpfSk6YCwgZXJyb3IpO1xuXG4gICAgICAgICAgICAvLyBUcmFjayBkYXRhYmFzZSBlcnJvciBtZXRyaWNcbiAgICAgICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChgZW50aXR5LmNvbXBvc2l0ZV9rZXkuZmV0Y2hfZXJyb3JgLCAxLCB7XG4gICAgICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lOiBhcmdzLmVudGl0eU5hbWUgfSxcbiAgICAgICAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvZ2dlci5kZWJ1ZyhgUHJlcGFyZWQgY29tcG9zaXRlIGtleSB2YWx1ZXM6YCwgY29tcG9zaXRlS2V5VmFsdWVzKTtcbiAgICByZXR1cm4gY29tcG9zaXRlS2V5VmFsdWVzO1xufVxuXG4vKipcbiAqIFVwZGF0ZXMgYW4gZW50aXR5IGluIHRoZSBkYXRhYmFzZS5cbiAqIFxuICogQHRlbXBsYXRlIFMgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHBhcmFtIHtVcGRhdGVFbnRpdHlBcmdzPFM+fSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxFbnRpdHk+fSAtIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSB1cGRhdGVkIGVudGl0eS5cbiAqIEB0aHJvd3Mge0Vycm9yfSAtIElmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIHRoZSB1cGRhdGUgb3BlcmF0aW9uLCBvciBpZiB2YWxpZGF0aW9uIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPikge1xuICAgIGNvbnN0IHtcbiAgICAgICAgaWQsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIG9wZXJhdG9ycyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcbiAgICAgICAgY3J1ZFR5cGUgPSAndXBkYXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6dXBkYXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuICAgICAgICBjb21wb3NpdGVLZXlEYXRhLFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwZGF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIHsgZGF0YSwgcHJvdmlkZWRDb21wb3NpdGVLZXlEYXRhOiBjb21wb3NpdGVLZXlEYXRhIH0pO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIHVwZGF0ZSBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgLy8gcHJlIGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2JlZm9yZVVwZGF0ZScsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGRhdGEsXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBpZGVudGlmaWVycywgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIHVwZGF0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIC0tLSBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgIGlmIChzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICBmb3IgKGNvbnN0IGluZGV4TmFtZSBpbiBzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICAgICAgY29uc3QgaW5kZXhEZWZpbml0aW9uID0gc2NoZW1hLmluZGV4ZXNbIGluZGV4TmFtZSBdO1xuICAgICAgICAgICAgaWYgKGluZGV4RGVmaW5pdGlvbikge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBrQ29tcG9zaXRlID0gaW5kZXhEZWZpbml0aW9uLnBrPy5jb21wb3NpdGU7XG4gICAgICAgICAgICAgICAgaWYgKHBrQ29tcG9zaXRlICYmIEFycmF5LmlzQXJyYXkocGtDb21wb3NpdGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHBrQ29tcG9zaXRlLmZvckVhY2goYXR0ciA9PiBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcy5hZGQoYXR0cikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb25zdCBza0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5zaz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChza0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHNrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBza0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREI6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIGlmIChhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcy5zaXplID4gMCkge1xuICAgICAgICBpZiAoY29tcG9zaXRlS2V5RGF0YSAmJiB0eXBlb2YgY29tcG9zaXRlS2V5RGF0YSA9PT0gJ29iamVjdCcpIHtcblxuICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBwcm92aWRlZCBjb21wb3NpdGVLZXlEYXRhIGZvciB1cGRhdGUuYCwgY29tcG9zaXRlS2V5RGF0YSk7XG5cbiAgICAgICAgICAgIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCID0gY29tcG9zaXRlS2V5RGF0YTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBjb3ZlcnMgYWxsIGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzXG4gICAgICAgICAgICBjb25zdCBtaXNzaW5nRnJvbVByb3ZpZGVkID0gQXJyYXkuZnJvbShhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcykuZmlsdGVyKGF0dHIgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICFkYXRhLmhhc093blByb3BlcnR5KGF0dHIpXG4gICAgICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgICAgICFpZGVudGlmaWVycy5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChtaXNzaW5nRnJvbVByb3ZpZGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgUHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBpcyBtaXNzaW5nIHNvbWUgcmVxdWlyZWQgY29tcG9zaXRlIGF0dHJpYnV0ZXM6ICR7bWlzc2luZ0Zyb21Qcm92aWRlZC5qb2luKCcsICcpfS4gVXBkYXRlIG1heSBmYWlsIGlmIHRoZXNlIGFyZSBuZWVkZWQgYnkgRWxlY3Ryb0RCLmApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlS2V5RGF0YSBwcm92aWRlZCwgcHJlcGFyaW5nIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzIGludGVybmFsbHkuIFJlcXVpcmVkOmAsIEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpKTtcblxuICAgICAgICAgICAgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIgPSBhd2FpdCBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBkYXRhOiBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT4sXG4gICAgICAgICAgICAgICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzOiBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICBsb2dnZXIsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBObyBjb21wb3NpdGUgYXR0cmlidXRlcyBkZWZpbmVkIGluIHNjaGVtYSBvciBuZWVkZWQgZm9yIHRoaXMgdXBkYXRlLmApO1xuICAgIH1cbiAgICAvLyAtLS0gRW5kIENvbXBvc2l0ZSBLZXkgSGFuZGxpbmcgLS0tXG5cblxuXG4gICAgLy8gVXNlIEVsZWN0cm9EQiBmb3IgYWxsIGZpZWxkcyBpbmNsdWRpbmcgX2FjdG9yIChub3cgaW4gc2NoZW1hKVxuICAgIGNvbnN0IHF1ZXJ5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkucGF0Y2goaWRlbnRpZmllcnMpLnNldChkYXRhKTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQikubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYFVzaW5nIGNvbXBvc2l0ZSB2YWx1ZXMgZm9yIEVsZWN0cm9EQiBwYXRjaDpgLCBmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQik7XG4gICAgICAgIHF1ZXJ5LmNvbXBvc2l0ZShmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQik7XG4gICAgfVxuXG4gICAgaWYgKG9wZXJhdG9ycz8ucmVtb3ZlKSB7XG4gICAgICAgIHF1ZXJ5LnJlbW92ZShvcGVyYXRvcnMucmVtb3ZlIGFzIGFueSk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgcXVlcnkuZ28oKTtcblxuXG5cbiAgICAvLyAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyVXBkYXRlJywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwZGF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEsIGVudGl0eS5kYXRhKTtcblxuICAgIHJldHVybiBlbnRpdHk7XG59XG5cbi8qKlxuICogdGhlIGFyZ3VtZW50cyBmb3IgZGVsZXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElEIG9mIHRoZSBlbnRpdHkgdG8gYmUgZGVsZXRlZC5cbiAgICAgKi9cbiAgICBpZDogT3BzU2NoZW1hWyAnZGVsZXRlJyBdO1xufVxuXG4vKipcbiAqIERlbGV0ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgZGVsZXRpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSBkZWxldGVkIGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBEZWxldGVFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZGVsZXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZGVsZXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZGVsZXRlRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVEZWxldGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICBjb25zdCBpZGVudGlmaWVycyA9IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKTtcblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3JcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoe2VudGl0eU5hbWUsIGNydWRUeXBlLCBpZGVudGlmaWVycywgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgZGVsZXRlOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZGVsZXRlKGlkZW50aWZpZXJzKS5nbygpO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2FmdGVyRGVsZXRlJywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZGVsZXRlRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIHJldHVybiBlbnRpdHk7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBiYXRjaCBkZWxldGluZyBlbnRpdGllcy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVCYXRjaEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgZW50aXR5IElEcyB0byBkZWxldGUuXG4gICAgICovXG4gICAgaWRzOiBBcnJheTxPcHNTY2hlbWFbICdkZWxldGUnIF0+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqL1xuICAgIGNvbmN1cnJlbnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRGVsZXRlcyBtdWx0aXBsZSBlbnRpdGllcyBpbiBhIGJhdGNoIG9wZXJhdGlvbi5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIHRoZSBlbnRpdGllcy5cbiAqIEByZXR1cm5zIFRoZSB1bnByb2Nlc3NlZCBpdGVtcyB0aGF0IGNvdWxkbid0IGJlIGRlbGV0ZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVCYXRjaEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBEZWxldGVCYXRjaEVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgY29uY3VycmVudCA9IDEsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdkZWxldGUnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpkZWxldGVCYXRjaEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBkZWxldGVCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZHMsIGNvbmN1cnJlbnQgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZvciBhbGwgaXRlbXMgaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlkcy5tYXAoaWQgPT4gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuICAgIC8vIFZhbGlkYXRlIGVhY2ggaXRlbSBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCB2YWxpZGF0aW9ucyA9IGF3YWl0IFByb21pc2UuYWxsKGlkZW50aWZpZXJzQmF0Y2gubWFwKGFzeW5jIGlkZW50aWZpZXJzID0+XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhY3RvcjogYWN0b3JcbiAgICAgICAgfSlcbiAgICApKTtcblxuICAgIC8vIENoZWNrIGZvciB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uc1xuICAgICAgICAubWFwKCh2YWxpZGF0aW9uLCBpbmRleCkgPT4gKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgdmFsaWRhdGlvbiB9KSA9PiAhdmFsaWRhdGlvbi5wYXNzKTtcblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uRXJyb3JzLmZsYXRNYXAoKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkgPT5cbiAgICAgICAgICAgICh2YWxpZGF0aW9uLmVycm9ycyB8fCBbXSkubWFwKGVycm9yID0+ICh7XG4gICAgICAgICAgICAgICAgLi4uZXJyb3IsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYEl0ZW0gJHtpbmRleH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgKSk7XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBiYXRjaCBkZWxldGUgb3BlcmF0aW9uIHdpdGggY29uY3VycmVuY3kgY29udHJvbFxuICAgIC8vIFBlciBFbGVjdHJvREIgZG9jczogaHR0cDovL2VsZWN0cm9kYi5kZXYvZW4vbXV0YXRpb25zL2JhdGNoLWRlbGV0ZS9cbiAgICAvLyBOb3RlOiBFbGVjdHJvREIgdHlwZXMgdXNlICdjb25jdXJyZW5jeScgd2hpbGUgZG9jcyBzaG93ICdjb25jdXJyZW50J1xuICAgIGNvbnN0IGJ1bGtPcHRpb25zOiBQYXJ0aWFsPEJ1bGtPcHRpb25zPiA9IHtcbiAgICAgICAgY29uY3VycmVuY3k6IGNvbmN1cnJlbnRcbiAgICB9O1xuXG4gICAgY29uc3QgZWxlY3Ryb1Jlc3VsdCA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVyc0JhdGNoKS5nbyhidWxrT3B0aW9ucyk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZGVsZXRlQmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWRzOmAsIGlkcyk7XG5cbiAgICByZXR1cm4gZWxlY3Ryb1Jlc3VsdDtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGZpbHRlciBvYmplY3Qgd2l0aCBlcSBvcGVyYXRvcnMgdG8gYSBzaW1wbGlmaWVkIGZvcm0uXG4gKiBFeGFtcGxlOiB7IGFnZTogeyBlcTogNjUgfSB9IGJlY29tZXMgeyBhZ2U6IDY1IH1cbiAqIEBwYXJhbSBmaWx0ZXJzIC0gVGhlIGZpbHRlciBvYmplY3QgdG8gc2ltcGxpZnlcbiAqIEByZXR1cm5zIEEgbmV3IGZpbHRlciBvYmplY3Qgd2l0aCBlcSBvcGVyYXRvcnMgY29udmVydGVkIHRvIGRpcmVjdCB2YWx1ZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbXBsaWZ5RmlsdGVycyhmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkKTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgaWYgKCFmaWx0ZXJzKSByZXR1cm4ge307XG5cbiAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGZpbHRlcnMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICdlcScgaW4gdmFsdWUpIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZS5lcTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBleHBvcnQgY2xhc3MgRW50aXR5Q3J1ZFNlcnZpY2U8UyBleHRlbmRzIFNjaGVtYTxhbnksIGFueSwgYW55Pj57XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgbGlzdChvcHRpb25zOiBMaXN0RW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgbGlzdEVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgY3JlYXRlKG9wdGlvbnM6IENyZWF0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgdXBkYXRlKG9wdGlvbnM6IFVwZGF0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IHVwZGF0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldEVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGdldEVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgZGVsZXRlKG9wdGlvbnM6IERlbGV0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGRlbGV0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG4vLyB9XG5cblxuLy8gZXhwb3J0IGNvbnN0IERlZmF1bHRFbnRpdHlDcnVkU2VydmljZSA9IG5ldyBFbnRpdHlDcnVkU2VydmljZSgpOyJdfQ==