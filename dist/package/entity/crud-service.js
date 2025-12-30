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
    const entity = await observers_1.QueryObserver.track(entityName, 'get', () => entityService.getRepository().get(identifiers).go({ attributes }));
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
    const result = await observers_1.QueryObserver.track(entityName, 'batchGet', () => entityService.getRepository().get(identifiersBatch).go({
        attributes,
        concurrent
    }), { itemCount: identifiersBatch.length });
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
    const entity = await observers_1.QueryObserver.track(entityName, 'create', () => entityService.getRepository().create(data).go());
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
    const entity = await observers_1.QueryObserver.track(entityName, 'upsert', () => entityService.getRepository().upsert(data).go({ response: "all_old" }));
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
        entities = await observers_1.QueryObserver.track(entityName, 'list', () => indexQuery.go({ attributes: attributes, ...(0, utils_1.removeEmpty)(pagination) }), { filters, indexName: matchResult.indexName, pagination });
    }
    else {
        // Use match for full scan
        logger.warn(`WARNING: No matching index found for entity: ${entityName}, using match for full scan`, filters);
        // Track full scan - CRITICAL: expensive performance/cost issue
        observers_1.MetricObserver.increment(`entity.full_scan`, 1, {
            tags: { entityName, operation: 'list' },
            level: 'warn',
        });
        // Add checkpoint for visibility
        observers_1.SpanObserver.getCurrentSpan()?.checkpoint?.('database.full_scan', {
            tags: {
                'db.entity_name': entityName,
                'db.operation': 'list',
                'db.warning': 'no_index_found',
            },
            metrics: {
                'db.full_scan': 1,
            },
            data: { fullScanFilters: filters || {} },
        });
        const scanQuery = repository.scan;
        if (filters && !(0, utils_1.isEmptyObject)(filters)) {
            scanQuery.where((attr, op) => (0, query_1.entityFilterCriteriaToExpression)(filters, attr, op));
        }
        // TODO: add attributes to scan query
        entities = await observers_1.QueryObserver.track(entityName, 'scan', () => scanQuery.go((0, utils_1.removeEmpty)(pagination)), { filters, pagination });
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
        entities = await observers_1.QueryObserver.track(entityName, 'query', () => indexQuery.go({ attributes: attributes, ...(0, utils_1.removeEmpty)(pagination) }), { filters, indexName: matchResult.indexName, pagination });
    }
    else {
        // Use match for full scan
        logger.warn(`WARNING: No matching index found for entity: ${entityName}, using match for full scan`, filters);
        // Track full scan - CRITICAL: expensive performance/cost issue
        observers_1.MetricObserver.increment(`entity.full_scan`, 1, {
            tags: { entityName, operation: 'query' },
            level: 'warn',
        });
        // Add checkpoint for visibility
        observers_1.SpanObserver.getCurrentSpan()?.checkpoint?.('database.full_scan', {
            tags: {
                'db.entity_name': entityName,
                'db.operation': 'query',
                'db.warning': 'no_index_found',
            },
            metrics: {
                'db.full_scan': 1,
            },
            data: { fullScanFilters: filters || {} },
        });
        const scanQuery = repository.scan;
        if (filters && !(0, utils_1.isEmptyObject)(filters)) {
            scanQuery.where((attr, op) => (0, query_1.entityFilterCriteriaToExpression)(filters, attr, op));
        }
        // TODO: add attributes to scan query
        entities = await observers_1.QueryObserver.track(entityName, 'scan', () => scanQuery.go((0, utils_1.removeEmpty)(pagination)), { filters, pagination });
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
    const entity = await observers_1.QueryObserver.track(entityName, 'update', () => query.go());
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
    const entity = await observers_1.QueryObserver.track(entityName, 'delete', () => entityService.getRepository().delete(identifiers).go());
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
    const electroResult = await observers_1.QueryObserver.track(entityName, 'batchDelete', () => entityService.getRepository().delete(identifiersBatch).go(bulkOptions), { itemCount: identifiersBatch.length });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEwRUEsOEJBdURDO0FBOEJELHdDQWdFQztBQTRCRCxvQ0F5REM7QUErQkQsb0NBb0VDO0FBaUNELDhEQTBCQztBQVVELDhDQTZFQztBQVFELGdDQThGQztBQVdELGtDQThGQztBQTJIRCxvQ0F3SUM7QUFzQkQsb0NBcURDO0FBMEJELDhDQStEQztBQVFELDBDQVlDO0FBbHJDRCw0Q0FBMEM7QUFDMUMsb0NBQTJDO0FBQzNDLHdDQUFtRDtBQUNuRCxvQ0FBc0Q7QUFDdEQsOENBQWtFO0FBRWxFLGdFQUFrRTtBQUVsRSxtQ0FBMkQ7QUFFM0QsMERBQXlGO0FBMER6Rjs7OztHQUlHO0FBQ0ksS0FBSyxVQUFVLFNBQVMsQ0FBd0MsT0FBeUI7SUFFNUYsTUFBTSxFQUNGLEVBQUUsRUFDRixVQUFVLEVBQ1YsVUFBVSxFQUNWLGFBQWEsRUFFYixLQUFLLEVBQ0wsTUFBTSxFQUVOLFFBQVEsR0FBRyxLQUFLLEVBQ2hCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsd0JBQXdCLENBQUMsRUFDL0MsU0FBUyxHQUFHLDZCQUFnQixFQUM1QixVQUFVLEdBQUcsc0JBQVUsQ0FBQyxPQUFPLEVBQy9CLGVBQWUsR0FBRyx1QkFBZSxDQUFDLE9BQU8sR0FFNUMsR0FBRyxPQUFPLENBQUM7SUFFWixNQUFNLENBQUMsS0FBSyxDQUFDLCtDQUErQyxVQUFVLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBRS9GLDZFQUE2RTtJQUU3RSxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDLENBQUM7SUFFL0Qsc0JBQXNCO0lBQ3RCLHdHQUF3RztJQUN4RywyQkFBMkI7SUFDM0Isb0ZBQW9GO0lBQ3BGLElBQUk7SUFHSixjQUFj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T0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNuRCxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3RELE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzdCLENBQUM7YUFBTSxDQUFDO1lBQ0osTUFBTSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztRQUMxQixDQUFDO0lBQ0wsQ0FBQztJQUNELE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUM7QUFFRCxtRUFBbUU7QUFFbkUsc0RBQXNEO0FBQ3RELDRDQUE0QztBQUM1QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsb0RBQW9EO0FBQ3BELDJDQUEyQztBQUMzQyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBQ1IsSUFBSTtBQUdKLG1FQUFtRSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQnVsa09wdGlvbnMgfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBBdXRob3JpemVyIH0gZnJvbSBcIi4uL2F1dGhvcml6ZVwiO1xuaW1wb3J0IHsgRXZlbnREaXNwYXRjaGVyIH0gZnJvbSBcIi4uL2V2ZW50XCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgaXNFbXB0eU9iamVjdCwgcmVtb3ZlRW1wdHkgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IERlZmF1bHRWYWxpZGF0b3IsIHR5cGUgSVZhbGlkYXRvciB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEsIEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYSwgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBURW50aXR5T3BzSW5wdXRTY2hlbWFzIH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IEVudGl0eVZhbGlkYXRpb25FcnJvciB9IGZyb20gXCIuL2Vycm9ycy92YWxpZGF0aW9uLWVycm9yXCI7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbiB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVF1ZXJ5IH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7IE1ldHJpY09ic2VydmVyLCBTcGFuT2JzZXJ2ZXIsIFF1ZXJ5T2JzZXJ2ZXIgfSBmcm9tIFwiLi4vb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnNcIjtcblxuLyoqXG4gKiBcbiAqIFNlcmlhbGl6ZXIvZm9ybWF0dGVyXG4gKiAgLSBodHRwczovL2dpdGh1Yi5jb20vZGt6bHYvbWljcm8tdHJhbnNmb3JtXG4gKiAgXG4gKiBFdmVudCBkaXNwYXRjaGVyXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9Gb3hBbmRGbHkvdHMtZXZlbnQtZGlzcGF0Y2hlci9ibG9iL21hc3Rlci9zcmMvaW5kZXgudHNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL3J5YXJkbGV5L3RzLWJ1c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vYmluaWVyL3RpbnktdHlwZWQtZW1pdHRlci90cmVlL21hc3RlclxuICogXG4gKiBSb3V0ZXJcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL2JlcnN0ZW5kL3RpbnktcmVxdWVzdC1yb3V0ZXIvYmxvYi9tYXN0ZXIvc3JjL3JvdXRlci50c1xuICogXG4gKiBESVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbmljb2pzL3R5cGVkLWluamVjdFxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbWljcm9zb2Z0L3RzeXJpbmdlXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9vd2phL2lvY1xuICogXG4gKiBcbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhc2VFbnRpdHlDcnVkQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcblxuICAgIGNydWRUeXBlPzoga2V5b2YgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuICAgIGFjdG9yPzogQWN0b3I7IC8vIEFjdG9yIGNvbnRleHQ6IGNvbXByZWhlbnNpdmUgYWN0b3IgaW5mb3JtYXRpb24gaW5jbHVkaW5nIGF1dGhlbnRpY2F0aW9uIGRldGFpbHNcbiAgICB0ZW5hbnQ/OiBhbnk7IC8vIHRvZG86IGRlZmluZSB0ZW5hbnQgY29udGV4dFxuXG4gICAgbG9nZ2VyPzogSUxvZ2dlcjtcbiAgICB2YWxpZGF0b3I/OiBJVmFsaWRhdG9yO1xuICAgIGF1dGhvcml6ZXI/OiBBdXRob3JpemVyLklBdXRob3JpemVyOyAgICAgICAgLy8gdG9kbzogZGVmaW5lIGF1dGhvcml6ZXIgc2lnbmF0dXJlXG4gICAgZXZlbnREaXNwYXRjaGVyPzogRXZlbnREaXNwYXRjaGVyLklFdmVudERpc3BhdGNoZXI7ICAvLyB0b2RvIGRlZmluZSBldmVudCBkaXNwYXRjaGVyIHNpZ25hdHVyZVxuXG4gICAgLy8gdGVsZW1ldHJ5XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIHJldHJpZXZlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byBpbmNsdWRlIGluIHRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciByZXRyaWV2aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZ2V0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Z2V0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkLCBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZUdldCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGlkZW50aWZpZXJzLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciBnZXQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cblxuICAgIC8vIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2dldCcsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVycykuZ28oeyBhdHRyaWJ1dGVzIH0pXG4gICAgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdhZnRlckdldCcsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGdldEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICByZXR1cm4gZW50aXR5O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgcmV0cmlldmluZyBtdWx0aXBsZSBlbnRpdGllcyBpbiBhIGJhdGNoLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdldEJhdGNoRW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBlbnRpdHkgSURzIHRvIHJldHJpZXZlLlxuICAgICAqL1xuICAgIGlkczogQXJyYXk8T3BzU2NoZW1hWyAnZ2V0JyBdPjtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgaW4gdGhlIHJldHJpZXZlZCBlbnRpdGllcy5cbiAgICAgKi9cbiAgICBhdHRyaWJ1dGVzPzogQXJyYXk8c3RyaW5nPjtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKi9cbiAgICBjb25jdXJyZW50PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBtdWx0aXBsZSBlbnRpdGllcyBpbiBhIGJhdGNoIG9wZXJhdGlvbi5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHJldHJpZXZpbmcgdGhlIGVudGl0aWVzLlxuICogQHJldHVybnMgVGhlIHJldHJpZXZlZCBlbnRpdGllcyBhbmQgYW55IHVucHJvY2Vzc2VkIGl0ZW1zLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0QmF0Y2hFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogR2V0QmF0Y2hFbnRpdHlBcmdzPFM+KSB7XG4gICAgY29uc3Qge1xuICAgICAgICBpZHMsXG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGNvbmN1cnJlbnQgPSAxLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZ2V0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Z2V0QmF0Y2hFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZ2V0QmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9OmAsIHsgaWRzLCBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gRXh0cmFjdCBpZGVudGlmaWVycyBmb3IgYWxsIGl0ZW1zIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IGlkZW50aWZpZXJzQmF0Y2ggPSBpZHMubWFwKGlkID0+IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKSk7XG5cbiAgICAvLyBWYWxpZGF0ZSBlYWNoIGl0ZW0gaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgdmFsaWRhdGlvbnMgPSBhd2FpdCBQcm9taXNlLmFsbChpZGVudGlmaWVyc0JhdGNoLm1hcChhc3luYyBpZGVudGlmaWVycyA9PlxuICAgICAgICB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgICAgIH0pXG4gICAgKSk7XG5cbiAgICAvLyBDaGVjayBmb3IgdmFsaWRhdGlvbiBlcnJvcnNcbiAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbnNcbiAgICAgICAgLm1hcCgodmFsaWRhdGlvbiwgaW5kZXgpID0+ICh7IHZhbGlkYXRpb24sIGluZGV4IH0pKVxuICAgICAgICAuZmlsdGVyKCh7IHZhbGlkYXRpb24gfSkgPT4gIXZhbGlkYXRpb24ucGFzcyk7XG5cbiAgICBpZiAodmFsaWRhdGlvbkVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbkVycm9ycy5mbGF0TWFwKCh7IHZhbGlkYXRpb24sIGluZGV4IH0pID0+XG4gICAgICAgICAgICAodmFsaWRhdGlvbi5lcnJvcnMgfHwgW10pLm1hcChlcnJvciA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmVycm9yLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBJdGVtICR7aW5kZXh9OiAke2Vycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgfSkpXG4gICAgICAgICkpO1xuICAgIH1cblxuICAgIC8vIFBlcmZvcm0gYmF0Y2ggZ2V0IG9wZXJhdGlvbiB3aXRoIGNvbmN1cnJlbmN5IGNvbnRyb2xcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdiYXRjaEdldCcsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVyc0JhdGNoKS5nbyh7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICB9KSxcbiAgICAgICAgeyBpdGVtQ291bnQ6IGlkZW50aWZpZXJzQmF0Y2gubGVuZ3RoIH1cbiAgICApO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGdldEJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkczpgLCBpZHMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZGF0YTogQXJyYXkuaXNBcnJheShyZXN1bHQuZGF0YSkgPyByZXN1bHQuZGF0YSA6IChyZXN1bHQuZGF0YSA/IFsgcmVzdWx0LmRhdGEgXSA6IFtdKSxcbiAgICAgICAgdW5wcm9jZXNzZWQ6IFtdICAvLyBFbGVjdHJvREIgZG9lc24ndCBzdXBwb3J0IHVucHJvY2Vzc2VkIGl0ZW1zIHRyYWNraW5nLCBzbyB3ZSByZXR1cm4gZW1wdHkgYXJyYXlcbiAgICB9O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENyZWF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAnY3JlYXRlJyBdO1xufVxuXG5leHBvcnQgdHlwZSBDcmVhdGVFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgdXNpbmcgdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkuXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIGNyZWF0ZSBvcGVyYXRpb24sIHZhbGlkYXRpb24gZmFpbHMsIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogQ3JlYXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8Q3JlYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdjcmVhdGUnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpjcmVhdGVFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiBjcmVhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhKTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciBjcmVhdGUgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVDcmVhdGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3IsXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBkYXRhLCBhY3RvciwgdGVuYW50IH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgY3JlYXRlOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnY3JlYXRlJywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuY3JlYXRlKGRhdGEpLmdvKClcbiAgICApO1xuXG4gICAgLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlckNyZWF0ZScsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiBjcmVhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5IGFzIENyZWF0ZUVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyBhbiBlbnRpdHkuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXBzZXJ0RW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGF0YSBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cHNlcnQnIF07XG59XG5cbmV4cG9ydCB0eXBlIFVwc2VydEVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbiAgICB3YXNDcmVhdGVkPzogYm9vbGVhbiAgLy8gdHJ1ZSBpZiByZWNvcmQgd2FzIGNyZWF0ZWQsIGZhbHNlIGlmIGFscmVhZHkgZXhpc3RlZFxuICAgIG9sZERhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+ICAvLyBwcmV2aW91cyBkYXRhIGlmIGl0IHdhcyBhbiB1cGRhdGUgKHVuZGVmaW5lZCBmb3IgY3JlYXRlcylcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGVudGl0eSB1c2luZyB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eSB3aXRoIHdhc0NyZWF0ZWQgZmxhZyBpbmRpY2F0aW5nIGlmIGl0IHdhcyBhIG5ldyByZWNvcmQuXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIHVwc2VydCBvcGVyYXRpb24sIHZhbGlkYXRpb24gZmFpbHMsIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHNlcnRFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogVXBzZXJ0RW50aXR5QXJnczxTPik6IFByb21pc2U8VXBzZXJ0RW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICd1cHNlcnQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTp1cHNlcnRFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cHNlcnQgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhKTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciB1cHNlcnQgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVVcHNlcnQnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3IsXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBkYXRhLCBhY3RvciwgdGVuYW50IH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgdXBzZXJ0OiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgLy8gVXNlIFwiYWxsX29sZFwiIHRvIGdldCB0aGUgcHJldmlvdXMgaXRlbSBzdGF0ZSAtIGFsbG93cyB1cyB0byBkZXRlY3QgY3JlYXRlIHZzIHVwZGF0ZVxuICAgIC8vIElmIG9sZERhdGEgaXMgZW1wdHkvbnVsbCwgaXQgd2FzIGEgQ1JFQVRFLiBJZiBpdCBoYXMgZGF0YSwgaXQgd2FzIGFuIFVQREFURS5cbiAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICd1cHNlcnQnLCAoKSA9PlxuICAgICAgICBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS51cHNlcnQoZGF0YSBhcyBhbnkpLmdvKHsgcmVzcG9uc2U6IFwiYWxsX29sZFwiIH0pXG4gICAgKTtcblxuICAgIGNvbnN0IHdhc0NyZWF0ZWQgPSAhZW50aXR5LmRhdGEgfHwgT2JqZWN0LmtleXMoZW50aXR5LmRhdGEpLmxlbmd0aCA9PT0gMDtcbiAgICBjb25zdCBvbGREYXRhID0gd2FzQ3JlYXRlZCA/IHVuZGVmaW5lZCA6IGVudGl0eS5kYXRhO1xuXG4gICAgLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclVwc2VydCcsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cHNlcnQgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gd2FzQ3JlYXRlZDogJHt3YXNDcmVhdGVkfWApO1xuXG4gICAgLy8gTm90ZTogd2l0aCBcImFsbF9vbGRcIiwgZW50aXR5LmRhdGEgY29udGFpbnMgdGhlIE9MRCBkYXRhLCB3ZSBuZWVkIHRvIHJldHVybiB0aGUgTkVXIGRhdGFcbiAgICAvLyBTaW5jZSB3ZSBkb24ndCBoYXZlIHRoZSBuZXcgZGF0YSBmcm9tIER5bmFtb0RCLCB3ZSByZXR1cm4gdGhlIGlucHV0IGRhdGEgYXMgdGhlIG5ldyBkYXRhXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZGF0YTogZGF0YSBhcyBhbnksICAvLyBUaGUgbmV3IGRhdGEgd2UganVzdCB1cHNlcnRlZFxuICAgICAgICB3YXNDcmVhdGVkLFxuICAgICAgICBvbGREYXRhXG4gICAgfSBhcyBVcHNlcnRFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGxpc3RpbmcgZW50aXRpZXMuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMaXN0RW50aXR5QXJnczxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIHF1ZXJ5OiBFbnRpdHlRdWVyeTxTY2g+XG59XG5cbi8qKlxuICogT3BlcmF0b3JzIHRoYXQgc2hvdWxkIE5PVCBiZSB1c2VkIGZvciBpbmRleCBtYXRjaGluZy5cbiAqIFRoZXNlIG9wZXJhdG9ycyBsb29rIGZvciByZWNvcmRzIHdoZXJlIHRoZSBhdHRyaWJ1dGUgZG9lc24ndCBleGlzdCBvciBpcyBlbXB0eSxcbiAqIGJ1dCB0aG9zZSByZWNvcmRzIHdvbid0IGJlIGluIGEgc3BhcnNlIEdTSSB3aGVyZSB0aGF0IGF0dHJpYnV0ZSBpcyB0aGUgUEsuXG4gKi9cbmNvbnN0IElOREVYX0VYQ0xVREVEX09QRVJBVE9SUyA9IG5ldyBTZXQoW1xuICAgICdub3RFeGlzdHMnLCAnZXhpc3RzJywgJ2lzTnVsbCcsICdub3ROdWxsJywgJ2VtcHR5JywgJ25vdEVtcHR5J1xuXSk7XG5cbi8qKlxuICogQ29udmVydCBGaWx0ZXJHcm91cCBmb3JtYXQgdG8gc2ltcGxlIG9iamVjdCBmb3JtYXQgZm9yIGluZGV4IG1hdGNoaW5nLlxuICogRmlsdGVyR3JvdXA6IHsgYW5kOiBbeyBhdHRyaWJ1dGU6ICdmb28nLCBlcTogJ2JhcicgfV0gfVxuICogU2ltcGxlOiB7IGZvbzogeyBlcTogJ2JhcicgfSB9XG4gKiBcbiAqIE9ubHkgZXh0cmFjdHMgZmlsdGVycyBmcm9tIHRoZSAnYW5kJyBhcnJheSBhcyB0aG9zZSBhcmUgdGhlIG9uZXNcbiAqIHRoYXQgY2FuIGJlIHVzZWQgZm9yIEdTSSBwYXJ0aXRpb24ga2V5IG1hdGNoaW5nLlxuICogXG4gKiBFeGNsdWRlcyBleGlzdGVuY2UvbnVsbCBmaWx0ZXJzIChub3RFeGlzdHMsIGlzTnVsbCwgZW1wdHksIGV0Yy4pIGZyb20gaW5kZXhcbiAqIG1hdGNoaW5nIHNpbmNlIHJlY29yZHMgd2l0aCBtaXNzaW5nIGF0dHJpYnV0ZXMgd29uJ3QgYmUgaW4gc3BhcnNlIEdTSXMuXG4gKiBcbiAqIEBwYXJhbSBmaWx0ZXJzIC0gVGhlIGZpbHRlcnMgaW4gRmlsdGVyR3JvdXAgb3Igc2ltcGxlIGZvcm1hdFxuICogQHJldHVybnMgRmlsdGVycyBpbiBzaW1wbGUgb2JqZWN0IGZvcm1hdCB7IGF0dHI6IHsgb3A6IHZhbCB9IH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55Pik6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIC8vIEFscmVhZHkgaW4gc2ltcGxlIGZvcm1hdCBvciBlbXB0eVxuICAgIGlmICghZmlsdGVycyB8fCAhKCdhbmQnIGluIGZpbHRlcnMpKSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJzIHx8IHt9O1xuICAgIH1cblxuICAgIGNvbnN0IHNpbXBsZTogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuXG4gICAgLy8gRXh0cmFjdCBmcm9tICdhbmQnIGFycmF5IC0gdGhlc2UgYXJlIEFORCBjb25kaXRpb25zIHRoYXQgY291bGQgbWF0Y2ggR1NJIFBLXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGZpbHRlcnMuYW5kIHx8IFtdKSB7XG4gICAgICAgIGlmIChpdGVtLmF0dHJpYnV0ZSkge1xuICAgICAgICAgICAgY29uc3Qgb3BlcmF0b3JzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGl0ZW0pKSB7XG4gICAgICAgICAgICAgICAgLy8gU2tpcCB0aGUgJ2F0dHJpYnV0ZScga2V5IGFuZCBleGNsdWRlIGV4aXN0ZW5jZS9udWxsIG9wZXJhdG9ycyBmcm9tIGluZGV4IG1hdGNoaW5nXG4gICAgICAgICAgICAgICAgLy8gUmVjb3JkcyB3aXRoIG1pc3NpbmcgYXR0cmlidXRlcyB3b24ndCBiZSBpbiBzcGFyc2UgR1NJc1xuICAgICAgICAgICAgICAgIGlmIChrZXkgIT09ICdhdHRyaWJ1dGUnICYmICFJTkRFWF9FWENMVURFRF9PUEVSQVRPUlMuaGFzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgb3BlcmF0b3JzWyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhvcGVyYXRvcnMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBzaW1wbGVbIGl0ZW0uYXR0cmlidXRlIF0gPSBvcGVyYXRvcnM7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2ltcGxlO1xufVxuXG4vKipcbiAqIEZpbmRzIGEgbWF0Y2hpbmcgaW5kZXggYmFzZWQgb24gdGhlIHByb3ZpZGVkIGZpbHRlcnMgYW5kIHNjaGVtYS5cbiAqIEBwYXJhbSBzY2hlbWEgLSBUaGUgZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVycyB0byBtYXRjaCBhZ2FpbnN0XG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBlbnRpdHlcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gVGhlIGVudGl0eSBzZXJ2aWNlXG4gKiBAcmV0dXJucyBUaGUgbmFtZSBvZiB0aGUgbWF0Y2hpbmcgaW5kZXggYW5kIHRoZSBmaWx0ZXJzIHVzZWQgdG8gbWF0Y2ggaXQgb3IgdW5kZWZpbmVkIGlmIG5vIG1hdGNoIGlzIGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaW5kTWF0Y2hpbmdJbmRleChcbiAgICBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8YW55PlxuKTogeyBpbmRleE5hbWU6IHN0cmluZzsgaW5kZXhGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IH0gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmZpbmRNYXRjaGluZ0luZGV4Jyk7XG4gICAgaWYgKCFmaWx0ZXJzKSBmaWx0ZXJzID0ge307XG5cbiAgICAvLyBDb252ZXJ0IEZpbHRlckdyb3VwIGZvcm1hdCB0byBzaW1wbGUgZm9ybWF0IGZvciBpbmRleCBtYXRjaGluZ1xuICAgIGNvbnN0IHNpbXBsZUZpbHRlcnMgPSBmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlcnMpO1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29udmVydGVkIGZpbHRlcnMgZm9yIGluZGV4IG1hdGNoaW5nOmAsIHsgb3JpZ2luYWw6IGZpbHRlcnMsIHNpbXBsZTogc2ltcGxlRmlsdGVycyB9KTtcblxuICAgIC8vIEZpcnN0IHRyeSBFbGVjdHJvREIncyBpbmRleCBtYXRjaGluZ1xuICAgIGNvbnN0IHJlcG9zaXRvcnkgPSBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKTtcbiAgICBjb25zdCB7IGtleXMsIGluZGV4LCBzaG91bGRTY2FuIH0gPSAocmVwb3NpdG9yeSBhcyBhbnkpLl9maW5kQmVzdEluZGV4S2V5TWF0Y2goc2ltcGxlRmlsdGVycyk7XG5cbiAgICBsb2dnZXIuZGVidWcoYEZvdW5kIEVsZWN0cm9EQiBpbmRleDogJHtpbmRleH0gd2l0aCAke2tleXMubGVuZ3RofSBhdHRyaWJ1dGUgbWF0Y2hlcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9IHdpdGggZmlsdGVycyBhbmQgc2NhbjogJHtzaG91bGRTY2FufSAtIGAsIGtleXMsIHNpbXBsZUZpbHRlcnMpO1xuXG4gICAgLy8gSWYgd2UgZm91bmQgYSBtYXRjaGluZyBpbmRleCwgdXNlIGl0XG4gICAgaWYgKCFzaG91bGRTY2FuKSB7XG4gICAgICAgIGNvbnN0IGluZGV4RmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuXG4gICAgICAgIC8vIEFkZCBtYXRjaGVkIGtleXMgdG8gaW5kZXhGaWx0ZXJzICh1c2Ugc2ltcGxlRmlsdGVycyB3aGljaCBoYXMgdGhlIHJpZ2h0IGZvcm1hdClcbiAgICAgICAga2V5cy5mb3JFYWNoKChrZXk6IHsgbmFtZTogc3RyaW5nOyB0eXBlOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyVmFsdWUgPSBzaW1wbGVGaWx0ZXJzWyBrZXkubmFtZSBdO1xuICAgICAgICAgICAgaWYgKGZpbHRlclZhbHVlKSB7XG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIGJvdGggeyBlcTogdmFsdWUgfSBhbmQgZGlyZWN0IHZhbHVlIGZvcm1hdHNcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnNbIGtleS5uYW1lIF0gPSBmaWx0ZXJWYWx1ZS5lcSAhPT0gdW5kZWZpbmVkID8gZmlsdGVyVmFsdWUuZXEgOiBmaWx0ZXJWYWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gTWFwIEVsZWN0cm9EQidzIGludGVybmFsIGluZGV4IG5hbWUgYmFjayB0byBvdXIgc2NoZW1hJ3MgaW5kZXggbmFtZVxuICAgICAgICBsZXQgc2NoZW1hSW5kZXhOYW1lID0gaW5kZXg7XG4gICAgICAgIGlmIChpbmRleCA9PT0gJycpIHtcbiAgICAgICAgICAgIHNjaGVtYUluZGV4TmFtZSA9ICdwcmltYXJ5JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGluZGV4IGluIG91ciBzY2hlbWEgdGhhdCBtYXRjaGVzIHRoaXMgR1NJXG4gICAgICAgICAgICBjb25zdCBpbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgbmFtZSwgaW5kZXhEZWYgXSBvZiBPYmplY3QuZW50cmllcyhpbmRleGVzKSkge1xuICAgICAgICAgICAgICAgIGlmIChpbmRleERlZi5pbmRleCA9PT0gaW5kZXgpIHtcbiAgICAgICAgICAgICAgICAgICAgc2NoZW1hSW5kZXhOYW1lID0gbmFtZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBFbGVjdHJvREIgbWF0Y2hlZCBpbmRleDogJHtzY2hlbWFJbmRleE5hbWV9IChpbnRlcm5hbDogJHtpbmRleH0pIHdpdGggJHtrZXlzLmxlbmd0aH0gYXR0cmlidXRlIG1hdGNoZXMgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSB3aXRoIGZpbHRlcnM6YCwgaW5kZXhGaWx0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHsgaW5kZXhOYW1lOiBzY2hlbWFJbmRleE5hbWUsIGluZGV4RmlsdGVycyB9O1xuICAgIH1cblxuICAgIC8vIElmIG5vIGluZGV4IG1hdGNoIGZvdW5kLCBjaGVjayBmb3IgdGVtcGxhdGUgbWF0Y2ggb3IgXCJhbGwgcmVjb3Jkc1wiIGluZGV4XG4gICAgY29uc3QgaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgIGZvciAoY29uc3QgWyBpbmRleE5hbWUsIGluZGV4RGVmIF0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXhlcykpIHtcbiAgICAgICAgaWYgKGluZGV4RGVmLnBrLnRlbXBsYXRlICYmIHR5cGVvZiBpbmRleERlZi5way50ZW1wbGF0ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIC8vIEVudGl0eS1zcGVjaWZpYyB0ZW1wbGF0ZSBtYXRjaFxuICAgICAgICAgICAgaWYgKGluZGV4RGVmLnBrLnRlbXBsYXRlLnRvTG93ZXJDYXNlKCkgPT09IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgdGVtcGxhdGUgbWF0Y2hpbmcgaW5kZXg6ICR7aW5kZXhOYW1lfSBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhOYW1lLFxuICAgICAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gXCJBbGwgcmVjb3Jkc1wiIGluZGV4IHBhdHRlcm4gLSBjb25zdGFudCBQSyB3aXRoIGVtcHR5IGNvbXBvc2l0ZVxuICAgICAgICAgICAgLy8gVXNlZnVsIGZvciBzb3J0ZWQgbGlzdGluZ3Mgd2l0aG91dCBmaWx0ZXJzIChlLmcuLCBBTExfRVZFTlRTLCBBTExfTE9HUylcbiAgICAgICAgICAgIGlmIChpbmRleERlZi5way5jb21wb3NpdGUgJiYgaW5kZXhEZWYucGsuY29tcG9zaXRlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgXCJhbGwgcmVjb3Jkc1wiIGluZGV4OiAke2luZGV4TmFtZX0gd2l0aCBjb25zdGFudCBQSyB0ZW1wbGF0ZTogJHtpbmRleERlZi5way50ZW1wbGF0ZX1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZXMgYSBsaXN0IG9mIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICpcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGxpc3RpbmcgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBhcnJheSBvZiBlbnRpdGllcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxpc3RFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogTGlzdEVudGl0eUFyZ3M8Uz4pIHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2xpc3QnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpsaXN0RW50aXR5JyksXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgICAgIHF1ZXJ5ID0ge30sXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGZpbHRlcnMgPSB7fSxcbiAgICAgICAgYXR0cmlidXRlcyA9IFtdLFxuICAgICAgICBwYWdpbmF0aW9uID0geyBvcmRlcjogJ2FzYycsIHBhZ2VyOiAnY3Vyc29yJywgY3Vyc29yOiBudWxsLCBjb3VudDogMjUsIHBhZ2VzOiB1bmRlZmluZWQsIGxpbWl0OiB1bmRlZmluZWQgfSxcbiAgICAgICAgaW5kZXg6IHNwZWNpZmllZEluZGV4XG4gICAgfSA9IHF1ZXJ5O1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGxpc3RFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZmlsdGVycytwYWdpbmc6YCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlTGlzdCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3JcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoe2VudGl0eU5hbWUsIGNydWRUeXBlLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgLy8gQ2hlY2sgaWYgd2UgaGF2ZSBhIGZpbHRlciB0aGF0IG1hdGNoZXMgYW4gaW5kZXhcbiAgICBjb25zdCBzY2hlbWEgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpO1xuICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gc3BlY2lmaWVkSW5kZXhcbiAgICAgICAgPyB7IGluZGV4TmFtZTogc3BlY2lmaWVkSW5kZXgubmFtZSwgaW5kZXhGaWx0ZXJzOiBzcGVjaWZpZWRJbmRleC5maWx0ZXJzIHx8IHt9IH1cbiAgICAgICAgOiBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlcnMsIGVudGl0eU5hbWUsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBNYXRjaCByZXN1bHQ6YCwgbWF0Y2hSZXN1bHQpO1xuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnbGlzdCcsICgpID0+XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LmdvKHsgYXR0cmlidXRlczogYXR0cmlidXRlcyBhcyBhbnksIC4uLnJlbW92ZUVtcHR5KHBhZ2luYXRpb24pIH0pLFxuICAgICAgICAgICAgeyBmaWx0ZXJzLCBpbmRleE5hbWU6IG1hdGNoUmVzdWx0LmluZGV4TmFtZSwgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoIGZvciBmdWxsIHNjYW5cbiAgICAgICAgbG9nZ2VyLndhcm4oYFdBUk5JTkc6IE5vIG1hdGNoaW5nIGluZGV4IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0sIHVzaW5nIG1hdGNoIGZvciBmdWxsIHNjYW5gLCBmaWx0ZXJzKTtcblxuICAgICAgICAvLyBUcmFjayBmdWxsIHNjYW4gLSBDUklUSUNBTDogZXhwZW5zaXZlIHBlcmZvcm1hbmNlL2Nvc3QgaXNzdWVcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KGBlbnRpdHkuZnVsbF9zY2FuYCwgMSwge1xuICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lLCBvcGVyYXRpb246ICdsaXN0JyB9LFxuICAgICAgICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWRkIGNoZWNrcG9pbnQgZm9yIHZpc2liaWxpdHlcbiAgICAgICAgU3Bhbk9ic2VydmVyLmdldEN1cnJlbnRTcGFuKCk/LmNoZWNrcG9pbnQ/LignZGF0YWJhc2UuZnVsbF9zY2FuJywge1xuICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgICdkYi5lbnRpdHlfbmFtZSc6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgJ2RiLm9wZXJhdGlvbic6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAnZGIud2FybmluZyc6ICdub19pbmRleF9mb3VuZCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICdkYi5mdWxsX3NjYW4nOiAxLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRhdGE6IHsgZnVsbFNjYW5GaWx0ZXJzOiBmaWx0ZXJzIHx8IHt9IH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjYW5RdWVyeSA9IHJlcG9zaXRvcnkuc2NhbjtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIHNjYW5RdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IGFkZCBhdHRyaWJ1dGVzIHRvIHNjYW4gcXVlcnlcbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdzY2FuJywgKCkgPT5cbiAgICAgICAgICAgIHNjYW5RdWVyeS5nbyhyZW1vdmVFbXB0eShwYWdpbmF0aW9uKSksXG4gICAgICAgICAgICB7IGZpbHRlcnMsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJMaXN0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGxpc3RFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZmlsdGVycytwYWdpbmc6YCk7XG5cbiAgICByZXR1cm4gZW50aXRpZXM7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUXVlcnlFbnRpdHlBcmdzPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgcXVlcnk6IEVudGl0eVF1ZXJ5PFNjaD5cbn1cblxuLyoqXG4gKiBFeGVjdXRlcyBhIHF1ZXJ5IG9uIHRoZSBzcGVjaWZpZWQgZW50aXR5LlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgdGhlIHF1ZXJ5LlxuICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJlc3VsdCBvZiB0aGUgcXVlcnkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBxdWVyeUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBRdWVyeUVudGl0eUFyZ3M8Uz4pIHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ3F1ZXJ5JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6cXVlcnlFbnRpdHknKSxcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICAgICAgcXVlcnkgPSB7fVxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGZpbHRlcnMgPSB7fSxcbiAgICAgICAgYXR0cmlidXRlcyA9IFtdLFxuICAgICAgICBwYWdpbmF0aW9uID0geyBvcmRlcjogJ2FzYycsIHBhZ2VyOiAnY3Vyc29yJywgY3Vyc29yOiBudWxsLCBjb3VudDogMjUsIHBhZ2VzOiB1bmRlZmluZWQsIGxpbWl0OiB1bmRlZmluZWQgfSxcbiAgICAgICAgaW5kZXg6IHNwZWNpZmllZEluZGV4XG4gICAgfSA9IHF1ZXJ5O1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZVF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICAvLyAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIENoZWNrIGlmIHdlIGhhdmUgYSBmaWx0ZXIgdGhhdCBtYXRjaGVzIGFuIGluZGV4XG4gICAgY29uc3Qgc2NoZW1hID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICBjb25zdCBtYXRjaFJlc3VsdCA9IHNwZWNpZmllZEluZGV4XG4gICAgICAgID8geyBpbmRleE5hbWU6IHNwZWNpZmllZEluZGV4Lm5hbWUsIGluZGV4RmlsdGVyczogc3BlY2lmaWVkSW5kZXguZmlsdGVycyB8fCB7fSB9XG4gICAgICAgIDogZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCBlbnRpdHlOYW1lLCBlbnRpdHlTZXJ2aWNlKTtcblxuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAncXVlcnknLCAoKSA9PlxuICAgICAgICAgICAgaW5kZXhRdWVyeS5nbyh7IGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXMgYXMgYW55LCAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSB9KSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgaW5kZXhOYW1lOiBtYXRjaFJlc3VsdC5pbmRleE5hbWUsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVzZSBtYXRjaCBmb3IgZnVsbCBzY2FuXG4gICAgICAgIGxvZ2dlci53YXJuKGBXQVJOSU5HOiBObyBtYXRjaGluZyBpbmRleCBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9LCB1c2luZyBtYXRjaCBmb3IgZnVsbCBzY2FuYCwgZmlsdGVycyk7XG5cbiAgICAgICAgLy8gVHJhY2sgZnVsbCBzY2FuIC0gQ1JJVElDQUw6IGV4cGVuc2l2ZSBwZXJmb3JtYW5jZS9jb3N0IGlzc3VlXG4gICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChgZW50aXR5LmZ1bGxfc2NhbmAsIDEsIHtcbiAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZSwgb3BlcmF0aW9uOiAncXVlcnknIH0sXG4gICAgICAgICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgY2hlY2twb2ludCBmb3IgdmlzaWJpbGl0eVxuICAgICAgICBTcGFuT2JzZXJ2ZXIuZ2V0Q3VycmVudFNwYW4oKT8uY2hlY2twb2ludD8uKCdkYXRhYmFzZS5mdWxsX3NjYW4nLCB7XG4gICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmVudGl0eV9uYW1lJzogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAnZGIub3BlcmF0aW9uJzogJ3F1ZXJ5JyxcbiAgICAgICAgICAgICAgICAnZGIud2FybmluZyc6ICdub19pbmRleF9mb3VuZCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICdkYi5mdWxsX3NjYW4nOiAxLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRhdGE6IHsgZnVsbFNjYW5GaWx0ZXJzOiBmaWx0ZXJzIHx8IHt9IH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjYW5RdWVyeSA9IHJlcG9zaXRvcnkuc2NhbjtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIHNjYW5RdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IGFkZCBhdHRyaWJ1dGVzIHRvIHNjYW4gcXVlcnlcbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdzY2FuJywgKCkgPT5cbiAgICAgICAgICAgIHNjYW5RdWVyeS5nbyhyZW1vdmVFbXB0eShwYWdpbmF0aW9uKSksXG4gICAgICAgICAgICB7IGZpbHRlcnMsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJRdWVyeScsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBxdWVyeUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIHJldHVybiBlbnRpdGllcztcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIHVwZGF0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVcGRhdGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIHVwZGF0ZS5cbiAgICAgKi9cbiAgICBpZDogT3BzU2NoZW1hWyAnZ2V0JyBdO1xuICAgIC8qKlxuICAgICAqIFRoZSBkYXRhIHRvIHVwZGF0ZSB0aGUgZW50aXR5IHdpdGguXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAndXBkYXRlJyBdO1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGF0dHJpYnV0ZXMgZm9yIHBhdGNoIG9wZXJhdGlvbi5cbiAgICAgKi9cbiAgICBvcGVyYXRvcnM/OiBVcGRhdGVFbnRpdHlPcGVyYXRvcnM7XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgY29uZGl0aW9ucyBmb3IgdGhlIHVwZGF0ZSBvcGVyYXRpb24uXG4gICAgICovXG4gICAgY29uZGl0aW9ucz86IGFueTsgLy8gVE9ET1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIHByZS1jYWxjdWxhdGVkIGNvbXBvc2l0ZSBrZXkgZGF0YS4gSWYgcHJvdmlkZWQsIHRoaXMgd2lsbCBiZSB1c2VkIGRpcmVjdGx5LlxuICAgICAqIElmIG5vdCBwcm92aWRlZCBhbmQgY29tcG9zaXRlIGtleXMgYXJlIG5lZWRlZCwgdGhleSB3aWxsIGJlIGNhbGN1bGF0ZWQgaW50ZXJuYWxseS5cbiAgICAgKi9cbiAgICBjb21wb3NpdGVLZXlEYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBVcGRhdGVFbnRpdHlPcGVyYXRvcnMge1xuICAgIHJlbW92ZT86IHN0cmluZ1tdO1xufVxuXG5pbnRlcmZhY2UgUHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNBcmdzPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IHtcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmc7XG4gICAgZW50aXR5U2VydmljZTogRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgIGlkZW50aWZpZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICAgIGRhdGE6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzOiBTZXQ8c3RyaW5nPjtcbiAgICBsb2dnZXI6IElMb2dnZXI7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByZXBhcmVDb21wb3NpdGVBdHRyaWJ1dGVzRm9yVXBkYXRlPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIGFyZ3M6IFByZXBhcmVDb21wb3NpdGVBdHRyaWJ1dGVzQXJnczxTPlxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gICAgY29uc3Qge1xuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICBpZGVudGlmaWVycyxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLFxuICAgICAgICBsb2dnZXIsXG4gICAgfSA9IGFyZ3M7XG5cbiAgICBjb25zdCBjb21wb3NpdGVLZXlWYWx1ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBjb25zdCBhdHRyaWJ1dGVzVG9GZXRjaCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbnN0IGRhdGFBc1JlY29yZCA9IGRhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55PjsgLy8gQ2FzdCBmb3IgZHluYW1pYyBhY2Nlc3NcblxuICAgIGlmIChyZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuc2l6ZSA9PT0gMCkge1xuICAgICAgICByZXR1cm4ge307IC8vIE5vIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzIG5lZWRlZFxuICAgIH1cblxuICAgIC8vIG9ubHkgaW5jbHVkZSB3aGF0J3Mgbm90IGFscmVhZHkgaW4gZGF0YSBvciBpZGVudGlmaWVyc1xuICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcy5mb3JFYWNoKGF0dHIgPT4ge1xuICAgICAgICBpZiAoIWRhdGFBc1JlY29yZC5oYXNPd25Qcm9wZXJ0eShhdHRyKSAmJiAhaWRlbnRpZmllcnMuaGFzT3duUHJvcGVydHkoYXR0cikpIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXNUb0ZldGNoLmFkZChhdHRyKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKGF0dHJpYnV0ZXNUb0ZldGNoLnNpemUgPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTmVlZCB0byBmZXRjaCBhdHRyaWJ1dGVzIGZvciBjb21wb3NpdGUga2V5czpgLCBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUmVjb3JkQ29udGFpbmVyID0gYXdhaXQgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KClcbiAgICAgICAgICAgICAgICAuZ2V0KGlkZW50aWZpZXJzKVxuICAgICAgICAgICAgICAgIC5nbyh7IGF0dHJpYnV0ZXM6IEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpLCBjb25zaXN0ZW50UmVhZDogdHJ1ZSB9KTtcblxuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdSZWNvcmREYXRhID0gZXhpc3RpbmdSZWNvcmRDb250YWluZXIuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBpZiAoIWV4aXN0aW5nUmVjb3JkRGF0YSkge1xuXG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYE5vIGV4aXN0aW5nIHJlY29yZCBmb3VuZCBmb3IgY29tcG9zaXRlIGtleXM6YCwgQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCkpO1xuXG4gICAgICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlc1RvRmV0Y2guZm9yRWFjaChhdHRyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0aW5nUmVjb3JkRGF0YS5oYXNPd25Qcm9wZXJ0eShhdHRyKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9zaXRlS2V5VmFsdWVzWyBhdHRyIF0gPSBleGlzdGluZ1JlY29yZERhdGFbIGF0dHIgXTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBDb21wb3NpdGUga2V5IGF0dHJpYnV0ZSBcIiR7YXR0cn1cIiAoSUQ6ICR7SlNPTi5zdHJpbmdpZnkoaWRlbnRpZmllcnMpfSkgd2FzIG5vdCBmb3VuZCBpbiBwYXlsb2FkLCBpZGVudGlmaWVycywgb3IgZXhpc3RpbmcgcmVjb3JkLmApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgRXJyb3IgZmV0Y2hpbmcgYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXMgKElEOiAke0pTT04uc3RyaW5naWZ5KGlkZW50aWZpZXJzKX0pOmAsIGVycm9yKTtcblxuICAgICAgICAgICAgLy8gVHJhY2sgZGF0YWJhc2UgZXJyb3IgbWV0cmljXG4gICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoYGVudGl0eS5jb21wb3NpdGVfa2V5LmZldGNoX2Vycm9yYCwgMSwge1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogYXJncy5lbnRpdHlOYW1lIH0sXG4gICAgICAgICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoYFByZXBhcmVkIGNvbXBvc2l0ZSBrZXkgdmFsdWVzOmAsIGNvbXBvc2l0ZUtleVZhbHVlcyk7XG4gICAgcmV0dXJuIGNvbXBvc2l0ZUtleVZhbHVlcztcbn1cblxuLyoqXG4gKiBVcGRhdGVzIGFuIGVudGl0eSBpbiB0aGUgZGF0YWJhc2UuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEBwYXJhbSB7VXBkYXRlRW50aXR5QXJnczxTPn0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciB1cGRhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMge1Byb21pc2U8RW50aXR5Pn0gLSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgdXBkYXRlZCBlbnRpdHkuXG4gKiBAdGhyb3dzIHtFcnJvcn0gLSBJZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvbiwgb3IgaWYgdmFsaWRhdGlvbiBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IFVwZGF0ZUVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBkYXRhLFxuICAgICAgICBvcGVyYXRvcnMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG4gICAgICAgIGNydWRUeXBlID0gJ3VwZGF0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwZGF0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICAgICAgY29tcG9zaXRlS2V5RGF0YSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCB7IGRhdGEsIHByb3ZpZGVkQ29tcG9zaXRlS2V5RGF0YTogY29tcG9zaXRlS2V5RGF0YSB9KTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciB1cGRhdGUgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVVcGRhdGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciB1cGRhdGU6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyAtLS0gQ29tcG9zaXRlIEtleSBIYW5kbGluZyAtLS1cbiAgICBjb25zdCBzY2hlbWEgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpO1xuICAgIGNvbnN0IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBpZiAoc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBpbmRleE5hbWUgaW4gc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4RGVmaW5pdGlvbiA9IHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChpbmRleERlZmluaXRpb24pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwa0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5waz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChwa0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHBrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBwa0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3Qgc2tDb21wb3NpdGUgPSBpbmRleERlZmluaXRpb24uc2s/LmNvbXBvc2l0ZTtcbiAgICAgICAgICAgICAgICBpZiAoc2tDb21wb3NpdGUgJiYgQXJyYXkuaXNBcnJheShza0NvbXBvc2l0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2tDb21wb3NpdGUuZm9yRWFjaChhdHRyID0+IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmFkZChhdHRyKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBpZiAoYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuc2l6ZSA+IDApIHtcbiAgICAgICAgaWYgKGNvbXBvc2l0ZUtleURhdGEgJiYgdHlwZW9mIGNvbXBvc2l0ZUtleURhdGEgPT09ICdvYmplY3QnKSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBmb3IgdXBkYXRlLmAsIGNvbXBvc2l0ZUtleURhdGEpO1xuXG4gICAgICAgICAgICBmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQiA9IGNvbXBvc2l0ZUtleURhdGE7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgY292ZXJzIGFsbCBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlc1xuICAgICAgICAgICAgY29uc3QgbWlzc2luZ0Zyb21Qcm92aWRlZCA9IEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpLmZpbHRlcihhdHRyID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAhZGF0YS5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhaWRlbnRpZmllcnMuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAgICAgIWZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCLmhhc093blByb3BlcnR5KGF0dHIpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAobWlzc2luZ0Zyb21Qcm92aWRlZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYFByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgaXMgbWlzc2luZyBzb21lIHJlcXVpcmVkIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzOiAke21pc3NpbmdGcm9tUHJvdmlkZWQuam9pbignLCAnKX0uIFVwZGF0ZSBtYXkgZmFpbCBpZiB0aGVzZSBhcmUgbmVlZGVkIGJ5IEVsZWN0cm9EQi5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICBsb2dnZXIuZGVidWcoYE5vIGNvbXBvc2l0ZUtleURhdGEgcHJvdmlkZWQsIHByZXBhcmluZyBjb21wb3NpdGUgYXR0cmlidXRlcyBpbnRlcm5hbGx5LiBSZXF1aXJlZDpgLCBBcnJheS5mcm9tKGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzKSk7XG5cbiAgICAgICAgICAgIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCID0gYXdhaXQgcHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNGb3JVcGRhdGUoe1xuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZGF0YTogZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+LFxuICAgICAgICAgICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgbG9nZ2VyLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgZGVmaW5lZCBpbiBzY2hlbWEgb3IgbmVlZGVkIGZvciB0aGlzIHVwZGF0ZS5gKTtcbiAgICB9XG4gICAgLy8gLS0tIEVuZCBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuXG5cblxuICAgIC8vIFVzZSBFbGVjdHJvREIgZm9yIGFsbCBmaWVsZHMgaW5jbHVkaW5nIF9hY3RvciAobm93IGluIHNjaGVtYSlcbiAgICBjb25zdCBxdWVyeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLnBhdGNoKGlkZW50aWZpZXJzKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBjb21wb3NpdGUgdmFsdWVzIGZvciBFbGVjdHJvREIgcGF0Y2g6YCwgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgICAgICBxdWVyeS5jb21wb3NpdGUoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRvcnM/LnJlbW92ZSkge1xuICAgICAgICBxdWVyeS5yZW1vdmUob3BlcmF0b3JzLnJlbW92ZSBhcyBhbnkpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3VwZGF0ZScsICgpID0+XG4gICAgICAgIHF1ZXJ5LmdvKClcbiAgICApO1xuXG4gICAgLy8gLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclVwZGF0ZScsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5O1xufVxuXG4vKipcbiAqIHRoZSBhcmd1bWVudHMgZm9yIGRlbGV0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2RlbGV0ZScgXTtcbn1cblxuLyoqXG4gKiBEZWxldGVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgZGVsZXRlZCBlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogRGVsZXRlRW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBpZCxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2RlbGV0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmRlbGV0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlRGVsZXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGRlbGV0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2RlbGV0ZScsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVycykuZ28oKVxuICAgICk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYWZ0ZXJEZWxldGUnLCBjb250ZXh0OiBhcmd1bWVudHN9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBkZWxldGVFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWQ6YCwgaWQpO1xuXG4gICAgcmV0dXJuIGVudGl0eTtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGJhdGNoIGRlbGV0aW5nIGVudGl0aWVzLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZUJhdGNoRW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBlbnRpdHkgSURzIHRvIGRlbGV0ZS5cbiAgICAgKi9cbiAgICBpZHM6IEFycmF5PE9wc1NjaGVtYVsgJ2RlbGV0ZScgXT47XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyAoZGVmYXVsdDogMSkuXG4gICAgICovXG4gICAgY29uY3VycmVudD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBEZWxldGVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgZGVsZXRpbmcgdGhlIGVudGl0aWVzLlxuICogQHJldHVybnMgVGhlIHVucHJvY2Vzc2VkIGl0ZW1zIHRoYXQgY291bGRuJ3QgYmUgZGVsZXRlZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUJhdGNoRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IERlbGV0ZUJhdGNoRW50aXR5QXJnczxTPikge1xuICAgIGNvbnN0IHtcbiAgICAgICAgaWRzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICBjb25jdXJyZW50ID0gMSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2RlbGV0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmRlbGV0ZUJhdGNoRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkcywgY29uY3VycmVudCB9KTtcblxuICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZm9yIGFsbCBpdGVtcyBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaWRzLm1hcChpZCA9PiBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCkpO1xuXG4gICAgLy8gVmFsaWRhdGUgZWFjaCBpdGVtIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IHZhbGlkYXRpb25zID0gYXdhaXQgUHJvbWlzZS5hbGwoaWRlbnRpZmllcnNCYXRjaC5tYXAoYXN5bmMgaWRlbnRpZmllcnMgPT5cbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgICAgIGlucHV0OiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGFjdG9yOiBhY3RvclxuICAgICAgICB9KVxuICAgICkpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHZhbGlkYXRpb24gZXJyb3JzXG4gICAgY29uc3QgdmFsaWRhdGlvbkVycm9ycyA9IHZhbGlkYXRpb25zXG4gICAgICAgIC5tYXAoKHZhbGlkYXRpb24sIGluZGV4KSA9PiAoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSlcbiAgICAgICAgLmZpbHRlcigoeyB2YWxpZGF0aW9uIH0pID0+ICF2YWxpZGF0aW9uLnBhc3MpO1xuXG4gICAgaWYgKHZhbGlkYXRpb25FcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb25FcnJvcnMuZmxhdE1hcCgoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSA9PlxuICAgICAgICAgICAgKHZhbGlkYXRpb24uZXJyb3JzIHx8IFtdKS5tYXAoZXJyb3IgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5lcnJvcixcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBgSXRlbSAke2luZGV4fTogJHtlcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgIH0pKVxuICAgICAgICApKTtcbiAgICB9XG5cbiAgICAvLyBQZXJmb3JtIGJhdGNoIGRlbGV0ZSBvcGVyYXRpb24gd2l0aCBjb25jdXJyZW5jeSBjb250cm9sXG4gICAgLy8gUGVyIEVsZWN0cm9EQiBkb2NzOiBodHRwOi8vZWxlY3Ryb2RiLmRldi9lbi9tdXRhdGlvbnMvYmF0Y2gtZGVsZXRlL1xuICAgIC8vIE5vdGU6IEVsZWN0cm9EQiB0eXBlcyB1c2UgJ2NvbmN1cnJlbmN5JyB3aGlsZSBkb2NzIHNob3cgJ2NvbmN1cnJlbnQnXG4gICAgY29uc3QgYnVsa09wdGlvbnM6IFBhcnRpYWw8QnVsa09wdGlvbnM+ID0ge1xuICAgICAgICBjb25jdXJyZW5jeTogY29uY3VycmVudFxuICAgIH07XG5cbiAgICBjb25zdCBlbGVjdHJvUmVzdWx0ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnYmF0Y2hEZWxldGUnLCAoKSA9PlxuICAgICAgICBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS5kZWxldGUoaWRlbnRpZmllcnNCYXRjaCkuZ28oYnVsa09wdGlvbnMpLFxuICAgICAgICB7IGl0ZW1Db3VudDogaWRlbnRpZmllcnNCYXRjaC5sZW5ndGggfVxuICAgICk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZGVsZXRlQmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWRzOmAsIGlkcyk7XG5cbiAgICByZXR1cm4gZWxlY3Ryb1Jlc3VsdDtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGZpbHRlciBvYmplY3Qgd2l0aCBlcSBvcGVyYXRvcnMgdG8gYSBzaW1wbGlmaWVkIGZvcm0uXG4gKiBFeGFtcGxlOiB7IGFnZTogeyBlcTogNjUgfSB9IGJlY29tZXMgeyBhZ2U6IDY1IH1cbiAqIEBwYXJhbSBmaWx0ZXJzIC0gVGhlIGZpbHRlciBvYmplY3QgdG8gc2ltcGxpZnlcbiAqIEByZXR1cm5zIEEgbmV3IGZpbHRlciBvYmplY3Qgd2l0aCBlcSBvcGVyYXRvcnMgY29udmVydGVkIHRvIGRpcmVjdCB2YWx1ZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbXBsaWZ5RmlsdGVycyhmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkKTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgaWYgKCFmaWx0ZXJzKSByZXR1cm4ge307XG5cbiAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGZpbHRlcnMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICdlcScgaW4gdmFsdWUpIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZS5lcTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBleHBvcnQgY2xhc3MgRW50aXR5Q3J1ZFNlcnZpY2U8UyBleHRlbmRzIFNjaGVtYTxhbnksIGFueSwgYW55Pj57XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgbGlzdChvcHRpb25zOiBMaXN0RW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgbGlzdEVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgY3JlYXRlKG9wdGlvbnM6IENyZWF0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgdXBkYXRlKG9wdGlvbnM6IFVwZGF0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IHVwZGF0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldEVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGdldEVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgZGVsZXRlKG9wdGlvbnM6IERlbGV0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGRlbGV0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG4vLyB9XG5cblxuLy8gZXhwb3J0IGNvbnN0IERlZmF1bHRFbnRpdHlDcnVkU2VydmljZSA9IG5ldyBFbnRpdHlDcnVkU2VydmljZSgpOyJdfQ==