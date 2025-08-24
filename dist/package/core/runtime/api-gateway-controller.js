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
const validation_1 = require("../../validation");
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
    validator = validation_1.DefaultValidator;
    middlewares = [];
    responseConfig;
    constructor(config = {}) {
        super();
        this.responseConfig = (0, response_config_1.mergeResponseConfig)(config.responseConfig);
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
            debugInfo: {}
        };
        return ctx;
    }
    /**
     * Extracts actor context from the request
     * Override this method for custom actor extraction logic
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFzREEsNENBeUJDO0FBN0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFDNUQsaURBQTZHO0FBQzdHLGtEQUE0RjtBQUM1Rix1RUFBa0U7QUFDbEUsdURBQW1EO0FBQ25ELHlEQUFxRDtBQUNyRCx1REFBd0U7QUFDeEUsMENBQWlIO0FBWWpILCtCQUErQjtBQUMvQixNQUFNLGlCQUFpQixHQUE4QixFQUFFLENBQUM7QUFFakQsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FDOUIsT0FJcUIsRUFDckIsT0FBcUY7SUFHckYsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxZQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUd2RSxJQUFNLG9CQUFvQixHQUExQixNQUFNLG9CQUFvQjtRQUVsQixBQUFOLEtBQUssQ0FBQyxhQUFhO1lBQ2pCLHNEQUFzRDtRQUN4RCxDQUFDO0tBQ0YsQ0FBQTtJQUhPO1FBREwsTUFBTSxDQUFDLElBQUksQ0FBQzs2REFHWjtJQUpHLG9CQUFvQjtRQUR6QixJQUFBLHVCQUFVLEVBQUMsSUFBSSxFQUFFLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSx1QkFBdUIsRUFBRSxLQUFLLEVBQUUsQ0FBQztPQUNwRSxvQkFBb0IsQ0FLekI7SUFFRCxNQUFNLENBQUMsY0FBYyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUU3RCxPQUFPO1FBQ0wsT0FBTztRQUNQLFVBQVUsRUFBRSxvQkFBb0I7S0FDakMsQ0FBQztBQUNKLENBQUM7QUFNRCxNQUFzQixhQUFjLFNBQVEsK0NBQXFCO0lBQ3JELFNBQVMsR0FBZSw2QkFBZ0IsQ0FBQztJQUN6QyxXQUFXLEdBQThCLEVBQUUsQ0FBQztJQUM1QyxjQUFjLENBQWlCO0lBRXpDLFlBQVksU0FBOEIsRUFBRTtRQUMxQyxLQUFLLEVBQUUsQ0FBQztRQUNSLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBQSxxQ0FBbUIsRUFBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUlTLEtBQUssQ0FBQywrQ0FBK0M7UUFDN0QsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksR0FBRyxFQUFrQixDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVELHFDQUFxQztJQUMzQixhQUFhLENBQUMsVUFBbUM7UUFDekQsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7SUFDcEMsQ0FBQztJQUVTLGNBQWM7UUFDdEIsT0FBTyxDQUFFLEdBQUcsaUJBQWlCLEVBQUUsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFFLENBQUM7SUFDdkQsQ0FBQztJQUVELDhCQUE4QjtJQUN0QixLQUFLLENBQUMseUJBQXlCLENBQ3JDLEtBQXFDLEVBQ3JDLE9BQWdCLEVBQ2hCLFFBQWtCLEVBQ2xCLEdBQXNCLEVBQ3RCLEtBQWE7UUFHYixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFFN0MsS0FBSyxNQUFNLFVBQVUsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUN4QyxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksVUFBVSxDQUFDLE9BQU8sSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDdkQsTUFBTSxVQUFVLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQzFELENBQUM7aUJBQU0sSUFBSSxLQUFLLEtBQUssU0FBUyxJQUFJLFVBQVUsQ0FBRSxLQUFLLENBQUUsRUFBRSxDQUFDO2dCQUN0RCxNQUFNLFVBQVUsQ0FBRSxLQUFLLENBQUcsQ0FBQyxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQ3JELENBQUM7UUFDSCxDQUFDO0lBRUgsQ0FBQztJQUVELEtBQUssQ0FBQyxRQUFRLENBQUMsY0FBdUIsRUFBRSxXQUF5RCxFQUFFLElBQXVCO1FBRXhILElBQUksZUFBZSxHQUEyQixXQUFXLENBQUM7UUFDMUQsSUFBSSxJQUFBLDZCQUFxQixFQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFFLEtBQUssRUFBRSxRQUFRLENBQUUsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxFQUFFLENBQUM7Z0JBRTFFLGVBQWUsR0FBRyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsQ0FBQTtZQUUxQyxDQUFDO2lCQUFNLElBQUksQ0FBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBRSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLFdBQVcsRUFBRSxDQUFDLEVBQUUsQ0FBQztnQkFFeEYsZUFBZSxHQUFHLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxDQUFBO1lBQ3pDLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUEsbUNBQTJCLEVBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLElBQUksOENBQXFDLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDbkUsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQztZQUN4QyxjQUFjO1lBQ2QsV0FBVyxFQUFFLGVBQWU7WUFDNUIsYUFBYSxFQUFFLElBQUk7WUFDbkIsYUFBYSxFQUFFLGNBQWMsQ0FBQyxTQUFTO1lBQ3ZDLHVCQUF1QixFQUFFLE1BQU0sSUFBSSxDQUFDLCtDQUErQyxFQUFFO1NBQ3RGLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBc0IsRUFBRSxPQUFnQjtRQUMvRCxPQUFPLElBQUksZ0NBQWMsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUVELEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxjQUF1QjtRQUMvQyxPQUFPLElBQUksa0NBQWUsQ0FBQztZQUN6QixPQUFPLEVBQUUsY0FBYyxDQUFDLFNBQVM7WUFDakMsU0FBUyxFQUFFLGNBQWMsQ0FBQyxTQUFTO1lBQ25DLFNBQVMsRUFBRSxjQUFjLENBQUMsU0FBUztZQUNuQyxLQUFLLEVBQUUsY0FBYyxDQUFDLElBQUk7WUFDMUIsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLFdBQVcsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsSUFBSSxhQUFhO1lBQ2xELE1BQU0sRUFBRSxJQUFJLENBQUMsY0FBYztTQUM1QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxLQUFzQixFQUFFLE9BQWdCO1FBQzFELHFGQUFxRjtRQUVyRixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDOUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDLENBQUM7UUFFekQsOEJBQThCO1FBQzlCLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFN0QsSUFBSSxDQUFDO1lBRUgsc0RBQXNEO1lBQ3RELE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEMsNEJBQTRCO1lBQzVCLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLFFBQVEsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBRXZFLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUU5QyxrREFBa0Q7WUFDbEQsSUFBSSxLQUFLLEVBQUUsV0FBVyxFQUFFLENBQUM7Z0JBQ3ZCLE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUM7Z0JBQ3pFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQztvQkFDM0IsTUFBTSxJQUFJLDhCQUFxQixDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUMzRCxDQUFDO1lBQ0gsQ0FBQztZQUVELDBCQUEwQjtZQUMxQixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDbkQsSUFBSSxrQkFBa0IsR0FBUSxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQy9FLElBQUksa0JBQWtCLFlBQVksT0FBTyxFQUFFLENBQUM7Z0JBQzFDLGtCQUFrQixHQUFHLE1BQU0sa0JBQWtCLENBQUM7WUFDaEQsQ0FBQztZQUVELDJCQUEyQjtZQUMzQixNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUV0RSxxRkFBcUY7WUFDckYsSUFBSSxrQkFBa0IsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDL0IsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDakQsQ0FBQztRQUVILENBQUM7UUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1lBRWIsTUFBTSxRQUFRLEdBQUcsR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUNyRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxRQUFRLENBQUMsQ0FBQztZQUVyRCwyQkFBMkI7WUFDM0IsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1lBRWxGLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxPQUFPLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQzNELENBQUM7UUFFRCw0Q0FBNEM7UUFDNUMsT0FBTyxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDMUIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSyxpQkFBaUIsQ0FBQyxXQUFvQjtRQUM1QyxJQUFJLFVBQVUsR0FBUSxJQUFJLENBQUM7UUFDM0IsK0dBQStHO1FBRS9HLDZHQUE2RztRQUM3RyxJQUFJLGtCQUFrQixHQUFHLElBQUksVUFBVSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3pELElBQUksbUJBQW1CLEdBQUcsR0FBRyxDQUFDO1FBRTlCLCtFQUErRTtRQUMvRSwwRUFBMEU7UUFDMUUsTUFBTSxhQUFhLEdBQUcsV0FBVyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3RFLE1BQU0sbUJBQW1CLEdBQUcsVUFBVSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRWpGLHFFQUFxRTtRQUNyRSxJQUFJLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQzFCLElBQUksbUJBQW1CLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ25DLDZEQUE2RDtZQUM3RCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQkFDNUUsSUFBSSxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3BELElBQUksYUFBYSxDQUFFLENBQUMsR0FBRyxDQUFDLENBQUUsS0FBSyxtQkFBbUIsQ0FBRSxDQUFDLENBQUUsRUFBRSxDQUFDO3dCQUN4RCxPQUFPLEdBQUcsS0FBSyxDQUFDO3dCQUNoQixNQUFNO29CQUNSLENBQUM7Z0JBQ0gsQ0FBQztnQkFDRCxJQUFJLE9BQU8sRUFBRSxDQUFDO29CQUNaLGdCQUFnQixHQUFHLENBQUMsR0FBRyxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO29CQUN0RCxNQUFNO2dCQUNSLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksZ0JBQWdCLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDMUIsaURBQWlEO1lBQ2pELE1BQU0sYUFBYSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQ25FLGtCQUFrQixHQUFHLEdBQUcsR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ25ELE1BQU0sY0FBYyxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDakUsbUJBQW1CLEdBQUcsY0FBYyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7UUFDekYsQ0FBQzthQUFNLENBQUM7WUFDTiw4Q0FBOEM7WUFDOUMsSUFBSSxXQUFXLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUM7Z0JBQ3hELG1CQUFtQixHQUFHLFdBQVcsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxJQUFJLEdBQUcsQ0FBQztZQUN6RixDQUFDO1FBQ0gsQ0FBQztRQUVELGdFQUFnRTtRQUNoRSxrRUFBa0U7UUFFbEUseUVBQXlFO1FBQ3pFLE1BQU0sWUFBWSxHQUE4QyxFQUFFLENBQUM7UUFDbkUsTUFBTSxvQkFBb0IsR0FBOEMsRUFBRSxDQUFDO1FBRTNFLG1EQUFtRDtRQUNuRCxLQUFLLE1BQU0sQ0FBRSxRQUFRLEVBQUUsS0FBSyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBd0IsRUFBRSxDQUFDO1lBQ2pHLE1BQU0sQ0FBRSxXQUFXLEVBQUUsU0FBUyxDQUFFLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUV2RCxvQ0FBb0M7WUFDcEMsSUFBSSxXQUFXLEtBQUssV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUMzQyxTQUFTO1lBQ1gsQ0FBQztZQUVELHdCQUF3QjtZQUN4QixJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN2RCxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUNqRCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ3pDLENBQUM7UUFDSCxDQUFDO1FBRUQsMERBQTBEO1FBQzFELEtBQUssTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUMvQyxNQUFNLENBQUUsQUFBRCxFQUFHLFNBQVMsQ0FBRSxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFNUMsSUFBSSxTQUFTLEtBQUssbUJBQW1CLEVBQUUsQ0FBQztnQkFDdEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLFFBQVEsRUFBRSxDQUFDLENBQUM7Z0JBQzdELE9BQU8sS0FBSyxDQUFDO1lBQ2YsQ0FBQztRQUNILENBQUM7UUFFRCxnRUFBZ0U7UUFDaEUscUZBQXFGO1FBQ3JGLE1BQU0sMEJBQTBCLEdBQUcsb0JBQW9CO2FBQ3BELEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDM0IsTUFBTSxDQUFFLEFBQUQsRUFBRyxTQUFTLENBQUUsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzVDLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3RELE1BQU0sZUFBZSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUUzRSwwREFBMEQ7WUFDMUQsb0VBQW9FO1lBQ3BFLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxlQUFlLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7WUFFM0UsT0FBTyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLGdCQUFnQixFQUFFLENBQUM7UUFDMUQsQ0FBQyxDQUFDO2FBQ0QsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMscUJBQXFCO1FBRWpGLEtBQUssTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksMEJBQTBCLEVBQUUsQ0FBQztZQUN4RSw2REFBNkQ7WUFDN0QsTUFBTSxtQkFBbUIsR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUVyRSxJQUFJLENBQUM7Z0JBQ0gsbURBQW1EO2dCQUNuRCxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsT0FBTyxDQUFDLGdCQUFnQixDQUFDLENBQUM7Z0JBQzVDLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxtQkFBbUIsRUFBRSxFQUFFLE1BQU0sRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7Z0JBQzNFLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO2dCQUVqRCxJQUFJLFdBQVcsRUFBRSxDQUFDO29CQUNoQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyx3Q0FBd0MsUUFBUSxFQUFFLEVBQUU7d0JBQ25FLE9BQU8sRUFBRSxtQkFBbUI7d0JBQzVCLE1BQU0sRUFBRSxXQUFXLENBQUMsTUFBTTt3QkFDMUIsZ0JBQWdCLEVBQUUsMEJBQTBCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsS0FBSyxRQUFRLENBQUMsRUFBRSxnQkFBZ0I7cUJBQ2xHLENBQUMsQ0FBQztvQkFFSCx1RUFBdUU7b0JBQ3ZFLHNEQUFzRDtvQkFDdEQsT0FBTyxLQUFLLENBQUM7Z0JBQ2YsQ0FBQztZQUNILENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxtQkFBbUIsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUNoRixTQUFTO1lBQ1gsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsV0FBVyxDQUFDLFVBQVUsSUFBSSxtQkFBbUIsRUFBRSxDQUFDLENBQUM7UUFDakcsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNLLGdCQUFnQixDQUFDLEtBQW1CO1FBQzFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNYLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDeEMsQ0FBQztRQUVELFlBQVk7UUFDWixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUUsS0FBSyxDQUFDLFlBQVksQ0FBRSxDQUFDO1FBRWpELE9BQU8sT0FBTyxhQUFhLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzlGLENBQUM7SUFFRDs7OztPQUlHO0lBQ08sY0FBYyxDQUFDLElBQWE7UUFDcEMsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDO1lBQ3pCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxPQUFPLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQztTQUNyRCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRVMsWUFBWSxDQUEwQjtJQUN0QyxlQUFlO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFBLDJCQUFrQixHQUFFLENBQUM7UUFDM0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQztJQUMzQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDTyxlQUFlLENBQUMsR0FBWSxFQUFFLEdBQVUsRUFBRSxHQUFhO1FBQy9ELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQzVELE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRVMsY0FBYyxDQUFDLEdBQXFDO1FBQzVELElBQUksR0FBRyxZQUFZLGtDQUFlLEVBQUUsQ0FBQztZQUNuQyxPQUFPLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQixDQUFDO1FBQ0QsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRVMsUUFBUSxDQUFDLEtBQXNCLEVBQUUsT0FBZ0IsRUFBRSxPQUFnQixFQUFFLFFBQWtCO1FBQy9GLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFdkQsTUFBTSxHQUFHLEdBQUc7WUFDVixLQUFLO1lBQ0wsYUFBYSxFQUFFLE9BQU87WUFDdEIsT0FBTztZQUNQLFFBQVE7WUFDUixLQUFLO1lBQ0wsU0FBUyxFQUFFLEVBQUU7U0FDZCxDQUFDO1FBRUYsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRUQ7OztPQUdHO0lBQ08sbUJBQW1CLENBQUMsS0FBc0IsRUFBRSxPQUFnQjtRQUNwRSxNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQzNDLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxTQUFTLENBQUM7UUFFcEMsTUFBTSxLQUFLLEdBQVU7WUFDbkIsU0FBUztZQUNULFNBQVM7WUFDVCxRQUFRLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsUUFBUTtZQUNsRCxTQUFTLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxZQUFZLENBQUM7WUFDekUsYUFBYSxFQUFFLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLFNBQVM7U0FDbEUsQ0FBQztRQUVGLHlCQUF5QjtRQUN6QixJQUFJLEtBQUssQ0FBQyxjQUFjLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxDQUFDO1lBQzdDLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztZQUV0RCxLQUFLLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQztZQUM3QixLQUFLLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQztZQUN6QixLQUFLLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQztZQUU1RSxzQkFBc0I7WUFDdEIsS0FBSyxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDO1lBQzNCLEtBQUssQ0FBQyxhQUFhLEdBQUcsTUFBTSxDQUFDLGNBQWMsS0FBSyxNQUFNLElBQUksTUFBTSxDQUFDLGNBQWMsS0FBSyxJQUFJLENBQUM7WUFDekYsS0FBSyxDQUFDLFdBQVcsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO1lBQ3hDLEtBQUssQ0FBQyxhQUFhLEdBQUcsTUFBTSxDQUFDLHFCQUFxQixLQUFLLE1BQU0sSUFBSSxNQUFNLENBQUMscUJBQXFCLEtBQUssSUFBSSxDQUFDO1lBQ3ZHLEtBQUssQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQztZQUNwQyxLQUFLLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUM7WUFDcEMsS0FBSyxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDO1lBQ3pCLEtBQUssQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztZQUU3QiwrQkFBK0I7WUFDL0IsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFDeEMsTUFBTSxZQUFZLEdBQUcsT0FBTyxNQUFNLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQztnQkFDbEUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7Z0JBQ2hFLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFFUCw0QkFBNEI7WUFDNUIsTUFBTSxnQkFBZ0IsR0FBd0IsRUFBRSxDQUFDO1lBQ2pELE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO2dCQUNoQyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztvQkFDOUIsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQzdELENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQztZQUVILEtBQUssQ0FBQyxPQUFPLEdBQUc7Z0JBQ2QsR0FBRyxFQUFFLE1BQU0sQ0FBQyxHQUFHO2dCQUNmLFFBQVEsRUFBRSxNQUFNLENBQUMsa0JBQWtCLENBQUM7Z0JBQ3BDLE1BQU0sRUFBRSxZQUFZO2dCQUNwQixRQUFRLEVBQUUsTUFBTSxDQUFDLFNBQVM7Z0JBQzFCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtnQkFDN0IsZ0JBQWdCLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxTQUFTO2FBQzFGLENBQUM7WUFFRixLQUFLLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQztRQUNoQyxDQUFDO1FBQ0QseUJBQXlCO2FBQ3BCLElBQUksS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsTUFBTSxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1lBQ2xGLEtBQUssQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFDO1lBQzdCLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1lBRTVCLElBQUksUUFBZ0IsQ0FBQztZQUNyQixJQUFJLE1BQW9DLENBQUM7WUFFekMsSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQztnQkFDM0MsUUFBUSxHQUFHLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLFFBQVEsSUFBSSxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7Z0JBQzFGLE1BQU0sR0FBRyxpQkFBaUIsQ0FBQztZQUM3QixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sUUFBUSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFFLENBQUM7Z0JBQ3pDLE1BQU0sR0FBRyxRQUFRLENBQUM7WUFDcEIsQ0FBQztZQUVELEtBQUssQ0FBQyxPQUFPLEdBQUcsV0FBVyxRQUFRLEVBQUUsQ0FBQztZQUN0QyxLQUFLLENBQUMsTUFBTSxHQUFHO2dCQUNiLEVBQUUsRUFBRSxRQUFRO2dCQUNaLE1BQU0sRUFBRSxNQUFNO2FBQ2YsQ0FBQztRQUNKLENBQUM7UUFDRCxzQkFBc0I7YUFDakIsSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQztZQUNqRCxLQUFLLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQztZQUN6QixLQUFLLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztZQUM1QixLQUFLLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLElBQUksSUFBSSxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7WUFFNUYsS0FBSyxDQUFDLEdBQUcsR0FBRztnQkFDVixPQUFPLEVBQUUsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsT0FBTztnQkFDOUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLElBQUksSUFBSSxTQUFTO2dCQUN2RCxTQUFTLEVBQUUsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsU0FBUyxJQUFJLFNBQVM7Z0JBQy9ELE1BQU0sRUFBRSxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxNQUFNLElBQUksU0FBUzthQUMxRCxDQUFDO1FBQ0osQ0FBQztRQUNELFlBQVk7YUFDUCxDQUFDO1lBQ0osS0FBSyxDQUFDLFVBQVUsR0FBRyxXQUFXLENBQUM7WUFDL0IsS0FBSyxDQUFDLFNBQVMsR0FBRyxXQUFXLENBQUM7WUFDOUIsS0FBSyxDQUFDLE9BQU8sR0FBRyxXQUFXLENBQUM7UUFDOUIsQ0FBQztRQUVELG1DQUFtQztRQUNuQyxLQUFLLENBQUMsU0FBUyxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNwRCxLQUFLLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxhQUFhLENBQUM7WUFDakMsS0FBSyxDQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUU5RSxzQkFBc0I7UUFDdEIsS0FBSyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsY0FBYyxFQUFFLEtBQUssQ0FBQztRQUM3QyxLQUFLLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDO1FBRTFDLE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztDQUNGO0FBamRELHNDQWlkQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSwgUm91dGUgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgR2V0LCBSb3V0ZU1ldGhvZHMgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9tZXRob2RcIjtcbmltcG9ydCB7IERlZmF1bHRWYWxpZGF0b3IsIEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIElWYWxpZGF0b3IsIElucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlLCBpc0lucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvbi91dGlsc1wiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IFJlcXVlc3RDb250ZXh0IH0gZnJvbSBcIi4vcmVxdWVzdC1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbnRleHQgfSBmcm9tIFwiLi9yZXNwb25zZS1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbmZpZywgbWVyZ2VSZXNwb25zZUNvbmZpZyB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbmZpZ1wiO1xuaW1wb3J0IHsgVmFsaWRhdGlvbkZhaWxlZEVycm9yLCBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yLCBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vZXJyb3JzL1wiO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5cbmV4cG9ydCB0eXBlIENvbnRyb2xsZXJFcnJvckhhbmRsZXIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVFcnJvckhhbmRsZXI+O1xuXG4vLyBOZXcgaW50ZXJmYWNlcyBmb3IgbWlkZGxld2FyZSBhbmQgZXJyb3IgaGFuZGxpbmdcbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlck1pZGRsZXdhcmUge1xuICBiZWZvcmU/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBhZnRlcj86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIG9uRXJyb3I/OiAoZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG59XG5cbi8vIEdsb2JhbCBtaWRkbGV3YXJlIG1hbmFnZW1lbnRcbmNvbnN0IGdsb2JhbE1pZGRsZXdhcmVzOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdID0gW107XG5cbmV4cG9ydCBjb25zdCB1c2VNaWRkbGV3YXJlID0gKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLnB1c2gobWlkZGxld2FyZSk7XG59XG5leHBvcnQgY29uc3QgY2xlYXJNaWRkbGV3YXJlcyA9ICgpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMubGVuZ3RoID0gMDtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIEFQSSBoYW5kbGVyIHdpdGhvdXQgZGVmaW5pbmcgYSBjbGFzc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGV4cG9ydCBjb25zdCB7IGhhbmRsZXIsIGRlc2NyaXB0b3IgfSA9IGNyZWF0ZUFwaUhhbmRsZXIoXG4gKiAgeyBtZXRob2Q6IEdldCwgbmFtZTogJ2RlbW8nLCBhdXRob3JpemVyOiAnTk9ORScgfSxcbiAqICAgYXN5bmMgKCBldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAqICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICogICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAqICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiSGVsbG8gV29ybGQhXCJ9KVxuICogICAgICAgfSlcbiAqICAgfVxuICogKVxuICogYGBgXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5uYW1lIC0gVGhlIG5hbWUgb2YgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMucGF0aCAtIFRoZSBwYXRoIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5tZXRob2QgLSBUaGUgSFRUUCBtZXRob2QgZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBoYW5kbGVyIGZ1bmN0aW9uIGFuZCB0aGUgY29udHJvbGxlciBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXBpSGFuZGxlcihcbiAgb3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwYXRoPzogc3RyaW5nLFxuICAgIG1ldGhvZD86IFJvdXRlTWV0aG9kcyxcbiAgfSAmIElDb250cm9sbGVyQ29uZmlnLFxuICBoYW5kbGVyOiAoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCkgPT4gUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+LFxuKSB7XG5cbiAgY29uc3QgeyBuYW1lLCBwYXRoID0gJycsIG1ldGhvZCA9IEdldCwgLi4uY29udHJvbGxlckNvbmZpZyB9ID0gb3B0aW9ucztcblxuICBAQ29udHJvbGxlcihuYW1lLCB7IC4uLmNvbnRyb2xsZXJDb25maWcsIGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyOiBmYWxzZSB9KVxuICBjbGFzcyBDb250cm9sbGVyRGVzY3JpcHRvciB7XG4gICAgQG1ldGhvZChwYXRoKVxuICAgIGFzeW5jIGlubGluZUhhbmRsZXIoKSB7XG4gICAgICAvLyBwbGFjZWhvbGRlciBmdW5jdGlvbiBvbmx5IHVzZWQgZm9yIHJvdXRpbmcgbWV0YWRhdGFcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaGFuZGxlciwgJ25hbWUnLCB7IHZhbHVlOiAnaGFuZGxlcicgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBoYW5kbGVyLFxuICAgIGRlc2NyaXB0b3I6IENvbnRyb2xsZXJEZXNjcmlwdG9yXG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlckNvbmZpZyB7XG4gIHJlc3BvbnNlQ29uZmlnPzogUGFydGlhbDxSZXNwb25zZUNvbmZpZz47XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUElDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcHJvdGVjdGVkIHZhbGlkYXRvcjogSVZhbGlkYXRvciA9IERlZmF1bHRWYWxpZGF0b3I7XG4gIHByb3RlY3RlZCBtaWRkbGV3YXJlczogQVBJQ29udHJvbGxlck1pZGRsZXdhcmVbXSA9IFtdO1xuICBwcm90ZWN0ZWQgcmVzcG9uc2VDb25maWc6IFJlc3BvbnNlQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogQVBJQ29udHJvbGxlckNvbmZpZyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQ29uZmlnID0gbWVyZ2VSZXNwb25zZUNvbmZpZyhjb25maWcucmVzcG9uc2VDb25maWcpO1xuICB9XG5cbiAgYWJzdHJhY3QgaW5pdGlhbGl6ZShldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPjtcblxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgfVxuXG4gIC8vIEFkZCBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBtZXRob2RcbiAgcHJvdGVjdGVkIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpIHtcbiAgICB0aGlzLm1pZGRsZXdhcmVzLnB1c2gobWlkZGxld2FyZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0TWlkZGxld2FyZXMoKSB7XG4gICAgcmV0dXJuIFsgLi4uZ2xvYmFsTWlkZGxld2FyZXMsIC4uLnRoaXMubWlkZGxld2FyZXMgXTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGUgbWlkZGxld2FyZSBwaXBlbGluZVxuICBwcml2YXRlIGFzeW5jIGV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoXG4gICAgcGhhc2U6ICdiZWZvcmUnIHwgJ2FmdGVyJyB8ICdvbkVycm9yJyxcbiAgICByZXF1ZXN0OiBSZXF1ZXN0LFxuICAgIHJlc3BvbnNlOiBSZXNwb25zZSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0LFxuICAgIGVycm9yPzogRXJyb3JcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG5cbiAgICBjb25zdCBhbGxNaWRkbGV3YXJlcyA9IHRoaXMuZ2V0TWlkZGxld2FyZXMoKTtcblxuICAgIGZvciAoY29uc3QgbWlkZGxld2FyZSBvZiBhbGxNaWRkbGV3YXJlcykge1xuICAgICAgaWYgKHBoYXNlID09PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZS5vbkVycm9yICYmIGVycm9yKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmUub25FcnJvcihlcnJvciwgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9IGVsc2UgaWYgKHBoYXNlICE9PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZVsgcGhhc2UgXSkge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlWyBwaGFzZSBdIShyZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgfVxuXG4gIGFzeW5jIHZhbGlkYXRlKHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0LCB2YWxpZGF0aW9uczogSW5wdXRWYWxpZGF0aW9uUnVsZSB8IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICBsZXQgdmFsaWRhdGlvblJ1bGVzOiBIdHRwUmVxdWVzdFZhbGlkYXRpb25zID0gdmFsaWRhdGlvbnM7XG4gICAgaWYgKGlzSW5wdXRWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9ucykpIHtcbiAgICAgIGlmIChbICdHRVQnLCAnREVMRVRFJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IHF1ZXJ5OiB2YWxpZGF0aW9ucyB9XG5cbiAgICAgIH0gZWxzZSBpZiAoWyAnUE9TVCcsICdQVVQnLCAnUEFUQ0gnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgYm9keTogdmFsaWRhdGlvbnMgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25SdWxlcykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yKHZhbGlkYXRpb25SdWxlcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdG9yLnZhbGlkYXRlSHR0cFJlcXVlc3Qoe1xuICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvblJ1bGVzLFxuICAgICAgY29sbGVjdEVycm9yczogdHJ1ZSxcbiAgICAgIHZlcmJvc2VFcnJvcnM6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCB0aGlzLmdldE92ZXJyaWRkZW5IdHRwUmVxdWVzdFZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKClcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXF1ZXN0Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxSZXF1ZXN0PiB7XG4gICAgcmV0dXJuIG5ldyBSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2VDb250ZXh0KHtcbiAgICAgIHRyYWNlSWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIHJlcXVlc3RJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgZGVidWdNb2RlOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICByb3V0ZTogcmVxdWVzdENvbnRleHQucGF0aCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICdkZXZlbG9wbWVudCcsXG4gICAgICBjb25maWc6IHRoaXMucmVzcG9uc2VDb25maWdcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYW1iZGEgaGFuZGxlciBmb3IgdGhlIGNvbnRyb2xsZXIuXG4gICAqIEhhbmRsZXMgaW5jb21pbmcgQVBJIEdhdGV3YXkgZXZlbnRzLlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIEFQSSBHYXRld2F5IHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhcIkxhbWJkYUhhbmRsZXIgUmVjZWl2ZWQgZXZlbnQ6XCIsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuXG4gICAgLy8gQnVpbGQgdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4ID0gdGhpcy5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuXG4gICAgdHJ5IHtcblxuICAgICAgLy8gTGVnYWN5IGluaXRpYWxpemUgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBFeGVjdXRlIGJlZm9yZSBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2JlZm9yZScsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICBjb25zdCByb3V0ZSA9IHRoaXMuZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCk7XG5cbiAgICAgIC8vIFZhbGlkYXRlIHRoZSByZXF1ZXN0IGlmIHZhbGlkYXRpb25zIGFyZSBkZWZpbmVkXG4gICAgICBpZiAocm91dGU/LnZhbGlkYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlKHJlcXVlc3QsIHJvdXRlLnZhbGlkYXRpb25zKTtcbiAgICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBjYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXMuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gICAgICBsZXQgY29udHJvbGxlclJlc3BvbnNlOiBhbnkgPSByb3V0ZUZ1bmN0aW9uLmNhbGwodGhpcywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICBjb250cm9sbGVyUmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyUmVzcG9uc2U7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdhZnRlcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAvLyBJZiB0aGUgY29udHJvbGxlciByZXR1cm5lZCBhbnl0aGluZyAoUmVzcG9uc2VDb250ZXh0IG9yIHJhdyBBUEkgcmVzdWx0KSwgZW1pdCB0aGF0XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoY29udHJvbGxlclJlc3BvbnNlKTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycikge1xuXG4gICAgICBjb25zdCBlcnJvck9iaiA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKTtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdMYW1iZGFIYW5kbGVyIGVycm9yOiAnLCBlcnJvck9iaik7XG5cbiAgICAgIC8vIEV4ZWN1dGUgZXJyb3IgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdvbkVycm9yJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3JPYmopO1xuXG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVFeGNlcHRpb24ocmVxdWVzdCwgZXJyb3JPYmosIHJlc3BvbnNlKTtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byB0aGUgaW4tbWVtb3J5IHJlc3BvbnNlQ29udGV4dFxuICAgIHJldHVybiByZXNwb25zZS5idWlsZCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSByb3V0ZSB0aGF0IG1hdGNoZXMgdGhlIEhUVFAgbWV0aG9kIGFuZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHJlcXVlc3REYXRhIC0gVGhlIHJlcXVlc3QgZGF0YSBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSBtYXRjaGluZyByb3V0ZSBvciBudWxsIGlmIG5vdCBmb3VuZC5cbiAgICovXG4gIHByaXZhdGUgZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdERhdGE6IFJlcXVlc3QpOiBSb3V0ZSB8IG51bGwge1xuICAgIGxldCBjb250cm9sbGVyOiBhbnkgPSB0aGlzO1xuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oXCJDYWxsZWQgZmluZE1hdGNoaW5nUm91dGUgd2l0aCByZXF1ZXN0RGF0YTogXCIsIHsgcmVxdWVzdERhdGEsIHJvdXRlczogY29udHJvbGxlci5yb3V0ZXMgfSk7XG5cbiAgICAvLyBEZXRlcm1pbmUgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGJ5IGZpbmRpbmcgdGhlIGxvbmdlc3QgY29tbW9uIHByZWZpeCB0aGF0IGVuZHMgd2l0aCB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgbGV0IGNvbnRyb2xsZXJCYXNlUGF0aCA9IGAvJHtjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lfWA7XG4gICAgbGV0IHJlc291cmNlV2l0aG91dFJvb3QgPSAnLyc7XG5cbiAgICAvLyBGb3IgY29udHJvbGxlcnMgaW4gc3ViZGlyZWN0b3JpZXMsIHdlIG5lZWQgdG8gbWF0Y2ggdGhlIGFjdHVhbCByZXNvdXJjZSBwYXRoXG4gICAgLy8gQ2hlY2sgaWYgcmVzb3VyY2UgY29udGFpbnMgdGhlIGNvbnRyb2xsZXIgbmFtZSBhcyBwYXJ0IG9mIGEgbG9uZ2VyIHBhdGhcbiAgICBjb25zdCByZXNvdXJjZVBhcnRzID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgY29udHJvbGxlck5hbWVQYXJ0cyA9IGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAvLyBGaW5kIGlmIHRoZSBjb250cm9sbGVyIG5hbWUgcGFydHMgYXJlIHByZXNlbnQgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICBsZXQgYmFzZVBhdGhFbmRJbmRleCA9IC0xO1xuICAgIGlmIChjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIExvb2sgZm9yIHRoZSBjb250cm9sbGVyIG5hbWUgc2VxdWVuY2UgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHJlc291cmNlUGFydHMubGVuZ3RoIC0gY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBsZXQgbWF0Y2hlcyA9IHRydWU7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIGlmIChyZXNvdXJjZVBhcnRzWyBpICsgaiBdICE9PSBjb250cm9sbGVyTmFtZVBhcnRzWyBqIF0pIHtcbiAgICAgICAgICAgIG1hdGNoZXMgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIGJhc2VQYXRoRW5kSW5kZXggPSBpICsgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggLSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGJhc2VQYXRoRW5kSW5kZXggPj0gMCkge1xuICAgICAgLy8gRm91bmQgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGluIHRoZSByZXNvdXJjZVxuICAgICAgY29uc3QgYmFzZVBhdGhQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoMCwgYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgY29udHJvbGxlckJhc2VQYXRoID0gJy8nICsgYmFzZVBhdGhQYXJ0cy5qb2luKCcvJyk7XG4gICAgICBjb25zdCByZW1haW5pbmdQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlbWFpbmluZ1BhcnRzLmxlbmd0aCA+IDAgPyAnLycgKyByZW1haW5pbmdQYXJ0cy5qb2luKCcvJykgOiAnLyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG9yaWdpbmFsIGxvZ2ljIGZvciBzaW1wbGUgY2FzZXNcbiAgICAgIGlmIChyZXF1ZXN0RGF0YS5yZXNvdXJjZS5zdGFydHNXaXRoKGNvbnRyb2xsZXJCYXNlUGF0aCkpIHtcbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3REYXRhLnJlc291cmNlLnN1YnN0cmluZyhjb250cm9sbGVyQmFzZVBhdGgubGVuZ3RoKSB8fCAnLyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbygnY29udHJvbGxlckJhc2VQYXRoOiAnLCBjb250cm9sbGVyQmFzZVBhdGgpO1xuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oJ3Jlc291cmNlV2l0aG91dFJvb3Q6ICcsIHJlc291cmNlV2l0aG91dFJvb3QpO1xuXG4gICAgLy8gU2VwYXJhdGUgcm91dGVzIGludG8gZXhhY3QgYW5kIHBhcmFtZXRlcml6ZWQgZm9yIHByb3BlciBwcmlvcml0aXphdGlvblxuICAgIGNvbnN0IGV4YWN0TWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcbiAgICBjb25zdCBwYXJhbWV0ZXJpemVkTWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcblxuICAgIC8vIEZpcnN0IHBhc3M6IGNhdGVnb3JpemUgcm91dGVzIGJ5IHR5cGUgYW5kIG1ldGhvZFxuICAgIGZvciAoY29uc3QgWyByb3V0ZUtleSwgcm91dGUgXSBvZiBPYmplY3QuZW50cmllcyhjb250cm9sbGVyLnJvdXRlcyB8fCB7fSkgYXMgWyBzdHJpbmcsIFJvdXRlIF1bXSkge1xuICAgICAgY29uc3QgWyByb3V0ZU1ldGhvZCwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICAvLyBTa2lwIGlmIEhUVFAgbWV0aG9kIGRvZXNuJ3QgbWF0Y2hcbiAgICAgIGlmIChyb3V0ZU1ldGhvZCAhPT0gcmVxdWVzdERhdGEuaHR0cE1ldGhvZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2F0ZWdvcml6ZSByb3V0ZSB0eXBlXG4gICAgICBpZiAocm91dGVQYXRoLmluY2x1ZGVzKCd7JykgJiYgcm91dGVQYXRoLmluY2x1ZGVzKCd9JykpIHtcbiAgICAgICAgcGFyYW1ldGVyaXplZE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4YWN0TWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlY29uZCBwYXNzOiBUcnkgZXhhY3QgbWF0Y2hlcyBmaXJzdCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlIH0gb2YgZXhhY3RNYXRjaGVzKSB7XG4gICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICBpZiAocm91dGVQYXRoID09PSByZXNvdXJjZVdpdGhvdXRSb290KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCBwYXJhbWV0ZXJpemVkIG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gLCB7XG4gICAgICAgICAgICBwYXR0ZXJuOiBwYXRoVG9SZWdleHBQYXR0ZXJuLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFJlc3VsdC5wYXJhbXMsXG4gICAgICAgICAgICBzcGVjaWZpY2l0eVNjb3JlOiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcy5maW5kKG0gPT4gbS5yb3V0ZUtleSA9PT0gcm91dGVLZXkpPy5zcGVjaWZpY2l0eVNjb3JlXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBOb3RlOiBXZSBkb24ndCBuZWVkIHRvIG1hbnVhbGx5IGV4dHJhY3QgcGFyYW1ldGVycyBzaW5jZSBBUEkgR2F0ZXdheVxuICAgICAgICAgIC8vIGFscmVhZHkgcHJvdmlkZXMgdGhlbSBpbiByZXF1ZXN0RGF0YS5wYXRoUGFyYW1ldGVyc1xuICAgICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRXJyb3IgbWF0Y2hpbmcgcm91dGUgcGF0dGVybiAke3BhdGhUb1JlZ2V4cFBhdHRlcm59OmAsIGVycm9yKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIud2FybihgTm8gbWF0Y2hpbmcgcm91dGUgZm91bmQgZm9yICR7cmVxdWVzdERhdGEuaHR0cE1ldGhvZH18JHtyZXNvdXJjZVdpdGhvdXRSb290fWApO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICogQHBhcmFtIHJvdXRlIC0gVGhlIG1hdGNoZWQgcm91dGUuXG4gICAqIEByZXR1cm5zIFRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlOiBSb3V0ZSB8IG51bGwpOiBGdW5jdGlvbiB7XG4gICAgaWYgKCFyb3V0ZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgICB9XG5cbiAgICAvL0B0cy1pZ25vcmVcbiAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpc1sgcm91dGUuZnVuY3Rpb25OYW1lIF07XG5cbiAgICByZXR1cm4gdHlwZW9mIHJvdXRlRnVuY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHJvdXRlRnVuY3Rpb24gOiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyB0aGUgTm90Rm91bmQgcm91dGUuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA0MDQgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlTm90Rm91bmQoX3JlcTogUmVxdWVzdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2Uoe1xuICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIk5vIFJvdXRlIEZvdW5kIVwiIH0pLFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGVycm9ySGFuZGxlcj86IENvbnRyb2xsZXJFcnJvckhhbmRsZXI7XG4gIHByb3RlY3RlZCBnZXRFcnJvckhhbmRsZXIoKTogQ29udHJvbGxlckVycm9ySGFuZGxlciB7XG4gICAgaWYgKCF0aGlzLmVycm9ySGFuZGxlcikge1xuICAgICAgdGhpcy5lcnJvckhhbmRsZXIgPSBjcmVhdGVFcnJvckhhbmRsZXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZXJyb3JIYW5kbGVyO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgZXhjZXB0aW9ucyBhbmQgcmV0dXJucyBhIEpTT04gcmVzcG9uc2Ugd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSBlcnIgLSBUaGUgZXJyb3Igb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA1MDAgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlRXhjZXB0aW9uKHJlcTogUmVxdWVzdCwgZXJyOiBFcnJvciwgcmVzOiBSZXNwb25zZSk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgY29uc3QgZXJyb3JSZXNwb25zZSA9IHRoaXMuZ2V0RXJyb3JIYW5kbGVyKCkoZXJyLCByZXEsIHJlcyk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoZXJyb3JSZXNwb25zZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlUmVzcG9uc2UocmVzOiBSZXNwb25zZSB8IEFQSUdhdGV3YXlQcm94eVJlc3VsdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgaWYgKHJlcyBpbnN0YW5jZW9mIFJlc3BvbnNlQ29udGV4dCkge1xuICAgICAgcmV0dXJuIHJlcy5idWlsZCgpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9XG5cbiAgcHJvdGVjdGVkIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGFjdG9yID0gdGhpcy5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcbiAgICBcbiAgICBjb25zdCBjdHggPSB7XG4gICAgICBldmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBhY3RvcixcbiAgICAgIGRlYnVnSW5mbzoge31cbiAgICB9O1xuXG4gICAgcmV0dXJuIGN0eDtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhY3RvciBjb250ZXh0IGZyb20gdGhlIHJlcXVlc3RcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgZm9yIGN1c3RvbSBhY3RvciBleHRyYWN0aW9uIGxvZ2ljXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcbiAgICBcbiAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICByZXF1ZXN0SWQsXG4gICAgICB0aW1lc3RhbXAsXG4gICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVycz8uWyd1c2VyLWFnZW50J10gfHwgZXZlbnQuaGVhZGVycz8uWydVc2VyLUFnZW50J10sXG4gICAgICBjb3JyZWxhdGlvbklkOiByZXF1ZXN0LmhlYWRlcnM/LlsneC1jb3JyZWxhdGlvbi1pZCddIHx8IHJlcXVlc3RJZCxcbiAgICB9O1xuXG4gICAgLy8gQ29nbml0byBhdXRoZW50aWNhdGlvblxuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zKSB7XG4gICAgICBjb25zdCBjbGFpbXMgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5hdXRob3JpemVyLmNsYWltcztcbiAgICAgIFxuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXNbJ2NvZ25pdG86dXNlcm5hbWUnXSB8fCBjbGFpbXMudXNlcm5hbWUgfHwgY2xhaW1zLnN1YjtcbiAgICAgIFxuICAgICAgLy8gR2VuZXJpYyB1c2VyIGZpZWxkc1xuICAgICAgYWN0b3IuZW1haWwgPSBjbGFpbXMuZW1haWw7XG4gICAgICBhY3Rvci5lbWFpbFZlcmlmaWVkID0gY2xhaW1zLmVtYWlsX3ZlcmlmaWVkID09PSAndHJ1ZScgfHwgY2xhaW1zLmVtYWlsX3ZlcmlmaWVkID09PSB0cnVlO1xuICAgICAgYWN0b3IucGhvbmVOdW1iZXIgPSBjbGFpbXMucGhvbmVfbnVtYmVyO1xuICAgICAgYWN0b3IucGhvbmVWZXJpZmllZCA9IGNsYWltcy5waG9uZV9udW1iZXJfdmVyaWZpZWQgPT09ICd0cnVlJyB8fCBjbGFpbXMucGhvbmVfbnVtYmVyX3ZlcmlmaWVkID09PSB0cnVlO1xuICAgICAgYWN0b3IuZmlyc3ROYW1lID0gY2xhaW1zLmdpdmVuX25hbWU7XG4gICAgICBhY3Rvci5sYXN0TmFtZSA9IGNsYWltcy5mYW1pbHlfbmFtZTtcbiAgICAgIGFjdG9yLm5hbWUgPSBjbGFpbXMubmFtZTtcbiAgICAgIGFjdG9yLmxvY2FsZSA9IGNsYWltcy5sb2NhbGU7XG4gICAgICBcbiAgICAgIC8vIENvZ25pdG8tc3BlY2lmaWMgbmVzdGVkIGRhdGFcbiAgICAgIGNvbnN0IGdyb3VwcyA9IGNsYWltc1snY29nbml0bzpncm91cHMnXTtcbiAgICAgIGNvbnN0IHBhcnNlZEdyb3VwcyA9IHR5cGVvZiBncm91cHMgPT09ICdzdHJpbmcnICYmIGdyb3Vwcy5sZW5ndGggPiAwIFxuICAgICAgICA/IGdyb3Vwcy5zcGxpdCgnLCcpLm1hcChnID0+IGcudHJpbSgpKS5maWx0ZXIoZyA9PiBnLmxlbmd0aCA+IDApXG4gICAgICAgIDogW107XG4gICAgICBcbiAgICAgIC8vIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXNcbiAgICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgIE9iamVjdC5rZXlzKGNsYWltcykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoJ2N1c3RvbTonKSkge1xuICAgICAgICAgIGN1c3RvbUF0dHJpYnV0ZXNba2V5LnJlcGxhY2UoJ2N1c3RvbTonLCAnJyldID0gY2xhaW1zW2tleV07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBhY3Rvci5jb2duaXRvID0ge1xuICAgICAgICBzdWI6IGNsYWltcy5zdWIsXG4gICAgICAgIHVzZXJuYW1lOiBjbGFpbXNbJ2NvZ25pdG86dXNlcm5hbWUnXSxcbiAgICAgICAgZ3JvdXBzOiBwYXJzZWRHcm91cHMsXG4gICAgICAgIGF1dGhUaW1lOiBjbGFpbXMuYXV0aF90aW1lLFxuICAgICAgICBpZGVudGl0aWVzOiBjbGFpbXMuaWRlbnRpdGllcyxcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlczogT2JqZWN0LmtleXMoY3VzdG9tQXR0cmlidXRlcykubGVuZ3RoID4gMCA/IGN1c3RvbUF0dHJpYnV0ZXMgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgICBcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgIH1cbiAgICAvLyBBUEkgS2V5IGF1dGhlbnRpY2F0aW9uXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkgfHwgcmVxdWVzdC5oZWFkZXJzPy5bJ3gtYXBpLWtleSddKSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2FwaS1rZXknO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgICAgXG4gICAgICBsZXQgYXBpS2V5SWQ6IHN0cmluZztcbiAgICAgIGxldCBzb3VyY2U6ICdyZXF1ZXN0LWNvbnRleHQnIHwgJ2hlYWRlcic7XG4gICAgICBcbiAgICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSkge1xuICAgICAgICBhcGlLZXlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleUlkIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleTtcbiAgICAgICAgc291cmNlID0gJ3JlcXVlc3QtY29udGV4dCc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhcGlLZXlJZCA9IHJlcXVlc3QuaGVhZGVyc1sneC1hcGkta2V5J10hO1xuICAgICAgICBzb3VyY2UgPSAnaGVhZGVyJztcbiAgICAgIH1cbiAgICAgIFxuICAgICAgYWN0b3IuYWN0b3JJZCA9IGBhcGkta2V5OiR7YXBpS2V5SWR9YDtcbiAgICAgIGFjdG9yLmFwaUtleSA9IHtcbiAgICAgICAgaWQ6IGFwaUtleUlkLFxuICAgICAgICBzb3VyY2U6IHNvdXJjZVxuICAgICAgfTtcbiAgICB9XG4gICAgLy8gSUFNIGF1dGhlbnRpY2F0aW9uIFxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybikge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdpYW0nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LnVzZXIgfHwgZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkudXNlckFybjtcbiAgICAgIFxuICAgICAgYWN0b3IuaWFtID0ge1xuICAgICAgICB1c2VyQXJuOiBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS51c2VyQXJuLFxuICAgICAgICB1c2VySWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LnVzZXIgfHwgdW5kZWZpbmVkLFxuICAgICAgICBhY2NvdW50SWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFjY291bnRJZCB8fCB1bmRlZmluZWQsXG4gICAgICAgIGNhbGxlcjogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuY2FsbGVyIHx8IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICB9XG4gICAgLy8gQW5vbnltb3VzXG4gICAgZWxzZSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSAnYW5vbnltb3VzJztcbiAgICB9XG5cbiAgICAvLyBTZXNzaW9uIGFuZCB0ZW5hbnQgZm9yIGFuYWx5dGljc1xuICAgIGFjdG9yLnNlc3Npb25JZCA9IHJlcXVlc3QuaGVhZGVycz8uWyd4LXNlc3Npb24taWQnXTtcbiAgICBhY3Rvci50ZW5hbnRJZCA9IHJlcXVlc3QuaGVhZGVycz8uWyd4LXRlbmFudC1pZCddIHx8IFxuICAgICAgICAgICAgICAgICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zPy5bJ2N1c3RvbTp0ZW5hbnRJZCddO1xuICAgIFxuICAgIC8vIEFQSSBHYXRld2F5IGNvbnRleHRcbiAgICBhY3Rvci5hcGlTdGFnZSA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5zdGFnZTtcbiAgICBhY3Rvci5hcGlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hcGlJZDtcbiAgICBcbiAgICByZXR1cm4gYWN0b3I7XG4gIH1cbn1cbiJdfQ==