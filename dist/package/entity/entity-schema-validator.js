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
                        'date', 'time', 'datetime',
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
        else {
            // Dynamic options
            this.validateOptionsAPIConfig(attr.options, attrName);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNjaGVtYS12YWxpZGF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw0Q0FBNEM7OztBQUU1Qyx5Q0FBd0Q7QUFZeEQsTUFBYSxxQkFBcUI7SUFDSDtJQUE3QixZQUE2QixXQUF5QjtRQUF6QixnQkFBVyxHQUFYLFdBQVcsQ0FBYztJQUFJLENBQUM7SUFFcEQsY0FBYyxDQUNuQixNQUFTLEVBQ1Qsb0JBQXlDO1FBRXpDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzRCxJQUFJLENBQUMsdUJBQXVCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDckMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQy9CLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRU8sdUJBQXVCLENBQzdCLE1BQVMsRUFDVCxvQkFBeUM7UUFFekMsSUFBSSxDQUFDO1lBQ0gsSUFBSSxrQkFBTSxDQUFDLE1BQU0sRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBQzFFLENBQUM7SUFDSCxDQUFDO0lBRU8sdUJBQXVCLENBQzdCLE1BQVM7UUFFVCxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7UUFFNUIsc0NBQXNDO1FBQ3RDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsSUFBSSxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDdkYsTUFBTSxDQUFDLElBQUksQ0FBQyxtQ0FBbUMsQ0FB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YSxLQUFLLFNBQVMsSUFBSSxPQUFPLElBQUksQ0FBQyxhQUFhLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDaEYsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsUUFBUSxHQUFHLENBQUMsQ0FBQztRQUN2RSxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBM1RELHNEQTJUQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIHNyYy9lbnRpdHkvdmFsaWRhdG9ycy9zY2hlbWEtdmFsaWRhdG9yLnRzXG5cbmltcG9ydCB7IEVudGl0eSwgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gXCJlbGVjdHJvZGJcIjtcbmltcG9ydCB7XG4gIEVudGl0eVNjaGVtYSxcbiAgRmllbGRNZXRhZGF0YSxcbiAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgRmlsZUZpZWxkTWV0YWRhdGEsXG4gIEltYWdlRmllbGRNZXRhZGF0YSxcbiAgRmllbGRPcHRpb25zQVBJQ29uZmlnLFxufSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHsgSURJQ29udGFpbmVyIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuXG5leHBvcnQgY2xhc3MgRW50aXR5U2NoZW1hVmFsaWRhdG9yIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBkaUNvbnRhaW5lcjogSURJQ29udGFpbmVyKSB7IH1cblxuICBwdWJsaWMgdmFsaWRhdGVTY2hlbWE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTLFxuICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiBFbnRpdHlDb25maWd1cmF0aW9uXG4gICk6IHZvaWQge1xuICAgIHRoaXMudmFsaWRhdGVFbGVjdHJvREJTY2hlbWEoc2NoZW1hLCBlbnRpdHlDb25maWd1cmF0aW9ucyk7XG4gICAgdGhpcy52YWxpZGF0ZU1vZGVsRGVmaW5pdGlvbihzY2hlbWEpO1xuICAgIHRoaXMudmFsaWRhdGVSZWxhdGlvbnMoc2NoZW1hKTtcbiAgICB0aGlzLnZhbGlkYXRlRmllbGRNZXRhZGF0YShzY2hlbWEpO1xuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUVsZWN0cm9EQlNjaGVtYTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBzY2hlbWE6IFMsXG4gICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IEVudGl0eUNvbmZpZ3VyYXRpb25cbiAgKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIG5ldyBFbnRpdHkoc2NoZW1hLCBlbnRpdHlDb25maWd1cmF0aW9ucyk7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbGVjdHJvREIgc2NoZW1hIHZhbGlkYXRpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZU1vZGVsRGVmaW5pdGlvbjxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBzY2hlbWE6IFNcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgLy8gT3B0aW9uYWwgYnV0IHR5cGVkIG1vZGVsIHByb3BlcnRpZXNcbiAgICBpZiAoc2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwgJiYgdHlwZW9mIHNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lUGx1cmFsICE9PSAnc3RyaW5nJykge1xuICAgICAgZXJyb3JzLnB1c2goJ2VudGl0eU5hbWVQbHVyYWwgbXVzdCBiZSBhIHN0cmluZycpO1xuICAgIH1cblxuICAgIGlmIChzY2hlbWEubW9kZWwuZW50aXR5TWVudUljb24gJiYgdHlwZW9mIHNjaGVtYS5tb2RlbC5lbnRpdHlNZW51SWNvbiAhPT0gJ3N0cmluZycpIHtcbiAgICAgIGVycm9ycy5wdXNoKCdlbnRpdHlNZW51SWNvbiBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgfVxuXG4gICAgLy8gQm9vbGVhbiBmbGFncyB2YWxpZGF0aW9uXG4gICAgY29uc3QgYm9vbGVhbkZsYWdzID0gW1xuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5NZW51JyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluTGlzdCcsXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbkRldGFpbCcsXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbkNyZWF0ZScsXG4gICAgICAnZXhjbHVkZUZyb21BZG1pblVwZGF0ZScsXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbkRlbGV0ZScsXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbkR1cGxpY2F0ZSdcbiAgICBdIGFzIGNvbnN0O1xuXG4gICAgZm9yIChjb25zdCBmbGFnIG9mIGJvb2xlYW5GbGFncykge1xuICAgICAgaWYgKHNjaGVtYS5tb2RlbFsgZmxhZyBdICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHNjaGVtYS5tb2RlbFsgZmxhZyBdICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYCR7ZmxhZ30gbXVzdCBiZSBhIGJvb2xlYW5gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgZGVmaW5pdGlvbiB2YWxpZGF0aW9uIGZhaWxlZDpcXG4ke2Vycm9ycy5qb2luKCdcXG4nKX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlUmVsYXRpb25zPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogU1xuICApOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IFsgYXR0ck5hbWUsIGF0dHIgXSBvZiBPYmplY3QuZW50cmllcyhzY2hlbWEuYXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghYXR0ci5yZWxhdGlvbikgY29udGludWU7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIDEuIFZhbGlkYXRlIHJlbGF0aW9uIGRlZmluaXRpb25cbiAgICAgICAgaWYgKCFhdHRyLnJlbGF0aW9uLmVudGl0eU5hbWUgfHwgIWF0dHIucmVsYXRpb24udHlwZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUmVsYXRpb24gbXVzdCBzcGVjaWZ5IGVudGl0eU5hbWUgYW5kIHR5cGUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDIuIFZhbGlkYXRlIHJlbGF0aW9uIHR5cGVcbiAgICAgICAgaWYgKCFbICdvbmUtdG8tbWFueScsICdtYW55LXRvLW9uZScgXS5pbmNsdWRlcyhhdHRyLnJlbGF0aW9uLnR5cGUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uIHR5cGUgXCIke2F0dHIucmVsYXRpb24udHlwZX1cImApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gMy4gVmFsaWRhdGUgcmVsYXRlZCBlbnRpdHkgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEoYXR0ci5yZWxhdGlvbi5lbnRpdHlOYW1lKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVsYXRlZCBlbnRpdHkgXCIke2F0dHIucmVsYXRpb24uZW50aXR5TmFtZX1cIiBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIDQuIFZhbGlkYXRlIGlkZW50aWZpZXJzXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzID0gdHlwZW9mIGF0dHIucmVsYXRpb24uaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICA/IGF0dHIucmVsYXRpb24uaWRlbnRpZmllcnMoKVxuICAgICAgICAgIDogYXR0ci5yZWxhdGlvbi5pZGVudGlmaWVycztcblxuICAgICAgICBpZiAoIWlkZW50aWZpZXJzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZWxhdGlvbiBtdXN0IHNwZWNpZnkgaWRlbnRpZmllcnMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJzTGlzdCA9IEFycmF5LmlzQXJyYXkoaWRlbnRpZmllcnMpID8gaWRlbnRpZmllcnMgOiBbIGlkZW50aWZpZXJzIF07XG4gICAgICAgIGNvbnN0IHJlbGF0ZWRTY2hlbWEgPSB0aGlzLmRpQ29udGFpbmVyLnJlc29sdmVFbnRpdHlTY2hlbWE8RW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihhdHRyLnJlbGF0aW9uLmVudGl0eU5hbWUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBpZGVudGlmaWVyc0xpc3QpIHtcbiAgICAgICAgICBpZiAoIWlkZW50aWZpZXIuc291cmNlIHx8ICFpZGVudGlmaWVyLnRhcmdldCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJZGVudGlmaWVyIG11c3Qgc3BlY2lmeSBzb3VyY2UgYW5kIHRhcmdldCcpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFZhbGlkYXRlIHRhcmdldCBleGlzdHMgaW4gcmVsYXRlZCBlbnRpdHlcbiAgICAgICAgICBpZiAoIShpZGVudGlmaWVyLnRhcmdldCBpbiByZWxhdGVkU2NoZW1hLmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRhcmdldCBhdHRyaWJ1dGUgXCIke1N0cmluZyhpZGVudGlmaWVyLnRhcmdldCl9XCIgbm90IGZvdW5kIGluIHJlbGF0ZWQgZW50aXR5YCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVmFsaWRhdGUgc291cmNlIHBhdGggZXhpc3RzIGluIGN1cnJlbnQgZW50aXR5XG4gICAgICAgICAgY29uc3Qgc291cmNlUGFydHMgPSBpZGVudGlmaWVyLnNvdXJjZS5zcGxpdCgnLicpO1xuICAgICAgICAgIGxldCBjdXJyZW50U2NoZW1hOiBhbnkgPSBzY2hlbWE7XG4gICAgICAgICAgbGV0IGN1cnJlbnRQYXRoID0gJyc7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHBhcnQgb2Ygc291cmNlUGFydHMpIHtcbiAgICAgICAgICAgIGN1cnJlbnRQYXRoID0gY3VycmVudFBhdGggPyBgJHtjdXJyZW50UGF0aH0uJHtwYXJ0fWAgOiBwYXJ0O1xuXG4gICAgICAgICAgICBpZiAoIWN1cnJlbnRTY2hlbWEuYXR0cmlidXRlcyB8fCAhKHBhcnQgaW4gY3VycmVudFNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNvdXJjZSBwYXRoIFwiJHtpZGVudGlmaWVyLnNvdXJjZX1cIiBpbnZhbGlkIGF0IFwiJHtwYXJ0fVwiYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRBdHRyID0gY3VycmVudFNjaGVtYS5hdHRyaWJ1dGVzWyBwYXJ0IF07XG5cbiAgICAgICAgICAgIC8vIElmIHRoaXMgaXMgdGhlIGxhc3QgcGFydCwgd2UgZG9uJ3QgbmVlZCB0byB0cmF2ZXJzZSBmdXJ0aGVyXG4gICAgICAgICAgICBpZiAocGFydCA9PT0gc291cmNlUGFydHNbIHNvdXJjZVBhcnRzLmxlbmd0aCAtIDEgXSkge1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRm9yIG1hcCB0eXBlcywgdHJhdmVyc2UgaW50byB0aGVpciBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBpZiAoY3VycmVudEF0dHIudHlwZSA9PT0gJ21hcCcgJiYgY3VycmVudEF0dHIucHJvcGVydGllcykge1xuICAgICAgICAgICAgICBjdXJyZW50U2NoZW1hID0geyBhdHRyaWJ1dGVzOiBjdXJyZW50QXR0ci5wcm9wZXJ0aWVzIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNvdXJjZSBwYXRoIFwiJHtpZGVudGlmaWVyLnNvdXJjZX1cIiBpbnZhbGlkIGF0IFwiJHtwYXJ0fVwiIC0gZXhwZWN0ZWQgbWFwIHR5cGVgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICBlcnJvcnMucHVzaChgSW52YWxpZCByZWxhdGlvbiBmb3IgYXR0cmlidXRlIFwiJHthdHRyTmFtZX1cIjogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnMgdmFsaWRhdGlvbiBmYWlsZWQ6XFxuJHtlcnJvcnMuam9pbignXFxuJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUZpZWxkTWV0YWRhdGE8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgWyBhdHRyTmFtZSwgYXR0ciBdIG9mIE9iamVjdC5lbnRyaWVzKHNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gVmFsaWRhdGUgZmllbGQgdHlwZSBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGF0dHIuZmllbGRUeXBlKSB7XG4gICAgICAgICAgY29uc3QgdmFsaWRGaWVsZFR5cGVzID0gW1xuICAgICAgICAgICAgLy8gVGV4dCBmaWVsZHNcbiAgICAgICAgICAgICd0ZXh0JywgJ3RleHRhcmVhJywgJ3Bhc3N3b3JkJyxcbiAgICAgICAgICAgIC8vIE51bWJlciBmaWVsZHNcbiAgICAgICAgICAgICdudW1iZXInLFxuICAgICAgICAgICAgLy8gRGF0ZS9UaW1lIGZpZWxkc1xuICAgICAgICAgICAgJ2RhdGUnLCAndGltZScsICdkYXRldGltZScsXG4gICAgICAgICAgICAvLyBCb29sZWFuIGZpZWxkc1xuICAgICAgICAgICAgJ2Jvb2xlYW4nLCAnc3dpdGNoJywgJ3RvZ2dsZScsXG4gICAgICAgICAgICAvLyBTZWxlY3Rpb24gZmllbGRzXG4gICAgICAgICAgICAnc2VsZWN0JywgJ211bHRpLXNlbGVjdCcsICdhdXRvY29tcGxldGUnLCAncmFkaW8nLCAnY2hlY2tib3gnLFxuICAgICAgICAgICAgLy8gRmlsZSBmaWVsZHNcbiAgICAgICAgICAgICdmaWxlJywgJ2ltYWdlJyxcbiAgICAgICAgICAgIC8vIE90aGVyIGZpZWxkc1xuICAgICAgICAgICAgJ2NvbG9yJywgJ3JhbmdlJywgJ2hpZGRlbicsICdjdXN0b20nLCAncmF0aW5nJyxcbiAgICAgICAgICAgICdyaWNoLXRleHQnLCAnd3lzaXd5ZycsICdjb2RlJywgJ21hcmtkb3duJywgJ2pzb24nXG4gICAgICAgICAgXTtcblxuICAgICAgICAgIGlmICghdmFsaWRGaWVsZFR5cGVzLmluY2x1ZGVzKGF0dHIuZmllbGRUeXBlKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZpZWxkIHR5cGUgXCIke2F0dHIuZmllbGRUeXBlfVwiYCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVmFsaWRhdGUgZmllbGQgdHlwZSBzcGVjaWZpYyByZXF1aXJlbWVudHNcbiAgICAgICAgICBzd2l0Y2ggKGF0dHIuZmllbGRUeXBlKSB7XG4gICAgICAgICAgICBjYXNlICdzZWxlY3QnOlxuICAgICAgICAgICAgY2FzZSAnbXVsdGktc2VsZWN0JzpcbiAgICAgICAgICAgIGNhc2UgJ2F1dG9jb21wbGV0ZSc6XG4gICAgICAgICAgICBjYXNlICdyYWRpbyc6XG4gICAgICAgICAgICBjYXNlICdjaGVja2JveCc6XG4gICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVTZWxlY3RGaWVsZE1ldGFkYXRhKGF0dHIgYXMgU2VsZWN0RmllbGRNZXRhZGF0YSwgYXR0ck5hbWUpO1xuICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgY2FzZSAnZmlsZSc6XG4gICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVGaWxlRmllbGRNZXRhZGF0YShhdHRyIGFzIEZpbGVGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICBjYXNlICdpbWFnZSc6XG4gICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVJbWFnZUZpZWxkTWV0YWRhdGEoYXR0ciBhcyBJbWFnZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgJ251bWJlcic6XG4gICAgICAgICAgICBjYXNlICdyYW5nZSc6IHtcbiAgICAgICAgICAgICAgY29uc3QgbnVtYmVyQXR0ciA9IGF0dHIgYXMgRmllbGRNZXRhZGF0YSAmIHsgbWluPzogbnVtYmVyOyBtYXg/OiBudW1iZXIgfTtcbiAgICAgICAgICAgICAgaWYgKG51bWJlckF0dHIubWluICE9PSB1bmRlZmluZWQgJiYgbnVtYmVyQXR0ci5tYXggIT09IHVuZGVmaW5lZCAmJiBudW1iZXJBdHRyLm1pbiA+IG51bWJlckF0dHIubWF4KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIHZhbHVlICgke251bWJlckF0dHIubWlufSkgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIHZhbHVlICgke251bWJlckF0dHIubWF4fSlgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAnZGF0ZSc6IHtcbiAgICAgICAgICAgICAgY29uc3QgZGF0ZUF0dHIgPSBhdHRyIGFzIEZpZWxkTWV0YWRhdGEgJiB7IG1pbkRhdGU/OiBEYXRlOyBtYXhEYXRlPzogRGF0ZSB9O1xuICAgICAgICAgICAgICBpZiAoZGF0ZUF0dHIubWluRGF0ZSAmJiBkYXRlQXR0ci5tYXhEYXRlICYmIGRhdGVBdHRyLm1pbkRhdGUgPiBkYXRlQXR0ci5tYXhEYXRlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIGRhdGUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIGRhdGVgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAnZGF0ZXRpbWUnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRhdGVUaW1lQXR0ciA9IGF0dHIgYXMgRmllbGRNZXRhZGF0YSAmIHsgbWluRGF0ZVRpbWU/OiBEYXRlOyBtYXhEYXRlVGltZT86IERhdGUgfTtcbiAgICAgICAgICAgICAgaWYgKGRhdGVUaW1lQXR0ci5taW5EYXRlVGltZSAmJiBkYXRlVGltZUF0dHIubWF4RGF0ZVRpbWUgJiYgZGF0ZVRpbWVBdHRyLm1pbkRhdGVUaW1lID4gZGF0ZVRpbWVBdHRyLm1heERhdGVUaW1lKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIGRhdGUgdGltZSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIG1heGltdW0gZGF0ZSB0aW1lYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ3RpbWUnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IHRpbWVBdHRyID0gYXR0ciBhcyBGaWVsZE1ldGFkYXRhICYgeyBtaW5UaW1lPzogc3RyaW5nOyBtYXhUaW1lPzogc3RyaW5nIH07XG4gICAgICAgICAgICAgIGlmICh0aW1lQXR0ci5taW5UaW1lICYmIHRpbWVBdHRyLm1heFRpbWUgJiYgdGltZUF0dHIubWluVGltZSA+IHRpbWVBdHRyLm1heFRpbWUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pbmltdW0gdGltZSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIG1heGltdW0gdGltZWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbGlkYXRlIGJvb2xlYW4gZmxhZ3NcbiAgICAgICAgY29uc3QgYm9vbGVhbkZsYWdzOiAoa2V5b2YgRmllbGRNZXRhZGF0YSlbXSA9IFtcbiAgICAgICAgICAnaXNWaXNpYmxlJyxcbiAgICAgICAgICAnaXNMaXN0YWJsZScsXG4gICAgICAgICAgJ2lzQ3JlYXRhYmxlJyxcbiAgICAgICAgICAnaXNFZGl0YWJsZScsXG4gICAgICAgICAgJ2lzRmlsdGVyYWJsZScsXG4gICAgICAgICAgJ2lzU2VhcmNoYWJsZSdcbiAgICAgICAgXTtcblxuICAgICAgICBmb3IgKGNvbnN0IGZsYWcgb2YgYm9vbGVhbkZsYWdzKSB7XG4gICAgICAgICAgaWYgKGF0dHJbIGZsYWcgXSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBhdHRyWyBmbGFnIF0gIT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2ZsYWd9IG11c3QgYmUgYSBib29sZWFuYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYEludmFsaWQgZmllbGQgbWV0YWRhdGEgZm9yIFwiJHthdHRyTmFtZX1cIjogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGaWVsZCBtZXRhZGF0YSB2YWxpZGF0aW9uIGZhaWxlZDpcXG4ke2Vycm9ycy5qb2luKCdcXG4nKX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlU2VsZWN0RmllbGRNZXRhZGF0YShhdHRyOiBTZWxlY3RGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKCFhdHRyLm9wdGlvbnMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignU2VsZWN0IGZpZWxkIG11c3Qgc3BlY2lmeSBvcHRpb25zJyk7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0ci5vcHRpb25zKSkge1xuICAgICAgLy8gU3RhdGljIG9wdGlvbnNcbiAgICAgIGlmIChhdHRyLm9wdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VsZWN0IGZpZWxkIG9wdGlvbnMgYXJyYXkgY2Fubm90IGJlIGVtcHR5Jyk7XG4gICAgICB9XG4gICAgICBpZiAoIWF0dHIub3B0aW9ucy5ldmVyeShvcHQgPT4gJ3ZhbHVlJyBpbiBvcHQgJiYgJ2xhYmVsJyBpbiBvcHQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3RhdGljIG9wdGlvbnMgbXVzdCBoYXZlIHZhbHVlIGFuZCBsYWJlbCBwcm9wZXJ0aWVzIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRHluYW1pYyBvcHRpb25zXG4gICAgICB0aGlzLnZhbGlkYXRlT3B0aW9uc0FQSUNvbmZpZyhhdHRyLm9wdGlvbnMsIGF0dHJOYW1lKTtcbiAgICB9XG5cbiAgICBpZiAoYXR0ci5hZGROZXdPcHRpb24pIHtcbiAgICAgIGlmICghdGhpcy5kaUNvbnRhaW5lci5oYXNFbnRpdHlTY2hlbWEoYXR0ci5hZGROZXdPcHRpb24uZW50aXR5TmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnRpdHkgXCIke2F0dHIuYWRkTmV3T3B0aW9uLmVudGl0eU5hbWV9XCIgZm9yIGFkZE5ld09wdGlvbiBub3QgZm91bmQgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVPcHRpb25zQVBJQ29uZmlnKGNvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4sIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIWNvbmZpZy5hcGlVcmwgfHwgIWNvbmZpZy5yZXNwb25zZUtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb25zIEFQSSBjb25maWcgbXVzdCBzcGVjaWZ5IGFwaVVybCBhbmQgcmVzcG9uc2VLZXkgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcuYXBpTWV0aG9kICYmICFbICdHRVQnLCAnUE9TVCcgXS5pbmNsdWRlcyhjb25maWcuYXBpTWV0aG9kKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIEFQSSBtZXRob2QgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcub3B0aW9uTWFwcGluZykge1xuICAgICAgaWYgKCFjb25maWcub3B0aW9uTWFwcGluZy5sYWJlbCB8fCAhY29uZmlnLm9wdGlvbk1hcHBpbmcudmFsdWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcHRpb24gbWFwcGluZyBtdXN0IHNwZWNpZnkgbGFiZWwgYW5kIHZhbHVlIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlRmlsZUZpZWxkTWV0YWRhdGEoYXR0cjogRmlsZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoYXR0ci5nZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWcpIHtcbiAgICAgIGNvbnN0IHsgYXBpVXJsLCBhcGlNZXRob2QgfSA9IGF0dHIuZ2V0U2lnbmVkVXBsb2FkVXJsQVBJQ29uZmlnO1xuICAgICAgaWYgKCFhcGlVcmwgfHwgIVsgJ0dFVCcsICdQT1NUJyBdLmluY2x1ZGVzKGFwaU1ldGhvZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNpZ25lZCB1cGxvYWQgVVJMIGNvbmZpZ3VyYXRpb24gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhdHRyLm1heEZpbGVTaXplICYmIHR5cGVvZiBhdHRyLm1heEZpbGVTaXplICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBtYXhGaWxlU2l6ZSBtdXN0IGJlIGEgbnVtYmVyIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlSW1hZ2VGaWVsZE1ldGFkYXRhKGF0dHI6IEltYWdlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMudmFsaWRhdGVGaWxlRmllbGRNZXRhZGF0YShhdHRyIGFzIEZpbGVGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG5cbiAgICBpZiAoYXR0ci53aXRoSW1hZ2VDcm9wICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGF0dHIud2l0aEltYWdlQ3JvcCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhJbWFnZUNyb3AgbXVzdCBiZSBhIGJvb2xlYW4gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cbiAgfVxufSJdfQ==