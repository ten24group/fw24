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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNjaGVtYS12YWxpZGF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw0Q0FBNEM7OztBQUU1Qyx5Q0FBd0Q7QUFZeEQsTUFBYSxxQkFBcUI7SUFDSDtJQUE3QixZQUE2QixXQUF5QjtRQUF6QixnQkFBVyxHQUFYLFdBQVcsQ0FBYztJQUFJLENBQUM7SUFFcEQsY0FBYyxDQUNuQixNQUFTLEVBQ1Qsb0JBQXlDO1FBRXpDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUMzRCxJQUFJLENBQUMsdUJBQXVCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDckMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQy9CLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRU8sdUJBQXVCLENBQzdCLE1BQVMsRUFDVCxvQkFBeUM7UUFFekMsSUFBSSxDQUFDO1lBQ0gsSUFBSSxrQkFBTSxDQUFDLE1BQU0sRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBQzFFLENBQUM7SUFDSCxDQUFDO0lBRU8sdUJBQXVCLENBQzdCLE1BQVM7UUFFVCxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7UUFFNUIsc0NBQXNDO1FBQ3RDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsSUFBSSxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDdkYsTUFBTSxDQUFDLElBQUksQ0FBQyxtQ0FBbUMsQ0FB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SSxJQUFJLENBQUMsV0FBVyxJQUFJLE9BQU8sSUFBSSxDQUFDLFdBQVcsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM3RCxNQUFNLElBQUksS0FBSyxDQUFDLHFDQUFxQyxRQUFRLEdBQUcsQ0FBQyxDQUFDO1FBQ3BFLENBQUM7SUFDSCxDQUFDO0lBRU8sMEJBQTBCLENBQUMsSUFBd0IsRUFBRSxRQUFnQjtRQUMzRSxJQUFJLENBQUMseUJBQXlCLENBQUMsSUFBeUIsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUVwRSxJQUFJLElBQUksQ0FBQyxhQUFhLEtBQUssU0FBUyxJQUFJLE9BQU8sSUFBSSxDQUFDLGFBQWEsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNoRixNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxRQUFRLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUE5VEQsc0RBOFRDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gc3JjL2VudGl0eS92YWxpZGF0b3JzL3NjaGVtYS12YWxpZGF0b3IudHNcblxuaW1wb3J0IHsgRW50aXR5LCBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHtcbiAgRW50aXR5U2NoZW1hLFxuICBGaWVsZE1ldGFkYXRhLFxuICBTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICBGaWxlRmllbGRNZXRhZGF0YSxcbiAgSW1hZ2VGaWVsZE1ldGFkYXRhLFxuICBGaWVsZE9wdGlvbnNBUElDb25maWcsXG59IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgeyBJRElDb250YWluZXIgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuXG5cbmV4cG9ydCBjbGFzcyBFbnRpdHlTY2hlbWFWYWxpZGF0b3Ige1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGRpQ29udGFpbmVyOiBJRElDb250YWluZXIpIHsgfVxuXG4gIHB1YmxpYyB2YWxpZGF0ZVNjaGVtYTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBzY2hlbWE6IFMsXG4gICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IEVudGl0eUNvbmZpZ3VyYXRpb25cbiAgKTogdm9pZCB7XG4gICAgdGhpcy52YWxpZGF0ZUVsZWN0cm9EQlNjaGVtYShzY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb25zKTtcbiAgICB0aGlzLnZhbGlkYXRlTW9kZWxEZWZpbml0aW9uKHNjaGVtYSk7XG4gICAgdGhpcy52YWxpZGF0ZVJlbGF0aW9ucyhzY2hlbWEpO1xuICAgIHRoaXMudmFsaWRhdGVGaWVsZE1ldGFkYXRhKHNjaGVtYSk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlRWxlY3Ryb0RCU2NoZW1hPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogUyxcbiAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvblxuICApOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgbmV3IEVudGl0eShzY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb25zKTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVsZWN0cm9EQiBzY2hlbWEgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlTW9kZWxEZWZpbml0aW9uPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KFxuICAgIHNjaGVtYTogU1xuICApOiB2b2lkIHtcbiAgICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgICAvLyBPcHRpb25hbCBidXQgdHlwZWQgbW9kZWwgcHJvcGVydGllc1xuICAgIGlmIChzY2hlbWEubW9kZWwuZW50aXR5TmFtZVBsdXJhbCAmJiB0eXBlb2Ygc2NoZW1hLm1vZGVsLmVudGl0eU5hbWVQbHVyYWwgIT09ICdzdHJpbmcnKSB7XG4gICAgICBlcnJvcnMucHVzaCgnZW50aXR5TmFtZVBsdXJhbCBtdXN0IGJlIGEgc3RyaW5nJyk7XG4gICAgfVxuXG4gICAgaWYgKHNjaGVtYS5tb2RlbC5lbnRpdHlNZW51SWNvbiAmJiB0eXBlb2Ygc2NoZW1hLm1vZGVsLmVudGl0eU1lbnVJY29uICE9PSAnc3RyaW5nJykge1xuICAgICAgZXJyb3JzLnB1c2goJ2VudGl0eU1lbnVJY29uIG11c3QgYmUgYSBzdHJpbmcnKTtcbiAgICB9XG5cbiAgICAvLyBCb29sZWFuIGZsYWdzIHZhbGlkYXRpb25cbiAgICBjb25zdCBib29sZWFuRmxhZ3MgPSBbXG4gICAgICAnZXhjbHVkZUZyb21BZG1pbk1lbnUnLFxuICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5MaXN0JyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluRGV0YWlsJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluQ3JlYXRlJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluVXBkYXRlJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluRGVsZXRlJyxcbiAgICAgICdleGNsdWRlRnJvbUFkbWluRHVwbGljYXRlJ1xuICAgIF0gYXMgY29uc3Q7XG5cbiAgICBmb3IgKGNvbnN0IGZsYWcgb2YgYm9vbGVhbkZsYWdzKSB7XG4gICAgICBpZiAoc2NoZW1hLm1vZGVsWyBmbGFnIF0gIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygc2NoZW1hLm1vZGVsWyBmbGFnIF0gIT09ICdib29sZWFuJykge1xuICAgICAgICBlcnJvcnMucHVzaChgJHtmbGFnfSBtdXN0IGJlIGEgYm9vbGVhbmApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCBkZWZpbml0aW9uIHZhbGlkYXRpb24gZmFpbGVkOlxcbiR7ZXJyb3JzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVSZWxhdGlvbnM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgc2NoZW1hOiBTXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgWyBhdHRyTmFtZSwgYXR0ciBdIG9mIE9iamVjdC5lbnRyaWVzKHNjaGVtYS5hdHRyaWJ1dGVzKSkge1xuICAgICAgaWYgKCFhdHRyLnJlbGF0aW9uKSBjb250aW51ZTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gMS4gVmFsaWRhdGUgcmVsYXRpb24gZGVmaW5pdGlvblxuICAgICAgICBpZiAoIWF0dHIucmVsYXRpb24uZW50aXR5TmFtZSB8fCAhYXR0ci5yZWxhdGlvbi50eXBlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZWxhdGlvbiBtdXN0IHNwZWNpZnkgZW50aXR5TmFtZSBhbmQgdHlwZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gMi4gVmFsaWRhdGUgcmVsYXRpb24gdHlwZVxuICAgICAgICBpZiAoIVsgJ29uZS10by1tYW55JywgJ21hbnktdG8tb25lJyBdLmluY2x1ZGVzKGF0dHIucmVsYXRpb24udHlwZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVsYXRpb24gdHlwZSBcIiR7YXR0ci5yZWxhdGlvbi50eXBlfVwiYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyAzLiBWYWxpZGF0ZSByZWxhdGVkIGVudGl0eSBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLmRpQ29udGFpbmVyLmhhc0VudGl0eVNjaGVtYShhdHRyLnJlbGF0aW9uLmVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGVkIGVudGl0eSBcIiR7YXR0ci5yZWxhdGlvbi5lbnRpdHlOYW1lfVwiIG5vdCBmb3VuZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gNC4gVmFsaWRhdGUgaWRlbnRpZmllcnNcbiAgICAgICAgY29uc3QgaWRlbnRpZmllcnMgPSB0eXBlb2YgYXR0ci5yZWxhdGlvbi5pZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gYXR0ci5yZWxhdGlvbi5pZGVudGlmaWVycygpXG4gICAgICAgICAgOiBhdHRyLnJlbGF0aW9uLmlkZW50aWZpZXJzO1xuXG4gICAgICAgIGlmICghaWRlbnRpZmllcnMpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlbGF0aW9uIG11c3Qgc3BlY2lmeSBpZGVudGlmaWVycycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaWRlbnRpZmllcnNMaXN0ID0gQXJyYXkuaXNBcnJheShpZGVudGlmaWVycykgPyBpZGVudGlmaWVycyA6IFsgaWRlbnRpZmllcnMgXTtcbiAgICAgICAgY29uc3QgcmVsYXRlZFNjaGVtYSA9IHRoaXMuZGlDb250YWluZXIucmVzb2x2ZUVudGl0eVNjaGVtYTxFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KGF0dHIucmVsYXRpb24uZW50aXR5TmFtZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGlkZW50aWZpZXJzTGlzdCkge1xuICAgICAgICAgIGlmICghaWRlbnRpZmllci5zb3VyY2UgfHwgIWlkZW50aWZpZXIudGFyZ2V0KSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lkZW50aWZpZXIgbXVzdCBzcGVjaWZ5IHNvdXJjZSBhbmQgdGFyZ2V0Jyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVmFsaWRhdGUgdGFyZ2V0IGV4aXN0cyBpbiByZWxhdGVkIGVudGl0eVxuICAgICAgICAgIGlmICghKGlkZW50aWZpZXIudGFyZ2V0IGluIHJlbGF0ZWRTY2hlbWEuYXR0cmlidXRlcykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGFyZ2V0IGF0dHJpYnV0ZSBcIiR7U3RyaW5nKGlkZW50aWZpZXIudGFyZ2V0KX1cIiBub3QgZm91bmQgaW4gcmVsYXRlZCBlbnRpdHlgKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBWYWxpZGF0ZSBzb3VyY2UgcGF0aCBleGlzdHMgaW4gY3VycmVudCBlbnRpdHlcbiAgICAgICAgICBjb25zdCBzb3VyY2VQYXJ0cyA9IGlkZW50aWZpZXIuc291cmNlLnNwbGl0KCcuJyk7XG4gICAgICAgICAgbGV0IGN1cnJlbnRTY2hlbWE6IGFueSA9IHNjaGVtYTtcbiAgICAgICAgICBsZXQgY3VycmVudFBhdGggPSAnJztcblxuICAgICAgICAgIGZvciAoY29uc3QgcGFydCBvZiBzb3VyY2VQYXJ0cykge1xuICAgICAgICAgICAgY3VycmVudFBhdGggPSBjdXJyZW50UGF0aCA/IGAke2N1cnJlbnRQYXRofS4ke3BhcnR9YCA6IHBhcnQ7XG5cbiAgICAgICAgICAgIGlmICghY3VycmVudFNjaGVtYS5hdHRyaWJ1dGVzIHx8ICEocGFydCBpbiBjdXJyZW50U2NoZW1hLmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU291cmNlIHBhdGggXCIke2lkZW50aWZpZXIuc291cmNlfVwiIGludmFsaWQgYXQgXCIke3BhcnR9XCJgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY3VycmVudEF0dHIgPSBjdXJyZW50U2NoZW1hLmF0dHJpYnV0ZXNbIHBhcnQgXTtcblxuICAgICAgICAgICAgLy8gSWYgdGhpcyBpcyB0aGUgbGFzdCBwYXJ0LCB3ZSBkb24ndCBuZWVkIHRvIHRyYXZlcnNlIGZ1cnRoZXJcbiAgICAgICAgICAgIGlmIChwYXJ0ID09PSBzb3VyY2VQYXJ0c1sgc291cmNlUGFydHMubGVuZ3RoIC0gMSBdKSB7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBGb3IgbWFwIHR5cGVzLCB0cmF2ZXJzZSBpbnRvIHRoZWlyIHByb3BlcnRpZXNcbiAgICAgICAgICAgIGlmIChjdXJyZW50QXR0ci50eXBlID09PSAnbWFwJyAmJiBjdXJyZW50QXR0ci5wcm9wZXJ0aWVzKSB7XG4gICAgICAgICAgICAgIGN1cnJlbnRTY2hlbWEgPSB7IGF0dHJpYnV0ZXM6IGN1cnJlbnRBdHRyLnByb3BlcnRpZXMgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU291cmNlIHBhdGggXCIke2lkZW50aWZpZXIuc291cmNlfVwiIGludmFsaWQgYXQgXCIke3BhcnR9XCIgLSBleHBlY3RlZCBtYXAgdHlwZWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGBJbnZhbGlkIHJlbGF0aW9uIGZvciBhdHRyaWJ1dGUgXCIke2F0dHJOYW1lfVwiOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlbGF0aW9ucyB2YWxpZGF0aW9uIGZhaWxlZDpcXG4ke2Vycm9ycy5qb2luKCdcXG4nKX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlRmllbGRNZXRhZGF0YTxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBzY2hlbWE6IFNcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBbIGF0dHJOYW1lLCBhdHRyIF0gb2YgT2JqZWN0LmVudHJpZXMoc2NoZW1hLmF0dHJpYnV0ZXMpKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBWYWxpZGF0ZSBmaWVsZCB0eXBlIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoYXR0ci5maWVsZFR5cGUpIHtcbiAgICAgICAgICBjb25zdCB2YWxpZEZpZWxkVHlwZXMgPSBbXG4gICAgICAgICAgICAvLyBUZXh0IGZpZWxkc1xuICAgICAgICAgICAgJ3RleHQnLCAndGV4dGFyZWEnLCAncGFzc3dvcmQnLFxuICAgICAgICAgICAgLy8gTnVtYmVyIGZpZWxkc1xuICAgICAgICAgICAgJ251bWJlcicsXG4gICAgICAgICAgICAvLyBEYXRlL1RpbWUgZmllbGRzXG4gICAgICAgICAgICAnZGF0ZScsICd0aW1lJywgJ2RhdGV0aW1lJywgJ2R1cmF0aW9uJywgJ3R0bCcsXG4gICAgICAgICAgICAvLyBCb29sZWFuIGZpZWxkc1xuICAgICAgICAgICAgJ2Jvb2xlYW4nLCAnc3dpdGNoJywgJ3RvZ2dsZScsXG4gICAgICAgICAgICAvLyBTZWxlY3Rpb24gZmllbGRzXG4gICAgICAgICAgICAnc2VsZWN0JywgJ211bHRpLXNlbGVjdCcsICdhdXRvY29tcGxldGUnLCAncmFkaW8nLCAnY2hlY2tib3gnLFxuICAgICAgICAgICAgLy8gRmlsZSBmaWVsZHNcbiAgICAgICAgICAgICdmaWxlJywgJ2ltYWdlJyxcbiAgICAgICAgICAgIC8vIE90aGVyIGZpZWxkc1xuICAgICAgICAgICAgJ2NvbG9yJywgJ3JhbmdlJywgJ2hpZGRlbicsICdjdXN0b20nLCAncmF0aW5nJyxcbiAgICAgICAgICAgICdyaWNoLXRleHQnLCAnd3lzaXd5ZycsICdjb2RlJywgJ21hcmtkb3duJywgJ2pzb24nXG4gICAgICAgICAgXTtcblxuICAgICAgICAgIGlmICghdmFsaWRGaWVsZFR5cGVzLmluY2x1ZGVzKGF0dHIuZmllbGRUeXBlKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGZpZWxkIHR5cGUgXCIke2F0dHIuZmllbGRUeXBlfVwiYCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVmFsaWRhdGUgZmllbGQgdHlwZSBzcGVjaWZpYyByZXF1aXJlbWVudHNcbiAgICAgICAgICBzd2l0Y2ggKGF0dHIuZmllbGRUeXBlKSB7XG4gICAgICAgICAgICBjYXNlICdzZWxlY3QnOlxuICAgICAgICAgICAgY2FzZSAnbXVsdGktc2VsZWN0JzpcbiAgICAgICAgICAgIGNhc2UgJ2F1dG9jb21wbGV0ZSc6XG4gICAgICAgICAgICBjYXNlICdyYWRpbyc6XG4gICAgICAgICAgICBjYXNlICdjaGVja2JveCc6XG4gICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVTZWxlY3RGaWVsZE1ldGFkYXRhKGF0dHIgYXMgU2VsZWN0RmllbGRNZXRhZGF0YSwgYXR0ck5hbWUpO1xuICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgY2FzZSAnZmlsZSc6XG4gICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVGaWxlRmllbGRNZXRhZGF0YShhdHRyIGFzIEZpbGVGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuXG4gICAgICAgICAgICBjYXNlICdpbWFnZSc6XG4gICAgICAgICAgICAgIHRoaXMudmFsaWRhdGVJbWFnZUZpZWxkTWV0YWRhdGEoYXR0ciBhcyBJbWFnZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgJ251bWJlcic6XG4gICAgICAgICAgICBjYXNlICdyYW5nZSc6IHtcbiAgICAgICAgICAgICAgY29uc3QgbnVtYmVyQXR0ciA9IGF0dHIgYXMgRmllbGRNZXRhZGF0YSAmIHsgbWluPzogbnVtYmVyOyBtYXg/OiBudW1iZXIgfTtcbiAgICAgICAgICAgICAgaWYgKG51bWJlckF0dHIubWluICE9PSB1bmRlZmluZWQgJiYgbnVtYmVyQXR0ci5tYXggIT09IHVuZGVmaW5lZCAmJiBudW1iZXJBdHRyLm1pbiA+IG51bWJlckF0dHIubWF4KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIHZhbHVlICgke251bWJlckF0dHIubWlufSkgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIHZhbHVlICgke251bWJlckF0dHIubWF4fSlgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAnZGF0ZSc6IHtcbiAgICAgICAgICAgICAgY29uc3QgZGF0ZUF0dHIgPSBhdHRyIGFzIEZpZWxkTWV0YWRhdGEgJiB7IG1pbkRhdGU/OiBEYXRlOyBtYXhEYXRlPzogRGF0ZSB9O1xuICAgICAgICAgICAgICBpZiAoZGF0ZUF0dHIubWluRGF0ZSAmJiBkYXRlQXR0ci5tYXhEYXRlICYmIGRhdGVBdHRyLm1pbkRhdGUgPiBkYXRlQXR0ci5tYXhEYXRlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIGRhdGUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIGRhdGVgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2FzZSAnZGF0ZXRpbWUnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRhdGVUaW1lQXR0ciA9IGF0dHIgYXMgRmllbGRNZXRhZGF0YSAmIHsgbWluRGF0ZVRpbWU/OiBEYXRlOyBtYXhEYXRlVGltZT86IERhdGUgfTtcbiAgICAgICAgICAgICAgaWYgKGRhdGVUaW1lQXR0ci5taW5EYXRlVGltZSAmJiBkYXRlVGltZUF0dHIubWF4RGF0ZVRpbWUgJiYgZGF0ZVRpbWVBdHRyLm1pbkRhdGVUaW1lID4gZGF0ZVRpbWVBdHRyLm1heERhdGVUaW1lKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaW5pbXVtIGRhdGUgdGltZSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIG1heGltdW0gZGF0ZSB0aW1lYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNhc2UgJ3RpbWUnOiB7XG4gICAgICAgICAgICAgIGNvbnN0IHRpbWVBdHRyID0gYXR0ciBhcyBGaWVsZE1ldGFkYXRhICYgeyBtaW5UaW1lPzogc3RyaW5nOyBtYXhUaW1lPzogc3RyaW5nIH07XG4gICAgICAgICAgICAgIGlmICh0aW1lQXR0ci5taW5UaW1lICYmIHRpbWVBdHRyLm1heFRpbWUgJiYgdGltZUF0dHIubWluVGltZSA+IHRpbWVBdHRyLm1heFRpbWUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pbmltdW0gdGltZSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIG1heGltdW0gdGltZWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFZhbGlkYXRlIGJvb2xlYW4gZmxhZ3NcbiAgICAgICAgY29uc3QgYm9vbGVhbkZsYWdzOiAoa2V5b2YgRmllbGRNZXRhZGF0YSlbXSA9IFtcbiAgICAgICAgICAnaXNWaXNpYmxlJyxcbiAgICAgICAgICAnaXNMaXN0YWJsZScsXG4gICAgICAgICAgJ2lzQ3JlYXRhYmxlJyxcbiAgICAgICAgICAnaXNFZGl0YWJsZScsXG4gICAgICAgICAgJ2lzRmlsdGVyYWJsZScsXG4gICAgICAgICAgJ2lzU2VhcmNoYWJsZSdcbiAgICAgICAgXTtcblxuICAgICAgICBmb3IgKGNvbnN0IGZsYWcgb2YgYm9vbGVhbkZsYWdzKSB7XG4gICAgICAgICAgaWYgKGF0dHJbIGZsYWcgXSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBhdHRyWyBmbGFnIF0gIT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2ZsYWd9IG11c3QgYmUgYSBib29sZWFuYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goYEludmFsaWQgZmllbGQgbWV0YWRhdGEgZm9yIFwiJHthdHRyTmFtZX1cIjogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGaWVsZCBtZXRhZGF0YSB2YWxpZGF0aW9uIGZhaWxlZDpcXG4ke2Vycm9ycy5qb2luKCdcXG4nKX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlU2VsZWN0RmllbGRNZXRhZGF0YShhdHRyOiBTZWxlY3RGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKCFhdHRyLm9wdGlvbnMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignU2VsZWN0IGZpZWxkIG11c3Qgc3BlY2lmeSBvcHRpb25zJyk7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0ci5vcHRpb25zKSkge1xuICAgICAgLy8gU3RhdGljIG9wdGlvbnNcbiAgICAgIGlmIChhdHRyLm9wdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2VsZWN0IGZpZWxkIG9wdGlvbnMgYXJyYXkgY2Fubm90IGJlIGVtcHR5Jyk7XG4gICAgICB9XG4gICAgICBpZiAoIWF0dHIub3B0aW9ucy5ldmVyeShvcHQgPT4gJ3ZhbHVlJyBpbiBvcHQgJiYgJ2xhYmVsJyBpbiBvcHQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3RhdGljIG9wdGlvbnMgbXVzdCBoYXZlIHZhbHVlIGFuZCBsYWJlbCBwcm9wZXJ0aWVzIGZvciBcIiR7YXR0ck5hbWV9XCJgKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBhdHRyLm9wdGlvbnMgPT09ICdvYmplY3QnICYmICgnYXBpTWV0aG9kJyBpbiBhdHRyLm9wdGlvbnMgfHwgJ2FwaVVybCcgaW4gYXR0ci5vcHRpb25zIHx8ICdyZXNwb25zZUtleScgaW4gYXR0ci5vcHRpb25zKSkge1xuICAgICAgLy8gRHluYW1pYyBvcHRpb25zIChBUEkgY29uZmlnKSAtIGNoZWNrIGZvciBhbnkgQVBJIGNvbmZpZyBwcm9wZXJ0eSB0byBwcm9wZXJseSB2YWxpZGF0ZSBpbmNvbXBsZXRlIGNvbmZpZ3NcbiAgICAgIHRoaXMudmFsaWRhdGVPcHRpb25zQVBJQ29uZmlnKGF0dHIub3B0aW9ucyBhcyBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiwgYXR0ck5hbWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBEeW5hbWljIG9wdGlvbnNcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBvcHRpb25zIGNvbmZpZ3VyYXRpb24gZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cblxuICAgIGlmIChhdHRyLmFkZE5ld09wdGlvbikge1xuICAgICAgaWYgKCF0aGlzLmRpQ29udGFpbmVyLmhhc0VudGl0eVNjaGVtYShhdHRyLmFkZE5ld09wdGlvbi5lbnRpdHlOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVudGl0eSBcIiR7YXR0ci5hZGROZXdPcHRpb24uZW50aXR5TmFtZX1cIiBmb3IgYWRkTmV3T3B0aW9uIG5vdCBmb3VuZCBmb3IgXCIke2F0dHJOYW1lfVwiYCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZU9wdGlvbnNBUElDb25maWcoY29uZmlnOiBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICghY29uZmlnLmFwaVVybCB8fCAhY29uZmlnLnJlc3BvbnNlS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE9wdGlvbnMgQVBJIGNvbmZpZyBtdXN0IHNwZWNpZnkgYXBpVXJsIGFuZCByZXNwb25zZUtleSBmb3IgXCIke2F0dHJOYW1lfVwiYCk7XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy5hcGlNZXRob2QgJiYgIVsgJ0dFVCcsICdQT1NUJyBdLmluY2x1ZGVzKGNvbmZpZy5hcGlNZXRob2QpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgQVBJIG1ldGhvZCBmb3IgXCIke2F0dHJOYW1lfVwiYCk7XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy5vcHRpb25NYXBwaW5nKSB7XG4gICAgICBpZiAoIWNvbmZpZy5vcHRpb25NYXBwaW5nLmxhYmVsIHx8ICFjb25maWcub3B0aW9uTWFwcGluZy52YWx1ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE9wdGlvbiBtYXBwaW5nIG11c3Qgc3BlY2lmeSBsYWJlbCBhbmQgdmFsdWUgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVGaWxlRmllbGRNZXRhZGF0YShhdHRyOiBGaWxlRmllbGRNZXRhZGF0YSwgYXR0ck5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmIChhdHRyLmdldFNpZ25lZFVwbG9hZFVybEFQSUNvbmZpZykge1xuICAgICAgY29uc3QgeyBhcGlVcmwsIGFwaU1ldGhvZCB9ID0gYXR0ci5nZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWc7XG4gICAgICBpZiAoIWFwaVVybCB8fCAhWyAnR0VUJywgJ1BPU1QnIF0uaW5jbHVkZXMoYXBpTWV0aG9kKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2lnbmVkIHVwbG9hZCBVUkwgY29uZmlndXJhdGlvbiBmb3IgXCIke2F0dHJOYW1lfVwiYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGF0dHIubWF4RmlsZVNpemUgJiYgdHlwZW9mIGF0dHIubWF4RmlsZVNpemUgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYG1heEZpbGVTaXplIG11c3QgYmUgYSBudW1iZXIgZm9yIFwiJHthdHRyTmFtZX1cImApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVJbWFnZUZpZWxkTWV0YWRhdGEoYXR0cjogSW1hZ2VGaWVsZE1ldGFkYXRhLCBhdHRyTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy52YWxpZGF0ZUZpbGVGaWVsZE1ldGFkYXRhKGF0dHIgYXMgRmlsZUZpZWxkTWV0YWRhdGEsIGF0dHJOYW1lKTtcblxuICAgIGlmIChhdHRyLndpdGhJbWFnZUNyb3AgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgYXR0ci53aXRoSW1hZ2VDcm9wICE9PSAnYm9vbGVhbicpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgd2l0aEltYWdlQ3JvcCBtdXN0IGJlIGEgYm9vbGVhbiBmb3IgXCIke2F0dHJOYW1lfVwiYCk7XG4gICAgfVxuICB9XG59Il19