import { 
    BaseEntityService, 
    FieldMetadata, 
    TIOSchemaAttribute, 
    isSelectFieldMetadata,
    SelectFieldMetadata,
    EntityAttribute,
    IRelationFieldConfig
} from "../../entity";
import { DefaultLogger } from "../../logging";
import { pascalCase } from "../../utils";
import { makeCreateEntityFormConfig } from "./create-entity";
import { makeViewEntityListConfig } from "./list-entity";
import { makeViewEntityDetailConfig } from "./view-entity";

/**
 * Generate smart fallback configuration for relation display when only ID is available.
 * Uses entity metadata (icon, entityNamePlural) to create user-friendly fallback text.
 * 
 * @param entityName - Related entity name (e.g., 'team')
 * @param idField - ID field name (e.g., 'teamId')
 * @param entityService - Entity service to get metadata from
 * @returns Fallback configuration with template, linkText, and modalButtonText
 * 
 * @example
 * // For a team relation
 * generateRelationFallback('team', 'teamId', teamService)
 * // Returns: {
 * //   template: 'Team: {teamId}',
 * //   linkText: 'View Team',
 * //   modalButtonText: 'Team Details'
 * // }
 */
export function generateRelationFallback(
    entityName: string,
    idField: string,
    entityService?: BaseEntityService<any>
): NonNullable<IRelationFieldConfig['displayConfig']>['fallback'] {
    // Try to get entity metadata for better fallback text
    const entityMetadata = entityService?.getEntitySchema?.().model;
    const displayName = entityMetadata?.entityNamePlural || pascalCase(entityName);
    
    return {
        // Backend pre-generates fallback template (intentionally string-only, not Template type)
        // Frontend will use this when only ID is available
        template: `${displayName}: {${idField}}`,  // e.g., "Team: {teamId}"
        linkText: `View ${displayName}`,           // e.g., "View Team"
        modalButtonText: `${displayName} Details`  // e.g., "Team Details"
    };
}

