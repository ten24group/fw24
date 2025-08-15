"use strict";
// src/entity/validators/__tests__/entity-schema-validator.test.ts
Object.defineProperty(exports, "__esModule", { value: true });
const entity_schema_validator_1 = require("./entity-schema-validator");
const base_entity_1 = require("./base-entity");
const di_1 = require("../di");
const decorators_1 = require("../decorators");
describe('EntitySchemaValidator', () => {
    let validator;
    let diContainer;
    beforeEach(() => {
        diContainer = new di_1.DIContainer();
        validator = new entity_schema_validator_1.EntitySchemaValidator(diContainer);
    });
    describe('ElectroDB Schema Validation', () => {
        it('should validate valid ElectroDB schema', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).not.toThrow();
        });
        it('should throw on invalid ElectroDB schema', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow();
        });
        it('should validate index configuration', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['nonExistentField'], // Invalid field
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/ElectroDB schema validation failed/);
        });
        it('should validate attribute types', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'invalid-type' },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/ElectroDB schema validation failed/);
        });
    });
    describe('Model Definition Validation', () => {
        it('should validate model property types', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 123, // Should be string
                    entityMenuIcon: true, // Should be string
                },
                attributes: {
                    id: { type: 'string' },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['id'],
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
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                        [flag]: 'true', // Should be boolean
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
                                composite: ['id'],
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
            const relatedSchema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'related',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'relateds',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['id'],
                        },
                    },
                },
            });
            (0, decorators_1.registerEntitySchema)({
                forEntity: relatedSchema.model.entity,
                providedIn: diContainer,
                useValue: relatedSchema,
            });
        });
        it('should validate valid relation configuration', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).not.toThrow();
        });
        it('should validate relation type', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            type: 'invalid-type',
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/Invalid relation type/);
        });
        it('should validate relation entity exists', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/Related entity.*not found/);
        });
        it('should validate relation identifiers with function and array', () => {
            // Test with function
            const schemaWithFunction = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schemaWithFunction, {})).not.toThrow();
            // Test with array
            const schemaWithArray = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schemaWithArray, {})).not.toThrow();
        });
        it('should validate nested source paths in relation identifiers', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).not.toThrow();
        });
        it('should validate invalid nested source paths in relation identifiers', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
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
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                    },
                    attributes: {
                        id: { type: 'string' },
                        testField: {
                            type: 'string',
                            [flag]: 'true', // Should be boolean
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {})).toThrow(new RegExp(`${flag} must be a boolean`));
            }
        });
        describe('Select Fields', () => {
            it('should validate static options', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                    },
                    attributes: {
                        id: { type: 'string' },
                        status: {
                            type: 'string',
                            fieldType: 'select',
                            options: [
                                { value: 'active' },
                            ],
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {}))
                    .toThrow(/Static options must have value and label/);
            });
            it('should validate dynamic options configuration', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                    },
                    attributes: {
                        id: { type: 'string' },
                        status: {
                            type: 'string',
                            fieldType: 'select',
                            options: {
                                apiUrl: '/api/options',
                                // Missing responseKey
                            },
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {})).toThrow(/must specify apiUrl and responseKey/);
            });
            it('should validate option mapping', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
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
                                },
                            },
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {})).toThrow(/Option mapping must specify label and value/);
            });
            it('should validate addNewOption entity exists', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
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
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {})).toThrow(/Entity.*for addNewOption not found/);
            });
        });
        describe('File Fields', () => {
            it('should validate signed URL configuration', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                    },
                    attributes: {
                        id: { type: 'string' },
                        document: {
                            type: 'string',
                            fieldType: 'file',
                            getSignedUploadUrlAPIConfig: {
                                apiUrl: '/api/upload',
                                apiMethod: 'INVALID',
                            },
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {}))
                    .toThrow(/Invalid signed upload URL configuration/);
            });
            it('should validate maxFileSize is a number', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                    },
                    attributes: {
                        id: { type: 'string' },
                        document: {
                            type: 'string',
                            fieldType: 'file',
                            maxFileSize: '1024', // Should be number
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {})).toThrow(/maxFileSize must be a number/);
            });
        });
        describe('Image Fields', () => {
            it('should validate image specific configuration', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                    },
                    attributes: {
                        id: { type: 'string' },
                        photo: {
                            type: 'string',
                            fieldType: 'image',
                            withImageCrop: 'yes', // Should be boolean
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {}))
                    .toThrow(/withImageCrop must be a boolean/);
            });
            it('should inherit file field validation', () => {
                const schema = (0, base_entity_1.createEntitySchema)({
                    model: {
                        entity: 'test',
                        service: 'test-service',
                        version: '1',
                        entityNamePlural: 'tests',
                        entityOperations: base_entity_1.DefaultEntityOperations,
                    },
                    attributes: {
                        id: { type: 'string' },
                        photo: {
                            type: 'string',
                            fieldType: 'image',
                            maxFileSize: '1024', // Should be number
                        },
                    },
                    indexes: {
                        primary: {
                            pk: {
                                field: 'pk',
                                composite: ['id'],
                            },
                        },
                    },
                });
                expect(() => validator.validateSchema(schema, {})).toThrow(/maxFileSize must be a number/);
            });
        });
        it('should validate field type', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    testField: {
                        type: 'string',
                        fieldType: 'invalid-type',
                    },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/Invalid field type/);
        });
        it('should validate required field metadata properties', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    testField: {
                        type: 'string',
                        fieldType: 'select',
                        options: [], // Empty array to satisfy type but fail validation
                    },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow();
        });
        // Additional tests for number, date, datetime, and time validations
        it('should throw for number field when min is greater than max', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    numberField: { type: 'number', fieldType: 'number', min: 10, max: 5 },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum value \(10\) cannot be greater than maximum value \(5\)/);
        });
        it('should not throw for number field when min is less than or equal to max', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    numberField: { type: 'number', fieldType: 'number', min: 5, max: 10 },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).not.toThrow();
        });
        it('should throw for date field when minDate is later than maxDate', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    dateField: { type: 'string', fieldType: 'date', minDate: new Date('2023-01-02'), maxDate: new Date('2023-01-01') },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum date cannot be greater than maximum date/);
        });
        it('should not throw for date field when minDate is earlier than or equal to maxDate', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    dateField: { type: 'string', fieldType: 'date', minDate: new Date('2023-01-01'), maxDate: new Date('2023-01-02') },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).not.toThrow();
        });
        it('should throw for datetime field when minDateTime is later than maxDateTime', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    datetimeField: { type: 'string', fieldType: 'datetime', minDateTime: new Date('2023-02-02T10:00:00'), maxDateTime: new Date('2023-02-02T09:00:00') },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum date time cannot be greater than maximum date time/);
        });
        it('should not throw for datetime field when minDateTime is earlier than or equal to maxDateTime', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    datetimeField: { type: 'string', fieldType: 'datetime', minDateTime: new Date('2023-02-02T09:00:00'), maxDateTime: new Date('2023-02-02T10:00:00') },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).not.toThrow();
        });
        it('should throw for time field when minTime is greater than maxTime', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    timeField: { type: 'string', fieldType: 'time', minTime: '15:00', maxTime: '10:00' },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).toThrow(/Minimum time cannot be greater than maximum time/);
        });
        it('should not throw for time field when minTime is less than or equal to maxTime', () => {
            const schema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'test',
                    service: 'test-service',
                    version: '1',
                    entityNamePlural: 'tests',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    timeField: { type: 'string', fieldType: 'time', minTime: '09:00', maxTime: '10:00' },
                },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['id'] } },
                },
            });
            expect(() => validator.validateSchema(schema, {})).not.toThrow();
        });
    });
    describe('Real World Entity Examples', () => {
        beforeEach(() => {
            // Define primary entity schema
            const primarySchema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'primary',
                    service: 'primary-service',
                    version: '1',
                    entityNamePlural: 'primaries',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            // Define secondary entity schema
            const secondarySchema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'secondary',
                    service: 'secondary-service',
                    version: '1',
                    entityNamePlural: 'secondaries',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            // Define provider entity schema
            const providerSchema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'provider',
                    service: 'provider-service',
                    version: '1',
                    entityNamePlural: 'providers',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['id'],
                        },
                    },
                },
            });
            // Define service entity schema
            const serviceSchema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'service',
                    service: 'service-service',
                    version: '1',
                    entityNamePlural: 'services',
                    entityOperations: base_entity_1.DefaultEntityOperations,
                },
                attributes: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                },
                indexes: {
                    primary: {
                        pk: {
                            field: 'pk',
                            composite: ['id'],
                        },
                    },
                },
            });
            // Register schemas with the container
            (0, decorators_1.registerEntitySchema)({ forEntity: primarySchema.model.entity, providedIn: diContainer, useValue: primarySchema });
            (0, decorators_1.registerEntitySchema)({ forEntity: secondarySchema.model.entity, providedIn: diContainer, useValue: secondarySchema });
            (0, decorators_1.registerEntitySchema)({ forEntity: providerSchema.model.entity, providedIn: diContainer, useValue: providerSchema });
            (0, decorators_1.registerEntitySchema)({ forEntity: serviceSchema.model.entity, providedIn: diContainer, useValue: serviceSchema });
        });
        it('should validate complex primary entity schema with relations', () => {
            const primarySchema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'primary',
                    service: 'primary-service',
                    version: '1',
                    entityNamePlural: 'primaries',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(primarySchema, {})).not.toThrow();
        });
        it('should validate complex secondary entity schema with relations', () => {
            const secondarySchema = (0, base_entity_1.createEntitySchema)({
                model: {
                    entity: 'secondary',
                    service: 'secondary-service',
                    version: '1',
                    entityNamePlural: 'secondaries',
                    entityOperations: base_entity_1.DefaultEntityOperations,
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
                            composite: ['id'],
                        },
                    },
                },
            });
            expect(() => validator.validateSchema(secondarySchema, {})).not.toThrow();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNjaGVtYS12YWxpZGF0b3IudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvZW50aXR5LXNjaGVtYS12YWxpZGF0b3IudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUEsa0VBQWtFOztBQUVsRSx1RUFBa0U7QUFDbEUsK0NBQTRFO0FBQzVFLDhCQUFvQztBQUNwQyw4Q0FBcUQ7QUFFckQsUUFBUSxDQUFDLHVCQUF1QixFQUFFLEdBQUcsRUFBRTtJQUNyQyxJQUFJLFNBQWdDLENBQUM7SUFDckMsSUFBSSxXQUF3QixDQUFDO0lBRTdCLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxXQUFXLEdBQUcsSUFBSSxnQkFBVyxFQUFFLENBQUM7UUFDaEMsU0FBUyxHQUFHLElBQUksK0NBQXFCLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDckQsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsNkJBQTZCLEVBQUUsR0FBRyxFQUFFO1FBQzNDLEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRSxHQUFHLEVBQUU7WUFDaEQsTUFBTSxNQUFNLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztnQkFDaEMsS0FBSyxFQUFFO29CQUNMLE1BQU0sRUFBRSxNQUFNO29CQUNkLE9BQU8sRUFBRSxjQUFjO29CQUN2QixPQUFPLEVBQUUsR0FBRztvQkFDWixnQkFBZ0IsRUFBRSxPQUFPO29CQUN6QixnQkFBZ0IsRUFBRSxxQ0FBdUI7aUJBQzFDO2dCQUNELFVBQVUsRUFBRTtvQkFDVixFQUFFLEVBQUU7d0JBQ0YsSUFBSSxFQUFFLFFBQVE7d0JBQ2QsUUFBUSxFQUFFLElBQUk7cUJBQ2Y7aUJBQ0Y7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLE9BQU8sRUFBRTt3QkFDUCxFQUFFLEVBQUU7NEJBQ0YsS0FBSyxFQUFFLElBQUk7NEJBQ1gsU0FBUyxFQUFFLENBQUUsSUFBSSxDQUFFO3lCQUNwQjtxQkFDRjtpQkFDRjthQUNGLENB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QUFXLEVBQUUsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUU7eUJBQ2pEO3FCQUNGO29CQUNELFFBQVEsRUFBRTt3QkFDUixJQUFJLEVBQUUsS0FBSzt3QkFDWCxVQUFVLEVBQUU7NEJBQ1YsRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRTs0QkFDdEIsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRTt5QkFDekI7d0JBQ0QsUUFBUSxFQUFFOzRCQUNSLFVBQVUsRUFBRSxVQUFVOzRCQUN0QixJQUFJLEVBQUUsYUFBYTs0QkFDbkIsV0FBVyxFQUFFLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFO3lCQUNyRDtxQkFDRjtpQkFDRjtnQkFDRCxPQUFPLEVBQUU7b0JBQ1AsT0FBTyxFQUFFO3dCQUNQLEVBQUUsRUFBRTs0QkFDRixLQUFLLEVBQUUsSUFBSTs0QkFDWCxTQUFTLEVBQUUsQ0FBRSxJQUFJLENBQUU7eUJBQ3BCO3FCQUNGO2lCQUNGO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsTUFBTSxDQUFDLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsZUFBZSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzVFLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIHNyYy9lbnRpdHkvdmFsaWRhdG9ycy9fX3Rlc3RzX18vZW50aXR5LXNjaGVtYS12YWxpZGF0b3IudGVzdC50c1xuXG5pbXBvcnQgeyBFbnRpdHlTY2hlbWFWYWxpZGF0b3IgfSBmcm9tICcuL2VudGl0eS1zY2hlbWEtdmFsaWRhdG9yJztcbmltcG9ydCB7IGNyZWF0ZUVudGl0eVNjaGVtYSwgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgfSBmcm9tICcuL2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vZGknO1xuaW1wb3J0IHsgcmVnaXN0ZXJFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi9kZWNvcmF0b3JzJztcblxuZGVzY3JpYmUoJ0VudGl0eVNjaGVtYVZhbGlkYXRvcicsICgpID0+IHtcbiAgbGV0IHZhbGlkYXRvcjogRW50aXR5U2NoZW1hVmFsaWRhdG9yO1xuICBsZXQgZGlDb250YWluZXI6IERJQ29udGFpbmVyO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGRpQ29udGFpbmVyID0gbmV3IERJQ29udGFpbmVyKCk7XG4gICAgdmFsaWRhdG9yID0gbmV3IEVudGl0eVNjaGVtYVZhbGlkYXRvcihkaUNvbnRhaW5lcik7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFbGVjdHJvREIgU2NoZW1hIFZhbGlkYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSB2YWxpZCBFbGVjdHJvREIgc2NoZW1hJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICBzZXJ2aWNlOiAndGVzdC1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS5ub3QudG9UaHJvdygpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB0aHJvdyBvbiBpbnZhbGlkIEVsZWN0cm9EQiBzY2hlbWEnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7XG4gICAgICAgICAgICB0eXBlOiAnaW52YWxpZC10eXBlJywgLy8gSW52YWxpZCB0eXBlXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnaWQnIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9IGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgaW5kZXggY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnbm9uRXhpc3RlbnRGaWVsZCcgXSwgLy8gSW52YWxpZCBmaWVsZFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coL0VsZWN0cm9EQiBzY2hlbWEgdmFsaWRhdGlvbiBmYWlsZWQvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXR0cmlidXRlIHR5cGVzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICBzZXJ2aWNlOiAndGVzdC1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7IHR5cGU6ICdpbnZhbGlkLXR5cGUnIGFzIGFueSB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnaWQnIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KCgpID0+IHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShzY2hlbWEsIHt9KSkudG9UaHJvdygvRWxlY3Ryb0RCIHNjaGVtYSB2YWxpZGF0aW9uIGZhaWxlZC8pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnTW9kZWwgRGVmaW5pdGlvbiBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgbW9kZWwgcHJvcGVydHkgdHlwZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAxMjMsIC8vIFNob3VsZCBiZSBzdHJpbmdcbiAgICAgICAgICBlbnRpdHlNZW51SWNvbjogdHJ1ZSwgLy8gU2hvdWxkIGJlIHN0cmluZ1xuICAgICAgICB9IGFzIGFueSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KC9lbnRpdHlOYW1lUGx1cmFsIG11c3QgYmUgYSBzdHJpbmcvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYWRtaW4gVUkgYm9vbGVhbiBmbGFncycsICgpID0+IHtcbiAgICAgIGNvbnN0IGJvb2xlYW5GbGFncyA9IFtcbiAgICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5NZW51JyxcbiAgICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5MaXN0JyxcbiAgICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwnLFxuICAgICAgICAnZXhjbHVkZUZyb21BZG1pbkNyZWF0ZScsXG4gICAgICAgICdleGNsdWRlRnJvbUFkbWluVXBkYXRlJyxcbiAgICAgICAgJ2V4Y2x1ZGVGcm9tQWRtaW5EZWxldGUnLFxuICAgICAgICAnZXhjbHVkZUZyb21BZG1pbkR1cGxpY2F0ZSdcbiAgICAgIF07XG5cbiAgICAgIGZvciAoY29uc3QgZmxhZyBvZiBib29sZWFuRmxhZ3MpIHtcbiAgICAgICAgY29uc3Qgc2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgICBtb2RlbDoge1xuICAgICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgICBzZXJ2aWNlOiAndGVzdC1zZXJ2aWNlJyxcbiAgICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgICAgIFsgZmxhZyBdOiAndHJ1ZScsIC8vIFNob3VsZCBiZSBib29sZWFuXG4gICAgICAgICAgfSBhcyBhbnksXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgaWQ6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KG5ldyBSZWdFeHAoYCR7ZmxhZ30gbXVzdCBiZSBhIGJvb2xlYW5gKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZWxhdGlvbnMgVmFsaWRhdGlvbicsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIC8vIFJlZ2lzdGVyIGEgcmVsYXRlZCBlbnRpdHkgc2NoZW1hIGluIERJIGNvbnRhaW5lclxuICAgICAgY29uc3QgcmVsYXRlZFNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAncmVsYXRlZCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdyZWxhdGVkcycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIG5hbWU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIHJlZ2lzdGVyRW50aXR5U2NoZW1hKHtcbiAgICAgICAgZm9yRW50aXR5OiByZWxhdGVkU2NoZW1hLm1vZGVsLmVudGl0eSxcbiAgICAgICAgcHJvdmlkZWRJbjogZGlDb250YWluZXIsXG4gICAgICAgIHVzZVZhbHVlOiByZWxhdGVkU2NoZW1hLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHZhbGlkIHJlbGF0aW9uIGNvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICByZWxhdGVkSWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICByZWxhdGVkOiB7XG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlbGF0aW9uOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdyZWxhdGVkJyxcbiAgICAgICAgICAgICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgICAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICdyZWxhdGVkSWQnLFxuICAgICAgICAgICAgICAgIHRhcmdldDogJ2lkJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLm5vdC50b1Rocm93KCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJlbGF0aW9uIHR5cGUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICByZWxhdGVkOiB7XG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlbGF0aW9uOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdyZWxhdGVkJyxcbiAgICAgICAgICAgICAgdHlwZTogJ2ludmFsaWQtdHlwZScgYXMgYW55LFxuICAgICAgICAgICAgICBpZGVudGlmaWVyczoge1xuICAgICAgICAgICAgICAgIHNvdXJjZTogJ2lkJyxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6ICdpZCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KC9JbnZhbGlkIHJlbGF0aW9uIHR5cGUvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgcmVsYXRpb24gZW50aXR5IGV4aXN0cycsICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIHJlbGF0ZWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ25vbi1leGlzdGVudCcsXG4gICAgICAgICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgICAgICAgIGlkZW50aWZpZXJzOiB7XG4gICAgICAgICAgICAgICAgc291cmNlOiAnaWQnLFxuICAgICAgICAgICAgICAgIHRhcmdldDogJ2lkJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coL1JlbGF0ZWQgZW50aXR5Lipub3QgZm91bmQvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgcmVsYXRpb24gaWRlbnRpZmllcnMgd2l0aCBmdW5jdGlvbiBhbmQgYXJyYXknLCAoKSA9PiB7XG4gICAgICAvLyBUZXN0IHdpdGggZnVuY3Rpb25cbiAgICAgIGNvbnN0IHNjaGVtYVdpdGhGdW5jdGlvbiA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIHJlbGF0ZWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ3JlbGF0ZWQnLFxuICAgICAgICAgICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICAgICAgICBpZGVudGlmaWVyczogKCkgPT4gKHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICdpZCcsXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiAnaWQnLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hV2l0aEZ1bmN0aW9uLCB7fSkpLm5vdC50b1Rocm93KCk7XG5cbiAgICAgIC8vIFRlc3Qgd2l0aCBhcnJheVxuICAgICAgY29uc3Qgc2NoZW1hV2l0aEFycmF5ID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICBzZXJ2aWNlOiAndGVzdC1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgcmVsYXRlZElkMTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIHJlbGF0ZWRJZDI6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICByZWxhdGVkOiB7XG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlbGF0aW9uOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdyZWxhdGVkJyxcbiAgICAgICAgICAgICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgICAgICAgICAgaWRlbnRpZmllcnM6IFtcbiAgICAgICAgICAgICAgICB7IHNvdXJjZTogJ3JlbGF0ZWRJZDEnLCB0YXJnZXQ6ICdpZCcgfSxcbiAgICAgICAgICAgICAgICB7IHNvdXJjZTogJ3JlbGF0ZWRJZDInLCB0YXJnZXQ6ICdpZCcgfSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hV2l0aEFycmF5LCB7fSkpLm5vdC50b1Rocm93KCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG5lc3RlZCBzb3VyY2UgcGF0aHMgaW4gcmVsYXRpb24gaWRlbnRpZmllcnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBuZXN0ZWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICByZWxhdGVkSWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICByZWxhdGVkOiB7XG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlbGF0aW9uOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdyZWxhdGVkJyxcbiAgICAgICAgICAgICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgICAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICduZXN0ZWQucmVsYXRlZElkJyxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6ICdpZCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS5ub3QudG9UaHJvdygpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBpbnZhbGlkIG5lc3RlZCBzb3VyY2UgcGF0aHMgaW4gcmVsYXRpb24gaWRlbnRpZmllcnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBuZXN0ZWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICByZWxhdGVkSWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICByZWxhdGVkOiB7XG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlbGF0aW9uOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdyZWxhdGVkJyxcbiAgICAgICAgICAgICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgICAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICduZXN0ZWQuaW52YWxpZFBhdGgnLFxuICAgICAgICAgICAgICAgIHRhcmdldDogJ2lkJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coL1NvdXJjZSBwYXRoLippbnZhbGlkIGF0Lyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdGaWVsZCBNZXRhZGF0YSBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYm9vbGVhbiBmbGFncyBmb3IgZmllbGQgbWV0YWRhdGEnLCAoKSA9PiB7XG4gICAgICBjb25zdCBib29sZWFuRmxhZ3MgPSBbXG4gICAgICAgICdpc1Zpc2libGUnLFxuICAgICAgICAnaXNMaXN0YWJsZScsXG4gICAgICAgICdpc0NyZWF0YWJsZScsXG4gICAgICAgICdpc0VkaXRhYmxlJyxcbiAgICAgICAgJ2lzRmlsdGVyYWJsZScsXG4gICAgICAgICdpc1NlYXJjaGFibGUnXG4gICAgICBdO1xuXG4gICAgICBmb3IgKGNvbnN0IGZsYWcgb2YgYm9vbGVhbkZsYWdzKSB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgdGVzdEZpZWxkOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICBbIGZsYWcgXTogJ3RydWUnLCAvLyBTaG91bGQgYmUgYm9vbGVhblxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KG5ldyBSZWdFeHAoYCR7ZmxhZ30gbXVzdCBiZSBhIGJvb2xlYW5gKSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnU2VsZWN0IEZpZWxkcycsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc3RhdGljIG9wdGlvbnMnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgICBvcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogJ2FjdGl2ZScgfSBhcyBhbnksIC8vIE1pc3NpbmcgbGFiZWxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZXhwZWN0KCgpID0+IHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShzY2hlbWEsIHt9KSlcbiAgICAgICAgICAudG9UaHJvdygvU3RhdGljIG9wdGlvbnMgbXVzdCBoYXZlIHZhbHVlIGFuZCBsYWJlbC8pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgZHluYW1pYyBvcHRpb25zIGNvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgYXBpVXJsOiAnL2FwaS9vcHRpb25zJyxcbiAgICAgICAgICAgICAgICAvLyBNaXNzaW5nIHJlc3BvbnNlS2V5XG4gICAgICAgICAgICAgIH0gYXMgYW55LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KC9tdXN0IHNwZWNpZnkgYXBpVXJsIGFuZCByZXNwb25zZUtleS8pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgb3B0aW9uIG1hcHBpbmcnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgYXBpVXJsOiAnL2FwaS9vcHRpb25zJyxcbiAgICAgICAgICAgICAgICByZXNwb25zZUtleTogJ2l0ZW1zJyxcbiAgICAgICAgICAgICAgICBhcGlNZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgICAgIG9wdGlvbk1hcHBpbmc6IHtcbiAgICAgICAgICAgICAgICAgIGxhYmVsOiAnbmFtZScsXG4gICAgICAgICAgICAgICAgICAvLyBNaXNzaW5nIHZhbHVlXG4gICAgICAgICAgICAgICAgfSBhcyBhbnksXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnaWQnIF0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coL09wdGlvbiBtYXBwaW5nIG11c3Qgc3BlY2lmeSBsYWJlbCBhbmQgdmFsdWUvKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGFkZE5ld09wdGlvbiBlbnRpdHkgZXhpc3RzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICAgIHN0YXR1czoge1xuICAgICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiAnc2VsZWN0JyxcbiAgICAgICAgICAgICAgb3B0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgdmFsdWU6ICdhY3RpdmUnLCBsYWJlbDogJ0FjdGl2ZScgfSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgYWRkTmV3T3B0aW9uOiB7XG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ25vbi1leGlzdGVudCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnaWQnIF0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coL0VudGl0eS4qZm9yIGFkZE5ld09wdGlvbiBub3QgZm91bmQvKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0ZpbGUgRmllbGRzJywgKCkgPT4ge1xuICAgICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzaWduZWQgVVJMIGNvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgZG9jdW1lbnQ6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2ZpbGUnLFxuICAgICAgICAgICAgICBnZXRTaWduZWRVcGxvYWRVcmxBUElDb25maWc6IHtcbiAgICAgICAgICAgICAgICBhcGlVcmw6ICcvYXBpL3VwbG9hZCcsXG4gICAgICAgICAgICAgICAgYXBpTWV0aG9kOiAnSU5WQUxJRCcgYXMgYW55LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKVxuICAgICAgICAgIC50b1Rocm93KC9JbnZhbGlkIHNpZ25lZCB1cGxvYWQgVVJMIGNvbmZpZ3VyYXRpb24vKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG1heEZpbGVTaXplIGlzIGEgbnVtYmVyJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICAgIGRvY3VtZW50OiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdmaWxlJyxcbiAgICAgICAgICAgICAgbWF4RmlsZVNpemU6ICcxMDI0JyBhcyBhbnksIC8vIFNob3VsZCBiZSBudW1iZXJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZXhwZWN0KCgpID0+IHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShzY2hlbWEsIHt9KSkudG9UaHJvdygvbWF4RmlsZVNpemUgbXVzdCBiZSBhIG51bWJlci8pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnSW1hZ2UgRmllbGRzJywgKCkgPT4ge1xuICAgICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBpbWFnZSBzcGVjaWZpYyBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICAgIHBob3RvOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdpbWFnZScsXG4gICAgICAgICAgICAgIHdpdGhJbWFnZUNyb3A6ICd5ZXMnIGFzIGFueSwgLy8gU2hvdWxkIGJlIGJvb2xlYW5cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZXhwZWN0KCgpID0+IHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShzY2hlbWEsIHt9KSlcbiAgICAgICAgICAudG9UaHJvdygvd2l0aEltYWdlQ3JvcCBtdXN0IGJlIGEgYm9vbGVhbi8pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaW5oZXJpdCBmaWxlIGZpZWxkIHZhbGlkYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgICAgcGhvdG86IHtcbiAgICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2ltYWdlJyxcbiAgICAgICAgICAgICAgbWF4RmlsZVNpemU6ICcxMDI0JyBhcyBhbnksIC8vIFNob3VsZCBiZSBudW1iZXJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZXhwZWN0KCgpID0+IHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShzY2hlbWEsIHt9KSkudG9UaHJvdygvbWF4RmlsZVNpemUgbXVzdCBiZSBhIG51bWJlci8pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGZpZWxkIHR5cGUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICB0ZXN0RmllbGQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgZmllbGRUeXBlOiAnaW52YWxpZC10eXBlJyBhcyBhbnksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coL0ludmFsaWQgZmllbGQgdHlwZS8pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSByZXF1aXJlZCBmaWVsZCBtZXRhZGF0YSBwcm9wZXJ0aWVzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICBzZXJ2aWNlOiAndGVzdC1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgdGVzdEZpZWxkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIGZpZWxkVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICBvcHRpb25zOiBbXSBhcyBhbnksIC8vIEVtcHR5IGFycmF5IHRvIHNhdGlzZnkgdHlwZSBidXQgZmFpbCB2YWxpZGF0aW9uXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIC8vIEFkZGl0aW9uYWwgdGVzdHMgZm9yIG51bWJlciwgZGF0ZSwgZGF0ZXRpbWUsIGFuZCB0aW1lIHZhbGlkYXRpb25zXG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGZvciBudW1iZXIgZmllbGQgd2hlbiBtaW4gaXMgZ3JlYXRlciB0aGFuIG1heCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIG51bWJlckZpZWxkOiB7IHR5cGU6ICdudW1iZXInLCBmaWVsZFR5cGU6ICdudW1iZXInLCBtaW46IDEwLCBtYXg6IDUgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnaWQnIF0gfSB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KC9NaW5pbXVtIHZhbHVlIFxcKDEwXFwpIGNhbm5vdCBiZSBncmVhdGVyIHRoYW4gbWF4aW11bSB2YWx1ZSBcXCg1XFwpLyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG5vdCB0aHJvdyBmb3IgbnVtYmVyIGZpZWxkIHdoZW4gbWluIGlzIGxlc3MgdGhhbiBvciBlcXVhbCB0byBtYXgnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBudW1iZXJGaWVsZDogeyB0eXBlOiAnbnVtYmVyJywgZmllbGRUeXBlOiAnbnVtYmVyJywgbWluOiA1LCBtYXg6IDEwIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7IHBrOiB7IGZpZWxkOiAncGsnLCBjb21wb3NpdGU6IFsgJ2lkJyBdIH0gfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KCgpID0+IHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShzY2hlbWEsIHt9KSkubm90LnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZm9yIGRhdGUgZmllbGQgd2hlbiBtaW5EYXRlIGlzIGxhdGVyIHRoYW4gbWF4RGF0ZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIGRhdGVGaWVsZDogeyB0eXBlOiAnc3RyaW5nJywgZmllbGRUeXBlOiAnZGF0ZScsIG1pbkRhdGU6IG5ldyBEYXRlKCcyMDIzLTAxLTAyJyksIG1heERhdGU6IG5ldyBEYXRlKCcyMDIzLTAxLTAxJykgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnaWQnIF0gfSB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KC9NaW5pbXVtIGRhdGUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIGRhdGUvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbm90IHRocm93IGZvciBkYXRlIGZpZWxkIHdoZW4gbWluRGF0ZSBpcyBlYXJsaWVyIHRoYW4gb3IgZXF1YWwgdG8gbWF4RGF0ZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIGRhdGVGaWVsZDogeyB0eXBlOiAnc3RyaW5nJywgZmllbGRUeXBlOiAnZGF0ZScsIG1pbkRhdGU6IG5ldyBEYXRlKCcyMDIzLTAxLTAxJyksIG1heERhdGU6IG5ldyBEYXRlKCcyMDIzLTAxLTAyJykgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnaWQnIF0gfSB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS5ub3QudG9UaHJvdygpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB0aHJvdyBmb3IgZGF0ZXRpbWUgZmllbGQgd2hlbiBtaW5EYXRlVGltZSBpcyBsYXRlciB0aGFuIG1heERhdGVUaW1lJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICAgICAgICBzZXJ2aWNlOiAndGVzdC1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RzJyxcbiAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgZGF0ZXRpbWVGaWVsZDogeyB0eXBlOiAnc3RyaW5nJywgZmllbGRUeXBlOiAnZGF0ZXRpbWUnLCBtaW5EYXRlVGltZTogbmV3IERhdGUoJzIwMjMtMDItMDJUMTA6MDA6MDAnKSwgbWF4RGF0ZVRpbWU6IG5ldyBEYXRlKCcyMDIzLTAyLTAyVDA5OjAwOjAwJykgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnaWQnIF0gfSB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KC9NaW5pbXVtIGRhdGUgdGltZSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIG1heGltdW0gZGF0ZSB0aW1lLyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG5vdCB0aHJvdyBmb3IgZGF0ZXRpbWUgZmllbGQgd2hlbiBtaW5EYXRlVGltZSBpcyBlYXJsaWVyIHRoYW4gb3IgZXF1YWwgdG8gbWF4RGF0ZVRpbWUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgICAgICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBkYXRldGltZUZpZWxkOiB7IHR5cGU6ICdzdHJpbmcnLCBmaWVsZFR5cGU6ICdkYXRldGltZScsIG1pbkRhdGVUaW1lOiBuZXcgRGF0ZSgnMjAyMy0wMi0wMlQwOTowMDowMCcpLCBtYXhEYXRlVGltZTogbmV3IERhdGUoJzIwMjMtMDItMDJUMTA6MDA6MDAnKSB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeTogeyBwazogeyBmaWVsZDogJ3BrJywgY29tcG9zaXRlOiBbICdpZCcgXSB9IH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdCgoKSA9PiB2YWxpZGF0b3IudmFsaWRhdGVTY2hlbWEoc2NoZW1hLCB7fSkpLm5vdC50b1Rocm93KCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGZvciB0aW1lIGZpZWxkIHdoZW4gbWluVGltZSBpcyBncmVhdGVyIHRoYW4gbWF4VGltZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIHRpbWVGaWVsZDogeyB0eXBlOiAnc3RyaW5nJywgZmllbGRUeXBlOiAndGltZScsIG1pblRpbWU6ICcxNTowMCcsIG1heFRpbWU6ICcxMDowMCcgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnaWQnIF0gfSB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS50b1Rocm93KC9NaW5pbXVtIHRpbWUgY2Fubm90IGJlIGdyZWF0ZXIgdGhhbiBtYXhpbXVtIHRpbWUvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbm90IHRocm93IGZvciB0aW1lIGZpZWxkIHdoZW4gbWluVGltZSBpcyBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gbWF4VGltZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAndGVzdCcsXG4gICAgICAgICAgc2VydmljZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0cycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIHRpbWVGaWVsZDogeyB0eXBlOiAnc3RyaW5nJywgZmllbGRUeXBlOiAndGltZScsIG1pblRpbWU6ICcwOTowMCcsIG1heFRpbWU6ICcxMDowMCcgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnaWQnIF0gfSB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHNjaGVtYSwge30pKS5ub3QudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUmVhbCBXb3JsZCBFbnRpdHkgRXhhbXBsZXMnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAvLyBEZWZpbmUgcHJpbWFyeSBlbnRpdHkgc2NoZW1hXG4gICAgICBjb25zdCBwcmltYXJ5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICBlbnRpdHk6ICdwcmltYXJ5JyxcbiAgICAgICAgICBzZXJ2aWNlOiAncHJpbWFyeS1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3ByaW1hcmllcycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIG5hbWU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBlbWFpbDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnaWQnIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gRGVmaW5lIHNlY29uZGFyeSBlbnRpdHkgc2NoZW1hXG4gICAgICBjb25zdCBzZWNvbmRhcnlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3NlY29uZGFyeScsXG4gICAgICAgICAgc2VydmljZTogJ3NlY29uZGFyeS1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3NlY29uZGFyaWVzJyxcbiAgICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIGlkOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICB0aW1lc3RhbXA6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIERlZmluZSBwcm92aWRlciBlbnRpdHkgc2NoZW1hXG4gICAgICBjb25zdCBwcm92aWRlclNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAncHJvdmlkZXInLFxuICAgICAgICAgIHNlcnZpY2U6ICdwcm92aWRlci1zZXJ2aWNlJyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Byb3ZpZGVycycsXG4gICAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBpZDogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIG5hbWU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIERlZmluZSBzZXJ2aWNlIGVudGl0eSBzY2hlbWFcbiAgICAgIGNvbnN0IHNlcnZpY2VTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgICAgICBtb2RlbDoge1xuICAgICAgICAgIGVudGl0eTogJ3NlcnZpY2UnLFxuICAgICAgICAgIHNlcnZpY2U6ICdzZXJ2aWNlLXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnc2VydmljZXMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZWdpc3RlciBzY2hlbWFzIHdpdGggdGhlIGNvbnRhaW5lclxuICAgICAgcmVnaXN0ZXJFbnRpdHlTY2hlbWEoeyBmb3JFbnRpdHk6IHByaW1hcnlTY2hlbWEubW9kZWwuZW50aXR5LCBwcm92aWRlZEluOiBkaUNvbnRhaW5lciwgdXNlVmFsdWU6IHByaW1hcnlTY2hlbWEgfSk7XG4gICAgICByZWdpc3RlckVudGl0eVNjaGVtYSh7IGZvckVudGl0eTogc2Vjb25kYXJ5U2NoZW1hLm1vZGVsLmVudGl0eSwgcHJvdmlkZWRJbjogZGlDb250YWluZXIsIHVzZVZhbHVlOiBzZWNvbmRhcnlTY2hlbWEgfSk7XG4gICAgICByZWdpc3RlckVudGl0eVNjaGVtYSh7IGZvckVudGl0eTogcHJvdmlkZXJTY2hlbWEubW9kZWwuZW50aXR5LCBwcm92aWRlZEluOiBkaUNvbnRhaW5lciwgdXNlVmFsdWU6IHByb3ZpZGVyU2NoZW1hIH0pO1xuICAgICAgcmVnaXN0ZXJFbnRpdHlTY2hlbWEoeyBmb3JFbnRpdHk6IHNlcnZpY2VTY2hlbWEubW9kZWwuZW50aXR5LCBwcm92aWRlZEluOiBkaUNvbnRhaW5lciwgdXNlVmFsdWU6IHNlcnZpY2VTY2hlbWEgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGNvbXBsZXggcHJpbWFyeSBlbnRpdHkgc2NoZW1hIHdpdGggcmVsYXRpb25zJywgKCkgPT4ge1xuICAgICAgY29uc3QgcHJpbWFyeVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAncHJpbWFyeScsXG4gICAgICAgICAgc2VydmljZTogJ3ByaW1hcnktc2VydmljZScsXG4gICAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdwcmltYXJpZXMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBmaXJzdE5hbWU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBsYXN0TmFtZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICAgIGVtYWlsOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgcHJvdmlkZXI6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgZmllbGRUeXBlOiAnc2VsZWN0JyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgYXBpVXJsOiAnL3Byb3ZpZGVyJyxcbiAgICAgICAgICAgICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgICAgcmVzcG9uc2VLZXk6ICdpdGVtcycsXG4gICAgICAgICAgICAgIG9wdGlvbk1hcHBpbmc6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ25hbWUnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiAnaWQnLFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ3Byb3ZpZGVyJyxcbiAgICAgICAgICAgICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgICAgICAgICAgaWRlbnRpZmllcnM6IHsgc291cmNlOiAncHJvdmlkZXInLCB0YXJnZXQ6ICdpZCcgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZXJ2aWNlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIGZpZWxkVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGFwaVVybDogJy9zZXJ2aWNlJyxcbiAgICAgICAgICAgICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgICAgcmVzcG9uc2VLZXk6ICdpdGVtcycsXG4gICAgICAgICAgICAgIG9wdGlvbk1hcHBpbmc6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ25hbWUnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiAnaWQnLFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICAgICAgICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICdzZXJ2aWNlJywgdGFyZ2V0OiAnaWQnIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoKCkgPT4gdmFsaWRhdG9yLnZhbGlkYXRlU2NoZW1hKHByaW1hcnlTY2hlbWEsIHt9KSkubm90LnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgY29tcGxleCBzZWNvbmRhcnkgZW50aXR5IHNjaGVtYSB3aXRoIHJlbGF0aW9ucycsICgpID0+IHtcbiAgICAgIGNvbnN0IHNlY29uZGFyeVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAnc2Vjb25kYXJ5JyxcbiAgICAgICAgICBzZXJ2aWNlOiAnc2Vjb25kYXJ5LXNlcnZpY2UnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnc2Vjb25kYXJpZXMnLFxuICAgICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IHRydWUsXG4gICAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogdHJ1ZSxcbiAgICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICBzdGF0dXM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgZmllbGRUeXBlOiAnc2VsZWN0JyxcbiAgICAgICAgICAgIG9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgeyB2YWx1ZTogJ05FVycsIGxhYmVsOiAnTkVXJyB9LFxuICAgICAgICAgICAgICB7IHZhbHVlOiAnSU5fUFJPR1JFU1MnLCBsYWJlbDogJ0lOX1BST0dSRVNTJyB9LFxuICAgICAgICAgICAgICB7IHZhbHVlOiAnQ09NUExFVEVEJywgbGFiZWw6ICdDT01QTEVURUQnIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZWxhdGlvbjoge1xuICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAncHJpbWFyeScsXG4gICAgICAgICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgICAgICAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3ByaW1hcnknLCB0YXJnZXQ6ICdpZCcgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwcm92aWRlcjoge1xuICAgICAgICAgICAgdHlwZTogJ21hcCcsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIGlkOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgICAgICAgIG5hbWU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZWxhdGlvbjoge1xuICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAncHJvdmlkZXInLFxuICAgICAgICAgICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICAgICAgICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICdwcm92aWRlci5pZCcsIHRhcmdldDogJ2lkJyB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnaWQnIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KCgpID0+IHZhbGlkYXRvci52YWxpZGF0ZVNjaGVtYShzZWNvbmRhcnlTY2hlbWEsIHt9KSkubm90LnRvVGhyb3coKTtcbiAgICB9KTtcbiAgfSk7XG59KTsiXX0=