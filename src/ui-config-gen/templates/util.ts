import { TIOSchemaAttribute, defaultMetaContainer, isSelectFieldMetadata } from "../../entity";
import { pascalCase } from "../../utils";
import { makeCreateEntityFormConfig } from "./create-entity";
import { makeViewEntityListConfig } from "./list-entity";
import { makeUpdateEntityFormConfig } from "./update-entity";
import { makeViewEntityDetailConfig } from "./view-entity";

export function formatEntityAttributeForFormOrDetail(thisProp: TIOSchemaAttribute, type: 'create' | 'update' | 'detail' ) {
    const formatted: any =  {
        ...thisProp,
        label:          thisProp.name,
        column:         thisProp.id,
        fieldType:      thisProp.fieldType || 'text',
        hidden: thisProp.hasOwnProperty('isVisible') && !thisProp.isVisible
    };

    if(isSelectFieldMetadata(thisProp) && thisProp.addNewOption && ['create', 'update'].includes(type)){
        
        const {entityName} = thisProp.addNewOption;

        if(entityName && defaultMetaContainer.hasEntityServiceByEntityName(entityName)){
            const entityService = defaultMetaContainer.getEntityServiceByEntityName(entityName);
            const entitySchema = entityService.getEntitySchema();
            const defaultIoSchema = entityService.getOpsDefaultIOSchema();

            let formConfig = makeCreateEntityFormConfig({
                entityName,
                properties: defaultIoSchema.create.input,
                entityNamePlural: entitySchema.model.entityNamePlural,
            });

            formatted['addNewOption'] = {
                modalType: 'form',
                modalPageConfig: formConfig
            }
        }
    }
    
    if(thisProp.relation && type === 'detail'){
        
        const entityName = thisProp.relation.entity;

        if(defaultMetaContainer.hasEntityServiceByEntityName(entityName)){
            const entityService = defaultMetaContainer.getEntityServiceByEntityName(entityName);
            const entitySchema = entityService.getEntitySchema();
            const defaultIoSchema = entityService.getOpsDefaultIOSchema();

            if(thisProp.relation.type.endsWith('to-one')){

                const modalPageConfig = makeViewEntityDetailConfig({
                    entityName,
                    properties: defaultIoSchema.update.input,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                });

                formatted['openInModal'] = {
                    modalType: 'details',
                    modalPageConfig
                }
            } else if(thisProp.relation.type.endsWith('to-many')){

                const modalPageConfig = makeViewEntityListConfig({
                    entityName,
                    properties: defaultIoSchema.update.input,
                    entityNamePlural: entitySchema.model.entityNamePlural,
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
        formatted['properties'] =  formatEntityAttributesForFormOrDetail(thisProp.properties ?? [], type);
    } else if(thisProp.type === 'list' && items?.type === 'map'){
        formatted['items'] = {
            ...formatted['items'],
            properties: formatEntityAttributesForFormOrDetail(items.properties ?? [], type)
        }
    }

    // TODO: add support for set, enum, and custom-types

    return formatted;
}

export function formatEntityAttributesForFormOrDetail( properties: TIOSchemaAttribute[], type: 'create' | 'update' | 'detail' ) {
    
    if(type === 'create'){
        return formatEntityAttributesForCreate(properties);
    } 

    if(type === 'update'){
        return formatEntityAttributesForUpdate(properties);
    } 

    if(type === 'detail'){
        return formatEntityAttributesForDetail(properties);
    }
    throw (`Invalid type [${type}] provided to formatEntityAttributesForFormOrDetail`);
}

export function formatEntityAttributesForCreate( properties: TIOSchemaAttribute[]) {
    return properties
        .filter( prop => prop && prop.isCreatable )
        .map( (att) => formatEntityAttributeForFormOrDetail(att, 'create') );
}

export function formatEntityAttributesForUpdate( properties: TIOSchemaAttribute[]) {
    return properties
        .filter( prop => prop && prop.isEditable )
        .map( (att) => formatEntityAttributeForFormOrDetail(att, 'update') );
}

export function formatEntityAttributesForDetail( properties: TIOSchemaAttribute[]) {
    return properties
        .filter( prop => prop && prop.isVisible )
        .map( (att) => formatEntityAttributeForFormOrDetail(att, 'detail') );
}

export type ListingPropConfig = {
    name: string,
    dataIndex: string,
    fieldType: string,
    hidden?: boolean,
    actions?: any[]
};

export function formatEntityAttributesForList( entityName: string, properties: TIOSchemaAttribute[]) {

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

            propConfig.actions = [
                {
                    icon: 'edit',
                    url: `/edit-${entityNameLower}`
                },
                {
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
                        confirmSuccessRedirect: `/list-${entityNameLower}`
                    }
                },
                {
                    icon: `view`,
                    url: `/view-${entityNameLower}`
                }
            ];
        }

        return propConfig;
    });
}