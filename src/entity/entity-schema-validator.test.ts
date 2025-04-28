// src/entity/validators/__tests__/entity-schema-validator.test.ts

import { EntitySchemaValidator } from './entity-schema-validator';
import { createEntitySchema, DefaultEntityOperations } from './base-entity';
import { DIContainer } from '../di';
import { registerEntitySchema } from '../decorators';

describe('EntitySchemaValidator', () => {
  let validator: EntitySchemaValidator;
  let diContainer: DIContainer;

  beforeEach(() => {
    diContainer = new DIContainer();
    validator = new EntitySchemaValidator(diContainer);
  });

  describe('ElectroDB Schema Validation', () => {
    it('should validate valid ElectroDB schema', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: {
            type: 'string',
            required: true,
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).not.toThrow();
    });

    it('should throw on invalid ElectroDB schema', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
        },
        attributes: {
          id: {
            type: 'invalid-type', // Invalid type
            required: true,
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      } as any);

      expect(() => validator.validateSchema(schema, {})).toThrow();
    });

    it('should validate index configuration', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'nonExistentField' ], // Invalid field
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow(/ElectroDB schema validation failed/);
    });

    it('should validate attribute types', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'invalid-type' as any },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow(/ElectroDB schema validation failed/);
    });
  });

  describe('Model Definition Validation', () => {
    it('should validate model property types', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 123, // Should be string
          entityMenuIcon: true, // Should be string
        } as any,
        attributes: {
          id: { type: 'string' },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow(/entityNamePlural must be a string/);
    });

    it('should validate admin UI boolean flags', () => {
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
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
            [ flag ]: 'true', // Should be boolean
          } as any,
          attributes: {
            id: {
              type: 'string',
              required: true,
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {})).toThrow(new RegExp(`${flag} must be a boolean`));
      }
    });
  });

  describe('Relations Validation', () => {
    beforeEach(() => {
      // Register a related entity schema in DI container
      const relatedSchema = createEntitySchema({
        model: {
          entity: 'related',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'relateds',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      registerEntitySchema({
        forEntity: relatedSchema.model.entity,
        providedIn: diContainer,
        useValue: relatedSchema,
      });
    });

    it('should validate valid relation configuration', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          relatedId: { type: 'string' },
          related: {
            type: 'map',
            properties: {
              name: { type: 'string' },
            },
            relation: {
              entityName: 'related',
              type: 'many-to-one',
              identifiers: {
                source: 'relatedId',
                target: 'id',
              },
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).not.toThrow();
    });

    it('should validate relation type', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          related: {
            type: 'map',
            properties: {
              name: { type: 'string' },
            },
            relation: {
              entityName: 'related',
              type: 'invalid-type' as any,
              identifiers: {
                source: 'id',
                target: 'id',
              },
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow(/Invalid relation type/);
    });

    it('should validate relation entity exists', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          related: {
            type: 'map',
            properties: {
              name: { type: 'string' },
            },
            relation: {
              entityName: 'non-existent',
              type: 'many-to-one',
              identifiers: {
                source: 'id',
                target: 'id',
              },
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow(/Related entity.*not found/);
    });

    it('should validate relation identifiers with function and array', () => {
      // Test with function
      const schemaWithFunction = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          related: {
            type: 'map',
            properties: {
              name: { type: 'string' },
            },
            relation: {
              entityName: 'related',
              type: 'many-to-one',
              identifiers: () => ({
                source: 'id',
                target: 'id',
              }),
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schemaWithFunction, {})).not.toThrow();

      // Test with array
      const schemaWithArray = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          relatedId1: { type: 'string' },
          relatedId2: { type: 'string' },
          related: {
            type: 'map',
            properties: {
              name: { type: 'string' },
            },
            relation: {
              entityName: 'related',
              type: 'many-to-one',
              identifiers: [
                { source: 'relatedId1', target: 'id' },
                { source: 'relatedId2', target: 'id' },
              ],
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schemaWithArray, {})).not.toThrow();
    });

    it('should validate nested source paths in relation identifiers', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          nested: {
            type: 'map',
            properties: {
              relatedId: { type: 'string' },
            },
          },
          related: {
            type: 'map',
            properties: {
              name: { type: 'string' },
            },
            relation: {
              entityName: 'related',
              type: 'many-to-one',
              identifiers: {
                source: 'nested.relatedId',
                target: 'id',
              },
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).not.toThrow();
    });

    it('should validate invalid nested source paths in relation identifiers', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          nested: {
            type: 'map',
            properties: {
              relatedId: { type: 'string' },
            },
          },
          related: {
            type: 'map',
            properties: {
              name: { type: 'string' },
            },
            relation: {
              entityName: 'related',
              type: 'many-to-one',
              identifiers: {
                source: 'nested.invalidPath',
                target: 'id',
              },
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow(/Source path.*invalid at/);
    });
  });

  describe('Field Metadata Validation', () => {
    it('should validate boolean flags for field metadata', () => {
      const booleanFlags = [
        'isVisible',
        'isListable',
        'isCreatable',
        'isEditable',
        'isFilterable',
        'isSearchable'
      ];

      for (const flag of booleanFlags) {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            testField: {
              type: 'string',
              [ flag ]: 'true', // Should be boolean
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {})).toThrow(new RegExp(`${flag} must be a boolean`));
      }
    });

    describe('Select Fields', () => {
      it('should validate static options', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            status: {
              type: 'string',
              fieldType: 'select',
              options: [
                { value: 'active' } as any, // Missing label
              ],
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {}))
          .toThrow(/Static options must have value and label/);
      });

      it('should validate dynamic options configuration', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            status: {
              type: 'string',
              fieldType: 'select',
              options: {
                apiUrl: '/api/options',
                // Missing responseKey
              } as any,
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {})).toThrow(/must specify apiUrl and responseKey/);
      });

      it('should validate option mapping', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            status: {
              type: 'string',
              fieldType: 'select',
              options: {
                apiUrl: '/api/options',
                responseKey: 'items',
                apiMethod: 'GET',
                optionMapping: {
                  label: 'name',
                  // Missing value
                } as any,
              },
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {})).toThrow(/Option mapping must specify label and value/);
      });

      it('should validate addNewOption entity exists', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            status: {
              type: 'string',
              fieldType: 'select',
              options: [
                { value: 'active', label: 'Active' },
              ],
              addNewOption: {
                entityName: 'non-existent',
              },
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {})).toThrow(/Entity.*for addNewOption not found/);
      });
    });

    describe('File Fields', () => {
      it('should validate signed URL configuration', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            document: {
              type: 'string',
              fieldType: 'file',
              getSignedUploadUrlAPIConfig: {
                apiUrl: '/api/upload',
                apiMethod: 'INVALID' as any,
              },
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {}))
          .toThrow(/Invalid signed upload URL configuration/);
      });

      it('should validate maxFileSize is a number', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            document: {
              type: 'string',
              fieldType: 'file',
              maxFileSize: '1024' as any, // Should be number
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {})).toThrow(/maxFileSize must be a number/);
      });
    });

    describe('Image Fields', () => {
      it('should validate image specific configuration', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            photo: {
              type: 'string',
              fieldType: 'image',
              withImageCrop: 'yes' as any, // Should be boolean
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {}))
          .toThrow(/withImageCrop must be a boolean/);
      });

      it('should inherit file field validation', () => {
        const schema = createEntitySchema({
          model: {
            entity: 'test',
            service: 'test-service',
            version: '1',
            entityNamePlural: 'tests',
            entityOperations: DefaultEntityOperations,
          },
          attributes: {
            id: { type: 'string' },
            photo: {
              type: 'string',
              fieldType: 'image',
              maxFileSize: '1024' as any, // Should be number
            },
          },
          indexes: {
            primary: {
              pk: {
                field: 'pk',
                composite: [ 'id' ],
              },
            },
          },
        });

        expect(() => validator.validateSchema(schema, {})).toThrow(/maxFileSize must be a number/);
      });
    });

    it('should validate field type', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          testField: {
            type: 'string',
            fieldType: 'invalid-type' as any,
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow(/Invalid field type/);
    });

    it('should validate required field metadata properties', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          testField: {
            type: 'string',
            fieldType: 'select',
            options: [] as any, // Empty array to satisfy type but fail validation
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(schema, {})).toThrow();
    });

    // Additional tests for number, date, datetime, and time validations

    it('should throw for number field when min is greater than max', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          numberField: { type: 'number', fieldType: 'number', min: 10, max: 5 },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum value \(10\) cannot be greater than maximum value \(5\)/);
    });

    it('should not throw for number field when min is less than or equal to max', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          numberField: { type: 'number', fieldType: 'number', min: 5, max: 10 },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).not.toThrow();
    });

    it('should throw for date field when minDate is later than maxDate', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          dateField: { type: 'string', fieldType: 'date', minDate: new Date('2023-01-02'), maxDate: new Date('2023-01-01') },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum date cannot be greater than maximum date/);
    });

    it('should not throw for date field when minDate is earlier than or equal to maxDate', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          dateField: { type: 'string', fieldType: 'date', minDate: new Date('2023-01-01'), maxDate: new Date('2023-01-02') },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).not.toThrow();
    });

    it('should throw for datetime field when minDateTime is later than maxDateTime', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          datetimeField: { type: 'string', fieldType: 'datetime', minDateTime: new Date('2023-02-02T10:00:00'), maxDateTime: new Date('2023-02-02T09:00:00') },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum date time cannot be greater than maximum date time/);
    });

    it('should not throw for datetime field when minDateTime is earlier than or equal to maxDateTime', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          datetimeField: { type: 'string', fieldType: 'datetime', minDateTime: new Date('2023-02-02T09:00:00'), maxDateTime: new Date('2023-02-02T10:00:00') },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).not.toThrow();
    });

    it('should throw for time field when minTime is greater than maxTime', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          timeField: { type: 'string', fieldType: 'time', minTime: '15:00', maxTime: '10:00' },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum time cannot be greater than maximum time/);
    });

    it('should not throw for time field when minTime is less than or equal to maxTime', () => {
      const schema = createEntitySchema({
        model: {
          entity: 'test',
          service: 'test-service',
          version: '1',
          entityNamePlural: 'tests',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          timeField: { type: 'string', fieldType: 'time', minTime: '09:00', maxTime: '10:00' },
        },
        indexes: {
          primary: { pk: { field: 'pk', composite: [ 'id' ] } },
        },
      });
      expect(() => validator.validateSchema(schema, {})).not.toThrow();
    });
  });

  describe('Real World Entity Examples', () => {
    beforeEach(() => {
      // Define primary entity schema
      const primarySchema = createEntitySchema({
        model: {
          entity: 'primary',
          service: 'primary-service',
          version: '1',
          entityNamePlural: 'primaries',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      // Define secondary entity schema
      const secondarySchema = createEntitySchema({
        model: {
          entity: 'secondary',
          service: 'secondary-service',
          version: '1',
          entityNamePlural: 'secondaries',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          requestType: { type: 'string' },
          timestamp: { type: 'string' },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      // Define provider entity schema
      const providerSchema = createEntitySchema({
        model: {
          entity: 'provider',
          service: 'provider-service',
          version: '1',
          entityNamePlural: 'providers',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      // Define service entity schema
      const serviceSchema = createEntitySchema({
        model: {
          entity: 'service',
          service: 'service-service',
          version: '1',
          entityNamePlural: 'services',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      // Register schemas with the container
      registerEntitySchema({ forEntity: primarySchema.model.entity, providedIn: diContainer, useValue: primarySchema });
      registerEntitySchema({ forEntity: secondarySchema.model.entity, providedIn: diContainer, useValue: secondarySchema });
      registerEntitySchema({ forEntity: providerSchema.model.entity, providedIn: diContainer, useValue: providerSchema });
      registerEntitySchema({ forEntity: serviceSchema.model.entity, providedIn: diContainer, useValue: serviceSchema });
    });

    it('should validate complex primary entity schema with relations', () => {
      const primarySchema = createEntitySchema({
        model: {
          entity: 'primary',
          service: 'primary-service',
          version: '1',
          entityNamePlural: 'primaries',
          entityOperations: DefaultEntityOperations,
        },
        attributes: {
          id: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          provider: {
            type: 'string',
            fieldType: 'select',
            options: {
              apiUrl: '/provider',
              apiMethod: 'GET',
              responseKey: 'items',
              optionMapping: {
                label: 'name',
                value: 'id',
              }
            },
            relation: {
              entityName: 'provider',
              type: 'many-to-one',
              identifiers: { source: 'provider', target: 'id' },
            },
          },
          service: {
            type: 'string',
            fieldType: 'select',
            options: {
              apiUrl: '/service',
              apiMethod: 'GET',
              responseKey: 'items',
              optionMapping: {
                label: 'name',
                value: 'id',
              }
            },
            relation: {
              entityName: 'service',
              type: 'many-to-one',
              identifiers: { source: 'service', target: 'id' },
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(primarySchema, {})).not.toThrow();
    });

    it('should validate complex secondary entity schema with relations', () => {
      const secondarySchema = createEntitySchema({
        model: {
          entity: 'secondary',
          service: 'secondary-service',
          version: '1',
          entityNamePlural: 'secondaries',
          entityOperations: DefaultEntityOperations,
          excludeFromAdminCreate: true,
          excludeFromAdminUpdate: true,
          excludeFromAdminDelete: true,
        },
        attributes: {
          id: { type: 'string' },
          status: {
            type: 'string',
            fieldType: 'select',
            options: [
              { value: 'NEW', label: 'NEW' },
              { value: 'IN_PROGRESS', label: 'IN_PROGRESS' },
              { value: 'COMPLETED', label: 'COMPLETED' },
            ],
          },
          primary: {
            type: 'string',
            relation: {
              entityName: 'primary',
              type: 'many-to-one',
              identifiers: { source: 'primary', target: 'id' },
            },
          },
          provider: {
            type: 'map',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
            relation: {
              entityName: 'provider',
              type: 'many-to-one',
              identifiers: { source: 'provider.id', target: 'id' },
            },
          },
        },
        indexes: {
          primary: {
            pk: {
              field: 'pk',
              composite: [ 'id' ],
            },
          },
        },
      });

      expect(() => validator.validateSchema(secondarySchema, {})).not.toThrow();
    });
  });
});