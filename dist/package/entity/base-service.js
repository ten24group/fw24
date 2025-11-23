"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseEntityService = void 0;
exports.hasAttribute = hasAttribute;
exports.isAttributeReadOnly = isAttributeReadOnly;
exports.hasAttributeBy = hasAttributeBy;
exports.getAttributeNameBy = getAttributeNameBy;
exports.entityAttributeToIOSchemaAttribute = entityAttributeToIOSchemaAttribute;
exports.makeEntityAccessPatternsSchema = makeEntityAccessPatternsSchema;
const di_1 = require("../di");
const logging_1 = require("../logging");
const services_1 = require("../search/services");
const search_utils_1 = require("../search/search-utils");
const utils_1 = require("../utils");
const base_entity_1 = require("./base-entity");
const crud_service_1 = require("./crud-service");
const entity_schema_validator_1 = require("./entity-schema-validator");
const errors_1 = require("./errors");
const query_1 = require("./query");
const errors_2 = require("../errors");
function hasAttribute(schema, attributeName) {
    return (attributeName in schema.attributes);
}
function isAttributeReadOnly(schema, attributeName) {
    const attribute = schema.attributes[attributeName];
    return !!(attribute && attribute.readOnly === true);
}
function hasAttributeBy(schema, spec) {
    return getAttributeNameBy(schema, spec) !== undefined;
}
function getAttributeNameBy(schema, spec) {
    let specAttMetaKey = `entity${(0, utils_1.pascalCase)(spec)}Attribute`;
    if (specAttMetaKey in schema.model) {
        return schema.model[specAttMetaKey];
    }
    if (hasAttribute(schema, `${schema.model.entity}${(0, utils_1.pascalCase)(spec)}`)) {
        return `${schema.model.entity}${(0, utils_1.pascalCase)(spec)}`;
    }
    if (hasAttribute(schema, spec)) {
        return spec;
    }
    return undefined;
}
class BaseEntityService {
    schema;
    entityConfigurations;
    diContainer;
    logger = (0, logging_1.createLogger)(`BaseEntityService:${this.constructor.name}`);
    entityRepository;
    entityOpsDefaultIoSchema;
    constructor(schema, entityConfigurations, diContainer = di_1.DIContainer.ROOT) {
        this.schema = schema;
        this.entityConfigurations = entityConfigurations;
        this.diContainer = diContainer;
    }
    getTableName() {
        if (!this.entityConfigurations.table) {
            throw new errors_2.InternalServerError(`Table name is required for entity: ${this.getEntityName()}`);
        }
        return this.entityConfigurations.table;
    }
    getEntitySearchConfig(_ctx) {
        const schema = this.getEntitySchema();
        const searchConfig = schema.model.search || {
            enabled: true,
            indexConfig: {}
        };
        searchConfig.serviceClass = searchConfig.serviceClass || services_1.EntitySearchService;
        if (!searchConfig.indexConfig) {
            searchConfig.indexConfig = {};
        }
        searchConfig.indexConfig.indexName = searchConfig.indexConfig.indexName || (0, search_utils_1.makeEntitySearchIndexName)({
            entityName: schema.model.entity,
            tableName: this.getTableName(),
        });
        searchConfig.indexConfig.primaryKey = searchConfig.indexConfig.primaryKey || this.getEntityPrimaryIdPropertyName();
        const entitySearchableAttributes = this.getSearchableAttributeNames();
        const entityFilterableAttributes = this.getFilterableAttributeNames();
        searchConfig.indexConfig.settings = {
            ...(searchConfig.indexConfig.settings || {}),
            searchableAttributes: [
                ...(searchConfig.indexConfig.settings?.searchableAttributes || entitySearchableAttributes),
            ],
            filterableAttributes: [
                ...(searchConfig.indexConfig.settings?.filterableAttributes || entityFilterableAttributes),
            ],
            sortableAttributes: [
                ...(searchConfig.indexConfig.settings?.sortableAttributes || entityFilterableAttributes),
            ],
        };
        return searchConfig;
    }
    /**
     * Checks if search is enabled for the entity.
     * @returns True if search is enabled, false otherwise.
     */
    isSearchEnabled() {
        const searchConfig = this.getEntitySearchConfig();
        return Boolean(searchConfig?.enabled);
    }
    /**
     * Gets the search service for the entity.
     * @returns The search service.
     */
    getSearchService() {
        try {
            const searchConfig = this.getEntitySearchConfig();
            // Skip search logic if search is not enabled
            if (!searchConfig?.enabled) {
                throw new Error(`Search is not enabled for entity ${this.getEntityName()}.`);
            }
            // Validate search configuration if present
            if (searchConfig) {
                this.validateSearchConfig(searchConfig);
            }
            const searchServiceTokenOrClass = searchConfig?.serviceClass;
            // Case 1: DI Container has the service
            if (searchServiceTokenOrClass && this.diContainer.has(searchServiceTokenOrClass)) {
                try {
                    return this.diContainer.resolve(searchServiceTokenOrClass);
                }
                catch (err) {
                    this.logger.error('Failed to resolve search service from container:', err);
                    throw new Error(`Failed to resolve search service for entity ${this.getEntityName()}: ${err.message}`);
                }
            }
            // Case 2: Service instance provided
            if (searchServiceTokenOrClass instanceof services_1.BaseSearchService) {
                return searchServiceTokenOrClass;
            }
            // Case 3: Service class provided
            if ((0, utils_1.isClassConstructor)(searchServiceTokenOrClass) &&
                (searchServiceTokenOrClass === services_1.EntitySearchService
                    ||
                        searchServiceTokenOrClass.prototype instanceof services_1.EntitySearchService)) {
                try {
                    // TODO: add support to configure this without needing to use the DI
                    const searchEngine = this.diContainer.resolveSearchEngine();
                    if (!searchEngine) {
                        throw new Error('Search engine not found in container');
                    }
                    return new searchServiceTokenOrClass(this, searchEngine);
                }
                catch (err) {
                    this.logger.error('Failed to instantiate search service:', err);
                    throw new Error(`Failed to create search service instance for entity ${this.getEntityName()}: ${err.message}`);
                }
            }
            throw new Error(`No valid search-service-configuration found for entity: ${this.getEntityName()}`);
        }
        catch (err) {
            this.logger.error('Error in getSearchService:', err);
            throw new Error(`Search service initialization failed for entity ${this.getEntityName()}: ${err.message}`);
        }
    }
    validateSearchConfig(searchConfig) {
        if (!searchConfig) {
            throw new Error('Search configuration is required');
        }
        if (!searchConfig.indexConfig) {
            throw new Error('Search configuration must include a config object');
        }
        const { indexConfig: config } = searchConfig;
        if (!config.indexName) {
            throw new Error('Search configuration must specify an indexName');
        }
        // Validate searchable attributes if specified
        if (config.settings?.searchableAttributes) {
            const invalidAttributes = config.settings.searchableAttributes.filter((attr) => !hasAttribute(this.getEntitySchema(), attr));
            if (invalidAttributes.length > 0) {
                throw new Error(`Invalid searchable attributes: ${invalidAttributes.join(', ')}`);
            }
        }
        // Validate filterable attributes if specified
        if (config.settings?.filterableAttributes) {
            const invalidAttributes = config.settings.filterableAttributes.filter((attr) => !hasAttribute(this.getEntitySchema(), attr));
            if (invalidAttributes.length > 0) {
                throw new Error(`Invalid filterable attributes: ${invalidAttributes.join(', ')}`);
            }
        }
    }
    async transformDocumentForIndexing(entity) {
        const searchService = this.getSearchService();
        const transformed = await searchService.transformDocumentForIndexing(entity);
        if (!transformed['id']) {
            // make sure there's an id attribute
            const primaryIdName = this.getEntityPrimaryIdPropertyName();
            transformed['id'] = entity[primaryIdName];
        }
        return transformed;
    }
    validateEntitySchema() {
        const validator = new entity_schema_validator_1.EntitySchemaValidator(this.diContainer);
        validator.validateSchema(this.getEntitySchema(), this.entityConfigurations);
    }
    getEntityServiceByEntityName(relatedEntityName) {
        return this.diContainer.resolveEntityService(relatedEntityName);
    }
    hasEntityServiceByEntityName(relatedEntityName) {
        return this.diContainer.hasEntityService(relatedEntityName);
    }
    getEntitySchemaByEntityName(relatedEntityName) {
        return this.diContainer.resolveEntitySchema(relatedEntityName);
    }
    hasEntitySchemaByEntityName(relatedEntityName) {
        return this.diContainer.hasEntitySchema(relatedEntityName);
    }
    /**
     * Extracts entity identifiers from the input object based on the provided context to fulfill an index.
     * e.g. entityId, tenantId, partition-keys.... etc
     * it is used by the `BaseEntityService` to find the right entity for `get`/`update`/`delete` operations
     *
     * @template S - The type of the entity schema.
     * @param input - The input object from which to extract the identifiers.
     * @param context - The context object containing additional information for extraction.
     * @param context.forAccessPattern - The access pattern for which to extract the identifiers.
     * @returns The extracted entity identifiers.
     * @throws {Error} If the input is missing or not an object.
     *
     * e.g.
     * IN   ==> `Request` object with headers, body, auth-context etc
     * OUT  ==> { tenantId: xxx, email: xxx@yyy.com, some-partition-key: xx-yy-zz }
     *
     */
    extractEntityIdentifiers(input, context = {
    // tenantId: 'xxx-yyy-zzz'
    }) {
        if (!input || typeof input !== 'object') {
            throw new Error('Input is required and must be an object containing entity-identifiers or an array of objects containing entity-identifiers');
        }
        const isBatchInput = (0, utils_1.isArray)(input);
        const inputs = isBatchInput ? input : [input];
        // TODO: tenant logic
        // identifiers['tenantId'] = input.tenantId || context.tenantId;
        const accessPatterns = makeEntityAccessPatternsSchema(this.getEntitySchema());
        const identifierAttributes = new Set();
        for (const [accessPatternName, accessPatternAttributes] of accessPatterns) {
            if (!context.forAccessPattern || accessPatternName == context.forAccessPattern) {
                for (const [, att] of accessPatternAttributes) {
                    identifierAttributes.add({
                        name: att.id,
                        required: att.required == true
                    });
                }
            }
        }
        const primaryAttName = this.getEntityPrimaryIdPropertyName();
        const identifiersBatch = inputs.map(input => {
            const identifiers = {};
            for (const { name: attName, required } of identifierAttributes) {
                if ((attName in input)) {
                    identifiers[attName] = input[attName];
                }
                else if (attName == primaryAttName && ('id' in input)) {
                    identifiers[attName] = input.id;
                }
                else if (required) {
                    this.logger.warn(`required attribute: ${attName} for access-pattern: ${context.forAccessPattern ?? '--primary--'} is not found in input:`, input);
                }
            }
            return identifiers;
        });
        this.logger.debug('Extracting identifiers from identifiers:', identifiersBatch);
        return isBatchInput ? identifiersBatch : identifiersBatch[0];
    }
    ;
    getEntityName() { return this.getEntitySchema().model.entity; }
    getEntitySchema() { return this.schema; }
    getRepository() {
        if (!this.entityRepository) {
            const { entity } = (0, base_entity_1.createElectroDBEntity)({
                schema: this.getEntitySchema(),
                entityConfigurations: this.entityConfigurations
            });
            this.entityRepository = entity;
        }
        return this.entityRepository;
    }
    /**
     * Placeholder for the entity validations; override this to provide your own validations
     * @returns An object containing the entity validations.
     */
    getEntityValidations() {
        return {};
    }
    ;
    /**
     * Placeholder for the custom validation-error-messages; override this to provide your own error-messages.
     * @returns A map containing the custom validation-error-messages.
     *
     * @example
     * ```ts
     *  public async getOverriddenEntityValidationErrorMessages() {
     *      return Promise.resolve( new Map<string, string>(
     *          Object.entries({
     *              'validation.email.required': 'Email is required!!!!!',
     *              'validation.password.required': 'Password is required!!!!!'
     *          })
     *      ));
     * }
     * ```
     */
    async getOverriddenEntityValidationErrorMessages() {
        return Promise.resolve(new Map());
    }
    getEntityPrimaryIdPropertyName() {
        const schema = this.getEntitySchema();
        for (const attName in schema.attributes) {
            const att = schema.attributes[attName];
            if (att.isIdentifier) {
                return attName;
            }
        }
        return undefined;
    }
    /**
 * Generates the default input and output schemas for various operations of an entity.
 *
 * @template S - The entity schema type.
 * @template Ops - The type of entity operations.
 *
 * @param schema - The entity schema.
 * @returns The default input and output schemas for the entity operations.
 */
    makeOpsDefaultIOSchema(schema) {
        const inputSchemaAttributes = {
            create: new Map(),
            update: new Map(),
        };
        const outputSchemaAttributes = {
            detail: new Map(),
            list: new Map(),
        };
        // create and update
        for (const attName in schema.attributes) {
            const att = schema.attributes[attName];
            const formattedAtt = entityAttributeToIOSchemaAttribute(attName, att);
            if (formattedAtt.hidden) {
                // if it's marked as hidden it's not visible to any op
                continue;
            }
            if (formattedAtt.isVisible || formattedAtt.isIdentifier) {
                outputSchemaAttributes.detail.set(attName, { ...formattedAtt });
            }
            if (formattedAtt.isListable || formattedAtt.isIdentifier) {
                outputSchemaAttributes.list.set(attName, { ...formattedAtt });
            }
            if (formattedAtt.isCreatable) {
                inputSchemaAttributes.create.set(attName, { ...formattedAtt });
            }
            if (formattedAtt.isEditable) {
                inputSchemaAttributes.update.set(attName, { ...formattedAtt });
            }
        }
        const accessPatterns = makeEntityAccessPatternsSchema(schema);
        // if there's an index named `primary`, use that, else fallback to first index
        // accessPatternAttributes['get'] = accessPatterns.get('primary') ?? accessPatterns.entries().next().value;
        // accessPatternAttributes['delete'] = accessPatterns.get('primary') ?? accessPatterns.entries().next().value;
        // for(const ap of accessPatterns.keys()){
        // 	accessPatternAttributes[`get_${ap}`] = accessPatterns.get(ap);
        // 	accessPatternAttributes[`delete_${ap}`] = accessPatterns.get(ap);
        // }
        // const inputSchemaAttributes: any = {};	
        // inputSchemaAttributes['create'] = {
        // 	'identifiers': accessPatternAttributes['get'],
        // 	'data': inputSchemaAttributes['create'],
        // }
        // inputSchemaAttributes['update'] = {
        // 	'identifiers': accessPatternAttributes['get'],
        // 	'data': inputSchemaAttributes['update'],
        // }
        const defaultAccessPattern = accessPatterns.get('primary');
        // TODO: add schema for the rest fo the secondary access-patterns
        return {
            get: {
                by: defaultAccessPattern,
                output: outputSchemaAttributes.detail, // default for the detail page
            },
            duplicate: {
                by: defaultAccessPattern,
                output: outputSchemaAttributes.detail, // default for the detail page
            },
            delete: {
                by: defaultAccessPattern
            },
            create: {
                input: inputSchemaAttributes.create,
                output: outputSchemaAttributes,
            },
            update: {
                by: defaultAccessPattern,
                input: inputSchemaAttributes.update,
                output: outputSchemaAttributes.detail,
            },
            list: {
                output: outputSchemaAttributes.list,
            },
        };
    }
    /**
     * Returns the default input/output schema for entity operations.
     *
    */
    getOpsDefaultIOSchema() {
        if (!this.entityOpsDefaultIoSchema) {
            this.entityOpsDefaultIoSchema = this.makeOpsDefaultIOSchema(this.getEntitySchema());
        }
        return this.entityOpsDefaultIoSchema;
    }
    /**
     * Returns an array of default serialization attribute names. Used by the `detail` API to serialize the entity.
     *
     * @returns {Array<string>} An array of default serialization attribute names.
     */
    getDefaultSerializationAttributeNames() {
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().get.output;
        const attributes = {};
        defaultOutputSchemaAttributesMap.forEach((_, key) => {
            // if (!val.relation || val.relation.hydrate) {
            // }
            attributes[key] = true;
        });
        return attributes;
        //  return Array.from( defaultOutputSchemaAttributesMap.keys() ) as EntitySelections<S>;
    }
    /**
     * Returns attribute names for listing and search API. Defaults to the default serialization attribute names.
     * @returns {Array<string>} An array of attribute names.
     */
    getListingAttributeNames() {
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().list.output;
        return Array.from(defaultOutputSchemaAttributesMap.keys());
    }
    /**
     * Returns the default attribute names to be used for keyword search.
     * Includes string fields and enum fields with string values.
     * Excludes identifiers, hidden fields, date/datetime fields, relations, and select fields by default.
     *
     * @returns {Array<string>} attribute names to be used for keyword search
    */
    getSearchableAttributeNames() {
        const attributeNames = [];
        const schema = this.getEntitySchema();
        for (const attName in schema.attributes) {
            const att = schema.attributes[attName];
            // Skip if hidden, identifier, or explicitly not searchable
            if (att.hidden || att.isIdentifier || att.isSearchable === false) {
                continue;
            }
            const attrType = att.type;
            const fieldType = att.fieldType;
            // Exclude date/datetime fields (they're for filtering, not text search)
            if (fieldType === 'date' || fieldType === 'datetime') {
                continue;
            }
            // Exclude date-like field names (createdAt, publishedDate, etc.)
            const lowerName = attName.toLowerCase();
            if (attrType === 'string' && (lowerName.includes('date') || lowerName.includes('time'))) {
                continue;
            }
            // Exclude relation fields (they're IDs, not searchable text)
            if ('relation' in att && att.relation) {
                continue;
            }
            // Exclude select/radio/checkbox fields with options (they're for filtering, not full-text search)
            if ((fieldType === 'select' || fieldType === 'radio' || fieldType === 'checkbox' || fieldType === 'multi-select') &&
                'options' in att && att.options) {
                continue;
            }
            // Include searchable text-based field types
            const isSearchableType = (
            // String fields (primary searchable type)
            (typeof attrType === 'string' && attrType === 'string') ||
                // Enum fields can be searched by their string values
                (Array.isArray(attrType) && attrType.length > 0 && attrType.every(v => typeof v === 'string')));
            // Include if searchable by default (isSearchable not explicitly set) or explicitly enabled
            if (isSearchableType && (!('isSearchable' in att) || att.isSearchable)) {
                attributeNames.push(attName);
            }
        }
        return attributeNames;
    }
    /**
     * Returns the unique attributes of the entity.
     * Defaults to all attributes which are marked as unique or are identifiers;
     * Or if they are part of a composite primary key where the composite length is 1.
     *
     * @returns {Array<EntityAttribute>} unique attributes of the entity
    */
    getUniqueAttributes() {
        const attributes = [];
        const schema = this.getEntitySchema();
        for (const attName in schema.attributes) {
            const att = schema.attributes[attName];
            let isUnique = ('isUnique' in att) ? att.isUnique : att.isIdentifier;
            if (isUnique) {
                attributes.push({
                    ...att,
                    isUnique,
                    name: attName,
                });
            }
        }
        return attributes;
    }
    /**
     * Returns the default attribute names that can be used for filtering the records.
     * Includes all filterable field types: string, number, boolean, enums, dates, and relations.
     *
     * This matches the comprehensive filtering support in the UI filter generation.
     *
     * @returns {Array<string>} attribute names to be used for filtering
    */
    getFilterableAttributeNames() {
        const attributeNames = [];
        const schema = this.getEntitySchema();
        for (const attName in schema.attributes) {
            const att = schema.attributes[attName];
            // Skip if explicitly marked as not filterable or hidden
            if (att.hidden || att.isFilterable === false) {
                continue;
            }
            const attrType = att.type;
            const fieldType = att.fieldType;
            let isFilterableType = false;
            // Check basic scalar types
            if (attrType === 'string' || attrType === 'number' || attrType === 'boolean') {
                isFilterableType = true;
            }
            // Check for enum types (array of values)
            if (!isFilterableType && Array.isArray(attrType)) {
                isFilterableType = true;
            }
            // Check for date/datetime fields
            if (!isFilterableType && (fieldType === 'date' || fieldType === 'datetime')) {
                isFilterableType = true;
            }
            // Check for date-like field names
            if (!isFilterableType && attrType === 'string') {
                const lowerName = attName.toLowerCase();
                if (lowerName.includes('date') || lowerName.includes('time')) {
                    isFilterableType = true;
                }
            }
            // Check for relation fields
            if (!isFilterableType && 'relation' in att && att.relation) {
                isFilterableType = true;
            }
            // Check for select/radio/checkbox fields with options
            if (!isFilterableType &&
                (fieldType === 'select' || fieldType === 'radio' || fieldType === 'checkbox' || fieldType === 'multi-select') &&
                'options' in att && att.options) {
                isFilterableType = true;
            }
            // Include if filterable by default (isFilterable not explicitly set) or explicitly enabled
            if (isFilterableType && (!('isFilterable' in att) || att.isFilterable)) {
                attributeNames.push(attName);
            }
        }
        return attributeNames;
    }
    serializeRecord(record, attributes = this.getDefaultSerializationAttributeNames()) {
        let keys;
        if (Array.isArray(attributes)) {
            const parsed = (0, query_1.parseEntityAttributePaths)(attributes);
            keys = Object.keys(parsed);
        }
        else {
            keys = Object.keys(attributes);
        }
        return (0, utils_1.pickKeys)(record, ...keys);
    }
    serializeRecords(record, attributes = this.getDefaultSerializationAttributeNames()) {
        if (!record || !Array.isArray(record)) {
            return [];
        }
        return record.map(record => this.serializeRecord(record, attributes));
    }
    async hydrateRecords(relations, rootEntityRecords) {
        this.logger.debug(`called 'hydrateRecords' for entity: ${this.getEntityName()}`);
        await Promise.all(relations?.map(async ([relatedAttributeName, options]) => {
            await this.hydrateSingleRelation(rootEntityRecords, relatedAttributeName, options);
        }));
    }
    async hydrateSingleRelation(rootEntityRecords, relatedAttributeName, options) {
        this.logger.debug(`called 'hydrateSingleRelation' relation: ${relatedAttributeName} for entity: ${this.getEntityName()}`, {
            options
        });
        const { entityName: relatedEntityName, relationType, identifiers } = options;
        if (!identifiers) {
            throw (`No Identifiers:[${relationType}:${relatedEntityName}] provided`);
        }
        if (relationType == 'one-to-one' || relationType == 'many-to-many') {
            throw (`RelationType:[${relationType}:${relatedEntityName}] in not supported by hydration, use one of [many-to-one, one-to-many] ot manually hydrate'`);
        }
        // Get related entity service
        const relatedEntityService = this.getEntityServiceByEntityName(relatedEntityName);
        if (!relatedEntityService) {
            throw new Error(`No service found for relationship: ${relatedAttributeName}(${relatedEntityName}); please make sure service has been registered in the required 'di-container'`);
        }
        // Get relation's metadata
        const currentEntitySchema = this.getEntitySchema();
        const relationAttributeMetadata = currentEntitySchema.attributes[relatedAttributeName];
        if (!relationAttributeMetadata || !relationAttributeMetadata?.relation) {
            const message = `No metadata found for relationship: ${relatedAttributeName}`;
            this.logger.warn(message, relationAttributeMetadata);
            throw (message);
        }
        // relation identifiers mapping
        const identifierMappings = Array.isArray(identifiers) ? identifiers : [identifiers];
        // Decide logic based on relationType
        if (relationType === 'many-to-one') {
            /**
             * MANY-TO-ONE:
             * -------------
             * The "rootEntityRecords" are the CHILD items, each storing the parent's
             * composite key in some fields. We gather all those parent keys, do a batch
             * retrieval from the parent entity, then attach the single matching parent
             * record into childRecord[relatedAttributeName].
            */
            await this.hydrateManyToOne(rootEntityRecords, relatedAttributeName, identifierMappings, options.attributes, relatedEntityService);
        }
        else if (relationType === 'one-to-many') {
            /**
             * ONE-TO-MANY:
             * -------------
             * The "rootEntityRecords" are the PARENT items. Each parent can have multiple
             * child items. The child table records each store the parent's key.
             * So we do a query per parent and then .
             */
            await this.hydrateOneToMany(rootEntityRecords, relatedAttributeName, identifierMappings, options.attributes, relatedEntityService);
        }
    }
    async hydrateManyToOne(childRecords, parentAttributeName, identifierMappings, parentAttributesToHydrate, parentService) {
        this.logger.debug(`called 'hydrateManyToOne' relation: ${parentAttributeName} for entity: ${this.getEntityName()}`, {
            parentAttributesToHydrate,
        });
        // for each parent create a children batch
        const parentIdentifiersToChildrenMap = new Map();
        for (const child of childRecords) {
            if (!child)
                continue;
            // Build a parent key object. E.g. { orgId: child.orgId, userId: child.userId } for 2-attr PK
            const parentKeyObj = {};
            for (const { source, target } of identifierMappings) {
                try {
                    const val = (0, utils_1.getValueByPath)(child, source);
                    if (val == null)
                        continue;
                    parentKeyObj[target] = val;
                }
                catch (error) {
                    this.logger.error(`Error getting value for path: ${source}`, { error });
                }
            }
            // If partial or empty, skip
            if (Object.keys(parentKeyObj).length === 0) {
                child[parentAttributeName] = null;
                continue;
            }
            const keyStr = JSON.stringify(parentKeyObj);
            if (!parentIdentifiersToChildrenMap.has(keyStr)) {
                parentIdentifiersToChildrenMap.set(keyStr, []);
            }
            parentIdentifiersToChildrenMap.get(keyStr).push(child);
        }
        if (parentIdentifiersToChildrenMap.size === 0)
            return;
        // Create a parent-identifiers-batch for fetching
        const parentIdentifiersBatch = [];
        for (const k of parentIdentifiersToChildrenMap.keys()) {
            parentIdentifiersBatch.push(JSON.parse(k));
        }
        const fetchedParents = await parentService.get({
            identifiers: parentIdentifiersBatch,
            attributes: parentAttributesToHydrate,
        });
        // If "get()" returns a single item convert it into an array.
        const parentsArray = Array.isArray(fetchedParents) ? fetchedParents : [fetchedParents];
        // Make a dictionary from { <keyStr> => parentRecord }
        const parentDict = new Map();
        for (const p of parentsArray) {
            if (!p) {
                continue;
            }
            // Rebuild the "composite key" from the parent's record
            const keyObj = {};
            for (const { target } of identifierMappings) {
                if (p[target] == null) {
                    // If some attribute is missing, skip
                    continue;
                }
                keyObj[target] = p[target];
            }
            const kStr = JSON.stringify(keyObj);
            parentDict.set(kStr, p);
        }
        // Attach each parent's data to the child
        for (const [kStr, children] of parentIdentifiersToChildrenMap.entries()) {
            const foundParent = parentDict.get(kStr) ?? null;
            for (const c of children) {
                c[parentAttributeName] = foundParent;
            }
        }
    }
    async hydrateOneToMany(parentRecords, childAttributeName, identifierMappings, childAttributesToHydrate, childService) {
        this.logger.debug(`called 'hydrateOneToMany' relation: ${childAttributeName} for entity: ${this.getEntityName()}`, {
            childAttributesToHydrate,
        });
        const parentKeyStrToParents = new Map();
        for (const parent of parentRecords) {
            if (!parent)
                continue;
            // Build a "child index" key from the parent's fields. For example, 
            // if the child GSI has { pk: 'tenantId', sk: 'accountId' }, 
            // we fill { tenantId: parent.tenantId, accountId: parent.accountId }.
            const childKeyObj = {};
            for (const { source, target } of identifierMappings) {
                if (parent[source] != null) {
                    childKeyObj[target] = parent[source];
                }
            }
            // If we have no valid composite key, no children can be fetched
            if (Object.keys(childKeyObj).length === 0) {
                parent[childAttributeName] = [];
                continue;
            }
            const keyStr = JSON.stringify(childKeyObj);
            if (!parentKeyStrToParents.has(keyStr)) {
                parentKeyStrToParents.set(keyStr, []);
            }
            parentKeyStrToParents.get(keyStr).push(parent);
        }
        // If no parent has a valid key, we're done
        if (parentKeyStrToParents.size === 0) {
            return;
        }
        // For each unique parentKeyObj, do a childService query/list in parallel.
        const promises = [];
        const parentKeys = [];
        for (const [keyStr] of parentKeyStrToParents.entries()) {
            const childKeyObj = JSON.parse(keyStr);
            parentKeys.push(keyStr);
            const filters = {};
            for (const [childField, val] of Object.entries(childKeyObj)) {
                filters[childField] = { eq: val };
            }
            promises.push(childService.list({
                filters,
                attributes: childAttributesToHydrate,
            }));
        }
        const results = await Promise.all(promises);
        // For each result, map children back to the correct-parent(s)
        const parentKeyStrToChildren = {};
        for (let i = 0; i < results.length; i++) {
            const { data: childItems } = results[i];
            const keyStr = parentKeys[i];
            parentKeyStrToChildren[keyStr] = childItems ?? [];
        }
        // Attach to parents
        for (const [keyStr, parents] of parentKeyStrToParents.entries()) {
            const childArray = parentKeyStrToChildren[keyStr] ?? [];
            for (const p of parents) {
                p[childAttributeName] = childArray;
            }
        }
    }
    /**
     * Retrieves an entity by its identifiers.
     *
     * @param identifiers - The identifiers of the entity.
     * @param selections - Optional array of attribute names to include in the response.
     * @returns A promise that resolves to the retrieved entity data.
     */
    async get(options, _ctx) {
        const { identifiers, attributes } = options;
        let formattedAttributes = attributes;
        if (!attributes) {
            formattedAttributes = this.getDefaultSerializationAttributeNames();
        }
        if (Array.isArray(formattedAttributes)) {
            const parsedOptions = (0, query_1.parseEntityAttributePaths)(formattedAttributes);
            formattedAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }
        this.logger.debug(`Formatted attributes for entity: ${this.getEntityName()}`, formattedAttributes);
        const requiredSelectAttributes = Object.entries(formattedAttributes).reduce((acc, [attName, options]) => {
            acc.push(attName);
            if ((0, utils_1.isObject)(options) && options.identifiers) {
                const identifiers = Array.isArray(options.identifiers) ? options.identifiers : [options.identifiers];
                const topKeys = identifiers.map(identifier => identifier.source?.split?.('.')?.[0]).filter(key => !!key);
                acc.push(...topKeys);
            }
            return acc;
        }, []);
        const uniqueSelectionAttributes = [...new Set(requiredSelectAttributes)];
        const entity = await (0, crud_service_1.getEntity)({
            id: identifiers,
            attributes: uniqueSelectionAttributes,
            entityName: this.getEntityName(),
            entityService: this,
        });
        this.logger.debug(`Retrieved entity: ${this.getEntityName()}`, utils_1.JsonSerializer.stringify(entity));
        if (!!formattedAttributes && entity?.data) {
            const relationalAttributes = Object.entries(formattedAttributes)?.map(([attributeName, options]) => [attributeName, options])
                .filter(([, options]) => (0, utils_1.isObject)(options));
            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes, [entity.data]);
            }
        }
        return entity?.data;
    }
    /**
     * Retrieves multiple entities by their identifiers in a batch operation.
     *
     * @param options - The options for batch retrieving entities.
     * @param options.identifiers - Array of entity identifiers to retrieve.
     * @param options.attributes - Optional array of attribute names to include in the response.
     * @param options.concurrent - Optional number of concurrent batch operations to perform (default: 1).
     * @returns A promise that resolves to an object containing the retrieved entities and any unprocessed items.
     */
    async batchGet(options) {
        const { identifiers, attributes, concurrent = 1 } = options;
        let formattedAttributes = attributes;
        if (!attributes) {
            formattedAttributes = this.getDefaultSerializationAttributeNames();
        }
        if (Array.isArray(formattedAttributes)) {
            const parsedOptions = (0, query_1.parseEntityAttributePaths)(formattedAttributes);
            formattedAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }
        this.logger.debug(`Formatted attributes for batch get on entity: ${this.getEntityName()}`, formattedAttributes);
        const requiredSelectAttributes = Object.entries(formattedAttributes).reduce((acc, [attName, options]) => {
            acc.push(attName);
            if ((0, utils_1.isObject)(options) && options.identifiers) {
                const identifiers = Array.isArray(options.identifiers) ? options.identifiers : [options.identifiers];
                const topKeys = identifiers.map(identifier => identifier.source?.split?.('.')?.[0]).filter(key => !!key);
                acc.push(...topKeys);
            }
            return acc;
        }, []);
        const uniqueSelectionAttributes = [...new Set(requiredSelectAttributes)];
        const entity = await (0, crud_service_1.getBatchEntity)({
            ids: identifiers,
            attributes: uniqueSelectionAttributes,
            entityName: this.getEntityName(),
            entityService: this,
            concurrent
        });
        this.logger.debug(`Retrieved batch entities: ${this.getEntityName()}`, utils_1.JsonSerializer.stringify(entity));
        if (!!formattedAttributes && entity?.data) {
            const relationalAttributes = Object.entries(formattedAttributes)?.map(([attributeName, options]) => [attributeName, options])
                .filter(([, options]) => (0, utils_1.isObject)(options));
            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes, entity.data);
            }
        }
        return {
            data: entity?.data || [],
            unprocessed: entity?.unprocessed || []
        };
    }
    /**
     * Checks the uniqueness of an attribute value and updates the payload if necessary.
     * @param options - The options for checking uniqueness and updating the payload.
     * @param options.payloadToUpdate - The payload object to update.
     * @param options.attributeName - The name of the attribute to check uniqueness for.
     * @param options.attributeValue - The value of the attribute to check uniqueness for.
     * @param options.maxAttemptsForCreatingUniqueAttributeValue - The maximum number of attempts to create a unique attribute value.
     * @returns A boolean indicating whether the attribute value is unique.
     */
    async checkUniquenessAndUpdate(options) {
        const { payloadToUpdate, attributeName, ignoredEntityIdentifiers, maxAttemptsForCreatingUniqueAttributeValue } = options;
        let { attributeValue } = options;
        let isUnique = false;
        let triesCount = 1;
        while (!isUnique && triesCount < maxAttemptsForCreatingUniqueAttributeValue) {
            isUnique = await this.isUniqueAttributeValue(attributeName, attributeValue, ignoredEntityIdentifiers);
            if (!isUnique) {
                attributeValue = this.generateUniqueValue(attributeValue, triesCount);
            }
            triesCount++;
        }
        if (isUnique) {
            payloadToUpdate[attributeName] = attributeValue;
        }
        return isUnique;
    }
    /**
     * Checks if the given attribute value is unique for the specified attribute name.
     * @param attributeName - The name of the attribute to check uniqueness for.
     * @param attributeValue - The value of the attribute to check uniqueness for.
     * @returns A boolean indicating whether the attribute value is unique or not.
     */
    async isUniqueAttributeValue(attributeName, attributeValue, ignoredEntityIdentifiers) {
        this.logger.debug(`Called ~ isUniqueAttributeValue ~ entityName: ${this.getEntityName()} ~ attributeName: ${attributeName} ~ attributeValue: ${attributeValue}`);
        // Create filters for the query using the correct structure
        const filters = {
            [attributeName]: { eq: attributeValue }
        };
        // Determine which attributes to project - only the attribute being checked and ignored entity identifiers
        const attributesToProject = [attributeName];
        // Add ignored entity identifier fields to the projection
        if (ignoredEntityIdentifiers && !(0, utils_1.isEmptyObjectDeep)(ignoredEntityIdentifiers)) {
            Object.keys(ignoredEntityIdentifiers).forEach(key => {
                if (!attributesToProject.includes(key)) {
                    attributesToProject.push(key);
                }
            });
        }
        // Use the query method to leverage index selection logic with minimal attribute projection
        const result = await this.query({
            filters,
            attributes: attributesToProject,
            pagination: { count: 1 } // We only need to know if any records exist
        });
        // If we have ignored entity identifiers, filter the results in memory
        let entities = result.data || [];
        if (ignoredEntityIdentifiers && !(0, utils_1.isEmptyObjectDeep)(ignoredEntityIdentifiers)) {
            entities = entities.filter(entity => {
                return !Object.entries(ignoredEntityIdentifiers).every(([key, value]) => entity[key] === value);
            });
        }
        this.logger.debug(`isUniqueAttributeValue ~ entityName: ${this.getEntityName()} ~ attributeName: ${attributeName} ~ attributeValue: ${attributeValue} ~ entity:`, { data: entities });
        return entities.length === 0;
    }
    /**
     * Generates a unique value by appending a unique suffix to the original value.
     * @param originalValue - The original value to generate a unique value from.
     * @param attempt - The attempt number or string to be used as a suffix (default: random string).
     * @returns The generated unique value.
     */
    generateUniqueValue(originalValue, attempt = Math.random().toString(36).substring(2, 15)) {
        const uniqueSuffix = `${Date.now()}-${attempt}`;
        return `${originalValue}-${uniqueSuffix}`;
    }
    /**
     * Automatically injects actor context into entity data
     * @param data - The entity data to enhance
     * @param operation - The operation type (create/update)
     * @param ctx - The execution context containing actor info
     * @returns Enhanced data with actor context
     */
    injectActorContext(data, operation, ctx) {
        if (!ctx?.actor) {
            this.logger.debug('BaseEntityService: No actor context found, skipping injection');
            return data;
        }
        const schema = this.getEntitySchema();
        const enhancedData = { ...data };
        const { actor } = ctx;
        // Get current timestamp for database operation
        const currentTimestamp = new Date().toISOString();
        // Inject visible actor fields if defined in schema and not read-only
        if (operation === 'create') {
            if (hasAttribute(schema, 'createdBy') && !isAttributeReadOnly(schema, 'createdBy') && actor.actorId) {
                enhancedData.createdBy = actor.actorId;
            }
            if (hasAttribute(schema, 'createdAt') && !isAttributeReadOnly(schema, 'createdAt')) {
                enhancedData.createdAt = currentTimestamp;
            }
        }
        // For delete operations, we still want to track who performed the deletion
        if (operation === 'delete') {
            if (hasAttribute(schema, 'deletedBy') && !isAttributeReadOnly(schema, 'deletedBy') && actor.actorId) {
                enhancedData.deletedBy = actor.actorId;
            }
            if (hasAttribute(schema, 'deletedAt') && !isAttributeReadOnly(schema, 'deletedAt')) {
                enhancedData.deletedAt = currentTimestamp;
            }
        }
        else {
            // Always update these fields on create/update (if not read-only)
            if (hasAttribute(schema, 'updatedBy') && !isAttributeReadOnly(schema, 'updatedBy') && actor.actorId) {
                enhancedData.updatedBy = actor.actorId;
            }
            if (hasAttribute(schema, 'updatedAt') && !isAttributeReadOnly(schema, 'updatedAt')) {
                enhancedData.updatedAt = currentTimestamp;
            }
            if (hasAttribute(schema, 'tenantId') && !isAttributeReadOnly(schema, 'tenantId') && actor.tenantId) {
                enhancedData.tenantId = actor.tenantId;
            }
        }
        // Always inject complete actor context for audit trail
        // This field is hidden from API responses by default
        // Clean actor object by removing undefined values (DynamoDB doesn't allow them)
        const cleanActor = Object.fromEntries(Object.entries(actor).filter(([_, value]) => value !== undefined));
        enhancedData._actor = cleanActor;
        return enhancedData;
    }
    /**
     * Creates a new entity.
     *
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    async create(payload, ctx) {
        let payloadCopy = { ...payload };
        // Inject actor context
        payloadCopy = this.injectActorContext(payloadCopy, 'create', ctx);
        const schema = this.getEntitySchema();
        const entitySlugAttribute = getAttributeNameBy(schema, 'slug') || '';
        const entityNameAttribute = getAttributeNameBy(schema, 'name') || '';
        if (entitySlugAttribute && !(entitySlugAttribute in payloadCopy)) {
            if (entityNameAttribute && (entityNameAttribute in payloadCopy)) {
                payloadCopy[entitySlugAttribute] = (0, utils_1.toSlug)(payloadCopy[entityNameAttribute]);
            }
        }
        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;
        if (!skipCheckingAttributesUniqueness && uniqueFields.length) {
            let uniquenessChecks = [];
            for (const { name } of uniqueFields) {
                if (name in payloadCopy) {
                    let value = payloadCopy[name];
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: payloadCopy,
                        attributeName: name,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                    }));
                }
            }
            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));
            if (checkResults.includes(false)) {
                const uniqueFieldsPath = uniqueFields.map(field => field.name) ?? [];
                throw new errors_1.EntityValidationError([{
                        message: "Unable to ensure uniqueness for one or more fields.",
                        path: uniqueFieldsPath,
                        expected: ['unique', uniqueFields],
                    }]);
            }
        }
        const entity = await (0, crud_service_1.createEntity)({
            data: payloadCopy,
            entityName: this.getEntityName(),
            entityService: this,
        });
        return entity;
    }
    /**
     * Creates-OR-Updates an entity.
     * NOTE:
     *   - This method does not check for uniqueness of the attributes, neither create the slug automatically.
     *   - It's the responsibility of the caller to ensure the read ony attributes are not provided if the record is being upsert.
     *
     * @param payload - The payload for creating-OR-updating the entity.
     * @returns Object containing:
     *   - data: The upserted entity data
     *   - wasCreated: true if record was created, false if updated
     *   - oldData: previous data if it was an update (undefined for creates)
     */
    async upsert(payload) {
        this.logger.debug(`Called ~ upsert ~ entityName: ${this.getEntityName()} ~ payload:`, payload);
        const result = await (0, crud_service_1.upsertEntity)({
            data: payload,
            entityName: this.getEntityName(),
            entityService: this,
        });
        return result;
    }
    /**
     * Creates a duplicate entity data based on the given identifiers.
     *
     * @param identifiers - The identifiers of the entity.
     * @returns The duplicate entity data.
     * @throws Error if no record is found for the given identifiers.
     *
     * @example
     * const identifiers = { id: 1 };
     * const duplicateData = await makeDuplicateEntityDataByIdentifiers(identifiers);
     * console.log(duplicateData); // { name: 'John Doe', age: 30, ... }
     */
    async makeDuplicateEntityData(identifiers) {
        const entity = await this.get({ identifiers });
        if (!entity) {
            throw new Error(`No ${this.getEntityName()} record found for identifiers: ${identifiers}`);
        }
        let duplicateEventData = {};
        const primaryIdPropName = this.getEntityPrimaryIdPropertyName();
        const schema = this.getEntitySchema();
        const entitySlugAttribute = (getAttributeNameBy(schema, 'slug') || '').toUpperCase();
        const entityNameAttribute = (getAttributeNameBy(schema, 'name') || '').toUpperCase();
        for (let [key, value] of Object.entries(entity)) {
            if (key !== primaryIdPropName) {
                // TODO: handle when entity has multiple identifiers
                if (key.toUpperCase() === entityNameAttribute) {
                    value = `${value} - Copy`;
                }
                else if (key.toUpperCase() === entitySlugAttribute) {
                    value = `${value}-copy`;
                }
                duplicateEventData[key] = value;
            }
        }
        return duplicateEventData;
    }
    /**
     * Creates a duplicate entity based on the provided identifiers.
     *
     * @param id - The identifiers of the entity to duplicate.
     * @returns A promise that resolves to the duplicated entity.
     *
     * @example
     * const entityId = { id: 123, name: 'example' };
     * const duplicatedEntity = await duplicate(entityId);
     */
    async duplicate(id, ctx) {
        const duplicateEventData = await this.makeDuplicateEntityData(id);
        return await this.create(duplicateEventData, ctx);
    }
    // TODO: should be part of some config
    delimitersRegex = /(?:&| |,|\+)+/;
    /**
     * Retrieves a list of entities based on the provided query.
     * - If no specific attributes are provided in the query, it defaults to a list of attribute names obtained from `getListingAttributeNames()`.
     * - If a search term is provided in the query it will split the search term by `/(?:&| |,|\+)+/` Regex and will filter out empty strings.
     * - If search attributes are not provided in the query, it defaults to a list of searchable attribute names obtained from `getSearchableAttributeNames()`.
     *
     * @param query - The query object containing filters, search keywords, and attributes.
     * @returns A Promise that resolves to an object containing the list of entities and the original query.
     */
    async list(query = {}, _ctx) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);
        if (!query.attributes) {
            query.attributes = this.getListingAttributeNames();
        }
        // for listing API attributes would be an array
        if (Array.isArray(query.attributes)) {
            const parsedOptions = (0, query_1.parseEntityAttributePaths)(query.attributes);
            query.attributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }
        if (query.search) {
            if ((0, utils_1.isString)(query.search)) {
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s => !!s);
            }
            if (query.search.length > 0) {
                if ((0, utils_1.isString)(query.searchAttributes)) {
                    query.searchAttributes = query.searchAttributes.split(',').filter(s => !!s);
                }
                if (!query.searchAttributes || (0, utils_1.isEmpty)(query.searchAttributes)) {
                    query.searchAttributes = this.getSearchableAttributeNames();
                }
                const searchFilterGroup = (0, query_1.makeFilterGroupForSearchKeywords)(query.search, query.searchAttributes);
                query.filters = (0, query_1.addFilterGroupToEntityFilterCriteria)(searchFilterGroup, query.filters);
            }
        }
        const entities = await (0, crud_service_1.listEntity)({
            query,
            entityName: this.getEntityName(),
            entityService: this,
        });
        entities.data = this.serializeRecords(entities.data, query.attributes);
        if (query.attributes && entities.data) {
            const relationalAttributes = Object.entries(query.attributes)?.map(([attributeName, options]) => {
                return [attributeName, options];
            })
                // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
                .filter(([, options]) => (0, utils_1.isObject)(options));
            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes, entities.data);
            }
        }
        return { ...entities, query };
    }
    /**
     * Executes a query on the entity.
     * - If no specific attributes are provided in the query, it defaults to a list of attribute names obtained from `getListingAttributeNames()`.
     * - If a search term is provided in the query it will split the search term by `/(?:&| |,|\+)+/` Regex and will filter out empty strings.
     *   -- If search attributes are not provided in the query, it defaults to a list of searchable attribute names obtained from `getSearchableAttributeNames()`.
     *   -- If there are any non-empty search-terms, it will add a filter group to the query based on the search keywords.
     * @param query - The entity query to execute.
     * @returns A promise that resolves to the result of the query.
     */
    async query(query, _ctx) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);
        const { attributes } = query;
        let selectAttributes = attributes || this.getListingAttributeNames();
        if (Array.isArray(selectAttributes)) {
            // parse the list of dot-separated attribute-identifiers paths and ensure all the required metadata is there
            const parsedOptions = (0, query_1.parseEntityAttributePaths)(selectAttributes);
            selectAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }
        else {
            // ensure all the provided select attributes has required metadata all the way down to the leaf level
            selectAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), selectAttributes);
        }
        if (query.search) {
            if ((0, utils_1.isString)(query.search)) {
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s => !!s);
            }
            if (query.search.length > 0) {
                query.searchAttributes = query.searchAttributes || this.getSearchableAttributeNames();
                const searchFilterGroup = (0, query_1.makeFilterGroupForSearchKeywords)(query.search, query.searchAttributes);
                query.filters = (0, query_1.addFilterGroupToEntityFilterCriteria)(searchFilterGroup, query.filters);
            }
        }
        const entities = await (0, crud_service_1.queryEntity)({
            query,
            entityName: this.getEntityName(),
            entityService: this,
        });
        entities.data = this.serializeRecords(entities.data, selectAttributes);
        if (selectAttributes && entities.data) {
            const relationalAttributes = Object.entries(selectAttributes)?.map(([attributeName, options]) => {
                return [attributeName, options];
            })
                // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
                .filter(([, options]) => (0, utils_1.isObject)(options));
            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes, entities.data);
            }
        }
        return { ...entities, query };
    }
    /**
     * Updates an entity in the database.
     *
     * @param identifiers - The identifiers of the entity to update.
     * @param data - The updated data for the entity.
     * @param remove - Optional array of attributes to remove from the entity.
     * @returns The updated entity.
     */
    async update(identifiers, data, operators, ctx) {
        // Inject actor context
        let enhancedData = this.injectActorContext(data, 'update', ctx);
        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;
        if (!skipCheckingAttributesUniqueness && uniqueFields.length) {
            let uniquenessChecks = [];
            for (const { name, readOnly } of uniqueFields) {
                if (readOnly) {
                    delete enhancedData[name];
                    continue;
                }
                if (name in enhancedData) {
                    let value = enhancedData[name];
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: enhancedData,
                        attributeName: name,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                        ignoredEntityIdentifiers: identifiers,
                    }));
                }
            }
            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));
            if (checkResults.includes(false)) {
                const uniqueFieldsPath = uniqueFields.map(field => field.name) ?? [];
                throw new errors_1.EntityValidationError([{
                        message: "Unable to ensure uniqueness for one or more fields.",
                        path: uniqueFieldsPath,
                        expected: ['unique', uniqueFields],
                    }]);
            }
        }
        const updatedEntity = await (0, crud_service_1.updateEntity)({
            id: identifiers,
            data: enhancedData,
            operators: operators,
            entityName: this.getEntityName(),
            entityService: this,
        });
        return updatedEntity;
    }
    /**
     * Deletes an entity based on the provided identifiers.
     *
     * @param identifiers - The identifiers of the entity to be deleted.
     * @returns A promise that resolves to the deleted entity.
     */
    async delete(identifiers, ctx) {
        try {
            this.logger.debug(`Called ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);
            const deletedEntity = await (0, crud_service_1.deleteEntity)({
                id: identifiers,
                entityName: this.getEntityName(),
                entityService: this,
                actor: ctx?.actor,
                tenant: ctx?.actor?.tenantId,
            });
            return deletedEntity;
        }
        catch (error) {
            throw new errors_1.DatabaseError(`Failed to delete ${this.getEntityName()}: ${error.message}`);
        }
    }
    /**
     * Deletes multiple entities in a batch operation.
     *
     * @param options - The options for batch deleting entities.
     * @param options.identifiers - Array of entity identifiers to delete.
     * @param options.concurrent - Optional number of concurrent batch operations to perform (default: 1).
     * @param ctx - Optional execution context containing actor information.
     * @returns A promise that resolves to an object containing any unprocessed items.
     *
     * @example
     * ```typescript
     * // Delete multiple entities
     * const result = await service.batchDelete({
     *   identifiers: [
     *     { id: 'item1' },
     *     { id: 'item2' },
     *     { id: 'item3' }
     *   ],
     *   concurrent: 2
     * });
     *
     * if (result.unprocessed.length > 0) {
     *   console.log('Some items were not deleted:', result.unprocessed);
     * }
     * ```
     */
    async batchDelete(options, ctx) {
        try {
            const { identifiers, concurrent = 1 } = options;
            this.logger.debug(`Called ~ batchDelete ~ entityName: ${this.getEntityName()} ~ count: ${identifiers.length}`, {
                concurrent
            });
            const result = await (0, crud_service_1.deleteBatchEntity)({
                ids: identifiers,
                entityName: this.getEntityName(),
                entityService: this,
                actor: ctx?.actor,
                tenant: ctx?.actor?.tenantId,
                concurrent
            });
            // ElectroDB batch delete returns { unprocessed: Array }
            const unprocessedCount = result?.unprocessed?.length || 0;
            const dataCount = result.data?.length;
            this.logger.debug(`Completed ~ batchDelete ~ entityName: ${this.getEntityName()} ~ processed: ${identifiers.length}, dataCount: ${dataCount}, unprocessed: ${unprocessedCount}`);
            return result;
        }
        catch (error) {
            throw new errors_1.DatabaseError(`Failed to batch delete ${this.getEntityName()}: ${error.message}`);
        }
    }
    /**
     * Deletes entities based on a query filter.
     * This method queries for entities matching the filter and then batch deletes them.
     *
     * @param options - The options for deleting by query.
     * @param options.filters - The filter criteria to match entities for deletion.
     * @param options.batchSize - The number of items to delete in each batch (default: 25).
     * @param options.concurrent - Number of concurrent batch operations (default: 1).
     * @param options.maxItems - Optional maximum number of items to delete (safety limit).
     * @param ctx - Optional execution context containing actor information.
     * @returns A promise that resolves to an object with deletion statistics.
     *
     * @example
     * ```typescript
     * // Delete all inactive users
     * const result = await userService.deleteByQuery({
     *   filters: {
     *     status: { eq: 'inactive' },
     *     lastLoginAt: { lt: '2023-01-01' }
     *   },
     *   batchSize: 50,
     *   maxItems: 1000
     * });
     *
     * console.log(`Deleted ${result.deletedCount} items, ${result.failedCount} failed`);
     * ```
     */
    async deleteByQuery(options, ctx) {
        try {
            const { filters, batchSize = 25, concurrent = 1, maxItems } = options;
            this.logger.info(`Called ~ deleteByQuery ~ entityName: ${this.getEntityName()}`, {
                filters,
                batchSize,
                maxItems
            });
            // Safety check: require filters to prevent accidental deletion of all records
            if (!filters || (0, utils_1.isEmptyObjectDeep)(filters)) {
                throw new Error('deleteByQuery requires filters to prevent accidental deletion of all records. Use scan with explicit confirmation if you need to delete all records.');
            }
            let deletedCount = 0;
            let failedCount = 0;
            let cursor = null;
            let totalProcessed = 0;
            // Query and delete in batches
            do {
                // Fetch a batch of items to delete
                const queryResult = await this.query({
                    filters,
                    pagination: {
                        count: batchSize,
                        cursor: cursor || undefined,
                        order: 'asc',
                        pager: 'cursor'
                    }
                }, ctx);
                const itemsToDelete = queryResult.data;
                if (!itemsToDelete || itemsToDelete.length === 0) {
                    break;
                }
                this.logger.debug(`Deleting batch of ${itemsToDelete.length} items`);
                // Extract identifiers from the fetched items
                const identifiers = itemsToDelete.map(item => this.extractEntityIdentifiers(item));
                // Batch delete the items
                const deleteResult = await this.batchDelete({
                    identifiers,
                    concurrent
                }, ctx);
                const unprocessedCount = deleteResult?.unprocessed?.length || 0;
                const dataCount = deleteResult.data?.length;
                const batchDeletedCount = identifiers.length - unprocessedCount;
                deletedCount += batchDeletedCount;
                failedCount += unprocessedCount;
                totalProcessed += itemsToDelete.length;
                this.logger.debug(`Batch result: ${batchDeletedCount} deleted, ${unprocessedCount} failed`);
                // Check if we've hit the max items limit
                if (maxItems && totalProcessed >= maxItems) {
                    this.logger.warn(`Reached maxItems limit of ${maxItems}, stopping deletion`);
                    break;
                }
                // Update cursor for next iteration
                cursor = queryResult.cursor || null;
            } while (cursor);
            this.logger.info(`Completed ~ deleteByQuery ~ entityName: ${this.getEntityName()} ~ deleted: ${deletedCount}, failed: ${failedCount}`);
            return {
                deletedCount,
                failedCount,
                totalProcessed
            };
        }
        catch (error) {
            this.logger.error(`Failed to delete by query for ${this.getEntityName()}:`, error);
            throw new errors_1.DatabaseError(`Failed to delete by query for ${this.getEntityName()}: ${error.message}`);
        }
    }
    /**
     * Rebuilds all indexes for the entity by writing to the primary index.
     * This method is useful for maintaining data integrity and ensuring indexes are properly updated.
     *
     * @param options - Options for rebuilding the index
     * @param options.batchSize - The number of items to process in each batch. Defaults to 100.
     * @returns A promise that resolves when the index rebuild is complete.
     */
    async rebuildIndex(options = {}) {
        try {
            const { batchSize = 100 } = options;
            const entityName = this.getEntityName();
            const repository = this.getRepository();
            this.logger.info(`Starting index rebuild for entity: ${entityName}`);
            // Get all records from the primary index
            const allRecords = await repository.scan.go();
            if (!allRecords.data || allRecords.data.length === 0) {
                this.logger.info(`No records found for entity: ${entityName}`);
                return;
            }
            this.logger.info(`Found ${allRecords.data.length} records to process for entity: ${entityName}`);
            // Process records in batches
            const totalRecords = allRecords.data.length;
            const totalBatches = Math.ceil(totalRecords / batchSize);
            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                const start = batchIndex * batchSize;
                const end = Math.min(start + batchSize, totalRecords);
                const batch = allRecords.data.slice(start, end);
                this.logger.info(`Processing batch ${batchIndex + 1}/${totalBatches} (${start + 1}-${end} of ${totalRecords} records)`);
                // Rebuild all indexes by upserting each record to the primary index
                for (const record of batch) {
                    try {
                        // Use upsert to ensure the record is properly indexed
                        await repository.upsert(record).go();
                    }
                    catch (error) {
                        this.logger.error(`Error processing record:`, error);
                    }
                }
            }
            this.logger.info(`Completed index rebuild for entity: ${entityName}`);
        }
        catch (error) {
            this.logger.error(`Failed to rebuild index for entity: ${this.getEntityName()}`, error);
            throw new errors_1.DatabaseError(`Failed to rebuild index for ${this.getEntityName()}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Infers relationships between entities based on the provided schema and selection-paths.
     * @param schema The entity schema.
     * @param paths The parsed selection paths from e.g. parseEntityAttributePaths().
     * @param pathKey The current "path" string representing how we arrived here (defaults to the entity name).
     * @param visitedPaths A set of path-strings visited so far in this recursion chain (prevents cycles).
     * @param maxDepth Maximum recursion depth (optional).
     */
    inferRelationshipsForEntitySelections(schema, paths, pathKey = schema.model.entity, visitedPaths = new Set(), maxDepth = 5) {
        this.logger.debug('inferRelationshipsForEntitySelections', { pathKey, paths });
        // If we exceed max depth, we skip expansions
        if (maxDepth <= 0) {
            this.logger.warn(`Max recursion depth reached at pathKey="${pathKey}"`);
            return {};
        }
        const inferred = {};
        // Loop over each attribute in the entity schema
        Object.entries(schema.attributes).forEach(([attributeName, attributeMeta]) => {
            const attVal = paths[attributeName];
            if (!attVal) {
                // Not selected in the user's attributes
                return;
            }
            const isRelational = !!attributeMeta.relation;
            // If the attribute is not relational or the value is a boolean, we can infer the attribute
            if (!isRelational || (0, utils_1.isBoolean)(attVal)) {
                inferred[attributeName] = attVal;
                return;
            }
            // It's a relational attribute; prepare to recurse
            const relationMeta = attributeMeta.relation;
            const nextEntityName = relationMeta.entityName;
            // Build a new "path" string to detect cycles (e.g. "User.groups.Group.members.User")
            const newPath = `${pathKey}.${attributeName}.${nextEntityName}`;
            // Check if we've already visited this path, if so => skip expansions for this attribute only
            if (visitedPaths.has(newPath)) {
                this.logger.warn(`Skipping cyc relation expansions for: ${newPath}`);
                inferred[attributeName] = {
                    entityName: nextEntityName,
                    skippedDueToCycle: true,
                };
                return;
            }
            // Mark this path as visited
            visitedPaths.add(newPath);
            // Recurse to the related entity's schema
            const relatedEntitySchema = this.getEntitySchemaByEntityName(nextEntityName);
            const relatedEntityService = this.getEntityServiceByEntityName(nextEntityName);
            // Build the "meta" object that we store
            const meta = {
                entityName: nextEntityName,
                relationType: relationMeta.type,
                identifiers: (0, utils_1.isFunction)(relationMeta.identifiers)
                    ? relationMeta.identifiers()
                    : relationMeta.identifiers,
                attributes: {},
            };
            const pathSelectionAttributes = (0, utils_1.isObject)(attVal) ? attVal.attributes : undefined; // provided by the user 
            const relationSelectionAttributes = relationMeta.attributes; // defined in the relation definition
            const relatedEntityDefaultSelectionAttributes = relatedEntityService.getDefaultSerializationAttributeNames(); // auto gen by framework
            // Recurse to expand child's relationships
            meta.attributes = this.inferRelationshipsForEntitySelections(relatedEntitySchema, (pathSelectionAttributes || relationSelectionAttributes || relatedEntityDefaultSelectionAttributes), nextEntityName, visitedPaths, maxDepth - 1);
            inferred[attributeName] = meta;
            // Remove this path so siblings can also expand it if needed
            visitedPaths.delete(newPath);
        });
        return inferred;
    }
    async search(query, ctx) {
        const searchService = this.getSearchService();
        if (!query.select) {
            // * Note: we expect an array of attribute names
            query.select = this.getListingAttributeNames();
        }
        return searchService.search(query, undefined, ctx);
    }
}
exports.BaseEntityService = BaseEntityService;
const entityAttributeLogger = (0, logging_1.createLogger)('entityAttributeToIOSchemaAttribute');
function entityAttributeToIOSchemaAttribute(attId, att) {
    const { name, validations, required, relation, default: defaultValue, get: _getter, set: _setter, watch, ...restMeta } = att;
    const { entityName: relatedEntityName, ...restRelation } = relation || {};
    const relationMeta = relatedEntityName ? { ...restRelation, entityName: relatedEntityName } : undefined;
    const { items, type, properties, addNewOption, addNewOptionConfig, fieldType: explicitFieldType, options, ...restRestMeta } = restMeta;
    // Infer fieldType from type if not explicitly provided
    let inferredFieldType = explicitFieldType;
    if (!inferredFieldType && type) {
        if (type === 'boolean') {
            inferredFieldType = 'boolean';
        }
        else if (type === 'number') {
            inferredFieldType = 'number';
        }
        else if (Array.isArray(type)) {
            // Enum type like ['active', 'inactive']
            inferredFieldType = 'select';
        }
        else if (type === 'string' && options && Array.isArray(options) && options.length > 0) {
            // String with options is a select
            inferredFieldType = 'select';
        }
        else if (type === 'any') {
            inferredFieldType = 'json';
        }
        else if (type === 'map') {
            inferredFieldType = 'map';
        }
        else if (type === 'list') {
            inferredFieldType = 'list';
        }
        // For date fields, check attribute name as hint
        else if (type === 'string') {
            const lowerAttId = attId.toLowerCase();
            if (lowerAttId.includes('date') || lowerAttId === 'createdat' || lowerAttId === 'updatedat' || lowerAttId === 'deletedat') {
                inferredFieldType = 'datetime';
            }
        }
        entityAttributeLogger.debug(`inferredFieldType: ${inferredFieldType} for entity attribute "${attId}" with type "${typeof type === 'object' ? JSON.stringify(type) : type}"`);
    }
    const formatted = {
        ...restRestMeta,
        type,
        id: attId,
        name: name || (0, utils_1.toHumanReadableName)(attId),
        relation: relationMeta,
        defaultValue,
        validations: validations || required ? ['required'] : [],
        isVisible: !('isVisible' in att) ? true : att.isVisible,
        isEditable: !('isEditable' in att) ? true : att.isEditable,
        isListable: !('isListable' in att) ? true : att.isListable,
        isCreatable: !('isCreatable' in att) ? true : att.isCreatable,
        isFilterable: !('isFilterable' in att) ? true : att.isFilterable,
        isSearchable: !('isSearchable' in att) ? true : att.isSearchable,
    };
    // Add inferred or explicit fieldType
    if (inferredFieldType) {
        formatted.fieldType = inferredFieldType;
    }
    else if (!explicitFieldType && type && type !== 'string') {
        // Log warning for non-string types we couldn't infer
        entityAttributeLogger.warn(`⚠️ Could not infer fieldType for attribute "${attId}" with type "${typeof type === 'object' ? JSON.stringify(type) : type}". Consider adding explicit fieldType.`);
    }
    // Add options back if they exist
    if (options) {
        formatted.options = options;
    }
    // Pass through both old and new addNewOption formats
    if (addNewOptionConfig) {
        formatted['addNewOptionConfig'] = addNewOptionConfig;
    }
    if (addNewOption) {
        formatted['addNewOption'] = addNewOption;
    }
    //
    // ** make sure to not override the inner fields of attributes like `list-[items]-[map]-properties` **
    //
    if (type === 'map') {
        formatted['properties'] = Object.entries(properties).map(([k, v]) => entityAttributeToIOSchemaAttribute(k, v));
    }
    else if (type === 'list' && items.type === 'map') {
        formatted['items'] = {
            ...items,
            properties: Object.entries(items.properties).map(([k, v]) => entityAttributeToIOSchemaAttribute(k, v))
        };
    }
    // TODO: add support for set, enum, and custom-types
    return formatted;
}
/**
 * Creates an access patterns schema based on the provided entity schema.
 * @param schema The entity schema.
 * @returns A map of access patterns, where the keys are the index names and the values are maps of attribute names and their corresponding schema attributes.
 */
function makeEntityAccessPatternsSchema(schema) {
    const accessPatterns = new Map();
    for (const indexName in schema.indexes) {
        const indexAttributes = new Map();
        for (const idxPkAtt of schema.indexes[indexName].pk.composite) {
            const att = schema.attributes[idxPkAtt];
            indexAttributes.set(idxPkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxPkAtt, { ...att, required: true })
            });
        }
        for (const idxSkAtt of schema.indexes[indexName].sk?.composite ?? []) {
            const att = schema.attributes[idxSkAtt];
            indexAttributes.set(idxSkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxSkAtt, { ...att, required: true })
            });
        }
        accessPatterns.set(indexName, indexAttributes);
    }
    // make sure there's a primary access pattern;
    if (!accessPatterns.has('primary')) {
        accessPatterns.set('primary', accessPatterns.values().next().value);
    }
    return accessPatterns;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBOEJBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQW00REQsZ0ZBaUdDO0FBVUQsd0VBNkJDO0FBcmtFRCw4QkFBb0M7QUFPcEMsd0NBQTBDO0FBQzFDLGlEQUE0RTtBQUU1RSx5REFBbUU7QUFDbkUsb0NBQWlOO0FBQ2pOLCtDQUFzRDtBQUN0RCxpREFBc0w7QUFDdEwsdUVBQWtFO0FBQ2xFLHFDQUFnRTtBQUNoRSxtQ0FBNEg7QUFDNUgsc0NBQTZEO0FBWTdELFNBQWdCLFlBQVksQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQ25GLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxTQUFnQixtQkFBbUIsQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQzFGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDbkQsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsS0FBSyxJQUFJLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFDMUYsT0FBTyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssU0FBUyxDQUFDO0FBQzFELENBQUM7QUFFRCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFtQyxFQUFFLElBQTBCO0lBRTlGLElBQUksY0FBYyxHQUFHLFNBQVMsSUFBQSxrQkFBVSxFQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7SUFDMUQsSUFBSSxjQUFjLElBQUksTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2pDLE9BQU8sTUFBTSxDQUFD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LENBQUMsRUFBRSxFQUFFLFNBQVMsSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUNyRSxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFFLFFBQVEsQ0FBRSxDQUFDO1lBQzFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFO2dCQUMxQixHQUFHLGtDQUFrQyxDQUFDLFFBQVEsRUFBRSxFQUFFLEdBQUcsR0FBRyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQzthQUM5RSxDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQsY0FBYyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLENBQUM7SUFDbkQsQ0FBQztJQUVELDhDQUE4QztJQUM5QyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ2pDLGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLGNBQWMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFNLENBQUMsQ0FBQztJQUN6RSxDQUFDO0lBRUQsT0FBTyxjQUFjLENBQUM7QUFDMUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gXCJlbGVjdHJvZGJcIjtcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2RpXCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUlucHV0VmFsaWRhdGlvbnMsIEVudGl0eVZhbGlkYXRpb25zIH0gZnJvbSBcIi4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB0eXBlIHsgQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlBdHRyaWJ1dGUsIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWEsIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hLCBFbnRpdHlUeXBlRnJvbVNjaGVtYSBhcyBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSwgSHlkcmF0ZU9wdGlvbkZvckVudGl0eSwgSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uLCBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eSwgUmVsYXRpb25JZGVudGlmaWVyLCBTcGVjaWFsQXR0cmlidXRlVHlwZSwgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBVcGRhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEsIFVwc2VydEVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUZpbHRlckNyaXRlcmlhLCBFbnRpdHlRdWVyeSwgRW50aXR5U2VsZWN0aW9ucywgUGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHMgfSBmcm9tIFwiLi9xdWVyeS10eXBlc1wiO1xuXG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBEZXBJZGVudGlmaWVyLCBJRElDb250YWluZXIgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IEJhc2VTZWFyY2hTZXJ2aWNlLCBFbnRpdHlTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi4vc2VhcmNoL3NlcnZpY2VzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5IH0gZnJvbSAnLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUgfSBmcm9tICcuLi9zZWFyY2gvc2VhcmNoLXV0aWxzJztcbmltcG9ydCB7IEpzb25TZXJpYWxpemVyLCBnZXRWYWx1ZUJ5UGF0aCwgaXNBcnJheSwgaXNCb29sZWFuLCBpc0NsYXNzQ29uc3RydWN0b3IsIGlzRW1wdHksIGlzRW1wdHlPYmplY3REZWVwLCBpc0Z1bmN0aW9uLCBpc09iamVjdCwgaXNTdHJpbmcsIHBhc2NhbENhc2UsIHBpY2tLZXlzLCB0b0h1bWFuUmVhZGFibGVOYW1lLCB0b1NsdWcgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgeyBVcGRhdGVFbnRpdHlPcGVyYXRvcnMsIGNyZWF0ZUVudGl0eSwgZGVsZXRlRW50aXR5LCBkZWxldGVCYXRjaEVudGl0eSwgZ2V0QmF0Y2hFbnRpdHksIGdldEVudGl0eSwgbGlzdEVudGl0eSwgcXVlcnlFbnRpdHksIHVwZGF0ZUVudGl0eSwgdXBzZXJ0RW50aXR5IH0gZnJvbSBcIi4vY3J1ZC1zZXJ2aWNlXCI7XG5pbXBvcnQgeyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IgfSBmcm9tIFwiLi9lbnRpdHktc2NoZW1hLXZhbGlkYXRvclwiO1xuaW1wb3J0IHsgRGF0YWJhc2VFcnJvciwgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhLCBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcywgcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgeyBJbnRlcm5hbFNlcnZlckVycm9yLCBTZXJ2ZXJFcnJvciB9IGZyb20gXCIuLi9lcnJvcnNcIjtcblxuZXhwb3J0IHR5cGUgRXh0cmFjdEVudGl0eUlkZW50aWZpZXJzQ29udGV4dCA9IHtcbiAgICAvLyB0ZW5hbnRJZDogc3RyaW5nLCBcbiAgICBmb3JBY2Nlc3NQYXR0ZXJuPzogc3RyaW5nXG59XG5cbnR5cGUgR2V0T3B0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgIGF0dHJpYnV0ZXM/OiBFbnRpdHlTZWxlY3Rpb25zPFM+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGUoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiAoYXR0cmlidXRlTmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhdHRyaWJ1dGUgPSBzY2hlbWEuYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXTtcbiAgICByZXR1cm4gISEoYXR0cmlidXRlICYmIGF0dHJpYnV0ZS5yZWFkT25seSA9PT0gdHJ1ZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcbiAgICByZXR1cm4gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgc3BlYykgIT09IHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcblxuICAgIGxldCBzcGVjQXR0TWV0YUtleSA9IGBlbnRpdHkke3Bhc2NhbENhc2Uoc3BlYyl9QXR0cmlidXRlYDtcbiAgICBpZiAoc3BlY0F0dE1ldGFLZXkgaW4gc2NoZW1hLm1vZGVsKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWEubW9kZWxbIHNwZWNBdHRNZXRhS2V5IGFzIGtleW9mIHR5cGVvZiBzY2hlbWEubW9kZWwgXSBhcyBzdHJpbmc7XG4gICAgfVxuXG4gICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsIGAke3NjaGVtYS5tb2RlbC5lbnRpdHl9JHtwYXNjYWxDYXNlKHNwZWMpfWApKSB7XG4gICAgICAgIHJldHVybiBgJHtzY2hlbWEubW9kZWwuZW50aXR5fSR7cGFzY2FsQ2FzZShzcGVjKX1gO1xuICAgIH1cblxuICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCBzcGVjKSkge1xuICAgICAgICByZXR1cm4gc3BlYztcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZUVudGl0eVNlcnZpY2U8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuXG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKGBCYXNlRW50aXR5U2VydmljZToke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKTtcblxuICAgIHByb3RlY3RlZCBlbnRpdHlSZXBvc2l0b3J5PzogRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgIHByb3RlY3RlZCBlbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE/OiBSZXR1cm5UeXBlPHR5cGVvZiB0aGlzLm1ha2VPcHNEZWZhdWx0SU9TY2hlbWE8Uz4+O1xuXG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHJlYWRvbmx5IHNjaGVtYTogUyxcbiAgICAgICAgcHJvdGVjdGVkIHJlYWRvbmx5IGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uLFxuICAgICAgICBwcm90ZWN0ZWQgcmVhZG9ubHkgZGlDb250YWluZXI6IElESUNvbnRhaW5lciA9IERJQ29udGFpbmVyLlJPT1QsXG4gICAgKSB7IH1cblxuICAgIHByb3RlY3RlZCBnZXRUYWJsZU5hbWUoKTogc3RyaW5nIHtcbiAgICAgICAgaWYgKCF0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcihgVGFibGUgbmFtZSBpcyByZXF1aXJlZCBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlO1xuICAgIH1cblxuXG4gICAgcHVibGljIGdldEVudGl0eVNlYXJjaENvbmZpZyhfY3R4PzogRXhlY3V0aW9uQ29udGV4dDxhbnk+KSB7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzY2hlbWEubW9kZWwuc2VhcmNoIHx8IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBpbmRleENvbmZpZzoge31cbiAgICAgICAgfTtcblxuICAgICAgICBzZWFyY2hDb25maWcuc2VydmljZUNsYXNzID0gc2VhcmNoQ29uZmlnLnNlcnZpY2VDbGFzcyB8fCBFbnRpdHlTZWFyY2hTZXJ2aWNlO1xuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5pbmRleE5hbWUgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuaW5kZXhOYW1lIHx8IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogdGhpcy5nZXRUYWJsZU5hbWUoKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnByaW1hcnlLZXkgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcucHJpbWFyeUtleSB8fCB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eVNlYXJjaGFibGVBdHRyaWJ1dGVzID0gdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcbiAgICAgICAgY29uc3QgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMgPSB0aGlzLmdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncyA9IHtcbiAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3MgfHwge30pLFxuICAgICAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5zZWFyY2hhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlTZWFyY2hhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgZmlsdGVyYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgc29ydGFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uc29ydGFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VhcmNoQ29uZmlnO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiBzZWFyY2ggaXMgZW5hYmxlZCBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUcnVlIGlmIHNlYXJjaCBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG4gICAgICovXG4gICAgcHVibGljIGlzU2VhcmNoRW5hYmxlZCgpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcbiAgICAgICAgcmV0dXJuIEJvb2xlYW4oc2VhcmNoQ29uZmlnPy5lbmFibGVkKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIHRoZSBzZWFyY2ggc2VydmljZSBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgc2VhcmNoIHNlcnZpY2UuXG4gICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaFNlcnZpY2UoKTogRW50aXR5U2VhcmNoU2VydmljZTxTPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldEVudGl0eVNlYXJjaENvbmZpZygpO1xuXG4gICAgICAgICAgICAvLyBTa2lwIHNlYXJjaCBsb2dpYyBpZiBzZWFyY2ggaXMgbm90IGVuYWJsZWRcbiAgICAgICAgICAgIGlmICghc2VhcmNoQ29uZmlnPy5lbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggaXMgbm90IGVuYWJsZWQgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfS5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgc2VhcmNoIGNvbmZpZ3VyYXRpb24gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVTZWFyY2hDb25maWcoc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9IHNlYXJjaENvbmZpZz8uc2VydmljZUNsYXNzO1xuXG4gICAgICAgICAgICAvLyBDYXNlIDE6IERJIENvbnRhaW5lciBoYXMgdGhlIHNlcnZpY2VcbiAgICAgICAgICAgIGlmIChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzICYmIHRoaXMuZGlDb250YWluZXIuaGFzKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT4+KSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmU8RW50aXR5U2VhcmNoU2VydmljZTxTPj4oc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyBEZXBJZGVudGlmaWVyPEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4+KTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHJlc29sdmUgc2VhcmNoIHNlcnZpY2UgZnJvbSBjb250YWluZXI6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVzb2x2ZSBzZWFyY2ggc2VydmljZSBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2FzZSAyOiBTZXJ2aWNlIGluc3RhbmNlIHByb3ZpZGVkXG4gICAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBpbnN0YW5jZW9mIEJhc2VTZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3M7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhc2UgMzogU2VydmljZSBjbGFzcyBwcm92aWRlZFxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGlzQ2xhc3NDb25zdHJ1Y3RvcihzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzKSAmJlxuICAgICAgICAgICAgICAgIChcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9PT0gRW50aXR5U2VhcmNoU2VydmljZVxuICAgICAgICAgICAgICAgICAgICB8fFxuICAgICAgICAgICAgICAgICAgICBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzLnByb3RvdHlwZSBpbnN0YW5jZW9mIEVudGl0eVNlYXJjaFNlcnZpY2VcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCB0byBjb25maWd1cmUgdGhpcyB3aXRob3V0IG5lZWRpbmcgdG8gdXNlIHRoZSBESVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hFbmdpbmUgPSB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVTZWFyY2hFbmdpbmUoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzZWFyY2hFbmdpbmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGVuZ2luZSBub3QgZm91bmQgaW4gY29udGFpbmVyJyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyB0eXBlb2YgRW50aXR5U2VhcmNoU2VydmljZSkoXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2VhcmNoRW5naW5lLFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFudGlhdGUgc2VhcmNoIHNlcnZpY2U6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIHNlYXJjaCBzZXJ2aWNlIGluc3RhbmNlIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHZhbGlkIHNlYXJjaC1zZXJ2aWNlLWNvbmZpZ3VyYXRpb24gZm91bmQgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciBpbiBnZXRTZWFyY2hTZXJ2aWNlOicsIGVycik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIGluaXRpYWxpemF0aW9uIGZhaWxlZCBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB2YWxpZGF0ZVNlYXJjaENvbmZpZyhzZWFyY2hDb25maWc6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PlsgJ21vZGVsJyBdWyAnc2VhcmNoJyBdKSB7XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIG11c3QgaW5jbHVkZSBhIGNvbmZpZyBvYmplY3QnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgaW5kZXhDb25maWc6IGNvbmZpZyB9ID0gc2VhcmNoQ29uZmlnO1xuXG4gICAgICAgIGlmICghY29uZmlnLmluZGV4TmFtZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBtdXN0IHNwZWNpZnkgYW4gaW5kZXhOYW1lJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBzZWFyY2hhYmxlIGF0dHJpYnV0ZXMgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb25maWcuc2V0dGluZ3M/LnNlYXJjaGFibGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IGNvbmZpZy5zZXR0aW5ncy5zZWFyY2hhYmxlQXR0cmlidXRlcy5maWx0ZXIoXG4gICAgICAgICAgICAgICAgKGF0dHI6IHN0cmluZykgPT4gIWhhc0F0dHJpYnV0ZSh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBhdHRyKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNlYXJjaGFibGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBjb25maWcuc2V0dGluZ3MuZmlsdGVyYWJsZUF0dHJpYnV0ZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIChhdHRyOiBzdHJpbmcpID0+ICFoYXNBdHRyaWJ1dGUodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgYXR0cilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmaWx0ZXJhYmxlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyB0cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eTogRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBjb25zdCB0cmFuc2Zvcm1lZCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UudHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHkpO1xuICAgICAgICBcbiAgICAgICAgaWYoIXRyYW5zZm9ybWVkWyAnaWQnIF0pIHtcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSB0aGVyZSdzIGFuIGlkIGF0dHJpYnV0ZVxuICAgICAgICAgICAgY29uc3QgcHJpbWFyeUlkTmFtZSA9IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG4gICAgICAgICAgICB0cmFuc2Zvcm1lZFsgJ2lkJyBdID0gZW50aXR5WyBwcmltYXJ5SWROYW1lIGFzIGFueSBdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVkO1xuICAgIH1cblxuICAgIHB1YmxpYyB2YWxpZGF0ZUVudGl0eVNjaGVtYSgpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IEVudGl0eVNjaGVtYVZhbGlkYXRvcih0aGlzLmRpQ29udGFpbmVyKTtcbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKFxuICAgICAgICAgICAgdGhpcy5nZXRFbnRpdHlTY2hlbWEoKSxcbiAgICAgICAgICAgIHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBnZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNlcnZpY2U8QmFzZUVudGl0eVNlcnZpY2U8VD4+KHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2VydmljZShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgZ2V0RW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNjaGVtYTxUPihyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2NoZW1hKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRyYWN0cyBlbnRpdHkgaWRlbnRpZmllcnMgZnJvbSB0aGUgaW5wdXQgb2JqZWN0IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBjb250ZXh0IHRvIGZ1bGZpbGwgYW4gaW5kZXguXG4gICAgICogZS5nLiBlbnRpdHlJZCwgdGVuYW50SWQsIHBhcnRpdGlvbi1rZXlzLi4uLiBldGNcbiAgICAgKiBpdCBpcyB1c2VkIGJ5IHRoZSBgQmFzZUVudGl0eVNlcnZpY2VgIHRvIGZpbmQgdGhlIHJpZ2h0IGVudGl0eSBmb3IgYGdldGAvYHVwZGF0ZWAvYGRlbGV0ZWAgb3BlcmF0aW9uc1xuICAgICAqIFxuICAgICAqIEB0ZW1wbGF0ZSBTIC0gVGhlIHR5cGUgb2YgdGhlIGVudGl0eSBzY2hlbWEuXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGlucHV0IG9iamVjdCBmcm9tIHdoaWNoIHRvIGV4dHJhY3QgdGhlIGlkZW50aWZpZXJzLlxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGNvbnRhaW5pbmcgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiBmb3IgZXh0cmFjdGlvbi5cbiAgICAgKiBAcGFyYW0gY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuIC0gVGhlIGFjY2VzcyBwYXR0ZXJuIGZvciB3aGljaCB0byBleHRyYWN0IHRoZSBpZGVudGlmaWVycy5cbiAgICAgKiBAcmV0dXJucyBUaGUgZXh0cmFjdGVkIGVudGl0eSBpZGVudGlmaWVycy5cbiAgICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGlucHV0IGlzIG1pc3Npbmcgb3Igbm90IGFuIG9iamVjdC5cbiAgICAgKiBcbiAgICAgKiBlLmcuIFxuICAgICAqIElOICAgPT0+IGBSZXF1ZXN0YCBvYmplY3Qgd2l0aCBoZWFkZXJzLCBib2R5LCBhdXRoLWNvbnRleHQgZXRjXG4gICAgICogT1VUICA9PT4geyB0ZW5hbnRJZDogeHh4LCBlbWFpbDogeHh4QHl5eS5jb20sIHNvbWUtcGFydGl0aW9uLWtleTogeHgteXktenogfVxuICAgICAqXG4gICAgICovXG4gICAgZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKFxuICAgICAgICBpbnB1dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIHN0cmluZz4+LFxuICAgICAgICBjb250ZXh0OiBFeHRyYWN0RW50aXR5SWRlbnRpZmllcnNDb250ZXh0ID0ge1xuICAgICAgICAgICAgLy8gdGVuYW50SWQ6ICd4eHgteXl5LXp6eidcbiAgICAgICAgfVxuICAgICk6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiB7XG5cbiAgICAgICAgaWYgKCFpbnB1dCB8fCB0eXBlb2YgaW5wdXQgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lucHV0IGlzIHJlcXVpcmVkIGFuZCBtdXN0IGJlIGFuIG9iamVjdCBjb250YWluaW5nIGVudGl0eS1pZGVudGlmaWVycyBvciBhbiBhcnJheSBvZiBvYmplY3RzIGNvbnRhaW5pbmcgZW50aXR5LWlkZW50aWZpZXJzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpc0JhdGNoSW5wdXQgPSBpc0FycmF5KGlucHV0KTtcblxuICAgICAgICBjb25zdCBpbnB1dHMgPSBpc0JhdGNoSW5wdXQgPyBpbnB1dCA6IFsgaW5wdXQgXTtcblxuICAgICAgICAvLyBUT0RPOiB0ZW5hbnQgbG9naWNcbiAgICAgICAgLy8gaWRlbnRpZmllcnNbJ3RlbmFudElkJ10gPSBpbnB1dC50ZW5hbnRJZCB8fCBjb250ZXh0LnRlbmFudElkO1xuXG4gICAgICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJBdHRyaWJ1dGVzID0gbmV3IFNldDx7IG5hbWU6IHN0cmluZywgcmVxdWlyZWQ6IGJvb2xlYW4gfT4oKTtcbiAgICAgICAgZm9yIChjb25zdCBbIGFjY2Vzc1BhdHRlcm5OYW1lLCBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcyBdIG9mIGFjY2Vzc1BhdHRlcm5zKSB7XG4gICAgICAgICAgICBpZiAoIWNvbnRleHQuZm9yQWNjZXNzUGF0dGVybiB8fCBhY2Nlc3NQYXR0ZXJuTmFtZSA9PSBjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4pIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBhdHQgXSBvZiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyQXR0cmlidXRlcy5hZGQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYXR0LmlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IGF0dC5yZXF1aXJlZCA9PSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByaW1hcnlBdHROYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgICAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaW5wdXRzLm1hcChpbnB1dCA9PiB7XG4gICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogYW55ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZTogYXR0TmFtZSwgcmVxdWlyZWQgfSBvZiBpZGVudGlmaWVyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmICgoYXR0TmFtZSBpbiBpbnB1dCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnNbIGF0dE5hbWUgXSA9IGlucHV0WyBhdHROYW1lIF07XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChhdHROYW1lID09IHByaW1hcnlBdHROYW1lICYmICgnaWQnIGluIGlucHV0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyc1sgYXR0TmFtZSBdID0gaW5wdXQuaWQ7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXF1aXJlZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGByZXF1aXJlZCBhdHRyaWJ1dGU6ICR7YXR0TmFtZX0gZm9yIGFjY2Vzcy1wYXR0ZXJuOiAke2NvbnRleHQuZm9yQWNjZXNzUGF0dGVybiA/PyAnLS1wcmltYXJ5LS0nfSBpcyBub3QgZm91bmQgaW4gaW5wdXQ6YCwgaW5wdXQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpZGVudGlmaWVycyBhcyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+O1xuICAgICAgICB9XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0V4dHJhY3RpbmcgaWRlbnRpZmllcnMgZnJvbSBpZGVudGlmaWVyczonLCBpZGVudGlmaWVyc0JhdGNoKTtcblxuICAgICAgICByZXR1cm4gaXNCYXRjaElucHV0ID8gaWRlbnRpZmllcnNCYXRjaCA6IGlkZW50aWZpZXJzQmF0Y2hbIDAgXTtcbiAgICB9O1xuXG4gICAgcHVibGljIGdldEVudGl0eU5hbWUoKTogU1sgJ21vZGVsJyBdWyAnZW50aXR5JyBdIHsgcmV0dXJuIHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkubW9kZWwuZW50aXR5OyB9XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5U2NoZW1hKCk6IFMgeyByZXR1cm4gdGhpcy5zY2hlbWE7IH1cblxuICAgIHB1YmxpYyBnZXRSZXBvc2l0b3J5KCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5UmVwb3NpdG9yeSkge1xuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHkgfSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgICAgICAgICAgICAgc2NoZW1hOiB0aGlzLmdldEVudGl0eVNjaGVtYSgpLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5UmVwb3NpdG9yeSA9IGVudGl0eSBhcyBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWE8Uz47XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlSZXBvc2l0b3J5ITtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGVudGl0eSB2YWxpZGF0aW9uczsgb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIHlvdXIgb3duIHZhbGlkYXRpb25zXG4gICAgICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGVudGl0eSB2YWxpZGF0aW9ucy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RW50aXR5VmFsaWRhdGlvbnMoKTogRW50aXR5VmFsaWRhdGlvbnM8Uz4gfCBFbnRpdHlJbnB1dFZhbGlkYXRpb25zPFM+IHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGN1c3RvbSB2YWxpZGF0aW9uLWVycm9yLW1lc3NhZ2VzOyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgeW91ciBvd24gZXJyb3ItbWVzc2FnZXMuXG4gICAgICogQHJldHVybnMgQSBtYXAgY29udGFpbmluZyB0aGUgY3VzdG9tIHZhbGlkYXRpb24tZXJyb3ItbWVzc2FnZXMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0c1xuICAgICAqICBwdWJsaWMgYXN5bmMgZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgICAqICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSggbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oIFxuICAgICAqICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHsgXG4gICAgICogICAgICAgICAgICAgICd2YWxpZGF0aW9uLmVtYWlsLnJlcXVpcmVkJzogJ0VtYWlsIGlzIHJlcXVpcmVkISEhISEnLCBcbiAgICAgKiAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24ucGFzc3dvcmQucmVxdWlyZWQnOiAnUGFzc3dvcmQgaXMgcmVxdWlyZWQhISEhISdcbiAgICAgKiAgICAgICAgICB9KVxuICAgICAqICAgICAgKSk7XG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBnZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpIHtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBpZiAoYXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhdHROYW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvKipcbiAqIEdlbmVyYXRlcyB0aGUgZGVmYXVsdCBpbnB1dCBhbmQgb3V0cHV0IHNjaGVtYXMgZm9yIHZhcmlvdXMgb3BlcmF0aW9ucyBvZiBhbiBlbnRpdHkuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHMgLSBUaGUgdHlwZSBvZiBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgVGhlIGRlZmF1bHQgaW5wdXQgYW5kIG91dHB1dCBzY2hlbWFzIGZvciB0aGUgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbiAgICBwcm90ZWN0ZWQgbWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxcbiAgICAgICAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBPcHM+LFxuICAgICAgICBPcHMgZXh0ZW5kcyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgPihzY2hlbWE6IFMpIHtcblxuICAgICAgICBjb25zdCBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICAgICBjcmVhdGU6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICAgICAgdXBkYXRlOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzID0ge1xuICAgICAgICAgICAgZGV0YWlsOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgICAgIGxpc3Q6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIGNyZWF0ZSBhbmQgdXBkYXRlXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuXG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkQXR0ID0gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShhdHROYW1lLCBhdHQpO1xuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmhpZGRlbikge1xuICAgICAgICAgICAgICAgIC8vIGlmIGl0J3MgbWFya2VkIGFzIGhpZGRlbiBpdCdzIG5vdCB2aXNpYmxlIHRvIGFueSBvcFxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzVmlzaWJsZSB8fCBmb3JtYXR0ZWRBdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzTGlzdGFibGUgfHwgZm9ybWF0dGVkQXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMubGlzdC5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNDcmVhdGFibGUpIHtcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc0VkaXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLnVwZGF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYShzY2hlbWEpO1xuXG4gICAgICAgIC8vIGlmIHRoZXJlJ3MgYW4gaW5kZXggbmFtZWQgYHByaW1hcnlgLCB1c2UgdGhhdCwgZWxzZSBmYWxsYmFjayB0byBmaXJzdCBpbmRleFxuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZGVsZXRlJ10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuXG5cbiAgICAgICAgLy8gZm9yKGNvbnN0IGFwIG9mIGFjY2Vzc1BhdHRlcm5zLmtleXMoKSl7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGdldF8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gXHRhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1tgZGVsZXRlXyR7YXB9YF0gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoYXApO1xuICAgICAgICAvLyB9XG5cbiAgICAgICAgLy8gY29uc3QgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzOiBhbnkgPSB7fTtcdFxuICAgICAgICAvLyBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddID0ge1xuICAgICAgICAvLyBcdCdpZGVudGlmaWVycyc6IGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzWydnZXQnXSxcbiAgICAgICAgLy8gXHQnZGF0YSc6IGlucHV0U2NoZW1hQXR0cmlidXRlc1snY3JlYXRlJ10sXG4gICAgICAgIC8vIH1cbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ3VwZGF0ZSddLFxuICAgICAgICAvLyB9XG5cbiAgICAgICAgY29uc3QgZGVmYXVsdEFjY2Vzc1BhdHRlcm4gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKTtcblxuICAgICAgICAvLyBUT0RPOiBhZGQgc2NoZW1hIGZvciB0aGUgcmVzdCBmbyB0aGUgc2Vjb25kYXJ5IGFjY2Vzcy1wYXR0ZXJuc1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBnZXQ6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCwgLy8gZGVmYXVsdCBmb3IgdGhlIGRldGFpbCBwYWdlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZHVwbGljYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlbGV0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVyblxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNyZWF0ZToge1xuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB1cGRhdGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgaW5wdXQ6IGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUsXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsaXN0OiB7XG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3QsXG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBpbnB1dC9vdXRwdXQgc2NoZW1hIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAgICAgKiBcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRPcHNEZWZhdWx0SU9TY2hlbWEoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWEpIHtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hID0gdGhpcy5tYWtlT3BzRGVmYXVsdElPU2NoZW1hPFM+KHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuIFVzZWQgYnkgdGhlIGBkZXRhaWxgIEFQSSB0byBzZXJpYWxpemUgdGhlIGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gQW4gYXJyYXkgb2YgZGVmYXVsdCBzZXJpYWxpemF0aW9uIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmdldC5vdXRwdXQ7XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlczogYW55ID0ge307XG4gICAgICAgIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmZvckVhY2goKF8sIGtleSkgPT4ge1xuICAgICAgICAgICAgLy8gaWYgKCF2YWwucmVsYXRpb24gfHwgdmFsLnJlbGF0aW9uLmh5ZHJhdGUpIHtcbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgIGF0dHJpYnV0ZXNbIGtleSBdID0gdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcyBhcyBFbnRpdHlTZWxlY3Rpb25zPFM+O1xuXG4gICAgICAgIC8vICByZXR1cm4gQXJyYXkuZnJvbSggZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAua2V5cygpICkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGF0dHJpYnV0ZSBuYW1lcyBmb3IgbGlzdGluZyBhbmQgc2VhcmNoIEFQSS4gRGVmYXVsdHMgdG8gdGhlIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCk6IEVudGl0eVNlbGVjdGlvbnM8Uz4ge1xuICAgICAgICBjb25zdCBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcCA9IHRoaXMuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkubGlzdC5vdXRwdXQ7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaC5cbiAgICAgKiBJbmNsdWRlcyBzdHJpbmcgZmllbGRzIGFuZCBlbnVtIGZpZWxkcyB3aXRoIHN0cmluZyB2YWx1ZXMuXG4gICAgICogRXhjbHVkZXMgaWRlbnRpZmllcnMsIGhpZGRlbiBmaWVsZHMsIGRhdGUvZGF0ZXRpbWUgZmllbGRzLCByZWxhdGlvbnMsIGFuZCBzZWxlY3QgZmllbGRzIGJ5IGRlZmF1bHQuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaFxuICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFNraXAgaWYgaGlkZGVuLCBpZGVudGlmaWVyLCBvciBleHBsaWNpdGx5IG5vdCBzZWFyY2hhYmxlXG4gICAgICAgICAgICBpZiAoYXR0LmhpZGRlbiB8fCBhdHQuaXNJZGVudGlmaWVyIHx8IGF0dC5pc1NlYXJjaGFibGUgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGF0dHJUeXBlID0gYXR0LnR5cGU7XG4gICAgICAgICAgICBjb25zdCBmaWVsZFR5cGUgPSBhdHQuZmllbGRUeXBlO1xuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIGRhdGUvZGF0ZXRpbWUgZmllbGRzICh0aGV5J3JlIGZvciBmaWx0ZXJpbmcsIG5vdCB0ZXh0IHNlYXJjaClcbiAgICAgICAgICAgIGlmIChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhjbHVkZSBkYXRlLWxpa2UgZmllbGQgbmFtZXMgKGNyZWF0ZWRBdCwgcHVibGlzaGVkRGF0ZSwgZXRjLilcbiAgICAgICAgICAgIGNvbnN0IGxvd2VyTmFtZSA9IGF0dE5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIGlmIChhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgKGxvd2VyTmFtZS5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygndGltZScpKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIHJlbGF0aW9uIGZpZWxkcyAodGhleSdyZSBJRHMsIG5vdCBzZWFyY2hhYmxlIHRleHQpXG4gICAgICAgICAgICBpZiAoJ3JlbGF0aW9uJyBpbiBhdHQgJiYgYXR0LnJlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4Y2x1ZGUgc2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkcyB3aXRoIG9wdGlvbnMgKHRoZXkncmUgZm9yIGZpbHRlcmluZywgbm90IGZ1bGwtdGV4dCBzZWFyY2gpXG4gICAgICAgICAgICBpZiAoKGZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSAmJiBcbiAgICAgICAgICAgICAgICAnb3B0aW9ucycgaW4gYXR0ICYmIGF0dC5vcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEluY2x1ZGUgc2VhcmNoYWJsZSB0ZXh0LWJhc2VkIGZpZWxkIHR5cGVzXG4gICAgICAgICAgICBjb25zdCBpc1NlYXJjaGFibGVUeXBlID0gKFxuICAgICAgICAgICAgICAgIC8vIFN0cmluZyBmaWVsZHMgKHByaW1hcnkgc2VhcmNoYWJsZSB0eXBlKVxuICAgICAgICAgICAgICAgICh0eXBlb2YgYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIGF0dHJUeXBlID09PSAnc3RyaW5nJykgfHxcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBFbnVtIGZpZWxkcyBjYW4gYmUgc2VhcmNoZWQgYnkgdGhlaXIgc3RyaW5nIHZhbHVlc1xuICAgICAgICAgICAgICAgIChBcnJheS5pc0FycmF5KGF0dHJUeXBlKSAmJiBhdHRyVHlwZS5sZW5ndGggPiAwICYmIGF0dHJUeXBlLmV2ZXJ5KHYgPT4gdHlwZW9mIHYgPT09ICdzdHJpbmcnKSlcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIEluY2x1ZGUgaWYgc2VhcmNoYWJsZSBieSBkZWZhdWx0IChpc1NlYXJjaGFibGUgbm90IGV4cGxpY2l0bHkgc2V0KSBvciBleHBsaWNpdGx5IGVuYWJsZWRcbiAgICAgICAgICAgIGlmIChpc1NlYXJjaGFibGVUeXBlICYmICghKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgfHwgYXR0LmlzU2VhcmNoYWJsZSkpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgdW5pcXVlIGF0dHJpYnV0ZXMgb2YgdGhlIGVudGl0eS4gXG4gICAgICogRGVmYXVsdHMgdG8gYWxsIGF0dHJpYnV0ZXMgd2hpY2ggYXJlIG1hcmtlZCBhcyB1bmlxdWUgb3IgYXJlIGlkZW50aWZpZXJzOyBcbiAgICAgKiBPciBpZiB0aGV5IGFyZSBwYXJ0IG9mIGEgY29tcG9zaXRlIHByaW1hcnkga2V5IHdoZXJlIHRoZSBjb21wb3NpdGUgbGVuZ3RoIGlzIDEuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PEVudGl0eUF0dHJpYnV0ZT59IHVuaXF1ZSBhdHRyaWJ1dGVzIG9mIHRoZSBlbnRpdHlcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRVbmlxdWVBdHRyaWJ1dGVzKCk6IEFycmF5PEVudGl0eUF0dHJpYnV0ZT4ge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVzID0gW107XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuXG4gICAgICAgICAgICBsZXQgaXNVbmlxdWUgPSAoJ2lzVW5pcXVlJyBpbiBhdHQpID8gYXR0LmlzVW5pcXVlIDogYXR0LmlzSWRlbnRpZmllcjtcblxuICAgICAgICAgICAgaWYgKGlzVW5pcXVlKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgLi4uYXR0LFxuICAgICAgICAgICAgICAgICAgICBpc1VuaXF1ZSxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYXR0TmFtZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGRlZmF1bHQgYXR0cmlidXRlIG5hbWVzIHRoYXQgY2FuIGJlIHVzZWQgZm9yIGZpbHRlcmluZyB0aGUgcmVjb3Jkcy5cbiAgICAgKiBJbmNsdWRlcyBhbGwgZmlsdGVyYWJsZSBmaWVsZCB0eXBlczogc3RyaW5nLCBudW1iZXIsIGJvb2xlYW4sIGVudW1zLCBkYXRlcywgYW5kIHJlbGF0aW9ucy5cbiAgICAgKiBcbiAgICAgKiBUaGlzIG1hdGNoZXMgdGhlIGNvbXByZWhlbnNpdmUgZmlsdGVyaW5nIHN1cHBvcnQgaW4gdGhlIFVJIGZpbHRlciBnZW5lcmF0aW9uLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3IgZmlsdGVyaW5nXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0RmlsdGVyYWJsZUF0dHJpYnV0ZU5hbWVzKCk6IEFycmF5PHN0cmluZz4ge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU2tpcCBpZiBleHBsaWNpdGx5IG1hcmtlZCBhcyBub3QgZmlsdGVyYWJsZSBvciBoaWRkZW5cbiAgICAgICAgICAgIGlmIChhdHQuaGlkZGVuIHx8IGF0dC5pc0ZpbHRlcmFibGUgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGF0dHJUeXBlID0gYXR0LnR5cGU7XG4gICAgICAgICAgICBjb25zdCBmaWVsZFR5cGUgPSBhdHQuZmllbGRUeXBlO1xuICAgICAgICAgICAgbGV0IGlzRmlsdGVyYWJsZVR5cGUgPSBmYWxzZTtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgYmFzaWMgc2NhbGFyIHR5cGVzXG4gICAgICAgICAgICBpZiAoYXR0clR5cGUgPT09ICdzdHJpbmcnIHx8IGF0dHJUeXBlID09PSAnbnVtYmVyJyB8fCBhdHRyVHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBlbnVtIHR5cGVzIChhcnJheSBvZiB2YWx1ZXMpXG4gICAgICAgICAgICBpZiAoIWlzRmlsdGVyYWJsZVR5cGUgJiYgQXJyYXkuaXNBcnJheShhdHRyVHlwZSkpIHtcbiAgICAgICAgICAgICAgICBpc0ZpbHRlcmFibGVUeXBlID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGRhdGUvZGF0ZXRpbWUgZmllbGRzXG4gICAgICAgICAgICBpZiAoIWlzRmlsdGVyYWJsZVR5cGUgJiYgKGZpZWxkVHlwZSA9PT0gJ2RhdGUnIHx8IGZpZWxkVHlwZSA9PT0gJ2RhdGV0aW1lJykpIHtcbiAgICAgICAgICAgICAgICBpc0ZpbHRlcmFibGVUeXBlID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGRhdGUtbGlrZSBmaWVsZCBuYW1lc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIGF0dHJUeXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxvd2VyTmFtZSA9IGF0dE5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgICAgICBpZiAobG93ZXJOYW1lLmluY2x1ZGVzKCdkYXRlJykgfHwgbG93ZXJOYW1lLmluY2x1ZGVzKCd0aW1lJykpIHtcbiAgICAgICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgcmVsYXRpb24gZmllbGRzXG4gICAgICAgICAgICBpZiAoIWlzRmlsdGVyYWJsZVR5cGUgJiYgJ3JlbGF0aW9uJyBpbiBhdHQgJiYgYXR0LnJlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBzZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGRzIHdpdGggb3B0aW9uc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIFxuICAgICAgICAgICAgICAgIChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0JykgJiZcbiAgICAgICAgICAgICAgICAnb3B0aW9ucycgaW4gYXR0ICYmIGF0dC5vcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEluY2x1ZGUgaWYgZmlsdGVyYWJsZSBieSBkZWZhdWx0IChpc0ZpbHRlcmFibGUgbm90IGV4cGxpY2l0bHkgc2V0KSBvciBleHBsaWNpdGx5IGVuYWJsZWRcbiAgICAgICAgICAgIGlmIChpc0ZpbHRlcmFibGVUeXBlICYmICghKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgfHwgYXR0LmlzRmlsdGVyYWJsZSkpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KHJlY29yZDogVCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogUGFydGlhbDxUPiB7XG5cbiAgICAgICAgbGV0IGtleXM6IEFycmF5PHN0cmluZz47XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoYXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMocGFyc2VkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwaWNrS2V5czxUPihyZWNvcmQsIC4uLmtleXMpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IEFycmF5PFQ+IHwgbnVsbCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogQXJyYXk8UGFydGlhbDxUPj4ge1xuICAgICAgICBpZiAoIXJlY29yZCB8fCAhQXJyYXkuaXNBcnJheShyZWNvcmQpKSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlY29yZC5tYXAocmVjb3JkID0+IHRoaXMuc2VyaWFsaXplUmVjb3JkPFQ+KHJlY29yZCwgYXR0cmlidXRlcykpO1xuICAgIH1cblxuICAgIGFzeW5jIGh5ZHJhdGVSZWNvcmRzKFxuICAgICAgICByZWxhdGlvbnM6IEFycmF5PFsgcmVsYXRlZEF0dHJpYnV0ZU5hbWU6IHN0cmluZywgb3B0aW9uczogSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uPGFueT4gXT4sXG4gICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzOiBBcnJheTx7IFsgeDogc3RyaW5nIF06IGFueTsgfT5cbiAgICApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZVJlY29yZHMnIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHJlbGF0aW9ucz8ubWFwKGFzeW5jIChbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVNpbmdsZVJlbGF0aW9uKHJvb3RFbnRpdHlSZWNvcmRzLCByZWxhdGVkQXR0cmlidXRlTmFtZSwgb3B0aW9ucyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVTaW5nbGVSZWxhdGlvbihyb290RW50aXR5UmVjb3JkczogYW55W10sIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxhbnk+KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVTaW5nbGVSZWxhdGlvbicgcmVsYXRpb246ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgb3B0aW9uc1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lLCByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGlmICghaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICAgIHRocm93IChgTm8gSWRlbnRpZmllcnM6WyR7cmVsYXRpb25UeXBlfToke3JlbGF0ZWRFbnRpdHlOYW1lfV0gcHJvdmlkZWRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUgPT0gJ29uZS10by1vbmUnIHx8IHJlbGF0aW9uVHlwZSA9PSAnbWFueS10by1tYW55Jykge1xuICAgICAgICAgICAgdGhyb3cgKGBSZWxhdGlvblR5cGU6WyR7cmVsYXRpb25UeXBlfToke3JlbGF0ZWRFbnRpdHlOYW1lfV0gaW4gbm90IHN1cHBvcnRlZCBieSBoeWRyYXRpb24sIHVzZSBvbmUgb2YgW21hbnktdG8tb25lLCBvbmUtdG8tbWFueV0gb3QgbWFudWFsbHkgaHlkcmF0ZSdgKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2VcbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgICAgICBpZiAoIXJlbGF0ZWRFbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHNlcnZpY2UgZm91bmQgZm9yIHJlbGF0aW9uc2hpcDogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX0oJHtyZWxhdGVkRW50aXR5TmFtZX0pOyBwbGVhc2UgbWFrZSBzdXJlIHNlcnZpY2UgaGFzIGJlZW4gcmVnaXN0ZXJlZCBpbiB0aGUgcmVxdWlyZWQgJ2RpLWNvbnRhaW5lcidgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCByZWxhdGlvbidzIG1ldGFkYXRhXG4gICAgICAgIGNvbnN0IGN1cnJlbnRFbnRpdHlTY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCByZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhID0gY3VycmVudEVudGl0eVNjaGVtYS5hdHRyaWJ1dGVzWyByZWxhdGVkQXR0cmlidXRlTmFtZSBhcyBhbnkgXSBhcyBFbnRpdHlBdHRyaWJ1dGU7XG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhIHx8ICFyZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhPy5yZWxhdGlvbikge1xuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGBObyBtZXRhZGF0YSBmb3VuZCBmb3IgcmVsYXRpb25zaGlwOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfWBcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSk7XG4gICAgICAgICAgICB0aHJvdyAobWVzc2FnZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyByZWxhdGlvbiBpZGVudGlmaWVycyBtYXBwaW5nXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSA9IEFycmF5LmlzQXJyYXkoaWRlbnRpZmllcnMpID8gaWRlbnRpZmllcnMgOiBbIGlkZW50aWZpZXJzISBdO1xuXG4gICAgICAgIC8vIERlY2lkZSBsb2dpYyBiYXNlZCBvbiByZWxhdGlvblR5cGVcbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZSA9PT0gJ21hbnktdG8tb25lJykge1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBNQU5ZLVRPLU9ORTpcbiAgICAgICAgICAgICAqIC0tLS0tLS0tLS0tLS1cbiAgICAgICAgICAgICAqIFRoZSBcInJvb3RFbnRpdHlSZWNvcmRzXCIgYXJlIHRoZSBDSElMRCBpdGVtcywgZWFjaCBzdG9yaW5nIHRoZSBwYXJlbnQnc1xuICAgICAgICAgICAgICogY29tcG9zaXRlIGtleSBpbiBzb21lIGZpZWxkcy4gV2UgZ2F0aGVyIGFsbCB0aG9zZSBwYXJlbnQga2V5cywgZG8gYSBiYXRjaFxuICAgICAgICAgICAgICogcmV0cmlldmFsIGZyb20gdGhlIHBhcmVudCBlbnRpdHksIHRoZW4gYXR0YWNoIHRoZSBzaW5nbGUgbWF0Y2hpbmcgcGFyZW50XG4gICAgICAgICAgICAgKiByZWNvcmQgaW50byBjaGlsZFJlY29yZFtyZWxhdGVkQXR0cmlidXRlTmFtZV0uXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlTWFueVRvT25lKFxuICAgICAgICAgICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25UeXBlID09PSAnb25lLXRvLW1hbnknKSB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIE9ORS1UTy1NQU5ZOlxuICAgICAgICAgICAgICogLS0tLS0tLS0tLS0tLVxuICAgICAgICAgICAgICogVGhlIFwicm9vdEVudGl0eVJlY29yZHNcIiBhcmUgdGhlIFBBUkVOVCBpdGVtcy4gRWFjaCBwYXJlbnQgY2FuIGhhdmUgbXVsdGlwbGVcbiAgICAgICAgICAgICAqIGNoaWxkIGl0ZW1zLiBUaGUgY2hpbGQgdGFibGUgcmVjb3JkcyBlYWNoIHN0b3JlIHRoZSBwYXJlbnQncyBrZXkuIFxuICAgICAgICAgICAgICogU28gd2UgZG8gYSBxdWVyeSBwZXIgcGFyZW50IGFuZCB0aGVuIC5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlT25lVG9NYW55KFxuICAgICAgICAgICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVNYW55VG9PbmUoXG4gICAgICAgIGNoaWxkUmVjb3JkczogYW55W10sXG4gICAgICAgIHBhcmVudEF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdLFxuICAgICAgICBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlOiBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PGFueT4gfCB1bmRlZmluZWQsXG4gICAgICAgIHBhcmVudFNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbiAgICApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZU1hbnlUb09uZScgcmVsYXRpb246ICR7cGFyZW50QXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBmb3IgZWFjaCBwYXJlbnQgY3JlYXRlIGEgY2hpbGRyZW4gYmF0Y2hcbiAgICAgICAgY29uc3QgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgY2hpbGRSZWNvcmRzKSB7XG4gICAgICAgICAgICBpZiAoIWNoaWxkKSBjb250aW51ZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBwYXJlbnQga2V5IG9iamVjdC4gRS5nLiB7IG9yZ0lkOiBjaGlsZC5vcmdJZCwgdXNlcklkOiBjaGlsZC51c2VySWQgfSBmb3IgMi1hdHRyIFBLXG4gICAgICAgICAgICBjb25zdCBwYXJlbnRLZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBzb3VyY2UsIHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsID0gZ2V0VmFsdWVCeVBhdGgoY2hpbGQsIHNvdXJjZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWwgPT0gbnVsbCkgY29udGludWU7XG5cbiAgICAgICAgICAgICAgICAgICAgcGFyZW50S2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSB2YWw7XG5cbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgZ2V0dGluZyB2YWx1ZSBmb3IgcGF0aDogJHtzb3VyY2V9YCwgeyBlcnJvciB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIHBhcnRpYWwgb3IgZW1wdHksIHNraXBcbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhwYXJlbnRLZXlPYmopLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGNoaWxkWyBwYXJlbnRBdHRyaWJ1dGVOYW1lIF0gPSBudWxsO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBKU09OLnN0cmluZ2lmeShwYXJlbnRLZXlPYmopO1xuICAgICAgICAgICAgaWYgKCFwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuaGFzKGtleVN0cikpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuc2V0KGtleVN0ciwgW10pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmdldChrZXlTdHIpIS5wdXNoKGNoaWxkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuc2l6ZSA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHBhcmVudC1pZGVudGlmaWVycy1iYXRjaCBmb3IgZmV0Y2hpbmdcbiAgICAgICAgY29uc3QgcGFyZW50SWRlbnRpZmllcnNCYXRjaDogQXJyYXk8UmVjb3JkPHN0cmluZywgYW55Pj4gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBrIG9mIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5rZXlzKCkpIHtcbiAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzQmF0Y2gucHVzaChKU09OLnBhcnNlKGspKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZldGNoZWRQYXJlbnRzID0gYXdhaXQgcGFyZW50U2VydmljZS5nZXQoe1xuICAgICAgICAgICAgaWRlbnRpZmllcnM6IHBhcmVudElkZW50aWZpZXJzQmF0Y2gsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJZiBcImdldCgpXCIgcmV0dXJucyBhIHNpbmdsZSBpdGVtIGNvbnZlcnQgaXQgaW50byBhbiBhcnJheS5cbiAgICAgICAgY29uc3QgcGFyZW50c0FycmF5ID0gQXJyYXkuaXNBcnJheShmZXRjaGVkUGFyZW50cykgPyBmZXRjaGVkUGFyZW50cyA6IFsgZmV0Y2hlZFBhcmVudHMgXTtcblxuICAgICAgICAvLyBNYWtlIGEgZGljdGlvbmFyeSBmcm9tIHsgPGtleVN0cj4gPT4gcGFyZW50UmVjb3JkIH1cbiAgICAgICAgY29uc3QgcGFyZW50RGljdCA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiBwYXJlbnRzQXJyYXkpIHtcbiAgICAgICAgICAgIGlmICghcCkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gUmVidWlsZCB0aGUgXCJjb21wb3NpdGUga2V5XCIgZnJvbSB0aGUgcGFyZW50J3MgcmVjb3JkXG4gICAgICAgICAgICBjb25zdCBrZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAocFsgdGFyZ2V0IF0gPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBJZiBzb21lIGF0dHJpYnV0ZSBpcyBtaXNzaW5nLCBza2lwXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBrZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHBbIHRhcmdldCBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3Qga1N0ciA9IEpTT04uc3RyaW5naWZ5KGtleU9iaik7XG4gICAgICAgICAgICBwYXJlbnREaWN0LnNldChrU3RyLCBwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEF0dGFjaCBlYWNoIHBhcmVudCdzIGRhdGEgdG8gdGhlIGNoaWxkXG4gICAgICAgIGZvciAoY29uc3QgWyBrU3RyLCBjaGlsZHJlbiBdIG9mIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGZvdW5kUGFyZW50ID0gcGFyZW50RGljdC5nZXQoa1N0cikgPz8gbnVsbDtcbiAgICAgICAgICAgIGZvciAoY29uc3QgYyBvZiBjaGlsZHJlbikge1xuICAgICAgICAgICAgICAgIGNbIHBhcmVudEF0dHJpYnV0ZU5hbWUgXSA9IGZvdW5kUGFyZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlT25lVG9NYW55KFxuICAgICAgICBwYXJlbnRSZWNvcmRzOiBhbnlbXSxcbiAgICAgICAgY2hpbGRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSxcbiAgICAgICAgY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlOiBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PGFueT4gfCB1bmRlZmluZWQsXG4gICAgICAgIGNoaWxkU2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuICAgICkge1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVPbmVUb01hbnknIHJlbGF0aW9uOiAke2NoaWxkQXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHBhcmVudEtleVN0clRvUGFyZW50cyA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhcmVudCBvZiBwYXJlbnRSZWNvcmRzKSB7XG4gICAgICAgICAgICBpZiAoIXBhcmVudCkgY29udGludWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgXCJjaGlsZCBpbmRleFwiIGtleSBmcm9tIHRoZSBwYXJlbnQncyBmaWVsZHMuIEZvciBleGFtcGxlLCBcbiAgICAgICAgICAgIC8vIGlmIHRoZSBjaGlsZCBHU0kgaGFzIHsgcGs6ICd0ZW5hbnRJZCcsIHNrOiAnYWNjb3VudElkJyB9LCBcbiAgICAgICAgICAgIC8vIHdlIGZpbGwgeyB0ZW5hbnRJZDogcGFyZW50LnRlbmFudElkLCBhY2NvdW50SWQ6IHBhcmVudC5hY2NvdW50SWQgfS5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkS2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgc291cmNlLCB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAocGFyZW50WyBzb3VyY2UgXSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkS2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSBwYXJlbnRbIHNvdXJjZSBdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSWYgd2UgaGF2ZSBubyB2YWxpZCBjb21wb3NpdGUga2V5LCBubyBjaGlsZHJlbiBjYW4gYmUgZmV0Y2hlZFxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKGNoaWxkS2V5T2JqKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRbIGNoaWxkQXR0cmlidXRlTmFtZSBdID0gW107XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IEpTT04uc3RyaW5naWZ5KGNoaWxkS2V5T2JqKTtcbiAgICAgICAgICAgIGlmICghcGFyZW50S2V5U3RyVG9QYXJlbnRzLmhhcyhrZXlTdHIpKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9QYXJlbnRzLnNldChrZXlTdHIsIFtdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhcmVudEtleVN0clRvUGFyZW50cy5nZXQoa2V5U3RyKSEucHVzaChwYXJlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgbm8gcGFyZW50IGhhcyBhIHZhbGlkIGtleSwgd2UncmUgZG9uZVxuICAgICAgICBpZiAocGFyZW50S2V5U3RyVG9QYXJlbnRzLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZvciBlYWNoIHVuaXF1ZSBwYXJlbnRLZXlPYmosIGRvIGEgY2hpbGRTZXJ2aWNlIHF1ZXJ5L2xpc3QgaW4gcGFyYWxsZWwuXG4gICAgICAgIGNvbnN0IHByb21pc2VzOiBBcnJheTxQcm9taXNlPGFueT4+ID0gW107XG4gICAgICAgIGNvbnN0IHBhcmVudEtleXM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGtleVN0ciBdIG9mIHBhcmVudEtleVN0clRvUGFyZW50cy5lbnRyaWVzKCkpIHtcblxuICAgICAgICAgICAgY29uc3QgY2hpbGRLZXlPYmogPSBKU09OLnBhcnNlKGtleVN0cik7XG5cbiAgICAgICAgICAgIHBhcmVudEtleXMucHVzaChrZXlTdHIpO1xuXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgY2hpbGRGaWVsZCwgdmFsIF0gb2YgT2JqZWN0LmVudHJpZXMoY2hpbGRLZXlPYmopKSB7XG4gICAgICAgICAgICAgICAgZmlsdGVyc1sgY2hpbGRGaWVsZCBdID0geyBlcTogdmFsIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb21pc2VzLnB1c2goXG4gICAgICAgICAgICAgICAgY2hpbGRTZXJ2aWNlLmxpc3Qoe1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuXG4gICAgICAgIC8vIEZvciBlYWNoIHJlc3VsdCwgbWFwIGNoaWxkcmVuIGJhY2sgdG8gdGhlIGNvcnJlY3QtcGFyZW50KHMpXG4gICAgICAgIGNvbnN0IHBhcmVudEtleVN0clRvQ2hpbGRyZW46IFJlY29yZDxzdHJpbmcsIGFueVtdPiA9IHt9O1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3VsdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IHsgZGF0YTogY2hpbGRJdGVtcyB9ID0gcmVzdWx0c1sgaSBdO1xuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gcGFyZW50S2V5c1sgaSBdO1xuICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9DaGlsZHJlblsga2V5U3RyIF0gPSBjaGlsZEl0ZW1zID8/IFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXR0YWNoIHRvIHBhcmVudHNcbiAgICAgICAgZm9yIChjb25zdCBbIGtleVN0ciwgcGFyZW50cyBdIG9mIHBhcmVudEtleVN0clRvUGFyZW50cy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQXJyYXkgPSBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuWyBrZXlTdHIgXSA/PyBbXTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcCBvZiBwYXJlbnRzKSB7XG4gICAgICAgICAgICAgICAgcFsgY2hpbGRBdHRyaWJ1dGVOYW1lIF0gPSBjaGlsZEFycmF5O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIGFuIGVudGl0eSBieSBpdHMgaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkuXG4gICAgICogQHBhcmFtIHNlbGVjdGlvbnMgLSBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmVzcG9uc2UuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJldHJpZXZlZCBlbnRpdHkgZGF0YS5cbiAgICAgKi9cblxuICAgIHB1YmxpYyBhc3luYyBnZXQob3B0aW9uczogR2V0T3B0aW9uczxTPiwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgYXR0cmlidXRlcyB9ID0gb3B0aW9ucztcblxuXG4gICAgICAgIGxldCBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcbiAgICAgICAgaWYgKCFhdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZvcm1hdHRlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm9ybWF0dGVkIGF0dHJpYnV0ZXMgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBmb3JtYXR0ZWRBdHRyaWJ1dGVzKTtcblxuICAgICAgICBjb25zdCByZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIGFueSkucmVkdWNlKChhY2MsIFsgYXR0TmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhY2MucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIGlmIChpc09iamVjdChvcHRpb25zKSAmJiBvcHRpb25zLmlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IEFycmF5PFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+PiA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzIDogWyBvcHRpb25zLmlkZW50aWZpZXJzIF07XG4gICAgICAgICAgICAgICAgY29uc3QgdG9wS2V5cyA9IGlkZW50aWZpZXJzLm1hcChpZGVudGlmaWVyID0+IGlkZW50aWZpZXIuc291cmNlPy5zcGxpdD8uKCcuJyk/LlsgMCBdKS5maWx0ZXIoa2V5ID0+ICEha2V5KSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgICAgICBhY2MucHVzaCguLi50b3BLZXlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIFtdIGFzIHN0cmluZ1tdKTtcblxuICAgICAgICBjb25zdCB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzID0gWyAuLi5uZXcgU2V0KHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcykgXVxuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGdldEVudGl0eTxTPih7XG4gICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmV0cmlldmVkIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBKc29uU2VyaWFsaXplci5zdHJpbmdpZnkoZW50aXR5KSk7XG5cbiAgICAgICAgaWYgKCEhZm9ybWF0dGVkQXR0cmlidXRlcyAmJiBlbnRpdHk/LmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBbIGVudGl0eS5kYXRhIF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGVudGl0eT8uZGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgbXVsdGlwbGUgZW50aXRpZXMgYnkgdGhlaXIgaWRlbnRpZmllcnMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgYmF0Y2ggcmV0cmlldmluZyBlbnRpdGllcy5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5pZGVudGlmaWVycyAtIEFycmF5IG9mIGVudGl0eSBpZGVudGlmaWVycyB0byByZXRyaWV2ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVzIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIHRvIHBlcmZvcm0gKGRlZmF1bHQ6IDEpLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSByZXRyaWV2ZWQgZW50aXRpZXMgYW5kIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgYmF0Y2hHZXQ8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczoge1xuICAgICAgICBpZGVudGlmaWVyczogQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sXG4gICAgICAgIGF0dHJpYnV0ZXM/OiBFbnRpdHlTZWxlY3Rpb25zPFM+LFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyXG4gICAgfSkge1xuICAgICAgICBjb25zdCB7IGlkZW50aWZpZXJzLCBhdHRyaWJ1dGVzLCBjb25jdXJyZW50ID0gMSB9ID0gb3B0aW9ucztcblxuICAgICAgICBsZXQgZm9ybWF0dGVkQXR0cmlidXRlcyA9IGF0dHJpYnV0ZXM7XG4gICAgICAgIGlmICghYXR0cmlidXRlcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmb3JtYXR0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvcm1hdHRlZCBhdHRyaWJ1dGVzIGZvciBiYXRjaCBnZXQgb24gZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIGZvcm1hdHRlZEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGNvbnN0IHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgYW55KS5yZWR1Y2UoKGFjYywgWyBhdHROYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgIGFjYy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgaWYgKGlzT2JqZWN0KG9wdGlvbnMpICYmIG9wdGlvbnMuaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogQXJyYXk8UmVsYXRpb25JZGVudGlmaWVyPGFueT4+ID0gQXJyYXkuaXNBcnJheShvcHRpb25zLmlkZW50aWZpZXJzKSA/IG9wdGlvbnMuaWRlbnRpZmllcnMgOiBbIG9wdGlvbnMuaWRlbnRpZmllcnMgXTtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3BLZXlzID0gaWRlbnRpZmllcnMubWFwKGlkZW50aWZpZXIgPT4gaWRlbnRpZmllci5zb3VyY2U/LnNwbGl0Py4oJy4nKT8uWyAwIF0pLmZpbHRlcihrZXkgPT4gISFrZXkpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgICAgICAgIGFjYy5wdXNoKC4uLnRvcEtleXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgfSwgW10gYXMgc3RyaW5nW10pO1xuXG4gICAgICAgIGNvbnN0IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBbIC4uLm5ldyBTZXQocmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzKSBdO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGdldEJhdGNoRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzIGFzIGFueSxcbiAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJldHJpZXZlZCBiYXRjaCBlbnRpdGllczogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBKc29uU2VyaWFsaXplci5zdHJpbmdpZnkoZW50aXR5KSk7XG5cbiAgICAgICAgaWYgKCEhZm9ybWF0dGVkQXR0cmlidXRlcyAmJiBlbnRpdHk/LmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdHkuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZGF0YTogZW50aXR5Py5kYXRhIHx8IFtdLFxuICAgICAgICAgICAgdW5wcm9jZXNzZWQ6IGVudGl0eT8udW5wcm9jZXNzZWQgfHwgW11cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgdGhlIHVuaXF1ZW5lc3Mgb2YgYW4gYXR0cmlidXRlIHZhbHVlIGFuZCB1cGRhdGVzIHRoZSBwYXlsb2FkIGlmIG5lY2Vzc2FyeS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjaGVja2luZyB1bmlxdWVuZXNzIGFuZCB1cGRhdGluZyB0aGUgcGF5bG9hZC5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5wYXlsb2FkVG9VcGRhdGUgLSBUaGUgcGF5bG9hZCBvYmplY3QgdG8gdXBkYXRlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmF0dHJpYnV0ZU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmF0dHJpYnV0ZVZhbHVlIC0gVGhlIHZhbHVlIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIG9wdGlvbnMubWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIC0gVGhlIG1heGltdW0gbnVtYmVyIG9mIGF0dGVtcHRzIHRvIGNyZWF0ZSBhIHVuaXF1ZSBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICogQHJldHVybnMgQSBib29sZWFuIGluZGljYXRpbmcgd2hldGhlciB0aGUgYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgY2hlY2tVbmlxdWVuZXNzQW5kVXBkYXRlKG9wdGlvbnM6IHtcbiAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBhbnksXG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgYXR0cmlidXRlVmFsdWU6IGFueSxcbiAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzPzoge1xuICAgICAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBhbnlcbiAgICAgICAgfVxuICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWU6IG51bWJlcixcbiAgICB9KSB7XG5cbiAgICAgICAgY29uc3QgeyBwYXlsb2FkVG9VcGRhdGUsIGF0dHJpYnV0ZU5hbWUsIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycywgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH0gPSBvcHRpb25zO1xuICAgICAgICBsZXQgeyBhdHRyaWJ1dGVWYWx1ZSB9ID0gb3B0aW9ucztcblxuICAgICAgICBsZXQgaXNVbmlxdWUgPSBmYWxzZTtcbiAgICAgICAgbGV0IHRyaWVzQ291bnQgPSAxO1xuXG4gICAgICAgIHdoaWxlICghaXNVbmlxdWUgJiYgdHJpZXNDb3VudCA8IG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSkge1xuICAgICAgICAgICAgaXNVbmlxdWUgPSBhd2FpdCB0aGlzLmlzVW5pcXVlQXR0cmlidXRlVmFsdWUoYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlVmFsdWUsIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyk7XG4gICAgICAgICAgICBpZiAoIWlzVW5pcXVlKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWUgPSB0aGlzLmdlbmVyYXRlVW5pcXVlVmFsdWUoYXR0cmlidXRlVmFsdWUsIHRyaWVzQ291bnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdHJpZXNDb3VudCsrO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzVW5pcXVlKSB7XG4gICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGVbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dHJpYnV0ZVZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGlzVW5pcXVlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGUgZ2l2ZW4gYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZSBmb3IgdGhlIHNwZWNpZmllZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcGFyYW0gYXR0cmlidXRlTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIGF0dHJpYnV0ZVZhbHVlIC0gVGhlIHZhbHVlIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHJldHVybnMgQSBib29sZWFuIGluZGljYXRpbmcgd2hldGhlciB0aGUgYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZSBvciBub3QuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGlzVW5pcXVlQXR0cmlidXRlVmFsdWUoXG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgYXR0cmlidXRlVmFsdWU6IGFueSxcbiAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzPzoge1xuICAgICAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBhbnlcbiAgICAgICAgfVxuICAgICkge1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBhdHRyaWJ1dGVOYW1lOiAke2F0dHJpYnV0ZU5hbWV9IH4gYXR0cmlidXRlVmFsdWU6ICR7YXR0cmlidXRlVmFsdWV9YCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGZpbHRlcnMgZm9yIHRoZSBxdWVyeSB1c2luZyB0aGUgY29ycmVjdCBzdHJ1Y3R1cmVcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIFsgYXR0cmlidXRlTmFtZSBdOiB7IGVxOiBhdHRyaWJ1dGVWYWx1ZSB9XG4gICAgICAgIH0gYXMgRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz47XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5lIHdoaWNoIGF0dHJpYnV0ZXMgdG8gcHJvamVjdCAtIG9ubHkgdGhlIGF0dHJpYnV0ZSBiZWluZyBjaGVja2VkIGFuZCBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVyc1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVzVG9Qcm9qZWN0OiBzdHJpbmdbXSA9IFsgYXR0cmlidXRlTmFtZSBdO1xuXG4gICAgICAgIC8vIEFkZCBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVyIGZpZWxkcyB0byB0aGUgcHJvamVjdGlvblxuICAgICAgICBpZiAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzICYmICFpc0VtcHR5T2JqZWN0RGVlcChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWF0dHJpYnV0ZXNUb1Byb2plY3QuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzVG9Qcm9qZWN0LnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzZSB0aGUgcXVlcnkgbWV0aG9kIHRvIGxldmVyYWdlIGluZGV4IHNlbGVjdGlvbiBsb2dpYyB3aXRoIG1pbmltYWwgYXR0cmlidXRlIHByb2plY3Rpb25cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeSh7XG4gICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogYXR0cmlidXRlc1RvUHJvamVjdCBhcyBhbnksXG4gICAgICAgICAgICBwYWdpbmF0aW9uOiB7IGNvdW50OiAxIH0gLy8gV2Ugb25seSBuZWVkIHRvIGtub3cgaWYgYW55IHJlY29yZHMgZXhpc3RcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSWYgd2UgaGF2ZSBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVycywgZmlsdGVyIHRoZSByZXN1bHRzIGluIG1lbW9yeVxuICAgICAgICBsZXQgZW50aXRpZXMgPSByZXN1bHQuZGF0YSB8fCBbXTtcbiAgICAgICAgaWYgKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyAmJiAhaXNFbXB0eU9iamVjdERlZXAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgZW50aXRpZXMgPSBlbnRpdGllcy5maWx0ZXIoZW50aXR5ID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gIU9iamVjdC5lbnRyaWVzKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykuZXZlcnkoKFsga2V5LCB2YWx1ZSBdKSA9PlxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlbIGtleSBdID09PSB2YWx1ZVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBhdHRyaWJ1dGVOYW1lOiAke2F0dHJpYnV0ZU5hbWV9IH4gYXR0cmlidXRlVmFsdWU6ICR7YXR0cmlidXRlVmFsdWV9IH4gZW50aXR5OmAsIHsgZGF0YTogZW50aXRpZXMgfSk7XG5cbiAgICAgICAgcmV0dXJuIGVudGl0aWVzLmxlbmd0aCA9PT0gMDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZXMgYSB1bmlxdWUgdmFsdWUgYnkgYXBwZW5kaW5nIGEgdW5pcXVlIHN1ZmZpeCB0byB0aGUgb3JpZ2luYWwgdmFsdWUuXG4gICAgICogQHBhcmFtIG9yaWdpbmFsVmFsdWUgLSBUaGUgb3JpZ2luYWwgdmFsdWUgdG8gZ2VuZXJhdGUgYSB1bmlxdWUgdmFsdWUgZnJvbS5cbiAgICAgKiBAcGFyYW0gYXR0ZW1wdCAtIFRoZSBhdHRlbXB0IG51bWJlciBvciBzdHJpbmcgdG8gYmUgdXNlZCBhcyBhIHN1ZmZpeCAoZGVmYXVsdDogcmFuZG9tIHN0cmluZykuXG4gICAgICogQHJldHVybnMgVGhlIGdlbmVyYXRlZCB1bmlxdWUgdmFsdWUuXG4gICAgICovXG4gICAgcHVibGljIGdlbmVyYXRlVW5pcXVlVmFsdWUob3JpZ2luYWxWYWx1ZTogYW55LCBhdHRlbXB0OiBudW1iZXIgfCBzdHJpbmcgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgMTUpKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgdW5pcXVlU3VmZml4ID0gYCR7RGF0ZS5ub3coKX0tJHthdHRlbXB0fWA7XG4gICAgICAgIHJldHVybiBgJHtvcmlnaW5hbFZhbHVlfS0ke3VuaXF1ZVN1ZmZpeH1gO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF1dG9tYXRpY2FsbHkgaW5qZWN0cyBhY3RvciBjb250ZXh0IGludG8gZW50aXR5IGRhdGFcbiAgICAgKiBAcGFyYW0gZGF0YSAtIFRoZSBlbnRpdHkgZGF0YSB0byBlbmhhbmNlXG4gICAgICogQHBhcmFtIG9wZXJhdGlvbiAtIFRoZSBvcGVyYXRpb24gdHlwZSAoY3JlYXRlL3VwZGF0ZSlcbiAgICAgKiBAcGFyYW0gY3R4IC0gVGhlIGV4ZWN1dGlvbiBjb250ZXh0IGNvbnRhaW5pbmcgYWN0b3IgaW5mb1xuICAgICAqIEByZXR1cm5zIEVuaGFuY2VkIGRhdGEgd2l0aCBhY3RvciBjb250ZXh0XG4gICAgICovXG4gICAgcHJvdGVjdGVkIGluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgICAgIGRhdGE6IFQsIFxuICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGVsZXRlJywgXG4gICAgICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgICApOiBUIHtcblxuICAgICAgICBpZiAoIWN0eD8uYWN0b3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdCYXNlRW50aXR5U2VydmljZTogTm8gYWN0b3IgY29udGV4dCBmb3VuZCwgc2tpcHBpbmcgaW5qZWN0aW9uJyk7XG4gICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVuaGFuY2VkRGF0YSA9IHsgLi4uZGF0YSB9O1xuICAgICAgICBjb25zdCB7IGFjdG9yIH0gPSBjdHg7XG5cbiAgICAgICAgLy8gR2V0IGN1cnJlbnQgdGltZXN0YW1wIGZvciBkYXRhYmFzZSBvcGVyYXRpb25cbiAgICAgICAgY29uc3QgY3VycmVudFRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEluamVjdCB2aXNpYmxlIGFjdG9yIGZpZWxkcyBpZiBkZWZpbmVkIGluIHNjaGVtYSBhbmQgbm90IHJlYWQtb25seVxuICAgICAgICBpZiAob3BlcmF0aW9uID09PSAnY3JlYXRlJykge1xuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdjcmVhdGVkQnknKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdjcmVhdGVkQnknKSAmJiBhY3Rvci5hY3RvcklkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLmNyZWF0ZWRCeSA9IGFjdG9yLmFjdG9ySWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2NyZWF0ZWRBdCcpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2NyZWF0ZWRBdCcpKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLmNyZWF0ZWRBdCA9IGN1cnJlbnRUaW1lc3RhbXA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEZvciBkZWxldGUgb3BlcmF0aW9ucywgd2Ugc3RpbGwgd2FudCB0byB0cmFjayB3aG8gcGVyZm9ybWVkIHRoZSBkZWxldGlvblxuICAgICAgICBpZiAob3BlcmF0aW9uID09PSAnZGVsZXRlJykge1xuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdkZWxldGVkQnknKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdkZWxldGVkQnknKSAmJiBhY3Rvci5hY3RvcklkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLmRlbGV0ZWRCeSA9IGFjdG9yLmFjdG9ySWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2RlbGV0ZWRBdCcpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2RlbGV0ZWRBdCcpKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLmRlbGV0ZWRBdCA9IGN1cnJlbnRUaW1lc3RhbXA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBBbHdheXMgdXBkYXRlIHRoZXNlIGZpZWxkcyBvbiBjcmVhdGUvdXBkYXRlIChpZiBub3QgcmVhZC1vbmx5KVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICd1cGRhdGVkQnknKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd1cGRhdGVkQnknKSAmJiBhY3Rvci5hY3RvcklkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLnVwZGF0ZWRCeSA9IGFjdG9yLmFjdG9ySWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ3VwZGF0ZWRBdCcpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3VwZGF0ZWRBdCcpKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLnVwZGF0ZWRBdCA9IGN1cnJlbnRUaW1lc3RhbXA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ3RlbmFudElkJykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndGVuYW50SWQnKSAmJiBhY3Rvci50ZW5hbnRJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS50ZW5hbnRJZCA9IGFjdG9yLnRlbmFudElkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWx3YXlzIGluamVjdCBjb21wbGV0ZSBhY3RvciBjb250ZXh0IGZvciBhdWRpdCB0cmFpbFxuICAgICAgICAvLyBUaGlzIGZpZWxkIGlzIGhpZGRlbiBmcm9tIEFQSSByZXNwb25zZXMgYnkgZGVmYXVsdFxuICAgICAgICAvLyBDbGVhbiBhY3RvciBvYmplY3QgYnkgcmVtb3ZpbmcgdW5kZWZpbmVkIHZhbHVlcyAoRHluYW1vREIgZG9lc24ndCBhbGxvdyB0aGVtKVxuICAgICAgICBjb25zdCBjbGVhbkFjdG9yID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoYWN0b3IpLmZpbHRlcigoW18sIHZhbHVlXSkgPT4gdmFsdWUgIT09IHVuZGVmaW5lZClcbiAgICAgICAgKTtcblxuICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuX2FjdG9yID0gY2xlYW5BY3RvcjtcblxuICAgICAgICByZXR1cm4gZW5oYW5jZWREYXRhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgZW50aXR5LlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBwYXlsb2FkIC0gVGhlIHBheWxvYWQgZm9yIGNyZWF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIGNyZWF0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBjcmVhdGUocGF5bG9hZDogQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICAgICAgbGV0IHBheWxvYWRDb3B5ID0geyAuLi5wYXlsb2FkIH07XG4gICAgICAgIFxuICAgICAgICAvLyBJbmplY3QgYWN0b3IgY29udGV4dFxuICAgICAgICBwYXlsb2FkQ29weSA9IHRoaXMuaW5qZWN0QWN0b3JDb250ZXh0KHBheWxvYWRDb3B5LCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTbHVnQXR0cmlidXRlID0gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ3NsdWcnKSB8fCAnJztcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUF0dHJpYnV0ZSA9IGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICduYW1lJykgfHwgJyc7XG5cbiAgICAgICAgaWYgKGVudGl0eVNsdWdBdHRyaWJ1dGUgJiYgIShlbnRpdHlTbHVnQXR0cmlidXRlIGluIHBheWxvYWRDb3B5KSkge1xuICAgICAgICAgICAgaWYgKGVudGl0eU5hbWVBdHRyaWJ1dGUgJiYgKGVudGl0eU5hbWVBdHRyaWJ1dGUgaW4gcGF5bG9hZENvcHkpKSB7XG4gICAgICAgICAgICAgICAgcGF5bG9hZENvcHlbIGVudGl0eVNsdWdBdHRyaWJ1dGUgYXMga2V5b2YgdHlwZW9mIHBheWxvYWRDb3B5IF0gPSB0b1NsdWcocGF5bG9hZENvcHlbIGVudGl0eU5hbWVBdHRyaWJ1dGUgXSkgYXMgYW55O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzID0gdGhpcy5nZXRVbmlxdWVBdHRyaWJ1dGVzKCk7XG4gICAgICAgIGNvbnN0IHNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSA9IDU7XG5cbiAgICAgICAgaWYgKCFza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyAmJiB1bmlxdWVGaWVsZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICBsZXQgdW5pcXVlbmVzc0NoZWNrcyA9IFtdO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZSB9IG9mIHVuaXF1ZUZpZWxkcykge1xuICAgICAgICAgICAgICAgIGlmIChuYW1lISBpbiBwYXlsb2FkQ29weSkge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdmFsdWUgPSBwYXlsb2FkQ29weVsgbmFtZSEgXTtcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlbmVzc0NoZWNrcy5wdXNoKCgpID0+IHRoaXMuY2hlY2tVbmlxdWVuZXNzQW5kVXBkYXRlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBheWxvYWRUb1VwZGF0ZTogcGF5bG9hZENvcHksXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBuYW1lISxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZVZhbHVlOiB2YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY2hlY2tSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwodW5pcXVlbmVzc0NoZWNrcy5tYXAoY2hlY2sgPT4gY2hlY2soKSkpO1xuXG4gICAgICAgICAgICBpZiAoY2hlY2tSZXN1bHRzLmluY2x1ZGVzKGZhbHNlKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkc1BhdGggPSB1bmlxdWVGaWVsZHMubWFwKGZpZWxkID0+IGZpZWxkLm5hbWUhKSA/PyBbXTtcblxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IoWyB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IFwiVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciBvbmUgb3IgbW9yZSBmaWVsZHMuXCIsXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHVuaXF1ZUZpZWxkc1BhdGgsXG4gICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkOiBbICd1bmlxdWUnLCB1bmlxdWVGaWVsZHMgXSxcbiAgICAgICAgICAgICAgICB9IF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgY3JlYXRlRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGRhdGE6IHBheWxvYWRDb3B5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gZW50aXR5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMtT1ItVXBkYXRlcyBhbiBlbnRpdHkuXG4gICAgICogTk9URTogXG4gICAgICogICAtIFRoaXMgbWV0aG9kIGRvZXMgbm90IGNoZWNrIGZvciB1bmlxdWVuZXNzIG9mIHRoZSBhdHRyaWJ1dGVzLCBuZWl0aGVyIGNyZWF0ZSB0aGUgc2x1ZyBhdXRvbWF0aWNhbGx5LlxuICAgICAqICAgLSBJdCdzIHRoZSByZXNwb25zaWJpbGl0eSBvZiB0aGUgY2FsbGVyIHRvIGVuc3VyZSB0aGUgcmVhZCBvbnkgYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGlmIHRoZSByZWNvcmQgaXMgYmVpbmcgdXBzZXJ0LlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBwYXlsb2FkIC0gVGhlIHBheWxvYWQgZm9yIGNyZWF0aW5nLU9SLXVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgT2JqZWN0IGNvbnRhaW5pbmc6XG4gICAgICogICAtIGRhdGE6IFRoZSB1cHNlcnRlZCBlbnRpdHkgZGF0YVxuICAgICAqICAgLSB3YXNDcmVhdGVkOiB0cnVlIGlmIHJlY29yZCB3YXMgY3JlYXRlZCwgZmFsc2UgaWYgdXBkYXRlZFxuICAgICAqICAgLSBvbGREYXRhOiBwcmV2aW91cyBkYXRhIGlmIGl0IHdhcyBhbiB1cGRhdGUgKHVuZGVmaW5lZCBmb3IgY3JlYXRlcylcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgdXBzZXJ0KHBheWxvYWQ6IFVwc2VydEVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBwYXlsb2FkOmAsIHBheWxvYWQpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHVwc2VydEVudGl0eTxTPih7XG4gICAgICAgICAgICBkYXRhOiBwYXlsb2FkLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBkdXBsaWNhdGUgZW50aXR5IGRhdGEgYmFzZWQgb24gdGhlIGdpdmVuIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBkdXBsaWNhdGUgZW50aXR5IGRhdGEuXG4gICAgICogQHRocm93cyBFcnJvciBpZiBubyByZWNvcmQgaXMgZm91bmQgZm9yIHRoZSBnaXZlbiBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGlkZW50aWZpZXJzID0geyBpZDogMSB9O1xuICAgICAqIGNvbnN0IGR1cGxpY2F0ZURhdGEgPSBhd2FpdCBtYWtlRHVwbGljYXRlRW50aXR5RGF0YUJ5SWRlbnRpZmllcnMoaWRlbnRpZmllcnMpO1xuICAgICAqIGNvbnNvbGUubG9nKGR1cGxpY2F0ZURhdGEpOyAvLyB7IG5hbWU6ICdKb2huIERvZScsIGFnZTogMzAsIC4uLiB9XG4gICAgICovXG4gICAgcHJvdGVjdGVkIGFzeW5jIG1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+KSB7XG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0KHsgaWRlbnRpZmllcnMgfSkgYXMgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz47XG5cbiAgICAgICAgaWYgKCFlbnRpdHkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gcmVjb3JkIGZvdW5kIGZvciBpZGVudGlmaWVyczogJHtpZGVudGlmaWVyc31gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBkdXBsaWNhdGVFdmVudERhdGE6IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiA9IHt9IGFzIGFueTtcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkUHJvcE5hbWUgPSB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpIGFzIHN0cmluZztcblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTbHVnQXR0cmlidXRlID0gKGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSAoZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ25hbWUnKSB8fCAnJykudG9VcHBlckNhc2UoKTtcblxuICAgICAgICBmb3IgKGxldCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhlbnRpdHkpKSB7XG5cbiAgICAgICAgICAgIGlmIChrZXkgIT09IHByaW1hcnlJZFByb3BOYW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gVE9ETzogaGFuZGxlIHdoZW4gZW50aXR5IGhhcyBtdWx0aXBsZSBpZGVudGlmaWVyc1xuXG4gICAgICAgICAgICAgICAgaWYgKGtleS50b1VwcGVyQ2FzZSgpID09PSBlbnRpdHlOYW1lQXR0cmlidXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gYCR7dmFsdWV9IC0gQ29weWA7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkudG9VcHBlckNhc2UoKSA9PT0gZW50aXR5U2x1Z0F0dHJpYnV0ZSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGAke3ZhbHVlfS1jb3B5YDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBkdXBsaWNhdGVFdmVudERhdGFbIGtleSBhcyBrZXlvZiB0eXBlb2YgZHVwbGljYXRlRXZlbnREYXRhIF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkdXBsaWNhdGVFdmVudERhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIGR1cGxpY2F0ZSBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZCAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIGR1cGxpY2F0ZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgZHVwbGljYXRlZCBlbnRpdHkuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBlbnRpdHlJZCA9IHsgaWQ6IDEyMywgbmFtZTogJ2V4YW1wbGUnIH07XG4gICAgICogY29uc3QgZHVwbGljYXRlZEVudGl0eSA9IGF3YWl0IGR1cGxpY2F0ZShlbnRpdHlJZCk7XG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGR1cGxpY2F0ZShpZDogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICBjb25zdCBkdXBsaWNhdGVFdmVudERhdGEgPSBhd2FpdCB0aGlzLm1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhKGlkKTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY3JlYXRlKGR1cGxpY2F0ZUV2ZW50RGF0YSwgY3R4KTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBzaG91bGQgYmUgcGFydCBvZiBzb21lIGNvbmZpZ1xuICAgIHByb3RlY3RlZCBkZWxpbWl0ZXJzUmVnZXggPSAvKD86JnwgfCx8XFwrKSsvO1xuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIGEgbGlzdCBvZiBlbnRpdGllcyBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgcXVlcnkuXG4gICAgICogLSBJZiBubyBzcGVjaWZpYyBhdHRyaWJ1dGVzIGFyZSBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIC0gSWYgYSBzZWFyY2ggdGVybSBpcyBwcm92aWRlZCBpbiB0aGUgcXVlcnkgaXQgd2lsbCBzcGxpdCB0aGUgc2VhcmNoIHRlcm0gYnkgYC8oPzomfCB8LHxcXCspKy9gIFJlZ2V4IGFuZCB3aWxsIGZpbHRlciBvdXQgZW1wdHkgc3RyaW5ncy5cbiAgICAgKiAtIElmIHNlYXJjaCBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2Ygc2VhcmNoYWJsZSBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBxdWVyeSAtIFRoZSBxdWVyeSBvYmplY3QgY29udGFpbmluZyBmaWx0ZXJzLCBzZWFyY2gga2V5d29yZHMsIGFuZCBhdHRyaWJ1dGVzLlxuICAgICAqIEByZXR1cm5zIEEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSBsaXN0IG9mIGVudGl0aWVzIGFuZCB0aGUgb3JpZ2luYWwgcXVlcnkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGxpc3QocXVlcnk6IEVudGl0eVF1ZXJ5PFM+ID0ge30sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgaWYgKCFxdWVyeS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBxdWVyeS5hdHRyaWJ1dGVzID0gdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZm9yIGxpc3RpbmcgQVBJIGF0dHJpYnV0ZXMgd291bGQgYmUgYW4gYXJyYXlcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocXVlcnkuYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHF1ZXJ5LmF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgcXVlcnkuYXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzLnNwbGl0KCcsJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzIHx8IGlzRW1wdHkocXVlcnkuc2VhcmNoQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRmlsdGVyR3JvdXAgPSBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcyhxdWVyeS5zZWFyY2gsIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuZmlsdGVycyA9IGFkZEZpbHRlckdyb3VwVG9FbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPihzZWFyY2hGaWx0ZXJHcm91cCBhcyBhbnksIHF1ZXJ5LmZpbHRlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXMgPSBhd2FpdCBsaXN0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICBlbnRpdGllcy5kYXRhID0gdGhpcy5zZXJpYWxpemVSZWNvcmRzKGVudGl0aWVzLmRhdGEsIHF1ZXJ5LmF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGlmIChxdWVyeS5hdHRyaWJ1dGVzICYmIGVudGl0aWVzLmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMocXVlcnkuYXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF07XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC8vIG9ubHkgYXR0cmlidXRlcyBpbiBoeWRyYXRlIG9wdGlvbnMgdGhhdCBoYXZlIHJlbGF0aW9uIG1ldGFkYXRhIGF0dGFjaGVkIHRvIHRoZW0gbmVlZHMgdG8gYmUgaHlkcmF0ZWRcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXRpZXMuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyAuLi5lbnRpdGllcywgcXVlcnkgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEV4ZWN1dGVzIGEgcXVlcnkgb24gdGhlIGVudGl0eS5cbiAgICAgKiAtIElmIG5vIHNwZWNpZmljIGF0dHJpYnV0ZXMgYXJlIHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogLSBJZiBhIHNlYXJjaCB0ZXJtIGlzIHByb3ZpZGVkIGluIHRoZSBxdWVyeSBpdCB3aWxsIHNwbGl0IHRoZSBzZWFyY2ggdGVybSBieSBgLyg/OiZ8IHwsfFxcKykrL2AgUmVnZXggYW5kIHdpbGwgZmlsdGVyIG91dCBlbXB0eSBzdHJpbmdzLlxuICAgICAqICAgLS0gSWYgc2VhcmNoIGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBzZWFyY2hhYmxlIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogICAtLSBJZiB0aGVyZSBhcmUgYW55IG5vbi1lbXB0eSBzZWFyY2gtdGVybXMsIGl0IHdpbGwgYWRkIGEgZmlsdGVyIGdyb3VwIHRvIHRoZSBxdWVyeSBiYXNlZCBvbiB0aGUgc2VhcmNoIGtleXdvcmRzLlxuICAgICAqIEBwYXJhbSBxdWVyeSAtIFRoZSBlbnRpdHkgcXVlcnkgdG8gZXhlY3V0ZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmVzdWx0IG9mIHRoZSBxdWVyeS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgcXVlcnkocXVlcnk6IEVudGl0eVF1ZXJ5PFM+LCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gbGlzdCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcXVlcnk6YCwgcXVlcnkpO1xuXG4gICAgICAgIGNvbnN0IHsgYXR0cmlidXRlcyB9ID0gcXVlcnk7XG5cbiAgICAgICAgbGV0IHNlbGVjdEF0dHJpYnV0ZXM6IEVudGl0eVNlbGVjdGlvbnM8Uz4gfCB1bmRlZmluZWQgPSBhdHRyaWJ1dGVzIHx8IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0QXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIC8vIHBhcnNlIHRoZSBsaXN0IG9mIGRvdC1zZXBhcmF0ZWQgYXR0cmlidXRlLWlkZW50aWZpZXJzIHBhdGhzIGFuZCBlbnN1cmUgYWxsIHRoZSByZXF1aXJlZCBtZXRhZGF0YSBpcyB0aGVyZVxuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoc2VsZWN0QXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBzZWxlY3RBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gZW5zdXJlIGFsbCB0aGUgcHJvdmlkZWQgc2VsZWN0IGF0dHJpYnV0ZXMgaGFzIHJlcXVpcmVkIG1ldGFkYXRhIGFsbCB0aGUgd2F5IGRvd24gdG8gdGhlIGxlYWYgbGV2ZWxcbiAgICAgICAgICAgIHNlbGVjdEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgc2VsZWN0QXR0cmlidXRlcyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocXVlcnkuc2VhcmNoKSB7XG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoKSkge1xuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaCA9IHF1ZXJ5LnNlYXJjaC50cmltKCkuc3BsaXQodGhpcy5kZWxpbWl0ZXJzUmVnZXggPz8gJyAnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuc2VhcmNoLmxlbmd0aCA+IDApIHtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzIHx8IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXJHcm91cCA9IG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzKHF1ZXJ5LnNlYXJjaCwgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyk7XG5cbiAgICAgICAgICAgICAgICBxdWVyeS5maWx0ZXJzID0gYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhPFM+KHNlYXJjaEZpbHRlckdyb3VwIGFzIGFueSwgcXVlcnkuZmlsdGVycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdGllcyA9IGF3YWl0IHF1ZXJ5RW50aXR5PFM+KHtcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICBlbnRpdGllcy5kYXRhID0gdGhpcy5zZXJpYWxpemVSZWNvcmRzKGVudGl0aWVzLmRhdGEsIHNlbGVjdEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGlmIChzZWxlY3RBdHRyaWJ1dGVzICYmIGVudGl0aWVzLmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoc2VsZWN0QXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF07XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC8vIG9ubHkgYXR0cmlidXRlcyBpbiBoeWRyYXRlIG9wdGlvbnMgdGhhdCBoYXZlIHJlbGF0aW9uIG1ldGFkYXRhIGF0dGFjaGVkIHRvIHRoZW0gbmVlZHMgdG8gYmUgaHlkcmF0ZWRcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXRpZXMuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyAuLi5lbnRpdGllcywgcXVlcnkgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGVzIGFuIGVudGl0eSBpbiB0aGUgZGF0YWJhc2UuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byB1cGRhdGUuXG4gICAgICogQHBhcmFtIGRhdGEgLSBUaGUgdXBkYXRlZCBkYXRhIGZvciB0aGUgZW50aXR5LlxuICAgICAqIEBwYXJhbSByZW1vdmUgLSBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGVzIHRvIHJlbW92ZSBmcm9tIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIHVwZGF0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyB1cGRhdGUoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4sIGRhdGE6IFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiwgb3BlcmF0b3JzPzogVXBkYXRlRW50aXR5T3BlcmF0b3JzLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHRcbiAgICAgICAgbGV0IGVuaGFuY2VkRGF0YSA9IHRoaXMuaW5qZWN0QWN0b3JDb250ZXh0KGRhdGEgYXMgYW55LCAndXBkYXRlJywgY3R4KTtcblxuICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHMgPSB0aGlzLmdldFVuaXF1ZUF0dHJpYnV0ZXMoKTtcbiAgICAgICAgY29uc3Qgc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlID0gNTtcblxuICAgICAgICBpZiAoIXNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzICYmIHVuaXF1ZUZpZWxkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxldCB1bmlxdWVuZXNzQ2hlY2tzID0gW107XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lLCByZWFkT25seSB9IG9mIHVuaXF1ZUZpZWxkcykge1xuICAgICAgICAgICAgICAgIGlmIChyZWFkT25seSkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgZW5oYW5jZWREYXRhWyBuYW1lIGFzIGtleW9mIHR5cGVvZiBlbmhhbmNlZERhdGEgXTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKG5hbWUhIGluIGVuaGFuY2VkRGF0YSkge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdmFsdWUgPSBlbmhhbmNlZERhdGFbIG5hbWUgYXMga2V5b2YgdHlwZW9mIGVuaGFuY2VkRGF0YSBdO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBlbmhhbmNlZERhdGEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBuYW1lISxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZVZhbHVlOiB2YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVyczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHVuaXF1ZW5lc3NDaGVja3MubWFwKGNoZWNrID0+IGNoZWNrKCkpKTtcblxuICAgICAgICAgICAgaWYgKGNoZWNrUmVzdWx0cy5pbmNsdWRlcyhmYWxzZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHNQYXRoID0gdW5pcXVlRmllbGRzLm1hcChmaWVsZCA9PiBmaWVsZC5uYW1lISkgPz8gW107XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKFsge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlVuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igb25lIG9yIG1vcmUgZmllbGRzLlwiLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiB1bmlxdWVGaWVsZHNQYXRoLFxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogWyAndW5pcXVlJywgdW5pcXVlRmllbGRzIF0sXG4gICAgICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVwZGF0ZWRFbnRpdHkgPSBhd2FpdCB1cGRhdGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgZGF0YTogZW5oYW5jZWREYXRhLFxuICAgICAgICAgICAgb3BlcmF0b3JzOiBvcGVyYXRvcnMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB1cGRhdGVkRW50aXR5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGV0ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBiZSBkZWxldGVkLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBkZWxldGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZGVsZXRlKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGRlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gaWRlbnRpZmllcnM6YCwgaWRlbnRpZmllcnMpO1xuICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGRlbGV0ZWRFbnRpdHkgPSBhd2FpdCBkZWxldGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICAgICAgYWN0b3I6IGN0eD8uYWN0b3IsXG4gICAgICAgICAgICB0ZW5hbnQ6IGN0eD8uYWN0b3I/LnRlbmFudElkLFxuICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIGRlbGV0ZWRFbnRpdHk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBEYXRhYmFzZUVycm9yKGBGYWlsZWQgdG8gZGVsZXRlICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxldGVzIG11bHRpcGxlIGVudGl0aWVzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGJhdGNoIGRlbGV0aW5nIGVudGl0aWVzLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmlkZW50aWZpZXJzIC0gQXJyYXkgb2YgZW50aXR5IGlkZW50aWZpZXJzIHRvIGRlbGV0ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5jb25jdXJyZW50IC0gT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyB0byBwZXJmb3JtIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcGFyYW0gY3R4IC0gT3B0aW9uYWwgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvcm1hdGlvbi5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRGVsZXRlIG11bHRpcGxlIGVudGl0aWVzXG4gICAgICogY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VydmljZS5iYXRjaERlbGV0ZSh7XG4gICAgICogICBpZGVudGlmaWVyczogW1xuICAgICAqICAgICB7IGlkOiAnaXRlbTEnIH0sXG4gICAgICogICAgIHsgaWQ6ICdpdGVtMicgfSxcbiAgICAgKiAgICAgeyBpZDogJ2l0ZW0zJyB9XG4gICAgICogICBdLFxuICAgICAqICAgY29uY3VycmVudDogMlxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIGlmIChyZXN1bHQudW5wcm9jZXNzZWQubGVuZ3RoID4gMCkge1xuICAgICAqICAgY29uc29sZS5sb2coJ1NvbWUgaXRlbXMgd2VyZSBub3QgZGVsZXRlZDonLCByZXN1bHQudW5wcm9jZXNzZWQpO1xuICAgICAqIH1cbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgYmF0Y2hEZWxldGUob3B0aW9uczoge1xuICAgICAgICBpZGVudGlmaWVyczogQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sXG4gICAgICAgIGNvbmN1cnJlbnQ/OiBudW1iZXJcbiAgICB9LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IGlkZW50aWZpZXJzLCBjb25jdXJyZW50ID0gMSB9ID0gb3B0aW9ucztcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGJhdGNoRGVsZXRlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBjb3VudDogJHtpZGVudGlmaWVycy5sZW5ndGh9YCwge1xuICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkZWxldGVCYXRjaEVudGl0eTxTPih7XG4gICAgICAgICAgICAgICAgaWRzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICAgICAgICAgIGFjdG9yOiBjdHg/LmFjdG9yLFxuICAgICAgICAgICAgICAgIHRlbmFudDogY3R4Py5hY3Rvcj8udGVuYW50SWQsXG4gICAgICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEVsZWN0cm9EQiBiYXRjaCBkZWxldGUgcmV0dXJucyB7IHVucHJvY2Vzc2VkOiBBcnJheSB9XG4gICAgICAgICAgICBjb25zdCB1bnByb2Nlc3NlZENvdW50ID0gKHJlc3VsdCBhcyBhbnkpPy51bnByb2Nlc3NlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgICBjb25zdCBkYXRhQ291bnQgPSByZXN1bHQuZGF0YT8ubGVuZ3RoO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvbXBsZXRlZCB+IGJhdGNoRGVsZXRlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBwcm9jZXNzZWQ6ICR7aWRlbnRpZmllcnMubGVuZ3RofSwgZGF0YUNvdW50OiAke2RhdGFDb3VudH0sIHVucHJvY2Vzc2VkOiAke3VucHJvY2Vzc2VkQ291bnR9YCk7XG5cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBEYXRhYmFzZUVycm9yKGBGYWlsZWQgdG8gYmF0Y2ggZGVsZXRlICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxldGVzIGVudGl0aWVzIGJhc2VkIG9uIGEgcXVlcnkgZmlsdGVyLlxuICAgICAqIFRoaXMgbWV0aG9kIHF1ZXJpZXMgZm9yIGVudGl0aWVzIG1hdGNoaW5nIHRoZSBmaWx0ZXIgYW5kIHRoZW4gYmF0Y2ggZGVsZXRlcyB0aGVtLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIGJ5IHF1ZXJ5LlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmZpbHRlcnMgLSBUaGUgZmlsdGVyIGNyaXRlcmlhIHRvIG1hdGNoIGVudGl0aWVzIGZvciBkZWxldGlvbi5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5iYXRjaFNpemUgLSBUaGUgbnVtYmVyIG9mIGl0ZW1zIHRvIGRlbGV0ZSBpbiBlYWNoIGJhdGNoIChkZWZhdWx0OiAyNSkuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuY29uY3VycmVudCAtIE51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLm1heEl0ZW1zIC0gT3B0aW9uYWwgbWF4aW11bSBudW1iZXIgb2YgaXRlbXMgdG8gZGVsZXRlIChzYWZldHkgbGltaXQpLlxuICAgICAqIEBwYXJhbSBjdHggLSBPcHRpb25hbCBleGVjdXRpb24gY29udGV4dCBjb250YWluaW5nIGFjdG9yIGluZm9ybWF0aW9uLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCB3aXRoIGRlbGV0aW9uIHN0YXRpc3RpY3MuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRGVsZXRlIGFsbCBpbmFjdGl2ZSB1c2Vyc1xuICAgICAqIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHVzZXJTZXJ2aWNlLmRlbGV0ZUJ5UXVlcnkoe1xuICAgICAqICAgZmlsdGVyczoge1xuICAgICAqICAgICBzdGF0dXM6IHsgZXE6ICdpbmFjdGl2ZScgfSxcbiAgICAgKiAgICAgbGFzdExvZ2luQXQ6IHsgbHQ6ICcyMDIzLTAxLTAxJyB9XG4gICAgICogICB9LFxuICAgICAqICAgYmF0Y2hTaXplOiA1MCxcbiAgICAgKiAgIG1heEl0ZW1zOiAxMDAwXG4gICAgICogfSk7XG4gICAgICogXG4gICAgICogY29uc29sZS5sb2coYERlbGV0ZWQgJHtyZXN1bHQuZGVsZXRlZENvdW50fSBpdGVtcywgJHtyZXN1bHQuZmFpbGVkQ291bnR9IGZhaWxlZGApO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBkZWxldGVCeVF1ZXJ5KG9wdGlvbnM6IHtcbiAgICAgICAgZmlsdGVyczogRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4sXG4gICAgICAgIGJhdGNoU2l6ZT86IG51bWJlcixcbiAgICAgICAgY29uY3VycmVudD86IG51bWJlcixcbiAgICAgICAgbWF4SXRlbXM/OiBudW1iZXJcbiAgICB9LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IGZpbHRlcnMsIGJhdGNoU2l6ZSA9IDI1LCBjb25jdXJyZW50ID0gMSwgbWF4SXRlbXMgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENhbGxlZCB+IGRlbGV0ZUJ5UXVlcnkgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgICAgIGJhdGNoU2l6ZSxcbiAgICAgICAgICAgICAgICBtYXhJdGVtc1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFNhZmV0eSBjaGVjazogcmVxdWlyZSBmaWx0ZXJzIHRvIHByZXZlbnQgYWNjaWRlbnRhbCBkZWxldGlvbiBvZiBhbGwgcmVjb3Jkc1xuICAgICAgICAgICAgaWYgKCFmaWx0ZXJzIHx8IGlzRW1wdHlPYmplY3REZWVwKGZpbHRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdkZWxldGVCeVF1ZXJ5IHJlcXVpcmVzIGZpbHRlcnMgdG8gcHJldmVudCBhY2NpZGVudGFsIGRlbGV0aW9uIG9mIGFsbCByZWNvcmRzLiBVc2Ugc2NhbiB3aXRoIGV4cGxpY2l0IGNvbmZpcm1hdGlvbiBpZiB5b3UgbmVlZCB0byBkZWxldGUgYWxsIHJlY29yZHMuJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBkZWxldGVkQ291bnQgPSAwO1xuICAgICAgICAgICAgbGV0IGZhaWxlZENvdW50ID0gMDtcbiAgICAgICAgICAgIGxldCBjdXJzb3I6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgICAgICAgbGV0IHRvdGFsUHJvY2Vzc2VkID0gMDtcblxuICAgICAgICAgICAgLy8gUXVlcnkgYW5kIGRlbGV0ZSBpbiBiYXRjaGVzXG4gICAgICAgICAgICBkbyB7XG4gICAgICAgICAgICAgICAgLy8gRmV0Y2ggYSBiYXRjaCBvZiBpdGVtcyB0byBkZWxldGVcbiAgICAgICAgICAgICAgICBjb25zdCBxdWVyeVJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoe1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICBwYWdpbmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb3VudDogYmF0Y2hTaXplLFxuICAgICAgICAgICAgICAgICAgICAgICAgY3Vyc29yOiBjdXJzb3IgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3JkZXI6ICdhc2MnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGFnZXI6ICdjdXJzb3InXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LCBjdHgpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgaXRlbXNUb0RlbGV0ZSA9IHF1ZXJ5UmVzdWx0LmRhdGE7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKCFpdGVtc1RvRGVsZXRlIHx8IGl0ZW1zVG9EZWxldGUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBEZWxldGluZyBiYXRjaCBvZiAke2l0ZW1zVG9EZWxldGUubGVuZ3RofSBpdGVtc2ApO1xuXG4gICAgICAgICAgICAgICAgLy8gRXh0cmFjdCBpZGVudGlmaWVycyBmcm9tIHRoZSBmZXRjaGVkIGl0ZW1zXG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnMgPSBpdGVtc1RvRGVsZXRlLm1hcChpdGVtID0+IFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpdGVtIGFzIGFueSlcbiAgICAgICAgICAgICAgICApIGFzIEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+O1xuXG4gICAgICAgICAgICAgICAgLy8gQmF0Y2ggZGVsZXRlIHRoZSBpdGVtc1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZVJlc3VsdCA9IGF3YWl0IHRoaXMuYmF0Y2hEZWxldGUoe1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICAgICAgICAgIH0sIGN0eCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB1bnByb2Nlc3NlZENvdW50ID0gKGRlbGV0ZVJlc3VsdCBhcyBhbnkpPy51bnByb2Nlc3NlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgICAgICAgY29uc3QgZGF0YUNvdW50ID0gZGVsZXRlUmVzdWx0LmRhdGE/Lmxlbmd0aDtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaERlbGV0ZWRDb3VudCA9IGlkZW50aWZpZXJzLmxlbmd0aCAtIHVucHJvY2Vzc2VkQ291bnQ7XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50ICs9IGJhdGNoRGVsZXRlZENvdW50O1xuICAgICAgICAgICAgICAgIGZhaWxlZENvdW50ICs9IHVucHJvY2Vzc2VkQ291bnQ7XG4gICAgICAgICAgICAgICAgdG90YWxQcm9jZXNzZWQgKz0gaXRlbXNUb0RlbGV0ZS5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQmF0Y2ggcmVzdWx0OiAke2JhdGNoRGVsZXRlZENvdW50fSBkZWxldGVkLCAke3VucHJvY2Vzc2VkQ291bnR9IGZhaWxlZGApO1xuXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UndmUgaGl0IHRoZSBtYXggaXRlbXMgbGltaXRcbiAgICAgICAgICAgICAgICBpZiAobWF4SXRlbXMgJiYgdG90YWxQcm9jZXNzZWQgPj0gbWF4SXRlbXMpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmVhY2hlZCBtYXhJdGVtcyBsaW1pdCBvZiAke21heEl0ZW1zfSwgc3RvcHBpbmcgZGVsZXRpb25gKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIGN1cnNvciBmb3IgbmV4dCBpdGVyYXRpb25cbiAgICAgICAgICAgICAgICBjdXJzb3IgPSBxdWVyeVJlc3VsdC5jdXJzb3IgfHwgbnVsbDtcblxuICAgICAgICAgICAgfSB3aGlsZSAoY3Vyc29yKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIH4gZGVsZXRlQnlRdWVyeSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gZGVsZXRlZDogJHtkZWxldGVkQ291bnR9LCBmYWlsZWQ6ICR7ZmFpbGVkQ291bnR9YCk7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50LFxuICAgICAgICAgICAgICAgIGZhaWxlZENvdW50LFxuICAgICAgICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gZGVsZXRlIGJ5IHF1ZXJ5IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTpgLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSBieSBxdWVyeSBmb3IgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlYnVpbGRzIGFsbCBpbmRleGVzIGZvciB0aGUgZW50aXR5IGJ5IHdyaXRpbmcgdG8gdGhlIHByaW1hcnkgaW5kZXguXG4gICAgICogVGhpcyBtZXRob2QgaXMgdXNlZnVsIGZvciBtYWludGFpbmluZyBkYXRhIGludGVncml0eSBhbmQgZW5zdXJpbmcgaW5kZXhlcyBhcmUgcHJvcGVybHkgdXBkYXRlZC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIE9wdGlvbnMgZm9yIHJlYnVpbGRpbmcgdGhlIGluZGV4XG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBwcm9jZXNzIGluIGVhY2ggYmF0Y2guIERlZmF1bHRzIHRvIDEwMC5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBpbmRleCByZWJ1aWxkIGlzIGNvbXBsZXRlLlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyByZWJ1aWxkSW5kZXgob3B0aW9uczogeyBiYXRjaFNpemU/OiBudW1iZXIgfSA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IGJhdGNoU2l6ZSA9IDEwMCB9ID0gb3B0aW9ucztcbiAgICAgICAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSB0aGlzLmdldEVudGl0eU5hbWUoKTtcbiAgICAgICAgICAgIGNvbnN0IHJlcG9zaXRvcnkgPSB0aGlzLmdldFJlcG9zaXRvcnkoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU3RhcnRpbmcgaW5kZXggcmVidWlsZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIEdldCBhbGwgcmVjb3JkcyBmcm9tIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICBjb25zdCBhbGxSZWNvcmRzID0gYXdhaXQgcmVwb3NpdG9yeS5zY2FuLmdvKCk7XG5cbiAgICAgICAgICAgIGlmICghYWxsUmVjb3Jkcy5kYXRhIHx8IGFsbFJlY29yZHMuZGF0YS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBObyByZWNvcmRzIGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZvdW5kICR7YWxsUmVjb3Jkcy5kYXRhLmxlbmd0aH0gcmVjb3JkcyB0byBwcm9jZXNzIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcblxuICAgICAgICAgICAgLy8gUHJvY2VzcyByZWNvcmRzIGluIGJhdGNoZXNcbiAgICAgICAgICAgIGNvbnN0IHRvdGFsUmVjb3JkcyA9IGFsbFJlY29yZHMuZGF0YS5sZW5ndGg7XG4gICAgICAgICAgICBjb25zdCB0b3RhbEJhdGNoZXMgPSBNYXRoLmNlaWwodG90YWxSZWNvcmRzIC8gYmF0Y2hTaXplKTtcblxuICAgICAgICAgICAgZm9yIChsZXQgYmF0Y2hJbmRleCA9IDA7IGJhdGNoSW5kZXggPCB0b3RhbEJhdGNoZXM7IGJhdGNoSW5kZXgrKykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gYmF0Y2hJbmRleCAqIGJhdGNoU2l6ZTtcbiAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1pbihzdGFydCArIGJhdGNoU2l6ZSwgdG90YWxSZWNvcmRzKTtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaCA9IGFsbFJlY29yZHMuZGF0YS5zbGljZShzdGFydCwgZW5kKTtcblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFByb2Nlc3NpbmcgYmF0Y2ggJHtiYXRjaEluZGV4ICsgMX0vJHt0b3RhbEJhdGNoZXN9ICgke3N0YXJ0ICsgMX0tJHtlbmR9IG9mICR7dG90YWxSZWNvcmRzfSByZWNvcmRzKWApO1xuXG4gICAgICAgICAgICAgICAgLy8gUmVidWlsZCBhbGwgaW5kZXhlcyBieSB1cHNlcnRpbmcgZWFjaCByZWNvcmQgdG8gdGhlIHByaW1hcnkgaW5kZXhcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBiYXRjaCkge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHVwc2VydCB0byBlbnN1cmUgdGhlIHJlY29yZCBpcyBwcm9wZXJseSBpbmRleGVkXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZXBvc2l0b3J5LnVwc2VydChyZWNvcmQpLmdvKCk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyByZWNvcmQ6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb21wbGV0ZWQgaW5kZXggcmVidWlsZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIHJlYnVpbGQgaW5kZXggZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIHJlYnVpbGQgaW5kZXggZm9yICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEluZmVycyByZWxhdGlvbnNoaXBzIGJldHdlZW4gZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIHNjaGVtYSBhbmQgc2VsZWN0aW9uLXBhdGhzLlxuICAgICAqIEBwYXJhbSBzY2hlbWEgVGhlIGVudGl0eSBzY2hlbWEuXG4gICAgICogQHBhcmFtIHBhdGhzIFRoZSBwYXJzZWQgc2VsZWN0aW9uIHBhdGhzIGZyb20gZS5nLiBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKCkuXG4gICAgICogQHBhcmFtIHBhdGhLZXkgVGhlIGN1cnJlbnQgXCJwYXRoXCIgc3RyaW5nIHJlcHJlc2VudGluZyBob3cgd2UgYXJyaXZlZCBoZXJlIChkZWZhdWx0cyB0byB0aGUgZW50aXR5IG5hbWUpLlxuICAgICAqIEBwYXJhbSB2aXNpdGVkUGF0aHMgQSBzZXQgb2YgcGF0aC1zdHJpbmdzIHZpc2l0ZWQgc28gZmFyIGluIHRoaXMgcmVjdXJzaW9uIGNoYWluIChwcmV2ZW50cyBjeWNsZXMpLlxuICAgICAqIEBwYXJhbSBtYXhEZXB0aCBNYXhpbXVtIHJlY3Vyc2lvbiBkZXB0aCAob3B0aW9uYWwpLlxuICAgICAqL1xuICAgIGluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgICAgIHNjaGVtYTogRSxcbiAgICAgICAgcGF0aHM6IFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzLFxuICAgICAgICBwYXRoS2V5OiBzdHJpbmcgPSBzY2hlbWEubW9kZWwuZW50aXR5LFxuICAgICAgICB2aXNpdGVkUGF0aHM6IFNldDxzdHJpbmc+ID0gbmV3IFNldDxzdHJpbmc+KCksXG4gICAgICAgIG1heERlcHRoID0gNVxuICAgICk6IEh5ZHJhdGVPcHRpb25zTWFwRm9yRW50aXR5PEU+IHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucycsIHsgcGF0aEtleSwgcGF0aHMgfSk7XG5cbiAgICAgICAgLy8gSWYgd2UgZXhjZWVkIG1heCBkZXB0aCwgd2Ugc2tpcCBleHBhbnNpb25zXG4gICAgICAgIGlmIChtYXhEZXB0aCA8PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBNYXggcmVjdXJzaW9uIGRlcHRoIHJlYWNoZWQgYXQgcGF0aEtleT1cIiR7cGF0aEtleX1cImApO1xuICAgICAgICAgICAgcmV0dXJuIHt9IGFzIEh5ZHJhdGVPcHRpb25zTWFwRm9yRW50aXR5PEU+O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW5mZXJyZWQ6IGFueSA9IHt9O1xuXG4gICAgICAgIC8vIExvb3Agb3ZlciBlYWNoIGF0dHJpYnV0ZSBpbiB0aGUgZW50aXR5IHNjaGVtYVxuICAgICAgICBPYmplY3QuZW50cmllcyhzY2hlbWEuYXR0cmlidXRlcykuZm9yRWFjaCgoWyBhdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVNZXRhIF0pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGF0dFZhbCA9IHBhdGhzWyBhdHRyaWJ1dGVOYW1lIF07XG4gICAgICAgICAgICBpZiAoIWF0dFZhbCkge1xuICAgICAgICAgICAgICAgIC8vIE5vdCBzZWxlY3RlZCBpbiB0aGUgdXNlcidzIGF0dHJpYnV0ZXNcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGlzUmVsYXRpb25hbCA9ICEhYXR0cmlidXRlTWV0YS5yZWxhdGlvbjtcblxuICAgICAgICAgICAgLy8gSWYgdGhlIGF0dHJpYnV0ZSBpcyBub3QgcmVsYXRpb25hbCBvciB0aGUgdmFsdWUgaXMgYSBib29sZWFuLCB3ZSBjYW4gaW5mZXIgdGhlIGF0dHJpYnV0ZVxuICAgICAgICAgICAgaWYgKCFpc1JlbGF0aW9uYWwgfHwgaXNCb29sZWFuKGF0dFZhbCkpIHtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gYXR0VmFsO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSXQncyBhIHJlbGF0aW9uYWwgYXR0cmlidXRlOyBwcmVwYXJlIHRvIHJlY3Vyc2VcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uTWV0YSA9IGF0dHJpYnV0ZU1ldGEucmVsYXRpb24hO1xuICAgICAgICAgICAgY29uc3QgbmV4dEVudGl0eU5hbWUgPSByZWxhdGlvbk1ldGEuZW50aXR5TmFtZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBuZXcgXCJwYXRoXCIgc3RyaW5nIHRvIGRldGVjdCBjeWNsZXMgKGUuZy4gXCJVc2VyLmdyb3Vwcy5Hcm91cC5tZW1iZXJzLlVzZXJcIilcbiAgICAgICAgICAgIGNvbnN0IG5ld1BhdGggPSBgJHtwYXRoS2V5fS4ke2F0dHJpYnV0ZU5hbWV9LiR7bmV4dEVudGl0eU5hbWV9YDtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UndmUgYWxyZWFkeSB2aXNpdGVkIHRoaXMgcGF0aCwgaWYgc28gPT4gc2tpcCBleHBhbnNpb25zIGZvciB0aGlzIGF0dHJpYnV0ZSBvbmx5XG4gICAgICAgICAgICBpZiAodmlzaXRlZFBhdGhzLmhhcyhuZXdQYXRoKSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFNraXBwaW5nIGN5YyByZWxhdGlvbiBleHBhbnNpb25zIGZvcjogJHtuZXdQYXRofWApO1xuICAgICAgICAgICAgICAgIGluZmVycmVkWyBhdHRyaWJ1dGVOYW1lIF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IG5leHRFbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBza2lwcGVkRHVlVG9DeWNsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gTWFyayB0aGlzIHBhdGggYXMgdmlzaXRlZFxuICAgICAgICAgICAgdmlzaXRlZFBhdGhzLmFkZChuZXdQYXRoKTtcblxuICAgICAgICAgICAgLy8gUmVjdXJzZSB0byB0aGUgcmVsYXRlZCBlbnRpdHkncyBzY2hlbWFcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lPEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4obmV4dEVudGl0eU5hbWUpO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCB0aGUgXCJtZXRhXCIgb2JqZWN0IHRoYXQgd2Ugc3RvcmVcbiAgICAgICAgICAgIGNvbnN0IG1ldGE6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbiA9IHtcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICByZWxhdGlvblR5cGU6IHJlbGF0aW9uTWV0YS50eXBlLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzOiBpc0Z1bmN0aW9uKHJlbGF0aW9uTWV0YS5pZGVudGlmaWVycylcbiAgICAgICAgICAgICAgICAgICAgPyByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMoKVxuICAgICAgICAgICAgICAgICAgICA6IHJlbGF0aW9uTWV0YS5pZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiB7fSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBjb25zdCBwYXRoU2VsZWN0aW9uQXR0cmlidXRlcyA9IGlzT2JqZWN0KGF0dFZhbCkgPyBhdHRWYWwuYXR0cmlidXRlcyA6IHVuZGVmaW5lZDsgLy8gcHJvdmlkZWQgYnkgdGhlIHVzZXIgXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvblNlbGVjdGlvbkF0dHJpYnV0ZXMgPSByZWxhdGlvbk1ldGEuYXR0cmlidXRlczsgLy8gZGVmaW5lZCBpbiB0aGUgcmVsYXRpb24gZGVmaW5pdGlvblxuICAgICAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eURlZmF1bHRTZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRlZEVudGl0eVNlcnZpY2UuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpOyAvLyBhdXRvIGdlbiBieSBmcmFtZXdvcmtcblxuICAgICAgICAgICAgLy8gUmVjdXJzZSB0byBleHBhbmQgY2hpbGQncyByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICBtZXRhLmF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMoXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNjaGVtYSxcbiAgICAgICAgICAgICAgICAocGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgfHwgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcykgYXMgYW55LFxuICAgICAgICAgICAgICAgIG5leHRFbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHZpc2l0ZWRQYXRocyxcbiAgICAgICAgICAgICAgICBtYXhEZXB0aCAtIDFcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGluZmVycmVkWyBhdHRyaWJ1dGVOYW1lIF0gPSBtZXRhO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgdGhpcyBwYXRoIHNvIHNpYmxpbmdzIGNhbiBhbHNvIGV4cGFuZCBpdCBpZiBuZWVkZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5kZWxldGUobmV3UGF0aCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBpbmZlcnJlZDtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgc2VhcmNoKHF1ZXJ5OiBFbnRpdHlTZWFyY2hRdWVyeTxTPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghcXVlcnkuc2VsZWN0KSB7XG4gICAgICAgICAgICAvLyAqIE5vdGU6IHdlIGV4cGVjdCBhbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXNcbiAgICAgICAgICAgIHF1ZXJ5LnNlbGVjdCA9IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCkgYXMgYW55O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlLnNlYXJjaChxdWVyeSwgdW5kZWZpbmVkLCBjdHgpO1xuICAgIH1cbn1cblxuY29uc3QgZW50aXR5QXR0cmlidXRlTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlJyk7XG5cbmV4cG9ydCBmdW5jdGlvbiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGF0dElkOiBzdHJpbmcsIGF0dDogRW50aXR5QXR0cmlidXRlKTogUGFydGlhbDxFbnRpdHlBdHRyaWJ1dGU+ICYge1xuICAgIGlkOiBzdHJpbmcsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXVxufSB7XG5cbiAgICBjb25zdCB7IG5hbWUsIHZhbGlkYXRpb25zLCByZXF1aXJlZCwgcmVsYXRpb24sIGRlZmF1bHQ6IGRlZmF1bHRWYWx1ZSwgZ2V0OiBfZ2V0dGVyLCBzZXQ6IF9zZXR0ZXIsIHdhdGNoLCAuLi5yZXN0TWV0YSB9ID0gYXR0O1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSwgLi4ucmVzdFJlbGF0aW9uIH0gPSByZWxhdGlvbiB8fCB7fTtcblxuICAgIGNvbnN0IHJlbGF0aW9uTWV0YSA9IHJlbGF0ZWRFbnRpdHlOYW1lID8geyAuLi5yZXN0UmVsYXRpb24sIGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lIH0gOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCB7IGl0ZW1zLCB0eXBlLCBwcm9wZXJ0aWVzLCBhZGROZXdPcHRpb24sIGFkZE5ld09wdGlvbkNvbmZpZywgZmllbGRUeXBlOiBleHBsaWNpdEZpZWxkVHlwZSwgb3B0aW9ucywgLi4ucmVzdFJlc3RNZXRhIH0gPSByZXN0TWV0YSBhcyBhbnk7XG5cbiAgICAvLyBJbmZlciBmaWVsZFR5cGUgZnJvbSB0eXBlIGlmIG5vdCBleHBsaWNpdGx5IHByb3ZpZGVkXG4gICAgbGV0IGluZmVycmVkRmllbGRUeXBlOiBzdHJpbmcgfCB1bmRlZmluZWQgPSBleHBsaWNpdEZpZWxkVHlwZTtcbiAgICBpZiAoIWluZmVycmVkRmllbGRUeXBlICYmIHR5cGUpIHtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnYm9vbGVhbic7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ251bWJlcic7XG4gICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheSh0eXBlKSkge1xuICAgICAgICAgICAgLy8gRW51bSB0eXBlIGxpa2UgWydhY3RpdmUnLCAnaW5hY3RpdmUnXVxuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnc2VsZWN0JztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJyAmJiBvcHRpb25zICYmIEFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgb3B0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBTdHJpbmcgd2l0aCBvcHRpb25zIGlzIGEgc2VsZWN0XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdzZWxlY3QnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdhbnknKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdqc29uJztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnbWFwJykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnbWFwJztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2xpc3QnO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZvciBkYXRlIGZpZWxkcywgY2hlY2sgYXR0cmlidXRlIG5hbWUgYXMgaGludFxuICAgICAgICBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgY29uc3QgbG93ZXJBdHRJZCA9IGF0dElkLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICBpZiAobG93ZXJBdHRJZC5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyQXR0SWQgPT09ICdjcmVhdGVkYXQnIHx8IGxvd2VyQXR0SWQgPT09ICd1cGRhdGVkYXQnIHx8IGxvd2VyQXR0SWQgPT09ICdkZWxldGVkYXQnKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnZGF0ZXRpbWUnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZW50aXR5QXR0cmlidXRlTG9nZ2VyLmRlYnVnKGBpbmZlcnJlZEZpZWxkVHlwZTogJHtpbmZlcnJlZEZpZWxkVHlwZX0gZm9yIGVudGl0eSBhdHRyaWJ1dGUgXCIke2F0dElkfVwiIHdpdGggdHlwZSBcIiR7dHlwZW9mIHR5cGUgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkodHlwZSkgOiB0eXBlfVwiYCk7XG4gICAgfVxuXG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnJlc3RSZXN0TWV0YSxcbiAgICAgICAgdHlwZSxcbiAgICAgICAgaWQ6IGF0dElkLFxuICAgICAgICBuYW1lOiBuYW1lIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUoYXR0SWQpLFxuICAgICAgICByZWxhdGlvbjogcmVsYXRpb25NZXRhIGFzIGFueSxcbiAgICAgICAgZGVmYXVsdFZhbHVlLFxuICAgICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvbnMgfHwgcmVxdWlyZWQgPyBbICdyZXF1aXJlZCcgXSA6IFtdLFxuICAgICAgICBpc1Zpc2libGU6ICEoJ2lzVmlzaWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNWaXNpYmxlLFxuICAgICAgICBpc0VkaXRhYmxlOiAhKCdpc0VkaXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0VkaXRhYmxlLFxuICAgICAgICBpc0xpc3RhYmxlOiAhKCdpc0xpc3RhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0xpc3RhYmxlLFxuICAgICAgICBpc0NyZWF0YWJsZTogISgnaXNDcmVhdGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzQ3JlYXRhYmxlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6ICEoJ2lzRmlsdGVyYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNGaWx0ZXJhYmxlLFxuICAgICAgICBpc1NlYXJjaGFibGU6ICEoJ2lzU2VhcmNoYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNTZWFyY2hhYmxlLFxuICAgIH1cblxuICAgIC8vIEFkZCBpbmZlcnJlZCBvciBleHBsaWNpdCBmaWVsZFR5cGVcbiAgICBpZiAoaW5mZXJyZWRGaWVsZFR5cGUpIHtcbiAgICAgICAgZm9ybWF0dGVkLmZpZWxkVHlwZSA9IGluZmVycmVkRmllbGRUeXBlO1xuICAgIH0gZWxzZSBpZiAoIWV4cGxpY2l0RmllbGRUeXBlICYmIHR5cGUgJiYgdHlwZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgLy8gTG9nIHdhcm5pbmcgZm9yIG5vbi1zdHJpbmcgdHlwZXMgd2UgY291bGRuJ3QgaW5mZXJcbiAgICAgICAgZW50aXR5QXR0cmlidXRlTG9nZ2VyLndhcm4oYOKaoO+4jyBDb3VsZCBub3QgaW5mZXIgZmllbGRUeXBlIGZvciBhdHRyaWJ1dGUgXCIke2F0dElkfVwiIHdpdGggdHlwZSBcIiR7dHlwZW9mIHR5cGUgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkodHlwZSkgOiB0eXBlfVwiLiBDb25zaWRlciBhZGRpbmcgZXhwbGljaXQgZmllbGRUeXBlLmApO1xuICAgIH1cbiAgICBcbiAgICAvLyBBZGQgb3B0aW9ucyBiYWNrIGlmIHRoZXkgZXhpc3RcbiAgICBpZiAob3B0aW9ucykge1xuICAgICAgICBmb3JtYXR0ZWQub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgfVxuXG4gICAgLy8gUGFzcyB0aHJvdWdoIGJvdGggb2xkIGFuZCBuZXcgYWRkTmV3T3B0aW9uIGZvcm1hdHNcbiAgICBpZiAoYWRkTmV3T3B0aW9uQ29uZmlnKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IGFkZE5ld09wdGlvbkNvbmZpZztcbiAgICB9XG4gICAgaWYgKGFkZE5ld09wdGlvbikge1xuICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb24nIF0gPSBhZGROZXdPcHRpb247XG4gICAgfVxuXG4gICAgLy9cbiAgICAvLyAqKiBtYWtlIHN1cmUgdG8gbm90IG92ZXJyaWRlIHRoZSBpbm5lciBmaWVsZHMgb2YgYXR0cmlidXRlcyBsaWtlIGBsaXN0LVtpdGVtc10tW21hcF0tcHJvcGVydGllc2AgKipcbiAgICAvL1xuICAgIGlmICh0eXBlID09PSAnbWFwJykge1xuICAgICAgICBmb3JtYXR0ZWRbICdwcm9wZXJ0aWVzJyBdID0gT2JqZWN0LmVudHJpZXM8YW55Pihwcm9wZXJ0aWVzKS5tYXAoKFsgaywgdiBdKSA9PiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGssIHYpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdsaXN0JyAmJiBpdGVtcy50eXBlID09PSAnbWFwJykge1xuICAgICAgICBmb3JtYXR0ZWRbICdpdGVtcycgXSA9IHtcbiAgICAgICAgICAgIC4uLml0ZW1zLFxuICAgICAgICAgICAgcHJvcGVydGllczogT2JqZWN0LmVudHJpZXM8YW55PihpdGVtcy5wcm9wZXJ0aWVzKS5tYXAoKFsgaywgdiBdKSA9PiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGssIHYpKVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IGZvciBzZXQsIGVudW0sIGFuZCBjdXN0b20tdHlwZXNcblxuICAgIHJldHVybiBmb3JtYXR0ZWRcbn1cblxuZXhwb3J0IHR5cGUgVElPU2NoZW1hQXR0cmlidXRlID0gUmV0dXJuVHlwZTx0eXBlb2YgZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZT47XG5leHBvcnQgdHlwZSBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gTWFwPGtleW9mIFNbICdhdHRyaWJ1dGVzJyBdLCBUSU9TY2hlbWFBdHRyaWJ1dGU+O1xuXG4vKipcbiAqIENyZWF0ZXMgYW4gYWNjZXNzIHBhdHRlcm5zIHNjaGVtYSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgZW50aXR5IHNjaGVtYS5cbiAqIEBwYXJhbSBzY2hlbWEgVGhlIGVudGl0eSBzY2hlbWEuXG4gKiBAcmV0dXJucyBBIG1hcCBvZiBhY2Nlc3MgcGF0dGVybnMsIHdoZXJlIHRoZSBrZXlzIGFyZSB0aGUgaW5kZXggbmFtZXMgYW5kIHRoZSB2YWx1ZXMgYXJlIG1hcHMgb2YgYXR0cmlidXRlIG5hbWVzIGFuZCB0aGVpciBjb3JyZXNwb25kaW5nIHNjaGVtYSBhdHRyaWJ1dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHNjaGVtYTogUykge1xuICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbmV3IE1hcDxrZXlvZiBTWyAnaW5kZXhlcycgXSwgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPj4oKTtcblxuICAgIGZvciAoY29uc3QgaW5kZXhOYW1lIGluIHNjaGVtYS5pbmRleGVzKSB7XG4gICAgICAgIGNvbnN0IGluZGV4QXR0cmlidXRlczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPiA9IG5ldyBNYXAoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGlkeFBrQXR0IG9mIHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXS5way5jb21wb3NpdGUpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBpZHhQa0F0dCBdO1xuICAgICAgICAgICAgaW5kZXhBdHRyaWJ1dGVzLnNldChpZHhQa0F0dCwge1xuICAgICAgICAgICAgICAgIC4uLmVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaWR4UGtBdHQsIHsgLi4uYXR0LCByZXF1aXJlZDogdHJ1ZSB9KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IGlkeFNrQXR0IG9mIHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXS5zaz8uY29tcG9zaXRlID8/IFtdKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgaWR4U2tBdHQgXTtcbiAgICAgICAgICAgIGluZGV4QXR0cmlidXRlcy5zZXQoaWR4U2tBdHQsIHtcbiAgICAgICAgICAgICAgICAuLi5lbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGlkeFNrQXR0LCB7IC4uLmF0dCwgcmVxdWlyZWQ6IHRydWUgfSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgYWNjZXNzUGF0dGVybnMuc2V0KGluZGV4TmFtZSwgaW5kZXhBdHRyaWJ1dGVzKTtcbiAgICB9XG5cbiAgICAvLyBtYWtlIHN1cmUgdGhlcmUncyBhIHByaW1hcnkgYWNjZXNzIHBhdHRlcm47XG4gICAgaWYgKCFhY2Nlc3NQYXR0ZXJucy5oYXMoJ3ByaW1hcnknKSkge1xuICAgICAgICBhY2Nlc3NQYXR0ZXJucy5zZXQoJ3ByaW1hcnknLCBhY2Nlc3NQYXR0ZXJucy52YWx1ZXMoKS5uZXh0KCkudmFsdWUhKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYWNjZXNzUGF0dGVybnM7XG59XG4iXX0=