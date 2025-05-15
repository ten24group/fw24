import type { EntityConfiguration } from "electrodb";
import { DIContainer, OnInit } from "../di";
import type { EntityInputValidations, EntityValidations } from "../validation";
import type { CreateEntityItemTypeFromSchema, EntityAttribute, EntityIdentifiersTypeFromSchema, EntityRecordTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, EntitySchema, HydrateOptionForEntity, HydrateOptionForRelation, HydrateOptionsMapForEntity, RelationIdentifier, SpecialAttributeType, TDefaultEntityOperations, UpdateEntityItemTypeFromSchema, UpsertEntityItemTypeFromSchema } from "./base-entity";
import type { EntityFilterCriteria, EntityQuery, EntitySelections, ParsedEntityAttributePaths } from "./query-types";

import { createLogger } from "../logging";
import { JsonSerializer, getValueByPath, isArray, isBoolean, isClassConstructor, isEmpty, isEmptyObjectDeep, isFunction, isObject, isString, isSubclassOf, pascalCase, pickKeys, toHumanReadableName, toSlug } from "../utils";
import { createElectroDBEntity } from "./base-entity";
import { createEntity, deleteEntity, getEntity, getBatchEntity, listEntity, queryEntity, updateEntity, UpdateEntityOperators, upsertEntity } from "./crud-service";
import { addFilterGroupToEntityFilterCriteria, makeFilterGroupForSearchKeywords, parseEntityAttributePaths } from "./query";
import { DepIdentifier, IDIContainer } from "../interfaces";
import { DatabaseError, EntityValidationError } from './errors';
import { ExecutionContext } from "../core/types/execution-context";
import { BaseSearchService, EntitySearchService, EntitySearchQuery, SearchIndexConfig } from '../search';
import { EntitySchemaValidator } from "./entity-schema-validator";

export type ExtractEntityIdentifiersContext = {
    // tenantId: string, 
    forAccessPattern?: string
}

type GetOptions<S extends EntitySchema<any, any, any>> = {
    identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>,
    attributes?: EntitySelections<S>
}

export function hasAttribute(schema: EntitySchema<any, any, any>, attributeName: string) {
    return (attributeName in schema.attributes);
}

export function hasAttributeBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType) {
    return getAttributeNameBy(schema, spec) !== undefined;
}

export function getAttributeNameBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType) {

    let specAttMetaKey = `entity${pascalCase(spec)}Attribute`;
    if (specAttMetaKey in schema.model) {
        return schema.model[ specAttMetaKey as keyof typeof schema.model ] as string;
    }

    if (hasAttribute(schema, `${schema.model.entity}${pascalCase(spec)}`)) {
        return `${schema.model.entity}${pascalCase(spec)}`;
    }

    if (hasAttribute(schema, spec)) {
        return spec;
    }

    return undefined;
}

export abstract class BaseEntityService<S extends EntitySchema<any, any, any>> {

    readonly logger = createLogger(`BaseEntityService:${this.constructor.name}`);

    protected entityRepository?: EntityRepositoryTypeFromSchema<S>;
    protected entityOpsDefaultIoSchema?: ReturnType<typeof this.makeOpsDefaultIOSchema<S>>;

    constructor(
        readonly schema: S,
        protected readonly entityConfigurations: EntityConfiguration,
        protected readonly diContainer: IDIContainer = DIContainer.ROOT,
    ) { }

    protected makeEntityIndexName(schema: EntitySchema<any, any, any>, ctx?: ExecutionContext<any>) {
        const tenantId = ctx?.actor?.tenantId || '';
        const applicationId = ctx?.actor?.applicationId || '';
        const environmentId = ctx?.actor?.environmentId || '';
        const entityName = schema.model.entity;
        // const version = schema.model.version;

        // ten24-backend-dev-user;
        return [ tenantId, applicationId, environmentId, entityName ].filter(Boolean).join('-').toLowerCase();
    }

    public getEntitySearchConfig(ctx?: ExecutionContext<any>) {

        const schema = this.getEntitySchema();

        const searchConfig = schema.model.search || {
            enabled: true,
            indexConfig: {}
        };

        searchConfig.serviceClass = searchConfig.serviceClass || EntitySearchService;
        searchConfig.indexConfig.indexName = searchConfig.indexConfig.indexName || this.makeEntityIndexName(schema, ctx);
        searchConfig.indexConfig.primaryKey = searchConfig.indexConfig.primaryKey || this.getEntityPrimaryIdPropertyName();

        return searchConfig;
    }

