import { DIContainer } from '../../di';
import { BaseEntityService } from '../base-service';
import { createEntitySchema } from '../base-entity';
import { DefaultEntityOperations } from '../constants';

describe('State Machine UI Auto-Pilot', () => {
  const WorkflowSchema = createEntitySchema({
    model: {
      entity: 'workflow_test',
      entityNamePlural: 'workflow_tests',
      service: 'testService',
      version: '1',
      entityOperations: {
        ...DefaultEntityOperations,
        approve: { uiLocation: 'row', handler: 'approve' },
        reject: { uiLocation: 'row', handler: 'reject' },
        archive: { enabled: true }
      },
      workflow: {
        stateAttribute: 'status',
        allowOperations: {
          pending: ['approve', 'reject'],
          approved: ['archive']
        }
      }
    },
    attributes: {
      id: { type: 'string', required: true, isIdentifier: true },
      status: { type: 'string', default: 'pending' }
    },
    indexes: {
      primary: {
        pk: { field: 'pk', composite: ['id'] },
        sk: { field: 'sk', composite: [] }
      }
    }
  } as const);

  class WorkflowService extends BaseEntityService<typeof WorkflowSchema> {
    constructor() {
      super(WorkflowSchema, { table: 'test-table' }, DIContainer.ROOT);
    }
    async approve() {}
    async reject() {}
  }

  const service = new WorkflowService();

  it('should inject visibility conditions based on workflow allowOperations', () => {
    const ops = service.getOperationsConfig();

    // approve should only be visible in 'pending' state
    expect(ops.approve.visibility).toEqual({
      record: { status: { eq: 'pending' } }
    });

    // archive (OOB op) should only be visible in 'approved' state
    expect(ops.archive.visibility).toEqual({
      record: { status: { eq: 'approved' } }
    });
  });
});
