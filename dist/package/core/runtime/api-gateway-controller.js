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
const audit_helpers_1 = require("../../audit/helpers/audit-helpers");
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
        const request = await this.makeRequestContext(event, context);
        const response = await this.makeResponseContext(request);
        // Build the execution context
        const ctx = this.buildCtx(event, context, request, response);
        // Create audit context
        const auditContext = this.makeAuditContext(ctx);
        if (auditContext) {
            await this.captureStart(auditContext, this.buildRequestContext(ctx, auditContext.auditConfig));
        }
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
            // Capture successful response
            if (auditContext) {
                await this.captureEnd(auditContext, response, null);
            }
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
            // Capture error response
            if (auditContext) {
                await this.captureEnd(auditContext, response, errorObj);
            }
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
                this.logger.debug(`Found exact match for route: ${routeKey}`);
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
                    this.logger.debug(`Found parameterized match for route: ${routeKey}`, {
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
     * Creates audit context for the request following the existing buildCtx pattern
     * @param ctx - The execution context
     * @returns AuditContext or null if audit is disabled
     */
    makeAuditContext(ctx) {
        const config = this.getControllerConfig();
        if (!config?.audit?.enabled)
            return null;
        const correlationId = ctx.actor?.correlationId ||
            ctx.request.headers?.['x-correlation-id'] ||
            ctx.request.requestId;
        const operationName = `${ctx.request.httpMethod.toLowerCase()}_${ctx.request.path}`;
        const operationId = `${this.constructor.name}.${operationName}`;
        return {
            enabled: true,
            logType: 'log',
            subType: 'api_request',
            entityName: this.constructor.name,
            operation: operationName,
            category: config.audit.category,
            actor: ctx.actor,
            correlation: {
                correlationId,
                operationId,
                parentOperationId: ctx.request.headers?.['x-parent-operation-id'],
                operationType: 'api',
                operationName,
                startTimestamp: new Date().toISOString()
            },
            auditConfig: config.audit
        };
    }
    /**
     * Captures audit log for request start
     */
    async captureStart(auditContext, requestContext) {
        await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
    }
    /**
     * Captures audit log for request end (success or error)
     */
    async captureEnd(auditContext, response, error) {
        const responseContext = {
            statusCode: response.statusCode,
            responseSize: response.body?.length || 0,
            response: this.buildResponseContext(response, auditContext.auditConfig)
        };
        await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, error, responseContext);
    }
    /**
     * Builds request context for audit logging
     */
    buildRequestContext(ctx, auditConfig) {
        const includes = Array.isArray(auditConfig.includes?.request)
            ? auditConfig.includes.request
            : auditConfig.includes?.request ? ['headers'] : [];
        return {
            method: ctx.request.httpMethod,
            path: ctx.request.path,
            userAgent: ctx.event.headers?.['user-agent'],
            sourceIp: ctx.event.requestContext?.identity?.sourceIp,
            headers: includes.includes('headers') ? ctx.request.headers : undefined,
            body: includes.includes('body') ? ctx.request.body : undefined,
            query: includes.includes('query') ? ctx.request.queryStringParameters : undefined
        };
    }
    /**
     * Builds response context for audit logging
     */
    buildResponseContext(response, auditConfig) {
        if (!auditConfig.includes?.response)
            return undefined;
        const includes = Array.isArray(auditConfig.includes.response)
            ? auditConfig.includes.response
            : ['headers'];
        return {
            statusCode: response.statusCode,
            headers: includes.includes('headers') ? response.headers : undefined,
            body: includes.includes('body') ? response.body : undefined
        };
    }
    /**
     * Gets the controller configuration
     */
    getControllerConfig() {
        return Reflect.get(this, 'controllerConfig') || {};
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUF3REEsNENBeUJDO0FBL0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFHakgscUVBQXdFO0FBV3hFLCtCQUErQjtBQUMvQixNQUFNLGlCQUFpQixHQUE4QixFQUFFLENBQUM7QUFFakQsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FDOUIsT0FJcUIsRUFDckIsT0FBcUY7SUFHckYsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxZQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUd2RSxJQUFNLG9CQUFvQixHQUExQixNQUFNLG9CQUFvQjtRQUVsQixBQUFOLEtBQUssQ0FBQyxhQUFhO1lBQ2pCLHNEQUFzRDtRQUN4RCxDQUFDO0tBQ0YsQ0FBQTtJQUhPO1FBREwsTUFBTSxDQUFDLElBQUksQ0FBQzs2REFHWjtJQUpHLG9CQUFvQjtRQUR6QixJQUFB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USxFQUFFLENBQUM7UUFDdEMsS0FBSyxDQUFDLE1BQU0sR0FBRztZQUNiLEVBQUUsRUFBRSxRQUFRO1lBQ1osTUFBTSxFQUFFLE1BQU07U0FDZixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ08saUJBQWlCLENBQUMsS0FBc0IsRUFBRSxLQUFZO1FBQzlELEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDO1FBQ3pCLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzVCLEtBQUssQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsSUFBSTtZQUNyQyxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxPQUFPO1lBQ3ZDLGtCQUFrQixDQUFDO1FBRWxDLEtBQUssQ0FBQyxHQUFHLEdBQUc7WUFDVixPQUFPLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTyxJQUFJLFNBQVM7WUFDN0QsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLElBQUksSUFBSSxTQUFTO1lBQ3pELFNBQVMsRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxTQUFTLElBQUksU0FBUztZQUNqRSxNQUFNLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsTUFBTSxJQUFJLFNBQVM7U0FDNUQsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQTVyQkQsc0NBNHJCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSwgUm91dGUgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgR2V0LCBSb3V0ZU1ldGhvZHMgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9tZXRob2RcIjtcbmltcG9ydCB7IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIElucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlLCBpc0lucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvbi91dGlsc1wiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IFJlcXVlc3RDb250ZXh0IH0gZnJvbSBcIi4vcmVxdWVzdC1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbnRleHQgfSBmcm9tIFwiLi9yZXNwb25zZS1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbmZpZywgbWVyZ2VSZXNwb25zZUNvbmZpZyB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbmZpZ1wiO1xuaW1wb3J0IHsgVmFsaWRhdGlvbkZhaWxlZEVycm9yLCBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yLCBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vZXJyb3JzL1wiO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBBdWRpdENvbnRleHQsIFJlcXVlc3RBdWRpdENvbnRleHQsIEF1ZGl0Q29uZmlnIH0gZnJvbSAnLi4vLi4vYXVkaXQvaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBdWRpdENhcHR1cmVTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vYXVkaXQvaGVscGVycy9hdWRpdC1oZWxwZXJzJztcblxuZXhwb3J0IHR5cGUgQ29udHJvbGxlckVycm9ySGFuZGxlciA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZUVycm9ySGFuZGxlcj47XG5cbi8vIE5ldyBpbnRlcmZhY2VzIGZvciBtaWRkbGV3YXJlIGFuZCBlcnJvciBoYW5kbGluZ1xuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyTWlkZGxld2FyZSB7XG4gIGJlZm9yZT86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIGFmdGVyPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgb25FcnJvcj86IChlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuLy8gR2xvYmFsIG1pZGRsZXdhcmUgbWFuYWdlbWVudFxuY29uc3QgZ2xvYmFsTWlkZGxld2FyZXM6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlW10gPSBbXTtcblxuZXhwb3J0IGNvbnN0IHVzZU1pZGRsZXdhcmUgPSAobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMucHVzaChtaWRkbGV3YXJlKTtcbn1cbmV4cG9ydCBjb25zdCBjbGVhck1pZGRsZXdhcmVzID0gKCkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5sZW5ndGggPSAwO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gQVBJIGhhbmRsZXIgd2l0aG91dCBkZWZpbmluZyBhIGNsYXNzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogZXhwb3J0IGNvbnN0IHsgaGFuZGxlciwgZGVzY3JpcHRvciB9ID0gY3JlYXRlQXBpSGFuZGxlcihcbiAqICB7IG1ldGhvZDogR2V0LCBuYW1lOiAnZGVtbycsIGF1dGhvcml6ZXI6ICdOT05FJyB9LFxuICogICBhc3luYyAoIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICogICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gKiAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICogICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJIZWxsbyBXb3JsZCFcIn0pXG4gKiAgICAgICB9KVxuICogICB9XG4gKiApXG4gKiBgYGBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5wYXRoIC0gVGhlIHBhdGggZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgZnVuY3Rpb24gYW5kIHRoZSBjb250cm9sbGVyIGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBcGlIYW5kbGVyKFxuICBvcHRpb25zOiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHBhdGg/OiBzdHJpbmcsXG4gICAgbWV0aG9kPzogUm91dGVNZXRob2RzLFxuICB9ICYgSUNvbnRyb2xsZXJDb25maWcsXG4gIGhhbmRsZXI6IChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4sXG4pIHtcblxuICBjb25zdCB7IG5hbWUsIHBhdGggPSAnJywgbWV0aG9kID0gR2V0LCAuLi5jb250cm9sbGVyQ29uZmlnIH0gPSBvcHRpb25zO1xuXG4gIEBDb250cm9sbGVyKG5hbWUsIHsgLi4uY29udHJvbGxlckNvbmZpZywgYXV0b0V4cG9ydExhbWJkYUhhbmRsZXI6IGZhbHNlIH0pXG4gIGNsYXNzIENvbnRyb2xsZXJEZXNjcmlwdG9yIHtcbiAgICBAbWV0aG9kKHBhdGgpXG4gICAgYXN5bmMgaW5saW5lSGFuZGxlcigpIHtcbiAgICAgIC8vIHBsYWNlaG9sZGVyIGZ1bmN0aW9uIG9ubHkgdXNlZCBmb3Igcm91dGluZyBtZXRhZGF0YVxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShoYW5kbGVyLCAnbmFtZScsIHsgdmFsdWU6ICdoYW5kbGVyJyB9KTtcblxuICByZXR1cm4ge1xuICAgIGhhbmRsZXIsXG4gICAgZGVzY3JpcHRvcjogQ29udHJvbGxlckRlc2NyaXB0b3JcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyQ29uZmlnIHtcbiAgcmVzcG9uc2VDb25maWc/OiBQYXJ0aWFsPFJlc3BvbnNlQ29uZmlnPjtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFQSUNvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuICBwcm90ZWN0ZWQgbWlkZGxld2FyZXM6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlW10gPSBbXTtcbiAgcHJvdGVjdGVkIHJlc3BvbnNlQ29uZmlnOiBSZXNwb25zZUNvbmZpZztcblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IEFQSUNvbnRyb2xsZXJDb25maWcgPSB7fSkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5yZXNwb25zZUNvbmZpZyA9IG1lcmdlUmVzcG9uc2VDb25maWcoY29uZmlnLnJlc3BvbnNlQ29uZmlnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBjYW4gYmUgdXNlZCB0byBydW4gc29tZSBsb2dpYyBqdXN0IGJlZm9yZSB0aGUgcmVxdWVzdCBpcyBwcm9jZXNzZWQgbGlrZSBjcmVhdGluZyBjbGllbnRzLCBkaS1pbmplY3Rpb24gYW5zIHNvIG9uLlxuICAgKiBAcGFyYW0gX2V2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIF9jb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBjb250cm9sbGVyIGlzIGluaXRpYWxpemVkLlxuICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBOby1vcCBmb3IgQVBJIGNvbnRyb2xsZXJzXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGdldE92ZXJyaWRkZW5IdHRwUmVxdWVzdFZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSk7XG4gIH1cblxuICAvLyBBZGQgbWlkZGxld2FyZSByZWdpc3RyYXRpb24gbWV0aG9kXG4gIHByb3RlY3RlZCB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSB7XG4gICAgdGhpcy5taWRkbGV3YXJlcy5wdXNoKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCkge1xuICAgIHJldHVybiBbIC4uLmdsb2JhbE1pZGRsZXdhcmVzLCAuLi50aGlzLm1pZGRsZXdhcmVzIF07XG4gIH1cblxuICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKFxuICAgIHBoYXNlOiAnYmVmb3JlJyB8ICdhZnRlcicgfCAnb25FcnJvcicsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCxcbiAgICBlcnJvcj86IEVycm9yXG4gICk6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYWxsTWlkZGxld2FyZXMgPSB0aGlzLmdldE1pZGRsZXdhcmVzKCk7XG5cbiAgICBmb3IgKGNvbnN0IG1pZGRsZXdhcmUgb2YgYWxsTWlkZGxld2FyZXMpIHtcbiAgICAgIGlmIChwaGFzZSA9PT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmUub25FcnJvciAmJiBlcnJvcikge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlLm9uRXJyb3IoZXJyb3IsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfSBlbHNlIGlmIChwaGFzZSAhPT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmVbIHBoYXNlIF0pIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZVsgcGhhc2UgXSEocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9XG4gICAgfVxuXG4gIH1cblxuICBhc3luYyB2YWxpZGF0ZShyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCwgdmFsaWRhdGlvbnM6IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgbGV0IHZhbGlkYXRpb25SdWxlczogSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyA9IHZhbGlkYXRpb25zO1xuICAgIGlmIChpc0lucHV0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvbnMpKSB7XG4gICAgICBpZiAoWyAnR0VUJywgJ0RFTEVURScgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBxdWVyeTogdmFsaWRhdGlvbnMgfVxuXG4gICAgICB9IGVsc2UgaWYgKFsgJ1BPU1QnLCAnUFVUJywgJ1BBVENIJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IGJvZHk6IHZhbGlkYXRpb25zIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9uUnVsZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvcih2YWxpZGF0aW9uUnVsZXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHtcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25SdWxlcyxcbiAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsXG4gICAgICB2ZXJib3NlRXJyb3JzOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgdGhpcy5nZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVxdWVzdENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UmVxdWVzdD4ge1xuICAgIHJldHVybiBuZXcgUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCk6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlQ29udGV4dCh7XG4gICAgICB0cmFjZUlkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIGRlYnVnTW9kZTogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgcm91dGU6IHJlcXVlc3RDb250ZXh0LnBhdGgsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAnZGV2ZWxvcG1lbnQnLFxuICAgICAgY29uZmlnOiB0aGlzLnJlc3BvbnNlQ29uZmlnXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBjb250cm9sbGVyLlxuICAgKiBIYW5kbGVzIGluY29taW5nIEFQSSBHYXRld2F5IGV2ZW50cy5cbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIFRoZSBBUEkgR2F0ZXdheSByZXNwb25zZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuXG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0KTtcblxuICAgIC8vIEJ1aWxkIHRoZSBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IGN0eCA9IHRoaXMuYnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcblxuICAgIC8vIENyZWF0ZSBhdWRpdCBjb250ZXh0XG4gICAgY29uc3QgYXVkaXRDb250ZXh0ID0gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGN0eCk7XG4gICAgXG4gICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCB0aGlzLmJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbnRleHQuYXVkaXRDb25maWcpKTtcbiAgICB9XG5cbiAgICB0cnkge1xuXG4gICAgICAvLyBMZWdhY3kgaW5pdGlhbGl6ZSBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG5cbiAgICAgIC8vIEV4ZWN1dGUgYmVmb3JlIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIGNvbnN0IHJvdXRlID0gdGhpcy5maW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KTtcblxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlcXVlc3QgaWYgdmFsaWRhdGlvbnMgYXJlIGRlZmluZWRcbiAgICAgIGlmIChyb3V0ZT8udmFsaWRhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGUocmVxdWVzdCwgcm91dGUudmFsaWRhdGlvbnMpO1xuICAgICAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IodmFsaWRhdGlvblJlc3VsdC5lcnJvcnMpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIGNhbGwgdGhlIHJvdXRlIGZ1bmN0aW9uXG4gICAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpcy5nZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKTtcbiAgICAgIGxldCBjb250cm9sbGVyUmVzcG9uc2U6IGFueSA9IHJvdXRlRnVuY3Rpb24uY2FsbCh0aGlzLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgIGNvbnRyb2xsZXJSZXNwb25zZSA9IGF3YWl0IGNvbnRyb2xsZXJSZXNwb25zZTtcbiAgICAgIH1cblxuICAgICAgLy8gRXhlY3V0ZSBhZnRlciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2FmdGVyJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIC8vIENhcHR1cmUgc3VjY2Vzc2Z1bCByZXNwb25zZVxuICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCByZXNwb25zZSwgbnVsbCk7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBjb250cm9sbGVyIHJldHVybmVkIGFueXRoaW5nIChSZXNwb25zZUNvbnRleHQgb3IgcmF3IEFQSSByZXN1bHQpLCBlbWl0IHRoYXRcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgIT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShjb250cm9sbGVyUmVzcG9uc2UpO1xuICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG5cbiAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0xhbWJkYUhhbmRsZXIgZXJyb3I6ICcsIGVycm9yT2JqKTtcblxuICAgICAgLy8gRXhlY3V0ZSBlcnJvciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgIC8vIENhcHR1cmUgZXJyb3IgcmVzcG9uc2VcbiAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzcG9uc2UsIGVycm9yT2JqKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRXhjZXB0aW9uKHJlcXVlc3QsIGVycm9yT2JqLCByZXNwb25zZSk7XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2sgdG8gdGhlIGluLW1lbW9yeSByZXNwb25zZUNvbnRleHRcbiAgICByZXR1cm4gcmVzcG9uc2UuYnVpbGQoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgcm91dGUgdGhhdCBtYXRjaGVzIHRoZSBIVFRQIG1ldGhvZCBhbmQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSByZXF1ZXN0RGF0YSAtIFRoZSByZXF1ZXN0IGRhdGEgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgbWF0Y2hpbmcgcm91dGUgb3IgbnVsbCBpZiBub3QgZm91bmQuXG4gICAqL1xuICBwcml2YXRlIGZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhOiBSZXF1ZXN0KTogUm91dGUgfCBudWxsIHtcbiAgICBsZXQgY29udHJvbGxlcjogYW55ID0gdGhpcztcblxuICAgIC8vIERldGVybWluZSB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggYnkgZmluZGluZyB0aGUgbG9uZ2VzdCBjb21tb24gcHJlZml4IHRoYXQgZW5kcyB3aXRoIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICBsZXQgY29udHJvbGxlckJhc2VQYXRoID0gYC8ke2NvbnRyb2xsZXIuY29udHJvbGxlck5hbWV9YDtcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0Um9vdCA9ICcvJztcblxuICAgIC8vIEZvciBjb250cm9sbGVycyBpbiBzdWJkaXJlY3Rvcmllcywgd2UgbmVlZCB0byBtYXRjaCB0aGUgYWN0dWFsIHJlc291cmNlIHBhdGhcbiAgICAvLyBDaGVjayBpZiByZXNvdXJjZSBjb250YWlucyB0aGUgY29udHJvbGxlciBuYW1lIGFzIHBhcnQgb2YgYSBsb25nZXIgcGF0aFxuICAgIGNvbnN0IHJlc291cmNlUGFydHMgPSByZXF1ZXN0RGF0YS5yZXNvdXJjZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZVBhcnRzID0gY29udHJvbGxlci5jb250cm9sbGVyTmFtZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcblxuICAgIC8vIEZpbmQgaWYgdGhlIGNvbnRyb2xsZXIgbmFtZSBwYXJ0cyBhcmUgcHJlc2VudCBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgIGxldCBiYXNlUGF0aEVuZEluZGV4ID0gLTE7XG4gICAgaWYgKGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gTG9vayBmb3IgdGhlIGNvbnRyb2xsZXIgbmFtZSBzZXF1ZW5jZSBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gcmVzb3VyY2VQYXJ0cy5sZW5ndGggLSBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxldCBtYXRjaGVzID0gdHJ1ZTtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgaWYgKHJlc291cmNlUGFydHNbIGkgKyBqIF0gIT09IGNvbnRyb2xsZXJOYW1lUGFydHNbIGogXSkge1xuICAgICAgICAgICAgbWF0Y2hlcyA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgYmFzZVBhdGhFbmRJbmRleCA9IGkgKyBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmFzZVBhdGhFbmRJbmRleCA+PSAwKSB7XG4gICAgICAvLyBGb3VuZCB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggaW4gdGhlIHJlc291cmNlXG4gICAgICBjb25zdCBiYXNlUGF0aFBhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZSgwLCBiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICBjb250cm9sbGVyQmFzZVBhdGggPSAnLycgKyBiYXNlUGF0aFBhcnRzLmpvaW4oJy8nKTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ1BhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZShiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVtYWluaW5nUGFydHMubGVuZ3RoID4gMCA/ICcvJyArIHJlbWFpbmluZ1BhcnRzLmpvaW4oJy8nKSA6ICcvJztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmFsbGJhY2sgdG8gb3JpZ2luYWwgbG9naWMgZm9yIHNpbXBsZSBjYXNlc1xuICAgICAgaWYgKHJlcXVlc3REYXRhLnJlc291cmNlLnN0YXJ0c1dpdGgoY29udHJvbGxlckJhc2VQYXRoKSkge1xuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3Vic3RyaW5nKGNvbnRyb2xsZXJCYXNlUGF0aC5sZW5ndGgpIHx8ICcvJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXBhcmF0ZSByb3V0ZXMgaW50byBleGFjdCBhbmQgcGFyYW1ldGVyaXplZCBmb3IgcHJvcGVyIHByaW9yaXRpemF0aW9uXG4gICAgY29uc3QgZXhhY3RNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuICAgIGNvbnN0IHBhcmFtZXRlcml6ZWRNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuXG4gICAgLy8gRmlyc3QgcGFzczogY2F0ZWdvcml6ZSByb3V0ZXMgYnkgdHlwZSBhbmQgbWV0aG9kXG4gICAgZm9yIChjb25zdCBbIHJvdXRlS2V5LCByb3V0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRyb2xsZXIucm91dGVzIHx8IHt9KSBhcyBbIHN0cmluZywgUm91dGUgXVtdKSB7XG4gICAgICBjb25zdCBbIHJvdXRlTWV0aG9kLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIC8vIFNraXAgaWYgSFRUUCBtZXRob2QgZG9lc24ndCBtYXRjaFxuICAgICAgaWYgKHJvdXRlTWV0aG9kICE9PSByZXF1ZXN0RGF0YS5odHRwTWV0aG9kKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXRlZ29yaXplIHJvdXRlIHR5cGVcbiAgICAgIGlmIChyb3V0ZVBhdGguaW5jbHVkZXMoJ3snKSAmJiByb3V0ZVBhdGguaW5jbHVkZXMoJ30nKSkge1xuICAgICAgICBwYXJhbWV0ZXJpemVkTWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhhY3RNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2Vjb25kIHBhc3M6IFRyeSBleGFjdCBtYXRjaGVzIGZpcnN0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUgfSBvZiBleGFjdE1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmIChyb3V0ZVBhdGggPT09IHJlc291cmNlV2l0aG91dFJvb3QpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgcGFyYW1ldGVyaXplZCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCwge1xuICAgICAgICAgICAgcGF0dGVybjogcGF0aFRvUmVnZXhwUGF0dGVybixcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hSZXN1bHQucGFyYW1zLFxuICAgICAgICAgICAgc3BlY2lmaWNpdHlTY29yZTogc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMuZmluZChtID0+IG0ucm91dGVLZXkgPT09IHJvdXRlS2V5KT8uc3BlY2lmaWNpdHlTY29yZVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gTm90ZTogV2UgZG9uJ3QgbmVlZCB0byBtYW51YWxseSBleHRyYWN0IHBhcmFtZXRlcnMgc2luY2UgQVBJIEdhdGV3YXlcbiAgICAgICAgICAvLyBhbHJlYWR5IHByb3ZpZGVzIHRoZW0gaW4gcmVxdWVzdERhdGEucGF0aFBhcmFtZXRlcnNcbiAgICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEVycm9yIG1hdGNoaW5nIHJvdXRlIHBhdHRlcm4gJHtwYXRoVG9SZWdleHBQYXR0ZXJufTpgLCBlcnJvcik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIG1hdGNoaW5nIHJvdXRlIGZvdW5kIGZvciAke3JlcXVlc3REYXRhLmh0dHBNZXRob2R9fCR7cmVzb3VyY2VXaXRob3V0Um9vdH1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqIEBwYXJhbSByb3V0ZSAtIFRoZSBtYXRjaGVkIHJvdXRlLlxuICAgKiBAcmV0dXJucyBUaGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0Um91dGVGdW5jdGlvbihyb3V0ZTogUm91dGUgfCBudWxsKTogRnVuY3Rpb24ge1xuICAgIGlmICghcm91dGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gICAgfVxuXG4gICAgLy9AdHMtaWdub3JlXG4gICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXNbIHJvdXRlLmZ1bmN0aW9uTmFtZSBdO1xuXG4gICAgcmV0dXJuIHR5cGVvZiByb3V0ZUZ1bmN0aW9uID09PSBcImZ1bmN0aW9uXCIgPyByb3V0ZUZ1bmN0aW9uIDogdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgdGhlIE5vdEZvdW5kIHJvdXRlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNDA0IHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZU5vdEZvdW5kKF9yZXE6IFJlcXVlc3QpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJObyBSb3V0ZSBGb3VuZCFcIiB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlcnJvckhhbmRsZXI/OiBDb250cm9sbGVyRXJyb3JIYW5kbGVyO1xuICBwcm90ZWN0ZWQgZ2V0RXJyb3JIYW5kbGVyKCk6IENvbnRyb2xsZXJFcnJvckhhbmRsZXIge1xuICAgIGlmICghdGhpcy5lcnJvckhhbmRsZXIpIHtcbiAgICAgIHRoaXMuZXJyb3JIYW5kbGVyID0gY3JlYXRlRXJyb3JIYW5kbGVyKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmVycm9ySGFuZGxlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGV4Y2VwdGlvbnMgYW5kIHJldHVybnMgYSBKU09OIHJlc3BvbnNlIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0gZXJyIC0gVGhlIGVycm9yIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNTAwIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogUmVzcG9uc2UpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSB0aGlzLmdldEVycm9ySGFuZGxlcigpKGVyciwgcmVxLCByZXMpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGVycm9yUmVzcG9uc2UpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVJlc3BvbnNlKHJlczogUmVzcG9uc2UgfCBBUElHYXRld2F5UHJveHlSZXN1bHQpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGlmIChyZXMgaW5zdGFuY2VvZiBSZXNwb25zZUNvbnRleHQpIHtcbiAgICAgIHJldHVybiByZXMuYnVpbGQoKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGV4ZWN1dGlvbiBjb250ZXh0IGZvciB0aGUgcmVxdWVzdFxuICAgKiBcbiAgICogZGlmZmVyZW50IG1pZGRsZXdhcmUgY2FuIGVuaGFuY2UgdGhlIGFjdG9yIGNvbnRleHQgYnkgdXNpbmcgdGhlIGVuaGFuY2VBY3RvciBtZXRob2RcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHNcbiAgICogY29uc3QgbWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gICAqICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdCwgX3Jlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICBjdHg/LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgIHJvbGVzOiBbJ2FkbWluJywgJ3VzZXInXSxcbiAgICogICAgIHBlcm1pc3Npb25zOiBbJ3JlYWQnLCAnd3JpdGUnXSxcbiAgICogICAgIHN1YnNjcmlwdGlvbjogeyB0aWVyOiAnZW50ZXJwcmlzZScgfVxuICAgKiAgIH0pO1xuICAgKiAgfVxuICAgKiB9XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZSk7XG4gICAqIFxuICAgKiBPUlxuICAgKiBcbiAgICogY29uc3Qgc2VjdXJpdHlNaWRkbGV3YXJlID0ge1xuICAgKiAgIGJlZm9yZTogYXN5bmMgKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICAgIGN0eC5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICAgIHJpc2tQcm9maWxlOiBhd2FpdCBhc3Nlc3NSaXNrKGN0eC5hY3Rvci5hY3RvcklkKSxcbiAgICogICAgICAgZGV2aWNlOiBhd2FpdCBtYWtlRGV2aWNlQ29udGV4dChyZXF1ZXN0KVxuICAgKiAgICAgfSk7XG4gICAqICAgfVxuICAgKiB9O1xuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKHNlY3VyaXR5TWlkZGxld2FyZSk7XG4gICAqXG4gICAqIEBwYXJhbSBldmVudCBcbiAgICogQHBhcmFtIGNvbnRleHQgXG4gICAqIEBwYXJhbSByZXF1ZXN0IFxuICAgKiBAcGFyYW0gcmVzcG9uc2UgXG4gICAqIEByZXR1cm5zIFxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGFjdG9yID0gdGhpcy5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcbiAgICBcbiAgICBjb25zdCBjdHg6IEV4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICBldmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBhY3RvcixcbiAgICAgIGRlYnVnSW5mbzoge30sXG4gICAgICBcbiAgICAgIC8vIFNpbXBsZSBhY3RvciBlbmhhbmNlbWVudCBtZXRob2RcbiAgICAgIGVuaGFuY2VBY3RvcjogKGVuaGFuY2VtZW50OiBQYXJ0aWFsPEFjdG9yPikgPT4ge1xuICAgICAgICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIGVuaGFuY2VtZW50KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gY3R4O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYXVkaXQgY29udGV4dCBmb3IgdGhlIHJlcXVlc3QgZm9sbG93aW5nIHRoZSBleGlzdGluZyBidWlsZEN0eCBwYXR0ZXJuXG4gICAqIEBwYXJhbSBjdHggLSBUaGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICogQHJldHVybnMgQXVkaXRDb250ZXh0IG9yIG51bGwgaWYgYXVkaXQgaXMgZGlzYWJsZWRcbiAgICovXG4gIHByb3RlY3RlZCBtYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCk6IEF1ZGl0Q29udGV4dCB8IG51bGwge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0Q29udHJvbGxlckNvbmZpZygpO1xuICAgIGlmICghY29uZmlnPy5hdWRpdD8uZW5hYmxlZCkgcmV0dXJuIG51bGw7XG4gICAgXG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGN0eC5hY3Rvcj8uY29ycmVsYXRpb25JZCB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICBjdHgucmVxdWVzdC5oZWFkZXJzPy5bJ3gtY29ycmVsYXRpb24taWQnXSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICBjdHgucmVxdWVzdC5yZXF1ZXN0SWQ7XG4gICAgXG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IGAke2N0eC5yZXF1ZXN0Lmh0dHBNZXRob2QudG9Mb3dlckNhc2UoKX1fJHtjdHgucmVxdWVzdC5wYXRofWA7XG4gICAgY29uc3Qgb3BlcmF0aW9uSWQgPSBgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiR7b3BlcmF0aW9uTmFtZX1gO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbG9nVHlwZTogJ2xvZycsXG4gICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3QnLFxuICAgICAgZW50aXR5TmFtZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgb3BlcmF0aW9uOiBvcGVyYXRpb25OYW1lLFxuICAgICAgY2F0ZWdvcnk6IGNvbmZpZy5hdWRpdC5jYXRlZ29yeSxcbiAgICAgIGFjdG9yOiBjdHguYWN0b3IsXG4gICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBvcGVyYXRpb25JZCxcbiAgICAgICAgcGFyZW50T3BlcmF0aW9uSWQ6IGN0eC5yZXF1ZXN0LmhlYWRlcnM/LlsneC1wYXJlbnQtb3BlcmF0aW9uLWlkJ10sXG4gICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknLFxuICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICBzdGFydFRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9LFxuICAgICAgYXVkaXRDb25maWc6IGNvbmZpZy5hdWRpdFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciByZXF1ZXN0IHN0YXJ0XG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgcmVxdWVzdCBlbmQgKHN1Y2Nlc3Mgb3IgZXJyb3IpXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZUVuZChhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBlcnJvcjogRXJyb3IgfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzcG9uc2VDb250ZXh0ID0ge1xuICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzQ29kZSxcbiAgICAgIHJlc3BvbnNlU2l6ZTogcmVzcG9uc2UuYm9keT8ubGVuZ3RoIHx8IDAsXG4gICAgICByZXNwb25zZTogdGhpcy5idWlsZFJlc3BvbnNlQ29udGV4dChyZXNwb25zZSwgYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnKVxuICAgIH07XG4gICAgXG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IsIHJlc3BvbnNlQ29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHJlcXVlc3QgY29udGV4dCBmb3IgYXVkaXQgbG9nZ2luZ1xuICAgKi9cbiAgcHJpdmF0ZSBidWlsZFJlcXVlc3RDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnKTogUmVxdWVzdEF1ZGl0Q29udGV4dCB7XG4gICAgY29uc3QgaW5jbHVkZXMgPSBBcnJheS5pc0FycmF5KGF1ZGl0Q29uZmlnLmluY2x1ZGVzPy5yZXF1ZXN0KSBcbiAgICAgID8gYXVkaXRDb25maWcuaW5jbHVkZXMucmVxdWVzdCBcbiAgICAgIDogYXVkaXRDb25maWcuaW5jbHVkZXM/LnJlcXVlc3QgPyBbJ2hlYWRlcnMnXSA6IFtdO1xuICAgICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIG1ldGhvZDogY3R4LnJlcXVlc3QuaHR0cE1ldGhvZCxcbiAgICAgIHBhdGg6IGN0eC5yZXF1ZXN0LnBhdGgsXG4gICAgICB1c2VyQWdlbnQ6IGN0eC5ldmVudC5oZWFkZXJzPy5bJ3VzZXItYWdlbnQnXSxcbiAgICAgIHNvdXJjZUlwOiBjdHguZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIGhlYWRlcnM6IGluY2x1ZGVzLmluY2x1ZGVzKCdoZWFkZXJzJykgPyBjdHgucmVxdWVzdC5oZWFkZXJzIDogdW5kZWZpbmVkLFxuICAgICAgYm9keTogaW5jbHVkZXMuaW5jbHVkZXMoJ2JvZHknKSA/IGN0eC5yZXF1ZXN0LmJvZHkgOiB1bmRlZmluZWQsXG4gICAgICBxdWVyeTogaW5jbHVkZXMuaW5jbHVkZXMoJ3F1ZXJ5JykgPyBjdHgucmVxdWVzdC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgOiB1bmRlZmluZWRcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyByZXNwb25zZSBjb250ZXh0IGZvciBhdWRpdCBsb2dnaW5nXG4gICAqL1xuICBwcml2YXRlIGJ1aWxkUmVzcG9uc2VDb250ZXh0KHJlc3BvbnNlOiBSZXNwb25zZSwgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnKSB7XG4gICAgaWYgKCFhdWRpdENvbmZpZy5pbmNsdWRlcz8ucmVzcG9uc2UpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgXG4gICAgY29uc3QgaW5jbHVkZXMgPSBBcnJheS5pc0FycmF5KGF1ZGl0Q29uZmlnLmluY2x1ZGVzLnJlc3BvbnNlKSBcbiAgICAgID8gYXVkaXRDb25maWcuaW5jbHVkZXMucmVzcG9uc2UgXG4gICAgICA6IFsnaGVhZGVycyddO1xuICAgICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1c0NvZGUsXG4gICAgICBoZWFkZXJzOiBpbmNsdWRlcy5pbmNsdWRlcygnaGVhZGVycycpID8gcmVzcG9uc2UuaGVhZGVycyA6IHVuZGVmaW5lZCxcbiAgICAgIGJvZHk6IGluY2x1ZGVzLmluY2x1ZGVzKCdib2R5JykgPyByZXNwb25zZS5ib2R5IDogdW5kZWZpbmVkXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb250cm9sbGVyIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCBnZXRDb250cm9sbGVyQ29uZmlnKCk6IElDb250cm9sbGVyQ29uZmlnIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ2NvbnRyb2xsZXJDb25maWcnKSB8fCB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhY3RvciBjb250ZXh0IGZyb20gdGhlIHJlcXVlc3RcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgZm9yIGN1c3RvbSBhY3RvciBleHRyYWN0aW9uIGxvZ2ljXG4gICAqXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSByZXF1ZXN0IC0gVGhlIHJlcXVlc3Qgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgYWN0b3IgY29udGV4dC5cbiAgICogYGBgXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcbiAgICBcbiAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICByZXF1ZXN0SWQsXG4gICAgICB0aW1lc3RhbXAsXG4gICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVycz8uWyd1c2VyLWFnZW50J10gfHwgZXZlbnQuaGVhZGVycz8uWydVc2VyLUFnZW50J10sXG4gICAgICBjb3JyZWxhdGlvbklkOiByZXF1ZXN0LmhlYWRlcnM/LlsneC1jb3JyZWxhdGlvbi1pZCddIHx8IHJlcXVlc3RJZCxcbiAgICB9O1xuXG4gICAgLy8gQ29nbml0byBhdXRoZW50aWNhdGlvbiB3aXRoIGZvY3VzZWQgZW5oYW5jZW1lbnRzXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXMpIHtcbiAgICAgIHRoaXMuZXh0cmFjdENvZ25pdG9Db250ZXh0KGV2ZW50LnJlcXVlc3RDb250ZXh0LmF1dGhvcml6ZXIuY2xhaW1zLCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFQSSBLZXkgYXV0aGVudGljYXRpb25cbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSB8fCByZXF1ZXN0LmhlYWRlcnM/LlsneC1hcGkta2V5J10pIHtcbiAgICAgIHRoaXMuZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gSUFNIGF1dGhlbnRpY2F0aW9uIFxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybikge1xuICAgICAgdGhpcy5leHRyYWN0SWFtQ29udGV4dChldmVudCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBbm9ueW1vdXNcbiAgICBlbHNlIHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9ICdhbm9ueW1vdXMnO1xuICAgIH1cblxuICAgIC8vIFNlc3Npb24gYW5kIHRlbmFudCBjb250ZXh0XG4gICAgdGhpcy5leHRyYWN0U2Vzc2lvbkFuZFRlbmFudENvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcbiAgICBcbiAgICAvLyBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAgYWN0b3IuYXBpU3RhZ2UgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uc3RhZ2U7XG4gICAgYWN0b3IuYXBpSWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXBpSWQ7XG4gICAgXG4gICAgcmV0dXJuIGFjdG9yO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQ29nbml0byBhY3RvciBjb250ZXh0IGJhc2VkIG9uIGRvY3VtZW50ZWQgQVdTIENvZ25pdG8gSldUIGNsYWltc1xuICAgKiBPbmx5IGV4dHJhY3RzIHdoYXQncyBvZmZpY2lhbGx5IGRvY3VtZW50ZWQgYW5kIGF2YWlsYWJsZSBpbiBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAqIFxuICAgKiBAcGFyYW0gY2xhaW1zIC0gQ29nbml0byBKV1QgY2xhaW1zIGZyb20gdGhlIGF1dGhvcml6ZXJcbiAgICogQHBhcmFtIGFjdG9yIC0gQWN0b3Igb2JqZWN0IHRvIHBvcHVsYXRlXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdENvZ25pdG9Db250ZXh0KGNsYWltczogYW55LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcbiAgICAgIFxuICAgICAgLy8gQWN0b3IgSUQgd2l0aCBkb2N1bWVudGVkIGZhbGxiYWNrIHN0cmF0ZWd5OiBjb2duaXRvOnVzZXJuYW1lIC0+IGVtYWlsIC0+IHN1YlxuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltc1snY29nbml0bzp1c2VybmFtZSddIHx8IGNsYWltcy5lbWFpbCB8fCBjbGFpbXMuc3ViO1xuICAgICAgXG4gICAgICAvLyBTdGFuZGFyZCB1c2VyIGF0dHJpYnV0ZXMgKGRvY3VtZW50ZWQgQ29nbml0byB1c2VyIGF0dHJpYnV0ZXMpXG4gICAgICBhY3Rvci5lbWFpbCA9IGNsYWltcy5lbWFpbDtcbiAgICAgIGFjdG9yLmVtYWlsVmVyaWZpZWQgPSBjbGFpbXMuZW1haWxfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLnBob25lTnVtYmVyID0gY2xhaW1zLnBob25lX251bWJlcjtcbiAgICAgIGFjdG9yLnBob25lVmVyaWZpZWQgPSBjbGFpbXMucGhvbmVfbnVtYmVyX3ZlcmlmaWVkID09PSAndHJ1ZSc7XG4gICAgICBhY3Rvci5uYW1lID0gY2xhaW1zLm5hbWU7XG4gICAgICBhY3Rvci5sb2NhbGUgPSBjbGFpbXMubG9jYWxlO1xuICAgICAgXG4gICAgICAvLyBQYXJzZSBDb2duaXRvIGdyb3VwcyAoZG9jdW1lbnRlZCBhcyBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nKVxuICAgICAgY29uc3QgZ3JvdXBzID0gdGhpcy5wYXJzZUdyb3VwcyhjbGFpbXNbJ2NvZ25pdG86Z3JvdXBzJ10pO1xuICAgICAgXG4gICAgICAvLyBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIChkb2N1bWVudGVkIHBhdHRlcm46IGN1c3RvbToqKVxuICAgICAgY29uc3QgY3VzdG9tQXR0cmlidXRlcyA9IHRoaXMuZXh0cmFjdEN1c3RvbUF0dHJpYnV0ZXMoY2xhaW1zKTtcbiAgICAgIFxuICAgICAgLy8gQnVpbGQgQ29nbml0byBjb250ZXh0IHdpdGggb25seSBkb2N1bWVudGVkIGZpZWxkc1xuICAgICAgYWN0b3IuY29nbml0byA9IHtcbiAgICAgICAgc3ViOiBjbGFpbXMuc3ViLFxuICAgICAgICB1c2VybmFtZTogY2xhaW1zWydjb2duaXRvOnVzZXJuYW1lJ10sXG4gICAgICAgIGdyb3VwczogZ3JvdXBzLCAvLyBBbHdheXMgaW5jbHVkZSBncm91cHMgYXJyYXkgKGVtcHR5IG9yIHBvcHVsYXRlZClcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlczogT2JqZWN0LmtleXMoY3VzdG9tQXR0cmlidXRlcykubGVuZ3RoID4gMCA/IGN1c3RvbUF0dHJpYnV0ZXMgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgICBcbiAgICAgIC8vIEV4dHJhY3QgdGVuYW50IElEIGZyb20gY3VzdG9tIGF0dHJpYnV0ZXMgKGNvbW1vbiBtdWx0aS10ZW5hbnQgcGF0dGVybilcbiAgICAgIGFjdG9yLnRlbmFudElkID0gY3VzdG9tQXR0cmlidXRlcy50ZW5hbnRJZDtcbiAgICAgIFxuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG4gICAgICBcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignRXJyb3IgZXh0cmFjdGluZyBDb2duaXRvIGFjdG9yIGNvbnRleHQnLCB7IGVycm9yLCBjbGFpbXMgfSk7XG4gICAgICBcbiAgICAgIC8vIE1pbmltYWwgZmFsbGJhY2sgZXh0cmFjdGlvblxuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXMuc3ViIHx8ICd1bmtub3duJztcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSBDb2duaXRvIGdyb3VwcyBmcm9tIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcgKGRvY3VtZW50ZWQgQ29nbml0byBmb3JtYXQpXG4gICAqL1xuICBwcm90ZWN0ZWQgcGFyc2VHcm91cHMoZ3JvdXBzOiBhbnkpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHR5cGVvZiBncm91cHMgPT09ICdzdHJpbmcnICYmIGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZ3JvdXBzLnNwbGl0KCcsJykubWFwKGcgPT4gZy50cmltKCkpLmZpbHRlcihnID0+IGcubGVuZ3RoID4gMCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIHVzaW5nIGRvY3VtZW50ZWQgQ29nbml0byBwYXR0ZXJuIChjdXN0b206KilcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXM6IGFueSk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBcbiAgICBPYmplY3Qua2V5cyhjbGFpbXMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGlmIChrZXkuc3RhcnRzV2l0aCgnY3VzdG9tOicpKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBrZXkucmVwbGFjZSgnY3VzdG9tOicsICcnKTtcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGNsYWltc1trZXldO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBjdXN0b21BdHRyaWJ1dGVzO1xuICB9XG5cbiAgICAvKipcbiAgICogRXh0cmFjdCBzZXNzaW9uIGFuZCB0ZW5hbnQgY29udGV4dCAtIGZvY3VzZWQgYXBwcm9hY2hcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0U2Vzc2lvbkFuZFRlbmFudENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgLy8gU2Vzc2lvbiBjb250ZXh0XG4gICAgYWN0b3Iuc2Vzc2lvbklkID0gcmVxdWVzdC5oZWFkZXJzPy5bJ3gtc2Vzc2lvbi1pZCddO1xuICAgIFxuICAgIC8vIFRlbmFudCBjb250ZXh0IC0gY2hlY2sgY3VzdG9tIGF0dHJpYnV0ZXMgZmlyc3QsIHRoZW4gaGVhZGVyc1xuICAgIGFjdG9yLnRlbmFudElkID0gcmVxdWVzdC5oZWFkZXJzPy5bJ3gtdGVuYW50LWlkJ10gfHwgXG4gICAgICAgICAgICAgICAgICAgIGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXM/LlsnY3VzdG9tOnRlbmFudElkJ107XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBBUEkgS2V5IGNvbnRleHRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QXBpS2V5Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2FwaS1rZXknO1xuICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcbiAgICBcbiAgICBsZXQgYXBpS2V5SWQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlOiAncmVxdWVzdC1jb250ZXh0JyB8ICdoZWFkZXInO1xuICAgIFxuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSkge1xuICAgICAgYXBpS2V5SWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXlJZCB8fCBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXk7XG4gICAgICBzb3VyY2UgPSAncmVxdWVzdC1jb250ZXh0JztcbiAgICB9IGVsc2Uge1xuICAgICAgYXBpS2V5SWQgPSByZXF1ZXN0LmhlYWRlcnNbJ3gtYXBpLWtleSddITtcbiAgICAgIHNvdXJjZSA9ICdoZWFkZXInO1xuICAgIH1cbiAgICBcbiAgICBhY3Rvci5hY3RvcklkID0gYGFwaS1rZXk6JHthcGlLZXlJZH1gO1xuICAgIGFjdG9yLmFwaUtleSA9IHtcbiAgICAgIGlkOiBhcGlLZXlJZCxcbiAgICAgIHNvdXJjZTogc291cmNlLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBJQU0gY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RJYW1Db250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnaWFtJztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG4gICAgYWN0b3IuYWN0b3JJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fCBcbiAgICAgICAgICAgICAgICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgXG4gICAgICAgICAgICAgICAgICAgJ3Vua25vd24taWFtLXVzZXInO1xuICAgIFxuICAgIGFjdG9yLmlhbSA9IHtcbiAgICAgIHVzZXJBcm46IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybiB8fCB1bmRlZmluZWQsXG4gICAgICB1c2VySWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fCB1bmRlZmluZWQsXG4gICAgICBhY2NvdW50SWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYWNjb3VudElkIHx8IHVuZGVmaW5lZCxcbiAgICAgIGNhbGxlcjogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5jYWxsZXIgfHwgdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cbn1cbiJdfQ==