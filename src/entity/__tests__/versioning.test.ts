import { DIContainer } from '../../di';
import { BaseEntityService } from '../base-service';
import { createEntitySchema } from '../base-entity';
import { DefaultEntityOperations } from '../constants';

describe('Schema Versioning & Evolution', () => {
  const VersionedSchema = createEntitySchema({
    model: {
      entity: 'version_test',
      entityNamePlural: 'version_tests',
      service: 'testService',
      version: '2',
      entityOperations: DefaultEntityOperations,
      versioning: {
        version: '2',
        transformers: {
          '1': (data: any) => ({ ...data, name: `${data.firstName} ${data.lastName}` })
        }
      }
    },
    attributes: {
      id: { type: 'string', required: true, isIdentifier: true },
      name: { type: 'string' },
      firstName: { type: 'string' }, // old field
      lastName: { type: 'string' },  // old field
      __v: { type: 'string' }
    },
    indexes: {
      primary: {
        pk: { field: 'pk', composite: ['id'] },
        sk: { field: 'sk', composite: [] }
      }
    }
  } as const);

  class VersionService extends BaseEntityService<typeof VersionedSchema> {
    constructor() {
      super(VersionedSchema, { table: 'test-table' }, DIContainer.ROOT);
    }

    // Expose protected method
    public testApplyVersioning(data: any) { return this.applyVersioning(data); }
  }

  const service = new VersionService();

  it('should transform old records to new schema version', () => {
    const oldRecord = {
      id: '123',
      firstName: 'John',
      lastName: 'Doe',
      __v: '1'
    };

    const newRecord = service.testApplyVersioning(oldRecord);
    expect(newRecord.name).toBe('John Doe');
    expect(newRecord.__v).toBe('2');
  });

  it('should handle records without version as version 1', () => {
    const legacyRecord = {
      id: '456',
      firstName: 'Jane',
      lastName: 'Smith'
    };

    const newRecord = service.testApplyVersioning(legacyRecord);
    expect(newRecord.name).toBe('Jane Smith');
    expect(newRecord.__v).toBe('2');
  });

  it('should not transform current version records', () => {
    const currentRecord = {
      id: '789',
      name: 'Already New',
      __v: '2'
    };

    const res = service.testApplyVersioning(currentRecord);
    expect(res).toEqual(currentRecord);
  });
});
