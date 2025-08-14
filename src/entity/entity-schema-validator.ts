// src/entity/validators/schema-validator.ts

import { Entity, EntityConfiguration } from "electrodb";
import {
  EntitySchema,
  FieldMetadata,
  SelectFieldMetadata,
  FileFieldMetadata,
  ImageFieldMetadata,
  FieldOptionsAPIConfig,
} from "./base-entity";
import { IDIContainer } from "../interfaces";


export class EntitySchemaValidator {
  constructor(private readonly diContainer: IDIContainer) { }

  public validateSchema<S extends EntitySchema<any, any, any>>(
    schema: S,
    entityConfigurations: EntityConfiguration
  ): void {
    this.validateElectroDBSchema(schema, entityConfigurations);
    this.validateModelDefinition(schema);
    this.validateRelations(schema);
    this.validateFieldMetadata(schema);
  }

  private validateElectroDBSchema<S extends EntitySchema<any, any, any>>(
    schema: S,
    entityConfigurations: EntityConfiguration
  ): void {
    try {
      new Entity(schema, entityConfigurations);
    } catch (error: any) {
      throw new Error(`ElectroDB schema validation failed: ${error.message}`);
    }
  }

  private validateModelDefinition<S extends EntitySchema<any, any, any>>(
    schema: S
  ): void {
    const errors: string[] = [];

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
    ] as const;

