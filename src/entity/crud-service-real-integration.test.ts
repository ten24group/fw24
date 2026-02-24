import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { BaseEntityService } from './base-service';
import { Actor } from "../core/types/execution-context";
import { ExecutionContext } from '../core/types/execution-context';
import { EntitySchema } from './base-entity';
import { createLogger } from '../logging';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DIContainer } from '../di/container';
import { EntityConfiguration } from 'electrodb';
// Real entity schema with actor fields
const PostEntitySchema: EntitySchema<any, any, any> = {
  model: {
    entity: 'Post',
    version: '1',
    service: 'blog'
  },
  attributes: {
    postId: {
      type: 'string',
      required: true
    },
    title: {
      type: 'string',
      required: true
    },
    content: {
      type: 'string',
      required: true
    },
    status: {
      type: 'string',
      required: false,
      default: 'draft'
    },
    // Actor-related fields that should be auto-injected
    createdBy: {
      type: 'string',
      required: false
    },
    updatedBy: {
      type: 'string',
      required: false
    },
    createdAt: {
      type: 'string',
      required: false
    },
    updatedAt: {
      type: 'string',
      required: false
    },
    tenantId: {
      type: 'string',
      required: false
    }
  },
  indexes: {
    primary: {
      pk: { composite: ['postId'] },
      sk: { composite: [] }
    },
    byTenant: {
      index: 'gsi1',
      pk: { composite: ['tenantId'] },
      sk: { composite: ['createdAt'] }
    }
  }
} as any;

// Real service implementation for testing
class TestPostService extends BaseEntityService<typeof PostEntitySchema> {
  constructor() {
    const entityConfiguration: EntityConfiguration = {
      table: 'test-posts-table',
      client: new DynamoDBClient({})
    };
    super(PostEntitySchema, entityConfiguration, DIContainer.ROOT);
  }

  // Override to make protected methods accessible for testing
  public testInjectActorContext<T extends Record<string, any>>(
    data: T,
    operation: 'create' | 'update',
    ctx?: ExecutionContext
  ): T {
    return (this as any).injectActorContext(data, operation, ctx);
  }

  // Mock the actual repository operations since we don't have DynamoDB
  public async create(data: any, ctx?: ExecutionContext) {
    const enhancedData = this.testInjectActorContext(data, 'create', ctx);
    // Simulate repository create
    return {
      ...enhancedData,
      postId: enhancedData.postId || `post-${Date.now()}`,
      // Simulate DynamoDB response format
      __edb_e__: 'Post',
      __edb_v__: '1'
    };
  }

  public async update(identifiers: any, data: any, _operators?: any, ctx?: ExecutionContext) {
    const enhancedData = this.testInjectActorContext(data, 'update', ctx);
    // Simulate repository update
    return {
      ...identifiers,
      ...enhancedData,
      // Simulate DynamoDB response format
      __edb_e__: 'Post',
      __edb_v__: '1'
    };
  }
}

function createMockExecutionContext(actor: Actor): ExecutionContext {
  return {
    event: {} as any,
    lambdaContext: {} as any,
    request: {} as any,
    response: {} as any,
    actor
  };
}

