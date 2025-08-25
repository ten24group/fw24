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
            (0, globals_1.expect)(createdPost.createdBy).toBe('user-john-doe');
            (0, globals_1.expect)(createdPost.tenantId).toBe('company-blog-tenant');
            (0, globals_1.expect)(createdPost.updatedBy).toBe('user-john-doe');
            // Timestamps should be current system time (ISO format and recent)
            (0, globals_1.expect)(createdPost.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            (0, globals_1.expect)(createdPost.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            (0, globals_1.expect)(new Date(createdPost.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
            (0, globals_1.expect)(new Date(createdPost.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
            const updatedPost = await postService.update({ postId: 'post-to-update' }, updateData, undefined, ctx);
            // Verify actor injection for update
            (0, globals_1.expect)(updatedPost.updatedBy).toBe('api-key:content-management-service');
            // updatedAt should be current system time
            (0, globals_1.expect)(updatedPost.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            (0, globals_1.expect)(new Date(updatedPost.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
            const archivedPost = await postService.update({ postId: 'old-post-123' }, archiveData, undefined, ctx);
            (0, globals_1.expect)(archivedPost.updatedBy).toBe('anonymous');
            // updatedAt should be current system time
            (0, globals_1.expect)(archivedPost.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            (0, globals_1.expect)(new Date(archivedPost.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
                cognito: {
                    groups: ['editor']
                }
            };
            const tenant2Actor = {
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
            // Should not crash, but no actor fields should be set (no injection happens)
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
            (0, globals_1.expect)(createdPost.tenantId).toBeUndefined(); // No tenantId
            // When actor context exists but has incomplete data, timestamps should still be injected
            (0, globals_1.expect)(createdPost.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            (0, globals_1.expect)(createdPost.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
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
            // But timestamps should be system-generated (not from actor)
            (0, globals_1.expect)(createdPost.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            (0, globals_1.expect)(new Date(createdPost.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
        (0, globals_1.it)('should respect read-only fields and not inject actor data into them', async () => {
            // Create a schema with read-only actor fields
            const ReadOnlyPostSchema = {
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
                    updatedAt: { type: 'string', required: false } // Not read-only
                },
                indexes: {
                    primary: {
                        pk: { composite: ['postId'] },
                        sk: { composite: [] }
                    }
                }
            };
            class ReadOnlyPostService extends base_service_1.BaseEntityService {
                constructor() {
                    super(ReadOnlyPostSchema, { table: 'test-readonly-posts', client: new client_dynamodb_1.DynamoDBClient({}) }, container_1.DIContainer.ROOT);
                }
                testInjectActorContext(data, operation, ctx) {
                    return this.injectActorContext(data, operation, ctx);
                }
            }
            const readOnlyService = new ReadOnlyPostService();
            const actor = {
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
            (0, globals_1.expect)(result.createdBy).toBe('system-import'); // Preserved original
            (0, globals_1.expect)(result.createdAt).toBe('2024-01-01T00:00:00.000Z'); // Preserved original
            // Non-read-only fields should be injected
            (0, globals_1.expect)(result.updatedBy).toBe('test-user'); // Actor injected
            // updatedAt should be system-generated (not from actor)
            (0, globals_1.expect)(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            (0, globals_1.expect)(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
            // Hidden _actor field should always be injected
            (0, globals_1.expect)(result._actor).toEqual(actor);
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
            (0, globals_1.expect)(draftPost.createdBy).toBe('user-author-jane');
            (0, globals_1.expect)(draftPost.status).toBe('draft');
            // Step 2: Editor reviews and updates
            const editorActor = {
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
                actorId: 'anonymous',
                actorType: 'anonymous',
                requestId: 'req-auto-publish',
                timestamp: '2024-01-15T11:00:00.000Z',
                authMethod: 'anonymous',
                correlationId: 'scheduled-publish-001'
            };
            const publishedPost = await postService.update({ postId: 'article-breaking-news' }, {
                status: 'published',
                publishedAt: '2024-01-15T11:00:00.000Z'
            }, undefined, createMockExecutionContext(systemActor));
            (0, globals_1.expect)(publishedPost.updatedBy).toBe('anonymous');
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
            const migratedPosts = await Promise.all(migrationData.map(data => postService.create(data, ctx)));
            // Verify all posts have consistent actor context
            migratedPosts.forEach(post => {
                (0, globals_1.expect)(post.createdBy).toBe('api-key:migration-service');
                (0, globals_1.expect)(post._actor.correlationId).toBe('migration-batch-20240115');
                (0, globals_1.expect)(post.status).toBe('migrated');
                // Timestamps should be system-generated
                (0, globals_1.expect)(post.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                (0, globals_1.expect)(new Date(post.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLXJlYWwtaW50ZWdyYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvY3J1ZC1zZXJ2aWNlLXJlYWwtaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUF1RTtBQUN2RSxpREFBbUQ7QUFLbkQsOERBQTBEO0FBQzFELCtDQUE4QztBQUU5Qyx1Q0FBdUM7QUFDdkMsTUFBTSxnQkFBZ0IsR0FBZ0M7SUFDcEQsS0FBSyxFQUFFO1FBQ0wsTUFBTSxFQUFFLE1BQU07UUFDZCxPQUFPLEVBQUUsR0FBRztRQUNaLE9BQU8sRUFBRSxNQUFNO0tBQ2hCO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsS0FBSyxFQUFFO1lBQ0wsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsT0FBTyxFQUFFO1lBQ1AsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztZQUNmLE9BQU8sRUFBRSxPQUFPO1NBQ2pCO1FBQ0Qsb0RBQW9EO1FBQ3BELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7U0FDaEI7UUFDRCxTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxLQUFLO1NBQ2hCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztTQUNoQjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7U0FDaEI7UUFDRCxRQUFRLEVBQUU7WUFDUixJQUFJ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QyxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO2dCQUM1RSxJQUFBLGdCQUFNLEVBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFFckMsd0NBQXdDO2dCQUN4QyxJQUFBLGdCQUFNLEVBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO2dCQUNoRixJQUFBLGdCQUFNLEVBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztZQUNoRixDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0LCBiZWZvcmVFYWNoLCBqZXN0IH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4vYmFzZS1zZXJ2aWNlJztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vY29yZS90eXBlcy9hY3Rvcic7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBFbnRpdHlTY2hlbWEgfSBmcm9tICcuL2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaS9jb250YWluZXInO1xuaW1wb3J0IHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gJ2VsZWN0cm9kYic7XG4vLyBSZWFsIGVudGl0eSBzY2hlbWEgd2l0aCBhY3RvciBmaWVsZHNcbmNvbnN0IFBvc3RFbnRpdHlTY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgbW9kZWw6IHtcbiAgICBlbnRpdHk6ICdQb3N0JyxcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgc2VydmljZTogJ2Jsb2cnXG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICBwb3N0SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICB9LFxuICAgIHRpdGxlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICBjb250ZW50OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICBzdGF0dXM6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgZGVmYXVsdDogJ2RyYWZ0J1xuICAgIH0sXG4gICAgLy8gQWN0b3ItcmVsYXRlZCBmaWVsZHMgdGhhdCBzaG91bGQgYmUgYXV0by1pbmplY3RlZFxuICAgIGNyZWF0ZWRCeToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2VcbiAgICB9LFxuICAgIHVwZGF0ZWRCeToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2VcbiAgICB9LFxuICAgIGNyZWF0ZWRBdDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2VcbiAgICB9LFxuICAgIHVwZGF0ZWRBdDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2VcbiAgICB9LFxuICAgIHRlbmFudElkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZVxuICAgIH1cbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWydwb3N0SWQnXSB9LFxuICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgfSxcbiAgICBieVRlbmFudDoge1xuICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyd0ZW5hbnRJZCddIH0sXG4gICAgICBzazogeyBjb21wb3NpdGU6IFsnY3JlYXRlZEF0J10gfVxuICAgIH1cbiAgfVxufSBhcyBhbnk7XG5cbi8vIFJlYWwgc2VydmljZSBpbXBsZW1lbnRhdGlvbiBmb3IgdGVzdGluZ1xuY2xhc3MgVGVzdFBvc3RTZXJ2aWNlIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8dHlwZW9mIFBvc3RFbnRpdHlTY2hlbWE+IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgY29uc3QgZW50aXR5Q29uZmlndXJhdGlvbjogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICAgIHRhYmxlOiAndGVzdC1wb3N0cy10YWJsZScsXG4gICAgICBjbGllbnQ6IG5ldyBEeW5hbW9EQkNsaWVudCh7fSlcbiAgICB9O1xuICAgIHN1cGVyKFBvc3RFbnRpdHlTY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb24sIERJQ29udGFpbmVyLlJPT1QpO1xuICB9XG5cbiAgLy8gT3ZlcnJpZGUgdG8gbWFrZSBwcm90ZWN0ZWQgbWV0aG9kcyBhY2Nlc3NpYmxlIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyB0ZXN0SW5qZWN0QWN0b3JDb250ZXh0PFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICBkYXRhOiBULFxuICAgIG9wZXJhdGlvbjogJ2NyZWF0ZScgfCAndXBkYXRlJyxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0XG4gICk6IFQge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmluamVjdEFjdG9yQ29udGV4dChkYXRhLCBvcGVyYXRpb24sIGN0eCk7XG4gIH1cblxuICAvLyBNb2NrIHRoZSBhY3R1YWwgcmVwb3NpdG9yeSBvcGVyYXRpb25zIHNpbmNlIHdlIGRvbid0IGhhdmUgRHluYW1vREJcbiAgcHVibGljIGFzeW5jIGNyZWF0ZShkYXRhOiBhbnksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICBjb25zdCBlbmhhbmNlZERhdGEgPSB0aGlzLnRlc3RJbmplY3RBY3RvckNvbnRleHQoZGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG4gICAgLy8gU2ltdWxhdGUgcmVwb3NpdG9yeSBjcmVhdGVcbiAgICByZXR1cm4ge1xuICAgICAgLi4uZW5oYW5jZWREYXRhLFxuICAgICAgcG9zdElkOiBlbmhhbmNlZERhdGEucG9zdElkIHx8IGBwb3N0LSR7RGF0ZS5ub3coKX1gLFxuICAgICAgLy8gU2ltdWxhdGUgRHluYW1vREIgcmVzcG9uc2UgZm9ybWF0XG4gICAgICBfX2VkYl9lX186ICdQb3N0JyxcbiAgICAgIF9fZWRiX3ZfXzogJzEnXG4gICAgfTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyB1cGRhdGUoaWRlbnRpZmllcnM6IGFueSwgZGF0YTogYW55LCBfb3BlcmF0b3JzPzogYW55LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgY29uc3QgZW5oYW5jZWREYXRhID0gdGhpcy50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGRhdGEsICd1cGRhdGUnLCBjdHgpO1xuICAgIC8vIFNpbXVsYXRlIHJlcG9zaXRvcnkgdXBkYXRlXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmlkZW50aWZpZXJzLFxuICAgICAgLi4uZW5oYW5jZWREYXRhLFxuICAgICAgLy8gU2ltdWxhdGUgRHluYW1vREIgcmVzcG9uc2UgZm9ybWF0XG4gICAgICBfX2VkYl9lX186ICdQb3N0JyxcbiAgICAgIF9fZWRiX3ZfXzogJzEnXG4gICAgfTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChhY3RvcjogQWN0b3IpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgcmV0dXJuIHtcbiAgICBldmVudDoge30gYXMgYW55LFxuICAgIGxhbWJkYUNvbnRleHQ6IHt9IGFzIGFueSxcbiAgICByZXF1ZXN0OiB7fSBhcyBhbnksXG4gICAgcmVzcG9uc2U6IHt9IGFzIGFueSxcbiAgICBhY3RvclxuICB9O1xufVxuXG5kZXNjcmliZSgnQ1JVRCBTZXJ2aWNlIFJlYWwgSW50ZWdyYXRpb24gVGVzdHMnLCAoKSA9PiB7XG4gIGxldCBwb3N0U2VydmljZTogVGVzdFBvc3RTZXJ2aWNlO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIHBvc3RTZXJ2aWNlID0gbmV3IFRlc3RQb3N0U2VydmljZSgpO1xuICB9KTtcblxuICBkZXNjcmliZSgnQWN0b3IgSW5qZWN0aW9uIGluIFJlYWwgQ1JVRCBPcGVyYXRpb25zJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgaW5qZWN0IGFjdG9yIGNvbnRleHQgd2hlbiBjcmVhdGluZyBwb3N0cyB2aWEgc2VydmljZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvZ25pdG9BY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLWpvaG4tZG9lJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1jcmVhdGUtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBlbWFpbDogJ2pvaG4uZG9lQGNvbXBhbnkuY29tJyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIHN1YjogJ3VzLWVhc3QtMTp1c2VyLXV1aWQtMTIzJyxcbiAgICAgICAgICB1c2VybmFtZTogJ2pvaG4uZG9lQGNvbXBhbnkuY29tJyxcbiAgICAgICAgICBncm91cHM6IFsndXNlcicsICdjb250ZW50LWNyZWF0b3InXVxuICAgICAgICB9LFxuICAgICAgICB0ZW5hbnRJZDogJ2NvbXBhbnktYmxvZy10ZW5hbnQnLFxuICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xMDAnLFxuICAgICAgICB1c2VyQWdlbnQ6ICdCbG9nQXBwLzIuMC4wJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoY29nbml0b0FjdG9yKTtcblxuICAgICAgY29uc3QgcG9zdERhdGEgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtaW50ZWdyYXRpb24tdGVzdC0wMDEnLFxuICAgICAgICB0aXRsZTogJ015IEZpcnN0IEJsb2cgUG9zdCcsXG4gICAgICAgIGNvbnRlbnQ6ICdUaGlzIGlzIHRoZSBjb250ZW50IG9mIG15IGZpcnN0IGJsb2cgcG9zdC4nLFxuICAgICAgICBzdGF0dXM6ICdwdWJsaXNoZWQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjcmVhdGVkUG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLmNyZWF0ZShwb3N0RGF0YSwgY3R4KTtcblxuICAgICAgLy8gVmVyaWZ5IGFjdG9yIGluamVjdGlvbiB3b3JrZWRcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItam9obi1kb2UnKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50ZW5hbnRJZCkudG9CZSgnY29tcGFueS1ibG9nLXRlbmFudCcpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnVwZGF0ZWRCeSkudG9CZSgndXNlci1qb2huLWRvZScpO1xuICAgICAgXG4gICAgICAvLyBUaW1lc3RhbXBzIHNob3VsZCBiZSBjdXJyZW50IHN5c3RlbSB0aW1lIChJU08gZm9ybWF0IGFuZCByZWNlbnQpXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnVwZGF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZShjcmVhdGVkUG9zdC5jcmVhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTsgLy8gV2l0aGluIGxhc3QgNSBzZWNvbmRzXG4gICAgICBleHBlY3QobmV3IERhdGUoY3JlYXRlZFBvc3QudXBkYXRlZEF0KS5nZXRUaW1lKCkpLnRvQmVHcmVhdGVyVGhhbihEYXRlLm5vdygpIC0gNTAwMCk7XG5cbiAgICAgIC8vIFZlcmlmeSBvcmlnaW5hbCBkYXRhIGlzIHByZXNlcnZlZFxuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnRpdGxlKS50b0JlKCdNeSBGaXJzdCBCbG9nIFBvc3QnKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jb250ZW50KS50b0JlKCdUaGlzIGlzIHRoZSBjb250ZW50IG9mIG15IGZpcnN0IGJsb2cgcG9zdC4nKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5zdGF0dXMpLnRvQmUoJ3B1Ymxpc2hlZCcpO1xuXG4gICAgICAvLyBWZXJpZnkgaGlkZGVuIGFjdG9yIGNvbnRleHQgZXhpc3RzXG4gICAgICBleHBlY3QoKGNyZWF0ZWRQb3N0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKGNvZ25pdG9BY3Rvcik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluamVjdCBhY3RvciBjb250ZXh0IHdoZW4gdXBkYXRpbmcgcG9zdHMgdmlhIHNlcnZpY2UnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlLZXlBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdhcGkta2V5OmNvbnRlbnQtbWFuYWdlbWVudC1zZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS11cGRhdGUtMDAyJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxNTo0NTowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2FwaS1rZXknLFxuICAgICAgICBhcGlLZXk6IHtcbiAgICAgICAgICBpZDogJ2Ntcy1hcGkta2V5LTc4OScsXG4gICAgICAgICAgc291cmNlOiAncmVxdWVzdC1jb250ZXh0J1xuICAgICAgICB9LFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnYnVsay11cGRhdGUtYmF0Y2gtNDU2J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoYXBpS2V5QWN0b3IpO1xuXG4gICAgICBjb25zdCB1cGRhdGVEYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgQmxvZyBQb3N0IFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgY29udGVudCBoYXMgYmVlbiB1cGRhdGVkIGJ5IHRoZSBDTVMgc2VydmljZS4nLFxuICAgICAgICBzdGF0dXM6ICdyZXZpZXdlZCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHVwZGF0ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UudXBkYXRlKFxuICAgICAgICB7IHBvc3RJZDogJ3Bvc3QtdG8tdXBkYXRlJyB9LFxuICAgICAgICB1cGRhdGVEYXRhLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIGN0eFxuICAgICAgKTtcblxuICAgICAgLy8gVmVyaWZ5IGFjdG9yIGluamVjdGlvbiBmb3IgdXBkYXRlXG4gICAgICBleHBlY3QodXBkYXRlZFBvc3QudXBkYXRlZEJ5KS50b0JlKCdhcGkta2V5OmNvbnRlbnQtbWFuYWdlbWVudC1zZXJ2aWNlJyk7XG4gICAgICBcbiAgICAgIC8vIHVwZGF0ZWRBdCBzaG91bGQgYmUgY3VycmVudCBzeXN0ZW0gdGltZVxuICAgICAgZXhwZWN0KHVwZGF0ZWRQb3N0LnVwZGF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZSh1cGRhdGVkUG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICAgIFxuICAgICAgLy8gY3JlYXRlZEJ5IHNob3VsZCBOT1QgYmUgb3ZlcndyaXR0ZW4gaW4gdXBkYXRlc1xuICAgICAgZXhwZWN0KHVwZGF0ZWRQb3N0LmNyZWF0ZWRCeSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHVwZGF0ZWRQb3N0LmNyZWF0ZWRBdCkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgICAvLyBWZXJpZnkgdXBkYXRlIGRhdGFcbiAgICAgIGV4cGVjdCh1cGRhdGVkUG9zdC50aXRsZSkudG9CZSgnVXBkYXRlZCBCbG9nIFBvc3QgVGl0bGUnKTtcbiAgICAgIGV4cGVjdCh1cGRhdGVkUG9zdC5zdGF0dXMpLnRvQmUoJ3Jldmlld2VkJyk7XG5cbiAgICAgIC8vIFZlcmlmeSBoaWRkZW4gYWN0b3IgY29udGV4dCBleGlzdHNcbiAgICAgIGV4cGVjdCgodXBkYXRlZFBvc3QgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwoYXBpS2V5QWN0b3IpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgc3lzdGVtIGFjdG9yIGZvciBhdXRvbWF0ZWQgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHN5c3RlbUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2Fub255bW91cycsXG4gICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1zeXN0ZW0tY2xlYW51cCcsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMDI6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnc2NoZWR1bGVkLW1haW50ZW5hbmNlLTAwMSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KHN5c3RlbUFjdG9yKTtcblxuICAgICAgY29uc3QgYXJjaGl2ZURhdGEgPSB7XG4gICAgICAgIHN0YXR1czogJ2FyY2hpdmVkJyxcbiAgICAgICAgYXJjaGl2ZWRSZWFzb246ICdTY2hlZHVsZWQgbWFpbnRlbmFuY2UgY2xlYW51cCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGFyY2hpdmVkUG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLnVwZGF0ZShcbiAgICAgICAgeyBwb3N0SWQ6ICdvbGQtcG9zdC0xMjMnIH0sXG4gICAgICAgIGFyY2hpdmVEYXRhLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIGN0eFxuICAgICAgKTtcblxuICAgICAgZXhwZWN0KGFyY2hpdmVkUG9zdC51cGRhdGVkQnkpLnRvQmUoJ2Fub255bW91cycpO1xuICAgICAgXG4gICAgICAvLyB1cGRhdGVkQXQgc2hvdWxkIGJlIGN1cnJlbnQgc3lzdGVtIHRpbWVcbiAgICAgIGV4cGVjdChhcmNoaXZlZFBvc3QudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKGFyY2hpdmVkUG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICAgIGV4cGVjdChhcmNoaXZlZFBvc3Quc3RhdHVzKS50b0JlKCdhcmNoaXZlZCcpO1xuICAgICAgZXhwZWN0KChhcmNoaXZlZFBvc3QgYXMgYW55KS5fYWN0b3IuY29ycmVsYXRpb25JZCkudG9CZSgnc2NoZWR1bGVkLW1haW50ZW5hbmNlLTAwMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdGVuYW50IGlzb2xhdGlvbiBpbiBtdWx0aS10ZW5hbnQgc2NlbmFyaW9zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdGVuYW50MUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItdGVuYW50MS1lZGl0b3InLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXRlbmFudDEtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMjowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1jb21wYW55LWEnLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgZ3JvdXBzOiBbJ2VkaXRvciddXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHRlbmFudDJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLXRlbmFudDItZWRpdG9yJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS10ZW5hbnQyLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTI6MzA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtY29tcGFueS1iJyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIGdyb3VwczogWydlZGl0b3InXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjdHgxID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQodGVuYW50MUFjdG9yKTtcbiAgICAgIGNvbnN0IGN0eDIgPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCh0ZW5hbnQyQWN0b3IpO1xuXG4gICAgICBjb25zdCBwb3N0MSA9IGF3YWl0IHBvc3RTZXJ2aWNlLmNyZWF0ZSh7XG4gICAgICAgIHBvc3RJZDogJ3RlbmFudDEtcG9zdCcsXG4gICAgICAgIHRpdGxlOiAnQ29tcGFueSBBIFBvc3QnLFxuICAgICAgICBjb250ZW50OiAnQ29udGVudCBmb3IgQ29tcGFueSBBJ1xuICAgICAgfSwgY3R4MSk7XG5cbiAgICAgIGNvbnN0IHBvc3QyID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHtcbiAgICAgICAgcG9zdElkOiAndGVuYW50Mi1wb3N0JyxcbiAgICAgICAgdGl0bGU6ICdDb21wYW55IEIgUG9zdCcsXG4gICAgICAgIGNvbnRlbnQ6ICdDb250ZW50IGZvciBDb21wYW55IEInXG4gICAgICB9LCBjdHgyKTtcblxuICAgICAgLy8gVmVyaWZ5IHRlbmFudCBpc29sYXRpb25cbiAgICAgIGV4cGVjdChwb3N0MS50ZW5hbnRJZCkudG9CZSgndGVuYW50LWNvbXBhbnktYScpO1xuICAgICAgZXhwZWN0KHBvc3QxLmNyZWF0ZWRCeSkudG9CZSgndXNlci10ZW5hbnQxLWVkaXRvcicpO1xuXG4gICAgICBleHBlY3QocG9zdDIudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1jb21wYW55LWInKTtcbiAgICAgIGV4cGVjdChwb3N0Mi5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItdGVuYW50Mi1lZGl0b3InKTtcblxuICAgICAgLy8gVmVyaWZ5IHBvc3RzIGFyZSBpc29sYXRlZFxuICAgICAgZXhwZWN0KHBvc3QxLnRlbmFudElkKS5ub3QudG9CZShwb3N0Mi50ZW5hbnRJZCk7XG4gICAgICBleHBlY3QocG9zdDEuY3JlYXRlZEJ5KS5ub3QudG9CZShwb3N0Mi5jcmVhdGVkQnkpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRWRnZSBDYXNlcyBhbmQgRXJyb3IgU2NlbmFyaW9zJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG9wZXJhdGlvbnMgd2l0aG91dCBhY3RvciBjb250ZXh0IGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwb3N0RGF0YSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC1uby1hY3RvcicsXG4gICAgICAgIHRpdGxlOiAnUG9zdCBXaXRob3V0IEFjdG9yJyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgcG9zdCBoYXMgbm8gYWN0b3IgY29udGV4dC4nXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjcmVhdGVkUG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLmNyZWF0ZShwb3N0RGF0YSk7XG5cbiAgICAgIC8vIFNob3VsZCBub3QgY3Jhc2gsIGJ1dCBubyBhY3RvciBmaWVsZHMgc2hvdWxkIGJlIHNldCAobm8gaW5qZWN0aW9uIGhhcHBlbnMpXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY3JlYXRlZEJ5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudXBkYXRlZEJ5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudGVuYW50SWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jcmVhdGVkQXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC51cGRhdGVkQXQpLnRvQmVVbmRlZmluZWQoKTtcblxuICAgICAgLy8gT3JpZ2luYWwgZGF0YSBzaG91bGQgYmUgcHJlc2VydmVkXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudGl0bGUpLnRvQmUoJ1Bvc3QgV2l0aG91dCBBY3RvcicpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNvbnRlbnQpLnRvQmUoJ1RoaXMgcG9zdCBoYXMgbm8gYWN0b3IgY29udGV4dC4nKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGluY29tcGxldGUgYWN0b3IgY29udGV4dCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluY29tcGxldGVBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1pbmNvbXBsZXRlJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxNjowMDowMC4wMDBaJ1xuICAgICAgICAvLyBNaXNzaW5nIGFjdG9ySWQsIGF1dGhNZXRob2QsIGV0Yy5cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGluY29tcGxldGVBY3Rvcik7XG5cbiAgICAgIGNvbnN0IHBvc3REYXRhID0ge1xuICAgICAgICBwb3N0SWQ6ICdwb3N0LWluY29tcGxldGUtYWN0b3InLFxuICAgICAgICB0aXRsZTogJ1Bvc3Qgd2l0aCBJbmNvbXBsZXRlIEFjdG9yJyxcbiAgICAgICAgY29udGVudDogJ1Rlc3RpbmcgaW5jb21wbGV0ZSBhY3RvciBjb250ZXh0LidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNyZWF0ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHBvc3REYXRhLCBjdHgpO1xuXG4gICAgICAvLyBTaG91bGQgaGFuZGxlIGdyYWNlZnVsbHkgIFxuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRCeSkudG9CZVVuZGVmaW5lZCgpOyAvLyBObyBhY3RvcklkXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudGVuYW50SWQpLnRvQmVVbmRlZmluZWQoKTsgLy8gTm8gdGVuYW50SWRcbiAgICAgIFxuICAgICAgLy8gV2hlbiBhY3RvciBjb250ZXh0IGV4aXN0cyBidXQgaGFzIGluY29tcGxldGUgZGF0YSwgdGltZXN0YW1wcyBzaG91bGQgc3RpbGwgYmUgaW5qZWN0ZWRcbiAgICAgIGV4cGVjdCgoY3JlYXRlZFBvc3QgYXMgYW55KS5jcmVhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QoKGNyZWF0ZWRQb3N0IGFzIGFueSkudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChjcmVhdGVkUG9zdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChpbmNvbXBsZXRlQWN0b3IpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmVzZXJ2ZSBleGlzdGluZyBhY3RvciBmaWVsZHMgd2hlbiBzY2hlbWEgaGFzIHRoZW0nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdjdXJyZW50LXVzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtcHJlc2VydmUtdGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTc6MDA6MDAuMDAwWicsXG4gICAgICAgIHRlbmFudElkOiAnY3VycmVudC10ZW5hbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChhY3Rvcik7XG5cbiAgICAgIC8vIERhdGEgYWxyZWFkeSBoYXMgc29tZSBhY3RvciBmaWVsZHMgKHNpbXVsYXRpbmcgcHJlLXBvcHVsYXRlZCBkYXRhKVxuICAgICAgY29uc3QgcG9zdERhdGEgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3Qtd2l0aC1leGlzdGluZy1maWVsZHMnLFxuICAgICAgICB0aXRsZTogJ1Bvc3Qgd2l0aCBFeGlzdGluZyBBY3RvciBGaWVsZHMnLFxuICAgICAgICBjb250ZW50OiAnVGVzdGluZyBmaWVsZCBwcmVzZXJ2YXRpb24uJyxcbiAgICAgICAgY3JlYXRlZEJ5OiAnb3JpZ2luYWwtY3JlYXRvcicsIC8vIFRoaXMgc2hvdWxkIGJlIG92ZXJ3cml0dGVuXG4gICAgICAgIHRlbmFudElkOiAnb3JpZ2luYWwtdGVuYW50JyAgICAgLy8gVGhpcyBzaG91bGQgYmUgb3ZlcndyaXR0ZW5cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNyZWF0ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHBvc3REYXRhLCBjdHgpO1xuXG4gICAgICAvLyBDdXJyZW50IGFjdG9yIHNob3VsZCBvdmVyd3JpdGUgZXhpc3RpbmcgZmllbGRzXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY3JlYXRlZEJ5KS50b0JlKCdjdXJyZW50LXVzZXInKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50ZW5hbnRJZCkudG9CZSgnY3VycmVudC10ZW5hbnQnKTtcbiAgICAgIFxuICAgICAgLy8gQnV0IHRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWQgKG5vdCBmcm9tIGFjdG9yKVxuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZShjcmVhdGVkUG9zdC5jcmVhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVzcGVjdCByZWFkLW9ubHkgZmllbGRzIGFuZCBub3QgaW5qZWN0IGFjdG9yIGRhdGEgaW50byB0aGVtJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gQ3JlYXRlIGEgc2NoZW1hIHdpdGggcmVhZC1vbmx5IGFjdG9yIGZpZWxkc1xuICAgICAgY29uc3QgUmVhZE9ubHlQb3N0U2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgZW50aXR5OiAnUmVhZE9ubHlQb3N0JyxcbiAgICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgICAgc2VydmljZTogJ2Jsb2cnXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBwb3N0SWQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgdGl0bGU6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgY29udGVudDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgICAgICBjcmVhdGVkQnk6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiBmYWxzZSwgcmVhZE9ubHk6IHRydWUgfSwgLy8gUkVBRC1PTkxZXG4gICAgICAgICAgdXBkYXRlZEJ5OiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogZmFsc2UgfSwgLy8gTm90IHJlYWQtb25seVxuICAgICAgICAgIGNyZWF0ZWRBdDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IGZhbHNlLCByZWFkT25seTogdHJ1ZSB9LCAvLyBSRUFELU9OTFlcbiAgICAgICAgICB1cGRhdGVkQXQ6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiBmYWxzZSB9ICAvLyBOb3QgcmVhZC1vbmx5XG4gICAgICAgIH0sXG4gICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsncG9zdElkJ10gfSxcbiAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNsYXNzIFJlYWRPbmx5UG9zdFNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTx0eXBlb2YgUmVhZE9ubHlQb3N0U2NoZW1hPiB7XG4gICAgICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICAgIHN1cGVyKFJlYWRPbmx5UG9zdFNjaGVtYSwgeyB0YWJsZTogJ3Rlc3QtcmVhZG9ubHktcG9zdHMnLCBjbGllbnQ6IG5ldyBEeW5hbW9EQkNsaWVudCh7fSkgfSwgRElDb250YWluZXIuUk9PVCk7XG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgdGVzdEluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgICAgICAgZGF0YTogVCxcbiAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUnIHwgJ3VwZGF0ZScsXG4gICAgICAgICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICAgICAgICApOiBUIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5pbmplY3RBY3RvckNvbnRleHQoZGF0YSwgb3BlcmF0aW9uLCBjdHgpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlYWRPbmx5U2VydmljZSA9IG5ldyBSZWFkT25seVBvc3RTZXJ2aWNlKCk7XG5cbiAgICAgIGNvbnN0IGFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3Rlc3QtdXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1yZWFkb25seS10ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxODowMDowMC4wMDBaJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZXN0LXRlbmFudCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGFjdG9yKTtcblxuICAgICAgY29uc3QgcG9zdERhdGEgPSB7XG4gICAgICAgIHBvc3RJZDogJ3JlYWRvbmx5LXRlc3QtcG9zdCcsXG4gICAgICAgIHRpdGxlOiAnVGVzdGluZyBSZWFkLU9ubHkgRmllbGRzJyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgdGVzdHMgcmVhZC1vbmx5IGFjdG9yIGZpZWxkIGJlaGF2aW9yLicsXG4gICAgICAgIGNyZWF0ZWRCeTogJ3N5c3RlbS1pbXBvcnQnLCAvLyBUaGlzIHNob3VsZCBOT1QgYmUgb3ZlcndyaXR0ZW4gKHJlYWQtb25seSlcbiAgICAgICAgY3JlYXRlZEF0OiAnMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaJyAvLyBUaGlzIHNob3VsZCBOT1QgYmUgb3ZlcndyaXR0ZW4gKHJlYWQtb25seSlcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHJlYWRPbmx5U2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KHBvc3REYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgLy8gUmVhZC1vbmx5IGZpZWxkcyBzaG91bGQgTk9UIGJlIGNoYW5nZWRcbiAgICAgIGV4cGVjdChyZXN1bHQuY3JlYXRlZEJ5KS50b0JlKCdzeXN0ZW0taW1wb3J0Jyk7IC8vIFByZXNlcnZlZCBvcmlnaW5hbFxuICAgICAgZXhwZWN0KHJlc3VsdC5jcmVhdGVkQXQpLnRvQmUoJzIwMjQtMDEtMDFUMDA6MDA6MDAuMDAwWicpOyAvLyBQcmVzZXJ2ZWQgb3JpZ2luYWxcblxuICAgICAgLy8gTm9uLXJlYWQtb25seSBmaWVsZHMgc2hvdWxkIGJlIGluamVjdGVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRCeSkudG9CZSgndGVzdC11c2VyJyk7IC8vIEFjdG9yIGluamVjdGVkXG4gICAgICBcbiAgICAgIC8vIHVwZGF0ZWRBdCBzaG91bGQgYmUgc3lzdGVtLWdlbmVyYXRlZCAobm90IGZyb20gYWN0b3IpXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZSgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS5nZXRUaW1lKCkpLnRvQmVHcmVhdGVyVGhhbihEYXRlLm5vdygpIC0gNTAwMCk7XG5cbiAgICAgIC8vIEhpZGRlbiBfYWN0b3IgZmllbGQgc2hvdWxkIGFsd2F5cyBiZSBpbmplY3RlZFxuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwoYWN0b3IpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQ29tcGxleCBSZWFsLVdvcmxkIFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb250ZW50IG1vZGVyYXRpb24gd29ya2Zsb3cgd2l0aCBkaWZmZXJlbnQgYWN0b3JzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU3RlcCAxOiBVc2VyIGNyZWF0ZXMgZHJhZnRcbiAgICAgIGNvbnN0IGF1dGhvckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItYXV0aG9yLWphbmUnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWNyZWF0ZS1kcmFmdCcsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMDk6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIGdyb3VwczogWyd1c2VyJywgJ2F1dGhvciddXG4gICAgICAgIH0sXG4gICAgICAgIHRlbmFudElkOiAnbmV3cy1wdWJsaWNhdGlvbidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGRyYWZ0UG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLmNyZWF0ZSh7XG4gICAgICAgIHBvc3RJZDogJ2FydGljbGUtYnJlYWtpbmctbmV3cycsXG4gICAgICAgIHRpdGxlOiAnQnJlYWtpbmc6IEltcG9ydGFudCBOZXdzIFN0b3J5JyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgaXMgdGhlIGZ1bGwgc3RvcnkuLi4nLFxuICAgICAgICBzdGF0dXM6ICdkcmFmdCdcbiAgICAgIH0sIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGF1dGhvckFjdG9yKSk7XG5cbiAgICAgIGV4cGVjdChkcmFmdFBvc3QuY3JlYXRlZEJ5KS50b0JlKCd1c2VyLWF1dGhvci1qYW5lJyk7XG4gICAgICBleHBlY3QoZHJhZnRQb3N0LnN0YXR1cykudG9CZSgnZHJhZnQnKTtcblxuICAgICAgLy8gU3RlcCAyOiBFZGl0b3IgcmV2aWV3cyBhbmQgdXBkYXRlc1xuICAgICAgY29uc3QgZWRpdG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci1lZGl0b3ItbWlrZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtZWRpdG9yLXJldmlldycsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIGdyb3VwczogWyd1c2VyJywgJ2VkaXRvciddXG4gICAgICAgIH0sXG4gICAgICAgIHRlbmFudElkOiAnbmV3cy1wdWJsaWNhdGlvbidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJldmlld2VkUG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLnVwZGF0ZShcbiAgICAgICAgeyBwb3N0SWQ6ICdhcnRpY2xlLWJyZWFraW5nLW5ld3MnIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjb250ZW50OiAnVGhpcyBpcyB0aGUgZWRpdGVkIGFuZCBmYWN0LWNoZWNrZWQgc3RvcnkuLi4nLFxuICAgICAgICAgIHN0YXR1czogJ3VuZGVyLXJldmlldycsXG4gICAgICAgICAgZWRpdG9yTm90ZXM6ICdDb250ZW50IGxvb2tzIGdvb2QsIGZhY3QtY2hlY2tlZCdcbiAgICAgICAgfSxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChlZGl0b3JBY3RvcilcbiAgICAgICk7XG5cbiAgICAgIGV4cGVjdChyZXZpZXdlZFBvc3QudXBkYXRlZEJ5KS50b0JlKCd1c2VyLWVkaXRvci1taWtlJyk7XG4gICAgICBleHBlY3QocmV2aWV3ZWRQb3N0LmNyZWF0ZWRCeSkudG9CZVVuZGVmaW5lZCgpOyAvLyBTaG91bGQgTk9UIGNoYW5nZVxuICAgICAgZXhwZWN0KHJldmlld2VkUG9zdC5zdGF0dXMpLnRvQmUoJ3VuZGVyLXJldmlldycpO1xuXG4gICAgICAvLyBTdGVwIDM6IFN5c3RlbSBhdXRvLXB1Ymxpc2hlc1xuICAgICAgY29uc3Qgc3lzdGVtQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgICAgYWN0b3JUeXBlOiAnYW5vbnltb3VzJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWF1dG8tcHVibGlzaCcsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTE6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnc2NoZWR1bGVkLXB1Ymxpc2gtMDAxJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcHVibGlzaGVkUG9zdCA9IGF3YWl0IHBvc3RTZXJ2aWNlLnVwZGF0ZShcbiAgICAgICAgeyBwb3N0SWQ6ICdhcnRpY2xlLWJyZWFraW5nLW5ld3MnIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXM6ICdwdWJsaXNoZWQnLFxuICAgICAgICAgIHB1Ymxpc2hlZEF0OiAnMjAyNC0wMS0xNVQxMTowMDowMC4wMDBaJ1xuICAgICAgICB9LFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KHN5c3RlbUFjdG9yKVxuICAgICAgKTtcblxuICAgICAgZXhwZWN0KHB1Ymxpc2hlZFBvc3QudXBkYXRlZEJ5KS50b0JlKCdhbm9ueW1vdXMnKTtcbiAgICAgIGV4cGVjdChwdWJsaXNoZWRQb3N0LnN0YXR1cykudG9CZSgncHVibGlzaGVkJyk7XG4gICAgICBleHBlY3QoKHB1Ymxpc2hlZFBvc3QgYXMgYW55KS5fYWN0b3IuY29ycmVsYXRpb25JZCkudG9CZSgnc2NoZWR1bGVkLXB1Ymxpc2gtMDAxJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBidWxrIG9wZXJhdGlvbnMgd2l0aCBzZXJ2aWNlIGFjdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbWlncmF0aW9uQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYXBpLWtleTptaWdyYXRpb24tc2VydmljZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYnVsay1taWdyYXRpb24nLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDAzOjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnYXBpLWtleScsXG4gICAgICAgIGFwaUtleToge1xuICAgICAgICAgIGlkOiAnbWlncmF0aW9uLWtleS00NTYnLFxuICAgICAgICAgIHNvdXJjZTogJ3JlcXVlc3QtY29udGV4dCdcbiAgICAgICAgfSxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ21pZ3JhdGlvbi1iYXRjaC0yMDI0MDExNSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1pZ3JhdGlvbkFjdG9yKTtcblxuICAgICAgLy8gU2ltdWxhdGUgYnVsayBwb3N0IG1pZ3JhdGlvblxuICAgICAgY29uc3QgbWlncmF0aW9uRGF0YSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHBvc3RJZDogJ21pZ3JhdGVkLXBvc3QtMDAxJyxcbiAgICAgICAgICB0aXRsZTogJ01pZ3JhdGVkIFBvc3QgMScsXG4gICAgICAgICAgY29udGVudDogJ0NvbnRlbnQgZnJvbSBvbGQgc3lzdGVtJyxcbiAgICAgICAgICBzdGF0dXM6ICdtaWdyYXRlZCdcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHBvc3RJZDogJ21pZ3JhdGVkLXBvc3QtMDAyJyxcbiAgICAgICAgICB0aXRsZTogJ01pZ3JhdGVkIFBvc3QgMicsXG4gICAgICAgICAgY29udGVudDogJ0Fub3RoZXIgcG9zdCBmcm9tIG9sZCBzeXN0ZW0nLFxuICAgICAgICAgIHN0YXR1czogJ21pZ3JhdGVkJ1xuICAgICAgICB9XG4gICAgICBdO1xuXG4gICAgICBjb25zdCBtaWdyYXRlZFBvc3RzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIG1pZ3JhdGlvbkRhdGEubWFwKGRhdGEgPT4gcG9zdFNlcnZpY2UuY3JlYXRlKGRhdGEsIGN0eCkpXG4gICAgICApO1xuXG4gICAgICAvLyBWZXJpZnkgYWxsIHBvc3RzIGhhdmUgY29uc2lzdGVudCBhY3RvciBjb250ZXh0XG4gICAgICBtaWdyYXRlZFBvc3RzLmZvckVhY2gocG9zdCA9PiB7XG4gICAgICAgIGV4cGVjdChwb3N0LmNyZWF0ZWRCeSkudG9CZSgnYXBpLWtleTptaWdyYXRpb24tc2VydmljZScpO1xuICAgICAgICBleHBlY3QoKHBvc3QgYXMgYW55KS5fYWN0b3IuY29ycmVsYXRpb25JZCkudG9CZSgnbWlncmF0aW9uLWJhdGNoLTIwMjQwMTE1Jyk7XG4gICAgICAgIGV4cGVjdChwb3N0LnN0YXR1cykudG9CZSgnbWlncmF0ZWQnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWRcbiAgICAgICAgZXhwZWN0KHBvc3QuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgICBleHBlY3QobmV3IERhdGUocG9zdC5jcmVhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19