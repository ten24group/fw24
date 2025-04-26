import { APIGatewayEvent, APIGatewayProxyResult, Context, CognitoIdentity, ClientContext, ClientContextClient, ClientContextEnv } from 'aws-lambda';
import { APIController } from '../core/runtime/api-gateway-controller';

export interface TestEventOptions {
  path?: string;
  httpMethod?: string;
  headers?: Record<string, string>;
  multiValueHeaders?: Record<string, string[]>;
  queryStringParameters?: Record<string, string>;
  multiValueQueryStringParameters?: Record<string, string[]>;
  pathParameters?: Record<string, string>;
  body?: any;
  isBase64Encoded?: boolean;
}

export interface TestContextOptions {
  functionName?: string;
  functionVersion?: string;
  memoryLimitInMB?: number;
  awsRequestId?: string;
  logGroupName?: string;
  logStreamName?: string;
  identity?: CognitoIdentity;
  clientContext?: ClientContext;
}

export class LambdaTestHarness {
  private static createMockEvent(options: TestEventOptions = {}): APIGatewayEvent {
    const {
      path = '/',
      httpMethod = 'GET',
      headers = {},
      multiValueHeaders = {},
      queryStringParameters = {},
      multiValueQueryStringParameters = {},
      pathParameters = {},
      body = null,
      isBase64Encoded = false
    } = options;

    return {
      path,
      httpMethod,
      headers,
      multiValueHeaders,
      queryStringParameters,
      multiValueQueryStringParameters,
      pathParameters,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      isBase64Encoded,
      resource: path,
      stageVariables: null,
      requestContext: {
        accountId: 'test',
        apiId: 'test',
        authorizer: null,
        protocol: 'HTTP/1.1',
        httpMethod,
        identity: {
          accessKey: null,
          accountId: null,
          apiKey: null,
          apiKeyId: null,
          caller: null,
          clientCert: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          sourceIp: '127.0.0.1',
          user: null,
          userAgent: 'test',
          userArn: null
        },
        path,
        stage: 'test',
        requestId: 'test',
        requestTimeEpoch: Date.now(),
        resourceId: 'test',
        resourcePath: path
      }
    } as APIGatewayEvent;
  }

  private static createMockContext(options: TestContextOptions = {}): Context {
    const {
      functionName = 'test-function',
      functionVersion = '$LATEST',
      memoryLimitInMB = 128,
      awsRequestId = 'test-request-id',
      logGroupName = '/aws/lambda/test',
      logStreamName = '2021/01/01/[$LATEST]test',
      identity,
      clientContext
    } = options;

    const mockClientContext: ClientContext = {
      client: {
        installationId: 'test',
        appTitle: 'test',
        appVersionName: 'test',
        appVersionCode: 'test',
        appPackageName: 'test'
      } as ClientContextClient,
      Custom: {},
      env: {
        platformVersion: 'test',
        platform: 'test',
        make: 'test',
        model: 'test',
        locale: 'test'
      } as ClientContextEnv
    };

    return {
      functionName,
      functionVersion,
      memoryLimitInMB: memoryLimitInMB.toString(),
      awsRequestId,
      requestId: awsRequestId,
      logGroupName,
      logStreamName,
      identity: identity || undefined,
      clientContext: clientContext || mockClientContext,
      invokedFunctionArn: `arn:aws:lambda:us-east-1:test:function:${functionName}`,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: () => { },
      fail: () => { },
      succeed: () => { }
    };
  }

  /**
   * Creates a test wrapper for an API Gateway Lambda handler
   * @param handler The Lambda handler to test
   * @returns A function that executes the handler with mock event and context
   */
  static createTestHandler(handler: APIController) {
    return async (
      eventOptions: TestEventOptions = {},
      contextOptions: TestContextOptions = {}
    ): Promise<APIGatewayProxyResult> => {
      const event = this.createMockEvent(eventOptions);
      const context = this.createMockContext(contextOptions);

      return handler.LambdaHandler(event, context);
    };
  }

  /**
   * Helper to test specific HTTP methods
   */
  static get = (handler: APIController, path: string, options: Omit<TestEventOptions, 'path' | 'httpMethod'> = {}) =>
    this.createTestHandler(handler)({ ...options, path, httpMethod: 'GET' });

  static post = (handler: APIController, path: string, options: Omit<TestEventOptions, 'path' | 'httpMethod'> = {}) =>
    this.createTestHandler(handler)({ ...options, path, httpMethod: 'POST' });

  static put = (handler: APIController, path: string, options: Omit<TestEventOptions, 'path' | 'httpMethod'> = {}) =>
    this.createTestHandler(handler)({ ...options, path, httpMethod: 'PUT' });

  static patch = (handler: APIController, path: string, options: Omit<TestEventOptions, 'path' | 'httpMethod'> = {}) =>
    this.createTestHandler(handler)({ ...options, path, httpMethod: 'PATCH' });

  static delete = (handler: APIController, path: string, options: Omit<TestEventOptions, 'path' | 'httpMethod'> = {}) =>
    this.createTestHandler(handler)({ ...options, path, httpMethod: 'DELETE' });
}

// Example usage in tests:
/*
describe('UserController', () => {
    const controller = new UserController();
    
    it('should get user by id', async () => {
        const response = await LambdaTestHarness.get(controller, '/users/123', {
            pathParameters: { id: '123' }
        });
        
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toHaveProperty('user');
    });

    it('should create user', async () => {
        const response = await LambdaTestHarness.post(controller, '/users', {
            body: {
                name: 'Test User',
                email: 'test@example.com'
            }
        });
        
        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toHaveProperty('user.id');
    });
});
*/ 