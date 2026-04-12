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
const display_override_resolve_1 = require("./display-override-resolve");
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
        // Inject actorTimestamp for staleness detection in audit logs
        const actorWithTimestamp = {
            ...actor,
            actorTimestamp: Date.now(), // Milliseconds since epoch for easy comparison
        };
        // Clean actor object by removing undefined values (DynamoDB doesn't allow them)
        const cleanActor = Object.fromEntries(Object.entries(actorWithTimestamp).filter(([_, value]) => value !== undefined));
        enhancedData._actor = cleanActor;
        return enhancedData;
    }
    /**
     * Creates a new entity.
     *
     * @param payload - Top-level JSON `null` values are stripped before persistence: optional fields are left unset
     *   (see `createEntity` / `partitionTopLevelJsonNulls` in `mutation-utils`), not passed as null to ElectroDB.
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
                    // Skip when optional unique field is cleared (null) — createEntity will omit it; no uniqueness query for null.
                    if (value === null || value === undefined) {
                        continue;
                    }
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
        return {
            ...entity,
            data: entity.data ? this.decompressFields(entity.data) : entity.data
        };
    }
    /**
     * Creates-OR-Updates an entity.
     * NOTE:
     *   - This method does not check for uniqueness of the attributes, neither create the slug automatically.
     *   - It's the responsibility of the caller to ensure the read ony attributes are not provided if the record is being upsert.
     *   - Top-level JSON `null` values are stripped from the payload before upsert (same as create; use PATCH to clear attrs on existing rows).
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
     * @param data - Patch payload. Top-level JSON `null` values are treated as merge-patch “clear”:
     *   they become DynamoDB attribute removals (see `updateEntity` / `partitionTopLevelJsonNulls` in `mutation-utils`),
     *   not literal nulls passed to ElectroDB `set()`.
     * @param operators - Optional ElectroDB patch operators; `operators.remove` merges with JSON `null` keys.
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
                    // Skip when clearing optional unique field — updateEntity maps null → remove; no eq-null uniqueness check.
                    if (value === null || value === undefined) {
                        continue;
                    }
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
        return {
            ...updatedEntity,
            data: updatedEntity.data ? this.decompressFields(updatedEntity.data) : updatedEntity.data
        };
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
    /**
     * **Opt-in** — CRUD payloads are unchanged. Merged value for `fieldPath` (stored column + override map).
     * Uses `model.displayOverrides.storageAttribute` on **this** schema. For another entity’s row, use
     * `readStoredValueAtPath` + `resolveWithDisplayOverrides`.
     * Return type is `unknown` (JSON); narrow or assert for your DTO (e.g. string URL fields are strings at runtime).
     */
    resolveFieldWithDisplayOverrides(record, fieldPath, options) {
        const overrideMap = this.getDisplayOverrideMap(record);
        return (0, display_override_resolve_1.resolveWithDisplayOverrides)({
            storedValue: (0, display_override_resolve_1.readStoredValueAtPath)(record, fieldPath),
            overrideMap,
            fieldPath,
            channel: options?.channel,
        }).resolvedValue;
    }
    /**
     * **Opt-in** — CRUD payloads are unchanged. Resolves multiple fields from a row using
     * this entity schema's `model.displayOverrides.storageAttribute`.
     */
    resolveFieldsWithDisplayOverrides(record, fields, options) {
        const overrideMap = this.getDisplayOverrideMap(record);
        const resolved = {};
        for (const fieldPath of fields) {
            resolved[fieldPath] = (0, display_override_resolve_1.resolveWithDisplayOverrides)({
                storedValue: (0, display_override_resolve_1.readStoredValueAtPath)(record, fieldPath),
                overrideMap,
                fieldPath,
                channel: options?.channel,
            }).resolvedValue;
        }
        return resolved;
    }
    getDisplayOverrideMap(record) {
        const ui = this.schema.model.displayOverrides;
        return ui?.storageAttribute
            ? record[ui.storageAttribute]
            : undefined;
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
            // Only infer datetime for fields that are ACTUALLY dates, not just contain "date" in the name
            // Exclude: calendarDate (YYYY-MM-DD format), updatedBy/createdBy (user IDs), etc.
            if ((lowerAttId.endsWith('at') && (lowerAttId.includes('date') || lowerAttId.includes('time'))) ||
                lowerAttId === 'createdat' || lowerAttId === 'updatedat' || lowerAttId === 'deletedat' ||
                lowerAttId === 'scheduledat' || lowerAttId === 'publishedat' || lowerAttId === 'expiresat') {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBb0NBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQXl4RUQsZ0ZBcUdDO0FBVUQsd0VBNkJDO0FBcitFRCw4QkFBb0M7QUFNcEMseUVBRTJDO0FBRTNDLHdDQUEwQztBQUMxQyxpREFBNEU7QUFFNUUsbUVBQWdFO0FBQ2hFLHlEQUFtRTtBQUNuRSxvQ0FBaVE7QUFDalEsK0NBQXNEO0FBQ3RELGlEQUFpUztBQUNqUyx1RUFBa0U7QUFDbEUseUVBQWdHO0FBRWhHLHFDQUFnRTtBQUNoRSxtQ0FBNEg7QUFDNUgsc0NBQTZEO0FBWTdELFNBQWdCLFlBQVksQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQ25GLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxTQUFnQixtQkFBbUIsQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQzFGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUUsYUFBYSxDQUFFLENBQUM7SUFDckQsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsS0FBSyxJQUFJLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFDMUYsT0FBTyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssU0FBUyxDQUFDO0FBQzFELENBQUM7QUFFRCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFtQyxFQUFFLElBQTBCO0lBRTlGLElBQUksY0FBYyxHQUFHLFNBQVMsSUFBQSxrQkFBVSxFQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7SUFDMUQsSUFBSSxjQUFjLElBQUks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YXRpb24gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gXCIuLi9kaVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlJbnB1dFZhbGlkYXRpb25zLCBFbnRpdHlWYWxpZGF0aW9ucyB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSwgRW50aXR5QXR0cmlidXRlLCBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hLCBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYSwgRW50aXR5VHlwZUZyb21TY2hlbWEgYXMgRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEsIEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHksIEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbiwgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHksIFJlbGF0aW9uSWRlbnRpZmllciwgU3BlY2lhbEF0dHJpYnV0ZVR5cGUsIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlGaWx0ZXJDcml0ZXJpYSwgRW50aXR5UXVlcnksIEVudGl0eVNlbGVjdGlvbnMsIFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcblxuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tIFwiLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHtcbiAgICBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCxcbn0gZnJvbSBcIi4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHsgRGVwSWRlbnRpZmllciwgSURJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBCYXNlU2VhcmNoU2VydmljZSwgRW50aXR5U2VhcmNoU2VydmljZSB9IGZyb20gJy4uL3NlYXJjaC9zZXJ2aWNlcyc7XG5pbXBvcnQgeyBFbnRpdHlTZWFyY2hRdWVyeSwgU2VhcmNoUmVzdWx0IH0gZnJvbSAnLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IE9ic2VydmVkIH0gZnJvbSBcIi4uL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy9vYnNlcnZlZFwiO1xuaW1wb3J0IHsgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaC9zZWFyY2gtdXRpbHMnO1xuaW1wb3J0IHsgSnNvblNlcmlhbGl6ZXIsIGdldFZhbHVlQnlQYXRoLCBpc0FycmF5LCBpc0Jvb2xlYW4sIGlzQ2xhc3NDb25zdHJ1Y3RvciwgaXNFbXB0eSwgaXNFbXB0eU9iamVjdERlZXAsIGlzRnVuY3Rpb24sIGlzT2JqZWN0LCBpc1N0cmluZywgcGFzY2FsQ2FzZSwgcGlja0tleXMsIHRvSHVtYW5SZWFkYWJsZU5hbWUsIHRvU2x1ZywgY29tcHJlc3NJZk5lZWRlZCwgZGVjb21wcmVzc0l0ZW0sIGlzQ29tcHJlc3NlZCB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgY3JlYXRlRWxlY3Ryb0RCRW50aXR5IH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IFVwZGF0ZUVudGl0eU9wZXJhdG9ycywgVXBkYXRlRW50aXR5UmVzcG9uc2UsIENyZWF0ZUVudGl0eVJlc3BvbnNlLCBHZXRFbnRpdHlSZXNwb25zZSwgRGVsZXRlRW50aXR5UmVzcG9uc2UsIFVwc2VydEVudGl0eVJlc3BvbnNlLCBjcmVhdGVFbnRpdHksIGRlbGV0ZUVudGl0eSwgZGVsZXRlQmF0Y2hFbnRpdHksIGdldEJhdGNoRW50aXR5LCBnZXRFbnRpdHksIGxpc3RFbnRpdHksIHF1ZXJ5RW50aXR5LCB1cGRhdGVFbnRpdHksIHVwc2VydEVudGl0eSB9IGZyb20gXCIuL2NydWQtc2VydmljZVwiO1xuaW1wb3J0IHsgRW50aXR5U2NoZW1hVmFsaWRhdG9yIH0gZnJvbSBcIi4vZW50aXR5LXNjaGVtYS12YWxpZGF0b3JcIjtcbmltcG9ydCB7IHJlYWRTdG9yZWRWYWx1ZUF0UGF0aCwgcmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzIH0gZnJvbSBcIi4vZGlzcGxheS1vdmVycmlkZS1yZXNvbHZlXCI7XG5pbXBvcnQgdHlwZSB7IERpc3BsYXlPdmVycmlkZVN0b3JhZ2UgfSBmcm9tIFwiLi9kaXNwbGF5LW92ZXJyaWRlLXR5cGVzXCI7XG5pbXBvcnQgeyBEYXRhYmFzZUVycm9yLCBFbnRpdHlWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuL2Vycm9ycyc7XG5pbXBvcnQgeyBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWEsIG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzLCBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSBcIi4vcXVlcnlcIjtcbmltcG9ydCB7IEludGVybmFsU2VydmVyRXJyb3IsIFNlcnZlckVycm9yIH0gZnJvbSBcIi4uL2Vycm9yc1wiO1xuXG5leHBvcnQgdHlwZSBFeHRyYWN0RW50aXR5SWRlbnRpZmllcnNDb250ZXh0ID0ge1xuICAgIC8vIHRlbmFudElkOiBzdHJpbmcsIFxuICAgIGZvckFjY2Vzc1BhdHRlcm4/OiBzdHJpbmdcbn1cblxudHlwZSBHZXRPcHRpb25zPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0ge1xuICAgIGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sXG4gICAgYXR0cmlidXRlcz86IEVudGl0eVNlbGVjdGlvbnM8Uz5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhhc0F0dHJpYnV0ZShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiwgYXR0cmlidXRlTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIChhdHRyaWJ1dGVOYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGF0dHJpYnV0ZSA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHRyaWJ1dGVOYW1lIF07XG4gICAgcmV0dXJuICEhKGF0dHJpYnV0ZSAmJiBhdHRyaWJ1dGUucmVhZE9ubHkgPT09IHRydWUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzQXR0cmlidXRlQnkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIHNwZWM6IFNwZWNpYWxBdHRyaWJ1dGVUeXBlKSB7XG4gICAgcmV0dXJuIGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsIHNwZWMpICE9PSB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIHNwZWM6IFNwZWNpYWxBdHRyaWJ1dGVUeXBlKSB7XG5cbiAgICBsZXQgc3BlY0F0dE1ldGFLZXkgPSBgZW50aXR5JHtwYXNjYWxDYXNlKHNwZWMpfUF0dHJpYnV0ZWA7XG4gICAgaWYgKHNwZWNBdHRNZXRhS2V5IGluIHNjaGVtYS5tb2RlbCkge1xuICAgICAgICByZXR1cm4gc2NoZW1hLm1vZGVsWyBzcGVjQXR0TWV0YUtleSBhcyBrZXlvZiB0eXBlb2Ygc2NoZW1hLm1vZGVsIF0gYXMgc3RyaW5nO1xuICAgIH1cblxuICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCBgJHtzY2hlbWEubW9kZWwuZW50aXR5fSR7cGFzY2FsQ2FzZShzcGVjKX1gKSkge1xuICAgICAgICByZXR1cm4gYCR7c2NoZW1hLm1vZGVsLmVudGl0eX0ke3Bhc2NhbENhc2Uoc3BlYyl9YDtcbiAgICB9XG5cbiAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgc3BlYykpIHtcbiAgICAgICAgcmV0dXJuIHNwZWM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VFbnRpdHlTZXJ2aWNlPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IHtcblxuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihgQmFzZUVudGl0eVNlcnZpY2U6JHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG5cbiAgICBwcm90ZWN0ZWQgZW50aXR5UmVwb3NpdG9yeT86IEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICBwcm90ZWN0ZWQgZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hPzogUmV0dXJuVHlwZTx0eXBlb2YgdGhpcy5tYWtlT3BzRGVmYXVsdElPU2NoZW1hPFM+PjtcblxuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICByZWFkb25seSBzY2hlbWE6IFMsXG4gICAgICAgIHByb3RlY3RlZCByZWFkb25seSBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvbixcbiAgICAgICAgcHJvdGVjdGVkIHJlYWRvbmx5IGRpQ29udGFpbmVyOiBJRElDb250YWluZXIgPSBESUNvbnRhaW5lci5ST09ULFxuICAgICkgeyB9XG5cbiAgICBwcm90ZWN0ZWQgZ2V0VGFibGVOYW1lKCk6IHN0cmluZyB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlDb25maWd1cmF0aW9ucy50YWJsZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEludGVybmFsU2VydmVyRXJyb3IoYFRhYmxlIG5hbWUgaXMgcmVxdWlyZWQgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlDb25maWd1cmF0aW9ucy50YWJsZTtcbiAgICB9XG5cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlTZWFyY2hDb25maWcoX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQ8YW55Pikge1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gc2NoZW1hLm1vZGVsLnNlYXJjaCB8fCB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgaW5kZXhDb25maWc6IHt9XG4gICAgICAgIH07XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLnNlcnZpY2VDbGFzcyA9IHNlYXJjaENvbmZpZy5zZXJ2aWNlQ2xhc3MgfHwgRW50aXR5U2VhcmNoU2VydmljZTtcblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZy5pbmRleENvbmZpZykge1xuICAgICAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuaW5kZXhOYW1lID0gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLmluZGV4TmFtZSB8fCBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHNjaGVtYS5tb2RlbC5lbnRpdHksXG4gICAgICAgICAgICB0YWJsZU5hbWU6IHRoaXMuZ2V0VGFibGVOYW1lKCksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5wcmltYXJ5S2V5ID0gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnByaW1hcnlLZXkgfHwgdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgICAgICBjb25zdCBlbnRpdHlTZWFyY2hhYmxlQXR0cmlidXRlcyA9IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzID0gdGhpcy5nZXRGaWx0ZXJhYmxlQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3MgPSB7XG4gICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzIHx8IHt9KSxcbiAgICAgICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uc2VhcmNoYWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5U2VhcmNoYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uZmlsdGVyYWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHNvcnRhYmxlQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3M/LnNvcnRhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNlYXJjaENvbmZpZztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgaWYgc2VhcmNoIGlzIGVuYWJsZWQgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVHJ1ZSBpZiBzZWFyY2ggaXMgZW5hYmxlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIHB1YmxpYyBpc1NlYXJjaEVuYWJsZWQoKSB7XG4gICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCk7XG4gICAgICAgIHJldHVybiBCb29sZWFuKHNlYXJjaENvbmZpZz8uZW5hYmxlZCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgc2VhcmNoIHNlcnZpY2UgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIHNlYXJjaCBzZXJ2aWNlLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRTZWFyY2hTZXJ2aWNlKCk6IEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcblxuICAgICAgICAgICAgLy8gU2tpcCBzZWFyY2ggbG9naWMgaWYgc2VhcmNoIGlzIG5vdCBlbmFibGVkXG4gICAgICAgICAgICBpZiAoIXNlYXJjaENvbmZpZz8uZW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX0uYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIHNlYXJjaCBjb25maWd1cmF0aW9uIGlmIHByZXNlbnRcbiAgICAgICAgICAgIGlmIChzZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlU2VhcmNoQ29uZmlnKHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgPSBzZWFyY2hDb25maWc/LnNlcnZpY2VDbGFzcztcblxuICAgICAgICAgICAgLy8gQ2FzZSAxOiBESSBDb250YWluZXIgaGFzIHRoZSBzZXJ2aWNlXG4gICAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyAmJiB0aGlzLmRpQ29udGFpbmVyLmhhcyhzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGFzIERlcElkZW50aWZpZXI8RW50aXR5U2VhcmNoU2VydmljZTxhbnk+PikpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlPEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4+KHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPFM+Pik7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byByZXNvbHZlIHNlYXJjaCBzZXJ2aWNlIGZyb20gY29udGFpbmVyOicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlc29sdmUgc2VhcmNoIHNlcnZpY2UgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhc2UgMjogU2VydmljZSBpbnN0YW5jZSBwcm92aWRlZFxuICAgICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgaW5zdGFuY2VvZiBCYXNlU2VhcmNoU2VydmljZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYXNlIDM6IFNlcnZpY2UgY2xhc3MgcHJvdmlkZWRcbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBpc0NsYXNzQ29uc3RydWN0b3Ioc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcykgJiZcbiAgICAgICAgICAgICAgICAoXG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgPT09IEVudGl0eVNlYXJjaFNlcnZpY2VcbiAgICAgICAgICAgICAgICAgICAgfHxcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBFbnRpdHlTZWFyY2hTZXJ2aWNlXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETzogYWRkIHN1cHBvcnQgdG8gY29uZmlndXJlIHRoaXMgd2l0aG91dCBuZWVkaW5nIHRvIHVzZSB0aGUgRElcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRW5naW5lID0gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlU2VhcmNoRW5naW5lKCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc2VhcmNoRW5naW5lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBlbmdpbmUgbm90IGZvdW5kIGluIGNvbnRhaW5lcicpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgdHlwZW9mIEVudGl0eVNlYXJjaFNlcnZpY2UpKFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlYXJjaEVuZ2luZSxcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGluc3RhbnRpYXRlIHNlYXJjaCBzZXJ2aWNlOicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBzZWFyY2ggc2VydmljZSBpbnN0YW5jZSBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB2YWxpZCBzZWFyY2gtc2VydmljZS1jb25maWd1cmF0aW9uIGZvdW5kIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3IgaW4gZ2V0U2VhcmNoU2VydmljZTonLCBlcnIpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBpbml0aWFsaXphdGlvbiBmYWlsZWQgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgdmFsaWRhdGVTZWFyY2hDb25maWcoc2VhcmNoQ29uZmlnOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT5bICdtb2RlbCcgXVsgJ3NlYXJjaCcgXSkge1xuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZy5pbmRleENvbmZpZykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBtdXN0IGluY2x1ZGUgYSBjb25maWcgb2JqZWN0Jyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGluZGV4Q29uZmlnOiBjb25maWcgfSA9IHNlYXJjaENvbmZpZztcblxuICAgICAgICBpZiAoIWNvbmZpZy5pbmRleE5hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gbXVzdCBzcGVjaWZ5IGFuIGluZGV4TmFtZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgc2VhcmNoYWJsZSBhdHRyaWJ1dGVzIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29uZmlnLnNldHRpbmdzPy5zZWFyY2hhYmxlQXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBjb25maWcuc2V0dGluZ3Muc2VhcmNoYWJsZUF0dHJpYnV0ZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIChhdHRyOiBzdHJpbmcpID0+ICFoYXNBdHRyaWJ1dGUodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgYXR0cilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzZWFyY2hhYmxlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbGlkYXRlIGZpbHRlcmFibGUgYXR0cmlidXRlcyBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbmZpZy5zZXR0aW5ncz8uZmlsdGVyYWJsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gY29uZmlnLnNldHRpbmdzLmZpbHRlcmFibGVBdHRyaWJ1dGVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICAoYXR0cjogc3RyaW5nKSA9PiAhaGFzQXR0cmlidXRlKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIGF0dHIpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzOiAke2ludmFsaWRBdHRyaWJ1dGVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgdHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHk6IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+KTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgY29uc3QgdHJhbnNmb3JtZWQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5KTtcblxuICAgICAgICBpZiAoIXRyYW5zZm9ybWVkWyAnaWQnIF0pIHtcbiAgICAgICAgICAgIC8vIG1ha2Ugc3VyZSB0aGVyZSdzIGFuIGlkIGF0dHJpYnV0ZVxuICAgICAgICAgICAgY29uc3QgcHJpbWFyeUlkTmFtZSA9IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG4gICAgICAgICAgICB0cmFuc2Zvcm1lZFsgJ2lkJyBdID0gZW50aXR5WyBwcmltYXJ5SWROYW1lIGFzIGFueSBdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVkO1xuICAgIH1cblxuICAgIHB1YmxpYyB2YWxpZGF0ZUVudGl0eVNjaGVtYSgpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IEVudGl0eVNjaGVtYVZhbGlkYXRvcih0aGlzLmRpQ29udGFpbmVyKTtcbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKFxuICAgICAgICAgICAgdGhpcy5nZXRFbnRpdHlTY2hlbWEoKSxcbiAgICAgICAgICAgIHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBnZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNlcnZpY2U8QmFzZUVudGl0eVNlcnZpY2U8VD4+KHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2VydmljZShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgZ2V0RW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNjaGVtYTxUPihyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2NoZW1hKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRyYWN0cyBlbnRpdHkgaWRlbnRpZmllcnMgZnJvbSB0aGUgaW5wdXQgb2JqZWN0IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBjb250ZXh0IHRvIGZ1bGZpbGwgYW4gaW5kZXguXG4gICAgICogZS5nLiBlbnRpdHlJZCwgdGVuYW50SWQsIHBhcnRpdGlvbi1rZXlzLi4uLiBldGNcbiAgICAgKiBpdCBpcyB1c2VkIGJ5IHRoZSBgQmFzZUVudGl0eVNlcnZpY2VgIHRvIGZpbmQgdGhlIHJpZ2h0IGVudGl0eSBmb3IgYGdldGAvYHVwZGF0ZWAvYGRlbGV0ZWAgb3BlcmF0aW9uc1xuICAgICAqIFxuICAgICAqIEB0ZW1wbGF0ZSBTIC0gVGhlIHR5cGUgb2YgdGhlIGVudGl0eSBzY2hlbWEuXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGlucHV0IG9iamVjdCBmcm9tIHdoaWNoIHRvIGV4dHJhY3QgdGhlIGlkZW50aWZpZXJzLlxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGNvbnRhaW5pbmcgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiBmb3IgZXh0cmFjdGlvbi5cbiAgICAgKiBAcGFyYW0gY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuIC0gVGhlIGFjY2VzcyBwYXR0ZXJuIGZvciB3aGljaCB0byBleHRyYWN0IHRoZSBpZGVudGlmaWVycy5cbiAgICAgKiBAcmV0dXJucyBUaGUgZXh0cmFjdGVkIGVudGl0eSBpZGVudGlmaWVycy5cbiAgICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGlucHV0IGlzIG1pc3Npbmcgb3Igbm90IGFuIG9iamVjdC5cbiAgICAgKiBcbiAgICAgKiBlLmcuIFxuICAgICAqIElOICAgPT0+IGBSZXF1ZXN0YCBvYmplY3Qgd2l0aCBoZWFkZXJzLCBib2R5LCBhdXRoLWNvbnRleHQgZXRjXG4gICAgICogT1VUICA9PT4geyB0ZW5hbnRJZDogeHh4LCBlbWFpbDogeHh4QHl5eS5jb20sIHNvbWUtcGFydGl0aW9uLWtleTogeHgteXktenogfVxuICAgICAqXG4gICAgICovXG4gICAgZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKFxuICAgICAgICBpbnB1dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIHN0cmluZz4+LFxuICAgICAgICBjb250ZXh0OiBFeHRyYWN0RW50aXR5SWRlbnRpZmllcnNDb250ZXh0ID0ge1xuICAgICAgICAgICAgLy8gdGVuYW50SWQ6ICd4eHgteXl5LXp6eidcbiAgICAgICAgfVxuICAgICk6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiB7XG5cbiAgICAgICAgaWYgKCFpbnB1dCB8fCB0eXBlb2YgaW5wdXQgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lucHV0IGlzIHJlcXVpcmVkIGFuZCBtdXN0IGJlIGFuIG9iamVjdCBjb250YWluaW5nIGVudGl0eS1pZGVudGlmaWVycyBvciBhbiBhcnJheSBvZiBvYmplY3RzIGNvbnRhaW5pbmcgZW50aXR5LWlkZW50aWZpZXJzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpc0JhdGNoSW5wdXQgPSBpc0FycmF5KGlucHV0KTtcblxuICAgICAgICBjb25zdCBpbnB1dHMgPSBpc0JhdGNoSW5wdXQgPyBpbnB1dCA6IFsgaW5wdXQgXTtcblxuICAgICAgICAvLyBUT0RPOiB0ZW5hbnQgbG9naWNcbiAgICAgICAgLy8gaWRlbnRpZmllcnNbJ3RlbmFudElkJ10gPSBpbnB1dC50ZW5hbnRJZCB8fCBjb250ZXh0LnRlbmFudElkO1xuXG4gICAgICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJBdHRyaWJ1dGVzID0gbmV3IFNldDx7IG5hbWU6IHN0cmluZywgcmVxdWlyZWQ6IGJvb2xlYW4gfT4oKTtcbiAgICAgICAgZm9yIChjb25zdCBbIGFjY2Vzc1BhdHRlcm5OYW1lLCBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcyBdIG9mIGFjY2Vzc1BhdHRlcm5zKSB7XG4gICAgICAgICAgICBpZiAoIWNvbnRleHQuZm9yQWNjZXNzUGF0dGVybiB8fCBhY2Nlc3NQYXR0ZXJuTmFtZSA9PSBjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4pIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBhdHQgXSBvZiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyQXR0cmlidXRlcy5hZGQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYXR0LmlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IGF0dC5yZXF1aXJlZCA9PSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByaW1hcnlBdHROYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgICAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaW5wdXRzLm1hcChpbnB1dCA9PiB7XG4gICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogYW55ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZTogYXR0TmFtZSwgcmVxdWlyZWQgfSBvZiBpZGVudGlmaWVyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmICgoYXR0TmFtZSBpbiBpbnB1dCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnNbIGF0dE5hbWUgXSA9IGlucHV0WyBhdHROYW1lIF07XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChhdHROYW1lID09IHByaW1hcnlBdHROYW1lICYmICgnaWQnIGluIGlucHV0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyc1sgYXR0TmFtZSBdID0gaW5wdXQuaWQ7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXF1aXJlZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGByZXF1aXJlZCBhdHRyaWJ1dGU6ICR7YXR0TmFtZX0gZm9yIGFjY2Vzcy1wYXR0ZXJuOiAke2NvbnRleHQuZm9yQWNjZXNzUGF0dGVybiA/PyAnLS1wcmltYXJ5LS0nfSBpcyBub3QgZm91bmQgaW4gaW5wdXQ6YCwgaW5wdXQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpZGVudGlmaWVycyBhcyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+O1xuICAgICAgICB9XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0V4dHJhY3RpbmcgaWRlbnRpZmllcnMgZnJvbSBpZGVudGlmaWVyczonLCBpZGVudGlmaWVyc0JhdGNoKTtcblxuICAgICAgICByZXR1cm4gaXNCYXRjaElucHV0ID8gaWRlbnRpZmllcnNCYXRjaCA6IGlkZW50aWZpZXJzQmF0Y2hbIDAgXTtcbiAgICB9O1xuXG4gICAgcHVibGljIGdldEVudGl0eU5hbWUoKTogU1sgJ21vZGVsJyBdWyAnZW50aXR5JyBdIHsgcmV0dXJuIHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkubW9kZWwuZW50aXR5OyB9XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5U2NoZW1hKCk6IFMgeyByZXR1cm4gdGhpcy5zY2hlbWE7IH1cblxuICAgIHB1YmxpYyBnZXRSZXBvc2l0b3J5KCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5UmVwb3NpdG9yeSkge1xuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHkgfSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgICAgICAgICAgICAgc2NoZW1hOiB0aGlzLmdldEVudGl0eVNjaGVtYSgpLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5UmVwb3NpdG9yeSA9IGVudGl0eSBhcyBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWE8Uz47XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlSZXBvc2l0b3J5ITtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGVudGl0eSB2YWxpZGF0aW9uczsgb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIHlvdXIgb3duIHZhbGlkYXRpb25zXG4gICAgICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGVudGl0eSB2YWxpZGF0aW9ucy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RW50aXR5VmFsaWRhdGlvbnMoKTogRW50aXR5VmFsaWRhdGlvbnM8Uz4gfCBFbnRpdHlJbnB1dFZhbGlkYXRpb25zPFM+IHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGN1c3RvbSB2YWxpZGF0aW9uLWVycm9yLW1lc3NhZ2VzOyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgeW91ciBvd24gZXJyb3ItbWVzc2FnZXMuXG4gICAgICogQHJldHVybnMgQSBtYXAgY29udGFpbmluZyB0aGUgY3VzdG9tIHZhbGlkYXRpb24tZXJyb3ItbWVzc2FnZXMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0c1xuICAgICAqICBwdWJsaWMgYXN5bmMgZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgICAqICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSggbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oIFxuICAgICAqICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHsgXG4gICAgICogICAgICAgICAgICAgICd2YWxpZGF0aW9uLmVtYWlsLnJlcXVpcmVkJzogJ0VtYWlsIGlzIHJlcXVpcmVkISEhISEnLCBcbiAgICAgKiAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24ucGFzc3dvcmQucmVxdWlyZWQnOiAnUGFzc3dvcmQgaXMgcmVxdWlyZWQhISEhISdcbiAgICAgKiAgICAgICAgICB9KVxuICAgICAqICAgICAgKSk7XG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBnZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpIHtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBpZiAoYXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhdHROYW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvKipcbiAqIEdlbmVyYXRlcyB0aGUgZGVmYXVsdCBpbnB1dCBhbmQgb3V0cHV0IHNjaGVtYXMgZm9yIHZhcmlvdXMgb3BlcmF0aW9ucyBvZiBhbiBlbnRpdHkuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHMgLSBUaGUgdHlwZSBvZiBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgVGhlIGRlZmF1bHQgaW5wdXQgYW5kIG91dHB1dCBzY2hlbWFzIGZvciB0aGUgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbiAgICBwcm90ZWN0ZWQgbWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxcbiAgICAgICAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBPcHM+LFxuICAgICAgICBPcHMgZXh0ZW5kcyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgPihzY2hlbWE6IFMpIHtcblxuICAgICAgICBjb25zdCBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICAgICBjcmVhdGU6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICAgICAgdXBkYXRlOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzID0ge1xuICAgICAgICAgICAgZGV0YWlsOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgICAgIGxpc3Q6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIGNyZWF0ZSBhbmQgdXBkYXRlXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuXG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkQXR0ID0gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShhdHROYW1lLCBhdHQpO1xuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmhpZGRlbikge1xuICAgICAgICAgICAgICAgIC8vIGlmIGl0J3MgbWFya2VkIGFzIGhpZGRlbiBpdCdzIG5vdCB2aXNpYmxlIHRvIGFueSBvcFxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzVmlzaWJsZSB8fCBmb3JtYXR0ZWRBdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzTGlzdGFibGUgfHwgZm9ybWF0dGVkQXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMubGlzdC5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNDcmVhdGFibGUpIHtcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc0VkaXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLnVwZGF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYShzY2hlbWEpO1xuXG4gICAgICAgIC8vIGlmIHRoZXJlJ3MgYW4gaW5kZXggbmFtZWQgYHByaW1hcnlgLCB1c2UgdGhhdCwgZWxzZSBmYWxsYmFjayB0byBmaXJzdCBpbmRleFxuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZGVsZXRlJ10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuXG5cbiAgICAgICAgLy8gZm9yKGNvbnN0IGFwIG9mIGFjY2Vzc1BhdHRlcm5zLmtleXMoKSl7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGdldF8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gXHRhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1tgZGVsZXRlXyR7YXB9YF0gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoYXApO1xuICAgICAgICAvLyB9XG5cbiAgICAgICAgLy8gY29uc3QgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzOiBhbnkgPSB7fTtcdFxuICAgICAgICAvLyBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddID0ge1xuICAgICAgICAvLyBcdCdpZGVudGlmaWVycyc6IGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzWydnZXQnXSxcbiAgICAgICAgLy8gXHQnZGF0YSc6IGlucHV0U2NoZW1hQXR0cmlidXRlc1snY3JlYXRlJ10sXG4gICAgICAgIC8vIH1cbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ3VwZGF0ZSddLFxuICAgICAgICAvLyB9XG5cbiAgICAgICAgY29uc3QgZGVmYXVsdEFjY2Vzc1BhdHRlcm4gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKTtcblxuICAgICAgICAvLyBUT0RPOiBhZGQgc2NoZW1hIGZvciB0aGUgcmVzdCBmbyB0aGUgc2Vjb25kYXJ5IGFjY2Vzcy1wYXR0ZXJuc1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBnZXQ6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCwgLy8gZGVmYXVsdCBmb3IgdGhlIGRldGFpbCBwYWdlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZHVwbGljYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlbGV0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVyblxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNyZWF0ZToge1xuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB1cGRhdGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgaW5wdXQ6IGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUsXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsaXN0OiB7XG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3QsXG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBpbnB1dC9vdXRwdXQgc2NoZW1hIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAgICAgKiBcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRPcHNEZWZhdWx0SU9TY2hlbWEoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWEpIHtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hID0gdGhpcy5tYWtlT3BzRGVmYXVsdElPU2NoZW1hPFM+KHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuIFVzZWQgYnkgdGhlIGBkZXRhaWxgIEFQSSB0byBzZXJpYWxpemUgdGhlIGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gQW4gYXJyYXkgb2YgZGVmYXVsdCBzZXJpYWxpemF0aW9uIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmdldC5vdXRwdXQ7XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlczogYW55ID0ge307XG4gICAgICAgIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmZvckVhY2goKF8sIGtleSkgPT4ge1xuICAgICAgICAgICAgLy8gaWYgKCF2YWwucmVsYXRpb24gfHwgdmFsLnJlbGF0aW9uLmh5ZHJhdGUpIHtcbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgIGF0dHJpYnV0ZXNbIGtleSBdID0gdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcyBhcyBFbnRpdHlTZWxlY3Rpb25zPFM+O1xuXG4gICAgICAgIC8vICByZXR1cm4gQXJyYXkuZnJvbSggZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAua2V5cygpICkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGF0dHJpYnV0ZSBuYW1lcyBmb3IgbGlzdGluZyBhbmQgc2VhcmNoIEFQSS4gRGVmYXVsdHMgdG8gdGhlIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCk6IEVudGl0eVNlbGVjdGlvbnM8Uz4ge1xuICAgICAgICBjb25zdCBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcCA9IHRoaXMuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkubGlzdC5vdXRwdXQ7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaC5cbiAgICAgKiBJbmNsdWRlcyBzdHJpbmcgZmllbGRzIGFuZCBlbnVtIGZpZWxkcyB3aXRoIHN0cmluZyB2YWx1ZXMuXG4gICAgICogRXhjbHVkZXMgaWRlbnRpZmllcnMsIGhpZGRlbiBmaWVsZHMsIGRhdGUvZGF0ZXRpbWUgZmllbGRzLCByZWxhdGlvbnMsIGFuZCBzZWxlY3QgZmllbGRzIGJ5IGRlZmF1bHQuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaFxuICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG5cbiAgICAgICAgICAgIC8vIFNraXAgaWYgaGlkZGVuLCBpZGVudGlmaWVyLCBvciBleHBsaWNpdGx5IG5vdCBzZWFyY2hhYmxlXG4gICAgICAgICAgICBpZiAoYXR0LmhpZGRlbiB8fCBhdHQuaXNJZGVudGlmaWVyIHx8IGF0dC5pc1NlYXJjaGFibGUgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGF0dHJUeXBlID0gYXR0LnR5cGU7XG4gICAgICAgICAgICBjb25zdCBmaWVsZFR5cGUgPSBhdHQuZmllbGRUeXBlO1xuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIGRhdGUvZGF0ZXRpbWUgZmllbGRzICh0aGV5J3JlIGZvciBmaWx0ZXJpbmcsIG5vdCB0ZXh0IHNlYXJjaClcbiAgICAgICAgICAgIGlmIChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhjbHVkZSBkYXRlLWxpa2UgZmllbGQgbmFtZXMgKGNyZWF0ZWRBdCwgcHVibGlzaGVkRGF0ZSwgZXRjLilcbiAgICAgICAgICAgIGNvbnN0IGxvd2VyTmFtZSA9IGF0dE5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIGlmIChhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgKGxvd2VyTmFtZS5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygndGltZScpKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeGNsdWRlIHJlbGF0aW9uIGZpZWxkcyAodGhleSdyZSBJRHMsIG5vdCBzZWFyY2hhYmxlIHRleHQpXG4gICAgICAgICAgICBpZiAoJ3JlbGF0aW9uJyBpbiBhdHQgJiYgYXR0LnJlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4Y2x1ZGUgc2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkcyB3aXRoIG9wdGlvbnMgKHRoZXkncmUgZm9yIGZpbHRlcmluZywgbm90IGZ1bGwtdGV4dCBzZWFyY2gpXG4gICAgICAgICAgICBpZiAoKGZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSAmJlxuICAgICAgICAgICAgICAgICdvcHRpb25zJyBpbiBhdHQgJiYgYXR0Lm9wdGlvbnMpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSW5jbHVkZSBzZWFyY2hhYmxlIHRleHQtYmFzZWQgZmllbGQgdHlwZXNcbiAgICAgICAgICAgIGNvbnN0IGlzU2VhcmNoYWJsZVR5cGUgPSAoXG4gICAgICAgICAgICAgICAgLy8gU3RyaW5nIGZpZWxkcyAocHJpbWFyeSBzZWFyY2hhYmxlIHR5cGUpXG4gICAgICAgICAgICAgICAgKHR5cGVvZiBhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgYXR0clR5cGUgPT09ICdzdHJpbmcnKSB8fFxuXG4gICAgICAgICAgICAgICAgLy8gRW51bSBmaWVsZHMgY2FuIGJlIHNlYXJjaGVkIGJ5IHRoZWlyIHN0cmluZyB2YWx1ZXNcbiAgICAgICAgICAgICAgICAoQXJyYXkuaXNBcnJheShhdHRyVHlwZSkgJiYgYXR0clR5cGUubGVuZ3RoID4gMCAmJiBhdHRyVHlwZS5ldmVyeSh2ID0+IHR5cGVvZiB2ID09PSAnc3RyaW5nJykpXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBJbmNsdWRlIGlmIHNlYXJjaGFibGUgYnkgZGVmYXVsdCAoaXNTZWFyY2hhYmxlIG5vdCBleHBsaWNpdGx5IHNldCkgb3IgZXhwbGljaXRseSBlbmFibGVkXG4gICAgICAgICAgICBpZiAoaXNTZWFyY2hhYmxlVHlwZSAmJiAoISgnaXNTZWFyY2hhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc1NlYXJjaGFibGUpKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZXMucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lcztcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIHVuaXF1ZSBhdHRyaWJ1dGVzIG9mIHRoZSBlbnRpdHkuIFxuICAgICAqIERlZmF1bHRzIHRvIGFsbCBhdHRyaWJ1dGVzIHdoaWNoIGFyZSBtYXJrZWQgYXMgdW5pcXVlIG9yIGFyZSBpZGVudGlmaWVyczsgXG4gICAgICogT3IgaWYgdGhleSBhcmUgcGFydCBvZiBhIGNvbXBvc2l0ZSBwcmltYXJ5IGtleSB3aGVyZSB0aGUgY29tcG9zaXRlIGxlbmd0aCBpcyAxLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxFbnRpdHlBdHRyaWJ1dGU+fSB1bmlxdWUgYXR0cmlidXRlcyBvZiB0aGUgZW50aXR5XG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0VW5pcXVlQXR0cmlidXRlcygpOiBBcnJheTxFbnRpdHlBdHRyaWJ1dGU+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcblxuICAgICAgICAgICAgbGV0IGlzVW5pcXVlID0gKCdpc1VuaXF1ZScgaW4gYXR0KSA/IGF0dC5pc1VuaXF1ZSA6IGF0dC5pc0lkZW50aWZpZXI7XG5cbiAgICAgICAgICAgIGlmIChpc1VuaXF1ZSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIC4uLmF0dCxcbiAgICAgICAgICAgICAgICAgICAgaXNVbmlxdWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGF0dE5hbWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0aGF0IGNhbiBiZSB1c2VkIGZvciBmaWx0ZXJpbmcgdGhlIHJlY29yZHMuXG4gICAgICogSW5jbHVkZXMgYWxsIGZpbHRlcmFibGUgZmllbGQgdHlwZXM6IHN0cmluZywgbnVtYmVyLCBib29sZWFuLCBlbnVtcywgZGF0ZXMsIGFuZCByZWxhdGlvbnMuXG4gICAgICogXG4gICAgICogVGhpcyBtYXRjaGVzIHRoZSBjb21wcmVoZW5zaXZlIGZpbHRlcmluZyBzdXBwb3J0IGluIHRoZSBVSSBmaWx0ZXIgZ2VuZXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gYXR0cmlidXRlIG5hbWVzIHRvIGJlIHVzZWQgZm9yIGZpbHRlcmluZ1xuICAgICovXG4gICAgcHVibGljIGdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG5cbiAgICAgICAgICAgIC8vIFNraXAgaWYgZXhwbGljaXRseSBtYXJrZWQgYXMgbm90IGZpbHRlcmFibGUgb3IgaGlkZGVuXG4gICAgICAgICAgICBpZiAoYXR0LmhpZGRlbiB8fCBhdHQuaXNGaWx0ZXJhYmxlID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBhdHRyVHlwZSA9IGF0dC50eXBlO1xuICAgICAgICAgICAgY29uc3QgZmllbGRUeXBlID0gYXR0LmZpZWxkVHlwZTtcbiAgICAgICAgICAgIGxldCBpc0ZpbHRlcmFibGVUeXBlID0gZmFsc2U7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGJhc2ljIHNjYWxhciB0eXBlc1xuICAgICAgICAgICAgaWYgKGF0dHJUeXBlID09PSAnc3RyaW5nJyB8fCBhdHRyVHlwZSA9PT0gJ251bWJlcicgfHwgYXR0clR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgZW51bSB0eXBlcyAoYXJyYXkgb2YgdmFsdWVzKVxuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIEFycmF5LmlzQXJyYXkoYXR0clR5cGUpKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBkYXRlL2RhdGV0aW1lIGZpZWxkc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmIChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScpKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGZvciBkYXRlLWxpa2UgZmllbGQgbmFtZXNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJiBhdHRyVHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBhdHROYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgaWYgKGxvd2VyTmFtZS5pbmNsdWRlcygnZGF0ZScpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygndGltZScpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIHJlbGF0aW9uIGZpZWxkc1xuICAgICAgICAgICAgaWYgKCFpc0ZpbHRlcmFibGVUeXBlICYmICdyZWxhdGlvbicgaW4gYXR0ICYmIGF0dC5yZWxhdGlvbikge1xuICAgICAgICAgICAgICAgIGlzRmlsdGVyYWJsZVR5cGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDaGVjayBmb3Igc2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkcyB3aXRoIG9wdGlvbnNcbiAgICAgICAgICAgIGlmICghaXNGaWx0ZXJhYmxlVHlwZSAmJlxuICAgICAgICAgICAgICAgIChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0JykgJiZcbiAgICAgICAgICAgICAgICAnb3B0aW9ucycgaW4gYXR0ICYmIGF0dC5vcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlVHlwZSA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEluY2x1ZGUgaWYgZmlsdGVyYWJsZSBieSBkZWZhdWx0IChpc0ZpbHRlcmFibGUgbm90IGV4cGxpY2l0bHkgc2V0KSBvciBleHBsaWNpdGx5IGVuYWJsZWRcbiAgICAgICAgICAgIGlmIChpc0ZpbHRlcmFibGVUeXBlICYmICghKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgfHwgYXR0LmlzRmlsdGVyYWJsZSkpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KHJlY29yZDogVCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogUGFydGlhbDxUPiB7XG5cbiAgICAgICAgbGV0IGtleXM6IEFycmF5PHN0cmluZz47XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoYXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMocGFyc2VkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwaWNrS2V5czxUPihyZWNvcmQsIC4uLmtleXMpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IEFycmF5PFQ+IHwgbnVsbCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogQXJyYXk8UGFydGlhbDxUPj4ge1xuICAgICAgICBpZiAoIXJlY29yZCB8fCAhQXJyYXkuaXNBcnJheShyZWNvcmQpKSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlY29yZC5tYXAocmVjb3JkID0+IHRoaXMuc2VyaWFsaXplUmVjb3JkPFQ+KHJlY29yZCwgYXR0cmlidXRlcykpO1xuICAgIH1cblxuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJywgaHlkcmF0aW9uOiAndHJ1ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIHJlbGF0aW9ucywgcm9vdFJlY29yZHMgXSA9IGFyZ3MgYXMgWyB1bmtub3duW10gfCB1bmRlZmluZWQsIHVua25vd25bXSB8IHVuZGVmaW5lZCBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uQ291bnQgPSBBcnJheS5pc0FycmF5KHJlbGF0aW9ucykgPyByZWxhdGlvbnMubGVuZ3RoIDogMDtcbiAgICAgICAgICAgICAgICBjb25zdCByZWNvcmRDb3VudCA9IEFycmF5LmlzQXJyYXkocm9vdFJlY29yZHMpID8gcm9vdFJlY29yZHMubGVuZ3RoIDogMDtcblxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25Db3VudCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY29yZENvdW50LFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG4gICAgYXN5bmMgaHlkcmF0ZVJlY29yZHMoXG4gICAgICAgIHJlbGF0aW9uczogQXJyYXk8WyByZWxhdGVkQXR0cmlidXRlTmFtZTogc3RyaW5nLCBvcHRpb25zOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248YW55PiBdPixcbiAgICAgICAgcm9vdEVudGl0eVJlY29yZHM6IEFycmF5PHsgWyB4OiBzdHJpbmcgXTogYW55OyB9PlxuICAgICkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlUmVjb3JkcycgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocmVsYXRpb25zPy5tYXAoYXN5bmMgKFsgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlU2luZ2xlUmVsYXRpb24ocm9vdEVudGl0eVJlY29yZHMsIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLCBvcHRpb25zKTtcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZVNpbmdsZVJlbGF0aW9uKHJvb3RFbnRpdHlSZWNvcmRzOiBhbnlbXSwgcmVsYXRlZEF0dHJpYnV0ZU5hbWU6IHN0cmluZywgb3B0aW9uczogSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uPGFueT4pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZVNpbmdsZVJlbGF0aW9uJyByZWxhdGlvbjogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBvcHRpb25zXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUsIHJlbGF0aW9uVHlwZSwgaWRlbnRpZmllcnMgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKCFpZGVudGlmaWVycykge1xuICAgICAgICAgICAgdGhyb3cgKGBObyBJZGVudGlmaWVyczpbJHtyZWxhdGlvblR5cGV9OiR7cmVsYXRlZEVudGl0eU5hbWV9XSBwcm92aWRlZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZSA9PSAnb25lLXRvLW9uZScgfHwgcmVsYXRpb25UeXBlID09ICdtYW55LXRvLW1hbnknKSB7XG4gICAgICAgICAgICB0aHJvdyAoYFJlbGF0aW9uVHlwZTpbJHtyZWxhdGlvblR5cGV9OiR7cmVsYXRlZEVudGl0eU5hbWV9XSBpbiBub3Qgc3VwcG9ydGVkIGJ5IGh5ZHJhdGlvbiwgdXNlIG9uZSBvZiBbbWFueS10by1vbmUsIG9uZS10by1tYW55XSBvdCBtYW51YWxseSBoeWRyYXRlJ2ApXG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZVxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgICAgIGlmICghcmVsYXRlZEVudGl0eVNlcnZpY2UpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc2VydmljZSBmb3VuZCBmb3IgcmVsYXRpb25zaGlwOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfSgke3JlbGF0ZWRFbnRpdHlOYW1lfSk7IHBsZWFzZSBtYWtlIHN1cmUgc2VydmljZSBoYXMgYmVlbiByZWdpc3RlcmVkIGluIHRoZSByZXF1aXJlZCAnZGktY29udGFpbmVyJ2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0aW9uJ3MgbWV0YWRhdGFcbiAgICAgICAgY29uc3QgY3VycmVudEVudGl0eVNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEgPSBjdXJyZW50RW50aXR5U2NoZW1hLmF0dHJpYnV0ZXNbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lIGFzIGFueSBdIGFzIEVudGl0eUF0dHJpYnV0ZTtcblxuICAgICAgICBpZiAoIXJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEgfHwgIXJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGE/LnJlbGF0aW9uKSB7XG4gICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gYE5vIG1ldGFkYXRhIGZvdW5kIGZvciByZWxhdGlvbnNoaXA6ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9YFxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihtZXNzYWdlLCByZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhKTtcbiAgICAgICAgICAgIHRocm93IChtZXNzYWdlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlbGF0aW9uIGlkZW50aWZpZXJzIG1hcHBpbmdcbiAgICAgICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdID0gQXJyYXkuaXNBcnJheShpZGVudGlmaWVycykgPyBpZGVudGlmaWVycyA6IFsgaWRlbnRpZmllcnMhIF07XG5cbiAgICAgICAgLy8gRGVjaWRlIGxvZ2ljIGJhc2VkIG9uIHJlbGF0aW9uVHlwZVxuICAgICAgICBpZiAocmVsYXRpb25UeXBlID09PSAnbWFueS10by1vbmUnKSB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIE1BTlktVE8tT05FOlxuICAgICAgICAgICAgICogLS0tLS0tLS0tLS0tLVxuICAgICAgICAgICAgICogVGhlIFwicm9vdEVudGl0eVJlY29yZHNcIiBhcmUgdGhlIENISUxEIGl0ZW1zLCBlYWNoIHN0b3JpbmcgdGhlIHBhcmVudCdzXG4gICAgICAgICAgICAgKiBjb21wb3NpdGUga2V5IGluIHNvbWUgZmllbGRzLiBXZSBnYXRoZXIgYWxsIHRob3NlIHBhcmVudCBrZXlzLCBkbyBhIGJhdGNoXG4gICAgICAgICAgICAgKiByZXRyaWV2YWwgZnJvbSB0aGUgcGFyZW50IGVudGl0eSwgdGhlbiBhdHRhY2ggdGhlIHNpbmdsZSBtYXRjaGluZyBwYXJlbnRcbiAgICAgICAgICAgICAqIHJlY29yZCBpbnRvIGNoaWxkUmVjb3JkW3JlbGF0ZWRBdHRyaWJ1dGVOYW1lXS5cbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVNYW55VG9PbmUoXG4gICAgICAgICAgICAgICAgcm9vdEVudGl0eVJlY29yZHMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUgPT09ICdvbmUtdG8tbWFueScpIHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogT05FLVRPLU1BTlk6XG4gICAgICAgICAgICAgKiAtLS0tLS0tLS0tLS0tXG4gICAgICAgICAgICAgKiBUaGUgXCJyb290RW50aXR5UmVjb3Jkc1wiIGFyZSB0aGUgUEFSRU5UIGl0ZW1zLiBFYWNoIHBhcmVudCBjYW4gaGF2ZSBtdWx0aXBsZVxuICAgICAgICAgICAgICogY2hpbGQgaXRlbXMuIFRoZSBjaGlsZCB0YWJsZSByZWNvcmRzIGVhY2ggc3RvcmUgdGhlIHBhcmVudCdzIGtleS4gXG4gICAgICAgICAgICAgKiBTbyB3ZSBkbyBhIHF1ZXJ5IHBlciBwYXJlbnQgYW5kIHRoZW4gLlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVPbmVUb01hbnkoXG4gICAgICAgICAgICAgICAgcm9vdEVudGl0eVJlY29yZHMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZU1hbnlUb09uZShcbiAgICAgICAgY2hpbGRSZWNvcmRzOiBhbnlbXSxcbiAgICAgICAgcGFyZW50QXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10sXG4gICAgICAgIHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGU6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8YW55PiB8IHVuZGVmaW5lZCxcbiAgICAgICAgcGFyZW50U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuICAgICkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlTWFueVRvT25lJyByZWxhdGlvbjogJHtwYXJlbnRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIGZvciBlYWNoIHBhcmVudCBjcmVhdGUgYSBjaGlsZHJlbiBiYXRjaFxuICAgICAgICBjb25zdCBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZFJlY29yZHMpIHtcbiAgICAgICAgICAgIGlmICghY2hpbGQpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBhIHBhcmVudCBrZXkgb2JqZWN0LiBFLmcuIHsgb3JnSWQ6IGNoaWxkLm9yZ0lkLCB1c2VySWQ6IGNoaWxkLnVzZXJJZCB9IGZvciAyLWF0dHIgUEtcbiAgICAgICAgICAgIGNvbnN0IHBhcmVudEtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHNvdXJjZSwgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWwgPSBnZXRWYWx1ZUJ5UGF0aChjaGlsZCwgc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbCA9PSBudWxsKSBjb250aW51ZTtcblxuICAgICAgICAgICAgICAgICAgICBwYXJlbnRLZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHZhbDtcblxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBnZXR0aW5nIHZhbHVlIGZvciBwYXRoOiAke3NvdXJjZX1gLCB7IGVycm9yIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSWYgcGFydGlhbCBvciBlbXB0eSwgc2tpcFxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKHBhcmVudEtleU9iaikubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgY2hpbGRbIHBhcmVudEF0dHJpYnV0ZU5hbWUgXSA9IG51bGw7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IEpTT04uc3RyaW5naWZ5KHBhcmVudEtleU9iaik7XG4gICAgICAgICAgICBpZiAoIXBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5oYXMoa2V5U3RyKSkge1xuICAgICAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5zZXQoa2V5U3RyLCBbXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuZ2V0KGtleVN0cikhLnB1c2goY2hpbGQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5zaXplID09PSAwKSByZXR1cm47XG5cbiAgICAgICAgLy8gQ3JlYXRlIGEgcGFyZW50LWlkZW50aWZpZXJzLWJhdGNoIGZvciBmZXRjaGluZ1xuICAgICAgICBjb25zdCBwYXJlbnRJZGVudGlmaWVyc0JhdGNoOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGsgb2YgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmtleXMoKSkge1xuICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNCYXRjaC5wdXNoKEpTT04ucGFyc2UoaykpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZmV0Y2hlZFBhcmVudHMgPSBhd2FpdCBwYXJlbnRTZXJ2aWNlLmdldCh7XG4gICAgICAgICAgICBpZGVudGlmaWVyczogcGFyZW50SWRlbnRpZmllcnNCYXRjaCxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIFwiZ2V0KClcIiByZXR1cm5zIGEgc2luZ2xlIGl0ZW0gY29udmVydCBpdCBpbnRvIGFuIGFycmF5LlxuICAgICAgICBjb25zdCBwYXJlbnRzQXJyYXkgPSBBcnJheS5pc0FycmF5KGZldGNoZWRQYXJlbnRzKSA/IGZldGNoZWRQYXJlbnRzIDogWyBmZXRjaGVkUGFyZW50cyBdO1xuXG4gICAgICAgIC8vIE1ha2UgYSBkaWN0aW9uYXJ5IGZyb20geyA8a2V5U3RyPiA9PiBwYXJlbnRSZWNvcmQgfVxuICAgICAgICBjb25zdCBwYXJlbnREaWN0ID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcbiAgICAgICAgZm9yIChjb25zdCBwIG9mIHBhcmVudHNBcnJheSkge1xuICAgICAgICAgICAgaWYgKCFwKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBSZWJ1aWxkIHRoZSBcImNvbXBvc2l0ZSBrZXlcIiBmcm9tIHRoZSBwYXJlbnQncyByZWNvcmRcbiAgICAgICAgICAgIGNvbnN0IGtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuICAgICAgICAgICAgICAgIGlmIChwWyB0YXJnZXQgXSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHNvbWUgYXR0cmlidXRlIGlzIG1pc3NpbmcsIHNraXBcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gcFsgdGFyZ2V0IF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBrU3RyID0gSlNPTi5zdHJpbmdpZnkoa2V5T2JqKTtcbiAgICAgICAgICAgIHBhcmVudERpY3Quc2V0KGtTdHIsIHApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXR0YWNoIGVhY2ggcGFyZW50J3MgZGF0YSB0byB0aGUgY2hpbGRcbiAgICAgICAgZm9yIChjb25zdCBbIGtTdHIsIGNoaWxkcmVuIF0gb2YgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgZm91bmRQYXJlbnQgPSBwYXJlbnREaWN0LmdldChrU3RyKSA/PyBudWxsO1xuICAgICAgICAgICAgZm9yIChjb25zdCBjIG9mIGNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY1sgcGFyZW50QXR0cmlidXRlTmFtZSBdID0gZm91bmRQYXJlbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVPbmVUb01hbnkoXG4gICAgICAgIHBhcmVudFJlY29yZHM6IGFueVtdLFxuICAgICAgICBjaGlsZEF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdLFxuICAgICAgICBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGU6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8YW55PiB8IHVuZGVmaW5lZCxcbiAgICAgICAgY2hpbGRTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4gICAgKSB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZU9uZVRvTWFueScgcmVsYXRpb246ICR7Y2hpbGRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcGFyZW50S2V5U3RyVG9QYXJlbnRzID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGFyZW50IG9mIHBhcmVudFJlY29yZHMpIHtcbiAgICAgICAgICAgIGlmICghcGFyZW50KSBjb250aW51ZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBcImNoaWxkIGluZGV4XCIga2V5IGZyb20gdGhlIHBhcmVudCdzIGZpZWxkcy4gRm9yIGV4YW1wbGUsIFxuICAgICAgICAgICAgLy8gaWYgdGhlIGNoaWxkIEdTSSBoYXMgeyBwazogJ3RlbmFudElkJywgc2s6ICdhY2NvdW50SWQnIH0sIFxuICAgICAgICAgICAgLy8gd2UgZmlsbCB7IHRlbmFudElkOiBwYXJlbnQudGVuYW50SWQsIGFjY291bnRJZDogcGFyZW50LmFjY291bnRJZCB9LlxuICAgICAgICAgICAgY29uc3QgY2hpbGRLZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBzb3VyY2UsIHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuICAgICAgICAgICAgICAgIGlmIChwYXJlbnRbIHNvdXJjZSBdICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRLZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHBhcmVudFsgc291cmNlIF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiB3ZSBoYXZlIG5vIHZhbGlkIGNvbXBvc2l0ZSBrZXksIG5vIGNoaWxkcmVuIGNhbiBiZSBmZXRjaGVkXG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoY2hpbGRLZXlPYmopLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHBhcmVudFsgY2hpbGRBdHRyaWJ1dGVOYW1lIF0gPSBbXTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gSlNPTi5zdHJpbmdpZnkoY2hpbGRLZXlPYmopO1xuICAgICAgICAgICAgaWYgKCFwYXJlbnRLZXlTdHJUb1BhcmVudHMuaGFzKGtleVN0cikpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRLZXlTdHJUb1BhcmVudHMuc2V0KGtleVN0ciwgW10pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmdldChrZXlTdHIpIS5wdXNoKHBhcmVudCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiBubyBwYXJlbnQgaGFzIGEgdmFsaWQga2V5LCB3ZSdyZSBkb25lXG4gICAgICAgIGlmIChwYXJlbnRLZXlTdHJUb1BhcmVudHMuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIGVhY2ggdW5pcXVlIHBhcmVudEtleU9iaiwgZG8gYSBjaGlsZFNlcnZpY2UgcXVlcnkvbGlzdCBpbiBwYXJhbGxlbC5cbiAgICAgICAgY29uc3QgcHJvbWlzZXM6IEFycmF5PFByb21pc2U8YW55Pj4gPSBbXTtcbiAgICAgICAgY29uc3QgcGFyZW50S2V5czogc3RyaW5nW10gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsga2V5U3RyIF0gb2YgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmVudHJpZXMoKSkge1xuXG4gICAgICAgICAgICBjb25zdCBjaGlsZEtleU9iaiA9IEpTT04ucGFyc2Uoa2V5U3RyKTtcblxuICAgICAgICAgICAgcGFyZW50S2V5cy5wdXNoKGtleVN0cik7XG5cbiAgICAgICAgICAgIGNvbnN0IGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBjaGlsZEZpZWxkLCB2YWwgXSBvZiBPYmplY3QuZW50cmllcyhjaGlsZEtleU9iaikpIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJzWyBjaGlsZEZpZWxkIF0gPSB7IGVxOiB2YWwgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJvbWlzZXMucHVzaChcbiAgICAgICAgICAgICAgICBjaGlsZFNlcnZpY2UubGlzdCh7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG5cbiAgICAgICAgLy8gRm9yIGVhY2ggcmVzdWx0LCBtYXAgY2hpbGRyZW4gYmFjayB0byB0aGUgY29ycmVjdC1wYXJlbnQocylcbiAgICAgICAgY29uc3QgcGFyZW50S2V5U3RyVG9DaGlsZHJlbjogUmVjb3JkPHN0cmluZywgYW55W10+ID0ge307XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdWx0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgeyBkYXRhOiBjaGlsZEl0ZW1zIH0gPSByZXN1bHRzWyBpIF07XG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBwYXJlbnRLZXlzWyBpIF07XG4gICAgICAgICAgICBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuWyBrZXlTdHIgXSA9IGNoaWxkSXRlbXMgPz8gW107XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBdHRhY2ggdG8gcGFyZW50c1xuICAgICAgICBmb3IgKGNvbnN0IFsga2V5U3RyLCBwYXJlbnRzIF0gb2YgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgY2hpbGRBcnJheSA9IHBhcmVudEtleVN0clRvQ2hpbGRyZW5bIGtleVN0ciBdID8/IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBwIG9mIHBhcmVudHMpIHtcbiAgICAgICAgICAgICAgICBwWyBjaGlsZEF0dHJpYnV0ZU5hbWUgXSA9IGNoaWxkQXJyYXk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgYW4gZW50aXR5IGJ5IGl0cyBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eS5cbiAgICAgKiBAcGFyYW0gc2VsZWN0aW9ucyAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBpbmNsdWRlIGluIHRoZSByZXNwb25zZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmV0cmlldmVkIGVudGl0eSBkYXRhLlxuICAgICAqL1xuXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3JlYWQnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgZmluaXNoOiAoeyByZXN1bHQgfSkgPT4gKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGZvdW5kOiAhIXJlc3VsdCB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldE9wdGlvbnM8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxTPiB8IHVuZGVmaW5lZD4ge1xuICAgICAgICBjb25zdCB7IGlkZW50aWZpZXJzLCBhdHRyaWJ1dGVzIH0gPSBvcHRpb25zO1xuXG5cbiAgICAgICAgbGV0IGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzO1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm9ybWF0dGVkQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3JtYXR0ZWQgYXR0cmlidXRlcyBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIGZvcm1hdHRlZEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGNvbnN0IHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgYW55KS5yZWR1Y2UoKGFjYywgWyBhdHROYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgIGFjYy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgaWYgKGlzT2JqZWN0KG9wdGlvbnMpICYmIG9wdGlvbnMuaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogQXJyYXk8UmVsYXRpb25JZGVudGlmaWVyPGFueT4+ID0gQXJyYXkuaXNBcnJheShvcHRpb25zLmlkZW50aWZpZXJzKSA/IG9wdGlvbnMuaWRlbnRpZmllcnMgOiBbIG9wdGlvbnMuaWRlbnRpZmllcnMgXTtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3BLZXlzID0gaWRlbnRpZmllcnMubWFwKGlkZW50aWZpZXIgPT4gaWRlbnRpZmllci5zb3VyY2U/LnNwbGl0Py4oJy4nKT8uWyAwIF0pLmZpbHRlcihrZXkgPT4gISFrZXkpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgICAgICAgIGFjYy5wdXNoKC4uLnRvcEtleXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgfSwgW10gYXMgc3RyaW5nW10pO1xuXG4gICAgICAgIGNvbnN0IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBbIC4uLm5ldyBTZXQocmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzKSBdXG5cbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZ2V0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZXRyaWV2ZWQgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIEpzb25TZXJpYWxpemVyLnN0cmluZ2lmeShlbnRpdHkpKTtcblxuICAgICAgICBpZiAoZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICAvLyBEZWNvbXByZXNzIGZpZWxkcyBhZnRlciByZWFkaW5nIGZyb20gREJcbiAgICAgICAgICAgIGVudGl0eS5kYXRhID0gdGhpcy5kZWNvbXByZXNzRmllbGRzKGVudGl0eS5kYXRhKTtcblxuICAgICAgICAgICAgaWYgKCEhZm9ybWF0dGVkQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKVxuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBbIGVudGl0eS5kYXRhIF0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRpdHk/LmRhdGEgYXMgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz4gfCB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGJ5IHRoZWlyIGlkZW50aWZpZXJzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGJhdGNoIHJldHJpZXZpbmcgZW50aXRpZXMuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuaWRlbnRpZmllcnMgLSBBcnJheSBvZiBlbnRpdHkgaWRlbnRpZmllcnMgdG8gcmV0cmlldmUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlcyAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBpbmNsdWRlIGluIHRoZSByZXNwb25zZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5jb25jdXJyZW50IC0gT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyB0byBwZXJmb3JtIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gICAgICovXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3JlYWQnLCBiYXRjaDogJ3RydWUnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSwgYXJncyB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgWyBvcHRpb25zIF0gPSBhcmdzIGFzIFsgeyBpZGVudGlmaWVycz86IHVua25vd25bXTsgY29uY3VycmVudD86IG51bWJlciB9IF07XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2hTaXplID0gQXJyYXkuaXNBcnJheShvcHRpb25zPy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAgICAgY29uc3QgY29uY3VycmVudCA9IHR5cGVvZiBvcHRpb25zPy5jb25jdXJyZW50ID09PSAnbnVtYmVyJyA/IG9wdGlvbnMuY29uY3VycmVudCA6IDE7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7IGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSB9LFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNzOiB7IGJhdGNoU2l6ZSwgY29uY3VycmVudCB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmaW5pc2g6ICh7IHJlc3VsdCB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgciA9IHJlc3VsdCBhcyB7IGRhdGE/OiB1bmtub3duW107IHVucHJvY2Vzc2VkPzogdW5rbm93bltdIH0gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgY29uc3QgcmV0cmlldmVkQ291bnQgPSBBcnJheS5pc0FycmF5KHI/LmRhdGEpID8gciEuZGF0YS5sZW5ndGggOiAwO1xuICAgICAgICAgICAgICAgIGNvbnN0IHVucHJvY2Vzc2VkQ291bnQgPSBBcnJheS5pc0FycmF5KHI/LnVucHJvY2Vzc2VkKSA/IHIhLnVucHJvY2Vzc2VkLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgbWV0cmljczogeyByZXRyaWV2ZWRDb3VudCwgdW5wcm9jZXNzZWRDb3VudCB9IH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBiYXRjaEdldDxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiB7XG4gICAgICAgIGlkZW50aWZpZXJzOiBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PixcbiAgICAgICAgYXR0cmlidXRlcz86IEVudGl0eVNlbGVjdGlvbnM8Uz4sXG4gICAgICAgIGNvbmN1cnJlbnQ/OiBudW1iZXJcbiAgICB9KSB7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMsIGNvbmN1cnJlbnQgPSAxIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcbiAgICAgICAgaWYgKCFhdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZvcm1hdHRlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm9ybWF0dGVkIGF0dHJpYnV0ZXMgZm9yIGJhdGNoIGdldCBvbiBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZm9ybWF0dGVkQXR0cmlidXRlcyk7XG5cbiAgICAgICAgY29uc3QgcmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBhbnkpLnJlZHVjZSgoYWNjLCBbIGF0dE5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYWNjLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICBpZiAoaXNPYmplY3Qob3B0aW9ucykgJiYgb3B0aW9ucy5pZGVudGlmaWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8YW55Pj4gPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycyA6IFsgb3B0aW9ucy5pZGVudGlmaWVycyBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcEtleXMgPSBpZGVudGlmaWVycy5tYXAoaWRlbnRpZmllciA9PiBpZGVudGlmaWVyLnNvdXJjZT8uc3BsaXQ/LignLicpPy5bIDAgXSkuZmlsdGVyKGtleSA9PiAhIWtleSkgYXMgc3RyaW5nW107XG4gICAgICAgICAgICAgICAgYWNjLnB1c2goLi4udG9wS2V5cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCBbXSBhcyBzdHJpbmdbXSk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyA9IFsgLi4ubmV3IFNldChyZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMpIF07XG5cbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZ2V0QmF0Y2hFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWRzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMgYXMgYW55LFxuICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmV0cmlldmVkIGJhdGNoIGVudGl0aWVzOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIEpzb25TZXJpYWxpemVyLnN0cmluZ2lmeShlbnRpdHkpKTtcblxuICAgICAgICBpZiAoZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICAvLyBEZWNvbXByZXNzIGFsbCByZWNvcmRzXG4gICAgICAgICAgICBlbnRpdHkuZGF0YSA9IGVudGl0eS5kYXRhLm1hcChyZWNvcmQgPT4gdGhpcy5kZWNvbXByZXNzRmllbGRzKHJlY29yZCkpO1xuXG4gICAgICAgICAgICBpZiAoISFmb3JtYXR0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0eS5kYXRhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZGF0YTogZW50aXR5Py5kYXRhIHx8IFtdLFxuICAgICAgICAgICAgdW5wcm9jZXNzZWQ6IGVudGl0eT8udW5wcm9jZXNzZWQgfHwgW11cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgdGhlIHVuaXF1ZW5lc3Mgb2YgYW4gYXR0cmlidXRlIHZhbHVlIGFuZCB1cGRhdGVzIHRoZSBwYXlsb2FkIGlmIG5lY2Vzc2FyeS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjaGVja2luZyB1bmlxdWVuZXNzIGFuZCB1cGRhdGluZyB0aGUgcGF5bG9hZC5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5wYXlsb2FkVG9VcGRhdGUgLSBUaGUgcGF5bG9hZCBvYmplY3QgdG8gdXBkYXRlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmF0dHJpYnV0ZU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmF0dHJpYnV0ZVZhbHVlIC0gVGhlIHZhbHVlIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIG9wdGlvbnMubWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIC0gVGhlIG1heGltdW0gbnVtYmVyIG9mIGF0dGVtcHRzIHRvIGNyZWF0ZSBhIHVuaXF1ZSBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICogQHJldHVybnMgQSBib29sZWFuIGluZGljYXRpbmcgd2hldGhlciB0aGUgYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgY2hlY2tVbmlxdWVuZXNzQW5kVXBkYXRlKG9wdGlvbnM6IHtcbiAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBhbnksXG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgYXR0cmlidXRlVmFsdWU6IGFueSxcbiAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzPzoge1xuICAgICAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBhbnlcbiAgICAgICAgfVxuICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWU6IG51bWJlcixcbiAgICB9KSB7XG5cbiAgICAgICAgY29uc3QgeyBwYXlsb2FkVG9VcGRhdGUsIGF0dHJpYnV0ZU5hbWUsIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycywgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH0gPSBvcHRpb25zO1xuICAgICAgICBsZXQgeyBhdHRyaWJ1dGVWYWx1ZSB9ID0gb3B0aW9ucztcblxuICAgICAgICBsZXQgaXNVbmlxdWUgPSBmYWxzZTtcbiAgICAgICAgbGV0IHRyaWVzQ291bnQgPSAxO1xuXG4gICAgICAgIHdoaWxlICghaXNVbmlxdWUgJiYgdHJpZXNDb3VudCA8IG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSkge1xuICAgICAgICAgICAgaXNVbmlxdWUgPSBhd2FpdCB0aGlzLmlzVW5pcXVlQXR0cmlidXRlVmFsdWUoYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlVmFsdWUsIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyk7XG4gICAgICAgICAgICBpZiAoIWlzVW5pcXVlKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWUgPSB0aGlzLmdlbmVyYXRlVW5pcXVlVmFsdWUoYXR0cmlidXRlVmFsdWUsIHRyaWVzQ291bnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdHJpZXNDb3VudCsrO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzVW5pcXVlKSB7XG4gICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGVbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dHJpYnV0ZVZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGlzVW5pcXVlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGUgZ2l2ZW4gYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZSBmb3IgdGhlIHNwZWNpZmllZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcGFyYW0gYXR0cmlidXRlTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIGF0dHJpYnV0ZVZhbHVlIC0gVGhlIHZhbHVlIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHJldHVybnMgQSBib29sZWFuIGluZGljYXRpbmcgd2hldGhlciB0aGUgYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZSBvciBub3QuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGlzVW5pcXVlQXR0cmlidXRlVmFsdWUoXG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgYXR0cmlidXRlVmFsdWU6IGFueSxcbiAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzPzoge1xuICAgICAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBhbnlcbiAgICAgICAgfVxuICAgICkge1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBhdHRyaWJ1dGVOYW1lOiAke2F0dHJpYnV0ZU5hbWV9IH4gYXR0cmlidXRlVmFsdWU6ICR7YXR0cmlidXRlVmFsdWV9YCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGZpbHRlcnMgZm9yIHRoZSBxdWVyeSB1c2luZyB0aGUgY29ycmVjdCBzdHJ1Y3R1cmVcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIFsgYXR0cmlidXRlTmFtZSBdOiB7IGVxOiBhdHRyaWJ1dGVWYWx1ZSB9XG4gICAgICAgIH0gYXMgRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz47XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5lIHdoaWNoIGF0dHJpYnV0ZXMgdG8gcHJvamVjdCAtIG9ubHkgdGhlIGF0dHJpYnV0ZSBiZWluZyBjaGVja2VkIGFuZCBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVyc1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVzVG9Qcm9qZWN0OiBzdHJpbmdbXSA9IFsgYXR0cmlidXRlTmFtZSBdO1xuXG4gICAgICAgIC8vIEFkZCBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVyIGZpZWxkcyB0byB0aGUgcHJvamVjdGlvblxuICAgICAgICBpZiAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzICYmICFpc0VtcHR5T2JqZWN0RGVlcChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWF0dHJpYnV0ZXNUb1Byb2plY3QuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzVG9Qcm9qZWN0LnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzZSB0aGUgcXVlcnkgbWV0aG9kIHRvIGxldmVyYWdlIGluZGV4IHNlbGVjdGlvbiBsb2dpYyB3aXRoIG1pbmltYWwgYXR0cmlidXRlIHByb2plY3Rpb25cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeSh7XG4gICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogYXR0cmlidXRlc1RvUHJvamVjdCBhcyBhbnksXG4gICAgICAgICAgICBwYWdpbmF0aW9uOiB7IGNvdW50OiAxIH0gLy8gV2Ugb25seSBuZWVkIHRvIGtub3cgaWYgYW55IHJlY29yZHMgZXhpc3RcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSWYgd2UgaGF2ZSBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVycywgZmlsdGVyIHRoZSByZXN1bHRzIGluIG1lbW9yeVxuICAgICAgICBsZXQgZW50aXRpZXMgPSByZXN1bHQuZGF0YSB8fCBbXTtcbiAgICAgICAgaWYgKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyAmJiAhaXNFbXB0eU9iamVjdERlZXAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgZW50aXRpZXMgPSBlbnRpdGllcy5maWx0ZXIoZW50aXR5ID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gIU9iamVjdC5lbnRyaWVzKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykuZXZlcnkoKFsga2V5LCB2YWx1ZSBdKSA9PlxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlbIGtleSBdID09PSB2YWx1ZVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBhdHRyaWJ1dGVOYW1lOiAke2F0dHJpYnV0ZU5hbWV9IH4gYXR0cmlidXRlVmFsdWU6ICR7YXR0cmlidXRlVmFsdWV9IH4gZW50aXR5OmAsIHsgZGF0YTogZW50aXRpZXMgfSk7XG5cbiAgICAgICAgcmV0dXJuIGVudGl0aWVzLmxlbmd0aCA9PT0gMDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZXMgYSB1bmlxdWUgdmFsdWUgYnkgYXBwZW5kaW5nIGEgdW5pcXVlIHN1ZmZpeCB0byB0aGUgb3JpZ2luYWwgdmFsdWUuXG4gICAgICogQHBhcmFtIG9yaWdpbmFsVmFsdWUgLSBUaGUgb3JpZ2luYWwgdmFsdWUgdG8gZ2VuZXJhdGUgYSB1bmlxdWUgdmFsdWUgZnJvbS5cbiAgICAgKiBAcGFyYW0gYXR0ZW1wdCAtIFRoZSBhdHRlbXB0IG51bWJlciBvciBzdHJpbmcgdG8gYmUgdXNlZCBhcyBhIHN1ZmZpeCAoZGVmYXVsdDogcmFuZG9tIHN0cmluZykuXG4gICAgICogQHJldHVybnMgVGhlIGdlbmVyYXRlZCB1bmlxdWUgdmFsdWUuXG4gICAgICovXG4gICAgcHVibGljIGdlbmVyYXRlVW5pcXVlVmFsdWUob3JpZ2luYWxWYWx1ZTogYW55LCBhdHRlbXB0OiBudW1iZXIgfCBzdHJpbmcgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgMTUpKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgdW5pcXVlU3VmZml4ID0gYCR7RGF0ZS5ub3coKX0tJHthdHRlbXB0fWA7XG4gICAgICAgIHJldHVybiBgJHtvcmlnaW5hbFZhbHVlfS0ke3VuaXF1ZVN1ZmZpeH1gO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF1dG9tYXRpY2FsbHkgaW5qZWN0cyBhY3RvciBjb250ZXh0IGludG8gZW50aXR5IGRhdGFcbiAgICAgKiBAcGFyYW0gZGF0YSAtIFRoZSBlbnRpdHkgZGF0YSB0byBlbmhhbmNlXG4gICAgICogQHBhcmFtIG9wZXJhdGlvbiAtIFRoZSBvcGVyYXRpb24gdHlwZSAoY3JlYXRlL3VwZGF0ZSlcbiAgICAgKiBAcGFyYW0gY3R4IC0gVGhlIGV4ZWN1dGlvbiBjb250ZXh0IGNvbnRhaW5pbmcgYWN0b3IgaW5mb1xuICAgICAqIEByZXR1cm5zIEVuaGFuY2VkIGRhdGEgd2l0aCBhY3RvciBjb250ZXh0XG4gICAgICovXG4gICAgcHJvdGVjdGVkIGluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgICAgIGRhdGE6IFQsXG4gICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICd1cHNlcnQnIHwgJ2RlbGV0ZScsXG4gICAgICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgICApOiBUIHtcblxuICAgICAgICAvLyBQcmVmZXIgZXhwbGljaXQgY3R4LmFjdG9yLCBvdGhlcndpc2UgZmFsbCBiYWNrIHRvIGZyYW1ld29yayBleGVjdXRpb24tY29udGV4dCAoQXN5bmNMb2NhbFN0b3JhZ2UpLlxuICAgICAgICAvLyBUaGlzIGlzIGltcG9ydGFudCBmb3IgYmFja2dyb3VuZCBoYW5kbGVycyAocXVldWVzL3Rhc2tzKSB3aGVyZSBjdHggbWF5IG5vdCBiZSB0aHJlYWRlZCB0aHJvdWdoLlxuICAgICAgICBjb25zdCBlZmZlY3RpdmVBY3RvciA9IGN0eD8uYWN0b3IgPz8gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKT8uYWN0b3I7XG4gICAgICAgIGlmICghZWZmZWN0aXZlQWN0b3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdCYXNlRW50aXR5U2VydmljZTogTm8gYWN0b3IgY29udGV4dCBmb3VuZCwgc2tpcHBpbmcgaW5qZWN0aW9uJyk7XG4gICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVuaGFuY2VkRGF0YSA9IHsgLi4uZGF0YSB9O1xuICAgICAgICBjb25zdCBhY3RvciA9IGVmZmVjdGl2ZUFjdG9yO1xuXG4gICAgICAgIC8vIElNUE9SVEFOVDogV2UgZG8gTk9UIHBlcnNpc3QvcHJvcGFnYXRlIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBhY3Jvc3MgaG9wcy5cbiAgICAgICAgLy8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGlzIHN0cmljdCBoaWVyYXJjaHkgd2l0aGluIGEgc2luZ2xlIGludm9jYXRpb24ncyBwZXJzaXN0ZWQgc2xpY2UuXG5cbiAgICAgICAgLy8gR2V0IGN1cnJlbnQgdGltZXN0YW1wIGZvciBkYXRhYmFzZSBvcGVyYXRpb25cbiAgICAgICAgY29uc3QgY3VycmVudFRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcblxuICAgICAgICAvLyBJbmplY3QgdmlzaWJsZSBhY3RvciBmaWVsZHMgaWYgZGVmaW5lZCBpbiBzY2hlbWEgYW5kIG5vdCByZWFkLW9ubHlcbiAgICAgICAgaWYgKG9wZXJhdGlvbiA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdjcmVhdGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdjcmVhdGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIGRlbGV0ZSBvcGVyYXRpb25zLCB3ZSBzdGlsbCB3YW50IHRvIHRyYWNrIHdobyBwZXJmb3JtZWQgdGhlIGRlbGV0aW9uXG4gICAgICAgIGlmIChvcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnZGVsZXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnZGVsZXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEFsd2F5cyB1cGRhdGUgdGhlc2UgZmllbGRzIG9uIGNyZWF0ZS91cGRhdGUgKGlmIG5vdCByZWFkLW9ubHkpXG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndXBkYXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndXBkYXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndGVuYW50SWQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd0ZW5hbnRJZCcpICYmIGFjdG9yLnRlbmFudElkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLnRlbmFudElkID0gYWN0b3IudGVuYW50SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBbHdheXMgaW5qZWN0IGNvbXBsZXRlIGFjdG9yIGNvbnRleHQgZm9yIGF1ZGl0IHRyYWlsXG4gICAgICAgIC8vIFRoaXMgZmllbGQgaXMgaGlkZGVuIGZyb20gQVBJIHJlc3BvbnNlcyBieSBkZWZhdWx0XG4gICAgICAgIC8vIEluamVjdCBhY3RvclRpbWVzdGFtcCBmb3Igc3RhbGVuZXNzIGRldGVjdGlvbiBpbiBhdWRpdCBsb2dzXG4gICAgICAgIGNvbnN0IGFjdG9yV2l0aFRpbWVzdGFtcCA9IHtcbiAgICAgICAgICAgIC4uLmFjdG9yLFxuICAgICAgICAgICAgYWN0b3JUaW1lc3RhbXA6IERhdGUubm93KCksIC8vIE1pbGxpc2Vjb25kcyBzaW5jZSBlcG9jaCBmb3IgZWFzeSBjb21wYXJpc29uXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gQ2xlYW4gYWN0b3Igb2JqZWN0IGJ5IHJlbW92aW5nIHVuZGVmaW5lZCB2YWx1ZXMgKER5bmFtb0RCIGRvZXNuJ3QgYWxsb3cgdGhlbSlcbiAgICAgICAgY29uc3QgY2xlYW5BY3RvciA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGFjdG9yV2l0aFRpbWVzdGFtcCkuZmlsdGVyKChbIF8sIHZhbHVlIF0pID0+IHZhbHVlICE9PSB1bmRlZmluZWQpXG4gICAgICAgICk7XG5cbiAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLl9hY3RvciA9IGNsZWFuQWN0b3I7XG5cbiAgICAgICAgcmV0dXJuIGVuaGFuY2VkRGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IGVudGl0eS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYXlsb2FkIC0gVG9wLWxldmVsIEpTT04gYG51bGxgIHZhbHVlcyBhcmUgc3RyaXBwZWQgYmVmb3JlIHBlcnNpc3RlbmNlOiBvcHRpb25hbCBmaWVsZHMgYXJlIGxlZnQgdW5zZXRcbiAgICAgKiAgIChzZWUgYGNyZWF0ZUVudGl0eWAgLyBgcGFydGl0aW9uVG9wTGV2ZWxKc29uTnVsbHNgIGluIGBtdXRhdGlvbi11dGlsc2ApLCBub3QgcGFzc2VkIGFzIG51bGwgdG8gRWxlY3Ryb0RCLlxuICAgICAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2luZm8nIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICd3cml0ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlIH0pID0+ICh7XG4gICAgICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lOiAoaW5zdGFuY2UgYXMgeyBnZXRFbnRpdHlOYW1lKCk6IHN0cmluZyB9KS5nZXRFbnRpdHlOYW1lKCkgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGNyZWF0ZShwYXlsb2FkOiBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPENyZWF0ZUVudGl0eVJlc3BvbnNlPFM+PiB7XG5cbiAgICAgICAgbGV0IHBheWxvYWRDb3B5ID0geyAuLi5wYXlsb2FkIH07XG5cbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHRcbiAgICAgICAgcGF5bG9hZENvcHkgPSB0aGlzLmluamVjdEFjdG9yQ29udGV4dChwYXlsb2FkQ29weSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJyc7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnbmFtZScpIHx8ICcnO1xuXG4gICAgICAgIGlmIChlbnRpdHlTbHVnQXR0cmlidXRlICYmICEoZW50aXR5U2x1Z0F0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIChlbnRpdHlOYW1lQXR0cmlidXRlIGluIHBheWxvYWRDb3B5KSkge1xuICAgICAgICAgICAgICAgIHBheWxvYWRDb3B5WyBlbnRpdHlTbHVnQXR0cmlidXRlIGFzIGtleW9mIHR5cGVvZiBwYXlsb2FkQ29weSBdID0gdG9TbHVnKHBheWxvYWRDb3B5WyBlbnRpdHlOYW1lQXR0cmlidXRlIF0pIGFzIGFueTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gcGF5bG9hZENvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gcGF5bG9hZENvcHlbIG5hbWUhIF07XG4gICAgICAgICAgICAgICAgICAgIC8vIFNraXAgd2hlbiBvcHRpb25hbCB1bmlxdWUgZmllbGQgaXMgY2xlYXJlZCAobnVsbCkg4oCUIGNyZWF0ZUVudGl0eSB3aWxsIG9taXQgaXQ7IG5vIHVuaXF1ZW5lc3MgcXVlcnkgZm9yIG51bGwuXG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IG5hbWUhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb21wcmVzcyBmaWVsZHMgYmVmb3JlIHdyaXRpbmdcbiAgICAgICAgcGF5bG9hZENvcHkgPSB0aGlzLmNvbXByZXNzRmllbGRzKHBheWxvYWRDb3B5KTtcblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBjcmVhdGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgZGF0YTogcGF5bG9hZENvcHksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIERlY29tcHJlc3MgZmllbGRzIGFmdGVyIHJlYWRpbmdcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLmVudGl0eSxcbiAgICAgICAgICAgIGRhdGE6IGVudGl0eS5kYXRhID8gdGhpcy5kZWNvbXByZXNzRmllbGRzKGVudGl0eS5kYXRhKSA6IGVudGl0eS5kYXRhXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcy1PUi1VcGRhdGVzIGFuIGVudGl0eS5cbiAgICAgKiBOT1RFOiBcbiAgICAgKiAgIC0gVGhpcyBtZXRob2QgZG9lcyBub3QgY2hlY2sgZm9yIHVuaXF1ZW5lc3Mgb2YgdGhlIGF0dHJpYnV0ZXMsIG5laXRoZXIgY3JlYXRlIHRoZSBzbHVnIGF1dG9tYXRpY2FsbHkuXG4gICAgICogICAtIEl0J3MgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIHRoZSBjYWxsZXIgdG8gZW5zdXJlIHRoZSByZWFkIG9ueSBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaWYgdGhlIHJlY29yZCBpcyBiZWluZyB1cHNlcnQuXG4gICAgICogICAtIFRvcC1sZXZlbCBKU09OIGBudWxsYCB2YWx1ZXMgYXJlIHN0cmlwcGVkIGZyb20gdGhlIHBheWxvYWQgYmVmb3JlIHVwc2VydCAoc2FtZSBhcyBjcmVhdGU7IHVzZSBQQVRDSCB0byBjbGVhciBhdHRycyBvbiBleGlzdGluZyByb3dzKS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYXlsb2FkIC0gVGhlIHBheWxvYWQgZm9yIGNyZWF0aW5nLU9SLXVwZGF0aW5nIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgT2JqZWN0IGNvbnRhaW5pbmc6XG4gICAgICogICAtIGRhdGE6IFRoZSB1cHNlcnRlZCBlbnRpdHkgZGF0YVxuICAgICAqICAgLSB3YXNDcmVhdGVkOiB0cnVlIGlmIHJlY29yZCB3YXMgY3JlYXRlZCwgZmFsc2UgaWYgdXBkYXRlZFxuICAgICAqICAgLSBvbGREYXRhOiBwcmV2aW91cyBkYXRhIGlmIGl0IHdhcyBhbiB1cGRhdGUgKHVuZGVmaW5lZCBmb3IgY3JlYXRlcylcbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ2luZm8nIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICd3cml0ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlIH0pID0+ICh7XG4gICAgICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lOiAoaW5zdGFuY2UgYXMgeyBnZXRFbnRpdHlOYW1lKCk6IHN0cmluZyB9KS5nZXRFbnRpdHlOYW1lKCkgfVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBmaW5pc2g6ICh7IHJlc3VsdCB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgd2FzQ3JlYXRlZDogISEocmVzdWx0IGFzIHsgd2FzQ3JlYXRlZD86IGJvb2xlYW4gfSB8IHVuZGVmaW5lZCk/Lndhc0NyZWF0ZWQgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIHVwc2VydChwYXlsb2FkOiBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4pOiBQcm9taXNlPFVwc2VydEVudGl0eVJlc3BvbnNlPFM+PiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiB1cHNlcnQgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IHBheWxvYWQ6YCwgcGF5bG9hZCk7XG5cbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHQgc28gRHluYW1vREIgaW1hZ2VzIGFsd2F5cyBoYXZlIF9hY3RvciBmb3IgYXVkaXRpbmcvY2F1c2VkQnlcbiAgICAgICAgLy8gVHJlYXQgdXBzZXJ0IGFzIGFuIHVwZGF0ZSBmb3IgYWN0b3ItZmllbGQgcHVycG9zZXMgKHdlIGFsd2F5cyB3YW50IF9hY3RvciBhbmQgdXBkYXRlZEJ5L3VwZGF0ZWRBdCkuXG4gICAgICAgIGxldCBwYXlsb2FkQ29weSA9IHRoaXMuaW5qZWN0QWN0b3JDb250ZXh0KHsgLi4ucGF5bG9hZCB9LCAndXBzZXJ0Jyk7XG5cbiAgICAgICAgLy8gQ29tcHJlc3MgZmllbGRzIGJlZm9yZSB3cml0aW5nXG4gICAgICAgIHBheWxvYWRDb3B5ID0gdGhpcy5jb21wcmVzc0ZpZWxkcyhwYXlsb2FkQ29weSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdXBzZXJ0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIGRhdGE6IHBheWxvYWRDb3B5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBEZWNvbXByZXNzIHJlc3VsdCBmaWVsZHNcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnJlc3VsdCxcbiAgICAgICAgICAgIGRhdGE6IHJlc3VsdC5kYXRhID8gdGhpcy5kZWNvbXByZXNzRmllbGRzKHJlc3VsdC5kYXRhKSA6IHJlc3VsdC5kYXRhLFxuICAgICAgICAgICAgb2xkRGF0YTogcmVzdWx0Lm9sZERhdGEgPyB0aGlzLmRlY29tcHJlc3NGaWVsZHMocmVzdWx0Lm9sZERhdGEpIDogdW5kZWZpbmVkXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIGR1cGxpY2F0ZSBlbnRpdHkgZGF0YSBiYXNlZCBvbiB0aGUgZ2l2ZW4gaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIGR1cGxpY2F0ZSBlbnRpdHkgZGF0YS5cbiAgICAgKiBAdGhyb3dzIEVycm9yIGlmIG5vIHJlY29yZCBpcyBmb3VuZCBmb3IgdGhlIGdpdmVuIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3QgaWRlbnRpZmllcnMgPSB7IGlkOiAxIH07XG4gICAgICogY29uc3QgZHVwbGljYXRlRGF0YSA9IGF3YWl0IG1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhQnlJZGVudGlmaWVycyhpZGVudGlmaWVycyk7XG4gICAgICogY29uc29sZS5sb2coZHVwbGljYXRlRGF0YSk7IC8vIHsgbmFtZTogJ0pvaG4gRG9lJywgYWdlOiAzMCwgLi4uIH1cbiAgICAgKi9cbiAgICBwcm90ZWN0ZWQgYXN5bmMgbWFrZUR1cGxpY2F0ZUVudGl0eURhdGEoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4pOiBQcm9taXNlPENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPj4ge1xuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCB0aGlzLmdldCh7IGlkZW50aWZpZXJzIH0pIGFzIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+O1xuXG4gICAgICAgIGlmICghZW50aXR5KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IHJlY29yZCBmb3VuZCBmb3IgaWRlbnRpZmllcnM6ICR7aWRlbnRpZmllcnN9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgZHVwbGljYXRlRXZlbnREYXRhOiBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4gPSB7fSBhcyBhbnk7XG4gICAgICAgIGNvbnN0IHByaW1hcnlJZFByb3BOYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKSBhcyBzdHJpbmc7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IChnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnc2x1ZycpIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gKGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICduYW1lJykgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG5cbiAgICAgICAgZm9yIChsZXQgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZW50aXR5KSkge1xuXG4gICAgICAgICAgICBpZiAoa2V5ICE9PSBwcmltYXJ5SWRQcm9wTmFtZSkge1xuICAgICAgICAgICAgICAgIC8vIFRPRE86IGhhbmRsZSB3aGVuIGVudGl0eSBoYXMgbXVsdGlwbGUgaWRlbnRpZmllcnNcblxuICAgICAgICAgICAgICAgIGlmIChrZXkudG9VcHBlckNhc2UoKSA9PT0gZW50aXR5TmFtZUF0dHJpYnV0ZSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGAke3ZhbHVlfSAtIENvcHlgO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5LnRvVXBwZXJDYXNlKCkgPT09IGVudGl0eVNsdWdBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBgJHt2YWx1ZX0tY29weWA7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZHVwbGljYXRlRXZlbnREYXRhWyBrZXkgYXMga2V5b2YgdHlwZW9mIGR1cGxpY2F0ZUV2ZW50RGF0YSBdID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZHVwbGljYXRlRXZlbnREYXRhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBkdXBsaWNhdGUgZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBkdXBsaWNhdGUuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGR1cGxpY2F0ZWQgZW50aXR5LlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3QgZW50aXR5SWQgPSB7IGlkOiAxMjMsIG5hbWU6ICdleGFtcGxlJyB9O1xuICAgICAqIGNvbnN0IGR1cGxpY2F0ZWRFbnRpdHkgPSBhd2FpdCBkdXBsaWNhdGUoZW50aXR5SWQpO1xuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnaW5mbycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3dyaXRlJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UgfSkgPT4gKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgZHVwbGljYXRlKGlkOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxDcmVhdGVFbnRpdHlSZXNwb25zZTxTPj4ge1xuICAgICAgICBjb25zdCBkdXBsaWNhdGVFdmVudERhdGEgPSBhd2FpdCB0aGlzLm1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhKGlkKTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY3JlYXRlKGR1cGxpY2F0ZUV2ZW50RGF0YSwgY3R4KTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBzaG91bGQgYmUgcGFydCBvZiBzb21lIGNvbmZpZ1xuICAgIHByb3RlY3RlZCBkZWxpbWl0ZXJzUmVnZXggPSAvKD86JnwgfCx8XFwrKSsvO1xuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIGEgbGlzdCBvZiBlbnRpdGllcyBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgcXVlcnkuXG4gICAgICogLSBJZiBubyBzcGVjaWZpYyBhdHRyaWJ1dGVzIGFyZSBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIC0gSWYgYSBzZWFyY2ggdGVybSBpcyBwcm92aWRlZCBpbiB0aGUgcXVlcnkgaXQgd2lsbCBzcGxpdCB0aGUgc2VhcmNoIHRlcm0gYnkgYC8oPzomfCB8LHxcXCspKy9gIFJlZ2V4IGFuZCB3aWxsIGZpbHRlciBvdXQgZW1wdHkgc3RyaW5ncy5cbiAgICAgKiAtIElmIHNlYXJjaCBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2Ygc2VhcmNoYWJsZSBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBxdWVyeSAtIFRoZSBxdWVyeSBvYmplY3QgY29udGFpbmluZyBmaWx0ZXJzLCBzZWFyY2gga2V5d29yZHMsIGFuZCBhdHRyaWJ1dGVzLlxuICAgICAqIEByZXR1cm5zIEEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSBsaXN0IG9mIGVudGl0aWVzIGFuZCB0aGUgb3JpZ2luYWwgcXVlcnkuXG4gICAgICovXG4gICAgQE9ic2VydmVkKHtcbiAgICAgICAgdHJhY2U6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3JlYWQnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSwgYXJncyB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgWyBxdWVyeSBdID0gYXJncyBhcyBbIHsgZmlsdGVycz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0gfCB1bmRlZmluZWQgXTtcbiAgICAgICAgICAgICAgICBjb25zdCBoYXNGaWx0ZXJzID0gISFxdWVyeT8uZmlsdGVycyAmJiBPYmplY3Qua2V5cyhxdWVyeS5maWx0ZXJzKS5sZW5ndGggPiAwO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc0ZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZpbmlzaDogKHsgcmVzdWx0IH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gcmVzdWx0IGFzIHsgZGF0YT86IHVua25vd25bXTsgY3Vyc29yPzogdW5rbm93biB9IHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdENvdW50ID0gQXJyYXkuaXNBcnJheShyPy5kYXRhKSA/IHIhLmRhdGEubGVuZ3RoIDogMDtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7IGhhc0N1cnNvcjogISFyPy5jdXJzb3IgfSxcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljczogeyByZXN1bHRDb3VudCB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGxpc3QocXVlcnk6IEVudGl0eVF1ZXJ5PFM+ID0ge30sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgaWYgKCFxdWVyeS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBxdWVyeS5hdHRyaWJ1dGVzID0gdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZm9yIGxpc3RpbmcgQVBJIGF0dHJpYnV0ZXMgd291bGQgYmUgYW4gYXJyYXlcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocXVlcnkuYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHF1ZXJ5LmF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgcXVlcnkuYXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzLnNwbGl0KCcsJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzIHx8IGlzRW1wdHkocXVlcnkuc2VhcmNoQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRmlsdGVyR3JvdXAgPSBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcyhxdWVyeS5zZWFyY2gsIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuZmlsdGVycyA9IGFkZEZpbHRlckdyb3VwVG9FbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPihzZWFyY2hGaWx0ZXJHcm91cCBhcyBhbnksIHF1ZXJ5LmZpbHRlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXMgPSBhd2FpdCBsaXN0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBEZWNvbXByZXNzIGFsbCByZWNvcmRzXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSBlbnRpdGllcy5kYXRhLm1hcChyZWNvcmQgPT4gdGhpcy5kZWNvbXByZXNzRmllbGRzKHJlY29yZCkpO1xuXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSB0aGlzLnNlcmlhbGl6ZVJlY29yZHMoZW50aXRpZXMuZGF0YSwgcXVlcnkuYXR0cmlidXRlcyk7XG5cbiAgICAgICAgaWYgKHF1ZXJ5LmF0dHJpYnV0ZXMgJiYgZW50aXRpZXMuZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhxdWVyeS5hdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLy8gb25seSBhdHRyaWJ1dGVzIGluIGh5ZHJhdGUgb3B0aW9ucyB0aGF0IGhhdmUgcmVsYXRpb24gbWV0YWRhdGEgYXR0YWNoZWQgdG8gdGhlbSBuZWVkcyB0byBiZSBoeWRyYXRlZFxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdGllcy5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IC4uLmVudGl0aWVzLCBxdWVyeSB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogRXhlY3V0ZXMgYSBxdWVyeSBvbiB0aGUgZW50aXR5LlxuICAgICAqIC0gSWYgbm8gc3BlY2lmaWMgYXR0cmlidXRlcyBhcmUgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2YgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAtIElmIGEgc2VhcmNoIHRlcm0gaXMgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5IGl0IHdpbGwgc3BsaXQgdGhlIHNlYXJjaCB0ZXJtIGJ5IGAvKD86JnwgfCx8XFwrKSsvYCBSZWdleCBhbmQgd2lsbCBmaWx0ZXIgb3V0IGVtcHR5IHN0cmluZ3MuXG4gICAgICogICAtLSBJZiBzZWFyY2ggYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIHNlYXJjaGFibGUgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAgIC0tIElmIHRoZXJlIGFyZSBhbnkgbm9uLWVtcHR5IHNlYXJjaC10ZXJtcywgaXQgd2lsbCBhZGQgYSBmaWx0ZXIgZ3JvdXAgdG8gdGhlIHF1ZXJ5IGJhc2VkIG9uIHRoZSBzZWFyY2gga2V5d29yZHMuXG4gICAgICogQHBhcmFtIHF1ZXJ5IC0gVGhlIGVudGl0eSBxdWVyeSB0byBleGVjdXRlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXN1bHQgb2YgdGhlIHF1ZXJ5LlxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UsIGFyZ3MgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgcXVlcnkgXSA9IGFyZ3MgYXMgWyB7IGZpbHRlcnM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9IHwgdW5kZWZpbmVkIF07XG4gICAgICAgICAgICAgICAgY29uc3QgaGFzRmlsdGVycyA9ICEhcXVlcnk/LmZpbHRlcnMgJiYgT2JqZWN0LmtleXMocXVlcnkuZmlsdGVycykubGVuZ3RoID4gMDtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAoaW5zdGFuY2UgYXMgeyBnZXRFbnRpdHlOYW1lKCk6IHN0cmluZyB9KS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBoYXNGaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmaW5pc2g6ICh7IHJlc3VsdCB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgciA9IHJlc3VsdCBhcyB7IGRhdGE/OiB1bmtub3duW10gfSB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHRDb3VudCA9IEFycmF5LmlzQXJyYXkocj8uZGF0YSkgPyByIS5kYXRhLmxlbmd0aCA6IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHsgbWV0cmljczogeyByZXN1bHRDb3VudCB9IH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBxdWVyeShxdWVyeTogRW50aXR5UXVlcnk8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgY29uc3QgeyBhdHRyaWJ1dGVzIH0gPSBxdWVyeTtcblxuICAgICAgICBsZXQgc2VsZWN0QXR0cmlidXRlczogRW50aXR5U2VsZWN0aW9uczxTPiB8IHVuZGVmaW5lZCA9IGF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3RBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgLy8gcGFyc2UgdGhlIGxpc3Qgb2YgZG90LXNlcGFyYXRlZCBhdHRyaWJ1dGUtaWRlbnRpZmllcnMgcGF0aHMgYW5kIGVuc3VyZSBhbGwgdGhlIHJlcXVpcmVkIG1ldGFkYXRhIGlzIHRoZXJlXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhzZWxlY3RBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIHNlbGVjdEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBlbnN1cmUgYWxsIHRoZSBwcm92aWRlZCBzZWxlY3QgYXR0cmlidXRlcyBoYXMgcmVxdWlyZWQgbWV0YWRhdGEgYWxsIHRoZSB3YXkgZG93biB0byB0aGUgbGVhZiBsZXZlbFxuICAgICAgICAgICAgc2VsZWN0QXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBzZWxlY3RBdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlckdyb3VwID0gbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMocXVlcnkuc2VhcmNoLCBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKTtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LmZpbHRlcnMgPSBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4oc2VhcmNoRmlsdGVyR3JvdXAgYXMgYW55LCBxdWVyeS5maWx0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzID0gYXdhaXQgcXVlcnlFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIERlY29tcHJlc3MgYWxsIHJlY29yZHNcbiAgICAgICAgZW50aXRpZXMuZGF0YSA9IGVudGl0aWVzLmRhdGEubWFwKHJlY29yZCA9PiB0aGlzLmRlY29tcHJlc3NGaWVsZHMocmVjb3JkKSk7XG5cbiAgICAgICAgZW50aXRpZXMuZGF0YSA9IHRoaXMuc2VyaWFsaXplUmVjb3JkcyhlbnRpdGllcy5kYXRhLCBzZWxlY3RBdHRyaWJ1dGVzKTtcblxuICAgICAgICBpZiAoc2VsZWN0QXR0cmlidXRlcyAmJiBlbnRpdGllcy5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKHNlbGVjdEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAvLyBvbmx5IGF0dHJpYnV0ZXMgaW4gaHlkcmF0ZSBvcHRpb25zIHRoYXQgaGF2ZSByZWxhdGlvbiBtZXRhZGF0YSBhdHRhY2hlZCB0byB0aGVtIG5lZWRzIHRvIGJlIGh5ZHJhdGVkXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0aWVzLmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgLi4uZW50aXRpZXMsIHF1ZXJ5IH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVXBkYXRlcyBhbiBlbnRpdHkgaW4gdGhlIGRhdGFiYXNlLlxuICAgICAqXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqIEBwYXJhbSBkYXRhIC0gUGF0Y2ggcGF5bG9hZC4gVG9wLWxldmVsIEpTT04gYG51bGxgIHZhbHVlcyBhcmUgdHJlYXRlZCBhcyBtZXJnZS1wYXRjaCDigJxjbGVhcuKAnTpcbiAgICAgKiAgIHRoZXkgYmVjb21lIER5bmFtb0RCIGF0dHJpYnV0ZSByZW1vdmFscyAoc2VlIGB1cGRhdGVFbnRpdHlgIC8gYHBhcnRpdGlvblRvcExldmVsSnNvbk51bGxzYCBpbiBgbXV0YXRpb24tdXRpbHNgKSxcbiAgICAgKiAgIG5vdCBsaXRlcmFsIG51bGxzIHBhc3NlZCB0byBFbGVjdHJvREIgYHNldCgpYC5cbiAgICAgKiBAcGFyYW0gb3BlcmF0b3JzIC0gT3B0aW9uYWwgRWxlY3Ryb0RCIHBhdGNoIG9wZXJhdG9yczsgYG9wZXJhdG9ycy5yZW1vdmVgIG1lcmdlcyB3aXRoIEpTT04gYG51bGxgIGtleXMuXG4gICAgICogQHJldHVybnMgVGhlIHVwZGF0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnaW5mbycgfSxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3dyaXRlJyB9LFxuICAgICAgICBleHRyYWN0OiB7XG4gICAgICAgICAgICBzdGFydDogKHsgaW5zdGFuY2UgfSkgPT4gKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbiAgICBwdWJsaWMgYXN5bmMgdXBkYXRlKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+LCBkYXRhOiBVcGRhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4sIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycywgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8VXBkYXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcblxuICAgICAgICAvLyBJbmplY3QgYWN0b3IgY29udGV4dFxuICAgICAgICBsZXQgZW5oYW5jZWREYXRhID0gdGhpcy5pbmplY3RBY3RvckNvbnRleHQoZGF0YSBhcyBhbnksICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUsIHJlYWRPbmx5IH0gb2YgdW5pcXVlRmllbGRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJlYWRPbmx5KSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBlbmhhbmNlZERhdGFbIG5hbWUgYXMga2V5b2YgdHlwZW9mIGVuaGFuY2VkRGF0YSBdO1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gZW5oYW5jZWREYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2YWx1ZSA9IGVuaGFuY2VkRGF0YVsgbmFtZSBhcyBrZXlvZiB0eXBlb2YgZW5oYW5jZWREYXRhIF07XG4gICAgICAgICAgICAgICAgICAgIC8vIFNraXAgd2hlbiBjbGVhcmluZyBvcHRpb25hbCB1bmlxdWUgZmllbGQg4oCUIHVwZGF0ZUVudGl0eSBtYXBzIG51bGwg4oaSIHJlbW92ZTsgbm8gZXEtbnVsbCB1bmlxdWVuZXNzIGNoZWNrLlxuICAgICAgICAgICAgICAgICAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlbmVzc0NoZWNrcy5wdXNoKCgpID0+IHRoaXMuY2hlY2tVbmlxdWVuZXNzQW5kVXBkYXRlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBheWxvYWRUb1VwZGF0ZTogZW5oYW5jZWREYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb21wcmVzcyBmaWVsZHMgYmVmb3JlIHdyaXRpbmdcbiAgICAgICAgZW5oYW5jZWREYXRhID0gdGhpcy5jb21wcmVzc0ZpZWxkcyhlbmhhbmNlZERhdGEpO1xuXG4gICAgICAgIGNvbnN0IHVwZGF0ZWRFbnRpdHkgPSBhd2FpdCB1cGRhdGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgZGF0YTogZW5oYW5jZWREYXRhLFxuICAgICAgICAgICAgb3BlcmF0b3JzOiBvcGVyYXRvcnMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIERlY29tcHJlc3MgZmllbGRzIGFmdGVyIHJlYWRpbmdcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnVwZGF0ZWRFbnRpdHksXG4gICAgICAgICAgICBkYXRhOiB1cGRhdGVkRW50aXR5LmRhdGEgPyB0aGlzLmRlY29tcHJlc3NGaWVsZHModXBkYXRlZEVudGl0eS5kYXRhKSA6IHVwZGF0ZWRFbnRpdHkuZGF0YVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGV0ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBiZSBkZWxldGVkLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBkZWxldGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ3dhcm4nIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdkZWxldGUnIH0sXG4gICAgICAgIGV4dHJhY3Q6IHtcbiAgICAgICAgICAgIHN0YXJ0OiAoeyBpbnN0YW5jZSB9KSA9PiAoe1xuICAgICAgICAgICAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogKGluc3RhbmNlIGFzIHsgZ2V0RW50aXR5TmFtZSgpOiBzdHJpbmcgfSkuZ2V0RW50aXR5TmFtZSgpIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBkZWxldGUoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8RGVsZXRlRW50aXR5UmVzcG9uc2U8Uz4+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBkZWxldGUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGlkZW50aWZpZXJzOmAsIGlkZW50aWZpZXJzKTtcblxuICAgICAgICAgICAgY29uc3QgZGVsZXRlZEVudGl0eSA9IGF3YWl0IGRlbGV0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgICAgICAgICAgYWN0b3I6IGN0eD8uYWN0b3IsXG4gICAgICAgICAgICAgICAgdGVuYW50OiBjdHg/LmFjdG9yPy50ZW5hbnRJZCxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gZGVsZXRlZEVudGl0eTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byBkZWxldGUgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgYmF0Y2ggZGVsZXRpbmcgZW50aXRpZXMuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuaWRlbnRpZmllcnMgLSBBcnJheSBvZiBlbnRpdHkgaWRlbnRpZmllcnMgdG8gZGVsZXRlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIHRvIHBlcmZvcm0gKGRlZmF1bHQ6IDEpLlxuICAgICAqIEBwYXJhbSBjdHggLSBPcHRpb25hbCBleGVjdXRpb24gY29udGV4dCBjb250YWluaW5nIGFjdG9yIGluZm9ybWF0aW9uLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBEZWxldGUgbXVsdGlwbGUgZW50aXRpZXNcbiAgICAgKiBjb25zdCByZXN1bHQgPSBhd2FpdCBzZXJ2aWNlLmJhdGNoRGVsZXRlKHtcbiAgICAgKiAgIGlkZW50aWZpZXJzOiBbXG4gICAgICogICAgIHsgaWQ6ICdpdGVtMScgfSxcbiAgICAgKiAgICAgeyBpZDogJ2l0ZW0yJyB9LFxuICAgICAqICAgICB7IGlkOiAnaXRlbTMnIH1cbiAgICAgKiAgIF0sXG4gICAgICogICBjb25jdXJyZW50OiAyXG4gICAgICogfSk7XG4gICAgICogXG4gICAgICogaWYgKHJlc3VsdC51bnByb2Nlc3NlZC5sZW5ndGggPiAwKSB7XG4gICAgICogICBjb25zb2xlLmxvZygnU29tZSBpdGVtcyB3ZXJlIG5vdCBkZWxldGVkOicsIHJlc3VsdC51bnByb2Nlc3NlZCk7XG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnd2FybicgfSwgLy8gQmF0Y2ggZGVsZXRlcyBhcmUgY3JpdGljYWxcbiAgICAgICAgc291cmNlVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ2RlbGV0ZScsIGJhdGNoOiAndHJ1ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIG9wdGlvbnMgXSA9IGFyZ3MgYXMgWyB7IGlkZW50aWZpZXJzPzogdW5rbm93bltdOyBjb25jdXJyZW50PzogbnVtYmVyIH0gXTtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaFNpemUgPSBBcnJheS5pc0FycmF5KG9wdGlvbnM/LmlkZW50aWZpZXJzKSA/IG9wdGlvbnMuaWRlbnRpZmllcnMubGVuZ3RoIDogMDtcbiAgICAgICAgICAgICAgICBjb25zdCBjb25jdXJyZW50ID0gdHlwZW9mIG9wdGlvbnM/LmNvbmN1cnJlbnQgPT09ICdudW1iZXInID8gb3B0aW9ucy5jb25jdXJyZW50IDogMTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7IGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSB9LFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNzOiB7IGJhdGNoU2l6ZSwgY29uY3VycmVudCB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmaW5pc2g6ICh7IHJlc3VsdCB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgciA9IHJlc3VsdCBhcyB7IGRhdGE/OiB1bmtub3duW107IHVucHJvY2Vzc2VkPzogdW5rbm93bltdIH0gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgY29uc3QgZGVsZXRlZENvdW50ID0gQXJyYXkuaXNBcnJheShyPy5kYXRhKSA/IHIhLmRhdGEubGVuZ3RoIDogMDtcbiAgICAgICAgICAgICAgICBjb25zdCB1bnByb2Nlc3NlZENvdW50ID0gQXJyYXkuaXNBcnJheShyPy51bnByb2Nlc3NlZCkgPyByIS51bnByb2Nlc3NlZC5sZW5ndGggOiAwO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IG1ldHJpY3M6IHsgZGVsZXRlZENvdW50LCB1bnByb2Nlc3NlZENvdW50IH0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIGJhdGNoRGVsZXRlKG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyXG4gICAgfSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gY291bnQ6ICR7aWRlbnRpZmllcnMubGVuZ3RofWAsIHtcbiAgICAgICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGVsZXRlQmF0Y2hFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgICAgIGlkczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgICAgICAgICBhY3RvcjogY3R4Py5hY3RvcixcbiAgICAgICAgICAgICAgICB0ZW5hbnQ6IGN0eD8uYWN0b3I/LnRlbmFudElkLFxuICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBFbGVjdHJvREIgYmF0Y2ggZGVsZXRlIHJldHVybnMgeyB1bnByb2Nlc3NlZDogQXJyYXkgfVxuICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChyZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgICAgY29uc3QgZGF0YUNvdW50ID0gcmVzdWx0LmRhdGE/Lmxlbmd0aDtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcHJvY2Vzc2VkOiAke2lkZW50aWZpZXJzLmxlbmd0aH0sIGRhdGFDb3VudDogJHtkYXRhQ291bnR9LCB1bnByb2Nlc3NlZDogJHt1bnByb2Nlc3NlZENvdW50fWApO1xuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGJhdGNoIGRlbGV0ZSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBlbnRpdGllcyBiYXNlZCBvbiBhIHF1ZXJ5IGZpbHRlci5cbiAgICAgKiBUaGlzIG1ldGhvZCBxdWVyaWVzIGZvciBlbnRpdGllcyBtYXRjaGluZyB0aGUgZmlsdGVyIGFuZCB0aGVuIGJhdGNoIGRlbGV0ZXMgdGhlbS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyBieSBxdWVyeS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5maWx0ZXJzIC0gVGhlIGZpbHRlciBjcml0ZXJpYSB0byBtYXRjaCBlbnRpdGllcyBmb3IgZGVsZXRpb24uXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBkZWxldGUgaW4gZWFjaCBiYXRjaCAoZGVmYXVsdDogMjUpLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBOdW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhJdGVtcyAtIE9wdGlvbmFsIG1heGltdW0gbnVtYmVyIG9mIGl0ZW1zIHRvIGRlbGV0ZSAoc2FmZXR5IGxpbWl0KS5cbiAgICAgKiBAcGFyYW0gY3R4IC0gT3B0aW9uYWwgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvcm1hdGlvbi5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3Qgd2l0aCBkZWxldGlvbiBzdGF0aXN0aWNzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIERlbGV0ZSBhbGwgaW5hY3RpdmUgdXNlcnNcbiAgICAgKiBjb25zdCByZXN1bHQgPSBhd2FpdCB1c2VyU2VydmljZS5kZWxldGVCeVF1ZXJ5KHtcbiAgICAgKiAgIGZpbHRlcnM6IHtcbiAgICAgKiAgICAgc3RhdHVzOiB7IGVxOiAnaW5hY3RpdmUnIH0sXG4gICAgICogICAgIGxhc3RMb2dpbkF0OiB7IGx0OiAnMjAyMy0wMS0wMScgfVxuICAgICAqICAgfSxcbiAgICAgKiAgIGJhdGNoU2l6ZTogNTAsXG4gICAgICogICBtYXhJdGVtczogMTAwMFxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIGNvbnNvbGUubG9nKGBEZWxldGVkICR7cmVzdWx0LmRlbGV0ZWRDb3VudH0gaXRlbXMsICR7cmVzdWx0LmZhaWxlZENvdW50fSBmYWlsZWRgKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ3dhcm4nIH0sIC8vIEJ1bGsgZGVsZXRlcyBhcmUgZGFuZ2Vyb3VzXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdkZWxldGUnLCBiYXRjaDogJ3RydWUnLCBidWxrOiAndHJ1ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIG9wdGlvbnMgXSA9IGFyZ3MgYXMgWyB7IGZpbHRlcnM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjsgYmF0Y2hTaXplPzogbnVtYmVyOyBtYXhJdGVtcz86IG51bWJlciB9IHwgdW5kZWZpbmVkIF07XG4gICAgICAgICAgICAgICAgY29uc3QgbWF4SXRlbXMgPSBvcHRpb25zPy5tYXhJdGVtcztcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaFNpemUgPSB0eXBlb2Ygb3B0aW9ucz8uYmF0Y2hTaXplID09PSAnbnVtYmVyJyA/IG9wdGlvbnMuYmF0Y2hTaXplIDogMjU7XG4gICAgICAgICAgICAgICAgcmV0dXJuICh7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IChpbnN0YW5jZSBhcyB7IGdldEVudGl0eU5hbWUoKTogc3RyaW5nIH0pLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc0ZpbHRlcnM6ICgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICEhb3B0aW9ucz8uZmlsdGVycyAmJiBPYmplY3Qua2V5cyhvcHRpb25zLmZpbHRlcnMpLmxlbmd0aCA+IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KSgpLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBiYXRjaFNpemUsXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi4odHlwZW9mIG1heEl0ZW1zID09PSAnbnVtYmVyJyA/IHsgbWF4SXRlbXMgfSA6IHt9KSxcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZpbmlzaDogKHsgcmVzdWx0IH0pID0+ICh7XG4gICAgICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGVkQ291bnQ6IChyZXN1bHQgYXMgeyBkZWxldGVkQ291bnQ/OiBudW1iZXIgfSB8IHVuZGVmaW5lZCk/LmRlbGV0ZWRDb3VudCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICBmYWlsZWRDb3VudDogKHJlc3VsdCBhcyB7IGZhaWxlZENvdW50PzogbnVtYmVyIH0gfCB1bmRlZmluZWQpPy5mYWlsZWRDb3VudCB8fCAwLFxuICAgICAgICAgICAgICAgICAgICB0b3RhbFByb2Nlc3NlZDogKHJlc3VsdCBhcyB7IHRvdGFsUHJvY2Vzc2VkPzogbnVtYmVyIH0gfCB1bmRlZmluZWQpPy50b3RhbFByb2Nlc3NlZCB8fCAwLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBkZWxldGVCeVF1ZXJ5KG9wdGlvbnM6IHtcbiAgICAgICAgZmlsdGVyczogRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4sXG4gICAgICAgIGJhdGNoU2l6ZT86IG51bWJlcixcbiAgICAgICAgY29uY3VycmVudD86IG51bWJlcixcbiAgICAgICAgbWF4SXRlbXM/OiBudW1iZXJcbiAgICB9LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IGZpbHRlcnMsIGJhdGNoU2l6ZSA9IDI1LCBjb25jdXJyZW50ID0gMSwgbWF4SXRlbXMgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENhbGxlZCB+IGRlbGV0ZUJ5UXVlcnkgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgICAgIGJhdGNoU2l6ZSxcbiAgICAgICAgICAgICAgICBtYXhJdGVtc1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFNhZmV0eSBjaGVjazogcmVxdWlyZSBmaWx0ZXJzIHRvIHByZXZlbnQgYWNjaWRlbnRhbCBkZWxldGlvbiBvZiBhbGwgcmVjb3Jkc1xuICAgICAgICAgICAgaWYgKCFmaWx0ZXJzIHx8IGlzRW1wdHlPYmplY3REZWVwKGZpbHRlcnMpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdkZWxldGVCeVF1ZXJ5IHJlcXVpcmVzIGZpbHRlcnMgdG8gcHJldmVudCBhY2NpZGVudGFsIGRlbGV0aW9uIG9mIGFsbCByZWNvcmRzLiBVc2Ugc2NhbiB3aXRoIGV4cGxpY2l0IGNvbmZpcm1hdGlvbiBpZiB5b3UgbmVlZCB0byBkZWxldGUgYWxsIHJlY29yZHMuJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBkZWxldGVkQ291bnQgPSAwO1xuICAgICAgICAgICAgbGV0IGZhaWxlZENvdW50ID0gMDtcbiAgICAgICAgICAgIGxldCBjdXJzb3I6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgICAgICAgbGV0IHRvdGFsUHJvY2Vzc2VkID0gMDtcblxuICAgICAgICAgICAgLy8gUXVlcnkgYW5kIGRlbGV0ZSBpbiBiYXRjaGVzXG4gICAgICAgICAgICBkbyB7XG4gICAgICAgICAgICAgICAgLy8gRmV0Y2ggYSBiYXRjaCBvZiBpdGVtcyB0byBkZWxldGVcbiAgICAgICAgICAgICAgICBjb25zdCBxdWVyeVJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoe1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICBwYWdpbmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb3VudDogYmF0Y2hTaXplLFxuICAgICAgICAgICAgICAgICAgICAgICAgY3Vyc29yOiBjdXJzb3IgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3JkZXI6ICdhc2MnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGFnZXI6ICdjdXJzb3InXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LCBjdHgpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgaXRlbXNUb0RlbGV0ZSA9IHF1ZXJ5UmVzdWx0LmRhdGE7XG5cbiAgICAgICAgICAgICAgICBpZiAoIWl0ZW1zVG9EZWxldGUgfHwgaXRlbXNUb0RlbGV0ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYERlbGV0aW5nIGJhdGNoIG9mICR7aXRlbXNUb0RlbGV0ZS5sZW5ndGh9IGl0ZW1zYCk7XG5cbiAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IGlkZW50aWZpZXJzIGZyb20gdGhlIGZldGNoZWQgaXRlbXNcbiAgICAgICAgICAgICAgICBjb25zdCBpZGVudGlmaWVycyA9IGl0ZW1zVG9EZWxldGUubWFwKGl0ZW0gPT5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaXRlbSBhcyBhbnkpXG4gICAgICAgICAgICAgICAgKSBhcyBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PjtcblxuICAgICAgICAgICAgICAgIC8vIEJhdGNoIGRlbGV0ZSB0aGUgaXRlbXNcbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVSZXN1bHQgPSBhd2FpdCB0aGlzLmJhdGNoRGVsZXRlKHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgICAgICB9LCBjdHgpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChkZWxldGVSZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGRhdGFDb3VudCA9IGRlbGV0ZVJlc3VsdC5kYXRhPy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2hEZWxldGVkQ291bnQgPSBpZGVudGlmaWVycy5sZW5ndGggLSB1bnByb2Nlc3NlZENvdW50O1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudCArPSBiYXRjaERlbGV0ZWRDb3VudDtcbiAgICAgICAgICAgICAgICBmYWlsZWRDb3VudCArPSB1bnByb2Nlc3NlZENvdW50O1xuICAgICAgICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkICs9IGl0ZW1zVG9EZWxldGUubGVuZ3RoO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEJhdGNoIHJlc3VsdDogJHtiYXRjaERlbGV0ZWRDb3VudH0gZGVsZXRlZCwgJHt1bnByb2Nlc3NlZENvdW50fSBmYWlsZWRgKTtcblxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGhpdCB0aGUgbWF4IGl0ZW1zIGxpbWl0XG4gICAgICAgICAgICAgICAgaWYgKG1heEl0ZW1zICYmIHRvdGFsUHJvY2Vzc2VkID49IG1heEl0ZW1zKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJlYWNoZWQgbWF4SXRlbXMgbGltaXQgb2YgJHttYXhJdGVtc30sIHN0b3BwaW5nIGRlbGV0aW9uYCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBjdXJzb3IgZm9yIG5leHQgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yIHx8IG51bGw7XG5cbiAgICAgICAgICAgIH0gd2hpbGUgKGN1cnNvcik7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbXBsZXRlZCB+IGRlbGV0ZUJ5UXVlcnkgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGRlbGV0ZWQ6ICR7ZGVsZXRlZENvdW50fSwgZmFpbGVkOiAke2ZhaWxlZENvdW50fWApO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudCxcbiAgICAgICAgICAgICAgICBmYWlsZWRDb3VudCxcbiAgICAgICAgICAgICAgICB0b3RhbFByb2Nlc3NlZFxuICAgICAgICAgICAgfTtcblxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSBieSBxdWVyeSBmb3IgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byBkZWxldGUgYnkgcXVlcnkgZm9yICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWJ1aWxkcyBhbGwgaW5kZXhlcyBmb3IgdGhlIGVudGl0eSBieSB3cml0aW5nIHRvIHRoZSBwcmltYXJ5IGluZGV4LlxuICAgICAqIFRoaXMgbWV0aG9kIGlzIHVzZWZ1bCBmb3IgbWFpbnRhaW5pbmcgZGF0YSBpbnRlZ3JpdHkgYW5kIGVuc3VyaW5nIGluZGV4ZXMgYXJlIHByb3Blcmx5IHVwZGF0ZWQuXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBPcHRpb25zIGZvciByZWJ1aWxkaW5nIHRoZSBpbmRleFxuICAgICAqIEBwYXJhbSBvcHRpb25zLmJhdGNoU2l6ZSAtIFRoZSBudW1iZXIgb2YgaXRlbXMgdG8gcHJvY2VzcyBpbiBlYWNoIGJhdGNoLiBEZWZhdWx0cyB0byAxMDAuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgaW5kZXggcmVidWlsZCBpcyBjb21wbGV0ZS5cbiAgICAgKi9cbiAgICBAT2JzZXJ2ZWQoe1xuICAgICAgICB0cmFjZTogeyBsZXZlbDogJ3dhcm4nIH0sIC8vIEluZGV4IHJlYnVpbGRzIGFyZSBjcml0aWNhbCBvcGVyYXRpb25zXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdtYWludGVuYW5jZScsIGJhdGNoOiAndHJ1ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+ICh7XG4gICAgICAgICAgICAgICAgdGFnczogeyBlbnRpdHlOYW1lOiAoaW5zdGFuY2UgYXMgeyBnZXRFbnRpdHlOYW1lKCk6IHN0cmluZyB9KS5nZXRFbnRpdHlOYW1lKCkgfSxcbiAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAgIGJhdGNoU2l6ZTogKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IFsgb3B0aW9ucyBdID0gYXJncyBhcyBbIHsgYmF0Y2hTaXplPzogbnVtYmVyIH0gfCB1bmRlZmluZWQgXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0eXBlb2Ygb3B0aW9ucz8uYmF0Y2hTaXplID09PSAnbnVtYmVyJyA/IG9wdGlvbnMuYmF0Y2hTaXplIDogMTAwO1xuICAgICAgICAgICAgICAgICAgICB9KSgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBmaW5pc2g6ICgpID0+ICh7XG4gICAgICAgICAgICAgICAgdGFnczogeyBjb21wbGV0ZWQ6IHRydWUgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG4gICAgcHVibGljIGFzeW5jIHJlYnVpbGRJbmRleChvcHRpb25zOiB7IGJhdGNoU2l6ZT86IG51bWJlciB9ID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHsgYmF0Y2hTaXplID0gMTAwIH0gPSBvcHRpb25zO1xuICAgICAgICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHRoaXMuZ2V0RW50aXR5TmFtZSgpO1xuICAgICAgICAgICAgY29uc3QgcmVwb3NpdG9yeSA9IHRoaXMuZ2V0UmVwb3NpdG9yeSgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdGFydGluZyBpbmRleCByZWJ1aWxkIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcblxuICAgICAgICAgICAgLy8gR2V0IGFsbCByZWNvcmRzIGZyb20gdGhlIHByaW1hcnkgaW5kZXhcbiAgICAgICAgICAgIGNvbnN0IGFsbFJlY29yZHMgPSBhd2FpdCByZXBvc2l0b3J5LnNjYW4uZ28oKTtcblxuICAgICAgICAgICAgaWYgKCFhbGxSZWNvcmRzLmRhdGEgfHwgYWxsUmVjb3Jkcy5kYXRhLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYE5vIHJlY29yZHMgZm91bmQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRm91bmQgJHthbGxSZWNvcmRzLmRhdGEubGVuZ3RofSByZWNvcmRzIHRvIHByb2Nlc3MgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHJlY29yZHMgaW4gYmF0Y2hlc1xuICAgICAgICAgICAgY29uc3QgdG90YWxSZWNvcmRzID0gYWxsUmVjb3Jkcy5kYXRhLmxlbmd0aDtcbiAgICAgICAgICAgIGNvbnN0IHRvdGFsQmF0Y2hlcyA9IE1hdGguY2VpbCh0b3RhbFJlY29yZHMgLyBiYXRjaFNpemUpO1xuXG4gICAgICAgICAgICBmb3IgKGxldCBiYXRjaEluZGV4ID0gMDsgYmF0Y2hJbmRleCA8IHRvdGFsQmF0Y2hlczsgYmF0Y2hJbmRleCsrKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBiYXRjaEluZGV4ICogYmF0Y2hTaXplO1xuICAgICAgICAgICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWluKHN0YXJ0ICsgYmF0Y2hTaXplLCB0b3RhbFJlY29yZHMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhdGNoID0gYWxsUmVjb3Jkcy5kYXRhLnNsaWNlKHN0YXJ0LCBlbmQpO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUHJvY2Vzc2luZyBiYXRjaCAke2JhdGNoSW5kZXggKyAxfS8ke3RvdGFsQmF0Y2hlc30gKCR7c3RhcnQgKyAxfS0ke2VuZH0gb2YgJHt0b3RhbFJlY29yZHN9IHJlY29yZHMpYCk7XG5cbiAgICAgICAgICAgICAgICAvLyBSZWJ1aWxkIGFsbCBpbmRleGVzIGJ5IHVwc2VydGluZyBlYWNoIHJlY29yZCB0byB0aGUgcHJpbWFyeSBpbmRleFxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIGJhdGNoKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBVc2UgdXBzZXJ0IHRvIGVuc3VyZSB0aGUgcmVjb3JkIGlzIHByb3Blcmx5IGluZGV4ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHJlcG9zaXRvcnkudXBzZXJ0KHJlY29yZCkuZ28oKTtcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIHJlY29yZDpgLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbXBsZXRlZCBpbmRleCByZWJ1aWxkIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gcmVidWlsZCBpbmRleCBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBEYXRhYmFzZUVycm9yKGBGYWlsZWQgdG8gcmVidWlsZCBpbmRleCBmb3IgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSW5mZXJzIHJlbGF0aW9uc2hpcHMgYmV0d2VlbiBlbnRpdGllcyBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgc2NoZW1hIGFuZCBzZWxlY3Rpb24tcGF0aHMuXG4gICAgICogQHBhcmFtIHNjaGVtYSBUaGUgZW50aXR5IHNjaGVtYS5cbiAgICAgKiBAcGFyYW0gcGF0aHMgVGhlIHBhcnNlZCBzZWxlY3Rpb24gcGF0aHMgZnJvbSBlLmcuIHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoKS5cbiAgICAgKiBAcGFyYW0gcGF0aEtleSBUaGUgY3VycmVudCBcInBhdGhcIiBzdHJpbmcgcmVwcmVzZW50aW5nIGhvdyB3ZSBhcnJpdmVkIGhlcmUgKGRlZmF1bHRzIHRvIHRoZSBlbnRpdHkgbmFtZSkuXG4gICAgICogQHBhcmFtIHZpc2l0ZWRQYXRocyBBIHNldCBvZiBwYXRoLXN0cmluZ3MgdmlzaXRlZCBzbyBmYXIgaW4gdGhpcyByZWN1cnNpb24gY2hhaW4gKHByZXZlbnRzIGN5Y2xlcykuXG4gICAgICogQHBhcmFtIG1heERlcHRoIE1heGltdW0gcmVjdXJzaW9uIGRlcHRoIChvcHRpb25hbCkuXG4gICAgICovXG4gICAgaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9uczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICAgICAgc2NoZW1hOiBFLFxuICAgICAgICBwYXRoczogUGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHMsXG4gICAgICAgIHBhdGhLZXk6IHN0cmluZyA9IHNjaGVtYS5tb2RlbC5lbnRpdHksXG4gICAgICAgIHZpc2l0ZWRQYXRoczogU2V0PHN0cmluZz4gPSBuZXcgU2V0PHN0cmluZz4oKSxcbiAgICAgICAgbWF4RGVwdGggPSA1XG4gICAgKTogSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHk8RT4ge1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdpbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zJywgeyBwYXRoS2V5LCBwYXRocyB9KTtcblxuICAgICAgICAvLyBJZiB3ZSBleGNlZWQgbWF4IGRlcHRoLCB3ZSBza2lwIGV4cGFuc2lvbnNcbiAgICAgICAgaWYgKG1heERlcHRoIDw9IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE1heCByZWN1cnNpb24gZGVwdGggcmVhY2hlZCBhdCBwYXRoS2V5PVwiJHtwYXRoS2V5fVwiYCk7XG4gICAgICAgICAgICByZXR1cm4ge30gYXMgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHk8RT47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbmZlcnJlZDogYW55ID0ge307XG5cbiAgICAgICAgLy8gTG9vcCBvdmVyIGVhY2ggYXR0cmlidXRlIGluIHRoZSBlbnRpdHkgc2NoZW1hXG4gICAgICAgIE9iamVjdC5lbnRyaWVzKHNjaGVtYS5hdHRyaWJ1dGVzKS5mb3JFYWNoKChbIGF0dHJpYnV0ZU5hbWUsIGF0dHJpYnV0ZU1ldGEgXSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYXR0VmFsID0gcGF0aHNbIGF0dHJpYnV0ZU5hbWUgXTtcbiAgICAgICAgICAgIGlmICghYXR0VmFsKSB7XG4gICAgICAgICAgICAgICAgLy8gTm90IHNlbGVjdGVkIGluIHRoZSB1c2VyJ3MgYXR0cmlidXRlc1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaXNSZWxhdGlvbmFsID0gISFhdHRyaWJ1dGVNZXRhLnJlbGF0aW9uO1xuXG4gICAgICAgICAgICAvLyBJZiB0aGUgYXR0cmlidXRlIGlzIG5vdCByZWxhdGlvbmFsIG9yIHRoZSB2YWx1ZSBpcyBhIGJvb2xlYW4sIHdlIGNhbiBpbmZlciB0aGUgYXR0cmlidXRlXG4gICAgICAgICAgICBpZiAoIWlzUmVsYXRpb25hbCB8fCBpc0Jvb2xlYW4oYXR0VmFsKSkge1xuICAgICAgICAgICAgICAgIGluZmVycmVkWyBhdHRyaWJ1dGVOYW1lIF0gPSBhdHRWYWw7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJdCdzIGEgcmVsYXRpb25hbCBhdHRyaWJ1dGU7IHByZXBhcmUgdG8gcmVjdXJzZVxuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25NZXRhID0gYXR0cmlidXRlTWV0YS5yZWxhdGlvbiE7XG4gICAgICAgICAgICBjb25zdCBuZXh0RW50aXR5TmFtZSA9IHJlbGF0aW9uTWV0YS5lbnRpdHlOYW1lO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBhIG5ldyBcInBhdGhcIiBzdHJpbmcgdG8gZGV0ZWN0IGN5Y2xlcyAoZS5nLiBcIlVzZXIuZ3JvdXBzLkdyb3VwLm1lbWJlcnMuVXNlclwiKVxuICAgICAgICAgICAgY29uc3QgbmV3UGF0aCA9IGAke3BhdGhLZXl9LiR7YXR0cmlidXRlTmFtZX0uJHtuZXh0RW50aXR5TmFtZX1gO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiB3ZSd2ZSBhbHJlYWR5IHZpc2l0ZWQgdGhpcyBwYXRoLCBpZiBzbyA9PiBza2lwIGV4cGFuc2lvbnMgZm9yIHRoaXMgYXR0cmlidXRlIG9ubHlcbiAgICAgICAgICAgIGlmICh2aXNpdGVkUGF0aHMuaGFzKG5ld1BhdGgpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU2tpcHBpbmcgY3ljIHJlbGF0aW9uIGV4cGFuc2lvbnMgZm9yOiAke25ld1BhdGh9YCk7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHNraXBwZWREdWVUb0N5Y2xlOiB0cnVlLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBNYXJrIHRoaXMgcGF0aCBhcyB2aXNpdGVkXG4gICAgICAgICAgICB2aXNpdGVkUGF0aHMuYWRkKG5ld1BhdGgpO1xuXG4gICAgICAgICAgICAvLyBSZWN1cnNlIHRvIHRoZSByZWxhdGVkIGVudGl0eSdzIHNjaGVtYVxuICAgICAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eVNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lPEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4obmV4dEVudGl0eU5hbWUpO1xuICAgICAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWU8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihuZXh0RW50aXR5TmFtZSk7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIHRoZSBcIm1ldGFcIiBvYmplY3QgdGhhdCB3ZSBzdG9yZVxuICAgICAgICAgICAgY29uc3QgbWV0YTogSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uID0ge1xuICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IG5leHRFbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHJlbGF0aW9uVHlwZTogcmVsYXRpb25NZXRhLnR5cGUsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllcnM6IGlzRnVuY3Rpb24ocmVsYXRpb25NZXRhLmlkZW50aWZpZXJzKVxuICAgICAgICAgICAgICAgICAgICA/IHJlbGF0aW9uTWV0YS5pZGVudGlmaWVycygpXG4gICAgICAgICAgICAgICAgICAgIDogcmVsYXRpb25NZXRhLmlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IHBhdGhTZWxlY3Rpb25BdHRyaWJ1dGVzID0gaXNPYmplY3QoYXR0VmFsKSA/IGF0dFZhbC5hdHRyaWJ1dGVzIDogdW5kZWZpbmVkOyAvLyBwcm92aWRlZCBieSB0aGUgdXNlciBcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uU2VsZWN0aW9uQXR0cmlidXRlcyA9IHJlbGF0aW9uTWV0YS5hdHRyaWJ1dGVzOyAvLyBkZWZpbmVkIGluIHRoZSByZWxhdGlvbiBkZWZpbml0aW9uXG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5RGVmYXVsdFNlbGVjdGlvbkF0dHJpYnV0ZXMgPSByZWxhdGVkRW50aXR5U2VydmljZS5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKCk7IC8vIGF1dG8gZ2VuIGJ5IGZyYW1ld29ya1xuXG4gICAgICAgICAgICAvLyBSZWN1cnNlIHRvIGV4cGFuZCBjaGlsZCdzIHJlbGF0aW9uc2hpcHNcbiAgICAgICAgICAgIG1ldGEuYXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyhcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2NoZW1hLFxuICAgICAgICAgICAgICAgIChwYXRoU2VsZWN0aW9uQXR0cmlidXRlcyB8fCByZWxhdGlvblNlbGVjdGlvbkF0dHJpYnV0ZXMgfHwgcmVsYXRlZEVudGl0eURlZmF1bHRTZWxlY3Rpb25BdHRyaWJ1dGVzKSBhcyBhbnksXG4gICAgICAgICAgICAgICAgbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgdmlzaXRlZFBhdGhzLFxuICAgICAgICAgICAgICAgIG1heERlcHRoIC0gMVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IG1ldGE7XG5cbiAgICAgICAgICAgIC8vIFJlbW92ZSB0aGlzIHBhdGggc28gc2libGluZ3MgY2FuIGFsc28gZXhwYW5kIGl0IGlmIG5lZWRlZFxuICAgICAgICAgICAgdmlzaXRlZFBhdGhzLmRlbGV0ZShuZXdQYXRoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGluZmVycmVkO1xuICAgIH1cblxuICAgIEBPYnNlcnZlZCh7XG4gICAgICAgIHRyYWNlOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgdGFnczogeyBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJywgc2VhcmNoOiAndHJ1ZScgfSxcbiAgICAgICAgZXh0cmFjdDoge1xuICAgICAgICAgICAgc3RhcnQ6ICh7IGluc3RhbmNlLCBhcmdzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIHF1ZXJ5IF0gPSBhcmdzIGFzIFsgeyBxPzogdW5rbm93bjsgZmlsdGVyPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfSB8IHVuZGVmaW5lZCBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGhhc1F1ZXJ5ID0gISFxdWVyeT8ucTtcbiAgICAgICAgICAgICAgICBjb25zdCBoYXNGaWx0ZXJzID0gISFxdWVyeT8uZmlsdGVyICYmIE9iamVjdC5rZXlzKHF1ZXJ5LmZpbHRlcikubGVuZ3RoID4gMDtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAoaW5zdGFuY2UgYXMgeyBnZXRFbnRpdHlOYW1lKCk6IHN0cmluZyB9KS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgICAgICAgICBoYXNRdWVyeSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhc0ZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZpbmlzaDogKHsgcmVzdWx0IH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gcmVzdWx0IGFzIHsgaGl0cz86IHVua25vd25bXTsgZXN0aW1hdGVkVG90YWxIaXRzPzogbnVtYmVyIH0gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgY29uc3QgaGl0Q291bnQgPSBBcnJheS5pc0FycmF5KHI/LmhpdHMpID8gciEuaGl0cy5sZW5ndGggOiAwO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvdGFsSGl0cyA9IHR5cGVvZiByPy5lc3RpbWF0ZWRUb3RhbEhpdHMgPT09ICdudW1iZXInID8gci5lc3RpbWF0ZWRUb3RhbEhpdHMgOiAwO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IG1ldHJpY3M6IHsgaGl0Q291bnQsIHRvdGFsSGl0cyB9IH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9KVxuICAgIHB1YmxpYyBhc3luYyBzZWFyY2gocXVlcnk6IEVudGl0eVNlYXJjaFF1ZXJ5PFM+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgaWYgKCFxdWVyeS5zZWxlY3QpIHtcbiAgICAgICAgICAgIC8vICogTm90ZTogd2UgZXhwZWN0IGFuIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lc1xuICAgICAgICAgICAgcXVlcnkuc2VsZWN0ID0gdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKSBhcyBhbnk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VhcmNoU2VydmljZS5zZWFyY2gocXVlcnksIHVuZGVmaW5lZCwgY3R4KTtcblxuICAgICAgICAvLyBEZWNvbXByZXNzIGhpdHMgaWYgcHJlc2VudFxuICAgICAgICBpZiAocmVzdWx0Py5oaXRzICYmIEFycmF5LmlzQXJyYXkocmVzdWx0LmhpdHMpKSB7XG4gICAgICAgICAgICByZXN1bHQuaGl0cyA9IHJlc3VsdC5oaXRzLm1hcChoaXQgPT4gdGhpcy5kZWNvbXByZXNzRmllbGRzKGhpdCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb21wcmVzcyBmaWVsZHMgbWFya2VkIHdpdGggYGNvbXByZXNzZWQ6IHRydWVgIGluIHNjaGVtYS5cbiAgICAgKiBDYWxsZWQgYXV0b21hdGljYWxseSBiZWZvcmUgd3JpdGluZyB0byBEQi5cbiAgICAgKi9cbiAgICBwcm90ZWN0ZWQgY29tcHJlc3NGaWVsZHM8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KGRhdGE6IFQpOiBUIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkuYXR0cmlidXRlcztcbiAgICAgICAgY29uc3QgcmVzdWx0ID0geyAuLi5kYXRhIH0gYXMgUmVjb3JkPHN0cmluZywgYW55PjtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgZmllbGROYW1lLCBhdHRyaWJ1dGUgXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgaWYgKCFhdHRyaWJ1dGUuY29tcHJlc3NlZCB8fCAhKGZpZWxkTmFtZSBpbiByZXN1bHQpKSBjb250aW51ZTtcblxuICAgICAgICAgICAgY29uc3QgdGhyZXNob2xkID0gdHlwZW9mIGF0dHJpYnV0ZS5jb21wcmVzc2VkID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgID8gYXR0cmlidXRlLmNvbXByZXNzZWQudGhyZXNob2xkXG4gICAgICAgICAgICAgICAgOiAxMCAqIDEwMjQ7IC8vIERlZmF1bHQgMTBLQlxuXG4gICAgICAgICAgICByZXN1bHRbIGZpZWxkTmFtZSBdID0gY29tcHJlc3NJZk5lZWRlZChyZXN1bHRbIGZpZWxkTmFtZSBdLCB0aHJlc2hvbGQpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdCBhcyBUO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlY29tcHJlc3MgZmllbGRzIHRoYXQgaGF2ZSBjb21wcmVzc2VkIGRhdGEuXG4gICAgICogQ2FsbGVkIGF1dG9tYXRpY2FsbHkgYWZ0ZXIgcmVhZGluZyBmcm9tIERCLlxuICAgICAqL1xuICAgIHByb3RlY3RlZCBkZWNvbXByZXNzRmllbGRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihkYXRhOiBUKTogVCB7XG4gICAgICAgIHJldHVybiBkZWNvbXByZXNzSXRlbShkYXRhKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiAqKk9wdC1pbioqIOKAlCBDUlVEIHBheWxvYWRzIGFyZSB1bmNoYW5nZWQuIE1lcmdlZCB2YWx1ZSBmb3IgYGZpZWxkUGF0aGAgKHN0b3JlZCBjb2x1bW4gKyBvdmVycmlkZSBtYXApLlxuICAgICAqIFVzZXMgYG1vZGVsLmRpc3BsYXlPdmVycmlkZXMuc3RvcmFnZUF0dHJpYnV0ZWAgb24gKip0aGlzKiogc2NoZW1hLiBGb3IgYW5vdGhlciBlbnRpdHnigJlzIHJvdywgdXNlXG4gICAgICogYHJlYWRTdG9yZWRWYWx1ZUF0UGF0aGAgKyBgcmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzYC5cbiAgICAgKiBSZXR1cm4gdHlwZSBpcyBgdW5rbm93bmAgKEpTT04pOyBuYXJyb3cgb3IgYXNzZXJ0IGZvciB5b3VyIERUTyAoZS5nLiBzdHJpbmcgVVJMIGZpZWxkcyBhcmUgc3RyaW5ncyBhdCBydW50aW1lKS5cbiAgICAgKi9cbiAgICBwdWJsaWMgcmVzb2x2ZUZpZWxkV2l0aERpc3BsYXlPdmVycmlkZXMoXG4gICAgICAgIHJlY29yZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICAgIGZpZWxkUGF0aDogc3RyaW5nLFxuICAgICAgICBvcHRpb25zPzogeyBjaGFubmVsPzogc3RyaW5nIH1cbiAgICApOiB1bmtub3duIHtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSB0aGlzLmdldERpc3BsYXlPdmVycmlkZU1hcChyZWNvcmQpO1xuICAgICAgICByZXR1cm4gcmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzKHtcbiAgICAgICAgICAgIHN0b3JlZFZhbHVlOiByZWFkU3RvcmVkVmFsdWVBdFBhdGgocmVjb3JkLCBmaWVsZFBhdGgpLFxuICAgICAgICAgICAgb3ZlcnJpZGVNYXAsXG4gICAgICAgICAgICBmaWVsZFBhdGgsXG4gICAgICAgICAgICBjaGFubmVsOiBvcHRpb25zPy5jaGFubmVsLFxuICAgICAgICB9KS5yZXNvbHZlZFZhbHVlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqICoqT3B0LWluKiog4oCUIENSVUQgcGF5bG9hZHMgYXJlIHVuY2hhbmdlZC4gUmVzb2x2ZXMgbXVsdGlwbGUgZmllbGRzIGZyb20gYSByb3cgdXNpbmdcbiAgICAgKiB0aGlzIGVudGl0eSBzY2hlbWEncyBgbW9kZWwuZGlzcGxheU92ZXJyaWRlcy5zdG9yYWdlQXR0cmlidXRlYC5cbiAgICAgKi9cbiAgICBwdWJsaWMgcmVzb2x2ZUZpZWxkc1dpdGhEaXNwbGF5T3ZlcnJpZGVzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgSyBleHRlbmRzIGtleW9mIFQgJiBzdHJpbmc+KFxuICAgICAgICByZWNvcmQ6IFQsXG4gICAgICAgIGZpZWxkczogcmVhZG9ubHkgS1tdLFxuICAgICAgICBvcHRpb25zPzogeyBjaGFubmVsPzogc3RyaW5nIH1cbiAgICApOiBQaWNrPFQsIEs+IHtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSB0aGlzLmdldERpc3BsYXlPdmVycmlkZU1hcChyZWNvcmQpO1xuICAgICAgICBjb25zdCByZXNvbHZlZCA9IHt9IGFzIFBpY2s8VCwgSz47XG4gICAgICAgIGZvciAoY29uc3QgZmllbGRQYXRoIG9mIGZpZWxkcykge1xuICAgICAgICAgICAgcmVzb2x2ZWRbIGZpZWxkUGF0aCBdID0gcmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzKHtcbiAgICAgICAgICAgICAgICBzdG9yZWRWYWx1ZTogcmVhZFN0b3JlZFZhbHVlQXRQYXRoKHJlY29yZCwgZmllbGRQYXRoKSxcbiAgICAgICAgICAgICAgICBvdmVycmlkZU1hcCxcbiAgICAgICAgICAgICAgICBmaWVsZFBhdGgsXG4gICAgICAgICAgICAgICAgY2hhbm5lbDogb3B0aW9ucz8uY2hhbm5lbCxcbiAgICAgICAgICAgIH0pLnJlc29sdmVkVmFsdWUgYXMgVFsgSyBdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXNvbHZlZDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldERpc3BsYXlPdmVycmlkZU1hcChyZWNvcmQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogRGlzcGxheU92ZXJyaWRlU3RvcmFnZSB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGNvbnN0IHVpID0gdGhpcy5zY2hlbWEubW9kZWwuZGlzcGxheU92ZXJyaWRlcztcbiAgICAgICAgcmV0dXJuIHVpPy5zdG9yYWdlQXR0cmlidXRlXG4gICAgICAgICAgICA/IChyZWNvcmRbIHVpLnN0b3JhZ2VBdHRyaWJ1dGUgXSBhcyBEaXNwbGF5T3ZlcnJpZGVTdG9yYWdlIHwgdW5kZWZpbmVkKVxuICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgfVxufVxuXG5jb25zdCBlbnRpdHlBdHRyaWJ1dGVMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ2VudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUnKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoYXR0SWQ6IHN0cmluZywgYXR0OiBFbnRpdHlBdHRyaWJ1dGUpOiBQYXJ0aWFsPEVudGl0eUF0dHJpYnV0ZT4gJiB7XG4gICAgaWQ6IHN0cmluZyxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgcHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdXG59IHtcblxuICAgIGNvbnN0IHsgbmFtZSwgdmFsaWRhdGlvbnMsIHJlcXVpcmVkLCByZWxhdGlvbiwgZGVmYXVsdDogZGVmYXVsdFZhbHVlLCBnZXQ6IF9nZXR0ZXIsIHNldDogX3NldHRlciwgd2F0Y2gsIC4uLnJlc3RNZXRhIH0gPSBhdHQ7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lLCAuLi5yZXN0UmVsYXRpb24gfSA9IHJlbGF0aW9uIHx8IHt9O1xuXG4gICAgY29uc3QgcmVsYXRpb25NZXRhID0gcmVsYXRlZEVudGl0eU5hbWUgPyB7IC4uLnJlc3RSZWxhdGlvbiwgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUgfSA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IHsgaXRlbXMsIHR5cGUsIHByb3BlcnRpZXMsIGFkZE5ld09wdGlvbiwgYWRkTmV3T3B0aW9uQ29uZmlnLCBmaWVsZFR5cGU6IGV4cGxpY2l0RmllbGRUeXBlLCBvcHRpb25zLCAuLi5yZXN0UmVzdE1ldGEgfSA9IHJlc3RNZXRhIGFzIGFueTtcblxuICAgIC8vIEluZmVyIGZpZWxkVHlwZSBmcm9tIHR5cGUgaWYgbm90IGV4cGxpY2l0bHkgcHJvdmlkZWRcbiAgICBsZXQgaW5mZXJyZWRGaWVsZFR5cGU6IHN0cmluZyB8IHVuZGVmaW5lZCA9IGV4cGxpY2l0RmllbGRUeXBlO1xuICAgIGlmICghaW5mZXJyZWRGaWVsZFR5cGUgJiYgdHlwZSkge1xuICAgICAgICBpZiAodHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdib29sZWFuJztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnbnVtYmVyJztcbiAgICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHR5cGUpKSB7XG4gICAgICAgICAgICAvLyBFbnVtIHR5cGUgbGlrZSBbJ2FjdGl2ZScsICdpbmFjdGl2ZSddXG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdzZWxlY3QnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnICYmIG9wdGlvbnMgJiYgQXJyYXkuaXNBcnJheShvcHRpb25zKSAmJiBvcHRpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIFN0cmluZyB3aXRoIG9wdGlvbnMgaXMgYSBzZWxlY3RcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ3NlbGVjdCc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ2FueScpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2pzb24nO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdtYXAnKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdtYXAnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnbGlzdCc7XG4gICAgICAgIH1cbiAgICAgICAgLy8gRm9yIGRhdGUgZmllbGRzLCBjaGVjayBhdHRyaWJ1dGUgbmFtZSBhcyBoaW50XG4gICAgICAgIGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBjb25zdCBsb3dlckF0dElkID0gYXR0SWQudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIC8vIE9ubHkgaW5mZXIgZGF0ZXRpbWUgZm9yIGZpZWxkcyB0aGF0IGFyZSBBQ1RVQUxMWSBkYXRlcywgbm90IGp1c3QgY29udGFpbiBcImRhdGVcIiBpbiB0aGUgbmFtZVxuICAgICAgICAgICAgLy8gRXhjbHVkZTogY2FsZW5kYXJEYXRlIChZWVlZLU1NLUREIGZvcm1hdCksIHVwZGF0ZWRCeS9jcmVhdGVkQnkgKHVzZXIgSURzKSwgZXRjLlxuICAgICAgICAgICAgaWYgKChsb3dlckF0dElkLmVuZHNXaXRoKCdhdCcpICYmIChsb3dlckF0dElkLmluY2x1ZGVzKCdkYXRlJykgfHwgbG93ZXJBdHRJZC5pbmNsdWRlcygndGltZScpKSkgfHxcbiAgICAgICAgICAgICAgICBsb3dlckF0dElkID09PSAnY3JlYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAndXBkYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAnZGVsZXRlZGF0JyB8fFxuICAgICAgICAgICAgICAgIGxvd2VyQXR0SWQgPT09ICdzY2hlZHVsZWRhdCcgfHwgbG93ZXJBdHRJZCA9PT0gJ3B1Ymxpc2hlZGF0JyB8fCBsb3dlckF0dElkID09PSAnZXhwaXJlc2F0Jykge1xuICAgICAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2RhdGV0aW1lJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci5kZWJ1ZyhgaW5mZXJyZWRGaWVsZFR5cGU6ICR7aW5mZXJyZWRGaWVsZFR5cGV9IGZvciBlbnRpdHkgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cImApO1xuICAgIH1cblxuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi5yZXN0UmVzdE1ldGEsXG4gICAgICAgIHR5cGUsXG4gICAgICAgIGlkOiBhdHRJZCxcbiAgICAgICAgbmFtZTogbmFtZSB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKGF0dElkKSxcbiAgICAgICAgcmVsYXRpb246IHJlbGF0aW9uTWV0YSBhcyBhbnksXG4gICAgICAgIGRlZmF1bHRWYWx1ZSxcbiAgICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25zIHx8IHJlcXVpcmVkID8gWyAncmVxdWlyZWQnIF0gOiBbXSxcbiAgICAgICAgaXNWaXNpYmxlOiAhKCdpc1Zpc2libGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzVmlzaWJsZSxcbiAgICAgICAgaXNFZGl0YWJsZTogISgnaXNFZGl0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNFZGl0YWJsZSxcbiAgICAgICAgaXNMaXN0YWJsZTogISgnaXNMaXN0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNMaXN0YWJsZSxcbiAgICAgICAgaXNDcmVhdGFibGU6ICEoJ2lzQ3JlYXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0NyZWF0YWJsZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiAhKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzRmlsdGVyYWJsZSxcbiAgICAgICAgaXNTZWFyY2hhYmxlOiAhKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzU2VhcmNoYWJsZSxcbiAgICB9XG5cbiAgICAvLyBBZGQgaW5mZXJyZWQgb3IgZXhwbGljaXQgZmllbGRUeXBlXG4gICAgaWYgKGluZmVycmVkRmllbGRUeXBlKSB7XG4gICAgICAgIGZvcm1hdHRlZC5maWVsZFR5cGUgPSBpbmZlcnJlZEZpZWxkVHlwZTtcbiAgICB9IGVsc2UgaWYgKCFleHBsaWNpdEZpZWxkVHlwZSAmJiB0eXBlICYmIHR5cGUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIExvZyB3YXJuaW5nIGZvciBub24tc3RyaW5nIHR5cGVzIHdlIGNvdWxkbid0IGluZmVyXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci53YXJuKGDimqDvuI8gQ291bGQgbm90IGluZmVyIGZpZWxkVHlwZSBmb3IgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cIi4gQ29uc2lkZXIgYWRkaW5nIGV4cGxpY2l0IGZpZWxkVHlwZS5gKTtcbiAgICB9XG5cbiAgICAvLyBBZGQgb3B0aW9ucyBiYWNrIGlmIHRoZXkgZXhpc3RcbiAgICBpZiAob3B0aW9ucykge1xuICAgICAgICBmb3JtYXR0ZWQub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgfVxuXG4gICAgLy8gUGFzcyB0aHJvdWdoIGJvdGggb2xkIGFuZCBuZXcgYWRkTmV3T3B0aW9uIGZvcm1hdHNcbiAgICBpZiAoYWRkTmV3T3B0aW9uQ29uZmlnKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IGFkZE5ld09wdGlvbkNvbmZpZztcbiAgICB9XG4gICAgaWYgKGFkZE5ld09wdGlvbikge1xuICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb24nIF0gPSBhZGROZXdPcHRpb247XG4gICAgfVxuXG4gICAgLy9cbiAgICAvLyAqKiBtYWtlIHN1cmUgdG8gbm90IG92ZXJyaWRlIHRoZSBpbm5lciBmaWVsZHMgb2YgYXR0cmlidXRlcyBsaWtlIGBsaXN0LVtpdGVtc10tW21hcF0tcHJvcGVydGllc2AgKipcbiAgICAvL1xuICAgIGlmICh0eXBlID09PSAnbWFwJykge1xuICAgICAgICBmb3JtYXR0ZWRbICdwcm9wZXJ0aWVzJyBdID0gT2JqZWN0LmVudHJpZXM8YW55Pihwcm9wZXJ0aWVzKS5tYXAoKFsgaywgdiBdKSA9PiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGssIHYpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdsaXN0JyAmJiBpdGVtcy50eXBlID09PSAnbWFwJykge1xuICAgICAgICBmb3JtYXR0ZWRbICdpdGVtcycgXSA9IHtcbiAgICAgICAgICAgIC4uLml0ZW1zLFxuICAgICAgICAgICAgcHJvcGVydGllczogT2JqZWN0LmVudHJpZXM8YW55PihpdGVtcy5wcm9wZXJ0aWVzKS5tYXAoKFsgaywgdiBdKSA9PiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGssIHYpKVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IGZvciBzZXQsIGVudW0sIGFuZCBjdXN0b20tdHlwZXNcblxuICAgIHJldHVybiBmb3JtYXR0ZWRcbn1cblxuZXhwb3J0IHR5cGUgVElPU2NoZW1hQXR0cmlidXRlID0gUmV0dXJuVHlwZTx0eXBlb2YgZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZT47XG5leHBvcnQgdHlwZSBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+ID0gTWFwPGtleW9mIFNbICdhdHRyaWJ1dGVzJyBdLCBUSU9TY2hlbWFBdHRyaWJ1dGU+O1xuXG4vKipcbiAqIENyZWF0ZXMgYW4gYWNjZXNzIHBhdHRlcm5zIHNjaGVtYSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgZW50aXR5IHNjaGVtYS5cbiAqIEBwYXJhbSBzY2hlbWEgVGhlIGVudGl0eSBzY2hlbWEuXG4gKiBAcmV0dXJucyBBIG1hcCBvZiBhY2Nlc3MgcGF0dGVybnMsIHdoZXJlIHRoZSBrZXlzIGFyZSB0aGUgaW5kZXggbmFtZXMgYW5kIHRoZSB2YWx1ZXMgYXJlIG1hcHMgb2YgYXR0cmlidXRlIG5hbWVzIGFuZCB0aGVpciBjb3JyZXNwb25kaW5nIHNjaGVtYSBhdHRyaWJ1dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHNjaGVtYTogUykge1xuICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbmV3IE1hcDxrZXlvZiBTWyAnaW5kZXhlcycgXSwgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPj4oKTtcblxuICAgIGZvciAoY29uc3QgaW5kZXhOYW1lIGluIHNjaGVtYS5pbmRleGVzKSB7XG4gICAgICAgIGNvbnN0IGluZGV4QXR0cmlidXRlczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPiA9IG5ldyBNYXAoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGlkeFBrQXR0IG9mIHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXS5way5jb21wb3NpdGUpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBpZHhQa0F0dCBdO1xuICAgICAgICAgICAgaW5kZXhBdHRyaWJ1dGVzLnNldChpZHhQa0F0dCwge1xuICAgICAgICAgICAgICAgIC4uLmVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaWR4UGtBdHQsIHsgLi4uYXR0LCByZXF1aXJlZDogdHJ1ZSB9KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IGlkeFNrQXR0IG9mIHNjaGVtYS5pbmRleGVzWyBpbmRleE5hbWUgXS5zaz8uY29tcG9zaXRlID8/IFtdKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgaWR4U2tBdHQgXTtcbiAgICAgICAgICAgIGluZGV4QXR0cmlidXRlcy5zZXQoaWR4U2tBdHQsIHtcbiAgICAgICAgICAgICAgICAuLi5lbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGlkeFNrQXR0LCB7IC4uLmF0dCwgcmVxdWlyZWQ6IHRydWUgfSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgYWNjZXNzUGF0dGVybnMuc2V0KGluZGV4TmFtZSwgaW5kZXhBdHRyaWJ1dGVzKTtcbiAgICB9XG5cbiAgICAvLyBtYWtlIHN1cmUgdGhlcmUncyBhIHByaW1hcnkgYWNjZXNzIHBhdHRlcm47XG4gICAgaWYgKCFhY2Nlc3NQYXR0ZXJucy5oYXMoJ3ByaW1hcnknKSkge1xuICAgICAgICBhY2Nlc3NQYXR0ZXJucy5zZXQoJ3ByaW1hcnknLCBhY2Nlc3NQYXR0ZXJucy52YWx1ZXMoKS5uZXh0KCkudmFsdWUhKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYWNjZXNzUGF0dGVybnM7XG59XG4iXX0=