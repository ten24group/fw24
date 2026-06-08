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
                    // Track request payload size
                    if (event.body) {
                        requestSpan.metric('http.request_content_length', Buffer.byteLength(event.body, 'utf8'));
                    }
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
                                requestSpan.setData(responseAttrs);
                            }
                        }
                        // Tag HTTP status code and response size for filtering
                        this.tagResponseMetrics(requestSpan, response);
                        // Flush happens automatically in executeWithSpanAndFlush's finally block
                        return this.handleResponse(controllerResponse);
                    }
                    // Fallback to the in-memory responseContext
                    if (observabilityConfig?.enabled !== false) {
                        const responseAttrs = this.buildResponseAttributes(response, observabilityConfig);
                        if (responseAttrs) {
                            requestSpan.setData(responseAttrs);
                        }
                    }
                    // Tag HTTP status code and response size for filtering
                    this.tagResponseMetrics(requestSpan, response);
                    // Flush happens automatically in executeWithSpanAndFlush's finally block
                    return response.build();
                }
                catch (err) {
                    const errorObj = err instanceof Error ? err : new Error(String(err));
                    this.logger.error('LambdaHandler error: ', errorObj);
                    // Execute error middleware
                    await this.executeMiddlewarePipeline('onError', request, response, ctx, errorObj);
                    // Tag HTTP status code and error category for filtering
                    const errorStatusCode = response.statusCode || 500;
                    requestSpan.tag('http.status_code', String(errorStatusCode));
                    requestSpan.tag('http.status_code_class', this.getStatusCodeClass(errorStatusCode));
                    requestSpan.tag('error_category', this.categorizeError(errorStatusCode, errorObj));
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
            }, context).catch((err) => {
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
     * Tag the span with HTTP status code, status code class, response size,
     * and error category (for 4xx/5xx responses).
     */
    tagResponseMetrics(span, response) {
        const statusCode = response.statusCode ?? 200;
        span.tag('http.status_code', String(statusCode));
        span.tag('http.status_code_class', this.getStatusCodeClass(statusCode));
        if (response.body) {
            span.metric('http.response_content_length', Buffer.byteLength(response.body, 'utf8'));
        }
        // Error categorization for non-success responses
        if (statusCode >= 400) {
            span.tag('error_category', this.categorizeError(statusCode));
        }
    }
    /**
     * Classify HTTP status code into a class string for DynamoDB-safe filtering.
     */
    getStatusCodeClass(statusCode) {
        if (statusCode < 200)
            return '1xx';
        if (statusCode < 300)
            return '2xx';
        if (statusCode < 400)
            return '3xx';
        if (statusCode < 500)
            return '4xx';
        return '5xx';
    }
    /**
     * Classify an error into a broad category for filtering and triage.
     * Categories: auth, validation, infrastructure, server, application.
     */
    categorizeError(statusCode, error) {
        if (statusCode === 401 || statusCode === 403)
            return 'auth';
        if (statusCode === 429)
            return 'throttle';
        if (statusCode >= 400 && statusCode < 500)
            return 'validation';
        if (error?.message?.match(/timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up/i)) {
            return 'infrastructure';
        }
        if (statusCode >= 500)
            return 'server';
        return 'application';
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFtRUEsNENBeUJDO0FBM0ZELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFDNUQsMENBQWlIO0FBRWpILHVEQUF5RjtBQUN6Riw2RUFNK0M7QUFFL0Msa0RBQTRGO0FBRTVGLHVFQUFrRTtBQUNsRSwyREFJNkI7QUFDN0IsdURBQW1EO0FBQ25ELHVEQUF3RTtBQUN4RSx5REFBcUQ7QUFXckQsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7QUFFM0QsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDLENBQUE7QUFGWSxRQUFBLGdCQUFnQixvQkFFNUI7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BSXFCLEVBQ3JCLE9BQXFGO0lBR3JGLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsWUFBRyxFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFHdkUsSUFBTSxvQkFBb0IsR0FBMUIsTUFBTSxvQkFBb0I7UUFFbEIsQUFBTixLQUFLLENBQUMsYUFBYTtZQUNqQixzREFBc0Q7UUFDeEQsQ0FBQztLQUNGLENBQUE7SUFITztRQURMLE1BQU0sQ0FBQyxJQUFJLENB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QUFXLFFBQVEsRUFBRSxDQUFDO1FBQ3RDLEtBQUssQ0FBQyxNQUFNLEdBQUc7WUFDYixFQUFFLEVBQUUsUUFBUTtZQUNaLE1BQU0sRUFBRSxNQUFNO1NBQ2YsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNPLGlCQUFpQixDQUFDLEtBQXNCLEVBQUUsS0FBWTtRQUM5RCxLQUFLLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQztRQUN6QixLQUFLLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUM1QixLQUFLLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLElBQUk7WUFDbEQsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTztZQUN2QyxrQkFBa0IsQ0FBQztRQUVyQixLQUFLLENBQUMsR0FBRyxHQUFHO1lBQ1YsT0FBTyxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE9BQU8sSUFBSSxTQUFTO1lBQzdELE1BQU0sRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxJQUFJLElBQUksU0FBUztZQUN6RCxTQUFTLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsU0FBUyxJQUFJLFNBQVM7WUFDakUsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE1BQU0sSUFBSSxTQUFTO1NBQzVELENBQUM7SUFDSixDQUFDO0NBQ0Y7QUF6NEJELHNDQXk0QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIElDb250cm9sbGVyQ29uZmlnIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IEdldCwgUm91dGVNZXRob2RzIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnMvbWV0aG9kXCI7XG5pbXBvcnQgeyBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yLCBWYWxpZGF0aW9uRmFpbGVkRXJyb3IsIGNyZWF0ZUVycm9ySGFuZGxlciB9IGZyb20gXCIuLi8uLi9lcnJvcnMvXCI7XG5pbXBvcnQgdHlwZSB7IFJlcXVlc3QsIFJlc3BvbnNlLCBSb3V0ZSB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIGdlbmVyYXRlVHJhY2VJZCwgcmVkYWN0U2Vuc2l0aXZlRGF0YSB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWcsXG4gIG1lcmdlT2JzZXJ2YWJpbGl0eUNvbmZpZ3MsXG4gIG5vcm1hbGl6ZUluY2x1ZGVzLFxuICBzZWxlY3RGaWVsZHMsXG4gIHNlbGVjdEZpZWxkc0Zyb21Cb2R5XG59IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHkvY29udHJvbGxlci1jb25maWcnO1xuaW1wb3J0IHsgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgeyBpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUsIGlzSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uL3V0aWxzXCI7XG5pbXBvcnQgeyBBY3RvciwgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQge1xuICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICBleHRyYWN0RnJvbUhlYWRlcnMsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxufSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IFJlcXVlc3RDb250ZXh0IH0gZnJvbSBcIi4vcmVxdWVzdC1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbmZpZywgbWVyZ2VSZXNwb25zZUNvbmZpZyB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbmZpZ1wiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb250ZXh0IH0gZnJvbSBcIi4vcmVzcG9uc2UtY29udGV4dFwiO1xuXG5leHBvcnQgdHlwZSBDb250cm9sbGVyRXJyb3JIYW5kbGVyID0gUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlRXJyb3JIYW5kbGVyPjtcblxuLy8gTmV3IGludGVyZmFjZXMgZm9yIG1pZGRsZXdhcmUgYW5kIGVycm9yIGhhbmRsaW5nXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlIHtcbiAgYmVmb3JlPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgYWZ0ZXI/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBvbkVycm9yPzogKGVycm9yOiBFcnJvciwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xufVxuXG4vLyBHbG9iYWwgbWlkZGxld2FyZSBtYW5hZ2VtZW50XG5jb25zdCBnbG9iYWxNaWRkbGV3YXJlczogU2V0PEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlPiA9IG5ldyBTZXQoKTtcblxuZXhwb3J0IGNvbnN0IHVzZU1pZGRsZXdhcmUgPSAobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMuYWRkKG1pZGRsZXdhcmUpO1xufVxuZXhwb3J0IGNvbnN0IGNsZWFyTWlkZGxld2FyZXMgPSAoKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmNsZWFyKCk7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBBUEkgaGFuZGxlciB3aXRob3V0IGRlZmluaW5nIGEgY2xhc3NcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBleHBvcnQgY29uc3QgeyBoYW5kbGVyLCBkZXNjcmlwdG9yIH0gPSBjcmVhdGVBcGlIYW5kbGVyKFxuICogIHsgbWV0aG9kOiBHZXQsIG5hbWU6ICdkZW1vJywgYXV0aG9yaXplcjogJ05PTkUnIH0sXG4gKiAgIGFzeW5jICggZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gKiAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAqICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gKiAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIkhlbGxvIFdvcmxkIVwifSlcbiAqICAgICAgIH0pXG4gKiAgIH1cbiAqIClcbiAqIGBgYFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmcgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLnBhdGggLSBUaGUgcGF0aCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubWV0aG9kIC0gVGhlIEhUVFAgbWV0aG9kIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcmV0dXJucyBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgaGFuZGxlciBmdW5jdGlvbiBhbmQgdGhlIGNvbnRyb2xsZXIgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUFwaUhhbmRsZXIoXG4gIG9wdGlvbnM6IHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgcGF0aD86IHN0cmluZyxcbiAgICBtZXRob2Q/OiBSb3V0ZU1ldGhvZHMsXG4gIH0gJiBJQ29udHJvbGxlckNvbmZpZyxcbiAgaGFuZGxlcjogKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpID0+IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0Pixcbikge1xuXG4gIGNvbnN0IHsgbmFtZSwgcGF0aCA9ICcnLCBtZXRob2QgPSBHZXQsIC4uLmNvbnRyb2xsZXJDb25maWcgfSA9IG9wdGlvbnM7XG5cbiAgQENvbnRyb2xsZXIobmFtZSwgeyAuLi5jb250cm9sbGVyQ29uZmlnLCBhdXRvRXhwb3J0TGFtYmRhSGFuZGxlcjogZmFsc2UgfSlcbiAgY2xhc3MgQ29udHJvbGxlckRlc2NyaXB0b3Ige1xuICAgIEBtZXRob2QocGF0aClcbiAgICBhc3luYyBpbmxpbmVIYW5kbGVyKCkge1xuICAgICAgLy8gcGxhY2Vob2xkZXIgZnVuY3Rpb24gb25seSB1c2VkIGZvciByb3V0aW5nIG1ldGFkYXRhXG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGhhbmRsZXIsICduYW1lJywgeyB2YWx1ZTogJ2hhbmRsZXInIH0pO1xuXG4gIHJldHVybiB7XG4gICAgaGFuZGxlcixcbiAgICBkZXNjcmlwdG9yOiBDb250cm9sbGVyRGVzY3JpcHRvclxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJDb25maWcge1xuICByZXNwb25zZUNvbmZpZz86IFBhcnRpYWw8UmVzcG9uc2VDb25maWc+O1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQVBJQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHByb3RlY3RlZCBtaWRkbGV3YXJlczogU2V0PEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlPiA9IG5ldyBTZXQoKTtcbiAgcHJvdGVjdGVkIHJlc3BvbnNlQ29uZmlnOiBSZXNwb25zZUNvbmZpZztcblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IEFQSUNvbnRyb2xsZXJDb25maWcgPSB7fSkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5yZXNwb25zZUNvbmZpZyA9IG1lcmdlUmVzcG9uc2VDb25maWcoY29uZmlnLnJlc3BvbnNlQ29uZmlnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBjYW4gYmUgdXNlZCB0byBydW4gc29tZSBsb2dpYyBqdXN0IGJlZm9yZSB0aGUgcmVxdWVzdCBpcyBwcm9jZXNzZWQgbGlrZSBjcmVhdGluZyBjbGllbnRzLCBkaS1pbmplY3Rpb24gYW5zIHNvIG9uLlxuICAgKiBAcGFyYW0gX2V2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIF9jb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBjb250cm9sbGVyIGlzIGluaXRpYWxpemVkLlxuICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBOby1vcCBmb3IgQVBJIGNvbnRyb2xsZXJzXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGdldE92ZXJyaWRkZW5IdHRwUmVxdWVzdFZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSk7XG4gIH1cblxuICAvLyBBZGQgbWlkZGxld2FyZSByZWdpc3RyYXRpb24gbWV0aG9kXG4gIHByb3RlY3RlZCB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSB7XG4gICAgdGhpcy5taWRkbGV3YXJlcy5hZGQobWlkZGxld2FyZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0TWlkZGxld2FyZXMoKSB7XG4gICAgcmV0dXJuIFsgLi4uQXJyYXkuZnJvbShnbG9iYWxNaWRkbGV3YXJlcyksIC4uLkFycmF5LmZyb20odGhpcy5taWRkbGV3YXJlcykgXTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGUgbWlkZGxld2FyZSBwaXBlbGluZVxuICBwcml2YXRlIGFzeW5jIGV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoXG4gICAgcGhhc2U6ICdiZWZvcmUnIHwgJ2FmdGVyJyB8ICdvbkVycm9yJyxcbiAgICByZXF1ZXN0OiBSZXF1ZXN0LFxuICAgIHJlc3BvbnNlOiBSZXNwb25zZSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0LFxuICAgIGVycm9yPzogRXJyb3JcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG5cbiAgICBjb25zdCBhbGxNaWRkbGV3YXJlcyA9IHRoaXMuZ2V0TWlkZGxld2FyZXMoKTtcblxuICAgIGZvciAoY29uc3QgbWlkZGxld2FyZSBvZiBhbGxNaWRkbGV3YXJlcykge1xuICAgICAgaWYgKHBoYXNlID09PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZS5vbkVycm9yICYmIGVycm9yKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmUub25FcnJvcihlcnJvciwgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9IGVsc2UgaWYgKHBoYXNlICE9PSAnb25FcnJvcicgJiYgbWlkZGxld2FyZVsgcGhhc2UgXSkge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlWyBwaGFzZSBdIShyZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgfVxuXG4gIGFzeW5jIHZhbGlkYXRlKHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0LCB2YWxpZGF0aW9uczogSW5wdXRWYWxpZGF0aW9uUnVsZSB8IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cbiAgICBsZXQgdmFsaWRhdGlvblJ1bGVzOiBIdHRwUmVxdWVzdFZhbGlkYXRpb25zID0gdmFsaWRhdGlvbnM7XG4gICAgaWYgKGlzSW5wdXRWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9ucykpIHtcbiAgICAgIGlmIChbICdHRVQnLCAnREVMRVRFJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IHF1ZXJ5OiB2YWxpZGF0aW9ucyB9XG5cbiAgICAgIH0gZWxzZSBpZiAoWyAnUE9TVCcsICdQVVQnLCAnUEFUQ0gnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgYm9keTogdmFsaWRhdGlvbnMgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25SdWxlcykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yKHZhbGlkYXRpb25SdWxlcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdG9yLnZhbGlkYXRlSHR0cFJlcXVlc3Qoe1xuICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICB2YWxpZGF0aW9uczogdmFsaWRhdGlvblJ1bGVzLFxuICAgICAgY29sbGVjdEVycm9yczogdHJ1ZSxcbiAgICAgIHZlcmJvc2VFcnJvcnM6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIG92ZXJyaWRkZW5FcnJvck1lc3NhZ2VzOiBhd2FpdCB0aGlzLmdldE92ZXJyaWRkZW5IdHRwUmVxdWVzdFZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKClcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXF1ZXN0Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxSZXF1ZXN0PiB7XG4gICAgcmV0dXJuIG5ldyBSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2VDb250ZXh0KHtcbiAgICAgIHRyYWNlSWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIHJlcXVlc3RJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgZGVidWdNb2RlOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICByb3V0ZTogcmVxdWVzdENvbnRleHQucGF0aCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICdkZXZlbG9wbWVudCcsXG4gICAgICBjb25maWc6IHRoaXMucmVzcG9uc2VDb25maWdcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYW1iZGEgaGFuZGxlciBmb3IgdGhlIGNvbnRyb2xsZXIuXG4gICAqIEhhbmRsZXMgaW5jb21pbmcgQVBJIEdhdGV3YXkgZXZlbnRzLlxuICAgKiBcbiAgICogQWxsIGhhbmRsZXIgZXhlY3V0aW9uIGlzIHdyYXBwZWQgaW4gZXhlY3V0aW9uIGNvbnRleHQsIG1ha2luZ1xuICAgKiBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpIGF2YWlsYWJsZSB0aHJvdWdob3V0IHRoZSByZXF1ZXN0IGxpZmVjeWNsZS5cbiAgICogXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgQVBJIEdhdGV3YXkgcmVzcG9uc2Ugb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcbiAgICB0aGlzLmluaXRpYWxpemVFbnRyeVBhY2thZ2VzQW5kT2JzZXJ2YWJpbGl0eSgpO1xuXG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0KTtcblxuICAgIC8vIEJ1aWxkIHRoZSBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IGN0eCA9IHRoaXMuYnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcblxuICAgIC8vIEZpbmQgdGhlIG1hdGNoaW5nIHJvdXRlIChuZWVkZWQgZm9yIG9ic2VydmFiaWxpdHkgY29uZmlnKVxuICAgIGNvbnN0IHJvdXRlID0gdGhpcy5maW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KTtcblxuICAgIC8vIEdldCBtZXJnZWQgb2JzZXJ2YWJpbGl0eSBjb25maWdcbiAgICBjb25zdCBvYnNlcnZhYmlsaXR5Q29uZmlnID0gdGhpcy5nZXRPYnNlcnZhYmlsaXR5Q29uZmlnKHJvdXRlKTtcbiAgICBjb25zdCBkZWZhdWx0U291cmNlID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke3JvdXRlPy5mdW5jdGlvbk5hbWUgfHwgJ2hhbmRsZXInfWA7XG5cbiAgICAvLyBFeHRyYWN0IHVwc3RyZWFtIHRyYWNlIGNvbnRleHQgZnJvbSBpbmNvbWluZyBoZWFkZXJzLlxuICAgIC8vIElNUE9SVEFOVCAoZnJhbWV3b3JrIGNvbnRyYWN0KTpcbiAgICAvLyAtIGNvcnJlbGF0aW9uSWQgaXMgcGVyLWludm9jYXRpb24gKGxvY2FsIHNsaWNlKVxuICAgIC8vIC0gY2F1c2VkQnkgbGlua3MgdG8gdXBzdHJlYW0gaW52b2NhdGlvbi90cmFjZVxuICAgIGNvbnN0IHRyYWNlQ29udGV4dCA9IGV4dHJhY3RGcm9tSGVhZGVycyhyZXF1ZXN0LmhlYWRlcnMgfHwge30pO1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSByZXF1ZXN0LnJlcXVlc3RJZCB8fCBnZW5lcmF0ZVRyYWNlSWQoKTtcbiAgICBjb25zdCBjYXVzZWRCeSA9IHRyYWNlQ29udGV4dD8uY2F1c2VkQnkgPz8gdHJhY2VDb250ZXh0Py5jb3JyZWxhdGlvbklkO1xuXG4gICAgLy8gQ3JlYXRlIGV4ZWN1dGlvbiBjb250ZXh0IHdpdGggY3VzdG9tIHNvdXJjZSBhbmQgdGFncyBmcm9tIGRlY29yYXRvclxuICAgIGNvbnN0IGV4ZWNDdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICBjYXVzZWRCeSxcbiAgICAgIGFjdG9yOiBjdHguYWN0b3IsXG4gICAgICBzYW1wbGVkOiB0cmFjZUNvbnRleHQ/LnNhbXBsZWQsXG4gICAgICBzb3VyY2U6IG9ic2VydmFiaWxpdHlDb25maWc/LnNvdXJjZSB8fCBkZWZhdWx0U291cmNlLFxuICAgICAgdGFnczogb2JzZXJ2YWJpbGl0eUNvbmZpZz8udGFncyxcbiAgICB9KTtcblxuICAgIC8vIEJ1aWxkIHNwYW4gYXR0cmlidXRlcyAoaW5jbHVkZXMgcmVxdWVzdCBkYXRhIGNhcHR1cmUpXG4gICAgY29uc3Qgc3BhbkF0dHJpYnV0ZXMgPSB0aGlzLmJ1aWxkU3BhbkF0dHJpYnV0ZXMoZXZlbnQsIHJlcXVlc3QsIG9ic2VydmFiaWxpdHlDb25maWcpO1xuXG4gICAgLy8gQnVpbGQgYXV0b21hdGljIHRhZ3MgZm9yIGVhc3kgZmlsdGVyaW5nXG4gICAgY29uc3QgYXV0b21hdGljVGFncyA9IHRoaXMuYnVpbGRBdXRvbWF0aWNUYWdzKHJlcXVlc3QsIGN0eC5hY3RvciwgZXZlbnQpO1xuXG4gICAgLy8gUnVuIGVudGlyZSBoYW5kbGVyIHdpdGhpbiBleGVjdXRpb24gY29udGV4dFxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTZXQgY3R4LmV4ZWN1dGlvbkNvbnRleHQgdG8gcG9pbnQgdG8gdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjdHguZXhlY3V0aW9uQ29udGV4dCA9IGV4ZWNDdHg7XG5cbiAgICAgIC8vIFN5bmMgYWN0b3IuY29ycmVsYXRpb25JZCB3aXRoIHRoZSByZXNvbHZlZCBjb3JyZWxhdGlvbklkXG4gICAgICAvLyBUaGlzIGVuc3VyZXMgYWN0b3Igc3RvcmVkIGluIF9hY3RvciBmaWVsZCBoYXMgdGhlIGNvcnJlY3QgdHJhY2UgSURcbiAgICAgIGlmIChjdHguYWN0b3IpIHtcbiAgICAgICAgY3R4LmFjdG9yLmNvcnJlbGF0aW9uSWQgPSBjb3JyZWxhdGlvbklkO1xuICAgICAgfVxuXG4gICAgICAvLyBVc2UgdGhlIGJhc2UgY2xhc3MgaGVscGVyIGZvciBzcGFuICsgZmx1c2ggcGF0dGVyblxuICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2goXG4gICAgICAgIGBIVFRQICR7cmVxdWVzdC5odHRwTWV0aG9kfSAke3JlcXVlc3QucGF0aH1gLFxuICAgICAgICBhc3luYyAocmVxdWVzdFNwYW4pID0+IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gTGVnYWN5IGluaXRpYWxpemUgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAgICAgICAvLyBUcmFjayByZXF1ZXN0IHBheWxvYWQgc2l6ZVxuICAgICAgICAgICAgaWYgKGV2ZW50LmJvZHkpIHtcbiAgICAgICAgICAgICAgcmVxdWVzdFNwYW4ubWV0cmljKCdodHRwLnJlcXVlc3RfY29udGVudF9sZW5ndGgnLCBCdWZmZXIuYnl0ZUxlbmd0aChldmVudC5ib2R5LCAndXRmOCcpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhlY3V0ZSBiZWZvcmUgbWlkZGxld2FyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlcXVlc3QgaWYgdmFsaWRhdGlvbnMgYXJlIGRlZmluZWRcbiAgICAgICAgICAgIGlmIChyb3V0ZT8udmFsaWRhdGlvbnMpIHtcbiAgICAgICAgICAgICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGUocmVxdWVzdCwgcm91dGUudmFsaWRhdGlvbnMpO1xuICAgICAgICAgICAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuICAgICAgICAgICAgICAgIC8vIEFkZCB2YWxpZGF0aW9uIGZhaWx1cmUgdG8gc3BhbiBmb3IgZGVidWdnaW5nXG4gICAgICAgICAgICAgICAgaWYgKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzICYmIHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgIHJlcXVlc3RTcGFuLmNoZWNrcG9pbnQoJ3ZhbGlkYXRpb24uZmFpbGVkJywge1xuICAgICAgICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24uZmFpbGVkJzogJ3RydWUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgJ3ZhbGlkYXRpb24uZXJyb3JfY291bnQnOiB2YWxpZGF0aW9uUmVzdWx0LmVycm9ycy5sZW5ndGgsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0aW9uRXJyb3JzOiB2YWxpZGF0aW9uUmVzdWx0LmVycm9ycyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgICAgICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXMuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gICAgICAgICAgICBsZXQgY29udHJvbGxlclJlc3BvbnNlOiBhbnkgPSByb3V0ZUZ1bmN0aW9uLmNhbGwodGhpcywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICAgICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgICAgICBjb250cm9sbGVyUmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyUmVzcG9uc2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdhZnRlcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAgICAgICAvLyBJZiB0aGUgY29udHJvbGxlciByZXR1cm5lZCBhbnl0aGluZywgZW1pdCB0aGF0XG4gICAgICAgICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgaWYgKG9ic2VydmFiaWxpdHlDb25maWc/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VBdHRycyA9IHRoaXMuYnVpbGRSZXNwb25zZUF0dHJpYnV0ZXMocmVzcG9uc2UsIG9ic2VydmFiaWxpdHlDb25maWcpO1xuICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZUF0dHJzKSB7XG4gICAgICAgICAgICAgICAgICByZXF1ZXN0U3Bhbi5zZXREYXRhKHJlc3BvbnNlQXR0cnMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAvLyBUYWcgSFRUUCBzdGF0dXMgY29kZSBhbmQgcmVzcG9uc2Ugc2l6ZSBmb3IgZmlsdGVyaW5nXG4gICAgICAgICAgICAgIHRoaXMudGFnUmVzcG9uc2VNZXRyaWNzKHJlcXVlc3RTcGFuLCByZXNwb25zZSk7XG4gICAgICAgICAgICAgIC8vIEZsdXNoIGhhcHBlbnMgYXV0b21hdGljYWxseSBpbiBleGVjdXRlV2l0aFNwYW5BbmRGbHVzaCdzIGZpbmFsbHkgYmxvY2tcbiAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoY29udHJvbGxlclJlc3BvbnNlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRmFsbGJhY2sgdG8gdGhlIGluLW1lbW9yeSByZXNwb25zZUNvbnRleHRcbiAgICAgICAgICAgIGlmIChvYnNlcnZhYmlsaXR5Q29uZmlnPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgICBjb25zdCByZXNwb25zZUF0dHJzID0gdGhpcy5idWlsZFJlc3BvbnNlQXR0cmlidXRlcyhyZXNwb25zZSwgb2JzZXJ2YWJpbGl0eUNvbmZpZyk7XG4gICAgICAgICAgICAgIGlmIChyZXNwb25zZUF0dHJzKSB7XG4gICAgICAgICAgICAgICAgcmVxdWVzdFNwYW4uc2V0RGF0YShyZXNwb25zZUF0dHJzKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gVGFnIEhUVFAgc3RhdHVzIGNvZGUgYW5kIHJlc3BvbnNlIHNpemUgZm9yIGZpbHRlcmluZ1xuICAgICAgICAgICAgdGhpcy50YWdSZXNwb25zZU1ldHJpY3MocmVxdWVzdFNwYW4sIHJlc3BvbnNlKTtcbiAgICAgICAgICAgIC8vIEZsdXNoIGhhcHBlbnMgYXV0b21hdGljYWxseSBpbiBleGVjdXRlV2l0aFNwYW5BbmRGbHVzaCdzIGZpbmFsbHkgYmxvY2tcbiAgICAgICAgICAgIHJldHVybiByZXNwb25zZS5idWlsZCgpO1xuXG4gICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICBjb25zdCBlcnJvck9iaiA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdMYW1iZGFIYW5kbGVyIGVycm9yOiAnLCBlcnJvck9iaik7XG5cbiAgICAgICAgICAgIC8vIEV4ZWN1dGUgZXJyb3IgbWlkZGxld2FyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdvbkVycm9yJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3JPYmopO1xuXG4gICAgICAgICAgICAvLyBUYWcgSFRUUCBzdGF0dXMgY29kZSBhbmQgZXJyb3IgY2F0ZWdvcnkgZm9yIGZpbHRlcmluZ1xuICAgICAgICAgICAgY29uc3QgZXJyb3JTdGF0dXNDb2RlID0gcmVzcG9uc2Uuc3RhdHVzQ29kZSB8fCA1MDA7XG4gICAgICAgICAgICByZXF1ZXN0U3Bhbi50YWcoJ2h0dHAuc3RhdHVzX2NvZGUnLCBTdHJpbmcoZXJyb3JTdGF0dXNDb2RlKSk7XG4gICAgICAgICAgICByZXF1ZXN0U3Bhbi50YWcoJ2h0dHAuc3RhdHVzX2NvZGVfY2xhc3MnLCB0aGlzLmdldFN0YXR1c0NvZGVDbGFzcyhlcnJvclN0YXR1c0NvZGUpKTtcbiAgICAgICAgICAgIHJlcXVlc3RTcGFuLnRhZygnZXJyb3JfY2F0ZWdvcnknLCB0aGlzLmNhdGVnb3JpemVFcnJvcihlcnJvclN0YXR1c0NvZGUsIGVycm9yT2JqKSk7XG5cbiAgICAgICAgICAgIC8vIEZsdXNoIGhhcHBlbnMgYXV0b21hdGljYWxseSBpbiBleGVjdXRlV2l0aFNwYW5BbmRGbHVzaCdzIGZpbmFsbHkgYmxvY2tcbiAgICAgICAgICAgIC8vIE5vdGU6IHdpdGhTcGFuIHdpbGwgY2FsbCBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvciB9KSBhdXRvbWF0aWNhbGx5XG4gICAgICAgICAgICAvLyBXZSBzdGlsbCBuZWVkIHRvIHJldHVybiBhIHJlc3BvbnNlIChlcnJvciBoYW5kbGVyIG1heSBoYXZlIG1vZGlmaWVkIGl0KVxuICAgICAgICAgICAgdGhyb3cgZXJyb3JPYmo7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgICBjYXVzZWRCeTogdHJhY2VDb250ZXh0Py5jYXVzZWRCeSxcbiAgICAgICAgICBhY3RvcjogY3R4LmFjdG9yLFxuICAgICAgICAgIHNvdXJjZTogb2JzZXJ2YWJpbGl0eUNvbmZpZz8uc291cmNlIHx8IGRlZmF1bHRTb3VyY2UsXG4gICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgLi4uYXV0b21hdGljVGFncyxcbiAgICAgICAgICAgIC4uLm9ic2VydmFiaWxpdHlDb25maWc/LnRhZ3MsXG4gICAgICAgICAgICAuLi5zcGFuQXR0cmlidXRlcyxcbiAgICAgICAgICAgICdodHRwLnJvdXRlJzogcm91dGU/LmZ1bmN0aW9uTmFtZSB8fCAnJyxcbiAgICAgICAgICAgICdodHRwLmNvbnRyb2xsZXInOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgY29udGV4dFxuICAgICAgKS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgIC8vIEhhbmRsZSBlcnJvciByZXNwb25zZSBhZnRlciBzcGFuIGVuZHNcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRXhjZXB0aW9uKHJlcXVlc3QsIGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKSwgcmVzcG9uc2UpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBtZXJnZWQgb2JzZXJ2YWJpbGl0eSBjb25maWcgZnJvbSBjb250cm9sbGVyIGFuZCBtZXRob2QgbGV2ZWxcbiAgICovXG4gIHByb3RlY3RlZCBnZXRPYnNlcnZhYmlsaXR5Q29uZmlnKHJvdXRlPzogUm91dGUgfCBudWxsKTogQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWcgPSB0aGlzLmdldENvbnRyb2xsZXJDb25maWcoKTtcbiAgICByZXR1cm4gbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyhjb250cm9sbGVyQ29uZmlnPy5vYnNlcnZhYmlsaXR5LCByb3V0ZT8ub2JzZXJ2YWJpbGl0eSk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgYXV0b21hdGljIHRhZ3MgZm9yIEhUVFAgcmVxdWVzdHMuXG4gICAqIFRoZXNlIHRhZ3MgZW5hYmxlIHBvd2VyZnVsIGZpbHRlcmluZyBpbiBvYnNlcnZhYmlsaXR5IFVJcy5cbiAgICovXG4gIHByb3RlY3RlZCBidWlsZEF1dG9tYXRpY1RhZ3MoXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICBhY3RvcjogQWN0b3IgfCB1bmRlZmluZWQsXG4gICAgZXZlbnQ6IEFQSUdhdGV3YXlFdmVudFxuICApOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBjb25zdCB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cbiAgICAvLyBIVFRQIG1ldGhvZCBjYXRlZ29yeSAoc2ltaWxhciB0byBzZXJ2aWNlIG9wZXJhdGlvbnMpXG4gICAgY29uc3QgbWV0aG9kID0gcmVxdWVzdC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCk7XG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgfHwgbWV0aG9kID09PSAnSEVBRCcpIHtcbiAgICAgIHRhZ3Mub3BlcmF0aW9uX2NhdGVnb3J5ID0gJ3JlYWQnO1xuICAgIH0gZWxzZSBpZiAobWV0aG9kID09PSAnUE9TVCcgfHwgbWV0aG9kID09PSAnUFVUJyB8fCBtZXRob2QgPT09ICdQQVRDSCcpIHtcbiAgICAgIHRhZ3Mub3BlcmF0aW9uX2NhdGVnb3J5ID0gJ3dyaXRlJztcbiAgICB9IGVsc2UgaWYgKG1ldGhvZCA9PT0gJ0RFTEVURScpIHtcbiAgICAgIHRhZ3Mub3BlcmF0aW9uX2NhdGVnb3J5ID0gJ2RlbGV0ZSc7XG4gICAgfVxuXG4gICAgLy8gQXV0aCBtZXRob2QgZm9yIGVhc3kgZmlsdGVyaW5nIGJ5IGF1dGhlbnRpY2F0aW9uIHR5cGVcbiAgICBpZiAoYWN0b3I/LmF1dGhNZXRob2QpIHtcbiAgICAgIHRhZ3MuYXV0aF9tZXRob2QgPSBhY3Rvci5hdXRoTWV0aG9kO1xuICAgIH1cblxuICAgIC8vIEFjdG9yIHR5cGUgKHVzZXIgdnMgc2VydmljZSlcbiAgICBpZiAoYWN0b3I/LmFjdG9yVHlwZSkge1xuICAgICAgdGFncy5hY3Rvcl90eXBlID0gYWN0b3IuYWN0b3JUeXBlO1xuICAgIH1cblxuICAgIC8vIEFQSSBzdGFnZSAoZGV2LCBzdGFnaW5nLCBwcm9kKVxuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uc3RhZ2UpIHtcbiAgICAgIHRhZ3Muc3RhZ2UgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5zdGFnZTtcbiAgICB9XG5cbiAgICAvLyBUZW5hbnQgY29udGV4dCAoZm9yIG11bHRpLXRlbmFudCBmaWx0ZXJpbmcpXG4gICAgaWYgKGFjdG9yPy50ZW5hbnRJZCkge1xuICAgICAgdGFncy50ZW5hbnRfaWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICB9XG5cbiAgICByZXR1cm4gdGFncztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCBzcGFuIGF0dHJpYnV0ZXMgYmFzZWQgb24gb2JzZXJ2YWJpbGl0eSBjb25maWcuXG4gICAqIEFsd2F5cyBpbmNsdWRlcyBiYXNpYyBIVFRQIGluZm8uIFJlcXVlc3QgYm9keS9oZWFkZXJzL3F1ZXJ5IGFyZSBvbmx5XG4gICAqIGluY2x1ZGVkIGlmIGV4cGxpY2l0bHkgY29uZmlndXJlZCB2aWEgYGluY2x1ZGVzYC5cbiAgICovXG4gIHByb3RlY3RlZCBidWlsZFNwYW5BdHRyaWJ1dGVzKFxuICAgIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICBjb25maWc/OiBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZ1xuICApOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gICAgLy8gQWx3YXlzIGluY2x1ZGUgYmFzaWMgSFRUUCBhdHRyaWJ1dGVzXG4gICAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgJ2h0dHAubWV0aG9kJzogcmVxdWVzdC5odHRwTWV0aG9kLFxuICAgICAgJ2h0dHAucGF0aCc6IHJlcXVlc3QucGF0aCxcbiAgICAgICdodHRwLnJlcXVlc3RJZCc6IHJlcXVlc3QucmVxdWVzdElkLFxuICAgICAgJ2h0dHAudXNlckFnZW50JzogZXZlbnQuaGVhZGVycz8uWyAndXNlci1hZ2VudCcgXSB8fCBldmVudC5oZWFkZXJzPy5bICdVc2VyLUFnZW50JyBdLFxuICAgICAgJ2h0dHAuc291cmNlSXAnOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwLFxuICAgIH07XG5cbiAgICAvLyBJZiBkaXNhYmxlZCBvciBubyBpbmNsdWRlcyBjb25maWcsIHJldHVybiBiYXNpYyBhdHRycyBvbmx5XG4gICAgaWYgKGNvbmZpZz8uZW5hYmxlZCA9PT0gZmFsc2UgfHwgIWNvbmZpZz8uaW5jbHVkZXMpIHtcbiAgICAgIHJldHVybiBhdHRycztcbiAgICB9XG5cbiAgICAvLyBCdWlsZCByZXF1ZXN0IGRhdGEgYmFzZWQgb24gaW5jbHVkZXMgY29uZmlnXG4gICAgY29uc3QgaW5jbHVkZXMgPSBub3JtYWxpemVJbmNsdWRlcyhjb25maWcuaW5jbHVkZXMpO1xuICAgIGNvbnN0IHJlcXVlc3REYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuXG4gICAgaWYgKGluY2x1ZGVzLnJlcXVlc3QuaGVhZGVycykge1xuICAgICAgY29uc3QgaGVhZGVyRGF0YSA9IHNlbGVjdEZpZWxkcyhyZXF1ZXN0LmhlYWRlcnMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGluY2x1ZGVzLnJlcXVlc3QuaGVhZGVycyk7XG4gICAgICBpZiAoaGVhZGVyRGF0YSkgcmVxdWVzdERhdGEuaGVhZGVycyA9IGhlYWRlckRhdGE7XG4gICAgfVxuXG4gICAgaWYgKGluY2x1ZGVzLnJlcXVlc3QuYm9keSAmJiByZXF1ZXN0LmJvZHkpIHtcbiAgICAgIGNvbnN0IGJvZHlEYXRhID0gdHlwZW9mIHJlcXVlc3QuYm9keSA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBzZWxlY3RGaWVsZHNGcm9tQm9keShyZXF1ZXN0LmJvZHksIGluY2x1ZGVzLnJlcXVlc3QuYm9keSlcbiAgICAgICAgOiBzZWxlY3RGaWVsZHMocmVxdWVzdC5ib2R5IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpbmNsdWRlcy5yZXF1ZXN0LmJvZHkpO1xuICAgICAgaWYgKGJvZHlEYXRhKSByZXF1ZXN0RGF0YS5ib2R5ID0gYm9keURhdGE7XG4gICAgfVxuXG4gICAgaWYgKGluY2x1ZGVzLnJlcXVlc3QucXVlcnkgJiYgcmVxdWVzdC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMpIHtcbiAgICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IHNlbGVjdEZpZWxkcyhyZXF1ZXN0LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaW5jbHVkZXMucmVxdWVzdC5xdWVyeSk7XG4gICAgICBpZiAocXVlcnlEYXRhKSByZXF1ZXN0RGF0YS5xdWVyeSA9IHF1ZXJ5RGF0YTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBkYXRhIHByb3RlY3Rpb24gYW5kIGFkZCB0byBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlcXVlc3REYXRhKS5sZW5ndGggPiAwKSB7XG4gICAgICBhdHRyc1sgJ3JlcXVlc3QnIF0gPSBjb25maWcuZGF0YVByb3RlY3Rpb24/LmVuYWJsZWQgIT09IGZhbHNlXG4gICAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShyZXF1ZXN0RGF0YSwgY29uZmlnLmRhdGFQcm90ZWN0aW9uKVxuICAgICAgICA6IHJlcXVlc3REYXRhO1xuICAgIH1cblxuICAgIHJldHVybiBhdHRycztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCByZXNwb25zZSBhdHRyaWJ1dGVzIGJhc2VkIG9uIG9ic2VydmFiaWxpdHkgY29uZmlnLlxuICAgKiBPbmx5IGNhcHR1cmVzIHJlc3BvbnNlIGJvZHkvaGVhZGVycyBpZiBleHBsaWNpdGx5IGNvbmZpZ3VyZWQgdmlhIGBpbmNsdWRlc2AuXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRSZXNwb25zZUF0dHJpYnV0ZXMoXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGNvbmZpZz86IENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnXG4gICk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkIHtcbiAgICAvLyBBbHdheXMgaW5jbHVkZSBzdGF0dXMgY29kZVxuICAgIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgICdodHRwLnN0YXR1c0NvZGUnOiByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgIH07XG5cbiAgICAvLyBJZiBkaXNhYmxlZCBvciBubyBpbmNsdWRlcyBjb25maWcsIHJldHVybiBqdXN0IHN0YXR1cyBjb2RlXG4gICAgaWYgKGNvbmZpZz8uZW5hYmxlZCA9PT0gZmFsc2UgfHwgIWNvbmZpZz8uaW5jbHVkZXMpIHtcbiAgICAgIHJldHVybiBhdHRycztcbiAgICB9XG5cbiAgICBjb25zdCBpbmNsdWRlcyA9IG5vcm1hbGl6ZUluY2x1ZGVzKGNvbmZpZy5pbmNsdWRlcyk7XG4gICAgY29uc3QgcmVzcG9uc2VEYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuXG4gICAgaWYgKGluY2x1ZGVzLnJlc3BvbnNlLmhlYWRlcnMgJiYgcmVzcG9uc2UuaGVhZGVycykge1xuICAgICAgY29uc3QgaGVhZGVyRGF0YSA9IHNlbGVjdEZpZWxkcyhyZXNwb25zZS5oZWFkZXJzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpbmNsdWRlcy5yZXNwb25zZS5oZWFkZXJzKTtcbiAgICAgIGlmIChoZWFkZXJEYXRhKSByZXNwb25zZURhdGEuaGVhZGVycyA9IGhlYWRlckRhdGE7XG4gICAgfVxuXG4gICAgaWYgKGluY2x1ZGVzLnJlc3BvbnNlLmJvZHkgJiYgcmVzcG9uc2UuYm9keSkge1xuICAgICAgY29uc3QgYm9keURhdGEgPSBzZWxlY3RGaWVsZHNGcm9tQm9keShyZXNwb25zZS5ib2R5LCBpbmNsdWRlcy5yZXNwb25zZS5ib2R5KTtcbiAgICAgIGlmIChib2R5RGF0YSkgcmVzcG9uc2VEYXRhLmJvZHkgPSBib2R5RGF0YTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBkYXRhIHByb3RlY3Rpb24gYW5kIGFkZCB0byBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlc3BvbnNlRGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgYXR0cnNbICdyZXNwb25zZScgXSA9IGNvbmZpZy5kYXRhUHJvdGVjdGlvbj8uZW5hYmxlZCAhPT0gZmFsc2VcbiAgICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKHJlc3BvbnNlRGF0YSwgY29uZmlnLmRhdGFQcm90ZWN0aW9uKVxuICAgICAgICA6IHJlc3BvbnNlRGF0YTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cnM7XG4gIH1cblxuICAvKipcbiAgICogVGFnIHRoZSBzcGFuIHdpdGggSFRUUCBzdGF0dXMgY29kZSwgc3RhdHVzIGNvZGUgY2xhc3MsIHJlc3BvbnNlIHNpemUsXG4gICAqIGFuZCBlcnJvciBjYXRlZ29yeSAoZm9yIDR4eC81eHggcmVzcG9uc2VzKS5cbiAgICovXG4gIHByb3RlY3RlZCB0YWdSZXNwb25zZU1ldHJpY3Moc3BhbjogU3Bhbk9ic2VydmVyLCByZXNwb25zZTogUmVzcG9uc2UpOiB2b2lkIHtcbiAgICBjb25zdCBzdGF0dXNDb2RlID0gcmVzcG9uc2Uuc3RhdHVzQ29kZSA/PyAyMDA7XG4gICAgc3Bhbi50YWcoJ2h0dHAuc3RhdHVzX2NvZGUnLCBTdHJpbmcoc3RhdHVzQ29kZSkpO1xuICAgIHNwYW4udGFnKCdodHRwLnN0YXR1c19jb2RlX2NsYXNzJywgdGhpcy5nZXRTdGF0dXNDb2RlQ2xhc3Moc3RhdHVzQ29kZSkpO1xuXG4gICAgaWYgKHJlc3BvbnNlLmJvZHkpIHtcbiAgICAgIHNwYW4ubWV0cmljKCdodHRwLnJlc3BvbnNlX2NvbnRlbnRfbGVuZ3RoJywgQnVmZmVyLmJ5dGVMZW5ndGgocmVzcG9uc2UuYm9keSwgJ3V0ZjgnKSk7XG4gICAgfVxuXG4gICAgLy8gRXJyb3IgY2F0ZWdvcml6YXRpb24gZm9yIG5vbi1zdWNjZXNzIHJlc3BvbnNlc1xuICAgIGlmIChzdGF0dXNDb2RlID49IDQwMCkge1xuICAgICAgc3Bhbi50YWcoJ2Vycm9yX2NhdGVnb3J5JywgdGhpcy5jYXRlZ29yaXplRXJyb3Ioc3RhdHVzQ29kZSkpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzc2lmeSBIVFRQIHN0YXR1cyBjb2RlIGludG8gYSBjbGFzcyBzdHJpbmcgZm9yIER5bmFtb0RCLXNhZmUgZmlsdGVyaW5nLlxuICAgKi9cbiAgcHJvdGVjdGVkIGdldFN0YXR1c0NvZGVDbGFzcyhzdGF0dXNDb2RlOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIGlmIChzdGF0dXNDb2RlIDwgMjAwKSByZXR1cm4gJzF4eCc7XG4gICAgaWYgKHN0YXR1c0NvZGUgPCAzMDApIHJldHVybiAnMnh4JztcbiAgICBpZiAoc3RhdHVzQ29kZSA8IDQwMCkgcmV0dXJuICczeHgnO1xuICAgIGlmIChzdGF0dXNDb2RlIDwgNTAwKSByZXR1cm4gJzR4eCc7XG4gICAgcmV0dXJuICc1eHgnO1xuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzaWZ5IGFuIGVycm9yIGludG8gYSBicm9hZCBjYXRlZ29yeSBmb3IgZmlsdGVyaW5nIGFuZCB0cmlhZ2UuXG4gICAqIENhdGVnb3JpZXM6IGF1dGgsIHZhbGlkYXRpb24sIGluZnJhc3RydWN0dXJlLCBzZXJ2ZXIsIGFwcGxpY2F0aW9uLlxuICAgKi9cbiAgcHJvdGVjdGVkIGNhdGVnb3JpemVFcnJvcihzdGF0dXNDb2RlOiBudW1iZXIsIGVycm9yPzogRXJyb3IpOiBzdHJpbmcge1xuICAgIGlmIChzdGF0dXNDb2RlID09PSA0MDEgfHwgc3RhdHVzQ29kZSA9PT0gNDAzKSByZXR1cm4gJ2F1dGgnO1xuICAgIGlmIChzdGF0dXNDb2RlID09PSA0MjkpIHJldHVybiAndGhyb3R0bGUnO1xuICAgIGlmIChzdGF0dXNDb2RlID49IDQwMCAmJiBzdGF0dXNDb2RlIDwgNTAwKSByZXR1cm4gJ3ZhbGlkYXRpb24nO1xuICAgIGlmIChlcnJvcj8ubWVzc2FnZT8ubWF0Y2goL3RpbWVvdXR8RVRJTUVET1VUfEVDT05OUkVGVVNFRHxFQ09OTlJFU0VUfEVOT1RGT1VORHxzb2NrZXQgaGFuZyB1cC9pKSkge1xuICAgICAgcmV0dXJuICdpbmZyYXN0cnVjdHVyZSc7XG4gICAgfVxuICAgIGlmIChzdGF0dXNDb2RlID49IDUwMCkgcmV0dXJuICdzZXJ2ZXInO1xuICAgIHJldHVybiAnYXBwbGljYXRpb24nO1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSByb3V0ZSB0aGF0IG1hdGNoZXMgdGhlIEhUVFAgbWV0aG9kIGFuZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHJlcXVlc3REYXRhIC0gVGhlIHJlcXVlc3QgZGF0YSBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSBtYXRjaGluZyByb3V0ZSBvciBudWxsIGlmIG5vdCBmb3VuZC5cbiAgICovXG4gIHByaXZhdGUgZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdERhdGE6IFJlcXVlc3QpOiBSb3V0ZSB8IG51bGwge1xuICAgIGxldCBjb250cm9sbGVyOiBhbnkgPSB0aGlzO1xuXG4gICAgLy8gRGV0ZXJtaW5lIHRoZSBjb250cm9sbGVyIGJhc2UgcGF0aCBieSBmaW5kaW5nIHRoZSBsb25nZXN0IGNvbW1vbiBwcmVmaXggdGhhdCBlbmRzIHdpdGggdGhlIGNvbnRyb2xsZXIgbmFtZVxuICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gdHlwZW9mIGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUgPT09ICdzdHJpbmcnID8gY29udHJvbGxlci5jb250cm9sbGVyTmFtZSA6ICcnO1xuICAgIGxldCBjb250cm9sbGVyQmFzZVBhdGggPSBjb250cm9sbGVyTmFtZSA/IGAvJHtjb250cm9sbGVyTmFtZX1gIDogJyc7XG4gICAgbGV0IHJlc291cmNlV2l0aG91dFJvb3QgPSAnLyc7XG5cbiAgICAvLyBGb3IgY29udHJvbGxlcnMgaW4gc3ViZGlyZWN0b3JpZXMsIHdlIG5lZWQgdG8gbWF0Y2ggdGhlIGFjdHVhbCByZXNvdXJjZSBwYXRoXG4gICAgLy8gQ2hlY2sgaWYgcmVzb3VyY2UgY29udGFpbnMgdGhlIGNvbnRyb2xsZXIgbmFtZSBhcyBwYXJ0IG9mIGEgbG9uZ2VyIHBhdGhcbiAgICBjb25zdCByZXF1ZXN0UmVzb3VyY2UgPSAocmVxdWVzdERhdGEucmVzb3VyY2UgfHwgcmVxdWVzdERhdGEucGF0aCB8fCAnLycpIGFzIHN0cmluZztcbiAgICBjb25zdCByZXNvdXJjZVBhcnRzID0gcmVxdWVzdFJlc291cmNlLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lUGFydHMgPSBjb250cm9sbGVyTmFtZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcblxuICAgIC8vIEZpbmQgaWYgdGhlIGNvbnRyb2xsZXIgbmFtZSBwYXJ0cyBhcmUgcHJlc2VudCBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgIGxldCBiYXNlUGF0aEVuZEluZGV4ID0gLTE7XG4gICAgaWYgKGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gTG9vayBmb3IgdGhlIGNvbnRyb2xsZXIgbmFtZSBzZXF1ZW5jZSBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gcmVzb3VyY2VQYXJ0cy5sZW5ndGggLSBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxldCBtYXRjaGVzID0gdHJ1ZTtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgaWYgKHJlc291cmNlUGFydHNbIGkgKyBqIF0gIT09IGNvbnRyb2xsZXJOYW1lUGFydHNbIGogXSkge1xuICAgICAgICAgICAgbWF0Y2hlcyA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgYmFzZVBhdGhFbmRJbmRleCA9IGkgKyBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmFzZVBhdGhFbmRJbmRleCA+PSAwKSB7XG4gICAgICAvLyBGb3VuZCB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggaW4gdGhlIHJlc291cmNlXG4gICAgICBjb25zdCBiYXNlUGF0aFBhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZSgwLCBiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICBjb250cm9sbGVyQmFzZVBhdGggPSAnLycgKyBiYXNlUGF0aFBhcnRzLmpvaW4oJy8nKTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ1BhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZShiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVtYWluaW5nUGFydHMubGVuZ3RoID4gMCA/ICcvJyArIHJlbWFpbmluZ1BhcnRzLmpvaW4oJy8nKSA6ICcvJztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmFsbGJhY2sgdG8gb3JpZ2luYWwgbG9naWMgZm9yIHNpbXBsZSBjYXNlc1xuICAgICAgaWYgKGNvbnRyb2xsZXJCYXNlUGF0aCAmJiByZXF1ZXN0UmVzb3VyY2Uuc3RhcnRzV2l0aChjb250cm9sbGVyQmFzZVBhdGgpKSB7XG4gICAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZXF1ZXN0UmVzb3VyY2Uuc3Vic3RyaW5nKGNvbnRyb2xsZXJCYXNlUGF0aC5sZW5ndGgpIHx8ICcvJztcbiAgICAgIH0gZWxzZSBpZiAoIWNvbnRyb2xsZXJCYXNlUGF0aCkge1xuICAgICAgICAvLyBObyBjb250cm9sbGVyTmFtZSBjb25maWd1cmVkOiB0cmVhdCB0aGUgZnVsbCByZXNvdXJjZSBhcyB0aGUgcm91dGUgcGF0aC5cbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3RSZXNvdXJjZSB8fCAnLyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2VwYXJhdGUgcm91dGVzIGludG8gZXhhY3QgYW5kIHBhcmFtZXRlcml6ZWQgZm9yIHByb3BlciBwcmlvcml0aXphdGlvblxuICAgIGNvbnN0IGV4YWN0TWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcbiAgICBjb25zdCBwYXJhbWV0ZXJpemVkTWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcblxuICAgIC8vIEZpcnN0IHBhc3M6IGNhdGVnb3JpemUgcm91dGVzIGJ5IHR5cGUgYW5kIG1ldGhvZFxuICAgIGZvciAoY29uc3QgWyByb3V0ZUtleSwgcm91dGUgXSBvZiBPYmplY3QuZW50cmllcyhjb250cm9sbGVyLnJvdXRlcyB8fCB7fSkgYXMgWyBzdHJpbmcsIFJvdXRlIF1bXSkge1xuICAgICAgY29uc3QgWyByb3V0ZU1ldGhvZCwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICAvLyBTa2lwIGlmIEhUVFAgbWV0aG9kIGRvZXNuJ3QgbWF0Y2hcbiAgICAgIGlmIChyb3V0ZU1ldGhvZCAhPT0gcmVxdWVzdERhdGEuaHR0cE1ldGhvZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2F0ZWdvcml6ZSByb3V0ZSB0eXBlXG4gICAgICBpZiAocm91dGVQYXRoLmluY2x1ZGVzKCd7JykgJiYgcm91dGVQYXRoLmluY2x1ZGVzKCd9JykpIHtcbiAgICAgICAgcGFyYW1ldGVyaXplZE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4YWN0TWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlY29uZCBwYXNzOiBUcnkgZXhhY3QgbWF0Y2hlcyBmaXJzdCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlIH0gb2YgZXhhY3RNYXRjaGVzKSB7XG4gICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICBpZiAocm91dGVQYXRoID09PSByZXNvdXJjZVdpdGhvdXRSb290KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3VuZCBleGFjdCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCk7XG4gICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUaGlyZCBwYXNzOiBUcnkgcGFyYW1ldGVyaXplZCBtYXRjaGVzIChzb3J0ZWQgYnkgc3BlY2lmaWNpdHkpXG4gICAgLy8gU29ydCBwYXJhbWV0ZXJpemVkIHJvdXRlcyBieSBzcGVjaWZpY2l0eSAobW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHByaW9yaXR5KVxuICAgIGNvbnN0IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzID0gcGFyYW1ldGVyaXplZE1hdGNoZXNcbiAgICAgIC5tYXAoKHsgcm91dGVLZXksIHJvdXRlIH0pID0+IHtcbiAgICAgICAgY29uc3QgWyAsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcbiAgICAgICAgY29uc3Qgc2VnbWVudHMgPSByb3V0ZVBhdGguc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgIGNvbnN0IGxpdGVyYWxTZWdtZW50cyA9IHNlZ21lbnRzLmZpbHRlcihzZWdtZW50ID0+ICFzZWdtZW50LmluY2x1ZGVzKCd7JykpO1xuXG4gICAgICAgIC8vIFNwZWNpZmljaXR5IHNjb3JlOiBtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmVcbiAgICAgICAgLy8gRm9yIGVxdWFsIGxpdGVyYWwgc2VnbWVudHMsIGZld2VyIHRvdGFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlICBcbiAgICAgICAgY29uc3Qgc3BlY2lmaWNpdHlTY29yZSA9IChsaXRlcmFsU2VnbWVudHMubGVuZ3RoICogMTAwMCkgLSBzZWdtZW50cy5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGgsIHNwZWNpZmljaXR5U2NvcmUgfTtcbiAgICAgIH0pXG4gICAgICAuc29ydCgoYSwgYikgPT4gYi5zcGVjaWZpY2l0eVNjb3JlIC0gYS5zcGVjaWZpY2l0eVNjb3JlKTsgLy8gSGlnaGVyIHNjb3JlIGZpcnN0XG5cbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGggfSBvZiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcykge1xuICAgICAgLy8gQ29udmVydCBmcmFtZXdvcmsge2lkfSBzeW50YXggdG8gcGF0aC10by1yZWdleHAgOmlkIHN5bnRheFxuICAgICAgY29uc3QgcGF0aFRvUmVnZXhwUGF0dGVybiA9IHJvdXRlUGF0aC5yZXBsYWNlKC9cXHsoW159XSspXFx9L2csICc6JDEnKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gVXNlIHBhdGgtdG8tcmVnZXhwIGZvciBwcm9wZXIgcGFyYW1ldGVyIG1hdGNoaW5nXG4gICAgICAgIGNvbnN0IHsgbWF0Y2ggfSA9IHJlcXVpcmUoJ3BhdGgtdG8tcmVnZXhwJyk7XG4gICAgICAgIGNvbnN0IG1hdGNoZXIgPSBtYXRjaChwYXRoVG9SZWdleHBQYXR0ZXJuLCB7IGRlY29kZTogZGVjb2RlVVJJQ29tcG9uZW50IH0pO1xuICAgICAgICBjb25zdCBtYXRjaFJlc3VsdCA9IG1hdGNoZXIocmVzb3VyY2VXaXRob3V0Um9vdCk7XG5cbiAgICAgICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIHBhcmFtZXRlcml6ZWQgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWAsIHtcbiAgICAgICAgICAgIHBhdHRlcm46IHBhdGhUb1JlZ2V4cFBhdHRlcm4sXG4gICAgICAgICAgICBwYXJhbXM6IG1hdGNoUmVzdWx0LnBhcmFtcyxcbiAgICAgICAgICAgIHNwZWNpZmljaXR5U2NvcmU6IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzLmZpbmQobSA9PiBtLnJvdXRlS2V5ID09PSByb3V0ZUtleSk/LnNwZWNpZmljaXR5U2NvcmVcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIE5vdGU6IFdlIGRvbid0IG5lZWQgdG8gbWFudWFsbHkgZXh0cmFjdCBwYXJhbWV0ZXJzIHNpbmNlIEFQSSBHYXRld2F5XG4gICAgICAgICAgLy8gYWxyZWFkeSBwcm92aWRlcyB0aGVtIGluIHJlcXVlc3REYXRhLnBhdGhQYXJhbWV0ZXJzXG4gICAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFcnJvciBtYXRjaGluZyByb3V0ZSBwYXR0ZXJuICR7cGF0aFRvUmVnZXhwUGF0dGVybn06YCwgZXJyb3IpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBtYXRjaGluZyByb3V0ZSBmb3VuZCBmb3IgJHtyZXF1ZXN0RGF0YS5odHRwTWV0aG9kfXwke3Jlc291cmNlV2l0aG91dFJvb3R9YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKiBAcGFyYW0gcm91dGUgLSBUaGUgbWF0Y2hlZCByb3V0ZS5cbiAgICogQHJldHVybnMgVGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqL1xuICBwcml2YXRlIGdldFJvdXRlRnVuY3Rpb24ocm91dGU6IFJvdXRlIHwgbnVsbCk6IEZ1bmN0aW9uIHtcbiAgICBpZiAoIXJvdXRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICAgIH1cblxuICAgIC8vQHRzLWlnbm9yZVxuICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzWyByb3V0ZS5mdW5jdGlvbk5hbWUgXTtcblxuICAgIHJldHVybiB0eXBlb2Ygcm91dGVGdW5jdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gcm91dGVGdW5jdGlvbiA6IHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIHRoZSBOb3RGb3VuZCByb3V0ZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDQwNCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVOb3RGb3VuZChfcmVxOiBSZXF1ZXN0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZSh7XG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiTm8gUm91dGUgRm91bmQhXCIgfSksXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZXJyb3JIYW5kbGVyPzogQ29udHJvbGxlckVycm9ySGFuZGxlcjtcbiAgcHJvdGVjdGVkIGdldEVycm9ySGFuZGxlcigpOiBDb250cm9sbGVyRXJyb3JIYW5kbGVyIHtcbiAgICBpZiAoIXRoaXMuZXJyb3JIYW5kbGVyKSB7XG4gICAgICB0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcigpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5lcnJvckhhbmRsZXI7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBleGNlcHRpb25zIGFuZCByZXR1cm5zIGEgSlNPTiByZXNwb25zZSB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHBhcmFtIGVyciAtIFRoZSBlcnJvciBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDUwMCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVFeGNlcHRpb24ocmVxOiBSZXF1ZXN0LCBlcnI6IEVycm9yLCByZXM6IFJlc3BvbnNlKTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlID0gdGhpcy5nZXRFcnJvckhhbmRsZXIoKShlcnIsIHJlcSwgcmVzKTtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShlcnJvclJlc3BvbnNlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBoYW5kbGVSZXNwb25zZShyZXM6IFJlc3BvbnNlIHwgQVBJR2F0ZXdheVByb3h5UmVzdWx0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBpZiAocmVzIGluc3RhbmNlb2YgUmVzcG9uc2VDb250ZXh0KSB7XG4gICAgICByZXR1cm4gcmVzLmJ1aWxkKCk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGVjdXRpb24gY29udGV4dCBmb3IgdGhlIHJlcXVlc3RcbiAgICogXG4gICAqIGRpZmZlcmVudCBtaWRkbGV3YXJlIGNhbiBlbmhhbmNlIHRoZSBhY3RvciBjb250ZXh0IGJ5IHVzaW5nIHRoZSBlbmhhbmNlQWN0b3IgbWV0aG9kXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlID0ge1xuICAgKiAgYmVmb3JlOiBhc3luYyAoX3JlcXVlc3QsIF9yZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgY3R4Py5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICByb2xlczogWydhZG1pbicsICd1c2VyJ10sXG4gICAqICAgICBwZXJtaXNzaW9uczogWydyZWFkJywgJ3dyaXRlJ10sXG4gICAqICAgICBzdWJzY3JpcHRpb246IHsgdGllcjogJ2VudGVycHJpc2UnIH1cbiAgICogICB9KTtcbiAgICogIH1cbiAgICogfVxuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmUpO1xuICAgKiBcbiAgICogT1JcbiAgICogXG4gICAqIGNvbnN0IHNlY3VyaXR5TWlkZGxld2FyZSA9IHtcbiAgICogICBiZWZvcmU6IGFzeW5jIChyZXF1ZXN0LCByZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgICBjdHguZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgICByaXNrUHJvZmlsZTogYXdhaXQgYXNzZXNzUmlzayhjdHguYWN0b3IuYWN0b3JJZCksXG4gICAqICAgICAgIGRldmljZTogYXdhaXQgbWFrZURldmljZUNvbnRleHQocmVxdWVzdClcbiAgICogICAgIH0pO1xuICAgKiAgIH1cbiAgICogfTtcbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShzZWN1cml0eU1pZGRsZXdhcmUpO1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgXG4gICAqIEBwYXJhbSBjb250ZXh0IFxuICAgKiBAcGFyYW0gcmVxdWVzdCBcbiAgICogQHBhcmFtIHJlc3BvbnNlIFxuICAgKiBAcmV0dXJucyBcbiAgICovXG4gIHByb3RlY3RlZCBidWlsZEN0eChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgICBjb25zdCBhY3RvciA9IHRoaXMuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICBjb25zdCBjdHg6IEV4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICBldmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBhY3RvcixcbiAgICAgIGRlYnVnSW5mbzoge30sXG5cbiAgICAgIC8vIFNpbXBsZSBhY3RvciBlbmhhbmNlbWVudCBtZXRob2RcbiAgICAgIGVuaGFuY2VBY3RvcjogKGVuaGFuY2VtZW50OiBQYXJ0aWFsPEFjdG9yPikgPT4ge1xuICAgICAgICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIGVuaGFuY2VtZW50KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gY3R4O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGNvbnRyb2xsZXIgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIGdldENvbnRyb2xsZXJDb25maWcoKTogSUNvbnRyb2xsZXJDb25maWcge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAnY29udHJvbGxlckNvbmZpZycpIHx8IHt9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzIGFjdG9yIGNvbnRleHQgZnJvbSB0aGUgcmVxdWVzdC5cbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgZm9yIGN1c3RvbSBhY3RvciBleHRyYWN0aW9uIGxvZ2ljLlxuICAgKiBcbiAgICogTm90ZTogY29ycmVsYXRpb25JZCBpcyBOT1Qgc2V0IGhlcmUgLSBpdCdzIGRldGVybWluZWQgZnJvbSB0cmFjZSBjb250ZXh0XG4gICAqIGV4dHJhY3Rpb24gYW5kIHNldCBvbiB0aGUgRXhlY3V0aW9uQ29udGV4dC4gVGhlIGFjdG9yLmNvcnJlbGF0aW9uSWQgaXNcbiAgICogc3luY2VkIGxhdGVyIGluIExhbWJkYUhhbmRsZXIgYWZ0ZXIgdHJhY2UgY29udGV4dCBpcyByZXNvbHZlZC5cbiAgICpcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIHJlcXVlc3QgLSBUaGUgcmVxdWVzdCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIFRoZSBhY3RvciBjb250ZXh0LlxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCk6IEFjdG9yIHtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVxdWVzdC5yZXF1ZXN0SWQ7XG5cbiAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICByZXF1ZXN0SWQsXG4gICAgICB0aW1lc3RhbXAsXG4gICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVycz8uWyAndXNlci1hZ2VudCcgXSB8fCBldmVudC5oZWFkZXJzPy5bICdVc2VyLUFnZW50JyBdLFxuICAgICAgLy8gTm90ZTogY29ycmVsYXRpb25JZCBpcyBzZXQgbGF0ZXIgYWZ0ZXIgdHJhY2UgY29udGV4dCBleHRyYWN0aW9uXG4gICAgfTtcblxuICAgIC8vIENvZ25pdG8gYXV0aGVudGljYXRpb24gd2l0aCBmb2N1c2VkIGVuaGFuY2VtZW50c1xuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zKSB7XG4gICAgICB0aGlzLmV4dHJhY3RDb2duaXRvQ29udGV4dChldmVudC5yZXF1ZXN0Q29udGV4dC5hdXRob3JpemVyLmNsYWltcywgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBUEkgS2V5IGF1dGhlbnRpY2F0aW9uXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkgfHwgcmVxdWVzdC5oZWFkZXJzPy5bICd4LWFwaS1rZXknIF0pIHtcbiAgICAgIHRoaXMuZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gSUFNIGF1dGhlbnRpY2F0aW9uIFxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybikge1xuICAgICAgdGhpcy5leHRyYWN0SWFtQ29udGV4dChldmVudCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBbm9ueW1vdXNcbiAgICBlbHNlIHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9ICdhbm9ueW1vdXMnO1xuICAgIH1cblxuICAgIC8vIFNlc3Npb24gYW5kIHRlbmFudCBjb250ZXh0XG4gICAgdGhpcy5leHRyYWN0U2Vzc2lvbkFuZFRlbmFudENvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcblxuICAgIC8vIEFQSSBHYXRld2F5IGNvbnRleHRcbiAgICBhY3Rvci5hcGlTdGFnZSA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5zdGFnZTtcbiAgICBhY3Rvci5hcGlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hcGlJZDtcblxuICAgIHJldHVybiBhY3RvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IENvZ25pdG8gYWN0b3IgY29udGV4dCBiYXNlZCBvbiBkb2N1bWVudGVkIEFXUyBDb2duaXRvIEpXVCBjbGFpbXNcbiAgICogT25seSBleHRyYWN0cyB3aGF0J3Mgb2ZmaWNpYWxseSBkb2N1bWVudGVkIGFuZCBhdmFpbGFibGUgaW4gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgKiBcbiAgICogQHBhcmFtIGNsYWltcyAtIENvZ25pdG8gSldUIGNsYWltcyBmcm9tIHRoZSBhdXRob3JpemVyXG4gICAqIEBwYXJhbSBhY3RvciAtIEFjdG9yIG9iamVjdCB0byBwb3B1bGF0ZVxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDb2duaXRvQ29udGV4dChjbGFpbXM6IGFueSwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG5cbiAgICAgIC8vIEFjdG9yIElEIHdpdGggZG9jdW1lbnRlZCBmYWxsYmFjayBzdHJhdGVneTogY29nbml0bzp1c2VybmFtZSAtPiBlbWFpbCAtPiBzdWJcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXNbICdjb2duaXRvOnVzZXJuYW1lJyBdIHx8IGNsYWltcy5lbWFpbCB8fCBjbGFpbXMuc3ViO1xuXG4gICAgICAvLyBTdGFuZGFyZCB1c2VyIGF0dHJpYnV0ZXMgKGRvY3VtZW50ZWQgQ29nbml0byB1c2VyIGF0dHJpYnV0ZXMpXG4gICAgICBhY3Rvci5lbWFpbCA9IGNsYWltcy5lbWFpbDtcbiAgICAgIGFjdG9yLmVtYWlsVmVyaWZpZWQgPSBjbGFpbXMuZW1haWxfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLnBob25lTnVtYmVyID0gY2xhaW1zLnBob25lX251bWJlcjtcbiAgICAgIGFjdG9yLnBob25lVmVyaWZpZWQgPSBjbGFpbXMucGhvbmVfbnVtYmVyX3ZlcmlmaWVkID09PSAndHJ1ZSc7XG4gICAgICBhY3Rvci5uYW1lID0gY2xhaW1zLm5hbWU7XG4gICAgICBhY3Rvci5sb2NhbGUgPSBjbGFpbXMubG9jYWxlO1xuXG4gICAgICAvLyBQYXJzZSBDb2duaXRvIGdyb3VwcyAoZG9jdW1lbnRlZCBhcyBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nKVxuICAgICAgY29uc3QgZ3JvdXBzID0gdGhpcy5wYXJzZUdyb3VwcyhjbGFpbXNbICdjb2duaXRvOmdyb3VwcycgXSk7XG5cbiAgICAgIC8vIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXMgKGRvY3VtZW50ZWQgcGF0dGVybjogY3VzdG9tOiopXG4gICAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzID0gdGhpcy5leHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXMpO1xuXG4gICAgICAvLyBCdWlsZCBDb2duaXRvIGNvbnRleHQgd2l0aCBvbmx5IGRvY3VtZW50ZWQgZmllbGRzXG4gICAgICBhY3Rvci5jb2duaXRvID0ge1xuICAgICAgICBzdWI6IGNsYWltcy5zdWIsXG4gICAgICAgIHVzZXJuYW1lOiBjbGFpbXNbICdjb2duaXRvOnVzZXJuYW1lJyBdLFxuICAgICAgICBncm91cHM6IGdyb3VwcywgLy8gQWx3YXlzIGluY2x1ZGUgZ3JvdXBzIGFycmF5IChlbXB0eSBvciBwb3B1bGF0ZWQpXG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IE9iamVjdC5rZXlzKGN1c3RvbUF0dHJpYnV0ZXMpLmxlbmd0aCA+IDAgPyBjdXN0b21BdHRyaWJ1dGVzIDogdW5kZWZpbmVkXG4gICAgICB9O1xuXG4gICAgICAvLyBFeHRyYWN0IHRlbmFudCBJRCBmcm9tIGN1c3RvbSBhdHRyaWJ1dGVzIChjb21tb24gbXVsdGktdGVuYW50IHBhdHRlcm4pXG4gICAgICBhY3Rvci50ZW5hbnRJZCA9IGN1c3RvbUF0dHJpYnV0ZXMudGVuYW50SWQ7XG5cbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0Vycm9yIGV4dHJhY3RpbmcgQ29nbml0byBhY3RvciBjb250ZXh0JywgeyBlcnJvciwgY2xhaW1zIH0pO1xuXG4gICAgICAvLyBNaW5pbWFsIGZhbGxiYWNrIGV4dHJhY3Rpb25cbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zLnN1YiB8fCAndW5rbm93bic7XG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2UgQ29nbml0byBncm91cHMgZnJvbSBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nIChkb2N1bWVudGVkIENvZ25pdG8gZm9ybWF0KVxuICAgKi9cbiAgcHJvdGVjdGVkIHBhcnNlR3JvdXBzKGdyb3VwczogYW55KTogc3RyaW5nW10ge1xuICAgIGlmICh0eXBlb2YgZ3JvdXBzID09PSAnc3RyaW5nJyAmJiBncm91cHMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGdyb3Vwcy5zcGxpdCgnLCcpLm1hcChnID0+IGcudHJpbSgpKS5maWx0ZXIoZyA9PiBnLmxlbmd0aCA+IDApO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyB1c2luZyBkb2N1bWVudGVkIENvZ25pdG8gcGF0dGVybiAoY3VzdG9tOiopXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEN1c3RvbUF0dHJpYnV0ZXMoY2xhaW1zOiBhbnkpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBPYmplY3Qua2V5cyhjbGFpbXMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGlmIChrZXkuc3RhcnRzV2l0aCgnY3VzdG9tOicpKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBrZXkucmVwbGFjZSgnY3VzdG9tOicsICcnKTtcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlc1sgYXR0cmlidXRlTmFtZSBdID0gY2xhaW1zWyBrZXkgXTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjdXN0b21BdHRyaWJ1dGVzO1xuICB9XG5cbiAgLyoqXG4gKiBFeHRyYWN0IHNlc3Npb24gYW5kIHRlbmFudCBjb250ZXh0IC0gZm9jdXNlZCBhcHByb2FjaFxuICovXG4gIHByb3RlY3RlZCBleHRyYWN0U2Vzc2lvbkFuZFRlbmFudENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgLy8gU2Vzc2lvbiBjb250ZXh0XG4gICAgYWN0b3Iuc2Vzc2lvbklkID0gcmVxdWVzdC5oZWFkZXJzPy5bICd4LXNlc3Npb24taWQnIF07XG5cbiAgICAvLyBUZW5hbnQgY29udGV4dCAtIGNoZWNrIGN1c3RvbSBhdHRyaWJ1dGVzIGZpcnN0LCB0aGVuIGhlYWRlcnNcbiAgICBhY3Rvci50ZW5hbnRJZCA9IHJlcXVlc3QuaGVhZGVycz8uWyAneC10ZW5hbnQtaWQnIF0gfHxcbiAgICAgIGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXM/LlsgJ2N1c3RvbTp0ZW5hbnRJZCcgXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IEFQSSBLZXkgY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYXBpLWtleSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuXG4gICAgbGV0IGFwaUtleUlkOiBzdHJpbmc7XG4gICAgbGV0IHNvdXJjZTogJ3JlcXVlc3QtY29udGV4dCcgfCAnaGVhZGVyJztcblxuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSkge1xuICAgICAgYXBpS2V5SWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXlJZCB8fCBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXk7XG4gICAgICBzb3VyY2UgPSAncmVxdWVzdC1jb250ZXh0JztcbiAgICB9IGVsc2Uge1xuICAgICAgYXBpS2V5SWQgPSByZXF1ZXN0LmhlYWRlcnNbICd4LWFwaS1rZXknIF0hO1xuICAgICAgc291cmNlID0gJ2hlYWRlcic7XG4gICAgfVxuXG4gICAgYWN0b3IuYWN0b3JJZCA9IGBhcGkta2V5OiR7YXBpS2V5SWR9YDtcbiAgICBhY3Rvci5hcGlLZXkgPSB7XG4gICAgICBpZDogYXBpS2V5SWQsXG4gICAgICBzb3VyY2U6IHNvdXJjZSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgSUFNIGNvbnRleHRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0SWFtQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2lhbSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgIGFjdG9yLmFjdG9ySWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHxcbiAgICAgIGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybiB8fFxuICAgICAgJ3Vua25vd24taWFtLXVzZXInO1xuXG4gICAgYWN0b3IuaWFtID0ge1xuICAgICAgdXNlckFybjogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8IHVuZGVmaW5lZCxcbiAgICAgIHVzZXJJZDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyIHx8IHVuZGVmaW5lZCxcbiAgICAgIGFjY291bnRJZDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hY2NvdW50SWQgfHwgdW5kZWZpbmVkLFxuICAgICAgY2FsbGVyOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmNhbGxlciB8fCB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxufVxuIl19