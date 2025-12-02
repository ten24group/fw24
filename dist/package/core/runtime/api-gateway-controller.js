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
const observability_1 = require("../../observability");
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
        observability_1.ObservabilityManager.initializeInvocation();
        const request = await this.makeRequestContext(event, context);
        const response = await this.makeResponseContext(request);
        // Build the execution context
        const ctx = this.buildCtx(event, context, request, response);
        const traceContext = (0, observability_1.extractTraceContextFromHeaders)(request.headers || {});
        const correlationId = traceContext?.correlationId || request.requestId || crypto.randomUUID();
        const requestSpan = observability_1.SpanObserver.start(`HTTP ${request.httpMethod} ${request.path}`, {
            correlationId,
            parentSpanId: traceContext?.parentLogId,
            attributes: {
                'http.method': request.httpMethod,
                'http.path': request.path,
                'http.requestId': request.requestId,
            },
        });
        let spanEnded = false;
        const finalizeObservability = async (success, error) => {
            if (!spanEnded) {
                requestSpan.end({ success, error });
                spanEnded = true;
            }
            await observability_1.ObservabilityManager.flush();
        };
        ctx.observability = {
            correlationId: requestSpan.traceId,
            spanId: requestSpan.id,
            span: requestSpan,
        };
        // Find the matching route first for method-level audit config
        const route = this.findMatchingRoute(request);
        // Create audit context with route information for method-level config
        const auditContext = this.makeAuditContext(ctx, route);
        if (auditContext) {
            await this.captureStart(auditContext, this.buildRequestContext(ctx, auditContext.auditConfig));
        }
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
                await finalizeObservability(true);
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
            await finalizeObservability(false, errorObj);
            return this.handleException(request, errorObj, response);
        }
        // Fallback to the in-memory responseContext
        await finalizeObservability(true);
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
     * @param route - The matched route (optional, for method-level audit config)
     * @returns AuditContext or null if audit is disabled
     */
    makeAuditContext(ctx, route) {
        const config = this.getControllerConfig();
        // Merge controller-level and method-level audit configs
        const controllerAudit = config?.audit;
        const methodAudit = route?.audit;
        const mergedAuditConfig = this.mergeAuditConfigs(controllerAudit, methodAudit);
        if (!mergedAuditConfig?.enabled)
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
            category: mergedAuditConfig.category,
            actor: ctx.actor,
            correlation: {
                correlationId,
                operationId,
                parentOperationId: ctx.request.headers?.['x-parent-operation-id'],
                operationType: 'api',
                operationName,
                startTimestamp: new Date().toISOString()
            },
            auditConfig: mergedAuditConfig
        };
    }
    /**
     * Merges controller-level and method-level audit configurations
     * Method-level config takes precedence over controller-level config
     * @param controllerAudit - Controller-level audit config
     * @param methodAudit - Method-level audit config
     * @returns Merged audit configuration
     */
    mergeAuditConfigs(controllerAudit, methodAudit) {
        if (!controllerAudit && !methodAudit)
            return undefined;
        if (!controllerAudit)
            return methodAudit;
        if (!methodAudit)
            return controllerAudit;
        // Deep merge with method-level config taking precedence
        const merged = {
            ...controllerAudit,
            ...methodAudit
        };
        // Special handling for nested objects
        if (controllerAudit.includes || methodAudit.includes) {
            merged.includes = {
                ...controllerAudit.includes,
                ...methodAudit.includes
            };
            // Merge request and response arrays if both exist and are arrays
            if (controllerAudit.includes?.request && methodAudit.includes?.request) {
                const controllerRequest = Array.isArray(controllerAudit.includes.request) ? controllerAudit.includes.request : [];
                const methodRequest = Array.isArray(methodAudit.includes.request) ? methodAudit.includes.request : [];
                merged.includes.request = [...new Set([...controllerRequest, ...methodRequest])];
            }
            if (controllerAudit.includes?.response && methodAudit.includes?.response) {
                const controllerResponse = Array.isArray(controllerAudit.includes.response) ? controllerAudit.includes.response : [];
                const methodResponse = Array.isArray(methodAudit.includes.response) ? methodAudit.includes.response : [];
                merged.includes.response = [...new Set([...controllerResponse, ...methodResponse])];
            }
        }
        if (controllerAudit.dataProtection || methodAudit.dataProtection) {
            merged.dataProtection = {
                ...controllerAudit.dataProtection,
                ...methodAudit.dataProtection
            };
            // Merge deepRedact config
            if (controllerAudit.dataProtection?.deepRedact || methodAudit.dataProtection?.deepRedact) {
                merged.dataProtection.deepRedact = {
                    ...controllerAudit.dataProtection?.deepRedact,
                    ...methodAudit.dataProtection?.deepRedact
                };
                // Merge blacklistedKeys arrays
                if (controllerAudit.dataProtection?.deepRedact?.blacklistedKeys && methodAudit.dataProtection?.deepRedact?.blacklistedKeys) {
                    merged.dataProtection.deepRedact.blacklistedKeys = [
                        ...new Set([
                            ...controllerAudit.dataProtection.deepRedact.blacklistedKeys,
                            ...methodAudit.dataProtection.deepRedact.blacklistedKeys
                        ])
                    ];
                }
            }
        }
        if (controllerAudit.customContext || methodAudit.customContext) {
            merged.customContext = {
                ...controllerAudit.customContext,
                ...methodAudit.customContext
            };
        }
        return merged;
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
        const requestIncludes = auditConfig.includes?.request;
        // Determine what to include based on the configuration format
        let includeHeaders = false, includeBody = false, includeQuery = false;
        let headerFields = [], bodyFields = [], queryFields = [];
        if (Array.isArray(requestIncludes)) {
            // Legacy format: ['headers', 'body', 'query']
            includeHeaders = requestIncludes.includes('headers');
            includeBody = requestIncludes.includes('body');
            includeQuery = requestIncludes.includes('query');
        }
        else if (typeof requestIncludes === 'object' && requestIncludes !== null) {
            // New selective format: { headers: ['auth'], body: ['email'], query: ['page'] }
            includeHeaders = !!requestIncludes.headers;
            includeBody = !!requestIncludes.body;
            includeQuery = !!requestIncludes.query;
            headerFields = requestIncludes.headers || [];
            bodyFields = requestIncludes.body || [];
            queryFields = requestIncludes.query || [];
        }
        else if (requestIncludes === true) {
            // Boolean true - include headers by default (legacy behavior)
            includeHeaders = true;
        }
        return {
            method: ctx.request.httpMethod,
            path: ctx.request.path,
            userAgent: ctx.event.headers?.['user-agent'],
            sourceIp: ctx.event.requestContext?.identity?.sourceIp,
            headers: includeHeaders ?
                this.selectivelyIncludeFields(ctx.request.headers, headerFields) : undefined,
            body: includeBody ?
                this.selectivelyIncludeFields(ctx.request.body, bodyFields) : undefined,
            query: includeQuery ?
                this.selectivelyIncludeFields(ctx.request.queryStringParameters, queryFields) : undefined
        };
    }
    /**
     * Selectively includes fields from an object based on field list
     * If no fields specified, returns the entire object
     */
    selectivelyIncludeFields(obj, fields) {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }
        // If no specific fields requested, return entire object
        if (!fields.length) {
            return obj;
        }
        // Extract only specified fields
        const result = {};
        for (const field of fields) {
            if (obj.hasOwnProperty(field)) {
                result[field] = obj[field];
            }
        }
        return result;
    }
    /**
     * Selectively includes fields from response body (handles JSON string bodies)
     * If no fields specified, returns the entire body
     */
    selectivelyIncludeResponseBody(body, fields) {
        if (!body || typeof body !== 'string') {
            return body;
        }
        // If no specific fields requested, return entire body
        if (!fields.length) {
            return body;
        }
        try {
            // Try to parse as JSON
            const bodyObj = JSON.parse(body);
            if (typeof bodyObj === 'object' && bodyObj !== null) {
                // Apply field selection and stringify back
                const selected = this.selectivelyIncludeFields(bodyObj, fields);
                return JSON.stringify(selected);
            }
        }
        catch (error) {
            // Not valid JSON, return as-is
        }
        return body;
    }
    /**
     * Builds response context for audit logging
     */
    buildResponseContext(response, auditConfig) {
        const responseIncludes = auditConfig.includes?.response;
        if (!responseIncludes)
            return undefined;
        // Determine what to include based on the configuration format
        let includeHeaders = false, includeBody = false;
        let headerFields = [], bodyFields = [];
        if (Array.isArray(responseIncludes)) {
            // Legacy format: ['headers', 'body']
            includeHeaders = responseIncludes.includes('headers');
            includeBody = responseIncludes.includes('body');
        }
        else if (typeof responseIncludes === 'object' && responseIncludes !== null) {
            // New selective format: { headers: ['content-type'], body: ['id', 'status'] }
            includeHeaders = !!responseIncludes.headers;
            includeBody = !!responseIncludes.body;
            headerFields = responseIncludes.headers || [];
            bodyFields = responseIncludes.body || [];
        }
        else if (responseIncludes === true) {
            // Boolean true - include headers by default (legacy behavior)
            includeHeaders = true;
        }
        return {
            statusCode: response.statusCode,
            headers: includeHeaders ?
                this.selectivelyIncludeFields(response.headers, headerFields) : undefined,
            body: includeBody ?
                this.selectivelyIncludeResponseBody(response.body, bodyFields) : undefined
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUF5REEsNENBeUJDO0FBaEZELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFHakgscUVBQXdFO0FBQ3hFLHVEQUF5RztBQVd6RywrQkFBK0I7QUFDL0IsTUFBTSxpQkFBaUIsR0FBaUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztBQUUzRCxNQUFNLGFBQWEsR0FBRyxDQUFDLFVBQW1DLEVBQUUsRUFBRTtJQUNuRSxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDcEMsQ0FBQyxDQUFBO0FBRlksUUFBQSxhQUFhLGlCQUV6QjtBQUNNLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxFQUFFO0lBQ25DLGlCQUFpQixDQUFDLEtBQUssRUFBRSxDQUFDO0FBQzVCLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FDOUIsT0FJcUIsRUFDckIsT0FBcUY7SUFHckYsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxZQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUd2RSxJQUFNLG9CQUFvQixHQUExQixNQUFNLG9CQUFvQjtRQUVsQixBQUFOLEtBQUssQ0FBQyxhQUFhO1lBQ2pCLHNEQUFzRDtRQUN4RCxDQUFDO0tBQ0YsQ0FBQTtJQUhPO1FBREwsTUFBTSxDQUFDLElBQUksQ0FBQzs2REFHWjtJQUpH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QUFRLEVBQUUsSUFBSSxJQUFJLFNBQVM7WUFDekQsU0FBUyxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLFNBQVMsSUFBSSxTQUFTO1lBQ2pFLE1BQU0sRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxNQUFNLElBQUksU0FBUztTQUM1RCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBNTRCRCxzQ0E0NEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBBUElHYXRld2F5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgdHlwZSB7IFJlcXVlc3QsIFJlc3BvbnNlLCBSb3V0ZSB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBJQ29udHJvbGxlckNvbmZpZyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzXCI7XG5pbXBvcnQgeyBHZXQsIFJvdXRlTWV0aG9kcyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzL21ldGhvZFwiO1xuaW1wb3J0IHsgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgeyBpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUsIGlzSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uL3V0aWxzXCI7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHsgUmVxdWVzdENvbnRleHQgfSBmcm9tIFwiLi9yZXF1ZXN0LWNvbnRleHRcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29udGV4dCB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbnRleHRcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29uZmlnLCBtZXJnZVJlc3BvbnNlQ29uZmlnIH0gZnJvbSBcIi4vcmVzcG9uc2UtY29uZmlnXCI7XG5pbXBvcnQgeyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IsIEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IsIGNyZWF0ZUVycm9ySGFuZGxlciB9IGZyb20gXCIuLi8uLi9lcnJvcnMvXCI7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gJy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEF1ZGl0Q29udGV4dCwgUmVxdWVzdEF1ZGl0Q29udGV4dCwgQXVkaXRDb25maWcgfSBmcm9tICcuLi8uLi9hdWRpdC9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0Q2FwdHVyZVNlcnZpY2UgfSBmcm9tICcuLi8uLi9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMnO1xuaW1wb3J0IHsgZXh0cmFjdFRyYWNlQ29udGV4dEZyb21IZWFkZXJzLCBPYnNlcnZhYmlsaXR5TWFuYWdlciwgU3Bhbk9ic2VydmVyIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5cbmV4cG9ydCB0eXBlIENvbnRyb2xsZXJFcnJvckhhbmRsZXIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVFcnJvckhhbmRsZXI+O1xuXG4vLyBOZXcgaW50ZXJmYWNlcyBmb3IgbWlkZGxld2FyZSBhbmQgZXJyb3IgaGFuZGxpbmdcbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlck1pZGRsZXdhcmUge1xuICBiZWZvcmU/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBhZnRlcj86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIG9uRXJyb3I/OiAoZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG59XG5cbi8vIEdsb2JhbCBtaWRkbGV3YXJlIG1hbmFnZW1lbnRcbmNvbnN0IGdsb2JhbE1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuXG5leHBvcnQgY29uc3QgdXNlTWlkZGxld2FyZSA9IChtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5hZGQobWlkZGxld2FyZSk7XG59XG5leHBvcnQgY29uc3QgY2xlYXJNaWRkbGV3YXJlcyA9ICgpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMuY2xlYXIoKTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIEFQSSBoYW5kbGVyIHdpdGhvdXQgZGVmaW5pbmcgYSBjbGFzc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGV4cG9ydCBjb25zdCB7IGhhbmRsZXIsIGRlc2NyaXB0b3IgfSA9IGNyZWF0ZUFwaUhhbmRsZXIoXG4gKiAgeyBtZXRob2Q6IEdldCwgbmFtZTogJ2RlbW8nLCBhdXRob3JpemVyOiAnTk9ORScgfSxcbiAqICAgYXN5bmMgKCBldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAqICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICogICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAqICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiSGVsbG8gV29ybGQhXCJ9KVxuICogICAgICAgfSlcbiAqICAgfVxuICogKVxuICogYGBgXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5uYW1lIC0gVGhlIG5hbWUgb2YgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMucGF0aCAtIFRoZSBwYXRoIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5tZXRob2QgLSBUaGUgSFRUUCBtZXRob2QgZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBoYW5kbGVyIGZ1bmN0aW9uIGFuZCB0aGUgY29udHJvbGxlciBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXBpSGFuZGxlcihcbiAgb3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwYXRoPzogc3RyaW5nLFxuICAgIG1ldGhvZD86IFJvdXRlTWV0aG9kcyxcbiAgfSAmIElDb250cm9sbGVyQ29uZmlnLFxuICBoYW5kbGVyOiAoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCkgPT4gUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+LFxuKSB7XG5cbiAgY29uc3QgeyBuYW1lLCBwYXRoID0gJycsIG1ldGhvZCA9IEdldCwgLi4uY29udHJvbGxlckNvbmZpZyB9ID0gb3B0aW9ucztcblxuICBAQ29udHJvbGxlcihuYW1lLCB7IC4uLmNvbnRyb2xsZXJDb25maWcsIGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyOiBmYWxzZSB9KVxuICBjbGFzcyBDb250cm9sbGVyRGVzY3JpcHRvciB7XG4gICAgQG1ldGhvZChwYXRoKVxuICAgIGFzeW5jIGlubGluZUhhbmRsZXIoKSB7XG4gICAgICAvLyBwbGFjZWhvbGRlciBmdW5jdGlvbiBvbmx5IHVzZWQgZm9yIHJvdXRpbmcgbWV0YWRhdGFcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaGFuZGxlciwgJ25hbWUnLCB7IHZhbHVlOiAnaGFuZGxlcicgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBoYW5kbGVyLFxuICAgIGRlc2NyaXB0b3I6IENvbnRyb2xsZXJEZXNjcmlwdG9yXG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlckNvbmZpZyB7XG4gIHJlc3BvbnNlQ29uZmlnPzogUGFydGlhbDxSZXNwb25zZUNvbmZpZz47XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUElDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcHJvdGVjdGVkIG1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuICBwcm90ZWN0ZWQgcmVzcG9uc2VDb25maWc6IFJlc3BvbnNlQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogQVBJQ29udHJvbGxlckNvbmZpZyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQ29uZmlnID0gbWVyZ2VSZXNwb25zZUNvbmZpZyhjb25maWcucmVzcG9uc2VDb25maWcpO1xuICB9XG5cbiAgLyoqXG4gICAqIGNhbiBiZSB1c2VkIHRvIHJ1biBzb21lIGxvZ2ljIGp1c3QgYmVmb3JlIHRoZSByZXF1ZXN0IGlzIHByb2Nlc3NlZCBsaWtlIGNyZWF0aW5nIGNsaWVudHMsIGRpLWluamVjdGlvbiBhbnMgc28gb24uXG4gICAqIEBwYXJhbSBfZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gX2NvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGNvbnRyb2xsZXIgaXMgaW5pdGlhbGl6ZWQuXG4gICovXG4gIHByb3RlY3RlZCBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vLW9wIGZvciBBUEkgY29udHJvbGxlcnNcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgfVxuXG4gIC8vIEFkZCBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBtZXRob2RcbiAgcHJvdGVjdGVkIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpIHtcbiAgICB0aGlzLm1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpIHtcbiAgICByZXR1cm4gWyAuLi5BcnJheS5mcm9tKGdsb2JhbE1pZGRsZXdhcmVzKSwgLi4uQXJyYXkuZnJvbSh0aGlzLm1pZGRsZXdhcmVzKSBdO1xuICB9XG5cbiAgLy8gRXhlY3V0ZSBtaWRkbGV3YXJlIHBpcGVsaW5lXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShcbiAgICBwaGFzZTogJ2JlZm9yZScgfCAnYWZ0ZXInIHwgJ29uRXJyb3InLFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsXG4gICAgZXJyb3I/OiBFcnJvclxuICApOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGFsbE1pZGRsZXdhcmVzID0gdGhpcy5nZXRNaWRkbGV3YXJlcygpO1xuXG4gICAgZm9yIChjb25zdCBtaWRkbGV3YXJlIG9mIGFsbE1pZGRsZXdhcmVzKSB7XG4gICAgICBpZiAocGhhc2UgPT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlLm9uRXJyb3IgJiYgZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZS5vbkVycm9yKGVycm9yLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH0gZWxzZSBpZiAocGhhc2UgIT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlWyBwaGFzZSBdKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmVbIHBoYXNlIF0hKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfVxuICAgIH1cblxuICB9XG5cbiAgYXN5bmMgdmFsaWRhdGUocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QsIHZhbGlkYXRpb25zOiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgIGxldCB2YWxpZGF0aW9uUnVsZXM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB2YWxpZGF0aW9ucztcbiAgICBpZiAoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zKSkge1xuICAgICAgaWYgKFsgJ0dFVCcsICdERUxFVEUnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgcXVlcnk6IHZhbGlkYXRpb25zIH1cblxuICAgICAgfSBlbHNlIGlmIChbICdQT1NUJywgJ1BVVCcsICdQQVRDSCcgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBib2R5OiB2YWxpZGF0aW9ucyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvblJ1bGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IodmFsaWRhdGlvblJ1bGVzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7XG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHZhbGlkYXRpb25zOiB2YWxpZGF0aW9uUnVsZXMsXG4gICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLFxuICAgICAgdmVyYm9zZUVycm9yczogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IHRoaXMuZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPFJlcXVlc3Q+IHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZUNvbnRleHQoe1xuICAgICAgdHJhY2VJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgcmVxdWVzdElkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICBkZWJ1Z01vZGU6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIHJvdXRlOiByZXF1ZXN0Q29udGV4dC5wYXRoLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50JyxcbiAgICAgIGNvbmZpZzogdGhpcy5yZXNwb25zZUNvbmZpZ1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgY29udHJvbGxlci5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBBUEkgR2F0ZXdheSBldmVudHMuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgQVBJIEdhdGV3YXkgcmVzcG9uc2Ugb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcblxuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuXG4gICAgLy8gQnVpbGQgdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4ID0gdGhpcy5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuXG4gICAgY29uc3QgdHJhY2VDb250ZXh0ID0gZXh0cmFjdFRyYWNlQ29udGV4dEZyb21IZWFkZXJzKHJlcXVlc3QuaGVhZGVycyB8fCB7fSk7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHRyYWNlQ29udGV4dD8uY29ycmVsYXRpb25JZCB8fCByZXF1ZXN0LnJlcXVlc3RJZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpO1xuICAgIGNvbnN0IHJlcXVlc3RTcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KGBIVFRQICR7cmVxdWVzdC5odHRwTWV0aG9kfSAke3JlcXVlc3QucGF0aH1gLCB7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgcGFyZW50U3BhbklkOiB0cmFjZUNvbnRleHQ/LnBhcmVudExvZ0lkLFxuICAgICAgXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICdodHRwLm1ldGhvZCc6IHJlcXVlc3QuaHR0cE1ldGhvZCxcbiAgICAgICAgJ2h0dHAucGF0aCc6IHJlcXVlc3QucGF0aCxcbiAgICAgICAgJ2h0dHAucmVxdWVzdElkJzogcmVxdWVzdC5yZXF1ZXN0SWQsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGxldCBzcGFuRW5kZWQgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5hbGl6ZU9ic2VydmFiaWxpdHkgPSBhc3luYyAoc3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBFcnJvcikgPT4ge1xuICAgICAgaWYgKCFzcGFuRW5kZWQpIHtcbiAgICAgICAgcmVxdWVzdFNwYW4uZW5kKHsgc3VjY2VzcywgZXJyb3IgfSk7XG4gICAgICAgIHNwYW5FbmRlZCA9IHRydWU7XG4gICAgICB9XG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH07XG5cbiAgICBjdHgub2JzZXJ2YWJpbGl0eSA9IHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHJlcXVlc3RTcGFuLnRyYWNlSWQsXG4gICAgICBzcGFuSWQ6IHJlcXVlc3RTcGFuLmlkLFxuICAgICAgc3BhbjogcmVxdWVzdFNwYW4sXG4gICAgfTtcblxuICAgIC8vIEZpbmQgdGhlIG1hdGNoaW5nIHJvdXRlIGZpcnN0IGZvciBtZXRob2QtbGV2ZWwgYXVkaXQgY29uZmlnXG4gICAgY29uc3Qgcm91dGUgPSB0aGlzLmZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpO1xuXG4gICAgLy8gQ3JlYXRlIGF1ZGl0IGNvbnRleHQgd2l0aCByb3V0ZSBpbmZvcm1hdGlvbiBmb3IgbWV0aG9kLWxldmVsIGNvbmZpZ1xuICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IHRoaXMubWFrZUF1ZGl0Q29udGV4dChjdHgsIHJvdXRlKTtcblxuICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgdGhpcy5idWlsZFJlcXVlc3RDb250ZXh0KGN0eCwgYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnKSk7XG4gICAgfVxuXG4gICAgdHJ5IHtcblxuICAgICAgLy8gTGVnYWN5IGluaXRpYWxpemUgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBFeGVjdXRlIGJlZm9yZSBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2JlZm9yZScsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAvLyBWYWxpZGF0ZSB0aGUgcmVxdWVzdCBpZiB2YWxpZGF0aW9ucyBhcmUgZGVmaW5lZFxuICAgICAgaWYgKHJvdXRlPy52YWxpZGF0aW9ucykge1xuICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy52YWxpZGF0ZShyZXF1ZXN0LCByb3V0ZS52YWxpZGF0aW9ucyk7XG4gICAgICAgIGlmICghdmFsaWRhdGlvblJlc3VsdC5wYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFZhbGlkYXRpb25GYWlsZWRFcnJvcih2YWxpZGF0aW9uUmVzdWx0LmVycm9ycyk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gY2FsbCB0aGUgcm91dGUgZnVuY3Rpb25cbiAgICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzLmdldFJvdXRlRnVuY3Rpb24ocm91dGUpO1xuICAgICAgbGV0IGNvbnRyb2xsZXJSZXNwb25zZTogYW55ID0gcm91dGVGdW5jdGlvbi5jYWxsKHRoaXMsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgaWYgKGNvbnRyb2xsZXJSZXNwb25zZSBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgY29udHJvbGxlclJlc3BvbnNlID0gYXdhaXQgY29udHJvbGxlclJlc3BvbnNlO1xuICAgICAgfVxuXG4gICAgICAvLyBFeGVjdXRlIGFmdGVyIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYWZ0ZXInLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgLy8gQ2FwdHVyZSBzdWNjZXNzZnVsIHJlc3BvbnNlXG4gICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIHJlc3BvbnNlLCBudWxsKTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgdGhlIGNvbnRyb2xsZXIgcmV0dXJuZWQgYW55dGhpbmcgKFJlc3BvbnNlQ29udGV4dCBvciByYXcgQVBJIHJlc3VsdCksIGVtaXQgdGhhdFxuICAgICAgaWYgKGNvbnRyb2xsZXJSZXNwb25zZSAhPSBudWxsKSB7XG4gICAgICAgIGF3YWl0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eSh0cnVlKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoY29udHJvbGxlclJlc3BvbnNlKTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycikge1xuXG4gICAgICBjb25zdCBlcnJvck9iaiA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKTtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdMYW1iZGFIYW5kbGVyIGVycm9yOiAnLCBlcnJvck9iaik7XG5cbiAgICAgIC8vIEV4ZWN1dGUgZXJyb3IgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdvbkVycm9yJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3JPYmopO1xuXG4gICAgICAvLyBDYXB0dXJlIGVycm9yIHJlc3BvbnNlXG4gICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIHJlc3BvbnNlLCBlcnJvck9iaik7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eShmYWxzZSwgZXJyb3JPYmopO1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRXhjZXB0aW9uKHJlcXVlc3QsIGVycm9yT2JqLCByZXNwb25zZSk7XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2sgdG8gdGhlIGluLW1lbW9yeSByZXNwb25zZUNvbnRleHRcbiAgICBhd2FpdCBmaW5hbGl6ZU9ic2VydmFiaWxpdHkodHJ1ZSk7XG4gICAgcmV0dXJuIHJlc3BvbnNlLmJ1aWxkKCk7XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHJvdXRlIHRoYXQgbWF0Y2hlcyB0aGUgSFRUUCBtZXRob2QgYW5kIHJlc291cmNlLlxuICAgKiBAcGFyYW0gcmVxdWVzdERhdGEgLSBUaGUgcmVxdWVzdCBkYXRhIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIG1hdGNoaW5nIHJvdXRlIG9yIG51bGwgaWYgbm90IGZvdW5kLlxuICAgKi9cbiAgcHJpdmF0ZSBmaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCk6IFJvdXRlIHwgbnVsbCB7XG4gICAgbGV0IGNvbnRyb2xsZXI6IGFueSA9IHRoaXM7XG5cbiAgICAvLyBEZXRlcm1pbmUgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGJ5IGZpbmRpbmcgdGhlIGxvbmdlc3QgY29tbW9uIHByZWZpeCB0aGF0IGVuZHMgd2l0aCB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgbGV0IGNvbnRyb2xsZXJCYXNlUGF0aCA9IGAvJHtjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lfWA7XG4gICAgbGV0IHJlc291cmNlV2l0aG91dFJvb3QgPSAnLyc7XG5cbiAgICAvLyBGb3IgY29udHJvbGxlcnMgaW4gc3ViZGlyZWN0b3JpZXMsIHdlIG5lZWQgdG8gbWF0Y2ggdGhlIGFjdHVhbCByZXNvdXJjZSBwYXRoXG4gICAgLy8gQ2hlY2sgaWYgcmVzb3VyY2UgY29udGFpbnMgdGhlIGNvbnRyb2xsZXIgbmFtZSBhcyBwYXJ0IG9mIGEgbG9uZ2VyIHBhdGhcbiAgICBjb25zdCByZXNvdXJjZVBhcnRzID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgY29udHJvbGxlck5hbWVQYXJ0cyA9IGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAvLyBGaW5kIGlmIHRoZSBjb250cm9sbGVyIG5hbWUgcGFydHMgYXJlIHByZXNlbnQgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICBsZXQgYmFzZVBhdGhFbmRJbmRleCA9IC0xO1xuICAgIGlmIChjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIExvb2sgZm9yIHRoZSBjb250cm9sbGVyIG5hbWUgc2VxdWVuY2UgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHJlc291cmNlUGFydHMubGVuZ3RoIC0gY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBsZXQgbWF0Y2hlcyA9IHRydWU7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIGlmIChyZXNvdXJjZVBhcnRzWyBpICsgaiBdICE9PSBjb250cm9sbGVyTmFtZVBhcnRzWyBqIF0pIHtcbiAgICAgICAgICAgIG1hdGNoZXMgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIGJhc2VQYXRoRW5kSW5kZXggPSBpICsgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggLSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGJhc2VQYXRoRW5kSW5kZXggPj0gMCkge1xuICAgICAgLy8gRm91bmQgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGluIHRoZSByZXNvdXJjZVxuICAgICAgY29uc3QgYmFzZVBhdGhQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoMCwgYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgY29udHJvbGxlckJhc2VQYXRoID0gJy8nICsgYmFzZVBhdGhQYXJ0cy5qb2luKCcvJyk7XG4gICAgICBjb25zdCByZW1haW5pbmdQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlbWFpbmluZ1BhcnRzLmxlbmd0aCA+IDAgPyAnLycgKyByZW1haW5pbmdQYXJ0cy5qb2luKCcvJykgOiAnLyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG9yaWdpbmFsIGxvZ2ljIGZvciBzaW1wbGUgY2FzZXNcbiAgICAgIGlmIChyZXF1ZXN0RGF0YS5yZXNvdXJjZS5zdGFydHNXaXRoKGNvbnRyb2xsZXJCYXNlUGF0aCkpIHtcbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3REYXRhLnJlc291cmNlLnN1YnN0cmluZyhjb250cm9sbGVyQmFzZVBhdGgubGVuZ3RoKSB8fCAnLyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2VwYXJhdGUgcm91dGVzIGludG8gZXhhY3QgYW5kIHBhcmFtZXRlcml6ZWQgZm9yIHByb3BlciBwcmlvcml0aXphdGlvblxuICAgIGNvbnN0IGV4YWN0TWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcbiAgICBjb25zdCBwYXJhbWV0ZXJpemVkTWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcblxuICAgIC8vIEZpcnN0IHBhc3M6IGNhdGVnb3JpemUgcm91dGVzIGJ5IHR5cGUgYW5kIG1ldGhvZFxuICAgIGZvciAoY29uc3QgWyByb3V0ZUtleSwgcm91dGUgXSBvZiBPYmplY3QuZW50cmllcyhjb250cm9sbGVyLnJvdXRlcyB8fCB7fSkgYXMgWyBzdHJpbmcsIFJvdXRlIF1bXSkge1xuICAgICAgY29uc3QgWyByb3V0ZU1ldGhvZCwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICAvLyBTa2lwIGlmIEhUVFAgbWV0aG9kIGRvZXNuJ3QgbWF0Y2hcbiAgICAgIGlmIChyb3V0ZU1ldGhvZCAhPT0gcmVxdWVzdERhdGEuaHR0cE1ldGhvZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2F0ZWdvcml6ZSByb3V0ZSB0eXBlXG4gICAgICBpZiAocm91dGVQYXRoLmluY2x1ZGVzKCd7JykgJiYgcm91dGVQYXRoLmluY2x1ZGVzKCd9JykpIHtcbiAgICAgICAgcGFyYW1ldGVyaXplZE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4YWN0TWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlY29uZCBwYXNzOiBUcnkgZXhhY3QgbWF0Y2hlcyBmaXJzdCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlIH0gb2YgZXhhY3RNYXRjaGVzKSB7XG4gICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICBpZiAocm91dGVQYXRoID09PSByZXNvdXJjZVdpdGhvdXRSb290KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3VuZCBleGFjdCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCk7XG4gICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUaGlyZCBwYXNzOiBUcnkgcGFyYW1ldGVyaXplZCBtYXRjaGVzIChzb3J0ZWQgYnkgc3BlY2lmaWNpdHkpXG4gICAgLy8gU29ydCBwYXJhbWV0ZXJpemVkIHJvdXRlcyBieSBzcGVjaWZpY2l0eSAobW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHByaW9yaXR5KVxuICAgIGNvbnN0IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzID0gcGFyYW1ldGVyaXplZE1hdGNoZXNcbiAgICAgIC5tYXAoKHsgcm91dGVLZXksIHJvdXRlIH0pID0+IHtcbiAgICAgICAgY29uc3QgWyAsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcbiAgICAgICAgY29uc3Qgc2VnbWVudHMgPSByb3V0ZVBhdGguc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgIGNvbnN0IGxpdGVyYWxTZWdtZW50cyA9IHNlZ21lbnRzLmZpbHRlcihzZWdtZW50ID0+ICFzZWdtZW50LmluY2x1ZGVzKCd7JykpO1xuXG4gICAgICAgIC8vIFNwZWNpZmljaXR5IHNjb3JlOiBtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmVcbiAgICAgICAgLy8gRm9yIGVxdWFsIGxpdGVyYWwgc2VnbWVudHMsIGZld2VyIHRvdGFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlICBcbiAgICAgICAgY29uc3Qgc3BlY2lmaWNpdHlTY29yZSA9IChsaXRlcmFsU2VnbWVudHMubGVuZ3RoICogMTAwMCkgLSBzZWdtZW50cy5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGgsIHNwZWNpZmljaXR5U2NvcmUgfTtcbiAgICAgIH0pXG4gICAgICAuc29ydCgoYSwgYikgPT4gYi5zcGVjaWZpY2l0eVNjb3JlIC0gYS5zcGVjaWZpY2l0eVNjb3JlKTsgLy8gSGlnaGVyIHNjb3JlIGZpcnN0XG5cbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGggfSBvZiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcykge1xuICAgICAgLy8gQ29udmVydCBmcmFtZXdvcmsge2lkfSBzeW50YXggdG8gcGF0aC10by1yZWdleHAgOmlkIHN5bnRheFxuICAgICAgY29uc3QgcGF0aFRvUmVnZXhwUGF0dGVybiA9IHJvdXRlUGF0aC5yZXBsYWNlKC9cXHsoW159XSspXFx9L2csICc6JDEnKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gVXNlIHBhdGgtdG8tcmVnZXhwIGZvciBwcm9wZXIgcGFyYW1ldGVyIG1hdGNoaW5nXG4gICAgICAgIGNvbnN0IHsgbWF0Y2ggfSA9IHJlcXVpcmUoJ3BhdGgtdG8tcmVnZXhwJyk7XG4gICAgICAgIGNvbnN0IG1hdGNoZXIgPSBtYXRjaChwYXRoVG9SZWdleHBQYXR0ZXJuLCB7IGRlY29kZTogZGVjb2RlVVJJQ29tcG9uZW50IH0pO1xuICAgICAgICBjb25zdCBtYXRjaFJlc3VsdCA9IG1hdGNoZXIocmVzb3VyY2VXaXRob3V0Um9vdCk7XG5cbiAgICAgICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIHBhcmFtZXRlcml6ZWQgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWAsIHtcbiAgICAgICAgICAgIHBhdHRlcm46IHBhdGhUb1JlZ2V4cFBhdHRlcm4sXG4gICAgICAgICAgICBwYXJhbXM6IG1hdGNoUmVzdWx0LnBhcmFtcyxcbiAgICAgICAgICAgIHNwZWNpZmljaXR5U2NvcmU6IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzLmZpbmQobSA9PiBtLnJvdXRlS2V5ID09PSByb3V0ZUtleSk/LnNwZWNpZmljaXR5U2NvcmVcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIE5vdGU6IFdlIGRvbid0IG5lZWQgdG8gbWFudWFsbHkgZXh0cmFjdCBwYXJhbWV0ZXJzIHNpbmNlIEFQSSBHYXRld2F5XG4gICAgICAgICAgLy8gYWxyZWFkeSBwcm92aWRlcyB0aGVtIGluIHJlcXVlc3REYXRhLnBhdGhQYXJhbWV0ZXJzXG4gICAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFcnJvciBtYXRjaGluZyByb3V0ZSBwYXR0ZXJuICR7cGF0aFRvUmVnZXhwUGF0dGVybn06YCwgZXJyb3IpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBtYXRjaGluZyByb3V0ZSBmb3VuZCBmb3IgJHtyZXF1ZXN0RGF0YS5odHRwTWV0aG9kfXwke3Jlc291cmNlV2l0aG91dFJvb3R9YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKiBAcGFyYW0gcm91dGUgLSBUaGUgbWF0Y2hlZCByb3V0ZS5cbiAgICogQHJldHVybnMgVGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqL1xuICBwcml2YXRlIGdldFJvdXRlRnVuY3Rpb24ocm91dGU6IFJvdXRlIHwgbnVsbCk6IEZ1bmN0aW9uIHtcbiAgICBpZiAoIXJvdXRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICAgIH1cblxuICAgIC8vQHRzLWlnbm9yZVxuICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzWyByb3V0ZS5mdW5jdGlvbk5hbWUgXTtcblxuICAgIHJldHVybiB0eXBlb2Ygcm91dGVGdW5jdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gcm91dGVGdW5jdGlvbiA6IHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIHRoZSBOb3RGb3VuZCByb3V0ZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDQwNCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVOb3RGb3VuZChfcmVxOiBSZXF1ZXN0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZSh7XG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiTm8gUm91dGUgRm91bmQhXCIgfSksXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZXJyb3JIYW5kbGVyPzogQ29udHJvbGxlckVycm9ySGFuZGxlcjtcbiAgcHJvdGVjdGVkIGdldEVycm9ySGFuZGxlcigpOiBDb250cm9sbGVyRXJyb3JIYW5kbGVyIHtcbiAgICBpZiAoIXRoaXMuZXJyb3JIYW5kbGVyKSB7XG4gICAgICB0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcigpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5lcnJvckhhbmRsZXI7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBleGNlcHRpb25zIGFuZCByZXR1cm5zIGEgSlNPTiByZXNwb25zZSB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHBhcmFtIGVyciAtIFRoZSBlcnJvciBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDUwMCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVFeGNlcHRpb24ocmVxOiBSZXF1ZXN0LCBlcnI6IEVycm9yLCByZXM6IFJlc3BvbnNlKTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlID0gdGhpcy5nZXRFcnJvckhhbmRsZXIoKShlcnIsIHJlcSwgcmVzKTtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShlcnJvclJlc3BvbnNlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBoYW5kbGVSZXNwb25zZShyZXM6IFJlc3BvbnNlIHwgQVBJR2F0ZXdheVByb3h5UmVzdWx0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBpZiAocmVzIGluc3RhbmNlb2YgUmVzcG9uc2VDb250ZXh0KSB7XG4gICAgICByZXR1cm4gcmVzLmJ1aWxkKCk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGVjdXRpb24gY29udGV4dCBmb3IgdGhlIHJlcXVlc3RcbiAgICogXG4gICAqIGRpZmZlcmVudCBtaWRkbGV3YXJlIGNhbiBlbmhhbmNlIHRoZSBhY3RvciBjb250ZXh0IGJ5IHVzaW5nIHRoZSBlbmhhbmNlQWN0b3IgbWV0aG9kXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlID0ge1xuICAgKiAgYmVmb3JlOiBhc3luYyAoX3JlcXVlc3QsIF9yZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgY3R4Py5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICByb2xlczogWydhZG1pbicsICd1c2VyJ10sXG4gICAqICAgICBwZXJtaXNzaW9uczogWydyZWFkJywgJ3dyaXRlJ10sXG4gICAqICAgICBzdWJzY3JpcHRpb246IHsgdGllcjogJ2VudGVycHJpc2UnIH1cbiAgICogICB9KTtcbiAgICogIH1cbiAgICogfVxuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmUpO1xuICAgKiBcbiAgICogT1JcbiAgICogXG4gICAqIGNvbnN0IHNlY3VyaXR5TWlkZGxld2FyZSA9IHtcbiAgICogICBiZWZvcmU6IGFzeW5jIChyZXF1ZXN0LCByZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgICBjdHguZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgICByaXNrUHJvZmlsZTogYXdhaXQgYXNzZXNzUmlzayhjdHguYWN0b3IuYWN0b3JJZCksXG4gICAqICAgICAgIGRldmljZTogYXdhaXQgbWFrZURldmljZUNvbnRleHQocmVxdWVzdClcbiAgICogICAgIH0pO1xuICAgKiAgIH1cbiAgICogfTtcbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShzZWN1cml0eU1pZGRsZXdhcmUpO1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgXG4gICAqIEBwYXJhbSBjb250ZXh0IFxuICAgKiBAcGFyYW0gcmVxdWVzdCBcbiAgICogQHBhcmFtIHJlc3BvbnNlIFxuICAgKiBAcmV0dXJucyBcbiAgICovXG4gIHByb3RlY3RlZCBidWlsZEN0eChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgICBjb25zdCBhY3RvciA9IHRoaXMuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICBjb25zdCBjdHg6IEV4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICBldmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBhY3RvcixcbiAgICAgIGRlYnVnSW5mbzoge30sXG5cbiAgICAgIC8vIFNpbXBsZSBhY3RvciBlbmhhbmNlbWVudCBtZXRob2RcbiAgICAgIGVuaGFuY2VBY3RvcjogKGVuaGFuY2VtZW50OiBQYXJ0aWFsPEFjdG9yPikgPT4ge1xuICAgICAgICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIGVuaGFuY2VtZW50KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gY3R4O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYXVkaXQgY29udGV4dCBmb3IgdGhlIHJlcXVlc3QgZm9sbG93aW5nIHRoZSBleGlzdGluZyBidWlsZEN0eCBwYXR0ZXJuXG4gICAqIEBwYXJhbSBjdHggLSBUaGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICogQHBhcmFtIHJvdXRlIC0gVGhlIG1hdGNoZWQgcm91dGUgKG9wdGlvbmFsLCBmb3IgbWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZylcbiAgICogQHJldHVybnMgQXVkaXRDb250ZXh0IG9yIG51bGwgaWYgYXVkaXQgaXMgZGlzYWJsZWRcbiAgICovXG4gIHByb3RlY3RlZCBtYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgcm91dGU/OiBSb3V0ZSB8IG51bGwpOiBBdWRpdENvbnRleHQgfCBudWxsIHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldENvbnRyb2xsZXJDb25maWcoKTtcblxuICAgIC8vIE1lcmdlIGNvbnRyb2xsZXItbGV2ZWwgYW5kIG1ldGhvZC1sZXZlbCBhdWRpdCBjb25maWdzXG4gICAgY29uc3QgY29udHJvbGxlckF1ZGl0ID0gY29uZmlnPy5hdWRpdDtcbiAgICBjb25zdCBtZXRob2RBdWRpdCA9IHJvdXRlPy5hdWRpdDtcbiAgICBjb25zdCBtZXJnZWRBdWRpdENvbmZpZyA9IHRoaXMubWVyZ2VBdWRpdENvbmZpZ3MoY29udHJvbGxlckF1ZGl0LCBtZXRob2RBdWRpdCk7XG5cbiAgICBpZiAoIW1lcmdlZEF1ZGl0Q29uZmlnPy5lbmFibGVkKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBjdHguYWN0b3I/LmNvcnJlbGF0aW9uSWQgfHxcbiAgICAgIGN0eC5yZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtY29ycmVsYXRpb24taWQnIF0gfHxcbiAgICAgIGN0eC5yZXF1ZXN0LnJlcXVlc3RJZDtcblxuICAgIGNvbnN0IG9wZXJhdGlvbk5hbWUgPSBgJHtjdHgucmVxdWVzdC5odHRwTWV0aG9kLnRvTG93ZXJDYXNlKCl9XyR7Y3R4LnJlcXVlc3QucGF0aH1gO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke29wZXJhdGlvbk5hbWV9YDtcblxuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbG9nVHlwZTogJ2xvZycsXG4gICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3QnLFxuICAgICAgZW50aXR5TmFtZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgb3BlcmF0aW9uOiBvcGVyYXRpb25OYW1lLFxuICAgICAgY2F0ZWdvcnk6IG1lcmdlZEF1ZGl0Q29uZmlnLmNhdGVnb3J5LFxuICAgICAgYWN0b3I6IGN0eC5hY3RvcixcbiAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgIG9wZXJhdGlvbklkLFxuICAgICAgICBwYXJlbnRPcGVyYXRpb25JZDogY3R4LnJlcXVlc3QuaGVhZGVycz8uWyAneC1wYXJlbnQtb3BlcmF0aW9uLWlkJyBdLFxuICAgICAgICBvcGVyYXRpb25UeXBlOiAnYXBpJyxcbiAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgc3RhcnRUaW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSxcbiAgICAgIGF1ZGl0Q29uZmlnOiBtZXJnZWRBdWRpdENvbmZpZ1xuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogTWVyZ2VzIGNvbnRyb2xsZXItbGV2ZWwgYW5kIG1ldGhvZC1sZXZlbCBhdWRpdCBjb25maWd1cmF0aW9uc1xuICAgKiBNZXRob2QtbGV2ZWwgY29uZmlnIHRha2VzIHByZWNlZGVuY2Ugb3ZlciBjb250cm9sbGVyLWxldmVsIGNvbmZpZ1xuICAgKiBAcGFyYW0gY29udHJvbGxlckF1ZGl0IC0gQ29udHJvbGxlci1sZXZlbCBhdWRpdCBjb25maWdcbiAgICogQHBhcmFtIG1ldGhvZEF1ZGl0IC0gTWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZyAgXG4gICAqIEByZXR1cm5zIE1lcmdlZCBhdWRpdCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcml2YXRlIG1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJBdWRpdD86IEF1ZGl0Q29uZmlnLCBtZXRob2RBdWRpdD86IEF1ZGl0Q29uZmlnKTogQXVkaXRDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICghY29udHJvbGxlckF1ZGl0ICYmICFtZXRob2RBdWRpdCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoIWNvbnRyb2xsZXJBdWRpdCkgcmV0dXJuIG1ldGhvZEF1ZGl0O1xuICAgIGlmICghbWV0aG9kQXVkaXQpIHJldHVybiBjb250cm9sbGVyQXVkaXQ7XG5cbiAgICAvLyBEZWVwIG1lcmdlIHdpdGggbWV0aG9kLWxldmVsIGNvbmZpZyB0YWtpbmcgcHJlY2VkZW5jZVxuICAgIGNvbnN0IG1lcmdlZDogQXVkaXRDb25maWcgPSB7XG4gICAgICAuLi5jb250cm9sbGVyQXVkaXQsXG4gICAgICAuLi5tZXRob2RBdWRpdFxuICAgIH07XG5cbiAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBuZXN0ZWQgb2JqZWN0c1xuICAgIGlmIChjb250cm9sbGVyQXVkaXQuaW5jbHVkZXMgfHwgbWV0aG9kQXVkaXQuaW5jbHVkZXMpIHtcbiAgICAgIG1lcmdlZC5pbmNsdWRlcyA9IHtcbiAgICAgICAgLi4uY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLFxuICAgICAgICAuLi5tZXRob2RBdWRpdC5pbmNsdWRlc1xuICAgICAgfTtcblxuICAgICAgLy8gTWVyZ2UgcmVxdWVzdCBhbmQgcmVzcG9uc2UgYXJyYXlzIGlmIGJvdGggZXhpc3QgYW5kIGFyZSBhcnJheXNcbiAgICAgIGlmIChjb250cm9sbGVyQXVkaXQuaW5jbHVkZXM/LnJlcXVlc3QgJiYgbWV0aG9kQXVkaXQuaW5jbHVkZXM/LnJlcXVlc3QpIHtcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlcXVlc3QgPSBBcnJheS5pc0FycmF5KGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcy5yZXF1ZXN0KSA/IGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcy5yZXF1ZXN0IDogW107XG4gICAgICAgIGNvbnN0IG1ldGhvZFJlcXVlc3QgPSBBcnJheS5pc0FycmF5KG1ldGhvZEF1ZGl0LmluY2x1ZGVzLnJlcXVlc3QpID8gbWV0aG9kQXVkaXQuaW5jbHVkZXMucmVxdWVzdCA6IFtdO1xuICAgICAgICBtZXJnZWQuaW5jbHVkZXMucmVxdWVzdCA9IFsgLi4ubmV3IFNldChbIC4uLmNvbnRyb2xsZXJSZXF1ZXN0LCAuLi5tZXRob2RSZXF1ZXN0IF0pIF07XG4gICAgICB9XG4gICAgICBpZiAoY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzPy5yZXNwb25zZSAmJiBtZXRob2RBdWRpdC5pbmNsdWRlcz8ucmVzcG9uc2UpIHtcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc3BvbnNlID0gQXJyYXkuaXNBcnJheShjb250cm9sbGVyQXVkaXQuaW5jbHVkZXMucmVzcG9uc2UpID8gY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLnJlc3BvbnNlIDogW107XG4gICAgICAgIGNvbnN0IG1ldGhvZFJlc3BvbnNlID0gQXJyYXkuaXNBcnJheShtZXRob2RBdWRpdC5pbmNsdWRlcy5yZXNwb25zZSkgPyBtZXRob2RBdWRpdC5pbmNsdWRlcy5yZXNwb25zZSA6IFtdO1xuICAgICAgICBtZXJnZWQuaW5jbHVkZXMucmVzcG9uc2UgPSBbIC4uLm5ldyBTZXQoWyAuLi5jb250cm9sbGVyUmVzcG9uc2UsIC4uLm1ldGhvZFJlc3BvbnNlIF0pIF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbiB8fCBtZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbikge1xuICAgICAgbWVyZ2VkLmRhdGFQcm90ZWN0aW9uID0ge1xuICAgICAgICAuLi5jb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24sXG4gICAgICAgIC4uLm1ldGhvZEF1ZGl0LmRhdGFQcm90ZWN0aW9uXG4gICAgICB9O1xuXG4gICAgICAvLyBNZXJnZSBkZWVwUmVkYWN0IGNvbmZpZ1xuICAgICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdCB8fCBtZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdCkge1xuICAgICAgICBtZXJnZWQuZGF0YVByb3RlY3Rpb24uZGVlcFJlZGFjdCA9IHtcbiAgICAgICAgICAuLi5jb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3QsXG4gICAgICAgICAgLi4ubWV0aG9kQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3RcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBNZXJnZSBibGFja2xpc3RlZEtleXMgYXJyYXlzXG4gICAgICAgIGlmIChjb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3Q/LmJsYWNrbGlzdGVkS2V5cyAmJiBtZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdD8uYmxhY2tsaXN0ZWRLZXlzKSB7XG4gICAgICAgICAgbWVyZ2VkLmRhdGFQcm90ZWN0aW9uLmRlZXBSZWRhY3QuYmxhY2tsaXN0ZWRLZXlzID0gW1xuICAgICAgICAgICAgLi4ubmV3IFNldChbXG4gICAgICAgICAgICAgIC4uLmNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbi5kZWVwUmVkYWN0LmJsYWNrbGlzdGVkS2V5cyxcbiAgICAgICAgICAgICAgLi4ubWV0aG9kQXVkaXQuZGF0YVByb3RlY3Rpb24uZGVlcFJlZGFjdC5ibGFja2xpc3RlZEtleXNcbiAgICAgICAgICAgIF0pXG4gICAgICAgICAgXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb250cm9sbGVyQXVkaXQuY3VzdG9tQ29udGV4dCB8fCBtZXRob2RBdWRpdC5jdXN0b21Db250ZXh0KSB7XG4gICAgICBtZXJnZWQuY3VzdG9tQ29udGV4dCA9IHtcbiAgICAgICAgLi4uY29udHJvbGxlckF1ZGl0LmN1c3RvbUNvbnRleHQsXG4gICAgICAgIC4uLm1ldGhvZEF1ZGl0LmN1c3RvbUNvbnRleHRcbiAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIG1lcmdlZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIHJlcXVlc3Qgc3RhcnRcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBjYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0QXVkaXRDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciByZXF1ZXN0IGVuZCAoc3VjY2VzcyBvciBlcnJvcilcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBjYXB0dXJlRW5kKGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCByZXNwb25zZTogUmVzcG9uc2UsIGVycm9yOiBFcnJvciB8IG51bGwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXNwb25zZUNvbnRleHQgPSB7XG4gICAgICBzdGF0dXNDb2RlOiByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgcmVzcG9uc2VTaXplOiByZXNwb25zZS5ib2R5Py5sZW5ndGggfHwgMCxcbiAgICAgIHJlc3BvbnNlOiB0aGlzLmJ1aWxkUmVzcG9uc2VDb250ZXh0KHJlc3BvbnNlLCBhdWRpdENvbnRleHQuYXVkaXRDb25maWcpXG4gICAgfTtcblxuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIG51bGwsIGVycm9yLCByZXNwb25zZUNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyByZXF1ZXN0IGNvbnRleHQgZm9yIGF1ZGl0IGxvZ2dpbmdcbiAgICovXG4gIHByaXZhdGUgYnVpbGRSZXF1ZXN0Q29udGV4dChjdHg6IEV4ZWN1dGlvbkNvbnRleHQsIGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyk6IFJlcXVlc3RBdWRpdENvbnRleHQge1xuICAgIGNvbnN0IHJlcXVlc3RJbmNsdWRlcyA9IGF1ZGl0Q29uZmlnLmluY2x1ZGVzPy5yZXF1ZXN0O1xuXG4gICAgLy8gRGV0ZXJtaW5lIHdoYXQgdG8gaW5jbHVkZSBiYXNlZCBvbiB0aGUgY29uZmlndXJhdGlvbiBmb3JtYXRcbiAgICBsZXQgaW5jbHVkZUhlYWRlcnMgPSBmYWxzZSwgaW5jbHVkZUJvZHkgPSBmYWxzZSwgaW5jbHVkZVF1ZXJ5ID0gZmFsc2U7XG4gICAgbGV0IGhlYWRlckZpZWxkczogc3RyaW5nW10gPSBbXSwgYm9keUZpZWxkczogc3RyaW5nW10gPSBbXSwgcXVlcnlGaWVsZHM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyZXF1ZXN0SW5jbHVkZXMpKSB7XG4gICAgICAvLyBMZWdhY3kgZm9ybWF0OiBbJ2hlYWRlcnMnLCAnYm9keScsICdxdWVyeSddXG4gICAgICBpbmNsdWRlSGVhZGVycyA9IHJlcXVlc3RJbmNsdWRlcy5pbmNsdWRlcygnaGVhZGVycycpO1xuICAgICAgaW5jbHVkZUJvZHkgPSByZXF1ZXN0SW5jbHVkZXMuaW5jbHVkZXMoJ2JvZHknKTtcbiAgICAgIGluY2x1ZGVRdWVyeSA9IHJlcXVlc3RJbmNsdWRlcy5pbmNsdWRlcygncXVlcnknKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiByZXF1ZXN0SW5jbHVkZXMgPT09ICdvYmplY3QnICYmIHJlcXVlc3RJbmNsdWRlcyAhPT0gbnVsbCkge1xuICAgICAgLy8gTmV3IHNlbGVjdGl2ZSBmb3JtYXQ6IHsgaGVhZGVyczogWydhdXRoJ10sIGJvZHk6IFsnZW1haWwnXSwgcXVlcnk6IFsncGFnZSddIH1cbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gISFyZXF1ZXN0SW5jbHVkZXMuaGVhZGVycztcbiAgICAgIGluY2x1ZGVCb2R5ID0gISFyZXF1ZXN0SW5jbHVkZXMuYm9keTtcbiAgICAgIGluY2x1ZGVRdWVyeSA9ICEhcmVxdWVzdEluY2x1ZGVzLnF1ZXJ5O1xuICAgICAgaGVhZGVyRmllbGRzID0gcmVxdWVzdEluY2x1ZGVzLmhlYWRlcnMgfHwgW107XG4gICAgICBib2R5RmllbGRzID0gcmVxdWVzdEluY2x1ZGVzLmJvZHkgfHwgW107XG4gICAgICBxdWVyeUZpZWxkcyA9IHJlcXVlc3RJbmNsdWRlcy5xdWVyeSB8fCBbXTtcbiAgICB9IGVsc2UgaWYgKHJlcXVlc3RJbmNsdWRlcyA9PT0gdHJ1ZSkge1xuICAgICAgLy8gQm9vbGVhbiB0cnVlIC0gaW5jbHVkZSBoZWFkZXJzIGJ5IGRlZmF1bHQgKGxlZ2FjeSBiZWhhdmlvcilcbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbWV0aG9kOiBjdHgucmVxdWVzdC5odHRwTWV0aG9kLFxuICAgICAgcGF0aDogY3R4LnJlcXVlc3QucGF0aCxcbiAgICAgIHVzZXJBZ2VudDogY3R4LmV2ZW50LmhlYWRlcnM/LlsgJ3VzZXItYWdlbnQnIF0sXG4gICAgICBzb3VyY2VJcDogY3R4LmV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICBoZWFkZXJzOiBpbmNsdWRlSGVhZGVycyA/XG4gICAgICAgIHRoaXMuc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKGN0eC5yZXF1ZXN0LmhlYWRlcnMsIGhlYWRlckZpZWxkcykgOiB1bmRlZmluZWQsXG4gICAgICBib2R5OiBpbmNsdWRlQm9keSA/XG4gICAgICAgIHRoaXMuc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKGN0eC5yZXF1ZXN0LmJvZHksIGJvZHlGaWVsZHMpIDogdW5kZWZpbmVkLFxuICAgICAgcXVlcnk6IGluY2x1ZGVRdWVyeSA/XG4gICAgICAgIHRoaXMuc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKGN0eC5yZXF1ZXN0LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycywgcXVlcnlGaWVsZHMpIDogdW5kZWZpbmVkXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RpdmVseSBpbmNsdWRlcyBmaWVsZHMgZnJvbSBhbiBvYmplY3QgYmFzZWQgb24gZmllbGQgbGlzdFxuICAgKiBJZiBubyBmaWVsZHMgc3BlY2lmaWVkLCByZXR1cm5zIHRoZSBlbnRpcmUgb2JqZWN0XG4gICAqL1xuICBwcml2YXRlIHNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyhvYmo6IGFueSwgZmllbGRzOiBzdHJpbmdbXSk6IGFueSB7XG4gICAgaWYgKCFvYmogfHwgdHlwZW9mIG9iaiAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuXG4gICAgLy8gSWYgbm8gc3BlY2lmaWMgZmllbGRzIHJlcXVlc3RlZCwgcmV0dXJuIGVudGlyZSBvYmplY3RcbiAgICBpZiAoIWZpZWxkcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBvbmx5IHNwZWNpZmllZCBmaWVsZHNcbiAgICBjb25zdCByZXN1bHQ6IGFueSA9IHt9O1xuICAgIGZvciAoY29uc3QgZmllbGQgb2YgZmllbGRzKSB7XG4gICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGZpZWxkKSkge1xuICAgICAgICByZXN1bHRbIGZpZWxkIF0gPSBvYmpbIGZpZWxkIF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RpdmVseSBpbmNsdWRlcyBmaWVsZHMgZnJvbSByZXNwb25zZSBib2R5IChoYW5kbGVzIEpTT04gc3RyaW5nIGJvZGllcylcbiAgICogSWYgbm8gZmllbGRzIHNwZWNpZmllZCwgcmV0dXJucyB0aGUgZW50aXJlIGJvZHlcbiAgICovXG4gIHByaXZhdGUgc2VsZWN0aXZlbHlJbmNsdWRlUmVzcG9uc2VCb2R5KGJvZHk6IHN0cmluZywgZmllbGRzOiBzdHJpbmdbXSk6IGFueSB7XG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGJvZHk7XG4gICAgfVxuXG4gICAgLy8gSWYgbm8gc3BlY2lmaWMgZmllbGRzIHJlcXVlc3RlZCwgcmV0dXJuIGVudGlyZSBib2R5XG4gICAgaWYgKCFmaWVsZHMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gYm9keTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gVHJ5IHRvIHBhcnNlIGFzIEpTT05cbiAgICAgIGNvbnN0IGJvZHlPYmogPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgaWYgKHR5cGVvZiBib2R5T2JqID09PSAnb2JqZWN0JyAmJiBib2R5T2JqICE9PSBudWxsKSB7XG4gICAgICAgIC8vIEFwcGx5IGZpZWxkIHNlbGVjdGlvbiBhbmQgc3RyaW5naWZ5IGJhY2tcbiAgICAgICAgY29uc3Qgc2VsZWN0ZWQgPSB0aGlzLnNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyhib2R5T2JqLCBmaWVsZHMpO1xuICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoc2VsZWN0ZWQpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBOb3QgdmFsaWQgSlNPTiwgcmV0dXJuIGFzLWlzXG4gICAgfVxuXG4gICAgcmV0dXJuIGJvZHk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHJlc3BvbnNlIGNvbnRleHQgZm9yIGF1ZGl0IGxvZ2dpbmdcbiAgICovXG4gIHByaXZhdGUgYnVpbGRSZXNwb25zZUNvbnRleHQocmVzcG9uc2U6IFJlc3BvbnNlLCBhdWRpdENvbmZpZzogQXVkaXRDb25maWcpIHtcbiAgICBjb25zdCByZXNwb25zZUluY2x1ZGVzID0gYXVkaXRDb25maWcuaW5jbHVkZXM/LnJlc3BvbnNlO1xuICAgIGlmICghcmVzcG9uc2VJbmNsdWRlcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIERldGVybWluZSB3aGF0IHRvIGluY2x1ZGUgYmFzZWQgb24gdGhlIGNvbmZpZ3VyYXRpb24gZm9ybWF0XG4gICAgbGV0IGluY2x1ZGVIZWFkZXJzID0gZmFsc2UsIGluY2x1ZGVCb2R5ID0gZmFsc2U7XG4gICAgbGV0IGhlYWRlckZpZWxkczogc3RyaW5nW10gPSBbXSwgYm9keUZpZWxkczogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHJlc3BvbnNlSW5jbHVkZXMpKSB7XG4gICAgICAvLyBMZWdhY3kgZm9ybWF0OiBbJ2hlYWRlcnMnLCAnYm9keSddXG4gICAgICBpbmNsdWRlSGVhZGVycyA9IHJlc3BvbnNlSW5jbHVkZXMuaW5jbHVkZXMoJ2hlYWRlcnMnKTtcbiAgICAgIGluY2x1ZGVCb2R5ID0gcmVzcG9uc2VJbmNsdWRlcy5pbmNsdWRlcygnYm9keScpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHJlc3BvbnNlSW5jbHVkZXMgPT09ICdvYmplY3QnICYmIHJlc3BvbnNlSW5jbHVkZXMgIT09IG51bGwpIHtcbiAgICAgIC8vIE5ldyBzZWxlY3RpdmUgZm9ybWF0OiB7IGhlYWRlcnM6IFsnY29udGVudC10eXBlJ10sIGJvZHk6IFsnaWQnLCAnc3RhdHVzJ10gfVxuICAgICAgaW5jbHVkZUhlYWRlcnMgPSAhIXJlc3BvbnNlSW5jbHVkZXMuaGVhZGVycztcbiAgICAgIGluY2x1ZGVCb2R5ID0gISFyZXNwb25zZUluY2x1ZGVzLmJvZHk7XG4gICAgICBoZWFkZXJGaWVsZHMgPSByZXNwb25zZUluY2x1ZGVzLmhlYWRlcnMgfHwgW107XG4gICAgICBib2R5RmllbGRzID0gcmVzcG9uc2VJbmNsdWRlcy5ib2R5IHx8IFtdO1xuICAgIH0gZWxzZSBpZiAocmVzcG9uc2VJbmNsdWRlcyA9PT0gdHJ1ZSkge1xuICAgICAgLy8gQm9vbGVhbiB0cnVlIC0gaW5jbHVkZSBoZWFkZXJzIGJ5IGRlZmF1bHQgKGxlZ2FjeSBiZWhhdmlvcilcbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzQ29kZSxcbiAgICAgIGhlYWRlcnM6IGluY2x1ZGVIZWFkZXJzID9cbiAgICAgICAgdGhpcy5zZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMocmVzcG9uc2UuaGVhZGVycywgaGVhZGVyRmllbGRzKSA6IHVuZGVmaW5lZCxcbiAgICAgIGJvZHk6IGluY2x1ZGVCb2R5ID9cbiAgICAgICAgdGhpcy5zZWxlY3RpdmVseUluY2x1ZGVSZXNwb25zZUJvZHkocmVzcG9uc2UuYm9keSwgYm9keUZpZWxkcykgOiB1bmRlZmluZWRcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGNvbnRyb2xsZXIgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIGdldENvbnRyb2xsZXJDb25maWcoKTogSUNvbnRyb2xsZXJDb25maWcge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAnY29udHJvbGxlckNvbmZpZycpIHx8IHt9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzIGFjdG9yIGNvbnRleHQgZnJvbSB0aGUgcmVxdWVzdFxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBmb3IgY3VzdG9tIGFjdG9yIGV4dHJhY3Rpb24gbG9naWNcbiAgICpcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIHJlcXVlc3QgLSBUaGUgcmVxdWVzdCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIFRoZSBhY3RvciBjb250ZXh0LlxuICAgKiBgYGBcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QpOiBBY3RvciB7XG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlcXVlc3QucmVxdWVzdElkO1xuXG4gICAgY29uc3QgYWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkLFxuICAgICAgdGltZXN0YW1wLFxuICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnM/LlsgJ3VzZXItYWdlbnQnIF0gfHwgZXZlbnQuaGVhZGVycz8uWyAnVXNlci1BZ2VudCcgXSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHJlcXVlc3QuaGVhZGVycz8uWyAneC1jb3JyZWxhdGlvbi1pZCcgXSB8fCByZXF1ZXN0SWQsXG4gICAgfTtcblxuICAgIC8vIENvZ25pdG8gYXV0aGVudGljYXRpb24gd2l0aCBmb2N1c2VkIGVuaGFuY2VtZW50c1xuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zKSB7XG4gICAgICB0aGlzLmV4dHJhY3RDb2duaXRvQ29udGV4dChldmVudC5yZXF1ZXN0Q29udGV4dC5hdXRob3JpemVyLmNsYWltcywgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBUEkgS2V5IGF1dGhlbnRpY2F0aW9uXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkgfHwgcmVxdWVzdC5oZWFkZXJzPy5bICd4LWFwaS1rZXknIF0pIHtcbiAgICAgIHRoaXMuZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gSUFNIGF1dGhlbnRpY2F0aW9uIFxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybikge1xuICAgICAgdGhpcy5leHRyYWN0SWFtQ29udGV4dChldmVudCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBbm9ueW1vdXNcbiAgICBlbHNlIHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9ICdhbm9ueW1vdXMnO1xuICAgIH1cblxuICAgIC8vIFNlc3Npb24gYW5kIHRlbmFudCBjb250ZXh0XG4gICAgdGhpcy5leHRyYWN0U2Vzc2lvbkFuZFRlbmFudENvbnRleHQoZXZlbnQsIHJlcXVlc3QsIGFjdG9yKTtcblxuICAgIC8vIEFQSSBHYXRld2F5IGNvbnRleHRcbiAgICBhY3Rvci5hcGlTdGFnZSA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5zdGFnZTtcbiAgICBhY3Rvci5hcGlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hcGlJZDtcblxuICAgIHJldHVybiBhY3RvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IENvZ25pdG8gYWN0b3IgY29udGV4dCBiYXNlZCBvbiBkb2N1bWVudGVkIEFXUyBDb2duaXRvIEpXVCBjbGFpbXNcbiAgICogT25seSBleHRyYWN0cyB3aGF0J3Mgb2ZmaWNpYWxseSBkb2N1bWVudGVkIGFuZCBhdmFpbGFibGUgaW4gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgKiBcbiAgICogQHBhcmFtIGNsYWltcyAtIENvZ25pdG8gSldUIGNsYWltcyBmcm9tIHRoZSBhdXRob3JpemVyXG4gICAqIEBwYXJhbSBhY3RvciAtIEFjdG9yIG9iamVjdCB0byBwb3B1bGF0ZVxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDb2duaXRvQ29udGV4dChjbGFpbXM6IGFueSwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG5cbiAgICAgIC8vIEFjdG9yIElEIHdpdGggZG9jdW1lbnRlZCBmYWxsYmFjayBzdHJhdGVneTogY29nbml0bzp1c2VybmFtZSAtPiBlbWFpbCAtPiBzdWJcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXNbICdjb2duaXRvOnVzZXJuYW1lJyBdIHx8IGNsYWltcy5lbWFpbCB8fCBjbGFpbXMuc3ViO1xuXG4gICAgICAvLyBTdGFuZGFyZCB1c2VyIGF0dHJpYnV0ZXMgKGRvY3VtZW50ZWQgQ29nbml0byB1c2VyIGF0dHJpYnV0ZXMpXG4gICAgICBhY3Rvci5lbWFpbCA9IGNsYWltcy5lbWFpbDtcbiAgICAgIGFjdG9yLmVtYWlsVmVyaWZpZWQgPSBjbGFpbXMuZW1haWxfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLnBob25lTnVtYmVyID0gY2xhaW1zLnBob25lX251bWJlcjtcbiAgICAgIGFjdG9yLnBob25lVmVyaWZpZWQgPSBjbGFpbXMucGhvbmVfbnVtYmVyX3ZlcmlmaWVkID09PSAndHJ1ZSc7XG4gICAgICBhY3Rvci5uYW1lID0gY2xhaW1zLm5hbWU7XG4gICAgICBhY3Rvci5sb2NhbGUgPSBjbGFpbXMubG9jYWxlO1xuXG4gICAgICAvLyBQYXJzZSBDb2duaXRvIGdyb3VwcyAoZG9jdW1lbnRlZCBhcyBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nKVxuICAgICAgY29uc3QgZ3JvdXBzID0gdGhpcy5wYXJzZUdyb3VwcyhjbGFpbXNbICdjb2duaXRvOmdyb3VwcycgXSk7XG5cbiAgICAgIC8vIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXMgKGRvY3VtZW50ZWQgcGF0dGVybjogY3VzdG9tOiopXG4gICAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzID0gdGhpcy5leHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXMpO1xuXG4gICAgICAvLyBCdWlsZCBDb2duaXRvIGNvbnRleHQgd2l0aCBvbmx5IGRvY3VtZW50ZWQgZmllbGRzXG4gICAgICBhY3Rvci5jb2duaXRvID0ge1xuICAgICAgICBzdWI6IGNsYWltcy5zdWIsXG4gICAgICAgIHVzZXJuYW1lOiBjbGFpbXNbICdjb2duaXRvOnVzZXJuYW1lJyBdLFxuICAgICAgICBncm91cHM6IGdyb3VwcywgLy8gQWx3YXlzIGluY2x1ZGUgZ3JvdXBzIGFycmF5IChlbXB0eSBvciBwb3B1bGF0ZWQpXG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IE9iamVjdC5rZXlzKGN1c3RvbUF0dHJpYnV0ZXMpLmxlbmd0aCA+IDAgPyBjdXN0b21BdHRyaWJ1dGVzIDogdW5kZWZpbmVkXG4gICAgICB9O1xuXG4gICAgICAvLyBFeHRyYWN0IHRlbmFudCBJRCBmcm9tIGN1c3RvbSBhdHRyaWJ1dGVzIChjb21tb24gbXVsdGktdGVuYW50IHBhdHRlcm4pXG4gICAgICBhY3Rvci50ZW5hbnRJZCA9IGN1c3RvbUF0dHJpYnV0ZXMudGVuYW50SWQ7XG5cbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0Vycm9yIGV4dHJhY3RpbmcgQ29nbml0byBhY3RvciBjb250ZXh0JywgeyBlcnJvciwgY2xhaW1zIH0pO1xuXG4gICAgICAvLyBNaW5pbWFsIGZhbGxiYWNrIGV4dHJhY3Rpb25cbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zLnN1YiB8fCAndW5rbm93bic7XG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2UgQ29nbml0byBncm91cHMgZnJvbSBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nIChkb2N1bWVudGVkIENvZ25pdG8gZm9ybWF0KVxuICAgKi9cbiAgcHJvdGVjdGVkIHBhcnNlR3JvdXBzKGdyb3VwczogYW55KTogc3RyaW5nW10ge1xuICAgIGlmICh0eXBlb2YgZ3JvdXBzID09PSAnc3RyaW5nJyAmJiBncm91cHMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGdyb3Vwcy5zcGxpdCgnLCcpLm1hcChnID0+IGcudHJpbSgpKS5maWx0ZXIoZyA9PiBnLmxlbmd0aCA+IDApO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyB1c2luZyBkb2N1bWVudGVkIENvZ25pdG8gcGF0dGVybiAoY3VzdG9tOiopXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEN1c3RvbUF0dHJpYnV0ZXMoY2xhaW1zOiBhbnkpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG5cbiAgICBPYmplY3Qua2V5cyhjbGFpbXMpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGlmIChrZXkuc3RhcnRzV2l0aCgnY3VzdG9tOicpKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBrZXkucmVwbGFjZSgnY3VzdG9tOicsICcnKTtcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlc1sgYXR0cmlidXRlTmFtZSBdID0gY2xhaW1zWyBrZXkgXTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjdXN0b21BdHRyaWJ1dGVzO1xuICB9XG5cbiAgLyoqXG4gKiBFeHRyYWN0IHNlc3Npb24gYW5kIHRlbmFudCBjb250ZXh0IC0gZm9jdXNlZCBhcHByb2FjaFxuICovXG4gIHByb3RlY3RlZCBleHRyYWN0U2Vzc2lvbkFuZFRlbmFudENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgLy8gU2Vzc2lvbiBjb250ZXh0XG4gICAgYWN0b3Iuc2Vzc2lvbklkID0gcmVxdWVzdC5oZWFkZXJzPy5bICd4LXNlc3Npb24taWQnIF07XG5cbiAgICAvLyBUZW5hbnQgY29udGV4dCAtIGNoZWNrIGN1c3RvbSBhdHRyaWJ1dGVzIGZpcnN0LCB0aGVuIGhlYWRlcnNcbiAgICBhY3Rvci50ZW5hbnRJZCA9IHJlcXVlc3QuaGVhZGVycz8uWyAneC10ZW5hbnQtaWQnIF0gfHxcbiAgICAgIGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXM/LlsgJ2N1c3RvbTp0ZW5hbnRJZCcgXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IEFQSSBLZXkgY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYXBpLWtleSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuXG4gICAgbGV0IGFwaUtleUlkOiBzdHJpbmc7XG4gICAgbGV0IHNvdXJjZTogJ3JlcXVlc3QtY29udGV4dCcgfCAnaGVhZGVyJztcblxuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSkge1xuICAgICAgYXBpS2V5SWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXlJZCB8fCBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5hcGlLZXk7XG4gICAgICBzb3VyY2UgPSAncmVxdWVzdC1jb250ZXh0JztcbiAgICB9IGVsc2Uge1xuICAgICAgYXBpS2V5SWQgPSByZXF1ZXN0LmhlYWRlcnNbICd4LWFwaS1rZXknIF0hO1xuICAgICAgc291cmNlID0gJ2hlYWRlcic7XG4gICAgfVxuXG4gICAgYWN0b3IuYWN0b3JJZCA9IGBhcGkta2V5OiR7YXBpS2V5SWR9YDtcbiAgICBhY3Rvci5hcGlLZXkgPSB7XG4gICAgICBpZDogYXBpS2V5SWQsXG4gICAgICBzb3VyY2U6IHNvdXJjZSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgSUFNIGNvbnRleHRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0SWFtQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2lhbSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgIGFjdG9yLmFjdG9ySWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHxcbiAgICAgIGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybiB8fFxuICAgICAgJ3Vua25vd24taWFtLXVzZXInO1xuXG4gICAgYWN0b3IuaWFtID0ge1xuICAgICAgdXNlckFybjogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8IHVuZGVmaW5lZCxcbiAgICAgIHVzZXJJZDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyIHx8IHVuZGVmaW5lZCxcbiAgICAgIGFjY291bnRJZDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hY2NvdW50SWQgfHwgdW5kZWZpbmVkLFxuICAgICAgY2FsbGVyOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmNhbGxlciB8fCB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxufVxuIl19