import { EntityConfiguration } from "electrodb";
import { createLogger } from "../logging";
import { isArray, isArrayOfStrings, isEmpty, isEmptyArray, isSimpleValue, isString, pickKeys, toHumanReadableName } from "../utils";
import { EntityInputValidations, EntityValidations } from "../validation";
import { CreateEntityItemTypeFromSchema, EntityAttribute, EntityIdentifiersTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, EntitySchema, TDefaultEntityOperations, UpdateEntityItemTypeFromSchema, createElectroDBEntity } from "./base-entity";
import { createEntity, deleteEntity, getEntity, listEntity, queryEntity, updateEntity } from "./crud-service";
import { EntityQuery, Pagination, isArrayOfObjectOfStringKeysAndBooleanValues } from "./query-types";
import { addFilterGroupToEntityFilterCriteria, makeFilterGroupForSearchKeywords } from "./query";

export abstract class BaseEntityService<S extends EntitySchema<any, any, any>>{

    readonly logger = createLogger(BaseEntityService.name);

    protected entityRepository ?: EntityRepositoryTypeFromSchema<S>;
    protected entityOpsDefaultIoSchema ?: ReturnType<typeof makeOpsDefaultIOSchema<S>>;

    constructor(
        protected readonly schema: S,
        protected readonly entityConfigurations: EntityConfiguration,
    ){
        return this;
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
        input: any, 
        context: { 
            // tenantId: string, 
            forAccessPattern ?: string } = {
            // tenantId: 'xxx-yyy-zzz'
        } 
    ): EntityIdentifiersTypeFromSchema<S>{
        const identifiers: any = {};

        if(!input || typeof input !== 'object') {
            throw new Error('Input is required and must be an object');
        }

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
        for(const {name: attName, required} of identifierAttributes){
            if( input.hasOwnProperty(attName) ){
                identifiers[attName] = input[attName];
            } else if( attName == primaryAttName && input.hasOwnProperty('id') ){
                identifiers[attName] = input.id;
            } else if(required) {
                this.logger.warn(`required attribute: ${attName} for access-pattern: ${context.forAccessPattern ?? '--primary--'} is not found in input:`, input);
            }
        }

        this.logger.debug('Extracting identifiers from identifiers:', identifiers);

        return identifiers as EntityIdentifiersTypeFromSchema<S>;
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
     * ```typescript
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
     * Returns the default input/output schema for entity operations.
     * 
    */
    public getOpsDefaultIOSchema() {
        if(!this.entityOpsDefaultIoSchema){
            this.entityOpsDefaultIoSchema  = makeOpsDefaultIOSchema<S>(this.getEntitySchema());
        }
        return this.entityOpsDefaultIoSchema;
    }

    /**
     * Returns an array of default serialization attribute names. Used by the `detail` API to serialize the entity.
     * 
     * @returns {Array<string>} An array of default serialization attribute names.
     */
    public getDefaultSerializationAttributeNames(): Array<string>{
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().get.output;
        return Array.from( defaultOutputSchemaAttributesMap.keys() ) as Array<string>;
    }

    /**
     * Returns attribute names for listing and search API. Defaults to the default serialization attribute names.
     * @returns {Array<string>} An array of attribute names.
     */
    public getListingAttributeNames(): Array<string>{
        return this.getDefaultSerializationAttributeNames();
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
            // TODO: add meta annotation for searchable attributes
            if( !att.hidden && !att.isIdentifier && att.type === 'string' ){ 
                attributeNames.push(attName); 
            }
        }

        return attributeNames;
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
            if( !att.hidden && att.type === 'string' ){ // TODO: add meta annotation for searchable attributes
                attributeNames.push(attName); 
            }
        }

        return attributeNames;
    }

    public serializeRecord<T extends Record<string, any> >(record: T, attributes = this.getDefaultSerializationAttributeNames() ): Partial<T> {
        return pickKeys<T>(record, ...attributes);
    }

    public serializeRecords<T extends Record<string, any>>(record: Array<T>, attributes = this.getDefaultSerializationAttributeNames() ): Array<Partial<T>> {
        return record.map(record => this.serializeRecord<T>(record, attributes));
    }

    /**
     * Retrieves an entity by its identifiers.
     * 
     * @param identifiers - The identifiers of the entity.
     * @param attributes - Optional array of attribute names to include in the response.
     * @returns A promise that resolves to the retrieved entity data.
     */
    public async get( identifiers: EntityIdentifiersTypeFromSchema<S>, attributes ?: Array<string> ) {
        this.logger.debug(`Called ~ get ~ entityName: ${this.getEntityName()}: `, {identifiers, attributes});
        
        if(!attributes){
            attributes = this.getDefaultSerializationAttributeNames()
        }

        const entity =  await getEntity<S>({
            id: identifiers, 
            attributes,
            entityName: this.getEntityName(),
            entityService: this,
        });

        return entity?.data;
    }
    
    /**
     * Creates a new entity.
     * 
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    public async create(payload: CreateEntityItemTypeFromSchema<S>) {
        this.logger.debug(`Called ~ create ~ entityName: ${this.getEntityName()} ~ payload:`, payload);

        const entity =  await createEntity<S>({
            data: payload, 
            entityName: this.getEntityName(),
            entityService: this,
        });

        return entity;
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

        if(!query.attributes || isEmptyArray(query.attributes)){
            query.attributes = this.getListingAttributeNames();
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

        entities.data = this.serializeRecords(entities.data, query.attributes as Array<string>);

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

        let selectAttributes: Array<string> | undefined = undefined;

        if(isArrayOfObjectOfStringKeysAndBooleanValues(attributes)){
            selectAttributes = Object.entries(attributes).filter( ([,v]) => !!v).map( ([k]) => k );
        } else if(isArrayOfStrings(attributes)) {
            selectAttributes = attributes;
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

        if(!selectAttributes || isEmptyArray(selectAttributes)){
            selectAttributes = this.getListingAttributeNames();
        }

        entities.data = this.serializeRecords(entities.data, selectAttributes);

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
    public async delete(identifiers: EntityIdentifiersTypeFromSchema<S>) {
        this.logger.debug(`Called ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);
        
