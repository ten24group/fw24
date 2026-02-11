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
    const entity = await observers_1.QueryObserver.track(entityName, 'create', () => entityService.getRepository().create(data).go({ ...observers_1.QueryObserver.getCapacityGoOptions() }));
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
    const entity = await observers_1.QueryObserver.track(entityName, 'upsert', () => entityService.getRepository().upsert(data).go({ response: "all_old", ...observers_1.QueryObserver.getCapacityGoOptions() }));
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
    const entity = await observers_1.QueryObserver.track(entityName, 'update', () => query.go({ ...observers_1.QueryObserver.getCapacityGoOptions() }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9jcnVkLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBbUZBLDhCQXVEQztBQThCRCx3Q0FpRUM7QUE0QkQsb0NBeURDO0FBK0JELG9DQW9FQztBQWlDRCw4REEwQkM7QUErQ0QsNERBeUNDO0FBVUQsOENBNkVDO0FBUUQsZ0NBOEZDO0FBV0Qsa0NBOEZDO0FBcUlELG9DQXdJQztBQStCRCxvQ0FxREM7QUEwQkQsOENBK0RDO0FBUUQsMENBWUM7QUF2eUNELDRDQUEwQztBQUMxQyxvQ0FBMkM7QUFDM0Msd0NBQW1EO0FBQ25ELG9DQUFzRDtBQUN0RCw4Q0FBa0U7QUFFbEUsZ0VBQWtFO0FBRWxFLG1DQUEyRDtBQUUzRCwwREFBeUY7QUFtRXpGOzs7O0dBSUc7QUFDSSxLQUFLLFVBQVUsU0FBUyxDQUF3QyxPQUF5QjtJQUU1RixNQUFNLEVBQ0YsRUFBRSxFQUNGLFVBQVUsRUFDVixVQUFVLEVBQ1YsYUFBYSxFQUViLEtBQUssRUFDTCxNQUFNLEVBRU4sUUFBUSxHQUFHLEtBQUssRUFDaEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyx3QkFBd0IsQ0FBQyxFQUMvQyxTQUFTLEdBQUcsNkJBQWdCLEVBQzVCLFVBQVUsR0FBRyxzQkFBVSxDQUFDLE9BQU8sRUFDL0IsZUFBZSxHQUFHLHVCQUFlLENBQUMsT0FBTyxHQUU1QyxHQUFHLE9BQU8sQ0FBQztJQUVaLE1BQU0sQ0FBQyxLQUFLLENBQUMsK0NBQStDLFVBQVUsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFL0YsNkVBQTZFO0lBRTdFLE1BQU0sV0FBVyxHQUFHLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUUvRCxzQkFBc0I7SUFDdEIsd0dBQXdHO0lBQ3hHLDJCQUEyQjtJQUMzQixvRkFBb0Y7SUFDcEYs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QUFDO0FBQ3pCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQWdCLGVBQWUsQ0FBQyxPQUF3QztJQUNwRSxJQUFJLENBQUMsT0FBTztRQUFFLE9BQU8sRUFBRSxDQUFDO0lBRXhCLE1BQU0sTUFBTSxHQUF3QixFQUFFLENBQUM7SUFDdkMsS0FBSyxNQUFNLENBQUUsR0FBRyxFQUFFLEtBQUssQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNuRCxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3RELE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzdCLENBQUM7YUFBTSxDQUFDO1lBQ0osTUFBTSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztRQUMxQixDQUFDO0lBQ0wsQ0FBQztJQUNELE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUM7QUFFRCxtRUFBbUU7QUFFbkUsc0RBQXNEO0FBQ3RELDRDQUE0QztBQUM1QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBRVIsb0RBQW9EO0FBQ3BELDJDQUEyQztBQUMzQyxRQUFRO0FBRVIsMERBQTBEO0FBQzFELDhDQUE4QztBQUM5QyxRQUFRO0FBQ1IsSUFBSTtBQUdKLG1FQUFtRSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQnVsa09wdGlvbnMgfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBBdXRob3JpemVyIH0gZnJvbSBcIi4uL2F1dGhvcml6ZVwiO1xuaW1wb3J0IHsgRXZlbnREaXNwYXRjaGVyIH0gZnJvbSBcIi4uL2V2ZW50XCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgaXNFbXB0eU9iamVjdCwgcmVtb3ZlRW1wdHkgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IERlZmF1bHRWYWxpZGF0b3IsIHR5cGUgSVZhbGlkYXRvciB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEsIEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYSwgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBURW50aXR5T3BzSW5wdXRTY2hlbWFzIH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IEVudGl0eVZhbGlkYXRpb25FcnJvciB9IGZyb20gXCIuL2Vycm9ycy92YWxpZGF0aW9uLWVycm9yXCI7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbiB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVF1ZXJ5IH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7IE1ldHJpY09ic2VydmVyLCBTcGFuT2JzZXJ2ZXIsIFF1ZXJ5T2JzZXJ2ZXIgfSBmcm9tIFwiLi4vb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnNcIjtcblxuLyoqXG4gKiBcbiAqIFNlcmlhbGl6ZXIvZm9ybWF0dGVyXG4gKiAgLSBodHRwczovL2dpdGh1Yi5jb20vZGt6bHYvbWljcm8tdHJhbnNmb3JtXG4gKiAgXG4gKiBFdmVudCBkaXNwYXRjaGVyXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9Gb3hBbmRGbHkvdHMtZXZlbnQtZGlzcGF0Y2hlci9ibG9iL21hc3Rlci9zcmMvaW5kZXgudHNcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL3J5YXJkbGV5L3RzLWJ1c1xuICogLSBodHRwczovL2dpdGh1Yi5jb20vYmluaWVyL3RpbnktdHlwZWQtZW1pdHRlci90cmVlL21hc3RlclxuICogXG4gKiBSb3V0ZXJcbiAqIC0gaHR0cHM6Ly9naXRodWIuY29tL2JlcnN0ZW5kL3RpbnktcmVxdWVzdC1yb3V0ZXIvYmxvYi9tYXN0ZXIvc3JjL3JvdXRlci50c1xuICogXG4gKiBESVxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbmljb2pzL3R5cGVkLWluamVjdFxuICogLSBodHRwczovL2dpdGh1Yi5jb20vbWljcm9zb2Z0L3RzeXJpbmdlXG4gKiAtIGh0dHBzOi8vZ2l0aHViLmNvbS9vd2phL2lvY1xuICogXG4gKiBcbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhc2VFbnRpdHlDcnVkQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcblxuICAgIGNydWRUeXBlPzoga2V5b2YgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zO1xuICAgIGFjdG9yPzogQWN0b3I7IC8vIEFjdG9yIGNvbnRleHQ6IGNvbXByZWhlbnNpdmUgYWN0b3IgaW5mb3JtYXRpb24gaW5jbHVkaW5nIGF1dGhlbnRpY2F0aW9uIGRldGFpbHNcbiAgICB0ZW5hbnQ/OiBhbnk7IC8vIHRvZG86IGRlZmluZSB0ZW5hbnQgY29udGV4dFxuXG4gICAgbG9nZ2VyPzogSUxvZ2dlcjtcbiAgICB2YWxpZGF0b3I/OiBJVmFsaWRhdG9yO1xuICAgIGF1dGhvcml6ZXI/OiBBdXRob3JpemVyLklBdXRob3JpemVyOyAgICAgICAgLy8gdG9kbzogZGVmaW5lIGF1dGhvcml6ZXIgc2lnbmF0dXJlXG4gICAgZXZlbnREaXNwYXRjaGVyPzogRXZlbnREaXNwYXRjaGVyLklFdmVudERpc3BhdGNoZXI7ICAvLyB0b2RvIGRlZmluZSBldmVudCBkaXNwYXRjaGVyIHNpZ25hdHVyZVxuXG4gICAgLy8gdGVsZW1ldHJ5XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIGFuIGVudGl0eS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wc1NjaGVtYSAtIFRoZSBpbnB1dCBzY2hlbWFzIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIFRoZSBJRCBvZiB0aGUgZW50aXR5IHRvIHJldHJpZXZlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byBpbmNsdWRlIGluIHRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xufVxuXG4vKipcbiAqIFJlc3BvbnNlIHR5cGUgZm9yIGdldCBlbnRpdHkgb3BlcmF0aW9uLlxuICogUHJvdmlkZXMgYSB0eXBlZCB3cmFwcGVyIGZvciB0aGUgZWxlY3Ryb2RiIGdldCByZXNwb25zZS5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgdHlwZSBHZXRFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbi8qKlxuICogUmV0cmlldmVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHJldHJpZXZpbmcgdGhlIGVudGl0eS5cbiAqIEByZXR1cm5zIFRoZSByZXRyaWV2ZWQgZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IEdldEVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPEdldEVudGl0eVJlc3BvbnNlPFM+PiB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZ2V0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6Z2V0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfTpgLCB7IGlkLCBhdHRyaWJ1dGVzIH0pO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZUdldCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGlkZW50aWZpZXJzLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciBnZXQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cblxuICAgIC8vIC8vIHZhbGlkYXRlXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IGNydWRUeXBlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgZW50aXR5U2VydmljZS5nZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSxcbiAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2dldCcsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmdldChpZGVudGlmaWVycykuZ28oeyBhdHRyaWJ1dGVzLCAuLi5RdWVyeU9ic2VydmVyLmdldENhcGFjaXR5R29PcHRpb25zKCkgfSlcbiAgICApO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2FmdGVyR2V0JywgY29udGV4dDogYXJndW1lbnRzfSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkIH4gZ2V0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkOmAsIGlkKTtcblxuICAgIHJldHVybiBlbnRpdHkgYXMgR2V0RW50aXR5UmVzcG9uc2U8Uz47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYXJndW1lbnRzIGZvciByZXRyaWV2aW5nIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2guXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gcmV0cmlldmUuXG4gICAgICovXG4gICAgaWRzOiBBcnJheTxPcHNTY2hlbWFbICdnZXQnIF0+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmV0cmlldmVkIGVudGl0aWVzLlxuICAgICAqL1xuICAgIGF0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmc+O1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqL1xuICAgIGNvbmN1cnJlbnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgcmV0cmlldmluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRCYXRjaEVudGl0eTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiBHZXRCYXRjaEVudGl0eUFyZ3M8Uz4pIHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkcyxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgY29uY3VycmVudCA9IDEsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdnZXQnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpnZXRCYXRjaEVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBnZXRCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX06YCwgeyBpZHMsIGF0dHJpYnV0ZXMgfSk7XG5cbiAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZvciBhbGwgaXRlbXMgaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlkcy5tYXAoaWQgPT4gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuICAgIC8vIFZhbGlkYXRlIGVhY2ggaXRlbSBpbiB0aGUgYmF0Y2hcbiAgICBjb25zdCB2YWxpZGF0aW9ucyA9IGF3YWl0IFByb21pc2UuYWxsKGlkZW50aWZpZXJzQmF0Y2gubWFwKGFzeW5jIGlkZW50aWZpZXJzID0+XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBlbnRpdHlWYWxpZGF0aW9uczogZW50aXR5U2VydmljZS5nZXRFbnRpdHlWYWxpZGF0aW9ucygpLFxuICAgICAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgICAgICBpbnB1dDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhY3RvcjogYWN0b3JcbiAgICAgICAgfSlcbiAgICApKTtcblxuICAgIC8vIENoZWNrIGZvciB2YWxpZGF0aW9uIGVycm9yc1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uc1xuICAgICAgICAubWFwKCh2YWxpZGF0aW9uLCBpbmRleCkgPT4gKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgdmFsaWRhdGlvbiB9KSA9PiAhdmFsaWRhdGlvbi5wYXNzKTtcblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uRXJyb3JzLmZsYXRNYXAoKHsgdmFsaWRhdGlvbiwgaW5kZXggfSkgPT5cbiAgICAgICAgICAgICh2YWxpZGF0aW9uLmVycm9ycyB8fCBbXSkubWFwKGVycm9yID0+ICh7XG4gICAgICAgICAgICAgICAgLi4uZXJyb3IsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogYEl0ZW0gJHtpbmRleH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgKSk7XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBiYXRjaCBnZXQgb3BlcmF0aW9uIHdpdGggY29uY3VycmVuY3kgY29udHJvbFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2JhdGNoR2V0JywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuZ2V0KGlkZW50aWZpZXJzQmF0Y2gpLmdvKHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBjb25jdXJyZW50LFxuICAgICAgICAgICAgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpLFxuICAgICAgICB9KSxcbiAgICAgICAgeyBpdGVtQ291bnQ6IGlkZW50aWZpZXJzQmF0Y2gubGVuZ3RoIH1cbiAgICApO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGdldEJhdGNoRW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGlkczpgLCBpZHMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZGF0YTogQXJyYXkuaXNBcnJheShyZXN1bHQuZGF0YSkgPyByZXN1bHQuZGF0YSA6IChyZXN1bHQuZGF0YSA/IFsgcmVzdWx0LmRhdGEgXSA6IFtdKSxcbiAgICAgICAgdW5wcm9jZXNzZWQ6IFtdICAvLyBFbGVjdHJvREIgZG9lc24ndCBzdXBwb3J0IHVucHJvY2Vzc2VkIGl0ZW1zIHRyYWNraW5nLCBzbyB3ZSByZXR1cm4gZW1wdHkgYXJyYXlcbiAgICB9O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENyZWF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAnY3JlYXRlJyBdO1xufVxuXG5leHBvcnQgdHlwZSBDcmVhdGVFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgdXNpbmcgdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkuXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIGNyZWF0ZSBvcGVyYXRpb24sIHZhbGlkYXRpb24gZmFpbHMsIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogQ3JlYXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8Q3JlYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdjcmVhdGUnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpjcmVhdGVFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiBjcmVhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCBkYXRhKTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciBjcmVhdGUgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVDcmVhdGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3IsXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICAvLyBhdXRob3JpemUgdGhlIGFjdG9yIFxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7IGVudGl0eU5hbWUsIGNydWRUeXBlLCBkYXRhLCBhY3RvciwgdGVuYW50IH0pO1xuICAgIC8vIGlmKCFhdXRob3JpemF0aW9uLnBhc3Mpe1xuICAgIC8vICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdXRob3JpemF0aW9uIGZhaWxlZCBmb3IgY3JlYXRlOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnY3JlYXRlJywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkuY3JlYXRlKGRhdGEpLmdvKHsgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pXG4gICAgKTtcblxuICAgIC8vIHBvc3QgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJDcmVhdGUnLCBjb250ZXh0OiB7Li4uYXJndW1lbnRzLCBlbnRpdHl9IH0pO1xuXG4gICAgLy8gcmV0dXJuIGVudGl0eTtcbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gY3JlYXRlIH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSwgZW50aXR5LmRhdGEpO1xuXG4gICAgcmV0dXJuIGVudGl0eSBhcyBDcmVhdGVFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwc2VydEVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICovXG4gICAgZGF0YTogT3BzU2NoZW1hWyAndXBzZXJ0JyBdO1xufVxuXG5leHBvcnQgdHlwZSBVcHNlcnRFbnRpdHlSZXNwb25zZTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGRhdGE/OiBFbnRpdHlSZXNwb25zZUl0ZW1UeXBlRnJvbVNjaGVtYTxTY2g+XG4gICAgd2FzQ3JlYXRlZD86IGJvb2xlYW4gIC8vIHRydWUgaWYgcmVjb3JkIHdhcyBjcmVhdGVkLCBmYWxzZSBpZiBhbHJlYWR5IGV4aXN0ZWRcbiAgICBvbGREYXRhPzogRW50aXR5UmVzcG9uc2VJdGVtVHlwZUZyb21TY2hlbWE8U2NoPiAgLy8gcHJldmlvdXMgZGF0YSBpZiBpdCB3YXMgYW4gdXBkYXRlICh1bmRlZmluZWQgZm9yIGNyZWF0ZXMpXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBlbnRpdHkgdXNpbmcgdGhlIHByb3ZpZGVkIG9wdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nLU9SLXVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkgd2l0aCB3YXNDcmVhdGVkIGZsYWcgaW5kaWNhdGluZyBpZiBpdCB3YXMgYSBuZXcgcmVjb3JkLlxuICogQHRocm93cyBFcnJvciBpZiBubyBkYXRhIGlzIHByb3ZpZGVkIGZvciB1cHNlcnQgb3BlcmF0aW9uLCB2YWxpZGF0aW9uIGZhaWxzLCBvciBhdXRob3JpemF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBzZXJ0RW50aXR5PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IFVwc2VydEVudGl0eUFyZ3M8Uz4pOiBQcm9taXNlPFVwc2VydEVudGl0eVJlc3BvbnNlPFM+PiB7XG4gICAgY29uc3Qge1xuICAgICAgICBkYXRhLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAndXBzZXJ0JyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6dXBzZXJ0RW50aXR5JyksXG4gICAgICAgIHZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3IsXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSk7XG5cbiAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gZGF0YSBwcm92aWRlZCBmb3IgdXBzZXJ0IG9wZXJhdGlvblwiKTtcbiAgICB9XG5cbiAgICAvLyBwcmUgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYmVmb3JlVXBzZXJ0JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgLy8gdmFsaWRhdGVcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zOiBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVZhbGlkYXRpb25zKCksXG4gICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICBpbnB1dDogZGF0YSxcbiAgICAgICAgYWN0b3I6IGFjdG9yLFxuICAgIH0pO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uLnBhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcih2YWxpZGF0aW9uLmVycm9ycyk7XG4gICAgfVxuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgZGF0YSwgYWN0b3IsIHRlbmFudCB9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQgZm9yIHVwc2VydDogXCIgKyB7IGNhdXNlOiBhdXRob3JpemF0aW9uIH0pO1xuICAgIC8vIH1cblxuICAgIC8vIFVzZSBcImFsbF9vbGRcIiB0byBnZXQgdGhlIHByZXZpb3VzIGl0ZW0gc3RhdGUgLSBhbGxvd3MgdXMgdG8gZGV0ZWN0IGNyZWF0ZSB2cyB1cGRhdGVcbiAgICAvLyBJZiBvbGREYXRhIGlzIGVtcHR5L251bGwsIGl0IHdhcyBhIENSRUFURS4gSWYgaXQgaGFzIGRhdGEsIGl0IHdhcyBhbiBVUERBVEUuXG4gICAgY29uc3QgZW50aXR5ID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAndXBzZXJ0JywgKCkgPT5cbiAgICAgICAgZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCkudXBzZXJ0KGRhdGEgYXMgYW55KS5nbyh7IHJlc3BvbnNlOiBcImFsbF9vbGRcIiwgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pXG4gICAgKTtcblxuICAgIGNvbnN0IHdhc0NyZWF0ZWQgPSAhZW50aXR5LmRhdGEgfHwgT2JqZWN0LmtleXMoZW50aXR5LmRhdGEpLmxlbmd0aCA9PT0gMDtcbiAgICBjb25zdCBvbGREYXRhID0gd2FzQ3JlYXRlZCA/IHVuZGVmaW5lZCA6IGVudGl0eS5kYXRhO1xuXG4gICAgLy8gcG9zdCBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclVwc2VydCcsIGNvbnRleHQ6IHsuLi5hcmd1bWVudHMsIGVudGl0eX0gfSk7XG5cbiAgICAvLyByZXR1cm4gZW50aXR5O1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cHNlcnQgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gd2FzQ3JlYXRlZDogJHt3YXNDcmVhdGVkfWApO1xuXG4gICAgLy8gTm90ZTogd2l0aCBcImFsbF9vbGRcIiwgZW50aXR5LmRhdGEgY29udGFpbnMgdGhlIE9MRCBkYXRhLCB3ZSBuZWVkIHRvIHJldHVybiB0aGUgTkVXIGRhdGFcbiAgICAvLyBTaW5jZSB3ZSBkb24ndCBoYXZlIHRoZSBuZXcgZGF0YSBmcm9tIER5bmFtb0RCLCB3ZSByZXR1cm4gdGhlIGlucHV0IGRhdGEgYXMgdGhlIG5ldyBkYXRhXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZGF0YTogZGF0YSBhcyBhbnksICAvLyBUaGUgbmV3IGRhdGEgd2UganVzdCB1cHNlcnRlZFxuICAgICAgICB3YXNDcmVhdGVkLFxuICAgICAgICBvbGREYXRhXG4gICAgfSBhcyBVcHNlcnRFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhcmd1bWVudHMgZm9yIGxpc3RpbmcgZW50aXRpZXMuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMaXN0RW50aXR5QXJnczxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIHF1ZXJ5OiBFbnRpdHlRdWVyeTxTY2g+XG59XG5cbi8qKlxuICogT3BlcmF0b3JzIHRoYXQgc2hvdWxkIE5PVCBiZSB1c2VkIGZvciBpbmRleCBtYXRjaGluZy5cbiAqIFRoZXNlIG9wZXJhdG9ycyBsb29rIGZvciByZWNvcmRzIHdoZXJlIHRoZSBhdHRyaWJ1dGUgZG9lc24ndCBleGlzdCBvciBpcyBlbXB0eSxcbiAqIGJ1dCB0aG9zZSByZWNvcmRzIHdvbid0IGJlIGluIGEgc3BhcnNlIEdTSSB3aGVyZSB0aGF0IGF0dHJpYnV0ZSBpcyB0aGUgUEsuXG4gKi9cbmNvbnN0IElOREVYX0VYQ0xVREVEX09QRVJBVE9SUyA9IG5ldyBTZXQoW1xuICAgICdub3RFeGlzdHMnLCAnZXhpc3RzJywgJ2lzTnVsbCcsICdub3ROdWxsJywgJ2VtcHR5JywgJ25vdEVtcHR5J1xuXSk7XG5cbi8qKlxuICogQ29udmVydCBGaWx0ZXJHcm91cCBmb3JtYXQgdG8gc2ltcGxlIG9iamVjdCBmb3JtYXQgZm9yIGluZGV4IG1hdGNoaW5nLlxuICogRmlsdGVyR3JvdXA6IHsgYW5kOiBbeyBhdHRyaWJ1dGU6ICdmb28nLCBlcTogJ2JhcicgfV0gfVxuICogU2ltcGxlOiB7IGZvbzogeyBlcTogJ2JhcicgfSB9XG4gKiBcbiAqIE9ubHkgZXh0cmFjdHMgZmlsdGVycyBmcm9tIHRoZSAnYW5kJyBhcnJheSBhcyB0aG9zZSBhcmUgdGhlIG9uZXNcbiAqIHRoYXQgY2FuIGJlIHVzZWQgZm9yIEdTSSBwYXJ0aXRpb24ga2V5IG1hdGNoaW5nLlxuICogXG4gKiBFeGNsdWRlcyBleGlzdGVuY2UvbnVsbCBmaWx0ZXJzIChub3RFeGlzdHMsIGlzTnVsbCwgZW1wdHksIGV0Yy4pIGZyb20gaW5kZXhcbiAqIG1hdGNoaW5nIHNpbmNlIHJlY29yZHMgd2l0aCBtaXNzaW5nIGF0dHJpYnV0ZXMgd29uJ3QgYmUgaW4gc3BhcnNlIEdTSXMuXG4gKiBcbiAqIEBwYXJhbSBmaWx0ZXJzIC0gVGhlIGZpbHRlcnMgaW4gRmlsdGVyR3JvdXAgb3Igc2ltcGxlIGZvcm1hdFxuICogQHJldHVybnMgRmlsdGVycyBpbiBzaW1wbGUgb2JqZWN0IGZvcm1hdCB7IGF0dHI6IHsgb3A6IHZhbCB9IH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55Pik6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIC8vIEFscmVhZHkgaW4gc2ltcGxlIGZvcm1hdCBvciBlbXB0eVxuICAgIGlmICghZmlsdGVycyB8fCAhKCdhbmQnIGluIGZpbHRlcnMpKSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJzIHx8IHt9O1xuICAgIH1cblxuICAgIGNvbnN0IHNpbXBsZTogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuXG4gICAgLy8gRXh0cmFjdCBmcm9tICdhbmQnIGFycmF5IC0gdGhlc2UgYXJlIEFORCBjb25kaXRpb25zIHRoYXQgY291bGQgbWF0Y2ggR1NJIFBLXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGZpbHRlcnMuYW5kIHx8IFtdKSB7XG4gICAgICAgIGlmIChpdGVtLmF0dHJpYnV0ZSkge1xuICAgICAgICAgICAgY29uc3Qgb3BlcmF0b3JzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGl0ZW0pKSB7XG4gICAgICAgICAgICAgICAgLy8gU2tpcCB0aGUgJ2F0dHJpYnV0ZScga2V5IGFuZCBleGNsdWRlIGV4aXN0ZW5jZS9udWxsIG9wZXJhdG9ycyBmcm9tIGluZGV4IG1hdGNoaW5nXG4gICAgICAgICAgICAgICAgLy8gUmVjb3JkcyB3aXRoIG1pc3NpbmcgYXR0cmlidXRlcyB3b24ndCBiZSBpbiBzcGFyc2UgR1NJc1xuICAgICAgICAgICAgICAgIGlmIChrZXkgIT09ICdhdHRyaWJ1dGUnICYmICFJTkRFWF9FWENMVURFRF9PUEVSQVRPUlMuaGFzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgb3BlcmF0b3JzWyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhvcGVyYXRvcnMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBzaW1wbGVbIGl0ZW0uYXR0cmlidXRlIF0gPSBvcGVyYXRvcnM7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2ltcGxlO1xufVxuXG4vKipcbiAqIEVycm9yIHRocm93biB3aGVuIGludmFsaWQgZmlsdGVyIG9wZXJhdG9ycyBhcmUgdXNlZCBpbiBpbmRleC5maWx0ZXJzLlxuICovXG5leHBvcnQgY2xhc3MgSW52YWxpZEluZGV4RmlsdGVyRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBpbnZhbGlkT3BlcmF0b3JzOiBzdHJpbmdbXSxcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGluZGV4TmFtZT86IHN0cmluZ1xuICAgICkge1xuICAgICAgICBjb25zdCBpbmRleENvbnRleHQgPSBpbmRleE5hbWUgPyBgIGZvciBpbmRleCBcIiR7aW5kZXhOYW1lfVwiYCA6ICcnO1xuICAgICAgICBzdXBlcihcbiAgICAgICAgICAgIGBJbnZhbGlkIGZpbHRlciBvcGVyYXRvcihzKSBbJHtpbnZhbGlkT3BlcmF0b3JzLmpvaW4oJywgJyl9XSBmb3IgYXR0cmlidXRlIFwiJHthdHRyaWJ1dGVOYW1lfVwiJHtpbmRleENvbnRleHR9LiBgICtcbiAgICAgICAgICAgIGBHU0kgY29tcG9zaXRlIGtleSBhdHRyaWJ1dGVzIG9ubHkgc3VwcG9ydCBlcXVhbGl0eSBtYXRjaGVzLiBgICtcbiAgICAgICAgICAgIGBVc2UgeyAke2F0dHJpYnV0ZU5hbWV9OiB7IGVxOiB2YWx1ZSB9IH0gb3IgeyAke2F0dHJpYnV0ZU5hbWV9OiB2YWx1ZSB9IGZvciBjb21wb3NpdGUga2V5cy4gYCArXG4gICAgICAgICAgICBgRm9yIHJhbmdlL290aGVyIGNvbmRpdGlvbnMsIHVzZSB0b3AtbGV2ZWwgJ2ZpbHRlcnMnIGluc3RlYWQgb2YgJ2luZGV4LmZpbHRlcnMnLmBcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5uYW1lID0gJ0ludmFsaWRJbmRleEZpbHRlckVycm9yJztcbiAgICB9XG59XG5cbi8qKlxuICogRXh0cmFjdHMgYW5kIHZhbGlkYXRlcyBjb21wb3NpdGUga2V5IHZhbHVlcyBmcm9tIGluZGV4LmZpbHRlcnMgZm9yIEVsZWN0cm9EQiBhY2Nlc3MgcGF0dGVybiBxdWVyaWVzLlxuICogXG4gKiBEeW5hbW9EQiBHU0kgY29tcG9zaXRlIGtleXMgaGF2ZSBzcGVjaWZpYyBjb25zdHJhaW50czpcbiAqIC0gUGFydGl0aW9uIEtleSAoUEspOiBNVVNUIGJlIGFuIGVxdWFsaXR5IG1hdGNoXG4gKiAtIFNvcnQgS2V5IChTSyk6IENhbiB1c2UgcmFuZ2Ugb3BlcmF0b3JzLCBidXQgdGhvc2UgZ28gaW4gdG9wLWxldmVsIGBmaWx0ZXJzYFxuICogXG4gKiBUaGlzIGZ1bmN0aW9uOlxuICogMS4gVmFsaWRhdGVzIHRoYXQgb25seSBlcXVhbGl0eSBvcGVyYXRvcnMgYXJlIHVzZWRcbiAqIDIuIENvbnZlcnRzIEZXMjQgZmlsdGVyIHN5bnRheCB0byBFbGVjdHJvREIgZm9ybWF0XG4gKiAzLiBUSFJPV1MgaWYgaW52YWxpZCBvcGVyYXRvcnMgYXJlIGRldGVjdGVkIChmYWlsIGZhc3QsIG5vdCBzaWxlbnRseSlcbiAqIFxuICogQHBhcmFtIGZpbHRlcnMgLSBGaWx0ZXJzIGZyb20gaW5kZXguZmlsdGVycyAob25seSBlcXVhbGl0eSBhbGxvd2VkKVxuICogQHBhcmFtIGluZGV4TmFtZSAtIE5hbWUgb2YgdGhlIGluZGV4IChmb3IgZXJyb3IgbWVzc2FnZXMpXG4gKiBAcmV0dXJucyBDb21wb3NpdGUga2V5IHZhbHVlcyBpbiBFbGVjdHJvREIgZm9ybWF0XG4gKiBAdGhyb3dzIEludmFsaWRJbmRleEZpbHRlckVycm9yIGlmIG5vbi1lcXVhbGl0eSBvcGVyYXRvcnMgYXJlIHVzZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIFZhbGlkIGlucHV0c1xuICogeyB0ZWFtSWQ6IHsgZXE6ICd0ZWFtLTEyMycgfSB9ICDihpIgIHsgdGVhbUlkOiAndGVhbS0xMjMnIH1cbiAqIHsgdGVhbUlkOiAndGVhbS0xMjMnIH0gICAgICAgICDihpIgIHsgdGVhbUlkOiAndGVhbS0xMjMnIH1cbiAqIFxuICogLy8gSW52YWxpZCAtIHdpbGwgVEhST1dcbiAqIHsgY3JlYXRlZEF0OiB7IGd0OiAnMjAyNC0wMS0wMScgfSB9ICAvLyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvclxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKFxuICAgIGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgaW5kZXhOYW1lPzogc3RyaW5nXG4pOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBpZiAoIWZpbHRlcnMpIHJldHVybiB7fTtcblxuICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuXG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhmaWx0ZXJzKSkge1xuICAgICAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEaXJlY3QgdmFsdWUgKHNob3J0aGFuZCBmb3IgZXF1YWxpdHkpXG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXN1bHRbIGtleSBdID0gdmFsdWU7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBmaWx0ZXIgb3BlcmF0b3Igb2JqZWN0c1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBPYmplY3Qua2V5cyh2YWx1ZSk7XG5cbiAgICAgICAgaWYgKG9wZXJhdG9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSAnZXEnIGlzIHZhbGlkIGZvciBjb21wb3NpdGUga2V5IGF0dHJpYnV0ZXNcbiAgICAgICAgaWYgKHZhbHVlLmVxICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBtaXhlZCBvcGVyYXRvcnMgKGVxICsgb3RoZXJzKSAtIHRoYXQncyBhIG1pc3Rha2VcbiAgICAgICAgICAgIGNvbnN0IG90aGVyT3BzID0gb3BlcmF0b3JzLmZpbHRlcihvcCA9PiBvcCAhPT0gJ2VxJyk7XG4gICAgICAgICAgICBpZiAob3RoZXJPcHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcihrZXksIG90aGVyT3BzLCBpbmRleE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlLmVxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gTm9uLWVxdWFsaXR5IG9wZXJhdG9ycyAtIHRocm93IGltbWVkaWF0ZWx5XG4gICAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEluZGV4RmlsdGVyRXJyb3Ioa2V5LCBvcGVyYXRvcnMsIGluZGV4TmFtZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIEZpbmRzIGEgbWF0Y2hpbmcgaW5kZXggYmFzZWQgb24gdGhlIHByb3ZpZGVkIGZpbHRlcnMgYW5kIHNjaGVtYS5cbiAqIEBwYXJhbSBzY2hlbWEgLSBUaGUgZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVycyB0byBtYXRjaCBhZ2FpbnN0XG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBlbnRpdHlcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gVGhlIGVudGl0eSBzZXJ2aWNlXG4gKiBAcmV0dXJucyBUaGUgbmFtZSBvZiB0aGUgbWF0Y2hpbmcgaW5kZXggYW5kIHRoZSBmaWx0ZXJzIHVzZWQgdG8gbWF0Y2ggaXQgb3IgdW5kZWZpbmVkIGlmIG5vIG1hdGNoIGlzIGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaW5kTWF0Y2hpbmdJbmRleChcbiAgICBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBFbnRpdHlTZXJ2aWNlVHlwZUZyb21TY2hlbWE8YW55PlxuKTogeyBpbmRleE5hbWU6IHN0cmluZzsgaW5kZXhGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IH0gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOmZpbmRNYXRjaGluZ0luZGV4Jyk7XG4gICAgaWYgKCFmaWx0ZXJzKSBmaWx0ZXJzID0ge307XG5cbiAgICAvLyBDb252ZXJ0IEZpbHRlckdyb3VwIGZvcm1hdCB0byBzaW1wbGUgZm9ybWF0IGZvciBpbmRleCBtYXRjaGluZ1xuICAgIGNvbnN0IHNpbXBsZUZpbHRlcnMgPSBmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlcnMpO1xuICAgIGxvZ2dlci5kZWJ1ZyhgQ29udmVydGVkIGZpbHRlcnMgZm9yIGluZGV4IG1hdGNoaW5nOmAsIHsgb3JpZ2luYWw6IGZpbHRlcnMsIHNpbXBsZTogc2ltcGxlRmlsdGVycyB9KTtcblxuICAgIC8vIEZpcnN0IHRyeSBFbGVjdHJvREIncyBpbmRleCBtYXRjaGluZ1xuICAgIGNvbnN0IHJlcG9zaXRvcnkgPSBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKTtcbiAgICBjb25zdCB7IGtleXMsIGluZGV4LCBzaG91bGRTY2FuIH0gPSAocmVwb3NpdG9yeSBhcyBhbnkpLl9maW5kQmVzdEluZGV4S2V5TWF0Y2goc2ltcGxlRmlsdGVycyk7XG5cbiAgICBsb2dnZXIuZGVidWcoYEZvdW5kIEVsZWN0cm9EQiBpbmRleDogJHtpbmRleH0gd2l0aCAke2tleXMubGVuZ3RofSBhdHRyaWJ1dGUgbWF0Y2hlcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9IHdpdGggZmlsdGVycyBhbmQgc2NhbjogJHtzaG91bGRTY2FufSAtIGAsIGtleXMsIHNpbXBsZUZpbHRlcnMpO1xuXG4gICAgLy8gSWYgd2UgZm91bmQgYSBtYXRjaGluZyBpbmRleCwgdXNlIGl0XG4gICAgaWYgKCFzaG91bGRTY2FuKSB7XG4gICAgICAgIGNvbnN0IGluZGV4RmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuXG4gICAgICAgIC8vIEFkZCBtYXRjaGVkIGtleXMgdG8gaW5kZXhGaWx0ZXJzICh1c2Ugc2ltcGxlRmlsdGVycyB3aGljaCBoYXMgdGhlIHJpZ2h0IGZvcm1hdClcbiAgICAgICAga2V5cy5mb3JFYWNoKChrZXk6IHsgbmFtZTogc3RyaW5nOyB0eXBlOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyVmFsdWUgPSBzaW1wbGVGaWx0ZXJzWyBrZXkubmFtZSBdO1xuICAgICAgICAgICAgaWYgKGZpbHRlclZhbHVlKSB7XG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIGJvdGggeyBlcTogdmFsdWUgfSBhbmQgZGlyZWN0IHZhbHVlIGZvcm1hdHNcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnNbIGtleS5uYW1lIF0gPSBmaWx0ZXJWYWx1ZS5lcSAhPT0gdW5kZWZpbmVkID8gZmlsdGVyVmFsdWUuZXEgOiBmaWx0ZXJWYWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gTWFwIEVsZWN0cm9EQidzIGludGVybmFsIGluZGV4IG5hbWUgYmFjayB0byBvdXIgc2NoZW1hJ3MgaW5kZXggbmFtZVxuICAgICAgICBsZXQgc2NoZW1hSW5kZXhOYW1lID0gaW5kZXg7XG4gICAgICAgIGlmIChpbmRleCA9PT0gJycpIHtcbiAgICAgICAgICAgIHNjaGVtYUluZGV4TmFtZSA9ICdwcmltYXJ5JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGluZGV4IGluIG91ciBzY2hlbWEgdGhhdCBtYXRjaGVzIHRoaXMgR1NJXG4gICAgICAgICAgICBjb25zdCBpbmRleGVzID0gc2NoZW1hLmluZGV4ZXM7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgbmFtZSwgaW5kZXhEZWYgXSBvZiBPYmplY3QuZW50cmllcyhpbmRleGVzKSkge1xuICAgICAgICAgICAgICAgIGlmIChpbmRleERlZi5pbmRleCA9PT0gaW5kZXgpIHtcbiAgICAgICAgICAgICAgICAgICAgc2NoZW1hSW5kZXhOYW1lID0gbmFtZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBFbGVjdHJvREIgbWF0Y2hlZCBpbmRleDogJHtzY2hlbWFJbmRleE5hbWV9IChpbnRlcm5hbDogJHtpbmRleH0pIHdpdGggJHtrZXlzLmxlbmd0aH0gYXR0cmlidXRlIG1hdGNoZXMgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfSB3aXRoIGZpbHRlcnM6YCwgaW5kZXhGaWx0ZXJzKTtcbiAgICAgICAgcmV0dXJuIHsgaW5kZXhOYW1lOiBzY2hlbWFJbmRleE5hbWUsIGluZGV4RmlsdGVycyB9O1xuICAgIH1cblxuICAgIC8vIElmIG5vIGluZGV4IG1hdGNoIGZvdW5kLCBjaGVjayBmb3IgdGVtcGxhdGUgbWF0Y2ggb3IgXCJhbGwgcmVjb3Jkc1wiIGluZGV4XG4gICAgY29uc3QgaW5kZXhlcyA9IHNjaGVtYS5pbmRleGVzO1xuICAgIGZvciAoY29uc3QgWyBpbmRleE5hbWUsIGluZGV4RGVmIF0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXhlcykpIHtcbiAgICAgICAgaWYgKGluZGV4RGVmLnBrLnRlbXBsYXRlICYmIHR5cGVvZiBpbmRleERlZi5way50ZW1wbGF0ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIC8vIEVudGl0eS1zcGVjaWZpYyB0ZW1wbGF0ZSBtYXRjaFxuICAgICAgICAgICAgaWYgKGluZGV4RGVmLnBrLnRlbXBsYXRlLnRvTG93ZXJDYXNlKCkgPT09IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgdGVtcGxhdGUgbWF0Y2hpbmcgaW5kZXg6ICR7aW5kZXhOYW1lfSBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhOYW1lLFxuICAgICAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gXCJBbGwgcmVjb3Jkc1wiIGluZGV4IHBhdHRlcm4gLSBjb25zdGFudCBQSyB3aXRoIGVtcHR5IGNvbXBvc2l0ZVxuICAgICAgICAgICAgLy8gVXNlZnVsIGZvciBzb3J0ZWQgbGlzdGluZ3Mgd2l0aG91dCBmaWx0ZXJzIChlLmcuLCBBTExfRVZFTlRTLCBBTExfTE9HUylcbiAgICAgICAgICAgIGlmIChpbmRleERlZi5way5jb21wb3NpdGUgJiYgaW5kZXhEZWYucGsuY29tcG9zaXRlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgXCJhbGwgcmVjb3Jkc1wiIGluZGV4OiAke2luZGV4TmFtZX0gd2l0aCBjb25zdGFudCBQSyB0ZW1wbGF0ZTogJHtpbmRleERlZi5way50ZW1wbGF0ZX1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZXMgYSBsaXN0IG9mIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBvcHRpb25zLlxuICpcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGxpc3RpbmcgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBhcnJheSBvZiBlbnRpdGllcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxpc3RFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogTGlzdEVudGl0eUFyZ3M8Uz4pIHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5U2VydmljZSxcblxuICAgICAgICBhY3RvcixcbiAgICAgICAgdGVuYW50LFxuXG4gICAgICAgIGNydWRUeXBlID0gJ2xpc3QnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpsaXN0RW50aXR5JyksXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgICAgIHF1ZXJ5ID0ge30sXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGZpbHRlcnMgPSB7fSxcbiAgICAgICAgYXR0cmlidXRlcyA9IFtdLFxuICAgICAgICBwYWdpbmF0aW9uID0geyBvcmRlcjogJ2FzYycsIHBhZ2VyOiAnY3Vyc29yJywgY3Vyc29yOiBudWxsLCBjb3VudDogMjUsIHBhZ2VzOiB1bmRlZmluZWQsIGxpbWl0OiB1bmRlZmluZWQgfSxcbiAgICAgICAgaW5kZXg6IHNwZWNpZmllZEluZGV4XG4gICAgfSA9IHF1ZXJ5O1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDYWxsZWQgRW50aXR5Q3J1ZCB+IGxpc3RFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZmlsdGVycytwYWdpbmc6YCk7XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goe2V2ZW50OiAnYmVmb3JlTGlzdCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIC8vIGF1dGhvcml6ZSB0aGUgYWN0b3JcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoe2VudGl0eU5hbWUsIGNydWRUeXBlLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkOiBcIiArIHsgY2F1c2U6IGF1dGhvcml6YXRpb24gfSk7XG4gICAgLy8gfVxuXG4gICAgLy8gQ2hlY2sgaWYgd2UgaGF2ZSBhIGZpbHRlciB0aGF0IG1hdGNoZXMgYW4gaW5kZXhcbiAgICBjb25zdCBzY2hlbWEgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpO1xuICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gc3BlY2lmaWVkSW5kZXhcbiAgICAgICAgPyB7IGluZGV4TmFtZTogc3BlY2lmaWVkSW5kZXgubmFtZSwgaW5kZXhGaWx0ZXJzOiBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoc3BlY2lmaWVkSW5kZXguZmlsdGVycywgc3BlY2lmaWVkSW5kZXgubmFtZSkgfVxuICAgICAgICA6IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgZW50aXR5TmFtZSwgZW50aXR5U2VydmljZSk7XG5cbiAgICBsb2dnZXIuZGVidWcoYE1hdGNoIHJlc3VsdDpgLCBtYXRjaFJlc3VsdCk7XG4gICAgLy8gVXNlIHRoZSBhcHByb3ByaWF0ZSBpbmRleCBpZiBhdmFpbGFibGVcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZW50aXR5U2VydmljZS5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICBsZXQgZW50aXRpZXM7XG4gICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgIC8vIFVzZSBpbmRleCBxdWVyeSBpZiB3ZSBoYXZlIGEgbWF0Y2hcbiAgICAgICAgY29uc3QgaW5kZXhRdWVyeSA9IHJlcG9zaXRvcnkucXVlcnlbIG1hdGNoUmVzdWx0LmluZGV4TmFtZSBdKG1hdGNoUmVzdWx0LmluZGV4RmlsdGVycyk7XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBpbmRleFF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgZW50aXRpZXMgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdsaXN0JywgKCkgPT5cbiAgICAgICAgICAgIGluZGV4UXVlcnkuZ28oeyBhdHRyaWJ1dGVzOiBhdHRyaWJ1dGVzIGFzIGFueSwgLi4ucmVtb3ZlRW1wdHkocGFnaW5hdGlvbiksIC4uLlF1ZXJ5T2JzZXJ2ZXIuZ2V0Q2FwYWNpdHlHb09wdGlvbnMoKSB9KSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgaW5kZXhOYW1lOiBtYXRjaFJlc3VsdC5pbmRleE5hbWUsIHBhZ2luYXRpb24gfVxuICAgICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVzZSBtYXRjaCBmb3IgZnVsbCBzY2FuXG4gICAgICAgIGxvZ2dlci53YXJuKGBXQVJOSU5HOiBObyBtYXRjaGluZyBpbmRleCBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9LCB1c2luZyBtYXRjaCBmb3IgZnVsbCBzY2FuYCwgZmlsdGVycyk7XG5cbiAgICAgICAgLy8gVHJhY2sgZnVsbCBzY2FuIC0gQ1JJVElDQUw6IGV4cGVuc2l2ZSBwZXJmb3JtYW5jZS9jb3N0IGlzc3VlXG4gICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChgZW50aXR5LmZ1bGxfc2NhbmAsIDEsIHtcbiAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZSwgb3BlcmF0aW9uOiAnbGlzdCcgfSxcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBjaGVja3BvaW50IGZvciB2aXNpYmlsaXR5XG4gICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAnZGIuZW50aXR5X25hbWUnOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICdkYi5vcGVyYXRpb24nOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgJ2RiLndhcm5pbmcnOiAnbm9faW5kZXhfZm91bmQnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAnZGIuZnVsbF9zY2FuJzogMSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkYXRhOiB7IGZ1bGxTY2FuRmlsdGVyczogZmlsdGVycyB8fCB7fSB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBzY2FuUXVlcnkgPSByZXBvc2l0b3J5LnNjYW47XG4gICAgICAgIGlmIChmaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KGZpbHRlcnMpKSB7XG4gICAgICAgICAgICBzY2FuUXVlcnkud2hlcmUoKGF0dHI6IGFueSwgb3A6IGFueSkgPT4gZW50aXR5RmlsdGVyQ3JpdGVyaWFUb0V4cHJlc3Npb24oZmlsdGVycywgYXR0ciwgb3ApKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBUT0RPOiBhZGQgYXR0cmlidXRlcyB0byBzY2FuIHF1ZXJ5XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAnc2NhbicsICgpID0+XG4gICAgICAgICAgICBzY2FuUXVlcnkuZ28oeyAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSwgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pLFxuICAgICAgICAgICAgeyBmaWx0ZXJzLCBwYWdpbmF0aW9uIH1cbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXIuZGlzcGF0Y2goeyBldmVudDogJ2FmdGVyTGlzdCcsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBsaXN0RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFF1ZXJ5RW50aXR5QXJnczxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIHF1ZXJ5OiBFbnRpdHlRdWVyeTxTY2g+XG59XG5cbi8qKlxuICogRXhlY3V0ZXMgYSBxdWVyeSBvbiB0aGUgc3BlY2lmaWVkIGVudGl0eS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIHRoZSBxdWVyeS5cbiAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXN1bHQgb2YgdGhlIHF1ZXJ5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcXVlcnlFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogUXVlcnlFbnRpdHlBcmdzPFM+KSB7XG5cbiAgICBjb25zdCB7XG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdxdWVyeScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnF1ZXJ5RW50aXR5JyksXG4gICAgICAgIGF1dGhvcml6ZXIgPSBBdXRob3JpemVyLkRlZmF1bHQsXG4gICAgICAgIGV2ZW50RGlzcGF0Y2hlciA9IEV2ZW50RGlzcGF0Y2hlci5EZWZhdWx0LFxuXG4gICAgICAgIHF1ZXJ5ID0ge31cblxuICAgIH0gPSBvcHRpb25zO1xuXG4gICAgY29uc3Qge1xuICAgICAgICBmaWx0ZXJzID0ge30sXG4gICAgICAgIGF0dHJpYnV0ZXMgPSBbXSxcbiAgICAgICAgcGFnaW5hdGlvbiA9IHsgb3JkZXI6ICdhc2MnLCBwYWdlcjogJ2N1cnNvcicsIGN1cnNvcjogbnVsbCwgY291bnQ6IDI1LCBwYWdlczogdW5kZWZpbmVkLCBsaW1pdDogdW5kZWZpbmVkIH0sXG4gICAgICAgIGluZGV4OiBzcGVjaWZpZWRJbmRleFxuICAgIH0gPSBxdWVyeTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBxdWVyeUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBmaWx0ZXJzK3BhZ2luZzpgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdiZWZvcmVRdWVyeScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgLy8gLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGFjdG9yLCB0ZW5hbnR9KTtcbiAgICAvLyBpZighYXV0aG9yaXphdGlvbi5wYXNzKXtcbiAgICAvLyAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXphdGlvbiBmYWlsZWQ6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBDaGVjayBpZiB3ZSBoYXZlIGEgZmlsdGVyIHRoYXQgbWF0Y2hlcyBhbiBpbmRleFxuICAgIGNvbnN0IHNjaGVtYSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBzcGVjaWZpZWRJbmRleFxuICAgICAgICA/IHsgaW5kZXhOYW1lOiBzcGVjaWZpZWRJbmRleC5uYW1lLCBpbmRleEZpbHRlcnM6IGV4dHJhY3RJbmRleEZpbHRlclZhbHVlcyhzcGVjaWZpZWRJbmRleC5maWx0ZXJzLCBzcGVjaWZpZWRJbmRleC5uYW1lKSB9XG4gICAgICAgIDogZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCBlbnRpdHlOYW1lLCBlbnRpdHlTZXJ2aWNlKTtcblxuICAgIC8vIFVzZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXggaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgbGV0IGVudGl0aWVzO1xuICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAvLyBVc2UgaW5kZXggcXVlcnkgaWYgd2UgaGF2ZSBhIG1hdGNoXG4gICAgICAgIGNvbnN0IGluZGV4UXVlcnkgPSByZXBvc2l0b3J5LnF1ZXJ5WyBtYXRjaFJlc3VsdC5pbmRleE5hbWUgXShtYXRjaFJlc3VsdC5pbmRleEZpbHRlcnMpO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgaW5kZXhRdWVyeS53aGVyZSgoYXR0cjogYW55LCBvcDogYW55KSA9PiBlbnRpdHlGaWx0ZXJDcml0ZXJpYVRvRXhwcmVzc2lvbihmaWx0ZXJzLCBhdHRyLCBvcCkpO1xuICAgICAgICB9XG4gICAgICAgIGVudGl0aWVzID0gYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjayhlbnRpdHlOYW1lLCAncXVlcnknLCAoKSA9PlxuICAgICAgICAgICAgaW5kZXhRdWVyeS5nbyh7IGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXMgYXMgYW55LCAuLi5yZW1vdmVFbXB0eShwYWdpbmF0aW9uKSwgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pLFxuICAgICAgICAgICAgeyBmaWx0ZXJzLCBpbmRleE5hbWU6IG1hdGNoUmVzdWx0LmluZGV4TmFtZSwgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoIGZvciBmdWxsIHNjYW5cbiAgICAgICAgbG9nZ2VyLndhcm4oYFdBUk5JTkc6IE5vIG1hdGNoaW5nIGluZGV4IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX0sIHVzaW5nIG1hdGNoIGZvciBmdWxsIHNjYW5gLCBmaWx0ZXJzKTtcblxuICAgICAgICAvLyBUcmFjayBmdWxsIHNjYW4gLSBDUklUSUNBTDogZXhwZW5zaXZlIHBlcmZvcm1hbmNlL2Nvc3QgaXNzdWVcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KGBlbnRpdHkuZnVsbF9zY2FuYCwgMSwge1xuICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lLCBvcGVyYXRpb246ICdxdWVyeScgfSxcbiAgICAgICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBjaGVja3BvaW50IGZvciB2aXNpYmlsaXR5XG4gICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAnZGIuZW50aXR5X25hbWUnOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICdkYi5vcGVyYXRpb24nOiAncXVlcnknLFxuICAgICAgICAgICAgICAgICdkYi53YXJuaW5nJzogJ25vX2luZGV4X2ZvdW5kJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgJ2RiLmZ1bGxfc2Nhbic6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YTogeyBmdWxsU2NhbkZpbHRlcnM6IGZpbHRlcnMgfHwge30gfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3Qgc2NhblF1ZXJ5ID0gcmVwb3NpdG9yeS5zY2FuO1xuICAgICAgICBpZiAoZmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgc2NhblF1ZXJ5LndoZXJlKChhdHRyOiBhbnksIG9wOiBhbnkpID0+IGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uKGZpbHRlcnMsIGF0dHIsIG9wKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogYWRkIGF0dHJpYnV0ZXMgdG8gc2NhbiBxdWVyeVxuICAgICAgICBlbnRpdGllcyA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3NjYW4nLCAoKSA9PlxuICAgICAgICAgICAgc2NhblF1ZXJ5LmdvKHsgLi4ucmVtb3ZlRW1wdHkocGFnaW5hdGlvbiksIC4uLlF1ZXJ5T2JzZXJ2ZXIuZ2V0Q2FwYWNpdHlHb09wdGlvbnMoKSB9KSxcbiAgICAgICAgICAgIHsgZmlsdGVycywgcGFnaW5hdGlvbiB9XG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHsgZXZlbnQ6ICdhZnRlclF1ZXJ5JywgY29udGV4dDogYXJndW1lbnRzIH0pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IHF1ZXJ5RW50aXR5IH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGZpbHRlcnMrcGFnaW5nOmApO1xuXG4gICAgcmV0dXJuIGVudGl0aWVzO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgdXBkYXRpbmcgYW4gZW50aXR5LlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzU2NoZW1hIC0gVGhlIGlucHV0IHNjaGVtYXMgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eUFyZ3M8XG4gICAgU2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIE9wc1NjaGVtYSBleHRlbmRzIFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPiA9IFRFbnRpdHlPcHNJbnB1dFNjaGVtYXM8U2NoPixcbj4gZXh0ZW5kcyBCYXNlRW50aXR5Q3J1ZEFyZ3M8U2NoPiB7XG4gICAgLyoqXG4gICAgICogVGhlIElkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdnZXQnIF07XG4gICAgLyoqXG4gICAgICogVGhlIGRhdGEgdG8gdXBkYXRlIHRoZSBlbnRpdHkgd2l0aC5cbiAgICAgKi9cbiAgICBkYXRhOiBPcHNTY2hlbWFbICd1cGRhdGUnIF07XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXR0cmlidXRlcyBmb3IgcGF0Y2ggb3BlcmF0aW9uLlxuICAgICAqL1xuICAgIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycztcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBjb25kaXRpb25zIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvbi5cbiAgICAgKi9cbiAgICBjb25kaXRpb25zPzogYW55OyAvLyBUT0RPXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJlLWNhbGN1bGF0ZWQgY29tcG9zaXRlIGtleSBkYXRhLiBJZiBwcm92aWRlZCwgdGhpcyB3aWxsIGJlIHVzZWQgZGlyZWN0bHkuXG4gICAgICogSWYgbm90IHByb3ZpZGVkIGFuZCBjb21wb3NpdGUga2V5cyBhcmUgbmVlZGVkLCB0aGV5IHdpbGwgYmUgY2FsY3VsYXRlZCBpbnRlcm5hbGx5LlxuICAgICAqL1xuICAgIGNvbXBvc2l0ZUtleURhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVwZGF0ZUVudGl0eU9wZXJhdG9ycyB7XG4gICAgcmVtb3ZlPzogc3RyaW5nW107XG59XG5cbi8qKlxuICogUmVzcG9uc2UgdHlwZSBmb3IgdXBkYXRlIGVudGl0eSBvcGVyYXRpb24uXG4gKiBQcm92aWRlcyBhIHR5cGVkIHdyYXBwZXIgZm9yIHRoZSBlbGVjdHJvZGIgdXBkYXRlIHJlc3BvbnNlLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCB0eXBlIFVwZGF0ZUVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbn1cblxuaW50ZXJmYWNlIFByZXBhcmVDb21wb3NpdGVBdHRyaWJ1dGVzQXJnczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG4gICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgIGVudGl0eVNlcnZpY2U6IEVudGl0eVNlcnZpY2VUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICBpZGVudGlmaWVyczogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgICBkYXRhOiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogU2V0PHN0cmluZz47XG4gICAgbG9nZ2VyOiBJTG9nZ2VyO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0ZvclVwZGF0ZTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBhcmdzOiBQcmVwYXJlQ29tcG9zaXRlQXR0cmlidXRlc0FyZ3M8Uz5cbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgaWRlbnRpZmllcnMsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlcyxcbiAgICAgICAgbG9nZ2VyLFxuICAgIH0gPSBhcmdzO1xuXG4gICAgY29uc3QgY29tcG9zaXRlS2V5VmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgYXR0cmlidXRlc1RvRmV0Y2ggPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBkYXRhQXNSZWNvcmQgPSBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIGFueT47IC8vIENhc3QgZm9yIGR5bmFtaWMgYWNjZXNzXG5cbiAgICBpZiAocmVxdWlyZWRDb21wb3NpdGVBdHRyaWJ1dGVzLnNpemUgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHt9OyAvLyBObyBjb21wb3NpdGUgYXR0cmlidXRlcyBuZWVkZWRcbiAgICB9XG5cbiAgICAvLyBvbmx5IGluY2x1ZGUgd2hhdCdzIG5vdCBhbHJlYWR5IGluIGRhdGEgb3IgaWRlbnRpZmllcnNcbiAgICByZXF1aXJlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuZm9yRWFjaChhdHRyID0+IHtcbiAgICAgICAgaWYgKCFkYXRhQXNSZWNvcmQuaGFzT3duUHJvcGVydHkoYXR0cikgJiYgIWlkZW50aWZpZXJzLmhhc093blByb3BlcnR5KGF0dHIpKSB7XG4gICAgICAgICAgICBhdHRyaWJ1dGVzVG9GZXRjaC5hZGQoYXR0cik7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChhdHRyaWJ1dGVzVG9GZXRjaC5zaXplID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYE5lZWQgdG8gZmV0Y2ggYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXM6YCwgQXJyYXkuZnJvbShhdHRyaWJ1dGVzVG9GZXRjaCkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBleGlzdGluZ1JlY29yZENvbnRhaW5lciA9IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpXG4gICAgICAgICAgICAgICAgLmdldChpZGVudGlmaWVycylcbiAgICAgICAgICAgICAgICAuZ28oeyBhdHRyaWJ1dGVzOiBBcnJheS5mcm9tKGF0dHJpYnV0ZXNUb0ZldGNoKSwgY29uc2lzdGVudFJlYWQ6IHRydWUgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUmVjb3JkRGF0YSA9IGV4aXN0aW5nUmVjb3JkQ29udGFpbmVyLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgaWYgKCFleGlzdGluZ1JlY29yZERhdGEpIHtcblxuICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBObyBleGlzdGluZyByZWNvcmQgZm91bmQgZm9yIGNvbXBvc2l0ZSBrZXlzOmAsIEFycmF5LmZyb20oYXR0cmlidXRlc1RvRmV0Y2gpKTtcblxuICAgICAgICAgICAgfSBlbHNlIHtcblxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNUb0ZldGNoLmZvckVhY2goYXR0ciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleGlzdGluZ1JlY29yZERhdGEuaGFzT3duUHJvcGVydHkoYXR0cikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZUtleVZhbHVlc1sgYXR0ciBdID0gZXhpc3RpbmdSZWNvcmREYXRhWyBhdHRyIF07XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBBdHRyaWJ1dGUgbm90IGZvdW5kIC0ganVzdCBsb2cgZGVidWcsIGRvbid0IHdhcm4gKGNvdWxkIGJlIG9wdGlvbmFsIHNwYXJzZSBpbmRleCBhdHRyaWJ1dGUpXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2dnZXIuZGVidWcoYENvbXBvc2l0ZSBrZXkgYXR0cmlidXRlIFwiJHthdHRyfVwiIChJRDogJHtKU09OLnN0cmluZ2lmeShpZGVudGlmaWVycyl9KSBub3QgZm91bmQgaW4gZXhpc3RpbmcgcmVjb3JkIChtYXkgYmUgb3B0aW9uYWwpLmApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgRXJyb3IgZmV0Y2hpbmcgYXR0cmlidXRlcyBmb3IgY29tcG9zaXRlIGtleXMgKElEOiAke0pTT04uc3RyaW5naWZ5KGlkZW50aWZpZXJzKX0pOmAsIGVycm9yKTtcblxuICAgICAgICAgICAgLy8gVHJhY2sgZGF0YWJhc2UgZXJyb3IgbWV0cmljXG4gICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoYGVudGl0eS5jb21wb3NpdGVfa2V5LmZldGNoX2Vycm9yYCwgMSwge1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogYXJncy5lbnRpdHlOYW1lIH0sXG4gICAgICAgICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBsb2dnZXIuZGVidWcoYFByZXBhcmVkIGNvbXBvc2l0ZSBrZXkgdmFsdWVzOmAsIGNvbXBvc2l0ZUtleVZhbHVlcyk7XG4gICAgcmV0dXJuIGNvbXBvc2l0ZUtleVZhbHVlcztcbn1cblxuLyoqXG4gKiBVcGRhdGVzIGFuIGVudGl0eSBpbiB0aGUgZGF0YWJhc2UuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEBwYXJhbSB7VXBkYXRlRW50aXR5QXJnczxTPn0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciB1cGRhdGluZyB0aGUgZW50aXR5LlxuICogQHJldHVybnMge1Byb21pc2U8VXBkYXRlRW50aXR5UmVzcG9uc2U8Uz4+fSAtIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSB1cGRhdGVkIGVudGl0eS5cbiAqIEB0aHJvd3Mge0Vycm9yfSAtIElmIG5vIGRhdGEgaXMgcHJvdmlkZWQgZm9yIHRoZSB1cGRhdGUgb3BlcmF0aW9uLCBvciBpZiB2YWxpZGF0aW9uIG9yIGF1dGhvcml6YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8VXBkYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICBjb25zdCB7XG4gICAgICAgIGlkLFxuICAgICAgICBkYXRhLFxuICAgICAgICBvcGVyYXRvcnMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG4gICAgICAgIGNydWRUeXBlID0gJ3VwZGF0ZScsXG4gICAgICAgIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ1JVRC1zZXJ2aWNlOnVwZGF0ZUVudGl0eScpLFxuICAgICAgICB2YWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yLFxuICAgICAgICBhdXRob3JpemVyID0gQXV0aG9yaXplci5EZWZhdWx0LFxuICAgICAgICBldmVudERpc3BhdGNoZXIgPSBFdmVudERpc3BhdGNoZXIuRGVmYXVsdCxcbiAgICAgICAgY29tcG9zaXRlS2V5RGF0YSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWRTZXJ2aWNlPEUgfiB1cGRhdGUgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gZGF0YTpgLCB7IGRhdGEsIHByb3ZpZGVkQ29tcG9zaXRlS2V5RGF0YTogY29tcG9zaXRlS2V5RGF0YSB9KTtcblxuICAgIGlmICghZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBkYXRhIHByb3ZpZGVkIGZvciB1cGRhdGUgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIC8vIHByZSBldmVudHNcbiAgICAvLyBhd2FpdCBldmVudERpc3BhdGNoZXI/LmRpc3BhdGNoKHsgZXZlbnQ6ICdiZWZvcmVVcGRhdGUnLCBjb250ZXh0OiBhcmd1bWVudHMgfSk7XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBkYXRhLFxuICAgICAgICBhY3RvcjogYWN0b3JcbiAgICB9KTtcblxuICAgIGlmICghdmFsaWRhdGlvbi5wYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbi5lcnJvcnMpO1xuICAgIH1cblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvciBcbiAgICAvLyBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgYXV0aG9yaXplci5hdXRob3JpemUoeyBlbnRpdHlOYW1lLCBjcnVkVHlwZSwgaWRlbnRpZmllcnMsIGRhdGEsIGFjdG9yLCB0ZW5hbnQgfSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciB1cGRhdGU6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyAtLS0gQ29tcG9zaXRlIEtleSBIYW5kbGluZyAtLS1cbiAgICBjb25zdCBzY2hlbWEgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYSgpO1xuICAgIGNvbnN0IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBpZiAoc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBpbmRleE5hbWUgaW4gc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4RGVmaW5pdGlvbiA9IHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChpbmRleERlZmluaXRpb24pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwa0NvbXBvc2l0ZSA9IGluZGV4RGVmaW5pdGlvbi5waz8uY29tcG9zaXRlO1xuICAgICAgICAgICAgICAgIGlmIChwa0NvbXBvc2l0ZSAmJiBBcnJheS5pc0FycmF5KHBrQ29tcG9zaXRlKSkge1xuICAgICAgICAgICAgICAgICAgICBwa0NvbXBvc2l0ZS5mb3JFYWNoKGF0dHIgPT4gYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuYWRkKGF0dHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3Qgc2tDb21wb3NpdGUgPSBpbmRleERlZmluaXRpb24uc2s/LmNvbXBvc2l0ZTtcbiAgICAgICAgICAgICAgICBpZiAoc2tDb21wb3NpdGUgJiYgQXJyYXkuaXNBcnJheShza0NvbXBvc2l0ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2tDb21wb3NpdGUuZm9yRWFjaChhdHRyID0+IGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzLmFkZChhdHRyKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBpZiAoYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMuc2l6ZSA+IDApIHtcbiAgICAgICAgaWYgKGNvbXBvc2l0ZUtleURhdGEgJiYgdHlwZW9mIGNvbXBvc2l0ZUtleURhdGEgPT09ICdvYmplY3QnKSB7XG5cbiAgICAgICAgICAgIGxvZ2dlci5kZWJ1ZyhgVXNpbmcgcHJvdmlkZWQgY29tcG9zaXRlS2V5RGF0YSBmb3IgdXBkYXRlLmAsIGNvbXBvc2l0ZUtleURhdGEpO1xuXG4gICAgICAgICAgICBmaW5hbENvbXBvc2l0ZUtleVZhbHVlc0ZvckVsZWN0cm9EQiA9IGNvbXBvc2l0ZUtleURhdGE7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgY292ZXJzIGFsbCBhbGxSZWZlcmVuY2VkQ29tcG9zaXRlQXR0cmlidXRlc1xuICAgICAgICAgICAgY29uc3QgbWlzc2luZ0Zyb21Qcm92aWRlZCA9IEFycmF5LmZyb20oYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMpLmZpbHRlcihhdHRyID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAhZGF0YS5oYXNPd25Qcm9wZXJ0eShhdHRyKVxuICAgICAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICAgICAhaWRlbnRpZmllcnMuaGFzT3duUHJvcGVydHkoYXR0cilcbiAgICAgICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAgICAgIWZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCLmhhc093blByb3BlcnR5KGF0dHIpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAobWlzc2luZ0Zyb21Qcm92aWRlZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYFByb3ZpZGVkIGNvbXBvc2l0ZUtleURhdGEgaXMgbWlzc2luZyBzb21lIHJlcXVpcmVkIGNvbXBvc2l0ZSBhdHRyaWJ1dGVzOiAke21pc3NpbmdGcm9tUHJvdmlkZWQuam9pbignLCAnKX0uIFVwZGF0ZSBtYXkgZmFpbCBpZiB0aGVzZSBhcmUgbmVlZGVkIGJ5IEVsZWN0cm9EQi5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgICBsb2dnZXIuZGVidWcoYE5vIGNvbXBvc2l0ZUtleURhdGEgcHJvdmlkZWQsIHByZXBhcmluZyBjb21wb3NpdGUgYXR0cmlidXRlcyBpbnRlcm5hbGx5LiBSZXF1aXJlZDpgLCBBcnJheS5mcm9tKGFsbFJlZmVyZW5jZWRDb21wb3NpdGVBdHRyaWJ1dGVzKSk7XG5cbiAgICAgICAgICAgIGZpbmFsQ29tcG9zaXRlS2V5VmFsdWVzRm9yRWxlY3Ryb0RCID0gYXdhaXQgcHJlcGFyZUNvbXBvc2l0ZUF0dHJpYnV0ZXNGb3JVcGRhdGUoe1xuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZGF0YTogZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+LFxuICAgICAgICAgICAgICAgIHJlcXVpcmVkQ29tcG9zaXRlQXR0cmlidXRlczogYWxsUmVmZXJlbmNlZENvbXBvc2l0ZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgbG9nZ2VyLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgTm8gY29tcG9zaXRlIGF0dHJpYnV0ZXMgZGVmaW5lZCBpbiBzY2hlbWEgb3IgbmVlZGVkIGZvciB0aGlzIHVwZGF0ZS5gKTtcbiAgICB9XG4gICAgLy8gLS0tIEVuZCBDb21wb3NpdGUgS2V5IEhhbmRsaW5nIC0tLVxuXG5cblxuICAgIC8vIFVzZSBFbGVjdHJvREIgZm9yIGFsbCBmaWVsZHMgaW5jbHVkaW5nIF9hY3RvciAobm93IGluIHNjaGVtYSlcbiAgICBjb25zdCBxdWVyeSA9IGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLnBhdGNoKGlkZW50aWZpZXJzKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKGBVc2luZyBjb21wb3NpdGUgdmFsdWVzIGZvciBFbGVjdHJvREIgcGF0Y2g6YCwgZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgICAgICBxdWVyeS5jb21wb3NpdGUoZmluYWxDb21wb3NpdGVLZXlWYWx1ZXNGb3JFbGVjdHJvREIpO1xuICAgIH1cblxuICAgIGlmIChvcGVyYXRvcnM/LnJlbW92ZSkge1xuICAgICAgICBxdWVyeS5yZW1vdmUob3BlcmF0b3JzLnJlbW92ZSBhcyBhbnkpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ3VwZGF0ZScsICgpID0+XG4gICAgICAgIHF1ZXJ5LmdvKHsgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pXG4gICAgKTtcblxuICAgIC8vIC8vIHBvc3QgZXZlbnRzXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyPy5kaXNwYXRjaCh7IGV2ZW50OiAnYWZ0ZXJVcGRhdGUnLCBjb250ZXh0OiB7Li4uYXJndW1lbnRzLCBlbnRpdHl9IH0pO1xuXG4gICAgLy8gcmV0dXJuIGVudGl0eTtcbiAgICBsb2dnZXIuZGVidWcoYENvbXBsZXRlZCBFbnRpdHlDcnVkU2VydmljZTxFIH4gdXBkYXRlIH4gZW50aXR5TmFtZTogJHtlbnRpdHlOYW1lfSB+IGRhdGE6YCwgZGF0YSwgZW50aXR5LmRhdGEpO1xuXG4gICAgcmV0dXJuIGVudGl0eSBhcyBVcGRhdGVFbnRpdHlSZXNwb25zZTxTPjtcbn1cblxuLyoqXG4gKiB0aGUgYXJndW1lbnRzIGZvciBkZWxldGluZyBhbiBlbnRpdHkuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlRW50aXR5QXJnczxcbiAgICBTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgT3BzU2NoZW1hIGV4dGVuZHMgVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+ID0gVEVudGl0eU9wc0lucHV0U2NoZW1hczxTY2g+LFxuPiBleHRlbmRzIEJhc2VFbnRpdHlDcnVkQXJnczxTY2g+IHtcbiAgICAvKipcbiAgICAgKiBUaGUgSUQgb2YgdGhlIGVudGl0eSB0byBiZSBkZWxldGVkLlxuICAgICAqL1xuICAgIGlkOiBPcHNTY2hlbWFbICdkZWxldGUnIF07XG59XG5cbi8qKlxuICogUmVzcG9uc2UgdHlwZSBmb3IgZGVsZXRlIGVudGl0eSBvcGVyYXRpb24uXG4gKiBQcm92aWRlcyBhIHR5cGVkIHdyYXBwZXIgZm9yIHRoZSBlbGVjdHJvZGIgZGVsZXRlIHJlc3BvbnNlLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCB0eXBlIERlbGV0ZUVudGl0eVJlc3BvbnNlPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgZGF0YT86IEVudGl0eVJlc3BvbnNlSXRlbVR5cGVGcm9tU2NoZW1hPFNjaD5cbn1cblxuLyoqXG4gKiBEZWxldGVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgb3B0aW9ucy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIHRoZSBlbnRpdHkuXG4gKiBAcmV0dXJucyBUaGUgZGVsZXRlZCBlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogRGVsZXRlRW50aXR5QXJnczxTPik6IFByb21pc2U8RGVsZXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcblxuICAgIGNvbnN0IHtcbiAgICAgICAgaWQsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG5cbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHRlbmFudCxcblxuICAgICAgICBjcnVkVHlwZSA9ICdkZWxldGUnLFxuICAgICAgICBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0NSVUQtc2VydmljZTpkZWxldGVFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG5cbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIEVudGl0eUNydWQgfiBkZWxldGVFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9IH4gaWQ6YCwgaWQpO1xuXG4gICAgLy8gYXdhaXQgZXZlbnREaXNwYXRjaGVyLmRpc3BhdGNoKHtldmVudDogJ2JlZm9yZURlbGV0ZScsIGNvbnRleHQ6IGFyZ3VtZW50cyB9KTtcblxuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gZW50aXR5U2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpO1xuXG4gICAgLy8gYXV0aG9yaXplIHRoZSBhY3RvclxuICAgIC8vIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCBhdXRob3JpemVyLmF1dGhvcml6ZSh7ZW50aXR5TmFtZSwgY3J1ZFR5cGUsIGlkZW50aWZpZXJzLCBhY3RvciwgdGVuYW50fSk7XG4gICAgLy8gaWYoIWF1dGhvcml6YXRpb24ucGFzcyl7XG4gICAgLy8gICAgIHRocm93IG5ldyBFcnJvcihcIkF1dGhvcml6YXRpb24gZmFpbGVkIGZvciBkZWxldGU6IFwiICsgeyBjYXVzZTogYXV0aG9yaXphdGlvbiB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyB2YWxpZGF0ZVxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBjcnVkVHlwZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCksXG4gICAgICAgIGlucHV0OiBpZGVudGlmaWVycyxcbiAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgfSk7XG5cbiAgICBpZiAoIXZhbGlkYXRpb24ucGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3JzKTtcbiAgICB9XG5cbiAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdkZWxldGUnLCAoKSA9PlxuICAgICAgICBlbnRpdHlTZXJ2aWNlLmdldFJlcG9zaXRvcnkoKS5kZWxldGUoaWRlbnRpZmllcnMpLmdvKHsgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pXG4gICAgKTtcblxuICAgIC8vIGF3YWl0IGV2ZW50RGlzcGF0Y2hlci5kaXNwYXRjaCh7ZXZlbnQ6ICdhZnRlckRlbGV0ZScsIGNvbnRleHQ6IGFyZ3VtZW50c30pO1xuXG4gICAgbG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgRW50aXR5Q3J1ZCB+IGRlbGV0ZUVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZDpgLCBpZCk7XG5cbiAgICByZXR1cm4gZW50aXR5IGFzIERlbGV0ZUVudGl0eVJlc3BvbnNlPFM+O1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyBmb3IgYmF0Y2ggZGVsZXRpbmcgZW50aXRpZXMuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHNTY2hlbWEgLSBUaGUgaW5wdXQgc2NoZW1hcyBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlQmF0Y2hFbnRpdHlBcmdzPFxuICAgIFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBPcHNTY2hlbWEgZXh0ZW5kcyBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4gPSBURW50aXR5T3BzSW5wdXRTY2hlbWFzPFNjaD4sXG4+IGV4dGVuZHMgQmFzZUVudGl0eUNydWRBcmdzPFNjaD4ge1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGVudGl0eSBJRHMgdG8gZGVsZXRlLlxuICAgICAqL1xuICAgIGlkczogQXJyYXk8T3BzU2NoZW1hWyAnZGVsZXRlJyBdPjtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKi9cbiAgICBjb25jdXJyZW50PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIERlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyB0aGUgZW50aXRpZXMuXG4gKiBAcmV0dXJucyBUaGUgdW5wcm9jZXNzZWQgaXRlbXMgdGhhdCBjb3VsZG4ndCBiZSBkZWxldGVkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlQmF0Y2hFbnRpdHk8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczogRGVsZXRlQmF0Y2hFbnRpdHlBcmdzPFM+KSB7XG4gICAgY29uc3Qge1xuICAgICAgICBpZHMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgIGNvbmN1cnJlbnQgPSAxLFxuXG4gICAgICAgIGFjdG9yLFxuICAgICAgICB0ZW5hbnQsXG5cbiAgICAgICAgY3J1ZFR5cGUgPSAnZGVsZXRlJyxcbiAgICAgICAgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDUlVELXNlcnZpY2U6ZGVsZXRlQmF0Y2hFbnRpdHknKSxcbiAgICAgICAgdmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcixcbiAgICAgICAgYXV0aG9yaXplciA9IEF1dGhvcml6ZXIuRGVmYXVsdCxcbiAgICAgICAgZXZlbnREaXNwYXRjaGVyID0gRXZlbnREaXNwYXRjaGVyLkRlZmF1bHQsXG4gICAgfSA9IG9wdGlvbnM7XG5cbiAgICBsb2dnZXIuZGVidWcoYENhbGxlZCBFbnRpdHlDcnVkIH4gZGVsZXRlQmF0Y2hFbnRpdHkgfiBlbnRpdHlOYW1lOiAke2VudGl0eU5hbWV9OmAsIHsgaWRzLCBjb25jdXJyZW50IH0pO1xuXG4gICAgLy8gRXh0cmFjdCBpZGVudGlmaWVycyBmb3IgYWxsIGl0ZW1zIGluIHRoZSBiYXRjaFxuICAgIGNvbnN0IGlkZW50aWZpZXJzQmF0Y2ggPSBpZHMubWFwKGlkID0+IGVudGl0eVNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKSk7XG5cbiAgICAvLyBWYWxpZGF0ZSBlYWNoIGl0ZW0gaW4gdGhlIGJhdGNoXG4gICAgY29uc3QgdmFsaWRhdGlvbnMgPSBhd2FpdCBQcm9taXNlLmFsbChpZGVudGlmaWVyc0JhdGNoLm1hcChhc3luYyBpZGVudGlmaWVycyA9PlxuICAgICAgICB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogY3J1ZFR5cGUsXG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgZW50aXR5VmFsaWRhdGlvbnM6IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5VmFsaWRhdGlvbnMoKSxcbiAgICAgICAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpLFxuICAgICAgICAgICAgaW5wdXQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYWN0b3I6IGFjdG9yXG4gICAgICAgIH0pXG4gICAgKSk7XG5cbiAgICAvLyBDaGVjayBmb3IgdmFsaWRhdGlvbiBlcnJvcnNcbiAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbnNcbiAgICAgICAgLm1hcCgodmFsaWRhdGlvbiwgaW5kZXgpID0+ICh7IHZhbGlkYXRpb24sIGluZGV4IH0pKVxuICAgICAgICAuZmlsdGVyKCh7IHZhbGlkYXRpb24gfSkgPT4gIXZhbGlkYXRpb24ucGFzcyk7XG5cbiAgICBpZiAodmFsaWRhdGlvbkVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IodmFsaWRhdGlvbkVycm9ycy5mbGF0TWFwKCh7IHZhbGlkYXRpb24sIGluZGV4IH0pID0+XG4gICAgICAgICAgICAodmFsaWRhdGlvbi5lcnJvcnMgfHwgW10pLm1hcChlcnJvciA9PiAoe1xuICAgICAgICAgICAgICAgIC4uLmVycm9yLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGBJdGVtICR7aW5kZXh9OiAke2Vycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgfSkpXG4gICAgICAgICkpO1xuICAgIH1cblxuICAgIC8vIFBlcmZvcm0gYmF0Y2ggZGVsZXRlIG9wZXJhdGlvbiB3aXRoIGNvbmN1cnJlbmN5IGNvbnRyb2xcbiAgICAvLyBQZXIgRWxlY3Ryb0RCIGRvY3M6IGh0dHA6Ly9lbGVjdHJvZGIuZGV2L2VuL211dGF0aW9ucy9iYXRjaC1kZWxldGUvXG4gICAgLy8gTm90ZTogRWxlY3Ryb0RCIHR5cGVzIHVzZSAnY29uY3VycmVuY3knIHdoaWxlIGRvY3Mgc2hvdyAnY29uY3VycmVudCdcbiAgICBjb25zdCBidWxrT3B0aW9uczogUGFydGlhbDxCdWxrT3B0aW9ucz4gPSB7XG4gICAgICAgIGNvbmN1cnJlbmN5OiBjb25jdXJyZW50XG4gICAgfTtcblxuICAgIGNvbnN0IGVsZWN0cm9SZXN1bHQgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKGVudGl0eU5hbWUsICdiYXRjaERlbGV0ZScsICgpID0+XG4gICAgICAgIGVudGl0eVNlcnZpY2UuZ2V0UmVwb3NpdG9yeSgpLmRlbGV0ZShpZGVudGlmaWVyc0JhdGNoKS5nbyhidWxrT3B0aW9ucyksXG4gICAgICAgIHsgaXRlbUNvdW50OiBpZGVudGlmaWVyc0JhdGNoLmxlbmd0aCB9XG4gICAgKTtcblxuICAgIGxvZ2dlci5kZWJ1ZyhgQ29tcGxldGVkIEVudGl0eUNydWQgfiBkZWxldGVCYXRjaEVudGl0eSB+IGVudGl0eU5hbWU6ICR7ZW50aXR5TmFtZX0gfiBpZHM6YCwgaWRzKTtcblxuICAgIHJldHVybiBlbGVjdHJvUmVzdWx0O1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsdGVyIG9iamVjdCB3aXRoIGVxIG9wZXJhdG9ycyB0byBhIHNpbXBsaWZpZWQgZm9ybS5cbiAqIEV4YW1wbGU6IHsgYWdlOiB7IGVxOiA2NSB9IH0gYmVjb21lcyB7IGFnZTogNjUgfVxuICogQHBhcmFtIGZpbHRlcnMgLSBUaGUgZmlsdGVyIG9iamVjdCB0byBzaW1wbGlmeVxuICogQHJldHVybnMgQSBuZXcgZmlsdGVyIG9iamVjdCB3aXRoIGVxIG9wZXJhdG9ycyBjb252ZXJ0ZWQgdG8gZGlyZWN0IHZhbHVlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gc2ltcGxpZnlGaWx0ZXJzKGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBpZiAoIWZpbHRlcnMpIHJldHVybiB7fTtcblxuICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVycykpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgJ2VxJyBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlLmVxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzdWx0WyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIGV4cG9ydCBjbGFzcyBFbnRpdHlDcnVkU2VydmljZTxTIGV4dGVuZHMgU2NoZW1hPGFueSwgYW55LCBhbnk+PntcblxuLy8gICAgIHB1YmxpYyBhc3luYyBsaXN0KG9wdGlvbnM6IExpc3RFbnRpdHlBcmdzPFM+KSB7XG4vLyAgICAgICAgIHJldHVybiBhd2FpdCBsaXN0RW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBjcmVhdGUob3B0aW9uczogQ3JlYXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgY3JlYXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyB1cGRhdGUob3B0aW9uczogVXBkYXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgdXBkYXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBnZXQob3B0aW9uczogR2V0RW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgZ2V0RW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cblxuLy8gICAgIHB1YmxpYyBhc3luYyBkZWxldGUob3B0aW9uczogRGVsZXRlRW50aXR5QXJnczxTPikge1xuLy8gICAgICAgICByZXR1cm4gYXdhaXQgZGVsZXRlRW50aXR5KG9wdGlvbnMpO1xuLy8gICAgIH1cbi8vIH1cblxuXG4vLyBleHBvcnQgY29uc3QgRGVmYXVsdEVudGl0eUNydWRTZXJ2aWNlID0gbmV3IEVudGl0eUNydWRTZXJ2aWNlKCk7Il19