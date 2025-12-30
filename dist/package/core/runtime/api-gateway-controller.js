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
const errors_1 = require("../../errors/");
const observability_1 = require("../../observability");
const controller_config_1 = require("../../observability/controller-config");
const utils_1 = require("../../validation/utils");
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const execution_context_1 = require("./execution-context");
const request_context_1 = require("./request-context");
const response_config_1 = require("./response-config");
const response_context_1 = require("./response-context");
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
        this.initializeEntryPackagesAndObservability();
        const request = await this.makeRequestContext(event, context);
        const response = await this.makeResponseContext(request);
        // Build the execution context
        const ctx = this.buildCtx(event, context, request, response);
        // Find the matching route (needed for observability config)
        const route = this.findMatchingRoute(request);
        // Get merged observability config
        const observabilityConfig = this.getObservabilityConfig(route);
        const defaultSource = `${this.constructor.name}.${route?.functionName || 'handler'}`;
        // Extract upstream trace context from incoming headers.
        // IMPORTANT (framework contract):
        // - correlationId is per-invocation (local slice)
        // - causedBy links to upstream invocation/trace
        const traceContext = (0, execution_context_1.extractFromHeaders)(request.headers || {});
        const correlationId = request.requestId || (0, observability_1.generateTraceId)();
        const causedBy = traceContext?.causedBy ?? traceContext?.correlationId;
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            causedBy,
            actor: ctx.actor,
            sampled: traceContext?.sampled,
            source: observabilityConfig?.source || defaultSource,
            tags: observabilityConfig?.tags,
        });
        // Build span attributes (includes request data capture)
        const spanAttributes = this.buildSpanAttributes(event, request, observabilityConfig);
        // Build automatic tags for easy filtering
        const automaticTags = this.buildAutomaticTags(request, ctx.actor, event);
        // Run entire handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Set ctx.executionContext to point to the execution context
            ctx.executionContext = execCtx;
            // Sync actor.correlationId with the resolved correlationId
            // This ensures actor stored in _actor field has the correct trace ID
            if (ctx.actor) {
                ctx.actor.correlationId = correlationId;
            }
            // Use the base class helper for span + flush pattern
            return this.executeWithSpanAndFlush(`HTTP ${request.httpMethod} ${request.path}`, async (requestSpan) => {
                try {
                    // Legacy initialize method for backward compatibility
                    await this.initialize(event, context);
                    // Execute before middleware
                    await this.executeMiddlewarePipeline('before', request, response, ctx);
                    // Validate the request if validations are defined
                    if (route?.validations) {
                        const validationResult = await this.validate(request, route.validations);
                        if (!validationResult.pass) {
                            // Add validation failure to span for debugging
                            if (validationResult.errors && validationResult.errors.length > 0) {
                                requestSpan.checkpoint('validation.failed', {
                                    tags: {
                                        'validation.failed': 'true',
                                    },
                                    metrics: {
                                        'validation.error_count': validationResult.errors.length,
                                    },
                                    data: {
                                        validationErrors: validationResult.errors,
                                    },
                                });
                            }
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
                        if (observabilityConfig?.enabled !== false) {
                            const responseAttrs = this.buildResponseAttributes(response, observabilityConfig);
                            if (responseAttrs) {
                                // Status code as metric, rest as data
                                if (responseAttrs['http.statusCode']) {
                                    requestSpan.metric('http.statusCode', responseAttrs['http.statusCode']);
                                }
                                requestSpan.setData(responseAttrs);
                            }
                        }
                        // Flush happens automatically in executeWithSpanAndFlush's finally block
                        return this.handleResponse(controllerResponse);
                    }
                    // Fallback to the in-memory responseContext
                    if (observabilityConfig?.enabled !== false) {
                        const responseAttrs = this.buildResponseAttributes(response, observabilityConfig);
                        if (responseAttrs) {
                            if (responseAttrs['http.statusCode']) {
                                requestSpan.metric('http.statusCode', responseAttrs['http.statusCode']);
                            }
                            requestSpan.setData(responseAttrs);
                        }
                    }
                    // Flush happens automatically in executeWithSpanAndFlush's finally block
                    return response.build();
                }
                catch (err) {
                    const errorObj = err instanceof Error ? err : new Error(String(err));
                    this.logger.error('LambdaHandler error: ', errorObj);
                    // Execute error middleware
                    await this.executeMiddlewarePipeline('onError', request, response, ctx, errorObj);
                    // Flush happens automatically in executeWithSpanAndFlush's finally block
                    // Note: withSpan will call span.end({ success: false, error }) automatically
                    // We still need to return a response (error handler may have modified it)
                    throw errorObj;
                }
            }, {
                correlationId,
                causedBy: traceContext?.causedBy,
                actor: ctx.actor,
                source: observabilityConfig?.source || defaultSource,
                tags: {
                    ...automaticTags,
                    ...observabilityConfig?.tags,
                    ...spanAttributes,
                    'http.route': route?.functionName || '',
                    'http.controller': this.constructor.name,
                },
            }).catch((err) => {
                // Handle error response after span ends
                return this.handleException(request, err instanceof Error ? err : new Error(String(err)), response);
            });
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
     * Build automatic tags for HTTP requests.
     * These tags enable powerful filtering in observability UIs.
     */
    buildAutomaticTags(request, actor, event) {
        const tags = {};
        // HTTP method category (similar to service operations)
        const method = request.httpMethod.toUpperCase();
        if (method === 'GET' || method === 'HEAD') {
            tags.operation_category = 'read';
        }
        else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
            tags.operation_category = 'write';
        }
        else if (method === 'DELETE') {
            tags.operation_category = 'delete';
        }
        // Auth method for easy filtering by authentication type
        if (actor?.authMethod) {
            tags.auth_method = actor.authMethod;
        }
        // Actor type (user vs service)
        if (actor?.actorType) {
            tags.actor_type = actor.actorType;
        }
        // API stage (dev, staging, prod)
        if (event.requestContext?.stage) {
            tags.stage = event.requestContext.stage;
        }
        // Tenant context (for multi-tenant filtering)
        if (actor?.tenantId) {
            tags.tenant_id = actor.tenantId;
        }
        return tags;
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
        const controllerName = typeof controller.controllerName === 'string' ? controller.controllerName : '';
        let controllerBasePath = controllerName ? `/${controllerName}` : '';
        let resourceWithoutRoot = '/';
        // For controllers in subdirectories, we need to match the actual resource path
        // Check if resource contains the controller name as part of a longer path
        const requestResource = (requestData.resource || requestData.path || '/');
        const resourceParts = requestResource.split('/').filter(Boolean);
        const controllerNameParts = controllerName.split('/').filter(Boolean);
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
            if (controllerBasePath && requestResource.startsWith(controllerBasePath)) {
                resourceWithoutRoot = requestResource.substring(controllerBasePath.length) || '/';
            }
            else if (!controllerBasePath) {
                // No controllerName configured: treat the full resource as the route path.
                resourceWithoutRoot = requestResource || '/';
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFtRUEsNENBeUJDO0FBM0ZELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFDNUQsMENBQWlIO0FBRWpILHVEQUF5RjtBQUN6Riw2RUFNK0M7QUFFL0Msa0RBQTRGO0FBRTVGLHVFQUFrRTtBQUNsRSwyREFJNkI7QUFDN0IsdURBQW1EO0FBQ25ELHVEQUF3RTtBQUN4RSx5REFBcUQ7QUFXckQsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7QUFFM0QsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDLENBQUE7QUFGWSxRQUFBLGdCQUFnQixvQkFFNUI7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BSXFCLEVBQ3JCLE9BQXFGO0lBR3JGLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsWUFBRyxFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFHdkUsSUFBTSxvQkFBb0IsR0FBMUIsTUFBTSxvQkFBb0I7UUFFbEIsQUFBTixLQUFLLENBQUMsYUFBYTtZQUNqQixzREFBc0Q7UUFDeEQsQ0FBQztLQUNGLENBQUE7SUFITztRQURMLE1BQU0sQ0FBQyxJQUFJLENBQUM7NkRBR1o7SUFKRyxvQkFBb0I7UUFEekIsSUFBQSx1QkFBVSxFQUFDLElBQUksRUFBRSxFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsdUJBQXVCLEVBQUUsS0FBSyxFQUFFLENBQUM7T0FDcEUsb0JBQW9CLENBS3pCO0lBRUQsTUFBTSxDQUFDLGNBQWMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7SUFFN0QsT0FBTztRQUNMLE9BQU87UUFDUCxVQUFVLEVBQUUsb0JBQW9CO0tBQ2pDLENBQUM7QUFDSixDQUFDO0FBTUQsTUFBc0IsYUFBYyxTQUFRLCtDQUFxQjtJQUNyRCxXQUFXLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7SUFDdEQsY0FBYyxDQUFpQjtJQUV6QyxZQUFZLFNBQThCLEVBQUU7UUFDMUMsS0FBSyxFQUFFLENBQUM7UUFDUixJQUFJLENBQUMsY0FBYyxHQUFHLElBQUEscUNBQW1CLEVBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFFRDs7Ozs7TUFLRTtJQUNRLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBdUIsRUFBRSxRQUFpQjtRQUNuRSw0QkFBNEI7UUFDNUIsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVTLEtBQUssQ0FBQywrQ0FBK0M7UUFDN0QsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksR0FBRyxFQUFrQixDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVELHFDQUFxQztJQUMzQixhQUFhLENBQUMsVUFBbUM7UUFDekQsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7SUFDbkMsQ0FBQztJQUVTLGNBQWM7UUFDdEIsT0FBTyxDQUFFLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUUsQ0FBQztJQUMvRSxDQUFDO0lBRUQsOEJBQThCO0lBQ3RCLEtBQUssQ0FBQyx5QkFBeUIsQ0FDckMsS0FBcUMsRUFDckMsT0FBZ0IsRUFDaEIsUUFBa0IsRUFDbEIsR0FBc0IsRUFDdEIsS0FBYTtRQUdiLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUU3QyxLQUFLLE1BQU0sVUFBVSxJQUFJLGNBQWMsRUFBRSxDQUFDO1lBQ3hDLElBQUksS0FBSyxLQUFLLFNBQVMsSUFBSSxVQUFVLENBQUMsT0FBTyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUN2RCxNQUFNLFVBQVUsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDMUQsQ0FBQztpQkFBTSxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksVUFBVSxDQUFFLEtBQUssQ0FBRSxFQUFFLENBQUM7Z0JBQ3RELE1BQU0sVUFBVSxDQUFFLEtBQUssQ0FBRyxDQUFDLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDckQsQ0FBQztRQUNILENBQUM7SUFFSCxDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxjQUF1QixFQUFFLFdBQXlELEVBQUUsSUFBdUI7UUFFeEgsSUFBSSxlQUFlLEdBQTJCLFdBQVcsQ0FBQztRQUMxRCxJQUFJLElBQUEsNkJBQXFCLEVBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUN2QyxJQUFJLENBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBRSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLFdBQVcsRUFBRSxDQUFDLEVBQUUsQ0FBQztnQkFFMUUsZUFBZSxHQUFHLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxDQUFBO1lBRTFDLENBQUM7aUJBQU0sSUFBSSxDQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFFLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxDQUFDO2dCQUV4RixlQUFlLEdBQUcsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLENBQUE7WUFDekMsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsSUFBQSxtQ0FBMkIsRUFBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sSUFBSSw4Q0FBcUMsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLG1CQUFtQixDQUFDO1lBQ3hDLGNBQWM7WUFDZCxXQUFXLEVBQUUsZUFBZTtZQUM1QixhQUFhLEVBQUUsSUFBSTtZQUNuQixhQUFhLEVBQUUsY0FBYyxDQUFDLFNBQVM7WUFDdkMsdUJBQXVCLEVBQUUsTUFBTSxJQUFJLENBQUMsK0NBQStDLEVBQUU7U0FDdEYsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxLQUFzQixFQUFFLE9BQWdCO1FBQy9ELE9BQU8sSUFBSSxnQ0FBYyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRUQsS0FBSyxDQUFDLG1CQUFtQixDQUFDLGNBQXVCO1FBQy9DLE9BQU8sSUFBSSxrQ0FBZSxDQUFDO1lBQ3pCLE9BQU8sRUFBRSxjQUFjLENBQUMsU0FBUztZQUNqQyxTQUFTLEVBQUUsY0FBYyxDQUFDLFNBQVM7WUFDbkMsU0FBUyxFQUFFLGNBQWMsQ0FBQyxTQUFTO1lBQ25DLEtBQUssRUFBRSxjQUFjLENBQUMsSUFBSTtZQUMxQixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7WUFDbkMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxJQUFJLGFBQWE7WUFDbEQsTUFBTSxFQUFFLElBQUksQ0FBQyxjQUFjO1NBQzVCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxLQUFzQixFQUFFLE9BQWdCO1FBQzFELElBQUksQ0FBQyx1Q0FBdUMsRUFBRSxDQUFDO1FBRS9DLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztRQUM5RCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUV6RCw4QkFBOEI7UUFDOUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztRQUU3RCw0REFBNEQ7UUFDNUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRTlDLGtDQUFrQztRQUNsQyxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUMvRCxNQUFNLGFBQWEsR0FBRyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxJQUFJLEtBQUssRUFBRSxZQUFZLElBQUksU0FBUyxFQUFFLENBQUM7UUFFckYsd0RBQXdEO1FBQ3hELGtDQUFrQztRQUNsQyxrREFBa0Q7UUFDbEQsZ0RBQWdEO1FBQ2hELE1BQU0sWUFBWSxHQUFHLElBQUEsc0NBQWtCLEVBQUMsT0FBTyxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMvRCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsU0FBUyxJQUFJLElBQUEsK0JBQWUsR0FBRSxDQUFDO1FBQzdELE1BQU0sUUFBUSxHQUFHLFlBQVksRUFBRSxRQUFRLElBQUksWUFBWSxFQUFFLGFBQWEsQ0FBQztRQUV2RSxzRUFBc0U7UUFDdEUsTUFBTSxPQUFPLEdBQUcsSUFBQSwwQ0FBc0IsRUFBQztZQUNyQyxhQUFhO1lBQ2IsUUFBUTtZQUNSLEtBQUssRUFBRSxHQUFHLENBQUMsS0FBSztZQUNoQixPQUFPLEVBQUUsWUFBWSxFQUFFLE9BQU87WUFDOUIsTUFBTSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sSUFBSSxhQUFhO1lBQ3BELElBQUksRUFBRSxtQkFBbUIsRUFBRSxJQUFJO1NBQ2hDLENBQUMsQ0FBQztRQUVILHdEQUF3RDtRQUN4RCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1FBRXJGLDBDQUEwQztRQUMxQyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFekUsOENBQThDO1FBQzlDLE9BQU8sSUFBQSwyQ0FBdUIsRUFBQyxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDakQsNkRBQTZEO1lBQzdELEdBQUcsQ0FBQyxnQkFBZ0IsR0FBRyxPQUFPLENBQUM7WUFFL0IsMkRBQTJEO1lBQzNELHFFQUFxRTtZQUNyRSxJQUFJLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztnQkFDZCxHQUFHLENBQUMsS0FBSyxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUM7WUFDMUMsQ0FBQztZQUVELHFEQUFxRDtZQUNyRCxPQUFPLElBQUksQ0FBQyx1QkFBdUIsQ0FDakMsUUFBUSxPQUFPLENBQUMsVUFBVSxJQUFJLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFDNUMsS0FBSyxFQUFFLFdBQVcsRUFBRSxFQUFFO2dCQUNwQixJQUFJLENBQUM7b0JBQ0gsc0RBQXNEO29CQUN0RCxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO29CQUV0Qyw0QkFBNEI7b0JBQzVCLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLFFBQVEsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO29CQUV2RSxrREFBa0Q7b0JBQ2xELElBQUksS0FBSyxFQUFFLFdBQVcsRUFBRSxDQUFDO3dCQUN2QixNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO3dCQUN6RSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLENBQUM7NEJBQzNCLCtDQUErQzs0QkFDL0MsSUFBSSxnQkFBZ0IsQ0FBQyxNQUFNLElBQUksZ0JBQWdCLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQ0FDbEUsV0FBVyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRTtvQ0FDMUMsSUFBSSxFQUFFO3dDQUNKLG1CQUFtQixFQUFFLE1BQU07cUNBQzVCO29DQUNELE9BQU8sRUFBRTt3Q0FDUCx3QkFBd0IsRUFBRSxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsTUFBTTtxQ0FDekQ7b0NBQ0QsSUFBSSxFQUFFO3dDQUNKLGdCQUFnQixFQUFFLGdCQUFnQixDQUFDLE1BQU07cUNBQzFDO2lDQUNGLENBQUMsQ0FBQzs0QkFDTCxDQUFDOzRCQUNELE1BQU0sSUFBSSw4QkFBcUIsQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQzt3QkFDM0QsQ0FBQztvQkFDSCxDQUFDO29CQUVELDBCQUEwQjtvQkFDMUIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDO29CQUNuRCxJQUFJLGtCQUFrQixHQUFRLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7b0JBQy9FLElBQUksa0JBQWtCLFlBQVksT0FBTyxFQUFFLENBQUM7d0JBQzFDLGtCQUFrQixHQUFHLE1BQU0sa0JBQWtCLENBQUM7b0JBQ2hELENBQUM7b0JBRUQsMkJBQTJCO29CQUMzQixNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztvQkFFdEUsaURBQWlEO29CQUNqRCxJQUFJLGtCQUFrQixJQUFJLElBQUksRUFBRSxDQUFDO3dCQUMvQixJQUFJLG1CQUFtQixFQUFFLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQzs0QkFDM0MsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFFBQVEsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDOzRCQUNsRixJQUFJLGFBQWEsRUFBRSxDQUFDO2dDQUNsQixzQ0FBc0M7Z0NBQ3RDLElBQUksYUFBYSxDQUFFLGlCQUFpQixDQUFFLEVBQUUsQ0FBQztvQ0FDdkMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxhQUFhLENBQUUsaUJBQWlCLENBQVksQ0FBQyxDQUFDO2dDQUN0RixDQUFDO2dDQUNELFdBQVcsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUM7NEJBQ3JDLENBQUM7d0JBQ0gsQ0FBQzt3QkFDRCx5RUFBeUU7d0JBQ3pFLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO29CQUNqRCxDQUFDO29CQUVELDRDQUE0QztvQkFDNUMsSUFBSSxtQkFBbUIsRUFBRSxPQUFPLEtBQUssS0FBSyxFQUFFLENBQUM7d0JBQzNDLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxRQUFRLEVBQUUsbUJBQW1CLENBQUMsQ0FBQzt3QkFDbEYsSUFBSSxhQUFhLEVBQUUsQ0FBQzs0QkFDbEIsSUFBSSxhQUFhLENBQUUsaUJBQWlCLENBQUUsRUFBRSxDQUFDO2dDQUN2QyxXQUFXLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLGFBQWEsQ0FBRSxpQkFBaUIsQ0FBWSxDQUFDLENBQUM7NEJBQ3RGLENBQUM7NEJBQ0QsV0FBVyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQzt3QkFDckMsQ0FBQztvQkFDSCxDQUFDO29CQUNELHlFQUF5RTtvQkFDekUsT0FBTyxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBRTFCLENBQUM7Z0JBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztvQkFDYixNQUFNLFFBQVEsR0FBRyxHQUFHLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO29CQUNyRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxRQUFRLENBQUMsQ0FBQztvQkFFckQsMkJBQTJCO29CQUMzQixNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7b0JBRWxGLHlFQUF5RTtvQkFDekUsNkVBQTZFO29CQUM3RSwwRUFBMEU7b0JBQzFFLE1BQU0sUUFBUSxDQUFDO2dCQUNqQixDQUFDO1lBQ0gsQ0FBQyxFQUNEO2dCQUNFLGFBQWE7Z0JBQ2IsUUFBUSxFQUFFLFlBQVksRUFBRSxRQUFRO2dCQUNoQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUs7Z0JBQ2hCLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxNQUFNLElBQUksYUFBYTtnQkFDcEQsSUFBSSxFQUFFO29CQUNKLEdBQUcsYUFBYTtvQkFDaEIsR0FBRyxtQkFBbUIsRUFBRSxJQUFJO29CQUM1QixHQUFHLGNBQWM7b0JBQ2pCLFlBQVksRUFBRSxLQUFLLEVBQUUsWUFBWSxJQUFJLEVBQUU7b0JBQ3ZDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSTtpQkFDekM7YUFDRixDQUNGLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7Z0JBQ2Qsd0NBQXdDO2dCQUN4QyxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxFQUFFLEdBQUcsWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDdEcsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNPLHNCQUFzQixDQUFDLEtBQW9CO1FBQ25ELE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7UUFDcEQsT0FBTyxJQUFBLDZDQUF5QixFQUFDLGdCQUFnQixFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDMUYsQ0FBQztJQUVEOzs7T0FHRztJQUNPLGtCQUFrQixDQUMxQixPQUFnQixFQUNoQixLQUF3QixFQUN4QixLQUFzQjtRQUV0QixNQUFNLElBQUksR0FBMkIsRUFBRSxDQUFDO1FBRXhDLHVEQUF1RDtRQUN2RCxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ2hELElBQUksTUFBTSxLQUFLLEtBQUssSUFBSSxNQUFNLEtBQUssTUFBTSxFQUFFLENBQUM7WUFDMUMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLE1BQU0sQ0FBQztRQUNuQyxDQUFDO2FBQU0sSUFBSSxNQUFNLEtBQUssTUFBTSxJQUFJLE1BQU0sS0FBSyxLQUFLLElBQUksTUFBTSxLQUFLLE9BQU8sRUFBRSxDQUFDO1lBQ3ZFLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxPQUFPLENBQUM7UUFDcEMsQ0FBQzthQUFNLElBQUksTUFBTSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQy9CLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxRQUFRLENBQUM7UUFDckMsQ0FBQztRQUVELHdEQUF3RDtRQUN4RCxJQUFJLEtBQUssRUFBRSxVQUFVLEVBQUUsQ0FBQztZQUN0QixJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUM7UUFDdEMsQ0FBQztRQUVELCtCQUErQjtRQUMvQixJQUFJLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7UUFDcEMsQ0FBQztRQUVELGlDQUFpQztRQUNqQyxJQUFJLEtBQUssQ0FBQyxjQUFjLEVBQUUsS0FBSyxFQUFFLENBQUM7WUFDaEMsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQztRQUMxQyxDQUFDO1FBRUQsOENBQThDO1FBQzlDLElBQUksS0FBSyxFQUFFLFFBQVEsRUFBRSxDQUFDO1lBQ3BCLElBQUksQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQztRQUNsQyxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNPLG1CQUFtQixDQUMzQixLQUFzQixFQUN0QixPQUFnQixFQUNoQixNQUFzQztRQUV0Qyx1Q0FBdUM7UUFDdkMsTUFBTSxLQUFLLEdBQTRCO1lBQ3JDLGFBQWEsRUFBRSxPQUFPLENBQUMsVUFBVTtZQUNqQyxXQUFXLEVBQUUsT0FBTyxDQUFDLElBQUk7WUFDekIsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLFNBQVM7WUFDbkMsZ0JBQWdCLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFFLFlBQVksQ0FBRSxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBRSxZQUFZLENBQUU7WUFDcEYsZUFBZSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLFFBQVE7U0FDMUQsQ0FBQztRQUVGLDZEQUE2RDtRQUM3RCxJQUFJLE1BQU0sRUFBRSxPQUFPLEtBQUssS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxDQUFDO1lBQ25ELE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztRQUVELDhDQUE4QztRQUM5QyxNQUFNLFFBQVEsR0FBRyxJQUFBLHFDQUFpQixFQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNwRCxNQUFNLFdBQVcsR0FBNEIsRUFBRSxDQUFDO1FBRWhELElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUM3QixNQUFNLFVBQVUsR0FBRyxJQUFBLGdDQUFZLEVBQUMsT0FBTyxDQUFDLE9BQWtDLEVBQUUsUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN0RyxJQUFJLFVBQVU7Z0JBQUUsV0FBVyxDQUFDLE9BQU8sR0FBRyxVQUFVLENBQUM7UUFDbkQsQ0FBQztRQUVELElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLElBQUksT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzFDLE1BQU0sUUFBUSxHQUFHLE9BQU8sT0FBTyxDQUFDLElBQUksS0FBSyxRQUFRO2dCQUMvQyxDQUFDLENBQUMsSUFBQSx3Q0FBb0IsRUFBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO2dCQUMzRCxDQUFDLENBQUMsSUFBQSxnQ0FBWSxFQUFDLE9BQU8sQ0FBQyxJQUErQixFQUFFLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDakYsSUFBSSxRQUFRO2dCQUFFLFdBQVcsQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDO1FBQzVDLENBQUM7UUFFRCxJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQzVELE1BQU0sU0FBUyxHQUFHLElBQUEsZ0NBQVksRUFBQyxPQUFPLENBQUMscUJBQWdELEVBQUUsUUFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNqSCxJQUFJLFNBQVM7Z0JBQUUsV0FBVyxDQUFDLEtBQUssR0FBRyxTQUFTLENBQUM7UUFDL0MsQ0FBQztRQUVELDhDQUE4QztRQUM5QyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hDLEtBQUssQ0FBRSxTQUFTLENBQUUsR0FBRyxNQUFNLENBQUMsY0FBYyxFQUFFLE9BQU8sS0FBSyxLQUFLO2dCQUMzRCxDQUFDLENBQUMsSUFBQSxtQ0FBbUIsRUFBQyxXQUFXLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQztnQkFDekQsQ0FBQyxDQUFDLFdBQVcsQ0FBQztRQUNsQixDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQ7OztPQUdHO0lBQ08sdUJBQXVCLENBQy9CLFFBQWtCLEVBQ2xCLE1BQXNDO1FBRXRDLDZCQUE2QjtRQUM3QixNQUFNLEtBQUssR0FBNEI7WUFDckMsaUJBQWlCLEVBQUUsUUFBUSxDQUFDLFVBQVU7U0FDdkMsQ0FBQztRQUVGLDZEQUE2RDtRQUM3RCxJQUFJLE1BQU0sRUFBRSxPQUFPLEtBQUssS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxDQUFDO1lBQ25ELE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztRQUVELE1BQU0sUUFBUSxHQUFHLElBQUEscUNBQWlCLEVBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3BELE1BQU0sWUFBWSxHQUE0QixFQUFFLENBQUM7UUFFakQsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLE9BQU8sSUFBSSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDbEQsTUFBTSxVQUFVLEdBQUcsSUFBQSxnQ0FBWSxFQUFDLFFBQVEsQ0FBQyxPQUFrQyxFQUFFLFFBQVEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDeEcsSUFBSSxVQUFVO2dCQUFFLFlBQVksQ0FBQyxPQUFPLEdBQUcsVUFBVSxDQUFDO1FBQ3BELENBQUM7UUFFRCxJQUFJLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxJQUFJLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUM1QyxNQUFNLFFBQVEsR0FBRyxJQUFBLHdDQUFvQixFQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUM3RSxJQUFJLFFBQVE7Z0JBQUUsWUFBWSxDQUFDLElBQUksR0FBRyxRQUFRLENBQUM7UUFDN0MsQ0FBQztRQUVELDhDQUE4QztRQUM5QyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3pDLEtBQUssQ0FBRSxVQUFVLENBQUUsR0FBRyxNQUFNLENBQUMsY0FBYyxFQUFFLE9BQU8sS0FBSyxLQUFLO2dCQUM1RCxDQUFDLENBQUMsSUFBQSxtQ0FBbUIsRUFBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQztnQkFDMUQsQ0FBQyxDQUFDLFlBQVksQ0FBQztRQUNuQixDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNLLGlCQUFpQixDQUFDLFdBQW9CO1FBQzVDLElBQUksVUFBVSxHQUFRLElBQUksQ0FBQztRQUUzQiw2R0FBNkc7UUFDN0csTUFBTSxjQUFjLEdBQUcsT0FBTyxVQUFVLENBQUMsY0FBYyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ3RHLElBQUksa0JBQWtCLEdBQUcsY0FBYyxDQUFDLENBQUMsQ0FBQyxJQUFJLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDcEUsSUFBSSxtQkFBbUIsR0FBRyxHQUFHLENBQUM7UUFFOUIsK0VBQStFO1FBQy9FLDBFQUEwRTtRQUMxRSxNQUFNLGVBQWUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxRQUFRLElBQUksV0FBVyxDQUFDLElBQUksSUFBSSxHQUFHLENBQVcsQ0FBQztRQUNwRixNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNqRSxNQUFNLG1CQUFtQixHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRXRFLHFFQUFxRTtRQUNyRSxJQUFJLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQzFCLElBQUksbUJBQW1CLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ25DLDZEQUE2RDtZQUM3RCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQkFDNUUsSUFBSSxPQUFPLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3BELElBQUksYUFBYSxDQUFFLENBQUMsR0FBRyxDQUFDLENBQUUsS0FBSyxtQkFBbUIsQ0FBRSxDQUFDLENBQUUsRUFBRSxDQUFDO3dCQUN4RCxPQUFPLEdBQUcsS0FBSyxDQUFDO3dCQUNoQixNQUFNO29CQUNSLENBQUM7Z0JBQ0gsQ0FBQztnQkFDRCxJQUFJLE9BQU8sRUFBRSxDQUFDO29CQUNaLGdCQUFnQixHQUFHLENBQUMsR0FBRyxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO29CQUN0RCxNQUFNO2dCQUNSLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksZ0JBQWdCLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDMUIsaURBQWlEO1lBQ2pELE1BQU0sYUFBYSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQ25FLGtCQUFrQixHQUFHLEdBQUcsR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ25ELE1BQU0sY0FBYyxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDakUsbUJBQW1CLEdBQUcsY0FBYyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7UUFDekYsQ0FBQzthQUFNLENBQUM7WUFDTiw4Q0FBOEM7WUFDOUMsSUFBSSxrQkFBa0IsSUFBSSxlQUFlLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQztnQkFDekUsbUJBQW1CLEdBQUcsZUFBZSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsSUFBSSxHQUFHLENBQUM7WUFDcEYsQ0FBQztpQkFBTSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztnQkFDL0IsMkVBQTJFO2dCQUMzRSxtQkFBbUIsR0FBRyxlQUFlLElBQUksR0FBRyxDQUFDO1lBQy9DLENBQUM7UUFDSCxDQUFDO1FBRUQseUVBQXlFO1FBQ3pFLE1BQU0sWUFBWSxHQUE4QyxFQUFFLENBQUM7UUFDbkUsTUFBTSxvQkFBb0IsR0FBOEMsRUFBRSxDQUFDO1FBRTNFLG1EQUFtRDtRQUNuRCxLQUFLLE1BQU0sQ0FBRSxRQUFRLEVBQUUsS0FBSyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBd0IsRUFBRSxDQUFDO1lBQ2pHLE1BQU0sQ0FBRSxXQUFXLEVBQUUsU0FBUyxDQUFFLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUV2RCxvQ0FBb0M7WUFDcEMsSUFBSSxXQUFXLEtBQUssV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUMzQyxTQUFTO1lBQ1gsQ0FBQztZQUVELHdCQUF3QjtZQUN4QixJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN2RCxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUNqRCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ3pDLENBQUM7UUFDSCxDQUFDO1FBRUQsMERBQTBEO1FBQzFELEtBQUssTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUMvQyxNQUFNLENBQUUsQUFBRCxFQUFHLFNBQVMsQ0FBRSxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFNUMsSUFBSSxTQUFTLEtBQUssbUJBQW1CLEVBQUUsQ0FBQztnQkFDdEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLFFBQVEsRUFBRSxDQUFDLENBQUM7Z0JBQzlELE9BQU8sS0FBSyxDQUFDO1lBQ2YsQ0FBQztRQUNILENBQUM7UUFFRCxnRUFBZ0U7UUFDaEUscUZBQXFGO1FBQ3JGLE1BQU0sMEJBQTBCLEdBQUcsb0JBQW9CO2FBQ3BELEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDM0IsTUFBTSxDQUFFLEFBQUQsRUFBRyxTQUFTLENBQUUsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzVDLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3RELE1BQU0sZUFBZSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUUzRSwwREFBMEQ7WUFDMUQsb0VBQW9FO1lBQ3BFLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxlQUFlLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7WUFFM0UsT0FBTyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLGdCQUFnQixFQUFFLENBQUM7UUFDMUQsQ0FBQyxDQUFDO2FBQ0QsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMscUJBQXFCO1FBRWpGLEtBQUssTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksMEJBQTBCLEVBQUUsQ0FBQztZQUN4RSw2REFBNkQ7WUFDN0QsTUFBTSxtQkFBbUIsR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUVyRSxJQUFJLENBQUM7Z0JBQ0gsbURBQW1EO2dCQUNuRCxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsT0FBTyxDQUFDLGdCQUFnQixDQUFDLENBQUM7Z0JBQzVDLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxtQkFBbUIsRUFBRSxFQUFFLE1BQU0sRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7Z0JBQzNFLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO2dCQUVqRCxJQUFJLFdBQVcsRUFBRSxDQUFDO29CQUNoQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx3Q0FBd0MsUUFBUSxFQUFFLEVBQUU7d0JBQ3BFLE9BQU8sRUFBRSxtQkFBbUI7d0JBQzVCLE1BQU0sRUFBRSxXQUFXLENBQUMsTUFBTTt3QkFDMUIsZ0JBQWdCLEVBQUUsMEJBQTBCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsS0FBSyxRQUFRLENBQUMsRUFBRSxnQkFBZ0I7cUJBQ2xHLENBQUMsQ0FBQztvQkFFSCx1RUFBdUU7b0JBQ3ZFLHNEQUFzRDtvQkFDdEQsT0FBTyxLQUFLLENBQUM7Z0JBQ2YsQ0FBQztZQUNILENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxtQkFBbUIsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUNoRixTQUFTO1lBQ1gsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsV0FBVyxDQUFDLFVBQVUsSUFBSSxtQkFBbUIsRUFBRSxDQUFDLENBQUM7UUFDakcsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNLLGdCQUFnQixDQUFDLEtBQW1CO1FBQzFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNYLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDeEMsQ0FBQztRQUVELFlBQVk7UUFDWixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUUsS0FBSyxDQUFDLFlBQVksQ0FBRSxDQUFDO1FBRWpELE9BQU8sT0FBTyxhQUFhLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzlGLENBQUM7SUFFRDs7OztPQUlHO0lBQ08sY0FBYyxDQUFDLElBQWE7UUFDcEMsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDO1lBQ3pCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxPQUFPLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQztTQUNyRCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRVMsWUFBWSxDQUEwQjtJQUN0QyxlQUFlO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFBLDJCQUFrQixHQUFFLENBQUM7UUFDM0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQztJQUMzQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDTyxlQUFlLENBQUMsR0FBWSxFQUFFLEdBQVUsRUFBRSxHQUFhO1FBQy9ELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQzVELE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRVMsY0FBYyxDQUFDLEdBQXFDO1FBQzVELElBQUksR0FBRyxZQUFZLGtDQUFlLEVBQUUsQ0FBQztZQUNuQyxPQUFPLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQixDQUFDO1FBQ0QsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FxQ0c7SUFDTyxRQUFRLENBQUMsS0FBc0IsRUFBRSxPQUFnQixFQUFFLE9BQWdCLEVBQUUsUUFBa0I7UUFDL0YsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV2RCxNQUFNLEdBQUcsR0FBcUI7WUFDNUIsS0FBSztZQUNMLGFBQWEsRUFBRSxPQUFPO1lBQ3RCLE9BQU87WUFDUCxRQUFRO1lBQ1IsS0FBSztZQUNMLFNBQVMsRUFBRSxFQUFFO1lBRWIsa0NBQWtDO1lBQ2xDLFlBQVksRUFBRSxDQUFDLFdBQTJCLEVBQUUsRUFBRTtnQkFDNUMsSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUM7b0JBQ2QsTUFBTSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO2dCQUN4QyxDQUFDO1lBQ0gsQ0FBQztTQUNGLENBQUM7UUFFRixPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7SUFFRDs7T0FFRztJQUNPLG1CQUFtQjtRQUMzQixPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGtCQUFrQixDQUFDLElBQUksRUFBRSxDQUFDO0lBQ3JELENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNPLG1CQUFtQixDQUFDLEtBQXNCLEVBQUUsT0FBZ0I7UUFDcEUsTUFBTSxTQUFTLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMzQyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUyxDQUFDO1FBRXBDLE1BQU0sS0FBSyxHQUFVO1lBQ25CLFNBQVM7WUFDVCxTQUFTO1lBQ1QsUUFBUSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLFFBQVE7WUFDbEQsU0FBUyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBRSxZQUFZLENBQUUsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUUsWUFBWSxDQUFFO1lBQzdFLGtFQUFrRTtTQUNuRSxDQUFDO1FBRUYsbURBQW1EO1FBQ25ELElBQUksS0FBSyxDQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUM7WUFDN0MsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM1RSxDQUFDO1FBQ0QseUJBQXlCO2FBQ3BCLElBQUksS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsTUFBTSxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBRSxXQUFXLENBQUUsRUFBRSxDQUFDO1lBQ3BGLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ25ELENBQUM7UUFDRCxzQkFBc0I7YUFDakIsSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQztZQUNqRCxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFDRCxZQUFZO2FBQ1AsQ0FBQztZQUNKLEtBQUssQ0FBQyxVQUFVLEdBQUcsV0FBVyxDQUFDO1lBQy9CLEtBQUssQ0FBQyxTQUFTLEdBQUcsV0FBVyxDQUFDO1lBQzlCLEtBQUssQ0FBQyxPQUFPLEdBQUcsV0FBVyxDQUFDO1FBQzlCLENBQUM7UUFFRCw2QkFBNkI7UUFDN0IsSUFBSSxDQUFDLDhCQUE4QixDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFM0Qsc0JBQXNCO1FBQ3RCLEtBQUssQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUM7UUFDN0MsS0FBSyxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUMsY0FBYyxFQUFFLEtBQUssQ0FBQztRQUUxQyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDTyxxQkFBcUIsQ0FBQyxNQUFXLEVBQUUsS0FBWTtRQUN2RCxJQUFJLENBQUM7WUFDSCxLQUFLLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQztZQUM3QixLQUFLLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQztZQUV6QiwrRUFBK0U7WUFDL0UsS0FBSyxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUUsa0JBQWtCLENBQUUsSUFBSSxNQUFNLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUM7WUFFM0UsZ0VBQWdFO1lBQ2hFLEtBQUssQ0FBQyxLQUFLLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQztZQUMzQixLQUFLLENBQUMsYUFBYSxHQUFHLE1BQU0sQ0FBQyxjQUFjLEtBQUssTUFBTSxDQUFDO1lBQ3ZELEtBQUssQ0FBQyxXQUFXLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQztZQUN4QyxLQUFLLENBQUMsYUFBYSxHQUFHLE1BQU0sQ0FBQyxxQkFBcUIsS0FBSyxNQUFNLENBQUM7WUFDOUQsS0FBSyxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDO1lBQ3pCLEtBQUssQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztZQUU3Qiw4REFBOEQ7WUFDOUQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUUsZ0JBQWdCLENBQUUsQ0FBQyxDQUFDO1lBRTVELDJEQUEyRDtZQUMzRCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUU5RCxvREFBb0Q7WUFDcEQsS0FBSyxDQUFDLE9BQU8sR0FBRztnQkFDZCxHQUFHLEVBQUUsTUFBTSxDQUFDLEdBQUc7Z0JBQ2YsUUFBUSxFQUFFLE1BQU0sQ0FBRSxrQkFBa0IsQ0FBRTtnQkFDdEMsTUFBTSxFQUFFLE1BQU0sRUFBRSxtREFBbUQ7Z0JBQ25FLGdCQUFnQixFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsU0FBUzthQUMxRixDQUFDO1lBRUYseUVBQXlFO1lBQ3pFLEtBQUssQ0FBQyxRQUFRLEdBQUcsZ0JBQWdCLENBQUMsUUFBUSxDQUFDO1lBRTNDLEtBQUssQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDO1FBRWhDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsd0NBQXdDLEVBQUUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUU5RSw4QkFBOEI7WUFDOUIsS0FBSyxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUM7WUFDN0IsS0FBSyxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUM7WUFDekIsS0FBSyxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsR0FBRyxJQUFJLFNBQVMsQ0FBQztZQUN4QyxLQUFLLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQztRQUNoQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ08sV0FBVyxDQUFDLE1BQVc7UUFDL0IsSUFBSSxPQUFPLE1BQU0sS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNwRCxPQUFPLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztRQUN4RSxDQUFDO1FBQ0QsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRUQ7O09BRUc7SUFDTyx1QkFBdUIsQ0FBQyxNQUFXO1FBQzNDLE1BQU0sZ0JBQWdCLEdBQXdCLEVBQUUsQ0FBQztRQUVqRCxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtZQUNoQyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztnQkFDOUIsTUFBTSxhQUFhLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ2pELGdCQUFnQixDQUFFLGFBQWEsQ0FBRSxHQUFHLE1BQU0sQ0FBRSxHQUFHLENBQUUsQ0FBQztZQUNwRCxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7UUFFSCxPQUFPLGdCQUFnQixDQUFDO0lBQzFCLENBQUM7SUFFRDs7S0FFQztJQUNTLDhCQUE4QixDQUFDLEtBQXNCLEVBQUUsT0FBZ0IsRUFBRSxLQUFZO1FBQzdGLGtCQUFrQjtRQUNsQixLQUFLLENBQUMsU0FBUyxHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBRSxjQUFjLENBQUUsQ0FBQztRQUV0RCwrREFBK0Q7UUFDL0QsS0FBSyxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUUsYUFBYSxDQUFFO1lBQ2pELEtBQUssQ0FBQyxjQUFjLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxDQUFFLGlCQUFpQixDQUFFLENBQUM7SUFDcEUsQ0FBQztJQUVEOztPQUVHO0lBQ08sb0JBQW9CLENBQUMsS0FBc0IsRUFBRSxPQUFnQixFQUFFLEtBQVk7UUFDbkYsS0FBSyxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUM7UUFDN0IsS0FBSyxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFFNUIsSUFBSSxRQUFnQixDQUFDO1FBQ3JCLElBQUksTUFBb0MsQ0FBQztRQUV6QyxJQUFJLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDO1lBQzNDLFFBQVEsR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxRQUFRLElBQUksS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDO1lBQzFGLE1BQU0sR0FBRyxpQkFBaUIsQ0FBQztRQUM3QixDQUFDO2FBQU0sQ0FBQztZQUNOLFFBQVEsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFFLFdBQVcsQ0FBRyxDQUFDO1lBQzNDLE1BQU0sR0FBRyxRQUFRLENBQUM7UUFDcEIsQ0FBQztRQUVELEtBQUssQ0FBQyxPQUFPLEdBQUcsV0FBVyxRQUFRLEVBQUUsQ0FBQztRQUN0QyxLQUFLLENBQUMsTUFBTSxHQUFHO1lBQ2IsRUFBRSxFQUFFLFFBQVE7WUFDWixNQUFNLEVBQUUsTUFBTTtTQUNmLENBQUM7SUFDSixDQUFDO0lBRUQ7O09BRUc7SUFDTyxpQkFBaUIsQ0FBQyxLQUFzQixFQUFFLEtBQVk7UUFDOUQsS0FBSyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUM7UUFDekIsS0FBSyxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFDNUIsS0FBSyxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxJQUFJO1lBQ2xELEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE9BQU87WUFDdkMsa0JBQWtCLENBQUM7UUFFckIsS0FBSyxDQUFDLEdBQUcsR0FBRztZQUNWLE9BQU8sRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxPQUFPLElBQUksU0FBUztZQUM3RCxNQUFNLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsSUFBSSxJQUFJLFNBQVM7WUFDekQsU0FBUyxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLFNBQVMsSUFBSSxTQUFTO1lBQ2pFLE1BQU0sRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxNQUFNLElBQUksU0FBUztTQUM1RCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBbjFCRCxzQ0FtMUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBBUElHYXRld2F5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBJQ29udHJvbGxlckNvbmZpZyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzXCI7XG5pbXBvcnQgeyBHZXQsIFJvdXRlTWV0aG9kcyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzL21ldGhvZFwiO1xuaW1wb3J0IHsgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvciwgVmFsaWRhdGlvbkZhaWxlZEVycm9yLCBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vZXJyb3JzL1wiO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSwgUm91dGUgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCBnZW5lcmF0ZVRyYWNlSWQsIHJlZGFjdFNlbnNpdGl2ZURhdGEgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7XG4gIENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBtZXJnZU9ic2VydmFiaWxpdHlDb25maWdzLFxuICBub3JtYWxpemVJbmNsdWRlcyxcbiAgc2VsZWN0RmllbGRzLFxuICBzZWxlY3RGaWVsZHNGcm9tQm9keVxufSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5L2NvbnRyb2xsZXItY29uZmlnJztcbmltcG9ydCB7IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIElucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlLCBpc0lucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvbi91dGlsc1wiO1xuaW1wb3J0IHsgQWN0b3IsIEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHtcbiAgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCxcbiAgZXh0cmFjdEZyb21IZWFkZXJzLFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbn0gZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBSZXF1ZXN0Q29udGV4dCB9IGZyb20gXCIuL3JlcXVlc3QtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb25maWcsIG1lcmdlUmVzcG9uc2VDb25maWcgfSBmcm9tIFwiLi9yZXNwb25zZS1jb25maWdcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29udGV4dCB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbnRleHRcIjtcblxuZXhwb3J0IHR5cGUgQ29udHJvbGxlckVycm9ySGFuZGxlciA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZUVycm9ySGFuZGxlcj47XG5cbi8vIE5ldyBpbnRlcmZhY2VzIGZvciBtaWRkbGV3YXJlIGFuZCBlcnJvciBoYW5kbGluZ1xuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyTWlkZGxld2FyZSB7XG4gIGJlZm9yZT86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIGFmdGVyPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgb25FcnJvcj86IChlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuLy8gR2xvYmFsIG1pZGRsZXdhcmUgbWFuYWdlbWVudFxuY29uc3QgZ2xvYmFsTWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG5cbmV4cG9ydCBjb25zdCB1c2VNaWRkbGV3YXJlID0gKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbn1cbmV4cG9ydCBjb25zdCBjbGVhck1pZGRsZXdhcmVzID0gKCkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5jbGVhcigpO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gQVBJIGhhbmRsZXIgd2l0aG91dCBkZWZpbmluZyBhIGNsYXNzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogZXhwb3J0IGNvbnN0IHsgaGFuZGxlciwgZGVzY3JpcHRvciB9ID0gY3JlYXRlQXBpSGFuZGxlcihcbiAqICB7IG1ldGhvZDogR2V0LCBuYW1lOiAnZGVtbycsIGF1dGhvcml6ZXI6ICdOT05FJyB9LFxuICogICBhc3luYyAoIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICogICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gKiAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICogICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJIZWxsbyBXb3JsZCFcIn0pXG4gKiAgICAgICB9KVxuICogICB9XG4gKiApXG4gKiBgYGBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5wYXRoIC0gVGhlIHBhdGggZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgZnVuY3Rpb24gYW5kIHRoZSBjb250cm9sbGVyIGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBcGlIYW5kbGVyKFxuICBvcHRpb25zOiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHBhdGg/OiBzdHJpbmcsXG4gICAgbWV0aG9kPzogUm91dGVNZXRob2RzLFxuICB9ICYgSUNvbnRyb2xsZXJDb25maWcsXG4gIGhhbmRsZXI6IChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4sXG4pIHtcblxuICBjb25zdCB7IG5hbWUsIHBhdGggPSAnJywgbWV0aG9kID0gR2V0LCAuLi5jb250cm9sbGVyQ29uZmlnIH0gPSBvcHRpb25zO1xuXG4gIEBDb250cm9sbGVyKG5hbWUsIHsgLi4uY29udHJvbGxlckNvbmZpZywgYXV0b0V4cG9ydExhbWJkYUhhbmRsZXI6IGZhbHNlIH0pXG4gIGNsYXNzIENvbnRyb2xsZXJEZXNjcmlwdG9yIHtcbiAgICBAbWV0aG9kKHBhdGgpXG4gICAgYXN5bmMgaW5saW5lSGFuZGxlcigpIHtcbiAgICAgIC8vIHBsYWNlaG9sZGVyIGZ1bmN0aW9uIG9ubHkgdXNlZCBmb3Igcm91dGluZyBtZXRhZGF0YVxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShoYW5kbGVyLCAnbmFtZScsIHsgdmFsdWU6ICdoYW5kbGVyJyB9KTtcblxuICByZXR1cm4ge1xuICAgIGhhbmRsZXIsXG4gICAgZGVzY3JpcHRvcjogQ29udHJvbGxlckRlc2NyaXB0b3JcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyQ29uZmlnIHtcbiAgcmVzcG9uc2VDb25maWc/OiBQYXJ0aWFsPFJlc3BvbnNlQ29uZmlnPjtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFQSUNvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuICBwcm90ZWN0ZWQgbWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG4gIHByb3RlY3RlZCByZXNwb25zZUNvbmZpZzogUmVzcG9uc2VDb25maWc7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBBUElDb250cm9sbGVyQ29uZmlnID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzcG9uc2VDb25maWcgPSBtZXJnZVJlc3BvbnNlQ29uZmlnKGNvbmZpZy5yZXNwb25zZUNvbmZpZyk7XG4gIH1cblxuICAvKipcbiAgICogY2FuIGJlIHVzZWQgdG8gcnVuIHNvbWUgbG9naWMganVzdCBiZWZvcmUgdGhlIHJlcXVlc3QgaXMgcHJvY2Vzc2VkIGxpa2UgY3JlYXRpbmcgY2xpZW50cywgZGktaW5qZWN0aW9uIGFucyBzbyBvbi5cbiAgICogQHBhcmFtIF9ldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBfY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgY29udHJvbGxlciBpcyBpbml0aWFsaXplZC5cbiAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8tb3AgZm9yIEFQSSBjb250cm9sbGVyc1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBnZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICB9XG5cbiAgLy8gQWRkIG1pZGRsZXdhcmUgcmVnaXN0cmF0aW9uIG1ldGhvZFxuICBwcm90ZWN0ZWQgdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkge1xuICAgIHRoaXMubWlkZGxld2FyZXMuYWRkKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCkge1xuICAgIHJldHVybiBbIC4uLkFycmF5LmZyb20oZ2xvYmFsTWlkZGxld2FyZXMpLCAuLi5BcnJheS5mcm9tKHRoaXMubWlkZGxld2FyZXMpIF07XG4gIH1cblxuICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKFxuICAgIHBoYXNlOiAnYmVmb3JlJyB8ICdhZnRlcicgfCAnb25FcnJvcicsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCxcbiAgICBlcnJvcj86IEVycm9yXG4gICk6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYWxsTWlkZGxld2FyZXMgPSB0aGlzLmdldE1pZGRsZXdhcmVzKCk7XG5cbiAgICBmb3IgKGNvbnN0IG1pZGRsZXdhcmUgb2YgYWxsTWlkZGxld2FyZXMpIHtcbiAgICAgIGlmIChwaGFzZSA9PT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmUub25FcnJvciAmJiBlcnJvcikge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlLm9uRXJyb3IoZXJyb3IsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfSBlbHNlIGlmIChwaGFzZSAhPT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmVbIHBoYXNlIF0pIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZVsgcGhhc2UgXSEocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9XG4gICAgfVxuXG4gIH1cblxuICBhc3luYyB2YWxpZGF0ZShyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCwgdmFsaWRhdGlvbnM6IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgbGV0IHZhbGlkYXRpb25SdWxlczogSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyA9IHZhbGlkYXRpb25zO1xuICAgIGlmIChpc0lucHV0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvbnMpKSB7XG4gICAgICBpZiAoWyAnR0VUJywgJ0RFTEVURScgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBxdWVyeTogdmFsaWRhdGlvbnMgfVxuXG4gICAgICB9IGVsc2UgaWYgKFsgJ1BPU1QnLCAnUFVUJywgJ1BBVENIJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IGJvZHk6IHZhbGlkYXRpb25zIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9uUnVsZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvcih2YWxpZGF0aW9uUnVsZXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHtcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25SdWxlcyxcbiAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsXG4gICAgICB2ZXJib3NlRXJyb3JzOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgdGhpcy5nZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVxdWVzdENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UmVxdWVzdD4ge1xuICAgIHJldHVybiBuZXcgUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCk6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlQ29udGV4dCh7XG4gICAgICB0cmFjZUlkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIGRlYnVnTW9kZTogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgcm91dGU6IHJlcXVlc3RDb250ZXh0LnBhdGgsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAnZGV2ZWxvcG1lbnQnLFxuICAgICAgY29uZmlnOiB0aGlzLnJlc3BvbnNlQ29uZmlnXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBjb250cm9sbGVyLlxuICAgKiBIYW5kbGVzIGluY29taW5nIEFQSSBHYXRld2F5IGV2ZW50cy5cbiAgICogXG4gICAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LCBtYWtpbmdcbiAgICogZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSBhdmFpbGFibGUgdGhyb3VnaG91dCB0aGUgcmVxdWVzdCBsaWZlY3ljbGUuXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIEFQSSBHYXRld2F5IHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgdGhpcy5pbml0aWFsaXplRW50cnlQYWNrYWdlc0FuZE9ic2VydmFiaWxpdHkoKTtcblxuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdCk7XG5cbiAgICAvLyBCdWlsZCB0aGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICBjb25zdCBjdHggPSB0aGlzLmJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG5cbiAgICAvLyBGaW5kIHRoZSBtYXRjaGluZyByb3V0ZSAobmVlZGVkIGZvciBvYnNlcnZhYmlsaXR5IGNvbmZpZylcbiAgICBjb25zdCByb3V0ZSA9IHRoaXMuZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCk7XG5cbiAgICAvLyBHZXQgbWVyZ2VkIG9ic2VydmFiaWxpdHkgY29uZmlnXG4gICAgY29uc3Qgb2JzZXJ2YWJpbGl0eUNvbmZpZyA9IHRoaXMuZ2V0T2JzZXJ2YWJpbGl0eUNvbmZpZyhyb3V0ZSk7XG4gICAgY29uc3QgZGVmYXVsdFNvdXJjZSA9IGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0uJHtyb3V0ZT8uZnVuY3Rpb25OYW1lIHx8ICdoYW5kbGVyJ31gO1xuXG4gICAgLy8gRXh0cmFjdCB1cHN0cmVhbSB0cmFjZSBjb250ZXh0IGZyb20gaW5jb21pbmcgaGVhZGVycy5cbiAgICAvLyBJTVBPUlRBTlQgKGZyYW1ld29yayBjb250cmFjdCk6XG4gICAgLy8gLSBjb3JyZWxhdGlvbklkIGlzIHBlci1pbnZvY2F0aW9uIChsb2NhbCBzbGljZSlcbiAgICAvLyAtIGNhdXNlZEJ5IGxpbmtzIHRvIHVwc3RyZWFtIGludm9jYXRpb24vdHJhY2VcbiAgICBjb25zdCB0cmFjZUNvbnRleHQgPSBleHRyYWN0RnJvbUhlYWRlcnMocmVxdWVzdC5oZWFkZXJzIHx8IHt9KTtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gcmVxdWVzdC5yZXF1ZXN0SWQgfHwgZ2VuZXJhdGVUcmFjZUlkKCk7XG4gICAgY29uc3QgY2F1c2VkQnkgPSB0cmFjZUNvbnRleHQ/LmNhdXNlZEJ5ID8/IHRyYWNlQ29udGV4dD8uY29ycmVsYXRpb25JZDtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dCB3aXRoIGN1c3RvbSBzb3VyY2UgYW5kIHRhZ3MgZnJvbSBkZWNvcmF0b3JcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgY2F1c2VkQnksXG4gICAgICBhY3RvcjogY3R4LmFjdG9yLFxuICAgICAgc2FtcGxlZDogdHJhY2VDb250ZXh0Py5zYW1wbGVkLFxuICAgICAgc291cmNlOiBvYnNlcnZhYmlsaXR5Q29uZmlnPy5zb3VyY2UgfHwgZGVmYXVsdFNvdXJjZSxcbiAgICAgIHRhZ3M6IG9ic2VydmFiaWxpdHlDb25maWc/LnRhZ3MsXG4gICAgfSk7XG5cbiAgICAvLyBCdWlsZCBzcGFuIGF0dHJpYnV0ZXMgKGluY2x1ZGVzIHJlcXVlc3QgZGF0YSBjYXB0dXJlKVxuICAgIGNvbnN0IHNwYW5BdHRyaWJ1dGVzID0gdGhpcy5idWlsZFNwYW5BdHRyaWJ1dGVzKGV2ZW50LCByZXF1ZXN0LCBvYnNlcnZhYmlsaXR5Q29uZmlnKTtcblxuICAgIC8vIEJ1aWxkIGF1dG9tYXRpYyB0YWdzIGZvciBlYXN5IGZpbHRlcmluZ1xuICAgIGNvbnN0IGF1dG9tYXRpY1RhZ3MgPSB0aGlzLmJ1aWxkQXV0b21hdGljVGFncyhyZXF1ZXN0LCBjdHguYWN0b3IsIGV2ZW50KTtcblxuICAgIC8vIFJ1biBlbnRpcmUgaGFuZGxlciB3aXRoaW4gZXhlY3V0aW9uIGNvbnRleHRcbiAgICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoZXhlY0N0eCwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU2V0IGN0eC5leGVjdXRpb25Db250ZXh0IHRvIHBvaW50IHRvIHRoZSBleGVjdXRpb24gY29udGV4dFxuICAgICAgY3R4LmV4ZWN1dGlvbkNvbnRleHQgPSBleGVjQ3R4O1xuXG4gICAgICAvLyBTeW5jIGFjdG9yLmNvcnJlbGF0aW9uSWQgd2l0aCB0aGUgcmVzb2x2ZWQgY29ycmVsYXRpb25JZFxuICAgICAgLy8gVGhpcyBlbnN1cmVzIGFjdG9yIHN0b3JlZCBpbiBfYWN0b3IgZmllbGQgaGFzIHRoZSBjb3JyZWN0IHRyYWNlIElEXG4gICAgICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgICAgIGN0eC5hY3Rvci5jb3JyZWxhdGlvbklkID0gY29ycmVsYXRpb25JZDtcbiAgICAgIH1cblxuICAgICAgLy8gVXNlIHRoZSBiYXNlIGNsYXNzIGhlbHBlciBmb3Igc3BhbiArIGZsdXNoIHBhdHRlcm5cbiAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoKFxuICAgICAgICBgSFRUUCAke3JlcXVlc3QuaHR0cE1ldGhvZH0gJHtyZXF1ZXN0LnBhdGh9YCxcbiAgICAgICAgYXN5bmMgKHJlcXVlc3RTcGFuKSA9PiB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIExlZ2FjeSBpbml0aWFsaXplIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKGV2ZW50LCBjb250ZXh0KTtcblxuICAgICAgICAgICAgLy8gRXhlY3V0ZSBiZWZvcmUgbWlkZGxld2FyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlcXVlc3QgaWYgdmFsaWRhdGlvbnMgYXJlIGRlZmluZWRcbiAgICAgICAgICAgIGlmIChyb3V0ZT8udmFsaWRhdGlvbnMpIHtcbiAgICAgICAgICAgICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGUocmVxdWVzdCwgcm91dGUudmFsaWRhdGlvbnMpO1xuICAgICAgICAgICAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuICAgICAgICAgICAgICAgIC8vIEFkZCB2YWxpZGF0aW9uIGZhaWx1cmUgdG8gc3BhbiBmb3IgZGVidWdnaW5nXG4gICAgICAgICAgICAgICAgaWYgKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzICYmIHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgIHJlcXVlc3RTcGFuLmNoZWNrcG9pbnQoJ3ZhbGlkYXRpb24uZmFpbGVkJywge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24uZmFpbGVkJzogJ3RydWUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24uZXJyb3JfY291bnQnOiB2YWxpZGF0aW9uUmVzdWx0LmVycm9ycy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uRXJyb3JzOiB2YWxpZGF0aW9uUmVzdWx0LmVycm9ycyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgICAgICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXMuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gICAgICAgICAgICBsZXQgY29udHJvbGxlclJlc3BvbnNlOiBhbnkgPSByb3V0ZUZ1bmN0aW9uLmNhbGwodGhpcywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICAgICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgICAgICBjb250cm9sbGVyUmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyUmVzcG9uc2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdhZnRlcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAgICAgICAvLyBJZiB0aGUgY29udHJvbGxlciByZXR1cm5lZCBhbnl0aGluZywgZW1pdCB0aGF0XG4gICAgICAgICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgaWYgKG9ic2VydmFiaWxpdHlDb25maWc/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VBdHRycyA9IHRoaXMuYnVpbGRSZXNwb25zZUF0dHJpYnV0ZXMocmVzcG9uc2UsIG9ic2VydmFiaWxpdHlDb25maWcpO1xuICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZUF0dHJzKSB7XG4gICAgICAgICAgICAgICAgICAvLyBTdGF0dXMgY29kZSBhcyBtZXRyaWMsIHJlc3QgYXMgZGF0YVxuICAgICAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlQXR0cnNbICdodHRwLnN0YXR1c0NvZGUnIF0pIHtcbiAgICAgICAgICAgICAgICAgICAgcmVxdWVzdFNwYW4ubWV0cmljKCdodHRwLnN0YXR1c0NvZGUnLCByZXNwb25zZUF0dHJzWyAnaHR0cC5zdGF0dXNDb2RlJyBdIGFzIG51bWJlcik7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICByZXF1ZXN0U3Bhbi5zZXREYXRhKHJlc3BvbnNlQXR0cnMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAvLyBGbHVzaCBoYXBwZW5zIGF1dG9tYXRpY2FsbHkgaW4gZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2gncyBmaW5hbGx5IGJsb2NrXG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGNvbnRyb2xsZXJSZXNwb25zZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBpbi1tZW1vcnkgcmVzcG9uc2VDb250ZXh0XG4gICAgICAgICAgICBpZiAob2JzZXJ2YWJpbGl0eUNvbmZpZz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VBdHRycyA9IHRoaXMuYnVpbGRSZXNwb25zZUF0dHJpYnV0ZXMocmVzcG9uc2UsIG9ic2VydmFiaWxpdHlDb25maWcpO1xuICAgICAgICAgICAgICBpZiAocmVzcG9uc2VBdHRycykge1xuICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZUF0dHJzWyAnaHR0cC5zdGF0dXNDb2RlJyBdKSB7XG4gICAgICAgICAgICAgICAgICByZXF1ZXN0U3Bhbi5tZXRyaWMoJ2h0dHAuc3RhdHVzQ29kZScsIHJlc3BvbnNlQXR0cnNbICdodHRwLnN0YXR1c0NvZGUnIF0gYXMgbnVtYmVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVxdWVzdFNwYW4uc2V0RGF0YShyZXNwb25zZUF0dHJzKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gRmx1c2ggaGFwcGVucyBhdXRvbWF0aWNhbGx5IGluIGV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoJ3MgZmluYWxseSBibG9ja1xuICAgICAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmJ1aWxkKCk7XG5cbiAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0xhbWJkYUhhbmRsZXIgZXJyb3I6ICcsIGVycm9yT2JqKTtcblxuICAgICAgICAgICAgLy8gRXhlY3V0ZSBlcnJvciBtaWRkbGV3YXJlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgICAgICAgIC8vIEZsdXNoIGhhcHBlbnMgYXV0b21hdGljYWxseSBpbiBleGVjdXRlV2l0aFNwYW5BbmRGbHVzaCdzIGZpbmFsbHkgYmxvY2tcbiAgICAgICAgICAgIC8vIE5vdGU6IHdpdGhTcGFuIHdpbGwgY2FsbCBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvciB9KSBhdXRvbWF0aWNhbGx5XG4gICAgICAgICAgICAvLyBXZSBzdGlsbCBuZWVkIHRvIHJldHVybiBhIHJlc3BvbnNlIChlcnJvciBoYW5kbGVyIG1heSBoYXZlIG1vZGlmaWVkIGl0KVxuICAgICAgICAgICAgdGhyb3cgZXJyb3JPYmo7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgICBjYXVzZWRCeTogdHJhY2VDb250ZXh0Py5jYXVzZWRCeSxcbiAgICAgICAgICBhY3RvcjogY3R4LmFjdG9yLFxuICAgICAgICAgIHNvdXJjZTogb2JzZXJ2YWJpbGl0eUNvbmZpZz8uc291cmNlIHx8IGRlZmF1bHRTb3VyY2UsXG4gICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgLi4uYXV0b21hdGljVGFncyxcbiAgICAgICAgICAgIC4uLm9ic2VydmFiaWxpdHlDb25maWc/LnRhZ3MsXG4gICAgICAgICAgICAuLi5zcGFuQXR0cmlidXRlcyxcbiAgICAgICAgICAgICdodHRwLnJvdXRlJzogcm91dGU/LmZ1bmN0aW9uTmFtZSB8fCAnJyxcbiAgICAgICAgICAgICdodHRwLmNvbnRyb2xsZXInOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfVxuICAgICAgKS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgIC8vIEhhbmRsZSBlcnJvciByZXNwb25zZSBhZnRlciBzcGFuIGVuZHNcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRXhjZXB0aW9uKHJlcXVlc3QsIGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKSwgcmVzcG9uc2UpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBtZXJnZWQgb2JzZXJ2YWJpbGl0eSBjb25maWcgZnJvbSBjb250cm9sbGVyIGFuZCBtZXRob2QgbGV2ZWxcbiAgICovXG4gIHByb3RlY3RlZCBnZXRPYnNlcnZhYmlsaXR5Q29uZmlnKHJvdXRlPzogUm91dGUgfCBudWxsKTogQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWcgPSB0aGlzLmdldENvbnRyb2xsZXJDb25maWcoKTtcbiAgICByZXR1cm4gbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyhjb250cm9sbGVyQ29uZmlnPy5vYnNlcnZhYmlsaXR5LCByb3V0ZT8ub2JzZXJ2YWJpbGl0eSk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgYXV0b21hdGljIHRhZ3MgZm9yIEhUVFAgcmVxdWVzdHMuXG4gICAqIFRoZXNlIHRhZ3MgZW5hYmxlIHBvd2VyZnVsIGZpbHRlcmluZyBpbiBvYnNlcnZhYmlsaXR5IFVJcy5cbiAgICovXG4gIHByb3RlY3RlZCBidWlsZEF1dG9tYXRpY1RhZ3MoXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICBhY3RvcjogQWN0b3IgfCB1bmRlZmluZWQsXG4gICAgZXZlbnQ6IEFQSUdhdGV3YXlFdmVudFxuICApOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBjb25zdCB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cbiAgICAvLyBIVFRQIG1ldGhvZCBjYXRlZ29yeSAoc2ltaWxhciB0byBzZXJ2aWNlIG9wZXJhdGlvbnMpXG4gICAgY29uc3QgbWV0aG9kID0gcmVxdWVzdC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCk7XG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgfHwgbWV0aG9kID09PSAnSEVBRCcpIHtcbiAgICAgIHRhZ3Mub3BlcmF0aW9uX2NhdGVnb3J5ID0gJ3JlYWQnO1xuICAgIH0gZWxzZSBpZiAobWV0aG9kID09PSAnUE9TVCcgfHwgbWV0aG9kID09PSAnUFVUJyB8fCBtZXRob2QgPT09ICdQQVRDSCcpIHtcbiAgICAgIHRhZ3Mub3BlcmF0aW9uX2NhdGVnb3J5ID0gJ3dyaXRlJztcbiAgICB9IGVsc2UgaWYgKG1ldGhvZCA9PT0gJ0RFTEVURScpIHtcbiAgICAgIHRhZ3Mub3BlcmF0aW9uX2NhdGVnb3J5ID0gJ2RlbGV0ZSc7XG4gICAgfVxuXG4gICAgLy8gQXV0aCBtZXRob2QgZm9yIGVhc3kgZmlsdGVyaW5nIGJ5IGF1dGhlbnRpY2F0aW9uIHR5cGVcbiAgICBpZiAoYWN0b3I/LmF1dGhNZXRob2QpIHtcbiAgICAgIHRhZ3MuYXV0aF9tZXRob2QgPSBhY3Rvci5hdXRoTWV0aG9kO1xuICAgIH1cblxuICAgIC8vIEFjdG9yIHR5cGUgKHVzZXIgdnMgc2VydmljZSlcbiAgICBpZiAoYWN0b3I/LmFjdG9yVHlwZSkge1xuICAgICAgdGFncy5hY3Rvcl90eXBlID0gYWN0b3IuYWN0b3JUeXBlO1xuICAgIH1cblxuICAgIC8vIEFQSSBzdGFnZSAoZGV2LCBzdGFnaW5nLCBwcm9kKVxuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uc3RhZ2UpIHtcbiAgICAgIHRhZ3Muc3RhZ2UgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5zdGFnZTtcbiAgICB9XG5cbiAgICAvLyBUZW5hbnQgY29udGV4dCAoZm9yIG11bHRpLXRlbmFudCBmaWx0ZXJpbmcpXG4gICAgaWYgKGFjdG9yPy50ZW5hbnRJZCkge1xuICAgICAgdGFncy50ZW5hbnRfaWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICB9XG5cbiAgICByZXR1cm4gdGFncztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCBzcGFuIGF0dHJpYnV0ZXMgYmFzZWQgb24gb2JzZXJ2YWJpbGl0eSBjb25maWcuXG4gICAqIEFsd2F5cyBpbmNsdWRlcyBiYXNpYyBIVFRQIGluZm8uIFJlcXVlc3QgYm9keS9oZWFkZXJzL3F1ZXJ5IGFyZSBvbmx5XG4gICAqIGluY2x1ZGVkIGlmIGV4cGxpY2l0bHkgY29uZmlndXJlZCB2aWEgYGluY2x1ZGVzYC5cbiAgICovXG4gIHByb3RlY3RlZCBidWlsZFNwYW5BdHRyaWJ1dGVzKFxuICAgIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICBjb25maWc/OiBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZ1xuICApOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gICAgLy8gQWx3YXlzIGluY2x1ZGUgYmFzaWMgSFRUUCBhdHRyaWJ1dGVzXG4gICAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgJ2h0dHAubWV0aG9kJzogcmVxdWVzdC5odHRwTWV0aG9kLFxuICAgICAgJ2h0dHAucGF0aCc6IHJlcXVlc3QucGF0aCxcbiAgICAgICdodHRwLnJlcXVlc3RJZCc6IHJlcXVlc3QucmVxdWVzdElkLFxuICAgICAgJ2h0dHAudXNlckFnZW50JzogZXZlbnQuaGVhZGVycz8uWyAndXNlci1hZ2VudCcgXSB8fCBldmVudC5oZWFkZXJzPy5bICdVc2VyLUFnZW50JyBdLFxuICAgICAgJ2h0dHAuc291cmNlSXAnOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwLFxuICAgIH07XG5cbiAgICAvLyBJZiBkaXNhYmxlZCBvciBubyBpbmNsdWRlcyBjb25maWcsIHJldHVybiBiYXNpYyBhdHRycyBvbmx5XG4gICAgaWYgKGNvbmZpZz8uZW5hYmxlZCA9PT0gZmFsc2UgfHwgIWNvbmZpZz8uaW5jbHVkZXMpIHtcbiAgICAgIHJldHVybiBhdHRycztcbiAgICB9XG5cbiAgICAvLyBCdWlsZCByZXF1ZXN0IGRhdGEgYmFzZWQgb24gaW5jbHVkZXMgY29uZmlnXG4gICAgY29uc3QgaW5jbHVkZXMgPSBub3JtYWxpemVJbmNsdWRlcyhjb25maWcuaW5jbHVkZXMpO1xuICAgIGNvbnN0IHJlcXVlc3REYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuXG4gICAgaWYgKGluY2x1ZGVzLnJlcXVlc3QuaGVhZGVycykge1xuICAgICAgY29uc3QgaGVhZGVyRGF0YSA9IHNlbGVjdEZpZWxkcyhyZXF1ZXN0LmhlYWRlcnMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGluY2x1ZGVzLnJlcXVlc3QuaGVhZGVycyk7XG4gICAgICBpZiAoaGVhZGVyRGF0YSkgcmVxdWVzdERhdGEuaGVhZGVycyA9IGhlYWRlckRhdGE7XG4gICAgfVxuXG4gICAgaWYgKGluY2x1ZGVzLnJlcXVlc3QuYm9keSAmJiByZXF1ZXN0LmJvZHkpIHtcbiAgICAgIGNvbnN0IGJvZHlEYXRhID0gdHlwZW9mIHJlcXVlc3QuYm9keSA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBzZWxlY3RGaWVsZHNGcm9tQm9keShyZXF1ZXN0LmJvZHksIGluY2x1ZGVzLnJlcXVlc3QuYm9keSlcbiAgICAgICAgOiBzZWxlY3RGaWVsZHMocmVxdWVzdC5ib2R5IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpbmNsdWRlcy5yZXF1ZXN0LmJvZHkpO1xuICAgICAgaWYgKGJvZHlEYXRhKSByZXF1ZXN0RGF0YS5ib2R5ID0gYm9keURhdGE7XG4gICAgfVxuXG4gICAgaWYgKGluY2x1ZGVzLnJlcXVlc3QucXVlcnkgJiYgcmVxdWVzdC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMpIHtcbiAgICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IHNlbGVjdEZpZWxkcyhyZXF1ZXN0LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaW5jbHVkZXMucmVxdWVzdC5xdWVyeSk7XG4gICAgICBpZiAocXVlcnlEYXRhKSByZXF1ZXN0RGF0YS5xdWVyeSA9IHF1ZXJ5RGF0YTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBkYXRhIHByb3RlY3Rpb24gYW5kIGFkZCB0byBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlcXVlc3REYXRhKS5sZW5ndGggPiAwKSB7XG4gICAgICBhdHRyc1sgJ3JlcXVlc3QnIF0gPSBjb25maWcuZGF0YVByb3RlY3Rpb24/LmVuYWJsZWQgIT09IGZhbHNlXG4gICAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShyZXF1ZXN0RGF0YSwgY29uZmlnLmRhdGFQcm90ZWN0aW9uKVxuICAgICAgICA6IHJlcXVlc3REYXRhO1xuICAgIH1cblxuICAgIHJldHVybiBhdHRycztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCByZXNwb25zZSBhdHRyaWJ1dGVzIGJhc2VkIG9uIG9ic2VydmFiaWxpdHkgY29uZmlnLlxuICAgKiBPbmx5IGNhcHR1cmVzIHJlc3BvbnNlIGJvZHkvaGVhZGVycyBpZiBleHBsaWNpdGx5IGNvbmZpZ3VyZWQgdmlhIGBpbmNsdWRlc2AuXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRSZXNwb25zZUF0dHJpYnV0ZXMoXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGNvbmZpZz86IENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnXG4gICk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkIHtcbiAgICAvLyBBbHdheXMgaW5jbHVkZSBzdGF0dXMgY29kZVxuICAgIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgICdodHRwLnN0YXR1c0NvZGUnOiByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgIH07XG5cbiAgICAvLyBJZiBkaXNhYmxlZCBvciBubyBpbmNsdWRlcyBjb25maWcsIHJldHVybiBqdXN0IHN0YXR1cyBjb2RlXG4gICAgaWYgKGNvbmZpZz8uZW5hYmxlZCA9PT0gZmFsc2UgfHwgIWNvbmZpZz8uaW5jbHVkZXMpIHtcbiAgICAgIHJldHVybiBhdHRycztcbiAgICB9XG5cbiAgICBjb25zdCBpbmNsdWRlcyA9IG5vcm1hbGl6ZUluY2x1ZGVzKGNvbmZpZy5pbmNsdWRlcyk7XG4gICAgY29uc3QgcmVzcG9uc2VEYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuXG4gICAgaWYgKGluY2x1ZGVzLnJlc3BvbnNlLmhlYWRlcnMgJiYgcmVzcG9uc2UuaGVhZGVycykge1xuICAgICAgY29uc3QgaGVhZGVyRGF0YSA9IHNlbGVjdEZpZWxkcyhyZXNwb25zZS5oZWFkZXJzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpbmNsdWRlcy5yZXNwb25zZS5oZWFkZXJzKTtcbiAgICAgIGlmIChoZWFkZXJEYXRhKSByZXNwb25zZURhdGEuaGVhZGVycyA9IGhlYWRlckRhdGE7XG4gICAgfVxuXG4gICAgaWYgKGluY2x1ZGVzLnJlc3BvbnNlLmJvZHkgJiYgcmVzcG9uc2UuYm9keSkge1xuICAgICAgY29uc3QgYm9keURhdGEgPSBzZWxlY3RGaWVsZHNGcm9tQm9keShyZXNwb25zZS5ib2R5LCBpbmNsdWRlcy5yZXNwb25zZS5ib2R5KTtcbiAgICAgIGlmIChib2R5RGF0YSkgcmVzcG9uc2VEYXRhLmJvZHkgPSBib2R5RGF0YTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBkYXRhIHByb3RlY3Rpb24gYW5kIGFkZCB0byBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlc3BvbnNlRGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgYXR0cnNbICdyZXNwb25zZScgXSA9IGNvbmZpZy5kYXRhUHJvdGVjdGlvbj8uZW5hYmxlZCAhPT0gZmFsc2VcbiAgICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKHJlc3BvbnNlRGF0YSwgY29uZmlnLmRhdGFQcm90ZWN0aW9uKVxuICAgICAgICA6IHJlc3BvbnNlRGF0YTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cnM7XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHJvdXRlIHRoYXQgbWF0Y2hlcyB0aGUgSFRUUCBtZXRob2QgYW5kIHJlc291cmNlLlxuICAgKiBAcGFyYW0gcmVxdWVzdERhdGEgLSBUaGUgcmVxdWVzdCBkYXRhIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIG1hdGNoaW5nIHJvdXRlIG9yIG51bGwgaWYgbm90IGZvdW5kLlxuICAgKi9cbiAgcHJpdmF0ZSBmaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCk6IFJvdXRlIHwgbnVsbCB7XG4gICAgbGV0IGNvbnRyb2xsZXI6IGFueSA9IHRoaXM7XG5cbiAgICAvLyBEZXRlcm1pbmUgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGJ5IGZpbmRpbmcgdGhlIGxvbmdlc3QgY29tbW9uIHByZWZpeCB0aGF0IGVuZHMgd2l0aCB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgY29uc3QgY29udHJvbGxlck5hbWUgPSB0eXBlb2YgY29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9PT0gJ3N0cmluZycgPyBjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lIDogJyc7XG4gICAgbGV0IGNvbnRyb2xsZXJCYXNlUGF0aCA9IGNvbnRyb2xsZXJOYW1lID8gYC8ke2NvbnRyb2xsZXJOYW1lfWAgOiAnJztcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0Um9vdCA9ICcvJztcblxuICAgIC8vIEZvciBjb250cm9sbGVycyBpbiBzdWJkaXJlY3Rvcmllcywgd2UgbmVlZCB0byBtYXRjaCB0aGUgYWN0dWFsIHJlc291cmNlIHBhdGhcbiAgICAvLyBDaGVjayBpZiByZXNvdXJjZSBjb250YWlucyB0aGUgY29udHJvbGxlciBuYW1lIGFzIHBhcnQgb2YgYSBsb25nZXIgcGF0aFxuICAgIGNvbnN0IHJlcXVlc3RSZXNvdXJjZSA9IChyZXF1ZXN0RGF0YS5yZXNvdXJjZSB8fCByZXF1ZXN0RGF0YS5wYXRoIHx8ICcvJykgYXMgc3RyaW5nO1xuICAgIGNvbnN0IHJlc291cmNlUGFydHMgPSByZXF1ZXN0UmVzb3VyY2Uuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgY29udHJvbGxlck5hbWVQYXJ0cyA9IGNvbnRyb2xsZXJOYW1lLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuXG4gICAgLy8gRmluZCBpZiB0aGUgY29udHJvbGxlciBuYW1lIHBhcnRzIGFyZSBwcmVzZW50IGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgbGV0IGJhc2VQYXRoRW5kSW5kZXggPSAtMTtcbiAgICBpZiAoY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyBMb29rIGZvciB0aGUgY29udHJvbGxlciBuYW1lIHNlcXVlbmNlIGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSByZXNvdXJjZVBhcnRzLmxlbmd0aCAtIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgbGV0IG1hdGNoZXMgPSB0cnVlO1xuICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBpZiAocmVzb3VyY2VQYXJ0c1sgaSArIGogXSAhPT0gY29udHJvbGxlck5hbWVQYXJ0c1sgaiBdKSB7XG4gICAgICAgICAgICBtYXRjaGVzID0gZmFsc2U7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICBiYXNlUGF0aEVuZEluZGV4ID0gaSArIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoIC0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChiYXNlUGF0aEVuZEluZGV4ID49IDApIHtcbiAgICAgIC8vIEZvdW5kIHRoZSBjb250cm9sbGVyIGJhc2UgcGF0aCBpbiB0aGUgcmVzb3VyY2VcbiAgICAgIGNvbnN0IGJhc2VQYXRoUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKDAsIGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIGNvbnRyb2xsZXJCYXNlUGF0aCA9ICcvJyArIGJhc2VQYXRoUGFydHMuam9pbignLycpO1xuICAgICAgY29uc3QgcmVtYWluaW5nUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZW1haW5pbmdQYXJ0cy5sZW5ndGggPiAwID8gJy8nICsgcmVtYWluaW5nUGFydHMuam9pbignLycpIDogJy8nO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGYWxsYmFjayB0byBvcmlnaW5hbCBsb2dpYyBmb3Igc2ltcGxlIGNhc2VzXG4gICAgICBpZiAoY29udHJvbGxlckJhc2VQYXRoICYmIHJlcXVlc3RSZXNvdXJjZS5zdGFydHNXaXRoKGNvbnRyb2xsZXJCYXNlUGF0aCkpIHtcbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3RSZXNvdXJjZS5zdWJzdHJpbmcoY29udHJvbGxlckJhc2VQYXRoLmxlbmd0aCkgfHwgJy8nO1xuICAgICAgfSBlbHNlIGlmICghY29udHJvbGxlckJhc2VQYXRoKSB7XG4gICAgICAgIC8vIE5vIGNvbnRyb2xsZXJOYW1lIGNvbmZpZ3VyZWQ6IHRyZWF0IHRoZSBmdWxsIHJlc291cmNlIGFzIHRoZSByb3V0ZSBwYXRoLlxuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdFJlc291cmNlIHx8ICcvJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXBhcmF0ZSByb3V0ZXMgaW50byBleGFjdCBhbmQgcGFyYW1ldGVyaXplZCBmb3IgcHJvcGVyIHByaW9yaXRpemF0aW9uXG4gICAgY29uc3QgZXhhY3RNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuICAgIGNvbnN0IHBhcmFtZXRlcml6ZWRNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuXG4gICAgLy8gRmlyc3QgcGFzczogY2F0ZWdvcml6ZSByb3V0ZXMgYnkgdHlwZSBhbmQgbWV0aG9kXG4gICAgZm9yIChjb25zdCBbIHJvdXRlS2V5LCByb3V0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRyb2xsZXIucm91dGVzIHx8IHt9KSBhcyBbIHN0cmluZywgUm91dGUgXVtdKSB7XG4gICAgICBjb25zdCBbIHJvdXRlTWV0aG9kLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIC8vIFNraXAgaWYgSFRUUCBtZXRob2QgZG9lc24ndCBtYXRjaFxuICAgICAgaWYgKHJvdXRlTWV0aG9kICE9PSByZXF1ZXN0RGF0YS5odHRwTWV0aG9kKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXRlZ29yaXplIHJvdXRlIHR5cGVcbiAgICAgIGlmIChyb3V0ZVBhdGguaW5jbHVkZXMoJ3snKSAmJiByb3V0ZVBhdGguaW5jbHVkZXMoJ30nKSkge1xuICAgICAgICBwYXJhbWV0ZXJpemVkTWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhhY3RNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2Vjb25kIHBhc3M6IFRyeSBleGFjdCBtYXRjaGVzIGZpcnN0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUgfSBvZiBleGFjdE1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmIChyb3V0ZVBhdGggPT09IHJlc291cmNlV2l0aG91dFJvb3QpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgcGFyYW1ldGVyaXplZCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCwge1xuICAgICAgICAgICAgcGF0dGVybjogcGF0aFRvUmVnZXhwUGF0dGVybixcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hSZXN1bHQucGFyYW1zLFxuICAgICAgICAgICAgc3BlY2lmaWNpdHlTY29yZTogc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMuZmluZChtID0+IG0ucm91dGVLZXkgPT09IHJvdXRlS2V5KT8uc3BlY2lmaWNpdHlTY29yZVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gTm90ZTogV2UgZG9uJ3QgbmVlZCB0byBtYW51YWxseSBleHRyYWN0IHBhcmFtZXRlcnMgc2luY2UgQVBJIEdhdGV3YXlcbiAgICAgICAgICAvLyBhbHJlYWR5IHByb3ZpZGVzIHRoZW0gaW4gcmVxdWVzdERhdGEucGF0aFBhcmFtZXRlcnNcbiAgICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEVycm9yIG1hdGNoaW5nIHJvdXRlIHBhdHRlcm4gJHtwYXRoVG9SZWdleHBQYXR0ZXJufTpgLCBlcnJvcik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIG1hdGNoaW5nIHJvdXRlIGZvdW5kIGZvciAke3JlcXVlc3REYXRhLmh0dHBNZXRob2R9fCR7cmVzb3VyY2VXaXRob3V0Um9vdH1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqIEBwYXJhbSByb3V0ZSAtIFRoZSBtYXRjaGVkIHJvdXRlLlxuICAgKiBAcmV0dXJucyBUaGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0Um91dGVGdW5jdGlvbihyb3V0ZTogUm91dGUgfCBudWxsKTogRnVuY3Rpb24ge1xuICAgIGlmICghcm91dGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gICAgfVxuXG4gICAgLy9AdHMtaWdub3JlXG4gICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXNbIHJvdXRlLmZ1bmN0aW9uTmFtZSBdO1xuXG4gICAgcmV0dXJuIHR5cGVvZiByb3V0ZUZ1bmN0aW9uID09PSBcImZ1bmN0aW9uXCIgPyByb3V0ZUZ1bmN0aW9uIDogdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgdGhlIE5vdEZvdW5kIHJvdXRlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNDA0IHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZU5vdEZvdW5kKF9yZXE6IFJlcXVlc3QpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJObyBSb3V0ZSBGb3VuZCFcIiB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlcnJvckhhbmRsZXI/OiBDb250cm9sbGVyRXJyb3JIYW5kbGVyO1xuICBwcm90ZWN0ZWQgZ2V0RXJyb3JIYW5kbGVyKCk6IENvbnRyb2xsZXJFcnJvckhhbmRsZXIge1xuICAgIGlmICghdGhpcy5lcnJvckhhbmRsZXIpIHtcbiAgICAgIHRoaXMuZXJyb3JIYW5kbGVyID0gY3JlYXRlRXJyb3JIYW5kbGVyKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmVycm9ySGFuZGxlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGV4Y2VwdGlvbnMgYW5kIHJldHVybnMgYSBKU09OIHJlc3BvbnNlIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0gZXJyIC0gVGhlIGVycm9yIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNTAwIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogUmVzcG9uc2UpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSB0aGlzLmdldEVycm9ySGFuZGxlcigpKGVyciwgcmVxLCByZXMpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGVycm9yUmVzcG9uc2UpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVJlc3BvbnNlKHJlczogUmVzcG9uc2UgfCBBUElHYXRld2F5UHJveHlSZXN1bHQpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGlmIChyZXMgaW5zdGFuY2VvZiBSZXNwb25zZUNvbnRleHQpIHtcbiAgICAgIHJldHVybiByZXMuYnVpbGQoKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGV4ZWN1dGlvbiBjb250ZXh0IGZvciB0aGUgcmVxdWVzdFxuICAgKiBcbiAgICogZGlmZmVyZW50IG1pZGRsZXdhcmUgY2FuIGVuaGFuY2UgdGhlIGFjdG9yIGNvbnRleHQgYnkgdXNpbmcgdGhlIGVuaGFuY2VBY3RvciBtZXRob2RcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHNcbiAgICogY29uc3QgbWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gICAqICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdCwgX3Jlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICBjdHg/LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgIHJvbGVzOiBbJ2FkbWluJywgJ3VzZXInXSxcbiAgICogICAgIHBlcm1pc3Npb25zOiBbJ3JlYWQnLCAnd3JpdGUnXSxcbiAgICogICAgIHN1YnNjcmlwdGlvbjogeyB0aWVyOiAnZW50ZXJwcmlzZScgfVxuICAgKiAgIH0pO1xuICAgKiAgfVxuICAgKiB9XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZSk7XG4gICAqIFxuICAgKiBPUlxuICAgKiBcbiAgICogY29uc3Qgc2VjdXJpdHlNaWRkbGV3YXJlID0ge1xuICAgKiAgIGJlZm9yZTogYXN5bmMgKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICAgIGN0eC5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICAgIHJpc2tQcm9maWxlOiBhd2FpdCBhc3Nlc3NSaXNrKGN0eC5hY3Rvci5hY3RvcklkKSxcbiAgICogICAgICAgZGV2aWNlOiBhd2FpdCBtYWtlRGV2aWNlQ29udGV4dChyZXF1ZXN0KVxuICAgKiAgICAgfSk7XG4gICAqICAgfVxuICAgKiB9O1xuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKHNlY3VyaXR5TWlkZGxld2FyZSk7XG4gICAqXG4gICAqIEBwYXJhbSBldmVudCBcbiAgICogQHBhcmFtIGNvbnRleHQgXG4gICAqIEBwYXJhbSByZXF1ZXN0IFxuICAgKiBAcGFyYW0gcmVzcG9uc2UgXG4gICAqIEByZXR1cm5zIFxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGFjdG9yID0gdGhpcy5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgIGNvbnN0IGN0eDogRXhlY3V0aW9uQ29udGV4dCA9IHtcbiAgICAgIGV2ZW50LFxuICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIGFjdG9yLFxuICAgICAgZGVidWdJbmZvOiB7fSxcblxuICAgICAgLy8gU2ltcGxlIGFjdG9yIGVuaGFuY2VtZW50IG1ldGhvZFxuICAgICAgZW5oYW5jZUFjdG9yOiAoZW5oYW5jZW1lbnQ6IFBhcnRpYWw8QWN0b3I+KSA9PiB7XG4gICAgICAgIGlmIChjdHguYWN0b3IpIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKGN0eC5hY3RvciwgZW5oYW5jZW1lbnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiBjdHg7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY29udHJvbGxlciBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0Q29udHJvbGxlckNvbmZpZygpOiBJQ29udHJvbGxlckNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdjb250cm9sbGVyQ29uZmlnJykgfHwge307XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdHMgYWN0b3IgY29udGV4dCBmcm9tIHRoZSByZXF1ZXN0LlxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBmb3IgY3VzdG9tIGFjdG9yIGV4dHJhY3Rpb24gbG9naWMuXG4gICAqIFxuICAgKiBOb3RlOiBjb3JyZWxhdGlvbklkIGlzIE5PVCBzZXQgaGVyZSAtIGl0J3MgZGV0ZXJtaW5lZCBmcm9tIHRyYWNlIGNvbnRleHRcbiAgICogZXh0cmFjdGlvbiBhbmQgc2V0IG9uIHRoZSBFeGVjdXRpb25Db250ZXh0LiBUaGUgYWN0b3IuY29ycmVsYXRpb25JZCBpc1xuICAgKiBzeW5jZWQgbGF0ZXIgaW4gTGFtYmRhSGFuZGxlciBhZnRlciB0cmFjZSBjb250ZXh0IGlzIHJlc29sdmVkLlxuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gcmVxdWVzdCAtIFRoZSByZXF1ZXN0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIGFjdG9yIGNvbnRleHQuXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcblxuICAgIGNvbnN0IGFjdG9yOiBBY3RvciA9IHtcbiAgICAgIHJlcXVlc3RJZCxcbiAgICAgIHRpbWVzdGFtcCxcbiAgICAgIHNvdXJjZUlwOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwLFxuICAgICAgdXNlckFnZW50OiBldmVudC5oZWFkZXJzPy5bICd1c2VyLWFnZW50JyBdIHx8IGV2ZW50LmhlYWRlcnM/LlsgJ1VzZXItQWdlbnQnIF0sXG4gICAgICAvLyBOb3RlOiBjb3JyZWxhdGlvbklkIGlzIHNldCBsYXRlciBhZnRlciB0cmFjZSBjb250ZXh0IGV4dHJhY3Rpb25cbiAgICB9O1xuXG4gICAgLy8gQ29nbml0byBhdXRoZW50aWNhdGlvbiB3aXRoIGZvY3VzZWQgZW5oYW5jZW1lbnRzXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXMpIHtcbiAgICAgIHRoaXMuZXh0cmFjdENvZ25pdG9Db250ZXh0KGV2ZW50LnJlcXVlc3RDb250ZXh0LmF1dGhvcml6ZXIuY2xhaW1zLCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFQSSBLZXkgYXV0aGVudGljYXRpb25cbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSB8fCByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtYXBpLWtleScgXSkge1xuICAgICAgdGhpcy5leHRyYWN0QXBpS2V5Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBJQU0gYXV0aGVudGljYXRpb24gXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuKSB7XG4gICAgICB0aGlzLmV4dHJhY3RJYW1Db250ZXh0KGV2ZW50LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFub255bW91c1xuICAgIGVsc2Uge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvcklkID0gJ2Fub255bW91cyc7XG4gICAgfVxuXG4gICAgLy8gU2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHRcbiAgICB0aGlzLmV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgIGFjdG9yLmFwaVN0YWdlID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LnN0YWdlO1xuICAgIGFjdG9yLmFwaUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmFwaUlkO1xuXG4gICAgcmV0dXJuIGFjdG9yO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQ29nbml0byBhY3RvciBjb250ZXh0IGJhc2VkIG9uIGRvY3VtZW50ZWQgQVdTIENvZ25pdG8gSldUIGNsYWltc1xuICAgKiBPbmx5IGV4dHJhY3RzIHdoYXQncyBvZmZpY2lhbGx5IGRvY3VtZW50ZWQgYW5kIGF2YWlsYWJsZSBpbiBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAqIFxuICAgKiBAcGFyYW0gY2xhaW1zIC0gQ29nbml0byBKV1QgY2xhaW1zIGZyb20gdGhlIGF1dGhvcml6ZXJcbiAgICogQHBhcmFtIGFjdG9yIC0gQWN0b3Igb2JqZWN0IHRvIHBvcHVsYXRlXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdENvZ25pdG9Db250ZXh0KGNsYWltczogYW55LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcblxuICAgICAgLy8gQWN0b3IgSUQgd2l0aCBkb2N1bWVudGVkIGZhbGxiYWNrIHN0cmF0ZWd5OiBjb2duaXRvOnVzZXJuYW1lIC0+IGVtYWlsIC0+IHN1YlxuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0gfHwgY2xhaW1zLmVtYWlsIHx8IGNsYWltcy5zdWI7XG5cbiAgICAgIC8vIFN0YW5kYXJkIHVzZXIgYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBDb2duaXRvIHVzZXIgYXR0cmlidXRlcylcbiAgICAgIGFjdG9yLmVtYWlsID0gY2xhaW1zLmVtYWlsO1xuICAgICAgYWN0b3IuZW1haWxWZXJpZmllZCA9IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IucGhvbmVOdW1iZXIgPSBjbGFpbXMucGhvbmVfbnVtYmVyO1xuICAgICAgYWN0b3IucGhvbmVWZXJpZmllZCA9IGNsYWltcy5waG9uZV9udW1iZXJfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLm5hbWUgPSBjbGFpbXMubmFtZTtcbiAgICAgIGFjdG9yLmxvY2FsZSA9IGNsYWltcy5sb2NhbGU7XG5cbiAgICAgIC8vIFBhcnNlIENvZ25pdG8gZ3JvdXBzIChkb2N1bWVudGVkIGFzIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcpXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLnBhcnNlR3JvdXBzKGNsYWltc1sgJ2NvZ25pdG86Z3JvdXBzJyBdKTtcblxuICAgICAgLy8gRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBwYXR0ZXJuOiBjdXN0b206KilcbiAgICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXMgPSB0aGlzLmV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltcyk7XG5cbiAgICAgIC8vIEJ1aWxkIENvZ25pdG8gY29udGV4dCB3aXRoIG9ubHkgZG9jdW1lbnRlZCBmaWVsZHNcbiAgICAgIGFjdG9yLmNvZ25pdG8gPSB7XG4gICAgICAgIHN1YjogY2xhaW1zLnN1YixcbiAgICAgICAgdXNlcm5hbWU6IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0sXG4gICAgICAgIGdyb3VwczogZ3JvdXBzLCAvLyBBbHdheXMgaW5jbHVkZSBncm91cHMgYXJyYXkgKGVtcHR5IG9yIHBvcHVsYXRlZClcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlczogT2JqZWN0LmtleXMoY3VzdG9tQXR0cmlidXRlcykubGVuZ3RoID4gMCA/IGN1c3RvbUF0dHJpYnV0ZXMgOiB1bmRlZmluZWRcbiAgICAgIH07XG5cbiAgICAgIC8vIEV4dHJhY3QgdGVuYW50IElEIGZyb20gY3VzdG9tIGF0dHJpYnV0ZXMgKGNvbW1vbiBtdWx0aS10ZW5hbnQgcGF0dGVybilcbiAgICAgIGFjdG9yLnRlbmFudElkID0gY3VzdG9tQXR0cmlidXRlcy50ZW5hbnRJZDtcblxuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignRXJyb3IgZXh0cmFjdGluZyBDb2duaXRvIGFjdG9yIGNvbnRleHQnLCB7IGVycm9yLCBjbGFpbXMgfSk7XG5cbiAgICAgIC8vIE1pbmltYWwgZmFsbGJhY2sgZXh0cmFjdGlvblxuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXMuc3ViIHx8ICd1bmtub3duJztcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSBDb2duaXRvIGdyb3VwcyBmcm9tIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcgKGRvY3VtZW50ZWQgQ29nbml0byBmb3JtYXQpXG4gICAqL1xuICBwcm90ZWN0ZWQgcGFyc2VHcm91cHMoZ3JvdXBzOiBhbnkpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHR5cGVvZiBncm91cHMgPT09ICdzdHJpbmcnICYmIGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZ3JvdXBzLnNwbGl0KCcsJykubWFwKGcgPT4gZy50cmltKCkpLmZpbHRlcihnID0+IGcubGVuZ3RoID4gMCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIHVzaW5nIGRvY3VtZW50ZWQgQ29nbml0byBwYXR0ZXJuIChjdXN0b206KilcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXM6IGFueSk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIE9iamVjdC5rZXlzKGNsYWltcykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGtleS5zdGFydHNXaXRoKCdjdXN0b206JykpIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGtleS5yZXBsYWNlKCdjdXN0b206JywgJycpO1xuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzWyBhdHRyaWJ1dGVOYW1lIF0gPSBjbGFpbXNbIGtleSBdO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGN1c3RvbUF0dHJpYnV0ZXM7XG4gIH1cblxuICAvKipcbiAqIEV4dHJhY3Qgc2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHQgLSBmb2N1c2VkIGFwcHJvYWNoXG4gKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICAvLyBTZXNzaW9uIGNvbnRleHRcbiAgICBhY3Rvci5zZXNzaW9uSWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtc2Vzc2lvbi1pZCcgXTtcblxuICAgIC8vIFRlbmFudCBjb250ZXh0IC0gY2hlY2sgY3VzdG9tIGF0dHJpYnV0ZXMgZmlyc3QsIHRoZW4gaGVhZGVyc1xuICAgIGFjdG9yLnRlbmFudElkID0gcmVxdWVzdC5oZWFkZXJzPy5bICd4LXRlbmFudC1pZCcgXSB8fFxuICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcz8uWyAnY3VzdG9tOnRlbmFudElkJyBdO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQVBJIEtleSBjb250ZXh0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhcGkta2V5JztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG5cbiAgICBsZXQgYXBpS2V5SWQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlOiAncmVxdWVzdC1jb250ZXh0JyB8ICdoZWFkZXInO1xuXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5KSB7XG4gICAgICBhcGlLZXlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleUlkIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleTtcbiAgICAgIHNvdXJjZSA9ICdyZXF1ZXN0LWNvbnRleHQnO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcGlLZXlJZCA9IHJlcXVlc3QuaGVhZGVyc1sgJ3gtYXBpLWtleScgXSE7XG4gICAgICBzb3VyY2UgPSAnaGVhZGVyJztcbiAgICB9XG5cbiAgICBhY3Rvci5hY3RvcklkID0gYGFwaS1rZXk6JHthcGlLZXlJZH1gO1xuICAgIGFjdG9yLmFwaUtleSA9IHtcbiAgICAgIGlkOiBhcGlLZXlJZCxcbiAgICAgIHNvdXJjZTogc291cmNlLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBJQU0gY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RJYW1Db250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnaWFtJztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG4gICAgYWN0b3IuYWN0b3JJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fFxuICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8XG4gICAgICAndW5rbm93bi1pYW0tdXNlcic7XG5cbiAgICBhY3Rvci5pYW0gPSB7XG4gICAgICB1c2VyQXJuOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgdW5kZWZpbmVkLFxuICAgICAgdXNlcklkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgdW5kZWZpbmVkLFxuICAgICAgYWNjb3VudElkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFjY291bnRJZCB8fCB1bmRlZmluZWQsXG4gICAgICBjYWxsZXI6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uY2FsbGVyIHx8IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG59XG4iXX0=