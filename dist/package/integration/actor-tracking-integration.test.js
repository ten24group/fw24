"use strict";
/**
 * Integration test demonstrating the complete actor tracking flow
 * From API Gateway request → Actor extraction → Entity operations → Audit logging
 */
Object.defineProperty(exports, "__esModule", { value: true });
const base_service_1 = require("../entity/base-service");
const base_entity_1 = require("../entity/base-entity");
const dynamo_db_stream_audit_logger_1 = require("../audit/loggers/dynamo-db-stream-audit-logger");
const di_1 = require("../di");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const api_gateway_controller_1 = require("../core/runtime/api-gateway-controller");
// Test entity schema with actor tracking
const BlogPostSchema = (0, base_entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'blogPost',
        entityNamePlural: 'blogPosts',
        entityOperations: base_entity_1.DefaultEntityOperations,
        service: 'blog'
    },
    attributes: {
        postId: {
            type: 'string',
            required: true,
            isIdentifier: true
        },
        title: {
            type: 'string',
            required: true
        },
        content: {
            type: 'string'
        },
        status: {
            type: 'string',
            default: 'draft'
        },
        // Actor tracking fields
        createdBy: {
            type: 'string',
            isEditable: false
        },
        updatedBy: {
            type: 'string',
            isEditable: false
        },
        createdAt: {
            type: 'string',
            isEditable: false
        },
        updatedAt: {
            type: 'string',
            isEditable: false
        },
        tenantId: {
            type: 'string',
            isEditable: false
        }
    },
    indexes: {
        primary: {
            pk: {
                field: 'pk',
                composite: ['postId']
            },
            sk: {
                field: 'sk',
                composite: []
            }
        }
    }
});
// Mock Entity Service
class BlogPostService extends base_service_1.BaseEntityService {
    constructor() {
        const entityConfiguration = {
            table: 'blog-posts-table',
            client: new client_dynamodb_1.DynamoDBClient({})
        };
        super(BlogPostSchema, entityConfiguration, di_1.DIContainer.ROOT);
    }
    // Mock create method for testing
    async mockCreate(payload, ctx) {
        // This simulates the real create method with actor injection
        const payloadCopy = { ...payload };
        const enhancedPayload = this.injectActorContext(payloadCopy, 'create', ctx);
        // Mock successful creation
        return {
            data: {
                ...enhancedPayload,
                postId: 'post-123-generated'
            }
        };
    }
    // Mock update method for testing
    async mockUpdate(_identifiers, data, ctx) {
        // Simulate getting existing record
        const existingRecord = {
            postId: 'post-123',
            title: 'Original Title',
            content: 'Original Content',
            status: 'draft',
            createdBy: 'original-user',
            createdAt: '2024-01-14T10:00:00.000Z',
            _actor: {
                requestId: 'req-original',
                actorId: 'original-user',
                timestamp: '2024-01-14T10:00:00.000Z'
            }
        };
        // Inject actor context for update
        const enhancedData = this.injectActorContext(data, 'update', ctx);
        // Mock successful update
        const updatedRecord = {
            ...existingRecord,
            ...enhancedData
        };
        return {
            data: updatedRecord,
            oldImage: existingRecord,
            newImage: updatedRecord
        };
    }
}
// Use real API Controller for testing
class TestAPIController extends api_gateway_controller_1.APIController {
    initialize(event, context) {
        console.log('TEST DEBUG: Initializing API Controller', {
            event,
            context
        });
        return Promise.resolve();
    }
    // Override to make protected methods accessible for testing
    extractActorContext(event, request) {
        return super.extractActorContext(event, request);
    }
    buildCtx(event, request) {
        const context = {};
        const response = {};
        return super.buildCtx(event, context, request, response);
    }
}
// Mock audit logger
class MockAuditLogger {
    makeAuditEntry(oldImage, newImage, entityName, eventType) {
        // Extract comprehensive actor context from the hidden _actor field
        const actorContext = newImage?._actor || oldImage?._actor;
        // Fallback to visible actor fields if _actor not available (backward compatibility)
        const fallbackActor = {
            actorId: newImage?.updatedBy || newImage?.createdBy || oldImage?.updatedBy || oldImage?.createdBy,
            tenantId: newImage?.tenantId || oldImage?.tenantId,
        };
        // Get only the changed properties
        const changes = (0, dynamo_db_stream_audit_logger_1.getChangedProperties)(oldImage, newImage);
        return {
            timestamp: new Date().toISOString(),
            entityName,
            eventType,
            data: changes,
            identifiers: {
                id: newImage?.postId || oldImage?.postId
            },
            actor: actorContext || fallbackActor
        };
    }
}
describe('Actor Tracking Integration Test', () => {
    let blogService;
    let apiController;
    let auditLogger;
    beforeEach(() => {
        blogService = new BlogPostService();
        apiController = new TestAPIController();
        auditLogger = new MockAuditLogger();
        jest.clearAllMocks();
    });
    describe('Complete Actor Tracking Flow', () => {
        it('should track actor throughout complete create operation flow', async () => {
            // 1. Simulate API Gateway event with Cognito authentication
            const event = {
                resource: '/posts',
                path: '/posts',
                httpMethod: 'POST',
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'x-tenant-id': 'company-123'
                },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {
                    resourceId: 'resource-id',
                    resourcePath: '/posts',
                    httpMethod: 'POST',
                    requestId: 'api-request-123',
                    stage: 'prod',
                    accountId: '123456789012',
                    path: '/posts',
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '203.0.113.195',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: 'Mozilla/5.0',
                        user: null,
                        apiKey: null,
                        apiKeyId: null,
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    requestTime: '15/Jan/2024:10:30:00 +0000',
                    requestTimeEpoch: 1705315800000,
                    apiId: 'api-gateway-id',
                    authorizer: {
                        claims: {
                            sub: 'user-sub-789',
                            'cognito:username': 'alice.writer',
                            'cognito:groups': 'content-creators,users',
                            email: 'alice@company.com',
                            'custom:tenantId': 'company-123',
                            'custom:department': 'marketing'
                        }
                    }
                },
                body: JSON.stringify({
                    title: 'My New Blog Post',
                    content: 'This is the content of my blog post.',
                    status: 'draft'
                }),
                isBase64Encoded: false
            };
            const request = {
                requestId: 'req-unique-789',
                headers: {
                    'x-correlation-id': 'trace-abc-456',
                    'x-tenant-id': 'company-123'
                },
                body: {
                    title: 'My New Blog Post',
                    content: 'This is the content of my blog post.',
                    status: 'draft'
                }
            };
            // 2. Extract execution context with actor
            const executionContext = apiController.buildCtx(event, request);
            // Verify actor extraction
            expect(executionContext.actor).toMatchObject({
                requestId: 'req-unique-789',
                sourceIp: '203.0.113.195',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                authMethod: 'cognito',
                actorType: 'user',
                actorId: 'alice.writer',
                cognitoSub: 'user-sub-789',
                cognitoUsername: 'alice.writer',
                cognitoGroups: ['content-creators', 'users'],
                tenantId: 'company-123',
                correlationId: 'trace-abc-456',
                rawAuthContext: {
                    sub: 'user-sub-789',
                    'cognito:username': 'alice.writer',
                    'cognito:groups': 'content-creators,users',
                    email: 'alice@company.com',
                    'custom:tenantId': 'company-123',
                    'custom:department': 'marketing'
                }
            });
            // 3. Perform entity create operation
            const createResult = await blogService.mockCreate(request.body, executionContext);
            // Verify actor injection in created entity
            expect(createResult.data).toMatchObject({
                title: 'My New Blog Post',
                content: 'This is the content of my blog post.',
                status: 'draft',
                postId: 'post-123-generated',
                // Visible actor fields
                createdBy: 'alice.writer',
                updatedBy: 'alice.writer',
                tenantId: 'company-123',
                // Hidden comprehensive actor context
                _actor: executionContext.actor
            });
            expect(createResult.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(createResult.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            // 4. Simulate audit logging for the create operation
            const auditEntry = auditLogger.makeAuditEntry(undefined, // No old image for create
            createResult.data, 'blogPost', 'create');
            // Verify comprehensive audit trail
            expect(auditEntry).toMatchObject({
                entityName: 'blogPost',
                eventType: 'create',
                identifiers: {
                    id: 'post-123-generated'
                },
                actor: executionContext.actor
            });
            // Verify that audit contains full actor context including request correlation
            expect(auditEntry.actor.requestId).toBe('req-unique-789');
            expect(auditEntry.actor.correlationId).toBe('trace-abc-456');
            expect(auditEntry.actor.sourceIp).toBe('203.0.113.195');
            expect(auditEntry.actor.cognitoGroups).toContain('content-creators');
        });
        it('should track actor throughout complete update operation flow', async () => {
            // 1. Simulate different user updating the post
            const updateEvent = {
                resource: '/posts/{id}',
                path: '/posts/post-123',
                httpMethod: 'PATCH',
                headers: {
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                    'x-tenant-id': 'company-123'
                },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: { id: 'post-123' },
                stageVariables: null,
                requestContext: {
                    resourceId: 'resource-id',
                    resourcePath: '/posts/{id}',
                    httpMethod: 'PATCH',
                    requestId: 'api-request-456',
                    stage: 'prod',
                    accountId: '123456789012',
                    path: '/posts/post-123',
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '198.51.100.42',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: 'Mozilla/5.0',
                        user: null,
                        apiKey: null,
                        apiKeyId: null,
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    requestTime: '15/Jan/2024:11:45:00 +0000',
                    requestTimeEpoch: 1705320300000,
                    apiId: 'api-gateway-id',
                    authorizer: {
                        claims: {
                            sub: 'user-sub-456',
                            'cognito:username': 'bob.editor',
                            'cognito:groups': 'editors,users',
                            email: 'bob@company.com',
                            'custom:tenantId': 'company-123',
                            'custom:role': 'content-manager'
                        }
                    }
                },
                body: JSON.stringify({
                    title: 'Updated Blog Post Title',
                    status: 'published'
                }),
                isBase64Encoded: false
            };
            const updateRequest = {
                requestId: 'req-update-456',
                headers: {
                    'x-correlation-id': 'trace-update-789'
                },
                pathParameters: { id: 'post-123' },
                body: {
                    title: 'Updated Blog Post Title',
                    status: 'published'
                }
            };
            // 2. Extract execution context for update
            const updateExecutionContext = apiController.buildCtx(updateEvent, updateRequest);
            // Verify different actor for update
            expect(updateExecutionContext.actor.actorId).toBe('bob.editor');
            expect(updateExecutionContext.actor.cognitoGroups).toContain('editors');
            // 3. Perform entity update operation
            const updateResult = await blogService.mockUpdate({ postId: 'post-123' }, updateRequest.body, updateExecutionContext);
            // 4. Verify actor injection in updated entity
            expect(updateResult.data).toMatchObject({
                postId: 'post-123',
                title: 'Updated Blog Post Title',
                status: 'published',
                // Original create actor preserved
                createdBy: 'original-user',
                // New update actor
                updatedBy: 'bob.editor',
                tenantId: 'company-123',
                // New comprehensive actor context
                _actor: updateExecutionContext.actor
            });
            // 5. Simulate audit logging for the update operation
            const updateAuditEntry = auditLogger.makeAuditEntry(updateResult.oldImage, updateResult.newImage, 'blogPost', 'update');
            // Verify audit shows only changed fields
            expect(updateAuditEntry.data).toEqual({
                title: { old: 'Original Title', new: 'Updated Blog Post Title' },
                status: { old: 'draft', new: 'published' },
                updatedBy: { new: 'bob.editor' }, // old value not present since original record didn't have updatedBy
                tenantId: { new: 'company-123' } // tenantId being added
            });
            // Verify audit contains current actor context
            expect(updateAuditEntry.actor).toEqual(updateExecutionContext.actor);
            expect(updateAuditEntry.actor.actorId).toBe('bob.editor');
            expect(updateAuditEntry.actor.requestId).toBe('req-update-456');
        });
        it('should handle API key authentication in actor tracking', async () => {
            // Simulate API key authenticated request
            const apiKeyEvent = {
                resource: '/posts',
                path: '/posts',
                httpMethod: 'POST',
                headers: {
                    'user-agent': 'PostmanRuntime/7.32.3'
                },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {
                    resourceId: 'resource-id',
                    resourcePath: '/posts',
                    httpMethod: 'POST',
                    accountId: '123456789012',
                    path: '/posts',
                    requestId: 'api-key-request-789',
                    stage: 'prod',
                    authorizer: null,
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '10.0.0.100',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: 'PostmanRuntime/7.32.3',
                        user: null,
                        apiKey: 'api-key-service-123',
                        apiKeyId: 'abcd1234',
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    requestTime: '15/Jan/2024:12:00:00 +0000',
                    requestTimeEpoch: 1705321200000,
                    apiId: 'api-gateway-id'
                },
                body: JSON.stringify({
                    title: 'API Generated Post',
                    content: 'This post was created via API.',
                    status: 'published'
                }),
                isBase64Encoded: false
            };
            const apiKeyRequest = {
                requestId: 'req-api-key-789',
                headers: {},
                body: {
                    title: 'API Generated Post',
                    content: 'This post was created via API.',
                    status: 'published'
                }
            };
            // Extract execution context
            const apiKeyExecutionContext = apiController.buildCtx(apiKeyEvent, apiKeyRequest);
            // Verify API key actor
            expect(apiKeyExecutionContext.actor).toMatchObject({
                requestId: 'req-api-key-789',
                sourceIp: '10.0.0.100',
                userAgent: 'PostmanRuntime/7.32.3',
                authMethod: 'api-key',
                actorType: 'service',
                actorId: 'api-key:api-key-service-123',
                apiKeyId: 'api-key-service-123'
            });
            // Create entity with API key actor
            const apiKeyCreateResult = await blogService.mockCreate(apiKeyRequest.body, apiKeyExecutionContext);
            // Verify API key actor injection
            expect(apiKeyCreateResult.data.createdBy).toBe('api-key:api-key-service-123');
            expect(apiKeyCreateResult.data._actor.authMethod).toBe('api-key');
            expect(apiKeyCreateResult.data._actor.actorType).toBe('service');
            // Generate audit entry
            const apiKeyAuditEntry = auditLogger.makeAuditEntry(undefined, apiKeyCreateResult.data, 'blogPost', 'create');
            // Verify audit contains API key actor context
            expect(apiKeyAuditEntry.actor.authMethod).toBe('api-key');
            expect(apiKeyAuditEntry.actor.actorId).toBe('api-key:api-key-service-123');
            expect(apiKeyAuditEntry.actor.apiKeyId).toBe('api-key-service-123');
        });
        it('should demonstrate backward compatibility with existing audit records', async () => {
            // Simulate old record without _actor field
            const oldRecord = {
                postId: 'legacy-post-123',
                title: 'Legacy Post',
                content: 'This was created before actor tracking',
                createdBy: 'legacy-user',
                updatedBy: 'legacy-user',
                tenantId: 'legacy-tenant'
                // No _actor field
            };
            const newRecord = {
                postId: 'legacy-post-123',
                title: 'Updated Legacy Post',
                content: 'This was created before actor tracking',
                createdBy: 'legacy-user',
                updatedBy: 'current-user',
                tenantId: 'legacy-tenant'
                // Still no _actor field
            };
            // Generate audit entry for legacy record
            const legacyAuditEntry = auditLogger.makeAuditEntry(oldRecord, newRecord, 'blogPost', 'update');
            // Should fallback to visible actor fields
            expect(legacyAuditEntry.actor).toEqual({
                actorId: 'current-user',
                tenantId: 'legacy-tenant'
            });
            // Should still capture changes correctly
            expect(legacyAuditEntry.data).toEqual({
                title: { old: 'Legacy Post', new: 'Updated Legacy Post' },
                updatedBy: { old: 'legacy-user', new: 'current-user' }
            });
        });
    });
    describe('Error Scenarios and Edge Cases', () => {
        it('should handle missing authentication gracefully', async () => {
            const anonymousEvent = {
                resource: '/posts',
                path: '/posts',
                httpMethod: 'POST',
                headers: {},
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {
                    resourceId: 'resource-id',
                    resourcePath: '/posts',
                    httpMethod: 'POST',
                    requestId: 'anonymous-request',
                    stage: 'prod',
                    accountId: '123456789012',
                    path: '/posts',
                    authorizer: {},
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '192.0.2.1',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: null,
                        user: null,
                        apiKey: null,
                        apiKeyId: null,
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    requestTime: '15/Jan/2024:12:30:00 +0000',
                    requestTimeEpoch: 1705323000000,
                    apiId: 'api-gateway-id'
                },
                body: null,
                isBase64Encoded: false
            };
            const anonymousRequest = {
                requestId: 'req-anonymous',
                headers: {},
                body: {
                    title: 'Anonymous Post'
                }
            };
            const anonymousContext = apiController.buildCtx(anonymousEvent, anonymousRequest);
            expect(anonymousContext.actor).toMatchObject({
                requestId: 'req-anonymous',
                sourceIp: '192.0.2.1',
                authMethod: 'system',
                actorType: 'anonymous',
                actorId: 'system'
            });
            // Should still create with system actor
            const anonymousCreateResult = await blogService.mockCreate(anonymousRequest.body, anonymousContext);
            expect(anonymousCreateResult.data.createdBy).toBe('system');
            expect(anonymousCreateResult.data._actor.actorType).toBe('anonymous');
        });
        it('should handle operation without execution context', async () => {
            // This simulates old code that doesn't pass execution context
            const noContextResult = await blogService.mockCreate({
                title: 'No Context Post',
                content: 'Created without execution context'
            });
            // Should not have any actor fields
            expect(noContextResult.data).toEqual({
                title: 'No Context Post',
                content: 'Created without execution context',
                postId: 'post-123-generated'
            });
            expect(noContextResult.data).not.toHaveProperty('createdBy');
            expect(noContextResult.data).not.toHaveProperty('_actor');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0b3ItdHJhY2tpbmctaW50ZWdyYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9pbnRlZ3JhdGlvbi9hY3Rvci10cmFja2luZy1pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O0dBR0c7O0FBR0gseURBQTJEO0FBQzNELHVEQUFvRjtBQUVwRixrR0FBc0Y7QUFDdEYsOEJBQW9DO0FBRXBDLDhEQUEwRDtBQUMxRCxtRkFBdUU7QUFFdkUseUNBQXlDO0FBQ3pDLE1BQU0sY0FBYyxHQUFHLElBQUEsZ0NBQWtCLEVBQUM7SUFDeEMsS0FBSyxFQUFFO1FBQ0wsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsVUFBVTtRQUNsQixnQkFBZ0IsRUFBRSxXQUFXO1FBQzdCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6QyxPQUFPLEVBQUUsTUFBTTtLQUNoQjtJQUNELFVBQVUsRUFBRTtRQUNWLE1BQU0sRUFBRTtZQUNOLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7WUFDZCxZQUFZLEVBQUUsSUFBSTtTQUNuQjtRQUNELEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELE9BQU8sRUFBRTtZQUNQLElBQUksRUFBRSxRQUFRO1NBQ2Y7UUFDRCxNQUFNLEVBQUU7WUFDTixJQUFJLEVBQUUsUUFBUTtZQUNkLE9BQU8sRUFBRSxPQUFPO1NBQ2pCO1FBQ0Qsd0JBQXdCO1FBQ3hCLFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDbEI7UUFDRCxTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRSxLQUFLO1NBQ2xCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUUsS0FBSztTQUNsQjtRQUNE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Q0FBQyxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDNUQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBJbnRlZ3JhdGlvbiB0ZXN0IGRlbW9uc3RyYXRpbmcgdGhlIGNvbXBsZXRlIGFjdG9yIHRyYWNraW5nIGZsb3dcbiAqIEZyb20gQVBJIEdhdGV3YXkgcmVxdWVzdCDihpIgQWN0b3IgZXh0cmFjdGlvbiDihpIgRW50aXR5IG9wZXJhdGlvbnMg4oaSIEF1ZGl0IGxvZ2dpbmdcbiAqL1xuXG5pbXBvcnQgeyBBUElHYXRld2F5RXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vZW50aXR5L2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgeyBjcmVhdGVFbnRpdHlTY2hlbWEsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zIH0gZnJvbSAnLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBnZXRDaGFuZ2VkUHJvcGVydGllcyB9IGZyb20gJy4uL2F1ZGl0L2xvZ2dlcnMvZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXInO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IEFQSUNvbnRyb2xsZXIgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5cbi8vIFRlc3QgZW50aXR5IHNjaGVtYSB3aXRoIGFjdG9yIHRyYWNraW5nXG5jb25zdCBCbG9nUG9zdFNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ2Jsb2dQb3N0JyxcbiAgICBlbnRpdHlOYW1lUGx1cmFsOiAnYmxvZ1Bvc3RzJyxcbiAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICBzZXJ2aWNlOiAnYmxvZydcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIHBvc3RJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZVxuICAgIH0sXG4gICAgdGl0bGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICB9LFxuICAgIGNvbnRlbnQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgfSxcbiAgICBzdGF0dXM6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgZGVmYXVsdDogJ2RyYWZ0J1xuICAgIH0sXG4gICAgLy8gQWN0b3IgdHJhY2tpbmcgZmllbGRzXG4gICAgY3JlYXRlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICB1cGRhdGVkQnk6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2VcbiAgICB9LFxuICAgIGNyZWF0ZWRBdDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH0sXG4gICAgdXBkYXRlZEF0OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICB0ZW5hbnRJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH1cbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7XG4gICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICBjb21wb3NpdGU6IFsncG9zdElkJ11cbiAgICAgIH0sXG4gICAgICBzazoge1xuICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxufSBhcyBjb25zdCk7XG5cbi8vIE1vY2sgRW50aXR5IFNlcnZpY2VcbmNsYXNzIEJsb2dQb3N0U2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPHR5cGVvZiBCbG9nUG9zdFNjaGVtYT4ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBjb25zdCBlbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgICAgdGFibGU6ICdibG9nLXBvc3RzLXRhYmxlJyxcbiAgICAgIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KVxuICAgIH07XG4gICAgc3VwZXIoQmxvZ1Bvc3RTY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb24sIERJQ29udGFpbmVyLlJPT1QpO1xuICB9XG5cbiAgLy8gTW9jayBjcmVhdGUgbWV0aG9kIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyBhc3luYyBtb2NrQ3JlYXRlKHBheWxvYWQ6IGFueSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgIC8vIFRoaXMgc2ltdWxhdGVzIHRoZSByZWFsIGNyZWF0ZSBtZXRob2Qgd2l0aCBhY3RvciBpbmplY3Rpb25cbiAgICBjb25zdCBwYXlsb2FkQ29weSA9IHsgLi4ucGF5bG9hZCB9O1xuICAgIGNvbnN0IGVuaGFuY2VkUGF5bG9hZCA9ICh0aGlzIGFzIGFueSkuaW5qZWN0QWN0b3JDb250ZXh0KHBheWxvYWRDb3B5LCAnY3JlYXRlJywgY3R4KTtcbiAgICBcbiAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgY3JlYXRpb25cbiAgICByZXR1cm4ge1xuICAgICAgZGF0YToge1xuICAgICAgICAuLi5lbmhhbmNlZFBheWxvYWQsXG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzLWdlbmVyYXRlZCdcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLy8gTW9jayB1cGRhdGUgbWV0aG9kIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyBhc3luYyBtb2NrVXBkYXRlKF9pZGVudGlmaWVyczogYW55LCBkYXRhOiBhbnksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAvLyBTaW11bGF0ZSBnZXR0aW5nIGV4aXN0aW5nIHJlY29yZFxuICAgIGNvbnN0IGV4aXN0aW5nUmVjb3JkID0ge1xuICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgdGl0bGU6ICdPcmlnaW5hbCBUaXRsZScsXG4gICAgICBjb250ZW50OiAnT3JpZ2luYWwgQ29udGVudCcsXG4gICAgICBzdGF0dXM6ICdkcmFmdCcsXG4gICAgICBjcmVhdGVkQnk6ICdvcmlnaW5hbC11c2VyJyxcbiAgICAgIGNyZWF0ZWRBdDogJzIwMjQtMDEtMTRUMTA6MDA6MDAuMDAwWicsXG4gICAgICBfYWN0b3I6IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLW9yaWdpbmFsJyxcbiAgICAgICAgYWN0b3JJZDogJ29yaWdpbmFsLXVzZXInLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE0VDEwOjAwOjAwLjAwMFonXG4gICAgICB9XG4gICAgfTtcblxuICAgIC8vIEluamVjdCBhY3RvciBjb250ZXh0IGZvciB1cGRhdGVcbiAgICBjb25zdCBlbmhhbmNlZERhdGEgPSAodGhpcyBhcyBhbnkpLmluamVjdEFjdG9yQ29udGV4dChkYXRhLCAndXBkYXRlJywgY3R4KTtcbiAgICBcbiAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgdXBkYXRlXG4gICAgY29uc3QgdXBkYXRlZFJlY29yZCA9IHtcbiAgICAgIC4uLmV4aXN0aW5nUmVjb3JkLFxuICAgICAgLi4uZW5oYW5jZWREYXRhXG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICBkYXRhOiB1cGRhdGVkUmVjb3JkLFxuICAgICAgb2xkSW1hZ2U6IGV4aXN0aW5nUmVjb3JkLFxuICAgICAgbmV3SW1hZ2U6IHVwZGF0ZWRSZWNvcmRcbiAgICB9O1xuICB9XG59XG5cbi8vIFVzZSByZWFsIEFQSSBDb250cm9sbGVyIGZvciB0ZXN0aW5nXG5cbmNsYXNzIFRlc3RBUElDb250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gIGluaXRpYWxpemUoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnNvbGUubG9nKCdURVNUIERFQlVHOiBJbml0aWFsaXppbmcgQVBJIENvbnRyb2xsZXInLCB7XG4gICAgICBldmVudCxcbiAgICAgIGNvbnRleHRcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gT3ZlcnJpZGUgdG8gbWFrZSBwcm90ZWN0ZWQgbWV0aG9kcyBhY2Nlc3NpYmxlIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyBleHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IGFueSk6IEFjdG9yIHtcbiAgICByZXR1cm4gc3VwZXIuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG4gIH1cblxuICBwdWJsaWMgYnVpbGRDdHgoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogYW55KTogRXhlY3V0aW9uQ29udGV4dCB7XG4gICAgY29uc3QgY29udGV4dCA9IHt9IGFzIENvbnRleHQ7XG4gICAgY29uc3QgcmVzcG9uc2UgPSB7fSBhcyBhbnk7XG4gICAgcmV0dXJuIHN1cGVyLmJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG4gIH1cbn1cblxuLy8gTW9jayBhdWRpdCBsb2dnZXJcbmNsYXNzIE1vY2tBdWRpdExvZ2dlciB7XG4gIHB1YmxpYyBtYWtlQXVkaXRFbnRyeShvbGRJbWFnZTogYW55LCBuZXdJbWFnZTogYW55LCBlbnRpdHlOYW1lOiBzdHJpbmcsIGV2ZW50VHlwZTogc3RyaW5nKSB7XG4gICAgLy8gRXh0cmFjdCBjb21wcmVoZW5zaXZlIGFjdG9yIGNvbnRleHQgZnJvbSB0aGUgaGlkZGVuIF9hY3RvciBmaWVsZFxuICAgIGNvbnN0IGFjdG9yQ29udGV4dCA9IG5ld0ltYWdlPy5fYWN0b3IgfHwgb2xkSW1hZ2U/Ll9hY3RvcjtcbiAgICBcbiAgICAvLyBGYWxsYmFjayB0byB2aXNpYmxlIGFjdG9yIGZpZWxkcyBpZiBfYWN0b3Igbm90IGF2YWlsYWJsZSAoYmFja3dhcmQgY29tcGF0aWJpbGl0eSlcbiAgICBjb25zdCBmYWxsYmFja0FjdG9yID0ge1xuICAgICAgYWN0b3JJZDogbmV3SW1hZ2U/LnVwZGF0ZWRCeSB8fCBuZXdJbWFnZT8uY3JlYXRlZEJ5IHx8IG9sZEltYWdlPy51cGRhdGVkQnkgfHwgb2xkSW1hZ2U/LmNyZWF0ZWRCeSxcbiAgICAgIHRlbmFudElkOiBuZXdJbWFnZT8udGVuYW50SWQgfHwgb2xkSW1hZ2U/LnRlbmFudElkLFxuICAgIH07XG5cbiAgICAvLyBHZXQgb25seSB0aGUgY2hhbmdlZCBwcm9wZXJ0aWVzXG4gICAgY29uc3QgY2hhbmdlcyA9IGdldENoYW5nZWRQcm9wZXJ0aWVzKG9sZEltYWdlLCBuZXdJbWFnZSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZXZlbnRUeXBlLFxuICAgICAgZGF0YTogY2hhbmdlcyxcbiAgICAgIGlkZW50aWZpZXJzOiB7XG4gICAgICAgIGlkOiBuZXdJbWFnZT8ucG9zdElkIHx8IG9sZEltYWdlPy5wb3N0SWRcbiAgICAgIH0sXG4gICAgICBhY3RvcjogYWN0b3JDb250ZXh0IHx8IGZhbGxiYWNrQWN0b3JcbiAgICB9O1xuICB9XG59XG5cbmRlc2NyaWJlKCdBY3RvciBUcmFja2luZyBJbnRlZ3JhdGlvbiBUZXN0JywgKCkgPT4ge1xuICBsZXQgYmxvZ1NlcnZpY2U6IEJsb2dQb3N0U2VydmljZTtcbiAgbGV0IGFwaUNvbnRyb2xsZXI6IFRlc3RBUElDb250cm9sbGVyO1xuICBsZXQgYXVkaXRMb2dnZXI6IE1vY2tBdWRpdExvZ2dlcjtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBibG9nU2VydmljZSA9IG5ldyBCbG9nUG9zdFNlcnZpY2UoKTtcbiAgICBhcGlDb250cm9sbGVyID0gbmV3IFRlc3RBUElDb250cm9sbGVyKCk7XG4gICAgYXVkaXRMb2dnZXIgPSBuZXcgTW9ja0F1ZGl0TG9nZ2VyKCk7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDb21wbGV0ZSBBY3RvciBUcmFja2luZyBGbG93JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdHJhY2sgYWN0b3IgdGhyb3VnaG91dCBjb21wbGV0ZSBjcmVhdGUgb3BlcmF0aW9uIGZsb3cnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyAxLiBTaW11bGF0ZSBBUEkgR2F0ZXdheSBldmVudCB3aXRoIENvZ25pdG8gYXV0aGVudGljYXRpb25cbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5RXZlbnQgPSB7XG4gICAgICAgIHJlc291cmNlOiAnL3Bvc3RzJyxcbiAgICAgICAgcGF0aDogJy9wb3N0cycsXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd1c2VyLWFnZW50JzogJ01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNicsXG4gICAgICAgICAgJ3gtdGVuYW50LWlkJzogJ2NvbXBhbnktMTIzJ1xuICAgICAgICB9LFxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIHJlc291cmNlSWQ6ICdyZXNvdXJjZS1pZCcsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgcmVxdWVzdElkOiAnYXBpLXJlcXVlc3QtMTIzJyxcbiAgICAgICAgICBzdGFnZTogJ3Byb2QnLFxuICAgICAgICAgIGFjY291bnRJZDogJzEyMzQ1Njc4OTAxMicsXG4gICAgICAgICAgcGF0aDogJy9wb3N0cycsXG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY291bnRJZDogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxuICAgICAgICAgICAgY2FsbGVyOiBudWxsLFxuICAgICAgICAgICAgc291cmNlSXA6ICcyMDMuMC4xMTMuMTk1JyxcbiAgICAgICAgICAgIHByaW5jaXBhbE9yZ0lkOiBudWxsLFxuICAgICAgICAgICAgYWNjZXNzS2V5OiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblByb3ZpZGVyOiBudWxsLFxuICAgICAgICAgICAgdXNlckFybjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICAgIHVzZXI6IG51bGwsXG4gICAgICAgICAgICBhcGlLZXk6IG51bGwsXG4gICAgICAgICAgICBhcGlLZXlJZDogbnVsbCxcbiAgICAgICAgICAgIGNsaWVudENlcnQ6IG51bGxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHByb3RvY29sOiAnSFRUUC8xLjEnLFxuICAgICAgICAgIHJlcXVlc3RUaW1lOiAnMTUvSmFuLzIwMjQ6MTA6MzA6MDAgKzAwMDAnLFxuICAgICAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IDE3MDUzMTU4MDAwMDAsXG4gICAgICAgICAgYXBpSWQ6ICdhcGktZ2F0ZXdheS1pZCcsXG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItc3ViLTc4OScsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2FsaWNlLndyaXRlcicsXG4gICAgICAgICAgICAgICdjb2duaXRvOmdyb3Vwcyc6ICdjb250ZW50LWNyZWF0b3JzLHVzZXJzJyxcbiAgICAgICAgICAgICAgZW1haWw6ICdhbGljZUBjb21wYW55LmNvbScsXG4gICAgICAgICAgICAgICdjdXN0b206dGVuYW50SWQnOiAnY29tcGFueS0xMjMnLFxuICAgICAgICAgICAgICAnY3VzdG9tOmRlcGFydG1lbnQnOiAnbWFya2V0aW5nJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnksXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB0aXRsZTogJ015IE5ldyBCbG9nIFBvc3QnLFxuICAgICAgICAgIGNvbnRlbnQ6ICdUaGlzIGlzIHRoZSBjb250ZW50IG9mIG15IGJsb2cgcG9zdC4nLFxuICAgICAgICAgIHN0YXR1czogJ2RyYWZ0J1xuICAgICAgICB9KSxcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXVuaXF1ZS03ODknLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3gtY29ycmVsYXRpb24taWQnOiAndHJhY2UtYWJjLTQ1NicsXG4gICAgICAgICAgJ3gtdGVuYW50LWlkJzogJ2NvbXBhbnktMTIzJ1xuICAgICAgICB9LFxuICAgICAgICBib2R5OiB7XG4gICAgICAgICAgdGl0bGU6ICdNeSBOZXcgQmxvZyBQb3N0JyxcbiAgICAgICAgICBjb250ZW50OiAnVGhpcyBpcyB0aGUgY29udGVudCBvZiBteSBibG9nIHBvc3QuJyxcbiAgICAgICAgICBzdGF0dXM6ICdkcmFmdCdcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgLy8gMi4gRXh0cmFjdCBleGVjdXRpb24gY29udGV4dCB3aXRoIGFjdG9yXG4gICAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gKGFwaUNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIC8vIFZlcmlmeSBhY3RvciBleHRyYWN0aW9uXG4gICAgICBleHBlY3QoZXhlY3V0aW9uQ29udGV4dC5hY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS11bmlxdWUtNzg5JyxcbiAgICAgICAgc291cmNlSXA6ICcyMDMuMC4xMTMuMTk1JyxcbiAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2JyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYWN0b3JJZDogJ2FsaWNlLndyaXRlcicsXG4gICAgICAgIGNvZ25pdG9TdWI6ICd1c2VyLXN1Yi03ODknLFxuICAgICAgICBjb2duaXRvVXNlcm5hbWU6ICdhbGljZS53cml0ZXInLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiBbJ2NvbnRlbnQtY3JlYXRvcnMnLCAndXNlcnMnXSxcbiAgICAgICAgdGVuYW50SWQ6ICdjb21wYW55LTEyMycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0cmFjZS1hYmMtNDU2JyxcbiAgICAgICAgcmF3QXV0aENvbnRleHQ6IHtcbiAgICAgICAgICBzdWI6ICd1c2VyLXN1Yi03ODknLFxuICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2FsaWNlLndyaXRlcicsXG4gICAgICAgICAgJ2NvZ25pdG86Z3JvdXBzJzogJ2NvbnRlbnQtY3JlYXRvcnMsdXNlcnMnLFxuICAgICAgICAgIGVtYWlsOiAnYWxpY2VAY29tcGFueS5jb20nLFxuICAgICAgICAgICdjdXN0b206dGVuYW50SWQnOiAnY29tcGFueS0xMjMnLFxuICAgICAgICAgICdjdXN0b206ZGVwYXJ0bWVudCc6ICdtYXJrZXRpbmcnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyAzLiBQZXJmb3JtIGVudGl0eSBjcmVhdGUgb3BlcmF0aW9uXG4gICAgICBjb25zdCBjcmVhdGVSZXN1bHQgPSBhd2FpdCBibG9nU2VydmljZS5tb2NrQ3JlYXRlKHJlcXVlc3QuYm9keSwgZXhlY3V0aW9uQ29udGV4dCk7XG5cbiAgICAgIC8vIFZlcmlmeSBhY3RvciBpbmplY3Rpb24gaW4gY3JlYXRlZCBlbnRpdHlcbiAgICAgIGV4cGVjdChjcmVhdGVSZXN1bHQuZGF0YSkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHRpdGxlOiAnTXkgTmV3IEJsb2cgUG9zdCcsXG4gICAgICAgIGNvbnRlbnQ6ICdUaGlzIGlzIHRoZSBjb250ZW50IG9mIG15IGJsb2cgcG9zdC4nLFxuICAgICAgICBzdGF0dXM6ICdkcmFmdCcsXG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzLWdlbmVyYXRlZCcsXG4gICAgICAgIC8vIFZpc2libGUgYWN0b3IgZmllbGRzXG4gICAgICAgIGNyZWF0ZWRCeTogJ2FsaWNlLndyaXRlcicsXG4gICAgICAgIHVwZGF0ZWRCeTogJ2FsaWNlLndyaXRlcicsXG4gICAgICAgIHRlbmFudElkOiAnY29tcGFueS0xMjMnLFxuICAgICAgICAvLyBIaWRkZW4gY29tcHJlaGVuc2l2ZSBhY3RvciBjb250ZXh0XG4gICAgICAgIF9hY3RvcjogZXhlY3V0aW9uQ29udGV4dC5hY3RvclxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY3JlYXRlUmVzdWx0LmRhdGEuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KGNyZWF0ZVJlc3VsdC5kYXRhLnVwZGF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcblxuICAgICAgLy8gNC4gU2ltdWxhdGUgYXVkaXQgbG9nZ2luZyBmb3IgdGhlIGNyZWF0ZSBvcGVyYXRpb25cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSBhdWRpdExvZ2dlci5tYWtlQXVkaXRFbnRyeShcbiAgICAgICAgdW5kZWZpbmVkLCAvLyBObyBvbGQgaW1hZ2UgZm9yIGNyZWF0ZVxuICAgICAgICBjcmVhdGVSZXN1bHQuZGF0YSxcbiAgICAgICAgJ2Jsb2dQb3N0JyxcbiAgICAgICAgJ2NyZWF0ZSdcbiAgICAgICk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb21wcmVoZW5zaXZlIGF1ZGl0IHRyYWlsXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeSkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGVudGl0eU5hbWU6ICdibG9nUG9zdCcsXG4gICAgICAgIGV2ZW50VHlwZTogJ2NyZWF0ZScsXG4gICAgICAgIGlkZW50aWZpZXJzOiB7XG4gICAgICAgICAgaWQ6ICdwb3N0LTEyMy1nZW5lcmF0ZWQnXG4gICAgICAgIH0sXG4gICAgICAgIGFjdG9yOiBleGVjdXRpb25Db250ZXh0LmFjdG9yXG4gICAgICB9KTtcblxuICAgICAgLy8gVmVyaWZ5IHRoYXQgYXVkaXQgY29udGFpbnMgZnVsbCBhY3RvciBjb250ZXh0IGluY2x1ZGluZyByZXF1ZXN0IGNvcnJlbGF0aW9uXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5yZXF1ZXN0SWQpLnRvQmUoJ3JlcS11bmlxdWUtNzg5Jyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5jb3JyZWxhdGlvbklkKS50b0JlKCd0cmFjZS1hYmMtNDU2Jyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5zb3VyY2VJcCkudG9CZSgnMjAzLjAuMTEzLjE5NScpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuY29nbml0b0dyb3VwcykudG9Db250YWluKCdjb250ZW50LWNyZWF0b3JzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRyYWNrIGFjdG9yIHRocm91Z2hvdXQgY29tcGxldGUgdXBkYXRlIG9wZXJhdGlvbiBmbG93JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gMS4gU2ltdWxhdGUgZGlmZmVyZW50IHVzZXIgdXBkYXRpbmcgdGhlIHBvc3RcbiAgICAgIGNvbnN0IHVwZGF0ZUV2ZW50OiBBUElHYXRld2F5RXZlbnQgPSB7XG4gICAgICAgIHJlc291cmNlOiAnL3Bvc3RzL3tpZH0nLFxuICAgICAgICBwYXRoOiAnL3Bvc3RzL3Bvc3QtMTIzJyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BBVENIJyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd1c2VyLWFnZW50JzogJ01vemlsbGEvNS4wIChNYWNpbnRvc2g7IEludGVsIE1hYyBPUyBYIDEwXzE1XzcpJyxcbiAgICAgICAgICAneC10ZW5hbnQtaWQnOiAnY29tcGFueS0xMjMnXG4gICAgICAgIH0sXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJ3Bvc3QtMTIzJyB9LFxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICByZXNvdXJjZUlkOiAncmVzb3VyY2UtaWQnLFxuICAgICAgICAgIHJlc291cmNlUGF0aDogJy9wb3N0cy97aWR9JyxcbiAgICAgICAgICBodHRwTWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgICAgIHJlcXVlc3RJZDogJ2FwaS1yZXF1ZXN0LTQ1NicsXG4gICAgICAgICAgc3RhZ2U6ICdwcm9kJyxcbiAgICAgICAgICBhY2NvdW50SWQ6ICcxMjM0NTY3ODkwMTInLFxuICAgICAgICAgIHBhdGg6ICcvcG9zdHMvcG9zdC0xMjMnLFxuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlJZDogbnVsbCxcbiAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTk4LjUxLjEwMC40MicsXG4gICAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblR5cGU6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXG4gICAgICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgICB1c2VyOiBudWxsLFxuICAgICAgICAgICAgYXBpS2V5OiBudWxsLFxuICAgICAgICAgICAgYXBpS2V5SWQ6IG51bGwsXG4gICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgICAgICByZXF1ZXN0VGltZTogJzE1L0phbi8yMDI0OjExOjQ1OjAwICswMDAwJyxcbiAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNzA1MzIwMzAwMDAwLFxuICAgICAgICAgIGFwaUlkOiAnYXBpLWdhdGV3YXktaWQnLFxuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLXN1Yi00NTYnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdib2IuZWRpdG9yJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86Z3JvdXBzJzogJ2VkaXRvcnMsdXNlcnMnLFxuICAgICAgICAgICAgICBlbWFpbDogJ2JvYkBjb21wYW55LmNvbScsXG4gICAgICAgICAgICAgICdjdXN0b206dGVuYW50SWQnOiAnY29tcGFueS0xMjMnLFxuICAgICAgICAgICAgICAnY3VzdG9tOnJvbGUnOiAnY29udGVudC1tYW5hZ2VyJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnksXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgQmxvZyBQb3N0IFRpdGxlJyxcbiAgICAgICAgICBzdGF0dXM6ICdwdWJsaXNoZWQnXG4gICAgICAgIH0pLFxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB1cGRhdGVSZXF1ZXN0ID0ge1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdXBkYXRlLTQ1NicsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAneC1jb3JyZWxhdGlvbi1pZCc6ICd0cmFjZS11cGRhdGUtNzg5J1xuICAgICAgICB9LFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJ3Bvc3QtMTIzJyB9LFxuICAgICAgICBib2R5OiB7XG4gICAgICAgICAgdGl0bGU6ICdVcGRhdGVkIEJsb2cgUG9zdCBUaXRsZScsXG4gICAgICAgICAgc3RhdHVzOiAncHVibGlzaGVkJ1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICAvLyAyLiBFeHRyYWN0IGV4ZWN1dGlvbiBjb250ZXh0IGZvciB1cGRhdGVcbiAgICAgIGNvbnN0IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQgPSAoYXBpQ29udHJvbGxlciBhcyBhbnkpLmJ1aWxkQ3R4KHVwZGF0ZUV2ZW50LCB1cGRhdGVSZXF1ZXN0KTtcblxuICAgICAgLy8gVmVyaWZ5IGRpZmZlcmVudCBhY3RvciBmb3IgdXBkYXRlXG4gICAgICBleHBlY3QodXBkYXRlRXhlY3V0aW9uQ29udGV4dC5hY3Rvci5hY3RvcklkKS50b0JlKCdib2IuZWRpdG9yJyk7XG4gICAgICBleHBlY3QodXBkYXRlRXhlY3V0aW9uQ29udGV4dC5hY3Rvci5jb2duaXRvR3JvdXBzKS50b0NvbnRhaW4oJ2VkaXRvcnMnKTtcblxuICAgICAgLy8gMy4gUGVyZm9ybSBlbnRpdHkgdXBkYXRlIG9wZXJhdGlvblxuICAgICAgY29uc3QgdXBkYXRlUmVzdWx0ID0gYXdhaXQgYmxvZ1NlcnZpY2UubW9ja1VwZGF0ZShcbiAgICAgICAgeyBwb3N0SWQ6ICdwb3N0LTEyMycgfSxcbiAgICAgICAgdXBkYXRlUmVxdWVzdC5ib2R5LFxuICAgICAgICB1cGRhdGVFeGVjdXRpb25Db250ZXh0XG4gICAgICApO1xuXG4gICAgICAvLyA0LiBWZXJpZnkgYWN0b3IgaW5qZWN0aW9uIGluIHVwZGF0ZWQgZW50aXR5XG4gICAgICBleHBlY3QodXBkYXRlUmVzdWx0LmRhdGEpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgIHRpdGxlOiAnVXBkYXRlZCBCbG9nIFBvc3QgVGl0bGUnLFxuICAgICAgICBzdGF0dXM6ICdwdWJsaXNoZWQnLFxuICAgICAgICAvLyBPcmlnaW5hbCBjcmVhdGUgYWN0b3IgcHJlc2VydmVkXG4gICAgICAgIGNyZWF0ZWRCeTogJ29yaWdpbmFsLXVzZXInLFxuICAgICAgICAvLyBOZXcgdXBkYXRlIGFjdG9yXG4gICAgICAgIHVwZGF0ZWRCeTogJ2JvYi5lZGl0b3InLFxuICAgICAgICB0ZW5hbnRJZDogJ2NvbXBhbnktMTIzJyxcbiAgICAgICAgLy8gTmV3IGNvbXByZWhlbnNpdmUgYWN0b3IgY29udGV4dFxuICAgICAgICBfYWN0b3I6IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3JcbiAgICAgIH0pO1xuXG4gICAgICAvLyA1LiBTaW11bGF0ZSBhdWRpdCBsb2dnaW5nIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvblxuICAgICAgY29uc3QgdXBkYXRlQXVkaXRFbnRyeSA9IGF1ZGl0TG9nZ2VyLm1ha2VBdWRpdEVudHJ5KFxuICAgICAgICB1cGRhdGVSZXN1bHQub2xkSW1hZ2UsXG4gICAgICAgIHVwZGF0ZVJlc3VsdC5uZXdJbWFnZSxcbiAgICAgICAgJ2Jsb2dQb3N0JyxcbiAgICAgICAgJ3VwZGF0ZSdcbiAgICAgICk7XG5cbiAgICAgIC8vIFZlcmlmeSBhdWRpdCBzaG93cyBvbmx5IGNoYW5nZWQgZmllbGRzXG4gICAgICBleHBlY3QodXBkYXRlQXVkaXRFbnRyeS5kYXRhKS50b0VxdWFsKHtcbiAgICAgICAgdGl0bGU6IHsgb2xkOiAnT3JpZ2luYWwgVGl0bGUnLCBuZXc6ICdVcGRhdGVkIEJsb2cgUG9zdCBUaXRsZScgfSxcbiAgICAgICAgc3RhdHVzOiB7IG9sZDogJ2RyYWZ0JywgbmV3OiAncHVibGlzaGVkJyB9LFxuICAgICAgICB1cGRhdGVkQnk6IHsgbmV3OiAnYm9iLmVkaXRvcicgfSwgLy8gb2xkIHZhbHVlIG5vdCBwcmVzZW50IHNpbmNlIG9yaWdpbmFsIHJlY29yZCBkaWRuJ3QgaGF2ZSB1cGRhdGVkQnlcbiAgICAgICAgdGVuYW50SWQ6IHsgbmV3OiAnY29tcGFueS0xMjMnIH0gLy8gdGVuYW50SWQgYmVpbmcgYWRkZWRcbiAgICAgIH0pO1xuXG4gICAgICAvLyBWZXJpZnkgYXVkaXQgY29udGFpbnMgY3VycmVudCBhY3RvciBjb250ZXh0XG4gICAgICBleHBlY3QodXBkYXRlQXVkaXRFbnRyeS5hY3RvcikudG9FcXVhbCh1cGRhdGVFeGVjdXRpb25Db250ZXh0LmFjdG9yKTtcbiAgICAgIGV4cGVjdCh1cGRhdGVBdWRpdEVudHJ5LmFjdG9yLmFjdG9ySWQpLnRvQmUoJ2JvYi5lZGl0b3InKTtcbiAgICAgIGV4cGVjdCh1cGRhdGVBdWRpdEVudHJ5LmFjdG9yLnJlcXVlc3RJZCkudG9CZSgncmVxLXVwZGF0ZS00NTYnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIEFQSSBrZXkgYXV0aGVudGljYXRpb24gaW4gYWN0b3IgdHJhY2tpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTaW11bGF0ZSBBUEkga2V5IGF1dGhlbnRpY2F0ZWQgcmVxdWVzdFxuICAgICAgY29uc3QgYXBpS2V5RXZlbnQ6IEFQSUdhdGV3YXlFdmVudCA9IHtcbiAgICAgICAgcmVzb3VyY2U6ICcvcG9zdHMnLFxuICAgICAgICBwYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3VzZXItYWdlbnQnOiAnUG9zdG1hblJ1bnRpbWUvNy4zMi4zJ1xuICAgICAgICB9LFxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIHJlc291cmNlSWQ6ICdyZXNvdXJjZS1pZCcsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgYWNjb3VudElkOiAnMTIzNDU2Nzg5MDEyJyxcbiAgICAgICAgICBwYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgICByZXF1ZXN0SWQ6ICdhcGkta2V5LXJlcXVlc3QtNzg5JyxcbiAgICAgICAgICBzdGFnZTogJ3Byb2QnLFxuICAgICAgICAgIGF1dGhvcml6ZXI6IG51bGwgYXMgYW55LFxuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlJZDogbnVsbCxcbiAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTAuMC4wLjEwMCcsXG4gICAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblR5cGU6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXG4gICAgICAgICAgICB1c2VyQWdlbnQ6ICdQb3N0bWFuUnVudGltZS83LjMyLjMnLFxuICAgICAgICAgICAgdXNlcjogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleTogJ2FwaS1rZXktc2VydmljZS0xMjMnLFxuICAgICAgICAgICAgYXBpS2V5SWQ6ICdhYmNkMTIzNCcsXG4gICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgICAgICByZXF1ZXN0VGltZTogJzE1L0phbi8yMDI0OjEyOjAwOjAwICswMDAwJyxcbiAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNzA1MzIxMjAwMDAwLFxuICAgICAgICAgIGFwaUlkOiAnYXBpLWdhdGV3YXktaWQnXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB0aXRsZTogJ0FQSSBHZW5lcmF0ZWQgUG9zdCcsXG4gICAgICAgICAgY29udGVudDogJ1RoaXMgcG9zdCB3YXMgY3JlYXRlZCB2aWEgQVBJLicsXG4gICAgICAgICAgc3RhdHVzOiAncHVibGlzaGVkJ1xuICAgICAgICB9KSxcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZVxuICAgICAgfTtcblxuICAgICAgY29uc3QgYXBpS2V5UmVxdWVzdCA9IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFwaS1rZXktNzg5JyxcbiAgICAgICAgaGVhZGVyczoge30sXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB0aXRsZTogJ0FQSSBHZW5lcmF0ZWQgUG9zdCcsXG4gICAgICAgICAgY29udGVudDogJ1RoaXMgcG9zdCB3YXMgY3JlYXRlZCB2aWEgQVBJLicsXG4gICAgICAgICAgc3RhdHVzOiAncHVibGlzaGVkJ1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICAvLyBFeHRyYWN0IGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjb25zdCBhcGlLZXlFeGVjdXRpb25Db250ZXh0ID0gKGFwaUNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eChhcGlLZXlFdmVudCwgYXBpS2V5UmVxdWVzdCk7XG5cbiAgICAgIC8vIFZlcmlmeSBBUEkga2V5IGFjdG9yXG4gICAgICBleHBlY3QoYXBpS2V5RXhlY3V0aW9uQ29udGV4dC5hY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1hcGkta2V5LTc4OScsXG4gICAgICAgIHNvdXJjZUlwOiAnMTAuMC4wLjEwMCcsXG4gICAgICAgIHVzZXJBZ2VudDogJ1Bvc3RtYW5SdW50aW1lLzcuMzIuMycsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIGFjdG9ySWQ6ICdhcGkta2V5OmFwaS1rZXktc2VydmljZS0xMjMnLFxuICAgICAgICBhcGlLZXlJZDogJ2FwaS1rZXktc2VydmljZS0xMjMnXG4gICAgICB9KTtcblxuICAgICAgLy8gQ3JlYXRlIGVudGl0eSB3aXRoIEFQSSBrZXkgYWN0b3JcbiAgICAgIGNvbnN0IGFwaUtleUNyZWF0ZVJlc3VsdCA9IGF3YWl0IGJsb2dTZXJ2aWNlLm1vY2tDcmVhdGUoYXBpS2V5UmVxdWVzdC5ib2R5LCBhcGlLZXlFeGVjdXRpb25Db250ZXh0KTtcblxuICAgICAgLy8gVmVyaWZ5IEFQSSBrZXkgYWN0b3IgaW5qZWN0aW9uXG4gICAgICBleHBlY3QoYXBpS2V5Q3JlYXRlUmVzdWx0LmRhdGEuY3JlYXRlZEJ5KS50b0JlKCdhcGkta2V5OmFwaS1rZXktc2VydmljZS0xMjMnKTtcbiAgICAgIGV4cGVjdCgoYXBpS2V5Q3JlYXRlUmVzdWx0LmRhdGEgYXMgYW55KS5fYWN0b3IuYXV0aE1ldGhvZCkudG9CZSgnYXBpLWtleScpO1xuICAgICAgZXhwZWN0KChhcGlLZXlDcmVhdGVSZXN1bHQuZGF0YSBhcyBhbnkpLl9hY3Rvci5hY3RvclR5cGUpLnRvQmUoJ3NlcnZpY2UnKTtcblxuICAgICAgLy8gR2VuZXJhdGUgYXVkaXQgZW50cnlcbiAgICAgIGNvbnN0IGFwaUtleUF1ZGl0RW50cnkgPSBhdWRpdExvZ2dlci5tYWtlQXVkaXRFbnRyeShcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICBhcGlLZXlDcmVhdGVSZXN1bHQuZGF0YSxcbiAgICAgICAgJ2Jsb2dQb3N0JyxcbiAgICAgICAgJ2NyZWF0ZSdcbiAgICAgICk7XG5cbiAgICAgIC8vIFZlcmlmeSBhdWRpdCBjb250YWlucyBBUEkga2V5IGFjdG9yIGNvbnRleHRcbiAgICAgIGV4cGVjdChhcGlLZXlBdWRpdEVudHJ5LmFjdG9yLmF1dGhNZXRob2QpLnRvQmUoJ2FwaS1rZXknKTtcbiAgICAgIGV4cGVjdChhcGlLZXlBdWRpdEVudHJ5LmFjdG9yLmFjdG9ySWQpLnRvQmUoJ2FwaS1rZXk6YXBpLWtleS1zZXJ2aWNlLTEyMycpO1xuICAgICAgZXhwZWN0KGFwaUtleUF1ZGl0RW50cnkuYWN0b3IuYXBpS2V5SWQpLnRvQmUoJ2FwaS1rZXktc2VydmljZS0xMjMnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZGVtb25zdHJhdGUgYmFja3dhcmQgY29tcGF0aWJpbGl0eSB3aXRoIGV4aXN0aW5nIGF1ZGl0IHJlY29yZHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTaW11bGF0ZSBvbGQgcmVjb3JkIHdpdGhvdXQgX2FjdG9yIGZpZWxkXG4gICAgICBjb25zdCBvbGRSZWNvcmQgPSB7XG4gICAgICAgIHBvc3RJZDogJ2xlZ2FjeS1wb3N0LTEyMycsXG4gICAgICAgIHRpdGxlOiAnTGVnYWN5IFBvc3QnLFxuICAgICAgICBjb250ZW50OiAnVGhpcyB3YXMgY3JlYXRlZCBiZWZvcmUgYWN0b3IgdHJhY2tpbmcnLFxuICAgICAgICBjcmVhdGVkQnk6ICdsZWdhY3ktdXNlcicsXG4gICAgICAgIHVwZGF0ZWRCeTogJ2xlZ2FjeS11c2VyJyxcbiAgICAgICAgdGVuYW50SWQ6ICdsZWdhY3ktdGVuYW50J1xuICAgICAgICAvLyBObyBfYWN0b3IgZmllbGRcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG5ld1JlY29yZCA9IHtcbiAgICAgICAgcG9zdElkOiAnbGVnYWN5LXBvc3QtMTIzJyxcbiAgICAgICAgdGl0bGU6ICdVcGRhdGVkIExlZ2FjeSBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgd2FzIGNyZWF0ZWQgYmVmb3JlIGFjdG9yIHRyYWNraW5nJyxcbiAgICAgICAgY3JlYXRlZEJ5OiAnbGVnYWN5LXVzZXInLFxuICAgICAgICB1cGRhdGVkQnk6ICdjdXJyZW50LXVzZXInLFxuICAgICAgICB0ZW5hbnRJZDogJ2xlZ2FjeS10ZW5hbnQnXG4gICAgICAgIC8vIFN0aWxsIG5vIF9hY3RvciBmaWVsZFxuICAgICAgfTtcblxuICAgICAgLy8gR2VuZXJhdGUgYXVkaXQgZW50cnkgZm9yIGxlZ2FjeSByZWNvcmRcbiAgICAgIGNvbnN0IGxlZ2FjeUF1ZGl0RW50cnkgPSBhdWRpdExvZ2dlci5tYWtlQXVkaXRFbnRyeShcbiAgICAgICAgb2xkUmVjb3JkLFxuICAgICAgICBuZXdSZWNvcmQsXG4gICAgICAgICdibG9nUG9zdCcsXG4gICAgICAgICd1cGRhdGUnXG4gICAgICApO1xuXG4gICAgICAvLyBTaG91bGQgZmFsbGJhY2sgdG8gdmlzaWJsZSBhY3RvciBmaWVsZHNcbiAgICAgIGV4cGVjdChsZWdhY3lBdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKHtcbiAgICAgICAgYWN0b3JJZDogJ2N1cnJlbnQtdXNlcicsXG4gICAgICAgIHRlbmFudElkOiAnbGVnYWN5LXRlbmFudCdcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTaG91bGQgc3RpbGwgY2FwdHVyZSBjaGFuZ2VzIGNvcnJlY3RseVxuICAgICAgZXhwZWN0KGxlZ2FjeUF1ZGl0RW50cnkuZGF0YSkudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiB7IG9sZDogJ0xlZ2FjeSBQb3N0JywgbmV3OiAnVXBkYXRlZCBMZWdhY3kgUG9zdCcgfSxcbiAgICAgICAgdXBkYXRlZEJ5OiB7IG9sZDogJ2xlZ2FjeS11c2VyJywgbmV3OiAnY3VycmVudC11c2VyJyB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0Vycm9yIFNjZW5hcmlvcyBhbmQgRWRnZSBDYXNlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaXNzaW5nIGF1dGhlbnRpY2F0aW9uIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhbm9ueW1vdXNFdmVudDogQVBJR2F0ZXdheUV2ZW50ID0ge1xuICAgICAgICByZXNvdXJjZTogJy9wb3N0cycsXG4gICAgICAgIHBhdGg6ICcvcG9zdHMnLFxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIGhlYWRlcnM6IHt9LFxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIHJlc291cmNlSWQ6ICdyZXNvdXJjZS1pZCcsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgcmVxdWVzdElkOiAnYW5vbnltb3VzLXJlcXVlc3QnLFxuICAgICAgICAgIHN0YWdlOiAncHJvZCcsXG4gICAgICAgICAgYWNjb3VudElkOiAnMTIzNDU2Nzg5MDEyJyxcbiAgICAgICAgICBwYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgICBhdXRob3JpemVyOiB7fSBhcyBhbnksXG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY291bnRJZDogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxuICAgICAgICAgICAgY2FsbGVyOiBudWxsLFxuICAgICAgICAgICAgc291cmNlSXA6ICcxOTIuMC4yLjEnLFxuICAgICAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2Nlc3NLZXk6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25UeXBlOiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXG4gICAgICAgICAgICB1c2VyQXJuOiBudWxsLFxuICAgICAgICAgICAgdXNlckFnZW50OiBudWxsLFxuICAgICAgICAgICAgdXNlcjogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleTogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleUlkOiBudWxsLFxuICAgICAgICAgICAgY2xpZW50Q2VydDogbnVsbFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXG4gICAgICAgICAgcmVxdWVzdFRpbWU6ICcxNS9KYW4vMjAyNDoxMjozMDowMCArMDAwMCcsXG4gICAgICAgICAgcmVxdWVzdFRpbWVFcG9jaDogMTcwNTMyMzAwMDAwMCxcbiAgICAgICAgICBhcGlJZDogJ2FwaS1nYXRld2F5LWlkJ1xuICAgICAgICB9LFxuICAgICAgICBib2R5OiBudWxsLFxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhbm9ueW1vdXNSZXF1ZXN0ID0ge1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYW5vbnltb3VzJyxcbiAgICAgICAgaGVhZGVyczoge30sXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB0aXRsZTogJ0Fub255bW91cyBQb3N0J1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhbm9ueW1vdXNDb250ZXh0ID0gKGFwaUNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eChhbm9ueW1vdXNFdmVudCwgYW5vbnltb3VzUmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhbm9ueW1vdXNDb250ZXh0LmFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFub255bW91cycsXG4gICAgICAgIHNvdXJjZUlwOiAnMTkyLjAuMi4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ3N5c3RlbScsXG4gICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgIGFjdG9ySWQ6ICdzeXN0ZW0nXG4gICAgICB9KTtcblxuICAgICAgLy8gU2hvdWxkIHN0aWxsIGNyZWF0ZSB3aXRoIHN5c3RlbSBhY3RvclxuICAgICAgY29uc3QgYW5vbnltb3VzQ3JlYXRlUmVzdWx0ID0gYXdhaXQgYmxvZ1NlcnZpY2UubW9ja0NyZWF0ZShhbm9ueW1vdXNSZXF1ZXN0LmJvZHksIGFub255bW91c0NvbnRleHQpO1xuICAgICAgZXhwZWN0KGFub255bW91c0NyZWF0ZVJlc3VsdC5kYXRhLmNyZWF0ZWRCeSkudG9CZSgnc3lzdGVtJyk7XG4gICAgICBleHBlY3QoYW5vbnltb3VzQ3JlYXRlUmVzdWx0LmRhdGEuX2FjdG9yLmFjdG9yVHlwZSkudG9CZSgnYW5vbnltb3VzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBvcGVyYXRpb24gd2l0aG91dCBleGVjdXRpb24gY29udGV4dCcsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFRoaXMgc2ltdWxhdGVzIG9sZCBjb2RlIHRoYXQgZG9lc24ndCBwYXNzIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjb25zdCBub0NvbnRleHRSZXN1bHQgPSBhd2FpdCBibG9nU2VydmljZS5tb2NrQ3JlYXRlKHtcbiAgICAgICAgdGl0bGU6ICdObyBDb250ZXh0IFBvc3QnLFxuICAgICAgICBjb250ZW50OiAnQ3JlYXRlZCB3aXRob3V0IGV4ZWN1dGlvbiBjb250ZXh0J1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFNob3VsZCBub3QgaGF2ZSBhbnkgYWN0b3IgZmllbGRzXG4gICAgICBleHBlY3Qobm9Db250ZXh0UmVzdWx0LmRhdGEpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ05vIENvbnRleHQgUG9zdCcsXG4gICAgICAgIGNvbnRlbnQ6ICdDcmVhdGVkIHdpdGhvdXQgZXhlY3V0aW9uIGNvbnRleHQnLFxuICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMy1nZW5lcmF0ZWQnXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChub0NvbnRleHRSZXN1bHQuZGF0YSkubm90LnRvSGF2ZVByb3BlcnR5KCdjcmVhdGVkQnknKTtcbiAgICAgIGV4cGVjdChub0NvbnRleHRSZXN1bHQuZGF0YSkubm90LnRvSGF2ZVByb3BlcnR5KCdfYWN0b3InKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==