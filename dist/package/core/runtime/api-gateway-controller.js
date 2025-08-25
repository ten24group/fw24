"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIController = exports.clearMiddlewares = exports.useMiddleware = void 0;
exports.createApiHandler = createApiHandler;
const decorators_1 = require("../../decorators");
const method_1 = require("../../decorators/method");
const utils_1 = require("../../validation/utils");
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const request_context_1 = require("./request-context");
const response_context_1 = require("./response-context");
const response_config_1 = require("./response-config");
const errors_1 = require("../../errors/");
// Global middleware management
const globalMiddlewares = [];
const useMiddleware = (middleware) => {
    globalMiddlewares.push(middleware);
};
exports.useMiddleware = useMiddleware;
const clearMiddlewares = () => {
    globalMiddlewares.length = 0;
};
exports.clearMiddlewares = clearMiddlewares;
/**
 * Creates an API handler without defining a class
 *
 * @example
 * ```ts
 * export const { handler, descriptor } = createApiHandler(
 *  { method: Get, name: 'demo', authorizer: 'NONE' },
 *   async ( event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
 *       return Promise.resolve({
 *           statusCode: 200,
 *           body: JSON.stringify({ message: "Hello World!"})
 *       })
 *   }
 * )
 * ```
 * @param options - The options for creating the API handler.
 * @param options.name - The name of the API handler.
 * @param options.path - The path for the API handler.
 * @param options.method - The HTTP method for the API handler.
 * @param handler - The handler function for the API handler.
 * @returns An object containing the handler function and the controller descriptor.
 */
