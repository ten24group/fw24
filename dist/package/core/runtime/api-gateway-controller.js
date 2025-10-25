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
const globalMiddlewares = new Set();
const useMiddleware = (middleware) => {
    globalMiddlewares.add(middleware);
};
exports.useMiddleware = useMiddleware;
const clearMiddlewares = () => {
    globalMiddlewares.clear();
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
    middlewares = new Set();
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
        this.middlewares.add(middleware);
    }
    getMiddlewares() {
        return [...Array.from(globalMiddlewares), ...Array.from(this.middlewares)];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFzREEsNENBeUJDO0FBN0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFZakgsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7QUFFM0QsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDLENBQUE7QUFGWSxRQUFBLGdCQUFnQixvQkFFNUI7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BSXFCLEVBQ3JCLE9BQXFGO0lBR3JGLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsWUFBRyxFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFHdkUsSUFBTSxvQkFBb0IsR0FBMUIsTUFBTSxvQkFBb0I7UUFFbEIsQUFBTixLQUFLLENBQUMsYUFBYTtZQUNqQixzREFBc0Q7UUFDeEQsQ0FBQztLQUNGLENBQUE7SUFITztRQURMLE1BQU0sQ0FBQyxJQUFJLENBQUM7NkRBR1o7SUFKRyxvQkFBb0I7UUFEekIsSUFBQSx1QkFBVSxF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LFNBQVM7WUFDN0QsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLElBQUksSUFBSSxTQUFTO1lBQ3pELFNBQVMsRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxTQUFTLElBQUksU0FBUztZQUNqRSxNQUFNLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsTUFBTSxJQUFJLFNBQVM7U0FDNUQsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQTdrQkQsc0NBNmtCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSwgUm91dGUgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgR2V0LCBSb3V0ZU1ldGhvZHMgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9tZXRob2RcIjtcbmltcG9ydCB7IERlZmF1bHRWYWxpZGF0b3IsIEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIElWYWxpZGF0b3IsIElucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlLCBpc0lucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvbi91dGlsc1wiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IFJlcXVlc3RDb250ZXh0IH0gZnJvbSBcIi4vcmVxdWVzdC1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbnRleHQgfSBmcm9tIFwiLi9yZXNwb25zZS1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbmZpZywgbWVyZ2VSZXNwb25zZUNvbmZpZyB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbmZpZ1wiO1xuaW1wb3J0IHsgVmFsaWRhdGlvbkZhaWxlZEVycm9yLCBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yLCBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vZXJyb3JzL1wiO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5cbmV4cG9ydCB0eXBlIENvbnRyb2xsZXJFcnJvckhhbmRsZXIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVFcnJvckhhbmRsZXI+O1xuXG4vLyBOZXcgaW50ZXJmYWNlcyBmb3IgbWlkZGxld2FyZSBhbmQgZXJyb3IgaGFuZGxpbmdcbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlck1pZGRsZXdhcmUge1xuICBiZWZvcmU/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBhZnRlcj86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIG9uRXJyb3I/OiAoZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG59XG5cbi8vIEdsb2JhbCBtaWRkbGV3YXJlIG1hbmFnZW1lbnRcbmNvbnN0IGdsb2JhbE1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuXG5leHBvcnQgY29uc3QgdXNlTWlkZGxld2FyZSA9IChtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5hZGQobWlkZGxld2FyZSk7XG59XG5leHBvcnQgY29uc3QgY2xlYXJNaWRkbGV3YXJlcyA9ICgpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMuY2xlYXIoKTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIEFQSSBoYW5kbGVyIHdpdGhvdXQgZGVmaW5pbmcgYSBjbGFzc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGV4cG9ydCBjb25zdCB7IGhhbmRsZXIsIGRlc2NyaXB0b3IgfSA9IGNyZWF0ZUFwaUhhbmRsZXIoXG4gKiAgeyBtZXRob2Q6IEdldCwgbmFtZTogJ2RlbW8nLCBhdXRob3JpemVyOiAnTk9ORScgfSxcbiAqICAgYXN5bmMgKCBldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAqICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICogICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAqICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiSGVsbG8gV29ybGQhXCJ9KVxuICogICAgICAgfSlcbiAqICAgfVxuICogKVxuICogYGBgXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5uYW1lIC0gVGhlIG5hbWUgb2YgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMucGF0aCAtIFRoZSBwYXRoIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5tZXRob2QgLSBUaGUgSFRUUCBtZXRob2QgZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBoYW5kbGVyIGZ1bmN0aW9uIGFuZCB0aGUgY29udHJvbGxlciBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXBpSGFuZGxlcihcbiAgb3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwYXRoPzogc3RyaW5nLFxuICAgIG1ldGhvZD86IFJvdXRlTWV0aG9kcyxcbiAgfSAmIElDb250cm9sbGVyQ29uZmlnLFxuICBoYW5kbGVyOiAoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCkgPT4gUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+LFxuKSB7XG5cbiAgY29uc3QgeyBuYW1lLCBwYXRoID0gJycsIG1ldGhvZCA9IEdldCwgLi4uY29udHJvbGxlckNvbmZpZyB9ID0gb3B0aW9ucztcblxuICBAQ29udHJvbGxlcihuYW1lLCB7IC4uLmNvbnRyb2xsZXJDb25maWcsIGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyOiBmYWxzZSB9KVxuICBjbGFzcyBDb250cm9sbGVyRGVzY3JpcHRvciB7XG4gICAgQG1ldGhvZChwYXRoKVxuICAgIGFzeW5jIGlubGluZUhhbmRsZXIoKSB7XG4gICAgICAvLyBwbGFjZWhvbGRlciBmdW5jdGlvbiBvbmx5IHVzZWQgZm9yIHJvdXRpbmcgbWV0YWRhdGFcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaGFuZGxlciwgJ25hbWUnLCB7IHZhbHVlOiAnaGFuZGxlcicgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBoYW5kbGVyLFxuICAgIGRlc2NyaXB0b3I6IENvbnRyb2xsZXJEZXNjcmlwdG9yXG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlckNvbmZpZyB7XG4gIHJlc3BvbnNlQ29uZmlnPzogUGFydGlhbDxSZXNwb25zZUNvbmZpZz47XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUElDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcHJvdGVjdGVkIG1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuICBwcm90ZWN0ZWQgcmVzcG9uc2VDb25maWc6IFJlc3BvbnNlQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogQVBJQ29udHJvbGxlckNvbmZpZyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQ29uZmlnID0gbWVyZ2VSZXNwb25zZUNvbmZpZyhjb25maWcucmVzcG9uc2VDb25maWcpO1xuICB9XG5cbiAgLyoqXG4gICAqIGNhbiBiZSB1c2VkIHRvIHJ1biBzb21lIGxvZ2ljIGp1c3QgYmVmb3JlIHRoZSByZXF1ZXN0IGlzIHByb2Nlc3NlZCBsaWtlIGNyZWF0aW5nIGNsaWVudHMsIGRpLWluamVjdGlvbiBhbnMgc28gb24uXG4gICAqIEBwYXJhbSBfZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gX2NvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGNvbnRyb2xsZXIgaXMgaW5pdGlhbGl6ZWQuXG4gICovXG4gIHByb3RlY3RlZCBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vLW9wIGZvciBBUEkgY29udHJvbGxlcnNcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgfVxuXG4gIC8vIEFkZCBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBtZXRob2RcbiAgcHJvdGVjdGVkIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpIHtcbiAgICB0aGlzLm1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpIHtcbiAgICByZXR1cm4gWyAuLi5BcnJheS5mcm9tKGdsb2JhbE1pZGRsZXdhcmVzKSwgLi4uQXJyYXkuZnJvbSh0aGlzLm1pZGRsZXdhcmVzKSBdO1xuICB9XG5cbiAgLy8gRXhlY3V0ZSBtaWRkbGV3YXJlIHBpcGVsaW5lXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShcbiAgICBwaGFzZTogJ2JlZm9yZScgfCAnYWZ0ZXInIHwgJ29uRXJyb3InLFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsXG4gICAgZXJyb3I/OiBFcnJvclxuICApOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGFsbE1pZGRsZXdhcmVzID0gdGhpcy5nZXRNaWRkbGV3YXJlcygpO1xuXG4gICAgZm9yIChjb25zdCBtaWRkbGV3YXJlIG9mIGFsbE1pZGRsZXdhcmVzKSB7XG4gICAgICBpZiAocGhhc2UgPT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlLm9uRXJyb3IgJiYgZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZS5vbkVycm9yKGVycm9yLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH0gZWxzZSBpZiAocGhhc2UgIT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlWyBwaGFzZSBdKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmVbIHBoYXNlIF0hKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfVxuICAgIH1cblxuICB9XG5cbiAgYXN5bmMgdmFsaWRhdGUocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QsIHZhbGlkYXRpb25zOiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgIGxldCB2YWxpZGF0aW9uUnVsZXM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB2YWxpZGF0aW9ucztcbiAgICBpZiAoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zKSkge1xuICAgICAgaWYgKFsgJ0dFVCcsICdERUxFVEUnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgcXVlcnk6IHZhbGlkYXRpb25zIH1cblxuICAgICAgfSBlbHNlIGlmIChbICdQT1NUJywgJ1BVVCcsICdQQVRDSCcgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBib2R5OiB2YWxpZGF0aW9ucyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvblJ1bGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IodmFsaWRhdGlvblJ1bGVzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7XG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHZhbGlkYXRpb25zOiB2YWxpZGF0aW9uUnVsZXMsXG4gICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLFxuICAgICAgdmVyYm9zZUVycm9yczogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IHRoaXMuZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPFJlcXVlc3Q+IHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZUNvbnRleHQoe1xuICAgICAgdHJhY2VJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgcmVxdWVzdElkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICBkZWJ1Z01vZGU6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIHJvdXRlOiByZXF1ZXN0Q29udGV4dC5wYXRoLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50JyxcbiAgICAgIGNvbmZpZzogdGhpcy5yZXNwb25zZUNvbmZpZ1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgY29udHJvbGxlci5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBBUEkgR2F0ZXdheSBldmVudHMuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgQVBJIEdhdGV3YXkgcmVzcG9uc2Ugb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKFwiTGFtYmRhSGFuZGxlciBSZWNlaXZlZCBldmVudDpcIiwgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdCk7XG5cbiAgICAvLyBCdWlsZCB0aGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICBjb25zdCBjdHggPSB0aGlzLmJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG5cbiAgICB0cnkge1xuXG4gICAgICAvLyBMZWdhY3kgaW5pdGlhbGl6ZSBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG5cbiAgICAgIC8vIEV4ZWN1dGUgYmVmb3JlIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIGNvbnN0IHJvdXRlID0gdGhpcy5maW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KTtcblxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlcXVlc3QgaWYgdmFsaWRhdGlvbnMgYXJlIGRlZmluZWRcbiAgICAgIGlmIChyb3V0ZT8udmFsaWRhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGUocmVxdWVzdCwgcm91dGUudmFsaWRhdGlvbnMpO1xuICAgICAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IodmFsaWRhdGlvblJlc3VsdC5lcnJvcnMpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIGNhbGwgdGhlIHJvdXRlIGZ1bmN0aW9uXG4gICAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpcy5nZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKTtcbiAgICAgIGxldCBjb250cm9sbGVyUmVzcG9uc2U6IGFueSA9IHJvdXRlRnVuY3Rpb24uY2FsbCh0aGlzLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgIGNvbnRyb2xsZXJSZXNwb25zZSA9IGF3YWl0IGNvbnRyb2xsZXJSZXNwb25zZTtcbiAgICAgIH1cblxuICAgICAgLy8gRXhlY3V0ZSBhZnRlciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2FmdGVyJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIC8vIElmIHRoZSBjb250cm9sbGVyIHJldHVybmVkIGFueXRoaW5nIChSZXNwb25zZUNvbnRleHQgb3IgcmF3IEFQSSByZXN1bHQpLCBlbWl0IHRoYXRcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgIT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShjb250cm9sbGVyUmVzcG9uc2UpO1xuICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG5cbiAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0xhbWJkYUhhbmRsZXIgZXJyb3I6ICcsIGVycm9yT2JqKTtcblxuICAgICAgLy8gRXhlY3V0ZSBlcnJvciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUV4Y2VwdGlvbihyZXF1ZXN0LCBlcnJvck9iaiwgcmVzcG9uc2UpO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBpbi1tZW1vcnkgcmVzcG9uc2VDb250ZXh0XG4gICAgcmV0dXJuIHJlc3BvbnNlLmJ1aWxkKCk7XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHJvdXRlIHRoYXQgbWF0Y2hlcyB0aGUgSFRUUCBtZXRob2QgYW5kIHJlc291cmNlLlxuICAgKiBAcGFyYW0gcmVxdWVzdERhdGEgLSBUaGUgcmVxdWVzdCBkYXRhIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIG1hdGNoaW5nIHJvdXRlIG9yIG51bGwgaWYgbm90IGZvdW5kLlxuICAgKi9cbiAgcHJpdmF0ZSBmaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCk6IFJvdXRlIHwgbnVsbCB7XG4gICAgbGV0IGNvbnRyb2xsZXI6IGFueSA9IHRoaXM7XG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbyhcIkNhbGxlZCBmaW5kTWF0Y2hpbmdSb3V0ZSB3aXRoIHJlcXVlc3REYXRhOiBcIiwgeyByZXF1ZXN0RGF0YSwgcm91dGVzOiBjb250cm9sbGVyLnJvdXRlcyB9KTtcblxuICAgIC8vIERldGVybWluZSB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggYnkgZmluZGluZyB0aGUgbG9uZ2VzdCBjb21tb24gcHJlZml4IHRoYXQgZW5kcyB3aXRoIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICBsZXQgY29udHJvbGxlckJhc2VQYXRoID0gYC8ke2NvbnRyb2xsZXIuY29udHJvbGxlck5hbWV9YDtcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0Um9vdCA9ICcvJztcblxuICAgIC8vIEZvciBjb250cm9sbGVycyBpbiBzdWJkaXJlY3Rvcmllcywgd2UgbmVlZCB0byBtYXRjaCB0aGUgYWN0dWFsIHJlc291cmNlIHBhdGhcbiAgICAvLyBDaGVjayBpZiByZXNvdXJjZSBjb250YWlucyB0aGUgY29udHJvbGxlciBuYW1lIGFzIHBhcnQgb2YgYSBsb25nZXIgcGF0aFxuICAgIGNvbnN0IHJlc291cmNlUGFydHMgPSByZXF1ZXN0RGF0YS5yZXNvdXJjZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZVBhcnRzID0gY29udHJvbGxlci5jb250cm9sbGVyTmFtZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcblxuICAgIC8vIEZpbmQgaWYgdGhlIGNvbnRyb2xsZXIgbmFtZSBwYXJ0cyBhcmUgcHJlc2VudCBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgIGxldCBiYXNlUGF0aEVuZEluZGV4ID0gLTE7XG4gICAgaWYgKGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gTG9vayBmb3IgdGhlIGNvbnRyb2xsZXIgbmFtZSBzZXF1ZW5jZSBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gcmVzb3VyY2VQYXJ0cy5sZW5ndGggLSBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxldCBtYXRjaGVzID0gdHJ1ZTtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgaWYgKHJlc291cmNlUGFydHNbIGkgKyBqIF0gIT09IGNvbnRyb2xsZXJOYW1lUGFydHNbIGogXSkge1xuICAgICAgICAgICAgbWF0Y2hlcyA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgYmFzZVBhdGhFbmRJbmRleCA9IGkgKyBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmFzZVBhdGhFbmRJbmRleCA+PSAwKSB7XG4gICAgICAvLyBGb3VuZCB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggaW4gdGhlIHJlc291cmNlXG4gICAgICBjb25zdCBiYXNlUGF0aFBhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZSgwLCBiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICBjb250cm9sbGVyQmFzZVBhdGggPSAnLycgKyBiYXNlUGF0aFBhcnRzLmpvaW4oJy8nKTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ1BhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZShiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVtYWluaW5nUGFydHMubGVuZ3RoID4gMCA/ICcvJyArIHJlbWFpbmluZ1BhcnRzLmpvaW4oJy8nKSA6ICcvJztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmFsbGJhY2sgdG8gb3JpZ2luYWwgbG9naWMgZm9yIHNpbXBsZSBjYXNlc1xuICAgICAgaWYgKHJlcXVlc3REYXRhLnJlc291cmNlLnN0YXJ0c1dpdGgoY29udHJvbGxlckJhc2VQYXRoKSkge1xuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3Vic3RyaW5nKGNvbnRyb2xsZXJCYXNlUGF0aC5sZW5ndGgpIHx8ICcvJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKCdjb250cm9sbGVyQmFzZVBhdGg6ICcsIGNvbnRyb2xsZXJCYXNlUGF0aCk7XG4gICAgLy8gdGhpcy5sb2dnZXIuaW5mbygncmVzb3VyY2VXaXRob3V0Um9vdDogJywgcmVzb3VyY2VXaXRob3V0Um9vdCk7XG5cbiAgICAvLyBTZXBhcmF0ZSByb3V0ZXMgaW50byBleGFjdCBhbmQgcGFyYW1ldGVyaXplZCBmb3IgcHJvcGVyIHByaW9yaXRpemF0aW9uXG4gICAgY29uc3QgZXhhY3RNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuICAgIGNvbnN0IHBhcmFtZXRlcml6ZWRNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuXG4gICAgLy8gRmlyc3QgcGFzczogY2F0ZWdvcml6ZSByb3V0ZXMgYnkgdHlwZSBhbmQgbWV0aG9kXG4gICAgZm9yIChjb25zdCBbIHJvdXRlS2V5LCByb3V0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRyb2xsZXIucm91dGVzIHx8IHt9KSBhcyBbIHN0cmluZywgUm91dGUgXVtdKSB7XG4gICAgICBjb25zdCBbIHJvdXRlTWV0aG9kLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIC8vIFNraXAgaWYgSFRUUCBtZXRob2QgZG9lc24ndCBtYXRjaFxuICAgICAgaWYgKHJvdXRlTWV0aG9kICE9PSByZXF1ZXN0RGF0YS5odHRwTWV0aG9kKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXRlZ29yaXplIHJvdXRlIHR5cGVcbiAgICAgIGlmIChyb3V0ZVBhdGguaW5jbHVkZXMoJ3snKSAmJiByb3V0ZVBhdGguaW5jbHVkZXMoJ30nKSkge1xuICAgICAgICBwYXJhbWV0ZXJpemVkTWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhhY3RNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2Vjb25kIHBhc3M6IFRyeSBleGFjdCBtYXRjaGVzIGZpcnN0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUgfSBvZiBleGFjdE1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmIChyb3V0ZVBhdGggPT09IHJlc291cmNlV2l0aG91dFJvb3QpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRm91bmQgZXhhY3QgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWApO1xuICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVGhpcmQgcGFzczogVHJ5IHBhcmFtZXRlcml6ZWQgbWF0Y2hlcyAoc29ydGVkIGJ5IHNwZWNpZmljaXR5KVxuICAgIC8vIFNvcnQgcGFyYW1ldGVyaXplZCByb3V0ZXMgYnkgc3BlY2lmaWNpdHkgKG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBwcmlvcml0eSlcbiAgICBjb25zdCBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcyA9IHBhcmFtZXRlcml6ZWRNYXRjaGVzXG4gICAgICAubWFwKCh7IHJvdXRlS2V5LCByb3V0ZSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG4gICAgICAgIGNvbnN0IHNlZ21lbnRzID0gcm91dGVQYXRoLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICBjb25zdCBsaXRlcmFsU2VnbWVudHMgPSBzZWdtZW50cy5maWx0ZXIoc2VnbWVudCA9PiAhc2VnbWVudC5pbmNsdWRlcygneycpKTtcblxuICAgICAgICAvLyBTcGVjaWZpY2l0eSBzY29yZTogbW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlXG4gICAgICAgIC8vIEZvciBlcXVhbCBsaXRlcmFsIHNlZ21lbnRzLCBmZXdlciB0b3RhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZSAgXG4gICAgICAgIGNvbnN0IHNwZWNpZmljaXR5U2NvcmUgPSAobGl0ZXJhbFNlZ21lbnRzLmxlbmd0aCAqIDEwMDApIC0gc2VnbWVudHMubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoLCBzcGVjaWZpY2l0eVNjb3JlIH07XG4gICAgICB9KVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGIuc3BlY2lmaWNpdHlTY29yZSAtIGEuc3BlY2lmaWNpdHlTY29yZSk7IC8vIEhpZ2hlciBzY29yZSBmaXJzdFxuXG4gICAgZm9yIChjb25zdCB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoIH0gb2Ygc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMpIHtcbiAgICAgIC8vIENvbnZlcnQgZnJhbWV3b3JrIHtpZH0gc3ludGF4IHRvIHBhdGgtdG8tcmVnZXhwIDppZCBzeW50YXhcbiAgICAgIGNvbnN0IHBhdGhUb1JlZ2V4cFBhdHRlcm4gPSByb3V0ZVBhdGgucmVwbGFjZSgvXFx7KFtefV0rKVxcfS9nLCAnOiQxJyk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFVzZSBwYXRoLXRvLXJlZ2V4cCBmb3IgcHJvcGVyIHBhcmFtZXRlciBtYXRjaGluZ1xuICAgICAgICBjb25zdCB7IG1hdGNoIH0gPSByZXF1aXJlKCdwYXRoLXRvLXJlZ2V4cCcpO1xuICAgICAgICBjb25zdCBtYXRjaGVyID0gbWF0Y2gocGF0aFRvUmVnZXhwUGF0dGVybiwgeyBkZWNvZGU6IGRlY29kZVVSSUNvbXBvbmVudCB9KTtcbiAgICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBtYXRjaGVyKHJlc291cmNlV2l0aG91dFJvb3QpO1xuXG4gICAgICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZvdW5kIHBhcmFtZXRlcml6ZWQgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWAsIHtcbiAgICAgICAgICAgIHBhdHRlcm46IHBhdGhUb1JlZ2V4cFBhdHRlcm4sXG4gICAgICAgICAgICBwYXJhbXM6IG1hdGNoUmVzdWx0LnBhcmFtcyxcbiAgICAgICAgICAgIHNwZWNpZmljaXR5U2NvcmU6IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzLmZpbmQobSA9PiBtLnJvdXRlS2V5ID09PSByb3V0ZUtleSk/LnNwZWNpZmljaXR5U2NvcmVcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIE5vdGU6IFdlIGRvbid0IG5lZWQgdG8gbWFudWFsbHkgZXh0cmFjdCBwYXJhbWV0ZXJzIHNpbmNlIEFQSSBHYXRld2F5XG4gICAgICAgICAgLy8gYWxyZWFkeSBwcm92aWRlcyB0aGVtIGluIHJlcXVlc3REYXRhLnBhdGhQYXJhbWV0ZXJzXG4gICAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFcnJvciBtYXRjaGluZyByb3V0ZSBwYXR0ZXJuICR7cGF0aFRvUmVnZXhwUGF0dGVybn06YCwgZXJyb3IpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBtYXRjaGluZyByb3V0ZSBmb3VuZCBmb3IgJHtyZXF1ZXN0RGF0YS5odHRwTWV0aG9kfXwke3Jlc291cmNlV2l0aG91dFJvb3R9YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKiBAcGFyYW0gcm91dGUgLSBUaGUgbWF0Y2hlZCByb3V0ZS5cbiAgICogQHJldHVybnMgVGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqL1xuICBwcml2YXRlIGdldFJvdXRlRnVuY3Rpb24ocm91dGU6IFJvdXRlIHwgbnVsbCk6IEZ1bmN0aW9uIHtcbiAgICBpZiAoIXJvdXRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICAgIH1cblxuICAgIC8vQHRzLWlnbm9yZVxuICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzWyByb3V0ZS5mdW5jdGlvbk5hbWUgXTtcblxuICAgIHJldHVybiB0eXBlb2Ygcm91dGVGdW5jdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gcm91dGVGdW5jdGlvbiA6IHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIHRoZSBOb3RGb3VuZCByb3V0ZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDQwNCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVOb3RGb3VuZChfcmVxOiBSZXF1ZXN0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZSh7XG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiTm8gUm91dGUgRm91bmQhXCIgfSksXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZXJyb3JIYW5kbGVyPzogQ29udHJvbGxlckVycm9ySGFuZGxlcjtcbiAgcHJvdGVjdGVkIGdldEVycm9ySGFuZGxlcigpOiBDb250cm9sbGVyRXJyb3JIYW5kbGVyIHtcbiAgICBpZiAoIXRoaXMuZXJyb3JIYW5kbGVyKSB7XG4gICAgICB0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcigpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5lcnJvckhhbmRsZXI7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBleGNlcHRpb25zIGFuZCByZXR1cm5zIGEgSlNPTiByZXNwb25zZSB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHBhcmFtIGVyciAtIFRoZSBlcnJvciBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDUwMCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVFeGNlcHRpb24ocmVxOiBSZXF1ZXN0LCBlcnI6IEVycm9yLCByZXM6IFJlc3BvbnNlKTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlID0gdGhpcy5nZXRFcnJvckhhbmRsZXIoKShlcnIsIHJlcSwgcmVzKTtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShlcnJvclJlc3BvbnNlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBoYW5kbGVSZXNwb25zZShyZXM6IFJlc3BvbnNlIHwgQVBJR2F0ZXdheVByb3h5UmVzdWx0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBpZiAocmVzIGluc3RhbmNlb2YgUmVzcG9uc2VDb250ZXh0KSB7XG4gICAgICByZXR1cm4gcmVzLmJ1aWxkKCk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGVjdXRpb24gY29udGV4dCBmb3IgdGhlIHJlcXVlc3RcbiAgICogXG4gICAqIGRpZmZlcmVudCBtaWRkbGV3YXJlIGNhbiBlbmhhbmNlIHRoZSBhY3RvciBjb250ZXh0IGJ5IHVzaW5nIHRoZSBlbmhhbmNlQWN0b3IgbWV0aG9kXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlID0ge1xuICAgKiAgYmVmb3JlOiBhc3luYyAoX3JlcXVlc3QsIF9yZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgY3R4Py5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICByb2xlczogWydhZG1pbicsICd1c2VyJ10sXG4gICAqICAgICBwZXJtaXNzaW9uczogWydyZWFkJywgJ3dyaXRlJ10sXG4gICAqICAgICBzdWJzY3JpcHRpb246IHsgdGllcjogJ2VudGVycHJpc2UnIH1cbiAgICogICB9KTtcbiAgICogIH1cbiAgICogfVxuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmUpO1xuICAgKiBcbiAgICogT1JcbiAgICogXG4gICAqIGNvbnN0IHNlY3VyaXR5TWlkZGxld2FyZSA9IHtcbiAgICogICBiZWZvcmU6IGFzeW5jIChyZXF1ZXN0LCByZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgICBjdHguZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgICByaXNrUHJvZmlsZTogYXdhaXQgYXNzZXNzUmlzayhjdHguYWN0b3IuYWN0b3JJZCksXG4gICAqICAgICAgIGRldmljZTogYXdhaXQgbWFrZURldmljZUNvbnRleHQocmVxdWVzdClcbiAgICogICAgIH0pO1xuICAgKiAgIH1cbiAgICogfTtcbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShzZWN1cml0eU1pZGRsZXdhcmUpO1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgXG4gICAqIEBwYXJhbSBjb250ZXh0IFxuICAgKiBAcGFyYW0gcmVxdWVzdCBcbiAgICogQHBhcmFtIHJlc3BvbnNlIFxuICAgKiBAcmV0dXJucyBcbiAgICovXG4gIHByb3RlY3RlZCBidWlsZEN0eChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgICBjb25zdCBhY3RvciA9IHRoaXMuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG4gICAgXG4gICAgY29uc3QgY3R4OiBFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgZXZlbnQsXG4gICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgYWN0b3IsXG4gICAgICBkZWJ1Z0luZm86IHt9LFxuICAgICAgXG4gICAgICAvLyBTaW1wbGUgYWN0b3IgZW5oYW5jZW1lbnQgbWV0aG9kXG4gICAgICBlbmhhbmNlQWN0b3I6IChlbmhhbmNlbWVudDogUGFydGlhbDxBY3Rvcj4pID0+IHtcbiAgICAgICAgaWYgKGN0eC5hY3Rvcikge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oY3R4LmFjdG9yLCBlbmhhbmNlbWVudCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIGN0eDtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhY3RvciBjb250ZXh0IGZyb20gdGhlIHJlcXVlc3RcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgZm9yIGN1c3RvbSBhY3RvciBleHRyYWN0aW9uIGxvZ2ljXG4gICAqXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSByZXF1ZXN0IC0gVGhlIHJlcXVlc3Qgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgYWN0b3IgY29udGV4dC5cbiAgICogYGBgXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcbiAgICBcbiAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICByZXF1ZXN0SWQsXG4gICAgICB0aW1lc3RhbXAsXG4gICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVycz8uWyd1c2VyLWFnZW50J10gfHwgZXZlbnQuaGVhZGVycz8uWydVc2VyLUFnZW50J10sXG4gICAgICBjb3JyZWxhdGlvbklkOiByZXF1ZXN0LmhlYWRlcnM/LlsneC1jb3JyZWxhdGlvbi1pZCddIHx8IHJlcXVlc3RJZCxcbiAgICB9O1xuXG4gICAgLy8gQ29nbml0byBhdXRoZW50aWNhdGlvbiB3aXRoIGZvY3VzZWQgZW5oYW5jZW1lbnRzXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXMpIHtcbiAgICAgIHRoaXMuZXh0cmFjdENvZ25pdG9Db250ZXh0KGV2ZW50LnJlcXVlc3RDb250ZXh0LmF1dGhvcml6ZXIuY2xhaW1zLCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFQSSBLZXkgYXV0aGVudGljYXRpb25cbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSB8fCByZXF1ZXN0LmhlYWRlcnM/LlsneC1hcGkta2V5J10pIHtcbiAgICAgIHRoaXMuZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gSUFNIGF1dGhlbnRpY2F0aW9uIFxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybikge1xuICAgICAgdGhpcy5leHRyYWN0SWFtQ29udGV4dChldmVudCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBbm9ueW1vdXNcbiAgICBlbHNlIHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9ICdhbm9ueW1vdXMnO1xuICAgIH1cblxuICAgIC8vIFNlc3Npb24gYW5kIHRlbmFudCBjb250ZXh0XG4gICAgdGhpcy5leHRyYWN0U2Vzc2lvbkFuZFRlbmFudENvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcbiAgICBcbiAgICAvLyBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAgYWN0b3IuYXBpU3RhZ2UgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uc3RhZ2U7XG4gICAgYWN0b3IuYXBpSWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXBpSWQ7XG4gICAgXG4gICAgcmV0dXJuIGFjdG9yO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQ29nbml0byBhY3RvciBjb250ZXh0IGJhc2VkIG9uIGRvY3VtZW50ZWQgQVdTIENvZ25pdG8gSldUIGNsYWltc1xuICAgKiBPbmx5IGV4dHJhY3RzIHdoYXQncyBvZmZpY2lhbGx5IGRvY3VtZW50ZWQgYW5kIGF2YWlsYWJsZSBpbiBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAqIFxuICAgKiBAcGFyYW0gY2xhaW1zIC0gQ29nbml0byBKV1QgY2xhaW1zIGZyb20gdGhlIGF1dGhvcml6ZXJcbiAgICogQHBhcmFtIGFjdG9yIC0gQWN0b3Igb2JqZWN0IHRvIHBvcHVsYXRlXG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RDb2duaXRvQ29udGV4dChjbGFpbXM6IGFueSwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBcbiAgICAgIC8vIEFjdG9yIElEIHdpdGggZG9jdW1lbnRlZCBmYWxsYmFjayBzdHJhdGVneTogY29nbml0bzp1c2VybmFtZSAtPiBlbWFpbCAtPiBzdWJcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXNbJ2NvZ25pdG86dXNlcm5hbWUnXSB8fCBjbGFpbXMuZW1haWwgfHwgY2xhaW1zLnN1YjtcbiAgICAgIFxuICAgICAgLy8gU3RhbmRhcmQgdXNlciBhdHRyaWJ1dGVzIChkb2N1bWVudGVkIENvZ25pdG8gdXNlciBhdHRyaWJ1dGVzKVxuICAgICAgYWN0b3IuZW1haWwgPSBjbGFpbXMuZW1haWw7XG4gICAgICBhY3Rvci5lbWFpbFZlcmlmaWVkID0gY2xhaW1zLmVtYWlsX3ZlcmlmaWVkID09PSAndHJ1ZSc7XG4gICAgICBhY3Rvci5waG9uZU51bWJlciA9IGNsYWltcy5waG9uZV9udW1iZXI7XG4gICAgICBhY3Rvci5waG9uZVZlcmlmaWVkID0gY2xhaW1zLnBob25lX251bWJlcl92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IubmFtZSA9IGNsYWltcy5uYW1lO1xuICAgICAgYWN0b3IubG9jYWxlID0gY2xhaW1zLmxvY2FsZTtcbiAgICAgIFxuICAgICAgLy8gUGFyc2UgQ29nbml0byBncm91cHMgKGRvY3VtZW50ZWQgYXMgY29tbWEtc2VwYXJhdGVkIHN0cmluZylcbiAgICAgIGNvbnN0IGdyb3VwcyA9IHRoaXMucGFyc2VHcm91cHMoY2xhaW1zWydjb2duaXRvOmdyb3VwcyddKTtcbiAgICAgIFxuICAgICAgLy8gRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBwYXR0ZXJuOiBjdXN0b206KilcbiAgICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXMgPSB0aGlzLmV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltcyk7XG4gICAgICBcbiAgICAgIC8vIEJ1aWxkIENvZ25pdG8gY29udGV4dCB3aXRoIG9ubHkgZG9jdW1lbnRlZCBmaWVsZHNcbiAgICAgIGFjdG9yLmNvZ25pdG8gPSB7XG4gICAgICAgIHN1YjogY2xhaW1zLnN1YixcbiAgICAgICAgdXNlcm5hbWU6IGNsYWltc1snY29nbml0bzp1c2VybmFtZSddLFxuICAgICAgICBncm91cHM6IGdyb3VwcywgLy8gQWx3YXlzIGluY2x1ZGUgZ3JvdXBzIGFycmF5IChlbXB0eSBvciBwb3B1bGF0ZWQpXG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IE9iamVjdC5rZXlzKGN1c3RvbUF0dHJpYnV0ZXMpLmxlbmd0aCA+IDAgPyBjdXN0b21BdHRyaWJ1dGVzIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgICAgXG4gICAgICAvLyBFeHRyYWN0IHRlbmFudCBJRCBmcm9tIGN1c3RvbSBhdHRyaWJ1dGVzIChjb21tb24gbXVsdGktdGVuYW50IHBhdHRlcm4pXG4gICAgICBhY3Rvci50ZW5hbnRJZCA9IGN1c3RvbUF0dHJpYnV0ZXMudGVuYW50SWQ7XG4gICAgICBcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0Vycm9yIGV4dHJhY3RpbmcgQ29nbml0byBhY3RvciBjb250ZXh0JywgeyBlcnJvciwgY2xhaW1zIH0pO1xuICAgICAgXG4gICAgICAvLyBNaW5pbWFsIGZhbGxiYWNrIGV4dHJhY3Rpb25cbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zLnN1YiB8fCAndW5rbm93bic7XG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2UgQ29nbml0byBncm91cHMgZnJvbSBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nIChkb2N1bWVudGVkIENvZ25pdG8gZm9ybWF0KVxuICAgKi9cbiAgcHJpdmF0ZSBwYXJzZUdyb3Vwcyhncm91cHM6IGFueSk6IHN0cmluZ1tdIHtcbiAgICBpZiAodHlwZW9mIGdyb3VwcyA9PT0gJ3N0cmluZycgJiYgZ3JvdXBzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBncm91cHMuc3BsaXQoJywnKS5tYXAoZyA9PiBnLnRyaW0oKSkuZmlsdGVyKGcgPT4gZy5sZW5ndGggPiAwKTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXMgdXNpbmcgZG9jdW1lbnRlZCBDb2duaXRvIHBhdHRlcm4gKGN1c3RvbToqKVxuICAgKi9cbiAgcHJpdmF0ZSBleHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXM6IGFueSk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBcbiAgICBPYmplY3Qua2V5cyhjbGFpbXMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGlmIChrZXkuc3RhcnRzV2l0aCgnY3VzdG9tOicpKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBrZXkucmVwbGFjZSgnY3VzdG9tOicsICcnKTtcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGNsYWltc1trZXldO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBjdXN0b21BdHRyaWJ1dGVzO1xuICB9XG5cbiAgICAvKipcbiAgICogRXh0cmFjdCBzZXNzaW9uIGFuZCB0ZW5hbnQgY29udGV4dCAtIGZvY3VzZWQgYXBwcm9hY2hcbiAgICovXG4gIHByaXZhdGUgZXh0cmFjdFNlc3Npb25BbmRUZW5hbnRDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIC8vIFNlc3Npb24gY29udGV4dFxuICAgIGFjdG9yLnNlc3Npb25JZCA9IHJlcXVlc3QuaGVhZGVycz8uWyd4LXNlc3Npb24taWQnXTtcbiAgICBcbiAgICAvLyBUZW5hbnQgY29udGV4dCAtIGNoZWNrIGN1c3RvbSBhdHRyaWJ1dGVzIGZpcnN0LCB0aGVuIGhlYWRlcnNcbiAgICBhY3Rvci50ZW5hbnRJZCA9IHJlcXVlc3QuaGVhZGVycz8uWyd4LXRlbmFudC1pZCddIHx8IFxuICAgICAgICAgICAgICAgICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zPy5bJ2N1c3RvbTp0ZW5hbnRJZCddO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQVBJIEtleSBjb250ZXh0XG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYXBpLWtleSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgIFxuICAgIGxldCBhcGlLZXlJZDogc3RyaW5nO1xuICAgIGxldCBzb3VyY2U6ICdyZXF1ZXN0LWNvbnRleHQnIHwgJ2hlYWRlcic7XG4gICAgXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5KSB7XG4gICAgICBhcGlLZXlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleUlkIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleTtcbiAgICAgIHNvdXJjZSA9ICdyZXF1ZXN0LWNvbnRleHQnO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcGlLZXlJZCA9IHJlcXVlc3QuaGVhZGVyc1sneC1hcGkta2V5J10hO1xuICAgICAgc291cmNlID0gJ2hlYWRlcic7XG4gICAgfVxuICAgIFxuICAgIGFjdG9yLmFjdG9ySWQgPSBgYXBpLWtleToke2FwaUtleUlkfWA7XG4gICAgYWN0b3IuYXBpS2V5ID0ge1xuICAgICAgaWQ6IGFwaUtleUlkLFxuICAgICAgc291cmNlOiBzb3VyY2UsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IElBTSBjb250ZXh0XG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RJYW1Db250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnaWFtJztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG4gICAgYWN0b3IuYWN0b3JJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fCBcbiAgICAgICAgICAgICAgICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgXG4gICAgICAgICAgICAgICAgICAgJ3Vua25vd24taWFtLXVzZXInO1xuICAgIFxuICAgIGFjdG9yLmlhbSA9IHtcbiAgICAgIHVzZXJBcm46IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybiB8fCB1bmRlZmluZWQsXG4gICAgICB1c2VySWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fCB1bmRlZmluZWQsXG4gICAgICBhY2NvdW50SWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYWNjb3VudElkIHx8IHVuZGVmaW5lZCxcbiAgICAgIGNhbGxlcjogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5jYWxsZXIgfHwgdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cbn1cbiJdfQ==