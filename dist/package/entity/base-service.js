"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseEntityService = void 0;
exports.hasAttribute = hasAttribute;
exports.isAttributeReadOnly = isAttributeReadOnly;
exports.hasAttributeBy = hasAttributeBy;
exports.getAttributeNameBy = getAttributeNameBy;
exports.entityAttributeToIOSchemaAttribute = entityAttributeToIOSchemaAttribute;
exports.makeEntityAccessPatternsSchema = makeEntityAccessPatternsSchema;
const di_1 = require("../di");
const execution_context_1 = require("../core/runtime/execution-context");
const logging_1 = require("../logging");
const services_1 = require("../search/services");
const observed_1 = require("../observability/decorators/observed");
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
        if (entity?.data) {
            // Decompress fields after reading from DB
            entity.data = this.decompressFields(entity.data);
            if (!!formattedAttributes) {
                const relationalAttributes = Object.entries(formattedAttributes)?.map(([attributeName, options]) => [attributeName, options])
                    .filter(([, options]) => (0, utils_1.isObject)(options));
                if (relationalAttributes.length) {
                    await this.hydrateRecords(relationalAttributes, [entity.data]);
                }
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
        if (entity?.data) {
            // Decompress all records
            entity.data = entity.data.map(record => this.decompressFields(record));
            if (!!formattedAttributes) {
                const relationalAttributes = Object.entries(formattedAttributes)?.map(([attributeName, options]) => [attributeName, options])
                    .filter(([, options]) => (0, utils_1.isObject)(options));
                if (relationalAttributes.length) {
                    await this.hydrateRecords(relationalAttributes, entity.data);
                }
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
        // Prefer explicit ctx.actor, otherwise fall back to framework execution-context (AsyncLocalStorage).
        // This is important for background handlers (queues/tasks) where ctx may not be threaded through.
        const effectiveActor = ctx?.actor ?? (0, execution_context_1.getCurrentExecutionContext)()?.actor;
        if (!effectiveActor) {
            this.logger.debug('BaseEntityService: No actor context found, skipping injection');
            return data;
        }
        const schema = this.getEntitySchema();
        const enhancedData = { ...data };
        const actor = effectiveActor;
        // IMPORTANT: We do NOT persist/propagate parentObservabilityLogId across hops.
        // parentObservabilityLogId is strict hierarchy within a single invocation's persisted slice.
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
        const cleanActor = Object.fromEntries(Object.entries({
            ...actor,
        }).filter(([_, value]) => value !== undefined));
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
        // Compress fields before writing
        payloadCopy = this.compressFields(payloadCopy);
        const entity = await (0, crud_service_1.createEntity)({
            data: payloadCopy,
            entityName: this.getEntityName(),
            entityService: this,
        });
        // Decompress fields after reading
        return this.decompressFields(entity);
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
        // Inject actor context so DynamoDB images always have _actor for auditing/causedBy
        // Treat upsert as an update for actor-field purposes (we always want _actor and updatedBy/updatedAt).
        let payloadCopy = this.injectActorContext({ ...payload }, 'upsert');
        // Compress fields before writing
        payloadCopy = this.compressFields(payloadCopy);
        const result = await (0, crud_service_1.upsertEntity)({
            data: payloadCopy,
            entityName: this.getEntityName(),
            entityService: this,
        });
        // Decompress result fields
        return {
            ...result,
            data: result.data ? this.decompressFields(result.data) : result.data,
            oldData: result.oldData ? this.decompressFields(result.oldData) : undefined
        };
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
        // Decompress all records
        entities.data = entities.data.map(record => this.decompressFields(record));
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
        // Decompress all records
        entities.data = entities.data.map(record => this.decompressFields(record));
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
        // Compress fields before writing
        enhancedData = this.compressFields(enhancedData);
        const updatedEntity = await (0, crud_service_1.updateEntity)({
            id: identifiers,
            data: enhancedData,
            operators: operators,
            entityName: this.getEntityName(),
            entityService: this,
        });
        // Decompress fields after reading
        return this.decompressFields(updatedEntity);
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
        const result = await searchService.search(query, undefined, ctx);
        // Decompress hits if present
        if (result?.hits && Array.isArray(result.hits)) {
            result.hits = result.hits.map(hit => this.decompressFields(hit));
        }
        return result;
    }
    /**
     * Compress fields marked with `compressed: true` in schema.
     * Called automatically before writing to DB.
     */
    compressFields(data) {
        const attributes = this.getEntitySchema().attributes;
        const result = { ...data };
        for (const [fieldName, attribute] of Object.entries(attributes)) {
            if (!attribute.compressed || !(fieldName in result))
                continue;
            const threshold = typeof attribute.compressed === 'object'
                ? attribute.compressed.threshold
                : 10 * 1024; // Default 10KB
            result[fieldName] = (0, utils_1.compressIfNeeded)(result[fieldName], threshold);
        }
        return result;
    }
    /**
     * Decompress fields that have compressed data.
     * Called automatically after reading from DB.
     */
    decompressFields(data) {
        return (0, utils_1.decompressItem)(data);
    }
}
exports.BaseEntityService = BaseEntityService;
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', hydration: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [relations, rootRecords] = args;
                const relationCount = Array.isArray(relations) ? relations.length : 0;
                const recordCount = Array.isArray(rootRecords) ? rootRecords.length : 0;
                return {
                    tags: {
                        entityName: instance.getEntityName(),
                    },
                    metrics: {
                        relationCount,
                        recordCount,
                    }
                };
            }
        }
    })
], BaseEntityService.prototype, "hydrateRecords", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: instance.getEntityName() }
            }),
            finish: ({ result }) => ({
                tags: { found: !!result }
            })
        }
    })
], BaseEntityService.prototype, "get", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', batch: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [options] = args;
                const batchSize = Array.isArray(options?.identifiers) ? options.identifiers.length : 0;
                const concurrent = typeof options?.concurrent === 'number' ? options.concurrent : 1;
                return {
                    tags: { entityName: instance.getEntityName() },
                    metrics: { batchSize, concurrent }
                };
            },
            finish: ({ result }) => {
                const r = result;
                const retrievedCount = Array.isArray(r?.data) ? r.data.length : 0;
                const unprocessedCount = Array.isArray(r?.unprocessed) ? r.unprocessed.length : 0;
                return { metrics: { retrievedCount, unprocessedCount } };
            }
        }
    })
], BaseEntityService.prototype, "batchGet", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: instance.getEntityName() }
            })
        }
    })
], BaseEntityService.prototype, "create", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: instance.getEntityName() }
            }),
            finish: ({ result }) => ({
                tags: { wasCreated: !!result?.wasCreated }
            })
        }
    })
], BaseEntityService.prototype, "upsert", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: instance.getEntityName() }
            })
        }
    })
], BaseEntityService.prototype, "duplicate", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        extract: {
            start: ({ instance, args }) => {
                const [query] = args;
                const hasFilters = !!query?.filters && Object.keys(query.filters).length > 0;
                return {
                    tags: {
                        entityName: instance.getEntityName(),
                        hasFilters,
                    }
                };
            },
            finish: ({ result }) => {
                const r = result;
                const resultCount = Array.isArray(r?.data) ? r.data.length : 0;
                return {
                    tags: { hasCursor: !!r?.cursor },
                    metrics: { resultCount }
                };
            }
        }
    })
], BaseEntityService.prototype, "list", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        extract: {
            start: ({ instance, args }) => {
                const [query] = args;
                const hasFilters = !!query?.filters && Object.keys(query.filters).length > 0;
                return {
                    tags: {
                        entityName: instance.getEntityName(),
                        hasFilters,
                    }
                };
            },
            finish: ({ result }) => {
                const r = result;
                const resultCount = Array.isArray(r?.data) ? r.data.length : 0;
                return { metrics: { resultCount } };
            }
        }
    })
], BaseEntityService.prototype, "query", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: instance.getEntityName() }
            })
        }
    })
], BaseEntityService.prototype, "update", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' },
        sourceType: 'service',
        tags: { operation_category: 'delete' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: instance.getEntityName() }
            })
        }
    })
], BaseEntityService.prototype, "delete", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' }, // Batch deletes are critical
        sourceType: 'service',
        tags: { operation_category: 'delete', batch: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [options] = args;
                const batchSize = Array.isArray(options?.identifiers) ? options.identifiers.length : 0;
                const concurrent = typeof options?.concurrent === 'number' ? options.concurrent : 1;
                return {
                    tags: { entityName: instance.getEntityName() },
                    metrics: { batchSize, concurrent }
                };
            },
            finish: ({ result }) => {
                const r = result;
                const deletedCount = Array.isArray(r?.data) ? r.data.length : 0;
                const unprocessedCount = Array.isArray(r?.unprocessed) ? r.unprocessed.length : 0;
                return { metrics: { deletedCount, unprocessedCount } };
            }
        }
    })
], BaseEntityService.prototype, "batchDelete", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' }, // Bulk deletes are dangerous
        sourceType: 'service',
        tags: { operation_category: 'delete', batch: 'true', bulk: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [options] = args;
                const maxItems = options?.maxItems;
                const batchSize = typeof options?.batchSize === 'number' ? options.batchSize : 25;
                return ({
                    tags: {
                        entityName: instance.getEntityName(),
                        hasFilters: (() => {
                            return !!options?.filters && Object.keys(options.filters).length > 0;
                        })(),
                    },
                    metrics: {
                        batchSize,
                        ...(typeof maxItems === 'number' ? { maxItems } : {}),
                    }
                });
            },
            finish: ({ result }) => ({
                metrics: {
                    deletedCount: result?.deletedCount || 0,
                    failedCount: result?.failedCount || 0,
                    totalProcessed: result?.totalProcessed || 0,
                }
            })
        }
    })
], BaseEntityService.prototype, "deleteByQuery", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' }, // Index rebuilds are critical operations
        sourceType: 'service',
        tags: { operation_category: 'maintenance', batch: 'true' },
        extract: {
            start: ({ instance, args }) => ({
                tags: { entityName: instance.getEntityName() },
                metrics: {
                    batchSize: (() => {
                        const [options] = args;
                        return typeof options?.batchSize === 'number' ? options.batchSize : 100;
                    })()
                }
            }),
            finish: () => ({
                tags: { completed: true }
            })
        }
    })
], BaseEntityService.prototype, "rebuildIndex", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', search: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [query] = args;
                const hasQuery = !!query?.q;
                const hasFilters = !!query?.filter && Object.keys(query.filter).length > 0;
                return {
                    tags: {
                        entityName: instance.getEntityName(),
                        hasQuery,
                        hasFilters,
                    }
                };
            },
            finish: ({ result }) => {
                const r = result;
                const hitCount = Array.isArray(r?.hits) ? r.hits.length : 0;
                const totalHits = typeof r?.estimatedTotalHits === 'number' ? r.estimatedTotalHits : 0;
                return { metrics: { hitCount, totalHits } };
            }
        }
    })
], BaseEntityService.prototype, "search", null);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBa0NBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQWt0RUQsZ0ZBaUdDO0FBVUQsd0VBNkJDO0FBeDVFRCw4QkFBb0M7QUFNcEMseUVBRTJDO0FBRTNDLHdDQUEwQztBQUMxQyxpREFBNEU7QUFFNUUsbUVBQWdFO0FBQ2hFLHlEQUFtRTtBQUNuRSxvQ0FBaVE7QUFDalEsK0NBQXNEO0FBQ3RELGlEQUFzTDtBQUN0TCx1RUFBa0U7QUFDbEUscUNBQWdFO0FBQ2hFLG1DQUE0SDtBQUM1SCxzQ0FBNkQ7QUFZN0QsU0FBZ0IsWUFBWSxDQUFDLE1BQW1DLEVBQUUsYUFBcUI7SUFDbkYsT0FBTyxDQUFDLGFBQWEsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDaEQsQ0FBQztBQUVELFNBQWdCLG1CQUFtQixDQUFDLE1BQW1DLEVBQUUsYUFBcUI7SUFDMUYsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBRSxhQUFhLENBQUUsQ0FBQztJQUNyRCxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsSUFBSSxTQUFTLENBQUMsUUFBUSxLQUFLLElBQUksQ0FBQyxDQUFDO0FBQ3hELENBQUM7QUFFRCxTQUFnQixjQUFjLENBQUMsTUFBbUMsRUFBRSxJQUEwQjtJQUMxRixPQUFPLGtCQUFrQixDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxTQUFTLENBQUM7QUFDMUQsQ0FBQztBQUVELFNBQWdCLGtCQUFrQixDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFFOUYsSUFBSSxjQUFjLEdBQUcsU0FBUyxJQUFBLGtCQUFVLEVBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQztJQUMxRCxJQUFJLGNBQWMsSUFBSSxNQUFNLENBQUMsS0FB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Q0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ2pDLGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLGNBQWMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFNLENBQUMsQ0FBQztJQUN6RSxDQUFDO0lBRUQsT0FBTyxjQUFjLENBQUM7QUFDMUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gXCJlbGVjdHJvZGJcIjtcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2RpXCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUlucHV0VmFsaWRhdGlvbnMsIEVudGl0eVZhbGlkYXRpb25zIH0gZnJvbSBcIi4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB0eXBlIHsgQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlBdHRyaWJ1dGUsIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWEsIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hLCBFbnRpdHlUeXBlRnJvbVNjaGVtYSBhcyBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSwgSHlkcmF0ZU9wdGlvbkZvckVudGl0eSwgSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uLCBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eSwgUmVsYXRpb25JZGVudGlmaWVyLCBTcGVjaWFsQXR0cmlidXRlVHlwZSwgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBVcGRhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEsIFVwc2VydEVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUZpbHRlckNyaXRlcmlhLCBFbnRpdHlRdWVyeSwgRW50aXR5U2VsZWN0aW9ucywgUGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHMgfSBmcm9tIFwiLi9xdWVyeS10eXBlc1wiO1xuXG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQge1xuICAgIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LFxufSBmcm9tIFwiLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBEZXBJZGVudGlmaWVyLCBJRElDb250YWluZXIgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IEJhc2VTZWFyY2hTZXJ2aWNlLCBFbnRpdHlTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi4vc2VhcmNoL3NlcnZpY2VzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5IH0gZnJvbSAnLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IE9ic2VydmVkIH0gZnJvbSBcIi4uL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy9vYnNlcnZlZFwiO1xuaW1wb3J0IHsgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaC9zZWFyY2gtdXRpbHMnO1xuaW1wb3J0IHsgSnNvblNlcmlhbGl6ZXIsIGdldFZhbHVlQnlQYXRoLCBpc0FycmF5LCBpc0Jvb2xlYW4sIGlzQ2xhc3NDb25zdHJ1Y3RvciwgaXNFbXB0eSwgaXNFbXB0eU9iamVjdERlZXAsIGlzRnVuY3Rpb24sIGlzT2JqZWN0LCBpc1N0cmluZywgcGFzY2FsQ2FzZSwgcGlja0tleXMsIHRvSHVtYW5SZWFkYWJsZU5hbWUsIHRvU2x1ZywgY29tcHJlc3NJZk5lZWRlZCwgZGVjb21wcmVzc0l0ZW0sIGlzQ29tcHJlc3NlZCB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgY3JlYXRlRWxlY3Ryb0RCRW50aXR5IH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IFVwZGF0ZUVudGl0eU9wZXJhdG9ycywgY3JlYXRlRW50aXR5LCBkZWxldGVFbnRpdHksIGRlbGV0ZUJhdGNoRW50aXR5LCBnZXRCYXRjaEVudGl0eSwgZ2V0RW50aXR5LCBsaXN0RW50aXR5LCBxdWVyeUVudGl0eSwgdXBkYXRlRW50aXR5LCB1cHNlcnRFbnRpdHkgfSBmcm9tIFwiLi9jcnVkLXNlcnZpY2VcIjtcbmltcG9ydCB7IEVudGl0eVNjaGVtYVZhbGlkYXRvciB9IGZyb20gXCIuL2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yXCI7XG5pbXBvcnQgeyBEYXRhYmFzZUVycm9yLCBFbnRpdHlWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuL2Vycm9ycyc7XG5pbXBvcnQgeyBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWEsIG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzLCBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSBcIi4vcXVlcnlcIjtcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IsIFNlcnZlckVycm9yIH0gZnJvbSBcIi4uL2Vycm9yc1wiO1xuXG5leHBvcnQgdHlwZSBFeHRyYWN0RW50aXR5SWRlbnRpZmllcnNDb250ZXh0ID0ge1xuICAgIC8vIHRlbmFudElkOiBzdHJpbmcsIFxuICAgIGZvckFjY2Vzc1BhdHRlcm4/OiBzdHJpbmdcbn1cblxudHlwZSBHZXRPcHRpb25zPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sXG4gICAgYXR0cmlidXRlcz86IEVudGl0eVNlbGVjdGlvbnM8Uz5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc0F0dHJpYnV0ZShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiwgYXR0cmlidXRlTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIChhdHRyaWJ1dGVOYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGF0dHJpYnV0ZSA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHRyaWJ1dGVOYW1lIF07XG4gICAgcmV0dXJuICEhKGF0dHJpYnV0ZSAmJiBhdHRyaWJ1dGUucmVhZE9ubHkgPT09IHRydWUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzQXR0cmlidXRlQnkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIHNwZWM6IFNwZWNpYWxBdHRyaWJ1dGVUeXBlKSB7XG4gICAgcmV0dXJuIGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsIHNwZWMpICE9PSB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIHNwZWM6IFNwZWNpYWxBdHRyaWJ1dGVUeXBlKSB7XG5cbiAgICBsZXQgc3BlY0F0dE1ldGFLZXkgPSBgZW50aXR5JHtwYXNjYWxDYXNlKHNwZWMpfUF0dHJpYnV0ZWA7XG4gICAgaWYgKHNwZWNBdHRNZXRhS2V5IGluIHNjaGVtYS5tb2RlbCkge1xuICAgICAgICByZXR1cm4gc2NoZW1hLm1vZGVsWyBzcGVjQXR0TWV0YUtleSBhcyBrZXlvZiB0eXBlb2Ygc2NoZW1hLm1vZGVsIF0gYXMgc3RyaW5nO1xuICAgIH1cblxuICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCBgJHtzY2hlbWEubW9kZWwuZW50aXR5fSR7cGFzY2FsQ2FzZShzcGVjKX1gKSkge1xuICAgICAgICByZXR1cm4gYCR7c2NoZW1hLm1vZGVsLmVudGl0eX0ke3Bhc2NhbENhc2Uoc3BlYyl9YDtcbiAgICB9XG5cbiAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgc3BlYykpIHtcbiAgICAgICAgcmV0dXJuIHNwZWM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VFbnRpdHlTZXJ2aWNlPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IHtcblxuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihgQmFzZUVudGl0eVNlcnZpY2U6JHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG5cbiAgICBwcm90ZWN0ZWQgZW50aXR5UmVwb3NpdG9yeT86IEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICBwcm90ZWN0ZWQgZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hPzogUmV0dXJuVHlwZTx0eXBlb2YgdGhpcy5tYWtlT3BzRGVmYXVsdElPU2NoZW1hPFM+PjtcblxuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICByZWFkb25seSBzY2hlbWE6IFMsXG4gICAgICAgIHByb3RlY3RlZCByZWFkb25seSBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvbixcbiAgICAgICAgcHJvdGVjdGVkIHJlYWRvbmx5IGRpQ29udGFpbmVyOiBJRElDb250YWluZXIgPSBESUNvbnRhaW5lci5ST09ULFxuICAgICkgeyB9XG5cbiAgICBwcm90ZWN0ZWQgZ2V0VGFibGVOYW1lKCk6IHN0cmluZyB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlDb25maWd1cmF0aW9ucy50YWJsZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEludGVybmFsU2VydmVyRXJyb3IoYFRhYmxlIG5hbWUgaXMgcmVxdWlyZWQgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlDb25maWd1cmF0aW9ucy50YWJsZTtcbiAgICB9XG5cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlTZWFyY2hDb25maWcoX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQ8YW55Pikge1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gc2NoZW1hLm1vZGVsLnNlYXJjaCB8fCB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgaW5kZXhDb25maWc6IHt9XG4gICAgICAgIH07XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLnNlcnZpY2VDbGFzcyA9IHNlYXJjaENvbmZpZy5zZXJ2aWNlQ2xhc3MgfHwgRW50aXR5U2VhcmNoU2VydmljZTtcblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZy5pbmRleENvbmZpZykge1xuICAgICAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuaW5kZXhOYW1lID0gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLmluZGV4TmFtZSB8fCBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHNjaGVtYS5tb2RlbC5lbnRpdHksXG4gICAgICAgICAgICB0YWJsZU5hbWU6IHRoaXMuZ2V0VGFibGVOYW1lKCksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5wcmltYXJ5S2V5ID0gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnByaW1hcnlLZXkgfHwgdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgICAgICBjb25zdCBlbnRpdHlTZWFyY2hhYmxlQXR0cmlidXRlcyA9IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzID0gdGhpcy5nZXRGaWx0ZXJhYmxlQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3MgPSB7XG4gICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzIHx8IHt9KSxcbiAgICAgICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uc2VhcmNoYWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5U2VhcmNoYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uZmlsdGVyYWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHNvcnRhYmxlQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3M/LnNvcnRhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNlYXJjaENvbmZpZztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgaWYgc2VhcmNoIGlzIGVuYWJsZWQgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVHJ1ZSBpZiBzZWFyY2ggaXMgZW5hYmxlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIHB1YmxpYyBpc1NlYXJjaEVuYWJsZWQoKSB7XG4gICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCk7XG4gICAgICAgIHJldHVybiBCb29sZWFuKHNlYXJjaENvbmZpZz8uZW5hYmxlZCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgc2VhcmNoIHNlcnZpY2UgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIHNlYXJjaCBzZXJ2aWNlLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRTZWFyY2hTZXJ2aWNlKCk6IEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcblxuICAgICAgICAgICAgLy8gU2tpcCBzZWFyY2ggbG9naWMgaWYgc2VhcmNoIGlzIG5vdCBlbmFibGVkXG4gICAgICAgICAgICBpZiAoIXNlYXJjaENvbmZpZz8uZW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX0uYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIHNlYXJjaCBjb25maWd1cmF0aW9uIGlmIHByZXNlbnRcbiAgICAgICAgICAgIGlmIChzZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlU2VhcmNoQ29uZmlnKHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgPSBzZWFyY2hDb25maWc/LnNlcnZpY2VDbGFzcztcblxuICAgICAgICAgICAgLy8gQ2FzZSAxOiBESSBDb250YWluZXIgaGFzIHRoZSBzZXJ2aWNlXG4gICAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyAmJiB0aGlzLmRpQ29udGFpbmVyLmhhcyhzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGFzIERlcElkZW50aWZpZXI8RW50aXR5U2VhcmNoU2VydmljZTxhbnk+PikpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlPEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4+KHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPFM+Pik7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byByZXNvbHZlIHNlYXJjaCBzZXJ2aWNlIGZyb20gY29udGFpbmVyOicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlc29sdmUgc2VhcmNoIHNlcnZpY2UgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhc2UgMjogU2VydmljZSBpbnN0YW5jZSBwcm92aWRlZFxuICAgICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgaW5zdGFuY2VvZiBCYXNlU2VhcmNoU2VydmljZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYXNlIDM6IFNlcnZpY2UgY2xhc3MgcHJvdmlkZWRcbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBpc0NsYXNzQ29uc3RydWN0b3Ioc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcykgJiZcbiAgICAgICAgICAgICAgICAoXG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgPT09IEVudGl0eVNlYXJjaFNlcnZpY2VcbiAgICAgICAgICAgICAgICAgICAgfHxcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBFbnRpdHlTZWFyY2hTZXJ2aWNlXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETzogYWRkIHN1cHBvcnQgdG8gY29uZmlndXJlIHRoaXMgd2l0aG91dCBuZWVkaW5nIHRvIHVzZSB0aGUgRElcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRW5naW5lID0gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlU2VhcmNoRW5naW5lKCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc2VhcmNoRW5naW5lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBlbmdpbmUgbm90IGZvdW5kIGluIGNvbnRhaW5lcicpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgdHlwZW9mIEVudGl0eVNlYXJjaFNlcnZpY2UpKFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlYXJjaEVuZ2luZSxcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGluc3RhbnRpYXRlIHNlYXJjaCBzZXJ2aWNlOicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBzZWFyY2ggc2VydmljZSBpbnN0YW5jZSBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB2YWxpZCBzZWFyY2gtc2VydmljZS1jb25maWd1cmF0aW9uIGZvdW5kIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3IgaW4gZ2V0U2VhcmNoU2VydmljZTonLCBlcnIpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBpbml0aWFsaXphdGlvbiBmYWlsZWQgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgdmFsaWRhdGVTZWFyY2hDb25maWcoc2VhcmNoQ29uZmlnOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT5bICdtb2RlbCcgXVsgJ3NlYXJjaCcgXSkge1xuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZy5pbmRleENvbmZpZykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBtdXN0IGluY2x1ZGUgYSBjb25maWcgb2JqZWN0Jyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGluZGV4Q29uZmlnOiBjb25maWcgfSA9IHNlYXJjaENvbmZpZztcblxuICAgICAgICBpZiAoIWNvbmZpZy5pbmRleE5hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gbXVzdCBzcGVjaWZ5IGFuIGluZGV4TmFtZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgc2VhcmNoYWJsZSBhdHRyaWJ1dGVzIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29uZmlnLnNldHRpbmdzPy5zZWFyY2hhYmxlQXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBjb25maWcuc2V0dGluZ3Muc2VhcmNoYWJsZUF0dHJpYnV0ZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIChhdHRyOiBzdHJpbmcpID0+ICFoYXNBdHRyaWJ1dGUodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgYXR0cilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzZWFyY2hhYmxlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbGlkYXRlIGZpbHRlcmFibGUgYXR0cmlidXRlcyBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbmZpZy5zZXR0aW5ncz8uZmlsdGVyYWJsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gY29uZmlnLnNldHRpbmdzLmZpbHRlcmFibGVBdHRyaWJ1dGVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICAoYXR0cjogc3RyaW5nKSA9PiAhaGFzQXR0cmlidXRlKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIGF0dHIpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzOiAke2ludmFsaWRBdHRyaWJ1dGVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgdHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHk6IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+KTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgY29uc3QgdHJhbnNmb3JtZWQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5KTtcblxuICAgICAgICBpZiAoIXRyYW5zZm9ybWVkWyAnaWQnIF0pIHtcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSB0aGVyZSdzIGFuIGlkIGF0dHJpYnV0ZVxuICAgICAgICAgICAgY29uc3QgcHJpbWFyeUlkTmFtZSA9IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG4gICAgICAgICAgICB0cmFuc2Zvcm1lZFsgJ2lkJyBdID0gZW50aXR5WyBwcmltYXJ5SWROYW1lIGFzIGFueSBdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVkO1xuICAgIH1cblxuICAgIHB1YmxpYyB2YWxpZGF0ZUVudGl0eVNjaGVtYSgpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IEVudGl0eVNjaGVtYVZhbGlkYXRvcih0aGlzLmRpQ29udGFpbmVyKTtcbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKFxuICAgICAgICAgICAgdGhpcy5nZXRFbnRpdHlTY2hlbWEoKSxcbiAgICAgICAgICAgIHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBnZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNlcnZpY2U8QmFzZUVudGl0eVNlcnZpY2U8VD4+KHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2VydmljZShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgZ2V0RW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNjaGVtYTxUPihyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2NoZW1hKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRyYWN0cyBlbnRpdHkgaWRlbnRpZmllcnMgZnJvbSB0aGUgaW5wdXQgb2JqZWN0IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBjb250ZXh0IHRvIGZ1bGZpbGwgYW4gaW5kZXguXG4gICAgICogZS5nLiBlbnRpdHlJZCwgdGVuYW50SWQsIHBhcnRpdGlvbi1rZXlzLi4uLiBldGNcbiAgICAgKiBpdCBpcyB1c2VkIGJ5IHRoZSBgQmFzZUVudGl0eVNlcnZpY2VgIHRvIGZpbmQgdGhlIHJpZ2h0IGVudGl0eSBmb3IgYGdldGAvYHVwZGF0ZWAvYGRlbGV0ZWAgb3BlcmF0aW9uc1xuICAgICAqIFxuICAgICAqIEB0ZW1wbGF0ZSBTIC0gVGhlIHR5cGUgb2YgdGhlIGVudGl0eSBzY2hlbWEuXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGlucHV0IG9iamVjdCBmcm9tIHdoaWNoIHRvIGV4dHJhY3QgdGhlIGlkZW50aWZpZXJzLlxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGNvbnRhaW5pbmcgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiBmb3IgZXh0cmFjdGlvbi5cbiAgICAgKiBAcGFyYW0gY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuIC0gVGhlIGFjY2VzcyBwYXR0ZXJuIGZvciB3aGljaCB0byBleHRyYWN0IHRoZSBpZGVudGlmaWVycy5cbiAgICAgKiBAcmV0dXJucyBUaGUgZXh0cmFjdGVkIGVudGl0eSBpZGVudGlmaWVycy5cbiAgICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGlucHV0IGlzIG1pc3Npbmcgb3Igbm90IGFuIG9iamVjdC5cbiAgICAgKiBcbiAgICAgKiBlLmcuIFxuICAgICAqIElOICAgPT0+IGBSZXF1ZXN0YCBvYmplY3Qgd2l0aCBoZWFkZXJzLCBib2R5LCBhdXRoLWNvbnRleHQgZXRjXG4gICAgICogT1VUICA9PT4geyB0ZW5hbnRJZDogeHh4LCBlbWFpbDogeHh4QHl5eS5jb20sIHNvbWUtcGFydGl0aW9uLWtleTogeHgteXktenogfVxuICAgICAqXG4gICAgICovXG4gICAgZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKFxuICAgICAgICBpbnB1dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIHN0cmluZz4+LFxuICAgICAgICBjb250ZXh0OiBFeHRyYWN0RW50aXR5SWRlbnRpZmllcnNDb250ZXh0ID0ge1xuICAgICAgICAgICAgLy8gdGVuYW50SWQ6ICd4eHgteXl5LXp6eidcbiAgICAgICAgfVxuICAgICk6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiB7XG5cbiAgICAgICAgaWYgKCFpbnB1dCB8fCB0eXBlb2YgaW5wdXQgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lucHV0IGlzIHJlcXVpcmVkIGFuZCBtdXN0IGJlIGFuIG9iamVjdCBjb250YWluaW5nIGVudGl0eS1pZGVudGlmaWVycyBvciBhbiBhcnJheSBvZiBvYmplY3RzIGNvbnRhaW5pbmcgZW50aXR5LWlkZW50aWZpZXJzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpc0JhdGNoSW5wdXQgPSBpc0FycmF5KGlucHV0KTtcblxuICAgICAgICBjb25zdCBpbnB1dHMgPSBpc0JhdGNoSW5wdXQgPyBpbnB1dCA6IFsgaW5wdXQgXTtcblxuICAgICAgICAvLyBUT0RPOiB0ZW5hbnQgbG9naWNcbiAgICAgICAgLy8gaWRlbnRpZmllcnNbJ3RlbmFudElkJ10gPSBpbnB1dC50ZW5hbnRJZCB8fCBjb250ZXh0LnRlbmFudElkO1xuXG4gICAgICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJBdHRyaWJ1dGVzID0gbmV3IFNldDx7IG5hbWU6IHN0cmluZywgcmVxdWlyZWQ6IGJvb2xlYW4gfT4oKTtcbiAgICAgICAgZm9yIChjb25zdCBbIGFjY2Vzc1BhdHRlcm5OYW1lLCBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcyBdIG9mIGFjY2Vzc1BhdHRlcm5zKSB7XG4gICAgICAgICAgICBpZiAoIWNvbnRleHQuZm9yQWNjZXNzUGF0dGVybiB8fCBhY2Nlc3NQYXR0ZXJuTmFtZSA9PSBjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4pIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBhdHQgXSBvZiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyQXR0cmlidXRlcy5hZGQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYXR0LmlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IGF0dC5yZXF1aXJlZCA9PSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByaW1hcnlBdHROYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgICAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaW5wdXRzLm1hcChpbnB1dCA9PiB7XG4gICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogYW55ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZTogYXR0TmFtZSwgcmVxdWlyZWQgfSBvZiBpZGVudGlmaWVyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmICgoYXR0TmFtZSBpbiBpbnB1dCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnNbIGF0dE5hbWUgXSA9IGlucHV0WyBhdHROYW1lIF07XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChhdHROYW1lID09IHByaW1hcnlBdHROYW1lICYmICgnaWQnIGluIGlucHV0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyc1sgYXR0TmFtZSBdID0gaW5wdXQuaWQ7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXF1aXJlZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGByZXF1aXJlZCBhdHRyaWJ1dGU6ICR7YXR0TmFtZX0gZm9yIGFjY2Vzcy1wYXR0ZXJuOiAke2NvbnRleHQuZm9yQWNjZXNzUGF0dGVybiA/PyAnLS1wcmltYXJ5LS0nfSBpcyBub3QgZm91bmQgaW4gaW5wdXQ6YCwgaW5wdXQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpZGVudGlmaWVycyBhcyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+O1xuICAgICAgICB9XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0V4dHJhY3RpbmcgaWRlbnRpZmllcnMgZnJvbSBpZGVudGlmaWVyczonLCBpZGVudGlmaWVyc0JhdGNoKTtcblxuICAgICAgICByZXR1cm4gaXNCYXRjaElucHV0ID8gaWRlbnRpZmllcnNCYXRjaCA6IGlkZW50aWZpZXJzQmF0Y2hbIDAgXTtcbiAgICB9O1xuXG4gICAgcHVibGljIGdldEVudGl0eU5hbWUoKTogU1sgJ21vZGVsJyBdWyAnZW50aXR5JyBdIHsgcmV0dXJuIHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkubW9kZWwuZW50aXR5OyB9XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5U2NoZW1hKCk6IFMgeyByZXR1cm4gdGhpcy5zY2hlbWE7IH1cblxuICAgIHB1YmxpYyBnZXRSZXBvc2l0b3J5KCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5UmVwb3NpdG9yeSkge1xuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHkgfSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgICAgICAgICAgICAgc2NoZW1hOiB0aGlzLmdldEVudGl0eVNjaGVtYSgpLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5UmVwb3NpdG9yeSA9IGVudGl0eSBhcyBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWE8Uz47XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlSZXBvc2l0b3J5ITtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGVudGl0eSB2YWxpZGF0aW9uczsgb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIHlvdXIgb3duIHZhbGlkYXRpb25zXG4gICAgICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGVudGl0eSB2YWxpZGF0aW9ucy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RW50aXR5VmFsaWRhdGlvbnMoKTogRW50aXR5VmFsaWRhdGlvbnM8Uz4gfCBFbnRpdHlJbnB1dFZhbGlkYXRpb25zPFM+IHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGN1c3RvbSB2YWxpZGF0aW9uLWVycm9yLW1lc3NhZ2VzOyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgeW91ciBvd24gZXJyb3ItbWVzc2FnZXMuXG4gICAgICogQHJldHVybnMgQSBtYXAgY29udGFpbmluZyB0aGUgY3VzdG9tIHZhbGlkYXRpb24tZXJyb3ItbWVzc2FnZXMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0c1xuICAgICAqICBwdWJsaWMgYXN5bmMgZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgICAqICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSggbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oIFxuICAgICAqICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHsgXG4gICAgICogICAgICAgICAgICAgICd2YWxpZGF0aW9uLmVtYWlsLnJlcXVpcmVkJzogJ0VtYWlsIGlzIHJlcXVpcmVkISEhISEnLCBcbiAgICAgKiAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24ucGFzc3dvcmQucmVxdWlyZWQnOiAnUGFzc3dvcmQgaXMgcmVxdWlyZWQhISEhISdcbiAgICAgKiAgICAgICAgICB9KVxuICAgICAqICAgICAgKSk7XG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBnZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpIHtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBpZiAoYXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhdHROYW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvKipcbiAqIEdlbmVyYXRlcyB0aGUgZGVmYXVsdCBpbnB1dCBhbmQgb3V0cHV0IHNjaGVtYXMgZm9yIHZhcmlvdXMgb3BlcmF0aW9ucyBvZiBhbiBlbnRpdHkuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHMgLSBUaGUgdHlwZSBvZiBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgVGhlIGRlZmF1bHQgaW5wdXQgYW5kIG91dHB1dCBzY2hlbWFzIGZvciB0aGUgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbiAgICBwcm90ZWN0ZWQgbWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxcbiAgICAgICAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBPcHM+LFxuICAgICAgICBPcHMgZXh0ZW5kcyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgPihzY2hlbWE6IFMpIHtcblxuICAgICAgICBjb25zdCBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICAgICBjcmVhdGU6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICAgICAgdXBkYXRlOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzID0ge1xuICAgICAgICAgICAgZGV0YWlsOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgICAgIGxpc3Q6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIGNyZWF0ZSBhbmQgdXBkYXRlXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuXG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkQXR0ID0gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShhdHROYW1lLCBhdHQpO1xuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmhpZGRlbikge1xuICAgICAgICAgICAgICAgIC8vIGlmIGl0J3MgbWFya2VkIGFzIGhpZGRlbiBpdCdzIG5vdCB2aXNpYmxlIHRvIGFueSBvcFxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzVmlzaWJsZSB8fCBmb3JtYXR0ZWRBdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzTGlzdGFibGUgfHwgZm9ybWF0dGVkQXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMubGlzdC5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNDcmVhdGFibGUpIHtcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc0VkaXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLnVwZGF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYShzY2hlbWEpO1xuXG4gICAgICAgIC8vIGlmIHRoZXJlJ3MgYW4gaW5kZXggbmFtZWQgYHByaW1hcnlgLCB1c2UgdGhhdCwgZWxzZSBmYWxsYmFjayB0byBmaXJzdCBpbmRleFxuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZGVsZXRlJ10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuXG5cbiAgICAgICAgLy8gZm9yKGNvbnN0IGFwIG9mIGFjY2Vzc1BhdHRlcm5zLmtleXMoKSl7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGdldF8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gXHRhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1tgZGVsZXRlXyR7YXB9YF0gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoYXApO1xuICAgICAgICAvLyB9XG5cbiAgICAgICAgLy8gY29uc3QgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzOiBhbnkgPSB7fTtcdFxuICAgICAgICAvLyBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddID0ge1xuICAgICAgICAvLyBcdCdpZGVudGlmaWVycyc6IGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzWydnZXQnXSxcbiAgICAgICAgLy8gXHQnZGF0YSc6IGlucHV0U2NoZW1hQXR0cmlidXRlc1snY3JlYXRlJ10sXG4gICAgICAgIC8vIH1cbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ3VwZGF0ZSddLFxuICAgICAgICAvLyB9XG5cbiAgICAgICAgY29uc3QgZGVmYXVsdEFjY2Vzc1BhdHRlcm4gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKTtcblxuICAgICAgICAvLyBUT0RPOiBhZGQgc2NoZW1hIGZvciB0aGUgcmVzdCBmbyB0aGUgc2Vjb25kYXJ5IGFjY2Vzcy1wYXR0ZXJuc1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBnZXQ6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCwgLy8gZGVmYXVsdCBmb3IgdGhlIGRldGFpbCBwYWdlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZHVwbGljYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlbGV0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVyblxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNyZWF0ZToge1xuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB1cGRhdGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgaW5wdXQ6IGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUsXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsaXN0OiB7XG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3QsXG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBpbnB1dC9vdXRwdXQgc2NoZW1hIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAgICAgKiBcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRPcHNEZWZhdWx0SU9TY2hlbWEoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWEpIHtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hID0gdGhpcy5tYWtlT3BzRGVmYXVsdElPU2NoZW1hPFM+KHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuIFVzZWQgYnkgdGhlIGBkZXRhaWxgIEFQSSB0byBzZXJpYWxpemUgdGhlIGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gQW4gYXJyYXkgb2YgZGVmYXVsdCBzZXJpYWxpemF0aW9uIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmdldC5vdXRwdXQ7XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlczogYW55ID0ge307XG4gICAgICAgIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmZvckVhY2goKF8sIGtleSkgPT4ge1xuICAgICAgICAgICAgLy8gaWYgKCF2YWwucmVsYXRpb24gfHwgdmFsLnJlbGF0aW9uLmh5ZHJhdGUpIHtcbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgIGF0dHJpYnV0ZXNbIGtleSBdID0gdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcyBhcyBFbnRpdHlTZWxlY3Rpb25zPFM+O1xuXG4gICAgICAgIC8vICByZXR1cm4gQXJyYXkuZnJvbSggZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAua2V5cygpICkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGF0dHJpYnV0ZSBuYW1lcyBmb3IgbGlzdGluZyBhbmQgc2VhcmNoIEFQSS4gRGVmYXVsdHMgdG8gdGhlIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCk6IEVudGl0eVNlbGVjdGlvbnM8Uz4ge1xuICAgICAgICBjb25zdCBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcCA9IHRoaXMuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkubGlzdC5vdXRwdXQ7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaC5cbiAgICAgKiBJbmNsdWRlcyBzdHJpbmcgZmllbGRzIGFuZCBlbnVtIGZpZWxkcyB3aXRoIHN0cmluZyB2YWx1ZXMuXG4gICAgICogRXhjbHVkZXMgaWRlbnRpZmllcnMsIGhpZGRlbiBmaWVsZHMsIGRhdGUvZGF0ZXRpbWUgZmllbGRzLCByZWxhdGlvbnMsIGFuZCBzZWxlY3QgZmllbGRzIGJ5IGRlZmF1bHQuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaFxuICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG5cbiAgICAgICAgICAgIC8vIFNraXAgaWYgaGlkZGVuLCBpZGVudGlmaWVyLCBvciBleHBsaWNpdGx5IG5vdCBzZWFyY2hhYmxlXG4gICAgICAgICAgICBpZiAoYXR0LmhpZGRlbiB8fCBhdHQuaXNJZGVudGlmaWVyIHx8IGF0dC5pc1NlYXJjaGFibGUgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGF0dHJUeXBlID0gYXR0LnR5cGU7XG4gICAgICAgICAgICBjb25zdCBmaWVsZFR5cGUgPSBhdHQuZmllbGRUeXBlO1xuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIGRhdGUvZGF0ZXRpbWUgZmllbGRzICh0aGV5J3JlIGZvciBmaWx0ZXJpbmcsIG5vdCB0ZXh0IHNlYXJjaClcbiAgICAgICAgICAgIGlmIChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhjbHVkZSBkYXRlLWxpa2UgZmllbGQgbmFtZXMgKGNyZWF0ZWRBdCwgcHVibGlzaGVkRGF0ZSwgZXRjLilcbiAgICAgICAgICAgIGNvbnN0IGxvd2VyTmFtZSA9IGF0dE5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIGlmIChhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgKGxvd2VyTmFtZS5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygndGltZScpKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIHJlbGF0aW9uIGZpZWxkcyAodGhleSdyZSBJRHMsIG5vdCBzZWFyY2hhYmxlIHRleHQpXG4gICAgICAgICAgICBpZiAoJ3JlbGF0aW9uJyBpbiBhdHQgJiYgYXR0LnJlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4Y2x1ZGUgc2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkcyB3aXRoIG9wdGlvbnMgKHRoZXkncmUgZm9yIGZpbHRlcmluZywgbm90IGZ1bGwtdGV4dCBzZWFyY2gpXG4gICAgICAgICAgICBpZiAoKGZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSAmJlxuICAgICAgICAgICAgICAgICdvcHRpb25zJyBpbiBhdHQgJiYgYXR0Lm9wdGlvbnMpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSW5jbHVkZSBzZWFyY2hhYmxlIHRleHQtYmFzZWQgZmllbGQgdHlwZXNcbiAgICAgICAgICAgIGNvbnN0IGlzU2VhcmNoYWJsZVR5cGUgPSAoXG4gICAgICAgICAgICAgICAgLy8gU3RyaW5nIGZpZWxkcyAocHJpbWFyeSBzZWFyY2hhYmxlIHR5cGUpXG4gICAgICAgICAgICAgICAgKHR5cGVvZiBhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgYXR0clR5cGUgPT09ICdzdHJpbmcnKSB8fFxuXG4gICAgICAgICAgICAgICAgLy8gRW51bSBmaWVsZHMgY2FuIGJlIHNlYXJjaGVkIGJ5IHRoZWlyIHN0cmluZyB2YWx1ZXNcbiAgICAgICAgICAgICAgICAoQXJyYXkuaXNBcnJheShhdHRyVHlwZSkgJiYgYXR0clR5cGUubGVuZ3RoID4gMCAmJiBhdHRyVHlwZS5ldmVyeSh2ID0+IHR5cGVvZiB2ID09PSAnc3RyaW5nJykpXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBJbmNsdWRlIGlmIHNlYXJjaGFibGUgYnkgZGVmYXVsdCAoaXNTZWFyY2hhYmxlIG5vdCBleHBsaWNpdGx5IHNldCkgb3IgZXhwbGljaXRseSBlbmFibGVkXG4gICAgICAgICAgICBpZiAoaXNTZWFyY2hhYmxlVHlwZSAmJiAoISgnaXNTZWFyY2hhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc1NlYXJjaGFibGUpKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZXMucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lcztcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIHVuaXF1ZSBhdHRyaWJ1dGVzIG9mIHRoZSBlbnRpdHkuIFxuICAgICAqIERlZmF1bHRzIHRvIGFsbCBhdHRyaWJ1dGVzIHdoaWNoIGFyZSBtYXJrZWQgYXMgdW5pcXVlIG9yIGFyZSBpZGVudGlmaWVyczsgXG4gICAgICogT3IgaWYgdGhleSBhcmUgcGFydCBvZiBhIGNvbXBvc2l0ZSBwcmltYXJ5IGtleSB3aGVyZSB0aGUgY29tcG9zaXRlIGxlbmd0aCBpcyAxLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxFbnRpdHlBdHRyaWJ1dGU+fSB1bmlxdWUgYXR0cmlidXRlcyBvZiB0aGUgZW50aXR5XG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0VW5pcXVlQXR0cmlidXRlcygpOiBBcnJheTxFbnRpdHlBdHRyaWJ1dGU+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcblxuICAgICAgICAgICAgbGV0IGlzVW5pcXVlID0gKCdpc1VuaXF1ZScgaW4gYXR0KSA/IGF0dC5pc1VuaXF1ZSA6IGF0dC5pc0lkZW50aWZpZXI7XG5cbiAgICAgICAgICAgIGlmIChpc1VuaXF1ZSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIC4uLmF0dCxcbiAgICAgICAgICAgICAgICAgICAgaXNVbmlxdWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGF0dE5hbWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0aGF0IGNhbiBiZSB1c2VkIGZvciBmaWx0ZXJpbmcgdGhlIHJlY29yZHMuXG4gICAgICogSW5jbHVkZXMgYWxsIGZpbHRlcmFibGUgZmllbGQgdHlwZXM6IHN0cmluZywgbnVtYmVyLCBib29sZWFuLCBlbnVtcywgZGF0ZXMsIGFuZCByZWxhdGlvbnMuXG4gICAgICogXG4gICAgICogVGhpcyBtYXRjaGVzIHRoZSBjb21wcmVoZW5zaXZlIGZpbHRlcmluZyBzdXBwb3J0IGluIHRoZSBVSSBmaWx0ZXIgZ2VuZXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gYXR0cmlidXRlIG5hbWVzIHRvIGJlIHVzZWQgZm9yIGZpbHRlcmluZ1xuICAgICovXG4gICAgcHVibGljIGdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG5cbiAgICAgICAgICAgIC8vIFNraXAgaWYgZXhwbGljaXRseSBtYXJrZWQgYXMgbm90IGZpbHRlcmFibGUgb3IgaGlkZGVuXG4gICAgICAgICAgICBpZiAoYXR0LmhpZGRlbiB8fCBhdHQuaXNGaWx0ZXJhYmxlID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBhdHRyVHlwZSA9IGF0dC50eXBlO1xuICAgICAgICAgICAgY29uc3QgZmllbGRUeXBlID0gYXR0LmZpZWxkVHlwZTtcbiAgICAgICAgICAgIGxldCBpc0ZpbHRlcmFibGVUeXBlID0gZmFsc2U7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGJhc2ljIHNjYWxhciB0eXBlc1xuICAgICAgICAgICAgaWYgKGF0dHJUeXBlID09PSAnc3RyaW5nJyB8fCBhdHRyVHlwZSA9PT0gJ251bWJlcicgfHwgYXR0clR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZW51bSB0eXBlcyAoYXJyYXkgb2YgdmFsdWVzKVxuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIEFycmF5LmlzQXJyYXkoYXR0clR5cGUpKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBkYXRlL2RhdGV0aW1lIGZpZWxkc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScpKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBkYXRlLWxpa2UgZmllbGQgbmFtZXNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJiBhdHRyVHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBhdHROYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgaWYgKGxvd2VyTmFtZS5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygndGltZScpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIHJlbGF0aW9uIGZpZWxkc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmICdyZWxhdGlvbicgaW4gYXR0ICYmIGF0dC5yZWxhdGlvbikge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3Igc2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkcyB3aXRoIG9wdGlvbnNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJlxuICAgICAgICAgICAgICAgIChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0JykgJiZcbiAgICAgICAgICAgICAgICAnb3B0aW9ucycgaW4gYXR0ICYmIGF0dC5vcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEluY2x1ZGUgaWYgZmlsdGVyYWJsZSBieSBkZWZhdWx0IChpc0ZpbHRlcmFibGUgbm90IGV4cGxpY2l0bHkgc2V0KSBvciBleHBsaWNpdGx5IGVuYWJsZWRcbiAgICAgICAgICAgIGlmIChpc0ZpbHRlcmFibGVUeXBlICYmICghKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgfHwgYXR0LmlzRmlsdGVyYWJsZSkpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KHJlY29yZDogVCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogUGFydGlhbDxUPiB7XG5cbiAgICAgICAgbGV0IGtleXM6IEFycmF5PHN0cmluZz47XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoYXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMocGFyc2VkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwaWNrS2V5czxUPihyZWNvcmQsIC4uLmtleXMpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IEFycmF5PFQ+IHwgbnVsbCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogQXJyYXk8UGFydGlhbDxUPj4ge1xuICAgICAgICBpZiAoIXJlY29yZCB8fCAhQXJyYXkuaXNBcnJheShyZWNvcmQpKSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlY29yZC5tYXAocmVjb3JkID0+IHRoaXMuc2VyaWFsaXplUmVjb3JkPFQ+KHJlY29yZCwgYXR0cmlidXRlcykpO1xuICAgIH1cblxuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJywgaHlkcmF0aW9uOiAndHJ1ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIHJlbGF0aW9ucywgcm9vdFJlY29yZHMgXSA9IGFyZ3MgYXMgWyB1bmtub3duW10gfCB1bmRlZmluZWQsIHVua25vd25bXSB8IHVuZGVmaW5lZCBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uQ291bnQgPSBBcnJheS5pc0FycmF5KHJlbGF0aW9ucykgPyByZWxhdGlvbnMubGVuZ3RoIDogMDtcbiAgICAgICAgICAgICAgICBjb25zdCByZWNvcmRDb3VudCA9IEFycmF5LmlzQXJyYXkocm9vdFJlY29yZHMpID8gcm9vdFJlY29yZHMubGVuZ3RoIDogMDtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25Db3VudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY29yZENvdW50LFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG4gICAgYXN5bmMgaHlkcmF0ZVJlY29yZHMoXG4gICAgICAgIHJlbGF0aW9uczogQXJyYXk8WyByZWxhdGVkQXR0cmlidXRlTmFtZTogc3RyaW5nLCBvcHRpb25zOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248YW55PiBdPixcbiAgICAgICAgcm9vdEVudGl0eVJlY29yZHM6IEFycmF5PHsgWyB4OiBzdHJpbmcgXTogYW55OyB9PlxuICAgICkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlUmVjb3JkcycgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocmVsYXRpb25zPy5tYXAoYXN5bmMgKFsgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlU2luZ2xlUmVsYXRpb24ocm9vdEVudGl0eVJlY29yZHMsIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLCBvcHRpb25zKTtcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZVNpbmdsZVJlbGF0aW9uKHJvb3RFbnRpdHlSZWNvcmRzOiBhbnlbXSwgcmVsYXRlZEF0dHJpYnV0ZU5hbWU6IHN0cmluZywgb3B0aW9uczogSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uPGFueT4pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZVNpbmdsZVJlbGF0aW9uJyByZWxhdGlvbjogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBvcHRpb25zXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUsIHJlbGF0aW9uVHlwZSwgaWRlbnRpZmllcnMgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKCFpZGVudGlmaWVycykge1xuICAgICAgICAgICAgdGhyb3cgKGBObyBJZGVudGlmaWVyczpbJHtyZWxhdGlvblR5cGV9OiR7cmVsYXRlZEVudGl0eU5hbWV9XSBwcm92aWRlZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZSA9PSAnb25lLXRvLW9uZScgfHwgcmVsYXRpb25UeXBlID09ICdtYW55LXRvLW1hbnknKSB7XG4gICAgICAgICAgICB0aHJvdyAoYFJlbGF0aW9uVHlwZTpbJHtyZWxhdGlvblR5cGV9OiR7cmVsYXRlZEVudGl0eU5hbWV9XSBpbiBub3Qgc3VwcG9ydGVkIGJ5IGh5ZHJhdGlvbiwgdXNlIG9uZSBvZiBbbWFueS10by1vbmUsIG9uZS10by1tYW55XSBvdCBtYW51YWxseSBoeWRyYXRlJ2ApXG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZVxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgICAgIGlmICghcmVsYXRlZEVudGl0eVNlcnZpY2UpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc2VydmljZSBmb3VuZCBmb3IgcmVsYXRpb25zaGlwOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfSgke3JlbGF0ZWRFbnRpdHlOYW1lfSk7IHBsZWFzZSBtYWtlIHN1cmUgc2VydmljZSBoYXMgYmVlbiByZWdpc3RlcmVkIGluIHRoZSByZXF1aXJlZCAnZGktY29udGFpbmVyJ2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0aW9uJ3MgbWV0YWRhdGFcbiAgICAgICAgY29uc3QgY3VycmVudEVudGl0eVNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEgPSBjdXJyZW50RW50aXR5U2NoZW1hLmF0dHJpYnV0ZXNbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lIGFzIGFueSBdIGFzIEVudGl0eUF0dHJpYnV0ZTtcblxuICAgICAgICBpZiAoIXJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEgfHwgIXJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGE/LnJlbGF0aW9uKSB7XG4gICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gYE5vIG1ldGFkYXRhIGZvdW5kIGZvciByZWxhdGlvbnNoaXA6ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9YFxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihtZXNzYWdlLCByZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhKTtcbiAgICAgICAgICAgIHRocm93IChtZXNzYWdlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlbGF0aW9uIGlkZW50aWZpZXJzIG1hcHBpbmdcbiAgICAgICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdID0gQXJyYXkuaXNBcnJheShpZGVudGlmaWVycykgPyBpZGVudGlmaWVycyA6IFsgaWRlbnRpZmllcnMhIF07XG5cbiAgICAgICAgLy8gRGVjaWRlIGxvZ2ljIGJhc2VkIG9uIHJlbGF0aW9uVHlwZVxuICAgICAgICBpZiAocmVsYXRpb25UeXBlID09PSAnbWFueS10by1vbmUnKSB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIE1BTlktVE8tT05FOlxuICAgICAgICAgICAgICogLS0tLS0tLS0tLS0tLVxuICAgICAgICAgICAgICogVGhlIFwicm9vdEVudGl0eVJlY29yZHNcIiBhcmUgdGhlIENISUxEIGl0ZW1zLCBlYWNoIHN0b3JpbmcgdGhlIHBhcmVudCdzXG4gICAgICAgICAgICAgKiBjb21wb3NpdGUga2V5IGluIHNvbWUgZmllbGRzLiBXZSBnYXRoZXIgYWxsIHRob3NlIHBhcmVudCBrZXlzLCBkbyBhIGJhdGNoXG4gICAgICAgICAgICAgKiByZXRyaWV2YWwgZnJvbSB0aGUgcGFyZW50IGVudGl0eSwgdGhlbiBhdHRhY2ggdGhlIHNpbmdsZSBtYXRjaGluZyBwYXJlbnRcbiAgICAgICAgICAgICAqIHJlY29yZCBpbnRvIGNoaWxkUmVjb3JkW3JlbGF0ZWRBdHRyaWJ1dGVOYW1lXS5cbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVNYW55VG9PbmUoXG4gICAgICAgICAgICAgICAgcm9vdEVudGl0eVJlY29yZHMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUgPT09ICdvbmUtdG8tbWFueScpIHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogT05FLVRPLU1BTlk6XG4gICAgICAgICAgICAgKiAtLS0tLS0tLS0tLS0tXG4gICAgICAgICAgICAgKiBUaGUgXCJyb290RW50aXR5UmVjb3Jkc1wiIGFyZSB0aGUgUEFSRU5UIGl0ZW1zLiBFYWNoIHBhcmVudCBjYW4gaGF2ZSBtdWx0aXBsZVxuICAgICAgICAgICAgICogY2hpbGQgaXRlbXMuIFRoZSBjaGlsZCB0YWJsZSByZWNvcmRzIGVhY2ggc3RvcmUgdGhlIHBhcmVudCdzIGtleS4gXG4gICAgICAgICAgICAgKiBTbyB3ZSBkbyBhIHF1ZXJ5IHBlciBwYXJlbnQgYW5kIHRoZW4gLlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVPbmVUb01hbnkoXG4gICAgICAgICAgICAgICAgcm9vdEVudGl0eVJlY29yZHMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZU1hbnlUb09uZShcbiAgICAgICAgY2hpbGRSZWNvcmRzOiBhbnlbXSxcbiAgICAgICAgcGFyZW50QXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10sXG4gICAgICAgIHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGU6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8YW55PiB8IHVuZGVmaW5lZCxcbiAgICAgICAgcGFyZW50U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuICAgICkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlTWFueVRvT25lJyByZWxhdGlvbjogJHtwYXJlbnRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIGZvciBlYWNoIHBhcmVudCBjcmVhdGUgYSBjaGlsZHJlbiBiYXRjaFxuICAgICAgICBjb25zdCBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZFJlY29yZHMpIHtcbiAgICAgICAgICAgIGlmICghY2hpbGQpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBhIHBhcmVudCBrZXkgb2JqZWN0LiBFLmcuIHsgb3JnSWQ6IGNoaWxkLm9yZ0lkLCB1c2VySWQ6IGNoaWxkLnVzZXJJZCB9IGZvciAyLWF0dHIgUEtcbiAgICAgICAgICAgIGNvbnN0IHBhcmVudEtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHNvdXJjZSwgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWwgPSBnZXRWYWx1ZUJ5UGF0aChjaGlsZCwgc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbCA9PSBudWxsKSBjb250aW51ZTtcblxuICAgICAgICAgICAgICAgICAgICBwYXJlbnRLZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHZhbDtcblxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBnZXR0aW5nIHZhbHVlIGZvciBwYXRoOiAke3NvdXJjZX1gLCB7IGVycm9yIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSWYgcGFydGlhbCBvciBlbXB0eSwgc2tpcFxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKHBhcmVudEtleU9iaikubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgY2hpbGRbIHBhcmVudEF0dHJpYnV0ZU5hbWUgXSA9IG51bGw7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IEpTT04uc3RyaW5naWZ5KHBhcmVudEtleU9iaik7XG4gICAgICAgICAgICBpZiAoIXBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5oYXMoa2V5U3RyKSkge1xuICAgICAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5zZXQoa2V5U3RyLCBbXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuZ2V0KGtleVN0cikhLnB1c2goY2hpbGQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5zaXplID09PSAwKSByZXR1cm47XG5cbiAgICAgICAgLy8gQ3JlYXRlIGEgcGFyZW50LWlkZW50aWZpZXJzLWJhdGNoIGZvciBmZXRjaGluZ1xuICAgICAgICBjb25zdCBwYXJlbnRJZGVudGlmaWVyc0JhdGNoOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGsgb2YgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmtleXMoKSkge1xuICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNCYXRjaC5wdXNoKEpTT04ucGFyc2UoaykpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZmV0Y2hlZFBhcmVudHMgPSBhd2FpdCBwYXJlbnRTZXJ2aWNlLmdldCh7XG4gICAgICAgICAgICBpZGVudGlmaWVyczogcGFyZW50SWRlbnRpZmllcnNCYXRjaCxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIFwiZ2V0KClcIiByZXR1cm5zIGEgc2luZ2xlIGl0ZW0gY29udmVydCBpdCBpbnRvIGFuIGFycmF5LlxuICAgICAgICBjb25zdCBwYXJlbnRzQXJyYXkgPSBBcnJheS5pc0FycmF5KGZldGNoZWRQYXJlbnRzKSA/IGZldGNoZWRQYXJlbnRzIDogWyBmZXRjaGVkUGFyZW50cyBdO1xuXG4gICAgICAgIC8vIE1ha2UgYSBkaWN0aW9uYXJ5IGZyb20geyA8a2V5U3RyPiA9PiBwYXJlbnRSZWNvcmQgfVxuICAgICAgICBjb25zdCBwYXJlbnREaWN0ID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcbiAgICAgICAgZm9yIChjb25zdCBwIG9mIHBhcmVudHNBcnJheSkge1xuICAgICAgICAgICAgaWYgKCFwKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBSZWJ1aWxkIHRoZSBcImNvbXBvc2l0ZSBrZXlcIiBmcm9tIHRoZSBwYXJlbnQncyByZWNvcmRcbiAgICAgICAgICAgIGNvbnN0IGtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuICAgICAgICAgICAgICAgIGlmIChwWyB0YXJnZXQgXSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHNvbWUgYXR0cmlidXRlIGlzIG1pc3NpbmcsIHNraXBcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gcFsgdGFyZ2V0IF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBrU3RyID0gSlNPTi5zdHJpbmdpZnkoa2V5T2JqKTtcbiAgICAgICAgICAgIHBhcmVudERpY3Quc2V0KGtTdHIsIHApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXR0YWNoIGVhY2ggcGFyZW50J3MgZGF0YSB0byB0aGUgY2hpbGRcbiAgICAgICAgZm9yIChjb25zdCBbIGtTdHIsIGNoaWxkcmVuIF0gb2YgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgZm91bmRQYXJlbnQgPSBwYXJlbnREaWN0LmdldChrU3RyKSA/PyBudWxsO1xuICAgICAgICAgICAgZm9yIChjb25zdCBjIG9mIGNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY1sgcGFyZW50QXR0cmlidXRlTmFtZSBdID0gZm91bmRQYXJlbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVPbmVUb01hbnkoXG4gICAgICAgIHBhcmVudFJlY29yZHM6IGFueVtdLFxuICAgICAgICBjaGlsZEF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdLFxuICAgICAgICBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGU6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8YW55PiB8IHVuZGVmaW5lZCxcbiAgICAgICAgY2hpbGRTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4gICAgKSB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZU9uZVRvTWFueScgcmVsYXRpb246ICR7Y2hpbGRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcGFyZW50S2V5U3RyVG9QYXJlbnRzID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGFyZW50IG9mIHBhcmVudFJlY29yZHMpIHtcbiAgICAgICAgICAgIGlmICghcGFyZW50KSBjb250aW51ZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBcImNoaWxkIGluZGV4XCIga2V5IGZyb20gdGhlIHBhcmVudCdzIGZpZWxkcy4gRm9yIGV4YW1wbGUsIFxuICAgICAgICAgICAgLy8gaWYgdGhlIGNoaWxkIEdTSSBoYXMgeyBwazogJ3RlbmFudElkJywgc2s6ICdhY2NvdW50SWQnIH0sIFxuICAgICAgICAgICAgLy8gd2UgZmlsbCB7IHRlbmFudElkOiBwYXJlbnQudGVuYW50SWQsIGFjY291bnRJZDogcGFyZW50LmFjY291bnRJZCB9LlxuICAgICAgICAgICAgY29uc3QgY2hpbGRLZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBzb3VyY2UsIHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuICAgICAgICAgICAgICAgIGlmIChwYXJlbnRbIHNvdXJjZSBdICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRLZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHBhcmVudFsgc291cmNlIF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiB3ZSBoYXZlIG5vIHZhbGlkIGNvbXBvc2l0ZSBrZXksIG5vIGNoaWxkcmVuIGNhbiBiZSBmZXRjaGVkXG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoY2hpbGRLZXlPYmopLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHBhcmVudFsgY2hpbGRBdHRyaWJ1dGVOYW1lIF0gPSBbXTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gSlNPTi5zdHJpbmdpZnkoY2hpbGRLZXlPYmopO1xuICAgICAgICAgICAgaWYgKCFwYXJlbnRLZXlTdHJUb1BhcmVudHMuaGFzKGtleVN0cikpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRLZXlTdHJUb1BhcmVudHMuc2V0KGtleVN0ciwgW10pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmdldChrZXlTdHIpIS5wdXNoKHBhcmVudCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiBubyBwYXJlbnQgaGFzIGEgdmFsaWQga2V5LCB3ZSdyZSBkb25lXG4gICAgICAgIGlmIChwYXJlbnRLZXlTdHJUb1BhcmVudHMuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIGVhY2ggdW5pcXVlIHBhcmVudEtleU9iaiwgZG8gYSBjaGlsZFNlcnZpY2UgcXVlcnkvbGlzdCBpbiBwYXJhbGxlbC5cbiAgICAgICAgY29uc3QgcHJvbWlzZXM6IEFycmF5PFByb21pc2U8YW55Pj4gPSBbXTtcbiAgICAgICAgY29uc3QgcGFyZW50S2V5czogc3RyaW5nW10gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsga2V5U3RyIF0gb2YgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmVudHJpZXMoKSkge1xuXG4gICAgICAgICAgICBjb25zdCBjaGlsZEtleU9iaiA9IEpTT04ucGFyc2Uoa2V5U3RyKTtcblxuICAgICAgICAgICAgcGFyZW50S2V5cy5wdXNoKGtleVN0cik7XG5cbiAgICAgICAgICAgIGNvbnN0IGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBjaGlsZEZpZWxkLCB2YWwgXSBvZiBPYmplY3QuZW50cmllcyhjaGlsZEtleU9iaikpIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJzWyBjaGlsZEZpZWxkIF0gPSB7IGVxOiB2YWwgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJvbWlzZXMucHVzaChcbiAgICAgICAgICAgICAgICBjaGlsZFNlcnZpY2UubGlzdCh7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG5cbiAgICAgICAgLy8gRm9yIGVhY2ggcmVzdWx0LCBtYXAgY2hpbGRyZW4gYmFjayB0byB0aGUgY29ycmVjdC1wYXJlbnQocylcbiAgICAgICAgY29uc3QgcGFyZW50S2V5U3RyVG9DaGlsZHJlbjogUmVjb3JkPHN0cmluZywgYW55W10+ID0ge307XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdWx0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgeyBkYXRhOiBjaGlsZEl0ZW1zIH0gPSByZXN1bHRzWyBpIF07XG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBwYXJlbnRLZXlzWyBpIF07XG4gICAgICAgICAgICBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuWyBrZXlTdHIgXSA9IGNoaWxkSXRlbXMgPz8gW107XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBdHRhY2ggdG8gcGFyZW50c1xuICAgICAgICBmb3IgKGNvbnN0IFsga2V5U3RyLCBwYXJlbnRzIF0gb2YgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgY2hpbGRBcnJheSA9IHBhcmVudEtleVN0clRvQ2hpbGRyZW5bIGtleVN0ciBdID8/IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBwIG9mIHBhcmVudHMpIHtcbiAgICAgICAgICAgICAgICBwWyBjaGlsZEF0dHJpYnV0ZU5hbWUgXSA9IGNoaWxkQXJyYXk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgYW4gZW50aXR5IGJ5IGl0cyBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eS5cbiAgICAgKiBAcGFyYW0gc2VsZWN0aW9ucyAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBpbmNsdWRlIGluIHRoZSByZXNwb25zZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmV0cmlldmVkIGVudGl0eSBkYXRhLlxuICAgICAqL1xuXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3JlYWQnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgZmluaXNoOiAoeyByZXN1bHQgfSkgPT4gKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGZvdW5kOiAhIXJlc3VsdCB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldE9wdGlvbnM8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMgfSA9IG9wdGlvbnM7XG5cblxuICAgICAgICBsZXQgZm9ybWF0dGVkQXR0cmlidXRlcyA9IGF0dHJpYnV0ZXM7XG4gICAgICAgIGlmICghYXR0cmlidXRlcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmb3JtYXR0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvcm1hdHRlZCBhdHRyaWJ1dGVzIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZm9ybWF0dGVkQXR0cmlidXRlcyk7XG5cbiAgICAgICAgY29uc3QgcmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBhbnkpLnJlZHVjZSgoYWNjLCBbIGF0dE5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYWNjLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICBpZiAoaXNPYmplY3Qob3B0aW9ucykgJiYgb3B0aW9ucy5pZGVudGlmaWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8YW55Pj4gPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycyA6IFsgb3B0aW9ucy5pZGVudGlmaWVycyBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcEtleXMgPSBpZGVudGlmaWVycy5tYXAoaWRlbnRpZmllciA9PiBpZGVudGlmaWVyLnNvdXJjZT8uc3BsaXQ/LignLicpPy5bIDAgXSkuZmlsdGVyKGtleSA9PiAhIWtleSkgYXMgc3RyaW5nW107XG4gICAgICAgICAgICAgICAgYWNjLnB1c2goLi4udG9wS2V5cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCBbXSBhcyBzdHJpbmdbXSk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyA9IFsgLi4ubmV3IFNldChyZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMpIF1cblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJldHJpZXZlZCBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmIChlbnRpdHk/LmRhdGEpIHtcbiAgICAgICAgICAgIC8vIERlY29tcHJlc3MgZmllbGRzIGFmdGVyIHJlYWRpbmcgZnJvbSBEQlxuICAgICAgICAgICAgZW50aXR5LmRhdGEgPSB0aGlzLmRlY29tcHJlc3NGaWVsZHMoZW50aXR5LmRhdGEpO1xuXG4gICAgICAgICAgICBpZiAoISFmb3JtYXR0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIFsgZW50aXR5LmRhdGEgXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGVudGl0eT8uZGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgbXVsdGlwbGUgZW50aXRpZXMgYnkgdGhlaXIgaWRlbnRpZmllcnMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgYmF0Y2ggcmV0cmlldmluZyBlbnRpdGllcy5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5pZGVudGlmaWVycyAtIEFycmF5IG9mIGVudGl0eSBpZGVudGlmaWVycyB0byByZXRyaWV2ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVzIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIHRvIHBlcmZvcm0gKGRlZmF1bHQ6IDEpLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSByZXRyaWV2ZWQgZW50aXRpZXMgYW5kIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2RlYnVnJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAncmVhZCcsIGJhdGNoOiAndHJ1ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIG9wdGlvbnMgXSA9IGFyZ3MgYXMgWyB7IGlkZW50aWZpZXJzPzogdW5rbm93bltdOyBjb25jdXJyZW50PzogbnVtYmVyIH0gXTtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaFNpemUgPSBBcnJheS5pc0FycmF5KG9wdGlvbnM/LmlkZW50aWZpZXJzKSA/IG9wdGlvbnMuaWRlbnRpZmllcnMubGVuZ3RoIDogMDtcbiAgICAgICAgICAgICAgICBjb25zdCBjb25jdXJyZW50ID0gdHlwZW9mIG9wdGlvbnM/LmNvbmN1cnJlbnQgPT09ICdudW1iZXInID8gb3B0aW9ucy5jb25jdXJyZW50IDogMTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH0sXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHsgYmF0Y2hTaXplLCBjb25jdXJyZW50IH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZpbmlzaDogKHsgcmVzdWx0IH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gcmVzdWx0IGFzIHsgZGF0YT86IHVua25vd25bXTsgdW5wcm9jZXNzZWQ/OiB1bmtub3duW10gfSB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICBjb25zdCByZXRyaWV2ZWRDb3VudCA9IEFycmF5LmlzQXJyYXkocj8uZGF0YSkgPyByIS5kYXRhLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IEFycmF5LmlzQXJyYXkocj8udW5wcm9jZXNzZWQpID8gciEudW5wcm9jZXNzZWQubGVuZ3RoIDogMDtcbiAgICAgICAgICAgICAgICByZXR1cm4geyBtZXRyaWNzOiB7IHJldHJpZXZlZENvdW50LCB1bnByb2Nlc3NlZENvdW50IH0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGJhdGNoR2V0PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBhdHRyaWJ1dGVzPzogRW50aXR5U2VsZWN0aW9uczxTPixcbiAgICAgICAgY29uY3VycmVudD86IG51bWJlclxuICAgIH0pIHtcbiAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgYXR0cmlidXRlcywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzO1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm9ybWF0dGVkQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3JtYXR0ZWQgYXR0cmlidXRlcyBmb3IgYmF0Y2ggZ2V0IG9uIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBmb3JtYXR0ZWRBdHRyaWJ1dGVzKTtcblxuICAgICAgICBjb25zdCByZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIGFueSkucmVkdWNlKChhY2MsIFsgYXR0TmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhY2MucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIGlmIChpc09iamVjdChvcHRpb25zKSAmJiBvcHRpb25zLmlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IEFycmF5PFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+PiA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzIDogWyBvcHRpb25zLmlkZW50aWZpZXJzIF07XG4gICAgICAgICAgICAgICAgY29uc3QgdG9wS2V5cyA9IGlkZW50aWZpZXJzLm1hcChpZGVudGlmaWVyID0+IGlkZW50aWZpZXIuc291cmNlPy5zcGxpdD8uKCcuJyk/LlsgMCBdKS5maWx0ZXIoa2V5ID0+ICEha2V5KSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgICAgICBhY2MucHVzaCguLi50b3BLZXlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIFtdIGFzIHN0cmluZ1tdKTtcblxuICAgICAgICBjb25zdCB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzID0gWyAuLi5uZXcgU2V0KHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcykgXTtcblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRCYXRjaEVudGl0eTxTPih7XG4gICAgICAgICAgICBpZHM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyBhcyBhbnksXG4gICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZXRyaWV2ZWQgYmF0Y2ggZW50aXRpZXM6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmIChlbnRpdHk/LmRhdGEpIHtcbiAgICAgICAgICAgIC8vIERlY29tcHJlc3MgYWxsIHJlY29yZHNcbiAgICAgICAgICAgIGVudGl0eS5kYXRhID0gZW50aXR5LmRhdGEubWFwKHJlY29yZCA9PiB0aGlzLmRlY29tcHJlc3NGaWVsZHMocmVjb3JkKSk7XG5cbiAgICAgICAgICAgIGlmICghIWZvcm1hdHRlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSlcbiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXR5LmRhdGEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBkYXRhOiBlbnRpdHk/LmRhdGEgfHwgW10sXG4gICAgICAgICAgICB1bnByb2Nlc3NlZDogZW50aXR5Py51bnByb2Nlc3NlZCB8fCBbXVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyB0aGUgdW5pcXVlbmVzcyBvZiBhbiBhdHRyaWJ1dGUgdmFsdWUgYW5kIHVwZGF0ZXMgdGhlIHBheWxvYWQgaWYgbmVjZXNzYXJ5LlxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNoZWNraW5nIHVuaXF1ZW5lc3MgYW5kIHVwZGF0aW5nIHRoZSBwYXlsb2FkLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLnBheWxvYWRUb1VwZGF0ZSAtIFRoZSBwYXlsb2FkIG9iamVjdCB0byB1cGRhdGUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlVmFsdWUgLSBUaGUgdmFsdWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgYXR0ZW1wdHMgdG8gY3JlYXRlIGEgdW5pcXVlIGF0dHJpYnV0ZSB2YWx1ZS5cbiAgICAgKiBAcmV0dXJucyBBIGJvb2xlYW4gaW5kaWNhdGluZyB3aGV0aGVyIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlLlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBjaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUob3B0aW9uczoge1xuICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IGFueSxcbiAgICAgICAgYXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogYW55LFxuICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM/OiB7XG4gICAgICAgICAgICBbIGtleTogc3RyaW5nIF06IGFueVxuICAgICAgICB9XG4gICAgICAgIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZTogbnVtYmVyLFxuICAgIH0pIHtcblxuICAgICAgICBjb25zdCB7IHBheWxvYWRUb1VwZGF0ZSwgYXR0cmlidXRlTmFtZSwgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzLCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgfSA9IG9wdGlvbnM7XG4gICAgICAgIGxldCB7IGF0dHJpYnV0ZVZhbHVlIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBpc1VuaXF1ZSA9IGZhbHNlO1xuICAgICAgICBsZXQgdHJpZXNDb3VudCA9IDE7XG5cbiAgICAgICAgd2hpbGUgKCFpc1VuaXF1ZSAmJiB0cmllc0NvdW50IDwgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKSB7XG4gICAgICAgICAgICBpc1VuaXF1ZSA9IGF3YWl0IHRoaXMuaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZShhdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVWYWx1ZSwgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKTtcbiAgICAgICAgICAgIGlmICghaXNVbmlxdWUpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZSA9IHRoaXMuZ2VuZXJhdGVVbmlxdWVWYWx1ZShhdHRyaWJ1dGVWYWx1ZSwgdHJpZXNDb3VudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0cmllc0NvdW50Kys7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNVbmlxdWUpIHtcbiAgICAgICAgICAgIHBheWxvYWRUb1VwZGF0ZVsgYXR0cmlidXRlTmFtZSBdID0gYXR0cmlidXRlVmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaXNVbmlxdWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIGlmIHRoZSBnaXZlbiBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlIGZvciB0aGUgc3BlY2lmaWVkIGF0dHJpYnV0ZSBuYW1lLlxuICAgICAqIEBwYXJhbSBhdHRyaWJ1dGVOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gYXR0cmlidXRlVmFsdWUgLSBUaGUgdmFsdWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcmV0dXJucyBBIGJvb2xlYW4gaW5kaWNhdGluZyB3aGV0aGVyIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlIG9yIG5vdC5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZShcbiAgICAgICAgYXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogYW55LFxuICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM/OiB7XG4gICAgICAgICAgICBbIGtleTogc3RyaW5nIF06IGFueVxuICAgICAgICB9XG4gICAgKSB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGlzVW5pcXVlQXR0cmlidXRlVmFsdWUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGF0dHJpYnV0ZU5hbWU6ICR7YXR0cmlidXRlTmFtZX0gfiBhdHRyaWJ1dGVWYWx1ZTogJHthdHRyaWJ1dGVWYWx1ZX1gKTtcblxuICAgICAgICAvLyBDcmVhdGUgZmlsdGVycyBmb3IgdGhlIHF1ZXJ5IHVzaW5nIHRoZSBjb3JyZWN0IHN0cnVjdHVyZVxuICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgWyBhdHRyaWJ1dGVOYW1lIF06IHsgZXE6IGF0dHJpYnV0ZVZhbHVlIH1cbiAgICAgICAgfSBhcyBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPjtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgd2hpY2ggYXR0cmlidXRlcyB0byBwcm9qZWN0IC0gb25seSB0aGUgYXR0cmlidXRlIGJlaW5nIGNoZWNrZWQgYW5kIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXJzXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXNUb1Byb2plY3Q6IHN0cmluZ1tdID0gWyBhdHRyaWJ1dGVOYW1lIF07XG5cbiAgICAgICAgLy8gQWRkIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXIgZmllbGRzIHRvIHRoZSBwcm9qZWN0aW9uXG4gICAgICAgIGlmIChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMgJiYgIWlzRW1wdHlPYmplY3REZWVwKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghYXR0cmlidXRlc1RvUHJvamVjdC5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNUb1Byb2plY3QucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXNlIHRoZSBxdWVyeSBtZXRob2QgdG8gbGV2ZXJhZ2UgaW5kZXggc2VsZWN0aW9uIGxvZ2ljIHdpdGggbWluaW1hbCBhdHRyaWJ1dGUgcHJvamVjdGlvblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KHtcbiAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiBhdHRyaWJ1dGVzVG9Qcm9qZWN0IGFzIGFueSxcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHsgY291bnQ6IDEgfSAvLyBXZSBvbmx5IG5lZWQgdG8ga25vdyBpZiBhbnkgcmVjb3JkcyBleGlzdFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJZiB3ZSBoYXZlIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXJzLCBmaWx0ZXIgdGhlIHJlc3VsdHMgaW4gbWVtb3J5XG4gICAgICAgIGxldCBlbnRpdGllcyA9IHJlc3VsdC5kYXRhIHx8IFtdO1xuICAgICAgICBpZiAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzICYmICFpc0VtcHR5T2JqZWN0RGVlcChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBlbnRpdGllcyA9IGVudGl0aWVzLmZpbHRlcihlbnRpdHkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAhT2JqZWN0LmVudHJpZXMoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKS5ldmVyeSgoWyBrZXksIHZhbHVlIF0pID0+XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eVsga2V5IF0gPT09IHZhbHVlXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGlzVW5pcXVlQXR0cmlidXRlVmFsdWUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGF0dHJpYnV0ZU5hbWU6ICR7YXR0cmlidXRlTmFtZX0gfiBhdHRyaWJ1dGVWYWx1ZTogJHthdHRyaWJ1dGVWYWx1ZX0gfiBlbnRpdHk6YCwgeyBkYXRhOiBlbnRpdGllcyB9KTtcblxuICAgICAgICByZXR1cm4gZW50aXRpZXMubGVuZ3RoID09PSAwO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlcyBhIHVuaXF1ZSB2YWx1ZSBieSBhcHBlbmRpbmcgYSB1bmlxdWUgc3VmZml4IHRvIHRoZSBvcmlnaW5hbCB2YWx1ZS5cbiAgICAgKiBAcGFyYW0gb3JpZ2luYWxWYWx1ZSAtIFRoZSBvcmlnaW5hbCB2YWx1ZSB0byBnZW5lcmF0ZSBhIHVuaXF1ZSB2YWx1ZSBmcm9tLlxuICAgICAqIEBwYXJhbSBhdHRlbXB0IC0gVGhlIGF0dGVtcHQgbnVtYmVyIG9yIHN0cmluZyB0byBiZSB1c2VkIGFzIGEgc3VmZml4IChkZWZhdWx0OiByYW5kb20gc3RyaW5nKS5cbiAgICAgKiBAcmV0dXJucyBUaGUgZ2VuZXJhdGVkIHVuaXF1ZSB2YWx1ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2VuZXJhdGVVbmlxdWVWYWx1ZShvcmlnaW5hbFZhbHVlOiBhbnksIGF0dGVtcHQ6IG51bWJlciB8IHN0cmluZyA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZygyLCAxNSkpOiBzdHJpbmcge1xuICAgICAgICBjb25zdCB1bmlxdWVTdWZmaXggPSBgJHtEYXRlLm5vdygpfS0ke2F0dGVtcHR9YDtcbiAgICAgICAgcmV0dXJuIGAke29yaWdpbmFsVmFsdWV9LSR7dW5pcXVlU3VmZml4fWA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXV0b21hdGljYWxseSBpbmplY3RzIGFjdG9yIGNvbnRleHQgaW50byBlbnRpdHkgZGF0YVxuICAgICAqIEBwYXJhbSBkYXRhIC0gVGhlIGVudGl0eSBkYXRhIHRvIGVuaGFuY2VcbiAgICAgKiBAcGFyYW0gb3BlcmF0aW9uIC0gVGhlIG9wZXJhdGlvbiB0eXBlIChjcmVhdGUvdXBkYXRlKVxuICAgICAqIEBwYXJhbSBjdHggLSBUaGUgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvXG4gICAgICogQHJldHVybnMgRW5oYW5jZWQgZGF0YSB3aXRoIGFjdG9yIGNvbnRleHRcbiAgICAgKi9cbiAgICBwcm90ZWN0ZWQgaW5qZWN0QWN0b3JDb250ZXh0PFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICAgICAgZGF0YTogVCxcbiAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ3Vwc2VydCcgfCAnZGVsZXRlJyxcbiAgICAgICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICAgICk6IFQge1xuXG4gICAgICAgIC8vIFByZWZlciBleHBsaWNpdCBjdHguYWN0b3IsIG90aGVyd2lzZSBmYWxsIGJhY2sgdG8gZnJhbWV3b3JrIGV4ZWN1dGlvbi1jb250ZXh0IChBc3luY0xvY2FsU3RvcmFnZSkuXG4gICAgICAgIC8vIFRoaXMgaXMgaW1wb3J0YW50IGZvciBiYWNrZ3JvdW5kIGhhbmRsZXJzIChxdWV1ZXMvdGFza3MpIHdoZXJlIGN0eCBtYXkgbm90IGJlIHRocmVhZGVkIHRocm91Z2guXG4gICAgICAgIGNvbnN0IGVmZmVjdGl2ZUFjdG9yID0gY3R4Py5hY3RvciA/PyBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpPy5hY3RvcjtcbiAgICAgICAgaWYgKCFlZmZlY3RpdmVBY3Rvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0Jhc2VFbnRpdHlTZXJ2aWNlOiBObyBhY3RvciBjb250ZXh0IGZvdW5kLCBza2lwcGluZyBpbmplY3Rpb24nKTtcbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW5oYW5jZWREYXRhID0geyAuLi5kYXRhIH07XG4gICAgICAgIGNvbnN0IGFjdG9yID0gZWZmZWN0aXZlQWN0b3I7XG5cbiAgICAgICAgLy8gSU1QT1JUQU5UOiBXZSBkbyBOT1QgcGVyc2lzdC9wcm9wYWdhdGUgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGFjcm9zcyBob3BzLlxuICAgICAgICAvLyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaXMgc3RyaWN0IGhpZXJhcmNoeSB3aXRoaW4gYSBzaW5nbGUgaW52b2NhdGlvbidzIHBlcnNpc3RlZCBzbGljZS5cblxuICAgICAgICAvLyBHZXQgY3VycmVudCB0aW1lc3RhbXAgZm9yIGRhdGFiYXNlIG9wZXJhdGlvblxuICAgICAgICBjb25zdCBjdXJyZW50VGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gICAgICAgIC8vIEluamVjdCB2aXNpYmxlIGFjdG9yIGZpZWxkcyBpZiBkZWZpbmVkIGluIHNjaGVtYSBhbmQgbm90IHJlYWQtb25seVxuICAgICAgICBpZiAob3BlcmF0aW9uID09PSAnY3JlYXRlJykge1xuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdjcmVhdGVkQnknKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdjcmVhdGVkQnknKSAmJiBhY3Rvci5hY3RvcklkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLmNyZWF0ZWRCeSA9IGFjdG9yLmFjdG9ySWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2NyZWF0ZWRBdCcpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2NyZWF0ZWRBdCcpKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLmNyZWF0ZWRBdCA9IGN1cnJlbnRUaW1lc3RhbXA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGb3IgZGVsZXRlIG9wZXJhdGlvbnMsIHdlIHN0aWxsIHdhbnQgdG8gdHJhY2sgd2hvIHBlcmZvcm1lZCB0aGUgZGVsZXRpb25cbiAgICAgICAgaWYgKG9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnZGVsZXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnZGVsZXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5kZWxldGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdkZWxldGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdkZWxldGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5kZWxldGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQWx3YXlzIHVwZGF0ZSB0aGVzZSBmaWVsZHMgb24gY3JlYXRlL3VwZGF0ZSAoaWYgbm90IHJlYWQtb25seSlcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndXBkYXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndXBkYXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS51cGRhdGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICd1cGRhdGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd1cGRhdGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS51cGRhdGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICd0ZW5hbnRJZCcpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3RlbmFudElkJykgJiYgYWN0b3IudGVuYW50SWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudGVuYW50SWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFsd2F5cyBpbmplY3QgY29tcGxldGUgYWN0b3IgY29udGV4dCBmb3IgYXVkaXQgdHJhaWxcbiAgICAgICAgLy8gVGhpcyBmaWVsZCBpcyBoaWRkZW4gZnJvbSBBUEkgcmVzcG9uc2VzIGJ5IGRlZmF1bHRcbiAgICAgICAgLy8gQ2xlYW4gYWN0b3Igb2JqZWN0IGJ5IHJlbW92aW5nIHVuZGVmaW5lZCB2YWx1ZXMgKER5bmFtb0RCIGRvZXNuJ3QgYWxsb3cgdGhlbSlcbiAgICAgICAgY29uc3QgY2xlYW5BY3RvciA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHtcbiAgICAgICAgICAgICAgICAuLi5hY3RvcixcbiAgICAgICAgICAgIH0pLmZpbHRlcigoWyBfLCB2YWx1ZSBdKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICApO1xuXG4gICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5fYWN0b3IgPSBjbGVhbkFjdG9yO1xuXG4gICAgICAgIHJldHVybiBlbmhhbmNlZERhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBlbnRpdHkuXG4gICAgICogXG4gICAgICogQHBhcmFtIHBheWxvYWQgLSBUaGUgcGF5bG9hZCBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdpbmZvJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAnd3JpdGUnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBjcmVhdGUocGF5bG9hZDogQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICAgICAgbGV0IHBheWxvYWRDb3B5ID0geyAuLi5wYXlsb2FkIH07XG5cbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHRcbiAgICAgICAgcGF5bG9hZENvcHkgPSB0aGlzLmluamVjdEFjdG9yQ29udGV4dChwYXlsb2FkQ29weSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJyc7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnbmFtZScpIHx8ICcnO1xuXG4gICAgICAgIGlmIChlbnRpdHlTbHVnQXR0cmlidXRlICYmICEoZW50aXR5U2x1Z0F0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIChlbnRpdHlOYW1lQXR0cmlidXRlIGluIHBheWxvYWRDb3B5KSkge1xuICAgICAgICAgICAgICAgIHBheWxvYWRDb3B5WyBlbnRpdHlTbHVnQXR0cmlidXRlIGFzIGtleW9mIHR5cGVvZiBwYXlsb2FkQ29weSBdID0gdG9TbHVnKHBheWxvYWRDb3B5WyBlbnRpdHlOYW1lQXR0cmlidXRlIF0pIGFzIGFueTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gcGF5bG9hZENvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gcGF5bG9hZENvcHlbIG5hbWUhIF07XG4gICAgICAgICAgICAgICAgICAgIHVuaXF1ZW5lc3NDaGVja3MucHVzaCgoKSA9PiB0aGlzLmNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IHBheWxvYWRDb3B5LFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHVuaXF1ZW5lc3NDaGVja3MubWFwKGNoZWNrID0+IGNoZWNrKCkpKTtcblxuICAgICAgICAgICAgaWYgKGNoZWNrUmVzdWx0cy5pbmNsdWRlcyhmYWxzZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHNQYXRoID0gdW5pcXVlRmllbGRzLm1hcChmaWVsZCA9PiBmaWVsZC5uYW1lISkgPz8gW107XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKFsge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlVuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igb25lIG9yIG1vcmUgZmllbGRzLlwiLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiB1bmlxdWVGaWVsZHNQYXRoLFxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogWyAndW5pcXVlJywgdW5pcXVlRmllbGRzIF0sXG4gICAgICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbXByZXNzIGZpZWxkcyBiZWZvcmUgd3JpdGluZ1xuICAgICAgICBwYXlsb2FkQ29weSA9IHRoaXMuY29tcHJlc3NGaWVsZHMocGF5bG9hZENvcHkpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGNyZWF0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBkYXRhOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRGVjb21wcmVzcyBmaWVsZHMgYWZ0ZXIgcmVhZGluZ1xuICAgICAgICByZXR1cm4gdGhpcy5kZWNvbXByZXNzRmllbGRzKGVudGl0eSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcy1PUi1VcGRhdGVzIGFuIGVudGl0eS5cbiAgICAgKiBOT1RFOiBcbiAgICAgKiAgIC0gVGhpcyBtZXRob2QgZG9lcyBub3QgY2hlY2sgZm9yIHVuaXF1ZW5lc3Mgb2YgdGhlIGF0dHJpYnV0ZXMsIG5laXRoZXIgY3JlYXRlIHRoZSBzbHVnIGF1dG9tYXRpY2FsbHkuXG4gICAgICogICAtIEl0J3MgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIHRoZSBjYWxsZXIgdG8gZW5zdXJlIHRoZSByZWFkIG9ueSBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaWYgdGhlIHJlY29yZCBpcyBiZWluZyB1cHNlcnQuXG4gICAgICogXG4gICAgICogQHBhcmFtIHBheWxvYWQgLSBUaGUgcGF5bG9hZCBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBPYmplY3QgY29udGFpbmluZzpcbiAgICAgKiAgIC0gZGF0YTogVGhlIHVwc2VydGVkIGVudGl0eSBkYXRhXG4gICAgICogICAtIHdhc0NyZWF0ZWQ6IHRydWUgaWYgcmVjb3JkIHdhcyBjcmVhdGVkLCBmYWxzZSBpZiB1cGRhdGVkXG4gICAgICogICAtIG9sZERhdGE6IHByZXZpb3VzIGRhdGEgaWYgaXQgd2FzIGFuIHVwZGF0ZSAodW5kZWZpbmVkIGZvciBjcmVhdGVzKVxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnaW5mbycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3dyaXRlJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UgfSkgPT4gKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSB9XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIGZpbmlzaDogKHsgcmVzdWx0IH0pID0+ICh7XG4gICAgICAgICAgICAgICAgdGFnczogeyB3YXNDcmVhdGVkOiAhIShyZXN1bHQgYXMgeyB3YXNDcmVhdGVkPzogYm9vbGVhbiB9IHwgdW5kZWZpbmVkKT8ud2FzQ3JlYXRlZCB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgdXBzZXJ0KHBheWxvYWQ6IFVwc2VydEVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBwYXlsb2FkOmAsIHBheWxvYWQpO1xuXG4gICAgICAgIC8vIEluamVjdCBhY3RvciBjb250ZXh0IHNvIER5bmFtb0RCIGltYWdlcyBhbHdheXMgaGF2ZSBfYWN0b3IgZm9yIGF1ZGl0aW5nL2NhdXNlZEJ5XG4gICAgICAgIC8vIFRyZWF0IHVwc2VydCBhcyBhbiB1cGRhdGUgZm9yIGFjdG9yLWZpZWxkIHB1cnBvc2VzICh3ZSBhbHdheXMgd2FudCBfYWN0b3IgYW5kIHVwZGF0ZWRCeS91cGRhdGVkQXQpLlxuICAgICAgICBsZXQgcGF5bG9hZENvcHkgPSB0aGlzLmluamVjdEFjdG9yQ29udGV4dCh7IC4uLnBheWxvYWQgfSwgJ3Vwc2VydCcpO1xuXG4gICAgICAgIC8vIENvbXByZXNzIGZpZWxkcyBiZWZvcmUgd3JpdGluZ1xuICAgICAgICBwYXlsb2FkQ29weSA9IHRoaXMuY29tcHJlc3NGaWVsZHMocGF5bG9hZENvcHkpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHVwc2VydEVudGl0eTxTPih7XG4gICAgICAgICAgICBkYXRhOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRGVjb21wcmVzcyByZXN1bHQgZmllbGRzXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5yZXN1bHQsXG4gICAgICAgICAgICBkYXRhOiByZXN1bHQuZGF0YSA/IHRoaXMuZGVjb21wcmVzc0ZpZWxkcyhyZXN1bHQuZGF0YSkgOiByZXN1bHQuZGF0YSxcbiAgICAgICAgICAgIG9sZERhdGE6IHJlc3VsdC5vbGREYXRhID8gdGhpcy5kZWNvbXByZXNzRmllbGRzKHJlc3VsdC5vbGREYXRhKSA6IHVuZGVmaW5lZFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBkdXBsaWNhdGUgZW50aXR5IGRhdGEgYmFzZWQgb24gdGhlIGdpdmVuIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBkdXBsaWNhdGUgZW50aXR5IGRhdGEuXG4gICAgICogQHRocm93cyBFcnJvciBpZiBubyByZWNvcmQgaXMgZm91bmQgZm9yIHRoZSBnaXZlbiBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGlkZW50aWZpZXJzID0geyBpZDogMSB9O1xuICAgICAqIGNvbnN0IGR1cGxpY2F0ZURhdGEgPSBhd2FpdCBtYWtlRHVwbGljYXRlRW50aXR5RGF0YUJ5SWRlbnRpZmllcnMoaWRlbnRpZmllcnMpO1xuICAgICAqIGNvbnNvbGUubG9nKGR1cGxpY2F0ZURhdGEpOyAvLyB7IG5hbWU6ICdKb2huIERvZScsIGFnZTogMzAsIC4uLiB9XG4gICAgICovXG4gICAgcHJvdGVjdGVkIGFzeW5jIG1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+KSB7XG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0KHsgaWRlbnRpZmllcnMgfSkgYXMgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz47XG5cbiAgICAgICAgaWYgKCFlbnRpdHkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gcmVjb3JkIGZvdW5kIGZvciBpZGVudGlmaWVyczogJHtpZGVudGlmaWVyc31gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBkdXBsaWNhdGVFdmVudERhdGE6IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiA9IHt9IGFzIGFueTtcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkUHJvcE5hbWUgPSB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpIGFzIHN0cmluZztcblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTbHVnQXR0cmlidXRlID0gKGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSAoZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ25hbWUnKSB8fCAnJykudG9VcHBlckNhc2UoKTtcblxuICAgICAgICBmb3IgKGxldCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhlbnRpdHkpKSB7XG5cbiAgICAgICAgICAgIGlmIChrZXkgIT09IHByaW1hcnlJZFByb3BOYW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gVE9ETzogaGFuZGxlIHdoZW4gZW50aXR5IGhhcyBtdWx0aXBsZSBpZGVudGlmaWVyc1xuXG4gICAgICAgICAgICAgICAgaWYgKGtleS50b1VwcGVyQ2FzZSgpID09PSBlbnRpdHlOYW1lQXR0cmlidXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gYCR7dmFsdWV9IC0gQ29weWA7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkudG9VcHBlckNhc2UoKSA9PT0gZW50aXR5U2x1Z0F0dHJpYnV0ZSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGAke3ZhbHVlfS1jb3B5YDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBkdXBsaWNhdGVFdmVudERhdGFbIGtleSBhcyBrZXlvZiB0eXBlb2YgZHVwbGljYXRlRXZlbnREYXRhIF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkdXBsaWNhdGVFdmVudERhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIGR1cGxpY2F0ZSBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZCAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIGR1cGxpY2F0ZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgZHVwbGljYXRlZCBlbnRpdHkuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBlbnRpdHlJZCA9IHsgaWQ6IDEyMywgbmFtZTogJ2V4YW1wbGUnIH07XG4gICAgICogY29uc3QgZHVwbGljYXRlZEVudGl0eSA9IGF3YWl0IGR1cGxpY2F0ZShlbnRpdHlJZCk7XG4gICAgICovXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdpbmZvJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAnd3JpdGUnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBkdXBsaWNhdGUoaWQ6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZHVwbGljYXRlRXZlbnREYXRhID0gYXdhaXQgdGhpcy5tYWtlRHVwbGljYXRlRW50aXR5RGF0YShpZCk7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNyZWF0ZShkdXBsaWNhdGVFdmVudERhdGEsIGN0eCk7XG4gICAgfVxuXG4gICAgLy8gVE9ETzogc2hvdWxkIGJlIHBhcnQgb2Ygc29tZSBjb25maWdcbiAgICBwcm90ZWN0ZWQgZGVsaW1pdGVyc1JlZ2V4ID0gLyg/OiZ8IHwsfFxcKykrLztcblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIHF1ZXJ5LlxuICAgICAqIC0gSWYgbm8gc3BlY2lmaWMgYXR0cmlidXRlcyBhcmUgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2YgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAtIElmIGEgc2VhcmNoIHRlcm0gaXMgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5IGl0IHdpbGwgc3BsaXQgdGhlIHNlYXJjaCB0ZXJtIGJ5IGAvKD86JnwgfCx8XFwrKSsvYCBSZWdleCBhbmQgd2lsbCBmaWx0ZXIgb3V0IGVtcHR5IHN0cmluZ3MuXG4gICAgICogLSBJZiBzZWFyY2ggYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIHNlYXJjaGFibGUgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcXVlcnkgLSBUaGUgcXVlcnkgb2JqZWN0IGNvbnRhaW5pbmcgZmlsdGVycywgc2VhcmNoIGtleXdvcmRzLCBhbmQgYXR0cmlidXRlcy5cbiAgICAgKiBAcmV0dXJucyBBIFByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgbGlzdCBvZiBlbnRpdGllcyBhbmQgdGhlIG9yaWdpbmFsIHF1ZXJ5LlxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UsIGFyZ3MgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgcXVlcnkgXSA9IGFyZ3MgYXMgWyB7IGZpbHRlcnM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9IHwgdW5kZWZpbmVkIF07XG4gICAgICAgICAgICAgICAgY29uc3QgaGFzRmlsdGVycyA9ICEhcXVlcnk/LmZpbHRlcnMgJiYgT2JqZWN0LmtleXMocXVlcnkuZmlsdGVycykubGVuZ3RoID4gMDtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAoaW5zdGFuY2UgYXMgeyBnZXRFbnRpdHlOYW1lKCk6IHN0cmluZyB9KS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBoYXNGaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmaW5pc2g6ICh7IHJlc3VsdCB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgciA9IHJlc3VsdCBhcyB7IGRhdGE/OiB1bmtub3duW107IGN1cnNvcj86IHVua25vd24gfSB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHRDb3VudCA9IEFycmF5LmlzQXJyYXkocj8uZGF0YSkgPyByIS5kYXRhLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgdGFnczogeyBoYXNDdXJzb3I6ICEhcj8uY3Vyc29yIH0sXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHsgcmVzdWx0Q291bnQgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBsaXN0KHF1ZXJ5OiBFbnRpdHlRdWVyeTxTPiA9IHt9LCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gbGlzdCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcXVlcnk6YCwgcXVlcnkpO1xuXG4gICAgICAgIGlmICghcXVlcnkuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgcXVlcnkuYXR0cmlidXRlcyA9IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGZvciBsaXN0aW5nIEFQSSBhdHRyaWJ1dGVzIHdvdWxkIGJlIGFuIGFycmF5XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHF1ZXJ5LmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhxdWVyeS5hdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIHF1ZXJ5LmF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocXVlcnkuc2VhcmNoKSB7XG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoKSkge1xuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaCA9IHF1ZXJ5LnNlYXJjaC50cmltKCkuc3BsaXQodGhpcy5kZWxpbWl0ZXJzUmVnZXggPz8gJyAnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuc2VhcmNoLmxlbmd0aCA+IDApIHtcblxuICAgICAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzID0gcXVlcnkuc2VhcmNoQXR0cmlidXRlcy5zcGxpdCgnLCcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghcXVlcnkuc2VhcmNoQXR0cmlidXRlcyB8fCBpc0VtcHR5KHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSB0aGlzLmdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlckdyb3VwID0gbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMocXVlcnkuc2VhcmNoLCBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKTtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LmZpbHRlcnMgPSBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4oc2VhcmNoRmlsdGVyR3JvdXAgYXMgYW55LCBxdWVyeS5maWx0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzID0gYXdhaXQgbGlzdEVudGl0eTxTPih7XG4gICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRGVjb21wcmVzcyBhbGwgcmVjb3Jkc1xuICAgICAgICBlbnRpdGllcy5kYXRhID0gZW50aXRpZXMuZGF0YS5tYXAocmVjb3JkID0+IHRoaXMuZGVjb21wcmVzc0ZpZWxkcyhyZWNvcmQpKTtcblxuICAgICAgICBlbnRpdGllcy5kYXRhID0gdGhpcy5zZXJpYWxpemVSZWNvcmRzKGVudGl0aWVzLmRhdGEsIHF1ZXJ5LmF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGlmIChxdWVyeS5hdHRyaWJ1dGVzICYmIGVudGl0aWVzLmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMocXVlcnkuYXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF07XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC8vIG9ubHkgYXR0cmlidXRlcyBpbiBoeWRyYXRlIG9wdGlvbnMgdGhhdCBoYXZlIHJlbGF0aW9uIG1ldGFkYXRhIGF0dGFjaGVkIHRvIHRoZW0gbmVlZHMgdG8gYmUgaHlkcmF0ZWRcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXRpZXMuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyAuLi5lbnRpdGllcywgcXVlcnkgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEV4ZWN1dGVzIGEgcXVlcnkgb24gdGhlIGVudGl0eS5cbiAgICAgKiAtIElmIG5vIHNwZWNpZmljIGF0dHJpYnV0ZXMgYXJlIHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogLSBJZiBhIHNlYXJjaCB0ZXJtIGlzIHByb3ZpZGVkIGluIHRoZSBxdWVyeSBpdCB3aWxsIHNwbGl0IHRoZSBzZWFyY2ggdGVybSBieSBgLyg/OiZ8IHwsfFxcKykrL2AgUmVnZXggYW5kIHdpbGwgZmlsdGVyIG91dCBlbXB0eSBzdHJpbmdzLlxuICAgICAqICAgLS0gSWYgc2VhcmNoIGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBzZWFyY2hhYmxlIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogICAtLSBJZiB0aGVyZSBhcmUgYW55IG5vbi1lbXB0eSBzZWFyY2gtdGVybXMsIGl0IHdpbGwgYWRkIGEgZmlsdGVyIGdyb3VwIHRvIHRoZSBxdWVyeSBiYXNlZCBvbiB0aGUgc2VhcmNoIGtleXdvcmRzLlxuICAgICAqIEBwYXJhbSBxdWVyeSAtIFRoZSBlbnRpdHkgcXVlcnkgdG8gZXhlY3V0ZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmVzdWx0IG9mIHRoZSBxdWVyeS5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2RlYnVnJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAncmVhZCcgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIHF1ZXJ5IF0gPSBhcmdzIGFzIFsgeyBmaWx0ZXJzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfSB8IHVuZGVmaW5lZCBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGhhc0ZpbHRlcnMgPSAhIXF1ZXJ5Py5maWx0ZXJzICYmIE9iamVjdC5rZXlzKHF1ZXJ5LmZpbHRlcnMpLmxlbmd0aCA+IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgICAgICAgICAgICAgaGFzRmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZmluaXNoOiAoeyByZXN1bHQgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHIgPSByZXN1bHQgYXMgeyBkYXRhPzogdW5rbm93bltdIH0gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0Q291bnQgPSBBcnJheS5pc0FycmF5KHI/LmRhdGEpID8gciEuZGF0YS5sZW5ndGggOiAwO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IG1ldHJpY3M6IHsgcmVzdWx0Q291bnQgfSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgcXVlcnkocXVlcnk6IEVudGl0eVF1ZXJ5PFM+LCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gbGlzdCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcXVlcnk6YCwgcXVlcnkpO1xuXG4gICAgICAgIGNvbnN0IHsgYXR0cmlidXRlcyB9ID0gcXVlcnk7XG5cbiAgICAgICAgbGV0IHNlbGVjdEF0dHJpYnV0ZXM6IEVudGl0eVNlbGVjdGlvbnM8Uz4gfCB1bmRlZmluZWQgPSBhdHRyaWJ1dGVzIHx8IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0QXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIC8vIHBhcnNlIHRoZSBsaXN0IG9mIGRvdC1zZXBhcmF0ZWQgYXR0cmlidXRlLWlkZW50aWZpZXJzIHBhdGhzIGFuZCBlbnN1cmUgYWxsIHRoZSByZXF1aXJlZCBtZXRhZGF0YSBpcyB0aGVyZVxuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoc2VsZWN0QXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBzZWxlY3RBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gZW5zdXJlIGFsbCB0aGUgcHJvdmlkZWQgc2VsZWN0IGF0dHJpYnV0ZXMgaGFzIHJlcXVpcmVkIG1ldGFkYXRhIGFsbCB0aGUgd2F5IGRvd24gdG8gdGhlIGxlYWYgbGV2ZWxcbiAgICAgICAgICAgIHNlbGVjdEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgc2VsZWN0QXR0cmlidXRlcyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocXVlcnkuc2VhcmNoKSB7XG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoKSkge1xuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaCA9IHF1ZXJ5LnNlYXJjaC50cmltKCkuc3BsaXQodGhpcy5kZWxpbWl0ZXJzUmVnZXggPz8gJyAnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuc2VhcmNoLmxlbmd0aCA+IDApIHtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzIHx8IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXJHcm91cCA9IG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzKHF1ZXJ5LnNlYXJjaCwgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyk7XG5cbiAgICAgICAgICAgICAgICBxdWVyeS5maWx0ZXJzID0gYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhPFM+KHNlYXJjaEZpbHRlckdyb3VwIGFzIGFueSwgcXVlcnkuZmlsdGVycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdGllcyA9IGF3YWl0IHF1ZXJ5RW50aXR5PFM+KHtcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBEZWNvbXByZXNzIGFsbCByZWNvcmRzXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSBlbnRpdGllcy5kYXRhLm1hcChyZWNvcmQgPT4gdGhpcy5kZWNvbXByZXNzRmllbGRzKHJlY29yZCkpO1xuXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSB0aGlzLnNlcmlhbGl6ZVJlY29yZHMoZW50aXRpZXMuZGF0YSwgc2VsZWN0QXR0cmlidXRlcyk7XG5cbiAgICAgICAgaWYgKHNlbGVjdEF0dHJpYnV0ZXMgJiYgZW50aXRpZXMuZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhzZWxlY3RBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLy8gb25seSBhdHRyaWJ1dGVzIGluIGh5ZHJhdGUgb3B0aW9ucyB0aGF0IGhhdmUgcmVsYXRpb24gbWV0YWRhdGEgYXR0YWNoZWQgdG8gdGhlbSBuZWVkcyB0byBiZSBoeWRyYXRlZFxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdGllcy5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IC4uLmVudGl0aWVzLCBxdWVyeSB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFVwZGF0ZXMgYW4gZW50aXR5IGluIHRoZSBkYXRhYmFzZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0gZGF0YSAtIFRoZSB1cGRhdGVkIGRhdGEgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHBhcmFtIHJlbW92ZSAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gcmVtb3ZlIGZyb20gdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgdXBkYXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdpbmZvJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAnd3JpdGUnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyB1cGRhdGUoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4sIGRhdGE6IFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiwgb3BlcmF0b3JzPzogVXBkYXRlRW50aXR5T3BlcmF0b3JzLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHRcbiAgICAgICAgbGV0IGVuaGFuY2VkRGF0YSA9IHRoaXMuaW5qZWN0QWN0b3JDb250ZXh0KGRhdGEgYXMgYW55LCAndXBkYXRlJywgY3R4KTtcblxuICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHMgPSB0aGlzLmdldFVuaXF1ZUF0dHJpYnV0ZXMoKTtcbiAgICAgICAgY29uc3Qgc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlID0gNTtcblxuICAgICAgICBpZiAoIXNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzICYmIHVuaXF1ZUZpZWxkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxldCB1bmlxdWVuZXNzQ2hlY2tzID0gW107XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lLCByZWFkT25seSB9IG9mIHVuaXF1ZUZpZWxkcykge1xuICAgICAgICAgICAgICAgIGlmIChyZWFkT25seSkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgZW5oYW5jZWREYXRhWyBuYW1lIGFzIGtleW9mIHR5cGVvZiBlbmhhbmNlZERhdGEgXTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKG5hbWUhIGluIGVuaGFuY2VkRGF0YSkge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdmFsdWUgPSBlbmhhbmNlZERhdGFbIG5hbWUgYXMga2V5b2YgdHlwZW9mIGVuaGFuY2VkRGF0YSBdO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBlbmhhbmNlZERhdGEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBuYW1lISxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZVZhbHVlOiB2YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVyczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHVuaXF1ZW5lc3NDaGVja3MubWFwKGNoZWNrID0+IGNoZWNrKCkpKTtcblxuICAgICAgICAgICAgaWYgKGNoZWNrUmVzdWx0cy5pbmNsdWRlcyhmYWxzZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHNQYXRoID0gdW5pcXVlRmllbGRzLm1hcChmaWVsZCA9PiBmaWVsZC5uYW1lISkgPz8gW107XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKFsge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlVuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igb25lIG9yIG1vcmUgZmllbGRzLlwiLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiB1bmlxdWVGaWVsZHNQYXRoLFxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogWyAndW5pcXVlJywgdW5pcXVlRmllbGRzIF0sXG4gICAgICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbXByZXNzIGZpZWxkcyBiZWZvcmUgd3JpdGluZ1xuICAgICAgICBlbmhhbmNlZERhdGEgPSB0aGlzLmNvbXByZXNzRmllbGRzKGVuaGFuY2VkRGF0YSk7XG5cbiAgICAgICAgY29uc3QgdXBkYXRlZEVudGl0eSA9IGF3YWl0IHVwZGF0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBkYXRhOiBlbmhhbmNlZERhdGEsXG4gICAgICAgICAgICBvcGVyYXRvcnM6IG9wZXJhdG9ycyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRGVjb21wcmVzcyBmaWVsZHMgYWZ0ZXIgcmVhZGluZ1xuICAgICAgICByZXR1cm4gdGhpcy5kZWNvbXByZXNzRmllbGRzKHVwZGF0ZWRFbnRpdHkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGV0ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBiZSBkZWxldGVkLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBkZWxldGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ3dhcm4nIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdkZWxldGUnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBkZWxldGUoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGRlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gaWRlbnRpZmllcnM6YCwgaWRlbnRpZmllcnMpO1xuXG4gICAgICAgICAgICBjb25zdCBkZWxldGVkRW50aXR5ID0gYXdhaXQgZGVsZXRlRW50aXR5PFM+KHtcbiAgICAgICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgICAgICAgICBhY3RvcjogY3R4Py5hY3RvcixcbiAgICAgICAgICAgICAgICB0ZW5hbnQ6IGN0eD8uYWN0b3I/LnRlbmFudElkLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiBkZWxldGVkRW50aXR5O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBtdWx0aXBsZSBlbnRpdGllcyBpbiBhIGJhdGNoIG9wZXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBiYXRjaCBkZWxldGluZyBlbnRpdGllcy5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5pZGVudGlmaWVycyAtIEFycmF5IG9mIGVudGl0eSBpZGVudGlmaWVycyB0byBkZWxldGUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuY29uY3VycmVudCAtIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgdG8gcGVyZm9ybSAoZGVmYXVsdDogMSkuXG4gICAgICogQHBhcmFtIGN0eCAtIE9wdGlvbmFsIGV4ZWN1dGlvbiBjb250ZXh0IGNvbnRhaW5pbmcgYWN0b3IgaW5mb3JtYXRpb24uXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gb2JqZWN0IGNvbnRhaW5pbmcgYW55IHVucHJvY2Vzc2VkIGl0ZW1zLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIERlbGV0ZSBtdWx0aXBsZSBlbnRpdGllc1xuICAgICAqIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlcnZpY2UuYmF0Y2hEZWxldGUoe1xuICAgICAqICAgaWRlbnRpZmllcnM6IFtcbiAgICAgKiAgICAgeyBpZDogJ2l0ZW0xJyB9LFxuICAgICAqICAgICB7IGlkOiAnaXRlbTInIH0sXG4gICAgICogICAgIHsgaWQ6ICdpdGVtMycgfVxuICAgICAqICAgXSxcbiAgICAgKiAgIGNvbmN1cnJlbnQ6IDJcbiAgICAgKiB9KTtcbiAgICAgKiBcbiAgICAgKiBpZiAocmVzdWx0LnVucHJvY2Vzc2VkLmxlbmd0aCA+IDApIHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKCdTb21lIGl0ZW1zIHdlcmUgbm90IGRlbGV0ZWQ6JywgcmVzdWx0LnVucHJvY2Vzc2VkKTtcbiAgICAgKiB9XG4gICAgICogYGBgXG4gICAgICovXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICd3YXJuJyB9LCAvLyBCYXRjaCBkZWxldGVzIGFyZSBjcml0aWNhbFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAnZGVsZXRlJywgYmF0Y2g6ICd0cnVlJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UsIGFyZ3MgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgb3B0aW9ucyBdID0gYXJncyBhcyBbIHsgaWRlbnRpZmllcnM/OiB1bmtub3duW107IGNvbmN1cnJlbnQ/OiBudW1iZXIgfSBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhdGNoU2l6ZSA9IEFycmF5LmlzQXJyYXkob3B0aW9ucz8uaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycy5sZW5ndGggOiAwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbmN1cnJlbnQgPSB0eXBlb2Ygb3B0aW9ucz8uY29uY3VycmVudCA9PT0gJ251bWJlcicgPyBvcHRpb25zLmNvbmN1cnJlbnQgOiAxO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH0sXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHsgYmF0Y2hTaXplLCBjb25jdXJyZW50IH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZpbmlzaDogKHsgcmVzdWx0IH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gcmVzdWx0IGFzIHsgZGF0YT86IHVua25vd25bXTsgdW5wcm9jZXNzZWQ/OiB1bmtub3duW10gfSB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVkQ291bnQgPSBBcnJheS5pc0FycmF5KHI/LmRhdGEpID8gciEuZGF0YS5sZW5ndGggOiAwO1xuICAgICAgICAgICAgICAgIGNvbnN0IHVucHJvY2Vzc2VkQ291bnQgPSBBcnJheS5pc0FycmF5KHI/LnVucHJvY2Vzc2VkKSA/IHIhLnVucHJvY2Vzc2VkLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgbWV0cmljczogeyBkZWxldGVkQ291bnQsIHVucHJvY2Vzc2VkQ291bnQgfSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgYmF0Y2hEZWxldGUob3B0aW9uczoge1xuICAgICAgICBpZGVudGlmaWVyczogQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sXG4gICAgICAgIGNvbmN1cnJlbnQ/OiBudW1iZXJcbiAgICB9LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IGlkZW50aWZpZXJzLCBjb25jdXJyZW50ID0gMSB9ID0gb3B0aW9ucztcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGJhdGNoRGVsZXRlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBjb3VudDogJHtpZGVudGlmaWVycy5sZW5ndGh9YCwge1xuICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkZWxldGVCYXRjaEVudGl0eTxTPih7XG4gICAgICAgICAgICAgICAgaWRzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICAgICAgICAgIGFjdG9yOiBjdHg/LmFjdG9yLFxuICAgICAgICAgICAgICAgIHRlbmFudDogY3R4Py5hY3Rvcj8udGVuYW50SWQsXG4gICAgICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEVsZWN0cm9EQiBiYXRjaCBkZWxldGUgcmV0dXJucyB7IHVucHJvY2Vzc2VkOiBBcnJheSB9XG4gICAgICAgICAgICBjb25zdCB1bnByb2Nlc3NlZENvdW50ID0gKHJlc3VsdCBhcyBhbnkpPy51bnByb2Nlc3NlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgICBjb25zdCBkYXRhQ291bnQgPSByZXN1bHQuZGF0YT8ubGVuZ3RoO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvbXBsZXRlZCB+IGJhdGNoRGVsZXRlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBwcm9jZXNzZWQ6ICR7aWRlbnRpZmllcnMubGVuZ3RofSwgZGF0YUNvdW50OiAke2RhdGFDb3VudH0sIHVucHJvY2Vzc2VkOiAke3VucHJvY2Vzc2VkQ291bnR9YCk7XG5cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBEYXRhYmFzZUVycm9yKGBGYWlsZWQgdG8gYmF0Y2ggZGVsZXRlICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxldGVzIGVudGl0aWVzIGJhc2VkIG9uIGEgcXVlcnkgZmlsdGVyLlxuICAgICAqIFRoaXMgbWV0aG9kIHF1ZXJpZXMgZm9yIGVudGl0aWVzIG1hdGNoaW5nIHRoZSBmaWx0ZXIgYW5kIHRoZW4gYmF0Y2ggZGVsZXRlcyB0aGVtLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGRlbGV0aW5nIGJ5IHF1ZXJ5LlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmZpbHRlcnMgLSBUaGUgZmlsdGVyIGNyaXRlcmlhIHRvIG1hdGNoIGVudGl0aWVzIGZvciBkZWxldGlvbi5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5iYXRjaFNpemUgLSBUaGUgbnVtYmVyIG9mIGl0ZW1zIHRvIGRlbGV0ZSBpbiBlYWNoIGJhdGNoIChkZWZhdWx0OiAyNSkuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuY29uY3VycmVudCAtIE51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgKGRlZmF1bHQ6IDEpLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLm1heEl0ZW1zIC0gT3B0aW9uYWwgbWF4aW11bSBudW1iZXIgb2YgaXRlbXMgdG8gZGVsZXRlIChzYWZldHkgbGltaXQpLlxuICAgICAqIEBwYXJhbSBjdHggLSBPcHRpb25hbCBleGVjdXRpb24gY29udGV4dCBjb250YWluaW5nIGFjdG9yIGluZm9ybWF0aW9uLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCB3aXRoIGRlbGV0aW9uIHN0YXRpc3RpY3MuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRGVsZXRlIGFsbCBpbmFjdGl2ZSB1c2Vyc1xuICAgICAqIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHVzZXJTZXJ2aWNlLmRlbGV0ZUJ5UXVlcnkoe1xuICAgICAqICAgZmlsdGVyczoge1xuICAgICAqICAgICBzdGF0dXM6IHsgZXE6ICdpbmFjdGl2ZScgfSxcbiAgICAgKiAgICAgbGFzdExvZ2luQXQ6IHsgbHQ6ICcyMDIzLTAxLTAxJyB9XG4gICAgICogICB9LFxuICAgICAqICAgYmF0Y2hTaXplOiA1MCxcbiAgICAgKiAgIG1heEl0ZW1zOiAxMDAwXG4gICAgICogfSk7XG4gICAgICogXG4gICAgICogY29uc29sZS5sb2coYERlbGV0ZWQgJHtyZXN1bHQuZGVsZXRlZENvdW50fSBpdGVtcywgJHtyZXN1bHQuZmFpbGVkQ291bnR9IGZhaWxlZGApO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnd2FybicgfSwgLy8gQnVsayBkZWxldGVzIGFyZSBkYW5nZXJvdXNcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ2RlbGV0ZScsIGJhdGNoOiAndHJ1ZScsIGJ1bGs6ICd0cnVlJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UsIGFyZ3MgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgb3B0aW9ucyBdID0gYXJncyBhcyBbIHsgZmlsdGVycz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+OyBiYXRjaFNpemU/OiBudW1iZXI7IG1heEl0ZW1zPzogbnVtYmVyIH0gfCB1bmRlZmluZWQgXTtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXhJdGVtcyA9IG9wdGlvbnM/Lm1heEl0ZW1zO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhdGNoU2l6ZSA9IHR5cGVvZiBvcHRpb25zPy5iYXRjaFNpemUgPT09ICdudW1iZXInID8gb3B0aW9ucy5iYXRjaFNpemUgOiAyNTtcbiAgICAgICAgICAgICAgICByZXR1cm4gKHtcbiAgICAgICAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgICAgICAgICAgICAgaGFzRmlsdGVyczogKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gISFvcHRpb25zPy5maWx0ZXJzICYmIE9iamVjdC5rZXlzKG9wdGlvbnMuZmlsdGVycykubGVuZ3RoID4gMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pKCksXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJhdGNoU2l6ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLih0eXBlb2YgbWF4SXRlbXMgPT09ICdudW1iZXInID8geyBtYXhJdGVtcyB9IDoge30pLFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZmluaXNoOiAoeyByZXN1bHQgfSkgPT4gKHtcbiAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudDogKHJlc3VsdCBhcyB7IGRlbGV0ZWRDb3VudD86IG51bWJlciB9IHwgdW5kZWZpbmVkKT8uZGVsZXRlZENvdW50IHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIGZhaWxlZENvdW50OiAocmVzdWx0IGFzIHsgZmFpbGVkQ291bnQ/OiBudW1iZXIgfSB8IHVuZGVmaW5lZCk/LmZhaWxlZENvdW50IHx8IDAsXG4gICAgICAgICAgICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkOiAocmVzdWx0IGFzIHsgdG90YWxQcm9jZXNzZWQ/OiBudW1iZXIgfSB8IHVuZGVmaW5lZCk/LnRvdGFsUHJvY2Vzc2VkIHx8IDAsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGRlbGV0ZUJ5UXVlcnkob3B0aW9uczoge1xuICAgICAgICBmaWx0ZXJzOiBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPixcbiAgICAgICAgYmF0Y2hTaXplPzogbnVtYmVyLFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyLFxuICAgICAgICBtYXhJdGVtcz86IG51bWJlclxuICAgIH0sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHsgZmlsdGVycywgYmF0Y2hTaXplID0gMjUsIGNvbmN1cnJlbnQgPSAxLCBtYXhJdGVtcyB9ID0gb3B0aW9ucztcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ2FsbGVkIH4gZGVsZXRlQnlRdWVyeSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgYmF0Y2hTaXplLFxuICAgICAgICAgICAgICAgIG1heEl0ZW1zXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gU2FmZXR5IGNoZWNrOiByZXF1aXJlIGZpbHRlcnMgdG8gcHJldmVudCBhY2NpZGVudGFsIGRlbGV0aW9uIG9mIGFsbCByZWNvcmRzXG4gICAgICAgICAgICBpZiAoIWZpbHRlcnMgfHwgaXNFbXB0eU9iamVjdERlZXAoZmlsdGVycykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2RlbGV0ZUJ5UXVlcnkgcmVxdWlyZXMgZmlsdGVycyB0byBwcmV2ZW50IGFjY2lkZW50YWwgZGVsZXRpb24gb2YgYWxsIHJlY29yZHMuIFVzZSBzY2FuIHdpdGggZXhwbGljaXQgY29uZmlybWF0aW9uIGlmIHlvdSBuZWVkIHRvIGRlbGV0ZSBhbGwgcmVjb3Jkcy4nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IGRlbGV0ZWRDb3VudCA9IDA7XG4gICAgICAgICAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgICAgICAgICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICAgICAgICBsZXQgdG90YWxQcm9jZXNzZWQgPSAwO1xuXG4gICAgICAgICAgICAvLyBRdWVyeSBhbmQgZGVsZXRlIGluIGJhdGNoZXNcbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgICAvLyBGZXRjaCBhIGJhdGNoIG9mIGl0ZW1zIHRvIGRlbGV0ZVxuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeSh7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50OiBiYXRjaFNpemUsXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJzb3I6IGN1cnNvciB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmRlcjogJ2FzYycsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYWdlcjogJ2N1cnNvcidcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sIGN0eCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpdGVtc1RvRGVsZXRlID0gcXVlcnlSZXN1bHQuZGF0YTtcblxuICAgICAgICAgICAgICAgIGlmICghaXRlbXNUb0RlbGV0ZSB8fCBpdGVtc1RvRGVsZXRlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRGVsZXRpbmcgYmF0Y2ggb2YgJHtpdGVtc1RvRGVsZXRlLmxlbmd0aH0gaXRlbXNgKTtcblxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZnJvbSB0aGUgZmV0Y2hlZCBpdGVtc1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzID0gaXRlbXNUb0RlbGV0ZS5tYXAoaXRlbSA9PlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpdGVtIGFzIGFueSlcbiAgICAgICAgICAgICAgICApIGFzIEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+O1xuXG4gICAgICAgICAgICAgICAgLy8gQmF0Y2ggZGVsZXRlIHRoZSBpdGVtc1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZVJlc3VsdCA9IGF3YWl0IHRoaXMuYmF0Y2hEZWxldGUoe1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICAgICAgICAgIH0sIGN0eCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB1bnByb2Nlc3NlZENvdW50ID0gKGRlbGV0ZVJlc3VsdCBhcyBhbnkpPy51bnByb2Nlc3NlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgICAgICAgY29uc3QgZGF0YUNvdW50ID0gZGVsZXRlUmVzdWx0LmRhdGE/Lmxlbmd0aDtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaERlbGV0ZWRDb3VudCA9IGlkZW50aWZpZXJzLmxlbmd0aCAtIHVucHJvY2Vzc2VkQ291bnQ7XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50ICs9IGJhdGNoRGVsZXRlZENvdW50O1xuICAgICAgICAgICAgICAgIGZhaWxlZENvdW50ICs9IHVucHJvY2Vzc2VkQ291bnQ7XG4gICAgICAgICAgICAgICAgdG90YWxQcm9jZXNzZWQgKz0gaXRlbXNUb0RlbGV0ZS5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQmF0Y2ggcmVzdWx0OiAke2JhdGNoRGVsZXRlZENvdW50fSBkZWxldGVkLCAke3VucHJvY2Vzc2VkQ291bnR9IGZhaWxlZGApO1xuXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UndmUgaGl0IHRoZSBtYXggaXRlbXMgbGltaXRcbiAgICAgICAgICAgICAgICBpZiAobWF4SXRlbXMgJiYgdG90YWxQcm9jZXNzZWQgPj0gbWF4SXRlbXMpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmVhY2hlZCBtYXhJdGVtcyBsaW1pdCBvZiAke21heEl0ZW1zfSwgc3RvcHBpbmcgZGVsZXRpb25gKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIGN1cnNvciBmb3IgbmV4dCBpdGVyYXRpb25cbiAgICAgICAgICAgICAgICBjdXJzb3IgPSBxdWVyeVJlc3VsdC5jdXJzb3IgfHwgbnVsbDtcblxuICAgICAgICAgICAgfSB3aGlsZSAoY3Vyc29yKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIH4gZGVsZXRlQnlRdWVyeSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gZGVsZXRlZDogJHtkZWxldGVkQ291bnR9LCBmYWlsZWQ6ICR7ZmFpbGVkQ291bnR9YCk7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50LFxuICAgICAgICAgICAgICAgIGZhaWxlZENvdW50LFxuICAgICAgICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gZGVsZXRlIGJ5IHF1ZXJ5IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTpgLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSBieSBxdWVyeSBmb3IgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlYnVpbGRzIGFsbCBpbmRleGVzIGZvciB0aGUgZW50aXR5IGJ5IHdyaXRpbmcgdG8gdGhlIHByaW1hcnkgaW5kZXguXG4gICAgICogVGhpcyBtZXRob2QgaXMgdXNlZnVsIGZvciBtYWludGFpbmluZyBkYXRhIGludGVncml0eSBhbmQgZW5zdXJpbmcgaW5kZXhlcyBhcmUgcHJvcGVybHkgdXBkYXRlZC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIE9wdGlvbnMgZm9yIHJlYnVpbGRpbmcgdGhlIGluZGV4XG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBwcm9jZXNzIGluIGVhY2ggYmF0Y2guIERlZmF1bHRzIHRvIDEwMC5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBpbmRleCByZWJ1aWxkIGlzIGNvbXBsZXRlLlxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnd2FybicgfSwgLy8gSW5kZXggcmVidWlsZHMgYXJlIGNyaXRpY2FsIG9wZXJhdGlvbnNcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ21haW50ZW5hbmNlJywgYmF0Y2g6ICd0cnVlJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UsIGFyZ3MgfSkgPT4gKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSB9LFxuICAgICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAgICAgYmF0Y2hTaXplOiAoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgWyBvcHRpb25zIF0gPSBhcmdzIGFzIFsgeyBiYXRjaFNpemU/OiBudW1iZXIgfSB8IHVuZGVmaW5lZCBdO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBvcHRpb25zPy5iYXRjaFNpemUgPT09ICdudW1iZXInID8gb3B0aW9ucy5iYXRjaFNpemUgOiAxMDA7XG4gICAgICAgICAgICAgICAgICAgIH0pKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIGZpbmlzaDogKCkgPT4gKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGNvbXBsZXRlZDogdHJ1ZSB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgcmVidWlsZEluZGV4KG9wdGlvbnM6IHsgYmF0Y2hTaXplPzogbnVtYmVyIH0gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBiYXRjaFNpemUgPSAxMDAgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gdGhpcy5nZXRFbnRpdHlOYW1lKCk7XG4gICAgICAgICAgICBjb25zdCByZXBvc2l0b3J5ID0gdGhpcy5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFN0YXJ0aW5nIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuXG4gICAgICAgICAgICAvLyBHZXQgYWxsIHJlY29yZHMgZnJvbSB0aGUgcHJpbWFyeSBpbmRleFxuICAgICAgICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IGF3YWl0IHJlcG9zaXRvcnkuc2Nhbi5nbygpO1xuXG4gICAgICAgICAgICBpZiAoIWFsbFJlY29yZHMuZGF0YSB8fCBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gcmVjb3JkcyBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCAke2FsbFJlY29yZHMuZGF0YS5sZW5ndGh9IHJlY29yZHMgdG8gcHJvY2VzcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaGVzXG4gICAgICAgICAgICBjb25zdCB0b3RhbFJlY29yZHMgPSBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3QgdG90YWxCYXRjaGVzID0gTWF0aC5jZWlsKHRvdGFsUmVjb3JkcyAvIGJhdGNoU2l6ZSk7XG5cbiAgICAgICAgICAgIGZvciAobGV0IGJhdGNoSW5kZXggPSAwOyBiYXRjaEluZGV4IDwgdG90YWxCYXRjaGVzOyBiYXRjaEluZGV4KyspIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IGJhdGNoSW5kZXggKiBiYXRjaFNpemU7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyBiYXRjaFNpemUsIHRvdGFsUmVjb3Jkcyk7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2ggPSBhbGxSZWNvcmRzLmRhdGEuc2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGJhdGNoICR7YmF0Y2hJbmRleCArIDF9LyR7dG90YWxCYXRjaGVzfSAoJHtzdGFydCArIDF9LSR7ZW5kfSBvZiAke3RvdGFsUmVjb3Jkc30gcmVjb3JkcylgKTtcblxuICAgICAgICAgICAgICAgIC8vIFJlYnVpbGQgYWxsIGluZGV4ZXMgYnkgdXBzZXJ0aW5nIGVhY2ggcmVjb3JkIHRvIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSB1cHNlcnQgdG8gZW5zdXJlIHRoZSByZWNvcmQgaXMgcHJvcGVybHkgaW5kZXhlZFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVwb3NpdG9yeS51cHNlcnQocmVjb3JkKS5nbygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVjb3JkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbmZlcnMgcmVsYXRpb25zaGlwcyBiZXR3ZWVuIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBzY2hlbWEgYW5kIHNlbGVjdGlvbi1wYXRocy5cbiAgICAgKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBwYXRocyBUaGUgcGFyc2VkIHNlbGVjdGlvbiBwYXRocyBmcm9tIGUuZy4gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocygpLlxuICAgICAqIEBwYXJhbSBwYXRoS2V5IFRoZSBjdXJyZW50IFwicGF0aFwiIHN0cmluZyByZXByZXNlbnRpbmcgaG93IHdlIGFycml2ZWQgaGVyZSAoZGVmYXVsdHMgdG8gdGhlIGVudGl0eSBuYW1lKS5cbiAgICAgKiBAcGFyYW0gdmlzaXRlZFBhdGhzIEEgc2V0IG9mIHBhdGgtc3RyaW5ncyB2aXNpdGVkIHNvIGZhciBpbiB0aGlzIHJlY3Vyc2lvbiBjaGFpbiAocHJldmVudHMgY3ljbGVzKS5cbiAgICAgKiBAcGFyYW0gbWF4RGVwdGggTWF4aW11bSByZWN1cnNpb24gZGVwdGggKG9wdGlvbmFsKS5cbiAgICAgKi9cbiAgICBpbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgICAgICBzY2hlbWE6IEUsXG4gICAgICAgIHBhdGhzOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyxcbiAgICAgICAgcGF0aEtleTogc3RyaW5nID0gc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgdmlzaXRlZFBhdGhzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQ8c3RyaW5nPigpLFxuICAgICAgICBtYXhEZXB0aCA9IDVcbiAgICApOiBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPiB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ2luZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMnLCB7IHBhdGhLZXksIHBhdGhzIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGV4Y2VlZCBtYXggZGVwdGgsIHdlIHNraXAgZXhwYW5zaW9uc1xuICAgICAgICBpZiAobWF4RGVwdGggPD0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTWF4IHJlY3Vyc2lvbiBkZXB0aCByZWFjaGVkIGF0IHBhdGhLZXk9XCIke3BhdGhLZXl9XCJgKTtcbiAgICAgICAgICAgIHJldHVybiB7fSBhcyBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZmVycmVkOiBhbnkgPSB7fTtcblxuICAgICAgICAvLyBMb29wIG92ZXIgZWFjaCBhdHRyaWJ1dGUgaW4gdGhlIGVudGl0eSBzY2hlbWFcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpLmZvckVhY2goKFsgYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlTWV0YSBdKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhdHRWYWwgPSBwYXRoc1sgYXR0cmlidXRlTmFtZSBdO1xuICAgICAgICAgICAgaWYgKCFhdHRWYWwpIHtcbiAgICAgICAgICAgICAgICAvLyBOb3Qgc2VsZWN0ZWQgaW4gdGhlIHVzZXIncyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpc1JlbGF0aW9uYWwgPSAhIWF0dHJpYnV0ZU1ldGEucmVsYXRpb247XG5cbiAgICAgICAgICAgIC8vIElmIHRoZSBhdHRyaWJ1dGUgaXMgbm90IHJlbGF0aW9uYWwgb3IgdGhlIHZhbHVlIGlzIGEgYm9vbGVhbiwgd2UgY2FuIGluZmVyIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGlmICghaXNSZWxhdGlvbmFsIHx8IGlzQm9vbGVhbihhdHRWYWwpKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dFZhbDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEl0J3MgYSByZWxhdGlvbmFsIGF0dHJpYnV0ZTsgcHJlcGFyZSB0byByZWN1cnNlXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbk1ldGEgPSBhdHRyaWJ1dGVNZXRhLnJlbGF0aW9uITtcbiAgICAgICAgICAgIGNvbnN0IG5leHRFbnRpdHlOYW1lID0gcmVsYXRpb25NZXRhLmVudGl0eU5hbWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgbmV3IFwicGF0aFwiIHN0cmluZyB0byBkZXRlY3QgY3ljbGVzIChlLmcuIFwiVXNlci5ncm91cHMuR3JvdXAubWVtYmVycy5Vc2VyXCIpXG4gICAgICAgICAgICBjb25zdCBuZXdQYXRoID0gYCR7cGF0aEtleX0uJHthdHRyaWJ1dGVOYW1lfS4ke25leHRFbnRpdHlOYW1lfWA7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGFscmVhZHkgdmlzaXRlZCB0aGlzIHBhdGgsIGlmIHNvID0+IHNraXAgZXhwYW5zaW9ucyBmb3IgdGhpcyBhdHRyaWJ1dGUgb25seVxuICAgICAgICAgICAgaWYgKHZpc2l0ZWRQYXRocy5oYXMobmV3UGF0aCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTa2lwcGluZyBjeWMgcmVsYXRpb24gZXhwYW5zaW9ucyBmb3I6ICR7bmV3UGF0aH1gKTtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2tpcHBlZER1ZVRvQ3ljbGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIE1hcmsgdGhpcyBwYXRoIGFzIHZpc2l0ZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5hZGQobmV3UGF0aCk7XG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gdGhlIHJlbGF0ZWQgZW50aXR5J3Mgc2NoZW1hXG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihuZXh0RW50aXR5TmFtZSk7XG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgdGhlIFwibWV0YVwiIG9iamVjdCB0aGF0IHdlIHN0b3JlXG4gICAgICAgICAgICBjb25zdCBtZXRhOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24gPSB7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcmVsYXRpb25UeXBlOiByZWxhdGlvbk1ldGEudHlwZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaXNGdW5jdGlvbihyZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgICAgID8gcmVsYXRpb25NZXRhLmlkZW50aWZpZXJzKClcbiAgICAgICAgICAgICAgICAgICAgOiByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlczoge30sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgcGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBpc09iamVjdChhdHRWYWwpID8gYXR0VmFsLmF0dHJpYnV0ZXMgOiB1bmRlZmluZWQ7IC8vIHByb3ZpZGVkIGJ5IHRoZSB1c2VyIFxuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRpb25NZXRhLmF0dHJpYnV0ZXM7IC8vIGRlZmluZWQgaW4gdGhlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcyA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTsgLy8gYXV0byBnZW4gYnkgZnJhbWV3b3JrXG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gZXhwYW5kIGNoaWxkJ3MgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgbWV0YS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgKHBhdGhTZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0aW9uU2VsZWN0aW9uQXR0cmlidXRlcyB8fCByZWxhdGVkRW50aXR5RGVmYXVsdFNlbGVjdGlvbkF0dHJpYnV0ZXMpIGFzIGFueSxcbiAgICAgICAgICAgICAgICBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICB2aXNpdGVkUGF0aHMsXG4gICAgICAgICAgICAgICAgbWF4RGVwdGggLSAxXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gbWV0YTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHRoaXMgcGF0aCBzbyBzaWJsaW5ncyBjYW4gYWxzbyBleHBhbmQgaXQgaWYgbmVlZGVkXG4gICAgICAgICAgICB2aXNpdGVkUGF0aHMuZGVsZXRlKG5ld1BhdGgpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gaW5mZXJyZWQ7XG4gICAgfVxuXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3JlYWQnLCBzZWFyY2g6ICd0cnVlJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UsIGFyZ3MgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgcXVlcnkgXSA9IGFyZ3MgYXMgWyB7IHE/OiB1bmtub3duOyBmaWx0ZXI/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9IHwgdW5kZWZpbmVkIF07XG4gICAgICAgICAgICAgICAgY29uc3QgaGFzUXVlcnkgPSAhIXF1ZXJ5Py5xO1xuICAgICAgICAgICAgICAgIGNvbnN0IGhhc0ZpbHRlcnMgPSAhIXF1ZXJ5Py5maWx0ZXIgJiYgT2JqZWN0LmtleXMocXVlcnkuZmlsdGVyKS5sZW5ndGggPiAwO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc1F1ZXJ5LFxuICAgICAgICAgICAgICAgICAgICAgICAgaGFzRmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZmluaXNoOiAoeyByZXN1bHQgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHIgPSByZXN1bHQgYXMgeyBoaXRzPzogdW5rbm93bltdOyBlc3RpbWF0ZWRUb3RhbEhpdHM/OiBudW1iZXIgfSB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICBjb25zdCBoaXRDb3VudCA9IEFycmF5LmlzQXJyYXkocj8uaGl0cykgPyByIS5oaXRzLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAgICAgY29uc3QgdG90YWxIaXRzID0gdHlwZW9mIHI/LmVzdGltYXRlZFRvdGFsSGl0cyA9PT0gJ251bWJlcicgPyByLmVzdGltYXRlZFRvdGFsSGl0cyA6IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgbWV0cmljczogeyBoaXRDb3VudCwgdG90YWxIaXRzIH0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIHNlYXJjaChxdWVyeTogRW50aXR5U2VhcmNoUXVlcnk8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXF1ZXJ5LnNlbGVjdCkge1xuICAgICAgICAgICAgLy8gKiBOb3RlOiB3ZSBleHBlY3QgYW4gYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzXG4gICAgICAgICAgICBxdWVyeS5zZWxlY3QgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpIGFzIGFueTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnNlYXJjaChxdWVyeSwgdW5kZWZpbmVkLCBjdHgpO1xuXG4gICAgICAgIC8vIERlY29tcHJlc3MgaGl0cyBpZiBwcmVzZW50XG4gICAgICAgIGlmIChyZXN1bHQ/LmhpdHMgJiYgQXJyYXkuaXNBcnJheShyZXN1bHQuaGl0cykpIHtcbiAgICAgICAgICAgIHJlc3VsdC5oaXRzID0gcmVzdWx0LmhpdHMubWFwKGhpdCA9PiB0aGlzLmRlY29tcHJlc3NGaWVsZHMoaGl0KSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbXByZXNzIGZpZWxkcyBtYXJrZWQgd2l0aCBgY29tcHJlc3NlZDogdHJ1ZWAgaW4gc2NoZW1hLlxuICAgICAqIENhbGxlZCBhdXRvbWF0aWNhbGx5IGJlZm9yZSB3cml0aW5nIHRvIERCLlxuICAgICAqL1xuICAgIHByb3RlY3RlZCBjb21wcmVzc0ZpZWxkczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oZGF0YTogVCk6IFQge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKS5hdHRyaWJ1dGVzO1xuICAgICAgICBjb25zdCByZXN1bHQgPSB7IC4uLmRhdGEgfSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBmaWVsZE5hbWUsIGF0dHJpYnV0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBpZiAoIWF0dHJpYnV0ZS5jb21wcmVzc2VkIHx8ICEoZmllbGROYW1lIGluIHJlc3VsdCkpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICBjb25zdCB0aHJlc2hvbGQgPSB0eXBlb2YgYXR0cmlidXRlLmNvbXByZXNzZWQgPT09ICdvYmplY3QnXG4gICAgICAgICAgICAgICAgPyBhdHRyaWJ1dGUuY29tcHJlc3NlZC50aHJlc2hvbGRcbiAgICAgICAgICAgICAgICA6IDEwICogMTAyNDsgLy8gRGVmYXVsdCAxMEtCXG5cbiAgICAgICAgICAgIHJlc3VsdFsgZmllbGROYW1lIF0gPSBjb21wcmVzc0lmTmVlZGVkKHJlc3VsdFsgZmllbGROYW1lIF0sIHRocmVzaG9sZCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0IGFzIFQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVjb21wcmVzcyBmaWVsZHMgdGhhdCBoYXZlIGNvbXByZXNzZWQgZGF0YS5cbiAgICAgKiBDYWxsZWQgYXV0b21hdGljYWxseSBhZnRlciByZWFkaW5nIGZyb20gREIuXG4gICAgICovXG4gICAgcHJvdGVjdGVkIGRlY29tcHJlc3NGaWVsZHM8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KGRhdGE6IFQpOiBUIHtcbiAgICAgICAgcmV0dXJuIGRlY29tcHJlc3NJdGVtKGRhdGEpO1xuICAgIH1cbn1cblxuY29uc3QgZW50aXR5QXR0cmlidXRlTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlJyk7XG5cbmV4cG9ydCBmdW5jdGlvbiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGF0dElkOiBzdHJpbmcsIGF0dDogRW50aXR5QXR0cmlidXRlKTogUGFydGlhbDxFbnRpdHlBdHRyaWJ1dGU+ICYge1xuICAgIGlkOiBzdHJpbmcsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXVxufSB7XG5cbiAgICBjb25zdCB7IG5hbWUsIHZhbGlkYXRpb25zLCByZXF1aXJlZCwgcmVsYXRpb24sIGRlZmF1bHQ6IGRlZmF1bHRWYWx1ZSwgZ2V0OiBfZ2V0dGVyLCBzZXQ6IF9zZXR0ZXIsIHdhdGNoLCAuLi5yZXN0TWV0YSB9ID0gYXR0O1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSwgLi4ucmVzdFJlbGF0aW9uIH0gPSByZWxhdGlvbiB8fCB7fTtcblxuICAgIGNvbnN0IHJlbGF0aW9uTWV0YSA9IHJlbGF0ZWRFbnRpdHlOYW1lID8geyAuLi5yZXN0UmVsYXRpb24sIGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lIH0gOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCB7IGl0ZW1zLCB0eXBlLCBwcm9wZXJ0aWVzLCBhZGROZXdPcHRpb24sIGFkZE5ld09wdGlvbkNvbmZpZywgZmllbGRUeXBlOiBleHBsaWNpdEZpZWxkVHlwZSwgb3B0aW9ucywgLi4ucmVzdFJlc3RNZXRhIH0gPSByZXN0TWV0YSBhcyBhbnk7XG5cbiAgICAvLyBJbmZlciBmaWVsZFR5cGUgZnJvbSB0eXBlIGlmIG5vdCBleHBsaWNpdGx5IHByb3ZpZGVkXG4gICAgbGV0IGluZmVycmVkRmllbGRUeXBlOiBzdHJpbmcgfCB1bmRlZmluZWQgPSBleHBsaWNpdEZpZWxkVHlwZTtcbiAgICBpZiAoIWluZmVycmVkRmllbGRUeXBlICYmIHR5cGUpIHtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnYm9vbGVhbic7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ251bWJlcic7XG4gICAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheSh0eXBlKSkge1xuICAgICAgICAgICAgLy8gRW51bSB0eXBlIGxpa2UgWydhY3RpdmUnLCAnaW5hY3RpdmUnXVxuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnc2VsZWN0JztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJyAmJiBvcHRpb25zICYmIEFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgb3B0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBTdHJpbmcgd2l0aCBvcHRpb25zIGlzIGEgc2VsZWN0XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdzZWxlY3QnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdhbnknKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdqc29uJztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnbWFwJykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnbWFwJztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2xpc3QnO1xuICAgICAgICB9XG4gICAgICAgIC8vIEZvciBkYXRlIGZpZWxkcywgY2hlY2sgYXR0cmlidXRlIG5hbWUgYXMgaGludFxuICAgICAgICBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgY29uc3QgbG93ZXJBdHRJZCA9IGF0dElkLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICBpZiAobG93ZXJBdHRJZC5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyQXR0SWQgPT09ICdjcmVhdGVkYXQnIHx8IGxvd2VyQXR0SWQgPT09ICd1cGRhdGVkYXQnIHx8IGxvd2VyQXR0SWQgPT09ICdkZWxldGVkYXQnKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnZGF0ZXRpbWUnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZW50aXR5QXR0cmlidXRlTG9nZ2VyLmRlYnVnKGBpbmZlcnJlZEZpZWxkVHlwZTogJHtpbmZlcnJlZEZpZWxkVHlwZX0gZm9yIGVudGl0eSBhdHRyaWJ1dGUgXCIke2F0dElkfVwiIHdpdGggdHlwZSBcIiR7dHlwZW9mIHR5cGUgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkodHlwZSkgOiB0eXBlfVwiYCk7XG4gICAgfVxuXG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnJlc3RSZXN0TWV0YSxcbiAgICAgICAgdHlwZSxcbiAgICAgICAgaWQ6IGF0dElkLFxuICAgICAgICBuYW1lOiBuYW1lIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUoYXR0SWQpLFxuICAgICAgICByZWxhdGlvbjogcmVsYXRpb25NZXRhIGFzIGFueSxcbiAgICAgICAgZGVmYXVsdFZhbHVlLFxuICAgICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvbnMgfHwgcmVxdWlyZWQgPyBbICdyZXF1aXJlZCcgXSA6IFtdLFxuICAgICAgICBpc1Zpc2libGU6ICEoJ2lzVmlzaWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNWaXNpYmxlLFxuICAgICAgICBpc0VkaXRhYmxlOiAhKCdpc0VkaXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0VkaXRhYmxlLFxuICAgICAgICBpc0xpc3RhYmxlOiAhKCdpc0xpc3RhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0xpc3RhYmxlLFxuICAgICAgICBpc0NyZWF0YWJsZTogISgnaXNDcmVhdGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzQ3JlYXRhYmxlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6ICEoJ2lzRmlsdGVyYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNGaWx0ZXJhYmxlLFxuICAgICAgICBpc1NlYXJjaGFibGU6ICEoJ2lzU2VhcmNoYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNTZWFyY2hhYmxlLFxuICAgIH1cblxuICAgIC8vIEFkZCBpbmZlcnJlZCBvciBleHBsaWNpdCBmaWVsZFR5cGVcbiAgICBpZiAoaW5mZXJyZWRGaWVsZFR5cGUpIHtcbiAgICAgICAgZm9ybWF0dGVkLmZpZWxkVHlwZSA9IGluZmVycmVkRmllbGRUeXBlO1xuICAgIH0gZWxzZSBpZiAoIWV4cGxpY2l0RmllbGRUeXBlICYmIHR5cGUgJiYgdHlwZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgLy8gTG9nIHdhcm5pbmcgZm9yIG5vbi1zdHJpbmcgdHlwZXMgd2UgY291bGRuJ3QgaW5mZXJcbiAgICAgICAgZW50aXR5QXR0cmlidXRlTG9nZ2VyLndhcm4oYOKaoO+4jyBDb3VsZCBub3QgaW5mZXIgZmllbGRUeXBlIGZvciBhdHRyaWJ1dGUgXCIke2F0dElkfVwiIHdpdGggdHlwZSBcIiR7dHlwZW9mIHR5cGUgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkodHlwZSkgOiB0eXBlfVwiLiBDb25zaWRlciBhZGRpbmcgZXhwbGljaXQgZmllbGRUeXBlLmApO1xuICAgIH1cblxuICAgIC8vIEFkZCBvcHRpb25zIGJhY2sgaWYgdGhleSBleGlzdFxuICAgIGlmIChvcHRpb25zKSB7XG4gICAgICAgIGZvcm1hdHRlZC5vcHRpb25zID0gb3B0aW9ucztcbiAgICB9XG5cbiAgICAvLyBQYXNzIHRocm91Z2ggYm90aCBvbGQgYW5kIG5ldyBhZGROZXdPcHRpb24gZm9ybWF0c1xuICAgIGlmIChhZGROZXdPcHRpb25Db25maWcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0gYWRkTmV3T3B0aW9uQ29uZmlnO1xuICAgIH1cbiAgICBpZiAoYWRkTmV3T3B0aW9uKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbicgXSA9IGFkZE5ld09wdGlvbjtcbiAgICB9XG5cbiAgICAvL1xuICAgIC8vICoqIG1ha2Ugc3VyZSB0byBub3Qgb3ZlcnJpZGUgdGhlIGlubmVyIGZpZWxkcyBvZiBhdHRyaWJ1dGVzIGxpa2UgYGxpc3QtW2l0ZW1zXS1bbWFwXS1wcm9wZXJ0aWVzYCAqKlxuICAgIC8vXG4gICAgaWYgKHR5cGUgPT09ICdtYXAnKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBPYmplY3QuZW50cmllczxhbnk+KHByb3BlcnRpZXMpLm1hcCgoWyBrLCB2IF0pID0+IGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaywgdikpO1xuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ2xpc3QnICYmIGl0ZW1zLnR5cGUgPT09ICdtYXAnKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ2l0ZW1zJyBdID0ge1xuICAgICAgICAgICAgLi4uaXRlbXMsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiBPYmplY3QuZW50cmllczxhbnk+KGl0ZW1zLnByb3BlcnRpZXMpLm1hcCgoWyBrLCB2IF0pID0+IGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaywgdikpXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVE9ETzogYWRkIHN1cHBvcnQgZm9yIHNldCwgZW51bSwgYW5kIGN1c3RvbS10eXBlc1xuXG4gICAgcmV0dXJuIGZvcm1hdHRlZFxufVxuXG5leHBvcnQgdHlwZSBUSU9TY2hlbWFBdHRyaWJ1dGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlPjtcbmV4cG9ydCB0eXBlIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBNYXA8a2V5b2YgU1sgJ2F0dHJpYnV0ZXMnIF0sIFRJT1NjaGVtYUF0dHJpYnV0ZT47XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhY2Nlc3MgcGF0dGVybnMgc2NoZW1hIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBlbnRpdHkgc2NoZW1hLlxuICogQHBhcmFtIHNjaGVtYSBUaGUgZW50aXR5IHNjaGVtYS5cbiAqIEByZXR1cm5zIEEgbWFwIG9mIGFjY2VzcyBwYXR0ZXJucywgd2hlcmUgdGhlIGtleXMgYXJlIHRoZSBpbmRleCBuYW1lcyBhbmQgdGhlIHZhbHVlcyBhcmUgbWFwcyBvZiBhdHRyaWJ1dGUgbmFtZXMgYW5kIHRoZWlyIGNvcnJlc3BvbmRpbmcgc2NoZW1hIGF0dHJpYnV0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oc2NoZW1hOiBTKSB7XG4gICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBuZXcgTWFwPGtleW9mIFNbICdpbmRleGVzJyBdLCBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+PigpO1xuXG4gICAgZm9yIChjb25zdCBpbmRleE5hbWUgaW4gc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgY29uc3QgaW5kZXhBdHRyaWJ1dGVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+ID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgaWR4UGtBdHQgb2Ygc2NoZW1hLmluZGV4ZXNbIGluZGV4TmFtZSBdLnBrLmNvbXBvc2l0ZSkge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGlkeFBrQXR0IF07XG4gICAgICAgICAgICBpbmRleEF0dHJpYnV0ZXMuc2V0KGlkeFBrQXR0LCB7XG4gICAgICAgICAgICAgICAgLi4uZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShpZHhQa0F0dCwgeyAuLi5hdHQsIHJlcXVpcmVkOiB0cnVlIH0pXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgaWR4U2tBdHQgb2Ygc2NoZW1hLmluZGV4ZXNbIGluZGV4TmFtZSBdLnNrPy5jb21wb3NpdGUgPz8gW10pIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBpZHhTa0F0dCBdO1xuICAgICAgICAgICAgaW5kZXhBdHRyaWJ1dGVzLnNldChpZHhTa0F0dCwge1xuICAgICAgICAgICAgICAgIC4uLmVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaWR4U2tBdHQsIHsgLi4uYXR0LCByZXF1aXJlZDogdHJ1ZSB9KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBhY2Nlc3NQYXR0ZXJucy5zZXQoaW5kZXhOYW1lLCBpbmRleEF0dHJpYnV0ZXMpO1xuICAgIH1cblxuICAgIC8vIG1ha2Ugc3VyZSB0aGVyZSdzIGEgcHJpbWFyeSBhY2Nlc3MgcGF0dGVybjtcbiAgICBpZiAoIWFjY2Vzc1BhdHRlcm5zLmhhcygncHJpbWFyeScpKSB7XG4gICAgICAgIGFjY2Vzc1BhdHRlcm5zLnNldCgncHJpbWFyeScsIGFjY2Vzc1BhdHRlcm5zLnZhbHVlcygpLm5leHQoKS52YWx1ZSEpO1xuICAgIH1cblxuICAgIHJldHVybiBhY2Nlc3NQYXR0ZXJucztcbn1cbiJdfQ==