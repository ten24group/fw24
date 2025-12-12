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
const observability_1 = require("../../observability");
const controller_config_1 = require("../../observability/controller-config");
const execution_context_1 = require("./execution-context");
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
     *
     * All handler execution is wrapped in execution context, making
     * getCurrentExecutionContext() available throughout the request lifecycle.
     *
     * @param event - The event object from the API Gateway.
     * @param context - The context object from the API Gateway.
     * @returns The API Gateway response object.
     */
    async LambdaHandler(event, context) {
        this.initializeObservability();
        const request = await this.makeRequestContext(event, context);
        const response = await this.makeResponseContext(request);
        // Build the execution context
        const ctx = this.buildCtx(event, context, request, response);
        // Find the matching route (needed for observability config)
        const route = this.findMatchingRoute(request);
        // Get merged observability config
        const observabilityConfig = this.getObservabilityConfig(route);
        const defaultSource = `${this.constructor.name}.${route?.functionName || 'handler'}`;
        // Extract trace context from incoming headers
        const traceContext = (0, execution_context_1.extractFromHeaders)(request.headers || {});
        const correlationId = traceContext?.correlationId || request.requestId || crypto.randomUUID();
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            parentObservabilityLogId: traceContext?.parentObservabilityLogId,
            actor: ctx.actor,
            sampled: traceContext?.sampled,
            source: observabilityConfig?.source || defaultSource,
            tags: observabilityConfig?.tags,
        });
        // Run entire handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Build span attributes (includes request data capture)
            const spanAttributes = this.buildSpanAttributes(event, request, observabilityConfig);
            // Create root span with custom source, tags, and attributes from decorator
            const requestSpan = observability_1.SpanObserver.start(`HTTP ${request.httpMethod} ${request.path}`, {
                correlationId,
                parentObservabilityLogId: traceContext?.parentObservabilityLogId,
                actor: ctx.actor,
                source: observabilityConfig?.source || defaultSource,
                tags: observabilityConfig?.tags,
                attributes: {
                    ...spanAttributes,
                    ...observabilityConfig?.attributes,
                },
            });
            // Store span ID in execution context for child spans
            execCtx.parentObservabilityLogId = requestSpan.id;
            // Set ctx.executionContext to point to the execution context
            ctx.executionContext = execCtx;
            // Sync actor.correlationId with the resolved correlationId
            // This ensures actor stored in _actor field has the correct trace ID
            if (ctx.actor) {
                ctx.actor.correlationId = correlationId;
            }
            let spanEnded = false;
            const endSpan = async (success, error, finalResponse) => {
                if (!spanEnded) {
                    if (finalResponse && observabilityConfig?.enabled !== false) {
                        const responseAttrs = this.buildResponseAttributes(finalResponse, observabilityConfig);
                        if (responseAttrs) {
                            requestSpan.setAttributes(responseAttrs);
                        }
                    }
                    requestSpan.end({ success, error });
                    spanEnded = true;
                }
                await this.flushObservability();
            };
            try {
                // Legacy initialize method for backward compatibility
                await this.initialize(event, context);
                // Execute before middleware
                await this.executeMiddlewarePipeline('before', request, response, ctx);
                // Validate the request if validations are defined
                if (route?.validations) {
                    const validationResult = await this.validate(request, route.validations);
                    if (!validationResult.pass) {
                        throw new errors_1.ValidationFailedError(validationResult.errors);
                    }
                }
                // Call the route function
                const routeFunction = this.getRouteFunction(route);
                let controllerResponse = routeFunction.call(this, request, response, ctx);
                if (controllerResponse instanceof Promise) {
                    controllerResponse = await controllerResponse;
                }
                // Execute after middleware
                await this.executeMiddlewarePipeline('after', request, response, ctx);
                // If the controller returned anything, emit that
                if (controllerResponse != null) {
                    await endSpan(true, undefined, response);
                    return this.handleResponse(controllerResponse);
                }
            }
            catch (err) {
                const errorObj = err instanceof Error ? err : new Error(String(err));
                this.logger.error('LambdaHandler error: ', errorObj);
                // Execute error middleware
                await this.executeMiddlewarePipeline('onError', request, response, ctx, errorObj);
                await endSpan(false, errorObj, response);
                return this.handleException(request, errorObj, response);
            }
            // Fallback to the in-memory responseContext
            await endSpan(true, undefined, response);
            return response.build();
        });
    }
    /**
     * Gets merged observability config from controller and method level
     */
    getObservabilityConfig(route) {
        const controllerConfig = this.getControllerConfig();
        return (0, controller_config_1.mergeObservabilityConfigs)(controllerConfig?.observability, route?.observability);
    }
    /**
     * Build span attributes based on observability config.
     * Always includes basic HTTP info. Request body/headers/query are only
     * included if explicitly configured via `includes`.
     */
    buildSpanAttributes(event, request, config) {
        // Always include basic HTTP attributes
        const attrs = {
            'http.method': request.httpMethod,
            'http.path': request.path,
            'http.requestId': request.requestId,
            'http.userAgent': event.headers?.['user-agent'] || event.headers?.['User-Agent'],
            'http.sourceIp': event.requestContext?.identity?.sourceIp,
        };
        // If disabled or no includes config, return basic attrs only
        if (config?.enabled === false || !config?.includes) {
            return attrs;
        }
        // Build request data based on includes config
        const includes = (0, controller_config_1.normalizeIncludes)(config.includes);
        const requestData = {};
        if (includes.request.headers) {
            const headerData = (0, controller_config_1.selectFields)(request.headers, includes.request.headers);
            if (headerData)
                requestData.headers = headerData;
        }
        if (includes.request.body && request.body) {
            const bodyData = typeof request.body === 'string'
                ? (0, controller_config_1.selectFieldsFromBody)(request.body, includes.request.body)
                : (0, controller_config_1.selectFields)(request.body, includes.request.body);
            if (bodyData)
                requestData.body = bodyData;
        }
        if (includes.request.query && request.queryStringParameters) {
            const queryData = (0, controller_config_1.selectFields)(request.queryStringParameters, includes.request.query);
            if (queryData)
                requestData.query = queryData;
        }
        // Apply data protection and add to attributes
        if (Object.keys(requestData).length > 0) {
            attrs['request'] = config.dataProtection?.enabled !== false
                ? (0, observability_1.redactSensitiveData)(requestData, config.dataProtection)
                : requestData;
        }
        return attrs;
    }
    /**
     * Build response attributes based on observability config.
     * Only captures response body/headers if explicitly configured via `includes`.
     */
    buildResponseAttributes(response, config) {
        // Always include status code
        const attrs = {
            'http.statusCode': response.statusCode,
        };
        // If disabled or no includes config, return just status code
        if (config?.enabled === false || !config?.includes) {
            return attrs;
        }
        const includes = (0, controller_config_1.normalizeIncludes)(config.includes);
        const responseData = {};
        if (includes.response.headers && response.headers) {
            const headerData = (0, controller_config_1.selectFields)(response.headers, includes.response.headers);
            if (headerData)
                responseData.headers = headerData;
        }
        if (includes.response.body && response.body) {
            const bodyData = (0, controller_config_1.selectFieldsFromBody)(response.body, includes.response.body);
            if (bodyData)
                responseData.body = bodyData;
        }
        // Apply data protection and add to attributes
        if (Object.keys(responseData).length > 0) {
            attrs['response'] = config.dataProtection?.enabled !== false
                ? (0, observability_1.redactSensitiveData)(responseData, config.dataProtection)
                : responseData;
        }
        return attrs;
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
     * Gets the controller configuration
     */
    getControllerConfig() {
        return Reflect.get(this, 'controllerConfig') || {};
    }
    /**
     * Extracts actor context from the request.
     * Override this method for custom actor extraction logic.
     *
     * Note: correlationId is NOT set here - it's determined from trace context
     * extraction and set on the ExecutionContext. The actor.correlationId is
     * synced later in LambdaHandler after trace context is resolved.
     *
     * @param event - The event object from the API Gateway.
     * @param request - The request object from the API Gateway.
     * @returns The actor context.
     */
    extractActorContext(event, request) {
        const timestamp = new Date().toISOString();
        const requestId = request.requestId;
        const actor = {
            requestId,
            timestamp,
            sourceIp: event.requestContext?.identity?.sourceIp,
            userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'],
            // Note: correlationId is set later after trace context extraction
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFvRUEsNENBeUJDO0FBM0ZELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFFakgsdURBQXdFO0FBQ3hFLDZFQU0rQztBQUMvQywyREFLNkI7QUFXN0IsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7QUFFM0QsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDLENBQUE7QUFGWSxRQUFBLGdCQUFnQixvQkFFNUI7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BSXFCLEVBQ3JCLE9BQXFGO0lBR3JGLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsWUFBRyxFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFHdkUsSUFBTSxvQkFBb0IsR0FBMUIsTUFBTSxvQkFBb0I7UUFFbEIsQUFBTixLQUFLLENBQUMsYUFBYTtZQUNqQixzREFBc0Q7UUFDeEQsQ0FBQztLQUNGLENBQUE7SUFITztRQURMLE1BQU0sQ0FBQyxJQUFJLENB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QUMzQyxNQUFNLEdBQUcsUUFBUSxDQUFDO1FBQ3BCLENBQUM7UUFFRCxLQUFLLENBQUMsT0FBTyxHQUFHLFdBQVcsUUFBUSxFQUFFLENBQUM7UUFDdEMsS0FBSyxDQUFDLE1BQU0sR0FBRztZQUNiLEVBQUUsRUFBRSxRQUFRO1lBQ1osTUFBTSxFQUFFLE1BQU07U0FDZixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ08saUJBQWlCLENBQUMsS0FBc0IsRUFBRSxLQUFZO1FBQzlELEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDO1FBQ3pCLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzVCLEtBQUssQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsSUFBSTtZQUNsRCxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxPQUFPO1lBQ3ZDLGtCQUFrQixDQUFDO1FBRXJCLEtBQUssQ0FBQyxHQUFHLEdBQUc7WUFDVixPQUFPLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTyxJQUFJLFNBQVM7WUFDN0QsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLElBQUksSUFBSSxTQUFTO1lBQ3pELFNBQVMsRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxTQUFTLElBQUksU0FBUztZQUNqRSxNQUFNLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsTUFBTSxJQUFJLFNBQVM7U0FDNUQsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQWp3QkQsc0NBaXdCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSwgUm91dGUgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgR2V0LCBSb3V0ZU1ldGhvZHMgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9tZXRob2RcIjtcbmltcG9ydCB7IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIElucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlLCBpc0lucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvbi91dGlsc1wiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IFJlcXVlc3RDb250ZXh0IH0gZnJvbSBcIi4vcmVxdWVzdC1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbnRleHQgfSBmcm9tIFwiLi9yZXNwb25zZS1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbmZpZywgbWVyZ2VSZXNwb25zZUNvbmZpZyB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbmZpZ1wiO1xuaW1wb3J0IHsgVmFsaWRhdGlvbkZhaWxlZEVycm9yLCBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yLCBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vZXJyb3JzL1wiO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIHJlZGFjdFNlbnNpdGl2ZURhdGEgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7XG4gIENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBtZXJnZU9ic2VydmFiaWxpdHlDb25maWdzLFxuICBub3JtYWxpemVJbmNsdWRlcyxcbiAgc2VsZWN0RmllbGRzLFxuICBzZWxlY3RGaWVsZHNGcm9tQm9keVxufSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5L2NvbnRyb2xsZXItY29uZmlnJztcbmltcG9ydCB7XG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBleHRyYWN0RnJvbUhlYWRlcnMsXG4gIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxufSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuZXhwb3J0IHR5cGUgQ29udHJvbGxlckVycm9ySGFuZGxlciA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZUVycm9ySGFuZGxlcj47XG5cbi8vIE5ldyBpbnRlcmZhY2VzIGZvciBtaWRkbGV3YXJlIGFuZCBlcnJvciBoYW5kbGluZ1xuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyTWlkZGxld2FyZSB7XG4gIGJlZm9yZT86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIGFmdGVyPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgb25FcnJvcj86IChlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuLy8gR2xvYmFsIG1pZGRsZXdhcmUgbWFuYWdlbWVudFxuY29uc3QgZ2xvYmFsTWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG5cbmV4cG9ydCBjb25zdCB1c2VNaWRkbGV3YXJlID0gKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbn1cbmV4cG9ydCBjb25zdCBjbGVhck1pZGRsZXdhcmVzID0gKCkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5jbGVhcigpO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gQVBJIGhhbmRsZXIgd2l0aG91dCBkZWZpbmluZyBhIGNsYXNzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogZXhwb3J0IGNvbnN0IHsgaGFuZGxlciwgZGVzY3JpcHRvciB9ID0gY3JlYXRlQXBpSGFuZGxlcihcbiAqICB7IG1ldGhvZDogR2V0LCBuYW1lOiAnZGVtbycsIGF1dGhvcml6ZXI6ICdOT05FJyB9LFxuICogICBhc3luYyAoIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICogICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gKiAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICogICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJIZWxsbyBXb3JsZCFcIn0pXG4gKiAgICAgICB9KVxuICogICB9XG4gKiApXG4gKiBgYGBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5wYXRoIC0gVGhlIHBhdGggZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgZnVuY3Rpb24gYW5kIHRoZSBjb250cm9sbGVyIGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBcGlIYW5kbGVyKFxuICBvcHRpb25zOiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHBhdGg/OiBzdHJpbmcsXG4gICAgbWV0aG9kPzogUm91dGVNZXRob2RzLFxuICB9ICYgSUNvbnRyb2xsZXJDb25maWcsXG4gIGhhbmRsZXI6IChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4sXG4pIHtcblxuICBjb25zdCB7IG5hbWUsIHBhdGggPSAnJywgbWV0aG9kID0gR2V0LCAuLi5jb250cm9sbGVyQ29uZmlnIH0gPSBvcHRpb25zO1xuXG4gIEBDb250cm9sbGVyKG5hbWUsIHsgLi4uY29udHJvbGxlckNvbmZpZywgYXV0b0V4cG9ydExhbWJkYUhhbmRsZXI6IGZhbHNlIH0pXG4gIGNsYXNzIENvbnRyb2xsZXJEZXNjcmlwdG9yIHtcbiAgICBAbWV0aG9kKHBhdGgpXG4gICAgYXN5bmMgaW5saW5lSGFuZGxlcigpIHtcbiAgICAgIC8vIHBsYWNlaG9sZGVyIGZ1bmN0aW9uIG9ubHkgdXNlZCBmb3Igcm91dGluZyBtZXRhZGF0YVxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShoYW5kbGVyLCAnbmFtZScsIHsgdmFsdWU6ICdoYW5kbGVyJyB9KTtcblxuICByZXR1cm4ge1xuICAgIGhhbmRsZXIsXG4gICAgZGVzY3JpcHRvcjogQ29udHJvbGxlckRlc2NyaXB0b3JcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyQ29uZmlnIHtcbiAgcmVzcG9uc2VDb25maWc/OiBQYXJ0aWFsPFJlc3BvbnNlQ29uZmlnPjtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFQSUNvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuICBwcm90ZWN0ZWQgbWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG4gIHByb3RlY3RlZCByZXNwb25zZUNvbmZpZzogUmVzcG9uc2VDb25maWc7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBBUElDb250cm9sbGVyQ29uZmlnID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzcG9uc2VDb25maWcgPSBtZXJnZVJlc3BvbnNlQ29uZmlnKGNvbmZpZy5yZXNwb25zZUNvbmZpZyk7XG4gIH1cblxuICAvKipcbiAgICogY2FuIGJlIHVzZWQgdG8gcnVuIHNvbWUgbG9naWMganVzdCBiZWZvcmUgdGhlIHJlcXVlc3QgaXMgcHJvY2Vzc2VkIGxpa2UgY3JlYXRpbmcgY2xpZW50cywgZGktaW5qZWN0aW9uIGFucyBzbyBvbi5cbiAgICogQHBhcmFtIF9ldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBfY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgY29udHJvbGxlciBpcyBpbml0aWFsaXplZC5cbiAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8tb3AgZm9yIEFQSSBjb250cm9sbGVyc1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBnZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICB9XG5cbiAgLy8gQWRkIG1pZGRsZXdhcmUgcmVnaXN0cmF0aW9uIG1ldGhvZFxuICBwcm90ZWN0ZWQgdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkge1xuICAgIHRoaXMubWlkZGxld2FyZXMuYWRkKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCkge1xuICAgIHJldHVybiBbIC4uLkFycmF5LmZyb20oZ2xvYmFsTWlkZGxld2FyZXMpLCAuLi5BcnJheS5mcm9tKHRoaXMubWlkZGxld2FyZXMpIF07XG4gIH1cblxuICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKFxuICAgIHBoYXNlOiAnYmVmb3JlJyB8ICdhZnRlcicgfCAnb25FcnJvcicsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCxcbiAgICBlcnJvcj86IEVycm9yXG4gICk6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYWxsTWlkZGxld2FyZXMgPSB0aGlzLmdldE1pZGRsZXdhcmVzKCk7XG5cbiAgICBmb3IgKGNvbnN0IG1pZGRsZXdhcmUgb2YgYWxsTWlkZGxld2FyZXMpIHtcbiAgICAgIGlmIChwaGFzZSA9PT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmUub25FcnJvciAmJiBlcnJvcikge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlLm9uRXJyb3IoZXJyb3IsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfSBlbHNlIGlmIChwaGFzZSAhPT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmVbIHBoYXNlIF0pIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZVsgcGhhc2UgXSEocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9XG4gICAgfVxuXG4gIH1cblxuICBhc3luYyB2YWxpZGF0ZShyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCwgdmFsaWRhdGlvbnM6IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgbGV0IHZhbGlkYXRpb25SdWxlczogSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyA9IHZhbGlkYXRpb25zO1xuICAgIGlmIChpc0lucHV0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvbnMpKSB7XG4gICAgICBpZiAoWyAnR0VUJywgJ0RFTEVURScgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBxdWVyeTogdmFsaWRhdGlvbnMgfVxuXG4gICAgICB9IGVsc2UgaWYgKFsgJ1BPU1QnLCAnUFVUJywgJ1BBVENIJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IGJvZHk6IHZhbGlkYXRpb25zIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9uUnVsZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvcih2YWxpZGF0aW9uUnVsZXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHtcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25SdWxlcyxcbiAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsXG4gICAgICB2ZXJib3NlRXJyb3JzOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgdGhpcy5nZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVxdWVzdENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UmVxdWVzdD4ge1xuICAgIHJldHVybiBuZXcgUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCk6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlQ29udGV4dCh7XG4gICAgICB0cmFjZUlkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIGRlYnVnTW9kZTogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgcm91dGU6IHJlcXVlc3RDb250ZXh0LnBhdGgsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAnZGV2ZWxvcG1lbnQnLFxuICAgICAgY29uZmlnOiB0aGlzLnJlc3BvbnNlQ29uZmlnXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBjb250cm9sbGVyLlxuICAgKiBIYW5kbGVzIGluY29taW5nIEFQSSBHYXRld2F5IGV2ZW50cy5cbiAgICogXG4gICAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LCBtYWtpbmdcbiAgICogZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSBhdmFpbGFibGUgdGhyb3VnaG91dCB0aGUgcmVxdWVzdCBsaWZlY3ljbGUuXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIEFQSSBHYXRld2F5IHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgdGhpcy5pbml0aWFsaXplT2JzZXJ2YWJpbGl0eSgpO1xuXG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0KTtcblxuICAgIC8vIEJ1aWxkIHRoZSBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IGN0eCA9IHRoaXMuYnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcblxuICAgIC8vIEZpbmQgdGhlIG1hdGNoaW5nIHJvdXRlIChuZWVkZWQgZm9yIG9ic2VydmFiaWxpdHkgY29uZmlnKVxuICAgIGNvbnN0IHJvdXRlID0gdGhpcy5maW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KTtcblxuICAgIC8vIEdldCBtZXJnZWQgb2JzZXJ2YWJpbGl0eSBjb25maWdcbiAgICBjb25zdCBvYnNlcnZhYmlsaXR5Q29uZmlnID0gdGhpcy5nZXRPYnNlcnZhYmlsaXR5Q29uZmlnKHJvdXRlKTtcbiAgICBjb25zdCBkZWZhdWx0U291cmNlID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke3JvdXRlPy5mdW5jdGlvbk5hbWUgfHwgJ2hhbmRsZXInfWA7XG5cbiAgICAvLyBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBpbmNvbWluZyBoZWFkZXJzXG4gICAgY29uc3QgdHJhY2VDb250ZXh0ID0gZXh0cmFjdEZyb21IZWFkZXJzKHJlcXVlc3QuaGVhZGVycyB8fCB7fSk7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHRyYWNlQ29udGV4dD8uY29ycmVsYXRpb25JZCB8fCByZXF1ZXN0LnJlcXVlc3RJZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpO1xuXG4gICAgLy8gQ3JlYXRlIGV4ZWN1dGlvbiBjb250ZXh0IHdpdGggY3VzdG9tIHNvdXJjZSBhbmQgdGFncyBmcm9tIGRlY29yYXRvclxuICAgIGNvbnN0IGV4ZWNDdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHRyYWNlQ29udGV4dD8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgYWN0b3I6IGN0eC5hY3RvcixcbiAgICAgIHNhbXBsZWQ6IHRyYWNlQ29udGV4dD8uc2FtcGxlZCxcbiAgICAgIHNvdXJjZTogb2JzZXJ2YWJpbGl0eUNvbmZpZz8uc291cmNlIHx8IGRlZmF1bHRTb3VyY2UsXG4gICAgICB0YWdzOiBvYnNlcnZhYmlsaXR5Q29uZmlnPy50YWdzLFxuICAgIH0pO1xuXG4gICAgLy8gUnVuIGVudGlyZSBoYW5kbGVyIHdpdGhpbiBleGVjdXRpb24gY29udGV4dFxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBCdWlsZCBzcGFuIGF0dHJpYnV0ZXMgKGluY2x1ZGVzIHJlcXVlc3QgZGF0YSBjYXB0dXJlKVxuICAgICAgY29uc3Qgc3BhbkF0dHJpYnV0ZXMgPSB0aGlzLmJ1aWxkU3BhbkF0dHJpYnV0ZXMoZXZlbnQsIHJlcXVlc3QsIG9ic2VydmFiaWxpdHlDb25maWcpO1xuXG4gICAgICAvLyBDcmVhdGUgcm9vdCBzcGFuIHdpdGggY3VzdG9tIHNvdXJjZSwgdGFncywgYW5kIGF0dHJpYnV0ZXMgZnJvbSBkZWNvcmF0b3JcbiAgICAgIGNvbnN0IHJlcXVlc3RTcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KGBIVFRQICR7cmVxdWVzdC5odHRwTWV0aG9kfSAke3JlcXVlc3QucGF0aH1gLCB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdHJhY2VDb250ZXh0Py5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgIGFjdG9yOiBjdHguYWN0b3IsXG4gICAgICAgIHNvdXJjZTogb2JzZXJ2YWJpbGl0eUNvbmZpZz8uc291cmNlIHx8IGRlZmF1bHRTb3VyY2UsXG4gICAgICAgIHRhZ3M6IG9ic2VydmFiaWxpdHlDb25maWc/LnRhZ3MsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAuLi5zcGFuQXR0cmlidXRlcyxcbiAgICAgICAgICAuLi5vYnNlcnZhYmlsaXR5Q29uZmlnPy5hdHRyaWJ1dGVzLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFN0b3JlIHNwYW4gSUQgaW4gZXhlY3V0aW9uIGNvbnRleHQgZm9yIGNoaWxkIHNwYW5zXG4gICAgICBleGVjQ3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHJlcXVlc3RTcGFuLmlkO1xuXG4gICAgICAvLyBTZXQgY3R4LmV4ZWN1dGlvbkNvbnRleHQgdG8gcG9pbnQgdG8gdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjdHguZXhlY3V0aW9uQ29udGV4dCA9IGV4ZWNDdHg7XG5cbiAgICAgIC8vIFN5bmMgYWN0b3IuY29ycmVsYXRpb25JZCB3aXRoIHRoZSByZXNvbHZlZCBjb3JyZWxhdGlvbklkXG4gICAgICAvLyBUaGlzIGVuc3VyZXMgYWN0b3Igc3RvcmVkIGluIF9hY3RvciBmaWVsZCBoYXMgdGhlIGNvcnJlY3QgdHJhY2UgSURcbiAgICAgIGlmIChjdHguYWN0b3IpIHtcbiAgICAgICAgY3R4LmFjdG9yLmNvcnJlbGF0aW9uSWQgPSBjb3JyZWxhdGlvbklkO1xuICAgICAgfVxuXG4gICAgICBsZXQgc3BhbkVuZGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBlbmRTcGFuID0gYXN5bmMgKHN1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogRXJyb3IsIGZpbmFsUmVzcG9uc2U/OiBSZXNwb25zZSkgPT4ge1xuICAgICAgICBpZiAoIXNwYW5FbmRlZCkge1xuICAgICAgICAgIGlmIChmaW5hbFJlc3BvbnNlICYmIG9ic2VydmFiaWxpdHlDb25maWc/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZUF0dHJzID0gdGhpcy5idWlsZFJlc3BvbnNlQXR0cmlidXRlcyhmaW5hbFJlc3BvbnNlLCBvYnNlcnZhYmlsaXR5Q29uZmlnKTtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZUF0dHJzKSB7XG4gICAgICAgICAgICAgIHJlcXVlc3RTcGFuLnNldEF0dHJpYnV0ZXMocmVzcG9uc2VBdHRycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlcXVlc3RTcGFuLmVuZCh7IHN1Y2Nlc3MsIGVycm9yIH0pO1xuICAgICAgICAgIHNwYW5FbmRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5mbHVzaE9ic2VydmFiaWxpdHkoKTtcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIExlZ2FjeSBpbml0aWFsaXplIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAgIC8vIEV4ZWN1dGUgYmVmb3JlIG1pZGRsZXdhcmVcbiAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgICAvLyBWYWxpZGF0ZSB0aGUgcmVxdWVzdCBpZiB2YWxpZGF0aW9ucyBhcmUgZGVmaW5lZFxuICAgICAgICBpZiAocm91dGU/LnZhbGlkYXRpb25zKSB7XG4gICAgICAgICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGUocmVxdWVzdCwgcm91dGUudmFsaWRhdGlvbnMpO1xuICAgICAgICAgIGlmICghdmFsaWRhdGlvblJlc3VsdC5wYXNzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpcy5nZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKTtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJSZXNwb25zZTogYW55ID0gcm91dGVGdW5jdGlvbi5jYWxsKHRoaXMsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgIGNvbnRyb2xsZXJSZXNwb25zZSA9IGF3YWl0IGNvbnRyb2xsZXJSZXNwb25zZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2FmdGVyJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgICAgLy8gSWYgdGhlIGNvbnRyb2xsZXIgcmV0dXJuZWQgYW55dGhpbmcsIGVtaXQgdGhhdFxuICAgICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgICBhd2FpdCBlbmRTcGFuKHRydWUsIHVuZGVmaW5lZCwgcmVzcG9uc2UpO1xuICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGNvbnRyb2xsZXJSZXNwb25zZSk7XG4gICAgICAgIH1cblxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignTGFtYmRhSGFuZGxlciBlcnJvcjogJywgZXJyb3JPYmopO1xuXG4gICAgICAgIC8vIEV4ZWN1dGUgZXJyb3IgbWlkZGxld2FyZVxuICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgICAgYXdhaXQgZW5kU3BhbihmYWxzZSwgZXJyb3JPYmosIHJlc3BvbnNlKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRXhjZXB0aW9uKHJlcXVlc3QsIGVycm9yT2JqLCByZXNwb25zZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBpbi1tZW1vcnkgcmVzcG9uc2VDb250ZXh0XG4gICAgICBhd2FpdCBlbmRTcGFuKHRydWUsIHVuZGVmaW5lZCwgcmVzcG9uc2UpO1xuICAgICAgcmV0dXJuIHJlc3BvbnNlLmJ1aWxkKCk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBtZXJnZWQgb2JzZXJ2YWJpbGl0eSBjb25maWcgZnJvbSBjb250cm9sbGVyIGFuZCBtZXRob2QgbGV2ZWxcbiAgICovXG4gIHByb3RlY3RlZCBnZXRPYnNlcnZhYmlsaXR5Q29uZmlnKHJvdXRlPzogUm91dGUgfCBudWxsKTogQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWcgPSB0aGlzLmdldENvbnRyb2xsZXJDb25maWcoKTtcbiAgICByZXR1cm4gbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyhjb250cm9sbGVyQ29uZmlnPy5vYnNlcnZhYmlsaXR5LCByb3V0ZT8ub2JzZXJ2YWJpbGl0eSk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgc3BhbiBhdHRyaWJ1dGVzIGJhc2VkIG9uIG9ic2VydmFiaWxpdHkgY29uZmlnLlxuICAgKiBBbHdheXMgaW5jbHVkZXMgYmFzaWMgSFRUUCBpbmZvLiBSZXF1ZXN0IGJvZHkvaGVhZGVycy9xdWVyeSBhcmUgb25seVxuICAgKiBpbmNsdWRlZCBpZiBleHBsaWNpdGx5IGNvbmZpZ3VyZWQgdmlhIGBpbmNsdWRlc2AuXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRTcGFuQXR0cmlidXRlcyhcbiAgICBldmVudDogQVBJR2F0ZXdheUV2ZW50LFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgY29uZmlnPzogQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWdcbiAgKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICAgIC8vIEFsd2F5cyBpbmNsdWRlIGJhc2ljIEhUVFAgYXR0cmlidXRlc1xuICAgIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgICdodHRwLm1ldGhvZCc6IHJlcXVlc3QuaHR0cE1ldGhvZCxcbiAgICAgICdodHRwLnBhdGgnOiByZXF1ZXN0LnBhdGgsXG4gICAgICAnaHR0cC5yZXF1ZXN0SWQnOiByZXF1ZXN0LnJlcXVlc3RJZCxcbiAgICAgICdodHRwLnVzZXJBZ2VudCc6IGV2ZW50LmhlYWRlcnM/LlsgJ3VzZXItYWdlbnQnIF0gfHwgZXZlbnQuaGVhZGVycz8uWyAnVXNlci1BZ2VudCcgXSxcbiAgICAgICdodHRwLnNvdXJjZUlwJzogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICB9O1xuXG4gICAgLy8gSWYgZGlzYWJsZWQgb3Igbm8gaW5jbHVkZXMgY29uZmlnLCByZXR1cm4gYmFzaWMgYXR0cnMgb25seVxuICAgIGlmIChjb25maWc/LmVuYWJsZWQgPT09IGZhbHNlIHx8ICFjb25maWc/LmluY2x1ZGVzKSB7XG4gICAgICByZXR1cm4gYXR0cnM7XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgcmVxdWVzdCBkYXRhIGJhc2VkIG9uIGluY2x1ZGVzIGNvbmZpZ1xuICAgIGNvbnN0IGluY2x1ZGVzID0gbm9ybWFsaXplSW5jbHVkZXMoY29uZmlnLmluY2x1ZGVzKTtcbiAgICBjb25zdCByZXF1ZXN0RGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcblxuICAgIGlmIChpbmNsdWRlcy5yZXF1ZXN0LmhlYWRlcnMpIHtcbiAgICAgIGNvbnN0IGhlYWRlckRhdGEgPSBzZWxlY3RGaWVsZHMocmVxdWVzdC5oZWFkZXJzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpbmNsdWRlcy5yZXF1ZXN0LmhlYWRlcnMpO1xuICAgICAgaWYgKGhlYWRlckRhdGEpIHJlcXVlc3REYXRhLmhlYWRlcnMgPSBoZWFkZXJEYXRhO1xuICAgIH1cblxuICAgIGlmIChpbmNsdWRlcy5yZXF1ZXN0LmJvZHkgJiYgcmVxdWVzdC5ib2R5KSB7XG4gICAgICBjb25zdCBib2R5RGF0YSA9IHR5cGVvZiByZXF1ZXN0LmJvZHkgPT09ICdzdHJpbmcnXG4gICAgICAgID8gc2VsZWN0RmllbGRzRnJvbUJvZHkocmVxdWVzdC5ib2R5LCBpbmNsdWRlcy5yZXF1ZXN0LmJvZHkpXG4gICAgICAgIDogc2VsZWN0RmllbGRzKHJlcXVlc3QuYm9keSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaW5jbHVkZXMucmVxdWVzdC5ib2R5KTtcbiAgICAgIGlmIChib2R5RGF0YSkgcmVxdWVzdERhdGEuYm9keSA9IGJvZHlEYXRhO1xuICAgIH1cblxuICAgIGlmIChpbmNsdWRlcy5yZXF1ZXN0LnF1ZXJ5ICYmIHJlcXVlc3QucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKSB7XG4gICAgICBjb25zdCBxdWVyeURhdGEgPSBzZWxlY3RGaWVsZHMocmVxdWVzdC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGluY2x1ZGVzLnJlcXVlc3QucXVlcnkpO1xuICAgICAgaWYgKHF1ZXJ5RGF0YSkgcmVxdWVzdERhdGEucXVlcnkgPSBxdWVyeURhdGE7XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgZGF0YSBwcm90ZWN0aW9uIGFuZCBhZGQgdG8gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhyZXF1ZXN0RGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgYXR0cnNbICdyZXF1ZXN0JyBdID0gY29uZmlnLmRhdGFQcm90ZWN0aW9uPy5lbmFibGVkICE9PSBmYWxzZVxuICAgICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEocmVxdWVzdERhdGEsIGNvbmZpZy5kYXRhUHJvdGVjdGlvbilcbiAgICAgICAgOiByZXF1ZXN0RGF0YTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cnM7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgcmVzcG9uc2UgYXR0cmlidXRlcyBiYXNlZCBvbiBvYnNlcnZhYmlsaXR5IGNvbmZpZy5cbiAgICogT25seSBjYXB0dXJlcyByZXNwb25zZSBib2R5L2hlYWRlcnMgaWYgZXhwbGljaXRseSBjb25maWd1cmVkIHZpYSBgaW5jbHVkZXNgLlxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkUmVzcG9uc2VBdHRyaWJ1dGVzKFxuICAgIHJlc3BvbnNlOiBSZXNwb25zZSxcbiAgICBjb25maWc/OiBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZ1xuICApOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZCB7XG4gICAgLy8gQWx3YXlzIGluY2x1ZGUgc3RhdHVzIGNvZGVcbiAgICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICAnaHR0cC5zdGF0dXNDb2RlJzogcmVzcG9uc2Uuc3RhdHVzQ29kZSxcbiAgICB9O1xuXG4gICAgLy8gSWYgZGlzYWJsZWQgb3Igbm8gaW5jbHVkZXMgY29uZmlnLCByZXR1cm4ganVzdCBzdGF0dXMgY29kZVxuICAgIGlmIChjb25maWc/LmVuYWJsZWQgPT09IGZhbHNlIHx8ICFjb25maWc/LmluY2x1ZGVzKSB7XG4gICAgICByZXR1cm4gYXR0cnM7XG4gICAgfVxuXG4gICAgY29uc3QgaW5jbHVkZXMgPSBub3JtYWxpemVJbmNsdWRlcyhjb25maWcuaW5jbHVkZXMpO1xuICAgIGNvbnN0IHJlc3BvbnNlRGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcblxuICAgIGlmIChpbmNsdWRlcy5yZXNwb25zZS5oZWFkZXJzICYmIHJlc3BvbnNlLmhlYWRlcnMpIHtcbiAgICAgIGNvbnN0IGhlYWRlckRhdGEgPSBzZWxlY3RGaWVsZHMocmVzcG9uc2UuaGVhZGVycyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaW5jbHVkZXMucmVzcG9uc2UuaGVhZGVycyk7XG4gICAgICBpZiAoaGVhZGVyRGF0YSkgcmVzcG9uc2VEYXRhLmhlYWRlcnMgPSBoZWFkZXJEYXRhO1xuICAgIH1cblxuICAgIGlmIChpbmNsdWRlcy5yZXNwb25zZS5ib2R5ICYmIHJlc3BvbnNlLmJvZHkpIHtcbiAgICAgIGNvbnN0IGJvZHlEYXRhID0gc2VsZWN0RmllbGRzRnJvbUJvZHkocmVzcG9uc2UuYm9keSwgaW5jbHVkZXMucmVzcG9uc2UuYm9keSk7XG4gICAgICBpZiAoYm9keURhdGEpIHJlc3BvbnNlRGF0YS5ib2R5ID0gYm9keURhdGE7XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgZGF0YSBwcm90ZWN0aW9uIGFuZCBhZGQgdG8gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhyZXNwb25zZURhdGEpLmxlbmd0aCA+IDApIHtcbiAgICAgIGF0dHJzWyAncmVzcG9uc2UnIF0gPSBjb25maWcuZGF0YVByb3RlY3Rpb24/LmVuYWJsZWQgIT09IGZhbHNlXG4gICAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShyZXNwb25zZURhdGEsIGNvbmZpZy5kYXRhUHJvdGVjdGlvbilcbiAgICAgICAgOiByZXNwb25zZURhdGE7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJzO1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSByb3V0ZSB0aGF0IG1hdGNoZXMgdGhlIEhUVFAgbWV0aG9kIGFuZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHJlcXVlc3REYXRhIC0gVGhlIHJlcXVlc3QgZGF0YSBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSBtYXRjaGluZyByb3V0ZSBvciBudWxsIGlmIG5vdCBmb3VuZC5cbiAgICovXG4gIHByaXZhdGUgZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdERhdGE6IFJlcXVlc3QpOiBSb3V0ZSB8IG51bGwge1xuICAgIGxldCBjb250cm9sbGVyOiBhbnkgPSB0aGlzO1xuXG4gICAgLy8gRGV0ZXJtaW5lIHRoZSBjb250cm9sbGVyIGJhc2UgcGF0aCBieSBmaW5kaW5nIHRoZSBsb25nZXN0IGNvbW1vbiBwcmVmaXggdGhhdCBlbmRzIHdpdGggdGhlIGNvbnRyb2xsZXIgbmFtZVxuICAgIGxldCBjb250cm9sbGVyQmFzZVBhdGggPSBgLyR7Y29udHJvbGxlci5jb250cm9sbGVyTmFtZX1gO1xuICAgIGxldCByZXNvdXJjZVdpdGhvdXRSb290ID0gJy8nO1xuXG4gICAgLy8gRm9yIGNvbnRyb2xsZXJzIGluIHN1YmRpcmVjdG9yaWVzLCB3ZSBuZWVkIHRvIG1hdGNoIHRoZSBhY3R1YWwgcmVzb3VyY2UgcGF0aFxuICAgIC8vIENoZWNrIGlmIHJlc291cmNlIGNvbnRhaW5zIHRoZSBjb250cm9sbGVyIG5hbWUgYXMgcGFydCBvZiBhIGxvbmdlciBwYXRoXG4gICAgY29uc3QgcmVzb3VyY2VQYXJ0cyA9IHJlcXVlc3REYXRhLnJlc291cmNlLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lUGFydHMgPSBjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuXG4gICAgLy8gRmluZCBpZiB0aGUgY29udHJvbGxlciBuYW1lIHBhcnRzIGFyZSBwcmVzZW50IGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgbGV0IGJhc2VQYXRoRW5kSW5kZXggPSAtMTtcbiAgICBpZiAoY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyBMb29rIGZvciB0aGUgY29udHJvbGxlciBuYW1lIHNlcXVlbmNlIGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSByZXNvdXJjZVBhcnRzLmxlbmd0aCAtIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgbGV0IG1hdGNoZXMgPSB0cnVlO1xuICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBpZiAocmVzb3VyY2VQYXJ0c1sgaSArIGogXSAhPT0gY29udHJvbGxlck5hbWVQYXJ0c1sgaiBdKSB7XG4gICAgICAgICAgICBtYXRjaGVzID0gZmFsc2U7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICBiYXNlUGF0aEVuZEluZGV4ID0gaSArIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoIC0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChiYXNlUGF0aEVuZEluZGV4ID49IDApIHtcbiAgICAgIC8vIEZvdW5kIHRoZSBjb250cm9sbGVyIGJhc2UgcGF0aCBpbiB0aGUgcmVzb3VyY2VcbiAgICAgIGNvbnN0IGJhc2VQYXRoUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKDAsIGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIGNvbnRyb2xsZXJCYXNlUGF0aCA9ICcvJyArIGJhc2VQYXRoUGFydHMuam9pbignLycpO1xuICAgICAgY29uc3QgcmVtYWluaW5nUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZW1haW5pbmdQYXJ0cy5sZW5ndGggPiAwID8gJy8nICsgcmVtYWluaW5nUGFydHMuam9pbignLycpIDogJy8nO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGYWxsYmFjayB0byBvcmlnaW5hbCBsb2dpYyBmb3Igc2ltcGxlIGNhc2VzXG4gICAgICBpZiAocmVxdWVzdERhdGEucmVzb3VyY2Uuc3RhcnRzV2l0aChjb250cm9sbGVyQmFzZVBhdGgpKSB7XG4gICAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZXF1ZXN0RGF0YS5yZXNvdXJjZS5zdWJzdHJpbmcoY29udHJvbGxlckJhc2VQYXRoLmxlbmd0aCkgfHwgJy8nO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlcGFyYXRlIHJvdXRlcyBpbnRvIGV4YWN0IGFuZCBwYXJhbWV0ZXJpemVkIGZvciBwcm9wZXIgcHJpb3JpdGl6YXRpb25cbiAgICBjb25zdCBleGFjdE1hdGNoZXM6IEFycmF5PHsgcm91dGVLZXk6IHN0cmluZywgcm91dGU6IFJvdXRlIH0+ID0gW107XG4gICAgY29uc3QgcGFyYW1ldGVyaXplZE1hdGNoZXM6IEFycmF5PHsgcm91dGVLZXk6IHN0cmluZywgcm91dGU6IFJvdXRlIH0+ID0gW107XG5cbiAgICAvLyBGaXJzdCBwYXNzOiBjYXRlZ29yaXplIHJvdXRlcyBieSB0eXBlIGFuZCBtZXRob2RcbiAgICBmb3IgKGNvbnN0IFsgcm91dGVLZXksIHJvdXRlIF0gb2YgT2JqZWN0LmVudHJpZXMoY29udHJvbGxlci5yb3V0ZXMgfHwge30pIGFzIFsgc3RyaW5nLCBSb3V0ZSBdW10pIHtcbiAgICAgIGNvbnN0IFsgcm91dGVNZXRob2QsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgLy8gU2tpcCBpZiBIVFRQIG1ldGhvZCBkb2Vzbid0IG1hdGNoXG4gICAgICBpZiAocm91dGVNZXRob2QgIT09IHJlcXVlc3REYXRhLmh0dHBNZXRob2QpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIENhdGVnb3JpemUgcm91dGUgdHlwZVxuICAgICAgaWYgKHJvdXRlUGF0aC5pbmNsdWRlcygneycpICYmIHJvdXRlUGF0aC5pbmNsdWRlcygnfScpKSB7XG4gICAgICAgIHBhcmFtZXRlcml6ZWRNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleGFjdE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZWNvbmQgcGFzczogVHJ5IGV4YWN0IG1hdGNoZXMgZmlyc3QgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgZm9yIChjb25zdCB7IHJvdXRlS2V5LCByb3V0ZSB9IG9mIGV4YWN0TWF0Y2hlcykge1xuICAgICAgY29uc3QgWyAsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgaWYgKHJvdXRlUGF0aCA9PT0gcmVzb3VyY2VXaXRob3V0Um9vdCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgZXhhY3QgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWApO1xuICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVGhpcmQgcGFzczogVHJ5IHBhcmFtZXRlcml6ZWQgbWF0Y2hlcyAoc29ydGVkIGJ5IHNwZWNpZmljaXR5KVxuICAgIC8vIFNvcnQgcGFyYW1ldGVyaXplZCByb3V0ZXMgYnkgc3BlY2lmaWNpdHkgKG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBwcmlvcml0eSlcbiAgICBjb25zdCBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcyA9IHBhcmFtZXRlcml6ZWRNYXRjaGVzXG4gICAgICAubWFwKCh7IHJvdXRlS2V5LCByb3V0ZSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG4gICAgICAgIGNvbnN0IHNlZ21lbnRzID0gcm91dGVQYXRoLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICBjb25zdCBsaXRlcmFsU2VnbWVudHMgPSBzZWdtZW50cy5maWx0ZXIoc2VnbWVudCA9PiAhc2VnbWVudC5pbmNsdWRlcygneycpKTtcblxuICAgICAgICAvLyBTcGVjaWZpY2l0eSBzY29yZTogbW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlXG4gICAgICAgIC8vIEZvciBlcXVhbCBsaXRlcmFsIHNlZ21lbnRzLCBmZXdlciB0b3RhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZSAgXG4gICAgICAgIGNvbnN0IHNwZWNpZmljaXR5U2NvcmUgPSAobGl0ZXJhbFNlZ21lbnRzLmxlbmd0aCAqIDEwMDApIC0gc2VnbWVudHMubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoLCBzcGVjaWZpY2l0eVNjb3JlIH07XG4gICAgICB9KVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGIuc3BlY2lmaWNpdHlTY29yZSAtIGEuc3BlY2lmaWNpdHlTY29yZSk7IC8vIEhpZ2hlciBzY29yZSBmaXJzdFxuXG4gICAgZm9yIChjb25zdCB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoIH0gb2Ygc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMpIHtcbiAgICAgIC8vIENvbnZlcnQgZnJhbWV3b3JrIHtpZH0gc3ludGF4IHRvIHBhdGgtdG8tcmVnZXhwIDppZCBzeW50YXhcbiAgICAgIGNvbnN0IHBhdGhUb1JlZ2V4cFBhdHRlcm4gPSByb3V0ZVBhdGgucmVwbGFjZSgvXFx7KFtefV0rKVxcfS9nLCAnOiQxJyk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFVzZSBwYXRoLXRvLXJlZ2V4cCBmb3IgcHJvcGVyIHBhcmFtZXRlciBtYXRjaGluZ1xuICAgICAgICBjb25zdCB7IG1hdGNoIH0gPSByZXF1aXJlKCdwYXRoLXRvLXJlZ2V4cCcpO1xuICAgICAgICBjb25zdCBtYXRjaGVyID0gbWF0Y2gocGF0aFRvUmVnZXhwUGF0dGVybiwgeyBkZWNvZGU6IGRlY29kZVVSSUNvbXBvbmVudCB9KTtcbiAgICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBtYXRjaGVyKHJlc291cmNlV2l0aG91dFJvb3QpO1xuXG4gICAgICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3VuZCBwYXJhbWV0ZXJpemVkIG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gLCB7XG4gICAgICAgICAgICBwYXR0ZXJuOiBwYXRoVG9SZWdleHBQYXR0ZXJuLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFJlc3VsdC5wYXJhbXMsXG4gICAgICAgICAgICBzcGVjaWZpY2l0eVNjb3JlOiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcy5maW5kKG0gPT4gbS5yb3V0ZUtleSA9PT0gcm91dGVLZXkpPy5zcGVjaWZpY2l0eVNjb3JlXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBOb3RlOiBXZSBkb24ndCBuZWVkIHRvIG1hbnVhbGx5IGV4dHJhY3QgcGFyYW1ldGVycyBzaW5jZSBBUEkgR2F0ZXdheVxuICAgICAgICAgIC8vIGFscmVhZHkgcHJvdmlkZXMgdGhlbSBpbiByZXF1ZXN0RGF0YS5wYXRoUGFyYW1ldGVyc1xuICAgICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRXJyb3IgbWF0Y2hpbmcgcm91dGUgcGF0dGVybiAke3BhdGhUb1JlZ2V4cFBhdHRlcm59OmAsIGVycm9yKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIud2FybihgTm8gbWF0Y2hpbmcgcm91dGUgZm91bmQgZm9yICR7cmVxdWVzdERhdGEuaHR0cE1ldGhvZH18JHtyZXNvdXJjZVdpdGhvdXRSb290fWApO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICogQHBhcmFtIHJvdXRlIC0gVGhlIG1hdGNoZWQgcm91dGUuXG4gICAqIEByZXR1cm5zIFRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlOiBSb3V0ZSB8IG51bGwpOiBGdW5jdGlvbiB7XG4gICAgaWYgKCFyb3V0ZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgICB9XG5cbiAgICAvL0B0cy1pZ25vcmVcbiAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpc1sgcm91dGUuZnVuY3Rpb25OYW1lIF07XG5cbiAgICByZXR1cm4gdHlwZW9mIHJvdXRlRnVuY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHJvdXRlRnVuY3Rpb24gOiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyB0aGUgTm90Rm91bmQgcm91dGUuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA0MDQgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlTm90Rm91bmQoX3JlcTogUmVxdWVzdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2Uoe1xuICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIk5vIFJvdXRlIEZvdW5kIVwiIH0pLFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGVycm9ySGFuZGxlcj86IENvbnRyb2xsZXJFcnJvckhhbmRsZXI7XG4gIHByb3RlY3RlZCBnZXRFcnJvckhhbmRsZXIoKTogQ29udHJvbGxlckVycm9ySGFuZGxlciB7XG4gICAgaWYgKCF0aGlzLmVycm9ySGFuZGxlcikge1xuICAgICAgdGhpcy5lcnJvckhhbmRsZXIgPSBjcmVhdGVFcnJvckhhbmRsZXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZXJyb3JIYW5kbGVyO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgZXhjZXB0aW9ucyBhbmQgcmV0dXJucyBhIEpTT04gcmVzcG9uc2Ugd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSBlcnIgLSBUaGUgZXJyb3Igb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA1MDAgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlRXhjZXB0aW9uKHJlcTogUmVxdWVzdCwgZXJyOiBFcnJvciwgcmVzOiBSZXNwb25zZSk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgY29uc3QgZXJyb3JSZXNwb25zZSA9IHRoaXMuZ2V0RXJyb3JIYW5kbGVyKCkoZXJyLCByZXEsIHJlcyk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoZXJyb3JSZXNwb25zZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlUmVzcG9uc2UocmVzOiBSZXNwb25zZSB8IEFQSUdhdGV3YXlQcm94eVJlc3VsdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgaWYgKHJlcyBpbnN0YW5jZW9mIFJlc3BvbnNlQ29udGV4dCkge1xuICAgICAgcmV0dXJuIHJlcy5idWlsZCgpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZXhlY3V0aW9uIGNvbnRleHQgZm9yIHRoZSByZXF1ZXN0XG4gICAqIFxuICAgKiBkaWZmZXJlbnQgbWlkZGxld2FyZSBjYW4gZW5oYW5jZSB0aGUgYWN0b3IgY29udGV4dCBieSB1c2luZyB0aGUgZW5oYW5jZUFjdG9yIG1ldGhvZFxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0c1xuICAgKiBjb25zdCBtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSA9IHtcbiAgICogIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0LCBfcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgKiAgIGN0eD8uZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgcm9sZXM6IFsnYWRtaW4nLCAndXNlciddLFxuICAgKiAgICAgcGVybWlzc2lvbnM6IFsncmVhZCcsICd3cml0ZSddLFxuICAgKiAgICAgc3Vic2NyaXB0aW9uOiB7IHRpZXI6ICdlbnRlcnByaXNlJyB9XG4gICAqICAgfSk7XG4gICAqICB9XG4gICAqIH1cbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlKTtcbiAgICogXG4gICAqIE9SXG4gICAqIFxuICAgKiBjb25zdCBzZWN1cml0eU1pZGRsZXdhcmUgPSB7XG4gICAqICAgYmVmb3JlOiBhc3luYyAocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgKiAgICAgY3R4LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgICAgcmlza1Byb2ZpbGU6IGF3YWl0IGFzc2Vzc1Jpc2soY3R4LmFjdG9yLmFjdG9ySWQpLFxuICAgKiAgICAgICBkZXZpY2U6IGF3YWl0IG1ha2VEZXZpY2VDb250ZXh0KHJlcXVlc3QpXG4gICAqICAgICB9KTtcbiAgICogICB9XG4gICAqIH07XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUoc2VjdXJpdHlNaWRkbGV3YXJlKTtcbiAgICpcbiAgICogQHBhcmFtIGV2ZW50IFxuICAgKiBAcGFyYW0gY29udGV4dCBcbiAgICogQHBhcmFtIHJlcXVlc3QgXG4gICAqIEBwYXJhbSByZXNwb25zZSBcbiAgICogQHJldHVybnMgXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRDdHgoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKTogRXhlY3V0aW9uQ29udGV4dCB7XG4gICAgY29uc3QgYWN0b3IgPSB0aGlzLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgY29uc3QgY3R4OiBFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgZXZlbnQsXG4gICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgYWN0b3IsXG4gICAgICBkZWJ1Z0luZm86IHt9LFxuXG4gICAgICAvLyBTaW1wbGUgYWN0b3IgZW5oYW5jZW1lbnQgbWV0aG9kXG4gICAgICBlbmhhbmNlQWN0b3I6IChlbmhhbmNlbWVudDogUGFydGlhbDxBY3Rvcj4pID0+IHtcbiAgICAgICAgaWYgKGN0eC5hY3Rvcikge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oY3R4LmFjdG9yLCBlbmhhbmNlbWVudCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIGN0eDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb250cm9sbGVyIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCBnZXRDb250cm9sbGVyQ29uZmlnKCk6IElDb250cm9sbGVyQ29uZmlnIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ2NvbnRyb2xsZXJDb25maWcnKSB8fCB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhY3RvciBjb250ZXh0IGZyb20gdGhlIHJlcXVlc3QuXG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGZvciBjdXN0b20gYWN0b3IgZXh0cmFjdGlvbiBsb2dpYy5cbiAgICogXG4gICAqIE5vdGU6IGNvcnJlbGF0aW9uSWQgaXMgTk9UIHNldCBoZXJlIC0gaXQncyBkZXRlcm1pbmVkIGZyb20gdHJhY2UgY29udGV4dFxuICAgKiBleHRyYWN0aW9uIGFuZCBzZXQgb24gdGhlIEV4ZWN1dGlvbkNvbnRleHQuIFRoZSBhY3Rvci5jb3JyZWxhdGlvbklkIGlzXG4gICAqIHN5bmNlZCBsYXRlciBpbiBMYW1iZGFIYW5kbGVyIGFmdGVyIHRyYWNlIGNvbnRleHQgaXMgcmVzb2x2ZWQuXG4gICAqXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSByZXF1ZXN0IC0gVGhlIHJlcXVlc3Qgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgYWN0b3IgY29udGV4dC5cbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QpOiBBY3RvciB7XG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlcXVlc3QucmVxdWVzdElkO1xuXG4gICAgY29uc3QgYWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkLFxuICAgICAgdGltZXN0YW1wLFxuICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnM/LlsgJ3VzZXItYWdlbnQnIF0gfHwgZXZlbnQuaGVhZGVycz8uWyAnVXNlci1BZ2VudCcgXSxcbiAgICAgIC8vIE5vdGU6IGNvcnJlbGF0aW9uSWQgaXMgc2V0IGxhdGVyIGFmdGVyIHRyYWNlIGNvbnRleHQgZXh0cmFjdGlvblxuICAgIH07XG5cbiAgICAvLyBDb2duaXRvIGF1dGhlbnRpY2F0aW9uIHdpdGggZm9jdXNlZCBlbmhhbmNlbWVudHNcbiAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcykge1xuICAgICAgdGhpcy5leHRyYWN0Q29nbml0b0NvbnRleHQoZXZlbnQucmVxdWVzdENvbnRleHQuYXV0aG9yaXplci5jbGFpbXMsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gQVBJIEtleSBhdXRoZW50aWNhdGlvblxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5IHx8IHJlcXVlc3QuaGVhZGVycz8uWyAneC1hcGkta2V5JyBdKSB7XG4gICAgICB0aGlzLmV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50LCByZXF1ZXN0LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIElBTSBhdXRoZW50aWNhdGlvbiBcbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4pIHtcbiAgICAgIHRoaXMuZXh0cmFjdElhbUNvbnRleHQoZXZlbnQsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gQW5vbnltb3VzXG4gICAgZWxzZSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSAnYW5vbnltb3VzJztcbiAgICB9XG5cbiAgICAvLyBTZXNzaW9uIGFuZCB0ZW5hbnQgY29udGV4dFxuICAgIHRoaXMuZXh0cmFjdFNlc3Npb25BbmRUZW5hbnRDb250ZXh0KGV2ZW50LCByZXF1ZXN0LCBhY3Rvcik7XG5cbiAgICAvLyBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAgYWN0b3IuYXBpU3RhZ2UgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uc3RhZ2U7XG4gICAgYWN0b3IuYXBpSWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXBpSWQ7XG5cbiAgICByZXR1cm4gYWN0b3I7XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBDb2duaXRvIGFjdG9yIGNvbnRleHQgYmFzZWQgb24gZG9jdW1lbnRlZCBBV1MgQ29nbml0byBKV1QgY2xhaW1zXG4gICAqIE9ubHkgZXh0cmFjdHMgd2hhdCdzIG9mZmljaWFsbHkgZG9jdW1lbnRlZCBhbmQgYXZhaWxhYmxlIGluIEFQSSBHYXRld2F5IGNvbnRleHRcbiAgICogXG4gICAqIEBwYXJhbSBjbGFpbXMgLSBDb2duaXRvIEpXVCBjbGFpbXMgZnJvbSB0aGUgYXV0aG9yaXplclxuICAgKiBAcGFyYW0gYWN0b3IgLSBBY3RvciBvYmplY3QgdG8gcG9wdWxhdGVcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q29nbml0b0NvbnRleHQoY2xhaW1zOiBhbnksIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2NvZ25pdG8nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3VzZXInO1xuXG4gICAgICAvLyBBY3RvciBJRCB3aXRoIGRvY3VtZW50ZWQgZmFsbGJhY2sgc3RyYXRlZ3k6IGNvZ25pdG86dXNlcm5hbWUgLT4gZW1haWwgLT4gc3ViXG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zWyAnY29nbml0bzp1c2VybmFtZScgXSB8fCBjbGFpbXMuZW1haWwgfHwgY2xhaW1zLnN1YjtcblxuICAgICAgLy8gU3RhbmRhcmQgdXNlciBhdHRyaWJ1dGVzIChkb2N1bWVudGVkIENvZ25pdG8gdXNlciBhdHRyaWJ1dGVzKVxuICAgICAgYWN0b3IuZW1haWwgPSBjbGFpbXMuZW1haWw7XG4gICAgICBhY3Rvci5lbWFpbFZlcmlmaWVkID0gY2xhaW1zLmVtYWlsX3ZlcmlmaWVkID09PSAndHJ1ZSc7XG4gICAgICBhY3Rvci5waG9uZU51bWJlciA9IGNsYWltcy5waG9uZV9udW1iZXI7XG4gICAgICBhY3Rvci5waG9uZVZlcmlmaWVkID0gY2xhaW1zLnBob25lX251bWJlcl92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IubmFtZSA9IGNsYWltcy5uYW1lO1xuICAgICAgYWN0b3IubG9jYWxlID0gY2xhaW1zLmxvY2FsZTtcblxuICAgICAgLy8gUGFyc2UgQ29nbml0byBncm91cHMgKGRvY3VtZW50ZWQgYXMgY29tbWEtc2VwYXJhdGVkIHN0cmluZylcbiAgICAgIGNvbnN0IGdyb3VwcyA9IHRoaXMucGFyc2VHcm91cHMoY2xhaW1zWyAnY29nbml0bzpncm91cHMnIF0pO1xuXG4gICAgICAvLyBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIChkb2N1bWVudGVkIHBhdHRlcm46IGN1c3RvbToqKVxuICAgICAgY29uc3QgY3VzdG9tQXR0cmlidXRlcyA9IHRoaXMuZXh0cmFjdEN1c3RvbUF0dHJpYnV0ZXMoY2xhaW1zKTtcblxuICAgICAgLy8gQnVpbGQgQ29nbml0byBjb250ZXh0IHdpdGggb25seSBkb2N1bWVudGVkIGZpZWxkc1xuICAgICAgYWN0b3IuY29nbml0byA9IHtcbiAgICAgICAgc3ViOiBjbGFpbXMuc3ViLFxuICAgICAgICB1c2VybmFtZTogY2xhaW1zWyAnY29nbml0bzp1c2VybmFtZScgXSxcbiAgICAgICAgZ3JvdXBzOiBncm91cHMsIC8vIEFsd2F5cyBpbmNsdWRlIGdyb3VwcyBhcnJheSAoZW1wdHkgb3IgcG9wdWxhdGVkKVxuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzOiBPYmplY3Qua2V5cyhjdXN0b21BdHRyaWJ1dGVzKS5sZW5ndGggPiAwID8gY3VzdG9tQXR0cmlidXRlcyA6IHVuZGVmaW5lZFxuICAgICAgfTtcblxuICAgICAgLy8gRXh0cmFjdCB0ZW5hbnQgSUQgZnJvbSBjdXN0b20gYXR0cmlidXRlcyAoY29tbW9uIG11bHRpLXRlbmFudCBwYXR0ZXJuKVxuICAgICAgYWN0b3IudGVuYW50SWQgPSBjdXN0b21BdHRyaWJ1dGVzLnRlbmFudElkO1xuXG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdFcnJvciBleHRyYWN0aW5nIENvZ25pdG8gYWN0b3IgY29udGV4dCcsIHsgZXJyb3IsIGNsYWltcyB9KTtcblxuICAgICAgLy8gTWluaW1hbCBmYWxsYmFjayBleHRyYWN0aW9uXG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2NvZ25pdG8nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3VzZXInO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltcy5zdWIgfHwgJ3Vua25vd24nO1xuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlIENvZ25pdG8gZ3JvdXBzIGZyb20gY29tbWEtc2VwYXJhdGVkIHN0cmluZyAoZG9jdW1lbnRlZCBDb2duaXRvIGZvcm1hdClcbiAgICovXG4gIHByb3RlY3RlZCBwYXJzZUdyb3Vwcyhncm91cHM6IGFueSk6IHN0cmluZ1tdIHtcbiAgICBpZiAodHlwZW9mIGdyb3VwcyA9PT0gJ3N0cmluZycgJiYgZ3JvdXBzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBncm91cHMuc3BsaXQoJywnKS5tYXAoZyA9PiBnLnRyaW0oKSkuZmlsdGVyKGcgPT4gZy5sZW5ndGggPiAwKTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXMgdXNpbmcgZG9jdW1lbnRlZCBDb2duaXRvIHBhdHRlcm4gKGN1c3RvbToqKVxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltczogYW55KTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgY29uc3QgY3VzdG9tQXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuXG4gICAgT2JqZWN0LmtleXMoY2xhaW1zKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoJ2N1c3RvbTonKSkge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0ga2V5LnJlcGxhY2UoJ2N1c3RvbTonLCAnJyk7XG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXNbIGF0dHJpYnV0ZU5hbWUgXSA9IGNsYWltc1sga2V5IF07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gY3VzdG9tQXR0cmlidXRlcztcbiAgfVxuXG4gIC8qKlxuICogRXh0cmFjdCBzZXNzaW9uIGFuZCB0ZW5hbnQgY29udGV4dCAtIGZvY3VzZWQgYXBwcm9hY2hcbiAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdFNlc3Npb25BbmRUZW5hbnRDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIC8vIFNlc3Npb24gY29udGV4dFxuICAgIGFjdG9yLnNlc3Npb25JZCA9IHJlcXVlc3QuaGVhZGVycz8uWyAneC1zZXNzaW9uLWlkJyBdO1xuXG4gICAgLy8gVGVuYW50IGNvbnRleHQgLSBjaGVjayBjdXN0b20gYXR0cmlidXRlcyBmaXJzdCwgdGhlbiBoZWFkZXJzXG4gICAgYWN0b3IudGVuYW50SWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtdGVuYW50LWlkJyBdIHx8XG4gICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zPy5bICdjdXN0b206dGVuYW50SWQnIF07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBBUEkgS2V5IGNvbnRleHRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QXBpS2V5Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2FwaS1rZXknO1xuICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcblxuICAgIGxldCBhcGlLZXlJZDogc3RyaW5nO1xuICAgIGxldCBzb3VyY2U6ICdyZXF1ZXN0LWNvbnRleHQnIHwgJ2hlYWRlcic7XG5cbiAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkpIHtcbiAgICAgIGFwaUtleUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuYXBpS2V5SWQgfHwgZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuYXBpS2V5O1xuICAgICAgc291cmNlID0gJ3JlcXVlc3QtY29udGV4dCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFwaUtleUlkID0gcmVxdWVzdC5oZWFkZXJzWyAneC1hcGkta2V5JyBdITtcbiAgICAgIHNvdXJjZSA9ICdoZWFkZXInO1xuICAgIH1cblxuICAgIGFjdG9yLmFjdG9ySWQgPSBgYXBpLWtleToke2FwaUtleUlkfWA7XG4gICAgYWN0b3IuYXBpS2V5ID0ge1xuICAgICAgaWQ6IGFwaUtleUlkLFxuICAgICAgc291cmNlOiBzb3VyY2UsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IElBTSBjb250ZXh0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdElhbUNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdpYW0nO1xuICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcbiAgICBhY3Rvci5hY3RvcklkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyIHx8XG4gICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHxcbiAgICAgICd1bmtub3duLWlhbS11c2VyJztcblxuICAgIGFjdG9yLmlhbSA9IHtcbiAgICAgIHVzZXJBcm46IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybiB8fCB1bmRlZmluZWQsXG4gICAgICB1c2VySWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fCB1bmRlZmluZWQsXG4gICAgICBhY2NvdW50SWQ6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYWNjb3VudElkIHx8IHVuZGVmaW5lZCxcbiAgICAgIGNhbGxlcjogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5jYWxsZXIgfHwgdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cbn1cbiJdfQ==