    public getSearchService(): EntitySearchService<S> {
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
            if (searchServiceTokenOrClass && this.diContainer.has(searchServiceTokenOrClass as DepIdentifier<EntitySearchService<any>>)) {
                try {
                    return this.diContainer.resolve<EntitySearchService<S>>(searchServiceTokenOrClass as DepIdentifier<EntitySearchService<S>>);
                } catch (err: any) {
                    debugger;
                    this.logger.error('Failed to resolve search service from container:', err);
                    throw new Error(`Failed to resolve search service for entity ${this.getEntityName()}: ${err.message}`);
                }
            }

            // Case 2: Service instance provided
            if (searchServiceTokenOrClass instanceof BaseSearchService) {
                return searchServiceTokenOrClass;
            }

            // Case 3: Service class provided
            if (
                isClassConstructor(searchServiceTokenOrClass) &&
                (
                    searchServiceTokenOrClass === EntitySearchService
                    ||
                    searchServiceTokenOrClass.prototype instanceof EntitySearchService
                )
            ) {
                try {
                    const searchEngine = this.diContainer.resolveSearchEngine();
                    if (!searchEngine) {
                        throw new Error('Search engine not found in container');
                    }
                    return new (searchServiceTokenOrClass as typeof EntitySearchService)(
                        this,
                        searchEngine,
                    );
                } catch (err: any) {
                    this.logger.error('Failed to instantiate search service:', err);
                    throw new Error(`Failed to create search service instance for entity ${this.getEntityName()}: ${err.message}`);
                }
            }

            throw new Error(`No valid search-service-configuration found for entity: ${this.getEntityName()}`);
        } catch (err: any) {
            this.logger.error('Error in getSearchService:', err);
            throw new Error(`Search service initialization failed for entity ${this.getEntityName()}: ${err.message}`);
        }
    }

    private validateSearchConfig(searchConfig: EntitySchema<any, any, any>[ 'model' ][ 'search' ]) {

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
            const invalidAttributes = config.settings.searchableAttributes.filter(
                (attr: string) => !hasAttribute(this.getEntitySchema(), attr)
            );
            if (invalidAttributes.length > 0) {
                throw new Error(`Invalid searchable attributes: ${invalidAttributes.join(', ')}`);
            }
        }

        // Validate filterable attributes if specified
        if (config.settings?.filterableAttributes) {
            const invalidAttributes = config.settings.filterableAttributes.filter(
                (attr: string) => !hasAttribute(this.getEntitySchema(), attr)
            );
            if (invalidAttributes.length > 0) {
                throw new Error(`Invalid filterable attributes: ${invalidAttributes.join(', ')}`);
            }
        }
    }

    public validateEntitySchema() {
        const validator = new EntitySchemaValidator(this.diContainer);
        validator.validateSchema(
            this.getEntitySchema(),
            this.entityConfigurations
        );
    }

    getEntityServiceByEntityName<T extends EntitySchema<any, any, any>>(relatedEntityName: string) {
        return this.diContainer.resolveEntityService<BaseEntityService<T>>(relatedEntityName);
    }

    hasEntityServiceByEntityName(relatedEntityName: string) {
        return this.diContainer.hasEntityService(relatedEntityName);
    }

    getEntitySchemaByEntityName<T extends EntitySchema<any, any, any>>(relatedEntityName: string) {
        return this.diContainer.resolveEntitySchema<T>(relatedEntityName);
    }

    hasEntitySchemaByEntityName(relatedEntityName: string) {
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
    extractEntityIdentifiers(
        input: Record<string, string> | Array<Record<string, string>>,
        context: ExtractEntityIdentifiersContext = {
            // tenantId: 'xxx-yyy-zzz'
        }
    ): EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>> {

        if (!input || typeof input !== 'object') {
            throw new Error('Input is required and must be an object containing entity-identifiers or an array of objects containing entity-identifiers');
        }

        const isBatchInput = isArray(input);

        const inputs = isBatchInput ? input : [ input ];

        // TODO: tenant logic
        // identifiers['tenantId'] = input.tenantId || context.tenantId;

        const accessPatterns = makeEntityAccessPatternsSchema(this.getEntitySchema());

        const identifierAttributes = new Set<{ name: string, required: boolean }>();
        for (const [ accessPatternName, accessPatternAttributes ] of accessPatterns) {
            if (!context.forAccessPattern || accessPatternName == context.forAccessPattern) {
                for (const [ , att ] of accessPatternAttributes) {
                    identifierAttributes.add({
                        name: att.id,
                        required: att.required == true
                    });
                }
            }
        }

        const primaryAttName = this.getEntityPrimaryIdPropertyName();

        const identifiersBatch = inputs.map(input => {
            const identifiers: any = {};
            for (const { name: attName, required } of identifierAttributes) {
                if ((attName in input)) {
                    identifiers[ attName ] = input[ attName ];
                } else if (attName == primaryAttName && ('id' in input)) {
                    identifiers[ attName ] = input.id;
                } else if (required) {
                    this.logger.warn(`required attribute: ${attName} for access-pattern: ${context.forAccessPattern ?? '--primary--'} is not found in input:`, input);
                }
            }
            return identifiers as EntityIdentifiersTypeFromSchema<S>;
        }
        );

        this.logger.debug('Extracting identifiers from identifiers:', identifiersBatch);

        return isBatchInput ? identifiersBatch : identifiersBatch[ 0 ];
    };

    public getEntityName(): S[ 'model' ][ 'entity' ] { return this.getEntitySchema().model.entity; }

    public getEntitySchema(): S { return this.schema; }

    public getRepository() {
        if (!this.entityRepository) {
            const { entity } = createElectroDBEntity({
                schema: this.getEntitySchema(),
                entityConfigurations: this.entityConfigurations
            });
            this.entityRepository = entity as EntityRepositoryTypeFromSchema<S>;
        }

        return this.entityRepository!;
    }

    /**
     * Placeholder for the entity validations; override this to provide your own validations
     * @returns An object containing the entity validations.
     */
    public getEntityValidations(): EntityValidations<S> | EntityInputValidations<S> {
        return {};
    };

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
    public async getOverriddenEntityValidationErrorMessages() {
        return Promise.resolve(new Map<string, string>());
    }

    public getEntityPrimaryIdPropertyName() {
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];
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
    protected makeOpsDefaultIOSchema<
        S extends EntitySchema<any, any, any, Ops>,
        Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
    >(schema: S) {

        const inputSchemaAttributes = {
            create: new Map() as TIOSchemaAttributesMap<S>,
            update: new Map() as TIOSchemaAttributesMap<S>,
        };

        const outputSchemaAttributes = {
            detail: new Map() as TIOSchemaAttributesMap<S>,
            list: new Map() as TIOSchemaAttributesMap<S>,
        };

        // create and update
        for (const attName in schema.attributes) {

            const att = schema.attributes[ attName ];
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
    public getOpsDefaultIOSchema() {
        if (!this.entityOpsDefaultIoSchema) {
            this.entityOpsDefaultIoSchema = this.makeOpsDefaultIOSchema<S>(this.getEntitySchema());
        }
        return this.entityOpsDefaultIoSchema;
    }

    /**
     * Returns an array of default serialization attribute names. Used by the `detail` API to serialize the entity.
     * 
     * @returns {Array<string>} An array of default serialization attribute names.
     */
    public getDefaultSerializationAttributeNames(): EntitySelections<S> {
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().get.output;

        const attributes: any = {};
        defaultOutputSchemaAttributesMap.forEach((_, key) => {
            // if (!val.relation || val.relation.hydrate) {
            // }
            attributes[ key ] = true
        });

        return attributes as EntitySelections<S>;

        //  return Array.from( defaultOutputSchemaAttributesMap.keys() ) as EntitySelections<S>;
    }

    /**
     * Returns attribute names for listing and search API. Defaults to the default serialization attribute names.
     * @returns {Array<string>} An array of attribute names.
     */
    public getListingAttributeNames(): EntitySelections<S> {
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().list.output;
        return Array.from(defaultOutputSchemaAttributesMap.keys()) as EntitySelections<S>;
    }

    /**
     * Returns the default attribute names to be used for keyword search. Defaults to all string attributes which are not hidden and are not identifiers.
     * @returns {Array<string>} attribute names to be used for keyword search
    */
    public getSearchableAttributeNames(): Array<string> {
        const attributeNames = [];
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];
            if (!att.hidden && !att.isIdentifier && att.type === 'string'
                &&
                (!('isSearchable' in att) || att.isSearchable)
            ) {
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
    public getUniqueAttributes(): Array<EntityAttribute> {
        const attributes = [];
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];

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
    public getFilterableAttributeNames(): Array<string> {
        const attributeNames = [];
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];
            if (
                !att.hidden && [ 'string', 'number' ].includes(att.type as string)
                &&
                (!('isFilterable' in att) || att.isFilterable)
            ) {
                attributeNames.push(attName);
            }
        }

        return attributeNames;
    }

    public serializeRecord<T extends Record<string, any>>(record: T, attributes = this.getDefaultSerializationAttributeNames()): Partial<T> {

        let keys: Array<string>;

        if (Array.isArray(attributes)) {
            const parsed = parseEntityAttributePaths(attributes as string[]);
            keys = Object.keys(parsed);
        } else {
            keys = Object.keys(attributes);
        }

        return pickKeys<T>(record, ...keys);
    }

    public serializeRecords<T extends Record<string, any>>(record: Array<T>, attributes = this.getDefaultSerializationAttributeNames()): Array<Partial<T>> {
        return record.map(record => this.serializeRecord<T>(record, attributes));
    }

    async hydrateRecords(
        relations: Array<[ relatedAttributeName: string, options: HydrateOptionForRelation<any> ]>,
        rootEntityRecords: Array<{ [ x: string ]: any; }>
    ) {
        this.logger.debug(`called 'hydrateRecords' for entity: ${this.getEntityName()}`);
        await Promise.all(relations?.map(async ([ relatedAttributeName, options ]) => {
            await this.hydrateSingleRelation(rootEntityRecords, relatedAttributeName, options);
        }));
    }

    private async hydrateSingleRelation(rootEntityRecords: any[], relatedAttributeName: string, options: HydrateOptionForRelation<any>) {
        this.logger.debug(`called 'hydrateSingleRelation' relation: ${relatedAttributeName} for entity: ${this.getEntityName()}`, {
            options
        });

        const { entityName: relatedEntityName, relationType, identifiers } = options;

        if (!identifiers) {
            throw (`No Identifiers:[${relationType}:${relatedEntityName}] provided`);
        }

        if (relationType == 'one-to-one' || relationType == 'many-to-many') {
            throw (`RelationType:[${relationType}:${relatedEntityName}] in not supported by hydration, use one of [many-to-one, one-to-many] ot manually hydrate'`)
        }

        // Get related entity service
        const relatedEntityService = this.getEntityServiceByEntityName(relatedEntityName);
        if (!relatedEntityService) {
            throw new Error(`No service found for relationship: ${relatedAttributeName}(${relatedEntityName}); please make sure service has been registered in the required 'di-container'`);
        }

        // Get relation's metadata
        const currentEntitySchema = this.getEntitySchema();
        const relationAttributeMetadata = currentEntitySchema.attributes[ relatedAttributeName as any ] as EntityAttribute;

        if (!relationAttributeMetadata || !relationAttributeMetadata?.relation) {
            const message = `No metadata found for relationship: ${relatedAttributeName}`
            this.logger.warn(message, relationAttributeMetadata);
            throw (message);
        }

        // relation identifiers mapping
        const identifierMappings: RelationIdentifier<any>[] = Array.isArray(identifiers) ? identifiers : [ identifiers! ];

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
            await this.hydrateManyToOne(
                rootEntityRecords,
                relatedAttributeName,
                identifierMappings,
                options.attributes,
                relatedEntityService
            );
        } else if (relationType === 'one-to-many') {
            /**
             * ONE-TO-MANY:
             * -------------
             * The "rootEntityRecords" are the PARENT items. Each parent can have multiple
             * child items. The child table records each store the parent's key. 
             * So we do a query per parent and then .
             */
            await this.hydrateOneToMany(
                rootEntityRecords,
                relatedAttributeName,
                identifierMappings,
                options.attributes,
                relatedEntityService
            );
        }
    }

    private async hydrateManyToOne(
        childRecords: any[],
        parentAttributeName: string,
        identifierMappings: RelationIdentifier<any>[],
        parentAttributesToHydrate: HydrateOptionForEntity<any> | undefined,
        parentService: BaseEntityService<any>
    ) {
        this.logger.debug(`called 'hydrateManyToOne' relation: ${parentAttributeName} for entity: ${this.getEntityName()}`, {
            parentAttributesToHydrate,
        });

        // for each parent create a children batch
        const parentIdentifiersToChildrenMap = new Map<string, any[]>();

        for (const child of childRecords) {
            if (!child) continue;

            // Build a parent key object. E.g. { orgId: child.orgId, userId: child.userId } for 2-attr PK
            const parentKeyObj: Record<string, any> = {};
            for (const { source, target } of identifierMappings) {

                try {
                    const val = getValueByPath(child, source);
                    if (val == null) continue;

                    parentKeyObj[ target as string ] = val;

                } catch (error) {
                    this.logger.error(`Error getting value for path: ${source}`, { error });
                }
            }

            // If partial or empty, skip
            if (Object.keys(parentKeyObj).length === 0) {
                child[ parentAttributeName ] = null;
                continue;
            }

            const keyStr = JSON.stringify(parentKeyObj);
            if (!parentIdentifiersToChildrenMap.has(keyStr)) {
                parentIdentifiersToChildrenMap.set(keyStr, []);
            }
            parentIdentifiersToChildrenMap.get(keyStr)!.push(child);
        }

        if (parentIdentifiersToChildrenMap.size === 0) return;

        // Create a parent-identifiers-batch for fetching
        const parentIdentifiersBatch: Array<Record<string, any>> = [];
        for (const k of parentIdentifiersToChildrenMap.keys()) {
            parentIdentifiersBatch.push(JSON.parse(k));
        }

        const fetchedParents = await parentService.get({
            identifiers: parentIdentifiersBatch,
            attributes: parentAttributesToHydrate,
        });

        // If "get()" returns a single item convert it into an array.
        const parentsArray = Array.isArray(fetchedParents) ? fetchedParents : [ fetchedParents ];

        // Make a dictionary from { <keyStr> => parentRecord }
        const parentDict = new Map<string, any>();
        for (const p of parentsArray) {
            if (!p) {
                continue;
            }
            // Rebuild the "composite key" from the parent's record
            const keyObj: Record<string, any> = {};
            for (const { target } of identifierMappings) {
                if (p[ target ] == null) {
                    // If some attribute is missing, skip
                    continue;
                }
                keyObj[ target as string ] = p[ target ];
            }
            const kStr = JSON.stringify(keyObj);
            parentDict.set(kStr, p);
        }

        // Attach each parent's data to the child
        for (const [ kStr, children ] of parentIdentifiersToChildrenMap.entries()) {
            const foundParent = parentDict.get(kStr) ?? null;
            for (const c of children) {
                c[ parentAttributeName ] = foundParent;
            }
        }
    }

    private async hydrateOneToMany(
        parentRecords: any[],
        childAttributeName: string,
        identifierMappings: RelationIdentifier<any>[],
        childAttributesToHydrate: HydrateOptionForEntity<any> | undefined,
        childService: BaseEntityService<any>
    ) {

        this.logger.debug(`called 'hydrateOneToMany' relation: ${childAttributeName} for entity: ${this.getEntityName()}`, {
            childAttributesToHydrate,
        });

        const parentKeyStrToParents = new Map<string, any[]>();

        for (const parent of parentRecords) {
            if (!parent) continue;

            // Build a "child index" key from the parent's fields. For example, 
            // if the child GSI has { pk: 'tenantId', sk: 'accountId' }, 
            // we fill { tenantId: parent.tenantId, accountId: parent.accountId }.
            const childKeyObj: Record<string, any> = {};
            for (const { source, target } of identifierMappings) {
                if (parent[ source ] != null) {
                    childKeyObj[ target as string ] = parent[ source ];
                }
            }

            // If we have no valid composite key, no children can be fetched
            if (Object.keys(childKeyObj).length === 0) {
                parent[ childAttributeName ] = [];
                continue;
            }

            const keyStr = JSON.stringify(childKeyObj);
            if (!parentKeyStrToParents.has(keyStr)) {
                parentKeyStrToParents.set(keyStr, []);
            }
            parentKeyStrToParents.get(keyStr)!.push(parent);
        }

        // If no parent has a valid key, we're done
        if (parentKeyStrToParents.size === 0) {
            return;
        }

        // For each unique parentKeyObj, do a childService query/list in parallel.
        const promises: Array<Promise<any>> = [];
        const parentKeys: string[] = [];

        for (const [ keyStr ] of parentKeyStrToParents.entries()) {

            const childKeyObj = JSON.parse(keyStr);

            parentKeys.push(keyStr);

            const filters: Record<string, any> = {};
            for (const [ childField, val ] of Object.entries(childKeyObj)) {
                filters[ childField ] = { eq: val };
            }

            promises.push(
                childService.list({
                    filters,
                    attributes: childAttributesToHydrate,
                })
            );
        }

        const results = await Promise.all(promises);

        // For each result, map children back to the correct-parent(s)
        const parentKeyStrToChildren: Record<string, any[]> = {};
        for (let i = 0; i < results.length; i++) {
            const { data: childItems } = results[ i ];
            const keyStr = parentKeys[ i ];
            parentKeyStrToChildren[ keyStr ] = childItems ?? [];
        }

        // Attach to parents
        for (const [ keyStr, parents ] of parentKeyStrToParents.entries()) {
            const childArray = parentKeyStrToChildren[ keyStr ] ?? [];
            for (const p of parents) {
                p[ childAttributeName ] = childArray;
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

    public async get(options: GetOptions<S>, _ctx?: ExecutionContext) {
        const { identifiers, attributes } = options;


        let formattedAttributes = attributes;
        if (!attributes) {
            formattedAttributes = this.getDefaultSerializationAttributeNames()
        }

        if (Array.isArray(formattedAttributes)) {
            const parsedOptions = parseEntityAttributePaths(formattedAttributes as string[]);
            formattedAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }

        this.logger.debug(`Formatted attributes for entity: ${this.getEntityName()}`, formattedAttributes);

        const requiredSelectAttributes = Object.entries(formattedAttributes as any).reduce((acc, [ attName, options ]) => {
            acc.push(attName);
            if (isObject(options) && options.identifiers) {
                const identifiers: Array<RelationIdentifier<any>> = Array.isArray(options.identifiers) ? options.identifiers : [ options.identifiers ];
                const topKeys = identifiers.map(identifier => identifier.source?.split?.('.')?.[ 0 ]).filter(key => !!key) as string[];
                acc.push(...topKeys);
            }
            return acc;
        }, [] as string[]);

        const uniqueSelectionAttributes = [ ...new Set(requiredSelectAttributes) ]

        const entity = await getEntity<S>({
            id: identifiers,
            attributes: uniqueSelectionAttributes,
            entityName: this.getEntityName(),
            entityService: this,
        });

        this.logger.debug(`Retrieved entity: ${this.getEntityName()}`, JsonSerializer.stringify(entity));

        if (!!formattedAttributes && entity?.data) {
            const relationalAttributes = Object.entries(formattedAttributes)?.map(([ attributeName, options ]) => [ attributeName, options ])
                .filter(([ , options ]) => isObject(options));

            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes as any, [ entity.data ]);
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
    public async batchGet<S extends EntitySchema<any, any, any>>(options: {
        identifiers: Array<EntityIdentifiersTypeFromSchema<S>>,
        attributes?: EntitySelections<S>,
        concurrent?: number
    }) {
        const { identifiers, attributes, concurrent = 1 } = options;

        let formattedAttributes = attributes;
        if (!attributes) {
            formattedAttributes = this.getDefaultSerializationAttributeNames()
        }

        if (Array.isArray(formattedAttributes)) {
            const parsedOptions = parseEntityAttributePaths(formattedAttributes as string[]);
            formattedAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }

        this.logger.debug(`Formatted attributes for batch get on entity: ${this.getEntityName()}`, formattedAttributes);

        const requiredSelectAttributes = Object.entries(formattedAttributes as any).reduce((acc, [ attName, options ]) => {
            acc.push(attName);
            if (isObject(options) && options.identifiers) {
                const identifiers: Array<RelationIdentifier<any>> = Array.isArray(options.identifiers) ? options.identifiers : [ options.identifiers ];
                const topKeys = identifiers.map(identifier => identifier.source?.split?.('.')?.[ 0 ]).filter(key => !!key) as string[];
                acc.push(...topKeys);
            }
            return acc;
        }, [] as string[]);

        const uniqueSelectionAttributes = [ ...new Set(requiredSelectAttributes) ];

        const entity = await getBatchEntity<S>({
            ids: identifiers,
            attributes: uniqueSelectionAttributes,
            entityName: this.getEntityName(),
            entityService: this as any,
            concurrent
        });

        this.logger.debug(`Retrieved batch entities: ${this.getEntityName()}`, JsonSerializer.stringify(entity));

        if (!!formattedAttributes && entity?.data) {
            const relationalAttributes = Object.entries(formattedAttributes)?.map(([ attributeName, options ]) => [ attributeName, options ])
                .filter(([ , options ]) => isObject(options));

            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes as any, entity.data);
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
    public async checkUniquenessAndUpdate(options: {
        payloadToUpdate: any,
        attributeName: string,
        attributeValue: any,
        ignoredEntityIdentifiers?: {
            [ key: string ]: any
        }
        maxAttemptsForCreatingUniqueAttributeValue: number,
    }) {

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
            payloadToUpdate[ attributeName ] = attributeValue;
        }

        return isUnique;
    }

    /**
     * Checks if the given attribute value is unique for the specified attribute name.
     * @param attributeName - The name of the attribute to check uniqueness for.
     * @param attributeValue - The value of the attribute to check uniqueness for.
     * @returns A boolean indicating whether the attribute value is unique or not.
     */
    public async isUniqueAttributeValue(
        attributeName: string,
        attributeValue: any,
        ignoredEntityIdentifiers?: {
            [ key: string ]: any
        }
    ) {

        this.logger.debug(`Called ~ isUniqueAttributeValue ~ entityName: ${this.getEntityName()} ~ attributeName: ${attributeName} ~ attributeValue: ${attributeValue}`);

        // Create filters for the query using the correct structure
        const filters = {
            [ attributeName ]: { eq: attributeValue }
        } as EntityFilterCriteria<S>;

        // Determine which attributes to project - only the attribute being checked and ignored entity identifiers
        const attributesToProject: string[] = [ attributeName ];

        // Add ignored entity identifier fields to the projection
        if (ignoredEntityIdentifiers && !isEmptyObjectDeep(ignoredEntityIdentifiers)) {
            Object.keys(ignoredEntityIdentifiers).forEach(key => {
                if (!attributesToProject.includes(key)) {
                    attributesToProject.push(key);
                }
            });
        }

        // Use the query method to leverage index selection logic with minimal attribute projection
        const result = await this.query({
            filters,
            attributes: attributesToProject as any,
            pagination: { count: 1 } // We only need to know if any records exist
        });

        // If we have ignored entity identifiers, filter the results in memory
        let entities = result.data || [];
        if (ignoredEntityIdentifiers && !isEmptyObjectDeep(ignoredEntityIdentifiers)) {
            entities = entities.filter(entity => {
                return !Object.entries(ignoredEntityIdentifiers).every(([ key, value ]) =>
                    entity[ key ] === value
                );
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
    public generateUniqueValue(originalValue: any, attempt: number | string = Math.random().toString(36).substring(2, 15)): string {
        const uniqueSuffix = `${Date.now()}-${attempt}`;
        return `${originalValue}-${uniqueSuffix}`;
    }

    /**
     * Creates a new entity.
     * 
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    public async create(payload: CreateEntityItemTypeFromSchema<S>, _ctx?: ExecutionContext) {

        const payloadCopy = { ...payload }

        const schema = this.getEntitySchema();
        const entitySlugAttribute = getAttributeNameBy(schema, 'slug') || '';
        const entityNameAttribute = getAttributeNameBy(schema, 'name') || '';

        if (entitySlugAttribute && !(entitySlugAttribute in payloadCopy)) {
            if (entityNameAttribute && (entityNameAttribute in payloadCopy)) {
                payloadCopy[ entitySlugAttribute as keyof typeof payloadCopy ] = toSlug(payloadCopy[ entityNameAttribute ]) as any;
            }
        }

        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;

        if (!skipCheckingAttributesUniqueness && uniqueFields.length) {
            let uniquenessChecks = [];

            for (const { name } of uniqueFields) {
                if (name! in payloadCopy) {
                    let value = payloadCopy[ name! ];
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: payloadCopy,
                        attributeName: name!,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                    }));
                }
            }

            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));

            if (checkResults.includes(false)) {
                const uniqueFieldsPath = uniqueFields.map(field => field.name!) ?? [];

                throw new EntityValidationError([ {
                    message: "Unable to ensure uniqueness for one or more fields.",
                    path: uniqueFieldsPath,
                    expected: [ 'unique', uniqueFields ],
                } ]);
            }
        }

        const entity = await createEntity<S>({
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
    public async upsert(payload: UpsertEntityItemTypeFromSchema<S>) {
        this.logger.debug(`Called ~ upsert ~ entityName: ${this.getEntityName()} ~ payload:`, payload);

        const entity = await upsertEntity<S>({
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
    protected async makeDuplicateEntityData(identifiers: EntityIdentifiersTypeFromSchema<S>) {
        const entity = await this.get({ identifiers }) as EntityRecordTypeFromSchema<S>;

        if (!entity) {
            throw new Error(`No ${this.getEntityName()} record found for identifiers: ${identifiers}`);
        }

        let duplicateEventData: CreateEntityItemTypeFromSchema<S> = {} as any;
        const primaryIdPropName = this.getEntityPrimaryIdPropertyName() as string;

        const schema = this.getEntitySchema();
        const entitySlugAttribute = (getAttributeNameBy(schema, 'slug') || '').toUpperCase();
        const entityNameAttribute = (getAttributeNameBy(schema, 'name') || '').toUpperCase();

        for (let [ key, value ] of Object.entries(entity)) {

            if (key !== primaryIdPropName) {
                // TODO: handle when entity has multiple identifiers

                if (key.toUpperCase() === entityNameAttribute) {
                    value = `${value} - Copy`;
                } else if (key.toUpperCase() === entitySlugAttribute) {
                    value = `${value}-copy`;
                }

                duplicateEventData[ key as keyof typeof duplicateEventData ] = value;
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
    public async duplicate(id: EntityIdentifiersTypeFromSchema<S>, ctx?: ExecutionContext) {
        const duplicateEventData = await this.makeDuplicateEntityData(id);
        return await this.create(duplicateEventData, ctx);
    }

    // TODO: should be part of some config
    protected delimitersRegex = /(?:&| |,|\+)+/;

    /**
     * Retrieves a list of entities based on the provided query.
     * - If no specific attributes are provided in the query, it defaults to a list of attribute names obtained from `getListingAttributeNames()`.
     * - If a search term is provided in the query it will split the search term by `/(?:&| |,|\+)+/` Regex and will filter out empty strings.
     * - If search attributes are not provided in the query, it defaults to a list of searchable attribute names obtained from `getSearchableAttributeNames()`.
     * 
     * @param query - The query object containing filters, search keywords, and attributes.
     * @returns A Promise that resolves to an object containing the list of entities and the original query.
     */
    public async list(query: EntityQuery<S> = {}, _ctx?: ExecutionContext) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);

        if (!query.attributes) {
            query.attributes = this.getListingAttributeNames()
        }

        // for listing API attributes would be an array
        if (Array.isArray(query.attributes)) {
            const parsedOptions = parseEntityAttributePaths(query.attributes as string[]);
            query.attributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }

        if (query.search) {
            if (isString(query.search)) {
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s => !!s);
            }

            if (query.search.length > 0) {

                if (isString(query.searchAttributes)) {
                    query.searchAttributes = query.searchAttributes.split(',').filter(s => !!s);
                }
                if (!query.searchAttributes || isEmpty(query.searchAttributes)) {
                    query.searchAttributes = this.getSearchableAttributeNames();
                }

                const searchFilterGroup = makeFilterGroupForSearchKeywords(query.search, query.searchAttributes);

                query.filters = addFilterGroupToEntityFilterCriteria<S>(searchFilterGroup as any, query.filters);
            }
        }

        const entities = await listEntity<S>({
            query,
            entityName: this.getEntityName(),
            entityService: this,
        });

        entities.data = this.serializeRecords(entities.data, query.attributes);

        if (query.attributes && entities.data) {
            const relationalAttributes = Object.entries(query.attributes)?.map(([ attributeName, options ]) => {
                return [ attributeName, options ];
            })
                // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
                .filter(([ , options ]) => isObject(options));

            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes as any, entities.data);
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
    public async query(query: EntityQuery<S>, _ctx?: ExecutionContext) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);

        const { attributes } = query;

        let selectAttributes: EntitySelections<S> | undefined = attributes || this.getListingAttributeNames();

        if (Array.isArray(selectAttributes)) {
            // parse the list of dot-separated attribute-identifiers paths and ensure all the required metadata is there
            const parsedOptions = parseEntityAttributePaths(selectAttributes as string[]);
            selectAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        } else {
            // ensure all the provided select attributes has required metadata all the way down to the leaf level
            selectAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), selectAttributes);
        }

        if (query.search) {
            if (isString(query.search)) {
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s => !!s);
            }

            if (query.search.length > 0) {

                query.searchAttributes = query.searchAttributes || this.getSearchableAttributeNames();

                const searchFilterGroup = makeFilterGroupForSearchKeywords(query.search, query.searchAttributes);

                query.filters = addFilterGroupToEntityFilterCriteria<S>(searchFilterGroup as any, query.filters);
            }
        }

        const entities = await queryEntity<S>({
            query,
            entityName: this.getEntityName(),
            entityService: this,
        });

        entities.data = this.serializeRecords(entities.data, selectAttributes);

        if (selectAttributes && entities.data) {
            const relationalAttributes = Object.entries(selectAttributes)?.map(([ attributeName, options ]) => {
                return [ attributeName, options ];
            })
                // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
                .filter(([ , options ]) => isObject(options));

            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes as any, entities.data);
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
    public async update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>, operators?: UpdateEntityOperators, _ctx?: ExecutionContext) {

        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;

        if (!skipCheckingAttributesUniqueness && uniqueFields.length) {
            let uniquenessChecks = [];

            for (const { name, readOnly } of uniqueFields) {
                if (readOnly) {
                    delete data[ name as keyof typeof data ];
                    continue;
                }

                if (name! in data) {
                    let value = data[ name as keyof typeof data ];
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: data,
                        attributeName: name!,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                        ignoredEntityIdentifiers: identifiers,
                    }));
                }
            }

            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));

            if (checkResults.includes(false)) {
                const uniqueFieldsPath = uniqueFields.map(field => field.name!) ?? [];

                throw new EntityValidationError([ {
                    message: "Unable to ensure uniqueness for one or more fields.",
                    path: uniqueFieldsPath,
                    expected: [ 'unique', uniqueFields ],
                } ]);
            }
        }

        const updatedEntity = await updateEntity<S>({
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
    public async delete(identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>, _ctx?: ExecutionContext) {
        try {
            this.logger.debug(`Called ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);

            const deletedEntity = await deleteEntity<S>({
                id: identifiers,
                entityName: this.getEntityName(),
                entityService: this,
            });

            return deletedEntity;
        } catch (error: any) {
            throw new DatabaseError(`Failed to delete ${this.getEntityName()}: ${error.message}`);
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
    public async rebuildIndex(options: { batchSize?: number } = {}): Promise<void> {
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
                    } catch (error) {
                        this.logger.error(`Error processing record:`, error);
                    }
                }
            }

            this.logger.info(`Completed index rebuild for entity: ${entityName}`);
        } catch (error) {
            this.logger.error(`Failed to rebuild index for entity: ${this.getEntityName()}`, error);
            throw new DatabaseError(`Failed to rebuild index for ${this.getEntityName()}: ${error instanceof Error ? error.message : String(error)}`);
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
    inferRelationshipsForEntitySelections<E extends EntitySchema<any, any, any>>(
        schema: E,
        paths: ParsedEntityAttributePaths,
        pathKey: string = schema.model.entity,
        visitedPaths: Set<string> = new Set<string>(),
        maxDepth = 5
    ): HydrateOptionsMapForEntity<E> {

        this.logger.debug('inferRelationshipsForEntitySelections', { pathKey, paths });

        // If we exceed max depth, we skip expansions
        if (maxDepth <= 0) {
            this.logger.warn(`Max recursion depth reached at pathKey="${pathKey}"`);
            return {} as HydrateOptionsMapForEntity<E>;
        }

        const inferred: any = {};

        // Loop over each attribute in the entity schema
        Object.entries(schema.attributes).forEach(([ attributeName, attributeMeta ]) => {
            const attVal = paths[ attributeName ];
            if (!attVal) {
                // Not selected in the user's attributes
                return;
            }

            const isRelational = !!attributeMeta.relation;

            // If the attribute is not relational or the value is a boolean, we can infer the attribute
            if (!isRelational || isBoolean(attVal)) {
                inferred[ attributeName ] = attVal;
                return;
            }

            // It's a relational attribute; prepare to recurse
            const relationMeta = attributeMeta.relation!;
            const nextEntityName = relationMeta.entityName;

            // Build a new "path" string to detect cycles (e.g. "User.groups.Group.members.User")
            const newPath = `${pathKey}.${attributeName}.${nextEntityName}`;

            // Check if we've already visited this path, if so => skip expansions for this attribute only
            if (visitedPaths.has(newPath)) {
                this.logger.warn(`Skipping cyc relation expansions for: ${newPath}`);
                inferred[ attributeName ] = {
                    entityName: nextEntityName,
                    skippedDueToCycle: true,
                };
                return;
            }

            // Mark this path as visited
            visitedPaths.add(newPath);

            // Recurse to the related entity's schema
            const relatedEntitySchema = this.getEntitySchemaByEntityName<EntitySchema<any, any, any>>(nextEntityName);
            const relatedEntityService = this.getEntityServiceByEntityName<EntitySchema<any, any, any>>(nextEntityName);

            // Build the "meta" object that we store
            const meta: HydrateOptionForRelation = {
                entityName: nextEntityName,
                relationType: relationMeta.type,
                identifiers: isFunction(relationMeta.identifiers)
                    ? relationMeta.identifiers()
                    : relationMeta.identifiers,
                attributes: {},
            };
            const pathSelectionAttributes = isObject(attVal) ? attVal.attributes : undefined; // provided by the user 
            const relationSelectionAttributes = relationMeta.attributes; // defined in the relation definition
            const relatedEntityDefaultSelectionAttributes = relatedEntityService.getDefaultSerializationAttributeNames(); // auto gen by framework

            // Recurse to expand child's relationships
            meta.attributes = this.inferRelationshipsForEntitySelections(
                relatedEntitySchema,
                (pathSelectionAttributes || relationSelectionAttributes || relatedEntityDefaultSelectionAttributes) as any,
                nextEntityName,
                visitedPaths,
                maxDepth - 1
            );

            inferred[ attributeName ] = meta;

            // Remove this path so siblings can also expand it if needed
            visitedPaths.delete(newPath);
        });

        return inferred;
    }

    public async search(query: EntitySearchQuery<S>, ctx?: ExecutionContext) {

        const searchService = this.getSearchService();
        const results = await searchService.search(query, undefined, ctx);
        return results;
    }
}

export function entityAttributeToIOSchemaAttribute(attId: string, att: EntityAttribute): Partial<EntityAttribute> & {
    id: string,
    name: string,
    properties?: TIOSchemaAttribute[]
} {

    const { name, validations, required, relation, default: defaultValue, get: _getter, set: _setter, watch, ...restMeta } = att;

    const { entityName: relatedEntityName, ...restRelation } = relation || {};

    const relationMeta = relatedEntityName ? { ...restRelation, entityName: relatedEntityName } : undefined;

    const { items, type, properties, addNewOption, ...restRestMeta } = restMeta as any;

    const formatted: any = {
        ...restRestMeta,
        type,
        id: attId,
        name: name || toHumanReadableName(attId),
        relation: relationMeta as any,
        defaultValue,
        validations: validations || required ? [ 'required' ] : [],
        isVisible: !('isVisible' in att) ? true : att.isVisible,
        isEditable: !('isEditable' in att) ? true : att.isEditable,
        isListable: !('isListable' in att) ? true : att.isListable,
        isCreatable: !('isCreatable' in att) ? true : att.isCreatable,
        isFilterable: !('isFilterable' in att) ? true : att.isFilterable,
        isSearchable: !('isSearchable' in att) ? true : att.isSearchable,
    }

    if (addNewOption) {
        formatted[ 'addNewOption' ] = addNewOption;
    }

    //
    // ** make sure to not override the inner fields of attributes like `list-[items]-[map]-properties` **
    //
    if (type === 'map') {
        formatted[ 'properties' ] = Object.entries<any>(properties).map(([ k, v ]) => entityAttributeToIOSchemaAttribute(k, v));
    } else if (type === 'list' && items.type === 'map') {
        formatted[ 'items' ] = {
            ...items,
            properties: Object.entries<any>(items.properties).map(([ k, v ]) => entityAttributeToIOSchemaAttribute(k, v))
        };
    }

    // TODO: add support for set, enum, and custom-types

    return formatted
}

export type TIOSchemaAttribute = ReturnType<typeof entityAttributeToIOSchemaAttribute>;
export type TIOSchemaAttributesMap<S extends EntitySchema<any, any, any>> = Map<keyof S[ 'attributes' ], TIOSchemaAttribute>;

/**
 * Creates an access patterns schema based on the provided entity schema.
 * @param schema The entity schema.
 * @returns A map of access patterns, where the keys are the index names and the values are maps of attribute names and their corresponding schema attributes.
 */
export function makeEntityAccessPatternsSchema<S extends EntitySchema<any, any, any>>(schema: S) {
    const accessPatterns = new Map<keyof S[ 'indexes' ], TIOSchemaAttributesMap<S>>();

    for (const indexName in schema.indexes) {
        const indexAttributes: TIOSchemaAttributesMap<S> = new Map();

        for (const idxPkAtt of schema.indexes[ indexName ].pk.composite) {
            const att = schema.attributes[ idxPkAtt ];
            indexAttributes.set(idxPkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxPkAtt, { ...att, required: true })
            });
        }

        for (const idxSkAtt of schema.indexes[ indexName ].sk?.composite ?? []) {
            const att = schema.attributes[ idxSkAtt ];
            indexAttributes.set(idxSkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxSkAtt, { ...att, required: true })
            });
        }

        accessPatterns.set(indexName, indexAttributes);
    }

    // make sure there's a primary access pattern;
    if (!accessPatterns.has('primary')) {
        accessPatterns.set('primary', accessPatterns.values().next().value!);
    }

    return accessPatterns;
}
