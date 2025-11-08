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
 * Detect if there's a duplicated relation field (e.g., 'teamName' for 'teamId' relation).
 * Returns a template using the duplicated field if found.
 *
 * Common patterns:
 * - teamId → teamName → template: '{teamName}'
 * - userId → userName → template: '{userName}'
 * - gameId → gameName → template: '{gameName}'
 *
 * @param allProperties - All properties in the parent entity
 * @param relationFieldId - The relation field name (e.g., 'teamId')
 * @param relatedEntityName - Related entity name (e.g., 'team')
 * @returns Template string if duplicated field found, undefined otherwise
 */
function detectDuplicatedRelationFieldTemplate(allProperties, relationFieldId, relatedEntityName) {
    const entityNameLower = relatedEntityName.toLowerCase();
    // Try common patterns: {entity}Name, {entity}Title, {relatedField}Name
    const commonSuffixes = ['Name', 'Title', 'Label'];
    for (const suffix of commonSuffixes) {
        // Pattern 1: {entityName}{suffix} (e.g., teamName for teamId relation to 'team')
        const pattern1 = `${entityNameLower}${suffix}`;
        const found1 = allProperties.find(p => p.id?.toLowerCase() === pattern1);
        if (found1)
            return `{${found1.id}}`;
        // Pattern 2: Replace 'Id' with {suffix} (e.g., teamName for teamId)
        if (relationFieldId.toLowerCase().endsWith('id')) {
            const baseName = relationFieldId.substring(0, relationFieldId.length - 2);
            const pattern2 = `${baseName}${suffix}`;
            const found2 = allProperties.find(p => p.id?.toLowerCase() === pattern2.toLowerCase());
            if (found2)
                return `{${found2.id}}`;
        }
    }
    return undefined;
}
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
function formatEntityAttributeForFormOrDetail(thisProp, type, entityService, allProperties // Optional: for detecting duplicated relation fields
) {
    const formatted = {
        ...thisProp,
        label: thisProp.name, // Respect custom label from entity attribute
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
            // Auto-detect duplicated relation field (e.g., teamName for teamId)
            const autoTemplate = allProperties
                ? detectDuplicatedRelationFieldTemplate(allProperties, thisProp.id, entityName)
                : undefined;
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
                    // Priority: User custom template > Auto-detected duplicated field > undefined (use fallback)
                    template: userRelationConfig?.displayConfig?.template || autoTemplate,
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
function formatEntityAttributesForList(entityName, properties, entityService, { CRUDApiPath, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, customRowActions }) {
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = (0, utils_1.pascalCase)(entityName);
    return properties
        .filter(prop => prop && prop.isListable)
        .map(prop => {
        // Use same formatting logic as details/forms (includes relationConfig generation)
        // Pass all properties so it can detect duplicated relation fields (e.g., teamName for teamId)
        const formatted = formatEntityAttributeForFormOrDetail(prop, 'detail', entityService, properties);
        // Override/add list-specific properties
        const propConfig = {
            ...formatted,
            name: formatted.label || formatted.name, // Ensure name is set for table column header
            dataIndex: `${prop.id}`,
            fieldType: formatted.fieldType || 'text',
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
            ...(override.fixed !== undefined && { fixed: override.fixed }),
            ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle })
        };
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBNEVBLDREQWdCQztBQUVELG9GQXNPQztBQUVELHNGQWtCQztBQUVELDBFQUlDO0FBRUQsMEVBSUM7QUFFRCwwRUFJQztBQWNELHNFQStGQztBQWtCRCxvQ0F3QkM7QUFVRCxvQ0FLQztBQVNELG9EQXdDQztBQVNELHNEQXdDQztBQWxuQkQseUNBUXNCO0FBRXRCLDJDQUE4QztBQUM5Qyx1Q0FBeUM7QUFLekM7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILFNBQVMscUNBQXFDLENBQzFDLGFBQW1DLEVBQ25DLGVBQXVCLEVBQ3ZCLGlCQUF5QjtJQUV6QixNQUFNLGVBQWUsR0FBRyxpQkFBaUIsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV4RCx1RUFBdUU7SUFDdkUsTUFBTSxjQUFjLEdBQUcsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBRWxELEtBQUssTUFBTSxNQUFNLElBQUksY0FBYyxFQUFFLENBQUM7UUFDbEMsaUZBQWlGO1FBQ2pGLE1BQU0sUUFBUSxHQUFHLEdBQUcsZUFBZSxHQUFHLE1BQU0sRUFBRSxDQUFDO1FBQy9DLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLFdBQVcsRUFBRSxLQUFLLFFBQVEsQ0FBQyxDQUFDO1FBQ3pFLElBQUksTUFBTTtZQUFFLE9BQU8sSUFBSSxNQUFNLENBQUMsRUFBRSxHQUFHLENBQUM7UUFFcEMsb0VBQW9FO1FBQ3BFLElBQUksZUFBZSxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQy9DLE1BQU0sUUFBUSxHQUFHLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxF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LENBQUMsSUFBSSxDQUFDLG9CQUFvQixRQUFRLENBQUMsS0FBSyxrRUFBa0UsQ0FBQyxDQUFDO1FBQzdILENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILE9BQU8sY0FBYyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUM3QixNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUU1QyxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFDO1FBRTNCLE9BQU87WUFDSCxHQUFHLElBQUk7WUFDUCxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzdFLEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDOUQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUM5RCxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO1NBQ2hGLENBQUM7SUFDTixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBcbiAgICBCYXNlRW50aXR5U2VydmljZSwgXG4gICAgRmllbGRNZXRhZGF0YSwgXG4gICAgVElPU2NoZW1hQXR0cmlidXRlLCBcbiAgICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBFbnRpdHlBdHRyaWJ1dGUsXG4gICAgSVJlbGF0aW9uRmllbGRDb25maWdcbn0gZnJvbSBcIi4uLy4uL2VudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBJRW50aXR5UGFnZUFjdGlvbiwgVGVtcGxhdGUgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBwYXNjYWxDYXNlIH0gZnJvbSBcIi4uLy4uL3V0aWxzXCI7XG5pbXBvcnQgeyBtYWtlQ3JlYXRlRW50aXR5Rm9ybUNvbmZpZyB9IGZyb20gXCIuL2NyZWF0ZS1lbnRpdHlcIjtcbmltcG9ydCB7IG1ha2VWaWV3RW50aXR5TGlzdENvbmZpZyB9IGZyb20gXCIuL2xpc3QtZW50aXR5XCI7XG5pbXBvcnQgeyBtYWtlVmlld0VudGl0eURldGFpbENvbmZpZyB9IGZyb20gXCIuL3ZpZXctZW50aXR5XCI7XG5cbi8qKlxuICogRGV0ZWN0IGlmIHRoZXJlJ3MgYSBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkIChlLmcuLCAndGVhbU5hbWUnIGZvciAndGVhbUlkJyByZWxhdGlvbikuXG4gKiBSZXR1cm5zIGEgdGVtcGxhdGUgdXNpbmcgdGhlIGR1cGxpY2F0ZWQgZmllbGQgaWYgZm91bmQuXG4gKiBcbiAqIENvbW1vbiBwYXR0ZXJuczpcbiAqIC0gdGVhbUlkIOKGkiB0ZWFtTmFtZSDihpIgdGVtcGxhdGU6ICd7dGVhbU5hbWV9J1xuICogLSB1c2VySWQg4oaSIHVzZXJOYW1lIOKGkiB0ZW1wbGF0ZTogJ3t1c2VyTmFtZX0nICBcbiAqIC0gZ2FtZUlkIOKGkiBnYW1lTmFtZSDihpIgdGVtcGxhdGU6ICd7Z2FtZU5hbWV9J1xuICogXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBwcm9wZXJ0aWVzIGluIHRoZSBwYXJlbnQgZW50aXR5XG4gKiBAcGFyYW0gcmVsYXRpb25GaWVsZElkIC0gVGhlIHJlbGF0aW9uIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnKVxuICogQHBhcmFtIHJlbGF0ZWRFbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHJldHVybnMgVGVtcGxhdGUgc3RyaW5nIGlmIGR1cGxpY2F0ZWQgZmllbGQgZm91bmQsIHVuZGVmaW5lZCBvdGhlcndpc2VcbiAqL1xuZnVuY3Rpb24gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRUZW1wbGF0ZShcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICByZWxhdGlvbkZpZWxkSWQ6IHN0cmluZyxcbiAgICByZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nXG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IHJlbGF0ZWRFbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgXG4gICAgLy8gVHJ5IGNvbW1vbiBwYXR0ZXJuczoge2VudGl0eX1OYW1lLCB7ZW50aXR5fVRpdGxlLCB7cmVsYXRlZEZpZWxkfU5hbWVcbiAgICBjb25zdCBjb21tb25TdWZmaXhlcyA9IFsnTmFtZScsICdUaXRsZScsICdMYWJlbCddO1xuICAgIFxuICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIGNvbW1vblN1ZmZpeGVzKSB7XG4gICAgICAgIC8vIFBhdHRlcm4gMToge2VudGl0eU5hbWV9e3N1ZmZpeH0gKGUuZy4sIHRlYW1OYW1lIGZvciB0ZWFtSWQgcmVsYXRpb24gdG8gJ3RlYW0nKVxuICAgICAgICBjb25zdCBwYXR0ZXJuMSA9IGAke2VudGl0eU5hbWVMb3dlcn0ke3N1ZmZpeH1gO1xuICAgICAgICBjb25zdCBmb3VuZDEgPSBhbGxQcm9wZXJ0aWVzLmZpbmQocCA9PiBwLmlkPy50b0xvd2VyQ2FzZSgpID09PSBwYXR0ZXJuMSk7XG4gICAgICAgIGlmIChmb3VuZDEpIHJldHVybiBgeyR7Zm91bmQxLmlkfX1gO1xuICAgICAgICBcbiAgICAgICAgLy8gUGF0dGVybiAyOiBSZXBsYWNlICdJZCcgd2l0aCB7c3VmZml4fSAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgaWYgKHJlbGF0aW9uRmllbGRJZC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpKSB7XG4gICAgICAgICAgICBjb25zdCBiYXNlTmFtZSA9IHJlbGF0aW9uRmllbGRJZC5zdWJzdHJpbmcoMCwgcmVsYXRpb25GaWVsZElkLmxlbmd0aCAtIDIpO1xuICAgICAgICAgICAgY29uc3QgcGF0dGVybjIgPSBgJHtiYXNlTmFtZX0ke3N1ZmZpeH1gO1xuICAgICAgICAgICAgY29uc3QgZm91bmQyID0gYWxsUHJvcGVydGllcy5maW5kKHAgPT4gcC5pZD8udG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybjIudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgICBpZiAoZm91bmQyKSByZXR1cm4gYHske2ZvdW5kMi5pZH19YDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHNtYXJ0IGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHJlbGF0aW9uIGRpc3BsYXkgd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZS5cbiAqIFVzZXMgZW50aXR5IG1ldGFkYXRhIChpY29uLCBlbnRpdHlOYW1lUGx1cmFsKSB0byBjcmVhdGUgdXNlci1mcmllbmRseSBmYWxsYmFjayB0ZXh0LlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFJlbGF0ZWQgZW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJylcbiAqIEBwYXJhbSBpZEZpZWxkIC0gSUQgZmllbGQgbmFtZSAoZS5nLiwgJ3RlYW1JZCcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIHRvIGdldCBtZXRhZGF0YSBmcm9tXG4gKiBAcmV0dXJucyBGYWxsYmFjayBjb25maWd1cmF0aW9uIHdpdGggdGVtcGxhdGUsIGxpbmtUZXh0LCBhbmQgbW9kYWxCdXR0b25UZXh0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBGb3IgYSB0ZWFtIHJlbGF0aW9uXG4gKiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soJ3RlYW0nLCAndGVhbUlkJywgdGVhbVNlcnZpY2UpXG4gKiAvLyBSZXR1cm5zOiB7XG4gKiAvLyAgIHRlbXBsYXRlOiAnVGVhbToge3RlYW1JZH0nLFxuICogLy8gICBsaW5rVGV4dDogJ1ZpZXcgVGVhbScsXG4gKiAvLyAgIG1vZGFsQnV0dG9uVGV4dDogJ1RlYW0gRGV0YWlscydcbiAqIC8vIH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgaWRGaWVsZDogc3RyaW5nLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pOiBOb25OdWxsYWJsZTxJUmVsYXRpb25GaWVsZENvbmZpZ1snZGlzcGxheUNvbmZpZyddPlsnZmFsbGJhY2snXSB7XG4gICAgLy8gVHJ5IHRvIGdldCBlbnRpdHkgbWV0YWRhdGEgZm9yIGJldHRlciBmYWxsYmFjayB0ZXh0XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsO1xuICAgIGNvbnN0IGRpc3BsYXlOYW1lID0gZW50aXR5TWV0YWRhdGE/LmVudGl0eU5hbWVQbHVyYWwgfHwgcGFzY2FsQ2FzZShlbnRpdHlOYW1lKTtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgICAvLyBCYWNrZW5kIHByZS1nZW5lcmF0ZXMgZmFsbGJhY2sgdGVtcGxhdGUgKGludGVudGlvbmFsbHkgc3RyaW5nLW9ubHksIG5vdCBUZW1wbGF0ZSB0eXBlKVxuICAgICAgICAvLyBGcm9udGVuZCB3aWxsIHVzZSB0aGlzIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgdGVtcGxhdGU6IGAke2Rpc3BsYXlOYW1lfTogeyR7aWRGaWVsZH19YCwgIC8vIGUuZy4sIFwiVGVhbToge3RlYW1JZH1cIlxuICAgICAgICBsaW5rVGV4dDogYFZpZXcgJHtkaXNwbGF5TmFtZX1gLCAgICAgICAgICAgLy8gZS5nLiwgXCJWaWV3IFRlYW1cIlxuICAgICAgICBtb2RhbEJ1dHRvblRleHQ6IGAke2Rpc3BsYXlOYW1lfSBEZXRhaWxzYCAgLy8gZS5nLiwgXCJUZWFtIERldGFpbHNcIlxuICAgIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoXG4gICAgdGhpc1Byb3A6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBhbGxQcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10gIC8vIE9wdGlvbmFsOiBmb3IgZGV0ZWN0aW5nIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4pIHtcbiAgICBjb25zdCBmb3JtYXR0ZWQ6IGFueSA9IHtcbiAgICAgICAgLi4udGhpc1Byb3AsXG4gICAgICAgIGxhYmVsOiB0aGlzUHJvcC5uYW1lLCAgLy8gUmVzcGVjdCBjdXN0b20gbGFiZWwgZnJvbSBlbnRpdHkgYXR0cmlidXRlXG4gICAgICAgIGNvbHVtbjogdGhpc1Byb3AuaWQsXG4gICAgICAgIGZpZWxkVHlwZTogdGhpc1Byb3AuZmllbGRUeXBlIHx8ICd0ZXh0JywgIC8vIGZpZWxkVHlwZSBzaG91bGQgYWxyZWFkeSBiZSBpbmZlcnJlZCBpbiBiYXNlLXNlcnZpY2VcbiAgICAgICAgaGlkZGVuOiB0aGlzUHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXRoaXNQcm9wLmlzVmlzaWJsZVxuICAgIH07XG5cbiAgICAvLyBIYW5kbGUgYWRkTmV3T3B0aW9uIChPTEQgLSBkZXByZWNhdGVkLCBnZW5lcmF0ZXMgZW1iZWRkZWQgY29uZmlnKSBvciBhZGROZXdPcHRpb25Db25maWcgKE5FVyAtIGp1c3QgcGFzcyB0aHJvdWdoIHJlZmVyZW5jZSlcbiAgICBpZiAoaXNTZWxlY3RGaWVsZE1ldGFkYXRhKHRoaXNQcm9wKSAmJiBbICdjcmVhdGUnLCAndXBkYXRlJyBdLmluY2x1ZGVzKHR5cGUpKSB7XG4gICAgICAgIGNvbnN0IHNlbGVjdEZpZWxkID0gdGhpc1Byb3AgYXMgU2VsZWN0RmllbGRNZXRhZGF0YTtcbiAgICAgICAgXG4gICAgICAgIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWcpIHtcbiAgICAgICAgICAgIC8vIE5FVyBXQVk6IFVzZXIgcHJvdmlkZWQgYWRkTmV3T3B0aW9uQ29uZmlnIHJlZmVyZW5jZSAtIGp1c3QgcGFzcyBpdCB0aHJvdWdoXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWc7XG4gICAgICAgICAgICBcbiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb24pIHtcbiAgICAgICAgICAgIC8vIE9MRCBXQVkgKERFUFJFQ0FURUQpOiBUcmFuc2Zvcm0gYWRkTmV3T3B0aW9uIHRvIGFkZE5ld09wdGlvbkNvbmZpZyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCBvdmVycmlkZUNvbmZpZyB9ID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uO1xuXG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZSAmJiBlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnY3JlYXRlJyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IG92ZXJyaWRlQ29uZmlnIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogdW5kZWZpbmVkLCAgLy8gU3RheSBpbiBtb2RhbCBhZnRlciBjcmVhdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgZm9ybUJ1dHRvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQWRkXCIsIGFjdGlvbjogXCJzdWJtaXRcIiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJDYW5jZWxcIiwgYWN0aW9uOiBcImNhbmNlbFwiIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIHJlbGF0aW9uIGZpZWxkcyAoREFUQSBMQVlFUiArIFVJIExBWUVSKVxuICAgIGlmICh0aGlzUHJvcC5yZWxhdGlvbiAmJiB0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICBjb25zdCByZWxhdGlvbiA9IHRoaXNQcm9wLnJlbGF0aW9uO1xuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIHR5cGU6IHJlbGF0aW9uVHlwZSwgaWRlbnRpZmllcnMgfSA9IHJlbGF0aW9uO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlc29sdmUgaWRlbnRpZmllcnMgKGNvdWxkIGJlIGRpcmVjdCB2YWx1ZSBvciBsYXp5IGZ1bmN0aW9uKVxuICAgICAgICBjb25zdCByZXNvbHZlZElkZW50aWZpZXJzID0gdHlwZW9mIGlkZW50aWZpZXJzID09PSAnZnVuY3Rpb24nID8gaWRlbnRpZmllcnMoKSA6IGlkZW50aWZpZXJzO1xuXG4gICAgICAgIC8vIFNhZmV0eSBjaGVjayBmb3IgYXJyYXkgaWRlbnRpZmllcnNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIGlmIChyZXNvbHZlZElkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBFbXB0eSBpZGVudGlmaWVycyBhcnJheSBmb3IgcmVsYXRpb24gWyR7ZW50aXR5TmFtZX1dYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBib3RoIHNpbmdsZSBhbmQgbXVsdGlwbGUgaWRlbnRpZmllcnMgZm9yIGNvbXBvc2l0ZSBrZXlzXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5ncyA9IEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykgXG4gICAgICAgICAgICA/IHJlc29sdmVkSWRlbnRpZmllcnMubWFwKGlkID0+ICh7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcoaWQuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhpZC50YXJnZXQpXG4gICAgICAgICAgICAgIH0pKVxuICAgICAgICAgICAgOiBbe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnRhcmdldClcbiAgICAgICAgICAgICAgfV07XG5cbiAgICAgICAgLy8gRm9yIHJvdXRlIHBhdHRlcm4gYW5kIGRlZmF1bHQgZmlsdGVycywgdXNlIHRoZSBmaXJzdCBpZGVudGlmaWVyXG4gICAgICAgIC8vIChtb3N0IGVudGl0aWVzIGhhdmUgc2luZ2xlIGlkZW50aWZpZXI7IGNvbXBvc2l0ZSBrZXlzIG5lZWQgZXhwbGljaXQgcm91dGVQYXR0ZXJuKVxuICAgICAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1swXTtcblxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBVSSBjb25maWcgaW4gcmVsYXRpb25Db25maWcgKG9wdGlvbmFsIG92ZXJyaWRlKVxuICAgICAgICBjb25zdCB1c2VyUmVsYXRpb25Db25maWcgPSB0aGlzUHJvcC5yZWxhdGlvbkNvbmZpZyBhcyBJUmVsYXRpb25GaWVsZENvbmZpZyB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZSBmb3IgbWV0YWRhdGEgKGljb24sIGV0Yy4pXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpIFxuICAgICAgICAgICAgPyBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSlcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICBcbiAgICAgICAgLy8gR2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgaWNvbiBhbmQgZmFsbGJhY2sgZ2VuZXJhdGlvblxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5TWV0YWRhdGEgPSByZWxhdGVkRW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICAgICAgY29uc3QgZGVmYXVsdEljb24gPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5pY29uO1xuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW9uZScpKSB7XG4gICAgICAgICAgICAvLyBUTy1PTkU6IFNob3cgdmFsdWUgYXMgbGluayArIG1vZGFsIGljb25cbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL3ZpZXcte2VudGl0eX0vOnRhcmdldElkXG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVybiBcbiAgICAgICAgICAgICAgICB8fCBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9Lzoke3ByaW1hcnlJZGVudGlmaWVyLnRhcmdldH1gO1xuXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gQXV0by1kZXRlY3QgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZCAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgICAgIGNvbnN0IGF1dG9UZW1wbGF0ZSA9IGFsbFByb3BlcnRpZXMgXG4gICAgICAgICAgICAgICAgPyBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZFRlbXBsYXRlKGFsbFByb3BlcnRpZXMsIHRoaXNQcm9wLmlkLCBlbnRpdHlOYW1lKVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDEgXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWzBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge31cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBQcmlvcml0eTogVXNlciBjdXN0b20gdGVtcGxhdGUgPiBBdXRvLWRldGVjdGVkIGR1cGxpY2F0ZWQgZmllbGQgPiB1bmRlZmluZWQgKHVzZSBmYWxsYmFjaylcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUgfHwgYXV0b1RlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdFeWVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGFueSBjdXN0b20gYWN0aW9uc1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmFjdGlvbnNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBLZWVwIGlzTGluayBhbmQgbGlua0NvbmZpZ1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXNMaW5rJyBdID0gdHJ1ZTtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2xpbmtDb25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW1hbnknKSkge1xuICAgICAgICAgICAgLy8gVE8tTUFOWTogU2hvdyBjb3VudCArIG1vZGFsIGljb24gKG9wZW5zIGZpbHRlcmVkIGxpc3QpXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC9saXN0LXtlbnRpdHl9XG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IGZpbHRlcnMgdG8gc2hvdyBvbmx5IHJlbGF0ZWQgaXRlbXNcbiAgICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBpZiB3ZSdyZSB2aWV3aW5nIGEgVGVhbSBhbmQgdGhpcyBmaWVsZCBzaG93cyBHYW1lcyxcbiAgICAgICAgICAgIC8vIHdlIHdhbnQgdG8gZmlsdGVyIGdhbWVzIHdoZXJlIHRlYW1JZCA9IGN1cnJlbnQgdGVhbSdzIElEXG4gICAgICAgICAgICAvLyBGb3IgY29tcG9zaXRlIGtleXMsIGFkZCBhbGwgaWRlbnRpZmllcnMgYXMgZmlsdGVyc1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncy5mb3JFYWNoKG1hcHBpbmcgPT4ge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzW21hcHBpbmcudGFyZ2V0XSA9IGA6JHttYXBwaW5nLnNvdXJjZX1gO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHRvLW1hbnkgKHNob3dzIGNvdW50KVxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tDb25maWcgPSBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBwcmltYXJ5SWRlbnRpZmllci5zb3VyY2UsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMSBcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbMF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogZGVmYXVsdEZpbHRlcnNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZXIgY2FuIG92ZXJyaWRlIHdpdGggY3VzdG9tIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gdHJ1ZSwgLy8gRGVmYXVsdCBmYWxzZSBmb3IgdG8tbWFueVxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIElmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIG1vZGFsQ29uZmlnUmVmLCBtZXJnZSBkZWZhdWx0IGZpbHRlcnMgd2l0aCB0aGVpciBvdmVycmlkZXNcbiAgICAgICAgICAgIGlmICh1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmPy5vdmVycmlkZUNvbmZpZykge1xuICAgICAgICAgICAgICAgIGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmIS5vdmVycmlkZUNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4udXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4uZGVmYXVsdEZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi4odXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLmRlZmF1bHRGaWx0ZXJzIHx8IHt9KVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcbiAgICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgbmVzdGVkIHN0cnVjdHVyZXMgKG1hcCBhbmQgbGlzdCB0eXBlcylcbiAgICBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ21hcCcgJiYgdGhpc1Byb3AucHJvcGVydGllcykge1xuICAgICAgICBmb3JtYXR0ZWRbICdwcm9wZXJ0aWVzJyBdID0gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbCh0aGlzUHJvcC5wcm9wZXJ0aWVzLCB0eXBlLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXNQcm9wLnR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICAvLyBGb3IgbGlzdCB0eXBlcywgY2hlY2sgaWYgaXRlbXMgYXJlIG1hcHMgKG5lc3RlZCBzdHJ1Y3R1cmVzKVxuICAgICAgICAvLyBOb3RlOiBpdGVtcyBwcm9wZXJ0eSBleGlzdHMgb24gbGlzdC10eXBlIGF0dHJpYnV0ZXMgYnV0IG5vdCBpbiBiYXNlIEVudGl0eUF0dHJpYnV0ZSB0eXBlXG4gICAgICAgIGNvbnN0IGV4dGVuZGVkUHJvcCA9IHRoaXNQcm9wIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgaXRlbXM/OiB7IHR5cGU6IHN0cmluZzsgcHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdIH0gfTtcbiAgICAgICAgaWYgKGV4dGVuZGVkUHJvcC5pdGVtcz8udHlwZSA9PT0gJ21hcCcgJiYgZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2l0ZW1zJyBdID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZFsgJ2l0ZW1zJyBdLFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gVE9ETzogYWRkIHN1cHBvcnQgZm9yIHNldCwgZW51bSwgYW5kIGN1c3RvbS10eXBlc1xuXG4gICAgcmV0dXJuIGZvcm1hdHRlZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbikge1xuXG4gICAgaWYgKHR5cGUgPT09ICdjcmVhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAndXBkYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuICAgIHRocm93IChgSW52YWxpZCB0eXBlIFske3R5cGV9XSBwcm92aWRlZCB0byBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+KSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0NyZWF0YWJsZScpIHx8IHByb3AuaXNDcmVhdGFibGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICdjcmVhdGUnLCBlbnRpdHlTZXJ2aWNlKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+KSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0VkaXRhYmxlJykgfHwgcHJvcC5pc0VkaXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAndXBkYXRlJywgZW50aXR5U2VydmljZSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55Pikge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgfHwgcHJvcC5pc1Zpc2libGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlKSk7XG59XG5cbmV4cG9ydCB0eXBlIExpc3RpbmdQcm9wQ29uZmlnID0gUGljazxGaWVsZE1ldGFkYXRhLCAnZmllbGRUeXBlJyB8ICdwbGFjZWhvbGRlcicgfCAnaGVscFRleHQnIHwgJ2ZpbHRlckNvbmZpZyc+ICYge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkYXRhSW5kZXg6IHN0cmluZyxcbiAgICBoaWRkZW4/OiBib29sZWFuLFxuICAgIGFjdGlvbnM/OiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgcmVsYXRpb25Db25maWc/OiBJUmVsYXRpb25GaWVsZENvbmZpZywgIC8vIEZvciByZW5kZXJpbmcgcmVsYXRpb25zIHdpdGggbGlua3MvbW9kYWxzXG4gICAgdGVtcGxhdGU/OiBUZW1wbGF0ZSwgIC8vIEZvciB0ZW1wbGF0ZS1iYXNlZCByZW5kZXJpbmdcbiAgICBpc0lkZW50aWZpZXI/OiBib29sZWFuLCAgLy8gRm9yIGlkZW50aWZpZXIgZmllbGRzXG4gICAgaXNMaW5rPzogYm9vbGVhbiwgIC8vIEZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgbGlua0NvbmZpZz86IHsgcm91dGVQYXR0ZXJuOiBzdHJpbmc7IGRpc3BsYXlUZXh0Pzogc3RyaW5nIH0sICAvLyBGb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KFxuICAgIGVudGl0eU5hbWU6IHN0cmluZywgXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAge1xuICAgICAgICBDUlVEQXBpUGF0aCxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbCxcbiAgICAgICAgY3VzdG9tUm93QWN0aW9uc1xuICAgIH06IHtcbiAgICAgICAgQ1JVREFwaVBhdGg/OiBzdHJpbmcsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU/OiBib29sZWFuLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlPzogYm9vbGVhbixcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbD86IGJvb2xlYW4sXG4gICAgICAgIGN1c3RvbVJvd0FjdGlvbnM/OiBSZWFkb25seUFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiB8IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICB9XG4pIHtcblxuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBlbnRpdHlOYW1lUGFzY2FsQ2FzZSA9IHBhc2NhbENhc2UoZW50aXR5TmFtZSk7XG5cbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiBwcm9wLmlzTGlzdGFibGUpXG4gICAgICAgIC5tYXAocHJvcCA9PiB7XG4gICAgICAgICAgICAvLyBVc2Ugc2FtZSBmb3JtYXR0aW5nIGxvZ2ljIGFzIGRldGFpbHMvZm9ybXMgKGluY2x1ZGVzIHJlbGF0aW9uQ29uZmlnIGdlbmVyYXRpb24pXG4gICAgICAgICAgICAvLyBQYXNzIGFsbCBwcm9wZXJ0aWVzIHNvIGl0IGNhbiBkZXRlY3QgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZHMgKGUuZy4sIHRlYW1OYW1lIGZvciB0ZWFtSWQpXG4gICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWQgPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwocHJvcCwgJ2RldGFpbCcsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPdmVycmlkZS9hZGQgbGlzdC1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBjb25zdCBwcm9wQ29uZmlnOiBMaXN0aW5nUHJvcENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWQsXG4gICAgICAgICAgICAgICAgbmFtZTogZm9ybWF0dGVkLmxhYmVsIHx8IGZvcm1hdHRlZC5uYW1lLCAgLy8gRW5zdXJlIG5hbWUgaXMgc2V0IGZvciB0YWJsZSBjb2x1bW4gaGVhZGVyXG4gICAgICAgICAgICAgICAgZGF0YUluZGV4OiBgJHtwcm9wLmlkfWAsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBmb3JtYXR0ZWQuZmllbGRUeXBlIHx8ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICBoaWRkZW46IHByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICFwcm9wLmlzVmlzaWJsZVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHByb3AuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgZGVmYXVsdCByb3cgYWN0aW9ucyB3aXRoIElEc1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRBY3Rpb25zOiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4gPSBbXTtcblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pbkRldGFpbCkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBWaWV3IHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pblVwZGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnZWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBFZGl0IHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGAvZWRpdC0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdEZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBEZWxldGUgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFR5cGU6ICdjb25maXJtJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IGBEZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogYEFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBkZWxldGUgdGhpcyAke2VudGl0eU5hbWVQYXNjYWxDYXNlfT8gVGhpcyBhY3Rpb24gY2Fubm90IGJlIHVuZG9uZS5gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpTWV0aG9kOiBgREVMRVRFYCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2VLZXk6IGVudGl0eU5hbWVMb3dlcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpVXJsOiBgJHtDUlVEQXBpUGF0aCA/IENSVURBcGlQYXRoIDogJyd9LyR7ZW50aXR5TmFtZUxvd2VyfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzTWVzc2FnZTogYCR7ZW50aXR5TmFtZVBhc2NhbENhc2V9IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6IGBGYWlsZWQgdG8gZGVsZXRlICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIE1lcmdlIGN1c3RvbSByb3cgYWN0aW9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgcHJvcENvbmZpZy5hY3Rpb25zID0gY3VzdG9tUm93QWN0aW9ucyBcbiAgICAgICAgICAgICAgICAgICAgPyBtZXJnZUFjdGlvbnMoZGVmYXVsdEFjdGlvbnMsIGN1c3RvbVJvd0FjdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIDogZGVmYXVsdEFjdGlvbnM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBwcm9wQ29uZmlnO1xuICAgICAgICB9KTtcbn1cblxuLyoqXG4gKiBNRVJHRSBVVElMSVRZIEZVTkNUSU9OU1xuICogXG4gKiBUaGVzZSBmdW5jdGlvbnMgaW1wbGVtZW50IHRoZSBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlIHBhdHRlcm46XG4gKiAtIERlZmF1bHRzIGhhdmUgc3RhbmRhcmQgaWRlbnRpZmllcnMgKGUuZy4sICd2aWV3JywgJ2VkaXQnLCAnZGVsZXRlJylcbiAqIC0gQ3VzdG9tIGNvbmZpZ3Mgd2l0aCBzYW1lIGlkZW50aWZpZXIgb3ZlcnJpZGUgdGhlIGRlZmF1bHRcbiAqIC0gTmV3IGlkZW50aWZpZXJzIGdldCBhZGRlZCB0byB0aGUgcmVzdWx0XG4gKi9cblxuLyoqXG4gKiBNZXJnZSBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbnMgKGZyb20gZ2VuZXJhdG9yKVxuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9ucyAoZnJvbSBlbnRpdHkgc2NoZW1hKVxuICogQHJldHVybnMgTWVyZ2VkIGJ1dHRvbiBhcnJheVxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VCdXR0b25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IGN1c3RvbXNBcnJheSA9IFsuLi5jdXN0b21zXTsgIC8vIENvbnZlcnQgdG8gbXV0YWJsZSBhcnJheVxuICAgIGNvbnN0IGN1c3RvbU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIGN1c3RvbXNBcnJheS5maWx0ZXIoYyA9PiBjLmlkKS5tYXAoYyA9PiBbYy5pZCwgY10pXG4gICAgKTtcbiAgICBcbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzLCByZXBsYWNlIGlmIGN1c3RvbSBoYXMgc2FtZSBpZFxuICAgIGNvbnN0IG1lcmdlZCA9IGRlZmF1bHRzLm1hcChkZWZhdWx0QnRuID0+IFxuICAgICAgICBkZWZhdWx0QnRuLmlkICYmIGN1c3RvbU1hcC5oYXMoZGVmYXVsdEJ0bi5pZClcbiAgICAgICAgICAgID8gY3VzdG9tTWFwLmdldChkZWZhdWx0QnRuLmlkKSEgIC8vIE92ZXJyaWRlXG4gICAgICAgICAgICA6IGRlZmF1bHRCdG5cbiAgICApO1xuICAgIFxuICAgIC8vIEFkZCBjdXN0b20gYnV0dG9ucyB0aGF0IGRvbid0IG92ZXJyaWRlIGRlZmF1bHRzXG4gICAgY3VzdG9tc0FycmF5LmZvckVhY2goY3VzdG9tQnRuID0+IHtcbiAgICAgICAgaWYgKCFjdXN0b21CdG4uaWQgfHwgIWRlZmF1bHRzLnNvbWUoZCA9PiBkLmlkID09PSBjdXN0b21CdG4uaWQpKSB7XG4gICAgICAgICAgICBtZXJnZWQucHVzaChjdXN0b21CdG4pOyAgLy8gQWRkIG5ld1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLyoqXG4gKiBNZXJnZSBkZWZhdWx0IGFjdGlvbnMgd2l0aCBjdXN0b20gYWN0aW9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlLlxuICogU2FtZSBsb2dpYyBhcyBtZXJnZUJ1dHRvbnMgYnV0IHNlbWFudGljYWxseSBuYW1lZCBmb3IgYWN0aW9ucy5cbiAqIFxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBhY3Rpb25zIChmcm9tIGdlbmVyYXRvcilcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGFjdGlvbnMgKGZyb20gZW50aXR5IHNjaGVtYSlcbiAqIEByZXR1cm5zIE1lcmdlZCBhY3Rpb24gYXJyYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQWN0aW9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICByZXR1cm4gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBbLi4uY3VzdG9tc10pOyAgLy8gU3ByZWFkIHRvIGhhbmRsZSBib3RoIHJlYWRvbmx5IGFuZCBtdXRhYmxlXG59XG5cbi8qKlxuICogTWVyZ2UgZmllbGQtbGV2ZWwgdmlzaWJpbGl0eS9lbmFibGVtZW50L2hlbHBUZXh0L3BsYWNlaG9sZGVyIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIHByb3BlcnRpZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBmaWVsZE92ZXJyaWRlcyAtIEZpZWxkIG92ZXJyaWRlcyBmcm9tIGZvcm1Db25maWcuZmllbGRzXG4gKiBAcmV0dXJucyBQcm9wZXJ0aWVzIHdpdGggb3ZlcnJpZGVzIG1lcmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGaWVsZFZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nIH0+KFxuICAgIGJhc2VQcm9wZXJ0aWVzOiBBcnJheTxUPixcbiAgICBmaWVsZE92ZXJyaWRlczogUmVhZG9ubHlBcnJheTx7XG4gICAgICAgIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+IHwgQXJyYXk8e1xuICAgICAgICBuYW1lOiBzdHJpbmc7XG4gICAgICAgIHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIGVuYWJsZW1lbnQ/OiBhbnk7XG4gICAgICAgIGhlbHBUZXh0Pzogc3RyaW5nO1xuICAgICAgICBwbGFjZWhvbGRlcj86IHN0cmluZztcbiAgICB9PiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBbLi4uZmllbGRPdmVycmlkZXNdLm1hcChmID0+IFtmLm5hbWUsIGZdKVxuICAgICk7XG4gICAgXG4gICAgLy8gVmFsaWRhdGlvbjogV2FybiBpZiBmaWVsZCBvdmVycmlkZSByZWZlcmVuY2VzIG5vbi1leGlzdGVudCBmaWVsZFxuICAgIGZpZWxkT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIWJhc2VQcm9wZXJ0aWVzLnNvbWUocCA9PiBwLm5hbWUgPT09IG92ZXJyaWRlLm5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYEZpZWxkIG92ZXJyaWRlIFwiJHtvdmVycmlkZS5uYW1lfVwiIG5vdCBmb3VuZCBpbiBzY2hlbWEgcHJvcGVydGllcy4gVGhpcyBvdmVycmlkZSB3aWxsIGJlIGlnbm9yZWQuYCk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChwcm9wLm5hbWUpO1xuICAgICAgICBcbiAgICAgICAgaWYgKCFvdmVycmlkZSkgcmV0dXJuIHByb3A7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucHJvcCxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS52aXNpYmlsaXR5ICE9PSB1bmRlZmluZWQgJiYgeyB2aXNpYmlsaXR5OiBvdmVycmlkZS52aXNpYmlsaXR5IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmVuYWJsZW1lbnQgIT09IHVuZGVmaW5lZCAmJiB7IGVuYWJsZW1lbnQ6IG92ZXJyaWRlLmVuYWJsZW1lbnQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuaGVscFRleHQgIT09IHVuZGVmaW5lZCAmJiB7IGhlbHBUZXh0OiBvdmVycmlkZS5oZWxwVGV4dCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5wbGFjZWhvbGRlciAhPT0gdW5kZWZpbmVkICYmIHsgcGxhY2Vob2xkZXI6IG92ZXJyaWRlLnBsYWNlaG9sZGVyIH0pXG4gICAgICAgIH07XG4gICAgfSk7XG59XG5cbi8qKlxuICogTWVyZ2UgY29sdW1uLWxldmVsIHZpc2liaWxpdHkvd2lkdGgvZml4ZWQgaW50byBiYXNlIHByb3BlcnRpZXMuXG4gKiBcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgcHJvcGVydGllcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGNvbHVtbk92ZXJyaWRlcyAtIENvbHVtbiBvdmVycmlkZXMgZnJvbSB0YWJsZUNvbmZpZy5jb2x1bW5zXG4gKiBAcmV0dXJucyBQcm9wZXJ0aWVzIHdpdGggY29sdW1uIG92ZXJyaWRlcyBtZXJnZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQ29sdW1uVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGNvbHVtbk92ZXJyaWRlczogUmVhZG9ubHlBcnJheTx7XG4gICAgICAgIHJlYWRvbmx5IGZpZWxkOiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIHJlYWRvbmx5IHdpZHRoPzogc3RyaW5nIHwgbnVtYmVyO1xuICAgICAgICByZWFkb25seSBmaXhlZD86ICdsZWZ0JyB8ICdyaWdodCc7XG4gICAgICAgIHJlYWRvbmx5IGdyb3VwVGl0bGU/OiBzdHJpbmc7XG4gICAgfT4gfCBBcnJheTx7XG4gICAgICAgIGZpZWxkOiBzdHJpbmc7XG4gICAgICAgIHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIHdpZHRoPzogc3RyaW5nIHwgbnVtYmVyO1xuICAgICAgICBmaXhlZD86ICdsZWZ0JyB8ICdyaWdodCc7XG4gICAgICAgIGdyb3VwVGl0bGU/OiBzdHJpbmc7XG4gICAgfT4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IG92ZXJyaWRlTWFwID0gbmV3IE1hcChcbiAgICAgICAgWy4uLmNvbHVtbk92ZXJyaWRlc10ubWFwKGMgPT4gW2MuZmllbGQsIGNdKVxuICAgICk7XG4gICAgXG4gICAgLy8gVmFsaWRhdGlvbjogV2FybiBpZiBjb2x1bW4gb3ZlcnJpZGUgcmVmZXJlbmNlcyBub24tZXhpc3RlbnQgY29sdW1uXG4gICAgY29sdW1uT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIWJhc2VQcm9wZXJ0aWVzLnNvbWUocCA9PiBwLm5hbWUgPT09IG92ZXJyaWRlLmZpZWxkKSkge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBDb2x1bW4gb3ZlcnJpZGUgXCIke292ZXJyaWRlLmZpZWxkfVwiIG5vdCBmb3VuZCBpbiBzY2hlbWEgcHJvcGVydGllcy4gVGhpcyBvdmVycmlkZSB3aWxsIGJlIGlnbm9yZWQuYCk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChwcm9wLm5hbWUpO1xuICAgICAgICBcbiAgICAgICAgaWYgKCFvdmVycmlkZSkgcmV0dXJuIHByb3A7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucHJvcCxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS52aXNpYmlsaXR5ICE9PSB1bmRlZmluZWQgJiYgeyB2aXNpYmlsaXR5OiBvdmVycmlkZS52aXNpYmlsaXR5IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLndpZHRoICE9PSB1bmRlZmluZWQgJiYgeyB3aWR0aDogb3ZlcnJpZGUud2lkdGggfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZml4ZWQgIT09IHVuZGVmaW5lZCAmJiB7IGZpeGVkOiBvdmVycmlkZS5maXhlZCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5ncm91cFRpdGxlICE9PSB1bmRlZmluZWQgJiYgeyBncm91cFRpdGxlOiBvdmVycmlkZS5ncm91cFRpdGxlIH0pXG4gICAgICAgIH07XG4gICAgfSk7XG59XG4iXX0=