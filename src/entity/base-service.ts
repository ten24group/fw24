import { Attribute, EntityConfiguration, Schema } from "electrodb";
import { CreateEntityItemTypeFromSchema, DefaultEntityOperations, EntityAttribute, EntityIdentifiersTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, EntitySchema, TDefaultEntityOperations, UpdateEntityItemTypeFromSchema, createElectroDBEntity } from "./base-entity";
import { createEntity, deleteEntity, getEntity, listEntity, updateEntity } from "./crud-service";
import { EntityValidations, TValidationRuleForType } from "../validation";
import { Writable, toHumanReadableName } from "../utils";

export abstract class BaseEntityService<S extends EntitySchema<any, any, any>>{

    protected entityRepository ?: EntityRepositoryTypeFromSchema<S>;
    protected entityOpsDefaultIoSchema ?: ReturnType<typeof makeOpsDefaultIOSchema<S>>;

    constructor(
        protected readonly schema: S,
        protected readonly entityConfigurations: EntityConfiguration,
    ){
        return this;
    }

    public getEntityName(): S['model']['entity'] { return this.schema.model.entity; }
    
    public getEntitySchema(): S { return this.schema;}

    public getOpsDefaultIOSchema() {
        if(!this.entityOpsDefaultIoSchema){
            this.entityOpsDefaultIoSchema  = makeOpsDefaultIOSchema<S>(this.getEntitySchema());
        }
        return this.entityOpsDefaultIoSchema;
    }

    abstract getEntityValidations(): EntityValidations<any, any, any, any>;

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
    abstract extractEntityIdentifiers(options: any ): EntityIdentifiersTypeFromSchema<S>;

    /**
     * 
     * helper function to return all the attributes that can be used to find an entity 
     * [i.e. combo of primary-key attributes and secondary-key attributes for all indexes]
     * 
     */
    abstract getFilterAttributes(): any;
    abstract getPermissionRules( options: { opContext: 'update' | 'delete' | 'process' } ): any;

    public async get( identifiers: EntityIdentifiersTypeFromSchema<S> ) {
        console.log(`Called BaseEntityService<E ~ get ~ entityName: ${this.getEntityName()} ~ id:`, identifiers);

        const entity =  await getEntity<S>({
            id: identifiers, 
            entityName: this.getEntityName(),
        });

        return entity?.data;
    }
    
    public async create(data: CreateEntityItemTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ create ~ entityName: ${this.getEntityName()} ~ data:`, data);

        const entity =  await createEntity<S>({
            data: data, 
            entityName: this.getEntityName(),  
        });

        return entity;
    }

    public async list(data: EntityIdentifiersTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ list ~ entityName: ${this.getEntityName()} ~ data:`, data);

        const entities =  await listEntity<S>({
            filters: data,
            entityName: this.getEntityName(),  
        });

        return entities;
    }

    public async update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ update ~ entityName: ${this.getEntityName()} ~ identifiers:, data:`, identifiers, data);

        const updatedEntity =  await updateEntity<S>({
            id: identifiers,
            data: data, 
            entityName: this.getEntityName(),  
        });

	    return updatedEntity;
    }

    public async delete(identifiers: EntityIdentifiersTypeFromSchema<S>) {
        console.log(`Called BaseEntityService<E ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);
        
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

	const defaultAccessPattern = accessPatterns.get('primary') ?? accessPatterns.entries().next().value as TIOSchemaAttributesMap<S>;

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

