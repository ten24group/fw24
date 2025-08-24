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
        // Base actor context
        const actor = {
            requestId,
            timestamp,
            sourceIp: event.requestContext?.identity?.sourceIp,
            userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'],
        };
        // Extract from Cognito
        if (event.requestContext?.authorizer?.claims) {
            const claims = event.requestContext.authorizer.claims;
            actor.authMethod = 'cognito';
            actor.actorType = 'user';
            actor.cognitoSub = claims.sub;
            actor.cognitoUsername = claims['cognito:username'] || claims.username;
            actor.actorId = claims['cognito:username'] || claims.username || claims.sub;
            actor.cognitoGroups = claims['cognito:groups']?.split(',') || [];
            actor.rawAuthContext = claims;
        }
        // Extract from API Key
        else if (event.requestContext?.identity?.apiKey) {
            actor.authMethod = 'api-key';
            actor.actorType = 'service';
            actor.apiKeyId = event.requestContext.identity.apiKey;
            actor.actorId = `api-key:${actor.apiKeyId}`;
        }
        // Extract from IAM
        else if (event.requestContext?.identity?.userArn) {
            actor.authMethod = 'iam';
            actor.actorType = 'service';
            actor.iamRole = event.requestContext.identity.userArn;
            actor.iamUserId = event.requestContext.identity.user || undefined;
            actor.actorId = actor.iamUserId || actor.iamRole;
        }
        // System/anonymous
        else {
            actor.authMethod = 'system';
            actor.actorType = 'anonymous';
            actor.actorId = 'system';
        }
        // Extract tenant from custom headers or JWT
        actor.tenantId = request.headers?.['x-tenant-id'] ||
            event.requestContext?.authorizer?.claims?.['custom:tenantId'];
        // Generate correlation ID if not present
        actor.correlationId = request.headers?.['x-correlation-id'] || requestId;
        return actor;
    }
}
exports.APIController = APIController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFzREEsNENBeUJDO0FBN0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFDNUQsaURBQTZHO0FBQzdHLGtEQUE0RjtBQUM1Rix1RUFBa0U7QUFDbEUsdURBQW1EO0FBQ25ELHlEQUFxRDtBQUNyRCx1REFBd0U7QUFDeEUsMENBQWlIO0FBWWpILCtCQUErQjtBQUMvQixNQUFNLGlCQUFpQixHQUE4QixFQUFFLENBQUM7QUFFakQsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FDOUIsT0FJcUIsRUFDckIsT0FBcUY7SUFHckYsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxZQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUd2RSxJQUFNLG9CQUFvQixHQUExQixNQUFNLG9CQUFvQjtRQUVsQixBQUFOLEtBQUssQ0FBQyxhQUFhO1lBQ2pCLHNEQUFzRDtRQUN4RCxDQUFDO0tBQ0YsQ0FBQTtJQUhPO1FBREwsTUFBTSxDQUFDLElBQUksQ0FBQzs2REFHWjtJQUpHLG9CQUFvQjtRQUR6QixJQUFB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ekIsS0FBSyxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7WUFDNUIsS0FBSyxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7WUFDdEQsS0FBSyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxJQUFJLElBQUksU0FBUyxDQUFDO1lBQ2xFLEtBQUssQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLFNBQVMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDO1FBQ25ELENBQUM7UUFDRCxtQkFBbUI7YUFDZCxDQUFDO1lBQ0osS0FBSyxDQUFDLFVBQVUsR0FBRyxRQUFRLENBQUM7WUFDNUIsS0FBSyxDQUFDLFNBQVMsR0FBRyxXQUFXLENBQUM7WUFDOUIsS0FBSyxDQUFDLE9BQU8sR0FBRyxRQUFRLENBQUM7UUFDM0IsQ0FBQztRQUVELDRDQUE0QztRQUM1QyxLQUFLLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxhQUFhLENBQUM7WUFDakMsS0FBSyxDQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUU5RSx5Q0FBeUM7UUFDekMsS0FBSyxDQUFDLGFBQWEsR0FBRyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUMsa0JBQWtCLENBQUMsSUFBSSxTQUFTLENBQUM7UUFJekUsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0NBQ0Y7QUFqYUQsc0NBaWFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBBUElHYXRld2F5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgdHlwZSB7IFJlcXVlc3QsIFJlc3BvbnNlLCBSb3V0ZSB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBJQ29udHJvbGxlckNvbmZpZyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzXCI7XG5pbXBvcnQgeyBHZXQsIFJvdXRlTWV0aG9kcyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzL21ldGhvZFwiO1xuaW1wb3J0IHsgRGVmYXVsdFZhbGlkYXRvciwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgSVZhbGlkYXRvciwgSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgeyBpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUsIGlzSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uL3V0aWxzXCI7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHsgUmVxdWVzdENvbnRleHQgfSBmcm9tIFwiLi9yZXF1ZXN0LWNvbnRleHRcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29udGV4dCB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbnRleHRcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29uZmlnLCBtZXJnZVJlc3BvbnNlQ29uZmlnIH0gZnJvbSBcIi4vcmVzcG9uc2UtY29uZmlnXCI7XG5pbXBvcnQgeyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IsIEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IsIGNyZWF0ZUVycm9ySGFuZGxlciB9IGZyb20gXCIuLi8uLi9lcnJvcnMvXCI7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gJy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuZXhwb3J0IHR5cGUgQ29udHJvbGxlckVycm9ySGFuZGxlciA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZUVycm9ySGFuZGxlcj47XG5cbi8vIE5ldyBpbnRlcmZhY2VzIGZvciBtaWRkbGV3YXJlIGFuZCBlcnJvciBoYW5kbGluZ1xuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyTWlkZGxld2FyZSB7XG4gIGJlZm9yZT86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIGFmdGVyPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgb25FcnJvcj86IChlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuLy8gR2xvYmFsIG1pZGRsZXdhcmUgbWFuYWdlbWVudFxuY29uc3QgZ2xvYmFsTWlkZGxld2FyZXM6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlW10gPSBbXTtcblxuZXhwb3J0IGNvbnN0IHVzZU1pZGRsZXdhcmUgPSAobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMucHVzaChtaWRkbGV3YXJlKTtcbn1cbmV4cG9ydCBjb25zdCBjbGVhck1pZGRsZXdhcmVzID0gKCkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5sZW5ndGggPSAwO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gQVBJIGhhbmRsZXIgd2l0aG91dCBkZWZpbmluZyBhIGNsYXNzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogZXhwb3J0IGNvbnN0IHsgaGFuZGxlciwgZGVzY3JpcHRvciB9ID0gY3JlYXRlQXBpSGFuZGxlcihcbiAqICB7IG1ldGhvZDogR2V0LCBuYW1lOiAnZGVtbycsIGF1dGhvcml6ZXI6ICdOT05FJyB9LFxuICogICBhc3luYyAoIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICogICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gKiAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICogICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJIZWxsbyBXb3JsZCFcIn0pXG4gKiAgICAgICB9KVxuICogICB9XG4gKiApXG4gKiBgYGBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5wYXRoIC0gVGhlIHBhdGggZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgZnVuY3Rpb24gYW5kIHRoZSBjb250cm9sbGVyIGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBcGlIYW5kbGVyKFxuICBvcHRpb25zOiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHBhdGg/OiBzdHJpbmcsXG4gICAgbWV0aG9kPzogUm91dGVNZXRob2RzLFxuICB9ICYgSUNvbnRyb2xsZXJDb25maWcsXG4gIGhhbmRsZXI6IChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4sXG4pIHtcblxuICBjb25zdCB7IG5hbWUsIHBhdGggPSAnJywgbWV0aG9kID0gR2V0LCAuLi5jb250cm9sbGVyQ29uZmlnIH0gPSBvcHRpb25zO1xuXG4gIEBDb250cm9sbGVyKG5hbWUsIHsgLi4uY29udHJvbGxlckNvbmZpZywgYXV0b0V4cG9ydExhbWJkYUhhbmRsZXI6IGZhbHNlIH0pXG4gIGNsYXNzIENvbnRyb2xsZXJEZXNjcmlwdG9yIHtcbiAgICBAbWV0aG9kKHBhdGgpXG4gICAgYXN5bmMgaW5saW5lSGFuZGxlcigpIHtcbiAgICAgIC8vIHBsYWNlaG9sZGVyIGZ1bmN0aW9uIG9ubHkgdXNlZCBmb3Igcm91dGluZyBtZXRhZGF0YVxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShoYW5kbGVyLCAnbmFtZScsIHsgdmFsdWU6ICdoYW5kbGVyJyB9KTtcblxuICByZXR1cm4ge1xuICAgIGhhbmRsZXIsXG4gICAgZGVzY3JpcHRvcjogQ29udHJvbGxlckRlc2NyaXB0b3JcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyQ29uZmlnIHtcbiAgcmVzcG9uc2VDb25maWc/OiBQYXJ0aWFsPFJlc3BvbnNlQ29uZmlnPjtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFQSUNvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuICBwcm90ZWN0ZWQgdmFsaWRhdG9yOiBJVmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcjtcbiAgcHJvdGVjdGVkIG1pZGRsZXdhcmVzOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdID0gW107XG4gIHByb3RlY3RlZCByZXNwb25zZUNvbmZpZzogUmVzcG9uc2VDb25maWc7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBBUElDb250cm9sbGVyQ29uZmlnID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzcG9uc2VDb25maWcgPSBtZXJnZVJlc3BvbnNlQ29uZmlnKGNvbmZpZy5yZXNwb25zZUNvbmZpZyk7XG4gIH1cblxuICBhYnN0cmFjdCBpbml0aWFsaXplKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+O1xuXG4gIHByb3RlY3RlZCBhc3luYyBnZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICB9XG5cbiAgLy8gQWRkIG1pZGRsZXdhcmUgcmVnaXN0cmF0aW9uIG1ldGhvZFxuICBwcm90ZWN0ZWQgdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkge1xuICAgIHRoaXMubWlkZGxld2FyZXMucHVzaChtaWRkbGV3YXJlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpIHtcbiAgICByZXR1cm4gWyAuLi5nbG9iYWxNaWRkbGV3YXJlcywgLi4udGhpcy5taWRkbGV3YXJlcyBdO1xuICB9XG5cbiAgLy8gRXhlY3V0ZSBtaWRkbGV3YXJlIHBpcGVsaW5lXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShcbiAgICBwaGFzZTogJ2JlZm9yZScgfCAnYWZ0ZXInIHwgJ29uRXJyb3InLFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsXG4gICAgZXJyb3I/OiBFcnJvclxuICApOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGFsbE1pZGRsZXdhcmVzID0gdGhpcy5nZXRNaWRkbGV3YXJlcygpO1xuXG4gICAgZm9yIChjb25zdCBtaWRkbGV3YXJlIG9mIGFsbE1pZGRsZXdhcmVzKSB7XG4gICAgICBpZiAocGhhc2UgPT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlLm9uRXJyb3IgJiYgZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZS5vbkVycm9yKGVycm9yLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH0gZWxzZSBpZiAocGhhc2UgIT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlWyBwaGFzZSBdKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmVbIHBoYXNlIF0hKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfVxuICAgIH1cblxuICB9XG5cbiAgYXN5bmMgdmFsaWRhdGUocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QsIHZhbGlkYXRpb25zOiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgIGxldCB2YWxpZGF0aW9uUnVsZXM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB2YWxpZGF0aW9ucztcbiAgICBpZiAoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zKSkge1xuICAgICAgaWYgKFsgJ0dFVCcsICdERUxFVEUnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgcXVlcnk6IHZhbGlkYXRpb25zIH1cblxuICAgICAgfSBlbHNlIGlmIChbICdQT1NUJywgJ1BVVCcsICdQQVRDSCcgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBib2R5OiB2YWxpZGF0aW9ucyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvblJ1bGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IodmFsaWRhdGlvblJ1bGVzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7XG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHZhbGlkYXRpb25zOiB2YWxpZGF0aW9uUnVsZXMsXG4gICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLFxuICAgICAgdmVyYm9zZUVycm9yczogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IHRoaXMuZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPFJlcXVlc3Q+IHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZUNvbnRleHQoe1xuICAgICAgdHJhY2VJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgcmVxdWVzdElkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICBkZWJ1Z01vZGU6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIHJvdXRlOiByZXF1ZXN0Q29udGV4dC5wYXRoLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50JyxcbiAgICAgIGNvbmZpZzogdGhpcy5yZXNwb25zZUNvbmZpZ1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgY29udHJvbGxlci5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBBUEkgR2F0ZXdheSBldmVudHMuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgQVBJIEdhdGV3YXkgcmVzcG9uc2Ugb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKFwiTGFtYmRhSGFuZGxlciBSZWNlaXZlZCBldmVudDpcIiwgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdCk7XG5cbiAgICAvLyBCdWlsZCB0aGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICBjb25zdCBjdHggPSB0aGlzLmJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG5cbiAgICB0cnkge1xuXG4gICAgICAvLyBMZWdhY3kgaW5pdGlhbGl6ZSBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG5cbiAgICAgIC8vIEV4ZWN1dGUgYmVmb3JlIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIGNvbnN0IHJvdXRlID0gdGhpcy5maW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KTtcblxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlcXVlc3QgaWYgdmFsaWRhdGlvbnMgYXJlIGRlZmluZWRcbiAgICAgIGlmIChyb3V0ZT8udmFsaWRhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGUocmVxdWVzdCwgcm91dGUudmFsaWRhdGlvbnMpO1xuICAgICAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IodmFsaWRhdGlvblJlc3VsdC5lcnJvcnMpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIGNhbGwgdGhlIHJvdXRlIGZ1bmN0aW9uXG4gICAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpcy5nZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKTtcbiAgICAgIGxldCBjb250cm9sbGVyUmVzcG9uc2U6IGFueSA9IHJvdXRlRnVuY3Rpb24uY2FsbCh0aGlzLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgIGNvbnRyb2xsZXJSZXNwb25zZSA9IGF3YWl0IGNvbnRyb2xsZXJSZXNwb25zZTtcbiAgICAgIH1cblxuICAgICAgLy8gRXhlY3V0ZSBhZnRlciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2FmdGVyJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIC8vIElmIHRoZSBjb250cm9sbGVyIHJldHVybmVkIGFueXRoaW5nIChSZXNwb25zZUNvbnRleHQgb3IgcmF3IEFQSSByZXN1bHQpLCBlbWl0IHRoYXRcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgIT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShjb250cm9sbGVyUmVzcG9uc2UpO1xuICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG5cbiAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0xhbWJkYUhhbmRsZXIgZXJyb3I6ICcsIGVycm9yT2JqKTtcblxuICAgICAgLy8gRXhlY3V0ZSBlcnJvciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUV4Y2VwdGlvbihyZXF1ZXN0LCBlcnJvck9iaiwgcmVzcG9uc2UpO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBpbi1tZW1vcnkgcmVzcG9uc2VDb250ZXh0XG4gICAgcmV0dXJuIHJlc3BvbnNlLmJ1aWxkKCk7XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHJvdXRlIHRoYXQgbWF0Y2hlcyB0aGUgSFRUUCBtZXRob2QgYW5kIHJlc291cmNlLlxuICAgKiBAcGFyYW0gcmVxdWVzdERhdGEgLSBUaGUgcmVxdWVzdCBkYXRhIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIG1hdGNoaW5nIHJvdXRlIG9yIG51bGwgaWYgbm90IGZvdW5kLlxuICAgKi9cbiAgcHJpdmF0ZSBmaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCk6IFJvdXRlIHwgbnVsbCB7XG4gICAgbGV0IGNvbnRyb2xsZXI6IGFueSA9IHRoaXM7XG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhcIkNhbGxlZCBmaW5kTWF0Y2hpbmdSb3V0ZSB3aXRoIHJlcXVlc3REYXRhOiBcIiwgeyByZXF1ZXN0RGF0YSwgcm91dGVzOiBjb250cm9sbGVyLnJvdXRlcyB9KTtcblxuICAgIC8vIERldGVybWluZSB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggYnkgZmluZGluZyB0aGUgbG9uZ2VzdCBjb21tb24gcHJlZml4IHRoYXQgZW5kcyB3aXRoIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICBsZXQgY29udHJvbGxlckJhc2VQYXRoID0gYC8ke2NvbnRyb2xsZXIuY29udHJvbGxlck5hbWV9YDtcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0Um9vdCA9ICcvJztcblxuICAgIC8vIEZvciBjb250cm9sbGVycyBpbiBzdWJkaXJlY3Rvcmllcywgd2UgbmVlZCB0byBtYXRjaCB0aGUgYWN0dWFsIHJlc291cmNlIHBhdGhcbiAgICAvLyBDaGVjayBpZiByZXNvdXJjZSBjb250YWlucyB0aGUgY29udHJvbGxlciBuYW1lIGFzIHBhcnQgb2YgYSBsb25nZXIgcGF0aFxuICAgIGNvbnN0IHJlc291cmNlUGFydHMgPSByZXF1ZXN0RGF0YS5yZXNvdXJjZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZVBhcnRzID0gY29udHJvbGxlci5jb250cm9sbGVyTmFtZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcblxuICAgIC8vIEZpbmQgaWYgdGhlIGNvbnRyb2xsZXIgbmFtZSBwYXJ0cyBhcmUgcHJlc2VudCBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgIGxldCBiYXNlUGF0aEVuZEluZGV4ID0gLTE7XG4gICAgaWYgKGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gTG9vayBmb3IgdGhlIGNvbnRyb2xsZXIgbmFtZSBzZXF1ZW5jZSBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gcmVzb3VyY2VQYXJ0cy5sZW5ndGggLSBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxldCBtYXRjaGVzID0gdHJ1ZTtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgaWYgKHJlc291cmNlUGFydHNbIGkgKyBqIF0gIT09IGNvbnRyb2xsZXJOYW1lUGFydHNbIGogXSkge1xuICAgICAgICAgICAgbWF0Y2hlcyA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgYmFzZVBhdGhFbmRJbmRleCA9IGkgKyBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmFzZVBhdGhFbmRJbmRleCA+PSAwKSB7XG4gICAgICAvLyBGb3VuZCB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggaW4gdGhlIHJlc291cmNlXG4gICAgICBjb25zdCBiYXNlUGF0aFBhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZSgwLCBiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICBjb250cm9sbGVyQmFzZVBhdGggPSAnLycgKyBiYXNlUGF0aFBhcnRzLmpvaW4oJy8nKTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ1BhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZShiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVtYWluaW5nUGFydHMubGVuZ3RoID4gMCA/ICcvJyArIHJlbWFpbmluZ1BhcnRzLmpvaW4oJy8nKSA6ICcvJztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmFsbGJhY2sgdG8gb3JpZ2luYWwgbG9naWMgZm9yIHNpbXBsZSBjYXNlc1xuICAgICAgaWYgKHJlcXVlc3REYXRhLnJlc291cmNlLnN0YXJ0c1dpdGgoY29udHJvbGxlckJhc2VQYXRoKSkge1xuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3Vic3RyaW5nKGNvbnRyb2xsZXJCYXNlUGF0aC5sZW5ndGgpIHx8ICcvJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKCdjb250cm9sbGVyQmFzZVBhdGg6ICcsIGNvbnRyb2xsZXJCYXNlUGF0aCk7XG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbygncmVzb3VyY2VXaXRob3V0Um9vdDogJywgcmVzb3VyY2VXaXRob3V0Um9vdCk7XG5cbiAgICAvLyBTZXBhcmF0ZSByb3V0ZXMgaW50byBleGFjdCBhbmQgcGFyYW1ldGVyaXplZCBmb3IgcHJvcGVyIHByaW9yaXRpemF0aW9uXG4gICAgY29uc3QgZXhhY3RNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuICAgIGNvbnN0IHBhcmFtZXRlcml6ZWRNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuXG4gICAgLy8gRmlyc3QgcGFzczogY2F0ZWdvcml6ZSByb3V0ZXMgYnkgdHlwZSBhbmQgbWV0aG9kXG4gICAgZm9yIChjb25zdCBbIHJvdXRlS2V5LCByb3V0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRyb2xsZXIucm91dGVzIHx8IHt9KSBhcyBbIHN0cmluZywgUm91dGUgXVtdKSB7XG4gICAgICBjb25zdCBbIHJvdXRlTWV0aG9kLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIC8vIFNraXAgaWYgSFRUUCBtZXRob2QgZG9lc24ndCBtYXRjaFxuICAgICAgaWYgKHJvdXRlTWV0aG9kICE9PSByZXF1ZXN0RGF0YS5odHRwTWV0aG9kKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXRlZ29yaXplIHJvdXRlIHR5cGVcbiAgICAgIGlmIChyb3V0ZVBhdGguaW5jbHVkZXMoJ3snKSAmJiByb3V0ZVBhdGguaW5jbHVkZXMoJ30nKSkge1xuICAgICAgICBwYXJhbWV0ZXJpemVkTWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhhY3RNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2Vjb25kIHBhc3M6IFRyeSBleGFjdCBtYXRjaGVzIGZpcnN0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUgfSBvZiBleGFjdE1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmIChyb3V0ZVBhdGggPT09IHJlc291cmNlV2l0aG91dFJvb3QpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRm91bmQgZXhhY3QgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWApO1xuICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVGhpcmQgcGFzczogVHJ5IHBhcmFtZXRlcml6ZWQgbWF0Y2hlcyAoc29ydGVkIGJ5IHNwZWNpZmljaXR5KVxuICAgIC8vIFNvcnQgcGFyYW1ldGVyaXplZCByb3V0ZXMgYnkgc3BlY2lmaWNpdHkgKG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBwcmlvcml0eSlcbiAgICBjb25zdCBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcyA9IHBhcmFtZXRlcml6ZWRNYXRjaGVzXG4gICAgICAubWFwKCh7IHJvdXRlS2V5LCByb3V0ZSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG4gICAgICAgIGNvbnN0IHNlZ21lbnRzID0gcm91dGVQYXRoLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICBjb25zdCBsaXRlcmFsU2VnbWVudHMgPSBzZWdtZW50cy5maWx0ZXIoc2VnbWVudCA9PiAhc2VnbWVudC5pbmNsdWRlcygneycpKTtcblxuICAgICAgICAvLyBTcGVjaWZpY2l0eSBzY29yZTogbW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlXG4gICAgICAgIC8vIEZvciBlcXVhbCBsaXRlcmFsIHNlZ21lbnRzLCBmZXdlciB0b3RhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZSAgXG4gICAgICAgIGNvbnN0IHNwZWNpZmljaXR5U2NvcmUgPSAobGl0ZXJhbFNlZ21lbnRzLmxlbmd0aCAqIDEwMDApIC0gc2VnbWVudHMubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoLCBzcGVjaWZpY2l0eVNjb3JlIH07XG4gICAgICB9KVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGIuc3BlY2lmaWNpdHlTY29yZSAtIGEuc3BlY2lmaWNpdHlTY29yZSk7IC8vIEhpZ2hlciBzY29yZSBmaXJzdFxuXG4gICAgZm9yIChjb25zdCB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoIH0gb2Ygc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMpIHtcbiAgICAgIC8vIENvbnZlcnQgZnJhbWV3b3JrIHtpZH0gc3ludGF4IHRvIHBhdGgtdG8tcmVnZXhwIDppZCBzeW50YXhcbiAgICAgIGNvbnN0IHBhdGhUb1JlZ2V4cFBhdHRlcm4gPSByb3V0ZVBhdGgucmVwbGFjZSgvXFx7KFtefV0rKVxcfS9nLCAnOiQxJyk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFVzZSBwYXRoLXRvLXJlZ2V4cCBmb3IgcHJvcGVyIHBhcmFtZXRlciBtYXRjaGluZ1xuICAgICAgICBjb25zdCB7IG1hdGNoIH0gPSByZXF1aXJlKCdwYXRoLXRvLXJlZ2V4cCcpO1xuICAgICAgICBjb25zdCBtYXRjaGVyID0gbWF0Y2gocGF0aFRvUmVnZXhwUGF0dGVybiwgeyBkZWNvZGU6IGRlY29kZVVSSUNvbXBvbmVudCB9KTtcbiAgICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBtYXRjaGVyKHJlc291cmNlV2l0aG91dFJvb3QpO1xuXG4gICAgICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZvdW5kIHBhcmFtZXRlcml6ZWQgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWAsIHtcbiAgICAgICAgICAgIHBhdHRlcm46IHBhdGhUb1JlZ2V4cFBhdHRlcm4sXG4gICAgICAgICAgICBwYXJhbXM6IG1hdGNoUmVzdWx0LnBhcmFtcyxcbiAgICAgICAgICAgIHNwZWNpZmljaXR5U2NvcmU6IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzLmZpbmQobSA9PiBtLnJvdXRlS2V5ID09PSByb3V0ZUtleSk/LnNwZWNpZmljaXR5U2NvcmVcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIE5vdGU6IFdlIGRvbid0IG5lZWQgdG8gbWFudWFsbHkgZXh0cmFjdCBwYXJhbWV0ZXJzIHNpbmNlIEFQSSBHYXRld2F5XG4gICAgICAgICAgLy8gYWxyZWFkeSBwcm92aWRlcyB0aGVtIGluIHJlcXVlc3REYXRhLnBhdGhQYXJhbWV0ZXJzXG4gICAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFcnJvciBtYXRjaGluZyByb3V0ZSBwYXR0ZXJuICR7cGF0aFRvUmVnZXhwUGF0dGVybn06YCwgZXJyb3IpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBtYXRjaGluZyByb3V0ZSBmb3VuZCBmb3IgJHtyZXF1ZXN0RGF0YS5odHRwTWV0aG9kfXwke3Jlc291cmNlV2l0aG91dFJvb3R9YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKiBAcGFyYW0gcm91dGUgLSBUaGUgbWF0Y2hlZCByb3V0ZS5cbiAgICogQHJldHVybnMgVGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqL1xuICBwcml2YXRlIGdldFJvdXRlRnVuY3Rpb24ocm91dGU6IFJvdXRlIHwgbnVsbCk6IEZ1bmN0aW9uIHtcbiAgICBpZiAoIXJvdXRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICAgIH1cblxuICAgIC8vQHRzLWlnbm9yZVxuICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzWyByb3V0ZS5mdW5jdGlvbk5hbWUgXTtcblxuICAgIHJldHVybiB0eXBlb2Ygcm91dGVGdW5jdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gcm91dGVGdW5jdGlvbiA6IHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIHRoZSBOb3RGb3VuZCByb3V0ZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDQwNCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVOb3RGb3VuZChfcmVxOiBSZXF1ZXN0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZSh7XG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiTm8gUm91dGUgRm91bmQhXCIgfSksXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZXJyb3JIYW5kbGVyPzogQ29udHJvbGxlckVycm9ySGFuZGxlcjtcbiAgcHJvdGVjdGVkIGdldEVycm9ySGFuZGxlcigpOiBDb250cm9sbGVyRXJyb3JIYW5kbGVyIHtcbiAgICBpZiAoIXRoaXMuZXJyb3JIYW5kbGVyKSB7XG4gICAgICB0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcigpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5lcnJvckhhbmRsZXI7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBleGNlcHRpb25zIGFuZCByZXR1cm5zIGEgSlNPTiByZXNwb25zZSB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHBhcmFtIGVyciAtIFRoZSBlcnJvciBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDUwMCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVFeGNlcHRpb24ocmVxOiBSZXF1ZXN0LCBlcnI6IEVycm9yLCByZXM6IFJlc3BvbnNlKTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlID0gdGhpcy5nZXRFcnJvckhhbmRsZXIoKShlcnIsIHJlcSwgcmVzKTtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShlcnJvclJlc3BvbnNlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBoYW5kbGVSZXNwb25zZShyZXM6IFJlc3BvbnNlIHwgQVBJR2F0ZXdheVByb3h5UmVzdWx0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBpZiAocmVzIGluc3RhbmNlb2YgUmVzcG9uc2VDb250ZXh0KSB7XG4gICAgICByZXR1cm4gcmVzLmJ1aWxkKCk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICBwcm90ZWN0ZWQgYnVpbGRDdHgoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKTogRXhlY3V0aW9uQ29udGV4dCB7XG4gICAgY29uc3QgYWN0b3IgPSB0aGlzLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuICAgIFxuICAgIGNvbnN0IGN0eCA9IHtcbiAgICAgIGV2ZW50LFxuICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIGFjdG9yLFxuICAgICAgZGVidWdJbmZvOiB7fVxuICAgIH07XG5cblxuXG4gICAgcmV0dXJuIGN0eDtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhY3RvciBjb250ZXh0IGZyb20gdGhlIHJlcXVlc3RcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgZm9yIGN1c3RvbSBhY3RvciBleHRyYWN0aW9uIGxvZ2ljXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcbiAgICBcbiAgICAvLyBCYXNlIGFjdG9yIGNvbnRleHRcbiAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICByZXF1ZXN0SWQsXG4gICAgICB0aW1lc3RhbXAsXG4gICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVycz8uWyd1c2VyLWFnZW50J10gfHwgZXZlbnQuaGVhZGVycz8uWydVc2VyLUFnZW50J10sXG4gICAgfTtcblxuXG5cbiAgICAvLyBFeHRyYWN0IGZyb20gQ29nbml0b1xuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zKSB7XG4gICAgICBjb25zdCBjbGFpbXMgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5hdXRob3JpemVyLmNsYWltcztcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBhY3Rvci5jb2duaXRvU3ViID0gY2xhaW1zLnN1YjtcbiAgICAgIGFjdG9yLmNvZ25pdG9Vc2VybmFtZSA9IGNsYWltc1snY29nbml0bzp1c2VybmFtZSddIHx8IGNsYWltcy51c2VybmFtZTtcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXNbJ2NvZ25pdG86dXNlcm5hbWUnXSB8fCBjbGFpbXMudXNlcm5hbWUgfHwgY2xhaW1zLnN1YjtcbiAgICAgIGFjdG9yLmNvZ25pdG9Hcm91cHMgPSBjbGFpbXNbJ2NvZ25pdG86Z3JvdXBzJ10/LnNwbGl0KCcsJykgfHwgW107XG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICB9XG4gICAgLy8gRXh0cmFjdCBmcm9tIEFQSSBLZXlcbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSkge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhcGkta2V5JztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcbiAgICAgIGFjdG9yLmFwaUtleUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuYXBpS2V5O1xuICAgICAgYWN0b3IuYWN0b3JJZCA9IGBhcGkta2V5OiR7YWN0b3IuYXBpS2V5SWR9YDtcbiAgICB9XG4gICAgLy8gRXh0cmFjdCBmcm9tIElBTVxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybikge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdpYW0nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgICAgYWN0b3IuaWFtUm9sZSA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LnVzZXJBcm47XG4gICAgICBhY3Rvci5pYW1Vc2VySWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS51c2VyIHx8IHVuZGVmaW5lZDtcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBhY3Rvci5pYW1Vc2VySWQgfHwgYWN0b3IuaWFtUm9sZTtcbiAgICB9XG4gICAgLy8gU3lzdGVtL2Fub255bW91c1xuICAgIGVsc2Uge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdzeXN0ZW0nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvcklkID0gJ3N5c3RlbSc7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCB0ZW5hbnQgZnJvbSBjdXN0b20gaGVhZGVycyBvciBKV1RcbiAgICBhY3Rvci50ZW5hbnRJZCA9IHJlcXVlc3QuaGVhZGVycz8uWyd4LXRlbmFudC1pZCddIHx8IFxuICAgICAgICAgICAgICAgICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zPy5bJ2N1c3RvbTp0ZW5hbnRJZCddO1xuXG4gICAgLy8gR2VuZXJhdGUgY29ycmVsYXRpb24gSUQgaWYgbm90IHByZXNlbnRcbiAgICBhY3Rvci5jb3JyZWxhdGlvbklkID0gcmVxdWVzdC5oZWFkZXJzPy5bJ3gtY29ycmVsYXRpb24taWQnXSB8fCByZXF1ZXN0SWQ7XG4gICAgXG5cbiAgICBcbiAgICByZXR1cm4gYWN0b3I7XG4gIH1cbn1cbiJdfQ==