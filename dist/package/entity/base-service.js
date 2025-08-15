"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseEntityService = void 0;
exports.hasAttribute = hasAttribute;
exports.hasAttributeBy = hasAttributeBy;
exports.getAttributeNameBy = getAttributeNameBy;
exports.entityAttributeToIOSchemaAttribute = entityAttributeToIOSchemaAttribute;
exports.makeEntityAccessPatternsSchema = makeEntityAccessPatternsSchema;
const di_1 = require("../di");
const logging_1 = require("../logging");
const search_1 = require("../search");
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
        searchConfig.serviceClass = searchConfig.serviceClass || search_1.EntitySearchService;
        if (!searchConfig.indexConfig) {
            searchConfig.indexConfig = {};
        }
        searchConfig.indexConfig.indexName = searchConfig.indexConfig.indexName || (0, search_1.makeEntitySearchIndexName)({
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
            if (searchServiceTokenOrClass instanceof search_1.BaseSearchService) {
                return searchServiceTokenOrClass;
            }
            // Case 3: Service class provided
            if ((0, utils_1.isClassConstructor)(searchServiceTokenOrClass) &&
                (searchServiceTokenOrClass === search_1.EntitySearchService
                    ||
                        searchServiceTokenOrClass.prototype instanceof search_1.EntitySearchService)) {
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
     * Creates a new entity.
     *
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    async create(payload, _ctx) {
        const payloadCopy = { ...payload };
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
    async update(identifiers, data, operators, _ctx) {
        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;
        if (!skipCheckingAttributesUniqueness && uniqueFields.length) {
            let uniquenessChecks = [];
            for (const { name, readOnly } of uniqueFields) {
                if (readOnly) {
                    delete data[name];
                    continue;
                }
                if (name in data) {
                    let value = data[name];
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: data,
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
            data: data,
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
    async delete(identifiers, _ctx) {
        try {
            this.logger.debug(`Called ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);
            const deletedEntity = await (0, crud_service_1.deleteEntity)({
                id: identifiers,
                entityName: this.getEntityName(),
                entityService: this,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBNEJBLG9DQUVDO0FBRUQsd0NBRUM7QUFFRCxnREFnQkM7QUFraURELGdGQWlEQztBQVVELHdFQTZCQztBQTdxREQsOEJBQW9DO0FBT3BDLHdDQUEwQztBQUMxQyxzQ0FBaUg7QUFDakgsb0NBQWlOO0FBQ2pOLCtDQUFzRDtBQUN0RCxpREFBbUs7QUFDbkssdUVBQWtFO0FBQ2xFLHFDQUFnRTtBQUNoRSxtQ0FBNEg7QUFDNUgsc0NBQTZEO0FBWTdELFNBQWdCLFlBQVksQ0FBQyxNQUFtQyxFQUFFLGFBQXFCO0lBQ25GLE9BQU8sQ0FBQyxhQUFhLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELENBQUM7QUFFRCxTQUFnQixjQUFjLENBQUMsTUFBbUMsRUFBRSxJQUEwQjtJQUMxRixPQUFPLGtCQUFrQixDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxTQUFTLENBQUM7QUFDMUQsQ0FBQztBQUVELFNBQWdCLGtCQUFrQixDQUFDLE1BQW1DLEVBQUUsSUFBMEI7SUFFOUYsSUFBSSxjQUFjLEdBQUcsU0FBUyxJQUFBLGtCQUFVLEVBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQztJQUMxRCxJQUFJLGNBQWMsSUFBSSxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDakMsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFFLGNBQTJDLENBQVksQ0FBQztJQUNqRixDQUFDO0lBRUQsSUFBSSxZQUFZLENBQUMsTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsSUFBQSxrQkFBVSxFQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQ3BFLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxJQUFBLGtC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QzFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFO2dCQUMxQixHQUFHLGtDQUFrQyxDQUFDLFFBQVEsRUFBRSxFQUFFLEdBQUcsR0FBRyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQzthQUM5RSxDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQsS0FBSyxNQUFNLFFBQVEsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFFLFNBQVMsQ0FBRSxDQUFDLEVBQUUsRUFBRSxTQUFTLElBQUksRUFBRSxFQUFFLENBQUM7WUFDckUsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBRSxRQUFRLENBQUUsQ0FBQztZQUMxQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRTtnQkFDMUIsR0FBRyxrQ0FBa0MsQ0FBQyxRQUFRLEVBQUUsRUFBRSxHQUFHLEdBQUcsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7YUFDOUUsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUVELGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBTSxDQUFDLENBQUM7SUFDekUsQ0FBQztJQUVELE9BQU8sY0FBYyxDQUFDO0FBQzFCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gXCIuLi9kaVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlJbnB1dFZhbGlkYXRpb25zLCBFbnRpdHlWYWxpZGF0aW9ucyB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYSwgRW50aXR5QXR0cmlidXRlLCBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hLCBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYSwgRW50aXR5VHlwZUZyb21TY2hlbWEgYXMgRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEsIEh5ZHJhdGVPcHRpb25Gb3JFbnRpdHksIEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbiwgSHlkcmF0ZU9wdGlvbnNNYXBGb3JFbnRpdHksIFJlbGF0aW9uSWRlbnRpZmllciwgU3BlY2lhbEF0dHJpYnV0ZVR5cGUsIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hLCBVcHNlcnRFbnRpdHlJdGVtVHlwZUZyb21TY2hlbWEgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlGaWx0ZXJDcml0ZXJpYSwgRW50aXR5UXVlcnksIEVudGl0eVNlbGVjdGlvbnMsIFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzIH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcblxuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBEZXBJZGVudGlmaWVyLCBJRElDb250YWluZXIgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IEJhc2VTZWFyY2hTZXJ2aWNlLCBFbnRpdHlTZWFyY2hRdWVyeSwgRW50aXR5U2VhcmNoU2VydmljZSwgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaCc7XG5pbXBvcnQgeyBKc29uU2VyaWFsaXplciwgZ2V0VmFsdWVCeVBhdGgsIGlzQXJyYXksIGlzQm9vbGVhbiwgaXNDbGFzc0NvbnN0cnVjdG9yLCBpc0VtcHR5LCBpc0VtcHR5T2JqZWN0RGVlcCwgaXNGdW5jdGlvbiwgaXNPYmplY3QsIGlzU3RyaW5nLCBwYXNjYWxDYXNlLCBwaWNrS2V5cywgdG9IdW1hblJlYWRhYmxlTmFtZSwgdG9TbHVnIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBjcmVhdGVFbGVjdHJvREJFbnRpdHkgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHsgVXBkYXRlRW50aXR5T3BlcmF0b3JzLCBjcmVhdGVFbnRpdHksIGRlbGV0ZUVudGl0eSwgZ2V0QmF0Y2hFbnRpdHksIGdldEVudGl0eSwgbGlzdEVudGl0eSwgcXVlcnlFbnRpdHksIHVwZGF0ZUVudGl0eSwgdXBzZXJ0RW50aXR5IH0gZnJvbSBcIi4vY3J1ZC1zZXJ2aWNlXCI7XG5pbXBvcnQgeyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IgfSBmcm9tIFwiLi9lbnRpdHktc2NoZW1hLXZhbGlkYXRvclwiO1xuaW1wb3J0IHsgRGF0YWJhc2VFcnJvciwgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhLCBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkcywgcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyB9IGZyb20gXCIuL3F1ZXJ5XCI7XG5pbXBvcnQgeyBJbnRlcm5hbFNlcnZlckVycm9yLCBTZXJ2ZXJFcnJvciB9IGZyb20gXCIuLi9lcnJvcnNcIjtcblxuZXhwb3J0IHR5cGUgRXh0cmFjdEVudGl0eUlkZW50aWZpZXJzQ29udGV4dCA9IHtcbiAgICAvLyB0ZW5hbnRJZDogc3RyaW5nLCBcbiAgICBmb3JBY2Nlc3NQYXR0ZXJuPzogc3RyaW5nXG59XG5cbnR5cGUgR2V0T3B0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IHtcbiAgICBpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgIGF0dHJpYnV0ZXM/OiBFbnRpdHlTZWxlY3Rpb25zPFM+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGUoc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sIGF0dHJpYnV0ZU5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiAoYXR0cmlidXRlTmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoYXNBdHRyaWJ1dGVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcbiAgICByZXR1cm4gZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgc3BlYykgIT09IHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwgc3BlYzogU3BlY2lhbEF0dHJpYnV0ZVR5cGUpIHtcblxuICAgIGxldCBzcGVjQXR0TWV0YUtleSA9IGBlbnRpdHkke3Bhc2NhbENhc2Uoc3BlYyl9QXR0cmlidXRlYDtcbiAgICBpZiAoc3BlY0F0dE1ldGFLZXkgaW4gc2NoZW1hLm1vZGVsKSB7XG4gICAgICAgIHJldHVybiBzY2hlbWEubW9kZWxbIHNwZWNBdHRNZXRhS2V5IGFzIGtleW9mIHR5cGVvZiBzY2hlbWEubW9kZWwgXSBhcyBzdHJpbmc7XG4gICAgfVxuXG4gICAgaWYgKGhhc0F0dHJpYnV0ZShzY2hlbWEsIGAke3NjaGVtYS5tb2RlbC5lbnRpdHl9JHtwYXNjYWxDYXNlKHNwZWMpfWApKSB7XG4gICAgICAgIHJldHVybiBgJHtzY2hlbWEubW9kZWwuZW50aXR5fSR7cGFzY2FsQ2FzZShzcGVjKX1gO1xuICAgIH1cblxuICAgIGlmIChoYXNBdHRyaWJ1dGUoc2NoZW1hLCBzcGVjKSkge1xuICAgICAgICByZXR1cm4gc3BlYztcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZUVudGl0eVNlcnZpY2U8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ge1xuXG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKGBCYXNlRW50aXR5U2VydmljZToke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKTtcblxuICAgIHByb3RlY3RlZCBlbnRpdHlSZXBvc2l0b3J5PzogRW50aXR5UmVwb3NpdG9yeVR5cGVGcm9tU2NoZW1hPFM+O1xuICAgIHByb3RlY3RlZCBlbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE/OiBSZXR1cm5UeXBlPHR5cGVvZiB0aGlzLm1ha2VPcHNEZWZhdWx0SU9TY2hlbWE8Uz4+O1xuXG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHJlYWRvbmx5IHNjaGVtYTogUyxcbiAgICAgICAgcHJvdGVjdGVkIHJlYWRvbmx5IGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uLFxuICAgICAgICBwcm90ZWN0ZWQgcmVhZG9ubHkgZGlDb250YWluZXI6IElESUNvbnRhaW5lciA9IERJQ29udGFpbmVyLlJPT1QsXG4gICAgKSB7IH1cblxuICAgIHByb3RlY3RlZCBnZXRUYWJsZU5hbWUoKTogc3RyaW5nIHtcbiAgICAgICAgaWYgKCF0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSW50ZXJuYWxTZXJ2ZXJFcnJvcihgVGFibGUgbmFtZSBpcyByZXF1aXJlZCBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eUNvbmZpZ3VyYXRpb25zLnRhYmxlO1xuICAgIH1cblxuXG4gICAgcHVibGljIGdldEVudGl0eVNlYXJjaENvbmZpZyhfY3R4PzogRXhlY3V0aW9uQ29udGV4dDxhbnk+KSB7XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzY2hlbWEubW9kZWwuc2VhcmNoIHx8IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBpbmRleENvbmZpZzoge31cbiAgICAgICAgfTtcblxuICAgICAgICBzZWFyY2hDb25maWcuc2VydmljZUNsYXNzID0gc2VhcmNoQ29uZmlnLnNlcnZpY2VDbGFzcyB8fCBFbnRpdHlTZWFyY2hTZXJ2aWNlO1xuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5pbmRleE5hbWUgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcuaW5kZXhOYW1lIHx8IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUoe1xuICAgICAgICAgICAgZW50aXR5TmFtZTogc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgICAgIHRhYmxlTmFtZTogdGhpcy5nZXRUYWJsZU5hbWUoKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnByaW1hcnlLZXkgPSBzZWFyY2hDb25maWcuaW5kZXhDb25maWcucHJpbWFyeUtleSB8fCB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGVudGl0eVNlYXJjaGFibGVBdHRyaWJ1dGVzID0gdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcbiAgICAgICAgY29uc3QgZW50aXR5RmlsdGVyYWJsZUF0dHJpYnV0ZXMgPSB0aGlzLmdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpO1xuXG4gICAgICAgIHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncyA9IHtcbiAgICAgICAgICAgIC4uLihzZWFyY2hDb25maWcuaW5kZXhDb25maWcuc2V0dGluZ3MgfHwge30pLFxuICAgICAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5zZWFyY2hhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlTZWFyY2hhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgZmlsdGVyYWJsZUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgICAgICAuLi4oc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcyB8fCBlbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlcyksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgc29ydGFibGVBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICAgICAgLi4uKHNlYXJjaENvbmZpZy5pbmRleENvbmZpZy5zZXR0aW5ncz8uc29ydGFibGVBdHRyaWJ1dGVzIHx8IGVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VhcmNoQ29uZmlnO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiBzZWFyY2ggaXMgZW5hYmxlZCBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUcnVlIGlmIHNlYXJjaCBpcyBlbmFibGVkLCBmYWxzZSBvdGhlcndpc2UuXG4gICAgICovXG4gICAgcHVibGljIGlzU2VhcmNoRW5hYmxlZCgpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcbiAgICAgICAgcmV0dXJuIEJvb2xlYW4oc2VhcmNoQ29uZmlnPy5lbmFibGVkKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIHRoZSBzZWFyY2ggc2VydmljZSBmb3IgdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgc2VhcmNoIHNlcnZpY2UuXG4gICAgICovXG4gICAgcHVibGljIGdldFNlYXJjaFNlcnZpY2UoKTogRW50aXR5U2VhcmNoU2VydmljZTxTPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldEVudGl0eVNlYXJjaENvbmZpZygpO1xuXG4gICAgICAgICAgICAvLyBTa2lwIHNlYXJjaCBsb2dpYyBpZiBzZWFyY2ggaXMgbm90IGVuYWJsZWRcbiAgICAgICAgICAgIGlmICghc2VhcmNoQ29uZmlnPy5lbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggaXMgbm90IGVuYWJsZWQgZm9yIGVudGl0eSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfS5gKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgc2VhcmNoIGNvbmZpZ3VyYXRpb24gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKHNlYXJjaENvbmZpZykge1xuICAgICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVTZWFyY2hDb25maWcoc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9IHNlYXJjaENvbmZpZz8uc2VydmljZUNsYXNzO1xuXG4gICAgICAgICAgICAvLyBDYXNlIDE6IERJIENvbnRhaW5lciBoYXMgdGhlIHNlcnZpY2VcbiAgICAgICAgICAgIGlmIChzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzICYmIHRoaXMuZGlDb250YWluZXIuaGFzKHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3MgYXMgRGVwSWRlbnRpZmllcjxFbnRpdHlTZWFyY2hTZXJ2aWNlPGFueT4+KSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmU8RW50aXR5U2VhcmNoU2VydmljZTxTPj4oc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyBEZXBJZGVudGlmaWVyPEVudGl0eVNlYXJjaFNlcnZpY2U8Uz4+KTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHJlc29sdmUgc2VhcmNoIHNlcnZpY2UgZnJvbSBjb250YWluZXI6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVzb2x2ZSBzZWFyY2ggc2VydmljZSBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2FzZSAyOiBTZXJ2aWNlIGluc3RhbmNlIHByb3ZpZGVkXG4gICAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBpbnN0YW5jZW9mIEJhc2VTZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNlYXJjaFNlcnZpY2VUb2tlbk9yQ2xhc3M7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhc2UgMzogU2VydmljZSBjbGFzcyBwcm92aWRlZFxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGlzQ2xhc3NDb25zdHJ1Y3RvcihzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzKSAmJlxuICAgICAgICAgICAgICAgIChcbiAgICAgICAgICAgICAgICAgICAgc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyA9PT0gRW50aXR5U2VhcmNoU2VydmljZVxuICAgICAgICAgICAgICAgICAgICB8fFxuICAgICAgICAgICAgICAgICAgICBzZWFyY2hTZXJ2aWNlVG9rZW5PckNsYXNzLnByb3RvdHlwZSBpbnN0YW5jZW9mIEVudGl0eVNlYXJjaFNlcnZpY2VcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCB0byBjb25maWd1cmUgdGhpcyB3aXRob3V0IG5lZWRpbmcgdG8gdXNlIHRoZSBESVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hFbmdpbmUgPSB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVTZWFyY2hFbmdpbmUoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzZWFyY2hFbmdpbmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGVuZ2luZSBub3QgZm91bmQgaW4gY29udGFpbmVyJyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyAoc2VhcmNoU2VydmljZVRva2VuT3JDbGFzcyBhcyB0eXBlb2YgRW50aXR5U2VhcmNoU2VydmljZSkoXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2VhcmNoRW5naW5lLFxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFudGlhdGUgc2VhcmNoIHNlcnZpY2U6JywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIHNlYXJjaCBzZXJ2aWNlIGluc3RhbmNlIGZvciBlbnRpdHkgJHt0aGlzLmdldEVudGl0eU5hbWUoKX06ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHZhbGlkIHNlYXJjaC1zZXJ2aWNlLWNvbmZpZ3VyYXRpb24gZm91bmQgZm9yIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciBpbiBnZXRTZWFyY2hTZXJ2aWNlOicsIGVycik7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIGluaXRpYWxpemF0aW9uIGZhaWxlZCBmb3IgZW50aXR5ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB2YWxpZGF0ZVNlYXJjaENvbmZpZyhzZWFyY2hDb25maWc6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PlsgJ21vZGVsJyBdWyAnc2VhcmNoJyBdKSB7XG5cbiAgICAgICAgaWYgKCFzZWFyY2hDb25maWcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU2VhcmNoIGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlYXJjaCBjb25maWd1cmF0aW9uIG11c3QgaW5jbHVkZSBhIGNvbmZpZyBvYmplY3QnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgaW5kZXhDb25maWc6IGNvbmZpZyB9ID0gc2VhcmNoQ29uZmlnO1xuXG4gICAgICAgIGlmICghY29uZmlnLmluZGV4TmFtZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlndXJhdGlvbiBtdXN0IHNwZWNpZnkgYW4gaW5kZXhOYW1lJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBzZWFyY2hhYmxlIGF0dHJpYnV0ZXMgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb25maWcuc2V0dGluZ3M/LnNlYXJjaGFibGVBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IGNvbmZpZy5zZXR0aW5ncy5zZWFyY2hhYmxlQXR0cmlidXRlcy5maWx0ZXIoXG4gICAgICAgICAgICAgICAgKGF0dHI6IHN0cmluZykgPT4gIWhhc0F0dHJpYnV0ZSh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBhdHRyKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNlYXJjaGFibGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29uZmlnLnNldHRpbmdzPy5maWx0ZXJhYmxlQXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBjb25maWcuc2V0dGluZ3MuZmlsdGVyYWJsZUF0dHJpYnV0ZXMuZmlsdGVyKFxuICAgICAgICAgICAgICAgIChhdHRyOiBzdHJpbmcpID0+ICFoYXNBdHRyaWJ1dGUodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgYXR0cilcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmaWx0ZXJhYmxlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyBhc3luYyB0cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eTogRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICByZXR1cm4gYXdhaXQgc2VhcmNoU2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG4gICAgfVxuXG4gICAgcHVibGljIHZhbGlkYXRlRW50aXR5U2NoZW1hKCkge1xuICAgICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgRW50aXR5U2NoZW1hVmFsaWRhdG9yKHRoaXMuZGlDb250YWluZXIpO1xuICAgICAgICB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoXG4gICAgICAgICAgICB0aGlzLmdldEVudGl0eVNjaGVtYSgpLFxuICAgICAgICAgICAgdGhpcy5lbnRpdHlDb25maWd1cmF0aW9uc1xuICAgICAgICApO1xuICAgIH1cblxuICAgIGdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWU8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlRW50aXR5U2VydmljZTxCYXNlRW50aXR5U2VydmljZTxUPj4ocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIGhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTZXJ2aWNlKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBnZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8VCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4ocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlRW50aXR5U2NoZW1hPFQ+KHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICBoYXNFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWUocmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEocmVsYXRlZEVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dHJhY3RzIGVudGl0eSBpZGVudGlmaWVycyBmcm9tIHRoZSBpbnB1dCBvYmplY3QgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGNvbnRleHQgdG8gZnVsZmlsbCBhbiBpbmRleC5cbiAgICAgKiBlLmcuIGVudGl0eUlkLCB0ZW5hbnRJZCwgcGFydGl0aW9uLWtleXMuLi4uIGV0Y1xuICAgICAqIGl0IGlzIHVzZWQgYnkgdGhlIGBCYXNlRW50aXR5U2VydmljZWAgdG8gZmluZCB0aGUgcmlnaHQgZW50aXR5IGZvciBgZ2V0YC9gdXBkYXRlYC9gZGVsZXRlYCBvcGVyYXRpb25zXG4gICAgICogXG4gICAgICogQHRlbXBsYXRlIFMgLSBUaGUgdHlwZSBvZiB0aGUgZW50aXR5IHNjaGVtYS5cbiAgICAgKiBAcGFyYW0gaW5wdXQgLSBUaGUgaW5wdXQgb2JqZWN0IGZyb20gd2hpY2ggdG8gZXh0cmFjdCB0aGUgaWRlbnRpZmllcnMuXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgY29udGFpbmluZyBhZGRpdGlvbmFsIGluZm9ybWF0aW9uIGZvciBleHRyYWN0aW9uLlxuICAgICAqIEBwYXJhbSBjb250ZXh0LmZvckFjY2Vzc1BhdHRlcm4gLSBUaGUgYWNjZXNzIHBhdHRlcm4gZm9yIHdoaWNoIHRvIGV4dHJhY3QgdGhlIGlkZW50aWZpZXJzLlxuICAgICAqIEByZXR1cm5zIFRoZSBleHRyYWN0ZWQgZW50aXR5IGlkZW50aWZpZXJzLlxuICAgICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgaW5wdXQgaXMgbWlzc2luZyBvciBub3QgYW4gb2JqZWN0LlxuICAgICAqIFxuICAgICAqIGUuZy4gXG4gICAgICogSU4gICA9PT4gYFJlcXVlc3RgIG9iamVjdCB3aXRoIGhlYWRlcnMsIGJvZHksIGF1dGgtY29udGV4dCBldGNcbiAgICAgKiBPVVQgID09PiB7IHRlbmFudElkOiB4eHgsIGVtYWlsOiB4eHhAeXl5LmNvbSwgc29tZS1wYXJ0aXRpb24ta2V5OiB4eC15eS16eiB9XG4gICAgICpcbiAgICAgKi9cbiAgICBleHRyYWN0RW50aXR5SWRlbnRpZmllcnMoXG4gICAgICAgIGlucHV0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgc3RyaW5nPj4sXG4gICAgICAgIGNvbnRleHQ6IEV4dHJhY3RFbnRpdHlJZGVudGlmaWVyc0NvbnRleHQgPSB7XG4gICAgICAgICAgICAvLyB0ZW5hbnRJZDogJ3h4eC15eXktenp6J1xuICAgICAgICB9XG4gICAgKTogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiB8IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+IHtcblxuICAgICAgICBpZiAoIWlucHV0IHx8IHR5cGVvZiBpbnB1dCAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW5wdXQgaXMgcmVxdWlyZWQgYW5kIG11c3QgYmUgYW4gb2JqZWN0IGNvbnRhaW5pbmcgZW50aXR5LWlkZW50aWZpZXJzIG9yIGFuIGFycmF5IG9mIG9iamVjdHMgY29udGFpbmluZyBlbnRpdHktaWRlbnRpZmllcnMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlzQmF0Y2hJbnB1dCA9IGlzQXJyYXkoaW5wdXQpO1xuXG4gICAgICAgIGNvbnN0IGlucHV0cyA9IGlzQmF0Y2hJbnB1dCA/IGlucHV0IDogWyBpbnB1dCBdO1xuXG4gICAgICAgIC8vIFRPRE86IHRlbmFudCBsb2dpY1xuICAgICAgICAvLyBpZGVudGlmaWVyc1sndGVuYW50SWQnXSA9IGlucHV0LnRlbmFudElkIHx8IGNvbnRleHQudGVuYW50SWQ7XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWEodGhpcy5nZXRFbnRpdHlTY2hlbWEoKSk7XG5cbiAgICAgICAgY29uc3QgaWRlbnRpZmllckF0dHJpYnV0ZXMgPSBuZXcgU2V0PHsgbmFtZTogc3RyaW5nLCByZXF1aXJlZDogYm9vbGVhbiB9PigpO1xuICAgICAgICBmb3IgKGNvbnN0IFsgYWNjZXNzUGF0dGVybk5hbWUsIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzIF0gb2YgYWNjZXNzUGF0dGVybnMpIHtcbiAgICAgICAgICAgIGlmICghY29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuIHx8IGFjY2Vzc1BhdHRlcm5OYW1lID09IGNvbnRleHQuZm9yQWNjZXNzUGF0dGVybikge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIGF0dCBdIG9mIGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJBdHRyaWJ1dGVzLmFkZCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBhdHQuaWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogYXR0LnJlcXVpcmVkID09IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcHJpbWFyeUF0dE5hbWUgPSB0aGlzLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzQmF0Y2ggPSBpbnB1dHMubWFwKGlucHV0ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBhbnkgPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBuYW1lOiBhdHROYW1lLCByZXF1aXJlZCB9IG9mIGlkZW50aWZpZXJBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKChhdHROYW1lIGluIGlucHV0KSkge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyc1sgYXR0TmFtZSBdID0gaW5wdXRbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGF0dE5hbWUgPT0gcHJpbWFyeUF0dE5hbWUgJiYgKCdpZCcgaW4gaW5wdXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJzWyBhdHROYW1lIF0gPSBpbnB1dC5pZDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlcXVpcmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYHJlcXVpcmVkIGF0dHJpYnV0ZTogJHthdHROYW1lfSBmb3IgYWNjZXNzLXBhdHRlcm46ICR7Y29udGV4dC5mb3JBY2Nlc3NQYXR0ZXJuID8/ICctLXByaW1hcnktLSd9IGlzIG5vdCBmb3VuZCBpbiBpbnB1dDpgLCBpbnB1dCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGlkZW50aWZpZXJzIGFzIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz47XG4gICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRXh0cmFjdGluZyBpZGVudGlmaWVycyBmcm9tIGlkZW50aWZpZXJzOicsIGlkZW50aWZpZXJzQmF0Y2gpO1xuXG4gICAgICAgIHJldHVybiBpc0JhdGNoSW5wdXQgPyBpZGVudGlmaWVyc0JhdGNoIDogaWRlbnRpZmllcnNCYXRjaFsgMCBdO1xuICAgIH07XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5TmFtZSgpOiBTWyAnbW9kZWwnIF1bICdlbnRpdHknIF0geyByZXR1cm4gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKS5tb2RlbC5lbnRpdHk7IH1cblxuICAgIHB1YmxpYyBnZXRFbnRpdHlTY2hlbWEoKTogUyB7IHJldHVybiB0aGlzLnNjaGVtYTsgfVxuXG4gICAgcHVibGljIGdldFJlcG9zaXRvcnkoKSB7XG4gICAgICAgIGlmICghdGhpcy5lbnRpdHlSZXBvc2l0b3J5KSB7XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eSB9ID0gY3JlYXRlRWxlY3Ryb0RCRW50aXR5KHtcbiAgICAgICAgICAgICAgICBzY2hlbWE6IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IHRoaXMuZW50aXR5Q29uZmlndXJhdGlvbnNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5lbnRpdHlSZXBvc2l0b3J5ID0gZW50aXR5IGFzIEVudGl0eVJlcG9zaXRvcnlUeXBlRnJvbVNjaGVtYTxTPjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmVudGl0eVJlcG9zaXRvcnkhO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBsYWNlaG9sZGVyIGZvciB0aGUgZW50aXR5IHZhbGlkYXRpb25zOyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgeW91ciBvd24gdmFsaWRhdGlvbnNcbiAgICAgKiBAcmV0dXJucyBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgZW50aXR5IHZhbGlkYXRpb25zLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRFbnRpdHlWYWxpZGF0aW9ucygpOiBFbnRpdHlWYWxpZGF0aW9uczxTPiB8IEVudGl0eUlucHV0VmFsaWRhdGlvbnM8Uz4ge1xuICAgICAgICByZXR1cm4ge307XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFBsYWNlaG9sZGVyIGZvciB0aGUgY3VzdG9tIHZhbGlkYXRpb24tZXJyb3ItbWVzc2FnZXM7IG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSB5b3VyIG93biBlcnJvci1tZXNzYWdlcy5cbiAgICAgKiBAcmV0dXJucyBBIG1hcCBjb250YWluaW5nIHRoZSBjdXN0b20gdmFsaWRhdGlvbi1lcnJvci1tZXNzYWdlcy5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHRzXG4gICAgICogIHB1YmxpYyBhc3luYyBnZXRPdmVycmlkZGVuRW50aXR5VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgICogICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCBuZXcgTWFwPHN0cmluZywgc3RyaW5nPiggXG4gICAgICogICAgICAgICAgT2JqZWN0LmVudHJpZXMoeyBcbiAgICAgKiAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24uZW1haWwucmVxdWlyZWQnOiAnRW1haWwgaXMgcmVxdWlyZWQhISEhIScsIFxuICAgICAqICAgICAgICAgICAgICAndmFsaWRhdGlvbi5wYXNzd29yZC5yZXF1aXJlZCc6ICdQYXNzd29yZCBpcyByZXF1aXJlZCEhISEhJ1xuICAgICAqICAgICAgICAgIH0pXG4gICAgICogICAgICApKTtcbiAgICAgKiB9XG4gICAgICogYGBgXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGdldE92ZXJyaWRkZW5FbnRpdHlWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCkge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGlmIChhdHQuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF0dE5hbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICogR2VuZXJhdGVzIHRoZSBkZWZhdWx0IGlucHV0IGFuZCBvdXRwdXQgc2NoZW1hcyBmb3IgdmFyaW91cyBvcGVyYXRpb25zIG9mIGFuIGVudGl0eS5cbiAqIFxuICogQHRlbXBsYXRlIFMgLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICogQHRlbXBsYXRlIE9wcyAtIFRoZSB0eXBlIG9mIGVudGl0eSBvcGVyYXRpb25zLlxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gVGhlIGVudGl0eSBzY2hlbWEuXG4gKiBAcmV0dXJucyBUaGUgZGVmYXVsdCBpbnB1dCBhbmQgb3V0cHV0IHNjaGVtYXMgZm9yIHRoZSBlbnRpdHkgb3BlcmF0aW9ucy5cbiAqL1xuICAgIHByb3RlY3RlZCBtYWtlT3BzRGVmYXVsdElPU2NoZW1hPFxuICAgICAgICBTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnksIE9wcz4sXG4gICAgICAgIE9wcyBleHRlbmRzIFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyA9IFREZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICA+KHNjaGVtYTogUykge1xuXG4gICAgICAgIGNvbnN0IGlucHV0U2NoZW1hQXR0cmlidXRlcyA9IHtcbiAgICAgICAgICAgIGNyZWF0ZTogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgICAgICB1cGRhdGU6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgICAgICBkZXRhaWw6IG5ldyBNYXAoKSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgICAgICAgICAgbGlzdDogbmV3IE1hcCgpIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gY3JlYXRlIGFuZCB1cGRhdGVcbiAgICAgICAgZm9yIChjb25zdCBhdHROYW1lIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSB7XG5cbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWRBdHQgPSBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGF0dE5hbWUsIGF0dCk7XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaGlkZGVuKSB7XG4gICAgICAgICAgICAgICAgLy8gaWYgaXQncyBtYXJrZWQgYXMgaGlkZGVuIGl0J3Mgbm90IHZpc2libGUgdG8gYW55IG9wXG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNWaXNpYmxlKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzTGlzdGFibGUpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXRTY2hlbWFBdHRyaWJ1dGVzLmxpc3Quc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm9ybWF0dGVkQXR0LmlzQ3JlYXRhYmxlKSB7XG4gICAgICAgICAgICAgICAgaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZS5zZXQoYXR0TmFtZSwgeyAuLi5mb3JtYXR0ZWRBdHQgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChmb3JtYXR0ZWRBdHQuaXNFZGl0YWJsZSkge1xuICAgICAgICAgICAgICAgIGlucHV0U2NoZW1hQXR0cmlidXRlcy51cGRhdGUuc2V0KGF0dE5hbWUsIHsgLi4uZm9ybWF0dGVkQXR0IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUGF0dGVybnMgPSBtYWtlRW50aXR5QWNjZXNzUGF0dGVybnNTY2hlbWEoc2NoZW1hKTtcblxuICAgICAgICAvLyBpZiB0aGVyZSdzIGFuIGluZGV4IG5hbWVkIGBwcmltYXJ5YCwgdXNlIHRoYXQsIGVsc2UgZmFsbGJhY2sgdG8gZmlyc3QgaW5kZXhcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcbiAgICAgICAgLy8gYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2RlbGV0ZSddID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5JykgPz8gYWNjZXNzUGF0dGVybnMuZW50cmllcygpLm5leHQoKS52YWx1ZTtcblxuXG4gICAgICAgIC8vIGZvcihjb25zdCBhcCBvZiBhY2Nlc3NQYXR0ZXJucy5rZXlzKCkpe1xuICAgICAgICAvLyBcdGFjY2Vzc1BhdHRlcm5BdHRyaWJ1dGVzW2BnZXRfJHthcH1gXSA9IGFjY2Vzc1BhdHRlcm5zLmdldChhcCk7XG4gICAgICAgIC8vIFx0YWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbYGRlbGV0ZV8ke2FwfWBdID0gYWNjZXNzUGF0dGVybnMuZ2V0KGFwKTtcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIC8vIGNvbnN0IGlucHV0U2NoZW1hQXR0cmlidXRlczogYW55ID0ge307XHRcbiAgICAgICAgLy8gaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWydjcmVhdGUnXSA9IHtcbiAgICAgICAgLy8gXHQnaWRlbnRpZmllcnMnOiBhY2Nlc3NQYXR0ZXJuQXR0cmlidXRlc1snZ2V0J10sXG4gICAgICAgIC8vIFx0J2RhdGEnOiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXNbJ2NyZWF0ZSddLFxuICAgICAgICAvLyB9XG4gICAgICAgIC8vIGlucHV0U2NoZW1hQXR0cmlidXRlc1sndXBkYXRlJ10gPSB7XG4gICAgICAgIC8vIFx0J2lkZW50aWZpZXJzJzogYWNjZXNzUGF0dGVybkF0dHJpYnV0ZXNbJ2dldCddLFxuICAgICAgICAvLyBcdCdkYXRhJzogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzWyd1cGRhdGUnXSxcbiAgICAgICAgLy8gfVxuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuID0gYWNjZXNzUGF0dGVybnMuZ2V0KCdwcmltYXJ5Jyk7XG5cbiAgICAgICAgLy8gVE9ETzogYWRkIHNjaGVtYSBmb3IgdGhlIHJlc3QgZm8gdGhlIHNlY29uZGFyeSBhY2Nlc3MtcGF0dGVybnNcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZ2V0OiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsIC8vIGRlZmF1bHQgZm9yIHRoZSBkZXRhaWwgcGFnZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGR1cGxpY2F0ZToge1xuICAgICAgICAgICAgICAgIGJ5OiBkZWZhdWx0QWNjZXNzUGF0dGVybixcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMuZGV0YWlsLCAvLyBkZWZhdWx0IGZvciB0aGUgZGV0YWlsIHBhZ2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZWxldGU6IHtcbiAgICAgICAgICAgICAgICBieTogZGVmYXVsdEFjY2Vzc1BhdHRlcm5cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjcmVhdGU6IHtcbiAgICAgICAgICAgICAgICBpbnB1dDogaW5wdXRTY2hlbWFBdHRyaWJ1dGVzLmNyZWF0ZSxcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IG91dHB1dFNjaGVtYUF0dHJpYnV0ZXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdXBkYXRlOiB7XG4gICAgICAgICAgICAgICAgYnk6IGRlZmF1bHRBY2Nlc3NQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIGlucHV0OiBpbnB1dFNjaGVtYUF0dHJpYnV0ZXMudXBkYXRlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5kZXRhaWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbGlzdDoge1xuICAgICAgICAgICAgICAgIG91dHB1dDogb3V0cHV0U2NoZW1hQXR0cmlidXRlcy5saXN0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGRlZmF1bHQgaW5wdXQvb3V0cHV0IHNjaGVtYSBmb3IgZW50aXR5IG9wZXJhdGlvbnMuXG4gICAgICogXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0T3BzRGVmYXVsdElPU2NoZW1hKCkge1xuICAgICAgICBpZiAoIXRoaXMuZW50aXR5T3BzRGVmYXVsdElvU2NoZW1hKSB7XG4gICAgICAgICAgICB0aGlzLmVudGl0eU9wc0RlZmF1bHRJb1NjaGVtYSA9IHRoaXMubWFrZU9wc0RlZmF1bHRJT1NjaGVtYTxTPih0aGlzLmdldEVudGl0eVNjaGVtYSgpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5lbnRpdHlPcHNEZWZhdWx0SW9TY2hlbWE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhbiBhcnJheSBvZiBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLiBVc2VkIGJ5IHRoZSBgZGV0YWlsYCBBUEkgdG8gc2VyaWFsaXplIHRoZSBlbnRpdHkuXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IEFuIGFycmF5IG9mIGRlZmF1bHQgc2VyaWFsaXphdGlvbiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTogRW50aXR5U2VsZWN0aW9uczxTPiB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwID0gdGhpcy5nZXRPcHNEZWZhdWx0SU9TY2hlbWEoKS5nZXQub3V0cHV0O1xuXG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXM6IGFueSA9IHt9O1xuICAgICAgICBkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5mb3JFYWNoKChfLCBrZXkpID0+IHtcbiAgICAgICAgICAgIC8vIGlmICghdmFsLnJlbGF0aW9uIHx8IHZhbC5yZWxhdGlvbi5oeWRyYXRlKSB7XG4gICAgICAgICAgICAvLyB9XG4gICAgICAgICAgICBhdHRyaWJ1dGVzWyBrZXkgXSA9IHRydWVcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZXMgYXMgRW50aXR5U2VsZWN0aW9uczxTPjtcblxuICAgICAgICAvLyAgcmV0dXJuIEFycmF5LmZyb20oIGRlZmF1bHRPdXRwdXRTY2hlbWFBdHRyaWJ1dGVzTWFwLmtleXMoKSApIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBhdHRyaWJ1dGUgbmFtZXMgZm9yIGxpc3RpbmcgYW5kIHNlYXJjaCBBUEkuIERlZmF1bHRzIHRvIHRoZSBkZWZhdWx0IHNlcmlhbGl6YXRpb24gYXR0cmlidXRlIG5hbWVzLlxuICAgICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSBBbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMuXG4gICAgICovXG4gICAgcHVibGljIGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpOiBFbnRpdHlTZWxlY3Rpb25zPFM+IHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE91dHB1dFNjaGVtYUF0dHJpYnV0ZXNNYXAgPSB0aGlzLmdldE9wc0RlZmF1bHRJT1NjaGVtYSgpLmxpc3Qub3V0cHV0O1xuICAgICAgICByZXR1cm4gQXJyYXkuZnJvbShkZWZhdWx0T3V0cHV0U2NoZW1hQXR0cmlidXRlc01hcC5rZXlzKCkpIGFzIEVudGl0eVNlbGVjdGlvbnM8Uz47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGUgbmFtZXMgdG8gYmUgdXNlZCBmb3Iga2V5d29yZCBzZWFyY2guIERlZmF1bHRzIHRvIGFsbCBzdHJpbmcgYXR0cmlidXRlcyB3aGljaCBhcmUgbm90IGhpZGRlbiBhbmQgYXJlIG5vdCBpZGVudGlmaWVycy5cbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gYXR0cmlidXRlIG5hbWVzIHRvIGJlIHVzZWQgZm9yIGtleXdvcmQgc2VhcmNoXG4gICAgKi9cbiAgICBwdWJsaWMgZ2V0U2VhcmNoYWJsZUF0dHJpYnV0ZU5hbWVzKCk6IEFycmF5PHN0cmluZz4ge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEVudGl0eVNjaGVtYSgpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYXR0TmFtZSBpbiBzY2hlbWEuYXR0cmlidXRlcykge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGF0dE5hbWUgXTtcbiAgICAgICAgICAgIGlmICghYXR0LmhpZGRlbiAmJiAhYXR0LmlzSWRlbnRpZmllciAmJiBhdHQudHlwZSA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgICAmJlxuICAgICAgICAgICAgICAgICghKCdpc1NlYXJjaGFibGUnIGluIGF0dCkgfHwgYXR0LmlzU2VhcmNoYWJsZSlcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU5hbWVzLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXR0cmlidXRlTmFtZXM7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSB1bmlxdWUgYXR0cmlidXRlcyBvZiB0aGUgZW50aXR5LiBcbiAgICAgKiBEZWZhdWx0cyB0byBhbGwgYXR0cmlidXRlcyB3aGljaCBhcmUgbWFya2VkIGFzIHVuaXF1ZSBvciBhcmUgaWRlbnRpZmllcnM7IFxuICAgICAqIE9yIGlmIHRoZXkgYXJlIHBhcnQgb2YgYSBjb21wb3NpdGUgcHJpbWFyeSBrZXkgd2hlcmUgdGhlIGNvbXBvc2l0ZSBsZW5ndGggaXMgMS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyB7QXJyYXk8RW50aXR5QXR0cmlidXRlPn0gdW5pcXVlIGF0dHJpYnV0ZXMgb2YgdGhlIGVudGl0eVxuICAgICovXG4gICAgcHVibGljIGdldFVuaXF1ZUF0dHJpYnV0ZXMoKTogQXJyYXk8RW50aXR5QXR0cmlidXRlPiB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG5cbiAgICAgICAgICAgIGxldCBpc1VuaXF1ZSA9ICgnaXNVbmlxdWUnIGluIGF0dCkgPyBhdHQuaXNVbmlxdWUgOiBhdHQuaXNJZGVudGlmaWVyO1xuXG4gICAgICAgICAgICBpZiAoaXNVbmlxdWUpIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAuLi5hdHQsXG4gICAgICAgICAgICAgICAgICAgIGlzVW5pcXVlLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBhdHROYW1lLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBhdHRyaWJ1dGUgbmFtZXMgdGhhdCBjYW4gYmUgdXNlZCBmb3IgZmlsdGVyaW5nIHRoZSByZWNvcmRzLiBEZWZhdWx0cyB0byBhbGwgc3RyaW5nIGF0dHJpYnV0ZXMgd2hpY2ggYXJlIG5vdCBoaWRkZW4uXG4gICAgICogXG4gICAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IGF0dHJpYnV0ZSBuYW1lcyB0byBiZSB1c2VkIGZvciBrZXl3b3JkIHNlYXJjaFxuICAgICovXG4gICAgcHVibGljIGdldEZpbHRlcmFibGVBdHRyaWJ1dGVOYW1lcygpOiBBcnJheTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGF0dE5hbWUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGF0dCA9IHNjaGVtYS5hdHRyaWJ1dGVzWyBhdHROYW1lIF07XG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgIWF0dC5oaWRkZW4gJiYgWyAnc3RyaW5nJywgJ251bWJlcicgXS5pbmNsdWRlcyhhdHQudHlwZSBhcyBzdHJpbmcpXG4gICAgICAgICAgICAgICAgJiZcbiAgICAgICAgICAgICAgICAoISgnaXNGaWx0ZXJhYmxlJyBpbiBhdHQpIHx8IGF0dC5pc0ZpbHRlcmFibGUpXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5wdXNoKGF0dE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KHJlY29yZDogVCwgYXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpKTogUGFydGlhbDxUPiB7XG5cbiAgICAgICAgbGV0IGtleXM6IEFycmF5PHN0cmluZz47XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoYXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBrZXlzID0gT2JqZWN0LmtleXMocGFyc2VkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGtleXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBwaWNrS2V5czxUPihyZWNvcmQsIC4uLmtleXMpO1xuICAgIH1cblxuICAgIHB1YmxpYyBzZXJpYWxpemVSZWNvcmRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihyZWNvcmQ6IEFycmF5PFQ+LCBhdHRyaWJ1dGVzID0gdGhpcy5nZXREZWZhdWx0U2VyaWFsaXphdGlvbkF0dHJpYnV0ZU5hbWVzKCkpOiBBcnJheTxQYXJ0aWFsPFQ+PiB7XG4gICAgICAgIHJldHVybiByZWNvcmQubWFwKHJlY29yZCA9PiB0aGlzLnNlcmlhbGl6ZVJlY29yZDxUPihyZWNvcmQsIGF0dHJpYnV0ZXMpKTtcbiAgICB9XG5cbiAgICBhc3luYyBoeWRyYXRlUmVjb3JkcyhcbiAgICAgICAgcmVsYXRpb25zOiBBcnJheTxbIHJlbGF0ZWRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IEh5ZHJhdGVPcHRpb25Gb3JSZWxhdGlvbjxhbnk+IF0+LFxuICAgICAgICByb290RW50aXR5UmVjb3JkczogQXJyYXk8eyBbIHg6IHN0cmluZyBdOiBhbnk7IH0+XG4gICAgKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVSZWNvcmRzJyBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWApO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChyZWxhdGlvbnM/Lm1hcChhc3luYyAoWyByZWxhdGVkQXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVTaW5nbGVSZWxhdGlvbihyb290RW50aXR5UmVjb3JkcywgcmVsYXRlZEF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMpO1xuICAgICAgICB9KSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlU2luZ2xlUmVsYXRpb24ocm9vdEVudGl0eVJlY29yZHM6IGFueVtdLCByZWxhdGVkQXR0cmlidXRlTmFtZTogc3RyaW5nLCBvcHRpb25zOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb248YW55Pikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlU2luZ2xlUmVsYXRpb24nIHJlbGF0aW9uOiAke3JlbGF0ZWRBdHRyaWJ1dGVOYW1lfSBmb3IgZW50aXR5OiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfWAsIHtcbiAgICAgICAgICAgIG9wdGlvbnNcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSwgcmVsYXRpb25UeXBlLCBpZGVudGlmaWVycyB9ID0gb3B0aW9ucztcblxuICAgICAgICBpZiAoIWlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICB0aHJvdyAoYE5vIElkZW50aWZpZXJzOlske3JlbGF0aW9uVHlwZX06JHtyZWxhdGVkRW50aXR5TmFtZX1dIHByb3ZpZGVkYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVsYXRpb25UeXBlID09ICdvbmUtdG8tb25lJyB8fCByZWxhdGlvblR5cGUgPT0gJ21hbnktdG8tbWFueScpIHtcbiAgICAgICAgICAgIHRocm93IChgUmVsYXRpb25UeXBlOlske3JlbGF0aW9uVHlwZX06JHtyZWxhdGVkRW50aXR5TmFtZX1dIGluIG5vdCBzdXBwb3J0ZWQgYnkgaHlkcmF0aW9uLCB1c2Ugb25lIG9mIFttYW55LXRvLW9uZSwgb25lLXRvLW1hbnldIG90IG1hbnVhbGx5IGh5ZHJhdGUnYClcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCByZWxhdGVkIGVudGl0eSBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKHJlbGF0ZWRFbnRpdHlOYW1lKTtcbiAgICAgICAgaWYgKCFyZWxhdGVkRW50aXR5U2VydmljZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzZXJ2aWNlIGZvdW5kIGZvciByZWxhdGlvbnNoaXA6ICR7cmVsYXRlZEF0dHJpYnV0ZU5hbWV9KCR7cmVsYXRlZEVudGl0eU5hbWV9KTsgcGxlYXNlIG1ha2Ugc3VyZSBzZXJ2aWNlIGhhcyBiZWVuIHJlZ2lzdGVyZWQgaW4gdGhlIHJlcXVpcmVkICdkaS1jb250YWluZXInYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgcmVsYXRpb24ncyBtZXRhZGF0YVxuICAgICAgICBjb25zdCBjdXJyZW50RW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSA9IGN1cnJlbnRFbnRpdHlTY2hlbWEuYXR0cmlidXRlc1sgcmVsYXRlZEF0dHJpYnV0ZU5hbWUgYXMgYW55IF0gYXMgRW50aXR5QXR0cmlidXRlO1xuXG4gICAgICAgIGlmICghcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YSB8fCAhcmVsYXRpb25BdHRyaWJ1dGVNZXRhZGF0YT8ucmVsYXRpb24pIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgTm8gbWV0YWRhdGEgZm91bmQgZm9yIHJlbGF0aW9uc2hpcDogJHtyZWxhdGVkQXR0cmlidXRlTmFtZX1gXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKG1lc3NhZ2UsIHJlbGF0aW9uQXR0cmlidXRlTWV0YWRhdGEpO1xuICAgICAgICAgICAgdGhyb3cgKG1lc3NhZ2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVsYXRpb24gaWRlbnRpZmllcnMgbWFwcGluZ1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10gPSBBcnJheS5pc0FycmF5KGlkZW50aWZpZXJzKSA/IGlkZW50aWZpZXJzIDogWyBpZGVudGlmaWVycyEgXTtcblxuICAgICAgICAvLyBEZWNpZGUgbG9naWMgYmFzZWQgb24gcmVsYXRpb25UeXBlXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUgPT09ICdtYW55LXRvLW9uZScpIHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogTUFOWS1UTy1PTkU6XG4gICAgICAgICAgICAgKiAtLS0tLS0tLS0tLS0tXG4gICAgICAgICAgICAgKiBUaGUgXCJyb290RW50aXR5UmVjb3Jkc1wiIGFyZSB0aGUgQ0hJTEQgaXRlbXMsIGVhY2ggc3RvcmluZyB0aGUgcGFyZW50J3NcbiAgICAgICAgICAgICAqIGNvbXBvc2l0ZSBrZXkgaW4gc29tZSBmaWVsZHMuIFdlIGdhdGhlciBhbGwgdGhvc2UgcGFyZW50IGtleXMsIGRvIGEgYmF0Y2hcbiAgICAgICAgICAgICAqIHJldHJpZXZhbCBmcm9tIHRoZSBwYXJlbnQgZW50aXR5LCB0aGVuIGF0dGFjaCB0aGUgc2luZ2xlIG1hdGNoaW5nIHBhcmVudFxuICAgICAgICAgICAgICogcmVjb3JkIGludG8gY2hpbGRSZWNvcmRbcmVsYXRlZEF0dHJpYnV0ZU5hbWVdLlxuICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZU1hbnlUb09uZShcbiAgICAgICAgICAgICAgICByb290RW50aXR5UmVjb3JkcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkQXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MsXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uVHlwZSA9PT0gJ29uZS10by1tYW55Jykge1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBPTkUtVE8tTUFOWTpcbiAgICAgICAgICAgICAqIC0tLS0tLS0tLS0tLS1cbiAgICAgICAgICAgICAqIFRoZSBcInJvb3RFbnRpdHlSZWNvcmRzXCIgYXJlIHRoZSBQQVJFTlQgaXRlbXMuIEVhY2ggcGFyZW50IGNhbiBoYXZlIG11bHRpcGxlXG4gICAgICAgICAgICAgKiBjaGlsZCBpdGVtcy4gVGhlIGNoaWxkIHRhYmxlIHJlY29yZHMgZWFjaCBzdG9yZSB0aGUgcGFyZW50J3Mga2V5LiBcbiAgICAgICAgICAgICAqIFNvIHdlIGRvIGEgcXVlcnkgcGVyIHBhcmVudCBhbmQgdGhlbiAuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZU9uZVRvTWFueShcbiAgICAgICAgICAgICAgICByb290RW50aXR5UmVjb3JkcyxcbiAgICAgICAgICAgICAgICByZWxhdGVkQXR0cmlidXRlTmFtZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MsXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBoeWRyYXRlTWFueVRvT25lKFxuICAgICAgICBjaGlsZFJlY29yZHM6IGFueVtdLFxuICAgICAgICBwYXJlbnRBdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGlkZW50aWZpZXJNYXBwaW5nczogUmVsYXRpb25JZGVudGlmaWVyPGFueT5bXSxcbiAgICAgICAgcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZTogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxhbnk+IHwgdW5kZWZpbmVkLFxuICAgICAgICBwYXJlbnRTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4gICAgKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBjYWxsZWQgJ2h5ZHJhdGVNYW55VG9PbmUnIHJlbGF0aW9uOiAke3BhcmVudEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gZm9yIGVhY2ggcGFyZW50IGNyZWF0ZSBhIGNoaWxkcmVuIGJhdGNoXG4gICAgICAgIGNvbnN0IHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcCA9IG5ldyBNYXA8c3RyaW5nLCBhbnlbXT4oKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkUmVjb3Jkcykge1xuICAgICAgICAgICAgaWYgKCFjaGlsZCkgY29udGludWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgcGFyZW50IGtleSBvYmplY3QuIEUuZy4geyBvcmdJZDogY2hpbGQub3JnSWQsIHVzZXJJZDogY2hpbGQudXNlcklkIH0gZm9yIDItYXR0ciBQS1xuICAgICAgICAgICAgY29uc3QgcGFyZW50S2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgc291cmNlLCB0YXJnZXQgfSBvZiBpZGVudGlmaWVyTWFwcGluZ3MpIHtcblxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbCA9IGdldFZhbHVlQnlQYXRoKGNoaWxkLCBzb3VyY2UpO1xuICAgICAgICAgICAgICAgICAgICBpZiAodmFsID09IG51bGwpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudEtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gdmFsO1xuXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIGdldHRpbmcgdmFsdWUgZm9yIHBhdGg6ICR7c291cmNlfWAsIHsgZXJyb3IgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiBwYXJ0aWFsIG9yIGVtcHR5LCBza2lwXG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMocGFyZW50S2V5T2JqKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBjaGlsZFsgcGFyZW50QXR0cmlidXRlTmFtZSBdID0gbnVsbDtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qga2V5U3RyID0gSlNPTi5zdHJpbmdpZnkocGFyZW50S2V5T2JqKTtcbiAgICAgICAgICAgIGlmICghcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLmhhcyhrZXlTdHIpKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLnNldChrZXlTdHIsIFtdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBhcmVudElkZW50aWZpZXJzVG9DaGlsZHJlbk1hcC5nZXQoa2V5U3RyKSEucHVzaChjaGlsZCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocGFyZW50SWRlbnRpZmllcnNUb0NoaWxkcmVuTWFwLnNpemUgPT09IDApIHJldHVybjtcblxuICAgICAgICAvLyBDcmVhdGUgYSBwYXJlbnQtaWRlbnRpZmllcnMtYmF0Y2ggZm9yIGZldGNoaW5nXG4gICAgICAgIGNvbnN0IHBhcmVudElkZW50aWZpZXJzQmF0Y2g6IEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+ID0gW107XG4gICAgICAgIGZvciAoY29uc3QgayBvZiBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAua2V5cygpKSB7XG4gICAgICAgICAgICBwYXJlbnRJZGVudGlmaWVyc0JhdGNoLnB1c2goSlNPTi5wYXJzZShrKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBmZXRjaGVkUGFyZW50cyA9IGF3YWl0IHBhcmVudFNlcnZpY2UuZ2V0KHtcbiAgICAgICAgICAgIGlkZW50aWZpZXJzOiBwYXJlbnRJZGVudGlmaWVyc0JhdGNoLFxuICAgICAgICAgICAgYXR0cmlidXRlczogcGFyZW50QXR0cmlidXRlc1RvSHlkcmF0ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSWYgXCJnZXQoKVwiIHJldHVybnMgYSBzaW5nbGUgaXRlbSBjb252ZXJ0IGl0IGludG8gYW4gYXJyYXkuXG4gICAgICAgIGNvbnN0IHBhcmVudHNBcnJheSA9IEFycmF5LmlzQXJyYXkoZmV0Y2hlZFBhcmVudHMpID8gZmV0Y2hlZFBhcmVudHMgOiBbIGZldGNoZWRQYXJlbnRzIF07XG5cbiAgICAgICAgLy8gTWFrZSBhIGRpY3Rpb25hcnkgZnJvbSB7IDxrZXlTdHI+ID0+IHBhcmVudFJlY29yZCB9XG4gICAgICAgIGNvbnN0IHBhcmVudERpY3QgPSBuZXcgTWFwPHN0cmluZywgYW55PigpO1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgcGFyZW50c0FycmF5KSB7XG4gICAgICAgICAgICBpZiAoIXApIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFJlYnVpbGQgdGhlIFwiY29tcG9zaXRlIGtleVwiIGZyb20gdGhlIHBhcmVudCdzIHJlY29yZFxuICAgICAgICAgICAgY29uc3Qga2V5T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBbIHRhcmdldCBdID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgc29tZSBhdHRyaWJ1dGUgaXMgbWlzc2luZywgc2tpcFxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAga2V5T2JqWyB0YXJnZXQgYXMgc3RyaW5nIF0gPSBwWyB0YXJnZXQgXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGtTdHIgPSBKU09OLnN0cmluZ2lmeShrZXlPYmopO1xuICAgICAgICAgICAgcGFyZW50RGljdC5zZXQoa1N0ciwgcCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBdHRhY2ggZWFjaCBwYXJlbnQncyBkYXRhIHRvIHRoZSBjaGlsZFxuICAgICAgICBmb3IgKGNvbnN0IFsga1N0ciwgY2hpbGRyZW4gXSBvZiBwYXJlbnRJZGVudGlmaWVyc1RvQ2hpbGRyZW5NYXAuZW50cmllcygpKSB7XG4gICAgICAgICAgICBjb25zdCBmb3VuZFBhcmVudCA9IHBhcmVudERpY3QuZ2V0KGtTdHIpID8/IG51bGw7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGMgb2YgY2hpbGRyZW4pIHtcbiAgICAgICAgICAgICAgICBjWyBwYXJlbnRBdHRyaWJ1dGVOYW1lIF0gPSBmb3VuZFBhcmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgaHlkcmF0ZU9uZVRvTWFueShcbiAgICAgICAgcGFyZW50UmVjb3JkczogYW55W10sXG4gICAgICAgIGNoaWxkQXR0cmlidXRlTmFtZTogc3RyaW5nLFxuICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3M6IFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+W10sXG4gICAgICAgIGNoaWxkQXR0cmlidXRlc1RvSHlkcmF0ZTogSHlkcmF0ZU9wdGlvbkZvckVudGl0eTxhbnk+IHwgdW5kZWZpbmVkLFxuICAgICAgICBjaGlsZFNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbiAgICApIHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgY2FsbGVkICdoeWRyYXRlT25lVG9NYW55JyByZWxhdGlvbjogJHtjaGlsZEF0dHJpYnV0ZU5hbWV9IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgICAgICAgY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBwYXJlbnRLZXlTdHJUb1BhcmVudHMgPSBuZXcgTWFwPHN0cmluZywgYW55W10+KCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwYXJlbnQgb2YgcGFyZW50UmVjb3Jkcykge1xuICAgICAgICAgICAgaWYgKCFwYXJlbnQpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBhIFwiY2hpbGQgaW5kZXhcIiBrZXkgZnJvbSB0aGUgcGFyZW50J3MgZmllbGRzLiBGb3IgZXhhbXBsZSwgXG4gICAgICAgICAgICAvLyBpZiB0aGUgY2hpbGQgR1NJIGhhcyB7IHBrOiAndGVuYW50SWQnLCBzazogJ2FjY291bnRJZCcgfSwgXG4gICAgICAgICAgICAvLyB3ZSBmaWxsIHsgdGVuYW50SWQ6IHBhcmVudC50ZW5hbnRJZCwgYWNjb3VudElkOiBwYXJlbnQuYWNjb3VudElkIH0uXG4gICAgICAgICAgICBjb25zdCBjaGlsZEtleU9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCB7IHNvdXJjZSwgdGFyZ2V0IH0gb2YgaWRlbnRpZmllck1hcHBpbmdzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhcmVudFsgc291cmNlIF0gIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZEtleU9ialsgdGFyZ2V0IGFzIHN0cmluZyBdID0gcGFyZW50WyBzb3VyY2UgXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIHdlIGhhdmUgbm8gdmFsaWQgY29tcG9zaXRlIGtleSwgbm8gY2hpbGRyZW4gY2FuIGJlIGZldGNoZWRcbiAgICAgICAgICAgIGlmIChPYmplY3Qua2V5cyhjaGlsZEtleU9iaikubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcGFyZW50WyBjaGlsZEF0dHJpYnV0ZU5hbWUgXSA9IFtdO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBrZXlTdHIgPSBKU09OLnN0cmluZ2lmeShjaGlsZEtleU9iaik7XG4gICAgICAgICAgICBpZiAoIXBhcmVudEtleVN0clRvUGFyZW50cy5oYXMoa2V5U3RyKSkge1xuICAgICAgICAgICAgICAgIHBhcmVudEtleVN0clRvUGFyZW50cy5zZXQoa2V5U3RyLCBbXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZ2V0KGtleVN0cikhLnB1c2gocGFyZW50KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIG5vIHBhcmVudCBoYXMgYSB2YWxpZCBrZXksIHdlJ3JlIGRvbmVcbiAgICAgICAgaWYgKHBhcmVudEtleVN0clRvUGFyZW50cy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGb3IgZWFjaCB1bmlxdWUgcGFyZW50S2V5T2JqLCBkbyBhIGNoaWxkU2VydmljZSBxdWVyeS9saXN0IGluIHBhcmFsbGVsLlxuICAgICAgICBjb25zdCBwcm9taXNlczogQXJyYXk8UHJvbWlzZTxhbnk+PiA9IFtdO1xuICAgICAgICBjb25zdCBwYXJlbnRLZXlzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBrZXlTdHIgXSBvZiBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZW50cmllcygpKSB7XG5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkS2V5T2JqID0gSlNPTi5wYXJzZShrZXlTdHIpO1xuXG4gICAgICAgICAgICBwYXJlbnRLZXlzLnB1c2goa2V5U3RyKTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGNoaWxkRmllbGQsIHZhbCBdIG9mIE9iamVjdC5lbnRyaWVzKGNoaWxkS2V5T2JqKSkge1xuICAgICAgICAgICAgICAgIGZpbHRlcnNbIGNoaWxkRmllbGQgXSA9IHsgZXE6IHZhbCB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcm9taXNlcy5wdXNoKFxuICAgICAgICAgICAgICAgIGNoaWxkU2VydmljZS5saXN0KHtcbiAgICAgICAgICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlczogY2hpbGRBdHRyaWJ1dGVzVG9IeWRyYXRlLFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcblxuICAgICAgICAvLyBGb3IgZWFjaCByZXN1bHQsIG1hcCBjaGlsZHJlbiBiYWNrIHRvIHRoZSBjb3JyZWN0LXBhcmVudChzKVxuICAgICAgICBjb25zdCBwYXJlbnRLZXlTdHJUb0NoaWxkcmVuOiBSZWNvcmQ8c3RyaW5nLCBhbnlbXT4gPSB7fTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN1bHRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCB7IGRhdGE6IGNoaWxkSXRlbXMgfSA9IHJlc3VsdHNbIGkgXTtcbiAgICAgICAgICAgIGNvbnN0IGtleVN0ciA9IHBhcmVudEtleXNbIGkgXTtcbiAgICAgICAgICAgIHBhcmVudEtleVN0clRvQ2hpbGRyZW5bIGtleVN0ciBdID0gY2hpbGRJdGVtcyA/PyBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEF0dGFjaCB0byBwYXJlbnRzXG4gICAgICAgIGZvciAoY29uc3QgWyBrZXlTdHIsIHBhcmVudHMgXSBvZiBwYXJlbnRLZXlTdHJUb1BhcmVudHMuZW50cmllcygpKSB7XG4gICAgICAgICAgICBjb25zdCBjaGlsZEFycmF5ID0gcGFyZW50S2V5U3RyVG9DaGlsZHJlblsga2V5U3RyIF0gPz8gW107XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHAgb2YgcGFyZW50cykge1xuICAgICAgICAgICAgICAgIHBbIGNoaWxkQXR0cmlidXRlTmFtZSBdID0gY2hpbGRBcnJheTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJldHJpZXZlcyBhbiBlbnRpdHkgYnkgaXRzIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5LlxuICAgICAqIEBwYXJhbSBzZWxlY3Rpb25zIC0gT3B0aW9uYWwgYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXRyaWV2ZWQgZW50aXR5IGRhdGEuXG4gICAgICovXG5cbiAgICBwdWJsaWMgYXN5bmMgZ2V0KG9wdGlvbnM6IEdldE9wdGlvbnM8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMgfSA9IG9wdGlvbnM7XG5cblxuICAgICAgICBsZXQgZm9ybWF0dGVkQXR0cmlidXRlcyA9IGF0dHJpYnV0ZXM7XG4gICAgICAgIGlmICghYXR0cmlidXRlcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuZ2V0RGVmYXVsdFNlcmlhbGl6YXRpb25BdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmb3JtYXR0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBmb3JtYXR0ZWRBdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvcm1hdHRlZCBhdHRyaWJ1dGVzIGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZm9ybWF0dGVkQXR0cmlidXRlcyk7XG5cbiAgICAgICAgY29uc3QgcmVxdWlyZWRTZWxlY3RBdHRyaWJ1dGVzID0gT2JqZWN0LmVudHJpZXMoZm9ybWF0dGVkQXR0cmlidXRlcyBhcyBhbnkpLnJlZHVjZSgoYWNjLCBbIGF0dE5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgYWNjLnB1c2goYXR0TmFtZSk7XG4gICAgICAgICAgICBpZiAoaXNPYmplY3Qob3B0aW9ucykgJiYgb3B0aW9ucy5pZGVudGlmaWVycykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkZW50aWZpZXJzOiBBcnJheTxSZWxhdGlvbklkZW50aWZpZXI8YW55Pj4gPSBBcnJheS5pc0FycmF5KG9wdGlvbnMuaWRlbnRpZmllcnMpID8gb3B0aW9ucy5pZGVudGlmaWVycyA6IFsgb3B0aW9ucy5pZGVudGlmaWVycyBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcEtleXMgPSBpZGVudGlmaWVycy5tYXAoaWRlbnRpZmllciA9PiBpZGVudGlmaWVyLnNvdXJjZT8uc3BsaXQ/LignLicpPy5bIDAgXSkuZmlsdGVyKGtleSA9PiAhIWtleSkgYXMgc3RyaW5nW107XG4gICAgICAgICAgICAgICAgYWNjLnB1c2goLi4udG9wS2V5cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCBbXSBhcyBzdHJpbmdbXSk7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyA9IFsgLi4ubmV3IFNldChyZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMpIF1cblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJldHJpZXZlZCBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmICghIWZvcm1hdHRlZEF0dHJpYnV0ZXMgJiYgZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgWyBlbnRpdHkuZGF0YSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRpdHk/LmRhdGE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0cmlldmVzIG11bHRpcGxlIGVudGl0aWVzIGJ5IHRoZWlyIGlkZW50aWZpZXJzIGluIGEgYmF0Y2ggb3BlcmF0aW9uLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGJhdGNoIHJldHJpZXZpbmcgZW50aXRpZXMuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuaWRlbnRpZmllcnMgLSBBcnJheSBvZiBlbnRpdHkgaWRlbnRpZmllcnMgdG8gcmV0cmlldmUuXG4gICAgICogQHBhcmFtIG9wdGlvbnMuYXR0cmlidXRlcyAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBpbmNsdWRlIGluIHRoZSByZXNwb25zZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5jb25jdXJyZW50IC0gT3B0aW9uYWwgbnVtYmVyIG9mIGNvbmN1cnJlbnQgYmF0Y2ggb3BlcmF0aW9ucyB0byBwZXJmb3JtIChkZWZhdWx0OiAxKS5cbiAgICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgcmV0cmlldmVkIGVudGl0aWVzIGFuZCBhbnkgdW5wcm9jZXNzZWQgaXRlbXMuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGJhdGNoR2V0PFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG9wdGlvbnM6IHtcbiAgICAgICAgaWRlbnRpZmllcnM6IEFycmF5PEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4+LFxuICAgICAgICBhdHRyaWJ1dGVzPzogRW50aXR5U2VsZWN0aW9uczxTPixcbiAgICAgICAgY29uY3VycmVudD86IG51bWJlclxuICAgIH0pIHtcbiAgICAgICAgY29uc3QgeyBpZGVudGlmaWVycywgYXR0cmlidXRlcywgY29uY3VycmVudCA9IDEgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzO1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZEF0dHJpYnV0ZXMgPSB0aGlzLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm9ybWF0dGVkQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZE9wdGlvbnMgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKGZvcm1hdHRlZEF0dHJpYnV0ZXMgYXMgc3RyaW5nW10pO1xuICAgICAgICAgICAgZm9ybWF0dGVkQXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBwYXJzZWRPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3JtYXR0ZWQgYXR0cmlidXRlcyBmb3IgYmF0Y2ggZ2V0IG9uIGVudGl0eTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX1gLCBmb3JtYXR0ZWRBdHRyaWJ1dGVzKTtcblxuICAgICAgICBjb25zdCByZXF1aXJlZFNlbGVjdEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhmb3JtYXR0ZWRBdHRyaWJ1dGVzIGFzIGFueSkucmVkdWNlKChhY2MsIFsgYXR0TmFtZSwgb3B0aW9ucyBdKSA9PiB7XG4gICAgICAgICAgICBhY2MucHVzaChhdHROYW1lKTtcbiAgICAgICAgICAgIGlmIChpc09iamVjdChvcHRpb25zKSAmJiBvcHRpb25zLmlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWRlbnRpZmllcnM6IEFycmF5PFJlbGF0aW9uSWRlbnRpZmllcjxhbnk+PiA9IEFycmF5LmlzQXJyYXkob3B0aW9ucy5pZGVudGlmaWVycykgPyBvcHRpb25zLmlkZW50aWZpZXJzIDogWyBvcHRpb25zLmlkZW50aWZpZXJzIF07XG4gICAgICAgICAgICAgICAgY29uc3QgdG9wS2V5cyA9IGlkZW50aWZpZXJzLm1hcChpZGVudGlmaWVyID0+IGlkZW50aWZpZXIuc291cmNlPy5zcGxpdD8uKCcuJyk/LlsgMCBdKS5maWx0ZXIoa2V5ID0+ICEha2V5KSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICAgICAgICBhY2MucHVzaCguLi50b3BLZXlzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH0sIFtdIGFzIHN0cmluZ1tdKTtcblxuICAgICAgICBjb25zdCB1bmlxdWVTZWxlY3Rpb25BdHRyaWJ1dGVzID0gWyAuLi5uZXcgU2V0KHJlcXVpcmVkU2VsZWN0QXR0cmlidXRlcykgXTtcblxuICAgICAgICBjb25zdCBlbnRpdHkgPSBhd2FpdCBnZXRCYXRjaEVudGl0eTxTPih7XG4gICAgICAgICAgICBpZHM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgYXR0cmlidXRlczogdW5pcXVlU2VsZWN0aW9uQXR0cmlidXRlcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyBhcyBhbnksXG4gICAgICAgICAgICBjb25jdXJyZW50XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZXRyaWV2ZWQgYmF0Y2ggZW50aXRpZXM6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgSnNvblNlcmlhbGl6ZXIuc3RyaW5naWZ5KGVudGl0eSkpO1xuXG4gICAgICAgIGlmICghIWZvcm1hdHRlZEF0dHJpYnV0ZXMgJiYgZW50aXR5Py5kYXRhKSB7XG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbmFsQXR0cmlidXRlcyA9IE9iamVjdC5lbnRyaWVzKGZvcm1hdHRlZEF0dHJpYnV0ZXMpPy5tYXAoKFsgYXR0cmlidXRlTmFtZSwgb3B0aW9ucyBdKSA9PiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbICwgb3B0aW9ucyBdKSA9PiBpc09iamVjdChvcHRpb25zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZWxhdGlvbmFsQXR0cmlidXRlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmh5ZHJhdGVSZWNvcmRzKHJlbGF0aW9uYWxBdHRyaWJ1dGVzIGFzIGFueSwgZW50aXR5LmRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGRhdGE6IGVudGl0eT8uZGF0YSB8fCBbXSxcbiAgICAgICAgICAgIHVucHJvY2Vzc2VkOiBlbnRpdHk/LnVucHJvY2Vzc2VkIHx8IFtdXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIHRoZSB1bmlxdWVuZXNzIG9mIGFuIGF0dHJpYnV0ZSB2YWx1ZSBhbmQgdXBkYXRlcyB0aGUgcGF5bG9hZCBpZiBuZWNlc3NhcnkuXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY2hlY2tpbmcgdW5pcXVlbmVzcyBhbmQgdXBkYXRpbmcgdGhlIHBheWxvYWQuXG4gICAgICogQHBhcmFtIG9wdGlvbnMucGF5bG9hZFRvVXBkYXRlIC0gVGhlIHBheWxvYWQgb2JqZWN0IHRvIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byBjaGVjayB1bmlxdWVuZXNzIGZvci5cbiAgICAgKiBAcGFyYW0gb3B0aW9ucy5hdHRyaWJ1dGVWYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBvcHRpb25zLm1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSAtIFRoZSBtYXhpbXVtIG51bWJlciBvZiBhdHRlbXB0cyB0byBjcmVhdGUgYSB1bmlxdWUgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqIEByZXR1cm5zIEEgYm9vbGVhbiBpbmRpY2F0aW5nIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZShvcHRpb25zOiB7XG4gICAgICAgIHBheWxvYWRUb1VwZGF0ZTogYW55LFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGF0dHJpYnV0ZVZhbHVlOiBhbnksXG4gICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycz86IHtcbiAgICAgICAgICAgIFsga2V5OiBzdHJpbmcgXTogYW55XG4gICAgICAgIH1cbiAgICAgICAgbWF4QXR0ZW1wdHNGb3JDcmVhdGluZ1VuaXF1ZUF0dHJpYnV0ZVZhbHVlOiBudW1iZXIsXG4gICAgfSkge1xuXG4gICAgICAgIGNvbnN0IHsgcGF5bG9hZFRvVXBkYXRlLCBhdHRyaWJ1dGVOYW1lLCBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMsIG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB9ID0gb3B0aW9ucztcbiAgICAgICAgbGV0IHsgYXR0cmlidXRlVmFsdWUgfSA9IG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IGlzVW5pcXVlID0gZmFsc2U7XG4gICAgICAgIGxldCB0cmllc0NvdW50ID0gMTtcblxuICAgICAgICB3aGlsZSAoIWlzVW5pcXVlICYmIHRyaWVzQ291bnQgPCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUpIHtcbiAgICAgICAgICAgIGlzVW5pcXVlID0gYXdhaXQgdGhpcy5pc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKGF0dHJpYnV0ZU5hbWUsIGF0dHJpYnV0ZVZhbHVlLCBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpO1xuICAgICAgICAgICAgaWYgKCFpc1VuaXF1ZSkge1xuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZVZhbHVlID0gdGhpcy5nZW5lcmF0ZVVuaXF1ZVZhbHVlKGF0dHJpYnV0ZVZhbHVlLCB0cmllc0NvdW50KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRyaWVzQ291bnQrKztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1VuaXF1ZSkge1xuICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlWyBhdHRyaWJ1dGVOYW1lIF0gPSBhdHRyaWJ1dGVWYWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBpc1VuaXF1ZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgaWYgdGhlIGdpdmVuIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUgZm9yIHRoZSBzcGVjaWZpZWQgYXR0cmlidXRlIG5hbWUuXG4gICAgICogQHBhcmFtIGF0dHJpYnV0ZU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEBwYXJhbSBhdHRyaWJ1dGVWYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgYXR0cmlidXRlIHRvIGNoZWNrIHVuaXF1ZW5lc3MgZm9yLlxuICAgICAqIEByZXR1cm5zIEEgYm9vbGVhbiBpbmRpY2F0aW5nIHdoZXRoZXIgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyB1bmlxdWUgb3Igbm90LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBpc1VuaXF1ZUF0dHJpYnV0ZVZhbHVlKFxuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzdHJpbmcsXG4gICAgICAgIGF0dHJpYnV0ZVZhbHVlOiBhbnksXG4gICAgICAgIGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycz86IHtcbiAgICAgICAgICAgIFsga2V5OiBzdHJpbmcgXTogYW55XG4gICAgICAgIH1cbiAgICApIHtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ2FsbGVkIH4gaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gYXR0cmlidXRlTmFtZTogJHthdHRyaWJ1dGVOYW1lfSB+IGF0dHJpYnV0ZVZhbHVlOiAke2F0dHJpYnV0ZVZhbHVlfWApO1xuXG4gICAgICAgIC8vIENyZWF0ZSBmaWx0ZXJzIGZvciB0aGUgcXVlcnkgdXNpbmcgdGhlIGNvcnJlY3Qgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBbIGF0dHJpYnV0ZU5hbWUgXTogeyBlcTogYXR0cmlidXRlVmFsdWUgfVxuICAgICAgICB9IGFzIEVudGl0eUZpbHRlckNyaXRlcmlhPFM+O1xuXG4gICAgICAgIC8vIERldGVybWluZSB3aGljaCBhdHRyaWJ1dGVzIHRvIHByb2plY3QgLSBvbmx5IHRoZSBhdHRyaWJ1dGUgYmVpbmcgY2hlY2tlZCBhbmQgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllcnNcbiAgICAgICAgY29uc3QgYXR0cmlidXRlc1RvUHJvamVjdDogc3RyaW5nW10gPSBbIGF0dHJpYnV0ZU5hbWUgXTtcblxuICAgICAgICAvLyBBZGQgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllciBmaWVsZHMgdG8gdGhlIHByb2plY3Rpb25cbiAgICAgICAgaWYgKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycyAmJiAhaXNFbXB0eU9iamVjdERlZXAoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoaWdub3JlZEVudGl0eUlkZW50aWZpZXJzKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCFhdHRyaWJ1dGVzVG9Qcm9qZWN0LmluY2x1ZGVzKGtleSkpIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlc1RvUHJvamVjdC5wdXNoKGtleSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgdGhlIHF1ZXJ5IG1ldGhvZCB0byBsZXZlcmFnZSBpbmRleCBzZWxlY3Rpb24gbG9naWMgd2l0aCBtaW5pbWFsIGF0dHJpYnV0ZSBwcm9qZWN0aW9uXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoe1xuICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXNUb1Byb2plY3QgYXMgYW55LFxuICAgICAgICAgICAgcGFnaW5hdGlvbjogeyBjb3VudDogMSB9IC8vIFdlIG9ubHkgbmVlZCB0byBrbm93IGlmIGFueSByZWNvcmRzIGV4aXN0XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGhhdmUgaWdub3JlZCBlbnRpdHkgaWRlbnRpZmllcnMsIGZpbHRlciB0aGUgcmVzdWx0cyBpbiBtZW1vcnlcbiAgICAgICAgbGV0IGVudGl0aWVzID0gcmVzdWx0LmRhdGEgfHwgW107XG4gICAgICAgIGlmIChpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMgJiYgIWlzRW1wdHlPYmplY3REZWVwKGlnbm9yZWRFbnRpdHlJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIGVudGl0aWVzID0gZW50aXRpZXMuZmlsdGVyKGVudGl0eSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICFPYmplY3QuZW50cmllcyhpZ25vcmVkRW50aXR5SWRlbnRpZmllcnMpLmV2ZXJ5KChbIGtleSwgdmFsdWUgXSkgPT5cbiAgICAgICAgICAgICAgICAgICAgZW50aXR5WyBrZXkgXSA9PT0gdmFsdWVcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgaXNVbmlxdWVBdHRyaWJ1dGVWYWx1ZSB+IGVudGl0eU5hbWU6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IH4gYXR0cmlidXRlTmFtZTogJHthdHRyaWJ1dGVOYW1lfSB+IGF0dHJpYnV0ZVZhbHVlOiAke2F0dHJpYnV0ZVZhbHVlfSB+IGVudGl0eTpgLCB7IGRhdGE6IGVudGl0aWVzIH0pO1xuXG4gICAgICAgIHJldHVybiBlbnRpdGllcy5sZW5ndGggPT09IDA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIGEgdW5pcXVlIHZhbHVlIGJ5IGFwcGVuZGluZyBhIHVuaXF1ZSBzdWZmaXggdG8gdGhlIG9yaWdpbmFsIHZhbHVlLlxuICAgICAqIEBwYXJhbSBvcmlnaW5hbFZhbHVlIC0gVGhlIG9yaWdpbmFsIHZhbHVlIHRvIGdlbmVyYXRlIGEgdW5pcXVlIHZhbHVlIGZyb20uXG4gICAgICogQHBhcmFtIGF0dGVtcHQgLSBUaGUgYXR0ZW1wdCBudW1iZXIgb3Igc3RyaW5nIHRvIGJlIHVzZWQgYXMgYSBzdWZmaXggKGRlZmF1bHQ6IHJhbmRvbSBzdHJpbmcpLlxuICAgICAqIEByZXR1cm5zIFRoZSBnZW5lcmF0ZWQgdW5pcXVlIHZhbHVlLlxuICAgICAqL1xuICAgIHB1YmxpYyBnZW5lcmF0ZVVuaXF1ZVZhbHVlKG9yaWdpbmFsVmFsdWU6IGFueSwgYXR0ZW1wdDogbnVtYmVyIHwgc3RyaW5nID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDIsIDE1KSk6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IHVuaXF1ZVN1ZmZpeCA9IGAke0RhdGUubm93KCl9LSR7YXR0ZW1wdH1gO1xuICAgICAgICByZXR1cm4gYCR7b3JpZ2luYWxWYWx1ZX0tJHt1bmlxdWVTdWZmaXh9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF5bG9hZCAtIFRoZSBwYXlsb2FkIGZvciBjcmVhdGluZyB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBjcmVhdGVkIGVudGl0eS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgY3JlYXRlKHBheWxvYWQ6IENyZWF0ZUVudGl0eUl0ZW1UeXBlRnJvbVNjaGVtYTxTPiwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgICAgICBjb25zdCBwYXlsb2FkQ29weSA9IHsgLi4ucGF5bG9hZCB9XG5cbiAgICAgICAgY29uc3Qgc2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWEoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U2x1Z0F0dHJpYnV0ZSA9IGdldEF0dHJpYnV0ZU5hbWVCeShzY2hlbWEsICdzbHVnJykgfHwgJyc7XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSBnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnbmFtZScpIHx8ICcnO1xuXG4gICAgICAgIGlmIChlbnRpdHlTbHVnQXR0cmlidXRlICYmICEoZW50aXR5U2x1Z0F0dHJpYnV0ZSBpbiBwYXlsb2FkQ29weSkpIHtcbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIChlbnRpdHlOYW1lQXR0cmlidXRlIGluIHBheWxvYWRDb3B5KSkge1xuICAgICAgICAgICAgICAgIHBheWxvYWRDb3B5WyBlbnRpdHlTbHVnQXR0cmlidXRlIGFzIGtleW9mIHR5cGVvZiBwYXlsb2FkQ29weSBdID0gdG9TbHVnKHBheWxvYWRDb3B5WyBlbnRpdHlOYW1lQXR0cmlidXRlIF0pIGFzIGFueTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVuaXF1ZUZpZWxkcyA9IHRoaXMuZ2V0VW5pcXVlQXR0cmlidXRlcygpO1xuICAgICAgICBjb25zdCBza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUgPSA1O1xuXG4gICAgICAgIGlmICghc2tpcENoZWNraW5nQXR0cmlidXRlc1VuaXF1ZW5lc3MgJiYgdW5pcXVlRmllbGRzLmxlbmd0aCkge1xuICAgICAgICAgICAgbGV0IHVuaXF1ZW5lc3NDaGVja3MgPSBbXTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCB7IG5hbWUgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAobmFtZSEgaW4gcGF5bG9hZENvcHkpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gcGF5bG9hZENvcHlbIG5hbWUhIF07XG4gICAgICAgICAgICAgICAgICAgIHVuaXF1ZW5lc3NDaGVja3MucHVzaCgoKSA9PiB0aGlzLmNoZWNrVW5pcXVlbmVzc0FuZFVwZGF0ZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkVG9VcGRhdGU6IHBheWxvYWRDb3B5LFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHVuaXF1ZW5lc3NDaGVja3MubWFwKGNoZWNrID0+IGNoZWNrKCkpKTtcblxuICAgICAgICAgICAgaWYgKGNoZWNrUmVzdWx0cy5pbmNsdWRlcyhmYWxzZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB1bmlxdWVGaWVsZHNQYXRoID0gdW5pcXVlRmllbGRzLm1hcChmaWVsZCA9PiBmaWVsZC5uYW1lISkgPz8gW107XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRW50aXR5VmFsaWRhdGlvbkVycm9yKFsge1xuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlVuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3Igb25lIG9yIG1vcmUgZmllbGRzLlwiLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiB1bmlxdWVGaWVsZHNQYXRoLFxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZDogWyAndW5pcXVlJywgdW5pcXVlRmllbGRzIF0sXG4gICAgICAgICAgICAgICAgfSBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0eSA9IGF3YWl0IGNyZWF0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICBkYXRhOiBwYXlsb2FkQ29weSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGVudGl0eTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzLU9SLVVwZGF0ZXMgYW4gZW50aXR5LlxuICAgICAqIE5PVEU6IFxuICAgICAqICAgLSBUaGlzIG1ldGhvZCBkb2VzIG5vdCBjaGVjayBmb3IgdW5pcXVlbmVzcyBvZiB0aGUgYXR0cmlidXRlcywgbmVpdGhlciBjcmVhdGUgdGhlIHNsdWcgYXV0b21hdGljYWxseS5cbiAgICAgKiAgIC0gSXQncyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgdGhlIGNhbGxlciB0byBlbnN1cmUgdGhlIHJlYWQgb255IGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpZiB0aGUgcmVjb3JkIGlzIGJlaW5nIHVwc2VydC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gcGF5bG9hZCAtIFRoZSBwYXlsb2FkIGZvciBjcmVhdGluZy1PUi11cGRhdGluZyB0aGUgZW50aXR5LlxuICAgICAqIEByZXR1cm5zIFRoZSBjcmVhdGVkLU9SLXVwZGF0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyB1cHNlcnQocGF5bG9hZDogVXBzZXJ0RW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiB1cHNlcnQgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IHBheWxvYWQ6YCwgcGF5bG9hZCk7XG5cbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgdXBzZXJ0RW50aXR5PFM+KHtcbiAgICAgICAgICAgIGRhdGE6IHBheWxvYWQsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBlbnRpdHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIGR1cGxpY2F0ZSBlbnRpdHkgZGF0YSBiYXNlZCBvbiB0aGUgZ2l2ZW4gaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkZW50aWZpZXJzIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkuXG4gICAgICogQHJldHVybnMgVGhlIGR1cGxpY2F0ZSBlbnRpdHkgZGF0YS5cbiAgICAgKiBAdGhyb3dzIEVycm9yIGlmIG5vIHJlY29yZCBpcyBmb3VuZCBmb3IgdGhlIGdpdmVuIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3QgaWRlbnRpZmllcnMgPSB7IGlkOiAxIH07XG4gICAgICogY29uc3QgZHVwbGljYXRlRGF0YSA9IGF3YWl0IG1ha2VEdXBsaWNhdGVFbnRpdHlEYXRhQnlJZGVudGlmaWVycyhpZGVudGlmaWVycyk7XG4gICAgICogY29uc29sZS5sb2coZHVwbGljYXRlRGF0YSk7IC8vIHsgbmFtZTogJ0pvaG4gRG9lJywgYWdlOiAzMCwgLi4uIH1cbiAgICAgKi9cbiAgICBwcm90ZWN0ZWQgYXN5bmMgbWFrZUR1cGxpY2F0ZUVudGl0eURhdGEoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4pIHtcbiAgICAgICAgY29uc3QgZW50aXR5ID0gYXdhaXQgdGhpcy5nZXQoeyBpZGVudGlmaWVycyB9KSBhcyBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxTPjtcblxuICAgICAgICBpZiAoIWVudGl0eSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSByZWNvcmQgZm91bmQgZm9yIGlkZW50aWZpZXJzOiAke2lkZW50aWZpZXJzfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGR1cGxpY2F0ZUV2ZW50RGF0YTogQ3JlYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+ID0ge30gYXMgYW55O1xuICAgICAgICBjb25zdCBwcmltYXJ5SWRQcm9wTmFtZSA9IHRoaXMuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCkgYXMgc3RyaW5nO1xuXG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0RW50aXR5U2NoZW1hKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eVNsdWdBdHRyaWJ1dGUgPSAoZ2V0QXR0cmlidXRlTmFtZUJ5KHNjaGVtYSwgJ3NsdWcnKSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUF0dHJpYnV0ZSA9IChnZXRBdHRyaWJ1dGVOYW1lQnkoc2NoZW1hLCAnbmFtZScpIHx8ICcnKS50b1VwcGVyQ2FzZSgpO1xuXG4gICAgICAgIGZvciAobGV0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGVudGl0eSkpIHtcblxuICAgICAgICAgICAgaWYgKGtleSAhPT0gcHJpbWFyeUlkUHJvcE5hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBUT0RPOiBoYW5kbGUgd2hlbiBlbnRpdHkgaGFzIG11bHRpcGxlIGlkZW50aWZpZXJzXG5cbiAgICAgICAgICAgICAgICBpZiAoa2V5LnRvVXBwZXJDYXNlKCkgPT09IGVudGl0eU5hbWVBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBgJHt2YWx1ZX0gLSBDb3B5YDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGtleS50b1VwcGVyQ2FzZSgpID09PSBlbnRpdHlTbHVnQXR0cmlidXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gYCR7dmFsdWV9LWNvcHlgO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGR1cGxpY2F0ZUV2ZW50RGF0YVsga2V5IGFzIGtleW9mIHR5cGVvZiBkdXBsaWNhdGVFdmVudERhdGEgXSA9IHZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGR1cGxpY2F0ZUV2ZW50RGF0YTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgZHVwbGljYXRlIGVudGl0eSBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgaWRlbnRpZmllcnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGlkIC0gVGhlIGlkZW50aWZpZXJzIG9mIHRoZSBlbnRpdHkgdG8gZHVwbGljYXRlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBkdXBsaWNhdGVkIGVudGl0eS5cbiAgICAgKiBcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGVudGl0eUlkID0geyBpZDogMTIzLCBuYW1lOiAnZXhhbXBsZScgfTtcbiAgICAgKiBjb25zdCBkdXBsaWNhdGVkRW50aXR5ID0gYXdhaXQgZHVwbGljYXRlKGVudGl0eUlkKTtcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgZHVwbGljYXRlKGlkOiBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGR1cGxpY2F0ZUV2ZW50RGF0YSA9IGF3YWl0IHRoaXMubWFrZUR1cGxpY2F0ZUVudGl0eURhdGEoaWQpO1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5jcmVhdGUoZHVwbGljYXRlRXZlbnREYXRhLCBjdHgpO1xuICAgIH1cblxuICAgIC8vIFRPRE86IHNob3VsZCBiZSBwYXJ0IG9mIHNvbWUgY29uZmlnXG4gICAgcHJvdGVjdGVkIGRlbGltaXRlcnNSZWdleCA9IC8oPzomfCB8LHxcXCspKy87XG5cbiAgICAvKipcbiAgICAgKiBSZXRyaWV2ZXMgYSBsaXN0IG9mIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBxdWVyeS5cbiAgICAgKiAtIElmIG5vIHNwZWNpZmljIGF0dHJpYnV0ZXMgYXJlIHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogLSBJZiBhIHNlYXJjaCB0ZXJtIGlzIHByb3ZpZGVkIGluIHRoZSBxdWVyeSBpdCB3aWxsIHNwbGl0IHRoZSBzZWFyY2ggdGVybSBieSBgLyg/OiZ8IHwsfFxcKykrL2AgUmVnZXggYW5kIHdpbGwgZmlsdGVyIG91dCBlbXB0eSBzdHJpbmdzLlxuICAgICAqIC0gSWYgc2VhcmNoIGF0dHJpYnV0ZXMgYXJlIG5vdCBwcm92aWRlZCBpbiB0aGUgcXVlcnksIGl0IGRlZmF1bHRzIHRvIGEgbGlzdCBvZiBzZWFyY2hhYmxlIGF0dHJpYnV0ZSBuYW1lcyBvYnRhaW5lZCBmcm9tIGBnZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKWAuXG4gICAgICogXG4gICAgICogQHBhcmFtIHF1ZXJ5IC0gVGhlIHF1ZXJ5IG9iamVjdCBjb250YWluaW5nIGZpbHRlcnMsIHNlYXJjaCBrZXl3b3JkcywgYW5kIGF0dHJpYnV0ZXMuXG4gICAgICogQHJldHVybnMgQSBQcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gYW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGxpc3Qgb2YgZW50aXRpZXMgYW5kIHRoZSBvcmlnaW5hbCBxdWVyeS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgbGlzdChxdWVyeTogRW50aXR5UXVlcnk8Uz4gPSB7fSwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENhbGxlZCB+IGxpc3QgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IHF1ZXJ5OmAsIHF1ZXJ5KTtcblxuICAgICAgICBpZiAoIXF1ZXJ5LmF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICAgIHF1ZXJ5LmF0dHJpYnV0ZXMgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpXG4gICAgICAgIH1cblxuICAgICAgICAvLyBmb3IgbGlzdGluZyBBUEkgYXR0cmlidXRlcyB3b3VsZCBiZSBhbiBhcnJheVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShxdWVyeS5hdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkT3B0aW9ucyA9IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMocXVlcnkuYXR0cmlidXRlcyBhcyBzdHJpbmdbXSk7XG4gICAgICAgICAgICBxdWVyeS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKHRoaXMuZ2V0RW50aXR5U2NoZW1hKCksIHBhcnNlZE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaCkge1xuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKHF1ZXJ5LnNlYXJjaCkpIHtcbiAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2ggPSBxdWVyeS5zZWFyY2gudHJpbSgpLnNwbGl0KHRoaXMuZGVsaW1pdGVyc1JlZ2V4ID8/ICcgJykuZmlsdGVyKHMgPT4gISFzKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHF1ZXJ5LnNlYXJjaC5sZW5ndGggPiAwKSB7XG5cbiAgICAgICAgICAgICAgICBpZiAoaXNTdHJpbmcocXVlcnkuc2VhcmNoQXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMuc3BsaXQoJywnKS5maWx0ZXIocyA9PiAhIXMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoIXF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgfHwgaXNFbXB0eShxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzID0gdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hGaWx0ZXJHcm91cCA9IG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzKHF1ZXJ5LnNlYXJjaCwgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyk7XG5cbiAgICAgICAgICAgICAgICBxdWVyeS5maWx0ZXJzID0gYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhPFM+KHNlYXJjaEZpbHRlckdyb3VwIGFzIGFueSwgcXVlcnkuZmlsdGVycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRpdGllcyA9IGF3YWl0IGxpc3RFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSB0aGlzLnNlcmlhbGl6ZVJlY29yZHMoZW50aXRpZXMuZGF0YSwgcXVlcnkuYXR0cmlidXRlcyk7XG5cbiAgICAgICAgaWYgKHF1ZXJ5LmF0dHJpYnV0ZXMgJiYgZW50aXRpZXMuZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhxdWVyeS5hdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLy8gb25seSBhdHRyaWJ1dGVzIGluIGh5ZHJhdGUgb3B0aW9ucyB0aGF0IGhhdmUgcmVsYXRpb24gbWV0YWRhdGEgYXR0YWNoZWQgdG8gdGhlbSBuZWVkcyB0byBiZSBoeWRyYXRlZFxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdGllcy5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IC4uLmVudGl0aWVzLCBxdWVyeSB9O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogRXhlY3V0ZXMgYSBxdWVyeSBvbiB0aGUgZW50aXR5LlxuICAgICAqIC0gSWYgbm8gc3BlY2lmaWMgYXR0cmlidXRlcyBhcmUgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5LCBpdCBkZWZhdWx0cyB0byBhIGxpc3Qgb2YgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAtIElmIGEgc2VhcmNoIHRlcm0gaXMgcHJvdmlkZWQgaW4gdGhlIHF1ZXJ5IGl0IHdpbGwgc3BsaXQgdGhlIHNlYXJjaCB0ZXJtIGJ5IGAvKD86JnwgfCx8XFwrKSsvYCBSZWdleCBhbmQgd2lsbCBmaWx0ZXIgb3V0IGVtcHR5IHN0cmluZ3MuXG4gICAgICogICAtLSBJZiBzZWFyY2ggYXR0cmlidXRlcyBhcmUgbm90IHByb3ZpZGVkIGluIHRoZSBxdWVyeSwgaXQgZGVmYXVsdHMgdG8gYSBsaXN0IG9mIHNlYXJjaGFibGUgYXR0cmlidXRlIG5hbWVzIG9idGFpbmVkIGZyb20gYGdldFNlYXJjaGFibGVBdHRyaWJ1dGVOYW1lcygpYC5cbiAgICAgKiAgIC0tIElmIHRoZXJlIGFyZSBhbnkgbm9uLWVtcHR5IHNlYXJjaC10ZXJtcywgaXQgd2lsbCBhZGQgYSBmaWx0ZXIgZ3JvdXAgdG8gdGhlIHF1ZXJ5IGJhc2VkIG9uIHRoZSBzZWFyY2gga2V5d29yZHMuXG4gICAgICogQHBhcmFtIHF1ZXJ5IC0gVGhlIGVudGl0eSBxdWVyeSB0byBleGVjdXRlLlxuICAgICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSByZXN1bHQgb2YgdGhlIHF1ZXJ5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBxdWVyeShxdWVyeTogRW50aXR5UXVlcnk8Uz4sIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBsaXN0IH4gZW50aXR5TmFtZTogJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gfiBxdWVyeTpgLCBxdWVyeSk7XG5cbiAgICAgICAgY29uc3QgeyBhdHRyaWJ1dGVzIH0gPSBxdWVyeTtcblxuICAgICAgICBsZXQgc2VsZWN0QXR0cmlidXRlczogRW50aXR5U2VsZWN0aW9uczxTPiB8IHVuZGVmaW5lZCA9IGF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRMaXN0aW5nQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3RBdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgLy8gcGFyc2UgdGhlIGxpc3Qgb2YgZG90LXNlcGFyYXRlZCBhdHRyaWJ1dGUtaWRlbnRpZmllcnMgcGF0aHMgYW5kIGVuc3VyZSBhbGwgdGhlIHJlcXVpcmVkIG1ldGFkYXRhIGlzIHRoZXJlXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRPcHRpb25zID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhzZWxlY3RBdHRyaWJ1dGVzIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgICAgIHNlbGVjdEF0dHJpYnV0ZXMgPSB0aGlzLmluZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnModGhpcy5nZXRFbnRpdHlTY2hlbWEoKSwgcGFyc2VkT3B0aW9ucyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBlbnN1cmUgYWxsIHRoZSBwcm92aWRlZCBzZWxlY3QgYXR0cmlidXRlcyBoYXMgcmVxdWlyZWQgbWV0YWRhdGEgYWxsIHRoZSB3YXkgZG93biB0byB0aGUgbGVhZiBsZXZlbFxuICAgICAgICAgICAgc2VsZWN0QXR0cmlidXRlcyA9IHRoaXMuaW5mZXJSZWxhdGlvbnNoaXBzRm9yRW50aXR5U2VsZWN0aW9ucyh0aGlzLmdldEVudGl0eVNjaGVtYSgpLCBzZWxlY3RBdHRyaWJ1dGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhxdWVyeS5zZWFyY2gpKSB7XG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoID0gcXVlcnkuc2VhcmNoLnRyaW0oKS5zcGxpdCh0aGlzLmRlbGltaXRlcnNSZWdleCA/PyAnICcpLmZpbHRlcihzID0+ICEhcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChxdWVyeS5zZWFyY2gubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICAgICAgcXVlcnkuc2VhcmNoQXR0cmlidXRlcyA9IHF1ZXJ5LnNlYXJjaEF0dHJpYnV0ZXMgfHwgdGhpcy5nZXRTZWFyY2hhYmxlQXR0cmlidXRlTmFtZXMoKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHNlYXJjaEZpbHRlckdyb3VwID0gbWFrZUZpbHRlckdyb3VwRm9yU2VhcmNoS2V5d29yZHMocXVlcnkuc2VhcmNoLCBxdWVyeS5zZWFyY2hBdHRyaWJ1dGVzKTtcblxuICAgICAgICAgICAgICAgIHF1ZXJ5LmZpbHRlcnMgPSBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8Uz4oc2VhcmNoRmlsdGVyR3JvdXAgYXMgYW55LCBxdWVyeS5maWx0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVudGl0aWVzID0gYXdhaXQgcXVlcnlFbnRpdHk8Uz4oe1xuICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiB0aGlzLmdldEVudGl0eU5hbWUoKSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGVudGl0aWVzLmRhdGEgPSB0aGlzLnNlcmlhbGl6ZVJlY29yZHMoZW50aXRpZXMuZGF0YSwgc2VsZWN0QXR0cmlidXRlcyk7XG5cbiAgICAgICAgaWYgKHNlbGVjdEF0dHJpYnV0ZXMgJiYgZW50aXRpZXMuZGF0YSkge1xuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25hbEF0dHJpYnV0ZXMgPSBPYmplY3QuZW50cmllcyhzZWxlY3RBdHRyaWJ1dGVzKT8ubWFwKChbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBbIGF0dHJpYnV0ZU5hbWUsIG9wdGlvbnMgXTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLy8gb25seSBhdHRyaWJ1dGVzIGluIGh5ZHJhdGUgb3B0aW9ucyB0aGF0IGhhdmUgcmVsYXRpb24gbWV0YWRhdGEgYXR0YWNoZWQgdG8gdGhlbSBuZWVkcyB0byBiZSBoeWRyYXRlZFxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFsgLCBvcHRpb25zIF0pID0+IGlzT2JqZWN0KG9wdGlvbnMpKTtcblxuICAgICAgICAgICAgaWYgKHJlbGF0aW9uYWxBdHRyaWJ1dGVzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuaHlkcmF0ZVJlY29yZHMocmVsYXRpb25hbEF0dHJpYnV0ZXMgYXMgYW55LCBlbnRpdGllcy5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IC4uLmVudGl0aWVzLCBxdWVyeSB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFVwZGF0ZXMgYW4gZW50aXR5IGluIHRoZSBkYXRhYmFzZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIHVwZGF0ZS5cbiAgICAgKiBAcGFyYW0gZGF0YSAtIFRoZSB1cGRhdGVkIGRhdGEgZm9yIHRoZSBlbnRpdHkuXG4gICAgICogQHBhcmFtIHJlbW92ZSAtIE9wdGlvbmFsIGFycmF5IG9mIGF0dHJpYnV0ZXMgdG8gcmVtb3ZlIGZyb20gdGhlIGVudGl0eS5cbiAgICAgKiBAcmV0dXJucyBUaGUgdXBkYXRlZCBlbnRpdHkuXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIHVwZGF0ZShpZGVudGlmaWVyczogRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTPiwgZGF0YTogVXBkYXRlRW50aXR5SXRlbVR5cGVGcm9tU2NoZW1hPFM+LCBvcGVyYXRvcnM/OiBVcGRhdGVFbnRpdHlPcGVyYXRvcnMsIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzID0gdGhpcy5nZXRVbmlxdWVBdHRyaWJ1dGVzKCk7XG4gICAgICAgIGNvbnN0IHNraXBDaGVja2luZ0F0dHJpYnV0ZXNVbmlxdWVuZXNzID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG1heEF0dGVtcHRzRm9yQ3JlYXRpbmdVbmlxdWVBdHRyaWJ1dGVWYWx1ZSA9IDU7XG5cbiAgICAgICAgaWYgKCFza2lwQ2hlY2tpbmdBdHRyaWJ1dGVzVW5pcXVlbmVzcyAmJiB1bmlxdWVGaWVsZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICBsZXQgdW5pcXVlbmVzc0NoZWNrcyA9IFtdO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgbmFtZSwgcmVhZE9ubHkgfSBvZiB1bmlxdWVGaWVsZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAocmVhZE9ubHkpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGRhdGFbIG5hbWUgYXMga2V5b2YgdHlwZW9mIGRhdGEgXTtcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKG5hbWUhIGluIGRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gZGF0YVsgbmFtZSBhcyBrZXlvZiB0eXBlb2YgZGF0YSBdO1xuICAgICAgICAgICAgICAgICAgICB1bmlxdWVuZXNzQ2hlY2tzLnB1c2goKCkgPT4gdGhpcy5jaGVja1VuaXF1ZW5lc3NBbmRVcGRhdGUoe1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF5bG9hZFRvVXBkYXRlOiBkYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlTmFtZTogbmFtZSEsXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVWYWx1ZTogdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhBdHRlbXB0c0ZvckNyZWF0aW5nVW5pcXVlQXR0cmlidXRlVmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBpZ25vcmVkRW50aXR5SWRlbnRpZmllcnM6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGVja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCh1bmlxdWVuZXNzQ2hlY2tzLm1hcChjaGVjayA9PiBjaGVjaygpKSk7XG5cbiAgICAgICAgICAgIGlmIChjaGVja1Jlc3VsdHMuaW5jbHVkZXMoZmFsc2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5pcXVlRmllbGRzUGF0aCA9IHVuaXF1ZUZpZWxkcy5tYXAoZmllbGQgPT4gZmllbGQubmFtZSEpID8/IFtdO1xuXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVudGl0eVZhbGlkYXRpb25FcnJvcihbIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogXCJVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIG9uZSBvciBtb3JlIGZpZWxkcy5cIixcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogdW5pcXVlRmllbGRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWQ6IFsgJ3VuaXF1ZScsIHVuaXF1ZUZpZWxkcyBdLFxuICAgICAgICAgICAgICAgIH0gXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1cGRhdGVkRW50aXR5ID0gYXdhaXQgdXBkYXRlRW50aXR5PFM+KHtcbiAgICAgICAgICAgIGlkOiBpZGVudGlmaWVycyxcbiAgICAgICAgICAgIGRhdGE6IGRhdGEsXG4gICAgICAgICAgICBvcGVyYXRvcnM6IG9wZXJhdG9ycyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZTogdGhpcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHVwZGF0ZWRFbnRpdHk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVsZXRlcyBhbiBlbnRpdHkgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGlkZW50aWZpZXJzLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBpZGVudGlmaWVycyAtIFRoZSBpZGVudGlmaWVycyBvZiB0aGUgZW50aXR5IHRvIGJlIGRlbGV0ZWQuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGRlbGV0ZWQgZW50aXR5LlxuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBkZWxldGUoaWRlbnRpZmllcnM6IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8Uz4gfCBBcnJheTxFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFM+PiwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDYWxsZWQgfiBkZWxldGUgfiBlbnRpdHlOYW1lOiAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSB+IGlkZW50aWZpZXJzOmAsIGlkZW50aWZpZXJzKTtcblxuICAgICAgICAgICAgY29uc3QgZGVsZXRlZEVudGl0eSA9IGF3YWl0IGRlbGV0ZUVudGl0eTxTPih7XG4gICAgICAgICAgICAgICAgaWQ6IGlkZW50aWZpZXJzLFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZ2V0RW50aXR5TmFtZSgpLFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2U6IHRoaXMsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIGRlbGV0ZWRFbnRpdHk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBEYXRhYmFzZUVycm9yKGBGYWlsZWQgdG8gZGVsZXRlICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZWJ1aWxkcyBhbGwgaW5kZXhlcyBmb3IgdGhlIGVudGl0eSBieSB3cml0aW5nIHRvIHRoZSBwcmltYXJ5IGluZGV4LlxuICAgICAqIFRoaXMgbWV0aG9kIGlzIHVzZWZ1bCBmb3IgbWFpbnRhaW5pbmcgZGF0YSBpbnRlZ3JpdHkgYW5kIGVuc3VyaW5nIGluZGV4ZXMgYXJlIHByb3Blcmx5IHVwZGF0ZWQuXG4gICAgICogXG4gICAgICogQHBhcmFtIG9wdGlvbnMgLSBPcHRpb25zIGZvciByZWJ1aWxkaW5nIHRoZSBpbmRleFxuICAgICAqIEBwYXJhbSBvcHRpb25zLmJhdGNoU2l6ZSAtIFRoZSBudW1iZXIgb2YgaXRlbXMgdG8gcHJvY2VzcyBpbiBlYWNoIGJhdGNoLiBEZWZhdWx0cyB0byAxMDAuXG4gICAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgaW5kZXggcmVidWlsZCBpcyBjb21wbGV0ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgcmVidWlsZEluZGV4KG9wdGlvbnM6IHsgYmF0Y2hTaXplPzogbnVtYmVyIH0gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBiYXRjaFNpemUgPSAxMDAgfSA9IG9wdGlvbnM7XG4gICAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gdGhpcy5nZXRFbnRpdHlOYW1lKCk7XG4gICAgICAgICAgICBjb25zdCByZXBvc2l0b3J5ID0gdGhpcy5nZXRSZXBvc2l0b3J5KCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFN0YXJ0aW5nIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuXG4gICAgICAgICAgICAvLyBHZXQgYWxsIHJlY29yZHMgZnJvbSB0aGUgcHJpbWFyeSBpbmRleFxuICAgICAgICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IGF3YWl0IHJlcG9zaXRvcnkuc2Nhbi5nbygpO1xuXG4gICAgICAgICAgICBpZiAoIWFsbFJlY29yZHMuZGF0YSB8fCBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gcmVjb3JkcyBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCAke2FsbFJlY29yZHMuZGF0YS5sZW5ndGh9IHJlY29yZHMgdG8gcHJvY2VzcyBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaGVzXG4gICAgICAgICAgICBjb25zdCB0b3RhbFJlY29yZHMgPSBhbGxSZWNvcmRzLmRhdGEubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3QgdG90YWxCYXRjaGVzID0gTWF0aC5jZWlsKHRvdGFsUmVjb3JkcyAvIGJhdGNoU2l6ZSk7XG5cbiAgICAgICAgICAgIGZvciAobGV0IGJhdGNoSW5kZXggPSAwOyBiYXRjaEluZGV4IDwgdG90YWxCYXRjaGVzOyBiYXRjaEluZGV4KyspIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IGJhdGNoSW5kZXggKiBiYXRjaFNpemU7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyBiYXRjaFNpemUsIHRvdGFsUmVjb3Jkcyk7XG4gICAgICAgICAgICAgICAgY29uc3QgYmF0Y2ggPSBhbGxSZWNvcmRzLmRhdGEuc2xpY2Uoc3RhcnQsIGVuZCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBQcm9jZXNzaW5nIGJhdGNoICR7YmF0Y2hJbmRleCArIDF9LyR7dG90YWxCYXRjaGVzfSAoJHtzdGFydCArIDF9LSR7ZW5kfSBvZiAke3RvdGFsUmVjb3Jkc30gcmVjb3JkcylgKTtcblxuICAgICAgICAgICAgICAgIC8vIFJlYnVpbGQgYWxsIGluZGV4ZXMgYnkgdXBzZXJ0aW5nIGVhY2ggcmVjb3JkIHRvIHRoZSBwcmltYXJ5IGluZGV4XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYmF0Y2gpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVzZSB1cHNlcnQgdG8gZW5zdXJlIHRoZSByZWNvcmQgaXMgcHJvcGVybHkgaW5kZXhlZFxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVwb3NpdG9yeS51cHNlcnQocmVjb3JkKS5nbygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVjb3JkOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29tcGxldGVkIGluZGV4IHJlYnVpbGQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciBlbnRpdHk6ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9YCwgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERhdGFiYXNlRXJyb3IoYEZhaWxlZCB0byByZWJ1aWxkIGluZGV4IGZvciAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbmZlcnMgcmVsYXRpb25zaGlwcyBiZXR3ZWVuIGVudGl0aWVzIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBzY2hlbWEgYW5kIHNlbGVjdGlvbi1wYXRocy5cbiAgICAgKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICAgICAqIEBwYXJhbSBwYXRocyBUaGUgcGFyc2VkIHNlbGVjdGlvbiBwYXRocyBmcm9tIGUuZy4gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocygpLlxuICAgICAqIEBwYXJhbSBwYXRoS2V5IFRoZSBjdXJyZW50IFwicGF0aFwiIHN0cmluZyByZXByZXNlbnRpbmcgaG93IHdlIGFycml2ZWQgaGVyZSAoZGVmYXVsdHMgdG8gdGhlIGVudGl0eSBuYW1lKS5cbiAgICAgKiBAcGFyYW0gdmlzaXRlZFBhdGhzIEEgc2V0IG9mIHBhdGgtc3RyaW5ncyB2aXNpdGVkIHNvIGZhciBpbiB0aGlzIHJlY3Vyc2lvbiBjaGFpbiAocHJldmVudHMgY3ljbGVzKS5cbiAgICAgKiBAcGFyYW0gbWF4RGVwdGggTWF4aW11bSByZWN1cnNpb24gZGVwdGggKG9wdGlvbmFsKS5cbiAgICAgKi9cbiAgICBpbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zPEUgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgICAgICBzY2hlbWE6IEUsXG4gICAgICAgIHBhdGhzOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyxcbiAgICAgICAgcGF0aEtleTogc3RyaW5nID0gc2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgdmlzaXRlZFBhdGhzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQ8c3RyaW5nPigpLFxuICAgICAgICBtYXhEZXB0aCA9IDVcbiAgICApOiBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPiB7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ2luZmVyUmVsYXRpb25zaGlwc0ZvckVudGl0eVNlbGVjdGlvbnMnLCB7IHBhdGhLZXksIHBhdGhzIH0pO1xuXG4gICAgICAgIC8vIElmIHdlIGV4Y2VlZCBtYXggZGVwdGgsIHdlIHNraXAgZXhwYW5zaW9uc1xuICAgICAgICBpZiAobWF4RGVwdGggPD0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTWF4IHJlY3Vyc2lvbiBkZXB0aCByZWFjaGVkIGF0IHBhdGhLZXk9XCIke3BhdGhLZXl9XCJgKTtcbiAgICAgICAgICAgIHJldHVybiB7fSBhcyBIeWRyYXRlT3B0aW9uc01hcEZvckVudGl0eTxFPjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZmVycmVkOiBhbnkgPSB7fTtcblxuICAgICAgICAvLyBMb29wIG92ZXIgZWFjaCBhdHRyaWJ1dGUgaW4gdGhlIGVudGl0eSBzY2hlbWFcbiAgICAgICAgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpLmZvckVhY2goKFsgYXR0cmlidXRlTmFtZSwgYXR0cmlidXRlTWV0YSBdKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhdHRWYWwgPSBwYXRoc1sgYXR0cmlidXRlTmFtZSBdO1xuICAgICAgICAgICAgaWYgKCFhdHRWYWwpIHtcbiAgICAgICAgICAgICAgICAvLyBOb3Qgc2VsZWN0ZWQgaW4gdGhlIHVzZXIncyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpc1JlbGF0aW9uYWwgPSAhIWF0dHJpYnV0ZU1ldGEucmVsYXRpb247XG5cbiAgICAgICAgICAgIC8vIElmIHRoZSBhdHRyaWJ1dGUgaXMgbm90IHJlbGF0aW9uYWwgb3IgdGhlIHZhbHVlIGlzIGEgYm9vbGVhbiwgd2UgY2FuIGluZmVyIHRoZSBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGlmICghaXNSZWxhdGlvbmFsIHx8IGlzQm9vbGVhbihhdHRWYWwpKSB7XG4gICAgICAgICAgICAgICAgaW5mZXJyZWRbIGF0dHJpYnV0ZU5hbWUgXSA9IGF0dFZhbDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEl0J3MgYSByZWxhdGlvbmFsIGF0dHJpYnV0ZTsgcHJlcGFyZSB0byByZWN1cnNlXG4gICAgICAgICAgICBjb25zdCByZWxhdGlvbk1ldGEgPSBhdHRyaWJ1dGVNZXRhLnJlbGF0aW9uITtcbiAgICAgICAgICAgIGNvbnN0IG5leHRFbnRpdHlOYW1lID0gcmVsYXRpb25NZXRhLmVudGl0eU5hbWU7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGEgbmV3IFwicGF0aFwiIHN0cmluZyB0byBkZXRlY3QgY3ljbGVzIChlLmcuIFwiVXNlci5ncm91cHMuR3JvdXAubWVtYmVycy5Vc2VyXCIpXG4gICAgICAgICAgICBjb25zdCBuZXdQYXRoID0gYCR7cGF0aEtleX0uJHthdHRyaWJ1dGVOYW1lfS4ke25leHRFbnRpdHlOYW1lfWA7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHdlJ3ZlIGFscmVhZHkgdmlzaXRlZCB0aGlzIHBhdGgsIGlmIHNvID0+IHNraXAgZXhwYW5zaW9ucyBmb3IgdGhpcyBhdHRyaWJ1dGUgb25seVxuICAgICAgICAgICAgaWYgKHZpc2l0ZWRQYXRocy5oYXMobmV3UGF0aCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTa2lwcGluZyBjeWMgcmVsYXRpb24gZXhwYW5zaW9ucyBmb3I6ICR7bmV3UGF0aH1gKTtcbiAgICAgICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgc2tpcHBlZER1ZVRvQ3ljbGU6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIE1hcmsgdGhpcyBwYXRoIGFzIHZpc2l0ZWRcbiAgICAgICAgICAgIHZpc2l0ZWRQYXRocy5hZGQobmV3UGF0aCk7XG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gdGhlIHJlbGF0ZWQgZW50aXR5J3Mgc2NoZW1hXG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2NoZW1hID0gdGhpcy5nZXRFbnRpdHlTY2hlbWFCeUVudGl0eU5hbWU8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihuZXh0RW50aXR5TmFtZSk7XG4gICAgICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KG5leHRFbnRpdHlOYW1lKTtcblxuICAgICAgICAgICAgLy8gQnVpbGQgdGhlIFwibWV0YVwiIG9iamVjdCB0aGF0IHdlIHN0b3JlXG4gICAgICAgICAgICBjb25zdCBtZXRhOiBIeWRyYXRlT3B0aW9uRm9yUmVsYXRpb24gPSB7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogbmV4dEVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcmVsYXRpb25UeXBlOiByZWxhdGlvbk1ldGEudHlwZSxcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyczogaXNGdW5jdGlvbihyZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMpXG4gICAgICAgICAgICAgICAgICAgID8gcmVsYXRpb25NZXRhLmlkZW50aWZpZXJzKClcbiAgICAgICAgICAgICAgICAgICAgOiByZWxhdGlvbk1ldGEuaWRlbnRpZmllcnMsXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlczoge30sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgcGF0aFNlbGVjdGlvbkF0dHJpYnV0ZXMgPSBpc09iamVjdChhdHRWYWwpID8gYXR0VmFsLmF0dHJpYnV0ZXMgOiB1bmRlZmluZWQ7IC8vIHByb3ZpZGVkIGJ5IHRoZSB1c2VyIFxuICAgICAgICAgICAgY29uc3QgcmVsYXRpb25TZWxlY3Rpb25BdHRyaWJ1dGVzID0gcmVsYXRpb25NZXRhLmF0dHJpYnV0ZXM7IC8vIGRlZmluZWQgaW4gdGhlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlEZWZhdWx0U2VsZWN0aW9uQXR0cmlidXRlcyA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlLmdldERlZmF1bHRTZXJpYWxpemF0aW9uQXR0cmlidXRlTmFtZXMoKTsgLy8gYXV0byBnZW4gYnkgZnJhbWV3b3JrXG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2UgdG8gZXhwYW5kIGNoaWxkJ3MgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgbWV0YS5hdHRyaWJ1dGVzID0gdGhpcy5pbmZlclJlbGF0aW9uc2hpcHNGb3JFbnRpdHlTZWxlY3Rpb25zKFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgKHBhdGhTZWxlY3Rpb25BdHRyaWJ1dGVzIHx8IHJlbGF0aW9uU2VsZWN0aW9uQXR0cmlidXRlcyB8fCByZWxhdGVkRW50aXR5RGVmYXVsdFNlbGVjdGlvbkF0dHJpYnV0ZXMpIGFzIGFueSxcbiAgICAgICAgICAgICAgICBuZXh0RW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICB2aXNpdGVkUGF0aHMsXG4gICAgICAgICAgICAgICAgbWF4RGVwdGggLSAxXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBpbmZlcnJlZFsgYXR0cmlidXRlTmFtZSBdID0gbWV0YTtcblxuICAgICAgICAgICAgLy8gUmVtb3ZlIHRoaXMgcGF0aCBzbyBzaWJsaW5ncyBjYW4gYWxzbyBleHBhbmQgaXQgaWYgbmVlZGVkXG4gICAgICAgICAgICB2aXNpdGVkUGF0aHMuZGVsZXRlKG5ld1BhdGgpO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gaW5mZXJyZWQ7XG4gICAgfVxuXG4gICAgcHVibGljIGFzeW5jIHNlYXJjaChxdWVyeTogRW50aXR5U2VhcmNoUXVlcnk8Uz4sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXF1ZXJ5LnNlbGVjdCkge1xuICAgICAgICAgICAgLy8gKiBOb3RlOiB3ZSBleHBlY3QgYW4gYXJyYXkgb2YgYXR0cmlidXRlIG5hbWVzXG4gICAgICAgICAgICBxdWVyeS5zZWxlY3QgPSB0aGlzLmdldExpc3RpbmdBdHRyaWJ1dGVOYW1lcygpIGFzIGFueTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2VhcmNoU2VydmljZS5zZWFyY2gocXVlcnksIHVuZGVmaW5lZCwgY3R4KTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGF0dElkOiBzdHJpbmcsIGF0dDogRW50aXR5QXR0cmlidXRlKTogUGFydGlhbDxFbnRpdHlBdHRyaWJ1dGU+ICYge1xuICAgIGlkOiBzdHJpbmcsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXVxufSB7XG5cbiAgICBjb25zdCB7IG5hbWUsIHZhbGlkYXRpb25zLCByZXF1aXJlZCwgcmVsYXRpb24sIGRlZmF1bHQ6IGRlZmF1bHRWYWx1ZSwgZ2V0OiBfZ2V0dGVyLCBzZXQ6IF9zZXR0ZXIsIHdhdGNoLCAuLi5yZXN0TWV0YSB9ID0gYXR0O1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lOiByZWxhdGVkRW50aXR5TmFtZSwgLi4ucmVzdFJlbGF0aW9uIH0gPSByZWxhdGlvbiB8fCB7fTtcblxuICAgIGNvbnN0IHJlbGF0aW9uTWV0YSA9IHJlbGF0ZWRFbnRpdHlOYW1lID8geyAuLi5yZXN0UmVsYXRpb24sIGVudGl0eU5hbWU6IHJlbGF0ZWRFbnRpdHlOYW1lIH0gOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCB7IGl0ZW1zLCB0eXBlLCBwcm9wZXJ0aWVzLCBhZGROZXdPcHRpb24sIC4uLnJlc3RSZXN0TWV0YSB9ID0gcmVzdE1ldGEgYXMgYW55O1xuXG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnJlc3RSZXN0TWV0YSxcbiAgICAgICAgdHlwZSxcbiAgICAgICAgaWQ6IGF0dElkLFxuICAgICAgICBuYW1lOiBuYW1lIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUoYXR0SWQpLFxuICAgICAgICByZWxhdGlvbjogcmVsYXRpb25NZXRhIGFzIGFueSxcbiAgICAgICAgZGVmYXVsdFZhbHVlLFxuICAgICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvbnMgfHwgcmVxdWlyZWQgPyBbICdyZXF1aXJlZCcgXSA6IFtdLFxuICAgICAgICBpc1Zpc2libGU6ICEoJ2lzVmlzaWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNWaXNpYmxlLFxuICAgICAgICBpc0VkaXRhYmxlOiAhKCdpc0VkaXRhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0VkaXRhYmxlLFxuICAgICAgICBpc0xpc3RhYmxlOiAhKCdpc0xpc3RhYmxlJyBpbiBhdHQpID8gdHJ1ZSA6IGF0dC5pc0xpc3RhYmxlLFxuICAgICAgICBpc0NyZWF0YWJsZTogISgnaXNDcmVhdGFibGUnIGluIGF0dCkgPyB0cnVlIDogYXR0LmlzQ3JlYXRhYmxlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6ICEoJ2lzRmlsdGVyYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNGaWx0ZXJhYmxlLFxuICAgICAgICBpc1NlYXJjaGFibGU6ICEoJ2lzU2VhcmNoYWJsZScgaW4gYXR0KSA/IHRydWUgOiBhdHQuaXNTZWFyY2hhYmxlLFxuICAgIH1cblxuICAgIGlmIChhZGROZXdPcHRpb24pIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uJyBdID0gYWRkTmV3T3B0aW9uO1xuICAgIH1cblxuICAgIC8vXG4gICAgLy8gKiogbWFrZSBzdXJlIHRvIG5vdCBvdmVycmlkZSB0aGUgaW5uZXIgZmllbGRzIG9mIGF0dHJpYnV0ZXMgbGlrZSBgbGlzdC1baXRlbXNdLVttYXBdLXByb3BlcnRpZXNgICoqXG4gICAgLy9cbiAgICBpZiAodHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAncHJvcGVydGllcycgXSA9IE9iamVjdC5lbnRyaWVzPGFueT4ocHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSk7XG4gICAgfSBlbHNlIGlmICh0eXBlID09PSAnbGlzdCcgJiYgaXRlbXMudHlwZSA9PT0gJ21hcCcpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAuLi5pdGVtcyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IE9iamVjdC5lbnRyaWVzPGFueT4oaXRlbXMucHJvcGVydGllcykubWFwKChbIGssIHYgXSkgPT4gZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShrLCB2KSlcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkXG59XG5cbmV4cG9ydCB0eXBlIFRJT1NjaGVtYUF0dHJpYnV0ZSA9IFJldHVyblR5cGU8dHlwZW9mIGVudGl0eUF0dHJpYnV0ZVRvSU9TY2hlbWFBdHRyaWJ1dGU+O1xuZXhwb3J0IHR5cGUgVElPU2NoZW1hQXR0cmlidXRlc01hcDxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiA9IE1hcDxrZXlvZiBTWyAnYXR0cmlidXRlcycgXSwgVElPU2NoZW1hQXR0cmlidXRlPjtcblxuLyoqXG4gKiBDcmVhdGVzIGFuIGFjY2VzcyBwYXR0ZXJucyBzY2hlbWEgYmFzZWQgb24gdGhlIHByb3ZpZGVkIGVudGl0eSBzY2hlbWEuXG4gKiBAcGFyYW0gc2NoZW1hIFRoZSBlbnRpdHkgc2NoZW1hLlxuICogQHJldHVybnMgQSBtYXAgb2YgYWNjZXNzIHBhdHRlcm5zLCB3aGVyZSB0aGUga2V5cyBhcmUgdGhlIGluZGV4IG5hbWVzIGFuZCB0aGUgdmFsdWVzIGFyZSBtYXBzIG9mIGF0dHJpYnV0ZSBuYW1lcyBhbmQgdGhlaXIgY29ycmVzcG9uZGluZyBzY2hlbWEgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VFbnRpdHlBY2Nlc3NQYXR0ZXJuc1NjaGVtYTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihzY2hlbWE6IFMpIHtcbiAgICBjb25zdCBhY2Nlc3NQYXR0ZXJucyA9IG5ldyBNYXA8a2V5b2YgU1sgJ2luZGV4ZXMnIF0sIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4+KCk7XG5cbiAgICBmb3IgKGNvbnN0IGluZGV4TmFtZSBpbiBzY2hlbWEuaW5kZXhlcykge1xuICAgICAgICBjb25zdCBpbmRleEF0dHJpYnV0ZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4gPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhQa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0ucGsuY29tcG9zaXRlKSB7XG4gICAgICAgICAgICBjb25zdCBhdHQgPSBzY2hlbWEuYXR0cmlidXRlc1sgaWR4UGtBdHQgXTtcbiAgICAgICAgICAgIGluZGV4QXR0cmlidXRlcy5zZXQoaWR4UGtBdHQsIHtcbiAgICAgICAgICAgICAgICAuLi5lbnRpdHlBdHRyaWJ1dGVUb0lPU2NoZW1hQXR0cmlidXRlKGlkeFBrQXR0LCB7IC4uLmF0dCwgcmVxdWlyZWQ6IHRydWUgfSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBpZHhTa0F0dCBvZiBzY2hlbWEuaW5kZXhlc1sgaW5kZXhOYW1lIF0uc2s/LmNvbXBvc2l0ZSA/PyBbXSkge1xuICAgICAgICAgICAgY29uc3QgYXR0ID0gc2NoZW1hLmF0dHJpYnV0ZXNbIGlkeFNrQXR0IF07XG4gICAgICAgICAgICBpbmRleEF0dHJpYnV0ZXMuc2V0KGlkeFNrQXR0LCB7XG4gICAgICAgICAgICAgICAgLi4uZW50aXR5QXR0cmlidXRlVG9JT1NjaGVtYUF0dHJpYnV0ZShpZHhTa0F0dCwgeyAuLi5hdHQsIHJlcXVpcmVkOiB0cnVlIH0pXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFjY2Vzc1BhdHRlcm5zLnNldChpbmRleE5hbWUsIGluZGV4QXR0cmlidXRlcyk7XG4gICAgfVxuXG4gICAgLy8gbWFrZSBzdXJlIHRoZXJlJ3MgYSBwcmltYXJ5IGFjY2VzcyBwYXR0ZXJuO1xuICAgIGlmICghYWNjZXNzUGF0dGVybnMuaGFzKCdwcmltYXJ5JykpIHtcbiAgICAgICAgYWNjZXNzUGF0dGVybnMuc2V0KCdwcmltYXJ5JywgYWNjZXNzUGF0dGVybnMudmFsdWVzKCkubmV4dCgpLnZhbHVlISk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFjY2Vzc1BhdHRlcm5zO1xufVxuIl19