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
            // SigV4/IAM auth (e.g. Cognito Identity Pool federation) never carries the calling
            // end-user's own identity server-side — only the assumed IAM role's ARN, typically
            // shared across every user of an app. Fill that gap from an optional, unverified
            // client-supplied header — see mergeClientSuppliedActor().
            this.mergeClientSuppliedActor(event, actor);
        }
        // Anonymous
        else {
            actor.authMethod = 'anonymous';
            actor.actorType = 'anonymous';
            actor.actorId = 'anonymous';
            this.mergeClientSuppliedActor(event, actor);
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
        // Tenant context - check custom attributes first, then headers, then whatever an
        // earlier extraction step already set (e.g. mergeClientSuppliedActor) — never clobber
        // a value with undefined just because neither of these two sources has one.
        actor.tenantId = request.headers?.['x-tenant-id'] ||
            event.requestContext?.authorizer?.claims?.['custom:tenantId'] ||
            actor.tenantId;
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
    /**
     * Fills in the calling end-user's identity from an optional, client-supplied
     * `x-actor` header, for auth methods that never expose it server-side.
     *
     * SigV4-signed requests (e.g. via a Cognito Identity Pool) authenticate as an
     * assumed IAM role — `extractIamContext` only ever sees that role's ARN, which is
     * typically shared by every user of an app, not the real end-user. The client
     * still holds the actual Cognito ID token (that's how it obtained AWS credentials
     * in the first place), so it can send a small decoded summary of it here.
     *
     * SECURITY: this is NEVER server-verified — it's whatever JSON the caller sent, so
     * it's only merged for the IAM/anonymous branches (never overrides a Cognito-JWT-
     * authorizer-derived actor). It deliberately does NOT overwrite `actor.actorId`
     * (which stays the auth-verified IAM ARN / 'anonymous' — the value
     * `base-service.ts`'s `createdBy`/`updatedBy`/`deletedBy`/`tenantId` audit stamping
     * trusts); instead it's exposed only under `actor.clientSuppliedActorId` /
     * `actor.clientSuppliedActor = true`, which log stamping (`src/logging/index.ts`)
     * prefers for observability. It must never be used for authorization decisions or
     * persisted audit fields — observability only. (Before this existed, IAM/anonymous
     * requests could already forge `actor.tenantId` via the pre-existing `x-tenant-id`
     * header, for every auth method, Cognito included — that's a separate, pre-existing
     * exposure this doesn't change either way.)
     *
     * Reads the raw event headers (case-insensitive key match) rather than
     * `request.headers`, which lowercases header VALUES too — that would corrupt the
     * JSON payload (mixed-case ids/emails) this header needs to carry intact.
     */
    mergeClientSuppliedActor(event, actor) {
        const rawHeaders = event.headers || {};
        const headerKey = Object.keys(rawHeaders).find(key => key.toLowerCase() === 'x-actor');
        const raw = headerKey ? rawHeaders[headerKey] : undefined;
        if (typeof raw !== 'string' || !raw.trim())
            return;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                return;
            // id (the Cognito `sub`) is the one required field — everything else is best-effort.
            const id = (0, execution_context_1.sanitizeTraceId)(typeof parsed.id === 'string' ? parsed.id : undefined);
            if (!id)
                return;
            actor.clientSuppliedActorId = id;
            actor.clientSuppliedActor = true;
            // Purely descriptive/observability metadata (like email/username below) — never consumed
            // for authorization or audit-trail trust decisions, so safe to set from client input.
            actor.actorType = 'user';
            if (typeof parsed.email === 'string' && parsed.email.trim())
                actor.email = parsed.email.trim();
            if (typeof parsed.username === 'string' && parsed.username.trim())
                actor.name = parsed.username.trim();
            if (typeof parsed.tenantId === 'string' && parsed.tenantId.trim())
                actor.tenantId = parsed.tenantId.trim();
            actor.cognito = { ...actor.cognito, sub: id };
        }
        catch {
            // malformed header — ignore, never throw from actor extraction
        }
    }
}
exports.APIController = APIController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFvRUEsNENBeUJDO0FBNUZELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFDNUQsMENBQWlIO0FBRWpILHVEQUF5RjtBQUN6Riw2RUFNK0M7QUFFL0Msa0RBQTRGO0FBRTVGLHVFQUFrRTtBQUNsRSwyREFLNkI7QUFDN0IsdURBQW1EO0FBQ25ELHVEQUF3RTtBQUN4RSx5REFBcUQ7QUFXckQsK0JBQStCO0FBQy9CLE1BQU0saUJBQWlCLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7QUFFM0QsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDLENBQUE7QUFGWSxRQUFBLGdCQUFnQixvQkFFNUI7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BSXFCLEVBQ3JCLE9BQXFGO0lBR3JGLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsWUFBRyxFQUFFLEdBQUcsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFHdkUsSUFBTSxvQkFBb0IsR0FBMUIsTUFBTSxvQkFBb0I7UUFFbEIsQUFBTixLQUFLLENBQUMsYUFBYTtZQUNqQixzREFBc0Q7UUFDeEQsQ0FBQztLQUNGLENBQUE7SUFITztRQURMLE1BQU0sQ0FBQyxJQUFJLENB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QUFDLElBQUksRUFBRTtnQkFBRSxLQUFLLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDL0YsSUFBSSxPQUFPLE1BQU0sQ0FBQyxRQUFRLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFO2dCQUFFLEtBQUssQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUN2RyxJQUFJLE9BQU8sTUFBTSxDQUFDLFFBQVEsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUU7Z0JBQUUsS0FBSyxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzNHLEtBQUssQ0FBQyxPQUFPLEdBQUcsRUFBRSxHQUFHLEtBQUssQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFLEVBQUUsRUFBRSxDQUFDO1FBQ2hELENBQUM7UUFBQyxNQUFNLENBQUM7WUFDUCwrREFBK0Q7UUFDakUsQ0FBQztJQUNILENBQUM7Q0FDRjtBQTM4QkQsc0NBMjhCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgR2V0LCBSb3V0ZU1ldGhvZHMgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9tZXRob2RcIjtcbmltcG9ydCB7IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IsIFZhbGlkYXRpb25GYWlsZWRFcnJvciwgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSBcIi4uLy4uL2Vycm9ycy9cIjtcbmltcG9ydCB0eXBlIHsgUmVxdWVzdCwgUmVzcG9uc2UsIFJvdXRlIH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgZ2VuZXJhdGVUcmFjZUlkLCByZWRhY3RTZW5zaXRpdmVEYXRhIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5pbXBvcnQge1xuICBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyxcbiAgbm9ybWFsaXplSW5jbHVkZXMsXG4gIHNlbGVjdEZpZWxkcyxcbiAgc2VsZWN0RmllbGRzRnJvbUJvZHlcbn0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eS9jb250cm9sbGVyLWNvbmZpZyc7XG5pbXBvcnQgeyBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSwgaXNJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb24vdXRpbHNcIjtcbmltcG9ydCB7IEFjdG9yLCBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7XG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGV4dHJhY3RGcm9tSGVhZGVycyxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsXG4gIHNhbml0aXplVHJhY2VJZCxcbn0gZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBSZXF1ZXN0Q29udGV4dCB9IGZyb20gXCIuL3JlcXVlc3QtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb25maWcsIG1lcmdlUmVzcG9uc2VDb25maWcgfSBmcm9tIFwiLi9yZXNwb25zZS1jb25maWdcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29udGV4dCB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbnRleHRcIjtcblxuZXhwb3J0IHR5cGUgQ29udHJvbGxlckVycm9ySGFuZGxlciA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZUVycm9ySGFuZGxlcj47XG5cbi8vIE5ldyBpbnRlcmZhY2VzIGZvciBtaWRkbGV3YXJlIGFuZCBlcnJvciBoYW5kbGluZ1xuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyTWlkZGxld2FyZSB7XG4gIGJlZm9yZT86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIGFmdGVyPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgb25FcnJvcj86IChlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuLy8gR2xvYmFsIG1pZGRsZXdhcmUgbWFuYWdlbWVudFxuY29uc3QgZ2xvYmFsTWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG5cbmV4cG9ydCBjb25zdCB1c2VNaWRkbGV3YXJlID0gKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbn1cbmV4cG9ydCBjb25zdCBjbGVhck1pZGRsZXdhcmVzID0gKCkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5jbGVhcigpO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gQVBJIGhhbmRsZXIgd2l0aG91dCBkZWZpbmluZyBhIGNsYXNzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogZXhwb3J0IGNvbnN0IHsgaGFuZGxlciwgZGVzY3JpcHRvciB9ID0gY3JlYXRlQXBpSGFuZGxlcihcbiAqICB7IG1ldGhvZDogR2V0LCBuYW1lOiAnZGVtbycsIGF1dGhvcml6ZXI6ICdOT05FJyB9LFxuICogICBhc3luYyAoIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICogICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gKiAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICogICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJIZWxsbyBXb3JsZCFcIn0pXG4gKiAgICAgICB9KVxuICogICB9XG4gKiApXG4gKiBgYGBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5wYXRoIC0gVGhlIHBhdGggZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgZnVuY3Rpb24gYW5kIHRoZSBjb250cm9sbGVyIGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBcGlIYW5kbGVyKFxuICBvcHRpb25zOiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHBhdGg/OiBzdHJpbmcsXG4gICAgbWV0aG9kPzogUm91dGVNZXRob2RzLFxuICB9ICYgSUNvbnRyb2xsZXJDb25maWcsXG4gIGhhbmRsZXI6IChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4sXG4pIHtcblxuICBjb25zdCB7IG5hbWUsIHBhdGggPSAnJywgbWV0aG9kID0gR2V0LCAuLi5jb250cm9sbGVyQ29uZmlnIH0gPSBvcHRpb25zO1xuXG4gIEBDb250cm9sbGVyKG5hbWUsIHsgLi4uY29udHJvbGxlckNvbmZpZywgYXV0b0V4cG9ydExhbWJkYUhhbmRsZXI6IGZhbHNlIH0pXG4gIGNsYXNzIENvbnRyb2xsZXJEZXNjcmlwdG9yIHtcbiAgICBAbWV0aG9kKHBhdGgpXG4gICAgYXN5bmMgaW5saW5lSGFuZGxlcigpIHtcbiAgICAgIC8vIHBsYWNlaG9sZGVyIGZ1bmN0aW9uIG9ubHkgdXNlZCBmb3Igcm91dGluZyBtZXRhZGF0YVxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShoYW5kbGVyLCAnbmFtZScsIHsgdmFsdWU6ICdoYW5kbGVyJyB9KTtcblxuICByZXR1cm4ge1xuICAgIGhhbmRsZXIsXG4gICAgZGVzY3JpcHRvcjogQ29udHJvbGxlckRlc2NyaXB0b3JcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyQ29uZmlnIHtcbiAgcmVzcG9uc2VDb25maWc/OiBQYXJ0aWFsPFJlc3BvbnNlQ29uZmlnPjtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFQSUNvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuICBwcm90ZWN0ZWQgbWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG4gIHByb3RlY3RlZCByZXNwb25zZUNvbmZpZzogUmVzcG9uc2VDb25maWc7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBBUElDb250cm9sbGVyQ29uZmlnID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzcG9uc2VDb25maWcgPSBtZXJnZVJlc3BvbnNlQ29uZmlnKGNvbmZpZy5yZXNwb25zZUNvbmZpZyk7XG4gIH1cblxuICAvKipcbiAgICogY2FuIGJlIHVzZWQgdG8gcnVuIHNvbWUgbG9naWMganVzdCBiZWZvcmUgdGhlIHJlcXVlc3QgaXMgcHJvY2Vzc2VkIGxpa2UgY3JlYXRpbmcgY2xpZW50cywgZGktaW5qZWN0aW9uIGFucyBzbyBvbi5cbiAgICogQHBhcmFtIF9ldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBfY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgY29udHJvbGxlciBpcyBpbml0aWFsaXplZC5cbiAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8tb3AgZm9yIEFQSSBjb250cm9sbGVyc1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBnZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICB9XG5cbiAgLy8gQWRkIG1pZGRsZXdhcmUgcmVnaXN0cmF0aW9uIG1ldGhvZFxuICBwcm90ZWN0ZWQgdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkge1xuICAgIHRoaXMubWlkZGxld2FyZXMuYWRkKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCkge1xuICAgIHJldHVybiBbIC4uLkFycmF5LmZyb20oZ2xvYmFsTWlkZGxld2FyZXMpLCAuLi5BcnJheS5mcm9tKHRoaXMubWlkZGxld2FyZXMpIF07XG4gIH1cblxuICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKFxuICAgIHBoYXNlOiAnYmVmb3JlJyB8ICdhZnRlcicgfCAnb25FcnJvcicsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCxcbiAgICBlcnJvcj86IEVycm9yXG4gICk6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYWxsTWlkZGxld2FyZXMgPSB0aGlzLmdldE1pZGRsZXdhcmVzKCk7XG5cbiAgICBmb3IgKGNvbnN0IG1pZGRsZXdhcmUgb2YgYWxsTWlkZGxld2FyZXMpIHtcbiAgICAgIGlmIChwaGFzZSA9PT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmUub25FcnJvciAmJiBlcnJvcikge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlLm9uRXJyb3IoZXJyb3IsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfSBlbHNlIGlmIChwaGFzZSAhPT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmVbIHBoYXNlIF0pIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZVsgcGhhc2UgXSEocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9XG4gICAgfVxuXG4gIH1cblxuICBhc3luYyB2YWxpZGF0ZShyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCwgdmFsaWRhdGlvbnM6IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgbGV0IHZhbGlkYXRpb25SdWxlczogSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyA9IHZhbGlkYXRpb25zO1xuICAgIGlmIChpc0lucHV0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvbnMpKSB7XG4gICAgICBpZiAoWyAnR0VUJywgJ0RFTEVURScgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBxdWVyeTogdmFsaWRhdGlvbnMgfVxuXG4gICAgICB9IGVsc2UgaWYgKFsgJ1BPU1QnLCAnUFVUJywgJ1BBVENIJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IGJvZHk6IHZhbGlkYXRpb25zIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9uUnVsZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvcih2YWxpZGF0aW9uUnVsZXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHtcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25SdWxlcyxcbiAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsXG4gICAgICB2ZXJib3NlRXJyb3JzOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgdGhpcy5nZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVxdWVzdENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UmVxdWVzdD4ge1xuICAgIHJldHVybiBuZXcgUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCk6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlQ29udGV4dCh7XG4gICAgICB0cmFjZUlkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIGRlYnVnTW9kZTogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgcm91dGU6IHJlcXVlc3RDb250ZXh0LnBhdGgsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAnZGV2ZWxvcG1lbnQnLFxuICAgICAgY29uZmlnOiB0aGlzLnJlc3BvbnNlQ29uZmlnXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBjb250cm9sbGVyLlxuICAgKiBIYW5kbGVzIGluY29taW5nIEFQSSBHYXRld2F5IGV2ZW50cy5cbiAgICogXG4gICAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LCBtYWtpbmdcbiAgICogZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSBhdmFpbGFibGUgdGhyb3VnaG91dCB0aGUgcmVxdWVzdCBsaWZlY3ljbGUuXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIEFQSSBHYXRld2F5IHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XG4gICAgdGhpcy5pbml0aWFsaXplRW50cnlQYWNrYWdlc0FuZE9ic2VydmFiaWxpdHkoKTtcblxuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdCk7XG5cbiAgICAvLyBCdWlsZCB0aGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICBjb25zdCBjdHggPSB0aGlzLmJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG5cbiAgICAvLyBGaW5kIHRoZSBtYXRjaGluZyByb3V0ZSAobmVlZGVkIGZvciBvYnNlcnZhYmlsaXR5IGNvbmZpZylcbiAgICBjb25zdCByb3V0ZSA9IHRoaXMuZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCk7XG5cbiAgICAvLyBHZXQgbWVyZ2VkIG9ic2VydmFiaWxpdHkgY29uZmlnXG4gICAgY29uc3Qgb2JzZXJ2YWJpbGl0eUNvbmZpZyA9IHRoaXMuZ2V0T2JzZXJ2YWJpbGl0eUNvbmZpZyhyb3V0ZSk7XG4gICAgY29uc3QgZGVmYXVsdFNvdXJjZSA9IGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0uJHtyb3V0ZT8uZnVuY3Rpb25OYW1lIHx8ICdoYW5kbGVyJ31gO1xuXG4gICAgLy8gRXh0cmFjdCB1cHN0cmVhbSB0cmFjZSBjb250ZXh0IGZyb20gaW5jb21pbmcgaGVhZGVycy5cbiAgICAvLyBJTVBPUlRBTlQgKGZyYW1ld29yayBjb250cmFjdCk6XG4gICAgLy8gLSBjb3JyZWxhdGlvbklkIGlzIHBlci1pbnZvY2F0aW9uIChsb2NhbCBzbGljZSlcbiAgICAvLyAtIGNhdXNlZEJ5IGxpbmtzIHRvIHVwc3RyZWFtIGludm9jYXRpb24vdHJhY2VcbiAgICBjb25zdCB0cmFjZUNvbnRleHQgPSBleHRyYWN0RnJvbUhlYWRlcnMocmVxdWVzdC5oZWFkZXJzIHx8IHt9KTtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gcmVxdWVzdC5yZXF1ZXN0SWQgfHwgZ2VuZXJhdGVUcmFjZUlkKCk7XG4gICAgY29uc3QgY2F1c2VkQnkgPSB0cmFjZUNvbnRleHQ/LmNhdXNlZEJ5ID8/IHRyYWNlQ29udGV4dD8uY29ycmVsYXRpb25JZDtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dCB3aXRoIGN1c3RvbSBzb3VyY2UgYW5kIHRhZ3MgZnJvbSBkZWNvcmF0b3JcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgY2F1c2VkQnksXG4gICAgICBhY3RvcjogY3R4LmFjdG9yLFxuICAgICAgc2FtcGxlZDogdHJhY2VDb250ZXh0Py5zYW1wbGVkLFxuICAgICAgc291cmNlOiBvYnNlcnZhYmlsaXR5Q29uZmlnPy5zb3VyY2UgfHwgZGVmYXVsdFNvdXJjZSxcbiAgICAgIHRhZ3M6IG9ic2VydmFiaWxpdHlDb25maWc/LnRhZ3MsXG4gICAgfSk7XG5cbiAgICAvLyBCdWlsZCBzcGFuIGF0dHJpYnV0ZXMgKGluY2x1ZGVzIHJlcXVlc3QgZGF0YSBjYXB0dXJlKVxuICAgIGNvbnN0IHNwYW5BdHRyaWJ1dGVzID0gdGhpcy5idWlsZFNwYW5BdHRyaWJ1dGVzKGV2ZW50LCByZXF1ZXN0LCBvYnNlcnZhYmlsaXR5Q29uZmlnKTtcblxuICAgIC8vIEJ1aWxkIGF1dG9tYXRpYyB0YWdzIGZvciBlYXN5IGZpbHRlcmluZ1xuICAgIGNvbnN0IGF1dG9tYXRpY1RhZ3MgPSB0aGlzLmJ1aWxkQXV0b21hdGljVGFncyhyZXF1ZXN0LCBjdHguYWN0b3IsIGV2ZW50KTtcblxuICAgIC8vIFJ1biBlbnRpcmUgaGFuZGxlciB3aXRoaW4gdGhlIGV4ZWN1dGlvbiBjb250ZXh0LiBgY29ycmVsYXRpb25JZGAgaXMgYW1iaWVudFxuICAgIC8vIChBc3luY0xvY2FsU3RvcmFnZSkgdGhyb3VnaG91dCwgc28gbG9ncyBjYXJyeSBpdCBhbmQgb3V0Ym91bmQgY3Jvc3Mtc2VydmljZVxuICAgIC8vIGNhbGxzIChjcmVhdGVIdHRwSGVhZGVycyAvIGNyZWF0ZVNxc0F0dHJpYnV0ZXMpIHByb3BhZ2F0ZSBpdC5cbiAgICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoZXhlY0N0eCwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU2V0IGN0eC5leGVjdXRpb25Db250ZXh0IHRvIHBvaW50IHRvIHRoZSBleGVjdXRpb24gY29udGV4dFxuICAgICAgY3R4LmV4ZWN1dGlvbkNvbnRleHQgPSBleGVjQ3R4O1xuXG4gICAgICAvLyBTeW5jIGFjdG9yLmNvcnJlbGF0aW9uSWQgd2l0aCB0aGUgcmVzb2x2ZWQgY29ycmVsYXRpb25JZFxuICAgICAgLy8gVGhpcyBlbnN1cmVzIGFjdG9yIHN0b3JlZCBpbiBfYWN0b3IgZmllbGQgaGFzIHRoZSBjb3JyZWN0IHRyYWNlIElEXG4gICAgICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgICAgIGN0eC5hY3Rvci5jb3JyZWxhdGlvbklkID0gY29ycmVsYXRpb25JZDtcbiAgICAgIH1cblxuICAgICAgLy8gVXNlIHRoZSBiYXNlIGNsYXNzIGhlbHBlciBmb3Igc3BhbiArIGZsdXNoIHBhdHRlcm5cbiAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoKFxuICAgICAgICBgSFRUUCAke3JlcXVlc3QuaHR0cE1ldGhvZH0gJHtyZXF1ZXN0LnBhdGh9YCxcbiAgICAgICAgYXN5bmMgKHJlcXVlc3RTcGFuKSA9PiB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIExlZ2FjeSBpbml0aWFsaXplIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKGV2ZW50LCBjb250ZXh0KTtcblxuICAgICAgICAgICAgLy8gVHJhY2sgcmVxdWVzdCBwYXlsb2FkIHNpemVcbiAgICAgICAgICAgIGlmIChldmVudC5ib2R5KSB7XG4gICAgICAgICAgICAgIHJlcXVlc3RTcGFuLm1ldHJpYygnaHR0cC5yZXF1ZXN0X2NvbnRlbnRfbGVuZ3RoJywgQnVmZmVyLmJ5dGVMZW5ndGgoZXZlbnQuYm9keSwgJ3V0ZjgnKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEV4ZWN1dGUgYmVmb3JlIG1pZGRsZXdhcmVcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIHRoZSByZXF1ZXN0IGlmIHZhbGlkYXRpb25zIGFyZSBkZWZpbmVkXG4gICAgICAgICAgICBpZiAocm91dGU/LnZhbGlkYXRpb25zKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlKHJlcXVlc3QsIHJvdXRlLnZhbGlkYXRpb25zKTtcbiAgICAgICAgICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcbiAgICAgICAgICAgICAgICAvLyBBZGQgdmFsaWRhdGlvbiBmYWlsdXJlIHRvIHNwYW4gZm9yIGRlYnVnZ2luZ1xuICAgICAgICAgICAgICAgIGlmICh2YWxpZGF0aW9uUmVzdWx0LmVycm9ycyAmJiB2YWxpZGF0aW9uUmVzdWx0LmVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICByZXF1ZXN0U3Bhbi5jaGVja3BvaW50KCd2YWxpZGF0aW9uLmZhaWxlZCcsIHtcbiAgICAgICAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgICAgICAgICd2YWxpZGF0aW9uLmZhaWxlZCc6ICd0cnVlJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICAgICAgICd2YWxpZGF0aW9uLmVycm9yX2NvdW50JzogdmFsaWRhdGlvblJlc3VsdC5lcnJvcnMubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGlvbkVycm9yczogdmFsaWRhdGlvblJlc3VsdC5lcnJvcnMsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFZhbGlkYXRpb25GYWlsZWRFcnJvcih2YWxpZGF0aW9uUmVzdWx0LmVycm9ycyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ2FsbCB0aGUgcm91dGUgZnVuY3Rpb25cbiAgICAgICAgICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzLmdldFJvdXRlRnVuY3Rpb24ocm91dGUpO1xuICAgICAgICAgICAgbGV0IGNvbnRyb2xsZXJSZXNwb25zZTogYW55ID0gcm91dGVGdW5jdGlvbi5jYWxsKHRoaXMsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgICAgICAgaWYgKGNvbnRyb2xsZXJSZXNwb25zZSBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgICAgICAgY29udHJvbGxlclJlc3BvbnNlID0gYXdhaXQgY29udHJvbGxlclJlc3BvbnNlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBFeGVjdXRlIGFmdGVyIG1pZGRsZXdhcmVcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYWZ0ZXInLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgICAgICAgLy8gSWYgdGhlIGNvbnRyb2xsZXIgcmV0dXJuZWQgYW55dGhpbmcsIGVtaXQgdGhhdFxuICAgICAgICAgICAgaWYgKGNvbnRyb2xsZXJSZXNwb25zZSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgIGlmIChvYnNlcnZhYmlsaXR5Q29uZmlnPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlQXR0cnMgPSB0aGlzLmJ1aWxkUmVzcG9uc2VBdHRyaWJ1dGVzKHJlc3BvbnNlLCBvYnNlcnZhYmlsaXR5Q29uZmlnKTtcbiAgICAgICAgICAgICAgICBpZiAocmVzcG9uc2VBdHRycykge1xuICAgICAgICAgICAgICAgICAgcmVxdWVzdFNwYW4uc2V0RGF0YShyZXNwb25zZUF0dHJzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgLy8gVGFnIEhUVFAgc3RhdHVzIGNvZGUgYW5kIHJlc3BvbnNlIHNpemUgZm9yIGZpbHRlcmluZ1xuICAgICAgICAgICAgICB0aGlzLnRhZ1Jlc3BvbnNlTWV0cmljcyhyZXF1ZXN0U3BhbiwgcmVzcG9uc2UpO1xuICAgICAgICAgICAgICAvLyBGbHVzaCBoYXBwZW5zIGF1dG9tYXRpY2FsbHkgaW4gZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2gncyBmaW5hbGx5IGJsb2NrXG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGNvbnRyb2xsZXJSZXNwb25zZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBpbi1tZW1vcnkgcmVzcG9uc2VDb250ZXh0XG4gICAgICAgICAgICBpZiAob2JzZXJ2YWJpbGl0eUNvbmZpZz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VBdHRycyA9IHRoaXMuYnVpbGRSZXNwb25zZUF0dHJpYnV0ZXMocmVzcG9uc2UsIG9ic2VydmFiaWxpdHlDb25maWcpO1xuICAgICAgICAgICAgICBpZiAocmVzcG9uc2VBdHRycykge1xuICAgICAgICAgICAgICAgIHJlcXVlc3RTcGFuLnNldERhdGEocmVzcG9uc2VBdHRycyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIFRhZyBIVFRQIHN0YXR1cyBjb2RlIGFuZCByZXNwb25zZSBzaXplIGZvciBmaWx0ZXJpbmdcbiAgICAgICAgICAgIHRoaXMudGFnUmVzcG9uc2VNZXRyaWNzKHJlcXVlc3RTcGFuLCByZXNwb25zZSk7XG4gICAgICAgICAgICAvLyBGbHVzaCBoYXBwZW5zIGF1dG9tYXRpY2FsbHkgaW4gZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2gncyBmaW5hbGx5IGJsb2NrXG4gICAgICAgICAgICByZXR1cm4gcmVzcG9uc2UuYnVpbGQoKTtcblxuICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgY29uc3QgZXJyb3JPYmogPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyKSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignTGFtYmRhSGFuZGxlciBlcnJvcjogJywgZXJyb3JPYmopO1xuXG4gICAgICAgICAgICAvLyBFeGVjdXRlIGVycm9yIG1pZGRsZXdhcmVcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnb25FcnJvcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgsIGVycm9yT2JqKTtcblxuICAgICAgICAgICAgLy8gVGFnIEhUVFAgc3RhdHVzIGNvZGUgYW5kIGVycm9yIGNhdGVnb3J5IGZvciBmaWx0ZXJpbmdcbiAgICAgICAgICAgIGNvbnN0IGVycm9yU3RhdHVzQ29kZSA9IHJlc3BvbnNlLnN0YXR1c0NvZGUgfHwgNTAwO1xuICAgICAgICAgICAgcmVxdWVzdFNwYW4udGFnKCdodHRwLnN0YXR1c19jb2RlJywgU3RyaW5nKGVycm9yU3RhdHVzQ29kZSkpO1xuICAgICAgICAgICAgcmVxdWVzdFNwYW4udGFnKCdodHRwLnN0YXR1c19jb2RlX2NsYXNzJywgdGhpcy5nZXRTdGF0dXNDb2RlQ2xhc3MoZXJyb3JTdGF0dXNDb2RlKSk7XG4gICAgICAgICAgICByZXF1ZXN0U3Bhbi50YWcoJ2Vycm9yX2NhdGVnb3J5JywgdGhpcy5jYXRlZ29yaXplRXJyb3IoZXJyb3JTdGF0dXNDb2RlLCBlcnJvck9iaikpO1xuXG4gICAgICAgICAgICAvLyBGbHVzaCBoYXBwZW5zIGF1dG9tYXRpY2FsbHkgaW4gZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2gncyBmaW5hbGx5IGJsb2NrXG4gICAgICAgICAgICAvLyBOb3RlOiB3aXRoU3BhbiB3aWxsIGNhbGwgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3IgfSkgYXV0b21hdGljYWxseVxuICAgICAgICAgICAgLy8gV2Ugc3RpbGwgbmVlZCB0byByZXR1cm4gYSByZXNwb25zZSAoZXJyb3IgaGFuZGxlciBtYXkgaGF2ZSBtb2RpZmllZCBpdClcbiAgICAgICAgICAgIHRocm93IGVycm9yT2JqO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgY2F1c2VkQnk6IHRyYWNlQ29udGV4dD8uY2F1c2VkQnksXG4gICAgICAgICAgYWN0b3I6IGN0eC5hY3RvcixcbiAgICAgICAgICBzb3VyY2U6IG9ic2VydmFiaWxpdHlDb25maWc/LnNvdXJjZSB8fCBkZWZhdWx0U291cmNlLFxuICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgIC4uLmF1dG9tYXRpY1RhZ3MsXG4gICAgICAgICAgICAuLi5vYnNlcnZhYmlsaXR5Q29uZmlnPy50YWdzLFxuICAgICAgICAgICAgLi4uc3BhbkF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAnaHR0cC5yb3V0ZSc6IHJvdXRlPy5mdW5jdGlvbk5hbWUgfHwgJycsXG4gICAgICAgICAgICAnaHR0cC5jb250cm9sbGVyJzogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGNvbnRleHRcbiAgICAgICkuY2F0Y2goKGVycikgPT4ge1xuICAgICAgICAvLyBIYW5kbGUgZXJyb3IgcmVzcG9uc2UgYWZ0ZXIgc3BhbiBlbmRzXG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZUV4Y2VwdGlvbihyZXF1ZXN0LCBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyKSksIHJlc3BvbnNlKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgbWVyZ2VkIG9ic2VydmFiaWxpdHkgY29uZmlnIGZyb20gY29udHJvbGxlciBhbmQgbWV0aG9kIGxldmVsXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0T2JzZXJ2YWJpbGl0eUNvbmZpZyhyb3V0ZT86IFJvdXRlIHwgbnVsbCk6IENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb250cm9sbGVyQ29uZmlnID0gdGhpcy5nZXRDb250cm9sbGVyQ29uZmlnKCk7XG4gICAgcmV0dXJuIG1lcmdlT2JzZXJ2YWJpbGl0eUNvbmZpZ3MoY29udHJvbGxlckNvbmZpZz8ub2JzZXJ2YWJpbGl0eSwgcm91dGU/Lm9ic2VydmFiaWxpdHkpO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGF1dG9tYXRpYyB0YWdzIGZvciBIVFRQIHJlcXVlc3RzLlxuICAgKiBUaGVzZSB0YWdzIGVuYWJsZSBwb3dlcmZ1bCBmaWx0ZXJpbmcgaW4gb2JzZXJ2YWJpbGl0eSBVSXMuXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRBdXRvbWF0aWNUYWdzKFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgYWN0b3I6IEFjdG9yIHwgdW5kZWZpbmVkLFxuICAgIGV2ZW50OiBBUElHYXRld2F5RXZlbnRcbiAgKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgY29uc3QgdGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXG4gICAgLy8gSFRUUCBtZXRob2QgY2F0ZWdvcnkgKHNpbWlsYXIgdG8gc2VydmljZSBvcGVyYXRpb25zKVxuICAgIGNvbnN0IG1ldGhvZCA9IHJlcXVlc3QuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpO1xuICAgIGlmIChtZXRob2QgPT09ICdHRVQnIHx8IG1ldGhvZCA9PT0gJ0hFQUQnKSB7XG4gICAgICB0YWdzLm9wZXJhdGlvbl9jYXRlZ29yeSA9ICdyZWFkJztcbiAgICB9IGVsc2UgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnIHx8IG1ldGhvZCA9PT0gJ1BVVCcgfHwgbWV0aG9kID09PSAnUEFUQ0gnKSB7XG4gICAgICB0YWdzLm9wZXJhdGlvbl9jYXRlZ29yeSA9ICd3cml0ZSc7XG4gICAgfSBlbHNlIGlmIChtZXRob2QgPT09ICdERUxFVEUnKSB7XG4gICAgICB0YWdzLm9wZXJhdGlvbl9jYXRlZ29yeSA9ICdkZWxldGUnO1xuICAgIH1cblxuICAgIC8vIEF1dGggbWV0aG9kIGZvciBlYXN5IGZpbHRlcmluZyBieSBhdXRoZW50aWNhdGlvbiB0eXBlXG4gICAgaWYgKGFjdG9yPy5hdXRoTWV0aG9kKSB7XG4gICAgICB0YWdzLmF1dGhfbWV0aG9kID0gYWN0b3IuYXV0aE1ldGhvZDtcbiAgICB9XG5cbiAgICAvLyBBY3RvciB0eXBlICh1c2VyIHZzIHNlcnZpY2UpXG4gICAgaWYgKGFjdG9yPy5hY3RvclR5cGUpIHtcbiAgICAgIHRhZ3MuYWN0b3JfdHlwZSA9IGFjdG9yLmFjdG9yVHlwZTtcbiAgICB9XG5cbiAgICAvLyBBUEkgc3RhZ2UgKGRldiwgc3RhZ2luZywgcHJvZClcbiAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LnN0YWdlKSB7XG4gICAgICB0YWdzLnN0YWdlID0gZXZlbnQucmVxdWVzdENvbnRleHQuc3RhZ2U7XG4gICAgfVxuXG4gICAgLy8gVGVuYW50IGNvbnRleHQgKGZvciBtdWx0aS10ZW5hbnQgZmlsdGVyaW5nKVxuICAgIGlmIChhY3Rvcj8udGVuYW50SWQpIHtcbiAgICAgIHRhZ3MudGVuYW50X2lkID0gYWN0b3IudGVuYW50SWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRhZ3M7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgc3BhbiBhdHRyaWJ1dGVzIGJhc2VkIG9uIG9ic2VydmFiaWxpdHkgY29uZmlnLlxuICAgKiBBbHdheXMgaW5jbHVkZXMgYmFzaWMgSFRUUCBpbmZvLiBSZXF1ZXN0IGJvZHkvaGVhZGVycy9xdWVyeSBhcmUgb25seVxuICAgKiBpbmNsdWRlZCBpZiBleHBsaWNpdGx5IGNvbmZpZ3VyZWQgdmlhIGBpbmNsdWRlc2AuXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRTcGFuQXR0cmlidXRlcyhcbiAgICBldmVudDogQVBJR2F0ZXdheUV2ZW50LFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgY29uZmlnPzogQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWdcbiAgKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICAgIC8vIEFsd2F5cyBpbmNsdWRlIGJhc2ljIEhUVFAgYXR0cmlidXRlc1xuICAgIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgICdodHRwLm1ldGhvZCc6IHJlcXVlc3QuaHR0cE1ldGhvZCxcbiAgICAgICdodHRwLnBhdGgnOiByZXF1ZXN0LnBhdGgsXG4gICAgICAnaHR0cC5yZXF1ZXN0SWQnOiByZXF1ZXN0LnJlcXVlc3RJZCxcbiAgICAgICdodHRwLnVzZXJBZ2VudCc6IGV2ZW50LmhlYWRlcnM/LlsgJ3VzZXItYWdlbnQnIF0gfHwgZXZlbnQuaGVhZGVycz8uWyAnVXNlci1BZ2VudCcgXSxcbiAgICAgICdodHRwLnNvdXJjZUlwJzogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICB9O1xuXG4gICAgLy8gSWYgZGlzYWJsZWQgb3Igbm8gaW5jbHVkZXMgY29uZmlnLCByZXR1cm4gYmFzaWMgYXR0cnMgb25seVxuICAgIGlmIChjb25maWc/LmVuYWJsZWQgPT09IGZhbHNlIHx8ICFjb25maWc/LmluY2x1ZGVzKSB7XG4gICAgICByZXR1cm4gYXR0cnM7XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgcmVxdWVzdCBkYXRhIGJhc2VkIG9uIGluY2x1ZGVzIGNvbmZpZ1xuICAgIGNvbnN0IGluY2x1ZGVzID0gbm9ybWFsaXplSW5jbHVkZXMoY29uZmlnLmluY2x1ZGVzKTtcbiAgICBjb25zdCByZXF1ZXN0RGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcblxuICAgIGlmIChpbmNsdWRlcy5yZXF1ZXN0LmhlYWRlcnMpIHtcbiAgICAgIGNvbnN0IGhlYWRlckRhdGEgPSBzZWxlY3RGaWVsZHMocmVxdWVzdC5oZWFkZXJzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpbmNsdWRlcy5yZXF1ZXN0LmhlYWRlcnMpO1xuICAgICAgaWYgKGhlYWRlckRhdGEpIHJlcXVlc3REYXRhLmhlYWRlcnMgPSBoZWFkZXJEYXRhO1xuICAgIH1cblxuICAgIGlmIChpbmNsdWRlcy5yZXF1ZXN0LmJvZHkgJiYgcmVxdWVzdC5ib2R5KSB7XG4gICAgICBjb25zdCBib2R5RGF0YSA9IHR5cGVvZiByZXF1ZXN0LmJvZHkgPT09ICdzdHJpbmcnXG4gICAgICAgID8gc2VsZWN0RmllbGRzRnJvbUJvZHkocmVxdWVzdC5ib2R5LCBpbmNsdWRlcy5yZXF1ZXN0LmJvZHkpXG4gICAgICAgIDogc2VsZWN0RmllbGRzKHJlcXVlc3QuYm9keSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaW5jbHVkZXMucmVxdWVzdC5ib2R5KTtcbiAgICAgIGlmIChib2R5RGF0YSkgcmVxdWVzdERhdGEuYm9keSA9IGJvZHlEYXRhO1xuICAgIH1cblxuICAgIGlmIChpbmNsdWRlcy5yZXF1ZXN0LnF1ZXJ5ICYmIHJlcXVlc3QucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKSB7XG4gICAgICBjb25zdCBxdWVyeURhdGEgPSBzZWxlY3RGaWVsZHMocmVxdWVzdC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGluY2x1ZGVzLnJlcXVlc3QucXVlcnkpO1xuICAgICAgaWYgKHF1ZXJ5RGF0YSkgcmVxdWVzdERhdGEucXVlcnkgPSBxdWVyeURhdGE7XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgZGF0YSBwcm90ZWN0aW9uIGFuZCBhZGQgdG8gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhyZXF1ZXN0RGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgYXR0cnNbICdyZXF1ZXN0JyBdID0gY29uZmlnLmRhdGFQcm90ZWN0aW9uPy5lbmFibGVkICE9PSBmYWxzZVxuICAgICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEocmVxdWVzdERhdGEsIGNvbmZpZy5kYXRhUHJvdGVjdGlvbilcbiAgICAgICAgOiByZXF1ZXN0RGF0YTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cnM7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgcmVzcG9uc2UgYXR0cmlidXRlcyBiYXNlZCBvbiBvYnNlcnZhYmlsaXR5IGNvbmZpZy5cbiAgICogT25seSBjYXB0dXJlcyByZXNwb25zZSBib2R5L2hlYWRlcnMgaWYgZXhwbGljaXRseSBjb25maWd1cmVkIHZpYSBgaW5jbHVkZXNgLlxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkUmVzcG9uc2VBdHRyaWJ1dGVzKFxuICAgIHJlc3BvbnNlOiBSZXNwb25zZSxcbiAgICBjb25maWc/OiBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZ1xuICApOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZCB7XG4gICAgLy8gQWx3YXlzIGluY2x1ZGUgc3RhdHVzIGNvZGVcbiAgICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICAnaHR0cC5zdGF0dXNDb2RlJzogcmVzcG9uc2Uuc3RhdHVzQ29kZSxcbiAgICB9O1xuXG4gICAgLy8gSWYgZGlzYWJsZWQgb3Igbm8gaW5jbHVkZXMgY29uZmlnLCByZXR1cm4ganVzdCBzdGF0dXMgY29kZVxuICAgIGlmIChjb25maWc/LmVuYWJsZWQgPT09IGZhbHNlIHx8ICFjb25maWc/LmluY2x1ZGVzKSB7XG4gICAgICByZXR1cm4gYXR0cnM7XG4gICAgfVxuXG4gICAgY29uc3QgaW5jbHVkZXMgPSBub3JtYWxpemVJbmNsdWRlcyhjb25maWcuaW5jbHVkZXMpO1xuICAgIGNvbnN0IHJlc3BvbnNlRGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcblxuICAgIGlmIChpbmNsdWRlcy5yZXNwb25zZS5oZWFkZXJzICYmIHJlc3BvbnNlLmhlYWRlcnMpIHtcbiAgICAgIGNvbnN0IGhlYWRlckRhdGEgPSBzZWxlY3RGaWVsZHMocmVzcG9uc2UuaGVhZGVycyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaW5jbHVkZXMucmVzcG9uc2UuaGVhZGVycyk7XG4gICAgICBpZiAoaGVhZGVyRGF0YSkgcmVzcG9uc2VEYXRhLmhlYWRlcnMgPSBoZWFkZXJEYXRhO1xuICAgIH1cblxuICAgIGlmIChpbmNsdWRlcy5yZXNwb25zZS5ib2R5ICYmIHJlc3BvbnNlLmJvZHkpIHtcbiAgICAgIGNvbnN0IGJvZHlEYXRhID0gc2VsZWN0RmllbGRzRnJvbUJvZHkocmVzcG9uc2UuYm9keSwgaW5jbHVkZXMucmVzcG9uc2UuYm9keSk7XG4gICAgICBpZiAoYm9keURhdGEpIHJlc3BvbnNlRGF0YS5ib2R5ID0gYm9keURhdGE7XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgZGF0YSBwcm90ZWN0aW9uIGFuZCBhZGQgdG8gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhyZXNwb25zZURhdGEpLmxlbmd0aCA+IDApIHtcbiAgICAgIGF0dHJzWyAncmVzcG9uc2UnIF0gPSBjb25maWcuZGF0YVByb3RlY3Rpb24/LmVuYWJsZWQgIT09IGZhbHNlXG4gICAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShyZXNwb25zZURhdGEsIGNvbmZpZy5kYXRhUHJvdGVjdGlvbilcbiAgICAgICAgOiByZXNwb25zZURhdGE7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJzO1xuICB9XG5cbiAgLyoqXG4gICAqIFRhZyB0aGUgc3BhbiB3aXRoIEhUVFAgc3RhdHVzIGNvZGUsIHN0YXR1cyBjb2RlIGNsYXNzLCByZXNwb25zZSBzaXplLFxuICAgKiBhbmQgZXJyb3IgY2F0ZWdvcnkgKGZvciA0eHgvNXh4IHJlc3BvbnNlcykuXG4gICAqL1xuICBwcm90ZWN0ZWQgdGFnUmVzcG9uc2VNZXRyaWNzKHNwYW46IFNwYW5PYnNlcnZlciwgcmVzcG9uc2U6IFJlc3BvbnNlKTogdm9pZCB7XG4gICAgY29uc3Qgc3RhdHVzQ29kZSA9IHJlc3BvbnNlLnN0YXR1c0NvZGUgPz8gMjAwO1xuICAgIHNwYW4udGFnKCdodHRwLnN0YXR1c19jb2RlJywgU3RyaW5nKHN0YXR1c0NvZGUpKTtcbiAgICBzcGFuLnRhZygnaHR0cC5zdGF0dXNfY29kZV9jbGFzcycsIHRoaXMuZ2V0U3RhdHVzQ29kZUNsYXNzKHN0YXR1c0NvZGUpKTtcblxuICAgIGlmIChyZXNwb25zZS5ib2R5KSB7XG4gICAgICBzcGFuLm1ldHJpYygnaHR0cC5yZXNwb25zZV9jb250ZW50X2xlbmd0aCcsIEJ1ZmZlci5ieXRlTGVuZ3RoKHJlc3BvbnNlLmJvZHksICd1dGY4JykpO1xuICAgIH1cblxuICAgIC8vIEVycm9yIGNhdGVnb3JpemF0aW9uIGZvciBub24tc3VjY2VzcyByZXNwb25zZXNcbiAgICBpZiAoc3RhdHVzQ29kZSA+PSA0MDApIHtcbiAgICAgIHNwYW4udGFnKCdlcnJvcl9jYXRlZ29yeScsIHRoaXMuY2F0ZWdvcml6ZUVycm9yKHN0YXR1c0NvZGUpKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xhc3NpZnkgSFRUUCBzdGF0dXMgY29kZSBpbnRvIGEgY2xhc3Mgc3RyaW5nIGZvciBEeW5hbW9EQi1zYWZlIGZpbHRlcmluZy5cbiAgICovXG4gIHByb3RlY3RlZCBnZXRTdGF0dXNDb2RlQ2xhc3Moc3RhdHVzQ29kZTogbnVtYmVyKTogc3RyaW5nIHtcbiAgICBpZiAoc3RhdHVzQ29kZSA8IDIwMCkgcmV0dXJuICcxeHgnO1xuICAgIGlmIChzdGF0dXNDb2RlIDwgMzAwKSByZXR1cm4gJzJ4eCc7XG4gICAgaWYgKHN0YXR1c0NvZGUgPCA0MDApIHJldHVybiAnM3h4JztcbiAgICBpZiAoc3RhdHVzQ29kZSA8IDUwMCkgcmV0dXJuICc0eHgnO1xuICAgIHJldHVybiAnNXh4JztcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzc2lmeSBhbiBlcnJvciBpbnRvIGEgYnJvYWQgY2F0ZWdvcnkgZm9yIGZpbHRlcmluZyBhbmQgdHJpYWdlLlxuICAgKiBDYXRlZ29yaWVzOiBhdXRoLCB2YWxpZGF0aW9uLCBpbmZyYXN0cnVjdHVyZSwgc2VydmVyLCBhcHBsaWNhdGlvbi5cbiAgICovXG4gIHByb3RlY3RlZCBjYXRlZ29yaXplRXJyb3Ioc3RhdHVzQ29kZTogbnVtYmVyLCBlcnJvcj86IEVycm9yKTogc3RyaW5nIHtcbiAgICBpZiAoc3RhdHVzQ29kZSA9PT0gNDAxIHx8IHN0YXR1c0NvZGUgPT09IDQwMykgcmV0dXJuICdhdXRoJztcbiAgICBpZiAoc3RhdHVzQ29kZSA9PT0gNDI5KSByZXR1cm4gJ3Rocm90dGxlJztcbiAgICBpZiAoc3RhdHVzQ29kZSA+PSA0MDAgJiYgc3RhdHVzQ29kZSA8IDUwMCkgcmV0dXJuICd2YWxpZGF0aW9uJztcbiAgICBpZiAoZXJyb3I/Lm1lc3NhZ2U/Lm1hdGNoKC90aW1lb3V0fEVUSU1FRE9VVHxFQ09OTlJFRlVTRUR8RUNPTk5SRVNFVHxFTk9URk9VTkR8c29ja2V0IGhhbmcgdXAvaSkpIHtcbiAgICAgIHJldHVybiAnaW5mcmFzdHJ1Y3R1cmUnO1xuICAgIH1cbiAgICBpZiAoc3RhdHVzQ29kZSA+PSA1MDApIHJldHVybiAnc2VydmVyJztcbiAgICByZXR1cm4gJ2FwcGxpY2F0aW9uJztcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgcm91dGUgdGhhdCBtYXRjaGVzIHRoZSBIVFRQIG1ldGhvZCBhbmQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSByZXF1ZXN0RGF0YSAtIFRoZSByZXF1ZXN0IGRhdGEgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgbWF0Y2hpbmcgcm91dGUgb3IgbnVsbCBpZiBub3QgZm91bmQuXG4gICAqL1xuICBwcml2YXRlIGZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhOiBSZXF1ZXN0KTogUm91dGUgfCBudWxsIHtcbiAgICBsZXQgY29udHJvbGxlcjogYW55ID0gdGhpcztcblxuICAgIC8vIERldGVybWluZSB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggYnkgZmluZGluZyB0aGUgbG9uZ2VzdCBjb21tb24gcHJlZml4IHRoYXQgZW5kcyB3aXRoIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IHR5cGVvZiBjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lID09PSAnc3RyaW5nJyA/IGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUgOiAnJztcbiAgICBsZXQgY29udHJvbGxlckJhc2VQYXRoID0gY29udHJvbGxlck5hbWUgPyBgLyR7Y29udHJvbGxlck5hbWV9YCA6ICcnO1xuICAgIGxldCByZXNvdXJjZVdpdGhvdXRSb290ID0gJy8nO1xuXG4gICAgLy8gRm9yIGNvbnRyb2xsZXJzIGluIHN1YmRpcmVjdG9yaWVzLCB3ZSBuZWVkIHRvIG1hdGNoIHRoZSBhY3R1YWwgcmVzb3VyY2UgcGF0aFxuICAgIC8vIENoZWNrIGlmIHJlc291cmNlIGNvbnRhaW5zIHRoZSBjb250cm9sbGVyIG5hbWUgYXMgcGFydCBvZiBhIGxvbmdlciBwYXRoXG4gICAgY29uc3QgcmVxdWVzdFJlc291cmNlID0gKHJlcXVlc3REYXRhLnJlc291cmNlIHx8IHJlcXVlc3REYXRhLnBhdGggfHwgJy8nKSBhcyBzdHJpbmc7XG4gICAgY29uc3QgcmVzb3VyY2VQYXJ0cyA9IHJlcXVlc3RSZXNvdXJjZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZVBhcnRzID0gY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAvLyBGaW5kIGlmIHRoZSBjb250cm9sbGVyIG5hbWUgcGFydHMgYXJlIHByZXNlbnQgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICBsZXQgYmFzZVBhdGhFbmRJbmRleCA9IC0xO1xuICAgIGlmIChjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIExvb2sgZm9yIHRoZSBjb250cm9sbGVyIG5hbWUgc2VxdWVuY2UgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHJlc291cmNlUGFydHMubGVuZ3RoIC0gY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBsZXQgbWF0Y2hlcyA9IHRydWU7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIGlmIChyZXNvdXJjZVBhcnRzWyBpICsgaiBdICE9PSBjb250cm9sbGVyTmFtZVBhcnRzWyBqIF0pIHtcbiAgICAgICAgICAgIG1hdGNoZXMgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIGJhc2VQYXRoRW5kSW5kZXggPSBpICsgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggLSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGJhc2VQYXRoRW5kSW5kZXggPj0gMCkge1xuICAgICAgLy8gRm91bmQgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGluIHRoZSByZXNvdXJjZVxuICAgICAgY29uc3QgYmFzZVBhdGhQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoMCwgYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgY29udHJvbGxlckJhc2VQYXRoID0gJy8nICsgYmFzZVBhdGhQYXJ0cy5qb2luKCcvJyk7XG4gICAgICBjb25zdCByZW1haW5pbmdQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlbWFpbmluZ1BhcnRzLmxlbmd0aCA+IDAgPyAnLycgKyByZW1haW5pbmdQYXJ0cy5qb2luKCcvJykgOiAnLyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG9yaWdpbmFsIGxvZ2ljIGZvciBzaW1wbGUgY2FzZXNcbiAgICAgIGlmIChjb250cm9sbGVyQmFzZVBhdGggJiYgcmVxdWVzdFJlc291cmNlLnN0YXJ0c1dpdGgoY29udHJvbGxlckJhc2VQYXRoKSkge1xuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdFJlc291cmNlLnN1YnN0cmluZyhjb250cm9sbGVyQmFzZVBhdGgubGVuZ3RoKSB8fCAnLyc7XG4gICAgICB9IGVsc2UgaWYgKCFjb250cm9sbGVyQmFzZVBhdGgpIHtcbiAgICAgICAgLy8gTm8gY29udHJvbGxlck5hbWUgY29uZmlndXJlZDogdHJlYXQgdGhlIGZ1bGwgcmVzb3VyY2UgYXMgdGhlIHJvdXRlIHBhdGguXG4gICAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZXF1ZXN0UmVzb3VyY2UgfHwgJy8nO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlcGFyYXRlIHJvdXRlcyBpbnRvIGV4YWN0IGFuZCBwYXJhbWV0ZXJpemVkIGZvciBwcm9wZXIgcHJpb3JpdGl6YXRpb25cbiAgICBjb25zdCBleGFjdE1hdGNoZXM6IEFycmF5PHsgcm91dGVLZXk6IHN0cmluZywgcm91dGU6IFJvdXRlIH0+ID0gW107XG4gICAgY29uc3QgcGFyYW1ldGVyaXplZE1hdGNoZXM6IEFycmF5PHsgcm91dGVLZXk6IHN0cmluZywgcm91dGU6IFJvdXRlIH0+ID0gW107XG5cbiAgICAvLyBGaXJzdCBwYXNzOiBjYXRlZ29yaXplIHJvdXRlcyBieSB0eXBlIGFuZCBtZXRob2RcbiAgICBmb3IgKGNvbnN0IFsgcm91dGVLZXksIHJvdXRlIF0gb2YgT2JqZWN0LmVudHJpZXMoY29udHJvbGxlci5yb3V0ZXMgfHwge30pIGFzIFsgc3RyaW5nLCBSb3V0ZSBdW10pIHtcbiAgICAgIGNvbnN0IFsgcm91dGVNZXRob2QsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgLy8gU2tpcCBpZiBIVFRQIG1ldGhvZCBkb2Vzbid0IG1hdGNoXG4gICAgICBpZiAocm91dGVNZXRob2QgIT09IHJlcXVlc3REYXRhLmh0dHBNZXRob2QpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIENhdGVnb3JpemUgcm91dGUgdHlwZVxuICAgICAgaWYgKHJvdXRlUGF0aC5pbmNsdWRlcygneycpICYmIHJvdXRlUGF0aC5pbmNsdWRlcygnfScpKSB7XG4gICAgICAgIHBhcmFtZXRlcml6ZWRNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleGFjdE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZWNvbmQgcGFzczogVHJ5IGV4YWN0IG1hdGNoZXMgZmlyc3QgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgZm9yIChjb25zdCB7IHJvdXRlS2V5LCByb3V0ZSB9IG9mIGV4YWN0TWF0Y2hlcykge1xuICAgICAgY29uc3QgWyAsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgaWYgKHJvdXRlUGF0aCA9PT0gcmVzb3VyY2VXaXRob3V0Um9vdCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgZXhhY3QgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWApO1xuICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVGhpcmQgcGFzczogVHJ5IHBhcmFtZXRlcml6ZWQgbWF0Y2hlcyAoc29ydGVkIGJ5IHNwZWNpZmljaXR5KVxuICAgIC8vIFNvcnQgcGFyYW1ldGVyaXplZCByb3V0ZXMgYnkgc3BlY2lmaWNpdHkgKG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBwcmlvcml0eSlcbiAgICBjb25zdCBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcyA9IHBhcmFtZXRlcml6ZWRNYXRjaGVzXG4gICAgICAubWFwKCh7IHJvdXRlS2V5LCByb3V0ZSB9KSA9PiB7XG4gICAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG4gICAgICAgIGNvbnN0IHNlZ21lbnRzID0gcm91dGVQYXRoLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICBjb25zdCBsaXRlcmFsU2VnbWVudHMgPSBzZWdtZW50cy5maWx0ZXIoc2VnbWVudCA9PiAhc2VnbWVudC5pbmNsdWRlcygneycpKTtcblxuICAgICAgICAvLyBTcGVjaWZpY2l0eSBzY29yZTogbW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlXG4gICAgICAgIC8vIEZvciBlcXVhbCBsaXRlcmFsIHNlZ21lbnRzLCBmZXdlciB0b3RhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZSAgXG4gICAgICAgIGNvbnN0IHNwZWNpZmljaXR5U2NvcmUgPSAobGl0ZXJhbFNlZ21lbnRzLmxlbmd0aCAqIDEwMDApIC0gc2VnbWVudHMubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoLCBzcGVjaWZpY2l0eVNjb3JlIH07XG4gICAgICB9KVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGIuc3BlY2lmaWNpdHlTY29yZSAtIGEuc3BlY2lmaWNpdHlTY29yZSk7IC8vIEhpZ2hlciBzY29yZSBmaXJzdFxuXG4gICAgZm9yIChjb25zdCB7IHJvdXRlS2V5LCByb3V0ZSwgcm91dGVQYXRoIH0gb2Ygc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMpIHtcbiAgICAgIC8vIENvbnZlcnQgZnJhbWV3b3JrIHtpZH0gc3ludGF4IHRvIHBhdGgtdG8tcmVnZXhwIDppZCBzeW50YXhcbiAgICAgIGNvbnN0IHBhdGhUb1JlZ2V4cFBhdHRlcm4gPSByb3V0ZVBhdGgucmVwbGFjZSgvXFx7KFtefV0rKVxcfS9nLCAnOiQxJyk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFVzZSBwYXRoLXRvLXJlZ2V4cCBmb3IgcHJvcGVyIHBhcmFtZXRlciBtYXRjaGluZ1xuICAgICAgICBjb25zdCB7IG1hdGNoIH0gPSByZXF1aXJlKCdwYXRoLXRvLXJlZ2V4cCcpO1xuICAgICAgICBjb25zdCBtYXRjaGVyID0gbWF0Y2gocGF0aFRvUmVnZXhwUGF0dGVybiwgeyBkZWNvZGU6IGRlY29kZVVSSUNvbXBvbmVudCB9KTtcbiAgICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBtYXRjaGVyKHJlc291cmNlV2l0aG91dFJvb3QpO1xuXG4gICAgICAgIGlmIChtYXRjaFJlc3VsdCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3VuZCBwYXJhbWV0ZXJpemVkIG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gLCB7XG4gICAgICAgICAgICBwYXR0ZXJuOiBwYXRoVG9SZWdleHBQYXR0ZXJuLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFJlc3VsdC5wYXJhbXMsXG4gICAgICAgICAgICBzcGVjaWZpY2l0eVNjb3JlOiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcy5maW5kKG0gPT4gbS5yb3V0ZUtleSA9PT0gcm91dGVLZXkpPy5zcGVjaWZpY2l0eVNjb3JlXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBOb3RlOiBXZSBkb24ndCBuZWVkIHRvIG1hbnVhbGx5IGV4dHJhY3QgcGFyYW1ldGVycyBzaW5jZSBBUEkgR2F0ZXdheVxuICAgICAgICAgIC8vIGFscmVhZHkgcHJvdmlkZXMgdGhlbSBpbiByZXF1ZXN0RGF0YS5wYXRoUGFyYW1ldGVyc1xuICAgICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgRXJyb3IgbWF0Y2hpbmcgcm91dGUgcGF0dGVybiAke3BhdGhUb1JlZ2V4cFBhdHRlcm59OmAsIGVycm9yKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIud2FybihgTm8gbWF0Y2hpbmcgcm91dGUgZm91bmQgZm9yICR7cmVxdWVzdERhdGEuaHR0cE1ldGhvZH18JHtyZXNvdXJjZVdpdGhvdXRSb290fWApO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyB0aGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICogQHBhcmFtIHJvdXRlIC0gVGhlIG1hdGNoZWQgcm91dGUuXG4gICAqIEByZXR1cm5zIFRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlOiBSb3V0ZSB8IG51bGwpOiBGdW5jdGlvbiB7XG4gICAgaWYgKCFyb3V0ZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgICB9XG5cbiAgICAvL0B0cy1pZ25vcmVcbiAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpc1sgcm91dGUuZnVuY3Rpb25OYW1lIF07XG5cbiAgICByZXR1cm4gdHlwZW9mIHJvdXRlRnVuY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHJvdXRlRnVuY3Rpb24gOiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyB0aGUgTm90Rm91bmQgcm91dGUuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA0MDQgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlTm90Rm91bmQoX3JlcTogUmVxdWVzdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2Uoe1xuICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIk5vIFJvdXRlIEZvdW5kIVwiIH0pLFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGVycm9ySGFuZGxlcj86IENvbnRyb2xsZXJFcnJvckhhbmRsZXI7XG4gIHByb3RlY3RlZCBnZXRFcnJvckhhbmRsZXIoKTogQ29udHJvbGxlckVycm9ySGFuZGxlciB7XG4gICAgaWYgKCF0aGlzLmVycm9ySGFuZGxlcikge1xuICAgICAgdGhpcy5lcnJvckhhbmRsZXIgPSBjcmVhdGVFcnJvckhhbmRsZXIoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZXJyb3JIYW5kbGVyO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgZXhjZXB0aW9ucyBhbmQgcmV0dXJucyBhIEpTT04gcmVzcG9uc2Ugd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEBwYXJhbSBlcnIgLSBUaGUgZXJyb3Igb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgcmVzcG9uc2Ugb2JqZWN0IHdpdGggYSA1MDAgc3RhdHVzIGNvZGUuXG4gICAqL1xuICBwcm90ZWN0ZWQgaGFuZGxlRXhjZXB0aW9uKHJlcTogUmVxdWVzdCwgZXJyOiBFcnJvciwgcmVzOiBSZXNwb25zZSk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgY29uc3QgZXJyb3JSZXNwb25zZSA9IHRoaXMuZ2V0RXJyb3JIYW5kbGVyKCkoZXJyLCByZXEsIHJlcyk7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoZXJyb3JSZXNwb25zZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlUmVzcG9uc2UocmVzOiBSZXNwb25zZSB8IEFQSUdhdGV3YXlQcm94eVJlc3VsdCk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XG4gICAgaWYgKHJlcyBpbnN0YW5jZW9mIFJlc3BvbnNlQ29udGV4dCkge1xuICAgICAgcmV0dXJuIHJlcy5idWlsZCgpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZXhlY3V0aW9uIGNvbnRleHQgZm9yIHRoZSByZXF1ZXN0XG4gICAqIFxuICAgKiBkaWZmZXJlbnQgbWlkZGxld2FyZSBjYW4gZW5oYW5jZSB0aGUgYWN0b3IgY29udGV4dCBieSB1c2luZyB0aGUgZW5oYW5jZUFjdG9yIG1ldGhvZFxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0c1xuICAgKiBjb25zdCBtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSA9IHtcbiAgICogIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0LCBfcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgKiAgIGN0eD8uZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgcm9sZXM6IFsnYWRtaW4nLCAndXNlciddLFxuICAgKiAgICAgcGVybWlzc2lvbnM6IFsncmVhZCcsICd3cml0ZSddLFxuICAgKiAgICAgc3Vic2NyaXB0aW9uOiB7IHRpZXI6ICdlbnRlcnByaXNlJyB9XG4gICAqICAgfSk7XG4gICAqICB9XG4gICAqIH1cbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlKTtcbiAgICogXG4gICAqIE9SXG4gICAqIFxuICAgKiBjb25zdCBzZWN1cml0eU1pZGRsZXdhcmUgPSB7XG4gICAqICAgYmVmb3JlOiBhc3luYyAocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgKiAgICAgY3R4LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgICAgcmlza1Byb2ZpbGU6IGF3YWl0IGFzc2Vzc1Jpc2soY3R4LmFjdG9yLmFjdG9ySWQpLFxuICAgKiAgICAgICBkZXZpY2U6IGF3YWl0IG1ha2VEZXZpY2VDb250ZXh0KHJlcXVlc3QpXG4gICAqICAgICB9KTtcbiAgICogICB9XG4gICAqIH07XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUoc2VjdXJpdHlNaWRkbGV3YXJlKTtcbiAgICpcbiAgICogQHBhcmFtIGV2ZW50IFxuICAgKiBAcGFyYW0gY29udGV4dCBcbiAgICogQHBhcmFtIHJlcXVlc3QgXG4gICAqIEBwYXJhbSByZXNwb25zZSBcbiAgICogQHJldHVybnMgXG4gICAqL1xuICBwcm90ZWN0ZWQgYnVpbGRDdHgoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKTogRXhlY3V0aW9uQ29udGV4dCB7XG4gICAgY29uc3QgYWN0b3IgPSB0aGlzLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgY29uc3QgY3R4OiBFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgZXZlbnQsXG4gICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgYWN0b3IsXG4gICAgICBkZWJ1Z0luZm86IHt9LFxuXG4gICAgICAvLyBTaW1wbGUgYWN0b3IgZW5oYW5jZW1lbnQgbWV0aG9kXG4gICAgICBlbmhhbmNlQWN0b3I6IChlbmhhbmNlbWVudDogUGFydGlhbDxBY3Rvcj4pID0+IHtcbiAgICAgICAgaWYgKGN0eC5hY3Rvcikge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oY3R4LmFjdG9yLCBlbmhhbmNlbWVudCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIGN0eDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjb250cm9sbGVyIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCBnZXRDb250cm9sbGVyQ29uZmlnKCk6IElDb250cm9sbGVyQ29uZmlnIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ2NvbnRyb2xsZXJDb25maWcnKSB8fCB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBhY3RvciBjb250ZXh0IGZyb20gdGhlIHJlcXVlc3QuXG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGZvciBjdXN0b20gYWN0b3IgZXh0cmFjdGlvbiBsb2dpYy5cbiAgICogXG4gICAqIE5vdGU6IGNvcnJlbGF0aW9uSWQgaXMgTk9UIHNldCBoZXJlIC0gaXQncyBkZXRlcm1pbmVkIGZyb20gdHJhY2UgY29udGV4dFxuICAgKiBleHRyYWN0aW9uIGFuZCBzZXQgb24gdGhlIEV4ZWN1dGlvbkNvbnRleHQuIFRoZSBhY3Rvci5jb3JyZWxhdGlvbklkIGlzXG4gICAqIHN5bmNlZCBsYXRlciBpbiBMYW1iZGFIYW5kbGVyIGFmdGVyIHRyYWNlIGNvbnRleHQgaXMgcmVzb2x2ZWQuXG4gICAqXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSByZXF1ZXN0IC0gVGhlIHJlcXVlc3Qgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgYWN0b3IgY29udGV4dC5cbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QpOiBBY3RvciB7XG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlcXVlc3QucmVxdWVzdElkO1xuXG4gICAgY29uc3QgYWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkLFxuICAgICAgdGltZXN0YW1wLFxuICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnM/LlsgJ3VzZXItYWdlbnQnIF0gfHwgZXZlbnQuaGVhZGVycz8uWyAnVXNlci1BZ2VudCcgXSxcbiAgICAgIC8vIE5vdGU6IGNvcnJlbGF0aW9uSWQgaXMgc2V0IGxhdGVyIGFmdGVyIHRyYWNlIGNvbnRleHQgZXh0cmFjdGlvblxuICAgIH07XG5cbiAgICAvLyBDb2duaXRvIGF1dGhlbnRpY2F0aW9uIHdpdGggZm9jdXNlZCBlbmhhbmNlbWVudHNcbiAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcykge1xuICAgICAgdGhpcy5leHRyYWN0Q29nbml0b0NvbnRleHQoZXZlbnQucmVxdWVzdENvbnRleHQuYXV0aG9yaXplci5jbGFpbXMsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gQVBJIEtleSBhdXRoZW50aWNhdGlvblxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5IHx8IHJlcXVlc3QuaGVhZGVycz8uWyAneC1hcGkta2V5JyBdKSB7XG4gICAgICB0aGlzLmV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50LCByZXF1ZXN0LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIElBTSBhdXRoZW50aWNhdGlvblxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybikge1xuICAgICAgdGhpcy5leHRyYWN0SWFtQ29udGV4dChldmVudCwgYWN0b3IpO1xuICAgICAgLy8gU2lnVjQvSUFNIGF1dGggKGUuZy4gQ29nbml0byBJZGVudGl0eSBQb29sIGZlZGVyYXRpb24pIG5ldmVyIGNhcnJpZXMgdGhlIGNhbGxpbmdcbiAgICAgIC8vIGVuZC11c2VyJ3Mgb3duIGlkZW50aXR5IHNlcnZlci1zaWRlIOKAlCBvbmx5IHRoZSBhc3N1bWVkIElBTSByb2xlJ3MgQVJOLCB0eXBpY2FsbHlcbiAgICAgIC8vIHNoYXJlZCBhY3Jvc3MgZXZlcnkgdXNlciBvZiBhbiBhcHAuIEZpbGwgdGhhdCBnYXAgZnJvbSBhbiBvcHRpb25hbCwgdW52ZXJpZmllZFxuICAgICAgLy8gY2xpZW50LXN1cHBsaWVkIGhlYWRlciDigJQgc2VlIG1lcmdlQ2xpZW50U3VwcGxpZWRBY3RvcigpLlxuICAgICAgdGhpcy5tZXJnZUNsaWVudFN1cHBsaWVkQWN0b3IoZXZlbnQsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gQW5vbnltb3VzXG4gICAgZWxzZSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSAnYW5vbnltb3VzJztcbiAgICAgIHRoaXMubWVyZ2VDbGllbnRTdXBwbGllZEFjdG9yKGV2ZW50LCBhY3Rvcik7XG4gICAgfVxuXG4gICAgLy8gU2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHRcbiAgICB0aGlzLmV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgIGFjdG9yLmFwaVN0YWdlID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LnN0YWdlO1xuICAgIGFjdG9yLmFwaUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmFwaUlkO1xuXG4gICAgcmV0dXJuIGFjdG9yO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQ29nbml0byBhY3RvciBjb250ZXh0IGJhc2VkIG9uIGRvY3VtZW50ZWQgQVdTIENvZ25pdG8gSldUIGNsYWltc1xuICAgKiBPbmx5IGV4dHJhY3RzIHdoYXQncyBvZmZpY2lhbGx5IGRvY3VtZW50ZWQgYW5kIGF2YWlsYWJsZSBpbiBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAqIFxuICAgKiBAcGFyYW0gY2xhaW1zIC0gQ29nbml0byBKV1QgY2xhaW1zIGZyb20gdGhlIGF1dGhvcml6ZXJcbiAgICogQHBhcmFtIGFjdG9yIC0gQWN0b3Igb2JqZWN0IHRvIHBvcHVsYXRlXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdENvZ25pdG9Db250ZXh0KGNsYWltczogYW55LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcblxuICAgICAgLy8gQWN0b3IgSUQgd2l0aCBkb2N1bWVudGVkIGZhbGxiYWNrIHN0cmF0ZWd5OiBjb2duaXRvOnVzZXJuYW1lIC0+IGVtYWlsIC0+IHN1YlxuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0gfHwgY2xhaW1zLmVtYWlsIHx8IGNsYWltcy5zdWI7XG5cbiAgICAgIC8vIFN0YW5kYXJkIHVzZXIgYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBDb2duaXRvIHVzZXIgYXR0cmlidXRlcylcbiAgICAgIGFjdG9yLmVtYWlsID0gY2xhaW1zLmVtYWlsO1xuICAgICAgYWN0b3IuZW1haWxWZXJpZmllZCA9IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IucGhvbmVOdW1iZXIgPSBjbGFpbXMucGhvbmVfbnVtYmVyO1xuICAgICAgYWN0b3IucGhvbmVWZXJpZmllZCA9IGNsYWltcy5waG9uZV9udW1iZXJfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLm5hbWUgPSBjbGFpbXMubmFtZTtcbiAgICAgIGFjdG9yLmxvY2FsZSA9IGNsYWltcy5sb2NhbGU7XG5cbiAgICAgIC8vIFBhcnNlIENvZ25pdG8gZ3JvdXBzIChkb2N1bWVudGVkIGFzIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcpXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLnBhcnNlR3JvdXBzKGNsYWltc1sgJ2NvZ25pdG86Z3JvdXBzJyBdKTtcblxuICAgICAgLy8gRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBwYXR0ZXJuOiBjdXN0b206KilcbiAgICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXMgPSB0aGlzLmV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltcyk7XG5cbiAgICAgIC8vIEJ1aWxkIENvZ25pdG8gY29udGV4dCB3aXRoIG9ubHkgZG9jdW1lbnRlZCBmaWVsZHNcbiAgICAgIGFjdG9yLmNvZ25pdG8gPSB7XG4gICAgICAgIHN1YjogY2xhaW1zLnN1YixcbiAgICAgICAgdXNlcm5hbWU6IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0sXG4gICAgICAgIGdyb3VwczogZ3JvdXBzLCAvLyBBbHdheXMgaW5jbHVkZSBncm91cHMgYXJyYXkgKGVtcHR5IG9yIHBvcHVsYXRlZClcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlczogT2JqZWN0LmtleXMoY3VzdG9tQXR0cmlidXRlcykubGVuZ3RoID4gMCA/IGN1c3RvbUF0dHJpYnV0ZXMgOiB1bmRlZmluZWRcbiAgICAgIH07XG5cbiAgICAgIC8vIEV4dHJhY3QgdGVuYW50IElEIGZyb20gY3VzdG9tIGF0dHJpYnV0ZXMgKGNvbW1vbiBtdWx0aS10ZW5hbnQgcGF0dGVybilcbiAgICAgIGFjdG9yLnRlbmFudElkID0gY3VzdG9tQXR0cmlidXRlcy50ZW5hbnRJZDtcblxuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignRXJyb3IgZXh0cmFjdGluZyBDb2duaXRvIGFjdG9yIGNvbnRleHQnLCB7IGVycm9yLCBjbGFpbXMgfSk7XG5cbiAgICAgIC8vIE1pbmltYWwgZmFsbGJhY2sgZXh0cmFjdGlvblxuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXMuc3ViIHx8ICd1bmtub3duJztcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSBDb2duaXRvIGdyb3VwcyBmcm9tIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcgKGRvY3VtZW50ZWQgQ29nbml0byBmb3JtYXQpXG4gICAqL1xuICBwcm90ZWN0ZWQgcGFyc2VHcm91cHMoZ3JvdXBzOiBhbnkpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHR5cGVvZiBncm91cHMgPT09ICdzdHJpbmcnICYmIGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZ3JvdXBzLnNwbGl0KCcsJykubWFwKGcgPT4gZy50cmltKCkpLmZpbHRlcihnID0+IGcubGVuZ3RoID4gMCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIHVzaW5nIGRvY3VtZW50ZWQgQ29nbml0byBwYXR0ZXJuIChjdXN0b206KilcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXM6IGFueSk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIE9iamVjdC5rZXlzKGNsYWltcykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGtleS5zdGFydHNXaXRoKCdjdXN0b206JykpIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGtleS5yZXBsYWNlKCdjdXN0b206JywgJycpO1xuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzWyBhdHRyaWJ1dGVOYW1lIF0gPSBjbGFpbXNbIGtleSBdO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGN1c3RvbUF0dHJpYnV0ZXM7XG4gIH1cblxuICAvKipcbiAqIEV4dHJhY3Qgc2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHQgLSBmb2N1c2VkIGFwcHJvYWNoXG4gKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICAvLyBTZXNzaW9uIGNvbnRleHRcbiAgICBhY3Rvci5zZXNzaW9uSWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtc2Vzc2lvbi1pZCcgXTtcblxuICAgIC8vIFRlbmFudCBjb250ZXh0IC0gY2hlY2sgY3VzdG9tIGF0dHJpYnV0ZXMgZmlyc3QsIHRoZW4gaGVhZGVycywgdGhlbiB3aGF0ZXZlciBhblxuICAgIC8vIGVhcmxpZXIgZXh0cmFjdGlvbiBzdGVwIGFscmVhZHkgc2V0IChlLmcuIG1lcmdlQ2xpZW50U3VwcGxpZWRBY3Rvcikg4oCUIG5ldmVyIGNsb2JiZXJcbiAgICAvLyBhIHZhbHVlIHdpdGggdW5kZWZpbmVkIGp1c3QgYmVjYXVzZSBuZWl0aGVyIG9mIHRoZXNlIHR3byBzb3VyY2VzIGhhcyBvbmUuXG4gICAgYWN0b3IudGVuYW50SWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtdGVuYW50LWlkJyBdIHx8XG4gICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zPy5bICdjdXN0b206dGVuYW50SWQnIF0gfHxcbiAgICAgIGFjdG9yLnRlbmFudElkO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQVBJIEtleSBjb250ZXh0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhcGkta2V5JztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG5cbiAgICBsZXQgYXBpS2V5SWQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlOiAncmVxdWVzdC1jb250ZXh0JyB8ICdoZWFkZXInO1xuXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5KSB7XG4gICAgICBhcGlLZXlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleUlkIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleTtcbiAgICAgIHNvdXJjZSA9ICdyZXF1ZXN0LWNvbnRleHQnO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcGlLZXlJZCA9IHJlcXVlc3QuaGVhZGVyc1sgJ3gtYXBpLWtleScgXSE7XG4gICAgICBzb3VyY2UgPSAnaGVhZGVyJztcbiAgICB9XG5cbiAgICBhY3Rvci5hY3RvcklkID0gYGFwaS1rZXk6JHthcGlLZXlJZH1gO1xuICAgIGFjdG9yLmFwaUtleSA9IHtcbiAgICAgIGlkOiBhcGlLZXlJZCxcbiAgICAgIHNvdXJjZTogc291cmNlLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBJQU0gY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RJYW1Db250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnaWFtJztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG4gICAgYWN0b3IuYWN0b3JJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fFxuICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8XG4gICAgICAndW5rbm93bi1pYW0tdXNlcic7XG5cbiAgICBhY3Rvci5pYW0gPSB7XG4gICAgICB1c2VyQXJuOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgdW5kZWZpbmVkLFxuICAgICAgdXNlcklkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgdW5kZWZpbmVkLFxuICAgICAgYWNjb3VudElkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFjY291bnRJZCB8fCB1bmRlZmluZWQsXG4gICAgICBjYWxsZXI6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uY2FsbGVyIHx8IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbGxzIGluIHRoZSBjYWxsaW5nIGVuZC11c2VyJ3MgaWRlbnRpdHkgZnJvbSBhbiBvcHRpb25hbCwgY2xpZW50LXN1cHBsaWVkXG4gICAqIGB4LWFjdG9yYCBoZWFkZXIsIGZvciBhdXRoIG1ldGhvZHMgdGhhdCBuZXZlciBleHBvc2UgaXQgc2VydmVyLXNpZGUuXG4gICAqXG4gICAqIFNpZ1Y0LXNpZ25lZCByZXF1ZXN0cyAoZS5nLiB2aWEgYSBDb2duaXRvIElkZW50aXR5IFBvb2wpIGF1dGhlbnRpY2F0ZSBhcyBhblxuICAgKiBhc3N1bWVkIElBTSByb2xlIOKAlCBgZXh0cmFjdElhbUNvbnRleHRgIG9ubHkgZXZlciBzZWVzIHRoYXQgcm9sZSdzIEFSTiwgd2hpY2ggaXNcbiAgICogdHlwaWNhbGx5IHNoYXJlZCBieSBldmVyeSB1c2VyIG9mIGFuIGFwcCwgbm90IHRoZSByZWFsIGVuZC11c2VyLiBUaGUgY2xpZW50XG4gICAqIHN0aWxsIGhvbGRzIHRoZSBhY3R1YWwgQ29nbml0byBJRCB0b2tlbiAodGhhdCdzIGhvdyBpdCBvYnRhaW5lZCBBV1MgY3JlZGVudGlhbHNcbiAgICogaW4gdGhlIGZpcnN0IHBsYWNlKSwgc28gaXQgY2FuIHNlbmQgYSBzbWFsbCBkZWNvZGVkIHN1bW1hcnkgb2YgaXQgaGVyZS5cbiAgICpcbiAgICogU0VDVVJJVFk6IHRoaXMgaXMgTkVWRVIgc2VydmVyLXZlcmlmaWVkIOKAlCBpdCdzIHdoYXRldmVyIEpTT04gdGhlIGNhbGxlciBzZW50LCBzb1xuICAgKiBpdCdzIG9ubHkgbWVyZ2VkIGZvciB0aGUgSUFNL2Fub255bW91cyBicmFuY2hlcyAobmV2ZXIgb3ZlcnJpZGVzIGEgQ29nbml0by1KV1QtXG4gICAqIGF1dGhvcml6ZXItZGVyaXZlZCBhY3RvcikuIEl0IGRlbGliZXJhdGVseSBkb2VzIE5PVCBvdmVyd3JpdGUgYGFjdG9yLmFjdG9ySWRgXG4gICAqICh3aGljaCBzdGF5cyB0aGUgYXV0aC12ZXJpZmllZCBJQU0gQVJOIC8gJ2Fub255bW91cycg4oCUIHRoZSB2YWx1ZVxuICAgKiBgYmFzZS1zZXJ2aWNlLnRzYCdzIGBjcmVhdGVkQnlgL2B1cGRhdGVkQnlgL2BkZWxldGVkQnlgL2B0ZW5hbnRJZGAgYXVkaXQgc3RhbXBpbmdcbiAgICogdHJ1c3RzKTsgaW5zdGVhZCBpdCdzIGV4cG9zZWQgb25seSB1bmRlciBgYWN0b3IuY2xpZW50U3VwcGxpZWRBY3RvcklkYCAvXG4gICAqIGBhY3Rvci5jbGllbnRTdXBwbGllZEFjdG9yID0gdHJ1ZWAsIHdoaWNoIGxvZyBzdGFtcGluZyAoYHNyYy9sb2dnaW5nL2luZGV4LnRzYClcbiAgICogcHJlZmVycyBmb3Igb2JzZXJ2YWJpbGl0eS4gSXQgbXVzdCBuZXZlciBiZSB1c2VkIGZvciBhdXRob3JpemF0aW9uIGRlY2lzaW9ucyBvclxuICAgKiBwZXJzaXN0ZWQgYXVkaXQgZmllbGRzIOKAlCBvYnNlcnZhYmlsaXR5IG9ubHkuIChCZWZvcmUgdGhpcyBleGlzdGVkLCBJQU0vYW5vbnltb3VzXG4gICAqIHJlcXVlc3RzIGNvdWxkIGFscmVhZHkgZm9yZ2UgYGFjdG9yLnRlbmFudElkYCB2aWEgdGhlIHByZS1leGlzdGluZyBgeC10ZW5hbnQtaWRgXG4gICAqIGhlYWRlciwgZm9yIGV2ZXJ5IGF1dGggbWV0aG9kLCBDb2duaXRvIGluY2x1ZGVkIOKAlCB0aGF0J3MgYSBzZXBhcmF0ZSwgcHJlLWV4aXN0aW5nXG4gICAqIGV4cG9zdXJlIHRoaXMgZG9lc24ndCBjaGFuZ2UgZWl0aGVyIHdheS4pXG4gICAqXG4gICAqIFJlYWRzIHRoZSByYXcgZXZlbnQgaGVhZGVycyAoY2FzZS1pbnNlbnNpdGl2ZSBrZXkgbWF0Y2gpIHJhdGhlciB0aGFuXG4gICAqIGByZXF1ZXN0LmhlYWRlcnNgLCB3aGljaCBsb3dlcmNhc2VzIGhlYWRlciBWQUxVRVMgdG9vIOKAlCB0aGF0IHdvdWxkIGNvcnJ1cHQgdGhlXG4gICAqIEpTT04gcGF5bG9hZCAobWl4ZWQtY2FzZSBpZHMvZW1haWxzKSB0aGlzIGhlYWRlciBuZWVkcyB0byBjYXJyeSBpbnRhY3QuXG4gICAqL1xuICBwcm90ZWN0ZWQgbWVyZ2VDbGllbnRTdXBwbGllZEFjdG9yKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGNvbnN0IHJhd0hlYWRlcnMgPSBldmVudC5oZWFkZXJzIHx8IHt9O1xuICAgIGNvbnN0IGhlYWRlcktleSA9IE9iamVjdC5rZXlzKHJhd0hlYWRlcnMpLmZpbmQoa2V5ID0+IGtleS50b0xvd2VyQ2FzZSgpID09PSAneC1hY3RvcicpO1xuICAgIGNvbnN0IHJhdyA9IGhlYWRlcktleSA/IHJhd0hlYWRlcnNbIGhlYWRlcktleSBdIDogdW5kZWZpbmVkO1xuICAgIGlmICh0eXBlb2YgcmF3ICE9PSAnc3RyaW5nJyB8fCAhcmF3LnRyaW0oKSkgcmV0dXJuO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcbiAgICAgIGlmICghcGFyc2VkIHx8IHR5cGVvZiBwYXJzZWQgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocGFyc2VkKSkgcmV0dXJuO1xuXG4gICAgICAvLyBpZCAodGhlIENvZ25pdG8gYHN1YmApIGlzIHRoZSBvbmUgcmVxdWlyZWQgZmllbGQg4oCUIGV2ZXJ5dGhpbmcgZWxzZSBpcyBiZXN0LWVmZm9ydC5cbiAgICAgIGNvbnN0IGlkID0gc2FuaXRpemVUcmFjZUlkKHR5cGVvZiBwYXJzZWQuaWQgPT09ICdzdHJpbmcnID8gcGFyc2VkLmlkIDogdW5kZWZpbmVkKTtcbiAgICAgIGlmICghaWQpIHJldHVybjtcblxuICAgICAgYWN0b3IuY2xpZW50U3VwcGxpZWRBY3RvcklkID0gaWQ7XG4gICAgICBhY3Rvci5jbGllbnRTdXBwbGllZEFjdG9yID0gdHJ1ZTtcbiAgICAgIC8vIFB1cmVseSBkZXNjcmlwdGl2ZS9vYnNlcnZhYmlsaXR5IG1ldGFkYXRhIChsaWtlIGVtYWlsL3VzZXJuYW1lIGJlbG93KSDigJQgbmV2ZXIgY29uc3VtZWRcbiAgICAgIC8vIGZvciBhdXRob3JpemF0aW9uIG9yIGF1ZGl0LXRyYWlsIHRydXN0IGRlY2lzaW9ucywgc28gc2FmZSB0byBzZXQgZnJvbSBjbGllbnQgaW5wdXQuXG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBpZiAodHlwZW9mIHBhcnNlZC5lbWFpbCA9PT0gJ3N0cmluZycgJiYgcGFyc2VkLmVtYWlsLnRyaW0oKSkgYWN0b3IuZW1haWwgPSBwYXJzZWQuZW1haWwudHJpbSgpO1xuICAgICAgaWYgKHR5cGVvZiBwYXJzZWQudXNlcm5hbWUgPT09ICdzdHJpbmcnICYmIHBhcnNlZC51c2VybmFtZS50cmltKCkpIGFjdG9yLm5hbWUgPSBwYXJzZWQudXNlcm5hbWUudHJpbSgpO1xuICAgICAgaWYgKHR5cGVvZiBwYXJzZWQudGVuYW50SWQgPT09ICdzdHJpbmcnICYmIHBhcnNlZC50ZW5hbnRJZC50cmltKCkpIGFjdG9yLnRlbmFudElkID0gcGFyc2VkLnRlbmFudElkLnRyaW0oKTtcbiAgICAgIGFjdG9yLmNvZ25pdG8gPSB7IC4uLmFjdG9yLmNvZ25pdG8sIHN1YjogaWQgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIG1hbGZvcm1lZCBoZWFkZXIg4oCUIGlnbm9yZSwgbmV2ZXIgdGhyb3cgZnJvbSBhY3RvciBleHRyYWN0aW9uXG4gICAgfVxuICB9XG59XG4iXX0=