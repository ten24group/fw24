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
            if (formattedAtt.isVisible) {
                outputSchemaAttributes.detail.set(attName, { ...formattedAtt });
            }
            if (formattedAtt.isListable) {
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
            this.logger.warn('BaseEntityService: No actor context found, skipping injection');
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
     * @returns The created-OR-updated entity.
     */
    async upsert(payload) {
        this.logger.debug(`Called ~ upsert ~ entityName: ${this.getEntityName()} ~ payload:`, payload);
        const entity = await (0, crud_service_1.upsertEntity)({
            data: payload,
            entityName: this.getEntityName(),
            entityService: this,
        });
        return entity;
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
    const { items, type, properties, addNewOption, ...restRestMeta } = restMeta;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBOEJBLG9DQUVDO0FBRUQsa0RBR0M7QUFFRCx3Q0FFQztBQUVELGdEQWdCQztBQWluREQsZ0ZBaURDO0FBVUQsd0VBNkJDO0FBbndERCw4QkFBb0M7QUFPcEMsd0NBQTBDO0FBQzFDLGlEQUE0RTtBQUU1RSx5REFBbUU7QUFDbkUsb0NBQWlOO0FBQ2pOLCtDQUFzRDtBQUN0RCxpREFBbUs7QUFDbkssdUVBQWtFO0FBQ2xFLHFDQUFnRTtBQUNoRSxtQ0FBNEg7QUFDNUgsc0NBQTZEO0FBWTdELFNBQWdCLFlBQVksQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQ25GLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxTQUFnQixtQkFBbUIsQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQzFGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDbkQsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFFBQVEsS0FBSyxJQUFJLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFDMUYsT0FBTyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssU0FBUyxDQUFDO0FBQzFELENBQUM7QUFFRCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFtQyxFQUFFLElBQTBCO0lBRTlGLElBQUksY0FBYyxHQUFHLFNBQVMsSUFBQSxrQkFBVSxFQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7SUFDMUQsSUFBSSxjQUFjLElBQUksTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2pDLE9BQU8sTUFBTSxDQUFD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RSxFQUFFLENBQUM7WUFDckUsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBRSxRQUFRLENBQUUsQ0FBQztZQUMxQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRTtnQkFDMUIsR0FBRyxrQ0FBa0MsQ0FBQyxRQUFRLEVBQUUsRUFBRSxHQUFHLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7YUFDOUUsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUVELGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBTSxDQUFDLENBQUM7SUFDekUsQ0FBQztJQUVELE9BQU8sY0FBYyxDQUFDO0FBQzFCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gXCIuLi9kaVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlJbnB1dFZhbGlkYXRpb25zLCBFbnRpdHlWYWxpZGF0aW9ucyB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSwgRW50aXR5QXR0cmlidXRlLCBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hLCBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYSwgRW50aXR5VHlwZUZyb21TY2hlbWEgYXMgRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEsIEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHksIEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbiwgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHksIFJlbGF0aW9uSWRlbnRpZmllciwgU3BlY2lhbEF0dHJpYnV0ZVR5cGUsIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlGaWx0ZXJDcml0ZXJpYSwgRW50aXR5UXVlcnksIEVudGl0eVNlbGVjdGlvbnMsIFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcblxuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tIFwiLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHsgRGVwSWRlbnRpZmllciwgSURJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBCYXNlU2VhcmNoU2VydmljZSwgRW50aXR5U2VhcmNoU2VydmljZSB9IGZyb20gJy4uL3NlYXJjaC9zZXJ2aWNlcyc7XG5pbXBvcnQgeyBFbnRpdHlTZWFyY2hRdWVyeSB9IGZyb20gJy4uL3NlYXJjaC90eXBlcyc7XG5pbXBvcnQgeyBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lIH0gZnJvbSAnLi4vc2VhcmNoL3NlYXJjaC11dGlscyc7XG5pbXBvcnQgeyBKc29uU2VyaWFsaXplciwgZ2V0VmFsdWVCeVBhdGgsIGlzQXJyYXksIGlzQm9vbGVhbiwgaXNDbGFzc0NvbnN0cnVjdG9yLCBpc0VtcHR5LCBpc0VtcHR5T2JqZWN0RGVlcCwgaXNGdW5jdGlvbiwgaXNPYmplY3QsIGlzU3RyaW5nLCBwYXNjYWxDYXNlLCBwaWNrS2V5cywgdG9IdW1hblJlYWRhYmxlTmFtZSwgdG9TbHVnIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBjcmVhdGVFbGVjdHJvREJFbnRpdHkgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHsgVXBkYXRlRW50aXR5T3BlcmF0b3JzLCBjcmVhdGVFbnRpdHksIGRlbGV0ZUVudGl0eSwgZ2V0QmF0Y2hFbnRpdHksIGdldEVudGl0eSwgbGlzdEVudGl0eSwgcXVlcnlFbnRpdHksIHVwZGF0ZUVudGl0eSwgdXBzZXJ0RW50aXR5IH0gZnJvbSBcIi4vY3J1ZC1zZXJ2aWNlXCI7XG5pbXBvcnQgeyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IgfSBmcm9tIFwiLi9lbnRpdHktc2NoZW1hLXZhbGlkYXRvclwiO1xuaW1wb3J0IHsgRGF0YWJhc2VFcnJvciwgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhLCBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcywgcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgeyBJbnRlcm5hbFNlcnZlckVycm9yLCBTZXJ2ZXJFcnJvciB9IGZyb20gXCIuLi9lcnJvcnNcIjtcblxuZXhwb3J0IHR5cGUgRXh0cmFjdEVudGl0eUlkZW50aWZpZXJzQ29udGV4dCA9IHtcbiAgICAvLyB0ZW5hbnRJZDogc3RyaW5nLCBcbiAgICBmb3JBY2Nlc3NQYXR0ZXJuPzogc3RyaW5nXG59XG5cbnR5cGUgR2V0T3B0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgIGF0dHJpYnV0ZXM/OiBFbnRpdHlTZWxlY3Rpb25zPFM+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGUoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiAoYXR0cmlidXRlTmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhdHRyaWJ1dGUgPSBzY2hlbWEuYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXTtcbiAgICByZXR1cm4gISEoYXR0cmlidXRlICYmIGF0dHJpYnV0ZS5yZWFkT25seSA9PT0gdHJ1ZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcbiAgICByZXR1cm4gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgc3BlYykgIT09IHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcblxuICAgIGxldCBzcGVjQXR0TWV0YUtleSA9IGBlbnRpdHkke3Bhc2NhbENhc2Uoc3BlYyl9QXR0cmlidXRlYDtcbiAgICBpZiAoc3BlY0F0dE1ldGFLZXkgaW4gc2NoZW1hLm1vZGVsKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWEubW9kZWxbIHNwZWNBdHRNZXRhS2V5IGFzIGtleW9mIHR5cGVvZiBzY2hlbWEubW9kZWwgXSBhcyBzdHJpbmc7XG4gICAgfVxuXG4gICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsIGAke3NjaGVtYS5tb2RlbC5lbnRpdHl9JHtwYXNjYWxDYXNlKHNwZWMpfWApKSB7XG4gICAgICAgIHJldHVybiBgJHtzY2hlbWEubW9kZWwuZW50aXR5fSR7cGFzY2FsQ2FzZShzcGVjKX1gO1xuICAgIH1cblxuICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCBzcGVjKSkge1xuICAgICAgICByZXR1cm4gc3BlYztcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZUVudGl0eVNlcnZpY2U8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuXG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKGBCYXNlRW50aXR5U2VydmljZToke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKTtcblxuICAgIHByb3RlY3RlZCBlbnRpdHlSZXBvc2l0b3J5PzogRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgIHByb3RlY3RlZCBlbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE/OiBSZXR1cm5UeXBlPHR5cGVvZiB0aGlzLm1ha2VPcHNEZWZhdWx0SU9TY2hlbWE8Uz4+O1xuXG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHJlYWRvbmx5IHNjaGVtYTogUyxcbiAgICAgICAgcHJvdGVjdGVkIHJlYWRvbmx5IGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uLFxuICAgICAgICBwcm90ZWN0ZWQgcmVhZG9ubHkgZGlDb250YWluZXI6IElESUNvbnRhaW5lciA9IERJQ29udGFpbmVyLlJPT1QsXG4gICAgKSB7IH1cblxuICAgIHByb3RlY3RlZCBnZXRUYWJsZU5hbWUoKTogc3RyaW5nIHtcbiAgICAgICAgaWYgKCF0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcihgVGFibGUgbmFtZSBpcyByZXF1aXJlZCBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlO1xuICAgIH1cblxuXG4gICAgcHVibGljIGdldEVudGl0eVNlYXJjaENvbmZpZyhfY3R4PzogRXhlY3V0aW9uQ29udGV4dDxhbnk+KSB7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzY2hlbWEubW9kZWwuc2VhcmNoIHx8IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBpbmRleENvbmZpZzoge31cbiAgICAgICAgfTtcblxuICAgICAgICBzZWFyY2hDb25maWcuc2VydmljZUNsYXNzID0gc2VhcmNoQ29uZmlnLnNlcnZpY2VDbGFzcyB8fCBFbnRpdHlTZWFyY2hTZXJ2aWNlO1xuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5pbmRleE5hbWUgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuaW5kZXhOYW1lIHx8IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogdGhpcy5nZXRUYWJsZU5hbWUoKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnByaW1hcnlLZXkgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcucHJpbWFyeUtleSB8fCB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eVNlYXJjaGFibGVBdHRyaWJ1dGVzID0gdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcbiAgICAgICAgY29uc3QgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMgPSB0aGlzLmdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncyA9IHtcbiAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3MgfHwge30pLFxuICAgICAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5zZWFyY2hhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlTZWFyY2hhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgZmlsdGVyYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgc29ydGFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uc29ydGFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VhcmNoQ29uZmlnO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiBzZWFyY2ggaXMgZW5hYmxlZCBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUcnVlIGlmIHNlYXJjaCBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG4gICAgICovXG4gICAgcHVibGljIGlzU2VhcmNoRW5hYmxlZCgpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcbiAgICAgICAgcmV0dXJuIEJvb2xlYW4oc2VhcmNoQ29uZmlnPy5lbmFibGVkKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIHRoZSBzZWFyY2ggc2VydmljZSBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgc2VhcmNoIHNlcnZpY2UuXG4gICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaFNlcnZpY2UoKTogRW50aXR5U2VhcmNoU2VydmljZTxTPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldEVudGl0eVNlYXJjaENvbmZpZygpO1xuXG4gICAgICAgICAgICAvLyBTa2lwIHNlYXJjaCBsb2dpYyBpZiBzZWFyY2ggaXMgbm90IGVuYWJsZWRcbiAgICAgICAgICAgIGlmICghc2VhcmNoQ29uZmlnPy5lbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggaXMgbm90IGVuYWJsZWQgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfS5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgc2VhcmNoIGNvbmZpZ3VyYXRpb24gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVTZWFyY2hDb25maWcoc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9IHNlYXJjaENvbmZpZz8uc2VydmljZUNsYXNzO1xuXG4gICAgICAgICAgICAvLyBDYXNlIDE6IERJIENvbnRhaW5lciBoYXMgdGhlIHNlcnZpY2VcbiAgICAgICAgICAgIGlmIChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzICYmIHRoaXMuZGlDb250YWluZXIuaGFzKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT4+KSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmU8RW50aXR5U2VhcmNoU2VydmljZTxTPj4oc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyBEZXBJZGVudGlmaWVyPEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4+KTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHJlc29sdmUgc2VhcmNoIHNlcnZpY2UgZnJvbSBjb250YWluZXI6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVzb2x2ZSBzZWFyY2ggc2VydmljZSBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2FzZSAyOiBTZXJ2aWNlIGluc3RhbmNlIHByb3ZpZGVkXG4gICAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBpbnN0YW5jZW9mIEJhc2VTZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3M7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhc2UgMzogU2VydmljZSBjbGFzcyBwcm92aWRlZFxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGlzQ2xhc3NDb25zdHJ1Y3RvcihzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzKSAmJlxuICAgICAgICAgICAgICAgIChcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9PT0gRW50aXR5U2VhcmNoU2VydmljZVxuICAgICAgICAgICAgICAgICAgICB8fFxuICAgICAgICAgICAgICAgICAgICBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzLnByb3RvdHlwZSBpbnN0YW5jZW9mIEVudGl0eVNlYXJjaFNlcnZpY2VcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCB0byBjb25maWd1cmUgdGhpcyB3aXRob3V0IG5lZWRpbmcgdG8gdXNlIHRoZSBESVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hFbmdpbmUgPSB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVTZWFyY2hFbmdpbmUoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzZWFyY2hFbmdpbmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGVuZ2luZSBub3QgZm91bmQgaW4gY29udGFpbmVyJyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyB0eXBlb2YgRW50aXR5U2VhcmNoU2VydmljZSkoXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2VhcmNoRW5naW5lLFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFudGlhdGUgc2VhcmNoIHNlcnZpY2U6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIHNlYXJjaCBzZXJ2aWNlIGluc3RhbmNlIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHZhbGlkIHNlYXJjaC1zZXJ2aWNlLWNvbmZpZ3VyYXRpb24gZm91bmQgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciBpbiBnZXRTZWFyY2hTZXJ2aWNlOicsIGVycik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIGluaXRpYWxpemF0aW9uIGZhaWxlZCBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB2YWxpZGF0ZVNlYXJjaENvbmZpZyhzZWFyY2hDb25maWc6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PlsgJ21vZGVsJyBdWyAnc2VhcmNoJyBdKSB7XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIG11c3QgaW5jbHVkZSBhIGNvbmZpZyBvYmplY3QnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgaW5kZXhDb25maWc6IGNvbmZpZyB9ID0gc2VhcmNoQ29uZmlnO1xuXG4gICAgICAgIGlmICghY29uZmlnLmluZGV4TmFtZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBtdXN0IHNwZWNpZnkgYW4gaW5kZXhOYW1lJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBzZWFyY2hhYmxlIGF0dHJpYnV0ZXMgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb25maWcuc2V0dGluZ3M/LnNlYXJjaGFibGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IGNvbmZpZy5zZXR0aW5ncy5zZWFyY2hhYmxlQXR0cmlidXRlcy5maWx0ZXIoXG4gICAgICAgICAgICAgICAgKGF0dHI6IHN0cmluZykgPT4gIWhhc0F0dHJpYnV0ZSh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBhdHRyKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNlYXJjaGFibGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBjb25maWcuc2V0dGluZ3MuZmlsdGVyYWJsZUF0dHJpYnV0ZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIChhdHRyOiBzdHJpbmcpID0+ICFoYXNBdHRyaWJ1dGUodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgYXR0cilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmaWx0ZXJhYmxlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyB0cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eTogRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICByZXR1cm4gYXdhaXQgc2VhcmNoU2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG4gICAgfVxuXG4gICAgcHVibGljIHZhbGlkYXRlRW50aXR5U2NoZW1hKCkge1xuICAgICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgRW50aXR5U2NoZW1hVmFsaWRhdG9yKHRoaXMuZGlDb250YWluZXIpO1xuICAgICAgICB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoXG4gICAgICAgICAgICB0aGlzLmdldEVudGl0eVNjaGVtYSgpLFxuICAgICAgICAgICAgdGhpcy5lbnRpdHlDb25maWd1cmF0aW9uc1xuICAgICAgICApO1xuICAgIH1cblxuICAgIGdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWU8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlRW50aXR5U2VydmljZTxCYXNlRW50aXR5U2VydmljZTxUPj4ocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTZXJ2aWNlKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBnZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlRW50aXR5U2NoZW1hPFQ+KHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dHJhY3RzIGVudGl0eSBpZGVudGlmaWVycyBmcm9tIHRoZSBpbnB1dCBvYmplY3QgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGNvbnRleHQgdG8gZnVsZmlsbCBhbiBpbmRleC5cbiAgICAgKiBlLmcuIGVudGl0eUlkLCB0ZW5hbnRJZCwgcGFydGl0aW9uLWtleXMuLi4uIGV0Y1xuICAgICAqIGl0IGlzIHVzZWQgYnkgdGhlIGBCYXNlRW50aXR5U2VydmljZWAgdG8gZmluZCB0aGUgcmlnaHQgZW50aXR5IGZvciBgZ2V0YC9gdXBkYXRlYC9gZGVsZXRlYCBvcGVyYXRpb25zXG4gICAgICogXG4gICAgICogQHRlbXBsYXRlIFMgLSBUaGUgdHlwZSBvZiB0aGUgZW50aXR5IHNjaGVtYS5cbiAgICAgKiBAcGFyYW0gaW5wdXQgLSBUaGUgaW5wdXQgb2JqZWN0IGZyb20gd2hpY2ggdG8gZXh0cmFjdCB0aGUgaWRlbnRpZmllcnMuXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgY29udGFpbmluZyBhZGRpdGlvbmFsIGluZm9ybWF0aW9uIGZvciBleHRyYWN0aW9uLlxuICAgICAqIEBwYXJhbSBjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4gLSBUaGUgYWNjZXNzIHBhdHRlcm4gZm9yIHdoaWNoIHRvIGV4dHJhY3QgdGhlIGlkZW50aWZpZXJzLlxuICAgICAqIEByZXR1cm5zIFRoZSBleHRyYWN0ZWQgZW50aXR5IGlkZW50aWZpZXJzLlxuICAgICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgaW5wdXQgaXMgbWlzc2luZyBvciBub3QgYW4gb2JqZWN0LlxuICAgICAqIFxuICAgICAqIGUuZy4gXG4gICAgICogSU4gICA9PT4gYFJlcXVlc3RgIG9iamVjdCB3aXRoIGhlYWRlcnMsIGJvZHksIGF1dGgtY29udGV4dCBldGNcbiAgICAgKiBPVVQgID09PiB7IHRlbmFudElkOiB4eHgsIGVtYWlsOiB4eHhAeXl5LmNvbSwgc29tZS1wYXJ0aXRpb24ta2V5OiB4eC15eS16eiB9XG4gICAgICpcbiAgICAgKi9cbiAgICBleHRyYWN0RW50aXR5SWRlbnRpZmllcnMoXG4gICAgICAgIGlucHV0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgc3RyaW5nPj4sXG4gICAgICAgIGNvbnRleHQ6IEV4dHJhY3RFbnRpdHlJZGVudGlmaWVyc0NvbnRleHQgPSB7XG4gICAgICAgICAgICAvLyB0ZW5hbnRJZDogJ3h4eC15eXktenp6J1xuICAgICAgICB9XG4gICAgKTogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+IHtcblxuICAgICAgICBpZiAoIWlucHV0IHx8IHR5cGVvZiBpbnB1dCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW5wdXQgaXMgcmVxdWlyZWQgYW5kIG11c3QgYmUgYW4gb2JqZWN0IGNvbnRhaW5pbmcgZW50aXR5LWlkZW50aWZpZXJzIG9yIGFuIGFycmF5IG9mIG9iamVjdHMgY29udGFpbmluZyBlbnRpdHktaWRlbnRpZmllcnMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlzQmF0Y2hJbnB1dCA9IGlzQXJyYXkoaW5wdXQpO1xuXG4gICAgICAgIGNvbnN0IGlucHV0cyA9IGlzQmF0Y2hJbnB1dCA/IGlucHV0IDogWyBpbnB1dCBdO1xuXG4gICAgICAgIC8vIFRPRE86IHRlbmFudCBsb2dpY1xuICAgICAgICAvLyBpZGVudGlmaWVyc1sndGVuYW50SWQnXSA9IGlucHV0LnRlbmFudElkIHx8IGNvbnRleHQudGVuYW50SWQ7XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWEodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSk7XG5cbiAgICAgICAgY29uc3QgaWRlbnRpZmllckF0dHJpYnV0ZXMgPSBuZXcgU2V0PHsgbmFtZTogc3RyaW5nLCByZXF1aXJlZDogYm9vbGVhbiB9PigpO1xuICAgICAgICBmb3IgKGNvbnN0IFsgYWNjZXNzUGF0dGVybk5hbWUsIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzIF0gb2YgYWNjZXNzUGF0dGVybnMpIHtcbiAgICAgICAgICAgIGlmICghY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuIHx8IGFjY2Vzc1BhdHRlcm5OYW1lID09IGNvbnRleHQuZm9yQWNjZXNzUGF0dGVybikge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIGF0dCBdIG9mIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJBdHRyaWJ1dGVzLmFkZCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBhdHQuaWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogYXR0LnJlcXVpcmVkID09IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcHJpbWFyeUF0dE5hbWUgPSB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzQmF0Y2ggPSBpbnB1dHMubWFwKGlucHV0ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBhbnkgPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lOiBhdHROYW1lLCByZXF1aXJlZCB9IG9mIGlkZW50aWZpZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKChhdHROYW1lIGluIGlucHV0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyc1sgYXR0TmFtZSBdID0gaW5wdXRbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGF0dE5hbWUgPT0gcHJpbWFyeUF0dE5hbWUgJiYgKCdpZCcgaW4gaW5wdXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzWyBhdHROYW1lIF0gPSBpbnB1dC5pZDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlcXVpcmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYHJlcXVpcmVkIGF0dHJpYnV0ZTogJHthdHROYW1lfSBmb3IgYWNjZXNzLXBhdHRlcm46ICR7Y29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuID8/ICctLXByaW1hcnktLSd9IGlzIG5vdCBmb3VuZCBpbiBpbnB1dDpgLCBpbnB1dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGlkZW50aWZpZXJzIGFzIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz47XG4gICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRXh0cmFjdGluZyBpZGVudGlmaWVycyBmcm9tIGlkZW50aWZpZXJzOicsIGlkZW50aWZpZXJzQmF0Y2gpO1xuXG4gICAgICAgIHJldHVybiBpc0JhdGNoSW5wdXQgPyBpZGVudGlmaWVyc0JhdGNoIDogaWRlbnRpZmllcnNCYXRjaFsgMCBdO1xuICAgIH07XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5TmFtZSgpOiBTWyAnbW9kZWwnIF1bICdlbnRpdHknIF0geyByZXR1cm4gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKS5tb2RlbC5lbnRpdHk7IH1cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlTY2hlbWEoKTogUyB7IHJldHVybiB0aGlzLnNjaGVtYTsgfVxuXG4gICAgcHVibGljIGdldFJlcG9zaXRvcnkoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlSZXBvc2l0b3J5KSB7XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eSB9ID0gY3JlYXRlRWxlY3Ryb0RCRW50aXR5KHtcbiAgICAgICAgICAgICAgICBzY2hlbWE6IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5lbnRpdHlSZXBvc2l0b3J5ID0gZW50aXR5IGFzIEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eVJlcG9zaXRvcnkhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBsYWNlaG9sZGVyIGZvciB0aGUgZW50aXR5IHZhbGlkYXRpb25zOyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgeW91ciBvd24gdmFsaWRhdGlvbnNcbiAgICAgKiBAcmV0dXJucyBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgZW50aXR5IHZhbGlkYXRpb25zLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRFbnRpdHlWYWxpZGF0aW9ucygpOiBFbnRpdHlWYWxpZGF0aW9uczxTPiB8IEVudGl0eUlucHV0VmFsaWRhdGlvbnM8Uz4ge1xuICAgICAgICByZXR1cm4ge307XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFBsYWNlaG9sZGVyIGZvciB0aGUgY3VzdG9tIHZhbGlkYXRpb24tZXJyb3ItbWVzc2FnZXM7IG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSB5b3VyIG93biBlcnJvci1tZXNzYWdlcy5cbiAgICAgKiBAcmV0dXJucyBBIG1hcCBjb250YWluaW5nIHRoZSBjdXN0b20gdmFsaWRhdGlvbi1lcnJvci1tZXNzYWdlcy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHRzXG4gICAgICogIHB1YmxpYyBhc3luYyBnZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgICogICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCBuZXcgTWFwPHN0cmluZywgc3RyaW5nPiggXG4gICAgICogICAgICAgICAgT2JqZWN0LmVudHJpZXMoeyBcbiAgICAgKiAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24uZW1haWwucmVxdWlyZWQnOiAnRW1haWwgaXMgcmVxdWlyZWQhISEhIScsIFxuICAgICAqICAgICAgICAgICAgICAndmFsaWRhdGlvbi5wYXNzd29yZC5yZXF1aXJlZCc6ICdQYXNzd29yZCBpcyByZXF1aXJlZCEhISEhJ1xuICAgICAqICAgICAgICAgIH0pXG4gICAgICogICAgICApKTtcbiAgICAgKiB9XG4gICAgICogYGBgXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCkge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChhdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF0dE5hbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICogR2VuZXJhdGVzIHRoZSBkZWZhdWx0IGlucHV0IGFuZCBvdXRwdXQgc2NoZW1hcyBmb3IgdmFyaW91cyBvcGVyYXRpb25zIG9mIGFuIGVudGl0eS5cbiAqIFxuICogQHRlbXBsYXRlIFMgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wcyAtIFRoZSB0eXBlIG9mIGVudGl0eSBvcGVyYXRpb25zLlxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gVGhlIGVudGl0eSBzY2hlbWEuXG4gKiBAcmV0dXJucyBUaGUgZGVmYXVsdCBpbnB1dCBhbmQgb3V0cHV0IHNjaGVtYXMgZm9yIHRoZSBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuICAgIHByb3RlY3RlZCBtYWtlT3BzRGVmYXVsdElPU2NoZW1hPFxuICAgICAgICBTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIE9wcz4sXG4gICAgICAgIE9wcyBleHRlbmRzIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyA9IFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICA+KHNjaGVtYTogUykge1xuXG4gICAgICAgIGNvbnN0IGlucHV0U2NoZW1hQXR0cmlidXRlcyA9IHtcbiAgICAgICAgICAgIGNyZWF0ZTogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgICAgICB1cGRhdGU6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICAgICBkZXRhaWw6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICAgICAgbGlzdDogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gY3JlYXRlIGFuZCB1cGRhdGVcbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG5cbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWRBdHQgPSBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGF0dE5hbWUsIGF0dCk7XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaGlkZGVuKSB7XG4gICAgICAgICAgICAgICAgLy8gaWYgaXQncyBtYXJrZWQgYXMgaGlkZGVuIGl0J3Mgbm90IHZpc2libGUgdG8gYW55IG9wXG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNWaXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzTGlzdGFibGUpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3Quc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzQ3JlYXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNFZGl0YWJsZSkge1xuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWEoc2NoZW1hKTtcblxuICAgICAgICAvLyBpZiB0aGVyZSdzIGFuIGluZGV4IG5hbWVkIGBwcmltYXJ5YCwgdXNlIHRoYXQsIGVsc2UgZmFsbGJhY2sgdG8gZmlyc3QgaW5kZXhcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2RlbGV0ZSddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcblxuXG4gICAgICAgIC8vIGZvcihjb25zdCBhcCBvZiBhY2Nlc3NQYXR0ZXJucy5rZXlzKCkpe1xuICAgICAgICAvLyBcdGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzW2BnZXRfJHthcH1gXSA9IGFjY2Vzc1BhdHRlcm5zLmdldChhcCk7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGRlbGV0ZV8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIC8vIGNvbnN0IGlucHV0U2NoZW1hQXR0cmlidXRlczogYW55ID0ge307XHRcbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWydjcmVhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddLFxuICAgICAgICAvLyB9XG4gICAgICAgIC8vIGlucHV0U2NoZW1hQXR0cmlidXRlc1sndXBkYXRlJ10gPSB7XG4gICAgICAgIC8vIFx0J2lkZW50aWZpZXJzJzogYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddLFxuICAgICAgICAvLyBcdCdkYXRhJzogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSxcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5Jyk7XG5cbiAgICAgICAgLy8gVE9ETzogYWRkIHNjaGVtYSBmb3IgdGhlIHJlc3QgZm8gdGhlIHNlY29uZGFyeSBhY2Nlc3MtcGF0dGVybnNcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZ2V0OiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGR1cGxpY2F0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVybixcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLCAvLyBkZWZhdWx0IGZvciB0aGUgZGV0YWlsIHBhZ2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZWxldGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm5cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjcmVhdGU6IHtcbiAgICAgICAgICAgICAgICBpbnB1dDogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZSxcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdXBkYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMudXBkYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbGlzdDoge1xuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5saXN0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGRlZmF1bHQgaW5wdXQvb3V0cHV0IHNjaGVtYSBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gICAgICogXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hKSB7XG4gICAgICAgICAgICB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYSA9IHRoaXMubWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxTPih0aGlzLmdldEVudGl0eVNjaGVtYSgpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhbiBhcnJheSBvZiBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLiBVc2VkIGJ5IHRoZSBgZGV0YWlsYCBBUEkgdG8gc2VyaWFsaXplIHRoZSBlbnRpdHkuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTogRW50aXR5U2VsZWN0aW9uczxTPiB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwID0gdGhpcy5nZXRPcHNEZWZhdWx0SU9TY2hlbWEoKS5nZXQub3V0cHV0O1xuXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXM6IGFueSA9IHt9O1xuICAgICAgICBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5mb3JFYWNoKChfLCBrZXkpID0+IHtcbiAgICAgICAgICAgIC8vIGlmICghdmFsLnJlbGF0aW9uIHx8IHZhbC5yZWxhdGlvbi5oeWRyYXRlKSB7XG4gICAgICAgICAgICAvLyB9XG4gICAgICAgICAgICBhdHRyaWJ1dGVzWyBrZXkgXSA9IHRydWVcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZXMgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcblxuICAgICAgICAvLyAgcmV0dXJuIEFycmF5LmZyb20oIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSApIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhdHRyaWJ1dGUgbmFtZXMgZm9yIGxpc3RpbmcgYW5kIHNlYXJjaCBBUEkuIERlZmF1bHRzIHRvIHRoZSBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLlxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBBbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmxpc3Qub3V0cHV0O1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbShkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5rZXlzKCkpIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2guIERlZmF1bHRzIHRvIGFsbCBzdHJpbmcgYXR0cmlidXRlcyB3aGljaCBhcmUgbm90IGhpZGRlbiBhbmQgYXJlIG5vdCBpZGVudGlmaWVycy5cbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gYXR0cmlidXRlIG5hbWVzIHRvIGJlIHVzZWQgZm9yIGtleXdvcmQgc2VhcmNoXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk6IEFycmF5PHN0cmluZz4ge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGlmICghYXR0LmhpZGRlbiAmJiAhYXR0LmlzSWRlbnRpZmllciAmJiBhdHQudHlwZSA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICghKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgfHwgYXR0LmlzU2VhcmNoYWJsZSlcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWVzLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlTmFtZXM7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSB1bmlxdWUgYXR0cmlidXRlcyBvZiB0aGUgZW50aXR5LiBcbiAgICAgKiBEZWZhdWx0cyB0byBhbGwgYXR0cmlidXRlcyB3aGljaCBhcmUgbWFya2VkIGFzIHVuaXF1ZSBvciBhcmUgaWRlbnRpZmllcnM7IFxuICAgICAqIE9yIGlmIHRoZXkgYXJlIHBhcnQgb2YgYSBjb21wb3NpdGUgcHJpbWFyeSBrZXkgd2hlcmUgdGhlIGNvbXBvc2l0ZSBsZW5ndGggaXMgMS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8RW50aXR5QXR0cmlidXRlPn0gdW5pcXVlIGF0dHJpYnV0ZXMgb2YgdGhlIGVudGl0eVxuICAgICovXG4gICAgcHVibGljIGdldFVuaXF1ZUF0dHJpYnV0ZXMoKTogQXJyYXk8RW50aXR5QXR0cmlidXRlPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG5cbiAgICAgICAgICAgIGxldCBpc1VuaXF1ZSA9ICgnaXNVbmlxdWUnIGluIGF0dCkgPyBhdHQuaXNVbmlxdWUgOiBhdHQuaXNJZGVudGlmaWVyO1xuXG4gICAgICAgICAgICBpZiAoaXNVbmlxdWUpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAuLi5hdHQsXG4gICAgICAgICAgICAgICAgICAgIGlzVW5pcXVlLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBhdHROYW1lLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGUgbmFtZXMgdGhhdCBjYW4gYmUgdXNlZCBmb3IgZmlsdGVyaW5nIHRoZSByZWNvcmRzLiBEZWZhdWx0cyB0byBhbGwgc3RyaW5nIGF0dHJpYnV0ZXMgd2hpY2ggYXJlIG5vdCBoaWRkZW4uXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaFxuICAgICovXG4gICAgcHVibGljIGdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgIWF0dC5oaWRkZW4gJiYgWyAnc3RyaW5nJywgJ251bWJlcicgXS5pbmNsdWRlcyhhdHQudHlwZSBhcyBzdHJpbmcpXG4gICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAoISgnaXNGaWx0ZXJhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc0ZpbHRlcmFibGUpXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KHJlY29yZDogVCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogUGFydGlhbDxUPiB7XG5cbiAgICAgICAgbGV0IGtleXM6IEFycmF5PHN0cmluZz47XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoYXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMocGFyc2VkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwaWNrS2V5czxUPihyZWNvcmQsIC4uLmtleXMpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IEFycmF5PFQ+IHwgbnVsbCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogQXJyYXk8UGFydGlhbDxUPj4ge1xuICAgICAgICBpZiAoIXJlY29yZCB8fCAhQXJyYXkuaXNBcnJheShyZWNvcmQpKSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlY29yZC5tYXAocmVjb3JkID0+IHRoaXMuc2VyaWFsaXplUmVjb3JkPFQ+KHJlY29yZCwgYXR0cmlidXRlcykpO1xuICAgIH1cblxuICAgIGFzeW5jIGh5ZHJhdGVSZWNvcmRzKFxuICAgICAgICByZWxhdGlvbnM6IEFycmF5PFsgcmVsYXRlZEF0dHJpYnV0ZU5hbWU6IHN0cmluZywgb3B0aW9uczogSHlkcmF0ZU9wdGlvbkZvclJlbGF0aW9uPGFueT4gXT4sXG4gICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzOiBBcnJheTx7IFsgeDogc3RyaW5nIF06IGFueTsgfT5cbiAgICApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZVJlY29yZHMnIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCk7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHJlbGF0aW9ucz8ubWFwKGFzeW5jIChbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVNpbmdsZVJlbGF0aW9uKHJvb3RFbnRpdHlSZWNvcmRzLCByZWxhdGVkQXR0cmlidXRlTmFtZSwgb3B0aW9ucyk7XG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVTaW5nbGVSZWxhdGlvbihyb290RW50aXR5UmVjb3JkczogYW55W10sIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxhbnk+KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVTaW5nbGVSZWxhdGlvbicgcmVsYXRpb246ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgb3B0aW9uc1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lLCByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSBvcHRpb25zO1xuXG4gICAgICAgIGlmICghaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICAgIHRocm93IChgTm8gSWRlbnRpZmllcnM6WyR7cmVsYXRpb25UeXBlfToke3JlbGF0ZWRFbnRpdHlOYW1lfV0gcHJvdmlkZWRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUgPT0gJ29uZS10by1vbmUnIHx8IHJlbGF0aW9uVHlwZSA9PSAnbWFueS10by1tYW55Jykge1xuICAgICAgICAgICAgdGhyb3cgKGBSZWxhdGlvblR5cGU6WyR7cmVsYXRpb25UeXBlfToke3JlbGF0ZWRFbnRpdHlOYW1lfV0gaW4gbm90IHN1cHBvcnRlZCBieSBoeWRyYXRpb24sIHVzZSBvbmUgb2YgW21hbnktdG8tb25lLCBvbmUtdG8tbWFueV0gb3QgbWFudWFsbHkgaHlkcmF0ZSdgKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2VcbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgICAgICBpZiAoIXJlbGF0ZWRFbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHNlcnZpY2UgZm91bmQgZm9yIHJlbGF0aW9uc2hpcDogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX0oJHtyZWxhdGVkRW50aXR5TmFtZX0pOyBwbGVhc2UgbWFrZSBzdXJlIHNlcnZpY2UgaGFzIGJlZW4gcmVnaXN0ZXJlZCBpbiB0aGUgcmVxdWlyZWQgJ2RpLWNvbnRhaW5lcidgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCByZWxhdGlvbidzIG1ldGFkYXRhXG4gICAgICAgIGNvbnN0IGN1cnJlbnRFbnRpdHlTY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCByZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhID0gY3VycmVudEVudGl0eVNjaGVtYS5hdHRyaWJ1dGVzWyByZWxhdGVkQXR0cmlidXRlTmFtZSBhcyBhbnkgXSBhcyBFbnRpdHlBdHRyaWJ1dGU7XG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhIHx8ICFyZWxhdGlvbkF0dHJpYnV0ZU1ldGFkYXRhPy5yZWxhdGlvbikge1xuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGBObyBtZXRhZGF0YSBmb3VuZCBmb3IgcmVsYXRpb25zaGlwOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfWBcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSk7XG4gICAgICAgICAgICB0aHJvdyAobWVzc2FnZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyByZWxhdGlvbiBpZGVudGlmaWVycyBtYXBwaW5nXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSA9IEFycmF5LmlzQXJyYXkoaWRlbnRpZmllcnMpID8gaWRlbnRpZmllcnMgOiBbIGlkZW50aWZpZXJzISBdO1xuXG4gICAgICAgIC8vIERlY2lkZSBsb2dpYyBiYXNlZCBvbiByZWxhdGlvblR5cGVcbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZSA9PT0gJ21hbnktdG8tb25lJykge1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBNQU5ZLVRPLU9ORTpcbiAgICAgICAgICAgICAqIC0tLS0tLS0tLS0tLS1cbiAgICAgICAgICAgICAqIFRoZSBcInJvb3RFbnRpdHlSZWNvcmRzXCIgYXJlIHRoZSBDSElMRCBpdGVtcywgZWFjaCBzdG9yaW5nIHRoZSBwYXJlbnQnc1xuICAgICAgICAgICAgICogY29tcG9zaXRlIGtleSBpbiBzb21lIGZpZWxkcy4gV2UgZ2F0aGVyIGFsbCB0aG9zZSBwYXJlbnQga2V5cywgZG8gYSBiYXRjaFxuICAgICAgICAgICAgICogcmV0cmlldmFsIGZyb20gdGhlIHBhcmVudCBlbnRpdHksIHRoZW4gYXR0YWNoIHRoZSBzaW5nbGUgbWF0Y2hpbmcgcGFyZW50XG4gICAgICAgICAgICAgKiByZWNvcmQgaW50byBjaGlsZFJlY29yZFtyZWxhdGVkQXR0cmlidXRlTmFtZV0uXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlTWFueVRvT25lKFxuICAgICAgICAgICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25UeXBlID09PSAnb25lLXRvLW1hbnknKSB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIE9ORS1UTy1NQU5ZOlxuICAgICAgICAgICAgICogLS0tLS0tLS0tLS0tLVxuICAgICAgICAgICAgICogVGhlIFwicm9vdEVudGl0eVJlY29yZHNcIiBhcmUgdGhlIFBBUkVOVCBpdGVtcy4gRWFjaCBwYXJlbnQgY2FuIGhhdmUgbXVsdGlwbGVcbiAgICAgICAgICAgICAqIGNoaWxkIGl0ZW1zLiBUaGUgY2hpbGQgdGFibGUgcmVjb3JkcyBlYWNoIHN0b3JlIHRoZSBwYXJlbnQncyBrZXkuIFxuICAgICAgICAgICAgICogU28gd2UgZG8gYSBxdWVyeSBwZXIgcGFyZW50IGFuZCB0aGVuIC5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5oeWRyYXRlT25lVG9NYW55KFxuICAgICAgICAgICAgICAgIHJvb3RFbnRpdHlSZWNvcmRzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGh5ZHJhdGVNYW55VG9PbmUoXG4gICAgICAgIGNoaWxkUmVjb3JkczogYW55W10sXG4gICAgICAgIHBhcmVudEF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzOiBSZWxhdGlvbklkZW50aWZpZXI8YW55PltdLFxuICAgICAgICBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlOiBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PGFueT4gfCB1bmRlZmluZWQsXG4gICAgICAgIHBhcmVudFNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbiAgICApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYGNhbGxlZCAnaHlkcmF0ZU1hbnlUb09uZScgcmVsYXRpb246ICR7cGFyZW50QXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBmb3IgZWFjaCBwYXJlbnQgY3JlYXRlIGEgY2hpbGRyZW4gYmF0Y2hcbiAgICAgICAgY29uc3QgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwID0gbmV3IE1hcDxzdHJpbmcsIGFueVtdPigpO1xuXG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgY2hpbGRSZWNvcmRzKSB7XG4gICAgICAgICAgICBpZiAoIWNoaWxkKSBjb250aW51ZTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgYSBwYXJlbnQga2V5IG9iamVjdC4gRS5nLiB7IG9yZ0lkOiBjaGlsZC5vcmdJZCwgdXNlcklkOiBjaGlsZC51c2VySWQgfSBmb3IgMi1hdHRyIFBLXG4gICAgICAgICAgICBjb25zdCBwYXJlbnRLZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBzb3VyY2UsIHRhcmdldCB9IG9mIGlkZW50aWZpZXJNYXBwaW5ncykge1xuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsID0gZ2V0VmFsdWVCeVBhdGgoY2hpbGQsIHNvdXJjZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWwgPT0gbnVsbCkgY29udGludWU7XG5cbiAgICAgICAgICAgICAgICAgICAgcGFyZW50S2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSB2YWw7XG5cbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgZ2V0dGluZyB2YWx1ZSBmb3IgcGF0aDogJHtzb3VyY2V9YCwgeyBlcnJvciB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIHBhcnRpYWwgb3IgZW1wdHksIHNraXBcbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhwYXJlbnRLZXlPYmopLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGNoaWxkWyBwYXJlbnRBdHRyaWJ1dGVOYW1lIF0gPSBudWxsO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBKU09OLnN0cmluZ2lmeShwYXJlbnRLZXlPYmopO1xuICAgICAgICAgICAgaWYgKCFwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuaGFzKGtleVN0cikpIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuc2V0KGtleVN0ciwgW10pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmdldChrZXlTdHIpIS5wdXNoKGNoaWxkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuc2l6ZSA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHBhcmVudC1pZGVudGlmaWVycy1iYXRjaCBmb3IgZmV0Y2hpbmdcbiAgICAgICAgY29uc3QgcGFyZW50SWRlbnRpZmllcnNCYXRjaDogQXJyYXk8UmVjb3JkPHN0cmluZywgYW55Pj4gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBrIG9mIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5rZXlzKCkpIHtcbiAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzQmF0Y2gucHVzaChKU09OLnBhcnNlKGspKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZldGNoZWRQYXJlbnRzID0gYXdhaXQgcGFyZW50U2VydmljZS5nZXQoe1xuICAgICAgICAgICAgaWRlbnRpZmllcnM6IHBhcmVudElkZW50aWZpZXJzQmF0Y2gsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiBwYXJlbnRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJZiBcImdldCgpXCIgcmV0dXJucyBhIHNpbmdsZSBpdGVtIGNvbnZlcnQgaXQgaW50byBhbiBhcnJheS5cbiAgICAgICAgY29uc3QgcGFyZW50c0FycmF5ID0gQXJyYXkuaXNBcnJheShmZXRjaGVkUGFyZW50cykgPyBmZXRjaGVkUGFyZW50cyA6IFsgZmV0Y2hlZFBhcmVudHMgXTtcblxuICAgICAgICAvLyBNYWtlIGEgZGljdGlvbmFyeSBmcm9tIHsgPGtleVN0cj4gPT4gcGFyZW50UmVjb3JkIH1cbiAgICAgICAgY29uc3QgcGFyZW50RGljdCA9IG5ldyBNYXA8c3RyaW5nLCBhbnk+KCk7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiBwYXJlbnRzQXJyYXkpIHtcbiAgICAgICAgICAgIGlmICghcCkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gUmVidWlsZCB0aGUgXCJjb21wb3NpdGUga2V5XCIgZnJvbSB0aGUgcGFyZW50J3MgcmVjb3JkXG4gICAgICAgICAgICBjb25zdCBrZXlPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAocFsgdGFyZ2V0IF0gPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBJZiBzb21lIGF0dHJpYnV0ZSBpcyBtaXNzaW5nLCBza2lwXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBrZXlPYmpbIHRhcmdldCBhcyBzdHJpbmcgXSA9IHBbIHRhcmdldCBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3Qga1N0ciA9IEpTT04uc3RyaW5naWZ5KGtleU9iaik7XG4gICAgICAgICAgICBwYXJlbnREaWN0LnNldChrU3RyLCBwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEF0dGFjaCBlYWNoIHBhcmVudCdzIGRhdGEgdG8gdGhlIGNoaWxkXG4gICAgICAgIGZvciAoY29uc3QgWyBrU3RyLCBjaGlsZHJlbiBdIG9mIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGZvdW5kUGFyZW50ID0gcGFyZW50RGljdC5nZXQoa1N0cikgPz8gbnVsbDtcbiAgICAgICAgICAgIGZvciAoY29uc3QgYyBvZiBjaGlsZHJlbikge1xuICAgICAgICAgICAgICAgIGNbIHBhcmVudEF0dHJpYnV0ZU5hbWUgXSA9IGZvdW5kUGFyZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlT25lVG9NYW55KFxuICAgICAgICBwYXJlbnRSZWNvcmRzOiBhbnlbXSxcbiAgICAgICAgY2hpbGRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSxcbiAgICAgICAgY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlOiBIeWRyYXRlT3B0aW9uRm9yRW50aXR5PGFueT4gfCB1bmRlZmluZWQsXG4gICAgICAgIGNoaWxkU2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuICAgICkge1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVPbmVUb01hbnknIHJlbGF0aW9uOiAke2NoaWxkQXR0cmlidXRlTmFtZX0gZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCB7XG4gICAgICAgICAgICBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHBhcmVudEtleVN0clRvUGFyZW50cyA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhcmVudCBvZiBwYXJlbnRSZWNvcmRzKSB7XG4gICAgICAgICAgICBpZiAoIXBhcmVudCkgY29udGludWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgXCJjaGlsZCBpbmRleFwiIGtleSBmcm9tIHRoZSBwYXJlbnQncyBmaWVsZHMuIEZvciBleGFtcGxlLCBcbiAgICAgICAgICAgIC8vIGlmIHRoZSBjaGlsZCBHU0kgaGFzIHsgcGs6ICd0ZW5hbnRJZCcsIHNrOiAnYWNjb3VudElkJyB9LCBcbiAgICAgICAgICAgIC8vIHdlIGZpbGwgeyB0ZW5hbnRJZDogcGFyZW50LnRlbmFudElkLCBhY2NvdW50SWQ6IHBhcmVudC5hY2NvdW50SWQgfS5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkS2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgc291cmNlLCB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcbiAgICAgICAgICAgICAgICBpZiAocGFyZW50WyBzb3VyY2UgXSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkS2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSBwYXJlbnRbIHNvdXJjZSBdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSWYgd2UgaGF2ZSBubyB2YWxpZCBjb21wb3NpdGUga2V5LCBubyBjaGlsZHJlbiBjYW4gYmUgZmV0Y2hlZFxuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKGNoaWxkS2V5T2JqKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBwYXJlbnRbIGNoaWxkQXR0cmlidXRlTmFtZSBdID0gW107XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IEpTT04uc3RyaW5naWZ5KGNoaWxkS2V5T2JqKTtcbiAgICAgICAgICAgIGlmICghcGFyZW50S2V5U3RyVG9QYXJlbnRzLmhhcyhrZXlTdHIpKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9QYXJlbnRzLnNldChrZXlTdHIsIFtdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhcmVudEtleVN0clRvUGFyZW50cy5nZXQoa2V5U3RyKSEucHVzaChwYXJlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgbm8gcGFyZW50IGhhcyBhIHZhbGlkIGtleSwgd2UncmUgZG9uZVxuICAgICAgICBpZiAocGFyZW50S2V5U3RyVG9QYXJlbnRzLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZvciBlYWNoIHVuaXF1ZSBwYXJlbnRLZXlPYmosIGRvIGEgY2hpbGRTZXJ2aWNlIHF1ZXJ5L2xpc3QgaW4gcGFyYWxsZWwuXG4gICAgICAgIGNvbnN0IHByb21pc2VzOiBBcnJheTxQcm9taXNlPGFueT4+ID0gW107XG4gICAgICAgIGNvbnN0IHBhcmVudEtleXM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGtleVN0ciBdIG9mIHBhcmVudEtleVN0clRvUGFyZW50cy5lbnRyaWVzKCkpIHtcblxuICAgICAgICAgICAgY29uc3QgY2hpbGRLZXlPYmogPSBKU09OLnBhcnNlKGtleVN0cik7XG5cbiAgICAgICAgICAgIHBhcmVudEtleXMucHVzaChrZXlTdHIpO1xuXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgY2hpbGRGaWVsZCwgdmFsIF0gb2YgT2JqZWN0LmVudHJpZXMoY2hpbGRLZXlPYmopKSB7XG4gICAgICAgICAgICAgICAgZmlsdGVyc1sgY2hpbGRGaWVsZCBdID0geyBlcTogdmFsIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHByb21pc2VzLnB1c2goXG4gICAgICAgICAgICAgICAgY2hpbGRTZXJ2aWNlLmxpc3Qoe1xuICAgICAgICAgICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiBjaGlsZEF0dHJpYnV0ZXNUb0h5ZHJhdGUsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuXG4gICAgICAgIC8vIEZvciBlYWNoIHJlc3VsdCwgbWFwIGNoaWxkcmVuIGJhY2sgdG8gdGhlIGNvcnJlY3QtcGFyZW50KHMpXG4gICAgICAgIGNvbnN0IHBhcmVudEtleVN0clRvQ2hpbGRyZW46IFJlY29yZDxzdHJpbmcsIGFueVtdPiA9IHt9O1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3VsdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IHsgZGF0YTogY2hpbGRJdGVtcyB9ID0gcmVzdWx0c1sgaSBdO1xuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gcGFyZW50S2V5c1sgaSBdO1xuICAgICAgICAgICAgcGFyZW50S2V5U3RyVG9DaGlsZHJlblsga2V5U3RyIF0gPSBjaGlsZEl0ZW1zID8/IFtdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXR0YWNoIHRvIHBhcmVudHNcbiAgICAgICAgZm9yIChjb25zdCBbIGtleVN0ciwgcGFyZW50cyBdIG9mIHBhcmVudEtleVN0clRvUGFyZW50cy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQXJyYXkgPSBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuWyBrZXlTdHIgXSA/PyBbXTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcCBvZiBwYXJlbnRzKSB7XG4gICAgICAgICAgICAgICAgcFsgY2hpbGRBdHRyaWJ1dGVOYW1lIF0gPSBjaGlsZEFycmF5O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIGFuIGVudGl0eSBieSBpdHMgaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkuXG4gICAgICogQHBhcmFtIHNlbGVjdGlvbnMgLSBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gaW5jbHVkZSBpbiB0aGUgcmVzcG9uc2UuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIHJldHJpZXZlZCBlbnRpdHkgZGF0YS5cbiAgICAgKi9cblxuICAgIHB1YmxpYyBhc3luYyBnZXQob3B0aW9uczogR2V0T3B0aW9uczxTPiwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgYXR0cmlidXRlcyB9ID0gb3B0aW9ucztcblxuXG4gICAgICAgIGxldCBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcbiAgICAgICAgaWYgKCFhdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZvcm1hdHRlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm9ybWF0dGVkIGF0dHJpYnV0ZXMgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBmb3JtYXR0ZWRBdHRyaWJ1dGVzKTtcblxuICAgICAgICBjb25zdCByZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIGFueSkucmVkdWNlKChhY2MsIFsgYXR0TmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhY2MucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIGlmIChpc09iamVjdChvcHRpb25zKSAmJiBvcHRpb25zLmlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IEFycmF5PFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+PiA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzIDogWyBvcHRpb25zLmlkZW50aWZpZXJzIF07XG4gICAgICAgICAgICAgICAgY29uc3QgdG9wS2V5cyA9IGlkZW50aWZpZXJzLm1hcChpZGVudGlmaWVyID0+IGlkZW50aWZpZXIuc291cmNlPy5zcGxpdD8uKCcuJyk/LlsgMCBdKS5maWx0ZXIoa2V5ID0+ICEha2V5KSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgICAgICBhY2MucHVzaCguLi50b3BLZXlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIFtdIGFzIHN0cmluZ1tdKTtcblxuICAgICAgICBjb25zdCB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzID0gWyAuLi5uZXcgU2V0KHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcykgXVxuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGdldEVudGl0eTxTPih7XG4gICAgICAgICAgICBpZDogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmV0cmlldmVkIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBKc29uU2VyaWFsaXplci5zdHJpbmdpZnkoZW50aXR5KSk7XG5cbiAgICAgICAgaWYgKCEhZm9ybWF0dGVkQXR0cmlidXRlcyAmJiBlbnRpdHk/LmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBbIGVudGl0eS5kYXRhIF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGVudGl0eT8uZGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgbXVsdGlwbGUgZW50aXRpZXMgYnkgdGhlaXIgaWRlbnRpZmllcnMgaW4gYSBiYXRjaCBvcGVyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgYmF0Y2ggcmV0cmlldmluZyBlbnRpdGllcy5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5pZGVudGlmaWVycyAtIEFycmF5IG9mIGVudGl0eSBpZGVudGlmaWVycyB0byByZXRyaWV2ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVzIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmNvbmN1cnJlbnQgLSBPcHRpb25hbCBudW1iZXIgb2YgY29uY3VycmVudCBiYXRjaCBvcGVyYXRpb25zIHRvIHBlcmZvcm0gKGRlZmF1bHQ6IDEpLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSByZXRyaWV2ZWQgZW50aXRpZXMgYW5kIGFueSB1bnByb2Nlc3NlZCBpdGVtcy5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgYmF0Y2hHZXQ8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ob3B0aW9uczoge1xuICAgICAgICBpZGVudGlmaWVyczogQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sXG4gICAgICAgIGF0dHJpYnV0ZXM/OiBFbnRpdHlTZWxlY3Rpb25zPFM+LFxuICAgICAgICBjb25jdXJyZW50PzogbnVtYmVyXG4gICAgfSkge1xuICAgICAgICBjb25zdCB7IGlkZW50aWZpZXJzLCBhdHRyaWJ1dGVzLCBjb25jdXJyZW50ID0gMSB9ID0gb3B0aW9ucztcblxuICAgICAgICBsZXQgZm9ybWF0dGVkQXR0cmlidXRlcyA9IGF0dHJpYnV0ZXM7XG4gICAgICAgIGlmICghYXR0cmlidXRlcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmb3JtYXR0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvcm1hdHRlZCBhdHRyaWJ1dGVzIGZvciBiYXRjaCBnZXQgb24gZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIGZvcm1hdHRlZEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGNvbnN0IHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgYW55KS5yZWR1Y2UoKGFjYywgWyBhdHROYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgIGFjYy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgaWYgKGlzT2JqZWN0KG9wdGlvbnMpICYmIG9wdGlvbnMuaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZGVudGlmaWVyczogQXJyYXk8UmVsYXRpb25JZGVudGlmaWVyPGFueT4+ID0gQXJyYXkuaXNBcnJheShvcHRpb25zLmlkZW50aWZpZXJzKSA/IG9wdGlvbnMuaWRlbnRpZmllcnMgOiBbIG9wdGlvbnMuaWRlbnRpZmllcnMgXTtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3BLZXlzID0gaWRlbnRpZmllcnMubWFwKGlkZW50aWZpZXIgPT4gaWRlbnRpZmllci5zb3VyY2U/LnNwbGl0Py4oJy4nKT8uWyAwIF0pLmZpbHRlcihrZXkgPT4gISFrZXkpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgICAgICAgIGFjYy5wdXNoKC4uLnRvcEtleXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgfSwgW10gYXMgc3RyaW5nW10pO1xuXG4gICAgICAgIGNvbnN0IHVuaXF1ZVNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBbIC4uLm5ldyBTZXQocmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzKSBdO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGdldEJhdGNoRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzIGFzIGFueSxcbiAgICAgICAgICAgIGNvbmN1cnJlbnRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJldHJpZXZlZCBiYXRjaCBlbnRpdGllczogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBKc29uU2VyaWFsaXplci5zdHJpbmdpZnkoZW50aXR5KSk7XG5cbiAgICAgICAgaWYgKCEhZm9ybWF0dGVkQXR0cmlidXRlcyAmJiBlbnRpdHk/LmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdHkuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZGF0YTogZW50aXR5Py5kYXRhIHx8IFtdLFxuICAgICAgICAgICAgdW5wcm9jZXNzZWQ6IGVudGl0eT8udW5wcm9jZXNzZWQgfHwgW11cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgdGhlIHVuaXF1ZW5lc3Mgb2YgYW4gYXR0cmlidXRlIHZhbHVlIGFuZCB1cGRhdGVzIHRoZSBwYXlsb2FkIGlmIG5lY2Vzc2FyeS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjaGVja2luZyB1bmlxdWVuZXNzIGFuZCB1cGRhdGluZyB0aGUgcGF5bG9hZC5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5wYXlsb2FkVG9VcGRhdGUgLSBUaGUgcGF5bG9hZCBvYmplY3QgdG8gdXBkYXRlLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmF0dHJpYnV0ZU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLmF0dHJpYnV0ZVZhbHVlIC0gVGhlIHZhbHVlIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIG9wdGlvbnMubWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIC0gVGhlIG1heGltdW0gbnVtYmVyIG9mIGF0dGVtcHRzIHRvIGNyZWF0ZSBhIHVuaXF1ZSBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICogQHJldHVybnMgQSBib29sZWFuIGluZGljYXRpbmcgd2hldGhlciB0aGUgYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgY2hlY2tVbmlxdWVuZXNzQW5kVXBkYXRlKG9wdGlvbnM6IHtcbiAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBhbnksXG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgYXR0cmlidXRlVmFsdWU6IGFueSxcbiAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzPzoge1xuICAgICAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBhbnlcbiAgICAgICAgfVxuICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWU6IG51bWJlcixcbiAgICB9KSB7XG5cbiAgICAgICAgY29uc3QgeyBwYXlsb2FkVG9VcGRhdGUsIGF0dHJpYnV0ZU5hbWUsIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycywgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH0gPSBvcHRpb25zO1xuICAgICAgICBsZXQgeyBhdHRyaWJ1dGVWYWx1ZSB9ID0gb3B0aW9ucztcblxuICAgICAgICBsZXQgaXNVbmlxdWUgPSBmYWxzZTtcbiAgICAgICAgbGV0IHRyaWVzQ291bnQgPSAxO1xuXG4gICAgICAgIHdoaWxlICghaXNVbmlxdWUgJiYgdHJpZXNDb3VudCA8IG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSkge1xuICAgICAgICAgICAgaXNVbmlxdWUgPSBhd2FpdCB0aGlzLmlzVW5pcXVlQXR0cmlidXRlVmFsdWUoYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlVmFsdWUsIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyk7XG4gICAgICAgICAgICBpZiAoIWlzVW5pcXVlKSB7XG4gICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWUgPSB0aGlzLmdlbmVyYXRlVW5pcXVlVmFsdWUoYXR0cmlidXRlVmFsdWUsIHRyaWVzQ291bnQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdHJpZXNDb3VudCsrO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzVW5pcXVlKSB7XG4gICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGVbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dHJpYnV0ZVZhbHVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGlzVW5pcXVlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGUgZ2l2ZW4gYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZSBmb3IgdGhlIHNwZWNpZmllZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcGFyYW0gYXR0cmlidXRlTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHBhcmFtIGF0dHJpYnV0ZVZhbHVlIC0gVGhlIHZhbHVlIG9mIHRoZSBhdHRyaWJ1dGUgdG8gY2hlY2sgdW5pcXVlbmVzcyBmb3IuXG4gICAgICogQHJldHVybnMgQSBib29sZWFuIGluZGljYXRpbmcgd2hldGhlciB0aGUgYXR0cmlidXRlIHZhbHVlIGlzIHVuaXF1ZSBvciBub3QuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGlzVW5pcXVlQXR0cmlidXRlVmFsdWUoXG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyxcbiAgICAgICAgYXR0cmlidXRlVmFsdWU6IGFueSxcbiAgICAgICAgaWdub3JlZEVudGl0eUlkZW50aWZpZXJzPzoge1xuICAgICAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBhbnlcbiAgICAgICAgfVxuICAgICkge1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBhdHRyaWJ1dGVOYW1lOiAke2F0dHJpYnV0ZU5hbWV9IH4gYXR0cmlidXRlVmFsdWU6ICR7YXR0cmlidXRlVmFsdWV9YCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGZpbHRlcnMgZm9yIHRoZSBxdWVyeSB1c2luZyB0aGUgY29ycmVjdCBzdHJ1Y3R1cmVcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIFsgYXR0cmlidXRlTmFtZSBdOiB7IGVxOiBhdHRyaWJ1dGVWYWx1ZSB9XG4gICAgICAgIH0gYXMgRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz47XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5lIHdoaWNoIGF0dHJpYnV0ZXMgdG8gcHJvamVjdCAtIG9ubHkgdGhlIGF0dHJpYnV0ZSBiZWluZyBjaGVja2VkIGFuZCBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVyc1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVzVG9Qcm9qZWN0OiBzdHJpbmdbXSA9IFsgYXR0cmlidXRlTmFtZSBdO1xuXG4gICAgICAgIC8vIEFkZCBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVyIGZpZWxkcyB0byB0aGUgcHJvamVjdGlvblxuICAgICAgICBpZiAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzICYmICFpc0VtcHR5T2JqZWN0RGVlcChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWF0dHJpYnV0ZXNUb1Byb2plY3QuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzVG9Qcm9qZWN0LnB1c2goa2V5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzZSB0aGUgcXVlcnkgbWV0aG9kIHRvIGxldmVyYWdlIGluZGV4IHNlbGVjdGlvbiBsb2dpYyB3aXRoIG1pbmltYWwgYXR0cmlidXRlIHByb2plY3Rpb25cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeSh7XG4gICAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogYXR0cmlidXRlc1RvUHJvamVjdCBhcyBhbnksXG4gICAgICAgICAgICBwYWdpbmF0aW9uOiB7IGNvdW50OiAxIH0gLy8gV2Ugb25seSBuZWVkIHRvIGtub3cgaWYgYW55IHJlY29yZHMgZXhpc3RcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSWYgd2UgaGF2ZSBpZ25vcmVkIGVudGl0eSBpZGVudGlmaWVycywgZmlsdGVyIHRoZSByZXN1bHRzIGluIG1lbW9yeVxuICAgICAgICBsZXQgZW50aXRpZXMgPSByZXN1bHQuZGF0YSB8fCBbXTtcbiAgICAgICAgaWYgKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyAmJiAhaXNFbXB0eU9iamVjdERlZXAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgZW50aXRpZXMgPSBlbnRpdGllcy5maWx0ZXIoZW50aXR5ID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gIU9iamVjdC5lbnRyaWVzKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykuZXZlcnkoKFsga2V5LCB2YWx1ZSBdKSA9PlxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlbIGtleSBdID09PSB2YWx1ZVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlIH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBhdHRyaWJ1dGVOYW1lOiAke2F0dHJpYnV0ZU5hbWV9IH4gYXR0cmlidXRlVmFsdWU6ICR7YXR0cmlidXRlVmFsdWV9IH4gZW50aXR5OmAsIHsgZGF0YTogZW50aXRpZXMgfSk7XG5cbiAgICAgICAgcmV0dXJuIGVudGl0aWVzLmxlbmd0aCA9PT0gMDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZXMgYSB1bmlxdWUgdmFsdWUgYnkgYXBwZW5kaW5nIGEgdW5pcXVlIHN1ZmZpeCB0byB0aGUgb3JpZ2luYWwgdmFsdWUuXG4gICAgICogQHBhcmFtIG9yaWdpbmFsVmFsdWUgLSBUaGUgb3JpZ2luYWwgdmFsdWUgdG8gZ2VuZXJhdGUgYSB1bmlxdWUgdmFsdWUgZnJvbS5cbiAgICAgKiBAcGFyYW0gYXR0ZW1wdCAtIFRoZSBhdHRlbXB0IG51bWJlciBvciBzdHJpbmcgdG8gYmUgdXNlZCBhcyBhIHN1ZmZpeCAoZGVmYXVsdDogcmFuZG9tIHN0cmluZykuXG4gICAgICogQHJldHVybnMgVGhlIGdlbmVyYXRlZCB1bmlxdWUgdmFsdWUuXG4gICAgICovXG4gICAgcHVibGljIGdlbmVyYXRlVW5pcXVlVmFsdWUob3JpZ2luYWxWYWx1ZTogYW55LCBhdHRlbXB0OiBudW1iZXIgfCBzdHJpbmcgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoMiwgMTUpKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgdW5pcXVlU3VmZml4ID0gYCR7RGF0ZS5ub3coKX0tJHthdHRlbXB0fWA7XG4gICAgICAgIHJldHVybiBgJHtvcmlnaW5hbFZhbHVlfS0ke3VuaXF1ZVN1ZmZpeH1gO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF1dG9tYXRpY2FsbHkgaW5qZWN0cyBhY3RvciBjb250ZXh0IGludG8gZW50aXR5IGRhdGFcbiAgICAgKiBAcGFyYW0gZGF0YSAtIFRoZSBlbnRpdHkgZGF0YSB0byBlbmhhbmNlXG4gICAgICogQHBhcmFtIG9wZXJhdGlvbiAtIFRoZSBvcGVyYXRpb24gdHlwZSAoY3JlYXRlL3VwZGF0ZSlcbiAgICAgKiBAcGFyYW0gY3R4IC0gVGhlIGV4ZWN1dGlvbiBjb250ZXh0IGNvbnRhaW5pbmcgYWN0b3IgaW5mb1xuICAgICAqIEByZXR1cm5zIEVuaGFuY2VkIGRhdGEgd2l0aCBhY3RvciBjb250ZXh0XG4gICAgICovXG4gICAgcHJvdGVjdGVkIGluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgICAgIGRhdGE6IFQsIFxuICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGVsZXRlJywgXG4gICAgICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgICApOiBUIHtcblxuICAgICAgICBpZiAoIWN0eD8uYWN0b3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0Jhc2VFbnRpdHlTZXJ2aWNlOiBObyBhY3RvciBjb250ZXh0IGZvdW5kLCBza2lwcGluZyBpbmplY3Rpb24nKTtcbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW5oYW5jZWREYXRhID0geyAuLi5kYXRhIH07XG4gICAgICAgIGNvbnN0IHsgYWN0b3IgfSA9IGN0eDtcblxuICAgICAgICAvLyBHZXQgY3VycmVudCB0aW1lc3RhbXAgZm9yIGRhdGFiYXNlIG9wZXJhdGlvblxuICAgICAgICBjb25zdCBjdXJyZW50VGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICBcbiAgICAgICAgLy8gSW5qZWN0IHZpc2libGUgYWN0b3IgZmllbGRzIGlmIGRlZmluZWQgaW4gc2NoZW1hIGFuZCBub3QgcmVhZC1vbmx5XG4gICAgICAgIGlmIChvcGVyYXRpb24gPT09ICdjcmVhdGUnKSB7XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2NyZWF0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2NyZWF0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuY3JlYXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnY3JlYXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnY3JlYXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuY3JlYXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gRm9yIGRlbGV0ZSBvcGVyYXRpb25zLCB3ZSBzdGlsbCB3YW50IHRvIHRyYWNrIHdobyBwZXJmb3JtZWQgdGhlIGRlbGV0aW9uXG4gICAgICAgIGlmIChvcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ2RlbGV0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAnZGVsZXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAnZGVsZXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkuZGVsZXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEFsd2F5cyB1cGRhdGUgdGhlc2UgZmllbGRzIG9uIGNyZWF0ZS91cGRhdGUgKGlmIG5vdCByZWFkLW9ubHkpXG4gICAgICAgICAgICBpZiAoaGFzQXR0cmlidXRlKHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmICFpc0F0dHJpYnV0ZVJlYWRPbmx5KHNjaGVtYSwgJ3VwZGF0ZWRCeScpICYmIGFjdG9yLmFjdG9ySWQpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEJ5ID0gYWN0b3IuYWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndXBkYXRlZEF0JykgJiYgIWlzQXR0cmlidXRlUmVhZE9ubHkoc2NoZW1hLCAndXBkYXRlZEF0JykpIHtcbiAgICAgICAgICAgICAgICAoZW5oYW5jZWREYXRhIGFzIGFueSkudXBkYXRlZEF0ID0gY3VycmVudFRpbWVzdGFtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCAndGVuYW50SWQnKSAmJiAhaXNBdHRyaWJ1dGVSZWFkT25seShzY2hlbWEsICd0ZW5hbnRJZCcpICYmIGFjdG9yLnRlbmFudElkKSB7XG4gICAgICAgICAgICAgICAgKGVuaGFuY2VkRGF0YSBhcyBhbnkpLnRlbmFudElkID0gYWN0b3IudGVuYW50SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBbHdheXMgaW5qZWN0IGNvbXBsZXRlIGFjdG9yIGNvbnRleHQgZm9yIGF1ZGl0IHRyYWlsXG4gICAgICAgIC8vIFRoaXMgZmllbGQgaXMgaGlkZGVuIGZyb20gQVBJIHJlc3BvbnNlcyBieSBkZWZhdWx0XG4gICAgICAgIC8vIENsZWFuIGFjdG9yIG9iamVjdCBieSByZW1vdmluZyB1bmRlZmluZWQgdmFsdWVzIChEeW5hbW9EQiBkb2Vzbid0IGFsbG93IHRoZW0pXG4gICAgICAgIGNvbnN0IGNsZWFuQWN0b3IgPSBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhhY3RvcikuZmlsdGVyKChbXywgdmFsdWVdKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKVxuICAgICAgICApO1xuXG4gICAgICAgIChlbmhhbmNlZERhdGEgYXMgYW55KS5fYWN0b3IgPSBjbGVhbkFjdG9yO1xuXG4gICAgICAgIHJldHVybiBlbmhhbmNlZERhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBlbnRpdHkuXG4gICAgICogXG4gICAgICogQHBhcmFtIHBheWxvYWQgLSBUaGUgcGF5bG9hZCBmb3IgY3JlYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGNyZWF0ZShwYXlsb2FkOiBDcmVhdGVFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWE8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgICAgICBsZXQgcGF5bG9hZENvcHkgPSB7IC4uLnBheWxvYWQgfTtcbiAgICAgICAgXG4gICAgICAgIC8vIEluamVjdCBhY3RvciBjb250ZXh0XG4gICAgICAgIHBheWxvYWRDb3B5ID0gdGhpcy5pbmplY3RBY3RvckNvbnRleHQocGF5bG9hZENvcHksICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eVNsdWdBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnc2x1ZycpIHx8ICcnO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ25hbWUnKSB8fCAnJztcblxuICAgICAgICBpZiAoZW50aXR5U2x1Z0F0dHJpYnV0ZSAmJiAhKGVudGl0eVNsdWdBdHRyaWJ1dGUgaW4gcGF5bG9hZENvcHkpKSB7XG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZUF0dHJpYnV0ZSAmJiAoZW50aXR5TmFtZUF0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgICAgICBwYXlsb2FkQ29weVsgZW50aXR5U2x1Z0F0dHJpYnV0ZSBhcyBrZXlvZiB0eXBlb2YgcGF5bG9hZENvcHkgXSA9IHRvU2x1ZyhwYXlsb2FkQ29weVsgZW50aXR5TmFtZUF0dHJpYnV0ZSBdKSBhcyBhbnk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHMgPSB0aGlzLmdldFVuaXF1ZUF0dHJpYnV0ZXMoKTtcbiAgICAgICAgY29uc3Qgc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlID0gNTtcblxuICAgICAgICBpZiAoIXNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzICYmIHVuaXF1ZUZpZWxkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxldCB1bmlxdWVuZXNzQ2hlY2tzID0gW107XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lIH0gb2YgdW5pcXVlRmllbGRzKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5hbWUhIGluIHBheWxvYWRDb3B5KSB7XG4gICAgICAgICAgICAgICAgICAgIGxldCB2YWx1ZSA9IHBheWxvYWRDb3B5WyBuYW1lISBdO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IG5hbWUhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlVmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBjcmVhdGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgZGF0YTogcGF5bG9hZENvcHksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBlbnRpdHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcy1PUi1VcGRhdGVzIGFuIGVudGl0eS5cbiAgICAgKiBOT1RFOiBcbiAgICAgKiAgIC0gVGhpcyBtZXRob2QgZG9lcyBub3QgY2hlY2sgZm9yIHVuaXF1ZW5lc3Mgb2YgdGhlIGF0dHJpYnV0ZXMsIG5laXRoZXIgY3JlYXRlIHRoZSBzbHVnIGF1dG9tYXRpY2FsbHkuXG4gICAgICogICAtIEl0J3MgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIHRoZSBjYWxsZXIgdG8gZW5zdXJlIHRoZSByZWFkIG9ueSBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaWYgdGhlIHJlY29yZCBpcyBiZWluZyB1cHNlcnQuXG4gICAgICogXG4gICAgICogQHBhcmFtIHBheWxvYWQgLSBUaGUgcGF5bG9hZCBmb3IgY3JlYXRpbmctT1ItdXBkYXRpbmcgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgY3JlYXRlZC1PUi11cGRhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgdXBzZXJ0KHBheWxvYWQ6IFVwc2VydEVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gdXBzZXJ0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBwYXlsb2FkOmAsIHBheWxvYWQpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IHVwc2VydEVudGl0eTxTPih7XG4gICAgICAgICAgICBkYXRhOiBwYXlsb2FkLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gZW50aXR5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBkdXBsaWNhdGUgZW50aXR5IGRhdGEgYmFzZWQgb24gdGhlIGdpdmVuIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBkdXBsaWNhdGUgZW50aXR5IGRhdGEuXG4gICAgICogQHRocm93cyBFcnJvciBpZiBubyByZWNvcmQgaXMgZm91bmQgZm9yIHRoZSBnaXZlbiBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGlkZW50aWZpZXJzID0geyBpZDogMSB9O1xuICAgICAqIGNvbnN0IGR1cGxpY2F0ZURhdGEgPSBhd2FpdCBtYWtlRHVwbGljYXRlRW50aXR5RGF0YUJ5SWRlbnRpZmllcnMoaWRlbnRpZmllcnMpO1xuICAgICAqIGNvbnNvbGUubG9nKGR1cGxpY2F0ZURhdGEpOyAvLyB7IG5hbWU6ICdKb2huIERvZScsIGFnZTogMzAsIC4uLiB9XG4gICAgICovXG4gICAgcHJvdGVjdGVkIGFzeW5jIG1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+KSB7XG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0KHsgaWRlbnRpZmllcnMgfSkgYXMgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz47XG5cbiAgICAgICAgaWYgKCFlbnRpdHkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gcmVjb3JkIGZvdW5kIGZvciBpZGVudGlmaWVyczogJHtpZGVudGlmaWVyc31gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBkdXBsaWNhdGVFdmVudERhdGE6IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiA9IHt9IGFzIGFueTtcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkUHJvcE5hbWUgPSB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpIGFzIHN0cmluZztcblxuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTbHVnQXR0cmlidXRlID0gKGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJycpLnRvVXBwZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSAoZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ25hbWUnKSB8fCAnJykudG9VcHBlckNhc2UoKTtcblxuICAgICAgICBmb3IgKGxldCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhlbnRpdHkpKSB7XG5cbiAgICAgICAgICAgIGlmIChrZXkgIT09IHByaW1hcnlJZFByb3BOYW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gVE9ETzogaGFuZGxlIHdoZW4gZW50aXR5IGhhcyBtdWx0aXBsZSBpZGVudGlmaWVyc1xuXG4gICAgICAgICAgICAgICAgaWYgKGtleS50b1VwcGVyQ2FzZSgpID09PSBlbnRpdHlOYW1lQXR0cmlidXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gYCR7dmFsdWV9IC0gQ29weWA7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChrZXkudG9VcHBlckNhc2UoKSA9PT0gZW50aXR5U2x1Z0F0dHJpYnV0ZSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IGAke3ZhbHVlfS1jb3B5YDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBkdXBsaWNhdGVFdmVudERhdGFbIGtleSBhcyBrZXlvZiB0eXBlb2YgZHVwbGljYXRlRXZlbnREYXRhIF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkdXBsaWNhdGVFdmVudERhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIGR1cGxpY2F0ZSBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZCAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIGR1cGxpY2F0ZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgZHVwbGljYXRlZCBlbnRpdHkuXG4gICAgICogXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBlbnRpdHlJZCA9IHsgaWQ6IDEyMywgbmFtZTogJ2V4YW1wbGUnIH07XG4gICAgICogY29uc3QgZHVwbGljYXRlZEVudGl0eSA9IGF3YWl0IGR1cGxpY2F0ZShlbnRpdHlJZCk7XG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGR1cGxpY2F0ZShpZDogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICBjb25zdCBkdXBsaWNhdGVFdmVudERhdGEgPSBhd2FpdCB0aGlzLm1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhKGlkKTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY3JlYXRlKGR1cGxpY2F0ZUV2ZW50RGF0YSwgY3R4KTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBzaG91bGQgYmUgcGFydCBvZiBzb21lIGNvbmZpZ1xuICAgIHByb3RlY3RlZCBkZWxpbWl0ZXJzUmVnZXggPSAvKD86JnwgfCx8XFwrKSsvO1xuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIGEgbGlzdCBvZiBlbnRpdGllcyBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgcXVlcnkuXG4gICAgICogLSBJZiBubyBzcGVjaWZpYyBhdHRyaWJ1dGVzIGFyZSBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIC0gSWYgYSBzZWFyY2ggdGVybSBpcyBwcm92aWRlZCBpbiB0aGUgcXVlcnkgaXQgd2lsbCBzcGxpdCB0aGUgc2VhcmNoIHRlcm0gYnkgYC8oPzomfCB8LHxcXCspKy9gIFJlZ2V4IGFuZCB3aWxsIGZpbHRlciBvdXQgZW1wdHkgc3RyaW5ncy5cbiAgICAgKiAtIElmIHNlYXJjaCBhdHRyaWJ1dGVzIGFyZSBub3QgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2Ygc2VhcmNoYWJsZSBhdHRyaWJ1dGUgbmFtZXMgb2J0YWluZWQgZnJvbSBgZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKClgLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBxdWVyeSAtIFRoZSBxdWVyeSBvYmplY3QgY29udGFpbmluZyBmaWx0ZXJzLCBzZWFyY2gga2V5d29yZHMsIGFuZCBhdHRyaWJ1dGVzLlxuICAgICAqIEByZXR1cm5zIEEgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSBsaXN0IG9mIGVudGl0aWVzIGFuZCB0aGUgb3JpZ2luYWwgcXVlcnkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGxpc3QocXVlcnk6IEVudGl0eVF1ZXJ5PFM+ID0ge30sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgaWYgKCFxdWVyeS5hdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBxdWVyeS5hdHRyaWJ1dGVzID0gdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZm9yIGxpc3RpbmcgQVBJIGF0dHJpYnV0ZXMgd291bGQgYmUgYW4gYXJyYXlcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocXVlcnkuYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHF1ZXJ5LmF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgcXVlcnkuYXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzLnNwbGl0KCcsJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCFxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzIHx8IGlzRW1wdHkocXVlcnkuc2VhcmNoQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3Qgc2VhcmNoRmlsdGVyR3JvdXAgPSBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcyhxdWVyeS5zZWFyY2gsIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuZmlsdGVycyA9IGFkZEZpbHRlckdyb3VwVG9FbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPihzZWFyY2hGaWx0ZXJHcm91cCBhcyBhbnksIHF1ZXJ5LmZpbHRlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZW50aXRpZXMgPSBhd2FpdCBsaXN0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICBlbnRpdGllcy5kYXRhID0gdGhpcy5zZXJpYWxpemVSZWNvcmRzKGVudGl0aWVzLmRhdGEsIHF1ZXJ5LmF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGlmIChxdWVyeS5hdHRyaWJ1dGVzICYmIGVudGl0aWVzLmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMocXVlcnkuYXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF07XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC8vIG9ubHkgYXR0cmlidXRlcyBpbiBoeWRyYXRlIG9wdGlvbnMgdGhhdCBoYXZlIHJlbGF0aW9uIG1ldGFkYXRhIGF0dGFjaGVkIHRvIHRoZW0gbmVlZHMgdG8gYmUgaHlkcmF0ZWRcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXRpZXMuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyAuLi5lbnRpdGllcywgcXVlcnkgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEV4ZWN1dGVzIGEgcXVlcnkgb24gdGhlIGVudGl0eS5cbiAgICAgKiAtIElmIG5vIHNwZWNpZmljIGF0dHJpYnV0ZXMgYXJlIHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogLSBJZiBhIHNlYXJjaCB0ZXJtIGlzIHByb3ZpZGVkIGluIHRoZSBxdWVyeSBpdCB3aWxsIHNwbGl0IHRoZSBzZWFyY2ggdGVybSBieSBgLyg/OiZ8IHwsfFxcKykrL2AgUmVnZXggYW5kIHdpbGwgZmlsdGVyIG91dCBlbXB0eSBzdHJpbmdzLlxuICAgICAqICAgLS0gSWYgc2VhcmNoIGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBzZWFyY2hhYmxlIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogICAtLSBJZiB0aGVyZSBhcmUgYW55IG5vbi1lbXB0eSBzZWFyY2gtdGVybXMsIGl0IHdpbGwgYWRkIGEgZmlsdGVyIGdyb3VwIHRvIHRoZSBxdWVyeSBiYXNlZCBvbiB0aGUgc2VhcmNoIGtleXdvcmRzLlxuICAgICAqIEBwYXJhbSBxdWVyeSAtIFRoZSBlbnRpdHkgcXVlcnkgdG8gZXhlY3V0ZS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byB0aGUgcmVzdWx0IG9mIHRoZSBxdWVyeS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgcXVlcnkocXVlcnk6IEVudGl0eVF1ZXJ5PFM+LCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gbGlzdCB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gcXVlcnk6YCwgcXVlcnkpO1xuXG4gICAgICAgIGNvbnN0IHsgYXR0cmlidXRlcyB9ID0gcXVlcnk7XG5cbiAgICAgICAgbGV0IHNlbGVjdEF0dHJpYnV0ZXM6IEVudGl0eVNlbGVjdGlvbnM8Uz4gfCB1bmRlZmluZWQgPSBhdHRyaWJ1dGVzIHx8IHRoaXMuZ2V0TGlzdGluZ0F0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0QXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIC8vIHBhcnNlIHRoZSBsaXN0IG9mIGRvdC1zZXBhcmF0ZWQgYXR0cmlidXRlLWlkZW50aWZpZXJzIHBhdGhzIGFuZCBlbnN1cmUgYWxsIHRoZSByZXF1aXJlZCBtZXRhZGF0YSBpcyB0aGVyZVxuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoc2VsZWN0QXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBzZWxlY3RBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gZW5zdXJlIGFsbCB0aGUgcHJvdmlkZWQgc2VsZWN0IGF0dHJpYnV0ZXMgaGFzIHJlcXVpcmVkIG1ldGFkYXRhIGFsbCB0aGUgd2F5IGRvd24gdG8gdGhlIGxlYWYgbGV2ZWxcbiAgICAgICAgICAgIHNlbGVjdEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgc2VsZWN0QXR0cmlidXRlcyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocXVlcnkuc2VhcmNoKSB7XG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoKSkge1xuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaCA9IHF1ZXJ5LnNlYXJjaC50cmltKCkuc3BsaXQodGhpcy5kZWxpbWl0ZXJzUmVnZXggPz8gJyAnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocXVlcnkuc2VhcmNoLmxlbmd0aCA+IDApIHtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgPSBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzIHx8IHRoaXMuZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXJHcm91cCA9IG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzKHF1ZXJ5LnNlYXJjaCwgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyk7XG5cbiAgICAgICAgICAgICAgICBxdWVyeS5maWx0ZXJzID0gYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhPFM+KHNlYXJjaEZpbHRlckdyb3VwIGFzIGFueSwgcXVlcnkuZmlsdGVycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdGllcyA9IGF3YWl0IHF1ZXJ5RW50aXR5PFM+KHtcbiAgICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICB9KTtcblxuICAgICAgICBlbnRpdGllcy5kYXRhID0gdGhpcy5zZXJpYWxpemVSZWNvcmRzKGVudGl0aWVzLmRhdGEsIHNlbGVjdEF0dHJpYnV0ZXMpO1xuXG4gICAgICAgIGlmIChzZWxlY3RBdHRyaWJ1dGVzICYmIGVudGl0aWVzLmRhdGEpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uYWxBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoc2VsZWN0QXR0cmlidXRlcyk/Lm1hcCgoWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF0pID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gWyBhdHRyaWJ1dGVOYW1lLCBvcHRpb25zIF07XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC8vIG9ubHkgYXR0cmlidXRlcyBpbiBoeWRyYXRlIG9wdGlvbnMgdGhhdCBoYXZlIHJlbGF0aW9uIG1ldGFkYXRhIGF0dGFjaGVkIHRvIHRoZW0gbmVlZHMgdG8gYmUgaHlkcmF0ZWRcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXRpZXMuZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyAuLi5lbnRpdGllcywgcXVlcnkgfTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGVzIGFuIGVudGl0eSBpbiB0aGUgZGF0YWJhc2UuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byB1cGRhdGUuXG4gICAgICogQHBhcmFtIGRhdGEgLSBUaGUgdXBkYXRlZCBkYXRhIGZvciB0aGUgZW50aXR5LlxuICAgICAqIEBwYXJhbSByZW1vdmUgLSBPcHRpb25hbCBhcnJheSBvZiBhdHRyaWJ1dGVzIHRvIHJlbW92ZSBmcm9tIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIHVwZGF0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyB1cGRhdGUoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4sIGRhdGE6IFVwZGF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiwgb3BlcmF0b3JzPzogVXBkYXRlRW50aXR5T3BlcmF0b3JzLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICAgICAgLy8gSW5qZWN0IGFjdG9yIGNvbnRleHRcbiAgICAgICAgbGV0IGVuaGFuY2VkRGF0YSA9IHRoaXMuaW5qZWN0QWN0b3JDb250ZXh0KGRhdGEgYXMgYW55LCAndXBkYXRlJywgY3R4KTtcblxuICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHMgPSB0aGlzLmdldFVuaXF1ZUF0dHJpYnV0ZXMoKTtcbiAgICAgICAgY29uc3Qgc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlID0gNTtcblxuICAgICAgICBpZiAoIXNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzICYmIHVuaXF1ZUZpZWxkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxldCB1bmlxdWVuZXNzQ2hlY2tzID0gW107XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lLCByZWFkT25seSB9IG9mIHVuaXF1ZUZpZWxkcykge1xuICAgICAgICAgICAgICAgIGlmIChyZWFkT25seSkge1xuICAgICAgICAgICAgICAgICAgICBkZWxldGUgZW5oYW5jZWREYXRhWyBuYW1lIGFzIGtleW9mIHR5cGVvZiBlbmhhbmNlZERhdGEgXTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKG5hbWUhIGluIGVuaGFuY2VkRGF0YSkge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdmFsdWUgPSBlbmhhbmNlZERhdGFbIG5hbWUgYXMga2V5b2YgdHlwZW9mIGVuaGFuY2VkRGF0YSBdO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBlbmhhbmNlZERhdGEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBuYW1lISxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZVZhbHVlOiB2YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVyczogaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHVuaXF1ZW5lc3NDaGVja3MubWFwKGNoZWNrID0+IGNoZWNrKCkpKTtcblxuICAgICAgICAgICAgaWYgKGNoZWNrUmVzdWx0cy5pbmNsdWRlcyhmYWxzZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHNQYXRoID0gdW5pcXVlRmllbGRzLm1hcChmaWVsZCA9PiBmaWVsZC5uYW1lISkgPz8gW107XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKFsge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlVuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igb25lIG9yIG1vcmUgZmllbGRzLlwiLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiB1bmlxdWVGaWVsZHNQYXRoLFxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogWyAndW5pcXVlJywgdW5pcXVlRmllbGRzIF0sXG4gICAgICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVwZGF0ZWRFbnRpdHkgPSBhd2FpdCB1cGRhdGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgZGF0YTogZW5oYW5jZWREYXRhLFxuICAgICAgICAgICAgb3BlcmF0b3JzOiBvcGVyYXRvcnMsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB1cGRhdGVkRW50aXR5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERlbGV0ZXMgYW4gZW50aXR5IGJhc2VkIG9uIHRoZSBwcm92aWRlZCBpZGVudGlmaWVycy5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gaWRlbnRpZmllcnMgLSBUaGUgaWRlbnRpZmllcnMgb2YgdGhlIGVudGl0eSB0byBiZSBkZWxldGVkLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBkZWxldGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZGVsZXRlKGlkZW50aWZpZXJzOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+IHwgQXJyYXk8RW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPj4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGRlbGV0ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gaWRlbnRpZmllcnM6YCwgaWRlbnRpZmllcnMpO1xuICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGRlbGV0ZWRFbnRpdHkgPSBhd2FpdCBkZWxldGVFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogdGhpcy5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlOiB0aGlzLFxuICAgICAgICAgICAgYWN0b3I6IGN0eD8uYWN0b3IsXG4gICAgICAgICAgICB0ZW5hbnQ6IGN0eD8uYWN0b3I/LnRlbmFudElkLFxuICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIGRlbGV0ZWRFbnRpdHk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBEYXRhYmFzZUVycm9yKGBGYWlsZWQgdG8gZGVsZXRlICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWJ1aWxkcyBhbGwgaW5kZXhlcyBmb3IgdGhlIGVudGl0eSBieSB3cml0aW5nIHRvIHRoZSBwcmltYXJ5IGluZGV4LlxuICAgICAqIFRoaXMgbWV0aG9kIGlzIHVzZWZ1bCBmb3IgbWFpbnRhaW5pbmcgZGF0YSBpbnRlZ3JpdHkgYW5kIGVuc3VyaW5nIGluZGV4ZXMgYXJlIHByb3Blcmx5IHVwZGF0ZWQuXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBPcHRpb25zIGZvciByZWJ1aWxkaW5nIHRoZSBpbmRleFxuICAgICAqIEBwYXJhbSBvcHRpb25zLmJhdGNoU2l6ZSAtIFRoZSBudW1iZXIgb2YgaXRlbXMgdG8gcHJvY2VzcyBpbiBlYWNoIGJhdGNoLiBEZWZhdWx0cyB0byAxMDAuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgaW5kZXggcmVidWlsZCBpcyBjb21wbGV0ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgcmVidWlsZEluZGV4KG9wdGlvbnM6IHsgYmF0Y2hTaXplPzogbnVtYmVyIH0gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBiYXRjaFNpemUgPSAxMDAgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gdGhpcy5nZXRFbnRpdHlOYW1lKCk7XG4gICAgICAgICAgICBjb25zdCByZXBvc2l0b3J5ID0gdGhpcy5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFN0YXJ0aW5nIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuXG4gICAgICAgICAgICAvLyBHZXQgYWxsIHJlY29yZHMgZnJvbSB0aGUgcHJpbWFyeSBpbmRleFxuICAgICAgICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IGF3YWl0IHJlcG9zaXRvcnkuc2Nhbi5nbygpO1xuXG4gICAgICAgICAgICBpZiAoIWFsbFJlY29yZHMuZGF0YSB8fCBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gcmVjb3JkcyBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCAke2FsbFJlY29yZHMuZGF0YS5sZW5ndGh9IHJlY29yZHMgdG8gcHJvY2VzcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaGVzXG4gICAgICAgICAgICBjb25zdCB0b3RhbFJlY29yZHMgPSBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3QgdG90YWxCYXRjaGVzID0gTWF0aC5jZWlsKHRvdGFsUmVjb3JkcyAvIGJhdGNoU2l6ZSk7XG5cbiAgICAgICAgICAgIGZvciAobGV0IGJhdGNoSW5kZXggPSAwOyBiYXRjaEluZGV4IDwgdG90YWxCYXRjaGVzOyBiYXRjaEluZGV4KyspIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IGJhdGNoSW5kZXggKiBiYXRjaFNpemU7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyBiYXRjaFNpemUsIHRvdGFsUmVjb3Jkcyk7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2ggPSBhbGxSZWNvcmRzLmRhdGEuc2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGJhdGNoICR7YmF0Y2hJbmRleCArIDF9LyR7dG90YWxCYXRjaGVzfSAoJHtzdGFydCArIDF9LSR7ZW5kfSBvZiAke3RvdGFsUmVjb3Jkc30gcmVjb3JkcylgKTtcblxuICAgICAgICAgICAgICAgIC8vIFJlYnVpbGQgYWxsIGluZGV4ZXMgYnkgdXBzZXJ0aW5nIGVhY2ggcmVjb3JkIHRvIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSB1cHNlcnQgdG8gZW5zdXJlIHRoZSByZWNvcmQgaXMgcHJvcGVybHkgaW5kZXhlZFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVwb3NpdG9yeS51cHNlcnQocmVjb3JkKS5nbygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVjb3JkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbmZlcnMgcmVsYXRpb25zaGlwcyBiZXR3ZWVuIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBzY2hlbWEgYW5kIHNlbGVjdGlvbi1wYXRocy5cbiAgICAgKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBwYXRocyBUaGUgcGFyc2VkIHNlbGVjdGlvbiBwYXRocyBmcm9tIGUuZy4gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocygpLlxuICAgICAqIEBwYXJhbSBwYXRoS2V5IFRoZSBjdXJyZW50IFwicGF0aFwiIHN0cmluZyByZXByZXNlbnRpbmcgaG93IHdlIGFycml2ZWQgaGVyZSAoZGVmYXVsdHMgdG8gdGhlIGVudGl0eSBuYW1lKS5cbiAgICAgKiBAcGFyYW0gdmlzaXRlZFBhdGhzIEEgc2V0IG9mIHBhdGgtc3RyaW5ncyB2aXNpdGVkIHNvIGZhciBpbiB0aGlzIHJlY3Vyc2lvbiBjaGFpbiAocHJldmVudHMgY3ljbGVzKS5cbiAgICAgKiBAcGFyYW0gbWF4RGVwdGggTWF4aW11bSByZWN1cnNpb24gZGVwdGggKG9wdGlvbmFsKS5cbiAgICAgKi9cbiAgICBpbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgICAgICBzY2hlbWE6IEUsXG4gICAgICAgIHBhdGhzOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyxcbiAgICAgICAgcGF0aEtleTogc3RyaW5nID0gc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgdmlzaXRlZFBhdGhzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQ8c3RyaW5nPigpLFxuICAgICAgICBtYXhEZXB0aCA9IDVcbiAgICApOiBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPiB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ2luZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMnLCB7IHBhdGhLZXksIHBhdGhzIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGV4Y2VlZCBtYXggZGVwdGgsIHdlIHNraXAgZXhwYW5zaW9uc1xuICAgICAgICBpZiAobWF4RGVwdGggPD0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTWF4IHJlY3Vyc2lvbiBkZXB0aCByZWFjaGVkIGF0IHBhdGhLZXk9XCIke3BhdGhLZXl9XCJgKTtcbiAgICAgICAgICAgIHJldHVybiB7fSBhcyBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZmVycmVkOiBhbnkgPSB7fTtcblxuICAgICAgICAvLyBMb29wIG92ZXIgZWFjaCBhdHRyaWJ1dGUgaW4gdGhlIGVudGl0eSBzY2hlbWFcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpLmZvckVhY2goKFsgYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlTWV0YSBdKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhdHRWYWwgPSBwYXRoc1sgYXR0cmlidXRlTmFtZSBdO1xuICAgICAgICAgICAgaWYgKCFhdHRWYWwpIHtcbiAgICAgICAgICAgICAgICAvLyBOb3Qgc2VsZWN0ZWQgaW4gdGhlIHVzZXIncyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpc1JlbGF0aW9uYWwgPSAhIWF0dHJpYnV0ZU1ldGEucmVsYXRpb247XG5cbiAgICAgICAgICAgIC8vIElmIHRoZSBhdHRyaWJ1dGUgaXMgbm90IHJlbGF0aW9uYWwgb3IgdGhlIHZhbHVlIGlzIGEgYm9vbGVhbiwgd2UgY2FuIGluZmVyIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGlmICghaXNSZWxhdGlvbmFsIHx8IGlzQm9vbGVhbihhdHRWYWwpKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dFZhbDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEl0J3MgYSByZWxhdGlvbmFsIGF0dHJpYnV0ZTsgcHJlcGFyZSB0byByZWN1cnNlXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbk1ldGEgPSBhdHRyaWJ1dGVNZXRhLnJlbGF0aW9uITtcbiAgICAgICAgICAgIGNvbnN0IG5leHRFbnRpdHlOYW1lID0gcmVsYXRpb25NZXRhLmVudGl0eU5hbWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgbmV3IFwicGF0aFwiIHN0cmluZyB0byBkZXRlY3QgY3ljbGVzIChlLmcuIFwiVXNlci5ncm91cHMuR3JvdXAubWVtYmVycy5Vc2VyXCIpXG4gICAgICAgICAgICBjb25zdCBuZXdQYXRoID0gYCR7cGF0aEtleX0uJHthdHRyaWJ1dGVOYW1lfS4ke25leHRFbnRpdHlOYW1lfWA7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGFscmVhZHkgdmlzaXRlZCB0aGlzIHBhdGgsIGlmIHNvID0+IHNraXAgZXhwYW5zaW9ucyBmb3IgdGhpcyBhdHRyaWJ1dGUgb25seVxuICAgICAgICAgICAgaWYgKHZpc2l0ZWRQYXRocy5oYXMobmV3UGF0aCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTa2lwcGluZyBjeWMgcmVsYXRpb24gZXhwYW5zaW9ucyBmb3I6ICR7bmV3UGF0aH1gKTtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2tpcHBlZER1ZVRvQ3ljbGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIE1hcmsgdGhpcyBwYXRoIGFzIHZpc2l0ZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5hZGQobmV3UGF0aCk7XG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gdGhlIHJlbGF0ZWQgZW50aXR5J3Mgc2NoZW1hXG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihuZXh0RW50aXR5TmFtZSk7XG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgdGhlIFwibWV0YVwiIG9iamVjdCB0aGF0IHdlIHN0b3JlXG4gICAgICAgICAgICBjb25zdCBtZXRhOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24gPSB7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcmVsYXRpb25UeXBlOiByZWxhdGlvbk1ldGEudHlwZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaXNGdW5jdGlvbihyZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgICAgID8gcmVsYXRpb25NZXRhLmlkZW50aWZpZXJzKClcbiAgICAgICAgICAgICAgICAgICAgOiByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlczoge30sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgcGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBpc09iamVjdChhdHRWYWwpID8gYXR0VmFsLmF0dHJpYnV0ZXMgOiB1bmRlZmluZWQ7IC8vIHByb3ZpZGVkIGJ5IHRoZSB1c2VyIFxuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRpb25NZXRhLmF0dHJpYnV0ZXM7IC8vIGRlZmluZWQgaW4gdGhlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcyA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTsgLy8gYXV0byBnZW4gYnkgZnJhbWV3b3JrXG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gZXhwYW5kIGNoaWxkJ3MgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgbWV0YS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgKHBhdGhTZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0aW9uU2VsZWN0aW9uQXR0cmlidXRlcyB8fCByZWxhdGVkRW50aXR5RGVmYXVsdFNlbGVjdGlvbkF0dHJpYnV0ZXMpIGFzIGFueSxcbiAgICAgICAgICAgICAgICBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICB2aXNpdGVkUGF0aHMsXG4gICAgICAgICAgICAgICAgbWF4RGVwdGggLSAxXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gbWV0YTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHRoaXMgcGF0aCBzbyBzaWJsaW5ncyBjYW4gYWxzbyBleHBhbmQgaXQgaWYgbmVlZGVkXG4gICAgICAgICAgICB2aXNpdGVkUGF0aHMuZGVsZXRlKG5ld1BhdGgpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gaW5mZXJyZWQ7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHNlYXJjaChxdWVyeTogRW50aXR5U2VhcmNoUXVlcnk8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXF1ZXJ5LnNlbGVjdCkge1xuICAgICAgICAgICAgLy8gKiBOb3RlOiB3ZSBleHBlY3QgYW4gYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzXG4gICAgICAgICAgICBxdWVyeS5zZWxlY3QgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpIGFzIGFueTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2VhcmNoU2VydmljZS5zZWFyY2gocXVlcnksIHVuZGVmaW5lZCwgY3R4KTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGF0dElkOiBzdHJpbmcsIGF0dDogRW50aXR5QXR0cmlidXRlKTogUGFydGlhbDxFbnRpdHlBdHRyaWJ1dGU+ICYge1xuICAgIGlkOiBzdHJpbmcsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXVxufSB7XG5cbiAgICBjb25zdCB7IG5hbWUsIHZhbGlkYXRpb25zLCByZXF1aXJlZCwgcmVsYXRpb24sIGRlZmF1bHQ6IGRlZmF1bHRWYWx1ZSwgZ2V0OiBfZ2V0dGVyLCBzZXQ6IF9zZXR0ZXIsIHdhdGNoLCAuLi5yZXN0TWV0YSB9ID0gYXR0O1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSwgLi4ucmVzdFJlbGF0aW9uIH0gPSByZWxhdGlvbiB8fCB7fTtcblxuICAgIGNvbnN0IHJlbGF0aW9uTWV0YSA9IHJlbGF0ZWRFbnRpdHlOYW1lID8geyAuLi5yZXN0UmVsYXRpb24sIGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lIH0gOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCB7IGl0ZW1zLCB0eXBlLCBwcm9wZXJ0aWVzLCBhZGROZXdPcHRpb24sIC4uLnJlc3RSZXN0TWV0YSB9ID0gcmVzdE1ldGEgYXMgYW55O1xuXG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnJlc3RSZXN0TWV0YSxcbiAgICAgICAgdHlwZSxcbiAgICAgICAgaWQ6IGF0dElkLFxuICAgICAgICBuYW1lOiBuYW1lIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUoYXR0SWQpLFxuICAgICAgICByZWxhdGlvbjogcmVsYXRpb25NZXRhIGFzIGFueSxcbiAgICAgICAgZGVmYXVsdFZhbHVlLFxuICAgICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvbnMgfHwgcmVxdWlyZWQgPyBbICdyZXF1aXJlZCcgXSA6IFtdLFxuICAgICAgICBpc1Zpc2libGU6ICEoJ2lzVmlzaWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNWaXNpYmxlLFxuICAgICAgICBpc0VkaXRhYmxlOiAhKCdpc0VkaXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0VkaXRhYmxlLFxuICAgICAgICBpc0xpc3RhYmxlOiAhKCdpc0xpc3RhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0xpc3RhYmxlLFxuICAgICAgICBpc0NyZWF0YWJsZTogISgnaXNDcmVhdGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzQ3JlYXRhYmxlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6ICEoJ2lzRmlsdGVyYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNGaWx0ZXJhYmxlLFxuICAgICAgICBpc1NlYXJjaGFibGU6ICEoJ2lzU2VhcmNoYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNTZWFyY2hhYmxlLFxuICAgIH1cblxuICAgIGlmIChhZGROZXdPcHRpb24pIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uJyBdID0gYWRkTmV3T3B0aW9uO1xuICAgIH1cblxuICAgIC8vXG4gICAgLy8gKiogbWFrZSBzdXJlIHRvIG5vdCBvdmVycmlkZSB0aGUgaW5uZXIgZmllbGRzIG9mIGF0dHJpYnV0ZXMgbGlrZSBgbGlzdC1baXRlbXNdLVttYXBdLXByb3BlcnRpZXNgICoqXG4gICAgLy9cbiAgICBpZiAodHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAncHJvcGVydGllcycgXSA9IE9iamVjdC5lbnRyaWVzPGFueT4ocHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSk7XG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnbGlzdCcgJiYgaXRlbXMudHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAuLi5pdGVtcyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IE9iamVjdC5lbnRyaWVzPGFueT4oaXRlbXMucHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkXG59XG5cbmV4cG9ydCB0eXBlIFRJT1NjaGVtYUF0dHJpYnV0ZSA9IFJldHVyblR5cGU8dHlwZW9mIGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGU+O1xuZXhwb3J0IHR5cGUgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IE1hcDxrZXlvZiBTWyAnYXR0cmlidXRlcycgXSwgVElPU2NoZW1hQXR0cmlidXRlPjtcblxuLyoqXG4gKiBDcmVhdGVzIGFuIGFjY2VzcyBwYXR0ZXJucyBzY2hlbWEgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGVudGl0eSBzY2hlbWEuXG4gKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgQSBtYXAgb2YgYWNjZXNzIHBhdHRlcm5zLCB3aGVyZSB0aGUga2V5cyBhcmUgdGhlIGluZGV4IG5hbWVzIGFuZCB0aGUgdmFsdWVzIGFyZSBtYXBzIG9mIGF0dHJpYnV0ZSBuYW1lcyBhbmQgdGhlaXIgY29ycmVzcG9uZGluZyBzY2hlbWEgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihzY2hlbWE6IFMpIHtcbiAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG5ldyBNYXA8a2V5b2YgU1sgJ2luZGV4ZXMnIF0sIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4+KCk7XG5cbiAgICBmb3IgKGNvbnN0IGluZGV4TmFtZSBpbiBzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICBjb25zdCBpbmRleEF0dHJpYnV0ZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4gPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhQa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0ucGsuY29tcG9zaXRlKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgaWR4UGtBdHQgXTtcbiAgICAgICAgICAgIGluZGV4QXR0cmlidXRlcy5zZXQoaWR4UGtBdHQsIHtcbiAgICAgICAgICAgICAgICAuLi5lbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGlkeFBrQXR0LCB7IC4uLmF0dCwgcmVxdWlyZWQ6IHRydWUgfSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhTa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0uc2s/LmNvbXBvc2l0ZSA/PyBbXSkge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGlkeFNrQXR0IF07XG4gICAgICAgICAgICBpbmRleEF0dHJpYnV0ZXMuc2V0KGlkeFNrQXR0LCB7XG4gICAgICAgICAgICAgICAgLi4uZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShpZHhTa0F0dCwgeyAuLi5hdHQsIHJlcXVpcmVkOiB0cnVlIH0pXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFjY2Vzc1BhdHRlcm5zLnNldChpbmRleE5hbWUsIGluZGV4QXR0cmlidXRlcyk7XG4gICAgfVxuXG4gICAgLy8gbWFrZSBzdXJlIHRoZXJlJ3MgYSBwcmltYXJ5IGFjY2VzcyBwYXR0ZXJuO1xuICAgIGlmICghYWNjZXNzUGF0dGVybnMuaGFzKCdwcmltYXJ5JykpIHtcbiAgICAgICAgYWNjZXNzUGF0dGVybnMuc2V0KCdwcmltYXJ5JywgYWNjZXNzUGF0dGVybnMudmFsdWVzKCkubmV4dCgpLnZhbHVlISk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFjY2Vzc1BhdHRlcm5zO1xufVxuIl19