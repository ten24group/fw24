"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaTestHarness = exports.LambdaTestHarnessLogLevel = void 0;
var LambdaTestHarnessLogLevel;
(function (LambdaTestHarnessLogLevel) {
    LambdaTestHarnessLogLevel[LambdaTestHarnessLogLevel["SILENT"] = 0] = "SILENT";
    LambdaTestHarnessLogLevel[LambdaTestHarnessLogLevel["ERROR"] = 1] = "ERROR";
    LambdaTestHarnessLogLevel[LambdaTestHarnessLogLevel["WARN"] = 2] = "WARN";
    LambdaTestHarnessLogLevel[LambdaTestHarnessLogLevel["INFO"] = 3] = "INFO";
    LambdaTestHarnessLogLevel[LambdaTestHarnessLogLevel["DEBUG"] = 4] = "DEBUG";
})(LambdaTestHarnessLogLevel || (exports.LambdaTestHarnessLogLevel = LambdaTestHarnessLogLevel = {}));
class LambdaTestHarness {
    controller;
    context;
    logLevel;
    constructor(controller, options = {}) {
        this.logLevel = options.logLevel ?? LambdaTestHarnessLogLevel.WARN;
        // Load entry packages (simulate Lambda layers) before controller setup
        if (options.entryPackages) {
            options.entryPackages.forEach(pkg => {
                try {
                    require(pkg);
                }
                catch (error) {
                    this.log(LambdaTestHarnessLogLevel.ERROR, `Failed to import entry package ${pkg}:`, error);
                }
            });
            // Also set environment variable for entry packages if needed by decorators
            process.env.ENTRY_PACKAGES = options.entryPackages.join(',');
        }
        // Ensure the controller has a controllerName
        if (!controller.controllerName) {
            this.log(LambdaTestHarnessLogLevel.WARN, 'Warning: controller does not have a controllerName property. Route matching may not work correctly.');
        }
        // Ensure the controller has a LambdaHandler method
        if (!controller.LambdaHandler && typeof controller.handleRequest === 'function') {
            this.log(LambdaTestHarnessLogLevel.INFO, 'Adding LambdaHandler to controller');
            controller.LambdaHandler = controller.handleRequest.bind(controller);
        }
        this.controller = controller;
        this.context = options.context;
    }
    /**
     * Internal logging method that respects the configured log level
     */
    log(level, message, ...args) {
        if (level <= this.logLevel) {
            switch (level) {
                case LambdaTestHarnessLogLevel.ERROR:
                    console.error(message, ...args);
                    break;
                case LambdaTestHarnessLogLevel.WARN:
                    console.warn(message, ...args);
                    break;
                case LambdaTestHarnessLogLevel.INFO:
                    console.log(message, ...args);
                    break;
                case LambdaTestHarnessLogLevel.DEBUG:
                    console.log(`[DEBUG] ${message}`, ...args);
                    break;
                default:
                    // SILENT level or unknown - do nothing
                    break;
            }
        }
    }
    createMockEvent(httpMethod, path, options = {}) {
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
        let resourcePath;
        if (options.resourcePath) {
            // If the resourcePath doesn't include the controller name, add it
            if (controllerName && !options.resourcePath.startsWith(`/${controllerName}`)) {
                resourcePath = `/${controllerName}${options.resourcePath.startsWith('/') ? options.resourcePath : `/${options.resourcePath}`}`;
            }
            else {
                resourcePath = options.resourcePath.startsWith('/') ? options.resourcePath : `/${options.resourcePath}`;
            }
        }
        else {
            // Otherwise generate it from the path and parameters
            resourcePath = fullPath;
            // Special handling for common REST patterns - if the path looks like /123 and pathParameters has id:123, 
            // convert it to /{id}
            if (Object.keys(pathParams).length > 0) {
                Object.entries(pathParams).forEach(([key, value]) => {
                    if (value && fullPath.includes(`/${value}`)) {
                        // Replace /123 with /{id}
                        resourcePath = resourcePath.replace(`/${value}`, `/{${key}}`);
                    }
                    else if (value && fullPath.includes(`${value}`)) {
                        // For cases where the value is elsewhere in the path
                        resourcePath = resourcePath.replace(`${value}`, `{${key}}`);
                    }
                });
            }
        }
        // For debugging
        this.log(LambdaTestHarnessLogLevel.DEBUG, `Controller: ${controllerName}, Path: ${fullPath}, Resource: ${resourcePath}, PathParams:`, pathParams);
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
    createMockContext(options = {}) {
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
    createTestHandler() {
        return async (event, context) => {
            try {
                // Check if the controller has a LambdaHandler method and call it
                if (typeof this.controller.LambdaHandler === 'function') {
                    // For debugging
                    this.log(LambdaTestHarnessLogLevel.DEBUG, 'Calling LambdaHandler with event:', {
                        httpMethod: event.httpMethod,
                        path: event.path,
                        resource: event.resource,
                        pathParameters: event.pathParameters
                    });
                    return await this.controller.LambdaHandler(event, context);
                }
                else {
                    throw new Error('Controller does not have a LambdaHandler method');
                }
            }
            catch (error) {
                this.log(LambdaTestHarnessLogLevel.ERROR, 'Error in test handler:', error);
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
    async get(path, options = {}) {
        const event = this.createMockEvent('GET', path, options);
        const context = this.createMockContext();
        const handler = this.createTestHandler();
        return handler(event, context);
    }
    async post(path, options = {}) {
        const event = this.createMockEvent('POST', path, options);
        const context = this.createMockContext();
        const handler = this.createTestHandler();
        return handler(event, context);
    }
    async put(path, options = {}) {
        const event = this.createMockEvent('PUT', path, options);
        const context = this.createMockContext();
        const handler = this.createTestHandler();
        return handler(event, context);
    }
    async patch(path, options = {}) {
        const event = this.createMockEvent('PATCH', path, options);
        const context = this.createMockContext();
        const handler = this.createTestHandler();
        return handler(event, context);
    }
    async delete(path, options = {}) {
        const event = this.createMockEvent('DELETE', path, options);
        const context = this.createMockContext();
        const handler = this.createTestHandler();
        return handler(event, context);
    }
}
exports.LambdaTestHarness = LambdaTestHarness;
// Example usage in tests:
/*
describe('UserController', () => {
    // Create test harness with INFO level logging (shows warnings and info messages)
    const harness = new LambdaTestHarness(new UserController(), {
        logLevel: LogLevel.INFO
    });
    
    // Or create with silent logging for CI/CD environments
    const silentHarness = new LambdaTestHarness(new UserController(), {
        logLevel: LogLevel.SILENT
    });
    
    // Or create with debug logging for detailed troubleshooting
    const debugHarness = new LambdaTestHarness(new UserController(), {
        logLevel: LogLevel.DEBUG
    });
    
    it('should get user by id', async () => {
        const response = await harness.get('/users/123', {
            pathParameters: { id: '123' }
        });
        
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toHaveProperty('user');
    });

    it('should create user', async () => {
        const response = await harness.post('/users', {
            body: {
                name: 'Test User',
                email: 'test@example.com'
            }
        });
        
        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toHaveProperty('user.id');
    });
})
*/ 
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXRlc3QtaGFybmVzcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL2xhbWJkYS10ZXN0LWhhcm5lc3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBR0EsSUFBWSx5QkFNWDtBQU5ELFdBQVkseUJBQXlCO0lBQ25DLDZFQUFVLENBQUE7SUFDViwyRUFBUyxDQUFBO0lBQ1QseUVBQVEsQ0FBQTtJQUNSLHlFQUFRLENBQUE7SUFDUiwyRUFBUyxDQUFBO0FBQ1gsQ0FBQyxFQU5XLHlCQUF5Qix5Q0FBekIseUJBQXlCLFFBTXBDO0FBb0RELE1BQWEsaUJBQWlCO0lBQ3BCLFVBQVUsQ0FBcUI7SUFDL0IsT0FBTyxDQUFNO0lBQ2IsUUFBUSxDQUE0QjtJQUU1QyxZQUFZLFVBQWUsRUFBRSxVQUFvQyxFQUFFO1FBQ2pFLElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsSUFBSSx5QkFBeUIsQ0FBQyxJQUFJLENBQUM7UUFDbkUsdUVBQXVFO1FBQ3ZFLElBQUksT0FBTyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzFCLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO2dCQUNsQyxJQUFJLENBQUM7b0JBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNmLENBQUM7Z0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztvQkFDZixJQUFJLENBQUMsR0FBRyxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxrQ0FBa0MsR0FBRyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7Z0JBQzdGLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQztZQUNILDJFQUEyRTtZQUMzRSxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUMvRCxDQUFDO1FBRUQsNkNBQTZDO1FBQzdDLElBQUksQ0FB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T0FBTyxDQUFDLENBQUM7UUFDekQsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDekMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDekMsT0FBTyxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRCxLQUFLLENBQUMsS0FBSyxDQUFDLElBQVksRUFBRSxVQUE0QixFQUFFO1FBQ3RELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUMzRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztRQUN6QyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztRQUN6QyxPQUFPLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVELEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBWSxFQUFFLFVBQTRCLEVBQUU7UUFDdkQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQzVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQ3pDLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQ3pDLE9BQU8sT0FBTyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNqQyxDQUFDO0NBQ0Y7QUFsUEQsOENBa1BDO0FBRUQsMEJBQTBCO0FBQzFCOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztFQXNDRSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0LCBDb2duaXRvSWRlbnRpdHksIENsaWVudENvbnRleHQsIENsaWVudENvbnRleHRDbGllbnQsIENsaWVudENvbnRleHRFbnYgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IEFQSUNvbnRyb2xsZXIgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5cbmV4cG9ydCBlbnVtIExhbWJkYVRlc3RIYXJuZXNzTG9nTGV2ZWwge1xuICBTSUxFTlQgPSAwLFxuICBFUlJPUiA9IDEsXG4gIFdBUk4gPSAyLFxuICBJTkZPID0gMyxcbiAgREVCVUcgPSA0XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVGVzdEV2ZW50T3B0aW9ucyB7XG4gIHBhdGg/OiBzdHJpbmc7XG4gIGh0dHBNZXRob2Q/OiBzdHJpbmc7XG4gIGhlYWRlcnM/OiB7IFsga2V5OiBzdHJpbmcgXTogc3RyaW5nIH07XG4gIG11bHRpVmFsdWVIZWFkZXJzPzogeyBbIGtleTogc3RyaW5nIF06IHN0cmluZ1tdIH07XG4gIHF1ZXJ5U3RyaW5nUGFyYW1ldGVycz86IHsgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmcgfTtcbiAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVycz86IHsgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmdbXSB9O1xuICBwYXRoUGFyYW1ldGVycz86IHsgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmcgfTtcbiAgYm9keT86IGFueTtcbiAgaXNCYXNlNjRFbmNvZGVkPzogYm9vbGVhbjtcbiAgcmVxdWVzdENvbnRleHQ/OiBhbnk7XG4gIHJlc291cmNlPzogc3RyaW5nO1xuICBzdGFnZVZhcmlhYmxlcz86IHsgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmcgfTtcbiAgcmVxdWVzdFRpbWVFcG9jaD86IG51bWJlcjtcbiAgcmVzb3VyY2VQYXRoPzogc3RyaW5nO1xuICBhcGlJZD86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBUZXN0Q29udGV4dE9wdGlvbnMge1xuICBjYWxsYmFja1dhaXRzRm9yRW1wdHlFdmVudExvb3A/OiBib29sZWFuO1xuICBmdW5jdGlvbk5hbWU/OiBzdHJpbmc7XG4gIGZ1bmN0aW9uVmVyc2lvbj86IHN0cmluZztcbiAgaW52b2tlZEZ1bmN0aW9uQXJuPzogc3RyaW5nO1xuICBtZW1vcnlMaW1pdEluTUI/OiBzdHJpbmc7XG4gIGF3c1JlcXVlc3RJZD86IHN0cmluZztcbiAgbG9nR3JvdXBOYW1lPzogc3RyaW5nO1xuICBsb2dTdHJlYW1OYW1lPzogc3RyaW5nO1xuICBnZXRSZW1haW5pbmdUaW1lSW5NaWxsaXM/OiAoKSA9PiBudW1iZXI7XG4gIGRvbmU/OiAoKSA9PiB2b2lkO1xuICBmYWlsPzogKCkgPT4gdm9pZDtcbiAgc3VjY2VlZD86ICgpID0+IHZvaWQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGFtYmRhVGVzdEhhcm5lc3NPcHRpb25zIHtcbiAgbG9nTGV2ZWw/OiBMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsO1xuICBjb250ZXh0PzogVGVzdENvbnRleHRPcHRpb25zO1xuICAvKipcbiAgICogTGlzdCBvZiBtb2R1bGUgcGF0aHMgdG8gcmVxdWlyZSBiZWZvcmUgcnVubmluZyB0ZXN0cywgc2ltdWxhdGluZyBMYW1iZGEgbGF5ZXIgZW50cnkgcGFja2FnZXNcbiAgICovXG4gIGVudHJ5UGFja2FnZXM/OiBzdHJpbmdbXTtcbn1cblxudHlwZSBMYW1iZGFIYW5kbGVyID0gKGV2ZW50OiBhbnksIGNvbnRleHQ6IGFueSkgPT4gUHJvbWlzZTxhbnk+O1xuXG4vLyBEZWZpbmUgYSB0eXBlIGZvciBjb250cm9sbGVycyB0aGF0IGhhdmUgYSBjb250cm9sbGVyTmFtZSBwcm9wZXJ0eVxuaW50ZXJmYWNlIENvbnRyb2xsZXJXaXRoTmFtZSB7XG4gIGNvbnRyb2xsZXJOYW1lOiBzdHJpbmc7XG4gIExhbWJkYUhhbmRsZXI6IChldmVudDogYW55LCBjb250ZXh0OiBhbnkpID0+IFByb21pc2U8YW55Pjtcbn1cblxuZXhwb3J0IGNsYXNzIExhbWJkYVRlc3RIYXJuZXNzIHtcbiAgcHJpdmF0ZSBjb250cm9sbGVyOiBDb250cm9sbGVyV2l0aE5hbWU7XG4gIHByaXZhdGUgY29udGV4dDogYW55O1xuICBwcml2YXRlIGxvZ0xldmVsOiBMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsO1xuXG4gIGNvbnN0cnVjdG9yKGNvbnRyb2xsZXI6IGFueSwgb3B0aW9uczogTGFtYmRhVGVzdEhhcm5lc3NPcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmxvZ0xldmVsID0gb3B0aW9ucy5sb2dMZXZlbCA/PyBMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLldBUk47XG4gICAgLy8gTG9hZCBlbnRyeSBwYWNrYWdlcyAoc2ltdWxhdGUgTGFtYmRhIGxheWVycykgYmVmb3JlIGNvbnRyb2xsZXIgc2V0dXBcbiAgICBpZiAob3B0aW9ucy5lbnRyeVBhY2thZ2VzKSB7XG4gICAgICBvcHRpb25zLmVudHJ5UGFja2FnZXMuZm9yRWFjaChwa2cgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlcXVpcmUocGtnKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZyhMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLkVSUk9SLCBgRmFpbGVkIHRvIGltcG9ydCBlbnRyeSBwYWNrYWdlICR7cGtnfTpgLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy8gQWxzbyBzZXQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIGVudHJ5IHBhY2thZ2VzIGlmIG5lZWRlZCBieSBkZWNvcmF0b3JzXG4gICAgICBwcm9jZXNzLmVudi5FTlRSWV9QQUNLQUdFUyA9IG9wdGlvbnMuZW50cnlQYWNrYWdlcy5qb2luKCcsJyk7XG4gICAgfVxuXG4gICAgLy8gRW5zdXJlIHRoZSBjb250cm9sbGVyIGhhcyBhIGNvbnRyb2xsZXJOYW1lXG4gICAgaWYgKCFjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lKSB7XG4gICAgICB0aGlzLmxvZyhMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLldBUk4sICdXYXJuaW5nOiBjb250cm9sbGVyIGRvZXMgbm90IGhhdmUgYSBjb250cm9sbGVyTmFtZSBwcm9wZXJ0eS4gUm91dGUgbWF0Y2hpbmcgbWF5IG5vdCB3b3JrIGNvcnJlY3RseS4nKTtcbiAgICB9XG5cbiAgICAvLyBFbnN1cmUgdGhlIGNvbnRyb2xsZXIgaGFzIGEgTGFtYmRhSGFuZGxlciBtZXRob2RcbiAgICBpZiAoIWNvbnRyb2xsZXIuTGFtYmRhSGFuZGxlciAmJiB0eXBlb2YgY29udHJvbGxlci5oYW5kbGVSZXF1ZXN0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzLmxvZyhMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLklORk8sICdBZGRpbmcgTGFtYmRhSGFuZGxlciB0byBjb250cm9sbGVyJyk7XG4gICAgICBjb250cm9sbGVyLkxhbWJkYUhhbmRsZXIgPSBjb250cm9sbGVyLmhhbmRsZVJlcXVlc3QuYmluZChjb250cm9sbGVyKTtcbiAgICB9XG5cbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBjb250cm9sbGVyO1xuICAgIHRoaXMuY29udGV4dCA9IG9wdGlvbnMuY29udGV4dDtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBsb2dnaW5nIG1ldGhvZCB0aGF0IHJlc3BlY3RzIHRoZSBjb25maWd1cmVkIGxvZyBsZXZlbFxuICAgKi9cbiAgcHJpdmF0ZSBsb2cobGV2ZWw6IExhbWJkYVRlc3RIYXJuZXNzTG9nTGV2ZWwsIG1lc3NhZ2U6IHN0cmluZywgLi4uYXJnczogYW55W10pOiB2b2lkIHtcbiAgICBpZiAobGV2ZWwgPD0gdGhpcy5sb2dMZXZlbCkge1xuICAgICAgc3dpdGNoIChsZXZlbCkge1xuICAgICAgICBjYXNlIExhbWJkYVRlc3RIYXJuZXNzTG9nTGV2ZWwuRVJST1I6XG4gICAgICAgICAgY29uc29sZS5lcnJvcihtZXNzYWdlLCAuLi5hcmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLldBUk46XG4gICAgICAgICAgY29uc29sZS53YXJuKG1lc3NhZ2UsIC4uLmFyZ3MpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIExhbWJkYVRlc3RIYXJuZXNzTG9nTGV2ZWwuSU5GTzpcbiAgICAgICAgICBjb25zb2xlLmxvZyhtZXNzYWdlLCAuLi5hcmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLkRFQlVHOlxuICAgICAgICAgIGNvbnNvbGUubG9nKGBbREVCVUddICR7bWVzc2FnZX1gLCAuLi5hcmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAvLyBTSUxFTlQgbGV2ZWwgb3IgdW5rbm93biAtIGRvIG5vdGhpbmdcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZU1vY2tFdmVudChodHRwTWV0aG9kOiBzdHJpbmcsIHBhdGg6IHN0cmluZywgb3B0aW9uczogVGVzdEV2ZW50T3B0aW9ucyA9IHt9KTogYW55IHtcbiAgICAvLyBHZXQgdGhlIGNvbnRyb2xsZXIgbmFtZSBmcm9tIHRoZSBjb250cm9sbGVyIGluc3RhbmNlXG4gICAgY29uc3QgY29udHJvbGxlck5hbWUgPSB0aGlzLmNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUgfHwgJyc7XG5cbiAgICAvLyBFbnN1cmUgcGF0aCBzdGFydHMgd2l0aCBhIHNsYXNoXG4gICAgY29uc3Qgbm9ybWFsaXplZFBhdGggPSBwYXRoLnN0YXJ0c1dpdGgoJy8nKSA/IHBhdGggOiBgLyR7cGF0aH1gO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSBmdWxsIHBhdGggaW5jbHVkaW5nIGNvbnRyb2xsZXIgbmFtZSBpZiBpdCdzIG5vdCBhbHJlYWR5IGluY2x1ZGVkXG4gICAgLy8gVGhpcyBuZWVkcyB0byBoYW5kbGUgdGhlIGNhc2Ugd2hlcmUgdGhlIGNvbnRyb2xsZXIgbmFtZSBtaWdodCBhbHJlYWR5IGJlIGluIHRoZSBwYXRoXG4gICAgY29uc3QgZnVsbFBhdGggPSBjb250cm9sbGVyTmFtZSAmJiAhbm9ybWFsaXplZFBhdGguc3RhcnRzV2l0aChgLyR7Y29udHJvbGxlck5hbWV9L2ApICYmICFub3JtYWxpemVkUGF0aC5zdGFydHNXaXRoKGAvJHtjb250cm9sbGVyTmFtZX1gKVxuICAgICAgPyBgLyR7Y29udHJvbGxlck5hbWV9JHtub3JtYWxpemVkUGF0aH1gXG4gICAgICA6IG5vcm1hbGl6ZWRQYXRoO1xuXG4gICAgLy8gRXh0cmFjdCBwYXRoIHBhcmFtZXRlcnMgZnJvbSB0aGUgcHJvdmlkZWQgb3B0aW9uc1xuICAgIGNvbnN0IHBhdGhQYXJhbXMgPSBvcHRpb25zLnBhdGhQYXJhbWV0ZXJzIHx8IHt9O1xuXG4gICAgLy8gRm9yIHJlc291cmNlIHBhdGggZ2VuZXJhdGlvbiwgd2UgbmVlZCB0byBkZXRlcm1pbmUgaWYgdGhpcyBpcyBhIHBhcmFtZXRlcml6ZWQgcGF0aFxuICAgIC8vIElmIHJlc291cmNlUGF0aCBpcyBleHBsaWNpdGx5IHByb3ZpZGVkLCB1c2UgdGhhdFxuICAgIGxldCByZXNvdXJjZVBhdGg6IHN0cmluZztcbiAgICBpZiAob3B0aW9ucy5yZXNvdXJjZVBhdGgpIHtcbiAgICAgIC8vIElmIHRoZSByZXNvdXJjZVBhdGggZG9lc24ndCBpbmNsdWRlIHRoZSBjb250cm9sbGVyIG5hbWUsIGFkZCBpdFxuICAgICAgaWYgKGNvbnRyb2xsZXJOYW1lICYmICFvcHRpb25zLnJlc291cmNlUGF0aC5zdGFydHNXaXRoKGAvJHtjb250cm9sbGVyTmFtZX1gKSkge1xuICAgICAgICByZXNvdXJjZVBhdGggPSBgLyR7Y29udHJvbGxlck5hbWV9JHtvcHRpb25zLnJlc291cmNlUGF0aC5zdGFydHNXaXRoKCcvJykgPyBvcHRpb25zLnJlc291cmNlUGF0aCA6IGAvJHtvcHRpb25zLnJlc291cmNlUGF0aH1gfWA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNvdXJjZVBhdGggPSBvcHRpb25zLnJlc291cmNlUGF0aC5zdGFydHNXaXRoKCcvJykgPyBvcHRpb25zLnJlc291cmNlUGF0aCA6IGAvJHtvcHRpb25zLnJlc291cmNlUGF0aH1gO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBPdGhlcndpc2UgZ2VuZXJhdGUgaXQgZnJvbSB0aGUgcGF0aCBhbmQgcGFyYW1ldGVyc1xuICAgICAgcmVzb3VyY2VQYXRoID0gZnVsbFBhdGg7XG5cbiAgICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIGNvbW1vbiBSRVNUIHBhdHRlcm5zIC0gaWYgdGhlIHBhdGggbG9va3MgbGlrZSAvMTIzIGFuZCBwYXRoUGFyYW1ldGVycyBoYXMgaWQ6MTIzLCBcbiAgICAgIC8vIGNvbnZlcnQgaXQgdG8gL3tpZH1cbiAgICAgIGlmIChPYmplY3Qua2V5cyhwYXRoUGFyYW1zKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIE9iamVjdC5lbnRyaWVzKHBhdGhQYXJhbXMpLmZvckVhY2goKFsga2V5LCB2YWx1ZSBdKSA9PiB7XG4gICAgICAgICAgaWYgKHZhbHVlICYmIGZ1bGxQYXRoLmluY2x1ZGVzKGAvJHt2YWx1ZX1gKSkge1xuICAgICAgICAgICAgLy8gUmVwbGFjZSAvMTIzIHdpdGggL3tpZH1cbiAgICAgICAgICAgIHJlc291cmNlUGF0aCA9IHJlc291cmNlUGF0aC5yZXBsYWNlKGAvJHt2YWx1ZX1gLCBgL3ske2tleX19YCk7XG4gICAgICAgICAgfSBlbHNlIGlmICh2YWx1ZSAmJiBmdWxsUGF0aC5pbmNsdWRlcyhgJHt2YWx1ZX1gKSkge1xuICAgICAgICAgICAgLy8gRm9yIGNhc2VzIHdoZXJlIHRoZSB2YWx1ZSBpcyBlbHNld2hlcmUgaW4gdGhlIHBhdGhcbiAgICAgICAgICAgIHJlc291cmNlUGF0aCA9IHJlc291cmNlUGF0aC5yZXBsYWNlKGAke3ZhbHVlfWAsIGB7JHtrZXl9fWApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRm9yIGRlYnVnZ2luZ1xuICAgIHRoaXMubG9nKExhbWJkYVRlc3RIYXJuZXNzTG9nTGV2ZWwuREVCVUcsIGBDb250cm9sbGVyOiAke2NvbnRyb2xsZXJOYW1lfSwgUGF0aDogJHtmdWxsUGF0aH0sIFJlc291cmNlOiAke3Jlc291cmNlUGF0aH0sIFBhdGhQYXJhbXM6YCwgcGF0aFBhcmFtcyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgaHR0cE1ldGhvZCxcbiAgICAgIHBhdGg6IGZ1bGxQYXRoLFxuICAgICAgaGVhZGVyczogb3B0aW9ucy5oZWFkZXJzIHx8IHt9LFxuICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IG9wdGlvbnMubXVsdGlWYWx1ZUhlYWRlcnMgfHwge30sXG4gICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG9wdGlvbnMucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIHx8IG51bGwsXG4gICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBvcHRpb25zLm11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnMgfHwgbnVsbCxcbiAgICAgIHBhdGhQYXJhbWV0ZXJzOiBwYXRoUGFyYW1zLFxuICAgICAgYm9keTogb3B0aW9ucy5ib2R5ID8gSlNPTi5zdHJpbmdpZnkob3B0aW9ucy5ib2R5KSA6IG51bGwsXG4gICAgICBpc0Jhc2U2NEVuY29kZWQ6IG9wdGlvbnMuaXNCYXNlNjRFbmNvZGVkIHx8IGZhbHNlLFxuICAgICAgcmVxdWVzdENvbnRleHQ6IG9wdGlvbnMucmVxdWVzdENvbnRleHQgfHwge1xuICAgICAgICBhY2NvdW50SWQ6ICcxMjM0NTY3ODkwMTInLFxuICAgICAgICBhcGlJZDogb3B0aW9ucy5hcGlJZCB8fCAndGVzdC1hcGknLFxuICAgICAgICBhdXRob3JpemVyOiBudWxsLFxuICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgICAgaHR0cE1ldGhvZCxcbiAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICBhY2Nlc3NLZXk6IG51bGwsXG4gICAgICAgICAgYWNjb3VudElkOiBudWxsLFxuICAgICAgICAgIGFwaUtleTogbnVsbCxcbiAgICAgICAgICBhcGlLZXlJZDogbnVsbCxcbiAgICAgICAgICBjYWxsZXI6IG51bGwsXG4gICAgICAgICAgY2xpZW50Q2VydDogbnVsbCxcbiAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25UeXBlOiBudWxsLFxuICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxuICAgICAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogbnVsbCxcbiAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgICBzb3VyY2VJcDogJzEyNy4wLjAuMScsXG4gICAgICAgICAgdXNlcjogbnVsbCxcbiAgICAgICAgICB1c2VyQWdlbnQ6IG51bGwsXG4gICAgICAgICAgdXNlckFybjogbnVsbFxuICAgICAgICB9LFxuICAgICAgICBwYXRoOiBmdWxsUGF0aCxcbiAgICAgICAgc3RhZ2U6ICd0ZXN0JyxcbiAgICAgICAgcmVxdWVzdElkOiBvcHRpb25zLnJlcXVlc3RUaW1lRXBvY2g/LnRvU3RyaW5nKCkgfHwgJ3Rlc3QtcmVxdWVzdC1pZCcsXG4gICAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IG9wdGlvbnMucmVxdWVzdFRpbWVFcG9jaCB8fCBEYXRlLm5vdygpLFxuICAgICAgICByZXNvdXJjZUlkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgICAgIHJlc291cmNlUGF0aDogcmVzb3VyY2VQYXRoXG4gICAgICB9LFxuICAgICAgcmVzb3VyY2U6IHJlc291cmNlUGF0aCxcbiAgICAgIHN0YWdlVmFyaWFibGVzOiBvcHRpb25zLnN0YWdlVmFyaWFibGVzIHx8IG51bGxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVNb2NrQ29udGV4dChvcHRpb25zOiBUZXN0Q29udGV4dE9wdGlvbnMgPSB7fSk6IGFueSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNhbGxiYWNrV2FpdHNGb3JFbXB0eUV2ZW50TG9vcDogb3B0aW9ucy5jYWxsYmFja1dhaXRzRm9yRW1wdHlFdmVudExvb3AgPz8gdHJ1ZSxcbiAgICAgIGZ1bmN0aW9uTmFtZTogb3B0aW9ucy5mdW5jdGlvbk5hbWUgfHwgJ3Rlc3QtZnVuY3Rpb24nLFxuICAgICAgZnVuY3Rpb25WZXJzaW9uOiBvcHRpb25zLmZ1bmN0aW9uVmVyc2lvbiB8fCAnJExBVEVTVCcsXG4gICAgICBpbnZva2VkRnVuY3Rpb25Bcm46IG9wdGlvbnMuaW52b2tlZEZ1bmN0aW9uQXJuIHx8ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtZnVuY3Rpb24nLFxuICAgICAgbWVtb3J5TGltaXRJbk1COiBvcHRpb25zLm1lbW9yeUxpbWl0SW5NQiB8fCAnMTI4JyxcbiAgICAgIGF3c1JlcXVlc3RJZDogb3B0aW9ucy5hd3NSZXF1ZXN0SWQgfHwgJ3Rlc3QtcmVxdWVzdC1pZCcsXG4gICAgICBsb2dHcm91cE5hbWU6IG9wdGlvbnMubG9nR3JvdXBOYW1lIHx8ICcvYXdzL2xhbWJkYS90ZXN0LWZ1bmN0aW9uJyxcbiAgICAgIGxvZ1N0cmVhbU5hbWU6IG9wdGlvbnMubG9nU3RyZWFtTmFtZSB8fCAnMjAyMS8wMS8wMS9bJExBVEVTVF10ZXN0LXN0cmVhbScsXG4gICAgICBnZXRSZW1haW5pbmdUaW1lSW5NaWxsaXM6IG9wdGlvbnMuZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzIHx8ICgoKSA9PiAzMDAwMCksXG4gICAgICBkb25lOiBvcHRpb25zLmRvbmUgfHwgKCgpID0+IHsgfSksXG4gICAgICBmYWlsOiBvcHRpb25zLmZhaWwgfHwgKCgpID0+IHsgfSksXG4gICAgICBzdWNjZWVkOiBvcHRpb25zLnN1Y2NlZWQgfHwgKCgpID0+IHsgfSlcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVUZXN0SGFuZGxlcigpOiBMYW1iZGFIYW5kbGVyIHtcbiAgICByZXR1cm4gYXN5bmMgKGV2ZW50OiBhbnksIGNvbnRleHQ6IGFueSkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGNvbnRyb2xsZXIgaGFzIGEgTGFtYmRhSGFuZGxlciBtZXRob2QgYW5kIGNhbGwgaXRcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmNvbnRyb2xsZXIuTGFtYmRhSGFuZGxlciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEZvciBkZWJ1Z2dpbmdcbiAgICAgICAgICB0aGlzLmxvZyhMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLkRFQlVHLCAnQ2FsbGluZyBMYW1iZGFIYW5kbGVyIHdpdGggZXZlbnQ6Jywge1xuICAgICAgICAgICAgaHR0cE1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcbiAgICAgICAgICAgIHBhdGg6IGV2ZW50LnBhdGgsXG4gICAgICAgICAgICByZXNvdXJjZTogZXZlbnQucmVzb3VyY2UsXG4gICAgICAgICAgICBwYXRoUGFyYW1ldGVyczogZXZlbnQucGF0aFBhcmFtZXRlcnNcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbnRyb2xsZXIuTGFtYmRhSGFuZGxlcihldmVudCwgY29udGV4dCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb250cm9sbGVyIGRvZXMgbm90IGhhdmUgYSBMYW1iZGFIYW5kbGVyIG1ldGhvZCcpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgICB0aGlzLmxvZyhMYW1iZGFUZXN0SGFybmVzc0xvZ0xldmVsLkVSUk9SLCAnRXJyb3IgaW4gdGVzdCBoYW5kbGVyOicsIGVycm9yKTtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2tcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBtZXNzYWdlOiAnQW4gdW5rbm93biBlcnJvciBvY2N1cnJlZCdcbiAgICAgICAgICB9KVxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICBhc3luYyBnZXQocGF0aDogc3RyaW5nLCBvcHRpb25zOiBUZXN0RXZlbnRPcHRpb25zID0ge30pOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IGV2ZW50ID0gdGhpcy5jcmVhdGVNb2NrRXZlbnQoJ0dFVCcsIHBhdGgsIG9wdGlvbnMpO1xuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLmNyZWF0ZU1vY2tDb250ZXh0KCk7XG4gICAgY29uc3QgaGFuZGxlciA9IHRoaXMuY3JlYXRlVGVzdEhhbmRsZXIoKTtcbiAgICByZXR1cm4gaGFuZGxlcihldmVudCwgY29udGV4dCk7XG4gIH1cblxuICBhc3luYyBwb3N0KHBhdGg6IHN0cmluZywgb3B0aW9uczogVGVzdEV2ZW50T3B0aW9ucyA9IHt9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBldmVudCA9IHRoaXMuY3JlYXRlTW9ja0V2ZW50KCdQT1NUJywgcGF0aCwgb3B0aW9ucyk7XG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuY3JlYXRlTW9ja0NvbnRleHQoKTtcbiAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5jcmVhdGVUZXN0SGFuZGxlcigpO1xuICAgIHJldHVybiBoYW5kbGVyKGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIHB1dChwYXRoOiBzdHJpbmcsIG9wdGlvbnM6IFRlc3RFdmVudE9wdGlvbnMgPSB7fSk6IFByb21pc2U8YW55PiB7XG4gICAgY29uc3QgZXZlbnQgPSB0aGlzLmNyZWF0ZU1vY2tFdmVudCgnUFVUJywgcGF0aCwgb3B0aW9ucyk7XG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuY3JlYXRlTW9ja0NvbnRleHQoKTtcbiAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5jcmVhdGVUZXN0SGFuZGxlcigpO1xuICAgIHJldHVybiBoYW5kbGVyKGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIHBhdGNoKHBhdGg6IHN0cmluZywgb3B0aW9uczogVGVzdEV2ZW50T3B0aW9ucyA9IHt9KTogUHJvbWlzZTxhbnk+IHtcbiAgICBjb25zdCBldmVudCA9IHRoaXMuY3JlYXRlTW9ja0V2ZW50KCdQQVRDSCcsIHBhdGgsIG9wdGlvbnMpO1xuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLmNyZWF0ZU1vY2tDb250ZXh0KCk7XG4gICAgY29uc3QgaGFuZGxlciA9IHRoaXMuY3JlYXRlVGVzdEhhbmRsZXIoKTtcbiAgICByZXR1cm4gaGFuZGxlcihldmVudCwgY29udGV4dCk7XG4gIH1cblxuICBhc3luYyBkZWxldGUocGF0aDogc3RyaW5nLCBvcHRpb25zOiBUZXN0RXZlbnRPcHRpb25zID0ge30pOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IGV2ZW50ID0gdGhpcy5jcmVhdGVNb2NrRXZlbnQoJ0RFTEVURScsIHBhdGgsIG9wdGlvbnMpO1xuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLmNyZWF0ZU1vY2tDb250ZXh0KCk7XG4gICAgY29uc3QgaGFuZGxlciA9IHRoaXMuY3JlYXRlVGVzdEhhbmRsZXIoKTtcbiAgICByZXR1cm4gaGFuZGxlcihldmVudCwgY29udGV4dCk7XG4gIH1cbn1cblxuLy8gRXhhbXBsZSB1c2FnZSBpbiB0ZXN0czpcbi8qXG5kZXNjcmliZSgnVXNlckNvbnRyb2xsZXInLCAoKSA9PiB7XG4gICAgLy8gQ3JlYXRlIHRlc3QgaGFybmVzcyB3aXRoIElORk8gbGV2ZWwgbG9nZ2luZyAoc2hvd3Mgd2FybmluZ3MgYW5kIGluZm8gbWVzc2FnZXMpXG4gICAgY29uc3QgaGFybmVzcyA9IG5ldyBMYW1iZGFUZXN0SGFybmVzcyhuZXcgVXNlckNvbnRyb2xsZXIoKSwgeyBcbiAgICAgICAgbG9nTGV2ZWw6IExvZ0xldmVsLklORk8gXG4gICAgfSk7XG4gICAgXG4gICAgLy8gT3IgY3JlYXRlIHdpdGggc2lsZW50IGxvZ2dpbmcgZm9yIENJL0NEIGVudmlyb25tZW50c1xuICAgIGNvbnN0IHNpbGVudEhhcm5lc3MgPSBuZXcgTGFtYmRhVGVzdEhhcm5lc3MobmV3IFVzZXJDb250cm9sbGVyKCksIHsgXG4gICAgICAgIGxvZ0xldmVsOiBMb2dMZXZlbC5TSUxFTlQgXG4gICAgfSk7XG4gICAgXG4gICAgLy8gT3IgY3JlYXRlIHdpdGggZGVidWcgbG9nZ2luZyBmb3IgZGV0YWlsZWQgdHJvdWJsZXNob290aW5nXG4gICAgY29uc3QgZGVidWdIYXJuZXNzID0gbmV3IExhbWJkYVRlc3RIYXJuZXNzKG5ldyBVc2VyQ29udHJvbGxlcigpLCB7IFxuICAgICAgICBsb2dMZXZlbDogTG9nTGV2ZWwuREVCVUcgXG4gICAgfSk7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBnZXQgdXNlciBieSBpZCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3VzZXJzLzEyMycsIHtcbiAgICAgICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiAnMTIzJyB9XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSkpLnRvSGF2ZVByb3BlcnR5KCd1c2VyJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB1c2VyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3VzZXJzJywge1xuICAgICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdUZXN0IFVzZXInLFxuICAgICAgICAgICAgICAgIGVtYWlsOiAndGVzdEBleGFtcGxlLmNvbSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDEpO1xuICAgICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KSkudG9IYXZlUHJvcGVydHkoJ3VzZXIuaWQnKTtcbiAgICB9KTtcbn0pXG4qLyJdfQ==