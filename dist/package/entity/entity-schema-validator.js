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
        else if (typeof attr.options === 'object' && 'apiMethod' in attr.options) {
            // Dynamic options (API config)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNjaGVtYS12YWxpZGF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw0Q0FBNEM7OztBQUU1Qyx5Q0FBd0Q7QUFZeEQsTUFBYSxxQkFBcUI7SUFDSDtJQUE3QixZQUE2QixXQUF5QjtRQUF6QixnQkFBVyxHQUFYLFdBQVcsQ0FBYztJQUFJLENBQUM7SUFFcEQsY0FBYyxDQUNuQixNQUFTLEVBQ1Qsb0JBQXlDO1FBRXpDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzRCxJQUFJLENBQUMsdUJBQXVCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDckMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQy9CLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRU8sdUJBQXVCLENBQzdCLE1BQVMsRUFDVCxvQkFBeUM7UUFFekMsSUFBSSxDQUFDO1lBQ0gsSUFBSSxrQkFBTSxDQUFDLE1BQU0sRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBQzFFLENBQUM7SUFDSCxDQUFDO0lBRU8sdUJBQXVCLENBQzdCLE1BQVM7UUFFVCxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7UUFFNUIsc0NBQXNDO1FBQ3RDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsSUFBSSxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDdkYsTUFBTSxDQUFDLElBQUksQ0FBQyxtQ0FBbUMsQ0FB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QU0sSUFBSSxLQUFLLENBQUMscUNBQXFDLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDcEUsQ0FBQztJQUNILENBQUM7SUFFTywwQkFBMEIsQ0FBQyxJQUF3QixFQUFFLFFBQWdCO1FBQzNFLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxJQUF5QixFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBRXBFLElBQUksSUFBSSxDQUFDLGFBQWEsS0FBSyxTQUFTLElBQUksT0FBTyxJQUFJLENBQUMsYUFBYSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2hGLE1BQU0sSUFBSSxLQUFLLENBQUMsd0NBQXdDLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDdkUsQ0FBQztJQUNILENBQUM7Q0FDRjtBQTlURCxzREE4VEMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBzcmMvZW50aXR5L3ZhbGlkYXRvcnMvc2NoZW1hLXZhbGlkYXRvci50c1xuXG5pbXBvcnQgeyBFbnRpdHksIEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQge1xuICBFbnRpdHlTY2hlbWEsXG4gIEZpZWxkTWV0YWRhdGEsXG4gIFNlbGVjdEZpZWxkTWV0YWRhdGEsXG4gIEZpbGVGaWVsZE1ldGFkYXRhLFxuICBJbWFnZUZpZWxkTWV0YWRhdGEsXG4gIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyxcbn0gZnJvbSBcIi4vYmFzZS1lbnRpdHlcIjtcbmltcG9ydCB7IElESUNvbnRhaW5lciB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cblxuZXhwb3J0IGNsYXNzIEVudGl0eVNjaGVtYVZhbGlkYXRvciB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgZGlDb250YWluZXI6IElESUNvbnRhaW5lcikgeyB9XG5cbiAgcHVibGljIHZhbGlkYXRlU2NoZW1hPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogUyxcbiAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvblxuICApOiB2b2lkIHtcbiAgICB0aGlzLnZhbGlkYXRlRWxlY3Ryb0RCU2NoZW1hKHNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbnMpO1xuICAgIHRoaXMudmFsaWRhdGVNb2RlbERlZmluaXRpb24oc2NoZW1hKTtcbiAgICB0aGlzLnZhbGlkYXRlUmVsYXRpb25zKHNjaGVtYSk7XG4gICAgdGhpcy52YWxpZGF0ZUZpZWxkTWV0YWRhdGEoc2NoZW1hKTtcbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVFbGVjdHJvREJTY2hlbWE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uXG4gICk6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICBuZXcgRW50aXR5KHNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbnMpO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRWxlY3Ryb0RCIHNjaGVtYSB2YWxpZGF0aW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVNb2RlbERlZmluaXRpb248UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIC8vIE9wdGlvbmFsIGJ1dCB0eXBlZCBtb2RlbCBwcm9wZXJ0aWVzXG4gICAgaWYgKHNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsICYmIHR5cGVvZiBzY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGVycm9ycy5wdXNoKCdlbnRpdHlOYW1lUGx1cmFsIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9XG5cbiAgICBpZiAoc2NoZW1hLm1vZGVsLmVudGl0eU1lbnVJY29uICYmIHR5cGVvZiBzY2hlbWEubW9kZWwuZW50aXR5TWVudUljb24gIT09ICdzdHJpbmcnKSB7XG4gICAgICBlcnJvcnMucHVzaCgnZW50aXR5TWVudUljb24gbXVzdCBiZSBhIHN0cmluZycpO1xuICAgIH1cblxuICAgIC8vIEJvb2xlYW4gZmxhZ3MgdmFsaWRhdGlvblxuICAgIGNvbnN0IGJvb2xlYW5GbGFncyA9IFtcbiAgICAgICdleGNsdWRlRnJvbUFkbWluTWVudScsXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbkxpc3QnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5DcmVhdGUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EZWxldGUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EdXBsaWNhdGUnXG4gICAgXSBhcyBjb25zdDtcblxuICAgIGZvciAoY29uc3QgZmxhZyBvZiBib29sZWFuRmxhZ3MpIHtcbiAgICAgIGlmIChzY2hlbWEubW9kZWxbIGZsYWcgXSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBzY2hlbWEubW9kZWxbIGZsYWcgXSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGAke2ZsYWd9IG11c3QgYmUgYSBib29sZWFuYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsIGRlZmluaXRpb24gdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZVJlbGF0aW9uczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBzY2hlbWE6IFNcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBbIGF0dHJOYW1lLCBhdHRyIF0gb2YgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpKSB7XG4gICAgICBpZiAoIWF0dHIucmVsYXRpb24pIGNvbnRpbnVlO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyAxLiBWYWxpZGF0ZSByZWxhdGlvbiBkZWZpbml0aW9uXG4gICAgICAgIGlmICghYXR0ci5yZWxhdGlvbi5lbnRpdHlOYW1lIHx8ICFhdHRyLnJlbGF0aW9uLnR5cGUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlbGF0aW9uIG11c3Qgc3BlY2lmeSBlbnRpdHlOYW1lIGFuZCB0eXBlJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyAyLiBWYWxpZGF0ZSByZWxhdGlvbiB0eXBlXG4gICAgICAgIGlmICghWyAnb25lLXRvLW1hbnknLCAnbWFueS10by1vbmUnIF0uaW5jbHVkZXMoYXR0ci5yZWxhdGlvbi50eXBlKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbiB0eXBlIFwiJHthdHRyLnJlbGF0aW9uLnR5cGV9XCJgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDMuIFZhbGlkYXRlIHJlbGF0ZWQgZW50aXR5IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuZGlDb250YWluZXIuaGFzRW50aXR5U2NoZW1hKGF0dHIucmVsYXRpb24uZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlbGF0ZWQgZW50aXR5IFwiJHthdHRyLnJlbGF0aW9uLmVudGl0eU5hbWV9XCIgbm90IGZvdW5kYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyA0LiBWYWxpZGF0ZSBpZGVudGlmaWVyc1xuICAgICAgICBjb25zdCBpZGVudGlmaWVycyA9IHR5cGVvZiBhdHRyLnJlbGF0aW9uLmlkZW50aWZpZXJzID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgPyBhdHRyLnJlbGF0aW9uLmlkZW50aWZpZXJzKClcbiAgICAgICAgICA6IGF0dHIucmVsYXRpb24uaWRlbnRpZmllcnM7XG5cbiAgICAgICAgaWYgKCFpZGVudGlmaWVycykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUmVsYXRpb24gbXVzdCBzcGVjaWZ5IGlkZW50aWZpZXJzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpZGVudGlmaWVyc0xpc3QgPSBBcnJheS5pc0FycmF5KGlkZW50aWZpZXJzKSA/IGlkZW50aWZpZXJzIDogWyBpZGVudGlmaWVycyBdO1xuICAgICAgICBjb25zdCByZWxhdGVkU2NoZW1hID0gdGhpcy5kaUNvbnRhaW5lci5yZXNvbHZlRW50aXR5U2NoZW1hPEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oYXR0ci5yZWxhdGlvbi5lbnRpdHlOYW1lKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgaWRlbnRpZmllcnNMaXN0KSB7XG4gICAgICAgICAgaWYgKCFpZGVudGlmaWVyLnNvdXJjZSB8fCAhaWRlbnRpZmllci50YXJnZXQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSWRlbnRpZmllciBtdXN0IHNwZWNpZnkgc291cmNlIGFuZCB0YXJnZXQnKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBWYWxpZGF0ZSB0YXJnZXQgZXhpc3RzIGluIHJlbGF0ZWQgZW50aXR5XG4gICAgICAgICAgaWYgKCEoaWRlbnRpZmllci50YXJnZXQgaW4gcmVsYXRlZFNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUYXJnZXQgYXR0cmlidXRlIFwiJHtTdHJpbmcoaWRlbnRpZmllci50YXJnZXQpfVwiIG5vdCBmb3VuZCBpbiByZWxhdGVkIGVudGl0eWApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFZhbGlkYXRlIHNvdXJjZSBwYXRoIGV4aXN0cyBpbiBjdXJyZW50IGVudGl0eVxuICAgICAgICAgIGNvbnN0IHNvdXJjZVBhcnRzID0gaWRlbnRpZmllci5zb3VyY2Uuc3BsaXQoJy4nKTtcbiAgICAgICAgICBsZXQgY3VycmVudFNjaGVtYTogYW55ID0gc2NoZW1hO1xuICAgICAgICAgIGxldCBjdXJyZW50UGF0aCA9ICcnO1xuXG4gICAgICAgICAgZm9yIChjb25zdCBwYXJ0IG9mIHNvdXJjZVBhcnRzKSB7XG4gICAgICAgICAgICBjdXJyZW50UGF0aCA9IGN1cnJlbnRQYXRoID8gYCR7Y3VycmVudFBhdGh9LiR7cGFydH1gIDogcGFydDtcblxuICAgICAgICAgICAgaWYgKCFjdXJyZW50U2NoZW1hLmF0dHJpYnV0ZXMgfHwgIShwYXJ0IGluIGN1cnJlbnRTY2hlbWEuYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTb3VyY2UgcGF0aCBcIiR7aWRlbnRpZmllci5zb3VyY2V9XCIgaW52YWxpZCBhdCBcIiR7cGFydH1cImApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjdXJyZW50QXR0ciA9IGN1cnJlbnRTY2hlbWEuYXR0cmlidXRlc1sgcGFydCBdO1xuXG4gICAgICAgICAgICAvLyBJZiB0aGlzIGlzIHRoZSBsYXN0IHBhcnQsIHdlIGRvbid0IG5lZWQgdG8gdHJhdmVyc2UgZnVydGhlclxuICAgICAgICAgICAgaWYgKHBhcnQgPT09IHNvdXJjZVBhcnRzWyBzb3VyY2VQYXJ0cy5sZW5ndGggLSAxIF0pIHtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEZvciBtYXAgdHlwZXMsIHRyYXZlcnNlIGludG8gdGhlaXIgcHJvcGVydGllc1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRBdHRyLnR5cGUgPT09ICdtYXAnICYmIGN1cnJlbnRBdHRyLnByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgICAgY3VycmVudFNjaGVtYSA9IHsgYXR0cmlidXRlczogY3VycmVudEF0dHIucHJvcGVydGllcyB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTb3VyY2UgcGF0aCBcIiR7aWRlbnRpZmllci5zb3VyY2V9XCIgaW52YWxpZCBhdCBcIiR7cGFydH1cIiAtIGV4cGVjdGVkIG1hcCB0eXBlYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYEludmFsaWQgcmVsYXRpb24gZm9yIGF0dHJpYnV0ZSBcIiR7YXR0ck5hbWV9XCI6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVsYXRpb25zIHZhbGlkYXRpb24gZmFpbGVkOlxcbiR7ZXJyb3JzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVGaWVsZE1ldGFkYXRhPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogU1xuICApOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IFsgYXR0ck5hbWUsIGF0dHIgXSBvZiBPYmplY3QuZW50cmllcyhzY2hlbWEuYXR0cmlidXRlcykpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFZhbGlkYXRlIGZpZWxkIHR5cGUgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChhdHRyLmZpZWxkVHlwZSkge1xuICAgICAgICAgIGNvbnN0IHZhbGlkRmllbGRUeXBlcyA9IFtcbiAgICAgICAgICAgIC8vIFRleHQgZmllbGRzXG4gICAgICAgICAgICAndGV4dCcsICd0ZXh0YXJlYScsICdwYXNzd29yZCcsXG4gICAgICAgICAgICAvLyBOdW1iZXIgZmllbGRzXG4gICAgICAgICAgICAnbnVtYmVyJyxcbiAgICAgICAgICAgIC8vIERhdGUvVGltZSBmaWVsZHNcbiAgICAgICAgICAgICdkYXRlJywgJ3RpbWUnLCAnZGF0ZXRpbWUnLCAnZHVyYXRpb24nLCAndHRsJyxcbiAgICAgICAgICAgIC8vIEJvb2xlYW4gZmllbGRzXG4gICAgICAgICAgICAnYm9vbGVhbicsICdzd2l0Y2gnLCAndG9nZ2xlJyxcbiAgICAgICAgICAgIC8vIFNlbGVjdGlvbiBmaWVsZHNcbiAgICAgICAgICAgICdzZWxlY3QnLCAnbXVsdGktc2VsZWN0JywgJ2F1dG9jb21wbGV0ZScsICdyYWRpbycsICdjaGVja2JveCcsXG4gICAgICAgICAgICAvLyBGaWxlIGZpZWxkc1xuICAgICAgICAgICAgJ2ZpbGUnLCAnaW1hZ2UnLFxuICAgICAgICAgICAgLy8gT3RoZXIgZmllbGRzXG4gICAgICAgICAgICAnY29sb3InLCAncmFuZ2UnLCAnaGlkZGVuJywgJ2N1c3RvbScsICdyYXRpbmcnLFxuICAgICAgICAgICAgJ3JpY2gtdGV4dCcsICd3eXNpd3lnJywgJ2NvZGUnLCAnbWFya2Rvd24nLCAnanNvbidcbiAgICAgICAgICBdO1xuXG4gICAgICAgICAgaWYgKCF2YWxpZEZpZWxkVHlwZXMuaW5jbHVkZXMoYXR0ci5maWVsZFR5cGUpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZmllbGQgdHlwZSBcIiR7YXR0ci5maWVsZFR5cGV9XCJgKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBWYWxpZGF0ZSBmaWVsZCB0eXBlIHNwZWNpZmljIHJlcXVpcmVtZW50c1xuICAgICAgICAgIHN3aXRjaCAoYXR0ci5maWVsZFR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ3NlbGVjdCc6XG4gICAgICAgICAgICBjYXNlICdtdWx0aS1zZWxlY3QnOlxuICAgICAgICAgICAgY2FzZSAnYXV0b2NvbXBsZXRlJzpcbiAgICAgICAgICAgIGNhc2UgJ3JhZGlvJzpcbiAgICAgICAgICAgIGNhc2UgJ2NoZWNrYm94JzpcbiAgICAgICAgICAgICAgdGhpcy52YWxpZGF0ZVNlbGVjdEZpZWxkTWV0YWRhdGEoYXR0ciBhcyBTZWxlY3RGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICBjYXNlICdmaWxlJzpcbiAgICAgICAgICAgICAgdGhpcy52YWxpZGF0ZUZpbGVGaWVsZE1ldGFkYXRhKGF0dHIgYXMgRmlsZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgJ2ltYWdlJzpcbiAgICAgICAgICAgICAgdGhpcy52YWxpZGF0ZUltYWdlRmllbGRNZXRhZGF0YShhdHRyIGFzIEltYWdlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWUpO1xuICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgICAgICAgIGNhc2UgJ3JhbmdlJzoge1xuICAgICAgICAgICAgICBjb25zdCBudW1iZXJBdHRyID0gYXR0ciBhcyBGaWVsZE1ldGFkYXRhICYgeyBtaW4/OiBudW1iZXI7IG1heD86IG51bWJlciB9O1xuICAgICAgICAgICAgICBpZiAobnVtYmVyQXR0ci5taW4gIT09IHVuZGVmaW5lZCAmJiBudW1iZXJBdHRyLm1heCAhPT0gdW5kZWZpbmVkICYmIG51bWJlckF0dHIubWluID4gbnVtYmVyQXR0ci5tYXgpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pbmltdW0gdmFsdWUgKCR7bnVtYmVyQXR0ci5taW59KSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIG1heGltdW0gdmFsdWUgKCR7bnVtYmVyQXR0ci5tYXh9KWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjYXNlICdkYXRlJzoge1xuICAgICAgICAgICAgICBjb25zdCBkYXRlQXR0ciA9IGF0dHIgYXMgRmllbGRNZXRhZGF0YSAmIHsgbWluRGF0ZT86IERhdGU7IG1heERhdGU/OiBEYXRlIH07XG4gICAgICAgICAgICAgIGlmIChkYXRlQXR0ci5taW5EYXRlICYmIGRhdGVBdHRyLm1heERhdGUgJiYgZGF0ZUF0dHIubWluRGF0ZSA+IGRhdGVBdHRyLm1heERhdGUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pbmltdW0gZGF0ZSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIG1heGltdW0gZGF0ZWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjYXNlICdkYXRldGltZSc6IHtcbiAgICAgICAgICAgICAgY29uc3QgZGF0ZVRpbWVBdHRyID0gYXR0ciBhcyBGaWVsZE1ldGFkYXRhICYgeyBtaW5EYXRlVGltZT86IERhdGU7IG1heERhdGVUaW1lPzogRGF0ZSB9O1xuICAgICAgICAgICAgICBpZiAoZGF0ZVRpbWVBdHRyLm1pbkRhdGVUaW1lICYmIGRhdGVUaW1lQXR0ci5tYXhEYXRlVGltZSAmJiBkYXRlVGltZUF0dHIubWluRGF0ZVRpbWUgPiBkYXRlVGltZUF0dHIubWF4RGF0ZVRpbWUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pbmltdW0gZGF0ZSB0aW1lIGNhbm5vdCBiZSBncmVhdGVyIHRoYW4gbWF4aW11bSBkYXRlIHRpbWVgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAndGltZSc6IHtcbiAgICAgICAgICAgICAgY29uc3QgdGltZUF0dHIgPSBhdHRyIGFzIEZpZWxkTWV0YWRhdGEgJiB7IG1pblRpbWU/OiBzdHJpbmc7IG1heFRpbWU/OiBzdHJpbmcgfTtcbiAgICAgICAgICAgICAgaWYgKHRpbWVBdHRyLm1pblRpbWUgJiYgdGltZUF0dHIubWF4VGltZSAmJiB0aW1lQXR0ci5taW5UaW1lID4gdGltZUF0dHIubWF4VGltZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWluaW11bSB0aW1lIGNhbm5vdCBiZSBncmVhdGVyIHRoYW4gbWF4aW11bSB0aW1lYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVmFsaWRhdGUgYm9vbGVhbiBmbGFnc1xuICAgICAgICBjb25zdCBib29sZWFuRmxhZ3M6IChrZXlvZiBGaWVsZE1ldGFkYXRhKVtdID0gW1xuICAgICAgICAgICdpc1Zpc2libGUnLFxuICAgICAgICAgICdpc0xpc3RhYmxlJyxcbiAgICAgICAgICAnaXNDcmVhdGFibGUnLFxuICAgICAgICAgICdpc0VkaXRhYmxlJyxcbiAgICAgICAgICAnaXNGaWx0ZXJhYmxlJyxcbiAgICAgICAgICAnaXNTZWFyY2hhYmxlJ1xuICAgICAgICBdO1xuXG4gICAgICAgIGZvciAoY29uc3QgZmxhZyBvZiBib29sZWFuRmxhZ3MpIHtcbiAgICAgICAgICBpZiAoYXR0clsgZmxhZyBdICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGF0dHJbIGZsYWcgXSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7ZmxhZ30gbXVzdCBiZSBhIGJvb2xlYW5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICBlcnJvcnMucHVzaChgSW52YWxpZCBmaWVsZCBtZXRhZGF0YSBmb3IgXCIke2F0dHJOYW1lfVwiOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZpZWxkIG1ldGFkYXRhIHZhbGlkYXRpb24gZmFpbGVkOlxcbiR7ZXJyb3JzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVTZWxlY3RGaWVsZE1ldGFkYXRhKGF0dHI6IFNlbGVjdEZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIWF0dHIub3B0aW9ucykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWxlY3QgZmllbGQgbXVzdCBzcGVjaWZ5IG9wdGlvbnMnKTtcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyLm9wdGlvbnMpKSB7XG4gICAgICAvLyBTdGF0aWMgb3B0aW9uc1xuICAgICAgaWYgKGF0dHIub3B0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWxlY3QgZmllbGQgb3B0aW9ucyBhcnJheSBjYW5ub3QgYmUgZW1wdHknKTtcbiAgICAgIH1cbiAgICAgIGlmICghYXR0ci5vcHRpb25zLmV2ZXJ5KG9wdCA9PiAndmFsdWUnIGluIG9wdCAmJiAnbGFiZWwnIGluIG9wdCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTdGF0aWMgb3B0aW9ucyBtdXN0IGhhdmUgdmFsdWUgYW5kIGxhYmVsIHByb3BlcnRpZXMgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGF0dHIub3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgJ2FwaU1ldGhvZCcgaW4gYXR0ci5vcHRpb25zKSB7XG4gICAgICAvLyBEeW5hbWljIG9wdGlvbnMgKEFQSSBjb25maWcpXG4gICAgICB0aGlzLnZhbGlkYXRlT3B0aW9uc0FQSUNvbmZpZyhhdHRyLm9wdGlvbnMgYXMgRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4sIGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRHluYW1pYyBvcHRpb25zXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb3B0aW9ucyBjb25maWd1cmF0aW9uIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICB9XG5cbiAgICBpZiAoYXR0ci5hZGROZXdPcHRpb24pIHtcbiAgICAgIGlmICghdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEoYXR0ci5hZGROZXdPcHRpb24uZW50aXR5TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnRpdHkgXCIke2F0dHIuYWRkTmV3T3B0aW9uLmVudGl0eU5hbWV9XCIgZm9yIGFkZE5ld09wdGlvbiBub3QgZm91bmQgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVPcHRpb25zQVBJQ29uZmlnKGNvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4sIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIWNvbmZpZy5hcGlVcmwgfHwgIWNvbmZpZy5yZXNwb25zZUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb25zIEFQSSBjb25maWcgbXVzdCBzcGVjaWZ5IGFwaVVybCBhbmQgcmVzcG9uc2VLZXkgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcuYXBpTWV0aG9kICYmICFbICdHRVQnLCAnUE9TVCcgXS5pbmNsdWRlcyhjb25maWcuYXBpTWV0aG9kKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIEFQSSBtZXRob2QgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcub3B0aW9uTWFwcGluZykge1xuICAgICAgaWYgKCFjb25maWcub3B0aW9uTWFwcGluZy5sYWJlbCB8fCAhY29uZmlnLm9wdGlvbk1hcHBpbmcudmFsdWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb24gbWFwcGluZyBtdXN0IHNwZWNpZnkgbGFiZWwgYW5kIHZhbHVlIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlRmlsZUZpZWxkTWV0YWRhdGEoYXR0cjogRmlsZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoYXR0ci5nZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWcpIHtcbiAgICAgIGNvbnN0IHsgYXBpVXJsLCBhcGlNZXRob2QgfSA9IGF0dHIuZ2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnO1xuICAgICAgaWYgKCFhcGlVcmwgfHwgIVsgJ0dFVCcsICdQT1NUJyBdLmluY2x1ZGVzKGFwaU1ldGhvZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNpZ25lZCB1cGxvYWQgVVJMIGNvbmZpZ3VyYXRpb24gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhdHRyLm1heEZpbGVTaXplICYmIHR5cGVvZiBhdHRyLm1heEZpbGVTaXplICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBtYXhGaWxlU2l6ZSBtdXN0IGJlIGEgbnVtYmVyIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlSW1hZ2VGaWVsZE1ldGFkYXRhKGF0dHI6IEltYWdlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMudmFsaWRhdGVGaWxlRmllbGRNZXRhZGF0YShhdHRyIGFzIEZpbGVGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG5cbiAgICBpZiAoYXR0ci53aXRoSW1hZ2VDcm9wICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGF0dHIud2l0aEltYWdlQ3JvcCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhJbWFnZUNyb3AgbXVzdCBiZSBhIGJvb2xlYW4gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cbiAgfVxufSJdfQ==