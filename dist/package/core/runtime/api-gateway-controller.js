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
        const request = await this.makeRequestContext(event, context);
        const response = await this.makeResponseContext(request);
        // Build the execution context
        const ctx = this.buildCtx(event, context, request, response);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUF3REEsNENBeUJDO0FBL0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFHakgscUVBQXdFO0FBV3hFLCtCQUErQjtBQUMvQixNQUFNLGlCQUFpQixHQUFpQyxJQUFJLEdBQUcsRUFBRSxDQUFDO0FBRTNELE1BQU0sYUFBYSxHQUFHLENBQUMsVUFBbUMsRUFBRSxFQUFFO0lBQ25FLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUNwQyxDQUFDLENBQUE7QUFGWSxRQUFBLGFBQWEsaUJBRXpCO0FBQ00sTUFBTSxnQkFBZ0IsR0FBRyxHQUFHLEVBQUU7SUFDbkMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDNUIsQ0FBQyxDQUFBO0FBRlksUUFBQSxnQkFBZ0Isb0JBRTVCO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILFNBQWdCLGdCQUFnQixDQUM5QixPQUlxQixFQUNyQixPQUFxRjtJQUdyRixNQUFNLEVBQUUsSUFBSSxFQUFFLElBQUksR0FBRyxFQUFFLEVBQUUsTUFBTSxHQUFHLFlBQUcsRUFBRSxHQUFHLGdCQUFnQixFQUFFLEdBQUcsT0FBTyxDQUFDO0lBR3ZFLElBQU0sb0JBQW9CLEdBQTFCLE1BQU0sb0JBQW9CO1FBRWxCLEFBQU4sS0FBSyxDQUFDLGFBQWE7WUFDakIsc0RBQXNEO1FBQ3hELENBQUM7S0FDRixDQUFBO0lBSE87UUFETCxNQUFNLENBQUMsSUFBSSxDQUFDOzZEQUdaO0lBSkcsb0JBQW9CO1FBRHpCLElBQUEsdUJBQVUsRUFBQyxJQUFJLEVBQUUsRUFBRSxHQUFHLGdCQUFnQixFQUFFLHVCQUF1QixFQUFFLEtBQUssRUFBRSxDQUFDO09BQ3BFLG9CQUFvQixDQUt6QjtJQUVELE1BQU0sQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO0lBRTdELE9BQU87UUFDTCxPQUFPO1FBQ1AsVUFBVSxFQUFFLG9CQUFvQjtLQUNqQyxDQUFDO0FBQ0osQ0FBQztBQU1ELE1BQXNCLGFBQWMsU0FBUSwrQ0FBcUI7SUFDckQsV0FBVyxHQUFpQyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3RELGNBQWMsQ0FBaUI7SUFFekMsWUFBWSxTQUE4QixFQUFFO1FBQzFDLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFBLHFDQUFtQixFQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUNuRSxDQUFDO0lBRUQ7Ozs7O01BS0U7SUFDUSxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQXVCLEVBQUUsUUFBaUI7UUFDbkUsNEJBQTRCO1FBQzVCLE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFFUyxLQUFLLENBQUMsK0NBQStDO1FBQzdELE9BQU8sT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsRUFBa0IsQ0FBQyxDQUFDO0lBQ3BELENBQUM7SUFFRCxxQ0FBcUM7SUFDM0IsYUFBYSxDQUFDLFVBQW1DO1FBQ3pELElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFUyxjQUFjO1FBQ3RCLE9BQU8sQ0FBRSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBRSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFFLENBQUM7SUFDL0UsQ0FBQztJQUVELDhCQUE4QjtJQUN0QixLQUFLLENBQUMseUJBQXlCLENBQ3JDLEtBQXFDLEVBQ3JDLE9BQWdCLEVBQ2hCLFFBQWtCLEVBQ2xCLEdBQXNCLEVBQ3RCLEtBQWE7UUFHYixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFFN0MsS0FBSyxNQUFNLFVBQVUsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUN4QyxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksVUFBVSxDQUFDLE9BQU8sSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDdkQsTUFBTSxVQUFVLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQzFELENBQUM7aUJBQU0sSUFBSSxLQUFLLEtBQUssU0FBUyxJQUFJLFVBQVUsQ0FBRSxLQUFLLENBQUUsRUFBRSxDQUFDO2dCQUN0RCxNQUFNLFVBQVUsQ0FBRSxLQUFLLENBQUcsQ0FBQyxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQ3JELENBQUM7UUFDSCxDQUFDO0lBRUgsQ0FBQztJQUVELEtBQUssQ0FBQyxRQUFRLENBQUMsY0FBdUIsRUFBRSxXQUF5RCxFQUFFLElBQXVCO1FBRXhILElBQUksZUFBZSxHQUEyQixXQUFXLENBQUM7UUFDMUQsSUFBSSxJQUFBLDZCQUFxQixFQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFFLEtBQUssRUFBRSxRQUFRLENBQUUsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxFQUFFLENBQUM7Z0JBRTFFLGVBQWUsR0FBRyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsQ0FBQTtZQUUxQyxDQUFDO2lCQUFNLElBQUksQ0FBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBRSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLFdBQVcsRUFBRSxDQUFDLEVBQUUsQ0FBQztnQkFFeEYsZUFBZSxHQUFHLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxDQUFBO1lBQ3pDLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDLElBQUEsbUNBQTJCLEVBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLElBQUksOENBQXFDLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDbkUsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQztZQUN4QyxjQUFjO1lBQ2QsV0FBVyxFQUFFLGVBQWU7WUFDNUIsYUFBYSxFQUFFLElBQUk7WUFDbkIsYUFBYSxFQUFFLGNBQWMsQ0FBQyxTQUFTO1lBQ3ZDLHVCQUF1QixFQUFFLE1BQU0sSUFBSSxDQUFDLCtDQUErQyxFQUFFO1NBQ3RGLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBc0IsRUFBRSxPQUFnQjtRQUMvRCxPQUFPLElBQUksZ0NBQWMsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUVELEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxjQUF1QjtRQUMvQyxPQUFPLElBQUksa0NBQWUsQ0FBQztZQUN6QixPQUFPLEVBQUUsY0FBYyxDQUFDLFNBQVM7WUFDakMsU0FBUyxFQUFFLGNBQWMsQ0FBQyxTQUFTO1lBQ25DLFNBQVMsRUFBRSxjQUFjLENBQUMsU0FBUztZQUNuQyxLQUFLLEVBQUUsY0FBYyxDQUFDLElBQUk7WUFDMUIsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLFdBQVcsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsSUFBSSxhQUFhO1lBQ2xELE1BQU0sRUFBRSxJQUFJLENBQUMsY0FBYztTQUM1QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxLQUFzQixFQUFFLE9BQWdCO1FBRTFELE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztRQUM5RCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUV6RCw4QkFBOEI7UUFDOUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztRQUU3RCw4REFBOEQ7UUFDOUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRTlDLHNFQUFzRTtRQUN0RSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXZELElBQUksWUFBWSxFQUFFLENBQUM7WUFDakIsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1FBQ2pHLENBQUM7UUFFRCxJQUFJLENBQUM7WUFFSCxzREFBc0Q7WUFDdEQsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztZQUV0Qyw0QkFBNEI7WUFDNUIsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFFdkUsa0RBQWtEO1lBQ2xELElBQUksS0FBSyxFQUFFLFdBQVcsRUFBRSxDQUFDO2dCQUN2QixNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO2dCQUN6RSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLENBQUM7b0JBQzNCLE1BQU0sSUFBSSw4QkFBcUIsQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDM0QsQ0FBQztZQUNILENBQUM7WUFFRCwwQkFBMEI7WUFDMUIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ25ELElBQUksa0JBQWtCLEdBQVEsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUMvRSxJQUFJLGtCQUFrQixZQUFZLE9BQU8sRUFBRSxDQUFDO2dCQUMxQyxrQkFBa0IsR0FBRyxNQUFNLGtCQUFrQixDQUFDO1lBQ2hELENBQUM7WUFFRCwyQkFBMkI7WUFDM0IsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFFdEUsOEJBQThCO1lBQzlCLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQ3RELENBQUM7WUFFRCxxRkFBcUY7WUFDckYsSUFBSSxrQkFBa0IsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDL0IsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDakQsQ0FBQztRQUVILENBQUM7UUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1lBRWIsTUFBTSxRQUFRLEdBQUcsR0FBRyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUNyRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxRQUFRLENBQUMsQ0FBQztZQUVyRCwyQkFBMkI7WUFDM0IsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1lBRWxGLHlCQUF5QjtZQUN6QixJQUFJLFlBQVksRUFBRSxDQUFDO2dCQUNqQixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztZQUMxRCxDQUFDO1lBRUQsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDM0QsQ0FBQztRQUVELDRDQUE0QztRQUM1QyxPQUFPLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUMxQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNLLGlCQUFpQixDQUFDLFdBQW9CO1FBQzVDLElBQUksVUFBVSxHQUFRLElBQUksQ0FBQztRQUUzQiw2R0FBNkc7UUFDN0csSUFBSSxrQkFBa0IsR0FBRyxJQUFJLFVBQVUsQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUN6RCxJQUFJLG1CQUFtQixHQUFHLEdBQUcsQ0FBQztRQUU5QiwrRUFBK0U7UUFDL0UsMEVBQTBFO1FBQzFFLE1BQU0sYUFBYSxHQUFHLFdBQVcsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN0RSxNQUFNLG1CQUFtQixHQUFHLFVBQVUsQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVqRixxRUFBcUU7UUFDckUsSUFBSSxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUMxQixJQUFJLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNuQyw2REFBNkQ7WUFDN0QsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQzVFLElBQUksT0FBTyxHQUFHLElBQUksQ0FBQztnQkFDbkIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO29CQUNwRCxJQUFJLGFBQWEsQ0FBRSxDQUFDLEdBQUcsQ0FBQyxDQUFFLEtBQUssbUJBQW1CLENBQUUsQ0FBQyxDQUFFLEVBQUUsQ0FBQzt3QkFDeEQsT0FBTyxHQUFHLEtBQUssQ0FBQzt3QkFDaEIsTUFBTTtvQkFDUixDQUFDO2dCQUNILENBQUM7Z0JBQ0QsSUFBSSxPQUFPLEVBQUUsQ0FBQztvQkFDWixnQkFBZ0IsR0FBRyxDQUFDLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQztvQkFDdEQsTUFBTTtnQkFDUixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLGdCQUFnQixJQUFJLENBQUMsRUFBRSxDQUFDO1lBQzFCLGlEQUFpRDtZQUNqRCxNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUNuRSxrQkFBa0IsR0FBRyxHQUFHLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNuRCxNQUFNLGNBQWMsR0FBRyxhQUFhLENBQUMsS0FBSyxDQUFDLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQ2pFLG1CQUFtQixHQUFHLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDO1FBQ3pGLENBQUM7YUFBTSxDQUFDO1lBQ04sOENBQThDO1lBQzlDLElBQUksV0FBVyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO2dCQUN4RCxtQkFBbUIsR0FBRyxXQUFXLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsSUFBSSxHQUFHLENBQUM7WUFDekYsQ0FBQztRQUNILENBQUM7UUFFRCx5RUFBeUU7UUFDekUsTUFBTSxZQUFZLEdBQThDLEVBQUUsQ0FBQztRQUNuRSxNQUFNLG9CQUFvQixHQUE4QyxFQUFFLENBQUM7UUFFM0UsbURBQW1EO1FBQ25ELEtBQUssTUFBTSxDQUFFLFFBQVEsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUF3QixFQUFFLENBQUM7WUFDakcsTUFBTSxDQUFFLFdBQVcsRUFBRSxTQUFTLENBQUUsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBRXZELG9DQUFvQztZQUNwQyxJQUFJLFdBQVcsS0FBSyxXQUFXLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQzNDLFNBQVM7WUFDWCxDQUFDO1lBRUQsd0JBQXdCO1lBQ3hCLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZELG9CQUFvQixDQUFDLElBQUksQ0FBQyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ2pELENBQUM7aUJBQU0sQ0FBQztnQkFDTixZQUFZLENBQUMsSUFBSSxDQUFDLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDekMsQ0FBQztRQUNILENBQUM7UUFFRCwwREFBMEQ7UUFDMUQsS0FBSyxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQy9DLE1BQU0sQ0FBRSxBQUFELEVBQUcsU0FBUyxDQUFFLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUU1QyxJQUFJLFNBQVMsS0FBSyxtQkFBbUIsRUFBRSxDQUFDO2dCQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsUUFBUSxFQUFFLENBQUMsQ0FBQztnQkFDOUQsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1FBQ0gsQ0FBQztRQUVELGdFQUFnRTtRQUNoRSxxRkFBcUY7UUFDckYsTUFBTSwwQkFBMEIsR0FBRyxvQkFBb0I7YUFDcEQsR0FBRyxDQUFDLENBQUMsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUMzQixNQUFNLENBQUUsQUFBRCxFQUFHLFNBQVMsQ0FBRSxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDNUMsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDdEQsTUFBTSxlQUFlLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBRTNFLDBEQUEwRDtZQUMxRCxvRUFBb0U7WUFDcEUsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLGVBQWUsQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQztZQUUzRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsZ0JBQWdCLEVBQUUsQ0FBQztRQUMxRCxDQUFDLENBQUM7YUFDRCxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxxQkFBcUI7UUFFakYsS0FBSyxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsSUFBSSwwQkFBMEIsRUFBRSxDQUFDO1lBQ3hFLDZEQUE2RDtZQUM3RCxNQUFNLG1CQUFtQixHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsY0FBYyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBRXJFLElBQUksQ0FBQztnQkFDSCxtREFBbUQ7Z0JBQ25ELE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztnQkFDNUMsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLG1CQUFtQixFQUFFLEVBQUUsTUFBTSxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztnQkFDM0UsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUM7Z0JBRWpELElBQUksV0FBVyxFQUFFLENBQUM7b0JBQ2hCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHdDQUF3QyxRQUFRLEVBQUUsRUFBRTt3QkFDcEUsT0FBTyxFQUFFLG1CQUFtQjt3QkFDNUIsTUFBTSxFQUFFLFdBQVcsQ0FBQyxNQUFNO3dCQUMxQixnQkFBZ0IsRUFBRSwwQkFBMEIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxLQUFLLFFBQVEsQ0FBQyxFQUFFLGdCQUFnQjtxQkFDbEcsQ0FBQyxDQUFDO29CQUVILHVFQUF1RTtvQkFDdkUsc0RBQXNEO29CQUN0RCxPQUFPLEtBQUssQ0FBQztnQkFDZixDQUFDO1lBQ0gsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0NBQWdDLG1CQUFtQixHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7Z0JBQ2hGLFNBQVM7WUFDWCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixXQUFXLENBQUMsVUFBVSxJQUFJLG1CQUFtQixFQUFFLENBQUMsQ0FBQztRQUNqRyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ssZ0JBQWdCLENBQUMsS0FBbUI7UUFDMUMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ1gsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN4QyxDQUFDO1FBRUQsWUFBWTtRQUNaLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBRSxLQUFLLENBQUMsWUFBWSxDQUFFLENBQUM7UUFFakQsT0FBTyxPQUFPLGFBQWEsS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDOUYsQ0FBQztJQUVEOzs7O09BSUc7SUFDTyxjQUFjLENBQUMsSUFBYTtRQUNwQyxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUM7WUFDekIsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxDQUFDO1NBQ3JELENBQUMsQ0FBQztJQUNMLENBQUM7SUFFUyxZQUFZLENBQTBCO0lBQ3RDLGVBQWU7UUFDdkIsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN2QixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUEsMkJBQWtCLEdBQUUsQ0FBQztRQUMzQyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDO0lBQzNCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNPLGVBQWUsQ0FBQyxHQUFZLEVBQUUsR0FBVSxFQUFFLEdBQWE7UUFDL0QsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDNUQsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzVDLENBQUM7SUFFUyxjQUFjLENBQUMsR0FBcUM7UUFDNUQsSUFBSSxHQUFHLFlBQVksa0NBQWUsRUFBRSxDQUFDO1lBQ25DLE9BQU8sR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JCLENBQUM7UUFDRCxPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQXFDRztJQUNPLFFBQVEsQ0FBQyxLQUFzQixFQUFFLE9BQWdCLEVBQUUsT0FBZ0IsRUFBRSxRQUFrQjtRQUMvRixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXZELE1BQU0sR0FBRyxHQUFxQjtZQUM1QixLQUFLO1lBQ0wsYUFBYSxFQUFFLE9BQU87WUFDdEIsT0FBTztZQUNQLFFBQVE7WUFDUixLQUFLO1lBQ0wsU0FBUyxFQUFFLEVBQUU7WUFFYixrQ0FBa0M7WUFDbEMsWUFBWSxFQUFFLENBQUMsV0FBMkIsRUFBRSxFQUFFO2dCQUM1QyxJQUFJLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztvQkFDZCxNQUFNLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7Z0JBQ3hDLENBQUM7WUFDSCxDQUFDO1NBQ0YsQ0FBQztRQUVGLE9BQU8sR0FBRyxDQUFDO0lBQ2IsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ08sZ0JBQWdCLENBQUMsR0FBcUIsRUFBRSxLQUFvQjtRQUNwRSxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUUxQyx3REFBd0Q7UUFDeEQsTUFBTSxlQUFlLEdBQUcsTUFBTSxFQUFFLEtBQUssQ0FBQztRQUN0QyxNQUFNLFdBQVcsR0FBRyxLQUFLLEVBQUUsS0FBSyxDQUFDO1FBQ2pDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGVBQWUsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUUvRSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFDO1FBRTdDLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxLQUFLLEVBQUUsYUFBYTtZQUN6QixHQUFHLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLGtCQUFrQixDQUFDO1lBQ3pDLEdBQUcsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDO1FBRTNDLE1BQU0sYUFBYSxHQUFHLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsV0FBVyxFQUFFLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNwRixNQUFNLFdBQVcsR0FBRyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxJQUFJLGFBQWEsRUFBRSxDQUFDO1FBRWhFLE9BQU87WUFDTCxPQUFPLEVBQUUsSUFBSTtZQUNiLE9BQU8sRUFBRSxLQUFLO1lBQ2QsT0FBTyxFQUFFLGFBQWE7WUFDdEIsVUFBVSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSTtZQUNqQyxTQUFTLEVBQUUsYUFBYTtZQUN4QixRQUFRLEVBQUUsaUJBQWlCLENBQUMsUUFBUTtZQUNwQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUs7WUFDaEIsV0FBVyxFQUFFO2dCQUNYLGFBQWE7Z0JBQ2IsV0FBVztnQkFDWCxpQkFBaUIsRUFBRSxHQUFHLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLHVCQUF1QixDQUFDO2dCQUNqRSxhQUFhLEVBQUUsS0FBSztnQkFDcEIsYUFBYTtnQkFDYixjQUFjLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7YUFDekM7WUFDRCxXQUFXLEVBQUUsaUJBQWlCO1NBQy9CLENBQUM7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0ssaUJBQWlCLENBQUMsZUFBNkIsRUFBRSxXQUF5QjtRQUNoRixJQUFJLENBQUMsZUFBZSxJQUFJLENBQUMsV0FBVztZQUFFLE9BQU8sU0FBUyxDQUFDO1FBQ3ZELElBQUksQ0FBQyxlQUFlO1lBQUUsT0FBTyxXQUFXLENBQUM7UUFDekMsSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFPLGVBQWUsQ0FBQztRQUV6Qyx3REFBd0Q7UUFDeEQsTUFBTSxNQUFNLEdBQWdCO1lBQzFCLEdBQUcsZUFBZTtZQUNsQixHQUFHLFdBQVc7U0FDZixDQUFDO1FBRUYsc0NBQXNDO1FBQ3RDLElBQUksZUFBZSxDQUFDLFFBQVEsSUFBSSxXQUFXLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDckQsTUFBTSxDQUFDLFFBQVEsR0FBRztnQkFDaEIsR0FBRyxlQUFlLENBQUMsUUFBUTtnQkFDM0IsR0FBRyxXQUFXLENBQUMsUUFBUTthQUN4QixDQUFDO1lBRUYsaUVBQWlFO1lBQ2pFLElBQUksZUFBZSxDQUFDLFFBQVEsRUFBRSxPQUFPLElBQUksV0FBVyxDQUFDLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQztnQkFDdkUsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ2xILE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDdEcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxpQkFBaUIsRUFBRSxHQUFHLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNuRixDQUFDO1lBQ0QsSUFBSSxlQUFlLENBQUMsUUFBUSxFQUFFLFFBQVEsSUFBSSxXQUFXLENBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxDQUFDO2dCQUN6RSxNQUFNLGtCQUFrQixHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDckgsTUFBTSxjQUFjLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUN6RyxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLGtCQUFrQixFQUFFLEdBQUcsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3RGLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxlQUFlLENBQUMsY0FBYyxJQUFJLFdBQVcsQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUNqRSxNQUFNLENBQUMsY0FBYyxHQUFHO2dCQUN0QixHQUFHLGVBQWUsQ0FBQyxjQUFjO2dCQUNqQyxHQUFHLFdBQVcsQ0FBQyxjQUFjO2FBQzlCLENBQUM7WUFFRiwwQkFBMEI7WUFDMUIsSUFBSSxlQUFlLENBQUMsY0FBYyxFQUFFLFVBQVUsSUFBSSxXQUFXLENBQUMsY0FBYyxFQUFFLFVBQVUsRUFBRSxDQUFDO2dCQUN6RixNQUFNLENBQUMsY0FBYyxDQUFDLFVBQVUsR0FBRztvQkFDakMsR0FBRyxlQUFlLENBQUMsY0FBYyxFQUFFLFVBQVU7b0JBQzdDLEdBQUcsV0FBVyxDQUFDLGNBQWMsRUFBRSxVQUFVO2lCQUMxQyxDQUFDO2dCQUVGLCtCQUErQjtnQkFDL0IsSUFBSSxlQUFlLENBQUMsY0FBYyxFQUFFLFVBQVUsRUFBRSxlQUFlLElBQUksV0FBVyxDQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUUsZUFBZSxFQUFFLENBQUM7b0JBQzNILE1BQU0sQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLGVBQWUsR0FBRzt3QkFDakQsR0FBRyxJQUFJLEdBQUcsQ0FBQzs0QkFDVCxHQUFHLGVBQWUsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLGVBQWU7NEJBQzVELEdBQUcsV0FBVyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsZUFBZTt5QkFDekQsQ0FBQztxQkFDSCxDQUFDO2dCQUNKLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksZUFBZSxDQUFDLGFBQWEsSUFBSSxXQUFXLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDL0QsTUFBTSxDQUFDLGFBQWEsR0FBRztnQkFDckIsR0FBRyxlQUFlLENBQUMsYUFBYTtnQkFDaEMsR0FBRyxXQUFXLENBQUMsYUFBYTthQUM3QixDQUFDO1FBQ0osQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRDs7T0FFRztJQUNPLEtBQUssQ0FBQyxZQUFZLENBQUMsWUFBMEIsRUFBRSxjQUFtQztRQUMxRixNQUFNLG1DQUFtQixDQUFDLFlBQVksQ0FBQyxZQUFZLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVEOztPQUVHO0lBQ08sS0FBSyxDQUFDLFVBQVUsQ0FBQyxZQUEwQixFQUFFLFFBQWtCLEVBQUUsS0FBbUI7UUFDNUYsTUFBTSxlQUFlLEdBQUc7WUFDdEIsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVO1lBQy9CLFlBQVksRUFBRSxRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sSUFBSSxDQUFDO1lBQ3hDLFFBQVEsRUFBRSxJQUFJLENBQUMsb0JBQW9CLENBQUMsUUFBUSxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUM7U0FDeEUsQ0FBQztRQUVGLE1BQU0sbUNBQW1CLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBQ25GLENBQUM7SUFFRDs7T0FFRztJQUNLLG1CQUFtQixDQUFDLEdBQXFCLEVBQUUsV0FBd0I7UUFDekUsTUFBTSxlQUFlLEdBQUcsV0FBVyxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUM7UUFFdEQsOERBQThEO1FBQzlELElBQUksY0FBYyxHQUFHLEtBQUssRUFBRSxXQUFXLEdBQUcsS0FBSyxFQUFFLFlBQVksR0FBRyxLQUFLLENBQUM7UUFDdEUsSUFBSSxZQUFZLEdBQWEsRUFBRSxFQUFFLFVBQVUsR0FBYSxFQUFFLEVBQUUsV0FBVyxHQUFhLEVBQUUsQ0FBQztRQUV2RixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztZQUNuQyw4Q0FBOEM7WUFDOUMsY0FBYyxHQUFHLGVBQWUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDckQsV0FBVyxHQUFHLGVBQWUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDL0MsWUFBWSxHQUFHLGVBQWUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDbkQsQ0FBQzthQUFNLElBQUksT0FBTyxlQUFlLEtBQUssUUFBUSxJQUFJLGVBQWUsS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUMzRSxnRkFBZ0Y7WUFDaEYsY0FBYyxHQUFHLENBQUMsQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDO1lBQzNDLFdBQVcsR0FBRyxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQztZQUNyQyxZQUFZLEdBQUcsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUM7WUFDdkMsWUFBWSxHQUFHLGVBQWUsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDO1lBQzdDLFVBQVUsR0FBRyxlQUFlLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUN4QyxXQUFXLEdBQUcsZUFBZSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDNUMsQ0FBQzthQUFNLElBQUksZUFBZSxLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3BDLDhEQUE4RDtZQUM5RCxjQUFjLEdBQUcsSUFBSSxDQUFDO1FBQ3hCLENBQUM7UUFFRCxPQUFPO1lBQ0wsTUFBTSxFQUFFLEdBQUcsQ0FBQyxPQUFPLENBQUMsVUFBVTtZQUM5QixJQUFJLEVBQUUsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJO1lBQ3RCLFNBQVMsRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLFlBQVksQ0FBQztZQUM1QyxRQUFRLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLFFBQVE7WUFDdEQsT0FBTyxFQUFFLGNBQWMsQ0FBQyxDQUFDO2dCQUN2QixJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDOUUsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO2dCQUNqQixJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDekUsS0FBSyxFQUFFLFlBQVksQ0FBQyxDQUFDO2dCQUNuQixJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUM1RixDQUFDO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNLLHdCQUF3QixDQUFDLEdBQVEsRUFBRSxNQUFnQjtRQUN6RCxJQUFJLENBQUMsR0FBRyxJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3BDLE9BQU8sR0FBRyxDQUFDO1FBQ2IsQ0FBQztRQUVELHdEQUF3RDtRQUN4RCxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ25CLE9BQU8sR0FBRyxDQUFDO1FBQ2IsQ0FBQztRQUVELGdDQUFnQztRQUNoQyxNQUFNLE1BQU0sR0FBUSxFQUFFLENBQUM7UUFDdkIsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLEVBQUUsQ0FBQztZQUMzQixJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDOUIsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUM3QixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRDs7O09BR0c7SUFDSyw4QkFBOEIsQ0FBQyxJQUFZLEVBQUUsTUFBZ0I7UUFDbkUsSUFBSSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN0QyxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxzREFBc0Q7UUFDdEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNuQixPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCx1QkFBdUI7WUFDdkIsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNqQyxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssSUFBSSxFQUFFLENBQUM7Z0JBQ3BELDJDQUEyQztnQkFDM0MsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDaEUsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ2xDLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLCtCQUErQjtRQUNqQyxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxvQkFBb0IsQ0FBQyxRQUFrQixFQUFFLFdBQXdCO1FBQ3ZFLE1BQU0sZ0JBQWdCLEdBQUcsV0FBVyxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUM7UUFDeEQsSUFBSSxDQUFDLGdCQUFnQjtZQUFFLE9BQU8sU0FBUyxDQUFDO1FBRXhDLDhEQUE4RDtRQUM5RCxJQUFJLGNBQWMsR0FBRyxLQUFLLEVBQUUsV0FBVyxHQUFHLEtBQUssQ0FBQztRQUNoRCxJQUFJLFlBQVksR0FBYSxFQUFFLEVBQUUsVUFBVSxHQUFhLEVBQUUsQ0FBQztRQUUzRCxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDO1lBQ3BDLHFDQUFxQztZQUNyQyxjQUFjLEdBQUcsZ0JBQWdCLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3RELFdBQVcsR0FBRyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDbEQsQ0FBQzthQUFNLElBQUksT0FBTyxnQkFBZ0IsS0FBSyxRQUFRLElBQUksZ0JBQWdCLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDN0UsOEVBQThFO1lBQzlFLGNBQWMsR0FBRyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxDQUFDO1lBQzVDLFdBQVcsR0FBRyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDO1lBQ3RDLFlBQVksR0FBRyxnQkFBZ0IsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDO1lBQzlDLFVBQVUsR0FBRyxnQkFBZ0IsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQzNDLENBQUM7YUFBTSxJQUFJLGdCQUFnQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3JDLDhEQUE4RDtZQUM5RCxjQUFjLEdBQUcsSUFBSSxDQUFDO1FBQ3hCLENBQUM7UUFFRCxPQUFPO1lBQ0wsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVO1lBQy9CLE9BQU8sRUFBRSxjQUFjLENBQUMsQ0FBQztnQkFDdkIsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDM0UsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO2dCQUNqQixJQUFJLENBQUMsOEJBQThCLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUM3RSxDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ08sbUJBQW1CO1FBQzNCLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDckQsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ08sbUJBQW1CLENBQUMsS0FBc0IsRUFBRSxPQUFnQjtRQUNwRSxNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQzNDLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxTQUFTLENBQUM7UUFFcEMsTUFBTSxLQUFLLEdBQVU7WUFDbkIsU0FBUztZQUNULFNBQVM7WUFDVCxRQUFRLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsUUFBUTtZQUNsRCxTQUFTLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxZQUFZLENBQUM7WUFDekUsYUFBYSxFQUFFLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLFNBQVM7U0FDbEUsQ0FBQztRQUVGLG1EQUFtRDtRQUNuRCxJQUFJLEtBQUssQ0FBQyxjQUFjLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxDQUFDO1lBQzdDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDNUUsQ0FBQztRQUNELHlCQUF5QjthQUNwQixJQUFJLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE1BQU0sSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUNsRixJQUFJLENBQUMsb0JBQW9CLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNuRCxDQUFDO1FBQ0Qsc0JBQXNCO2FBQ2pCLElBQUksS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLENBQUM7WUFDakQsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN2QyxDQUFDO1FBQ0QsWUFBWTthQUNQLENBQUM7WUFDSixLQUFLLENBQUMsVUFBVSxHQUFHLFdBQVcsQ0FBQztZQUMvQixLQUFLLENBQUMsU0FBUyxHQUFHLFdBQVcsQ0FBQztZQUM5QixLQUFLLENBQUMsT0FBTyxHQUFHLFdBQVcsQ0FBQztRQUM5QixDQUFDO1FBRUQsNkJBQTZCO1FBQzdCLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRTNELHNCQUFzQjtRQUN0QixLQUFLLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDO1FBQzdDLEtBQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUM7UUFFMUMsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ08scUJBQXFCLENBQUMsTUFBVyxFQUFFLEtBQVk7UUFDdkQsSUFBSSxDQUFDO1lBQ0gsS0FBSyxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUM7WUFDN0IsS0FBSyxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUM7WUFFekIsK0VBQStFO1lBQy9FLEtBQUssQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLGtCQUFrQixDQUFDLElBQUksTUFBTSxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDO1lBRXpFLGdFQUFnRTtZQUNoRSxLQUFLLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUM7WUFDM0IsS0FBSyxDQUFDLGFBQWEsR0FBRyxNQUFNLENBQUMsY0FBYyxLQUFLLE1BQU0sQ0FBQztZQUN2RCxLQUFLLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUM7WUFDeEMsS0FBSyxDQUFDLGFBQWEsR0FBRyxNQUFNLENBQUMscUJBQXFCLEtBQUssTUFBTSxDQUFDO1lBQzlELEtBQUssQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztZQUN6QixLQUFLLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFFN0IsOERBQThEO1lBQzlELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQztZQUUxRCwyREFBMkQ7WUFDM0QsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFOUQsb0RBQW9EO1lBQ3BELEtBQUssQ0FBQyxPQUFPLEdBQUc7Z0JBQ2QsR0FBRyxFQUFFLE1BQU0sQ0FBQyxHQUFHO2dCQUNmLFFBQVEsRUFBRSxNQUFNLENBQUMsa0JBQWtCLENBQUM7Z0JBQ3BDLE1BQU0sRUFBRSxNQUFNLEVBQUUsbURBQW1EO2dCQUNuRSxnQkFBZ0IsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLFNBQVM7YUFDMUYsQ0FBQztZQUVGLHlFQUF5RTtZQUN6RSxLQUFLLENBQUMsUUFBUSxHQUFHLGdCQUFnQixDQUFDLFFBQVEsQ0FBQztZQUUzQyxLQUFLLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQztRQUVoQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHdDQUF3QyxFQUFFLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFOUUsOEJBQThCO1lBQzlCLEtBQUssQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFDO1lBQzdCLEtBQUssQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDO1lBQ3pCLEtBQUssQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLEdBQUcsSUFBSSxTQUFTLENBQUM7WUFDeEMsS0FBSyxDQUFDLGNBQWMsR0FBRyxNQUFNLENBQUM7UUFDaEMsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNPLFdBQVcsQ0FBQyxNQUFXO1FBQy9CLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDcEQsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDeEUsQ0FBQztRQUNELE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVEOztPQUVHO0lBQ08sdUJBQXVCLENBQUMsTUFBVztRQUMzQyxNQUFNLGdCQUFnQixHQUF3QixFQUFFLENBQUM7UUFFakQsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDaEMsSUFBSSxHQUFHLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQzlCLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUNqRCxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDaEQsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxnQkFBZ0IsQ0FBQztJQUMxQixDQUFDO0lBRUM7O0tBRUM7SUFDTyw4QkFBOEIsQ0FBQyxLQUFzQixFQUFFLE9BQWdCLEVBQUUsS0FBWTtRQUM3RixrQkFBa0I7UUFDbEIsS0FBSyxDQUFDLFNBQVMsR0FBRyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUMsY0FBYyxDQUFDLENBQUM7UUFFcEQsK0RBQStEO1FBQy9ELEtBQUssQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLGFBQWEsQ0FBQztZQUNqQyxLQUFLLENBQUMsY0FBYyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ2hGLENBQUM7SUFFRDs7T0FFRztJQUNPLG9CQUFvQixDQUFDLEtBQXNCLEVBQUUsT0FBZ0IsRUFBRSxLQUFZO1FBQ25GLEtBQUssQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFDO1FBQzdCLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBRTVCLElBQUksUUFBZ0IsQ0FBQztRQUNyQixJQUFJLE1BQW9DLENBQUM7UUFFekMsSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQztZQUMzQyxRQUFRLEdBQUcsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsUUFBUSxJQUFJLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQztZQUMxRixNQUFNLEdBQUcsaUJBQWlCLENBQUM7UUFDN0IsQ0FBQzthQUFNLENBQUM7WUFDTixRQUFRLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUUsQ0FBQztZQUN6QyxNQUFNLEdBQUcsUUFBUSxDQUFDO1FBQ3BCLENBQUM7UUFFRCxLQUFLLENBQUMsT0FBTyxHQUFHLFdBQVcsUUFBUSxFQUFFLENBQUM7UUFDdEMsS0FBSyxDQUFDLE1BQU0sR0FBRztZQUNiLEVBQUUsRUFBRSxRQUFRO1lBQ1osTUFBTSxFQUFFLE1BQU07U0FDZixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ08saUJBQWlCLENBQUMsS0FBc0IsRUFBRSxLQUFZO1FBQzlELEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDO1FBQ3pCLEtBQUssQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzVCLEtBQUssQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsSUFBSTtZQUNyQyxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxPQUFPO1lBQ3ZDLGtCQUFrQixDQUFDO1FBRWxDLEtBQUssQ0FBQyxHQUFHLEdBQUc7WUFDVixPQUFPLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTyxJQUFJLFNBQVM7WUFDN0QsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLElBQUksSUFBSSxTQUFTO1lBQ3pELFNBQVMsRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxTQUFTLElBQUksU0FBUztZQUNqRSxNQUFNLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsTUFBTSxJQUFJLFNBQVM7U0FDNUQsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQTUyQkQsc0NBNDJCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSwgUm91dGUgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgR2V0LCBSb3V0ZU1ldGhvZHMgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9tZXRob2RcIjtcbmltcG9ydCB7IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIElucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgaXNIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlLCBpc0lucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvbi91dGlsc1wiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IFJlcXVlc3RDb250ZXh0IH0gZnJvbSBcIi4vcmVxdWVzdC1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbnRleHQgfSBmcm9tIFwiLi9yZXNwb25zZS1jb250ZXh0XCI7XG5pbXBvcnQgeyBSZXNwb25zZUNvbmZpZywgbWVyZ2VSZXNwb25zZUNvbmZpZyB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbmZpZ1wiO1xuaW1wb3J0IHsgVmFsaWRhdGlvbkZhaWxlZEVycm9yLCBJbnZhbGlkSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZUVycm9yLCBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vZXJyb3JzL1wiO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBBdWRpdENvbnRleHQsIFJlcXVlc3RBdWRpdENvbnRleHQsIEF1ZGl0Q29uZmlnIH0gZnJvbSAnLi4vLi4vYXVkaXQvaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBdWRpdENhcHR1cmVTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vYXVkaXQvaGVscGVycy9hdWRpdC1oZWxwZXJzJztcblxuZXhwb3J0IHR5cGUgQ29udHJvbGxlckVycm9ySGFuZGxlciA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZUVycm9ySGFuZGxlcj47XG5cbi8vIE5ldyBpbnRlcmZhY2VzIGZvciBtaWRkbGV3YXJlIGFuZCBlcnJvciBoYW5kbGluZ1xuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyTWlkZGxld2FyZSB7XG4gIGJlZm9yZT86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIGFmdGVyPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgb25FcnJvcj86IChlcnJvcjogRXJyb3IsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuLy8gR2xvYmFsIG1pZGRsZXdhcmUgbWFuYWdlbWVudFxuY29uc3QgZ2xvYmFsTWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG5cbmV4cG9ydCBjb25zdCB1c2VNaWRkbGV3YXJlID0gKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmFkZChtaWRkbGV3YXJlKTtcbn1cbmV4cG9ydCBjb25zdCBjbGVhck1pZGRsZXdhcmVzID0gKCkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5jbGVhcigpO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gQVBJIGhhbmRsZXIgd2l0aG91dCBkZWZpbmluZyBhIGNsYXNzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogZXhwb3J0IGNvbnN0IHsgaGFuZGxlciwgZGVzY3JpcHRvciB9ID0gY3JlYXRlQXBpSGFuZGxlcihcbiAqICB7IG1ldGhvZDogR2V0LCBuYW1lOiAnZGVtbycsIGF1dGhvcml6ZXI6ICdOT05FJyB9LFxuICogICBhc3luYyAoIGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICogICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gKiAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICogICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJIZWxsbyBXb3JsZCFcIn0pXG4gKiAgICAgICB9KVxuICogICB9XG4gKiApXG4gKiBgYGBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5wYXRoIC0gVGhlIHBhdGggZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLm1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHJldHVybnMgQW4gb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgZnVuY3Rpb24gYW5kIHRoZSBjb250cm9sbGVyIGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBcGlIYW5kbGVyKFxuICBvcHRpb25zOiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHBhdGg/OiBzdHJpbmcsXG4gICAgbWV0aG9kPzogUm91dGVNZXRob2RzLFxuICB9ICYgSUNvbnRyb2xsZXJDb25maWcsXG4gIGhhbmRsZXI6IChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4sXG4pIHtcblxuICBjb25zdCB7IG5hbWUsIHBhdGggPSAnJywgbWV0aG9kID0gR2V0LCAuLi5jb250cm9sbGVyQ29uZmlnIH0gPSBvcHRpb25zO1xuXG4gIEBDb250cm9sbGVyKG5hbWUsIHsgLi4uY29udHJvbGxlckNvbmZpZywgYXV0b0V4cG9ydExhbWJkYUhhbmRsZXI6IGZhbHNlIH0pXG4gIGNsYXNzIENvbnRyb2xsZXJEZXNjcmlwdG9yIHtcbiAgICBAbWV0aG9kKHBhdGgpXG4gICAgYXN5bmMgaW5saW5lSGFuZGxlcigpIHtcbiAgICAgIC8vIHBsYWNlaG9sZGVyIGZ1bmN0aW9uIG9ubHkgdXNlZCBmb3Igcm91dGluZyBtZXRhZGF0YVxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShoYW5kbGVyLCAnbmFtZScsIHsgdmFsdWU6ICdoYW5kbGVyJyB9KTtcblxuICByZXR1cm4ge1xuICAgIGhhbmRsZXIsXG4gICAgZGVzY3JpcHRvcjogQ29udHJvbGxlckRlc2NyaXB0b3JcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBUElDb250cm9sbGVyQ29uZmlnIHtcbiAgcmVzcG9uc2VDb25maWc/OiBQYXJ0aWFsPFJlc3BvbnNlQ29uZmlnPjtcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFQSUNvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuICBwcm90ZWN0ZWQgbWlkZGxld2FyZXM6IFNldDxBUElDb250cm9sbGVyTWlkZGxld2FyZT4gPSBuZXcgU2V0KCk7XG4gIHByb3RlY3RlZCByZXNwb25zZUNvbmZpZzogUmVzcG9uc2VDb25maWc7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBBUElDb250cm9sbGVyQ29uZmlnID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzcG9uc2VDb25maWcgPSBtZXJnZVJlc3BvbnNlQ29uZmlnKGNvbmZpZy5yZXNwb25zZUNvbmZpZyk7XG4gIH1cblxuICAvKipcbiAgICogY2FuIGJlIHVzZWQgdG8gcnVuIHNvbWUgbG9naWMganVzdCBiZWZvcmUgdGhlIHJlcXVlc3QgaXMgcHJvY2Vzc2VkIGxpa2UgY3JlYXRpbmcgY2xpZW50cywgZGktaW5qZWN0aW9uIGFucyBzbyBvbi5cbiAgICogQHBhcmFtIF9ldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBfY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgY29udHJvbGxlciBpcyBpbml0aWFsaXplZC5cbiAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8tb3AgZm9yIEFQSSBjb250cm9sbGVyc1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBnZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICB9XG5cbiAgLy8gQWRkIG1pZGRsZXdhcmUgcmVnaXN0cmF0aW9uIG1ldGhvZFxuICBwcm90ZWN0ZWQgdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkge1xuICAgIHRoaXMubWlkZGxld2FyZXMuYWRkKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCkge1xuICAgIHJldHVybiBbIC4uLkFycmF5LmZyb20oZ2xvYmFsTWlkZGxld2FyZXMpLCAuLi5BcnJheS5mcm9tKHRoaXMubWlkZGxld2FyZXMpIF07XG4gIH1cblxuICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKFxuICAgIHBoYXNlOiAnYmVmb3JlJyB8ICdhZnRlcicgfCAnb25FcnJvcicsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCxcbiAgICBlcnJvcj86IEVycm9yXG4gICk6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYWxsTWlkZGxld2FyZXMgPSB0aGlzLmdldE1pZGRsZXdhcmVzKCk7XG5cbiAgICBmb3IgKGNvbnN0IG1pZGRsZXdhcmUgb2YgYWxsTWlkZGxld2FyZXMpIHtcbiAgICAgIGlmIChwaGFzZSA9PT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmUub25FcnJvciAmJiBlcnJvcikge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlLm9uRXJyb3IoZXJyb3IsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfSBlbHNlIGlmIChwaGFzZSAhPT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmVbIHBoYXNlIF0pIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZVsgcGhhc2UgXSEocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9XG4gICAgfVxuXG4gIH1cblxuICBhc3luYyB2YWxpZGF0ZShyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCwgdmFsaWRhdGlvbnM6IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgbGV0IHZhbGlkYXRpb25SdWxlczogSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyA9IHZhbGlkYXRpb25zO1xuICAgIGlmIChpc0lucHV0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvbnMpKSB7XG4gICAgICBpZiAoWyAnR0VUJywgJ0RFTEVURScgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBxdWVyeTogdmFsaWRhdGlvbnMgfVxuXG4gICAgICB9IGVsc2UgaWYgKFsgJ1BPU1QnLCAnUFVUJywgJ1BBVENIJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IGJvZHk6IHZhbGlkYXRpb25zIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9uUnVsZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvcih2YWxpZGF0aW9uUnVsZXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHtcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25SdWxlcyxcbiAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsXG4gICAgICB2ZXJib3NlRXJyb3JzOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgdGhpcy5nZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVxdWVzdENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UmVxdWVzdD4ge1xuICAgIHJldHVybiBuZXcgUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCk6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlQ29udGV4dCh7XG4gICAgICB0cmFjZUlkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIGRlYnVnTW9kZTogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgcm91dGU6IHJlcXVlc3RDb250ZXh0LnBhdGgsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAnZGV2ZWxvcG1lbnQnLFxuICAgICAgY29uZmlnOiB0aGlzLnJlc3BvbnNlQ29uZmlnXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBjb250cm9sbGVyLlxuICAgKiBIYW5kbGVzIGluY29taW5nIEFQSSBHYXRld2F5IGV2ZW50cy5cbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIFRoZSBBUEkgR2F0ZXdheSByZXNwb25zZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuXG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0KTtcblxuICAgIC8vIEJ1aWxkIHRoZSBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IGN0eCA9IHRoaXMuYnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcblxuICAgIC8vIEZpbmQgdGhlIG1hdGNoaW5nIHJvdXRlIGZpcnN0IGZvciBtZXRob2QtbGV2ZWwgYXVkaXQgY29uZmlnXG4gICAgY29uc3Qgcm91dGUgPSB0aGlzLmZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpO1xuXG4gICAgLy8gQ3JlYXRlIGF1ZGl0IGNvbnRleHQgd2l0aCByb3V0ZSBpbmZvcm1hdGlvbiBmb3IgbWV0aG9kLWxldmVsIGNvbmZpZ1xuICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IHRoaXMubWFrZUF1ZGl0Q29udGV4dChjdHgsIHJvdXRlKTtcbiAgICBcbiAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICBhd2FpdCB0aGlzLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHRoaXMuYnVpbGRSZXF1ZXN0Q29udGV4dChjdHgsIGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZykpO1xuICAgIH1cblxuICAgIHRyeSB7XG5cbiAgICAgIC8vIExlZ2FjeSBpbml0aWFsaXplIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKGV2ZW50LCBjb250ZXh0KTtcblxuICAgICAgLy8gRXhlY3V0ZSBiZWZvcmUgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgLy8gVmFsaWRhdGUgdGhlIHJlcXVlc3QgaWYgdmFsaWRhdGlvbnMgYXJlIGRlZmluZWRcbiAgICAgIGlmIChyb3V0ZT8udmFsaWRhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgdmFsaWRhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGUocmVxdWVzdCwgcm91dGUudmFsaWRhdGlvbnMpO1xuICAgICAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQucGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IodmFsaWRhdGlvblJlc3VsdC5lcnJvcnMpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIGNhbGwgdGhlIHJvdXRlIGZ1bmN0aW9uXG4gICAgICBjb25zdCByb3V0ZUZ1bmN0aW9uID0gdGhpcy5nZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKTtcbiAgICAgIGxldCBjb250cm9sbGVyUmVzcG9uc2U6IGFueSA9IHJvdXRlRnVuY3Rpb24uY2FsbCh0aGlzLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgIGNvbnRyb2xsZXJSZXNwb25zZSA9IGF3YWl0IGNvbnRyb2xsZXJSZXNwb25zZTtcbiAgICAgIH1cblxuICAgICAgLy8gRXhlY3V0ZSBhZnRlciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2FmdGVyJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIC8vIENhcHR1cmUgc3VjY2Vzc2Z1bCByZXNwb25zZVxuICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCByZXNwb25zZSwgbnVsbCk7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBjb250cm9sbGVyIHJldHVybmVkIGFueXRoaW5nIChSZXNwb25zZUNvbnRleHQgb3IgcmF3IEFQSSByZXN1bHQpLCBlbWl0IHRoYXRcbiAgICAgIGlmIChjb250cm9sbGVyUmVzcG9uc2UgIT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShjb250cm9sbGVyUmVzcG9uc2UpO1xuICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyKSB7XG5cbiAgICAgIGNvbnN0IGVycm9yT2JqID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoU3RyaW5nKGVycikpO1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0xhbWJkYUhhbmRsZXIgZXJyb3I6ICcsIGVycm9yT2JqKTtcblxuICAgICAgLy8gRXhlY3V0ZSBlcnJvciBtaWRkbGV3YXJlXG4gICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ29uRXJyb3InLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvck9iaik7XG5cbiAgICAgIC8vIENhcHR1cmUgZXJyb3IgcmVzcG9uc2VcbiAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzcG9uc2UsIGVycm9yT2JqKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRXhjZXB0aW9uKHJlcXVlc3QsIGVycm9yT2JqLCByZXNwb25zZSk7XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2sgdG8gdGhlIGluLW1lbW9yeSByZXNwb25zZUNvbnRleHRcbiAgICByZXR1cm4gcmVzcG9uc2UuYnVpbGQoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgcm91dGUgdGhhdCBtYXRjaGVzIHRoZSBIVFRQIG1ldGhvZCBhbmQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSByZXF1ZXN0RGF0YSAtIFRoZSByZXF1ZXN0IGRhdGEgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgbWF0Y2hpbmcgcm91dGUgb3IgbnVsbCBpZiBub3QgZm91bmQuXG4gICAqL1xuICBwcml2YXRlIGZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhOiBSZXF1ZXN0KTogUm91dGUgfCBudWxsIHtcbiAgICBsZXQgY29udHJvbGxlcjogYW55ID0gdGhpcztcblxuICAgIC8vIERldGVybWluZSB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggYnkgZmluZGluZyB0aGUgbG9uZ2VzdCBjb21tb24gcHJlZml4IHRoYXQgZW5kcyB3aXRoIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICBsZXQgY29udHJvbGxlckJhc2VQYXRoID0gYC8ke2NvbnRyb2xsZXIuY29udHJvbGxlck5hbWV9YDtcbiAgICBsZXQgcmVzb3VyY2VXaXRob3V0Um9vdCA9ICcvJztcblxuICAgIC8vIEZvciBjb250cm9sbGVycyBpbiBzdWJkaXJlY3Rvcmllcywgd2UgbmVlZCB0byBtYXRjaCB0aGUgYWN0dWFsIHJlc291cmNlIHBhdGhcbiAgICAvLyBDaGVjayBpZiByZXNvdXJjZSBjb250YWlucyB0aGUgY29udHJvbGxlciBuYW1lIGFzIHBhcnQgb2YgYSBsb25nZXIgcGF0aFxuICAgIGNvbnN0IHJlc291cmNlUGFydHMgPSByZXF1ZXN0RGF0YS5yZXNvdXJjZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZVBhcnRzID0gY29udHJvbGxlci5jb250cm9sbGVyTmFtZS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcblxuICAgIC8vIEZpbmQgaWYgdGhlIGNvbnRyb2xsZXIgbmFtZSBwYXJ0cyBhcmUgcHJlc2VudCBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgIGxldCBiYXNlUGF0aEVuZEluZGV4ID0gLTE7XG4gICAgaWYgKGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gTG9vayBmb3IgdGhlIGNvbnRyb2xsZXIgbmFtZSBzZXF1ZW5jZSBpbiB0aGUgcmVzb3VyY2UgcGF0aFxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gcmVzb3VyY2VQYXJ0cy5sZW5ndGggLSBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGxldCBtYXRjaGVzID0gdHJ1ZTtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgaWYgKHJlc291cmNlUGFydHNbIGkgKyBqIF0gIT09IGNvbnRyb2xsZXJOYW1lUGFydHNbIGogXSkge1xuICAgICAgICAgICAgbWF0Y2hlcyA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgYmFzZVBhdGhFbmRJbmRleCA9IGkgKyBjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmFzZVBhdGhFbmRJbmRleCA+PSAwKSB7XG4gICAgICAvLyBGb3VuZCB0aGUgY29udHJvbGxlciBiYXNlIHBhdGggaW4gdGhlIHJlc291cmNlXG4gICAgICBjb25zdCBiYXNlUGF0aFBhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZSgwLCBiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICBjb250cm9sbGVyQmFzZVBhdGggPSAnLycgKyBiYXNlUGF0aFBhcnRzLmpvaW4oJy8nKTtcbiAgICAgIGNvbnN0IHJlbWFpbmluZ1BhcnRzID0gcmVzb3VyY2VQYXJ0cy5zbGljZShiYXNlUGF0aEVuZEluZGV4ICsgMSk7XG4gICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVtYWluaW5nUGFydHMubGVuZ3RoID4gMCA/ICcvJyArIHJlbWFpbmluZ1BhcnRzLmpvaW4oJy8nKSA6ICcvJztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRmFsbGJhY2sgdG8gb3JpZ2luYWwgbG9naWMgZm9yIHNpbXBsZSBjYXNlc1xuICAgICAgaWYgKHJlcXVlc3REYXRhLnJlc291cmNlLnN0YXJ0c1dpdGgoY29udHJvbGxlckJhc2VQYXRoKSkge1xuICAgICAgICByZXNvdXJjZVdpdGhvdXRSb290ID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3Vic3RyaW5nKGNvbnRyb2xsZXJCYXNlUGF0aC5sZW5ndGgpIHx8ICcvJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXBhcmF0ZSByb3V0ZXMgaW50byBleGFjdCBhbmQgcGFyYW1ldGVyaXplZCBmb3IgcHJvcGVyIHByaW9yaXRpemF0aW9uXG4gICAgY29uc3QgZXhhY3RNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuICAgIGNvbnN0IHBhcmFtZXRlcml6ZWRNYXRjaGVzOiBBcnJheTx7IHJvdXRlS2V5OiBzdHJpbmcsIHJvdXRlOiBSb3V0ZSB9PiA9IFtdO1xuXG4gICAgLy8gRmlyc3QgcGFzczogY2F0ZWdvcml6ZSByb3V0ZXMgYnkgdHlwZSBhbmQgbWV0aG9kXG4gICAgZm9yIChjb25zdCBbIHJvdXRlS2V5LCByb3V0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRyb2xsZXIucm91dGVzIHx8IHt9KSBhcyBbIHN0cmluZywgUm91dGUgXVtdKSB7XG4gICAgICBjb25zdCBbIHJvdXRlTWV0aG9kLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIC8vIFNraXAgaWYgSFRUUCBtZXRob2QgZG9lc24ndCBtYXRjaFxuICAgICAgaWYgKHJvdXRlTWV0aG9kICE9PSByZXF1ZXN0RGF0YS5odHRwTWV0aG9kKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDYXRlZ29yaXplIHJvdXRlIHR5cGVcbiAgICAgIGlmIChyb3V0ZVBhdGguaW5jbHVkZXMoJ3snKSAmJiByb3V0ZVBhdGguaW5jbHVkZXMoJ30nKSkge1xuICAgICAgICBwYXJhbWV0ZXJpemVkTWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhhY3RNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2Vjb25kIHBhc3M6IFRyeSBleGFjdCBtYXRjaGVzIGZpcnN0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUgfSBvZiBleGFjdE1hdGNoZXMpIHtcbiAgICAgIGNvbnN0IFsgLCByb3V0ZVBhdGggXSA9IHJvdXRlS2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmIChyb3V0ZVBhdGggPT09IHJlc291cmNlV2l0aG91dFJvb3QpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIGV4YWN0IG1hdGNoIGZvciByb3V0ZTogJHtyb3V0ZUtleX1gKTtcbiAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXJkIHBhc3M6IFRyeSBwYXJhbWV0ZXJpemVkIG1hdGNoZXMgKHNvcnRlZCBieSBzcGVjaWZpY2l0eSlcbiAgICAvLyBTb3J0IHBhcmFtZXRlcml6ZWQgcm91dGVzIGJ5IHNwZWNpZmljaXR5IChtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgcHJpb3JpdHkpXG4gICAgY29uc3Qgc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMgPSBwYXJhbWV0ZXJpemVkTWF0Y2hlc1xuICAgICAgLm1hcCgoeyByb3V0ZUtleSwgcm91dGUgfSkgPT4ge1xuICAgICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJvdXRlUGF0aC5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgY29uc3QgbGl0ZXJhbFNlZ21lbnRzID0gc2VnbWVudHMuZmlsdGVyKHNlZ21lbnQgPT4gIXNlZ21lbnQuaW5jbHVkZXMoJ3snKSk7XG5cbiAgICAgICAgLy8gU3BlY2lmaWNpdHkgc2NvcmU6IG1vcmUgbGl0ZXJhbCBzZWdtZW50cyA9IGhpZ2hlciBzY29yZVxuICAgICAgICAvLyBGb3IgZXF1YWwgbGl0ZXJhbCBzZWdtZW50cywgZmV3ZXIgdG90YWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmUgIFxuICAgICAgICBjb25zdCBzcGVjaWZpY2l0eVNjb3JlID0gKGxpdGVyYWxTZWdtZW50cy5sZW5ndGggKiAxMDAwKSAtIHNlZ21lbnRzLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4geyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCwgc3BlY2lmaWNpdHlTY29yZSB9O1xuICAgICAgfSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnNwZWNpZmljaXR5U2NvcmUgLSBhLnNwZWNpZmljaXR5U2NvcmUpOyAvLyBIaWdoZXIgc2NvcmUgZmlyc3RcblxuICAgIGZvciAoY29uc3QgeyByb3V0ZUtleSwgcm91dGUsIHJvdXRlUGF0aCB9IG9mIHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzKSB7XG4gICAgICAvLyBDb252ZXJ0IGZyYW1ld29yayB7aWR9IHN5bnRheCB0byBwYXRoLXRvLXJlZ2V4cCA6aWQgc3ludGF4XG4gICAgICBjb25zdCBwYXRoVG9SZWdleHBQYXR0ZXJuID0gcm91dGVQYXRoLnJlcGxhY2UoL1xceyhbXn1dKylcXH0vZywgJzokMScpO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2UgcGF0aC10by1yZWdleHAgZm9yIHByb3BlciBwYXJhbWV0ZXIgbWF0Y2hpbmdcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gcmVxdWlyZSgncGF0aC10by1yZWdleHAnKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlciA9IG1hdGNoKHBhdGhUb1JlZ2V4cFBhdHRlcm4sIHsgZGVjb2RlOiBkZWNvZGVVUklDb21wb25lbnQgfSk7XG4gICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gbWF0Y2hlcihyZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgICAgICBpZiAobWF0Y2hSZXN1bHQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgcGFyYW1ldGVyaXplZCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCwge1xuICAgICAgICAgICAgcGF0dGVybjogcGF0aFRvUmVnZXhwUGF0dGVybixcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hSZXN1bHQucGFyYW1zLFxuICAgICAgICAgICAgc3BlY2lmaWNpdHlTY29yZTogc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMuZmluZChtID0+IG0ucm91dGVLZXkgPT09IHJvdXRlS2V5KT8uc3BlY2lmaWNpdHlTY29yZVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gTm90ZTogV2UgZG9uJ3QgbmVlZCB0byBtYW51YWxseSBleHRyYWN0IHBhcmFtZXRlcnMgc2luY2UgQVBJIEdhdGV3YXlcbiAgICAgICAgICAvLyBhbHJlYWR5IHByb3ZpZGVzIHRoZW0gaW4gcmVxdWVzdERhdGEucGF0aFBhcmFtZXRlcnNcbiAgICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEVycm9yIG1hdGNoaW5nIHJvdXRlIHBhdHRlcm4gJHtwYXRoVG9SZWdleHBQYXR0ZXJufTpgLCBlcnJvcik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIG1hdGNoaW5nIHJvdXRlIGZvdW5kIGZvciAke3JlcXVlc3REYXRhLmh0dHBNZXRob2R9fCR7cmVzb3VyY2VXaXRob3V0Um9vdH1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqIEBwYXJhbSByb3V0ZSAtIFRoZSBtYXRjaGVkIHJvdXRlLlxuICAgKiBAcmV0dXJucyBUaGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0Um91dGVGdW5jdGlvbihyb3V0ZTogUm91dGUgfCBudWxsKTogRnVuY3Rpb24ge1xuICAgIGlmICghcm91dGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gICAgfVxuXG4gICAgLy9AdHMtaWdub3JlXG4gICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXNbIHJvdXRlLmZ1bmN0aW9uTmFtZSBdO1xuXG4gICAgcmV0dXJuIHR5cGVvZiByb3V0ZUZ1bmN0aW9uID09PSBcImZ1bmN0aW9uXCIgPyByb3V0ZUZ1bmN0aW9uIDogdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgdGhlIE5vdEZvdW5kIHJvdXRlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNDA0IHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZU5vdEZvdW5kKF9yZXE6IFJlcXVlc3QpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJObyBSb3V0ZSBGb3VuZCFcIiB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlcnJvckhhbmRsZXI/OiBDb250cm9sbGVyRXJyb3JIYW5kbGVyO1xuICBwcm90ZWN0ZWQgZ2V0RXJyb3JIYW5kbGVyKCk6IENvbnRyb2xsZXJFcnJvckhhbmRsZXIge1xuICAgIGlmICghdGhpcy5lcnJvckhhbmRsZXIpIHtcbiAgICAgIHRoaXMuZXJyb3JIYW5kbGVyID0gY3JlYXRlRXJyb3JIYW5kbGVyKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmVycm9ySGFuZGxlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGV4Y2VwdGlvbnMgYW5kIHJldHVybnMgYSBKU09OIHJlc3BvbnNlIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0gZXJyIC0gVGhlIGVycm9yIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNTAwIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogUmVzcG9uc2UpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSB0aGlzLmdldEVycm9ySGFuZGxlcigpKGVyciwgcmVxLCByZXMpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGVycm9yUmVzcG9uc2UpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVJlc3BvbnNlKHJlczogUmVzcG9uc2UgfCBBUElHYXRld2F5UHJveHlSZXN1bHQpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGlmIChyZXMgaW5zdGFuY2VvZiBSZXNwb25zZUNvbnRleHQpIHtcbiAgICAgIHJldHVybiByZXMuYnVpbGQoKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGV4ZWN1dGlvbiBjb250ZXh0IGZvciB0aGUgcmVxdWVzdFxuICAgKiBcbiAgICogZGlmZmVyZW50IG1pZGRsZXdhcmUgY2FuIGVuaGFuY2UgdGhlIGFjdG9yIGNvbnRleHQgYnkgdXNpbmcgdGhlIGVuaGFuY2VBY3RvciBtZXRob2RcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHNcbiAgICogY29uc3QgbWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gICAqICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdCwgX3Jlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICBjdHg/LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICogICAgIHJvbGVzOiBbJ2FkbWluJywgJ3VzZXInXSxcbiAgICogICAgIHBlcm1pc3Npb25zOiBbJ3JlYWQnLCAnd3JpdGUnXSxcbiAgICogICAgIHN1YnNjcmlwdGlvbjogeyB0aWVyOiAnZW50ZXJwcmlzZScgfVxuICAgKiAgIH0pO1xuICAgKiAgfVxuICAgKiB9XG4gICAqXG4gICAqIHVzZU1pZGRsZXdhcmUobWlkZGxld2FyZSk7XG4gICAqIFxuICAgKiBPUlxuICAgKiBcbiAgICogY29uc3Qgc2VjdXJpdHlNaWRkbGV3YXJlID0ge1xuICAgKiAgIGJlZm9yZTogYXN5bmMgKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpID0+IHtcbiAgICogICAgIGN0eC5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICAgIHJpc2tQcm9maWxlOiBhd2FpdCBhc3Nlc3NSaXNrKGN0eC5hY3Rvci5hY3RvcklkKSxcbiAgICogICAgICAgZGV2aWNlOiBhd2FpdCBtYWtlRGV2aWNlQ29udGV4dChyZXF1ZXN0KVxuICAgKiAgICAgfSk7XG4gICAqICAgfVxuICAgKiB9O1xuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKHNlY3VyaXR5TWlkZGxld2FyZSk7XG4gICAqXG4gICAqIEBwYXJhbSBldmVudCBcbiAgICogQHBhcmFtIGNvbnRleHQgXG4gICAqIEBwYXJhbSByZXF1ZXN0IFxuICAgKiBAcGFyYW0gcmVzcG9uc2UgXG4gICAqIEByZXR1cm5zIFxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIGNvbnN0IGFjdG9yID0gdGhpcy5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcbiAgICBcbiAgICBjb25zdCBjdHg6IEV4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICBldmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICByZXF1ZXN0LFxuICAgICAgcmVzcG9uc2UsXG4gICAgICBhY3RvcixcbiAgICAgIGRlYnVnSW5mbzoge30sXG4gICAgICBcbiAgICAgIC8vIFNpbXBsZSBhY3RvciBlbmhhbmNlbWVudCBtZXRob2RcbiAgICAgIGVuaGFuY2VBY3RvcjogKGVuaGFuY2VtZW50OiBQYXJ0aWFsPEFjdG9yPikgPT4ge1xuICAgICAgICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgICAgICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIGVuaGFuY2VtZW50KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gY3R4O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYXVkaXQgY29udGV4dCBmb3IgdGhlIHJlcXVlc3QgZm9sbG93aW5nIHRoZSBleGlzdGluZyBidWlsZEN0eCBwYXR0ZXJuXG4gICAqIEBwYXJhbSBjdHggLSBUaGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICogQHBhcmFtIHJvdXRlIC0gVGhlIG1hdGNoZWQgcm91dGUgKG9wdGlvbmFsLCBmb3IgbWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZylcbiAgICogQHJldHVybnMgQXVkaXRDb250ZXh0IG9yIG51bGwgaWYgYXVkaXQgaXMgZGlzYWJsZWRcbiAgICovXG4gIHByb3RlY3RlZCBtYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgcm91dGU/OiBSb3V0ZSB8IG51bGwpOiBBdWRpdENvbnRleHQgfCBudWxsIHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldENvbnRyb2xsZXJDb25maWcoKTtcbiAgICBcbiAgICAvLyBNZXJnZSBjb250cm9sbGVyLWxldmVsIGFuZCBtZXRob2QtbGV2ZWwgYXVkaXQgY29uZmlnc1xuICAgIGNvbnN0IGNvbnRyb2xsZXJBdWRpdCA9IGNvbmZpZz8uYXVkaXQ7XG4gICAgY29uc3QgbWV0aG9kQXVkaXQgPSByb3V0ZT8uYXVkaXQ7XG4gICAgY29uc3QgbWVyZ2VkQXVkaXRDb25maWcgPSB0aGlzLm1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJBdWRpdCwgbWV0aG9kQXVkaXQpO1xuICAgIFxuICAgIGlmICghbWVyZ2VkQXVkaXRDb25maWc/LmVuYWJsZWQpIHJldHVybiBudWxsO1xuICAgIFxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBjdHguYWN0b3I/LmNvcnJlbGF0aW9uSWQgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgY3R4LnJlcXVlc3QuaGVhZGVycz8uWyd4LWNvcnJlbGF0aW9uLWlkJ10gfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgY3R4LnJlcXVlc3QucmVxdWVzdElkO1xuICAgIFxuICAgIGNvbnN0IG9wZXJhdGlvbk5hbWUgPSBgJHtjdHgucmVxdWVzdC5odHRwTWV0aG9kLnRvTG93ZXJDYXNlKCl9XyR7Y3R4LnJlcXVlc3QucGF0aH1gO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke29wZXJhdGlvbk5hbWV9YDtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIGxvZ1R5cGU6ICdsb2cnLFxuICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICAgIGVudGl0eU5hbWU6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIG9wZXJhdGlvbjogb3BlcmF0aW9uTmFtZSxcbiAgICAgIGNhdGVnb3J5OiBtZXJnZWRBdWRpdENvbmZpZy5jYXRlZ29yeSxcbiAgICAgIGFjdG9yOiBjdHguYWN0b3IsXG4gICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBvcGVyYXRpb25JZCxcbiAgICAgICAgcGFyZW50T3BlcmF0aW9uSWQ6IGN0eC5yZXF1ZXN0LmhlYWRlcnM/LlsneC1wYXJlbnQtb3BlcmF0aW9uLWlkJ10sXG4gICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknLFxuICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICBzdGFydFRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9LFxuICAgICAgYXVkaXRDb25maWc6IG1lcmdlZEF1ZGl0Q29uZmlnXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgY29udHJvbGxlci1sZXZlbCBhbmQgbWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZ3VyYXRpb25zXG4gICAqIE1ldGhvZC1sZXZlbCBjb25maWcgdGFrZXMgcHJlY2VkZW5jZSBvdmVyIGNvbnRyb2xsZXItbGV2ZWwgY29uZmlnXG4gICAqIEBwYXJhbSBjb250cm9sbGVyQXVkaXQgLSBDb250cm9sbGVyLWxldmVsIGF1ZGl0IGNvbmZpZ1xuICAgKiBAcGFyYW0gbWV0aG9kQXVkaXQgLSBNZXRob2QtbGV2ZWwgYXVkaXQgY29uZmlnICBcbiAgICogQHJldHVybnMgTWVyZ2VkIGF1ZGl0IGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByaXZhdGUgbWVyZ2VBdWRpdENvbmZpZ3MoY29udHJvbGxlckF1ZGl0PzogQXVkaXRDb25maWcsIG1ldGhvZEF1ZGl0PzogQXVkaXRDb25maWcpOiBBdWRpdENvbmZpZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCFjb250cm9sbGVyQXVkaXQgJiYgIW1ldGhvZEF1ZGl0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmICghY29udHJvbGxlckF1ZGl0KSByZXR1cm4gbWV0aG9kQXVkaXQ7XG4gICAgaWYgKCFtZXRob2RBdWRpdCkgcmV0dXJuIGNvbnRyb2xsZXJBdWRpdDtcbiAgICBcbiAgICAvLyBEZWVwIG1lcmdlIHdpdGggbWV0aG9kLWxldmVsIGNvbmZpZyB0YWtpbmcgcHJlY2VkZW5jZVxuICAgIGNvbnN0IG1lcmdlZDogQXVkaXRDb25maWcgPSB7XG4gICAgICAuLi5jb250cm9sbGVyQXVkaXQsXG4gICAgICAuLi5tZXRob2RBdWRpdFxuICAgIH07XG4gICAgXG4gICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgbmVzdGVkIG9iamVjdHNcbiAgICBpZiAoY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzIHx8IG1ldGhvZEF1ZGl0LmluY2x1ZGVzKSB7XG4gICAgICBtZXJnZWQuaW5jbHVkZXMgPSB7XG4gICAgICAgIC4uLmNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcyxcbiAgICAgICAgLi4ubWV0aG9kQXVkaXQuaW5jbHVkZXNcbiAgICAgIH07XG4gICAgICBcbiAgICAgIC8vIE1lcmdlIHJlcXVlc3QgYW5kIHJlc3BvbnNlIGFycmF5cyBpZiBib3RoIGV4aXN0IGFuZCBhcmUgYXJyYXlzXG4gICAgICBpZiAoY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzPy5yZXF1ZXN0ICYmIG1ldGhvZEF1ZGl0LmluY2x1ZGVzPy5yZXF1ZXN0KSB7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJSZXF1ZXN0ID0gQXJyYXkuaXNBcnJheShjb250cm9sbGVyQXVkaXQuaW5jbHVkZXMucmVxdWVzdCkgPyBjb250cm9sbGVyQXVkaXQuaW5jbHVkZXMucmVxdWVzdCA6IFtdO1xuICAgICAgICBjb25zdCBtZXRob2RSZXF1ZXN0ID0gQXJyYXkuaXNBcnJheShtZXRob2RBdWRpdC5pbmNsdWRlcy5yZXF1ZXN0KSA/IG1ldGhvZEF1ZGl0LmluY2x1ZGVzLnJlcXVlc3QgOiBbXTtcbiAgICAgICAgbWVyZ2VkLmluY2x1ZGVzLnJlcXVlc3QgPSBbLi4ubmV3IFNldChbLi4uY29udHJvbGxlclJlcXVlc3QsIC4uLm1ldGhvZFJlcXVlc3RdKV07XG4gICAgICB9XG4gICAgICBpZiAoY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzPy5yZXNwb25zZSAmJiBtZXRob2RBdWRpdC5pbmNsdWRlcz8ucmVzcG9uc2UpIHtcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc3BvbnNlID0gQXJyYXkuaXNBcnJheShjb250cm9sbGVyQXVkaXQuaW5jbHVkZXMucmVzcG9uc2UpID8gY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLnJlc3BvbnNlIDogW107XG4gICAgICAgIGNvbnN0IG1ldGhvZFJlc3BvbnNlID0gQXJyYXkuaXNBcnJheShtZXRob2RBdWRpdC5pbmNsdWRlcy5yZXNwb25zZSkgPyBtZXRob2RBdWRpdC5pbmNsdWRlcy5yZXNwb25zZSA6IFtdO1xuICAgICAgICBtZXJnZWQuaW5jbHVkZXMucmVzcG9uc2UgPSBbLi4ubmV3IFNldChbLi4uY29udHJvbGxlclJlc3BvbnNlLCAuLi5tZXRob2RSZXNwb25zZV0pXTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbiB8fCBtZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbikge1xuICAgICAgbWVyZ2VkLmRhdGFQcm90ZWN0aW9uID0ge1xuICAgICAgICAuLi5jb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24sXG4gICAgICAgIC4uLm1ldGhvZEF1ZGl0LmRhdGFQcm90ZWN0aW9uXG4gICAgICB9O1xuICAgICAgXG4gICAgICAvLyBNZXJnZSBkZWVwUmVkYWN0IGNvbmZpZ1xuICAgICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdCB8fCBtZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdCkge1xuICAgICAgICBtZXJnZWQuZGF0YVByb3RlY3Rpb24uZGVlcFJlZGFjdCA9IHtcbiAgICAgICAgICAuLi5jb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3QsXG4gICAgICAgICAgLi4ubWV0aG9kQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3RcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIC8vIE1lcmdlIGJsYWNrbGlzdGVkS2V5cyBhcnJheXNcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdD8uYmxhY2tsaXN0ZWRLZXlzICYmIG1ldGhvZEF1ZGl0LmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0Py5ibGFja2xpc3RlZEtleXMpIHtcbiAgICAgICAgICBtZXJnZWQuZGF0YVByb3RlY3Rpb24uZGVlcFJlZGFjdC5ibGFja2xpc3RlZEtleXMgPSBbXG4gICAgICAgICAgICAuLi5uZXcgU2V0KFtcbiAgICAgICAgICAgICAgLi4uY29udHJvbGxlckF1ZGl0LmRhdGFQcm90ZWN0aW9uLmRlZXBSZWRhY3QuYmxhY2tsaXN0ZWRLZXlzLFxuICAgICAgICAgICAgICAuLi5tZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbi5kZWVwUmVkYWN0LmJsYWNrbGlzdGVkS2V5c1xuICAgICAgICAgICAgXSlcbiAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIGlmIChjb250cm9sbGVyQXVkaXQuY3VzdG9tQ29udGV4dCB8fCBtZXRob2RBdWRpdC5jdXN0b21Db250ZXh0KSB7XG4gICAgICBtZXJnZWQuY3VzdG9tQ29udGV4dCA9IHtcbiAgICAgICAgLi4uY29udHJvbGxlckF1ZGl0LmN1c3RvbUNvbnRleHQsXG4gICAgICAgIC4uLm1ldGhvZEF1ZGl0LmN1c3RvbUNvbnRleHRcbiAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBtZXJnZWQ7XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciByZXF1ZXN0IHN0YXJ0XG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgcmVxdWVzdCBlbmQgKHN1Y2Nlc3Mgb3IgZXJyb3IpXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZUVuZChhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBlcnJvcjogRXJyb3IgfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzcG9uc2VDb250ZXh0ID0ge1xuICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzQ29kZSxcbiAgICAgIHJlc3BvbnNlU2l6ZTogcmVzcG9uc2UuYm9keT8ubGVuZ3RoIHx8IDAsXG4gICAgICByZXNwb25zZTogdGhpcy5idWlsZFJlc3BvbnNlQ29udGV4dChyZXNwb25zZSwgYXVkaXRDb250ZXh0LmF1ZGl0Q29uZmlnKVxuICAgIH07XG4gICAgXG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IsIHJlc3BvbnNlQ29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHJlcXVlc3QgY29udGV4dCBmb3IgYXVkaXQgbG9nZ2luZ1xuICAgKi9cbiAgcHJpdmF0ZSBidWlsZFJlcXVlc3RDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnKTogUmVxdWVzdEF1ZGl0Q29udGV4dCB7XG4gICAgY29uc3QgcmVxdWVzdEluY2x1ZGVzID0gYXVkaXRDb25maWcuaW5jbHVkZXM/LnJlcXVlc3Q7XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIHdoYXQgdG8gaW5jbHVkZSBiYXNlZCBvbiB0aGUgY29uZmlndXJhdGlvbiBmb3JtYXRcbiAgICBsZXQgaW5jbHVkZUhlYWRlcnMgPSBmYWxzZSwgaW5jbHVkZUJvZHkgPSBmYWxzZSwgaW5jbHVkZVF1ZXJ5ID0gZmFsc2U7XG4gICAgbGV0IGhlYWRlckZpZWxkczogc3RyaW5nW10gPSBbXSwgYm9keUZpZWxkczogc3RyaW5nW10gPSBbXSwgcXVlcnlGaWVsZHM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyZXF1ZXN0SW5jbHVkZXMpKSB7XG4gICAgICAvLyBMZWdhY3kgZm9ybWF0OiBbJ2hlYWRlcnMnLCAnYm9keScsICdxdWVyeSddXG4gICAgICBpbmNsdWRlSGVhZGVycyA9IHJlcXVlc3RJbmNsdWRlcy5pbmNsdWRlcygnaGVhZGVycycpO1xuICAgICAgaW5jbHVkZUJvZHkgPSByZXF1ZXN0SW5jbHVkZXMuaW5jbHVkZXMoJ2JvZHknKTtcbiAgICAgIGluY2x1ZGVRdWVyeSA9IHJlcXVlc3RJbmNsdWRlcy5pbmNsdWRlcygncXVlcnknKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiByZXF1ZXN0SW5jbHVkZXMgPT09ICdvYmplY3QnICYmIHJlcXVlc3RJbmNsdWRlcyAhPT0gbnVsbCkge1xuICAgICAgLy8gTmV3IHNlbGVjdGl2ZSBmb3JtYXQ6IHsgaGVhZGVyczogWydhdXRoJ10sIGJvZHk6IFsnZW1haWwnXSwgcXVlcnk6IFsncGFnZSddIH1cbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gISFyZXF1ZXN0SW5jbHVkZXMuaGVhZGVycztcbiAgICAgIGluY2x1ZGVCb2R5ID0gISFyZXF1ZXN0SW5jbHVkZXMuYm9keTtcbiAgICAgIGluY2x1ZGVRdWVyeSA9ICEhcmVxdWVzdEluY2x1ZGVzLnF1ZXJ5O1xuICAgICAgaGVhZGVyRmllbGRzID0gcmVxdWVzdEluY2x1ZGVzLmhlYWRlcnMgfHwgW107XG4gICAgICBib2R5RmllbGRzID0gcmVxdWVzdEluY2x1ZGVzLmJvZHkgfHwgW107XG4gICAgICBxdWVyeUZpZWxkcyA9IHJlcXVlc3RJbmNsdWRlcy5xdWVyeSB8fCBbXTtcbiAgICB9IGVsc2UgaWYgKHJlcXVlc3RJbmNsdWRlcyA9PT0gdHJ1ZSkge1xuICAgICAgLy8gQm9vbGVhbiB0cnVlIC0gaW5jbHVkZSBoZWFkZXJzIGJ5IGRlZmF1bHQgKGxlZ2FjeSBiZWhhdmlvcilcbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbWV0aG9kOiBjdHgucmVxdWVzdC5odHRwTWV0aG9kLFxuICAgICAgcGF0aDogY3R4LnJlcXVlc3QucGF0aCxcbiAgICAgIHVzZXJBZ2VudDogY3R4LmV2ZW50LmhlYWRlcnM/LlsndXNlci1hZ2VudCddLFxuICAgICAgc291cmNlSXA6IGN0eC5ldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwLFxuICAgICAgaGVhZGVyczogaW5jbHVkZUhlYWRlcnMgPyBcbiAgICAgICAgdGhpcy5zZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMoY3R4LnJlcXVlc3QuaGVhZGVycywgaGVhZGVyRmllbGRzKSA6IHVuZGVmaW5lZCxcbiAgICAgIGJvZHk6IGluY2x1ZGVCb2R5ID8gXG4gICAgICAgIHRoaXMuc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKGN0eC5yZXF1ZXN0LmJvZHksIGJvZHlGaWVsZHMpIDogdW5kZWZpbmVkLFxuICAgICAgcXVlcnk6IGluY2x1ZGVRdWVyeSA/IFxuICAgICAgICB0aGlzLnNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyhjdHgucmVxdWVzdC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMsIHF1ZXJ5RmllbGRzKSA6IHVuZGVmaW5lZFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0aXZlbHkgaW5jbHVkZXMgZmllbGRzIGZyb20gYW4gb2JqZWN0IGJhc2VkIG9uIGZpZWxkIGxpc3RcbiAgICogSWYgbm8gZmllbGRzIHNwZWNpZmllZCwgcmV0dXJucyB0aGUgZW50aXJlIG9iamVjdFxuICAgKi9cbiAgcHJpdmF0ZSBzZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMob2JqOiBhbnksIGZpZWxkczogc3RyaW5nW10pOiBhbnkge1xuICAgIGlmICghb2JqIHx8IHR5cGVvZiBvYmogIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm4gb2JqO1xuICAgIH1cbiAgICBcbiAgICAvLyBJZiBubyBzcGVjaWZpYyBmaWVsZHMgcmVxdWVzdGVkLCByZXR1cm4gZW50aXJlIG9iamVjdFxuICAgIGlmICghZmllbGRzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG4gICAgXG4gICAgLy8gRXh0cmFjdCBvbmx5IHNwZWNpZmllZCBmaWVsZHNcbiAgICBjb25zdCByZXN1bHQ6IGFueSA9IHt9O1xuICAgIGZvciAoY29uc3QgZmllbGQgb2YgZmllbGRzKSB7XG4gICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGZpZWxkKSkge1xuICAgICAgICByZXN1bHRbZmllbGRdID0gb2JqW2ZpZWxkXTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RpdmVseSBpbmNsdWRlcyBmaWVsZHMgZnJvbSByZXNwb25zZSBib2R5IChoYW5kbGVzIEpTT04gc3RyaW5nIGJvZGllcylcbiAgICogSWYgbm8gZmllbGRzIHNwZWNpZmllZCwgcmV0dXJucyB0aGUgZW50aXJlIGJvZHlcbiAgICovXG4gIHByaXZhdGUgc2VsZWN0aXZlbHlJbmNsdWRlUmVzcG9uc2VCb2R5KGJvZHk6IHN0cmluZywgZmllbGRzOiBzdHJpbmdbXSk6IGFueSB7XG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGJvZHk7XG4gICAgfVxuICAgIFxuICAgIC8vIElmIG5vIHNwZWNpZmljIGZpZWxkcyByZXF1ZXN0ZWQsIHJldHVybiBlbnRpcmUgYm9keVxuICAgIGlmICghZmllbGRzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIGJvZHk7XG4gICAgfVxuICAgIFxuICAgIHRyeSB7XG4gICAgICAvLyBUcnkgdG8gcGFyc2UgYXMgSlNPTlxuICAgICAgY29uc3QgYm9keU9iaiA9IEpTT04ucGFyc2UoYm9keSk7XG4gICAgICBpZiAodHlwZW9mIGJvZHlPYmogPT09ICdvYmplY3QnICYmIGJvZHlPYmogIT09IG51bGwpIHtcbiAgICAgICAgLy8gQXBwbHkgZmllbGQgc2VsZWN0aW9uIGFuZCBzdHJpbmdpZnkgYmFja1xuICAgICAgICBjb25zdCBzZWxlY3RlZCA9IHRoaXMuc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKGJvZHlPYmosIGZpZWxkcyk7XG4gICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShzZWxlY3RlZCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIE5vdCB2YWxpZCBKU09OLCByZXR1cm4gYXMtaXNcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGJvZHk7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHJlc3BvbnNlIGNvbnRleHQgZm9yIGF1ZGl0IGxvZ2dpbmdcbiAgICovXG4gIHByaXZhdGUgYnVpbGRSZXNwb25zZUNvbnRleHQocmVzcG9uc2U6IFJlc3BvbnNlLCBhdWRpdENvbmZpZzogQXVkaXRDb25maWcpIHtcbiAgICBjb25zdCByZXNwb25zZUluY2x1ZGVzID0gYXVkaXRDb25maWcuaW5jbHVkZXM/LnJlc3BvbnNlO1xuICAgIGlmICghcmVzcG9uc2VJbmNsdWRlcykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBcbiAgICAvLyBEZXRlcm1pbmUgd2hhdCB0byBpbmNsdWRlIGJhc2VkIG9uIHRoZSBjb25maWd1cmF0aW9uIGZvcm1hdFxuICAgIGxldCBpbmNsdWRlSGVhZGVycyA9IGZhbHNlLCBpbmNsdWRlQm9keSA9IGZhbHNlO1xuICAgIGxldCBoZWFkZXJGaWVsZHM6IHN0cmluZ1tdID0gW10sIGJvZHlGaWVsZHM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNwb25zZUluY2x1ZGVzKSkge1xuICAgICAgLy8gTGVnYWN5IGZvcm1hdDogWydoZWFkZXJzJywgJ2JvZHknXVxuICAgICAgaW5jbHVkZUhlYWRlcnMgPSByZXNwb25zZUluY2x1ZGVzLmluY2x1ZGVzKCdoZWFkZXJzJyk7XG4gICAgICBpbmNsdWRlQm9keSA9IHJlc3BvbnNlSW5jbHVkZXMuaW5jbHVkZXMoJ2JvZHknKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiByZXNwb25zZUluY2x1ZGVzID09PSAnb2JqZWN0JyAmJiByZXNwb25zZUluY2x1ZGVzICE9PSBudWxsKSB7XG4gICAgICAvLyBOZXcgc2VsZWN0aXZlIGZvcm1hdDogeyBoZWFkZXJzOiBbJ2NvbnRlbnQtdHlwZSddLCBib2R5OiBbJ2lkJywgJ3N0YXR1cyddIH1cbiAgICAgIGluY2x1ZGVIZWFkZXJzID0gISFyZXNwb25zZUluY2x1ZGVzLmhlYWRlcnM7XG4gICAgICBpbmNsdWRlQm9keSA9ICEhcmVzcG9uc2VJbmNsdWRlcy5ib2R5O1xuICAgICAgaGVhZGVyRmllbGRzID0gcmVzcG9uc2VJbmNsdWRlcy5oZWFkZXJzIHx8IFtdO1xuICAgICAgYm9keUZpZWxkcyA9IHJlc3BvbnNlSW5jbHVkZXMuYm9keSB8fCBbXTtcbiAgICB9IGVsc2UgaWYgKHJlc3BvbnNlSW5jbHVkZXMgPT09IHRydWUpIHtcbiAgICAgIC8vIEJvb2xlYW4gdHJ1ZSAtIGluY2x1ZGUgaGVhZGVycyBieSBkZWZhdWx0IChsZWdhY3kgYmVoYXZpb3IpXG4gICAgICBpbmNsdWRlSGVhZGVycyA9IHRydWU7XG4gICAgfVxuICAgICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1c0NvZGUsXG4gICAgICBoZWFkZXJzOiBpbmNsdWRlSGVhZGVycyA/IFxuICAgICAgICB0aGlzLnNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyhyZXNwb25zZS5oZWFkZXJzLCBoZWFkZXJGaWVsZHMpIDogdW5kZWZpbmVkLFxuICAgICAgYm9keTogaW5jbHVkZUJvZHkgPyBcbiAgICAgICAgdGhpcy5zZWxlY3RpdmVseUluY2x1ZGVSZXNwb25zZUJvZHkocmVzcG9uc2UuYm9keSwgYm9keUZpZWxkcykgOiB1bmRlZmluZWRcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGNvbnRyb2xsZXIgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIGdldENvbnRyb2xsZXJDb25maWcoKTogSUNvbnRyb2xsZXJDb25maWcge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAnY29udHJvbGxlckNvbmZpZycpIHx8IHt9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzIGFjdG9yIGNvbnRleHQgZnJvbSB0aGUgcmVxdWVzdFxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBmb3IgY3VzdG9tIGFjdG9yIGV4dHJhY3Rpb24gbG9naWNcbiAgICpcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIHJlcXVlc3QgLSBUaGUgcmVxdWVzdCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIFRoZSBhY3RvciBjb250ZXh0LlxuICAgKiBgYGBcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QpOiBBY3RvciB7XG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlcXVlc3QucmVxdWVzdElkO1xuICAgIFxuICAgIGNvbnN0IGFjdG9yOiBBY3RvciA9IHtcbiAgICAgIHJlcXVlc3RJZCxcbiAgICAgIHRpbWVzdGFtcCxcbiAgICAgIHNvdXJjZUlwOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwLFxuICAgICAgdXNlckFnZW50OiBldmVudC5oZWFkZXJzPy5bJ3VzZXItYWdlbnQnXSB8fCBldmVudC5oZWFkZXJzPy5bJ1VzZXItQWdlbnQnXSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHJlcXVlc3QuaGVhZGVycz8uWyd4LWNvcnJlbGF0aW9uLWlkJ10gfHwgcmVxdWVzdElkLFxuICAgIH07XG5cbiAgICAvLyBDb2duaXRvIGF1dGhlbnRpY2F0aW9uIHdpdGggZm9jdXNlZCBlbmhhbmNlbWVudHNcbiAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcykge1xuICAgICAgdGhpcy5leHRyYWN0Q29nbml0b0NvbnRleHQoZXZlbnQucmVxdWVzdENvbnRleHQuYXV0aG9yaXplci5jbGFpbXMsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gQVBJIEtleSBhdXRoZW50aWNhdGlvblxuICAgIGVsc2UgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5IHx8IHJlcXVlc3QuaGVhZGVycz8uWyd4LWFwaS1rZXknXSkge1xuICAgICAgdGhpcy5leHRyYWN0QXBpS2V5Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBJQU0gYXV0aGVudGljYXRpb24gXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuKSB7XG4gICAgICB0aGlzLmV4dHJhY3RJYW1Db250ZXh0KGV2ZW50LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIEFub255bW91c1xuICAgIGVsc2Uge1xuICAgICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhbm9ueW1vdXMnO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvcklkID0gJ2Fub255bW91cyc7XG4gICAgfVxuXG4gICAgLy8gU2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHRcbiAgICB0aGlzLmV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudCwgcmVxdWVzdCwgYWN0b3IpO1xuICAgIFxuICAgIC8vIEFQSSBHYXRld2F5IGNvbnRleHRcbiAgICBhY3Rvci5hcGlTdGFnZSA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5zdGFnZTtcbiAgICBhY3Rvci5hcGlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5hcGlJZDtcbiAgICBcbiAgICByZXR1cm4gYWN0b3I7XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBDb2duaXRvIGFjdG9yIGNvbnRleHQgYmFzZWQgb24gZG9jdW1lbnRlZCBBV1MgQ29nbml0byBKV1QgY2xhaW1zXG4gICAqIE9ubHkgZXh0cmFjdHMgd2hhdCdzIG9mZmljaWFsbHkgZG9jdW1lbnRlZCBhbmQgYXZhaWxhYmxlIGluIEFQSSBHYXRld2F5IGNvbnRleHRcbiAgICogXG4gICAqIEBwYXJhbSBjbGFpbXMgLSBDb2duaXRvIEpXVCBjbGFpbXMgZnJvbSB0aGUgYXV0aG9yaXplclxuICAgKiBAcGFyYW0gYWN0b3IgLSBBY3RvciBvYmplY3QgdG8gcG9wdWxhdGVcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q29nbml0b0NvbnRleHQoY2xhaW1zOiBhbnksIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2NvZ25pdG8nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3VzZXInO1xuICAgICAgXG4gICAgICAvLyBBY3RvciBJRCB3aXRoIGRvY3VtZW50ZWQgZmFsbGJhY2sgc3RyYXRlZ3k6IGNvZ25pdG86dXNlcm5hbWUgLT4gZW1haWwgLT4gc3ViXG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zWydjb2duaXRvOnVzZXJuYW1lJ10gfHwgY2xhaW1zLmVtYWlsIHx8IGNsYWltcy5zdWI7XG4gICAgICBcbiAgICAgIC8vIFN0YW5kYXJkIHVzZXIgYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBDb2duaXRvIHVzZXIgYXR0cmlidXRlcylcbiAgICAgIGFjdG9yLmVtYWlsID0gY2xhaW1zLmVtYWlsO1xuICAgICAgYWN0b3IuZW1haWxWZXJpZmllZCA9IGNsYWltcy5lbWFpbF92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IucGhvbmVOdW1iZXIgPSBjbGFpbXMucGhvbmVfbnVtYmVyO1xuICAgICAgYWN0b3IucGhvbmVWZXJpZmllZCA9IGNsYWltcy5waG9uZV9udW1iZXJfdmVyaWZpZWQgPT09ICd0cnVlJztcbiAgICAgIGFjdG9yLm5hbWUgPSBjbGFpbXMubmFtZTtcbiAgICAgIGFjdG9yLmxvY2FsZSA9IGNsYWltcy5sb2NhbGU7XG4gICAgICBcbiAgICAgIC8vIFBhcnNlIENvZ25pdG8gZ3JvdXBzIChkb2N1bWVudGVkIGFzIGNvbW1hLXNlcGFyYXRlZCBzdHJpbmcpXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLnBhcnNlR3JvdXBzKGNsYWltc1snY29nbml0bzpncm91cHMnXSk7XG4gICAgICBcbiAgICAgIC8vIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXMgKGRvY3VtZW50ZWQgcGF0dGVybjogY3VzdG9tOiopXG4gICAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzID0gdGhpcy5leHRyYWN0Q3VzdG9tQXR0cmlidXRlcyhjbGFpbXMpO1xuICAgICAgXG4gICAgICAvLyBCdWlsZCBDb2duaXRvIGNvbnRleHQgd2l0aCBvbmx5IGRvY3VtZW50ZWQgZmllbGRzXG4gICAgICBhY3Rvci5jb2duaXRvID0ge1xuICAgICAgICBzdWI6IGNsYWltcy5zdWIsXG4gICAgICAgIHVzZXJuYW1lOiBjbGFpbXNbJ2NvZ25pdG86dXNlcm5hbWUnXSxcbiAgICAgICAgZ3JvdXBzOiBncm91cHMsIC8vIEFsd2F5cyBpbmNsdWRlIGdyb3VwcyBhcnJheSAoZW1wdHkgb3IgcG9wdWxhdGVkKVxuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzOiBPYmplY3Qua2V5cyhjdXN0b21BdHRyaWJ1dGVzKS5sZW5ndGggPiAwID8gY3VzdG9tQXR0cmlidXRlcyA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICAgIFxuICAgICAgLy8gRXh0cmFjdCB0ZW5hbnQgSUQgZnJvbSBjdXN0b20gYXR0cmlidXRlcyAoY29tbW9uIG11bHRpLXRlbmFudCBwYXR0ZXJuKVxuICAgICAgYWN0b3IudGVuYW50SWQgPSBjdXN0b21BdHRyaWJ1dGVzLnRlbmFudElkO1xuICAgICAgXG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICAgIFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdFcnJvciBleHRyYWN0aW5nIENvZ25pdG8gYWN0b3IgY29udGV4dCcsIHsgZXJyb3IsIGNsYWltcyB9KTtcbiAgICAgIFxuICAgICAgLy8gTWluaW1hbCBmYWxsYmFjayBleHRyYWN0aW9uXG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2NvZ25pdG8nO1xuICAgICAgYWN0b3IuYWN0b3JUeXBlID0gJ3VzZXInO1xuICAgICAgYWN0b3IuYWN0b3JJZCA9IGNsYWltcy5zdWIgfHwgJ3Vua25vd24nO1xuICAgICAgYWN0b3IucmF3QXV0aENvbnRleHQgPSBjbGFpbXM7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlIENvZ25pdG8gZ3JvdXBzIGZyb20gY29tbWEtc2VwYXJhdGVkIHN0cmluZyAoZG9jdW1lbnRlZCBDb2duaXRvIGZvcm1hdClcbiAgICovXG4gIHByb3RlY3RlZCBwYXJzZUdyb3Vwcyhncm91cHM6IGFueSk6IHN0cmluZ1tdIHtcbiAgICBpZiAodHlwZW9mIGdyb3VwcyA9PT0gJ3N0cmluZycgJiYgZ3JvdXBzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBncm91cHMuc3BsaXQoJywnKS5tYXAoZyA9PiBnLnRyaW0oKSkuZmlsdGVyKGcgPT4gZy5sZW5ndGggPiAwKTtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgY3VzdG9tIGF0dHJpYnV0ZXMgdXNpbmcgZG9jdW1lbnRlZCBDb2duaXRvIHBhdHRlcm4gKGN1c3RvbToqKVxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltczogYW55KTogUmVjb3JkPHN0cmluZywgYW55PiB7XG4gICAgY29uc3QgY3VzdG9tQXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIFxuICAgIE9iamVjdC5rZXlzKGNsYWltcykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGtleS5zdGFydHNXaXRoKCdjdXN0b206JykpIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGtleS5yZXBsYWNlKCdjdXN0b206JywgJycpO1xuICAgICAgICBjdXN0b21BdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gY2xhaW1zW2tleV07XG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIGN1c3RvbUF0dHJpYnV0ZXM7XG4gIH1cblxuICAgIC8qKlxuICAgKiBFeHRyYWN0IHNlc3Npb24gYW5kIHRlbmFudCBjb250ZXh0IC0gZm9jdXNlZCBhcHByb2FjaFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RTZXNzaW9uQW5kVGVuYW50Q29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICAvLyBTZXNzaW9uIGNvbnRleHRcbiAgICBhY3Rvci5zZXNzaW9uSWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsneC1zZXNzaW9uLWlkJ107XG4gICAgXG4gICAgLy8gVGVuYW50IGNvbnRleHQgLSBjaGVjayBjdXN0b20gYXR0cmlidXRlcyBmaXJzdCwgdGhlbiBoZWFkZXJzXG4gICAgYWN0b3IudGVuYW50SWQgPSByZXF1ZXN0LmhlYWRlcnM/LlsneC10ZW5hbnQtaWQnXSB8fCBcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LmNsYWltcz8uWydjdXN0b206dGVuYW50SWQnXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IEFQSSBLZXkgY29udGV4dFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnYXBpLWtleSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgIFxuICAgIGxldCBhcGlLZXlJZDogc3RyaW5nO1xuICAgIGxldCBzb3VyY2U6ICdyZXF1ZXN0LWNvbnRleHQnIHwgJ2hlYWRlcic7XG4gICAgXG4gICAgaWYgKGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uYXBpS2V5KSB7XG4gICAgICBhcGlLZXlJZCA9IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleUlkIHx8IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LmFwaUtleTtcbiAgICAgIHNvdXJjZSA9ICdyZXF1ZXN0LWNvbnRleHQnO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcGlLZXlJZCA9IHJlcXVlc3QuaGVhZGVyc1sneC1hcGkta2V5J10hO1xuICAgICAgc291cmNlID0gJ2hlYWRlcic7XG4gICAgfVxuICAgIFxuICAgIGFjdG9yLmFjdG9ySWQgPSBgYXBpLWtleToke2FwaUtleUlkfWA7XG4gICAgYWN0b3IuYXBpS2V5ID0ge1xuICAgICAgaWQ6IGFwaUtleUlkLFxuICAgICAgc291cmNlOiBzb3VyY2UsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IElBTSBjb250ZXh0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdElhbUNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdpYW0nO1xuICAgIGFjdG9yLmFjdG9yVHlwZSA9ICdzZXJ2aWNlJztcbiAgICBhY3Rvci5hY3RvcklkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyIHx8IFxuICAgICAgICAgICAgICAgICAgIGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8udXNlckFybiB8fCBcbiAgICAgICAgICAgICAgICAgICAndW5rbm93bi1pYW0tdXNlcic7XG4gICAgXG4gICAgYWN0b3IuaWFtID0ge1xuICAgICAgdXNlckFybjogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8IHVuZGVmaW5lZCxcbiAgICAgIHVzZXJJZDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyIHx8IHVuZGVmaW5lZCxcbiAgICAgIGFjY291bnRJZDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hY2NvdW50SWQgfHwgdW5kZWZpbmVkLFxuICAgICAgY2FsbGVyOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmNhbGxlciB8fCB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxufVxuIl19