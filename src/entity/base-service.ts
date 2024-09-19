import type { EntityConfiguration } from "electrodb";
import { DIContainer } from "../di";
import type { EntityInputValidations, EntityValidations } from "../validation";
import type { CreateEntityItemTypeFromSchema, EntityAttribute, EntityIdentifiersTypeFromSchema, EntityRecordTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, EntitySchema, HydrateOptionForRelation, RelationIdentifier, SpecialAttributeType, TDefaultEntityOperations, UpdateEntityItemTypeFromSchema } from "./base-entity";
import type { EntityQuery, EntitySelections } from "./query-types";

import { createLogger } from "../logging";
import { JsonSerializer, camelCase, getValueByPath, isArray, isEmpty, isEmptyObjectDeep, isObject, isString, pascalCase, pickKeys, toHumanReadableName, toSlug } from "../utils";
import { createElectroDBEntity } from "./base-entity";
import { createEntity, deleteEntity, getEntity, listEntity, queryEntity, updateEntity } from "./crud-service";
import { addFilterGroupToEntityFilterCriteria, inferRelationshipsForEntitySelections, makeFilterGroupForSearchKeywords, parseEntityAttributePaths } from "./query";
import { IDIContainer } from "../interfaces";

export type ExtractEntityIdentifiersContext = {
    // tenantId: string, 
    forAccessPattern ?: string
}

type GetOptions<S extends EntitySchema<any, any, any>> = {
    identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>,
    selections?: EntitySelections<S>  
}

export function hasAttribute(schema: EntitySchema<any, any, any>, attributeName: string){
    return ( attributeName in schema.attributes );
}

export function hasAttributeBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType ){
    return getAttributeNameBy(schema, spec) !== undefined;
}

export function getAttributeNameBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType ){
    
    let specAttMetaKey = `entity${pascalCase(spec)}Attribute`;
    if( specAttMetaKey in schema.model ){
        return schema.model[specAttMetaKey as keyof typeof schema.model] as string;
    }
    
    if( hasAttribute(schema, `${schema.model.entity}${pascalCase(spec)}`) ){
        return `${schema.model.entity}${pascalCase(spec)}`;
    }

    if( hasAttribute(schema, spec) ){
        return spec;
    }

    return undefined;
}

export abstract class BaseEntityService<S extends EntitySchema<any, any, any>>{

    readonly logger = createLogger(BaseEntityService);

    protected entityRepository ?: EntityRepositoryTypeFromSchema<S>;
    protected entityOpsDefaultIoSchema ?: ReturnType<typeof this.makeOpsDefaultIOSchema<S>>;

    constructor(
        protected readonly schema: S,
        protected readonly entityConfigurations: EntityConfiguration,
        protected readonly diContainer: IDIContainer = DIContainer.ROOT,
    ){
        return this;
    }

    getRelatedEntityServiceDIToken(relatedEntityName: string){
        return `${pascalCase(camelCase(relatedEntityName))}Service`;
    }

    getEntityServiceByEntityName<T extends EntitySchema<any, any, any>>(relatedEntityName: string){
        return this.diContainer.resolve<BaseEntityService<T>>(
            this.getRelatedEntityServiceDIToken(relatedEntityName)
        );
    }

    hasEntityServiceByEntityName(relatedEntityName: string){
        return this.diContainer.has(
            this.getRelatedEntityServiceDIToken(relatedEntityName)
        );
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

        if(!input || typeof input !== 'object') {
            throw new Error('Input is required and must be an object containing entity-identifiers or an array of objects containing entity-identifiers');
        }

        const isBatchInput = isArray(input);

        const inputs = isBatchInput ? input : [input];

        // TODO: tenant logic
        // identifiers['tenantId'] = input.tenantId || context.tenantId;

        const accessPatterns = makeEntityAccessPatternsSchema(this.getEntitySchema());

        const identifierAttributes = new Set<{name: string, required: boolean}>();
        for(const [accessPatternName, accessPatternAttributes] of accessPatterns){
            if(!context.forAccessPattern || accessPatternName == context.forAccessPattern){
                for( const [, att] of accessPatternAttributes){
                    identifierAttributes.add({
                        name: att.id,
                        required: att.required == true
                    });
                }
            }
        }

        const primaryAttName = this.getEntityPrimaryIdPropertyName();  

        const identifiersBatch = inputs.map( input => {
                const identifiers: any = {};
                for(const {name: attName, required} of identifierAttributes){
                    if( (attName in input ) ){
                        identifiers[attName] = input[attName];
                    } else if( attName == primaryAttName && ('id' in input ) ){
                        identifiers[attName] = input.id;
                    } else if(required) {
                        this.logger.warn(`required attribute: ${attName} for access-pattern: ${context.forAccessPattern ?? '--primary--'} is not found in input:`, input);
                    }
                }
                return identifiers as EntityIdentifiersTypeFromSchema<S>;
            }
        );

        this.logger.debug('Extracting identifiers from identifiers:', identifiersBatch);

        return isBatchInput ? identifiersBatch : identifiersBatch[0];
    };

