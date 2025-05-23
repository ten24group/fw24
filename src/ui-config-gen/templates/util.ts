import { BaseEntityService, TIOSchemaAttribute, isSelectFieldMetadata } from "../../entity";
import { DefaultLogger } from "../../logging";
import { pascalCase } from "../../utils";
import { makeCreateEntityFormConfig } from "./create-entity";
import { makeViewEntityListConfig } from "./list-entity";
import { makeViewEntityDetailConfig } from "./view-entity";

export function formatEntityAttributeForFormOrDetail(
    thisProp: TIOSchemaAttribute, 
    type: 'create' | 'update' | 'detail',
    entityService: BaseEntityService<any>
) {
    const formatted: any =  {
        ...thisProp,
        label:          thisProp.name,
        column:         thisProp.id,
        fieldType:      thisProp.fieldType || 'text',
        hidden: thisProp.hasOwnProperty('isVisible') && !thisProp.isVisible
    };

    if(isSelectFieldMetadata(thisProp) && thisProp.addNewOption && ['create', 'update'].includes(type)){
        
        const {entityName} = thisProp.addNewOption;

        if(entityName && entityService.hasEntityServiceByEntityName(entityName)){
            const relatedEntityService = entityService.getEntityServiceByEntityName(entityName);
            const relatedEntitySchema = relatedEntityService.getEntitySchema();
            const relDefaultIoSchema = relatedEntityService.getOpsDefaultIOSchema();

            let formConfig = makeCreateEntityFormConfig({
                entityName,
                properties: relDefaultIoSchema.create.input,
                entityNamePlural: relatedEntitySchema.model.entityNamePlural,
            }, relatedEntityService);

            formatted['addNewOption'] = {
                modalType: 'form',
                modalPageConfig: formConfig
            }
        } else {
            DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
        }
    }
    
    if(thisProp.relation && type === 'detail'){
        
        const entityName = thisProp.relation.entityName;

        if(entityService.hasEntityServiceByEntityName(entityName)){
            const relatedEntityService = entityService.getEntityServiceByEntityName(entityName);
            const relatedEntitySchema = relatedEntityService.getEntitySchema();
            const relDefaultIoSchema = relatedEntityService.getOpsDefaultIOSchema();

            if(thisProp.relation.type.endsWith('to-one')){

                const modalPageConfig = makeViewEntityDetailConfig({
                    entityName,
                    properties: relDefaultIoSchema.update.input,
                    entityNamePlural: relatedEntitySchema.model.entityNamePlural,
                }, relatedEntityService);

                formatted['openInModal'] = {
                    modalType: 'details',
                    modalPageConfig
                }
            } else if(thisProp.relation.type.endsWith('to-many')){

                const modalPageConfig = makeViewEntityListConfig({
                    entityName,
                    properties: relDefaultIoSchema.update.input,
                    entityNamePlural: relatedEntitySchema.model.entityNamePlural,
                    excludeFromAdminUpdate: relatedEntitySchema.model.excludeFromAdminUpdate,
                    excludeFromAdminDelete: relatedEntitySchema.model.excludeFromAdminDelete,
                    excludeFromAdminDetail: relatedEntitySchema.model.excludeFromAdminDetail
                });
                
                formatted['openInModal'] = {
                    modalType: 'list',
                    modalPageConfig
                }
            }
        }
    }

    const items = (thisProp as any).items;
    if(thisProp.type === 'map'){
        formatted['properties'] =  formatEntityAttributesForFormOrDetail(thisProp.properties ?? [], type, entityService);
    } else if(thisProp.type === 'list' && items?.type === 'map'){
        formatted['items'] = {
            ...formatted['items'],
            properties: formatEntityAttributesForFormOrDetail(items.properties ?? [], type, entityService)
        }
    }

    // TODO: add support for set, enum, and custom-types

    return formatted;
}

export function formatEntityAttributesForFormOrDetail( 
    properties: TIOSchemaAttribute[], 
    type: 'create' | 'update' | 'detail',
    entityService: BaseEntityService<any>
) {
    
    if(type === 'create'){
        return formatEntityAttributesForCreate(properties, entityService);
    } 

    if(type === 'update'){
        return formatEntityAttributesForUpdate(properties, entityService);
    } 

    if(type === 'detail'){
        return formatEntityAttributesForDetail(properties, entityService);
    }
    throw (`Invalid type [${type}] provided to formatEntityAttributesForFormOrDetail`);
}

export function formatEntityAttributesForCreate( properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>) {
    return properties
        .filter( prop => prop && (!prop.hasOwnProperty('isCreatable') || prop.isCreatable) )
        .map( (att) => formatEntityAttributeForFormOrDetail(att, 'create', entityService) );
}

export function formatEntityAttributesForUpdate( properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>) {
    return properties
        .filter( prop => prop && (!prop.hasOwnProperty('isEditable') || prop.isEditable) )
        .map( (att) => formatEntityAttributeForFormOrDetail(att, 'update', entityService) );
}

export function formatEntityAttributesForDetail( properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>) {
    return properties
        .filter( prop => prop && (!prop.hasOwnProperty('isVisible') || prop.isVisible) )
        .map( (att) => formatEntityAttributeForFormOrDetail(att, 'detail', entityService) );
}

export type ListingPropConfig = {
    name: string,
    dataIndex: string,
    fieldType: string,
    hidden?: boolean,
    actions?: any[]
};

export function formatEntityAttributesForList( entityName: string, properties: TIOSchemaAttribute[], {
    excludeFromAdminUpdate,
    excludeFromAdminDelete,
    excludeFromAdminDetail
}: {
    excludeFromAdminUpdate?: boolean,
    excludeFromAdminDelete?: boolean,
    excludeFromAdminDetail?: boolean,
}) {

    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);
    
    return properties
        .filter( prop => prop && prop.isListable )
        .map( prop => {
        
        const propConfig: ListingPropConfig = {
            ...prop,
            dataIndex:  `${prop.id}`,
            fieldType:  prop.fieldType || 'text',
            hidden: prop.hasOwnProperty('isVisible') && !prop.isVisible
        };

        if(prop.isIdentifier){

            const actions = [];

            if(!excludeFromAdminUpdate){
                actions.push({
                    icon: 'edit',
                    url: `/edit-${entityNameLower}`
                });
            }

            if(!excludeFromAdminDelete){
                actions.push({
                    icon: 'delete',
                    openInModal: true,
                    modalConfig: {
                        modalType: 'confirm',
                        modalPageConfig: {
                            title: `Delete ${entityNamePascalCase}`,
                            content: `Are you sure you want to delete this ${entityNamePascalCase}?`
                        },
                        apiConfig: {
                            apiMethod: `DELETE`,
                            responseKey: entityNameLower,
                            apiUrl: `/${entityNameLower}`,
                        },
                        submitSuccessRedirect: `/list-${entityNameLower}`
                    }
                });
            }

            if(!excludeFromAdminDetail){
                actions.push({
                    icon: 'view',
                    url: `/view-${entityNameLower}`
                });
            }

            propConfig.actions = actions;
        }

        return propConfig;
    });
}
