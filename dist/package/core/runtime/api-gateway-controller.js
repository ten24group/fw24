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
        // Run entire handler within the execution context. `correlationId` is ambient
        // (AsyncLocalStorage) throughout, so logs carry it and outbound cross-service
        // calls (createHttpHeaders / createSqsAttributes) propagate it.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFtRUEsNENBeUJDO0FBM0ZELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFDNUQsMENBQWlIO0FBRWpILHVEQUF5RjtBQUN6Riw2RUFNK0M7QUFFL0Msa0RBQTRGO0FBRTVGLHVFQUFrRTtBQUNsRSwyREFJNkI7QUFDN0IsdURBQW1EO0FBQ25ELHVEQUF3RTtBQUN4RSx5REFBcUQ7QUFXckQsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7QUFFM0QsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDLENBQUE7QUFGWSxRQUFBLGdCQUFnQixvQkFFNUI7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BSXFCLEVBQ3JCLE9BQXFGO0lBR3JGLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsWUFBRyxFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFHdkUsSUFBTSxvQkFBb0IsR0FBMUIsTUFBTSxvQkFBb0I7UUFFbEIsQUFBTixLQUFLLENBQUMsYUFBYTtZQUNqQixzREFBc0Q7UUFDeEQsQ0FBQztLQUNGLENBQUE7SUFITztRQURMLE1BQU0sQ0FBQyxJQUFJLENB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UUFFRCxLQUFLLENBQUMsT0FBTyxHQUFHLFdBQVcsUUFBUSxFQUFFLENBQUM7UUFDdEMsS0FBSyxDQUFDLE1BQU0sR0FBRztZQUNiLEVBQUUsRUFBRSxRQUFRO1lBQ1osTUFBTSxFQUFFLE1BQU07U0FDZixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ08saUJBQWlCLENBQUMsS0FBc0IsRUFBRSxLQUFZO1FBQzlELEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDO1FBQ3pCLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzVCLEtBQUssQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsSUFBSTtZQUNsRCxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxPQUFPO1lBQ3ZDLGtCQUFrQixDQUFDO1FBRXJCLEtBQUssQ0FBQyxHQUFHLEdBQUc7WUFDVixPQUFPLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTyxJQUFJLFNBQVM7WUFDN0QsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLElBQUksSUFBSSxTQUFTO1lBQ3pELFNBQVMsRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxTQUFTLElBQUksU0FBUztZQUNqRSxNQUFNLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsTUFBTSxJQUFJLFNBQVM7U0FDNUQsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQTM0QkQsc0NBMjRCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgR2V0LCBSb3V0ZU1ldGhvZHMgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9tZXRob2RcIjtcbmltcG9ydCB7IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IsIFZhbGlkYXRpb25GYWlsZWRFcnJvciwgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSBcIi4uLy4uL2Vycm9ycy9cIjtcbmltcG9ydCB0eXBlIHsgUmVxdWVzdCwgUmVzcG9uc2UsIFJvdXRlIH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgZ2VuZXJhdGVUcmFjZUlkLCByZWRhY3RTZW5zaXRpdmVEYXRhIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5pbXBvcnQge1xuICBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyxcbiAgbm9ybWFsaXplSW5jbHVkZXMsXG4gIHNlbGVjdEZpZWxkcyxcbiAgc2VsZWN0RmllbGRzRnJvbUJvZHlcbn0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eS9jb250cm9sbGVyLWNvbmZpZyc7XG5pbXBvcnQgeyBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSwgaXNJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb24vdXRpbHNcIjtcbmltcG9ydCB7IEFjdG9yLCBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7XG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGV4dHJhY3RGcm9tSGVhZGVycyxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsXG59IGZyb20gJy4vZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgUmVxdWVzdENvbnRleHQgfSBmcm9tIFwiLi9yZXF1ZXN0LWNvbnRleHRcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29uZmlnLCBtZXJnZVJlc3BvbnNlQ29uZmlnIH0gZnJvbSBcIi4vcmVzcG9uc2UtY29uZmlnXCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbnRleHQgfSBmcm9tIFwiLi9yZXNwb25zZS1jb250ZXh0XCI7XG5cbmV4cG9ydCB0eXBlIENvbnRyb2xsZXJFcnJvckhhbmRsZXIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVFcnJvckhhbmRsZXI+O1xuXG4vLyBOZXcgaW50ZXJmYWNlcyBmb3IgbWlkZGxld2FyZSBhbmQgZXJyb3IgaGFuZGxpbmdcbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlck1pZGRsZXdhcmUge1xuICBiZWZvcmU/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBhZnRlcj86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIG9uRXJyb3I/OiAoZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG59XG5cbi8vIEdsb2JhbCBtaWRkbGV3YXJlIG1hbmFnZW1lbnRcbmNvbnN0IGdsb2JhbE1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuXG5leHBvcnQgY29uc3QgdXNlTWlkZGxld2FyZSA9IChtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5hZGQobWlkZGxld2FyZSk7XG59XG5leHBvcnQgY29uc3QgY2xlYXJNaWRkbGV3YXJlcyA9ICgpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMuY2xlYXIoKTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIEFQSSBoYW5kbGVyIHdpdGhvdXQgZGVmaW5pbmcgYSBjbGFzc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGV4cG9ydCBjb25zdCB7IGhhbmRsZXIsIGRlc2NyaXB0b3IgfSA9IGNyZWF0ZUFwaUhhbmRsZXIoXG4gKiAgeyBtZXRob2Q6IEdldCwgbmFtZTogJ2RlbW8nLCBhdXRob3JpemVyOiAnTk9ORScgfSxcbiAqICAgYXN5bmMgKCBldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAqICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICogICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAqICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiSGVsbG8gV29ybGQhXCJ9KVxuICogICAgICAgfSlcbiAqICAgfVxuICogKVxuICogYGBgXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5uYW1lIC0gVGhlIG5hbWUgb2YgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMucGF0aCAtIFRoZSBwYXRoIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5tZXRob2QgLSBUaGUgSFRUUCBtZXRob2QgZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBoYW5kbGVyIGZ1bmN0aW9uIGFuZCB0aGUgY29udHJvbGxlciBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXBpSGFuZGxlcihcbiAgb3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwYXRoPzogc3RyaW5nLFxuICAgIG1ldGhvZD86IFJvdXRlTWV0aG9kcyxcbiAgfSAmIElDb250cm9sbGVyQ29uZmlnLFxuICBoYW5kbGVyOiAoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCkgPT4gUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+LFxuKSB7XG5cbiAgY29uc3QgeyBuYW1lLCBwYXRoID0gJycsIG1ldGhvZCA9IEdldCwgLi4uY29udHJvbGxlckNvbmZpZyB9ID0gb3B0aW9ucztcblxuICBAQ29udHJvbGxlcihuYW1lLCB7IC4uLmNvbnRyb2xsZXJDb25maWcsIGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyOiBmYWxzZSB9KVxuICBjbGFzcyBDb250cm9sbGVyRGVzY3JpcHRvciB7XG4gICAgQG1ldGhvZChwYXRoKVxuICAgIGFzeW5jIGlubGluZUhhbmRsZXIoKSB7XG4gICAgICAvLyBwbGFjZWhvbGRlciBmdW5jdGlvbiBvbmx5IHVzZWQgZm9yIHJvdXRpbmcgbWV0YWRhdGFcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaGFuZGxlciwgJ25hbWUnLCB7IHZhbHVlOiAnaGFuZGxlcicgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBoYW5kbGVyLFxuICAgIGRlc2NyaXB0b3I6IENvbnRyb2xsZXJEZXNjcmlwdG9yXG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlckNvbmZpZyB7XG4gIHJlc3BvbnNlQ29uZmlnPzogUGFydGlhbDxSZXNwb25zZUNvbmZpZz47XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUElDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcHJvdGVjdGVkIG1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuICBwcm90ZWN0ZWQgcmVzcG9uc2VDb25maWc6IFJlc3BvbnNlQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogQVBJQ29udHJvbGxlckNvbmZpZyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQ29uZmlnID0gbWVyZ2VSZXNwb25zZUNvbmZpZyhjb25maWcucmVzcG9uc2VDb25maWcpO1xuICB9XG5cbiAgLyoqXG4gICAqIGNhbiBiZSB1c2VkIHRvIHJ1biBzb21lIGxvZ2ljIGp1c3QgYmVmb3JlIHRoZSByZXF1ZXN0IGlzIHByb2Nlc3NlZCBsaWtlIGNyZWF0aW5nIGNsaWVudHMsIGRpLWluamVjdGlvbiBhbnMgc28gb24uXG4gICAqIEBwYXJhbSBfZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gX2NvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGNvbnRyb2xsZXIgaXMgaW5pdGlhbGl6ZWQuXG4gICovXG4gIHByb3RlY3RlZCBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vLW9wIGZvciBBUEkgY29udHJvbGxlcnNcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgfVxuXG4gIC8vIEFkZCBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBtZXRob2RcbiAgcHJvdGVjdGVkIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpIHtcbiAgICB0aGlzLm1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpIHtcbiAgICByZXR1cm4gWyAuLi5BcnJheS5mcm9tKGdsb2JhbE1pZGRsZXdhcmVzKSwgLi4uQXJyYXkuZnJvbSh0aGlzLm1pZGRsZXdhcmVzKSBdO1xuICB9XG5cbiAgLy8gRXhlY3V0ZSBtaWRkbGV3YXJlIHBpcGVsaW5lXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShcbiAgICBwaGFzZTogJ2JlZm9yZScgfCAnYWZ0ZXInIHwgJ29uRXJyb3InLFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsXG4gICAgZXJyb3I/OiBFcnJvclxuICApOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGFsbE1pZGRsZXdhcmVzID0gdGhpcy5nZXRNaWRkbGV3YXJlcygpO1xuXG4gICAgZm9yIChjb25zdCBtaWRkbGV3YXJlIG9mIGFsbE1pZGRsZXdhcmVzKSB7XG4gICAgICBpZiAocGhhc2UgPT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlLm9uRXJyb3IgJiYgZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZS5vbkVycm9yKGVycm9yLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH0gZWxzZSBpZiAocGhhc2UgIT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlWyBwaGFzZSBdKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmVbIHBoYXNlIF0hKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfVxuICAgIH1cblxuICB9XG5cbiAgYXN5bmMgdmFsaWRhdGUocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QsIHZhbGlkYXRpb25zOiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgIGxldCB2YWxpZGF0aW9uUnVsZXM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB2YWxpZGF0aW9ucztcbiAgICBpZiAoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zKSkge1xuICAgICAgaWYgKFsgJ0dFVCcsICdERUxFVEUnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgcXVlcnk6IHZhbGlkYXRpb25zIH1cblxuICAgICAgfSBlbHNlIGlmIChbICdQT1NUJywgJ1BVVCcsICdQQVRDSCcgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBib2R5OiB2YWxpZGF0aW9ucyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvblJ1bGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IodmFsaWRhdGlvblJ1bGVzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7XG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHZhbGlkYXRpb25zOiB2YWxpZGF0aW9uUnVsZXMsXG4gICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLFxuICAgICAgdmVyYm9zZUVycm9yczogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IHRoaXMuZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPFJlcXVlc3Q+IHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZUNvbnRleHQoe1xuICAgICAgdHJhY2VJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgcmVxdWVzdElkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICBkZWJ1Z01vZGU6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIHJvdXRlOiByZXF1ZXN0Q29udGV4dC5wYXRoLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50JyxcbiAgICAgIGNvbmZpZzogdGhpcy5yZXNwb25zZUNvbmZpZ1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgY29udHJvbGxlci5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBBUEkgR2F0ZXdheSBldmVudHMuXG4gICAqIFxuICAgKiBBbGwgaGFuZGxlciBleGVjdXRpb24gaXMgd3JhcHBlZCBpbiBleGVjdXRpb24gY29udGV4dCwgbWFraW5nXG4gICAqIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCkgYXZhaWxhYmxlIHRocm91Z2hvdXQgdGhlIHJlcXVlc3QgbGlmZWN5Y2xlLlxuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIFRoZSBBUEkgR2F0ZXdheSByZXNwb25zZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuICAgIHRoaXMuaW5pdGlhbGl6ZUVudHJ5UGFja2FnZXNBbmRPYnNlcnZhYmlsaXR5KCk7XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuXG4gICAgLy8gQnVpbGQgdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4ID0gdGhpcy5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuXG4gICAgLy8gRmluZCB0aGUgbWF0Y2hpbmcgcm91dGUgKG5lZWRlZCBmb3Igb2JzZXJ2YWJpbGl0eSBjb25maWcpXG4gICAgY29uc3Qgcm91dGUgPSB0aGlzLmZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpO1xuXG4gICAgLy8gR2V0IG1lcmdlZCBvYnNlcnZhYmlsaXR5IGNvbmZpZ1xuICAgIGNvbnN0IG9ic2VydmFiaWxpdHlDb25maWcgPSB0aGlzLmdldE9ic2VydmFiaWxpdHlDb25maWcocm91dGUpO1xuICAgIGNvbnN0IGRlZmF1bHRTb3VyY2UgPSBgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiR7cm91dGU/LmZ1bmN0aW9uTmFtZSB8fCAnaGFuZGxlcid9YDtcblxuICAgIC8vIEV4dHJhY3QgdXBzdHJlYW0gdHJhY2UgY29udGV4dCBmcm9tIGluY29taW5nIGhlYWRlcnMuXG4gICAgLy8gSU1QT1JUQU5UIChmcmFtZXdvcmsgY29udHJhY3QpOlxuICAgIC8vIC0gY29ycmVsYXRpb25JZCBpcyBwZXItaW52b2NhdGlvbiAobG9jYWwgc2xpY2UpXG4gICAgLy8gLSBjYXVzZWRCeSBsaW5rcyB0byB1cHN0cmVhbSBpbnZvY2F0aW9uL3RyYWNlXG4gICAgY29uc3QgdHJhY2VDb250ZXh0ID0gZXh0cmFjdEZyb21IZWFkZXJzKHJlcXVlc3QuaGVhZGVycyB8fCB7fSk7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHJlcXVlc3QucmVxdWVzdElkIHx8IGdlbmVyYXRlVHJhY2VJZCgpO1xuICAgIGNvbnN0IGNhdXNlZEJ5ID0gdHJhY2VDb250ZXh0Py5jYXVzZWRCeSA/PyB0cmFjZUNvbnRleHQ/LmNvcnJlbGF0aW9uSWQ7XG5cbiAgICAvLyBDcmVhdGUgZXhlY3V0aW9uIGNvbnRleHQgd2l0aCBjdXN0b20gc291cmNlIGFuZCB0YWdzIGZyb20gZGVjb3JhdG9yXG4gICAgY29uc3QgZXhlY0N0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIGNhdXNlZEJ5LFxuICAgICAgYWN0b3I6IGN0eC5hY3RvcixcbiAgICAgIHNhbXBsZWQ6IHRyYWNlQ29udGV4dD8uc2FtcGxlZCxcbiAgICAgIHNvdXJjZTogb2JzZXJ2YWJpbGl0eUNvbmZpZz8uc291cmNlIHx8IGRlZmF1bHRTb3VyY2UsXG4gICAgICB0YWdzOiBvYnNlcnZhYmlsaXR5Q29uZmlnPy50YWdzLFxuICAgIH0pO1xuXG4gICAgLy8gQnVpbGQgc3BhbiBhdHRyaWJ1dGVzIChpbmNsdWRlcyByZXF1ZXN0IGRhdGEgY2FwdHVyZSlcbiAgICBjb25zdCBzcGFuQXR0cmlidXRlcyA9IHRoaXMuYnVpbGRTcGFuQXR0cmlidXRlcyhldmVudCwgcmVxdWVzdCwgb2JzZXJ2YWJpbGl0eUNvbmZpZyk7XG5cbiAgICAvLyBCdWlsZCBhdXRvbWF0aWMgdGFncyBmb3IgZWFzeSBmaWx0ZXJpbmdcbiAgICBjb25zdCBhdXRvbWF0aWNUYWdzID0gdGhpcy5idWlsZEF1dG9tYXRpY1RhZ3MocmVxdWVzdCwgY3R4LmFjdG9yLCBldmVudCk7XG5cbiAgICAvLyBSdW4gZW50aXJlIGhhbmRsZXIgd2l0aGluIHRoZSBleGVjdXRpb24gY29udGV4dC4gYGNvcnJlbGF0aW9uSWRgIGlzIGFtYmllbnRcbiAgICAvLyAoQXN5bmNMb2NhbFN0b3JhZ2UpIHRocm91Z2hvdXQsIHNvIGxvZ3MgY2FycnkgaXQgYW5kIG91dGJvdW5kIGNyb3NzLXNlcnZpY2VcbiAgICAvLyBjYWxscyAoY3JlYXRlSHR0cEhlYWRlcnMgLyBjcmVhdGVTcXNBdHRyaWJ1dGVzKSBwcm9wYWdhdGUgaXQuXG4gICAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KGV4ZWNDdHgsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNldCBjdHguZXhlY3V0aW9uQ29udGV4dCB0byBwb2ludCB0byB0aGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICAgIGN0eC5leGVjdXRpb25Db250ZXh0ID0gZXhlY0N0eDtcblxuICAgICAgLy8gU3luYyBhY3Rvci5jb3JyZWxhdGlvbklkIHdpdGggdGhlIHJlc29sdmVkIGNvcnJlbGF0aW9uSWRcbiAgICAgIC8vIFRoaXMgZW5zdXJlcyBhY3RvciBzdG9yZWQgaW4gX2FjdG9yIGZpZWxkIGhhcyB0aGUgY29ycmVjdCB0cmFjZSBJRFxuICAgICAgaWYgKGN0eC5hY3Rvcikge1xuICAgICAgICBjdHguYWN0b3IuY29ycmVsYXRpb25JZCA9IGNvcnJlbGF0aW9uSWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIFVzZSB0aGUgYmFzZSBjbGFzcyBoZWxwZXIgZm9yIHNwYW4gKyBmbHVzaCBwYXR0ZXJuXG4gICAgICByZXR1cm4gdGhpcy5leGVjdXRlV2l0aFNwYW5BbmRGbHVzaChcbiAgICAgICAgYEhUVFAgJHtyZXF1ZXN0Lmh0dHBNZXRob2R9ICR7cmVxdWVzdC5wYXRofWAsXG4gICAgICAgIGFzeW5jIChyZXF1ZXN0U3BhbikgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBMZWdhY3kgaW5pdGlhbGl6ZSBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG5cbiAgICAgICAgICAgIC8vIFRyYWNrIHJlcXVlc3QgcGF5bG9hZCBzaXplXG4gICAgICAgICAgICBpZiAoZXZlbnQuYm9keSkge1xuICAgICAgICAgICAgICByZXF1ZXN0U3Bhbi5tZXRyaWMoJ2h0dHAucmVxdWVzdF9jb250ZW50X2xlbmd0aCcsIEJ1ZmZlci5ieXRlTGVuZ3RoKGV2ZW50LmJvZHksICd1dGY4JykpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeGVjdXRlIGJlZm9yZSBtaWRkbGV3YXJlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2JlZm9yZScsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSB0aGUgcmVxdWVzdCBpZiB2YWxpZGF0aW9ucyBhcmUgZGVmaW5lZFxuICAgICAgICAgICAgaWYgKHJvdXRlPy52YWxpZGF0aW9ucykge1xuICAgICAgICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy52YWxpZGF0ZShyZXF1ZXN0LCByb3V0ZS52YWxpZGF0aW9ucyk7XG4gICAgICAgICAgICAgIGlmICghdmFsaWRhdGlvblJlc3VsdC5wYXNzKSB7XG4gICAgICAgICAgICAgICAgLy8gQWRkIHZhbGlkYXRpb24gZmFpbHVyZSB0byBzcGFuIGZvciBkZWJ1Z2dpbmdcbiAgICAgICAgICAgICAgICBpZiAodmFsaWRhdGlvblJlc3VsdC5lcnJvcnMgJiYgdmFsaWRhdGlvblJlc3VsdC5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgcmVxdWVzdFNwYW4uY2hlY2twb2ludCgndmFsaWRhdGlvbi5mYWlsZWQnLCB7XG4gICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAndmFsaWRhdGlvbi5mYWlsZWQnOiAndHJ1ZScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAndmFsaWRhdGlvbi5lcnJvcl9jb3VudCc6IHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRpb25FcnJvcnM6IHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IodmFsaWRhdGlvblJlc3VsdC5lcnJvcnMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENhbGwgdGhlIHJvdXRlIGZ1bmN0aW9uXG4gICAgICAgICAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpcy5nZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKTtcbiAgICAgICAgICAgIGxldCBjb250cm9sbGVyUmVzcG9uc2U6IGFueSA9IHJvdXRlRnVuY3Rpb24uY2FsbCh0aGlzLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgICAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgICAgIGNvbnRyb2xsZXJSZXNwb25zZSA9IGF3YWl0IGNvbnRyb2xsZXJSZXNwb25zZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhlY3V0ZSBhZnRlciBtaWRkbGV3YXJlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2FmdGVyJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgICAgICAgIC8vIElmIHRoZSBjb250cm9sbGVyIHJldHVybmVkIGFueXRoaW5nLCBlbWl0IHRoYXRcbiAgICAgICAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgIT0gbnVsbCkge1xuICAgICAgICAgICAgICBpZiAob2JzZXJ2YWJpbGl0eUNvbmZpZz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICBjb25zdCByZXNwb25zZUF0dHJzID0gdGhpcy5idWlsZFJlc3BvbnNlQXR0cmlidXRlcyhyZXNwb25zZSwgb2JzZXJ2YWJpbGl0eUNvbmZpZyk7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlQXR0cnMpIHtcbiAgICAgICAgICAgICAgICAgIHJlcXVlc3RTcGFuLnNldERhdGEocmVzcG9uc2VBdHRycyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIC8vIFRhZyBIVFRQIHN0YXR1cyBjb2RlIGFuZCByZXNwb25zZSBzaXplIGZvciBmaWx0ZXJpbmdcbiAgICAgICAgICAgICAgdGhpcy50YWdSZXNwb25zZU1ldHJpY3MocmVxdWVzdFNwYW4sIHJlc3BvbnNlKTtcbiAgICAgICAgICAgICAgLy8gRmx1c2ggaGFwcGVucyBhdXRvbWF0aWNhbGx5IGluIGV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoJ3MgZmluYWxseSBibG9ja1xuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShjb250cm9sbGVyUmVzcG9uc2UpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBGYWxsYmFjayB0byB0aGUgaW4tbWVtb3J5IHJlc3BvbnNlQ29udGV4dFxuICAgICAgICAgICAgaWYgKG9ic2VydmFiaWxpdHlDb25maWc/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlQXR0cnMgPSB0aGlzLmJ1aWxkUmVzcG9uc2VBdHRyaWJ1dGVzKHJlc3BvbnNlLCBvYnNlcnZhYmlsaXR5Q29uZmlnKTtcbiAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlQXR0cnMpIHtcbiAgICAgICAgICAgICAgICByZXF1ZXN0U3Bhbi5zZXREYXRhKHJlc3BvbnNlQXR0cnMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBUYWcgSFRUUCBzdGF0dXMgY29kZSBhbmQgcmVzcG9uc2Ugc2l6ZSBmb3IgZmlsdGVyaW5nXG4gICAgICAgICAgICB0aGlzLnRhZ1Jlc3BvbnNlTWV0cmljcyhyZXF1ZXN0U3BhbiwgcmVzcG9uc2UpO1xuICAgICAgICAgICAgLy8gRmx1c2ggaGFwcGVucyBhdXRvbWF0aWNhbGx5IGluIGV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoJ3MgZmluYWxseSBibG9ja1xuICAgICAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmJ1aWxkKCk7XG5cbiAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0xhbWJkYUhhbmRsZXIgZXJyb3I6ICcsIGVycm9yT2JqKTtcblxuICAgICAgICAgICAgLy8gRXhlY3V0ZSBlcnJvciBtaWRkbGV3YXJlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgICAgICAgIC8vIFRhZyBIVFRQIHN0YXR1cyBjb2RlIGFuZCBlcnJvciBjYXRlZ29yeSBmb3IgZmlsdGVyaW5nXG4gICAgICAgICAgICBjb25zdCBlcnJvclN0YXR1c0NvZGUgPSByZXNwb25zZS5zdGF0dXNDb2RlIHx8IDUwMDtcbiAgICAgICAgICAgIHJlcXVlc3RTcGFuLnRhZygnaHR0cC5zdGF0dXNfY29kZScsIFN0cmluZyhlcnJvclN0YXR1c0NvZGUpKTtcbiAgICAgICAgICAgIHJlcXVlc3RTcGFuLnRhZygnaHR0cC5zdGF0dXNfY29kZV9jbGFzcycsIHRoaXMuZ2V0U3RhdHVzQ29kZUNsYXNzKGVycm9yU3RhdHVzQ29kZSkpO1xuICAgICAgICAgICAgcmVxdWVzdFNwYW4udGFnKCdlcnJvcl9jYXRlZ29yeScsIHRoaXMuY2F0ZWdvcml6ZUVycm9yKGVycm9yU3RhdHVzQ29kZSwgZXJyb3JPYmopKTtcblxuICAgICAgICAgICAgLy8gRmx1c2ggaGFwcGVucyBhdXRvbWF0aWNhbGx5IGluIGV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoJ3MgZmluYWxseSBibG9ja1xuICAgICAgICAgICAgLy8gTm90ZTogd2l0aFNwYW4gd2lsbCBjYWxsIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yIH0pIGF1dG9tYXRpY2FsbHlcbiAgICAgICAgICAgIC8vIFdlIHN0aWxsIG5lZWQgdG8gcmV0dXJuIGEgcmVzcG9uc2UgKGVycm9yIGhhbmRsZXIgbWF5IGhhdmUgbW9kaWZpZWQgaXQpXG4gICAgICAgICAgICB0aHJvdyBlcnJvck9iajtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGNhdXNlZEJ5OiB0cmFjZUNvbnRleHQ/LmNhdXNlZEJ5LFxuICAgICAgICAgIGFjdG9yOiBjdHguYWN0b3IsXG4gICAgICAgICAgc291cmNlOiBvYnNlcnZhYmlsaXR5Q29uZmlnPy5zb3VyY2UgfHwgZGVmYXVsdFNvdXJjZSxcbiAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAgICAgLi4ub2JzZXJ2YWJpbGl0eUNvbmZpZz8udGFncyxcbiAgICAgICAgICAgIC4uLnNwYW5BdHRyaWJ1dGVzLFxuICAgICAgICAgICAgJ2h0dHAucm91dGUnOiByb3V0ZT8uZnVuY3Rpb25OYW1lIHx8ICcnLFxuICAgICAgICAgICAgJ2h0dHAuY29udHJvbGxlcic6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0XG4gICAgICApLmNhdGNoKChlcnIpID0+IHtcbiAgICAgICAgLy8gSGFuZGxlIGVycm9yIHJlc3BvbnNlIGFmdGVyIHNwYW4gZW5kc1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVFeGNlcHRpb24ocmVxdWVzdCwgZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpLCByZXNwb25zZSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIG1lcmdlZCBvYnNlcnZhYmlsaXR5IGNvbmZpZyBmcm9tIGNvbnRyb2xsZXIgYW5kIG1ldGhvZCBsZXZlbFxuICAgKi9cbiAgcHJvdGVjdGVkIGdldE9ic2VydmFiaWxpdHlDb25maWcocm91dGU/OiBSb3V0ZSB8IG51bGwpOiBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgY29udHJvbGxlckNvbmZpZyA9IHRoaXMuZ2V0Q29udHJvbGxlckNvbmZpZygpO1xuICAgIHJldHVybiBtZXJnZU9ic2VydmFiaWxpdHlDb25maWdzKGNvbnRyb2xsZXJDb25maWc/Lm9ic2VydmFiaWxpdHksIHJvdXRlPy5vYnNlcnZhYmlsaXR5KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCBhdXRvbWF0aWMgdGFncyBmb3IgSFRUUCByZXF1ZXN0cy5cbiAgICogVGhlc2UgdGFncyBlbmFibGUgcG93ZXJmdWwgZmlsdGVyaW5nIGluIG9ic2VydmFiaWxpdHkgVUlzLlxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkQXV0b21hdGljVGFncyhcbiAgICByZXF1ZXN0OiBSZXF1ZXN0LFxuICAgIGFjdG9yOiBBY3RvciB8IHVuZGVmaW5lZCxcbiAgICBldmVudDogQVBJR2F0ZXdheUV2ZW50XG4gICk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIGNvbnN0IHRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblxuICAgIC8vIEhUVFAgbWV0aG9kIGNhdGVnb3J5IChzaW1pbGFyIHRvIHNlcnZpY2Ugb3BlcmF0aW9ucylcbiAgICBjb25zdCBtZXRob2QgPSByZXF1ZXN0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKTtcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyB8fCBtZXRob2QgPT09ICdIRUFEJykge1xuICAgICAgdGFncy5vcGVyYXRpb25fY2F0ZWdvcnkgPSAncmVhZCc7XG4gICAgfSBlbHNlIGlmIChtZXRob2QgPT09ICdQT1NUJyB8fCBtZXRob2QgPT09ICdQVVQnIHx8IG1ldGhvZCA9PT0gJ1BBVENIJykge1xuICAgICAgdGFncy5vcGVyYXRpb25fY2F0ZWdvcnkgPSAnd3JpdGUnO1xuICAgIH0gZWxzZSBpZiAobWV0aG9kID09PSAnREVMRVRFJykge1xuICAgICAgdGFncy5vcGVyYXRpb25fY2F0ZWdvcnkgPSAnZGVsZXRlJztcbiAgICB9XG5cbiAgICAvLyBBdXRoIG1ldGhvZCBmb3IgZWFzeSBmaWx0ZXJpbmcgYnkgYXV0aGVudGljYXRpb24gdHlwZVxuICAgIGlmIChhY3Rvcj8uYXV0aE1ldGhvZCkge1xuICAgICAgdGFncy5hdXRoX21ldGhvZCA9IGFjdG9yLmF1dGhNZXRob2Q7XG4gICAgfVxuXG4gICAgLy8gQWN0b3IgdHlwZSAodXNlciB2cyBzZXJ2aWNlKVxuICAgIGlmIChhY3Rvcj8uYWN0b3JUeXBlKSB7XG4gICAgICB0YWdzLmFjdG9yX3R5cGUgPSBhY3Rvci5hY3RvclR5cGU7XG4gICAgfVxuXG4gICAgLy8gQVBJIHN0YWdlIChkZXYsIHN0YWdpbmcsIHByb2QpXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5zdGFnZSkge1xuICAgICAgdGFncy5zdGFnZSA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LnN0YWdlO1xuICAgIH1cblxuICAgIC8vIFRlbmFudCBjb250ZXh0IChmb3IgbXVsdGktdGVuYW50IGZpbHRlcmluZylcbiAgICBpZiAoYWN0b3I/LnRlbmFudElkKSB7XG4gICAgICB0YWdzLnRlbmFudF9pZCA9IGFjdG9yLnRlbmFudElkO1xuICAgIH1cblxuICAgIHJldHVybiB0YWdzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIHNwYW4gYXR0cmlidXRlcyBiYXNlZCBvbiBvYnNlcnZhYmlsaXR5IGNvbmZpZy5cbiAgICogQWx3YXlzIGluY2x1ZGVzIGJhc2ljIEhUVFAgaW5mby4gUmVxdWVzdCBib2R5L2hlYWRlcnMvcXVlcnkgYXJlIG9ubHlcbiAgICogaW5jbHVkZWQgaWYgZXhwbGljaXRseSBjb25maWd1cmVkIHZpYSBgaW5jbHVkZXNgLlxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkU3BhbkF0dHJpYnV0ZXMoXG4gICAgZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCxcbiAgICByZXF1ZXN0OiBSZXF1ZXN0LFxuICAgIGNvbmZpZz86IENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnXG4gICk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgICAvLyBBbHdheXMgaW5jbHVkZSBiYXNpYyBIVFRQIGF0dHJpYnV0ZXNcbiAgICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICAnaHR0cC5tZXRob2QnOiByZXF1ZXN0Lmh0dHBNZXRob2QsXG4gICAgICAnaHR0cC5wYXRoJzogcmVxdWVzdC5wYXRoLFxuICAgICAgJ2h0dHAucmVxdWVzdElkJzogcmVxdWVzdC5yZXF1ZXN0SWQsXG4gICAgICAnaHR0cC51c2VyQWdlbnQnOiBldmVudC5oZWFkZXJzPy5bICd1c2VyLWFnZW50JyBdIHx8IGV2ZW50LmhlYWRlcnM/LlsgJ1VzZXItQWdlbnQnIF0sXG4gICAgICAnaHR0cC5zb3VyY2VJcCc6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgfTtcblxuICAgIC8vIElmIGRpc2FibGVkIG9yIG5vIGluY2x1ZGVzIGNvbmZpZywgcmV0dXJuIGJhc2ljIGF0dHJzIG9ubHlcbiAgICBpZiAoY29uZmlnPy5lbmFibGVkID09PSBmYWxzZSB8fCAhY29uZmlnPy5pbmNsdWRlcykge1xuICAgICAgcmV0dXJuIGF0dHJzO1xuICAgIH1cblxuICAgIC8vIEJ1aWxkIHJlcXVlc3QgZGF0YSBiYXNlZCBvbiBpbmNsdWRlcyBjb25maWdcbiAgICBjb25zdCBpbmNsdWRlcyA9IG5vcm1hbGl6ZUluY2x1ZGVzKGNvbmZpZy5pbmNsdWRlcyk7XG4gICAgY29uc3QgcmVxdWVzdERhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG5cbiAgICBpZiAoaW5jbHVkZXMucmVxdWVzdC5oZWFkZXJzKSB7XG4gICAgICBjb25zdCBoZWFkZXJEYXRhID0gc2VsZWN0RmllbGRzKHJlcXVlc3QuaGVhZGVycyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaW5jbHVkZXMucmVxdWVzdC5oZWFkZXJzKTtcbiAgICAgIGlmIChoZWFkZXJEYXRhKSByZXF1ZXN0RGF0YS5oZWFkZXJzID0gaGVhZGVyRGF0YTtcbiAgICB9XG5cbiAgICBpZiAoaW5jbHVkZXMucmVxdWVzdC5ib2R5ICYmIHJlcXVlc3QuYm9keSkge1xuICAgICAgY29uc3QgYm9keURhdGEgPSB0eXBlb2YgcmVxdWVzdC5ib2R5ID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHNlbGVjdEZpZWxkc0Zyb21Cb2R5KHJlcXVlc3QuYm9keSwgaW5jbHVkZXMucmVxdWVzdC5ib2R5KVxuICAgICAgICA6IHNlbGVjdEZpZWxkcyhyZXF1ZXN0LmJvZHkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGluY2x1ZGVzLnJlcXVlc3QuYm9keSk7XG4gICAgICBpZiAoYm9keURhdGEpIHJlcXVlc3REYXRhLmJvZHkgPSBib2R5RGF0YTtcbiAgICB9XG5cbiAgICBpZiAoaW5jbHVkZXMucmVxdWVzdC5xdWVyeSAmJiByZXF1ZXN0LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycykge1xuICAgICAgY29uc3QgcXVlcnlEYXRhID0gc2VsZWN0RmllbGRzKHJlcXVlc3QucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpbmNsdWRlcy5yZXF1ZXN0LnF1ZXJ5KTtcbiAgICAgIGlmIChxdWVyeURhdGEpIHJlcXVlc3REYXRhLnF1ZXJ5ID0gcXVlcnlEYXRhO1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGRhdGEgcHJvdGVjdGlvbiBhbmQgYWRkIHRvIGF0dHJpYnV0ZXNcbiAgICBpZiAoT2JqZWN0LmtleXMocmVxdWVzdERhdGEpLmxlbmd0aCA+IDApIHtcbiAgICAgIGF0dHJzWyAncmVxdWVzdCcgXSA9IGNvbmZpZy5kYXRhUHJvdGVjdGlvbj8uZW5hYmxlZCAhPT0gZmFsc2VcbiAgICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKHJlcXVlc3REYXRhLCBjb25maWcuZGF0YVByb3RlY3Rpb24pXG4gICAgICAgIDogcmVxdWVzdERhdGE7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIHJlc3BvbnNlIGF0dHJpYnV0ZXMgYmFzZWQgb24gb2JzZXJ2YWJpbGl0eSBjb25maWcuXG4gICAqIE9ubHkgY2FwdHVyZXMgcmVzcG9uc2UgYm9keS9oZWFkZXJzIGlmIGV4cGxpY2l0bHkgY29uZmlndXJlZCB2aWEgYGluY2x1ZGVzYC5cbiAgICovXG4gIHByb3RlY3RlZCBidWlsZFJlc3BvbnNlQXR0cmlidXRlcyhcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgY29uZmlnPzogQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWdcbiAgKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQge1xuICAgIC8vIEFsd2F5cyBpbmNsdWRlIHN0YXR1cyBjb2RlXG4gICAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgJ2h0dHAuc3RhdHVzQ29kZSc6IHJlc3BvbnNlLnN0YXR1c0NvZGUsXG4gICAgfTtcblxuICAgIC8vIElmIGRpc2FibGVkIG9yIG5vIGluY2x1ZGVzIGNvbmZpZywgcmV0dXJuIGp1c3Qgc3RhdHVzIGNvZGVcbiAgICBpZiAoY29uZmlnPy5lbmFibGVkID09PSBmYWxzZSB8fCAhY29uZmlnPy5pbmNsdWRlcykge1xuICAgICAgcmV0dXJuIGF0dHJzO1xuICAgIH1cblxuICAgIGNvbnN0IGluY2x1ZGVzID0gbm9ybWFsaXplSW5jbHVkZXMoY29uZmlnLmluY2x1ZGVzKTtcbiAgICBjb25zdCByZXNwb25zZURhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG5cbiAgICBpZiAoaW5jbHVkZXMucmVzcG9uc2UuaGVhZGVycyAmJiByZXNwb25zZS5oZWFkZXJzKSB7XG4gICAgICBjb25zdCBoZWFkZXJEYXRhID0gc2VsZWN0RmllbGRzKHJlc3BvbnNlLmhlYWRlcnMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGluY2x1ZGVzLnJlc3BvbnNlLmhlYWRlcnMpO1xuICAgICAgaWYgKGhlYWRlckRhdGEpIHJlc3BvbnNlRGF0YS5oZWFkZXJzID0gaGVhZGVyRGF0YTtcbiAgICB9XG5cbiAgICBpZiAoaW5jbHVkZXMucmVzcG9uc2UuYm9keSAmJiByZXNwb25zZS5ib2R5KSB7XG4gICAgICBjb25zdCBib2R5RGF0YSA9IHNlbGVjdEZpZWxkc0Zyb21Cb2R5KHJlc3BvbnNlLmJvZHksIGluY2x1ZGVzLnJlc3BvbnNlLmJvZHkpO1xuICAgICAgaWYgKGJvZHlEYXRhKSByZXNwb25zZURhdGEuYm9keSA9IGJvZHlEYXRhO1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGRhdGEgcHJvdGVjdGlvbiBhbmQgYWRkIHRvIGF0dHJpYnV0ZXNcbiAgICBpZiAoT2JqZWN0LmtleXMocmVzcG9uc2VEYXRhKS5sZW5ndGggPiAwKSB7XG4gICAgICBhdHRyc1sgJ3Jlc3BvbnNlJyBdID0gY29uZmlnLmRhdGFQcm90ZWN0aW9uPy5lbmFibGVkICE9PSBmYWxzZVxuICAgICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEocmVzcG9uc2VEYXRhLCBjb25maWcuZGF0YVByb3RlY3Rpb24pXG4gICAgICAgIDogcmVzcG9uc2VEYXRhO1xuICAgIH1cblxuICAgIHJldHVybiBhdHRycztcbiAgfVxuXG4gIC8qKlxuICAgKiBUYWcgdGhlIHNwYW4gd2l0aCBIVFRQIHN0YXR1cyBjb2RlLCBzdGF0dXMgY29kZSBjbGFzcywgcmVzcG9uc2Ugc2l6ZSxcbiAgICogYW5kIGVycm9yIGNhdGVnb3J5IChmb3IgNHh4LzV4eCByZXNwb25zZXMpLlxuICAgKi9cbiAgcHJvdGVjdGVkIHRhZ1Jlc3BvbnNlTWV0cmljcyhzcGFuOiBTcGFuT2JzZXJ2ZXIsIHJlc3BvbnNlOiBSZXNwb25zZSk6IHZvaWQge1xuICAgIGNvbnN0IHN0YXR1c0NvZGUgPSByZXNwb25zZS5zdGF0dXNDb2RlID8/IDIwMDtcbiAgICBzcGFuLnRhZygnaHR0cC5zdGF0dXNfY29kZScsIFN0cmluZyhzdGF0dXNDb2RlKSk7XG4gICAgc3Bhbi50YWcoJ2h0dHAuc3RhdHVzX2NvZGVfY2xhc3MnLCB0aGlzLmdldFN0YXR1c0NvZGVDbGFzcyhzdGF0dXNDb2RlKSk7XG5cbiAgICBpZiAocmVzcG9uc2UuYm9keSkge1xuICAgICAgc3Bhbi5tZXRyaWMoJ2h0dHAucmVzcG9uc2VfY29udGVudF9sZW5ndGgnLCBCdWZmZXIuYnl0ZUxlbmd0aChyZXNwb25zZS5ib2R5LCAndXRmOCcpKTtcbiAgICB9XG5cbiAgICAvLyBFcnJvciBjYXRlZ29yaXphdGlvbiBmb3Igbm9uLXN1Y2Nlc3MgcmVzcG9uc2VzXG4gICAgaWYgKHN0YXR1c0NvZGUgPj0gNDAwKSB7XG4gICAgICBzcGFuLnRhZygnZXJyb3JfY2F0ZWdvcnknLCB0aGlzLmNhdGVnb3JpemVFcnJvcihzdGF0dXNDb2RlKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzaWZ5IEhUVFAgc3RhdHVzIGNvZGUgaW50byBhIGNsYXNzIHN0cmluZyBmb3IgRHluYW1vREItc2FmZSBmaWx0ZXJpbmcuXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0U3RhdHVzQ29kZUNsYXNzKHN0YXR1c0NvZGU6IG51bWJlcik6IHN0cmluZyB7XG4gICAgaWYgKHN0YXR1c0NvZGUgPCAyMDApIHJldHVybiAnMXh4JztcbiAgICBpZiAoc3RhdHVzQ29kZSA8IDMwMCkgcmV0dXJuICcyeHgnO1xuICAgIGlmIChzdGF0dXNDb2RlIDwgNDAwKSByZXR1cm4gJzN4eCc7XG4gICAgaWYgKHN0YXR1c0NvZGUgPCA1MDApIHJldHVybiAnNHh4JztcbiAgICByZXR1cm4gJzV4eCc7XG4gIH1cblxuICAvKipcbiAgICogQ2xhc3NpZnkgYW4gZXJyb3IgaW50byBhIGJyb2FkIGNhdGVnb3J5IGZvciBmaWx0ZXJpbmcgYW5kIHRyaWFnZS5cbiAgICogQ2F0ZWdvcmllczogYXV0aCwgdmFsaWRhdGlvbiwgaW5mcmFzdHJ1Y3R1cmUsIHNlcnZlciwgYXBwbGljYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgY2F0ZWdvcml6ZUVycm9yKHN0YXR1c0NvZGU6IG51bWJlciwgZXJyb3I/OiBFcnJvcik6IHN0cmluZyB7XG4gICAgaWYgKHN0YXR1c0NvZGUgPT09IDQwMSB8fCBzdGF0dXNDb2RlID09PSA0MDMpIHJldHVybiAnYXV0aCc7XG4gICAgaWYgKHN0YXR1c0NvZGUgPT09IDQyOSkgcmV0dXJuICd0aHJvdHRsZSc7XG4gICAgaWYgKHN0YXR1c0NvZGUgPj0gNDAwICYmIHN0YXR1c0NvZGUgPCA1MDApIHJldHVybiAndmFsaWRhdGlvbic7XG4gICAgaWYgKGVycm9yPy5tZXNzYWdlPy5tYXRjaCgvdGltZW91dHxFVElNRURPVVR8RUNPTk5SRUZVU0VEfEVDT05OUkVTRVR8RU5PVEZPVU5EfHNvY2tldCBoYW5nIHVwL2kpKSB7XG4gICAgICByZXR1cm4gJ2luZnJhc3RydWN0dXJlJztcbiAgICB9XG4gICAgaWYgKHN0YXR1c0NvZGUgPj0gNTAwKSByZXR1cm4gJ3NlcnZlcic7XG4gICAgcmV0dXJuICdhcHBsaWNhdGlvbic7XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHJvdXRlIHRoYXQgbWF0Y2hlcyB0aGUgSFRUUCBtZXRob2QgYW5kIHJlc291cmNlLlxuICAgKiBAcGFyYW0gcmVxdWVzdERhdGEgLSBUaGUgcmVxdWVzdCBkYXRhIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIG1hdGNoaW5nIHJvdXRlIG9yIG51bGwgaWYgbm90IGZvdW5kLlxuICAgKi9cbiAgcHJpdmF0ZSBmaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCk6IFJvdXRlIHwgbnVsbCB7XG4gICAgbGV0IGNvbnRyb2xsZXI6IGFueSA9IHRoaXM7XG5cbiAgICAvLyBEZXRlcm1pbmUgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGJ5IGZpbmRpbmcgdGhlIGxvbmdlc3QgY29tbW9uIHByZWZpeCB0aGF0IGVuZHMgd2l0aCB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgY29uc3QgY29udHJvbGxlck5hbWUgPSB0eXBlb2YgY29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9PT0gJ3N0cmluZycgPyBjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lIDogJyc7XG4gICAgbGV0IGNvbnRyb2xsZXJCYXNlUGF0aCA9IGNvbnRyb2xsZXJOYW1lID8gYC8ke2NvbnRyb2xsZXJOYW1lfWAgOiAnJztcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0Um9vdCA9ICcvJztcblxuICAgIC8vIEZvciBjb250cm9sbGVycyBpbiBzdWJkaXJlY3Rvcmllcywgd2UgbmVlZCB0byBtYXRjaCB0aGUgYWN0dWFsIHJlc291cmNlIHBhdGhcbiAgICAvLyBDaGVjayBpZiByZXNvdXJjZSBjb250YWlucyB0aGUgY29udHJvbGxlciBuYW1lIGFzIHBhcnQgb2YgYSBsb25nZXIgcGF0aFxuICAgIGNvbnN0IHJlcXVlc3RSZXNvdXJjZSA9IChyZXF1ZXN0RGF0YS5yZXNvdXJjZSB8fCByZXF1ZXN0RGF0YS5wYXRoIHx8ICcvJykgYXMgc3RyaW5nO1xuICAgIGNvbnN0IHJlc291cmNlUGFydHMgPSByZXF1ZXN0UmVzb3VyY2Uuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgY29udHJvbGxlck5hbWVQYXJ0cyA9IGNvbnRyb2xsZXJOYW1lLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuXG4gICAgLy8gRmluZCBpZiB0aGUgY29udHJvbGxlciBuYW1lIHBhcnRzIGFyZSBwcmVzZW50IGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgbGV0IGJhc2VQYXRoRW5kSW5kZXggPSAtMTtcbiAgICBpZiAoY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyBMb29rIGZvciB0aGUgY29udHJvbGxlciBuYW1lIHNlcXVlbmNlIGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSByZXNvdXJjZVBhcnRzLmxlbmd0aCAtIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgbGV0IG1hdGNoZXMgPSB0cnVlO1xuICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBpZiAocmVzb3VyY2VQYXJ0c1sgaSArIGogXSAhPT0gY29udHJvbGxlck5hbWVQYXJ0c1sgaiBdKSB7XG4gICAgICAgICAgICBtYXRjaGVzID0gZmFsc2U7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICBiYXNlUGF0aEVuZEluZGV4ID0gaSArIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoIC0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChiYXNlUGF0aEVuZEluZGV4ID49IDApIHtcbiAgICAgIC8vIEZvdW5kIHRoZSBjb250cm9sbGVyIGJhc2UgcGF0aCBpbiB0aGUgcmVzb3VyY2VcbiAgICAgIGNvbnN0IGJhc2VQYXRoUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKDAsIGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIGNvbnRyb2xsZXJCYXNlUGF0aCA9ICcvJyArIGJhc2VQYXRoUGFydHMuam9pbignLycpO1xuICAgICAgY29uc3QgcmVtYWluaW5nUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZW1haW5pbmdQYXJ0cy5sZW5ndGggPiAwID8gJy8nICsgcmVtYWluaW5nUGFydHMuam9pbignLycpIDogJy8nO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGYWxsYmFjayB0byBvcmlnaW5hbCBsb2dpYyBmb3Igc2ltcGxlIGNhc2VzXG4gICAgICBpZiAoY29udHJvbGxlckJhc2VQYXRoICYmIHJlcXVlc3RSZXNvdXJjZS5zdGFydHNXaXRoKGNvbnRyb2xsZXJCYXNlUGF0aCkpIHtcbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3RSZXNvdXJjZS5zdWJzdHJpbmcoY29udHJvbGxlckJhc2VQYXRoLmxlbmd0aCkgfHwgJy8nO1xuICAgICAgfSBlbHNlIGlmICghY29udHJvbGxlckJhc2VQYXRoKSB7XG4gICAgICAgIC8vIE5vIGNvbnRyb2xsZXJOYW1lIGNvbmZpZ3VyZWQ6IHRyZWF0IHRoZSBmdWxsIHJlc291cmNlIGFzIHRoZSByb3V0ZSBwYXRoLlxuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdFJlc291cmNlIHx8ICcvJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXBhcmF0ZSByb3V0ZXMgaW50byBleGFjdCBhbmQgcGFyYW1ldGVyaXplZCBmb3IgcHJvcGVyIHByaW9yaXRpemF0aW9uXG4gICAgY29uc3QgZXhhY3RNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuICAgIGNvbnN0IHBhcmFtZXRlcml6ZWRNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuXG4gICAgLy8gRmlyc3QgcGFzczogY2F0ZWdvcml6ZSByb3V0ZXMgYnkgdHlwZSBhbmQgbWV0aG9kXG4gICAgZm9yIChjb25zdCBbIHJvdXRlS2V5LCByb3V0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRyb2xsZXIucm91dGVzIHx8IHt9KSBhcyBbIHN0cmluZywgUm91dGUgXVtdKSB7XG4gICAgICBjb25zdCBbIHJvdXRlTWV0aG9kLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIC8vIFNraXAgaWYgSFRUUCBtZXRob2QgZG9lc24ndCBtYXRjaFxuICAgICAgaWYgKHJvdXRlTWV0aG9kICE9PSByZXF1ZXN0RGF0YS5odHRwTWV0aG9kKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXRlZ29yaXplIHJvdXRlIHR5cGVcbiAgICAgIGlmIChyb3V0ZVBhdGguaW5jbHVkZXMoJ3snKSAmJiByb3V0ZVBhdGguaW5jbHVkZXMoJ30nKSkge1xuICAgICAgICBwYXJhbWV0ZXJpemVkTWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhhY3RNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2Vjb25kIHBhc3M6IFRyeSBleGFjdCBtYXRjaGVzIGZpcnN0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUgfSBvZiBleGFjdE1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmIChyb3V0ZVBhdGggPT09IHJlc291cmNlV2l0aG91dFJvb3QpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgcGFyYW1ldGVyaXplZCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCwge1xuICAgICAgICAgICAgcGF0dGVybjogcGF0aFRvUmVnZXhwUGF0dGVybixcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hSZXN1bHQucGFyYW1zLFxuICAgICAgICAgICAgc3BlY2lmaWNpdHlTY29yZTogc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMuZmluZChtID0+IG0ucm91dGVLZXkgPT09IHJvdXRlS2V5KT8uc3BlY2lmaWNpdHlTY29yZVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gTm90ZTogV2UgZG9uJ3QgbmVlZCB0byBtYW51YWxseSBleHRyYWN0IHBhcmFtZXRlcnMgc2luY2UgQVBJIEdhdGV3YXlcbiAgICAgICAgICAvLyBhbHJlYWR5IHByb3ZpZGVzIHRoZW0gaW4gcmVxdWVzdERhdGEucGF0aFBhcmFtZXRlcnNcbiAgICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEVycm9yIG1hdGNoaW5nIHJvdXRlIHBhdHRlcm4gJHtwYXRoVG9SZWdleHBQYXR0ZXJufTpgLCBlcnJvcik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIG1hdGNoaW5nIHJvdXRlIGZvdW5kIGZvciAke3JlcXVlc3REYXRhLmh0dHBNZXRob2R9fCR7cmVzb3VyY2VXaXRob3V0Um9vdH1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqIEBwYXJhbSByb3V0ZSAtIFRoZSBtYXRjaGVkIHJvdXRlLlxuICAgKiBAcmV0dXJucyBUaGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0Um91dGVGdW5jdGlvbihyb3V0ZTogUm91dGUgfCBudWxsKTogRnVuY3Rpb24ge1xuICAgIGlmICghcm91dGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gICAgfVxuXG4gICAgLy9AdHMtaWdub3JlXG4gICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXNbIHJvdXRlLmZ1bmN0aW9uTmFtZSBdO1xuXG4gICAgcmV0dXJuIHR5cGVvZiByb3V0ZUZ1bmN0aW9uID09PSBcImZ1bmN0aW9uXCIgPyByb3V0ZUZ1bmN0aW9uIDogdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgdGhlIE5vdEZvdW5kIHJvdXRlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNDA0IHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZU5vdEZvdW5kKF9yZXE6IFJlcXVlc3QpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJObyBSb3V0ZSBGb3VuZCFcIiB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlcnJvckhhbmRsZXI/OiBDb250cm9sbGVyRXJyb3JIYW5kbGVyO1xuICBwcm90ZWN0ZWQgZ2V0RXJyb3JIYW5kbGVyKCk6IENvbnRyb2xsZXJFcnJvckhhbmRsZXIge1xuICAgIGlmICghdGhpcy5lcnJvckhhbmRsZXIpIHtcbiAgICAgIHRoaXMuZXJyb3JIYW5kbGVyID0gY3JlYXRlRXJyb3JIYW5kbGVyKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmVycm9ySGFuZGxlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGV4Y2VwdGlvbnMgYW5kIHJldHVybnMgYSBKU09OIHJlc3BvbnNlIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0gZXJyIC0gVGhlIGVycm9yIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNTAwIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogUmVzcG9uc2UpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSB0aGlzLmdldEVycm9ySGFuZGxlcigpKGVyciwgcmVxLCByZXMpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGVycm9yUmVzcG9uc2UpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVJlc3BvbnNlKHJlczogUmVzcG9uc2UgfCBBUElHYXRld2F5UHJveHlSZXN1bHQpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGlmIChyZXMgaW5zdGFuY2VvZiBSZXNwb25zZUNvbnRleHQpIHtcbiAgICAgIHJldHVybiByZXMuYnVpbGQoKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGV4ZWN1dGlvbiBjb250ZXh0IGZvciB0aGUgcmVxdWVzdFxuICAgKiBcbiAgICogZGlmZmVyZW50IG1pZGRsZXdhcmUgY2FuIGVuaGFuY2UgdGhlIGFjdG9yIGNvbnRleHQgYnkgdXNpbmcgdGhlIGVuaGFuY2VBY3RvciBtZXRob2RcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHNcbiAgICogY29uc3QgbWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gICAqICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdCwgX3Jlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICBjdHg/LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgIHJvbGVzOiBbJ2FkbWluJywgJ3VzZXInXSxcbiAgICogICAgIHBlcm1pc3Npb25zOiBbJ3JlYWQnLCAnd3JpdGUnXSxcbiAgICogICAgIHN1YnNjcmlwdGlvbjogeyB0aWVyOiAnZW50ZXJwcmlzZScgfVxuICAgKiAgIH0pO1xuICAgKiAgfVxuICAgKiB9XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZSk7XG4gICAqIFxuICAgKiBPUlxuICAgKiBcbiAgICogY29uc3Qgc2VjdXJpdHlNaWRkbGV3YXJlID0ge1xuICAgKiAgIGJlZm9yZTogYXN5bmMgKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICAgIGN0eC5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICAgIHJpc2tQcm9maWxlOiBhd2FpdCBhc3Nlc3NSaXNrKGN0eC5hY3Rvci5hY3RvcklkKSxcbiAgICogICAgICAgZGV2aWNlOiBhd2FpdCBtYWtlRGV2aWNlQ29udGV4dChyZXF1ZXN0KVxuICAgKiAgICAgfSk7XG4gICAqICAgfVxuICAgKiB9O1xuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKHNlY3VyaXR5TWlkZGxld2FyZSk7XG4gICAqXG4gICAqIEBwYXJhbSBldmVudCBcbiAgICogQHBhcmFtIGNvbnRleHQgXG4gICAqIEBwYXJhbSByZXF1ZXN0IFxuICAgKiBAcGFyYW0gcmVzcG9uc2UgXG4gICAqIEByZXR1cm5zIFxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGFjdG9yID0gdGhpcy5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgIGNvbnN0IGN0eDogRXhlY3V0aW9uQ29udGV4dCA9IHtcbiAgICAgIGV2ZW50LFxuICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIGFjdG9yLFxuICAgICAgZGVidWdJbmZvOiB7fSxcblxuICAgICAgLy8gU2ltcGxlIGFjdG9yIGVuaGFuY2VtZW50IG1ldGhvZFxuICAgICAgZW5oYW5jZUFjdG9yOiAoZW5oYW5jZW1lbnQ6IFBhcnRpYWw8QWN0b3I+KSA9PiB7XG4gICAgICAgIGlmIChjdHguYWN0b3IpIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKGN0eC5hY3RvciwgZW5oYW5jZW1lbnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiBjdHg7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY29udHJvbGxlciBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0Q29udHJvbGxlckNvbmZpZygpOiBJQ29udHJvbGxlckNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdjb250cm9sbGVyQ29uZmlnJykgfHwge307XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdHMgYWN0b3IgY29udGV4dCBmcm9tIHRoZSByZXF1ZXN0LlxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBmb3IgY3VzdG9tIGFjdG9yIGV4dHJhY3Rpb24gbG9naWMuXG4gICAqIFxuICAgKiBOb3RlOiBjb3JyZWxhdGlvbklkIGlzIE5PVCBzZXQgaGVyZSAtIGl0J3MgZGV0ZXJtaW5lZCBmcm9tIHRyYWNlIGNvbnRleHRcbiAgICogZXh0cmFjdGlvbiBhbmQgc2V0IG9uIHRoZSBFeGVjdXRpb25Db250ZXh0LiBUaGUgYWN0b3IuY29ycmVsYXRpb25JZCBpc1xuICAgKiBzeW5jZWQgbGF0ZXIgaW4gTGFtYmRhSGFuZGxlciBhZnRlciB0cmFjZSBjb250ZXh0IGlzIHJlc29sdmVkLlxuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gcmVxdWVzdCAtIFRoZSByZXF1ZXN0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIGFjdG9yIGNvbnRleHQuXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcblxuICAgIGNvbnN0IGFjdG9yOiBBY3RvciA9IHtcbiAgICAgIHJlcXVlc3RJZCxcbiAgICAgIHRpbWVzdGFtcCxcbiAgICAgIHNvdXJjZUlwOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwLFxuICAgICAgdXNlckFnZW50OiBldmVudC5oZWFkZXJzPy5bICd1c2VyLWFnZW50JyBdIHx8IGV2ZW50LmhlYWRlcnM/LlsgJ1VzZXItQWdlbnQnIF0sXG4gICAgICAvLyBOb3RlOiBjb3JyZWxhdGlvbklkIGlzIHNldCBsYXRlciBhZnRlciB0cmFjZSBjb250ZXh0IGV4dHJhY3Rpb25cbiAgICB9O1xuXG4gICAgLy8gQ29nbml0byBhdXRoZW50aWNhdGlvbiB3aXRoIGZvY3VzZWQgZW5oYW5jZW1lbnRzXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXMpIHtcbiAgICAgIHRoaXMuZXh0cmFjdENvZ25pdG9Db250ZXh0KGV2ZW50LnJlcXVlc3RDb250ZXh0LmF1dGhvcml6ZXIuY2xhaW1zLCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFQSSBLZXkgYXV0aGVudGljYXRpb25cbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSB8fCByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtYXBpLWtleScgXSkge1xuICAgICAgdGhpcy5leHRyYWN0QXBpS2V5Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBJQU0gYXV0aGVudGljYXRpb24gXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuKSB7XG4gICAgICB0aGlzLmV4dHJhY3RJYW1Db250ZXh0KGV2ZW50LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFub255bW91c1xuICAgIGVsc2Uge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvcklkID0gJ2Fub255bW91cyc7XG4gICAgfVxuXG4gICAgLy8gU2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHRcbiAgICB0aGlzLmV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgIGFjdG9yLmFwaVN0YWdlID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LnN0YWdlO1xuICAgIGFjdG9yLmFwaUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmFwaUlkO1xuXG4gICAgcmV0dXJuIGFjdG9yO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQ29nbml0byBhY3RvciBjb250ZXh0IGJhc2VkIG9uIGRvY3VtZW50ZWQgQVdTIENvZ25pdG8gSldUIGNsYWltc1xuICAgKiBPbmx5IGV4dHJhY3RzIHdoYXQncyBvZmZpY2lhbGx5IGRvY3VtZW50ZWQgYW5kIGF2YWlsYWJsZSBpbiBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAqIFxuICAgKiBAcGFyYW0gY2xhaW1zIC0gQ29nbml0byBKV1QgY2xhaW1zIGZyb20gdGhlIGF1dGhvcml6ZXJcbiAgICogQHBhcmFtIGFjdG9yIC0gQWN0b3Igb2JqZWN0IHRvIHBvcHVsYXRlXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdENvZ25pdG9Db250ZXh0KGNsYWltczogYW55LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcblxuICAgICAgLy8gQWN0b3IgSUQgd2l0aCBkb2N1bWVudGVkIGZhbGxiYWNrIHN0cmF0ZWd5OiBjb2duaXRvOnVzZXJuYW1lIC0+IGVtYWlsIC0+IHN1YlxuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0gfHwgY2xhaW1zLmVtYWlsIHx8IGNsYWltcy5zdWI7XG5cbiAgICAgIC8vIFN0YW5kYXJkIHVzZXIgYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBDb2duaXRvIHVzZXIgYXR0cmlidXRlcylcbiAgICAgIGFjdG9yLmVtYWlsID0gY2xhaW1zLmVtYWlsO1xuICAgICAgYWN0b3IuZW1haWxWZXJpZmllZCA9IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IucGhvbmVOdW1iZXIgPSBjbGFpbXMucGhvbmVfbnVtYmVyO1xuICAgICAgYWN0b3IucGhvbmVWZXJpZmllZCA9IGNsYWltcy5waG9uZV9udW1iZXJfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLm5hbWUgPSBjbGFpbXMubmFtZTtcbiAgICAgIGFjdG9yLmxvY2FsZSA9IGNsYWltcy5sb2NhbGU7XG5cbiAgICAgIC8vIFBhcnNlIENvZ25pdG8gZ3JvdXBzIChkb2N1bWVudGVkIGFzIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcpXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLnBhcnNlR3JvdXBzKGNsYWltc1sgJ2NvZ25pdG86Z3JvdXBzJyBdKTtcblxuICAgICAgLy8gRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBwYXR0ZXJuOiBjdXN0b206KilcbiAgICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXMgPSB0aGlzLmV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltcyk7XG5cbiAgICAgIC8vIEJ1aWxkIENvZ25pdG8gY29udGV4dCB3aXRoIG9ubHkgZG9jdW1lbnRlZCBmaWVsZHNcbiAgICAgIGFjdG9yLmNvZ25pdG8gPSB7XG4gICAgICAgIHN1YjogY2xhaW1zLnN1YixcbiAgICAgICAgdXNlcm5hbWU6IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0sXG4gICAgICAgIGdyb3VwczogZ3JvdXBzLCAvLyBBbHdheXMgaW5jbHVkZSBncm91cHMgYXJyYXkgKGVtcHR5IG9yIHBvcHVsYXRlZClcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlczogT2JqZWN0LmtleXMoY3VzdG9tQXR0cmlidXRlcykubGVuZ3RoID4gMCA/IGN1c3RvbUF0dHJpYnV0ZXMgOiB1bmRlZmluZWRcbiAgICAgIH07XG5cbiAgICAgIC8vIEV4dHJhY3QgdGVuYW50IElEIGZyb20gY3VzdG9tIGF0dHJpYnV0ZXMgKGNvbW1vbiBtdWx0aS10ZW5hbnQgcGF0dGVybilcbiAgICAgIGFjdG9yLnRlbmFudElkID0gY3VzdG9tQXR0cmlidXRlcy50ZW5hbnRJZDtcblxuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignRXJyb3IgZXh0cmFjdGluZyBDb2duaXRvIGFjdG9yIGNvbnRleHQnLCB7IGVycm9yLCBjbGFpbXMgfSk7XG5cbiAgICAgIC8vIE1pbmltYWwgZmFsbGJhY2sgZXh0cmFjdGlvblxuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXMuc3ViIHx8ICd1bmtub3duJztcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSBDb2duaXRvIGdyb3VwcyBmcm9tIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcgKGRvY3VtZW50ZWQgQ29nbml0byBmb3JtYXQpXG4gICAqL1xuICBwcm90ZWN0ZWQgcGFyc2VHcm91cHMoZ3JvdXBzOiBhbnkpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHR5cGVvZiBncm91cHMgPT09ICdzdHJpbmcnICYmIGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZ3JvdXBzLnNwbGl0KCcsJykubWFwKGcgPT4gZy50cmltKCkpLmZpbHRlcihnID0+IGcubGVuZ3RoID4gMCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIHVzaW5nIGRvY3VtZW50ZWQgQ29nbml0byBwYXR0ZXJuIChjdXN0b206KilcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXM6IGFueSk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIE9iamVjdC5rZXlzKGNsYWltcykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGtleS5zdGFydHNXaXRoKCdjdXN0b206JykpIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGtleS5yZXBsYWNlKCdjdXN0b206JywgJycpO1xuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzWyBhdHRyaWJ1dGVOYW1lIF0gPSBjbGFpbXNbIGtleSBdO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGN1c3RvbUF0dHJpYnV0ZXM7XG4gIH1cblxuICAvKipcbiAqIEV4dHJhY3Qgc2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHQgLSBmb2N1c2VkIGFwcHJvYWNoXG4gKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICAvLyBTZXNzaW9uIGNvbnRleHRcbiAgICBhY3Rvci5zZXNzaW9uSWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtc2Vzc2lvbi1pZCcgXTtcblxuICAgIC8vIFRlbmFudCBjb250ZXh0IC0gY2hlY2sgY3VzdG9tIGF0dHJpYnV0ZXMgZmlyc3QsIHRoZW4gaGVhZGVyc1xuICAgIGFjdG9yLnRlbmFudElkID0gcmVxdWVzdC5oZWFkZXJzPy5bICd4LXRlbmFudC1pZCcgXSB8fFxuICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcz8uWyAnY3VzdG9tOnRlbmFudElkJyBdO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQVBJIEtleSBjb250ZXh0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhcGkta2V5JztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG5cbiAgICBsZXQgYXBpS2V5SWQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlOiAncmVxdWVzdC1jb250ZXh0JyB8ICdoZWFkZXInO1xuXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5KSB7XG4gICAgICBhcGlLZXlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleUlkIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleTtcbiAgICAgIHNvdXJjZSA9ICdyZXF1ZXN0LWNvbnRleHQnO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcGlLZXlJZCA9IHJlcXVlc3QuaGVhZGVyc1sgJ3gtYXBpLWtleScgXSE7XG4gICAgICBzb3VyY2UgPSAnaGVhZGVyJztcbiAgICB9XG5cbiAgICBhY3Rvci5hY3RvcklkID0gYGFwaS1rZXk6JHthcGlLZXlJZH1gO1xuICAgIGFjdG9yLmFwaUtleSA9IHtcbiAgICAgIGlkOiBhcGlLZXlJZCxcbiAgICAgIHNvdXJjZTogc291cmNlLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBJQU0gY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RJYW1Db250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnaWFtJztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG4gICAgYWN0b3IuYWN0b3JJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fFxuICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8XG4gICAgICAndW5rbm93bi1pYW0tdXNlcic7XG5cbiAgICBhY3Rvci5pYW0gPSB7XG4gICAgICB1c2VyQXJuOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgdW5kZWZpbmVkLFxuICAgICAgdXNlcklkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgdW5kZWZpbmVkLFxuICAgICAgYWNjb3VudElkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFjY291bnRJZCB8fCB1bmRlZmluZWQsXG4gICAgICBjYWxsZXI6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uY2FsbGVyIHx8IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG59XG4iXX0=