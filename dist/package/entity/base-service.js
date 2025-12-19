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
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', hydration: 'true' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            relationCount: args[0]?.length || 0,
            recordCount: args[1]?.length || 0,
        })
    })
], BaseEntityService.prototype, "hydrateRecords", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        getAttributes: (instance) => ({
            entityName: instance.getEntityName(),
        }),
        getResultAttributes: (result) => ({
            found: !!result,
        })
    })
], BaseEntityService.prototype, "get", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', batch: 'true' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            batchSize: args[0]?.identifiers?.length || 0,
            concurrent: args[0]?.concurrent || 1,
        }),
        getResultAttributes: (result) => ({
            retrievedCount: result?.data?.length || 0,
            unprocessedCount: result?.unprocessed?.length || 0,
        })
    })
], BaseEntityService.prototype, "batchGet", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        getAttributes: (instance) => ({
            entityName: instance.getEntityName(),
        })
    })
], BaseEntityService.prototype, "create", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        getAttributes: (instance) => ({
            entityName: instance.getEntityName(),
        }),
        getResultAttributes: (result) => ({
            wasCreated: !!result?.wasCreated,
        })
    })
], BaseEntityService.prototype, "upsert", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        getAttributes: (instance) => ({
            entityName: instance.getEntityName(),
        })
    })
], BaseEntityService.prototype, "duplicate", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            hasFilters: !!args[0]?.filters && Object.keys(args[0].filters).length > 0,
        }),
        getResultAttributes: (result) => ({
            resultCount: result?.data?.length || 0,
            hasCursor: !!result?.cursor,
        })
    })
], BaseEntityService.prototype, "list", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            hasFilters: !!args[0]?.filters && Object.keys(args[0].filters).length > 0,
        }),
        getResultAttributes: (result) => ({
            resultCount: result?.data?.length || 0,
        })
    })
], BaseEntityService.prototype, "query", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        getAttributes: (instance) => ({
            entityName: instance.getEntityName(),
        })
    })
], BaseEntityService.prototype, "update", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' },
        sourceType: 'service',
        tags: { operation_category: 'delete' },
        getAttributes: (instance) => ({
            entityName: instance.getEntityName(),
        })
    })
], BaseEntityService.prototype, "delete", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' }, // Batch deletes are critical
        sourceType: 'service',
        tags: { operation_category: 'delete', batch: 'true' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            batchSize: args[0]?.identifiers?.length || 0,
            concurrent: args[0]?.concurrent || 1,
        }),
        getResultAttributes: (result) => ({
            deletedCount: (result?.data?.length || 0),
            unprocessedCount: (result?.unprocessed?.length || 0),
        })
    })
], BaseEntityService.prototype, "batchDelete", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' }, // Bulk deletes are dangerous
        sourceType: 'service',
        tags: { operation_category: 'delete', batch: 'true', bulk: 'true' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            batchSize: args[0]?.batchSize || 25,
            maxItems: args[0]?.maxItems,
            hasFilters: !!(args[0]?.filters && Object.keys(args[0].filters).length > 0),
        }),
        getResultAttributes: (result) => ({
            deletedCount: result?.deletedCount || 0,
            failedCount: result?.failedCount || 0,
            totalProcessed: result?.totalProcessed || 0,
        })
    })
], BaseEntityService.prototype, "deleteByQuery", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'warn' }, // Index rebuilds are critical operations
        sourceType: 'service',
        tags: { operation_category: 'maintenance', batch: 'true' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            batchSize: args[0]?.batchSize || 100,
        }),
        getResultAttributes: () => ({
            completed: true,
        })
    })
], BaseEntityService.prototype, "rebuildIndex", null);
__decorate([
    (0, observed_1.Observed)({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', search: 'true' },
        getAttributes: (instance, args) => ({
            entityName: instance.getEntityName(),
            hasQuery: !!args[0]?.q,
            hasFilters: !!(args[0]?.filter && Object.keys(args[0].filter).length > 0),
        }),
        getResultAttributes: (result) => ({
            hitCount: result?.hits?.length || 0,
            totalHits: result?.estimatedTotalHits || 0,
        })
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBK0JBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQWtpRUQsZ0ZBaUdDO0FBVUQsd0VBNkJDO0FBcnVFRCw4QkFBb0M7QUFPcEMsd0NBQTBDO0FBQzFDLGlEQUE0RTtBQUU1RSxtRUFBZ0U7QUFDaEUseURBQW1FO0FBQ25FLG9DQUFpTjtBQUNqTiwrQ0FBc0Q7QUFDdEQsaURBQXNMO0FBQ3RMLHVFQUFrRTtBQUNsRSxxQ0FBZ0U7QUFDaEUsbUNBQTRIO0FBQzVILHNDQUE2RDtBQVk3RCxTQUFnQixZQUFZLENBQUMsTUFBbUMsRUFBRSxhQUFxQjtJQUNuRixPQUFPLENBQUMsYUFBYSxJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUNoRCxDQUFDO0FBRUQsU0FBZ0IsbUJBQW1CLENBQUMsTUFBbUMsRUFBRSxhQUFxQjtJQUMxRixNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFFLGFBQWEsQ0FBRSxDQUFDO0lBQ3JELE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUyxJQUFJLFNBQVMsQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLENBQUM7QUFDeEQsQ0FBQztBQUVELFNBQWdCLGNBQWMsQ0FBQyxNQUFtQyxFQUFFLElBQTBCO0lBQzFGLE9BQU8sa0JBQWtCLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLFNBQVMsQ0FBQztBQUMxRCxDQUFDO0FBRUQsU0FBZ0Isa0JBQWtCLENBQUMsTUFBbUMsRUFBRSxJQUEwQjtJQUU5RixJQUFJLGNBQWMsR0FBRyxTQUFTLElBQUEsa0JBQVUsRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDO0lBQzFELElBQUksY0FBYyxJQUFJLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztR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QUFHLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBTSxDQUFDLENBQUM7SUFDekUsQ0FBQztJQUVELE9BQU8sY0FBYyxDQUFDO0FBQzFCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gXCIuLi9kaVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlJbnB1dFZhbGlkYXRpb25zLCBFbnRpdHlWYWxpZGF0aW9ucyB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSwgRW50aXR5QXR0cmlidXRlLCBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hLCBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYSwgRW50aXR5VHlwZUZyb21TY2hlbWEgYXMgRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEsIEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHksIEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbiwgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHksIFJlbGF0aW9uSWRlbnRpZmllciwgU3BlY2lhbEF0dHJpYnV0ZVR5cGUsIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlGaWx0ZXJDcml0ZXJpYSwgRW50aXR5UXVlcnksIEVudGl0eVNlbGVjdGlvbnMsIFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcblxuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tIFwiLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHsgRGVwSWRlbnRpZmllciwgSURJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBCYXNlU2VhcmNoU2VydmljZSwgRW50aXR5U2VhcmNoU2VydmljZSB9IGZyb20gJy4uL3NlYXJjaC9zZXJ2aWNlcyc7XG5pbXBvcnQgeyBFbnRpdHlTZWFyY2hRdWVyeSB9IGZyb20gJy4uL3NlYXJjaC90eXBlcyc7XG5pbXBvcnQgeyBPYnNlcnZlZCB9IGZyb20gXCIuLi9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMvb2JzZXJ2ZWRcIjtcbmltcG9ydCB7IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUgfSBmcm9tICcuLi9zZWFyY2gvc2VhcmNoLXV0aWxzJztcbmltcG9ydCB7IEpzb25TZXJpYWxpemVyLCBnZXRWYWx1ZUJ5UGF0aCwgaXNBcnJheSwgaXNCb29sZWFuLCBpc0NsYXNzQ29uc3RydWN0b3IsIGlzRW1wdHksIGlzRW1wdHlPYmplY3REZWVwLCBpc0Z1bmN0aW9uLCBpc09iamVjdCwgaXNTdHJpbmcsIHBhc2NhbENhc2UsIHBpY2tLZXlzLCB0b0h1bWFuUmVhZGFibGVOYW1lLCB0b1NsdWcgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgeyBVcGRhdGVFbnRpdHlPcGVyYXRvcnMsIGNyZWF0ZUVudGl0eSwgZGVsZXRlRW50aXR5LCBkZWxldGVCYXRjaEVudGl0eSwgZ2V0QmF0Y2hFbnRpdHksIGdldEVudGl0eSwgbGlzdEVudGl0eSwgcXVlcnlFbnRpdHksIHVwZGF0ZUVudGl0eSwgdXBzZXJ0RW50aXR5IH0gZnJvbSBcIi4vY3J1ZC1zZXJ2aWNlXCI7XG5pbXBvcnQgeyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IgfSBmcm9tIFwiLi9lbnRpdHktc2NoZW1hLXZhbGlkYXRvclwiO1xuaW1wb3J0IHsgRGF0YWJhc2VFcnJvciwgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhLCBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcywgcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgeyBJbnRlcm5hbFNlcnZlckVycm9yLCBTZXJ2ZXJFcnJvciB9IGZyb20gXCIuLi9lcnJvcnNcIjtcblxuZXhwb3J0IHR5cGUgRXh0cmFjdEVudGl0eUlkZW50aWZpZXJzQ29udGV4dCA9IHtcbiAgICAvLyB0ZW5hbnRJZDogc3RyaW5nLCBcbiAgICBmb3JBY2Nlc3NQYXR0ZXJuPzogc3RyaW5nXG59XG5cbnR5cGUgR2V0T3B0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgIGF0dHJpYnV0ZXM/OiBFbnRpdHlTZWxlY3Rpb25zPFM+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGUoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiAoYXR0cmlidXRlTmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhdHRyaWJ1dGUgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0cmlidXRlTmFtZSBdO1xuICAgIHJldHVybiAhIShhdHRyaWJ1dGUgJiYgYXR0cmlidXRlLnJlYWRPbmx5ID09PSB0cnVlKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc0F0dHJpYnV0ZUJ5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBzcGVjOiBTcGVjaWFsQXR0cmlidXRlVHlwZSkge1xuICAgIHJldHVybiBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCBzcGVjKSAhPT0gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBzcGVjOiBTcGVjaWFsQXR0cmlidXRlVHlwZSkge1xuXG4gICAgbGV0IHNwZWNBdHRNZXRhS2V5ID0gYGVudGl0eSR7cGFzY2FsQ2FzZShzcGVjKX1BdHRyaWJ1dGVgO1xuICAgIGlmIChzcGVjQXR0TWV0YUtleSBpbiBzY2hlbWEubW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHNjaGVtYS5tb2RlbFsgc3BlY0F0dE1ldGFLZXkgYXMga2V5b2YgdHlwZW9mIHNjaGVtYS5tb2RlbCBdIGFzIHN0cmluZztcbiAgICB9XG5cbiAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgYCR7c2NoZW1hLm1vZGVsLmVudGl0eX0ke3Bhc2NhbENhc2Uoc3BlYyl9YCkpIHtcbiAgICAgICAgcmV0dXJuIGAke3NjaGVtYS5tb2RlbC5lbnRpdHl9JHtwYXNjYWxDYXNlKHNwZWMpfWA7XG4gICAgfVxuXG4gICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsIHNwZWMpKSB7XG4gICAgICAgIHJldHVybiBzcGVjO1xuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlRW50aXR5U2VydmljZTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiB7XG5cbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoYEJhc2VFbnRpdHlTZXJ2aWNlOiR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuXG4gICAgcHJvdGVjdGVkIGVudGl0eVJlcG9zaXRvcnk/OiBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWE8Uz47XG4gICAgcHJvdGVjdGVkIGVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYT86IFJldHVyblR5cGU8dHlwZW9mIHRoaXMubWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxTPj47XG5cbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcmVhZG9ubHkgc2NoZW1hOiBTLFxuICAgICAgICBwcm90ZWN0ZWQgcmVhZG9ubHkgZW50aXR5Q29uZmlndXJhdGlvbnM6IEVudGl0eUNvbmZpZ3VyYXRpb24sXG4gICAgICAgIHByb3RlY3RlZCByZWFkb25seSBkaUNvbnRhaW5lcjogSURJQ29udGFpbmVyID0gRElDb250YWluZXIuUk9PVCxcbiAgICApIHsgfVxuXG4gICAgcHJvdGVjdGVkIGdldFRhYmxlTmFtZSgpOiBzdHJpbmcge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnMudGFibGUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBJbnRlcm5hbFNlcnZlckVycm9yKGBUYWJsZSBuYW1lIGlzIHJlcXVpcmVkIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnMudGFibGU7XG4gICAgfVxuXG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5U2VhcmNoQ29uZmlnKF9jdHg/OiBFeGVjdXRpb25Db250ZXh0PGFueT4pIHtcblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHNjaGVtYS5tb2RlbC5zZWFyY2ggfHwge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGluZGV4Q29uZmlnOiB7fVxuICAgICAgICB9O1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5zZXJ2aWNlQ2xhc3MgPSBzZWFyY2hDb25maWcuc2VydmljZUNsYXNzIHx8IEVudGl0eVNlYXJjaFNlcnZpY2U7XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcuaW5kZXhDb25maWcpIHtcbiAgICAgICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZyA9IHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLmluZGV4TmFtZSA9IHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5pbmRleE5hbWUgfHwgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBzY2hlbWEubW9kZWwuZW50aXR5LFxuICAgICAgICAgICAgdGFibGVOYW1lOiB0aGlzLmdldFRhYmxlTmFtZSgpLFxuICAgICAgICB9KTtcblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcucHJpbWFyeUtleSA9IHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5wcmltYXJ5S2V5IHx8IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG5cbiAgICAgICAgY29uc3QgZW50aXR5U2VhcmNoYWJsZUF0dHJpYnV0ZXMgPSB0aGlzLmdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpO1xuICAgICAgICBjb25zdCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyA9IHRoaXMuZ2V0RmlsdGVyYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzID0ge1xuICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncyB8fCB7fSksXG4gICAgICAgICAgICBzZWFyY2hhYmxlQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3M/LnNlYXJjaGFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eVNlYXJjaGFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBmaWx0ZXJhYmxlQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3M/LmZpbHRlcmFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBzb3J0YWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5zb3J0YWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzZWFyY2hDb25maWc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIGlmIHNlYXJjaCBpcyBlbmFibGVkIGZvciB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRydWUgaWYgc2VhcmNoIGlzIGVuYWJsZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgaXNTZWFyY2hFbmFibGVkKCkge1xuICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldEVudGl0eVNlYXJjaENvbmZpZygpO1xuICAgICAgICByZXR1cm4gQm9vbGVhbihzZWFyY2hDb25maWc/LmVuYWJsZWQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldHMgdGhlIHNlYXJjaCBzZXJ2aWNlIGZvciB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBzZWFyY2ggc2VydmljZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0U2VhcmNoU2VydmljZSgpOiBFbnRpdHlTZWFyY2hTZXJ2aWNlPFM+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCk7XG5cbiAgICAgICAgICAgIC8vIFNraXAgc2VhcmNoIGxvZ2ljIGlmIHNlYXJjaCBpcyBub3QgZW5hYmxlZFxuICAgICAgICAgICAgaWYgKCFzZWFyY2hDb25maWc/LmVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBpcyBub3QgZW5hYmxlZCBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9LmApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBzZWFyY2ggY29uZmlndXJhdGlvbiBpZiBwcmVzZW50XG4gICAgICAgICAgICBpZiAoc2VhcmNoQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgdGhpcy52YWxpZGF0ZVNlYXJjaENvbmZpZyhzZWFyY2hDb25maWcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzID0gc2VhcmNoQ29uZmlnPy5zZXJ2aWNlQ2xhc3M7XG5cbiAgICAgICAgICAgIC8vIENhc2UgMTogREkgQ29udGFpbmVyIGhhcyB0aGUgc2VydmljZVxuICAgICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgJiYgdGhpcy5kaUNvbnRhaW5lci5oYXMoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyBEZXBJZGVudGlmaWVyPEVudGl0eVNlYXJjaFNlcnZpY2U8YW55Pj4pKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZTxFbnRpdHlTZWFyY2hTZXJ2aWNlPFM+PihzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGFzIERlcElkZW50aWZpZXI8RW50aXR5U2VhcmNoU2VydmljZTxTPj4pO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcmVzb2x2ZSBzZWFyY2ggc2VydmljZSBmcm9tIGNvbnRhaW5lcjonLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZXNvbHZlIHNlYXJjaCBzZXJ2aWNlIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYXNlIDI6IFNlcnZpY2UgaW5zdGFuY2UgcHJvdmlkZWRcbiAgICAgICAgICAgIGlmIChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGluc3RhbmNlb2YgQmFzZVNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2FzZSAzOiBTZXJ2aWNlIGNsYXNzIHByb3ZpZGVkXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgaXNDbGFzc0NvbnN0cnVjdG9yKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MpICYmXG4gICAgICAgICAgICAgICAgKFxuICAgICAgICAgICAgICAgICAgICBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzID09PSBFbnRpdHlTZWFyY2hTZXJ2aWNlXG4gICAgICAgICAgICAgICAgICAgIHx8XG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgRW50aXR5U2VhcmNoU2VydmljZVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IHRvIGNvbmZpZ3VyZSB0aGlzIHdpdGhvdXQgbmVlZGluZyB0byB1c2UgdGhlIERJXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEVuZ2luZSA9IHRoaXMuZGlDb250YWluZXIucmVzb2x2ZVNlYXJjaEVuZ2luZSgpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXNlYXJjaEVuZ2luZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggZW5naW5lIG5vdCBmb3VuZCBpbiBjb250YWluZXInKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGFzIHR5cGVvZiBFbnRpdHlTZWFyY2hTZXJ2aWNlKShcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZWFyY2hFbmdpbmUsXG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBpbnN0YW50aWF0ZSBzZWFyY2ggc2VydmljZTonLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgc2VhcmNoIHNlcnZpY2UgaW5zdGFuY2UgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdmFsaWQgc2VhcmNoLXNlcnZpY2UtY29uZmlndXJhdGlvbiBmb3VuZCBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Vycm9yIGluIGdldFNlYXJjaFNlcnZpY2U6JywgZXJyKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2UgaW5pdGlhbGl6YXRpb24gZmFpbGVkIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHZhbGlkYXRlU2VhcmNoQ29uZmlnKHNlYXJjaENvbmZpZzogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnbW9kZWwnIF1bICdzZWFyY2gnIF0pIHtcblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcuaW5kZXhDb25maWcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gbXVzdCBpbmNsdWRlIGEgY29uZmlnIG9iamVjdCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBpbmRleENvbmZpZzogY29uZmlnIH0gPSBzZWFyY2hDb25maWc7XG5cbiAgICAgICAgaWYgKCFjb25maWcuaW5kZXhOYW1lKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIG11c3Qgc3BlY2lmeSBhbiBpbmRleE5hbWUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbGlkYXRlIHNlYXJjaGFibGUgYXR0cmlidXRlcyBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbmZpZy5zZXR0aW5ncz8uc2VhcmNoYWJsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gY29uZmlnLnNldHRpbmdzLnNlYXJjaGFibGVBdHRyaWJ1dGVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICAoYXR0cjogc3RyaW5nKSA9PiAhaGFzQXR0cmlidXRlKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIGF0dHIpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VhcmNoYWJsZSBhdHRyaWJ1dGVzOiAke2ludmFsaWRBdHRyaWJ1dGVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBmaWx0ZXJhYmxlIGF0dHJpYnV0ZXMgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb25maWcuc2V0dGluZ3M/LmZpbHRlcmFibGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IGNvbmZpZy5zZXR0aW5ncy5maWx0ZXJhYmxlQXR0cmlidXRlcy5maWx0ZXIoXG4gICAgICAgICAgICAgICAgKGF0dHI6IHN0cmluZykgPT4gIWhhc0F0dHJpYnV0ZSh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBhdHRyKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZpbHRlcmFibGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5OiBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxTPik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGNvbnN0IHRyYW5zZm9ybWVkID0gYXdhaXQgc2VhcmNoU2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG5cbiAgICAgICAgaWYgKCF0cmFuc2Zvcm1lZFsgJ2lkJyBdKSB7XG4gICAgICAgICAgICAvLyBtYWtlIHN1cmUgdGhlcmUncyBhbiBpZCBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGNvbnN0IHByaW1hcnlJZE5hbWUgPSB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuICAgICAgICAgICAgdHJhbnNmb3JtZWRbICdpZCcgXSA9IGVudGl0eVsgcHJpbWFyeUlkTmFtZSBhcyBhbnkgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm1lZDtcbiAgICB9XG5cbiAgICBwdWJsaWMgdmFsaWRhdGVFbnRpdHlTY2hlbWEoKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IodGhpcy5kaUNvbnRhaW5lcik7XG4gICAgICAgIHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShcbiAgICAgICAgICAgIHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksXG4gICAgICAgICAgICB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTZXJ2aWNlPEJhc2VFbnRpdHlTZXJ2aWNlPFQ+PihyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLmhhc0VudGl0eVNlcnZpY2UocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIGdldEVudGl0eVNjaGVtYUJ5RW50aXR5TmFtZTxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTY2hlbWE8VD4ocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNjaGVtYUJ5RW50aXR5TmFtZShyZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLmhhc0VudGl0eVNjaGVtYShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0cmFjdHMgZW50aXR5IGlkZW50aWZpZXJzIGZyb20gdGhlIGlucHV0IG9iamVjdCBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgY29udGV4dCB0byBmdWxmaWxsIGFuIGluZGV4LlxuICAgICAqIGUuZy4gZW50aXR5SWQsIHRlbmFudElkLCBwYXJ0aXRpb24ta2V5cy4uLi4gZXRjXG4gICAgICogaXQgaXMgdXNlZCBieSB0aGUgYEJhc2VFbnRpdHlTZXJ2aWNlYCB0byBmaW5kIHRoZSByaWdodCBlbnRpdHkgZm9yIGBnZXRgL2B1cGRhdGVgL2BkZWxldGVgIG9wZXJhdGlvbnNcbiAgICAgKiBcbiAgICAgKiBAdGVtcGxhdGUgUyAtIFRoZSB0eXBlIG9mIHRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBpbnB1dCAtIFRoZSBpbnB1dCBvYmplY3QgZnJvbSB3aGljaCB0byBleHRyYWN0IHRoZSBpZGVudGlmaWVycy5cbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBjb250YWluaW5nIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24gZm9yIGV4dHJhY3Rpb24uXG4gICAgICogQHBhcmFtIGNvbnRleHQuZm9yQWNjZXNzUGF0dGVybiAtIFRoZSBhY2Nlc3MgcGF0dGVybiBmb3Igd2hpY2ggdG8gZXh0cmFjdCB0aGUgaWRlbnRpZmllcnMuXG4gICAgICogQHJldHVybnMgVGhlIGV4dHJhY3RlZCBlbnRpdHkgaWRlbnRpZmllcnMuXG4gICAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBpbnB1dCBpcyBtaXNzaW5nIG9yIG5vdCBhbiBvYmplY3QuXG4gICAgICogXG4gICAgICogZS5nLiBcbiAgICAgKiBJTiAgID09PiBgUmVxdWVzdGAgb2JqZWN0IHdpdGggaGVhZGVycywgYm9keSwgYXV0aC1jb250ZXh0IGV0Y1xuICAgICAqIE9VVCAgPT0+IHsgdGVuYW50SWQ6IHh4eCwgZW1haWw6IHh4eEB5eXkuY29tLCBzb21lLXBhcnRpdGlvbi1rZXk6IHh4LXl5LXp6IH1cbiAgICAgKlxuICAgICAqL1xuICAgIGV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhcbiAgICAgICAgaW5wdXQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+PixcbiAgICAgICAgY29udGV4dDogRXh0cmFjdEVudGl0eUlkZW50aWZpZXJzQ29udGV4dCA9IHtcbiAgICAgICAgICAgIC8vIHRlbmFudElkOiAneHh4LXl5eS16enonXG4gICAgICAgIH1cbiAgICApOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4ge1xuXG4gICAgICAgIGlmICghaW5wdXQgfHwgdHlwZW9mIGlucHV0ICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnB1dCBpcyByZXF1aXJlZCBhbmQgbXVzdCBiZSBhbiBvYmplY3QgY29udGFpbmluZyBlbnRpdHktaWRlbnRpZmllcnMgb3IgYW4gYXJyYXkgb2Ygb2JqZWN0cyBjb250YWluaW5nIGVudGl0eS1pZGVudGlmaWVycycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaXNCYXRjaElucHV0ID0gaXNBcnJheShpbnB1dCk7XG5cbiAgICAgICAgY29uc3QgaW5wdXRzID0gaXNCYXRjaElucHV0ID8gaW5wdXQgOiBbIGlucHV0IF07XG5cbiAgICAgICAgLy8gVE9ETzogdGVuYW50IGxvZ2ljXG4gICAgICAgIC8vIGlkZW50aWZpZXJzWyd0ZW5hbnRJZCddID0gaW5wdXQudGVuYW50SWQgfHwgY29udGV4dC50ZW5hbnRJZDtcblxuICAgICAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYSh0aGlzLmdldEVudGl0eVNjaGVtYSgpKTtcblxuICAgICAgICBjb25zdCBpZGVudGlmaWVyQXR0cmlidXRlcyA9IG5ldyBTZXQ8eyBuYW1lOiBzdHJpbmcsIHJlcXVpcmVkOiBib29sZWFuIH0+KCk7XG4gICAgICAgIGZvciAoY29uc3QgWyBhY2Nlc3NQYXR0ZXJuTmFtZSwgYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXMgXSBvZiBhY2Nlc3NQYXR0ZXJucykge1xuICAgICAgICAgICAgaWYgKCFjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4gfHwgYWNjZXNzUGF0dGVybk5hbWUgPT0gY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuKSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBbICwgYXR0IF0gb2YgYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllckF0dHJpYnV0ZXMuYWRkKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGF0dC5pZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBhdHQucmVxdWlyZWQgPT0gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwcmltYXJ5QXR0TmFtZSA9IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG5cbiAgICAgICAgY29uc3QgaWRlbnRpZmllcnNCYXRjaCA9IGlucHV0cy5tYXAoaW5wdXQgPT4ge1xuICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IGFueSA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWU6IGF0dE5hbWUsIHJlcXVpcmVkIH0gb2YgaWRlbnRpZmllckF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoKGF0dE5hbWUgaW4gaW5wdXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzWyBhdHROYW1lIF0gPSBpbnB1dFsgYXR0TmFtZSBdO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYXR0TmFtZSA9PSBwcmltYXJ5QXR0TmFtZSAmJiAoJ2lkJyBpbiBpbnB1dCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnNbIGF0dE5hbWUgXSA9IGlucHV0LmlkO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocmVxdWlyZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgcmVxdWlyZWQgYXR0cmlidXRlOiAke2F0dE5hbWV9IGZvciBhY2Nlc3MtcGF0dGVybjogJHtjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4gPz8gJy0tcHJpbWFyeS0tJ30gaXMgbm90IGZvdW5kIGluIGlucHV0OmAsIGlucHV0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaWRlbnRpZmllcnMgYXMgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICAgICAgfVxuICAgICAgICApO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdFeHRyYWN0aW5nIGlkZW50aWZpZXJzIGZyb20gaWRlbnRpZmllcnM6JywgaWRlbnRpZmllcnNCYXRjaCk7XG5cbiAgICAgICAgcmV0dXJuIGlzQmF0Y2hJbnB1dCA/IGlkZW50aWZpZXJzQmF0Y2ggOiBpZGVudGlmaWVyc0JhdGNoWyAwIF07XG4gICAgfTtcblxuICAgIHB1YmxpYyBnZXRFbnRpdHlOYW1lKCk6IFNbICdtb2RlbCcgXVsgJ2VudGl0eScgXSB7IHJldHVybiB0aGlzLmdldEVudGl0eVNjaGVtYSgpLm1vZGVsLmVudGl0eTsgfVxuXG4gICAgcHVibGljIGdldEVudGl0eVNjaGVtYSgpOiBTIHsgcmV0dXJuIHRoaXMuc2NoZW1hOyB9XG5cbiAgICBwdWJsaWMgZ2V0UmVwb3NpdG9yeSgpIHtcbiAgICAgICAgaWYgKCF0aGlzLmVudGl0eVJlcG9zaXRvcnkpIHtcbiAgICAgICAgICAgIGNvbnN0IHsgZW50aXR5IH0gPSBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgICAgICAgICAgICAgIHNjaGVtYTogdGhpcy5nZXRFbnRpdHlTY2hlbWEoKSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWd1cmF0aW9uczogdGhpcy5lbnRpdHlDb25maWd1cmF0aW9uc1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLmVudGl0eVJlcG9zaXRvcnkgPSBlbnRpdHkgYXMgRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZW50aXR5UmVwb3NpdG9yeSE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGxhY2Vob2xkZXIgZm9yIHRoZSBlbnRpdHkgdmFsaWRhdGlvbnM7IG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSB5b3VyIG93biB2YWxpZGF0aW9uc1xuICAgICAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBlbnRpdHkgdmFsaWRhdGlvbnMuXG4gICAgICovXG4gICAgcHVibGljIGdldEVudGl0eVZhbGlkYXRpb25zKCk6IEVudGl0eVZhbGlkYXRpb25zPFM+IHwgRW50aXR5SW5wdXRWYWxpZGF0aW9uczxTPiB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogUGxhY2Vob2xkZXIgZm9yIHRoZSBjdXN0b20gdmFsaWRhdGlvbi1lcnJvci1tZXNzYWdlczsgb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIHlvdXIgb3duIGVycm9yLW1lc3NhZ2VzLlxuICAgICAqIEByZXR1cm5zIEEgbWFwIGNvbnRhaW5pbmcgdGhlIGN1c3RvbSB2YWxpZGF0aW9uLWVycm9yLW1lc3NhZ2VzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHNcbiAgICAgKiAgcHVibGljIGFzeW5jIGdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICAgKiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoIG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCBcbiAgICAgKiAgICAgICAgICBPYmplY3QuZW50cmllcyh7IFxuICAgICAqICAgICAgICAgICAgICAndmFsaWRhdGlvbi5lbWFpbC5yZXF1aXJlZCc6ICdFbWFpbCBpcyByZXF1aXJlZCEhISEhJywgXG4gICAgICogICAgICAgICAgICAgICd2YWxpZGF0aW9uLnBhc3N3b3JkLnJlcXVpcmVkJzogJ1Bhc3N3b3JkIGlzIHJlcXVpcmVkISEhISEnXG4gICAgICogICAgICAgICAgfSlcbiAgICAgKiAgICAgICkpO1xuICAgICAqIH1cbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICAgIH1cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKSB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgaWYgKGF0dC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYXR0TmFtZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gKiBHZW5lcmF0ZXMgdGhlIGRlZmF1bHQgaW5wdXQgYW5kIG91dHB1dCBzY2hlbWFzIGZvciB2YXJpb3VzIG9wZXJhdGlvbnMgb2YgYW4gZW50aXR5LlxuICogXG4gKiBAdGVtcGxhdGUgUyAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAdGVtcGxhdGUgT3BzIC0gVGhlIHR5cGUgb2YgZW50aXR5IG9wZXJhdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBzY2hlbWEgLSBUaGUgZW50aXR5IHNjaGVtYS5cbiAqIEByZXR1cm5zIFRoZSBkZWZhdWx0IGlucHV0IGFuZCBvdXRwdXQgc2NoZW1hcyBmb3IgdGhlIGVudGl0eSBvcGVyYXRpb25zLlxuICovXG4gICAgcHJvdGVjdGVkIG1ha2VPcHNEZWZhdWx0SU9TY2hlbWE8XG4gICAgICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueSwgT3BzPixcbiAgICAgICAgT3BzIGV4dGVuZHMgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zID0gVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgID4oc2NoZW1hOiBTKSB7XG5cbiAgICAgICAgY29uc3QgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzID0ge1xuICAgICAgICAgICAgY3JlYXRlOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgICAgIHVwZGF0ZTogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0U2NoZW1hQXR0cmlidXRlcyA9IHtcbiAgICAgICAgICAgIGRldGFpbDogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgICAgICBsaXN0OiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBjcmVhdGUgYW5kIHVwZGF0ZVxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcblxuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZEF0dCA9IGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoYXR0TmFtZSwgYXR0KTtcblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5oaWRkZW4pIHtcbiAgICAgICAgICAgICAgICAvLyBpZiBpdCdzIG1hcmtlZCBhcyBoaWRkZW4gaXQncyBub3QgdmlzaWJsZSB0byBhbnkgb3BcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc1Zpc2libGUgfHwgZm9ybWF0dGVkQXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc0xpc3RhYmxlIHx8IGZvcm1hdHRlZEF0dC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3Quc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzQ3JlYXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNFZGl0YWJsZSkge1xuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWEoc2NoZW1hKTtcblxuICAgICAgICAvLyBpZiB0aGVyZSdzIGFuIGluZGV4IG5hbWVkIGBwcmltYXJ5YCwgdXNlIHRoYXQsIGVsc2UgZmFsbGJhY2sgdG8gZmlyc3QgaW5kZXhcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2RlbGV0ZSddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcblxuXG4gICAgICAgIC8vIGZvcihjb25zdCBhcCBvZiBhY2Nlc3NQYXR0ZXJucy5rZXlzKCkpe1xuICAgICAgICAvLyBcdGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzW2BnZXRfJHthcH1gXSA9IGFjY2Vzc1BhdHRlcm5zLmdldChhcCk7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGRlbGV0ZV8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIC8vIGNvbnN0IGlucHV0U2NoZW1hQXR0cmlidXRlczogYW55ID0ge307XHRcbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWydjcmVhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddLFxuICAgICAgICAvLyB9XG4gICAgICAgIC8vIGlucHV0U2NoZW1hQXR0cmlidXRlc1sndXBkYXRlJ10gPSB7XG4gICAgICAgIC8vIFx0J2lkZW50aWZpZXJzJzogYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddLFxuICAgICAgICAvLyBcdCdkYXRhJzogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSxcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5Jyk7XG5cbiAgICAgICAgLy8gVE9ETzogYWRkIHNjaGVtYSBmb3IgdGhlIHJlc3QgZm8gdGhlIHNlY29uZGFyeSBhY2Nlc3MtcGF0dGVybnNcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZ2V0OiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGR1cGxpY2F0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVybixcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLCAvLyBkZWZhdWx0IGZvciB0aGUgZGV0YWlsIHBhZ2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZWxldGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm5cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjcmVhdGU6IHtcbiAgICAgICAgICAgICAgICBpbnB1dDogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZSxcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdXBkYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMudXBkYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbGlzdDoge1xuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5saXN0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGRlZmF1bHQgaW5wdXQvb3V0cHV0IHNjaGVtYSBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gICAgICogXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hKSB7XG4gICAgICAgICAgICB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYSA9IHRoaXMubWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxTPih0aGlzLmdldEVudGl0eVNjaGVtYSgpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhbiBhcnJheSBvZiBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLiBVc2VkIGJ5IHRoZSBgZGV0YWlsYCBBUEkgdG8gc2VyaWFsaXplIHRoZSBlbnRpdHkuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTogRW50aXR5U2VsZWN0aW9uczxTPiB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwID0gdGhpcy5nZXRPcHNEZWZhdWx0SU9TY2hlbWEoKS5nZXQub3V0cHV0O1xuXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXM6IGFueSA9IHt9O1xuICAgICAgICBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5mb3JFYWNoKChfLCBrZXkpID0+IHtcbiAgICAgICAgICAgIC8vIGlmICghdmFsLnJlbGF0aW9uIHx8IHZhbC5yZWxhdGlvbi5oeWRyYXRlKSB7XG4gICAgICAgICAgICAvLyB9XG4gICAgICAgICAgICBhdHRyaWJ1dGVzWyBrZXkgXSA9IHRydWVcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZXMgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcblxuICAgICAgICAvLyAgcmV0dXJuIEFycmF5LmZyb20oIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSApIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhdHRyaWJ1dGUgbmFtZXMgZm9yIGxpc3RpbmcgYW5kIHNlYXJjaCBBUEkuIERlZmF1bHRzIHRvIHRoZSBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLlxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBBbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmxpc3Qub3V0cHV0O1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbShkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5rZXlzKCkpIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2guXG4gICAgICogSW5jbHVkZXMgc3RyaW5nIGZpZWxkcyBhbmQgZW51bSBmaWVsZHMgd2l0aCBzdHJpbmcgdmFsdWVzLlxuICAgICAqIEV4Y2x1ZGVzIGlkZW50aWZpZXJzLCBoaWRkZW4gZmllbGRzLCBkYXRlL2RhdGV0aW1lIGZpZWxkcywgcmVsYXRpb25zLCBhbmQgc2VsZWN0IGZpZWxkcyBieSBkZWZhdWx0LlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2hcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTogQXJyYXk8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gW107XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuXG4gICAgICAgICAgICAvLyBTa2lwIGlmIGhpZGRlbiwgaWRlbnRpZmllciwgb3IgZXhwbGljaXRseSBub3Qgc2VhcmNoYWJsZVxuICAgICAgICAgICAgaWYgKGF0dC5oaWRkZW4gfHwgYXR0LmlzSWRlbnRpZmllciB8fCBhdHQuaXNTZWFyY2hhYmxlID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBhdHRyVHlwZSA9IGF0dC50eXBlO1xuICAgICAgICAgICAgY29uc3QgZmllbGRUeXBlID0gYXR0LmZpZWxkVHlwZTtcblxuICAgICAgICAgICAgLy8gRXhjbHVkZSBkYXRlL2RhdGV0aW1lIGZpZWxkcyAodGhleSdyZSBmb3IgZmlsdGVyaW5nLCBub3QgdGV4dCBzZWFyY2gpXG4gICAgICAgICAgICBpZiAoZmllbGRUeXBlID09PSAnZGF0ZScgfHwgZmllbGRUeXBlID09PSAnZGF0ZXRpbWUnKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4Y2x1ZGUgZGF0ZS1saWtlIGZpZWxkIG5hbWVzIChjcmVhdGVkQXQsIHB1Ymxpc2hlZERhdGUsIGV0Yy4pXG4gICAgICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBhdHROYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICBpZiAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIChsb3dlck5hbWUuaW5jbHVkZXMoJ2RhdGUnKSB8fCBsb3dlck5hbWUuaW5jbHVkZXMoJ3RpbWUnKSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhjbHVkZSByZWxhdGlvbiBmaWVsZHMgKHRoZXkncmUgSURzLCBub3Qgc2VhcmNoYWJsZSB0ZXh0KVxuICAgICAgICAgICAgaWYgKCdyZWxhdGlvbicgaW4gYXR0ICYmIGF0dC5yZWxhdGlvbikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIHNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHMgd2l0aCBvcHRpb25zICh0aGV5J3JlIGZvciBmaWx0ZXJpbmcsIG5vdCBmdWxsLXRleHQgc2VhcmNoKVxuICAgICAgICAgICAgaWYgKChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0JykgJiZcbiAgICAgICAgICAgICAgICAnb3B0aW9ucycgaW4gYXR0ICYmIGF0dC5vcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEluY2x1ZGUgc2VhcmNoYWJsZSB0ZXh0LWJhc2VkIGZpZWxkIHR5cGVzXG4gICAgICAgICAgICBjb25zdCBpc1NlYXJjaGFibGVUeXBlID0gKFxuICAgICAgICAgICAgICAgIC8vIFN0cmluZyBmaWVsZHMgKHByaW1hcnkgc2VhcmNoYWJsZSB0eXBlKVxuICAgICAgICAgICAgICAgICh0eXBlb2YgYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIGF0dHJUeXBlID09PSAnc3RyaW5nJykgfHxcblxuICAgICAgICAgICAgICAgIC8vIEVudW0gZmllbGRzIGNhbiBiZSBzZWFyY2hlZCBieSB0aGVpciBzdHJpbmcgdmFsdWVzXG4gICAgICAgICAgICAgICAgKEFycmF5LmlzQXJyYXkoYXR0clR5cGUpICYmIGF0dHJUeXBlLmxlbmd0aCA+IDAgJiYgYXR0clR5cGUuZXZlcnkodiA9PiB0eXBlb2YgdiA9PT0gJ3N0cmluZycpKVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gSW5jbHVkZSBpZiBzZWFyY2hhYmxlIGJ5IGRlZmF1bHQgKGlzU2VhcmNoYWJsZSBub3QgZXhwbGljaXRseSBzZXQpIG9yIGV4cGxpY2l0bHkgZW5hYmxlZFxuICAgICAgICAgICAgaWYgKGlzU2VhcmNoYWJsZVR5cGUgJiYgKCEoJ2lzU2VhcmNoYWJsZScgaW4gYXR0KSB8fCBhdHQuaXNTZWFyY2hhYmxlKSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWVzLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlTmFtZXM7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSB1bmlxdWUgYXR0cmlidXRlcyBvZiB0aGUgZW50aXR5LiBcbiAgICAgKiBEZWZhdWx0cyB0byBhbGwgYXR0cmlidXRlcyB3aGljaCBhcmUgbWFya2VkIGFzIHVuaXF1ZSBvciBhcmUgaWRlbnRpZmllcnM7IFxuICAgICAqIE9yIGlmIHRoZXkgYXJlIHBhcnQgb2YgYSBjb21wb3NpdGUgcHJpbWFyeSBrZXkgd2hlcmUgdGhlIGNvbXBvc2l0ZSBsZW5ndGggaXMgMS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8RW50aXR5QXR0cmlidXRlPn0gdW5pcXVlIGF0dHJpYnV0ZXMgb2YgdGhlIGVudGl0eVxuICAgICovXG4gICAgcHVibGljIGdldFVuaXF1ZUF0dHJpYnV0ZXMoKTogQXJyYXk8RW50aXR5QXR0cmlidXRlPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG5cbiAgICAgICAgICAgIGxldCBpc1VuaXF1ZSA9ICgnaXNVbmlxdWUnIGluIGF0dCkgPyBhdHQuaXNVbmlxdWUgOiBhdHQuaXNJZGVudGlmaWVyO1xuXG4gICAgICAgICAgICBpZiAoaXNVbmlxdWUpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAuLi5hdHQsXG4gICAgICAgICAgICAgICAgICAgIGlzVW5pcXVlLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBhdHROYW1lLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGUgbmFtZXMgdGhhdCBjYW4gYmUgdXNlZCBmb3IgZmlsdGVyaW5nIHRoZSByZWNvcmRzLlxuICAgICAqIEluY2x1ZGVzIGFsbCBmaWx0ZXJhYmxlIGZpZWxkIHR5cGVzOiBzdHJpbmcsIG51bWJlciwgYm9vbGVhbiwgZW51bXMsIGRhdGVzLCBhbmQgcmVsYXRpb25zLlxuICAgICAqIFxuICAgICAqIFRoaXMgbWF0Y2hlcyB0aGUgY29tcHJlaGVuc2l2ZSBmaWx0ZXJpbmcgc3VwcG9ydCBpbiB0aGUgVUkgZmlsdGVyIGdlbmVyYXRpb24uXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBmaWx0ZXJpbmdcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRGaWx0ZXJhYmxlQXR0cmlidXRlTmFtZXMoKTogQXJyYXk8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gW107XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuXG4gICAgICAgICAgICAvLyBTa2lwIGlmIGV4cGxpY2l0bHkgbWFya2VkIGFzIG5vdCBmaWx0ZXJhYmxlIG9yIGhpZGRlblxuICAgICAgICAgICAgaWYgKGF0dC5oaWRkZW4gfHwgYXR0LmlzRmlsdGVyYWJsZSA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgYXR0clR5cGUgPSBhdHQudHlwZTtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkVHlwZSA9IGF0dC5maWVsZFR5cGU7XG4gICAgICAgICAgICBsZXQgaXNGaWx0ZXJhYmxlVHlwZSA9IGZhbHNlO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBiYXNpYyBzY2FsYXIgdHlwZXNcbiAgICAgICAgICAgIGlmIChhdHRyVHlwZSA9PT0gJ3N0cmluZycgfHwgYXR0clR5cGUgPT09ICdudW1iZXInIHx8IGF0dHJUeXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgICAgICBpc0ZpbHRlcmFibGVUeXBlID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGVudW0gdHlwZXMgKGFycmF5IG9mIHZhbHVlcylcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJiBBcnJheS5pc0FycmF5KGF0dHJUeXBlKSkge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZGF0ZS9kYXRldGltZSBmaWVsZHNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJiAoZmllbGRUeXBlID09PSAnZGF0ZScgfHwgZmllbGRUeXBlID09PSAnZGF0ZXRpbWUnKSkge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZGF0ZS1saWtlIGZpZWxkIG5hbWVzXG4gICAgICAgICAgICBpZiAoIWlzRmlsdGVyYWJsZVR5cGUgJiYgYXR0clR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbG93ZXJOYW1lID0gYXR0TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgICAgIGlmIChsb3dlck5hbWUuaW5jbHVkZXMoJ2RhdGUnKSB8fCBsb3dlck5hbWUuaW5jbHVkZXMoJ3RpbWUnKSkge1xuICAgICAgICAgICAgICAgICAgICBpc0ZpbHRlcmFibGVUeXBlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGZvciByZWxhdGlvbiBmaWVsZHNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJiAncmVsYXRpb24nIGluIGF0dCAmJiBhdHQucmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICBpc0ZpbHRlcmFibGVUeXBlID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIHNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHMgd2l0aCBvcHRpb25zXG4gICAgICAgICAgICBpZiAoIWlzRmlsdGVyYWJsZVR5cGUgJiZcbiAgICAgICAgICAgICAgICAoZmllbGRUeXBlID09PSAnc2VsZWN0JyB8fCBmaWVsZFR5cGUgPT09ICdyYWRpbycgfHwgZmllbGRUeXBlID09PSAnY2hlY2tib3gnIHx8IGZpZWxkVHlwZSA9PT0gJ211bHRpLXNlbGVjdCcpICYmXG4gICAgICAgICAgICAgICAgJ29wdGlvbnMnIGluIGF0dCAmJiBhdHQub3B0aW9ucykge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJbmNsdWRlIGlmIGZpbHRlcmFibGUgYnkgZGVmYXVsdCAoaXNGaWx0ZXJhYmxlIG5vdCBleHBsaWNpdGx5IHNldCkgb3IgZXhwbGljaXRseSBlbmFibGVkXG4gICAgICAgICAgICBpZiAoaXNGaWx0ZXJhYmxlVHlwZSAmJiAoISgnaXNGaWx0ZXJhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc0ZpbHRlcmFibGUpKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZXMucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lcztcbiAgICB9XG5cbiAgICBwdWJsaWMgc2VyaWFsaXplUmVjb3JkPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IFQsIGF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKSk6IFBhcnRpYWw8VD4ge1xuXG4gICAgICAgIGxldCBrZXlzOiBBcnJheTxzdHJpbmc+O1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAga2V5cyA9IE9iamVjdC5rZXlzKHBhcnNlZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMoYXR0cmlidXRlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGlja0tleXM8VD4ocmVjb3JkLCAuLi5rZXlzKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2VyaWFsaXplUmVjb3JkczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4ocmVjb3JkOiBBcnJheTxUPiB8IG51bGwsIGF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKSk6IEFycmF5PFBhcnRpYWw8VD4+IHtcbiAgICAgICAgaWYgKCFyZWNvcmQgfHwgIUFycmF5LmlzQXJyYXkocmVjb3JkKSkge1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZWNvcmQubWFwKHJlY29yZCA9PiB0aGlzLnNlcmlhbGl6ZVJlY29yZDxUPihyZWNvcmQsIGF0dHJpYnV0ZXMpKTtcbiAgICB9XG5cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2RlYnVnJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAncmVhZCcsIGh5ZHJhdGlvbjogJ3RydWUnIH0sXG4gICAgICAgIGdldEF0dHJpYnV0ZXM6IChpbnN0YW5jZTogYW55LCBhcmdzOiBhbnlbXSkgPT4gKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IGluc3RhbmNlLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIHJlbGF0aW9uQ291bnQ6IGFyZ3NbIDAgXT8ubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICByZWNvcmRDb3VudDogYXJnc1sgMSBdPy5sZW5ndGggfHwgMCxcbiAgICAgICAgfSlcbiAgICB9KVxuICAgIGFzeW5jIGh5ZHJhdGVSZWNvcmRzKFxuICAgICAgICByZWxhdGlvbnM6IEFycmF5PFsgcmVsYXRlZEF0dHJpYnV0ZU5hbWU6IHN0cmluZywgb3B0aW9uczogSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uPGFueT4gXT4sXG4gICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzOiBBcnJheTx7IFsgeDogc3RyaW5nIF06IGFueTsgfT5cbiAgICApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZVJlY29yZHMnIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHJlbGF0aW9ucz8ubWFwKGFzeW5jIChbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVNpbmdsZVJlbGF0aW9uKHJvb3RFbnRpdHlSZWNvcmRzLCByZWxhdGVkQXR0cmlidXRlTmFtZSwgb3B0aW9ucyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVTaW5nbGVSZWxhdGlvbihyb290RW50aXR5UmVjb3JkczogYW55W10sIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxhbnk+KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVTaW5nbGVSZWxhdGlvbicgcmVsYXRpb246ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgb3B0aW9uc1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lLCByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGlmICghaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICAgIHRocm93IChgTm8gSWRlbnRpZmllcnM6WyR7cmVsYXRpb25UeXBlfToke3JlbGF0ZWRFbnRpdHlOYW1lfV0gcHJvdmlkZWRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUgPT0gJ29uZS10by1vbmUnIHx8IHJlbGF0aW9uVHlwZSA9PSAnbWFueS10by1tYW55Jykge1xuICAgICAgICAgICAgdGhyb3cgKGBSZWxhdGlvblR5cGU6WyR7cmVsYXRpb25UeXBlfToke3JlbGF0ZWRFbnRpdHlOYW1lfV0gaW4gbm90IHN1cHBvcnRlZCBieSBoeWRyYXRpb24sIHVzZSBvbmUgb2YgW21hbnktdG8tb25lLCBvbmUtdG8tbWFueV0gb3QgbWFudWFsbHkgaHlkcmF0ZSdgKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2VcbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgICAgICBpZiAoIXJlbGF0ZWRFbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHNlcnZpY2UgZm91bmQgZm9yIHJlbGF0aW9uc2hpcDogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX0oJHtyZWxhdGVkRW50aXR5TmFtZX0pOyBwbGVhc2UgbWFrZSBzdXJlIHNlcnZpY2UgaGFzIGJlZW4gcmVnaXN0ZXJlZCBpbiB0aGUgcmVxdWlyZWQgJ2RpLWNvbnRhaW5lcidgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCByZWxhdGlvbidzIG1ldGFkYXRhXG4gICAgICAgIGNvbnN0IGN1cnJlbnRFbnRpdHlTY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCByZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhID0gY3VycmVudEVudGl0eVNjaGVtYS5hdHRyaWJ1dGVzWyByZWxhdGVkQXR0cmlidXRlTmFtZSBhcyBhbnkgXSBhcyBFbnRpdHlBdHRyaWJ1dGU7XG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhIHx8ICFyZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhPy5yZWxhdGlvbikge1xuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGBObyBtZXRhZGF0YSBmb3VuZCBmb3IgcmVsYXRpb25zaGlwOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfWBcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSk7XG4gICAgICAgICAgICB0aHJvdyAobWVzc2FnZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyByZWxhdGlvbiBpZGVudGlmaWVycyBtYXBwaW5nXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSA9IEFycmF5LmlzQXJyYXkoaWRlbnRpZmllcnMpID8gaWRlbnRpZmllcnMgOiBbIGlkZW50aWZpZXJzISBdO1xuXG4gICAgICAgIC8vIERlY2lkZSBsb2dpYyBiYXNlZCBvbiByZWxhdGlvblR5cGVcbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZSA9PT0gJ21hbnktdG8tb25lJykge1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBNQU5ZLVRPLU9ORTpcbiAgICAgICAgICAgICAqIC0tLS0tLS0tLS0tLS1cbiAgICAgICAgICAgICAqIFRoZSBcInJvb3RFbnRpdHlSZWNvcmRzXCIgYXJlIHRoZSBDSElMRCBpdGVtcywgZWFjaCBzdG9yaW5nIHRoZSBwYXJlbnQnc1xuICAgICAgICAgICAgICogY29tcG9zaXRlIGtleSBpbiBzb21lIGZpZWxkcy4gV2UgZ2F0aGVyIGFsbCB0aG9zZSBwYXJlbnQga2V5cywgZG8gYSBiYXRjaFxuICAgICAgICAgICAgICogcmV0cmlldmFsIGZyb20gdGhlIHBhcmVudCBlbnRpdHksIHRoZW4gYXR0YWNoIHRoZSBzaW5nbGUgbWF0Y2hpbmcgcGFyZW50XG4gICAgICAgICAgICAgKiByZWNvcmQgaW50byBjaGlsZFJlY29yZFtyZWxhdGVkQXR0cmlidXRlTmFtZV0uXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlTWFueVRvT25lKFxuICAgICAgICAgICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25UeXBlID09PSAnb25lLXRvLW1hbnknKSB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIE9ORS1UTy1NQU5ZOlxuICAgICAgICAgICAgICogLS0tLS0tLS0tLS0tLVxuICAgICAgICAgICAgICogVGhlIFwicm9vdEVudGl0eVJlY29yZHNcIiBhcmUgdGhlIFBBUkVOVCBpdGVtcy4gRWFjaCBwYXJlbnQgY2FuIGhhdmUgbXVsdGlwbGVcbiAgICAgICAgICAgICAqIGNoaWxkIGl0ZW1zLiBUaGUgY2hpbGQgdGFibGUgcmVjb3JkcyBlYWNoIHN0b3JlIHRoZSBwYXJlbnQncyBrZXkuIFxuICAgICAgICAgICAgICogU28gd2UgZG8gYSBxdWVyeSBwZXIgcGFyZW50IGFuZCB0aGVuIC5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlT25lVG9NYW55KFxuICAgICAgICAgICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVNYW55VG9PbmUoXG4gICAgICAgIGNoaWxkUmVjb3JkczogYW55W10sXG4gICAgICAgIHBhcmVudEF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdLFxuICAgICAgICBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlOiBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PGFueT4gfCB1bmRlZmluZWQsXG4gICAgICAgIHBhcmVudFNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbiAgICApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZU1hbnlUb09uZScgcmVsYXRpb246ICR7cGFyZW50QXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBmb3IgZWFjaCBwYXJlbnQgY3JlYXRlIGEgY2hpbGRyZW4gYmF0Y2hcbiAgICAgICAgY29uc3QgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgY2hpbGRSZWNvcmRzKSB7XG4gICAgICAgICAgICBpZiAoIWNoaWxkKSBjb250aW51ZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBwYXJlbnQga2V5IG9iamVjdC4gRS5nLiB7IG9yZ0lkOiBjaGlsZC5vcmdJZCwgdXNlcklkOiBjaGlsZC51c2VySWQgfSBmb3IgMi1hdHRyIFBLXG4gICAgICAgICAgICBjb25zdCBwYXJlbnRLZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBzb3VyY2UsIHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsID0gZ2V0VmFsdWVCeVBhdGgoY2hpbGQsIHNvdXJjZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWwgPT0gbnVsbCkgY29udGludWU7XG5cbiAgICAgICAgICAgICAgICAgICAgcGFyZW50S2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSB2YWw7XG5cbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgZ2V0dGluZyB2YWx1ZSBmb3IgcGF0aDogJHtzb3VyY2V9YCwgeyBlcnJvciB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIHBhcnRpYWwgb3IgZW1wdHksIHNraXBcbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhwYXJlbnRLZXlPYmopLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGNoaWxkWyBwYXJlbnRBdHRyaWJ1dGVOYW1lIF0gPSBudWxsO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBKU09OLnN0cmluZ2lmeShwYXJlbnRLZXlPYmopO1xuICAgICAgICAgICAgaWYgKCFwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuaGFzKGtleVN0cikpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuc2V0KGtleVN0ciwgW10pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmdldChrZXlTdHIpIS5wdXNoKGNoaWxkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuc2l6ZSA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHBhcmVudC1pZGVudGlmaWVycy1iYXRjaCBmb3IgZmV0Y2hpbmdcbiAgICAgICAgY29uc3QgcGFyZW50SWRlbnRpZmllcnNCYXRjaDogQXJyYXk8UmVjb3JkPHN0cmluZywgYW55Pj4gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBrIG9mIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5rZXlzKCkpIHtcbiAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzQmF0Y2gucHVzaChKU09OLnBhcnNlKGspKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZldGNoZWRQYXJlbnRzID0gYXdhaXQgcGFyZW50U2VydmljZS5nZXQoe1xuICAgICAgICAgICAgaWRlbnRpZmllcnM6IHBhcmVudElkZW50aWZpZXJzQmF0Y2gsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJZiBcImdldCgpXCIgcmV0dXJucyBhIHNpbmdsZSBpdGVtIGNvbnZlcnQgaXQgaW50byBhbiBhcnJheS5cbiAgICAgICAgY29uc3QgcGFyZW50c0FycmF5ID0gQXJyYXkuaXNBcnJheShmZXRjaGVkUGFyZW50cykgPyBmZXRjaGVkUGFyZW50cyA6IFsgZmV0Y2hlZFBhcmVudHMgXTtcblxuICAgICAgICAvLyBNYWtlIGEgZGljdGlvbmFyeSBmcm9tIHsgPGtleVN0cj4gPT4gcGFyZW50UmVjb3JkIH1cbiAgICAgICAgY29uc3QgcGFyZW50RGljdCA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiBwYXJlbnRzQXJyYXkpIHtcbiAgICAgICAgICAgIGlmICghcCkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gUmVidWlsZCB0aGUgXCJjb21wb3NpdGUga2V5XCIgZnJvbSB0aGUgcGFyZW50J3MgcmVjb3JkXG4gICAgICAgICAgICBjb25zdCBrZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAocFsgdGFyZ2V0IF0gPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBJZiBzb21lIGF0dHJpYnV0ZSBpcyBtaXNzaW5nLCBza2lwXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBrZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHBbIHRhcmdldCBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3Qga1N0ciA9IEpTT04uc3RyaW5naWZ5KGtleU9iaik7XG4gICAgICAgICAgICBwYXJlbnREaWN0LnNldChrU3RyLCBwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEF0dGFjaCBlYWNoIHBhcmVudCdzIGRhdGEgdG8gdGhlIGNoaWxkXG4gICAgICAgIGZvciAoY29uc3QgWyBrU3RyLCBjaGlsZHJlbiBdIG9mIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGZvdW5kUGFyZW50ID0gcGFyZW50RGljdC5nZXQoa1N0cikgPz8gbnVsbDtcbiAgICAgICAgICAgIGZvciAoY29uc3QgYyBvZiBjaGlsZHJlbikge1xuICAgICAgICAgICAgICAgIGNbIHBhcmVudEF0dHJpYnV0ZU5hbWUgXSA9IGZvdW5kUGFyZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlT25lVG9NYW55KFxuICAgICAgICBwYXJlbnRSZWNvcmRzOiBhbnlbXSxcbiAgICAgICAgY2hpbGRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSxcbiAgICAgICAgY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlOiBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PGFueT4gfCB1bmRlZmluZWQsXG4gICAgICAgIGNoaWxkU2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuICAgICkge1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVPbmVUb01hbnknIHJlbGF0aW9uOiAke2NoaWxkQXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHBhcmVudEtleVN0clRvUGFyZW50cyA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhcmVudCBvZiBwYXJlbnRSZWNvcmRzKSB7XG4gICAgICAgICAgICBpZiAoIXBhcmVudCkgY29udGludWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgXCJjaGlsZCBpbmRleFwiIGtleSBmcm9tIHRoZSBwYXJlbnQncyBmaWVsZHMuIEZvciBleGFtcGxlLCBcbiAgICAgICAgICAgIC8vIGlmIHRoZSBjaGlsZCBHU0kgaGFzIHsgcGs6ICd0ZW5hbnRJZCcsIHNrOiAnYWNjb3VudElkJyB9LCBcbiAgICAgICAgICAgIC8vIHdlIGZpbGwgeyB0ZW5hbnRJZDogcGFyZW50LnRlbmFudElkLCBhY2NvdW50SWQ6IHBhcmVudC5hY2NvdW50SWQgfS5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkS2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgc291cmNlLCB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAocGFyZW50WyBzb3VyY2UgXSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkS2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSBwYXJlbnRbIHNvdXJjZSBdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSWYgd2UgaGF2ZSBubyB2YWxpZCBjb21wb3NpdGUga2V5LCBubyBjaGlsZHJlbiBjYW4gYmUgZmV0Y2hlZFxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKGNoaWxkS2V5T2JqKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRbIGNoaWxkQXR0cmlidXRlTmFtZSBdID0gW107XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IEpTT04uc3RyaW5naWZ5KGNoaWxkS2V5T2JqKTtcbiAgICAgICAgICAgIGlmICghcGFyZW50S2V5U3RyVG9QYXJlbnRzLmhhcyhrZXlTdHIpKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9QYXJlbnRzLnNldChrZXlTdHIsIFtdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhcmVudEtleVN0clRvUGFyZW50cy5nZXQoa2V5U3RyKSEucHVzaChwYXJlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgbm8gcGFyZW50IGhhcyBhIHZhbGlkIGtleSwgd2UncmUgZG9uZVxuICAgICAgICBpZiAocGFyZW50S2V5U3RyVG9QYXJlbnRzLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZvciBlYWNoIHVuaXF1ZSBwYXJlbnRLZXlPYmosIGRvIGEgY2hpbGRTZXJ2aWNlIHF1ZXJ5L2xpc3QgaW4gcGFyYWxsZWwuXG4gICAgICAgIGNvbnN0IHByb21pc2VzOiBBcnJheTxQcm9taXNlPGFueT4+ID0gW107XG4gICAgICAgIGNvbnN0IHBhcmVudEtleXM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGtleVN0ciBdIG9mIHBhcmVudEtleVN0clRvUGFyZW50cy5lbnRyaWVzKCkpIHtcblxuICAgICAgICAgICAgY29uc3QgY2hpbGRLZXlPYmogPSBKU09OLnBhcnNlKGtleVN0cik7XG5cbiAgICAgICAgICAgIHBhcmVudEtleXMucHVzaChrZXlTdHIpO1xuXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgY2hpbGRGaWVsZCwgdmFsIF0gb2YgT2JqZWN0LmVudHJpZXMoY2hpbGRLZXlPYmopKSB7XG4gICAgICAgICAgICAgICAgZmlsdGVyc1sgY2hpbGRGaWVsZCBdID0geyBlcTogdmFsIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb21pc2VzLnB1c2goXG4gICAgICAgICAgICAgICAgY2hpbGRTZXJ2aWNlLmxpc3Qoe1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuXG4gICAgICAgIC8vIEZvciBlYWNoIHJlc3VsdCwgbWFwIGNoaWxkcmVuIGJhY2sgdG8gdGhlIGNvcnJlY3QtcGFyZW50KHMpXG4gICAgICAgIGNvbnN0IHBhcmVudEtleVN0clRvQ2hpbGRyZW46IFJlY29yZDxzdHJpbmcsIGFueVtdPiA9IHt9O1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3VsdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IHsgZGF0YTogY2hpbGRJdGVtcyB9ID0gcmVzdWx0c1sgaSBdO1xuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gcGFyZW50S2V5c1sgaSBdO1xuICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9DaGlsZHJlblsga2V5U3RyIF0gPSBjaGlsZEl0ZW1zID8/IFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXR0YWNoIHRvIHBhcmVudHNcbiAgICAgICAgZm9yIChjb25zdCBbIGtleVN0ciwgcGFyZW50cyBdIG9mIHBhcmVudEtleVN0clRvUGFyZW50cy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQXJyYXkgPSBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuWyBrZXlTdHIgXSA/PyBbXTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcCBvZiBwYXJlbnRzKSB7XG4gICAgICAgICAgICAgICAgcFsgY2hpbGRBdHRyaWJ1dGVOYW1lIF0gPSBjaGlsZEFycmF5O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIGFuIGVudGl0eSBieSBpdHMgaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkuXG4gICAgICogQHBhcmFtIHNlbGVjdGlvbnMgLSBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmVzcG9uc2UuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJldHJpZXZlZCBlbnRpdHkgZGF0YS5cbiAgICAgKi9cblxuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJyB9LFxuICAgICAgICBnZXRBdHRyaWJ1dGVzOiAoaW5zdGFuY2U6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IGluc3RhbmNlLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgfSksXG4gICAgICAgIGdldFJlc3VsdEF0dHJpYnV0ZXM6IChyZXN1bHQ6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIGZvdW5kOiAhIXJlc3VsdCxcbiAgICAgICAgfSlcbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBnZXQob3B0aW9uczogR2V0T3B0aW9uczxTPiwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgYXR0cmlidXRlcyB9ID0gb3B0aW9ucztcblxuXG4gICAgICAgIGxldCBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcbiAgICAgICAgaWYgKCFhdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZvcm1hdHRlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm9ybWF0dGVkIGF0dHJpYnV0ZXMgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBmb3JtYXR0ZWRBdHRyaWJ1dGVzKTtcblxuICAgICAgICBjb25zdCByZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIGFueSkucmVkdWNlKChhY2MsIFsgYXR0TmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhY2MucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIGlmIChpc09iamVjdChvcHRpb25zKSAmJiBvcHRpb25zLmlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IEFycmF5PFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+PiA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzIDogWyBvcHRpb25zLmlkZW50aWZpZXJzIF07XG4gICAgICAgICAgICAgICAgY29uc3QgdG9wS2V5cyA9IGlkZW50aWZpZXJzLm1hcChpZGVudGlmaWVyID0+IGlkZW50aWZpZXIuc291cmNlPy5zcGxpdD8uKCcuJyk/LlsgMCBdKS5maWx0ZXIoa2V5ID0+ICEha2V5KSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgICAgICBhY2MucHVzaCguLi50b3BLZXlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIFtdIGFzIHN0cmluZ1tdKTtcblxuICAgICAgICBjb25zdCB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzID0gWyAuLi5uZXcgU2V0KHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcykgXVxuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGdldEVudGl0eTxTPih7XG4gICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmV0cmlldmVkIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBKc29uU2VyaWFsaXplci5zdHJpbmdpZnkoZW50aXR5KSk7XG5cbiAgICAgICAgaWYgKCEhZm9ybWF0dGVkQXR0cmlidXRlcyAmJiBlbnRpdHk/LmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBbIGVudGl0eS5kYXRhIF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGVudGl0eT8uZGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgbXVsdGlwbGUgZW50aXRpZXMgYnkgdGhlaXIgaWRlbnRpZmllcnMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgYmF0Y2ggcmV0cmlldmluZyBlbnRpdGllcy5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5pZGVudGlmaWVycyAtIEFycmF5IG9mIGVudGl0eSBpZGVudGlmaWVycyB0byByZXRyaWV2ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVzIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIHRvIHBlcmZvcm0gKGRlZmF1bHQ6IDEpLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSByZXRyaWV2ZWQgZW50aXRpZXMgYW5kIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2RlYnVnJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAncmVhZCcsIGJhdGNoOiAndHJ1ZScgfSxcbiAgICAgICAgZ2V0QXR0cmlidXRlczogKGluc3RhbmNlOiBhbnksIGFyZ3M6IGFueVtdKSA9PiAoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogaW5zdGFuY2UuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgYmF0Y2hTaXplOiBhcmdzWyAwIF0/LmlkZW50aWZpZXJzPy5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgIGNvbmN1cnJlbnQ6IGFyZ3NbIDAgXT8uY29uY3VycmVudCB8fCAxLFxuICAgICAgICB9KSxcbiAgICAgICAgZ2V0UmVzdWx0QXR0cmlidXRlczogKHJlc3VsdDogYW55KSA9PiAoe1xuICAgICAgICAgICAgcmV0cmlldmVkQ291bnQ6IHJlc3VsdD8uZGF0YT8ubGVuZ3RoIHx8IDAsXG4gICAgICAgICAgICB1bnByb2Nlc3NlZENvdW50OiByZXN1bHQ/LnVucHJvY2Vzc2VkPy5sZW5ndGggfHwgMCxcbiAgICAgICAgfSlcbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBiYXRjaEdldDxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiB7XG4gICAgICAgIGlkZW50aWZpZXJzOiBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PixcbiAgICAgICAgYXR0cmlidXRlcz86IEVudGl0eVNlbGVjdGlvbnM8Uz4sXG4gICAgICAgIGNvbmN1cnJlbnQ/OiBudW1iZXJcbiAgICB9KSB7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMsIGNvbmN1cnJlbnQgPSAxIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcbiAgICAgICAgaWYgKCFhdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZvcm1hdHRlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm9ybWF0dGVkIGF0dHJpYnV0ZXMgZm9yIGJhdGNoIGdldCBvbiBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZm9ybWF0dGVkQXR0cmlidXRlcyk7XG5cbiAgICAgICAgY29uc3QgcmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBhbnkpLnJlZHVjZSgoYWNjLCBbIGF0dE5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYWNjLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICBpZiAoaXNPYmplY3Qob3B0aW9ucykgJiYgb3B0aW9ucy5pZGVudGlmaWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8YW55Pj4gPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycyA6IFsgb3B0aW9ucy5pZGVudGlmaWVycyBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcEtleXMgPSBpZGVudGlmaWVycy5tYXAoaWRlbnRpZmllciA9PiBpZGVudGlmaWVyLnNvdXJjZT8uc3BsaXQ/LignLicpPy5bIDAgXSkuZmlsdGVyKGtleSA9PiAhIWtleSkgYXMgc3RyaW5nW107XG4gICAgICAgICAgICAgICAgYWNjLnB1c2goLi4udG9wS2V5cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCBbXSBhcyBzdHJpbmdbXSk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyA9IFsgLi4ubmV3IFNldChyZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMpIF07XG5cbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZ2V0QmF0Y2hFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWRzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMgYXMgYW55LFxuICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmV0cmlldmVkIGJhdGNoIGVudGl0aWVzOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIEpzb25TZXJpYWxpemVyLnN0cmluZ2lmeShlbnRpdHkpKTtcblxuICAgICAgICBpZiAoISFmb3JtYXR0ZWRBdHRyaWJ1dGVzICYmIGVudGl0eT8uZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0eS5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBkYXRhOiBlbnRpdHk/LmRhdGEgfHwgW10sXG4gICAgICAgICAgICB1bnByb2Nlc3NlZDogZW50aXR5Py51bnByb2Nlc3NlZCB8fCBbXVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyB0aGUgdW5pcXVlbmVzcyBvZiBhbiBhdHRyaWJ1dGUgdmFsdWUgYW5kIHVwZGF0ZXMgdGhlIHBheWxvYWQgaWYgbmVjZXNzYXJ5LlxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNoZWNraW5nIHVuaXF1ZW5lc3MgYW5kIHVwZGF0aW5nIHRoZSBwYXlsb2FkLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLnBheWxvYWRUb1VwZGF0ZSAtIFRoZSBwYXlsb2FkIG9iamVjdCB0byB1cGRhdGUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlVmFsdWUgLSBUaGUgdmFsdWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgYXR0ZW1wdHMgdG8gY3JlYXRlIGEgdW5pcXVlIGF0dHJpYnV0ZSB2YWx1ZS5cbiAgICAgKiBAcmV0dXJucyBBIGJvb2xlYW4gaW5kaWNhdGluZyB3aGV0aGVyIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlLlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBjaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUob3B0aW9uczoge1xuICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IGFueSxcbiAgICAgICAgYXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogYW55LFxuICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM/OiB7XG4gICAgICAgICAgICBbIGtleTogc3RyaW5nIF06IGFueVxuICAgICAgICB9XG4gICAgICAgIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZTogbnVtYmVyLFxuICAgIH0pIHtcblxuICAgICAgICBjb25zdCB7IHBheWxvYWRUb1VwZGF0ZSwgYXR0cmlidXRlTmFtZSwgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzLCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgfSA9IG9wdGlvbnM7XG4gICAgICAgIGxldCB7IGF0dHJpYnV0ZVZhbHVlIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBpc1VuaXF1ZSA9IGZhbHNlO1xuICAgICAgICBsZXQgdHJpZXNDb3VudCA9IDE7XG5cbiAgICAgICAgd2hpbGUgKCFpc1VuaXF1ZSAmJiB0cmllc0NvdW50IDwgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKSB7XG4gICAgICAgICAgICBpc1VuaXF1ZSA9IGF3YWl0IHRoaXMuaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZShhdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVWYWx1ZSwgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKTtcbiAgICAgICAgICAgIGlmICghaXNVbmlxdWUpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZSA9IHRoaXMuZ2VuZXJhdGVVbmlxdWVWYWx1ZShhdHRyaWJ1dGVWYWx1ZSwgdHJpZXNDb3VudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0cmllc0NvdW50Kys7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNVbmlxdWUpIHtcbiAgICAgICAgICAgIHBheWxvYWRUb1VwZGF0ZVsgYXR0cmlidXRlTmFtZSBdID0gYXR0cmlidXRlVmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaXNVbmlxdWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIGlmIHRoZSBnaXZlbiBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlIGZvciB0aGUgc3BlY2lmaWVkIGF0dHJpYnV0ZSBuYW1lLlxuICAgICAqIEBwYXJhbSBhdHRyaWJ1dGVOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gYXR0cmlidXRlVmFsdWUgLSBUaGUgdmFsdWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcmV0dXJucyBBIGJvb2xlYW4gaW5kaWNhdGluZyB3aGV0aGVyIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlIG9yIG5vdC5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZShcbiAgICAgICAgYXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogYW55LFxuICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM/OiB7XG4gICAgICAgICAgICBbIGtleTogc3RyaW5nIF06IGFueVxuICAgICAgICB9XG4gICAgKSB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGlzVW5pcXVlQXR0cmlidXRlVmFsdWUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGF0dHJpYnV0ZU5hbWU6ICR7YXR0cmlidXRlTmFtZX0gfiBhdHRyaWJ1dGVWYWx1ZTogJHthdHRyaWJ1dGVWYWx1ZX1gKTtcblxuICAgICAgICAvLyBDcmVhdGUgZmlsdGVycyBmb3IgdGhlIHF1ZXJ5IHVzaW5nIHRoZSBjb3JyZWN0IHN0cnVjdHVyZVxuICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgWyBhdHRyaWJ1dGVOYW1lIF06IHsgZXE6IGF0dHJpYnV0ZVZhbHVlIH1cbiAgICAgICAgfSBhcyBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPjtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgd2hpY2ggYXR0cmlidXRlcyB0byBwcm9qZWN0IC0gb25seSB0aGUgYXR0cmlidXRlIGJlaW5nIGNoZWNrZWQgYW5kIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXJzXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXNUb1Byb2plY3Q6IHN0cmluZ1tdID0gWyBhdHRyaWJ1dGVOYW1lIF07XG5cbiAgICAgICAgLy8gQWRkIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXIgZmllbGRzIHRvIHRoZSBwcm9qZWN0aW9uXG4gICAgICAgIGlmIChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMgJiYgIWlzRW1wdHlPYmplY3REZWVwKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghYXR0cmlidXRlc1RvUHJvamVjdC5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNUb1Byb2plY3QucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXNlIHRoZSBxdWVyeSBtZXRob2QgdG8gbGV2ZXJhZ2UgaW5kZXggc2VsZWN0aW9uIGxvZ2ljIHdpdGggbWluaW1hbCBhdHRyaWJ1dGUgcHJvamVjdGlvblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KHtcbiAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiBhdHRyaWJ1dGVzVG9Qcm9qZWN0IGFzIGFueSxcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHsgY291bnQ6IDEgfSAvLyBXZSBvbmx5IG5lZWQgdG8ga25vdyBpZiBhbnkgcmVjb3JkcyBleGlzdFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJZiB3ZSBoYXZlIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXJzLCBmaWx0ZXIgdGhlIHJlc3VsdHMgaW4gbWVtb3J5XG4gICAgICAgIGxldCBlbnRpdGllcyA9IHJlc3VsdC5kYXRhIHx8IFtdO1xuICAgICAgICBpZiAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzICYmICFpc0VtcHR5T2JqZWN0RGVlcChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBlbnRpdGllcyA9IGVudGl0aWVzLmZpbHRlcihlbnRpdHkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAhT2JqZWN0LmVudHJpZXMoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKS5ldmVyeSgoWyBrZXksIHZhbHVlIF0pID0+XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eVsga2V5IF0gPT09IHZhbHVlXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGlzVW5pcXVlQXR0cmlidXRlVmFsdWUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGF0dHJpYnV0ZU5hbWU6ICR7YXR0cmlidXRlTmFtZX0gfiBhdHRyaWJ1dGVWYWx1ZTogJHthdHRyaWJ1dGVWYWx1ZX0gfiBlbnRpdHk6YCwgeyBkYXRhOiBlbnRpdGllcyB9KTtcblxuICAgICAgICByZXR1cm4gZW50aXRpZXMubGVuZ3RoID09PSAwO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlcyBhIHVuaXF1ZSB2YWx1ZSBieSBhcHBlbmRpbmcgYSB1bmlxdWUgc3VmZml4IHRvIHRoZSBvcmlnaW5hbCB2YWx1ZS5cbiAgICAgKiBAcGFyYW0gb3JpZ2luYWxWYWx1ZSAtIFRoZSBvcmlnaW5hbCB2YWx1ZSB0byBnZW5lcmF0ZSBhIHVuaXF1ZSB2YWx1ZSBmcm9tLlxuICAgICAqIEBwYXJhbSBhdHRlbXB0IC0gVGhlIGF0dGVtcHQgbnVtYmVyIG9yIHN0cmluZyB0byBiZSB1c2VkIGFzIGEgc3VmZml4IChkZWZhdWx0OiByYW5kb20gc3RyaW5nKS5cbiAgICAgKiBAcmV0dXJucyBUaGUgZ2VuZXJhdGVkIHVuaXF1ZSB2YWx1ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2VuZXJhdGVVbmlxdWVWYWx1ZShvcmlnaW5hbFZhbHVlOiBhbnksIGF0dGVtcHQ6IG51bWJlciB8IHN0cmluZyA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZygyLCAxNSkpOiBzdHJpbmcge1xuICAgICAgICBjb25zdCB1bmlxdWVTdWZmaXggPSBgJHtEYXRlLm5vdygpfS0ke2F0dGVtcHR9YDtcbiAgICAgICAgcmV0dXJuIGAke29yaWdpbmFsVmFsdWV9LSR7dW5pcXVlU3VmZml4fWA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXV0b21hdGljYWxseSBpbmplY3RzIGFjdG9yIGNvbnRleHQgaW50byBlbnRpdHkgZGF0YVxuICAgICAqIEBwYXJhbSBkYXRhIC0gVGhlIGVudGl0eSBkYXRhIHRvIGVuaGFuY2VcbiAgICAgKiBAcGFyYW0gb3BlcmF0aW9uIC0gVGhlIG9wZXJhdGlvbiB0eXBlIChjcmVhdGUvdXBkYXRlKVxuICAgICAqIEBwYXJhbSBjdHggLSBUaGUgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvXG4gICAgICogQHJldHVybnMgRW5oYW5jZWQgZGF0YSB3aXRoIGFjdG9yIGNvbnRleHRcbiAgICAgKi9cbiAgICBwcm90ZWN0ZWQgaW5qZWN0QWN0b3JDb250ZXh0PFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICAgICAgZGF0YTogVCxcbiAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RlbGV0ZScsXG4gICAgICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgICApOiBUIHtcblxuICAgICAgICBpZiAoIWN0eD8uYWN0b3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdCYXNlRW50aXR5U2VydmljZTogTm8gYWN0b3IgY29udGV4dCBmb3VuZCwgc2tpcHBpbmcgaW5qZWN0aW9uJyk7XG4gICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVuaGFuY2VkRGF0YSA9IHsgLi4uZGF0YSB9O1xuICAgICAgICBjb25zdCB7IGFjdG9yIH0gPSBjdHg7XG5cbiAgICAgICAgLy8gR2V0IGN1cnJlbnQgdGltZXN0YW1wIGZvciBkYXRhYmFzZSBvcGVyYXRpb25cbiAgICAgICAgY29uc3QgY3VycmVudFRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcblxuICAgICAgICAvLyBJbmplY3QgdmlzaWJsZSBhY3RvciBmaWVsZHMgaWYgZGVmaW5lZCBpbiBzY2hlbWEgYW5kIG5vdCByZWFkLW9ubHlcbiAgICAgICAgaWYgKG9wZXJhdGlvbiA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdjcmVhdGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdjcmVhdGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIGRlbGV0ZSBvcGVyYXRpb25zLCB3ZSBzdGlsbCB3YW50IHRvIHRyYWNrIHdobyBwZXJmb3JtZWQgdGhlIGRlbGV0aW9uXG4gICAgICAgIGlmIChvcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnZGVsZXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnZGVsZXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEFsd2F5cyB1cGRhdGUgdGhlc2UgZmllbGRzIG9uIGNyZWF0ZS91cGRhdGUgKGlmIG5vdCByZWFkLW9ubHkpXG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndXBkYXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndXBkYXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndGVuYW50SWQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd0ZW5hbnRJZCcpICYmIGFjdG9yLnRlbmFudElkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLnRlbmFudElkID0gYWN0b3IudGVuYW50SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBbHdheXMgaW5qZWN0IGNvbXBsZXRlIGFjdG9yIGNvbnRleHQgZm9yIGF1ZGl0IHRyYWlsXG4gICAgICAgIC8vIFRoaXMgZmllbGQgaXMgaGlkZGVuIGZyb20gQVBJIHJlc3BvbnNlcyBieSBkZWZhdWx0XG4gICAgICAgIC8vIENsZWFuIGFjdG9yIG9iamVjdCBieSByZW1vdmluZyB1bmRlZmluZWQgdmFsdWVzIChEeW5hbW9EQiBkb2Vzbid0IGFsbG93IHRoZW0pXG4gICAgICAgIGNvbnN0IGNsZWFuQWN0b3IgPSBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhhY3RvcikuZmlsdGVyKChbIF8sIHZhbHVlIF0pID0+IHZhbHVlICE9PSB1bmRlZmluZWQpXG4gICAgICAgICk7XG5cbiAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLl9hY3RvciA9IGNsZWFuQWN0b3I7XG5cbiAgICAgICAgcmV0dXJuIGVuaGFuY2VkRGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF5bG9hZCAtIFRoZSBwYXlsb2FkIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2luZm8nIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICd3cml0ZScgfSxcbiAgICAgICAgZ2V0QXR0cmlidXRlczogKGluc3RhbmNlOiBhbnkpID0+ICh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBpbnN0YW5jZS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgIH0pXG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgY3JlYXRlKHBheWxvYWQ6IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgICAgIGxldCBwYXlsb2FkQ29weSA9IHsgLi4ucGF5bG9hZCB9O1xuXG4gICAgICAgIC8vIEluamVjdCBhY3RvciBjb250ZXh0XG4gICAgICAgIHBheWxvYWRDb3B5ID0gdGhpcy5pbmplY3RBY3RvckNvbnRleHQocGF5bG9hZENvcHksICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eVNsdWdBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnc2x1ZycpIHx8ICcnO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ25hbWUnKSB8fCAnJztcblxuICAgICAgICBpZiAoZW50aXR5U2x1Z0F0dHJpYnV0ZSAmJiAhKGVudGl0eVNsdWdBdHRyaWJ1dGUgaW4gcGF5bG9hZENvcHkpKSB7XG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZUF0dHJpYnV0ZSAmJiAoZW50aXR5TmFtZUF0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgICAgICBwYXlsb2FkQ29weVsgZW50aXR5U2x1Z0F0dHJpYnV0ZSBhcyBrZXlvZiB0eXBlb2YgcGF5bG9hZENvcHkgXSA9IHRvU2x1ZyhwYXlsb2FkQ29weVsgZW50aXR5TmFtZUF0dHJpYnV0ZSBdKSBhcyBhbnk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHMgPSB0aGlzLmdldFVuaXF1ZUF0dHJpYnV0ZXMoKTtcbiAgICAgICAgY29uc3Qgc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlID0gNTtcblxuICAgICAgICBpZiAoIXNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzICYmIHVuaXF1ZUZpZWxkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxldCB1bmlxdWVuZXNzQ2hlY2tzID0gW107XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lIH0gb2YgdW5pcXVlRmllbGRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5hbWUhIGluIHBheWxvYWRDb3B5KSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2YWx1ZSA9IHBheWxvYWRDb3B5WyBuYW1lISBdO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IG5hbWUhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBjcmVhdGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgZGF0YTogcGF5bG9hZENvcHksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBlbnRpdHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcy1PUi1VcGRhdGVzIGFuIGVudGl0eS5cbiAgICAgKiBOT1RFOiBcbiAgICAgKiAgIC0gVGhpcyBtZXRob2QgZG9lcyBub3QgY2hlY2sgZm9yIHVuaXF1ZW5lc3Mgb2YgdGhlIGF0dHJpYnV0ZXMsIG5laXRoZXIgY3JlYXRlIHRoZSBzbHVnIGF1dG9tYXRpY2FsbHkuXG4gICAgICogICAtIEl0J3MgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIHRoZSBjYWxsZXIgdG8gZW5zdXJlIHRoZSByZWFkIG9ueSBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaWYgdGhlIHJlY29yZCBpcyBiZWluZyB1cHNlcnQuXG4gICAgICogXG4gICAgICogQHBhcmFtIHBheWxvYWQgLSBUaGUgcGF5bG9hZCBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBPYmplY3QgY29udGFpbmluZzpcbiAgICAgKiAgIC0gZGF0YTogVGhlIHVwc2VydGVkIGVudGl0eSBkYXRhXG4gICAgICogICAtIHdhc0NyZWF0ZWQ6IHRydWUgaWYgcmVjb3JkIHdhcyBjcmVhdGVkLCBmYWxzZSBpZiB1cGRhdGVkXG4gICAgICogICAtIG9sZERhdGE6IHByZXZpb3VzIGRhdGEgaWYgaXQgd2FzIGFuIHVwZGF0ZSAodW5kZWZpbmVkIGZvciBjcmVhdGVzKVxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnaW5mbycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3dyaXRlJyB9LFxuICAgICAgICBnZXRBdHRyaWJ1dGVzOiAoaW5zdGFuY2U6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IGluc3RhbmNlLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgfSksXG4gICAgICAgIGdldFJlc3VsdEF0dHJpYnV0ZXM6IChyZXN1bHQ6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIHdhc0NyZWF0ZWQ6ICEhcmVzdWx0Py53YXNDcmVhdGVkLFxuICAgICAgICB9KVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIHVwc2VydChwYXlsb2FkOiBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcGF5bG9hZDpgLCBwYXlsb2FkKTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB1cHNlcnRFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgZGF0YTogcGF5bG9hZCxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgZHVwbGljYXRlIGVudGl0eSBkYXRhIGJhc2VkIG9uIHRoZSBnaXZlbiBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgZHVwbGljYXRlIGVudGl0eSBkYXRhLlxuICAgICAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gcmVjb3JkIGlzIGZvdW5kIGZvciB0aGUgZ2l2ZW4gaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBpZGVudGlmaWVycyA9IHsgaWQ6IDEgfTtcbiAgICAgKiBjb25zdCBkdXBsaWNhdGVEYXRhID0gYXdhaXQgbWFrZUR1cGxpY2F0ZUVudGl0eURhdGFCeUlkZW50aWZpZXJzKGlkZW50aWZpZXJzKTtcbiAgICAgKiBjb25zb2xlLmxvZyhkdXBsaWNhdGVEYXRhKTsgLy8geyBuYW1lOiAnSm9obiBEb2UnLCBhZ2U6IDMwLCAuLi4gfVxuICAgICAqL1xuICAgIHByb3RlY3RlZCBhc3luYyBtYWtlRHVwbGljYXRlRW50aXR5RGF0YShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPikge1xuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCB0aGlzLmdldCh7IGlkZW50aWZpZXJzIH0pIGFzIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+O1xuXG4gICAgICAgIGlmICghZW50aXR5KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IHJlY29yZCBmb3VuZCBmb3IgaWRlbnRpZmllcnM6ICR7aWRlbnRpZmllcnN9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgZHVwbGljYXRlRXZlbnREYXRhOiBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4gPSB7fSBhcyBhbnk7XG4gICAgICAgIGNvbnN0IHByaW1hcnlJZFByb3BOYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKSBhcyBzdHJpbmc7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IChnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnc2x1ZycpIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gKGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICduYW1lJykgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG5cbiAgICAgICAgZm9yIChsZXQgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZW50aXR5KSkge1xuXG4gICAgICAgICAgICBpZiAoa2V5ICE9PSBwcmltYXJ5SWRQcm9wTmFtZSkge1xuICAgICAgICAgICAgICAgIC8vIFRPRE86IGhhbmRsZSB3aGVuIGVudGl0eSBoYXMgbXVsdGlwbGUgaWRlbnRpZmllcnNcblxuICAgICAgICAgICAgICAgIGlmIChrZXkudG9VcHBlckNhc2UoKSA9PT0gZW50aXR5TmFtZUF0dHJpYnV0ZSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGAke3ZhbHVlfSAtIENvcHlgO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5LnRvVXBwZXJDYXNlKCkgPT09IGVudGl0eVNsdWdBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBgJHt2YWx1ZX0tY29weWA7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZHVwbGljYXRlRXZlbnREYXRhWyBrZXkgYXMga2V5b2YgdHlwZW9mIGR1cGxpY2F0ZUV2ZW50RGF0YSBdID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZHVwbGljYXRlRXZlbnREYXRhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBkdXBsaWNhdGUgZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBkdXBsaWNhdGUuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGR1cGxpY2F0ZWQgZW50aXR5LlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3QgZW50aXR5SWQgPSB7IGlkOiAxMjMsIG5hbWU6ICdleGFtcGxlJyB9O1xuICAgICAqIGNvbnN0IGR1cGxpY2F0ZWRFbnRpdHkgPSBhd2FpdCBkdXBsaWNhdGUoZW50aXR5SWQpO1xuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnaW5mbycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3dyaXRlJyB9LFxuICAgICAgICBnZXRBdHRyaWJ1dGVzOiAoaW5zdGFuY2U6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IGluc3RhbmNlLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgfSlcbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBkdXBsaWNhdGUoaWQ6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZHVwbGljYXRlRXZlbnREYXRhID0gYXdhaXQgdGhpcy5tYWtlRHVwbGljYXRlRW50aXR5RGF0YShpZCk7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNyZWF0ZShkdXBsaWNhdGVFdmVudERhdGEsIGN0eCk7XG4gICAgfVxuXG4gICAgLy8gVE9ETzogc2hvdWxkIGJlIHBhcnQgb2Ygc29tZSBjb25maWdcbiAgICBwcm90ZWN0ZWQgZGVsaW1pdGVyc1JlZ2V4ID0gLyg/OiZ8IHwsfFxcKykrLztcblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIHF1ZXJ5LlxuICAgICAqIC0gSWYgbm8gc3BlY2lmaWMgYXR0cmlidXRlcyBhcmUgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2YgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAtIElmIGEgc2VhcmNoIHRlcm0gaXMgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5IGl0IHdpbGwgc3BsaXQgdGhlIHNlYXJjaCB0ZXJtIGJ5IGAvKD86JnwgfCx8XFwrKSsvYCBSZWdleCBhbmQgd2lsbCBmaWx0ZXIgb3V0IGVtcHR5IHN0cmluZ3MuXG4gICAgICogLSBJZiBzZWFyY2ggYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIHNlYXJjaGFibGUgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcXVlcnkgLSBUaGUgcXVlcnkgb2JqZWN0IGNvbnRhaW5pbmcgZmlsdGVycywgc2VhcmNoIGtleXdvcmRzLCBhbmQgYXR0cmlidXRlcy5cbiAgICAgKiBAcmV0dXJucyBBIFByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgbGlzdCBvZiBlbnRpdGllcyBhbmQgdGhlIG9yaWdpbmFsIHF1ZXJ5LlxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJyB9LFxuICAgICAgICBnZXRBdHRyaWJ1dGVzOiAoaW5zdGFuY2U6IGFueSwgYXJnczogYW55W10pID0+ICh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBpbnN0YW5jZS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBoYXNGaWx0ZXJzOiAhIWFyZ3NbIDAgXT8uZmlsdGVycyAmJiBPYmplY3Qua2V5cyhhcmdzWyAwIF0uZmlsdGVycykubGVuZ3RoID4gMCxcbiAgICAgICAgfSksXG4gICAgICAgIGdldFJlc3VsdEF0dHJpYnV0ZXM6IChyZXN1bHQ6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIHJlc3VsdENvdW50OiByZXN1bHQ/LmRhdGE/Lmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgaGFzQ3Vyc29yOiAhIXJlc3VsdD8uY3Vyc29yLFxuICAgICAgICB9KVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGxpc3QocXVlcnk6IEVudGl0eVF1ZXJ5PFM+ID0ge30sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgaWYgKCFxdWVyeS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBxdWVyeS5hdHRyaWJ1dGVzID0gdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZm9yIGxpc3RpbmcgQVBJIGF0dHJpYnV0ZXMgd291bGQgYmUgYW4gYXJyYXlcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocXVlcnkuYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHF1ZXJ5LmF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgcXVlcnkuYXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzLnNwbGl0KCcsJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzIHx8IGlzRW1wdHkocXVlcnkuc2VhcmNoQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRmlsdGVyR3JvdXAgPSBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcyhxdWVyeS5zZWFyY2gsIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuZmlsdGVycyA9IGFkZEZpbHRlckdyb3VwVG9FbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPihzZWFyY2hGaWx0ZXJHcm91cCBhcyBhbnksIHF1ZXJ5LmZpbHRlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXMgPSBhd2FpdCBsaXN0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICBlbnRpdGllcy5kYXRhID0gdGhpcy5zZXJpYWxpemVSZWNvcmRzKGVudGl0aWVzLmRhdGEsIHF1ZXJ5LmF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGlmIChxdWVyeS5hdHRyaWJ1dGVzICYmIGVudGl0aWVzLmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMocXVlcnkuYXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF07XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC8vIG9ubHkgYXR0cmlidXRlcyBpbiBoeWRyYXRlIG9wdGlvbnMgdGhhdCBoYXZlIHJlbGF0aW9uIG1ldGFkYXRhIGF0dGFjaGVkIHRvIHRoZW0gbmVlZHMgdG8gYmUgaHlkcmF0ZWRcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXRpZXMuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyAuLi5lbnRpdGllcywgcXVlcnkgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEV4ZWN1dGVzIGEgcXVlcnkgb24gdGhlIGVudGl0eS5cbiAgICAgKiAtIElmIG5vIHNwZWNpZmljIGF0dHJpYnV0ZXMgYXJlIHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogLSBJZiBhIHNlYXJjaCB0ZXJtIGlzIHByb3ZpZGVkIGluIHRoZSBxdWVyeSBpdCB3aWxsIHNwbGl0IHRoZSBzZWFyY2ggdGVybSBieSBgLyg/OiZ8IHwsfFxcKykrL2AgUmVnZXggYW5kIHdpbGwgZmlsdGVyIG91dCBlbXB0eSBzdHJpbmdzLlxuICAgICAqICAgLS0gSWYgc2VhcmNoIGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBzZWFyY2hhYmxlIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogICAtLSBJZiB0aGVyZSBhcmUgYW55IG5vbi1lbXB0eSBzZWFyY2gtdGVybXMsIGl0IHdpbGwgYWRkIGEgZmlsdGVyIGdyb3VwIHRvIHRoZSBxdWVyeSBiYXNlZCBvbiB0aGUgc2VhcmNoIGtleXdvcmRzLlxuICAgICAqIEBwYXJhbSBxdWVyeSAtIFRoZSBlbnRpdHkgcXVlcnkgdG8gZXhlY3V0ZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmVzdWx0IG9mIHRoZSBxdWVyeS5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2RlYnVnJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAncmVhZCcgfSxcbiAgICAgICAgZ2V0QXR0cmlidXRlczogKGluc3RhbmNlOiBhbnksIGFyZ3M6IGFueVtdKSA9PiAoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogaW5zdGFuY2UuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgaGFzRmlsdGVyczogISFhcmdzWyAwIF0/LmZpbHRlcnMgJiYgT2JqZWN0LmtleXMoYXJnc1sgMCBdLmZpbHRlcnMpLmxlbmd0aCA+IDAsXG4gICAgICAgIH0pLFxuICAgICAgICBnZXRSZXN1bHRBdHRyaWJ1dGVzOiAocmVzdWx0OiBhbnkpID0+ICh7XG4gICAgICAgICAgICByZXN1bHRDb3VudDogcmVzdWx0Py5kYXRhPy5sZW5ndGggfHwgMCxcbiAgICAgICAgfSlcbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBxdWVyeShxdWVyeTogRW50aXR5UXVlcnk8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgY29uc3QgeyBhdHRyaWJ1dGVzIH0gPSBxdWVyeTtcblxuICAgICAgICBsZXQgc2VsZWN0QXR0cmlidXRlczogRW50aXR5U2VsZWN0aW9uczxTPiB8IHVuZGVmaW5lZCA9IGF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3RBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgLy8gcGFyc2UgdGhlIGxpc3Qgb2YgZG90LXNlcGFyYXRlZCBhdHRyaWJ1dGUtaWRlbnRpZmllcnMgcGF0aHMgYW5kIGVuc3VyZSBhbGwgdGhlIHJlcXVpcmVkIG1ldGFkYXRhIGlzIHRoZXJlXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhzZWxlY3RBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIHNlbGVjdEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBlbnN1cmUgYWxsIHRoZSBwcm92aWRlZCBzZWxlY3QgYXR0cmlidXRlcyBoYXMgcmVxdWlyZWQgbWV0YWRhdGEgYWxsIHRoZSB3YXkgZG93biB0byB0aGUgbGVhZiBsZXZlbFxuICAgICAgICAgICAgc2VsZWN0QXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBzZWxlY3RBdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlckdyb3VwID0gbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMocXVlcnkuc2VhcmNoLCBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKTtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LmZpbHRlcnMgPSBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4oc2VhcmNoRmlsdGVyR3JvdXAgYXMgYW55LCBxdWVyeS5maWx0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzID0gYXdhaXQgcXVlcnlFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSB0aGlzLnNlcmlhbGl6ZVJlY29yZHMoZW50aXRpZXMuZGF0YSwgc2VsZWN0QXR0cmlidXRlcyk7XG5cbiAgICAgICAgaWYgKHNlbGVjdEF0dHJpYnV0ZXMgJiYgZW50aXRpZXMuZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhzZWxlY3RBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLy8gb25seSBhdHRyaWJ1dGVzIGluIGh5ZHJhdGUgb3B0aW9ucyB0aGF0IGhhdmUgcmVsYXRpb24gbWV0YWRhdGEgYXR0YWNoZWQgdG8gdGhlbSBuZWVkcyB0byBiZSBoeWRyYXRlZFxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdGllcy5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IC4uLmVudGl0aWVzLCBxdWVyeSB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFVwZGF0ZXMgYW4gZW50aXR5IGluIHRoZSBkYXRhYmFzZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0gZGF0YSAtIFRoZSB1cGRhdGVkIGRhdGEgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHBhcmFtIHJlbW92ZSAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gcmVtb3ZlIGZyb20gdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgdXBkYXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdpbmZvJyB9LFxuICAgICAgICBzb3VyY2VUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHRhZ3M6IHsgb3BlcmF0aW9uX2NhdGVnb3J5OiAnd3JpdGUnIH0sXG4gICAgICAgIGdldEF0dHJpYnV0ZXM6IChpbnN0YW5jZTogYW55KSA9PiAoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogaW5zdGFuY2UuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICB9KVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIHVwZGF0ZShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiwgZGF0YTogVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+LCBvcGVyYXRvcnM/OiBVcGRhdGVFbnRpdHlPcGVyYXRvcnMsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgICAgICAvLyBJbmplY3QgYWN0b3IgY29udGV4dFxuICAgICAgICBsZXQgZW5oYW5jZWREYXRhID0gdGhpcy5pbmplY3RBY3RvckNvbnRleHQoZGF0YSBhcyBhbnksICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUsIHJlYWRPbmx5IH0gb2YgdW5pcXVlRmllbGRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJlYWRPbmx5KSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBlbmhhbmNlZERhdGFbIG5hbWUgYXMga2V5b2YgdHlwZW9mIGVuaGFuY2VkRGF0YSBdO1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gZW5oYW5jZWREYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2YWx1ZSA9IGVuaGFuY2VkRGF0YVsgbmFtZSBhcyBrZXlvZiB0eXBlb2YgZW5oYW5jZWREYXRhIF07XG4gICAgICAgICAgICAgICAgICAgIHVuaXF1ZW5lc3NDaGVja3MucHVzaCgoKSA9PiB0aGlzLmNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IGVuaGFuY2VkRGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IG5hbWUhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY2hlY2tSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwodW5pcXVlbmVzc0NoZWNrcy5tYXAoY2hlY2sgPT4gY2hlY2soKSkpO1xuXG4gICAgICAgICAgICBpZiAoY2hlY2tSZXN1bHRzLmluY2x1ZGVzKGZhbHNlKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkc1BhdGggPSB1bmlxdWVGaWVsZHMubWFwKGZpZWxkID0+IGZpZWxkLm5hbWUhKSA/PyBbXTtcblxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IoWyB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IFwiVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciBvbmUgb3IgbW9yZSBmaWVsZHMuXCIsXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHVuaXF1ZUZpZWxkc1BhdGgsXG4gICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkOiBbICd1bmlxdWUnLCB1bmlxdWVGaWVsZHMgXSxcbiAgICAgICAgICAgICAgICB9IF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdXBkYXRlZEVudGl0eSA9IGF3YWl0IHVwZGF0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBkYXRhOiBlbmhhbmNlZERhdGEsXG4gICAgICAgICAgICBvcGVyYXRvcnM6IG9wZXJhdG9ycyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHVwZGF0ZWRFbnRpdHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGRlbGV0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnd2FybicgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ2RlbGV0ZScgfSxcbiAgICAgICAgZ2V0QXR0cmlidXRlczogKGluc3RhbmNlOiBhbnkpID0+ICh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBpbnN0YW5jZS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgIH0pXG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgZGVsZXRlKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBkZWxldGUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGlkZW50aWZpZXJzOmAsIGlkZW50aWZpZXJzKTtcblxuICAgICAgICAgICAgY29uc3QgZGVsZXRlZEVudGl0eSA9IGF3YWl0IGRlbGV0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgICAgICAgICAgYWN0b3I6IGN0eD8uYWN0b3IsXG4gICAgICAgICAgICAgICAgdGVuYW50OiBjdHg/LmFjdG9yPy50ZW5hbnRJZCxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gZGVsZXRlZEVudGl0eTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byBkZWxldGUgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgYmF0Y2ggZGVsZXRpbmcgZW50aXRpZXMuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuaWRlbnRpZmllcnMgLSBBcnJheSBvZiBlbnRpdHkgaWRlbnRpZmllcnMgdG8gZGVsZXRlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIHRvIHBlcmZvcm0gKGRlZmF1bHQ6IDEpLlxuICAgICAqIEBwYXJhbSBjdHggLSBPcHRpb25hbCBleGVjdXRpb24gY29udGV4dCBjb250YWluaW5nIGFjdG9yIGluZm9ybWF0aW9uLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBEZWxldGUgbXVsdGlwbGUgZW50aXRpZXNcbiAgICAgKiBjb25zdCByZXN1bHQgPSBhd2FpdCBzZXJ2aWNlLmJhdGNoRGVsZXRlKHtcbiAgICAgKiAgIGlkZW50aWZpZXJzOiBbXG4gICAgICogICAgIHsgaWQ6ICdpdGVtMScgfSxcbiAgICAgKiAgICAgeyBpZDogJ2l0ZW0yJyB9LFxuICAgICAqICAgICB7IGlkOiAnaXRlbTMnIH1cbiAgICAgKiAgIF0sXG4gICAgICogICBjb25jdXJyZW50OiAyXG4gICAgICogfSk7XG4gICAgICogXG4gICAgICogaWYgKHJlc3VsdC51bnByb2Nlc3NlZC5sZW5ndGggPiAwKSB7XG4gICAgICogICBjb25zb2xlLmxvZygnU29tZSBpdGVtcyB3ZXJlIG5vdCBkZWxldGVkOicsIHJlc3VsdC51bnByb2Nlc3NlZCk7XG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnd2FybicgfSwgLy8gQmF0Y2ggZGVsZXRlcyBhcmUgY3JpdGljYWxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ2RlbGV0ZScsIGJhdGNoOiAndHJ1ZScgfSxcbiAgICAgICAgZ2V0QXR0cmlidXRlczogKGluc3RhbmNlOiBhbnksIGFyZ3M6IGFueVtdKSA9PiAoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogaW5zdGFuY2UuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgYmF0Y2hTaXplOiBhcmdzWyAwIF0/LmlkZW50aWZpZXJzPy5sZW5ndGggfHwgMCxcbiAgICAgICAgICAgIGNvbmN1cnJlbnQ6IGFyZ3NbIDAgXT8uY29uY3VycmVudCB8fCAxLFxuICAgICAgICB9KSxcbiAgICAgICAgZ2V0UmVzdWx0QXR0cmlidXRlczogKHJlc3VsdDogYW55KSA9PiAoe1xuICAgICAgICAgICAgZGVsZXRlZENvdW50OiAocmVzdWx0Py5kYXRhPy5sZW5ndGggfHwgMCksXG4gICAgICAgICAgICB1bnByb2Nlc3NlZENvdW50OiAocmVzdWx0Py51bnByb2Nlc3NlZD8ubGVuZ3RoIHx8IDApLFxuICAgICAgICB9KVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGJhdGNoRGVsZXRlKG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyXG4gICAgfSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gY291bnQ6ICR7aWRlbnRpZmllcnMubGVuZ3RofWAsIHtcbiAgICAgICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGVsZXRlQmF0Y2hFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgICAgIGlkczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgICAgICAgICBhY3RvcjogY3R4Py5hY3RvcixcbiAgICAgICAgICAgICAgICB0ZW5hbnQ6IGN0eD8uYWN0b3I/LnRlbmFudElkLFxuICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBFbGVjdHJvREIgYmF0Y2ggZGVsZXRlIHJldHVybnMgeyB1bnByb2Nlc3NlZDogQXJyYXkgfVxuICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChyZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgICAgY29uc3QgZGF0YUNvdW50ID0gcmVzdWx0LmRhdGE/Lmxlbmd0aDtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcHJvY2Vzc2VkOiAke2lkZW50aWZpZXJzLmxlbmd0aH0sIGRhdGFDb3VudDogJHtkYXRhQ291bnR9LCB1bnByb2Nlc3NlZDogJHt1bnByb2Nlc3NlZENvdW50fWApO1xuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGJhdGNoIGRlbGV0ZSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBlbnRpdGllcyBiYXNlZCBvbiBhIHF1ZXJ5IGZpbHRlci5cbiAgICAgKiBUaGlzIG1ldGhvZCBxdWVyaWVzIGZvciBlbnRpdGllcyBtYXRjaGluZyB0aGUgZmlsdGVyIGFuZCB0aGVuIGJhdGNoIGRlbGV0ZXMgdGhlbS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyBieSBxdWVyeS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5maWx0ZXJzIC0gVGhlIGZpbHRlciBjcml0ZXJpYSB0byBtYXRjaCBlbnRpdGllcyBmb3IgZGVsZXRpb24uXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBkZWxldGUgaW4gZWFjaCBiYXRjaCAoZGVmYXVsdDogMjUpLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBOdW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhJdGVtcyAtIE9wdGlvbmFsIG1heGltdW0gbnVtYmVyIG9mIGl0ZW1zIHRvIGRlbGV0ZSAoc2FmZXR5IGxpbWl0KS5cbiAgICAgKiBAcGFyYW0gY3R4IC0gT3B0aW9uYWwgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvcm1hdGlvbi5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3Qgd2l0aCBkZWxldGlvbiBzdGF0aXN0aWNzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIERlbGV0ZSBhbGwgaW5hY3RpdmUgdXNlcnNcbiAgICAgKiBjb25zdCByZXN1bHQgPSBhd2FpdCB1c2VyU2VydmljZS5kZWxldGVCeVF1ZXJ5KHtcbiAgICAgKiAgIGZpbHRlcnM6IHtcbiAgICAgKiAgICAgc3RhdHVzOiB7IGVxOiAnaW5hY3RpdmUnIH0sXG4gICAgICogICAgIGxhc3RMb2dpbkF0OiB7IGx0OiAnMjAyMy0wMS0wMScgfVxuICAgICAqICAgfSxcbiAgICAgKiAgIGJhdGNoU2l6ZTogNTAsXG4gICAgICogICBtYXhJdGVtczogMTAwMFxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIGNvbnNvbGUubG9nKGBEZWxldGVkICR7cmVzdWx0LmRlbGV0ZWRDb3VudH0gaXRlbXMsICR7cmVzdWx0LmZhaWxlZENvdW50fSBmYWlsZWRgKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ3dhcm4nIH0sIC8vIEJ1bGsgZGVsZXRlcyBhcmUgZGFuZ2Vyb3VzXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdkZWxldGUnLCBiYXRjaDogJ3RydWUnLCBidWxrOiAndHJ1ZScgfSxcbiAgICAgICAgZ2V0QXR0cmlidXRlczogKGluc3RhbmNlOiBhbnksIGFyZ3M6IGFueVtdKSA9PiAoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogaW5zdGFuY2UuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgYmF0Y2hTaXplOiBhcmdzWyAwIF0/LmJhdGNoU2l6ZSB8fCAyNSxcbiAgICAgICAgICAgIG1heEl0ZW1zOiBhcmdzWyAwIF0/Lm1heEl0ZW1zLFxuICAgICAgICAgICAgaGFzRmlsdGVyczogISEoYXJnc1sgMCBdPy5maWx0ZXJzICYmIE9iamVjdC5rZXlzKGFyZ3NbIDAgXS5maWx0ZXJzKS5sZW5ndGggPiAwKSxcbiAgICAgICAgfSksXG4gICAgICAgIGdldFJlc3VsdEF0dHJpYnV0ZXM6IChyZXN1bHQ6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIGRlbGV0ZWRDb3VudDogcmVzdWx0Py5kZWxldGVkQ291bnQgfHwgMCxcbiAgICAgICAgICAgIGZhaWxlZENvdW50OiByZXN1bHQ/LmZhaWxlZENvdW50IHx8IDAsXG4gICAgICAgICAgICB0b3RhbFByb2Nlc3NlZDogcmVzdWx0Py50b3RhbFByb2Nlc3NlZCB8fCAwLFxuICAgICAgICB9KVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGRlbGV0ZUJ5UXVlcnkob3B0aW9uczoge1xuICAgICAgICBmaWx0ZXJzOiBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPixcbiAgICAgICAgYmF0Y2hTaXplPzogbnVtYmVyLFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyLFxuICAgICAgICBtYXhJdGVtcz86IG51bWJlclxuICAgIH0sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHsgZmlsdGVycywgYmF0Y2hTaXplID0gMjUsIGNvbmN1cnJlbnQgPSAxLCBtYXhJdGVtcyB9ID0gb3B0aW9ucztcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ2FsbGVkIH4gZGVsZXRlQnlRdWVyeSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgYmF0Y2hTaXplLFxuICAgICAgICAgICAgICAgIG1heEl0ZW1zXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gU2FmZXR5IGNoZWNrOiByZXF1aXJlIGZpbHRlcnMgdG8gcHJldmVudCBhY2NpZGVudGFsIGRlbGV0aW9uIG9mIGFsbCByZWNvcmRzXG4gICAgICAgICAgICBpZiAoIWZpbHRlcnMgfHwgaXNFbXB0eU9iamVjdERlZXAoZmlsdGVycykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2RlbGV0ZUJ5UXVlcnkgcmVxdWlyZXMgZmlsdGVycyB0byBwcmV2ZW50IGFjY2lkZW50YWwgZGVsZXRpb24gb2YgYWxsIHJlY29yZHMuIFVzZSBzY2FuIHdpdGggZXhwbGljaXQgY29uZmlybWF0aW9uIGlmIHlvdSBuZWVkIHRvIGRlbGV0ZSBhbGwgcmVjb3Jkcy4nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IGRlbGV0ZWRDb3VudCA9IDA7XG4gICAgICAgICAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgICAgICAgICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICAgICAgICBsZXQgdG90YWxQcm9jZXNzZWQgPSAwO1xuXG4gICAgICAgICAgICAvLyBRdWVyeSBhbmQgZGVsZXRlIGluIGJhdGNoZXNcbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgICAvLyBGZXRjaCBhIGJhdGNoIG9mIGl0ZW1zIHRvIGRlbGV0ZVxuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeSh7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvdW50OiBiYXRjaFNpemUsXG4gICAgICAgICAgICAgICAgICAgICAgICBjdXJzb3I6IGN1cnNvciB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcmRlcjogJ2FzYycsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYWdlcjogJ2N1cnNvcidcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sIGN0eCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpdGVtc1RvRGVsZXRlID0gcXVlcnlSZXN1bHQuZGF0YTtcblxuICAgICAgICAgICAgICAgIGlmICghaXRlbXNUb0RlbGV0ZSB8fCBpdGVtc1RvRGVsZXRlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRGVsZXRpbmcgYmF0Y2ggb2YgJHtpdGVtc1RvRGVsZXRlLmxlbmd0aH0gaXRlbXNgKTtcblxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZnJvbSB0aGUgZmV0Y2hlZCBpdGVtc1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzID0gaXRlbXNUb0RlbGV0ZS5tYXAoaXRlbSA9PlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhpdGVtIGFzIGFueSlcbiAgICAgICAgICAgICAgICApIGFzIEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+O1xuXG4gICAgICAgICAgICAgICAgLy8gQmF0Y2ggZGVsZXRlIHRoZSBpdGVtc1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZVJlc3VsdCA9IGF3YWl0IHRoaXMuYmF0Y2hEZWxldGUoe1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICAgICAgICAgIH0sIGN0eCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB1bnByb2Nlc3NlZENvdW50ID0gKGRlbGV0ZVJlc3VsdCBhcyBhbnkpPy51bnByb2Nlc3NlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgICAgICAgY29uc3QgZGF0YUNvdW50ID0gZGVsZXRlUmVzdWx0LmRhdGE/Lmxlbmd0aDtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaERlbGV0ZWRDb3VudCA9IGlkZW50aWZpZXJzLmxlbmd0aCAtIHVucHJvY2Vzc2VkQ291bnQ7XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50ICs9IGJhdGNoRGVsZXRlZENvdW50O1xuICAgICAgICAgICAgICAgIGZhaWxlZENvdW50ICs9IHVucHJvY2Vzc2VkQ291bnQ7XG4gICAgICAgICAgICAgICAgdG90YWxQcm9jZXNzZWQgKz0gaXRlbXNUb0RlbGV0ZS5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQmF0Y2ggcmVzdWx0OiAke2JhdGNoRGVsZXRlZENvdW50fSBkZWxldGVkLCAke3VucHJvY2Vzc2VkQ291bnR9IGZhaWxlZGApO1xuXG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UndmUgaGl0IHRoZSBtYXggaXRlbXMgbGltaXRcbiAgICAgICAgICAgICAgICBpZiAobWF4SXRlbXMgJiYgdG90YWxQcm9jZXNzZWQgPj0gbWF4SXRlbXMpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmVhY2hlZCBtYXhJdGVtcyBsaW1pdCBvZiAke21heEl0ZW1zfSwgc3RvcHBpbmcgZGVsZXRpb25gKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIGN1cnNvciBmb3IgbmV4dCBpdGVyYXRpb25cbiAgICAgICAgICAgICAgICBjdXJzb3IgPSBxdWVyeVJlc3VsdC5jdXJzb3IgfHwgbnVsbDtcblxuICAgICAgICAgICAgfSB3aGlsZSAoY3Vyc29yKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIH4gZGVsZXRlQnlRdWVyeSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gZGVsZXRlZDogJHtkZWxldGVkQ291bnR9LCBmYWlsZWQ6ICR7ZmFpbGVkQ291bnR9YCk7XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50LFxuICAgICAgICAgICAgICAgIGZhaWxlZENvdW50LFxuICAgICAgICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gZGVsZXRlIGJ5IHF1ZXJ5IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTpgLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSBieSBxdWVyeSBmb3IgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlYnVpbGRzIGFsbCBpbmRleGVzIGZvciB0aGUgZW50aXR5IGJ5IHdyaXRpbmcgdG8gdGhlIHByaW1hcnkgaW5kZXguXG4gICAgICogVGhpcyBtZXRob2QgaXMgdXNlZnVsIGZvciBtYWludGFpbmluZyBkYXRhIGludGVncml0eSBhbmQgZW5zdXJpbmcgaW5kZXhlcyBhcmUgcHJvcGVybHkgdXBkYXRlZC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIE9wdGlvbnMgZm9yIHJlYnVpbGRpbmcgdGhlIGluZGV4XG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBwcm9jZXNzIGluIGVhY2ggYmF0Y2guIERlZmF1bHRzIHRvIDEwMC5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBpbmRleCByZWJ1aWxkIGlzIGNvbXBsZXRlLlxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnd2FybicgfSwgLy8gSW5kZXggcmVidWlsZHMgYXJlIGNyaXRpY2FsIG9wZXJhdGlvbnNcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ21haW50ZW5hbmNlJywgYmF0Y2g6ICd0cnVlJyB9LFxuICAgICAgICBnZXRBdHRyaWJ1dGVzOiAoaW5zdGFuY2U6IGFueSwgYXJnczogYW55W10pID0+ICh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBpbnN0YW5jZS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBiYXRjaFNpemU6IGFyZ3NbIDAgXT8uYmF0Y2hTaXplIHx8IDEwMCxcbiAgICAgICAgfSksXG4gICAgICAgIGdldFJlc3VsdEF0dHJpYnV0ZXM6ICgpID0+ICh7XG4gICAgICAgICAgICBjb21wbGV0ZWQ6IHRydWUsXG4gICAgICAgIH0pXG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgcmVidWlsZEluZGV4KG9wdGlvbnM6IHsgYmF0Y2hTaXplPzogbnVtYmVyIH0gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBiYXRjaFNpemUgPSAxMDAgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gdGhpcy5nZXRFbnRpdHlOYW1lKCk7XG4gICAgICAgICAgICBjb25zdCByZXBvc2l0b3J5ID0gdGhpcy5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFN0YXJ0aW5nIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuXG4gICAgICAgICAgICAvLyBHZXQgYWxsIHJlY29yZHMgZnJvbSB0aGUgcHJpbWFyeSBpbmRleFxuICAgICAgICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IGF3YWl0IHJlcG9zaXRvcnkuc2Nhbi5nbygpO1xuXG4gICAgICAgICAgICBpZiAoIWFsbFJlY29yZHMuZGF0YSB8fCBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gcmVjb3JkcyBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCAke2FsbFJlY29yZHMuZGF0YS5sZW5ndGh9IHJlY29yZHMgdG8gcHJvY2VzcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaGVzXG4gICAgICAgICAgICBjb25zdCB0b3RhbFJlY29yZHMgPSBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3QgdG90YWxCYXRjaGVzID0gTWF0aC5jZWlsKHRvdGFsUmVjb3JkcyAvIGJhdGNoU2l6ZSk7XG5cbiAgICAgICAgICAgIGZvciAobGV0IGJhdGNoSW5kZXggPSAwOyBiYXRjaEluZGV4IDwgdG90YWxCYXRjaGVzOyBiYXRjaEluZGV4KyspIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IGJhdGNoSW5kZXggKiBiYXRjaFNpemU7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyBiYXRjaFNpemUsIHRvdGFsUmVjb3Jkcyk7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2ggPSBhbGxSZWNvcmRzLmRhdGEuc2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGJhdGNoICR7YmF0Y2hJbmRleCArIDF9LyR7dG90YWxCYXRjaGVzfSAoJHtzdGFydCArIDF9LSR7ZW5kfSBvZiAke3RvdGFsUmVjb3Jkc30gcmVjb3JkcylgKTtcblxuICAgICAgICAgICAgICAgIC8vIFJlYnVpbGQgYWxsIGluZGV4ZXMgYnkgdXBzZXJ0aW5nIGVhY2ggcmVjb3JkIHRvIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSB1cHNlcnQgdG8gZW5zdXJlIHRoZSByZWNvcmQgaXMgcHJvcGVybHkgaW5kZXhlZFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVwb3NpdG9yeS51cHNlcnQocmVjb3JkKS5nbygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVjb3JkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbmZlcnMgcmVsYXRpb25zaGlwcyBiZXR3ZWVuIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBzY2hlbWEgYW5kIHNlbGVjdGlvbi1wYXRocy5cbiAgICAgKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBwYXRocyBUaGUgcGFyc2VkIHNlbGVjdGlvbiBwYXRocyBmcm9tIGUuZy4gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocygpLlxuICAgICAqIEBwYXJhbSBwYXRoS2V5IFRoZSBjdXJyZW50IFwicGF0aFwiIHN0cmluZyByZXByZXNlbnRpbmcgaG93IHdlIGFycml2ZWQgaGVyZSAoZGVmYXVsdHMgdG8gdGhlIGVudGl0eSBuYW1lKS5cbiAgICAgKiBAcGFyYW0gdmlzaXRlZFBhdGhzIEEgc2V0IG9mIHBhdGgtc3RyaW5ncyB2aXNpdGVkIHNvIGZhciBpbiB0aGlzIHJlY3Vyc2lvbiBjaGFpbiAocHJldmVudHMgY3ljbGVzKS5cbiAgICAgKiBAcGFyYW0gbWF4RGVwdGggTWF4aW11bSByZWN1cnNpb24gZGVwdGggKG9wdGlvbmFsKS5cbiAgICAgKi9cbiAgICBpbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgICAgICBzY2hlbWE6IEUsXG4gICAgICAgIHBhdGhzOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyxcbiAgICAgICAgcGF0aEtleTogc3RyaW5nID0gc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgdmlzaXRlZFBhdGhzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQ8c3RyaW5nPigpLFxuICAgICAgICBtYXhEZXB0aCA9IDVcbiAgICApOiBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPiB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ2luZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMnLCB7IHBhdGhLZXksIHBhdGhzIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGV4Y2VlZCBtYXggZGVwdGgsIHdlIHNraXAgZXhwYW5zaW9uc1xuICAgICAgICBpZiAobWF4RGVwdGggPD0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTWF4IHJlY3Vyc2lvbiBkZXB0aCByZWFjaGVkIGF0IHBhdGhLZXk9XCIke3BhdGhLZXl9XCJgKTtcbiAgICAgICAgICAgIHJldHVybiB7fSBhcyBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZmVycmVkOiBhbnkgPSB7fTtcblxuICAgICAgICAvLyBMb29wIG92ZXIgZWFjaCBhdHRyaWJ1dGUgaW4gdGhlIGVudGl0eSBzY2hlbWFcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpLmZvckVhY2goKFsgYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlTWV0YSBdKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhdHRWYWwgPSBwYXRoc1sgYXR0cmlidXRlTmFtZSBdO1xuICAgICAgICAgICAgaWYgKCFhdHRWYWwpIHtcbiAgICAgICAgICAgICAgICAvLyBOb3Qgc2VsZWN0ZWQgaW4gdGhlIHVzZXIncyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpc1JlbGF0aW9uYWwgPSAhIWF0dHJpYnV0ZU1ldGEucmVsYXRpb247XG5cbiAgICAgICAgICAgIC8vIElmIHRoZSBhdHRyaWJ1dGUgaXMgbm90IHJlbGF0aW9uYWwgb3IgdGhlIHZhbHVlIGlzIGEgYm9vbGVhbiwgd2UgY2FuIGluZmVyIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGlmICghaXNSZWxhdGlvbmFsIHx8IGlzQm9vbGVhbihhdHRWYWwpKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dFZhbDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEl0J3MgYSByZWxhdGlvbmFsIGF0dHJpYnV0ZTsgcHJlcGFyZSB0byByZWN1cnNlXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbk1ldGEgPSBhdHRyaWJ1dGVNZXRhLnJlbGF0aW9uITtcbiAgICAgICAgICAgIGNvbnN0IG5leHRFbnRpdHlOYW1lID0gcmVsYXRpb25NZXRhLmVudGl0eU5hbWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgbmV3IFwicGF0aFwiIHN0cmluZyB0byBkZXRlY3QgY3ljbGVzIChlLmcuIFwiVXNlci5ncm91cHMuR3JvdXAubWVtYmVycy5Vc2VyXCIpXG4gICAgICAgICAgICBjb25zdCBuZXdQYXRoID0gYCR7cGF0aEtleX0uJHthdHRyaWJ1dGVOYW1lfS4ke25leHRFbnRpdHlOYW1lfWA7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGFscmVhZHkgdmlzaXRlZCB0aGlzIHBhdGgsIGlmIHNvID0+IHNraXAgZXhwYW5zaW9ucyBmb3IgdGhpcyBhdHRyaWJ1dGUgb25seVxuICAgICAgICAgICAgaWYgKHZpc2l0ZWRQYXRocy5oYXMobmV3UGF0aCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTa2lwcGluZyBjeWMgcmVsYXRpb24gZXhwYW5zaW9ucyBmb3I6ICR7bmV3UGF0aH1gKTtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2tpcHBlZER1ZVRvQ3ljbGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIE1hcmsgdGhpcyBwYXRoIGFzIHZpc2l0ZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5hZGQobmV3UGF0aCk7XG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gdGhlIHJlbGF0ZWQgZW50aXR5J3Mgc2NoZW1hXG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihuZXh0RW50aXR5TmFtZSk7XG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgdGhlIFwibWV0YVwiIG9iamVjdCB0aGF0IHdlIHN0b3JlXG4gICAgICAgICAgICBjb25zdCBtZXRhOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24gPSB7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcmVsYXRpb25UeXBlOiByZWxhdGlvbk1ldGEudHlwZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaXNGdW5jdGlvbihyZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgICAgID8gcmVsYXRpb25NZXRhLmlkZW50aWZpZXJzKClcbiAgICAgICAgICAgICAgICAgICAgOiByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlczoge30sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgcGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBpc09iamVjdChhdHRWYWwpID8gYXR0VmFsLmF0dHJpYnV0ZXMgOiB1bmRlZmluZWQ7IC8vIHByb3ZpZGVkIGJ5IHRoZSB1c2VyIFxuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRpb25NZXRhLmF0dHJpYnV0ZXM7IC8vIGRlZmluZWQgaW4gdGhlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcyA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTsgLy8gYXV0byBnZW4gYnkgZnJhbWV3b3JrXG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gZXhwYW5kIGNoaWxkJ3MgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgbWV0YS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgKHBhdGhTZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0aW9uU2VsZWN0aW9uQXR0cmlidXRlcyB8fCByZWxhdGVkRW50aXR5RGVmYXVsdFNlbGVjdGlvbkF0dHJpYnV0ZXMpIGFzIGFueSxcbiAgICAgICAgICAgICAgICBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICB2aXNpdGVkUGF0aHMsXG4gICAgICAgICAgICAgICAgbWF4RGVwdGggLSAxXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gbWV0YTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHRoaXMgcGF0aCBzbyBzaWJsaW5ncyBjYW4gYWxzbyBleHBhbmQgaXQgaWYgbmVlZGVkXG4gICAgICAgICAgICB2aXNpdGVkUGF0aHMuZGVsZXRlKG5ld1BhdGgpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gaW5mZXJyZWQ7XG4gICAgfVxuXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3JlYWQnLCBzZWFyY2g6ICd0cnVlJyB9LFxuICAgICAgICBnZXRBdHRyaWJ1dGVzOiAoaW5zdGFuY2U6IGFueSwgYXJnczogYW55W10pID0+ICh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBpbnN0YW5jZS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBoYXNRdWVyeTogISFhcmdzWyAwIF0/LnEsXG4gICAgICAgICAgICBoYXNGaWx0ZXJzOiAhIShhcmdzWyAwIF0/LmZpbHRlciAmJiBPYmplY3Qua2V5cyhhcmdzWyAwIF0uZmlsdGVyKS5sZW5ndGggPiAwKSxcbiAgICAgICAgfSksXG4gICAgICAgIGdldFJlc3VsdEF0dHJpYnV0ZXM6IChyZXN1bHQ6IGFueSkgPT4gKHtcbiAgICAgICAgICAgIGhpdENvdW50OiByZXN1bHQ/LmhpdHM/Lmxlbmd0aCB8fCAwLFxuICAgICAgICAgICAgdG90YWxIaXRzOiByZXN1bHQ/LmVzdGltYXRlZFRvdGFsSGl0cyB8fCAwLFxuICAgICAgICB9KVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIHNlYXJjaChxdWVyeTogRW50aXR5U2VhcmNoUXVlcnk8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXF1ZXJ5LnNlbGVjdCkge1xuICAgICAgICAgICAgLy8gKiBOb3RlOiB3ZSBleHBlY3QgYW4gYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzXG4gICAgICAgICAgICBxdWVyeS5zZWxlY3QgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpIGFzIGFueTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2VhcmNoU2VydmljZS5zZWFyY2gocXVlcnksIHVuZGVmaW5lZCwgY3R4KTtcbiAgICB9XG59XG5cbmNvbnN0IGVudGl0eUF0dHJpYnV0ZUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZScpO1xuXG5leHBvcnQgZnVuY3Rpb24gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShhdHRJZDogc3RyaW5nLCBhdHQ6IEVudGl0eUF0dHJpYnV0ZSk6IFBhcnRpYWw8RW50aXR5QXR0cmlidXRlPiAmIHtcbiAgICBpZDogc3RyaW5nLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW11cbn0ge1xuXG4gICAgY29uc3QgeyBuYW1lLCB2YWxpZGF0aW9ucywgcmVxdWlyZWQsIHJlbGF0aW9uLCBkZWZhdWx0OiBkZWZhdWx0VmFsdWUsIGdldDogX2dldHRlciwgc2V0OiBfc2V0dGVyLCB3YXRjaCwgLi4ucmVzdE1ldGEgfSA9IGF0dDtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUsIC4uLnJlc3RSZWxhdGlvbiB9ID0gcmVsYXRpb24gfHwge307XG5cbiAgICBjb25zdCByZWxhdGlvbk1ldGEgPSByZWxhdGVkRW50aXR5TmFtZSA/IHsgLi4ucmVzdFJlbGF0aW9uLCBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSB9IDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3QgeyBpdGVtcywgdHlwZSwgcHJvcGVydGllcywgYWRkTmV3T3B0aW9uLCBhZGROZXdPcHRpb25Db25maWcsIGZpZWxkVHlwZTogZXhwbGljaXRGaWVsZFR5cGUsIG9wdGlvbnMsIC4uLnJlc3RSZXN0TWV0YSB9ID0gcmVzdE1ldGEgYXMgYW55O1xuXG4gICAgLy8gSW5mZXIgZmllbGRUeXBlIGZyb20gdHlwZSBpZiBub3QgZXhwbGljaXRseSBwcm92aWRlZFxuICAgIGxldCBpbmZlcnJlZEZpZWxkVHlwZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gZXhwbGljaXRGaWVsZFR5cGU7XG4gICAgaWYgKCFpbmZlcnJlZEZpZWxkVHlwZSAmJiB0eXBlKSB7XG4gICAgICAgIGlmICh0eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2Jvb2xlYW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdudW1iZXInO1xuICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodHlwZSkpIHtcbiAgICAgICAgICAgIC8vIEVudW0gdHlwZSBsaWtlIFsnYWN0aXZlJywgJ2luYWN0aXZlJ11cbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ3NlbGVjdCc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycgJiYgb3B0aW9ucyAmJiBBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmIG9wdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gU3RyaW5nIHdpdGggb3B0aW9ucyBpcyBhIHNlbGVjdFxuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnc2VsZWN0JztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnYW55Jykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnanNvbic7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ21hcCc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdsaXN0JztcbiAgICAgICAgfVxuICAgICAgICAvLyBGb3IgZGF0ZSBmaWVsZHMsIGNoZWNrIGF0dHJpYnV0ZSBuYW1lIGFzIGhpbnRcbiAgICAgICAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGNvbnN0IGxvd2VyQXR0SWQgPSBhdHRJZC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgaWYgKGxvd2VyQXR0SWQuaW5jbHVkZXMoJ2RhdGUnKSB8fCBsb3dlckF0dElkID09PSAnY3JlYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAndXBkYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAnZGVsZXRlZGF0Jykge1xuICAgICAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2RhdGV0aW1lJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci5kZWJ1ZyhgaW5mZXJyZWRGaWVsZFR5cGU6ICR7aW5mZXJyZWRGaWVsZFR5cGV9IGZvciBlbnRpdHkgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cImApO1xuICAgIH1cblxuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi5yZXN0UmVzdE1ldGEsXG4gICAgICAgIHR5cGUsXG4gICAgICAgIGlkOiBhdHRJZCxcbiAgICAgICAgbmFtZTogbmFtZSB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKGF0dElkKSxcbiAgICAgICAgcmVsYXRpb246IHJlbGF0aW9uTWV0YSBhcyBhbnksXG4gICAgICAgIGRlZmF1bHRWYWx1ZSxcbiAgICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25zIHx8IHJlcXVpcmVkID8gWyAncmVxdWlyZWQnIF0gOiBbXSxcbiAgICAgICAgaXNWaXNpYmxlOiAhKCdpc1Zpc2libGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzVmlzaWJsZSxcbiAgICAgICAgaXNFZGl0YWJsZTogISgnaXNFZGl0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNFZGl0YWJsZSxcbiAgICAgICAgaXNMaXN0YWJsZTogISgnaXNMaXN0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNMaXN0YWJsZSxcbiAgICAgICAgaXNDcmVhdGFibGU6ICEoJ2lzQ3JlYXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0NyZWF0YWJsZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiAhKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzRmlsdGVyYWJsZSxcbiAgICAgICAgaXNTZWFyY2hhYmxlOiAhKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzU2VhcmNoYWJsZSxcbiAgICB9XG5cbiAgICAvLyBBZGQgaW5mZXJyZWQgb3IgZXhwbGljaXQgZmllbGRUeXBlXG4gICAgaWYgKGluZmVycmVkRmllbGRUeXBlKSB7XG4gICAgICAgIGZvcm1hdHRlZC5maWVsZFR5cGUgPSBpbmZlcnJlZEZpZWxkVHlwZTtcbiAgICB9IGVsc2UgaWYgKCFleHBsaWNpdEZpZWxkVHlwZSAmJiB0eXBlICYmIHR5cGUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIExvZyB3YXJuaW5nIGZvciBub24tc3RyaW5nIHR5cGVzIHdlIGNvdWxkbid0IGluZmVyXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci53YXJuKGDimqDvuI8gQ291bGQgbm90IGluZmVyIGZpZWxkVHlwZSBmb3IgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cIi4gQ29uc2lkZXIgYWRkaW5nIGV4cGxpY2l0IGZpZWxkVHlwZS5gKTtcbiAgICB9XG5cbiAgICAvLyBBZGQgb3B0aW9ucyBiYWNrIGlmIHRoZXkgZXhpc3RcbiAgICBpZiAob3B0aW9ucykge1xuICAgICAgICBmb3JtYXR0ZWQub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgfVxuXG4gICAgLy8gUGFzcyB0aHJvdWdoIGJvdGggb2xkIGFuZCBuZXcgYWRkTmV3T3B0aW9uIGZvcm1hdHNcbiAgICBpZiAoYWRkTmV3T3B0aW9uQ29uZmlnKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IGFkZE5ld09wdGlvbkNvbmZpZztcbiAgICB9XG4gICAgaWYgKGFkZE5ld09wdGlvbikge1xuICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb24nIF0gPSBhZGROZXdPcHRpb247XG4gICAgfVxuXG4gICAgLy9cbiAgICAvLyAqKiBtYWtlIHN1cmUgdG8gbm90IG92ZXJyaWRlIHRoZSBpbm5lciBmaWVsZHMgb2YgYXR0cmlidXRlcyBsaWtlIGBsaXN0LVtpdGVtc10tW21hcF0tcHJvcGVydGllc2AgKipcbiAgICAvL1xuICAgIGlmICh0eXBlID09PSAnbWFwJykge1xuICAgICAgICBmb3JtYXR0ZWRbICdwcm9wZXJ0aWVzJyBdID0gT2JqZWN0LmVudHJpZXM8YW55Pihwcm9wZXJ0aWVzKS5tYXAoKFsgaywgdiBdKSA9PiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGssIHYpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdsaXN0JyAmJiBpdGVtcy50eXBlID09PSAnbWFwJykge1xuICAgICAgICBmb3JtYXR0ZWRbICdpdGVtcycgXSA9IHtcbiAgICAgICAgICAgIC4uLml0ZW1zLFxuICAgICAgICAgICAgcHJvcGVydGllczogT2JqZWN0LmVudHJpZXM8YW55PihpdGVtcy5wcm9wZXJ0aWVzKS5tYXAoKFsgaywgdiBdKSA9PiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGssIHYpKVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IGZvciBzZXQsIGVudW0sIGFuZCBjdXN0b20tdHlwZXNcblxuICAgIHJldHVybiBmb3JtYXR0ZWRcbn1cblxuZXhwb3J0IHR5cGUgVElPU2NoZW1hQXR0cmlidXRlID0gUmV0dXJuVHlwZTx0eXBlb2YgZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZT47XG5leHBvcnQgdHlwZSBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gTWFwPGtleW9mIFNbICdhdHRyaWJ1dGVzJyBdLCBUSU9TY2hlbWFBdHRyaWJ1dGU+O1xuXG4vKipcbiAqIENyZWF0ZXMgYW4gYWNjZXNzIHBhdHRlcm5zIHNjaGVtYSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgZW50aXR5IHNjaGVtYS5cbiAqIEBwYXJhbSBzY2hlbWEgVGhlIGVudGl0eSBzY2hlbWEuXG4gKiBAcmV0dXJucyBBIG1hcCBvZiBhY2Nlc3MgcGF0dGVybnMsIHdoZXJlIHRoZSBrZXlzIGFyZSB0aGUgaW5kZXggbmFtZXMgYW5kIHRoZSB2YWx1ZXMgYXJlIG1hcHMgb2YgYXR0cmlidXRlIG5hbWVzIGFuZCB0aGVpciBjb3JyZXNwb25kaW5nIHNjaGVtYSBhdHRyaWJ1dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHNjaGVtYTogUykge1xuICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbmV3IE1hcDxrZXlvZiBTWyAnaW5kZXhlcycgXSwgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPj4oKTtcblxuICAgIGZvciAoY29uc3QgaW5kZXhOYW1lIGluIHNjaGVtYS5pbmRleGVzKSB7XG4gICAgICAgIGNvbnN0IGluZGV4QXR0cmlidXRlczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPiA9IG5ldyBNYXAoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGlkeFBrQXR0IG9mIHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXS5way5jb21wb3NpdGUpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBpZHhQa0F0dCBdO1xuICAgICAgICAgICAgaW5kZXhBdHRyaWJ1dGVzLnNldChpZHhQa0F0dCwge1xuICAgICAgICAgICAgICAgIC4uLmVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaWR4UGtBdHQsIHsgLi4uYXR0LCByZXF1aXJlZDogdHJ1ZSB9KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IGlkeFNrQXR0IG9mIHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXS5zaz8uY29tcG9zaXRlID8/IFtdKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgaWR4U2tBdHQgXTtcbiAgICAgICAgICAgIGluZGV4QXR0cmlidXRlcy5zZXQoaWR4U2tBdHQsIHtcbiAgICAgICAgICAgICAgICAuLi5lbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGlkeFNrQXR0LCB7IC4uLmF0dCwgcmVxdWlyZWQ6IHRydWUgfSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgYWNjZXNzUGF0dGVybnMuc2V0KGluZGV4TmFtZSwgaW5kZXhBdHRyaWJ1dGVzKTtcbiAgICB9XG5cbiAgICAvLyBtYWtlIHN1cmUgdGhlcmUncyBhIHByaW1hcnkgYWNjZXNzIHBhdHRlcm47XG4gICAgaWYgKCFhY2Nlc3NQYXR0ZXJucy5oYXMoJ3ByaW1hcnknKSkge1xuICAgICAgICBhY2Nlc3NQYXR0ZXJucy5zZXQoJ3ByaW1hcnknLCBhY2Nlc3NQYXR0ZXJucy52YWx1ZXMoKS5uZXh0KCkudmFsdWUhKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYWNjZXNzUGF0dGVybnM7XG59XG4iXX0=