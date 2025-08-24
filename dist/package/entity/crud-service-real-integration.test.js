"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const base_service_1 = require("./base-service");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const container_1 = require("../di/container");
// Real entity schema with actor fields
const PostEntitySchema = {
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
};
// Real service implementation for testing
class TestPostService extends base_service_1.BaseEntityService {
    constructor() {
        const entityConfiguration = {
            table: 'test-posts-table',
            client: new client_dynamodb_1.DynamoDBClient({})
        };
        super(PostEntitySchema, entityConfiguration, container_1.DIContainer.ROOT);
    }
    // Override to make protected methods accessible for testing
    testInjectActorContext(data, operation, ctx) {
        return this.injectActorContext(data, operation, ctx);
    }
    // Mock the actual repository operations since we don't have DynamoDB
    async create(data, ctx) {
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
    async update(identifiers, data, _operators, ctx) {
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
function createMockExecutionContext(actor) {
    return {
        event: {},
        lambdaContext: {},
        request: {},
        response: {},
        actor
    };
}
(0, globals_1.describe)('CRUD Service Real Integration Tests', () => {
    let postService;
    (0, globals_1.beforeEach)(() => {
        postService = new TestPostService();
    });
    (0, globals_1.describe)('Actor Injection in Real CRUD Operations', () => {
        (0, globals_1.it)('should inject actor context when creating posts via service', async () => {
            const cognitoActor = {
                actorId: 'user-john-doe',
                actorType: 'user',
                requestId: 'req-create-001',
                timestamp: '2024-01-15T10:30:00.000Z',
                authMethod: 'cognito',
                cognitoSub: 'us-east-1:user-uuid-123',
                cognitoUsername: 'john.doe@company.com',
                cognitoGroups: ['user', 'content-creator'],
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
            (0, globals_1.expect)(createdPost.createdBy).toBe('user-john-doe');
            (0, globals_1.expect)(createdPost.createdAt).toBe('2024-01-15T10:30:00.000Z');
            (0, globals_1.expect)(createdPost.tenantId).toBe('company-blog-tenant');
            (0, globals_1.expect)(createdPost.updatedBy).toBe('user-john-doe');
            (0, globals_1.expect)(createdPost.updatedAt).toBe('2024-01-15T10:30:00.000Z');
            // Verify original data is preserved
            (0, globals_1.expect)(createdPost.title).toBe('My First Blog Post');
            (0, globals_1.expect)(createdPost.content).toBe('This is the content of my first blog post.');
            (0, globals_1.expect)(createdPost.status).toBe('published');
            // Verify hidden actor context exists
            (0, globals_1.expect)(createdPost._actor).toEqual(cognitoActor);
        });
        (0, globals_1.it)('should inject actor context when updating posts via service', async () => {
            const apiKeyActor = {
                actorId: 'api-key:content-management-service',
                actorType: 'service',
                requestId: 'req-update-002',
                timestamp: '2024-01-15T15:45:00.000Z',
                authMethod: 'api-key',
                apiKeyId: 'cms-api-key-789',
                correlationId: 'bulk-update-batch-456'
            };
            const ctx = createMockExecutionContext(apiKeyActor);
            const updateData = {
                title: 'Updated Blog Post Title',
                content: 'This content has been updated by the CMS service.',
                status: 'reviewed'
            };
            const updatedPost = await postService.update({ postId: 'post-to-update' }, updateData, undefined, ctx);
            // Verify actor injection for update
            (0, globals_1.expect)(updatedPost.updatedBy).toBe('api-key:content-management-service');
            (0, globals_1.expect)(updatedPost.updatedAt).toBe('2024-01-15T15:45:00.000Z');
            // createdBy should NOT be overwritten in updates
            (0, globals_1.expect)(updatedPost.createdBy).toBeUndefined();
            (0, globals_1.expect)(updatedPost.createdAt).toBeUndefined();
            // Verify update data
            (0, globals_1.expect)(updatedPost.title).toBe('Updated Blog Post Title');
            (0, globals_1.expect)(updatedPost.status).toBe('reviewed');
            // Verify hidden actor context exists
            (0, globals_1.expect)(updatedPost._actor).toEqual(apiKeyActor);
        });
        (0, globals_1.it)('should handle system actor for automated operations', async () => {
            const systemActor = {
                actorId: 'system',
                actorType: 'system',
                requestId: 'req-system-cleanup',
                timestamp: '2024-01-15T02:00:00.000Z',
                authMethod: 'system',
                correlationId: 'scheduled-maintenance-001'
            };
            const ctx = createMockExecutionContext(systemActor);
            const archiveData = {
                status: 'archived',
                archivedReason: 'Scheduled maintenance cleanup'
            };
            const archivedPost = await postService.update({ postId: 'old-post-123' }, archiveData, undefined, ctx);
            (0, globals_1.expect)(archivedPost.updatedBy).toBe('system');
            (0, globals_1.expect)(archivedPost.updatedAt).toBe('2024-01-15T02:00:00.000Z');
            (0, globals_1.expect)(archivedPost.status).toBe('archived');
            (0, globals_1.expect)(archivedPost._actor.correlationId).toBe('scheduled-maintenance-001');
        });
        (0, globals_1.it)('should handle tenant isolation in multi-tenant scenarios', async () => {
            const tenant1Actor = {
                actorId: 'user-tenant1-editor',
                actorType: 'user',
                requestId: 'req-tenant1-001',
                timestamp: '2024-01-15T12:00:00.000Z',
                authMethod: 'cognito',
                tenantId: 'tenant-company-a',
                cognitoGroups: ['editor']
            };
            const tenant2Actor = {
                actorId: 'user-tenant2-editor',
                actorType: 'user',
                requestId: 'req-tenant2-001',
                timestamp: '2024-01-15T12:30:00.000Z',
                authMethod: 'cognito',
                tenantId: 'tenant-company-b',
                cognitoGroups: ['editor']
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
            (0, globals_1.expect)(post1.tenantId).toBe('tenant-company-a');
            (0, globals_1.expect)(post1.createdBy).toBe('user-tenant1-editor');
            (0, globals_1.expect)(post2.tenantId).toBe('tenant-company-b');
            (0, globals_1.expect)(post2.createdBy).toBe('user-tenant2-editor');
            // Verify posts are isolated
            (0, globals_1.expect)(post1.tenantId).not.toBe(post2.tenantId);
            (0, globals_1.expect)(post1.createdBy).not.toBe(post2.createdBy);
        });
    });
    (0, globals_1.describe)('Edge Cases and Error Scenarios', () => {
        (0, globals_1.it)('should handle operations without actor context gracefully', async () => {
            const postData = {
                postId: 'post-no-actor',
                title: 'Post Without Actor',
                content: 'This post has no actor context.'
            };
            const createdPost = await postService.create(postData);
            // Should not crash, but no actor fields should be set
            (0, globals_1.expect)(createdPost.createdBy).toBeUndefined();
            (0, globals_1.expect)(createdPost.updatedBy).toBeUndefined();
            (0, globals_1.expect)(createdPost.tenantId).toBeUndefined();
            (0, globals_1.expect)(createdPost.createdAt).toBeUndefined();
            (0, globals_1.expect)(createdPost.updatedAt).toBeUndefined();
            // Original data should be preserved
            (0, globals_1.expect)(createdPost.title).toBe('Post Without Actor');
            (0, globals_1.expect)(createdPost.content).toBe('This post has no actor context.');
        });
        (0, globals_1.it)('should handle incomplete actor context', async () => {
            const incompleteActor = {
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
            (0, globals_1.expect)(createdPost.createdBy).toBeUndefined(); // No actorId
            (0, globals_1.expect)(createdPost.createdAt).toBe('2024-01-15T16:00:00.000Z'); // Has timestamp
            (0, globals_1.expect)(createdPost.tenantId).toBeUndefined(); // No tenantId
            (0, globals_1.expect)(createdPost._actor).toEqual(incompleteActor);
        });
        (0, globals_1.it)('should preserve existing actor fields when schema has them', async () => {
            const actor = {
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
                tenantId: 'original-tenant' // This should be overwritten
            };
            const createdPost = await postService.create(postData, ctx);
            // Current actor should overwrite existing fields
            (0, globals_1.expect)(createdPost.createdBy).toBe('current-user');
            (0, globals_1.expect)(createdPost.tenantId).toBe('current-tenant');
            (0, globals_1.expect)(createdPost.createdAt).toBe('2024-01-15T17:00:00.000Z');
        });
    });
    (0, globals_1.describe)('Complex Real-World Scenarios', () => {
        (0, globals_1.it)('should handle content moderation workflow with different actors', async () => {
            // Step 1: User creates draft
            const authorActor = {
                actorId: 'user-author-jane',
                actorType: 'user',
                requestId: 'req-create-draft',
                timestamp: '2024-01-15T09:00:00.000Z',
                authMethod: 'cognito',
                cognitoGroups: ['user', 'author'],
                tenantId: 'news-publication'
            };
            const draftPost = await postService.create({
                postId: 'article-breaking-news',
                title: 'Breaking: Important News Story',
                content: 'This is the full story...',
                status: 'draft'
            }, createMockExecutionContext(authorActor));
            (0, globals_1.expect)(draftPost.createdBy).toBe('user-author-jane');
            (0, globals_1.expect)(draftPost.status).toBe('draft');
            // Step 2: Editor reviews and updates
            const editorActor = {
                actorId: 'user-editor-mike',
                actorType: 'user',
                requestId: 'req-editor-review',
                timestamp: '2024-01-15T10:30:00.000Z',
                authMethod: 'cognito',
                cognitoGroups: ['user', 'editor'],
                tenantId: 'news-publication'
            };
            const reviewedPost = await postService.update({ postId: 'article-breaking-news' }, {
                content: 'This is the edited and fact-checked story...',
                status: 'under-review',
                editorNotes: 'Content looks good, fact-checked'
            }, undefined, createMockExecutionContext(editorActor));
            (0, globals_1.expect)(reviewedPost.updatedBy).toBe('user-editor-mike');
            (0, globals_1.expect)(reviewedPost.createdBy).toBeUndefined(); // Should NOT change
            (0, globals_1.expect)(reviewedPost.status).toBe('under-review');
            // Step 3: System auto-publishes
            const systemActor = {
                actorId: 'system',
                actorType: 'system',
                requestId: 'req-auto-publish',
                timestamp: '2024-01-15T11:00:00.000Z',
                authMethod: 'system',
                correlationId: 'scheduled-publish-001'
            };
            const publishedPost = await postService.update({ postId: 'article-breaking-news' }, {
                status: 'published',
                publishedAt: '2024-01-15T11:00:00.000Z'
            }, undefined, createMockExecutionContext(systemActor));
            (0, globals_1.expect)(publishedPost.updatedBy).toBe('system');
            (0, globals_1.expect)(publishedPost.status).toBe('published');
            (0, globals_1.expect)(publishedPost._actor.correlationId).toBe('scheduled-publish-001');
        });
        (0, globals_1.it)('should handle bulk operations with service actor', async () => {
            const migrationActor = {
                actorId: 'api-key:migration-service',
                actorType: 'service',
                requestId: 'req-bulk-migration',
                timestamp: '2024-01-15T03:00:00.000Z',
                authMethod: 'api-key',
                apiKeyId: 'migration-key-456',
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
            const migratedPosts = await Promise.all(migrationData.map(data => postService.create(data, ctx)));
            // Verify all posts have consistent actor context
            migratedPosts.forEach(post => {
                (0, globals_1.expect)(post.createdBy).toBe('api-key:migration-service');
                (0, globals_1.expect)(post.createdAt).toBe('2024-01-15T03:00:00.000Z');
                (0, globals_1.expect)(post._actor.correlationId).toBe('migration-batch-20240115');
                (0, globals_1.expect)(post.status).toBe('migrated');
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLXJlYWwtaW50ZWdyYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvY3J1ZC1zZXJ2aWNlLXJlYWwtaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUF1RTtBQUN2RSxpREFBbUQ7QUFLbkQsOERBQTBEO0FBQzFELCtDQUE4QztBQUU5Qyx1Q0FBdUM7QUFDdkMsTUFBTSxnQkFBZ0IsR0FBZ0M7SUFDcEQsS0FBSyxFQUFFO1FBQ0wsTUFBTSxFQUFFLE1BQU07UUFDZCxPQUFPLEVBQUUsR0FBRztRQUNaLE9BQU8sRUFBRSxNQUFNO0tBQ2hCO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsS0FBSyxFQUFFO1lBQ0wsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsT0FBTyxFQUFFO1lBQ1AsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztZQUNmLE9BQU8sRUFBRSxPQUFPO1NBQ2pCO1FBQ0Qsb0RBQW9EO1FBQ3BELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7U0FDaEI7UUFDRCxTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxLQUFLO1NBQ2hCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztTQUNoQjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7U0FDaEI7UUFDRCxRQUFRLEVBQUU7WUFDUixJQUFJ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QkFDbkI7YUFDRixDQUFDO1lBRUYsTUFBTSxhQUFhLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUNyQyxhQUFhLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FDekQsQ0FBQztZQUVGLGlEQUFpRDtZQUNqRCxhQUFhLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUMzQixJQUFBLGdCQUFNLEVBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO2dCQUN6RCxJQUFBLGdCQUFNLEVBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO2dCQUN4RCxJQUFBLGdCQUFNLEVBQUUsSUFBWSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsQ0FBQztnQkFDNUUsSUFBQSxnQkFBTSxFQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDdkMsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBkZXNjcmliZSwgZXhwZWN0LCBpdCwgYmVmb3JlRWFjaCwgamVzdCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuL2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvYWN0b3InO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRW50aXR5U2NoZW1hIH0gZnJvbSAnLi9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vZGkvY29udGFpbmVyJztcbmltcG9ydCB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tICdlbGVjdHJvZGInO1xuLy8gUmVhbCBlbnRpdHkgc2NoZW1hIHdpdGggYWN0b3IgZmllbGRzXG5jb25zdCBQb3N0RW50aXR5U2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gIG1vZGVsOiB7XG4gICAgZW50aXR5OiAnUG9zdCcsXG4gICAgdmVyc2lvbjogJzEnLFxuICAgIHNlcnZpY2U6ICdibG9nJ1xuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgcG9zdElkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICB0aXRsZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZVxuICAgIH0sXG4gICAgY29udGVudDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZVxuICAgIH0sXG4gICAgc3RhdHVzOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGRlZmF1bHQ6ICdkcmFmdCdcbiAgICB9LFxuICAgIC8vIEFjdG9yLXJlbGF0ZWQgZmllbGRzIHRoYXQgc2hvdWxkIGJlIGF1dG8taW5qZWN0ZWRcbiAgICBjcmVhdGVkQnk6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlXG4gICAgfSxcbiAgICB1cGRhdGVkQnk6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlXG4gICAgfSxcbiAgICBjcmVhdGVkQXQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlXG4gICAgfSxcbiAgICB1cGRhdGVkQXQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlXG4gICAgfSxcbiAgICB0ZW5hbnRJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2VcbiAgICB9XG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazogeyBjb21wb3NpdGU6IFsncG9zdElkJ10gfSxcbiAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgIH0sXG4gICAgYnlUZW5hbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICBwazogeyBjb21wb3NpdGU6IFsndGVuYW50SWQnXSB9LFxuICAgICAgc2s6IHsgY29tcG9zaXRlOiBbJ2NyZWF0ZWRBdCddIH1cbiAgICB9XG4gIH1cbn0gYXMgYW55O1xuXG4vLyBSZWFsIHNlcnZpY2UgaW1wbGVtZW50YXRpb24gZm9yIHRlc3RpbmdcbmNsYXNzIFRlc3RQb3N0U2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPHR5cGVvZiBQb3N0RW50aXR5U2NoZW1hPiB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIGNvbnN0IGVudGl0eUNvbmZpZ3VyYXRpb246IEVudGl0eUNvbmZpZ3VyYXRpb24gPSB7XG4gICAgICB0YWJsZTogJ3Rlc3QtcG9zdHMtdGFibGUnLFxuICAgICAgY2xpZW50OiBuZXcgRHluYW1vREJDbGllbnQoe30pXG4gICAgfTtcbiAgICBzdXBlcihQb3N0RW50aXR5U2NoZW1hLCBlbnRpdHlDb25maWd1cmF0aW9uLCBESUNvbnRhaW5lci5ST09UKTtcbiAgfVxuXG4gIC8vIE92ZXJyaWRlIHRvIG1ha2UgcHJvdGVjdGVkIG1ldGhvZHMgYWNjZXNzaWJsZSBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdEluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZGF0YTogVCxcbiAgICBvcGVyYXRpb246ICdjcmVhdGUnIHwgJ3VwZGF0ZScsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICApOiBUIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5pbmplY3RBY3RvckNvbnRleHQoZGF0YSwgb3BlcmF0aW9uLCBjdHgpO1xuICB9XG5cbiAgLy8gTW9jayB0aGUgYWN0dWFsIHJlcG9zaXRvcnkgb3BlcmF0aW9ucyBzaW5jZSB3ZSBkb24ndCBoYXZlIER5bmFtb0RCXG4gIHB1YmxpYyBhc3luYyBjcmVhdGUoZGF0YTogYW55LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgY29uc3QgZW5oYW5jZWREYXRhID0gdGhpcy50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGRhdGEsICdjcmVhdGUnLCBjdHgpO1xuICAgIC8vIFNpbXVsYXRlIHJlcG9zaXRvcnkgY3JlYXRlXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmVuaGFuY2VkRGF0YSxcbiAgICAgIHBvc3RJZDogZW5oYW5jZWREYXRhLnBvc3RJZCB8fCBgcG9zdC0ke0RhdGUubm93KCl9YCxcbiAgICAgIC8vIFNpbXVsYXRlIER5bmFtb0RCIHJlc3BvbnNlIGZvcm1hdFxuICAgICAgX19lZGJfZV9fOiAnUG9zdCcsXG4gICAgICBfX2VkYl92X186ICcxJ1xuICAgIH07XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgdXBkYXRlKGlkZW50aWZpZXJzOiBhbnksIGRhdGE6IGFueSwgX29wZXJhdG9ycz86IGFueSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgIGNvbnN0IGVuaGFuY2VkRGF0YSA9IHRoaXMudGVzdEluamVjdEFjdG9yQ29udGV4dChkYXRhLCAndXBkYXRlJywgY3R4KTtcbiAgICAvLyBTaW11bGF0ZSByZXBvc2l0b3J5IHVwZGF0ZVxuICAgIHJldHVybiB7XG4gICAgICAuLi5pZGVudGlmaWVycyxcbiAgICAgIC4uLmVuaGFuY2VkRGF0YSxcbiAgICAgIC8vIFNpbXVsYXRlIER5bmFtb0RCIHJlc3BvbnNlIGZvcm1hdFxuICAgICAgX19lZGJfZV9fOiAnUG9zdCcsXG4gICAgICBfX2VkYl92X186ICcxJ1xuICAgIH07XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoYWN0b3I6IEFjdG9yKTogRXhlY3V0aW9uQ29udGV4dCB7XG4gIHJldHVybiB7XG4gICAgZXZlbnQ6IHt9IGFzIGFueSxcbiAgICBsYW1iZGFDb250ZXh0OiB7fSBhcyBhbnksXG4gICAgcmVxdWVzdDoge30gYXMgYW55LFxuICAgIHJlc3BvbnNlOiB7fSBhcyBhbnksXG4gICAgYWN0b3JcbiAgfTtcbn1cblxuZGVzY3JpYmUoJ0NSVUQgU2VydmljZSBSZWFsIEludGVncmF0aW9uIFRlc3RzJywgKCkgPT4ge1xuICBsZXQgcG9zdFNlcnZpY2U6IFRlc3RQb3N0U2VydmljZTtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBwb3N0U2VydmljZSA9IG5ldyBUZXN0UG9zdFNlcnZpY2UoKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0FjdG9yIEluamVjdGlvbiBpbiBSZWFsIENSVUQgT3BlcmF0aW9ucycsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIGluamVjdCBhY3RvciBjb250ZXh0IHdoZW4gY3JlYXRpbmcgcG9zdHMgdmlhIHNlcnZpY2UnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb2duaXRvQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci1qb2huLWRvZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3JlYXRlLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgY29nbml0b1N1YjogJ3VzLWVhc3QtMTp1c2VyLXV1aWQtMTIzJyxcbiAgICAgICAgY29nbml0b1VzZXJuYW1lOiAnam9obi5kb2VAY29tcGFueS5jb20nLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiBbJ3VzZXInLCAnY29udGVudC1jcmVhdG9yJ10sXG4gICAgICAgIHRlbmFudElkOiAnY29tcGFueS1ibG9nLXRlbmFudCcsXG4gICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEwMCcsXG4gICAgICAgIHVzZXJBZ2VudDogJ0Jsb2dBcHAvMi4wLjAnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChjb2duaXRvQWN0b3IpO1xuXG4gICAgICBjb25zdCBwb3N0RGF0YSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC1pbnRlZ3JhdGlvbi10ZXN0LTAwMScsXG4gICAgICAgIHRpdGxlOiAnTXkgRmlyc3QgQmxvZyBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgaXMgdGhlIGNvbnRlbnQgb2YgbXkgZmlyc3QgYmxvZyBwb3N0LicsXG4gICAgICAgIHN0YXR1czogJ3B1Ymxpc2hlZCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNyZWF0ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHBvc3REYXRhLCBjdHgpO1xuXG4gICAgICAvLyBWZXJpZnkgYWN0b3IgaW5qZWN0aW9uIHdvcmtlZFxuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRCeSkudG9CZSgndXNlci1qb2huLWRvZScpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRBdCkudG9CZSgnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudGVuYW50SWQpLnRvQmUoJ2NvbXBhbnktYmxvZy10ZW5hbnQnKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC51cGRhdGVkQnkpLnRvQmUoJ3VzZXItam9obi1kb2UnKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC51cGRhdGVkQXQpLnRvQmUoJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicpO1xuXG4gICAgICAvLyBWZXJpZnkgb3JpZ2luYWwgZGF0YSBpcyBwcmVzZXJ2ZWRcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50aXRsZSkudG9CZSgnTXkgRmlyc3QgQmxvZyBQb3N0Jyk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY29udGVudCkudG9CZSgnVGhpcyBpcyB0aGUgY29udGVudCBvZiBteSBmaXJzdCBibG9nIHBvc3QuJyk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3Quc3RhdHVzKS50b0JlKCdwdWJsaXNoZWQnKTtcblxuICAgICAgLy8gVmVyaWZ5IGhpZGRlbiBhY3RvciBjb250ZXh0IGV4aXN0c1xuICAgICAgZXhwZWN0KChjcmVhdGVkUG9zdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChjb2duaXRvQWN0b3IpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBpbmplY3QgYWN0b3IgY29udGV4dCB3aGVuIHVwZGF0aW5nIHBvc3RzIHZpYSBzZXJ2aWNlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpS2V5QWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYXBpLWtleTpjb250ZW50LW1hbmFnZW1lbnQtc2VydmljZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdXBkYXRlLTAwMicsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTU6NDU6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYXBpS2V5SWQ6ICdjbXMtYXBpLWtleS03ODknLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnYnVsay11cGRhdGUtYmF0Y2gtNDU2J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoYXBpS2V5QWN0b3IpO1xuXG4gICAgICBjb25zdCB1cGRhdGVEYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgQmxvZyBQb3N0IFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgY29udGVudCBoYXMgYmVlbiB1cGRhdGVkIGJ5IHRoZSBDTVMgc2VydmljZS4nLFxuICAgICAgICBzdGF0dXM6ICdyZXZpZXdlZCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHVwZGF0ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UudXBkYXRlKFxuICAgICAgICB7IHBvc3RJZDogJ3Bvc3QtdG8tdXBkYXRlJyB9LFxuICAgICAgICB1cGRhdGVEYXRhLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIGN0eFxuICAgICAgKTtcblxuICAgICAgLy8gVmVyaWZ5IGFjdG9yIGluamVjdGlvbiBmb3IgdXBkYXRlXG4gICAgICBleHBlY3QodXBkYXRlZFBvc3QudXBkYXRlZEJ5KS50b0JlKCdhcGkta2V5OmNvbnRlbnQtbWFuYWdlbWVudC1zZXJ2aWNlJyk7XG4gICAgICBleHBlY3QodXBkYXRlZFBvc3QudXBkYXRlZEF0KS50b0JlKCcyMDI0LTAxLTE1VDE1OjQ1OjAwLjAwMFonKTtcbiAgICAgIFxuICAgICAgLy8gY3JlYXRlZEJ5IHNob3VsZCBOT1QgYmUgb3ZlcndyaXR0ZW4gaW4gdXBkYXRlc1xuICAgICAgZXhwZWN0KHVwZGF0ZWRQb3N0LmNyZWF0ZWRCeSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHVwZGF0ZWRQb3N0LmNyZWF0ZWRBdCkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgICAvLyBWZXJpZnkgdXBkYXRlIGRhdGFcbiAgICAgIGV4cGVjdCh1cGRhdGVkUG9zdC50aXRsZSkudG9CZSgnVXBkYXRlZCBCbG9nIFBvc3QgVGl0bGUnKTtcbiAgICAgIGV4cGVjdCh1cGRhdGVkUG9zdC5zdGF0dXMpLnRvQmUoJ3Jldmlld2VkJyk7XG5cbiAgICAgIC8vIFZlcmlmeSBoaWRkZW4gYWN0b3IgY29udGV4dCBleGlzdHNcbiAgICAgIGV4cGVjdCgodXBkYXRlZFBvc3QgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwoYXBpS2V5QWN0b3IpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgc3lzdGVtIGFjdG9yIGZvciBhdXRvbWF0ZWQgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHN5c3RlbUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3N5c3RlbScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3N5c3RlbScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1zeXN0ZW0tY2xlYW51cCcsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMDI6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdzeXN0ZW0nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnc2NoZWR1bGVkLW1haW50ZW5hbmNlLTAwMSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KHN5c3RlbUFjdG9yKTtcblxuICAgICAgY29uc3QgYXJjaGl2ZURhdGEgPSB7XG4gICAgICAgIHN0YXR1czogJ2FyY2hpdmVkJyxcbiAgICAgICAgYXJjaGl2ZWRSZWFzb246ICdTY2hlZHVsZWQgbWFpbnRlbmFuY2UgY2xlYW51cCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGFyY2hpdmVkUG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLnVwZGF0ZShcbiAgICAgICAgeyBwb3N0SWQ6ICdvbGQtcG9zdC0xMjMnIH0sXG4gICAgICAgIGFyY2hpdmVEYXRhLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIGN0eFxuICAgICAgKTtcblxuICAgICAgZXhwZWN0KGFyY2hpdmVkUG9zdC51cGRhdGVkQnkpLnRvQmUoJ3N5c3RlbScpO1xuICAgICAgZXhwZWN0KGFyY2hpdmVkUG9zdC51cGRhdGVkQXQpLnRvQmUoJzIwMjQtMDEtMTVUMDI6MDA6MDAuMDAwWicpO1xuICAgICAgZXhwZWN0KGFyY2hpdmVkUG9zdC5zdGF0dXMpLnRvQmUoJ2FyY2hpdmVkJyk7XG4gICAgICBleHBlY3QoKGFyY2hpdmVkUG9zdCBhcyBhbnkpLl9hY3Rvci5jb3JyZWxhdGlvbklkKS50b0JlKCdzY2hlZHVsZWQtbWFpbnRlbmFuY2UtMDAxJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB0ZW5hbnQgaXNvbGF0aW9uIGluIG11bHRpLXRlbmFudCBzY2VuYXJpb3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB0ZW5hbnQxQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci10ZW5hbnQxLWVkaXRvcicsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdGVuYW50MS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEyOjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHRlbmFudElkOiAndGVuYW50LWNvbXBhbnktYScsXG4gICAgICAgIGNvZ25pdG9Hcm91cHM6IFsnZWRpdG9yJ11cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHRlbmFudDJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLXRlbmFudDItZWRpdG9yJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS10ZW5hbnQyLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTI6MzA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtY29tcGFueS1iJyxcbiAgICAgICAgY29nbml0b0dyb3VwczogWydlZGl0b3InXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4MSA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KHRlbmFudDFBY3Rvcik7XG4gICAgICBjb25zdCBjdHgyID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQodGVuYW50MkFjdG9yKTtcblxuICAgICAgY29uc3QgcG9zdDEgPSBhd2FpdCBwb3N0U2VydmljZS5jcmVhdGUoe1xuICAgICAgICBwb3N0SWQ6ICd0ZW5hbnQxLXBvc3QnLFxuICAgICAgICB0aXRsZTogJ0NvbXBhbnkgQSBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ0NvbnRlbnQgZm9yIENvbXBhbnkgQSdcbiAgICAgIH0sIGN0eDEpO1xuXG4gICAgICBjb25zdCBwb3N0MiA9IGF3YWl0IHBvc3RTZXJ2aWNlLmNyZWF0ZSh7XG4gICAgICAgIHBvc3RJZDogJ3RlbmFudDItcG9zdCcsXG4gICAgICAgIHRpdGxlOiAnQ29tcGFueSBCIFBvc3QnLFxuICAgICAgICBjb250ZW50OiAnQ29udGVudCBmb3IgQ29tcGFueSBCJ1xuICAgICAgfSwgY3R4Mik7XG5cbiAgICAgIC8vIFZlcmlmeSB0ZW5hbnQgaXNvbGF0aW9uXG4gICAgICBleHBlY3QocG9zdDEudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1jb21wYW55LWEnKTtcbiAgICAgIGV4cGVjdChwb3N0MS5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItdGVuYW50MS1lZGl0b3InKTtcblxuICAgICAgZXhwZWN0KHBvc3QyLnRlbmFudElkKS50b0JlKCd0ZW5hbnQtY29tcGFueS1iJyk7XG4gICAgICBleHBlY3QocG9zdDIuY3JlYXRlZEJ5KS50b0JlKCd1c2VyLXRlbmFudDItZWRpdG9yJyk7XG5cbiAgICAgIC8vIFZlcmlmeSBwb3N0cyBhcmUgaXNvbGF0ZWRcbiAgICAgIGV4cGVjdChwb3N0MS50ZW5hbnRJZCkubm90LnRvQmUocG9zdDIudGVuYW50SWQpO1xuICAgICAgZXhwZWN0KHBvc3QxLmNyZWF0ZWRCeSkubm90LnRvQmUocG9zdDIuY3JlYXRlZEJ5KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VkZ2UgQ2FzZXMgYW5kIEVycm9yIFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBvcGVyYXRpb25zIHdpdGhvdXQgYWN0b3IgY29udGV4dCBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcG9zdERhdGEgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3Qtbm8tYWN0b3InLFxuICAgICAgICB0aXRsZTogJ1Bvc3QgV2l0aG91dCBBY3RvcicsXG4gICAgICAgIGNvbnRlbnQ6ICdUaGlzIHBvc3QgaGFzIG5vIGFjdG9yIGNvbnRleHQuJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3JlYXRlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS5jcmVhdGUocG9zdERhdGEpO1xuXG4gICAgICAvLyBTaG91bGQgbm90IGNyYXNoLCBidXQgbm8gYWN0b3IgZmllbGRzIHNob3VsZCBiZSBzZXRcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jcmVhdGVkQnkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC51cGRhdGVkQnkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50ZW5hbnRJZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRBdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnVwZGF0ZWRBdCkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgICAvLyBPcmlnaW5hbCBkYXRhIHNob3VsZCBiZSBwcmVzZXJ2ZWRcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50aXRsZSkudG9CZSgnUG9zdCBXaXRob3V0IEFjdG9yJyk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY29udGVudCkudG9CZSgnVGhpcyBwb3N0IGhhcyBubyBhY3RvciBjb250ZXh0LicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW5jb21wbGV0ZSBhY3RvciBjb250ZXh0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5jb21wbGV0ZUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWluY29tcGxldGUnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDE2OjAwOjAwLjAwMFonXG4gICAgICAgIC8vIE1pc3NpbmcgYWN0b3JJZCwgYXV0aE1ldGhvZCwgZXRjLlxuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoaW5jb21wbGV0ZUFjdG9yKTtcblxuICAgICAgY29uc3QgcG9zdERhdGEgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtaW5jb21wbGV0ZS1hY3RvcicsXG4gICAgICAgIHRpdGxlOiAnUG9zdCB3aXRoIEluY29tcGxldGUgQWN0b3InLFxuICAgICAgICBjb250ZW50OiAnVGVzdGluZyBpbmNvbXBsZXRlIGFjdG9yIGNvbnRleHQuJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3JlYXRlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS5jcmVhdGUocG9zdERhdGEsIGN0eCk7XG5cbiAgICAgIC8vIFNob3VsZCBoYW5kbGUgZ3JhY2VmdWxseVxuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRCeSkudG9CZVVuZGVmaW5lZCgpOyAvLyBObyBhY3RvcklkXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY3JlYXRlZEF0KS50b0JlKCcyMDI0LTAxLTE1VDE2OjAwOjAwLjAwMFonKTsgLy8gSGFzIHRpbWVzdGFtcFxuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnRlbmFudElkKS50b0JlVW5kZWZpbmVkKCk7IC8vIE5vIHRlbmFudElkXG4gICAgICBleHBlY3QoKGNyZWF0ZWRQb3N0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKGluY29tcGxldGVBY3Rvcik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByZXNlcnZlIGV4aXN0aW5nIGFjdG9yIGZpZWxkcyB3aGVuIHNjaGVtYSBoYXMgdGhlbScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2N1cnJlbnQtdXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcmVzZXJ2ZS10ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxNzowMDowMC4wMDBaJyxcbiAgICAgICAgdGVuYW50SWQ6ICdjdXJyZW50LXRlbmFudCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGFjdG9yKTtcblxuICAgICAgLy8gRGF0YSBhbHJlYWR5IGhhcyBzb21lIGFjdG9yIGZpZWxkcyAoc2ltdWxhdGluZyBwcmUtcG9wdWxhdGVkIGRhdGEpXG4gICAgICBjb25zdCBwb3N0RGF0YSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC13aXRoLWV4aXN0aW5nLWZpZWxkcycsXG4gICAgICAgIHRpdGxlOiAnUG9zdCB3aXRoIEV4aXN0aW5nIEFjdG9yIEZpZWxkcycsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0aW5nIGZpZWxkIHByZXNlcnZhdGlvbi4nLFxuICAgICAgICBjcmVhdGVkQnk6ICdvcmlnaW5hbC1jcmVhdG9yJywgLy8gVGhpcyBzaG91bGQgYmUgb3ZlcndyaXR0ZW5cbiAgICAgICAgdGVuYW50SWQ6ICdvcmlnaW5hbC10ZW5hbnQnICAgICAvLyBUaGlzIHNob3VsZCBiZSBvdmVyd3JpdHRlblxuICAgICAgfTtcblxuICAgICAgY29uc3QgY3JlYXRlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS5jcmVhdGUocG9zdERhdGEsIGN0eCk7XG5cbiAgICAgIC8vIEN1cnJlbnQgYWN0b3Igc2hvdWxkIG92ZXJ3cml0ZSBleGlzdGluZyBmaWVsZHNcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jcmVhdGVkQnkpLnRvQmUoJ2N1cnJlbnQtdXNlcicpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnRlbmFudElkKS50b0JlKCdjdXJyZW50LXRlbmFudCcpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRBdCkudG9CZSgnMjAyNC0wMS0xNVQxNzowMDowMC4wMDBaJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDb21wbGV4IFJlYWwtV29ybGQgU2NlbmFyaW9zJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbnRlbnQgbW9kZXJhdGlvbiB3b3JrZmxvdyB3aXRoIGRpZmZlcmVudCBhY3RvcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTdGVwIDE6IFVzZXIgY3JlYXRlcyBkcmFmdFxuICAgICAgY29uc3QgYXV0aG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci1hdXRob3ItamFuZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3JlYXRlLWRyYWZ0JyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQwOTowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiBbJ3VzZXInLCAnYXV0aG9yJ10sXG4gICAgICAgIHRlbmFudElkOiAnbmV3cy1wdWJsaWNhdGlvbidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGRyYWZ0UG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLmNyZWF0ZSh7XG4gICAgICAgIHBvc3RJZDogJ2FydGljbGUtYnJlYWtpbmctbmV3cycsXG4gICAgICAgIHRpdGxlOiAnQnJlYWtpbmc6IEltcG9ydGFudCBOZXdzIFN0b3J5JyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgaXMgdGhlIGZ1bGwgc3RvcnkuLi4nLFxuICAgICAgICBzdGF0dXM6ICdkcmFmdCdcbiAgICAgIH0sIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGF1dGhvckFjdG9yKSk7XG5cbiAgICAgIGV4cGVjdChkcmFmdFBvc3QuY3JlYXRlZEJ5KS50b0JlKCd1c2VyLWF1dGhvci1qYW5lJyk7XG4gICAgICBleHBlY3QoZHJhZnRQb3N0LnN0YXR1cykudG9CZSgnZHJhZnQnKTtcblxuICAgICAgLy8gU3RlcCAyOiBFZGl0b3IgcmV2aWV3cyBhbmQgdXBkYXRlc1xuICAgICAgY29uc3QgZWRpdG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci1lZGl0b3ItbWlrZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtZWRpdG9yLXJldmlldycsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgY29nbml0b0dyb3VwczogWyd1c2VyJywgJ2VkaXRvciddLFxuICAgICAgICB0ZW5hbnRJZDogJ25ld3MtcHVibGljYXRpb24nXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXZpZXdlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS51cGRhdGUoXG4gICAgICAgIHsgcG9zdElkOiAnYXJ0aWNsZS1icmVha2luZy1uZXdzJyB9LFxuICAgICAgICB7XG4gICAgICAgICAgY29udGVudDogJ1RoaXMgaXMgdGhlIGVkaXRlZCBhbmQgZmFjdC1jaGVja2VkIHN0b3J5Li4uJyxcbiAgICAgICAgICBzdGF0dXM6ICd1bmRlci1yZXZpZXcnLFxuICAgICAgICAgIGVkaXRvck5vdGVzOiAnQ29udGVudCBsb29rcyBnb29kLCBmYWN0LWNoZWNrZWQnXG4gICAgICAgIH0sXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoZWRpdG9yQWN0b3IpXG4gICAgICApO1xuXG4gICAgICBleHBlY3QocmV2aWV3ZWRQb3N0LnVwZGF0ZWRCeSkudG9CZSgndXNlci1lZGl0b3ItbWlrZScpO1xuICAgICAgZXhwZWN0KHJldmlld2VkUG9zdC5jcmVhdGVkQnkpLnRvQmVVbmRlZmluZWQoKTsgLy8gU2hvdWxkIE5PVCBjaGFuZ2VcbiAgICAgIGV4cGVjdChyZXZpZXdlZFBvc3Quc3RhdHVzKS50b0JlKCd1bmRlci1yZXZpZXcnKTtcblxuICAgICAgLy8gU3RlcCAzOiBTeXN0ZW0gYXV0by1wdWJsaXNoZXNcbiAgICAgIGNvbnN0IHN5c3RlbUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3N5c3RlbScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3N5c3RlbScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1hdXRvLXB1Ymxpc2gnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDExOjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnc3lzdGVtJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3NjaGVkdWxlZC1wdWJsaXNoLTAwMSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHB1Ymxpc2hlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS51cGRhdGUoXG4gICAgICAgIHsgcG9zdElkOiAnYXJ0aWNsZS1icmVha2luZy1uZXdzJyB9LFxuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzOiAncHVibGlzaGVkJyxcbiAgICAgICAgICBwdWJsaXNoZWRBdDogJzIwMjQtMDEtMTVUMTE6MDA6MDAuMDAwWidcbiAgICAgICAgfSxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChzeXN0ZW1BY3RvcilcbiAgICAgICk7XG5cbiAgICAgIGV4cGVjdChwdWJsaXNoZWRQb3N0LnVwZGF0ZWRCeSkudG9CZSgnc3lzdGVtJyk7XG4gICAgICBleHBlY3QocHVibGlzaGVkUG9zdC5zdGF0dXMpLnRvQmUoJ3B1Ymxpc2hlZCcpO1xuICAgICAgZXhwZWN0KChwdWJsaXNoZWRQb3N0IGFzIGFueSkuX2FjdG9yLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ3NjaGVkdWxlZC1wdWJsaXNoLTAwMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYnVsayBvcGVyYXRpb25zIHdpdGggc2VydmljZSBhY3RvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1pZ3JhdGlvbkFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6bWlncmF0aW9uLXNlcnZpY2UnLFxuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWJ1bGstbWlncmF0aW9uJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQwMzowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2FwaS1rZXknLFxuICAgICAgICBhcGlLZXlJZDogJ21pZ3JhdGlvbi1rZXktNDU2JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ21pZ3JhdGlvbi1iYXRjaC0yMDI0MDExNSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1pZ3JhdGlvbkFjdG9yKTtcblxuICAgICAgLy8gU2ltdWxhdGUgYnVsayBwb3N0IG1pZ3JhdGlvblxuICAgICAgY29uc3QgbWlncmF0aW9uRGF0YSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHBvc3RJZDogJ21pZ3JhdGVkLXBvc3QtMDAxJyxcbiAgICAgICAgICB0aXRsZTogJ01pZ3JhdGVkIFBvc3QgMScsXG4gICAgICAgICAgY29udGVudDogJ0NvbnRlbnQgZnJvbSBvbGQgc3lzdGVtJyxcbiAgICAgICAgICBzdGF0dXM6ICdtaWdyYXRlZCdcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHBvc3RJZDogJ21pZ3JhdGVkLXBvc3QtMDAyJyxcbiAgICAgICAgICB0aXRsZTogJ01pZ3JhdGVkIFBvc3QgMicsXG4gICAgICAgICAgY29udGVudDogJ0Fub3RoZXIgcG9zdCBmcm9tIG9sZCBzeXN0ZW0nLFxuICAgICAgICAgIHN0YXR1czogJ21pZ3JhdGVkJ1xuICAgICAgICB9XG4gICAgICBdO1xuXG4gICAgICBjb25zdCBtaWdyYXRlZFBvc3RzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIG1pZ3JhdGlvbkRhdGEubWFwKGRhdGEgPT4gcG9zdFNlcnZpY2UuY3JlYXRlKGRhdGEsIGN0eCkpXG4gICAgICApO1xuXG4gICAgICAvLyBWZXJpZnkgYWxsIHBvc3RzIGhhdmUgY29uc2lzdGVudCBhY3RvciBjb250ZXh0XG4gICAgICBtaWdyYXRlZFBvc3RzLmZvckVhY2gocG9zdCA9PiB7XG4gICAgICAgIGV4cGVjdChwb3N0LmNyZWF0ZWRCeSkudG9CZSgnYXBpLWtleTptaWdyYXRpb24tc2VydmljZScpO1xuICAgICAgICBleHBlY3QocG9zdC5jcmVhdGVkQXQpLnRvQmUoJzIwMjQtMDEtMTVUMDM6MDA6MDAuMDAwWicpO1xuICAgICAgICBleHBlY3QoKHBvc3QgYXMgYW55KS5fYWN0b3IuY29ycmVsYXRpb25JZCkudG9CZSgnbWlncmF0aW9uLWJhdGNoLTIwMjQwMTE1Jyk7XG4gICAgICAgIGV4cGVjdChwb3N0LnN0YXR1cykudG9CZSgnbWlncmF0ZWQnKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19