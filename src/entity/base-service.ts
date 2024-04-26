import { EntityConfiguration } from "electrodb";
import { toHumanReadableName } from "../utils";
import { EntityOpsInputValidations, EntityValidations } from "../validation";
import { CreateEntityItemTypeFromSchema, EntityAttribute, EntityIdentifiersTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, EntitySchema, TDefaultEntityOperations, UpdateEntityItemTypeFromSchema, createElectroDBEntity } from "./base-entity";
import { createEntity, deleteEntity, getEntity, listEntity, queryEntity, updateEntity } from "./crud-service";
import { createLogger } from "../logging";
import { Pagination } from "./query.types";

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
     * return an object containing all the required attributes/values to fulfill an index
     * e.g. entityId, tenantId, partition-keys.... etc
     * this will be used by the BaseEntityService to find the right entity for get/update/delete operations
     * 
     * @param options
     * @returns object containing all the required attributes/values to fulfill an index
     * e.g. 
     * IN   ==> `Request` object with headers, body, auth-context etc
     * OUT  ==> { tenantId: xxx, email: xxx@yyy.com, some-partition-key: xx-yy-zz }
     *
     *  */ 
    extractEntityIdentifiers(
        input: any, 
        context: { tenantId: string, forAccessPattern ?: string } = {
            tenantId: 'xxx-yyy-zzz'
        } 
    ): EntityIdentifiersTypeFromSchema<S>{
        const identifiers: any = {};

        if(!input || typeof input !== 'object') {
            throw new Error('Input is required and must be an object');
        }

        // TODO: tenant logic
        identifiers['tenantId'] = input.tenantId || context.tenantId;

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

    public getEntityValidations(): EntityValidations<S> | EntityOpsInputValidations<S>{
        return {};
    };

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

    public getOpsDefaultIOSchema() {
        if(!this.entityOpsDefaultIoSchema){
            this.entityOpsDefaultIoSchema  = makeOpsDefaultIOSchema<S>(this.getEntitySchema());
        }
        return this.entityOpsDefaultIoSchema;
    }

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

    public async get( identifiers: EntityIdentifiersTypeFromSchema<S> ) {
        this.logger.debug(`Called ~ get ~ entityName: ${this.getEntityName()} ~ id:`, identifiers);

        const entity =  await getEntity<S>({
            id: identifiers, 
            entityName: this.getEntityName(),
        });

        return entity?.data;
    }
    
    public async create(data: CreateEntityItemTypeFromSchema<S>) {
        this.logger.debug(`Called ~ create ~ entityName: ${this.getEntityName()} ~ data:`, data);

        const entity =  await createEntity<S>({
            data: data, 
            entityName: this.getEntityName(),  
        });

        return entity;
    }

    public async list(options: { filters?: any, pagination?: Pagination } = {}) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ options:`, options);

        const entities =  await listEntity<S>({
            filters: options.filters,
            pagination: options.pagination,
            entityName: this.getEntityName(),  
        });

        return entities;
    }

    public async query(query: {}) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);

        const entities =  await queryEntity<S>({
            query,
            entityName: this.getEntityName(),  
        });

        return entities;
    }

    

    public async update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>) {
        this.logger.debug(`Called ~ update ~ entityName: ${this.getEntityName()} ~ identifiers:, data:`, identifiers, data);

        const updatedEntity =  await updateEntity<S>({
            id: identifiers,
            data: data, 
            entityName: this.getEntityName(),  
        });

	    return updatedEntity;
    }

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