describe('CRUD Service Real Integration Tests', () => {
  let postService: TestPostService;

  beforeEach(() => {
    postService = new TestPostService();
  });

  describe('Actor Injection in Real CRUD Operations', () => {

    it('should inject actor context when creating posts via service', async () => {
      const cognitoActor: Actor = {
        actorId: 'user-john-doe',
        actorType: 'user',
        requestId: 'req-create-001',
        timestamp: '2024-01-15T10:30:00.000Z',
        authMethod: 'cognito',
        email: 'john.doe@company.com',
        cognito: {
          sub: 'us-east-1:user-uuid-123',
          username: 'john.doe@company.com',
          groups: ['user', 'content-creator']
        },
        tenantId: 'company-blog-tenant',
        sourceIp: '192.168.1.100',
        userAgent: 'BlogApp/2.0.0'
      };

      const ctx = createMockExecutionContext(cognitoActor);

      const postData = {
        postId: 'post-integration-test-001',
        title: 'My First Blog Post',
        content: 'This is the content of my first blog post.',
        status: 'published'
      };

      const createdPost = await postService.create(postData, ctx);

      // Verify actor injection worked
      expect(createdPost.createdBy).toBe('user-john-doe');
      expect(createdPost.tenantId).toBe('company-blog-tenant');
      expect(createdPost.updatedBy).toBe('user-john-doe');

      // Timestamps should be current system time (ISO format and recent)
      expect(createdPost.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(createdPost.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(createdPost.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
      expect(new Date(createdPost.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);

      // Verify original data is preserved
      expect(createdPost.title).toBe('My First Blog Post');
      expect(createdPost.content).toBe('This is the content of my first blog post.');
      expect(createdPost.status).toBe('published');

      // Verify hidden actor context exists
      expect((createdPost as any)._actor).toEqual(cognitoActor);
    });

    it('should inject actor context when updating posts via service', async () => {
      const apiKeyActor: Actor = {
        actorId: 'api-key:content-management-service',
        actorType: 'service',
        requestId: 'req-update-002',
        timestamp: '2024-01-15T15:45:00.000Z',
        authMethod: 'api-key',
        apiKey: {
          id: 'cms-api-key-789',
          source: 'request-context'
        },
        correlationId: 'bulk-update-batch-456'
      };

      const ctx = createMockExecutionContext(apiKeyActor);

      const updateData = {
        title: 'Updated Blog Post Title',
        content: 'This content has been updated by the CMS service.',
        status: 'reviewed'
      };

      const updatedPost = await postService.update(
        { postId: 'post-to-update' },
        updateData,
        undefined,
        ctx
      );

      // Verify actor injection for update
      expect(updatedPost.updatedBy).toBe('api-key:content-management-service');

      // updatedAt should be current system time
      expect(updatedPost.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(updatedPost.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);

      // createdBy should NOT be overwritten in updates
      expect(updatedPost.createdBy).toBeUndefined();
      expect(updatedPost.createdAt).toBeUndefined();

      // Verify update data
      expect(updatedPost.title).toBe('Updated Blog Post Title');
      expect(updatedPost.status).toBe('reviewed');

      // Verify hidden actor context exists
      expect((updatedPost as any)._actor).toEqual(apiKeyActor);
    });

    it('should handle system actor for automated operations', async () => {
      const systemActor: Actor = {
        actorId: 'anonymous',
        actorType: 'anonymous',
        requestId: 'req-system-cleanup',
        timestamp: '2024-01-15T02:00:00.000Z',
        authMethod: 'anonymous',
        correlationId: 'scheduled-maintenance-001'
      };

      const ctx = createMockExecutionContext(systemActor);

      const archiveData = {
        status: 'archived',
        archivedReason: 'Scheduled maintenance cleanup'
      };

      const archivedPost = await postService.update(
        { postId: 'old-post-123' },
        archiveData,
        undefined,
        ctx
      );

      expect(archivedPost.updatedBy).toBe('anonymous');

      // updatedAt should be current system time
      expect(archivedPost.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(archivedPost.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(archivedPost.status).toBe('archived');
      expect((archivedPost as any)._actor.correlationId).toBe('scheduled-maintenance-001');
    });

    it('should handle tenant isolation in multi-tenant scenarios', async () => {
      const tenant1Actor: Actor = {
        actorId: 'user-tenant1-editor',
        actorType: 'user',
        requestId: 'req-tenant1-001',
        timestamp: '2024-01-15T12:00:00.000Z',
        authMethod: 'cognito',
        tenantId: 'tenant-company-a',
        cognito: {
          groups: ['editor']
        }
      };

      const tenant2Actor: Actor = {
        actorId: 'user-tenant2-editor',
        actorType: 'user',
        requestId: 'req-tenant2-001',
        timestamp: '2024-01-15T12:30:00.000Z',
        authMethod: 'cognito',
        tenantId: 'tenant-company-b',
        cognito: {
          groups: ['editor']
        }
      };

      const ctx1 = createMockExecutionContext(tenant1Actor);
      const ctx2 = createMockExecutionContext(tenant2Actor);

      const post1 = await postService.create({
        postId: 'tenant1-post',
        title: 'Company A Post',
        content: 'Content for Company A'
      }, ctx1);

      const post2 = await postService.create({
        postId: 'tenant2-post',
        title: 'Company B Post',
        content: 'Content for Company B'
      }, ctx2);

      // Verify tenant isolation
      expect(post1.tenantId).toBe('tenant-company-a');
      expect(post1.createdBy).toBe('user-tenant1-editor');

      expect(post2.tenantId).toBe('tenant-company-b');
      expect(post2.createdBy).toBe('user-tenant2-editor');

      // Verify posts are isolated
      expect(post1.tenantId).not.toBe(post2.tenantId);
      expect(post1.createdBy).not.toBe(post2.createdBy);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {

    it('should handle operations without actor context gracefully', async () => {
      const postData = {
        postId: 'post-no-actor',
        title: 'Post Without Actor',
        content: 'This post has no actor context.'
      };

      const createdPost = await postService.create(postData);

      // Should not crash, but no actor fields should be set (no injection happens)
      expect(createdPost.createdBy).toBeUndefined();
      expect(createdPost.updatedBy).toBeUndefined();
      expect(createdPost.tenantId).toBeUndefined();
      expect(createdPost.createdAt).toBeUndefined();
      expect(createdPost.updatedAt).toBeUndefined();

      // Original data should be preserved
      expect(createdPost.title).toBe('Post Without Actor');
      expect(createdPost.content).toBe('This post has no actor context.');
    });

    it('should handle incomplete actor context', async () => {
      const incompleteActor: Actor = {
        requestId: 'req-incomplete',
        timestamp: '2024-01-15T16:00:00.000Z'
        // Missing actorId, authMethod, etc.
      };

      const ctx = createMockExecutionContext(incompleteActor);

      const postData = {
        postId: 'post-incomplete-actor',
        title: 'Post with Incomplete Actor',
        content: 'Testing incomplete actor context.'
      };

      const createdPost = await postService.create(postData, ctx);

      // Should handle gracefully
      expect(createdPost.createdBy).toBeUndefined(); // No actorId
      expect(createdPost.tenantId).toBeUndefined(); // No tenantId

      // When actor context exists but has incomplete data, timestamps should still be injected
      expect((createdPost as any).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((createdPost as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((createdPost as any)._actor).toEqual(incompleteActor);
    });

    it('should preserve existing actor fields when schema has them', async () => {
      const actor: Actor = {
        actorId: 'current-user',
        requestId: 'req-preserve-test',
        timestamp: '2024-01-15T17:00:00.000Z',
        tenantId: 'current-tenant'
      };

      const ctx = createMockExecutionContext(actor);

      // Data already has some actor fields (simulating pre-populated data)
      const postData = {
        postId: 'post-with-existing-fields',
        title: 'Post with Existing Actor Fields',
        content: 'Testing field preservation.',
        createdBy: 'original-creator', // This should be overwritten
        tenantId: 'original-tenant'     // This should be overwritten
      };

      const createdPost = await postService.create(postData, ctx);

      // Current actor should overwrite existing fields
      expect(createdPost.createdBy).toBe('current-user');
      expect(createdPost.tenantId).toBe('current-tenant');

      // But timestamps should be system-generated (not from actor)
      expect(createdPost.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(createdPost.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it('should respect read-only fields and not inject actor data into them', async () => {
      // Create a schema with read-only actor fields
      const ReadOnlyPostSchema: EntitySchema<any, any, any> = {
        model: {
          entity: 'ReadOnlyPost',
          version: '1',
          service: 'blog'
        },
        attributes: {
          postId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          content: { type: 'string', required: true },
          createdBy: { type: 'string', required: false, readOnly: true }, // READ-ONLY
          updatedBy: { type: 'string', required: false }, // Not read-only
          createdAt: { type: 'string', required: false, readOnly: true }, // READ-ONLY
          updatedAt: { type: 'string', required: false }  // Not read-only
        },
        indexes: {
          primary: {
            pk: { composite: ['postId'] },
            sk: { composite: [] }
          }
        }
      } as any;

      class ReadOnlyPostService extends BaseEntityService<typeof ReadOnlyPostSchema> {
        constructor() {
          super(ReadOnlyPostSchema, { table: 'test-readonly-posts', client: new DynamoDBClient({}) }, DIContainer.ROOT);
        }

        public testInjectActorContext<T extends Record<string, any>>(
          data: T,
          operation: 'create' | 'update',
          ctx?: ExecutionContext
        ): T {
          return (this as any).injectActorContext(data, operation, ctx);
        }
      }

      const readOnlyService = new ReadOnlyPostService();

      const actor: Actor = {
        actorId: 'test-user',
        requestId: 'req-readonly-test',
        timestamp: '2024-01-15T18:00:00.000Z',
        tenantId: 'test-tenant'
      };

      const ctx = createMockExecutionContext(actor);

      const postData = {
        postId: 'readonly-test-post',
        title: 'Testing Read-Only Fields',
        content: 'This tests read-only actor field behavior.',
        createdBy: 'system-import', // This should NOT be overwritten (read-only)
        createdAt: '2024-01-01T00:00:00.000Z' // This should NOT be overwritten (read-only)
      };

      const result = readOnlyService.testInjectActorContext(postData, 'create', ctx);

      // Read-only fields should NOT be changed
      expect(result.createdBy).toBe('system-import'); // Preserved original
      expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z'); // Preserved original

      // Non-read-only fields should be injected
      expect((result as any).updatedBy).toBe('test-user'); // Actor injected

      // updatedAt should be system-generated (not from actor)
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);

      // Hidden _actor field should always be injected
      expect((result as any)._actor).toEqual(actor);
    });
  });

  describe('Complex Real-World Scenarios', () => {

    it('should handle content moderation workflow with different actors', async () => {
      // Step 1: User creates draft
      const authorActor: Actor = {
        actorId: 'user-author-jane',
        actorType: 'user',
        requestId: 'req-create-draft',
        timestamp: '2024-01-15T09:00:00.000Z',
        authMethod: 'cognito',
        cognito: {
          groups: ['user', 'author']
        },
        tenantId: 'news-publication'
      };

      const draftPost = await postService.create({
        postId: 'article-breaking-news',
        title: 'Breaking: Important News Story',
        content: 'This is the full story...',
        status: 'draft'
      }, createMockExecutionContext(authorActor));

      expect(draftPost.createdBy).toBe('user-author-jane');
      expect(draftPost.status).toBe('draft');

      // Step 2: Editor reviews and updates
      const editorActor: Actor = {
        actorId: 'user-editor-mike',
        actorType: 'user',
        requestId: 'req-editor-review',
        timestamp: '2024-01-15T10:30:00.000Z',
        authMethod: 'cognito',
        cognito: {
          groups: ['user', 'editor']
        },
        tenantId: 'news-publication'
      };

      const reviewedPost = await postService.update(
        { postId: 'article-breaking-news' },
        {
          content: 'This is the edited and fact-checked story...',
          status: 'under-review',
          editorNotes: 'Content looks good, fact-checked'
        },
        undefined,
        createMockExecutionContext(editorActor)
      );

      expect(reviewedPost.updatedBy).toBe('user-editor-mike');
      expect(reviewedPost.createdBy).toBeUndefined(); // Should NOT change
      expect(reviewedPost.status).toBe('under-review');

      // Step 3: System auto-publishes
      const systemActor: Actor = {
        actorId: 'anonymous',
        actorType: 'anonymous',
        requestId: 'req-auto-publish',
        timestamp: '2024-01-15T11:00:00.000Z',
        authMethod: 'anonymous',
        correlationId: 'scheduled-publish-001'
      };

      const publishedPost = await postService.update(
        { postId: 'article-breaking-news' },
        {
          status: 'published',
          publishedAt: '2024-01-15T11:00:00.000Z'
        },
        undefined,
        createMockExecutionContext(systemActor)
      );

      expect(publishedPost.updatedBy).toBe('anonymous');
      expect(publishedPost.status).toBe('published');
      expect((publishedPost as any)._actor.correlationId).toBe('scheduled-publish-001');
    });

    it('should handle bulk operations with service actor', async () => {
      const migrationActor: Actor = {
        actorId: 'api-key:migration-service',
        actorType: 'service',
        requestId: 'req-bulk-migration',
        timestamp: '2024-01-15T03:00:00.000Z',
        authMethod: 'api-key',
        apiKey: {
          id: 'migration-key-456',
          source: 'request-context'
        },
        correlationId: 'migration-batch-20240115'
      };

      const ctx = createMockExecutionContext(migrationActor);

      // Simulate bulk post migration
      const migrationData = [
        {
          postId: 'migrated-post-001',
          title: 'Migrated Post 1',
          content: 'Content from old system',
          status: 'migrated'
        },
        {
          postId: 'migrated-post-002',
          title: 'Migrated Post 2',
          content: 'Another post from old system',
          status: 'migrated'
        }
      ];

      const migratedPosts = await Promise.all(
        migrationData.map(data => postService.create(data, ctx))
      );

      // Verify all posts have consistent actor context
      migratedPosts.forEach(post => {
        expect(post.createdBy).toBe('api-key:migration-service');
        expect((post as any)._actor.correlationId).toBe('migration-batch-20240115');
        expect(post.status).toBe('migrated');

        // Timestamps should be system-generated
        expect(post.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(new Date(post.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      });
    });
  });
});