        const deletedEntity =  await deleteEntity<S>({
            id: identifiers,
            entityName: this.getEntityName(),  
        });

        return deletedEntity;
    }

}

export function entityAttributeToIOSchemaAttribute(attId: string, att: EntityAttribute): Partial<EntityAttribute> & { 
    id: string,
    name: string,
} {
    return {
        id: attId,
        type: att.type,
        name: att.name || toHumanReadableName( attId ),
        fieldType: att.fieldType,
        required: att.required,
        readOnly: att.readOnly,
        isIdentifier: att.isIdentifier,
        validations: att.validations ||  att.required ? ['required'] : [],
    };
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

/**
 * Generates the default input and output schemas for various operations of an entity.
 * 
 * @template S - The entity schema type.
 * @template Ops - The type of entity operations.
 * 
 * @param schema - The entity schema.
 * @returns The default input and output schemas for the entity operations.
 */
export function makeOpsDefaultIOSchema<
    S extends EntitySchema<any, any, any, Ops>,
    Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
>( schema: S) {
	
	const inputSchemaAttributes = {
		create: new Map() as TIOSchemaAttributesMap<S> ,
		update: new Map() as TIOSchemaAttributesMap<S> ,
	};

	const outputSchemaAttributes = new Map() as TIOSchemaAttributesMap<S> ;

	// create and update
	for(const attName in schema.attributes){
		const att = schema.attributes[attName];

		if(!att.hidden){
			outputSchemaAttributes.set(attName, {
                ...entityAttributeToIOSchemaAttribute(attName, att), 
			});
		}
		
		// TODO: loop in validations
		if(!att.default && !att.hidden){
			inputSchemaAttributes['create']?.set(attName, {
                ...entityAttributeToIOSchemaAttribute(attName, att),
			});
        }

		if(!att.readOnly && !att.default && !att.hidden){
            inputSchemaAttributes['update']?.set(attName, {
                ...entityAttributeToIOSchemaAttribute(attName, att),
			});
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

	return {
		get: {
			// TODO: add schema for the rest fo the secondary access-patterns
			by: defaultAccessPattern,
			output: outputSchemaAttributes, // default for the detail page
		},
		delete: {
			by: defaultAccessPattern
		},
		create: {
			input: inputSchemaAttributes['create'],
			output: outputSchemaAttributes,
		},
		update: {
			by: defaultAccessPattern,
			input: inputSchemaAttributes['update'],
			output: outputSchemaAttributes,
		},
		list: {
			// TODO pagination and filtering input-schema
			output: outputSchemaAttributes,
		},
	};
}

