import { DIContainer } from '../../di';
import { BaseEntityService } from '../base-service';
import { createEntitySchema } from '../base-entity';
import { DefaultEntityOperations } from '../constants';
import { ExecutionContext } from '../../core/types/execution-context';

describe('Field Level Security (FLS)', () => {
  const TestSchema = createEntitySchema({
    model: {
      entity: 'test',
      entityNamePlural: 'tests',
      service: 'testService',
      version: '1',
      entityOperations: DefaultEntityOperations
    },
    attributes: {
      id: { type: 'string', required: true, isIdentifier: true },
      publicData: { type: 'string' },
      adminOnly: {
        type: 'string',
        permissions: {
          read: ['admin'],
          write: ['admin']
        }
      },
      ownerOnly: {
        type: 'string',
        permissions: {
          read: { record: { createdBy: { eq: { $ref: 'actor.actorId' } } } },
          write: { record: { createdBy: { eq: { $ref: 'actor.actorId' } } } }
        }
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

    // Mock get to return a record
    async get(options: any, _ctx?: any): Promise<any> {
      const record = {
        id: '123',
        publicData: 'public',
        adminOnly: 'secret',
        ownerOnly: 'private',
        createdBy: 'owner-1'
      };
      return await this.applyReadFLS(record, _ctx);
    }
  }

  const service = new TestService();

  it('should allow reading public fields for any user', async () => {
    const ctx: ExecutionContext = { actor: { actorId: 'user-1', groups: ['user'] } } as any;
    const record = await service.get({ id: '123' }, ctx);
    expect(record.publicData).toBe('public');
  });

  it('should hide admin fields for regular users', async () => {
    const ctx: ExecutionContext = { actor: { actorId: 'user-1', groups: ['user'] } } as any;
    const record = await service.get({ id: '123' }, ctx);
    expect(record.adminOnly).toBeUndefined();
  });

  it('should show admin fields for admin users', async () => {
    const ctx: ExecutionContext = { actor: { actorId: 'admin-1', groups: ['admin'] } } as any;
    const record = await service.get({ id: '123' }, ctx);
    expect(record.adminOnly).toBe('secret');
  });

  it('should hide owner fields for non-owners', async () => {
    const ctx: ExecutionContext = { actor: { actorId: 'user-2', groups: ['user'] } } as any;
    const record = await service.get({ id: '123' }, ctx);
    expect(record.ownerOnly).toBeUndefined();
  });

  it('should show owner fields for owners', async () => {
    const ctx: ExecutionContext = { actor: { actorId: 'owner-1', groups: ['user'] } } as any;
    const record = await service.get({ id: '123' }, ctx);
    expect(record.ownerOnly).toBe('private');
  });
});