    public getEntityName(): S['model']['entity'] { return this.schema.model.entity; }
    
    public getEntitySchema(): S { return this.schema;}
    
    public getRepository(){
        if(!this.entityRepository){
            const {entity} = createElectroDBEntity({ 
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
    public getEntityValidations(): EntityValidations<S> | EntityInputValidations<S>{
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
        return Promise.resolve( new Map<string, string>() );
    }

    public getEntityPrimaryIdPropertyName() {
        const schema = this.getEntitySchema();

        for(const attName in schema.attributes) {
            const att = schema.attributes[attName];
            if(att.isIdentifier) {
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
>( schema: S) {
	
	const inputSchemaAttributes = {
		create: new Map() as TIOSchemaAttributesMap<S> ,
		update: new Map() as TIOSchemaAttributesMap<S> ,
	};

	const outputSchemaAttributes = {
        detail: new Map() as TIOSchemaAttributesMap<S>,
        list: new Map() as TIOSchemaAttributesMap<S>,
    };

	// create and update
	for(const attName in schema.attributes){

		const att = schema.attributes[attName];
        const formattedAtt = entityAttributeToIOSchemaAttribute(attName, att);
        
        if(formattedAtt.hidden){
            // if it's marked as hidden it's not visible to any op
            continue;
        }

		if(formattedAtt.isVisible){
			outputSchemaAttributes.detail.set(attName, {...formattedAtt});
		}

        if(formattedAtt.isListable){
			outputSchemaAttributes.list.set(attName, {...formattedAtt});
        }
		
		if(formattedAtt.isCreatable){
			inputSchemaAttributes.create.set(attName, {...formattedAtt});
        }

		if( formattedAtt.isEditable){
            inputSchemaAttributes.update.set(attName, {...formattedAtt});
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
        if(!this.entityOpsDefaultIoSchema){
            this.entityOpsDefaultIoSchema  = this.makeOpsDefaultIOSchema<S>(this.getEntitySchema());
        }
        return this.entityOpsDefaultIoSchema;
    }

    /**
     * Returns an array of default serialization attribute names. Used by the `detail` API to serialize the entity.
     * 
     * @returns {Array<string>} An array of default serialization attribute names.
     */
    public getDefaultSerializationAttributeNames(): EntitySelections<S>{
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().get.output;
        return Array.from( defaultOutputSchemaAttributesMap.keys() ) as EntitySelections<S>;
    }

    /**
     * Returns attribute names for listing and search API. Defaults to the default serialization attribute names.
     * @returns {Array<string>} An array of attribute names.
     */
    public getListingAttributeNames(): EntitySelections<S>{
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().list.output;
        return Array.from( defaultOutputSchemaAttributesMap.keys() ) as EntitySelections<S>;
    }

    /**
     * Returns the default attribute names to be used for keyword search. Defaults to all string attributes which are not hidden and are not identifiers.
     * @returns {Array<string>} attribute names to be used for keyword search
    */
    public getSearchableAttributeNames(): Array<string>{
        const attributeNames = [];
        const schema = this.getEntitySchema();
        
        for(const attName in schema.attributes){
            const att = schema.attributes[attName];
            if( !att.hidden && !att.isIdentifier && att.type === 'string'
                && 
                (!('isSearchable' in att ) || att.isSearchable ) 
             ){ 
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
    public getUniqueAttributes(): Array<EntityAttribute>{
        const attributes = [];
        const schema = this.getEntitySchema();
        
        for(const attName in schema.attributes){
            const att = schema.attributes[attName];

            let isUnique = ( 'isUnique' in att ) ? att.isUnique : att.isIdentifier;

            if( isUnique ){ 
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
    public getFilterableAttributeNames(): Array<string>{
        const attributeNames = [];
        const schema = this.getEntitySchema();
        
        for(const attName in schema.attributes){
            const att = schema.attributes[attName];
            if( 
                !att.hidden && ['string', 'number'].includes(att.type as string) 
                && 
                (!('isFilterable' in att ) || att.isFilterable ) 
            ){ 
                attributeNames.push(attName); 
            }
        }

        return attributeNames;
    }

    public serializeRecord<T extends Record<string, any> >(record: T, attributes = this.getDefaultSerializationAttributeNames() ): Partial<T> {
        
        let keys: Array<string>;

        if(Array.isArray(attributes)){
            const parsed = parseEntityAttributePaths(attributes as string[] );
            keys = Object.keys(parsed);
        } else {
            keys = Object.keys(attributes);
        }

        return pickKeys<T>(record, ...keys);
    }

    public serializeRecords<T extends Record<string, any>>(record: Array<T>, attributes = this.getDefaultSerializationAttributeNames() ): Array<Partial<T>> {
        return record.map(record => this.serializeRecord<T>(record, attributes));
    }

    private async hydrateRecords(
        relations: Array<[relatedAttributeName: string, options: HydrateOptionForRelation<any>]>, 
        rootEntityRecords: Array<{ [x: string]: any; }>
    ) {
        this.logger.info(`called 'hydrateRecords' for entity: ${this.getEntityName()}`);
        await Promise.all( relations?.map( async ([relatedAttributeName, options]) => {
            await this.hydrateSingleRelation(rootEntityRecords, relatedAttributeName, options);
        }));
	}

    private async hydrateSingleRelation(rootEntityRecords: any[], relatedAttributeName: string, options: HydrateOptionForRelation<any>){
        this.logger.info(`called 'hydrateSingleRelation' relation: ${relatedAttributeName} for entity: ${this.getEntityName()}`, {
            options
        });

        const relatedEntityName = options.entityName;

        // Get related entity service
        const relatedEntityService = this.getEntityServiceByEntityName(relatedEntityName);
        if(!relatedEntityService){
            throw new Error(`No service found for relationship: ${relatedAttributeName}(${relatedEntityName}); please make sure service has been registered in the required 'di-container'`);
        }

        // Get relation metadata
        const relationAttributeMetadata = this.schema?.attributes && this.schema.attributes[relatedAttributeName as keyof typeof this.schema.attributes] as EntityAttribute;
        if(!relationAttributeMetadata || !relationAttributeMetadata?.relation){
            this.logger.warn(`No metadata found for relationship: ${relatedAttributeName}`, relationAttributeMetadata);
            return;
        }
        // make a copy to make sure not to override anything
        const relationMetadata = {...relationAttributeMetadata.relation};

        // Get relation identifiers batch
        const relationPrimaryIdentifierName = relatedEntityService.getEntityPrimaryIdPropertyName() as string;
        relationMetadata.identifiers = relationMetadata.identifiers || { 
            source: relationPrimaryIdentifierName,
            target: relationPrimaryIdentifierName
        }

        const identifierMappings = Array.isArray(relationMetadata.identifiers) ? relationMetadata.identifiers : [ relationMetadata.identifiers ]

        // Create a dictionary to map related-entity-identifiers to the 
        // map of [sourceEntityData, identifiers]
        const identifiersToSourceEntityDictionary = new Map<any, any>();

        // Create relationIdentifiersBatch to fetch all related entities in one single query
        const relationIdentifiersBatch = rootEntityRecords.flatMap( entityData => {
            
            const isToManyRelation = Array.isArray(entityData[relatedAttributeName]);

            const identifiersDataBatch = isToManyRelation ? entityData[relatedAttributeName] : [ entityData[relatedAttributeName] ];

            const identifiersBatch = identifiersDataBatch.map( (identifiersData: any) => {
                if(!identifiersData){
                    return;
                }

                const identifiers = identifierMappings.reduce((acc: any, identifierMapping) => {
                    const { source, target } = identifierMapping;

                    const identifierVal = isObject(identifiersData) && identifiersData ? getValueByPath(identifiersData, source!) : identifiersData;
                    
                    if(identifierVal) { 
                        acc[target] = identifierVal;
                    }
                    
                    return acc;

                }, {} as { [key: string]: any });

                return identifiers;

            })
            .filter( (identifiers: any) => !!identifiers);

            identifiersToSourceEntityDictionary.set(entityData, identifiersBatch);

            return identifiersBatch;
        });

        // remove duplicates from relationIdentifiersBatch array
        const uniqueRelationIdentifiersBatch = Array.from(
            // create a set of stringified identifiers to remove duplicates
            new Set( 
                relationIdentifiersBatch.map(i => JSON.stringify(i)) 
            )
        )
        // convert back to array of identifiers
        .map(i => JSON.parse(i));

        // ensure all the identifier attributes are part of the selections
        Object.keys(uniqueRelationIdentifiersBatch[0]).forEach( (key: string) => {
            if(Array.isArray(options.attributes) && !options.attributes.includes(key)){
                options.attributes.push(key);
            } else if(isObject(options.attributes) && !( key in options.attributes) ){
                options.attributes = {
                    ...options.attributes,
                    [key]: true
                }
            }
        });

        // Fetch related entities
        const relatedEntities = await relatedEntityService.get({
            identifiers: uniqueRelationIdentifiersBatch,
            selections: options.attributes,
        });

        // Merge related entities
        identifiersToSourceEntityDictionary.forEach( (identifiersBatch, sourceEntityData ) => {
            const relatedRecords = identifiersBatch.map( (identifiers: any) => {
                return relatedEntities?.find( (relatedEntityData: any) => {
                    return Object.entries(identifiers).every( ([target, value]) =>
                        ( target in relatedEntityData ) && relatedEntityData[target] === value
                    )
                })
            });

            const isToManyRelation = Array.isArray(sourceEntityData[relatedAttributeName]);
            
            if(!isToManyRelation && relatedRecords.length > 0){
                sourceEntityData[relatedAttributeName] = relatedRecords[0];
            } else {
                sourceEntityData[relatedAttributeName] = relatedRecords;
            }
        });
    }

    /**
     * Retrieves an entity by its identifiers.
     * 
     * @param identifiers - The identifiers of the entity.
     * @param selections - Optional array of attribute names to include in the response.
     * @returns A promise that resolves to the retrieved entity data.
     */
    
    public async get( options: GetOptions<S> ) {
        
        const {identifiers, selections} = options;

        this.logger.info(`Called ~ get ~ entityName: ${this.getEntityName()}: `, {identifiers, attributes: selections});
        
        let formattedSelections = selections;
        if(!selections){
            formattedSelections = this.getDefaultSerializationAttributeNames()
        }

        if(Array.isArray(formattedSelections)){
            const parsedOptions = parseEntityAttributePaths(formattedSelections as string[] );

            formattedSelections = inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }

        this.logger.info(`Formatted selections for entity: ${this.getEntityName()}`, formattedSelections);

        const requiredSelectAttributes = Object.entries(formattedSelections as any).reduce((acc, [attName, options]) => {
            acc.push(attName);
            if(isObject(options) && options.identifiers){
                const identifiers: Array<RelationIdentifier<any>> = Array.isArray(options.identifiers) ? options.identifiers : [options.identifiers];                
                // extract top level identifiers from option.identifiers which is of type RelationIdentifiers
                const topKeys = identifiers.map( identifier => identifier.source?.split?.('.')?.[0] ).filter( key => !!key) as string[] ;
                acc.push(...topKeys);
            }
            return acc;
        }, [] as string[]);

        const uniqueSelectionAttributes = [...new Set(requiredSelectAttributes)]

        const entity =  await getEntity<S>({
            id: identifiers, 
            attributes: uniqueSelectionAttributes, // only fetching top level keys from the DB
            entityName: this.getEntityName(),
            entityService: this,
        });

        this.logger.info(`Retrieved entity: ${this.getEntityName()}`, JsonSerializer.stringify(entity));

		if(!!formattedSelections && entity?.data){

            const relationalAttributes = Object.entries(formattedSelections)?.map( ([attributeName, options]) => [attributeName, options] )
            // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
            .filter( ([, options]) => isObject(options) );

            if(relationalAttributes.length){
                await this.hydrateRecords(relationalAttributes as any, [entity.data]);
            }
		}

        return entity?.data;
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
            [key: string]: any
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

        if(isUnique){
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
    public async isUniqueAttributeValue(
        attributeName: string, 
        attributeValue: any,
        ignoredEntityIdentifiers?: {
            [key: string]: any
        }
    ) {

        this.logger.info(`Called ~ isUniqueAttributeValue ~ entityName: ${this.getEntityName()} ~ attributeName: ${attributeName} ~ attributeValue: ${attributeValue}`);
        
        const query = this.getRepository().match({
            [attributeName]: attributeValue
        });

        // ignore the current entity being updated for uniqueness check of the attribute-value
        if(ignoredEntityIdentifiers && !isEmptyObjectDeep(ignoredEntityIdentifiers) ){
            Object.entries(ignoredEntityIdentifiers).forEach(([key, value]) => {
                query.where((attributes, { ne }) => ne(attributes[key], value) );
            });
        }

        const entity = await  query.go();

        this.logger.info(`isUniqueAttributeValue ~ entityName: ${this.getEntityName()} ~ attributeName: ${attributeName} ~ attributeValue: ${attributeValue} ~ entity:`, entity);

        return entity.data?.length === 0;
    }

    /**
     * Generates a unique value by appending a unique suffix to the original value.
     * @param originalValue - The original value to generate a unique value from.
     * @param attempt - The attempt number or string to be used as a suffix (default: random string).
     * @returns The generated unique value.
     */
    public generateUniqueValue(originalValue: any, attempt: number | string = Math.random().toString(36).substring(2, 15) ): string {
        const uniqueSuffix = `${Date.now()}-${attempt}`;
        return `${originalValue}-${uniqueSuffix}`;
    }
    
    /**
     * Creates a new entity.
     * 
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    public async create(payload: CreateEntityItemTypeFromSchema<S>) {
        this.logger.debug(`Called ~ create ~ entityName: ${this.getEntityName()} ~ payload:`, payload);

        const schema = this.getEntitySchema();
        const entitySlugAttribute = getAttributeNameBy(schema, 'slug') || '';
        const entityNameAttribute = getAttributeNameBy(schema, 'name') || '';

        // auto generate slug if it's not provided and entity has a name
        if(entitySlugAttribute && !(entitySlugAttribute in payload)){
            if(entityNameAttribute && (entityNameAttribute in payload)){
                payload[entitySlugAttribute as keyof typeof payload] = toSlug(payload[entityNameAttribute]) as any;
            }
        }

        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;

        if(!skipCheckingAttributesUniqueness && uniqueFields.length){
            let uniquenessChecks = [];

            // Prepare uniqueness checks for all unique fields
            for (const { name } of uniqueFields) {
                if ( name! in payload ) {
                    let value = payload[name!];
                    // Push a function that performs the uniqueness check into the array
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: payload,
                        attributeName: name!,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                    }));
                }
            }

            // Execute all uniqueness checks in parallel
            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));

            // If any check failed (returned false), throw an error
            if (checkResults.includes(false)) {
                throw new Error("Unable to ensure uniqueness for one or more fields.");
            }

        }

        const entity =  await createEntity<S>({
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
    protected async makeDuplicateEntityData(identifiers: EntityIdentifiersTypeFromSchema<S>){
        const entity = await this.get({identifiers}) as EntityRecordTypeFromSchema<S>;

		if(!entity){
			throw new Error(`No ${this.getEntityName()} record found for identifiers: ${identifiers}`);
		}

		let duplicateEventData: CreateEntityItemTypeFromSchema<S> = {} as any;
        const primaryIdPropName = this.getEntityPrimaryIdPropertyName() as string;

        const schema = this.getEntitySchema();
        const entitySlugAttribute = (getAttributeNameBy(schema, 'slug') || '').toUpperCase();
        const entityNameAttribute = (getAttributeNameBy(schema, 'name') || '').toUpperCase();

        for (let [key, value] of Object.entries(entity)) {

            if (key !== primaryIdPropName) { 
                // TODO: handle when entity has multiple identifiers

                if( key.toUpperCase() === entityNameAttribute){
                    value = `${value} - Copy`;
                } else if( key.toUpperCase() === entitySlugAttribute ){
                    value = `${value}-copy`;
                }

                duplicateEventData[key as keyof typeof duplicateEventData] = value;
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
    public async duplicate(id: EntityIdentifiersTypeFromSchema<S>){
        const duplicateEventData = await this.makeDuplicateEntityData(id);
		return await this.create(duplicateEventData);
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
    public async list(query: EntityQuery<S> = {}) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);

        if(!query.attributes){
            query.attributes = this.getListingAttributeNames()
        }
        
        // for listing API attributes would be an array
        if(Array.isArray(query.attributes)){
            const parsedOptions = parseEntityAttributePaths(query.attributes as string[] );
            query.attributes = inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }
        
        if(query.search){
            if(isString(query.search)){
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s => !!s);
            }

            if(query.search.length > 0){

                if(isString(query.searchAttributes)){
                    query.searchAttributes = query.searchAttributes.split(',').filter(s => !!s);
                }
                if(!query.searchAttributes || isEmpty(query.searchAttributes)){
                    query.searchAttributes = this.getSearchableAttributeNames();
                }
                
                const searchFilterGroup = makeFilterGroupForSearchKeywords(query.search, query.searchAttributes);
                
                query.filters = addFilterGroupToEntityFilterCriteria<S>(searchFilterGroup as any, query.filters);
            }
        }
        
        const entities =  await listEntity<S>({
            query,
            entityName: this.getEntityName(), 
            entityService: this, 
        });

        entities.data = this.serializeRecords(entities.data, query.attributes);

        if(query.attributes && entities.data){
            const relationalAttributes = Object.entries(query.attributes)?.map( ([attributeName, options]) => {
                return [attributeName, options];
            })
            // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
            .filter( ([, options]) => isObject(options) );

            if(relationalAttributes.length){
    			await this.hydrateRecords(relationalAttributes as any, entities.data);
            }
		}

        return {...entities, query};
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
    public async query(query: EntityQuery<S> ) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);

        const {attributes} = query;

        let selectAttributes: EntitySelections<S> | undefined = attributes || this.getListingAttributeNames();
        
        if(Array.isArray(selectAttributes)){
            // parse the list of dot-separated attribute-identifiers paths and ensure all the required metadata is there
            const parsedOptions = parseEntityAttributePaths(selectAttributes as string[] );
            selectAttributes = inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        } else {
            // ensure all the provided select attributes has required metadata all the way down to the leaf level
            selectAttributes = inferRelationshipsForEntitySelections(this.getEntitySchema(), selectAttributes);
        }

        if(query.search){
            if(isString(query.search)){
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s =>!!s);
            }

            if(query.search.length > 0){
                
                query.searchAttributes = query.searchAttributes || this.getSearchableAttributeNames();
                
                const searchFilterGroup = makeFilterGroupForSearchKeywords(query.search, query.searchAttributes);
                
                query.filters = addFilterGroupToEntityFilterCriteria<S>(searchFilterGroup as any, query.filters);
            }
        }

        const entities =  await queryEntity<S>({
            query,
            entityName: this.getEntityName(),
            entityService: this,
        });

        entities.data = this.serializeRecords(entities.data, selectAttributes);

        if(selectAttributes && entities.data){
            const relationalAttributes = Object.entries(selectAttributes)?.map( ([attributeName, options]) => {
                return [attributeName, options];
            })
            // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
            .filter( ([, options]) => isObject(options) );

            if(relationalAttributes.length){
			    await this.hydrateRecords(relationalAttributes as any, entities.data);
            }
		}

        return {...entities, query};
    }

    /**
     * Updates an entity in the database.
     *
     * @param identifiers - The identifiers of the entity to update.
     * @param data - The updated data for the entity.
     * @returns The updated entity.
     */
    public async update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>) {
        this.logger.debug(`Called ~ update ~ entityName: ${this.getEntityName()} ~ identifiers:, data:`, identifiers, data);

        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;

        if(!skipCheckingAttributesUniqueness && uniqueFields.length){
            let uniquenessChecks = [];

            // Prepare uniqueness checks for all unique fields
            for (const { name, readOnly } of uniqueFields) {

                // ensure readonly attributes are not updated
                if(readOnly){
                    delete data[name as keyof typeof data];
                    continue;
                }
                
                if (name! in data) {
                    let value = data[name as keyof typeof data];

                    // Push a function that performs the uniqueness check into the array
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: data,
                        attributeName: name!,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                        ignoredEntityIdentifiers: identifiers, // skip the current entity being updated for uniqueness check
                    }));
                }
            }

            // Execute all uniqueness checks in parallel
            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));

            // If any check failed (returned false), throw an error
            if (checkResults.includes(false)) {
                throw new Error("Unable to ensure uniqueness for one or more fields.");
            }

        }

        const updatedEntity =  await updateEntity<S>({
            id: identifiers,
            data: data, 
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
    public async delete(identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>) {
        this.logger.debug(`Called ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);
        
        const deletedEntity =  await deleteEntity<S>({
            id: identifiers,
            entityName: this.getEntityName(),  
            entityService: this,
        });

        return deletedEntity;
    }

}

export function entityAttributeToIOSchemaAttribute(attId: string, att: EntityAttribute): Partial<EntityAttribute> & { 
    id: string,
    name: string,
    properties?: TIOSchemaAttribute[]
} {

    const {  name, validations, required, relation, default: defaultValue, get: getter, set: setter, watch, ...restMeta  } = att;

    const { entity: relatedEntity, ...restRelation } = relation || {};
    const relationMeta = relatedEntity ? {...restRelation, entity: relatedEntity?.model?.entity} : undefined;

    const {items, type, properties, addNewOption, ...restRestMeta} = restMeta as any;

    const formatted: any = {
        ...restRestMeta,
        type,
        id: attId,
        name: name || toHumanReadableName( attId ),
        relation: relationMeta as any,
        defaultValue,
        validations: validations || required ? ['required'] : [],
        isVisible: !('isVisible' in att) || att.isVisible,
        isEditable: !('isEditable' in att) || att.isEditable,
        isListable: !('isListable' in att) || att.isListable,
        isCreatable: !('isCreatable' in att) || att.isCreatable,
        isFilterable: !('isFilterable' in att) || att.isFilterable,
        isSearchable: !('isSearchable' in att) || att.isSearchable,
    }

    if(addNewOption){
        formatted['addNewOption'] = addNewOption;
    }

    //
    // ** make sure to not override the inner fields of attributes like `list-[items]-[map]-properties` **
    //
    if(type === 'map'){
        formatted['properties'] = Object.entries<any>(properties).map( ([k, v]) => entityAttributeToIOSchemaAttribute(k, v) );
    } else if(type === 'list' && items.type === 'map'){
        formatted['items'] = { 
            ...items,
            properties: Object.entries<any>(items.properties).map( ([k, v]) => entityAttributeToIOSchemaAttribute(k, v) )
        };
    }

    // TODO: add support for set, enum, and custom-types

    return formatted
}

export type TIOSchemaAttribute = ReturnType<typeof entityAttributeToIOSchemaAttribute>;
export type TIOSchemaAttributesMap<S extends EntitySchema<any, any, any>> = Map<keyof S['attributes'], TIOSchemaAttribute>;

/**
 * Creates an access patterns schema based on the provided entity schema.
 * @param schema The entity schema.
 * @returns A map of access patterns, where the keys are the index names and the values are maps of attribute names and their corresponding schema attributes.
 */
export function makeEntityAccessPatternsSchema<S extends EntitySchema<any, any, any>>(schema: S) {
    const accessPatterns = new Map< keyof S['indexes'], TIOSchemaAttributesMap<S> >();

    for(const indexName in schema.indexes){
		const indexAttributes: TIOSchemaAttributesMap<S> = new Map();

		for(const idxPkAtt of schema.indexes[indexName].pk.composite){
			const att = schema.attributes[idxPkAtt];
			indexAttributes.set(idxPkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxPkAtt, {...att, required: true })
			});
        }

		for(const idxSkAtt of schema.indexes[indexName].sk?.composite ?? []){
			const att = schema.attributes[idxSkAtt];
            indexAttributes.set(idxSkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxSkAtt, {...att, required: true })
			});
		}

		accessPatterns.set(indexName, indexAttributes);
	}

    // make sure there's a primary access pattern;
    if(!accessPatterns.has('primary')){
        accessPatterns.set('primary', accessPatterns.values().next().value);
    }

    return accessPatterns;
}
