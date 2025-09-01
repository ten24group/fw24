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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLXJlYWwtaW50ZWdyYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvY3J1ZC1zZXJ2aWNlLXJlYWwtaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUF1RTtBQUN2RSxpREFBbUQ7QUFLbkQsOERBQTBEO0FBQzFELCtDQUE4QztBQUU5Qyx1Q0FBdUM7QUFDdkMsTUFBTSxnQkFBZ0IsR0FBZ0M7SUFDcEQsS0FBSyxFQUFFO1FBQ0wsTUFBTSxFQUFFLE1BQU07UUFDZCxPQUFPLEVBQUUsR0FBRztRQUNaLE9BQU8sRUFBRSxNQUFNO0tBQ2hCO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsS0FBSyxFQUFFO1lBQ0wsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsT0FBTyxFQUFFO1lBQ1AsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztZQUNmLE9BQU8sRUFBRSxPQUFPO1NBQ2pCO1FBQ0Qsb0RBQW9EO1FBQ3BELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7U0FDaEI7UUFDRCxTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxLQUFLO1NBQ2hCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztTQUNoQjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7U0FDaEI7UUFDRCxRQUFRLEVBQUU7WUFDUixJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxLQUFLO1NBQ2hCO0tBQ0Y7SUFDRCxPQUFPLEVBQUU7UUFDUCxPQUFPLEVBQUU7WUFDUCxFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRTtZQUM3QixFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFO1NBQ3RCO1FBQ0QsUUFBUSxFQUFFO1lBQ1IsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsQ0FBQyxVQUFVLENBQUMsRUFBRTtZQUMvQixFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsQ0FBQyxXQUFXLENBQUMsRUFBRTtTQUNqQztLQUNGO0NBQ0ssQ0FBQztBQUVULDBDQUEwQztBQUMxQyxNQUFNLGVBQWdCLFNBQVEsZ0NBQTBDO0lBQ3RFO1FBQ0UsTUFBTSxtQkFBbUIsR0FBd0I7WUFDL0MsS0FBSyxFQUFFLGtCQUFrQjtZQUN6QixNQUFNLEVBQUUsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQztTQUMvQixDQUFDO1FBQ0YsS0FBSyxDQUFDLGdCQUFnQixFQUFFLG1CQUFtQixFQUFFLHVCQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDakUsQ0FBQztJQUVELDREQUE0RDtJQUNyRCxzQkFBc0IsQ0FDM0IsSUFBTyxFQUNQLFNBQThCLEVBQzlCLEdBQXNCO1FBRXRCLE9BQVEsSUFBWSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxTQUFTLEVBQUUsR0FBRyxDQUFDLENBQUM7SUFDaEUsQ0FBQztJQUVELHFFQUFxRTtJQUM5RCxLQUFLLENBQUMsTUFBTSxDQUFDLElBQVMsRUFBRSxHQUFzQjtRQUNuRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUN0RSw2QkFBNkI7UUFDN0IsT0FBTztZQUNMLEdBQUcsWUFBWTtZQUNmLE1BQU0sRUFBRSxZQUFZLENBQUMsTUFBTSxJQUFJLFFBQVEsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ25ELG9DQUFvQztZQUNwQyxTQUFTLEVBQUUsTUFBTTtZQUNqQixTQUFTLEVBQUUsR0FBRztTQUNmLENBQUM7SUFDSixDQUFDO0lBRU0sS0FBSyxDQUFDLE1BQU0sQ0FBQyxXQUFnQixFQUFFLElBQVMsRUFBRSxVQUFnQixFQUFFLEdBQXNCO1FBQ3ZGLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3RFLDZCQUE2QjtRQUM3QixPQUFPO1lBQ0wsR0FBRyxXQUFXO1lBQ2QsR0FBRyxZQUFZO1lBQ2Ysb0NBQW9DO1lBQ3BDLFNBQVMsRUFBRSxNQUFNO1lBQ2pCLFNBQVMsRUFBRSxHQUFHO1NBQ2YsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQUVELFNBQVMsMEJBQTBCLENBQUMsS0FBWTtJQUM5QyxPQUFPO1FBQ0wsS0FBSyxFQUFFLEVBQVM7UUFDaEIsYUFBYSxFQUFFLEVBQVM7UUFDeEIsT0FBTyxFQUFFLEVBQVM7UUFDbEIsUUFBUSxFQUFFLEVBQVM7UUFDbkIsS0FBSztLQUNOLENBQUM7QUFDSixDQUFDO0FBRUQsSUFBQSxrQkFBUSxFQUFDLHFDQUFxQyxFQUFFLEdBQUcsRUFBRTtJQUNuRCxJQUFJLFdBQTRCLENBQUM7SUFFakMsSUFBQSxvQkFBVSxFQUFDLEdBQUcsRUFBRTtRQUNkLFdBQVcsR0FBRyxJQUFJLGVBQWUsRUFBRSxDQUFDO0lBQ3RDLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLHlDQUF5QyxFQUFFLEdBQUcsRUFBRTtRQUV2RCxJQUFBLFlBQUUsRUFBQyw2REFBNkQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMzRSxNQUFNLFlBQVksR0FBVTtnQkFDMUIsT0FBTyxFQUFFLGVBQWU7Z0JBQ3hCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixTQUFTLEVBQUUsZ0JBQWdCO2dCQUMzQixTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxVQUFVLEVBQUUsU0FBUztnQkFDckIsS0FBSyxFQUFFLHNCQUFzQjtnQkFDN0IsT0FBTyxFQUFFO29CQUNQLEdBQUcsRUFBRSx5QkFBeUI7b0JBQzlCLFFBQVEsRUFBRSxzQkFBc0I7b0JBQ2hDLE1BQU0sRUFBRSxDQUFDLE1BQU0sRUFBRSxpQkFBaUIsQ0FBQztpQkFDcEM7Z0JBQ0QsUUFBUSxFQUFFLHFCQUFxQjtnQkFDL0IsUUFBUSxFQUFFLGVBQWU7Z0JBQ3pCLFNBQVMsRUFBRSxlQUFlO2FBQzNCLENBQUM7WUFFRixNQUFNLEdBQUcsR0FBRywwQkFBMEIsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUVyRCxNQUFNLFFBQVEsR0FBRztnQkFDZixNQUFNLEVBQUUsMkJBQTJCO2dCQUNuQyxLQUFLLEVBQUUsb0JBQW9CO2dCQUMzQixPQUFPLEVBQUUsNENBQTRDO2dCQUNyRCxNQUFNLEVBQUUsV0FBVzthQUNwQixDQUFDO1lBRUYsTUFBTSxXQUFXLEdBQUcsTUFBTSxXQUFXLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUU1RCxnQ0FBZ0M7WUFDaEMsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDcEQsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztZQUN6RCxJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUVwRCxtRUFBbUU7WUFDbkUsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsK0NBQStDLENBQUMsQ0FBQztZQUN2RixJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO1lBQ3ZGLElBQUEsZ0JBQU0sRUFBQyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsd0JBQXdCO1lBQzlHLElBQUEsZ0JBQU0sRUFBQyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDO1lBRXJGLG9DQUFvQztZQUNwQyxJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1lBQ3JELElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLDRDQUE0QyxDQUFDLENBQUM7WUFDL0UsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFFN0MscUNBQXFDO1lBQ3JDLElBQUEsZ0JBQU0sRUFBRSxXQUFtQixDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUM1RCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLDZEQUE2RCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzNFLE1BQU0sV0FBVyxHQUFVO2dCQUN6QixPQUFPLEVBQUUsb0NBQW9DO2dCQUM3QyxTQUFTLEVBQUUsU0FBUztnQkFDcEIsU0FBUyxFQUFFLGdCQUFnQjtnQkFDM0IsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLE1BQU0sRUFBRTtvQkFDTixFQUFFLEVBQUUsaUJBQWlCO29CQUNyQixNQUFNLEVBQUUsaUJBQWlCO2lCQUMxQjtnQkFDRCxhQUFhLEVBQUUsdUJBQXVCO2FBQ3ZDLENBQUM7WUFFRixNQUFNLEdBQUcsR0FBRywwQkFBMEIsQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUVwRCxNQUFNLFVBQVUsR0FBRztnQkFDakIsS0FBSyxFQUFFLHlCQUF5QjtnQkFDaEMsT0FBTyxFQUFFLG1EQUFtRDtnQkFDNUQsTUFBTSxFQUFFLFVBQVU7YUFDbkIsQ0FBQztZQUVGLE1BQU0sV0FBVyxHQUFHLE1BQU0sV0FBVyxDQUFDLE1BQU0sQ0FDMUMsRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsRUFDNUIsVUFBVSxFQUNWLFNBQVMsRUFDVCxHQUFHLENBQ0osQ0FBQztZQUVGLG9DQUFvQztZQUNwQyxJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO1lBRXpFLDBDQUEwQztZQUMxQyxJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO1lBQ3ZGLElBQUEsZ0JBQU0sRUFBQyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDO1lBRXJGLGlEQUFpRDtZQUNqRCxJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzlDLElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7WUFFOUMscUJBQXFCO1lBQ3JCLElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUM7WUFDMUQsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7WUFFNUMscUNBQXFDO1lBQ3JDLElBQUEsZ0JBQU0sRUFBRSxXQUFtQixDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUMzRCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLHFEQUFxRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ25FLE1BQU0sV0FBVyxHQUFVO2dCQUN6QixPQUFPLEVBQUUsV0FBVztnQkFDcEIsU0FBUyxFQUFFLFdBQVc7Z0JBQ3RCLFNBQVMsRUFBRSxvQkFBb0I7Z0JBQy9CLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxXQUFXO2dCQUN2QixhQUFhLEVBQUUsMkJBQTJCO2FBQzNDLENBQUM7WUFFRixNQUFNLEdBQUcsR0FBRywwQkFBMEIsQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUVwRCxNQUFNLFdBQVcsR0FBRztnQkFDbEIsTUFBTSxFQUFFLFVBQVU7Z0JBQ2xCLGNBQWMsRUFBRSwrQkFBK0I7YUFDaEQsQ0FBQztZQUVGLE1BQU0sWUFBWSxHQUFHLE1BQU0sV0FBVyxDQUFDLE1BQU0sQ0FDM0MsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLEVBQzFCLFdBQVcsRUFDWCxTQUFTLEVBQ1QsR0FBRyxDQUNKLENBQUM7WUFFRixJQUFBLGdCQUFNLEVBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUVqRCwwQ0FBMEM7WUFDMUMsSUFBQSxnQkFBTSxFQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsK0NBQStDLENBQUMsQ0FBQztZQUN4RixJQUFBLGdCQUFNLEVBQUMsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztZQUN0RixJQUFBLGdCQUFNLEVBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUM3QyxJQUFBLGdCQUFNLEVBQUUsWUFBb0IsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUM7UUFDdkYsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQywwREFBMEQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN4RSxNQUFNLFlBQVksR0FBVTtnQkFDMUIsT0FBTyxFQUFFLHFCQUFxQjtnQkFDOUIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFNBQVMsRUFBRSxpQkFBaUI7Z0JBQzVCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixRQUFRLEVBQUUsa0JBQWtCO2dCQUM1QixPQUFPLEVBQUU7b0JBQ1AsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDO2lCQUNuQjthQUNGLENBQUM7WUFFRixNQUFNLFlBQVksR0FBVTtnQkFDMUIsT0FBTyxFQUFFLHFCQUFxQjtnQkFDOUIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFNBQVMsRUFBRSxpQkFBaUI7Z0JBQzVCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixRQUFRLEVBQUUsa0JBQWtCO2dCQUM1QixPQUFPLEVBQUU7b0JBQ1AsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDO2lCQUNuQjthQUNGLENBQUM7WUFFRixNQUFNLElBQUksR0FBRywwQkFBMEIsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUN0RCxNQUFNLElBQUksR0FBRywwQkFBMEIsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUV0RCxNQUFNLEtBQUssR0FBRyxNQUFNLFdBQVcsQ0FBQyxNQUFNLENBQUM7Z0JBQ3JDLE1BQU0sRUFBRSxjQUFjO2dCQUN0QixLQUFLLEVBQUUsZ0JBQWdCO2dCQUN2QixPQUFPLEVBQUUsdUJBQXVCO2FBQ2pDLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFFVCxNQUFNLEtBQUssR0FBRyxNQUFNLFdBQVcsQ0FBQyxNQUFNLENBQUM7Z0JBQ3JDLE1BQU0sRUFBRSxjQUFjO2dCQUN0QixLQUFLLEVBQUUsZ0JBQWdCO2dCQUN2QixPQUFPLEVBQUUsdUJBQXVCO2FBQ2pDLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFFVCwwQkFBMEI7WUFDMUIsSUFBQSxnQkFBTSxFQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQztZQUNoRCxJQUFBLGdCQUFNLEVBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1lBRXBELElBQUEsZ0JBQU0sRUFBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDaEQsSUFBQSxnQkFBTSxFQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztZQUVwRCw0QkFBNEI7WUFDNUIsSUFBQSxnQkFBTSxFQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNoRCxJQUFBLGdCQUFNLEVBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3BELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsZ0NBQWdDLEVBQUUsR0FBRyxFQUFFO1FBRTlDLElBQUEsWUFBRSxFQUFDLDJEQUEyRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3pFLE1BQU0sUUFBUSxHQUFHO2dCQUNmLE1BQU0sRUFBRSxlQUFlO2dCQUN2QixLQUFLLEVBQUUsb0JBQW9CO2dCQUMzQixPQUFPLEVBQUUsaUNBQWlDO2FBQzNDLENBQUM7WUFFRixNQUFNLFdBQVcsR0FBRyxNQUFNLFdBQVcsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFFdkQsNkVBQTZFO1lBQzdFLElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDOUMsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUM5QyxJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzdDLElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDOUMsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUU5QyxvQ0FBb0M7WUFDcEMsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUNyRCxJQUFBLGdCQUFNLEVBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO1FBQ3RFLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsd0NBQXdDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDdEQsTUFBTSxlQUFlLEdBQVU7Z0JBQzdCLFNBQVMsRUFBRSxnQkFBZ0I7Z0JBQzNCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLG9DQUFvQzthQUNyQyxDQUFDO1lBRUYsTUFBTSxHQUFHLEdBQUcsMEJBQTBCLENBQUMsZUFBZSxDQUFDLENBQUM7WUFFeEQsTUFBTSxRQUFRLEdBQUc7Z0JBQ2YsTUFBTSxFQUFFLHVCQUF1QjtnQkFDL0IsS0FBSyxFQUFFLDRCQUE0QjtnQkFDbkMsT0FBTyxFQUFFLG1DQUFtQzthQUM3QyxDQUFDO1lBRUYsTUFBTSxXQUFXLEdBQUcsTUFBTSxXQUFXLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUU1RCw2QkFBNkI7WUFDN0IsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDLGFBQWE7WUFDNUQsSUFBQSxnQkFBTSxFQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDLGNBQWM7WUFFNUQseUZBQXlGO1lBQ3pGLElBQUEsZ0JBQU0sRUFBRSxXQUFtQixDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO1lBQ2hHLElBQUEsZ0JBQU0sRUFBRSxXQUFtQixDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO1lBQ2hHLElBQUEsZ0JBQU0sRUFBRSxXQUFtQixDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUMvRCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLDREQUE0RCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzFFLE1BQU0sS0FBSyxHQUFVO2dCQUNuQixPQUFPLEVBQUUsY0FBYztnQkFDdkIsU0FBUyxFQUFFLG1CQUFtQjtnQkFDOUIsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsUUFBUSxFQUFFLGdCQUFnQjthQUMzQixDQUFDO1lBRUYsTUFBTSxHQUFHLEdBQUcsMEJBQTBCLENBQUMsS0FBSyxDQUFDLENBQUM7WUFFOUMscUVBQXFFO1lBQ3JFLE1BQU0sUUFBUSxHQUFHO2dCQUNmLE1BQU0sRUFBRSwyQkFBMkI7Z0JBQ25DLEtBQUssRUFBRSxpQ0FBaUM7Z0JBQ3hDLE9BQU8sRUFBRSw2QkFBNkI7Z0JBQ3RDLFNBQVMsRUFBRSxrQkFBa0IsRUFBRSw2QkFBNkI7Z0JBQzVELFFBQVEsRUFBRSxpQkFBaUIsQ0FBSyw2QkFBNkI7YUFDOUQsQ0FBQztZQUVGLE1BQU0sV0FBVyxHQUFHLE1BQU0sV0FBVyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFFNUQsaURBQWlEO1lBQ2pELElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ25ELElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFFcEQsNkRBQTZEO1lBQzdELElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxDQUFDLCtDQUErQyxDQUFDLENBQUM7WUFDdkYsSUFBQSxnQkFBTSxFQUFDLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDdkYsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyxxRUFBcUUsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNuRiw4Q0FBOEM7WUFDOUMsTUFBTSxrQkFBa0IsR0FBZ0M7Z0JBQ3RELEtBQUssRUFBRTtvQkFDTCxNQUFNLEVBQUUsY0FBYztvQkFDdEIsT0FBTyxFQUFFLEdBQUc7b0JBQ1osT0FBTyxFQUFFLE1BQU07aUJBQ2hCO2dCQUNELFVBQVUsRUFBRTtvQkFDVixNQUFNLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7b0JBQzFDLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTtvQkFDekMsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFO29CQUMzQyxTQUFTLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxFQUFFLFlBQVk7b0JBQzVFLFNBQVMsRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFFLGdCQUFnQjtvQkFDaEUsU0FBUyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsRUFBRSxZQUFZO29CQUM1RSxTQUFTLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsQ0FBRSxnQkFBZ0I7aUJBQ2pFO2dCQUNELE9BQU8sRUFBRTtvQkFDUCxPQUFPLEVBQUU7d0JBQ1AsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUU7d0JBQzdCLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUU7cUJBQ3RCO2lCQUNGO2FBQ0ssQ0FBQztZQUVULE1BQU0sbUJBQW9CLFNBQVEsZ0NBQTRDO2dCQUM1RTtvQkFDRSxLQUFLLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxLQUFLLEVBQUUscUJBQXFCLEVBQUUsTUFBTSxFQUFFLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLHVCQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ2hILENBQUM7Z0JBRU0sc0JBQXNCLENBQzNCLElBQU8sRUFDUCxTQUE4QixFQUM5QixHQUFzQjtvQkFFdEIsT0FBUSxJQUFZLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztnQkFDaEUsQ0FBQzthQUNGO1lBRUQsTUFBTSxlQUFlLEdBQUcsSUFBSSxtQkFBbUIsRUFBRSxDQUFDO1lBRWxELE1BQU0sS0FBSyxHQUFVO2dCQUNuQixPQUFPLEVBQUUsV0FBVztnQkFDcEIsU0FBUyxFQUFFLG1CQUFtQjtnQkFDOUIsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsUUFBUSxFQUFFLGFBQWE7YUFDeEIsQ0FBQztZQUVGLE1BQU0sR0FBRyxHQUFHLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTlDLE1BQU0sUUFBUSxHQUFHO2dCQUNmLE1BQU0sRUFBRSxvQkFBb0I7Z0JBQzVCLEtBQUssRUFBRSwwQkFBMEI7Z0JBQ2pDLE9BQU8sRUFBRSw0Q0FBNEM7Z0JBQ3JELFNBQVMsRUFBRSxlQUFlLEVBQUUsNkNBQTZDO2dCQUN6RSxTQUFTLEVBQUUsMEJBQTBCLENBQUMsNkNBQTZDO2FBQ3BGLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxlQUFlLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUUvRSx5Q0FBeUM7WUFDekMsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxxQkFBcUI7WUFDckUsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxDQUFDLHFCQUFxQjtZQUVoRiwwQ0FBMEM7WUFDMUMsSUFBQSxnQkFBTSxFQUFFLE1BQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxpQkFBaUI7WUFFdEUsd0RBQXdEO1lBQ3hELElBQUEsZ0JBQU0sRUFBRSxNQUFjLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxDQUFDLCtDQUErQyxDQUFDLENBQUM7WUFDM0YsSUFBQSxnQkFBTSxFQUFDLElBQUksSUFBSSxDQUFFLE1BQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUM7WUFFekYsZ0RBQWdEO1lBQ2hELElBQUEsZ0JBQU0sRUFBRSxNQUFjLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2hELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsOEJBQThCLEVBQUUsR0FBRyxFQUFFO1FBRTVDLElBQUEsWUFBRSxFQUFDLGlFQUFpRSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQy9FLDZCQUE2QjtZQUM3QixNQUFNLFdBQVcsR0FBVTtnQkFDekIsT0FBTyxFQUFFLGtCQUFrQjtnQkFDM0IsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFNBQVMsRUFBRSxrQkFBa0I7Z0JBQzdCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixPQUFPLEVBQUU7b0JBQ1AsTUFBTSxFQUFFLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztpQkFDM0I7Z0JBQ0QsUUFBUSxFQUFFLGtCQUFrQjthQUM3QixDQUFDO1lBRUYsTUFBTSxTQUFTLEdBQUcsTUFBTSxXQUFXLENBQUMsTUFBTSxDQUFDO2dCQUN6QyxNQUFNLEVBQUUsdUJBQXVCO2dCQUMvQixLQUFLLEVBQUUsZ0NBQWdDO2dCQUN2QyxPQUFPLEVBQUUsMkJBQTJCO2dCQUNwQyxNQUFNLEVBQUUsT0FBTzthQUNoQixFQUFFLDBCQUEwQixDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFFNUMsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQztZQUNyRCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUV2QyxxQ0FBcUM7WUFDckMsTUFBTSxXQUFXLEdBQVU7Z0JBQ3pCLE9BQU8sRUFBRSxrQkFBa0I7Z0JBQzNCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixTQUFTLEVBQUUsbUJBQW1CO2dCQUM5QixTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxVQUFVLEVBQUUsU0FBUztnQkFDckIsT0FBTyxFQUFFO29CQUNQLE1BQU0sRUFBRSxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUM7aUJBQzNCO2dCQUNELFFBQVEsRUFBRSxrQkFBa0I7YUFDN0IsQ0FBQztZQUVGLE1BQU0sWUFBWSxHQUFHLE1BQU0sV0FBVyxDQUFDLE1BQU0sQ0FDM0MsRUFBRSxNQUFNLEVBQUUsdUJBQXVCLEVBQUUsRUFDbkM7Z0JBQ0UsT0FBTyxFQUFFLDhDQUE4QztnQkFDdkQsTUFBTSxFQUFFLGNBQWM7Z0JBQ3RCLFdBQVcsRUFBRSxrQ0FBa0M7YUFDaEQsRUFDRCxTQUFTLEVBQ1QsMEJBQTBCLENBQUMsV0FBVyxDQUFDLENBQ3hDLENBQUM7WUFFRixJQUFBLGdCQUFNLEVBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1lBQ3hELElBQUEsZ0JBQU0sRUFBQyxZQUFZLENBQUMsU0FBUyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQyxvQkFBb0I7WUFDcEUsSUFBQSxnQkFBTSxFQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7WUFFakQsZ0NBQWdDO1lBQ2hDLE1BQU0sV0FBVyxHQUFVO2dCQUN6QixPQUFPLEVBQUUsV0FBVztnQkFDcEIsU0FBUyxFQUFFLFdBQVc7Z0JBQ3RCLFNBQVMsRUFBRSxrQkFBa0I7Z0JBQzdCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxXQUFXO2dCQUN2QixhQUFhLEVBQUUsdUJBQXVCO2FBQ3ZDLENBQUM7WUFFRixNQUFNLGFBQWEsR0FBRyxNQUFNLFdBQVcsQ0FBQyxNQUFNLENBQzVDLEVBQUUsTUFBTSxFQUFFLHVCQUF1QixFQUFFLEVBQ25DO2dCQUNFLE1BQU0sRUFBRSxXQUFXO2dCQUNuQixXQUFXLEVBQUUsMEJBQTBCO2FBQ3hDLEVBQ0QsU0FBUyxFQUNULDBCQUEwQixDQUFDLFdBQVcsQ0FBQyxDQUN4QyxDQUFDO1lBRUYsSUFBQSxnQkFBTSxFQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDbEQsSUFBQSxnQkFBTSxFQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDL0MsSUFBQSxnQkFBTSxFQUFFLGFBQXFCLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO1FBQ3BGLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsa0RBQWtELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDaEUsTUFBTSxjQUFjLEdBQVU7Z0JBQzVCLE9BQU8sRUFBRSwyQkFBMkI7Z0JBQ3BDLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixTQUFTLEVBQUUsb0JBQW9CO2dCQUMvQixTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxVQUFVLEVBQUUsU0FBUztnQkFDckIsTUFBTSxFQUFFO29CQUNOLEVBQUUsRUFBRSxtQkFBbUI7b0JBQ3ZCLE1BQU0sRUFBRSxpQkFBaUI7aUJBQzFCO2dCQUNELGFBQWEsRUFBRSwwQkFBMEI7YUFDMUMsQ0FBQztZQUVGLE1BQU0sR0FBRyxHQUFHLDBCQUEwQixDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBRXZELCtCQUErQjtZQUMvQixNQUFNLGFBQWEsR0FBRztnQkFDcEI7b0JBQ0UsTUFBTSxFQUFFLG1CQUFtQjtvQkFDM0IsS0FBSyxFQUFFLGlCQUFpQjtvQkFDeEIsT0FBTyxFQUFFLHlCQUF5QjtvQkFDbEMsTUFBTSxFQUFFLFVBQVU7aUJBQ25CO2dCQUNEO29CQUNFLE1BQU0sRUFBRSxtQkFBbUI7b0JBQzNCLEtBQUssRUFBRSxpQkFBaUI7b0JBQ3hCLE9BQU8sRUFBRSw4QkFBOEI7b0JBQ3ZDLE1BQU0sRUFBRSxVQUFVO2lCQUNuQjthQUNGLENBQUM7WUFFRixNQUFNLGFBQWEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQ3JDLGFBQWEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUN6RCxDQUFDO1lBRUYsaURBQWlEO1lBQ2pELGFBQWEsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQzNCLElBQUEsZ0JBQU0sRUFBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUM7Z0JBQ3pELElBQUEsZ0JBQU0sRUFBRSxJQUFZLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO2dCQUM1RSxJQUFBLGdCQUFNLEVBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFFckMsd0NBQXdDO2dCQUN4QyxJQUFBLGdCQUFNLEVBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO2dCQUNoRixJQUFBLGdCQUFNLEVBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztZQUNoRixDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0LCBiZWZvcmVFYWNoLCBqZXN0IH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4vYmFzZS1zZXJ2aWNlJztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEVudGl0eVNjaGVtYSB9IGZyb20gJy4vYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpL2NvbnRhaW5lcic7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbi8vIFJlYWwgZW50aXR5IHNjaGVtYSB3aXRoIGFjdG9yIGZpZWxkc1xuY29uc3QgUG9zdEVudGl0eVNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICBtb2RlbDoge1xuICAgIGVudGl0eTogJ1Bvc3QnLFxuICAgIHZlcnNpb246ICcxJyxcbiAgICBzZXJ2aWNlOiAnYmxvZydcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIHBvc3RJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZVxuICAgIH0sXG4gICAgdGl0bGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICB9LFxuICAgIGNvbnRlbnQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICB9LFxuICAgIHN0YXR1czoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBkZWZhdWx0OiAnZHJhZnQnXG4gICAgfSxcbiAgICAvLyBBY3Rvci1yZWxhdGVkIGZpZWxkcyB0aGF0IHNob3VsZCBiZSBhdXRvLWluamVjdGVkXG4gICAgY3JlYXRlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZVxuICAgIH0sXG4gICAgdXBkYXRlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZVxuICAgIH0sXG4gICAgY3JlYXRlZEF0OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZVxuICAgIH0sXG4gICAgdXBkYXRlZEF0OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZVxuICAgIH0sXG4gICAgdGVuYW50SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlXG4gICAgfVxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHsgY29tcG9zaXRlOiBbJ3Bvc3RJZCddIH0sXG4gICAgICBzazogeyBjb21wb3NpdGU6IFtdIH1cbiAgICB9LFxuICAgIGJ5VGVuYW50OiB7XG4gICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgcGs6IHsgY29tcG9zaXRlOiBbJ3RlbmFudElkJ10gfSxcbiAgICAgIHNrOiB7IGNvbXBvc2l0ZTogWydjcmVhdGVkQXQnXSB9XG4gICAgfVxuICB9XG59IGFzIGFueTtcblxuLy8gUmVhbCBzZXJ2aWNlIGltcGxlbWVudGF0aW9uIGZvciB0ZXN0aW5nXG5jbGFzcyBUZXN0UG9zdFNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTx0eXBlb2YgUG9zdEVudGl0eVNjaGVtYT4ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBjb25zdCBlbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgICAgdGFibGU6ICd0ZXN0LXBvc3RzLXRhYmxlJyxcbiAgICAgIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KVxuICAgIH07XG4gICAgc3VwZXIoUG9zdEVudGl0eVNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbiwgRElDb250YWluZXIuUk9PVCk7XG4gIH1cblxuICAvLyBPdmVycmlkZSB0byBtYWtlIHByb3RlY3RlZCBtZXRob2RzIGFjY2Vzc2libGUgZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RJbmplY3RBY3RvckNvbnRleHQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KFxuICAgIGRhdGE6IFQsXG4gICAgb3BlcmF0aW9uOiAnY3JlYXRlJyB8ICd1cGRhdGUnLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgKTogVCB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuaW5qZWN0QWN0b3JDb250ZXh0KGRhdGEsIG9wZXJhdGlvbiwgY3R4KTtcbiAgfVxuXG4gIC8vIE1vY2sgdGhlIGFjdHVhbCByZXBvc2l0b3J5IG9wZXJhdGlvbnMgc2luY2Ugd2UgZG9uJ3QgaGF2ZSBEeW5hbW9EQlxuICBwdWJsaWMgYXN5bmMgY3JlYXRlKGRhdGE6IGFueSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgIGNvbnN0IGVuaGFuY2VkRGF0YSA9IHRoaXMudGVzdEluamVjdEFjdG9yQ29udGV4dChkYXRhLCAnY3JlYXRlJywgY3R4KTtcbiAgICAvLyBTaW11bGF0ZSByZXBvc2l0b3J5IGNyZWF0ZVxuICAgIHJldHVybiB7XG4gICAgICAuLi5lbmhhbmNlZERhdGEsXG4gICAgICBwb3N0SWQ6IGVuaGFuY2VkRGF0YS5wb3N0SWQgfHwgYHBvc3QtJHtEYXRlLm5vdygpfWAsXG4gICAgICAvLyBTaW11bGF0ZSBEeW5hbW9EQiByZXNwb25zZSBmb3JtYXRcbiAgICAgIF9fZWRiX2VfXzogJ1Bvc3QnLFxuICAgICAgX19lZGJfdl9fOiAnMSdcbiAgICB9O1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHVwZGF0ZShpZGVudGlmaWVyczogYW55LCBkYXRhOiBhbnksIF9vcGVyYXRvcnM/OiBhbnksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICBjb25zdCBlbmhhbmNlZERhdGEgPSB0aGlzLnRlc3RJbmplY3RBY3RvckNvbnRleHQoZGF0YSwgJ3VwZGF0ZScsIGN0eCk7XG4gICAgLy8gU2ltdWxhdGUgcmVwb3NpdG9yeSB1cGRhdGVcbiAgICByZXR1cm4ge1xuICAgICAgLi4uaWRlbnRpZmllcnMsXG4gICAgICAuLi5lbmhhbmNlZERhdGEsXG4gICAgICAvLyBTaW11bGF0ZSBEeW5hbW9EQiByZXNwb25zZSBmb3JtYXRcbiAgICAgIF9fZWRiX2VfXzogJ1Bvc3QnLFxuICAgICAgX19lZGJfdl9fOiAnMSdcbiAgICB9O1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGFjdG9yOiBBY3Rvcik6IEV4ZWN1dGlvbkNvbnRleHQge1xuICByZXR1cm4ge1xuICAgIGV2ZW50OiB7fSBhcyBhbnksXG4gICAgbGFtYmRhQ29udGV4dDoge30gYXMgYW55LFxuICAgIHJlcXVlc3Q6IHt9IGFzIGFueSxcbiAgICByZXNwb25zZToge30gYXMgYW55LFxuICAgIGFjdG9yXG4gIH07XG59XG5cbmRlc2NyaWJlKCdDUlVEIFNlcnZpY2UgUmVhbCBJbnRlZ3JhdGlvbiBUZXN0cycsICgpID0+IHtcbiAgbGV0IHBvc3RTZXJ2aWNlOiBUZXN0UG9zdFNlcnZpY2U7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgcG9zdFNlcnZpY2UgPSBuZXcgVGVzdFBvc3RTZXJ2aWNlKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBY3RvciBJbmplY3Rpb24gaW4gUmVhbCBDUlVEIE9wZXJhdGlvbnMnLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBpbmplY3QgYWN0b3IgY29udGV4dCB3aGVuIGNyZWF0aW5nIHBvc3RzIHZpYSBzZXJ2aWNlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29nbml0b0FjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItam9obi1kb2UnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWNyZWF0ZS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIGVtYWlsOiAnam9obi5kb2VAY29tcGFueS5jb20nLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgc3ViOiAndXMtZWFzdC0xOnVzZXItdXVpZC0xMjMnLFxuICAgICAgICAgIHVzZXJuYW1lOiAnam9obi5kb2VAY29tcGFueS5jb20nLFxuICAgICAgICAgIGdyb3VwczogWyd1c2VyJywgJ2NvbnRlbnQtY3JlYXRvciddXG4gICAgICAgIH0sXG4gICAgICAgIHRlbmFudElkOiAnY29tcGFueS1ibG9nLXRlbmFudCcsXG4gICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEwMCcsXG4gICAgICAgIHVzZXJBZ2VudDogJ0Jsb2dBcHAvMi4wLjAnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChjb2duaXRvQWN0b3IpO1xuXG4gICAgICBjb25zdCBwb3N0RGF0YSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC1pbnRlZ3JhdGlvbi10ZXN0LTAwMScsXG4gICAgICAgIHRpdGxlOiAnTXkgRmlyc3QgQmxvZyBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgaXMgdGhlIGNvbnRlbnQgb2YgbXkgZmlyc3QgYmxvZyBwb3N0LicsXG4gICAgICAgIHN0YXR1czogJ3B1Ymxpc2hlZCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNyZWF0ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHBvc3REYXRhLCBjdHgpO1xuXG4gICAgICAvLyBWZXJpZnkgYWN0b3IgaW5qZWN0aW9uIHdvcmtlZFxuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRCeSkudG9CZSgndXNlci1qb2huLWRvZScpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnRlbmFudElkKS50b0JlKCdjb21wYW55LWJsb2ctdGVuYW50Jyk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudXBkYXRlZEJ5KS50b0JlKCd1c2VyLWpvaG4tZG9lJyk7XG4gICAgICBcbiAgICAgIC8vIFRpbWVzdGFtcHMgc2hvdWxkIGJlIGN1cnJlbnQgc3lzdGVtIHRpbWUgKElTTyBmb3JtYXQgYW5kIHJlY2VudClcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jcmVhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKGNyZWF0ZWRQb3N0LmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApOyAvLyBXaXRoaW4gbGFzdCA1IHNlY29uZHNcbiAgICAgIGV4cGVjdChuZXcgRGF0ZShjcmVhdGVkUG9zdC51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcblxuICAgICAgLy8gVmVyaWZ5IG9yaWdpbmFsIGRhdGEgaXMgcHJlc2VydmVkXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QudGl0bGUpLnRvQmUoJ015IEZpcnN0IEJsb2cgUG9zdCcpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNvbnRlbnQpLnRvQmUoJ1RoaXMgaXMgdGhlIGNvbnRlbnQgb2YgbXkgZmlyc3QgYmxvZyBwb3N0LicpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnN0YXR1cykudG9CZSgncHVibGlzaGVkJyk7XG5cbiAgICAgIC8vIFZlcmlmeSBoaWRkZW4gYWN0b3IgY29udGV4dCBleGlzdHNcbiAgICAgIGV4cGVjdCgoY3JlYXRlZFBvc3QgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwoY29nbml0b0FjdG9yKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaW5qZWN0IGFjdG9yIGNvbnRleHQgd2hlbiB1cGRhdGluZyBwb3N0cyB2aWEgc2VydmljZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUtleUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6Y29udGVudC1tYW5hZ2VtZW50LXNlcnZpY2UnLFxuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXVwZGF0ZS0wMDInLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDE1OjQ1OjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnYXBpLWtleScsXG4gICAgICAgIGFwaUtleToge1xuICAgICAgICAgIGlkOiAnY21zLWFwaS1rZXktNzg5JyxcbiAgICAgICAgICBzb3VyY2U6ICdyZXF1ZXN0LWNvbnRleHQnXG4gICAgICAgIH0sXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdidWxrLXVwZGF0ZS1iYXRjaC00NTYnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChhcGlLZXlBY3Rvcik7XG5cbiAgICAgIGNvbnN0IHVwZGF0ZURhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVXBkYXRlZCBCbG9nIFBvc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGhpcyBjb250ZW50IGhhcyBiZWVuIHVwZGF0ZWQgYnkgdGhlIENNUyBzZXJ2aWNlLicsXG4gICAgICAgIHN0YXR1czogJ3Jldmlld2VkJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgdXBkYXRlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS51cGRhdGUoXG4gICAgICAgIHsgcG9zdElkOiAncG9zdC10by11cGRhdGUnIH0sXG4gICAgICAgIHVwZGF0ZURhdGEsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgY3R4XG4gICAgICApO1xuXG4gICAgICAvLyBWZXJpZnkgYWN0b3IgaW5qZWN0aW9uIGZvciB1cGRhdGVcbiAgICAgIGV4cGVjdCh1cGRhdGVkUG9zdC51cGRhdGVkQnkpLnRvQmUoJ2FwaS1rZXk6Y29udGVudC1tYW5hZ2VtZW50LXNlcnZpY2UnKTtcbiAgICAgIFxuICAgICAgLy8gdXBkYXRlZEF0IHNob3VsZCBiZSBjdXJyZW50IHN5c3RlbSB0aW1lXG4gICAgICBleHBlY3QodXBkYXRlZFBvc3QudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKHVwZGF0ZWRQb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgXG4gICAgICAvLyBjcmVhdGVkQnkgc2hvdWxkIE5PVCBiZSBvdmVyd3JpdHRlbiBpbiB1cGRhdGVzXG4gICAgICBleHBlY3QodXBkYXRlZFBvc3QuY3JlYXRlZEJ5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QodXBkYXRlZFBvc3QuY3JlYXRlZEF0KS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICAgIC8vIFZlcmlmeSB1cGRhdGUgZGF0YVxuICAgICAgZXhwZWN0KHVwZGF0ZWRQb3N0LnRpdGxlKS50b0JlKCdVcGRhdGVkIEJsb2cgUG9zdCBUaXRsZScpO1xuICAgICAgZXhwZWN0KHVwZGF0ZWRQb3N0LnN0YXR1cykudG9CZSgncmV2aWV3ZWQnKTtcblxuICAgICAgLy8gVmVyaWZ5IGhpZGRlbiBhY3RvciBjb250ZXh0IGV4aXN0c1xuICAgICAgZXhwZWN0KCh1cGRhdGVkUG9zdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChhcGlLZXlBY3Rvcik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzeXN0ZW0gYWN0b3IgZm9yIGF1dG9tYXRlZCBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3lzdGVtQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgICAgYWN0b3JUeXBlOiAnYW5vbnltb3VzJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXN5c3RlbS1jbGVhbnVwJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQwMjowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2Fub255bW91cycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdzY2hlZHVsZWQtbWFpbnRlbmFuY2UtMDAxJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoc3lzdGVtQWN0b3IpO1xuXG4gICAgICBjb25zdCBhcmNoaXZlRGF0YSA9IHtcbiAgICAgICAgc3RhdHVzOiAnYXJjaGl2ZWQnLFxuICAgICAgICBhcmNoaXZlZFJlYXNvbjogJ1NjaGVkdWxlZCBtYWludGVuYW5jZSBjbGVhbnVwJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgYXJjaGl2ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UudXBkYXRlKFxuICAgICAgICB7IHBvc3RJZDogJ29sZC1wb3N0LTEyMycgfSxcbiAgICAgICAgYXJjaGl2ZURhdGEsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgY3R4XG4gICAgICApO1xuXG4gICAgICBleHBlY3QoYXJjaGl2ZWRQb3N0LnVwZGF0ZWRCeSkudG9CZSgnYW5vbnltb3VzJyk7XG4gICAgICBcbiAgICAgIC8vIHVwZGF0ZWRBdCBzaG91bGQgYmUgY3VycmVudCBzeXN0ZW0gdGltZVxuICAgICAgZXhwZWN0KGFyY2hpdmVkUG9zdC51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoYXJjaGl2ZWRQb3N0LnVwZGF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KGFyY2hpdmVkUG9zdC5zdGF0dXMpLnRvQmUoJ2FyY2hpdmVkJyk7XG4gICAgICBleHBlY3QoKGFyY2hpdmVkUG9zdCBhcyBhbnkpLl9hY3Rvci5jb3JyZWxhdGlvbklkKS50b0JlKCdzY2hlZHVsZWQtbWFpbnRlbmFuY2UtMDAxJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB0ZW5hbnQgaXNvbGF0aW9uIGluIG11bHRpLXRlbmFudCBzY2VuYXJpb3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB0ZW5hbnQxQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci10ZW5hbnQxLWVkaXRvcicsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdGVuYW50MS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEyOjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHRlbmFudElkOiAndGVuYW50LWNvbXBhbnktYScsXG4gICAgICAgIGNvZ25pdG86IHtcbiAgICAgICAgICBncm91cHM6IFsnZWRpdG9yJ11cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgdGVuYW50MkFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItdGVuYW50Mi1lZGl0b3InLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXRlbmFudDItMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMjozMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1jb21wYW55LWInLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgZ3JvdXBzOiBbJ2VkaXRvciddXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eDEgPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCh0ZW5hbnQxQWN0b3IpO1xuICAgICAgY29uc3QgY3R4MiA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KHRlbmFudDJBY3Rvcik7XG5cbiAgICAgIGNvbnN0IHBvc3QxID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHtcbiAgICAgICAgcG9zdElkOiAndGVuYW50MS1wb3N0JyxcbiAgICAgICAgdGl0bGU6ICdDb21wYW55IEEgUG9zdCcsXG4gICAgICAgIGNvbnRlbnQ6ICdDb250ZW50IGZvciBDb21wYW55IEEnXG4gICAgICB9LCBjdHgxKTtcblxuICAgICAgY29uc3QgcG9zdDIgPSBhd2FpdCBwb3N0U2VydmljZS5jcmVhdGUoe1xuICAgICAgICBwb3N0SWQ6ICd0ZW5hbnQyLXBvc3QnLFxuICAgICAgICB0aXRsZTogJ0NvbXBhbnkgQiBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ0NvbnRlbnQgZm9yIENvbXBhbnkgQidcbiAgICAgIH0sIGN0eDIpO1xuXG4gICAgICAvLyBWZXJpZnkgdGVuYW50IGlzb2xhdGlvblxuICAgICAgZXhwZWN0KHBvc3QxLnRlbmFudElkKS50b0JlKCd0ZW5hbnQtY29tcGFueS1hJyk7XG4gICAgICBleHBlY3QocG9zdDEuY3JlYXRlZEJ5KS50b0JlKCd1c2VyLXRlbmFudDEtZWRpdG9yJyk7XG5cbiAgICAgIGV4cGVjdChwb3N0Mi50ZW5hbnRJZCkudG9CZSgndGVuYW50LWNvbXBhbnktYicpO1xuICAgICAgZXhwZWN0KHBvc3QyLmNyZWF0ZWRCeSkudG9CZSgndXNlci10ZW5hbnQyLWVkaXRvcicpO1xuXG4gICAgICAvLyBWZXJpZnkgcG9zdHMgYXJlIGlzb2xhdGVkXG4gICAgICBleHBlY3QocG9zdDEudGVuYW50SWQpLm5vdC50b0JlKHBvc3QyLnRlbmFudElkKTtcbiAgICAgIGV4cGVjdChwb3N0MS5jcmVhdGVkQnkpLm5vdC50b0JlKHBvc3QyLmNyZWF0ZWRCeSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFZGdlIENhc2VzIGFuZCBFcnJvciBTY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgb3BlcmF0aW9ucyB3aXRob3V0IGFjdG9yIGNvbnRleHQgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHBvc3REYXRhID0ge1xuICAgICAgICBwb3N0SWQ6ICdwb3N0LW5vLWFjdG9yJyxcbiAgICAgICAgdGl0bGU6ICdQb3N0IFdpdGhvdXQgQWN0b3InLFxuICAgICAgICBjb250ZW50OiAnVGhpcyBwb3N0IGhhcyBubyBhY3RvciBjb250ZXh0LidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNyZWF0ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHBvc3REYXRhKTtcblxuICAgICAgLy8gU2hvdWxkIG5vdCBjcmFzaCwgYnV0IG5vIGFjdG9yIGZpZWxkcyBzaG91bGQgYmUgc2V0IChubyBpbmplY3Rpb24gaGFwcGVucylcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jcmVhdGVkQnkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC51cGRhdGVkQnkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50ZW5hbnRJZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LmNyZWF0ZWRBdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnVwZGF0ZWRBdCkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgICAvLyBPcmlnaW5hbCBkYXRhIHNob3VsZCBiZSBwcmVzZXJ2ZWRcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50aXRsZSkudG9CZSgnUG9zdCBXaXRob3V0IEFjdG9yJyk7XG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY29udGVudCkudG9CZSgnVGhpcyBwb3N0IGhhcyBubyBhY3RvciBjb250ZXh0LicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW5jb21wbGV0ZSBhY3RvciBjb250ZXh0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5jb21wbGV0ZUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWluY29tcGxldGUnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDE2OjAwOjAwLjAwMFonXG4gICAgICAgIC8vIE1pc3NpbmcgYWN0b3JJZCwgYXV0aE1ldGhvZCwgZXRjLlxuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoaW5jb21wbGV0ZUFjdG9yKTtcblxuICAgICAgY29uc3QgcG9zdERhdGEgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtaW5jb21wbGV0ZS1hY3RvcicsXG4gICAgICAgIHRpdGxlOiAnUG9zdCB3aXRoIEluY29tcGxldGUgQWN0b3InLFxuICAgICAgICBjb250ZW50OiAnVGVzdGluZyBpbmNvbXBsZXRlIGFjdG9yIGNvbnRleHQuJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3JlYXRlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS5jcmVhdGUocG9zdERhdGEsIGN0eCk7XG5cbiAgICAgIC8vIFNob3VsZCBoYW5kbGUgZ3JhY2VmdWxseSAgXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY3JlYXRlZEJ5KS50b0JlVW5kZWZpbmVkKCk7IC8vIE5vIGFjdG9ySWRcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC50ZW5hbnRJZCkudG9CZVVuZGVmaW5lZCgpOyAvLyBObyB0ZW5hbnRJZFxuICAgICAgXG4gICAgICAvLyBXaGVuIGFjdG9yIGNvbnRleHQgZXhpc3RzIGJ1dCBoYXMgaW5jb21wbGV0ZSBkYXRhLCB0aW1lc3RhbXBzIHNob3VsZCBzdGlsbCBiZSBpbmplY3RlZFxuICAgICAgZXhwZWN0KChjcmVhdGVkUG9zdCBhcyBhbnkpLmNyZWF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdCgoY3JlYXRlZFBvc3QgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QoKGNyZWF0ZWRQb3N0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKGluY29tcGxldGVBY3Rvcik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByZXNlcnZlIGV4aXN0aW5nIGFjdG9yIGZpZWxkcyB3aGVuIHNjaGVtYSBoYXMgdGhlbScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2N1cnJlbnQtdXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcmVzZXJ2ZS10ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxNzowMDowMC4wMDBaJyxcbiAgICAgICAgdGVuYW50SWQ6ICdjdXJyZW50LXRlbmFudCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGFjdG9yKTtcblxuICAgICAgLy8gRGF0YSBhbHJlYWR5IGhhcyBzb21lIGFjdG9yIGZpZWxkcyAoc2ltdWxhdGluZyBwcmUtcG9wdWxhdGVkIGRhdGEpXG4gICAgICBjb25zdCBwb3N0RGF0YSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC13aXRoLWV4aXN0aW5nLWZpZWxkcycsXG4gICAgICAgIHRpdGxlOiAnUG9zdCB3aXRoIEV4aXN0aW5nIEFjdG9yIEZpZWxkcycsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0aW5nIGZpZWxkIHByZXNlcnZhdGlvbi4nLFxuICAgICAgICBjcmVhdGVkQnk6ICdvcmlnaW5hbC1jcmVhdG9yJywgLy8gVGhpcyBzaG91bGQgYmUgb3ZlcndyaXR0ZW5cbiAgICAgICAgdGVuYW50SWQ6ICdvcmlnaW5hbC10ZW5hbnQnICAgICAvLyBUaGlzIHNob3VsZCBiZSBvdmVyd3JpdHRlblxuICAgICAgfTtcblxuICAgICAgY29uc3QgY3JlYXRlZFBvc3QgPSBhd2FpdCBwb3N0U2VydmljZS5jcmVhdGUocG9zdERhdGEsIGN0eCk7XG5cbiAgICAgIC8vIEN1cnJlbnQgYWN0b3Igc2hvdWxkIG92ZXJ3cml0ZSBleGlzdGluZyBmaWVsZHNcbiAgICAgIGV4cGVjdChjcmVhdGVkUG9zdC5jcmVhdGVkQnkpLnRvQmUoJ2N1cnJlbnQtdXNlcicpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRQb3N0LnRlbmFudElkKS50b0JlKCdjdXJyZW50LXRlbmFudCcpO1xuICAgICAgXG4gICAgICAvLyBCdXQgdGltZXN0YW1wcyBzaG91bGQgYmUgc3lzdGVtLWdlbmVyYXRlZCAobm90IGZyb20gYWN0b3IpXG4gICAgICBleHBlY3QoY3JlYXRlZFBvc3QuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKGNyZWF0ZWRQb3N0LmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXNwZWN0IHJlYWQtb25seSBmaWVsZHMgYW5kIG5vdCBpbmplY3QgYWN0b3IgZGF0YSBpbnRvIHRoZW0nLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgYSBzY2hlbWEgd2l0aCByZWFkLW9ubHkgYWN0b3IgZmllbGRzXG4gICAgICBjb25zdCBSZWFkT25seVBvc3RTY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgbW9kZWw6IHtcbiAgICAgICAgICBlbnRpdHk6ICdSZWFkT25seVBvc3QnLFxuICAgICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgICBzZXJ2aWNlOiAnYmxvZydcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIHBvc3RJZDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgICAgICB0aXRsZTogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgICAgICBjb250ZW50OiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgICAgIGNyZWF0ZWRCeTogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IGZhbHNlLCByZWFkT25seTogdHJ1ZSB9LCAvLyBSRUFELU9OTFlcbiAgICAgICAgICB1cGRhdGVkQnk6IHsgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiBmYWxzZSB9LCAvLyBOb3QgcmVhZC1vbmx5XG4gICAgICAgICAgY3JlYXRlZEF0OiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogZmFsc2UsIHJlYWRPbmx5OiB0cnVlIH0sIC8vIFJFQUQtT05MWVxuICAgICAgICAgIHVwZGF0ZWRBdDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IGZhbHNlIH0gIC8vIE5vdCByZWFkLW9ubHlcbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWydwb3N0SWQnXSB9LFxuICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY2xhc3MgUmVhZE9ubHlQb3N0U2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPHR5cGVvZiBSZWFkT25seVBvc3RTY2hlbWE+IHtcbiAgICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgICAgc3VwZXIoUmVhZE9ubHlQb3N0U2NoZW1hLCB7IHRhYmxlOiAndGVzdC1yZWFkb25seS1wb3N0cycsIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KSB9LCBESUNvbnRhaW5lci5ST09UKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyB0ZXN0SW5qZWN0QWN0b3JDb250ZXh0PFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICAgICAgICBkYXRhOiBULFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZScgfCAndXBkYXRlJyxcbiAgICAgICAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0XG4gICAgICAgICk6IFQge1xuICAgICAgICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmluamVjdEFjdG9yQ29udGV4dChkYXRhLCBvcGVyYXRpb24sIGN0eCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVhZE9ubHlTZXJ2aWNlID0gbmV3IFJlYWRPbmx5UG9zdFNlcnZpY2UoKTtcblxuICAgICAgY29uc3QgYWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndGVzdC11c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXJlYWRvbmx5LXRlc3QnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDE4OjAwOjAwLjAwMFonLFxuICAgICAgICB0ZW5hbnRJZDogJ3Rlc3QtdGVuYW50J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoYWN0b3IpO1xuXG4gICAgICBjb25zdCBwb3N0RGF0YSA9IHtcbiAgICAgICAgcG9zdElkOiAncmVhZG9ubHktdGVzdC1wb3N0JyxcbiAgICAgICAgdGl0bGU6ICdUZXN0aW5nIFJlYWQtT25seSBGaWVsZHMnLFxuICAgICAgICBjb250ZW50OiAnVGhpcyB0ZXN0cyByZWFkLW9ubHkgYWN0b3IgZmllbGQgYmVoYXZpb3IuJyxcbiAgICAgICAgY3JlYXRlZEJ5OiAnc3lzdGVtLWltcG9ydCcsIC8vIFRoaXMgc2hvdWxkIE5PVCBiZSBvdmVyd3JpdHRlbiAocmVhZC1vbmx5KVxuICAgICAgICBjcmVhdGVkQXQ6ICcyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFonIC8vIFRoaXMgc2hvdWxkIE5PVCBiZSBvdmVyd3JpdHRlbiAocmVhZC1vbmx5KVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gcmVhZE9ubHlTZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQocG9zdERhdGEsICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBSZWFkLW9ubHkgZmllbGRzIHNob3VsZCBOT1QgYmUgY2hhbmdlZFxuICAgICAgZXhwZWN0KHJlc3VsdC5jcmVhdGVkQnkpLnRvQmUoJ3N5c3RlbS1pbXBvcnQnKTsgLy8gUHJlc2VydmVkIG9yaWdpbmFsXG4gICAgICBleHBlY3QocmVzdWx0LmNyZWF0ZWRBdCkudG9CZSgnMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaJyk7IC8vIFByZXNlcnZlZCBvcmlnaW5hbFxuXG4gICAgICAvLyBOb24tcmVhZC1vbmx5IGZpZWxkcyBzaG91bGQgYmUgaW5qZWN0ZWRcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEJ5KS50b0JlKCd0ZXN0LXVzZXInKTsgLy8gQWN0b3IgaW5qZWN0ZWRcbiAgICAgIFxuICAgICAgLy8gdXBkYXRlZEF0IHNob3VsZCBiZSBzeXN0ZW0tZ2VuZXJhdGVkIChub3QgZnJvbSBhY3RvcilcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcblxuICAgICAgLy8gSGlkZGVuIF9hY3RvciBmaWVsZCBzaG91bGQgYWx3YXlzIGJlIGluamVjdGVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChhY3Rvcik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDb21wbGV4IFJlYWwtV29ybGQgU2NlbmFyaW9zJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbnRlbnQgbW9kZXJhdGlvbiB3b3JrZmxvdyB3aXRoIGRpZmZlcmVudCBhY3RvcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTdGVwIDE6IFVzZXIgY3JlYXRlcyBkcmFmdFxuICAgICAgY29uc3QgYXV0aG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci1hdXRob3ItamFuZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3JlYXRlLWRyYWZ0JyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQwOTowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgZ3JvdXBzOiBbJ3VzZXInLCAnYXV0aG9yJ11cbiAgICAgICAgfSxcbiAgICAgICAgdGVuYW50SWQ6ICduZXdzLXB1YmxpY2F0aW9uJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgZHJhZnRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UuY3JlYXRlKHtcbiAgICAgICAgcG9zdElkOiAnYXJ0aWNsZS1icmVha2luZy1uZXdzJyxcbiAgICAgICAgdGl0bGU6ICdCcmVha2luZzogSW1wb3J0YW50IE5ld3MgU3RvcnknLFxuICAgICAgICBjb250ZW50OiAnVGhpcyBpcyB0aGUgZnVsbCBzdG9yeS4uLicsXG4gICAgICAgIHN0YXR1czogJ2RyYWZ0J1xuICAgICAgfSwgY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoYXV0aG9yQWN0b3IpKTtcblxuICAgICAgZXhwZWN0KGRyYWZ0UG9zdC5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItYXV0aG9yLWphbmUnKTtcbiAgICAgIGV4cGVjdChkcmFmdFBvc3Quc3RhdHVzKS50b0JlKCdkcmFmdCcpO1xuXG4gICAgICAvLyBTdGVwIDI6IEVkaXRvciByZXZpZXdzIGFuZCB1cGRhdGVzXG4gICAgICBjb25zdCBlZGl0b3JBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLWVkaXRvci1taWtlJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1lZGl0b3ItcmV2aWV3JyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgZ3JvdXBzOiBbJ3VzZXInLCAnZWRpdG9yJ11cbiAgICAgICAgfSxcbiAgICAgICAgdGVuYW50SWQ6ICduZXdzLXB1YmxpY2F0aW9uJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmV2aWV3ZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UudXBkYXRlKFxuICAgICAgICB7IHBvc3RJZDogJ2FydGljbGUtYnJlYWtpbmctbmV3cycgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNvbnRlbnQ6ICdUaGlzIGlzIHRoZSBlZGl0ZWQgYW5kIGZhY3QtY2hlY2tlZCBzdG9yeS4uLicsXG4gICAgICAgICAgc3RhdHVzOiAndW5kZXItcmV2aWV3JyxcbiAgICAgICAgICBlZGl0b3JOb3RlczogJ0NvbnRlbnQgbG9va3MgZ29vZCwgZmFjdC1jaGVja2VkJ1xuICAgICAgICB9LFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGVkaXRvckFjdG9yKVxuICAgICAgKTtcblxuICAgICAgZXhwZWN0KHJldmlld2VkUG9zdC51cGRhdGVkQnkpLnRvQmUoJ3VzZXItZWRpdG9yLW1pa2UnKTtcbiAgICAgIGV4cGVjdChyZXZpZXdlZFBvc3QuY3JlYXRlZEJ5KS50b0JlVW5kZWZpbmVkKCk7IC8vIFNob3VsZCBOT1QgY2hhbmdlXG4gICAgICBleHBlY3QocmV2aWV3ZWRQb3N0LnN0YXR1cykudG9CZSgndW5kZXItcmV2aWV3Jyk7XG5cbiAgICAgIC8vIFN0ZXAgMzogU3lzdGVtIGF1dG8tcHVibGlzaGVzXG4gICAgICBjb25zdCBzeXN0ZW1BY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvclR5cGU6ICdhbm9ueW1vdXMnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYXV0by1wdWJsaXNoJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMTowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2Fub255bW91cycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdzY2hlZHVsZWQtcHVibGlzaC0wMDEnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBwdWJsaXNoZWRQb3N0ID0gYXdhaXQgcG9zdFNlcnZpY2UudXBkYXRlKFxuICAgICAgICB7IHBvc3RJZDogJ2FydGljbGUtYnJlYWtpbmctbmV3cycgfSxcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1czogJ3B1Ymxpc2hlZCcsXG4gICAgICAgICAgcHVibGlzaGVkQXQ6ICcyMDI0LTAxLTE1VDExOjAwOjAwLjAwMFonXG4gICAgICAgIH0sXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoc3lzdGVtQWN0b3IpXG4gICAgICApO1xuXG4gICAgICBleHBlY3QocHVibGlzaGVkUG9zdC51cGRhdGVkQnkpLnRvQmUoJ2Fub255bW91cycpO1xuICAgICAgZXhwZWN0KHB1Ymxpc2hlZFBvc3Quc3RhdHVzKS50b0JlKCdwdWJsaXNoZWQnKTtcbiAgICAgIGV4cGVjdCgocHVibGlzaGVkUG9zdCBhcyBhbnkpLl9hY3Rvci5jb3JyZWxhdGlvbklkKS50b0JlKCdzY2hlZHVsZWQtcHVibGlzaC0wMDEnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGJ1bGsgb3BlcmF0aW9ucyB3aXRoIHNlcnZpY2UgYWN0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtaWdyYXRpb25BY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdhcGkta2V5Om1pZ3JhdGlvbi1zZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1idWxrLW1pZ3JhdGlvbicsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMDM6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYXBpS2V5OiB7XG4gICAgICAgICAgaWQ6ICdtaWdyYXRpb24ta2V5LTQ1NicsXG4gICAgICAgICAgc291cmNlOiAncmVxdWVzdC1jb250ZXh0J1xuICAgICAgICB9LFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnbWlncmF0aW9uLWJhdGNoLTIwMjQwMTE1J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobWlncmF0aW9uQWN0b3IpO1xuXG4gICAgICAvLyBTaW11bGF0ZSBidWxrIHBvc3QgbWlncmF0aW9uXG4gICAgICBjb25zdCBtaWdyYXRpb25EYXRhID0gW1xuICAgICAgICB7XG4gICAgICAgICAgcG9zdElkOiAnbWlncmF0ZWQtcG9zdC0wMDEnLFxuICAgICAgICAgIHRpdGxlOiAnTWlncmF0ZWQgUG9zdCAxJyxcbiAgICAgICAgICBjb250ZW50OiAnQ29udGVudCBmcm9tIG9sZCBzeXN0ZW0nLFxuICAgICAgICAgIHN0YXR1czogJ21pZ3JhdGVkJ1xuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcG9zdElkOiAnbWlncmF0ZWQtcG9zdC0wMDInLFxuICAgICAgICAgIHRpdGxlOiAnTWlncmF0ZWQgUG9zdCAyJyxcbiAgICAgICAgICBjb250ZW50OiAnQW5vdGhlciBwb3N0IGZyb20gb2xkIHN5c3RlbScsXG4gICAgICAgICAgc3RhdHVzOiAnbWlncmF0ZWQnXG4gICAgICAgIH1cbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IG1pZ3JhdGVkUG9zdHMgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgbWlncmF0aW9uRGF0YS5tYXAoZGF0YSA9PiBwb3N0U2VydmljZS5jcmVhdGUoZGF0YSwgY3R4KSlcbiAgICAgICk7XG5cbiAgICAgIC8vIFZlcmlmeSBhbGwgcG9zdHMgaGF2ZSBjb25zaXN0ZW50IGFjdG9yIGNvbnRleHRcbiAgICAgIG1pZ3JhdGVkUG9zdHMuZm9yRWFjaChwb3N0ID0+IHtcbiAgICAgICAgZXhwZWN0KHBvc3QuY3JlYXRlZEJ5KS50b0JlKCdhcGkta2V5Om1pZ3JhdGlvbi1zZXJ2aWNlJyk7XG4gICAgICAgIGV4cGVjdCgocG9zdCBhcyBhbnkpLl9hY3Rvci5jb3JyZWxhdGlvbklkKS50b0JlKCdtaWdyYXRpb24tYmF0Y2gtMjAyNDAxMTUnKTtcbiAgICAgICAgZXhwZWN0KHBvc3Quc3RhdHVzKS50b0JlKCdtaWdyYXRlZCcpO1xuICAgICAgICBcbiAgICAgICAgLy8gVGltZXN0YW1wcyBzaG91bGQgYmUgc3lzdGVtLWdlbmVyYXRlZFxuICAgICAgICBleHBlY3QocG9zdC5jcmVhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICAgIGV4cGVjdChuZXcgRGF0ZShwb3N0LmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=