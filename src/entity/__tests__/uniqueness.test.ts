import { DIContainer } from '../../di';
import { BaseEntityService } from '../base-service';
import { createEntitySchema } from '../base-entity';
import { DefaultEntityOperations } from '../constants';
import { EntityValidationError } from '../errors';

describe('Attribute Uniqueness', () => {
  const TestSchema = createEntitySchema({
    model: {
      entity: 'uniqueness_test',
      entityNamePlural: 'uniqueness_tests',
      service: 'testService',
      version: '1',
      entityOperations: DefaultEntityOperations
    },
    attributes: {
      id: { type: 'string', required: true, isIdentifier: true },
      username: {
        type: 'string',
        isUnique: true,
        uniquenessStrategy: 'strict'
      },
      slug: {
        type: 'string',
        isUnique: true,
        uniquenessStrategy: 'enhance'
      }
    },
    indexes: {
      primary: {
        pk: { field: 'pk', composite: ['id'] },
        sk: { field: 'sk', composite: [] }
      }
    }
  } as const);

  class TestService extends BaseEntityService<typeof TestSchema> {
    constructor() {
      super(TestSchema, { table: 'test-table' }, DIContainer.ROOT);
    }

    // Mock isUniqueAttributeValue
    async isUniqueAttributeValue(name: string, value: any, ignored?: any): Promise<boolean> {
      if (name === 'username' && value === 'taken') return false;
      if (name === 'slug' && value === 'taken') return false;
      if (name === 'slug' && value === 'taken-1') return false; // even suffix taken
      return true;
    }
  }

  const service = new TestService();

  it('should throw error for strict uniqueness collision', async () => {
    const payload = { id: '1', username: 'taken' };
    await expect(service.checkUniquenessAndUpdate({
      payloadToUpdate: payload,
      attributeName: 'username',
      attributeValue: 'taken',
      maxAttemptsForCreatingUniqueAttributeValue: 5
    })).rejects.toThrow(EntityValidationError);
  });

  it('should enhance value for enhance uniqueness strategy', async () => {
    const payload = { id: '2', slug: 'taken' };
    await service.checkUniquenessAndUpdate({
      payloadToUpdate: payload,
      attributeName: 'slug',
      attributeValue: 'taken',
      maxAttemptsForCreatingUniqueAttributeValue: 5
    });
    expect(payload.slug).toMatch(/taken-\d+-\d/);
  });
});
