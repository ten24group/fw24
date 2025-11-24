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
        const traceHeaders = (0, observability_1.extractTraceContextFromHeaders)(request.headers || {});
        const requestSpan = new observability_1.Span(`HTTP ${request.httpMethod} ${request.path}`, {
            traceId: traceHeaders.traceId,
            parentSpanId: traceHeaders.parentSpanId,
            attributes: {
                'http.method': request.httpMethod,
                'http.path': request.path,
                'http.requestId': request.requestId,
            },
        });
        let spanEnded = false;
        const finalizeObservability = async (success, error) => {
            if (!spanEnded) {
                await requestSpan.end({ success, error });
                spanEnded = true;
            }
            await observability_1.ObservabilityManager.flush();
        };
        ctx.observability = {
            traceId: requestSpan.traceId,
            spanId: requestSpan.spanId,
            parentSpanId: requestSpan.parentSpanId,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUF5REEsNENBeUJDO0FBaEZELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFHakgscUVBQXdFO0FBQ3hFLHVEQUFpRztBQVdqRywrQkFBK0I7QUFDL0IsTUFBTSxpQkFBaUIsR0FBaUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztBQUUzRCxNQUFNLGFBQWEsR0FBRyxDQUFDLFVBQW1DLEVBQUUsRUFBRTtJQUNuRSxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDcEMsQ0FBQyxDQUFBO0FBRlksUUFBQSxhQUFhLGlCQUV6QjtBQUNNLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxFQUFFO0lBQ25DLGlCQUFpQixDQUFDLEtBQUssRUFBRSxDQUFDO0FBQzVCLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FDOUIsT0FJcUIsRUFDckIsT0FBcUY7SUFHckYsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxZQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUd2RSxJQUFNLG9CQUFvQixHQUExQixNQUFNLG9CQUFvQjtRQUVsQixBQUFOLEtBQUssQ0FBQyxhQUFhO1lBQ2pCLHNEQUFzRDtRQUN4RCxDQUFDO0tBQ0YsQ0FBQTtJQUhPO1FBREwsTUFBTSxDQUFDLElBQUksQ0FBQzs2REFHWjtJQUpH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LEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsU0FBUyxJQUFJLFNBQVM7WUFDakUsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE1BQU0sSUFBSSxTQUFTO1NBQzVELENBQUM7SUFDSixDQUFDO0NBQ0Y7QUE1NEJELHNDQTQ0QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB0eXBlIHsgUmVxdWVzdCwgUmVzcG9uc2UsIFJvdXRlIH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIElDb250cm9sbGVyQ29uZmlnIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IEdldCwgUm91dGVNZXRob2RzIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnMvbWV0aG9kXCI7XG5pbXBvcnQgeyBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSwgaXNJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb24vdXRpbHNcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBSZXF1ZXN0Q29udGV4dCB9IGZyb20gXCIuL3JlcXVlc3QtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb250ZXh0IH0gZnJvbSBcIi4vcmVzcG9uc2UtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb25maWcsIG1lcmdlUmVzcG9uc2VDb25maWcgfSBmcm9tIFwiLi9yZXNwb25zZS1jb25maWdcIjtcbmltcG9ydCB7IFZhbGlkYXRpb25GYWlsZWRFcnJvciwgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvciwgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSBcIi4uLy4uL2Vycm9ycy9cIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgQXVkaXRDb250ZXh0LCBSZXF1ZXN0QXVkaXRDb250ZXh0LCBBdWRpdENvbmZpZyB9IGZyb20gJy4uLy4uL2F1ZGl0L2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQXVkaXRDYXB0dXJlU2VydmljZSB9IGZyb20gJy4uLy4uL2F1ZGl0L2hlbHBlcnMvYXVkaXQtaGVscGVycyc7XG5pbXBvcnQgeyBleHRyYWN0VHJhY2VDb250ZXh0RnJvbUhlYWRlcnMsIE9ic2VydmFiaWxpdHlNYW5hZ2VyLCBTcGFuIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5cbmV4cG9ydCB0eXBlIENvbnRyb2xsZXJFcnJvckhhbmRsZXIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVFcnJvckhhbmRsZXI+O1xuXG4vLyBOZXcgaW50ZXJmYWNlcyBmb3IgbWlkZGxld2FyZSBhbmQgZXJyb3IgaGFuZGxpbmdcbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlck1pZGRsZXdhcmUge1xuICBiZWZvcmU/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBhZnRlcj86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIG9uRXJyb3I/OiAoZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG59XG5cbi8vIEdsb2JhbCBtaWRkbGV3YXJlIG1hbmFnZW1lbnRcbmNvbnN0IGdsb2JhbE1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuXG5leHBvcnQgY29uc3QgdXNlTWlkZGxld2FyZSA9IChtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5hZGQobWlkZGxld2FyZSk7XG59XG5leHBvcnQgY29uc3QgY2xlYXJNaWRkbGV3YXJlcyA9ICgpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMuY2xlYXIoKTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIEFQSSBoYW5kbGVyIHdpdGhvdXQgZGVmaW5pbmcgYSBjbGFzc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGV4cG9ydCBjb25zdCB7IGhhbmRsZXIsIGRlc2NyaXB0b3IgfSA9IGNyZWF0ZUFwaUhhbmRsZXIoXG4gKiAgeyBtZXRob2Q6IEdldCwgbmFtZTogJ2RlbW8nLCBhdXRob3JpemVyOiAnTk9ORScgfSxcbiAqICAgYXN5bmMgKCBldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAqICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICogICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAqICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiSGVsbG8gV29ybGQhXCJ9KVxuICogICAgICAgfSlcbiAqICAgfVxuICogKVxuICogYGBgXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5uYW1lIC0gVGhlIG5hbWUgb2YgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMucGF0aCAtIFRoZSBwYXRoIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5tZXRob2QgLSBUaGUgSFRUUCBtZXRob2QgZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBoYW5kbGVyIGZ1bmN0aW9uIGFuZCB0aGUgY29udHJvbGxlciBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXBpSGFuZGxlcihcbiAgb3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwYXRoPzogc3RyaW5nLFxuICAgIG1ldGhvZD86IFJvdXRlTWV0aG9kcyxcbiAgfSAmIElDb250cm9sbGVyQ29uZmlnLFxuICBoYW5kbGVyOiAoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCkgPT4gUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+LFxuKSB7XG5cbiAgY29uc3QgeyBuYW1lLCBwYXRoID0gJycsIG1ldGhvZCA9IEdldCwgLi4uY29udHJvbGxlckNvbmZpZyB9ID0gb3B0aW9ucztcblxuICBAQ29udHJvbGxlcihuYW1lLCB7IC4uLmNvbnRyb2xsZXJDb25maWcsIGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyOiBmYWxzZSB9KVxuICBjbGFzcyBDb250cm9sbGVyRGVzY3JpcHRvciB7XG4gICAgQG1ldGhvZChwYXRoKVxuICAgIGFzeW5jIGlubGluZUhhbmRsZXIoKSB7XG4gICAgICAvLyBwbGFjZWhvbGRlciBmdW5jdGlvbiBvbmx5IHVzZWQgZm9yIHJvdXRpbmcgbWV0YWRhdGFcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaGFuZGxlciwgJ25hbWUnLCB7IHZhbHVlOiAnaGFuZGxlcicgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBoYW5kbGVyLFxuICAgIGRlc2NyaXB0b3I6IENvbnRyb2xsZXJEZXNjcmlwdG9yXG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlckNvbmZpZyB7XG4gIHJlc3BvbnNlQ29uZmlnPzogUGFydGlhbDxSZXNwb25zZUNvbmZpZz47XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUElDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcHJvdGVjdGVkIG1pZGRsZXdhcmVzOiBTZXQ8QVBJQ29udHJvbGxlck1pZGRsZXdhcmU+ID0gbmV3IFNldCgpO1xuICBwcm90ZWN0ZWQgcmVzcG9uc2VDb25maWc6IFJlc3BvbnNlQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogQVBJQ29udHJvbGxlckNvbmZpZyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc3BvbnNlQ29uZmlnID0gbWVyZ2VSZXNwb25zZUNvbmZpZyhjb25maWcucmVzcG9uc2VDb25maWcpO1xuICB9XG5cbiAgLyoqXG4gICAqIGNhbiBiZSB1c2VkIHRvIHJ1biBzb21lIGxvZ2ljIGp1c3QgYmVmb3JlIHRoZSByZXF1ZXN0IGlzIHByb2Nlc3NlZCBsaWtlIGNyZWF0aW5nIGNsaWVudHMsIGRpLWluamVjdGlvbiBhbnMgc28gb24uXG4gICAqIEBwYXJhbSBfZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gX2NvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGNvbnRyb2xsZXIgaXMgaW5pdGlhbGl6ZWQuXG4gICovXG4gIHByb3RlY3RlZCBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vLW9wIGZvciBBUEkgY29udHJvbGxlcnNcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpKTtcbiAgfVxuXG4gIC8vIEFkZCBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBtZXRob2RcbiAgcHJvdGVjdGVkIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUpIHtcbiAgICB0aGlzLm1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpIHtcbiAgICByZXR1cm4gWyAuLi5BcnJheS5mcm9tKGdsb2JhbE1pZGRsZXdhcmVzKSwgLi4uQXJyYXkuZnJvbSh0aGlzLm1pZGRsZXdhcmVzKSBdO1xuICB9XG5cbiAgLy8gRXhlY3V0ZSBtaWRkbGV3YXJlIHBpcGVsaW5lXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShcbiAgICBwaGFzZTogJ2JlZm9yZScgfCAnYWZ0ZXInIHwgJ29uRXJyb3InLFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsXG4gICAgZXJyb3I/OiBFcnJvclxuICApOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGFsbE1pZGRsZXdhcmVzID0gdGhpcy5nZXRNaWRkbGV3YXJlcygpO1xuXG4gICAgZm9yIChjb25zdCBtaWRkbGV3YXJlIG9mIGFsbE1pZGRsZXdhcmVzKSB7XG4gICAgICBpZiAocGhhc2UgPT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlLm9uRXJyb3IgJiYgZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZS5vbkVycm9yKGVycm9yLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH0gZWxzZSBpZiAocGhhc2UgIT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlWyBwaGFzZSBdKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmVbIHBoYXNlIF0hKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfVxuICAgIH1cblxuICB9XG5cbiAgYXN5bmMgdmFsaWRhdGUocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QsIHZhbGlkYXRpb25zOiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgIGxldCB2YWxpZGF0aW9uUnVsZXM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB2YWxpZGF0aW9ucztcbiAgICBpZiAoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zKSkge1xuICAgICAgaWYgKFsgJ0dFVCcsICdERUxFVEUnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgcXVlcnk6IHZhbGlkYXRpb25zIH1cblxuICAgICAgfSBlbHNlIGlmIChbICdQT1NUJywgJ1BVVCcsICdQQVRDSCcgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBib2R5OiB2YWxpZGF0aW9ucyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvblJ1bGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IodmFsaWRhdGlvblJ1bGVzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7XG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHZhbGlkYXRpb25zOiB2YWxpZGF0aW9uUnVsZXMsXG4gICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLFxuICAgICAgdmVyYm9zZUVycm9yczogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IHRoaXMuZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPFJlcXVlc3Q+IHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZUNvbnRleHQoe1xuICAgICAgdHJhY2VJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgcmVxdWVzdElkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICBkZWJ1Z01vZGU6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIHJvdXRlOiByZXF1ZXN0Q29udGV4dC5wYXRoLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50JyxcbiAgICAgIGNvbmZpZzogdGhpcy5yZXNwb25zZUNvbmZpZ1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgY29udHJvbGxlci5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBBUEkgR2F0ZXdheSBldmVudHMuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgQVBJIEdhdGV3YXkgcmVzcG9uc2Ugb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcblxuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuXG4gICAgLy8gQnVpbGQgdGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4ID0gdGhpcy5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuXG4gICAgY29uc3QgdHJhY2VIZWFkZXJzID0gZXh0cmFjdFRyYWNlQ29udGV4dEZyb21IZWFkZXJzKHJlcXVlc3QuaGVhZGVycyB8fCB7fSk7XG4gICAgY29uc3QgcmVxdWVzdFNwYW4gPSBuZXcgU3BhbihgSFRUUCAke3JlcXVlc3QuaHR0cE1ldGhvZH0gJHtyZXF1ZXN0LnBhdGh9YCwge1xuICAgICAgdHJhY2VJZDogdHJhY2VIZWFkZXJzLnRyYWNlSWQsXG4gICAgICBwYXJlbnRTcGFuSWQ6IHRyYWNlSGVhZGVycy5wYXJlbnRTcGFuSWQsXG4gICAgICBcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgJ2h0dHAubWV0aG9kJzogcmVxdWVzdC5odHRwTWV0aG9kLFxuICAgICAgICAnaHR0cC5wYXRoJzogcmVxdWVzdC5wYXRoLFxuICAgICAgICAnaHR0cC5yZXF1ZXN0SWQnOiByZXF1ZXN0LnJlcXVlc3RJZCxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgbGV0IHNwYW5FbmRlZCA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eSA9IGFzeW5jIChzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IEVycm9yKSA9PiB7XG4gICAgICBpZiAoIXNwYW5FbmRlZCkge1xuICAgICAgICBhd2FpdCByZXF1ZXN0U3Bhbi5lbmQoeyBzdWNjZXNzLCBlcnJvciB9KTtcbiAgICAgICAgc3BhbkVuZGVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfTtcblxuICAgIGN0eC5vYnNlcnZhYmlsaXR5ID0ge1xuICAgICAgdHJhY2VJZDogcmVxdWVzdFNwYW4udHJhY2VJZCxcbiAgICAgIHNwYW5JZDogcmVxdWVzdFNwYW4uc3BhbklkLFxuICAgICAgcGFyZW50U3BhbklkOiByZXF1ZXN0U3Bhbi5wYXJlbnRTcGFuSWQsXG4gICAgICBzcGFuOiByZXF1ZXN0U3BhbixcbiAgICB9O1xuXG4gICAgLy8gRmluZCB0aGUgbWF0Y2hpbmcgcm91dGUgZmlyc3QgZm9yIG1ldGhvZC1sZXZlbCBhdWRpdCBjb25maWdcbiAgICBjb25zdCByb3V0ZSA9IHRoaXMuZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCk7XG5cbiAgICAvLyBDcmVhdGUgYXVkaXQgY29udGV4dCB3aXRoIHJvdXRlIGluZm9ybWF0aW9uIGZvciBtZXRob2QtbGV2ZWwgY29uZmlnXG4gICAgY29uc3QgYXVkaXRDb250ZXh0ID0gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGN0eCwgcm91dGUpO1xuXG4gICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCB0aGlzLmJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbnRleHQuYXVkaXRDb25maWcpKTtcbiAgICB9XG5cbiAgICB0cnkge1xuXG4gICAgICAvLyBMZWdhY3kgaW5pdGlhbGl6ZSBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG5cbiAgICAgIC8vIEV4ZWN1dGUgYmVmb3JlIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIC8vIFZhbGlkYXRlIHRoZSByZXF1ZXN0IGlmIHZhbGlkYXRpb25zIGFyZSBkZWZpbmVkXG4gICAgICBpZiAocm91dGU/LnZhbGlkYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlKHJlcXVlc3QsIHJvdXRlLnZhbGlkYXRpb25zKTtcbiAgICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBjYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXMuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gICAgICBsZXQgY29udHJvbGxlclJlc3BvbnNlOiBhbnkgPSByb3V0ZUZ1bmN0aW9uLmNhbGwodGhpcywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICBjb250cm9sbGVyUmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyUmVzcG9uc2U7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdhZnRlcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAvLyBDYXB0dXJlIHN1Y2Nlc3NmdWwgcmVzcG9uc2VcbiAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzcG9uc2UsIG51bGwpO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgY29udHJvbGxlciByZXR1cm5lZCBhbnl0aGluZyAoUmVzcG9uc2VDb250ZXh0IG9yIHJhdyBBUEkgcmVzdWx0KSwgZW1pdCB0aGF0XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgYXdhaXQgZmluYWxpemVPYnNlcnZhYmlsaXR5KHRydWUpO1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShjb250cm9sbGVyUmVzcG9uc2UpO1xuICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG5cbiAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0xhbWJkYUhhbmRsZXIgZXJyb3I6ICcsIGVycm9yT2JqKTtcblxuICAgICAgLy8gRXhlY3V0ZSBlcnJvciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgIC8vIENhcHR1cmUgZXJyb3IgcmVzcG9uc2VcbiAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzcG9uc2UsIGVycm9yT2JqKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgZmluYWxpemVPYnNlcnZhYmlsaXR5KGZhbHNlLCBlcnJvck9iaik7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVFeGNlcHRpb24ocmVxdWVzdCwgZXJyb3JPYmosIHJlc3BvbnNlKTtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byB0aGUgaW4tbWVtb3J5IHJlc3BvbnNlQ29udGV4dFxuICAgIGF3YWl0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eSh0cnVlKTtcbiAgICByZXR1cm4gcmVzcG9uc2UuYnVpbGQoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgcm91dGUgdGhhdCBtYXRjaGVzIHRoZSBIVFRQIG1ldGhvZCBhbmQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSByZXF1ZXN0RGF0YSAtIFRoZSByZXF1ZXN0IGRhdGEgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgbWF0Y2hpbmcgcm91dGUgb3IgbnVsbCBpZiBub3QgZm91bmQuXG4gICAqL1xuICBwcml2YXRlIGZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhOiBSZXF1ZXN0KTogUm91dGUgfCBudWxsIHtcbiAgICBsZXQgY29udHJvbGxlcjogYW55ID0gdGhpcztcblxuICAgIC8vIERldGVybWluZSB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggYnkgZmluZGluZyB0aGUgbG9uZ2VzdCBjb21tb24gcHJlZml4IHRoYXQgZW5kcyB3aXRoIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICBsZXQgY29udHJvbGxlckJhc2VQYXRoID0gYC8ke2NvbnRyb2xsZXIuY29udHJvbGxlck5hbWV9YDtcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0Um9vdCA9ICcvJztcblxuICAgIC8vIEZvciBjb250cm9sbGVycyBpbiBzdWJkaXJlY3Rvcmllcywgd2UgbmVlZCB0byBtYXRjaCB0aGUgYWN0dWFsIHJlc291cmNlIHBhdGhcbiAgICAvLyBDaGVjayBpZiByZXNvdXJjZSBjb250YWlucyB0aGUgY29udHJvbGxlciBuYW1lIGFzIHBhcnQgb2YgYSBsb25nZXIgcGF0aFxuICAgIGNvbnN0IHJlc291cmNlUGFydHMgPSByZXF1ZXN0RGF0YS5yZXNvdXJjZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZVBhcnRzID0gY29udHJvbGxlci5jb250cm9sbGVyTmFtZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcblxuICAgIC8vIEZpbmQgaWYgdGhlIGNvbnRyb2xsZXIgbmFtZSBwYXJ0cyBhcmUgcHJlc2VudCBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgIGxldCBiYXNlUGF0aEVuZEluZGV4ID0gLTE7XG4gICAgaWYgKGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gTG9vayBmb3IgdGhlIGNvbnRyb2xsZXIgbmFtZSBzZXF1ZW5jZSBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gcmVzb3VyY2VQYXJ0cy5sZW5ndGggLSBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxldCBtYXRjaGVzID0gdHJ1ZTtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgaWYgKHJlc291cmNlUGFydHNbIGkgKyBqIF0gIT09IGNvbnRyb2xsZXJOYW1lUGFydHNbIGogXSkge1xuICAgICAgICAgICAgbWF0Y2hlcyA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgYmFzZVBhdGhFbmRJbmRleCA9IGkgKyBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmFzZVBhdGhFbmRJbmRleCA+PSAwKSB7XG4gICAgICAvLyBGb3VuZCB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggaW4gdGhlIHJlc291cmNlXG4gICAgICBjb25zdCBiYXNlUGF0aFBhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZSgwLCBiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICBjb250cm9sbGVyQmFzZVBhdGggPSAnLycgKyBiYXNlUGF0aFBhcnRzLmpvaW4oJy8nKTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ1BhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZShiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVtYWluaW5nUGFydHMubGVuZ3RoID4gMCA/ICcvJyArIHJlbWFpbmluZ1BhcnRzLmpvaW4oJy8nKSA6ICcvJztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmFsbGJhY2sgdG8gb3JpZ2luYWwgbG9naWMgZm9yIHNpbXBsZSBjYXNlc1xuICAgICAgaWYgKHJlcXVlc3REYXRhLnJlc291cmNlLnN0YXJ0c1dpdGgoY29udHJvbGxlckJhc2VQYXRoKSkge1xuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3Vic3RyaW5nKGNvbnRyb2xsZXJCYXNlUGF0aC5sZW5ndGgpIHx8ICcvJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXBhcmF0ZSByb3V0ZXMgaW50byBleGFjdCBhbmQgcGFyYW1ldGVyaXplZCBmb3IgcHJvcGVyIHByaW9yaXRpemF0aW9uXG4gICAgY29uc3QgZXhhY3RNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuICAgIGNvbnN0IHBhcmFtZXRlcml6ZWRNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuXG4gICAgLy8gRmlyc3QgcGFzczogY2F0ZWdvcml6ZSByb3V0ZXMgYnkgdHlwZSBhbmQgbWV0aG9kXG4gICAgZm9yIChjb25zdCBbIHJvdXRlS2V5LCByb3V0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRyb2xsZXIucm91dGVzIHx8IHt9KSBhcyBbIHN0cmluZywgUm91dGUgXVtdKSB7XG4gICAgICBjb25zdCBbIHJvdXRlTWV0aG9kLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIC8vIFNraXAgaWYgSFRUUCBtZXRob2QgZG9lc24ndCBtYXRjaFxuICAgICAgaWYgKHJvdXRlTWV0aG9kICE9PSByZXF1ZXN0RGF0YS5odHRwTWV0aG9kKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXRlZ29yaXplIHJvdXRlIHR5cGVcbiAgICAgIGlmIChyb3V0ZVBhdGguaW5jbHVkZXMoJ3snKSAmJiByb3V0ZVBhdGguaW5jbHVkZXMoJ30nKSkge1xuICAgICAgICBwYXJhbWV0ZXJpemVkTWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhhY3RNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2Vjb25kIHBhc3M6IFRyeSBleGFjdCBtYXRjaGVzIGZpcnN0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUgfSBvZiBleGFjdE1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmIChyb3V0ZVBhdGggPT09IHJlc291cmNlV2l0aG91dFJvb3QpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgcGFyYW1ldGVyaXplZCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCwge1xuICAgICAgICAgICAgcGF0dGVybjogcGF0aFRvUmVnZXhwUGF0dGVybixcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hSZXN1bHQucGFyYW1zLFxuICAgICAgICAgICAgc3BlY2lmaWNpdHlTY29yZTogc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMuZmluZChtID0+IG0ucm91dGVLZXkgPT09IHJvdXRlS2V5KT8uc3BlY2lmaWNpdHlTY29yZVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gTm90ZTogV2UgZG9uJ3QgbmVlZCB0byBtYW51YWxseSBleHRyYWN0IHBhcmFtZXRlcnMgc2luY2UgQVBJIEdhdGV3YXlcbiAgICAgICAgICAvLyBhbHJlYWR5IHByb3ZpZGVzIHRoZW0gaW4gcmVxdWVzdERhdGEucGF0aFBhcmFtZXRlcnNcbiAgICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEVycm9yIG1hdGNoaW5nIHJvdXRlIHBhdHRlcm4gJHtwYXRoVG9SZWdleHBQYXR0ZXJufTpgLCBlcnJvcik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIG1hdGNoaW5nIHJvdXRlIGZvdW5kIGZvciAke3JlcXVlc3REYXRhLmh0dHBNZXRob2R9fCR7cmVzb3VyY2VXaXRob3V0Um9vdH1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqIEBwYXJhbSByb3V0ZSAtIFRoZSBtYXRjaGVkIHJvdXRlLlxuICAgKiBAcmV0dXJucyBUaGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0Um91dGVGdW5jdGlvbihyb3V0ZTogUm91dGUgfCBudWxsKTogRnVuY3Rpb24ge1xuICAgIGlmICghcm91dGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gICAgfVxuXG4gICAgLy9AdHMtaWdub3JlXG4gICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXNbIHJvdXRlLmZ1bmN0aW9uTmFtZSBdO1xuXG4gICAgcmV0dXJuIHR5cGVvZiByb3V0ZUZ1bmN0aW9uID09PSBcImZ1bmN0aW9uXCIgPyByb3V0ZUZ1bmN0aW9uIDogdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgdGhlIE5vdEZvdW5kIHJvdXRlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNDA0IHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZU5vdEZvdW5kKF9yZXE6IFJlcXVlc3QpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJObyBSb3V0ZSBGb3VuZCFcIiB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlcnJvckhhbmRsZXI/OiBDb250cm9sbGVyRXJyb3JIYW5kbGVyO1xuICBwcm90ZWN0ZWQgZ2V0RXJyb3JIYW5kbGVyKCk6IENvbnRyb2xsZXJFcnJvckhhbmRsZXIge1xuICAgIGlmICghdGhpcy5lcnJvckhhbmRsZXIpIHtcbiAgICAgIHRoaXMuZXJyb3JIYW5kbGVyID0gY3JlYXRlRXJyb3JIYW5kbGVyKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmVycm9ySGFuZGxlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGV4Y2VwdGlvbnMgYW5kIHJldHVybnMgYSBKU09OIHJlc3BvbnNlIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0gZXJyIC0gVGhlIGVycm9yIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNTAwIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogUmVzcG9uc2UpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSB0aGlzLmdldEVycm9ySGFuZGxlcigpKGVyciwgcmVxLCByZXMpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGVycm9yUmVzcG9uc2UpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVJlc3BvbnNlKHJlczogUmVzcG9uc2UgfCBBUElHYXRld2F5UHJveHlSZXN1bHQpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGlmIChyZXMgaW5zdGFuY2VvZiBSZXNwb25zZUNvbnRleHQpIHtcbiAgICAgIHJldHVybiByZXMuYnVpbGQoKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGV4ZWN1dGlvbiBjb250ZXh0IGZvciB0aGUgcmVxdWVzdFxuICAgKiBcbiAgICogZGlmZmVyZW50IG1pZGRsZXdhcmUgY2FuIGVuaGFuY2UgdGhlIGFjdG9yIGNvbnRleHQgYnkgdXNpbmcgdGhlIGVuaGFuY2VBY3RvciBtZXRob2RcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHNcbiAgICogY29uc3QgbWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gICAqICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdCwgX3Jlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICBjdHg/LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgIHJvbGVzOiBbJ2FkbWluJywgJ3VzZXInXSxcbiAgICogICAgIHBlcm1pc3Npb25zOiBbJ3JlYWQnLCAnd3JpdGUnXSxcbiAgICogICAgIHN1YnNjcmlwdGlvbjogeyB0aWVyOiAnZW50ZXJwcmlzZScgfVxuICAgKiAgIH0pO1xuICAgKiAgfVxuICAgKiB9XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZSk7XG4gICAqIFxuICAgKiBPUlxuICAgKiBcbiAgICogY29uc3Qgc2VjdXJpdHlNaWRkbGV3YXJlID0ge1xuICAgKiAgIGJlZm9yZTogYXN5bmMgKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICAgIGN0eC5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICAgIHJpc2tQcm9maWxlOiBhd2FpdCBhc3Nlc3NSaXNrKGN0eC5hY3Rvci5hY3RvcklkKSxcbiAgICogICAgICAgZGV2aWNlOiBhd2FpdCBtYWtlRGV2aWNlQ29udGV4dChyZXF1ZXN0KVxuICAgKiAgICAgfSk7XG4gICAqICAgfVxuICAgKiB9O1xuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKHNlY3VyaXR5TWlkZGxld2FyZSk7XG4gICAqXG4gICAqIEBwYXJhbSBldmVudCBcbiAgICogQHBhcmFtIGNvbnRleHQgXG4gICAqIEBwYXJhbSByZXF1ZXN0IFxuICAgKiBAcGFyYW0gcmVzcG9uc2UgXG4gICAqIEByZXR1cm5zIFxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGFjdG9yID0gdGhpcy5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgIGNvbnN0IGN0eDogRXhlY3V0aW9uQ29udGV4dCA9IHtcbiAgICAgIGV2ZW50LFxuICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgIHJlcXVlc3QsXG4gICAgICByZXNwb25zZSxcbiAgICAgIGFjdG9yLFxuICAgICAgZGVidWdJbmZvOiB7fSxcblxuICAgICAgLy8gU2ltcGxlIGFjdG9yIGVuaGFuY2VtZW50IG1ldGhvZFxuICAgICAgZW5oYW5jZUFjdG9yOiAoZW5oYW5jZW1lbnQ6IFBhcnRpYWw8QWN0b3I+KSA9PiB7XG4gICAgICAgIGlmIChjdHguYWN0b3IpIHtcbiAgICAgICAgICBPYmplY3QuYXNzaWduKGN0eC5hY3RvciwgZW5oYW5jZW1lbnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiBjdHg7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhdWRpdCBjb250ZXh0IGZvciB0aGUgcmVxdWVzdCBmb2xsb3dpbmcgdGhlIGV4aXN0aW5nIGJ1aWxkQ3R4IHBhdHRlcm5cbiAgICogQHBhcmFtIGN0eCAtIFRoZSBleGVjdXRpb24gY29udGV4dFxuICAgKiBAcGFyYW0gcm91dGUgLSBUaGUgbWF0Y2hlZCByb3V0ZSAob3B0aW9uYWwsIGZvciBtZXRob2QtbGV2ZWwgYXVkaXQgY29uZmlnKVxuICAgKiBAcmV0dXJucyBBdWRpdENvbnRleHQgb3IgbnVsbCBpZiBhdWRpdCBpcyBkaXNhYmxlZFxuICAgKi9cbiAgcHJvdGVjdGVkIG1ha2VBdWRpdENvbnRleHQoY3R4OiBFeGVjdXRpb25Db250ZXh0LCByb3V0ZT86IFJvdXRlIHwgbnVsbCk6IEF1ZGl0Q29udGV4dCB8IG51bGwge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0Q29udHJvbGxlckNvbmZpZygpO1xuXG4gICAgLy8gTWVyZ2UgY29udHJvbGxlci1sZXZlbCBhbmQgbWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZ3NcbiAgICBjb25zdCBjb250cm9sbGVyQXVkaXQgPSBjb25maWc/LmF1ZGl0O1xuICAgIGNvbnN0IG1ldGhvZEF1ZGl0ID0gcm91dGU/LmF1ZGl0O1xuICAgIGNvbnN0IG1lcmdlZEF1ZGl0Q29uZmlnID0gdGhpcy5tZXJnZUF1ZGl0Q29uZmlncyhjb250cm9sbGVyQXVkaXQsIG1ldGhvZEF1ZGl0KTtcblxuICAgIGlmICghbWVyZ2VkQXVkaXRDb25maWc/LmVuYWJsZWQpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGN0eC5hY3Rvcj8uY29ycmVsYXRpb25JZCB8fFxuICAgICAgY3R4LnJlcXVlc3QuaGVhZGVycz8uWyAneC1jb3JyZWxhdGlvbi1pZCcgXSB8fFxuICAgICAgY3R4LnJlcXVlc3QucmVxdWVzdElkO1xuXG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IGAke2N0eC5yZXF1ZXN0Lmh0dHBNZXRob2QudG9Mb3dlckNhc2UoKX1fJHtjdHgucmVxdWVzdC5wYXRofWA7XG4gICAgY29uc3Qgb3BlcmF0aW9uSWQgPSBgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiR7b3BlcmF0aW9uTmFtZX1gO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBsb2dUeXBlOiAnbG9nJyxcbiAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdCcsXG4gICAgICBlbnRpdHlOYW1lOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBvcGVyYXRpb246IG9wZXJhdGlvbk5hbWUsXG4gICAgICBjYXRlZ29yeTogbWVyZ2VkQXVkaXRDb25maWcuY2F0ZWdvcnksXG4gICAgICBhY3RvcjogY3R4LmFjdG9yLFxuICAgICAgY29ycmVsYXRpb246IHtcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgb3BlcmF0aW9uSWQsXG4gICAgICAgIHBhcmVudE9wZXJhdGlvbklkOiBjdHgucmVxdWVzdC5oZWFkZXJzPy5bICd4LXBhcmVudC1vcGVyYXRpb24taWQnIF0sXG4gICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknLFxuICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICBzdGFydFRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9LFxuICAgICAgYXVkaXRDb25maWc6IG1lcmdlZEF1ZGl0Q29uZmlnXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgY29udHJvbGxlci1sZXZlbCBhbmQgbWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZ3VyYXRpb25zXG4gICAqIE1ldGhvZC1sZXZlbCBjb25maWcgdGFrZXMgcHJlY2VkZW5jZSBvdmVyIGNvbnRyb2xsZXItbGV2ZWwgY29uZmlnXG4gICAqIEBwYXJhbSBjb250cm9sbGVyQXVkaXQgLSBDb250cm9sbGVyLWxldmVsIGF1ZGl0IGNvbmZpZ1xuICAgKiBAcGFyYW0gbWV0aG9kQXVkaXQgLSBNZXRob2QtbGV2ZWwgYXVkaXQgY29uZmlnICBcbiAgICogQHJldHVybnMgTWVyZ2VkIGF1ZGl0IGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByaXZhdGUgbWVyZ2VBdWRpdENvbmZpZ3MoY29udHJvbGxlckF1ZGl0PzogQXVkaXRDb25maWcsIG1ldGhvZEF1ZGl0PzogQXVkaXRDb25maWcpOiBBdWRpdENvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCFjb250cm9sbGVyQXVkaXQgJiYgIW1ldGhvZEF1ZGl0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmICghY29udHJvbGxlckF1ZGl0KSByZXR1cm4gbWV0aG9kQXVkaXQ7XG4gICAgaWYgKCFtZXRob2RBdWRpdCkgcmV0dXJuIGNvbnRyb2xsZXJBdWRpdDtcblxuICAgIC8vIERlZXAgbWVyZ2Ugd2l0aCBtZXRob2QtbGV2ZWwgY29uZmlnIHRha2luZyBwcmVjZWRlbmNlXG4gICAgY29uc3QgbWVyZ2VkOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgIC4uLmNvbnRyb2xsZXJBdWRpdCxcbiAgICAgIC4uLm1ldGhvZEF1ZGl0XG4gICAgfTtcblxuICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIG5lc3RlZCBvYmplY3RzXG4gICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcyB8fCBtZXRob2RBdWRpdC5pbmNsdWRlcykge1xuICAgICAgbWVyZ2VkLmluY2x1ZGVzID0ge1xuICAgICAgICAuLi5jb250cm9sbGVyQXVkaXQuaW5jbHVkZXMsXG4gICAgICAgIC4uLm1ldGhvZEF1ZGl0LmluY2x1ZGVzXG4gICAgICB9O1xuXG4gICAgICAvLyBNZXJnZSByZXF1ZXN0IGFuZCByZXNwb25zZSBhcnJheXMgaWYgYm90aCBleGlzdCBhbmQgYXJlIGFycmF5c1xuICAgICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcz8ucmVxdWVzdCAmJiBtZXRob2RBdWRpdC5pbmNsdWRlcz8ucmVxdWVzdCkge1xuICAgICAgICBjb25zdCBjb250cm9sbGVyUmVxdWVzdCA9IEFycmF5LmlzQXJyYXkoY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLnJlcXVlc3QpID8gY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLnJlcXVlc3QgOiBbXTtcbiAgICAgICAgY29uc3QgbWV0aG9kUmVxdWVzdCA9IEFycmF5LmlzQXJyYXkobWV0aG9kQXVkaXQuaW5jbHVkZXMucmVxdWVzdCkgPyBtZXRob2RBdWRpdC5pbmNsdWRlcy5yZXF1ZXN0IDogW107XG4gICAgICAgIG1lcmdlZC5pbmNsdWRlcy5yZXF1ZXN0ID0gWyAuLi5uZXcgU2V0KFsgLi4uY29udHJvbGxlclJlcXVlc3QsIC4uLm1ldGhvZFJlcXVlc3QgXSkgXTtcbiAgICAgIH1cbiAgICAgIGlmIChjb250cm9sbGVyQXVkaXQuaW5jbHVkZXM/LnJlc3BvbnNlICYmIG1ldGhvZEF1ZGl0LmluY2x1ZGVzPy5yZXNwb25zZSkge1xuICAgICAgICBjb25zdCBjb250cm9sbGVyUmVzcG9uc2UgPSBBcnJheS5pc0FycmF5KGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcy5yZXNwb25zZSkgPyBjb250cm9sbGVyQXVkaXQuaW5jbHVkZXMucmVzcG9uc2UgOiBbXTtcbiAgICAgICAgY29uc3QgbWV0aG9kUmVzcG9uc2UgPSBBcnJheS5pc0FycmF5KG1ldGhvZEF1ZGl0LmluY2x1ZGVzLnJlc3BvbnNlKSA/IG1ldGhvZEF1ZGl0LmluY2x1ZGVzLnJlc3BvbnNlIDogW107XG4gICAgICAgIG1lcmdlZC5pbmNsdWRlcy5yZXNwb25zZSA9IFsgLi4ubmV3IFNldChbIC4uLmNvbnRyb2xsZXJSZXNwb25zZSwgLi4ubWV0aG9kUmVzcG9uc2UgXSkgXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29udHJvbGxlckF1ZGl0LmRhdGFQcm90ZWN0aW9uIHx8IG1ldGhvZEF1ZGl0LmRhdGFQcm90ZWN0aW9uKSB7XG4gICAgICBtZXJnZWQuZGF0YVByb3RlY3Rpb24gPSB7XG4gICAgICAgIC4uLmNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbixcbiAgICAgICAgLi4ubWV0aG9kQXVkaXQuZGF0YVByb3RlY3Rpb25cbiAgICAgIH07XG5cbiAgICAgIC8vIE1lcmdlIGRlZXBSZWRhY3QgY29uZmlnXG4gICAgICBpZiAoY29udHJvbGxlckF1ZGl0LmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0IHx8IG1ldGhvZEF1ZGl0LmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0KSB7XG4gICAgICAgIG1lcmdlZC5kYXRhUHJvdGVjdGlvbi5kZWVwUmVkYWN0ID0ge1xuICAgICAgICAgIC4uLmNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdCxcbiAgICAgICAgICAuLi5tZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdFxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIE1lcmdlIGJsYWNrbGlzdGVkS2V5cyBhcnJheXNcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdD8uYmxhY2tsaXN0ZWRLZXlzICYmIG1ldGhvZEF1ZGl0LmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0Py5ibGFja2xpc3RlZEtleXMpIHtcbiAgICAgICAgICBtZXJnZWQuZGF0YVByb3RlY3Rpb24uZGVlcFJlZGFjdC5ibGFja2xpc3RlZEtleXMgPSBbXG4gICAgICAgICAgICAuLi5uZXcgU2V0KFtcbiAgICAgICAgICAgICAgLi4uY29udHJvbGxlckF1ZGl0LmRhdGFQcm90ZWN0aW9uLmRlZXBSZWRhY3QuYmxhY2tsaXN0ZWRLZXlzLFxuICAgICAgICAgICAgICAuLi5tZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbi5kZWVwUmVkYWN0LmJsYWNrbGlzdGVkS2V5c1xuICAgICAgICAgICAgXSlcbiAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5jdXN0b21Db250ZXh0IHx8IG1ldGhvZEF1ZGl0LmN1c3RvbUNvbnRleHQpIHtcbiAgICAgIG1lcmdlZC5jdXN0b21Db250ZXh0ID0ge1xuICAgICAgICAuLi5jb250cm9sbGVyQXVkaXQuY3VzdG9tQ29udGV4dCxcbiAgICAgICAgLi4ubWV0aG9kQXVkaXQuY3VzdG9tQ29udGV4dFxuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gbWVyZ2VkO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgcmVxdWVzdCBzdGFydFxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGNhcHR1cmVTdGFydChhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3RBdWRpdENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIHJlcXVlc3QgZW5kIChzdWNjZXNzIG9yIGVycm9yKVxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGNhcHR1cmVFbmQoYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsIHJlc3BvbnNlOiBSZXNwb25zZSwgZXJyb3I6IEVycm9yIHwgbnVsbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlQ29udGV4dCA9IHtcbiAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1c0NvZGUsXG4gICAgICByZXNwb25zZVNpemU6IHJlc3BvbnNlLmJvZHk/Lmxlbmd0aCB8fCAwLFxuICAgICAgcmVzcG9uc2U6IHRoaXMuYnVpbGRSZXNwb25zZUNvbnRleHQocmVzcG9uc2UsIGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZylcbiAgICB9O1xuXG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IsIHJlc3BvbnNlQ29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHJlcXVlc3QgY29udGV4dCBmb3IgYXVkaXQgbG9nZ2luZ1xuICAgKi9cbiAgcHJpdmF0ZSBidWlsZFJlcXVlc3RDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnKTogUmVxdWVzdEF1ZGl0Q29udGV4dCB7XG4gICAgY29uc3QgcmVxdWVzdEluY2x1ZGVzID0gYXVkaXRDb25maWcuaW5jbHVkZXM/LnJlcXVlc3Q7XG5cbiAgICAvLyBEZXRlcm1pbmUgd2hhdCB0byBpbmNsdWRlIGJhc2VkIG9uIHRoZSBjb25maWd1cmF0aW9uIGZvcm1hdFxuICAgIGxldCBpbmNsdWRlSGVhZGVycyA9IGZhbHNlLCBpbmNsdWRlQm9keSA9IGZhbHNlLCBpbmNsdWRlUXVlcnkgPSBmYWxzZTtcbiAgICBsZXQgaGVhZGVyRmllbGRzOiBzdHJpbmdbXSA9IFtdLCBib2R5RmllbGRzOiBzdHJpbmdbXSA9IFtdLCBxdWVyeUZpZWxkczogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHJlcXVlc3RJbmNsdWRlcykpIHtcbiAgICAgIC8vIExlZ2FjeSBmb3JtYXQ6IFsnaGVhZGVycycsICdib2R5JywgJ3F1ZXJ5J11cbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gcmVxdWVzdEluY2x1ZGVzLmluY2x1ZGVzKCdoZWFkZXJzJyk7XG4gICAgICBpbmNsdWRlQm9keSA9IHJlcXVlc3RJbmNsdWRlcy5pbmNsdWRlcygnYm9keScpO1xuICAgICAgaW5jbHVkZVF1ZXJ5ID0gcmVxdWVzdEluY2x1ZGVzLmluY2x1ZGVzKCdxdWVyeScpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHJlcXVlc3RJbmNsdWRlcyA9PT0gJ29iamVjdCcgJiYgcmVxdWVzdEluY2x1ZGVzICE9PSBudWxsKSB7XG4gICAgICAvLyBOZXcgc2VsZWN0aXZlIGZvcm1hdDogeyBoZWFkZXJzOiBbJ2F1dGgnXSwgYm9keTogWydlbWFpbCddLCBxdWVyeTogWydwYWdlJ10gfVxuICAgICAgaW5jbHVkZUhlYWRlcnMgPSAhIXJlcXVlc3RJbmNsdWRlcy5oZWFkZXJzO1xuICAgICAgaW5jbHVkZUJvZHkgPSAhIXJlcXVlc3RJbmNsdWRlcy5ib2R5O1xuICAgICAgaW5jbHVkZVF1ZXJ5ID0gISFyZXF1ZXN0SW5jbHVkZXMucXVlcnk7XG4gICAgICBoZWFkZXJGaWVsZHMgPSByZXF1ZXN0SW5jbHVkZXMuaGVhZGVycyB8fCBbXTtcbiAgICAgIGJvZHlGaWVsZHMgPSByZXF1ZXN0SW5jbHVkZXMuYm9keSB8fCBbXTtcbiAgICAgIHF1ZXJ5RmllbGRzID0gcmVxdWVzdEluY2x1ZGVzLnF1ZXJ5IHx8IFtdO1xuICAgIH0gZWxzZSBpZiAocmVxdWVzdEluY2x1ZGVzID09PSB0cnVlKSB7XG4gICAgICAvLyBCb29sZWFuIHRydWUgLSBpbmNsdWRlIGhlYWRlcnMgYnkgZGVmYXVsdCAobGVnYWN5IGJlaGF2aW9yKVxuICAgICAgaW5jbHVkZUhlYWRlcnMgPSB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBtZXRob2Q6IGN0eC5yZXF1ZXN0Lmh0dHBNZXRob2QsXG4gICAgICBwYXRoOiBjdHgucmVxdWVzdC5wYXRoLFxuICAgICAgdXNlckFnZW50OiBjdHguZXZlbnQuaGVhZGVycz8uWyAndXNlci1hZ2VudCcgXSxcbiAgICAgIHNvdXJjZUlwOiBjdHguZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIGhlYWRlcnM6IGluY2x1ZGVIZWFkZXJzID9cbiAgICAgICAgdGhpcy5zZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMoY3R4LnJlcXVlc3QuaGVhZGVycywgaGVhZGVyRmllbGRzKSA6IHVuZGVmaW5lZCxcbiAgICAgIGJvZHk6IGluY2x1ZGVCb2R5ID9cbiAgICAgICAgdGhpcy5zZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMoY3R4LnJlcXVlc3QuYm9keSwgYm9keUZpZWxkcykgOiB1bmRlZmluZWQsXG4gICAgICBxdWVyeTogaW5jbHVkZVF1ZXJ5ID9cbiAgICAgICAgdGhpcy5zZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMoY3R4LnJlcXVlc3QucXVlcnlTdHJpbmdQYXJhbWV0ZXJzLCBxdWVyeUZpZWxkcykgOiB1bmRlZmluZWRcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdGl2ZWx5IGluY2x1ZGVzIGZpZWxkcyBmcm9tIGFuIG9iamVjdCBiYXNlZCBvbiBmaWVsZCBsaXN0XG4gICAqIElmIG5vIGZpZWxkcyBzcGVjaWZpZWQsIHJldHVybnMgdGhlIGVudGlyZSBvYmplY3RcbiAgICovXG4gIHByaXZhdGUgc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKG9iajogYW55LCBmaWVsZHM6IHN0cmluZ1tdKTogYW55IHtcbiAgICBpZiAoIW9iaiB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBzcGVjaWZpYyBmaWVsZHMgcmVxdWVzdGVkLCByZXR1cm4gZW50aXJlIG9iamVjdFxuICAgIGlmICghZmllbGRzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IG9ubHkgc3BlY2lmaWVkIGZpZWxkc1xuICAgIGNvbnN0IHJlc3VsdDogYW55ID0ge307XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBmaWVsZHMpIHtcbiAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoZmllbGQpKSB7XG4gICAgICAgIHJlc3VsdFsgZmllbGQgXSA9IG9ialsgZmllbGQgXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdGl2ZWx5IGluY2x1ZGVzIGZpZWxkcyBmcm9tIHJlc3BvbnNlIGJvZHkgKGhhbmRsZXMgSlNPTiBzdHJpbmcgYm9kaWVzKVxuICAgKiBJZiBubyBmaWVsZHMgc3BlY2lmaWVkLCByZXR1cm5zIHRoZSBlbnRpcmUgYm9keVxuICAgKi9cbiAgcHJpdmF0ZSBzZWxlY3RpdmVseUluY2x1ZGVSZXNwb25zZUJvZHkoYm9keTogc3RyaW5nLCBmaWVsZHM6IHN0cmluZ1tdKTogYW55IHtcbiAgICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gYm9keTtcbiAgICB9XG5cbiAgICAvLyBJZiBubyBzcGVjaWZpYyBmaWVsZHMgcmVxdWVzdGVkLCByZXR1cm4gZW50aXJlIGJvZHlcbiAgICBpZiAoIWZpZWxkcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBib2R5O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBUcnkgdG8gcGFyc2UgYXMgSlNPTlxuICAgICAgY29uc3QgYm9keU9iaiA9IEpTT04ucGFyc2UoYm9keSk7XG4gICAgICBpZiAodHlwZW9mIGJvZHlPYmogPT09ICdvYmplY3QnICYmIGJvZHlPYmogIT09IG51bGwpIHtcbiAgICAgICAgLy8gQXBwbHkgZmllbGQgc2VsZWN0aW9uIGFuZCBzdHJpbmdpZnkgYmFja1xuICAgICAgICBjb25zdCBzZWxlY3RlZCA9IHRoaXMuc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKGJvZHlPYmosIGZpZWxkcyk7XG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShzZWxlY3RlZCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIE5vdCB2YWxpZCBKU09OLCByZXR1cm4gYXMtaXNcbiAgICB9XG5cbiAgICByZXR1cm4gYm9keTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgcmVzcG9uc2UgY29udGV4dCBmb3IgYXVkaXQgbG9nZ2luZ1xuICAgKi9cbiAgcHJpdmF0ZSBidWlsZFJlc3BvbnNlQ29udGV4dChyZXNwb25zZTogUmVzcG9uc2UsIGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZykge1xuICAgIGNvbnN0IHJlc3BvbnNlSW5jbHVkZXMgPSBhdWRpdENvbmZpZy5pbmNsdWRlcz8ucmVzcG9uc2U7XG4gICAgaWYgKCFyZXNwb25zZUluY2x1ZGVzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgLy8gRGV0ZXJtaW5lIHdoYXQgdG8gaW5jbHVkZSBiYXNlZCBvbiB0aGUgY29uZmlndXJhdGlvbiBmb3JtYXRcbiAgICBsZXQgaW5jbHVkZUhlYWRlcnMgPSBmYWxzZSwgaW5jbHVkZUJvZHkgPSBmYWxzZTtcbiAgICBsZXQgaGVhZGVyRmllbGRzOiBzdHJpbmdbXSA9IFtdLCBib2R5RmllbGRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmVzcG9uc2VJbmNsdWRlcykpIHtcbiAgICAgIC8vIExlZ2FjeSBmb3JtYXQ6IFsnaGVhZGVycycsICdib2R5J11cbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gcmVzcG9uc2VJbmNsdWRlcy5pbmNsdWRlcygnaGVhZGVycycpO1xuICAgICAgaW5jbHVkZUJvZHkgPSByZXNwb25zZUluY2x1ZGVzLmluY2x1ZGVzKCdib2R5Jyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcmVzcG9uc2VJbmNsdWRlcyA9PT0gJ29iamVjdCcgJiYgcmVzcG9uc2VJbmNsdWRlcyAhPT0gbnVsbCkge1xuICAgICAgLy8gTmV3IHNlbGVjdGl2ZSBmb3JtYXQ6IHsgaGVhZGVyczogWydjb250ZW50LXR5cGUnXSwgYm9keTogWydpZCcsICdzdGF0dXMnXSB9XG4gICAgICBpbmNsdWRlSGVhZGVycyA9ICEhcmVzcG9uc2VJbmNsdWRlcy5oZWFkZXJzO1xuICAgICAgaW5jbHVkZUJvZHkgPSAhIXJlc3BvbnNlSW5jbHVkZXMuYm9keTtcbiAgICAgIGhlYWRlckZpZWxkcyA9IHJlc3BvbnNlSW5jbHVkZXMuaGVhZGVycyB8fCBbXTtcbiAgICAgIGJvZHlGaWVsZHMgPSByZXNwb25zZUluY2x1ZGVzLmJvZHkgfHwgW107XG4gICAgfSBlbHNlIGlmIChyZXNwb25zZUluY2x1ZGVzID09PSB0cnVlKSB7XG4gICAgICAvLyBCb29sZWFuIHRydWUgLSBpbmNsdWRlIGhlYWRlcnMgYnkgZGVmYXVsdCAobGVnYWN5IGJlaGF2aW9yKVxuICAgICAgaW5jbHVkZUhlYWRlcnMgPSB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgaGVhZGVyczogaW5jbHVkZUhlYWRlcnMgP1xuICAgICAgICB0aGlzLnNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyhyZXNwb25zZS5oZWFkZXJzLCBoZWFkZXJGaWVsZHMpIDogdW5kZWZpbmVkLFxuICAgICAgYm9keTogaW5jbHVkZUJvZHkgP1xuICAgICAgICB0aGlzLnNlbGVjdGl2ZWx5SW5jbHVkZVJlc3BvbnNlQm9keShyZXNwb25zZS5ib2R5LCBib2R5RmllbGRzKSA6IHVuZGVmaW5lZFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY29udHJvbGxlciBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0Q29udHJvbGxlckNvbmZpZygpOiBJQ29udHJvbGxlckNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdjb250cm9sbGVyQ29uZmlnJykgfHwge307XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdHMgYWN0b3IgY29udGV4dCBmcm9tIHRoZSByZXF1ZXN0XG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGZvciBjdXN0b20gYWN0b3IgZXh0cmFjdGlvbiBsb2dpY1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gcmVxdWVzdCAtIFRoZSByZXF1ZXN0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIGFjdG9yIGNvbnRleHQuXG4gICAqIGBgYFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCk6IEFjdG9yIHtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVxdWVzdC5yZXF1ZXN0SWQ7XG5cbiAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICByZXF1ZXN0SWQsXG4gICAgICB0aW1lc3RhbXAsXG4gICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5zb3VyY2VJcCxcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVycz8uWyAndXNlci1hZ2VudCcgXSB8fCBldmVudC5oZWFkZXJzPy5bICdVc2VyLUFnZW50JyBdLFxuICAgICAgY29ycmVsYXRpb25JZDogcmVxdWVzdC5oZWFkZXJzPy5bICd4LWNvcnJlbGF0aW9uLWlkJyBdIHx8IHJlcXVlc3RJZCxcbiAgICB9O1xuXG4gICAgLy8gQ29nbml0byBhdXRoZW50aWNhdGlvbiB3aXRoIGZvY3VzZWQgZW5oYW5jZW1lbnRzXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hdXRob3JpemVyPy5jbGFpbXMpIHtcbiAgICAgIHRoaXMuZXh0cmFjdENvZ25pdG9Db250ZXh0KGV2ZW50LnJlcXVlc3RDb250ZXh0LmF1dGhvcml6ZXIuY2xhaW1zLCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFQSSBLZXkgYXV0aGVudGljYXRpb25cbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFwaUtleSB8fCByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtYXBpLWtleScgXSkge1xuICAgICAgdGhpcy5leHRyYWN0QXBpS2V5Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBJQU0gYXV0aGVudGljYXRpb24gXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuKSB7XG4gICAgICB0aGlzLmV4dHJhY3RJYW1Db250ZXh0KGV2ZW50LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFub255bW91c1xuICAgIGVsc2Uge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvcklkID0gJ2Fub255bW91cyc7XG4gICAgfVxuXG4gICAgLy8gU2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHRcbiAgICB0aGlzLmV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgIGFjdG9yLmFwaVN0YWdlID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LnN0YWdlO1xuICAgIGFjdG9yLmFwaUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmFwaUlkO1xuXG4gICAgcmV0dXJuIGFjdG9yO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQ29nbml0byBhY3RvciBjb250ZXh0IGJhc2VkIG9uIGRvY3VtZW50ZWQgQVdTIENvZ25pdG8gSldUIGNsYWltc1xuICAgKiBPbmx5IGV4dHJhY3RzIHdoYXQncyBvZmZpY2lhbGx5IGRvY3VtZW50ZWQgYW5kIGF2YWlsYWJsZSBpbiBBUEkgR2F0ZXdheSBjb250ZXh0XG4gICAqIFxuICAgKiBAcGFyYW0gY2xhaW1zIC0gQ29nbml0byBKV1QgY2xhaW1zIGZyb20gdGhlIGF1dGhvcml6ZXJcbiAgICogQHBhcmFtIGFjdG9yIC0gQWN0b3Igb2JqZWN0IHRvIHBvcHVsYXRlXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdENvZ25pdG9Db250ZXh0KGNsYWltczogYW55LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcblxuICAgICAgLy8gQWN0b3IgSUQgd2l0aCBkb2N1bWVudGVkIGZhbGxiYWNrIHN0cmF0ZWd5OiBjb2duaXRvOnVzZXJuYW1lIC0+IGVtYWlsIC0+IHN1YlxuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0gfHwgY2xhaW1zLmVtYWlsIHx8IGNsYWltcy5zdWI7XG5cbiAgICAgIC8vIFN0YW5kYXJkIHVzZXIgYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBDb2duaXRvIHVzZXIgYXR0cmlidXRlcylcbiAgICAgIGFjdG9yLmVtYWlsID0gY2xhaW1zLmVtYWlsO1xuICAgICAgYWN0b3IuZW1haWxWZXJpZmllZCA9IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IucGhvbmVOdW1iZXIgPSBjbGFpbXMucGhvbmVfbnVtYmVyO1xuICAgICAgYWN0b3IucGhvbmVWZXJpZmllZCA9IGNsYWltcy5waG9uZV9udW1iZXJfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLm5hbWUgPSBjbGFpbXMubmFtZTtcbiAgICAgIGFjdG9yLmxvY2FsZSA9IGNsYWltcy5sb2NhbGU7XG5cbiAgICAgIC8vIFBhcnNlIENvZ25pdG8gZ3JvdXBzIChkb2N1bWVudGVkIGFzIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcpXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLnBhcnNlR3JvdXBzKGNsYWltc1sgJ2NvZ25pdG86Z3JvdXBzJyBdKTtcblxuICAgICAgLy8gRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBwYXR0ZXJuOiBjdXN0b206KilcbiAgICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXMgPSB0aGlzLmV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltcyk7XG5cbiAgICAgIC8vIEJ1aWxkIENvZ25pdG8gY29udGV4dCB3aXRoIG9ubHkgZG9jdW1lbnRlZCBmaWVsZHNcbiAgICAgIGFjdG9yLmNvZ25pdG8gPSB7XG4gICAgICAgIHN1YjogY2xhaW1zLnN1YixcbiAgICAgICAgdXNlcm5hbWU6IGNsYWltc1sgJ2NvZ25pdG86dXNlcm5hbWUnIF0sXG4gICAgICAgIGdyb3VwczogZ3JvdXBzLCAvLyBBbHdheXMgaW5jbHVkZSBncm91cHMgYXJyYXkgKGVtcHR5IG9yIHBvcHVsYXRlZClcbiAgICAgICAgY3VzdG9tQXR0cmlidXRlczogT2JqZWN0LmtleXMoY3VzdG9tQXR0cmlidXRlcykubGVuZ3RoID4gMCA/IGN1c3RvbUF0dHJpYnV0ZXMgOiB1bmRlZmluZWRcbiAgICAgIH07XG5cbiAgICAgIC8vIEV4dHJhY3QgdGVuYW50IElEIGZyb20gY3VzdG9tIGF0dHJpYnV0ZXMgKGNvbW1vbiBtdWx0aS10ZW5hbnQgcGF0dGVybilcbiAgICAgIGFjdG9yLnRlbmFudElkID0gY3VzdG9tQXR0cmlidXRlcy50ZW5hbnRJZDtcblxuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignRXJyb3IgZXh0cmFjdGluZyBDb2duaXRvIGFjdG9yIGNvbnRleHQnLCB7IGVycm9yLCBjbGFpbXMgfSk7XG5cbiAgICAgIC8vIE1pbmltYWwgZmFsbGJhY2sgZXh0cmFjdGlvblxuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdjb2duaXRvJztcbiAgICAgIGFjdG9yLmFjdG9yVHlwZSA9ICd1c2VyJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXMuc3ViIHx8ICd1bmtub3duJztcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSBDb2duaXRvIGdyb3VwcyBmcm9tIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcgKGRvY3VtZW50ZWQgQ29nbml0byBmb3JtYXQpXG4gICAqL1xuICBwcm90ZWN0ZWQgcGFyc2VHcm91cHMoZ3JvdXBzOiBhbnkpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHR5cGVvZiBncm91cHMgPT09ICdzdHJpbmcnICYmIGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gZ3JvdXBzLnNwbGl0KCcsJykubWFwKGcgPT4gZy50cmltKCkpLmZpbHRlcihnID0+IGcubGVuZ3RoID4gMCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIHVzaW5nIGRvY3VtZW50ZWQgQ29nbml0byBwYXR0ZXJuIChjdXN0b206KilcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXM6IGFueSk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIE9iamVjdC5rZXlzKGNsYWltcykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGtleS5zdGFydHNXaXRoKCdjdXN0b206JykpIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGtleS5yZXBsYWNlKCdjdXN0b206JywgJycpO1xuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzWyBhdHRyaWJ1dGVOYW1lIF0gPSBjbGFpbXNbIGtleSBdO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGN1c3RvbUF0dHJpYnV0ZXM7XG4gIH1cblxuICAvKipcbiAqIEV4dHJhY3Qgc2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHQgLSBmb2N1c2VkIGFwcHJvYWNoXG4gKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICAvLyBTZXNzaW9uIGNvbnRleHRcbiAgICBhY3Rvci5zZXNzaW9uSWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsgJ3gtc2Vzc2lvbi1pZCcgXTtcblxuICAgIC8vIFRlbmFudCBjb250ZXh0IC0gY2hlY2sgY3VzdG9tIGF0dHJpYnV0ZXMgZmlyc3QsIHRoZW4gaGVhZGVyc1xuICAgIGFjdG9yLnRlbmFudElkID0gcmVxdWVzdC5oZWFkZXJzPy5bICd4LXRlbmFudC1pZCcgXSB8fFxuICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcz8uWyAnY3VzdG9tOnRlbmFudElkJyBdO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQVBJIEtleSBjb250ZXh0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhcGkta2V5JztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG5cbiAgICBsZXQgYXBpS2V5SWQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlOiAncmVxdWVzdC1jb250ZXh0JyB8ICdoZWFkZXInO1xuXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5KSB7XG4gICAgICBhcGlLZXlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleUlkIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleTtcbiAgICAgIHNvdXJjZSA9ICdyZXF1ZXN0LWNvbnRleHQnO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcGlLZXlJZCA9IHJlcXVlc3QuaGVhZGVyc1sgJ3gtYXBpLWtleScgXSE7XG4gICAgICBzb3VyY2UgPSAnaGVhZGVyJztcbiAgICB9XG5cbiAgICBhY3Rvci5hY3RvcklkID0gYGFwaS1rZXk6JHthcGlLZXlJZH1gO1xuICAgIGFjdG9yLmFwaUtleSA9IHtcbiAgICAgIGlkOiBhcGlLZXlJZCxcbiAgICAgIHNvdXJjZTogc291cmNlLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBJQU0gY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RJYW1Db250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnaWFtJztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG4gICAgYWN0b3IuYWN0b3JJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlciB8fFxuICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8XG4gICAgICAndW5rbm93bi1pYW0tdXNlcic7XG5cbiAgICBhY3Rvci5pYW0gPSB7XG4gICAgICB1c2VyQXJuOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgdW5kZWZpbmVkLFxuICAgICAgdXNlcklkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgdW5kZWZpbmVkLFxuICAgICAgYWNjb3VudElkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFjY291bnRJZCB8fCB1bmRlZmluZWQsXG4gICAgICBjYWxsZXI6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uY2FsbGVyIHx8IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG59XG4iXX0=