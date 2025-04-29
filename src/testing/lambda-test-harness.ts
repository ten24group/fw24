import { APIGatewayEvent, APIGatewayProxyResult, Context, CognitoIdentity, ClientContext, ClientContextClient, ClientContextEnv } from 'aws-lambda';
import { APIController } from '../core/runtime/api-gateway-controller';

export interface TestEventOptions {
  path?: string;
  httpMethod?: string;
  headers?: { [ key: string ]: string };
  multiValueHeaders?: { [ key: string ]: string[] };
  queryStringParameters?: { [ key: string ]: string };
  multiValueQueryStringParameters?: { [ key: string ]: string[] };
  pathParameters?: { [ key: string ]: string };
  body?: any;
  isBase64Encoded?: boolean;
  requestContext?: any;
  resource?: string;
  stageVariables?: { [ key: string ]: string };
  requestTimeEpoch?: number;
  resourcePath?: string;
  apiId?: string;
}

export interface TestContextOptions {
  callbackWaitsForEmptyEventLoop?: boolean;
  functionName?: string;
  functionVersion?: string;
  invokedFunctionArn?: string;
  memoryLimitInMB?: string;
  awsRequestId?: string;
  logGroupName?: string;
  logStreamName?: string;
  getRemainingTimeInMillis?: () => number;
  done?: () => void;
  fail?: () => void;
  succeed?: () => void;
}

export type LambdaHandler = (event: any, context: any) => Promise<any>;

// Define a type for controllers that have a controllerName property
interface ControllerWithName {
  controllerName: string;
  LambdaHandler: (event: any, context: any) => Promise<any>;
}

export class LambdaTestHarness {
  private controller: ControllerWithName;
  private context: any;

  constructor(controller: any, context?: any) {
    // Ensure the controller has a controllerName
    if (!controller.controllerName) {
      console.warn('Warning: controller does not have a controllerName property. Route matching may not work correctly.');
    }

    // Ensure the controller has a LambdaHandler method
    if (!controller.LambdaHandler && typeof controller.handleRequest === 'function') {
      console.log('Adding LambdaHandler to controller');
      controller.LambdaHandler = controller.handleRequest.bind(controller);
    }

    this.controller = controller;
    this.context = context;
  }

