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
        return await searchService.transformDocumentForIndexing(entity);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBOEJBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQTIzREQsZ0ZBaUdDO0FBVUQsd0VBNkJDO0FBN2pFRCw4QkFBb0M7QUFPcEMsd0NBQTBDO0FBQzFDLGlEQUE0RTtBQUU1RSx5REFBbUU7QUFDbkUsb0NBQWlOO0FBQ2pOLCtDQUFzRDtBQUN0RCxpREFBc0w7QUFDdEwsdUVBQWtFO0FBQ2xFLHFDQUFnRTtBQUNoRSxtQ0FBNEg7QUFDNUgsc0NBQTZEO0FBWTdELFNBQWdCLFlBQVksQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQ25GLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxTQUFnQixtQkFBbUIsQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQzFGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDbkQsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsS0FBSyxJQUFJLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFDMUYsT0FBTyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssU0FBUyxDQUFDO0FBQzFELENBQUM7QUFFRCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFtQyxFQUFFLElBQTBCO0lBRTlGLElBQUksY0FBYyxHQUFHLFNBQVMsSUFBQSxrQkFBVSxFQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7SUFDMUQsSUFBSSxjQUFjLElBQUksTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2pDLE9BQU8sTUFBTSxDQUFD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RSxDQUFDO2FBQzlFLENBQUMsQ0FBQztRQUNQLENBQUM7UUFFRCxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxlQUFlLENBQUMsQ0FBQztJQUNuRCxDQUFDO0lBRUQsOENBQThDO0lBQzlDLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDakMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsY0FBYyxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQU0sQ0FBQyxDQUFDO0lBQ3pFLENBQUM7SUFFRCxPQUFPLGNBQWMsQ0FBQztBQUMxQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tIFwiLi4vZGlcIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5SW5wdXRWYWxpZGF0aW9ucywgRW50aXR5VmFsaWRhdGlvbnMgfSBmcm9tIFwiLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHR5cGUgeyBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEsIEVudGl0eUF0dHJpYnV0ZSwgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYSwgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWEsIEVudGl0eVR5cGVGcm9tU2NoZW1hIGFzIEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYSwgRW50aXR5U2NoZW1hLCBIeWRyYXRlT3B0aW9uRm9yRW50aXR5LCBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24sIEh5ZHJhdGVPcHRpb25zTWFwRm9yRW50aXR5LCBSZWxhdGlvbklkZW50aWZpZXIsIFNwZWNpYWxBdHRyaWJ1dGVUeXBlLCBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSwgVXBzZXJ0RW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hIH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5RmlsdGVyQ3JpdGVyaWEsIEVudGl0eVF1ZXJ5LCBFbnRpdHlTZWxlY3Rpb25zLCBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyB9IGZyb20gXCIuL3F1ZXJ5LXR5cGVzXCI7XG5cbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IERlcElkZW50aWZpZXIsIElESUNvbnRhaW5lciB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgQmFzZVNlYXJjaFNlcnZpY2UsIEVudGl0eVNlYXJjaFNlcnZpY2UgfSBmcm9tICcuLi9zZWFyY2gvc2VydmljZXMnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoUXVlcnkgfSBmcm9tICcuLi9zZWFyY2gvdHlwZXMnO1xuaW1wb3J0IHsgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaC9zZWFyY2gtdXRpbHMnO1xuaW1wb3J0IHsgSnNvblNlcmlhbGl6ZXIsIGdldFZhbHVlQnlQYXRoLCBpc0FycmF5LCBpc0Jvb2xlYW4sIGlzQ2xhc3NDb25zdHJ1Y3RvciwgaXNFbXB0eSwgaXNFbXB0eU9iamVjdERlZXAsIGlzRnVuY3Rpb24sIGlzT2JqZWN0LCBpc1N0cmluZywgcGFzY2FsQ2FzZSwgcGlja0tleXMsIHRvSHVtYW5SZWFkYWJsZU5hbWUsIHRvU2x1ZyB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgY3JlYXRlRWxlY3Ryb0RCRW50aXR5IH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IFVwZGF0ZUVudGl0eU9wZXJhdG9ycywgY3JlYXRlRW50aXR5LCBkZWxldGVFbnRpdHksIGRlbGV0ZUJhdGNoRW50aXR5LCBnZXRCYXRjaEVudGl0eSwgZ2V0RW50aXR5LCBsaXN0RW50aXR5LCBxdWVyeUVudGl0eSwgdXBkYXRlRW50aXR5LCB1cHNlcnRFbnRpdHkgfSBmcm9tIFwiLi9jcnVkLXNlcnZpY2VcIjtcbmltcG9ydCB7IEVudGl0eVNjaGVtYVZhbGlkYXRvciB9IGZyb20gXCIuL2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yXCI7XG5pbXBvcnQgeyBEYXRhYmFzZUVycm9yLCBFbnRpdHlWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuL2Vycm9ycyc7XG5pbXBvcnQgeyBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWEsIG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzLCBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSBcIi4vcXVlcnlcIjtcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IsIFNlcnZlckVycm9yIH0gZnJvbSBcIi4uL2Vycm9yc1wiO1xuXG5leHBvcnQgdHlwZSBFeHRyYWN0RW50aXR5SWRlbnRpZmllcnNDb250ZXh0ID0ge1xuICAgIC8vIHRlbmFudElkOiBzdHJpbmcsIFxuICAgIGZvckFjY2Vzc1BhdHRlcm4/OiBzdHJpbmdcbn1cblxudHlwZSBHZXRPcHRpb25zPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sXG4gICAgYXR0cmlidXRlcz86IEVudGl0eVNlbGVjdGlvbnM8Uz5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc0F0dHJpYnV0ZShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiwgYXR0cmlidXRlTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIChhdHRyaWJ1dGVOYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGF0dHJpYnV0ZSA9IHNjaGVtYS5hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdO1xuICAgIHJldHVybiAhIShhdHRyaWJ1dGUgJiYgYXR0cmlidXRlLnJlYWRPbmx5ID09PSB0cnVlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc0F0dHJpYnV0ZUJ5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBzcGVjOiBTcGVjaWFsQXR0cmlidXRlVHlwZSkge1xuICAgIHJldHVybiBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCBzcGVjKSAhPT0gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBzcGVjOiBTcGVjaWFsQXR0cmlidXRlVHlwZSkge1xuXG4gICAgbGV0IHNwZWNBdHRNZXRhS2V5ID0gYGVudGl0eSR7cGFzY2FsQ2FzZShzcGVjKX1BdHRyaWJ1dGVgO1xuICAgIGlmIChzcGVjQXR0TWV0YUtleSBpbiBzY2hlbWEubW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYS5tb2RlbFsgc3BlY0F0dE1ldGFLZXkgYXMga2V5b2YgdHlwZW9mIHNjaGVtYS5tb2RlbCBdIGFzIHN0cmluZztcbiAgICB9XG5cbiAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgYCR7c2NoZW1hLm1vZGVsLmVudGl0eX0ke3Bhc2NhbENhc2Uoc3BlYyl9YCkpIHtcbiAgICAgICAgcmV0dXJuIGAke3NjaGVtYS5tb2RlbC5lbnRpdHl9JHtwYXNjYWxDYXNlKHNwZWMpfWA7XG4gICAgfVxuXG4gICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsIHNwZWMpKSB7XG4gICAgICAgIHJldHVybiBzcGVjO1xuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlRW50aXR5U2VydmljZTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG5cbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoYEJhc2VFbnRpdHlTZXJ2aWNlOiR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuXG4gICAgcHJvdGVjdGVkIGVudGl0eVJlcG9zaXRvcnk/OiBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWE8Uz47XG4gICAgcHJvdGVjdGVkIGVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYT86IFJldHVyblR5cGU8dHlwZW9mIHRoaXMubWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxTPj47XG5cbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcmVhZG9ubHkgc2NoZW1hOiBTLFxuICAgICAgICBwcm90ZWN0ZWQgcmVhZG9ubHkgZW50aXR5Q29uZmlndXJhdGlvbnM6IEVudGl0eUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIHByb3RlY3RlZCByZWFkb25seSBkaUNvbnRhaW5lcjogSURJQ29udGFpbmVyID0gRElDb250YWluZXIuUk9PVCxcbiAgICApIHsgfVxuXG4gICAgcHJvdGVjdGVkIGdldFRhYmxlTmFtZSgpOiBzdHJpbmcge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnMudGFibGUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKGBUYWJsZSBuYW1lIGlzIHJlcXVpcmVkIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnMudGFibGU7XG4gICAgfVxuXG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5U2VhcmNoQ29uZmlnKF9jdHg/OiBFeGVjdXRpb25Db250ZXh0PGFueT4pIHtcblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHNjaGVtYS5tb2RlbC5zZWFyY2ggfHwge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGluZGV4Q29uZmlnOiB7fVxuICAgICAgICB9O1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5zZXJ2aWNlQ2xhc3MgPSBzZWFyY2hDb25maWcuc2VydmljZUNsYXNzIHx8IEVudGl0eVNlYXJjaFNlcnZpY2U7XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcuaW5kZXhDb25maWcpIHtcbiAgICAgICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZyA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLmluZGV4TmFtZSA9IHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5pbmRleE5hbWUgfHwgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBzY2hlbWEubW9kZWwuZW50aXR5LFxuICAgICAgICAgICAgdGFibGVOYW1lOiB0aGlzLmdldFRhYmxlTmFtZSgpLFxuICAgICAgICB9KTtcblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcucHJpbWFyeUtleSA9IHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5wcmltYXJ5S2V5IHx8IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG5cbiAgICAgICAgY29uc3QgZW50aXR5U2VhcmNoYWJsZUF0dHJpYnV0ZXMgPSB0aGlzLmdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpO1xuICAgICAgICBjb25zdCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyA9IHRoaXMuZ2V0RmlsdGVyYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzID0ge1xuICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncyB8fCB7fSksXG4gICAgICAgICAgICBzZWFyY2hhYmxlQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3M/LnNlYXJjaGFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eVNlYXJjaGFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBmaWx0ZXJhYmxlQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3M/LmZpbHRlcmFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBzb3J0YWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5zb3J0YWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzZWFyY2hDb25maWc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIGlmIHNlYXJjaCBpcyBlbmFibGVkIGZvciB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRydWUgaWYgc2VhcmNoIGlzIGVuYWJsZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgaXNTZWFyY2hFbmFibGVkKCkge1xuICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldEVudGl0eVNlYXJjaENvbmZpZygpO1xuICAgICAgICByZXR1cm4gQm9vbGVhbihzZWFyY2hDb25maWc/LmVuYWJsZWQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldHMgdGhlIHNlYXJjaCBzZXJ2aWNlIGZvciB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBzZWFyY2ggc2VydmljZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0U2VhcmNoU2VydmljZSgpOiBFbnRpdHlTZWFyY2hTZXJ2aWNlPFM+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCk7XG5cbiAgICAgICAgICAgIC8vIFNraXAgc2VhcmNoIGxvZ2ljIGlmIHNlYXJjaCBpcyBub3QgZW5hYmxlZFxuICAgICAgICAgICAgaWYgKCFzZWFyY2hDb25maWc/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBpcyBub3QgZW5hYmxlZCBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9LmApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBzZWFyY2ggY29uZmlndXJhdGlvbiBpZiBwcmVzZW50XG4gICAgICAgICAgICBpZiAoc2VhcmNoQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgdGhpcy52YWxpZGF0ZVNlYXJjaENvbmZpZyhzZWFyY2hDb25maWcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzID0gc2VhcmNoQ29uZmlnPy5zZXJ2aWNlQ2xhc3M7XG5cbiAgICAgICAgICAgIC8vIENhc2UgMTogREkgQ29udGFpbmVyIGhhcyB0aGUgc2VydmljZVxuICAgICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgJiYgdGhpcy5kaUNvbnRhaW5lci5oYXMoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyBEZXBJZGVudGlmaWVyPEVudGl0eVNlYXJjaFNlcnZpY2U8YW55Pj4pKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZTxFbnRpdHlTZWFyY2hTZXJ2aWNlPFM+PihzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGFzIERlcElkZW50aWZpZXI8RW50aXR5U2VhcmNoU2VydmljZTxTPj4pO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcmVzb2x2ZSBzZWFyY2ggc2VydmljZSBmcm9tIGNvbnRhaW5lcjonLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZXNvbHZlIHNlYXJjaCBzZXJ2aWNlIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYXNlIDI6IFNlcnZpY2UgaW5zdGFuY2UgcHJvdmlkZWRcbiAgICAgICAgICAgIGlmIChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGluc3RhbmNlb2YgQmFzZVNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2FzZSAzOiBTZXJ2aWNlIGNsYXNzIHByb3ZpZGVkXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgaXNDbGFzc0NvbnN0cnVjdG9yKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MpICYmXG4gICAgICAgICAgICAgICAgKFxuICAgICAgICAgICAgICAgICAgICBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzID09PSBFbnRpdHlTZWFyY2hTZXJ2aWNlXG4gICAgICAgICAgICAgICAgICAgIHx8XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgRW50aXR5U2VhcmNoU2VydmljZVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IHRvIGNvbmZpZ3VyZSB0aGlzIHdpdGhvdXQgbmVlZGluZyB0byB1c2UgdGhlIERJXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEVuZ2luZSA9IHRoaXMuZGlDb250YWluZXIucmVzb2x2ZVNlYXJjaEVuZ2luZSgpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXNlYXJjaEVuZ2luZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggZW5naW5lIG5vdCBmb3VuZCBpbiBjb250YWluZXInKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGFzIHR5cGVvZiBFbnRpdHlTZWFyY2hTZXJ2aWNlKShcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWFyY2hFbmdpbmUsXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBpbnN0YW50aWF0ZSBzZWFyY2ggc2VydmljZTonLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgc2VhcmNoIHNlcnZpY2UgaW5zdGFuY2UgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdmFsaWQgc2VhcmNoLXNlcnZpY2UtY29uZmlndXJhdGlvbiBmb3VuZCBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Vycm9yIGluIGdldFNlYXJjaFNlcnZpY2U6JywgZXJyKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2UgaW5pdGlhbGl6YXRpb24gZmFpbGVkIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHZhbGlkYXRlU2VhcmNoQ29uZmlnKHNlYXJjaENvbmZpZzogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnbW9kZWwnIF1bICdzZWFyY2gnIF0pIHtcblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcuaW5kZXhDb25maWcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gbXVzdCBpbmNsdWRlIGEgY29uZmlnIG9iamVjdCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBpbmRleENvbmZpZzogY29uZmlnIH0gPSBzZWFyY2hDb25maWc7XG5cbiAgICAgICAgaWYgKCFjb25maWcuaW5kZXhOYW1lKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIG11c3Qgc3BlY2lmeSBhbiBpbmRleE5hbWUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbGlkYXRlIHNlYXJjaGFibGUgYXR0cmlidXRlcyBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbmZpZy5zZXR0aW5ncz8uc2VhcmNoYWJsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gY29uZmlnLnNldHRpbmdzLnNlYXJjaGFibGVBdHRyaWJ1dGVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICAoYXR0cjogc3RyaW5nKSA9PiAhaGFzQXR0cmlidXRlKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIGF0dHIpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VhcmNoYWJsZSBhdHRyaWJ1dGVzOiAke2ludmFsaWRBdHRyaWJ1dGVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBmaWx0ZXJhYmxlIGF0dHJpYnV0ZXMgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb25maWcuc2V0dGluZ3M/LmZpbHRlcmFibGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IGNvbmZpZy5zZXR0aW5ncy5maWx0ZXJhYmxlQXR0cmlidXRlcy5maWx0ZXIoXG4gICAgICAgICAgICAgICAgKGF0dHI6IHN0cmluZykgPT4gIWhhc0F0dHJpYnV0ZSh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBhdHRyKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZpbHRlcmFibGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5OiBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxTPik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIHJldHVybiBhd2FpdCBzZWFyY2hTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgdmFsaWRhdGVFbnRpdHlTY2hlbWEoKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IodGhpcy5kaUNvbnRhaW5lcik7XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShcbiAgICAgICAgICAgIHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksXG4gICAgICAgICAgICB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTZXJ2aWNlPEJhc2VFbnRpdHlTZXJ2aWNlPFQ+PihyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLmhhc0VudGl0eVNlcnZpY2UocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIGdldEVudGl0eVNjaGVtYUJ5RW50aXR5TmFtZTxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTY2hlbWE8VD4ocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNjaGVtYUJ5RW50aXR5TmFtZShyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLmhhc0VudGl0eVNjaGVtYShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0cmFjdHMgZW50aXR5IGlkZW50aWZpZXJzIGZyb20gdGhlIGlucHV0IG9iamVjdCBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgY29udGV4dCB0byBmdWxmaWxsIGFuIGluZGV4LlxuICAgICAqIGUuZy4gZW50aXR5SWQsIHRlbmFudElkLCBwYXJ0aXRpb24ta2V5cy4uLi4gZXRjXG4gICAgICogaXQgaXMgdXNlZCBieSB0aGUgYEJhc2VFbnRpdHlTZXJ2aWNlYCB0byBmaW5kIHRoZSByaWdodCBlbnRpdHkgZm9yIGBnZXRgL2B1cGRhdGVgL2BkZWxldGVgIG9wZXJhdGlvbnNcbiAgICAgKiBcbiAgICAgKiBAdGVtcGxhdGUgUyAtIFRoZSB0eXBlIG9mIHRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBpbnB1dCAtIFRoZSBpbnB1dCBvYmplY3QgZnJvbSB3aGljaCB0byBleHRyYWN0IHRoZSBpZGVudGlmaWVycy5cbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBjb250YWluaW5nIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24gZm9yIGV4dHJhY3Rpb24uXG4gICAgICogQHBhcmFtIGNvbnRleHQuZm9yQWNjZXNzUGF0dGVybiAtIFRoZSBhY2Nlc3MgcGF0dGVybiBmb3Igd2hpY2ggdG8gZXh0cmFjdCB0aGUgaWRlbnRpZmllcnMuXG4gICAgICogQHJldHVybnMgVGhlIGV4dHJhY3RlZCBlbnRpdHkgaWRlbnRpZmllcnMuXG4gICAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBpbnB1dCBpcyBtaXNzaW5nIG9yIG5vdCBhbiBvYmplY3QuXG4gICAgICogXG4gICAgICogZS5nLiBcbiAgICAgKiBJTiAgID09PiBgUmVxdWVzdGAgb2JqZWN0IHdpdGggaGVhZGVycywgYm9keSwgYXV0aC1jb250ZXh0IGV0Y1xuICAgICAqIE9VVCAgPT0+IHsgdGVuYW50SWQ6IHh4eCwgZW1haWw6IHh4eEB5eXkuY29tLCBzb21lLXBhcnRpdGlvbi1rZXk6IHh4LXl5LXp6IH1cbiAgICAgKlxuICAgICAqL1xuICAgIGV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhcbiAgICAgICAgaW5wdXQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+PixcbiAgICAgICAgY29udGV4dDogRXh0cmFjdEVudGl0eUlkZW50aWZpZXJzQ29udGV4dCA9IHtcbiAgICAgICAgICAgIC8vIHRlbmFudElkOiAneHh4LXl5eS16enonXG4gICAgICAgIH1cbiAgICApOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4ge1xuXG4gICAgICAgIGlmICghaW5wdXQgfHwgdHlwZW9mIGlucHV0ICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnB1dCBpcyByZXF1aXJlZCBhbmQgbXVzdCBiZSBhbiBvYmplY3QgY29udGFpbmluZyBlbnRpdHktaWRlbnRpZmllcnMgb3IgYW4gYXJyYXkgb2Ygb2JqZWN0cyBjb250YWluaW5nIGVudGl0eS1pZGVudGlmaWVycycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaXNCYXRjaElucHV0ID0gaXNBcnJheShpbnB1dCk7XG5cbiAgICAgICAgY29uc3QgaW5wdXRzID0gaXNCYXRjaElucHV0ID8gaW5wdXQgOiBbIGlucHV0IF07XG5cbiAgICAgICAgLy8gVE9ETzogdGVuYW50IGxvZ2ljXG4gICAgICAgIC8vIGlkZW50aWZpZXJzWyd0ZW5hbnRJZCddID0gaW5wdXQudGVuYW50SWQgfHwgY29udGV4dC50ZW5hbnRJZDtcblxuICAgICAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYSh0aGlzLmdldEVudGl0eVNjaGVtYSgpKTtcblxuICAgICAgICBjb25zdCBpZGVudGlmaWVyQXR0cmlidXRlcyA9IG5ldyBTZXQ8eyBuYW1lOiBzdHJpbmcsIHJlcXVpcmVkOiBib29sZWFuIH0+KCk7XG4gICAgICAgIGZvciAoY29uc3QgWyBhY2Nlc3NQYXR0ZXJuTmFtZSwgYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXMgXSBvZiBhY2Nlc3NQYXR0ZXJucykge1xuICAgICAgICAgICAgaWYgKCFjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4gfHwgYWNjZXNzUGF0dGVybk5hbWUgPT0gY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuKSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBbICwgYXR0IF0gb2YgYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllckF0dHJpYnV0ZXMuYWRkKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGF0dC5pZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBhdHQucmVxdWlyZWQgPT0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwcmltYXJ5QXR0TmFtZSA9IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG5cbiAgICAgICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlucHV0cy5tYXAoaW5wdXQgPT4ge1xuICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IGFueSA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWU6IGF0dE5hbWUsIHJlcXVpcmVkIH0gb2YgaWRlbnRpZmllckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoKGF0dE5hbWUgaW4gaW5wdXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzWyBhdHROYW1lIF0gPSBpbnB1dFsgYXR0TmFtZSBdO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYXR0TmFtZSA9PSBwcmltYXJ5QXR0TmFtZSAmJiAoJ2lkJyBpbiBpbnB1dCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnNbIGF0dE5hbWUgXSA9IGlucHV0LmlkO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocmVxdWlyZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgcmVxdWlyZWQgYXR0cmlidXRlOiAke2F0dE5hbWV9IGZvciBhY2Nlc3MtcGF0dGVybjogJHtjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4gPz8gJy0tcHJpbWFyeS0tJ30gaXMgbm90IGZvdW5kIGluIGlucHV0OmAsIGlucHV0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaWRlbnRpZmllcnMgYXMgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICAgICAgfVxuICAgICAgICApO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdFeHRyYWN0aW5nIGlkZW50aWZpZXJzIGZyb20gaWRlbnRpZmllcnM6JywgaWRlbnRpZmllcnNCYXRjaCk7XG5cbiAgICAgICAgcmV0dXJuIGlzQmF0Y2hJbnB1dCA/IGlkZW50aWZpZXJzQmF0Y2ggOiBpZGVudGlmaWVyc0JhdGNoWyAwIF07XG4gICAgfTtcblxuICAgIHB1YmxpYyBnZXRFbnRpdHlOYW1lKCk6IFNbICdtb2RlbCcgXVsgJ2VudGl0eScgXSB7IHJldHVybiB0aGlzLmdldEVudGl0eVNjaGVtYSgpLm1vZGVsLmVudGl0eTsgfVxuXG4gICAgcHVibGljIGdldEVudGl0eVNjaGVtYSgpOiBTIHsgcmV0dXJuIHRoaXMuc2NoZW1hOyB9XG5cbiAgICBwdWJsaWMgZ2V0UmVwb3NpdG9yeSgpIHtcbiAgICAgICAgaWYgKCF0aGlzLmVudGl0eVJlcG9zaXRvcnkpIHtcbiAgICAgICAgICAgIGNvbnN0IHsgZW50aXR5IH0gPSBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgICAgICAgICAgICAgIHNjaGVtYTogdGhpcy5nZXRFbnRpdHlTY2hlbWEoKSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWd1cmF0aW9uczogdGhpcy5lbnRpdHlDb25maWd1cmF0aW9uc1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLmVudGl0eVJlcG9zaXRvcnkgPSBlbnRpdHkgYXMgRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZW50aXR5UmVwb3NpdG9yeSE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGxhY2Vob2xkZXIgZm9yIHRoZSBlbnRpdHkgdmFsaWRhdGlvbnM7IG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSB5b3VyIG93biB2YWxpZGF0aW9uc1xuICAgICAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBlbnRpdHkgdmFsaWRhdGlvbnMuXG4gICAgICovXG4gICAgcHVibGljIGdldEVudGl0eVZhbGlkYXRpb25zKCk6IEVudGl0eVZhbGlkYXRpb25zPFM+IHwgRW50aXR5SW5wdXRWYWxpZGF0aW9uczxTPiB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogUGxhY2Vob2xkZXIgZm9yIHRoZSBjdXN0b20gdmFsaWRhdGlvbi1lcnJvci1tZXNzYWdlczsgb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIHlvdXIgb3duIGVycm9yLW1lc3NhZ2VzLlxuICAgICAqIEByZXR1cm5zIEEgbWFwIGNvbnRhaW5pbmcgdGhlIGN1c3RvbSB2YWxpZGF0aW9uLWVycm9yLW1lc3NhZ2VzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHNcbiAgICAgKiAgcHVibGljIGFzeW5jIGdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICAgKiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoIG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCBcbiAgICAgKiAgICAgICAgICBPYmplY3QuZW50cmllcyh7IFxuICAgICAqICAgICAgICAgICAgICAndmFsaWRhdGlvbi5lbWFpbC5yZXF1aXJlZCc6ICdFbWFpbCBpcyByZXF1aXJlZCEhISEhJywgXG4gICAgICogICAgICAgICAgICAgICd2YWxpZGF0aW9uLnBhc3N3b3JkLnJlcXVpcmVkJzogJ1Bhc3N3b3JkIGlzIHJlcXVpcmVkISEhISEnXG4gICAgICogICAgICAgICAgfSlcbiAgICAgKiAgICAgICkpO1xuICAgICAqIH1cbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKSB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgaWYgKGF0dC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYXR0TmFtZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gKiBHZW5lcmF0ZXMgdGhlIGRlZmF1bHQgaW5wdXQgYW5kIG91dHB1dCBzY2hlbWFzIGZvciB2YXJpb3VzIG9wZXJhdGlvbnMgb2YgYW4gZW50aXR5LlxuICogXG4gKiBAdGVtcGxhdGUgUyAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzIC0gVGhlIHR5cGUgb2YgZW50aXR5IG9wZXJhdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBzY2hlbWEgLSBUaGUgZW50aXR5IHNjaGVtYS5cbiAqIEByZXR1cm5zIFRoZSBkZWZhdWx0IGlucHV0IGFuZCBvdXRwdXQgc2NoZW1hcyBmb3IgdGhlIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG4gICAgcHJvdGVjdGVkIG1ha2VPcHNEZWZhdWx0SU9TY2hlbWE8XG4gICAgICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgT3BzPixcbiAgICAgICAgT3BzIGV4dGVuZHMgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zID0gVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgID4oc2NoZW1hOiBTKSB7XG5cbiAgICAgICAgY29uc3QgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzID0ge1xuICAgICAgICAgICAgY3JlYXRlOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgICAgIHVwZGF0ZTogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0U2NoZW1hQXR0cmlidXRlcyA9IHtcbiAgICAgICAgICAgIGRldGFpbDogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgICAgICBsaXN0OiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBjcmVhdGUgYW5kIHVwZGF0ZVxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcblxuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZEF0dCA9IGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoYXR0TmFtZSwgYXR0KTtcblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5oaWRkZW4pIHtcbiAgICAgICAgICAgICAgICAvLyBpZiBpdCdzIG1hcmtlZCBhcyBoaWRkZW4gaXQncyBub3QgdmlzaWJsZSB0byBhbnkgb3BcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc1Zpc2libGUgfHwgZm9ybWF0dGVkQXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc0xpc3RhYmxlIHx8IGZvcm1hdHRlZEF0dC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3Quc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzQ3JlYXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNFZGl0YWJsZSkge1xuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWEoc2NoZW1hKTtcblxuICAgICAgICAvLyBpZiB0aGVyZSdzIGFuIGluZGV4IG5hbWVkIGBwcmltYXJ5YCwgdXNlIHRoYXQsIGVsc2UgZmFsbGJhY2sgdG8gZmlyc3QgaW5kZXhcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2RlbGV0ZSddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcblxuXG4gICAgICAgIC8vIGZvcihjb25zdCBhcCBvZiBhY2Nlc3NQYXR0ZXJucy5rZXlzKCkpe1xuICAgICAgICAvLyBcdGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzW2BnZXRfJHthcH1gXSA9IGFjY2Vzc1BhdHRlcm5zLmdldChhcCk7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGRlbGV0ZV8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIC8vIGNvbnN0IGlucHV0U2NoZW1hQXR0cmlidXRlczogYW55ID0ge307XHRcbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWydjcmVhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddLFxuICAgICAgICAvLyB9XG4gICAgICAgIC8vIGlucHV0U2NoZW1hQXR0cmlidXRlc1sndXBkYXRlJ10gPSB7XG4gICAgICAgIC8vIFx0J2lkZW50aWZpZXJzJzogYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddLFxuICAgICAgICAvLyBcdCdkYXRhJzogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSxcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5Jyk7XG5cbiAgICAgICAgLy8gVE9ETzogYWRkIHNjaGVtYSBmb3IgdGhlIHJlc3QgZm8gdGhlIHNlY29uZGFyeSBhY2Nlc3MtcGF0dGVybnNcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZ2V0OiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGR1cGxpY2F0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVybixcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLCAvLyBkZWZhdWx0IGZvciB0aGUgZGV0YWlsIHBhZ2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZWxldGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm5cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjcmVhdGU6IHtcbiAgICAgICAgICAgICAgICBpbnB1dDogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZSxcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdXBkYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMudXBkYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbGlzdDoge1xuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5saXN0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGRlZmF1bHQgaW5wdXQvb3V0cHV0IHNjaGVtYSBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gICAgICogXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hKSB7XG4gICAgICAgICAgICB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYSA9IHRoaXMubWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxTPih0aGlzLmdldEVudGl0eVNjaGVtYSgpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhbiBhcnJheSBvZiBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLiBVc2VkIGJ5IHRoZSBgZGV0YWlsYCBBUEkgdG8gc2VyaWFsaXplIHRoZSBlbnRpdHkuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTogRW50aXR5U2VsZWN0aW9uczxTPiB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwID0gdGhpcy5nZXRPcHNEZWZhdWx0SU9TY2hlbWEoKS5nZXQub3V0cHV0O1xuXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXM6IGFueSA9IHt9O1xuICAgICAgICBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5mb3JFYWNoKChfLCBrZXkpID0+IHtcbiAgICAgICAgICAgIC8vIGlmICghdmFsLnJlbGF0aW9uIHx8IHZhbC5yZWxhdGlvbi5oeWRyYXRlKSB7XG4gICAgICAgICAgICAvLyB9XG4gICAgICAgICAgICBhdHRyaWJ1dGVzWyBrZXkgXSA9IHRydWVcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZXMgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcblxuICAgICAgICAvLyAgcmV0dXJuIEFycmF5LmZyb20oIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSApIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhdHRyaWJ1dGUgbmFtZXMgZm9yIGxpc3RpbmcgYW5kIHNlYXJjaCBBUEkuIERlZmF1bHRzIHRvIHRoZSBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLlxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBBbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmxpc3Qub3V0cHV0O1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbShkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5rZXlzKCkpIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2guXG4gICAgICogSW5jbHVkZXMgc3RyaW5nIGZpZWxkcyBhbmQgZW51bSBmaWVsZHMgd2l0aCBzdHJpbmcgdmFsdWVzLlxuICAgICAqIEV4Y2x1ZGVzIGlkZW50aWZpZXJzLCBoaWRkZW4gZmllbGRzLCBkYXRlL2RhdGV0aW1lIGZpZWxkcywgcmVsYXRpb25zLCBhbmQgc2VsZWN0IGZpZWxkcyBieSBkZWZhdWx0LlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2hcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTogQXJyYXk8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gW107XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTa2lwIGlmIGhpZGRlbiwgaWRlbnRpZmllciwgb3IgZXhwbGljaXRseSBub3Qgc2VhcmNoYWJsZVxuICAgICAgICAgICAgaWYgKGF0dC5oaWRkZW4gfHwgYXR0LmlzSWRlbnRpZmllciB8fCBhdHQuaXNTZWFyY2hhYmxlID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBhdHRyVHlwZSA9IGF0dC50eXBlO1xuICAgICAgICAgICAgY29uc3QgZmllbGRUeXBlID0gYXR0LmZpZWxkVHlwZTtcblxuICAgICAgICAgICAgLy8gRXhjbHVkZSBkYXRlL2RhdGV0aW1lIGZpZWxkcyAodGhleSdyZSBmb3IgZmlsdGVyaW5nLCBub3QgdGV4dCBzZWFyY2gpXG4gICAgICAgICAgICBpZiAoZmllbGRUeXBlID09PSAnZGF0ZScgfHwgZmllbGRUeXBlID09PSAnZGF0ZXRpbWUnKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4Y2x1ZGUgZGF0ZS1saWtlIGZpZWxkIG5hbWVzIChjcmVhdGVkQXQsIHB1Ymxpc2hlZERhdGUsIGV0Yy4pXG4gICAgICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBhdHROYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICBpZiAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIChsb3dlck5hbWUuaW5jbHVkZXMoJ2RhdGUnKSB8fCBsb3dlck5hbWUuaW5jbHVkZXMoJ3RpbWUnKSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhjbHVkZSByZWxhdGlvbiBmaWVsZHMgKHRoZXkncmUgSURzLCBub3Qgc2VhcmNoYWJsZSB0ZXh0KVxuICAgICAgICAgICAgaWYgKCdyZWxhdGlvbicgaW4gYXR0ICYmIGF0dC5yZWxhdGlvbikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIHNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHMgd2l0aCBvcHRpb25zICh0aGV5J3JlIGZvciBmaWx0ZXJpbmcsIG5vdCBmdWxsLXRleHQgc2VhcmNoKVxuICAgICAgICAgICAgaWYgKChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0JykgJiYgXG4gICAgICAgICAgICAgICAgJ29wdGlvbnMnIGluIGF0dCAmJiBhdHQub3B0aW9ucykge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJbmNsdWRlIHNlYXJjaGFibGUgdGV4dC1iYXNlZCBmaWVsZCB0eXBlc1xuICAgICAgICAgICAgY29uc3QgaXNTZWFyY2hhYmxlVHlwZSA9IChcbiAgICAgICAgICAgICAgICAvLyBTdHJpbmcgZmllbGRzIChwcmltYXJ5IHNlYXJjaGFibGUgdHlwZSlcbiAgICAgICAgICAgICAgICAodHlwZW9mIGF0dHJUeXBlID09PSAnc3RyaW5nJyAmJiBhdHRyVHlwZSA9PT0gJ3N0cmluZycpIHx8XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gRW51bSBmaWVsZHMgY2FuIGJlIHNlYXJjaGVkIGJ5IHRoZWlyIHN0cmluZyB2YWx1ZXNcbiAgICAgICAgICAgICAgICAoQXJyYXkuaXNBcnJheShhdHRyVHlwZSkgJiYgYXR0clR5cGUubGVuZ3RoID4gMCAmJiBhdHRyVHlwZS5ldmVyeSh2ID0+IHR5cGVvZiB2ID09PSAnc3RyaW5nJykpXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBJbmNsdWRlIGlmIHNlYXJjaGFibGUgYnkgZGVmYXVsdCAoaXNTZWFyY2hhYmxlIG5vdCBleHBsaWNpdGx5IHNldCkgb3IgZXhwbGljaXRseSBlbmFibGVkXG4gICAgICAgICAgICBpZiAoaXNTZWFyY2hhYmxlVHlwZSAmJiAoISgnaXNTZWFyY2hhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc1NlYXJjaGFibGUpKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZXMucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lcztcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIHVuaXF1ZSBhdHRyaWJ1dGVzIG9mIHRoZSBlbnRpdHkuIFxuICAgICAqIERlZmF1bHRzIHRvIGFsbCBhdHRyaWJ1dGVzIHdoaWNoIGFyZSBtYXJrZWQgYXMgdW5pcXVlIG9yIGFyZSBpZGVudGlmaWVyczsgXG4gICAgICogT3IgaWYgdGhleSBhcmUgcGFydCBvZiBhIGNvbXBvc2l0ZSBwcmltYXJ5IGtleSB3aGVyZSB0aGUgY29tcG9zaXRlIGxlbmd0aCBpcyAxLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxFbnRpdHlBdHRyaWJ1dGU+fSB1bmlxdWUgYXR0cmlidXRlcyBvZiB0aGUgZW50aXR5XG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0VW5pcXVlQXR0cmlidXRlcygpOiBBcnJheTxFbnRpdHlBdHRyaWJ1dGU+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcblxuICAgICAgICAgICAgbGV0IGlzVW5pcXVlID0gKCdpc1VuaXF1ZScgaW4gYXR0KSA/IGF0dC5pc1VuaXF1ZSA6IGF0dC5pc0lkZW50aWZpZXI7XG5cbiAgICAgICAgICAgIGlmIChpc1VuaXF1ZSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIC4uLmF0dCxcbiAgICAgICAgICAgICAgICAgICAgaXNVbmlxdWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGF0dE5hbWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0aGF0IGNhbiBiZSB1c2VkIGZvciBmaWx0ZXJpbmcgdGhlIHJlY29yZHMuXG4gICAgICogSW5jbHVkZXMgYWxsIGZpbHRlcmFibGUgZmllbGQgdHlwZXM6IHN0cmluZywgbnVtYmVyLCBib29sZWFuLCBlbnVtcywgZGF0ZXMsIGFuZCByZWxhdGlvbnMuXG4gICAgICogXG4gICAgICogVGhpcyBtYXRjaGVzIHRoZSBjb21wcmVoZW5zaXZlIGZpbHRlcmluZyBzdXBwb3J0IGluIHRoZSBVSSBmaWx0ZXIgZ2VuZXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gYXR0cmlidXRlIG5hbWVzIHRvIGJlIHVzZWQgZm9yIGZpbHRlcmluZ1xuICAgICovXG4gICAgcHVibGljIGdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFNraXAgaWYgZXhwbGljaXRseSBtYXJrZWQgYXMgbm90IGZpbHRlcmFibGUgb3IgaGlkZGVuXG4gICAgICAgICAgICBpZiAoYXR0LmhpZGRlbiB8fCBhdHQuaXNGaWx0ZXJhYmxlID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBhdHRyVHlwZSA9IGF0dC50eXBlO1xuICAgICAgICAgICAgY29uc3QgZmllbGRUeXBlID0gYXR0LmZpZWxkVHlwZTtcbiAgICAgICAgICAgIGxldCBpc0ZpbHRlcmFibGVUeXBlID0gZmFsc2U7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGJhc2ljIHNjYWxhciB0eXBlc1xuICAgICAgICAgICAgaWYgKGF0dHJUeXBlID09PSAnc3RyaW5nJyB8fCBhdHRyVHlwZSA9PT0gJ251bWJlcicgfHwgYXR0clR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZW51bSB0eXBlcyAoYXJyYXkgb2YgdmFsdWVzKVxuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIEFycmF5LmlzQXJyYXkoYXR0clR5cGUpKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBkYXRlL2RhdGV0aW1lIGZpZWxkc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScpKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBkYXRlLWxpa2UgZmllbGQgbmFtZXNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJiBhdHRyVHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBhdHROYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgaWYgKGxvd2VyTmFtZS5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygndGltZScpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIHJlbGF0aW9uIGZpZWxkc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmICdyZWxhdGlvbicgaW4gYXR0ICYmIGF0dC5yZWxhdGlvbikge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBmb3Igc2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkcyB3aXRoIG9wdGlvbnNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJiBcbiAgICAgICAgICAgICAgICAoZmllbGRUeXBlID09PSAnc2VsZWN0JyB8fCBmaWVsZFR5cGUgPT09ICdyYWRpbycgfHwgZmllbGRUeXBlID09PSAnY2hlY2tib3gnIHx8IGZpZWxkVHlwZSA9PT0gJ211bHRpLXNlbGVjdCcpICYmXG4gICAgICAgICAgICAgICAgJ29wdGlvbnMnIGluIGF0dCAmJiBhdHQub3B0aW9ucykge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJbmNsdWRlIGlmIGZpbHRlcmFibGUgYnkgZGVmYXVsdCAoaXNGaWx0ZXJhYmxlIG5vdCBleHBsaWNpdGx5IHNldCkgb3IgZXhwbGljaXRseSBlbmFibGVkXG4gICAgICAgICAgICBpZiAoaXNGaWx0ZXJhYmxlVHlwZSAmJiAoISgnaXNGaWx0ZXJhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc0ZpbHRlcmFibGUpKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZXMucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lcztcbiAgICB9XG5cbiAgICBwdWJsaWMgc2VyaWFsaXplUmVjb3JkPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IFQsIGF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKSk6IFBhcnRpYWw8VD4ge1xuXG4gICAgICAgIGxldCBrZXlzOiBBcnJheTxzdHJpbmc+O1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAga2V5cyA9IE9iamVjdC5rZXlzKHBhcnNlZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMoYXR0cmlidXRlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGlja0tleXM8VD4ocmVjb3JkLCAuLi5rZXlzKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2VyaWFsaXplUmVjb3JkczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4ocmVjb3JkOiBBcnJheTxUPiB8IG51bGwsIGF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKSk6IEFycmF5PFBhcnRpYWw8VD4+IHtcbiAgICAgICAgaWYgKCFyZWNvcmQgfHwgIUFycmF5LmlzQXJyYXkocmVjb3JkKSkge1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZWNvcmQubWFwKHJlY29yZCA9PiB0aGlzLnNlcmlhbGl6ZVJlY29yZDxUPihyZWNvcmQsIGF0dHJpYnV0ZXMpKTtcbiAgICB9XG5cbiAgICBhc3luYyBoeWRyYXRlUmVjb3JkcyhcbiAgICAgICAgcmVsYXRpb25zOiBBcnJheTxbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxhbnk+IF0+LFxuICAgICAgICByb290RW50aXR5UmVjb3JkczogQXJyYXk8eyBbIHg6IHN0cmluZyBdOiBhbnk7IH0+XG4gICAgKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVSZWNvcmRzJyBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChyZWxhdGlvbnM/Lm1hcChhc3luYyAoWyByZWxhdGVkQXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVTaW5nbGVSZWxhdGlvbihyb290RW50aXR5UmVjb3JkcywgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMpO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlU2luZ2xlUmVsYXRpb24ocm9vdEVudGl0eVJlY29yZHM6IGFueVtdLCByZWxhdGVkQXR0cmlidXRlTmFtZTogc3RyaW5nLCBvcHRpb25zOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248YW55Pikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlU2luZ2xlUmVsYXRpb24nIHJlbGF0aW9uOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIG9wdGlvbnNcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSwgcmVsYXRpb25UeXBlLCBpZGVudGlmaWVycyB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAoIWlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICB0aHJvdyAoYE5vIElkZW50aWZpZXJzOlske3JlbGF0aW9uVHlwZX06JHtyZWxhdGVkRW50aXR5TmFtZX1dIHByb3ZpZGVkYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVsYXRpb25UeXBlID09ICdvbmUtdG8tb25lJyB8fCByZWxhdGlvblR5cGUgPT0gJ21hbnktdG8tbWFueScpIHtcbiAgICAgICAgICAgIHRocm93IChgUmVsYXRpb25UeXBlOlske3JlbGF0aW9uVHlwZX06JHtyZWxhdGVkRW50aXR5TmFtZX1dIGluIG5vdCBzdXBwb3J0ZWQgYnkgaHlkcmF0aW9uLCB1c2Ugb25lIG9mIFttYW55LXRvLW9uZSwgb25lLXRvLW1hbnldIG90IG1hbnVhbGx5IGh5ZHJhdGUnYClcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCByZWxhdGVkIGVudGl0eSBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICAgICAgaWYgKCFyZWxhdGVkRW50aXR5U2VydmljZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzZXJ2aWNlIGZvdW5kIGZvciByZWxhdGlvbnNoaXA6ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9KCR7cmVsYXRlZEVudGl0eU5hbWV9KTsgcGxlYXNlIG1ha2Ugc3VyZSBzZXJ2aWNlIGhhcyBiZWVuIHJlZ2lzdGVyZWQgaW4gdGhlIHJlcXVpcmVkICdkaS1jb250YWluZXInYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgcmVsYXRpb24ncyBtZXRhZGF0YVxuICAgICAgICBjb25zdCBjdXJyZW50RW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSA9IGN1cnJlbnRFbnRpdHlTY2hlbWEuYXR0cmlidXRlc1sgcmVsYXRlZEF0dHJpYnV0ZU5hbWUgYXMgYW55IF0gYXMgRW50aXR5QXR0cmlidXRlO1xuXG4gICAgICAgIGlmICghcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSB8fCAhcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YT8ucmVsYXRpb24pIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgTm8gbWV0YWRhdGEgZm91bmQgZm9yIHJlbGF0aW9uc2hpcDogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX1gXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKG1lc3NhZ2UsIHJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEpO1xuICAgICAgICAgICAgdGhyb3cgKG1lc3NhZ2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVsYXRpb24gaWRlbnRpZmllcnMgbWFwcGluZ1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10gPSBBcnJheS5pc0FycmF5KGlkZW50aWZpZXJzKSA/IGlkZW50aWZpZXJzIDogWyBpZGVudGlmaWVycyEgXTtcblxuICAgICAgICAvLyBEZWNpZGUgbG9naWMgYmFzZWQgb24gcmVsYXRpb25UeXBlXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUgPT09ICdtYW55LXRvLW9uZScpIHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogTUFOWS1UTy1PTkU6XG4gICAgICAgICAgICAgKiAtLS0tLS0tLS0tLS0tXG4gICAgICAgICAgICAgKiBUaGUgXCJyb290RW50aXR5UmVjb3Jkc1wiIGFyZSB0aGUgQ0hJTEQgaXRlbXMsIGVhY2ggc3RvcmluZyB0aGUgcGFyZW50J3NcbiAgICAgICAgICAgICAqIGNvbXBvc2l0ZSBrZXkgaW4gc29tZSBmaWVsZHMuIFdlIGdhdGhlciBhbGwgdGhvc2UgcGFyZW50IGtleXMsIGRvIGEgYmF0Y2hcbiAgICAgICAgICAgICAqIHJldHJpZXZhbCBmcm9tIHRoZSBwYXJlbnQgZW50aXR5LCB0aGVuIGF0dGFjaCB0aGUgc2luZ2xlIG1hdGNoaW5nIHBhcmVudFxuICAgICAgICAgICAgICogcmVjb3JkIGludG8gY2hpbGRSZWNvcmRbcmVsYXRlZEF0dHJpYnV0ZU5hbWVdLlxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZU1hbnlUb09uZShcbiAgICAgICAgICAgICAgICByb290RW50aXR5UmVjb3JkcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkQXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MsXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uVHlwZSA9PT0gJ29uZS10by1tYW55Jykge1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBPTkUtVE8tTUFOWTpcbiAgICAgICAgICAgICAqIC0tLS0tLS0tLS0tLS1cbiAgICAgICAgICAgICAqIFRoZSBcInJvb3RFbnRpdHlSZWNvcmRzXCIgYXJlIHRoZSBQQVJFTlQgaXRlbXMuIEVhY2ggcGFyZW50IGNhbiBoYXZlIG11bHRpcGxlXG4gICAgICAgICAgICAgKiBjaGlsZCBpdGVtcy4gVGhlIGNoaWxkIHRhYmxlIHJlY29yZHMgZWFjaCBzdG9yZSB0aGUgcGFyZW50J3Mga2V5LiBcbiAgICAgICAgICAgICAqIFNvIHdlIGRvIGEgcXVlcnkgcGVyIHBhcmVudCBhbmQgdGhlbiAuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZU9uZVRvTWFueShcbiAgICAgICAgICAgICAgICByb290RW50aXR5UmVjb3JkcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkQXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MsXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlTWFueVRvT25lKFxuICAgICAgICBjaGlsZFJlY29yZHM6IGFueVtdLFxuICAgICAgICBwYXJlbnRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSxcbiAgICAgICAgcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZTogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxhbnk+IHwgdW5kZWZpbmVkLFxuICAgICAgICBwYXJlbnRTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4gICAgKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVNYW55VG9PbmUnIHJlbGF0aW9uOiAke3BhcmVudEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gZm9yIGVhY2ggcGFyZW50IGNyZWF0ZSBhIGNoaWxkcmVuIGJhdGNoXG4gICAgICAgIGNvbnN0IHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcCA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkUmVjb3Jkcykge1xuICAgICAgICAgICAgaWYgKCFjaGlsZCkgY29udGludWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgcGFyZW50IGtleSBvYmplY3QuIEUuZy4geyBvcmdJZDogY2hpbGQub3JnSWQsIHVzZXJJZDogY2hpbGQudXNlcklkIH0gZm9yIDItYXR0ciBQS1xuICAgICAgICAgICAgY29uc3QgcGFyZW50S2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgc291cmNlLCB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcblxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbCA9IGdldFZhbHVlQnlQYXRoKGNoaWxkLCBzb3VyY2UpO1xuICAgICAgICAgICAgICAgICAgICBpZiAodmFsID09IG51bGwpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudEtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gdmFsO1xuXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGdldHRpbmcgdmFsdWUgZm9yIHBhdGg6ICR7c291cmNlfWAsIHsgZXJyb3IgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiBwYXJ0aWFsIG9yIGVtcHR5LCBza2lwXG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMocGFyZW50S2V5T2JqKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBjaGlsZFsgcGFyZW50QXR0cmlidXRlTmFtZSBdID0gbnVsbDtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gSlNPTi5zdHJpbmdpZnkocGFyZW50S2V5T2JqKTtcbiAgICAgICAgICAgIGlmICghcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmhhcyhrZXlTdHIpKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLnNldChrZXlTdHIsIFtdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5nZXQoa2V5U3RyKSEucHVzaChjaGlsZCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLnNpemUgPT09IDApIHJldHVybjtcblxuICAgICAgICAvLyBDcmVhdGUgYSBwYXJlbnQtaWRlbnRpZmllcnMtYmF0Y2ggZm9yIGZldGNoaW5nXG4gICAgICAgIGNvbnN0IHBhcmVudElkZW50aWZpZXJzQmF0Y2g6IEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+ID0gW107XG4gICAgICAgIGZvciAoY29uc3QgayBvZiBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAua2V5cygpKSB7XG4gICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc0JhdGNoLnB1c2goSlNPTi5wYXJzZShrKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBmZXRjaGVkUGFyZW50cyA9IGF3YWl0IHBhcmVudFNlcnZpY2UuZ2V0KHtcbiAgICAgICAgICAgIGlkZW50aWZpZXJzOiBwYXJlbnRJZGVudGlmaWVyc0JhdGNoLFxuICAgICAgICAgICAgYXR0cmlidXRlczogcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSWYgXCJnZXQoKVwiIHJldHVybnMgYSBzaW5nbGUgaXRlbSBjb252ZXJ0IGl0IGludG8gYW4gYXJyYXkuXG4gICAgICAgIGNvbnN0IHBhcmVudHNBcnJheSA9IEFycmF5LmlzQXJyYXkoZmV0Y2hlZFBhcmVudHMpID8gZmV0Y2hlZFBhcmVudHMgOiBbIGZldGNoZWRQYXJlbnRzIF07XG5cbiAgICAgICAgLy8gTWFrZSBhIGRpY3Rpb25hcnkgZnJvbSB7IDxrZXlTdHI+ID0+IHBhcmVudFJlY29yZCB9XG4gICAgICAgIGNvbnN0IHBhcmVudERpY3QgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgcGFyZW50c0FycmF5KSB7XG4gICAgICAgICAgICBpZiAoIXApIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFJlYnVpbGQgdGhlIFwiY29tcG9zaXRlIGtleVwiIGZyb20gdGhlIHBhcmVudCdzIHJlY29yZFxuICAgICAgICAgICAgY29uc3Qga2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBbIHRhcmdldCBdID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgc29tZSBhdHRyaWJ1dGUgaXMgbWlzc2luZywgc2tpcFxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAga2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSBwWyB0YXJnZXQgXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGtTdHIgPSBKU09OLnN0cmluZ2lmeShrZXlPYmopO1xuICAgICAgICAgICAgcGFyZW50RGljdC5zZXQoa1N0ciwgcCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBdHRhY2ggZWFjaCBwYXJlbnQncyBkYXRhIHRvIHRoZSBjaGlsZFxuICAgICAgICBmb3IgKGNvbnN0IFsga1N0ciwgY2hpbGRyZW4gXSBvZiBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuZW50cmllcygpKSB7XG4gICAgICAgICAgICBjb25zdCBmb3VuZFBhcmVudCA9IHBhcmVudERpY3QuZ2V0KGtTdHIpID8/IG51bGw7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGMgb2YgY2hpbGRyZW4pIHtcbiAgICAgICAgICAgICAgICBjWyBwYXJlbnRBdHRyaWJ1dGVOYW1lIF0gPSBmb3VuZFBhcmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZU9uZVRvTWFueShcbiAgICAgICAgcGFyZW50UmVjb3JkczogYW55W10sXG4gICAgICAgIGNoaWxkQXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10sXG4gICAgICAgIGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZTogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxhbnk+IHwgdW5kZWZpbmVkLFxuICAgICAgICBjaGlsZFNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbiAgICApIHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlT25lVG9NYW55JyByZWxhdGlvbjogJHtjaGlsZEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBwYXJlbnRLZXlTdHJUb1BhcmVudHMgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50UmVjb3Jkcykge1xuICAgICAgICAgICAgaWYgKCFwYXJlbnQpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBhIFwiY2hpbGQgaW5kZXhcIiBrZXkgZnJvbSB0aGUgcGFyZW50J3MgZmllbGRzLiBGb3IgZXhhbXBsZSwgXG4gICAgICAgICAgICAvLyBpZiB0aGUgY2hpbGQgR1NJIGhhcyB7IHBrOiAndGVuYW50SWQnLCBzazogJ2FjY291bnRJZCcgfSwgXG4gICAgICAgICAgICAvLyB3ZSBmaWxsIHsgdGVuYW50SWQ6IHBhcmVudC50ZW5hbnRJZCwgYWNjb3VudElkOiBwYXJlbnQuYWNjb3VudElkIH0uXG4gICAgICAgICAgICBjb25zdCBjaGlsZEtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHNvdXJjZSwgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhcmVudFsgc291cmNlIF0gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZEtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gcGFyZW50WyBzb3VyY2UgXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIHdlIGhhdmUgbm8gdmFsaWQgY29tcG9zaXRlIGtleSwgbm8gY2hpbGRyZW4gY2FuIGJlIGZldGNoZWRcbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhjaGlsZEtleU9iaikubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50WyBjaGlsZEF0dHJpYnV0ZU5hbWUgXSA9IFtdO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBKU09OLnN0cmluZ2lmeShjaGlsZEtleU9iaik7XG4gICAgICAgICAgICBpZiAoIXBhcmVudEtleVN0clRvUGFyZW50cy5oYXMoa2V5U3RyKSkge1xuICAgICAgICAgICAgICAgIHBhcmVudEtleVN0clRvUGFyZW50cy5zZXQoa2V5U3RyLCBbXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZ2V0KGtleVN0cikhLnB1c2gocGFyZW50KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIG5vIHBhcmVudCBoYXMgYSB2YWxpZCBrZXksIHdlJ3JlIGRvbmVcbiAgICAgICAgaWYgKHBhcmVudEtleVN0clRvUGFyZW50cy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGb3IgZWFjaCB1bmlxdWUgcGFyZW50S2V5T2JqLCBkbyBhIGNoaWxkU2VydmljZSBxdWVyeS9saXN0IGluIHBhcmFsbGVsLlxuICAgICAgICBjb25zdCBwcm9taXNlczogQXJyYXk8UHJvbWlzZTxhbnk+PiA9IFtdO1xuICAgICAgICBjb25zdCBwYXJlbnRLZXlzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBrZXlTdHIgXSBvZiBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZW50cmllcygpKSB7XG5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkS2V5T2JqID0gSlNPTi5wYXJzZShrZXlTdHIpO1xuXG4gICAgICAgICAgICBwYXJlbnRLZXlzLnB1c2goa2V5U3RyKTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGNoaWxkRmllbGQsIHZhbCBdIG9mIE9iamVjdC5lbnRyaWVzKGNoaWxkS2V5T2JqKSkge1xuICAgICAgICAgICAgICAgIGZpbHRlcnNbIGNoaWxkRmllbGQgXSA9IHsgZXE6IHZhbCB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9taXNlcy5wdXNoKFxuICAgICAgICAgICAgICAgIGNoaWxkU2VydmljZS5saXN0KHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlczogY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcblxuICAgICAgICAvLyBGb3IgZWFjaCByZXN1bHQsIG1hcCBjaGlsZHJlbiBiYWNrIHRvIHRoZSBjb3JyZWN0LXBhcmVudChzKVxuICAgICAgICBjb25zdCBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuOiBSZWNvcmQ8c3RyaW5nLCBhbnlbXT4gPSB7fTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN1bHRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCB7IGRhdGE6IGNoaWxkSXRlbXMgfSA9IHJlc3VsdHNbIGkgXTtcbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IHBhcmVudEtleXNbIGkgXTtcbiAgICAgICAgICAgIHBhcmVudEtleVN0clRvQ2hpbGRyZW5bIGtleVN0ciBdID0gY2hpbGRJdGVtcyA/PyBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEF0dGFjaCB0byBwYXJlbnRzXG4gICAgICAgIGZvciAoY29uc3QgWyBrZXlTdHIsIHBhcmVudHMgXSBvZiBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZW50cmllcygpKSB7XG4gICAgICAgICAgICBjb25zdCBjaGlsZEFycmF5ID0gcGFyZW50S2V5U3RyVG9DaGlsZHJlblsga2V5U3RyIF0gPz8gW107XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHAgb2YgcGFyZW50cykge1xuICAgICAgICAgICAgICAgIHBbIGNoaWxkQXR0cmlidXRlTmFtZSBdID0gY2hpbGRBcnJheTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBhbiBlbnRpdHkgYnkgaXRzIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5LlxuICAgICAqIEBwYXJhbSBzZWxlY3Rpb25zIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXRyaWV2ZWQgZW50aXR5IGRhdGEuXG4gICAgICovXG5cbiAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldE9wdGlvbnM8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMgfSA9IG9wdGlvbnM7XG5cblxuICAgICAgICBsZXQgZm9ybWF0dGVkQXR0cmlidXRlcyA9IGF0dHJpYnV0ZXM7XG4gICAgICAgIGlmICghYXR0cmlidXRlcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmb3JtYXR0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvcm1hdHRlZCBhdHRyaWJ1dGVzIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZm9ybWF0dGVkQXR0cmlidXRlcyk7XG5cbiAgICAgICAgY29uc3QgcmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBhbnkpLnJlZHVjZSgoYWNjLCBbIGF0dE5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYWNjLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICBpZiAoaXNPYmplY3Qob3B0aW9ucykgJiYgb3B0aW9ucy5pZGVudGlmaWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8YW55Pj4gPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycyA6IFsgb3B0aW9ucy5pZGVudGlmaWVycyBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcEtleXMgPSBpZGVudGlmaWVycy5tYXAoaWRlbnRpZmllciA9PiBpZGVudGlmaWVyLnNvdXJjZT8uc3BsaXQ/LignLicpPy5bIDAgXSkuZmlsdGVyKGtleSA9PiAhIWtleSkgYXMgc3RyaW5nW107XG4gICAgICAgICAgICAgICAgYWNjLnB1c2goLi4udG9wS2V5cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCBbXSBhcyBzdHJpbmdbXSk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyA9IFsgLi4ubmV3IFNldChyZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMpIF1cblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJldHJpZXZlZCBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmICghIWZvcm1hdHRlZEF0dHJpYnV0ZXMgJiYgZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgWyBlbnRpdHkuZGF0YSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRpdHk/LmRhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGJ5IHRoZWlyIGlkZW50aWZpZXJzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGJhdGNoIHJldHJpZXZpbmcgZW50aXRpZXMuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuaWRlbnRpZmllcnMgLSBBcnJheSBvZiBlbnRpdHkgaWRlbnRpZmllcnMgdG8gcmV0cmlldmUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlcyAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBpbmNsdWRlIGluIHRoZSByZXNwb25zZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5jb25jdXJyZW50IC0gT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyB0byBwZXJmb3JtIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGJhdGNoR2V0PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBhdHRyaWJ1dGVzPzogRW50aXR5U2VsZWN0aW9uczxTPixcbiAgICAgICAgY29uY3VycmVudD86IG51bWJlclxuICAgIH0pIHtcbiAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgYXR0cmlidXRlcywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzO1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm9ybWF0dGVkQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3JtYXR0ZWQgYXR0cmlidXRlcyBmb3IgYmF0Y2ggZ2V0IG9uIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBmb3JtYXR0ZWRBdHRyaWJ1dGVzKTtcblxuICAgICAgICBjb25zdCByZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIGFueSkucmVkdWNlKChhY2MsIFsgYXR0TmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhY2MucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIGlmIChpc09iamVjdChvcHRpb25zKSAmJiBvcHRpb25zLmlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IEFycmF5PFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+PiA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzIDogWyBvcHRpb25zLmlkZW50aWZpZXJzIF07XG4gICAgICAgICAgICAgICAgY29uc3QgdG9wS2V5cyA9IGlkZW50aWZpZXJzLm1hcChpZGVudGlmaWVyID0+IGlkZW50aWZpZXIuc291cmNlPy5zcGxpdD8uKCcuJyk/LlsgMCBdKS5maWx0ZXIoa2V5ID0+ICEha2V5KSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgICAgICBhY2MucHVzaCguLi50b3BLZXlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIFtdIGFzIHN0cmluZ1tdKTtcblxuICAgICAgICBjb25zdCB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzID0gWyAuLi5uZXcgU2V0KHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcykgXTtcblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRCYXRjaEVudGl0eTxTPih7XG4gICAgICAgICAgICBpZHM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyBhcyBhbnksXG4gICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZXRyaWV2ZWQgYmF0Y2ggZW50aXRpZXM6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmICghIWZvcm1hdHRlZEF0dHJpYnV0ZXMgJiYgZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXR5LmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGRhdGE6IGVudGl0eT8uZGF0YSB8fCBbXSxcbiAgICAgICAgICAgIHVucHJvY2Vzc2VkOiBlbnRpdHk/LnVucHJvY2Vzc2VkIHx8IFtdXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIHRoZSB1bmlxdWVuZXNzIG9mIGFuIGF0dHJpYnV0ZSB2YWx1ZSBhbmQgdXBkYXRlcyB0aGUgcGF5bG9hZCBpZiBuZWNlc3NhcnkuXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY2hlY2tpbmcgdW5pcXVlbmVzcyBhbmQgdXBkYXRpbmcgdGhlIHBheWxvYWQuXG4gICAgICogQHBhcmFtIG9wdGlvbnMucGF5bG9hZFRvVXBkYXRlIC0gVGhlIHBheWxvYWQgb2JqZWN0IHRvIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVWYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLm1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSAtIFRoZSBtYXhpbXVtIG51bWJlciBvZiBhdHRlbXB0cyB0byBjcmVhdGUgYSB1bmlxdWUgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqIEByZXR1cm5zIEEgYm9vbGVhbiBpbmRpY2F0aW5nIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZShvcHRpb25zOiB7XG4gICAgICAgIHBheWxvYWRUb1VwZGF0ZTogYW55LFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGF0dHJpYnV0ZVZhbHVlOiBhbnksXG4gICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycz86IHtcbiAgICAgICAgICAgIFsga2V5OiBzdHJpbmcgXTogYW55XG4gICAgICAgIH1cbiAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlOiBudW1iZXIsXG4gICAgfSkge1xuXG4gICAgICAgIGNvbnN0IHsgcGF5bG9hZFRvVXBkYXRlLCBhdHRyaWJ1dGVOYW1lLCBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMsIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB9ID0gb3B0aW9ucztcbiAgICAgICAgbGV0IHsgYXR0cmlidXRlVmFsdWUgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGlzVW5pcXVlID0gZmFsc2U7XG4gICAgICAgIGxldCB0cmllc0NvdW50ID0gMTtcblxuICAgICAgICB3aGlsZSAoIWlzVW5pcXVlICYmIHRyaWVzQ291bnQgPCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUpIHtcbiAgICAgICAgICAgIGlzVW5pcXVlID0gYXdhaXQgdGhpcy5pc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKGF0dHJpYnV0ZU5hbWUsIGF0dHJpYnV0ZVZhbHVlLCBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpO1xuICAgICAgICAgICAgaWYgKCFpc1VuaXF1ZSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZVZhbHVlID0gdGhpcy5nZW5lcmF0ZVVuaXF1ZVZhbHVlKGF0dHJpYnV0ZVZhbHVlLCB0cmllc0NvdW50KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRyaWVzQ291bnQrKztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1VuaXF1ZSkge1xuICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlWyBhdHRyaWJ1dGVOYW1lIF0gPSBhdHRyaWJ1dGVWYWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpc1VuaXF1ZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgaWYgdGhlIGdpdmVuIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUgZm9yIHRoZSBzcGVjaWZpZWQgYXR0cmlidXRlIG5hbWUuXG4gICAgICogQHBhcmFtIGF0dHJpYnV0ZU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBhdHRyaWJ1dGVWYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEByZXR1cm5zIEEgYm9vbGVhbiBpbmRpY2F0aW5nIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUgb3Igbm90LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGF0dHJpYnV0ZVZhbHVlOiBhbnksXG4gICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycz86IHtcbiAgICAgICAgICAgIFsga2V5OiBzdHJpbmcgXTogYW55XG4gICAgICAgIH1cbiAgICApIHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gYXR0cmlidXRlTmFtZTogJHthdHRyaWJ1dGVOYW1lfSB+IGF0dHJpYnV0ZVZhbHVlOiAke2F0dHJpYnV0ZVZhbHVlfWApO1xuXG4gICAgICAgIC8vIENyZWF0ZSBmaWx0ZXJzIGZvciB0aGUgcXVlcnkgdXNpbmcgdGhlIGNvcnJlY3Qgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBbIGF0dHJpYnV0ZU5hbWUgXTogeyBlcTogYXR0cmlidXRlVmFsdWUgfVxuICAgICAgICB9IGFzIEVudGl0eUZpbHRlckNyaXRlcmlhPFM+O1xuXG4gICAgICAgIC8vIERldGVybWluZSB3aGljaCBhdHRyaWJ1dGVzIHRvIHByb2plY3QgLSBvbmx5IHRoZSBhdHRyaWJ1dGUgYmVpbmcgY2hlY2tlZCBhbmQgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllcnNcbiAgICAgICAgY29uc3QgYXR0cmlidXRlc1RvUHJvamVjdDogc3RyaW5nW10gPSBbIGF0dHJpYnV0ZU5hbWUgXTtcblxuICAgICAgICAvLyBBZGQgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllciBmaWVsZHMgdG8gdGhlIHByb2plY3Rpb25cbiAgICAgICAgaWYgKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyAmJiAhaXNFbXB0eU9iamVjdERlZXAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFhdHRyaWJ1dGVzVG9Qcm9qZWN0LmluY2x1ZGVzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlc1RvUHJvamVjdC5wdXNoKGtleSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgdGhlIHF1ZXJ5IG1ldGhvZCB0byBsZXZlcmFnZSBpbmRleCBzZWxlY3Rpb24gbG9naWMgd2l0aCBtaW5pbWFsIGF0dHJpYnV0ZSBwcm9qZWN0aW9uXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoe1xuICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXNUb1Byb2plY3QgYXMgYW55LFxuICAgICAgICAgICAgcGFnaW5hdGlvbjogeyBjb3VudDogMSB9IC8vIFdlIG9ubHkgbmVlZCB0byBrbm93IGlmIGFueSByZWNvcmRzIGV4aXN0XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGhhdmUgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllcnMsIGZpbHRlciB0aGUgcmVzdWx0cyBpbiBtZW1vcnlcbiAgICAgICAgbGV0IGVudGl0aWVzID0gcmVzdWx0LmRhdGEgfHwgW107XG4gICAgICAgIGlmIChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMgJiYgIWlzRW1wdHlPYmplY3REZWVwKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIGVudGl0aWVzID0gZW50aXRpZXMuZmlsdGVyKGVudGl0eSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICFPYmplY3QuZW50cmllcyhpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpLmV2ZXJ5KChbIGtleSwgdmFsdWUgXSkgPT5cbiAgICAgICAgICAgICAgICAgICAgZW50aXR5WyBrZXkgXSA9PT0gdmFsdWVcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gYXR0cmlidXRlTmFtZTogJHthdHRyaWJ1dGVOYW1lfSB+IGF0dHJpYnV0ZVZhbHVlOiAke2F0dHJpYnV0ZVZhbHVlfSB+IGVudGl0eTpgLCB7IGRhdGE6IGVudGl0aWVzIH0pO1xuXG4gICAgICAgIHJldHVybiBlbnRpdGllcy5sZW5ndGggPT09IDA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIGEgdW5pcXVlIHZhbHVlIGJ5IGFwcGVuZGluZyBhIHVuaXF1ZSBzdWZmaXggdG8gdGhlIG9yaWdpbmFsIHZhbHVlLlxuICAgICAqIEBwYXJhbSBvcmlnaW5hbFZhbHVlIC0gVGhlIG9yaWdpbmFsIHZhbHVlIHRvIGdlbmVyYXRlIGEgdW5pcXVlIHZhbHVlIGZyb20uXG4gICAgICogQHBhcmFtIGF0dGVtcHQgLSBUaGUgYXR0ZW1wdCBudW1iZXIgb3Igc3RyaW5nIHRvIGJlIHVzZWQgYXMgYSBzdWZmaXggKGRlZmF1bHQ6IHJhbmRvbSBzdHJpbmcpLlxuICAgICAqIEByZXR1cm5zIFRoZSBnZW5lcmF0ZWQgdW5pcXVlIHZhbHVlLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZW5lcmF0ZVVuaXF1ZVZhbHVlKG9yaWdpbmFsVmFsdWU6IGFueSwgYXR0ZW1wdDogbnVtYmVyIHwgc3RyaW5nID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDIsIDE1KSk6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IHVuaXF1ZVN1ZmZpeCA9IGAke0RhdGUubm93KCl9LSR7YXR0ZW1wdH1gO1xuICAgICAgICByZXR1cm4gYCR7b3JpZ2luYWxWYWx1ZX0tJHt1bmlxdWVTdWZmaXh9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBdXRvbWF0aWNhbGx5IGluamVjdHMgYWN0b3IgY29udGV4dCBpbnRvIGVudGl0eSBkYXRhXG4gICAgICogQHBhcmFtIGRhdGEgLSBUaGUgZW50aXR5IGRhdGEgdG8gZW5oYW5jZVxuICAgICAqIEBwYXJhbSBvcGVyYXRpb24gLSBUaGUgb3BlcmF0aW9uIHR5cGUgKGNyZWF0ZS91cGRhdGUpXG4gICAgICogQHBhcmFtIGN0eCAtIFRoZSBleGVjdXRpb24gY29udGV4dCBjb250YWluaW5nIGFjdG9yIGluZm9cbiAgICAgKiBAcmV0dXJucyBFbmhhbmNlZCBkYXRhIHdpdGggYWN0b3IgY29udGV4dFxuICAgICAqL1xuICAgIHByb3RlY3RlZCBpbmplY3RBY3RvckNvbnRleHQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KFxuICAgICAgICBkYXRhOiBULCBcbiAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RlbGV0ZScsIFxuICAgICAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0XG4gICAgKTogVCB7XG5cbiAgICAgICAgaWYgKCFjdHg/LmFjdG9yKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQmFzZUVudGl0eVNlcnZpY2U6IE5vIGFjdG9yIGNvbnRleHQgZm91bmQsIHNraXBwaW5nIGluamVjdGlvbicpO1xuICAgICAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCBlbmhhbmNlZERhdGEgPSB7IC4uLmRhdGEgfTtcbiAgICAgICAgY29uc3QgeyBhY3RvciB9ID0gY3R4O1xuXG4gICAgICAgIC8vIEdldCBjdXJyZW50IHRpbWVzdGFtcCBmb3IgZGF0YWJhc2Ugb3BlcmF0aW9uXG4gICAgICAgIGNvbnN0IGN1cnJlbnRUaW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBJbmplY3QgdmlzaWJsZSBhY3RvciBmaWVsZHMgaWYgZGVmaW5lZCBpbiBzY2hlbWEgYW5kIG5vdCByZWFkLW9ubHlcbiAgICAgICAgaWYgKG9wZXJhdGlvbiA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdjcmVhdGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdjcmVhdGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBGb3IgZGVsZXRlIG9wZXJhdGlvbnMsIHdlIHN0aWxsIHdhbnQgdG8gdHJhY2sgd2hvIHBlcmZvcm1lZCB0aGUgZGVsZXRpb25cbiAgICAgICAgaWYgKG9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnZGVsZXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnZGVsZXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5kZWxldGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdkZWxldGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdkZWxldGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5kZWxldGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQWx3YXlzIHVwZGF0ZSB0aGVzZSBmaWVsZHMgb24gY3JlYXRlL3VwZGF0ZSAoaWYgbm90IHJlYWQtb25seSlcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndXBkYXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndXBkYXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS51cGRhdGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICd1cGRhdGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd1cGRhdGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS51cGRhdGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICd0ZW5hbnRJZCcpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3RlbmFudElkJykgJiYgYWN0b3IudGVuYW50SWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudGVuYW50SWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFsd2F5cyBpbmplY3QgY29tcGxldGUgYWN0b3IgY29udGV4dCBmb3IgYXVkaXQgdHJhaWxcbiAgICAgICAgLy8gVGhpcyBmaWVsZCBpcyBoaWRkZW4gZnJvbSBBUEkgcmVzcG9uc2VzIGJ5IGRlZmF1bHRcbiAgICAgICAgLy8gQ2xlYW4gYWN0b3Igb2JqZWN0IGJ5IHJlbW92aW5nIHVuZGVmaW5lZCB2YWx1ZXMgKER5bmFtb0RCIGRvZXNuJ3QgYWxsb3cgdGhlbSlcbiAgICAgICAgY29uc3QgY2xlYW5BY3RvciA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGFjdG9yKS5maWx0ZXIoKFtfLCB2YWx1ZV0pID0+IHZhbHVlICE9PSB1bmRlZmluZWQpXG4gICAgICAgICk7XG5cbiAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLl9hY3RvciA9IGNsZWFuQWN0b3I7XG5cbiAgICAgICAgcmV0dXJuIGVuaGFuY2VkRGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF5bG9hZCAtIFRoZSBwYXlsb2FkIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgY3JlYXRlKHBheWxvYWQ6IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgICAgIGxldCBwYXlsb2FkQ29weSA9IHsgLi4ucGF5bG9hZCB9O1xuICAgICAgICBcbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHRcbiAgICAgICAgcGF5bG9hZENvcHkgPSB0aGlzLmluamVjdEFjdG9yQ29udGV4dChwYXlsb2FkQ29weSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJyc7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnbmFtZScpIHx8ICcnO1xuXG4gICAgICAgIGlmIChlbnRpdHlTbHVnQXR0cmlidXRlICYmICEoZW50aXR5U2x1Z0F0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIChlbnRpdHlOYW1lQXR0cmlidXRlIGluIHBheWxvYWRDb3B5KSkge1xuICAgICAgICAgICAgICAgIHBheWxvYWRDb3B5WyBlbnRpdHlTbHVnQXR0cmlidXRlIGFzIGtleW9mIHR5cGVvZiBwYXlsb2FkQ29weSBdID0gdG9TbHVnKHBheWxvYWRDb3B5WyBlbnRpdHlOYW1lQXR0cmlidXRlIF0pIGFzIGFueTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gcGF5bG9hZENvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gcGF5bG9hZENvcHlbIG5hbWUhIF07XG4gICAgICAgICAgICAgICAgICAgIHVuaXF1ZW5lc3NDaGVja3MucHVzaCgoKSA9PiB0aGlzLmNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IHBheWxvYWRDb3B5LFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHVuaXF1ZW5lc3NDaGVja3MubWFwKGNoZWNrID0+IGNoZWNrKCkpKTtcblxuICAgICAgICAgICAgaWYgKGNoZWNrUmVzdWx0cy5pbmNsdWRlcyhmYWxzZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHNQYXRoID0gdW5pcXVlRmllbGRzLm1hcChmaWVsZCA9PiBmaWVsZC5uYW1lISkgPz8gW107XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKFsge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlVuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igb25lIG9yIG1vcmUgZmllbGRzLlwiLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiB1bmlxdWVGaWVsZHNQYXRoLFxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogWyAndW5pcXVlJywgdW5pcXVlRmllbGRzIF0sXG4gICAgICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGNyZWF0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBkYXRhOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGVudGl0eTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzLU9SLVVwZGF0ZXMgYW4gZW50aXR5LlxuICAgICAqIE5PVEU6IFxuICAgICAqICAgLSBUaGlzIG1ldGhvZCBkb2VzIG5vdCBjaGVjayBmb3IgdW5pcXVlbmVzcyBvZiB0aGUgYXR0cmlidXRlcywgbmVpdGhlciBjcmVhdGUgdGhlIHNsdWcgYXV0b21hdGljYWxseS5cbiAgICAgKiAgIC0gSXQncyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgdGhlIGNhbGxlciB0byBlbnN1cmUgdGhlIHJlYWQgb255IGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpZiB0aGUgcmVjb3JkIGlzIGJlaW5nIHVwc2VydC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF5bG9hZCAtIFRoZSBwYXlsb2FkIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIE9iamVjdCBjb250YWluaW5nOlxuICAgICAqICAgLSBkYXRhOiBUaGUgdXBzZXJ0ZWQgZW50aXR5IGRhdGFcbiAgICAgKiAgIC0gd2FzQ3JlYXRlZDogdHJ1ZSBpZiByZWNvcmQgd2FzIGNyZWF0ZWQsIGZhbHNlIGlmIHVwZGF0ZWRcbiAgICAgKiAgIC0gb2xkRGF0YTogcHJldmlvdXMgZGF0YSBpZiBpdCB3YXMgYW4gdXBkYXRlICh1bmRlZmluZWQgZm9yIGNyZWF0ZXMpXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHVwc2VydChwYXlsb2FkOiBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcGF5bG9hZDpgLCBwYXlsb2FkKTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB1cHNlcnRFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgZGF0YTogcGF5bG9hZCxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgZHVwbGljYXRlIGVudGl0eSBkYXRhIGJhc2VkIG9uIHRoZSBnaXZlbiBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgZHVwbGljYXRlIGVudGl0eSBkYXRhLlxuICAgICAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gcmVjb3JkIGlzIGZvdW5kIGZvciB0aGUgZ2l2ZW4gaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBpZGVudGlmaWVycyA9IHsgaWQ6IDEgfTtcbiAgICAgKiBjb25zdCBkdXBsaWNhdGVEYXRhID0gYXdhaXQgbWFrZUR1cGxpY2F0ZUVudGl0eURhdGFCeUlkZW50aWZpZXJzKGlkZW50aWZpZXJzKTtcbiAgICAgKiBjb25zb2xlLmxvZyhkdXBsaWNhdGVEYXRhKTsgLy8geyBuYW1lOiAnSm9obiBEb2UnLCBhZ2U6IDMwLCAuLi4gfVxuICAgICAqL1xuICAgIHByb3RlY3RlZCBhc3luYyBtYWtlRHVwbGljYXRlRW50aXR5RGF0YShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPikge1xuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCB0aGlzLmdldCh7IGlkZW50aWZpZXJzIH0pIGFzIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+O1xuXG4gICAgICAgIGlmICghZW50aXR5KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IHJlY29yZCBmb3VuZCBmb3IgaWRlbnRpZmllcnM6ICR7aWRlbnRpZmllcnN9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgZHVwbGljYXRlRXZlbnREYXRhOiBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4gPSB7fSBhcyBhbnk7XG4gICAgICAgIGNvbnN0IHByaW1hcnlJZFByb3BOYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKSBhcyBzdHJpbmc7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IChnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnc2x1ZycpIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gKGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICduYW1lJykgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG5cbiAgICAgICAgZm9yIChsZXQgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZW50aXR5KSkge1xuXG4gICAgICAgICAgICBpZiAoa2V5ICE9PSBwcmltYXJ5SWRQcm9wTmFtZSkge1xuICAgICAgICAgICAgICAgIC8vIFRPRE86IGhhbmRsZSB3aGVuIGVudGl0eSBoYXMgbXVsdGlwbGUgaWRlbnRpZmllcnNcblxuICAgICAgICAgICAgICAgIGlmIChrZXkudG9VcHBlckNhc2UoKSA9PT0gZW50aXR5TmFtZUF0dHJpYnV0ZSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGAke3ZhbHVlfSAtIENvcHlgO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5LnRvVXBwZXJDYXNlKCkgPT09IGVudGl0eVNsdWdBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBgJHt2YWx1ZX0tY29weWA7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZHVwbGljYXRlRXZlbnREYXRhWyBrZXkgYXMga2V5b2YgdHlwZW9mIGR1cGxpY2F0ZUV2ZW50RGF0YSBdID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZHVwbGljYXRlRXZlbnREYXRhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBkdXBsaWNhdGUgZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBkdXBsaWNhdGUuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGR1cGxpY2F0ZWQgZW50aXR5LlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3QgZW50aXR5SWQgPSB7IGlkOiAxMjMsIG5hbWU6ICdleGFtcGxlJyB9O1xuICAgICAqIGNvbnN0IGR1cGxpY2F0ZWRFbnRpdHkgPSBhd2FpdCBkdXBsaWNhdGUoZW50aXR5SWQpO1xuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBkdXBsaWNhdGUoaWQ6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZHVwbGljYXRlRXZlbnREYXRhID0gYXdhaXQgdGhpcy5tYWtlRHVwbGljYXRlRW50aXR5RGF0YShpZCk7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNyZWF0ZShkdXBsaWNhdGVFdmVudERhdGEsIGN0eCk7XG4gICAgfVxuXG4gICAgLy8gVE9ETzogc2hvdWxkIGJlIHBhcnQgb2Ygc29tZSBjb25maWdcbiAgICBwcm90ZWN0ZWQgZGVsaW1pdGVyc1JlZ2V4ID0gLyg/OiZ8IHwsfFxcKykrLztcblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIHF1ZXJ5LlxuICAgICAqIC0gSWYgbm8gc3BlY2lmaWMgYXR0cmlidXRlcyBhcmUgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2YgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAtIElmIGEgc2VhcmNoIHRlcm0gaXMgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5IGl0IHdpbGwgc3BsaXQgdGhlIHNlYXJjaCB0ZXJtIGJ5IGAvKD86JnwgfCx8XFwrKSsvYCBSZWdleCBhbmQgd2lsbCBmaWx0ZXIgb3V0IGVtcHR5IHN0cmluZ3MuXG4gICAgICogLSBJZiBzZWFyY2ggYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIHNlYXJjaGFibGUgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcXVlcnkgLSBUaGUgcXVlcnkgb2JqZWN0IGNvbnRhaW5pbmcgZmlsdGVycywgc2VhcmNoIGtleXdvcmRzLCBhbmQgYXR0cmlidXRlcy5cbiAgICAgKiBAcmV0dXJucyBBIFByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgbGlzdCBvZiBlbnRpdGllcyBhbmQgdGhlIG9yaWdpbmFsIHF1ZXJ5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBsaXN0KHF1ZXJ5OiBFbnRpdHlRdWVyeTxTPiA9IHt9LCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gbGlzdCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcXVlcnk6YCwgcXVlcnkpO1xuXG4gICAgICAgIGlmICghcXVlcnkuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgcXVlcnkuYXR0cmlidXRlcyA9IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGZvciBsaXN0aW5nIEFQSSBhdHRyaWJ1dGVzIHdvdWxkIGJlIGFuIGFycmF5XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHF1ZXJ5LmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhxdWVyeS5hdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIHF1ZXJ5LmF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocXVlcnkuc2VhcmNoKSB7XG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoKSkge1xuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaCA9IHF1ZXJ5LnNlYXJjaC50cmltKCkuc3BsaXQodGhpcy5kZWxpbWl0ZXJzUmVnZXggPz8gJyAnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuc2VhcmNoLmxlbmd0aCA+IDApIHtcblxuICAgICAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzID0gcXVlcnkuc2VhcmNoQXR0cmlidXRlcy5zcGxpdCgnLCcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghcXVlcnkuc2VhcmNoQXR0cmlidXRlcyB8fCBpc0VtcHR5KHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSB0aGlzLmdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlckdyb3VwID0gbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMocXVlcnkuc2VhcmNoLCBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKTtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LmZpbHRlcnMgPSBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4oc2VhcmNoRmlsdGVyR3JvdXAgYXMgYW55LCBxdWVyeS5maWx0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzID0gYXdhaXQgbGlzdEVudGl0eTxTPih7XG4gICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZW50aXRpZXMuZGF0YSA9IHRoaXMuc2VyaWFsaXplUmVjb3JkcyhlbnRpdGllcy5kYXRhLCBxdWVyeS5hdHRyaWJ1dGVzKTtcblxuICAgICAgICBpZiAocXVlcnkuYXR0cmlidXRlcyAmJiBlbnRpdGllcy5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKHF1ZXJ5LmF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAvLyBvbmx5IGF0dHJpYnV0ZXMgaW4gaHlkcmF0ZSBvcHRpb25zIHRoYXQgaGF2ZSByZWxhdGlvbiBtZXRhZGF0YSBhdHRhY2hlZCB0byB0aGVtIG5lZWRzIHRvIGJlIGh5ZHJhdGVkXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0aWVzLmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgLi4uZW50aXRpZXMsIHF1ZXJ5IH07XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBFeGVjdXRlcyBhIHF1ZXJ5IG9uIHRoZSBlbnRpdHkuXG4gICAgICogLSBJZiBubyBzcGVjaWZpYyBhdHRyaWJ1dGVzIGFyZSBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIC0gSWYgYSBzZWFyY2ggdGVybSBpcyBwcm92aWRlZCBpbiB0aGUgcXVlcnkgaXQgd2lsbCBzcGxpdCB0aGUgc2VhcmNoIHRlcm0gYnkgYC8oPzomfCB8LHxcXCspKy9gIFJlZ2V4IGFuZCB3aWxsIGZpbHRlciBvdXQgZW1wdHkgc3RyaW5ncy5cbiAgICAgKiAgIC0tIElmIHNlYXJjaCBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2Ygc2VhcmNoYWJsZSBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqICAgLS0gSWYgdGhlcmUgYXJlIGFueSBub24tZW1wdHkgc2VhcmNoLXRlcm1zLCBpdCB3aWxsIGFkZCBhIGZpbHRlciBncm91cCB0byB0aGUgcXVlcnkgYmFzZWQgb24gdGhlIHNlYXJjaCBrZXl3b3Jkcy5cbiAgICAgKiBAcGFyYW0gcXVlcnkgLSBUaGUgZW50aXR5IHF1ZXJ5IHRvIGV4ZWN1dGUuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJlc3VsdCBvZiB0aGUgcXVlcnkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHF1ZXJ5KHF1ZXJ5OiBFbnRpdHlRdWVyeTxTPiwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGxpc3QgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IHF1ZXJ5OmAsIHF1ZXJ5KTtcblxuICAgICAgICBjb25zdCB7IGF0dHJpYnV0ZXMgfSA9IHF1ZXJ5O1xuXG4gICAgICAgIGxldCBzZWxlY3RBdHRyaWJ1dGVzOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHwgdW5kZWZpbmVkID0gYXR0cmlidXRlcyB8fCB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAvLyBwYXJzZSB0aGUgbGlzdCBvZiBkb3Qtc2VwYXJhdGVkIGF0dHJpYnV0ZS1pZGVudGlmaWVycyBwYXRocyBhbmQgZW5zdXJlIGFsbCB0aGUgcmVxdWlyZWQgbWV0YWRhdGEgaXMgdGhlcmVcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHNlbGVjdEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgc2VsZWN0QXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGVuc3VyZSBhbGwgdGhlIHByb3ZpZGVkIHNlbGVjdCBhdHRyaWJ1dGVzIGhhcyByZXF1aXJlZCBtZXRhZGF0YSBhbGwgdGhlIHdheSBkb3duIHRvIHRoZSBsZWFmIGxldmVsXG4gICAgICAgICAgICBzZWxlY3RBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHNlbGVjdEF0dHJpYnV0ZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaCkge1xuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaCkpIHtcbiAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2ggPSBxdWVyeS5zZWFyY2gudHJpbSgpLnNwbGl0KHRoaXMuZGVsaW1pdGVyc1JlZ2V4ID8/ICcgJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaC5sZW5ndGggPiAwKSB7XG5cbiAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzID0gcXVlcnkuc2VhcmNoQXR0cmlidXRlcyB8fCB0aGlzLmdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRmlsdGVyR3JvdXAgPSBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcyhxdWVyeS5zZWFyY2gsIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuZmlsdGVycyA9IGFkZEZpbHRlckdyb3VwVG9FbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPihzZWFyY2hGaWx0ZXJHcm91cCBhcyBhbnksIHF1ZXJ5LmZpbHRlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXMgPSBhd2FpdCBxdWVyeUVudGl0eTxTPih7XG4gICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZW50aXRpZXMuZGF0YSA9IHRoaXMuc2VyaWFsaXplUmVjb3JkcyhlbnRpdGllcy5kYXRhLCBzZWxlY3RBdHRyaWJ1dGVzKTtcblxuICAgICAgICBpZiAoc2VsZWN0QXR0cmlidXRlcyAmJiBlbnRpdGllcy5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKHNlbGVjdEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAvLyBvbmx5IGF0dHJpYnV0ZXMgaW4gaHlkcmF0ZSBvcHRpb25zIHRoYXQgaGF2ZSByZWxhdGlvbiBtZXRhZGF0YSBhdHRhY2hlZCB0byB0aGVtIG5lZWRzIHRvIGJlIGh5ZHJhdGVkXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0aWVzLmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgLi4uZW50aXRpZXMsIHF1ZXJ5IH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVXBkYXRlcyBhbiBlbnRpdHkgaW4gdGhlIGRhdGFiYXNlLlxuICAgICAqXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqIEBwYXJhbSBkYXRhIC0gVGhlIHVwZGF0ZWQgZGF0YSBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcGFyYW0gcmVtb3ZlIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byByZW1vdmUgZnJvbSB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSB1cGRhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgdXBkYXRlKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+LCBkYXRhOiBVcGRhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4sIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycywgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgICAgIC8vIEluamVjdCBhY3RvciBjb250ZXh0XG4gICAgICAgIGxldCBlbmhhbmNlZERhdGEgPSB0aGlzLmluamVjdEFjdG9yQ29udGV4dChkYXRhIGFzIGFueSwgJ3VwZGF0ZScsIGN0eCk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzID0gdGhpcy5nZXRVbmlxdWVBdHRyaWJ1dGVzKCk7XG4gICAgICAgIGNvbnN0IHNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSA9IDU7XG5cbiAgICAgICAgaWYgKCFza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyAmJiB1bmlxdWVGaWVsZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICBsZXQgdW5pcXVlbmVzc0NoZWNrcyA9IFtdO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZSwgcmVhZE9ubHkgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAocmVhZE9ubHkpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGVuaGFuY2VkRGF0YVsgbmFtZSBhcyBrZXlvZiB0eXBlb2YgZW5oYW5jZWREYXRhIF07XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChuYW1lISBpbiBlbmhhbmNlZERhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gZW5oYW5jZWREYXRhWyBuYW1lIGFzIGtleW9mIHR5cGVvZiBlbmhhbmNlZERhdGEgXTtcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlbmVzc0NoZWNrcy5wdXNoKCgpID0+IHRoaXMuY2hlY2tVbmlxdWVuZXNzQW5kVXBkYXRlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBheWxvYWRUb1VwZGF0ZTogZW5oYW5jZWREYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1cGRhdGVkRW50aXR5ID0gYXdhaXQgdXBkYXRlRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGRhdGE6IGVuaGFuY2VkRGF0YSxcbiAgICAgICAgICAgIG9wZXJhdG9yczogb3BlcmF0b3JzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdXBkYXRlZEVudGl0eTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxldGVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gYmUgZGVsZXRlZC5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgZGVsZXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGRlbGV0ZShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBkZWxldGUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGlkZW50aWZpZXJzOmAsIGlkZW50aWZpZXJzKTtcbiAgICAgICAgXG4gICAgICAgICAgICBjb25zdCBkZWxldGVkRW50aXR5ID0gYXdhaXQgZGVsZXRlRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgICAgIGFjdG9yOiBjdHg/LmFjdG9yLFxuICAgICAgICAgICAgdGVuYW50OiBjdHg/LmFjdG9yPy50ZW5hbnRJZCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiBkZWxldGVkRW50aXR5O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBtdWx0aXBsZSBlbnRpdGllcyBpbiBhIGJhdGNoIG9wZXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBiYXRjaCBkZWxldGluZyBlbnRpdGllcy5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5pZGVudGlmaWVycyAtIEFycmF5IG9mIGVudGl0eSBpZGVudGlmaWVycyB0byBkZWxldGUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuY29uY3VycmVudCAtIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgdG8gcGVyZm9ybSAoZGVmYXVsdDogMSkuXG4gICAgICogQHBhcmFtIGN0eCAtIE9wdGlvbmFsIGV4ZWN1dGlvbiBjb250ZXh0IGNvbnRhaW5pbmcgYWN0b3IgaW5mb3JtYXRpb24uXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gb2JqZWN0IGNvbnRhaW5pbmcgYW55IHVucHJvY2Vzc2VkIGl0ZW1zLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIERlbGV0ZSBtdWx0aXBsZSBlbnRpdGllc1xuICAgICAqIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlcnZpY2UuYmF0Y2hEZWxldGUoe1xuICAgICAqICAgaWRlbnRpZmllcnM6IFtcbiAgICAgKiAgICAgeyBpZDogJ2l0ZW0xJyB9LFxuICAgICAqICAgICB7IGlkOiAnaXRlbTInIH0sXG4gICAgICogICAgIHsgaWQ6ICdpdGVtMycgfVxuICAgICAqICAgXSxcbiAgICAgKiAgIGNvbmN1cnJlbnQ6IDJcbiAgICAgKiB9KTtcbiAgICAgKiBcbiAgICAgKiBpZiAocmVzdWx0LnVucHJvY2Vzc2VkLmxlbmd0aCA+IDApIHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKCdTb21lIGl0ZW1zIHdlcmUgbm90IGRlbGV0ZWQ6JywgcmVzdWx0LnVucHJvY2Vzc2VkKTtcbiAgICAgKiB9XG4gICAgICogYGBgXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGJhdGNoRGVsZXRlKG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyXG4gICAgfSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gY291bnQ6ICR7aWRlbnRpZmllcnMubGVuZ3RofWAsIHtcbiAgICAgICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGVsZXRlQmF0Y2hFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgICAgIGlkczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgICAgICAgICBhY3RvcjogY3R4Py5hY3RvcixcbiAgICAgICAgICAgICAgICB0ZW5hbnQ6IGN0eD8uYWN0b3I/LnRlbmFudElkLFxuICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBFbGVjdHJvREIgYmF0Y2ggZGVsZXRlIHJldHVybnMgeyB1bnByb2Nlc3NlZDogQXJyYXkgfVxuICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChyZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgICAgY29uc3QgZGF0YUNvdW50ID0gcmVzdWx0LmRhdGE/Lmxlbmd0aDtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcHJvY2Vzc2VkOiAke2lkZW50aWZpZXJzLmxlbmd0aH0sIGRhdGFDb3VudDogJHtkYXRhQ291bnR9LCB1bnByb2Nlc3NlZDogJHt1bnByb2Nlc3NlZENvdW50fWApO1xuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGJhdGNoIGRlbGV0ZSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBlbnRpdGllcyBiYXNlZCBvbiBhIHF1ZXJ5IGZpbHRlci5cbiAgICAgKiBUaGlzIG1ldGhvZCBxdWVyaWVzIGZvciBlbnRpdGllcyBtYXRjaGluZyB0aGUgZmlsdGVyIGFuZCB0aGVuIGJhdGNoIGRlbGV0ZXMgdGhlbS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyBieSBxdWVyeS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5maWx0ZXJzIC0gVGhlIGZpbHRlciBjcml0ZXJpYSB0byBtYXRjaCBlbnRpdGllcyBmb3IgZGVsZXRpb24uXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBkZWxldGUgaW4gZWFjaCBiYXRjaCAoZGVmYXVsdDogMjUpLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBOdW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhJdGVtcyAtIE9wdGlvbmFsIG1heGltdW0gbnVtYmVyIG9mIGl0ZW1zIHRvIGRlbGV0ZSAoc2FmZXR5IGxpbWl0KS5cbiAgICAgKiBAcGFyYW0gY3R4IC0gT3B0aW9uYWwgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvcm1hdGlvbi5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3Qgd2l0aCBkZWxldGlvbiBzdGF0aXN0aWNzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIERlbGV0ZSBhbGwgaW5hY3RpdmUgdXNlcnNcbiAgICAgKiBjb25zdCByZXN1bHQgPSBhd2FpdCB1c2VyU2VydmljZS5kZWxldGVCeVF1ZXJ5KHtcbiAgICAgKiAgIGZpbHRlcnM6IHtcbiAgICAgKiAgICAgc3RhdHVzOiB7IGVxOiAnaW5hY3RpdmUnIH0sXG4gICAgICogICAgIGxhc3RMb2dpbkF0OiB7IGx0OiAnMjAyMy0wMS0wMScgfVxuICAgICAqICAgfSxcbiAgICAgKiAgIGJhdGNoU2l6ZTogNTAsXG4gICAgICogICBtYXhJdGVtczogMTAwMFxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIGNvbnNvbGUubG9nKGBEZWxldGVkICR7cmVzdWx0LmRlbGV0ZWRDb3VudH0gaXRlbXMsICR7cmVzdWx0LmZhaWxlZENvdW50fSBmYWlsZWRgKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZGVsZXRlQnlRdWVyeShvcHRpb25zOiB7XG4gICAgICAgIGZpbHRlcnM6IEVudGl0eUZpbHRlckNyaXRlcmlhPFM+LFxuICAgICAgICBiYXRjaFNpemU/OiBudW1iZXIsXG4gICAgICAgIGNvbmN1cnJlbnQ/OiBudW1iZXIsXG4gICAgICAgIG1heEl0ZW1zPzogbnVtYmVyXG4gICAgfSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBmaWx0ZXJzLCBiYXRjaFNpemUgPSAyNSwgY29uY3VycmVudCA9IDEsIG1heEl0ZW1zIH0gPSBvcHRpb25zO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDYWxsZWQgfiBkZWxldGVCeVF1ZXJ5IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgICAgICBiYXRjaFNpemUsXG4gICAgICAgICAgICAgICAgbWF4SXRlbXNcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBTYWZldHkgY2hlY2s6IHJlcXVpcmUgZmlsdGVycyB0byBwcmV2ZW50IGFjY2lkZW50YWwgZGVsZXRpb24gb2YgYWxsIHJlY29yZHNcbiAgICAgICAgICAgIGlmICghZmlsdGVycyB8fCBpc0VtcHR5T2JqZWN0RGVlcChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignZGVsZXRlQnlRdWVyeSByZXF1aXJlcyBmaWx0ZXJzIHRvIHByZXZlbnQgYWNjaWRlbnRhbCBkZWxldGlvbiBvZiBhbGwgcmVjb3Jkcy4gVXNlIHNjYW4gd2l0aCBleHBsaWNpdCBjb25maXJtYXRpb24gaWYgeW91IG5lZWQgdG8gZGVsZXRlIGFsbCByZWNvcmRzLicpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgZGVsZXRlZENvdW50ID0gMDtcbiAgICAgICAgICAgIGxldCBmYWlsZWRDb3VudCA9IDA7XG4gICAgICAgICAgICBsZXQgY3Vyc29yOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgICAgICAgIGxldCB0b3RhbFByb2Nlc3NlZCA9IDA7XG5cbiAgICAgICAgICAgIC8vIFF1ZXJ5IGFuZCBkZWxldGUgaW4gYmF0Y2hlc1xuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICAgIC8vIEZldGNoIGEgYmF0Y2ggb2YgaXRlbXMgdG8gZGVsZXRlXG4gICAgICAgICAgICAgICAgY29uc3QgcXVlcnlSZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgY291bnQ6IGJhdGNoU2l6ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogY3Vyc29yIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yZGVyOiAnYXNjJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhZ2VyOiAnY3Vyc29yJ1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSwgY3R4KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGl0ZW1zVG9EZWxldGUgPSBxdWVyeVJlc3VsdC5kYXRhO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghaXRlbXNUb0RlbGV0ZSB8fCBpdGVtc1RvRGVsZXRlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRGVsZXRpbmcgYmF0Y2ggb2YgJHtpdGVtc1RvRGVsZXRlLmxlbmd0aH0gaXRlbXNgKTtcblxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZnJvbSB0aGUgZmV0Y2hlZCBpdGVtc1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzID0gaXRlbXNUb0RlbGV0ZS5tYXAoaXRlbSA9PiBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaXRlbSBhcyBhbnkpXG4gICAgICAgICAgICAgICAgKSBhcyBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PjtcblxuICAgICAgICAgICAgICAgIC8vIEJhdGNoIGRlbGV0ZSB0aGUgaXRlbXNcbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVSZXN1bHQgPSBhd2FpdCB0aGlzLmJhdGNoRGVsZXRlKHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgICAgICB9LCBjdHgpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChkZWxldGVSZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGRhdGFDb3VudCA9IGRlbGV0ZVJlc3VsdC5kYXRhPy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2hEZWxldGVkQ291bnQgPSBpZGVudGlmaWVycy5sZW5ndGggLSB1bnByb2Nlc3NlZENvdW50O1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudCArPSBiYXRjaERlbGV0ZWRDb3VudDtcbiAgICAgICAgICAgICAgICBmYWlsZWRDb3VudCArPSB1bnByb2Nlc3NlZENvdW50O1xuICAgICAgICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkICs9IGl0ZW1zVG9EZWxldGUubGVuZ3RoO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEJhdGNoIHJlc3VsdDogJHtiYXRjaERlbGV0ZWRDb3VudH0gZGVsZXRlZCwgJHt1bnByb2Nlc3NlZENvdW50fSBmYWlsZWRgKTtcblxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGhpdCB0aGUgbWF4IGl0ZW1zIGxpbWl0XG4gICAgICAgICAgICAgICAgaWYgKG1heEl0ZW1zICYmIHRvdGFsUHJvY2Vzc2VkID49IG1heEl0ZW1zKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJlYWNoZWQgbWF4SXRlbXMgbGltaXQgb2YgJHttYXhJdGVtc30sIHN0b3BwaW5nIGRlbGV0aW9uYCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBjdXJzb3IgZm9yIG5leHQgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yIHx8IG51bGw7XG5cbiAgICAgICAgICAgIH0gd2hpbGUgKGN1cnNvcik7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbXBsZXRlZCB+IGRlbGV0ZUJ5UXVlcnkgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGRlbGV0ZWQ6ICR7ZGVsZXRlZENvdW50fSwgZmFpbGVkOiAke2ZhaWxlZENvdW50fWApO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudCxcbiAgICAgICAgICAgICAgICBmYWlsZWRDb3VudCxcbiAgICAgICAgICAgICAgICB0b3RhbFByb2Nlc3NlZFxuICAgICAgICAgICAgfTtcblxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSBieSBxdWVyeSBmb3IgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byBkZWxldGUgYnkgcXVlcnkgZm9yICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWJ1aWxkcyBhbGwgaW5kZXhlcyBmb3IgdGhlIGVudGl0eSBieSB3cml0aW5nIHRvIHRoZSBwcmltYXJ5IGluZGV4LlxuICAgICAqIFRoaXMgbWV0aG9kIGlzIHVzZWZ1bCBmb3IgbWFpbnRhaW5pbmcgZGF0YSBpbnRlZ3JpdHkgYW5kIGVuc3VyaW5nIGluZGV4ZXMgYXJlIHByb3Blcmx5IHVwZGF0ZWQuXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBPcHRpb25zIGZvciByZWJ1aWxkaW5nIHRoZSBpbmRleFxuICAgICAqIEBwYXJhbSBvcHRpb25zLmJhdGNoU2l6ZSAtIFRoZSBudW1iZXIgb2YgaXRlbXMgdG8gcHJvY2VzcyBpbiBlYWNoIGJhdGNoLiBEZWZhdWx0cyB0byAxMDAuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgaW5kZXggcmVidWlsZCBpcyBjb21wbGV0ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgcmVidWlsZEluZGV4KG9wdGlvbnM6IHsgYmF0Y2hTaXplPzogbnVtYmVyIH0gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBiYXRjaFNpemUgPSAxMDAgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gdGhpcy5nZXRFbnRpdHlOYW1lKCk7XG4gICAgICAgICAgICBjb25zdCByZXBvc2l0b3J5ID0gdGhpcy5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFN0YXJ0aW5nIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuXG4gICAgICAgICAgICAvLyBHZXQgYWxsIHJlY29yZHMgZnJvbSB0aGUgcHJpbWFyeSBpbmRleFxuICAgICAgICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IGF3YWl0IHJlcG9zaXRvcnkuc2Nhbi5nbygpO1xuXG4gICAgICAgICAgICBpZiAoIWFsbFJlY29yZHMuZGF0YSB8fCBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gcmVjb3JkcyBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCAke2FsbFJlY29yZHMuZGF0YS5sZW5ndGh9IHJlY29yZHMgdG8gcHJvY2VzcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaGVzXG4gICAgICAgICAgICBjb25zdCB0b3RhbFJlY29yZHMgPSBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3QgdG90YWxCYXRjaGVzID0gTWF0aC5jZWlsKHRvdGFsUmVjb3JkcyAvIGJhdGNoU2l6ZSk7XG5cbiAgICAgICAgICAgIGZvciAobGV0IGJhdGNoSW5kZXggPSAwOyBiYXRjaEluZGV4IDwgdG90YWxCYXRjaGVzOyBiYXRjaEluZGV4KyspIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IGJhdGNoSW5kZXggKiBiYXRjaFNpemU7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyBiYXRjaFNpemUsIHRvdGFsUmVjb3Jkcyk7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2ggPSBhbGxSZWNvcmRzLmRhdGEuc2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGJhdGNoICR7YmF0Y2hJbmRleCArIDF9LyR7dG90YWxCYXRjaGVzfSAoJHtzdGFydCArIDF9LSR7ZW5kfSBvZiAke3RvdGFsUmVjb3Jkc30gcmVjb3JkcylgKTtcblxuICAgICAgICAgICAgICAgIC8vIFJlYnVpbGQgYWxsIGluZGV4ZXMgYnkgdXBzZXJ0aW5nIGVhY2ggcmVjb3JkIHRvIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSB1cHNlcnQgdG8gZW5zdXJlIHRoZSByZWNvcmQgaXMgcHJvcGVybHkgaW5kZXhlZFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVwb3NpdG9yeS51cHNlcnQocmVjb3JkKS5nbygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVjb3JkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbmZlcnMgcmVsYXRpb25zaGlwcyBiZXR3ZWVuIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBzY2hlbWEgYW5kIHNlbGVjdGlvbi1wYXRocy5cbiAgICAgKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBwYXRocyBUaGUgcGFyc2VkIHNlbGVjdGlvbiBwYXRocyBmcm9tIGUuZy4gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocygpLlxuICAgICAqIEBwYXJhbSBwYXRoS2V5IFRoZSBjdXJyZW50IFwicGF0aFwiIHN0cmluZyByZXByZXNlbnRpbmcgaG93IHdlIGFycml2ZWQgaGVyZSAoZGVmYXVsdHMgdG8gdGhlIGVudGl0eSBuYW1lKS5cbiAgICAgKiBAcGFyYW0gdmlzaXRlZFBhdGhzIEEgc2V0IG9mIHBhdGgtc3RyaW5ncyB2aXNpdGVkIHNvIGZhciBpbiB0aGlzIHJlY3Vyc2lvbiBjaGFpbiAocHJldmVudHMgY3ljbGVzKS5cbiAgICAgKiBAcGFyYW0gbWF4RGVwdGggTWF4aW11bSByZWN1cnNpb24gZGVwdGggKG9wdGlvbmFsKS5cbiAgICAgKi9cbiAgICBpbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgICAgICBzY2hlbWE6IEUsXG4gICAgICAgIHBhdGhzOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyxcbiAgICAgICAgcGF0aEtleTogc3RyaW5nID0gc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgdmlzaXRlZFBhdGhzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQ8c3RyaW5nPigpLFxuICAgICAgICBtYXhEZXB0aCA9IDVcbiAgICApOiBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPiB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ2luZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMnLCB7IHBhdGhLZXksIHBhdGhzIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGV4Y2VlZCBtYXggZGVwdGgsIHdlIHNraXAgZXhwYW5zaW9uc1xuICAgICAgICBpZiAobWF4RGVwdGggPD0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTWF4IHJlY3Vyc2lvbiBkZXB0aCByZWFjaGVkIGF0IHBhdGhLZXk9XCIke3BhdGhLZXl9XCJgKTtcbiAgICAgICAgICAgIHJldHVybiB7fSBhcyBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZmVycmVkOiBhbnkgPSB7fTtcblxuICAgICAgICAvLyBMb29wIG92ZXIgZWFjaCBhdHRyaWJ1dGUgaW4gdGhlIGVudGl0eSBzY2hlbWFcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpLmZvckVhY2goKFsgYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlTWV0YSBdKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhdHRWYWwgPSBwYXRoc1sgYXR0cmlidXRlTmFtZSBdO1xuICAgICAgICAgICAgaWYgKCFhdHRWYWwpIHtcbiAgICAgICAgICAgICAgICAvLyBOb3Qgc2VsZWN0ZWQgaW4gdGhlIHVzZXIncyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpc1JlbGF0aW9uYWwgPSAhIWF0dHJpYnV0ZU1ldGEucmVsYXRpb247XG5cbiAgICAgICAgICAgIC8vIElmIHRoZSBhdHRyaWJ1dGUgaXMgbm90IHJlbGF0aW9uYWwgb3IgdGhlIHZhbHVlIGlzIGEgYm9vbGVhbiwgd2UgY2FuIGluZmVyIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGlmICghaXNSZWxhdGlvbmFsIHx8IGlzQm9vbGVhbihhdHRWYWwpKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dFZhbDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEl0J3MgYSByZWxhdGlvbmFsIGF0dHJpYnV0ZTsgcHJlcGFyZSB0byByZWN1cnNlXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbk1ldGEgPSBhdHRyaWJ1dGVNZXRhLnJlbGF0aW9uITtcbiAgICAgICAgICAgIGNvbnN0IG5leHRFbnRpdHlOYW1lID0gcmVsYXRpb25NZXRhLmVudGl0eU5hbWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgbmV3IFwicGF0aFwiIHN0cmluZyB0byBkZXRlY3QgY3ljbGVzIChlLmcuIFwiVXNlci5ncm91cHMuR3JvdXAubWVtYmVycy5Vc2VyXCIpXG4gICAgICAgICAgICBjb25zdCBuZXdQYXRoID0gYCR7cGF0aEtleX0uJHthdHRyaWJ1dGVOYW1lfS4ke25leHRFbnRpdHlOYW1lfWA7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGFscmVhZHkgdmlzaXRlZCB0aGlzIHBhdGgsIGlmIHNvID0+IHNraXAgZXhwYW5zaW9ucyBmb3IgdGhpcyBhdHRyaWJ1dGUgb25seVxuICAgICAgICAgICAgaWYgKHZpc2l0ZWRQYXRocy5oYXMobmV3UGF0aCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTa2lwcGluZyBjeWMgcmVsYXRpb24gZXhwYW5zaW9ucyBmb3I6ICR7bmV3UGF0aH1gKTtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2tpcHBlZER1ZVRvQ3ljbGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIE1hcmsgdGhpcyBwYXRoIGFzIHZpc2l0ZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5hZGQobmV3UGF0aCk7XG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gdGhlIHJlbGF0ZWQgZW50aXR5J3Mgc2NoZW1hXG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihuZXh0RW50aXR5TmFtZSk7XG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgdGhlIFwibWV0YVwiIG9iamVjdCB0aGF0IHdlIHN0b3JlXG4gICAgICAgICAgICBjb25zdCBtZXRhOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24gPSB7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcmVsYXRpb25UeXBlOiByZWxhdGlvbk1ldGEudHlwZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaXNGdW5jdGlvbihyZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgICAgID8gcmVsYXRpb25NZXRhLmlkZW50aWZpZXJzKClcbiAgICAgICAgICAgICAgICAgICAgOiByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlczoge30sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgcGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBpc09iamVjdChhdHRWYWwpID8gYXR0VmFsLmF0dHJpYnV0ZXMgOiB1bmRlZmluZWQ7IC8vIHByb3ZpZGVkIGJ5IHRoZSB1c2VyIFxuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRpb25NZXRhLmF0dHJpYnV0ZXM7IC8vIGRlZmluZWQgaW4gdGhlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcyA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTsgLy8gYXV0byBnZW4gYnkgZnJhbWV3b3JrXG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gZXhwYW5kIGNoaWxkJ3MgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgbWV0YS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgKHBhdGhTZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0aW9uU2VsZWN0aW9uQXR0cmlidXRlcyB8fCByZWxhdGVkRW50aXR5RGVmYXVsdFNlbGVjdGlvbkF0dHJpYnV0ZXMpIGFzIGFueSxcbiAgICAgICAgICAgICAgICBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICB2aXNpdGVkUGF0aHMsXG4gICAgICAgICAgICAgICAgbWF4RGVwdGggLSAxXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gbWV0YTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHRoaXMgcGF0aCBzbyBzaWJsaW5ncyBjYW4gYWxzbyBleHBhbmQgaXQgaWYgbmVlZGVkXG4gICAgICAgICAgICB2aXNpdGVkUGF0aHMuZGVsZXRlKG5ld1BhdGgpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gaW5mZXJyZWQ7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHNlYXJjaChxdWVyeTogRW50aXR5U2VhcmNoUXVlcnk8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXF1ZXJ5LnNlbGVjdCkge1xuICAgICAgICAgICAgLy8gKiBOb3RlOiB3ZSBleHBlY3QgYW4gYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzXG4gICAgICAgICAgICBxdWVyeS5zZWxlY3QgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpIGFzIGFueTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2VhcmNoU2VydmljZS5zZWFyY2gocXVlcnksIHVuZGVmaW5lZCwgY3R4KTtcbiAgICB9XG59XG5cbmNvbnN0IGVudGl0eUF0dHJpYnV0ZUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZScpO1xuXG5leHBvcnQgZnVuY3Rpb24gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShhdHRJZDogc3RyaW5nLCBhdHQ6IEVudGl0eUF0dHJpYnV0ZSk6IFBhcnRpYWw8RW50aXR5QXR0cmlidXRlPiAmIHtcbiAgICBpZDogc3RyaW5nLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW11cbn0ge1xuXG4gICAgY29uc3QgeyBuYW1lLCB2YWxpZGF0aW9ucywgcmVxdWlyZWQsIHJlbGF0aW9uLCBkZWZhdWx0OiBkZWZhdWx0VmFsdWUsIGdldDogX2dldHRlciwgc2V0OiBfc2V0dGVyLCB3YXRjaCwgLi4ucmVzdE1ldGEgfSA9IGF0dDtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUsIC4uLnJlc3RSZWxhdGlvbiB9ID0gcmVsYXRpb24gfHwge307XG5cbiAgICBjb25zdCByZWxhdGlvbk1ldGEgPSByZWxhdGVkRW50aXR5TmFtZSA/IHsgLi4ucmVzdFJlbGF0aW9uLCBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSB9IDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3QgeyBpdGVtcywgdHlwZSwgcHJvcGVydGllcywgYWRkTmV3T3B0aW9uLCBhZGROZXdPcHRpb25Db25maWcsIGZpZWxkVHlwZTogZXhwbGljaXRGaWVsZFR5cGUsIG9wdGlvbnMsIC4uLnJlc3RSZXN0TWV0YSB9ID0gcmVzdE1ldGEgYXMgYW55O1xuXG4gICAgLy8gSW5mZXIgZmllbGRUeXBlIGZyb20gdHlwZSBpZiBub3QgZXhwbGljaXRseSBwcm92aWRlZFxuICAgIGxldCBpbmZlcnJlZEZpZWxkVHlwZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gZXhwbGljaXRGaWVsZFR5cGU7XG4gICAgaWYgKCFpbmZlcnJlZEZpZWxkVHlwZSAmJiB0eXBlKSB7XG4gICAgICAgIGlmICh0eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2Jvb2xlYW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdudW1iZXInO1xuICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodHlwZSkpIHtcbiAgICAgICAgICAgIC8vIEVudW0gdHlwZSBsaWtlIFsnYWN0aXZlJywgJ2luYWN0aXZlJ11cbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ3NlbGVjdCc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycgJiYgb3B0aW9ucyAmJiBBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmIG9wdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gU3RyaW5nIHdpdGggb3B0aW9ucyBpcyBhIHNlbGVjdFxuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnc2VsZWN0JztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnYW55Jykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnanNvbic7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ21hcCc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdsaXN0JztcbiAgICAgICAgfVxuICAgICAgICAvLyBGb3IgZGF0ZSBmaWVsZHMsIGNoZWNrIGF0dHJpYnV0ZSBuYW1lIGFzIGhpbnRcbiAgICAgICAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGNvbnN0IGxvd2VyQXR0SWQgPSBhdHRJZC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgaWYgKGxvd2VyQXR0SWQuaW5jbHVkZXMoJ2RhdGUnKSB8fCBsb3dlckF0dElkID09PSAnY3JlYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAndXBkYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAnZGVsZXRlZGF0Jykge1xuICAgICAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2RhdGV0aW1lJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci5kZWJ1ZyhgaW5mZXJyZWRGaWVsZFR5cGU6ICR7aW5mZXJyZWRGaWVsZFR5cGV9IGZvciBlbnRpdHkgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cImApO1xuICAgIH1cblxuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi5yZXN0UmVzdE1ldGEsXG4gICAgICAgIHR5cGUsXG4gICAgICAgIGlkOiBhdHRJZCxcbiAgICAgICAgbmFtZTogbmFtZSB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKGF0dElkKSxcbiAgICAgICAgcmVsYXRpb246IHJlbGF0aW9uTWV0YSBhcyBhbnksXG4gICAgICAgIGRlZmF1bHRWYWx1ZSxcbiAgICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25zIHx8IHJlcXVpcmVkID8gWyAncmVxdWlyZWQnIF0gOiBbXSxcbiAgICAgICAgaXNWaXNpYmxlOiAhKCdpc1Zpc2libGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzVmlzaWJsZSxcbiAgICAgICAgaXNFZGl0YWJsZTogISgnaXNFZGl0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNFZGl0YWJsZSxcbiAgICAgICAgaXNMaXN0YWJsZTogISgnaXNMaXN0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNMaXN0YWJsZSxcbiAgICAgICAgaXNDcmVhdGFibGU6ICEoJ2lzQ3JlYXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0NyZWF0YWJsZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiAhKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzRmlsdGVyYWJsZSxcbiAgICAgICAgaXNTZWFyY2hhYmxlOiAhKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzU2VhcmNoYWJsZSxcbiAgICB9XG5cbiAgICAvLyBBZGQgaW5mZXJyZWQgb3IgZXhwbGljaXQgZmllbGRUeXBlXG4gICAgaWYgKGluZmVycmVkRmllbGRUeXBlKSB7XG4gICAgICAgIGZvcm1hdHRlZC5maWVsZFR5cGUgPSBpbmZlcnJlZEZpZWxkVHlwZTtcbiAgICB9IGVsc2UgaWYgKCFleHBsaWNpdEZpZWxkVHlwZSAmJiB0eXBlICYmIHR5cGUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIExvZyB3YXJuaW5nIGZvciBub24tc3RyaW5nIHR5cGVzIHdlIGNvdWxkbid0IGluZmVyXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci53YXJuKGDimqDvuI8gQ291bGQgbm90IGluZmVyIGZpZWxkVHlwZSBmb3IgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cIi4gQ29uc2lkZXIgYWRkaW5nIGV4cGxpY2l0IGZpZWxkVHlwZS5gKTtcbiAgICB9XG4gICAgXG4gICAgLy8gQWRkIG9wdGlvbnMgYmFjayBpZiB0aGV5IGV4aXN0XG4gICAgaWYgKG9wdGlvbnMpIHtcbiAgICAgICAgZm9ybWF0dGVkLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIH1cblxuICAgIC8vIFBhc3MgdGhyb3VnaCBib3RoIG9sZCBhbmQgbmV3IGFkZE5ld09wdGlvbiBmb3JtYXRzXG4gICAgaWYgKGFkZE5ld09wdGlvbkNvbmZpZykge1xuICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSBhZGROZXdPcHRpb25Db25maWc7XG4gICAgfVxuICAgIGlmIChhZGROZXdPcHRpb24pIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uJyBdID0gYWRkTmV3T3B0aW9uO1xuICAgIH1cblxuICAgIC8vXG4gICAgLy8gKiogbWFrZSBzdXJlIHRvIG5vdCBvdmVycmlkZSB0aGUgaW5uZXIgZmllbGRzIG9mIGF0dHJpYnV0ZXMgbGlrZSBgbGlzdC1baXRlbXNdLVttYXBdLXByb3BlcnRpZXNgICoqXG4gICAgLy9cbiAgICBpZiAodHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAncHJvcGVydGllcycgXSA9IE9iamVjdC5lbnRyaWVzPGFueT4ocHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSk7XG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnbGlzdCcgJiYgaXRlbXMudHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAuLi5pdGVtcyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IE9iamVjdC5lbnRyaWVzPGFueT4oaXRlbXMucHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkXG59XG5cbmV4cG9ydCB0eXBlIFRJT1NjaGVtYUF0dHJpYnV0ZSA9IFJldHVyblR5cGU8dHlwZW9mIGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGU+O1xuZXhwb3J0IHR5cGUgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IE1hcDxrZXlvZiBTWyAnYXR0cmlidXRlcycgXSwgVElPU2NoZW1hQXR0cmlidXRlPjtcblxuLyoqXG4gKiBDcmVhdGVzIGFuIGFjY2VzcyBwYXR0ZXJucyBzY2hlbWEgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGVudGl0eSBzY2hlbWEuXG4gKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgQSBtYXAgb2YgYWNjZXNzIHBhdHRlcm5zLCB3aGVyZSB0aGUga2V5cyBhcmUgdGhlIGluZGV4IG5hbWVzIGFuZCB0aGUgdmFsdWVzIGFyZSBtYXBzIG9mIGF0dHJpYnV0ZSBuYW1lcyBhbmQgdGhlaXIgY29ycmVzcG9uZGluZyBzY2hlbWEgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihzY2hlbWE6IFMpIHtcbiAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG5ldyBNYXA8a2V5b2YgU1sgJ2luZGV4ZXMnIF0sIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4+KCk7XG5cbiAgICBmb3IgKGNvbnN0IGluZGV4TmFtZSBpbiBzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICBjb25zdCBpbmRleEF0dHJpYnV0ZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4gPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhQa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0ucGsuY29tcG9zaXRlKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgaWR4UGtBdHQgXTtcbiAgICAgICAgICAgIGluZGV4QXR0cmlidXRlcy5zZXQoaWR4UGtBdHQsIHtcbiAgICAgICAgICAgICAgICAuLi5lbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGlkeFBrQXR0LCB7IC4uLmF0dCwgcmVxdWlyZWQ6IHRydWUgfSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhTa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0uc2s/LmNvbXBvc2l0ZSA/PyBbXSkge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGlkeFNrQXR0IF07XG4gICAgICAgICAgICBpbmRleEF0dHJpYnV0ZXMuc2V0KGlkeFNrQXR0LCB7XG4gICAgICAgICAgICAgICAgLi4uZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShpZHhTa0F0dCwgeyAuLi5hdHQsIHJlcXVpcmVkOiB0cnVlIH0pXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFjY2Vzc1BhdHRlcm5zLnNldChpbmRleE5hbWUsIGluZGV4QXR0cmlidXRlcyk7XG4gICAgfVxuXG4gICAgLy8gbWFrZSBzdXJlIHRoZXJlJ3MgYSBwcmltYXJ5IGFjY2VzcyBwYXR0ZXJuO1xuICAgIGlmICghYWNjZXNzUGF0dGVybnMuaGFzKCdwcmltYXJ5JykpIHtcbiAgICAgICAgYWNjZXNzUGF0dGVybnMuc2V0KCdwcmltYXJ5JywgYWNjZXNzUGF0dGVybnMudmFsdWVzKCkubmV4dCgpLnZhbHVlISk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFjY2Vzc1BhdHRlcm5zO1xufVxuIl19