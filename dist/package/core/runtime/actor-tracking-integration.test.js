"use strict";
/**
 * Integration test demonstrating the complete actor tracking flow
 * From API Gateway request → Actor extraction → Entity operations → Audit logging
 */
Object.defineProperty(exports, "__esModule", { value: true });
const base_service_1 = require("../../entity/base-service");
const base_entity_1 = require("../../entity/base-entity");
const di_1 = require("../../di");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const api_gateway_controller_1 = require("./api-gateway-controller");
const audit_1 = require("../../audit");
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
        const changes = (0, audit_1.getChangedProperties)(oldImage, newImage);
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
                cognito: {
                    sub: 'user-sub-789',
                    username: 'alice.writer',
                    groups: ['content-creators', 'users']
                },
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
                // Hidden comprehensive actor context (check specific fields)
                _actor: expect.objectContaining({
                    requestId: executionContext.actor.requestId,
                    authMethod: executionContext.actor.authMethod,
                    actorType: executionContext.actor.actorType,
                    actorId: executionContext.actor.actorId,
                    sourceIp: executionContext.actor.sourceIp,
                    userAgent: executionContext.actor.userAgent,
                    correlationId: executionContext.actor.correlationId,
                    email: executionContext.actor.email,
                    tenantId: executionContext.actor.tenantId,
                    cognito: executionContext.actor.cognito
                })
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
                actor: expect.objectContaining({
                    requestId: executionContext.actor.requestId,
                    authMethod: executionContext.actor.authMethod,
                    actorType: executionContext.actor.actorType,
                    actorId: executionContext.actor.actorId,
                    sourceIp: executionContext.actor.sourceIp,
                    userAgent: executionContext.actor.userAgent,
                    correlationId: executionContext.actor.correlationId,
                    email: executionContext.actor.email,
                    tenantId: executionContext.actor.tenantId,
                    cognito: executionContext.actor.cognito
                })
            });
            // Verify that audit contains full actor context including request correlation
            expect(auditEntry.actor.requestId).toBe('req-unique-789');
            expect(auditEntry.actor.correlationId).toBe('trace-abc-456');
            expect(auditEntry.actor.sourceIp).toBe('203.0.113.195');
            expect(auditEntry.actor.cognito?.groups).toContain('content-creators');
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
            expect(updateExecutionContext.actor.cognito?.groups).toContain('editors');
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
                // New comprehensive actor context (check specific fields)
                _actor: expect.objectContaining({
                    requestId: updateExecutionContext.actor.requestId,
                    authMethod: updateExecutionContext.actor.authMethod,
                    actorType: updateExecutionContext.actor.actorType,
                    actorId: updateExecutionContext.actor.actorId,
                    sourceIp: updateExecutionContext.actor.sourceIp,
                    userAgent: updateExecutionContext.actor.userAgent,
                    correlationId: updateExecutionContext.actor.correlationId,
                    email: updateExecutionContext.actor.email,
                    tenantId: updateExecutionContext.actor.tenantId,
                    cognito: updateExecutionContext.actor.cognito
                })
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
                actorId: 'api-key:abcd1234',
                apiKey: {
                    id: 'abcd1234',
                    source: 'request-context'
                }
            });
            // Create entity with API key actor
            const apiKeyCreateResult = await blogService.mockCreate(apiKeyRequest.body, apiKeyExecutionContext);
            // Verify API key actor injection
            expect(apiKeyCreateResult.data.createdBy).toBe('api-key:abcd1234');
            expect(apiKeyCreateResult.data._actor.authMethod).toBe('api-key');
            expect(apiKeyCreateResult.data._actor.actorType).toBe('service');
            // Generate audit entry
            const apiKeyAuditEntry = auditLogger.makeAuditEntry(undefined, apiKeyCreateResult.data, 'blogPost', 'create');
            // Verify audit contains API key actor context
            expect(apiKeyAuditEntry.actor.authMethod).toBe('api-key');
            expect(apiKeyAuditEntry.actor.actorId).toBe('api-key:abcd1234');
            expect(apiKeyAuditEntry.actor.apiKey.id).toBe('abcd1234');
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
                authMethod: 'anonymous',
                actorType: 'anonymous',
                actorId: 'anonymous'
            });
            // Should still create with anonymous actor
            const anonymousCreateResult = await blogService.mockCreate(anonymousRequest.body, anonymousContext);
            expect(anonymousCreateResult.data.createdBy).toBe('anonymous');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0b3ItdHJhY2tpbmctaW50ZWdyYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYWN0b3ItdHJhY2tpbmctaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOztBQUdILDREQUE4RDtBQUM5RCwwREFBdUY7QUFFdkYsaUNBQXVDO0FBRXZDLDhEQUEwRDtBQUMxRCxxRUFBeUQ7QUFDekQsdUNBQW1EO0FBRW5ELHlDQUF5QztBQUN6QyxNQUFNLGNBQWMsR0FBRyxJQUFBLGdDQUFrQixFQUFDO0lBQ3hDLEtBQUssRUFBRTtRQUNMLE9BQU8sRUFBRSxHQUFHO1FBQ1osTUFBTSxFQUFFLFVBQVU7UUFDbEIsZ0JBQWdCLEVBQUUsV0FBVztRQUM3QixnQkFBZ0IsRUFBRSxxQ0FBdUI7UUFDekMsT0FBTyxFQUFFLE1BQU07S0FDaEI7SUFDRCxVQUFVLEVBQUU7UUFDVixNQUFNLEVBQUU7WUFDTixJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJO1lBQ2QsWUFBWSxFQUFFLElBQUk7U0FDbkI7UUFDRCxLQUFLLEVBQUU7WUFDTCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJO1NBQ2Y7UUFDRCxPQUFPLEVBQUU7WUFDUCxJQUFJLEVBQUUsUUFBUTtTQUNmO1FBQ0QsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxPQUFPLEVBQUUsT0FBTztTQUNqQjtRQUNELHdCQUF3QjtRQUN4QixTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRSxLQUFLO1NBQ2xCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUUsS0FBSztTQUNsQjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDbEI7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QUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQy9ELE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN4RSxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxtREFBbUQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRSw4REFBOEQ7WUFDOUQsTUFBTSxlQUFlLEdBQUcsTUFBTSxXQUFXLENBQUMsVUFBVSxDQUFDO2dCQUNuRCxLQUFLLEVBQUUsaUJBQWlCO2dCQUN4QixPQUFPLEVBQUUsbUNBQW1DO2FBQzdDLENBQUMsQ0FBQztZQUVILG1DQUFtQztZQUNuQyxNQUFNLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQztnQkFDbkMsS0FBSyxFQUFFLGlCQUFpQjtnQkFDeEIsT0FBTyxFQUFFLG1DQUFtQztnQkFDNUMsTUFBTSxFQUFFLG9CQUFvQjthQUM3QixDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDN0QsTUFBTSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzVELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogSW50ZWdyYXRpb24gdGVzdCBkZW1vbnN0cmF0aW5nIHRoZSBjb21wbGV0ZSBhY3RvciB0cmFja2luZyBmbG93XG4gKiBGcm9tIEFQSSBHYXRld2F5IHJlcXVlc3Qg4oaSIEFjdG9yIGV4dHJhY3Rpb24g4oaSIEVudGl0eSBvcGVyYXRpb25zIOKGkiBBdWRpdCBsb2dnaW5nXG4gKi9cblxuaW1wb3J0IHsgQVBJR2F0ZXdheUV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLXNlcnZpY2UnO1xuaW1wb3J0IHsgY3JlYXRlRW50aXR5U2NoZW1hLCBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gJy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gJ2VsZWN0cm9kYic7XG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB7IGdldENoYW5nZWRQcm9wZXJ0aWVzIH0gZnJvbSAnLi4vLi4vYXVkaXQnO1xuXG4vLyBUZXN0IGVudGl0eSBzY2hlbWEgd2l0aCBhY3RvciB0cmFja2luZ1xuY29uc3QgQmxvZ1Bvc3RTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICBtb2RlbDoge1xuICAgIHZlcnNpb246ICcxJyxcbiAgICBlbnRpdHk6ICdibG9nUG9zdCcsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ2Jsb2dQb3N0cycsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgc2VydmljZTogJ2Jsb2cnXG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICBwb3N0SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWVcbiAgICB9LFxuICAgIHRpdGxlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICBjb250ZW50OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgIH0sXG4gICAgc3RhdHVzOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGRlZmF1bHQ6ICdkcmFmdCdcbiAgICB9LFxuICAgIC8vIEFjdG9yIHRyYWNraW5nIGZpZWxkc1xuICAgIGNyZWF0ZWRCeToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH0sXG4gICAgdXBkYXRlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICBjcmVhdGVkQXQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2VcbiAgICB9LFxuICAgIHVwZGF0ZWRBdDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH0sXG4gICAgdGVuYW50SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2VcbiAgICB9XG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazoge1xuICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbJ3Bvc3RJZCddXG4gICAgICB9LFxuICAgICAgc2s6IHtcbiAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgIH1cbiAgICB9XG4gIH1cbn0gYXMgY29uc3QpO1xuXG4vLyBNb2NrIEVudGl0eSBTZXJ2aWNlXG5jbGFzcyBCbG9nUG9zdFNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTx0eXBlb2YgQmxvZ1Bvc3RTY2hlbWE+IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgY29uc3QgZW50aXR5Q29uZmlndXJhdGlvbjogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICAgIHRhYmxlOiAnYmxvZy1wb3N0cy10YWJsZScsXG4gICAgICBjbGllbnQ6IG5ldyBEeW5hbW9EQkNsaWVudCh7fSlcbiAgICB9O1xuICAgIHN1cGVyKEJsb2dQb3N0U2NoZW1hLCBlbnRpdHlDb25maWd1cmF0aW9uLCBESUNvbnRhaW5lci5ST09UKTtcbiAgfVxuXG4gIC8vIE1vY2sgY3JlYXRlIG1ldGhvZCBmb3IgdGVzdGluZ1xuICBwdWJsaWMgYXN5bmMgbW9ja0NyZWF0ZShwYXlsb2FkOiBhbnksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAvLyBUaGlzIHNpbXVsYXRlcyB0aGUgcmVhbCBjcmVhdGUgbWV0aG9kIHdpdGggYWN0b3IgaW5qZWN0aW9uXG4gICAgY29uc3QgcGF5bG9hZENvcHkgPSB7IC4uLnBheWxvYWQgfTtcbiAgICBjb25zdCBlbmhhbmNlZFBheWxvYWQgPSAodGhpcyBhcyBhbnkpLmluamVjdEFjdG9yQ29udGV4dChwYXlsb2FkQ29weSwgJ2NyZWF0ZScsIGN0eCk7XG4gICAgXG4gICAgLy8gTW9jayBzdWNjZXNzZnVsIGNyZWF0aW9uXG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgLi4uZW5oYW5jZWRQYXlsb2FkLFxuICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMy1nZW5lcmF0ZWQnXG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIE1vY2sgdXBkYXRlIG1ldGhvZCBmb3IgdGVzdGluZ1xuICBwdWJsaWMgYXN5bmMgbW9ja1VwZGF0ZShfaWRlbnRpZmllcnM6IGFueSwgZGF0YTogYW55LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgLy8gU2ltdWxhdGUgZ2V0dGluZyBleGlzdGluZyByZWNvcmRcbiAgICBjb25zdCBleGlzdGluZ1JlY29yZCA9IHtcbiAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgIHRpdGxlOiAnT3JpZ2luYWwgVGl0bGUnLFxuICAgICAgY29udGVudDogJ09yaWdpbmFsIENvbnRlbnQnLFxuICAgICAgc3RhdHVzOiAnZHJhZnQnLFxuICAgICAgY3JlYXRlZEJ5OiAnb3JpZ2luYWwtdXNlcicsXG4gICAgICBjcmVhdGVkQXQ6ICcyMDI0LTAxLTE0VDEwOjAwOjAwLjAwMFonLFxuICAgICAgX2FjdG9yOiB7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1vcmlnaW5hbCcsXG4gICAgICAgIGFjdG9ySWQ6ICdvcmlnaW5hbC11c2VyJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNFQxMDowMDowMC4wMDBaJ1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBJbmplY3QgYWN0b3IgY29udGV4dCBmb3IgdXBkYXRlXG4gICAgY29uc3QgZW5oYW5jZWREYXRhID0gKHRoaXMgYXMgYW55KS5pbmplY3RBY3RvckNvbnRleHQoZGF0YSwgJ3VwZGF0ZScsIGN0eCk7XG4gICAgXG4gICAgLy8gTW9jayBzdWNjZXNzZnVsIHVwZGF0ZVxuICAgIGNvbnN0IHVwZGF0ZWRSZWNvcmQgPSB7XG4gICAgICAuLi5leGlzdGluZ1JlY29yZCxcbiAgICAgIC4uLmVuaGFuY2VkRGF0YVxuICAgIH07XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0YTogdXBkYXRlZFJlY29yZCxcbiAgICAgIG9sZEltYWdlOiBleGlzdGluZ1JlY29yZCxcbiAgICAgIG5ld0ltYWdlOiB1cGRhdGVkUmVjb3JkXG4gICAgfTtcbiAgfVxufVxuXG4vLyBVc2UgcmVhbCBBUEkgQ29udHJvbGxlciBmb3IgdGVzdGluZ1xuXG5jbGFzcyBUZXN0QVBJQ29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICBpbml0aWFsaXplKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zb2xlLmxvZygnVEVTVCBERUJVRzogSW5pdGlhbGl6aW5nIEFQSSBDb250cm9sbGVyJywge1xuICAgICAgZXZlbnQsXG4gICAgICBjb250ZXh0XG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIC8vIE92ZXJyaWRlIHRvIG1ha2UgcHJvdGVjdGVkIG1ldGhvZHMgYWNjZXNzaWJsZSBmb3IgdGVzdGluZ1xuICBwdWJsaWMgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBhbnkpOiBBY3RvciB7XG4gICAgcmV0dXJuIHN1cGVyLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuICB9XG5cbiAgcHVibGljIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IGFueSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGNvbnRleHQgPSB7fSBhcyBDb250ZXh0O1xuICAgIGNvbnN0IHJlc3BvbnNlID0ge30gYXMgYW55O1xuICAgIHJldHVybiBzdXBlci5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuICB9XG59XG5cbi8vIE1vY2sgYXVkaXQgbG9nZ2VyXG5jbGFzcyBNb2NrQXVkaXRMb2dnZXIge1xuICBwdWJsaWMgbWFrZUF1ZGl0RW50cnkob2xkSW1hZ2U6IGFueSwgbmV3SW1hZ2U6IGFueSwgZW50aXR5TmFtZTogc3RyaW5nLCBldmVudFR5cGU6IHN0cmluZykge1xuICAgIC8vIEV4dHJhY3QgY29tcHJlaGVuc2l2ZSBhY3RvciBjb250ZXh0IGZyb20gdGhlIGhpZGRlbiBfYWN0b3IgZmllbGRcbiAgICBjb25zdCBhY3RvckNvbnRleHQgPSBuZXdJbWFnZT8uX2FjdG9yIHx8IG9sZEltYWdlPy5fYWN0b3I7XG4gICAgXG4gICAgLy8gRmFsbGJhY2sgdG8gdmlzaWJsZSBhY3RvciBmaWVsZHMgaWYgX2FjdG9yIG5vdCBhdmFpbGFibGUgKGJhY2t3YXJkIGNvbXBhdGliaWxpdHkpXG4gICAgY29uc3QgZmFsbGJhY2tBY3RvciA9IHtcbiAgICAgIGFjdG9ySWQ6IG5ld0ltYWdlPy51cGRhdGVkQnkgfHwgbmV3SW1hZ2U/LmNyZWF0ZWRCeSB8fCBvbGRJbWFnZT8udXBkYXRlZEJ5IHx8IG9sZEltYWdlPy5jcmVhdGVkQnksXG4gICAgICB0ZW5hbnRJZDogbmV3SW1hZ2U/LnRlbmFudElkIHx8IG9sZEltYWdlPy50ZW5hbnRJZCxcbiAgICB9O1xuXG4gICAgLy8gR2V0IG9ubHkgdGhlIGNoYW5nZWQgcHJvcGVydGllc1xuICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGV2ZW50VHlwZSxcbiAgICAgIGRhdGE6IGNoYW5nZXMsXG4gICAgICBpZGVudGlmaWVyczoge1xuICAgICAgICBpZDogbmV3SW1hZ2U/LnBvc3RJZCB8fCBvbGRJbWFnZT8ucG9zdElkXG4gICAgICB9LFxuICAgICAgYWN0b3I6IGFjdG9yQ29udGV4dCB8fCBmYWxsYmFja0FjdG9yXG4gICAgfTtcbiAgfVxufVxuXG5kZXNjcmliZSgnQWN0b3IgVHJhY2tpbmcgSW50ZWdyYXRpb24gVGVzdCcsICgpID0+IHtcbiAgbGV0IGJsb2dTZXJ2aWNlOiBCbG9nUG9zdFNlcnZpY2U7XG4gIGxldCBhcGlDb250cm9sbGVyOiBUZXN0QVBJQ29udHJvbGxlcjtcbiAgbGV0IGF1ZGl0TG9nZ2VyOiBNb2NrQXVkaXRMb2dnZXI7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgYmxvZ1NlcnZpY2UgPSBuZXcgQmxvZ1Bvc3RTZXJ2aWNlKCk7XG4gICAgYXBpQ29udHJvbGxlciA9IG5ldyBUZXN0QVBJQ29udHJvbGxlcigpO1xuICAgIGF1ZGl0TG9nZ2VyID0gbmV3IE1vY2tBdWRpdExvZ2dlcigpO1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICB9KTtcblxuICBkZXNjcmliZSgnQ29tcGxldGUgQWN0b3IgVHJhY2tpbmcgRmxvdycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHRyYWNrIGFjdG9yIHRocm91Z2hvdXQgY29tcGxldGUgY3JlYXRlIG9wZXJhdGlvbiBmbG93JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gMS4gU2ltdWxhdGUgQVBJIEdhdGV3YXkgZXZlbnQgd2l0aCBDb2duaXRvIGF1dGhlbnRpY2F0aW9uXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheUV2ZW50ID0ge1xuICAgICAgICByZXNvdXJjZTogJy9wb3N0cycsXG4gICAgICAgIHBhdGg6ICcvcG9zdHMnLFxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAndXNlci1hZ2VudCc6ICdNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYnLFxuICAgICAgICAgICd4LXRlbmFudC1pZCc6ICdjb21wYW55LTEyMydcbiAgICAgICAgfSxcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICByZXNvdXJjZUlkOiAncmVzb3VyY2UtaWQnLFxuICAgICAgICAgIHJlc291cmNlUGF0aDogJy9wb3N0cycsXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgIHJlcXVlc3RJZDogJ2FwaS1yZXF1ZXN0LTEyMycsXG4gICAgICAgICAgc3RhZ2U6ICdwcm9kJyxcbiAgICAgICAgICBhY2NvdW50SWQ6ICcxMjM0NTY3ODkwMTInLFxuICAgICAgICAgIHBhdGg6ICcvcG9zdHMnLFxuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlJZDogbnVsbCxcbiAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMjAzLjAuMTEzLjE5NScsXG4gICAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblR5cGU6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXG4gICAgICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgICB1c2VyOiBudWxsLFxuICAgICAgICAgICAgYXBpS2V5OiBudWxsLFxuICAgICAgICAgICAgYXBpS2V5SWQ6IG51bGwsXG4gICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgICAgICByZXF1ZXN0VGltZTogJzE1L0phbi8yMDI0OjEwOjMwOjAwICswMDAwJyxcbiAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNzA1MzE1ODAwMDAwLFxuICAgICAgICAgIGFwaUlkOiAnYXBpLWdhdGV3YXktaWQnLFxuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLXN1Yi03ODknLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdhbGljZS53cml0ZXInLFxuICAgICAgICAgICAgICAnY29nbml0bzpncm91cHMnOiAnY29udGVudC1jcmVhdG9ycyx1c2VycycsXG4gICAgICAgICAgICAgIGVtYWlsOiAnYWxpY2VAY29tcGFueS5jb20nLFxuICAgICAgICAgICAgICAnY3VzdG9tOnRlbmFudElkJzogJ2NvbXBhbnktMTIzJyxcbiAgICAgICAgICAgICAgJ2N1c3RvbTpkZXBhcnRtZW50JzogJ21hcmtldGluZydcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdGl0bGU6ICdNeSBOZXcgQmxvZyBQb3N0JyxcbiAgICAgICAgICBjb250ZW50OiAnVGhpcyBpcyB0aGUgY29udGVudCBvZiBteSBibG9nIHBvc3QuJyxcbiAgICAgICAgICBzdGF0dXM6ICdkcmFmdCdcbiAgICAgICAgfSksXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2VcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS11bmlxdWUtNzg5JyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd4LWNvcnJlbGF0aW9uLWlkJzogJ3RyYWNlLWFiYy00NTYnLFxuICAgICAgICAgICd4LXRlbmFudC1pZCc6ICdjb21wYW55LTEyMydcbiAgICAgICAgfSxcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHRpdGxlOiAnTXkgTmV3IEJsb2cgUG9zdCcsXG4gICAgICAgICAgY29udGVudDogJ1RoaXMgaXMgdGhlIGNvbnRlbnQgb2YgbXkgYmxvZyBwb3N0LicsXG4gICAgICAgICAgc3RhdHVzOiAnZHJhZnQnXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIC8vIDIuIEV4dHJhY3QgZXhlY3V0aW9uIGNvbnRleHQgd2l0aCBhY3RvclxuICAgICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IChhcGlDb250cm9sbGVyIGFzIGFueSkuYnVpbGRDdHgoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICAvLyBWZXJpZnkgYWN0b3IgZXh0cmFjdGlvblxuICAgICAgZXhwZWN0KGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdW5pcXVlLTc4OScsXG4gICAgICAgIHNvdXJjZUlwOiAnMjAzLjAuMTEzLjE5NScsXG4gICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGFjdG9ySWQ6ICdhbGljZS53cml0ZXInLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgc3ViOiAndXNlci1zdWItNzg5JyxcbiAgICAgICAgICB1c2VybmFtZTogJ2FsaWNlLndyaXRlcicsXG4gICAgICAgICAgZ3JvdXBzOiBbJ2NvbnRlbnQtY3JlYXRvcnMnLCAndXNlcnMnXVxuICAgICAgICB9LFxuICAgICAgICB0ZW5hbnRJZDogJ2NvbXBhbnktMTIzJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3RyYWNlLWFiYy00NTYnLFxuICAgICAgICByYXdBdXRoQ29udGV4dDoge1xuICAgICAgICAgIHN1YjogJ3VzZXItc3ViLTc4OScsXG4gICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnYWxpY2Uud3JpdGVyJyxcbiAgICAgICAgICAnY29nbml0bzpncm91cHMnOiAnY29udGVudC1jcmVhdG9ycyx1c2VycycsXG4gICAgICAgICAgZW1haWw6ICdhbGljZUBjb21wYW55LmNvbScsXG4gICAgICAgICAgJ2N1c3RvbTp0ZW5hbnRJZCc6ICdjb21wYW55LTEyMycsXG4gICAgICAgICAgJ2N1c3RvbTpkZXBhcnRtZW50JzogJ21hcmtldGluZydcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIDMuIFBlcmZvcm0gZW50aXR5IGNyZWF0ZSBvcGVyYXRpb25cbiAgICAgIGNvbnN0IGNyZWF0ZVJlc3VsdCA9IGF3YWl0IGJsb2dTZXJ2aWNlLm1vY2tDcmVhdGUocmVxdWVzdC5ib2R5LCBleGVjdXRpb25Db250ZXh0KTtcblxuICAgICAgLy8gVmVyaWZ5IGFjdG9yIGluamVjdGlvbiBpbiBjcmVhdGVkIGVudGl0eVxuICAgICAgZXhwZWN0KGNyZWF0ZVJlc3VsdC5kYXRhKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgdGl0bGU6ICdNeSBOZXcgQmxvZyBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgaXMgdGhlIGNvbnRlbnQgb2YgbXkgYmxvZyBwb3N0LicsXG4gICAgICAgIHN0YXR1czogJ2RyYWZ0JyxcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMtZ2VuZXJhdGVkJyxcbiAgICAgICAgLy8gVmlzaWJsZSBhY3RvciBmaWVsZHNcbiAgICAgICAgY3JlYXRlZEJ5OiAnYWxpY2Uud3JpdGVyJyxcbiAgICAgICAgdXBkYXRlZEJ5OiAnYWxpY2Uud3JpdGVyJyxcbiAgICAgICAgdGVuYW50SWQ6ICdjb21wYW55LTEyMycsXG4gICAgICAgIC8vIEhpZGRlbiBjb21wcmVoZW5zaXZlIGFjdG9yIGNvbnRleHQgKGNoZWNrIHNwZWNpZmljIGZpZWxkcylcbiAgICAgICAgX2FjdG9yOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgcmVxdWVzdElkOiBleGVjdXRpb25Db250ZXh0LmFjdG9yLnJlcXVlc3RJZCxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBleGVjdXRpb25Db250ZXh0LmFjdG9yLmF1dGhNZXRob2QsXG4gICAgICAgICAgYWN0b3JUeXBlOiBleGVjdXRpb25Db250ZXh0LmFjdG9yLmFjdG9yVHlwZSxcbiAgICAgICAgICBhY3RvcklkOiBleGVjdXRpb25Db250ZXh0LmFjdG9yLmFjdG9ySWQsXG4gICAgICAgICAgc291cmNlSXA6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3Iuc291cmNlSXAsXG4gICAgICAgICAgdXNlckFnZW50OiBleGVjdXRpb25Db250ZXh0LmFjdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBleGVjdXRpb25Db250ZXh0LmFjdG9yLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgZW1haWw6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuZW1haWwsXG4gICAgICAgICAgdGVuYW50SWQ6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IudGVuYW50SWQsXG4gICAgICAgICAgY29nbml0bzogZXhlY3V0aW9uQ29udGV4dC5hY3Rvci5jb2duaXRvXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjcmVhdGVSZXN1bHQuZGF0YS5jcmVhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QoY3JlYXRlUmVzdWx0LmRhdGEudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuXG4gICAgICAvLyA0LiBTaW11bGF0ZSBhdWRpdCBsb2dnaW5nIGZvciB0aGUgY3JlYXRlIG9wZXJhdGlvblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IGF1ZGl0TG9nZ2VyLm1ha2VBdWRpdEVudHJ5KFxuICAgICAgICB1bmRlZmluZWQsIC8vIE5vIG9sZCBpbWFnZSBmb3IgY3JlYXRlXG4gICAgICAgIGNyZWF0ZVJlc3VsdC5kYXRhLFxuICAgICAgICAnYmxvZ1Bvc3QnLFxuICAgICAgICAnY3JlYXRlJ1xuICAgICAgKTtcblxuICAgICAgLy8gVmVyaWZ5IGNvbXByZWhlbnNpdmUgYXVkaXQgdHJhaWxcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgZW50aXR5TmFtZTogJ2Jsb2dQb3N0JyxcbiAgICAgICAgZXZlbnRUeXBlOiAnY3JlYXRlJyxcbiAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICBpZDogJ3Bvc3QtMTIzLWdlbmVyYXRlZCdcbiAgICAgICAgfSxcbiAgICAgICAgYWN0b3I6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICByZXF1ZXN0SWQ6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IucmVxdWVzdElkLFxuICAgICAgICAgIGF1dGhNZXRob2Q6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuYXV0aE1ldGhvZCxcbiAgICAgICAgICBhY3RvclR5cGU6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuYWN0b3JUeXBlLFxuICAgICAgICAgIGFjdG9ySWQ6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuYWN0b3JJZCxcbiAgICAgICAgICBzb3VyY2VJcDogZXhlY3V0aW9uQ29udGV4dC5hY3Rvci5zb3VyY2VJcCxcbiAgICAgICAgICB1c2VyQWdlbnQ6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IudXNlckFnZW50LFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuY29ycmVsYXRpb25JZCxcbiAgICAgICAgICBlbWFpbDogZXhlY3V0aW9uQ29udGV4dC5hY3Rvci5lbWFpbCxcbiAgICAgICAgICB0ZW5hbnRJZDogZXhlY3V0aW9uQ29udGV4dC5hY3Rvci50ZW5hbnRJZCxcbiAgICAgICAgICBjb2duaXRvOiBleGVjdXRpb25Db250ZXh0LmFjdG9yLmNvZ25pdG9cbiAgICAgICAgfSlcbiAgICAgIH0pO1xuXG4gICAgICAvLyBWZXJpZnkgdGhhdCBhdWRpdCBjb250YWlucyBmdWxsIGFjdG9yIGNvbnRleHQgaW5jbHVkaW5nIHJlcXVlc3QgY29ycmVsYXRpb25cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLnJlcXVlc3RJZCkudG9CZSgncmVxLXVuaXF1ZS03ODknKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ3RyYWNlLWFiYy00NTYnKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLnNvdXJjZUlwKS50b0JlKCcyMDMuMC4xMTMuMTk1Jyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5jb2duaXRvPy5ncm91cHMpLnRvQ29udGFpbignY29udGVudC1jcmVhdG9ycycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB0cmFjayBhY3RvciB0aHJvdWdob3V0IGNvbXBsZXRlIHVwZGF0ZSBvcGVyYXRpb24gZmxvdycsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIDEuIFNpbXVsYXRlIGRpZmZlcmVudCB1c2VyIHVwZGF0aW5nIHRoZSBwb3N0XG4gICAgICBjb25zdCB1cGRhdGVFdmVudDogQVBJR2F0ZXdheUV2ZW50ID0ge1xuICAgICAgICByZXNvdXJjZTogJy9wb3N0cy97aWR9JyxcbiAgICAgICAgcGF0aDogJy9wb3N0cy9wb3N0LTEyMycsXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQQVRDSCcsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAndXNlci1hZ2VudCc6ICdNb3ppbGxhLzUuMCAoTWFjaW50b3NoOyBJbnRlbCBNYWMgT1MgWCAxMF8xNV83KScsXG4gICAgICAgICAgJ3gtdGVuYW50LWlkJzogJ2NvbXBhbnktMTIzJ1xuICAgICAgICB9LFxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICdwb3N0LTEyMycgfSxcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgcmVzb3VyY2VJZDogJ3Jlc291cmNlLWlkJyxcbiAgICAgICAgICByZXNvdXJjZVBhdGg6ICcvcG9zdHMve2lkfScsXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ1BBVENIJyxcbiAgICAgICAgICByZXF1ZXN0SWQ6ICdhcGktcmVxdWVzdC00NTYnLFxuICAgICAgICAgIHN0YWdlOiAncHJvZCcsXG4gICAgICAgICAgYWNjb3VudElkOiAnMTIzNDU2Nzg5MDEyJyxcbiAgICAgICAgICBwYXRoOiAnL3Bvc3RzL3Bvc3QtMTIzJyxcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBudWxsLFxuICAgICAgICAgICAgYWNjb3VudElkOiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5SWQ6IG51bGwsXG4gICAgICAgICAgICBjYWxsZXI6IG51bGwsXG4gICAgICAgICAgICBzb3VyY2VJcDogJzE5OC41MS4xMDAuNDInLFxuICAgICAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2Nlc3NLZXk6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25UeXBlOiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXG4gICAgICAgICAgICB1c2VyQXJuOiBudWxsLFxuICAgICAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICAgICAgdXNlcjogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleTogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleUlkOiBudWxsLFxuICAgICAgICAgICAgY2xpZW50Q2VydDogbnVsbFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXG4gICAgICAgICAgcmVxdWVzdFRpbWU6ICcxNS9KYW4vMjAyNDoxMTo0NTowMCArMDAwMCcsXG4gICAgICAgICAgcmVxdWVzdFRpbWVFcG9jaDogMTcwNTMyMDMwMDAwMCxcbiAgICAgICAgICBhcGlJZDogJ2FwaS1nYXRld2F5LWlkJyxcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci1zdWItNDU2JyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnYm9iLmVkaXRvcicsXG4gICAgICAgICAgICAgICdjb2duaXRvOmdyb3Vwcyc6ICdlZGl0b3JzLHVzZXJzJyxcbiAgICAgICAgICAgICAgZW1haWw6ICdib2JAY29tcGFueS5jb20nLFxuICAgICAgICAgICAgICAnY3VzdG9tOnRlbmFudElkJzogJ2NvbXBhbnktMTIzJyxcbiAgICAgICAgICAgICAgJ2N1c3RvbTpyb2xlJzogJ2NvbnRlbnQtbWFuYWdlcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdGl0bGU6ICdVcGRhdGVkIEJsb2cgUG9zdCBUaXRsZScsXG4gICAgICAgICAgc3RhdHVzOiAncHVibGlzaGVkJ1xuICAgICAgICB9KSxcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZVxuICAgICAgfTtcblxuICAgICAgY29uc3QgdXBkYXRlUmVxdWVzdCA9IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXVwZGF0ZS00NTYnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3gtY29ycmVsYXRpb24taWQnOiAndHJhY2UtdXBkYXRlLTc4OSdcbiAgICAgICAgfSxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICdwb3N0LTEyMycgfSxcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHRpdGxlOiAnVXBkYXRlZCBCbG9nIFBvc3QgVGl0bGUnLFxuICAgICAgICAgIHN0YXR1czogJ3B1Ymxpc2hlZCdcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgLy8gMi4gRXh0cmFjdCBleGVjdXRpb24gY29udGV4dCBmb3IgdXBkYXRlXG4gICAgICBjb25zdCB1cGRhdGVFeGVjdXRpb25Db250ZXh0ID0gKGFwaUNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eCh1cGRhdGVFdmVudCwgdXBkYXRlUmVxdWVzdCk7XG5cbiAgICAgIC8vIFZlcmlmeSBkaWZmZXJlbnQgYWN0b3IgZm9yIHVwZGF0ZVxuICAgICAgZXhwZWN0KHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuYWN0b3JJZCkudG9CZSgnYm9iLmVkaXRvcicpO1xuICAgICAgZXhwZWN0KHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuY29nbml0bz8uZ3JvdXBzKS50b0NvbnRhaW4oJ2VkaXRvcnMnKTtcblxuICAgICAgLy8gMy4gUGVyZm9ybSBlbnRpdHkgdXBkYXRlIG9wZXJhdGlvblxuICAgICAgY29uc3QgdXBkYXRlUmVzdWx0ID0gYXdhaXQgYmxvZ1NlcnZpY2UubW9ja1VwZGF0ZShcbiAgICAgICAgeyBwb3N0SWQ6ICdwb3N0LTEyMycgfSxcbiAgICAgICAgdXBkYXRlUmVxdWVzdC5ib2R5LFxuICAgICAgICB1cGRhdGVFeGVjdXRpb25Db250ZXh0XG4gICAgICApO1xuXG4gICAgICAvLyA0LiBWZXJpZnkgYWN0b3IgaW5qZWN0aW9uIGluIHVwZGF0ZWQgZW50aXR5XG4gICAgICBleHBlY3QodXBkYXRlUmVzdWx0LmRhdGEpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgIHRpdGxlOiAnVXBkYXRlZCBCbG9nIFBvc3QgVGl0bGUnLFxuICAgICAgICBzdGF0dXM6ICdwdWJsaXNoZWQnLFxuICAgICAgICAvLyBPcmlnaW5hbCBjcmVhdGUgYWN0b3IgcHJlc2VydmVkXG4gICAgICAgIGNyZWF0ZWRCeTogJ29yaWdpbmFsLXVzZXInLFxuICAgICAgICAvLyBOZXcgdXBkYXRlIGFjdG9yXG4gICAgICAgIHVwZGF0ZWRCeTogJ2JvYi5lZGl0b3InLFxuICAgICAgICB0ZW5hbnRJZDogJ2NvbXBhbnktMTIzJyxcbiAgICAgICAgLy8gTmV3IGNvbXByZWhlbnNpdmUgYWN0b3IgY29udGV4dCAoY2hlY2sgc3BlY2lmaWMgZmllbGRzKVxuICAgICAgICBfYWN0b3I6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICByZXF1ZXN0SWQ6IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IucmVxdWVzdElkLFxuICAgICAgICAgIGF1dGhNZXRob2Q6IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuYXV0aE1ldGhvZCxcbiAgICAgICAgICBhY3RvclR5cGU6IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuYWN0b3JUeXBlLFxuICAgICAgICAgIGFjdG9ySWQ6IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuYWN0b3JJZCxcbiAgICAgICAgICBzb3VyY2VJcDogdXBkYXRlRXhlY3V0aW9uQ29udGV4dC5hY3Rvci5zb3VyY2VJcCxcbiAgICAgICAgICB1c2VyQWdlbnQ6IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IudXNlckFnZW50LFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHVwZGF0ZUV4ZWN1dGlvbkNvbnRleHQuYWN0b3IuY29ycmVsYXRpb25JZCxcbiAgICAgICAgICBlbWFpbDogdXBkYXRlRXhlY3V0aW9uQ29udGV4dC5hY3Rvci5lbWFpbCxcbiAgICAgICAgICB0ZW5hbnRJZDogdXBkYXRlRXhlY3V0aW9uQ29udGV4dC5hY3Rvci50ZW5hbnRJZCxcbiAgICAgICAgICBjb2duaXRvOiB1cGRhdGVFeGVjdXRpb25Db250ZXh0LmFjdG9yLmNvZ25pdG9cbiAgICAgICAgfSlcbiAgICAgIH0pO1xuXG4gICAgICAvLyA1LiBTaW11bGF0ZSBhdWRpdCBsb2dnaW5nIGZvciB0aGUgdXBkYXRlIG9wZXJhdGlvblxuICAgICAgY29uc3QgdXBkYXRlQXVkaXRFbnRyeSA9IGF1ZGl0TG9nZ2VyLm1ha2VBdWRpdEVudHJ5KFxuICAgICAgICB1cGRhdGVSZXN1bHQub2xkSW1hZ2UsXG4gICAgICAgIHVwZGF0ZVJlc3VsdC5uZXdJbWFnZSxcbiAgICAgICAgJ2Jsb2dQb3N0JyxcbiAgICAgICAgJ3VwZGF0ZSdcbiAgICAgICk7XG5cbiAgICAgIC8vIFZlcmlmeSBhdWRpdCBzaG93cyBvbmx5IGNoYW5nZWQgZmllbGRzXG4gICAgICBleHBlY3QodXBkYXRlQXVkaXRFbnRyeS5kYXRhKS50b0VxdWFsKHtcbiAgICAgICAgdGl0bGU6IHsgb2xkOiAnT3JpZ2luYWwgVGl0bGUnLCBuZXc6ICdVcGRhdGVkIEJsb2cgUG9zdCBUaXRsZScgfSxcbiAgICAgICAgc3RhdHVzOiB7IG9sZDogJ2RyYWZ0JywgbmV3OiAncHVibGlzaGVkJyB9LFxuICAgICAgICB1cGRhdGVkQnk6IHsgbmV3OiAnYm9iLmVkaXRvcicgfSwgLy8gb2xkIHZhbHVlIG5vdCBwcmVzZW50IHNpbmNlIG9yaWdpbmFsIHJlY29yZCBkaWRuJ3QgaGF2ZSB1cGRhdGVkQnlcbiAgICAgICAgdGVuYW50SWQ6IHsgbmV3OiAnY29tcGFueS0xMjMnIH0gLy8gdGVuYW50SWQgYmVpbmcgYWRkZWRcbiAgICAgIH0pO1xuXG4gICAgICAvLyBWZXJpZnkgYXVkaXQgY29udGFpbnMgY3VycmVudCBhY3RvciBjb250ZXh0XG4gICAgICBleHBlY3QodXBkYXRlQXVkaXRFbnRyeS5hY3RvcikudG9FcXVhbCh1cGRhdGVFeGVjdXRpb25Db250ZXh0LmFjdG9yKTtcbiAgICAgIGV4cGVjdCh1cGRhdGVBdWRpdEVudHJ5LmFjdG9yLmFjdG9ySWQpLnRvQmUoJ2JvYi5lZGl0b3InKTtcbiAgICAgIGV4cGVjdCh1cGRhdGVBdWRpdEVudHJ5LmFjdG9yLnJlcXVlc3RJZCkudG9CZSgncmVxLXVwZGF0ZS00NTYnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIEFQSSBrZXkgYXV0aGVudGljYXRpb24gaW4gYWN0b3IgdHJhY2tpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTaW11bGF0ZSBBUEkga2V5IGF1dGhlbnRpY2F0ZWQgcmVxdWVzdFxuICAgICAgY29uc3QgYXBpS2V5RXZlbnQ6IEFQSUdhdGV3YXlFdmVudCA9IHtcbiAgICAgICAgcmVzb3VyY2U6ICcvcG9zdHMnLFxuICAgICAgICBwYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3VzZXItYWdlbnQnOiAnUG9zdG1hblJ1bnRpbWUvNy4zMi4zJ1xuICAgICAgICB9LFxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIHJlc291cmNlSWQ6ICdyZXNvdXJjZS1pZCcsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgYWNjb3VudElkOiAnMTIzNDU2Nzg5MDEyJyxcbiAgICAgICAgICBwYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgICByZXF1ZXN0SWQ6ICdhcGkta2V5LXJlcXVlc3QtNzg5JyxcbiAgICAgICAgICBzdGFnZTogJ3Byb2QnLFxuICAgICAgICAgIGF1dGhvcml6ZXI6IG51bGwgYXMgYW55LFxuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlJZDogbnVsbCxcbiAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTAuMC4wLjEwMCcsXG4gICAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblR5cGU6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXG4gICAgICAgICAgICB1c2VyQWdlbnQ6ICdQb3N0bWFuUnVudGltZS83LjMyLjMnLFxuICAgICAgICAgICAgdXNlcjogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleTogJ2FwaS1rZXktc2VydmljZS0xMjMnLFxuICAgICAgICAgICAgYXBpS2V5SWQ6ICdhYmNkMTIzNCcsXG4gICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgICAgICByZXF1ZXN0VGltZTogJzE1L0phbi8yMDI0OjEyOjAwOjAwICswMDAwJyxcbiAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNzA1MzIxMjAwMDAwLFxuICAgICAgICAgIGFwaUlkOiAnYXBpLWdhdGV3YXktaWQnXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB0aXRsZTogJ0FQSSBHZW5lcmF0ZWQgUG9zdCcsXG4gICAgICAgICAgY29udGVudDogJ1RoaXMgcG9zdCB3YXMgY3JlYXRlZCB2aWEgQVBJLicsXG4gICAgICAgICAgc3RhdHVzOiAncHVibGlzaGVkJ1xuICAgICAgICB9KSxcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZVxuICAgICAgfTtcblxuICAgICAgY29uc3QgYXBpS2V5UmVxdWVzdCA9IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFwaS1rZXktNzg5JyxcbiAgICAgICAgaGVhZGVyczoge30sXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB0aXRsZTogJ0FQSSBHZW5lcmF0ZWQgUG9zdCcsXG4gICAgICAgICAgY29udGVudDogJ1RoaXMgcG9zdCB3YXMgY3JlYXRlZCB2aWEgQVBJLicsXG4gICAgICAgICAgc3RhdHVzOiAncHVibGlzaGVkJ1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICAvLyBFeHRyYWN0IGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjb25zdCBhcGlLZXlFeGVjdXRpb25Db250ZXh0ID0gKGFwaUNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eChhcGlLZXlFdmVudCwgYXBpS2V5UmVxdWVzdCk7XG5cbiAgICAgIC8vIFZlcmlmeSBBUEkga2V5IGFjdG9yXG4gICAgICBleHBlY3QoYXBpS2V5RXhlY3V0aW9uQ29udGV4dC5hY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1hcGkta2V5LTc4OScsXG4gICAgICAgIHNvdXJjZUlwOiAnMTAuMC4wLjEwMCcsXG4gICAgICAgIHVzZXJBZ2VudDogJ1Bvc3RtYW5SdW50aW1lLzcuMzIuMycsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIGFjdG9ySWQ6ICdhcGkta2V5OmFiY2QxMjM0JyxcbiAgICAgICAgYXBpS2V5OiB7XG4gICAgICAgICAgaWQ6ICdhYmNkMTIzNCcsXG4gICAgICAgICAgc291cmNlOiAncmVxdWVzdC1jb250ZXh0J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQ3JlYXRlIGVudGl0eSB3aXRoIEFQSSBrZXkgYWN0b3JcbiAgICAgIGNvbnN0IGFwaUtleUNyZWF0ZVJlc3VsdCA9IGF3YWl0IGJsb2dTZXJ2aWNlLm1vY2tDcmVhdGUoYXBpS2V5UmVxdWVzdC5ib2R5LCBhcGlLZXlFeGVjdXRpb25Db250ZXh0KTtcblxuICAgICAgLy8gVmVyaWZ5IEFQSSBrZXkgYWN0b3IgaW5qZWN0aW9uXG4gICAgICBleHBlY3QoYXBpS2V5Q3JlYXRlUmVzdWx0LmRhdGEuY3JlYXRlZEJ5KS50b0JlKCdhcGkta2V5OmFiY2QxMjM0Jyk7XG4gICAgICBleHBlY3QoKGFwaUtleUNyZWF0ZVJlc3VsdC5kYXRhIGFzIGFueSkuX2FjdG9yLmF1dGhNZXRob2QpLnRvQmUoJ2FwaS1rZXknKTtcbiAgICAgIGV4cGVjdCgoYXBpS2V5Q3JlYXRlUmVzdWx0LmRhdGEgYXMgYW55KS5fYWN0b3IuYWN0b3JUeXBlKS50b0JlKCdzZXJ2aWNlJyk7XG5cbiAgICAgIC8vIEdlbmVyYXRlIGF1ZGl0IGVudHJ5XG4gICAgICBjb25zdCBhcGlLZXlBdWRpdEVudHJ5ID0gYXVkaXRMb2dnZXIubWFrZUF1ZGl0RW50cnkoXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgYXBpS2V5Q3JlYXRlUmVzdWx0LmRhdGEsXG4gICAgICAgICdibG9nUG9zdCcsXG4gICAgICAgICdjcmVhdGUnXG4gICAgICApO1xuXG4gICAgICAvLyBWZXJpZnkgYXVkaXQgY29udGFpbnMgQVBJIGtleSBhY3RvciBjb250ZXh0XG4gICAgICBleHBlY3QoYXBpS2V5QXVkaXRFbnRyeS5hY3Rvci5hdXRoTWV0aG9kKS50b0JlKCdhcGkta2V5Jyk7XG4gICAgICBleHBlY3QoYXBpS2V5QXVkaXRFbnRyeS5hY3Rvci5hY3RvcklkKS50b0JlKCdhcGkta2V5OmFiY2QxMjM0Jyk7XG4gICAgICBleHBlY3QoYXBpS2V5QXVkaXRFbnRyeS5hY3Rvci5hcGlLZXkuaWQpLnRvQmUoJ2FiY2QxMjM0Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGRlbW9uc3RyYXRlIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgd2l0aCBleGlzdGluZyBhdWRpdCByZWNvcmRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU2ltdWxhdGUgb2xkIHJlY29yZCB3aXRob3V0IF9hY3RvciBmaWVsZFxuICAgICAgY29uc3Qgb2xkUmVjb3JkID0ge1xuICAgICAgICBwb3N0SWQ6ICdsZWdhY3ktcG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ0xlZ2FjeSBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ1RoaXMgd2FzIGNyZWF0ZWQgYmVmb3JlIGFjdG9yIHRyYWNraW5nJyxcbiAgICAgICAgY3JlYXRlZEJ5OiAnbGVnYWN5LXVzZXInLFxuICAgICAgICB1cGRhdGVkQnk6ICdsZWdhY3ktdXNlcicsXG4gICAgICAgIHRlbmFudElkOiAnbGVnYWN5LXRlbmFudCdcbiAgICAgICAgLy8gTm8gX2FjdG9yIGZpZWxkXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBuZXdSZWNvcmQgPSB7XG4gICAgICAgIHBvc3RJZDogJ2xlZ2FjeS1wb3N0LTEyMycsXG4gICAgICAgIHRpdGxlOiAnVXBkYXRlZCBMZWdhY3kgUG9zdCcsXG4gICAgICAgIGNvbnRlbnQ6ICdUaGlzIHdhcyBjcmVhdGVkIGJlZm9yZSBhY3RvciB0cmFja2luZycsXG4gICAgICAgIGNyZWF0ZWRCeTogJ2xlZ2FjeS11c2VyJyxcbiAgICAgICAgdXBkYXRlZEJ5OiAnY3VycmVudC11c2VyJyxcbiAgICAgICAgdGVuYW50SWQ6ICdsZWdhY3ktdGVuYW50J1xuICAgICAgICAvLyBTdGlsbCBubyBfYWN0b3IgZmllbGRcbiAgICAgIH07XG5cbiAgICAgIC8vIEdlbmVyYXRlIGF1ZGl0IGVudHJ5IGZvciBsZWdhY3kgcmVjb3JkXG4gICAgICBjb25zdCBsZWdhY3lBdWRpdEVudHJ5ID0gYXVkaXRMb2dnZXIubWFrZUF1ZGl0RW50cnkoXG4gICAgICAgIG9sZFJlY29yZCxcbiAgICAgICAgbmV3UmVjb3JkLFxuICAgICAgICAnYmxvZ1Bvc3QnLFxuICAgICAgICAndXBkYXRlJ1xuICAgICAgKTtcblxuICAgICAgLy8gU2hvdWxkIGZhbGxiYWNrIHRvIHZpc2libGUgYWN0b3IgZmllbGRzXG4gICAgICBleHBlY3QobGVnYWN5QXVkaXRFbnRyeS5hY3RvcikudG9FcXVhbCh7XG4gICAgICAgIGFjdG9ySWQ6ICdjdXJyZW50LXVzZXInLFxuICAgICAgICB0ZW5hbnRJZDogJ2xlZ2FjeS10ZW5hbnQnXG4gICAgICB9KTtcblxuICAgICAgLy8gU2hvdWxkIHN0aWxsIGNhcHR1cmUgY2hhbmdlcyBjb3JyZWN0bHlcbiAgICAgIGV4cGVjdChsZWdhY3lBdWRpdEVudHJ5LmRhdGEpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogeyBvbGQ6ICdMZWdhY3kgUG9zdCcsIG5ldzogJ1VwZGF0ZWQgTGVnYWN5IFBvc3QnIH0sXG4gICAgICAgIHVwZGF0ZWRCeTogeyBvbGQ6ICdsZWdhY3ktdXNlcicsIG5ldzogJ2N1cnJlbnQtdXNlcicgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFcnJvciBTY2VuYXJpb3MgYW5kIEVkZ2UgQ2FzZXMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBhdXRoZW50aWNhdGlvbiBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYW5vbnltb3VzRXZlbnQ6IEFQSUdhdGV3YXlFdmVudCA9IHtcbiAgICAgICAgcmVzb3VyY2U6ICcvcG9zdHMnLFxuICAgICAgICBwYXRoOiAnL3Bvc3RzJyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICBoZWFkZXJzOiB7fSxcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICByZXNvdXJjZUlkOiAncmVzb3VyY2UtaWQnLFxuICAgICAgICAgIHJlc291cmNlUGF0aDogJy9wb3N0cycsXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgIHJlcXVlc3RJZDogJ2Fub255bW91cy1yZXF1ZXN0JyxcbiAgICAgICAgICBzdGFnZTogJ3Byb2QnLFxuICAgICAgICAgIGFjY291bnRJZDogJzEyMzQ1Njc4OTAxMicsXG4gICAgICAgICAgcGF0aDogJy9wb3N0cycsXG4gICAgICAgICAgYXV0aG9yaXplcjoge30gYXMgYW55LFxuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlJZDogbnVsbCxcbiAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjAuMi4xJyxcbiAgICAgICAgICAgIHByaW5jaXBhbE9yZ0lkOiBudWxsLFxuICAgICAgICAgICAgYWNjZXNzS2V5OiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblByb3ZpZGVyOiBudWxsLFxuICAgICAgICAgICAgdXNlckFybjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBZ2VudDogbnVsbCxcbiAgICAgICAgICAgIHVzZXI6IG51bGwsXG4gICAgICAgICAgICBhcGlLZXk6IG51bGwsXG4gICAgICAgICAgICBhcGlLZXlJZDogbnVsbCxcbiAgICAgICAgICAgIGNsaWVudENlcnQ6IG51bGxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHByb3RvY29sOiAnSFRUUC8xLjEnLFxuICAgICAgICAgIHJlcXVlc3RUaW1lOiAnMTUvSmFuLzIwMjQ6MTI6MzA6MDAgKzAwMDAnLFxuICAgICAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IDE3MDUzMjMwMDAwMDAsXG4gICAgICAgICAgYXBpSWQ6ICdhcGktZ2F0ZXdheS1pZCdcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogbnVsbCxcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZVxuICAgICAgfTtcblxuICAgICAgY29uc3QgYW5vbnltb3VzUmVxdWVzdCA9IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFub255bW91cycsXG4gICAgICAgIGhlYWRlcnM6IHt9LFxuICAgICAgICBib2R5OiB7XG4gICAgICAgICAgdGl0bGU6ICdBbm9ueW1vdXMgUG9zdCdcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgYW5vbnltb3VzQ29udGV4dCA9IChhcGlDb250cm9sbGVyIGFzIGFueSkuYnVpbGRDdHgoYW5vbnltb3VzRXZlbnQsIGFub255bW91c1JlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYW5vbnltb3VzQ29udGV4dC5hY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1hbm9ueW1vdXMnLFxuICAgICAgICBzb3VyY2VJcDogJzE5Mi4wLjIuMScsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvclR5cGU6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJ1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFNob3VsZCBzdGlsbCBjcmVhdGUgd2l0aCBhbm9ueW1vdXMgYWN0b3JcbiAgICAgIGNvbnN0IGFub255bW91c0NyZWF0ZVJlc3VsdCA9IGF3YWl0IGJsb2dTZXJ2aWNlLm1vY2tDcmVhdGUoYW5vbnltb3VzUmVxdWVzdC5ib2R5LCBhbm9ueW1vdXNDb250ZXh0KTtcbiAgICAgIGV4cGVjdChhbm9ueW1vdXNDcmVhdGVSZXN1bHQuZGF0YS5jcmVhdGVkQnkpLnRvQmUoJ2Fub255bW91cycpO1xuICAgICAgZXhwZWN0KGFub255bW91c0NyZWF0ZVJlc3VsdC5kYXRhLl9hY3Rvci5hY3RvclR5cGUpLnRvQmUoJ2Fub255bW91cycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgb3BlcmF0aW9uIHdpdGhvdXQgZXhlY3V0aW9uIGNvbnRleHQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBUaGlzIHNpbXVsYXRlcyBvbGQgY29kZSB0aGF0IGRvZXNuJ3QgcGFzcyBleGVjdXRpb24gY29udGV4dFxuICAgICAgY29uc3Qgbm9Db250ZXh0UmVzdWx0ID0gYXdhaXQgYmxvZ1NlcnZpY2UubW9ja0NyZWF0ZSh7XG4gICAgICAgIHRpdGxlOiAnTm8gQ29udGV4dCBQb3N0JyxcbiAgICAgICAgY29udGVudDogJ0NyZWF0ZWQgd2l0aG91dCBleGVjdXRpb24gY29udGV4dCdcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTaG91bGQgbm90IGhhdmUgYW55IGFjdG9yIGZpZWxkc1xuICAgICAgZXhwZWN0KG5vQ29udGV4dFJlc3VsdC5kYXRhKS50b0VxdWFsKHtcbiAgICAgICAgdGl0bGU6ICdObyBDb250ZXh0IFBvc3QnLFxuICAgICAgICBjb250ZW50OiAnQ3JlYXRlZCB3aXRob3V0IGV4ZWN1dGlvbiBjb250ZXh0JyxcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMtZ2VuZXJhdGVkJ1xuICAgICAgfSk7XG4gICAgICBleHBlY3Qobm9Db250ZXh0UmVzdWx0LmRhdGEpLm5vdC50b0hhdmVQcm9wZXJ0eSgnY3JlYXRlZEJ5Jyk7XG4gICAgICBleHBlY3Qobm9Db250ZXh0UmVzdWx0LmRhdGEpLm5vdC50b0hhdmVQcm9wZXJ0eSgnX2FjdG9yJyk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=