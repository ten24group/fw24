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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUF3REEsNENBeUJDO0FBL0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFFNUQsa0RBQTRGO0FBQzVGLHVFQUFrRTtBQUNsRSx1REFBbUQ7QUFDbkQseURBQXFEO0FBQ3JELHVEQUF3RTtBQUN4RSwwQ0FBaUg7QUFHakgscUVBQXdFO0FBV3hFLCtCQUErQjtBQUMvQixNQUFNLGlCQUFpQixHQUE4QixFQUFFLENBQUM7QUFFakQsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FDOUIsT0FJcUIsRUFDckIsT0FBcUY7SUFHckYsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxZQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUd2RSxJQUFNLG9CQUFvQixHQUExQixNQUFNLG9CQUFvQjtRQUVsQixBQUFOLEtBQUssQ0FBQyxhQUFhO1lBQ2pCLHNEQUFzRDtRQUN4RCxDQUFDO0tBQ0YsQ0FBQTtJQUhPO1FBREwsTUFBTSxDQUFDLElBQUksQ0FBQzs2REFHWjtJQUpHLG9CQUFvQjtRQUR6QixJQUFB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QUFjLEVBQUUsUUFBUSxFQUFFLElBQUk7WUFDckMsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsT0FBTztZQUN2QyxrQkFBa0IsQ0FBQztRQUVsQyxLQUFLLENBQUMsR0FBRyxHQUFHO1lBQ1YsT0FBTyxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE9BQU8sSUFBSSxTQUFTO1lBQzdELE1BQU0sRUFBRSxLQUFLLENBQUMsY0FBYyxFQUFFLFFBQVEsRUFBRSxJQUFJLElBQUksU0FBUztZQUN6RCxTQUFTLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsU0FBUyxJQUFJLFNBQVM7WUFDakUsTUFBTSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsUUFBUSxFQUFFLE1BQU0sSUFBSSxTQUFTO1NBQzVELENBQUM7SUFDSixDQUFDO0NBQ0Y7QUE3d0JELHNDQTZ3QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB0eXBlIHsgUmVxdWVzdCwgUmVzcG9uc2UsIFJvdXRlIH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIElDb250cm9sbGVyQ29uZmlnIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IEdldCwgUm91dGVNZXRob2RzIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnMvbWV0aG9kXCI7XG5pbXBvcnQgeyBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IGlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSwgaXNJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb24vdXRpbHNcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBSZXF1ZXN0Q29udGV4dCB9IGZyb20gXCIuL3JlcXVlc3QtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb250ZXh0IH0gZnJvbSBcIi4vcmVzcG9uc2UtY29udGV4dFwiO1xuaW1wb3J0IHsgUmVzcG9uc2VDb25maWcsIG1lcmdlUmVzcG9uc2VDb25maWcgfSBmcm9tIFwiLi9yZXNwb25zZS1jb25maWdcIjtcbmltcG9ydCB7IFZhbGlkYXRpb25GYWlsZWRFcnJvciwgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvciwgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSBcIi4uLy4uL2Vycm9ycy9cIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgQXVkaXRDb250ZXh0LCBSZXF1ZXN0QXVkaXRDb250ZXh0LCBBdWRpdENvbmZpZyB9IGZyb20gJy4uLy4uL2F1ZGl0L2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQXVkaXRDYXB0dXJlU2VydmljZSB9IGZyb20gJy4uLy4uL2F1ZGl0L2hlbHBlcnMvYXVkaXQtaGVscGVycyc7XG5cbmV4cG9ydCB0eXBlIENvbnRyb2xsZXJFcnJvckhhbmRsZXIgPSBSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVFcnJvckhhbmRsZXI+O1xuXG4vLyBOZXcgaW50ZXJmYWNlcyBmb3IgbWlkZGxld2FyZSBhbmQgZXJyb3IgaGFuZGxpbmdcbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlck1pZGRsZXdhcmUge1xuICBiZWZvcmU/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBhZnRlcj86IChyZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG4gIG9uRXJyb3I/OiAoZXJyb3I6IEVycm9yLCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpID0+IFByb21pc2U8dm9pZD47XG59XG5cbi8vIEdsb2JhbCBtaWRkbGV3YXJlIG1hbmFnZW1lbnRcbmNvbnN0IGdsb2JhbE1pZGRsZXdhcmVzOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdID0gW107XG5cbmV4cG9ydCBjb25zdCB1c2VNaWRkbGV3YXJlID0gKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLnB1c2gobWlkZGxld2FyZSk7XG59XG5leHBvcnQgY29uc3QgY2xlYXJNaWRkbGV3YXJlcyA9ICgpID0+IHtcbiAgZ2xvYmFsTWlkZGxld2FyZXMubGVuZ3RoID0gMDtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIEFQSSBoYW5kbGVyIHdpdGhvdXQgZGVmaW5pbmcgYSBjbGFzc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGV4cG9ydCBjb25zdCB7IGhhbmRsZXIsIGRlc2NyaXB0b3IgfSA9IGNyZWF0ZUFwaUhhbmRsZXIoXG4gKiAgeyBtZXRob2Q6IEdldCwgbmFtZTogJ2RlbW8nLCBhdXRob3JpemVyOiAnTk9ORScgfSxcbiAqICAgYXN5bmMgKCBldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAqICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICogICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAqICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiSGVsbG8gV29ybGQhXCJ9KVxuICogICAgICAgfSlcbiAqICAgfVxuICogKVxuICogYGBgXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRoZSBvcHRpb25zIGZvciBjcmVhdGluZyB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5uYW1lIC0gVGhlIG5hbWUgb2YgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMucGF0aCAtIFRoZSBwYXRoIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gb3B0aW9ucy5tZXRob2QgLSBUaGUgSFRUUCBtZXRob2QgZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gZm9yIHRoZSBBUEkgaGFuZGxlci5cbiAqIEByZXR1cm5zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBoYW5kbGVyIGZ1bmN0aW9uIGFuZCB0aGUgY29udHJvbGxlciBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXBpSGFuZGxlcihcbiAgb3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBwYXRoPzogc3RyaW5nLFxuICAgIG1ldGhvZD86IFJvdXRlTWV0aG9kcyxcbiAgfSAmIElDb250cm9sbGVyQ29uZmlnLFxuICBoYW5kbGVyOiAoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCkgPT4gUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+LFxuKSB7XG5cbiAgY29uc3QgeyBuYW1lLCBwYXRoID0gJycsIG1ldGhvZCA9IEdldCwgLi4uY29udHJvbGxlckNvbmZpZyB9ID0gb3B0aW9ucztcblxuICBAQ29udHJvbGxlcihuYW1lLCB7IC4uLmNvbnRyb2xsZXJDb25maWcsIGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyOiBmYWxzZSB9KVxuICBjbGFzcyBDb250cm9sbGVyRGVzY3JpcHRvciB7XG4gICAgQG1ldGhvZChwYXRoKVxuICAgIGFzeW5jIGlubGluZUhhbmRsZXIoKSB7XG4gICAgICAvLyBwbGFjZWhvbGRlciBmdW5jdGlvbiBvbmx5IHVzZWQgZm9yIHJvdXRpbmcgbWV0YWRhdGFcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaGFuZGxlciwgJ25hbWUnLCB7IHZhbHVlOiAnaGFuZGxlcicgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBoYW5kbGVyLFxuICAgIGRlc2NyaXB0b3I6IENvbnRyb2xsZXJEZXNjcmlwdG9yXG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQVBJQ29udHJvbGxlckNvbmZpZyB7XG4gIHJlc3BvbnNlQ29uZmlnPzogUGFydGlhbDxSZXNwb25zZUNvbmZpZz47XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUElDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcHJvdGVjdGVkIG1pZGRsZXdhcmVzOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdID0gW107XG4gIHByb3RlY3RlZCByZXNwb25zZUNvbmZpZzogUmVzcG9uc2VDb25maWc7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBBUElDb250cm9sbGVyQ29uZmlnID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVzcG9uc2VDb25maWcgPSBtZXJnZVJlc3BvbnNlQ29uZmlnKGNvbmZpZy5yZXNwb25zZUNvbmZpZyk7XG4gIH1cblxuICAvKipcbiAgICogY2FuIGJlIHVzZWQgdG8gcnVuIHNvbWUgbG9naWMganVzdCBiZWZvcmUgdGhlIHJlcXVlc3QgaXMgcHJvY2Vzc2VkIGxpa2UgY3JlYXRpbmcgY2xpZW50cywgZGktaW5qZWN0aW9uIGFucyBzbyBvbi5cbiAgICogQHBhcmFtIF9ldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBfY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgY29udHJvbGxlciBpcyBpbml0aWFsaXplZC5cbiAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8tb3AgZm9yIEFQSSBjb250cm9sbGVyc1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBnZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICB9XG5cbiAgLy8gQWRkIG1pZGRsZXdhcmUgcmVnaXN0cmF0aW9uIG1ldGhvZFxuICBwcm90ZWN0ZWQgdXNlTWlkZGxld2FyZShtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkge1xuICAgIHRoaXMubWlkZGxld2FyZXMucHVzaChtaWRkbGV3YXJlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpIHtcbiAgICByZXR1cm4gWyAuLi5nbG9iYWxNaWRkbGV3YXJlcywgLi4udGhpcy5taWRkbGV3YXJlcyBdO1xuICB9XG5cbiAgLy8gRXhlY3V0ZSBtaWRkbGV3YXJlIHBpcGVsaW5lXG4gIHByaXZhdGUgYXN5bmMgZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShcbiAgICBwaGFzZTogJ2JlZm9yZScgfCAnYWZ0ZXInIHwgJ29uRXJyb3InLFxuICAgIHJlcXVlc3Q6IFJlcXVlc3QsXG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsXG4gICAgZXJyb3I/OiBFcnJvclxuICApOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGFsbE1pZGRsZXdhcmVzID0gdGhpcy5nZXRNaWRkbGV3YXJlcygpO1xuXG4gICAgZm9yIChjb25zdCBtaWRkbGV3YXJlIG9mIGFsbE1pZGRsZXdhcmVzKSB7XG4gICAgICBpZiAocGhhc2UgPT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlLm9uRXJyb3IgJiYgZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZS5vbkVycm9yKGVycm9yLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIH0gZWxzZSBpZiAocGhhc2UgIT09ICdvbkVycm9yJyAmJiBtaWRkbGV3YXJlWyBwaGFzZSBdKSB7XG4gICAgICAgIGF3YWl0IG1pZGRsZXdhcmVbIHBoYXNlIF0hKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfVxuICAgIH1cblxuICB9XG5cbiAgYXN5bmMgdmFsaWRhdGUocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QsIHZhbGlkYXRpb25zOiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuICAgIGxldCB2YWxpZGF0aW9uUnVsZXM6IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMgPSB2YWxpZGF0aW9ucztcbiAgICBpZiAoaXNJbnB1dFZhbGlkYXRpb25SdWxlKHZhbGlkYXRpb25zKSkge1xuICAgICAgaWYgKFsgJ0dFVCcsICdERUxFVEUnIF0uaW5jbHVkZXMocmVxdWVzdENvbnRleHQuaHR0cE1ldGhvZC50b1VwcGVyQ2FzZSgpKSkge1xuXG4gICAgICAgIHZhbGlkYXRpb25SdWxlcyA9IHsgcXVlcnk6IHZhbGlkYXRpb25zIH1cblxuICAgICAgfSBlbHNlIGlmIChbICdQT1NUJywgJ1BVVCcsICdQQVRDSCcgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBib2R5OiB2YWxpZGF0aW9ucyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvblJ1bGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IodmFsaWRhdGlvblJ1bGVzKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3IudmFsaWRhdGVIdHRwUmVxdWVzdCh7XG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHZhbGlkYXRpb25zOiB2YWxpZGF0aW9uUnVsZXMsXG4gICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLFxuICAgICAgdmVyYm9zZUVycm9yczogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgb3ZlcnJpZGRlbkVycm9yTWVzc2FnZXM6IGF3YWl0IHRoaXMuZ2V0T3ZlcnJpZGRlbkh0dHBSZXF1ZXN0VmFsaWRhdGlvbkVycm9yTWVzc2FnZXMoKVxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPFJlcXVlc3Q+IHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgfVxuXG4gIGFzeW5jIG1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdENvbnRleHQ6IFJlcXVlc3QpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZUNvbnRleHQoe1xuICAgICAgdHJhY2VJZDogcmVxdWVzdENvbnRleHQucmVxdWVzdElkLFxuICAgICAgcmVxdWVzdElkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICBkZWJ1Z01vZGU6IHJlcXVlc3RDb250ZXh0LmRlYnVnTW9kZSxcbiAgICAgIHJvdXRlOiByZXF1ZXN0Q29udGV4dC5wYXRoLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgfHwgJ2RldmVsb3BtZW50JyxcbiAgICAgIGNvbmZpZzogdGhpcy5yZXNwb25zZUNvbmZpZ1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgY29udHJvbGxlci5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBBUEkgR2F0ZXdheSBldmVudHMuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcmV0dXJucyBUaGUgQVBJIEdhdGV3YXkgcmVzcG9uc2Ugb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcblxuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdCk7XG5cbiAgICAvLyBCdWlsZCB0aGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICBjb25zdCBjdHggPSB0aGlzLmJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG5cbiAgICAvLyBGaW5kIHRoZSBtYXRjaGluZyByb3V0ZSBmaXJzdCBmb3IgbWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZ1xuICAgIGNvbnN0IHJvdXRlID0gdGhpcy5maW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KTtcblxuICAgIC8vIENyZWF0ZSBhdWRpdCBjb250ZXh0IHdpdGggcm91dGUgaW5mb3JtYXRpb24gZm9yIG1ldGhvZC1sZXZlbCBjb25maWdcbiAgICBjb25zdCBhdWRpdENvbnRleHQgPSB0aGlzLm1ha2VBdWRpdENvbnRleHQoY3R4LCByb3V0ZSk7XG4gICAgXG4gICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCB0aGlzLmJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbnRleHQuYXVkaXRDb25maWcpKTtcbiAgICB9XG5cbiAgICB0cnkge1xuXG4gICAgICAvLyBMZWdhY3kgaW5pdGlhbGl6ZSBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG5cbiAgICAgIC8vIEV4ZWN1dGUgYmVmb3JlIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG5cbiAgICAgIC8vIFZhbGlkYXRlIHRoZSByZXF1ZXN0IGlmIHZhbGlkYXRpb25zIGFyZSBkZWZpbmVkXG4gICAgICBpZiAocm91dGU/LnZhbGlkYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkYXRpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlKHJlcXVlc3QsIHJvdXRlLnZhbGlkYXRpb25zKTtcbiAgICAgICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LnBhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkZhaWxlZEVycm9yKHZhbGlkYXRpb25SZXN1bHQuZXJyb3JzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBjYWxsIHRoZSByb3V0ZSBmdW5jdGlvblxuICAgICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXMuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gICAgICBsZXQgY29udHJvbGxlclJlc3BvbnNlOiBhbnkgPSByb3V0ZUZ1bmN0aW9uLmNhbGwodGhpcywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlIGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICBjb250cm9sbGVyUmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyUmVzcG9uc2U7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4ZWN1dGUgYWZ0ZXIgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdhZnRlcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuXG4gICAgICAvLyBDYXB0dXJlIHN1Y2Nlc3NmdWwgcmVzcG9uc2VcbiAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzcG9uc2UsIG51bGwpO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgY29udHJvbGxlciByZXR1cm5lZCBhbnl0aGluZyAoUmVzcG9uc2VDb250ZXh0IG9yIHJhdyBBUEkgcmVzdWx0KSwgZW1pdCB0aGF0XG4gICAgICBpZiAoY29udHJvbGxlclJlc3BvbnNlICE9IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVzcG9uc2UoY29udHJvbGxlclJlc3BvbnNlKTtcbiAgICAgIH1cblxuICAgIH0gY2F0Y2ggKGVycikge1xuXG4gICAgICBjb25zdCBlcnJvck9iaiA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFN0cmluZyhlcnIpKTtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdMYW1iZGFIYW5kbGVyIGVycm9yOiAnLCBlcnJvck9iaik7XG5cbiAgICAgIC8vIEV4ZWN1dGUgZXJyb3IgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdvbkVycm9yJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3JPYmopO1xuXG4gICAgICAvLyBDYXB0dXJlIGVycm9yIHJlc3BvbnNlXG4gICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIHJlc3BvbnNlLCBlcnJvck9iaik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZUV4Y2VwdGlvbihyZXF1ZXN0LCBlcnJvck9iaiwgcmVzcG9uc2UpO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHRoZSBpbi1tZW1vcnkgcmVzcG9uc2VDb250ZXh0XG4gICAgcmV0dXJuIHJlc3BvbnNlLmJ1aWxkKCk7XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHJvdXRlIHRoYXQgbWF0Y2hlcyB0aGUgSFRUUCBtZXRob2QgYW5kIHJlc291cmNlLlxuICAgKiBAcGFyYW0gcmVxdWVzdERhdGEgLSBUaGUgcmVxdWVzdCBkYXRhIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIG1hdGNoaW5nIHJvdXRlIG9yIG51bGwgaWYgbm90IGZvdW5kLlxuICAgKi9cbiAgcHJpdmF0ZSBmaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCk6IFJvdXRlIHwgbnVsbCB7XG4gICAgbGV0IGNvbnRyb2xsZXI6IGFueSA9IHRoaXM7XG5cbiAgICAvLyBEZXRlcm1pbmUgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGJ5IGZpbmRpbmcgdGhlIGxvbmdlc3QgY29tbW9uIHByZWZpeCB0aGF0IGVuZHMgd2l0aCB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgbGV0IGNvbnRyb2xsZXJCYXNlUGF0aCA9IGAvJHtjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lfWA7XG4gICAgbGV0IHJlc291cmNlV2l0aG91dFJvb3QgPSAnLyc7XG5cbiAgICAvLyBGb3IgY29udHJvbGxlcnMgaW4gc3ViZGlyZWN0b3JpZXMsIHdlIG5lZWQgdG8gbWF0Y2ggdGhlIGFjdHVhbCByZXNvdXJjZSBwYXRoXG4gICAgLy8gQ2hlY2sgaWYgcmVzb3VyY2UgY29udGFpbnMgdGhlIGNvbnRyb2xsZXIgbmFtZSBhcyBwYXJ0IG9mIGEgbG9uZ2VyIHBhdGhcbiAgICBjb25zdCByZXNvdXJjZVBhcnRzID0gcmVxdWVzdERhdGEucmVzb3VyY2Uuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgY29udHJvbGxlck5hbWVQYXJ0cyA9IGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgICAvLyBGaW5kIGlmIHRoZSBjb250cm9sbGVyIG5hbWUgcGFydHMgYXJlIHByZXNlbnQgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICBsZXQgYmFzZVBhdGhFbmRJbmRleCA9IC0xO1xuICAgIGlmIChjb250cm9sbGVyTmFtZVBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIExvb2sgZm9yIHRoZSBjb250cm9sbGVyIG5hbWUgc2VxdWVuY2UgaW4gdGhlIHJlc291cmNlIHBhdGhcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHJlc291cmNlUGFydHMubGVuZ3RoIC0gY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBsZXQgbWF0Y2hlcyA9IHRydWU7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIGlmIChyZXNvdXJjZVBhcnRzWyBpICsgaiBdICE9PSBjb250cm9sbGVyTmFtZVBhcnRzWyBqIF0pIHtcbiAgICAgICAgICAgIG1hdGNoZXMgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIGJhc2VQYXRoRW5kSW5kZXggPSBpICsgY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggLSAxO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGJhc2VQYXRoRW5kSW5kZXggPj0gMCkge1xuICAgICAgLy8gRm91bmQgdGhlIGNvbnRyb2xsZXIgYmFzZSBwYXRoIGluIHRoZSByZXNvdXJjZVxuICAgICAgY29uc3QgYmFzZVBhdGhQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoMCwgYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgY29udHJvbGxlckJhc2VQYXRoID0gJy8nICsgYmFzZVBhdGhQYXJ0cy5qb2luKCcvJyk7XG4gICAgICBjb25zdCByZW1haW5pbmdQYXJ0cyA9IHJlc291cmNlUGFydHMuc2xpY2UoYmFzZVBhdGhFbmRJbmRleCArIDEpO1xuICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlbWFpbmluZ1BhcnRzLmxlbmd0aCA+IDAgPyAnLycgKyByZW1haW5pbmdQYXJ0cy5qb2luKCcvJykgOiAnLyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZhbGxiYWNrIHRvIG9yaWdpbmFsIGxvZ2ljIGZvciBzaW1wbGUgY2FzZXNcbiAgICAgIGlmIChyZXF1ZXN0RGF0YS5yZXNvdXJjZS5zdGFydHNXaXRoKGNvbnRyb2xsZXJCYXNlUGF0aCkpIHtcbiAgICAgICAgcmVzb3VyY2VXaXRob3V0Um9vdCA9IHJlcXVlc3REYXRhLnJlc291cmNlLnN1YnN0cmluZyhjb250cm9sbGVyQmFzZVBhdGgubGVuZ3RoKSB8fCAnLyc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2VwYXJhdGUgcm91dGVzIGludG8gZXhhY3QgYW5kIHBhcmFtZXRlcml6ZWQgZm9yIHByb3BlciBwcmlvcml0aXphdGlvblxuICAgIGNvbnN0IGV4YWN0TWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcbiAgICBjb25zdCBwYXJhbWV0ZXJpemVkTWF0Y2hlczogQXJyYXk8eyByb3V0ZUtleTogc3RyaW5nLCByb3V0ZTogUm91dGUgfT4gPSBbXTtcblxuICAgIC8vIEZpcnN0IHBhc3M6IGNhdGVnb3JpemUgcm91dGVzIGJ5IHR5cGUgYW5kIG1ldGhvZFxuICAgIGZvciAoY29uc3QgWyByb3V0ZUtleSwgcm91dGUgXSBvZiBPYmplY3QuZW50cmllcyhjb250cm9sbGVyLnJvdXRlcyB8fCB7fSkgYXMgWyBzdHJpbmcsIFJvdXRlIF1bXSkge1xuICAgICAgY29uc3QgWyByb3V0ZU1ldGhvZCwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICAvLyBTa2lwIGlmIEhUVFAgbWV0aG9kIGRvZXNuJ3QgbWF0Y2hcbiAgICAgIGlmIChyb3V0ZU1ldGhvZCAhPT0gcmVxdWVzdERhdGEuaHR0cE1ldGhvZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2F0ZWdvcml6ZSByb3V0ZSB0eXBlXG4gICAgICBpZiAocm91dGVQYXRoLmluY2x1ZGVzKCd7JykgJiYgcm91dGVQYXRoLmluY2x1ZGVzKCd9JykpIHtcbiAgICAgICAgcGFyYW1ldGVyaXplZE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4YWN0TWF0Y2hlcy5wdXNoKHsgcm91dGVLZXksIHJvdXRlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlY29uZCBwYXNzOiBUcnkgZXhhY3QgbWF0Y2hlcyBmaXJzdCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlIH0gb2YgZXhhY3RNYXRjaGVzKSB7XG4gICAgICBjb25zdCBbICwgcm91dGVQYXRoIF0gPSByb3V0ZUtleS5zcGxpdCgnfCcpO1xuXG4gICAgICBpZiAocm91dGVQYXRoID09PSByZXNvdXJjZVdpdGhvdXRSb290KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBGb3VuZCBleGFjdCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCk7XG4gICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUaGlyZCBwYXNzOiBUcnkgcGFyYW1ldGVyaXplZCBtYXRjaGVzIChzb3J0ZWQgYnkgc3BlY2lmaWNpdHkpXG4gICAgLy8gU29ydCBwYXJhbWV0ZXJpemVkIHJvdXRlcyBieSBzcGVjaWZpY2l0eSAobW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHByaW9yaXR5KVxuICAgIGNvbnN0IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzID0gcGFyYW1ldGVyaXplZE1hdGNoZXNcbiAgICAgIC5tYXAoKHsgcm91dGVLZXksIHJvdXRlIH0pID0+IHtcbiAgICAgICAgY29uc3QgWyAsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcbiAgICAgICAgY29uc3Qgc2VnbWVudHMgPSByb3V0ZVBhdGguc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgIGNvbnN0IGxpdGVyYWxTZWdtZW50cyA9IHNlZ21lbnRzLmZpbHRlcihzZWdtZW50ID0+ICFzZWdtZW50LmluY2x1ZGVzKCd7JykpO1xuXG4gICAgICAgIC8vIFNwZWNpZmljaXR5IHNjb3JlOiBtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmVcbiAgICAgICAgLy8gRm9yIGVxdWFsIGxpdGVyYWwgc2VnbWVudHMsIGZld2VyIHRvdGFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlICBcbiAgICAgICAgY29uc3Qgc3BlY2lmaWNpdHlTY29yZSA9IChsaXRlcmFsU2VnbWVudHMubGVuZ3RoICogMTAwMCkgLSBzZWdtZW50cy5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGgsIHNwZWNpZmljaXR5U2NvcmUgfTtcbiAgICAgIH0pXG4gICAgICAuc29ydCgoYSwgYikgPT4gYi5zcGVjaWZpY2l0eVNjb3JlIC0gYS5zcGVjaWZpY2l0eVNjb3JlKTsgLy8gSGlnaGVyIHNjb3JlIGZpcnN0XG5cbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGggfSBvZiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcykge1xuICAgICAgLy8gQ29udmVydCBmcmFtZXdvcmsge2lkfSBzeW50YXggdG8gcGF0aC10by1yZWdleHAgOmlkIHN5bnRheFxuICAgICAgY29uc3QgcGF0aFRvUmVnZXhwUGF0dGVybiA9IHJvdXRlUGF0aC5yZXBsYWNlKC9cXHsoW159XSspXFx9L2csICc6JDEnKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gVXNlIHBhdGgtdG8tcmVnZXhwIGZvciBwcm9wZXIgcGFyYW1ldGVyIG1hdGNoaW5nXG4gICAgICAgIGNvbnN0IHsgbWF0Y2ggfSA9IHJlcXVpcmUoJ3BhdGgtdG8tcmVnZXhwJyk7XG4gICAgICAgIGNvbnN0IG1hdGNoZXIgPSBtYXRjaChwYXRoVG9SZWdleHBQYXR0ZXJuLCB7IGRlY29kZTogZGVjb2RlVVJJQ29tcG9uZW50IH0pO1xuICAgICAgICBjb25zdCBtYXRjaFJlc3VsdCA9IG1hdGNoZXIocmVzb3VyY2VXaXRob3V0Um9vdCk7XG5cbiAgICAgICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEZvdW5kIHBhcmFtZXRlcml6ZWQgbWF0Y2ggZm9yIHJvdXRlOiAke3JvdXRlS2V5fWAsIHtcbiAgICAgICAgICAgIHBhdHRlcm46IHBhdGhUb1JlZ2V4cFBhdHRlcm4sXG4gICAgICAgICAgICBwYXJhbXM6IG1hdGNoUmVzdWx0LnBhcmFtcyxcbiAgICAgICAgICAgIHNwZWNpZmljaXR5U2NvcmU6IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzLmZpbmQobSA9PiBtLnJvdXRlS2V5ID09PSByb3V0ZUtleSk/LnNwZWNpZmljaXR5U2NvcmVcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIE5vdGU6IFdlIGRvbid0IG5lZWQgdG8gbWFudWFsbHkgZXh0cmFjdCBwYXJhbWV0ZXJzIHNpbmNlIEFQSSBHYXRld2F5XG4gICAgICAgICAgLy8gYWxyZWFkeSBwcm92aWRlcyB0aGVtIGluIHJlcXVlc3REYXRhLnBhdGhQYXJhbWV0ZXJzXG4gICAgICAgICAgcmV0dXJuIHJvdXRlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBFcnJvciBtYXRjaGluZyByb3V0ZSBwYXR0ZXJuICR7cGF0aFRvUmVnZXhwUGF0dGVybn06YCwgZXJyb3IpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKGBObyBtYXRjaGluZyByb3V0ZSBmb3VuZCBmb3IgJHtyZXF1ZXN0RGF0YS5odHRwTWV0aG9kfXwke3Jlc291cmNlV2l0aG91dFJvb3R9YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIHJvdXRlLlxuICAgKiBAcGFyYW0gcm91dGUgLSBUaGUgbWF0Y2hlZCByb3V0ZS5cbiAgICogQHJldHVybnMgVGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqL1xuICBwcml2YXRlIGdldFJvdXRlRnVuY3Rpb24ocm91dGU6IFJvdXRlIHwgbnVsbCk6IEZ1bmN0aW9uIHtcbiAgICBpZiAoIXJvdXRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICAgIH1cblxuICAgIC8vQHRzLWlnbm9yZVxuICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzWyByb3V0ZS5mdW5jdGlvbk5hbWUgXTtcblxuICAgIHJldHVybiB0eXBlb2Ygcm91dGVGdW5jdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gcm91dGVGdW5jdGlvbiA6IHRoaXMuaGFuZGxlTm90Rm91bmQuYmluZCh0aGlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIHRoZSBOb3RGb3VuZCByb3V0ZS5cbiAgICogQHBhcmFtIF9yZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDQwNCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVOb3RGb3VuZChfcmVxOiBSZXF1ZXN0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZSh7XG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiTm8gUm91dGUgRm91bmQhXCIgfSksXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZXJyb3JIYW5kbGVyPzogQ29udHJvbGxlckVycm9ySGFuZGxlcjtcbiAgcHJvdGVjdGVkIGdldEVycm9ySGFuZGxlcigpOiBDb250cm9sbGVyRXJyb3JIYW5kbGVyIHtcbiAgICBpZiAoIXRoaXMuZXJyb3JIYW5kbGVyKSB7XG4gICAgICB0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcigpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5lcnJvckhhbmRsZXI7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBleGNlcHRpb25zIGFuZCByZXR1cm5zIGEgSlNPTiByZXNwb25zZSB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHBhcmFtIGVyciAtIFRoZSBlcnJvciBvYmplY3QuXG4gICAqIEByZXR1cm5zIFRoZSByZXNwb25zZSBvYmplY3Qgd2l0aCBhIDUwMCBzdGF0dXMgY29kZS5cbiAgICovXG4gIHByb3RlY3RlZCBoYW5kbGVFeGNlcHRpb24ocmVxOiBSZXF1ZXN0LCBlcnI6IEVycm9yLCByZXM6IFJlc3BvbnNlKTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlID0gdGhpcy5nZXRFcnJvckhhbmRsZXIoKShlcnIsIHJlcSwgcmVzKTtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVSZXNwb25zZShlcnJvclJlc3BvbnNlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBoYW5kbGVSZXNwb25zZShyZXM6IFJlc3BvbnNlIHwgQVBJR2F0ZXdheVByb3h5UmVzdWx0KTogQVBJR2F0ZXdheVByb3h5UmVzdWx0IHtcbiAgICBpZiAocmVzIGluc3RhbmNlb2YgUmVzcG9uc2VDb250ZXh0KSB7XG4gICAgICByZXR1cm4gcmVzLmJ1aWxkKCk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGVjdXRpb24gY29udGV4dCBmb3IgdGhlIHJlcXVlc3RcbiAgICogXG4gICAqIGRpZmZlcmVudCBtaWRkbGV3YXJlIGNhbiBlbmhhbmNlIHRoZSBhY3RvciBjb250ZXh0IGJ5IHVzaW5nIHRoZSBlbmhhbmNlQWN0b3IgbWV0aG9kXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlID0ge1xuICAgKiAgYmVmb3JlOiBhc3luYyAoX3JlcXVlc3QsIF9yZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgY3R4Py5lbmhhbmNlQWN0b3I/Lih7XG4gICAqICAgICByb2xlczogWydhZG1pbicsICd1c2VyJ10sXG4gICAqICAgICBwZXJtaXNzaW9uczogWydyZWFkJywgJ3dyaXRlJ10sXG4gICAqICAgICBzdWJzY3JpcHRpb246IHsgdGllcjogJ2VudGVycHJpc2UnIH1cbiAgICogICB9KTtcbiAgICogIH1cbiAgICogfVxuICAgKlxuICAgKiB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmUpO1xuICAgKiBcbiAgICogT1JcbiAgICogXG4gICAqIGNvbnN0IHNlY3VyaXR5TWlkZGxld2FyZSA9IHtcbiAgICogICBiZWZvcmU6IGFzeW5jIChyZXF1ZXN0LCByZXNwb25zZSwgY3R4KSA9PiB7XG4gICAqICAgICBjdHguZW5oYW5jZUFjdG9yPy4oe1xuICAgKiAgICAgICByaXNrUHJvZmlsZTogYXdhaXQgYXNzZXNzUmlzayhjdHguYWN0b3IuYWN0b3JJZCksXG4gICAqICAgICAgIGRldmljZTogYXdhaXQgbWFrZURldmljZUNvbnRleHQocmVxdWVzdClcbiAgICogICAgIH0pO1xuICAgKiAgIH1cbiAgICogfTtcbiAgICpcbiAgICogdXNlTWlkZGxld2FyZShzZWN1cml0eU1pZGRsZXdhcmUpO1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgXG4gICAqIEBwYXJhbSBjb250ZXh0IFxuICAgKiBAcGFyYW0gcmVxdWVzdCBcbiAgICogQHBhcmFtIHJlc3BvbnNlIFxuICAgKiBAcmV0dXJucyBcbiAgICovXG4gIHByb3RlY3RlZCBidWlsZEN0eChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgICBjb25zdCBhY3RvciA9IHRoaXMuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG4gICAgXG4gICAgY29uc3QgY3R4OiBFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgZXZlbnQsXG4gICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgYWN0b3IsXG4gICAgICBkZWJ1Z0luZm86IHt9LFxuICAgICAgXG4gICAgICAvLyBTaW1wbGUgYWN0b3IgZW5oYW5jZW1lbnQgbWV0aG9kXG4gICAgICBlbmhhbmNlQWN0b3I6IChlbmhhbmNlbWVudDogUGFydGlhbDxBY3Rvcj4pID0+IHtcbiAgICAgICAgaWYgKGN0eC5hY3Rvcikge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oY3R4LmFjdG9yLCBlbmhhbmNlbWVudCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIGN0eDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGF1ZGl0IGNvbnRleHQgZm9yIHRoZSByZXF1ZXN0IGZvbGxvd2luZyB0aGUgZXhpc3RpbmcgYnVpbGRDdHggcGF0dGVyblxuICAgKiBAcGFyYW0gY3R4IC0gVGhlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAqIEBwYXJhbSByb3V0ZSAtIFRoZSBtYXRjaGVkIHJvdXRlIChvcHRpb25hbCwgZm9yIG1ldGhvZC1sZXZlbCBhdWRpdCBjb25maWcpXG4gICAqIEByZXR1cm5zIEF1ZGl0Q29udGV4dCBvciBudWxsIGlmIGF1ZGl0IGlzIGRpc2FibGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgbWFrZUF1ZGl0Q29udGV4dChjdHg6IEV4ZWN1dGlvbkNvbnRleHQsIHJvdXRlPzogUm91dGUgfCBudWxsKTogQXVkaXRDb250ZXh0IHwgbnVsbCB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRDb250cm9sbGVyQ29uZmlnKCk7XG4gICAgXG4gICAgLy8gTWVyZ2UgY29udHJvbGxlci1sZXZlbCBhbmQgbWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZ3NcbiAgICBjb25zdCBjb250cm9sbGVyQXVkaXQgPSBjb25maWc/LmF1ZGl0O1xuICAgIGNvbnN0IG1ldGhvZEF1ZGl0ID0gcm91dGU/LmF1ZGl0O1xuICAgIGNvbnN0IG1lcmdlZEF1ZGl0Q29uZmlnID0gdGhpcy5tZXJnZUF1ZGl0Q29uZmlncyhjb250cm9sbGVyQXVkaXQsIG1ldGhvZEF1ZGl0KTtcbiAgICBcbiAgICBpZiAoIW1lcmdlZEF1ZGl0Q29uZmlnPy5lbmFibGVkKSByZXR1cm4gbnVsbDtcbiAgICBcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gY3R4LmFjdG9yPy5jb3JyZWxhdGlvbklkIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5yZXF1ZXN0LmhlYWRlcnM/LlsneC1jb3JyZWxhdGlvbi1pZCddIHx8IFxuICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5yZXF1ZXN0LnJlcXVlc3RJZDtcbiAgICBcbiAgICBjb25zdCBvcGVyYXRpb25OYW1lID0gYCR7Y3R4LnJlcXVlc3QuaHR0cE1ldGhvZC50b0xvd2VyQ2FzZSgpfV8ke2N0eC5yZXF1ZXN0LnBhdGh9YDtcbiAgICBjb25zdCBvcGVyYXRpb25JZCA9IGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0uJHtvcGVyYXRpb25OYW1lfWA7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBsb2dUeXBlOiAnbG9nJyxcbiAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdCcsXG4gICAgICBlbnRpdHlOYW1lOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBvcGVyYXRpb246IG9wZXJhdGlvbk5hbWUsXG4gICAgICBjYXRlZ29yeTogbWVyZ2VkQXVkaXRDb25maWcuY2F0ZWdvcnksXG4gICAgICBhY3RvcjogY3R4LmFjdG9yLFxuICAgICAgY29ycmVsYXRpb246IHtcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgb3BlcmF0aW9uSWQsXG4gICAgICAgIHBhcmVudE9wZXJhdGlvbklkOiBjdHgucmVxdWVzdC5oZWFkZXJzPy5bJ3gtcGFyZW50LW9wZXJhdGlvbi1pZCddLFxuICAgICAgICBvcGVyYXRpb25UeXBlOiAnYXBpJyxcbiAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgc3RhcnRUaW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSxcbiAgICAgIGF1ZGl0Q29uZmlnOiBtZXJnZWRBdWRpdENvbmZpZ1xuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogTWVyZ2VzIGNvbnRyb2xsZXItbGV2ZWwgYW5kIG1ldGhvZC1sZXZlbCBhdWRpdCBjb25maWd1cmF0aW9uc1xuICAgKiBNZXRob2QtbGV2ZWwgY29uZmlnIHRha2VzIHByZWNlZGVuY2Ugb3ZlciBjb250cm9sbGVyLWxldmVsIGNvbmZpZ1xuICAgKiBAcGFyYW0gY29udHJvbGxlckF1ZGl0IC0gQ29udHJvbGxlci1sZXZlbCBhdWRpdCBjb25maWdcbiAgICogQHBhcmFtIG1ldGhvZEF1ZGl0IC0gTWV0aG9kLWxldmVsIGF1ZGl0IGNvbmZpZyAgXG4gICAqIEByZXR1cm5zIE1lcmdlZCBhdWRpdCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcml2YXRlIG1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJBdWRpdD86IEF1ZGl0Q29uZmlnLCBtZXRob2RBdWRpdD86IEF1ZGl0Q29uZmlnKTogQXVkaXRDb25maWcgfCB1bmRlZmluZWQge1xuICAgIGlmICghY29udHJvbGxlckF1ZGl0ICYmICFtZXRob2RBdWRpdCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoIWNvbnRyb2xsZXJBdWRpdCkgcmV0dXJuIG1ldGhvZEF1ZGl0O1xuICAgIGlmICghbWV0aG9kQXVkaXQpIHJldHVybiBjb250cm9sbGVyQXVkaXQ7XG4gICAgXG4gICAgLy8gRGVlcCBtZXJnZSB3aXRoIG1ldGhvZC1sZXZlbCBjb25maWcgdGFraW5nIHByZWNlZGVuY2VcbiAgICBjb25zdCBtZXJnZWQ6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgLi4uY29udHJvbGxlckF1ZGl0LFxuICAgICAgLi4ubWV0aG9kQXVkaXRcbiAgICB9O1xuICAgIFxuICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIG5lc3RlZCBvYmplY3RzXG4gICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcyB8fCBtZXRob2RBdWRpdC5pbmNsdWRlcykge1xuICAgICAgbWVyZ2VkLmluY2x1ZGVzID0ge1xuICAgICAgICAuLi5jb250cm9sbGVyQXVkaXQuaW5jbHVkZXMsXG4gICAgICAgIC4uLm1ldGhvZEF1ZGl0LmluY2x1ZGVzXG4gICAgICB9O1xuICAgICAgXG4gICAgICAvLyBNZXJnZSByZXF1ZXN0IGFuZCByZXNwb25zZSBhcnJheXMgaWYgYm90aCBleGlzdCBhbmQgYXJlIGFycmF5c1xuICAgICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcz8ucmVxdWVzdCAmJiBtZXRob2RBdWRpdC5pbmNsdWRlcz8ucmVxdWVzdCkge1xuICAgICAgICBjb25zdCBjb250cm9sbGVyUmVxdWVzdCA9IEFycmF5LmlzQXJyYXkoY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLnJlcXVlc3QpID8gY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLnJlcXVlc3QgOiBbXTtcbiAgICAgICAgY29uc3QgbWV0aG9kUmVxdWVzdCA9IEFycmF5LmlzQXJyYXkobWV0aG9kQXVkaXQuaW5jbHVkZXMucmVxdWVzdCkgPyBtZXRob2RBdWRpdC5pbmNsdWRlcy5yZXF1ZXN0IDogW107XG4gICAgICAgIG1lcmdlZC5pbmNsdWRlcy5yZXF1ZXN0ID0gWy4uLm5ldyBTZXQoWy4uLmNvbnRyb2xsZXJSZXF1ZXN0LCAuLi5tZXRob2RSZXF1ZXN0XSldO1xuICAgICAgfVxuICAgICAgaWYgKGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcz8ucmVzcG9uc2UgJiYgbWV0aG9kQXVkaXQuaW5jbHVkZXM/LnJlc3BvbnNlKSB7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJSZXNwb25zZSA9IEFycmF5LmlzQXJyYXkoY29udHJvbGxlckF1ZGl0LmluY2x1ZGVzLnJlc3BvbnNlKSA/IGNvbnRyb2xsZXJBdWRpdC5pbmNsdWRlcy5yZXNwb25zZSA6IFtdO1xuICAgICAgICBjb25zdCBtZXRob2RSZXNwb25zZSA9IEFycmF5LmlzQXJyYXkobWV0aG9kQXVkaXQuaW5jbHVkZXMucmVzcG9uc2UpID8gbWV0aG9kQXVkaXQuaW5jbHVkZXMucmVzcG9uc2UgOiBbXTtcbiAgICAgICAgbWVyZ2VkLmluY2x1ZGVzLnJlc3BvbnNlID0gWy4uLm5ldyBTZXQoWy4uLmNvbnRyb2xsZXJSZXNwb25zZSwgLi4ubWV0aG9kUmVzcG9uc2VdKV07XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIGlmIChjb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24gfHwgbWV0aG9kQXVkaXQuZGF0YVByb3RlY3Rpb24pIHtcbiAgICAgIG1lcmdlZC5kYXRhUHJvdGVjdGlvbiA9IHtcbiAgICAgICAgLi4uY29udHJvbGxlckF1ZGl0LmRhdGFQcm90ZWN0aW9uLFxuICAgICAgICAuLi5tZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvblxuICAgICAgfTtcbiAgICAgIFxuICAgICAgLy8gTWVyZ2UgZGVlcFJlZGFjdCBjb25maWdcbiAgICAgIGlmIChjb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3QgfHwgbWV0aG9kQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3QpIHtcbiAgICAgICAgbWVyZ2VkLmRhdGFQcm90ZWN0aW9uLmRlZXBSZWRhY3QgPSB7XG4gICAgICAgICAgLi4uY29udHJvbGxlckF1ZGl0LmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0LFxuICAgICAgICAgIC4uLm1ldGhvZEF1ZGl0LmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0XG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICAvLyBNZXJnZSBibGFja2xpc3RlZEtleXMgYXJyYXlzXG4gICAgICAgIGlmIChjb250cm9sbGVyQXVkaXQuZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3Q/LmJsYWNrbGlzdGVkS2V5cyAmJiBtZXRob2RBdWRpdC5kYXRhUHJvdGVjdGlvbj8uZGVlcFJlZGFjdD8uYmxhY2tsaXN0ZWRLZXlzKSB7XG4gICAgICAgICAgbWVyZ2VkLmRhdGFQcm90ZWN0aW9uLmRlZXBSZWRhY3QuYmxhY2tsaXN0ZWRLZXlzID0gW1xuICAgICAgICAgICAgLi4ubmV3IFNldChbXG4gICAgICAgICAgICAgIC4uLmNvbnRyb2xsZXJBdWRpdC5kYXRhUHJvdGVjdGlvbi5kZWVwUmVkYWN0LmJsYWNrbGlzdGVkS2V5cyxcbiAgICAgICAgICAgICAgLi4ubWV0aG9kQXVkaXQuZGF0YVByb3RlY3Rpb24uZGVlcFJlZGFjdC5ibGFja2xpc3RlZEtleXNcbiAgICAgICAgICAgIF0pXG4gICAgICAgICAgXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBpZiAoY29udHJvbGxlckF1ZGl0LmN1c3RvbUNvbnRleHQgfHwgbWV0aG9kQXVkaXQuY3VzdG9tQ29udGV4dCkge1xuICAgICAgbWVyZ2VkLmN1c3RvbUNvbnRleHQgPSB7XG4gICAgICAgIC4uLmNvbnRyb2xsZXJBdWRpdC5jdXN0b21Db250ZXh0LFxuICAgICAgICAuLi5tZXRob2RBdWRpdC5jdXN0b21Db250ZXh0XG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gbWVyZ2VkO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgcmVxdWVzdCBzdGFydFxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGNhcHR1cmVTdGFydChhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3RBdWRpdENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIHJlcXVlc3QgZW5kIChzdWNjZXNzIG9yIGVycm9yKVxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGNhcHR1cmVFbmQoYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsIHJlc3BvbnNlOiBSZXNwb25zZSwgZXJyb3I6IEVycm9yIHwgbnVsbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlQ29udGV4dCA9IHtcbiAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1c0NvZGUsXG4gICAgICByZXNwb25zZVNpemU6IHJlc3BvbnNlLmJvZHk/Lmxlbmd0aCB8fCAwLFxuICAgICAgcmVzcG9uc2U6IHRoaXMuYnVpbGRSZXNwb25zZUNvbnRleHQocmVzcG9uc2UsIGF1ZGl0Q29udGV4dC5hdWRpdENvbmZpZylcbiAgICB9O1xuICAgIFxuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIG51bGwsIGVycm9yLCByZXNwb25zZUNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyByZXF1ZXN0IGNvbnRleHQgZm9yIGF1ZGl0IGxvZ2dpbmdcbiAgICovXG4gIHByaXZhdGUgYnVpbGRSZXF1ZXN0Q29udGV4dChjdHg6IEV4ZWN1dGlvbkNvbnRleHQsIGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyk6IFJlcXVlc3RBdWRpdENvbnRleHQge1xuICAgIGNvbnN0IGluY2x1ZGVzID0gQXJyYXkuaXNBcnJheShhdWRpdENvbmZpZy5pbmNsdWRlcz8ucmVxdWVzdCkgXG4gICAgICA/IGF1ZGl0Q29uZmlnLmluY2x1ZGVzLnJlcXVlc3QgXG4gICAgICA6IGF1ZGl0Q29uZmlnLmluY2x1ZGVzPy5yZXF1ZXN0ID8gWydoZWFkZXJzJ10gOiBbXTtcbiAgICAgIFxuICAgIHJldHVybiB7XG4gICAgICBtZXRob2Q6IGN0eC5yZXF1ZXN0Lmh0dHBNZXRob2QsXG4gICAgICBwYXRoOiBjdHgucmVxdWVzdC5wYXRoLFxuICAgICAgdXNlckFnZW50OiBjdHguZXZlbnQuaGVhZGVycz8uWyd1c2VyLWFnZW50J10sXG4gICAgICBzb3VyY2VJcDogY3R4LmV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICBoZWFkZXJzOiBpbmNsdWRlcy5pbmNsdWRlcygnaGVhZGVycycpID8gY3R4LnJlcXVlc3QuaGVhZGVycyA6IHVuZGVmaW5lZCxcbiAgICAgIGJvZHk6IGluY2x1ZGVzLmluY2x1ZGVzKCdib2R5JykgPyBjdHgucmVxdWVzdC5ib2R5IDogdW5kZWZpbmVkLFxuICAgICAgcXVlcnk6IGluY2x1ZGVzLmluY2x1ZGVzKCdxdWVyeScpID8gY3R4LnJlcXVlc3QucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIDogdW5kZWZpbmVkXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgcmVzcG9uc2UgY29udGV4dCBmb3IgYXVkaXQgbG9nZ2luZ1xuICAgKi9cbiAgcHJpdmF0ZSBidWlsZFJlc3BvbnNlQ29udGV4dChyZXNwb25zZTogUmVzcG9uc2UsIGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZykge1xuICAgIGlmICghYXVkaXRDb25maWcuaW5jbHVkZXM/LnJlc3BvbnNlKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIFxuICAgIGNvbnN0IGluY2x1ZGVzID0gQXJyYXkuaXNBcnJheShhdWRpdENvbmZpZy5pbmNsdWRlcy5yZXNwb25zZSkgXG4gICAgICA/IGF1ZGl0Q29uZmlnLmluY2x1ZGVzLnJlc3BvbnNlIFxuICAgICAgOiBbJ2hlYWRlcnMnXTtcbiAgICAgIFxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgaGVhZGVyczogaW5jbHVkZXMuaW5jbHVkZXMoJ2hlYWRlcnMnKSA/IHJlc3BvbnNlLmhlYWRlcnMgOiB1bmRlZmluZWQsXG4gICAgICBib2R5OiBpbmNsdWRlcy5pbmNsdWRlcygnYm9keScpID8gcmVzcG9uc2UuYm9keSA6IHVuZGVmaW5lZFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY29udHJvbGxlciBjb25maWd1cmF0aW9uXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0Q29udHJvbGxlckNvbmZpZygpOiBJQ29udHJvbGxlckNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdjb250cm9sbGVyQ29uZmlnJykgfHwge307XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdHMgYWN0b3IgY29udGV4dCBmcm9tIHRoZSByZXF1ZXN0XG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGZvciBjdXN0b20gYWN0b3IgZXh0cmFjdGlvbiBsb2dpY1xuICAgKlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIEFQSSBHYXRld2F5LlxuICAgKiBAcGFyYW0gcmVxdWVzdCAtIFRoZSByZXF1ZXN0IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHJldHVybnMgVGhlIGFjdG9yIGNvbnRleHQuXG4gICAqIGBgYFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCk6IEFjdG9yIHtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVxdWVzdC5yZXF1ZXN0SWQ7XG4gICAgXG4gICAgY29uc3QgYWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkLFxuICAgICAgdGltZXN0YW1wLFxuICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uc291cmNlSXAsXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnM/LlsndXNlci1hZ2VudCddIHx8IGV2ZW50LmhlYWRlcnM/LlsnVXNlci1BZ2VudCddLFxuICAgICAgY29ycmVsYXRpb25JZDogcmVxdWVzdC5oZWFkZXJzPy5bJ3gtY29ycmVsYXRpb24taWQnXSB8fCByZXF1ZXN0SWQsXG4gICAgfTtcblxuICAgIC8vIENvZ25pdG8gYXV0aGVudGljYXRpb24gd2l0aCBmb2N1c2VkIGVuaGFuY2VtZW50c1xuICAgIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zKSB7XG4gICAgICB0aGlzLmV4dHJhY3RDb2duaXRvQ29udGV4dChldmVudC5yZXF1ZXN0Q29udGV4dC5hdXRob3JpemVyLmNsYWltcywgYWN0b3IpO1xuICAgIH1cbiAgICAvLyBBUEkgS2V5IGF1dGhlbnRpY2F0aW9uXG4gICAgZWxzZSBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkgfHwgcmVxdWVzdC5oZWFkZXJzPy5bJ3gtYXBpLWtleSddKSB7XG4gICAgICB0aGlzLmV4dHJhY3RBcGlLZXlDb250ZXh0KGV2ZW50LCByZXF1ZXN0LCBhY3Rvcik7XG4gICAgfVxuICAgIC8vIElBTSBhdXRoZW50aWNhdGlvbiBcbiAgICBlbHNlIGlmIChldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4pIHtcbiAgICAgIHRoaXMuZXh0cmFjdElhbUNvbnRleHQoZXZlbnQsIGFjdG9yKTtcbiAgICB9XG4gICAgLy8gQW5vbnltb3VzXG4gICAgZWxzZSB7XG4gICAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2Fub255bW91cyc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAnYW5vbnltb3VzJztcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSAnYW5vbnltb3VzJztcbiAgICB9XG5cbiAgICAvLyBTZXNzaW9uIGFuZCB0ZW5hbnQgY29udGV4dFxuICAgIHRoaXMuZXh0cmFjdFNlc3Npb25BbmRUZW5hbnRDb250ZXh0KGV2ZW50LCByZXF1ZXN0LCBhY3Rvcik7XG4gICAgXG4gICAgLy8gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgIGFjdG9yLmFwaVN0YWdlID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LnN0YWdlO1xuICAgIGFjdG9yLmFwaUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQ/LmFwaUlkO1xuICAgIFxuICAgIHJldHVybiBhY3RvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IENvZ25pdG8gYWN0b3IgY29udGV4dCBiYXNlZCBvbiBkb2N1bWVudGVkIEFXUyBDb2duaXRvIEpXVCBjbGFpbXNcbiAgICogT25seSBleHRyYWN0cyB3aGF0J3Mgb2ZmaWNpYWxseSBkb2N1bWVudGVkIGFuZCBhdmFpbGFibGUgaW4gQVBJIEdhdGV3YXkgY29udGV4dFxuICAgKiBcbiAgICogQHBhcmFtIGNsYWltcyAtIENvZ25pdG8gSldUIGNsYWltcyBmcm9tIHRoZSBhdXRob3JpemVyXG4gICAqIEBwYXJhbSBhY3RvciAtIEFjdG9yIG9iamVjdCB0byBwb3B1bGF0ZVxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDb2duaXRvQ29udGV4dChjbGFpbXM6IGFueSwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBcbiAgICAgIC8vIEFjdG9yIElEIHdpdGggZG9jdW1lbnRlZCBmYWxsYmFjayBzdHJhdGVneTogY29nbml0bzp1c2VybmFtZSAtPiBlbWFpbCAtPiBzdWJcbiAgICAgIGFjdG9yLmFjdG9ySWQgPSBjbGFpbXNbJ2NvZ25pdG86dXNlcm5hbWUnXSB8fCBjbGFpbXMuZW1haWwgfHwgY2xhaW1zLnN1YjtcbiAgICAgIFxuICAgICAgLy8gU3RhbmRhcmQgdXNlciBhdHRyaWJ1dGVzIChkb2N1bWVudGVkIENvZ25pdG8gdXNlciBhdHRyaWJ1dGVzKVxuICAgICAgYWN0b3IuZW1haWwgPSBjbGFpbXMuZW1haWw7XG4gICAgICBhY3Rvci5lbWFpbFZlcmlmaWVkID0gY2xhaW1zLmVtYWlsX3ZlcmlmaWVkID09PSAndHJ1ZSc7XG4gICAgICBhY3Rvci5waG9uZU51bWJlciA9IGNsYWltcy5waG9uZV9udW1iZXI7XG4gICAgICBhY3Rvci5waG9uZVZlcmlmaWVkID0gY2xhaW1zLnBob25lX251bWJlcl92ZXJpZmllZCA9PT0gJ3RydWUnO1xuICAgICAgYWN0b3IubmFtZSA9IGNsYWltcy5uYW1lO1xuICAgICAgYWN0b3IubG9jYWxlID0gY2xhaW1zLmxvY2FsZTtcbiAgICAgIFxuICAgICAgLy8gUGFyc2UgQ29nbml0byBncm91cHMgKGRvY3VtZW50ZWQgYXMgY29tbWEtc2VwYXJhdGVkIHN0cmluZylcbiAgICAgIGNvbnN0IGdyb3VwcyA9IHRoaXMucGFyc2VHcm91cHMoY2xhaW1zWydjb2duaXRvOmdyb3VwcyddKTtcbiAgICAgIFxuICAgICAgLy8gRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyAoZG9jdW1lbnRlZCBwYXR0ZXJuOiBjdXN0b206KilcbiAgICAgIGNvbnN0IGN1c3RvbUF0dHJpYnV0ZXMgPSB0aGlzLmV4dHJhY3RDdXN0b21BdHRyaWJ1dGVzKGNsYWltcyk7XG4gICAgICBcbiAgICAgIC8vIEJ1aWxkIENvZ25pdG8gY29udGV4dCB3aXRoIG9ubHkgZG9jdW1lbnRlZCBmaWVsZHNcbiAgICAgIGFjdG9yLmNvZ25pdG8gPSB7XG4gICAgICAgIHN1YjogY2xhaW1zLnN1YixcbiAgICAgICAgdXNlcm5hbWU6IGNsYWltc1snY29nbml0bzp1c2VybmFtZSddLFxuICAgICAgICBncm91cHM6IGdyb3VwcywgLy8gQWx3YXlzIGluY2x1ZGUgZ3JvdXBzIGFycmF5IChlbXB0eSBvciBwb3B1bGF0ZWQpXG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IE9iamVjdC5rZXlzKGN1c3RvbUF0dHJpYnV0ZXMpLmxlbmd0aCA+IDAgPyBjdXN0b21BdHRyaWJ1dGVzIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgICAgXG4gICAgICAvLyBFeHRyYWN0IHRlbmFudCBJRCBmcm9tIGN1c3RvbSBhdHRyaWJ1dGVzIChjb21tb24gbXVsdGktdGVuYW50IHBhdHRlcm4pXG4gICAgICBhY3Rvci50ZW5hbnRJZCA9IGN1c3RvbUF0dHJpYnV0ZXMudGVuYW50SWQ7XG4gICAgICBcbiAgICAgIGFjdG9yLnJhd0F1dGhDb250ZXh0ID0gY2xhaW1zO1xuICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0Vycm9yIGV4dHJhY3RpbmcgQ29nbml0byBhY3RvciBjb250ZXh0JywgeyBlcnJvciwgY2xhaW1zIH0pO1xuICAgICAgXG4gICAgICAvLyBNaW5pbWFsIGZhbGxiYWNrIGV4dHJhY3Rpb25cbiAgICAgIGFjdG9yLmF1dGhNZXRob2QgPSAnY29nbml0byc7XG4gICAgICBhY3Rvci5hY3RvclR5cGUgPSAndXNlcic7XG4gICAgICBhY3Rvci5hY3RvcklkID0gY2xhaW1zLnN1YiB8fCAndW5rbm93bic7XG4gICAgICBhY3Rvci5yYXdBdXRoQ29udGV4dCA9IGNsYWltcztcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2UgQ29nbml0byBncm91cHMgZnJvbSBjb21tYS1zZXBhcmF0ZWQgc3RyaW5nIChkb2N1bWVudGVkIENvZ25pdG8gZm9ybWF0KVxuICAgKi9cbiAgcHJvdGVjdGVkIHBhcnNlR3JvdXBzKGdyb3VwczogYW55KTogc3RyaW5nW10ge1xuICAgIGlmICh0eXBlb2YgZ3JvdXBzID09PSAnc3RyaW5nJyAmJiBncm91cHMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGdyb3Vwcy5zcGxpdCgnLCcpLm1hcChnID0+IGcudHJpbSgpKS5maWx0ZXIoZyA9PiBnLmxlbmd0aCA+IDApO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyB1c2luZyBkb2N1bWVudGVkIENvZ25pdG8gcGF0dGVybiAoY3VzdG9tOiopXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEN1c3RvbUF0dHJpYnV0ZXMoY2xhaW1zOiBhbnkpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICBjb25zdCBjdXN0b21BdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgXG4gICAgT2JqZWN0LmtleXMoY2xhaW1zKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoJ2N1c3RvbTonKSkge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0ga2V5LnJlcGxhY2UoJ2N1c3RvbTonLCAnJyk7XG4gICAgICAgIGN1c3RvbUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjbGFpbXNba2V5XTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gY3VzdG9tQXR0cmlidXRlcztcbiAgfVxuXG4gICAgLyoqXG4gICAqIEV4dHJhY3Qgc2Vzc2lvbiBhbmQgdGVuYW50IGNvbnRleHQgLSBmb2N1c2VkIGFwcHJvYWNoXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdFNlc3Npb25BbmRUZW5hbnRDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QsIGFjdG9yOiBBY3Rvcik6IHZvaWQge1xuICAgIC8vIFNlc3Npb24gY29udGV4dFxuICAgIGFjdG9yLnNlc3Npb25JZCA9IHJlcXVlc3QuaGVhZGVycz8uWyd4LXNlc3Npb24taWQnXTtcbiAgICBcbiAgICAvLyBUZW5hbnQgY29udGV4dCAtIGNoZWNrIGN1c3RvbSBhdHRyaWJ1dGVzIGZpcnN0LCB0aGVuIGhlYWRlcnNcbiAgICBhY3Rvci50ZW5hbnRJZCA9IHJlcXVlc3QuaGVhZGVycz8uWyd4LXRlbmFudC1pZCddIHx8IFxuICAgICAgICAgICAgICAgICAgICBldmVudC5yZXF1ZXN0Q29udGV4dD8uYXV0aG9yaXplcj8uY2xhaW1zPy5bJ2N1c3RvbTp0ZW5hbnRJZCddO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgQVBJIEtleSBjb250ZXh0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFwaUtleUNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCwgYWN0b3I6IEFjdG9yKTogdm9pZCB7XG4gICAgYWN0b3IuYXV0aE1ldGhvZCA9ICdhcGkta2V5JztcbiAgICBhY3Rvci5hY3RvclR5cGUgPSAnc2VydmljZSc7XG4gICAgXG4gICAgbGV0IGFwaUtleUlkOiBzdHJpbmc7XG4gICAgbGV0IHNvdXJjZTogJ3JlcXVlc3QtY29udGV4dCcgfCAnaGVhZGVyJztcbiAgICBcbiAgICBpZiAoZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py5hcGlLZXkpIHtcbiAgICAgIGFwaUtleUlkID0gZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuYXBpS2V5SWQgfHwgZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuYXBpS2V5O1xuICAgICAgc291cmNlID0gJ3JlcXVlc3QtY29udGV4dCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFwaUtleUlkID0gcmVxdWVzdC5oZWFkZXJzWyd4LWFwaS1rZXknXSE7XG4gICAgICBzb3VyY2UgPSAnaGVhZGVyJztcbiAgICB9XG4gICAgXG4gICAgYWN0b3IuYWN0b3JJZCA9IGBhcGkta2V5OiR7YXBpS2V5SWR9YDtcbiAgICBhY3Rvci5hcGlLZXkgPSB7XG4gICAgICBpZDogYXBpS2V5SWQsXG4gICAgICBzb3VyY2U6IHNvdXJjZSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgSUFNIGNvbnRleHRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0SWFtQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBhY3Rvci5hdXRoTWV0aG9kID0gJ2lhbSc7XG4gICAgYWN0b3IuYWN0b3JUeXBlID0gJ3NlcnZpY2UnO1xuICAgIGFjdG9yLmFjdG9ySWQgPSBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgXG4gICAgICAgICAgICAgICAgICAgZXZlbnQucmVxdWVzdENvbnRleHQ/LmlkZW50aXR5Py51c2VyQXJuIHx8IFxuICAgICAgICAgICAgICAgICAgICd1bmtub3duLWlhbS11c2VyJztcbiAgICBcbiAgICBhY3Rvci5pYW0gPSB7XG4gICAgICB1c2VyQXJuOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXJBcm4gfHwgdW5kZWZpbmVkLFxuICAgICAgdXNlcklkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnVzZXIgfHwgdW5kZWZpbmVkLFxuICAgICAgYWNjb3VudElkOiBldmVudC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LmFjY291bnRJZCB8fCB1bmRlZmluZWQsXG4gICAgICBjYWxsZXI6IGV2ZW50LnJlcXVlc3RDb250ZXh0Py5pZGVudGl0eT8uY2FsbGVyIHx8IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG59XG4iXX0=