  private createMockEvent(httpMethod: string, path: string, options: TestEventOptions = {}): any {
    // Get the controller name from the controller instance
    const controllerName = this.controller.controllerName || '';

    // Ensure path starts with a slash
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    // Create the full path including controller name if it's not already included
    // This needs to handle the case where the controller name might already be in the path
    const fullPath = controllerName && !normalizedPath.startsWith(`/${controllerName}/`) && !normalizedPath.startsWith(`/${controllerName}`)
      ? `/${controllerName}${normalizedPath}`
      : normalizedPath;

    // Extract path parameters from the provided options
    const pathParams = options.pathParameters || {};

    // For resource path generation, we need to determine if this is a parameterized path
    // If resourcePath is explicitly provided, use that
    let resourcePath: string;
    if (options.resourcePath) {
      // If the resourcePath doesn't include the controller name, add it
      if (controllerName && !options.resourcePath.startsWith(`/${controllerName}`)) {
        resourcePath = `/${controllerName}${options.resourcePath.startsWith('/') ? options.resourcePath : `/${options.resourcePath}`}`;
      } else {
        resourcePath = options.resourcePath.startsWith('/') ? options.resourcePath : `/${options.resourcePath}`;
      }
    } else {
      // Otherwise generate it from the path and parameters
      resourcePath = fullPath;

      // Special handling for common REST patterns - if the path looks like /123 and pathParameters has id:123, 
      // convert it to /{id}
      if (Object.keys(pathParams).length > 0) {
        Object.entries(pathParams).forEach(([ key, value ]) => {
          if (value && fullPath.includes(`/${value}`)) {
            // Replace /123 with /{id}
            resourcePath = resourcePath.replace(`/${value}`, `/{${key}}`);
          } else if (value && fullPath.includes(`${value}`)) {
            // For cases where the value is elsewhere in the path
            resourcePath = resourcePath.replace(`${value}`, `{${key}}`);
          }
        });
      }
    }

    // For debugging
    console.log(`Controller: ${controllerName}, Path: ${fullPath}, Resource: ${resourcePath}, PathParams:`, pathParams);

    return {
      httpMethod,
      path: fullPath,
      headers: options.headers || {},
      multiValueHeaders: options.multiValueHeaders || {},
      queryStringParameters: options.queryStringParameters || null,
      multiValueQueryStringParameters: options.multiValueQueryStringParameters || null,
      pathParameters: pathParams,
      body: options.body ? JSON.stringify(options.body) : null,
      isBase64Encoded: options.isBase64Encoded || false,
      requestContext: options.requestContext || {
        accountId: '123456789012',
        apiId: options.apiId || 'test-api',
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
          userAgent: null,
          userArn: null
        },
        path: fullPath,
        stage: 'test',
        requestId: options.requestTimeEpoch?.toString() || 'test-request-id',
        requestTimeEpoch: options.requestTimeEpoch || Date.now(),
        resourceId: 'test-resource',
        resourcePath: resourcePath
      },
      resource: resourcePath,
      stageVariables: options.stageVariables || null
    };
  }

  private createMockContext(options: TestContextOptions = {}): any {
    return {
      callbackWaitsForEmptyEventLoop: options.callbackWaitsForEmptyEventLoop ?? true,
      functionName: options.functionName || 'test-function',
      functionVersion: options.functionVersion || '$LATEST',
      invokedFunctionArn: options.invokedFunctionArn || 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      memoryLimitInMB: options.memoryLimitInMB || '128',
      awsRequestId: options.awsRequestId || 'test-request-id',
      logGroupName: options.logGroupName || '/aws/lambda/test-function',
      logStreamName: options.logStreamName || '2021/01/01/[$LATEST]test-stream',
      getRemainingTimeInMillis: options.getRemainingTimeInMillis || (() => 30000),
      done: options.done || (() => { }),
      fail: options.fail || (() => { }),
      succeed: options.succeed || (() => { })
    };
  }

  private createTestHandler(): LambdaHandler {
    return async (event: any, context: any) => {
      try {
        // Check if the controller has a LambdaHandler method and call it
        if (typeof this.controller.LambdaHandler === 'function') {
          // For debugging
          console.log('Calling LambdaHandler with event:', {
            httpMethod: event.httpMethod,
            path: event.path,
            resource: event.resource,
            pathParameters: event.pathParameters
          });

          return await this.controller.LambdaHandler(event, context);
        } else {
          throw new Error('Controller does not have a LambdaHandler method');
        }
      } catch (error: unknown) {
        console.error('Error in test handler:', error);
        if (error instanceof Error) {
          return {
            statusCode: 500,
            body: JSON.stringify({
              message: error.message,
              stack: error.stack
            })
          };
        }
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: 'An unknown error occurred'
          })
        };
      }
    };
  }

  async get(path: string, options: TestEventOptions = {}): Promise<any> {
    const event = this.createMockEvent('GET', path, options);
    const context = this.createMockContext();
    const handler = this.createTestHandler();
    return handler(event, context);
  }

  async post(path: string, options: TestEventOptions = {}): Promise<any> {
    const event = this.createMockEvent('POST', path, options);
    const context = this.createMockContext();
    const handler = this.createTestHandler();
    return handler(event, context);
  }

  async put(path: string, options: TestEventOptions = {}): Promise<any> {
    const event = this.createMockEvent('PUT', path, options);
    const context = this.createMockContext();
    const handler = this.createTestHandler();
    return handler(event, context);
  }

  async patch(path: string, options: TestEventOptions = {}): Promise<any> {
    const event = this.createMockEvent('PATCH', path, options);
    const context = this.createMockContext();
    const handler = this.createTestHandler();
    return handler(event, context);
  }

  async delete(path: string, options: TestEventOptions = {}): Promise<any> {
    const event = this.createMockEvent('DELETE', path, options);
    const context = this.createMockContext();
    const handler = this.createTestHandler();
    return handler(event, context);
  }
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