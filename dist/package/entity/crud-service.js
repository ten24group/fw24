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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBbUZBLDhCQXVEQztBQThCRCx3Q0FnRUM7QUE0QkQsb0NBeURDO0FBK0JELG9DQW9FQztBQWlDRCw4REEwQkM7QUErQ0QsNERBeUNDO0FBVUQsOENBNkVDO0FBUUQsZ0NBOEZDO0FBV0Qsa0NBOEZDO0FBb0lELG9DQXdJQztBQStCRCxvQ0FxREM7QUEwQkQsOENBK0RDO0FBUUQsMENBWUM7QUFyeUNELDRDQUEwQztBQUMxQyxvQ0FBMkM7QUFDM0Msd0NBQW1EO0FBQ25ELG9DQUFzRDtBQUN0RCw4Q0FBa0U7QUFFbEUsZ0VBQWtFO0FBRWxFLG1DQUEyRDtBQUUzRCwwREFBeUY7QUFtRXpGOzs7O0dBSUc7QUFDSSxLQUFLLFVBQVUsU0FBUyxDQUF3QyxPQUF5QjtJQUU1RixNQUFNLEVBQ0YsRUFBRSxFQUNGLFVBQVUsRUFDVixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLEtBQUssRUFDaEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyx3QkFBd0IsQ0FBQyxFQUMvQyxTQUFTLEdBQUcsNkJBQWdCLEVBQzVCLFVBQVUsR0FBRyxzQkFBVSxDQUFDLE9BQU8sRUFDL0IsZUFBZSxHQUFHLHVCQUFlLENBQUMsT0FBTyxHQUU1QyxHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sQ0FBQyxLQUFLLENBQUMsK0NBQStDLFVBQVUsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFL0YsNkVBQTZFO0lBRTdFLE1BQU0sV0FBVyxHQUFHLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUUvRCxzQkFBc0I7SUFDdEIsd0dBQXdHO0lBQ3hHLDJCQUEyQjtJQUMzQixvRkFBb0Y7SUFDcEYs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QUM7SUFDTCxDQUFDO0lBQ0QsT0FBTyxNQUFNLENBQUM7QUFDbEIsQ0FBQztBQUVELG1FQUFtRTtBQUVuRSxzREFBc0Q7QUFDdEQsNENBQTRDO0FBQzVDLFFBQVE7QUFFUiwwREFBMEQ7QUFDMUQsOENBQThDO0FBQzlDLFFBQVE7QUFFUiwwREFBMEQ7QUFDMUQsOENBQThDO0FBQzlDLFFBQVE7QUFFUixvREFBb0Q7QUFDcEQsMkNBQTJDO0FBQzNDLFFBQVE7QUFFUiwwREFBMEQ7QUFDMUQsOENBQThDO0FBQzlDLFFBQVE7QUFDUixJQUFJO0FBR0osbUVBQW1FIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBCdWxrT3B0aW9ucyB9IGZyb20gXCJlbGVjdHJvZGJcIjtcbmltcG9ydCB7IEF1dGhvcml6ZXIgfSBmcm9tIFwiLi4vYXV0aG9yaXplXCI7XG5pbXBvcnQgeyBFdmVudERpc3BhdGNoZXIgfSBmcm9tIFwiLi4vZXZlbnRcIjtcbmltcG9ydCB7IElMb2dnZXIsIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBpc0VtcHR5T2JqZWN0LCByZW1vdmVFbXB0eSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgRGVmYXVsdFZhbGlkYXRvciwgdHlwZSBJVmFsaWRhdG9yIH0gZnJvbSBcIi4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSwgRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hLCBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXMgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHsgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSBcIi4vZXJyb3JzL3ZhbGlkYXRpb24tZXJyb3JcIjtcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uIH0gZnJvbSBcIi4vcXVlcnlcIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5UXVlcnkgfSBmcm9tIFwiLi9xdWVyeS10eXBlc1wiO1xuaW1wb3J0IHsgTWV0cmljT2JzZXJ2ZXIsIFNwYW5PYnNlcnZlciwgUXVlcnlPYnNlcnZlciB9IGZyb20gXCIuLi9vYnNlcnZhYmlsaXR5L29ic2VydmVyc1wiO1xuXG4vKipcbiAqIFxuICogU2VyaWFsaXplci9mb3JtYXR0ZXJcbiAqICAtIGh0dHBzOi8vZ2l0aHViLmNvbS9ka3psdi9taWNyby10cmFuc2Zvcm1cbiAqICBcbiAqIEV2ZW50IGRpc3BhdGNoZXJcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL0ZveEFuZEZseS90cy1ldmVudC1kaXNwYXRjaGVyL2Jsb2IvbWFzdGVyL3NyYy9pbmRleC50c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vcnlhcmRsZXkvdHMtYnVzXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9iaW5pZXIvdGlueS10eXBlZC1lbWl0dGVyL3RyZWUvbWFzdGVyXG4gKiBcbiAqIFJvdXRlclxuICogLSBodHRwczovL2dpdGh1Yi5jb20vYmVyc3RlbmQvdGlueS1yZXF1ZXN0LXJvdXRlci9ibG9iL21hc3Rlci9zcmMvcm91dGVyLnRzXG4gKiBcbiAqIERJXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9uaWNvanMvdHlwZWQtaW5qZWN0XG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9taWNyb3NvZnQvdHN5cmluZ2VcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL293amEvaW9jXG4gKiBcbiAqIFxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFzZUVudGl0eUNydWRBcmdzPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IHtcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmc7XG4gICAgZW50aXR5U2VydmljZTogRW50aXR5U2VydmljZVR5cGVGcm9tU2NoZW1hPFM+O1xuXG4gICAgY3J1ZFR5cGU/OiBrZXlvZiBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnM7XG4gICAgYWN0b3I/OiBBY3RvcjsgLy8gQWN0b3IgY29udGV4dDogY29tcHJlaGVuc2l2ZSBhY3RvciBpbmZvcm1hdGlvbiBpbmNsdWRpbmcgYXV0aGVudGljYXRpb24gZGV0YWlsc1xuICAgIHRlbmFudD86IGFueTsgLy8gdG9kbzogZGVmaW5lIHRlbmFudCBjb250ZXh0XG5cbiAgICBsb2dnZXI/OiBJTG9nZ2VyO1xuICAgIHZhbGlkYXRvcj86IElWYWxpZGF0b3I7XG4gICAgYXV0aG9yaXplcj86IEF1dGhvcml6ZXIuSUF1dGhvcml6ZXI7ICAgICAgICAvLyB0b2RvOiBkZWZpbmUgYXV0aG9yaXplciBzaWduYXR1cmVcbiAgICBldmVudERpc3BhdGNoZXI/OiBFdmVudERpc3BhdGNoZXIuSUV2ZW50RGlzcGF0Y2hlcjsgIC8vIHRvZG8gZGVmaW5lIGV2ZW50IGRpc3BhdGNoZXIgc2lnbmF0dXJlXG5cbiAgICAvLyB0ZWxlbWV0cnlcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIHJldHJpZXZpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdldEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElEIG9mIHRoZSBlbnRpdHkgdG8gcmV0cmlldmUuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2dldCcgXTtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgaW4gdGhlIHJldHJpZXZlZCBlbnRpdHkuXG4gICAgICovXG4gICAgYXR0cmlidXRlcz86IEFycmF5PHN0cmluZz47XG59XG5cbi8qKlxuICogUmVzcG9uc2UgdHlwZSBmb3IgZ2V0IGVudGl0eSBvcGVyYXRpb24uXG4gKiBQcm92aWRlcyBhIHR5cGVkIHdyYXBwZXIgZm9yIHRoZSBlbGVjdHJvZGIgZ2V0IHJlc3BvbnNlLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCB0eXBlIEdldEVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbn1cblxuLyoqXG4gKiBSZXRyaWV2ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgcmV0cmlldmluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMgVGhlIHJldHJpZXZlZCBlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogR2V0RW50aXR5QXJnczxTPik6IFByb21pc2U8R2V0RW50aXR5UmVzcG9uc2U8Uz4+IHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgaWQsXG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdnZXQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpnZXRFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBnZXRFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9OmAsIHsgaWQsIGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlR2V0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGdldDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuXG4gICAgLy8gLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnZ2V0JywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZ2V0KGlkZW50aWZpZXJzKS5nbyh7IGF0dHJpYnV0ZXMgfSlcbiAgICApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2FmdGVyR2V0JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgR2V0RW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2guXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gcmV0cmlldmUuXG4gICAgICovXG4gICAgaWRzOiBBcnJheTxPcHNTY2hlbWFbICdnZXQnIF0+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmV0cmlldmVkIGVudGl0aWVzLlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqL1xuICAgIGNvbmN1cnJlbnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgcmV0cmlldmluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRCYXRjaEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRCYXRjaEVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkcyxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgY29uY3VycmVudCA9IDEsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdnZXQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpnZXRCYXRjaEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZHMsIGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZvciBhbGwgaXRlbXMgaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlkcy5tYXAoaWQgPT4gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuICAgIC8vIFZhbGlkYXRlIGVhY2ggaXRlbSBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCB2YWxpZGF0aW9ucyA9IGF3YWl0IFByb21pc2UuYWxsKGlkZW50aWZpZXJzQmF0Y2gubWFwKGFzeW5jIGlkZW50aWZpZXJzID0+XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhY3RvcjogYWN0b3JcbiAgICAgICAgfSlcbiAgICApKTtcblxuICAgIC8vIENoZWNrIGZvciB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uc1xuICAgICAgICAubWFwKCh2YWxpZGF0aW9uLCBpbmRleCkgPT4gKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgdmFsaWRhdGlvbiB9KSA9PiAhdmFsaWRhdGlvbi5wYXNzKTtcblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uRXJyb3JzLmZsYXRNYXAoKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkgPT5cbiAgICAgICAgICAgICh2YWxpZGF0aW9uLmVycm9ycyB8fCBbXSkubWFwKGVycm9yID0+ICh7XG4gICAgICAgICAgICAgICAgLi4uZXJyb3IsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYEl0ZW0gJHtpbmRleH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgKSk7XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBiYXRjaCBnZXQgb3BlcmF0aW9uIHdpdGggY29uY3VycmVuY3kgY29udHJvbFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2JhdGNoR2V0JywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZ2V0KGlkZW50aWZpZXJzQmF0Y2gpLmdvKHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgIH0pLFxuICAgICAgICB7IGl0ZW1Db3VudDogaWRlbnRpZmllcnNCYXRjaC5sZW5ndGggfVxuICAgICk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZ2V0QmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWRzOmAsIGlkcyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBkYXRhOiBBcnJheS5pc0FycmF5KHJlc3VsdC5kYXRhKSA/IHJlc3VsdC5kYXRhIDogKHJlc3VsdC5kYXRhID8gWyByZXN1bHQuZGF0YSBdIDogW10pLFxuICAgICAgICB1bnByb2Nlc3NlZDogW10gIC8vIEVsZWN0cm9EQiBkb2Vzbid0IHN1cHBvcnQgdW5wcm9jZXNzZWQgaXRlbXMgdHJhY2tpbmcsIHNvIHdlIHJldHVybiBlbXB0eSBhcnJheVxuICAgIH07XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBjcmVhdGluZyBhbiBlbnRpdHkuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ3JlYXRlRW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGF0YSBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICdjcmVhdGUnIF07XG59XG5cbmV4cG9ydCB0eXBlIENyZWF0ZUVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGVudGl0eSB1c2luZyB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eS5cbiAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gZGF0YSBpcyBwcm92aWRlZCBmb3IgY3JlYXRlIG9wZXJhdGlvbiwgdmFsaWRhdGlvbiBmYWlscywgb3IgYXV0aG9yaXphdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBDcmVhdGVFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxDcmVhdGVFbnRpdHlSZXNwb25zZTxTPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2NyZWF0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmNyZWF0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IGNyZWF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEpO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIGNyZWF0ZSBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgLy8gcHJlIGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2JlZm9yZUNyZWF0ZScsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGRhdGEsXG4gICAgICAgIGFjdG9yOiBhY3RvcixcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3IgXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHsgZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciBjcmVhdGU6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdjcmVhdGUnLCAoKSA9PlxuICAgICAgICBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS5jcmVhdGUoZGF0YSkuZ28oKVxuICAgICk7XG5cbiAgICAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyQ3JlYXRlJywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IGNyZWF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEsIGVudGl0eS5kYXRhKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgQ3JlYXRlRW50aXR5UmVzcG9uc2U8Uz47XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGNyZWF0aW5nLU9SLXVwZGF0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVcHNlcnRFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBkYXRhIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqL1xuICAgIGRhdGE6IE9wc1NjaGVtYVsgJ3Vwc2VydCcgXTtcbn1cblxuZXhwb3J0IHR5cGUgVXBzZXJ0RW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxuICAgIHdhc0NyZWF0ZWQ/OiBib29sZWFuICAvLyB0cnVlIGlmIHJlY29yZCB3YXMgY3JlYXRlZCwgZmFsc2UgaWYgYWxyZWFkeSBleGlzdGVkXG4gICAgb2xkRGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD4gIC8vIHByZXZpb3VzIGRhdGEgaWYgaXQgd2FzIGFuIHVwZGF0ZSAodW5kZWZpbmVkIGZvciBjcmVhdGVzKVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gZW50aXR5IHVzaW5nIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMgVGhlIGNyZWF0ZWQgZW50aXR5IHdpdGggd2FzQ3JlYXRlZCBmbGFnIGluZGljYXRpbmcgaWYgaXQgd2FzIGEgbmV3IHJlY29yZC5cbiAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gZGF0YSBpcyBwcm92aWRlZCBmb3IgdXBzZXJ0IG9wZXJhdGlvbiwgdmFsaWRhdGlvbiBmYWlscywgb3IgYXV0aG9yaXphdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwc2VydEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBVcHNlcnRFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxVcHNlcnRFbnRpdHlSZXNwb25zZTxTPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ3Vwc2VydCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwc2VydEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEpO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIHVwc2VydCBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgLy8gcHJlIGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2JlZm9yZVVwc2VydCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGRhdGEsXG4gICAgICAgIGFjdG9yOiBhY3RvcixcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3IgXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHsgZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciB1cHNlcnQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBVc2UgXCJhbGxfb2xkXCIgdG8gZ2V0IHRoZSBwcmV2aW91cyBpdGVtIHN0YXRlIC0gYWxsb3dzIHVzIHRvIGRldGVjdCBjcmVhdGUgdnMgdXBkYXRlXG4gICAgLy8gSWYgb2xkRGF0YSBpcyBlbXB0eS9udWxsLCBpdCB3YXMgYSBDUkVBVEUuIElmIGl0IGhhcyBkYXRhLCBpdCB3YXMgYW4gVVBEQVRFLlxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3Vwc2VydCcsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLnVwc2VydChkYXRhIGFzIGFueSkuZ28oeyByZXNwb25zZTogXCJhbGxfb2xkXCIgfSlcbiAgICApO1xuXG4gICAgY29uc3Qgd2FzQ3JlYXRlZCA9ICFlbnRpdHkuZGF0YSB8fCBPYmplY3Qua2V5cyhlbnRpdHkuZGF0YSkubGVuZ3RoID09PSAwO1xuICAgIGNvbnN0IG9sZERhdGEgPSB3YXNDcmVhdGVkID8gdW5kZWZpbmVkIDogZW50aXR5LmRhdGE7XG5cbiAgICAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyVXBzZXJ0JywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiB3YXNDcmVhdGVkOiAke3dhc0NyZWF0ZWR9YCk7XG5cbiAgICAvLyBOb3RlOiB3aXRoIFwiYWxsX29sZFwiLCBlbnRpdHkuZGF0YSBjb250YWlucyB0aGUgT0xEIGRhdGEsIHdlIG5lZWQgdG8gcmV0dXJuIHRoZSBORVcgZGF0YVxuICAgIC8vIFNpbmNlIHdlIGRvbid0IGhhdmUgdGhlIG5ldyBkYXRhIGZyb20gRHluYW1vREIsIHdlIHJldHVybiB0aGUgaW5wdXQgZGF0YSBhcyB0aGUgbmV3IGRhdGFcbiAgICByZXR1cm4ge1xuICAgICAgICBkYXRhOiBkYXRhIGFzIGFueSwgIC8vIFRoZSBuZXcgZGF0YSB3ZSBqdXN0IHVwc2VydGVkXG4gICAgICAgIHdhc0NyZWF0ZWQsXG4gICAgICAgIG9sZERhdGFcbiAgICB9IGFzIFVwc2VydEVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgbGlzdGluZyBlbnRpdGllcy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExpc3RFbnRpdHlBcmdzPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgcXVlcnk6IEVudGl0eVF1ZXJ5PFNjaD5cbn1cblxuLyoqXG4gKiBPcGVyYXRvcnMgdGhhdCBzaG91bGQgTk9UIGJlIHVzZWQgZm9yIGluZGV4IG1hdGNoaW5nLlxuICogVGhlc2Ugb3BlcmF0b3JzIGxvb2sgZm9yIHJlY29yZHMgd2hlcmUgdGhlIGF0dHJpYnV0ZSBkb2Vzbid0IGV4aXN0IG9yIGlzIGVtcHR5LFxuICogYnV0IHRob3NlIHJlY29yZHMgd29uJ3QgYmUgaW4gYSBzcGFyc2UgR1NJIHdoZXJlIHRoYXQgYXR0cmlidXRlIGlzIHRoZSBQSy5cbiAqL1xuY29uc3QgSU5ERVhfRVhDTFVERURfT1BFUkFUT1JTID0gbmV3IFNldChbXG4gICAgJ25vdEV4aXN0cycsICdleGlzdHMnLCAnaXNOdWxsJywgJ25vdE51bGwnLCAnZW1wdHknLCAnbm90RW1wdHknXG5dKTtcblxuLyoqXG4gKiBDb252ZXJ0IEZpbHRlckdyb3VwIGZvcm1hdCB0byBzaW1wbGUgb2JqZWN0IGZvcm1hdCBmb3IgaW5kZXggbWF0Y2hpbmcuXG4gKiBGaWx0ZXJHcm91cDogeyBhbmQ6IFt7IGF0dHJpYnV0ZTogJ2ZvbycsIGVxOiAnYmFyJyB9XSB9XG4gKiBTaW1wbGU6IHsgZm9vOiB7IGVxOiAnYmFyJyB9IH1cbiAqIFxuICogT25seSBleHRyYWN0cyBmaWx0ZXJzIGZyb20gdGhlICdhbmQnIGFycmF5IGFzIHRob3NlIGFyZSB0aGUgb25lc1xuICogdGhhdCBjYW4gYmUgdXNlZCBmb3IgR1NJIHBhcnRpdGlvbiBrZXkgbWF0Y2hpbmcuXG4gKiBcbiAqIEV4Y2x1ZGVzIGV4aXN0ZW5jZS9udWxsIGZpbHRlcnMgKG5vdEV4aXN0cywgaXNOdWxsLCBlbXB0eSwgZXRjLikgZnJvbSBpbmRleFxuICogbWF0Y2hpbmcgc2luY2UgcmVjb3JkcyB3aXRoIG1pc3NpbmcgYXR0cmlidXRlcyB3b24ndCBiZSBpbiBzcGFyc2UgR1NJcy5cbiAqIFxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVycyBpbiBGaWx0ZXJHcm91cCBvciBzaW1wbGUgZm9ybWF0XG4gKiBAcmV0dXJucyBGaWx0ZXJzIGluIHNpbXBsZSBvYmplY3QgZm9ybWF0IHsgYXR0cjogeyBvcDogdmFsIH0gfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgLy8gQWxyZWFkeSBpbiBzaW1wbGUgZm9ybWF0IG9yIGVtcHR5XG4gICAgaWYgKCFmaWx0ZXJzIHx8ICEoJ2FuZCcgaW4gZmlsdGVycykpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlcnMgfHwge307XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltcGxlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICAvLyBFeHRyYWN0IGZyb20gJ2FuZCcgYXJyYXkgLSB0aGVzZSBhcmUgQU5EIGNvbmRpdGlvbnMgdGhhdCBjb3VsZCBtYXRjaCBHU0kgUEtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgZmlsdGVycy5hbmQgfHwgW10pIHtcbiAgICAgICAgaWYgKGl0ZW0uYXR0cmlidXRlKSB7XG4gICAgICAgICAgICBjb25zdCBvcGVyYXRvcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoaXRlbSkpIHtcbiAgICAgICAgICAgICAgICAvLyBTa2lwIHRoZSAnYXR0cmlidXRlJyBrZXkgYW5kIGV4Y2x1ZGUgZXhpc3RlbmNlL251bGwgb3BlcmF0b3JzIGZyb20gaW5kZXggbWF0Y2hpbmdcbiAgICAgICAgICAgICAgICAvLyBSZWNvcmRzIHdpdGggbWlzc2luZyBhdHRyaWJ1dGVzIHdvbid0IGJlIGluIHNwYXJzZSBHU0lzXG4gICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gJ2F0dHJpYnV0ZScgJiYgIUlOREVYX0VYQ0xVREVEX09QRVJBVE9SUy5oYXMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBvcGVyYXRvcnNbIGtleSBdID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKG9wZXJhdG9ycykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHNpbXBsZVsgaXRlbS5hdHRyaWJ1dGUgXSA9IG9wZXJhdG9ycztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzaW1wbGU7XG59XG5cbi8qKlxuICogRXJyb3IgdGhyb3duIHdoZW4gaW52YWxpZCBmaWx0ZXIgb3BlcmF0b3JzIGFyZSB1c2VkIGluIGluZGV4LmZpbHRlcnMuXG4gKi9cbmV4cG9ydCBjbGFzcyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGludmFsaWRPcGVyYXRvcnM6IHN0cmluZ1tdLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgaW5kZXhOYW1lPzogc3RyaW5nXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IGluZGV4Q29udGV4dCA9IGluZGV4TmFtZSA/IGAgZm9yIGluZGV4IFwiJHtpbmRleE5hbWV9XCJgIDogJyc7XG4gICAgICAgIHN1cGVyKFxuICAgICAgICAgICAgYEludmFsaWQgZmlsdGVyIG9wZXJhdG9yKHMpIFske2ludmFsaWRPcGVyYXRvcnMuam9pbignLCAnKX1dIGZvciBhdHRyaWJ1dGUgXCIke2F0dHJpYnV0ZU5hbWV9XCIke2luZGV4Q29udGV4dH0uIGAgK1xuICAgICAgICAgICAgYEdTSSBjb21wb3NpdGUga2V5IGF0dHJpYnV0ZXMgb25seSBzdXBwb3J0IGVxdWFsaXR5IG1hdGNoZXMuIGAgK1xuICAgICAgICAgICAgYFVzZSB7ICR7YXR0cmlidXRlTmFtZX06IHsgZXE6IHZhbHVlIH0gfSBvciB7ICR7YXR0cmlidXRlTmFtZX06IHZhbHVlIH0gZm9yIGNvbXBvc2l0ZSBrZXlzLiBgICtcbiAgICAgICAgICAgIGBGb3IgcmFuZ2Uvb3RoZXIgY29uZGl0aW9ucywgdXNlIHRvcC1sZXZlbCAnZmlsdGVycycgaW5zdGVhZCBvZiAnaW5kZXguZmlsdGVycycuYFxuICAgICAgICApO1xuICAgICAgICB0aGlzLm5hbWUgPSAnSW52YWxpZEluZGV4RmlsdGVyRXJyb3InO1xuICAgIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0cyBhbmQgdmFsaWRhdGVzIGNvbXBvc2l0ZSBrZXkgdmFsdWVzIGZyb20gaW5kZXguZmlsdGVycyBmb3IgRWxlY3Ryb0RCIGFjY2VzcyBwYXR0ZXJuIHF1ZXJpZXMuXG4gKiBcbiAqIER5bmFtb0RCIEdTSSBjb21wb3NpdGUga2V5cyBoYXZlIHNwZWNpZmljIGNvbnN0cmFpbnRzOlxuICogLSBQYXJ0aXRpb24gS2V5IChQSyk6IE1VU1QgYmUgYW4gZXF1YWxpdHkgbWF0Y2hcbiAqIC0gU29ydCBLZXkgKFNLKTogQ2FuIHVzZSByYW5nZSBvcGVyYXRvcnMsIGJ1dCB0aG9zZSBnbyBpbiB0b3AtbGV2ZWwgYGZpbHRlcnNgXG4gKiBcbiAqIFRoaXMgZnVuY3Rpb246XG4gKiAxLiBWYWxpZGF0ZXMgdGhhdCBvbmx5IGVxdWFsaXR5IG9wZXJhdG9ycyBhcmUgdXNlZFxuICogMi4gQ29udmVydHMgRlcyNCBmaWx0ZXIgc3ludGF4IHRvIEVsZWN0cm9EQiBmb3JtYXRcbiAqIDMuIFRIUk9XUyBpZiBpbnZhbGlkIG9wZXJhdG9ycyBhcmUgZGV0ZWN0ZWQgKGZhaWwgZmFzdCwgbm90IHNpbGVudGx5KVxuICogXG4gKiBAcGFyYW0gZmlsdGVycyAtIEZpbHRlcnMgZnJvbSBpbmRleC5maWx0ZXJzIChvbmx5IGVxdWFsaXR5IGFsbG93ZWQpXG4gKiBAcGFyYW0gaW5kZXhOYW1lIC0gTmFtZSBvZiB0aGUgaW5kZXggKGZvciBlcnJvciBtZXNzYWdlcylcbiAqIEByZXR1cm5zIENvbXBvc2l0ZSBrZXkgdmFsdWVzIGluIEVsZWN0cm9EQiBmb3JtYXRcbiAqIEB0aHJvd3MgSW52YWxpZEluZGV4RmlsdGVyRXJyb3IgaWYgbm9uLWVxdWFsaXR5IG9wZXJhdG9ycyBhcmUgdXNlZFxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gVmFsaWQgaW5wdXRzXG4gKiB7IHRlYW1JZDogeyBlcTogJ3RlYW0tMTIzJyB9IH0gIOKGkiAgeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfVxuICogeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfSAgICAgICAgIOKGkiAgeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfVxuICogXG4gKiAvLyBJbnZhbGlkIC0gd2lsbCBUSFJPV1xuICogeyBjcmVhdGVkQXQ6IHsgZ3Q6ICcyMDI0LTAxLTAxJyB9IH0gIC8vIEludmFsaWRJbmRleEZpbHRlckVycm9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBpbmRleE5hbWU/OiBzdHJpbmdcbik6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGlmICghZmlsdGVycykgcmV0dXJuIHt9O1xuXG4gICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGZpbHRlcnMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERpcmVjdCB2YWx1ZSAoc2hvcnRoYW5kIGZvciBlcXVhbGl0eSlcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGZpbHRlciBvcGVyYXRvciBvYmplY3RzXG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IE9iamVjdC5rZXlzKHZhbHVlKTtcblxuICAgICAgICBpZiAob3BlcmF0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5ICdlcScgaXMgdmFsaWQgZm9yIGNvbXBvc2l0ZSBrZXkgYXR0cmlidXRlc1xuICAgICAgICBpZiAodmFsdWUuZXEgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIG1peGVkIG9wZXJhdG9ycyAoZXEgKyBvdGhlcnMpIC0gdGhhdCdzIGEgbWlzdGFrZVxuICAgICAgICAgICAgY29uc3Qgb3RoZXJPcHMgPSBvcGVyYXRvcnMuZmlsdGVyKG9wID0+IG9wICE9PSAnZXEnKTtcbiAgICAgICAgICAgIGlmIChvdGhlck9wcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRJbmRleEZpbHRlckVycm9yKGtleSwgb3RoZXJPcHMsIGluZGV4TmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWUuZXE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBOb24tZXF1YWxpdHkgb3BlcmF0b3JzIC0gdGhyb3cgaW1tZWRpYXRlbHlcbiAgICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcihrZXksIG9wZXJhdG9ycywgaW5kZXhOYW1lKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogRmluZHMgYSBtYXRjaGluZyBpbmRleCBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgZmlsdGVycyBhbmQgc2NoZW1hLlxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gZmlsdGVycyAtIFRoZSBmaWx0ZXJzIHRvIG1hdGNoIGFnYWluc3RcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGVudGl0eVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBUaGUgZW50aXR5IHNlcnZpY2VcbiAqIEByZXR1cm5zIFRoZSBuYW1lIG9mIHRoZSBtYXRjaGluZyBpbmRleCBhbmQgdGhlIGZpbHRlcnMgdXNlZCB0byBtYXRjaCBpdCBvciB1bmRlZmluZWQgaWYgbm8gbWF0Y2ggaXMgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbmRNYXRjaGluZ0luZGV4KFxuICAgIHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxhbnk+XG4pOiB7IGluZGV4TmFtZTogc3RyaW5nOyBpbmRleEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZmluZE1hdGNoaW5nSW5kZXgnKTtcbiAgICBpZiAoIWZpbHRlcnMpIGZpbHRlcnMgPSB7fTtcblxuICAgIC8vIENvbnZlcnQgRmlsdGVyR3JvdXAgZm9ybWF0IHRvIHNpbXBsZSBmb3JtYXQgZm9yIGluZGV4IG1hdGNoaW5nXG4gICAgY29uc3Qgc2ltcGxlRmlsdGVycyA9IGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVycyk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb252ZXJ0ZWQgZmlsdGVycyBmb3IgaW5kZXggbWF0Y2hpbmc6YCwgeyBvcmlnaW5hbDogZmlsdGVycywgc2ltcGxlOiBzaW1wbGVGaWx0ZXJzIH0pO1xuXG4gICAgLy8gRmlyc3QgdHJ5IEVsZWN0cm9EQidzIGluZGV4IG1hdGNoaW5nXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuICAgIGNvbnN0IHsga2V5cywgaW5kZXgsIHNob3VsZFNjYW4gfSA9IChyZXBvc2l0b3J5IGFzIGFueSkuX2ZpbmRCZXN0SW5kZXhLZXlNYXRjaChzaW1wbGVGaWx0ZXJzKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgRm91bmQgRWxlY3Ryb0RCIGluZGV4OiAke2luZGV4fSB3aXRoICR7a2V5cy5sZW5ndGh9IGF0dHJpYnV0ZSBtYXRjaGVzIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0gd2l0aCBmaWx0ZXJzIGFuZCBzY2FuOiAke3Nob3VsZFNjYW59IC0gYCwga2V5cywgc2ltcGxlRmlsdGVycyk7XG5cbiAgICAvLyBJZiB3ZSBmb3VuZCBhIG1hdGNoaW5nIGluZGV4LCB1c2UgaXRcbiAgICBpZiAoIXNob3VsZFNjYW4pIHtcbiAgICAgICAgY29uc3QgaW5kZXhGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICAgICAgLy8gQWRkIG1hdGNoZWQga2V5cyB0byBpbmRleEZpbHRlcnMgKHVzZSBzaW1wbGVGaWx0ZXJzIHdoaWNoIGhhcyB0aGUgcmlnaHQgZm9ybWF0KVxuICAgICAgICBrZXlzLmZvckVhY2goKGtleTogeyBuYW1lOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJWYWx1ZSA9IHNpbXBsZUZpbHRlcnNbIGtleS5uYW1lIF07XG4gICAgICAgICAgICBpZiAoZmlsdGVyVmFsdWUpIHtcbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgYm90aCB7IGVxOiB2YWx1ZSB9IGFuZCBkaXJlY3QgdmFsdWUgZm9ybWF0c1xuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyc1sga2V5Lm5hbWUgXSA9IGZpbHRlclZhbHVlLmVxICE9PSB1bmRlZmluZWQgPyBmaWx0ZXJWYWx1ZS5lcSA6IGZpbHRlclZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBNYXAgRWxlY3Ryb0RCJ3MgaW50ZXJuYWwgaW5kZXggbmFtZSBiYWNrIHRvIG91ciBzY2hlbWEncyBpbmRleCBuYW1lXG4gICAgICAgIGxldCBzY2hlbWFJbmRleE5hbWUgPSBpbmRleDtcbiAgICAgICAgaWYgKGluZGV4ID09PSAnJykge1xuICAgICAgICAgICAgc2NoZW1hSW5kZXhOYW1lID0gJ3ByaW1hcnknO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmluZCB0aGUgaW5kZXggaW4gb3VyIHNjaGVtYSB0aGF0IG1hdGNoZXMgdGhpcyBHU0lcbiAgICAgICAgICAgIGNvbnN0IGluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBuYW1lLCBpbmRleERlZiBdIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4ZXMpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGluZGV4RGVmLmluZGV4ID09PSBpbmRleCkge1xuICAgICAgICAgICAgICAgICAgICBzY2hlbWFJbmRleE5hbWUgPSBuYW1lO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBsb2dnZXIuZGVidWcoYFVzaW5nIEVsZWN0cm9EQiBtYXRjaGVkIGluZGV4OiAke3NjaGVtYUluZGV4TmFtZX0gKGludGVybmFsOiAke2luZGV4fSkgd2l0aCAke2tleXMubGVuZ3RofSBhdHRyaWJ1dGUgbWF0Y2hlcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9IHdpdGggZmlsdGVyczpgLCBpbmRleEZpbHRlcnMpO1xuICAgICAgICByZXR1cm4geyBpbmRleE5hbWU6IHNjaGVtYUluZGV4TmFtZSwgaW5kZXhGaWx0ZXJzIH07XG4gICAgfVxuXG4gICAgLy8gSWYgbm8gaW5kZXggbWF0Y2ggZm91bmQsIGNoZWNrIGZvciB0ZW1wbGF0ZSBtYXRjaCBvciBcImFsbCByZWNvcmRzXCIgaW5kZXhcbiAgICBjb25zdCBpbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgZm9yIChjb25zdCBbIGluZGV4TmFtZSwgaW5kZXhEZWYgXSBvZiBPYmplY3QuZW50cmllcyhpbmRleGVzKSkge1xuICAgICAgICBpZiAoaW5kZXhEZWYucGsudGVtcGxhdGUgJiYgdHlwZW9mIGluZGV4RGVmLnBrLnRlbXBsYXRlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgLy8gRW50aXR5LXNwZWNpZmljIHRlbXBsYXRlIG1hdGNoXG4gICAgICAgICAgICBpZiAoaW5kZXhEZWYucGsudGVtcGxhdGUudG9Mb3dlckNhc2UoKSA9PT0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyB0ZW1wbGF0ZSBtYXRjaGluZyBpbmRleDogJHtpbmRleE5hbWV9IGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBcIkFsbCByZWNvcmRzXCIgaW5kZXggcGF0dGVybiAtIGNvbnN0YW50IFBLIHdpdGggZW1wdHkgY29tcG9zaXRlXG4gICAgICAgICAgICAvLyBVc2VmdWwgZm9yIHNvcnRlZCBsaXN0aW5ncyB3aXRob3V0IGZpbHRlcnMgKGUuZy4sIEFMTF9FVkVOVFMsIEFMTF9MT0dTKVxuICAgICAgICAgICAgaWYgKGluZGV4RGVmLnBrLmNvbXBvc2l0ZSAmJiBpbmRleERlZi5way5jb21wb3NpdGUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBcImFsbCByZWNvcmRzXCIgaW5kZXg6ICR7aW5kZXhOYW1lfSB3aXRoIGNvbnN0YW50IFBLIHRlbXBsYXRlOiAke2luZGV4RGVmLnBrLnRlbXBsYXRlfWApO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgbGlzdGluZyBlbnRpdGllcy5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIGFycmF5IG9mIGVudGl0aWVzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBMaXN0RW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnbGlzdCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmxpc3RFbnRpdHknKSxcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICAgICAgcXVlcnkgPSB7fSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZmlsdGVycyA9IHt9LFxuICAgICAgICBhdHRyaWJ1dGVzID0gW10sXG4gICAgICAgIHBhZ2luYXRpb24gPSB7IG9yZGVyOiAnYXNjJywgcGFnZXI6ICdjdXJzb3InLCBjdXJzb3I6IG51bGwsIGNvdW50OiAyNSwgcGFnZXM6IHVuZGVmaW5lZCwgbGltaXQ6IHVuZGVmaW5lZCB9LFxuICAgICAgICBpbmRleDogc3BlY2lmaWVkSW5kZXhcbiAgICB9ID0gcXVlcnk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gbGlzdEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVMaXN0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IGV4dHJhY3RJbmRleEZpbHRlclZhbHVlcyhzcGVjaWZpZWRJbmRleC5maWx0ZXJzLCBzcGVjaWZpZWRJbmRleC5uYW1lKSB9XG4gICAgICAgIDogZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCBlbnRpdHlOYW1lLCBlbnRpdHlTZXJ2aWNlKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgTWF0Y2ggcmVzdWx0OmAsIG1hdGNoUmVzdWx0KTtcbiAgICAvLyBVc2UgdGhlIGFwcHJvcHJpYXRlIGluZGV4IGlmIGF2YWlsYWJsZVxuICAgIGNvbnN0IHJlcG9zaXRvcnkgPSBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKTtcblxuICAgIGxldCBlbnRpdGllcztcbiAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgLy8gVXNlIGluZGV4IHF1ZXJ5IGlmIHdlIGhhdmUgYSBtYXRjaFxuICAgICAgICBjb25zdCBpbmRleFF1ZXJ5ID0gcmVwb3NpdG9yeS5xdWVyeVsgbWF0Y2hSZXN1bHQuaW5kZXhOYW1lIF0obWF0Y2hSZXN1bHQuaW5kZXhGaWx0ZXJzKTtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIGluZGV4UXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2xpc3QnLCAoKSA9PlxuICAgICAgICAgICAgaW5kZXhRdWVyeS5nbyh7IGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXMgYXMgYW55LCAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSB9KSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgaW5kZXhOYW1lOiBtYXRjaFJlc3VsdC5pbmRleE5hbWUsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVzZSBtYXRjaCBmb3IgZnVsbCBzY2FuXG4gICAgICAgIGxvZ2dlci53YXJuKGBXQVJOSU5HOiBObyBtYXRjaGluZyBpbmRleCBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9LCB1c2luZyBtYXRjaCBmb3IgZnVsbCBzY2FuYCwgZmlsdGVycyk7XG5cbiAgICAgICAgLy8gVHJhY2sgZnVsbCBzY2FuIC0gQ1JJVElDQUw6IGV4cGVuc2l2ZSBwZXJmb3JtYW5jZS9jb3N0IGlzc3VlXG4gICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChgZW50aXR5LmZ1bGxfc2NhbmAsIDEsIHtcbiAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZSwgb3BlcmF0aW9uOiAnbGlzdCcgfSxcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBjaGVja3BvaW50IGZvciB2aXNpYmlsaXR5XG4gICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAnZGIuZW50aXR5X25hbWUnOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICdkYi5vcGVyYXRpb24nOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgJ2RiLndhcm5pbmcnOiAnbm9faW5kZXhfZm91bmQnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAnZGIuZnVsbF9zY2FuJzogMSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkYXRhOiB7IGZ1bGxTY2FuRmlsdGVyczogZmlsdGVycyB8fCB7fSB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBzY2FuUXVlcnkgPSByZXBvc2l0b3J5LnNjYW47XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBzY2FuUXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUT0RPOiBhZGQgYXR0cmlidXRlcyB0byBzY2FuIHF1ZXJ5XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnc2NhbicsICgpID0+XG4gICAgICAgICAgICBzY2FuUXVlcnkuZ28ocmVtb3ZlRW1wdHkocGFnaW5hdGlvbikpLFxuICAgICAgICAgICAgeyBmaWx0ZXJzLCBwYWdpbmF0aW9uIH1cbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyTGlzdCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBsaXN0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFF1ZXJ5RW50aXR5QXJnczxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIHF1ZXJ5OiBFbnRpdHlRdWVyeTxTY2g+XG59XG5cbi8qKlxuICogRXhlY3V0ZXMgYSBxdWVyeSBvbiB0aGUgc3BlY2lmaWVkIGVudGl0eS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHRoZSBxdWVyeS5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXN1bHQgb2YgdGhlIHF1ZXJ5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcXVlcnlFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogUXVlcnlFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdxdWVyeScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnF1ZXJ5RW50aXR5JyksXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgICAgIHF1ZXJ5ID0ge31cblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgY29uc3Qge1xuICAgICAgICBmaWx0ZXJzID0ge30sXG4gICAgICAgIGF0dHJpYnV0ZXMgPSBbXSxcbiAgICAgICAgcGFnaW5hdGlvbiA9IHsgb3JkZXI6ICdhc2MnLCBwYWdlcjogJ2N1cnNvcicsIGN1cnNvcjogbnVsbCwgY291bnQ6IDI1LCBwYWdlczogdW5kZWZpbmVkLCBsaW1pdDogdW5kZWZpbmVkIH0sXG4gICAgICAgIGluZGV4OiBzcGVjaWZpZWRJbmRleFxuICAgIH0gPSBxdWVyeTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBxdWVyeUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVRdWVyeScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgLy8gLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IGV4dHJhY3RJbmRleEZpbHRlclZhbHVlcyhzcGVjaWZpZWRJbmRleC5maWx0ZXJzLCBzcGVjaWZpZWRJbmRleC5uYW1lKSB9XG4gICAgICAgIDogZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCBlbnRpdHlOYW1lLCBlbnRpdHlTZXJ2aWNlKTtcblxuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAncXVlcnknLCAoKSA9PlxuICAgICAgICAgICAgaW5kZXhRdWVyeS5nbyh7IGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXMgYXMgYW55LCAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSB9KSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgaW5kZXhOYW1lOiBtYXRjaFJlc3VsdC5pbmRleE5hbWUsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVzZSBtYXRjaCBmb3IgZnVsbCBzY2FuXG4gICAgICAgIGxvZ2dlci53YXJuKGBXQVJOSU5HOiBObyBtYXRjaGluZyBpbmRleCBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9LCB1c2luZyBtYXRjaCBmb3IgZnVsbCBzY2FuYCwgZmlsdGVycyk7XG5cbiAgICAgICAgLy8gVHJhY2sgZnVsbCBzY2FuIC0gQ1JJVElDQUw6IGV4cGVuc2l2ZSBwZXJmb3JtYW5jZS9jb3N0IGlzc3VlXG4gICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChgZW50aXR5LmZ1bGxfc2NhbmAsIDEsIHtcbiAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZSwgb3BlcmF0aW9uOiAncXVlcnknIH0sXG4gICAgICAgICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgY2hlY2twb2ludCBmb3IgdmlzaWJpbGl0eVxuICAgICAgICBTcGFuT2JzZXJ2ZXIuZ2V0Q3VycmVudFNwYW4oKT8uY2hlY2twb2ludD8uKCdkYXRhYmFzZS5mdWxsX3NjYW4nLCB7XG4gICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmVudGl0eV9uYW1lJzogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAnZGIub3BlcmF0aW9uJzogJ3F1ZXJ5JyxcbiAgICAgICAgICAgICAgICAnZGIud2FybmluZyc6ICdub19pbmRleF9mb3VuZCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICdkYi5mdWxsX3NjYW4nOiAxLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRhdGE6IHsgZnVsbFNjYW5GaWx0ZXJzOiBmaWx0ZXJzIHx8IHt9IH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHNjYW5RdWVyeSA9IHJlcG9zaXRvcnkuc2NhbjtcbiAgICAgICAgaWYgKGZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QoZmlsdGVycykpIHtcbiAgICAgICAgICAgIHNjYW5RdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IGFkZCBhdHRyaWJ1dGVzIHRvIHNjYW4gcXVlcnlcbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdzY2FuJywgKCkgPT5cbiAgICAgICAgICAgIHNjYW5RdWVyeS5nbyhyZW1vdmVFbXB0eShwYWdpbmF0aW9uKSksXG4gICAgICAgICAgICB7IGZpbHRlcnMsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJRdWVyeScsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBxdWVyeUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIHJldHVybiBlbnRpdGllcztcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIHVwZGF0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVcGRhdGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIHVwZGF0ZS5cbiAgICAgKi9cbiAgICBpZDogT3BzU2NoZW1hWyAnZ2V0JyBdO1xuICAgIC8qKlxuICAgICAqIFRoZSBkYXRhIHRvIHVwZGF0ZSB0aGUgZW50aXR5IHdpdGguXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAndXBkYXRlJyBdO1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGF0dHJpYnV0ZXMgZm9yIHBhdGNoIG9wZXJhdGlvbi5cbiAgICAgKi9cbiAgICBvcGVyYXRvcnM/OiBVcGRhdGVFbnRpdHlPcGVyYXRvcnM7XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgY29uZGl0aW9ucyBmb3IgdGhlIHVwZGF0ZSBvcGVyYXRpb24uXG4gICAgICovXG4gICAgY29uZGl0aW9ucz86IGFueTsgLy8gVE9ET1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIHByZS1jYWxjdWxhdGVkIGNvbXBvc2l0ZSBrZXkgZGF0YS4gSWYgcHJvdmlkZWQsIHRoaXMgd2lsbCBiZSB1c2VkIGRpcmVjdGx5LlxuICAgICAqIElmIG5vdCBwcm92aWRlZCBhbmQgY29tcG9zaXRlIGtleXMgYXJlIG5lZWRlZCwgdGhleSB3aWxsIGJlIGNhbGN1bGF0ZWQgaW50ZXJuYWxseS5cbiAgICAgKi9cbiAgICBjb21wb3NpdGVLZXlEYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBVcGRhdGVFbnRpdHlPcGVyYXRvcnMge1xuICAgIHJlbW92ZT86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFJlc3BvbnNlIHR5cGUgZm9yIHVwZGF0ZSBlbnRpdHkgb3BlcmF0aW9uLlxuICogUHJvdmlkZXMgYSB0eXBlZCB3cmFwcGVyIGZvciB0aGUgZWxlY3Ryb2RiIHVwZGF0ZSByZXNwb25zZS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgdHlwZSBVcGRhdGVFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbmludGVyZmFjZSBQcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0FyZ3M8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICBlbnRpdHlTZXJ2aWNlOiBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8Uz47XG4gICAgaWRlbnRpZmllcnM6IFJlY29yZDxzdHJpbmcsIGFueT47XG4gICAgZGF0YTogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXM6IFNldDxzdHJpbmc+O1xuICAgIGxvZ2dlcjogSUxvZ2dlcjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNGb3JVcGRhdGU8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgYXJnczogUHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNBcmdzPFM+XG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGlkZW50aWZpZXJzLFxuICAgICAgICBkYXRhLFxuICAgICAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgIGxvZ2dlcixcbiAgICB9ID0gYXJncztcblxuICAgIGNvbnN0IGNvbXBvc2l0ZUtleVZhbHVlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGNvbnN0IGF0dHJpYnV0ZXNUb0ZldGNoID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgY29uc3QgZGF0YUFzUmVjb3JkID0gZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+OyAvLyBDYXN0IGZvciBkeW5hbWljIGFjY2Vzc1xuXG4gICAgaWYgKHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcy5zaXplID09PSAwKSB7XG4gICAgICAgIHJldHVybiB7fTsgLy8gTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgbmVlZGVkXG4gICAgfVxuXG4gICAgLy8gb25seSBpbmNsdWRlIHdoYXQncyBub3QgYWxyZWFkeSBpbiBkYXRhIG9yIGlkZW50aWZpZXJzXG4gICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmZvckVhY2goYXR0ciA9PiB7XG4gICAgICAgIGlmICghZGF0YUFzUmVjb3JkLmhhc093blByb3BlcnR5KGF0dHIpICYmICFpZGVudGlmaWVycy5oYXNPd25Qcm9wZXJ0eShhdHRyKSkge1xuICAgICAgICAgICAgYXR0cmlidXRlc1RvRmV0Y2guYWRkKGF0dHIpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoYXR0cmlidXRlc1RvRmV0Y2guc2l6ZSA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBOZWVkIHRvIGZldGNoIGF0dHJpYnV0ZXMgZm9yIGNvbXBvc2l0ZSBrZXlzOmAsIEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmdSZWNvcmRDb250YWluZXIgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKVxuICAgICAgICAgICAgICAgIC5nZXQoaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgLmdvKHsgYXR0cmlidXRlczogQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCksIGNvbnNpc3RlbnRSZWFkOiB0cnVlIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlY29yZERhdGEgPSBleGlzdGluZ1JlY29yZENvbnRhaW5lci5kYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIGlmICghZXhpc3RpbmdSZWNvcmREYXRhKSB7XG5cbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgTm8gZXhpc3RpbmcgcmVjb3JkIGZvdW5kIGZvciBjb21wb3NpdGUga2V5czpgLCBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSk7XG5cbiAgICAgICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzVG9GZXRjaC5mb3JFYWNoKGF0dHIgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3RpbmdSZWNvcmREYXRhLmhhc093blByb3BlcnR5KGF0dHIpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb3NpdGVLZXlWYWx1ZXNbIGF0dHIgXSA9IGV4aXN0aW5nUmVjb3JkRGF0YVsgYXR0ciBdO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYENvbXBvc2l0ZSBrZXkgYXR0cmlidXRlIFwiJHthdHRyfVwiIChJRDogJHtKU09OLnN0cmluZ2lmeShpZGVudGlmaWVycyl9KSB3YXMgbm90IGZvdW5kIGluIHBheWxvYWQsIGlkZW50aWZpZXJzLCBvciBleGlzdGluZyByZWNvcmQuYCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGBFcnJvciBmZXRjaGluZyBhdHRyaWJ1dGVzIGZvciBjb21wb3NpdGUga2V5cyAoSUQ6ICR7SlNPTi5zdHJpbmdpZnkoaWRlbnRpZmllcnMpfSk6YCwgZXJyb3IpO1xuXG4gICAgICAgICAgICAvLyBUcmFjayBkYXRhYmFzZSBlcnJvciBtZXRyaWNcbiAgICAgICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChgZW50aXR5LmNvbXBvc2l0ZV9rZXkuZmV0Y2hfZXJyb3JgLCAxLCB7XG4gICAgICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lOiBhcmdzLmVudGl0eU5hbWUgfSxcbiAgICAgICAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGxvZ2dlci5kZWJ1ZyhgUHJlcGFyZWQgY29tcG9zaXRlIGtleSB2YWx1ZXM6YCwgY29tcG9zaXRlS2V5VmFsdWVzKTtcbiAgICByZXR1cm4gY29tcG9zaXRlS2V5VmFsdWVzO1xufVxuXG4vKipcbiAqIFVwZGF0ZXMgYW4gZW50aXR5IGluIHRoZSBkYXRhYmFzZS5cbiAqIFxuICogQHRlbXBsYXRlIFMgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHBhcmFtIHtVcGRhdGVFbnRpdHlBcmdzPFM+fSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxVcGRhdGVFbnRpdHlSZXNwb25zZTxTPj59IC0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHVwZGF0ZWQgZW50aXR5LlxuICogQHRocm93cyB7RXJyb3J9IC0gSWYgbm8gZGF0YSBpcyBwcm92aWRlZCBmb3IgdGhlIHVwZGF0ZSBvcGVyYXRpb24sIG9yIGlmIHZhbGlkYXRpb24gb3IgYXV0aG9yaXphdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBVcGRhdGVFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxVcGRhdGVFbnRpdHlSZXNwb25zZTxTPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgaWQsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIG9wZXJhdG9ycyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcbiAgICAgICAgY3J1ZFR5cGUgPSAndXBkYXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6dXBkYXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuICAgICAgICBjb21wb3NpdGVLZXlEYXRhLFxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwZGF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIHsgZGF0YSwgcHJvdmlkZWRDb21wb3NpdGVLZXlEYXRhOiBjb21wb3NpdGVLZXlEYXRhIH0pO1xuXG4gICAgaWYgKCFkYXRhKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIHVwZGF0ZSBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgLy8gcHJlIGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2JlZm9yZVVwZGF0ZScsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGRhdGEsXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBpZGVudGlmaWVycywgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIHVwZGF0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIC0tLSBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgIGlmIChzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICBmb3IgKGNvbnN0IGluZGV4TmFtZSBpbiBzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICAgICAgY29uc3QgaW5kZXhEZWZpbml0aW9uID0gc2NoZW1hLmluZGV4ZXNbIGluZGV4TmFtZSBdO1xuICAgICAgICAgICAgaWYgKGluZGV4RGVmaW5pdGlvbikge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBrQ29tcG9zaXRlID0gaW5kZXhEZWZpbml0aW9uLnBrPy5jb21wb3NpdGU7XG4gICAgICAgICAgICAgICAgaWYgKHBrQ29tcG9zaXRlICYmIEFycmF5LmlzQXJyYXkocGtDb21wb3NpdGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHBrQ29tcG9zaXRlLmZvckVhY2goYXR0ciA9PiBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcy5hZGQoYXR0cikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb25zdCBza0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5zaz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChza0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHNrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBza0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREI6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIGlmIChhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcy5zaXplID4gMCkge1xuICAgICAgICBpZiAoY29tcG9zaXRlS2V5RGF0YSAmJiB0eXBlb2YgY29tcG9zaXRlS2V5RGF0YSA9PT0gJ29iamVjdCcpIHtcblxuICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBwcm92aWRlZCBjb21wb3NpdGVLZXlEYXRhIGZvciB1cGRhdGUuYCwgY29tcG9zaXRlS2V5RGF0YSk7XG5cbiAgICAgICAgICAgIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCID0gY29tcG9zaXRlS2V5RGF0YTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBjb3ZlcnMgYWxsIGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzXG4gICAgICAgICAgICBjb25zdCBtaXNzaW5nRnJvbVByb3ZpZGVkID0gQXJyYXkuZnJvbShhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcykuZmlsdGVyKGF0dHIgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICFkYXRhLmhhc093blByb3BlcnR5KGF0dHIpXG4gICAgICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgICAgICFpZGVudGlmaWVycy5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChtaXNzaW5nRnJvbVByb3ZpZGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgUHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBpcyBtaXNzaW5nIHNvbWUgcmVxdWlyZWQgY29tcG9zaXRlIGF0dHJpYnV0ZXM6ICR7bWlzc2luZ0Zyb21Qcm92aWRlZC5qb2luKCcsICcpfS4gVXBkYXRlIG1heSBmYWlsIGlmIHRoZXNlIGFyZSBuZWVkZWQgYnkgRWxlY3Ryb0RCLmApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlS2V5RGF0YSBwcm92aWRlZCwgcHJlcGFyaW5nIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzIGludGVybmFsbHkuIFJlcXVpcmVkOmAsIEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpKTtcblxuICAgICAgICAgICAgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIgPSBhd2FpdCBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBkYXRhOiBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT4sXG4gICAgICAgICAgICAgICAgcmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzOiBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICBsb2dnZXIsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBObyBjb21wb3NpdGUgYXR0cmlidXRlcyBkZWZpbmVkIGluIHNjaGVtYSBvciBuZWVkZWQgZm9yIHRoaXMgdXBkYXRlLmApO1xuICAgIH1cbiAgICAvLyAtLS0gRW5kIENvbXBvc2l0ZSBLZXkgSGFuZGxpbmcgLS0tXG5cblxuXG4gICAgLy8gVXNlIEVsZWN0cm9EQiBmb3IgYWxsIGZpZWxkcyBpbmNsdWRpbmcgX2FjdG9yIChub3cgaW4gc2NoZW1hKVxuICAgIGNvbnN0IHF1ZXJ5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkucGF0Y2goaWRlbnRpZmllcnMpLnNldChkYXRhKTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQikubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYFVzaW5nIGNvbXBvc2l0ZSB2YWx1ZXMgZm9yIEVsZWN0cm9EQiBwYXRjaDpgLCBmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQik7XG4gICAgICAgIHF1ZXJ5LmNvbXBvc2l0ZShmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQik7XG4gICAgfVxuXG4gICAgaWYgKG9wZXJhdG9ycz8ucmVtb3ZlKSB7XG4gICAgICAgIHF1ZXJ5LnJlbW92ZShvcGVyYXRvcnMucmVtb3ZlIGFzIGFueSk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAndXBkYXRlJywgKCkgPT5cbiAgICAgICAgcXVlcnkuZ28oKVxuICAgICk7XG5cbiAgICAvLyAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyVXBkYXRlJywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwZGF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBkYXRhOmAsIGRhdGEsIGVudGl0eS5kYXRhKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgVXBkYXRlRW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogdGhlIGFyZ3VtZW50cyBmb3IgZGVsZXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElEIG9mIHRoZSBlbnRpdHkgdG8gYmUgZGVsZXRlZC5cbiAgICAgKi9cbiAgICBpZDogT3BzU2NoZW1hWyAnZGVsZXRlJyBdO1xufVxuXG4vKipcbiAqIFJlc3BvbnNlIHR5cGUgZm9yIGRlbGV0ZSBlbnRpdHkgb3BlcmF0aW9uLlxuICogUHJvdmlkZXMgYSB0eXBlZCB3cmFwcGVyIGZvciB0aGUgZWxlY3Ryb2RiIGRlbGV0ZSByZXNwb25zZS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgdHlwZSBEZWxldGVFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbi8qKlxuICogRGVsZXRlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMgVGhlIGRlbGV0ZWQgZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlRW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IERlbGV0ZUVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPERlbGV0ZUVudGl0eVJlc3BvbnNlPFM+PiB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZGVsZXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZGVsZXRlRW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZGVsZXRlRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVEZWxldGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICBjb25zdCBpZGVudGlmaWVycyA9IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKTtcblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3JcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoe2VudGl0eU5hbWUsIGNydWRUeXBlLCBpZGVudGlmaWVycywgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgZGVsZXRlOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgIGFjdG9yOiBhY3RvclxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnZGVsZXRlJywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZGVsZXRlKGlkZW50aWZpZXJzKS5nbygpXG4gICAgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdhZnRlckRlbGV0ZScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICByZXR1cm4gZW50aXR5IGFzIERlbGV0ZUVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgYmF0Y2ggZGVsZXRpbmcgZW50aXRpZXMuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlQmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gZGVsZXRlLlxuICAgICAqL1xuICAgIGlkczogQXJyYXk8T3BzU2NoZW1hWyAnZGVsZXRlJyBdPjtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKi9cbiAgICBjb25jdXJyZW50PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIERlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgdW5wcm9jZXNzZWQgaXRlbXMgdGhhdCBjb3VsZG4ndCBiZSBkZWxldGVkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlQmF0Y2hFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogRGVsZXRlQmF0Y2hFbnRpdHlBcmdzPFM+KSB7XG4gICAgY29uc3Qge1xuICAgICAgICBpZHMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGNvbmN1cnJlbnQgPSAxLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZGVsZXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZGVsZXRlQmF0Y2hFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZGVsZXRlQmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9OmAsIHsgaWRzLCBjb25jdXJyZW50IH0pO1xuXG4gICAgLy8gRXh0cmFjdCBpZGVudGlmaWVycyBmb3IgYWxsIGl0ZW1zIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IGlkZW50aWZpZXJzQmF0Y2ggPSBpZHMubWFwKGlkID0+IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKSk7XG5cbiAgICAvLyBWYWxpZGF0ZSBlYWNoIGl0ZW0gaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgdmFsaWRhdGlvbnMgPSBhd2FpdCBQcm9taXNlLmFsbChpZGVudGlmaWVyc0JhdGNoLm1hcChhc3luYyBpZGVudGlmaWVycyA9PlxuICAgICAgICB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgICAgIH0pXG4gICAgKSk7XG5cbiAgICAvLyBDaGVjayBmb3IgdmFsaWRhdGlvbiBlcnJvcnNcbiAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbnNcbiAgICAgICAgLm1hcCgodmFsaWRhdGlvbiwgaW5kZXgpID0+ICh7IHZhbGlkYXRpb24sIGluZGV4IH0pKVxuICAgICAgICAuZmlsdGVyKCh7IHZhbGlkYXRpb24gfSkgPT4gIXZhbGlkYXRpb24ucGFzcyk7XG5cbiAgICBpZiAodmFsaWRhdGlvbkVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbkVycm9ycy5mbGF0TWFwKCh7IHZhbGlkYXRpb24sIGluZGV4IH0pID0+XG4gICAgICAgICAgICAodmFsaWRhdGlvbi5lcnJvcnMgfHwgW10pLm1hcChlcnJvciA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmVycm9yLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBJdGVtICR7aW5kZXh9OiAke2Vycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgfSkpXG4gICAgICAgICkpO1xuICAgIH1cblxuICAgIC8vIFBlcmZvcm0gYmF0Y2ggZGVsZXRlIG9wZXJhdGlvbiB3aXRoIGNvbmN1cnJlbmN5IGNvbnRyb2xcbiAgICAvLyBQZXIgRWxlY3Ryb0RCIGRvY3M6IGh0dHA6Ly9lbGVjdHJvZGIuZGV2L2VuL211dGF0aW9ucy9iYXRjaC1kZWxldGUvXG4gICAgLy8gTm90ZTogRWxlY3Ryb0RCIHR5cGVzIHVzZSAnY29uY3VycmVuY3knIHdoaWxlIGRvY3Mgc2hvdyAnY29uY3VycmVudCdcbiAgICBjb25zdCBidWxrT3B0aW9uczogUGFydGlhbDxCdWxrT3B0aW9ucz4gPSB7XG4gICAgICAgIGNvbmN1cnJlbmN5OiBjb25jdXJyZW50XG4gICAgfTtcblxuICAgIGNvbnN0IGVsZWN0cm9SZXN1bHQgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdiYXRjaERlbGV0ZScsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVyc0JhdGNoKS5nbyhidWxrT3B0aW9ucyksXG4gICAgICAgIHsgaXRlbUNvdW50OiBpZGVudGlmaWVyc0JhdGNoLmxlbmd0aCB9XG4gICAgKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBkZWxldGVCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZHM6YCwgaWRzKTtcblxuICAgIHJldHVybiBlbGVjdHJvUmVzdWx0O1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsdGVyIG9iamVjdCB3aXRoIGVxIG9wZXJhdG9ycyB0byBhIHNpbXBsaWZpZWQgZm9ybS5cbiAqIEV4YW1wbGU6IHsgYWdlOiB7IGVxOiA2NSB9IH0gYmVjb21lcyB7IGFnZTogNjUgfVxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVyIG9iamVjdCB0byBzaW1wbGlmeVxuICogQHJldHVybnMgQSBuZXcgZmlsdGVyIG9iamVjdCB3aXRoIGVxIG9wZXJhdG9ycyBjb252ZXJ0ZWQgdG8gZGlyZWN0IHZhbHVlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gc2ltcGxpZnlGaWx0ZXJzKGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBpZiAoIWZpbHRlcnMpIHJldHVybiB7fTtcblxuICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVycykpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgJ2VxJyBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlLmVxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIGV4cG9ydCBjbGFzcyBFbnRpdHlDcnVkU2VydmljZTxTIGV4dGVuZHMgU2NoZW1hPGFueSwgYW55LCBhbnk+PntcblxuLy8gICAgIHB1YmxpYyBhc3luYyBsaXN0KG9wdGlvbnM6IExpc3RFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBsaXN0RW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBjcmVhdGUob3B0aW9uczogQ3JlYXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgY3JlYXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyB1cGRhdGUob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgdXBkYXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBnZXQob3B0aW9uczogR2V0RW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgZ2V0RW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBkZWxldGUob3B0aW9uczogRGVsZXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgZGVsZXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cbi8vIH1cblxuXG4vLyBleHBvcnQgY29uc3QgRGVmYXVsdEVudGl0eUNydWRTZXJ2aWNlID0gbmV3IEVudGl0eUNydWRTZXJ2aWNlKCk7Il19