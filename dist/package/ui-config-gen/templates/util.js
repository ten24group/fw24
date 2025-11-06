"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRelationFallback = generateRelationFallback;
exports.formatEntityAttributeForFormOrDetail = formatEntityAttributeForFormOrDetail;
exports.formatEntityAttributesForFormOrDetail = formatEntityAttributesForFormOrDetail;
exports.formatEntityAttributesForCreate = formatEntityAttributesForCreate;
exports.formatEntityAttributesForUpdate = formatEntityAttributesForUpdate;
exports.formatEntityAttributesForDetail = formatEntityAttributesForDetail;
exports.formatEntityAttributesForList = formatEntityAttributesForList;
exports.mergeButtons = mergeButtons;
exports.mergeActions = mergeActions;
exports.mergeFieldVisibility = mergeFieldVisibility;
exports.mergeColumnVisibility = mergeColumnVisibility;
const entity_1 = require("../../entity");
const logging_1 = require("../../logging");
const utils_1 = require("../../utils");
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
function generateRelationFallback(entityName, idField, entityService) {
    // Try to get entity metadata for better fallback text
    const entityMetadata = entityService?.getEntitySchema?.().model;
    const displayName = entityMetadata?.entityNamePlural || (0, utils_1.pascalCase)(entityName);
    return {
        // Backend pre-generates fallback template (intentionally string-only, not Template type)
        // Frontend will use this when only ID is available
        template: `${displayName}: {${idField}}`, // e.g., "Team: {teamId}"
        linkText: `View ${displayName}`, // e.g., "View Team"
        modalButtonText: `${displayName} Details` // e.g., "Team Details"
    };
}
function formatEntityAttributeForFormOrDetail(thisProp, type, entityService) {
    const formatted = {
        ...thisProp,
        label: thisProp.name,
        column: thisProp.id,
        fieldType: thisProp.fieldType || 'text', // fieldType should already be inferred in base-service
        hidden: thisProp.hasOwnProperty('isVisible') && !thisProp.isVisible
    };
    // Handle addNewOption (OLD - deprecated, generates embedded config) or addNewOptionConfig (NEW - just pass through reference)
    if ((0, entity_1.isSelectFieldMetadata)(thisProp) && ['create', 'update'].includes(type)) {
        const selectField = thisProp;
        if (selectField.addNewOptionConfig) {
            // NEW WAY: User provided addNewOptionConfig reference - just pass it through
            formatted['addNewOptionConfig'] = selectField.addNewOptionConfig;
        }
        else if (selectField.addNewOption) {
            // OLD WAY (DEPRECATED): Transform addNewOption to addNewOptionConfig for backward compatibility
            const { entityName, overrideConfig } = selectField.addNewOption;
            if (entityName && entityService.hasEntityServiceByEntityName(entityName)) {
                formatted['addNewOptionConfig'] = {
                    entityName: entityName,
                    pageType: 'create',
                    overrideConfig: overrideConfig || {
                        submitSuccessRedirect: undefined, // Stay in modal after creation
                        formButtons: [
                            { text: "Add", action: "submit" },
                            { text: "Cancel", action: "cancel" }
                        ]
                    }
                };
            }
            else {
                logging_1.DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            }
        }
    }
    // Handle relation fields (DATA LAYER + UI LAYER)
    if (thisProp.relation && type === 'detail') {
        const relation = thisProp.relation;
        const { entityName, type: relationType, identifiers } = relation;
        const entityNameLower = entityName.toLowerCase();
        if (!entityService.hasEntityServiceByEntityName(entityName)) {
            logging_1.DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            return formatted;
        }
        // Resolve identifiers (could be direct value or lazy function)
        const resolvedIdentifiers = typeof identifiers === 'function' ? identifiers() : identifiers;
        // Safety check for array identifiers
        if (Array.isArray(resolvedIdentifiers)) {
            if (resolvedIdentifiers.length === 0) {
                logging_1.DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Empty identifiers array for relation [${entityName}]`);
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
        const userRelationConfig = thisProp.relationConfig;
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
            const fallbackConfig = generateRelationFallback(entityName, primaryIdentifier.source, relatedEntityService);
            const generatedRelationConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1
                    ? identifierMappings[0] // Single: return object
                    : identifierMappings, // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'view',
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
            formatted['relationConfig'] = generatedRelationConfig;
            // Backward compatibility: Keep isLink and linkConfig
            formatted['isLink'] = true;
            formatted['linkConfig'] = {
                routePattern: routePattern
            };
        }
        else if (relationType.endsWith('to-many')) {
            // TO-MANY: Show count + modal icon (opens filtered list)
            // Route pattern: Use custom (from relationConfig) or default to /list-{entity}
            const routePattern = userRelationConfig?.routePattern
                || `/list-${entityNameLower}`;
            // Build default filters to show only related items
            // For example, if we're viewing a Team and this field shows Games,
            // we want to filter games where teamId = current team's ID
            // For composite keys, add all identifiers as filters
            const defaultFilters = {};
            identifierMappings.forEach(mapping => {
                defaultFilters[mapping.target] = `:${mapping.source}`;
            });
            // Generate fallback configuration for to-many (shows count)
            const fallbackConfig = generateRelationFallback(entityName, primaryIdentifier.source, relatedEntityService);
            const generatedRelationConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1
                    ? identifierMappings[0] // Single: return object
                    : identifierMappings, // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'list',
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
                generatedRelationConfig.modalConfigRef.overrideConfig = {
                    ...userRelationConfig.modalConfigRef.overrideConfig,
                    defaultFilters: {
                        ...defaultFilters,
                        ...(userRelationConfig.modalConfigRef.overrideConfig.defaultFilters || {})
                    }
                };
            }
            formatted['relationConfig'] = generatedRelationConfig;
        }
    }
    // Handle nested structures (map and list types)
    if (thisProp.type === 'map' && thisProp.properties) {
        formatted['properties'] = formatEntityAttributesForFormOrDetail(thisProp.properties, type, entityService);
    }
    else if (thisProp.type === 'list') {
        // For list types, check if items are maps (nested structures)
        // Note: items property exists on list-type attributes but not in base EntityAttribute type
        const extendedProp = thisProp;
        if (extendedProp.items?.type === 'map' && extendedProp.items.properties) {
            formatted['items'] = {
                ...formatted['items'],
                properties: formatEntityAttributesForFormOrDetail(extendedProp.items.properties, type, entityService)
            };
        }
    }
    // TODO: add support for set, enum, and custom-types
    return formatted;
}
function formatEntityAttributesForFormOrDetail(properties, type, entityService) {
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
function formatEntityAttributesForCreate(properties, entityService) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isCreatable') || prop.isCreatable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'create', entityService));
}
function formatEntityAttributesForUpdate(properties, entityService) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isEditable') || prop.isEditable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'update', entityService));
}
function formatEntityAttributesForDetail(properties, entityService) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isVisible') || prop.isVisible))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'detail', entityService));
}
function formatEntityAttributesForList(entityName, properties, { CRUDApiPath, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, customRowActions }) {
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = (0, utils_1.pascalCase)(entityName);
    return properties
        .filter(prop => prop && prop.isListable)
        .map(prop => {
        const propConfig = {
            ...prop,
            dataIndex: `${prop.id}`,
            fieldType: prop.fieldType || 'text', // fieldType should already be inferred in base-service
            hidden: prop.hasOwnProperty('isVisible') && !prop.isVisible
        };
        if (prop.isIdentifier) {
            // Build default row actions with IDs
            const defaultActions = [];
            if (!excludeFromAdminDetail) {
                defaultActions.push({
                    id: 'view',
                    icon: 'view',
                    label: 'View',
                    template: `View {${prop.id}}`,
                    url: `/view-${entityNameLower}`
                });
            }
            if (!excludeFromAdminUpdate) {
                defaultActions.push({
                    id: 'edit',
                    icon: 'edit',
                    label: 'Edit',
                    template: `Edit {${prop.id}}`,
                    url: `/edit-${entityNameLower}`
                });
            }
            if (!excludeFromAdminDelete) {
                defaultActions.push({
                    id: 'delete',
                    icon: 'delete',
                    label: 'Delete',
                    template: `Delete {${prop.id}}`,
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
            // Merge custom row actions using identifier-based override
            propConfig.actions = customRowActions
                ? mergeActions(defaultActions, customRowActions)
                : defaultActions;
        }
        return propConfig;
    });
}
/**
 * MERGE UTILITY FUNCTIONS
 *
 * These functions implement the identifier-based override pattern:
 * - Defaults have standard identifiers (e.g., 'view', 'edit', 'delete')
 * - Custom configs with same identifier override the default
 * - New identifiers get added to the result
 */
/**
 * Merge default buttons with custom buttons using identifier-based override.
 *
 * @param defaults - Default buttons (from generator)
 * @param customs - Custom buttons (from entity schema)
 * @returns Merged button array
 */
function mergeButtons(defaults, customs = []) {
    const customsArray = [...customs]; // Convert to mutable array
    const customMap = new Map(customsArray.filter(c => c.id).map(c => [c.id, c]));
    // Start with defaults, replace if custom has same id
    const merged = defaults.map(defaultBtn => defaultBtn.id && customMap.has(defaultBtn.id)
        ? customMap.get(defaultBtn.id) // Override
        : defaultBtn);
    // Add custom buttons that don't override defaults
    customsArray.forEach(customBtn => {
        if (!customBtn.id || !defaults.some(d => d.id === customBtn.id)) {
            merged.push(customBtn); // Add new
        }
    });
    return merged;
}
/**
 * Merge default actions with custom actions using identifier-based override.
 * Same logic as mergeButtons but semantically named for actions.
 *
 * @param defaults - Default actions (from generator)
 * @param customs - Custom actions (from entity schema)
 * @returns Merged action array
 */
function mergeActions(defaults, customs = []) {
    return mergeButtons(defaults, [...customs]); // Spread to handle both readonly and mutable
}
/**
 * Merge field-level visibility/enablement/helpText/placeholder into base properties.
 *
 * @param baseProperties - Base properties from schema
 * @param fieldOverrides - Field overrides from formConfig.fields
 * @returns Properties with overrides merged
 */
function mergeFieldVisibility(baseProperties, fieldOverrides = []) {
    const overrideMap = new Map([...fieldOverrides].map(f => [f.name, f]));
    // Validation: Warn if field override references non-existent field
    fieldOverrides.forEach(override => {
        if (!baseProperties.some(p => p.name === override.name)) {
            logging_1.DefaultLogger.warn(`Field override "${override.name}" not found in schema properties. This override will be ignored.`);
        }
    });
    return baseProperties.map(prop => {
        const override = overrideMap.get(prop.name);
        if (!override)
            return prop;
        return {
            ...prop,
            ...(override.visibility !== undefined && { visibility: override.visibility }),
            ...(override.enablement !== undefined && { enablement: override.enablement }),
            ...(override.helpText !== undefined && { helpText: override.helpText }),
            ...(override.placeholder !== undefined && { placeholder: override.placeholder })
        };
    });
}
/**
 * Merge column-level visibility/width/fixed into base properties.
 *
 * @param baseProperties - Base properties from schema
 * @param columnOverrides - Column overrides from tableConfig.columns
 * @returns Properties with column overrides merged
 */
function mergeColumnVisibility(baseProperties, columnOverrides = []) {
    const overrideMap = new Map([...columnOverrides].map(c => [c.field, c]));
    // Validation: Warn if column override references non-existent column
    columnOverrides.forEach(override => {
        if (!baseProperties.some(p => p.name === override.field)) {
            logging_1.DefaultLogger.warn(`Column override "${override.field}" not found in schema properties. This override will be ignored.`);
        }
    });
    return baseProperties.map(prop => {
        const override = overrideMap.get(prop.name);
        if (!override)
            return prop;
        return {
            ...prop,
            ...(override.visibility !== undefined && { visibility: override.visibility }),
            ...(override.width !== undefined && { width: override.width }),
            ...(override.fixed !== undefined && { fixed: override.fixed })
        };
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBa0NBLDREQWdCQztBQUVELG9GQWdPQztBQUVELHNGQWtCQztBQUVELDBFQUlDO0FBRUQsMEVBSUM7QUFFRCwwRUFJQztBQVNELHNFQW9GQztBQWtCRCxvQ0F3QkM7QUFVRCxvQ0FLQztBQVNELG9EQXdDQztBQVNELHNEQXFDQztBQS9pQkQseUNBUXNCO0FBRXRCLDJDQUE4QztBQUM5Qyx1Q0FBeUM7QUFLekM7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsU0FBZ0Isd0JBQXdCLENBQ3BDLFVBQWtCLEVBQ2xCLE9BQWUsRUFDZixhQUFzQztJQUV0QyxzREFBc0Q7SUFDdEQsTUFBTSxjQUFjLEdBQUcsYUFBYSxFQUFFLGVBQWUsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDO0lBQ2hFLE1BQU0sV0FBVyxHQUFHLGNBQWMsRUFBRSxnQkFBZ0IsSUFBSSxJQUFBLGtCQUFVLEVBQUMsVUFBVSxDQUFDLENBQUM7SUFFL0UsT0FBTztRQUNILHlGQUF5RjtRQUN6RixtREFBbUQ7UUFDbkQsUUFBUSxFQUFFLEdBQUcsV0FBVyxNQUFNLE9BQU8sR0FBRyxFQUFHLHlCQUF5QjtRQUNwRSxRQUFRLEVBQUUsUUFBUSxXQUFXLEVBQUUsRUFBWSxvQkFBb0I7UUFDL0QsZUFBZSxFQUFFLEdBQUcsV0FBVyxVQUFVLENBQUUsdUJBQXVCO0tBQ3JFLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBZ0Isb0NBQW9DLENBQ2hELFFBQTRCLEVBQzVCLElBQW9DLEVBQ3BDLGFBQXFDO0lBRXJDLE1BQU0sU0FBUyxHQUFRO1FBQ25CLEdBQUcsUUFBUTtRQUNYLEtBQUssRUFBRSxRQUFRLENBQUMsSUFBSTtRQUNwQixNQUFNLEVBQUUsUUFBUSxDQUFDLEVBQUU7UUFDbkIsU0FBUyxFQUFFLFFBQVEs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U0FBUyxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUM5RCxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssS0FBSyxTQUFTLElBQUksRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1NBQ2pFLENBQUM7SUFDTixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBcbiAgICBCYXNlRW50aXR5U2VydmljZSwgXG4gICAgRmllbGRNZXRhZGF0YSwgXG4gICAgVElPU2NoZW1hQXR0cmlidXRlLCBcbiAgICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBFbnRpdHlBdHRyaWJ1dGUsXG4gICAgSVJlbGF0aW9uRmllbGRDb25maWdcbn0gZnJvbSBcIi4uLy4uL2VudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBJRW50aXR5UGFnZUFjdGlvbiB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyIH0gZnJvbSBcIi4uLy4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IHBhc2NhbENhc2UgfSBmcm9tIFwiLi4vLi4vdXRpbHNcIjtcbmltcG9ydCB7IG1ha2VDcmVhdGVFbnRpdHlGb3JtQ29uZmlnIH0gZnJvbSBcIi4vY3JlYXRlLWVudGl0eVwiO1xuaW1wb3J0IHsgbWFrZVZpZXdFbnRpdHlMaXN0Q29uZmlnIH0gZnJvbSBcIi4vbGlzdC1lbnRpdHlcIjtcbmltcG9ydCB7IG1ha2VWaWV3RW50aXR5RGV0YWlsQ29uZmlnIH0gZnJvbSBcIi4vdmlldy1lbnRpdHlcIjtcblxuLyoqXG4gKiBHZW5lcmF0ZSBzbWFydCBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciByZWxhdGlvbiBkaXNwbGF5IHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGUuXG4gKiBVc2VzIGVudGl0eSBtZXRhZGF0YSAoaWNvbiwgZW50aXR5TmFtZVBsdXJhbCkgdG8gY3JlYXRlIHVzZXItZnJpZW5kbHkgZmFsbGJhY2sgdGV4dC5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBSZWxhdGVkIGVudGl0eSBuYW1lIChlLmcuLCAndGVhbScpXG4gKiBAcGFyYW0gaWRGaWVsZCAtIElEIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSB0byBnZXQgbWV0YWRhdGEgZnJvbVxuICogQHJldHVybnMgRmFsbGJhY2sgY29uZmlndXJhdGlvbiB3aXRoIHRlbXBsYXRlLCBsaW5rVGV4dCwgYW5kIG1vZGFsQnV0dG9uVGV4dFxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gRm9yIGEgdGVhbSByZWxhdGlvblxuICogZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKCd0ZWFtJywgJ3RlYW1JZCcsIHRlYW1TZXJ2aWNlKVxuICogLy8gUmV0dXJuczoge1xuICogLy8gICB0ZW1wbGF0ZTogJ1RlYW06IHt0ZWFtSWR9JyxcbiAqIC8vICAgbGlua1RleHQ6ICdWaWV3IFRlYW0nLFxuICogLy8gICBtb2RhbEJ1dHRvblRleHQ6ICdUZWFtIERldGFpbHMnXG4gKiAvLyB9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGlkRmllbGQ6IHN0cmluZyxcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKTogTm9uTnVsbGFibGU8SVJlbGF0aW9uRmllbGRDb25maWdbJ2Rpc3BsYXlDb25maWcnXT5bJ2ZhbGxiYWNrJ10ge1xuICAgIC8vIFRyeSB0byBnZXQgZW50aXR5IG1ldGFkYXRhIGZvciBiZXR0ZXIgZmFsbGJhY2sgdGV4dFxuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICBjb25zdCBkaXNwbGF5TmFtZSA9IGVudGl0eU1ldGFkYXRhPy5lbnRpdHlOYW1lUGx1cmFsIHx8IHBhc2NhbENhc2UoZW50aXR5TmFtZSk7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgICAgLy8gQmFja2VuZCBwcmUtZ2VuZXJhdGVzIGZhbGxiYWNrIHRlbXBsYXRlIChpbnRlbnRpb25hbGx5IHN0cmluZy1vbmx5LCBub3QgVGVtcGxhdGUgdHlwZSlcbiAgICAgICAgLy8gRnJvbnRlbmQgd2lsbCB1c2UgdGhpcyB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgIHRlbXBsYXRlOiBgJHtkaXNwbGF5TmFtZX06IHske2lkRmllbGR9fWAsICAvLyBlLmcuLCBcIlRlYW06IHt0ZWFtSWR9XCJcbiAgICAgICAgbGlua1RleHQ6IGBWaWV3ICR7ZGlzcGxheU5hbWV9YCwgICAgICAgICAgIC8vIGUuZy4sIFwiVmlldyBUZWFtXCJcbiAgICAgICAgbW9kYWxCdXR0b25UZXh0OiBgJHtkaXNwbGF5TmFtZX0gRGV0YWlsc2AgIC8vIGUuZy4sIFwiVGVhbSBEZXRhaWxzXCJcbiAgICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKFxuICAgIHRoaXNQcm9wOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbikge1xuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi50aGlzUHJvcCxcbiAgICAgICAgbGFiZWw6IHRoaXNQcm9wLm5hbWUsXG4gICAgICAgIGNvbHVtbjogdGhpc1Byb3AuaWQsXG4gICAgICAgIGZpZWxkVHlwZTogdGhpc1Byb3AuZmllbGRUeXBlIHx8ICd0ZXh0JywgIC8vIGZpZWxkVHlwZSBzaG91bGQgYWxyZWFkeSBiZSBpbmZlcnJlZCBpbiBiYXNlLXNlcnZpY2VcbiAgICAgICAgaGlkZGVuOiB0aGlzUHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXRoaXNQcm9wLmlzVmlzaWJsZVxuICAgIH07XG5cbiAgICAvLyBIYW5kbGUgYWRkTmV3T3B0aW9uIChPTEQgLSBkZXByZWNhdGVkLCBnZW5lcmF0ZXMgZW1iZWRkZWQgY29uZmlnKSBvciBhZGROZXdPcHRpb25Db25maWcgKE5FVyAtIGp1c3QgcGFzcyB0aHJvdWdoIHJlZmVyZW5jZSlcbiAgICBpZiAoaXNTZWxlY3RGaWVsZE1ldGFkYXRhKHRoaXNQcm9wKSAmJiBbICdjcmVhdGUnLCAndXBkYXRlJyBdLmluY2x1ZGVzKHR5cGUpKSB7XG4gICAgICAgIGNvbnN0IHNlbGVjdEZpZWxkID0gdGhpc1Byb3AgYXMgU2VsZWN0RmllbGRNZXRhZGF0YTtcbiAgICAgICAgXG4gICAgICAgIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWcpIHtcbiAgICAgICAgICAgIC8vIE5FVyBXQVk6IFVzZXIgcHJvdmlkZWQgYWRkTmV3T3B0aW9uQ29uZmlnIHJlZmVyZW5jZSAtIGp1c3QgcGFzcyBpdCB0aHJvdWdoXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWc7XG4gICAgICAgICAgICBcbiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb24pIHtcbiAgICAgICAgICAgIC8vIE9MRCBXQVkgKERFUFJFQ0FURUQpOiBUcmFuc2Zvcm0gYWRkTmV3T3B0aW9uIHRvIGFkZE5ld09wdGlvbkNvbmZpZyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCBvdmVycmlkZUNvbmZpZyB9ID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uO1xuXG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZSAmJiBlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnY3JlYXRlJyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IG92ZXJyaWRlQ29uZmlnIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogdW5kZWZpbmVkLCAgLy8gU3RheSBpbiBtb2RhbCBhZnRlciBjcmVhdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgZm9ybUJ1dHRvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQWRkXCIsIGFjdGlvbjogXCJzdWJtaXRcIiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJDYW5jZWxcIiwgYWN0aW9uOiBcImNhbmNlbFwiIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIHJlbGF0aW9uIGZpZWxkcyAoREFUQSBMQVlFUiArIFVJIExBWUVSKVxuICAgIGlmICh0aGlzUHJvcC5yZWxhdGlvbiAmJiB0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICBjb25zdCByZWxhdGlvbiA9IHRoaXNQcm9wLnJlbGF0aW9uO1xuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIHR5cGU6IHJlbGF0aW9uVHlwZSwgaWRlbnRpZmllcnMgfSA9IHJlbGF0aW9uO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlc29sdmUgaWRlbnRpZmllcnMgKGNvdWxkIGJlIGRpcmVjdCB2YWx1ZSBvciBsYXp5IGZ1bmN0aW9uKVxuICAgICAgICBjb25zdCByZXNvbHZlZElkZW50aWZpZXJzID0gdHlwZW9mIGlkZW50aWZpZXJzID09PSAnZnVuY3Rpb24nID8gaWRlbnRpZmllcnMoKSA6IGlkZW50aWZpZXJzO1xuXG4gICAgICAgIC8vIFNhZmV0eSBjaGVjayBmb3IgYXJyYXkgaWRlbnRpZmllcnNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIGlmIChyZXNvbHZlZElkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBFbXB0eSBpZGVudGlmaWVycyBhcnJheSBmb3IgcmVsYXRpb24gWyR7ZW50aXR5TmFtZX1dYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBib3RoIHNpbmdsZSBhbmQgbXVsdGlwbGUgaWRlbnRpZmllcnMgZm9yIGNvbXBvc2l0ZSBrZXlzXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5ncyA9IEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykgXG4gICAgICAgICAgICA/IHJlc29sdmVkSWRlbnRpZmllcnMubWFwKGlkID0+ICh7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcoaWQuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhpZC50YXJnZXQpXG4gICAgICAgICAgICAgIH0pKVxuICAgICAgICAgICAgOiBbe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnRhcmdldClcbiAgICAgICAgICAgICAgfV07XG5cbiAgICAgICAgLy8gRm9yIHJvdXRlIHBhdHRlcm4gYW5kIGRlZmF1bHQgZmlsdGVycywgdXNlIHRoZSBmaXJzdCBpZGVudGlmaWVyXG4gICAgICAgIC8vIChtb3N0IGVudGl0aWVzIGhhdmUgc2luZ2xlIGlkZW50aWZpZXI7IGNvbXBvc2l0ZSBrZXlzIG5lZWQgZXhwbGljaXQgcm91dGVQYXR0ZXJuKVxuICAgICAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1swXTtcblxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBVSSBjb25maWcgaW4gcmVsYXRpb25Db25maWcgKG9wdGlvbmFsIG92ZXJyaWRlKVxuICAgICAgICBjb25zdCB1c2VyUmVsYXRpb25Db25maWcgPSB0aGlzUHJvcC5yZWxhdGlvbkNvbmZpZyBhcyBJUmVsYXRpb25GaWVsZENvbmZpZyB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZSBmb3IgbWV0YWRhdGEgKGljb24sIGV0Yy4pXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpIFxuICAgICAgICAgICAgPyBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSlcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICBcbiAgICAgICAgLy8gR2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgaWNvbiBhbmQgZmFsbGJhY2sgZ2VuZXJhdGlvblxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5TWV0YWRhdGEgPSByZWxhdGVkRW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICAgICAgY29uc3QgZGVmYXVsdEljb24gPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5pY29uO1xuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW9uZScpKSB7XG4gICAgICAgICAgICAvLyBUTy1PTkU6IFNob3cgdmFsdWUgYXMgbGluayArIG1vZGFsIGljb25cbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL3ZpZXcte2VudGl0eX0vOnRhcmdldElkXG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVybiBcbiAgICAgICAgICAgICAgICB8fCBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9Lzoke3ByaW1hcnlJZGVudGlmaWVyLnRhcmdldH1gO1xuXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxIFxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1swXSAgLy8gU2luZ2xlOiByZXR1cm4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIDogaWRlbnRpZmllck1hcHBpbmdzLCAgICAgLy8gTXVsdGlwbGU6IHJldHVybiBhcnJheVxuICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICd2aWV3JyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHt9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtb2RhbFdpZHRoOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsV2lkdGgsXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlciBjYW4gb3ZlcnJpZGUgd2l0aCBjdXN0b20gdGVtcGxhdGVcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIFNtYXJ0IGZhbGxiYWNrIHByZS1nZW5lcmF0ZWQgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2s6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uZmFsbGJhY2sgfHwgZmFsbGJhY2tDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIC8vIEljb24gZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgdXNlciBvdmVycmlkZVxuICAgICAgICAgICAgICAgICAgICBpY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/Lmljb24gfHwgZGVmYXVsdEljb24gfHwgJ0V5ZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd01vZGFsSWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TW9kYWxJY29uICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd0xpbmsgIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3JlbGF0aW9uQ29uZmlnJyBdID0gZ2VuZXJhdGVkUmVsYXRpb25Db25maWc7XG5cbiAgICAgICAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHk6IEtlZXAgaXNMaW5rIGFuZCBsaW5rQ29uZmlnXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdpc0xpbmsnIF0gPSB0cnVlO1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnbGlua0NvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVyblxuICAgICAgICAgICAgfTtcblxuICAgICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uVHlwZS5lbmRzV2l0aCgndG8tbWFueScpKSB7XG4gICAgICAgICAgICAvLyBUTy1NQU5ZOiBTaG93IGNvdW50ICsgbW9kYWwgaWNvbiAob3BlbnMgZmlsdGVyZWQgbGlzdClcbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL2xpc3Qte2VudGl0eX1cbiAgICAgICAgICAgIGNvbnN0IHJvdXRlUGF0dGVybiA9IHVzZXJSZWxhdGlvbkNvbmZpZz8ucm91dGVQYXR0ZXJuXG4gICAgICAgICAgICAgICAgfHwgYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWA7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGRlZmF1bHQgZmlsdGVycyB0byBzaG93IG9ubHkgcmVsYXRlZCBpdGVtc1xuICAgICAgICAgICAgLy8gRm9yIGV4YW1wbGUsIGlmIHdlJ3JlIHZpZXdpbmcgYSBUZWFtIGFuZCB0aGlzIGZpZWxkIHNob3dzIEdhbWVzLFxuICAgICAgICAgICAgLy8gd2Ugd2FudCB0byBmaWx0ZXIgZ2FtZXMgd2hlcmUgdGVhbUlkID0gY3VycmVudCB0ZWFtJ3MgSURcbiAgICAgICAgICAgIC8vIEZvciBjb21wb3NpdGUga2V5cywgYWRkIGFsbCBpZGVudGlmaWVycyBhcyBmaWx0ZXJzXG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0RmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLmZvckVhY2gobWFwcGluZyA9PiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnNbbWFwcGluZy50YXJnZXRdID0gYDoke21hcHBpbmcuc291cmNlfWA7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgdG8tbWFueSAoc2hvd3MgY291bnQpXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxIFxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1swXSAgLy8gU2luZ2xlOiByZXR1cm4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIDogaWRlbnRpZmllck1hcHBpbmdzLCAgICAgLy8gTXVsdGlwbGU6IHJldHVybiBhcnJheVxuICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiBkZWZhdWx0RmlsdGVyc1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtb2RhbFdpZHRoOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsV2lkdGgsXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlciBjYW4gb3ZlcnJpZGUgd2l0aCBjdXN0b20gdGVtcGxhdGVcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIFNtYXJ0IGZhbGxiYWNrIHByZS1nZW5lcmF0ZWQgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2s6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uZmFsbGJhY2sgfHwgZmFsbGJhY2tDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIC8vIEljb24gZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgdXNlciBvdmVycmlkZVxuICAgICAgICAgICAgICAgICAgICBpY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/Lmljb24gfHwgZGVmYXVsdEljb24gfHwgJ1Vub3JkZXJlZExpc3RPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSB0cnVlLCAvLyBEZWZhdWx0IGZhbHNlIGZvciB0by1tYW55XG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhbnkgY3VzdG9tIGFjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hY3Rpb25zXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgLy8gSWYgdXNlciBwcm92aWRlZCBjdXN0b20gbW9kYWxDb25maWdSZWYsIG1lcmdlIGRlZmF1bHQgZmlsdGVycyB3aXRoIHRoZWlyIG92ZXJyaWRlc1xuICAgICAgICAgICAgaWYgKHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWY/Lm92ZXJyaWRlQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVkUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYhLm92ZXJyaWRlQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi51c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5kZWZhdWx0RmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLih1c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcuZGVmYXVsdEZpbHRlcnMgfHwge30pXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuICAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBuZXN0ZWQgc3RydWN0dXJlcyAobWFwIGFuZCBsaXN0IHR5cGVzKVxuICAgIGlmICh0aGlzUHJvcC50eXBlID09PSAnbWFwJyAmJiB0aGlzUHJvcC5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKHRoaXNQcm9wLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpO1xuICAgIH0gZWxzZSBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIC8vIEZvciBsaXN0IHR5cGVzLCBjaGVjayBpZiBpdGVtcyBhcmUgbWFwcyAobmVzdGVkIHN0cnVjdHVyZXMpXG4gICAgICAgIC8vIE5vdGU6IGl0ZW1zIHByb3BlcnR5IGV4aXN0cyBvbiBsaXN0LXR5cGUgYXR0cmlidXRlcyBidXQgbm90IGluIGJhc2UgRW50aXR5QXR0cmlidXRlIHR5cGVcbiAgICAgICAgY29uc3QgZXh0ZW5kZWRQcm9wID0gdGhpc1Byb3AgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyBpdGVtcz86IHsgdHlwZTogc3RyaW5nOyBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10gfSB9O1xuICAgICAgICBpZiAoZXh0ZW5kZWRQcm9wLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAgICAgLi4uZm9ybWF0dGVkWyAnaXRlbXMnIF0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKSB7XG5cbiAgICBpZiAodHlwZSA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICd1cGRhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG4gICAgdGhyb3cgKGBJbnZhbGlkIHR5cGUgWyR7dHlwZX1dIHByb3ZpZGVkIHRvIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWxgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzQ3JlYXRhYmxlJykgfHwgcHJvcC5pc0NyZWF0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2NyZWF0ZScsIGVudGl0eVNlcnZpY2UpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzRWRpdGFibGUnKSB8fCBwcm9wLmlzRWRpdGFibGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICd1cGRhdGUnLCBlbnRpdHlTZXJ2aWNlKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+KSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSB8fCBwcm9wLmlzVmlzaWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2RldGFpbCcsIGVudGl0eVNlcnZpY2UpKTtcbn1cblxuZXhwb3J0IHR5cGUgTGlzdGluZ1Byb3BDb25maWcgPSBQaWNrPEZpZWxkTWV0YWRhdGEsICdmaWVsZFR5cGUnIHwgJ3BsYWNlaG9sZGVyJyB8ICdoZWxwVGV4dCcgfCAnZmlsdGVyQ29uZmlnJz4gJiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRhdGFJbmRleDogc3RyaW5nLFxuICAgIGhpZGRlbj86IGJvb2xlYW4sXG4gICAgYWN0aW9ucz86IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yTGlzdChlbnRpdHlOYW1lOiBzdHJpbmcsIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCB7XG4gICAgQ1JVREFwaVBhdGgsXG4gICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgY3VzdG9tUm93QWN0aW9uc1xufToge1xuICAgIENSVURBcGlQYXRoPzogc3RyaW5nLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU/OiBib29sZWFuLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU/OiBib29sZWFuLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWw/OiBib29sZWFuLFxuICAgIGN1c3RvbVJvd0FjdGlvbnM/OiBSZWFkb25seUFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiB8IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbn0pIHtcblxuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBlbnRpdHlOYW1lUGFzY2FsQ2FzZSA9IHBhc2NhbENhc2UoZW50aXR5TmFtZSk7XG5cbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiBwcm9wLmlzTGlzdGFibGUpXG4gICAgICAgIC5tYXAocHJvcCA9PiB7XG4gICAgICAgICAgICBjb25zdCBwcm9wQ29uZmlnOiBMaXN0aW5nUHJvcENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgICAgIGRhdGFJbmRleDogYCR7cHJvcC5pZH1gLFxuICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogcHJvcC5maWVsZFR5cGUgfHwgJ3RleHQnLCAgLy8gZmllbGRUeXBlIHNob3VsZCBhbHJlYWR5IGJlIGluZmVycmVkIGluIGJhc2Utc2VydmljZVxuICAgICAgICAgICAgICAgIGhpZGRlbjogcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXByb3AuaXNWaXNpYmxlXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAocHJvcC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IHJvdyBhY3Rpb25zIHdpdGggSURzXG4gICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdEFjdGlvbnM6IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiA9IFtdO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGV0YWlsKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYFZpZXcgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC92aWV3LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYEVkaXQgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC9lZGl0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGVsZXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYERlbGV0ZSB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsVHlwZTogJ2NvbmZpcm0nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogYERlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfT9gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBgQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIGRlbGV0ZSB0aGlzICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9PyBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgdW5kb25lLmBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IGBERUxFVEVgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZUtleTogZW50aXR5TmFtZUxvd2VyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlVcmw6IGAke0NSVURBcGlQYXRoID8gQ1JVREFwaVBhdGggOiAnJ30vJHtlbnRpdHlOYW1lTG93ZXJ9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NNZXNzYWdlOiBgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0gZGVsZXRlZCBzdWNjZXNzZnVsbHlgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZTogYEZhaWxlZCB0byBkZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gTWVyZ2UgY3VzdG9tIHJvdyBhY3Rpb25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICBwcm9wQ29uZmlnLmFjdGlvbnMgPSBjdXN0b21Sb3dBY3Rpb25zIFxuICAgICAgICAgICAgICAgICAgICA/IG1lcmdlQWN0aW9ucyhkZWZhdWx0QWN0aW9ucywgY3VzdG9tUm93QWN0aW9ucylcbiAgICAgICAgICAgICAgICAgICAgOiBkZWZhdWx0QWN0aW9ucztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHByb3BDb25maWc7XG4gICAgICAgIH0pO1xufVxuXG4vKipcbiAqIE1FUkdFIFVUSUxJVFkgRlVOQ1RJT05TXG4gKiBcbiAqIFRoZXNlIGZ1bmN0aW9ucyBpbXBsZW1lbnQgdGhlIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUgcGF0dGVybjpcbiAqIC0gRGVmYXVsdHMgaGF2ZSBzdGFuZGFyZCBpZGVudGlmaWVycyAoZS5nLiwgJ3ZpZXcnLCAnZWRpdCcsICdkZWxldGUnKVxuICogLSBDdXN0b20gY29uZmlncyB3aXRoIHNhbWUgaWRlbnRpZmllciBvdmVycmlkZSB0aGUgZGVmYXVsdFxuICogLSBOZXcgaWRlbnRpZmllcnMgZ2V0IGFkZGVkIHRvIHRoZSByZXN1bHRcbiAqL1xuXG4vKipcbiAqIE1lcmdlIGRlZmF1bHQgYnV0dG9ucyB3aXRoIGN1c3RvbSBidXR0b25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUuXG4gKiBcbiAqIEBwYXJhbSBkZWZhdWx0cyAtIERlZmF1bHQgYnV0dG9ucyAoZnJvbSBnZW5lcmF0b3IpXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBidXR0b25zIChmcm9tIGVudGl0eSBzY2hlbWEpXG4gKiBAcmV0dXJucyBNZXJnZWQgYnV0dG9uIGFycmF5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUJ1dHRvbnM8VCBleHRlbmRzIHsgaWQ/OiBzdHJpbmcgfT4oXG4gICAgZGVmYXVsdHM6IEFycmF5PFQ+LFxuICAgIGN1c3RvbXM6IFJlYWRvbmx5QXJyYXk8VD4gfCBBcnJheTxUPiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3QgY3VzdG9tc0FycmF5ID0gWy4uLmN1c3RvbXNdOyAgLy8gQ29udmVydCB0byBtdXRhYmxlIGFycmF5XG4gICAgY29uc3QgY3VzdG9tTWFwID0gbmV3IE1hcChcbiAgICAgICAgY3VzdG9tc0FycmF5LmZpbHRlcihjID0+IGMuaWQpLm1hcChjID0+IFtjLmlkLCBjXSlcbiAgICApO1xuICAgIFxuICAgIC8vIFN0YXJ0IHdpdGggZGVmYXVsdHMsIHJlcGxhY2UgaWYgY3VzdG9tIGhhcyBzYW1lIGlkXG4gICAgY29uc3QgbWVyZ2VkID0gZGVmYXVsdHMubWFwKGRlZmF1bHRCdG4gPT4gXG4gICAgICAgIGRlZmF1bHRCdG4uaWQgJiYgY3VzdG9tTWFwLmhhcyhkZWZhdWx0QnRuLmlkKVxuICAgICAgICAgICAgPyBjdXN0b21NYXAuZ2V0KGRlZmF1bHRCdG4uaWQpISAgLy8gT3ZlcnJpZGVcbiAgICAgICAgICAgIDogZGVmYXVsdEJ0blxuICAgICk7XG4gICAgXG4gICAgLy8gQWRkIGN1c3RvbSBidXR0b25zIHRoYXQgZG9uJ3Qgb3ZlcnJpZGUgZGVmYXVsdHNcbiAgICBjdXN0b21zQXJyYXkuZm9yRWFjaChjdXN0b21CdG4gPT4ge1xuICAgICAgICBpZiAoIWN1c3RvbUJ0bi5pZCB8fCAhZGVmYXVsdHMuc29tZShkID0+IGQuaWQgPT09IGN1c3RvbUJ0bi5pZCkpIHtcbiAgICAgICAgICAgIG1lcmdlZC5wdXNoKGN1c3RvbUJ0bik7ICAvLyBBZGQgbmV3XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gbWVyZ2VkO1xufVxuXG4vKipcbiAqIE1lcmdlIGRlZmF1bHQgYWN0aW9ucyB3aXRoIGN1c3RvbSBhY3Rpb25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUuXG4gKiBTYW1lIGxvZ2ljIGFzIG1lcmdlQnV0dG9ucyBidXQgc2VtYW50aWNhbGx5IG5hbWVkIGZvciBhY3Rpb25zLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGFjdGlvbnMgKGZyb20gZ2VuZXJhdG9yKVxuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYWN0aW9ucyAoZnJvbSBlbnRpdHkgc2NoZW1hKVxuICogQHJldHVybnMgTWVyZ2VkIGFjdGlvbiBhcnJheVxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VBY3Rpb25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIHJldHVybiBtZXJnZUJ1dHRvbnMoZGVmYXVsdHMsIFsuLi5jdXN0b21zXSk7ICAvLyBTcHJlYWQgdG8gaGFuZGxlIGJvdGggcmVhZG9ubHkgYW5kIG11dGFibGVcbn1cblxuLyoqXG4gKiBNZXJnZSBmaWVsZC1sZXZlbCB2aXNpYmlsaXR5L2VuYWJsZW1lbnQvaGVscFRleHQvcGxhY2Vob2xkZXIgaW50byBiYXNlIHByb3BlcnRpZXMuXG4gKiBcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgcHJvcGVydGllcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGZpZWxkT3ZlcnJpZGVzIC0gRmllbGQgb3ZlcnJpZGVzIGZyb20gZm9ybUNvbmZpZy5maWVsZHNcbiAqIEByZXR1cm5zIFByb3BlcnRpZXMgd2l0aCBvdmVycmlkZXMgbWVyZ2VkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZpZWxkVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGZpZWxkT3ZlcnJpZGVzOiBSZWFkb25seUFycmF5PHtcbiAgICAgICAgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuICAgICAgICByZWFkb25seSB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICByZWFkb25seSBlbmFibGVtZW50PzogYW55O1xuICAgICAgICByZWFkb25seSBoZWxwVGV4dD86IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgcGxhY2Vob2xkZXI/OiBzdHJpbmc7XG4gICAgfT4gfCBBcnJheTx7XG4gICAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgICAgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIFsuLi5maWVsZE92ZXJyaWRlc10ubWFwKGYgPT4gW2YubmFtZSwgZl0pXG4gICAgKTtcbiAgICBcbiAgICAvLyBWYWxpZGF0aW9uOiBXYXJuIGlmIGZpZWxkIG92ZXJyaWRlIHJlZmVyZW5jZXMgbm9uLWV4aXN0ZW50IGZpZWxkXG4gICAgZmllbGRPdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghYmFzZVByb3BlcnRpZXMuc29tZShwID0+IHAubmFtZSA9PT0gb3ZlcnJpZGUubmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgRmllbGQgb3ZlcnJpZGUgXCIke292ZXJyaWRlLm5hbWV9XCIgbm90IGZvdW5kIGluIHNjaGVtYSBwcm9wZXJ0aWVzLiBUaGlzIG92ZXJyaWRlIHdpbGwgYmUgaWdub3JlZC5gKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KHByb3AubmFtZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIW92ZXJyaWRlKSByZXR1cm4gcHJvcDtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZW5hYmxlbWVudCAhPT0gdW5kZWZpbmVkICYmIHsgZW5hYmxlbWVudDogb3ZlcnJpZGUuZW5hYmxlbWVudCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5oZWxwVGV4dCAhPT0gdW5kZWZpbmVkICYmIHsgaGVscFRleHQ6IG92ZXJyaWRlLmhlbHBUZXh0IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnBsYWNlaG9sZGVyICE9PSB1bmRlZmluZWQgJiYgeyBwbGFjZWhvbGRlcjogb3ZlcnJpZGUucGxhY2Vob2xkZXIgfSlcbiAgICAgICAgfTtcbiAgICB9KTtcbn1cblxuLyoqXG4gKiBNZXJnZSBjb2x1bW4tbGV2ZWwgdmlzaWJpbGl0eS93aWR0aC9maXhlZCBpbnRvIGJhc2UgcHJvcGVydGllcy5cbiAqIFxuICogQHBhcmFtIGJhc2VQcm9wZXJ0aWVzIC0gQmFzZSBwcm9wZXJ0aWVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIG92ZXJyaWRlcyBmcm9tIHRhYmxlQ29uZmlnLmNvbHVtbnNcbiAqIEByZXR1cm5zIFByb3BlcnRpZXMgd2l0aCBjb2x1bW4gb3ZlcnJpZGVzIG1lcmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VDb2x1bW5WaXNpYmlsaXR5PFQgZXh0ZW5kcyB7IG5hbWU6IHN0cmluZyB9PihcbiAgICBiYXNlUHJvcGVydGllczogQXJyYXk8VD4sXG4gICAgY29sdW1uT3ZlcnJpZGVzOiBSZWFkb25seUFycmF5PHtcbiAgICAgICAgcmVhZG9ubHkgZmllbGQ6IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgd2lkdGg/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgICAgIHJlYWRvbmx5IGZpeGVkPzogJ2xlZnQnIHwgJ3JpZ2h0JztcbiAgICB9PiB8IEFycmF5PHtcbiAgICAgICAgZmllbGQ6IHN0cmluZztcbiAgICAgICAgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgd2lkdGg/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgICAgIGZpeGVkPzogJ2xlZnQnIHwgJ3JpZ2h0JztcbiAgICB9PiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBbLi4uY29sdW1uT3ZlcnJpZGVzXS5tYXAoYyA9PiBbYy5maWVsZCwgY10pXG4gICAgKTtcbiAgICBcbiAgICAvLyBWYWxpZGF0aW9uOiBXYXJuIGlmIGNvbHVtbiBvdmVycmlkZSByZWZlcmVuY2VzIG5vbi1leGlzdGVudCBjb2x1bW5cbiAgICBjb2x1bW5PdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghYmFzZVByb3BlcnRpZXMuc29tZShwID0+IHAubmFtZSA9PT0gb3ZlcnJpZGUuZmllbGQpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYENvbHVtbiBvdmVycmlkZSBcIiR7b3ZlcnJpZGUuZmllbGR9XCIgbm90IGZvdW5kIGluIHNjaGVtYSBwcm9wZXJ0aWVzLiBUaGlzIG92ZXJyaWRlIHdpbGwgYmUgaWdub3JlZC5gKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KHByb3AubmFtZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIW92ZXJyaWRlKSByZXR1cm4gcHJvcDtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUud2lkdGggIT09IHVuZGVmaW5lZCAmJiB7IHdpZHRoOiBvdmVycmlkZS53aWR0aCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5maXhlZCAhPT0gdW5kZWZpbmVkICYmIHsgZml4ZWQ6IG92ZXJyaWRlLmZpeGVkIH0pXG4gICAgICAgIH07XG4gICAgfSk7XG59XG4iXX0=