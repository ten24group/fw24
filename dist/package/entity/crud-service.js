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
const mutation_utils_1 = require("./mutation-utils");
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
    const entity = await observers_1.QueryObserver.track(entityName, 'get', () => entityService.getRepository().get(identifiers).go({ attributes, ...observers_1.QueryObserver.getCapacityGoOptions() }));
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
        concurrent,
        ...observers_1.QueryObserver.getCapacityGoOptions(),
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
    if (!(0, mutation_utils_1.isPlainEntityPayload)(data)) {
        throw new Error("No data provided for create operation");
    }
    const { setPayload, nullRemovalKeys } = (0, mutation_utils_1.partitionTopLevelJsonNulls)(data);
    if (nullRemovalKeys.length > 0) {
        logger.debug(`createEntity: omitted top-level null keys (optional attrs not set on new item):`, nullRemovalKeys);
    }
    // pre events
    // await eventDispatcher?.dispatch({ event: 'beforeCreate', context: arguments });
    // validate
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: setPayload,
        actor: actor,
    });
    if (!validation.pass) {
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, data: setPayloadForStore, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for create: " + { cause: authorization });
    // }
    const repository = entityService.getRepository();
    const entity = await observers_1.QueryObserver.track(entityName, 'create', () => repository.create(setPayload).go({ ...observers_1.QueryObserver.getCapacityGoOptions() }));
    // post events
    // await eventDispatcher?.dispatch({ event: 'afterCreate', context: {...arguments, entity} });
    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ create ~ entityName: ${entityName} ~ data:`, setPayload, entity.data);
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
    if (!(0, mutation_utils_1.isPlainEntityPayload)(data)) {
        throw new Error("No data provided for upsert operation");
    }
    const { setPayload, nullRemovalKeys } = (0, mutation_utils_1.partitionTopLevelJsonNulls)(data);
    if (nullRemovalKeys.length > 0) {
        logger.debug(`upsertEntity: omitted top-level null keys from upsert payload:`, nullRemovalKeys);
    }
    // pre events
    // await eventDispatcher?.dispatch({ event: 'beforeUpsert', context: arguments });
    // validate
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: setPayload,
        actor: actor,
    });
    if (!validation.pass) {
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, data: setPayload, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for upsert: " + { cause: authorization });
    // }
    const repository = entityService.getRepository();
    // Use "all_old" to get the previous item state - allows us to detect create vs update
    // If oldData is empty/null, it was a CREATE. If it has data, it was an UPDATE.
    const entity = await observers_1.QueryObserver.track(entityName, 'upsert', () => repository.upsert(setPayload).go({ response: "all_old", ...observers_1.QueryObserver.getCapacityGoOptions() }));
    const wasCreated = !entity.data || Object.keys(entity.data).length === 0;
    const oldData = wasCreated ? undefined : entity.data;
    // post events
    // await eventDispatcher?.dispatch({ event: 'afterUpsert', context: {...arguments, entity} });
    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ upsert ~ entityName: ${entityName} ~ wasCreated: ${wasCreated}`);
    // Note: with "all_old", entity.data contains the OLD data, we need to return the NEW data
    // Since we don't have the new data from DynamoDB, we return the input data as the new data
    // Echo persisted fields: ElectroDB upsert.go({ response: "all_old" }) does not return the new item image.
    return {
        data: setPayload,
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
    const { filters = {}, attributes = [], 
    // Default to traversing all pages so service-level callers receive the
    // complete result set. DynamoDB caps a single page at 1MB, so a bounded
    // default would silently truncate larger results. Callers that want a
    // bounded result should pass an explicit `count`/`limit`.
    pagination = { order: 'asc', pager: 'cursor', cursor: null, pages: 'all' }, index: specifiedIndex } = query;
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
        entities = await observers_1.QueryObserver.track(entityName, 'list', () => indexQuery.go({ attributes: attributes, ...(0, utils_1.removeEmpty)(pagination), ...observers_1.QueryObserver.getCapacityGoOptions() }), { filters, indexName: matchResult.indexName, pagination });
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
        entities = await observers_1.QueryObserver.track(entityName, 'scan', () => scanQuery.go({ ...(0, utils_1.removeEmpty)(pagination), ...observers_1.QueryObserver.getCapacityGoOptions() }), { filters, pagination });
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
    const { filters = {}, attributes = [], 
    // Default to traversing all pages so service-level callers receive the
    // complete result set. DynamoDB caps a single page at 1MB, so a bounded
    // default would silently truncate larger results. Callers that want a
    // bounded result should pass an explicit `count`/`limit`.
    pagination = { order: 'asc', pager: 'cursor', cursor: null, pages: 'all' }, index: specifiedIndex } = query;
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
        entities = await observers_1.QueryObserver.track(entityName, 'query', () => indexQuery.go({ attributes: attributes, ...(0, utils_1.removeEmpty)(pagination), ...observers_1.QueryObserver.getCapacityGoOptions() }), { filters, indexName: matchResult.indexName, pagination });
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
        entities = await observers_1.QueryObserver.track(entityName, 'scan', () => scanQuery.go({ ...(0, utils_1.removeEmpty)(pagination), ...observers_1.QueryObserver.getCapacityGoOptions() }), { filters, pagination });
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
    if (!(0, mutation_utils_1.isPlainEntityPayload)(data)) {
        throw new Error("No data provided for update operation");
    }
    const { setPayload, nullRemovalKeys } = (0, mutation_utils_1.partitionTopLevelJsonNulls)(data);
    const identifiers = entityService.extractEntityIdentifiers(id);
    const identifierKeysFromRoute = new Set(Object.keys(identifiers));
    const schema = entityService.getEntitySchema();
    const explicitRemovals = operators?.remove ?? [];
    const allRemovalKeys = [...new Set([...nullRemovalKeys, ...explicitRemovals])];
    for (const key of allRemovalKeys) {
        if (identifierKeysFromRoute.has(key)) {
            throw new validation_error_1.EntityValidationError([{
                    message: `Cannot remove identifier attribute "${key}"`,
                    path: [key],
                }]);
        }
        if (!(0, mutation_utils_1.isSchemaAttributeName)(schema, key)) {
            throw new validation_error_1.EntityValidationError([{
                    message: `Cannot remove unknown attribute "${key}"`,
                    path: [key],
                }]);
        }
        const attrDef = schema.attributes[key];
        if (attrDef.required === true) {
            throw new validation_error_1.EntityValidationError([{
                    message: `Cannot clear required attribute "${key}"`,
                    path: [key],
                }]);
        }
    }
    // pre events
    // await eventDispatcher?.dispatch({ event: 'beforeUpdate', context: arguments });
    // Validate only attributes being set (merge-patch nulls are handled via patch.remove above)
    const validation = await validator.validateEntity({
        operationName: crudType,
        entityName,
        entityValidations: entityService.getEntityValidations(),
        overriddenErrorMessages: await entityService.getOverriddenEntityValidationErrorMessages(),
        input: setPayload,
        actor: actor
    });
    if (!validation.pass) {
        throw new validation_error_1.EntityValidationError(validation.errors);
    }
    // authorize the actor 
    // const authorization = await authorizer.authorize({ entityName, crudType, identifiers, data: setPayload, actor, tenant });
    // if(!authorization.pass){
    //     throw new Error("Authorization failed for update: " + { cause: authorization });
    // }
    // --- Composite Key Handling ---
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
                return (!Object.prototype.hasOwnProperty.call(setPayload, attr)
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
                data: setPayload,
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
    const repository = entityService.getRepository();
    const patchBuilder = repository.patch(identifiers);
    const query = patchBuilder.set(setPayload);
    if (Object.keys(finalCompositeKeyValuesForElectroDB).length > 0) {
        logger.debug(`Using composite values for ElectroDB patch:`, finalCompositeKeyValuesForElectroDB);
        query.composite(finalCompositeKeyValuesForElectroDB);
    }
    if (allRemovalKeys.length > 0) {
        query.remove(allRemovalKeys);
    }
    const entity = await observers_1.QueryObserver.track(entityName, 'update', () => query.go({ ...observers_1.QueryObserver.getCapacityGoOptions() }));
    // // post events
    // await eventDispatcher?.dispatch({ event: 'afterUpdate', context: {...arguments, entity} });
    // return entity;
    logger.debug(`Completed EntityCrudService<E ~ update ~ entityName: ${entityName} ~ setPayload:`, setPayload, `removed:`, allRemovalKeys, entity.data);
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
    const entity = await observers_1.QueryObserver.track(entityName, 'delete', () => entityService.getRepository().delete(identifiers).go({ ...observers_1.QueryObserver.getCapacityGoOptions() }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBd0ZBLDhCQXVEQztBQThCRCx3Q0FpRUM7QUE0QkQsb0NBa0VDO0FBK0JELG9DQThFQztBQWlDRCw4REEwQkM7QUErQ0QsNERBeUNDO0FBVUQsOENBNkVDO0FBUUQsZ0NBa0dDO0FBV0Qsa0NBa0dDO0FBeUlELG9DQXlLQztBQStCRCxvQ0FxREM7QUEwQkQsOENBK0RDO0FBUUQsMENBWUM7QUE1MkNELDRDQUEwQztBQUMxQyxvQ0FBMkM7QUFDM0Msd0NBQW1EO0FBQ25ELG9DQUFzRDtBQUN0RCw4Q0FBa0U7QUFFbEUsZ0VBQWtFO0FBQ2xFLHFEQUkwQjtBQUUxQixtQ0FBMkQ7QUFFM0QsMERBQXlGO0FBbUV6Rjs7OztHQUlHO0FBQ0ksS0FBSyxVQUFVLFNBQVMsQ0FBd0MsT0FBeUI7SUFFNUYsTUFBTSxFQUNGLEVBQUUsRUFDRixVQUFVLEVBQ1YsVUFBVSxFQUNWLGFBQWEsRUFFYixLQUFLLEVBQ0wsTUFBTSxFQUVOLFFBQVEsR0FBRyxLQUFLLEVBQ2hCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsd0JBQXdCLENBQUMsRUFDL0MsU0FBUyxHQUFHLDZCQUFnQixFQUM1QixVQUFVLEdBQUcsc0JBQVUsQ0FBQyxPQUFPLEVBQy9CLGVBQWUsR0FBRyx1QkFBZSxDQUFDLE9BQU8sR0FFNUMsR0FBRyxPQUFPLENBQUM7SUFFWixNQUFNLENBQUMsS0FBSyxDQUFDLCtDQUErQyxVQUFVLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBRS9GLDZFQUE2RTtJQUU3RSxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDLENBQUM7SUFFL0Qsc0JBQXNCO0lBQ3RCLHdHQUF3RztJQUN4RywyQkFBMkI7SUFDM0Isb0ZBQW9GO0lBQ3BGLElBQUk7SUFHSixjQUFjO0lBQ2QsTUFBTSxVQUFVLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO1FBQzlDLGFBQWEsRUFBRSxRQUFRO1FBQ3ZCLFVBQVU7UUFDVixpQkFBaUIsRUFBRSxhQUFhLENBQUMsb0JBQW9CLEVBQUU7UUFDdkQsdUJBQXVCLEVBQUUsTUFBTSxhQUFhLENBQUMsMENBQTBDLEVBQUU7UUFDekYsS0FBSyxFQUFFLFdBQVc7UUFDbEIsS0FBSyxFQUFFLEtBQUs7S0FDZixDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ25CLE1BQU0sSUFBSSx3Q0FBcUIsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVELE1BQU0sTUFBTSxHQUFHLE1BQU0seUJBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsQ0FDN0QsYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxVQUFVLEVBQUUsR0FBRyx5QkFBYSxDQUFDLG9CQUFvQixFQUFFLEVBQUUsQ0FBQyxDQUM3RyxDQUFDO0lBRUYsMkVBQTJFO0lBRTNFLE1BQU0sQ0FBQyxLQUFLLENBQUMsa0RBQWtELFVBQVUsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBRXZGLE9BQU8sTUFBOEIsQ0FBQztBQUMxQyxDQUFDO0FBeUJEOzs7O0dBSUc7QUFDSSxLQUFLLFVBQVUsY0FBYyxDQUF3QyxPQUE4QjtJQUN0RyxNQUFNLEVBQ0YsR0FBRyxFQUNILFVBQVUsRUFDVixVQUFVLEVBQ1YsYUFBYSxFQUNiLFVBQVUsR0FBRyxDQUFDLEVBRWQsS0FBSyxFQUNMLE1BQU0sRUFFTixRQUFRLEdBQUcsS0FBSyxFQUNoQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLDZCQUE2QixDQUFDLEVBQ3BELFNBQVMsR0FBRyw2QkFBZ0IsRUFDNUIsVUFBVSxHQUFHLHNCQUFVLENBQUMsT0FBTyxFQUMvQixlQUFlLEdBQUcsdUJBQWUsQ0FBQyxPQUFPLEdBQzVDLEdBQUcsT0FBTyxDQUFDO0lBRVosTUFBTSxDQUFDLEtBQUssQ0FBQyxvREFBb0QsVUFBVSxHQUFHLEVBQUUsRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztJQUVyRyxpREFBaUQ7SUFDakQsTUFBTSxnQkFBZ0IsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFFbkYsa0NBQWtDO0lBQ2xDLE1BQU0sV0FBVyxHQUFHLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFDLFdBQVcsRUFBQyxFQUFFLENBQzNFLFNBQVMsQ0FBQyxjQUFjLENBQUM7UUFDckIsYUFBYSxFQUFFLFFBQVE7UUFDdkIsVUFBVTtRQUNWLGlCQUFpQixFQUFFLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRTtRQUN2RCx1QkFBdUIsRUFBRSxNQUFNLGFBQWEsQ0FBQywwQ0FBMEMsRUFBRTtRQUN6RixLQUFLLEVBQUUsV0FBVztRQUNsQixLQUFLLEVBQUUsS0FBSztLQUNmLENBQUMsQ0FDTCxDQUFDLENBQUM7SUFFSCw4QkFBOEI7SUFDOUIsTUFBTSxnQkFBZ0IsR0FBRyxXQUFXO1NBQy9CLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztTQUNuRCxNQUFNLENBQUMsQ0FBQyxFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUVsRCxJQUFJLGdCQUFnQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM5QixNQUFNLElBQUksd0NBQXFCLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxDQUMvRSxDQUFDLFVBQVUsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUNwQyxHQUFHLEtBQUs7WUFDUixPQUFPLEVBQUUsUUFBUSxLQUFLLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRTtTQUM3QyxDQUFDLENBQUMsQ0FDTixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsdURBQXVEO0lBQ3ZELE1BQU0sTUFBTSxHQUFHLE1BQU0seUJBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FDbEUsYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUNuRCxVQUFVO1FBQ1YsVUFBVTtRQUNWLEdBQUcseUJBQWEsQ0FBQyxvQkFBb0IsRUFBRTtLQUMxQyxDQUFDLEVBQ0YsRUFBRSxTQUFTLEVBQUUsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLENBQ3pDLENBQUM7SUFFRixNQUFNLENBQUMsS0FBSyxDQUFDLHVEQUF1RCxVQUFVLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUU5RixPQUFPO1FBQ0gsSUFBSSxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUUsTUFBTSxDQUFDLElBQUksQ0FBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDckYsV0FBVyxFQUFFLEVBQUUsQ0FBRSxpRkFBaUY7S0FDckcsQ0FBQztBQUNOLENBQUM7QUFxQkQ7Ozs7OztHQU1HO0FBQ0ksS0FBSyxVQUFVLFlBQVksQ0FBd0MsT0FBNEI7SUFDbEcsTUFBTSxFQUNGLElBQUksRUFDSixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLFFBQVEsRUFDbkIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQywyQkFBMkIsQ0FBQyxFQUNsRCxTQUFTLEdBQUcsNkJBQWdCLEVBQzVCLFVBQVUsR0FBRyxzQkFBVSxDQUFDLE9BQU8sRUFDL0IsZUFBZSxHQUFHLHVCQUFlLENBQUMsT0FBTyxHQUU1QyxHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sQ0FBQyxLQUFLLENBQUMscURBQXFELFVBQVUsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBRTlGLElBQUksQ0FBQyxJQUFBLHFDQUFvQixFQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDOUIsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO0lBQzdELENBQUM7SUFFRCxNQUFNLEVBQUUsVUFBVSxFQUFFLGVBQWUsRUFBRSxHQUFHLElBQUEsMkNBQTBCLEVBQUMsSUFBSSxDQUFDLENBQUM7SUFFekUsSUFBSSxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzdCLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUZBQWlGLEVBQUUsZUFBZSxDQUFDLENBQUM7SUFDckgsQ0FBQztJQUVELGFBQWE7SUFDYixrRkFBa0Y7SUFFbEYsV0FBVztJQUNYLE1BQU0sVUFBVSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztRQUM5QyxhQUFhLEVBQUUsUUFBUTtRQUN2QixVQUFVO1FBQ1YsaUJBQWlCLEVBQUUsYUFBYSxDQUFDLG9CQUFvQixFQUFFO1FBQ3ZELHVCQUF1QixFQUFFLE1BQU0sYUFBYSxDQUFDLDBDQUEwQyxFQUFFO1FBQ3pGLEtBQUssRUFBRSxVQUFVO1FBQ2pCLEtBQUssRUFBRSxLQUFLO0tBQ2YsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNuQixNQUFNLElBQUksd0NBQXFCLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3ZELENBQUM7SUFFRCx1QkFBdUI7SUFDdkIsdUhBQXVIO0lBQ3ZILDJCQUEyQjtJQUMzQix1RkFBdUY7SUFDdkYsSUFBSTtJQUVKLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUdqRCxNQUFNLE1BQU0sR0FBRyxNQUFNLHlCQUFhLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLENBQ2hFLFVBQVUsQ0FBQyxNQUFNLENBQUMsVUFBK0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEdBQUcseUJBQWEsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUMsQ0FDckcsQ0FBQztJQUVGLGNBQWM7SUFDZCw4RkFBOEY7SUFFOUYsaUJBQWlCO0lBQ2pCLE1BQU0sQ0FBQyxLQUFLLENBQUMsd0RBQXdELFVBQVUsVUFBVSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7SUFFcEgsT0FBTyxNQUFpQyxDQUFDO0FBQzdDLENBQUM7QUF3QkQ7Ozs7OztHQU1HO0FBQ0ksS0FBSyxVQUFVLFlBQVksQ0FBd0MsT0FBNEI7SUFDbEcsTUFBTSxFQUNGLElBQUksRUFDSixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLFFBQVEsRUFDbkIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQywyQkFBMkIsQ0FBQyxFQUNsRCxTQUFTLEdBQUcsNkJBQWdCLEVBQzVCLFVBQVUsR0FBRyxzQkFBVSxDQUFDLE9BQU8sRUFDL0IsZUFBZSxHQUFHLHVCQUFlLENBQUMsT0FBTyxHQUU1QyxHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sQ0FBQyxLQUFLLENBQUMscURBQXFELFVBQVUsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBRTlGLElBQUksQ0FBQyxJQUFBLHFDQUFvQixFQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDOUIsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO0lBQzdELENBQUM7SUFFRCxNQUFNLEVBQUUsVUFBVSxFQUFFLGVBQWUsRUFBRSxHQUFHLElBQUEsMkNBQTBCLEVBQUMsSUFBSSxDQUFDLENBQUM7SUFFekUsSUFBSSxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzdCLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0VBQWdFLEVBQUUsZUFBZSxDQUFDLENBQUM7SUFDcEcsQ0FBQztJQUVELGFBQWE7SUFDYixrRkFBa0Y7SUFFbEYsV0FBVztJQUNYLE1BQU0sVUFBVSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztRQUM5QyxhQUFhLEVBQUUsUUFBUTtRQUN2QixVQUFVO1FBQ1YsaUJBQWlCLEVBQUUsYUFBYSxDQUFDLG9CQUFvQixFQUFFO1FBQ3ZELHVCQUF1QixFQUFFLE1BQU0sYUFBYSxDQUFDLDBDQUEwQyxFQUFFO1FBQ3pGLEtBQUssRUFBRSxVQUFVO1FBQ2pCLEtBQUssRUFBRSxLQUFLO0tBQ2YsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNuQixNQUFNLElBQUksd0NBQXFCLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3ZELENBQUM7SUFFRCx1QkFBdUI7SUFDdkIsK0dBQStHO0lBQy9HLDJCQUEyQjtJQUMzQix1RkFBdUY7SUFDdkYsSUFBSTtJQUVKLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUdqRCxzRkFBc0Y7SUFDdEYsK0VBQStFO0lBQy9FLE1BQU0sTUFBTSxHQUFHLE1BQU0seUJBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FDaEUsVUFBVSxDQUFDLE1BQU0sQ0FBQyxVQUErQixDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxHQUFHLHlCQUFhLENBQUMsb0JBQW9CLEVBQUUsRUFBRSxDQUFDLENBQzFILENBQUM7SUFFRixNQUFNLFVBQVUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQztJQUN6RSxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztJQUVyRCxjQUFjO0lBQ2QsOEZBQThGO0lBRTlGLGlCQUFpQjtJQUNqQixNQUFNLENBQUMsS0FBSyxDQUFDLHdEQUF3RCxVQUFVLGtCQUFrQixVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBRS9HLDBGQUEwRjtJQUMxRiwyRkFBMkY7SUFDM0YsMEdBQTBHO0lBQzFHLE9BQU87UUFDSCxJQUFJLEVBQUUsVUFBVTtRQUNoQixVQUFVO1FBQ1YsT0FBTztLQUNpQixDQUFDO0FBQ2pDLENBQUM7QUFVRDs7OztHQUlHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUNyQyxXQUFXLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLFVBQVU7Q0FDbEUsQ0FBQyxDQUFDO0FBRUg7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILFNBQWdCLHlCQUF5QixDQUFDLE9BQTRCO0lBQ2xFLG9DQUFvQztJQUNwQyxJQUFJLENBQUMsT0FBTyxJQUFJLENBQUMsQ0FBQyxLQUFLLElBQUksT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNsQyxPQUFPLE9BQU8sSUFBSSxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVELE1BQU0sTUFBTSxHQUF3QixFQUFFLENBQUM7SUFFdkMsOEVBQThFO0lBQzlFLEtBQUssTUFBTSxJQUFJLElBQUksT0FBTyxDQUFDLEdBQUcsSUFBSSxFQUFFLEVBQUUsQ0FBQztRQUNuQyxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNqQixNQUFNLFNBQVMsR0FBd0IsRUFBRSxDQUFDO1lBQzFDLEtBQUssTUFBTSxDQUFFLEdBQUcsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ2hELG9GQUFvRjtnQkFDcEYsMERBQTBEO2dCQUMxRCxJQUFJLEdBQUcsS0FBSyxXQUFXLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDNUQsU0FBUyxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztnQkFDN0IsQ0FBQztZQUNMLENBQUM7WUFDRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNwQyxNQUFNLENBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBRSxHQUFHLFNBQVMsQ0FBQztZQUN6QyxDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxNQUFhLHVCQUF3QixTQUFRLEtBQUs7SUFFMUI7SUFDQTtJQUNBO0lBSHBCLFlBQ29CLGFBQXFCLEVBQ3JCLGdCQUEwQixFQUMxQixTQUFrQjtRQUVsQyxNQUFNLFlBQVksR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLGVBQWUsU0FBUyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUNsRSxLQUFLLENBQ0QsK0JBQStCLGdCQUFnQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CLGFBQWEsSUFBSSxZQUFZLElBQUk7WUFDL0csOERBQThEO1lBQzlELFNBQVMsYUFBYSwwQkFBMEIsYUFBYSxnQ0FBZ0M7WUFDN0YsaUZBQWlGLENBQ3BGLENBQUM7UUFWYyxrQkFBYSxHQUFiLGFBQWEsQ0FBUTtRQUNyQixxQkFBZ0IsR0FBaEIsZ0JBQWdCLENBQVU7UUFDMUIsY0FBUyxHQUFULFNBQVMsQ0FBUztRQVNsQyxJQUFJLENBQUMsSUFBSSxHQUFHLHlCQUF5QixDQUFDO0lBQzFDLENBQUM7Q0FDSjtBQWZELDBEQWVDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXdCRztBQUNILFNBQWdCLHdCQUF3QixDQUNwQyxPQUF3QyxFQUN4QyxTQUFrQjtJQUVsQixJQUFJLENBQUMsT0FBTztRQUFFLE9BQU8sRUFBRSxDQUFDO0lBRXhCLE1BQU0sTUFBTSxHQUF3QixFQUFFLENBQUM7SUFFdkMsS0FBSyxNQUFNLENBQUUsR0FBRyxFQUFFLEtBQUssQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNuRCxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3hDLFNBQVM7UUFDYixDQUFDO1FBRUQsd0NBQXdDO1FBQ3hDLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDNUIsTUFBTSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztZQUN0QixTQUFTO1FBQ2IsQ0FBQztRQUVELGlDQUFpQztRQUNqQyxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRXJDLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN6QixTQUFTO1FBQ2IsQ0FBQztRQUVELGtEQUFrRDtRQUNsRCxJQUFJLEtBQUssQ0FBQyxFQUFFLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDekIsNkRBQTZEO1lBQzdELE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEtBQUssSUFBSSxDQUFDLENBQUM7WUFDckQsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN0QixNQUFNLElBQUksdUJBQXVCLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUNoRSxDQUFDO1lBQ0QsTUFBTSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDN0IsQ0FBQzthQUFNLENBQUM7WUFDSiw2Q0FBNkM7WUFDN0MsTUFBTSxJQUFJLHVCQUF1QixDQUFDLEdBQUcsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDakUsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILFNBQWdCLGlCQUFpQixDQUM3QixNQUFtQyxFQUNuQyxPQUF3QyxFQUN4QyxVQUFrQixFQUNsQixhQUErQztJQUUvQyxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsZ0NBQWdDLENBQUMsQ0FBQztJQUM5RCxJQUFJLENBQUMsT0FBTztRQUFFLE9BQU8sR0FBRyxFQUFFLENBQUM7SUFFM0IsaUVBQWlFO0lBQ2pFLE1BQU0sYUFBYSxHQUFHLHlCQUF5QixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ3pELE1BQU0sQ0FBQyxLQUFLLENBQUMsdUNBQXVDLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUUsQ0FBQyxDQUFDO0lBRXBHLHVDQUF1QztJQUN2QyxNQUFNLFVBQVUsR0FBRyxhQUFhLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDakQsTUFBTSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLEdBQUksVUFBa0IsQ0FBQyxzQkFBc0IsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUU5RixNQUFNLENBQUMsS0FBSyxDQUFDLDBCQUEwQixLQUFLLFNBQVMsSUFBSSxDQUFDLE1BQU0sa0NBQWtDLFVBQVUsMkJBQTJCLFVBQVUsS0FBSyxFQUFFLElBQUksRUFBRSxhQUFhLENBQUMsQ0FBQztJQUU3Syx1Q0FBdUM7SUFDdkMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2QsTUFBTSxZQUFZLEdBQXdCLEVBQUUsQ0FBQztRQUU3QyxrRkFBa0Y7UUFDbEYsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQW1DLEVBQUUsRUFBRTtZQUNqRCxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxDQUFDO1lBQzlDLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2QscURBQXFEO2dCQUNyRCxZQUFZLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxHQUFHLFdBQVcsQ0FBQyxFQUFFLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7WUFDM0YsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsc0VBQXNFO1FBQ3RFLElBQUksZUFBZSxHQUFHLEtBQUssQ0FBQztRQUM1QixJQUFJLEtBQUssS0FBSyxFQUFFLEVBQUUsQ0FBQztZQUNmLGVBQWUsR0FBRyxTQUFTLENBQUM7UUFDaEMsQ0FBQzthQUFNLENBQUM7WUFDSixxREFBcUQ7WUFDckQsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQztZQUMvQixLQUFLLE1BQU0sQ0FBRSxJQUFJLEVBQUUsUUFBUSxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUN2RCxJQUFJLFFBQVEsQ0FBQyxLQUFLLEtBQUssS0FBSyxFQUFFLENBQUM7b0JBQzNCLGVBQWUsR0FBRyxJQUFJLENBQUM7b0JBQ3ZCLE1BQU07Z0JBQ1YsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxrQ0FBa0MsZUFBZSxlQUFlLEtBQUssVUFBVSxJQUFJLENBQUMsTUFBTSxrQ0FBa0MsVUFBVSxnQkFBZ0IsRUFBRSxZQUFZLENBQUMsQ0FBQztRQUNuTCxPQUFPLEVBQUUsU0FBUyxFQUFFLGVBQWUsRUFBRSxZQUFZLEVBQUUsQ0FBQztJQUN4RCxDQUFDO0lBRUQsMkVBQTJFO0lBQzNFLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUM7SUFDL0IsS0FBSyxNQUFNLENBQUUsU0FBUyxFQUFFLFFBQVEsQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUM1RCxJQUFJLFFBQVEsQ0FBQyxFQUFFLENBQUMsUUFBUSxJQUFJLE9BQU8sUUFBUSxDQUFDLEVBQUUsQ0FBQyxRQUFRLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDbkUsaUNBQWlDO1lBQ2pDLElBQUksUUFBUSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsV0FBVyxFQUFFLEtBQUssVUFBVSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7Z0JBQ2xFLE1BQU0sQ0FBQyxLQUFLLENBQUMsa0NBQWtDLFNBQVMsZ0JBQWdCLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ3RGLE9BQU87b0JBQ0gsU0FBUztvQkFDVCxZQUFZLEVBQUUsRUFBRTtpQkFDbkIsQ0FBQztZQUNOLENBQUM7WUFFRCxpRUFBaUU7WUFDakUsMEVBQTBFO1lBQzFFLElBQUksUUFBUSxDQUFDLEVBQUUsQ0FBQyxTQUFTLElBQUksUUFBUSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUM5RCxNQUFNLENBQUMsS0FBSyxDQUFDLDhCQUE4QixTQUFTLCtCQUErQixRQUFRLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7Z0JBQzNHLE9BQU87b0JBQ0gsU0FBUztvQkFDVCxZQUFZLEVBQUUsRUFBRTtpQkFDbkIsQ0FBQztZQUNOLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sU0FBUyxDQUFDO0FBQ3JCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNJLEtBQUssVUFBVSxVQUFVLENBQXdDLE9BQTBCO0lBRTlGLE1BQU0sRUFDRixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLE1BQU0sRUFDakIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyx5QkFBeUIsQ0FBQyxFQUNoRCxVQUFVLEdBQUcsc0JBQVUsQ0FBQyxPQUFPLEVBQy9CLGVBQWUsR0FBRyx1QkFBZSxDQUFDLE9BQU8sRUFFekMsS0FBSyxHQUFHLEVBQUUsR0FDYixHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sRUFDRixPQUFPLEdBQUcsRUFBRSxFQUNaLFVBQVUsR0FBRyxFQUFFO0lBQ2YsdUVBQXVFO0lBQ3ZFLHdFQUF3RTtJQUN4RSxzRUFBc0U7SUFDdEUsMERBQTBEO0lBQzFELFVBQVUsR0FBRyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFDMUUsS0FBSyxFQUFFLGNBQWMsRUFDeEIsR0FBRyxLQUFLLENBQUM7SUFFVixNQUFNLENBQUMsS0FBSyxDQUFDLGdEQUFnRCxVQUFVLG9CQUFvQixDQUFDLENBQUM7SUFFN0YsOEVBQThFO0lBRTlFLHNCQUFzQjtJQUN0QiwyRkFBMkY7SUFDM0YsMkJBQTJCO0lBQzNCLDRFQUE0RTtJQUM1RSxJQUFJO0lBRUosa0RBQWtEO0lBQ2xELE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQztJQUMvQyxNQUFNLFdBQVcsR0FBRyxjQUFjO1FBQzlCLENBQUMsQ0FBQyxFQUFFLFNBQVMsRUFBRSxjQUFjLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSx3QkFBd0IsQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6SCxDQUFDLENBQUMsaUJBQWlCLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFFcEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxlQUFlLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFDM0MseUNBQXlDO0lBQ3pDLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUVqRCxJQUFJLFFBQVEsQ0FBQztJQUNiLElBQUksV0FBVyxFQUFFLENBQUM7UUFDZCxxQ0FBcUM7UUFDckMsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBRSxXQUFXLENBQUMsU0FBUyxDQUFFLENBQUMsV0FBVyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3ZGLElBQUksT0FBTyxJQUFJLENBQUMsSUFBQSxxQkFBYSxFQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDckMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQVMsRUFBRSxFQUFPLEVBQUUsRUFBRSxDQUFDLElBQUEsd0NBQWdDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ2xHLENBQUM7UUFDRCxRQUFRLEdBQUcsTUFBTSx5QkFBYSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUMxRCxVQUFVLENBQUMsRUFBRSxDQUFDLEVBQUUsVUFBVSxFQUFFLFVBQWlCLEVBQUUsR0FBRyxJQUFBLG1CQUFXLEVBQUMsVUFBVSxDQUFDLEVBQUUsR0FBRyx5QkFBYSxDQUFDLG9CQUFvQixFQUFFLEVBQUUsQ0FBQyxFQUNySCxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsV0FBVyxDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsQ0FDNUQsQ0FBQztJQUNOLENBQUM7U0FBTSxDQUFDO1FBQ0osMEJBQTBCO1FBQzFCLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0RBQWdELFVBQVUsNkJBQTZCLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFOUcsK0RBQStEO1FBQy9ELDBCQUFjLENBQUMsU0FBUyxDQUFDLGtCQUFrQixFQUFFLENBQUMsRUFBRTtZQUM1QyxJQUFJLEVBQUUsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRTtZQUN2QyxLQUFLLEVBQUUsTUFBTTtTQUNoQixDQUFDLENBQUM7UUFFSCxnQ0FBZ0M7UUFDaEMsd0JBQVksQ0FBQyxjQUFjLEVBQUUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxvQkFBb0IsRUFBRTtZQUM5RCxJQUFJLEVBQUU7Z0JBQ0YsZ0JBQWdCLEVBQUUsVUFBVTtnQkFDNUIsY0FBYyxFQUFFLE1BQU07Z0JBQ3RCLFlBQVksRUFBRSxnQkFBZ0I7YUFDakM7WUFDRCxPQUFPLEVBQUU7Z0JBQ0wsY0FBYyxFQUFFLENBQUM7YUFDcEI7WUFDRCxJQUFJLEVBQUUsRUFBRSxlQUFlLEVBQUUsT0FBTyxJQUFJLEVBQUUsRUFBRTtTQUMzQyxDQUFDLENBQUM7UUFFSCxNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDO1FBQ2xDLElBQUksT0FBTyxJQUFJLENBQUMsSUFBQSxxQkFBYSxFQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDckMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQVMsRUFBRSxFQUFPLEVBQUUsRUFBRSxDQUFDLElBQUEsd0NBQWdDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ2pHLENBQUM7UUFDRCxxQ0FBcUM7UUFDckMsUUFBUSxHQUFHLE1BQU0seUJBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FDMUQsU0FBUyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEdBQUcsSUFBQSxtQkFBVyxFQUFDLFVBQVUsQ0FBQyxFQUFFLEdBQUcseUJBQWEsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUMsRUFDckYsRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLENBQzFCLENBQUM7SUFDTixDQUFDO0lBRUQsOEVBQThFO0lBRTlFLE1BQU0sQ0FBQyxLQUFLLENBQUMsbURBQW1ELFVBQVUsb0JBQW9CLENBQUMsQ0FBQztJQUVoRyxPQUFPLFFBQVEsQ0FBQztBQUNwQixDQUFDO0FBTUQ7Ozs7R0FJRztBQUNJLEtBQUssVUFBVSxXQUFXLENBQXdDLE9BQTJCO0lBRWhHLE1BQU0sRUFDRixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLE9BQU8sRUFDbEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQywwQkFBMEIsQ0FBQyxFQUNqRCxVQUFVLEdBQUcsc0JBQVUsQ0FBQyxPQUFPLEVBQy9CLGVBQWUsR0FBRyx1QkFBZSxDQUFDLE9BQU8sRUFFekMsS0FBSyxHQUFHLEVBQUUsRUFFYixHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sRUFDRixPQUFPLEdBQUcsRUFBRSxFQUNaLFVBQVUsR0FBRyxFQUFFO0lBQ2YsdUVBQXVFO0lBQ3ZFLHdFQUF3RTtJQUN4RSxzRUFBc0U7SUFDdEUsMERBQTBEO0lBQzFELFVBQVUsR0FBRyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFDMUUsS0FBSyxFQUFFLGNBQWMsRUFDeEIsR0FBRyxLQUFLLENBQUM7SUFFVixNQUFNLENBQUMsS0FBSyxDQUFDLGlEQUFpRCxVQUFVLG9CQUFvQixDQUFDLENBQUM7SUFFOUYsOEVBQThFO0lBRTlFLHlCQUF5QjtJQUN6QiwyRkFBMkY7SUFDM0YsMkJBQTJCO0lBQzNCLDRFQUE0RTtJQUM1RSxJQUFJO0lBRUosa0RBQWtEO0lBQ2xELE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQztJQUMvQyxNQUFNLFdBQVcsR0FBRyxjQUFjO1FBQzlCLENBQUMsQ0FBQyxFQUFFLFNBQVMsRUFBRSxjQUFjLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSx3QkFBd0IsQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6SCxDQUFDLENBQUMsaUJBQWlCLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFFcEUseUNBQXlDO0lBQ3pDLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUVqRCxJQUFJLFFBQVEsQ0FBQztJQUNiLElBQUksV0FBVyxFQUFFLENBQUM7UUFDZCxxQ0FBcUM7UUFDckMsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBRSxXQUFXLENBQUMsU0FBUyxDQUFFLENBQUMsV0FBVyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3ZGLElBQUksT0FBTyxJQUFJLENBQUMsSUFBQSxxQkFBYSxFQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDckMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQVMsRUFBRSxFQUFPLEVBQUUsRUFBRSxDQUFDLElBQUEsd0NBQWdDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ2xHLENBQUM7UUFDRCxRQUFRLEdBQUcsTUFBTSx5QkFBYSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUMzRCxVQUFVLENBQUMsRUFBRSxDQUFDLEVBQUUsVUFBVSxFQUFFLFVBQWlCLEVBQUUsR0FBRyxJQUFBLG1CQUFXLEVBQUMsVUFBVSxDQUFDLEVBQUUsR0FBRyx5QkFBYSxDQUFDLG9CQUFvQixFQUFFLEVBQUUsQ0FBQyxFQUNySCxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsV0FBVyxDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsQ0FDNUQsQ0FBQztJQUNOLENBQUM7U0FBTSxDQUFDO1FBQ0osMEJBQTBCO1FBQzFCLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0RBQWdELFVBQVUsNkJBQTZCLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFOUcsK0RBQStEO1FBQy9ELDBCQUFjLENBQUMsU0FBUyxDQUFDLGtCQUFrQixFQUFFLENBQUMsRUFBRTtZQUM1QyxJQUFJLEVBQUUsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRTtZQUN4QyxLQUFLLEVBQUUsTUFBTTtTQUNoQixDQUFDLENBQUM7UUFFSCxnQ0FBZ0M7UUFDaEMsd0JBQVksQ0FBQyxjQUFjLEVBQUUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxvQkFBb0IsRUFBRTtZQUM5RCxJQUFJLEVBQUU7Z0JBQ0YsZ0JBQWdCLEVBQUUsVUFBVTtnQkFDNUIsY0FBYyxFQUFFLE9BQU87Z0JBQ3ZCLFlBQVksRUFBRSxnQkFBZ0I7YUFDakM7WUFDRCxPQUFPLEVBQUU7Z0JBQ0wsY0FBYyxFQUFFLENBQUM7YUFDcEI7WUFDRCxJQUFJLEVBQUUsRUFBRSxlQUFlLEVBQUUsT0FBTyxJQUFJLEVBQUUsRUFBRTtTQUMzQyxDQUFDLENBQUM7UUFFSCxNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDO1FBQ2xDLElBQUksT0FBTyxJQUFJLENBQUMsSUFBQSxxQkFBYSxFQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDckMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQVMsRUFBRSxFQUFPLEVBQUUsRUFBRSxDQUFDLElBQUEsd0NBQWdDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ2pHLENBQUM7UUFDRCxxQ0FBcUM7UUFDckMsUUFBUSxHQUFHLE1BQU0seUJBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FDMUQsU0FBUyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEdBQUcsSUFBQSxtQkFBVyxFQUFDLFVBQVUsQ0FBQyxFQUFFLEdBQUcseUJBQWEsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUMsRUFDckYsRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLENBQzFCLENBQUM7SUFDTixDQUFDO0lBRUQsK0VBQStFO0lBRS9FLE1BQU0sQ0FBQyxLQUFLLENBQUMsb0RBQW9ELFVBQVUsb0JBQW9CLENBQUMsQ0FBQztJQUVqRyxPQUFPLFFBQVEsQ0FBQztBQUNwQixDQUFDO0FBNERELEtBQUssVUFBVSxtQ0FBbUMsQ0FDOUMsSUFBdUM7SUFFdkMsTUFBTSxFQUNGLGFBQWEsRUFDYixXQUFXLEVBQ1gsSUFBSSxFQUNKLDJCQUEyQixFQUMzQixNQUFNLEdBQ1QsR0FBRyxJQUFJLENBQUM7SUFFVCxNQUFNLGtCQUFrQixHQUF3QixFQUFFLENBQUM7SUFDbkQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBQzVDLE1BQU0sWUFBWSxHQUFHLElBQTJCLENBQUMsQ0FBQywwQkFBMEI7SUFFNUUsSUFBSSwyQkFBMkIsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDekMsT0FBTyxFQUFFLENBQUMsQ0FBQyxpQ0FBaUM7SUFDaEQsQ0FBQztJQUVELHlEQUF5RDtJQUN6RCwyQkFBMkIsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDdkMsSUFBSSxDQUFDLFlBQVksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDMUUsaUJBQWlCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2hDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksaUJBQWlCLENBQUMsSUFBSSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzdCLE1BQU0sQ0FBQyxLQUFLLENBQUMsOENBQThDLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUM7UUFFNUYsSUFBSSxDQUFDO1lBQ0QsTUFBTSx1QkFBdUIsR0FBRyxNQUFNLGFBQWEsQ0FBQyxhQUFhLEVBQUU7aUJBQzlELEdBQUcsQ0FBQyxXQUFXLENBQUM7aUJBQ2hCLEVBQUUsQ0FBQyxFQUFFLFVBQVUsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsY0FBYyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7WUFFN0UsTUFBTSxrQkFBa0IsR0FBRyx1QkFBdUIsQ0FBQyxJQUF1QyxDQUFDO1lBRTNGLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO2dCQUV0QixNQUFNLENBQUMsSUFBSSxDQUFDLDhDQUE4QyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDO1lBRS9GLENBQUM7aUJBQU0sQ0FBQztnQkFFSixpQkFBaUIsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUU7b0JBQzdCLElBQUksa0JBQWtCLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7d0JBQzFDLGtCQUFrQixDQUFFLElBQUksQ0FBRSxHQUFHLGtCQUFrQixDQUFFLElBQUksQ0FBRSxDQUFDO29CQUM1RCxDQUFDO3lCQUFNLENBQUM7d0JBQ0osOEZBQThGO3dCQUM5RixNQUFNLENBQUMsS0FBSyxDQUFDLDRCQUE0QixJQUFJLFVBQVUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsbURBQW1ELENBQUMsQ0FBQztvQkFDM0ksQ0FBQztnQkFDTCxDQUFDLENBQUMsQ0FBQztZQUVQLENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLE1BQU0sQ0FBQyxLQUFLLENBQUMscURBQXFELElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztZQUUxRyw4QkFBOEI7WUFDOUIsMEJBQWMsQ0FBQyxTQUFTLENBQUMsa0NBQWtDLEVBQUUsQ0FBQyxFQUFFO2dCQUM1RCxJQUFJLEVBQUUsRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRTtnQkFDckMsS0FBSyxFQUFFLE9BQU87YUFDakIsQ0FBQyxDQUFDO1lBRUgsTUFBTSxLQUFLLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7SUFFRCxNQUFNLENBQUMsS0FBSyxDQUFDLGdDQUFnQyxFQUFFLGtCQUFrQixDQUFDLENBQUM7SUFDbkUsT0FBTyxrQkFBa0IsQ0FBQztBQUM5QixDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNJLEtBQUssVUFBVSxZQUFZLENBQXdDLE9BQTRCO0lBQ2xHLE1BQU0sRUFDRixFQUFFLEVBQ0YsSUFBSSxFQUNKLFNBQVMsRUFDVCxVQUFVLEVBQ1YsYUFBYSxFQUNiLEtBQUssRUFDTCxNQUFNLEVBQ04sUUFBUSxHQUFHLFFBQVEsRUFDbkIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQywyQkFBMkIsQ0FBQyxFQUNsRCxTQUFTLEdBQUcsNkJBQWdCLEVBQzVCLFVBQVUsR0FBRyxzQkFBVSxDQUFDLE9BQU8sRUFDL0IsZUFBZSxHQUFHLHVCQUFlLENBQUMsT0FBTyxFQUN6QyxnQkFBZ0IsR0FDbkIsR0FBRyxPQUFPLENBQUM7SUFFWixNQUFNLENBQUMsS0FBSyxDQUFDLHFEQUFxRCxVQUFVLFVBQVUsRUFBRSxFQUFFLElBQUksRUFBRSx3QkFBd0IsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDLENBQUM7SUFFOUksSUFBSSxDQUFDLElBQUEscUNBQW9CLEVBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7SUFDN0QsQ0FBQztJQUVELE1BQU0sRUFBRSxVQUFVLEVBQUUsZUFBZSxFQUFFLEdBQUcsSUFBQSwyQ0FBMEIsRUFBQyxJQUFJLENBQUMsQ0FBQztJQUV6RSxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDL0QsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQXNDLENBQUMsQ0FBQyxDQUFDO0lBRTdGLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQztJQUUvQyxNQUFNLGdCQUFnQixHQUFHLFNBQVMsRUFBRSxNQUFNLElBQUksRUFBRSxDQUFDO0lBQ2pELE1BQU0sY0FBYyxHQUFHLENBQUUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFFLEdBQUcsZUFBZSxFQUFFLEdBQUcsZ0JBQWdCLENBQUUsQ0FBQyxDQUFFLENBQUM7SUFFbkYsS0FBSyxNQUFNLEdBQUcsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUMvQixJQUFJLHVCQUF1QixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ25DLE1BQU0sSUFBSSx3Q0FBcUIsQ0FBQyxDQUFFO29CQUM5QixPQUFPLEVBQUUsdUNBQXVDLEdBQUcsR0FBRztvQkFDdEQsSUFBSSxFQUFFLENBQUUsR0FBRyxDQUFFO2lCQUNoQixDQUFFLENBQUMsQ0FBQztRQUNULENBQUM7UUFDRCxJQUFJLENBQUMsSUFBQSxzQ0FBcUIsRUFBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN0QyxNQUFNLElBQUksd0NBQXFCLENBQUMsQ0FBRTtvQkFDOUIsT0FBTyxFQUFFLG9DQUFvQyxHQUFHLEdBQUc7b0JBQ25ELElBQUksRUFBRSxDQUFFLEdBQUcsQ0FBRTtpQkFDaEIsQ0FBRSxDQUFDLENBQUM7UUFDVCxDQUFDO1FBQ0QsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBRSxHQUFHLENBQUUsQ0FBQztRQUN6QyxJQUFJLE9BQU8sQ0FBQyxRQUFRLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDNUIsTUFBTSxJQUFJLHdDQUFxQixDQUFDLENBQUU7b0JBQzlCLE9BQU8sRUFBRSxvQ0FBb0MsR0FBRyxHQUFHO29CQUNuRCxJQUFJLEVBQUUsQ0FBRSxHQUFHLENBQUU7aUJBQ2hCLENBQUUsQ0FBQyxDQUFDO1FBQ1QsQ0FBQztJQUNMLENBQUM7SUFFRCxhQUFhO0lBQ2Isa0ZBQWtGO0lBRWxGLDRGQUE0RjtJQUM1RixNQUFNLFVBQVUsR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7UUFDOUMsYUFBYSxFQUFFLFFBQVE7UUFDdkIsVUFBVTtRQUNWLGlCQUFpQixFQUFFLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRTtRQUN2RCx1QkFBdUIsRUFBRSxNQUFNLGFBQWEsQ0FBQywwQ0FBMEMsRUFBRTtRQUN6RixLQUFLLEVBQUUsVUFBVTtRQUNqQixLQUFLLEVBQUUsS0FBSztLQUNmLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDbkIsTUFBTSxJQUFJLHdDQUFxQixDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN2RCxDQUFDO0lBRUQsdUJBQXVCO0lBQ3ZCLDRIQUE0SDtJQUM1SCwyQkFBMkI7SUFDM0IsdUZBQXVGO0lBQ3ZGLElBQUk7SUFFSixpQ0FBaUM7SUFDakMsTUFBTSxnQ0FBZ0MsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBRTNELElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ2pCLEtBQUssTUFBTSxTQUFTLElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3JDLE1BQU0sZUFBZSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUUsU0FBUyxDQUFFLENBQUM7WUFDcEQsSUFBSSxlQUFlLEVBQUUsQ0FBQztnQkFDbEIsTUFBTSxXQUFXLEdBQUcsZUFBZSxDQUFDLEVBQUUsRUFBRSxTQUFTLENBQUM7Z0JBQ2xELElBQUksV0FBVyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztvQkFDNUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLGdDQUFnQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO2dCQUM1RSxDQUFDO2dCQUNELE1BQU0sV0FBVyxHQUFHLGVBQWUsQ0FBQyxFQUFFLEVBQUUsU0FBUyxDQUFDO2dCQUNsRCxJQUFJLFdBQVcsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7b0JBQzVDLFdBQVcsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxnQ0FBZ0MsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztnQkFDNUUsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVELElBQUksbUNBQW1DLEdBQXdCLEVBQUUsQ0FBQztJQUVsRSxJQUFJLGdDQUFnQyxDQUFDLElBQUksR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM1QyxJQUFJLGdCQUFnQixJQUFJLE9BQU8sZ0JBQWdCLEtBQUssUUFBUSxFQUFFLENBQUM7WUFFM0QsTUFBTSxDQUFDLEtBQUssQ0FBQyw2Q0FBNkMsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1lBRTlFLG1DQUFtQyxHQUFHLGdCQUFnQixDQUFDO1lBRXZELGlGQUFpRjtZQUNqRixNQUFNLG1CQUFtQixHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQ25GLE9BQU8sQ0FDSCxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDOzt3QkFFdkQsQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQzs7d0JBRWpDLENBQUMsbUNBQW1DLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUM1RCxDQUFDO1lBQ04sQ0FBQyxDQUFDLENBQUM7WUFFSCxJQUFJLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDakMsTUFBTSxDQUFDLElBQUksQ0FBQyw0RUFBNEUsbUJBQW1CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1lBQ2pMLENBQUM7UUFFTCxDQUFDO2FBQU0sQ0FBQztZQUVKLE1BQU0sQ0FBQyxLQUFLLENBQUMsb0ZBQW9GLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDLENBQUM7WUFFakosbUNBQW1DLEdBQUcsTUFBTSxtQ0FBbUMsQ0FBQztnQkFDNUUsVUFBVTtnQkFDVixhQUFhO2dCQUNiLFdBQVcsRUFBRSxXQUFXO2dCQUN4QixJQUFJLEVBQUUsVUFBVTtnQkFDaEIsMkJBQTJCLEVBQUUsZ0NBQWdDO2dCQUM3RCxNQUFNO2FBQ1QsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztJQUVMLENBQUM7U0FBTSxDQUFDO1FBQ0osTUFBTSxDQUFDLEtBQUssQ0FBQyxzRUFBc0UsQ0FBQyxDQUFDO0lBQ3pGLENBQUM7SUFDRCxxQ0FBcUM7SUFJckMsZ0VBQWdFO0lBQ2hFLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUNqRCxNQUFNLFlBQVksR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBR25ELE1BQU0sS0FBSyxHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUMsVUFBNkIsQ0FBQyxDQUFDO0lBRTlELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM5RCxNQUFNLENBQUMsS0FBSyxDQUFDLDZDQUE2QyxFQUFFLG1DQUFtQyxDQUFDLENBQUM7UUFDakcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDO0lBQ3pELENBQUM7SUFFRCxJQUFJLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDNUIsS0FBSyxDQUFDLE1BQU0sQ0FBQyxjQUFvQyxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVELE1BQU0sTUFBTSxHQUFHLE1BQU0seUJBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FDaEUsS0FBSyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEdBQUcseUJBQWEsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUMsQ0FDeEQsQ0FBQztJQUVGLGlCQUFpQjtJQUNqQiw4RkFBOEY7SUFFOUYsaUJBQWlCO0lBQ2pCLE1BQU0sQ0FBQyxLQUFLLENBQUMsd0RBQXdELFVBQVUsZ0JBQWdCLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxjQUFjLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRXRKLE9BQU8sTUFBaUMsQ0FBQztBQUM3QyxDQUFDO0FBMEJEOzs7O0dBSUc7QUFDSSxLQUFLLFVBQVUsWUFBWSxDQUF3QyxPQUE0QjtJQUVsRyxNQUFNLEVBQ0YsRUFBRSxFQUNGLFVBQVUsRUFDVixhQUFhLEVBRWIsS0FBSyxFQUNMLE1BQU0sRUFFTixRQUFRLEdBQUcsUUFBUSxFQUNuQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLDJCQUEyQixDQUFDLEVBQ2xELFNBQVMsR0FBRyw2QkFBZ0IsRUFDNUIsVUFBVSxHQUFHLHNCQUFVLENBQUMsT0FBTyxFQUMvQixlQUFlLEdBQUcsdUJBQWUsQ0FBQyxPQUFPLEdBRTVDLEdBQUcsT0FBTyxDQUFDO0lBRVosTUFBTSxDQUFDLEtBQUssQ0FBQyxrREFBa0QsVUFBVSxRQUFRLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFFdkYsZ0ZBQWdGO0lBRWhGLE1BQU0sV0FBVyxHQUFHLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUUvRCxzQkFBc0I7SUFDdEIsd0dBQXdHO0lBQ3hHLDJCQUEyQjtJQUMzQix1RkFBdUY7SUFDdkYsSUFBSTtJQUVKLFdBQVc7SUFDWCxNQUFNLFVBQVUsR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7UUFDOUMsYUFBYSxFQUFFLFFBQVE7UUFDdkIsVUFBVTtRQUNWLGlCQUFpQixFQUFFLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRTtRQUN2RCx1QkFBdUIsRUFBRSxNQUFNLGFBQWEsQ0FBQywwQ0FBMEMsRUFBRTtRQUN6RixLQUFLLEVBQUUsV0FBVztRQUNsQixLQUFLLEVBQUUsS0FBSztLQUNmLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDbkIsTUFBTSxJQUFJLHdDQUFxQixDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN2RCxDQUFDO0lBRUQsTUFBTSxNQUFNLEdBQUcsTUFBTSx5QkFBYSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxDQUNoRSxhQUFhLENBQUMsYUFBYSxFQUFFLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEdBQUcseUJBQWEsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUMsQ0FDcEcsQ0FBQztJQUVGLDhFQUE4RTtJQUU5RSxNQUFNLENBQUMsS0FBSyxDQUFDLHFEQUFxRCxVQUFVLFFBQVEsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUUxRixPQUFPLE1BQWlDLENBQUM7QUFDN0MsQ0FBQztBQXFCRDs7OztHQUlHO0FBQ0ksS0FBSyxVQUFVLGlCQUFpQixDQUF3QyxPQUFpQztJQUM1RyxNQUFNLEVBQ0YsR0FBRyxFQUNILFVBQVUsRUFDVixhQUFhLEVBQ2IsVUFBVSxHQUFHLENBQUMsRUFFZCxLQUFLLEVBQ0wsTUFBTSxFQUVOLFFBQVEsR0FBRyxRQUFRLEVBQ25CLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsZ0NBQWdDLENBQUMsRUFDdkQsU0FBUyxHQUFHLDZCQUFnQixFQUM1QixVQUFVLEdBQUcsc0JBQVUsQ0FBQyxPQUFPLEVBQy9CLGVBQWUsR0FBRyx1QkFBZSxDQUFDLE9BQU8sR0FDNUMsR0FBRyxPQUFPLENBQUM7SUFFWixNQUFNLENBQUMsS0FBSyxDQUFDLHVEQUF1RCxVQUFVLEdBQUcsRUFBRSxFQUFFLEdBQUcsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBRXhHLGlEQUFpRDtJQUNqRCxNQUFNLGdCQUFnQixHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUVuRixrQ0FBa0M7SUFDbEMsTUFBTSxXQUFXLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUMsV0FBVyxFQUFDLEVBQUUsQ0FDM0UsU0FBUyxDQUFDLGNBQWMsQ0FBQztRQUNyQixhQUFhLEVBQUUsUUFBUTtRQUN2QixVQUFVO1FBQ1YsaUJBQWlCLEVBQUUsYUFBYSxDQUFDLG9CQUFvQixFQUFFO1FBQ3ZELHVCQUF1QixFQUFFLE1BQU0sYUFBYSxDQUFDLDBDQUEwQyxFQUFFO1FBQ3pGLEtBQUssRUFBRSxXQUFXO1FBQ2xCLEtBQUssRUFBRSxLQUFLO0tBQ2YsQ0FBQyxDQUNMLENBQUMsQ0FBQztJQUVILDhCQUE4QjtJQUM5QixNQUFNLGdCQUFnQixHQUFHLFdBQVc7U0FDL0IsR0FBRyxDQUFDLENBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1NBQ25ELE1BQU0sQ0FBQyxDQUFDLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRWxELElBQUksZ0JBQWdCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzlCLE1BQU0sSUFBSSx3Q0FBcUIsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFFLENBQy9FLENBQUMsVUFBVSxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3BDLEdBQUcsS0FBSztZQUNSLE9BQU8sRUFBRSxRQUFRLEtBQUssS0FBSyxLQUFLLENBQUMsT0FBTyxFQUFFO1NBQzdDLENBQUMsQ0FBQyxDQUNOLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCwwREFBMEQ7SUFDMUQsc0VBQXNFO0lBQ3RFLHVFQUF1RTtJQUN2RSxNQUFNLFdBQVcsR0FBeUI7UUFDdEMsV0FBVyxFQUFFLFVBQVU7S0FDMUIsQ0FBQztJQUVGLE1BQU0sYUFBYSxHQUFHLE1BQU0seUJBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLGFBQWEsRUFBRSxHQUFHLEVBQUUsQ0FDNUUsYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsRUFDdEUsRUFBRSxTQUFTLEVBQUUsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLENBQ3pDLENBQUM7SUFFRixNQUFNLENBQUMsS0FBSyxDQUFDLDBEQUEwRCxVQUFVLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUVqRyxPQUFPLGFBQWEsQ0FBQztBQUN6QixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFnQixlQUFlLENBQUMsT0FBd0M7SUFDcEUsSUFBSSxDQUFDLE9BQU87UUFBRSxPQUFPLEVBQUUsQ0FBQztJQUV4QixNQUFNLE1BQU0sR0FBd0IsRUFBRSxDQUFDO0lBQ3ZDLEtBQUssTUFBTSxDQUFFLEdBQUcsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDbkQsSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUN0RCxNQUFNLENBQUUsR0FBRyxDQUFFLEdBQUcsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUM3QixDQUFDO2FBQU0sQ0FBQztZQUNKLE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxLQUFLLENBQUM7UUFDMUIsQ0FBQztJQUNMLENBQUM7SUFDRCxPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQsbUVBQW1FO0FBRW5FLHNEQUFzRDtBQUN0RCw0Q0FBNEM7QUFDNUMsUUFBUTtBQUVSLDBEQUEwRDtBQUMxRCw4Q0FBOEM7QUFDOUMsUUFBUTtBQUVSLDBEQUEwRDtBQUMxRCw4Q0FBOEM7QUFDOUMsUUFBUTtBQUVSLG9EQUFvRDtBQUNwRCwyQ0FBMkM7QUFDM0MsUUFBUTtBQUVSLDBEQUEwRDtBQUMxRCw4Q0FBOEM7QUFDOUMsUUFBUTtBQUNSLElBQUk7QUFHSixtRUFBbUUiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEJ1bGtPcHRpb25zIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHsgQXV0aG9yaXplciB9IGZyb20gXCIuLi9hdXRob3JpemVcIjtcbmltcG9ydCB7IEV2ZW50RGlzcGF0Y2hlciB9IGZyb20gXCIuLi9ldmVudFwiO1xuaW1wb3J0IHsgSUxvZ2dlciwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IGlzRW1wdHlPYmplY3QsIHJlbW92ZUVtcHR5IH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCB0eXBlIElWYWxpZGF0b3IgfSBmcm9tIFwiLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYSwgRW50aXR5U2NoZW1hLCBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWEsIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgVEVudGl0eU9wc0lucHV0U2NoZW1hcyB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgeyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IgfSBmcm9tIFwiLi9lcnJvcnMvdmFsaWRhdGlvbi1lcnJvclwiO1xuaW1wb3J0IHtcbiAgICBpc1BsYWluRW50aXR5UGF5bG9hZCxcbiAgICBpc1NjaGVtYUF0dHJpYnV0ZU5hbWUsXG4gICAgcGFydGl0aW9uVG9wTGV2ZWxKc29uTnVsbHMsXG59IGZyb20gXCIuL211dGF0aW9uLXV0aWxzXCI7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbiB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVF1ZXJ5IH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7IE1ldHJpY09ic2VydmVyLCBTcGFuT2JzZXJ2ZXIsIFF1ZXJ5T2JzZXJ2ZXIgfSBmcm9tIFwiLi4vb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnNcIjtcblxuLyoqXG4gKiBcbiAqIFNlcmlhbGl6ZXIvZm9ybWF0dGVyXG4gKiAgLSBodHRwczovL2dpdGh1Yi5jb20vZGt6bHYvbWljcm8tdHJhbnNmb3JtXG4gKiAgXG4gKiBFdmVudCBkaXNwYXRjaGVyXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9Gb3hBbmRGbHkvdHMtZXZlbnQtZGlzcGF0Y2hlci9ibG9iL21hc3Rlci9zcmMvaW5kZXgudHNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL3J5YXJkbGV5L3RzLWJ1c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vYmluaWVyL3RpbnktdHlwZWQtZW1pdHRlci90cmVlL21hc3RlclxuICogXG4gKiBSb3V0ZXJcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL2JlcnN0ZW5kL3RpbnktcmVxdWVzdC1yb3V0ZXIvYmxvYi9tYXN0ZXIvc3JjL3JvdXRlci50c1xuICogXG4gKiBESVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbmljb2pzL3R5cGVkLWluamVjdFxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbWljcm9zb2Z0L3RzeXJpbmdlXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9vd2phL2lvY1xuICogXG4gKiBcbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhc2VFbnRpdHlDcnVkQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcblxuICAgIGNydWRUeXBlPzoga2V5b2YgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuICAgIGFjdG9yPzogQWN0b3I7IC8vIEFjdG9yIGNvbnRleHQ6IGNvbXByZWhlbnNpdmUgYWN0b3IgaW5mb3JtYXRpb24gaW5jbHVkaW5nIGF1dGhlbnRpY2F0aW9uIGRldGFpbHNcbiAgICB0ZW5hbnQ/OiBhbnk7IC8vIHRvZG86IGRlZmluZSB0ZW5hbnQgY29udGV4dFxuXG4gICAgbG9nZ2VyPzogSUxvZ2dlcjtcbiAgICB2YWxpZGF0b3I/OiBJVmFsaWRhdG9yO1xuICAgIGF1dGhvcml6ZXI/OiBBdXRob3JpemVyLklBdXRob3JpemVyOyAgICAgICAgLy8gdG9kbzogZGVmaW5lIGF1dGhvcml6ZXIgc2lnbmF0dXJlXG4gICAgZXZlbnREaXNwYXRjaGVyPzogRXZlbnREaXNwYXRjaGVyLklFdmVudERpc3BhdGNoZXI7ICAvLyB0b2RvIGRlZmluZSBldmVudCBkaXNwYXRjaGVyIHNpZ25hdHVyZVxuXG4gICAgLy8gdGVsZW1ldHJ5XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIHJldHJpZXZlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byBpbmNsdWRlIGluIHRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xufVxuXG4vKipcbiAqIFJlc3BvbnNlIHR5cGUgZm9yIGdldCBlbnRpdHkgb3BlcmF0aW9uLlxuICogUHJvdmlkZXMgYSB0eXBlZCB3cmFwcGVyIGZvciB0aGUgZWxlY3Ryb2RiIGdldCByZXNwb25zZS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgdHlwZSBHZXRFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbi8qKlxuICogUmV0cmlldmVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHJldHJpZXZpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IEdldEVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPEdldEVudGl0eVJlc3BvbnNlPFM+PiB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZ2V0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Z2V0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkLCBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZUdldCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGlkZW50aWZpZXJzLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciBnZXQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cblxuICAgIC8vIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2dldCcsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVycykuZ28oeyBhdHRyaWJ1dGVzLCAuLi5RdWVyeU9ic2VydmVyLmdldENhcGFjaXR5R29PcHRpb25zKCkgfSlcbiAgICApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2FmdGVyR2V0JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgR2V0RW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2guXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gcmV0cmlldmUuXG4gICAgICovXG4gICAgaWRzOiBBcnJheTxPcHNTY2hlbWFbICdnZXQnIF0+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmV0cmlldmVkIGVudGl0aWVzLlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqL1xuICAgIGNvbmN1cnJlbnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgcmV0cmlldmluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRCYXRjaEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRCYXRjaEVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkcyxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgY29uY3VycmVudCA9IDEsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdnZXQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpnZXRCYXRjaEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZHMsIGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZvciBhbGwgaXRlbXMgaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlkcy5tYXAoaWQgPT4gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuICAgIC8vIFZhbGlkYXRlIGVhY2ggaXRlbSBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCB2YWxpZGF0aW9ucyA9IGF3YWl0IFByb21pc2UuYWxsKGlkZW50aWZpZXJzQmF0Y2gubWFwKGFzeW5jIGlkZW50aWZpZXJzID0+XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhY3RvcjogYWN0b3JcbiAgICAgICAgfSlcbiAgICApKTtcblxuICAgIC8vIENoZWNrIGZvciB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uc1xuICAgICAgICAubWFwKCh2YWxpZGF0aW9uLCBpbmRleCkgPT4gKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgdmFsaWRhdGlvbiB9KSA9PiAhdmFsaWRhdGlvbi5wYXNzKTtcblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uRXJyb3JzLmZsYXRNYXAoKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkgPT5cbiAgICAgICAgICAgICh2YWxpZGF0aW9uLmVycm9ycyB8fCBbXSkubWFwKGVycm9yID0+ICh7XG4gICAgICAgICAgICAgICAgLi4uZXJyb3IsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYEl0ZW0gJHtpbmRleH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgKSk7XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBiYXRjaCBnZXQgb3BlcmF0aW9uIHdpdGggY29uY3VycmVuY3kgY29udHJvbFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2JhdGNoR2V0JywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZ2V0KGlkZW50aWZpZXJzQmF0Y2gpLmdvKHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBjb25jdXJyZW50LFxuICAgICAgICAgICAgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpLFxuICAgICAgICB9KSxcbiAgICAgICAgeyBpdGVtQ291bnQ6IGlkZW50aWZpZXJzQmF0Y2gubGVuZ3RoIH1cbiAgICApO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGdldEJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkczpgLCBpZHMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZGF0YTogQXJyYXkuaXNBcnJheShyZXN1bHQuZGF0YSkgPyByZXN1bHQuZGF0YSA6IChyZXN1bHQuZGF0YSA/IFsgcmVzdWx0LmRhdGEgXSA6IFtdKSxcbiAgICAgICAgdW5wcm9jZXNzZWQ6IFtdICAvLyBFbGVjdHJvREIgZG9lc24ndCBzdXBwb3J0IHVucHJvY2Vzc2VkIGl0ZW1zIHRyYWNraW5nLCBzbyB3ZSByZXR1cm4gZW1wdHkgYXJyYXlcbiAgICB9O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENyZWF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAnY3JlYXRlJyBdO1xufVxuXG5leHBvcnQgdHlwZSBDcmVhdGVFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgdXNpbmcgdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkuXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIGNyZWF0ZSBvcGVyYXRpb24sIHZhbGlkYXRpb24gZmFpbHMsIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogQ3JlYXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8Q3JlYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdjcmVhdGUnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpjcmVhdGVFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiBjcmVhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhKTtcblxuICAgIGlmICghaXNQbGFpbkVudGl0eVBheWxvYWQoZGF0YSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YSBwcm92aWRlZCBmb3IgY3JlYXRlIG9wZXJhdGlvblwiKTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHNldFBheWxvYWQsIG51bGxSZW1vdmFsS2V5cyB9ID0gcGFydGl0aW9uVG9wTGV2ZWxKc29uTnVsbHMoZGF0YSk7XG5cbiAgICBpZiAobnVsbFJlbW92YWxLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBjcmVhdGVFbnRpdHk6IG9taXR0ZWQgdG9wLWxldmVsIG51bGwga2V5cyAob3B0aW9uYWwgYXR0cnMgbm90IHNldCBvbiBuZXcgaXRlbSk6YCwgbnVsbFJlbW92YWxLZXlzKTtcbiAgICB9XG5cbiAgICAvLyBwcmUgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYmVmb3JlQ3JlYXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogc2V0UGF5bG9hZCxcbiAgICAgICAgYWN0b3I6IGFjdG9yLFxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgZGF0YTogc2V0UGF5bG9hZEZvclN0b3JlLCBhY3RvciwgdGVuYW50IH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgY3JlYXRlOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuICAgIHR5cGUgQ3JlYXRlUmVjb3JkSW5wdXQgPSBQYXJhbWV0ZXJzPHR5cGVvZiByZXBvc2l0b3J5LmNyZWF0ZT5bIDAgXTtcblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2NyZWF0ZScsICgpID0+XG4gICAgICAgIHJlcG9zaXRvcnkuY3JlYXRlKHNldFBheWxvYWQgYXMgQ3JlYXRlUmVjb3JkSW5wdXQpLmdvKHsgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pXG4gICAgKTtcblxuICAgIC8vIHBvc3QgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJDcmVhdGUnLCBjb250ZXh0OiB7Li4uYXJndW1lbnRzLCBlbnRpdHl9IH0pO1xuXG4gICAgLy8gcmV0dXJuIGVudGl0eTtcbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gY3JlYXRlIH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgc2V0UGF5bG9hZCwgZW50aXR5LmRhdGEpO1xuXG4gICAgcmV0dXJuIGVudGl0eSBhcyBDcmVhdGVFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwc2VydEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAndXBzZXJ0JyBdO1xufVxuXG5leHBvcnQgdHlwZSBVcHNlcnRFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG4gICAgd2FzQ3JlYXRlZD86IGJvb2xlYW4gIC8vIHRydWUgaWYgcmVjb3JkIHdhcyBjcmVhdGVkLCBmYWxzZSBpZiBhbHJlYWR5IGV4aXN0ZWRcbiAgICBvbGREYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPiAgLy8gcHJldmlvdXMgZGF0YSBpZiBpdCB3YXMgYW4gdXBkYXRlICh1bmRlZmluZWQgZm9yIGNyZWF0ZXMpXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgdXNpbmcgdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nLU9SLXVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkgd2l0aCB3YXNDcmVhdGVkIGZsYWcgaW5kaWNhdGluZyBpZiBpdCB3YXMgYSBuZXcgcmVjb3JkLlxuICogQHRocm93cyBFcnJvciBpZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciB1cHNlcnQgb3BlcmF0aW9uLCB2YWxpZGF0aW9uIGZhaWxzLCBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBzZXJ0RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IFVwc2VydEVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPFVwc2VydEVudGl0eVJlc3BvbnNlPFM+PiB7XG4gICAgY29uc3Qge1xuICAgICAgICBkYXRhLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAndXBzZXJ0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6dXBzZXJ0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSk7XG5cbiAgICBpZiAoIWlzUGxhaW5FbnRpdHlQYXlsb2FkKGRhdGEpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIGRhdGEgcHJvdmlkZWQgZm9yIHVwc2VydCBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgY29uc3QgeyBzZXRQYXlsb2FkLCBudWxsUmVtb3ZhbEtleXMgfSA9IHBhcnRpdGlvblRvcExldmVsSnNvbk51bGxzKGRhdGEpO1xuXG4gICAgaWYgKG51bGxSZW1vdmFsS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgdXBzZXJ0RW50aXR5OiBvbWl0dGVkIHRvcC1sZXZlbCBudWxsIGtleXMgZnJvbSB1cHNlcnQgcGF5bG9hZDpgLCBudWxsUmVtb3ZhbEtleXMpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVVcHNlcnQnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBzZXRQYXlsb2FkLFxuICAgICAgICBhY3RvcjogYWN0b3IsXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBkYXRhOiBzZXRQYXlsb2FkLCBhY3RvciwgdGVuYW50IH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgdXBzZXJ0OiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuICAgIHR5cGUgVXBzZXJ0UmVjb3JkSW5wdXQgPSBQYXJhbWV0ZXJzPHR5cGVvZiByZXBvc2l0b3J5LnVwc2VydD5bIDAgXTtcblxuICAgIC8vIFVzZSBcImFsbF9vbGRcIiB0byBnZXQgdGhlIHByZXZpb3VzIGl0ZW0gc3RhdGUgLSBhbGxvd3MgdXMgdG8gZGV0ZWN0IGNyZWF0ZSB2cyB1cGRhdGVcbiAgICAvLyBJZiBvbGREYXRhIGlzIGVtcHR5L251bGwsIGl0IHdhcyBhIENSRUFURS4gSWYgaXQgaGFzIGRhdGEsIGl0IHdhcyBhbiBVUERBVEUuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAndXBzZXJ0JywgKCkgPT5cbiAgICAgICAgcmVwb3NpdG9yeS51cHNlcnQoc2V0UGF5bG9hZCBhcyBVcHNlcnRSZWNvcmRJbnB1dCkuZ28oeyByZXNwb25zZTogXCJhbGxfb2xkXCIsIC4uLlF1ZXJ5T2JzZXJ2ZXIuZ2V0Q2FwYWNpdHlHb09wdGlvbnMoKSB9KVxuICAgICk7XG5cbiAgICBjb25zdCB3YXNDcmVhdGVkID0gIWVudGl0eS5kYXRhIHx8IE9iamVjdC5rZXlzKGVudGl0eS5kYXRhKS5sZW5ndGggPT09IDA7XG4gICAgY29uc3Qgb2xkRGF0YSA9IHdhc0NyZWF0ZWQgPyB1bmRlZmluZWQgOiBlbnRpdHkuZGF0YTtcblxuICAgIC8vIHBvc3QgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJVcHNlcnQnLCBjb250ZXh0OiB7Li4uYXJndW1lbnRzLCBlbnRpdHl9IH0pO1xuXG4gICAgLy8gcmV0dXJuIGVudGl0eTtcbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IHdhc0NyZWF0ZWQ6ICR7d2FzQ3JlYXRlZH1gKTtcblxuICAgIC8vIE5vdGU6IHdpdGggXCJhbGxfb2xkXCIsIGVudGl0eS5kYXRhIGNvbnRhaW5zIHRoZSBPTEQgZGF0YSwgd2UgbmVlZCB0byByZXR1cm4gdGhlIE5FVyBkYXRhXG4gICAgLy8gU2luY2Ugd2UgZG9uJ3QgaGF2ZSB0aGUgbmV3IGRhdGEgZnJvbSBEeW5hbW9EQiwgd2UgcmV0dXJuIHRoZSBpbnB1dCBkYXRhIGFzIHRoZSBuZXcgZGF0YVxuICAgIC8vIEVjaG8gcGVyc2lzdGVkIGZpZWxkczogRWxlY3Ryb0RCIHVwc2VydC5nbyh7IHJlc3BvbnNlOiBcImFsbF9vbGRcIiB9KSBkb2VzIG5vdCByZXR1cm4gdGhlIG5ldyBpdGVtIGltYWdlLlxuICAgIHJldHVybiB7XG4gICAgICAgIGRhdGE6IHNldFBheWxvYWQsXG4gICAgICAgIHdhc0NyZWF0ZWQsXG4gICAgICAgIG9sZERhdGFcbiAgICB9IGFzIFVwc2VydEVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgbGlzdGluZyBlbnRpdGllcy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExpc3RFbnRpdHlBcmdzPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgcXVlcnk6IEVudGl0eVF1ZXJ5PFNjaD5cbn1cblxuLyoqXG4gKiBPcGVyYXRvcnMgdGhhdCBzaG91bGQgTk9UIGJlIHVzZWQgZm9yIGluZGV4IG1hdGNoaW5nLlxuICogVGhlc2Ugb3BlcmF0b3JzIGxvb2sgZm9yIHJlY29yZHMgd2hlcmUgdGhlIGF0dHJpYnV0ZSBkb2Vzbid0IGV4aXN0IG9yIGlzIGVtcHR5LFxuICogYnV0IHRob3NlIHJlY29yZHMgd29uJ3QgYmUgaW4gYSBzcGFyc2UgR1NJIHdoZXJlIHRoYXQgYXR0cmlidXRlIGlzIHRoZSBQSy5cbiAqL1xuY29uc3QgSU5ERVhfRVhDTFVERURfT1BFUkFUT1JTID0gbmV3IFNldChbXG4gICAgJ25vdEV4aXN0cycsICdleGlzdHMnLCAnaXNOdWxsJywgJ25vdE51bGwnLCAnZW1wdHknLCAnbm90RW1wdHknXG5dKTtcblxuLyoqXG4gKiBDb252ZXJ0IEZpbHRlckdyb3VwIGZvcm1hdCB0byBzaW1wbGUgb2JqZWN0IGZvcm1hdCBmb3IgaW5kZXggbWF0Y2hpbmcuXG4gKiBGaWx0ZXJHcm91cDogeyBhbmQ6IFt7IGF0dHJpYnV0ZTogJ2ZvbycsIGVxOiAnYmFyJyB9XSB9XG4gKiBTaW1wbGU6IHsgZm9vOiB7IGVxOiAnYmFyJyB9IH1cbiAqIFxuICogT25seSBleHRyYWN0cyBmaWx0ZXJzIGZyb20gdGhlICdhbmQnIGFycmF5IGFzIHRob3NlIGFyZSB0aGUgb25lc1xuICogdGhhdCBjYW4gYmUgdXNlZCBmb3IgR1NJIHBhcnRpdGlvbiBrZXkgbWF0Y2hpbmcuXG4gKiBcbiAqIEV4Y2x1ZGVzIGV4aXN0ZW5jZS9udWxsIGZpbHRlcnMgKG5vdEV4aXN0cywgaXNOdWxsLCBlbXB0eSwgZXRjLikgZnJvbSBpbmRleFxuICogbWF0Y2hpbmcgc2luY2UgcmVjb3JkcyB3aXRoIG1pc3NpbmcgYXR0cmlidXRlcyB3b24ndCBiZSBpbiBzcGFyc2UgR1NJcy5cbiAqIFxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVycyBpbiBGaWx0ZXJHcm91cCBvciBzaW1wbGUgZm9ybWF0XG4gKiBAcmV0dXJucyBGaWx0ZXJzIGluIHNpbXBsZSBvYmplY3QgZm9ybWF0IHsgYXR0cjogeyBvcDogdmFsIH0gfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgLy8gQWxyZWFkeSBpbiBzaW1wbGUgZm9ybWF0IG9yIGVtcHR5XG4gICAgaWYgKCFmaWx0ZXJzIHx8ICEoJ2FuZCcgaW4gZmlsdGVycykpIHtcbiAgICAgICAgcmV0dXJuIGZpbHRlcnMgfHwge307XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltcGxlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICAvLyBFeHRyYWN0IGZyb20gJ2FuZCcgYXJyYXkgLSB0aGVzZSBhcmUgQU5EIGNvbmRpdGlvbnMgdGhhdCBjb3VsZCBtYXRjaCBHU0kgUEtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgZmlsdGVycy5hbmQgfHwgW10pIHtcbiAgICAgICAgaWYgKGl0ZW0uYXR0cmlidXRlKSB7XG4gICAgICAgICAgICBjb25zdCBvcGVyYXRvcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoaXRlbSkpIHtcbiAgICAgICAgICAgICAgICAvLyBTa2lwIHRoZSAnYXR0cmlidXRlJyBrZXkgYW5kIGV4Y2x1ZGUgZXhpc3RlbmNlL251bGwgb3BlcmF0b3JzIGZyb20gaW5kZXggbWF0Y2hpbmdcbiAgICAgICAgICAgICAgICAvLyBSZWNvcmRzIHdpdGggbWlzc2luZyBhdHRyaWJ1dGVzIHdvbid0IGJlIGluIHNwYXJzZSBHU0lzXG4gICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gJ2F0dHJpYnV0ZScgJiYgIUlOREVYX0VYQ0xVREVEX09QRVJBVE9SUy5oYXMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBvcGVyYXRvcnNbIGtleSBdID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKG9wZXJhdG9ycykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHNpbXBsZVsgaXRlbS5hdHRyaWJ1dGUgXSA9IG9wZXJhdG9ycztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzaW1wbGU7XG59XG5cbi8qKlxuICogRXJyb3IgdGhyb3duIHdoZW4gaW52YWxpZCBmaWx0ZXIgb3BlcmF0b3JzIGFyZSB1c2VkIGluIGluZGV4LmZpbHRlcnMuXG4gKi9cbmV4cG9ydCBjbGFzcyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGludmFsaWRPcGVyYXRvcnM6IHN0cmluZ1tdLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgaW5kZXhOYW1lPzogc3RyaW5nXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IGluZGV4Q29udGV4dCA9IGluZGV4TmFtZSA/IGAgZm9yIGluZGV4IFwiJHtpbmRleE5hbWV9XCJgIDogJyc7XG4gICAgICAgIHN1cGVyKFxuICAgICAgICAgICAgYEludmFsaWQgZmlsdGVyIG9wZXJhdG9yKHMpIFske2ludmFsaWRPcGVyYXRvcnMuam9pbignLCAnKX1dIGZvciBhdHRyaWJ1dGUgXCIke2F0dHJpYnV0ZU5hbWV9XCIke2luZGV4Q29udGV4dH0uIGAgK1xuICAgICAgICAgICAgYEdTSSBjb21wb3NpdGUga2V5IGF0dHJpYnV0ZXMgb25seSBzdXBwb3J0IGVxdWFsaXR5IG1hdGNoZXMuIGAgK1xuICAgICAgICAgICAgYFVzZSB7ICR7YXR0cmlidXRlTmFtZX06IHsgZXE6IHZhbHVlIH0gfSBvciB7ICR7YXR0cmlidXRlTmFtZX06IHZhbHVlIH0gZm9yIGNvbXBvc2l0ZSBrZXlzLiBgICtcbiAgICAgICAgICAgIGBGb3IgcmFuZ2Uvb3RoZXIgY29uZGl0aW9ucywgdXNlIHRvcC1sZXZlbCAnZmlsdGVycycgaW5zdGVhZCBvZiAnaW5kZXguZmlsdGVycycuYFxuICAgICAgICApO1xuICAgICAgICB0aGlzLm5hbWUgPSAnSW52YWxpZEluZGV4RmlsdGVyRXJyb3InO1xuICAgIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0cyBhbmQgdmFsaWRhdGVzIGNvbXBvc2l0ZSBrZXkgdmFsdWVzIGZyb20gaW5kZXguZmlsdGVycyBmb3IgRWxlY3Ryb0RCIGFjY2VzcyBwYXR0ZXJuIHF1ZXJpZXMuXG4gKiBcbiAqIER5bmFtb0RCIEdTSSBjb21wb3NpdGUga2V5cyBoYXZlIHNwZWNpZmljIGNvbnN0cmFpbnRzOlxuICogLSBQYXJ0aXRpb24gS2V5IChQSyk6IE1VU1QgYmUgYW4gZXF1YWxpdHkgbWF0Y2hcbiAqIC0gU29ydCBLZXkgKFNLKTogQ2FuIHVzZSByYW5nZSBvcGVyYXRvcnMsIGJ1dCB0aG9zZSBnbyBpbiB0b3AtbGV2ZWwgYGZpbHRlcnNgXG4gKiBcbiAqIFRoaXMgZnVuY3Rpb246XG4gKiAxLiBWYWxpZGF0ZXMgdGhhdCBvbmx5IGVxdWFsaXR5IG9wZXJhdG9ycyBhcmUgdXNlZFxuICogMi4gQ29udmVydHMgRlcyNCBmaWx0ZXIgc3ludGF4IHRvIEVsZWN0cm9EQiBmb3JtYXRcbiAqIDMuIFRIUk9XUyBpZiBpbnZhbGlkIG9wZXJhdG9ycyBhcmUgZGV0ZWN0ZWQgKGZhaWwgZmFzdCwgbm90IHNpbGVudGx5KVxuICogXG4gKiBAcGFyYW0gZmlsdGVycyAtIEZpbHRlcnMgZnJvbSBpbmRleC5maWx0ZXJzIChvbmx5IGVxdWFsaXR5IGFsbG93ZWQpXG4gKiBAcGFyYW0gaW5kZXhOYW1lIC0gTmFtZSBvZiB0aGUgaW5kZXggKGZvciBlcnJvciBtZXNzYWdlcylcbiAqIEByZXR1cm5zIENvbXBvc2l0ZSBrZXkgdmFsdWVzIGluIEVsZWN0cm9EQiBmb3JtYXRcbiAqIEB0aHJvd3MgSW52YWxpZEluZGV4RmlsdGVyRXJyb3IgaWYgbm9uLWVxdWFsaXR5IG9wZXJhdG9ycyBhcmUgdXNlZFxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gVmFsaWQgaW5wdXRzXG4gKiB7IHRlYW1JZDogeyBlcTogJ3RlYW0tMTIzJyB9IH0gIOKGkiAgeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfVxuICogeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfSAgICAgICAgIOKGkiAgeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfVxuICogXG4gKiAvLyBJbnZhbGlkIC0gd2lsbCBUSFJPV1xuICogeyBjcmVhdGVkQXQ6IHsgZ3Q6ICcyMDI0LTAxLTAxJyB9IH0gIC8vIEludmFsaWRJbmRleEZpbHRlckVycm9yXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoXG4gICAgZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBpbmRleE5hbWU/OiBzdHJpbmdcbik6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGlmICghZmlsdGVycykgcmV0dXJuIHt9O1xuXG4gICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGZpbHRlcnMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERpcmVjdCB2YWx1ZSAoc2hvcnRoYW5kIGZvciBlcXVhbGl0eSlcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJlc3VsdFsga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGZpbHRlciBvcGVyYXRvciBvYmplY3RzXG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IE9iamVjdC5rZXlzKHZhbHVlKTtcblxuICAgICAgICBpZiAob3BlcmF0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5ICdlcScgaXMgdmFsaWQgZm9yIGNvbXBvc2l0ZSBrZXkgYXR0cmlidXRlc1xuICAgICAgICBpZiAodmFsdWUuZXEgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIG1peGVkIG9wZXJhdG9ycyAoZXEgKyBvdGhlcnMpIC0gdGhhdCdzIGEgbWlzdGFrZVxuICAgICAgICAgICAgY29uc3Qgb3RoZXJPcHMgPSBvcGVyYXRvcnMuZmlsdGVyKG9wID0+IG9wICE9PSAnZXEnKTtcbiAgICAgICAgICAgIGlmIChvdGhlck9wcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRJbmRleEZpbHRlckVycm9yKGtleSwgb3RoZXJPcHMsIGluZGV4TmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWUuZXE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBOb24tZXF1YWxpdHkgb3BlcmF0b3JzIC0gdGhyb3cgaW1tZWRpYXRlbHlcbiAgICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcihrZXksIG9wZXJhdG9ycywgaW5kZXhOYW1lKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogRmluZHMgYSBtYXRjaGluZyBpbmRleCBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgZmlsdGVycyBhbmQgc2NoZW1hLlxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gZmlsdGVycyAtIFRoZSBmaWx0ZXJzIHRvIG1hdGNoIGFnYWluc3RcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGVudGl0eVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBUaGUgZW50aXR5IHNlcnZpY2VcbiAqIEByZXR1cm5zIFRoZSBuYW1lIG9mIHRoZSBtYXRjaGluZyBpbmRleCBhbmQgdGhlIGZpbHRlcnMgdXNlZCB0byBtYXRjaCBpdCBvciB1bmRlZmluZWQgaWYgbm8gbWF0Y2ggaXMgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbmRNYXRjaGluZ0luZGV4KFxuICAgIHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxhbnk+XG4pOiB7IGluZGV4TmFtZTogc3RyaW5nOyBpbmRleEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZmluZE1hdGNoaW5nSW5kZXgnKTtcbiAgICBpZiAoIWZpbHRlcnMpIGZpbHRlcnMgPSB7fTtcblxuICAgIC8vIENvbnZlcnQgRmlsdGVyR3JvdXAgZm9ybWF0IHRvIHNpbXBsZSBmb3JtYXQgZm9yIGluZGV4IG1hdGNoaW5nXG4gICAgY29uc3Qgc2ltcGxlRmlsdGVycyA9IGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVycyk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb252ZXJ0ZWQgZmlsdGVycyBmb3IgaW5kZXggbWF0Y2hpbmc6YCwgeyBvcmlnaW5hbDogZmlsdGVycywgc2ltcGxlOiBzaW1wbGVGaWx0ZXJzIH0pO1xuXG4gICAgLy8gRmlyc3QgdHJ5IEVsZWN0cm9EQidzIGluZGV4IG1hdGNoaW5nXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuICAgIGNvbnN0IHsga2V5cywgaW5kZXgsIHNob3VsZFNjYW4gfSA9IChyZXBvc2l0b3J5IGFzIGFueSkuX2ZpbmRCZXN0SW5kZXhLZXlNYXRjaChzaW1wbGVGaWx0ZXJzKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgRm91bmQgRWxlY3Ryb0RCIGluZGV4OiAke2luZGV4fSB3aXRoICR7a2V5cy5sZW5ndGh9IGF0dHJpYnV0ZSBtYXRjaGVzIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0gd2l0aCBmaWx0ZXJzIGFuZCBzY2FuOiAke3Nob3VsZFNjYW59IC0gYCwga2V5cywgc2ltcGxlRmlsdGVycyk7XG5cbiAgICAvLyBJZiB3ZSBmb3VuZCBhIG1hdGNoaW5nIGluZGV4LCB1c2UgaXRcbiAgICBpZiAoIXNob3VsZFNjYW4pIHtcbiAgICAgICAgY29uc3QgaW5kZXhGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICAgICAgLy8gQWRkIG1hdGNoZWQga2V5cyB0byBpbmRleEZpbHRlcnMgKHVzZSBzaW1wbGVGaWx0ZXJzIHdoaWNoIGhhcyB0aGUgcmlnaHQgZm9ybWF0KVxuICAgICAgICBrZXlzLmZvckVhY2goKGtleTogeyBuYW1lOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJWYWx1ZSA9IHNpbXBsZUZpbHRlcnNbIGtleS5uYW1lIF07XG4gICAgICAgICAgICBpZiAoZmlsdGVyVmFsdWUpIHtcbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgYm90aCB7IGVxOiB2YWx1ZSB9IGFuZCBkaXJlY3QgdmFsdWUgZm9ybWF0c1xuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyc1sga2V5Lm5hbWUgXSA9IGZpbHRlclZhbHVlLmVxICE9PSB1bmRlZmluZWQgPyBmaWx0ZXJWYWx1ZS5lcSA6IGZpbHRlclZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBNYXAgRWxlY3Ryb0RCJ3MgaW50ZXJuYWwgaW5kZXggbmFtZSBiYWNrIHRvIG91ciBzY2hlbWEncyBpbmRleCBuYW1lXG4gICAgICAgIGxldCBzY2hlbWFJbmRleE5hbWUgPSBpbmRleDtcbiAgICAgICAgaWYgKGluZGV4ID09PSAnJykge1xuICAgICAgICAgICAgc2NoZW1hSW5kZXhOYW1lID0gJ3ByaW1hcnknO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gRmluZCB0aGUgaW5kZXggaW4gb3VyIHNjaGVtYSB0aGF0IG1hdGNoZXMgdGhpcyBHU0lcbiAgICAgICAgICAgIGNvbnN0IGluZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBuYW1lLCBpbmRleERlZiBdIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4ZXMpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGluZGV4RGVmLmluZGV4ID09PSBpbmRleCkge1xuICAgICAgICAgICAgICAgICAgICBzY2hlbWFJbmRleE5hbWUgPSBuYW1lO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBsb2dnZXIuZGVidWcoYFVzaW5nIEVsZWN0cm9EQiBtYXRjaGVkIGluZGV4OiAke3NjaGVtYUluZGV4TmFtZX0gKGludGVybmFsOiAke2luZGV4fSkgd2l0aCAke2tleXMubGVuZ3RofSBhdHRyaWJ1dGUgbWF0Y2hlcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9IHdpdGggZmlsdGVyczpgLCBpbmRleEZpbHRlcnMpO1xuICAgICAgICByZXR1cm4geyBpbmRleE5hbWU6IHNjaGVtYUluZGV4TmFtZSwgaW5kZXhGaWx0ZXJzIH07XG4gICAgfVxuXG4gICAgLy8gSWYgbm8gaW5kZXggbWF0Y2ggZm91bmQsIGNoZWNrIGZvciB0ZW1wbGF0ZSBtYXRjaCBvciBcImFsbCByZWNvcmRzXCIgaW5kZXhcbiAgICBjb25zdCBpbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgZm9yIChjb25zdCBbIGluZGV4TmFtZSwgaW5kZXhEZWYgXSBvZiBPYmplY3QuZW50cmllcyhpbmRleGVzKSkge1xuICAgICAgICBpZiAoaW5kZXhEZWYucGsudGVtcGxhdGUgJiYgdHlwZW9mIGluZGV4RGVmLnBrLnRlbXBsYXRlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgLy8gRW50aXR5LXNwZWNpZmljIHRlbXBsYXRlIG1hdGNoXG4gICAgICAgICAgICBpZiAoaW5kZXhEZWYucGsudGVtcGxhdGUudG9Mb3dlckNhc2UoKSA9PT0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyB0ZW1wbGF0ZSBtYXRjaGluZyBpbmRleDogJHtpbmRleE5hbWV9IGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBcIkFsbCByZWNvcmRzXCIgaW5kZXggcGF0dGVybiAtIGNvbnN0YW50IFBLIHdpdGggZW1wdHkgY29tcG9zaXRlXG4gICAgICAgICAgICAvLyBVc2VmdWwgZm9yIHNvcnRlZCBsaXN0aW5ncyB3aXRob3V0IGZpbHRlcnMgKGUuZy4sIEFMTF9FVkVOVFMsIEFMTF9MT0dTKVxuICAgICAgICAgICAgaWYgKGluZGV4RGVmLnBrLmNvbXBvc2l0ZSAmJiBpbmRleERlZi5way5jb21wb3NpdGUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBcImFsbCByZWNvcmRzXCIgaW5kZXg6ICR7aW5kZXhOYW1lfSB3aXRoIGNvbnN0YW50IFBLIHRlbXBsYXRlOiAke2luZGV4RGVmLnBrLnRlbXBsYXRlfWApO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgbGlzdGluZyBlbnRpdGllcy5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIGFycmF5IG9mIGVudGl0aWVzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBMaXN0RW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnbGlzdCcsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmxpc3RFbnRpdHknKSxcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICAgICAgcXVlcnkgPSB7fSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZmlsdGVycyA9IHt9LFxuICAgICAgICBhdHRyaWJ1dGVzID0gW10sXG4gICAgICAgIC8vIERlZmF1bHQgdG8gdHJhdmVyc2luZyBhbGwgcGFnZXMgc28gc2VydmljZS1sZXZlbCBjYWxsZXJzIHJlY2VpdmUgdGhlXG4gICAgICAgIC8vIGNvbXBsZXRlIHJlc3VsdCBzZXQuIER5bmFtb0RCIGNhcHMgYSBzaW5nbGUgcGFnZSBhdCAxTUIsIHNvIGEgYm91bmRlZFxuICAgICAgICAvLyBkZWZhdWx0IHdvdWxkIHNpbGVudGx5IHRydW5jYXRlIGxhcmdlciByZXN1bHRzLiBDYWxsZXJzIHRoYXQgd2FudCBhXG4gICAgICAgIC8vIGJvdW5kZWQgcmVzdWx0IHNob3VsZCBwYXNzIGFuIGV4cGxpY2l0IGBjb3VudGAvYGxpbWl0YC5cbiAgICAgICAgcGFnaW5hdGlvbiA9IHsgb3JkZXI6ICdhc2MnLCBwYWdlcjogJ2N1cnNvcicsIGN1cnNvcjogbnVsbCwgcGFnZXM6ICdhbGwnIH0sXG4gICAgICAgIGluZGV4OiBzcGVjaWZpZWRJbmRleFxuICAgIH0gPSBxdWVyeTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBsaXN0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZUxpc3QnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgYWN0b3IsIHRlbmFudH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIENoZWNrIGlmIHdlIGhhdmUgYSBmaWx0ZXIgdGhhdCBtYXRjaGVzIGFuIGluZGV4XG4gICAgY29uc3Qgc2NoZW1hID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICBjb25zdCBtYXRjaFJlc3VsdCA9IHNwZWNpZmllZEluZGV4XG4gICAgICAgID8geyBpbmRleE5hbWU6IHNwZWNpZmllZEluZGV4Lm5hbWUsIGluZGV4RmlsdGVyczogZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHNwZWNpZmllZEluZGV4LmZpbHRlcnMsIHNwZWNpZmllZEluZGV4Lm5hbWUpIH1cbiAgICAgICAgOiBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlcnMsIGVudGl0eU5hbWUsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBNYXRjaCByZXN1bHQ6YCwgbWF0Y2hSZXN1bHQpO1xuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnbGlzdCcsICgpID0+XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LmdvKHsgYXR0cmlidXRlczogYXR0cmlidXRlcyBhcyBhbnksIC4uLnJlbW92ZUVtcHR5KHBhZ2luYXRpb24pLCAuLi5RdWVyeU9ic2VydmVyLmdldENhcGFjaXR5R29PcHRpb25zKCkgfSksXG4gICAgICAgICAgICB7IGZpbHRlcnMsIGluZGV4TmFtZTogbWF0Y2hSZXN1bHQuaW5kZXhOYW1lLCBwYWdpbmF0aW9uIH1cbiAgICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBVc2UgbWF0Y2ggZm9yIGZ1bGwgc2NhblxuICAgICAgICBsb2dnZXIud2FybihgV0FSTklORzogTm8gbWF0Y2hpbmcgaW5kZXggZm91bmQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSwgdXNpbmcgbWF0Y2ggZm9yIGZ1bGwgc2NhbmAsIGZpbHRlcnMpO1xuXG4gICAgICAgIC8vIFRyYWNrIGZ1bGwgc2NhbiAtIENSSVRJQ0FMOiBleHBlbnNpdmUgcGVyZm9ybWFuY2UvY29zdCBpc3N1ZVxuICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoYGVudGl0eS5mdWxsX3NjYW5gLCAxLCB7XG4gICAgICAgICAgICB0YWdzOiB7IGVudGl0eU5hbWUsIG9wZXJhdGlvbjogJ2xpc3QnIH0sXG4gICAgICAgICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgY2hlY2twb2ludCBmb3IgdmlzaWJpbGl0eVxuICAgICAgICBTcGFuT2JzZXJ2ZXIuZ2V0Q3VycmVudFNwYW4oKT8uY2hlY2twb2ludD8uKCdkYXRhYmFzZS5mdWxsX3NjYW4nLCB7XG4gICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmVudGl0eV9uYW1lJzogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAnZGIub3BlcmF0aW9uJzogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICdkYi53YXJuaW5nJzogJ25vX2luZGV4X2ZvdW5kJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmZ1bGxfc2Nhbic6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YTogeyBmdWxsU2NhbkZpbHRlcnM6IGZpbHRlcnMgfHwge30gfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3Qgc2NhblF1ZXJ5ID0gcmVwb3NpdG9yeS5zY2FuO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgc2NhblF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogYWRkIGF0dHJpYnV0ZXMgdG8gc2NhbiBxdWVyeVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3NjYW4nLCAoKSA9PlxuICAgICAgICAgICAgc2NhblF1ZXJ5LmdvKHsgLi4ucmVtb3ZlRW1wdHkocGFnaW5hdGlvbiksIC4uLlF1ZXJ5T2JzZXJ2ZXIuZ2V0Q2FwYWNpdHlHb09wdGlvbnMoKSB9KSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlckxpc3QnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gbGlzdEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIHJldHVybiBlbnRpdGllcztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBRdWVyeUVudGl0eUFyZ3M8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICBxdWVyeTogRW50aXR5UXVlcnk8U2NoPlxufVxuXG4vKipcbiAqIEV4ZWN1dGVzIGEgcXVlcnkgb24gdGhlIHNwZWNpZmllZCBlbnRpdHkuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciB0aGUgcXVlcnkuXG4gKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmVzdWx0IG9mIHRoZSBxdWVyeS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHF1ZXJ5RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IFF1ZXJ5RW50aXR5QXJnczxTPikge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAncXVlcnknLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpxdWVyeUVudGl0eScpLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgICAgICBxdWVyeSA9IHt9XG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZmlsdGVycyA9IHt9LFxuICAgICAgICBhdHRyaWJ1dGVzID0gW10sXG4gICAgICAgIC8vIERlZmF1bHQgdG8gdHJhdmVyc2luZyBhbGwgcGFnZXMgc28gc2VydmljZS1sZXZlbCBjYWxsZXJzIHJlY2VpdmUgdGhlXG4gICAgICAgIC8vIGNvbXBsZXRlIHJlc3VsdCBzZXQuIER5bmFtb0RCIGNhcHMgYSBzaW5nbGUgcGFnZSBhdCAxTUIsIHNvIGEgYm91bmRlZFxuICAgICAgICAvLyBkZWZhdWx0IHdvdWxkIHNpbGVudGx5IHRydW5jYXRlIGxhcmdlciByZXN1bHRzLiBDYWxsZXJzIHRoYXQgd2FudCBhXG4gICAgICAgIC8vIGJvdW5kZWQgcmVzdWx0IHNob3VsZCBwYXNzIGFuIGV4cGxpY2l0IGBjb3VudGAvYGxpbWl0YC5cbiAgICAgICAgcGFnaW5hdGlvbiA9IHsgb3JkZXI6ICdhc2MnLCBwYWdlcjogJ2N1cnNvcicsIGN1cnNvcjogbnVsbCwgcGFnZXM6ICdhbGwnIH0sXG4gICAgICAgIGluZGV4OiBzcGVjaWZpZWRJbmRleFxuICAgIH0gPSBxdWVyeTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBxdWVyeUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVRdWVyeScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgLy8gLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IGV4dHJhY3RJbmRleEZpbHRlclZhbHVlcyhzcGVjaWZpZWRJbmRleC5maWx0ZXJzLCBzcGVjaWZpZWRJbmRleC5uYW1lKSB9XG4gICAgICAgIDogZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCBlbnRpdHlOYW1lLCBlbnRpdHlTZXJ2aWNlKTtcblxuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAncXVlcnknLCAoKSA9PlxuICAgICAgICAgICAgaW5kZXhRdWVyeS5nbyh7IGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXMgYXMgYW55LCAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSwgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pLFxuICAgICAgICAgICAgeyBmaWx0ZXJzLCBpbmRleE5hbWU6IG1hdGNoUmVzdWx0LmluZGV4TmFtZSwgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoIGZvciBmdWxsIHNjYW5cbiAgICAgICAgbG9nZ2VyLndhcm4oYFdBUk5JTkc6IE5vIG1hdGNoaW5nIGluZGV4IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0sIHVzaW5nIG1hdGNoIGZvciBmdWxsIHNjYW5gLCBmaWx0ZXJzKTtcblxuICAgICAgICAvLyBUcmFjayBmdWxsIHNjYW4gLSBDUklUSUNBTDogZXhwZW5zaXZlIHBlcmZvcm1hbmNlL2Nvc3QgaXNzdWVcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KGBlbnRpdHkuZnVsbF9zY2FuYCwgMSwge1xuICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lLCBvcGVyYXRpb246ICdxdWVyeScgfSxcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBjaGVja3BvaW50IGZvciB2aXNpYmlsaXR5XG4gICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAnZGIuZW50aXR5X25hbWUnOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICdkYi5vcGVyYXRpb24nOiAncXVlcnknLFxuICAgICAgICAgICAgICAgICdkYi53YXJuaW5nJzogJ25vX2luZGV4X2ZvdW5kJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmZ1bGxfc2Nhbic6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YTogeyBmdWxsU2NhbkZpbHRlcnM6IGZpbHRlcnMgfHwge30gfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3Qgc2NhblF1ZXJ5ID0gcmVwb3NpdG9yeS5zY2FuO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgc2NhblF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogYWRkIGF0dHJpYnV0ZXMgdG8gc2NhbiBxdWVyeVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3NjYW4nLCAoKSA9PlxuICAgICAgICAgICAgc2NhblF1ZXJ5LmdvKHsgLi4ucmVtb3ZlRW1wdHkocGFnaW5hdGlvbiksIC4uLlF1ZXJ5T2JzZXJ2ZXIuZ2V0Q2FwYWNpdHlHb09wdGlvbnMoKSB9KSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgdG8gdXBkYXRlIHRoZSBlbnRpdHkgd2l0aC5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cGRhdGUnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXR0cmlidXRlcyBmb3IgcGF0Y2ggb3BlcmF0aW9uLlxuICAgICAqL1xuICAgIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycztcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjb25kaXRpb25zIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvbi5cbiAgICAgKi9cbiAgICBjb25kaXRpb25zPzogYW55OyAvLyBUT0RPXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJlLWNhbGN1bGF0ZWQgY29tcG9zaXRlIGtleSBkYXRhLiBJZiBwcm92aWRlZCwgdGhpcyB3aWxsIGJlIHVzZWQgZGlyZWN0bHkuXG4gICAgICogSWYgbm90IHByb3ZpZGVkIGFuZCBjb21wb3NpdGUga2V5cyBhcmUgbmVlZGVkLCB0aGV5IHdpbGwgYmUgY2FsY3VsYXRlZCBpbnRlcm5hbGx5LlxuICAgICAqL1xuICAgIGNvbXBvc2l0ZUtleURhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eU9wZXJhdG9ycyB7XG4gICAgLyoqXG4gICAgICogQXR0cmlidXRlIG5hbWVzIHRvIHJlbW92ZSB2aWEgRWxlY3Ryb0RCIGBwYXRjaCgpLnJlbW92ZSgpYC5cbiAgICAgKiBDb21iaW5lZCB3aXRoIHRvcC1sZXZlbCBKU09OIGBudWxsYCB2YWx1ZXMgb24gdGhlIHVwZGF0ZSBwYXlsb2FkIChtZXJnZS1wYXRjaCBjbGVhcikuXG4gICAgICovXG4gICAgcmVtb3ZlPzogc3RyaW5nW107XG59XG5cbi8qKlxuICogUmVzcG9uc2UgdHlwZSBmb3IgdXBkYXRlIGVudGl0eSBvcGVyYXRpb24uXG4gKiBQcm92aWRlcyBhIHR5cGVkIHdyYXBwZXIgZm9yIHRoZSBlbGVjdHJvZGIgdXBkYXRlIHJlc3BvbnNlLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCB0eXBlIFVwZGF0ZUVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbn1cblxuaW50ZXJmYWNlIFByZXBhcmVDb21wb3NpdGVBdHRyaWJ1dGVzQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICBpZGVudGlmaWVyczogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICBkYXRhOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogU2V0PHN0cmluZz47XG4gICAgbG9nZ2VyOiBJTG9nZ2VyO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBhcmdzOiBQcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0FyZ3M8Uz5cbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgaWRlbnRpZmllcnMsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcyxcbiAgICAgICAgbG9nZ2VyLFxuICAgIH0gPSBhcmdzO1xuXG4gICAgY29uc3QgY29tcG9zaXRlS2V5VmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgYXR0cmlidXRlc1RvRmV0Y2ggPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBkYXRhQXNSZWNvcmQgPSBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT47IC8vIENhc3QgZm9yIGR5bmFtaWMgYWNjZXNzXG5cbiAgICBpZiAocmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLnNpemUgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHt9OyAvLyBObyBjb21wb3NpdGUgYXR0cmlidXRlcyBuZWVkZWRcbiAgICB9XG5cbiAgICAvLyBvbmx5IGluY2x1ZGUgd2hhdCdzIG5vdCBhbHJlYWR5IGluIGRhdGEgb3IgaWRlbnRpZmllcnNcbiAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuZm9yRWFjaChhdHRyID0+IHtcbiAgICAgICAgaWYgKCFkYXRhQXNSZWNvcmQuaGFzT3duUHJvcGVydHkoYXR0cikgJiYgIWlkZW50aWZpZXJzLmhhc093blByb3BlcnR5KGF0dHIpKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzVG9GZXRjaC5hZGQoYXR0cik7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChhdHRyaWJ1dGVzVG9GZXRjaC5zaXplID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYE5lZWQgdG8gZmV0Y2ggYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXM6YCwgQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlY29yZENvbnRhaW5lciA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpXG4gICAgICAgICAgICAgICAgLmdldChpZGVudGlmaWVycylcbiAgICAgICAgICAgICAgICAuZ28oeyBhdHRyaWJ1dGVzOiBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSwgY29uc2lzdGVudFJlYWQ6IHRydWUgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUmVjb3JkRGF0YSA9IGV4aXN0aW5nUmVjb3JkQ29udGFpbmVyLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgaWYgKCFleGlzdGluZ1JlY29yZERhdGEpIHtcblxuICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBObyBleGlzdGluZyByZWNvcmQgZm91bmQgZm9yIGNvbXBvc2l0ZSBrZXlzOmAsIEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpKTtcblxuICAgICAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNUb0ZldGNoLmZvckVhY2goYXR0ciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1JlY29yZERhdGEuaGFzT3duUHJvcGVydHkoYXR0cikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZUtleVZhbHVlc1sgYXR0ciBdID0gZXhpc3RpbmdSZWNvcmREYXRhWyBhdHRyIF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBBdHRyaWJ1dGUgbm90IGZvdW5kIC0ganVzdCBsb2cgZGVidWcsIGRvbid0IHdhcm4gKGNvdWxkIGJlIG9wdGlvbmFsIHNwYXJzZSBpbmRleCBhdHRyaWJ1dGUpXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIuZGVidWcoYENvbXBvc2l0ZSBrZXkgYXR0cmlidXRlIFwiJHthdHRyfVwiIChJRDogJHtKU09OLnN0cmluZ2lmeShpZGVudGlmaWVycyl9KSBub3QgZm91bmQgaW4gZXhpc3RpbmcgcmVjb3JkIChtYXkgYmUgb3B0aW9uYWwpLmApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgRXJyb3IgZmV0Y2hpbmcgYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXMgKElEOiAke0pTT04uc3RyaW5naWZ5KGlkZW50aWZpZXJzKX0pOmAsIGVycm9yKTtcblxuICAgICAgICAgICAgLy8gVHJhY2sgZGF0YWJhc2UgZXJyb3IgbWV0cmljXG4gICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoYGVudGl0eS5jb21wb3NpdGVfa2V5LmZldGNoX2Vycm9yYCwgMSwge1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogYXJncy5lbnRpdHlOYW1lIH0sXG4gICAgICAgICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoYFByZXBhcmVkIGNvbXBvc2l0ZSBrZXkgdmFsdWVzOmAsIGNvbXBvc2l0ZUtleVZhbHVlcyk7XG4gICAgcmV0dXJuIGNvbXBvc2l0ZUtleVZhbHVlcztcbn1cblxuLyoqXG4gKiBVcGRhdGVzIGFuIGVudGl0eSBpbiB0aGUgZGF0YWJhc2UuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEBwYXJhbSB7VXBkYXRlRW50aXR5QXJnczxTPn0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciB1cGRhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMge1Byb21pc2U8VXBkYXRlRW50aXR5UmVzcG9uc2U8Uz4+fSAtIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSB1cGRhdGVkIGVudGl0eS5cbiAqIEB0aHJvd3Mge0Vycm9yfSAtIElmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIHRoZSB1cGRhdGUgb3BlcmF0aW9uLCBvciBpZiB2YWxpZGF0aW9uIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8VXBkYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBkYXRhLFxuICAgICAgICBvcGVyYXRvcnMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG4gICAgICAgIGNydWRUeXBlID0gJ3VwZGF0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwZGF0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICAgICAgY29tcG9zaXRlS2V5RGF0YSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCB7IGRhdGEsIHByb3ZpZGVkQ29tcG9zaXRlS2V5RGF0YTogY29tcG9zaXRlS2V5RGF0YSB9KTtcblxuICAgIGlmICghaXNQbGFpbkVudGl0eVBheWxvYWQoZGF0YSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YSBwcm92aWRlZCBmb3IgdXBkYXRlIG9wZXJhdGlvblwiKTtcbiAgICB9XG5cbiAgICBjb25zdCB7IHNldFBheWxvYWQsIG51bGxSZW1vdmFsS2V5cyB9ID0gcGFydGl0aW9uVG9wTGV2ZWxKc29uTnVsbHMoZGF0YSk7XG5cbiAgICBjb25zdCBpZGVudGlmaWVycyA9IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKTtcbiAgICBjb25zdCBpZGVudGlmaWVyS2V5c0Zyb21Sb3V0ZSA9IG5ldyBTZXQoT2JqZWN0LmtleXMoaWRlbnRpZmllcnMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKTtcblxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICBjb25zdCBleHBsaWNpdFJlbW92YWxzID0gb3BlcmF0b3JzPy5yZW1vdmUgPz8gW107XG4gICAgY29uc3QgYWxsUmVtb3ZhbEtleXMgPSBbIC4uLm5ldyBTZXQoWyAuLi5udWxsUmVtb3ZhbEtleXMsIC4uLmV4cGxpY2l0UmVtb3ZhbHMgXSkgXTtcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIGFsbFJlbW92YWxLZXlzKSB7XG4gICAgICAgIGlmIChpZGVudGlmaWVyS2V5c0Zyb21Sb3V0ZS5oYXMoa2V5KSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBgQ2Fubm90IHJlbW92ZSBpZGVudGlmaWVyIGF0dHJpYnV0ZSBcIiR7a2V5fVwiYCxcbiAgICAgICAgICAgICAgICBwYXRoOiBbIGtleSBdLFxuICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWlzU2NoZW1hQXR0cmlidXRlTmFtZShzY2hlbWEsIGtleSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IoWyB7XG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYENhbm5vdCByZW1vdmUgdW5rbm93biBhdHRyaWJ1dGUgXCIke2tleX1cImAsXG4gICAgICAgICAgICAgICAgcGF0aDogWyBrZXkgXSxcbiAgICAgICAgICAgIH0gXSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYXR0ckRlZiA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBrZXkgXTtcbiAgICAgICAgaWYgKGF0dHJEZWYucmVxdWlyZWQgPT09IHRydWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IoWyB7XG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYENhbm5vdCBjbGVhciByZXF1aXJlZCBhdHRyaWJ1dGUgXCIke2tleX1cImAsXG4gICAgICAgICAgICAgICAgcGF0aDogWyBrZXkgXSxcbiAgICAgICAgICAgIH0gXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBwcmUgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYmVmb3JlVXBkYXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gVmFsaWRhdGUgb25seSBhdHRyaWJ1dGVzIGJlaW5nIHNldCAobWVyZ2UtcGF0Y2ggbnVsbHMgYXJlIGhhbmRsZWQgdmlhIHBhdGNoLnJlbW92ZSBhYm92ZSlcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogc2V0UGF5bG9hZCxcbiAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBpZGVudGlmaWVycywgZGF0YTogc2V0UGF5bG9hZCwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIHVwZGF0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIC0tLSBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuICAgIGNvbnN0IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBpZiAoc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBpbmRleE5hbWUgaW4gc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4RGVmaW5pdGlvbiA9IHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChpbmRleERlZmluaXRpb24pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwa0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5waz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChwa0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHBrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBwa0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3Qgc2tDb21wb3NpdGUgPSBpbmRleERlZmluaXRpb24uc2s/LmNvbXBvc2l0ZTtcbiAgICAgICAgICAgICAgICBpZiAoc2tDb21wb3NpdGUgJiYgQXJyYXkuaXNBcnJheShza0NvbXBvc2l0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2tDb21wb3NpdGUuZm9yRWFjaChhdHRyID0+IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmFkZChhdHRyKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBpZiAoYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuc2l6ZSA+IDApIHtcbiAgICAgICAgaWYgKGNvbXBvc2l0ZUtleURhdGEgJiYgdHlwZW9mIGNvbXBvc2l0ZUtleURhdGEgPT09ICdvYmplY3QnKSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBmb3IgdXBkYXRlLmAsIGNvbXBvc2l0ZUtleURhdGEpO1xuXG4gICAgICAgICAgICBmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQiA9IGNvbXBvc2l0ZUtleURhdGE7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgY292ZXJzIGFsbCBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlc1xuICAgICAgICAgICAgY29uc3QgbWlzc2luZ0Zyb21Qcm92aWRlZCA9IEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpLmZpbHRlcihhdHRyID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAhT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHNldFBheWxvYWQsIGF0dHIpXG4gICAgICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgICAgICFpZGVudGlmaWVycy5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChtaXNzaW5nRnJvbVByb3ZpZGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgUHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBpcyBtaXNzaW5nIHNvbWUgcmVxdWlyZWQgY29tcG9zaXRlIGF0dHJpYnV0ZXM6ICR7bWlzc2luZ0Zyb21Qcm92aWRlZC5qb2luKCcsICcpfS4gVXBkYXRlIG1heSBmYWlsIGlmIHRoZXNlIGFyZSBuZWVkZWQgYnkgRWxlY3Ryb0RCLmApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlS2V5RGF0YSBwcm92aWRlZCwgcHJlcGFyaW5nIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzIGludGVybmFsbHkuIFJlcXVpcmVkOmAsIEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpKTtcblxuICAgICAgICAgICAgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIgPSBhd2FpdCBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBkYXRhOiBzZXRQYXlsb2FkLFxuICAgICAgICAgICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgbG9nZ2VyLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgZGVmaW5lZCBpbiBzY2hlbWEgb3IgbmVlZGVkIGZvciB0aGlzIHVwZGF0ZS5gKTtcbiAgICB9XG4gICAgLy8gLS0tIEVuZCBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuXG5cblxuICAgIC8vIFVzZSBFbGVjdHJvREIgZm9yIGFsbCBmaWVsZHMgaW5jbHVkaW5nIF9hY3RvciAobm93IGluIHNjaGVtYSlcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG4gICAgY29uc3QgcGF0Y2hCdWlsZGVyID0gcmVwb3NpdG9yeS5wYXRjaChpZGVudGlmaWVycyk7XG4gICAgdHlwZSBQYXRjaFNldFBheWxvYWQgPSBQYXJhbWV0ZXJzPHR5cGVvZiBwYXRjaEJ1aWxkZXIuc2V0PlsgMCBdO1xuICAgIHR5cGUgUGF0Y2hSZW1vdmVQYXlsb2FkID0gUGFyYW1ldGVyczx0eXBlb2YgcGF0Y2hCdWlsZGVyLnJlbW92ZT5bIDAgXTtcbiAgICBjb25zdCBxdWVyeSA9IHBhdGNoQnVpbGRlci5zZXQoc2V0UGF5bG9hZCBhcyBQYXRjaFNldFBheWxvYWQpO1xuXG4gICAgaWYgKE9iamVjdC5rZXlzKGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgY29tcG9zaXRlIHZhbHVlcyBmb3IgRWxlY3Ryb0RCIHBhdGNoOmAsIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCKTtcbiAgICAgICAgcXVlcnkuY29tcG9zaXRlKGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCKTtcbiAgICB9XG5cbiAgICBpZiAoYWxsUmVtb3ZhbEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgICBxdWVyeS5yZW1vdmUoYWxsUmVtb3ZhbEtleXMgYXMgUGF0Y2hSZW1vdmVQYXlsb2FkKTtcbiAgICB9XG5cbiAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICd1cGRhdGUnLCAoKSA9PlxuICAgICAgICBxdWVyeS5nbyh7IC4uLlF1ZXJ5T2JzZXJ2ZXIuZ2V0Q2FwYWNpdHlHb09wdGlvbnMoKSB9KVxuICAgICk7XG5cbiAgICAvLyAvLyBwb3N0IGV2ZW50c1xuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlcj8uZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyVXBkYXRlJywgY29udGV4dDogey4uLmFyZ3VtZW50cywgZW50aXR5fSB9KTtcblxuICAgIC8vIHJldHVybiBlbnRpdHk7XG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZFNlcnZpY2U8RSB+IHVwZGF0ZSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBzZXRQYXlsb2FkOmAsIHNldFBheWxvYWQsIGByZW1vdmVkOmAsIGFsbFJlbW92YWxLZXlzLCBlbnRpdHkuZGF0YSk7XG5cbiAgICByZXR1cm4gZW50aXR5IGFzIFVwZGF0ZUVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG4vKipcbiAqIHRoZSBhcmd1bWVudHMgZm9yIGRlbGV0aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICovXG4gICAgaWQ6IE9wc1NjaGVtYVsgJ2RlbGV0ZScgXTtcbn1cblxuLyoqXG4gKiBSZXNwb25zZSB0eXBlIGZvciBkZWxldGUgZW50aXR5IG9wZXJhdGlvbi5cbiAqIFByb3ZpZGVzIGEgdHlwZWQgd3JhcHBlciBmb3IgdGhlIGVsZWN0cm9kYiBkZWxldGUgcmVzcG9uc2UuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqL1xuZXhwb3J0IHR5cGUgRGVsZXRlRW50aXR5UmVzcG9uc2U8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBkYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPlxufVxuXG4vKipcbiAqIERlbGV0ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgZGVsZXRpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSBkZWxldGVkIGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBEZWxldGVFbnRpdHlBcmdzPFM+KTogUHJvbWlzZTxEZWxldGVFbnRpdHlSZXNwb25zZTxTPj4ge1xuXG4gICAgY29uc3Qge1xuICAgICAgICBpZCxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2RlbGV0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmRlbGV0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlRGVsZXRlJywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBlbnRpdHlTZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpZCk7XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yXG4gICAgLy8gY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IGF1dGhvcml6ZXIuYXV0aG9yaXplKHtlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIGRlbGV0ZTogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2RlbGV0ZScsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVycykuZ28oeyAuLi5RdWVyeU9ic2VydmVyLmdldENhcGFjaXR5R29PcHRpb25zKCkgfSlcbiAgICApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2FmdGVyRGVsZXRlJywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZGVsZXRlRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgRGVsZXRlRW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciBiYXRjaCBkZWxldGluZyBlbnRpdGllcy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVCYXRjaEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgZW50aXR5IElEcyB0byBkZWxldGUuXG4gICAgICovXG4gICAgaWRzOiBBcnJheTxPcHNTY2hlbWFbICdkZWxldGUnIF0+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqL1xuICAgIGNvbmN1cnJlbnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRGVsZXRlcyBtdWx0aXBsZSBlbnRpdGllcyBpbiBhIGJhdGNoIG9wZXJhdGlvbi5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIHRoZSBlbnRpdGllcy5cbiAqIEByZXR1cm5zIFRoZSB1bnByb2Nlc3NlZCBpdGVtcyB0aGF0IGNvdWxkbid0IGJlIGRlbGV0ZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVCYXRjaEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBEZWxldGVCYXRjaEVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgY29uY3VycmVudCA9IDEsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdkZWxldGUnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpkZWxldGVCYXRjaEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBkZWxldGVCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZHMsIGNvbmN1cnJlbnQgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZvciBhbGwgaXRlbXMgaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlkcy5tYXAoaWQgPT4gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuICAgIC8vIFZhbGlkYXRlIGVhY2ggaXRlbSBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCB2YWxpZGF0aW9ucyA9IGF3YWl0IFByb21pc2UuYWxsKGlkZW50aWZpZXJzQmF0Y2gubWFwKGFzeW5jIGlkZW50aWZpZXJzID0+XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhY3RvcjogYWN0b3JcbiAgICAgICAgfSlcbiAgICApKTtcblxuICAgIC8vIENoZWNrIGZvciB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uc1xuICAgICAgICAubWFwKCh2YWxpZGF0aW9uLCBpbmRleCkgPT4gKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgdmFsaWRhdGlvbiB9KSA9PiAhdmFsaWRhdGlvbi5wYXNzKTtcblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uRXJyb3JzLmZsYXRNYXAoKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkgPT5cbiAgICAgICAgICAgICh2YWxpZGF0aW9uLmVycm9ycyB8fCBbXSkubWFwKGVycm9yID0+ICh7XG4gICAgICAgICAgICAgICAgLi4uZXJyb3IsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYEl0ZW0gJHtpbmRleH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgKSk7XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBiYXRjaCBkZWxldGUgb3BlcmF0aW9uIHdpdGggY29uY3VycmVuY3kgY29udHJvbFxuICAgIC8vIFBlciBFbGVjdHJvREIgZG9jczogaHR0cDovL2VsZWN0cm9kYi5kZXYvZW4vbXV0YXRpb25zL2JhdGNoLWRlbGV0ZS9cbiAgICAvLyBOb3RlOiBFbGVjdHJvREIgdHlwZXMgdXNlICdjb25jdXJyZW5jeScgd2hpbGUgZG9jcyBzaG93ICdjb25jdXJyZW50J1xuICAgIGNvbnN0IGJ1bGtPcHRpb25zOiBQYXJ0aWFsPEJ1bGtPcHRpb25zPiA9IHtcbiAgICAgICAgY29uY3VycmVuY3k6IGNvbmN1cnJlbnRcbiAgICB9O1xuXG4gICAgY29uc3QgZWxlY3Ryb1Jlc3VsdCA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2JhdGNoRGVsZXRlJywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZGVsZXRlKGlkZW50aWZpZXJzQmF0Y2gpLmdvKGJ1bGtPcHRpb25zKSxcbiAgICAgICAgeyBpdGVtQ291bnQ6IGlkZW50aWZpZXJzQmF0Y2gubGVuZ3RoIH1cbiAgICApO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkczpgLCBpZHMpO1xuXG4gICAgcmV0dXJuIGVsZWN0cm9SZXN1bHQ7XG59XG5cbi8qKlxuICogQ29udmVydHMgYSBmaWx0ZXIgb2JqZWN0IHdpdGggZXEgb3BlcmF0b3JzIHRvIGEgc2ltcGxpZmllZCBmb3JtLlxuICogRXhhbXBsZTogeyBhZ2U6IHsgZXE6IDY1IH0gfSBiZWNvbWVzIHsgYWdlOiA2NSB9XG4gKiBAcGFyYW0gZmlsdGVycyAtIFRoZSBmaWx0ZXIgb2JqZWN0IHRvIHNpbXBsaWZ5XG4gKiBAcmV0dXJucyBBIG5ldyBmaWx0ZXIgb2JqZWN0IHdpdGggZXEgb3BlcmF0b3JzIGNvbnZlcnRlZCB0byBkaXJlY3QgdmFsdWVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW1wbGlmeUZpbHRlcnMoZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGlmICghZmlsdGVycykgcmV0dXJuIHt9O1xuXG4gICAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhmaWx0ZXJzKSkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAnZXEnIGluIHZhbHVlKSB7XG4gICAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWUuZXE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gZXhwb3J0IGNsYXNzIEVudGl0eUNydWRTZXJ2aWNlPFMgZXh0ZW5kcyBTY2hlbWE8YW55LCBhbnksIGFueT4+e1xuXG4vLyAgICAgcHVibGljIGFzeW5jIGxpc3Qob3B0aW9uczogTGlzdEVudGl0eUFyZ3M8Uz4pIHtcbi8vICAgICAgICAgcmV0dXJuIGF3YWl0IGxpc3RFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIGNyZWF0ZShvcHRpb25zOiBDcmVhdGVFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBjcmVhdGVFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIHVwZGF0ZShvcHRpb25zOiBVcGRhdGVFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCB1cGRhdGVFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIGdldChvcHRpb25zOiBHZXRFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBnZXRFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuXG4vLyAgICAgcHVibGljIGFzeW5jIGRlbGV0ZShvcHRpb25zOiBEZWxldGVFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBkZWxldGVFbnRpdHkob3B0aW9ucyk7XG4vLyAgICAgfVxuLy8gfVxuXG5cbi8vIGV4cG9ydCBjb25zdCBEZWZhdWx0RW50aXR5Q3J1ZFNlcnZpY2UgPSBuZXcgRW50aXR5Q3J1ZFNlcnZpY2UoKTsiXX0=