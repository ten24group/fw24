"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidIndexFilterError = void 0;
exports.getEntity = getEntity;
exports.getBatchEntity = getBatchEntity;
exports.createEntity = createEntity;
exports.upsertEntity = upsertEntity;
exports.filterGroupToSimpleFormat = filterGroupToSimpleFormat;
exports.extractIndexFilterValues = extractIndexFilterValues;
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
 * Error thrown when invalid filter operators are used in index.filters.
 */
class InvalidIndexFilterError extends Error {
    attributeName;
    invalidOperators;
    indexName;
    constructor(attributeName, invalidOperators, indexName) {
        const indexContext = indexName ? ` for index "${indexName}"` : '';
        super(`Invalid filter operator(s) [${invalidOperators.join(', ')}] for attribute "${attributeName}"${indexContext}. ` +
            `GSI composite key attributes only support equality matches. ` +
            `Use { ${attributeName}: { eq: value } } or { ${attributeName}: value } for composite keys. ` +
            `For range/other conditions, use top-level 'filters' instead of 'index.filters'.`);
        this.attributeName = attributeName;
        this.invalidOperators = invalidOperators;
        this.indexName = indexName;
        this.name = 'InvalidIndexFilterError';
    }
}
exports.InvalidIndexFilterError = InvalidIndexFilterError;
/**
 * Extracts and validates composite key values from index.filters for ElectroDB access pattern queries.
 *
 * DynamoDB GSI composite keys have specific constraints:
 * - Partition Key (PK): MUST be an equality match
 * - Sort Key (SK): Can use range operators, but those go in top-level `filters`
 *
 * This function:
 * 1. Validates that only equality operators are used
 * 2. Converts FW24 filter syntax to ElectroDB format
 * 3. THROWS if invalid operators are detected (fail fast, not silently)
 *
 * @param filters - Filters from index.filters (only equality allowed)
 * @param indexName - Name of the index (for error messages)
 * @returns Composite key values in ElectroDB format
 * @throws InvalidIndexFilterError if non-equality operators are used
 *
 * @example
 * // Valid inputs
 * { teamId: { eq: 'team-123' } }  →  { teamId: 'team-123' }
 * { teamId: 'team-123' }         →  { teamId: 'team-123' }
 *
 * // Invalid - will THROW
 * { createdAt: { gt: '2024-01-01' } }  // InvalidIndexFilterError
 */
