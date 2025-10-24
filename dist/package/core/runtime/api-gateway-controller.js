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
    /**
     * Builds the execution context for the request
     *
     * different middleware can enhance the actor context by using the enhanceActor method
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
     * @param event
     * @param context
     * @param request
     * @param response
     * @returns
     */
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
        // Cognito authentication with focused enhancements
        if (event.requestContext?.authorizer?.claims) {
            this.extractCognitoContext(event.requestContext.authorizer.claims, actor);
        }
        // API Key authentication
        else if (event.requestContext?.identity?.apiKey || request.headers?.['x-api-key']) {
            this.extractApiKeyContext(event, request, actor);
        }
        // IAM authentication 
        else if (event.requestContext?.identity?.userArn) {
            this.extractIamContext(event, actor);
        }
        // Anonymous
        else {
            actor.authMethod = 'anonymous';
            actor.actorType = 'anonymous';
            actor.actorId = 'anonymous';
        }
        // Session and tenant context
        this.extractSessionAndTenantContext(event, request, actor);
        // API Gateway context
        actor.apiStage = event.requestContext?.stage;
        actor.apiId = event.requestContext?.apiId;
        return actor;
    }
    /**
     * Extract Cognito actor context based on documented AWS Cognito JWT claims
     * Only extracts what's officially documented and available in API Gateway context
     *
     * @param claims - Cognito JWT claims from the authorizer
     * @param actor - Actor object to populate
     */
    extractCognitoContext(claims, actor) {
        try {
            actor.authMethod = 'cognito';
            actor.actorType = 'user';
            // Actor ID with documented fallback strategy: cognito:username -> email -> sub
            actor.actorId = claims['cognito:username'] || claims.email || claims.sub;
            // Standard user attributes (documented Cognito user attributes)
            actor.email = claims.email;
            actor.emailVerified = claims.email_verified === 'true';
            actor.phoneNumber = claims.phone_number;
            actor.phoneVerified = claims.phone_number_verified === 'true';
            actor.name = claims.name;
            actor.locale = claims.locale;
            // Parse Cognito groups (documented as comma-separated string)
            const groups = this.parseGroups(claims['cognito:groups']);
            // Extract custom attributes (documented pattern: custom:*)
            const customAttributes = this.extractCustomAttributes(claims);
            // Build Cognito context with only documented fields
            actor.cognito = {
                sub: claims.sub,
                username: claims['cognito:username'],
                groups: groups, // Always include groups array (empty or populated)
                customAttributes: Object.keys(customAttributes).length > 0 ? customAttributes : undefined
            };
            // Extract tenant ID from custom attributes (common multi-tenant pattern)
            actor.tenantId = customAttributes.tenantId;
            actor.rawAuthContext = claims;
        }
        catch (error) {
            this.logger.warn('Error extracting Cognito actor context', { error, claims });
            // Minimal fallback extraction
            actor.authMethod = 'cognito';
            actor.actorType = 'user';
            actor.actorId = claims.sub || 'unknown';
            actor.rawAuthContext = claims;
        }
    }
    /**
     * Parse Cognito groups from comma-separated string (documented Cognito format)
     */
    parseGroups(groups) {
        if (typeof groups === 'string' && groups.length > 0) {
            return groups.split(',').map(g => g.trim()).filter(g => g.length > 0);
        }
        return [];
    }
    /**
     * Extract custom attributes using documented Cognito pattern (custom:*)
     */
    extractCustomAttributes(claims) {
        const customAttributes = {};
        Object.keys(claims).forEach(key => {
            if (key.startsWith('custom:')) {
                const attributeName = key.replace('custom:', '');
                customAttributes[attributeName] = claims[key];
            }
        });
        return customAttributes;
    }
    /**
   * Extract session and tenant context - focused approach
   */
    extractSessionAndTenantContext(event, request, actor) {
        // Session context
        actor.sessionId = request.headers?.['x-session-id'];
        // Tenant context - check custom attributes first, then headers
        actor.tenantId = request.headers?.['x-tenant-id'] ||
            event.requestContext?.authorizer?.claims?.['custom:tenantId'];
    }
    /**
     * Extract API Key context
     */
    extractApiKeyContext(event, request, actor) {
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
            source: source,
        };
    }
    /**
     * Extract IAM context
     */
    extractIamContext(event, actor) {
        actor.authMethod = 'iam';
        actor.actorType = 'service';
        actor.actorId = event.requestContext?.identity?.user ||
            event.requestContext?.identity?.userArn ||
            'unknown-iam-user';
        actor.iam = {
            userArn: event.requestContext?.identity?.userArn || undefined,
            userId: event.requestContext?.identity?.user || undefined,
            accountId: event.requestContext?.identity?.accountId || undefined,
            caller: event.requestContext?.identity?.caller || undefined,
        };
    }
}
exports.APIController = APIController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFzREEsNENBeUJDO0FBN0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFZakgsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQThCLEVBQUUsQ0FBQztBQUVqRCxNQUFNLGFBQWEsR0FBRyxDQUFDLFVBQW1DLEVBQUUsRUFBRTtJQUNuRSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDckMsQ0FBQyxDQUFBO0FBRlksUUFBQSxhQUFhLGlCQUV6QjtBQUNNLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxFQUFFO0lBQ25DLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7QUFDL0IsQ0FBQyxDQUFBO0FBRlksUUFBQSxnQkFBZ0Isb0JBRTVCO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILFNBQWdCLGdCQUFnQixDQUM5QixPQUlxQixFQUNyQixPQUFxRjtJQUdyRixNQUFNLEVBQUUsSUFBSSxFQUFFLElBQUksR0FBRyxFQUFFLEVBQUUsTUFBTSxHQUFHLFlBQUcsRUFBRSxHQUFHLGdCQUFnQixFQUFFLEdBQUcsT0FBTyxDQUFDO0lBR3ZFLElBQU0sb0JBQW9CLEdBQTFCLE1BQU0sb0JBQW9CO1FBRWxCLEFBQU4sS0FBSyxDQUFDLGFBQWE7WUFDakIsc0RBQXNEO1FBQ3hELENBQUM7S0FDRixDQUFBO0lBSE87UUFETCxNQUFNLENBQUMsSUFBSSxDQUFDOzZEQUdaO0lBSkcsb0JBQW9CO1FBRHpCLElBQUEsdUJBQVUsRUFBQyxJ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UztZQUN6RCxTQUFTLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsU0FBUyxJQUFJLFNBQVM7WUFDakUsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE1BQU0sSUFBSSxTQUFTO1NBQzVELENBQUM7SUFDSixDQUFDO0NBQ0Y7QUE3a0JELHNDQTZrQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB0eXBlIHsgUmVxdWVzdCwgUmVzcG9uc2UsIFJvdXRlIH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIElDb250cm9sbGVyQ29uZmlnIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IEdldCwgUm91dGVNZXRob2RzIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnMvbWV0aG9kXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJVmFsaWRhdG9yLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSwgaXNJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb24vdXRpbHNcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBSZXF1ZXN0Q29udGV4dCB9IGZyb20gXCIuL3JlcXVlc3QtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb250ZXh0IH0gZnJvbSBcIi4vcmVzcG9uc2UtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb25maWcsIG1lcmdlUmVzcG9uc2VDb25maWcgfSBmcm9tIFwiLi9yZXNwb25zZS1jb25maWdcIjtcbmltcG9ydCB7IFZhbGlkYXRpb25GYWlsZWRFcnJvciwgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvciwgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSBcIi4uLy4uL2Vycm9ycy9cIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG5leHBvcnQgdHlwZSBDb250cm9sbGVyRXJyb3JIYW5kbGVyID0gUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlRXJyb3JIYW5kbGVyPjtcblxuLy8gTmV3IGludGVyZmFjZXMgZm9yIG1pZGRsZXdhcmUgYW5kIGVycm9yIGhhbmRsaW5nXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlIHtcbiAgYmVmb3JlPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgYWZ0ZXI/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBvbkVycm9yPzogKGVycm9yOiBFcnJvciwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xufVxuXG4vLyBHbG9iYWwgbWlkZGxld2FyZSBtYW5hZ2VtZW50XG5jb25zdCBnbG9iYWxNaWRkbGV3YXJlczogQVBJQ29udHJvbGxlck1pZGRsZXdhcmVbXSA9IFtdO1xuXG5leHBvcnQgY29uc3QgdXNlTWlkZGxld2FyZSA9IChtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5wdXNoKG1pZGRsZXdhcmUpO1xufVxuZXhwb3J0IGNvbnN0IGNsZWFyTWlkZGxld2FyZXMgPSAoKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmxlbmd0aCA9IDA7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBBUEkgaGFuZGxlciB3aXRob3V0IGRlZmluaW5nIGEgY2xhc3NcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBleHBvcnQgY29uc3QgeyBoYW5kbGVyLCBkZXNjcmlwdG9yIH0gPSBjcmVhdGVBcGlIYW5kbGVyKFxuICogIHsgbWV0aG9kOiBHZXQsIG5hbWU6ICdkZW1vJywgYXV0aG9yaXplcjogJ05PTkUnIH0sXG4gKiAgIGFzeW5jICggZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gKiAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAqICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gKiAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIkhlbGxvIFdvcmxkIVwifSlcbiAqICAgICAgIH0pXG4gKiAgIH1cbiAqIClcbiAqIGBgYFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmcgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLnBhdGggLSBUaGUgcGF0aCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubWV0aG9kIC0gVGhlIEhUVFAgbWV0aG9kIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcmV0dXJucyBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgaGFuZGxlciBmdW5jdGlvbiBhbmQgdGhlIGNvbnRyb2xsZXIgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUFwaUhhbmRsZXIoXG4gIG9wdGlvbnM6IHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgcGF0aD86IHN0cmluZyxcbiAgICBtZXRob2Q/OiBSb3V0ZU1ldGhvZHMsXG4gIH0gJiBJQ29udHJvbGxlckNvbmZpZyxcbiAgaGFuZGxlcjogKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpID0+IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0Pixcbikge1xuXG4gIGNvbnN0IHsgbmFtZSwgcGF0aCA9ICcnLCBtZXRob2QgPSBHZXQsIC4uLmNvbnRyb2xsZXJDb25maWcgfSA9IG9wdGlvbnM7XG5cbiAgQENvbnRyb2xsZXIobmFtZSwgeyAuLi5jb250cm9sbGVyQ29uZmlnLCBhdXRvRXhwb3J0TGFtYmRhSGFuZGxlcjogZmFsc2UgfSlcbiAgY2xhc3MgQ29udHJvbGxlckRlc2NyaXB0b3Ige1xuICAgIEBtZXRob2QocGF0aClcbiAgICBhc3luYyBpbmxpbmVIYW5kbGVyKCkge1xuICAgICAgLy8gcGxhY2Vob2xkZXIgZnVuY3Rpb24gb25seSB1c2VkIGZvciByb3V0aW5nIG1ldGFkYXRhXG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGhhbmRsZXIsICduYW1lJywgeyB2YWx1ZTogJ2hhbmRsZXInIH0pO1xuXG4gIHJldHVybiB7XG4gICAgaGFuZGxlcixcbiAgICBkZXNjcmlwdG9yOiBDb250cm9sbGVyRGVzY3JpcHRvclxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJDb25maWcge1xuICByZXNwb25zZUNvbmZpZz86IFBhcnRpYWw8UmVzcG9uc2VDb25maWc+O1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQVBJQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHByb3RlY3RlZCBtaWRkbGV3YXJlczogQVBJQ29udHJvbGxlck1pZGRsZXdhcmVbXSA9IFtdO1xuICBwcm90ZWN0ZWQgcmVzcG9uc2VDb25maWc6IFJlc3BvbnNlQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogQVBJQ29udHJvbGxlckNvbmZpZyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQ29uZmlnID0gbWVyZ2VSZXNwb25zZUNvbmZpZyhjb25maWcucmVzcG9uc2VDb25maWcpO1xuICB9XG5cbiAgLyoqXG4gICAqIGNhbiBiZSB1c2VkIHRvIHJ1biBzb21lIGxvZ2ljIGp1c3QgYmVmb3JlIHRoZSByZXF1ZXN0IGlzIHByb2Nlc3NlZCBsaWtlIGNyZWF0aW5nIGNsaWVudHMsIGRpLWluamVjdGlvbiBhbnMgc28gb24uXG4gICAqIEBwYXJhbSBfZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gX2NvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGNvbnRyb2xsZXIgaXMgaW5pdGlhbGl6ZWQuXG4gICovXG4gIHByb3RlY3RlZCBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vLW9wIGZvciBBUEkgY29udHJvbGxlcnNcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgfVxuXG4gIC8vIEFkZCBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBtZXRob2RcbiAgcHJvdGVjdGVkIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpIHtcbiAgICB0aGlzLm1pZGRsZXdhcmVzLnB1c2gobWlkZGxld2FyZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0TWlkZGxld2FyZXMoKSB7XG4gICAgcmV0dXJuIFsgLi4uZ2xvYmFsTWlkZGxld2FyZXMsIC4uLnRoaXMubWlkZGxld2FyZXMgXTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGUgbWlkZGxld2FyZSBwaXBlbGluZVxuICBwcml2YXRlIGFzeW5jIGV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoXG4gICAgcGhhc2U6ICdiZWZvcmUnIHwgJ2FmdGVyJyB8ICdvbkVycm9yJyxcbiAgICByZXF1ZXN0OiBSZXF1ZXN0LFxuICAgIHJlc3BvbnNlOiBSZXNwb25zZSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0LFxuICAgIGVycm9yPzogRXJyb3JcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG5cbiAgICBjb25zdCBhbGxNaWRkbGV3YXJlcyA9IHRoaXMuZ2V0TWlkZGxld2FyZXMoKTtcblxuICAgIGZvciAoY29uc3QgbWlkZGxld2FyZSBvZiBhbGxNaWRkbGV3YXJlcykge1xuICAgICAgaWYgKHBoYXNlID09PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZS5vbkVycm9yICYmIGVycm9yKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmUub25FcnJvcihlcnJvciwgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9IGVsc2UgaWYgKHBoYXNlICE9PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZVsgcGhhc2UgXSkge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlWyBwaGFzZSBdIShyZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgfVxuXG4gIGFzeW5jIHZhbGlkYXRlKHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0LCB2YWxpZGF0aW9uczogSW5wdXRWYWxpZGF0aW9uUnVsZSB8IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICBsZXQgdmFsaWRhdGlvblJ1bGVzOiBIdHRwUmVxdWVzdFZhbGlkYXRpb25zID0gdmFsaWRhdGlvbnM7XG4gICAgaWYgKGlzSW5wdXRWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9ucykpIHtcbiAgICAgIGlmIChbICdHRVQnLCAnREVMRVRFJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IHF1ZXJ5OiB2YWxpZGF0aW9ucyB9XG5cbiAgICAgIH0gZWxzZSBpZiAoWyAnUE9TVCcsICdQVVQnLCAnUEFUQ0gnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgYm9keTogdmFsaWRhdGlvbnMgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25SdWxlcykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yKHZhbGlkYXRpb25SdWxlcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdG9yLnZhbGlkYXRlSHR0cFJlcXVlc3Qoe1xuICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvblJ1bGVzLFxuICAgICAgY29sbGVjdEVycm9yczogdHJ1ZSxcbiAgICAgIHZlcmJvc2VFcnJvcnM6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCB0aGlzLmdldE92ZXJyaWRkZW5IdHRwUmVxdWVzdFZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKClcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXF1ZXN0Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxSZXF1ZXN0PiB7XG4gICAgcmV0dXJuIG5ldyBSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2VDb250ZXh0KHtcbiAgICAgIHRyYWNlSWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIHJlcXVlc3RJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgZGVidWdNb2RlOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICByb3V0ZTogcmVxdWVzdENvbnRleHQucGF0aCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICdkZXZlbG9wbWVudCcsXG4gICAgICBjb25maWc6IHRoaXMucmVzcG9uc2VDb25maWdcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYW1iZGEgaGFuZGxlciBmb3IgdGhlIGNvbnRyb2xsZXIuXG4gICAqIEhhbmRsZXMgaW5jb21pbmcgQVBJIEdhdGV3YXkgZXZlbnRzLlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIEFQSSBHYXRld2F5IHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhcIkxhbWJkYUhhbmRsZXIgUmVjZWl2ZWQgZXZlbnQ6XCIsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuXG4gICAgLy8gQnVpbGQgdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4ID0gdGhpcy5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuXG4gICAgdHJ5IHtcblxuICAgICAgLy8gTGVnYWN5IGluaXRpYWxpemUgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBFeGVjdXRlIGJlZm9yZSBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2JlZm9yZScsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICBjb25zdCByb3V0ZSA9IHRoaXMuZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCk7XG5cbiAgICAgIC8vIFZhbGlkYXRlIHRoZSByZXF1ZXN0IGlmIHZhbGlkYXRpb25zIGFyZSBkZWZpbmVkXG4gICAgICBpZiAocm91dGU/LnZhbGlkYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlKHJlcXVlc3QsIHJvdXRlLnZhbGlkYXRpb25zKTtcbiAgICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBjYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXMuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gICAgICBsZXQgY29udHJvbGxlclJlc3BvbnNlOiBhbnkgPSByb3V0ZUZ1bmN0aW9uLmNhbGwodGhpcywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICBjb250cm9sbGVyUmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyUmVzcG9uc2U7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdhZnRlcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAvLyBJZiB0aGUgY29udHJvbGxlciByZXR1cm5lZCBhbnl0aGluZyAoUmVzcG9uc2VDb250ZXh0IG9yIHJhdyBBUEkgcmVzdWx0KSwgZW1pdCB0aGF0XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoY29udHJvbGxlclJlc3BvbnNlKTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycikge1xuXG4gICAgICBjb25zdCBlcnJvck9iaiA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKTtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdMYW1iZGFIYW5kbGVyIGVycm9yOiAnLCBlcnJvck9iaik7XG5cbiAgICAgIC8vIEV4ZWN1dGUgZXJyb3IgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdvbkVycm9yJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3JPYmopO1xuXG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVFeGNlcHRpb24ocmVxdWVzdCwgZXJyb3JPYmosIHJlc3BvbnNlKTtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byB0aGUgaW4tbWVtb3J5IHJlc3BvbnNlQ29udGV4dFxuICAgIHJldHVybiByZXNwb25zZS5idWlsZCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSByb3V0ZSB0aGF0IG1hdGNoZXMgdGhlIEhUVFAgbWV0aG9kIGFuZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHJlcXVlc3REYXRhIC0gVGhlIHJlcXVlc3QgZGF0YSBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSBtYXRjaGluZyByb3V0ZSBvciBudWxsIGlmIG5vdCBmb3VuZC5cbiAgICovXG4gIHByaXZhdGUgZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdERhdGE6IFJlcXVlc3QpOiBSb3V0ZSB8IG51bGwge1xuICAgIGxldCBjb250cm9sbGVyOiBhbnkgPSB0aGlzO1xuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oXCJDYWxsZWQgZmluZE1hdGNoaW5nUm91dGUgd2l0aCByZXF1ZXN0RGF0YTogXCIsIHsgcmVxdWVzdERhdGEsIHJvdXRlczogY29udHJvbGxlci5yb3V0ZXMgfSk7XG5cbiAgICAvLyBEZXRlcm1pbmUgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGJ5IGZpbmRpbmcgdGhlIGxvbmdlc3QgY29tbW9uIHByZWZpeCB0aGF0IGVuZHMgd2l0aCB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgbGV0IGNvbnRyb2xsZXJCYXNlUGF0aCA9IGAvJHtjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lfWA7XG4gICAgbGV0IHJlc291cmNlV2l0aG91dFJvb3QgPSAnLyc7XG5cbiAgICAvLyBGb3IgY29udHJvbGxlcnMgaW4gc3ViZGlyZWN0b3JpZXMsIHdlIG5lZWQgdG8gbWF0Y2ggdGhlIGFjdHVhbCByZXNvdXJjZSBwYXRoXG4gICAgLy8gQ2hlY2sgaWYgcmVzb3VyY2UgY29udGFpbnMgdGhlIGNvbnRyb2xsZXIgbmFtZSBhcyBwYXJ0IG9mIGEgbG9uZ2VyIHBhdGhcbiAgICBjb25zdCByZXNvdXJjZVBhcnRzID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgY29udHJvbGxlck5hbWVQYXJ0cyA9IGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAvLyBGaW5kIGlmIHRoZSBjb250cm9sbGVyIG5hbWUgcGFydHMgYXJlIHByZXNlbnQgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICBsZXQgYmFzZVBhdGhFbmRJbmRleCA9IC0xO1xuICAgIGlmIChjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIExvb2sgZm9yIHRoZSBjb250cm9sbGVyIG5hbWUgc2VxdWVuY2UgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHJlc291cmNlUGFydHMubGVuZ3RoIC0gY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBsZXQgbWF0Y2hlcyA9IHRydWU7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIGlmIChyZXNvdXJjZVBhcnRzWyBpICsgaiBdICE9PSBjb250cm9sbGVyTmFtZVBhcnRzWyBqIF0pIHtcbiAgICAgICAgICAgIG1hdGNoZXMgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIGJhc2VQYXRoRW5kSW5kZXggPSBpICsgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggLSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGJhc2VQYXRoRW5kSW5kZXggPj0gMCkge1xuICAgICAgLy8gRm91bmQgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGluIHRoZSByZXNvdXJjZVxuICAgICAgY29uc3QgYmFzZVBhdGhQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoMCwgYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgY29udHJvbGxlckJhc2VQYXRoID0gJy8nICsgYmFzZVBhdGhQYXJ0cy5qb2luKCcvJyk7XG4gICAgICBjb25zdCByZW1haW5pbmdQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlbWFpbmluZ1BhcnRzLmxlbmd0aCA+IDAgPyAnLycgKyByZW1haW5pbmdQYXJ0cy5qb2luKCcvJykgOiAnLyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG9yaWdpbmFsIGxvZ2ljIGZvciBzaW1wbGUgY2FzZXNcbiAgICAgIGlmIChyZXF1ZXN0RGF0YS5yZXNvdXJjZS5zdGFydHNXaXRoKGNvbnRyb2xsZXJCYXNlUGF0aCkpIHtcbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3REYXRhLnJlc291cmNlLnN1YnN0cmluZyhjb250cm9sbGVyQmFzZVBhdGgubGVuZ3RoKSB8fCAnLyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbygnY29udHJvbGxlckJhc2VQYXRoOiAnLCBjb250cm9sbGVyQmFzZVBhdGgpO1xuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oJ3Jlc291cmNlV2l0aG91dFJvb3Q6ICcsIHJlc291cmNlV2l0aG91dFJvb3QpO1xuXG4gICAgLy8gU2VwYXJhdGUgcm91dGVzIGludG8gZXhhY3QgYW5kIHBhcmFtZXRlcml6ZWQgZm9yIHByb3BlciBwcmlvcml0aXphdGlvblxuICAgIGNvbnN0IGV4YWN0TWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcbiAgICBjb25zdCBwYXJhbWV0ZXJpemVkTWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcblxuICAgIC8vIEZpcnN0IHBhc3M6IGNhdGVnb3JpemUgcm91dGVzIGJ5IHR5cGUgYW5kIG1ldGhvZFxuICAgIGZvciAoY29uc3QgWyByb3V0ZUtleSwgcm91dGUgXSBvZiBPYmplY3QuZW50cmllcyhjb250cm9sbGVyLnJvdXRlcyB8fCB7fSkgYXMgWyBzdHJpbmcsIFJvdXRlIF1bXSkge1xuICAgICAgY29uc3QgWyByb3V0ZU1ldGhvZCwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICAvLyBTa2lwIGlmIEhUVFAgbWV0aG9kIGRvZXNuJ3QgbWF0Y2hcbiAgICAgIGlmIChyb3V0ZU1ldGhvZCAhPT0gcmVxdWVzdERhdGEuaHR0cE1ldGhvZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2F0ZWdvcml6ZSByb3V0ZSB0eXBlXG4gICAgICBpZiAocm91dGVQYXRoLmluY2x1ZGVzKCd7JykgJiYgcm91dGVQYXRoLmluY2x1ZGVzKCd9JykpIHtcbiAgICAgICAgcGFyYW1ldGVyaXplZE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4YWN0TWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlY29uZCBwYXNzOiBUcnkgZXhhY3QgbWF0Y2hlcyBmaXJzdCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlIH0gb2YgZXhhY3RNYXRjaGVzKSB7XG4gICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICBpZiAocm91dGVQYXRoID09PSByZXNvdXJjZVdpdGhvdXRSb290KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCBwYXJhbWV0ZXJpemVkIG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gLCB7XG4gICAgICAgICAgICBwYXR0ZXJuOiBwYXRoVG9SZWdleHBQYXR0ZXJuLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFJlc3VsdC5wYXJhbXMsXG4gICAgICAgICAgICBzcGVjaWZpY2l0eVNjb3JlOiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcy5maW5kKG0gPT4gbS5yb3V0ZUtleSA9PT0gcm91dGVLZXkpPy5zcGVjaWZpY2l0eVNjb3JlXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBOb3RlOiBXZSBkb24ndCBuZWVkIHRvIG1hbnVhbGx5IGV4dHJhY3QgcGFyYW1ldGVycyBzaW5jZSBBUEkgR2F0ZXdheVxuICAgICAgICAgIC8vIGFscmVhZHkgcHJvdmlkZXMgdGhlbSBpbiByZXF1ZXN0RGF0YS5wYXRoUGFyYW1ldGVyc1xuICAgICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRXJyb3IgbWF0Y2hpbmcgcm91dGUgcGF0dGVybiAke3BhdGhUb1JlZ2V4cFBhdHRlcm59OmAsIGVycm9yKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIud2FybihgTm8gbWF0Y2hpbmcgcm91dGUgZm91bmQgZm9yICR7cmVxdWVzdERhdGEuaHR0cE1ldGhvZH18JHtyZXNvdXJjZVdpdGhvdXRSb290fWApO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICogQHBhcmFtIHJvdXRlIC0gVGhlIG1hdGNoZWQgcm91dGUuXG4gICAqIEByZXR1cm5zIFRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlOiBSb3V0ZSB8IG51bGwpOiBGdW5jdGlvbiB7XG4gICAgaWYgKCFyb3V0ZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgICB9XG5cbiAgICAvL0B0cy1pZ25vcmVcbiAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpc1sgcm91dGUuZnVuY3Rpb25OYW1lIF07XG5cbiAgICByZXR1cm4gdHlwZW9mIHJvdXRlRnVuY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHJvdXRlRnVuY3Rpb24gOiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyB0aGUgTm90Rm91bmQgcm91dGUuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA0MDQgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlTm90Rm91bmQoX3JlcTogUmVxdWVzdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2Uoe1xuICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIk5vIFJvdXRlIEZvdW5kIVwiIH0pLFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGVycm9ySGFuZGxlcj86IENvbnRyb2xsZXJFcnJvckhhbmRsZXI7XG4gIHByb3RlY3RlZCBnZXRFcnJvckhhbmRsZXIoKTogQ29udHJvbGxlckVycm9ySGFuZGxlciB7XG4gICAgaWYgKCF0aGlzLmVycm9ySGFuZGxlcikge1xuICAgICAgdGhpcy5lcnJvckhhbmRsZXIgPSBjcmVhdGVFcnJvckhhbmRsZXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZXJyb3JIYW5kbGVyO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgZXhjZXB0aW9ucyBhbmQgcmV0dXJucyBhIEpTT04gcmVzcG9uc2Ugd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSBlcnIgLSBUaGUgZXJyb3Igb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA1MDAgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlRXhjZXB0aW9uKHJlcTogUmVxdWVzdCwgZXJyOiBFcnJvciwgcmVzOiBSZXNwb25zZSk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgY29uc3QgZXJyb3JSZXNwb25zZSA9IHRoaXMuZ2V0RXJyb3JIYW5kbGVyKCkoZXJyLCByZXEsIHJlcyk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoZXJyb3JSZXNwb25zZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlUmVzcG9uc2UocmVzOiBSZXNwb25zZSB8IEFQSUdhdGV3YXlQcm94eVJlc3VsdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgaWYgKHJlcyBpbnN0YW5jZW9mIFJlc3BvbnNlQ29udGV4dCkge1xuICAgICAgcmV0dXJuIHJlcy5idWlsZCgpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZXhlY3V0aW9uIGNvbnRleHQgZm9yIHRoZSByZXF1ZXN0XG4gICAqIFxuICAgKiBkaWZmZXJlbnQgbWlkZGxld2FyZSBjYW4gZW5oYW5jZSB0aGUgYWN0b3IgY29udGV4dCBieSB1c2luZyB0aGUgZW5oYW5jZUFjdG9yIG1ldGhvZFxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0c1xuICAgKiBjb25zdCBtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSA9IHtcbiAgICogIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0LCBfcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgKiAgIGN0eD8uZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgcm9sZXM6IFsnYWRtaW4nLCAndXNlciddLFxuICAgKiAgICAgcGVybWlzc2lvbnM6IFsncmVhZCcsICd3cml0ZSddLFxuICAgKiAgICAgc3Vic2NyaXB0aW9uOiB7IHRpZXI6ICdlbnRlcnByaXNlJyB9XG4gICAqICAgfSk7XG4gICAqICB9XG4gICAqIH1cbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlKTtcbiAgICogXG4gICAqIE9SXG4gICAqIFxuICAgKiBjb25zdCBzZWN1cml0eU1pZGRsZXdhcmUgPSB7XG4gICAqICAgYmVmb3JlOiBhc3luYyAocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgKiAgICAgY3R4LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgICAgcmlza1Byb2ZpbGU6IGF3YWl0IGFzc2Vzc1Jpc2soY3R4LmFjdG9yLmFjdG9ySWQpLFxuICAgKiAgICAgICBkZXZpY2U6IGF3YWl0IG1ha2VEZXZpY2VDb250ZXh0KHJlcXVlc3QpXG4gICAqICAgICB9KTtcbiAgICogICB9XG4gICAqIH07XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUoc2VjdXJpdHlNaWRkbGV3YXJlKTtcbiAgICpcbiAgICogQHBhcmFtIGV2ZW50IFxuICAgKiBAcGFyYW0gY29udGV4dCBcbiAgICogQHBhcmFtIHJlcXVlc3QgXG4gICAqIEBwYXJhbSByZXNwb25zZSBcbiAgICogQHJldHVybnMgXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRDdHgoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKTogRXhlY3V0aW9uQ29udGV4dCB7XG4gICAgY29uc3QgYWN0b3IgPSB0aGlzLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuICAgIFxuICAgIGNvbnN0IGN0eDogRXhlY3V0aW9uQ29udGV4dCA9IHtcbiAgICAgIGV2ZW50LFxuICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIGFjdG9yLFxuICAgICAgZGVidWdJbmZvOiB7fSxcbiAgICAgIFxuICAgICAgLy8gU2ltcGxlIGFjdG9yIGVuaGFuY2VtZW50IG1ldGhvZFxuICAgICAgZW5oYW5jZUFjdG9yOiAoZW5oYW5jZW1lbnQ6IFBhcnRpYWw8QWN0b3I+KSA9PiB7XG4gICAgICAgIGlmIChjdHguYWN0b3IpIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKGN0eC5hY3RvciwgZW5oYW5jZW1lbnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiBjdHg7XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdHMgYWN0b3IgY29udGV4dCBmcm9tIHRoZSByZXF1ZXN0XG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGZvciBjdXN0b20gYWN0b3IgZXh0cmFjdGlvbiBsb2dpY1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gcmVxdWVzdCAtIFRoZSByZXF1ZXN0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIGFjdG9yIGNvbnRleHQuXG4gICAqIGBgYFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCk6IEFjdG9yIHtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVxdWVzdC5yZXF1ZXN0SWQ7XG4gICAgXG4gICAgY29uc3QgYWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkLFxuICAgICAgdGltZXN0YW1wLFxuICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnM/LlsndXNlci1hZ2VudCddIHx8IGV2ZW50LmhlYWRlcnM/LlsnVXNlci1BZ2VudCddLFxuICAgICAgY29ycmVsYXRpb25JZDogcmVxdWVzdC5oZWFkZXJzPy5bJ3gtY29ycmVsYXRpb24taWQnXSB8fCByZXF1ZXN0SWQsXG4gICAgfTtcblxuICAgIC8vIENvZ25pdG8gYXV0aGVudGljYXRpb24gd2l0aCBmb2N1c2VkIGVuaGFuY2VtZW50c1xuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zKSB7XG4gICAgICB0aGlzLmV4dHJhY3RDb2duaXRvQ29udGV4dChldmVudC5yZXF1ZXN0Q29udGV4dC5hdXRob3JpemVyLmNsYWltcywgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBUEkgS2V5IGF1dGhlbnRpY2F0aW9uXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkgfHwgcmVxdWVzdC5oZWFkZXJzPy5bJ3gtYXBpLWtleSddKSB7XG4gICAgICB0aGlzLmV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50LCByZXF1ZXN0LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIElBTSBhdXRoZW50aWNhdGlvbiBcbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4pIHtcbiAgICAgIHRoaXMuZXh0cmFjdElhbUNvbnRleHQoZXZlbnQsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gQW5vbnltb3VzXG4gICAgZWxzZSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSAnYW5vbnltb3VzJztcbiAgICB9XG5cbiAgICAvLyBTZXNzaW9uIGFuZCB0ZW5hbnQgY29udGV4dFxuICAgIHRoaXMuZXh0cmFjdFNlc3Npb25BbmRUZW5hbnRDb250ZXh0KGV2ZW50LCByZXF1ZXN0LCBhY3Rvcik7XG4gICAgXG4gICAgLy8gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgIGFjdG9yLmFwaVN0YWdlID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LnN0YWdlO1xuICAgIGFjdG9yLmFwaUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmFwaUlkO1xuICAgIFxuICAgIHJldHVybiBhY3RvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IENvZ25pdG8gYWN0b3IgY29udGV4dCBiYXNlZCBvbiBkb2N1bWVudGVkIEFXUyBDb2duaXRvIEpXVCBjbGFpbXNcbiAgICogT25seSBleHRyYWN0cyB3aGF0J3Mgb2ZmaWNpYWxseSBkb2N1bWVudGVkIGFuZCBhdmFpbGFibGUgaW4gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgKiBcbiAgICogQHBhcmFtIGNsYWltcyAtIENvZ25pdG8gSldUIGNsYWltcyBmcm9tIHRoZSBhdXRob3JpemVyXG4gICAqIEBwYXJhbSBhY3RvciAtIEFjdG9yIG9iamVjdCB0byBwb3B1bGF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBleHRyYWN0Q29nbml0b0NvbnRleHQoY2xhaW1zOiBhbnksIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2NvZ25pdG8nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3VzZXInO1xuICAgICAgXG4gICAgICAvLyBBY3RvciBJRCB3aXRoIGRvY3VtZW50ZWQgZmFsbGJhY2sgc3RyYXRlZ3k6IGNvZ25pdG86dXNlcm5hbWUgLT4gZW1haWwgLT4gc3ViXG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zWydjb2duaXRvOnVzZXJuYW1lJ10gfHwgY2xhaW1zLmVtYWlsIHx8IGNsYWltcy5zdWI7XG4gICAgICBcbiAgICAgIC8vIFN0YW5kYXJkIHVzZXIgYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBDb2duaXRvIHVzZXIgYXR0cmlidXRlcylcbiAgICAgIGFjdG9yLmVtYWlsID0gY2xhaW1zLmVtYWlsO1xuICAgICAgYWN0b3IuZW1haWxWZXJpZmllZCA9IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IucGhvbmVOdW1iZXIgPSBjbGFpbXMucGhvbmVfbnVtYmVyO1xuICAgICAgYWN0b3IucGhvbmVWZXJpZmllZCA9IGNsYWltcy5waG9uZV9udW1iZXJfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLm5hbWUgPSBjbGFpbXMubmFtZTtcbiAgICAgIGFjdG9yLmxvY2FsZSA9IGNsYWltcy5sb2NhbGU7XG4gICAgICBcbiAgICAgIC8vIFBhcnNlIENvZ25pdG8gZ3JvdXBzIChkb2N1bWVudGVkIGFzIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcpXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLnBhcnNlR3JvdXBzKGNsYWltc1snY29nbml0bzpncm91cHMnXSk7XG4gICAgICBcbiAgICAgIC8vIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXMgKGRvY3VtZW50ZWQgcGF0dGVybjogY3VzdG9tOiopXG4gICAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzID0gdGhpcy5leHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXMpO1xuICAgICAgXG4gICAgICAvLyBCdWlsZCBDb2duaXRvIGNvbnRleHQgd2l0aCBvbmx5IGRvY3VtZW50ZWQgZmllbGRzXG4gICAgICBhY3Rvci5jb2duaXRvID0ge1xuICAgICAgICBzdWI6IGNsYWltcy5zdWIsXG4gICAgICAgIHVzZXJuYW1lOiBjbGFpbXNbJ2NvZ25pdG86dXNlcm5hbWUnXSxcbiAgICAgICAgZ3JvdXBzOiBncm91cHMsIC8vIEFsd2F5cyBpbmNsdWRlIGdyb3VwcyBhcnJheSAoZW1wdHkgb3IgcG9wdWxhdGVkKVxuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzOiBPYmplY3Qua2V5cyhjdXN0b21BdHRyaWJ1dGVzKS5sZW5ndGggPiAwID8gY3VzdG9tQXR0cmlidXRlcyA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICAgIFxuICAgICAgLy8gRXh0cmFjdCB0ZW5hbnQgSUQgZnJvbSBjdXN0b20gYXR0cmlidXRlcyAoY29tbW9uIG11bHRpLXRlbmFudCBwYXR0ZXJuKVxuICAgICAgYWN0b3IudGVuYW50SWQgPSBjdXN0b21BdHRyaWJ1dGVzLnRlbmFudElkO1xuICAgICAgXG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICAgIFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdFcnJvciBleHRyYWN0aW5nIENvZ25pdG8gYWN0b3IgY29udGV4dCcsIHsgZXJyb3IsIGNsYWltcyB9KTtcbiAgICAgIFxuICAgICAgLy8gTWluaW1hbCBmYWxsYmFjayBleHRyYWN0aW9uXG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2NvZ25pdG8nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3VzZXInO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltcy5zdWIgfHwgJ3Vua25vd24nO1xuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlIENvZ25pdG8gZ3JvdXBzIGZyb20gY29tbWEtc2VwYXJhdGVkIHN0cmluZyAoZG9jdW1lbnRlZCBDb2duaXRvIGZvcm1hdClcbiAgICovXG4gIHByaXZhdGUgcGFyc2VHcm91cHMoZ3JvdXBzOiBhbnkpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHR5cGVvZiBncm91cHMgPT09ICdzdHJpbmcnICYmIGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZ3JvdXBzLnNwbGl0KCcsJykubWFwKGcgPT4gZy50cmltKCkpLmZpbHRlcihnID0+IGcubGVuZ3RoID4gMCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIHVzaW5nIGRvY3VtZW50ZWQgQ29nbml0byBwYXR0ZXJuIChjdXN0b206KilcbiAgICovXG4gIHByaXZhdGUgZXh0cmFjdEN1c3RvbUF0dHJpYnV0ZXMoY2xhaW1zOiBhbnkpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgXG4gICAgT2JqZWN0LmtleXMoY2xhaW1zKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoJ2N1c3RvbTonKSkge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0ga2V5LnJlcGxhY2UoJ2N1c3RvbTonLCAnJyk7XG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjbGFpbXNba2V5XTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gY3VzdG9tQXR0cmlidXRlcztcbiAgfVxuXG4gICAgLyoqXG4gICAqIEV4dHJhY3Qgc2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHQgLSBmb2N1c2VkIGFwcHJvYWNoXG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICAvLyBTZXNzaW9uIGNvbnRleHRcbiAgICBhY3Rvci5zZXNzaW9uSWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsneC1zZXNzaW9uLWlkJ107XG4gICAgXG4gICAgLy8gVGVuYW50IGNvbnRleHQgLSBjaGVjayBjdXN0b20gYXR0cmlidXRlcyBmaXJzdCwgdGhlbiBoZWFkZXJzXG4gICAgYWN0b3IudGVuYW50SWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsneC10ZW5hbnQtaWQnXSB8fCBcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcz8uWydjdXN0b206dGVuYW50SWQnXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IEFQSSBLZXkgY29udGV4dFxuICAgKi9cbiAgcHJpdmF0ZSBleHRyYWN0QXBpS2V5Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2FwaS1rZXknO1xuICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcbiAgICBcbiAgICBsZXQgYXBpS2V5SWQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlOiAncmVxdWVzdC1jb250ZXh0JyB8ICdoZWFkZXInO1xuICAgIFxuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSkge1xuICAgICAgYXBpS2V5SWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXlJZCB8fCBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXk7XG4gICAgICBzb3VyY2UgPSAncmVxdWVzdC1jb250ZXh0JztcbiAgICB9IGVsc2Uge1xuICAgICAgYXBpS2V5SWQgPSByZXF1ZXN0LmhlYWRlcnNbJ3gtYXBpLWtleSddITtcbiAgICAgIHNvdXJjZSA9ICdoZWFkZXInO1xuICAgIH1cbiAgICBcbiAgICBhY3Rvci5hY3RvcklkID0gYGFwaS1rZXk6JHthcGlLZXlJZH1gO1xuICAgIGFjdG9yLmFwaUtleSA9IHtcbiAgICAgIGlkOiBhcGlLZXlJZCxcbiAgICAgIHNvdXJjZTogc291cmNlLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBJQU0gY29udGV4dFxuICAgKi9cbiAgcHJpdmF0ZSBleHRyYWN0SWFtQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2lhbSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgIGFjdG9yLmFjdG9ySWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgXG4gICAgICAgICAgICAgICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8IFxuICAgICAgICAgICAgICAgICAgICd1bmtub3duLWlhbS11c2VyJztcbiAgICBcbiAgICBhY3Rvci5pYW0gPSB7XG4gICAgICB1c2VyQXJuOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgdW5kZWZpbmVkLFxuICAgICAgdXNlcklkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgdW5kZWZpbmVkLFxuICAgICAgYWNjb3VudElkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFjY291bnRJZCB8fCB1bmRlZmluZWQsXG4gICAgICBjYWxsZXI6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uY2FsbGVyIHx8IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG59XG4iXX0=