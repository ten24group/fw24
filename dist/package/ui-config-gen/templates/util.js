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
                modalWidth: userRelationConfig?.modalWidth,
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
                modalWidth: userRelationConfig?.modalWidth,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZUEsb0ZBMkxDO0FBRUQsc0ZBa0JDO0FBRUQsMEVBSUM7QUFFRCwwRUFJQztBQUVELDBFQUlDO0FBU0Qsc0VBcUVDO0FBOVRELHlDQVFzQjtBQUN0QiwyQ0FBOEM7QUFDOUMsdUNBQXlDO0FBS3pDLFNBQWdCLG9DQUFvQyxDQUNoRCxRQUE0QixFQUM1QixJQUFvQyxFQUNwQyxhQUFxQztJQUVyQyxNQUFNLFNBQVMsR0FBUTtRQUNuQixHQUFHLFFBQVE7UUFDWCxLQUFLLEVBQUUsUUFBUSxDQUFDLElBQUk7UUFDcEIsTUFBTSxFQUFFLFFBQVEsQ0FBQyxFQUFFO1FBQ25CLFNBQVMsRUFBRSxRQUFRLENBQUMsU0FBUyxJQUFJLE1BQU07UUFDdkMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUztLQUN0RSxDQUFDO0lBRUYsOEhBQThIO0lBQzlILElBQUksSUFBQSw4QkFBcUIsRUFBQyxRQUFRLENBQUMsSUFBSSxDQUFFLFFBQVEsRUFBRSxRQUFRLENBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUMzRSxNQUFNLFdBQVcsR0FBRyxRQUErQixDQUFDO1FBRXBELElBQUksV0FBVyxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDakMsNkVBQTZFO1lBQzdFLFNBQVMsQ0FBRSxvQkFBb0IsQ0FBRSxHQUFHLFdBQVcsQ0FBQyxrQkFBa0IsQ0FBQztRQUV2RSxDQUFDO2FBQU0sSUFBSSxXQUFXLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDbEMsZ0dBQWdHO1lBQ2hHLE1BQU0sRUFBRSxVQUFVLEVBQUUsY0FBYyxFQUFFLEdBQUcsV0FBVyxDQUFDLFlBQVksQ0FBQztZQUVoRSxJQUFJ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QUFDLElBQUksQ0FBQztvQkFDVCxJQUFJLEVBQUUsUUFBUTtvQkFDZCxXQUFXLEVBQUUsSUFBSTtvQkFDakIsV0FBVyxFQUFFO3dCQUNULFNBQVMsRUFBRSxTQUFTO3dCQUNwQixlQUFlLEVBQUU7NEJBQ2IsS0FBSyxFQUFFLFVBQVUsb0JBQW9CLEVBQUU7NEJBQ3ZDLE9BQU8sRUFBRSx3Q0FBd0Msb0JBQW9CLEdBQUc7eUJBQzNFO3dCQUNELFNBQVMsRUFBRTs0QkFDUCxTQUFTLEVBQUUsUUFBUTs0QkFDbkIsV0FBVyxFQUFFLGVBQWU7NEJBQzVCLE1BQU0sRUFBRSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksZUFBZSxFQUFFO3lCQUNqRTt3QkFDRCxxQkFBcUIsRUFBRSxTQUFTLGVBQWUsRUFBRTtxQkFDcEQ7aUJBQ0osQ0FBQyxDQUFDO1lBQ1AsQ0FBQztZQUVELElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO2dCQUMxQixPQUFPLENBQUMsSUFBSSxDQUFDO29CQUNULElBQUksRUFBRSxNQUFNO29CQUNaLEdBQUcsRUFBRSxTQUFTLGVBQWUsRUFBRTtpQkFDbEMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztZQUVELFVBQVUsQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ2pDLENBQUM7UUFFRCxPQUFPLFVBQVUsQ0FBQztJQUN0QixDQUFDLENBQUMsQ0FBQztBQUNYLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBcbiAgICBCYXNlRW50aXR5U2VydmljZSwgXG4gICAgRmllbGRNZXRhZGF0YSwgXG4gICAgVElPU2NoZW1hQXR0cmlidXRlLCBcbiAgICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBFbnRpdHlBdHRyaWJ1dGUsXG4gICAgSVJlbGF0aW9uRmllbGRDb25maWdcbn0gZnJvbSBcIi4uLy4uL2VudGl0eVwiO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBwYXNjYWxDYXNlIH0gZnJvbSBcIi4uLy4uL3V0aWxzXCI7XG5pbXBvcnQgeyBtYWtlQ3JlYXRlRW50aXR5Rm9ybUNvbmZpZyB9IGZyb20gXCIuL2NyZWF0ZS1lbnRpdHlcIjtcbmltcG9ydCB7IG1ha2VWaWV3RW50aXR5TGlzdENvbmZpZyB9IGZyb20gXCIuL2xpc3QtZW50aXR5XCI7XG5pbXBvcnQgeyBtYWtlVmlld0VudGl0eURldGFpbENvbmZpZyB9IGZyb20gXCIuL3ZpZXctZW50aXR5XCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoXG4gICAgdGhpc1Byb3A6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKSB7XG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnRoaXNQcm9wLFxuICAgICAgICBsYWJlbDogdGhpc1Byb3AubmFtZSxcbiAgICAgICAgY29sdW1uOiB0aGlzUHJvcC5pZCxcbiAgICAgICAgZmllbGRUeXBlOiB0aGlzUHJvcC5maWVsZFR5cGUgfHwgJ3RleHQnLFxuICAgICAgICBoaWRkZW46IHRoaXNQcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhdGhpc1Byb3AuaXNWaXNpYmxlXG4gICAgfTtcblxuICAgIC8vIEhhbmRsZSBhZGROZXdPcHRpb24gKE9MRCAtIGRlcHJlY2F0ZWQsIGdlbmVyYXRlcyBlbWJlZGRlZCBjb25maWcpIG9yIGFkZE5ld09wdGlvbkNvbmZpZyAoTkVXIC0ganVzdCBwYXNzIHRocm91Z2ggcmVmZXJlbmNlKVxuICAgIGlmIChpc1NlbGVjdEZpZWxkTWV0YWRhdGEodGhpc1Byb3ApICYmIFsgJ2NyZWF0ZScsICd1cGRhdGUnIF0uaW5jbHVkZXModHlwZSkpIHtcbiAgICAgICAgY29uc3Qgc2VsZWN0RmllbGQgPSB0aGlzUHJvcCBhcyBTZWxlY3RGaWVsZE1ldGFkYXRhO1xuICAgICAgICBcbiAgICAgICAgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZykge1xuICAgICAgICAgICAgLy8gTkVXIFdBWTogVXNlciBwcm92aWRlZCBhZGROZXdPcHRpb25Db25maWcgcmVmZXJlbmNlIC0ganVzdCBwYXNzIGl0IHRocm91Z2hcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZztcbiAgICAgICAgICAgIFxuICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbikge1xuICAgICAgICAgICAgLy8gT0xEIFdBWSAoREVQUkVDQVRFRCk6IFRyYW5zZm9ybSBhZGROZXdPcHRpb24gdG8gYWRkTmV3T3B0aW9uQ29uZmlnIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIG92ZXJyaWRlQ29uZmlnIH0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb247XG5cbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lICYmIGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdjcmVhdGUnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzogb3ZlcnJpZGVDb25maWcgfHwge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiB1bmRlZmluZWQsICAvLyBTdGF5IGluIG1vZGFsIGFmdGVyIGNyZWF0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtQnV0dG9uczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJBZGRcIiwgYWN0aW9uOiBcInN1Ym1pdFwiIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkNhbmNlbFwiLCBhY3Rpb246IFwiY2FuY2VsXCIgfVxuICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgcmVsYXRpb24gZmllbGRzIChEQVRBIExBWUVSICsgVUkgTEFZRVIpXG4gICAgaWYgKHRoaXNQcm9wLnJlbGF0aW9uICYmIHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uID0gdGhpc1Byb3AucmVsYXRpb247XG4gICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgdHlwZTogcmVsYXRpb25UeXBlLCBpZGVudGlmaWVycyB9ID0gcmVsYXRpb247XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgICAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVzb2x2ZSBpZGVudGlmaWVycyAoY291bGQgYmUgZGlyZWN0IHZhbHVlIG9yIGxhenkgZnVuY3Rpb24pXG4gICAgICAgIGNvbnN0IHJlc29sdmVkSWRlbnRpZmllcnMgPSB0eXBlb2YgaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbicgPyBpZGVudGlmaWVycygpIDogaWRlbnRpZmllcnM7XG5cbiAgICAgICAgLy8gU2FmZXR5IGNoZWNrIGZvciBhcnJheSBpZGVudGlmaWVyc1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgaWYgKHJlc29sdmVkSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IEVtcHR5IGlkZW50aWZpZXJzIGFycmF5IGZvciByZWxhdGlvbiBbJHtlbnRpdHlOYW1lfV1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGJvdGggc2luZ2xlIGFuZCBtdWx0aXBsZSBpZGVudGlmaWVycyBmb3IgY29tcG9zaXRlIGtleXNcbiAgICAgICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzID0gQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSBcbiAgICAgICAgICAgID8gcmVzb2x2ZWRJZGVudGlmaWVycy5tYXAoaWQgPT4gKHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFN0cmluZyhpZC5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKGlkLnRhcmdldClcbiAgICAgICAgICAgICAgfSkpXG4gICAgICAgICAgICA6IFt7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMudGFyZ2V0KVxuICAgICAgICAgICAgICB9XTtcblxuICAgICAgICAvLyBGb3Igcm91dGUgcGF0dGVybiBhbmQgZGVmYXVsdCBmaWx0ZXJzLCB1c2UgdGhlIGZpcnN0IGlkZW50aWZpZXJcbiAgICAgICAgLy8gKG1vc3QgZW50aXRpZXMgaGF2ZSBzaW5nbGUgaWRlbnRpZmllcjsgY29tcG9zaXRlIGtleXMgbmVlZCBleHBsaWNpdCByb3V0ZVBhdHRlcm4pXG4gICAgICAgIGNvbnN0IHByaW1hcnlJZGVudGlmaWVyID0gaWRlbnRpZmllck1hcHBpbmdzWzBdO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIFVJIGNvbmZpZyBpbiByZWxhdGlvbkNvbmZpZyAob3B0aW9uYWwgb3ZlcnJpZGUpXG4gICAgICAgIGNvbnN0IHVzZXJSZWxhdGlvbkNvbmZpZyA9IHRoaXNQcm9wLnJlbGF0aW9uQ29uZmlnIGFzIElSZWxhdGlvbkZpZWxkQ29uZmlnIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW9uZScpKSB7XG4gICAgICAgICAgICAvLyBUTy1PTkU6IFNob3cgdmFsdWUgYXMgbGluayArIG1vZGFsIGljb25cbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL3ZpZXcte2VudGl0eX0vOnRhcmdldElkXG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVybiBcbiAgICAgICAgICAgICAgICB8fCBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9Lzoke3ByaW1hcnlJZGVudGlmaWVyLnRhcmdldH1gO1xuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDEgXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWzBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge31cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd01vZGFsSWNvbjogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogJ0V5ZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBLZWVwIGlzTGluayBhbmQgbGlua0NvbmZpZ1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXNMaW5rJyBdID0gdHJ1ZTtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2xpbmtDb25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW1hbnknKSkge1xuICAgICAgICAgICAgLy8gVE8tTUFOWTogU2hvdyBjb3VudCArIG1vZGFsIGljb24gKG9wZW5zIGZpbHRlcmVkIGxpc3QpXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC9saXN0LXtlbnRpdHl9XG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IGZpbHRlcnMgdG8gc2hvdyBvbmx5IHJlbGF0ZWQgaXRlbXNcbiAgICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBpZiB3ZSdyZSB2aWV3aW5nIGEgVGVhbSBhbmQgdGhpcyBmaWVsZCBzaG93cyBHYW1lcyxcbiAgICAgICAgICAgIC8vIHdlIHdhbnQgdG8gZmlsdGVyIGdhbWVzIHdoZXJlIHRlYW1JZCA9IGN1cnJlbnQgdGVhbSdzIElEXG4gICAgICAgICAgICAvLyBGb3IgY29tcG9zaXRlIGtleXMsIGFkZCBhbGwgaWRlbnRpZmllcnMgYXMgZmlsdGVyc1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncy5mb3JFYWNoKG1hcHBpbmcgPT4ge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzW21hcHBpbmcuc291cmNlXSA9IGA6JHttYXBwaW5nLnNvdXJjZX1gO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMSBcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbMF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogZGVmYXVsdEZpbHRlcnNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWcgfHwge1xuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBpY29uOiAnVW5vcmRlcmVkTGlzdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IGZhbHNlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgLy8gSWYgdXNlciBwcm92aWRlZCBjdXN0b20gbW9kYWxDb25maWdSZWYsIG1lcmdlIGRlZmF1bHQgZmlsdGVycyB3aXRoIHRoZWlyIG92ZXJyaWRlc1xuICAgICAgICAgICAgaWYgKHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWY/Lm92ZXJyaWRlQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVkUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYhLm92ZXJyaWRlQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi51c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5kZWZhdWx0RmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLih1c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcuZGVmYXVsdEZpbHRlcnMgfHwge30pXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuICAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBuZXN0ZWQgc3RydWN0dXJlcyAobWFwIGFuZCBsaXN0IHR5cGVzKVxuICAgIGlmICh0aGlzUHJvcC50eXBlID09PSAnbWFwJyAmJiB0aGlzUHJvcC5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKHRoaXNQcm9wLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpO1xuICAgIH0gZWxzZSBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIC8vIEZvciBsaXN0IHR5cGVzLCBjaGVjayBpZiBpdGVtcyBhcmUgbWFwcyAobmVzdGVkIHN0cnVjdHVyZXMpXG4gICAgICAgIC8vIE5vdGU6IGl0ZW1zIHByb3BlcnR5IGV4aXN0cyBvbiBsaXN0LXR5cGUgYXR0cmlidXRlcyBidXQgbm90IGluIGJhc2UgRW50aXR5QXR0cmlidXRlIHR5cGVcbiAgICAgICAgY29uc3QgZXh0ZW5kZWRQcm9wID0gdGhpc1Byb3AgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyBpdGVtcz86IHsgdHlwZTogc3RyaW5nOyBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10gfSB9O1xuICAgICAgICBpZiAoZXh0ZW5kZWRQcm9wLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAgICAgLi4uZm9ybWF0dGVkWyAnaXRlbXMnIF0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKSB7XG5cbiAgICBpZiAodHlwZSA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICd1cGRhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG4gICAgdGhyb3cgKGBJbnZhbGlkIHR5cGUgWyR7dHlwZX1dIHByb3ZpZGVkIHRvIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWxgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzQ3JlYXRhYmxlJykgfHwgcHJvcC5pc0NyZWF0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2NyZWF0ZScsIGVudGl0eVNlcnZpY2UpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzRWRpdGFibGUnKSB8fCBwcm9wLmlzRWRpdGFibGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICd1cGRhdGUnLCBlbnRpdHlTZXJ2aWNlKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+KSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSB8fCBwcm9wLmlzVmlzaWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2RldGFpbCcsIGVudGl0eVNlcnZpY2UpKTtcbn1cblxuZXhwb3J0IHR5cGUgTGlzdGluZ1Byb3BDb25maWcgPSBQaWNrPEZpZWxkTWV0YWRhdGEsICdmaWVsZFR5cGUnIHwgJ3BsYWNlaG9sZGVyJyB8ICdoZWxwVGV4dCcgfCAnZmlsdGVyQ29uZmlnJz4gJiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRhdGFJbmRleDogc3RyaW5nLFxuICAgIGhpZGRlbj86IGJvb2xlYW4sXG4gICAgYWN0aW9ucz86IGFueVtdLFxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KGVudGl0eU5hbWU6IHN0cmluZywgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIHtcbiAgICBDUlVEQXBpUGF0aCxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbFxufToge1xuICAgIENSVURBcGlQYXRoPzogc3RyaW5nLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU/OiBib29sZWFuLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU/OiBib29sZWFuLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWw/OiBib29sZWFuLFxufSkge1xuXG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eU5hbWVQYXNjYWxDYXNlID0gcGFzY2FsQ2FzZShlbnRpdHlOYW1lKTtcblxuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmIHByb3AuaXNMaXN0YWJsZSlcbiAgICAgICAgLm1hcChwcm9wID0+IHtcblxuICAgICAgICAgICAgY29uc3QgcHJvcENvbmZpZzogTGlzdGluZ1Byb3BDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgLi4ucHJvcCxcbiAgICAgICAgICAgICAgICBkYXRhSW5kZXg6IGAke3Byb3AuaWR9YCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IHByb3AuZmllbGRUeXBlIHx8ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICBoaWRkZW46IHByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICFwcm9wLmlzVmlzaWJsZVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHByb3AuaXNJZGVudGlmaWVyKSB7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBhY3Rpb25zID0gW107XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC9lZGl0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGVsZXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFR5cGU6ICdjb25maXJtJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IGBEZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBgQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIGRlbGV0ZSB0aGlzICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9P2BcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IGBERUxFVEVgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZUtleTogZW50aXR5TmFtZUxvd2VyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlVcmw6IGAke0NSVURBcGlQYXRoID8gQ1JVREFwaVBhdGggOiAnJ30vJHtlbnRpdHlOYW1lTG93ZXJ9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGV0YWlsKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHByb3BDb25maWcuYWN0aW9ucyA9IGFjdGlvbnM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBwcm9wQ29uZmlnO1xuICAgICAgICB9KTtcbn1cbiJdfQ==