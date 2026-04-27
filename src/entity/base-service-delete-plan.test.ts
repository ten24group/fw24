import { BaseEntityService } from './base-service';
import type { BulkDeleteExecutionResult, DeleteImpactResult, EntitySchema } from './base-entity';

const sourceSchema = {
  model: { entity: 'post' },
  attributes: {
    postId: { type: 'string', isIdentifier: true },
    postComments: {
      type: 'list',
      items: { type: 'string' },
      relation: {
        entityName: 'postComment',
        type: 'one-to-many',
        identifiers: { source: 'postId', target: 'postId' },
        delete: { policy: 'cascade', label: 'Comments', overridable: true },
      },
    },
    pollId: {
      type: 'string',
      relation: {
        entityName: 'poll',
        type: 'many-to-one',
        identifiers: { source: 'pollId', target: 'pollId' },
        delete: { policy: 'orphan', label: 'Poll', overridable: true },
      },
    },
  },
} as unknown as EntitySchema<any, any, any>;

class RelatedService extends BaseEntityService<any> {
  readonly deleted: Array<Record<string, unknown>> = [];
  readonly updated: Array<{ identifiers: Record<string, unknown>; data: Record<string, unknown> }> = [];

  constructor(
    private readonly entityName: string,
    private readonly rows: Array<Record<string, unknown>>
  ) {
    super({ model: { entity: entityName }, attributes: { id: { type: 'string', isIdentifier: true } } } as any, {});
  }

  override getEntityName() {
    return this.entityName;
  }

  override extractEntityIdentifiers(input: Record<string, string> | Array<Record<string, string>>): Record<string, unknown> | Array<Record<string, unknown>> {
    if (Array.isArray(input)) return input.map(item => this.extractEntityIdentifiers(item as Record<string, string>) as Record<string, unknown>);
    if (this.entityName === 'postComment') return { postCommentId: input.postCommentId };
    if (this.entityName === 'poll') return { pollId: input.pollId };
    return { id: input.id };
  }

  override async query(query: any) {
    const postId = query.filters?.postId?.eq;
    return { data: this.rows.filter(row => row.postId === postId), cursor: null, query };
  }

  override async get(options: any) {
    return this.rows.find(row => Object.entries(options.identifiers).every(([ key, value ]) => row[ key ] === value));
  }

  override async batchDelete(options: any) {
    this.deleted.push(...options.identifiers);
    return { data: options.identifiers, unprocessed: [] };
  }

  override async update(identifiers: any, data: any) {
    this.updated.push({ identifiers, data });
    return { data: { ...identifiers, ...data } };
  }
}

class SourceService extends BaseEntityService<typeof sourceSchema> {
  constructor(
    private readonly rows: Array<Record<string, unknown>>,
    private readonly related: Record<string, RelatedService>
  ) {
    super(sourceSchema, {});
  }

  readonly deleted: Array<Record<string, unknown>> = [];

  override getEntityName() {
    return 'post';
  }

  override extractEntityIdentifiers(input: Record<string, string> | Array<Record<string, string>>): Record<string, unknown> | Array<Record<string, unknown>> {
    if (Array.isArray(input)) return input.map(item => this.extractEntityIdentifiers(item as Record<string, string>) as Record<string, unknown>);
    return { postId: input.postId };
  }

  override async get(options: any) {
    if (Array.isArray(options.identifiers)) {
      return options.identifiers
        .map((id: Record<string, unknown>) => this.rows.find(row => row.postId === id.postId))
        .filter(Boolean);
    }
    return this.rows.find(row => row.postId === options.identifiers.postId);
  }

  override async query(query: any) {
    const status = query.filters?.status?.eq;
    return { data: status ? this.rows.filter(row => row.status === status) : this.rows, cursor: null, query };
  }

  override getEntityServiceByEntityName(entityName: string) {
    return this.related[ entityName ] as any;
  }

  override async batchDelete(options: any) {
    this.deleted.push(...options.identifiers);
    return { data: options.identifiers, unprocessed: [] };
  }
}

describe('BaseEntityService delete plans', () => {
  it('builds dry-run impact from existing relation metadata', async () => {
    const comments = new RelatedService('postComment', [
      { postCommentId: 'c1', postId: 'p1', commentText: 'one' },
      { postCommentId: 'c2', postId: 'p1', commentText: 'two' },
    ]);
    const polls = new RelatedService('poll', [ { pollId: 'poll-1', title: 'MVP' } ]);
    const service = new SourceService([ { postId: 'p1', status: 'draft', pollId: 'poll-1' } ], {
      postComment: comments,
      poll: polls,
    });

    const impact = await service.getDeleteImpact({ ids: [ { postId: 'p1' } ] });

    expect(impact.totals).toEqual({ direct: 1, cascaded: 2, orphaned: 1, blocked: 0, ignored: 0 });
    expect(impact.relations.find(relation => relation.relationAttribute === 'postComments')?.items).toHaveLength(2);
    expect(impact.relations.find(relation => relation.relationAttribute === 'pollId')?.warnings?.[ 0 ]).toContain('left in place');
  });

  it('executes cascades before deleting direct records', async () => {
    const comments = new RelatedService('postComment', [ { postCommentId: 'c1', postId: 'p1' } ]);
    const polls = new RelatedService('poll', [ { pollId: 'poll-1' } ]);
    const service = new SourceService([ { postId: 'p1', status: 'draft', pollId: 'poll-1' } ], {
      postComment: comments,
      poll: polls,
    });

    const result = await service.executeDeletePlan({ ids: [ { postId: 'p1' } ] }) as BulkDeleteExecutionResult;

    expect(comments.deleted).toEqual([ { postCommentId: 'c1' } ]);
    expect(service.deleted).toEqual([ { postId: 'p1' } ]);
    expect(result).toMatchObject({ deletedCount: 1, cascadedCount: 1, orphanedCount: 1, failedCount: 0 });
  });

  it('allows overridable relation policies to block deletes', async () => {
    const comments = new RelatedService('postComment', [ { postCommentId: 'c1', postId: 'p1' } ]);
    const polls = new RelatedService('poll', []);
    const service = new SourceService([ { postId: 'p1', status: 'draft' } ], {
      postComment: comments,
      poll: polls,
    });

    const impact = await service.getDeleteImpact({
      ids: [ { postId: 'p1' } ],
      relationPolicyOverrides: { postComments: 'restrict' },
    }) as DeleteImpactResult;

    expect(impact.blockers).toHaveLength(1);
    expect(impact.totals.blocked).toBe(1);
    await expect(service.executeDeletePlan({
      ids: [ { postId: 'p1' } ],
      relationPolicyOverrides: { postComments: 'restrict' },
    })).rejects.toThrow('Delete is blocked');
  });
});
