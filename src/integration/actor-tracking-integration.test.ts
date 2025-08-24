/**
 * Integration test demonstrating the complete actor tracking flow
 * From API Gateway request → Actor extraction → Entity operations → Audit logging
 */

import { APIGatewayEvent, Context } from 'aws-lambda';
import { BaseEntityService } from '../entity/base-service';
import { createEntitySchema, DefaultEntityOperations } from '../entity/base-entity';
import { ExecutionContext, Actor } from '../core/types/execution-context';
import { getChangedProperties } from '../audit/loggers/dynamo-db-stream-audit-logger';
import { DIContainer } from '../di';
import { EntityConfiguration } from 'electrodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIController } from '../core/runtime/api-gateway-controller';

// Test entity schema with actor tracking
const BlogPostSchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'blogPost',
    entityNamePlural: 'blogPosts',
    entityOperations: DefaultEntityOperations,
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
} as const);

// Mock Entity Service
class BlogPostService extends BaseEntityService<typeof BlogPostSchema> {
  constructor() {
    const entityConfiguration: EntityConfiguration = {
      table: 'blog-posts-table',
      client: new DynamoDBClient({})
    };
    super(BlogPostSchema, entityConfiguration, DIContainer.ROOT);
  }

  // Mock create method for testing
  public async mockCreate(payload: any, ctx?: ExecutionContext) {
    // This simulates the real create method with actor injection
    const payloadCopy = { ...payload };
    const enhancedPayload = (this as any).injectActorContext(payloadCopy, 'create', ctx);
    
    // Mock successful creation
    return {
      data: {
        ...enhancedPayload,
        postId: 'post-123-generated'
      }
    };
  }

  // Mock update method for testing
  public async mockUpdate(_identifiers: any, data: any, ctx?: ExecutionContext) {
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
    const enhancedData = (this as any).injectActorContext(data, 'update', ctx);
    
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

class TestAPIController extends APIController {
  initialize(event: APIGatewayEvent, context: Context): Promise<void> {
    console.log('TEST DEBUG: Initializing API Controller', {
      event,
      context
    });
    return Promise.resolve();
  }
  // Override to make protected methods accessible for testing
  public extractActorContext(event: APIGatewayEvent, request: any): Actor {
    return super.extractActorContext(event, request);
  }

  public buildCtx(event: APIGatewayEvent, request: any): ExecutionContext {
    const context = {} as Context;
    const response = {} as any;
    return super.buildCtx(event, context, request, response);
  }
}

// Mock audit logger
class MockAuditLogger {
  public makeAuditEntry(oldImage: any, newImage: any, entityName: string, eventType: string) {
    // Extract comprehensive actor context from the hidden _actor field
    const actorContext = newImage?._actor || oldImage?._actor;
    
    // Fallback to visible actor fields if _actor not available (backward compatibility)
    const fallbackActor = {
      actorId: newImage?.updatedBy || newImage?.createdBy || oldImage?.updatedBy || oldImage?.createdBy,
      tenantId: newImage?.tenantId || oldImage?.tenantId,
    };

    // Get only the changed properties
    const changes = getChangedProperties(oldImage, newImage);

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
  let blogService: BlogPostService;
  let apiController: TestAPIController;
  let auditLogger: MockAuditLogger;

  beforeEach(() => {
    blogService = new BlogPostService();
    apiController = new TestAPIController();
    auditLogger = new MockAuditLogger();
    jest.clearAllMocks();
  });

  describe('Complete Actor Tracking Flow', () => {
    it('should track actor throughout complete create operation flow', async () => {
      // 1. Simulate API Gateway event with Cognito authentication
      const event: APIGatewayEvent = {
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
        } as any,
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
      const executionContext = (apiController as any).buildCtx(event, request);

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
      const auditEntry = auditLogger.makeAuditEntry(
        undefined, // No old image for create
        createResult.data,
        'blogPost',
        'create'
      );

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
      const updateEvent: APIGatewayEvent = {
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
        } as any,
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
      const updateExecutionContext = (apiController as any).buildCtx(updateEvent, updateRequest);

      // Verify different actor for update
      expect(updateExecutionContext.actor.actorId).toBe('bob.editor');
      expect(updateExecutionContext.actor.cognitoGroups).toContain('editors');

      // 3. Perform entity update operation
      const updateResult = await blogService.mockUpdate(
        { postId: 'post-123' },
        updateRequest.body,
        updateExecutionContext
      );

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
      const updateAuditEntry = auditLogger.makeAuditEntry(
        updateResult.oldImage,
        updateResult.newImage,
        'blogPost',
        'update'
      );

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
      const apiKeyEvent: APIGatewayEvent = {
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
          authorizer: null as any,
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
      const apiKeyExecutionContext = (apiController as any).buildCtx(apiKeyEvent, apiKeyRequest);

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
      expect((apiKeyCreateResult.data as any)._actor.authMethod).toBe('api-key');
      expect((apiKeyCreateResult.data as any)._actor.actorType).toBe('service');

      // Generate audit entry
      const apiKeyAuditEntry = auditLogger.makeAuditEntry(
        undefined,
        apiKeyCreateResult.data,
        'blogPost',
        'create'
      );

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
      const legacyAuditEntry = auditLogger.makeAuditEntry(
        oldRecord,
        newRecord,
        'blogPost',
        'update'
      );

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
      const anonymousEvent: APIGatewayEvent = {
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
          authorizer: {} as any,
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

      const anonymousContext = (apiController as any).buildCtx(anonymousEvent, anonymousRequest);

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
