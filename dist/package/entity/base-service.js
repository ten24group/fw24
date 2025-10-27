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
function entityAttributeToIOSchemaAttribute(attId, att) {
    const { name, validations, required, relation, default: defaultValue, get: _getter, set: _setter, watch, ...restMeta } = att;
    const { entityName: relatedEntityName, ...restRelation } = relation || {};
    const relationMeta = relatedEntityName ? { ...restRelation, entityName: relatedEntityName } : undefined;
    const { items, type, properties, addNewOption, addNewOptionConfig, ...restRestMeta } = restMeta;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBOEJBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQW9uREQsZ0ZBcURDO0FBVUQsd0VBNkJDO0FBMXdERCw4QkFBb0M7QUFPcEMsd0NBQTBDO0FBQzFDLGlEQUE0RTtBQUU1RSx5REFBbUU7QUFDbkUsb0NBQWlOO0FBQ2pOLCtDQUFzRDtBQUN0RCxpREFBbUs7QUFDbkssdUVBQWtFO0FBQ2xFLHFDQUFnRTtBQUNoRSxtQ0FBNEg7QUFDNUgsc0NBQTZEO0FBWTdELFNBQWdCLFlBQVksQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQ25GLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxTQUFnQixtQkFBbUIsQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQzFGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDbkQsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsS0FBSyxJQUFJLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFDMUYsT0FBTyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssU0FBUyxDQUFDO0FBQzFELENBQUM7QUFFRCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFtQyxFQUFFLElBQTBCO0lBRTlGLElBQUksY0FBYyxHQUFHLFNBQVMsSUFBQSxrQkFBVSxFQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7SUFDMUQsSUFBSSxjQUFjLElBQUksTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2pDLE9BQU8sTUFBTSxDQUFD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RSxHQUFHLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7YUFDOUUsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUVELEtBQUssTUFBTSxRQUFRLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBRSxTQUFTLENBQUUsQ0FBQyxFQUFFLEVBQUUsU0FBUyxJQUFJLEVBQUUsRUFBRSxDQUFDO1lBQ3JFLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUUsUUFBUSxDQUFFLENBQUM7WUFDMUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUU7Z0JBQzFCLEdBQUcsa0NBQWtDLENBQUMsUUFBUSxFQUFFLEVBQUUsR0FBRyxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFDO2FBQzlFLENBQUMsQ0FBQztRQUNQLENBQUM7UUFFRCxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxlQUFlLENBQUMsQ0FBQztJQUNuRCxDQUFDO0lBRUQsOENBQThDO0lBQzlDLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDakMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsY0FBYyxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQU0sQ0FBQyxDQUFDO0lBQ3pFLENBQUM7SUFFRCxPQUFPLGNBQWMsQ0FBQztBQUMxQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tIFwiLi4vZGlcIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5SW5wdXRWYWxpZGF0aW9ucywgRW50aXR5VmFsaWRhdGlvbnMgfSBmcm9tIFwiLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHR5cGUgeyBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEsIEVudGl0eUF0dHJpYnV0ZSwgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYSwgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWEsIEVudGl0eVR5cGVGcm9tU2NoZW1hIGFzIEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYSwgRW50aXR5U2NoZW1hLCBIeWRyYXRlT3B0aW9uRm9yRW50aXR5LCBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24sIEh5ZHJhdGVPcHRpb25zTWFwRm9yRW50aXR5LCBSZWxhdGlvbklkZW50aWZpZXIsIFNwZWNpYWxBdHRyaWJ1dGVUeXBlLCBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSwgVXBzZXJ0RW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hIH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB0eXBlIHsgRW50aXR5RmlsdGVyQ3JpdGVyaWEsIEVudGl0eVF1ZXJ5LCBFbnRpdHlTZWxlY3Rpb25zLCBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyB9IGZyb20gXCIuL3F1ZXJ5LXR5cGVzXCI7XG5cbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IERlcElkZW50aWZpZXIsIElESUNvbnRhaW5lciB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgQmFzZVNlYXJjaFNlcnZpY2UsIEVudGl0eVNlYXJjaFNlcnZpY2UgfSBmcm9tICcuLi9zZWFyY2gvc2VydmljZXMnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoUXVlcnkgfSBmcm9tICcuLi9zZWFyY2gvdHlwZXMnO1xuaW1wb3J0IHsgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaC9zZWFyY2gtdXRpbHMnO1xuaW1wb3J0IHsgSnNvblNlcmlhbGl6ZXIsIGdldFZhbHVlQnlQYXRoLCBpc0FycmF5LCBpc0Jvb2xlYW4sIGlzQ2xhc3NDb25zdHJ1Y3RvciwgaXNFbXB0eSwgaXNFbXB0eU9iamVjdERlZXAsIGlzRnVuY3Rpb24sIGlzT2JqZWN0LCBpc1N0cmluZywgcGFzY2FsQ2FzZSwgcGlja0tleXMsIHRvSHVtYW5SZWFkYWJsZU5hbWUsIHRvU2x1ZyB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgY3JlYXRlRWxlY3Ryb0RCRW50aXR5IH0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IFVwZGF0ZUVudGl0eU9wZXJhdG9ycywgY3JlYXRlRW50aXR5LCBkZWxldGVFbnRpdHksIGdldEJhdGNoRW50aXR5LCBnZXRFbnRpdHksIGxpc3RFbnRpdHksIHF1ZXJ5RW50aXR5LCB1cGRhdGVFbnRpdHksIHVwc2VydEVudGl0eSB9IGZyb20gXCIuL2NydWQtc2VydmljZVwiO1xuaW1wb3J0IHsgRW50aXR5U2NoZW1hVmFsaWRhdG9yIH0gZnJvbSBcIi4vZW50aXR5LXNjaGVtYS12YWxpZGF0b3JcIjtcbmltcG9ydCB7IERhdGFiYXNlRXJyb3IsIEVudGl0eVZhbGlkYXRpb25FcnJvciB9IGZyb20gJy4vZXJyb3JzJztcbmltcG9ydCB7IGFkZEZpbHRlckdyb3VwVG9FbnRpdHlGaWx0ZXJDcml0ZXJpYSwgbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMsIHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMgfSBmcm9tIFwiLi9xdWVyeVwiO1xuaW1wb3J0IHsgSW50ZXJuYWxTZXJ2ZXJFcnJvciwgU2VydmVyRXJyb3IgfSBmcm9tIFwiLi4vZXJyb3JzXCI7XG5cbmV4cG9ydCB0eXBlIEV4dHJhY3RFbnRpdHlJZGVudGlmaWVyc0NvbnRleHQgPSB7XG4gICAgLy8gdGVuYW50SWQ6IHN0cmluZywgXG4gICAgZm9yQWNjZXNzUGF0dGVybj86IHN0cmluZ1xufVxuXG50eXBlIEdldE9wdGlvbnM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSB7XG4gICAgaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PixcbiAgICBhdHRyaWJ1dGVzPzogRW50aXR5U2VsZWN0aW9uczxTPlxufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzQXR0cmlidXRlKHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gKGF0dHJpYnV0ZU5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiwgYXR0cmlidXRlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgYXR0cmlidXRlID0gc2NoZW1hLmF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV07XG4gICAgcmV0dXJuICEhKGF0dHJpYnV0ZSAmJiBhdHRyaWJ1dGUucmVhZE9ubHkgPT09IHRydWUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaGFzQXR0cmlidXRlQnkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIHNwZWM6IFNwZWNpYWxBdHRyaWJ1dGVUeXBlKSB7XG4gICAgcmV0dXJuIGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsIHNwZWMpICE9PSB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIHNwZWM6IFNwZWNpYWxBdHRyaWJ1dGVUeXBlKSB7XG5cbiAgICBsZXQgc3BlY0F0dE1ldGFLZXkgPSBgZW50aXR5JHtwYXNjYWxDYXNlKHNwZWMpfUF0dHJpYnV0ZWA7XG4gICAgaWYgKHNwZWNBdHRNZXRhS2V5IGluIHNjaGVtYS5tb2RlbCkge1xuICAgICAgICByZXR1cm4gc2NoZW1hLm1vZGVsWyBzcGVjQXR0TWV0YUtleSBhcyBrZXlvZiB0eXBlb2Ygc2NoZW1hLm1vZGVsIF0gYXMgc3RyaW5nO1xuICAgIH1cblxuICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCBgJHtzY2hlbWEubW9kZWwuZW50aXR5fSR7cGFzY2FsQ2FzZShzcGVjKX1gKSkge1xuICAgICAgICByZXR1cm4gYCR7c2NoZW1hLm1vZGVsLmVudGl0eX0ke3Bhc2NhbENhc2Uoc3BlYyl9YDtcbiAgICB9XG5cbiAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgc3BlYykpIHtcbiAgICAgICAgcmV0dXJuIHNwZWM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VFbnRpdHlTZXJ2aWNlPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IHtcblxuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihgQmFzZUVudGl0eVNlcnZpY2U6JHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG5cbiAgICBwcm90ZWN0ZWQgZW50aXR5UmVwb3NpdG9yeT86IEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICBwcm90ZWN0ZWQgZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hPzogUmV0dXJuVHlwZTx0eXBlb2YgdGhpcy5tYWtlT3BzRGVmYXVsdElPU2NoZW1hPFM+PjtcblxuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICByZWFkb25seSBzY2hlbWE6IFMsXG4gICAgICAgIHByb3RlY3RlZCByZWFkb25seSBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvbixcbiAgICAgICAgcHJvdGVjdGVkIHJlYWRvbmx5IGRpQ29udGFpbmVyOiBJRElDb250YWluZXIgPSBESUNvbnRhaW5lci5ST09ULFxuICAgICkgeyB9XG5cbiAgICBwcm90ZWN0ZWQgZ2V0VGFibGVOYW1lKCk6IHN0cmluZyB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlDb25maWd1cmF0aW9ucy50YWJsZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEludGVybmFsU2VydmVyRXJyb3IoYFRhYmxlIG5hbWUgaXMgcmVxdWlyZWQgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlDb25maWd1cmF0aW9ucy50YWJsZTtcbiAgICB9XG5cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlTZWFyY2hDb25maWcoX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQ8YW55Pikge1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gc2NoZW1hLm1vZGVsLnNlYXJjaCB8fCB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgaW5kZXhDb25maWc6IHt9XG4gICAgICAgIH07XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLnNlcnZpY2VDbGFzcyA9IHNlYXJjaENvbmZpZy5zZXJ2aWNlQ2xhc3MgfHwgRW50aXR5U2VhcmNoU2VydmljZTtcblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZy5pbmRleENvbmZpZykge1xuICAgICAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuaW5kZXhOYW1lID0gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLmluZGV4TmFtZSB8fCBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHNjaGVtYS5tb2RlbC5lbnRpdHksXG4gICAgICAgICAgICB0YWJsZU5hbWU6IHRoaXMuZ2V0VGFibGVOYW1lKCksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5wcmltYXJ5S2V5ID0gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnByaW1hcnlLZXkgfHwgdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgICAgICBjb25zdCBlbnRpdHlTZWFyY2hhYmxlQXR0cmlidXRlcyA9IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzID0gdGhpcy5nZXRGaWx0ZXJhYmxlQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3MgPSB7XG4gICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzIHx8IHt9KSxcbiAgICAgICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uc2VhcmNoYWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5U2VhcmNoYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uZmlsdGVyYWJsZUF0dHJpYnV0ZXMgfHwgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMpLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHNvcnRhYmxlQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3M/LnNvcnRhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHNlYXJjaENvbmZpZztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgaWYgc2VhcmNoIGlzIGVuYWJsZWQgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVHJ1ZSBpZiBzZWFyY2ggaXMgZW5hYmxlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIHB1YmxpYyBpc1NlYXJjaEVuYWJsZWQoKSB7XG4gICAgICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCk7XG4gICAgICAgIHJldHVybiBCb29sZWFuKHNlYXJjaENvbmZpZz8uZW5hYmxlZCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgc2VhcmNoIHNlcnZpY2UgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIHNlYXJjaCBzZXJ2aWNlLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRTZWFyY2hTZXJ2aWNlKCk6IEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcblxuICAgICAgICAgICAgLy8gU2tpcCBzZWFyY2ggbG9naWMgaWYgc2VhcmNoIGlzIG5vdCBlbmFibGVkXG4gICAgICAgICAgICBpZiAoIXNlYXJjaENvbmZpZz8uZW5hYmxlZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX0uYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIHNlYXJjaCBjb25maWd1cmF0aW9uIGlmIHByZXNlbnRcbiAgICAgICAgICAgIGlmIChzZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlU2VhcmNoQ29uZmlnKHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgPSBzZWFyY2hDb25maWc/LnNlcnZpY2VDbGFzcztcblxuICAgICAgICAgICAgLy8gQ2FzZSAxOiBESSBDb250YWluZXIgaGFzIHRoZSBzZXJ2aWNlXG4gICAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyAmJiB0aGlzLmRpQ29udGFpbmVyLmhhcyhzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzIGFzIERlcElkZW50aWZpZXI8RW50aXR5U2VhcmNoU2VydmljZTxhbnk+PikpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlPEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4+KHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPFM+Pik7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byByZXNvbHZlIHNlYXJjaCBzZXJ2aWNlIGZyb20gY29udGFpbmVyOicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlc29sdmUgc2VhcmNoIHNlcnZpY2UgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhc2UgMjogU2VydmljZSBpbnN0YW5jZSBwcm92aWRlZFxuICAgICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgaW5zdGFuY2VvZiBCYXNlU2VhcmNoU2VydmljZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYXNlIDM6IFNlcnZpY2UgY2xhc3MgcHJvdmlkZWRcbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBpc0NsYXNzQ29uc3RydWN0b3Ioc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcykgJiZcbiAgICAgICAgICAgICAgICAoXG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgPT09IEVudGl0eVNlYXJjaFNlcnZpY2VcbiAgICAgICAgICAgICAgICAgICAgfHxcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBFbnRpdHlTZWFyY2hTZXJ2aWNlXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETzogYWRkIHN1cHBvcnQgdG8gY29uZmlndXJlIHRoaXMgd2l0aG91dCBuZWVkaW5nIHRvIHVzZSB0aGUgRElcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRW5naW5lID0gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlU2VhcmNoRW5naW5lKCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc2VhcmNoRW5naW5lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBlbmdpbmUgbm90IGZvdW5kIGluIGNvbnRhaW5lcicpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgdHlwZW9mIEVudGl0eVNlYXJjaFNlcnZpY2UpKFxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlYXJjaEVuZ2luZSxcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGluc3RhbnRpYXRlIHNlYXJjaCBzZXJ2aWNlOicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBzZWFyY2ggc2VydmljZSBpbnN0YW5jZSBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB2YWxpZCBzZWFyY2gtc2VydmljZS1jb25maWd1cmF0aW9uIGZvdW5kIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3IgaW4gZ2V0U2VhcmNoU2VydmljZTonLCBlcnIpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBpbml0aWFsaXphdGlvbiBmYWlsZWQgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgdmFsaWRhdGVTZWFyY2hDb25maWcoc2VhcmNoQ29uZmlnOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT5bICdtb2RlbCcgXVsgJ3NlYXJjaCcgXSkge1xuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXNlYXJjaENvbmZpZy5pbmRleENvbmZpZykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBtdXN0IGluY2x1ZGUgYSBjb25maWcgb2JqZWN0Jyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGluZGV4Q29uZmlnOiBjb25maWcgfSA9IHNlYXJjaENvbmZpZztcblxuICAgICAgICBpZiAoIWNvbmZpZy5pbmRleE5hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gbXVzdCBzcGVjaWZ5IGFuIGluZGV4TmFtZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgc2VhcmNoYWJsZSBhdHRyaWJ1dGVzIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29uZmlnLnNldHRpbmdzPy5zZWFyY2hhYmxlQXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBjb25maWcuc2V0dGluZ3Muc2VhcmNoYWJsZUF0dHJpYnV0ZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIChhdHRyOiBzdHJpbmcpID0+ICFoYXNBdHRyaWJ1dGUodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgYXR0cilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzZWFyY2hhYmxlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbGlkYXRlIGZpbHRlcmFibGUgYXR0cmlidXRlcyBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbmZpZy5zZXR0aW5ncz8uZmlsdGVyYWJsZUF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gY29uZmlnLnNldHRpbmdzLmZpbHRlcmFibGVBdHRyaWJ1dGVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICAoYXR0cjogc3RyaW5nKSA9PiAhaGFzQXR0cmlidXRlKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIGF0dHIpXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzOiAke2ludmFsaWRBdHRyaWJ1dGVzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgdHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHk6IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+KTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHNlYXJjaFNlcnZpY2UudHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHkpO1xuICAgIH1cblxuICAgIHB1YmxpYyB2YWxpZGF0ZUVudGl0eVNjaGVtYSgpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IEVudGl0eVNjaGVtYVZhbGlkYXRvcih0aGlzLmRpQ29udGFpbmVyKTtcbiAgICAgICAgdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKFxuICAgICAgICAgICAgdGhpcy5nZXRFbnRpdHlTY2hlbWEoKSxcbiAgICAgICAgICAgIHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBnZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNlcnZpY2U8QmFzZUVudGl0eVNlcnZpY2U8VD4+KHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2VydmljZShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgZ2V0RW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lPFQgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNjaGVtYTxUPihyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgaGFzRW50aXR5U2NoZW1hQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2NoZW1hKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFeHRyYWN0cyBlbnRpdHkgaWRlbnRpZmllcnMgZnJvbSB0aGUgaW5wdXQgb2JqZWN0IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBjb250ZXh0IHRvIGZ1bGZpbGwgYW4gaW5kZXguXG4gICAgICogZS5nLiBlbnRpdHlJZCwgdGVuYW50SWQsIHBhcnRpdGlvbi1rZXlzLi4uLiBldGNcbiAgICAgKiBpdCBpcyB1c2VkIGJ5IHRoZSBgQmFzZUVudGl0eVNlcnZpY2VgIHRvIGZpbmQgdGhlIHJpZ2h0IGVudGl0eSBmb3IgYGdldGAvYHVwZGF0ZWAvYGRlbGV0ZWAgb3BlcmF0aW9uc1xuICAgICAqIFxuICAgICAqIEB0ZW1wbGF0ZSBTIC0gVGhlIHR5cGUgb2YgdGhlIGVudGl0eSBzY2hlbWEuXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGlucHV0IG9iamVjdCBmcm9tIHdoaWNoIHRvIGV4dHJhY3QgdGhlIGlkZW50aWZpZXJzLlxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGNvbnRhaW5pbmcgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiBmb3IgZXh0cmFjdGlvbi5cbiAgICAgKiBAcGFyYW0gY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuIC0gVGhlIGFjY2VzcyBwYXR0ZXJuIGZvciB3aGljaCB0byBleHRyYWN0IHRoZSBpZGVudGlmaWVycy5cbiAgICAgKiBAcmV0dXJucyBUaGUgZXh0cmFjdGVkIGVudGl0eSBpZGVudGlmaWVycy5cbiAgICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGlucHV0IGlzIG1pc3Npbmcgb3Igbm90IGFuIG9iamVjdC5cbiAgICAgKiBcbiAgICAgKiBlLmcuIFxuICAgICAqIElOICAgPT0+IGBSZXF1ZXN0YCBvYmplY3Qgd2l0aCBoZWFkZXJzLCBib2R5LCBhdXRoLWNvbnRleHQgZXRjXG4gICAgICogT1VUICA9PT4geyB0ZW5hbnRJZDogeHh4LCBlbWFpbDogeHh4QHl5eS5jb20sIHNvbWUtcGFydGl0aW9uLWtleTogeHgteXktenogfVxuICAgICAqXG4gICAgICovXG4gICAgZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKFxuICAgICAgICBpbnB1dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIHN0cmluZz4+LFxuICAgICAgICBjb250ZXh0OiBFeHRyYWN0RW50aXR5SWRlbnRpZmllcnNDb250ZXh0ID0ge1xuICAgICAgICAgICAgLy8gdGVuYW50SWQ6ICd4eHgteXl5LXp6eidcbiAgICAgICAgfVxuICAgICk6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiB7XG5cbiAgICAgICAgaWYgKCFpbnB1dCB8fCB0eXBlb2YgaW5wdXQgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lucHV0IGlzIHJlcXVpcmVkIGFuZCBtdXN0IGJlIGFuIG9iamVjdCBjb250YWluaW5nIGVudGl0eS1pZGVudGlmaWVycyBvciBhbiBhcnJheSBvZiBvYmplY3RzIGNvbnRhaW5pbmcgZW50aXR5LWlkZW50aWZpZXJzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpc0JhdGNoSW5wdXQgPSBpc0FycmF5KGlucHV0KTtcblxuICAgICAgICBjb25zdCBpbnB1dHMgPSBpc0JhdGNoSW5wdXQgPyBpbnB1dCA6IFsgaW5wdXQgXTtcblxuICAgICAgICAvLyBUT0RPOiB0ZW5hbnQgbG9naWNcbiAgICAgICAgLy8gaWRlbnRpZmllcnNbJ3RlbmFudElkJ10gPSBpbnB1dC50ZW5hbnRJZCB8fCBjb250ZXh0LnRlbmFudElkO1xuXG4gICAgICAgIGNvbnN0IGFjY2Vzc1BhdHRlcm5zID0gbWFrZUVudGl0eUFjY2Vzc1BhdHRlcm5zU2NoZW1hKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJBdHRyaWJ1dGVzID0gbmV3IFNldDx7IG5hbWU6IHN0cmluZywgcmVxdWlyZWQ6IGJvb2xlYW4gfT4oKTtcbiAgICAgICAgZm9yIChjb25zdCBbIGFjY2Vzc1BhdHRlcm5OYW1lLCBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcyBdIG9mIGFjY2Vzc1BhdHRlcm5zKSB7XG4gICAgICAgICAgICBpZiAoIWNvbnRleHQuZm9yQWNjZXNzUGF0dGVybiB8fCBhY2Nlc3NQYXR0ZXJuTmFtZSA9PSBjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4pIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBhdHQgXSBvZiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyQXR0cmlidXRlcy5hZGQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYXR0LmlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxdWlyZWQ6IGF0dC5yZXF1aXJlZCA9PSB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByaW1hcnlBdHROYW1lID0gdGhpcy5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgICAgICBjb25zdCBpZGVudGlmaWVyc0JhdGNoID0gaW5wdXRzLm1hcChpbnB1dCA9PiB7XG4gICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogYW55ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZTogYXR0TmFtZSwgcmVxdWlyZWQgfSBvZiBpZGVudGlmaWVyQXR0cmlidXRlcykge1xuICAgICAgICAgICAgICAgIGlmICgoYXR0TmFtZSBpbiBpbnB1dCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllcnNbIGF0dE5hbWUgXSA9IGlucHV0WyBhdHROYW1lIF07XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChhdHROYW1lID09IHByaW1hcnlBdHROYW1lICYmICgnaWQnIGluIGlucHV0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyc1sgYXR0TmFtZSBdID0gaW5wdXQuaWQ7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXF1aXJlZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGByZXF1aXJlZCBhdHRyaWJ1dGU6ICR7YXR0TmFtZX0gZm9yIGFjY2Vzcy1wYXR0ZXJuOiAke2NvbnRleHQuZm9yQWNjZXNzUGF0dGVybiA/PyAnLS1wcmltYXJ5LS0nfSBpcyBub3QgZm91bmQgaW4gaW5wdXQ6YCwgaW5wdXQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpZGVudGlmaWVycyBhcyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+O1xuICAgICAgICB9XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0V4dHJhY3RpbmcgaWRlbnRpZmllcnMgZnJvbSBpZGVudGlmaWVyczonLCBpZGVudGlmaWVyc0JhdGNoKTtcblxuICAgICAgICByZXR1cm4gaXNCYXRjaElucHV0ID8gaWRlbnRpZmllcnNCYXRjaCA6IGlkZW50aWZpZXJzQmF0Y2hbIDAgXTtcbiAgICB9O1xuXG4gICAgcHVibGljIGdldEVudGl0eU5hbWUoKTogU1sgJ21vZGVsJyBdWyAnZW50aXR5JyBdIHsgcmV0dXJuIHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkubW9kZWwuZW50aXR5OyB9XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5U2NoZW1hKCk6IFMgeyByZXR1cm4gdGhpcy5zY2hlbWE7IH1cblxuICAgIHB1YmxpYyBnZXRSZXBvc2l0b3J5KCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5UmVwb3NpdG9yeSkge1xuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHkgfSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgICAgICAgICAgICAgc2NoZW1hOiB0aGlzLmdldEVudGl0eVNjaGVtYSgpLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5UmVwb3NpdG9yeSA9IGVudGl0eSBhcyBFbnRpdHlSZXBvc2l0b3J5VHlwZUZyb21TY2hlbWE8Uz47XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlSZXBvc2l0b3J5ITtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGVudGl0eSB2YWxpZGF0aW9uczsgb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIHlvdXIgb3duIHZhbGlkYXRpb25zXG4gICAgICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGVudGl0eSB2YWxpZGF0aW9ucy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RW50aXR5VmFsaWRhdGlvbnMoKTogRW50aXR5VmFsaWRhdGlvbnM8Uz4gfCBFbnRpdHlJbnB1dFZhbGlkYXRpb25zPFM+IHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBQbGFjZWhvbGRlciBmb3IgdGhlIGN1c3RvbSB2YWxpZGF0aW9uLWVycm9yLW1lc3NhZ2VzOyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgeW91ciBvd24gZXJyb3ItbWVzc2FnZXMuXG4gICAgICogQHJldHVybnMgQSBtYXAgY29udGFpbmluZyB0aGUgY3VzdG9tIHZhbGlkYXRpb24tZXJyb3ItbWVzc2FnZXMuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0c1xuICAgICAqICBwdWJsaWMgYXN5bmMgZ2V0T3ZlcnJpZGRlbkVudGl0eVZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgICAqICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSggbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oIFxuICAgICAqICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHsgXG4gICAgICogICAgICAgICAgICAgICd2YWxpZGF0aW9uLmVtYWlsLnJlcXVpcmVkJzogJ0VtYWlsIGlzIHJlcXVpcmVkISEhISEnLCBcbiAgICAgKiAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24ucGFzc3dvcmQucmVxdWlyZWQnOiAnUGFzc3dvcmQgaXMgcmVxdWlyZWQhISEhISdcbiAgICAgKiAgICAgICAgICB9KVxuICAgICAqICAgICAgKSk7XG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBnZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSk7XG4gICAgfVxuXG4gICAgcHVibGljIGdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpIHtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBpZiAoYXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhdHROYW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvKipcbiAqIEdlbmVyYXRlcyB0aGUgZGVmYXVsdCBpbnB1dCBhbmQgb3V0cHV0IHNjaGVtYXMgZm9yIHZhcmlvdXMgb3BlcmF0aW9ucyBvZiBhbiBlbnRpdHkuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBTIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBPcHMgLSBUaGUgdHlwZSBvZiBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgVGhlIGRlZmF1bHQgaW5wdXQgYW5kIG91dHB1dCBzY2hlbWFzIGZvciB0aGUgZW50aXR5IG9wZXJhdGlvbnMuXG4gKi9cbiAgICBwcm90ZWN0ZWQgbWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxcbiAgICAgICAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55LCBPcHM+LFxuICAgICAgICBPcHMgZXh0ZW5kcyBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgPSBURGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgPihzY2hlbWE6IFMpIHtcblxuICAgICAgICBjb25zdCBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICAgICBjcmVhdGU6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICAgICAgdXBkYXRlOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzID0ge1xuICAgICAgICAgICAgZGV0YWlsOiBuZXcgTWFwKCkgYXMgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICAgICAgICAgIGxpc3Q6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIGNyZWF0ZSBhbmQgdXBkYXRlXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuXG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkQXR0ID0gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShhdHROYW1lLCBhdHQpO1xuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmhpZGRlbikge1xuICAgICAgICAgICAgICAgIC8vIGlmIGl0J3MgbWFya2VkIGFzIGhpZGRlbiBpdCdzIG5vdCB2aXNpYmxlIHRvIGFueSBvcFxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzVmlzaWJsZSB8fCBmb3JtYXR0ZWRBdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzTGlzdGFibGUgfHwgZm9ybWF0dGVkQXR0LmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMubGlzdC5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNDcmVhdGFibGUpIHtcbiAgICAgICAgICAgICAgICBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLnNldChhdHROYW1lLCB7IC4uLmZvcm1hdHRlZEF0dCB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGZvcm1hdHRlZEF0dC5pc0VkaXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLnVwZGF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYShzY2hlbWEpO1xuXG4gICAgICAgIC8vIGlmIHRoZXJlJ3MgYW4gaW5kZXggbmFtZWQgYHByaW1hcnlgLCB1c2UgdGhhdCwgZWxzZSBmYWxsYmFjayB0byBmaXJzdCBpbmRleFxuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgICAvLyBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZGVsZXRlJ10gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKSA/PyBhY2Nlc3NQYXR0ZXJucy5lbnRyaWVzKCkubmV4dCgpLnZhbHVlO1xuXG5cbiAgICAgICAgLy8gZm9yKGNvbnN0IGFwIG9mIGFjY2Vzc1BhdHRlcm5zLmtleXMoKSl7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGdldF8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gXHRhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1tgZGVsZXRlXyR7YXB9YF0gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoYXApO1xuICAgICAgICAvLyB9XG5cbiAgICAgICAgLy8gY29uc3QgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzOiBhbnkgPSB7fTtcdFxuICAgICAgICAvLyBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddID0ge1xuICAgICAgICAvLyBcdCdpZGVudGlmaWVycyc6IGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzWydnZXQnXSxcbiAgICAgICAgLy8gXHQnZGF0YSc6IGlucHV0U2NoZW1hQXR0cmlidXRlc1snY3JlYXRlJ10sXG4gICAgICAgIC8vIH1cbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ3VwZGF0ZSddLFxuICAgICAgICAvLyB9XG5cbiAgICAgICAgY29uc3QgZGVmYXVsdEFjY2Vzc1BhdHRlcm4gPSBhY2Nlc3NQYXR0ZXJucy5nZXQoJ3ByaW1hcnknKTtcblxuICAgICAgICAvLyBUT0RPOiBhZGQgc2NoZW1hIGZvciB0aGUgcmVzdCBmbyB0aGUgc2Vjb25kYXJ5IGFjY2Vzcy1wYXR0ZXJuc1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBnZXQ6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCwgLy8gZGVmYXVsdCBmb3IgdGhlIGRldGFpbCBwYWdlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZHVwbGljYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlbGV0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVyblxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNyZWF0ZToge1xuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMuY3JlYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB1cGRhdGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm4sXG4gICAgICAgICAgICAgICAgaW5wdXQ6IGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUsXG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmRldGFpbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsaXN0OiB7XG4gICAgICAgICAgICAgICAgb3V0cHV0OiBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3QsXG4gICAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBpbnB1dC9vdXRwdXQgc2NoZW1hIGZvciBlbnRpdHkgb3BlcmF0aW9ucy5cbiAgICAgKiBcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRPcHNEZWZhdWx0SU9TY2hlbWEoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWEpIHtcbiAgICAgICAgICAgIHRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hID0gdGhpcy5tYWtlT3BzRGVmYXVsdElPU2NoZW1hPFM+KHRoaXMuZ2V0RW50aXR5U2NoZW1hKCkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuIFVzZWQgYnkgdGhlIGBkZXRhaWxgIEFQSSB0byBzZXJpYWxpemUgdGhlIGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gQW4gYXJyYXkgb2YgZGVmYXVsdCBzZXJpYWxpemF0aW9uIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmdldC5vdXRwdXQ7XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlczogYW55ID0ge307XG4gICAgICAgIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmZvckVhY2goKF8sIGtleSkgPT4ge1xuICAgICAgICAgICAgLy8gaWYgKCF2YWwucmVsYXRpb24gfHwgdmFsLnJlbGF0aW9uLmh5ZHJhdGUpIHtcbiAgICAgICAgICAgIC8vIH1cbiAgICAgICAgICAgIGF0dHJpYnV0ZXNbIGtleSBdID0gdHJ1ZVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcyBhcyBFbnRpdHlTZWxlY3Rpb25zPFM+O1xuXG4gICAgICAgIC8vICByZXR1cm4gQXJyYXkuZnJvbSggZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAua2V5cygpICkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGF0dHJpYnV0ZSBuYW1lcyBmb3IgbGlzdGluZyBhbmQgc2VhcmNoIEFQSS4gRGVmYXVsdHMgdG8gdGhlIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCk6IEVudGl0eVNlbGVjdGlvbnM8Uz4ge1xuICAgICAgICBjb25zdCBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcCA9IHRoaXMuZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkubGlzdC5vdXRwdXQ7XG4gICAgICAgIHJldHVybiBBcnJheS5mcm9tKGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSkgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaC4gRGVmYXVsdHMgdG8gYWxsIHN0cmluZyBhdHRyaWJ1dGVzIHdoaWNoIGFyZSBub3QgaGlkZGVuIGFuZCBhcmUgbm90IGlkZW50aWZpZXJzLlxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2hcbiAgICAqL1xuICAgIHB1YmxpYyBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTogQXJyYXk8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gW107XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgYXR0TmFtZSBdO1xuICAgICAgICAgICAgaWYgKCFhdHQuaGlkZGVuICYmICFhdHQuaXNJZGVudGlmaWVyICYmIGF0dC50eXBlID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICAgICYmXG4gICAgICAgICAgICAgICAgKCEoJ2lzU2VhcmNoYWJsZScgaW4gYXR0KSB8fCBhdHQuaXNTZWFyY2hhYmxlKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZXMucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lcztcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIHVuaXF1ZSBhdHRyaWJ1dGVzIG9mIHRoZSBlbnRpdHkuIFxuICAgICAqIERlZmF1bHRzIHRvIGFsbCBhdHRyaWJ1dGVzIHdoaWNoIGFyZSBtYXJrZWQgYXMgdW5pcXVlIG9yIGFyZSBpZGVudGlmaWVyczsgXG4gICAgICogT3IgaWYgdGhleSBhcmUgcGFydCBvZiBhIGNvbXBvc2l0ZSBwcmltYXJ5IGtleSB3aGVyZSB0aGUgY29tcG9zaXRlIGxlbmd0aCBpcyAxLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIHtBcnJheTxFbnRpdHlBdHRyaWJ1dGU+fSB1bmlxdWUgYXR0cmlidXRlcyBvZiB0aGUgZW50aXR5XG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0VW5pcXVlQXR0cmlidXRlcygpOiBBcnJheTxFbnRpdHlBdHRyaWJ1dGU+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcblxuICAgICAgICAgICAgbGV0IGlzVW5pcXVlID0gKCdpc1VuaXF1ZScgaW4gYXR0KSA/IGF0dC5pc1VuaXF1ZSA6IGF0dC5pc0lkZW50aWZpZXI7XG5cbiAgICAgICAgICAgIGlmIChpc1VuaXF1ZSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIC4uLmF0dCxcbiAgICAgICAgICAgICAgICAgICAgaXNVbmlxdWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGF0dE5hbWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZSBuYW1lcyB0aGF0IGNhbiBiZSB1c2VkIGZvciBmaWx0ZXJpbmcgdGhlIHJlY29yZHMuIERlZmF1bHRzIHRvIGFsbCBzdHJpbmcgYXR0cmlidXRlcyB3aGljaCBhcmUgbm90IGhpZGRlbi5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gYXR0cmlidXRlIG5hbWVzIHRvIGJlIHVzZWQgZm9yIGtleXdvcmQgc2VhcmNoXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0RmlsdGVyYWJsZUF0dHJpYnV0ZU5hbWVzKCk6IEFycmF5PHN0cmluZz4ge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAhYXR0LmhpZGRlbiAmJiBbICdzdHJpbmcnLCAnbnVtYmVyJyBdLmluY2x1ZGVzKGF0dC50eXBlIGFzIHN0cmluZylcbiAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICghKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgfHwgYXR0LmlzRmlsdGVyYWJsZSlcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWVzLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlTmFtZXM7XG4gICAgfVxuXG4gICAgcHVibGljIHNlcmlhbGl6ZVJlY29yZDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4ocmVjb3JkOiBULCBhdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKCkpOiBQYXJ0aWFsPFQ+IHtcblxuICAgICAgICBsZXQga2V5czogQXJyYXk8c3RyaW5nPjtcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhhdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhwYXJzZWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAga2V5cyA9IE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHBpY2tLZXlzPFQ+KHJlY29yZCwgLi4ua2V5cyk7XG4gICAgfVxuXG4gICAgcHVibGljIHNlcmlhbGl6ZVJlY29yZHM8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KHJlY29yZDogQXJyYXk8VD4gfCBudWxsLCBhdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKCkpOiBBcnJheTxQYXJ0aWFsPFQ+PiB7XG4gICAgICAgIGlmICghcmVjb3JkIHx8ICFBcnJheS5pc0FycmF5KHJlY29yZCkpIHtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVjb3JkLm1hcChyZWNvcmQgPT4gdGhpcy5zZXJpYWxpemVSZWNvcmQ8VD4ocmVjb3JkLCBhdHRyaWJ1dGVzKSk7XG4gICAgfVxuXG4gICAgYXN5bmMgaHlkcmF0ZVJlY29yZHMoXG4gICAgICAgIHJlbGF0aW9uczogQXJyYXk8WyByZWxhdGVkQXR0cmlidXRlTmFtZTogc3RyaW5nLCBvcHRpb25zOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248YW55PiBdPixcbiAgICAgICAgcm9vdEVudGl0eVJlY29yZHM6IEFycmF5PHsgWyB4OiBzdHJpbmcgXTogYW55OyB9PlxuICAgICkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlUmVjb3JkcycgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocmVsYXRpb25zPy5tYXAoYXN5bmMgKFsgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlU2luZ2xlUmVsYXRpb24ocm9vdEVudGl0eVJlY29yZHMsIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLCBvcHRpb25zKTtcbiAgICAgICAgfSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZVNpbmdsZVJlbGF0aW9uKHJvb3RFbnRpdHlSZWNvcmRzOiBhbnlbXSwgcmVsYXRlZEF0dHJpYnV0ZU5hbWU6IHN0cmluZywgb3B0aW9uczogSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uPGFueT4pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZVNpbmdsZVJlbGF0aW9uJyByZWxhdGlvbjogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBvcHRpb25zXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUsIHJlbGF0aW9uVHlwZSwgaWRlbnRpZmllcnMgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgaWYgKCFpZGVudGlmaWVycykge1xuICAgICAgICAgICAgdGhyb3cgKGBObyBJZGVudGlmaWVyczpbJHtyZWxhdGlvblR5cGV9OiR7cmVsYXRlZEVudGl0eU5hbWV9XSBwcm92aWRlZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZSA9PSAnb25lLXRvLW9uZScgfHwgcmVsYXRpb25UeXBlID09ICdtYW55LXRvLW1hbnknKSB7XG4gICAgICAgICAgICB0aHJvdyAoYFJlbGF0aW9uVHlwZTpbJHtyZWxhdGlvblR5cGV9OiR7cmVsYXRlZEVudGl0eU5hbWV9XSBpbiBub3Qgc3VwcG9ydGVkIGJ5IGh5ZHJhdGlvbiwgdXNlIG9uZSBvZiBbbWFueS10by1vbmUsIG9uZS10by1tYW55XSBvdCBtYW51YWxseSBoeWRyYXRlJ2ApXG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZVxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShyZWxhdGVkRW50aXR5TmFtZSk7XG4gICAgICAgIGlmICghcmVsYXRlZEVudGl0eVNlcnZpY2UpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc2VydmljZSBmb3VuZCBmb3IgcmVsYXRpb25zaGlwOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfSgke3JlbGF0ZWRFbnRpdHlOYW1lfSk7IHBsZWFzZSBtYWtlIHN1cmUgc2VydmljZSBoYXMgYmVlbiByZWdpc3RlcmVkIGluIHRoZSByZXF1aXJlZCAnZGktY29udGFpbmVyJ2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0aW9uJ3MgbWV0YWRhdGFcbiAgICAgICAgY29uc3QgY3VycmVudEVudGl0eVNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEgPSBjdXJyZW50RW50aXR5U2NoZW1hLmF0dHJpYnV0ZXNbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lIGFzIGFueSBdIGFzIEVudGl0eUF0dHJpYnV0ZTtcblxuICAgICAgICBpZiAoIXJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEgfHwgIXJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGE/LnJlbGF0aW9uKSB7XG4gICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gYE5vIG1ldGFkYXRhIGZvdW5kIGZvciByZWxhdGlvbnNoaXA6ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9YFxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihtZXNzYWdlLCByZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhKTtcbiAgICAgICAgICAgIHRocm93IChtZXNzYWdlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlbGF0aW9uIGlkZW50aWZpZXJzIG1hcHBpbmdcbiAgICAgICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdID0gQXJyYXkuaXNBcnJheShpZGVudGlmaWVycykgPyBpZGVudGlmaWVycyA6IFsgaWRlbnRpZmllcnMhIF07XG5cbiAgICAgICAgLy8gRGVjaWRlIGxvZ2ljIGJhc2VkIG9uIHJlbGF0aW9uVHlwZVxuICAgICAgICBpZiAocmVsYXRpb25UeXBlID09PSAnbWFueS10by1vbmUnKSB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIE1BTlktVE8tT05FOlxuICAgICAgICAgICAgICogLS0tLS0tLS0tLS0tLVxuICAgICAgICAgICAgICogVGhlIFwicm9vdEVudGl0eVJlY29yZHNcIiBhcmUgdGhlIENISUxEIGl0ZW1zLCBlYWNoIHN0b3JpbmcgdGhlIHBhcmVudCdzXG4gICAgICAgICAgICAgKiBjb21wb3NpdGUga2V5IGluIHNvbWUgZmllbGRzLiBXZSBnYXRoZXIgYWxsIHRob3NlIHBhcmVudCBrZXlzLCBkbyBhIGJhdGNoXG4gICAgICAgICAgICAgKiByZXRyaWV2YWwgZnJvbSB0aGUgcGFyZW50IGVudGl0eSwgdGhlbiBhdHRhY2ggdGhlIHNpbmdsZSBtYXRjaGluZyBwYXJlbnRcbiAgICAgICAgICAgICAqIHJlY29yZCBpbnRvIGNoaWxkUmVjb3JkW3JlbGF0ZWRBdHRyaWJ1dGVOYW1lXS5cbiAgICAgICAgICAgICovXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVNYW55VG9PbmUoXG4gICAgICAgICAgICAgICAgcm9vdEVudGl0eVJlY29yZHMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUgPT09ICdvbmUtdG8tbWFueScpIHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogT05FLVRPLU1BTlk6XG4gICAgICAgICAgICAgKiAtLS0tLS0tLS0tLS0tXG4gICAgICAgICAgICAgKiBUaGUgXCJyb290RW50aXR5UmVjb3Jkc1wiIGFyZSB0aGUgUEFSRU5UIGl0ZW1zLiBFYWNoIHBhcmVudCBjYW4gaGF2ZSBtdWx0aXBsZVxuICAgICAgICAgICAgICogY2hpbGQgaXRlbXMuIFRoZSBjaGlsZCB0YWJsZSByZWNvcmRzIGVhY2ggc3RvcmUgdGhlIHBhcmVudCdzIGtleS4gXG4gICAgICAgICAgICAgKiBTbyB3ZSBkbyBhIHF1ZXJ5IHBlciBwYXJlbnQgYW5kIHRoZW4gLlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVPbmVUb01hbnkoXG4gICAgICAgICAgICAgICAgcm9vdEVudGl0eVJlY29yZHMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZU1hbnlUb09uZShcbiAgICAgICAgY2hpbGRSZWNvcmRzOiBhbnlbXSxcbiAgICAgICAgcGFyZW50QXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10sXG4gICAgICAgIHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGU6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8YW55PiB8IHVuZGVmaW5lZCxcbiAgICAgICAgcGFyZW50U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuICAgICkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlTWFueVRvT25lJyByZWxhdGlvbjogJHtwYXJlbnRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIGZvciBlYWNoIHBhcmVudCBjcmVhdGUgYSBjaGlsZHJlbiBiYXRjaFxuICAgICAgICBjb25zdCBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZFJlY29yZHMpIHtcbiAgICAgICAgICAgIGlmICghY2hpbGQpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBhIHBhcmVudCBrZXkgb2JqZWN0LiBFLmcuIHsgb3JnSWQ6IGNoaWxkLm9yZ0lkLCB1c2VySWQ6IGNoaWxkLnVzZXJJZCB9IGZvciAyLWF0dHIgUEtcbiAgICAgICAgICAgIGNvbnN0IHBhcmVudEtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHNvdXJjZSwgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB2YWwgPSBnZXRWYWx1ZUJ5UGF0aChjaGlsZCwgc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbCA9PSBudWxsKSBjb250aW51ZTtcblxuICAgICAgICAgICAgICAgICAgICBwYXJlbnRLZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHZhbDtcblxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBnZXR0aW5nIHZhbHVlIGZvciBwYXRoOiAke3NvdXJjZX1gLCB7IGVycm9yIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSWYgcGFydGlhbCBvciBlbXB0eSwgc2tpcFxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKHBhcmVudEtleU9iaikubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgY2hpbGRbIHBhcmVudEF0dHJpYnV0ZU5hbWUgXSA9IG51bGw7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IEpTT04uc3RyaW5naWZ5KHBhcmVudEtleU9iaik7XG4gICAgICAgICAgICBpZiAoIXBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5oYXMoa2V5U3RyKSkge1xuICAgICAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5zZXQoa2V5U3RyLCBbXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuZ2V0KGtleVN0cikhLnB1c2goY2hpbGQpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5zaXplID09PSAwKSByZXR1cm47XG5cbiAgICAgICAgLy8gQ3JlYXRlIGEgcGFyZW50LWlkZW50aWZpZXJzLWJhdGNoIGZvciBmZXRjaGluZ1xuICAgICAgICBjb25zdCBwYXJlbnRJZGVudGlmaWVyc0JhdGNoOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGsgb2YgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmtleXMoKSkge1xuICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNCYXRjaC5wdXNoKEpTT04ucGFyc2UoaykpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZmV0Y2hlZFBhcmVudHMgPSBhd2FpdCBwYXJlbnRTZXJ2aWNlLmdldCh7XG4gICAgICAgICAgICBpZGVudGlmaWVyczogcGFyZW50SWRlbnRpZmllcnNCYXRjaCxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHBhcmVudEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIFwiZ2V0KClcIiByZXR1cm5zIGEgc2luZ2xlIGl0ZW0gY29udmVydCBpdCBpbnRvIGFuIGFycmF5LlxuICAgICAgICBjb25zdCBwYXJlbnRzQXJyYXkgPSBBcnJheS5pc0FycmF5KGZldGNoZWRQYXJlbnRzKSA/IGZldGNoZWRQYXJlbnRzIDogWyBmZXRjaGVkUGFyZW50cyBdO1xuXG4gICAgICAgIC8vIE1ha2UgYSBkaWN0aW9uYXJ5IGZyb20geyA8a2V5U3RyPiA9PiBwYXJlbnRSZWNvcmQgfVxuICAgICAgICBjb25zdCBwYXJlbnREaWN0ID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKTtcbiAgICAgICAgZm9yIChjb25zdCBwIG9mIHBhcmVudHNBcnJheSkge1xuICAgICAgICAgICAgaWYgKCFwKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBSZWJ1aWxkIHRoZSBcImNvbXBvc2l0ZSBrZXlcIiBmcm9tIHRoZSBwYXJlbnQncyByZWNvcmRcbiAgICAgICAgICAgIGNvbnN0IGtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuICAgICAgICAgICAgICAgIGlmIChwWyB0YXJnZXQgXSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHNvbWUgYXR0cmlidXRlIGlzIG1pc3NpbmcsIHNraXBcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gcFsgdGFyZ2V0IF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBrU3RyID0gSlNPTi5zdHJpbmdpZnkoa2V5T2JqKTtcbiAgICAgICAgICAgIHBhcmVudERpY3Quc2V0KGtTdHIsIHApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXR0YWNoIGVhY2ggcGFyZW50J3MgZGF0YSB0byB0aGUgY2hpbGRcbiAgICAgICAgZm9yIChjb25zdCBbIGtTdHIsIGNoaWxkcmVuIF0gb2YgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgZm91bmRQYXJlbnQgPSBwYXJlbnREaWN0LmdldChrU3RyKSA/PyBudWxsO1xuICAgICAgICAgICAgZm9yIChjb25zdCBjIG9mIGNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY1sgcGFyZW50QXR0cmlidXRlTmFtZSBdID0gZm91bmRQYXJlbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVPbmVUb01hbnkoXG4gICAgICAgIHBhcmVudFJlY29yZHM6IGFueVtdLFxuICAgICAgICBjaGlsZEF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdLFxuICAgICAgICBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGU6IEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHk8YW55PiB8IHVuZGVmaW5lZCxcbiAgICAgICAgY2hpbGRTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4gICAgKSB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZU9uZVRvTWFueScgcmVsYXRpb246ICR7Y2hpbGRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcGFyZW50S2V5U3RyVG9QYXJlbnRzID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGFyZW50IG9mIHBhcmVudFJlY29yZHMpIHtcbiAgICAgICAgICAgIGlmICghcGFyZW50KSBjb250aW51ZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBcImNoaWxkIGluZGV4XCIga2V5IGZyb20gdGhlIHBhcmVudCdzIGZpZWxkcy4gRm9yIGV4YW1wbGUsIFxuICAgICAgICAgICAgLy8gaWYgdGhlIGNoaWxkIEdTSSBoYXMgeyBwazogJ3RlbmFudElkJywgc2s6ICdhY2NvdW50SWQnIH0sIFxuICAgICAgICAgICAgLy8gd2UgZmlsbCB7IHRlbmFudElkOiBwYXJlbnQudGVuYW50SWQsIGFjY291bnRJZDogcGFyZW50LmFjY291bnRJZCB9LlxuICAgICAgICAgICAgY29uc3QgY2hpbGRLZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBzb3VyY2UsIHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuICAgICAgICAgICAgICAgIGlmIChwYXJlbnRbIHNvdXJjZSBdICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRLZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHBhcmVudFsgc291cmNlIF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiB3ZSBoYXZlIG5vIHZhbGlkIGNvbXBvc2l0ZSBrZXksIG5vIGNoaWxkcmVuIGNhbiBiZSBmZXRjaGVkXG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMoY2hpbGRLZXlPYmopLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHBhcmVudFsgY2hpbGRBdHRyaWJ1dGVOYW1lIF0gPSBbXTtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gSlNPTi5zdHJpbmdpZnkoY2hpbGRLZXlPYmopO1xuICAgICAgICAgICAgaWYgKCFwYXJlbnRLZXlTdHJUb1BhcmVudHMuaGFzKGtleVN0cikpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRLZXlTdHJUb1BhcmVudHMuc2V0KGtleVN0ciwgW10pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmdldChrZXlTdHIpIS5wdXNoKHBhcmVudCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiBubyBwYXJlbnQgaGFzIGEgdmFsaWQga2V5LCB3ZSdyZSBkb25lXG4gICAgICAgIGlmIChwYXJlbnRLZXlTdHJUb1BhcmVudHMuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRm9yIGVhY2ggdW5pcXVlIHBhcmVudEtleU9iaiwgZG8gYSBjaGlsZFNlcnZpY2UgcXVlcnkvbGlzdCBpbiBwYXJhbGxlbC5cbiAgICAgICAgY29uc3QgcHJvbWlzZXM6IEFycmF5PFByb21pc2U8YW55Pj4gPSBbXTtcbiAgICAgICAgY29uc3QgcGFyZW50S2V5czogc3RyaW5nW10gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsga2V5U3RyIF0gb2YgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmVudHJpZXMoKSkge1xuXG4gICAgICAgICAgICBjb25zdCBjaGlsZEtleU9iaiA9IEpTT04ucGFyc2Uoa2V5U3RyKTtcblxuICAgICAgICAgICAgcGFyZW50S2V5cy5wdXNoKGtleVN0cik7XG5cbiAgICAgICAgICAgIGNvbnN0IGZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBjaGlsZEZpZWxkLCB2YWwgXSBvZiBPYmplY3QuZW50cmllcyhjaGlsZEtleU9iaikpIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJzWyBjaGlsZEZpZWxkIF0gPSB7IGVxOiB2YWwgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcHJvbWlzZXMucHVzaChcbiAgICAgICAgICAgICAgICBjaGlsZFNlcnZpY2UubGlzdCh7XG4gICAgICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XG5cbiAgICAgICAgLy8gRm9yIGVhY2ggcmVzdWx0LCBtYXAgY2hpbGRyZW4gYmFjayB0byB0aGUgY29ycmVjdC1wYXJlbnQocylcbiAgICAgICAgY29uc3QgcGFyZW50S2V5U3RyVG9DaGlsZHJlbjogUmVjb3JkPHN0cmluZywgYW55W10+ID0ge307XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdWx0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgeyBkYXRhOiBjaGlsZEl0ZW1zIH0gPSByZXN1bHRzWyBpIF07XG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBwYXJlbnRLZXlzWyBpIF07XG4gICAgICAgICAgICBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuWyBrZXlTdHIgXSA9IGNoaWxkSXRlbXMgPz8gW107XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBdHRhY2ggdG8gcGFyZW50c1xuICAgICAgICBmb3IgKGNvbnN0IFsga2V5U3RyLCBwYXJlbnRzIF0gb2YgcGFyZW50S2V5U3RyVG9QYXJlbnRzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgY2hpbGRBcnJheSA9IHBhcmVudEtleVN0clRvQ2hpbGRyZW5bIGtleVN0ciBdID8/IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBwIG9mIHBhcmVudHMpIHtcbiAgICAgICAgICAgICAgICBwWyBjaGlsZEF0dHJpYnV0ZU5hbWUgXSA9IGNoaWxkQXJyYXk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgYW4gZW50aXR5IGJ5IGl0cyBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eS5cbiAgICAgKiBAcGFyYW0gc2VsZWN0aW9ucyAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBpbmNsdWRlIGluIHRoZSByZXNwb25zZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmV0cmlldmVkIGVudGl0eSBkYXRhLlxuICAgICAqL1xuXG4gICAgcHVibGljIGFzeW5jIGdldChvcHRpb25zOiBHZXRPcHRpb25zPFM+LCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICBjb25zdCB7IGlkZW50aWZpZXJzLCBhdHRyaWJ1dGVzIH0gPSBvcHRpb25zO1xuXG5cbiAgICAgICAgbGV0IGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzO1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm9ybWF0dGVkQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3JtYXR0ZWQgYXR0cmlidXRlcyBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIGZvcm1hdHRlZEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGNvbnN0IHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgYW55KS5yZWR1Y2UoKGFjYywgWyBhdHROYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgIGFjYy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgaWYgKGlzT2JqZWN0KG9wdGlvbnMpICYmIG9wdGlvbnMuaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogQXJyYXk8UmVsYXRpb25JZGVudGlmaWVyPGFueT4+ID0gQXJyYXkuaXNBcnJheShvcHRpb25zLmlkZW50aWZpZXJzKSA/IG9wdGlvbnMuaWRlbnRpZmllcnMgOiBbIG9wdGlvbnMuaWRlbnRpZmllcnMgXTtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3BLZXlzID0gaWRlbnRpZmllcnMubWFwKGlkZW50aWZpZXIgPT4gaWRlbnRpZmllci5zb3VyY2U/LnNwbGl0Py4oJy4nKT8uWyAwIF0pLmZpbHRlcihrZXkgPT4gISFrZXkpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgICAgICAgIGFjYy5wdXNoKC4uLnRvcEtleXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgfSwgW10gYXMgc3RyaW5nW10pO1xuXG4gICAgICAgIGNvbnN0IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBbIC4uLm5ldyBTZXQocmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzKSBdXG5cbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZ2V0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZXRyaWV2ZWQgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIEpzb25TZXJpYWxpemVyLnN0cmluZ2lmeShlbnRpdHkpKTtcblxuICAgICAgICBpZiAoISFmb3JtYXR0ZWRBdHRyaWJ1dGVzICYmIGVudGl0eT8uZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIFsgZW50aXR5LmRhdGEgXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZW50aXR5Py5kYXRhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBtdWx0aXBsZSBlbnRpdGllcyBieSB0aGVpciBpZGVudGlmaWVycyBpbiBhIGJhdGNoIG9wZXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBiYXRjaCByZXRyaWV2aW5nIGVudGl0aWVzLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmlkZW50aWZpZXJzIC0gQXJyYXkgb2YgZW50aXR5IGlkZW50aWZpZXJzIHRvIHJldHJpZXZlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmF0dHJpYnV0ZXMgLSBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmVzcG9uc2UuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuY29uY3VycmVudCAtIE9wdGlvbmFsIG51bWJlciBvZiBjb25jdXJyZW50IGJhdGNoIG9wZXJhdGlvbnMgdG8gcGVyZm9ybSAoZGVmYXVsdDogMSkuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIHJldHJpZXZlZCBlbnRpdGllcyBhbmQgYW55IHVucHJvY2Vzc2VkIGl0ZW1zLlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBiYXRjaEdldDxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihvcHRpb25zOiB7XG4gICAgICAgIGlkZW50aWZpZXJzOiBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PixcbiAgICAgICAgYXR0cmlidXRlcz86IEVudGl0eVNlbGVjdGlvbnM8Uz4sXG4gICAgICAgIGNvbmN1cnJlbnQ/OiBudW1iZXJcbiAgICB9KSB7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMsIGNvbmN1cnJlbnQgPSAxIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcbiAgICAgICAgaWYgKCFhdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZvcm1hdHRlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm9ybWF0dGVkIGF0dHJpYnV0ZXMgZm9yIGJhdGNoIGdldCBvbiBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZm9ybWF0dGVkQXR0cmlidXRlcyk7XG5cbiAgICAgICAgY29uc3QgcmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBhbnkpLnJlZHVjZSgoYWNjLCBbIGF0dE5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYWNjLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICBpZiAoaXNPYmplY3Qob3B0aW9ucykgJiYgb3B0aW9ucy5pZGVudGlmaWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8YW55Pj4gPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycyA6IFsgb3B0aW9ucy5pZGVudGlmaWVycyBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcEtleXMgPSBpZGVudGlmaWVycy5tYXAoaWRlbnRpZmllciA9PiBpZGVudGlmaWVyLnNvdXJjZT8uc3BsaXQ/LignLicpPy5bIDAgXSkuZmlsdGVyKGtleSA9PiAhIWtleSkgYXMgc3RyaW5nW107XG4gICAgICAgICAgICAgICAgYWNjLnB1c2goLi4udG9wS2V5cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCBbXSBhcyBzdHJpbmdbXSk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyA9IFsgLi4ubmV3IFNldChyZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMpIF07XG5cbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgZ2V0QmF0Y2hFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWRzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMgYXMgYW55LFxuICAgICAgICAgICAgY29uY3VycmVudFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmV0cmlldmVkIGJhdGNoIGVudGl0aWVzOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIEpzb25TZXJpYWxpemVyLnN0cmluZ2lmeShlbnRpdHkpKTtcblxuICAgICAgICBpZiAoISFmb3JtYXR0ZWRBdHRyaWJ1dGVzICYmIGVudGl0eT8uZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWyAsIG9wdGlvbnMgXSkgPT4gaXNPYmplY3Qob3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAocmVsYXRpb25hbEF0dHJpYnV0ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlUmVjb3JkcyhyZWxhdGlvbmFsQXR0cmlidXRlcyBhcyBhbnksIGVudGl0eS5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBkYXRhOiBlbnRpdHk/LmRhdGEgfHwgW10sXG4gICAgICAgICAgICB1bnByb2Nlc3NlZDogZW50aXR5Py51bnByb2Nlc3NlZCB8fCBbXVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyB0aGUgdW5pcXVlbmVzcyBvZiBhbiBhdHRyaWJ1dGUgdmFsdWUgYW5kIHVwZGF0ZXMgdGhlIHBheWxvYWQgaWYgbmVjZXNzYXJ5LlxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNoZWNraW5nIHVuaXF1ZW5lc3MgYW5kIHVwZGF0aW5nIHRoZSBwYXlsb2FkLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLnBheWxvYWRUb1VwZGF0ZSAtIFRoZSBwYXlsb2FkIG9iamVjdCB0byB1cGRhdGUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlVmFsdWUgLSBUaGUgdmFsdWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgYXR0ZW1wdHMgdG8gY3JlYXRlIGEgdW5pcXVlIGF0dHJpYnV0ZSB2YWx1ZS5cbiAgICAgKiBAcmV0dXJucyBBIGJvb2xlYW4gaW5kaWNhdGluZyB3aGV0aGVyIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlLlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBjaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUob3B0aW9uczoge1xuICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IGFueSxcbiAgICAgICAgYXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogYW55LFxuICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM/OiB7XG4gICAgICAgICAgICBbIGtleTogc3RyaW5nIF06IGFueVxuICAgICAgICB9XG4gICAgICAgIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZTogbnVtYmVyLFxuICAgIH0pIHtcblxuICAgICAgICBjb25zdCB7IHBheWxvYWRUb1VwZGF0ZSwgYXR0cmlidXRlTmFtZSwgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzLCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgfSA9IG9wdGlvbnM7XG4gICAgICAgIGxldCB7IGF0dHJpYnV0ZVZhbHVlIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGxldCBpc1VuaXF1ZSA9IGZhbHNlO1xuICAgICAgICBsZXQgdHJpZXNDb3VudCA9IDE7XG5cbiAgICAgICAgd2hpbGUgKCFpc1VuaXF1ZSAmJiB0cmllc0NvdW50IDwgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKSB7XG4gICAgICAgICAgICBpc1VuaXF1ZSA9IGF3YWl0IHRoaXMuaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZShhdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVWYWx1ZSwgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKTtcbiAgICAgICAgICAgIGlmICghaXNVbmlxdWUpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZSA9IHRoaXMuZ2VuZXJhdGVVbmlxdWVWYWx1ZShhdHRyaWJ1dGVWYWx1ZSwgdHJpZXNDb3VudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0cmllc0NvdW50Kys7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNVbmlxdWUpIHtcbiAgICAgICAgICAgIHBheWxvYWRUb1VwZGF0ZVsgYXR0cmlidXRlTmFtZSBdID0gYXR0cmlidXRlVmFsdWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gaXNVbmlxdWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIGlmIHRoZSBnaXZlbiBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlIGZvciB0aGUgc3BlY2lmaWVkIGF0dHJpYnV0ZSBuYW1lLlxuICAgICAqIEBwYXJhbSBhdHRyaWJ1dGVOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gYXR0cmlidXRlVmFsdWUgLSBUaGUgdmFsdWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcmV0dXJucyBBIGJvb2xlYW4gaW5kaWNhdGluZyB3aGV0aGVyIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgdW5pcXVlIG9yIG5vdC5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZShcbiAgICAgICAgYXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogYW55LFxuICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM/OiB7XG4gICAgICAgICAgICBbIGtleTogc3RyaW5nIF06IGFueVxuICAgICAgICB9XG4gICAgKSB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGlzVW5pcXVlQXR0cmlidXRlVmFsdWUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGF0dHJpYnV0ZU5hbWU6ICR7YXR0cmlidXRlTmFtZX0gfiBhdHRyaWJ1dGVWYWx1ZTogJHthdHRyaWJ1dGVWYWx1ZX1gKTtcblxuICAgICAgICAvLyBDcmVhdGUgZmlsdGVycyBmb3IgdGhlIHF1ZXJ5IHVzaW5nIHRoZSBjb3JyZWN0IHN0cnVjdHVyZVxuICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgWyBhdHRyaWJ1dGVOYW1lIF06IHsgZXE6IGF0dHJpYnV0ZVZhbHVlIH1cbiAgICAgICAgfSBhcyBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPjtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgd2hpY2ggYXR0cmlidXRlcyB0byBwcm9qZWN0IC0gb25seSB0aGUgYXR0cmlidXRlIGJlaW5nIGNoZWNrZWQgYW5kIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXJzXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXNUb1Byb2plY3Q6IHN0cmluZ1tdID0gWyBhdHRyaWJ1dGVOYW1lIF07XG5cbiAgICAgICAgLy8gQWRkIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXIgZmllbGRzIHRvIHRoZSBwcm9qZWN0aW9uXG4gICAgICAgIGlmIChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMgJiYgIWlzRW1wdHlPYmplY3REZWVwKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghYXR0cmlidXRlc1RvUHJvamVjdC5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXNUb1Byb2plY3QucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXNlIHRoZSBxdWVyeSBtZXRob2QgdG8gbGV2ZXJhZ2UgaW5kZXggc2VsZWN0aW9uIGxvZ2ljIHdpdGggbWluaW1hbCBhdHRyaWJ1dGUgcHJvamVjdGlvblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KHtcbiAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiBhdHRyaWJ1dGVzVG9Qcm9qZWN0IGFzIGFueSxcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHsgY291bnQ6IDEgfSAvLyBXZSBvbmx5IG5lZWQgdG8ga25vdyBpZiBhbnkgcmVjb3JkcyBleGlzdFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJZiB3ZSBoYXZlIGlnbm9yZWQgZW50aXR5IGlkZW50aWZpZXJzLCBmaWx0ZXIgdGhlIHJlc3VsdHMgaW4gbWVtb3J5XG4gICAgICAgIGxldCBlbnRpdGllcyA9IHJlc3VsdC5kYXRhIHx8IFtdO1xuICAgICAgICBpZiAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzICYmICFpc0VtcHR5T2JqZWN0RGVlcChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBlbnRpdGllcyA9IGVudGl0aWVzLmZpbHRlcihlbnRpdHkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAhT2JqZWN0LmVudHJpZXMoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKS5ldmVyeSgoWyBrZXksIHZhbHVlIF0pID0+XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eVsga2V5IF0gPT09IHZhbHVlXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGlzVW5pcXVlQXR0cmlidXRlVmFsdWUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGF0dHJpYnV0ZU5hbWU6ICR7YXR0cmlidXRlTmFtZX0gfiBhdHRyaWJ1dGVWYWx1ZTogJHthdHRyaWJ1dGVWYWx1ZX0gfiBlbnRpdHk6YCwgeyBkYXRhOiBlbnRpdGllcyB9KTtcblxuICAgICAgICByZXR1cm4gZW50aXRpZXMubGVuZ3RoID09PSAwO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlcyBhIHVuaXF1ZSB2YWx1ZSBieSBhcHBlbmRpbmcgYSB1bmlxdWUgc3VmZml4IHRvIHRoZSBvcmlnaW5hbCB2YWx1ZS5cbiAgICAgKiBAcGFyYW0gb3JpZ2luYWxWYWx1ZSAtIFRoZSBvcmlnaW5hbCB2YWx1ZSB0byBnZW5lcmF0ZSBhIHVuaXF1ZSB2YWx1ZSBmcm9tLlxuICAgICAqIEBwYXJhbSBhdHRlbXB0IC0gVGhlIGF0dGVtcHQgbnVtYmVyIG9yIHN0cmluZyB0byBiZSB1c2VkIGFzIGEgc3VmZml4IChkZWZhdWx0OiByYW5kb20gc3RyaW5nKS5cbiAgICAgKiBAcmV0dXJucyBUaGUgZ2VuZXJhdGVkIHVuaXF1ZSB2YWx1ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgZ2VuZXJhdGVVbmlxdWVWYWx1ZShvcmlnaW5hbFZhbHVlOiBhbnksIGF0dGVtcHQ6IG51bWJlciB8IHN0cmluZyA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZygyLCAxNSkpOiBzdHJpbmcge1xuICAgICAgICBjb25zdCB1bmlxdWVTdWZmaXggPSBgJHtEYXRlLm5vdygpfS0ke2F0dGVtcHR9YDtcbiAgICAgICAgcmV0dXJuIGAke29yaWdpbmFsVmFsdWV9LSR7dW5pcXVlU3VmZml4fWA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXV0b21hdGljYWxseSBpbmplY3RzIGFjdG9yIGNvbnRleHQgaW50byBlbnRpdHkgZGF0YVxuICAgICAqIEBwYXJhbSBkYXRhIC0gVGhlIGVudGl0eSBkYXRhIHRvIGVuaGFuY2VcbiAgICAgKiBAcGFyYW0gb3BlcmF0aW9uIC0gVGhlIG9wZXJhdGlvbiB0eXBlIChjcmVhdGUvdXBkYXRlKVxuICAgICAqIEBwYXJhbSBjdHggLSBUaGUgZXhlY3V0aW9uIGNvbnRleHQgY29udGFpbmluZyBhY3RvciBpbmZvXG4gICAgICogQHJldHVybnMgRW5oYW5jZWQgZGF0YSB3aXRoIGFjdG9yIGNvbnRleHRcbiAgICAgKi9cbiAgICBwcm90ZWN0ZWQgaW5qZWN0QWN0b3JDb250ZXh0PFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICAgICAgZGF0YTogVCwgXG4gICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZWxldGUnLCBcbiAgICAgICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICAgICk6IFQge1xuXG4gICAgICAgIGlmICghY3R4Py5hY3Rvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0Jhc2VFbnRpdHlTZXJ2aWNlOiBObyBhY3RvciBjb250ZXh0IGZvdW5kLCBza2lwcGluZyBpbmplY3Rpb24nKTtcbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW5oYW5jZWREYXRhID0geyAuLi5kYXRhIH07XG4gICAgICAgIGNvbnN0IHsgYWN0b3IgfSA9IGN0eDtcblxuICAgICAgICAvLyBHZXQgY3VycmVudCB0aW1lc3RhbXAgZm9yIGRhdGFiYXNlIG9wZXJhdGlvblxuICAgICAgICBjb25zdCBjdXJyZW50VGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICBcbiAgICAgICAgLy8gSW5qZWN0IHZpc2libGUgYWN0b3IgZmllbGRzIGlmIGRlZmluZWQgaW4gc2NoZW1hIGFuZCBub3QgcmVhZC1vbmx5XG4gICAgICAgIGlmIChvcGVyYXRpb24gPT09ICdjcmVhdGUnKSB7XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2NyZWF0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2NyZWF0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuY3JlYXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnY3JlYXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnY3JlYXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuY3JlYXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gRm9yIGRlbGV0ZSBvcGVyYXRpb25zLCB3ZSBzdGlsbCB3YW50IHRvIHRyYWNrIHdobyBwZXJmb3JtZWQgdGhlIGRlbGV0aW9uXG4gICAgICAgIGlmIChvcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnZGVsZXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnZGVsZXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEFsd2F5cyB1cGRhdGUgdGhlc2UgZmllbGRzIG9uIGNyZWF0ZS91cGRhdGUgKGlmIG5vdCByZWFkLW9ubHkpXG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndXBkYXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndXBkYXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndGVuYW50SWQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd0ZW5hbnRJZCcpICYmIGFjdG9yLnRlbmFudElkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLnRlbmFudElkID0gYWN0b3IudGVuYW50SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBbHdheXMgaW5qZWN0IGNvbXBsZXRlIGFjdG9yIGNvbnRleHQgZm9yIGF1ZGl0IHRyYWlsXG4gICAgICAgIC8vIFRoaXMgZmllbGQgaXMgaGlkZGVuIGZyb20gQVBJIHJlc3BvbnNlcyBieSBkZWZhdWx0XG4gICAgICAgIC8vIENsZWFuIGFjdG9yIG9iamVjdCBieSByZW1vdmluZyB1bmRlZmluZWQgdmFsdWVzIChEeW5hbW9EQiBkb2Vzbid0IGFsbG93IHRoZW0pXG4gICAgICAgIGNvbnN0IGNsZWFuQWN0b3IgPSBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhhY3RvcikuZmlsdGVyKChbXywgdmFsdWVdKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICApO1xuXG4gICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5fYWN0b3IgPSBjbGVhbkFjdG9yO1xuXG4gICAgICAgIHJldHVybiBlbmhhbmNlZERhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBlbnRpdHkuXG4gICAgICogXG4gICAgICogQHBhcmFtIHBheWxvYWQgLSBUaGUgcGF5bG9hZCBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGNyZWF0ZShwYXlsb2FkOiBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgICAgICBsZXQgcGF5bG9hZENvcHkgPSB7IC4uLnBheWxvYWQgfTtcbiAgICAgICAgXG4gICAgICAgIC8vIEluamVjdCBhY3RvciBjb250ZXh0XG4gICAgICAgIHBheWxvYWRDb3B5ID0gdGhpcy5pbmplY3RBY3RvckNvbnRleHQocGF5bG9hZENvcHksICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eVNsdWdBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnc2x1ZycpIHx8ICcnO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ25hbWUnKSB8fCAnJztcblxuICAgICAgICBpZiAoZW50aXR5U2x1Z0F0dHJpYnV0ZSAmJiAhKGVudGl0eVNsdWdBdHRyaWJ1dGUgaW4gcGF5bG9hZENvcHkpKSB7XG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZUF0dHJpYnV0ZSAmJiAoZW50aXR5TmFtZUF0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgICAgICBwYXlsb2FkQ29weVsgZW50aXR5U2x1Z0F0dHJpYnV0ZSBhcyBrZXlvZiB0eXBlb2YgcGF5bG9hZENvcHkgXSA9IHRvU2x1ZyhwYXlsb2FkQ29weVsgZW50aXR5TmFtZUF0dHJpYnV0ZSBdKSBhcyBhbnk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHMgPSB0aGlzLmdldFVuaXF1ZUF0dHJpYnV0ZXMoKTtcbiAgICAgICAgY29uc3Qgc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlID0gNTtcblxuICAgICAgICBpZiAoIXNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzICYmIHVuaXF1ZUZpZWxkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxldCB1bmlxdWVuZXNzQ2hlY2tzID0gW107XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lIH0gb2YgdW5pcXVlRmllbGRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5hbWUhIGluIHBheWxvYWRDb3B5KSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2YWx1ZSA9IHBheWxvYWRDb3B5WyBuYW1lISBdO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IG5hbWUhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBjcmVhdGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgZGF0YTogcGF5bG9hZENvcHksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBlbnRpdHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcy1PUi1VcGRhdGVzIGFuIGVudGl0eS5cbiAgICAgKiBOT1RFOiBcbiAgICAgKiAgIC0gVGhpcyBtZXRob2QgZG9lcyBub3QgY2hlY2sgZm9yIHVuaXF1ZW5lc3Mgb2YgdGhlIGF0dHJpYnV0ZXMsIG5laXRoZXIgY3JlYXRlIHRoZSBzbHVnIGF1dG9tYXRpY2FsbHkuXG4gICAgICogICAtIEl0J3MgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIHRoZSBjYWxsZXIgdG8gZW5zdXJlIHRoZSByZWFkIG9ueSBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaWYgdGhlIHJlY29yZCBpcyBiZWluZyB1cHNlcnQuXG4gICAgICogXG4gICAgICogQHBhcmFtIHBheWxvYWQgLSBUaGUgcGF5bG9hZCBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBPYmplY3QgY29udGFpbmluZzpcbiAgICAgKiAgIC0gZGF0YTogVGhlIHVwc2VydGVkIGVudGl0eSBkYXRhXG4gICAgICogICAtIHdhc0NyZWF0ZWQ6IHRydWUgaWYgcmVjb3JkIHdhcyBjcmVhdGVkLCBmYWxzZSBpZiB1cGRhdGVkXG4gICAgICogICAtIG9sZERhdGE6IHByZXZpb3VzIGRhdGEgaWYgaXQgd2FzIGFuIHVwZGF0ZSAodW5kZWZpbmVkIGZvciBjcmVhdGVzKVxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyB1cHNlcnQocGF5bG9hZDogVXBzZXJ0RW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiB1cHNlcnQgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IHBheWxvYWQ6YCwgcGF5bG9hZCk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdXBzZXJ0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIGRhdGE6IHBheWxvYWQsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIGR1cGxpY2F0ZSBlbnRpdHkgZGF0YSBiYXNlZCBvbiB0aGUgZ2l2ZW4gaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIGR1cGxpY2F0ZSBlbnRpdHkgZGF0YS5cbiAgICAgKiBAdGhyb3dzIEVycm9yIGlmIG5vIHJlY29yZCBpcyBmb3VuZCBmb3IgdGhlIGdpdmVuIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3QgaWRlbnRpZmllcnMgPSB7IGlkOiAxIH07XG4gICAgICogY29uc3QgZHVwbGljYXRlRGF0YSA9IGF3YWl0IG1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhQnlJZGVudGlmaWVycyhpZGVudGlmaWVycyk7XG4gICAgICogY29uc29sZS5sb2coZHVwbGljYXRlRGF0YSk7IC8vIHsgbmFtZTogJ0pvaG4gRG9lJywgYWdlOiAzMCwgLi4uIH1cbiAgICAgKi9cbiAgICBwcm90ZWN0ZWQgYXN5bmMgbWFrZUR1cGxpY2F0ZUVudGl0eURhdGEoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4pIHtcbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgdGhpcy5nZXQoeyBpZGVudGlmaWVycyB9KSBhcyBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxTPjtcblxuICAgICAgICBpZiAoIWVudGl0eSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSByZWNvcmQgZm91bmQgZm9yIGlkZW50aWZpZXJzOiAke2lkZW50aWZpZXJzfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGR1cGxpY2F0ZUV2ZW50RGF0YTogQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+ID0ge30gYXMgYW55O1xuICAgICAgICBjb25zdCBwcmltYXJ5SWRQcm9wTmFtZSA9IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCkgYXMgc3RyaW5nO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eVNsdWdBdHRyaWJ1dGUgPSAoZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ3NsdWcnKSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUF0dHJpYnV0ZSA9IChnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnbmFtZScpIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuXG4gICAgICAgIGZvciAobGV0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGVudGl0eSkpIHtcblxuICAgICAgICAgICAgaWYgKGtleSAhPT0gcHJpbWFyeUlkUHJvcE5hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBUT0RPOiBoYW5kbGUgd2hlbiBlbnRpdHkgaGFzIG11bHRpcGxlIGlkZW50aWZpZXJzXG5cbiAgICAgICAgICAgICAgICBpZiAoa2V5LnRvVXBwZXJDYXNlKCkgPT09IGVudGl0eU5hbWVBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBgJHt2YWx1ZX0gLSBDb3B5YDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGtleS50b1VwcGVyQ2FzZSgpID09PSBlbnRpdHlTbHVnQXR0cmlidXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gYCR7dmFsdWV9LWNvcHlgO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGR1cGxpY2F0ZUV2ZW50RGF0YVsga2V5IGFzIGtleW9mIHR5cGVvZiBkdXBsaWNhdGVFdmVudERhdGEgXSA9IHZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGR1cGxpY2F0ZUV2ZW50RGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgZHVwbGljYXRlIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gZHVwbGljYXRlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBkdXBsaWNhdGVkIGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGVudGl0eUlkID0geyBpZDogMTIzLCBuYW1lOiAnZXhhbXBsZScgfTtcbiAgICAgKiBjb25zdCBkdXBsaWNhdGVkRW50aXR5ID0gYXdhaXQgZHVwbGljYXRlKGVudGl0eUlkKTtcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZHVwbGljYXRlKGlkOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGR1cGxpY2F0ZUV2ZW50RGF0YSA9IGF3YWl0IHRoaXMubWFrZUR1cGxpY2F0ZUVudGl0eURhdGEoaWQpO1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5jcmVhdGUoZHVwbGljYXRlRXZlbnREYXRhLCBjdHgpO1xuICAgIH1cblxuICAgIC8vIFRPRE86IHNob3VsZCBiZSBwYXJ0IG9mIHNvbWUgY29uZmlnXG4gICAgcHJvdGVjdGVkIGRlbGltaXRlcnNSZWdleCA9IC8oPzomfCB8LHxcXCspKy87XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgYSBsaXN0IG9mIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBxdWVyeS5cbiAgICAgKiAtIElmIG5vIHNwZWNpZmljIGF0dHJpYnV0ZXMgYXJlIHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogLSBJZiBhIHNlYXJjaCB0ZXJtIGlzIHByb3ZpZGVkIGluIHRoZSBxdWVyeSBpdCB3aWxsIHNwbGl0IHRoZSBzZWFyY2ggdGVybSBieSBgLyg/OiZ8IHwsfFxcKykrL2AgUmVnZXggYW5kIHdpbGwgZmlsdGVyIG91dCBlbXB0eSBzdHJpbmdzLlxuICAgICAqIC0gSWYgc2VhcmNoIGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBzZWFyY2hhYmxlIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogXG4gICAgICogQHBhcmFtIHF1ZXJ5IC0gVGhlIHF1ZXJ5IG9iamVjdCBjb250YWluaW5nIGZpbHRlcnMsIHNlYXJjaCBrZXl3b3JkcywgYW5kIGF0dHJpYnV0ZXMuXG4gICAgICogQHJldHVybnMgQSBQcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGxpc3Qgb2YgZW50aXRpZXMgYW5kIHRoZSBvcmlnaW5hbCBxdWVyeS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgbGlzdChxdWVyeTogRW50aXR5UXVlcnk8Uz4gPSB7fSwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGxpc3QgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IHF1ZXJ5OmAsIHF1ZXJ5KTtcblxuICAgICAgICBpZiAoIXF1ZXJ5LmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIHF1ZXJ5LmF0dHJpYnV0ZXMgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICAvLyBmb3IgbGlzdGluZyBBUEkgYXR0cmlidXRlcyB3b3VsZCBiZSBhbiBhcnJheVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShxdWVyeS5hdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMocXVlcnkuYXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBxdWVyeS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaCkge1xuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaCkpIHtcbiAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2ggPSBxdWVyeS5zZWFyY2gudHJpbSgpLnNwbGl0KHRoaXMuZGVsaW1pdGVyc1JlZ2V4ID8/ICcgJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaC5sZW5ndGggPiAwKSB7XG5cbiAgICAgICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMuc3BsaXQoJywnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoIXF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgfHwgaXNFbXB0eShxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzID0gdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXJHcm91cCA9IG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzKHF1ZXJ5LnNlYXJjaCwgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyk7XG5cbiAgICAgICAgICAgICAgICBxdWVyeS5maWx0ZXJzID0gYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhPFM+KHNlYXJjaEZpbHRlckdyb3VwIGFzIGFueSwgcXVlcnkuZmlsdGVycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdGllcyA9IGF3YWl0IGxpc3RFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSB0aGlzLnNlcmlhbGl6ZVJlY29yZHMoZW50aXRpZXMuZGF0YSwgcXVlcnkuYXR0cmlidXRlcyk7XG5cbiAgICAgICAgaWYgKHF1ZXJ5LmF0dHJpYnV0ZXMgJiYgZW50aXRpZXMuZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhxdWVyeS5hdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLy8gb25seSBhdHRyaWJ1dGVzIGluIGh5ZHJhdGUgb3B0aW9ucyB0aGF0IGhhdmUgcmVsYXRpb24gbWV0YWRhdGEgYXR0YWNoZWQgdG8gdGhlbSBuZWVkcyB0byBiZSBoeWRyYXRlZFxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdGllcy5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IC4uLmVudGl0aWVzLCBxdWVyeSB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogRXhlY3V0ZXMgYSBxdWVyeSBvbiB0aGUgZW50aXR5LlxuICAgICAqIC0gSWYgbm8gc3BlY2lmaWMgYXR0cmlidXRlcyBhcmUgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2YgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAtIElmIGEgc2VhcmNoIHRlcm0gaXMgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5IGl0IHdpbGwgc3BsaXQgdGhlIHNlYXJjaCB0ZXJtIGJ5IGAvKD86JnwgfCx8XFwrKSsvYCBSZWdleCBhbmQgd2lsbCBmaWx0ZXIgb3V0IGVtcHR5IHN0cmluZ3MuXG4gICAgICogICAtLSBJZiBzZWFyY2ggYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIHNlYXJjaGFibGUgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAgIC0tIElmIHRoZXJlIGFyZSBhbnkgbm9uLWVtcHR5IHNlYXJjaC10ZXJtcywgaXQgd2lsbCBhZGQgYSBmaWx0ZXIgZ3JvdXAgdG8gdGhlIHF1ZXJ5IGJhc2VkIG9uIHRoZSBzZWFyY2gga2V5d29yZHMuXG4gICAgICogQHBhcmFtIHF1ZXJ5IC0gVGhlIGVudGl0eSBxdWVyeSB0byBleGVjdXRlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXN1bHQgb2YgdGhlIHF1ZXJ5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBxdWVyeShxdWVyeTogRW50aXR5UXVlcnk8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgY29uc3QgeyBhdHRyaWJ1dGVzIH0gPSBxdWVyeTtcblxuICAgICAgICBsZXQgc2VsZWN0QXR0cmlidXRlczogRW50aXR5U2VsZWN0aW9uczxTPiB8IHVuZGVmaW5lZCA9IGF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3RBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgLy8gcGFyc2UgdGhlIGxpc3Qgb2YgZG90LXNlcGFyYXRlZCBhdHRyaWJ1dGUtaWRlbnRpZmllcnMgcGF0aHMgYW5kIGVuc3VyZSBhbGwgdGhlIHJlcXVpcmVkIG1ldGFkYXRhIGlzIHRoZXJlXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhzZWxlY3RBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIHNlbGVjdEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBlbnN1cmUgYWxsIHRoZSBwcm92aWRlZCBzZWxlY3QgYXR0cmlidXRlcyBoYXMgcmVxdWlyZWQgbWV0YWRhdGEgYWxsIHRoZSB3YXkgZG93biB0byB0aGUgbGVhZiBsZXZlbFxuICAgICAgICAgICAgc2VsZWN0QXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBzZWxlY3RBdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlckdyb3VwID0gbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMocXVlcnkuc2VhcmNoLCBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKTtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LmZpbHRlcnMgPSBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4oc2VhcmNoRmlsdGVyR3JvdXAgYXMgYW55LCBxdWVyeS5maWx0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzID0gYXdhaXQgcXVlcnlFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSB0aGlzLnNlcmlhbGl6ZVJlY29yZHMoZW50aXRpZXMuZGF0YSwgc2VsZWN0QXR0cmlidXRlcyk7XG5cbiAgICAgICAgaWYgKHNlbGVjdEF0dHJpYnV0ZXMgJiYgZW50aXRpZXMuZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhzZWxlY3RBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLy8gb25seSBhdHRyaWJ1dGVzIGluIGh5ZHJhdGUgb3B0aW9ucyB0aGF0IGhhdmUgcmVsYXRpb24gbWV0YWRhdGEgYXR0YWNoZWQgdG8gdGhlbSBuZWVkcyB0byBiZSBoeWRyYXRlZFxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdGllcy5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IC4uLmVudGl0aWVzLCBxdWVyeSB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFVwZGF0ZXMgYW4gZW50aXR5IGluIHRoZSBkYXRhYmFzZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0gZGF0YSAtIFRoZSB1cGRhdGVkIGRhdGEgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHBhcmFtIHJlbW92ZSAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gcmVtb3ZlIGZyb20gdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgdXBkYXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHVwZGF0ZShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiwgZGF0YTogVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+LCBvcGVyYXRvcnM/OiBVcGRhdGVFbnRpdHlPcGVyYXRvcnMsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgICAgICAvLyBJbmplY3QgYWN0b3IgY29udGV4dFxuICAgICAgICBsZXQgZW5oYW5jZWREYXRhID0gdGhpcy5pbmplY3RBY3RvckNvbnRleHQoZGF0YSBhcyBhbnksICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUsIHJlYWRPbmx5IH0gb2YgdW5pcXVlRmllbGRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJlYWRPbmx5KSB7XG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBlbmhhbmNlZERhdGFbIG5hbWUgYXMga2V5b2YgdHlwZW9mIGVuaGFuY2VkRGF0YSBdO1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gZW5oYW5jZWREYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2YWx1ZSA9IGVuaGFuY2VkRGF0YVsgbmFtZSBhcyBrZXlvZiB0eXBlb2YgZW5oYW5jZWREYXRhIF07XG4gICAgICAgICAgICAgICAgICAgIHVuaXF1ZW5lc3NDaGVja3MucHVzaCgoKSA9PiB0aGlzLmNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IGVuaGFuY2VkRGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IG5hbWUhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY2hlY2tSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwodW5pcXVlbmVzc0NoZWNrcy5tYXAoY2hlY2sgPT4gY2hlY2soKSkpO1xuXG4gICAgICAgICAgICBpZiAoY2hlY2tSZXN1bHRzLmluY2x1ZGVzKGZhbHNlKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkc1BhdGggPSB1bmlxdWVGaWVsZHMubWFwKGZpZWxkID0+IGZpZWxkLm5hbWUhKSA/PyBbXTtcblxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IoWyB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IFwiVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciBvbmUgb3IgbW9yZSBmaWVsZHMuXCIsXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHVuaXF1ZUZpZWxkc1BhdGgsXG4gICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkOiBbICd1bmlxdWUnLCB1bmlxdWVGaWVsZHMgXSxcbiAgICAgICAgICAgICAgICB9IF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdXBkYXRlZEVudGl0eSA9IGF3YWl0IHVwZGF0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBkYXRhOiBlbmhhbmNlZERhdGEsXG4gICAgICAgICAgICBvcGVyYXRvcnM6IG9wZXJhdG9ycyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHVwZGF0ZWRFbnRpdHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGRlbGV0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBkZWxldGUoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0cnkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gZGVsZXRlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBpZGVudGlmaWVyczpgLCBpZGVudGlmaWVycyk7XG4gICAgICAgIFxuICAgICAgICAgICAgY29uc3QgZGVsZXRlZEVudGl0eSA9IGF3YWl0IGRlbGV0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgICAgICBhY3RvcjogY3R4Py5hY3RvcixcbiAgICAgICAgICAgIHRlbmFudDogY3R4Py5hY3Rvcj8udGVuYW50SWQsXG4gICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gZGVsZXRlZEVudGl0eTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byBkZWxldGUgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlYnVpbGRzIGFsbCBpbmRleGVzIGZvciB0aGUgZW50aXR5IGJ5IHdyaXRpbmcgdG8gdGhlIHByaW1hcnkgaW5kZXguXG4gICAgICogVGhpcyBtZXRob2QgaXMgdXNlZnVsIGZvciBtYWludGFpbmluZyBkYXRhIGludGVncml0eSBhbmQgZW5zdXJpbmcgaW5kZXhlcyBhcmUgcHJvcGVybHkgdXBkYXRlZC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIE9wdGlvbnMgZm9yIHJlYnVpbGRpbmcgdGhlIGluZGV4XG4gICAgICogQHBhcmFtIG9wdGlvbnMuYmF0Y2hTaXplIC0gVGhlIG51bWJlciBvZiBpdGVtcyB0byBwcm9jZXNzIGluIGVhY2ggYmF0Y2guIERlZmF1bHRzIHRvIDEwMC5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBpbmRleCByZWJ1aWxkIGlzIGNvbXBsZXRlLlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyByZWJ1aWxkSW5kZXgob3B0aW9uczogeyBiYXRjaFNpemU/OiBudW1iZXIgfSA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IGJhdGNoU2l6ZSA9IDEwMCB9ID0gb3B0aW9ucztcbiAgICAgICAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSB0aGlzLmdldEVudGl0eU5hbWUoKTtcbiAgICAgICAgICAgIGNvbnN0IHJlcG9zaXRvcnkgPSB0aGlzLmdldFJlcG9zaXRvcnkoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU3RhcnRpbmcgaW5kZXggcmVidWlsZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIEdldCBhbGwgcmVjb3JkcyBmcm9tIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICBjb25zdCBhbGxSZWNvcmRzID0gYXdhaXQgcmVwb3NpdG9yeS5zY2FuLmdvKCk7XG5cbiAgICAgICAgICAgIGlmICghYWxsUmVjb3Jkcy5kYXRhIHx8IGFsbFJlY29yZHMuZGF0YS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBObyByZWNvcmRzIGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZvdW5kICR7YWxsUmVjb3Jkcy5kYXRhLmxlbmd0aH0gcmVjb3JkcyB0byBwcm9jZXNzIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcblxuICAgICAgICAgICAgLy8gUHJvY2VzcyByZWNvcmRzIGluIGJhdGNoZXNcbiAgICAgICAgICAgIGNvbnN0IHRvdGFsUmVjb3JkcyA9IGFsbFJlY29yZHMuZGF0YS5sZW5ndGg7XG4gICAgICAgICAgICBjb25zdCB0b3RhbEJhdGNoZXMgPSBNYXRoLmNlaWwodG90YWxSZWNvcmRzIC8gYmF0Y2hTaXplKTtcblxuICAgICAgICAgICAgZm9yIChsZXQgYmF0Y2hJbmRleCA9IDA7IGJhdGNoSW5kZXggPCB0b3RhbEJhdGNoZXM7IGJhdGNoSW5kZXgrKykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gYmF0Y2hJbmRleCAqIGJhdGNoU2l6ZTtcbiAgICAgICAgICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1pbihzdGFydCArIGJhdGNoU2l6ZSwgdG90YWxSZWNvcmRzKTtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXRjaCA9IGFsbFJlY29yZHMuZGF0YS5zbGljZShzdGFydCwgZW5kKTtcblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFByb2Nlc3NpbmcgYmF0Y2ggJHtiYXRjaEluZGV4ICsgMX0vJHt0b3RhbEJhdGNoZXN9ICgke3N0YXJ0ICsgMX0tJHtlbmR9IG9mICR7dG90YWxSZWNvcmRzfSByZWNvcmRzKWApO1xuXG4gICAgICAgICAgICAgICAgLy8gUmVidWlsZCBhbGwgaW5kZXhlcyBieSB1cHNlcnRpbmcgZWFjaCByZWNvcmQgdG8gdGhlIHByaW1hcnkgaW5kZXhcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBiYXRjaCkge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHVwc2VydCB0byBlbnN1cmUgdGhlIHJlY29yZCBpcyBwcm9wZXJseSBpbmRleGVkXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZXBvc2l0b3J5LnVwc2VydChyZWNvcmQpLmdvKCk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyByZWNvcmQ6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb21wbGV0ZWQgaW5kZXggcmVidWlsZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIHJlYnVpbGQgaW5kZXggZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRGF0YWJhc2VFcnJvcihgRmFpbGVkIHRvIHJlYnVpbGQgaW5kZXggZm9yICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEluZmVycyByZWxhdGlvbnNoaXBzIGJldHdlZW4gZW50aXRpZXMgYmFzZWQgb24gdGhlIHByb3ZpZGVkIHNjaGVtYSBhbmQgc2VsZWN0aW9uLXBhdGhzLlxuICAgICAqIEBwYXJhbSBzY2hlbWEgVGhlIGVudGl0eSBzY2hlbWEuXG4gICAgICogQHBhcmFtIHBhdGhzIFRoZSBwYXJzZWQgc2VsZWN0aW9uIHBhdGhzIGZyb20gZS5nLiBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKCkuXG4gICAgICogQHBhcmFtIHBhdGhLZXkgVGhlIGN1cnJlbnQgXCJwYXRoXCIgc3RyaW5nIHJlcHJlc2VudGluZyBob3cgd2UgYXJyaXZlZCBoZXJlIChkZWZhdWx0cyB0byB0aGUgZW50aXR5IG5hbWUpLlxuICAgICAqIEBwYXJhbSB2aXNpdGVkUGF0aHMgQSBzZXQgb2YgcGF0aC1zdHJpbmdzIHZpc2l0ZWQgc28gZmFyIGluIHRoaXMgcmVjdXJzaW9uIGNoYWluIChwcmV2ZW50cyBjeWNsZXMpLlxuICAgICAqIEBwYXJhbSBtYXhEZXB0aCBNYXhpbXVtIHJlY3Vyc2lvbiBkZXB0aCAob3B0aW9uYWwpLlxuICAgICAqL1xuICAgIGluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnM8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgICAgIHNjaGVtYTogRSxcbiAgICAgICAgcGF0aHM6IFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzLFxuICAgICAgICBwYXRoS2V5OiBzdHJpbmcgPSBzY2hlbWEubW9kZWwuZW50aXR5LFxuICAgICAgICB2aXNpdGVkUGF0aHM6IFNldDxzdHJpbmc+ID0gbmV3IFNldDxzdHJpbmc+KCksXG4gICAgICAgIG1heERlcHRoID0gNVxuICAgICk6IEh5ZHJhdGVPcHRpb25zTWFwRm9yRW50aXR5PEU+IHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucycsIHsgcGF0aEtleSwgcGF0aHMgfSk7XG5cbiAgICAgICAgLy8gSWYgd2UgZXhjZWVkIG1heCBkZXB0aCwgd2Ugc2tpcCBleHBhbnNpb25zXG4gICAgICAgIGlmIChtYXhEZXB0aCA8PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBNYXggcmVjdXJzaW9uIGRlcHRoIHJlYWNoZWQgYXQgcGF0aEtleT1cIiR7cGF0aEtleX1cImApO1xuICAgICAgICAgICAgcmV0dXJuIHt9IGFzIEh5ZHJhdGVPcHRpb25zTWFwRm9yRW50aXR5PEU+O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW5mZXJyZWQ6IGFueSA9IHt9O1xuXG4gICAgICAgIC8vIExvb3Agb3ZlciBlYWNoIGF0dHJpYnV0ZSBpbiB0aGUgZW50aXR5IHNjaGVtYVxuICAgICAgICBPYmplY3QuZW50cmllcyhzY2hlbWEuYXR0cmlidXRlcykuZm9yRWFjaCgoWyBhdHRyaWJ1dGVOYW1lLCBhdHRyaWJ1dGVNZXRhIF0pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGF0dFZhbCA9IHBhdGhzWyBhdHRyaWJ1dGVOYW1lIF07XG4gICAgICAgICAgICBpZiAoIWF0dFZhbCkge1xuICAgICAgICAgICAgICAgIC8vIE5vdCBzZWxlY3RlZCBpbiB0aGUgdXNlcidzIGF0dHJpYnV0ZXNcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGlzUmVsYXRpb25hbCA9ICEhYXR0cmlidXRlTWV0YS5yZWxhdGlvbjtcblxuICAgICAgICAgICAgLy8gSWYgdGhlIGF0dHJpYnV0ZSBpcyBub3QgcmVsYXRpb25hbCBvciB0aGUgdmFsdWUgaXMgYSBib29sZWFuLCB3ZSBjYW4gaW5mZXIgdGhlIGF0dHJpYnV0ZVxuICAgICAgICAgICAgaWYgKCFpc1JlbGF0aW9uYWwgfHwgaXNCb29sZWFuKGF0dFZhbCkpIHtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gYXR0VmFsO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSXQncyBhIHJlbGF0aW9uYWwgYXR0cmlidXRlOyBwcmVwYXJlIHRvIHJlY3Vyc2VcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uTWV0YSA9IGF0dHJpYnV0ZU1ldGEucmVsYXRpb24hO1xuICAgICAgICAgICAgY29uc3QgbmV4dEVudGl0eU5hbWUgPSByZWxhdGlvbk1ldGEuZW50aXR5TmFtZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBuZXcgXCJwYXRoXCIgc3RyaW5nIHRvIGRldGVjdCBjeWNsZXMgKGUuZy4gXCJVc2VyLmdyb3Vwcy5Hcm91cC5tZW1iZXJzLlVzZXJcIilcbiAgICAgICAgICAgIGNvbnN0IG5ld1BhdGggPSBgJHtwYXRoS2V5fS4ke2F0dHJpYnV0ZU5hbWV9LiR7bmV4dEVudGl0eU5hbWV9YDtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgd2UndmUgYWxyZWFkeSB2aXNpdGVkIHRoaXMgcGF0aCwgaWYgc28gPT4gc2tpcCBleHBhbnNpb25zIGZvciB0aGlzIGF0dHJpYnV0ZSBvbmx5XG4gICAgICAgICAgICBpZiAodmlzaXRlZFBhdGhzLmhhcyhuZXdQYXRoKSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFNraXBwaW5nIGN5YyByZWxhdGlvbiBleHBhbnNpb25zIGZvcjogJHtuZXdQYXRofWApO1xuICAgICAgICAgICAgICAgIGluZmVycmVkWyBhdHRyaWJ1dGVOYW1lIF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IG5leHRFbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBza2lwcGVkRHVlVG9DeWNsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gTWFyayB0aGlzIHBhdGggYXMgdmlzaXRlZFxuICAgICAgICAgICAgdmlzaXRlZFBhdGhzLmFkZChuZXdQYXRoKTtcblxuICAgICAgICAgICAgLy8gUmVjdXJzZSB0byB0aGUgcmVsYXRlZCBlbnRpdHkncyBzY2hlbWFcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lPEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4obmV4dEVudGl0eU5hbWUpO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCB0aGUgXCJtZXRhXCIgb2JqZWN0IHRoYXQgd2Ugc3RvcmVcbiAgICAgICAgICAgIGNvbnN0IG1ldGE6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbiA9IHtcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICByZWxhdGlvblR5cGU6IHJlbGF0aW9uTWV0YS50eXBlLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzOiBpc0Z1bmN0aW9uKHJlbGF0aW9uTWV0YS5pZGVudGlmaWVycylcbiAgICAgICAgICAgICAgICAgICAgPyByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMoKVxuICAgICAgICAgICAgICAgICAgICA6IHJlbGF0aW9uTWV0YS5pZGVudGlmaWVycyxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiB7fSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBjb25zdCBwYXRoU2VsZWN0aW9uQXR0cmlidXRlcyA9IGlzT2JqZWN0KGF0dFZhbCkgPyBhdHRWYWwuYXR0cmlidXRlcyA6IHVuZGVmaW5lZDsgLy8gcHJvdmlkZWQgYnkgdGhlIHVzZXIgXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvblNlbGVjdGlvbkF0dHJpYnV0ZXMgPSByZWxhdGlvbk1ldGEuYXR0cmlidXRlczsgLy8gZGVmaW5lZCBpbiB0aGUgcmVsYXRpb24gZGVmaW5pdGlvblxuICAgICAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eURlZmF1bHRTZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRlZEVudGl0eVNlcnZpY2UuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpOyAvLyBhdXRvIGdlbiBieSBmcmFtZXdvcmtcblxuICAgICAgICAgICAgLy8gUmVjdXJzZSB0byBleHBhbmQgY2hpbGQncyByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICBtZXRhLmF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMoXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNjaGVtYSxcbiAgICAgICAgICAgICAgICAocGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgfHwgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcykgYXMgYW55LFxuICAgICAgICAgICAgICAgIG5leHRFbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHZpc2l0ZWRQYXRocyxcbiAgICAgICAgICAgICAgICBtYXhEZXB0aCAtIDFcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGluZmVycmVkWyBhdHRyaWJ1dGVOYW1lIF0gPSBtZXRhO1xuXG4gICAgICAgICAgICAvLyBSZW1vdmUgdGhpcyBwYXRoIHNvIHNpYmxpbmdzIGNhbiBhbHNvIGV4cGFuZCBpdCBpZiBuZWVkZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5kZWxldGUobmV3UGF0aCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBpbmZlcnJlZDtcbiAgICB9XG5cbiAgICBwdWJsaWMgYXN5bmMgc2VhcmNoKHF1ZXJ5OiBFbnRpdHlTZWFyY2hRdWVyeTxTPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghcXVlcnkuc2VsZWN0KSB7XG4gICAgICAgICAgICAvLyAqIE5vdGU6IHdlIGV4cGVjdCBhbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXNcbiAgICAgICAgICAgIHF1ZXJ5LnNlbGVjdCA9IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCkgYXMgYW55O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlLnNlYXJjaChxdWVyeSwgdW5kZWZpbmVkLCBjdHgpO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoYXR0SWQ6IHN0cmluZywgYXR0OiBFbnRpdHlBdHRyaWJ1dGUpOiBQYXJ0aWFsPEVudGl0eUF0dHJpYnV0ZT4gJiB7XG4gICAgaWQ6IHN0cmluZyxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgcHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdXG59IHtcblxuICAgIGNvbnN0IHsgbmFtZSwgdmFsaWRhdGlvbnMsIHJlcXVpcmVkLCByZWxhdGlvbiwgZGVmYXVsdDogZGVmYXVsdFZhbHVlLCBnZXQ6IF9nZXR0ZXIsIHNldDogX3NldHRlciwgd2F0Y2gsIC4uLnJlc3RNZXRhIH0gPSBhdHQ7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lLCAuLi5yZXN0UmVsYXRpb24gfSA9IHJlbGF0aW9uIHx8IHt9O1xuXG4gICAgY29uc3QgcmVsYXRpb25NZXRhID0gcmVsYXRlZEVudGl0eU5hbWUgPyB7IC4uLnJlc3RSZWxhdGlvbiwgZW50aXR5TmFtZTogcmVsYXRlZEVudGl0eU5hbWUgfSA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IHsgaXRlbXMsIHR5cGUsIHByb3BlcnRpZXMsIGFkZE5ld09wdGlvbiwgYWRkTmV3T3B0aW9uQ29uZmlnLCAuLi5yZXN0UmVzdE1ldGEgfSA9IHJlc3RNZXRhIGFzIGFueTtcblxuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi5yZXN0UmVzdE1ldGEsXG4gICAgICAgIHR5cGUsXG4gICAgICAgIGlkOiBhdHRJZCxcbiAgICAgICAgbmFtZTogbmFtZSB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKGF0dElkKSxcbiAgICAgICAgcmVsYXRpb246IHJlbGF0aW9uTWV0YSBhcyBhbnksXG4gICAgICAgIGRlZmF1bHRWYWx1ZSxcbiAgICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25zIHx8IHJlcXVpcmVkID8gWyAncmVxdWlyZWQnIF0gOiBbXSxcbiAgICAgICAgaXNWaXNpYmxlOiAhKCdpc1Zpc2libGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzVmlzaWJsZSxcbiAgICAgICAgaXNFZGl0YWJsZTogISgnaXNFZGl0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNFZGl0YWJsZSxcbiAgICAgICAgaXNMaXN0YWJsZTogISgnaXNMaXN0YWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNMaXN0YWJsZSxcbiAgICAgICAgaXNDcmVhdGFibGU6ICEoJ2lzQ3JlYXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0NyZWF0YWJsZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiAhKCdpc0ZpbHRlcmFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzRmlsdGVyYWJsZSxcbiAgICAgICAgaXNTZWFyY2hhYmxlOiAhKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzU2VhcmNoYWJsZSxcbiAgICB9XG5cbiAgICAvLyBQYXNzIHRocm91Z2ggYm90aCBvbGQgYW5kIG5ldyBhZGROZXdPcHRpb24gZm9ybWF0c1xuICAgIGlmIChhZGROZXdPcHRpb25Db25maWcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0gYWRkTmV3T3B0aW9uQ29uZmlnO1xuICAgIH1cbiAgICBpZiAoYWRkTmV3T3B0aW9uKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbicgXSA9IGFkZE5ld09wdGlvbjtcbiAgICB9XG5cbiAgICAvL1xuICAgIC8vICoqIG1ha2Ugc3VyZSB0byBub3Qgb3ZlcnJpZGUgdGhlIGlubmVyIGZpZWxkcyBvZiBhdHRyaWJ1dGVzIGxpa2UgYGxpc3QtW2l0ZW1zXS1bbWFwXS1wcm9wZXJ0aWVzYCAqKlxuICAgIC8vXG4gICAgaWYgKHR5cGUgPT09ICdtYXAnKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBPYmplY3QuZW50cmllczxhbnk+KHByb3BlcnRpZXMpLm1hcCgoWyBrLCB2IF0pID0+IGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaywgdikpO1xuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ2xpc3QnICYmIGl0ZW1zLnR5cGUgPT09ICdtYXAnKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ2l0ZW1zJyBdID0ge1xuICAgICAgICAgICAgLi4uaXRlbXMsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiBPYmplY3QuZW50cmllczxhbnk+KGl0ZW1zLnByb3BlcnRpZXMpLm1hcCgoWyBrLCB2IF0pID0+IGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaywgdikpXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVE9ETzogYWRkIHN1cHBvcnQgZm9yIHNldCwgZW51bSwgYW5kIGN1c3RvbS10eXBlc1xuXG4gICAgcmV0dXJuIGZvcm1hdHRlZFxufVxuXG5leHBvcnQgdHlwZSBUSU9TY2hlbWFBdHRyaWJ1dGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlPjtcbmV4cG9ydCB0eXBlIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gPSBNYXA8a2V5b2YgU1sgJ2F0dHJpYnV0ZXMnIF0sIFRJT1NjaGVtYUF0dHJpYnV0ZT47XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhY2Nlc3MgcGF0dGVybnMgc2NoZW1hIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBlbnRpdHkgc2NoZW1hLlxuICogQHBhcmFtIHNjaGVtYSBUaGUgZW50aXR5IHNjaGVtYS5cbiAqIEByZXR1cm5zIEEgbWFwIG9mIGFjY2VzcyBwYXR0ZXJucywgd2hlcmUgdGhlIGtleXMgYXJlIHRoZSBpbmRleCBuYW1lcyBhbmQgdGhlIHZhbHVlcyBhcmUgbWFwcyBvZiBhdHRyaWJ1dGUgbmFtZXMgYW5kIHRoZWlyIGNvcnJlc3BvbmRpbmcgc2NoZW1hIGF0dHJpYnV0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oc2NoZW1hOiBTKSB7XG4gICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBuZXcgTWFwPGtleW9mIFNbICdpbmRleGVzJyBdLCBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+PigpO1xuXG4gICAgZm9yIChjb25zdCBpbmRleE5hbWUgaW4gc2NoZW1hLmluZGV4ZXMpIHtcbiAgICAgICAgY29uc3QgaW5kZXhBdHRyaWJ1dGVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+ID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgaWR4UGtBdHQgb2Ygc2NoZW1hLmluZGV4ZXNbIGluZGV4TmFtZSBdLnBrLmNvbXBvc2l0ZSkge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGlkeFBrQXR0IF07XG4gICAgICAgICAgICBpbmRleEF0dHJpYnV0ZXMuc2V0KGlkeFBrQXR0LCB7XG4gICAgICAgICAgICAgICAgLi4uZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShpZHhQa0F0dCwgeyAuLi5hdHQsIHJlcXVpcmVkOiB0cnVlIH0pXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgaWR4U2tBdHQgb2Ygc2NoZW1hLmluZGV4ZXNbIGluZGV4TmFtZSBdLnNrPy5jb21wb3NpdGUgPz8gW10pIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBpZHhTa0F0dCBdO1xuICAgICAgICAgICAgaW5kZXhBdHRyaWJ1dGVzLnNldChpZHhTa0F0dCwge1xuICAgICAgICAgICAgICAgIC4uLmVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGUoaWR4U2tBdHQsIHsgLi4uYXR0LCByZXF1aXJlZDogdHJ1ZSB9KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBhY2Nlc3NQYXR0ZXJucy5zZXQoaW5kZXhOYW1lLCBpbmRleEF0dHJpYnV0ZXMpO1xuICAgIH1cblxuICAgIC8vIG1ha2Ugc3VyZSB0aGVyZSdzIGEgcHJpbWFyeSBhY2Nlc3MgcGF0dGVybjtcbiAgICBpZiAoIWFjY2Vzc1BhdHRlcm5zLmhhcygncHJpbWFyeScpKSB7XG4gICAgICAgIGFjY2Vzc1BhdHRlcm5zLnNldCgncHJpbWFyeScsIGFjY2Vzc1BhdHRlcm5zLnZhbHVlcygpLm5leHQoKS52YWx1ZSEpO1xuICAgIH1cblxuICAgIHJldHVybiBhY2Nlc3NQYXR0ZXJucztcbn1cbiJdfQ==