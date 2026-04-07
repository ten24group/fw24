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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNjaGVtYS12YWxpZGF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw0Q0FBNEM7OztBQUU1Qyx5Q0FBd0Q7QUFZeEQsTUFBYSxxQkFBcUI7SUFDSDtJQUE3QixZQUE2QixXQUF5QjtRQUF6QixnQkFBVyxHQUFYLFdBQVcsQ0FBYztJQUFJLENBQUM7SUFFcEQsY0FBYyxDQUNuQixNQUFTLEVBQ1Qsb0JBQXlDO1FBRXpDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzRCxJQUFJLENBQUMsdUJBQXVCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDckMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUMvQixJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDckMsQ0FBQztJQUVPLHVCQUF1QixDQUM3QixNQUFTLEVBQ1Qsb0JBQXlDO1FBRXpDLElBQUksQ0FBQztZQUNILElBQUksa0JBQU0sQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzQyxDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUMxRSxDQUFDO0lBQ0gsQ0FBQztJQUVPLHVCQUF1QixDQUM3QixNQUFTO1FBRVQsTUFBTSxNQUFNLEdBQWEsRUFBRSxDQUFDO1FBRTVCLHNDQUFzQztRQUN0QyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLElBQUksT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLGdCQUFnQixLQUFLLFFBQVEsRUFB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LElBQUksT0FBTyxJQUFJLENBQUMsV0FBVyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzdELE1BQU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDcEUsQ0FBQztJQUNILENBQUM7SUFFTywwQkFBMEIsQ0FBQyxJQUF3QixFQUFFLFFBQWdCO1FBQzNFLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxJQUF5QixFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBRXBFLElBQUksSUFBSSxDQUFDLGFBQWEsS0FBSyxTQUFTLElBQUksT0FBTyxJQUFJLENBQUMsYUFBYSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2hGLE1BQU0sSUFBSSxLQUFLLENBQUMsd0NBQXdDLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDdkUsQ0FBQztJQUNILENBQUM7Q0FDRjtBQWhnQkQsc0RBZ2dCQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIHNyYy9lbnRpdHkvdmFsaWRhdG9ycy9zY2hlbWEtdmFsaWRhdG9yLnRzXG5cbmltcG9ydCB7IEVudGl0eSwgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gXCJlbGVjdHJvZGJcIjtcbmltcG9ydCB7XG4gIEVudGl0eVNjaGVtYSxcbiAgRmllbGRNZXRhZGF0YSxcbiAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgRmlsZUZpZWxkTWV0YWRhdGEsXG4gIEltYWdlRmllbGRNZXRhZGF0YSxcbiAgRmllbGRPcHRpb25zQVBJQ29uZmlnLFxufSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHsgSURJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuXG5leHBvcnQgY2xhc3MgRW50aXR5U2NoZW1hVmFsaWRhdG9yIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBkaUNvbnRhaW5lcjogSURJQ29udGFpbmVyKSB7IH1cblxuICBwdWJsaWMgdmFsaWRhdGVTY2hlbWE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uXG4gICk6IHZvaWQge1xuICAgIHRoaXMudmFsaWRhdGVFbGVjdHJvREJTY2hlbWEoc2NoZW1hLCBlbnRpdHlDb25maWd1cmF0aW9ucyk7XG4gICAgdGhpcy52YWxpZGF0ZU1vZGVsRGVmaW5pdGlvbihzY2hlbWEpO1xuICAgIHRoaXMudmFsaWRhdGVEaXNwbGF5T3ZlcnJpZGVzKHNjaGVtYSk7XG4gICAgdGhpcy52YWxpZGF0ZVJlbGF0aW9ucyhzY2hlbWEpO1xuICAgIHRoaXMudmFsaWRhdGVGaWVsZE1ldGFkYXRhKHNjaGVtYSk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlRWxlY3Ryb0RCU2NoZW1hPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogUyxcbiAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvblxuICApOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgbmV3IEVudGl0eShzY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb25zKTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVsZWN0cm9EQiBzY2hlbWEgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlTW9kZWxEZWZpbml0aW9uPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogU1xuICApOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICAvLyBPcHRpb25hbCBidXQgdHlwZWQgbW9kZWwgcHJvcGVydGllc1xuICAgIGlmIChzY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCAmJiB0eXBlb2Ygc2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwgIT09ICdzdHJpbmcnKSB7XG4gICAgICBlcnJvcnMucHVzaCgnZW50aXR5TmFtZVBsdXJhbCBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgfVxuXG4gICAgaWYgKHNjaGVtYS5tb2RlbC5lbnRpdHlNZW51SWNvbiAmJiB0eXBlb2Ygc2NoZW1hLm1vZGVsLmVudGl0eU1lbnVJY29uICE9PSAnc3RyaW5nJykge1xuICAgICAgZXJyb3JzLnB1c2goJ2VudGl0eU1lbnVJY29uIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9XG5cbiAgICAvLyBCb29sZWFuIGZsYWdzIHZhbGlkYXRpb25cbiAgICBjb25zdCBib29sZWFuRmxhZ3MgPSBbXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbk1lbnUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5MaXN0JyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluRGV0YWlsJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluQ3JlYXRlJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluVXBkYXRlJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluRGVsZXRlJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluRHVwbGljYXRlJ1xuICAgIF0gYXMgY29uc3Q7XG5cbiAgICBmb3IgKGNvbnN0IGZsYWcgb2YgYm9vbGVhbkZsYWdzKSB7XG4gICAgICBpZiAoc2NoZW1hLm1vZGVsWyBmbGFnIF0gIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygc2NoZW1hLm1vZGVsWyBmbGFnIF0gIT09ICdib29sZWFuJykge1xuICAgICAgICBlcnJvcnMucHVzaChgJHtmbGFnfSBtdXN0IGJlIGEgYm9vbGVhbmApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCBkZWZpbml0aW9uIHZhbGlkYXRpb24gZmFpbGVkOlxcbiR7ZXJyb3JzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVEaXNwbGF5T3ZlcnJpZGVzPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHNjaGVtYTogUyk6IHZvaWQge1xuICAgIGNvbnN0IHVpID0gc2NoZW1hLm1vZGVsLmRpc3BsYXlPdmVycmlkZXM7XG4gICAgaWYgKHVpID09PSB1bmRlZmluZWQpIHJldHVybjtcblxuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgICBpZiAoIXVpIHx8IHR5cGVvZiB1aSAhPT0gJ29iamVjdCcpIHtcbiAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzIG11c3QgYmUgYW4gb2JqZWN0Jyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0eXBlb2YgdWkuc3RvcmFnZUF0dHJpYnV0ZSAhPT0gJ3N0cmluZycgfHwgIXVpLnN0b3JhZ2VBdHRyaWJ1dGUudHJpbSgpKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzLnN0b3JhZ2VBdHRyaWJ1dGUgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcnKTtcbiAgICAgIH0gZWxzZSBpZiAoISh1aS5zdG9yYWdlQXR0cmlidXRlIGluIHNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgICBlcnJvcnMucHVzaChgZGlzcGxheU92ZXJyaWRlcy5zdG9yYWdlQXR0cmlidXRlIFwiJHt1aS5zdG9yYWdlQXR0cmlidXRlfVwiIG11c3QgbmFtZSBhbiBleGlzdGluZyBhdHRyaWJ1dGVgKTtcbiAgICAgIH1cbiAgICAgIGlmICh1aS5sYWJlbCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB1aS5sYWJlbCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goJ2Rpc3BsYXlPdmVycmlkZXMubGFiZWwgbXVzdCBiZSBhIHN0cmluZyB3aGVuIHByb3ZpZGVkJyk7XG4gICAgICB9XG4gICAgICBpZiAodWkuY2hhbm5lbHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodWkuY2hhbm5lbHMpIHx8ICF1aS5jaGFubmVscy5ldmVyeShjID0+IHR5cGVvZiBjID09PSAnc3RyaW5nJykpIHtcbiAgICAgICAgICBlcnJvcnMucHVzaCgnZGlzcGxheU92ZXJyaWRlcy5jaGFubmVscyBtdXN0IGJlIGFuIGFycmF5IG9mIHN0cmluZ3Mgd2hlbiBwcm92aWRlZCcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAodWkuYWxsb3dMaXN0SXRlbVBhdGhzICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHVpLmFsbG93TGlzdEl0ZW1QYXRocyAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzLmFsbG93TGlzdEl0ZW1QYXRocyBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByb3ZpZGVkJyk7XG4gICAgICB9XG4gICAgICBpZiAodWkuZmllbGRzICE9PSB1bmRlZmluZWQgJiYgIUFycmF5LmlzQXJyYXkodWkuZmllbGRzKSkge1xuICAgICAgICBlcnJvcnMucHVzaCgnZGlzcGxheU92ZXJyaWRlcy5maWVsZHMgbXVzdCBiZSBhbiBhcnJheSB3aGVuIHByb3ZpZGVkJyk7XG4gICAgICB9XG4gICAgICBpZiAodWkuYXV0byAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB1aS5hdXRvICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goJ2Rpc3BsYXlPdmVycmlkZXMuYXV0byBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByb3ZpZGVkJyk7XG4gICAgICB9XG4gICAgICBpZiAodWkuZXhjbHVkZVBhdGhzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHVpLmV4Y2x1ZGVQYXRocykgfHwgIXVpLmV4Y2x1ZGVQYXRocy5ldmVyeSgocDogdW5rbm93bikgPT4gdHlwZW9mIHAgPT09ICdzdHJpbmcnKSkge1xuICAgICAgICAgIGVycm9ycy5wdXNoKCdkaXNwbGF5T3ZlcnJpZGVzLmV4Y2x1ZGVQYXRocyBtdXN0IGJlIHN0cmluZ1tdIHdoZW4gcHJvdmlkZWQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHVpLmRlZmF1bHRDaHJvbWUgIT09IHVuZGVmaW5lZCAmJiAhWyAndGFnJywgJ2JhZGdlJywgJ291dGxpbmUnLCAnbm9uZScgXS5pbmNsdWRlcyh1aS5kZWZhdWx0Q2hyb21lKSkge1xuICAgICAgICBlcnJvcnMucHVzaCgnZGlzcGxheU92ZXJyaWRlcy5kZWZhdWx0Q2hyb21lIG11c3QgYmUgb25lIG9mOiB0YWcsIGJhZGdlLCBvdXRsaW5lLCBub25lJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYERpc3BsYXkgb3ZlcnJpZGVzIFVJIHZhbGlkYXRpb24gZmFpbGVkOlxcbiR7ZXJyb3JzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cblxuICAgIHRoaXMudmFsaWRhdGVEaXNwbGF5T3ZlcnJpZGVGaWVsZFBhdGhzKHNjaGVtYSwgdWkpO1xuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZURpc3BsYXlPdmVycmlkZUZpZWxkUGF0aHM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIHVpOiBOb25OdWxsYWJsZTxTWyAnbW9kZWwnIF1bICdkaXNwbGF5T3ZlcnJpZGVzJyBdPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBmaWVsZHMgPSB1aS5maWVsZHM7XG4gICAgaWYgKCFmaWVsZHM/Lmxlbmd0aCkgcmV0dXJuO1xuXG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCBwcmltYXJ5ID0gc2NoZW1hLmluZGV4ZXM/LnByaW1hcnkgYXMgdW5rbm93biBhcyB7XG4gICAgICBwaz86IHsgY29tcG9zaXRlPzogcmVhZG9ubHkgc3RyaW5nW10gfTtcbiAgICAgIHNrPzogeyBjb21wb3NpdGU/OiByZWFkb25seSBzdHJpbmdbXSB9O1xuICAgIH0gfCB1bmRlZmluZWQ7XG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgaWYgKHByaW1hcnk/LnBrPy5jb21wb3NpdGUpIHtcbiAgICAgIGZvciAoY29uc3QgYSBvZiBwcmltYXJ5LnBrLmNvbXBvc2l0ZSkgcHJpbWFyeUtleUF0dHJzLmFkZChTdHJpbmcoYSkpO1xuICAgIH1cbiAgICBpZiAocHJpbWFyeT8uc2s/LmNvbXBvc2l0ZSkge1xuICAgICAgZm9yIChjb25zdCBhIG9mIHByaW1hcnkuc2suY29tcG9zaXRlKSBwcmltYXJ5S2V5QXR0cnMuYWRkKFN0cmluZyhhKSk7XG4gICAgfVxuXG4gICAgY29uc3QgYWxsb3dMaXN0SW5kZXggPSB1aS5hbGxvd0xpc3RJdGVtUGF0aHMgPT09IHRydWU7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHVpLnN0b3JhZ2VBdHRyaWJ1dGU7XG4gICAgY29uc3QgYXV0b0V4Y2x1ZGVQYXRocyA9IHVpLmV4Y2x1ZGVQYXRocyA/PyBbXTtcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZmllbGRzKSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeS5wYXRoICE9PSAnc3RyaW5nJyB8fCAhZW50cnkucGF0aC50cmltKCkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goJ2Rpc3BsYXlPdmVycmlkZXMuZmllbGRzW106IGVhY2ggZW50cnkgbXVzdCBoYXZlIGEgbm9uLWVtcHR5IHBhdGgnKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBwYXRoID0gZW50cnkucGF0aC50cmltKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMocGF0aCkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYGR1cGxpY2F0ZSBkaXNwbGF5T3ZlcnJpZGUgcGF0aCBcIiR7cGF0aH1cImApO1xuICAgICAgfVxuICAgICAgc2Vlbi5hZGQocGF0aCk7XG4gICAgICBpZiAocGF0aCA9PT0gc3RvcmFnZSB8fCBwYXRoLnN0YXJ0c1dpdGgoYCR7c3RvcmFnZX0uYCkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYHBhdGggXCIke3BhdGh9XCIgbXVzdCBub3QgdGFyZ2V0IHRoZSBvdmVycmlkZSBzdG9yYWdlIGF0dHJpYnV0ZWApO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmFzc2VydFZhbGlkRGlzcGxheU92ZXJyaWRlUGF0aChzY2hlbWEsIHBhdGgsIGFsbG93TGlzdEluZGV4LCBwcmltYXJ5S2V5QXR0cnMpO1xuICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGUubWVzc2FnZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChlbnRyeS5jaGFubmVscyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShlbnRyeS5jaGFubmVscykgfHwgIWVudHJ5LmNoYW5uZWxzLmV2ZXJ5KGMgPT4gdHlwZW9mIGMgPT09ICdzdHJpbmcnKSkge1xuICAgICAgICAgIGVycm9ycy5wdXNoKGBkaXNwbGF5T3ZlcnJpZGVzLmZpZWxkcyBjaGFubmVscyBmb3IgXCIke3BhdGh9XCIgbXVzdCBiZSBzdHJpbmdbXWApO1xuICAgICAgICB9IGVsc2UgaWYgKHVpLmNoYW5uZWxzPy5sZW5ndGgpIHtcbiAgICAgICAgICBjb25zdCBvayA9IG5ldyBTZXQodWkuY2hhbm5lbHMpO1xuICAgICAgICAgIGZvciAoY29uc3QgYyBvZiBlbnRyeS5jaGFubmVscykge1xuICAgICAgICAgICAgaWYgKCFvay5oYXMoYykpIHtcbiAgICAgICAgICAgICAgZXJyb3JzLnB1c2goYGZpZWxkIFwiJHtwYXRofVwiIGNoYW5uZWwgXCIke2N9XCIgaXMgbm90IGxpc3RlZCBpbiBkaXNwbGF5T3ZlcnJpZGVzLmNoYW5uZWxzYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZW50cnkuY2hyb21lICE9PSB1bmRlZmluZWQgJiYgIVsgJ3RhZycsICdiYWRnZScsICdvdXRsaW5lJywgJ25vbmUnIF0uaW5jbHVkZXMoZW50cnkuY2hyb21lKSkge1xuICAgICAgICBlcnJvcnMucHVzaChgaW52YWxpZCBjaHJvbWUgb24gZGlzcGxheU92ZXJyaWRlIHBhdGggXCIke3BhdGh9XCJgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHBhdGhSYXcgb2YgYXV0b0V4Y2x1ZGVQYXRocykge1xuICAgICAgaWYgKHR5cGVvZiBwYXRoUmF3ICE9PSAnc3RyaW5nJyB8fCAhcGF0aFJhdy50cmltKCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgcGF0aCA9IHBhdGhSYXcudHJpbSgpO1xuICAgICAgaWYgKHBhdGggPT09IHN0b3JhZ2UgfHwgcGF0aC5zdGFydHNXaXRoKGAke3N0b3JhZ2V9LmApKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBhdXRvIGV4Y2x1ZGUgcGF0aCBcIiR7cGF0aH1cIiBtdXN0IG5vdCB0YXJnZXQgdGhlIG92ZXJyaWRlIHN0b3JhZ2UgYXR0cmlidXRlYCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5hc3NlcnRWYWxpZERpc3BsYXlPdmVycmlkZVBhdGgoc2NoZW1hLCBwYXRoLCBhbGxvd0xpc3RJbmRleCwgcHJpbWFyeUtleUF0dHJzKTtcbiAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICBlcnJvcnMucHVzaChgZGlzcGxheU92ZXJyaWRlcy5leGNsdWRlUGF0aHMgaW52YWxpZCBwYXRoIFwiJHtwYXRofVwiOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRGlzcGxheSBvdmVycmlkZXMgVUkgdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3NlcnRWYWxpZERpc3BsYXlPdmVycmlkZVBhdGg8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIHBhdGg6IHN0cmluZyxcbiAgICBhbGxvd0xpc3RJbmRleDogYm9vbGVhbixcbiAgICBwcmltYXJ5S2V5QXR0cnM6IFNldDxzdHJpbmc+XG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLicpLmZpbHRlcihwID0+IHAubGVuZ3RoID4gMCk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBpbnZhbGlkIGVtcHR5IGRpc3BsYXlPdmVycmlkZSBwYXRoYCk7XG4gICAgfVxuXG4gICAgY29uc3Qgd2FsayA9IChhdHRyczogUmVjb3JkPHN0cmluZywgYW55Piwgc3RhcnQ6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgICAgaWYgKHN0YXJ0ID49IHBhcnRzLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGludmFsaWQgcGF0aCBcIiR7cGF0aH1cImApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJ0ID0gcGFydHNbIHN0YXJ0IF07XG4gICAgICBpZiAoL15cXGQrJC8udGVzdChwYXJ0KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIgaXMgaW52YWxpZCBhdCBcIiR7cGFydH1cIiDigJQgdW5leHBlY3RlZCBsaXN0IGluZGV4YCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGF0dHIgPSBhdHRyc1sgcGFydCBdO1xuICAgICAgaWYgKCFhdHRyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgcGF0aCBcIiR7cGF0aH1cIiDigJQgdW5rbm93biBhdHRyaWJ1dGUgXCIke3BhcnR9XCJgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXJ0ID09PSBwYXJ0cy5sZW5ndGggLSAxKSB7XG4gICAgICAgIGlmIChhdHRyLnJlbGF0aW9uKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBwYXRoIFwiJHtwYXRofVwiIG11c3Qgbm90IHRhcmdldCBhIHJlbGF0aW9uIGZpZWxkYCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMSAmJiBwcmltYXJ5S2V5QXR0cnMuaGFzKHBhcnQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBwYXRoIFwiJHtwYXRofVwiIG11c3Qgbm90IHRhcmdldCBhIHByaW1hcnkgaW5kZXgga2V5IGF0dHJpYnV0ZWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHIudHlwZSA9PT0gJ21hcCcgJiYgYXR0ci5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIHdhbGsoYXR0ci5wcm9wZXJ0aWVzIGFzIFJlY29yZDxzdHJpbmcsIGFueT4sIHN0YXJ0ICsgMSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHIudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIGlmICghYWxsb3dMaXN0SW5kZXgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIgdHJhdmVyc2VzIGEgbGlzdCBidXQgYWxsb3dMaXN0SXRlbVBhdGhzIGlzIG5vdCB0cnVlYCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXJ0ICsgMSA+PSBwYXJ0cy5sZW5ndGgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIg4oCUIGV4cGVjdGVkIGluZGV4IGFmdGVyIGxpc3QgYXR0cmlidXRlIFwiJHtwYXJ0fVwiYCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaWR4ID0gcGFydHNbIHN0YXJ0ICsgMSBdO1xuICAgICAgICBpZiAoIS9eXFxkKyQvLnRlc3QoaWR4KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgcGF0aCBcIiR7cGF0aH1cIiDigJQgZXhwZWN0ZWQgbnVtZXJpYyBpbmRleCBhZnRlciBcIiR7cGFydH1cImApO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhdHRyLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBhdHRyLml0ZW1zLnByb3BlcnRpZXMpIHtcbiAgICAgICAgICB3YWxrKGF0dHIuaXRlbXMucHJvcGVydGllcyBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+LCBzdGFydCArIDIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIg4oCUIGxpc3QgXCIke3BhcnR9XCIgbXVzdCBoYXZlIG1hcCBpdGVtcyB0byB0cmF2ZXJzZWApO1xuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHBhdGggXCIke3BhdGh9XCIg4oCUIGNhbm5vdCB0cmF2ZXJzZSBpbnRvIFwiJHtwYXJ0fVwiYCk7XG4gICAgfTtcblxuICAgIHdhbGsoc2NoZW1hLmF0dHJpYnV0ZXMgYXMgUmVjb3JkPHN0cmluZywgYW55PiwgMCk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlUmVsYXRpb25zPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogU1xuICApOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IFsgYXR0ck5hbWUsIGF0dHIgXSBvZiBPYmplY3QuZW50cmllcyhzY2hlbWEuYXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghYXR0ci5yZWxhdGlvbikgY29udGludWU7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIDEuIFZhbGlkYXRlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgaWYgKCFhdHRyLnJlbGF0aW9uLmVudGl0eU5hbWUgfHwgIWF0dHIucmVsYXRpb24udHlwZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUmVsYXRpb24gbXVzdCBzcGVjaWZ5IGVudGl0eU5hbWUgYW5kIHR5cGUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDIuIFZhbGlkYXRlIHJlbGF0aW9uIHR5cGVcbiAgICAgICAgaWYgKCFbICdvbmUtdG8tbWFueScsICdtYW55LXRvLW9uZScgXS5pbmNsdWRlcyhhdHRyLnJlbGF0aW9uLnR5cGUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uIHR5cGUgXCIke2F0dHIucmVsYXRpb24udHlwZX1cImApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gMy4gVmFsaWRhdGUgcmVsYXRlZCBlbnRpdHkgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEoYXR0ci5yZWxhdGlvbi5lbnRpdHlOYW1lKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVsYXRlZCBlbnRpdHkgXCIke2F0dHIucmVsYXRpb24uZW50aXR5TmFtZX1cIiBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDQuIFZhbGlkYXRlIGlkZW50aWZpZXJzXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzID0gdHlwZW9mIGF0dHIucmVsYXRpb24uaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICA/IGF0dHIucmVsYXRpb24uaWRlbnRpZmllcnMoKVxuICAgICAgICAgIDogYXR0ci5yZWxhdGlvbi5pZGVudGlmaWVycztcblxuICAgICAgICBpZiAoIWlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZWxhdGlvbiBtdXN0IHNwZWNpZnkgaWRlbnRpZmllcnMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzTGlzdCA9IEFycmF5LmlzQXJyYXkoaWRlbnRpZmllcnMpID8gaWRlbnRpZmllcnMgOiBbIGlkZW50aWZpZXJzIF07XG4gICAgICAgIGNvbnN0IHJlbGF0ZWRTY2hlbWEgPSB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTY2hlbWE8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihhdHRyLnJlbGF0aW9uLmVudGl0eU5hbWUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBpZGVudGlmaWVyc0xpc3QpIHtcbiAgICAgICAgICBpZiAoIWlkZW50aWZpZXIuc291cmNlIHx8ICFpZGVudGlmaWVyLnRhcmdldCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJZGVudGlmaWVyIG11c3Qgc3BlY2lmeSBzb3VyY2UgYW5kIHRhcmdldCcpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFZhbGlkYXRlIHRhcmdldCBleGlzdHMgaW4gcmVsYXRlZCBlbnRpdHlcbiAgICAgICAgICBpZiAoIShpZGVudGlmaWVyLnRhcmdldCBpbiByZWxhdGVkU2NoZW1hLmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRhcmdldCBhdHRyaWJ1dGUgXCIke1N0cmluZyhpZGVudGlmaWVyLnRhcmdldCl9XCIgbm90IGZvdW5kIGluIHJlbGF0ZWQgZW50aXR5YCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVmFsaWRhdGUgc291cmNlIHBhdGggZXhpc3RzIGluIGN1cnJlbnQgZW50aXR5XG4gICAgICAgICAgY29uc3Qgc291cmNlUGFydHMgPSBpZGVudGlmaWVyLnNvdXJjZS5zcGxpdCgnLicpO1xuICAgICAgICAgIGxldCBjdXJyZW50U2NoZW1hOiBhbnkgPSBzY2hlbWE7XG4gICAgICAgICAgbGV0IGN1cnJlbnRQYXRoID0gJyc7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2Ygc291cmNlUGFydHMpIHtcbiAgICAgICAgICAgIGN1cnJlbnRQYXRoID0gY3VycmVudFBhdGggPyBgJHtjdXJyZW50UGF0aH0uJHtwYXJ0fWAgOiBwYXJ0O1xuXG4gICAgICAgICAgICBpZiAoIWN1cnJlbnRTY2hlbWEuYXR0cmlidXRlcyB8fCAhKHBhcnQgaW4gY3VycmVudFNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNvdXJjZSBwYXRoIFwiJHtpZGVudGlmaWVyLnNvdXJjZX1cIiBpbnZhbGlkIGF0IFwiJHtwYXJ0fVwiYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRBdHRyID0gY3VycmVudFNjaGVtYS5hdHRyaWJ1dGVzWyBwYXJ0IF07XG5cbiAgICAgICAgICAgIC8vIElmIHRoaXMgaXMgdGhlIGxhc3QgcGFydCwgd2UgZG9uJ3QgbmVlZCB0byB0cmF2ZXJzZSBmdXJ0aGVyXG4gICAgICAgICAgICBpZiAocGFydCA9PT0gc291cmNlUGFydHNbIHNvdXJjZVBhcnRzLmxlbmd0aCAtIDEgXSkge1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRm9yIG1hcCB0eXBlcywgdHJhdmVyc2UgaW50byB0aGVpciBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBpZiAoY3VycmVudEF0dHIudHlwZSA9PT0gJ21hcCcgJiYgY3VycmVudEF0dHIucHJvcGVydGllcykge1xuICAgICAgICAgICAgICBjdXJyZW50U2NoZW1hID0geyBhdHRyaWJ1dGVzOiBjdXJyZW50QXR0ci5wcm9wZXJ0aWVzIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNvdXJjZSBwYXRoIFwiJHtpZGVudGlmaWVyLnNvdXJjZX1cIiBpbnZhbGlkIGF0IFwiJHtwYXJ0fVwiIC0gZXhwZWN0ZWQgbWFwIHR5cGVgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICBlcnJvcnMucHVzaChgSW52YWxpZCByZWxhdGlvbiBmb3IgYXR0cmlidXRlIFwiJHthdHRyTmFtZX1cIjogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnMgdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUZpZWxkTWV0YWRhdGE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgWyBhdHRyTmFtZSwgYXR0ciBdIG9mIE9iamVjdC5lbnRyaWVzKHNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gVmFsaWRhdGUgZmllbGQgdHlwZSBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGF0dHIuZmllbGRUeXBlKSB7XG4gICAgICAgICAgY29uc3QgdmFsaWRGaWVsZFR5cGVzID0gW1xuICAgICAgICAgICAgLy8gVGV4dCBmaWVsZHNcbiAgICAgICAgICAgICd0ZXh0JywgJ3RleHRhcmVhJywgJ3Bhc3N3b3JkJyxcbiAgICAgICAgICAgIC8vIE51bWJlciBmaWVsZHNcbiAgICAgICAgICAgICdudW1iZXInLFxuICAgICAgICAgICAgLy8gRGF0ZS9UaW1lIGZpZWxkc1xuICAgICAgICAgICAgJ2RhdGUnLCAndGltZScsICdkYXRldGltZScsICdkdXJhdGlvbicsICd0dGwnLFxuICAgICAgICAgICAgLy8gQm9vbGVhbiBmaWVsZHNcbiAgICAgICAgICAgICdib29sZWFuJywgJ3N3aXRjaCcsICd0b2dnbGUnLFxuICAgICAgICAgICAgLy8gU2VsZWN0aW9uIGZpZWxkc1xuICAgICAgICAgICAgJ3NlbGVjdCcsICdtdWx0aS1zZWxlY3QnLCAnYXV0b2NvbXBsZXRlJywgJ3JhZGlvJywgJ2NoZWNrYm94JyxcbiAgICAgICAgICAgIC8vIEZpbGUgZmllbGRzXG4gICAgICAgICAgICAnZmlsZScsICdpbWFnZScsXG4gICAgICAgICAgICAvLyBPdGhlciBmaWVsZHNcbiAgICAgICAgICAgICdjb2xvcicsICdyYW5nZScsICdoaWRkZW4nLCAnY3VzdG9tJywgJ3JhdGluZycsXG4gICAgICAgICAgICAncmljaC10ZXh0JywgJ3d5c2l3eWcnLCAnY29kZScsICdtYXJrZG93bicsICdqc29uJ1xuICAgICAgICAgIF07XG5cbiAgICAgICAgICBpZiAoIXZhbGlkRmllbGRUeXBlcy5pbmNsdWRlcyhhdHRyLmZpZWxkVHlwZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmaWVsZCB0eXBlIFwiJHthdHRyLmZpZWxkVHlwZX1cImApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFZhbGlkYXRlIGZpZWxkIHR5cGUgc3BlY2lmaWMgcmVxdWlyZW1lbnRzXG4gICAgICAgICAgc3dpdGNoIChhdHRyLmZpZWxkVHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnc2VsZWN0JzpcbiAgICAgICAgICAgIGNhc2UgJ211bHRpLXNlbGVjdCc6XG4gICAgICAgICAgICBjYXNlICdhdXRvY29tcGxldGUnOlxuICAgICAgICAgICAgY2FzZSAncmFkaW8nOlxuICAgICAgICAgICAgY2FzZSAnY2hlY2tib3gnOlxuICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlU2VsZWN0RmllbGRNZXRhZGF0YShhdHRyIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgJ2ZpbGUnOlxuICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlRmlsZUZpZWxkTWV0YWRhdGEoYXR0ciBhcyBGaWxlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWUpO1xuICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgY2FzZSAnaW1hZ2UnOlxuICAgICAgICAgICAgICB0aGlzLnZhbGlkYXRlSW1hZ2VGaWVsZE1ldGFkYXRhKGF0dHIgYXMgSW1hZ2VGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICBjYXNlICdudW1iZXInOlxuICAgICAgICAgICAgY2FzZSAncmFuZ2UnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IG51bWJlckF0dHIgPSBhdHRyIGFzIEZpZWxkTWV0YWRhdGEgJiB7IG1pbj86IG51bWJlcjsgbWF4PzogbnVtYmVyIH07XG4gICAgICAgICAgICAgIGlmIChudW1iZXJBdHRyLm1pbiAhPT0gdW5kZWZpbmVkICYmIG51bWJlckF0dHIubWF4ICE9PSB1bmRlZmluZWQgJiYgbnVtYmVyQXR0ci5taW4gPiBudW1iZXJBdHRyLm1heCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWluaW11bSB2YWx1ZSAoJHtudW1iZXJBdHRyLm1pbn0pIGNhbm5vdCBiZSBncmVhdGVyIHRoYW4gbWF4aW11bSB2YWx1ZSAoJHtudW1iZXJBdHRyLm1heH0pYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ2RhdGUnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRhdGVBdHRyID0gYXR0ciBhcyBGaWVsZE1ldGFkYXRhICYgeyBtaW5EYXRlPzogRGF0ZTsgbWF4RGF0ZT86IERhdGUgfTtcbiAgICAgICAgICAgICAgaWYgKGRhdGVBdHRyLm1pbkRhdGUgJiYgZGF0ZUF0dHIubWF4RGF0ZSAmJiBkYXRlQXR0ci5taW5EYXRlID4gZGF0ZUF0dHIubWF4RGF0ZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWluaW11bSBkYXRlIGNhbm5vdCBiZSBncmVhdGVyIHRoYW4gbWF4aW11bSBkYXRlYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ2RhdGV0aW1lJzoge1xuICAgICAgICAgICAgICBjb25zdCBkYXRlVGltZUF0dHIgPSBhdHRyIGFzIEZpZWxkTWV0YWRhdGEgJiB7IG1pbkRhdGVUaW1lPzogRGF0ZTsgbWF4RGF0ZVRpbWU/OiBEYXRlIH07XG4gICAgICAgICAgICAgIGlmIChkYXRlVGltZUF0dHIubWluRGF0ZVRpbWUgJiYgZGF0ZVRpbWVBdHRyLm1heERhdGVUaW1lICYmIGRhdGVUaW1lQXR0ci5taW5EYXRlVGltZSA+IGRhdGVUaW1lQXR0ci5tYXhEYXRlVGltZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWluaW11bSBkYXRlIHRpbWUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIGRhdGUgdGltZWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjYXNlICd0aW1lJzoge1xuICAgICAgICAgICAgICBjb25zdCB0aW1lQXR0ciA9IGF0dHIgYXMgRmllbGRNZXRhZGF0YSAmIHsgbWluVGltZT86IHN0cmluZzsgbWF4VGltZT86IHN0cmluZyB9O1xuICAgICAgICAgICAgICBpZiAodGltZUF0dHIubWluVGltZSAmJiB0aW1lQXR0ci5tYXhUaW1lICYmIHRpbWVBdHRyLm1pblRpbWUgPiB0aW1lQXR0ci5tYXhUaW1lKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIHRpbWUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIHRpbWVgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBib29sZWFuIGZsYWdzXG4gICAgICAgIGNvbnN0IGJvb2xlYW5GbGFnczogKGtleW9mIEZpZWxkTWV0YWRhdGEpW10gPSBbXG4gICAgICAgICAgJ2lzVmlzaWJsZScsXG4gICAgICAgICAgJ2lzTGlzdGFibGUnLFxuICAgICAgICAgICdpc0NyZWF0YWJsZScsXG4gICAgICAgICAgJ2lzRWRpdGFibGUnLFxuICAgICAgICAgICdpc0ZpbHRlcmFibGUnLFxuICAgICAgICAgICdpc1NlYXJjaGFibGUnXG4gICAgICAgIF07XG5cbiAgICAgICAgZm9yIChjb25zdCBmbGFnIG9mIGJvb2xlYW5GbGFncykge1xuICAgICAgICAgIGlmIChhdHRyWyBmbGFnIF0gIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgYXR0clsgZmxhZyBdICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtmbGFnfSBtdXN0IGJlIGEgYm9vbGVhbmApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIGZpZWxkIG1ldGFkYXRhIGZvciBcIiR7YXR0ck5hbWV9XCI6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmllbGQgbWV0YWRhdGEgdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZVNlbGVjdEZpZWxkTWV0YWRhdGEoYXR0cjogU2VsZWN0RmllbGRNZXRhZGF0YSwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICghYXR0ci5vcHRpb25zKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlbGVjdCBmaWVsZCBtdXN0IHNwZWNpZnkgb3B0aW9ucycpO1xuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHIub3B0aW9ucykpIHtcbiAgICAgIC8vIFN0YXRpYyBvcHRpb25zXG4gICAgICBpZiAoYXR0ci5vcHRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NlbGVjdCBmaWVsZCBvcHRpb25zIGFycmF5IGNhbm5vdCBiZSBlbXB0eScpO1xuICAgICAgfVxuICAgICAgaWYgKCFhdHRyLm9wdGlvbnMuZXZlcnkob3B0ID0+ICd2YWx1ZScgaW4gb3B0ICYmICdsYWJlbCcgaW4gb3B0KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN0YXRpYyBvcHRpb25zIG11c3QgaGF2ZSB2YWx1ZSBhbmQgbGFiZWwgcHJvcGVydGllcyBmb3IgXCIke2F0dHJOYW1lfVwiYCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgYXR0ci5vcHRpb25zID09PSAnb2JqZWN0JyAmJiAoJ2FwaU1ldGhvZCcgaW4gYXR0ci5vcHRpb25zIHx8ICdhcGlVcmwnIGluIGF0dHIub3B0aW9ucyB8fCAncmVzcG9uc2VLZXknIGluIGF0dHIub3B0aW9ucykpIHtcbiAgICAgIC8vIER5bmFtaWMgb3B0aW9ucyAoQVBJIGNvbmZpZykgLSBjaGVjayBmb3IgYW55IEFQSSBjb25maWcgcHJvcGVydHkgdG8gcHJvcGVybHkgdmFsaWRhdGUgaW5jb21wbGV0ZSBjb25maWdzXG4gICAgICB0aGlzLnZhbGlkYXRlT3B0aW9uc0FQSUNvbmZpZyhhdHRyLm9wdGlvbnMgYXMgRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4sIGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRHluYW1pYyBvcHRpb25zXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb3B0aW9ucyBjb25maWd1cmF0aW9uIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICB9XG5cbiAgICBpZiAoYXR0ci5hZGROZXdPcHRpb24pIHtcbiAgICAgIGlmICghdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEoYXR0ci5hZGROZXdPcHRpb24uZW50aXR5TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnRpdHkgXCIke2F0dHIuYWRkTmV3T3B0aW9uLmVudGl0eU5hbWV9XCIgZm9yIGFkZE5ld09wdGlvbiBub3QgZm91bmQgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVPcHRpb25zQVBJQ29uZmlnKGNvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4sIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIWNvbmZpZy5hcGlVcmwgfHwgIWNvbmZpZy5yZXNwb25zZUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb25zIEFQSSBjb25maWcgbXVzdCBzcGVjaWZ5IGFwaVVybCBhbmQgcmVzcG9uc2VLZXkgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcuYXBpTWV0aG9kICYmICFbICdHRVQnLCAnUE9TVCcgXS5pbmNsdWRlcyhjb25maWcuYXBpTWV0aG9kKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIEFQSSBtZXRob2QgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcub3B0aW9uTWFwcGluZykge1xuICAgICAgaWYgKCFjb25maWcub3B0aW9uTWFwcGluZy5sYWJlbCB8fCAhY29uZmlnLm9wdGlvbk1hcHBpbmcudmFsdWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb24gbWFwcGluZyBtdXN0IHNwZWNpZnkgbGFiZWwgYW5kIHZhbHVlIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlRmlsZUZpZWxkTWV0YWRhdGEoYXR0cjogRmlsZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoYXR0ci5nZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWcpIHtcbiAgICAgIGNvbnN0IHsgYXBpVXJsLCBhcGlNZXRob2QgfSA9IGF0dHIuZ2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnO1xuICAgICAgaWYgKCFhcGlVcmwgfHwgIVsgJ0dFVCcsICdQT1NUJyBdLmluY2x1ZGVzKGFwaU1ldGhvZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNpZ25lZCB1cGxvYWQgVVJMIGNvbmZpZ3VyYXRpb24gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhdHRyLm1heEZpbGVTaXplICYmIHR5cGVvZiBhdHRyLm1heEZpbGVTaXplICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBtYXhGaWxlU2l6ZSBtdXN0IGJlIGEgbnVtYmVyIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlSW1hZ2VGaWVsZE1ldGFkYXRhKGF0dHI6IEltYWdlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMudmFsaWRhdGVGaWxlRmllbGRNZXRhZGF0YShhdHRyIGFzIEZpbGVGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG5cbiAgICBpZiAoYXR0ci53aXRoSW1hZ2VDcm9wICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGF0dHIud2l0aEltYWdlQ3JvcCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhJbWFnZUNyb3AgbXVzdCBiZSBhIGJvb2xlYW4gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cbiAgfVxufSJdfQ==