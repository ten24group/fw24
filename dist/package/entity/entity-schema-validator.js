"use strict";
// src/entity/validators/schema-validator.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntitySchemaValidator = void 0;
const electrodb_1 = require("electrodb");
class EntitySchemaValidator {
    diContainer;
    constructor(diContainer) {
        this.diContainer = diContainer;
    }
    validateSchema(schema, entityConfigurations) {
        this.validateElectroDBSchema(schema, entityConfigurations);
        this.validateModelDefinition(schema);
        this.validateDisplayOverrides(schema);
        this.validateRelations(schema);
        this.validateFieldMetadata(schema);
    }
    validateElectroDBSchema(schema, entityConfigurations) {
        try {
            new electrodb_1.Entity(schema, entityConfigurations);
        }
        catch (error) {
            throw new Error(`ElectroDB schema validation failed: ${error.message}`);
        }
    }
    validateModelDefinition(schema) {
        const errors = [];
        // Optional but typed model properties
        if (schema.model.entityNamePlural && typeof schema.model.entityNamePlural !== 'string') {
            errors.push('entityNamePlural must be a string');
        }
        if (schema.model.entityMenuIcon && typeof schema.model.entityMenuIcon !== 'string') {
            errors.push('entityMenuIcon must be a string');
        }
        // Boolean flags validation
        const booleanFlags = [
            'excludeFromAdminMenu',
            'excludeFromAdminList',
            'excludeFromAdminDetail',
            'excludeFromAdminCreate',
            'excludeFromAdminUpdate',
            'excludeFromAdminDelete',
            'excludeFromAdminDuplicate'
        ];
        for (const flag of booleanFlags) {
            if (schema.model[flag] !== undefined && typeof schema.model[flag] !== 'boolean') {
                errors.push(`${flag} must be a boolean`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`Model definition validation failed:\n${errors.join('\n')}`);
        }
    }
    validateDisplayOverrides(schema) {
        const ui = schema.model.displayOverrides;
        if (ui === undefined)
            return;
        const errors = [];
        if (!ui || typeof ui !== 'object') {
            errors.push('displayOverrides must be an object');
        }
        else {
            if (typeof ui.storageAttribute !== 'string' || !ui.storageAttribute.trim()) {
                errors.push('displayOverrides.storageAttribute must be a non-empty string');
            }
            else if (!(ui.storageAttribute in schema.attributes)) {
                errors.push(`displayOverrides.storageAttribute "${ui.storageAttribute}" must name an existing attribute`);
            }
            if (ui.label !== undefined && typeof ui.label !== 'string') {
                errors.push('displayOverrides.label must be a string when provided');
            }
            if (ui.channels !== undefined) {
                if (!Array.isArray(ui.channels) || !ui.channels.every(c => typeof c === 'string')) {
                    errors.push('displayOverrides.channels must be an array of strings when provided');
                }
            }
            if (ui.allowListItemPaths !== undefined && typeof ui.allowListItemPaths !== 'boolean') {
                errors.push('displayOverrides.allowListItemPaths must be a boolean when provided');
            }
            if (ui.fields !== undefined && !Array.isArray(ui.fields)) {
                errors.push('displayOverrides.fields must be an array when provided');
            }
            if (ui.auto !== undefined && typeof ui.auto !== 'boolean') {
                errors.push('displayOverrides.auto must be a boolean when provided');
            }
            if (ui.autoMode !== undefined &&
                !['editableVisible', 'allNonRelation'].includes(ui.autoMode)) {
                errors.push('displayOverrides.autoMode must be one of: editableVisible, allNonRelation');
            }
            if (ui.excludePaths !== undefined) {
                if (!Array.isArray(ui.excludePaths) || !ui.excludePaths.every((p) => typeof p === 'string')) {
                    errors.push('displayOverrides.excludePaths must be string[] when provided');
                }
            }
            if (ui.defaultChrome !== undefined && !['tag', 'badge', 'outline', 'none'].includes(ui.defaultChrome)) {
                errors.push('displayOverrides.defaultChrome must be one of: tag, badge, outline, none');
            }
        }
        if (errors.length > 0) {
            throw new Error(`Display overrides UI validation failed:\n${errors.join('\n')}`);
        }
        this.validateDisplayOverrideFieldPaths(schema, ui);
    }
    validateDisplayOverrideFieldPaths(schema, ui) {
        const fields = ui.fields;
        if (!fields?.length)
            return;
        const errors = [];
        const seen = new Set();
        const primary = schema.indexes?.primary;
        const primaryKeyAttrs = new Set();
        if (primary?.pk?.composite) {
            for (const a of primary.pk.composite)
                primaryKeyAttrs.add(String(a));
        }
        if (primary?.sk?.composite) {
            for (const a of primary.sk.composite)
                primaryKeyAttrs.add(String(a));
        }
        const allowListIndex = ui.allowListItemPaths === true;
        const storage = ui.storageAttribute;
        const autoExcludePaths = ui.excludePaths ?? [];
        for (const entry of fields) {
            if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) {
                errors.push('displayOverrides.fields[]: each entry must have a non-empty path');
                continue;
            }
            const path = entry.path.trim();
            if (seen.has(path)) {
                errors.push(`duplicate displayOverride path "${path}"`);
            }
            seen.add(path);
            if (path === storage || path.startsWith(`${storage}.`)) {
                errors.push(`path "${path}" must not target the override storage attribute`);
            }
            try {
                this.assertValidDisplayOverridePath(schema, path, allowListIndex, primaryKeyAttrs);
            }
            catch (e) {
                errors.push(e.message);
            }
            if (entry.channels !== undefined) {
                if (!Array.isArray(entry.channels) || !entry.channels.every(c => typeof c === 'string')) {
                    errors.push(`displayOverrides.fields channels for "${path}" must be string[]`);
                }
                else if (ui.channels?.length) {
                    const ok = new Set(ui.channels);
                    for (const c of entry.channels) {
                        if (!ok.has(c)) {
                            errors.push(`field "${path}" channel "${c}" is not listed in displayOverrides.channels`);
                        }
                    }
                }
            }
            if (entry.chrome !== undefined && !['tag', 'badge', 'outline', 'none'].includes(entry.chrome)) {
                errors.push(`invalid chrome on displayOverride path "${path}"`);
            }
        }
        for (const pathRaw of autoExcludePaths) {
            if (typeof pathRaw !== 'string' || !pathRaw.trim())
                continue;
            const path = pathRaw.trim();
            if (path === storage || path.startsWith(`${storage}.`)) {
                errors.push(`auto exclude path "${path}" must not target the override storage attribute`);
                continue;
            }
            try {
                this.assertValidDisplayOverridePath(schema, path, allowListIndex, primaryKeyAttrs);
            }
            catch (e) {
                errors.push(`displayOverrides.excludePaths invalid path "${path}": ${e.message}`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`Display overrides UI validation failed:\n${errors.join('\n')}`);
        }
    }
    assertValidDisplayOverridePath(schema, path, allowListIndex, primaryKeyAttrs) {
        const parts = path.split('.').filter(p => p.length > 0);
        if (parts.length === 0) {
            throw new Error(`invalid empty displayOverride path`);
        }
        const walk = (attrs, start) => {
            if (start >= parts.length) {
                throw new Error(`invalid path "${path}"`);
            }
            const part = parts[start];
            if (/^\d+$/.test(part)) {
                throw new Error(`path "${path}" is invalid at "${part}" — unexpected list index`);
            }
            const attr = attrs[part];
            if (!attr) {
                throw new Error(`path "${path}" — unknown attribute "${part}"`);
            }
            if (start === parts.length - 1) {
                if (attr.relation) {
                    throw new Error(`path "${path}" must not target a relation field`);
                }
                if (parts.length === 1 && primaryKeyAttrs.has(part)) {
                    throw new Error(`path "${path}" must not target a primary index key attribute`);
                }
                return;
            }
            if (attr.type === 'map' && attr.properties) {
                walk(attr.properties, start + 1);
                return;
            }
            if (attr.type === 'list') {
                if (!allowListIndex) {
                    throw new Error(`path "${path}" traverses a list but allowListItemPaths is not true`);
                }
                if (start + 1 >= parts.length) {
                    throw new Error(`path "${path}" — expected index after list attribute "${part}"`);
                }
                const idx = parts[start + 1];
                if (!/^\d+$/.test(idx)) {
                    throw new Error(`path "${path}" — expected numeric index after "${part}"`);
                }
                if (attr.items?.type === 'map' && attr.items.properties) {
                    walk(attr.items.properties, start + 2);
                    return;
                }
                throw new Error(`path "${path}" — list "${part}" must have map items to traverse`);
            }
            throw new Error(`path "${path}" — cannot traverse into "${part}"`);
        };
        walk(schema.attributes, 0);
    }
    validateRelations(schema) {
        const errors = [];
        for (const [attrName, attr] of Object.entries(schema.attributes)) {
            if (!attr.relation)
                continue;
            try {
                // 1. Validate relation definition
                if (!attr.relation.entityName || !attr.relation.type) {
                    throw new Error('Relation must specify entityName and type');
                }
                // 2. Validate relation type
                if (!['one-to-many', 'many-to-one'].includes(attr.relation.type)) {
                    throw new Error(`Invalid relation type "${attr.relation.type}"`);
                }
                // 3. Validate related entity exists
                if (!this.diContainer.hasEntitySchema(attr.relation.entityName)) {
                    throw new Error(`Related entity "${attr.relation.entityName}" not found`);
                }
                // 4. Validate identifiers
                const identifiers = typeof attr.relation.identifiers === 'function'
                    ? attr.relation.identifiers()
                    : attr.relation.identifiers;
                if (!identifiers) {
                    throw new Error('Relation must specify identifiers');
                }
                const identifiersList = Array.isArray(identifiers) ? identifiers : [identifiers];
                const relatedSchema = this.diContainer.resolveEntitySchema(attr.relation.entityName);
                for (const identifier of identifiersList) {
                    if (!identifier.source || !identifier.target) {
                        throw new Error('Identifier must specify source and target');
                    }
                    // Validate target exists in related entity
                    if (!(identifier.target in relatedSchema.attributes)) {
                        throw new Error(`Target attribute "${String(identifier.target)}" not found in related entity`);
                    }
                    // Validate source path exists in current entity
                    const sourceParts = identifier.source.split('.');
                    let currentSchema = schema;
                    let currentPath = '';
                    for (const part of sourceParts) {
                        currentPath = currentPath ? `${currentPath}.${part}` : part;
                        if (!currentSchema.attributes || !(part in currentSchema.attributes)) {
                            throw new Error(`Source path "${identifier.source}" invalid at "${part}"`);
                        }
                        const currentAttr = currentSchema.attributes[part];
                        // If this is the last part, we don't need to traverse further
                        if (part === sourceParts[sourceParts.length - 1]) {
                            break;
                        }
                        // For map types, traverse into their properties
                        if (currentAttr.type === 'map' && currentAttr.properties) {
                            currentSchema = { attributes: currentAttr.properties };
                        }
                        else {
                            throw new Error(`Source path "${identifier.source}" invalid at "${part}" - expected map type`);
                        }
                    }
                }
            }
            catch (error) {
                errors.push(`Invalid relation for attribute "${attrName}": ${error.message}`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`Relations validation failed:\n${errors.join('\n')}`);
        }
    }
    validateFieldMetadata(schema) {
        const errors = [];
        for (const [attrName, attr] of Object.entries(schema.attributes)) {
            try {
                // Validate field type if specified
                if (attr.fieldType) {
                    const validFieldTypes = [
                        // Text fields
                        'text', 'textarea', 'password',
                        // Number fields
                        'number',
                        // Date/Time fields
                        'date', 'time', 'datetime', 'duration', 'ttl',
                        // Boolean fields
                        'boolean', 'switch', 'toggle',
                        // Selection fields
                        'select', 'multi-select', 'autocomplete', 'radio', 'checkbox',
                        // File fields
                        'file', 'image',
                        // Other fields
                        'color', 'range', 'hidden', 'custom', 'rating',
                        'rich-text', 'wysiwyg', 'code', 'markdown', 'json'
                    ];
                    if (!validFieldTypes.includes(attr.fieldType)) {
                        throw new Error(`Invalid field type "${attr.fieldType}"`);
                    }
                    // Validate field type specific requirements
                    switch (attr.fieldType) {
                        case 'select':
                        case 'multi-select':
                        case 'autocomplete':
                        case 'radio':
                        case 'checkbox':
                            this.validateSelectFieldMetadata(attr, attrName);
                            break;
                        case 'file':
                            this.validateFileFieldMetadata(attr, attrName);
                            break;
                        case 'image':
                            this.validateImageFieldMetadata(attr, attrName);
                            break;
                        case 'number':
                        case 'range': {
                            const numberAttr = attr;
                            if (numberAttr.min !== undefined && numberAttr.max !== undefined && numberAttr.min > numberAttr.max) {
                                throw new Error(`Minimum value (${numberAttr.min}) cannot be greater than maximum value (${numberAttr.max})`);
                            }
                            break;
                        }
                        case 'date': {
                            const dateAttr = attr;
                            if (dateAttr.minDate && dateAttr.maxDate && dateAttr.minDate > dateAttr.maxDate) {
                                throw new Error(`Minimum date cannot be greater than maximum date`);
                            }
                            break;
                        }
                        case 'datetime': {
                            const dateTimeAttr = attr;
                            if (dateTimeAttr.minDateTime && dateTimeAttr.maxDateTime && dateTimeAttr.minDateTime > dateTimeAttr.maxDateTime) {
                                throw new Error(`Minimum date time cannot be greater than maximum date time`);
                            }
                            break;
                        }
                        case 'time': {
                            const timeAttr = attr;
                            if (timeAttr.minTime && timeAttr.maxTime && timeAttr.minTime > timeAttr.maxTime) {
                                throw new Error(`Minimum time cannot be greater than maximum time`);
                            }
                            break;
                        }
                    }
                }
                // Validate boolean flags
                const booleanFlags = [
                    'isVisible',
                    'isListable',
                    'isCreatable',
                    'isEditable',
                    'isFilterable',
                    'isSearchable'
                ];
                for (const flag of booleanFlags) {
                    if (attr[flag] !== undefined && typeof attr[flag] !== 'boolean') {
                        throw new Error(`${flag} must be a boolean`);
                    }
                }
            }
            catch (error) {
                errors.push(`Invalid field metadata for "${attrName}": ${error.message}`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`Field metadata validation failed:\n${errors.join('\n')}`);
        }
    }
    validateSelectFieldMetadata(attr, attrName) {
        if (!attr.options) {
            throw new Error('Select field must specify options');
        }
        if (Array.isArray(attr.options)) {
            // Static options
            if (attr.options.length === 0) {
                throw new Error('Select field options array cannot be empty');
            }
            if (!attr.options.every(opt => 'value' in opt && 'label' in opt)) {
                throw new Error(`Static options must have value and label properties for "${attrName}"`);
            }
        }
        else if (typeof attr.options === 'object' && ('apiMethod' in attr.options || 'apiUrl' in attr.options || 'responseKey' in attr.options)) {
            // Dynamic options (API config) - check for any API config property to properly validate incomplete configs
            this.validateOptionsAPIConfig(attr.options, attrName);
        }
        else {
            // Dynamic options
            throw new Error(`Invalid options configuration for "${attrName}"`);
        }
        if (attr.addNewOption) {
            if (!this.diContainer.hasEntitySchema(attr.addNewOption.entityName)) {
                throw new Error(`Entity "${attr.addNewOption.entityName}" for addNewOption not found for "${attrName}"`);
            }
        }
    }
    validateOptionsAPIConfig(config, attrName) {
        if (!config.apiUrl || !config.responseKey) {
            throw new Error(`Options API config must specify apiUrl and responseKey for "${attrName}"`);
        }
        if (config.apiMethod && !['GET', 'POST'].includes(config.apiMethod)) {
            throw new Error(`Invalid API method for "${attrName}"`);
        }
        if (config.optionMapping) {
            if (!config.optionMapping.label || !config.optionMapping.value) {
                throw new Error(`Option mapping must specify label and value for "${attrName}"`);
            }
        }
    }
    validateFileFieldMetadata(attr, attrName) {
        if (attr.getSignedUploadUrlAPIConfig) {
            const { apiUrl, apiMethod } = attr.getSignedUploadUrlAPIConfig;
            if (!apiUrl || !['GET', 'POST'].includes(apiMethod)) {
                throw new Error(`Invalid signed upload URL configuration for "${attrName}"`);
            }
        }
        if (attr.maxFileSize && typeof attr.maxFileSize !== 'number') {
            throw new Error(`maxFileSize must be a number for "${attrName}"`);
        }
    }
    validateImageFieldMetadata(attr, attrName) {
        this.validateFileFieldMetadata(attr, attrName);
        if (attr.withImageCrop !== undefined && typeof attr.withImageCrop !== 'boolean') {
            throw new Error(`withImageCrop must be a boolean for "${attrName}"`);
        }
    }
}
exports.EntitySchemaValidator = EntitySchemaValidator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNjaGVtYS12YWxpZGF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw0Q0FBNEM7OztBQUU1Qyx5Q0FBd0Q7QUFZeEQsTUFBYSxxQkFBcUI7SUFDSDtJQUE3QixZQUE2QixXQUF5QjtRQUF6QixnQkFBVyxHQUFYLFdBQVcsQ0FBYztJQUFJLENBQUM7SUFFcEQsY0FBYyxDQUNuQixNQUFTLEVBQ1Qsb0JBQXlDO1FBRXpDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzRCxJQUFJLENBQUMsdUJBQXVCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDckMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUMvQixJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDckMsQ0FBQztJQUVPLHVCQUF1QixDQUM3QixNQUFTLEVBQ1Qsb0JBQXlDO1FBRXpDLElBQUksQ0FBQztZQUNILElBQUksa0JBQU0sQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzQyxDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUMxRSxDQUFDO0lBQ0gsQ0FBQztJQUVPLHVCQUF1QixDQUM3QixNQUFTO1FBRVQsTUFBTSxNQUFNLEdBQWEsRUFBRSxDQUFDO1FBRTVCLHNDQUFzQztRQUN0QyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLElBQUksT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLGdCQUFnQixLQUFLLFFBQVEsRUFB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QyxNQUFNLElBQUksQ0FBQyxDQUFFLEtBQUssRUFBRSxNQUFNLENBQUUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztnQkFDdEQsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QsUUFBUSxHQUFHLENBQUMsQ0FBQztZQUMvRSxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLFdBQVcsSUFBSSxPQUFPLElBQUksQ0FBQyxXQUFXLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDN0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsUUFBUSxHQUFHLENBQUMsQ0FBQztRQUNwRSxDQUFDO0lBQ0gsQ0FBQztJQUVPLDBCQUEwQixDQUFDLElBQXdCLEVBQUUsUUFBZ0I7UUFDM0UsSUFBSSxDQUFDLHlCQUF5QixDQUFDLElBQXlCLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFcEUsSUFBSSxJQUFJLENBQUMsYUFBYSxLQUFLLFNBQVMsSUFBSSxPQUFPLElBQUksQ0FBQyxhQUFhLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDaEYsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsUUFBUSxHQUFHLENBQUMsQ0FBQztRQUN2RSxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBdGdCRCxzREFzZ0JDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gc3JjL2VudGl0eS92YWxpZGF0b3JzL3NjaGVtYS12YWxpZGF0b3IudHNcblxuaW1wb3J0IHsgRW50aXR5LCBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHtcbiAgRW50aXR5U2NoZW1hLFxuICBGaWVsZE1ldGFkYXRhLFxuICBTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICBGaWxlRmllbGRNZXRhZGF0YSxcbiAgSW1hZ2VGaWVsZE1ldGFkYXRhLFxuICBGaWVsZE9wdGlvbnNBUElDb25maWcsXG59IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgeyBJRElDb250YWluZXIgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuXG5cbmV4cG9ydCBjbGFzcyBFbnRpdHlTY2hlbWFWYWxpZGF0b3Ige1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGRpQ29udGFpbmVyOiBJRElDb250YWluZXIpIHsgfVxuXG4gIHB1YmxpYyB2YWxpZGF0ZVNjaGVtYTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBzY2hlbWE6IFMsXG4gICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IEVudGl0eUNvbmZpZ3VyYXRpb25cbiAgKTogdm9pZCB7XG4gICAgdGhpcy52YWxpZGF0ZUVsZWN0cm9EQlNjaGVtYShzY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb25zKTtcbiAgICB0aGlzLnZhbGlkYXRlTW9kZWxEZWZpbml0aW9uKHNjaGVtYSk7XG4gICAgdGhpcy52YWxpZGF0ZURpc3BsYXlPdmVycmlkZXMoc2NoZW1hKTtcbiAgICB0aGlzLnZhbGlkYXRlUmVsYXRpb25zKHNjaGVtYSk7XG4gICAgdGhpcy52YWxpZGF0ZUZpZWxkTWV0YWRhdGEoc2NoZW1hKTtcbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVFbGVjdHJvREJTY2hlbWE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uXG4gICk6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICBuZXcgRW50aXR5KHNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbnMpO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRWxlY3Ryb0RCIHNjaGVtYSB2YWxpZGF0aW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVNb2RlbERlZmluaXRpb248UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIC8vIE9wdGlvbmFsIGJ1dCB0eXBlZCBtb2RlbCBwcm9wZXJ0aWVzXG4gICAgaWYgKHNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsICYmIHR5cGVvZiBzY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGVycm9ycy5wdXNoKCdlbnRpdHlOYW1lUGx1cmFsIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9XG5cbiAgICBpZiAoc2NoZW1hLm1vZGVsLmVudGl0eU1lbnVJY29uICYmIHR5cGVvZiBzY2hlbWEubW9kZWwuZW50aXR5TWVudUljb24gIT09ICdzdHJpbmcnKSB7XG4gICAgICBlcnJvcnMucHVzaCgnZW50aXR5TWVudUljb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgIH1cblxuICAgIC8vIEJvb2xlYW4gZmxhZ3MgdmFsaWRhdGlvblxuICAgIGNvbnN0IGJvb2xlYW5GbGFncyA9IFtcbiAgICAgICdleGNsdWRlRnJvbUFkbWluTWVudScsXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbkxpc3QnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EZWxldGUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EdXBsaWNhdGUnXG4gICAgXSBhcyBjb25zdDtcblxuICAgIGZvciAoY29uc3QgZmxhZyBvZiBib29sZWFuRmxhZ3MpIHtcbiAgICAgIGlmIChzY2hlbWEubW9kZWxbIGZsYWcgXSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBzY2hlbWEubW9kZWxbIGZsYWcgXSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGAke2ZsYWd9IG11c3QgYmUgYSBib29sZWFuYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsIGRlZmluaXRpb24gdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZURpc3BsYXlPdmVycmlkZXM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oc2NoZW1hOiBTKTogdm9pZCB7XG4gICAgY29uc3QgdWkgPSBzY2hlbWEubW9kZWwuZGlzcGxheU92ZXJyaWRlcztcbiAgICBpZiAodWkgPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuXG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGlmICghdWkgfHwgdHlwZW9mIHVpICE9PSAnb2JqZWN0Jykge1xuICAgICAgZXJyb3JzLnB1c2goJ2Rpc3BsYXlPdmVycmlkZXMgbXVzdCBiZSBhbiBvYmplY3QnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHR5cGVvZiB1aS5zdG9yYWdlQXR0cmlidXRlICE9PSAnc3RyaW5nJyB8fCAhdWkuc3RvcmFnZUF0dHJpYnV0ZS50cmltKCkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goJ2Rpc3BsYXlPdmVycmlkZXMuc3RvcmFnZUF0dHJpYnV0ZSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZycpO1xuICAgICAgfSBlbHNlIGlmICghKHVpLnN0b3JhZ2VBdHRyaWJ1dGUgaW4gc2NoZW1hLmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBkaXNwbGF5T3ZlcnJpZGVzLnN0b3JhZ2VBdHRyaWJ1dGUgXCIke3VpLnN0b3JhZ2VBdHRyaWJ1dGV9XCIgbXVzdCBuYW1lIGFuIGV4aXN0aW5nIGF0dHJpYnV0ZWApO1xuICAgICAgfVxuICAgICAgaWYgKHVpLmxhYmVsICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHVpLmxhYmVsICE9PSAnc3RyaW5nJykge1xuICAgICAgICBlcnJvcnMucHVzaCgnZGlzcGxheU92ZXJyaWRlcy5sYWJlbCBtdXN0IGJlIGEgc3RyaW5nIHdoZW4gcHJvdmlkZWQnKTtcbiAgICAgIH1cbiAgICAgIGlmICh1aS5jaGFubmVscyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheSh1aS5jaGFubmVscykgfHwgIXVpLmNoYW5uZWxzLmV2ZXJ5KGMgPT4gdHlwZW9mIGMgPT09ICdzdHJpbmcnKSkge1xuICAgICAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzLmNoYW5uZWxzIG11c3QgYmUgYW4gYXJyYXkgb2Ygc3RyaW5ncyB3aGVuIHByb3ZpZGVkJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICh1aS5hbGxvd0xpc3RJdGVtUGF0aHMgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgdWkuYWxsb3dMaXN0SXRlbVBhdGhzICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goJ2Rpc3BsYXlPdmVycmlkZXMuYWxsb3dMaXN0SXRlbVBhdGhzIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJvdmlkZWQnKTtcbiAgICAgIH1cbiAgICAgIGlmICh1aS5maWVsZHMgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheSh1aS5maWVsZHMpKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzLmZpZWxkcyBtdXN0IGJlIGFuIGFycmF5IHdoZW4gcHJvdmlkZWQnKTtcbiAgICAgIH1cbiAgICAgIGlmICh1aS5hdXRvICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHVpLmF1dG8gIT09ICdib29sZWFuJykge1xuICAgICAgICBlcnJvcnMucHVzaCgnZGlzcGxheU92ZXJyaWRlcy5hdXRvIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJvdmlkZWQnKTtcbiAgICAgIH1cbiAgICAgIGlmIChcbiAgICAgICAgdWkuYXV0b01vZGUgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAhWyAnZWRpdGFibGVWaXNpYmxlJywgJ2FsbE5vblJlbGF0aW9uJyBdLmluY2x1ZGVzKHVpLmF1dG9Nb2RlKVxuICAgICAgKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzLmF1dG9Nb2RlIG11c3QgYmUgb25lIG9mOiBlZGl0YWJsZVZpc2libGUsIGFsbE5vblJlbGF0aW9uJyk7XG4gICAgICB9XG4gICAgICBpZiAodWkuZXhjbHVkZVBhdGhzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHVpLmV4Y2x1ZGVQYXRocykgfHwgIXVpLmV4Y2x1ZGVQYXRocy5ldmVyeSgocDogdW5rbm93bikgPT4gdHlwZW9mIHAgPT09ICdzdHJpbmcnKSkge1xuICAgICAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzLmV4Y2x1ZGVQYXRocyBtdXN0IGJlIHN0cmluZ1tdIHdoZW4gcHJvdmlkZWQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHVpLmRlZmF1bHRDaHJvbWUgIT09IHVuZGVmaW5lZCAmJiAhWyAndGFnJywgJ2JhZGdlJywgJ291dGxpbmUnLCAnbm9uZScgXS5pbmNsdWRlcyh1aS5kZWZhdWx0Q2hyb21lKSkge1xuICAgICAgICBlcnJvcnMucHVzaCgnZGlzcGxheU92ZXJyaWRlcy5kZWZhdWx0Q2hyb21lIG11c3QgYmUgb25lIG9mOiB0YWcsIGJhZGdlLCBvdXRsaW5lLCBub25lJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYERpc3BsYXkgb3ZlcnJpZGVzIFVJIHZhbGlkYXRpb24gZmFpbGVkOlxcbiR7ZXJyb3JzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cblxuICAgIHRoaXMudmFsaWRhdGVEaXNwbGF5T3ZlcnJpZGVGaWVsZFBhdGhzKHNjaGVtYSwgdWkpO1xuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZURpc3BsYXlPdmVycmlkZUZpZWxkUGF0aHM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIHVpOiBOb25OdWxsYWJsZTxTWyAnbW9kZWwnIF1bICdkaXNwbGF5T3ZlcnJpZGVzJyBdPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBmaWVsZHMgPSB1aS5maWVsZHM7XG4gICAgaWYgKCFmaWVsZHM/Lmxlbmd0aCkgcmV0dXJuO1xuXG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBwcmltYXJ5ID0gc2NoZW1hLmluZGV4ZXM/LnByaW1hcnkgYXMgdW5rbm93biBhcyB7XG4gICAgICBwaz86IHsgY29tcG9zaXRlPzogcmVhZG9ubHkgc3RyaW5nW10gfTtcbiAgICAgIHNrPzogeyBjb21wb3NpdGU/OiByZWFkb25seSBzdHJpbmdbXSB9O1xuICAgIH0gfCB1bmRlZmluZWQ7XG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgaWYgKHByaW1hcnk/LnBrPy5jb21wb3NpdGUpIHtcbiAgICAgIGZvciAoY29uc3QgYSBvZiBwcmltYXJ5LnBrLmNvbXBvc2l0ZSkgcHJpbWFyeUtleUF0dHJzLmFkZChTdHJpbmcoYSkpO1xuICAgIH1cbiAgICBpZiAocHJpbWFyeT8uc2s/LmNvbXBvc2l0ZSkge1xuICAgICAgZm9yIChjb25zdCBhIG9mIHByaW1hcnkuc2suY29tcG9zaXRlKSBwcmltYXJ5S2V5QXR0cnMuYWRkKFN0cmluZyhhKSk7XG4gICAgfVxuXG4gICAgY29uc3QgYWxsb3dMaXN0SW5kZXggPSB1aS5hbGxvd0xpc3RJdGVtUGF0aHMgPT09IHRydWU7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHVpLnN0b3JhZ2VBdHRyaWJ1dGU7XG4gICAgY29uc3QgYXV0b0V4Y2x1ZGVQYXRocyA9IHVpLmV4Y2x1ZGVQYXRocyA/PyBbXTtcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZmllbGRzKSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeS5wYXRoICE9PSAnc3RyaW5nJyB8fCAhZW50cnkucGF0aC50cmltKCkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goJ2Rpc3BsYXlPdmVycmlkZXMuZmllbGRzW106IGVhY2ggZW50cnkgbXVzdCBoYXZlIGEgbm9uLWVtcHR5IHBhdGgnKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBwYXRoID0gZW50cnkucGF0aC50cmltKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMocGF0aCkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYGR1cGxpY2F0ZSBkaXNwbGF5T3ZlcnJpZGUgcGF0aCBcIiR7cGF0aH1cImApO1xuICAgICAgfVxuICAgICAgc2Vlbi5hZGQocGF0aCk7XG4gICAgICBpZiAocGF0aCA9PT0gc3RvcmFnZSB8fCBwYXRoLnN0YXJ0c1dpdGgoYCR7c3RvcmFnZX0uYCkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYHBhdGggXCIke3BhdGh9XCIgbXVzdCBub3QgdGFyZ2V0IHRoZSBvdmVycmlkZSBzdG9yYWdlIGF0dHJpYnV0ZWApO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmFzc2VydFZhbGlkRGlzcGxheU92ZXJyaWRlUGF0aChzY2hlbWEsIHBhdGgsIGFsbG93TGlzdEluZGV4LCBwcmltYXJ5S2V5QXR0cnMpO1xuICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGUubWVzc2FnZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChlbnRyeS5jaGFubmVscyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShlbnRyeS5jaGFubmVscykgfHwgIWVudHJ5LmNoYW5uZWxzLmV2ZXJ5KGMgPT4gdHlwZW9mIGMgPT09ICdzdHJpbmcnKSkge1xuICAgICAgICAgIGVycm9ycy5wdXNoKGBkaXNwbGF5T3ZlcnJpZGVzLmZpZWxkcyBjaGFubmVscyBmb3IgXCIke3BhdGh9XCIgbXVzdCBiZSBzdHJpbmdbXWApO1xuICAgICAgICB9IGVsc2UgaWYgKHVpLmNoYW5uZWxzPy5sZW5ndGgpIHtcbiAgICAgICAgICBjb25zdCBvayA9IG5ldyBTZXQodWkuY2hhbm5lbHMpO1xuICAgICAgICAgIGZvciAoY29uc3QgYyBvZiBlbnRyeS5jaGFubmVscykge1xuICAgICAgICAgICAgaWYgKCFvay5oYXMoYykpIHtcbiAgICAgICAgICAgICAgZXJyb3JzLnB1c2goYGZpZWxkIFwiJHtwYXRofVwiIGNoYW5uZWwgXCIke2N9XCIgaXMgbm90IGxpc3RlZCBpbiBkaXNwbGF5T3ZlcnJpZGVzLmNoYW5uZWxzYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZW50cnkuY2hyb21lICE9PSB1bmRlZmluZWQgJiYgIVsgJ3RhZycsICdiYWRnZScsICdvdXRsaW5lJywgJ25vbmUnIF0uaW5jbHVkZXMoZW50cnkuY2hyb21lKSkge1xuICAgICAgICBlcnJvcnMucHVzaChgaW52YWxpZCBjaHJvbWUgb24gZGlzcGxheU92ZXJyaWRlIHBhdGggXCIke3BhdGh9XCJgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHBhdGhSYXcgb2YgYXV0b0V4Y2x1ZGVQYXRocykge1xuICAgICAgaWYgKHR5cGVvZiBwYXRoUmF3ICE9PSAnc3RyaW5nJyB8fCAhcGF0aFJhdy50cmltKCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgcGF0aCA9IHBhdGhSYXcudHJpbSgpO1xuICAgICAgaWYgKHBhdGggPT09IHN0b3JhZ2UgfHwgcGF0aC5zdGFydHNXaXRoKGAke3N0b3JhZ2V9LmApKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBhdXRvIGV4Y2x1ZGUgcGF0aCBcIiR7cGF0aH1cIiBtdXN0IG5vdCB0YXJnZXQgdGhlIG92ZXJyaWRlIHN0b3JhZ2UgYXR0cmlidXRlYCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5hc3NlcnRWYWxpZERpc3BsYXlPdmVycmlkZVBhdGgoc2NoZW1hLCBwYXRoLCBhbGxvd0xpc3RJbmRleCwgcHJpbWFyeUtleUF0dHJzKTtcbiAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICBlcnJvcnMucHVzaChgZGlzcGxheU92ZXJyaWRlcy5leGNsdWRlUGF0aHMgaW52YWxpZCBwYXRoIFwiJHtwYXRofVwiOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRGlzcGxheSBvdmVycmlkZXMgVUkgdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3NlcnRWYWxpZERpc3BsYXlPdmVycmlkZVBhdGg8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIHBhdGg6IHN0cmluZyxcbiAgICBhbGxvd0xpc3RJbmRleDogYm9vbGVhbixcbiAgICBwcmltYXJ5S2V5QXR0cnM6IFNldDxzdHJpbmc+XG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLicpLmZpbHRlcihwID0+IHAubGVuZ3RoID4gMCk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBpbnZhbGlkIGVtcHR5IGRpc3BsYXlPdmVycmlkZSBwYXRoYCk7XG4gICAgfVxuXG4gICAgY29uc3Qgd2FsayA9IChhdHRyczogUmVjb3JkPHN0cmluZywgYW55Piwgc3RhcnQ6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgICAgaWYgKHN0YXJ0ID49IHBhcnRzLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGludmFsaWQgcGF0aCBcIiR7cGF0aH1cImApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJ0ID0gcGFydHNbIHN0YXJ0IF07XG4gICAgICBpZiAoL15cXGQrJC8udGVzdChwYXJ0KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIgaXMgaW52YWxpZCBhdCBcIiR7cGFydH1cIiDigJQgdW5leHBlY3RlZCBsaXN0IGluZGV4YCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGF0dHIgPSBhdHRyc1sgcGFydCBdO1xuICAgICAgaWYgKCFhdHRyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgcGF0aCBcIiR7cGF0aH1cIiDigJQgdW5rbm93biBhdHRyaWJ1dGUgXCIke3BhcnR9XCJgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXJ0ID09PSBwYXJ0cy5sZW5ndGggLSAxKSB7XG4gICAgICAgIGlmIChhdHRyLnJlbGF0aW9uKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBwYXRoIFwiJHtwYXRofVwiIG11c3Qgbm90IHRhcmdldCBhIHJlbGF0aW9uIGZpZWxkYCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMSAmJiBwcmltYXJ5S2V5QXR0cnMuaGFzKHBhcnQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBwYXRoIFwiJHtwYXRofVwiIG11c3Qgbm90IHRhcmdldCBhIHByaW1hcnkgaW5kZXgga2V5IGF0dHJpYnV0ZWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHIudHlwZSA9PT0gJ21hcCcgJiYgYXR0ci5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIHdhbGsoYXR0ci5wcm9wZXJ0aWVzIGFzIFJlY29yZDxzdHJpbmcsIGFueT4sIHN0YXJ0ICsgMSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHIudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIGlmICghYWxsb3dMaXN0SW5kZXgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIgdHJhdmVyc2VzIGEgbGlzdCBidXQgYWxsb3dMaXN0SXRlbVBhdGhzIGlzIG5vdCB0cnVlYCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ICsgMSA+PSBwYXJ0cy5sZW5ndGgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIg4oCUIGV4cGVjdGVkIGluZGV4IGFmdGVyIGxpc3QgYXR0cmlidXRlIFwiJHtwYXJ0fVwiYCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaWR4ID0gcGFydHNbIHN0YXJ0ICsgMSBdO1xuICAgICAgICBpZiAoIS9eXFxkKyQvLnRlc3QoaWR4KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgcGF0aCBcIiR7cGF0aH1cIiDigJQgZXhwZWN0ZWQgbnVtZXJpYyBpbmRleCBhZnRlciBcIiR7cGFydH1cImApO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhdHRyLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBhdHRyLml0ZW1zLnByb3BlcnRpZXMpIHtcbiAgICAgICAgICB3YWxrKGF0dHIuaXRlbXMucHJvcGVydGllcyBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+LCBzdGFydCArIDIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIg4oCUIGxpc3QgXCIke3BhcnR9XCIgbXVzdCBoYXZlIG1hcCBpdGVtcyB0byB0cmF2ZXJzZWApO1xuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIg4oCUIGNhbm5vdCB0cmF2ZXJzZSBpbnRvIFwiJHtwYXJ0fVwiYCk7XG4gICAgfTtcblxuICAgIHdhbGsoc2NoZW1hLmF0dHJpYnV0ZXMgYXMgUmVjb3JkPHN0cmluZywgYW55PiwgMCk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlUmVsYXRpb25zPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogU1xuICApOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IFsgYXR0ck5hbWUsIGF0dHIgXSBvZiBPYmplY3QuZW50cmllcyhzY2hlbWEuYXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghYXR0ci5yZWxhdGlvbikgY29udGludWU7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIDEuIFZhbGlkYXRlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgaWYgKCFhdHRyLnJlbGF0aW9uLmVudGl0eU5hbWUgfHwgIWF0dHIucmVsYXRpb24udHlwZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUmVsYXRpb24gbXVzdCBzcGVjaWZ5IGVudGl0eU5hbWUgYW5kIHR5cGUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDIuIFZhbGlkYXRlIHJlbGF0aW9uIHR5cGVcbiAgICAgICAgaWYgKCFbICdvbmUtdG8tbWFueScsICdtYW55LXRvLW9uZScgXS5pbmNsdWRlcyhhdHRyLnJlbGF0aW9uLnR5cGUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uIHR5cGUgXCIke2F0dHIucmVsYXRpb24udHlwZX1cImApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gMy4gVmFsaWRhdGUgcmVsYXRlZCBlbnRpdHkgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEoYXR0ci5yZWxhdGlvbi5lbnRpdHlOYW1lKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVsYXRlZCBlbnRpdHkgXCIke2F0dHIucmVsYXRpb24uZW50aXR5TmFtZX1cIiBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDQuIFZhbGlkYXRlIGlkZW50aWZpZXJzXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzID0gdHlwZW9mIGF0dHIucmVsYXRpb24uaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICA/IGF0dHIucmVsYXRpb24uaWRlbnRpZmllcnMoKVxuICAgICAgICAgIDogYXR0ci5yZWxhdGlvbi5pZGVudGlmaWVycztcblxuICAgICAgICBpZiAoIWlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZWxhdGlvbiBtdXN0IHNwZWNpZnkgaWRlbnRpZmllcnMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzTGlzdCA9IEFycmF5LmlzQXJyYXkoaWRlbnRpZmllcnMpID8gaWRlbnRpZmllcnMgOiBbIGlkZW50aWZpZXJzIF07XG4gICAgICAgIGNvbnN0IHJlbGF0ZWRTY2hlbWEgPSB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTY2hlbWE8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihhdHRyLnJlbGF0aW9uLmVudGl0eU5hbWUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBpZGVudGlmaWVyc0xpc3QpIHtcbiAgICAgICAgICBpZiAoIWlkZW50aWZpZXIuc291cmNlIHx8ICFpZGVudGlmaWVyLnRhcmdldCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJZGVudGlmaWVyIG11c3Qgc3BlY2lmeSBzb3VyY2UgYW5kIHRhcmdldCcpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFZhbGlkYXRlIHRhcmdldCBleGlzdHMgaW4gcmVsYXRlZCBlbnRpdHlcbiAgICAgICAgICBpZiAoIShpZGVudGlmaWVyLnRhcmdldCBpbiByZWxhdGVkU2NoZW1hLmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRhcmdldCBhdHRyaWJ1dGUgXCIke1N0cmluZyhpZGVudGlmaWVyLnRhcmdldCl9XCIgbm90IGZvdW5kIGluIHJlbGF0ZWQgZW50aXR5YCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVmFsaWRhdGUgc291cmNlIHBhdGggZXhpc3RzIGluIGN1cnJlbnQgZW50aXR5XG4gICAgICAgICAgY29uc3Qgc291cmNlUGFydHMgPSBpZGVudGlmaWVyLnNvdXJjZS5zcGxpdCgnLicpO1xuICAgICAgICAgIGxldCBjdXJyZW50U2NoZW1hOiBhbnkgPSBzY2hlbWE7XG4gICAgICAgICAgbGV0IGN1cnJlbnRQYXRoID0gJyc7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2Ygc291cmNlUGFydHMpIHtcbiAgICAgICAgICAgIGN1cnJlbnRQYXRoID0gY3VycmVudFBhdGggPyBgJHtjdXJyZW50UGF0aH0uJHtwYXJ0fWAgOiBwYXJ0O1xuXG4gICAgICAgICAgICBpZiAoIWN1cnJlbnRTY2hlbWEuYXR0cmlidXRlcyB8fCAhKHBhcnQgaW4gY3VycmVudFNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNvdXJjZSBwYXRoIFwiJHtpZGVudGlmaWVyLnNvdXJjZX1cIiBpbnZhbGlkIGF0IFwiJHtwYXJ0fVwiYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRBdHRyID0gY3VycmVudFNjaGVtYS5hdHRyaWJ1dGVzWyBwYXJ0IF07XG5cbiAgICAgICAgICAgIC8vIElmIHRoaXMgaXMgdGhlIGxhc3QgcGFydCwgd2UgZG9uJ3QgbmVlZCB0byB0cmF2ZXJzZSBmdXJ0aGVyXG4gICAgICAgICAgICBpZiAocGFydCA9PT0gc291cmNlUGFydHNbIHNvdXJjZVBhcnRzLmxlbmd0aCAtIDEgXSkge1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRm9yIG1hcCB0eXBlcywgdHJhdmVyc2UgaW50byB0aGVpciBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBpZiAoY3VycmVudEF0dHIudHlwZSA9PT0gJ21hcCcgJiYgY3VycmVudEF0dHIucHJvcGVydGllcykge1xuICAgICAgICAgICAgICBjdXJyZW50U2NoZW1hID0geyBhdHRyaWJ1dGVzOiBjdXJyZW50QXR0ci5wcm9wZXJ0aWVzIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNvdXJjZSBwYXRoIFwiJHtpZGVudGlmaWVyLnNvdXJjZX1cIiBpbnZhbGlkIGF0IFwiJHtwYXJ0fVwiIC0gZXhwZWN0ZWQgbWFwIHR5cGVgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICBlcnJvcnMucHVzaChgSW52YWxpZCByZWxhdGlvbiBmb3IgYXR0cmlidXRlIFwiJHthdHRyTmFtZX1cIjogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnMgdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUZpZWxkTWV0YWRhdGE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgWyBhdHRyTmFtZSwgYXR0ciBdIG9mIE9iamVjdC5lbnRyaWVzKHNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gVmFsaWRhdGUgZmllbGQgdHlwZSBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGF0dHIuZmllbGRUeXBlKSB7XG4gICAgICAgICAgY29uc3QgdmFsaWRGaWVsZFR5cGVzID0gW1xuICAgICAgICAgICAgLy8gVGV4dCBmaWVsZHNcbiAgICAgICAgICAgICd0ZXh0JywgJ3RleHRhcmVhJywgJ3Bhc3N3b3JkJyxcbiAgICAgICAgICAgIC8vIE51bWJlciBmaWVsZHNcbiAgICAgICAgICAgICdudW1iZXInLFxuICAgICAgICAgICAgLy8gRGF0ZS9UaW1lIGZpZWxkc1xuICAgICAgICAgICAgJ2RhdGUnLCAndGltZScsICdkYXRldGltZScsICdkdXJhdGlvbicsICd0dGwnLFxuICAgICAgICAgICAgLy8gQm9vbGVhbiBmaWVsZHNcbiAgICAgICAgICAgICdib29sZWFuJywgJ3N3aXRjaCcsICd0b2dnbGUnLFxuICAgICAgICAgICAgLy8gU2VsZWN0aW9uIGZpZWxkc1xuICAgICAgICAgICAgJ3NlbGVjdCcsICdtdWx0aS1zZWxlY3QnLCAnYXV0b2NvbXBsZXRlJywgJ3JhZGlvJywgJ2NoZWNrYm94JyxcbiAgICAgICAgICAgIC8vIEZpbGUgZmllbGRzXG4gICAgICAgICAgICAnZmlsZScsICdpbWFnZScsXG4gICAgICAgICAgICAvLyBPdGhlciBmaWVsZHNcbiAgICAgICAgICAgICdjb2xvcicsICdyYW5nZScsICdoaWRkZW4nLCAnY3VzdG9tJywgJ3JhdGluZycsXG4gICAgICAgICAgICAncmljaC10ZXh0JywgJ3d5c2l3eWcnLCAnY29kZScsICdtYXJrZG93bicsICdqc29uJ1xuICAgICAgICAgIF07XG5cbiAgICAgICAgICBpZiAoIXZhbGlkRmllbGRUeXBlcy5pbmNsdWRlcyhhdHRyLmZpZWxkVHlwZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmaWVsZCB0eXBlIFwiJHthdHRyLmZpZWxkVHlwZX1cImApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFZhbGlkYXRlIGZpZWxkIHR5cGUgc3BlY2lmaWMgcmVxdWlyZW1lbnRzXG4gICAgICAgICAgc3dpdGNoIChhdHRyLmZpZWxkVHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnc2VsZWN0JzpcbiAgICAgICAgICAgIGNhc2UgJ211bHRpLXNlbGVjdCc6XG4gICAgICAgICAgICBjYXNlICdhdXRvY29tcGxldGUnOlxuICAgICAgICAgICAgY2FzZSAncmFkaW8nOlxuICAgICAgICAgICAgY2FzZSAnY2hlY2tib3gnOlxuICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlU2VsZWN0RmllbGRNZXRhZGF0YShhdHRyIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgJ2ZpbGUnOlxuICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlRmlsZUZpZWxkTWV0YWRhdGEoYXR0ciBhcyBGaWxlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWUpO1xuICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgY2FzZSAnaW1hZ2UnOlxuICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlSW1hZ2VGaWVsZE1ldGFkYXRhKGF0dHIgYXMgSW1hZ2VGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICBjYXNlICdudW1iZXInOlxuICAgICAgICAgICAgY2FzZSAncmFuZ2UnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IG51bWJlckF0dHIgPSBhdHRyIGFzIEZpZWxkTWV0YWRhdGEgJiB7IG1pbj86IG51bWJlcjsgbWF4PzogbnVtYmVyIH07XG4gICAgICAgICAgICAgIGlmIChudW1iZXJBdHRyLm1pbiAhPT0gdW5kZWZpbmVkICYmIG51bWJlckF0dHIubWF4ICE9PSB1bmRlZmluZWQgJiYgbnVtYmVyQXR0ci5taW4gPiBudW1iZXJBdHRyLm1heCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWluaW11bSB2YWx1ZSAoJHtudW1iZXJBdHRyLm1pbn0pIGNhbm5vdCBiZSBncmVhdGVyIHRoYW4gbWF4aW11bSB2YWx1ZSAoJHtudW1iZXJBdHRyLm1heH0pYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ2RhdGUnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRhdGVBdHRyID0gYXR0ciBhcyBGaWVsZE1ldGFkYXRhICYgeyBtaW5EYXRlPzogRGF0ZTsgbWF4RGF0ZT86IERhdGUgfTtcbiAgICAgICAgICAgICAgaWYgKGRhdGVBdHRyLm1pbkRhdGUgJiYgZGF0ZUF0dHIubWF4RGF0ZSAmJiBkYXRlQXR0ci5taW5EYXRlID4gZGF0ZUF0dHIubWF4RGF0ZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWluaW11bSBkYXRlIGNhbm5vdCBiZSBncmVhdGVyIHRoYW4gbWF4aW11bSBkYXRlYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ2RhdGV0aW1lJzoge1xuICAgICAgICAgICAgICBjb25zdCBkYXRlVGltZUF0dHIgPSBhdHRyIGFzIEZpZWxkTWV0YWRhdGEgJiB7IG1pbkRhdGVUaW1lPzogRGF0ZTsgbWF4RGF0ZVRpbWU/OiBEYXRlIH07XG4gICAgICAgICAgICAgIGlmIChkYXRlVGltZUF0dHIubWluRGF0ZVRpbWUgJiYgZGF0ZVRpbWVBdHRyLm1heERhdGVUaW1lICYmIGRhdGVUaW1lQXR0ci5taW5EYXRlVGltZSA+IGRhdGVUaW1lQXR0ci5tYXhEYXRlVGltZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWluaW11bSBkYXRlIHRpbWUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIGRhdGUgdGltZWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjYXNlICd0aW1lJzoge1xuICAgICAgICAgICAgICBjb25zdCB0aW1lQXR0ciA9IGF0dHIgYXMgRmllbGRNZXRhZGF0YSAmIHsgbWluVGltZT86IHN0cmluZzsgbWF4VGltZT86IHN0cmluZyB9O1xuICAgICAgICAgICAgICBpZiAodGltZUF0dHIubWluVGltZSAmJiB0aW1lQXR0ci5tYXhUaW1lICYmIHRpbWVBdHRyLm1pblRpbWUgPiB0aW1lQXR0ci5tYXhUaW1lKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIHRpbWUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIHRpbWVgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBib29sZWFuIGZsYWdzXG4gICAgICAgIGNvbnN0IGJvb2xlYW5GbGFnczogKGtleW9mIEZpZWxkTWV0YWRhdGEpW10gPSBbXG4gICAgICAgICAgJ2lzVmlzaWJsZScsXG4gICAgICAgICAgJ2lzTGlzdGFibGUnLFxuICAgICAgICAgICdpc0NyZWF0YWJsZScsXG4gICAgICAgICAgJ2lzRWRpdGFibGUnLFxuICAgICAgICAgICdpc0ZpbHRlcmFibGUnLFxuICAgICAgICAgICdpc1NlYXJjaGFibGUnXG4gICAgICAgIF07XG5cbiAgICAgICAgZm9yIChjb25zdCBmbGFnIG9mIGJvb2xlYW5GbGFncykge1xuICAgICAgICAgIGlmIChhdHRyWyBmbGFnIF0gIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgYXR0clsgZmxhZyBdICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtmbGFnfSBtdXN0IGJlIGEgYm9vbGVhbmApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIGZpZWxkIG1ldGFkYXRhIGZvciBcIiR7YXR0ck5hbWV9XCI6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmllbGQgbWV0YWRhdGEgdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZVNlbGVjdEZpZWxkTWV0YWRhdGEoYXR0cjogU2VsZWN0RmllbGRNZXRhZGF0YSwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICghYXR0ci5vcHRpb25zKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlbGVjdCBmaWVsZCBtdXN0IHNwZWNpZnkgb3B0aW9ucycpO1xuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHIub3B0aW9ucykpIHtcbiAgICAgIC8vIFN0YXRpYyBvcHRpb25zXG4gICAgICBpZiAoYXR0ci5vcHRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlbGVjdCBmaWVsZCBvcHRpb25zIGFycmF5IGNhbm5vdCBiZSBlbXB0eScpO1xuICAgICAgfVxuICAgICAgaWYgKCFhdHRyLm9wdGlvbnMuZXZlcnkob3B0ID0+ICd2YWx1ZScgaW4gb3B0ICYmICdsYWJlbCcgaW4gb3B0KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN0YXRpYyBvcHRpb25zIG11c3QgaGF2ZSB2YWx1ZSBhbmQgbGFiZWwgcHJvcGVydGllcyBmb3IgXCIke2F0dHJOYW1lfVwiYCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgYXR0ci5vcHRpb25zID09PSAnb2JqZWN0JyAmJiAoJ2FwaU1ldGhvZCcgaW4gYXR0ci5vcHRpb25zIHx8ICdhcGlVcmwnIGluIGF0dHIub3B0aW9ucyB8fCAncmVzcG9uc2VLZXknIGluIGF0dHIub3B0aW9ucykpIHtcbiAgICAgIC8vIER5bmFtaWMgb3B0aW9ucyAoQVBJIGNvbmZpZykgLSBjaGVjayBmb3IgYW55IEFQSSBjb25maWcgcHJvcGVydHkgdG8gcHJvcGVybHkgdmFsaWRhdGUgaW5jb21wbGV0ZSBjb25maWdzXG4gICAgICB0aGlzLnZhbGlkYXRlT3B0aW9uc0FQSUNvbmZpZyhhdHRyLm9wdGlvbnMgYXMgRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4sIGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRHluYW1pYyBvcHRpb25zXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb3B0aW9ucyBjb25maWd1cmF0aW9uIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICB9XG5cbiAgICBpZiAoYXR0ci5hZGROZXdPcHRpb24pIHtcbiAgICAgIGlmICghdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEoYXR0ci5hZGROZXdPcHRpb24uZW50aXR5TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnRpdHkgXCIke2F0dHIuYWRkTmV3T3B0aW9uLmVudGl0eU5hbWV9XCIgZm9yIGFkZE5ld09wdGlvbiBub3QgZm91bmQgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVPcHRpb25zQVBJQ29uZmlnKGNvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4sIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIWNvbmZpZy5hcGlVcmwgfHwgIWNvbmZpZy5yZXNwb25zZUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb25zIEFQSSBjb25maWcgbXVzdCBzcGVjaWZ5IGFwaVVybCBhbmQgcmVzcG9uc2VLZXkgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcuYXBpTWV0aG9kICYmICFbICdHRVQnLCAnUE9TVCcgXS5pbmNsdWRlcyhjb25maWcuYXBpTWV0aG9kKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIEFQSSBtZXRob2QgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcub3B0aW9uTWFwcGluZykge1xuICAgICAgaWYgKCFjb25maWcub3B0aW9uTWFwcGluZy5sYWJlbCB8fCAhY29uZmlnLm9wdGlvbk1hcHBpbmcudmFsdWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb24gbWFwcGluZyBtdXN0IHNwZWNpZnkgbGFiZWwgYW5kIHZhbHVlIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlRmlsZUZpZWxkTWV0YWRhdGEoYXR0cjogRmlsZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoYXR0ci5nZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWcpIHtcbiAgICAgIGNvbnN0IHsgYXBpVXJsLCBhcGlNZXRob2QgfSA9IGF0dHIuZ2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnO1xuICAgICAgaWYgKCFhcGlVcmwgfHwgIVsgJ0dFVCcsICdQT1NUJyBdLmluY2x1ZGVzKGFwaU1ldGhvZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNpZ25lZCB1cGxvYWQgVVJMIGNvbmZpZ3VyYXRpb24gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhdHRyLm1heEZpbGVTaXplICYmIHR5cGVvZiBhdHRyLm1heEZpbGVTaXplICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBtYXhGaWxlU2l6ZSBtdXN0IGJlIGEgbnVtYmVyIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlSW1hZ2VGaWVsZE1ldGFkYXRhKGF0dHI6IEltYWdlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMudmFsaWRhdGVGaWxlRmllbGRNZXRhZGF0YShhdHRyIGFzIEZpbGVGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG5cbiAgICBpZiAoYXR0ci53aXRoSW1hZ2VDcm9wICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGF0dHIud2l0aEltYWdlQ3JvcCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhJbWFnZUNyb3AgbXVzdCBiZSBhIGJvb2xlYW4gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cbiAgfVxufSJdfQ==