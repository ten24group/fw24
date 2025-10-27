"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatEntityAttributeForFormOrDetail = formatEntityAttributeForFormOrDetail;
exports.formatEntityAttributesForFormOrDetail = formatEntityAttributesForFormOrDetail;
exports.formatEntityAttributesForCreate = formatEntityAttributesForCreate;
exports.formatEntityAttributesForUpdate = formatEntityAttributesForUpdate;
exports.formatEntityAttributesForDetail = formatEntityAttributesForDetail;
exports.formatEntityAttributesForList = formatEntityAttributesForList;
const entity_1 = require("../../entity");
const logging_1 = require("../../logging");
const utils_1 = require("../../utils");
function formatEntityAttributeForFormOrDetail(thisProp, type, entityService) {
    const formatted = {
        ...thisProp,
        label: thisProp.name,
        column: thisProp.id,
        fieldType: thisProp.fieldType || 'text',
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
        if (relationType.endsWith('to-one')) {
            // TO-ONE: Show value as link + modal icon
            // Route pattern: Use custom (from relationConfig) or default to /view-{entity}/:targetId
            const routePattern = userRelationConfig?.routePattern
                || `/view-${entityNameLower}/:${primaryIdentifier.target}`;
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
                modalWidth: userRelationConfig?.modalWidth || '95%', // Default width for detail modals
                modalTitle: userRelationConfig?.modalTitle,
                displayConfig: userRelationConfig?.displayConfig || {
                    showModalIcon: true,
                    icon: 'EyeOutlined',
                    showLink: true
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
                defaultFilters[mapping.source] = `:${mapping.source}`;
            });
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
                modalWidth: userRelationConfig?.modalWidth || 1200, // Larger width for list modals
                modalTitle: userRelationConfig?.modalTitle,
                displayConfig: userRelationConfig?.displayConfig || {
                    showModalIcon: true,
                    icon: 'UnorderedListOutlined',
                    showLink: false
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
function formatEntityAttributesForList(entityName, properties, { CRUDApiPath, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail }) {
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = (0, utils_1.pascalCase)(entityName);
    return properties
        .filter(prop => prop && prop.isListable)
        .map(prop => {
        const propConfig = {
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
                    url: `/edit-${entityNameLower}`
                });
            }
            if (!excludeFromAdminDelete) {
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
                            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
                        },
                        submitSuccessRedirect: `/list-${entityNameLower}`
                    }
                });
            }
            if (!excludeFromAdminDetail) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZUEsb0ZBMkxDO0FBRUQsc0ZBa0JDO0FBRUQsMEVBSUM7QUFFRCwwRUFJQztBQUVELDBFQUlDO0FBU0Qsc0VBcUVDO0FBOVRELHlDQVFzQjtBQUN0QiwyQ0FBOEM7QUFDOUMsdUNBQXlDO0FBS3pDLFNBQWdCLG9DQUFvQyxDQUNoRCxRQUE0QixFQUM1QixJQUFvQyxFQUNwQyxhQUFxQztJQUVyQyxNQUFNLFNBQVMsR0FBUTtRQUNuQixHQUFHLFFBQVE7UUFDWCxLQUFLLEVBQUUsUUFBUSxDQUFDLElBQUk7UUFDcEIsTUFBTSxFQUFFLFFBQVEsQ0FBQyxFQUFFO1FBQ25CLFNBQVMsRUFBRSxRQUFRLENBQUMsU0FBUyxJQUFJLE1BQU07UUFDdkMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUztLQUN0RSxDQUFDO0lBRUYsOEhBQThIO0lBQzlILElBQUksSUFBQSw4QkFBcUIsRUFBQyxRQUFRLENBQUMsSUFBSSxDQUFFLFFBQVEsRUFBRSxRQUFRLENBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUMzRSxNQUFNLFdBQVcsR0FBRyxRQUErQixDQUFDO1FBRXBELElBQUksV0FBVyxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDakMsNkVBQTZFO1lBQzdFLFNBQVMsQ0FBRSxvQkFBb0IsQ0FBRSxHQUFHLFdBQVcsQ0FBQyxrQkFBa0IsQ0FBQztRQUV2RSxDQUFDO2FBQU0sSUFBSSxXQUFXLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDbEMsZ0dBQWdHO1lBQ2hHLE1BQU0sRUFBRSxVQUFVLEVBQUUsY0FBYyxFQUFFLEdBQUcsV0FBVyxDQUFDLFlBQVksQ0FBQztZQUVoRSxJQUFJ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QUVELElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO2dCQUMxQixPQUFPLENBQUMsSUFBSSxDQUFDO29CQUNULElBQUksRUFBRSxRQUFRO29CQUNkLFdBQVcsRUFBRSxJQUFJO29CQUNqQixXQUFXLEVBQUU7d0JBQ1QsU0FBUyxFQUFFLFNBQVM7d0JBQ3BCLGVBQWUsRUFBRTs0QkFDYixLQUFLLEVBQUUsVUFBVSxvQkFBb0IsRUFBRTs0QkFDdkMsT0FBTyxFQUFFLHdDQUF3QyxvQkFBb0IsR0FBRzt5QkFDM0U7d0JBQ0QsU0FBUyxFQUFFOzRCQUNQLFNBQVMsRUFBRSxRQUFROzRCQUNuQixXQUFXLEVBQUUsZUFBZTs0QkFDNUIsTUFBTSxFQUFFLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxlQUFlLEVBQUU7eUJBQ2pFO3dCQUNELHFCQUFxQixFQUFFLFNBQVMsZUFBZSxFQUFFO3FCQUNwRDtpQkFDSixDQUFDLENBQUM7WUFDUCxDQUFDO1lBRUQsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7Z0JBQzFCLE9BQU8sQ0FBQyxJQUFJLENBQUM7b0JBQ1QsSUFBSSxFQUFFLE1BQU07b0JBQ1osR0FBRyxFQUFFLFNBQVMsZUFBZSxFQUFFO2lCQUNsQyxDQUFDLENBQUM7WUFDUCxDQUFDO1lBRUQsVUFBVSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDakMsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFDO0lBQ3RCLENBQUMsQ0FBQyxDQUFDO0FBQ1gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFxuICAgIEJhc2VFbnRpdHlTZXJ2aWNlLCBcbiAgICBGaWVsZE1ldGFkYXRhLCBcbiAgICBUSU9TY2hlbWFBdHRyaWJ1dGUsIFxuICAgIGlzU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICAgIEVudGl0eUF0dHJpYnV0ZSxcbiAgICBJUmVsYXRpb25GaWVsZENvbmZpZ1xufSBmcm9tIFwiLi4vLi4vZW50aXR5XCI7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyIH0gZnJvbSBcIi4uLy4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IHBhc2NhbENhc2UgfSBmcm9tIFwiLi4vLi4vdXRpbHNcIjtcbmltcG9ydCB7IG1ha2VDcmVhdGVFbnRpdHlGb3JtQ29uZmlnIH0gZnJvbSBcIi4vY3JlYXRlLWVudGl0eVwiO1xuaW1wb3J0IHsgbWFrZVZpZXdFbnRpdHlMaXN0Q29uZmlnIH0gZnJvbSBcIi4vbGlzdC1lbnRpdHlcIjtcbmltcG9ydCB7IG1ha2VWaWV3RW50aXR5RGV0YWlsQ29uZmlnIH0gZnJvbSBcIi4vdmlldy1lbnRpdHlcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChcbiAgICB0aGlzUHJvcDogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pIHtcbiAgICBjb25zdCBmb3JtYXR0ZWQ6IGFueSA9IHtcbiAgICAgICAgLi4udGhpc1Byb3AsXG4gICAgICAgIGxhYmVsOiB0aGlzUHJvcC5uYW1lLFxuICAgICAgICBjb2x1bW46IHRoaXNQcm9wLmlkLFxuICAgICAgICBmaWVsZFR5cGU6IHRoaXNQcm9wLmZpZWxkVHlwZSB8fCAndGV4dCcsXG4gICAgICAgIGhpZGRlbjogdGhpc1Byb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICF0aGlzUHJvcC5pc1Zpc2libGVcbiAgICB9O1xuXG4gICAgLy8gSGFuZGxlIGFkZE5ld09wdGlvbiAoT0xEIC0gZGVwcmVjYXRlZCwgZ2VuZXJhdGVzIGVtYmVkZGVkIGNvbmZpZykgb3IgYWRkTmV3T3B0aW9uQ29uZmlnIChORVcgLSBqdXN0IHBhc3MgdGhyb3VnaCByZWZlcmVuY2UpXG4gICAgaWYgKGlzU2VsZWN0RmllbGRNZXRhZGF0YSh0aGlzUHJvcCkgJiYgWyAnY3JlYXRlJywgJ3VwZGF0ZScgXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgICBjb25zdCBzZWxlY3RGaWVsZCA9IHRoaXNQcm9wIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGE7XG4gICAgICAgIFxuICAgICAgICBpZiAoc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uQ29uZmlnKSB7XG4gICAgICAgICAgICAvLyBORVcgV0FZOiBVc2VyIHByb3ZpZGVkIGFkZE5ld09wdGlvbkNvbmZpZyByZWZlcmVuY2UgLSBqdXN0IHBhc3MgaXQgdGhyb3VnaFxuICAgICAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uQ29uZmlnO1xuICAgICAgICAgICAgXG4gICAgICAgIH0gZWxzZSBpZiAoc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uKSB7XG4gICAgICAgICAgICAvLyBPTEQgV0FZIChERVBSRUNBVEVEKTogVHJhbnNmb3JtIGFkZE5ld09wdGlvbiB0byBhZGROZXdPcHRpb25Db25maWcgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgb3ZlcnJpZGVDb25maWcgfSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbjtcblxuICAgICAgICAgICAgaWYgKGVudGl0eU5hbWUgJiYgZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2NyZWF0ZScgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiBvdmVycmlkZUNvbmZpZyB8fCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IHVuZGVmaW5lZCwgIC8vIFN0YXkgaW4gbW9kYWwgYWZ0ZXIgY3JlYXRpb25cbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1CdXR0b25zOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkFkZFwiLCBhY3Rpb246IFwic3VibWl0XCIgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQ2FuY2VsXCIsIGFjdGlvbjogXCJjYW5jZWxcIiB9XG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSByZWxhdGlvbiBmaWVsZHMgKERBVEEgTEFZRVIgKyBVSSBMQVlFUilcbiAgICBpZiAodGhpc1Byb3AucmVsYXRpb24gJiYgdHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb24gPSB0aGlzUHJvcC5yZWxhdGlvbjtcbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCB0eXBlOiByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSByZWxhdGlvbjtcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmICghZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXNvbHZlIGlkZW50aWZpZXJzIChjb3VsZCBiZSBkaXJlY3QgdmFsdWUgb3IgbGF6eSBmdW5jdGlvbilcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiBpZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IGlkZW50aWZpZXJzKCkgOiBpZGVudGlmaWVycztcblxuICAgICAgICAvLyBTYWZldHkgY2hlY2sgZm9yIGFycmF5IGlkZW50aWZpZXJzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZWRJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogRW1wdHkgaWRlbnRpZmllcnMgYXJyYXkgZm9yIHJlbGF0aW9uIFske2VudGl0eU5hbWV9XWApO1xuICAgICAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgYm90aCBzaW5nbGUgYW5kIG11bHRpcGxlIGlkZW50aWZpZXJzIGZvciBjb21wb3NpdGUga2V5c1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpIFxuICAgICAgICAgICAgPyByZXNvbHZlZElkZW50aWZpZXJzLm1hcChpZCA9PiAoe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKGlkLnNvdXJjZSksXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBTdHJpbmcoaWQudGFyZ2V0KVxuICAgICAgICAgICAgICB9KSlcbiAgICAgICAgICAgIDogW3tcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnNvdXJjZSksXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy50YXJnZXQpXG4gICAgICAgICAgICAgIH1dO1xuXG4gICAgICAgIC8vIEZvciByb3V0ZSBwYXR0ZXJuIGFuZCBkZWZhdWx0IGZpbHRlcnMsIHVzZSB0aGUgZmlyc3QgaWRlbnRpZmllclxuICAgICAgICAvLyAobW9zdCBlbnRpdGllcyBoYXZlIHNpbmdsZSBpZGVudGlmaWVyOyBjb21wb3NpdGUga2V5cyBuZWVkIGV4cGxpY2l0IHJvdXRlUGF0dGVybilcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkZW50aWZpZXIgPSBpZGVudGlmaWVyTWFwcGluZ3NbMF07XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdXNlciBwcm92aWRlZCBjdXN0b20gVUkgY29uZmlnIGluIHJlbGF0aW9uQ29uZmlnIChvcHRpb25hbCBvdmVycmlkZSlcbiAgICAgICAgY29uc3QgdXNlclJlbGF0aW9uQ29uZmlnID0gdGhpc1Byb3AucmVsYXRpb25Db25maWcgYXMgSVJlbGF0aW9uRmllbGRDb25maWcgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZS5lbmRzV2l0aCgndG8tb25lJykpIHtcbiAgICAgICAgICAgIC8vIFRPLU9ORTogU2hvdyB2YWx1ZSBhcyBsaW5rICsgbW9kYWwgaWNvblxuICAgICAgICAgICAgLy8gUm91dGUgcGF0dGVybjogVXNlIGN1c3RvbSAoZnJvbSByZWxhdGlvbkNvbmZpZykgb3IgZGVmYXVsdCB0byAvdmlldy17ZW50aXR5fS86dGFyZ2V0SWRcbiAgICAgICAgICAgIGNvbnN0IHJvdXRlUGF0dGVybiA9IHVzZXJSZWxhdGlvbkNvbmZpZz8ucm91dGVQYXR0ZXJuIFxuICAgICAgICAgICAgICAgIHx8IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn0vOiR7cHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0fWA7XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMSBcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbMF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAndmlldycgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7fVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoIHx8ICc5NSUnLCAvLyBEZWZhdWx0IHdpZHRoIGZvciBkZXRhaWwgbW9kYWxzXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZyB8fCB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGljb246ICdFeWVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcblxuICAgICAgICAgICAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eTogS2VlcCBpc0xpbmsgYW5kIGxpbmtDb25maWdcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2lzTGluaycgXSA9IHRydWU7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdsaW5rQ29uZmlnJyBdID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25UeXBlLmVuZHNXaXRoKCd0by1tYW55JykpIHtcbiAgICAgICAgICAgIC8vIFRPLU1BTlk6IFNob3cgY291bnQgKyBtb2RhbCBpY29uIChvcGVucyBmaWx0ZXJlZCBsaXN0KVxuICAgICAgICAgICAgLy8gUm91dGUgcGF0dGVybjogVXNlIGN1c3RvbSAoZnJvbSByZWxhdGlvbkNvbmZpZykgb3IgZGVmYXVsdCB0byAvbGlzdC17ZW50aXR5fVxuICAgICAgICAgICAgY29uc3Qgcm91dGVQYXR0ZXJuID0gdXNlclJlbGF0aW9uQ29uZmlnPy5yb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgICAgICB8fCBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YDtcblxuICAgICAgICAgICAgLy8gQnVpbGQgZGVmYXVsdCBmaWx0ZXJzIHRvIHNob3cgb25seSByZWxhdGVkIGl0ZW1zXG4gICAgICAgICAgICAvLyBGb3IgZXhhbXBsZSwgaWYgd2UncmUgdmlld2luZyBhIFRlYW0gYW5kIHRoaXMgZmllbGQgc2hvd3MgR2FtZXMsXG4gICAgICAgICAgICAvLyB3ZSB3YW50IHRvIGZpbHRlciBnYW1lcyB3aGVyZSB0ZWFtSWQgPSBjdXJyZW50IHRlYW0ncyBJRFxuICAgICAgICAgICAgLy8gRm9yIGNvbXBvc2l0ZSBrZXlzLCBhZGQgYWxsIGlkZW50aWZpZXJzIGFzIGZpbHRlcnNcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MuZm9yRWFjaChtYXBwaW5nID0+IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyc1ttYXBwaW5nLnNvdXJjZV0gPSBgOiR7bWFwcGluZy5zb3VyY2V9YDtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDEgXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWzBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IGRlZmF1bHRGaWx0ZXJzXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCB8fCAxMjAwLCAvLyBMYXJnZXIgd2lkdGggZm9yIGxpc3QgbW9kYWxzXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZyB8fCB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGljb246ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogZmFsc2VcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBJZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBtb2RhbENvbmZpZ1JlZiwgbWVyZ2UgZGVmYXVsdCBmaWx0ZXJzIHdpdGggdGhlaXIgb3ZlcnJpZGVzXG4gICAgICAgICAgICBpZiAodXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZj8ub3ZlcnJpZGVDb25maWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZiEub3ZlcnJpZGVDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmRlZmF1bHRGaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgLi4uKHVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZy5kZWZhdWx0RmlsdGVycyB8fCB7fSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3JlbGF0aW9uQ29uZmlnJyBdID0gZ2VuZXJhdGVkUmVsYXRpb25Db25maWc7XG4gICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIG5lc3RlZCBzdHJ1Y3R1cmVzIChtYXAgYW5kIGxpc3QgdHlwZXMpXG4gICAgaWYgKHRoaXNQcm9wLnR5cGUgPT09ICdtYXAnICYmIHRoaXNQcm9wLnByb3BlcnRpZXMpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAncHJvcGVydGllcycgXSA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwodGhpc1Byb3AucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzUHJvcC50eXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgLy8gRm9yIGxpc3QgdHlwZXMsIGNoZWNrIGlmIGl0ZW1zIGFyZSBtYXBzIChuZXN0ZWQgc3RydWN0dXJlcylcbiAgICAgICAgLy8gTm90ZTogaXRlbXMgcHJvcGVydHkgZXhpc3RzIG9uIGxpc3QtdHlwZSBhdHRyaWJ1dGVzIGJ1dCBub3QgaW4gYmFzZSBFbnRpdHlBdHRyaWJ1dGUgdHlwZVxuICAgICAgICBjb25zdCBleHRlbmRlZFByb3AgPSB0aGlzUHJvcCBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IGl0ZW1zPzogeyB0eXBlOiBzdHJpbmc7IHByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSB9IH07XG4gICAgICAgIGlmIChleHRlbmRlZFByb3AuaXRlbXM/LnR5cGUgPT09ICdtYXAnICYmIGV4dGVuZGVkUHJvcC5pdGVtcy5wcm9wZXJ0aWVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdpdGVtcycgXSA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWRbICdpdGVtcycgXSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKGV4dGVuZGVkUHJvcC5pdGVtcy5wcm9wZXJ0aWVzLCB0eXBlLCBlbnRpdHlTZXJ2aWNlKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IGZvciBzZXQsIGVudW0sIGFuZCBjdXN0b20tdHlwZXNcblxuICAgIHJldHVybiBmb3JtYXR0ZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pIHtcblxuICAgIGlmICh0eXBlID09PSAnY3JlYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ3VwZGF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cbiAgICB0aHJvdyAoYEludmFsaWQgdHlwZSBbJHt0eXBlfV0gcHJvdmlkZWQgdG8gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbGApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55Pikge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNDcmVhdGFibGUnKSB8fCBwcm9wLmlzQ3JlYXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnY3JlYXRlJywgZW50aXR5U2VydmljZSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55Pikge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNFZGl0YWJsZScpIHx8IHByb3AuaXNFZGl0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ3VwZGF0ZScsIGVudGl0eVNlcnZpY2UpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpIHx8IHByb3AuaXNWaXNpYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnZGV0YWlsJywgZW50aXR5U2VydmljZSkpO1xufVxuXG5leHBvcnQgdHlwZSBMaXN0aW5nUHJvcENvbmZpZyA9IFBpY2s8RmllbGRNZXRhZGF0YSwgJ2ZpZWxkVHlwZScgfCAncGxhY2Vob2xkZXInIHwgJ2hlbHBUZXh0JyB8ICdmaWx0ZXJDb25maWcnPiAmIHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGF0YUluZGV4OiBzdHJpbmcsXG4gICAgaGlkZGVuPzogYm9vbGVhbixcbiAgICBhY3Rpb25zPzogYW55W10sXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0Zvckxpc3QoZW50aXR5TmFtZTogc3RyaW5nLCBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwge1xuICAgIENSVURBcGlQYXRoLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsXG59OiB7XG4gICAgQ1JVREFwaVBhdGg/OiBzdHJpbmcsXG4gICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZT86IGJvb2xlYW4sXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZT86IGJvb2xlYW4sXG4gICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbD86IGJvb2xlYW4sXG59KSB7XG5cbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TmFtZVBhc2NhbENhc2UgPSBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgcHJvcC5pc0xpc3RhYmxlKVxuICAgICAgICAubWFwKHByb3AgPT4ge1xuXG4gICAgICAgICAgICBjb25zdCBwcm9wQ29uZmlnOiBMaXN0aW5nUHJvcENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgICAgIGRhdGFJbmRleDogYCR7cHJvcC5pZH1gLFxuICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogcHJvcC5maWVsZFR5cGUgfHwgJ3RleHQnLFxuICAgICAgICAgICAgICAgIGhpZGRlbjogcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXByb3AuaXNWaXNpYmxlXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAocHJvcC5pc0lkZW50aWZpZXIpIHtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGFjdGlvbnMgPSBbXTtcblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pblVwZGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL2VkaXQtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsVHlwZTogJ2NvbmZpcm0nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogYERlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGBBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gZGVsZXRlIHRoaXMgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaU1ldGhvZDogYERFTEVURWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlS2V5OiBlbnRpdHlOYW1lTG93ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaVVybDogYCR7Q1JVREFwaVBhdGggPyBDUlVEQXBpUGF0aCA6ICcnfS8ke2VudGl0eU5hbWVMb3dlcn1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC92aWV3LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcHJvcENvbmZpZy5hY3Rpb25zID0gYWN0aW9ucztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHByb3BDb25maWc7XG4gICAgICAgIH0pO1xufVxuIl19