function extractIndexFilterValues(filters, indexName) {
    if (!filters)
        return {};
    const result = {};
    for (const [key, value] of Object.entries(filters)) {
        if (value === null || value === undefined) {
            continue;
        }
        // Direct value (shorthand for equality)
        if (typeof value !== 'object') {
            result[key] = value;
            continue;
        }
        // Handle filter operator objects
        const operators = Object.keys(value);
        if (operators.length === 0) {
            continue;
        }
        // Only 'eq' is valid for composite key attributes
        if (value.eq !== undefined) {
            // Check for mixed operators (eq + others) - that's a mistake
            const otherOps = operators.filter(op => op !== 'eq');
            if (otherOps.length > 0) {
                throw new InvalidIndexFilterError(key, otherOps, indexName);
            }
            result[key] = value.eq;
        }
        else {
            // Non-equality operators - throw immediately
            throw new InvalidIndexFilterError(key, operators, indexName);
        }
    }
    return result;
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
        ? { indexName: specifiedIndex.name, indexFilters: extractIndexFilterValues(specifiedIndex.filters, specifiedIndex.name) }
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
        ? { indexName: specifiedIndex.name, indexFilters: extractIndexFilterValues(specifiedIndex.filters, specifiedIndex.name) }
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
                        // Attribute not found - just log debug, don't warn (could be optional sparse index attribute)
                        logger.debug(`Composite key attribute "${attr}" (ID: ${JSON.stringify(identifiers)}) not found in existing record (may be optional).`);
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
 * @returns {Promise<UpdateEntityResponse<S>>} - A promise that resolves to the updated entity.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBbUZBLDhCQXVEQztBQThCRCx3Q0FnRUM7QUE0QkQsb0NBeURDO0FBK0JELG9DQW9FQztBQWlDRCw4REEwQkM7QUErQ0QsNERBeUNDO0FBVUQsOENBNkVDO0FBUUQsZ0NBOEZDO0FBV0Qsa0NBOEZDO0FBcUlELG9DQXdJQztBQStCRCxvQ0FxREM7QUEwQkQsOENBK0RDO0FBUUQsMENBWUM7QUF0eUNELDRDQUEwQztBQUMxQyxvQ0FBMkM7QUFDM0Msd0NBQW1EO0FBQ25ELG9DQUFzRDtBQUN0RCw4Q0FBa0U7QUFFbEUsZ0VBQWtFO0FBRWxFLG1DQUEyRDtBQUUzRCwwREFBeUY7QUFtRXpGOzs7O0dBSUc7QUFDSSxLQUFLLFVBQVUsU0FBUyxDQUF3QyxPQUF5QjtJQUU1RixNQUFNLEVBQ0YsRUFBRSxFQUNGLFVBQVUsRUFDVixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLEtBQUssRUFDaEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyx3QkFBd0IsQ0FBQyxFQUMvQyxTQUFTLEdBQUcsNkJBQWdCLEVBQzVCLFVBQVUsR0FBRyxzQkFBVSxDQUFDLE9BQU8sRUFDL0IsZUFBZSxHQUFHLHVCQUFlLENBQUMsT0FBTyxHQUU1QyxHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sQ0FBQyxLQUFLLENBQUMsK0NBQStDLFVBQVUsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFL0YsNkVBQTZFO0lBRTdFLE1BQU0sV0FBVyxHQUFHLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUUvRCxzQkFBc0I7SUFDdEIsd0dBQXdHO0lBQ3hHLDJCQUEyQjtJQUMzQixvRkFBb0Y7SUFDcEYs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LENBQUM7UUFDMUIsQ0FBQztJQUNMLENBQUM7SUFDRCxPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQsbUVBQW1FO0FBRW5FLHNEQUFzRDtBQUN0RCw0Q0FBNEM7QUFDNUMsUUFBUTtBQUVSLDBEQUEwRDtBQUMxRCw4Q0FBOEM7QUFDOUMsUUFBUTtBQUVSLDBEQUEwRDtBQUMxRCw4Q0FBOEM7QUFDOUMsUUFBUTtBQUVSLG9EQUFvRDtBQUNwRCwyQ0FBMkM7QUFDM0MsUUFBUTtBQUVSLDBEQUEwRDtBQUMxRCw4Q0FBOEM7QUFDOUMsUUFBUTtBQUNSLElBQUk7QUFHSixtRUFBbUUiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEJ1bGtPcHRpb25zIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHsgQXV0aG9yaXplciB9IGZyb20gXCIuLi9hdXRob3JpemVcIjtcbmltcG9ydCB7IEV2ZW50RGlzcGF0Y2hlciB9IGZyb20gXCIuLi9ldmVudFwiO1xuaW1wb3J0IHsgSUxvZ2dlciwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IGlzRW1wdHlPYmplY3QsIHJlbW92ZUVtcHR5IH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCB0eXBlIElWYWxpZGF0b3IgfSBmcm9tIFwiLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYSwgRW50aXR5U2NoZW1hLCBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWEsIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgVEVudGl0eU9wc0lucHV0U2NoZW1hcyB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgeyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IgfSBmcm9tIFwiLi9lcnJvcnMvdmFsaWRhdGlvbi1lcnJvclwiO1xuaW1wb3J0IHsgQWN0b3IgfSBmcm9tIFwiLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHsgZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24gfSBmcm9tIFwiLi9xdWVyeVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlRdWVyeSB9IGZyb20gXCIuL3F1ZXJ5LXR5cGVzXCI7XG5pbXBvcnQgeyBNZXRyaWNPYnNlcnZlciwgU3Bhbk9ic2VydmVyLCBRdWVyeU9ic2VydmVyIH0gZnJvbSBcIi4uL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzXCI7XG5cbi8qKlxuICogXG4gKiBTZXJpYWxpemVyL2Zvcm1hdHRlclxuICogIC0gaHR0cHM6Ly9naXRodWIuY29tL2Rremx2L21pY3JvLXRyYW5zZm9ybVxuICogIFxuICogRXZlbnQgZGlzcGF0Y2hlclxuICogLSBodHRwczovL2dpdGh1Yi5jb20vRm94QW5kRmx5L3RzLWV2ZW50LWRpc3BhdGNoZXIvYmxvYi9tYXN0ZXIvc3JjL2luZGV4LnRzXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9yeWFyZGxleS90cy1idXNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL2Jpbmllci90aW55LXR5cGVkLWVtaXR0ZXIvdHJlZS9tYXN0ZXJcbiAqIFxuICogUm91dGVyXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9iZXJzdGVuZC90aW55LXJlcXVlc3Qtcm91dGVyL2Jsb2IvbWFzdGVyL3NyYy9yb3V0ZXIudHNcbiAqIFxuICogRElcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL25pY29qcy90eXBlZC1pbmplY3RcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL21pY3Jvc29mdC90c3lyaW5nZVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vb3dqYS9pb2NcbiAqIFxuICogXG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBCYXNlRW50aXR5Q3J1ZEFyZ3M8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICBlbnRpdHlTZXJ2aWNlOiBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8Uz47XG5cbiAgICBjcnVkVHlwZT86IGtleW9mIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucztcbiAgICBhY3Rvcj86IEFjdG9yOyAvLyBBY3RvciBjb250ZXh0OiBjb21wcmVoZW5zaXZlIGFjdG9yIGluZm9ybWF0aW9uIGluY2x1ZGluZyBhdXRoZW50aWNhdGlvbiBkZXRhaWxzXG4gICAgdGVuYW50PzogYW55OyAvLyB0b2RvOiBkZWZpbmUgdGVuYW50IGNvbnRleHRcblxuICAgIGxvZ2dlcj86IElMb2dnZXI7XG4gICAgdmFsaWRhdG9yPzogSVZhbGlkYXRvcjtcbiAgICBhdXRob3JpemVyPzogQXV0aG9yaXplci5JQXV0aG9yaXplcjsgICAgICAgIC8vIHRvZG86IGRlZmluZSBhdXRob3JpemVyIHNpZ25hdHVyZVxuICAgIGV2ZW50RGlzcGF0Y2hlcj86IEV2ZW50RGlzcGF0Y2hlci5JRXZlbnREaXNwYXRjaGVyOyAgLy8gdG9kbyBkZWZpbmUgZXZlbnQgZGlzcGF0Y2hlciBzaWduYXR1cmVcblxuICAgIC8vIHRlbGVtZXRyeVxufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgcmV0cmlldmluZyBhbiBlbnRpdHkuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0RW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBUaGUgSUQgb2YgdGhlIGVudGl0eSB0byByZXRyaWV2ZS5cbiAgICAgKi9cbiAgICBpZDogT3BzU2NoZW1hWyAnZ2V0JyBdO1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmV0cmlldmVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBhdHRyaWJ1dGVzPzogQXJyYXk8c3RyaW5nPjtcbn1cblxuLyoqXG4gKiBSZXNwb25zZSB0eXBlIGZvciBnZXQgZW50aXR5IG9wZXJhdGlvbi5cbiAqIFByb3ZpZGVzIGEgdHlwZWQgd3JhcHBlciBmb3IgdGhlIGVsZWN0cm9kYiBnZXQgcmVzcG9uc2UuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqL1xuZXhwb3J0IHR5cGUgR2V0RW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciByZXRyaWV2aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxHZXRFbnRpdHlSZXNwb25zZTxTPj4ge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBpZCxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2dldCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmdldEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGdldEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZCwgYXR0cmlidXRlcyB9KTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVHZXQnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICBjb25zdCBpZGVudGlmaWVycyA9IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKTtcblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3JcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoe2VudGl0eU5hbWUsIGNydWRUeXBlLCBpZGVudGlmaWVycywgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgZ2V0OiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG5cbiAgICAvLyAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBpZGVudGlmaWVycyxcbiAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdnZXQnLCAoKSA9PlxuICAgICAgICBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS5nZXQoaWRlbnRpZmllcnMpLmdvKHsgYXR0cmlidXRlcyB9KVxuICAgICk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYWZ0ZXJHZXQnLCBjb250ZXh0OiBhcmd1bWVudHN9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBnZXRFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWQ6YCwgaWQpO1xuXG4gICAgcmV0dXJuIGVudGl0eSBhcyBHZXRFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIHJldHJpZXZpbmcgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaC5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRCYXRjaEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgZW50aXR5IElEcyB0byByZXRyaWV2ZS5cbiAgICAgKi9cbiAgICBpZHM6IEFycmF5PE9wc1NjaGVtYVsgJ2dldCcgXT47XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byBpbmNsdWRlIGluIHRoZSByZXRyaWV2ZWQgZW50aXRpZXMuXG4gICAgICovXG4gICAgYXR0cmlidXRlcz86IEFycmF5PHN0cmluZz47XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyAoZGVmYXVsdDogMSkuXG4gICAgICovXG4gICAgY29uY3VycmVudD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZXMgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciByZXRyaWV2aW5nIHRoZSBlbnRpdGllcy5cbiAqIEByZXR1cm5zIFRoZSByZXRyaWV2ZWQgZW50aXRpZXMgYW5kIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEJhdGNoRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IEdldEJhdGNoRW50aXR5QXJnczxTPikge1xuICAgIGNvbnN0IHtcbiAgICAgICAgaWRzLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICBjb25jdXJyZW50ID0gMSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2dldCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmdldEJhdGNoRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGdldEJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkcywgYXR0cmlidXRlcyB9KTtcblxuICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZm9yIGFsbCBpdGVtcyBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaWRzLm1hcChpZCA9PiBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCkpO1xuXG4gICAgLy8gVmFsaWRhdGUgZWFjaCBpdGVtIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IHZhbGlkYXRpb25zID0gYXdhaXQgUHJvbWlzZS5hbGwoaWRlbnRpZmllcnNCYXRjaC5tYXAoYXN5bmMgaWRlbnRpZmllcnMgPT5cbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgICAgIGlucHV0OiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGFjdG9yOiBhY3RvclxuICAgICAgICB9KVxuICAgICkpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHZhbGlkYXRpb24gZXJyb3JzXG4gICAgY29uc3QgdmFsaWRhdGlvbkVycm9ycyA9IHZhbGlkYXRpb25zXG4gICAgICAgIC5tYXAoKHZhbGlkYXRpb24sIGluZGV4KSA9PiAoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSlcbiAgICAgICAgLmZpbHRlcigoeyB2YWxpZGF0aW9uIH0pID0+ICF2YWxpZGF0aW9uLnBhc3MpO1xuXG4gICAgaWYgKHZhbGlkYXRpb25FcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb25FcnJvcnMuZmxhdE1hcCgoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSA9PlxuICAgICAgICAgICAgKHZhbGlkYXRpb24uZXJyb3JzIHx8IFtdKS5tYXAoZXJyb3IgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5lcnJvcixcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBgSXRlbSAke2luZGV4fTogJHtlcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgIH0pKVxuICAgICAgICApKTtcbiAgICB9XG5cbiAgICAvLyBQZXJmb3JtIGJhdGNoIGdldCBvcGVyYXRpb24gd2l0aCBjb25jdXJyZW5jeSBjb250cm9sXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnYmF0Y2hHZXQnLCAoKSA9PlxuICAgICAgICBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS5nZXQoaWRlbnRpZmllcnNCYXRjaCkuZ28oe1xuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgfSksXG4gICAgICAgIHsgaXRlbUNvdW50OiBpZGVudGlmaWVyc0JhdGNoLmxlbmd0aCB9XG4gICAgKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZHM6YCwgaWRzKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGRhdGE6IEFycmF5LmlzQXJyYXkocmVzdWx0LmRhdGEpID8gcmVzdWx0LmRhdGEgOiAocmVzdWx0LmRhdGEgPyBbIHJlc3VsdC5kYXRhIF0gOiBbXSksXG4gICAgICAgIHVucHJvY2Vzc2VkOiBbXSAgLy8gRWxlY3Ryb0RCIGRvZXNuJ3Qgc3VwcG9ydCB1bnByb2Nlc3NlZCBpdGVtcyB0cmFja2luZywgc28gd2UgcmV0dXJuIGVtcHR5IGFycmF5XG4gICAgfTtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGNyZWF0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDcmVhdGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBkYXRhIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqL1xuICAgIGRhdGE6IE9wc1NjaGVtYVsgJ2NyZWF0ZScgXTtcbn1cblxuZXhwb3J0IHR5cGUgQ3JlYXRlRW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gZW50aXR5IHVzaW5nIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMgVGhlIGNyZWF0ZWQgZW50aXR5LlxuICogQHRocm93cyBFcnJvciBpZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciBjcmVhdGUgb3BlcmF0aW9uLCB2YWxpZGF0aW9uIGZhaWxzLCBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IENyZWF0ZUVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPENyZWF0ZUVudGl0eVJlc3BvbnNlPFM+PiB7XG4gICAgY29uc3Qge1xuICAgICAgICBkYXRhLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnY3JlYXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Y3JlYXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gY3JlYXRlIH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSk7XG5cbiAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YSBwcm92aWRlZCBmb3IgY3JlYXRlIG9wZXJhdGlvblwiKTtcbiAgICB9XG5cbiAgICAvLyBwcmUgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYmVmb3JlQ3JlYXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogZGF0YSxcbiAgICAgICAgYWN0b3I6IGFjdG9yLFxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGNyZWF0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2NyZWF0ZScsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmNyZWF0ZShkYXRhKS5nbygpXG4gICAgKTtcblxuICAgIC8vIHBvc3QgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJDcmVhdGUnLCBjb250ZXh0OiB7Li4uYXJndW1lbnRzLCBlbnRpdHl9IH0pO1xuXG4gICAgLy8gcmV0dXJuIGVudGl0eTtcbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gY3JlYXRlIH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSwgZW50aXR5LmRhdGEpO1xuXG4gICAgcmV0dXJuIGVudGl0eSBhcyBDcmVhdGVFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwc2VydEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAndXBzZXJ0JyBdO1xufVxuXG5leHBvcnQgdHlwZSBVcHNlcnRFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG4gICAgd2FzQ3JlYXRlZD86IGJvb2xlYW4gIC8vIHRydWUgaWYgcmVjb3JkIHdhcyBjcmVhdGVkLCBmYWxzZSBpZiBhbHJlYWR5IGV4aXN0ZWRcbiAgICBvbGREYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPiAgLy8gcHJldmlvdXMgZGF0YSBpZiBpdCB3YXMgYW4gdXBkYXRlICh1bmRlZmluZWQgZm9yIGNyZWF0ZXMpXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgdXNpbmcgdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nLU9SLXVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkgd2l0aCB3YXNDcmVhdGVkIGZsYWcgaW5kaWNhdGluZyBpZiBpdCB3YXMgYSBuZXcgcmVjb3JkLlxuICogQHRocm93cyBFcnJvciBpZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciB1cHNlcnQgb3BlcmF0aW9uLCB2YWxpZGF0aW9uIGZhaWxzLCBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBzZXJ0RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IFVwc2VydEVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPFVwc2VydEVudGl0eVJlc3BvbnNlPFM+PiB7XG4gICAgY29uc3Qge1xuICAgICAgICBkYXRhLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAndXBzZXJ0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6dXBzZXJ0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSk7XG5cbiAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YSBwcm92aWRlZCBmb3IgdXBzZXJ0IG9wZXJhdGlvblwiKTtcbiAgICB9XG5cbiAgICAvLyBwcmUgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYmVmb3JlVXBzZXJ0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogZGF0YSxcbiAgICAgICAgYWN0b3I6IGFjdG9yLFxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIHVwc2VydDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIFVzZSBcImFsbF9vbGRcIiB0byBnZXQgdGhlIHByZXZpb3VzIGl0ZW0gc3RhdGUgLSBhbGxvd3MgdXMgdG8gZGV0ZWN0IGNyZWF0ZSB2cyB1cGRhdGVcbiAgICAvLyBJZiBvbGREYXRhIGlzIGVtcHR5L251bGwsIGl0IHdhcyBhIENSRUFURS4gSWYgaXQgaGFzIGRhdGEsIGl0IHdhcyBhbiBVUERBVEUuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAndXBzZXJ0JywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkudXBzZXJ0KGRhdGEgYXMgYW55KS5nbyh7IHJlc3BvbnNlOiBcImFsbF9vbGRcIiB9KVxuICAgICk7XG5cbiAgICBjb25zdCB3YXNDcmVhdGVkID0gIWVudGl0eS5kYXRhIHx8IE9iamVjdC5rZXlzKGVudGl0eS5kYXRhKS5sZW5ndGggPT09IDA7XG4gICAgY29uc3Qgb2xkRGF0YSA9IHdhc0NyZWF0ZWQgPyB1bmRlZmluZWQgOiBlbnRpdHkuZGF0YTtcblxuICAgIC8vIHBvc3QgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJVcHNlcnQnLCBjb250ZXh0OiB7Li4uYXJndW1lbnRzLCBlbnRpdHl9IH0pO1xuXG4gICAgLy8gcmV0dXJuIGVudGl0eTtcbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IHdhc0NyZWF0ZWQ6ICR7d2FzQ3JlYXRlZH1gKTtcblxuICAgIC8vIE5vdGU6IHdpdGggXCJhbGxfb2xkXCIsIGVudGl0eS5kYXRhIGNvbnRhaW5zIHRoZSBPTEQgZGF0YSwgd2UgbmVlZCB0byByZXR1cm4gdGhlIE5FVyBkYXRhXG4gICAgLy8gU2luY2Ugd2UgZG9uJ3QgaGF2ZSB0aGUgbmV3IGRhdGEgZnJvbSBEeW5hbW9EQiwgd2UgcmV0dXJuIHRoZSBpbnB1dCBkYXRhIGFzIHRoZSBuZXcgZGF0YVxuICAgIHJldHVybiB7XG4gICAgICAgIGRhdGE6IGRhdGEgYXMgYW55LCAgLy8gVGhlIG5ldyBkYXRhIHdlIGp1c3QgdXBzZXJ0ZWRcbiAgICAgICAgd2FzQ3JlYXRlZCxcbiAgICAgICAgb2xkRGF0YVxuICAgIH0gYXMgVXBzZXJ0RW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBsaXN0aW5nIGVudGl0aWVzLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGlzdEVudGl0eUFyZ3M8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICBxdWVyeTogRW50aXR5UXVlcnk8U2NoPlxufVxuXG4vKipcbiAqIE9wZXJhdG9ycyB0aGF0IHNob3VsZCBOT1QgYmUgdXNlZCBmb3IgaW5kZXggbWF0Y2hpbmcuXG4gKiBUaGVzZSBvcGVyYXRvcnMgbG9vayBmb3IgcmVjb3JkcyB3aGVyZSB0aGUgYXR0cmlidXRlIGRvZXNuJ3QgZXhpc3Qgb3IgaXMgZW1wdHksXG4gKiBidXQgdGhvc2UgcmVjb3JkcyB3b24ndCBiZSBpbiBhIHNwYXJzZSBHU0kgd2hlcmUgdGhhdCBhdHRyaWJ1dGUgaXMgdGhlIFBLLlxuICovXG5jb25zdCBJTkRFWF9FWENMVURFRF9PUEVSQVRPUlMgPSBuZXcgU2V0KFtcbiAgICAnbm90RXhpc3RzJywgJ2V4aXN0cycsICdpc051bGwnLCAnbm90TnVsbCcsICdlbXB0eScsICdub3RFbXB0eSdcbl0pO1xuXG4vKipcbiAqIENvbnZlcnQgRmlsdGVyR3JvdXAgZm9ybWF0IHRvIHNpbXBsZSBvYmplY3QgZm9ybWF0IGZvciBpbmRleCBtYXRjaGluZy5cbiAqIEZpbHRlckdyb3VwOiB7IGFuZDogW3sgYXR0cmlidXRlOiAnZm9vJywgZXE6ICdiYXInIH1dIH1cbiAqIFNpbXBsZTogeyBmb286IHsgZXE6ICdiYXInIH0gfVxuICogXG4gKiBPbmx5IGV4dHJhY3RzIGZpbHRlcnMgZnJvbSB0aGUgJ2FuZCcgYXJyYXkgYXMgdGhvc2UgYXJlIHRoZSBvbmVzXG4gKiB0aGF0IGNhbiBiZSB1c2VkIGZvciBHU0kgcGFydGl0aW9uIGtleSBtYXRjaGluZy5cbiAqIFxuICogRXhjbHVkZXMgZXhpc3RlbmNlL251bGwgZmlsdGVycyAobm90RXhpc3RzLCBpc051bGwsIGVtcHR5LCBldGMuKSBmcm9tIGluZGV4XG4gKiBtYXRjaGluZyBzaW5jZSByZWNvcmRzIHdpdGggbWlzc2luZyBhdHRyaWJ1dGVzIHdvbid0IGJlIGluIHNwYXJzZSBHU0lzLlxuICogXG4gKiBAcGFyYW0gZmlsdGVycyAtIFRoZSBmaWx0ZXJzIGluIEZpbHRlckdyb3VwIG9yIHNpbXBsZSBmb3JtYXRcbiAqIEByZXR1cm5zIEZpbHRlcnMgaW4gc2ltcGxlIG9iamVjdCBmb3JtYXQgeyBhdHRyOiB7IG9wOiB2YWwgfSB9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4pOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICAvLyBBbHJlYWR5IGluIHNpbXBsZSBmb3JtYXQgb3IgZW1wdHlcbiAgICBpZiAoIWZpbHRlcnMgfHwgISgnYW5kJyBpbiBmaWx0ZXJzKSkge1xuICAgICAgICByZXR1cm4gZmlsdGVycyB8fCB7fTtcbiAgICB9XG5cbiAgICBjb25zdCBzaW1wbGU6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIC8vIEV4dHJhY3QgZnJvbSAnYW5kJyBhcnJheSAtIHRoZXNlIGFyZSBBTkQgY29uZGl0aW9ucyB0aGF0IGNvdWxkIG1hdGNoIEdTSSBQS1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBmaWx0ZXJzLmFuZCB8fCBbXSkge1xuICAgICAgICBpZiAoaXRlbS5hdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdG9yczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhpdGVtKSkge1xuICAgICAgICAgICAgICAgIC8vIFNraXAgdGhlICdhdHRyaWJ1dGUnIGtleSBhbmQgZXhjbHVkZSBleGlzdGVuY2UvbnVsbCBvcGVyYXRvcnMgZnJvbSBpbmRleCBtYXRjaGluZ1xuICAgICAgICAgICAgICAgIC8vIFJlY29yZHMgd2l0aCBtaXNzaW5nIGF0dHJpYnV0ZXMgd29uJ3QgYmUgaW4gc3BhcnNlIEdTSXNcbiAgICAgICAgICAgICAgICBpZiAoa2V5ICE9PSAnYXR0cmlidXRlJyAmJiAhSU5ERVhfRVhDTFVERURfT1BFUkFUT1JTLmhhcyhrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIG9wZXJhdG9yc1sga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMob3BlcmF0b3JzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc2ltcGxlWyBpdGVtLmF0dHJpYnV0ZSBdID0gb3BlcmF0b3JzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNpbXBsZTtcbn1cblxuLyoqXG4gKiBFcnJvciB0aHJvd24gd2hlbiBpbnZhbGlkIGZpbHRlciBvcGVyYXRvcnMgYXJlIHVzZWQgaW4gaW5kZXguZmlsdGVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIEludmFsaWRJbmRleEZpbHRlckVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgYXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgaW52YWxpZE9wZXJhdG9yczogc3RyaW5nW10sXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBpbmRleE5hbWU/OiBzdHJpbmdcbiAgICApIHtcbiAgICAgICAgY29uc3QgaW5kZXhDb250ZXh0ID0gaW5kZXhOYW1lID8gYCBmb3IgaW5kZXggXCIke2luZGV4TmFtZX1cImAgOiAnJztcbiAgICAgICAgc3VwZXIoXG4gICAgICAgICAgICBgSW52YWxpZCBmaWx0ZXIgb3BlcmF0b3IocykgWyR7aW52YWxpZE9wZXJhdG9ycy5qb2luKCcsICcpfV0gZm9yIGF0dHJpYnV0ZSBcIiR7YXR0cmlidXRlTmFtZX1cIiR7aW5kZXhDb250ZXh0fS4gYCArXG4gICAgICAgICAgICBgR1NJIGNvbXBvc2l0ZSBrZXkgYXR0cmlidXRlcyBvbmx5IHN1cHBvcnQgZXF1YWxpdHkgbWF0Y2hlcy4gYCArXG4gICAgICAgICAgICBgVXNlIHsgJHthdHRyaWJ1dGVOYW1lfTogeyBlcTogdmFsdWUgfSB9IG9yIHsgJHthdHRyaWJ1dGVOYW1lfTogdmFsdWUgfSBmb3IgY29tcG9zaXRlIGtleXMuIGAgK1xuICAgICAgICAgICAgYEZvciByYW5nZS9vdGhlciBjb25kaXRpb25zLCB1c2UgdG9wLWxldmVsICdmaWx0ZXJzJyBpbnN0ZWFkIG9mICdpbmRleC5maWx0ZXJzJy5gXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcic7XG4gICAgfVxufVxuXG4vKipcbiAqIEV4dHJhY3RzIGFuZCB2YWxpZGF0ZXMgY29tcG9zaXRlIGtleSB2YWx1ZXMgZnJvbSBpbmRleC5maWx0ZXJzIGZvciBFbGVjdHJvREIgYWNjZXNzIHBhdHRlcm4gcXVlcmllcy5cbiAqIFxuICogRHluYW1vREIgR1NJIGNvbXBvc2l0ZSBrZXlzIGhhdmUgc3BlY2lmaWMgY29uc3RyYWludHM6XG4gKiAtIFBhcnRpdGlvbiBLZXkgKFBLKTogTVVTVCBiZSBhbiBlcXVhbGl0eSBtYXRjaFxuICogLSBTb3J0IEtleSAoU0spOiBDYW4gdXNlIHJhbmdlIG9wZXJhdG9ycywgYnV0IHRob3NlIGdvIGluIHRvcC1sZXZlbCBgZmlsdGVyc2BcbiAqIFxuICogVGhpcyBmdW5jdGlvbjpcbiAqIDEuIFZhbGlkYXRlcyB0aGF0IG9ubHkgZXF1YWxpdHkgb3BlcmF0b3JzIGFyZSB1c2VkXG4gKiAyLiBDb252ZXJ0cyBGVzI0IGZpbHRlciBzeW50YXggdG8gRWxlY3Ryb0RCIGZvcm1hdFxuICogMy4gVEhST1dTIGlmIGludmFsaWQgb3BlcmF0b3JzIGFyZSBkZXRlY3RlZCAoZmFpbCBmYXN0LCBub3Qgc2lsZW50bHkpXG4gKiBcbiAqIEBwYXJhbSBmaWx0ZXJzIC0gRmlsdGVycyBmcm9tIGluZGV4LmZpbHRlcnMgKG9ubHkgZXF1YWxpdHkgYWxsb3dlZClcbiAqIEBwYXJhbSBpbmRleE5hbWUgLSBOYW1lIG9mIHRoZSBpbmRleCAoZm9yIGVycm9yIG1lc3NhZ2VzKVxuICogQHJldHVybnMgQ29tcG9zaXRlIGtleSB2YWx1ZXMgaW4gRWxlY3Ryb0RCIGZvcm1hdFxuICogQHRocm93cyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvciBpZiBub24tZXF1YWxpdHkgb3BlcmF0b3JzIGFyZSB1c2VkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBWYWxpZCBpbnB1dHNcbiAqIHsgdGVhbUlkOiB7IGVxOiAndGVhbS0xMjMnIH0gfSAg4oaSICB7IHRlYW1JZDogJ3RlYW0tMTIzJyB9XG4gKiB7IHRlYW1JZDogJ3RlYW0tMTIzJyB9ICAgICAgICAg4oaSICB7IHRlYW1JZDogJ3RlYW0tMTIzJyB9XG4gKiBcbiAqIC8vIEludmFsaWQgLSB3aWxsIFRIUk9XXG4gKiB7IGNyZWF0ZWRBdDogeyBndDogJzIwMjQtMDEtMDEnIH0gfSAgLy8gSW52YWxpZEluZGV4RmlsdGVyRXJyb3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RJbmRleEZpbHRlclZhbHVlcyhcbiAgICBmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIGluZGV4TmFtZT86IHN0cmluZ1xuKTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgaWYgKCFmaWx0ZXJzKSByZXR1cm4ge307XG5cbiAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVycykpIHtcbiAgICAgICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRGlyZWN0IHZhbHVlIChzaG9ydGhhbmQgZm9yIGVxdWFsaXR5KVxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgZmlsdGVyIG9wZXJhdG9yIG9iamVjdHNcbiAgICAgICAgY29uc3Qgb3BlcmF0b3JzID0gT2JqZWN0LmtleXModmFsdWUpO1xuXG4gICAgICAgIGlmIChvcGVyYXRvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE9ubHkgJ2VxJyBpcyB2YWxpZCBmb3IgY29tcG9zaXRlIGtleSBhdHRyaWJ1dGVzXG4gICAgICAgIGlmICh2YWx1ZS5lcSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgbWl4ZWQgb3BlcmF0b3JzIChlcSArIG90aGVycykgLSB0aGF0J3MgYSBtaXN0YWtlXG4gICAgICAgICAgICBjb25zdCBvdGhlck9wcyA9IG9wZXJhdG9ycy5maWx0ZXIob3AgPT4gb3AgIT09ICdlcScpO1xuICAgICAgICAgICAgaWYgKG90aGVyT3BzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEluZGV4RmlsdGVyRXJyb3Ioa2V5LCBvdGhlck9wcywgaW5kZXhOYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZS5lcTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIE5vbi1lcXVhbGl0eSBvcGVyYXRvcnMgLSB0aHJvdyBpbW1lZGlhdGVseVxuICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRJbmRleEZpbHRlckVycm9yKGtleSwgb3BlcmF0b3JzLCBpbmRleE5hbWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBGaW5kcyBhIG1hdGNoaW5nIGluZGV4IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBmaWx0ZXJzIGFuZCBzY2hlbWEuXG4gKiBAcGFyYW0gc2NoZW1hIC0gVGhlIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBmaWx0ZXJzIC0gVGhlIGZpbHRlcnMgdG8gbWF0Y2ggYWdhaW5zdFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgZW50aXR5XG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIFRoZSBlbnRpdHkgc2VydmljZVxuICogQHJldHVybnMgVGhlIG5hbWUgb2YgdGhlIG1hdGNoaW5nIGluZGV4IGFuZCB0aGUgZmlsdGVycyB1c2VkIHRvIG1hdGNoIGl0IG9yIHVuZGVmaW5lZCBpZiBubyBtYXRjaCBpcyBmb3VuZFxuICovXG5leHBvcnQgZnVuY3Rpb24gZmluZE1hdGNoaW5nSW5kZXgoXG4gICAgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5U2VydmljZTogRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hPGFueT5cbik6IHsgaW5kZXhOYW1lOiBzdHJpbmc7IGluZGV4RmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB9IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpmaW5kTWF0Y2hpbmdJbmRleCcpO1xuICAgIGlmICghZmlsdGVycykgZmlsdGVycyA9IHt9O1xuXG4gICAgLy8gQ29udmVydCBGaWx0ZXJHcm91cCBmb3JtYXQgdG8gc2ltcGxlIGZvcm1hdCBmb3IgaW5kZXggbWF0Y2hpbmdcbiAgICBjb25zdCBzaW1wbGVGaWx0ZXJzID0gZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJzKTtcbiAgICBsb2dnZXIuZGVidWcoYENvbnZlcnRlZCBmaWx0ZXJzIGZvciBpbmRleCBtYXRjaGluZzpgLCB7IG9yaWdpbmFsOiBmaWx0ZXJzLCBzaW1wbGU6IHNpbXBsZUZpbHRlcnMgfSk7XG5cbiAgICAvLyBGaXJzdCB0cnkgRWxlY3Ryb0RCJ3MgaW5kZXggbWF0Y2hpbmdcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG4gICAgY29uc3QgeyBrZXlzLCBpbmRleCwgc2hvdWxkU2NhbiB9ID0gKHJlcG9zaXRvcnkgYXMgYW55KS5fZmluZEJlc3RJbmRleEtleU1hdGNoKHNpbXBsZUZpbHRlcnMpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBGb3VuZCBFbGVjdHJvREIgaW5kZXg6ICR7aW5kZXh9IHdpdGggJHtrZXlzLmxlbmd0aH0gYXR0cmlidXRlIG1hdGNoZXMgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSB3aXRoIGZpbHRlcnMgYW5kIHNjYW46ICR7c2hvdWxkU2Nhbn0gLSBgLCBrZXlzLCBzaW1wbGVGaWx0ZXJzKTtcblxuICAgIC8vIElmIHdlIGZvdW5kIGEgbWF0Y2hpbmcgaW5kZXgsIHVzZSBpdFxuICAgIGlmICghc2hvdWxkU2Nhbikge1xuICAgICAgICBjb25zdCBpbmRleEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgICAgICAvLyBBZGQgbWF0Y2hlZCBrZXlzIHRvIGluZGV4RmlsdGVycyAodXNlIHNpbXBsZUZpbHRlcnMgd2hpY2ggaGFzIHRoZSByaWdodCBmb3JtYXQpXG4gICAgICAgIGtleXMuZm9yRWFjaCgoa2V5OiB7IG5hbWU6IHN0cmluZzsgdHlwZTogc3RyaW5nIH0pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlclZhbHVlID0gc2ltcGxlRmlsdGVyc1sga2V5Lm5hbWUgXTtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJWYWx1ZSkge1xuICAgICAgICAgICAgICAgIC8vIEhhbmRsZSBib3RoIHsgZXE6IHZhbHVlIH0gYW5kIGRpcmVjdCB2YWx1ZSBmb3JtYXRzXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzWyBrZXkubmFtZSBdID0gZmlsdGVyVmFsdWUuZXEgIT09IHVuZGVmaW5lZCA/IGZpbHRlclZhbHVlLmVxIDogZmlsdGVyVmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIE1hcCBFbGVjdHJvREIncyBpbnRlcm5hbCBpbmRleCBuYW1lIGJhY2sgdG8gb3VyIHNjaGVtYSdzIGluZGV4IG5hbWVcbiAgICAgICAgbGV0IHNjaGVtYUluZGV4TmFtZSA9IGluZGV4O1xuICAgICAgICBpZiAoaW5kZXggPT09ICcnKSB7XG4gICAgICAgICAgICBzY2hlbWFJbmRleE5hbWUgPSAncHJpbWFyeSc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBGaW5kIHRoZSBpbmRleCBpbiBvdXIgc2NoZW1hIHRoYXQgbWF0Y2hlcyB0aGlzIEdTSVxuICAgICAgICAgICAgY29uc3QgaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIG5hbWUsIGluZGV4RGVmIF0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXhlcykpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXhEZWYuaW5kZXggPT09IGluZGV4KSB7XG4gICAgICAgICAgICAgICAgICAgIHNjaGVtYUluZGV4TmFtZSA9IG5hbWU7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgRWxlY3Ryb0RCIG1hdGNoZWQgaW5kZXg6ICR7c2NoZW1hSW5kZXhOYW1lfSAoaW50ZXJuYWw6ICR7aW5kZXh9KSB3aXRoICR7a2V5cy5sZW5ndGh9IGF0dHJpYnV0ZSBtYXRjaGVzIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0gd2l0aCBmaWx0ZXJzOmAsIGluZGV4RmlsdGVycyk7XG4gICAgICAgIHJldHVybiB7IGluZGV4TmFtZTogc2NoZW1hSW5kZXhOYW1lLCBpbmRleEZpbHRlcnMgfTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBpbmRleCBtYXRjaCBmb3VuZCwgY2hlY2sgZm9yIHRlbXBsYXRlIG1hdGNoIG9yIFwiYWxsIHJlY29yZHNcIiBpbmRleFxuICAgIGNvbnN0IGluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICBmb3IgKGNvbnN0IFsgaW5kZXhOYW1lLCBpbmRleERlZiBdIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4ZXMpKSB7XG4gICAgICAgIGlmIChpbmRleERlZi5way50ZW1wbGF0ZSAmJiB0eXBlb2YgaW5kZXhEZWYucGsudGVtcGxhdGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAvLyBFbnRpdHktc3BlY2lmaWMgdGVtcGxhdGUgbWF0Y2hcbiAgICAgICAgICAgIGlmIChpbmRleERlZi5way50ZW1wbGF0ZS50b0xvd2VyQ2FzZSgpID09PSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCkpIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIuZGVidWcoYFVzaW5nIHRlbXBsYXRlIG1hdGNoaW5nIGluZGV4OiAke2luZGV4TmFtZX0gZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFwiQWxsIHJlY29yZHNcIiBpbmRleCBwYXR0ZXJuIC0gY29uc3RhbnQgUEsgd2l0aCBlbXB0eSBjb21wb3NpdGVcbiAgICAgICAgICAgIC8vIFVzZWZ1bCBmb3Igc29ydGVkIGxpc3RpbmdzIHdpdGhvdXQgZmlsdGVycyAoZS5nLiwgQUxMX0VWRU5UUywgQUxMX0xPR1MpXG4gICAgICAgICAgICBpZiAoaW5kZXhEZWYucGsuY29tcG9zaXRlICYmIGluZGV4RGVmLnBrLmNvbXBvc2l0ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIuZGVidWcoYFVzaW5nIFwiYWxsIHJlY29yZHNcIiBpbmRleDogJHtpbmRleE5hbWV9IHdpdGggY29uc3RhbnQgUEsgdGVtcGxhdGU6ICR7aW5kZXhEZWYucGsudGVtcGxhdGV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhOYW1lLFxuICAgICAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogUmV0cmlldmVzIGEgbGlzdCBvZiBlbnRpdGllcyBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBsaXN0aW5nIGVudGl0aWVzLlxuICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gYXJyYXkgb2YgZW50aXRpZXMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsaXN0RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IExpc3RFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdsaXN0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6bGlzdEVudGl0eScpLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgICAgICBxdWVyeSA9IHt9LFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgY29uc3Qge1xuICAgICAgICBmaWx0ZXJzID0ge30sXG4gICAgICAgIGF0dHJpYnV0ZXMgPSBbXSxcbiAgICAgICAgcGFnaW5hdGlvbiA9IHsgb3JkZXI6ICdhc2MnLCBwYWdlcjogJ2N1cnNvcicsIGN1cnNvcjogbnVsbCwgY291bnQ6IDI1LCBwYWdlczogdW5kZWZpbmVkLCBsaW1pdDogdW5kZWZpbmVkIH0sXG4gICAgICAgIGluZGV4OiBzcGVjaWZpZWRJbmRleFxuICAgIH0gPSBxdWVyeTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBsaXN0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZUxpc3QnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIENoZWNrIGlmIHdlIGhhdmUgYSBmaWx0ZXIgdGhhdCBtYXRjaGVzIGFuIGluZGV4XG4gICAgY29uc3Qgc2NoZW1hID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICBjb25zdCBtYXRjaFJlc3VsdCA9IHNwZWNpZmllZEluZGV4XG4gICAgICAgID8geyBpbmRleE5hbWU6IHNwZWNpZmllZEluZGV4Lm5hbWUsIGluZGV4RmlsdGVyczogZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHNwZWNpZmllZEluZGV4LmZpbHRlcnMsIHNwZWNpZmllZEluZGV4Lm5hbWUpIH1cbiAgICAgICAgOiBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlcnMsIGVudGl0eU5hbWUsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBNYXRjaCByZXN1bHQ6YCwgbWF0Y2hSZXN1bHQpO1xuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnbGlzdCcsICgpID0+XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LmdvKHsgYXR0cmlidXRlczogYXR0cmlidXRlcyBhcyBhbnksIC4uLnJlbW92ZUVtcHR5KHBhZ2luYXRpb24pIH0pLFxuICAgICAgICAgICAgeyBmaWx0ZXJzLCBpbmRleE5hbWU6IG1hdGNoUmVzdWx0LmluZGV4TmFtZSwgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoIGZvciBmdWxsIHNjYW5cbiAgICAgICAgbG9nZ2VyLndhcm4oYFdBUk5JTkc6IE5vIG1hdGNoaW5nIGluZGV4IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0sIHVzaW5nIG1hdGNoIGZvciBmdWxsIHNjYW5gLCBmaWx0ZXJzKTtcblxuICAgICAgICAvLyBUcmFjayBmdWxsIHNjYW4gLSBDUklUSUNBTDogZXhwZW5zaXZlIHBlcmZvcm1hbmNlL2Nvc3QgaXNzdWVcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KGBlbnRpdHkuZnVsbF9zY2FuYCwgMSwge1xuICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lLCBvcGVyYXRpb246ICdsaXN0JyB9LFxuICAgICAgICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWRkIGNoZWNrcG9pbnQgZm9yIHZpc2liaWxpdHlcbiAgICAgICAgU3Bhbk9ic2VydmVyLmdldEN1cnJlbnRTcGFuKCk/LmNoZWNrcG9pbnQ/LignZGF0YWJhc2UuZnVsbF9zY2FuJywge1xuICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgICdkYi5lbnRpdHlfbmFtZSc6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgJ2RiLm9wZXJhdGlvbic6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAnZGIud2FybmluZyc6ICdub19pbmRleF9mb3VuZCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICdkYi5mdWxsX3NjYW4nOiAxLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRhdGE6IHsgZnVsbFNjYW5GaWx0ZXJzOiBmaWx0ZXJzIHx8IHt9IH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjYW5RdWVyeSA9IHJlcG9zaXRvcnkuc2NhbjtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIHNjYW5RdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IGFkZCBhdHRyaWJ1dGVzIHRvIHNjYW4gcXVlcnlcbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdzY2FuJywgKCkgPT5cbiAgICAgICAgICAgIHNjYW5RdWVyeS5nbyhyZW1vdmVFbXB0eShwYWdpbmF0aW9uKSksXG4gICAgICAgICAgICB7IGZpbHRlcnMsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJMaXN0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGxpc3RFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZmlsdGVycytwYWdpbmc6YCk7XG5cbiAgICByZXR1cm4gZW50aXRpZXM7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUXVlcnlFbnRpdHlBcmdzPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgcXVlcnk6IEVudGl0eVF1ZXJ5PFNjaD5cbn1cblxuLyoqXG4gKiBFeGVjdXRlcyBhIHF1ZXJ5IG9uIHRoZSBzcGVjaWZpZWQgZW50aXR5LlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgdGhlIHF1ZXJ5LlxuICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJlc3VsdCBvZiB0aGUgcXVlcnkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBxdWVyeUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBRdWVyeUVudGl0eUFyZ3M8Uz4pIHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ3F1ZXJ5JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6cXVlcnlFbnRpdHknKSxcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICAgICAgcXVlcnkgPSB7fVxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGZpbHRlcnMgPSB7fSxcbiAgICAgICAgYXR0cmlidXRlcyA9IFtdLFxuICAgICAgICBwYWdpbmF0aW9uID0geyBvcmRlcjogJ2FzYycsIHBhZ2VyOiAnY3Vyc29yJywgY3Vyc29yOiBudWxsLCBjb3VudDogMjUsIHBhZ2VzOiB1bmRlZmluZWQsIGxpbWl0OiB1bmRlZmluZWQgfSxcbiAgICAgICAgaW5kZXg6IHNwZWNpZmllZEluZGV4XG4gICAgfSA9IHF1ZXJ5O1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZVF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICAvLyAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIENoZWNrIGlmIHdlIGhhdmUgYSBmaWx0ZXIgdGhhdCBtYXRjaGVzIGFuIGluZGV4XG4gICAgY29uc3Qgc2NoZW1hID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICBjb25zdCBtYXRjaFJlc3VsdCA9IHNwZWNpZmllZEluZGV4XG4gICAgICAgID8geyBpbmRleE5hbWU6IHNwZWNpZmllZEluZGV4Lm5hbWUsIGluZGV4RmlsdGVyczogZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHNwZWNpZmllZEluZGV4LmZpbHRlcnMsIHNwZWNpZmllZEluZGV4Lm5hbWUpIH1cbiAgICAgICAgOiBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlcnMsIGVudGl0eU5hbWUsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgLy8gVXNlIHRoZSBhcHByb3ByaWF0ZSBpbmRleCBpZiBhdmFpbGFibGVcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICBsZXQgZW50aXRpZXM7XG4gICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgIC8vIFVzZSBpbmRleCBxdWVyeSBpZiB3ZSBoYXZlIGEgbWF0Y2hcbiAgICAgICAgY29uc3QgaW5kZXhRdWVyeSA9IHJlcG9zaXRvcnkucXVlcnlbIG1hdGNoUmVzdWx0LmluZGV4TmFtZSBdKG1hdGNoUmVzdWx0LmluZGV4RmlsdGVycyk7XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdxdWVyeScsICgpID0+XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LmdvKHsgYXR0cmlidXRlczogYXR0cmlidXRlcyBhcyBhbnksIC4uLnJlbW92ZUVtcHR5KHBhZ2luYXRpb24pIH0pLFxuICAgICAgICAgICAgeyBmaWx0ZXJzLCBpbmRleE5hbWU6IG1hdGNoUmVzdWx0LmluZGV4TmFtZSwgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoIGZvciBmdWxsIHNjYW5cbiAgICAgICAgbG9nZ2VyLndhcm4oYFdBUk5JTkc6IE5vIG1hdGNoaW5nIGluZGV4IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0sIHVzaW5nIG1hdGNoIGZvciBmdWxsIHNjYW5gLCBmaWx0ZXJzKTtcblxuICAgICAgICAvLyBUcmFjayBmdWxsIHNjYW4gLSBDUklUSUNBTDogZXhwZW5zaXZlIHBlcmZvcm1hbmNlL2Nvc3QgaXNzdWVcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KGBlbnRpdHkuZnVsbF9zY2FuYCwgMSwge1xuICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lLCBvcGVyYXRpb246ICdxdWVyeScgfSxcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBjaGVja3BvaW50IGZvciB2aXNpYmlsaXR5XG4gICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAnZGIuZW50aXR5X25hbWUnOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICdkYi5vcGVyYXRpb24nOiAncXVlcnknLFxuICAgICAgICAgICAgICAgICdkYi53YXJuaW5nJzogJ25vX2luZGV4X2ZvdW5kJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmZ1bGxfc2Nhbic6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YTogeyBmdWxsU2NhbkZpbHRlcnM6IGZpbHRlcnMgfHwge30gfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3Qgc2NhblF1ZXJ5ID0gcmVwb3NpdG9yeS5zY2FuO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgc2NhblF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogYWRkIGF0dHJpYnV0ZXMgdG8gc2NhbiBxdWVyeVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3NjYW4nLCAoKSA9PlxuICAgICAgICAgICAgc2NhblF1ZXJ5LmdvKHJlbW92ZUVtcHR5KHBhZ2luYXRpb24pKSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgdG8gdXBkYXRlIHRoZSBlbnRpdHkgd2l0aC5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cGRhdGUnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXR0cmlidXRlcyBmb3IgcGF0Y2ggb3BlcmF0aW9uLlxuICAgICAqL1xuICAgIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycztcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjb25kaXRpb25zIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvbi5cbiAgICAgKi9cbiAgICBjb25kaXRpb25zPzogYW55OyAvLyBUT0RPXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJlLWNhbGN1bGF0ZWQgY29tcG9zaXRlIGtleSBkYXRhLiBJZiBwcm92aWRlZCwgdGhpcyB3aWxsIGJlIHVzZWQgZGlyZWN0bHkuXG4gICAgICogSWYgbm90IHByb3ZpZGVkIGFuZCBjb21wb3NpdGUga2V5cyBhcmUgbmVlZGVkLCB0aGV5IHdpbGwgYmUgY2FsY3VsYXRlZCBpbnRlcm5hbGx5LlxuICAgICAqL1xuICAgIGNvbXBvc2l0ZUtleURhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eU9wZXJhdG9ycyB7XG4gICAgcmVtb3ZlPzogc3RyaW5nW107XG59XG5cbi8qKlxuICogUmVzcG9uc2UgdHlwZSBmb3IgdXBkYXRlIGVudGl0eSBvcGVyYXRpb24uXG4gKiBQcm92aWRlcyBhIHR5cGVkIHdyYXBwZXIgZm9yIHRoZSBlbGVjdHJvZGIgdXBkYXRlIHJlc3BvbnNlLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCB0eXBlIFVwZGF0ZUVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbn1cblxuaW50ZXJmYWNlIFByZXBhcmVDb21wb3NpdGVBdHRyaWJ1dGVzQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICBpZGVudGlmaWVyczogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICBkYXRhOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogU2V0PHN0cmluZz47XG4gICAgbG9nZ2VyOiBJTG9nZ2VyO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBhcmdzOiBQcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0FyZ3M8Uz5cbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgaWRlbnRpZmllcnMsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcyxcbiAgICAgICAgbG9nZ2VyLFxuICAgIH0gPSBhcmdzO1xuXG4gICAgY29uc3QgY29tcG9zaXRlS2V5VmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgYXR0cmlidXRlc1RvRmV0Y2ggPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBkYXRhQXNSZWNvcmQgPSBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT47IC8vIENhc3QgZm9yIGR5bmFtaWMgYWNjZXNzXG5cbiAgICBpZiAocmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLnNpemUgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHt9OyAvLyBObyBjb21wb3NpdGUgYXR0cmlidXRlcyBuZWVkZWRcbiAgICB9XG5cbiAgICAvLyBvbmx5IGluY2x1ZGUgd2hhdCdzIG5vdCBhbHJlYWR5IGluIGRhdGEgb3IgaWRlbnRpZmllcnNcbiAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuZm9yRWFjaChhdHRyID0+IHtcbiAgICAgICAgaWYgKCFkYXRhQXNSZWNvcmQuaGFzT3duUHJvcGVydHkoYXR0cikgJiYgIWlkZW50aWZpZXJzLmhhc093blByb3BlcnR5KGF0dHIpKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzVG9GZXRjaC5hZGQoYXR0cik7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChhdHRyaWJ1dGVzVG9GZXRjaC5zaXplID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYE5lZWQgdG8gZmV0Y2ggYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXM6YCwgQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlY29yZENvbnRhaW5lciA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpXG4gICAgICAgICAgICAgICAgLmdldChpZGVudGlmaWVycylcbiAgICAgICAgICAgICAgICAuZ28oeyBhdHRyaWJ1dGVzOiBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSwgY29uc2lzdGVudFJlYWQ6IHRydWUgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUmVjb3JkRGF0YSA9IGV4aXN0aW5nUmVjb3JkQ29udGFpbmVyLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgaWYgKCFleGlzdGluZ1JlY29yZERhdGEpIHtcblxuICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBObyBleGlzdGluZyByZWNvcmQgZm91bmQgZm9yIGNvbXBvc2l0ZSBrZXlzOmAsIEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpKTtcblxuICAgICAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNUb0ZldGNoLmZvckVhY2goYXR0ciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1JlY29yZERhdGEuaGFzT3duUHJvcGVydHkoYXR0cikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZUtleVZhbHVlc1sgYXR0ciBdID0gZXhpc3RpbmdSZWNvcmREYXRhWyBhdHRyIF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBBdHRyaWJ1dGUgbm90IGZvdW5kIC0ganVzdCBsb2cgZGVidWcsIGRvbid0IHdhcm4gKGNvdWxkIGJlIG9wdGlvbmFsIHNwYXJzZSBpbmRleCBhdHRyaWJ1dGUpXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIuZGVidWcoYENvbXBvc2l0ZSBrZXkgYXR0cmlidXRlIFwiJHthdHRyfVwiIChJRDogJHtKU09OLnN0cmluZ2lmeShpZGVudGlmaWVycyl9KSBub3QgZm91bmQgaW4gZXhpc3RpbmcgcmVjb3JkIChtYXkgYmUgb3B0aW9uYWwpLmApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgRXJyb3IgZmV0Y2hpbmcgYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXMgKElEOiAke0pTT04uc3RyaW5naWZ5KGlkZW50aWZpZXJzKX0pOmAsIGVycm9yKTtcblxuICAgICAgICAgICAgLy8gVHJhY2sgZGF0YWJhc2UgZXJyb3IgbWV0cmljXG4gICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoYGVudGl0eS5jb21wb3NpdGVfa2V5LmZldGNoX2Vycm9yYCwgMSwge1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogYXJncy5lbnRpdHlOYW1lIH0sXG4gICAgICAgICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoYFByZXBhcmVkIGNvbXBvc2l0ZSBrZXkgdmFsdWVzOmAsIGNvbXBvc2l0ZUtleVZhbHVlcyk7XG4gICAgcmV0dXJuIGNvbXBvc2l0ZUtleVZhbHVlcztcbn1cblxuLyoqXG4gKiBVcGRhdGVzIGFuIGVudGl0eSBpbiB0aGUgZGF0YWJhc2UuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEBwYXJhbSB7VXBkYXRlRW50aXR5QXJnczxTPn0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciB1cGRhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMge1Byb21pc2U8VXBkYXRlRW50aXR5UmVzcG9uc2U8Uz4+fSAtIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSB1cGRhdGVkIGVudGl0eS5cbiAqIEB0aHJvd3Mge0Vycm9yfSAtIElmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIHRoZSB1cGRhdGUgb3BlcmF0aW9uLCBvciBpZiB2YWxpZGF0aW9uIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8VXBkYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBkYXRhLFxuICAgICAgICBvcGVyYXRvcnMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG4gICAgICAgIGNydWRUeXBlID0gJ3VwZGF0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwZGF0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICAgICAgY29tcG9zaXRlS2V5RGF0YSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCB7IGRhdGEsIHByb3ZpZGVkQ29tcG9zaXRlS2V5RGF0YTogY29tcG9zaXRlS2V5RGF0YSB9KTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciB1cGRhdGUgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVVcGRhdGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciB1cGRhdGU6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyAtLS0gQ29tcG9zaXRlIEtleSBIYW5kbGluZyAtLS1cbiAgICBjb25zdCBzY2hlbWEgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpO1xuICAgIGNvbnN0IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBpZiAoc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBpbmRleE5hbWUgaW4gc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4RGVmaW5pdGlvbiA9IHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChpbmRleERlZmluaXRpb24pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwa0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5waz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChwa0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHBrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBwa0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3Qgc2tDb21wb3NpdGUgPSBpbmRleERlZmluaXRpb24uc2s/LmNvbXBvc2l0ZTtcbiAgICAgICAgICAgICAgICBpZiAoc2tDb21wb3NpdGUgJiYgQXJyYXkuaXNBcnJheShza0NvbXBvc2l0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2tDb21wb3NpdGUuZm9yRWFjaChhdHRyID0+IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmFkZChhdHRyKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBpZiAoYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuc2l6ZSA+IDApIHtcbiAgICAgICAgaWYgKGNvbXBvc2l0ZUtleURhdGEgJiYgdHlwZW9mIGNvbXBvc2l0ZUtleURhdGEgPT09ICdvYmplY3QnKSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBmb3IgdXBkYXRlLmAsIGNvbXBvc2l0ZUtleURhdGEpO1xuXG4gICAgICAgICAgICBmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQiA9IGNvbXBvc2l0ZUtleURhdGE7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgY292ZXJzIGFsbCBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlc1xuICAgICAgICAgICAgY29uc3QgbWlzc2luZ0Zyb21Qcm92aWRlZCA9IEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpLmZpbHRlcihhdHRyID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAhZGF0YS5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhaWRlbnRpZmllcnMuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAgICAgIWZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCLmhhc093blByb3BlcnR5KGF0dHIpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAobWlzc2luZ0Zyb21Qcm92aWRlZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYFByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgaXMgbWlzc2luZyBzb21lIHJlcXVpcmVkIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzOiAke21pc3NpbmdGcm9tUHJvdmlkZWQuam9pbignLCAnKX0uIFVwZGF0ZSBtYXkgZmFpbCBpZiB0aGVzZSBhcmUgbmVlZGVkIGJ5IEVsZWN0cm9EQi5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICBsb2dnZXIuZGVidWcoYE5vIGNvbXBvc2l0ZUtleURhdGEgcHJvdmlkZWQsIHByZXBhcmluZyBjb21wb3NpdGUgYXR0cmlidXRlcyBpbnRlcm5hbGx5LiBSZXF1aXJlZDpgLCBBcnJheS5mcm9tKGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzKSk7XG5cbiAgICAgICAgICAgIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCID0gYXdhaXQgcHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNGb3JVcGRhdGUoe1xuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZGF0YTogZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+LFxuICAgICAgICAgICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgbG9nZ2VyLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgZGVmaW5lZCBpbiBzY2hlbWEgb3IgbmVlZGVkIGZvciB0aGlzIHVwZGF0ZS5gKTtcbiAgICB9XG4gICAgLy8gLS0tIEVuZCBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuXG5cblxuICAgIC8vIFVzZSBFbGVjdHJvREIgZm9yIGFsbCBmaWVsZHMgaW5jbHVkaW5nIF9hY3RvciAobm93IGluIHNjaGVtYSlcbiAgICBjb25zdCBxdWVyeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLnBhdGNoKGlkZW50aWZpZXJzKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBjb21wb3NpdGUgdmFsdWVzIGZvciBFbGVjdHJvREIgcGF0Y2g6YCwgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgICAgICBxdWVyeS5jb21wb3NpdGUoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRvcnM/LnJlbW92ZSkge1xuICAgICAgICBxdWVyeS5yZW1vdmUob3BlcmF0b3JzLnJlbW92ZSBhcyBhbnkpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3VwZGF0ZScsICgpID0+XG4gICAgICAgIHF1ZXJ5LmdvKClcbiAgICApO1xuXG4gICAgLy8gLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclVwZGF0ZScsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5IGFzIFVwZGF0ZUVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG4vKipcbiAqIHRoZSBhcmd1bWVudHMgZm9yIGRlbGV0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2RlbGV0ZScgXTtcbn1cblxuLyoqXG4gKiBSZXNwb25zZSB0eXBlIGZvciBkZWxldGUgZW50aXR5IG9wZXJhdGlvbi5cbiAqIFByb3ZpZGVzIGEgdHlwZWQgd3JhcHBlciBmb3IgdGhlIGVsZWN0cm9kYiBkZWxldGUgcmVzcG9uc2UuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqL1xuZXhwb3J0IHR5cGUgRGVsZXRlRW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxufVxuXG4vKipcbiAqIERlbGV0ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgZGVsZXRpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSBkZWxldGVkIGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBEZWxldGVFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxEZWxldGVFbnRpdHlSZXNwb25zZTxTPj4ge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBpZCxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2RlbGV0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmRlbGV0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlRGVsZXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGRlbGV0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2RlbGV0ZScsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVycykuZ28oKVxuICAgICk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYWZ0ZXJEZWxldGUnLCBjb250ZXh0OiBhcmd1bWVudHN9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBkZWxldGVFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWQ6YCwgaWQpO1xuXG4gICAgcmV0dXJuIGVudGl0eSBhcyBEZWxldGVFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGJhdGNoIGRlbGV0aW5nIGVudGl0aWVzLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZUJhdGNoRW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBlbnRpdHkgSURzIHRvIGRlbGV0ZS5cbiAgICAgKi9cbiAgICBpZHM6IEFycmF5PE9wc1NjaGVtYVsgJ2RlbGV0ZScgXT47XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyAoZGVmYXVsdDogMSkuXG4gICAgICovXG4gICAgY29uY3VycmVudD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBEZWxldGVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgZGVsZXRpbmcgdGhlIGVudGl0aWVzLlxuICogQHJldHVybnMgVGhlIHVucHJvY2Vzc2VkIGl0ZW1zIHRoYXQgY291bGRuJ3QgYmUgZGVsZXRlZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUJhdGNoRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IERlbGV0ZUJhdGNoRW50aXR5QXJnczxTPikge1xuICAgIGNvbnN0IHtcbiAgICAgICAgaWRzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICBjb25jdXJyZW50ID0gMSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2RlbGV0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmRlbGV0ZUJhdGNoRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkcywgY29uY3VycmVudCB9KTtcblxuICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZm9yIGFsbCBpdGVtcyBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaWRzLm1hcChpZCA9PiBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCkpO1xuXG4gICAgLy8gVmFsaWRhdGUgZWFjaCBpdGVtIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IHZhbGlkYXRpb25zID0gYXdhaXQgUHJvbWlzZS5hbGwoaWRlbnRpZmllcnNCYXRjaC5tYXAoYXN5bmMgaWRlbnRpZmllcnMgPT5cbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgICAgIGlucHV0OiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGFjdG9yOiBhY3RvclxuICAgICAgICB9KVxuICAgICkpO1xuXG4gICAgLy8gQ2hlY2sgZm9yIHZhbGlkYXRpb24gZXJyb3JzXG4gICAgY29uc3QgdmFsaWRhdGlvbkVycm9ycyA9IHZhbGlkYXRpb25zXG4gICAgICAgIC5tYXAoKHZhbGlkYXRpb24sIGluZGV4KSA9PiAoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSlcbiAgICAgICAgLmZpbHRlcigoeyB2YWxpZGF0aW9uIH0pID0+ICF2YWxpZGF0aW9uLnBhc3MpO1xuXG4gICAgaWYgKHZhbGlkYXRpb25FcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb25FcnJvcnMuZmxhdE1hcCgoeyB2YWxpZGF0aW9uLCBpbmRleCB9KSA9PlxuICAgICAgICAgICAgKHZhbGlkYXRpb24uZXJyb3JzIHx8IFtdKS5tYXAoZXJyb3IgPT4gKHtcbiAgICAgICAgICAgICAgICAuLi5lcnJvcixcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBgSXRlbSAke2luZGV4fTogJHtlcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgIH0pKVxuICAgICAgICApKTtcbiAgICB9XG5cbiAgICAvLyBQZXJmb3JtIGJhdGNoIGRlbGV0ZSBvcGVyYXRpb24gd2l0aCBjb25jdXJyZW5jeSBjb250cm9sXG4gICAgLy8gUGVyIEVsZWN0cm9EQiBkb2NzOiBodHRwOi8vZWxlY3Ryb2RiLmRldi9lbi9tdXRhdGlvbnMvYmF0Y2gtZGVsZXRlL1xuICAgIC8vIE5vdGU6IEVsZWN0cm9EQiB0eXBlcyB1c2UgJ2NvbmN1cnJlbmN5JyB3aGlsZSBkb2NzIHNob3cgJ2NvbmN1cnJlbnQnXG4gICAgY29uc3QgYnVsa09wdGlvbnM6IFBhcnRpYWw8QnVsa09wdGlvbnM+ID0ge1xuICAgICAgICBjb25jdXJyZW5jeTogY29uY3VycmVudFxuICAgIH07XG5cbiAgICBjb25zdCBlbGVjdHJvUmVzdWx0ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnYmF0Y2hEZWxldGUnLCAoKSA9PlxuICAgICAgICBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS5kZWxldGUoaWRlbnRpZmllcnNCYXRjaCkuZ28oYnVsa09wdGlvbnMpLFxuICAgICAgICB7IGl0ZW1Db3VudDogaWRlbnRpZmllcnNCYXRjaC5sZW5ndGggfVxuICAgICk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZGVsZXRlQmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWRzOmAsIGlkcyk7XG5cbiAgICByZXR1cm4gZWxlY3Ryb1Jlc3VsdDtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIGZpbHRlciBvYmplY3Qgd2l0aCBlcSBvcGVyYXRvcnMgdG8gYSBzaW1wbGlmaWVkIGZvcm0uXG4gKiBFeGFtcGxlOiB7IGFnZTogeyBlcTogNjUgfSB9IGJlY29tZXMgeyBhZ2U6IDY1IH1cbiAqIEBwYXJhbSBmaWx0ZXJzIC0gVGhlIGZpbHRlciBvYmplY3QgdG8gc2ltcGxpZnlcbiAqIEByZXR1cm5zIEEgbmV3IGZpbHRlciBvYmplY3Qgd2l0aCBlcSBvcGVyYXRvcnMgY29udmVydGVkIHRvIGRpcmVjdCB2YWx1ZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbXBsaWZ5RmlsdGVycyhmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkKTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgaWYgKCFmaWx0ZXJzKSByZXR1cm4ge307XG5cbiAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGZpbHRlcnMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICdlcScgaW4gdmFsdWUpIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZS5lcTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBleHBvcnQgY2xhc3MgRW50aXR5Q3J1ZFNlcnZpY2U8UyBleHRlbmRzIFNjaGVtYTxhbnksIGFueSwgYW55Pj57XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgbGlzdChvcHRpb25zOiBMaXN0RW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgbGlzdEVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgY3JlYXRlKG9wdGlvbnM6IENyZWF0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgdXBkYXRlKG9wdGlvbnM6IFVwZGF0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IHVwZGF0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldEVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGdldEVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG5cbi8vICAgICBwdWJsaWMgYXN5bmMgZGVsZXRlKG9wdGlvbnM6IERlbGV0ZUVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGRlbGV0ZUVudGl0eShvcHRpb25zKTtcbi8vICAgICB9XG4vLyB9XG5cblxuLy8gZXhwb3J0IGNvbnN0IERlZmF1bHRFbnRpdHlDcnVkU2VydmljZSA9IG5ldyBFbnRpdHlDcnVkU2VydmljZSgpOyJdfQ==