function createApiHandler(options, handler) {
    const { name, path = '', method = method_1.Get, ...controllerConfig } = options;
    let ControllerDescriptor = class ControllerDescriptor {
        async inlineHandler() {
            // placeholder function only used for routing metadata
        }
    };
    __decorate([
        method(path)
    ], ControllerDescriptor.prototype, "inlineHandler", null);
    ControllerDescriptor = __decorate([
        (0, decorators_1.Controller)(name, { ...controllerConfig, autoExportLambdaHandler: false })
    ], ControllerDescriptor);
    Object.defineProperty(handler, 'name', { value: 'handler' });
    return {
        handler,
        descriptor: ControllerDescriptor
    };
}
class APIController extends abstract_lambda_handler_1.AbstractLambdaHandler {
    middlewares = [];
    responseConfig;
    constructor(config = {}) {
        super();
        this.responseConfig = (0, response_config_1.mergeResponseConfig)(config.responseConfig);
    }
    /**
     * can be used to run some logic just before the request is processed like creating clients, di-injection ans so on.
     * @param _event - The event object from the API Gateway.
     * @param _context - The context object from the API Gateway.
     * @returns A promise that resolves when the controller is initialized.
    */
    async initialize(_event, _context) {
        // No-op for API controllers
        return Promise.resolve();
    }
    async getOverriddenHttpRequestValidationErrorMessages() {
        return Promise.resolve(new Map());
    }
    // Add middleware registration method
    useMiddleware(middleware) {
        this.middlewares.push(middleware);
    }
    getMiddlewares() {
        return [...globalMiddlewares, ...this.middlewares];
    }
    // Execute middleware pipeline
    async executeMiddlewarePipeline(phase, request, response, ctx, error) {
        const allMiddlewares = this.getMiddlewares();
        for (const middleware of allMiddlewares) {
            if (phase === 'onError' && middleware.onError && error) {
                await middleware.onError(error, request, response, ctx);
            }
            else if (phase !== 'onError' && middleware[phase]) {
                await middleware[phase](request, response, ctx);
            }
        }
    }
    async validate(requestContext, validations, _ctx) {
        let validationRules = validations;
        if ((0, utils_1.isInputValidationRule)(validations)) {
            if (['GET', 'DELETE'].includes(requestContext.httpMethod.toUpperCase())) {
                validationRules = { query: validations };
            }
            else if (['POST', 'PUT', 'PATCH'].includes(requestContext.httpMethod.toUpperCase())) {
                validationRules = { body: validations };
            }
        }
        if (!(0, utils_1.isHttpRequestValidationRule)(validationRules)) {
            throw new errors_1.InvalidHttpRequestValidationRuleError(validationRules);
        }
        return this.validator.validateHttpRequest({
            requestContext,
            validations: validationRules,
            collectErrors: true,
            verboseErrors: requestContext.debugMode,
            overriddenErrorMessages: await this.getOverriddenHttpRequestValidationErrorMessages()
        });
    }
    async makeRequestContext(event, context) {
        return new request_context_1.RequestContext(event, context);
    }
    async makeResponseContext(requestContext) {
        return new response_context_1.ResponseContext({
            traceId: requestContext.requestId,
            requestId: requestContext.requestId,
            debugMode: requestContext.debugMode,
            route: requestContext.path,
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            config: this.responseConfig
        });
    }
    /**
     * Lambda handler for the controller.
     * Handles incoming API Gateway events.
     * @param event - The event object from the API Gateway.
     * @param context - The context object from the API Gateway.
     * @returns The API Gateway response object.
     */
    async LambdaHandler(event, context) {
        // this.logger.info("LambdaHandler Received event:", JSON.stringify(event, null, 2));
        const request = await this.makeRequestContext(event, context);
        const response = await this.makeResponseContext(request);
        // Build the execution context
        const ctx = this.buildCtx(event, context, request, response);
        try {
            // Legacy initialize method for backward compatibility
            await this.initialize(event, context);
            // Execute before middleware
            await this.executeMiddlewarePipeline('before', request, response, ctx);
            const route = this.findMatchingRoute(request);
            // Validate the request if validations are defined
            if (route?.validations) {
                const validationResult = await this.validate(request, route.validations);
                if (!validationResult.pass) {
                    throw new errors_1.ValidationFailedError(validationResult.errors);
                }
            }
            // call the route function
            const routeFunction = this.getRouteFunction(route);
            let controllerResponse = routeFunction.call(this, request, response, ctx);
            if (controllerResponse instanceof Promise) {
                controllerResponse = await controllerResponse;
            }
            // Execute after middleware
            await this.executeMiddlewarePipeline('after', request, response, ctx);
            // If the controller returned anything (ResponseContext or raw API result), emit that
            if (controllerResponse != null) {
                return this.handleResponse(controllerResponse);
            }
        }
        catch (err) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            this.logger.error('LambdaHandler error: ', errorObj);
            // Execute error middleware
            await this.executeMiddlewarePipeline('onError', request, response, ctx, errorObj);
            return this.handleException(request, errorObj, response);
        }
        // Fallback to the in-memory responseContext
        return response.build();
    }
    /**
     * Finds the route that matches the HTTP method and resource.
     * @param requestData - The request data object.
     * @returns The matching route or null if not found.
     */
    findMatchingRoute(requestData) {
        let controller = this;
        // this.logger.info("Called findMatchingRoute with requestData: ", { requestData, routes: controller.routes });
        // Determine the controller base path by finding the longest common prefix that ends with the controller name
        let controllerBasePath = `/${controller.controllerName}`;
        let resourceWithoutRoot = '/';
        // For controllers in subdirectories, we need to match the actual resource path
        // Check if resource contains the controller name as part of a longer path
        const resourceParts = requestData.resource.split('/').filter(Boolean);
        const controllerNameParts = controller.controllerName.split('/').filter(Boolean);
        // Find if the controller name parts are present in the resource path
        let basePathEndIndex = -1;
        if (controllerNameParts.length > 0) {
            // Look for the controller name sequence in the resource path
            for (let i = 0; i <= resourceParts.length - controllerNameParts.length; i++) {
                let matches = true;
                for (let j = 0; j < controllerNameParts.length; j++) {
                    if (resourceParts[i + j] !== controllerNameParts[j]) {
                        matches = false;
                        break;
                    }
                }
                if (matches) {
                    basePathEndIndex = i + controllerNameParts.length - 1;
                    break;
                }
            }
        }
        if (basePathEndIndex >= 0) {
            // Found the controller base path in the resource
            const basePathParts = resourceParts.slice(0, basePathEndIndex + 1);
            controllerBasePath = '/' + basePathParts.join('/');
            const remainingParts = resourceParts.slice(basePathEndIndex + 1);
            resourceWithoutRoot = remainingParts.length > 0 ? '/' + remainingParts.join('/') : '/';
        }
        else {
            // Fallback to original logic for simple cases
            if (requestData.resource.startsWith(controllerBasePath)) {
                resourceWithoutRoot = requestData.resource.substring(controllerBasePath.length) || '/';
            }
        }
        // this.logger.info('controllerBasePath: ', controllerBasePath);
        // this.logger.info('resourceWithoutRoot: ', resourceWithoutRoot);
        // Separate routes into exact and parameterized for proper prioritization
        const exactMatches = [];
        const parameterizedMatches = [];
        // First pass: categorize routes by type and method
        for (const [routeKey, route] of Object.entries(controller.routes || {})) {
            const [routeMethod, routePath] = routeKey.split('|');
            // Skip if HTTP method doesn't match
            if (routeMethod !== requestData.httpMethod) {
                continue;
            }
            // Categorize route type
            if (routePath.includes('{') && routePath.includes('}')) {
                parameterizedMatches.push({ routeKey, route });
            }
            else {
                exactMatches.push({ routeKey, route });
            }
        }
        // Second pass: Try exact matches first (highest priority)
        for (const { routeKey, route } of exactMatches) {
            const [, routePath] = routeKey.split('|');
            if (routePath === resourceWithoutRoot) {
                this.logger.info(`Found exact match for route: ${routeKey}`);
                return route;
            }
        }
        // Third pass: Try parameterized matches (sorted by specificity)
        // Sort parameterized routes by specificity (more literal segments = higher priority)
        const sortedParameterizedMatches = parameterizedMatches
            .map(({ routeKey, route }) => {
            const [, routePath] = routeKey.split('|');
            const segments = routePath.split('/').filter(Boolean);
            const literalSegments = segments.filter(segment => !segment.includes('{'));
            // Specificity score: more literal segments = higher score
            // For equal literal segments, fewer total segments = higher score  
            const specificityScore = (literalSegments.length * 1000) - segments.length;
            return { routeKey, route, routePath, specificityScore };
        })
            .sort((a, b) => b.specificityScore - a.specificityScore); // Higher score first
        for (const { routeKey, route, routePath } of sortedParameterizedMatches) {
            // Convert framework {id} syntax to path-to-regexp :id syntax
            const pathToRegexpPattern = routePath.replace(/\{([^}]+)\}/g, ':$1');
            try {
                // Use path-to-regexp for proper parameter matching
                const { match } = require('path-to-regexp');
                const matcher = match(pathToRegexpPattern, { decode: decodeURIComponent });
                const matchResult = matcher(resourceWithoutRoot);
                if (matchResult) {
                    this.logger.info(`Found parameterized match for route: ${routeKey}`, {
                        pattern: pathToRegexpPattern,
                        params: matchResult.params,
                        specificityScore: sortedParameterizedMatches.find(m => m.routeKey === routeKey)?.specificityScore
                    });
                    // Note: We don't need to manually extract parameters since API Gateway
                    // already provides them in requestData.pathParameters
                    return route;
                }
            }
            catch (error) {
                this.logger.warn(`Error matching route pattern ${pathToRegexpPattern}:`, error);
                continue;
            }
        }
        this.logger.warn(`No matching route found for ${requestData.httpMethod}|${resourceWithoutRoot}`);
        return null;
    }
    /**
     * Retrieves the function associated with the route.
     * @param route - The matched route.
     * @returns The function associated with the route.
     */
    getRouteFunction(route) {
        if (!route) {
            return this.handleNotFound.bind(this);
        }
        //@ts-ignore
        const routeFunction = this[route.functionName];
        return typeof routeFunction === "function" ? routeFunction : this.handleNotFound.bind(this);
    }
    /**
     * Handles the NotFound route.
     * @param _req - The request object.
     * @returns The response object with a 404 status code.
     */
    handleNotFound(_req) {
        return this.handleResponse({
            statusCode: 404,
            body: JSON.stringify({ message: "No Route Found!" }),
        });
    }
    errorHandler;
    getErrorHandler() {
        if (!this.errorHandler) {
            this.errorHandler = (0, errors_1.createErrorHandler)();
        }
        return this.errorHandler;
    }
    /**
     * Handles exceptions and returns a JSON response with the error message.
     * @param _req - The request object.
     * @param err - The error object.
     * @returns The response object with a 500 status code.
     */
    handleException(req, err, res) {
        const errorResponse = this.getErrorHandler()(err, req, res);
        return this.handleResponse(errorResponse);
    }
    handleResponse(res) {
        if (res instanceof response_context_1.ResponseContext) {
            return res.build();
        }
        return res;
    }
    buildCtx(event, context, request, response) {
        const actor = this.extractActorContext(event, request);
        const ctx = {
            event,
            lambdaContext: context,
            request,
            response,
            actor,
            debugInfo: {},
            // Simple actor enhancement method
            enhanceActor: (enhancement) => {
                if (ctx.actor) {
                    Object.assign(ctx.actor, enhancement);
                }
            }
        };
        return ctx;
    }
    /**
     * Extracts actor context from the request
     * Override this method for custom actor extraction logic
     *
     * different middleware can enhance the actor context
     *
     * @example
     * ```ts
     * const middleware: APIControllerMiddleware = {
     *  before: async (_request, _response, ctx) => {
     *   ctx?.enhanceActor?.({
     *     roles: ['admin', 'user'],
     *     permissions: ['read', 'write'],
     *     subscription: { tier: 'enterprise' }
     *   });
     *  }
     * }
     *
     * useMiddleware(middleware);
     *
     * OR
     *
     * const securityMiddleware = {
     *   before: async (request, response, ctx) => {
     *     ctx.enhanceActor?.({
     *       riskProfile: await assessRisk(ctx.actor.actorId),
     *       device: await makeDeviceContext(request)
     *     });
     *   }
     * };
     *
     * useMiddleware(securityMiddleware);
     *
     * @param event - The event object from the API Gateway.
     * @param request - The request object from the API Gateway.
     * @returns The actor context.
     * ```
     */
    extractActorContext(event, request) {
        const timestamp = new Date().toISOString();
        const requestId = request.requestId;
        const actor = {
            requestId,
            timestamp,
            sourceIp: event.requestContext?.identity?.sourceIp,
            userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'],
            correlationId: request.headers?.['x-correlation-id'] || requestId,
        };
        // Cognito authentication
        if (event.requestContext?.authorizer?.claims) {
            const claims = event.requestContext.authorizer.claims;
            actor.authMethod = 'cognito';
            actor.actorType = 'user';
            actor.actorId = claims['cognito:username'] || claims.username || claims.sub;
            // Generic user fields
            actor.email = claims.email;
            actor.emailVerified = claims.email_verified === 'true' || claims.email_verified === true;
            actor.phoneNumber = claims.phone_number;
            actor.phoneVerified = claims.phone_number_verified === 'true' || claims.phone_number_verified === true;
            actor.firstName = claims.given_name;
            actor.lastName = claims.family_name;
            actor.name = claims.name;
            actor.locale = claims.locale;
            // Cognito-specific nested data
            const groups = claims['cognito:groups'];
            const parsedGroups = typeof groups === 'string' && groups.length > 0
                ? groups.split(',').map(g => g.trim()).filter(g => g.length > 0)
                : [];
            // Extract custom attributes
            const customAttributes = {};
            Object.keys(claims).forEach(key => {
                if (key.startsWith('custom:')) {
                    customAttributes[key.replace('custom:', '')] = claims[key];
                }
            });
            actor.cognito = {
                sub: claims.sub,
                username: claims['cognito:username'],
                groups: parsedGroups,
                authTime: claims.auth_time,
                identities: claims.identities,
                customAttributes: Object.keys(customAttributes).length > 0 ? customAttributes : undefined
            };
            actor.rawAuthContext = claims;
        }
        // API Key authentication
        else if (event.requestContext?.identity?.apiKey || request.headers?.['x-api-key']) {
            actor.authMethod = 'api-key';
            actor.actorType = 'service';
            let apiKeyId;
            let source;
            if (event.requestContext?.identity?.apiKey) {
                apiKeyId = event.requestContext.identity.apiKeyId || event.requestContext.identity.apiKey;
                source = 'request-context';
            }
            else {
                apiKeyId = request.headers['x-api-key'];
                source = 'header';
            }
            actor.actorId = `api-key:${apiKeyId}`;
            actor.apiKey = {
                id: apiKeyId,
                source: source
            };
        }
        // IAM authentication 
        else if (event.requestContext?.identity?.userArn) {
            actor.authMethod = 'iam';
            actor.actorType = 'service';
            actor.actorId = event.requestContext.identity.user || event.requestContext.identity.userArn;
            actor.iam = {
                userArn: event.requestContext.identity.userArn,
                userId: event.requestContext.identity.user || undefined,
                accountId: event.requestContext.identity.accountId || undefined,
                caller: event.requestContext.identity.caller || undefined
            };
        }
        // Anonymous
        else {
            actor.authMethod = 'anonymous';
            actor.actorType = 'anonymous';
            actor.actorId = 'anonymous';
        }
        // Session and tenant for analytics
        actor.sessionId = request.headers?.['x-session-id'];
        actor.tenantId = request.headers?.['x-tenant-id'] ||
            event.requestContext?.authorizer?.claims?.['custom:tenantId'];
        // API Gateway context
        actor.apiStage = event.requestContext?.stage;
        actor.apiId = event.requestContext?.apiId;
        return actor;
    }
}
exports.APIController = APIController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFzREEsNENBeUJDO0FBN0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFZakgsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQThCLEVBQUUsQ0FBQztBQUVqRCxNQUFNLGFBQWEsR0FBRyxDQUFDLFVBQW1DLEVBQUUsRUFBRTtJQUNuRSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDckMsQ0FBQyxDQUFBO0FBRlksUUFBQSxhQUFhLGlCQUV6QjtBQUNNLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxFQUFFO0lBQ25DLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFBO0FBRlksUUFBQSxnQkFBZ0Isb0JBRTVCO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILFNBQWdCLGdCQUFnQixDQUM5QixPQUlxQixFQUNyQixPQUFxRjtJQUdyRixNQUFNLEVBQUUsSUFBSSxFQUFFLElBQUksR0FBRyxFQUFFLEVBQUUsTUFBTSxHQUFHLFlBQUcsRUFBRSxHQUFHLGdCQUFnQixFQUFFLEdBQUcsT0FBTyxDQUFDO0lBR3ZFLElBQU0sb0JBQW9CLEdBQTFCLE1BQU0sb0JBQW9CO1FBRWxCLEFBQU4sS0FBSyxDQUFDLGFBQWE7WUFDakIsc0RBQXNEO1FBQ3hELENBQUM7S0FDRixDQUFBO0lBSE87UUFETCxNQUFNLENBQUMsSUFBSSxDQUFDOzZEQUdaO0lBSkcsb0JBQW9CO1FBRHpCLElBQUEsdUJBQVUsRUFBQyxJ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QUssQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDO1FBQzdDLEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUM7UUFFMUMsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0NBQ0Y7QUFwZ0JELHNDQW9nQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB0eXBlIHsgUmVxdWVzdCwgUmVzcG9uc2UsIFJvdXRlIH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIElDb250cm9sbGVyQ29uZmlnIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IEdldCwgUm91dGVNZXRob2RzIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnMvbWV0aG9kXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJVmFsaWRhdG9yLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSwgaXNJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb24vdXRpbHNcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBSZXF1ZXN0Q29udGV4dCB9IGZyb20gXCIuL3JlcXVlc3QtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb250ZXh0IH0gZnJvbSBcIi4vcmVzcG9uc2UtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb25maWcsIG1lcmdlUmVzcG9uc2VDb25maWcgfSBmcm9tIFwiLi9yZXNwb25zZS1jb25maWdcIjtcbmltcG9ydCB7IFZhbGlkYXRpb25GYWlsZWRFcnJvciwgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvciwgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSBcIi4uLy4uL2Vycm9ycy9cIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG5leHBvcnQgdHlwZSBDb250cm9sbGVyRXJyb3JIYW5kbGVyID0gUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlRXJyb3JIYW5kbGVyPjtcblxuLy8gTmV3IGludGVyZmFjZXMgZm9yIG1pZGRsZXdhcmUgYW5kIGVycm9yIGhhbmRsaW5nXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlIHtcbiAgYmVmb3JlPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgYWZ0ZXI/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBvbkVycm9yPzogKGVycm9yOiBFcnJvciwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xufVxuXG4vLyBHbG9iYWwgbWlkZGxld2FyZSBtYW5hZ2VtZW50XG5jb25zdCBnbG9iYWxNaWRkbGV3YXJlczogQVBJQ29udHJvbGxlck1pZGRsZXdhcmVbXSA9IFtdO1xuXG5leHBvcnQgY29uc3QgdXNlTWlkZGxld2FyZSA9IChtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5wdXNoKG1pZGRsZXdhcmUpO1xufVxuZXhwb3J0IGNvbnN0IGNsZWFyTWlkZGxld2FyZXMgPSAoKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmxlbmd0aCA9IDA7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBBUEkgaGFuZGxlciB3aXRob3V0IGRlZmluaW5nIGEgY2xhc3NcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBleHBvcnQgY29uc3QgeyBoYW5kbGVyLCBkZXNjcmlwdG9yIH0gPSBjcmVhdGVBcGlIYW5kbGVyKFxuICogIHsgbWV0aG9kOiBHZXQsIG5hbWU6ICdkZW1vJywgYXV0aG9yaXplcjogJ05PTkUnIH0sXG4gKiAgIGFzeW5jICggZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gKiAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAqICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gKiAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIkhlbGxvIFdvcmxkIVwifSlcbiAqICAgICAgIH0pXG4gKiAgIH1cbiAqIClcbiAqIGBgYFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmcgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLnBhdGggLSBUaGUgcGF0aCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubWV0aG9kIC0gVGhlIEhUVFAgbWV0aG9kIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcmV0dXJucyBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgaGFuZGxlciBmdW5jdGlvbiBhbmQgdGhlIGNvbnRyb2xsZXIgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUFwaUhhbmRsZXIoXG4gIG9wdGlvbnM6IHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgcGF0aD86IHN0cmluZyxcbiAgICBtZXRob2Q/OiBSb3V0ZU1ldGhvZHMsXG4gIH0gJiBJQ29udHJvbGxlckNvbmZpZyxcbiAgaGFuZGxlcjogKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpID0+IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0Pixcbikge1xuXG4gIGNvbnN0IHsgbmFtZSwgcGF0aCA9ICcnLCBtZXRob2QgPSBHZXQsIC4uLmNvbnRyb2xsZXJDb25maWcgfSA9IG9wdGlvbnM7XG5cbiAgQENvbnRyb2xsZXIobmFtZSwgeyAuLi5jb250cm9sbGVyQ29uZmlnLCBhdXRvRXhwb3J0TGFtYmRhSGFuZGxlcjogZmFsc2UgfSlcbiAgY2xhc3MgQ29udHJvbGxlckRlc2NyaXB0b3Ige1xuICAgIEBtZXRob2QocGF0aClcbiAgICBhc3luYyBpbmxpbmVIYW5kbGVyKCkge1xuICAgICAgLy8gcGxhY2Vob2xkZXIgZnVuY3Rpb24gb25seSB1c2VkIGZvciByb3V0aW5nIG1ldGFkYXRhXG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGhhbmRsZXIsICduYW1lJywgeyB2YWx1ZTogJ2hhbmRsZXInIH0pO1xuXG4gIHJldHVybiB7XG4gICAgaGFuZGxlcixcbiAgICBkZXNjcmlwdG9yOiBDb250cm9sbGVyRGVzY3JpcHRvclxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJDb25maWcge1xuICByZXNwb25zZUNvbmZpZz86IFBhcnRpYWw8UmVzcG9uc2VDb25maWc+O1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQVBJQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHByb3RlY3RlZCBtaWRkbGV3YXJlczogQVBJQ29udHJvbGxlck1pZGRsZXdhcmVbXSA9IFtdO1xuICBwcm90ZWN0ZWQgcmVzcG9uc2VDb25maWc6IFJlc3BvbnNlQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogQVBJQ29udHJvbGxlckNvbmZpZyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQ29uZmlnID0gbWVyZ2VSZXNwb25zZUNvbmZpZyhjb25maWcucmVzcG9uc2VDb25maWcpO1xuICB9XG5cbiAgLyoqXG4gICAqIGNhbiBiZSB1c2VkIHRvIHJ1biBzb21lIGxvZ2ljIGp1c3QgYmVmb3JlIHRoZSByZXF1ZXN0IGlzIHByb2Nlc3NlZCBsaWtlIGNyZWF0aW5nIGNsaWVudHMsIGRpLWluamVjdGlvbiBhbnMgc28gb24uXG4gICAqIEBwYXJhbSBfZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gX2NvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGNvbnRyb2xsZXIgaXMgaW5pdGlhbGl6ZWQuXG4gICovXG4gIHByb3RlY3RlZCBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vLW9wIGZvciBBUEkgY29udHJvbGxlcnNcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgfVxuXG4gIC8vIEFkZCBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBtZXRob2RcbiAgcHJvdGVjdGVkIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpIHtcbiAgICB0aGlzLm1pZGRsZXdhcmVzLnB1c2gobWlkZGxld2FyZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0TWlkZGxld2FyZXMoKSB7XG4gICAgcmV0dXJuIFsgLi4uZ2xvYmFsTWlkZGxld2FyZXMsIC4uLnRoaXMubWlkZGxld2FyZXMgXTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGUgbWlkZGxld2FyZSBwaXBlbGluZVxuICBwcml2YXRlIGFzeW5jIGV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoXG4gICAgcGhhc2U6ICdiZWZvcmUnIHwgJ2FmdGVyJyB8ICdvbkVycm9yJyxcbiAgICByZXF1ZXN0OiBSZXF1ZXN0LFxuICAgIHJlc3BvbnNlOiBSZXNwb25zZSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0LFxuICAgIGVycm9yPzogRXJyb3JcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG5cbiAgICBjb25zdCBhbGxNaWRkbGV3YXJlcyA9IHRoaXMuZ2V0TWlkZGxld2FyZXMoKTtcblxuICAgIGZvciAoY29uc3QgbWlkZGxld2FyZSBvZiBhbGxNaWRkbGV3YXJlcykge1xuICAgICAgaWYgKHBoYXNlID09PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZS5vbkVycm9yICYmIGVycm9yKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmUub25FcnJvcihlcnJvciwgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9IGVsc2UgaWYgKHBoYXNlICE9PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZVsgcGhhc2UgXSkge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlWyBwaGFzZSBdIShyZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgfVxuXG4gIGFzeW5jIHZhbGlkYXRlKHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0LCB2YWxpZGF0aW9uczogSW5wdXRWYWxpZGF0aW9uUnVsZSB8IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICBsZXQgdmFsaWRhdGlvblJ1bGVzOiBIdHRwUmVxdWVzdFZhbGlkYXRpb25zID0gdmFsaWRhdGlvbnM7XG4gICAgaWYgKGlzSW5wdXRWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9ucykpIHtcbiAgICAgIGlmIChbICdHRVQnLCAnREVMRVRFJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IHF1ZXJ5OiB2YWxpZGF0aW9ucyB9XG5cbiAgICAgIH0gZWxzZSBpZiAoWyAnUE9TVCcsICdQVVQnLCAnUEFUQ0gnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgYm9keTogdmFsaWRhdGlvbnMgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25SdWxlcykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yKHZhbGlkYXRpb25SdWxlcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdG9yLnZhbGlkYXRlSHR0cFJlcXVlc3Qoe1xuICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvblJ1bGVzLFxuICAgICAgY29sbGVjdEVycm9yczogdHJ1ZSxcbiAgICAgIHZlcmJvc2VFcnJvcnM6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCB0aGlzLmdldE92ZXJyaWRkZW5IdHRwUmVxdWVzdFZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKClcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXF1ZXN0Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxSZXF1ZXN0PiB7XG4gICAgcmV0dXJuIG5ldyBSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2VDb250ZXh0KHtcbiAgICAgIHRyYWNlSWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIHJlcXVlc3RJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgZGVidWdNb2RlOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICByb3V0ZTogcmVxdWVzdENvbnRleHQucGF0aCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICdkZXZlbG9wbWVudCcsXG4gICAgICBjb25maWc6IHRoaXMucmVzcG9uc2VDb25maWdcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYW1iZGEgaGFuZGxlciBmb3IgdGhlIGNvbnRyb2xsZXIuXG4gICAqIEhhbmRsZXMgaW5jb21pbmcgQVBJIEdhdGV3YXkgZXZlbnRzLlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIEFQSSBHYXRld2F5IHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhcIkxhbWJkYUhhbmRsZXIgUmVjZWl2ZWQgZXZlbnQ6XCIsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuXG4gICAgLy8gQnVpbGQgdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4ID0gdGhpcy5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuXG4gICAgdHJ5IHtcblxuICAgICAgLy8gTGVnYWN5IGluaXRpYWxpemUgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBFeGVjdXRlIGJlZm9yZSBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2JlZm9yZScsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICBjb25zdCByb3V0ZSA9IHRoaXMuZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCk7XG5cbiAgICAgIC8vIFZhbGlkYXRlIHRoZSByZXF1ZXN0IGlmIHZhbGlkYXRpb25zIGFyZSBkZWZpbmVkXG4gICAgICBpZiAocm91dGU/LnZhbGlkYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlKHJlcXVlc3QsIHJvdXRlLnZhbGlkYXRpb25zKTtcbiAgICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBjYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXMuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gICAgICBsZXQgY29udHJvbGxlclJlc3BvbnNlOiBhbnkgPSByb3V0ZUZ1bmN0aW9uLmNhbGwodGhpcywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICBjb250cm9sbGVyUmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyUmVzcG9uc2U7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdhZnRlcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAvLyBJZiB0aGUgY29udHJvbGxlciByZXR1cm5lZCBhbnl0aGluZyAoUmVzcG9uc2VDb250ZXh0IG9yIHJhdyBBUEkgcmVzdWx0KSwgZW1pdCB0aGF0XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoY29udHJvbGxlclJlc3BvbnNlKTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycikge1xuXG4gICAgICBjb25zdCBlcnJvck9iaiA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKTtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdMYW1iZGFIYW5kbGVyIGVycm9yOiAnLCBlcnJvck9iaik7XG5cbiAgICAgIC8vIEV4ZWN1dGUgZXJyb3IgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdvbkVycm9yJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3JPYmopO1xuXG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVFeGNlcHRpb24ocmVxdWVzdCwgZXJyb3JPYmosIHJlc3BvbnNlKTtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byB0aGUgaW4tbWVtb3J5IHJlc3BvbnNlQ29udGV4dFxuICAgIHJldHVybiByZXNwb25zZS5idWlsZCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSByb3V0ZSB0aGF0IG1hdGNoZXMgdGhlIEhUVFAgbWV0aG9kIGFuZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHJlcXVlc3REYXRhIC0gVGhlIHJlcXVlc3QgZGF0YSBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSBtYXRjaGluZyByb3V0ZSBvciBudWxsIGlmIG5vdCBmb3VuZC5cbiAgICovXG4gIHByaXZhdGUgZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdERhdGE6IFJlcXVlc3QpOiBSb3V0ZSB8IG51bGwge1xuICAgIGxldCBjb250cm9sbGVyOiBhbnkgPSB0aGlzO1xuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oXCJDYWxsZWQgZmluZE1hdGNoaW5nUm91dGUgd2l0aCByZXF1ZXN0RGF0YTogXCIsIHsgcmVxdWVzdERhdGEsIHJvdXRlczogY29udHJvbGxlci5yb3V0ZXMgfSk7XG5cbiAgICAvLyBEZXRlcm1pbmUgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGJ5IGZpbmRpbmcgdGhlIGxvbmdlc3QgY29tbW9uIHByZWZpeCB0aGF0IGVuZHMgd2l0aCB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgbGV0IGNvbnRyb2xsZXJCYXNlUGF0aCA9IGAvJHtjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lfWA7XG4gICAgbGV0IHJlc291cmNlV2l0aG91dFJvb3QgPSAnLyc7XG5cbiAgICAvLyBGb3IgY29udHJvbGxlcnMgaW4gc3ViZGlyZWN0b3JpZXMsIHdlIG5lZWQgdG8gbWF0Y2ggdGhlIGFjdHVhbCByZXNvdXJjZSBwYXRoXG4gICAgLy8gQ2hlY2sgaWYgcmVzb3VyY2UgY29udGFpbnMgdGhlIGNvbnRyb2xsZXIgbmFtZSBhcyBwYXJ0IG9mIGEgbG9uZ2VyIHBhdGhcbiAgICBjb25zdCByZXNvdXJjZVBhcnRzID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgY29udHJvbGxlck5hbWVQYXJ0cyA9IGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAvLyBGaW5kIGlmIHRoZSBjb250cm9sbGVyIG5hbWUgcGFydHMgYXJlIHByZXNlbnQgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICBsZXQgYmFzZVBhdGhFbmRJbmRleCA9IC0xO1xuICAgIGlmIChjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIExvb2sgZm9yIHRoZSBjb250cm9sbGVyIG5hbWUgc2VxdWVuY2UgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHJlc291cmNlUGFydHMubGVuZ3RoIC0gY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBsZXQgbWF0Y2hlcyA9IHRydWU7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIGlmIChyZXNvdXJjZVBhcnRzWyBpICsgaiBdICE9PSBjb250cm9sbGVyTmFtZVBhcnRzWyBqIF0pIHtcbiAgICAgICAgICAgIG1hdGNoZXMgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIGJhc2VQYXRoRW5kSW5kZXggPSBpICsgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggLSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGJhc2VQYXRoRW5kSW5kZXggPj0gMCkge1xuICAgICAgLy8gRm91bmQgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGluIHRoZSByZXNvdXJjZVxuICAgICAgY29uc3QgYmFzZVBhdGhQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoMCwgYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgY29udHJvbGxlckJhc2VQYXRoID0gJy8nICsgYmFzZVBhdGhQYXJ0cy5qb2luKCcvJyk7XG4gICAgICBjb25zdCByZW1haW5pbmdQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlbWFpbmluZ1BhcnRzLmxlbmd0aCA+IDAgPyAnLycgKyByZW1haW5pbmdQYXJ0cy5qb2luKCcvJykgOiAnLyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG9yaWdpbmFsIGxvZ2ljIGZvciBzaW1wbGUgY2FzZXNcbiAgICAgIGlmIChyZXF1ZXN0RGF0YS5yZXNvdXJjZS5zdGFydHNXaXRoKGNvbnRyb2xsZXJCYXNlUGF0aCkpIHtcbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3REYXRhLnJlc291cmNlLnN1YnN0cmluZyhjb250cm9sbGVyQmFzZVBhdGgubGVuZ3RoKSB8fCAnLyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbygnY29udHJvbGxlckJhc2VQYXRoOiAnLCBjb250cm9sbGVyQmFzZVBhdGgpO1xuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oJ3Jlc291cmNlV2l0aG91dFJvb3Q6ICcsIHJlc291cmNlV2l0aG91dFJvb3QpO1xuXG4gICAgLy8gU2VwYXJhdGUgcm91dGVzIGludG8gZXhhY3QgYW5kIHBhcmFtZXRlcml6ZWQgZm9yIHByb3BlciBwcmlvcml0aXphdGlvblxuICAgIGNvbnN0IGV4YWN0TWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcbiAgICBjb25zdCBwYXJhbWV0ZXJpemVkTWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcblxuICAgIC8vIEZpcnN0IHBhc3M6IGNhdGVnb3JpemUgcm91dGVzIGJ5IHR5cGUgYW5kIG1ldGhvZFxuICAgIGZvciAoY29uc3QgWyByb3V0ZUtleSwgcm91dGUgXSBvZiBPYmplY3QuZW50cmllcyhjb250cm9sbGVyLnJvdXRlcyB8fCB7fSkgYXMgWyBzdHJpbmcsIFJvdXRlIF1bXSkge1xuICAgICAgY29uc3QgWyByb3V0ZU1ldGhvZCwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICAvLyBTa2lwIGlmIEhUVFAgbWV0aG9kIGRvZXNuJ3QgbWF0Y2hcbiAgICAgIGlmIChyb3V0ZU1ldGhvZCAhPT0gcmVxdWVzdERhdGEuaHR0cE1ldGhvZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2F0ZWdvcml6ZSByb3V0ZSB0eXBlXG4gICAgICBpZiAocm91dGVQYXRoLmluY2x1ZGVzKCd7JykgJiYgcm91dGVQYXRoLmluY2x1ZGVzKCd9JykpIHtcbiAgICAgICAgcGFyYW1ldGVyaXplZE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4YWN0TWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlY29uZCBwYXNzOiBUcnkgZXhhY3QgbWF0Y2hlcyBmaXJzdCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlIH0gb2YgZXhhY3RNYXRjaGVzKSB7XG4gICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICBpZiAocm91dGVQYXRoID09PSByZXNvdXJjZVdpdGhvdXRSb290KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCBwYXJhbWV0ZXJpemVkIG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gLCB7XG4gICAgICAgICAgICBwYXR0ZXJuOiBwYXRoVG9SZWdleHBQYXR0ZXJuLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFJlc3VsdC5wYXJhbXMsXG4gICAgICAgICAgICBzcGVjaWZpY2l0eVNjb3JlOiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcy5maW5kKG0gPT4gbS5yb3V0ZUtleSA9PT0gcm91dGVLZXkpPy5zcGVjaWZpY2l0eVNjb3JlXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBOb3RlOiBXZSBkb24ndCBuZWVkIHRvIG1hbnVhbGx5IGV4dHJhY3QgcGFyYW1ldGVycyBzaW5jZSBBUEkgR2F0ZXdheVxuICAgICAgICAgIC8vIGFscmVhZHkgcHJvdmlkZXMgdGhlbSBpbiByZXF1ZXN0RGF0YS5wYXRoUGFyYW1ldGVyc1xuICAgICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRXJyb3IgbWF0Y2hpbmcgcm91dGUgcGF0dGVybiAke3BhdGhUb1JlZ2V4cFBhdHRlcm59OmAsIGVycm9yKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIud2FybihgTm8gbWF0Y2hpbmcgcm91dGUgZm91bmQgZm9yICR7cmVxdWVzdERhdGEuaHR0cE1ldGhvZH18JHtyZXNvdXJjZVdpdGhvdXRSb290fWApO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICogQHBhcmFtIHJvdXRlIC0gVGhlIG1hdGNoZWQgcm91dGUuXG4gICAqIEByZXR1cm5zIFRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlOiBSb3V0ZSB8IG51bGwpOiBGdW5jdGlvbiB7XG4gICAgaWYgKCFyb3V0ZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgICB9XG5cbiAgICAvL0B0cy1pZ25vcmVcbiAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpc1sgcm91dGUuZnVuY3Rpb25OYW1lIF07XG5cbiAgICByZXR1cm4gdHlwZW9mIHJvdXRlRnVuY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHJvdXRlRnVuY3Rpb24gOiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyB0aGUgTm90Rm91bmQgcm91dGUuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA0MDQgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlTm90Rm91bmQoX3JlcTogUmVxdWVzdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2Uoe1xuICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIk5vIFJvdXRlIEZvdW5kIVwiIH0pLFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGVycm9ySGFuZGxlcj86IENvbnRyb2xsZXJFcnJvckhhbmRsZXI7XG4gIHByb3RlY3RlZCBnZXRFcnJvckhhbmRsZXIoKTogQ29udHJvbGxlckVycm9ySGFuZGxlciB7XG4gICAgaWYgKCF0aGlzLmVycm9ySGFuZGxlcikge1xuICAgICAgdGhpcy5lcnJvckhhbmRsZXIgPSBjcmVhdGVFcnJvckhhbmRsZXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZXJyb3JIYW5kbGVyO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgZXhjZXB0aW9ucyBhbmQgcmV0dXJucyBhIEpTT04gcmVzcG9uc2Ugd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSBlcnIgLSBUaGUgZXJyb3Igb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA1MDAgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlRXhjZXB0aW9uKHJlcTogUmVxdWVzdCwgZXJyOiBFcnJvciwgcmVzOiBSZXNwb25zZSk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgY29uc3QgZXJyb3JSZXNwb25zZSA9IHRoaXMuZ2V0RXJyb3JIYW5kbGVyKCkoZXJyLCByZXEsIHJlcyk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoZXJyb3JSZXNwb25zZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlUmVzcG9uc2UocmVzOiBSZXNwb25zZSB8IEFQSUdhdGV3YXlQcm94eVJlc3VsdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgaWYgKHJlcyBpbnN0YW5jZW9mIFJlc3BvbnNlQ29udGV4dCkge1xuICAgICAgcmV0dXJuIHJlcy5idWlsZCgpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9XG5cbiAgcHJvdGVjdGVkIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGFjdG9yID0gdGhpcy5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcbiAgICBcbiAgICBjb25zdCBjdHg6IEV4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICBldmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBhY3RvcixcbiAgICAgIGRlYnVnSW5mbzoge30sXG4gICAgICBcbiAgICAgIC8vIFNpbXBsZSBhY3RvciBlbmhhbmNlbWVudCBtZXRob2RcbiAgICAgIGVuaGFuY2VBY3RvcjogKGVuaGFuY2VtZW50OiBQYXJ0aWFsPEFjdG9yPikgPT4ge1xuICAgICAgICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIGVuaGFuY2VtZW50KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gY3R4O1xuICB9XG5cblxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhY3RvciBjb250ZXh0IGZyb20gdGhlIHJlcXVlc3RcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgZm9yIGN1c3RvbSBhY3RvciBleHRyYWN0aW9uIGxvZ2ljXG4gICAqXG4gICAqIGRpZmZlcmVudCBtaWRkbGV3YXJlIGNhbiBlbmhhbmNlIHRoZSBhY3RvciBjb250ZXh0XG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlID0ge1xuICAgKiAgYmVmb3JlOiBhc3luYyAoX3JlcXVlc3QsIF9yZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgY3R4Py5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICByb2xlczogWydhZG1pbicsICd1c2VyJ10sXG4gICAqICAgICBwZXJtaXNzaW9uczogWydyZWFkJywgJ3dyaXRlJ10sXG4gICAqICAgICBzdWJzY3JpcHRpb246IHsgdGllcjogJ2VudGVycHJpc2UnIH1cbiAgICogICB9KTtcbiAgICogIH1cbiAgICogfVxuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmUpO1xuICAgKiBcbiAgICogT1JcbiAgICogXG4gICAqIGNvbnN0IHNlY3VyaXR5TWlkZGxld2FyZSA9IHtcbiAgICogICBiZWZvcmU6IGFzeW5jIChyZXF1ZXN0LCByZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgICBjdHguZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgICByaXNrUHJvZmlsZTogYXdhaXQgYXNzZXNzUmlzayhjdHguYWN0b3IuYWN0b3JJZCksXG4gICAqICAgICAgIGRldmljZTogYXdhaXQgbWFrZURldmljZUNvbnRleHQocmVxdWVzdClcbiAgICogICAgIH0pO1xuICAgKiAgIH1cbiAgICogfTtcbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShzZWN1cml0eU1pZGRsZXdhcmUpO1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gcmVxdWVzdCAtIFRoZSByZXF1ZXN0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIGFjdG9yIGNvbnRleHQuXG4gICAqIGBgYFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCk6IEFjdG9yIHtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVxdWVzdC5yZXF1ZXN0SWQ7XG4gICAgXG4gICAgY29uc3QgYWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkLFxuICAgICAgdGltZXN0YW1wLFxuICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnM/LlsndXNlci1hZ2VudCddIHx8IGV2ZW50LmhlYWRlcnM/LlsnVXNlci1BZ2VudCddLFxuICAgICAgY29ycmVsYXRpb25JZDogcmVxdWVzdC5oZWFkZXJzPy5bJ3gtY29ycmVsYXRpb24taWQnXSB8fCByZXF1ZXN0SWQsXG4gICAgfTtcblxuICAgIC8vIENvZ25pdG8gYXV0aGVudGljYXRpb25cbiAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcykge1xuICAgICAgY29uc3QgY2xhaW1zID0gZXZlbnQucmVxdWVzdENvbnRleHQuYXV0aG9yaXplci5jbGFpbXM7XG4gICAgICBcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zWydjb2duaXRvOnVzZXJuYW1lJ10gfHwgY2xhaW1zLnVzZXJuYW1lIHx8IGNsYWltcy5zdWI7XG4gICAgICBcbiAgICAgIC8vIEdlbmVyaWMgdXNlciBmaWVsZHNcbiAgICAgIGFjdG9yLmVtYWlsID0gY2xhaW1zLmVtYWlsO1xuICAgICAgYWN0b3IuZW1haWxWZXJpZmllZCA9IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gJ3RydWUnIHx8IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gdHJ1ZTtcbiAgICAgIGFjdG9yLnBob25lTnVtYmVyID0gY2xhaW1zLnBob25lX251bWJlcjtcbiAgICAgIGFjdG9yLnBob25lVmVyaWZpZWQgPSBjbGFpbXMucGhvbmVfbnVtYmVyX3ZlcmlmaWVkID09PSAndHJ1ZScgfHwgY2xhaW1zLnBob25lX251bWJlcl92ZXJpZmllZCA9PT0gdHJ1ZTtcbiAgICAgIGFjdG9yLmZpcnN0TmFtZSA9IGNsYWltcy5naXZlbl9uYW1lO1xuICAgICAgYWN0b3IubGFzdE5hbWUgPSBjbGFpbXMuZmFtaWx5X25hbWU7XG4gICAgICBhY3Rvci5uYW1lID0gY2xhaW1zLm5hbWU7XG4gICAgICBhY3Rvci5sb2NhbGUgPSBjbGFpbXMubG9jYWxlO1xuICAgICAgXG4gICAgICAvLyBDb2duaXRvLXNwZWNpZmljIG5lc3RlZCBkYXRhXG4gICAgICBjb25zdCBncm91cHMgPSBjbGFpbXNbJ2NvZ25pdG86Z3JvdXBzJ107XG4gICAgICBjb25zdCBwYXJzZWRHcm91cHMgPSB0eXBlb2YgZ3JvdXBzID09PSAnc3RyaW5nJyAmJiBncm91cHMubGVuZ3RoID4gMCBcbiAgICAgICAgPyBncm91cHMuc3BsaXQoJywnKS5tYXAoZyA9PiBnLnRyaW0oKSkuZmlsdGVyKGcgPT4gZy5sZW5ndGggPiAwKVxuICAgICAgICA6IFtdO1xuICAgICAgXG4gICAgICAvLyBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzXG4gICAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICBPYmplY3Qua2V5cyhjbGFpbXMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgaWYgKGtleS5zdGFydHNXaXRoKCdjdXN0b206JykpIHtcbiAgICAgICAgICBjdXN0b21BdHRyaWJ1dGVzW2tleS5yZXBsYWNlKCdjdXN0b206JywgJycpXSA9IGNsYWltc1trZXldO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgYWN0b3IuY29nbml0byA9IHtcbiAgICAgICAgc3ViOiBjbGFpbXMuc3ViLFxuICAgICAgICB1c2VybmFtZTogY2xhaW1zWydjb2duaXRvOnVzZXJuYW1lJ10sXG4gICAgICAgIGdyb3VwczogcGFyc2VkR3JvdXBzLFxuICAgICAgICBhdXRoVGltZTogY2xhaW1zLmF1dGhfdGltZSxcbiAgICAgICAgaWRlbnRpdGllczogY2xhaW1zLmlkZW50aXRpZXMsXG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IE9iamVjdC5rZXlzKGN1c3RvbUF0dHJpYnV0ZXMpLmxlbmd0aCA+IDAgPyBjdXN0b21BdHRyaWJ1dGVzIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgICAgXG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICB9XG4gICAgLy8gQVBJIEtleSBhdXRoZW50aWNhdGlvblxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5IHx8IHJlcXVlc3QuaGVhZGVycz8uWyd4LWFwaS1rZXknXSkge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhcGkta2V5JztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcbiAgICAgIFxuICAgICAgbGV0IGFwaUtleUlkOiBzdHJpbmc7XG4gICAgICBsZXQgc291cmNlOiAncmVxdWVzdC1jb250ZXh0JyB8ICdoZWFkZXInO1xuICAgICAgXG4gICAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkpIHtcbiAgICAgICAgYXBpS2V5SWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXlJZCB8fCBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXk7XG4gICAgICAgIHNvdXJjZSA9ICdyZXF1ZXN0LWNvbnRleHQnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXBpS2V5SWQgPSByZXF1ZXN0LmhlYWRlcnNbJ3gtYXBpLWtleSddITtcbiAgICAgICAgc291cmNlID0gJ2hlYWRlcic7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBgYXBpLWtleToke2FwaUtleUlkfWA7XG4gICAgICBhY3Rvci5hcGlLZXkgPSB7XG4gICAgICAgIGlkOiBhcGlLZXlJZCxcbiAgICAgICAgc291cmNlOiBzb3VyY2VcbiAgICAgIH07XG4gICAgfVxuICAgIC8vIElBTSBhdXRoZW50aWNhdGlvbiBcbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4pIHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnaWFtJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS51c2VyIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LnVzZXJBcm47XG4gICAgICBcbiAgICAgIGFjdG9yLmlhbSA9IHtcbiAgICAgICAgdXNlckFybjogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkudXNlckFybixcbiAgICAgICAgdXNlcklkOiBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS51c2VyIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgYWNjb3VudElkOiBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hY2NvdW50SWQgfHwgdW5kZWZpbmVkLFxuICAgICAgICBjYWxsZXI6IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmNhbGxlciB8fCB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgfVxuICAgIC8vIEFub255bW91c1xuICAgIGVsc2Uge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvcklkID0gJ2Fub255bW91cyc7XG4gICAgfVxuXG4gICAgLy8gU2Vzc2lvbiBhbmQgdGVuYW50IGZvciBhbmFseXRpY3NcbiAgICBhY3Rvci5zZXNzaW9uSWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsneC1zZXNzaW9uLWlkJ107XG4gICAgYWN0b3IudGVuYW50SWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsneC10ZW5hbnQtaWQnXSB8fCBcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcz8uWydjdXN0b206dGVuYW50SWQnXTtcbiAgICBcbiAgICAvLyBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAgYWN0b3IuYXBpU3RhZ2UgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uc3RhZ2U7XG4gICAgYWN0b3IuYXBpSWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXBpSWQ7XG4gICAgXG4gICAgcmV0dXJuIGFjdG9yO1xuICB9XG59XG4iXX0=