export function formatEntityAttributeForFormOrDetail(
    thisProp: TIOSchemaAttribute,
    type: 'create' | 'update' | 'detail',
    entityService: BaseEntityService<any>
) {
    const formatted: any = {
        ...thisProp,
        label: thisProp.name,
        column: thisProp.id,
        fieldType: thisProp.fieldType || 'text',
        hidden: thisProp.hasOwnProperty('isVisible') && !thisProp.isVisible
    };

    // Handle addNewOption (OLD - deprecated, generates embedded config) or addNewOptionConfig (NEW - just pass through reference)
    if (isSelectFieldMetadata(thisProp) && [ 'create', 'update' ].includes(type)) {
        const selectField = thisProp as SelectFieldMetadata;
        
        if (selectField.addNewOptionConfig) {
            // NEW WAY: User provided addNewOptionConfig reference - just pass it through
            formatted[ 'addNewOptionConfig' ] = selectField.addNewOptionConfig;
            
        } else if (selectField.addNewOption) {
            // OLD WAY (DEPRECATED): Transform addNewOption to addNewOptionConfig for backward compatibility
            const { entityName, overrideConfig } = selectField.addNewOption;

            if (entityName && entityService.hasEntityServiceByEntityName(entityName)) {
                formatted[ 'addNewOptionConfig' ] = {
                    entityName: entityName,
                    pageType: 'create' as const,
                    overrideConfig: overrideConfig || {
                        submitSuccessRedirect: undefined,  // Stay in modal after creation
                        formButtons: [
                            { text: "Add", action: "submit" },
                            { text: "Cancel", action: "cancel" }
                        ]
                    }
                };
            } else {
                DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            }
        }
    }

    // Handle relation fields (DATA LAYER + UI LAYER)
    if (thisProp.relation && type === 'detail') {
        const relation = thisProp.relation;
        const { entityName, type: relationType, identifiers } = relation;
        const entityNameLower = entityName.toLowerCase();

        if (!entityService.hasEntityServiceByEntityName(entityName)) {
            DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            return formatted;
        }

        // Resolve identifiers (could be direct value or lazy function)
        const resolvedIdentifiers = typeof identifiers === 'function' ? identifiers() : identifiers;

        // Safety check for array identifiers
        if (Array.isArray(resolvedIdentifiers)) {
            if (resolvedIdentifiers.length === 0) {
                DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Empty identifiers array for relation [${entityName}]`);
                return formatted;
            }
        }

        // Handle both single and multiple identifiers for composite keys
        const identifierMappings = Array.isArray(resolvedIdentifiers) 
            ? resolvedIdentifiers.map(id => ({
                source: String(id.source),
                target: String(id.target)
              }))
            : [{
                source: String(resolvedIdentifiers.source),
                target: String(resolvedIdentifiers.target)
              }];

        // For route pattern and default filters, use the first identifier
        // (most entities have single identifier; composite keys need explicit routePattern)
        const primaryIdentifier = identifierMappings[0];

        // Check if user provided custom UI config in relationConfig (optional override)
        const userRelationConfig = thisProp.relationConfig as IRelationFieldConfig | undefined;

        // Get related entity service for metadata (icon, etc.)
        const relatedEntityService = entityService.hasEntityServiceByEntityName(entityName) 
            ? entityService.getEntityServiceByEntityName(entityName)
            : undefined;
        
        // Get entity metadata for icon and fallback generation
        const relatedEntityMetadata = relatedEntityService?.getEntitySchema?.().model;
        const defaultIcon = relatedEntityMetadata?.metadata?.icon;

        if (relationType.endsWith('to-one')) {
            // TO-ONE: Show value as link + modal icon
            // Route pattern: Use custom (from relationConfig) or default to /view-{entity}/:targetId
            const routePattern = userRelationConfig?.routePattern 
                || `/view-${entityNameLower}/:${primaryIdentifier.target}`;

            // Generate fallback configuration for when only ID is available
            const fallbackConfig = generateRelationFallback(
                entityName,
                primaryIdentifier.source,
                relatedEntityService
            );

            const generatedRelationConfig: IRelationFieldConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1 
                    ? identifierMappings[0]  // Single: return object
                    : identifierMappings,     // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'view' as const,
                    overrideConfig: {}
                },
                modalWidth: userRelationConfig?.modalWidth,
                modalTitle: userRelationConfig?.modalTitle,
                displayConfig: {
                    // User can override with custom template
                    template: userRelationConfig?.displayConfig?.template,
                    // Smart fallback pre-generated from entity metadata
                    fallback: userRelationConfig?.displayConfig?.fallback || fallbackConfig,
                    // Icon from entity metadata or user override
                    icon: userRelationConfig?.displayConfig?.icon || defaultIcon || 'EyeOutlined',
                    showModalIcon: userRelationConfig?.displayConfig?.showModalIcon !== false,
                    showLink: userRelationConfig?.displayConfig?.showLink !== false,
                    // Pass through any custom actions
                    actions: userRelationConfig?.displayConfig?.actions
                }
            };

            formatted[ 'relationConfig' ] = generatedRelationConfig;

            // Backward compatibility: Keep isLink and linkConfig
            formatted[ 'isLink' ] = true;
            formatted[ 'linkConfig' ] = {
                routePattern: routePattern
            };

        } else if (relationType.endsWith('to-many')) {
            // TO-MANY: Show count + modal icon (opens filtered list)
            // Route pattern: Use custom (from relationConfig) or default to /list-{entity}
            const routePattern = userRelationConfig?.routePattern
                || `/list-${entityNameLower}`;

            // Build default filters to show only related items
            // For example, if we're viewing a Team and this field shows Games,
            // we want to filter games where teamId = current team's ID
            // For composite keys, add all identifiers as filters
            const defaultFilters: Record<string, any> = {};
            identifierMappings.forEach(mapping => {
                defaultFilters[mapping.source] = `:${mapping.source}`;
            });

            // Generate fallback configuration for to-many (shows count)
            const fallbackConfig = generateRelationFallback(
                entityName,
                primaryIdentifier.source,
                relatedEntityService
            );

            const generatedRelationConfig: IRelationFieldConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1 
                    ? identifierMappings[0]  // Single: return object
                    : identifierMappings,     // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'list' as const,
                    overrideConfig: {
                        defaultFilters: defaultFilters
                    }
                },
                modalWidth: userRelationConfig?.modalWidth,
                modalTitle: userRelationConfig?.modalTitle,
                displayConfig: {
                    // User can override with custom template
                    template: userRelationConfig?.displayConfig?.template,
                    // Smart fallback pre-generated from entity metadata
                    fallback: userRelationConfig?.displayConfig?.fallback || fallbackConfig,
                    // Icon from entity metadata or user override
                    icon: userRelationConfig?.displayConfig?.icon || defaultIcon || 'UnorderedListOutlined',
                    showModalIcon: userRelationConfig?.displayConfig?.showModalIcon !== false,
                    showLink: userRelationConfig?.displayConfig?.showLink !== true, // Default false for to-many
                    // Pass through any custom actions
                    actions: userRelationConfig?.displayConfig?.actions
                }
            };

            // If user provided custom modalConfigRef, merge default filters with their overrides
            if (userRelationConfig?.modalConfigRef?.overrideConfig) {
                generatedRelationConfig.modalConfigRef!.overrideConfig = {
                    ...userRelationConfig.modalConfigRef.overrideConfig,
                    defaultFilters: {
                        ...defaultFilters,
                        ...(userRelationConfig.modalConfigRef.overrideConfig.defaultFilters || {})
                    }
                };
            }

            formatted[ 'relationConfig' ] = generatedRelationConfig;
         }
    }

    // Handle nested structures (map and list types)
    if (thisProp.type === 'map' && thisProp.properties) {
        formatted[ 'properties' ] = formatEntityAttributesForFormOrDetail(thisProp.properties, type, entityService);
    } else if (thisProp.type === 'list') {
        // For list types, check if items are maps (nested structures)
        // Note: items property exists on list-type attributes but not in base EntityAttribute type
        const extendedProp = thisProp as TIOSchemaAttribute & { items?: { type: string; properties?: TIOSchemaAttribute[] } };
        if (extendedProp.items?.type === 'map' && extendedProp.items.properties) {
            formatted[ 'items' ] = {
                ...formatted[ 'items' ],
                properties: formatEntityAttributesForFormOrDetail(extendedProp.items.properties, type, entityService)
            };
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

    if (type === 'create') {
        return formatEntityAttributesForCreate(properties, entityService);
    }

    if (type === 'update') {
        return formatEntityAttributesForUpdate(properties, entityService);
    }

    if (type === 'detail') {
        return formatEntityAttributesForDetail(properties, entityService);
    }
    throw (`Invalid type [${type}] provided to formatEntityAttributesForFormOrDetail`);
}

export function formatEntityAttributesForCreate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isCreatable') || prop.isCreatable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'create', entityService));
}

export function formatEntityAttributesForUpdate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isEditable') || prop.isEditable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'update', entityService));
}

export function formatEntityAttributesForDetail(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isVisible') || prop.isVisible))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'detail', entityService));
}

export type ListingPropConfig = Pick<FieldMetadata, 'fieldType' | 'placeholder' | 'helpText' | 'filterConfig'> & {
    name: string,
    dataIndex: string,
    hidden?: boolean,
    actions?: any[],
};

export function formatEntityAttributesForList(entityName: string, properties: TIOSchemaAttribute[], {
    CRUDApiPath,
    excludeFromAdminUpdate,
    excludeFromAdminDelete,
    excludeFromAdminDetail
}: {
    CRUDApiPath?: string,
    excludeFromAdminUpdate?: boolean,
    excludeFromAdminDelete?: boolean,
    excludeFromAdminDetail?: boolean,
}) {

    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    return properties
        .filter(prop => prop && prop.isListable)
        .map(prop => {

            const propConfig: ListingPropConfig = {
                ...prop,
                dataIndex: `${prop.id}`,
                fieldType: prop.fieldType || 'text',
                hidden: prop.hasOwnProperty('isVisible') && !prop.isVisible
            };

            if (prop.isIdentifier) {

                const actions = [];

                if (!excludeFromAdminUpdate) {
                    actions.push({
                        icon: 'edit',
                        label: 'Edit',
                        template: `Edit {${prop.id}}`, // Dynamic label showing which record
                        url: `/edit-${entityNameLower}`
                    });
                }

                if (!excludeFromAdminDelete) {
                    actions.push({
                        icon: 'delete',
                        label: 'Delete',
                        template: `Delete {${prop.id}}`, // Dynamic label showing which record
                        openInModal: true,
                        modalConfig: {
                            modalType: 'confirm',
                            modalPageConfig: {
                                title: `Delete ${entityNamePascalCase}?`,
                                content: `Are you sure you want to delete this ${entityNamePascalCase}? This action cannot be undone.`
                            },
                            apiConfig: {
                                apiMethod: `DELETE`,
                                responseKey: entityNameLower,
                                apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
                            },
                            successMessage: `${entityNamePascalCase} deleted successfully`,
                            errorMessage: `Failed to delete ${entityNamePascalCase}`,
                            submitSuccessRedirect: `/list-${entityNameLower}`
                        }
                    });
                }

                if (!excludeFromAdminDetail) {
                    actions.push({
                        icon: 'view',
                        label: 'View',
                        template: `View {${prop.id}}`, // Dynamic label showing which record
                        url: `/view-${entityNameLower}`
                    });
                }

                propConfig.actions = actions;
            }

            return propConfig;
        });
}