    for (const flag of booleanFlags) {
      if (schema.model[ flag ] !== undefined && typeof schema.model[ flag ] !== 'boolean') {
        errors.push(`${flag} must be a boolean`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Model definition validation failed:\n${errors.join('\n')}`);
    }
  }

  private validateRelations<S extends EntitySchema<any, any, any>>(
    schema: S
  ): void {
    const errors: string[] = [];

    for (const [ attrName, attr ] of Object.entries(schema.attributes)) {
      if (!attr.relation) continue;

      try {
        // 1. Validate relation definition
        if (!attr.relation.entityName || !attr.relation.type) {
          throw new Error('Relation must specify entityName and type');
        }

        // 2. Validate relation type
        if (![ 'one-to-many', 'many-to-one' ].includes(attr.relation.type)) {
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

        const identifiersList = Array.isArray(identifiers) ? identifiers : [ identifiers ];
        const relatedSchema = this.diContainer.resolveEntitySchema<EntitySchema<any, any, any>>(attr.relation.entityName);

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
          let currentSchema: any = schema;
          let currentPath = '';

          for (const part of sourceParts) {
            currentPath = currentPath ? `${currentPath}.${part}` : part;

            if (!currentSchema.attributes || !(part in currentSchema.attributes)) {
              throw new Error(`Source path "${identifier.source}" invalid at "${part}"`);
            }

            const currentAttr = currentSchema.attributes[ part ];

            // If this is the last part, we don't need to traverse further
            if (part === sourceParts[ sourceParts.length - 1 ]) {
              break;
            }

            // For map types, traverse into their properties
            if (currentAttr.type === 'map' && currentAttr.properties) {
              currentSchema = { attributes: currentAttr.properties };
            } else {
              throw new Error(`Source path "${identifier.source}" invalid at "${part}" - expected map type`);
            }
          }
        }

      } catch (error: any) {
        errors.push(`Invalid relation for attribute "${attrName}": ${error.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Relations validation failed:\n${errors.join('\n')}`);
    }
  }

  private validateFieldMetadata<S extends EntitySchema<any, any, any>>(
    schema: S
  ): void {
    const errors: string[] = [];

    for (const [ attrName, attr ] of Object.entries(schema.attributes)) {
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
              this.validateSelectFieldMetadata(attr as SelectFieldMetadata, attrName);
              break;

            case 'file':
              this.validateFileFieldMetadata(attr as FileFieldMetadata, attrName);
              break;

            case 'image':
              this.validateImageFieldMetadata(attr as ImageFieldMetadata, attrName);
              break;

            case 'number':
            case 'range': {
              const numberAttr = attr as FieldMetadata & { min?: number; max?: number };
              if (numberAttr.min !== undefined && numberAttr.max !== undefined && numberAttr.min > numberAttr.max) {
                throw new Error(`Minimum value (${numberAttr.min}) cannot be greater than maximum value (${numberAttr.max})`);
              }
              break;
            }

            case 'date': {
              const dateAttr = attr as FieldMetadata & { minDate?: Date; maxDate?: Date };
              if (dateAttr.minDate && dateAttr.maxDate && dateAttr.minDate > dateAttr.maxDate) {
                throw new Error(`Minimum date cannot be greater than maximum date`);
              }
              break;
            }

            case 'datetime': {
              const dateTimeAttr = attr as FieldMetadata & { minDateTime?: Date; maxDateTime?: Date };
              if (dateTimeAttr.minDateTime && dateTimeAttr.maxDateTime && dateTimeAttr.minDateTime > dateTimeAttr.maxDateTime) {
                throw new Error(`Minimum date time cannot be greater than maximum date time`);
              }
              break;
            }

            case 'time': {
              const timeAttr = attr as FieldMetadata & { minTime?: string; maxTime?: string };
              if (timeAttr.minTime && timeAttr.maxTime && timeAttr.minTime > timeAttr.maxTime) {
                throw new Error(`Minimum time cannot be greater than maximum time`);
              }
              break;
            }
          }
        }

        // Validate boolean flags
        const booleanFlags: (keyof FieldMetadata)[] = [
          'isVisible',
          'isListable',
          'isCreatable',
          'isEditable',
          'isFilterable',
          'isSearchable'
        ];

        for (const flag of booleanFlags) {
          if (attr[ flag ] !== undefined && typeof attr[ flag ] !== 'boolean') {
            throw new Error(`${flag} must be a boolean`);
          }
        }

      } catch (error: any) {
        errors.push(`Invalid field metadata for "${attrName}": ${error.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Field metadata validation failed:\n${errors.join('\n')}`);
    }
  }

  private validateSelectFieldMetadata(attr: SelectFieldMetadata, attrName: string): void {
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
    } else {
      // Dynamic options
      this.validateOptionsAPIConfig(attr.options, attrName);
    }

    if (attr.addNewOption) {
      if (!this.diContainer.hasEntitySchema(attr.addNewOption.entityName)) {
        throw new Error(`Entity "${attr.addNewOption.entityName}" for addNewOption not found for "${attrName}"`);
      }
    }
  }

  private validateOptionsAPIConfig(config: FieldOptionsAPIConfig<any>, attrName: string): void {
    if (!config.apiUrl || !config.responseKey) {
      throw new Error(`Options API config must specify apiUrl and responseKey for "${attrName}"`);
    }

    if (config.apiMethod && ![ 'GET', 'POST' ].includes(config.apiMethod)) {
      throw new Error(`Invalid API method for "${attrName}"`);
    }

    if (config.optionMapping) {
      if (!config.optionMapping.label || !config.optionMapping.value) {
        throw new Error(`Option mapping must specify label and value for "${attrName}"`);
      }
    }
  }

  private validateFileFieldMetadata(attr: FileFieldMetadata, attrName: string): void {
    if (attr.getSignedUploadUrlAPIConfig) {
      const { apiUrl, apiMethod } = attr.getSignedUploadUrlAPIConfig;
      if (!apiUrl || ![ 'GET', 'POST' ].includes(apiMethod)) {
        throw new Error(`Invalid signed upload URL configuration for "${attrName}"`);
      }
    }

    if (attr.maxFileSize && typeof attr.maxFileSize !== 'number') {
      throw new Error(`maxFileSize must be a number for "${attrName}"`);
    }
  }

  private validateImageFieldMetadata(attr: ImageFieldMetadata, attrName: string): void {
    this.validateFileFieldMetadata(attr as FileFieldMetadata, attrName);

    if (attr.withImageCrop !== undefined && typeof attr.withImageCrop !== 'boolean') {
      throw new Error(`withImageCrop must be a boolean for "${attrName}"`);
    }
  }
}