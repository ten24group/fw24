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
     * Returns the default attribute names to be used for keyword search. Defaults to all string attributes which are not hidden and are not identifiers.
     * @returns {Array<string>} attribute names to be used for keyword search
    */
    getSearchableAttributeNames() {
        const attributeNames = [];
        const schema = this.getEntitySchema();
        for (const attName in schema.attributes) {
            const att = schema.attributes[attName];
            if (!att.hidden && !att.isIdentifier && att.type === 'string'
                &&
                    (!('isSearchable' in att) || att.isSearchable)) {
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
     * Returns the default attribute names that can be used for filtering the records. Defaults to all string attributes which are not hidden.
     *
     * @returns {Array<string>} attribute names to be used for keyword search
    */
    getFilterableAttributeNames() {
        const attributeNames = [];
        const schema = this.getEntitySchema();
        for (const attName in schema.attributes) {
            const att = schema.attributes[attName];
            if (!att.hidden && ['string', 'number'].includes(att.type)
                &&
                    (!('isFilterable' in att) || att.isFilterable)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBOEJBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQXF5REQsZ0ZBaUdDO0FBVUQsd0VBNkJDO0FBditERCw4QkFBb0M7QUFPcEMsd0NBQTBDO0FBQzFDLGlEQUE0RTtBQUU1RSx5REFBbUU7QUFDbkUsb0NBQWlOO0FBQ2pOLCtDQUFzRDtBQUN0RCxpREFBc0w7QUFDdEwsdUVBQWtFO0FBQ2xFLHFDQUFnRTtBQUNoRSxtQ0FBNEg7QUFDNUgsc0NBQTZEO0FBWTdELFNBQWdCLFlBQVksQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQ25GLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxTQUFnQixtQkFBbUIsQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQzFGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDbkQsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsS0FBSyxJQUFJLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFDMUYsT0FBTyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssU0FBUyxDQUFDO0FBQzFELENBQUM7QUFFRCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFtQyxFQUFFLElBQTBCO0lBRTlGLElBQUksY0FBYyxHQUFHLFNBQVMsSUFBQSxrQkFBVSxFQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7SUFDMUQsSUFBSSxjQUFjLElBQUksTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2pDLE9BQU8sTUFBTSxDQUFD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ZW50IjpbImltcG9ydCB0eXBlIHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gXCJlbGVjdHJvZGJcIjtcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2RpXCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUlucHV0VmFsaWRhdGlvbnMsIEVudGl0eVZhbGlkYXRpb25zIH0gZnJvbSBcIi4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB0eXBlIHsgQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlBdHRyaWJ1dGUsIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWEsIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hLCBFbnRpdHlUeXBlRnJvbVNjaGVtYSBhcyBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSwgSHlkcmF0ZU9wdGlvbkZvckVudGl0eSwgSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uLCBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eSwgUmVsYXRpb25JZGVudGlmaWVyLCBTcGVjaWFsQXR0cmlidXRlVHlwZSwgVERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBVcGRhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEsIFVwc2VydEVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUZpbHRlckNyaXRlcmlhLCBFbnRpdHlRdWVyeSwgRW50aXR5U2VsZWN0aW9ucywgUGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHMgfSBmcm9tIFwiLi9xdWVyeS10eXBlc1wiO1xuXG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBEZXBJZGVudGlmaWVyLCBJRElDb250YWluZXIgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IEJhc2VTZWFyY2hTZXJ2aWNlLCBFbnRpdHlTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi4vc2VhcmNoL3NlcnZpY2VzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5IH0gZnJvbSAnLi4vc2VhcmNoL3R5cGVzJztcbmltcG9ydCB7IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUgfSBmcm9tICcuLi9zZWFyY2gvc2VhcmNoLXV0aWxzJztcbmltcG9ydCB7IEpzb25TZXJpYWxpemVyLCBnZXRWYWx1ZUJ5UGF0aCwgaXNBcnJheSwgaXNCb29sZWFuLCBpc0NsYXNzQ29uc3RydWN0b3IsIGlzRW1wdHksIGlzRW1wdHlPYmplY3REZWVwLCBpc0Z1bmN0aW9uLCBpc09iamVjdCwgaXNTdHJpbmcsIHBhc2NhbENhc2UsIHBpY2tLZXlzLCB0b0h1bWFuUmVhZGFibGVOYW1lLCB0b1NsdWcgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgeyBVcGRhdGVFbnRpdHlPcGVyYXRvcnMsIGNyZWF0ZUVudGl0eSwgZGVsZXRlRW50aXR5LCBkZWxldGVCYXRjaEVudGl0eSwgZ2V0QmF0Y2hFbnRpdHksIGdldEVudGl0eSwgbGlzdEVudGl0eSwgcXVlcnlFbnRpdHksIHVwZGF0ZUVudGl0eSwgdXBzZXJ0RW50aXR5IH0gZnJvbSBcIi4vY3J1ZC1zZXJ2aWNlXCI7XG5pbXBvcnQgeyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IgfSBmcm9tIFwiLi9lbnRpdHktc2NoZW1hLXZhbGlkYXRvclwiO1xuaW1wb3J0IHsgRGF0YWJhc2VFcnJvciwgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhLCBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcywgcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgeyBJbnRlcm5hbFNlcnZlckVycm9yLCBTZXJ2ZXJFcnJvciB9IGZyb20gXCIuLi9lcnJvcnNcIjtcblxuZXhwb3J0IHR5cGUgRXh0cmFjdEVudGl0eUlkZW50aWZpZXJzQ29udGV4dCA9IHtcbiAgICAvLyB0ZW5hbnRJZDogc3RyaW5nLCBcbiAgICBmb3JBY2Nlc3NQYXR0ZXJuPzogc3RyaW5nXG59XG5cbnR5cGUgR2V0T3B0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgIGF0dHJpYnV0ZXM/OiBFbnRpdHlTZWxlY3Rpb25zPFM+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGUoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiAoYXR0cmlidXRlTmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhdHRyaWJ1dGUgPSBzY2hlbWEuYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXTtcbiAgICByZXR1cm4gISEoYXR0cmlidXRlICYmIGF0dHJpYnV0ZS5yZWFkT25seSA9PT0gdHJ1ZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcbiAgICByZXR1cm4gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgc3BlYykgIT09IHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcblxuICAgIGxldCBzcGVjQXR0TWV0YUtleSA9IGBlbnRpdHkke3Bhc2NhbENhc2Uoc3BlYyl9QXR0cmlidXRlYDtcbiAgICBpZiAoc3BlY0F0dE1ldGFLZXkgaW4gc2NoZW1hLm1vZGVsKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWEubW9kZWxbIHNwZWNBdHRNZXRhS2V5IGFzIGtleW9mIHR5cGVvZiBzY2hlbWEubW9kZWwgXSBhcyBzdHJpbmc7XG4gICAgfVxuXG4gICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsIGAke3NjaGVtYS5tb2RlbC5lbnRpdHl9JHtwYXNjYWxDYXNlKHNwZWMpfWApKSB7XG4gICAgICAgIHJldHVybiBgJHtzY2hlbWEubW9kZWwuZW50aXR5fSR7cGFzY2FsQ2FzZShzcGVjKX1gO1xuICAgIH1cblxuICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCBzcGVjKSkge1xuICAgICAgICByZXR1cm4gc3BlYztcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZUVudGl0eVNlcnZpY2U8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuXG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKGBCYXNlRW50aXR5U2VydmljZToke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKTtcblxuICAgIHByb3RlY3RlZCBlbnRpdHlSZXBvc2l0b3J5PzogRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgIHByb3RlY3RlZCBlbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE/OiBSZXR1cm5UeXBlPHR5cGVvZiB0aGlzLm1ha2VPcHNEZWZhdWx0SU9TY2hlbWE8Uz4+O1xuXG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHJlYWRvbmx5IHNjaGVtYTogUyxcbiAgICAgICAgcHJvdGVjdGVkIHJlYWRvbmx5IGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uLFxuICAgICAgICBwcm90ZWN0ZWQgcmVhZG9ubHkgZGlDb250YWluZXI6IElESUNvbnRhaW5lciA9IERJQ29udGFpbmVyLlJPT1QsXG4gICAgKSB7IH1cblxuICAgIHByb3RlY3RlZCBnZXRUYWJsZU5hbWUoKTogc3RyaW5nIHtcbiAgICAgICAgaWYgKCF0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcihgVGFibGUgbmFtZSBpcyByZXF1aXJlZCBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlO1xuICAgIH1cblxuXG4gICAgcHVibGljIGdldEVudGl0eVNlYXJjaENvbmZpZyhfY3R4PzogRXhlY3V0aW9uQ29udGV4dDxhbnk+KSB7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzY2hlbWEubW9kZWwuc2VhcmNoIHx8IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBpbmRleENvbmZpZzoge31cbiAgICAgICAgfTtcblxuICAgICAgICBzZWFyY2hDb25maWcuc2VydmljZUNsYXNzID0gc2VhcmNoQ29uZmlnLnNlcnZpY2VDbGFzcyB8fCBFbnRpdHlTZWFyY2hTZXJ2aWNlO1xuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5pbmRleE5hbWUgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuaW5kZXhOYW1lIHx8IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogdGhpcy5nZXRUYWJsZU5hbWUoKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnByaW1hcnlLZXkgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcucHJpbWFyeUtleSB8fCB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eVNlYXJjaGFibGVBdHRyaWJ1dGVzID0gdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcbiAgICAgICAgY29uc3QgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMgPSB0aGlzLmdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncyA9IHtcbiAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3MgfHwge30pLFxuICAgICAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5zZWFyY2hhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlTZWFyY2hhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgZmlsdGVyYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgc29ydGFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uc29ydGFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VhcmNoQ29uZmlnO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiBzZWFyY2ggaXMgZW5hYmxlZCBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUcnVlIGlmIHNlYXJjaCBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG4gICAgICovXG4gICAgcHVibGljIGlzU2VhcmNoRW5hYmxlZCgpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcbiAgICAgICAgcmV0dXJuIEJvb2xlYW4oc2VhcmNoQ29uZmlnPy5lbmFibGVkKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIHRoZSBzZWFyY2ggc2VydmljZSBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgc2VhcmNoIHNlcnZpY2UuXG4gICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaFNlcnZpY2UoKTogRW50aXR5U2VhcmNoU2VydmljZTxTPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldEVudGl0eVNlYXJjaENvbmZpZygpO1xuXG4gICAgICAgICAgICAvLyBTa2lwIHNlYXJjaCBsb2dpYyBpZiBzZWFyY2ggaXMgbm90IGVuYWJsZWRcbiAgICAgICAgICAgIGlmICghc2VhcmNoQ29uZmlnPy5lbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggaXMgbm90IGVuYWJsZWQgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfS5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgc2VhcmNoIGNvbmZpZ3VyYXRpb24gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVTZWFyY2hDb25maWcoc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9IHNlYXJjaENvbmZpZz8uc2VydmljZUNsYXNzO1xuXG4gICAgICAgICAgICAvLyBDYXNlIDE6IERJIENvbnRhaW5lciBoYXMgdGhlIHNlcnZpY2VcbiAgICAgICAgICAgIGlmIChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzICYmIHRoaXMuZGlDb250YWluZXIuaGFzKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT4+KSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmU8RW50aXR5U2VhcmNoU2VydmljZTxTPj4oc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyBEZXBJZGVudGlmaWVyPEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4+KTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHJlc29sdmUgc2VhcmNoIHNlcnZpY2UgZnJvbSBjb250YWluZXI6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVzb2x2ZSBzZWFyY2ggc2VydmljZSBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2FzZSAyOiBTZXJ2aWNlIGluc3RhbmNlIHByb3ZpZGVkXG4gICAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBpbnN0YW5jZW9mIEJhc2VTZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3M7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhc2UgMzogU2VydmljZSBjbGFzcyBwcm92aWRlZFxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGlzQ2xhc3NDb25zdHJ1Y3RvcihzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzKSAmJlxuICAgICAgICAgICAgICAgIChcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9PT0gRW50aXR5U2VhcmNoU2VydmljZVxuICAgICAgICAgICAgICAgICAgICB8fFxuICAgICAgICAgICAgICAgICAgICBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzLnByb3RvdHlwZSBpbnN0YW5jZW9mIEVudGl0eVNlYXJjaFNlcnZpY2VcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCB0byBjb25maWd1cmUgdGhpcyB3aXRob3V0IG5lZWRpbmcgdG8gdXNlIHRoZSBESVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hFbmdpbmUgPSB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVTZWFyY2hFbmdpbmUoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzZWFyY2hFbmdpbmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGVuZ2luZSBub3QgZm91bmQgaW4gY29udGFpbmVyJyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyB0eXBlb2YgRW50aXR5U2VhcmNoU2VydmljZSkoXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2VhcmNoRW5naW5lLFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFudGlhdGUgc2VhcmNoIHNlcnZpY2U6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIHNlYXJjaCBzZXJ2aWNlIGluc3RhbmNlIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHZhbGlkIHNlYXJjaC1zZXJ2aWNlLWNvbmZpZ3VyYXRpb24gZm91bmQgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciBpbiBnZXRTZWFyY2hTZXJ2aWNlOicsIGVycik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIGluaXRpYWxpemF0aW9uIGZhaWxlZCBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB2YWxpZGF0ZVNlYXJjaENvbmZpZyhzZWFyY2hDb25maWc6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PlsgJ21vZGVsJyBdWyAnc2VhcmNoJyBdKSB7XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIG11c3QgaW5jbHVkZSBhIGNvbmZpZyBvYmplY3QnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgaW5kZXhDb25maWc6IGNvbmZpZyB9ID0gc2VhcmNoQ29uZmlnO1xuXG4gICAgICAgIGlmICghY29uZmlnLmluZGV4TmFtZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBtdXN0IHNwZWNpZnkgYW4gaW5kZXhOYW1lJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBzZWFyY2hhYmxlIGF0dHJpYnV0ZXMgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb25maWcuc2V0dGluZ3M/LnNlYXJjaGFibGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IGNvbmZpZy5zZXR0aW5ncy5zZWFyY2hhYmxlQXR0cmlidXRlcy5maWx0ZXIoXG4gICAgICAgICAgICAgICAgKGF0dHI6IHN0cmluZykgPT4gIWhhc0F0dHJpYnV0ZSh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBhdHRyKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNlYXJjaGFibGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBjb25maWcuc2V0dGluZ3MuZmlsdGVyYWJsZUF0dHJpYnV0ZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIChhdHRyOiBzdHJpbmcpID0+ICFoYXNBdHRyaWJ1dGUodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgYXR0cilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmaWx0ZXJhYmxlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyB0cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eTogRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICByZXR1cm4gYXdhaXQgc2VhcmNoU2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG4gICAgfVxuXG4gICAgcHVibGljIHZhbGlkYXRlRW50aXR5U2NoZW1hKCkge1xuICAgICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgRW50aXR5U2NoZW1hVmFsaWRhdG9yKHRoaXMuZGlDb250YWluZXIpO1xuICAgICAgICB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoXG4gICAgICAgICAgICB0aGlzLmdldEVudGl0eVNjaGVtYSgpLFxuICAgICAgICAgICAgdGhpcy5lbnRpdHlDb25maWd1cmF0aW9uc1xuICAgICAgICApO1xuICAgIH1cblxuICAgIGdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWU8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlRW50aXR5U2VydmljZTxCYXNlRW50aXR5U2VydmljZTxUPj4ocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTZXJ2aWNlKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBnZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlRW50aXR5U2NoZW1hPFQ+KHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dHJhY3RzIGVudGl0eSBpZGVudGlmaWVycyBmcm9tIHRoZSBpbnB1dCBvYmplY3QgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGNvbnRleHQgdG8gZnVsZmlsbCBhbiBpbmRleC5cbiAgICAgKiBlLmcuIGVudGl0eUlkLCB0ZW5hbnRJZCwgcGFydGl0aW9uLWtleXMuLi4uIGV0Y1xuICAgICAqIGl0IGlzIHVzZWQgYnkgdGhlIGBCYXNlRW50aXR5U2VydmljZWAgdG8gZmluZCB0aGUgcmlnaHQgZW50aXR5IGZvciBgZ2V0YC9gdXBkYXRlYC9gZGVsZXRlYCBvcGVyYXRpb25zXG4gICAgICogXG4gICAgICogQHRlbXBsYXRlIFMgLSBUaGUgdHlwZSBvZiB0aGUgZW50aXR5IHNjaGVtYS5cbiAgICAgKiBAcGFyYW0gaW5wdXQgLSBUaGUgaW5wdXQgb2JqZWN0IGZyb20gd2hpY2ggdG8gZXh0cmFjdCB0aGUgaWRlbnRpZmllcnMuXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgY29udGFpbmluZyBhZGRpdGlvbmFsIGluZm9ybWF0aW9uIGZvciBleHRyYWN0aW9uLlxuICAgICAqIEBwYXJhbSBjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4gLSBUaGUgYWNjZXNzIHBhdHRlcm4gZm9yIHdoaWNoIHRvIGV4dHJhY3QgdGhlIGlkZW50aWZpZXJzLlxuICAgICAqIEByZXR1cm5zIFRoZSBleHRyYWN0ZWQgZW50aXR5IGlkZW50aWZpZXJzLlxuICAgICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgaW5wdXQgaXMgbWlzc2luZyBvciBub3QgYW4gb2JqZWN0LlxuICAgICAqIFxuICAgICAqIGUuZy4gXG4gICAgICogSU4gICA9PT4gYFJlcXVlc3RgIG9iamVjdCB3aXRoIGhlYWRlcnMsIGJvZHksIGF1dGgtY29udGV4dCBldGNcbiAgICAgKiBPVVQgID09PiB7IHRlbmFudElkOiB4eHgsIGVtYWlsOiB4eHhAeXl5LmNvbSwgc29tZS1wYXJ0aXRpb24ta2V5OiB4eC15eS16eiB9XG4gICAgICpcbiAgICAgKi9cbiAgICBleHRyYWN0RW50aXR5SWRlbnRpZmllcnMoXG4gICAgICAgIGlucHV0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgc3RyaW5nPj4sXG4gICAgICAgIGNvbnRleHQ6IEV4dHJhY3RFbnRpdHlJZGVudGlmaWVyc0NvbnRleHQgPSB7XG4gICAgICAgICAgICAvLyB0ZW5hbnRJZDogJ3h4eC15eXktenp6J1xuICAgICAgICB9XG4gICAgKTogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+IHtcblxuICAgICAgICBpZiAoIWlucHV0IHx8IHR5cGVvZiBpbnB1dCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW5wdXQgaXMgcmVxdWlyZWQgYW5kIG11c3QgYmUgYW4gb2JqZWN0IGNvbnRhaW5pbmcgZW50aXR5LWlkZW50aWZpZXJzIG9yIGFuIGFycmF5IG9mIG9iamVjdHMgY29udGFpbmluZyBlbnRpdHktaWRlbnRpZmllcnMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlzQmF0Y2hJbnB1dCA9IGlzQXJyYXkoaW5wdXQpO1xuXG4gICAgICAgIGNvbnN0IGlucHV0cyA9IGlzQmF0Y2hJbnB1dCA/IGlucHV0IDogWyBpbnB1dCBdO1xuXG4gICAgICAgIC8vIFRPRE86IHRlbmFudCBsb2dpY1xuICAgICAgICAvLyBpZGVudGlmaWVyc1sndGVuYW50SWQnXSA9IGlucHV0LnRlbmFudElkIHx8IGNvbnRleHQudGVuYW50SWQ7XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWEodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSk7XG5cbiAgICAgICAgY29uc3QgaWRlbnRpZmllckF0dHJpYnV0ZXMgPSBuZXcgU2V0PHsgbmFtZTogc3RyaW5nLCByZXF1aXJlZDogYm9vbGVhbiB9PigpO1xuICAgICAgICBmb3IgKGNvbnN0IFsgYWNjZXNzUGF0dGVybk5hbWUsIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzIF0gb2YgYWNjZXNzUGF0dGVybnMpIHtcbiAgICAgICAgICAgIGlmICghY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuIHx8IGFjY2Vzc1BhdHRlcm5OYW1lID09IGNvbnRleHQuZm9yQWNjZXNzUGF0dGVybikge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIGF0dCBdIG9mIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJBdHRyaWJ1dGVzLmFkZCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBhdHQuaWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogYXR0LnJlcXVpcmVkID09IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcHJpbWFyeUF0dE5hbWUgPSB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzQmF0Y2ggPSBpbnB1dHMubWFwKGlucHV0ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBhbnkgPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lOiBhdHROYW1lLCByZXF1aXJlZCB9IG9mIGlkZW50aWZpZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKChhdHROYW1lIGluIGlucHV0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyc1sgYXR0TmFtZSBdID0gaW5wdXRbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGF0dE5hbWUgPT0gcHJpbWFyeUF0dE5hbWUgJiYgKCdpZCcgaW4gaW5wdXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzWyBhdHROYW1lIF0gPSBpbnB1dC5pZDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlcXVpcmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYHJlcXVpcmVkIGF0dHJpYnV0ZTogJHthdHROYW1lfSBmb3IgYWNjZXNzLXBhdHRlcm46ICR7Y29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuID8/ICctLXByaW1hcnktLSd9IGlzIG5vdCBmb3VuZCBpbiBpbnB1dDpgLCBpbnB1dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGlkZW50aWZpZXJzIGFzIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz47XG4gICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRXh0cmFjdGluZyBpZGVudGlmaWVycyBmcm9tIGlkZW50aWZpZXJzOicsIGlkZW50aWZpZXJzQmF0Y2gpO1xuXG4gICAgICAgIHJldHVybiBpc0JhdGNoSW5wdXQgPyBpZGVudGlmaWVyc0JhdGNoIDogaWRlbnRpZmllcnNCYXRjaFsgMCBdO1xuICAgIH07XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5TmFtZSgpOiBTWyAnbW9kZWwnIF1bICdlbnRpdHknIF0geyByZXR1cm4gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKS5tb2RlbC5lbnRpdHk7IH1cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlTY2hlbWEoKTogUyB7IHJldHVybiB0aGlzLnNjaGVtYTsgfVxuXG4gICAgcHVibGljIGdldFJlcG9zaXRvcnkoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlSZXBvc2l0b3J5KSB7XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eSB9ID0gY3JlYXRlRWxlY3Ryb0RCRW50aXR5KHtcbiAgICAgICAgICAgICAgICBzY2hlbWE6IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5lbnRpdHlSZXBvc2l0b3J5ID0gZW50aXR5IGFzIEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eVJlcG9zaXRvcnkhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBsYWNlaG9sZGVyIGZvciB0aGUgZW50aXR5IHZhbGlkYXRpb25zOyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgeW91ciBvd24gdmFsaWRhdGlvbnNcbiAgICAgKiBAcmV0dXJucyBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgZW50aXR5IHZhbGlkYXRpb25zLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRFbnRpdHlWYWxpZGF0aW9ucygpOiBFbnRpdHlWYWxpZGF0aW9uczxTPiB8IEVudGl0eUlucHV0VmFsaWRhdGlvbnM8Uz4ge1xuICAgICAgICByZXR1cm4ge307XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFBsYWNlaG9sZGVyIGZvciB0aGUgY3VzdG9tIHZhbGlkYXRpb24tZXJyb3ItbWVzc2FnZXM7IG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSB5b3VyIG93biBlcnJvci1tZXNzYWdlcy5cbiAgICAgKiBAcmV0dXJucyBBIG1hcCBjb250YWluaW5nIHRoZSBjdXN0b20gdmFsaWRhdGlvbi1lcnJvci1tZXNzYWdlcy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHRzXG4gICAgICogIHB1YmxpYyBhc3luYyBnZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgICogICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCBuZXcgTWFwPHN0cmluZywgc3RyaW5nPiggXG4gICAgICogICAgICAgICAgT2JqZWN0LmVudHJpZXMoeyBcbiAgICAgKiAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24uZW1haWwucmVxdWlyZWQnOiAnRW1haWwgaXMgcmVxdWlyZWQhISEhIScsIFxuICAgICAqICAgICAgICAgICAgICAndmFsaWRhdGlvbi5wYXNzd29yZC5yZXF1aXJlZCc6ICdQYXNzd29yZCBpcyByZXF1aXJlZCEhISEhJ1xuICAgICAqICAgICAgICAgIH0pXG4gICAgICogICAgICApKTtcbiAgICAgKiB9XG4gICAgICogYGBgXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCkge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChhdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF0dE5hbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICogR2VuZXJhdGVzIHRoZSBkZWZhdWx0IGlucHV0IGFuZCBvdXRwdXQgc2NoZW1hcyBmb3IgdmFyaW91cyBvcGVyYXRpb25zIG9mIGFuIGVudGl0eS5cbiAqIFxuICogQHRlbXBsYXRlIFMgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wcyAtIFRoZSB0eXBlIG9mIGVudGl0eSBvcGVyYXRpb25zLlxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gVGhlIGVudGl0eSBzY2hlbWEuXG4gKiBAcmV0dXJucyBUaGUgZGVmYXVsdCBpbnB1dCBhbmQgb3V0cHV0IHNjaGVtYXMgZm9yIHRoZSBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuICAgIHByb3RlY3RlZCBtYWtlT3BzRGVmYXVsdElPU2NoZW1hPFxuICAgICAgICBTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIE9wcz4sXG4gICAgICAgIE9wcyBleHRlbmRzIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyA9IFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICA+KHNjaGVtYTogUykge1xuXG4gICAgICAgIGNvbnN0IGlucHV0U2NoZW1hQXR0cmlidXRlcyA9IHtcbiAgICAgICAgICAgIGNyZWF0ZTogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgICAgICB1cGRhdGU6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICAgICBkZXRhaWw6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICAgICAgbGlzdDogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gY3JlYXRlIGFuZCB1cGRhdGVcbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG5cbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWRBdHQgPSBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGF0dE5hbWUsIGF0dCk7XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaGlkZGVuKSB7XG4gICAgICAgICAgICAgICAgLy8gaWYgaXQncyBtYXJrZWQgYXMgaGlkZGVuIGl0J3Mgbm90IHZpc2libGUgdG8gYW55IG9wXG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNWaXNpYmxlIHx8IGZvcm1hdHRlZEF0dC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbC5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNMaXN0YWJsZSB8fCBmb3JtYXR0ZWRBdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5saXN0LnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc0NyZWF0YWJsZSkge1xuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hQXR0cmlidXRlcy5jcmVhdGUuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzRWRpdGFibGUpIHtcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMudXBkYXRlLnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hKHNjaGVtYSk7XG5cbiAgICAgICAgLy8gaWYgdGhlcmUncyBhbiBpbmRleCBuYW1lZCBgcHJpbWFyeWAsIHVzZSB0aGF0LCBlbHNlIGZhbGxiYWNrIHRvIGZpcnN0IGluZGV4XG4gICAgICAgIC8vIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzWydnZXQnXSA9IGFjY2Vzc1BhdHRlcm5zLmdldCgncHJpbWFyeScpID8/IGFjY2Vzc1BhdHRlcm5zLmVudHJpZXMoKS5uZXh0KCkudmFsdWU7XG4gICAgICAgIC8vIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzWydkZWxldGUnXSA9IGFjY2Vzc1BhdHRlcm5zLmdldCgncHJpbWFyeScpID8/IGFjY2Vzc1BhdHRlcm5zLmVudHJpZXMoKS5uZXh0KCkudmFsdWU7XG5cblxuICAgICAgICAvLyBmb3IoY29uc3QgYXAgb2YgYWNjZXNzUGF0dGVybnMua2V5cygpKXtcbiAgICAgICAgLy8gXHRhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1tgZ2V0XyR7YXB9YF0gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoYXApO1xuICAgICAgICAvLyBcdGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzW2BkZWxldGVfJHthcH1gXSA9IGFjY2Vzc1BhdHRlcm5zLmdldChhcCk7XG4gICAgICAgIC8vIH1cblxuICAgICAgICAvLyBjb25zdCBpbnB1dFNjaGVtYUF0dHJpYnV0ZXM6IGFueSA9IHt9O1x0XG4gICAgICAgIC8vIGlucHV0U2NoZW1hQXR0cmlidXRlc1snY3JlYXRlJ10gPSB7XG4gICAgICAgIC8vIFx0J2lkZW50aWZpZXJzJzogYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddLFxuICAgICAgICAvLyBcdCdkYXRhJzogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWydjcmVhdGUnXSxcbiAgICAgICAgLy8gfVxuICAgICAgICAvLyBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ3VwZGF0ZSddID0ge1xuICAgICAgICAvLyBcdCdpZGVudGlmaWVycyc6IGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzWydnZXQnXSxcbiAgICAgICAgLy8gXHQnZGF0YSc6IGlucHV0U2NoZW1hQXR0cmlidXRlc1sndXBkYXRlJ10sXG4gICAgICAgIC8vIH1cblxuICAgICAgICBjb25zdCBkZWZhdWx0QWNjZXNzUGF0dGVybiA9IGFjY2Vzc1BhdHRlcm5zLmdldCgncHJpbWFyeScpO1xuXG4gICAgICAgIC8vIFRPRE86IGFkZCBzY2hlbWEgZm9yIHRoZSByZXN0IGZvIHRoZSBzZWNvbmRhcnkgYWNjZXNzLXBhdHRlcm5zXG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGdldDoge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVybixcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLCAvLyBkZWZhdWx0IGZvciB0aGUgZGV0YWlsIHBhZ2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkdXBsaWNhdGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCwgLy8gZGVmYXVsdCBmb3IgdGhlIGRldGFpbCBwYWdlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGVsZXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY3JlYXRlOiB7XG4gICAgICAgICAgICAgICAgaW5wdXQ6IGlucHV0U2NoZW1hQXR0cmlidXRlcy5jcmVhdGUsXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHVwZGF0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVybixcbiAgICAgICAgICAgICAgICBpbnB1dDogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLnVwZGF0ZSxcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxpc3Q6IHtcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMubGlzdCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGlucHV0L291dHB1dCBzY2hlbWEgZm9yIGVudGl0eSBvcGVyYXRpb25zLlxuICAgICAqIFxuICAgICovXG4gICAgcHVibGljIGdldE9wc0RlZmF1bHRJT1NjaGVtYSgpIHtcbiAgICAgICAgaWYgKCF0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYSkge1xuICAgICAgICAgICAgdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWEgPSB0aGlzLm1ha2VPcHNEZWZhdWx0SU9TY2hlbWE8Uz4odGhpcy5nZXRFbnRpdHlTY2hlbWEoKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgYW4gYXJyYXkgb2YgZGVmYXVsdCBzZXJpYWxpemF0aW9uIGF0dHJpYnV0ZSBuYW1lcy4gVXNlZCBieSB0aGUgYGRldGFpbGAgQVBJIHRvIHNlcmlhbGl6ZSB0aGUgZW50aXR5LlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBBbiBhcnJheSBvZiBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKCk6IEVudGl0eVNlbGVjdGlvbnM8Uz4ge1xuICAgICAgICBjb25zdCBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcCA9IHRoaXMuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkuZ2V0Lm91dHB1dDtcblxuICAgICAgICBjb25zdCBhdHRyaWJ1dGVzOiBhbnkgPSB7fTtcbiAgICAgICAgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAuZm9yRWFjaCgoXywga2V5KSA9PiB7XG4gICAgICAgICAgICAvLyBpZiAoIXZhbC5yZWxhdGlvbiB8fCB2YWwucmVsYXRpb24uaHlkcmF0ZSkge1xuICAgICAgICAgICAgLy8gfVxuICAgICAgICAgICAgYXR0cmlidXRlc1sga2V5IF0gPSB0cnVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVzIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG5cbiAgICAgICAgLy8gIHJldHVybiBBcnJheS5mcm9tKCBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5rZXlzKCkgKSBhcyBFbnRpdHlTZWxlY3Rpb25zPFM+O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgYXR0cmlidXRlIG5hbWVzIGZvciBsaXN0aW5nIGFuZCBzZWFyY2ggQVBJLiBEZWZhdWx0cyB0byB0aGUgZGVmYXVsdCBzZXJpYWxpemF0aW9uIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gQW4gYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKTogRW50aXR5U2VsZWN0aW9uczxTPiB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwID0gdGhpcy5nZXRPcHNEZWZhdWx0SU9TY2hlbWEoKS5saXN0Lm91dHB1dDtcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20oZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAua2V5cygpKSBhcyBFbnRpdHlTZWxlY3Rpb25zPFM+O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGRlZmF1bHQgYXR0cmlidXRlIG5hbWVzIHRvIGJlIHVzZWQgZm9yIGtleXdvcmQgc2VhcmNoLiBEZWZhdWx0cyB0byBhbGwgc3RyaW5nIGF0dHJpYnV0ZXMgd2hpY2ggYXJlIG5vdCBoaWRkZW4gYW5kIGFyZSBub3QgaWRlbnRpZmllcnMuXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaFxuICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBpZiAoIWF0dC5oaWRkZW4gJiYgIWF0dC5pc0lkZW50aWZpZXIgJiYgYXR0LnR5cGUgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAoISgnaXNTZWFyY2hhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc1NlYXJjaGFibGUpXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgdW5pcXVlIGF0dHJpYnV0ZXMgb2YgdGhlIGVudGl0eS4gXG4gICAgICogRGVmYXVsdHMgdG8gYWxsIGF0dHJpYnV0ZXMgd2hpY2ggYXJlIG1hcmtlZCBhcyB1bmlxdWUgb3IgYXJlIGlkZW50aWZpZXJzOyBcbiAgICAgKiBPciBpZiB0aGV5IGFyZSBwYXJ0IG9mIGEgY29tcG9zaXRlIHByaW1hcnkga2V5IHdoZXJlIHRoZSBjb21wb3NpdGUgbGVuZ3RoIGlzIDEuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PEVudGl0eUF0dHJpYnV0ZT59IHVuaXF1ZSBhdHRyaWJ1dGVzIG9mIHRoZSBlbnRpdHlcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRVbmlxdWVBdHRyaWJ1dGVzKCk6IEFycmF5PEVudGl0eUF0dHJpYnV0ZT4ge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVzID0gW107XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuXG4gICAgICAgICAgICBsZXQgaXNVbmlxdWUgPSAoJ2lzVW5pcXVlJyBpbiBhdHQpID8gYXR0LmlzVW5pcXVlIDogYXR0LmlzSWRlbnRpZmllcjtcblxuICAgICAgICAgICAgaWYgKGlzVW5pcXVlKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgLi4uYXR0LFxuICAgICAgICAgICAgICAgICAgICBpc1VuaXF1ZSxcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYXR0TmFtZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGRlZmF1bHQgYXR0cmlidXRlIG5hbWVzIHRoYXQgY2FuIGJlIHVzZWQgZm9yIGZpbHRlcmluZyB0aGUgcmVjb3Jkcy4gRGVmYXVsdHMgdG8gYWxsIHN0cmluZyBhdHRyaWJ1dGVzIHdoaWNoIGFyZSBub3QgaGlkZGVuLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2hcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRGaWx0ZXJhYmxlQXR0cmlidXRlTmFtZXMoKTogQXJyYXk8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gW107XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICFhdHQuaGlkZGVuICYmIFsgJ3N0cmluZycsICdudW1iZXInIF0uaW5jbHVkZXMoYXR0LnR5cGUgYXMgc3RyaW5nKVxuICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgKCEoJ2lzRmlsdGVyYWJsZScgaW4gYXR0KSB8fCBhdHQuaXNGaWx0ZXJhYmxlKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZXMucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lcztcbiAgICB9XG5cbiAgICBwdWJsaWMgc2VyaWFsaXplUmVjb3JkPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IFQsIGF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKSk6IFBhcnRpYWw8VD4ge1xuXG4gICAgICAgIGxldCBrZXlzOiBBcnJheTxzdHJpbmc+O1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAga2V5cyA9IE9iamVjdC5rZXlzKHBhcnNlZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMoYXR0cmlidXRlcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGlja0tleXM8VD4ocmVjb3JkLCAuLi5rZXlzKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc2VyaWFsaXplUmVjb3JkczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4ocmVjb3JkOiBBcnJheTxUPiB8IG51bGwsIGF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKSk6IEFycmF5PFBhcnRpYWw8VD4+IHtcbiAgICAgICAgaWYgKCFyZWNvcmQgfHwgIUFycmF5LmlzQXJyYXkocmVjb3JkKSkge1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZWNvcmQubWFwKHJlY29yZCA9PiB0aGlzLnNlcmlhbGl6ZVJlY29yZDxUPihyZWNvcmQsIGF0dHJpYnV0ZXMpKTtcbiAgICB9XG5cbiAgICBhc3luYyBoeWRyYXRlUmVjb3JkcyhcbiAgICAgICAgcmVsYXRpb25zOiBBcnJheTxbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxhbnk+IF0+LFxuICAgICAgICByb290RW50aXR5UmVjb3JkczogQXJyYXk8eyBbIHg6IHN0cmluZyBdOiBhbnk7IH0+XG4gICAgKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVSZWNvcmRzJyBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChyZWxhdGlvbnM/Lm1hcChhc3luYyAoWyByZWxhdGVkQXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVTaW5nbGVSZWxhdGlvbihyb290RW50aXR5UmVjb3JkcywgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMpO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlU2luZ2xlUmVsYXRpb24ocm9vdEVudGl0eVJlY29yZHM6IGFueVtdLCByZWxhdGVkQXR0cmlidXRlTmFtZTogc3RyaW5nLCBvcHRpb25zOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248YW55Pikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlU2luZ2xlUmVsYXRpb24nIHJlbGF0aW9uOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIG9wdGlvbnNcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSwgcmVsYXRpb25UeXBlLCBpZGVudGlmaWVycyB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAoIWlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICB0aHJvdyAoYE5vIElkZW50aWZpZXJzOlske3JlbGF0aW9uVHlwZX06JHtyZWxhdGVkRW50aXR5TmFtZX1dIHByb3ZpZGVkYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVsYXRpb25UeXBlID09ICdvbmUtdG8tb25lJyB8fCByZWxhdGlvblR5cGUgPT0gJ21hbnktdG8tbWFueScpIHtcbiAgICAgICAgICAgIHRocm93IChgUmVsYXRpb25UeXBlOlske3JlbGF0aW9uVHlwZX06JHtyZWxhdGVkRW50aXR5TmFtZX1dIGluIG5vdCBzdXBwb3J0ZWQgYnkgaHlkcmF0aW9uLCB1c2Ugb25lIG9mIFttYW55LXRvLW9uZSwgb25lLXRvLW1hbnldIG90IG1hbnVhbGx5IGh5ZHJhdGUnYClcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCByZWxhdGVkIGVudGl0eSBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICAgICAgaWYgKCFyZWxhdGVkRW50aXR5U2VydmljZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzZXJ2aWNlIGZvdW5kIGZvciByZWxhdGlvbnNoaXA6ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9KCR7cmVsYXRlZEVudGl0eU5hbWV9KTsgcGxlYXNlIG1ha2Ugc3VyZSBzZXJ2aWNlIGhhcyBiZWVuIHJlZ2lzdGVyZWQgaW4gdGhlIHJlcXVpcmVkICdkaS1jb250YWluZXInYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgcmVsYXRpb24ncyBtZXRhZGF0YVxuICAgICAgICBjb25zdCBjdXJyZW50RW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSA9IGN1cnJlbnRFbnRpdHlTY2hlbWEuYXR0cmlidXRlc1sgcmVsYXRlZEF0dHJpYnV0ZU5hbWUgYXMgYW55IF0gYXMgRW50aXR5QXR0cmlidXRlO1xuXG4gICAgICAgIGlmICghcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSB8fCAhcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YT8ucmVsYXRpb24pIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgTm8gbWV0YWRhdGEgZm91bmQgZm9yIHJlbGF0aW9uc2hpcDogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX1gXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKG1lc3NhZ2UsIHJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEpO1xuICAgICAgICAgICAgdGhyb3cgKG1lc3NhZ2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVsYXRpb24gaWRlbnRpZmllcnMgbWFwcGluZ1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10gPSBBcnJheS5pc0FycmF5KGlkZW50aWZpZXJzKSA/IGlkZW50aWZpZXJzIDogWyBpZGVudGlmaWVycyEgXTtcblxuICAgICAgICAvLyBEZWNpZGUgbG9naWMgYmFzZWQgb24gcmVsYXRpb25UeXBlXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUgPT09ICdtYW55LXRvLW9uZScpIHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogTUFOWS1UTy1PTkU6XG4gICAgICAgICAgICAgKiAtLS0tLS0tLS0tLS0tXG4gICAgICAgICAgICAgKiBUaGUgXCJyb290RW50aXR5UmVjb3Jkc1wiIGFyZSB0aGUgQ0hJTEQgaXRlbXMsIGVhY2ggc3RvcmluZyB0aGUgcGFyZW50J3NcbiAgICAgICAgICAgICAqIGNvbXBvc2l0ZSBrZXkgaW4gc29tZSBmaWVsZHMuIFdlIGdhdGhlciBhbGwgdGhvc2UgcGFyZW50IGtleXMsIGRvIGEgYmF0Y2hcbiAgICAgICAgICAgICAqIHJldHJpZXZhbCBmcm9tIHRoZSBwYXJlbnQgZW50aXR5LCB0aGVuIGF0dGFjaCB0aGUgc2luZ2xlIG1hdGNoaW5nIHBhcmVudFxuICAgICAgICAgICAgICogcmVjb3JkIGludG8gY2hpbGRSZWNvcmRbcmVsYXRlZEF0dHJpYnV0ZU5hbWVdLlxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZU1hbnlUb09uZShcbiAgICAgICAgICAgICAgICByb290RW50aXR5UmVjb3JkcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkQXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MsXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uVHlwZSA9PT0gJ29uZS10by1tYW55Jykge1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBPTkUtVE8tTUFOWTpcbiAgICAgICAgICAgICAqIC0tLS0tLS0tLS0tLS1cbiAgICAgICAgICAgICAqIFRoZSBcInJvb3RFbnRpdHlSZWNvcmRzXCIgYXJlIHRoZSBQQVJFTlQgaXRlbXMuIEVhY2ggcGFyZW50IGNhbiBoYXZlIG11bHRpcGxlXG4gICAgICAgICAgICAgKiBjaGlsZCBpdGVtcy4gVGhlIGNoaWxkIHRhYmxlIHJlY29yZHMgZWFjaCBzdG9yZSB0aGUgcGFyZW50J3Mga2V5LiBcbiAgICAgICAgICAgICAqIFNvIHdlIGRvIGEgcXVlcnkgcGVyIHBhcmVudCBhbmQgdGhlbiAuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZU9uZVRvTWFueShcbiAgICAgICAgICAgICAgICByb290RW50aXR5UmVjb3JkcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkQXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MsXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlTWFueVRvT25lKFxuICAgICAgICBjaGlsZFJlY29yZHM6IGFueVtdLFxuICAgICAgICBwYXJlbnRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSxcbiAgICAgICAgcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZTogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxhbnk+IHwgdW5kZWZpbmVkLFxuICAgICAgICBwYXJlbnRTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4gICAgKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVNYW55VG9PbmUnIHJlbGF0aW9uOiAke3BhcmVudEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gZm9yIGVhY2ggcGFyZW50IGNyZWF0ZSBhIGNoaWxkcmVuIGJhdGNoXG4gICAgICAgIGNvbnN0IHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcCA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkUmVjb3Jkcykge1xuICAgICAgICAgICAgaWYgKCFjaGlsZCkgY29udGludWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgcGFyZW50IGtleSBvYmplY3QuIEUuZy4geyBvcmdJZDogY2hpbGQub3JnSWQsIHVzZXJJZDogY2hpbGQudXNlcklkIH0gZm9yIDItYXR0ciBQS1xuICAgICAgICAgICAgY29uc3QgcGFyZW50S2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgc291cmNlLCB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcblxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbCA9IGdldFZhbHVlQnlQYXRoKGNoaWxkLCBzb3VyY2UpO1xuICAgICAgICAgICAgICAgICAgICBpZiAodmFsID09IG51bGwpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudEtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gdmFsO1xuXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGdldHRpbmcgdmFsdWUgZm9yIHBhdGg6ICR7c291cmNlfWAsIHsgZXJyb3IgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiBwYXJ0aWFsIG9yIGVtcHR5LCBza2lwXG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMocGFyZW50S2V5T2JqKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBjaGlsZFsgcGFyZW50QXR0cmlidXRlTmFtZSBdID0gbnVsbDtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gSlNPTi5zdHJpbmdpZnkocGFyZW50S2V5T2JqKTtcbiAgICAgICAgICAgIGlmICghcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmhhcyhrZXlTdHIpKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLnNldChrZXlTdHIsIFtdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5nZXQoa2V5U3RyKSEucHVzaChjaGlsZCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLnNpemUgPT09IDApIHJldHVybjtcblxuICAgICAgICAvLyBDcmVhdGUgYSBwYXJlbnQtaWRlbnRpZmllcnMtYmF0Y2ggZm9yIGZldGNoaW5nXG4gICAgICAgIGNvbnN0IHBhcmVudElkZW50aWZpZXJzQmF0Y2g6IEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+ID0gW107XG4gICAgICAgIGZvciAoY29uc3QgayBvZiBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAua2V5cygpKSB7XG4gICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc0JhdGNoLnB1c2goSlNPTi5wYXJzZShrKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBmZXRjaGVkUGFyZW50cyA9IGF3YWl0IHBhcmVudFNlcnZpY2UuZ2V0KHtcbiAgICAgICAgICAgIGlkZW50aWZpZXJzOiBwYXJlbnRJZGVudGlmaWVyc0JhdGNoLFxuICAgICAgICAgICAgYXR0cmlidXRlczogcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSWYgXCJnZXQoKVwiIHJldHVybnMgYSBzaW5nbGUgaXRlbSBjb252ZXJ0IGl0IGludG8gYW4gYXJyYXkuXG4gICAgICAgIGNvbnN0IHBhcmVudHNBcnJheSA9IEFycmF5LmlzQXJyYXkoZmV0Y2hlZFBhcmVudHMpID8gZmV0Y2hlZFBhcmVudHMgOiBbIGZldGNoZWRQYXJlbnRzIF07XG5cbiAgICAgICAgLy8gTWFrZSBhIGRpY3Rpb25hcnkgZnJvbSB7IDxrZXlTdHI+ID0+IHBhcmVudFJlY29yZCB9XG4gICAgICAgIGNvbnN0IHBhcmVudERpY3QgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgcGFyZW50c0FycmF5KSB7XG4gICAgICAgICAgICBpZiAoIXApIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFJlYnVpbGQgdGhlIFwiY29tcG9zaXRlIGtleVwiIGZyb20gdGhlIHBhcmVudCdzIHJlY29yZFxuICAgICAgICAgICAgY29uc3Qga2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBbIHRhcmdldCBdID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgc29tZSBhdHRyaWJ1dGUgaXMgbWlzc2luZywgc2tpcFxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAga2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSBwWyB0YXJnZXQgXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGtTdHIgPSBKU09OLnN0cmluZ2lmeShrZXlPYmopO1xuICAgICAgICAgICAgcGFyZW50RGljdC5zZXQoa1N0ciwgcCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBdHRhY2ggZWFjaCBwYXJlbnQncyBkYXRhIHRvIHRoZSBjaGlsZFxuICAgICAgICBmb3IgKGNvbnN0IFsga1N0ciwgY2hpbGRyZW4gXSBvZiBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuZW50cmllcygpKSB7XG4gICAgICAgICAgICBjb25zdCBmb3VuZFBhcmVudCA9IHBhcmVudERpY3QuZ2V0KGtTdHIpID8/IG51bGw7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGMgb2YgY2hpbGRyZW4pIHtcbiAgICAgICAgICAgICAgICBjWyBwYXJlbnRBdHRyaWJ1dGVOYW1lIF0gPSBmb3VuZFBhcmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZU9uZVRvTWFueShcbiAgICAgICAgcGFyZW50UmVjb3JkczogYW55W10sXG4gICAgICAgIGNoaWxkQXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10sXG4gICAgICAgIGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZTogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxhbnk+IHwgdW5kZWZpbmVkLFxuICAgICAgICBjaGlsZFNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbiAgICApIHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlT25lVG9NYW55JyByZWxhdGlvbjogJHtjaGlsZEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBwYXJlbnRLZXlTdHJUb1BhcmVudHMgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50UmVjb3Jkcykge1xuICAgICAgICAgICAgaWYgKCFwYXJlbnQpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBhIFwiY2hpbGQgaW5kZXhcIiBrZXkgZnJvbSB0aGUgcGFyZW50J3MgZmllbGRzLiBGb3IgZXhhbXBsZSwgXG4gICAgICAgICAgICAvLyBpZiB0aGUgY2hpbGQgR1NJIGhhcyB7IHBrOiAndGVuYW50SWQnLCBzazogJ2FjY291bnRJZCcgfSwgXG4gICAgICAgICAgICAvLyB3ZSBmaWxsIHsgdGVuYW50SWQ6IHBhcmVudC50ZW5hbnRJZCwgYWNjb3VudElkOiBwYXJlbnQuYWNjb3VudElkIH0uXG4gICAgICAgICAgICBjb25zdCBjaGlsZEtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHNvdXJjZSwgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhcmVudFsgc291cmNlIF0gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZEtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gcGFyZW50WyBzb3VyY2UgXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIHdlIGhhdmUgbm8gdmFsaWQgY29tcG9zaXRlIGtleSwgbm8gY2hpbGRyZW4gY2FuIGJlIGZldGNoZWRcbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhjaGlsZEtleU9iaikubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50WyBjaGlsZEF0dHJpYnV0ZU5hbWUgXSA9IFtdO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBKU09OLnN0cmluZ2lmeShjaGlsZEtleU9iaik7XG4gICAgICAgICAgICBpZiAoIXBhcmVudEtleVN0clRvUGFyZW50cy5oYXMoa2V5U3RyKSkge1xuICAgICAgICAgICAgICAgIHBhcmVudEtleVN0clRvUGFyZW50cy5zZXQoa2V5U3RyLCBbXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZ2V0KGtleVN0cikhLnB1c2gocGFyZW50KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIG5vIHBhcmVudCBoYXMgYSB2YWxpZCBrZXksIHdlJ3JlIGRvbmVcbiAgICAgICAgaWYgKHBhcmVudEtleVN0clRvUGFyZW50cy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGb3IgZWFjaCB1bmlxdWUgcGFyZW50S2V5T2JqLCBkbyBhIGNoaWxkU2VydmljZSBxdWVyeS9saXN0IGluIHBhcmFsbGVsLlxuICAgICAgICBjb25zdCBwcm9taXNlczogQXJyYXk8UHJvbWlzZTxhbnk+PiA9IFtdO1xuICAgICAgICBjb25zdCBwYXJlbnRLZXlzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBrZXlTdHIgXSBvZiBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZW50cmllcygpKSB7XG5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkS2V5T2JqID0gSlNPTi5wYXJzZShrZXlTdHIpO1xuXG4gICAgICAgICAgICBwYXJlbnRLZXlzLnB1c2goa2V5U3RyKTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGNoaWxkRmllbGQsIHZhbCBdIG9mIE9iamVjdC5lbnRyaWVzKGNoaWxkS2V5T2JqKSkge1xuICAgICAgICAgICAgICAgIGZpbHRlcnNbIGNoaWxkRmllbGQgXSA9IHsgZXE6IHZhbCB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9taXNlcy5wdXNoKFxuICAgICAgICAgICAgICAgIGNoaWxkU2VydmljZS5saXN0KHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlczogY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcblxuICAgICAgICAvLyBGb3IgZWFjaCByZXN1bHQsIG1hcCBjaGlsZHJlbiBiYWNrIHRvIHRoZSBjb3JyZWN0LXBhcmVudChzKVxuICAgICAgICBjb25zdCBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuOiBSZWNvcmQ8c3RyaW5nLCBhbnlbXT4gPSB7fTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN1bHRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCB7IGRhdGE6IGNoaWxkSXRlbXMgfSA9IHJlc3VsdHNbIGkgXTtcbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IHBhcmVudEtleXNbIGkgXTtcbiAgICAgICAgICAgIHBhcmVudEtleVN0clRvQ2hpbGRyZW5bIGtleVN0ciBdID0gY2hpbGRJdGVtcyA/PyBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEF0dGFjaCB0byBwYXJlbnRzXG4gICAgICAgIGZvciAoY29uc3QgWyBrZXlTdHIsIHBhcmVudHMgXSBvZiBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZW50cmllcygpKSB7XG4gICAgICAgICAgICBjb25zdCBjaGlsZEFycmF5ID0gcGFyZW50S2V5U3RyVG9DaGlsZHJlblsga2V5U3RyIF0gPz8gW107XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHAgb2YgcGFyZW50cykge1xuICAgICAgICAgICAgICAgIHBbIGNoaWxkQXR0cmlidXRlTmFtZSBdID0gY2hpbGRBcnJheTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBhbiBlbnRpdHkgYnkgaXRzIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5LlxuICAgICAqIEBwYXJhbSBzZWxlY3Rpb25zIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXRyaWV2ZWQgZW50aXR5IGRhdGEuXG4gICAgICovXG5cbiAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldE9wdGlvbnM8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMgfSA9IG9wdGlvbnM7XG5cblxuICAgICAgICBsZXQgZm9ybWF0dGVkQXR0cmlidXRlcyA9IGF0dHJpYnV0ZXM7XG4gICAgICAgIGlmICghYXR0cmlidXRlcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmb3JtYXR0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvcm1hdHRlZCBhdHRyaWJ1dGVzIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZm9ybWF0dGVkQXR0cmlidXRlcyk7XG5cbiAgICAgICAgY29uc3QgcmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBhbnkpLnJlZHVjZSgoYWNjLCBbIGF0dE5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYWNjLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICBpZiAoaXNPYmplY3Qob3B0aW9ucykgJiYgb3B0aW9ucy5pZGVudGlmaWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8YW55Pj4gPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycyA6IFsgb3B0aW9ucy5pZGVudGlmaWVycyBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcEtleXMgPSBpZGVudGlmaWVycy5tYXAoaWRlbnRpZmllciA9PiBpZGVudGlmaWVyLnNvdXJjZT8uc3BsaXQ/LignLicpPy5bIDAgXSkuZmlsdGVyKGtleSA9PiAhIWtleSkgYXMgc3RyaW5nW107XG4gICAgICAgICAgICAgICAgYWNjLnB1c2goLi4udG9wS2V5cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCBbXSBhcyBzdHJpbmdbXSk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyA9IFsgLi4ubmV3IFNldChyZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMpIF1cblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJldHJpZXZlZCBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmICghIWZvcm1hdHRlZEF0dHJpYnV0ZXMgJiYgZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgWyBlbnRpdHkuZGF0YSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRpdHk/LmRhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGJ5IHRoZWlyIGlkZW50aWZpZXJzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGJhdGNoIHJldHJpZXZpbmcgZW50aXRpZXMuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuaWRlbnRpZmllcnMgLSBBcnJheSBvZiBlbnRpdHkgaWRlbnRpZmllcnMgdG8gcmV0cmlldmUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlcyAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBpbmNsdWRlIGluIHRoZSByZXNwb25zZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5jb25jdXJyZW50IC0gT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyB0byBwZXJmb3JtIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGJhdGNoR2V0PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBhdHRyaWJ1dGVzPzogRW50aXR5U2VsZWN0aW9uczxTPixcbiAgICAgICAgY29uY3VycmVudD86IG51bWJlclxuICAgIH0pIHtcbiAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgYXR0cmlidXRlcywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzO1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm9ybWF0dGVkQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3JtYXR0ZWQgYXR0cmlidXRlcyBmb3IgYmF0Y2ggZ2V0IG9uIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBmb3JtYXR0ZWRBdHRyaWJ1dGVzKTtcblxuICAgICAgICBjb25zdCByZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIGFueSkucmVkdWNlKChhY2MsIFsgYXR0TmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhY2MucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIGlmIChpc09iamVjdChvcHRpb25zKSAmJiBvcHRpb25zLmlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IEFycmF5PFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+PiA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzIDogWyBvcHRpb25zLmlkZW50aWZpZXJzIF07XG4gICAgICAgICAgICAgICAgY29uc3QgdG9wS2V5cyA9IGlkZW50aWZpZXJzLm1hcChpZGVudGlmaWVyID0+IGlkZW50aWZpZXIuc291cmNlPy5zcGxpdD8uKCcuJyk/LlsgMCBdKS5maWx0ZXIoa2V5ID0+ICEha2V5KSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgICAgICBhY2MucHVzaCguLi50b3BLZXlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIFtdIGFzIHN0cmluZ1tdKTtcblxuICAgICAgICBjb25zdCB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzID0gWyAuLi5uZXcgU2V0KHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcykgXTtcblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRCYXRjaEVudGl0eTxTPih7XG4gICAgICAgICAgICBpZHM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyBhcyBhbnksXG4gICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZXRyaWV2ZWQgYmF0Y2ggZW50aXRpZXM6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmICghIWZvcm1hdHRlZEF0dHJpYnV0ZXMgJiYgZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXR5LmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGRhdGE6IGVudGl0eT8uZGF0YSB8fCBbXSxcbiAgICAgICAgICAgIHVucHJvY2Vzc2VkOiBlbnRpdHk/LnVucHJvY2Vzc2VkIHx8IFtdXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIHRoZSB1bmlxdWVuZXNzIG9mIGFuIGF0dHJpYnV0ZSB2YWx1ZSBhbmQgdXBkYXRlcyB0aGUgcGF5bG9hZCBpZiBuZWNlc3NhcnkuXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY2hlY2tpbmcgdW5pcXVlbmVzcyBhbmQgdXBkYXRpbmcgdGhlIHBheWxvYWQuXG4gICAgICogQHBhcmFtIG9wdGlvbnMucGF5bG9hZFRvVXBkYXRlIC0gVGhlIHBheWxvYWQgb2JqZWN0IHRvIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVWYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLm1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSAtIFRoZSBtYXhpbXVtIG51bWJlciBvZiBhdHRlbXB0cyB0byBjcmVhdGUgYSB1bmlxdWUgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqIEByZXR1cm5zIEEgYm9vbGVhbiBpbmRpY2F0aW5nIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZShvcHRpb25zOiB7XG4gICAgICAgIHBheWxvYWRUb1VwZGF0ZTogYW55LFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGF0dHJpYnV0ZVZhbHVlOiBhbnksXG4gICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycz86IHtcbiAgICAgICAgICAgIFsga2V5OiBzdHJpbmcgXTogYW55XG4gICAgICAgIH1cbiAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlOiBudW1iZXIsXG4gICAgfSkge1xuXG4gICAgICAgIGNvbnN0IHsgcGF5bG9hZFRvVXBkYXRlLCBhdHRyaWJ1dGVOYW1lLCBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMsIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB9ID0gb3B0aW9ucztcbiAgICAgICAgbGV0IHsgYXR0cmlidXRlVmFsdWUgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGlzVW5pcXVlID0gZmFsc2U7XG4gICAgICAgIGxldCB0cmllc0NvdW50ID0gMTtcblxuICAgICAgICB3aGlsZSAoIWlzVW5pcXVlICYmIHRyaWVzQ291bnQgPCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUpIHtcbiAgICAgICAgICAgIGlzVW5pcXVlID0gYXdhaXQgdGhpcy5pc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKGF0dHJpYnV0ZU5hbWUsIGF0dHJpYnV0ZVZhbHVlLCBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpO1xuICAgICAgICAgICAgaWYgKCFpc1VuaXF1ZSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZVZhbHVlID0gdGhpcy5nZW5lcmF0ZVVuaXF1ZVZhbHVlKGF0dHJpYnV0ZVZhbHVlLCB0cmllc0NvdW50KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRyaWVzQ291bnQrKztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1VuaXF1ZSkge1xuICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlWyBhdHRyaWJ1dGVOYW1lIF0gPSBhdHRyaWJ1dGVWYWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpc1VuaXF1ZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgaWYgdGhlIGdpdmVuIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUgZm9yIHRoZSBzcGVjaWZpZWQgYXR0cmlidXRlIG5hbWUuXG4gICAgICogQHBhcmFtIGF0dHJpYnV0ZU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBhdHRyaWJ1dGVWYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEByZXR1cm5zIEEgYm9vbGVhbiBpbmRpY2F0aW5nIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUgb3Igbm90LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGF0dHJpYnV0ZVZhbHVlOiBhbnksXG4gICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycz86IHtcbiAgICAgICAgICAgIFsga2V5OiBzdHJpbmcgXTogYW55XG4gICAgICAgIH1cbiAgICApIHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gYXR0cmlidXRlTmFtZTogJHthdHRyaWJ1dGVOYW1lfSB+IGF0dHJpYnV0ZVZhbHVlOiAke2F0dHJpYnV0ZVZhbHVlfWApO1xuXG4gICAgICAgIC8vIENyZWF0ZSBmaWx0ZXJzIGZvciB0aGUgcXVlcnkgdXNpbmcgdGhlIGNvcnJlY3Qgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBbIGF0dHJpYnV0ZU5hbWUgXTogeyBlcTogYXR0cmlidXRlVmFsdWUgfVxuICAgICAgICB9IGFzIEVudGl0eUZpbHRlckNyaXRlcmlhPFM+O1xuXG4gICAgICAgIC8vIERldGVybWluZSB3aGljaCBhdHRyaWJ1dGVzIHRvIHByb2plY3QgLSBvbmx5IHRoZSBhdHRyaWJ1dGUgYmVpbmcgY2hlY2tlZCBhbmQgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllcnNcbiAgICAgICAgY29uc3QgYXR0cmlidXRlc1RvUHJvamVjdDogc3RyaW5nW10gPSBbIGF0dHJpYnV0ZU5hbWUgXTtcblxuICAgICAgICAvLyBBZGQgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllciBmaWVsZHMgdG8gdGhlIHByb2plY3Rpb25cbiAgICAgICAgaWYgKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyAmJiAhaXNFbXB0eU9iamVjdERlZXAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFhdHRyaWJ1dGVzVG9Qcm9qZWN0LmluY2x1ZGVzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlc1RvUHJvamVjdC5wdXNoKGtleSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgdGhlIHF1ZXJ5IG1ldGhvZCB0byBsZXZlcmFnZSBpbmRleCBzZWxlY3Rpb24gbG9naWMgd2l0aCBtaW5pbWFsIGF0dHJpYnV0ZSBwcm9qZWN0aW9uXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoe1xuICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXNUb1Byb2plY3QgYXMgYW55LFxuICAgICAgICAgICAgcGFnaW5hdGlvbjogeyBjb3VudDogMSB9IC8vIFdlIG9ubHkgbmVlZCB0byBrbm93IGlmIGFueSByZWNvcmRzIGV4aXN0XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGhhdmUgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllcnMsIGZpbHRlciB0aGUgcmVzdWx0cyBpbiBtZW1vcnlcbiAgICAgICAgbGV0IGVudGl0aWVzID0gcmVzdWx0LmRhdGEgfHwgW107XG4gICAgICAgIGlmIChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMgJiYgIWlzRW1wdHlPYmplY3REZWVwKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIGVudGl0aWVzID0gZW50aXRpZXMuZmlsdGVyKGVudGl0eSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICFPYmplY3QuZW50cmllcyhpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpLmV2ZXJ5KChbIGtleSwgdmFsdWUgXSkgPT5cbiAgICAgICAgICAgICAgICAgICAgZW50aXR5WyBrZXkgXSA9PT0gdmFsdWVcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gYXR0cmlidXRlTmFtZTogJHthdHRyaWJ1dGVOYW1lfSB+IGF0dHJpYnV0ZVZhbHVlOiAke2F0dHJpYnV0ZVZhbHVlfSB+IGVudGl0eTpgLCB7IGRhdGE6IGVudGl0aWVzIH0pO1xuXG4gICAgICAgIHJldHVybiBlbnRpdGllcy5sZW5ndGggPT09IDA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIGEgdW5pcXVlIHZhbHVlIGJ5IGFwcGVuZGluZyBhIHVuaXF1ZSBzdWZmaXggdG8gdGhlIG9yaWdpbmFsIHZhbHVlLlxuICAgICAqIEBwYXJhbSBvcmlnaW5hbFZhbHVlIC0gVGhlIG9yaWdpbmFsIHZhbHVlIHRvIGdlbmVyYXRlIGEgdW5pcXVlIHZhbHVlIGZyb20uXG4gICAgICogQHBhcmFtIGF0dGVtcHQgLSBUaGUgYXR0ZW1wdCBudW1iZXIgb3Igc3RyaW5nIHRvIGJlIHVzZWQgYXMgYSBzdWZmaXggKGRlZmF1bHQ6IHJhbmRvbSBzdHJpbmcpLlxuICAgICAqIEByZXR1cm5zIFRoZSBnZW5lcmF0ZWQgdW5pcXVlIHZhbHVlLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZW5lcmF0ZVVuaXF1ZVZhbHVlKG9yaWdpbmFsVmFsdWU6IGFueSwgYXR0ZW1wdDogbnVtYmVyIHwgc3RyaW5nID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDIsIDE1KSk6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IHVuaXF1ZVN1ZmZpeCA9IGAke0RhdGUubm93KCl9LSR7YXR0ZW1wdH1gO1xuICAgICAgICByZXR1cm4gYCR7b3JpZ2luYWxWYWx1ZX0tJHt1bmlxdWVTdWZmaXh9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBdXRvbWF0aWNhbGx5IGluamVjdHMgYWN0b3IgY29udGV4dCBpbnRvIGVudGl0eSBkYXRhXG4gICAgICogQHBhcmFtIGRhdGEgLSBUaGUgZW50aXR5IGRhdGEgdG8gZW5oYW5jZVxuICAgICAqIEBwYXJhbSBvcGVyYXRpb24gLSBUaGUgb3BlcmF0aW9uIHR5cGUgKGNyZWF0ZS91cGRhdGUpXG4gICAgICogQHBhcmFtIGN0eCAtIFRoZSBleGVjdXRpb24gY29udGV4dCBjb250YWluaW5nIGFjdG9yIGluZm9cbiAgICAgKiBAcmV0dXJucyBFbmhhbmNlZCBkYXRhIHdpdGggYWN0b3IgY29udGV4dFxuICAgICAqL1xuICAgIHByb3RlY3RlZCBpbmplY3RBY3RvckNvbnRleHQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KFxuICAgICAgICBkYXRhOiBULCBcbiAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RlbGV0ZScsIFxuICAgICAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0XG4gICAgKTogVCB7XG5cbiAgICAgICAgaWYgKCFjdHg/LmFjdG9yKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQmFzZUVudGl0eVNlcnZpY2U6IE5vIGFjdG9yIGNvbnRleHQgZm91bmQsIHNraXBwaW5nIGluamVjdGlvbicpO1xuICAgICAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCBlbmhhbmNlZERhdGEgPSB7IC4uLmRhdGEgfTtcbiAgICAgICAgY29uc3QgeyBhY3RvciB9ID0gY3R4O1xuXG4gICAgICAgIC8vIEdldCBjdXJyZW50IHRpbWVzdGFtcCBmb3IgZGF0YWJhc2Ugb3BlcmF0aW9uXG4gICAgICAgIGNvbnN0IGN1cnJlbnRUaW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBJbmplY3QgdmlzaWJsZSBhY3RvciBmaWVsZHMgaWYgZGVmaW5lZCBpbiBzY2hlbWEgYW5kIG5vdCByZWFkLW9ubHlcbiAgICAgICAgaWYgKG9wZXJhdGlvbiA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnY3JlYXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdjcmVhdGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdjcmVhdGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5jcmVhdGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBGb3IgZGVsZXRlIG9wZXJhdGlvbnMsIHdlIHN0aWxsIHdhbnQgdG8gdHJhY2sgd2hvIHBlcmZvcm1lZCB0aGUgZGVsZXRpb25cbiAgICAgICAgaWYgKG9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnZGVsZXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnZGVsZXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5kZWxldGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICdkZWxldGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICdkZWxldGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5kZWxldGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQWx3YXlzIHVwZGF0ZSB0aGVzZSBmaWVsZHMgb24gY3JlYXRlL3VwZGF0ZSAoaWYgbm90IHJlYWQtb25seSlcbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndXBkYXRlZEJ5JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndXBkYXRlZEJ5JykgJiYgYWN0b3IuYWN0b3JJZCkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS51cGRhdGVkQnkgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICd1cGRhdGVkQXQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd1cGRhdGVkQXQnKSkge1xuICAgICAgICAgICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS51cGRhdGVkQXQgPSBjdXJyZW50VGltZXN0YW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsICd0ZW5hbnRJZCcpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3RlbmFudElkJykgJiYgYWN0b3IudGVuYW50SWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudGVuYW50SWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFsd2F5cyBpbmplY3QgY29tcGxldGUgYWN0b3IgY29udGV4dCBmb3IgYXVkaXQgdHJhaWxcbiAgICAgICAgLy8gVGhpcyBmaWVsZCBpcyBoaWRkZW4gZnJvbSBBUEkgcmVzcG9uc2VzIGJ5IGRlZmF1bHRcbiAgICAgICAgLy8gQ2xlYW4gYWN0b3Igb2JqZWN0IGJ5IHJlbW92aW5nIHVuZGVmaW5lZCB2YWx1ZXMgKER5bmFtb0RCIGRvZXNuJ3QgYWxsb3cgdGhlbSlcbiAgICAgICAgY29uc3QgY2xlYW5BY3RvciA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKGFjdG9yKS5maWx0ZXIoKFtfLCB2YWx1ZV0pID0+IHZhbHVlICE9PSB1bmRlZmluZWQpXG4gICAgICAgICk7XG5cbiAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLl9hY3RvciA9IGNsZWFuQWN0b3I7XG5cbiAgICAgICAgcmV0dXJuIGVuaGFuY2VkRGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF5bG9hZCAtIFRoZSBwYXlsb2FkIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgY3JlYXRlKHBheWxvYWQ6IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgICAgIGxldCBwYXlsb2FkQ29weSA9IHsgLi4ucGF5bG9hZCB9O1xuICAgICAgICBcbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHRcbiAgICAgICAgcGF5bG9hZENvcHkgPSB0aGlzLmluamVjdEFjdG9yQ29udGV4dChwYXlsb2FkQ29weSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJyc7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnbmFtZScpIHx8ICcnO1xuXG4gICAgICAgIGlmIChlbnRpdHlTbHVnQXR0cmlidXRlICYmICEoZW50aXR5U2x1Z0F0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIChlbnRpdHlOYW1lQXR0cmlidXRlIGluIHBheWxvYWRDb3B5KSkge1xuICAgICAgICAgICAgICAgIHBheWxvYWRDb3B5WyBlbnRpdHlTbHVnQXR0cmlidXRlIGFzIGtleW9mIHR5cGVvZiBwYXlsb2FkQ29weSBdID0gdG9TbHVnKHBheWxvYWRDb3B5WyBlbnRpdHlOYW1lQXR0cmlidXRlIF0pIGFzIGFueTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gcGF5bG9hZENvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gcGF5bG9hZENvcHlbIG5hbWUhIF07XG4gICAgICAgICAgICAgICAgICAgIHVuaXF1ZW5lc3NDaGVja3MucHVzaCgoKSA9PiB0aGlzLmNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IHBheWxvYWRDb3B5LFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHVuaXF1ZW5lc3NDaGVja3MubWFwKGNoZWNrID0+IGNoZWNrKCkpKTtcblxuICAgICAgICAgICAgaWYgKGNoZWNrUmVzdWx0cy5pbmNsdWRlcyhmYWxzZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHNQYXRoID0gdW5pcXVlRmllbGRzLm1hcChmaWVsZCA9PiBmaWVsZC5uYW1lISkgPz8gW107XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKFsge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlVuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igb25lIG9yIG1vcmUgZmllbGRzLlwiLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiB1bmlxdWVGaWVsZHNQYXRoLFxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogWyAndW5pcXVlJywgdW5pcXVlRmllbGRzIF0sXG4gICAgICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGNyZWF0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBkYXRhOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGVudGl0eTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzLU9SLVVwZGF0ZXMgYW4gZW50aXR5LlxuICAgICAqIE5PVEU6IFxuICAgICAqICAgLSBUaGlzIG1ldGhvZCBkb2VzIG5vdCBjaGVjayBmb3IgdW5pcXVlbmVzcyBvZiB0aGUgYXR0cmlidXRlcywgbmVpdGhlciBjcmVhdGUgdGhlIHNsdWcgYXV0b21hdGljYWxseS5cbiAgICAgKiAgIC0gSXQncyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgdGhlIGNhbGxlciB0byBlbnN1cmUgdGhlIHJlYWQgb255IGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpZiB0aGUgcmVjb3JkIGlzIGJlaW5nIHVwc2VydC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF5bG9hZCAtIFRoZSBwYXlsb2FkIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIE9iamVjdCBjb250YWluaW5nOlxuICAgICAqICAgLSBkYXRhOiBUaGUgdXBzZXJ0ZWQgZW50aXR5IGRhdGFcbiAgICAgKiAgIC0gd2FzQ3JlYXRlZDogdHJ1ZSBpZiByZWNvcmQgd2FzIGNyZWF0ZWQsIGZhbHNlIGlmIHVwZGF0ZWRcbiAgICAgKiAgIC0gb2xkRGF0YTogcHJldmlvdXMgZGF0YSBpZiBpdCB3YXMgYW4gdXBkYXRlICh1bmRlZmluZWQgZm9yIGNyZWF0ZXMpXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHVwc2VydChwYXlsb2FkOiBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IHVwc2VydCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcGF5bG9hZDpgLCBwYXlsb2FkKTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB1cHNlcnRFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgZGF0YTogcGF5bG9hZCxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgZHVwbGljYXRlIGVudGl0eSBkYXRhIGJhc2VkIG9uIHRoZSBnaXZlbiBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgZHVwbGljYXRlIGVudGl0eSBkYXRhLlxuICAgICAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gcmVjb3JkIGlzIGZvdW5kIGZvciB0aGUgZ2l2ZW4gaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBpZGVudGlmaWVycyA9IHsgaWQ6IDEgfTtcbiAgICAgKiBjb25zdCBkdXBsaWNhdGVEYXRhID0gYXdhaXQgbWFrZUR1cGxpY2F0ZUVudGl0eURhdGFCeUlkZW50aWZpZXJzKGlkZW50aWZpZXJzKTtcbiAgICAgKiBjb25zb2xlLmxvZyhkdXBsaWNhdGVEYXRhKTsgLy8geyBuYW1lOiAnSm9obiBEb2UnLCBhZ2U6IDMwLCAuLi4gfVxuICAgICAqL1xuICAgIHByb3RlY3RlZCBhc3luYyBtYWtlRHVwbGljYXRlRW50aXR5RGF0YShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPikge1xuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCB0aGlzLmdldCh7IGlkZW50aWZpZXJzIH0pIGFzIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+O1xuXG4gICAgICAgIGlmICghZW50aXR5KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IHJlY29yZCBmb3VuZCBmb3IgaWRlbnRpZmllcnM6ICR7aWRlbnRpZmllcnN9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgZHVwbGljYXRlRXZlbnREYXRhOiBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4gPSB7fSBhcyBhbnk7XG4gICAgICAgIGNvbnN0IHByaW1hcnlJZFByb3BOYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKSBhcyBzdHJpbmc7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IChnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnc2x1ZycpIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gKGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICduYW1lJykgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG5cbiAgICAgICAgZm9yIChsZXQgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZW50aXR5KSkge1xuXG4gICAgICAgICAgICBpZiAoa2V5ICE9PSBwcmltYXJ5SWRQcm9wTmFtZSkge1xuICAgICAgICAgICAgICAgIC8vIFRPRE86IGhhbmRsZSB3aGVuIGVudGl0eSBoYXMgbXVsdGlwbGUgaWRlbnRpZmllcnNcblxuICAgICAgICAgICAgICAgIGlmIChrZXkudG9VcHBlckNhc2UoKSA9PT0gZW50aXR5TmFtZUF0dHJpYnV0ZSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGAke3ZhbHVlfSAtIENvcHlgO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoa2V5LnRvVXBwZXJDYXNlKCkgPT09IGVudGl0eVNsdWdBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBgJHt2YWx1ZX0tY29weWA7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZHVwbGljYXRlRXZlbnREYXRhWyBrZXkgYXMga2V5b2YgdHlwZW9mIGR1cGxpY2F0ZUV2ZW50RGF0YSBdID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZHVwbGljYXRlRXZlbnREYXRhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBkdXBsaWNhdGUgZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBkdXBsaWNhdGUuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGR1cGxpY2F0ZWQgZW50aXR5LlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3QgZW50aXR5SWQgPSB7IGlkOiAxMjMsIG5hbWU6ICdleGFtcGxlJyB9O1xuICAgICAqIGNvbnN0IGR1cGxpY2F0ZWRFbnRpdHkgPSBhd2FpdCBkdXBsaWNhdGUoZW50aXR5SWQpO1xuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBkdXBsaWNhdGUoaWQ6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZHVwbGljYXRlRXZlbnREYXRhID0gYXdhaXQgdGhpcy5tYWtlRHVwbGljYXRlRW50aXR5RGF0YShpZCk7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNyZWF0ZShkdXBsaWNhdGVFdmVudERhdGEsIGN0eCk7XG4gICAgfVxuXG4gICAgLy8gVE9ETzogc2hvdWxkIGJlIHBhcnQgb2Ygc29tZSBjb25maWdcbiAgICBwcm90ZWN0ZWQgZGVsaW1pdGVyc1JlZ2V4ID0gLyg/OiZ8IHwsfFxcKykrLztcblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBhIGxpc3Qgb2YgZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIHF1ZXJ5LlxuICAgICAqIC0gSWYgbm8gc3BlY2lmaWMgYXR0cmlidXRlcyBhcmUgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2YgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAtIElmIGEgc2VhcmNoIHRlcm0gaXMgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5IGl0IHdpbGwgc3BsaXQgdGhlIHNlYXJjaCB0ZXJtIGJ5IGAvKD86JnwgfCx8XFwrKSsvYCBSZWdleCBhbmQgd2lsbCBmaWx0ZXIgb3V0IGVtcHR5IHN0cmluZ3MuXG4gICAgICogLSBJZiBzZWFyY2ggYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIHNlYXJjaGFibGUgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcXVlcnkgLSBUaGUgcXVlcnkgb2JqZWN0IGNvbnRhaW5pbmcgZmlsdGVycywgc2VhcmNoIGtleXdvcmRzLCBhbmQgYXR0cmlidXRlcy5cbiAgICAgKiBAcmV0dXJucyBBIFByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgbGlzdCBvZiBlbnRpdGllcyBhbmQgdGhlIG9yaWdpbmFsIHF1ZXJ5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBsaXN0KHF1ZXJ5OiBFbnRpdHlRdWVyeTxTPiA9IHt9LCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gbGlzdCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcXVlcnk6YCwgcXVlcnkpO1xuXG4gICAgICAgIGlmICghcXVlcnkuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgcXVlcnkuYXR0cmlidXRlcyA9IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGZvciBsaXN0aW5nIEFQSSBhdHRyaWJ1dGVzIHdvdWxkIGJlIGFuIGFycmF5XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHF1ZXJ5LmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhxdWVyeS5hdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIHF1ZXJ5LmF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocXVlcnkuc2VhcmNoKSB7XG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoKSkge1xuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaCA9IHF1ZXJ5LnNlYXJjaC50cmltKCkuc3BsaXQodGhpcy5kZWxpbWl0ZXJzUmVnZXggPz8gJyAnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuc2VhcmNoLmxlbmd0aCA+IDApIHtcblxuICAgICAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzID0gcXVlcnkuc2VhcmNoQXR0cmlidXRlcy5zcGxpdCgnLCcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghcXVlcnkuc2VhcmNoQXR0cmlidXRlcyB8fCBpc0VtcHR5KHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSB0aGlzLmdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlckdyb3VwID0gbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMocXVlcnkuc2VhcmNoLCBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKTtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LmZpbHRlcnMgPSBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4oc2VhcmNoRmlsdGVyR3JvdXAgYXMgYW55LCBxdWVyeS5maWx0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzID0gYXdhaXQgbGlzdEVudGl0eTxTPih7XG4gICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZW50aXRpZXMuZGF0YSA9IHRoaXMuc2VyaWFsaXplUmVjb3JkcyhlbnRpdGllcy5kYXRhLCBxdWVyeS5hdHRyaWJ1dGVzKTtcblxuICAgICAgICBpZiAocXVlcnkuYXR0cmlidXRlcyAmJiBlbnRpdGllcy5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKHF1ZXJ5LmF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAvLyBvbmx5IGF0dHJpYnV0ZXMgaW4gaHlkcmF0ZSBvcHRpb25zIHRoYXQgaGF2ZSByZWxhdGlvbiBtZXRhZGF0YSBhdHRhY2hlZCB0byB0aGVtIG5lZWRzIHRvIGJlIGh5ZHJhdGVkXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0aWVzLmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgLi4uZW50aXRpZXMsIHF1ZXJ5IH07XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBFeGVjdXRlcyBhIHF1ZXJ5IG9uIHRoZSBlbnRpdHkuXG4gICAgICogLSBJZiBubyBzcGVjaWZpYyBhdHRyaWJ1dGVzIGFyZSBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIC0gSWYgYSBzZWFyY2ggdGVybSBpcyBwcm92aWRlZCBpbiB0aGUgcXVlcnkgaXQgd2lsbCBzcGxpdCB0aGUgc2VhcmNoIHRlcm0gYnkgYC8oPzomfCB8LHxcXCspKy9gIFJlZ2V4IGFuZCB3aWxsIGZpbHRlciBvdXQgZW1wdHkgc3RyaW5ncy5cbiAgICAgKiAgIC0tIElmIHNlYXJjaCBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2Ygc2VhcmNoYWJsZSBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqICAgLS0gSWYgdGhlcmUgYXJlIGFueSBub24tZW1wdHkgc2VhcmNoLXRlcm1zLCBpdCB3aWxsIGFkZCBhIGZpbHRlciBncm91cCB0byB0aGUgcXVlcnkgYmFzZWQgb24gdGhlIHNlYXJjaCBrZXl3b3Jkcy5cbiAgICAgKiBAcGFyYW0gcXVlcnkgLSBUaGUgZW50aXR5IHF1ZXJ5IHRvIGV4ZWN1dGUuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJlc3VsdCBvZiB0aGUgcXVlcnkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHF1ZXJ5KHF1ZXJ5OiBFbnRpdHlRdWVyeTxTPiwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGxpc3QgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IHF1ZXJ5OmAsIHF1ZXJ5KTtcblxuICAgICAgICBjb25zdCB7IGF0dHJpYnV0ZXMgfSA9IHF1ZXJ5O1xuXG4gICAgICAgIGxldCBzZWxlY3RBdHRyaWJ1dGVzOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHwgdW5kZWZpbmVkID0gYXR0cmlidXRlcyB8fCB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAvLyBwYXJzZSB0aGUgbGlzdCBvZiBkb3Qtc2VwYXJhdGVkIGF0dHJpYnV0ZS1pZGVudGlmaWVycyBwYXRocyBhbmQgZW5zdXJlIGFsbCB0aGUgcmVxdWlyZWQgbWV0YWRhdGEgaXMgdGhlcmVcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHNlbGVjdEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgc2VsZWN0QXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGVuc3VyZSBhbGwgdGhlIHByb3ZpZGVkIHNlbGVjdCBhdHRyaWJ1dGVzIGhhcyByZXF1aXJlZCBtZXRhZGF0YSBhbGwgdGhlIHdheSBkb3duIHRvIHRoZSBsZWFmIGxldmVsXG4gICAgICAgICAgICBzZWxlY3RBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHNlbGVjdEF0dHJpYnV0ZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaCkge1xuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaCkpIHtcbiAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2ggPSBxdWVyeS5zZWFyY2gudHJpbSgpLnNwbGl0KHRoaXMuZGVsaW1pdGVyc1JlZ2V4ID8/ICcgJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaC5sZW5ndGggPiAwKSB7XG5cbiAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzID0gcXVlcnkuc2VhcmNoQXR0cmlidXRlcyB8fCB0aGlzLmdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRmlsdGVyR3JvdXAgPSBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcyhxdWVyeS5zZWFyY2gsIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuZmlsdGVycyA9IGFkZEZpbHRlckdyb3VwVG9FbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPihzZWFyY2hGaWx0ZXJHcm91cCBhcyBhbnksIHF1ZXJ5LmZpbHRlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXMgPSBhd2FpdCBxdWVyeUVudGl0eTxTPih7XG4gICAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZW50aXRpZXMuZGF0YSA9IHRoaXMuc2VyaWFsaXplUmVjb3JkcyhlbnRpdGllcy5kYXRhLCBzZWxlY3RBdHRyaWJ1dGVzKTtcblxuICAgICAgICBpZiAoc2VsZWN0QXR0cmlidXRlcyAmJiBlbnRpdGllcy5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKHNlbGVjdEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAvLyBvbmx5IGF0dHJpYnV0ZXMgaW4gaHlkcmF0ZSBvcHRpb25zIHRoYXQgaGF2ZSByZWxhdGlvbiBtZXRhZGF0YSBhdHRhY2hlZCB0byB0aGVtIG5lZWRzIHRvIGJlIGh5ZHJhdGVkXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0aWVzLmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgLi4uZW50aXRpZXMsIHF1ZXJ5IH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVXBkYXRlcyBhbiBlbnRpdHkgaW4gdGhlIGRhdGFiYXNlLlxuICAgICAqXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gdXBkYXRlLlxuICAgICAqIEBwYXJhbSBkYXRhIC0gVGhlIHVwZGF0ZWQgZGF0YSBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcGFyYW0gcmVtb3ZlIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlcyB0byByZW1vdmUgZnJvbSB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSB1cGRhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgdXBkYXRlKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+LCBkYXRhOiBVcGRhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4sIG9wZXJhdG9ycz86IFVwZGF0ZUVudGl0eU9wZXJhdG9ycywgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgICAgIC8vIEluamVjdCBhY3RvciBjb250ZXh0XG4gICAgICAgIGxldCBlbmhhbmNlZERhdGEgPSB0aGlzLmluamVjdEFjdG9yQ29udGV4dChkYXRhIGFzIGFueSwgJ3VwZGF0ZScsIGN0eCk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzID0gdGhpcy5nZXRVbmlxdWVBdHRyaWJ1dGVzKCk7XG4gICAgICAgIGNvbnN0IHNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSA9IDU7XG5cbiAgICAgICAgaWYgKCFza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyAmJiB1bmlxdWVGaWVsZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICBsZXQgdW5pcXVlbmVzc0NoZWNrcyA9IFtdO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZSwgcmVhZE9ubHkgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAocmVhZE9ubHkpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGVuaGFuY2VkRGF0YVsgbmFtZSBhcyBrZXlvZiB0eXBlb2YgZW5oYW5jZWREYXRhIF07XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChuYW1lISBpbiBlbmhhbmNlZERhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gZW5oYW5jZWREYXRhWyBuYW1lIGFzIGtleW9mIHR5cGVvZiBlbmhhbmNlZERhdGEgXTtcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlbmVzc0NoZWNrcy5wdXNoKCgpID0+IHRoaXMuY2hlY2tVbmlxdWVuZXNzQW5kVXBkYXRlKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBheWxvYWRUb1VwZGF0ZTogZW5oYW5jZWREYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1cGRhdGVkRW50aXR5ID0gYXdhaXQgdXBkYXRlRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGRhdGE6IGVuaGFuY2VkRGF0YSxcbiAgICAgICAgICAgIG9wZXJhdG9yczogb3BlcmF0b3JzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdXBkYXRlZEVudGl0eTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEZWxldGVzIGFuIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gYmUgZGVsZXRlZC5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgZGVsZXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGRlbGV0ZShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBkZWxldGUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGlkZW50aWZpZXJzOmAsIGlkZW50aWZpZXJzKTtcbiAgICAgICAgXG4gICAgICAgICAgICBjb25zdCBkZWxldGVkRW50aXR5ID0gYXdhaXQgZGVsZXRlRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgICAgIGFjdG9yOiBjdHg/LmFjdG9yLFxuICAgICAgICAgICAgdGVuYW50OiBjdHg/LmFjdG9yPy50ZW5hbnRJZCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiBkZWxldGVkRW50aXR5O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBtdWx0aXBsZSBlbnRpdGllcyBpbiBhIGJhdGNoIG9wZXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBiYXRjaCBkZWxldGluZyBlbnRpdGllcy5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5pZGVudGlmaWVycyAtIEFycmF5IG9mIGVudGl0eSBpZGVudGlmaWVycyB0byBkZWxldGUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuY29uY3VycmVudCAtIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgdG8gcGVyZm9ybSAoZGVmYXVsdDogMSkuXG4gICAgICogQHBhcmFtIGN0eCAtIE9wdGlvbmFsIGV4ZWN1dGlvbiBjb250ZXh0IGNvbnRhaW5pbmcgYWN0b3IgaW5mb3JtYXRpb24uXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gb2JqZWN0IGNvbnRhaW5pbmcgYW55IHVucHJvY2Vzc2VkIGl0ZW1zLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIERlbGV0ZSBtdWx0aXBsZSBlbnRpdGllc1xuICAgICAqIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlcnZpY2UuYmF0Y2hEZWxldGUoe1xuICAgICAqICAgaWRlbnRpZmllcnM6IFtcbiAgICAgKiAgICAgeyBpZDogJ2l0ZW0xJyB9LFxuICAgICAqICAgICB7IGlkOiAnaXRlbTInIH0sXG4gICAgICogICAgIHsgaWQ6ICdpdGVtMycgfVxuICAgICAqICAgXSxcbiAgICAgKiAgIGNvbmN1cnJlbnQ6IDJcbiAgICAgKiB9KTtcbiAgICAgKiBcbiAgICAgKiBpZiAocmVzdWx0LnVucHJvY2Vzc2VkLmxlbmd0aCA+IDApIHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKCdTb21lIGl0ZW1zIHdlcmUgbm90IGRlbGV0ZWQ6JywgcmVzdWx0LnVucHJvY2Vzc2VkKTtcbiAgICAgKiB9XG4gICAgICogYGBgXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGJhdGNoRGVsZXRlKG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyXG4gICAgfSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gY291bnQ6ICR7aWRlbnRpZmllcnMubGVuZ3RofWAsIHtcbiAgICAgICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGVsZXRlQmF0Y2hFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgICAgIGlkczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgICAgICAgICBhY3RvcjogY3R4Py5hY3RvcixcbiAgICAgICAgICAgICAgICB0ZW5hbnQ6IGN0eD8uYWN0b3I/LnRlbmFudElkLFxuICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBFbGVjdHJvREIgYmF0Y2ggZGVsZXRlIHJldHVybnMgeyB1bnByb2Nlc3NlZDogQXJyYXkgfVxuICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChyZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgICAgY29uc3QgZGF0YUNvdW50ID0gcmVzdWx0LmRhdGE/Lmxlbmd0aDtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb21wbGV0ZWQgfiBiYXRjaERlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcHJvY2Vzc2VkOiAke2lkZW50aWZpZXJzLmxlbmd0aH0sIGRhdGFDb3VudDogJHtkYXRhQ291bnR9LCB1bnByb2Nlc3NlZDogJHt1bnByb2Nlc3NlZENvdW50fWApO1xuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIGJhdGNoIGRlbGV0ZSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBlbnRpdGllcyBiYXNlZCBvbiBhIHF1ZXJ5IGZpbHRlci5cbiAgICAgKiBUaGlzIG1ldGhvZCBxdWVyaWVzIGZvciBlbnRpdGllcyBtYXRjaGluZyB0aGUgZmlsdGVyIGFuZCB0aGVuIGJhdGNoIGRlbGV0ZXMgdGhlbS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBkZWxldGluZyBieSBxdWVyeS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5maWx0ZXJzIC0gVGhlIGZpbHRlciBjcml0ZXJpYSB0byBtYXRjaCBlbnRpdGllcyBmb3IgZGVsZXRpb24uXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBkZWxldGUgaW4gZWFjaCBiYXRjaCAoZGVmYXVsdDogMjUpLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBOdW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhJdGVtcyAtIE9wdGlvbmFsIG1heGltdW0gbnVtYmVyIG9mIGl0ZW1zIHRvIGRlbGV0ZSAoc2FmZXR5IGxpbWl0KS5cbiAgICAgKiBAcGFyYW0gY3R4IC0gT3B0aW9uYWwgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvcm1hdGlvbi5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3Qgd2l0aCBkZWxldGlvbiBzdGF0aXN0aWNzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIERlbGV0ZSBhbGwgaW5hY3RpdmUgdXNlcnNcbiAgICAgKiBjb25zdCByZXN1bHQgPSBhd2FpdCB1c2VyU2VydmljZS5kZWxldGVCeVF1ZXJ5KHtcbiAgICAgKiAgIGZpbHRlcnM6IHtcbiAgICAgKiAgICAgc3RhdHVzOiB7IGVxOiAnaW5hY3RpdmUnIH0sXG4gICAgICogICAgIGxhc3RMb2dpbkF0OiB7IGx0OiAnMjAyMy0wMS0wMScgfVxuICAgICAqICAgfSxcbiAgICAgKiAgIGJhdGNoU2l6ZTogNTAsXG4gICAgICogICBtYXhJdGVtczogMTAwMFxuICAgICAqIH0pO1xuICAgICAqIFxuICAgICAqIGNvbnNvbGUubG9nKGBEZWxldGVkICR7cmVzdWx0LmRlbGV0ZWRDb3VudH0gaXRlbXMsICR7cmVzdWx0LmZhaWxlZENvdW50fSBmYWlsZWRgKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZGVsZXRlQnlRdWVyeShvcHRpb25zOiB7XG4gICAgICAgIGZpbHRlcnM6IEVudGl0eUZpbHRlckNyaXRlcmlhPFM+LFxuICAgICAgICBiYXRjaFNpemU/OiBudW1iZXIsXG4gICAgICAgIGNvbmN1cnJlbnQ/OiBudW1iZXIsXG4gICAgICAgIG1heEl0ZW1zPzogbnVtYmVyXG4gICAgfSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBmaWx0ZXJzLCBiYXRjaFNpemUgPSAyNSwgY29uY3VycmVudCA9IDEsIG1heEl0ZW1zIH0gPSBvcHRpb25zO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDYWxsZWQgfiBkZWxldGVCeVF1ZXJ5IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgICAgICBiYXRjaFNpemUsXG4gICAgICAgICAgICAgICAgbWF4SXRlbXNcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBTYWZldHkgY2hlY2s6IHJlcXVpcmUgZmlsdGVycyB0byBwcmV2ZW50IGFjY2lkZW50YWwgZGVsZXRpb24gb2YgYWxsIHJlY29yZHNcbiAgICAgICAgICAgIGlmICghZmlsdGVycyB8fCBpc0VtcHR5T2JqZWN0RGVlcChmaWx0ZXJzKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignZGVsZXRlQnlRdWVyeSByZXF1aXJlcyBmaWx0ZXJzIHRvIHByZXZlbnQgYWNjaWRlbnRhbCBkZWxldGlvbiBvZiBhbGwgcmVjb3Jkcy4gVXNlIHNjYW4gd2l0aCBleHBsaWNpdCBjb25maXJtYXRpb24gaWYgeW91IG5lZWQgdG8gZGVsZXRlIGFsbCByZWNvcmRzLicpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgZGVsZXRlZENvdW50ID0gMDtcbiAgICAgICAgICAgIGxldCBmYWlsZWRDb3VudCA9IDA7XG4gICAgICAgICAgICBsZXQgY3Vyc29yOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgICAgICAgIGxldCB0b3RhbFByb2Nlc3NlZCA9IDA7XG5cbiAgICAgICAgICAgIC8vIFF1ZXJ5IGFuZCBkZWxldGUgaW4gYmF0Y2hlc1xuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICAgIC8vIEZldGNoIGEgYmF0Y2ggb2YgaXRlbXMgdG8gZGVsZXRlXG4gICAgICAgICAgICAgICAgY29uc3QgcXVlcnlSZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgY291bnQ6IGJhdGNoU2l6ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGN1cnNvcjogY3Vyc29yIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yZGVyOiAnYXNjJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhZ2VyOiAnY3Vyc29yJ1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSwgY3R4KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGl0ZW1zVG9EZWxldGUgPSBxdWVyeVJlc3VsdC5kYXRhO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmICghaXRlbXNUb0RlbGV0ZSB8fCBpdGVtc1RvRGVsZXRlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRGVsZXRpbmcgYmF0Y2ggb2YgJHtpdGVtc1RvRGVsZXRlLmxlbmd0aH0gaXRlbXNgKTtcblxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgaWRlbnRpZmllcnMgZnJvbSB0aGUgZmV0Y2hlZCBpdGVtc1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzID0gaXRlbXNUb0RlbGV0ZS5tYXAoaXRlbSA9PiBcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaXRlbSBhcyBhbnkpXG4gICAgICAgICAgICAgICAgKSBhcyBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PjtcblxuICAgICAgICAgICAgICAgIC8vIEJhdGNoIGRlbGV0ZSB0aGUgaXRlbXNcbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVSZXN1bHQgPSBhd2FpdCB0aGlzLmJhdGNoRGVsZXRlKHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgICAgICAgICB9LCBjdHgpO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChkZWxldGVSZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgICAgICAgIGNvbnN0IGRhdGFDb3VudCA9IGRlbGV0ZVJlc3VsdC5kYXRhPy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2hEZWxldGVkQ291bnQgPSBpZGVudGlmaWVycy5sZW5ndGggLSB1bnByb2Nlc3NlZENvdW50O1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudCArPSBiYXRjaERlbGV0ZWRDb3VudDtcbiAgICAgICAgICAgICAgICBmYWlsZWRDb3VudCArPSB1bnByb2Nlc3NlZENvdW50O1xuICAgICAgICAgICAgICAgIHRvdGFsUHJvY2Vzc2VkICs9IGl0ZW1zVG9EZWxldGUubGVuZ3RoO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEJhdGNoIHJlc3VsdDogJHtiYXRjaERlbGV0ZWRDb3VudH0gZGVsZXRlZCwgJHt1bnByb2Nlc3NlZENvdW50fSBmYWlsZWRgKTtcblxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGhpdCB0aGUgbWF4IGl0ZW1zIGxpbWl0XG4gICAgICAgICAgICAgICAgaWYgKG1heEl0ZW1zICYmIHRvdGFsUHJvY2Vzc2VkID49IG1heEl0ZW1zKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJlYWNoZWQgbWF4SXRlbXMgbGltaXQgb2YgJHttYXhJdGVtc30sIHN0b3BwaW5nIGRlbGV0aW9uYCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBjdXJzb3IgZm9yIG5leHQgaXRlcmF0aW9uXG4gICAgICAgICAgICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yIHx8IG51bGw7XG5cbiAgICAgICAgICAgIH0gd2hpbGUgKGN1cnNvcik7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENvbXBsZXRlZCB+IGRlbGV0ZUJ5UXVlcnkgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGRlbGV0ZWQ6ICR7ZGVsZXRlZENvdW50fSwgZmFpbGVkOiAke2ZhaWxlZENvdW50fWApO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRDb3VudCxcbiAgICAgICAgICAgICAgICBmYWlsZWRDb3VudCxcbiAgICAgICAgICAgICAgICB0b3RhbFByb2Nlc3NlZFxuICAgICAgICAgICAgfTtcblxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSBieSBxdWVyeSBmb3IgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byBkZWxldGUgYnkgcXVlcnkgZm9yICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWJ1aWxkcyBhbGwgaW5kZXhlcyBmb3IgdGhlIGVudGl0eSBieSB3cml0aW5nIHRvIHRoZSBwcmltYXJ5IGluZGV4LlxuICAgICAqIFRoaXMgbWV0aG9kIGlzIHVzZWZ1bCBmb3IgbWFpbnRhaW5pbmcgZGF0YSBpbnRlZ3JpdHkgYW5kIGVuc3VyaW5nIGluZGV4ZXMgYXJlIHByb3Blcmx5IHVwZGF0ZWQuXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBPcHRpb25zIGZvciByZWJ1aWxkaW5nIHRoZSBpbmRleFxuICAgICAqIEBwYXJhbSBvcHRpb25zLmJhdGNoU2l6ZSAtIFRoZSBudW1iZXIgb2YgaXRlbXMgdG8gcHJvY2VzcyBpbiBlYWNoIGJhdGNoLiBEZWZhdWx0cyB0byAxMDAuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgaW5kZXggcmVidWlsZCBpcyBjb21wbGV0ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgcmVidWlsZEluZGV4KG9wdGlvbnM6IHsgYmF0Y2hTaXplPzogbnVtYmVyIH0gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBiYXRjaFNpemUgPSAxMDAgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gdGhpcy5nZXRFbnRpdHlOYW1lKCk7XG4gICAgICAgICAgICBjb25zdCByZXBvc2l0b3J5ID0gdGhpcy5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFN0YXJ0aW5nIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuXG4gICAgICAgICAgICAvLyBHZXQgYWxsIHJlY29yZHMgZnJvbSB0aGUgcHJpbWFyeSBpbmRleFxuICAgICAgICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IGF3YWl0IHJlcG9zaXRvcnkuc2Nhbi5nbygpO1xuXG4gICAgICAgICAgICBpZiAoIWFsbFJlY29yZHMuZGF0YSB8fCBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gcmVjb3JkcyBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCAke2FsbFJlY29yZHMuZGF0YS5sZW5ndGh9IHJlY29yZHMgdG8gcHJvY2VzcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaGVzXG4gICAgICAgICAgICBjb25zdCB0b3RhbFJlY29yZHMgPSBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3QgdG90YWxCYXRjaGVzID0gTWF0aC5jZWlsKHRvdGFsUmVjb3JkcyAvIGJhdGNoU2l6ZSk7XG5cbiAgICAgICAgICAgIGZvciAobGV0IGJhdGNoSW5kZXggPSAwOyBiYXRjaEluZGV4IDwgdG90YWxCYXRjaGVzOyBiYXRjaEluZGV4KyspIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IGJhdGNoSW5kZXggKiBiYXRjaFNpemU7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyBiYXRjaFNpemUsIHRvdGFsUmVjb3Jkcyk7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2ggPSBhbGxSZWNvcmRzLmRhdGEuc2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGJhdGNoICR7YmF0Y2hJbmRleCArIDF9LyR7dG90YWxCYXRjaGVzfSAoJHtzdGFydCArIDF9LSR7ZW5kfSBvZiAke3RvdGFsUmVjb3Jkc30gcmVjb3JkcylgKTtcblxuICAgICAgICAgICAgICAgIC8vIFJlYnVpbGQgYWxsIGluZGV4ZXMgYnkgdXBzZXJ0aW5nIGVhY2ggcmVjb3JkIHRvIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSB1cHNlcnQgdG8gZW5zdXJlIHRoZSByZWNvcmQgaXMgcHJvcGVybHkgaW5kZXhlZFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVwb3NpdG9yeS51cHNlcnQocmVjb3JkKS5nbygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVjb3JkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbmZlcnMgcmVsYXRpb25zaGlwcyBiZXR3ZWVuIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBzY2hlbWEgYW5kIHNlbGVjdGlvbi1wYXRocy5cbiAgICAgKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBwYXRocyBUaGUgcGFyc2VkIHNlbGVjdGlvbiBwYXRocyBmcm9tIGUuZy4gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocygpLlxuICAgICAqIEBwYXJhbSBwYXRoS2V5IFRoZSBjdXJyZW50IFwicGF0aFwiIHN0cmluZyByZXByZXNlbnRpbmcgaG93IHdlIGFycml2ZWQgaGVyZSAoZGVmYXVsdHMgdG8gdGhlIGVudGl0eSBuYW1lKS5cbiAgICAgKiBAcGFyYW0gdmlzaXRlZFBhdGhzIEEgc2V0IG9mIHBhdGgtc3RyaW5ncyB2aXNpdGVkIHNvIGZhciBpbiB0aGlzIHJlY3Vyc2lvbiBjaGFpbiAocHJldmVudHMgY3ljbGVzKS5cbiAgICAgKiBAcGFyYW0gbWF4RGVwdGggTWF4aW11bSByZWN1cnNpb24gZGVwdGggKG9wdGlvbmFsKS5cbiAgICAgKi9cbiAgICBpbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgICAgICBzY2hlbWE6IEUsXG4gICAgICAgIHBhdGhzOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyxcbiAgICAgICAgcGF0aEtleTogc3RyaW5nID0gc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgdmlzaXRlZFBhdGhzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQ8c3RyaW5nPigpLFxuICAgICAgICBtYXhEZXB0aCA9IDVcbiAgICApOiBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPiB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ2luZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMnLCB7IHBhdGhLZXksIHBhdGhzIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGV4Y2VlZCBtYXggZGVwdGgsIHdlIHNraXAgZXhwYW5zaW9uc1xuICAgICAgICBpZiAobWF4RGVwdGggPD0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTWF4IHJlY3Vyc2lvbiBkZXB0aCByZWFjaGVkIGF0IHBhdGhLZXk9XCIke3BhdGhLZXl9XCJgKTtcbiAgICAgICAgICAgIHJldHVybiB7fSBhcyBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZmVycmVkOiBhbnkgPSB7fTtcblxuICAgICAgICAvLyBMb29wIG92ZXIgZWFjaCBhdHRyaWJ1dGUgaW4gdGhlIGVudGl0eSBzY2hlbWFcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpLmZvckVhY2goKFsgYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlTWV0YSBdKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhdHRWYWwgPSBwYXRoc1sgYXR0cmlidXRlTmFtZSBdO1xuICAgICAgICAgICAgaWYgKCFhdHRWYWwpIHtcbiAgICAgICAgICAgICAgICAvLyBOb3Qgc2VsZWN0ZWQgaW4gdGhlIHVzZXIncyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpc1JlbGF0aW9uYWwgPSAhIWF0dHJpYnV0ZU1ldGEucmVsYXRpb247XG5cbiAgICAgICAgICAgIC8vIElmIHRoZSBhdHRyaWJ1dGUgaXMgbm90IHJlbGF0aW9uYWwgb3IgdGhlIHZhbHVlIGlzIGEgYm9vbGVhbiwgd2UgY2FuIGluZmVyIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGlmICghaXNSZWxhdGlvbmFsIHx8IGlzQm9vbGVhbihhdHRWYWwpKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dFZhbDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEl0J3MgYSByZWxhdGlvbmFsIGF0dHJpYnV0ZTsgcHJlcGFyZSB0byByZWN1cnNlXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbk1ldGEgPSBhdHRyaWJ1dGVNZXRhLnJlbGF0aW9uITtcbiAgICAgICAgICAgIGNvbnN0IG5leHRFbnRpdHlOYW1lID0gcmVsYXRpb25NZXRhLmVudGl0eU5hbWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgbmV3IFwicGF0aFwiIHN0cmluZyB0byBkZXRlY3QgY3ljbGVzIChlLmcuIFwiVXNlci5ncm91cHMuR3JvdXAubWVtYmVycy5Vc2VyXCIpXG4gICAgICAgICAgICBjb25zdCBuZXdQYXRoID0gYCR7cGF0aEtleX0uJHthdHRyaWJ1dGVOYW1lfS4ke25leHRFbnRpdHlOYW1lfWA7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGFscmVhZHkgdmlzaXRlZCB0aGlzIHBhdGgsIGlmIHNvID0+IHNraXAgZXhwYW5zaW9ucyBmb3IgdGhpcyBhdHRyaWJ1dGUgb25seVxuICAgICAgICAgICAgaWYgKHZpc2l0ZWRQYXRocy5oYXMobmV3UGF0aCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTa2lwcGluZyBjeWMgcmVsYXRpb24gZXhwYW5zaW9ucyBmb3I6ICR7bmV3UGF0aH1gKTtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2tpcHBlZER1ZVRvQ3ljbGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIE1hcmsgdGhpcyBwYXRoIGFzIHZpc2l0ZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5hZGQobmV3UGF0aCk7XG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gdGhlIHJlbGF0ZWQgZW50aXR5J3Mgc2NoZW1hXG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihuZXh0RW50aXR5TmFtZSk7XG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgdGhlIFwibWV0YVwiIG9iamVjdCB0aGF0IHdlIHN0b3JlXG4gICAgICAgICAgICBjb25zdCBtZXRhOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24gPSB7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcmVsYXRpb25UeXBlOiByZWxhdGlvbk1ldGEudHlwZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaXNGdW5jdGlvbihyZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgICAgID8gcmVsYXRpb25NZXRhLmlkZW50aWZpZXJzKClcbiAgICAgICAgICAgICAgICAgICAgOiByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlczoge30sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgcGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBpc09iamVjdChhdHRWYWwpID8gYXR0VmFsLmF0dHJpYnV0ZXMgOiB1bmRlZmluZWQ7IC8vIHByb3ZpZGVkIGJ5IHRoZSB1c2VyIFxuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRpb25NZXRhLmF0dHJpYnV0ZXM7IC8vIGRlZmluZWQgaW4gdGhlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcyA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTsgLy8gYXV0byBnZW4gYnkgZnJhbWV3b3JrXG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gZXhwYW5kIGNoaWxkJ3MgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgbWV0YS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgKHBhdGhTZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0aW9uU2VsZWN0aW9uQXR0cmlidXRlcyB8fCByZWxhdGVkRW50aXR5RGVmYXVsdFNlbGVjdGlvbkF0dHJpYnV0ZXMpIGFzIGFueSxcbiAgICAgICAgICAgICAgICBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICB2aXNpdGVkUGF0aHMsXG4gICAgICAgICAgICAgICAgbWF4RGVwdGggLSAxXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gbWV0YTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHRoaXMgcGF0aCBzbyBzaWJsaW5ncyBjYW4gYWxzbyBleHBhbmQgaXQgaWYgbmVlZGVkXG4gICAgICAgICAgICB2aXNpdGVkUGF0aHMuZGVsZXRlKG5ld1BhdGgpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gaW5mZXJyZWQ7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHNlYXJjaChxdWVyeTogRW50aXR5U2VhcmNoUXVlcnk8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXF1ZXJ5LnNlbGVjdCkge1xuICAgICAgICAgICAgLy8gKiBOb3RlOiB3ZSBleHBlY3QgYW4gYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzXG4gICAgICAgICAgICBxdWVyeS5zZWxlY3QgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpIGFzIGFueTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2VhcmNoU2VydmljZS5zZWFyY2gocXVlcnksIHVuZGVmaW5lZCwgY3R4KTtcbiAgICB9XG59XG5cbmNvbnN0IGVudGl0eUF0dHJpYnV0ZUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZScpO1xuXG5leHBvcnQgZnVuY3Rpb24gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShhdHRJZDogc3RyaW5nLCBhdHQ6IEVudGl0eUF0dHJpYnV0ZSk6IFBhcnRpYWw8RW50aXR5QXR0cmlidXRlPiAmIHtcbiAgICBpZDogc3RyaW5nLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW11cbn0ge1xuXG4gICAgY29uc3QgeyBuYW1lLCB2YWxpZGF0aW9ucywgcmVxdWlyZWQsIHJlbGF0aW9uLCBkZWZhdWx0OiBkZWZhdWx0VmFsdWUsIGdldDogX2dldHRlciwgc2V0OiBfc2V0dGVyLCB3YXRjaCwgLi4ucmVzdE1ldGEgfSA9IGF0dDtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUsIC4uLnJlc3RSZWxhdGlvbiB9ID0gcmVsYXRpb24gfHwge307XG5cbiAgICBjb25zdCByZWxhdGlvbk1ldGEgPSByZWxhdGVkRW50aXR5TmFtZSA/IHsgLi4ucmVzdFJlbGF0aW9uLCBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSB9IDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3QgeyBpdGVtcywgdHlwZSwgcHJvcGVydGllcywgYWRkTmV3T3B0aW9uLCBhZGROZXdPcHRpb25Db25maWcsIGZpZWxkVHlwZTogZXhwbGljaXRGaWVsZFR5cGUsIG9wdGlvbnMsIC4uLnJlc3RSZXN0TWV0YSB9ID0gcmVzdE1ldGEgYXMgYW55O1xuXG4gICAgLy8gSW5mZXIgZmllbGRUeXBlIGZyb20gdHlwZSBpZiBub3QgZXhwbGljaXRseSBwcm92aWRlZFxuICAgIGxldCBpbmZlcnJlZEZpZWxkVHlwZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gZXhwbGljaXRGaWVsZFR5cGU7XG4gICAgaWYgKCFpbmZlcnJlZEZpZWxkVHlwZSAmJiB0eXBlKSB7XG4gICAgICAgIGlmICh0eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2Jvb2xlYW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdudW1iZXInO1xuICAgICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkodHlwZSkpIHtcbiAgICAgICAgICAgIC8vIEVudW0gdHlwZSBsaWtlIFsnYWN0aXZlJywgJ2luYWN0aXZlJ11cbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ3NlbGVjdCc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycgJiYgb3B0aW9ucyAmJiBBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmIG9wdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gU3RyaW5nIHdpdGggb3B0aW9ucyBpcyBhIHNlbGVjdFxuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnc2VsZWN0JztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlID09PSAnYW55Jykge1xuICAgICAgICAgICAgaW5mZXJyZWRGaWVsZFR5cGUgPSAnanNvbic7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ21hcCc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgICAgICBpbmZlcnJlZEZpZWxkVHlwZSA9ICdsaXN0JztcbiAgICAgICAgfVxuICAgICAgICAvLyBGb3IgZGF0ZSBmaWVsZHMsIGNoZWNrIGF0dHJpYnV0ZSBuYW1lIGFzIGhpbnRcbiAgICAgICAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGNvbnN0IGxvd2VyQXR0SWQgPSBhdHRJZC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgaWYgKGxvd2VyQXR0SWQuaW5jbHVkZXMoJ2RhdGUnKSB8fCBsb3dlckF0dElkID09PSAnY3JlYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAndXBkYXRlZGF0JyB8fCBsb3dlckF0dElkID09PSAnZGVsZXRlZGF0Jykge1xuICAgICAgICAgICAgICAgIGluZmVycmVkRmllbGRUeXBlID0gJ2RhdGV0aW1lJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci5kZWJ1ZyhgaW5mZXJyZWRGaWVsZFR5cGU6ICR7aW5mZXJyZWRGaWVsZFR5cGV9IGZvciBlbnRpdHkgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cImApO1xuICAgIH1cblxuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi5yZXN0UmVzdE1ldGEsXG4gICAgICAgIHR5cGUsXG4gICAgICAgIGlkOiBhdHRJZCxcbiAgICAgICAgbmFtZTogbmFtZSB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKGF0dElkKSxcbiAgICAgICAgcmVsYXRpb246IHJlbGF0aW9uTWV0YSBhcyBhbnksXG4gICAgICAgIGRlZmF1bHRWYWx1ZSxcbiAgICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25zIHx8IHJlcXVpcmVkID8gWyAncmVxdWlyZWQnIF0gOiBbXSxcbiAgICAgICAgaXNWaXNpYmxlOiAhKCdpc1Zpc2libGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzVmlzaWJsZSxcbiAgICAgICAgaXNFZGl0YWJsZTogISgnaXNFZGl0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNFZGl0YWJsZSxcbiAgICAgICAgaXNMaXN0YWJsZTogISgnaXNMaXN0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNMaXN0YWJsZSxcbiAgICAgICAgaXNDcmVhdGFibGU6ICEoJ2lzQ3JlYXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0NyZWF0YWJsZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiAhKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzRmlsdGVyYWJsZSxcbiAgICAgICAgaXNTZWFyY2hhYmxlOiAhKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzU2VhcmNoYWJsZSxcbiAgICB9XG5cbiAgICAvLyBBZGQgaW5mZXJyZWQgb3IgZXhwbGljaXQgZmllbGRUeXBlXG4gICAgaWYgKGluZmVycmVkRmllbGRUeXBlKSB7XG4gICAgICAgIGZvcm1hdHRlZC5maWVsZFR5cGUgPSBpbmZlcnJlZEZpZWxkVHlwZTtcbiAgICB9IGVsc2UgaWYgKCFleHBsaWNpdEZpZWxkVHlwZSAmJiB0eXBlICYmIHR5cGUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIExvZyB3YXJuaW5nIGZvciBub24tc3RyaW5nIHR5cGVzIHdlIGNvdWxkbid0IGluZmVyXG4gICAgICAgIGVudGl0eUF0dHJpYnV0ZUxvZ2dlci53YXJuKGDimqDvuI8gQ291bGQgbm90IGluZmVyIGZpZWxkVHlwZSBmb3IgYXR0cmlidXRlIFwiJHthdHRJZH1cIiB3aXRoIHR5cGUgXCIke3R5cGVvZiB0eXBlID09PSAnb2JqZWN0JyA/IEpTT04uc3RyaW5naWZ5KHR5cGUpIDogdHlwZX1cIi4gQ29uc2lkZXIgYWRkaW5nIGV4cGxpY2l0IGZpZWxkVHlwZS5gKTtcbiAgICB9XG4gICAgXG4gICAgLy8gQWRkIG9wdGlvbnMgYmFjayBpZiB0aGV5IGV4aXN0XG4gICAgaWYgKG9wdGlvbnMpIHtcbiAgICAgICAgZm9ybWF0dGVkLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIH1cblxuICAgIC8vIFBhc3MgdGhyb3VnaCBib3RoIG9sZCBhbmQgbmV3IGFkZE5ld09wdGlvbiBmb3JtYXRzXG4gICAgaWYgKGFkZE5ld09wdGlvbkNvbmZpZykge1xuICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSBhZGROZXdPcHRpb25Db25maWc7XG4gICAgfVxuICAgIGlmIChhZGROZXdPcHRpb24pIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uJyBdID0gYWRkTmV3T3B0aW9uO1xuICAgIH1cblxuICAgIC8vXG4gICAgLy8gKiogbWFrZSBzdXJlIHRvIG5vdCBvdmVycmlkZSB0aGUgaW5uZXIgZmllbGRzIG9mIGF0dHJpYnV0ZXMgbGlrZSBgbGlzdC1baXRlbXNdLVttYXBdLXByb3BlcnRpZXNgICoqXG4gICAgLy9cbiAgICBpZiAodHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAncHJvcGVydGllcycgXSA9IE9iamVjdC5lbnRyaWVzPGFueT4ocHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSk7XG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnbGlzdCcgJiYgaXRlbXMudHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAuLi5pdGVtcyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IE9iamVjdC5lbnRyaWVzPGFueT4oaXRlbXMucHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkXG59XG5cbmV4cG9ydCB0eXBlIFRJT1NjaGVtYUF0dHJpYnV0ZSA9IFJldHVyblR5cGU8dHlwZW9mIGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGU+O1xuZXhwb3J0IHR5cGUgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IE1hcDxrZXlvZiBTWyAnYXR0cmlidXRlcycgXSwgVElPU2NoZW1hQXR0cmlidXRlPjtcblxuLyoqXG4gKiBDcmVhdGVzIGFuIGFjY2VzcyBwYXR0ZXJucyBzY2hlbWEgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGVudGl0eSBzY2hlbWEuXG4gKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgQSBtYXAgb2YgYWNjZXNzIHBhdHRlcm5zLCB3aGVyZSB0aGUga2V5cyBhcmUgdGhlIGluZGV4IG5hbWVzIGFuZCB0aGUgdmFsdWVzIGFyZSBtYXBzIG9mIGF0dHJpYnV0ZSBuYW1lcyBhbmQgdGhlaXIgY29ycmVzcG9uZGluZyBzY2hlbWEgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihzY2hlbWE6IFMpIHtcbiAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG5ldyBNYXA8a2V5b2YgU1sgJ2luZGV4ZXMnIF0sIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4+KCk7XG5cbiAgICBmb3IgKGNvbnN0IGluZGV4TmFtZSBpbiBzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICBjb25zdCBpbmRleEF0dHJpYnV0ZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4gPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhQa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0ucGsuY29tcG9zaXRlKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgaWR4UGtBdHQgXTtcbiAgICAgICAgICAgIGluZGV4QXR0cmlidXRlcy5zZXQoaWR4UGtBdHQsIHtcbiAgICAgICAgICAgICAgICAuLi5lbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGlkeFBrQXR0LCB7IC4uLmF0dCwgcmVxdWlyZWQ6IHRydWUgfSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhTa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0uc2s/LmNvbXBvc2l0ZSA/PyBbXSkge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGlkeFNrQXR0IF07XG4gICAgICAgICAgICBpbmRleEF0dHJpYnV0ZXMuc2V0KGlkeFNrQXR0LCB7XG4gICAgICAgICAgICAgICAgLi4uZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShpZHhTa0F0dCwgeyAuLi5hdHQsIHJlcXVpcmVkOiB0cnVlIH0pXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFjY2Vzc1BhdHRlcm5zLnNldChpbmRleE5hbWUsIGluZGV4QXR0cmlidXRlcyk7XG4gICAgfVxuXG4gICAgLy8gbWFrZSBzdXJlIHRoZXJlJ3MgYSBwcmltYXJ5IGFjY2VzcyBwYXR0ZXJuO1xuICAgIGlmICghYWNjZXNzUGF0dGVybnMuaGFzKCdwcmltYXJ5JykpIHtcbiAgICAgICAgYWNjZXNzUGF0dGVybnMuc2V0KCdwcmltYXJ5JywgYWNjZXNzUGF0dGVybnMudmFsdWVzKCkubmV4dCgpLnZhbHVlISk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFjY2Vzc1BhdHRlcm5zO1xufVxuIl19