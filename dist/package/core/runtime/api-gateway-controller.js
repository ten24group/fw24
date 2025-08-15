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
const validation_1 = require("../../validation");
const utils_1 = require("../../validation/utils");
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const request_context_1 = require("./request-context");
const response_context_1 = require("./response-context");
const response_config_1 = require("./response-config");
const errors_1 = require("../../errors/");
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
    validator = validation_1.DefaultValidator;
    middlewares = [];
    responseConfig;
    constructor(config = {}) {
        super();
        this.responseConfig = (0, response_config_1.mergeResponseConfig)(config.responseConfig);
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
        // this.logger.info("LambdaHandler Received event:", JSON.stringify(event, null, 2));
        const request = await this.makeRequestContext(event, context);
        const response = await this.makeResponseContext(request);
        // Build the execution context
        const ctx = this.buildCtx(event, context, request, response);
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
        // this.logger.info("Called findMatchingRoute with requestData: ", { requestData, routes: controller.routes });
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
        // this.logger.info('controllerBasePath: ', controllerBasePath);
        // this.logger.info('resourceWithoutRoot: ', resourceWithoutRoot);
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
                this.logger.info(`Found exact match for route: ${routeKey}`);
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
                    this.logger.info(`Found parameterized match for route: ${routeKey}`, {
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
    buildCtx(event, context, request, response) {
        return {
            event,
            lambdaContext: context,
            request,
            response,
            actor: undefined,
            debugInfo: {}
        };
    }
}
exports.APIController = APIController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFzREEsNENBeUJDO0FBN0VELGlEQUFpRTtBQUNqRSxvREFBNEQ7QUFDNUQsaURBQTZHO0FBQzdHLGtEQUE0RjtBQUM1Rix1RUFBa0U7QUFDbEUsdURBQW1EO0FBQ25ELHlEQUFxRDtBQUNyRCx1REFBd0U7QUFDeEUsMENBQWlIO0FBWWpILCtCQUErQjtBQUMvQixNQUFNLGlCQUFpQixHQUE4QixFQUFFLENBQUM7QUFFakQsTUFBTSxhQUFhLEdBQUcsQ0FBQyxVQUFtQyxFQUFFLEVBQUU7SUFDbkUsaUJBQWlCLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ3JDLENBQUMsQ0FBQTtBQUZZLFFBQUEsYUFBYSxpQkFFekI7QUFDTSxNQUFNLGdCQUFnQixHQUFHLEdBQUcsRUFBRTtJQUNuQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQy9CLENBQUMsQ0FBQTtBQUZZLFFBQUEsZ0JBQWdCLG9CQUU1QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixnQkFBZ0IsQ0FDOUIsT0FJcUIsRUFDckIsT0FBcUY7SUFHckYsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxZQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUd2RSxJQUFNLG9CQUFvQixHQUExQixNQUFNLG9CQUFvQjtRQUVsQixBQUFOLEtBQUssQ0FBQyxhQUFhO1lBQ2pCLHNEQUFzRDtRQUN4RCxDQUFDO0tBQ0YsQ0FBQTtJQUhPO1FBREwsTUFBTSxDQUFDLElBQUksQ0FBQzs2REFHWjtJQUpHLG9CQUFvQjtRQUR6QixJQUFB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YSxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQzVELE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRVMsY0FBYyxDQUFDLEdBQXFDO1FBQzVELElBQUksR0FBRyxZQUFZLGtDQUFlLEVBQUUsQ0FBQztZQUNuQyxPQUFPLEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQixDQUFDO1FBQ0QsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRVMsUUFBUSxDQUFDLEtBQXNCLEVBQUUsT0FBZ0IsRUFBRSxPQUFnQixFQUFFLFFBQWtCO1FBQy9GLE9BQU87WUFDTCxLQUFLO1lBQ0wsYUFBYSxFQUFFLE9BQU87WUFDdEIsT0FBTztZQUNQLFFBQVE7WUFDUixLQUFLLEVBQUUsU0FBUztZQUNoQixTQUFTLEVBQUUsRUFBRTtTQUNkLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUE1VkQsc0NBNFZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBBUElHYXRld2F5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgdHlwZSB7IFJlcXVlc3QsIFJlc3BvbnNlLCBSb3V0ZSB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBJQ29udHJvbGxlckNvbmZpZyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzXCI7XG5pbXBvcnQgeyBHZXQsIFJvdXRlTWV0aG9kcyB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzL21ldGhvZFwiO1xuaW1wb3J0IHsgRGVmYXVsdFZhbGlkYXRvciwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgSVZhbGlkYXRvciwgSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgeyBpc0h0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGUsIGlzSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi8uLi92YWxpZGF0aW9uL3V0aWxzXCI7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHsgUmVxdWVzdENvbnRleHQgfSBmcm9tIFwiLi9yZXF1ZXN0LWNvbnRleHRcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29udGV4dCB9IGZyb20gXCIuL3Jlc3BvbnNlLWNvbnRleHRcIjtcbmltcG9ydCB7IFJlc3BvbnNlQ29uZmlnLCBtZXJnZVJlc3BvbnNlQ29uZmlnIH0gZnJvbSBcIi4vcmVzcG9uc2UtY29uZmlnXCI7XG5pbXBvcnQgeyBWYWxpZGF0aW9uRmFpbGVkRXJyb3IsIEludmFsaWRIdHRwUmVxdWVzdFZhbGlkYXRpb25SdWxlRXJyb3IsIGNyZWF0ZUVycm9ySGFuZGxlciB9IGZyb20gXCIuLi8uLi9lcnJvcnMvXCI7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG5leHBvcnQgdHlwZSBDb250cm9sbGVyRXJyb3JIYW5kbGVyID0gUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlRXJyb3JIYW5kbGVyPjtcblxuLy8gTmV3IGludGVyZmFjZXMgZm9yIG1pZGRsZXdhcmUgYW5kIGVycm9yIGhhbmRsaW5nXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlIHtcbiAgYmVmb3JlPzogKHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgYWZ0ZXI/OiAocmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xuICBvbkVycm9yPzogKGVycm9yOiBFcnJvciwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiBQcm9taXNlPHZvaWQ+O1xufVxuXG4vLyBHbG9iYWwgbWlkZGxld2FyZSBtYW5hZ2VtZW50XG5jb25zdCBnbG9iYWxNaWRkbGV3YXJlczogQVBJQ29udHJvbGxlck1pZGRsZXdhcmVbXSA9IFtdO1xuXG5leHBvcnQgY29uc3QgdXNlTWlkZGxld2FyZSA9IChtaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSkgPT4ge1xuICBnbG9iYWxNaWRkbGV3YXJlcy5wdXNoKG1pZGRsZXdhcmUpO1xufVxuZXhwb3J0IGNvbnN0IGNsZWFyTWlkZGxld2FyZXMgPSAoKSA9PiB7XG4gIGdsb2JhbE1pZGRsZXdhcmVzLmxlbmd0aCA9IDA7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhbiBBUEkgaGFuZGxlciB3aXRob3V0IGRlZmluaW5nIGEgY2xhc3NcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBleHBvcnQgY29uc3QgeyBoYW5kbGVyLCBkZXNjcmlwdG9yIH0gPSBjcmVhdGVBcGlIYW5kbGVyKFxuICogIHsgbWV0aG9kOiBHZXQsIG5hbWU6ICdkZW1vJywgYXV0aG9yaXplcjogJ05PTkUnIH0sXG4gKiAgIGFzeW5jICggZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gKiAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAqICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gKiAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBcIkhlbGxvIFdvcmxkIVwifSlcbiAqICAgICAgIH0pXG4gKiAgIH1cbiAqIClcbiAqIGBgYFxuICogQHBhcmFtIG9wdGlvbnMgLSBUaGUgb3B0aW9ucyBmb3IgY3JlYXRpbmcgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBBUEkgaGFuZGxlci5cbiAqIEBwYXJhbSBvcHRpb25zLnBhdGggLSBUaGUgcGF0aCBmb3IgdGhlIEFQSSBoYW5kbGVyLlxuICogQHBhcmFtIG9wdGlvbnMubWV0aG9kIC0gVGhlIEhUVFAgbWV0aG9kIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIGZvciB0aGUgQVBJIGhhbmRsZXIuXG4gKiBAcmV0dXJucyBBbiBvYmplY3QgY29udGFpbmluZyB0aGUgaGFuZGxlciBmdW5jdGlvbiBhbmQgdGhlIGNvbnRyb2xsZXIgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUFwaUhhbmRsZXIoXG4gIG9wdGlvbnM6IHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgcGF0aD86IHN0cmluZyxcbiAgICBtZXRob2Q/OiBSb3V0ZU1ldGhvZHMsXG4gIH0gJiBJQ29udHJvbGxlckNvbmZpZyxcbiAgaGFuZGxlcjogKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpID0+IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0Pixcbikge1xuXG4gIGNvbnN0IHsgbmFtZSwgcGF0aCA9ICcnLCBtZXRob2QgPSBHZXQsIC4uLmNvbnRyb2xsZXJDb25maWcgfSA9IG9wdGlvbnM7XG5cbiAgQENvbnRyb2xsZXIobmFtZSwgeyAuLi5jb250cm9sbGVyQ29uZmlnLCBhdXRvRXhwb3J0TGFtYmRhSGFuZGxlcjogZmFsc2UgfSlcbiAgY2xhc3MgQ29udHJvbGxlckRlc2NyaXB0b3Ige1xuICAgIEBtZXRob2QocGF0aClcbiAgICBhc3luYyBpbmxpbmVIYW5kbGVyKCkge1xuICAgICAgLy8gcGxhY2Vob2xkZXIgZnVuY3Rpb24gb25seSB1c2VkIGZvciByb3V0aW5nIG1ldGFkYXRhXG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGhhbmRsZXIsICduYW1lJywgeyB2YWx1ZTogJ2hhbmRsZXInIH0pO1xuXG4gIHJldHVybiB7XG4gICAgaGFuZGxlcixcbiAgICBkZXNjcmlwdG9yOiBDb250cm9sbGVyRGVzY3JpcHRvclxuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFQSUNvbnRyb2xsZXJDb25maWcge1xuICByZXNwb25zZUNvbmZpZz86IFBhcnRpYWw8UmVzcG9uc2VDb25maWc+O1xufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQVBJQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHByb3RlY3RlZCB2YWxpZGF0b3I6IElWYWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yO1xuICBwcm90ZWN0ZWQgbWlkZGxld2FyZXM6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlW10gPSBbXTtcbiAgcHJvdGVjdGVkIHJlc3BvbnNlQ29uZmlnOiBSZXNwb25zZUNvbmZpZztcblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IEFQSUNvbnRyb2xsZXJDb25maWcgPSB7fSkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5yZXNwb25zZUNvbmZpZyA9IG1lcmdlUmVzcG9uc2VDb25maWcoY29uZmlnLnJlc3BvbnNlQ29uZmlnKTtcbiAgfVxuXG4gIGFic3RyYWN0IGluaXRpYWxpemUoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD47XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGdldE92ZXJyaWRkZW5IdHRwUmVxdWVzdFZhbGlkYXRpb25FcnJvck1lc3NhZ2VzKCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSk7XG4gIH1cblxuICAvLyBBZGQgbWlkZGxld2FyZSByZWdpc3RyYXRpb24gbWV0aG9kXG4gIHByb3RlY3RlZCB1c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlKSB7XG4gICAgdGhpcy5taWRkbGV3YXJlcy5wdXNoKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCkge1xuICAgIHJldHVybiBbIC4uLmdsb2JhbE1pZGRsZXdhcmVzLCAuLi50aGlzLm1pZGRsZXdhcmVzIF07XG4gIH1cblxuICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKFxuICAgIHBoYXNlOiAnYmVmb3JlJyB8ICdhZnRlcicgfCAnb25FcnJvcicsXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCxcbiAgICBlcnJvcj86IEVycm9yXG4gICk6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYWxsTWlkZGxld2FyZXMgPSB0aGlzLmdldE1pZGRsZXdhcmVzKCk7XG5cbiAgICBmb3IgKGNvbnN0IG1pZGRsZXdhcmUgb2YgYWxsTWlkZGxld2FyZXMpIHtcbiAgICAgIGlmIChwaGFzZSA9PT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmUub25FcnJvciAmJiBlcnJvcikge1xuICAgICAgICBhd2FpdCBtaWRkbGV3YXJlLm9uRXJyb3IoZXJyb3IsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgfSBlbHNlIGlmIChwaGFzZSAhPT0gJ29uRXJyb3InICYmIG1pZGRsZXdhcmVbIHBoYXNlIF0pIHtcbiAgICAgICAgYXdhaXQgbWlkZGxld2FyZVsgcGhhc2UgXSEocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICB9XG4gICAgfVxuXG4gIH1cblxuICBhc3luYyB2YWxpZGF0ZShyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCwgdmFsaWRhdGlvbnM6IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG4gICAgbGV0IHZhbGlkYXRpb25SdWxlczogSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyA9IHZhbGlkYXRpb25zO1xuICAgIGlmIChpc0lucHV0VmFsaWRhdGlvblJ1bGUodmFsaWRhdGlvbnMpKSB7XG4gICAgICBpZiAoWyAnR0VUJywgJ0RFTEVURScgXS5pbmNsdWRlcyhyZXF1ZXN0Q29udGV4dC5odHRwTWV0aG9kLnRvVXBwZXJDYXNlKCkpKSB7XG5cbiAgICAgICAgdmFsaWRhdGlvblJ1bGVzID0geyBxdWVyeTogdmFsaWRhdGlvbnMgfVxuXG4gICAgICB9IGVsc2UgaWYgKFsgJ1BPU1QnLCAnUFVUJywgJ1BBVENIJyBdLmluY2x1ZGVzKHJlcXVlc3RDb250ZXh0Lmh0dHBNZXRob2QudG9VcHBlckNhc2UoKSkpIHtcblxuICAgICAgICB2YWxpZGF0aW9uUnVsZXMgPSB7IGJvZHk6IHZhbGlkYXRpb25zIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzSHR0cFJlcXVlc3RWYWxpZGF0aW9uUnVsZSh2YWxpZGF0aW9uUnVsZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEh0dHBSZXF1ZXN0VmFsaWRhdGlvblJ1bGVFcnJvcih2YWxpZGF0aW9uUnVsZXMpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUh0dHBSZXF1ZXN0KHtcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgdmFsaWRhdGlvbnM6IHZhbGlkYXRpb25SdWxlcyxcbiAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWUsXG4gICAgICB2ZXJib3NlRXJyb3JzOiByZXF1ZXN0Q29udGV4dC5kZWJ1Z01vZGUsXG4gICAgICBvdmVycmlkZGVuRXJyb3JNZXNzYWdlczogYXdhaXQgdGhpcy5nZXRPdmVycmlkZGVuSHR0cFJlcXVlc3RWYWxpZGF0aW9uRXJyb3JNZXNzYWdlcygpXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBtYWtlUmVxdWVzdENvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UmVxdWVzdD4ge1xuICAgIHJldHVybiBuZXcgUmVxdWVzdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICB9XG5cbiAgYXN5bmMgbWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0Q29udGV4dDogUmVxdWVzdCk6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlQ29udGV4dCh7XG4gICAgICB0cmFjZUlkOiByZXF1ZXN0Q29udGV4dC5yZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0SWQ6IHJlcXVlc3RDb250ZXh0LnJlcXVlc3RJZCxcbiAgICAgIGRlYnVnTW9kZTogcmVxdWVzdENvbnRleHQuZGVidWdNb2RlLFxuICAgICAgcm91dGU6IHJlcXVlc3RDb250ZXh0LnBhdGgsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAnZGV2ZWxvcG1lbnQnLFxuICAgICAgY29uZmlnOiB0aGlzLnJlc3BvbnNlQ29uZmlnXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBjb250cm9sbGVyLlxuICAgKiBIYW5kbGVzIGluY29taW5nIEFQSSBHYXRld2F5IGV2ZW50cy5cbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdCBmcm9tIHRoZSBBUEkgR2F0ZXdheS5cbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgQVBJIEdhdGV3YXkuXG4gICAqIEByZXR1cm5zIFRoZSBBUEkgR2F0ZXdheSByZXNwb25zZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oXCJMYW1iZGFIYW5kbGVyIFJlY2VpdmVkIGV2ZW50OlwiLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuXG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0KTtcblxuICAgIC8vIEJ1aWxkIHRoZSBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IGN0eCA9IHRoaXMuYnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcblxuICAgIHRyeSB7XG5cbiAgICAgIC8vIExlZ2FjeSBpbml0aWFsaXplIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKGV2ZW50LCBjb250ZXh0KTtcblxuICAgICAgLy8gRXhlY3V0ZSBiZWZvcmUgbWlkZGxld2FyZVxuICAgICAgYXdhaXQgdGhpcy5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgY29uc3Qgcm91dGUgPSB0aGlzLmZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpO1xuXG4gICAgICAvLyBWYWxpZGF0ZSB0aGUgcmVxdWVzdCBpZiB2YWxpZGF0aW9ucyBhcmUgZGVmaW5lZFxuICAgICAgaWYgKHJvdXRlPy52YWxpZGF0aW9ucykge1xuICAgICAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy52YWxpZGF0ZShyZXF1ZXN0LCByb3V0ZS52YWxpZGF0aW9ucyk7XG4gICAgICAgIGlmICghdmFsaWRhdGlvblJlc3VsdC5wYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFZhbGlkYXRpb25GYWlsZWRFcnJvcih2YWxpZGF0aW9uUmVzdWx0LmVycm9ycyk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gY2FsbCB0aGUgcm91dGUgZnVuY3Rpb25cbiAgICAgIGNvbnN0IHJvdXRlRnVuY3Rpb24gPSB0aGlzLmdldFJvdXRlRnVuY3Rpb24ocm91dGUpO1xuICAgICAgbGV0IGNvbnRyb2xsZXJSZXNwb25zZTogYW55ID0gcm91dGVGdW5jdGlvbi5jYWxsKHRoaXMsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgaWYgKGNvbnRyb2xsZXJSZXNwb25zZSBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgY29udHJvbGxlclJlc3BvbnNlID0gYXdhaXQgY29udHJvbGxlclJlc3BvbnNlO1xuICAgICAgfVxuXG4gICAgICAvLyBFeGVjdXRlIGFmdGVyIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYWZ0ZXInLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcblxuICAgICAgLy8gSWYgdGhlIGNvbnRyb2xsZXIgcmV0dXJuZWQgYW55dGhpbmcgKFJlc3BvbnNlQ29udGV4dCBvciByYXcgQVBJIHJlc3VsdCksIGVtaXQgdGhhdFxuICAgICAgaWYgKGNvbnRyb2xsZXJSZXNwb25zZSAhPSBudWxsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGNvbnRyb2xsZXJSZXNwb25zZSk7XG4gICAgICB9XG5cbiAgICB9IGNhdGNoIChlcnIpIHtcblxuICAgICAgY29uc3QgZXJyb3JPYmogPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyKSk7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignTGFtYmRhSGFuZGxlciBlcnJvcjogJywgZXJyb3JPYmopO1xuXG4gICAgICAvLyBFeGVjdXRlIGVycm9yIG1pZGRsZXdhcmVcbiAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnb25FcnJvcicsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgsIGVycm9yT2JqKTtcblxuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlRXhjZXB0aW9uKHJlcXVlc3QsIGVycm9yT2JqLCByZXNwb25zZSk7XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2sgdG8gdGhlIGluLW1lbW9yeSByZXNwb25zZUNvbnRleHRcbiAgICByZXR1cm4gcmVzcG9uc2UuYnVpbGQoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgcm91dGUgdGhhdCBtYXRjaGVzIHRoZSBIVFRQIG1ldGhvZCBhbmQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSByZXF1ZXN0RGF0YSAtIFRoZSByZXF1ZXN0IGRhdGEgb2JqZWN0LlxuICAgKiBAcmV0dXJucyBUaGUgbWF0Y2hpbmcgcm91dGUgb3IgbnVsbCBpZiBub3QgZm91bmQuXG4gICAqL1xuICBwcml2YXRlIGZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhOiBSZXF1ZXN0KTogUm91dGUgfCBudWxsIHtcbiAgICBsZXQgY29udHJvbGxlcjogYW55ID0gdGhpcztcbiAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKFwiQ2FsbGVkIGZpbmRNYXRjaGluZ1JvdXRlIHdpdGggcmVxdWVzdERhdGE6IFwiLCB7IHJlcXVlc3REYXRhLCByb3V0ZXM6IGNvbnRyb2xsZXIucm91dGVzIH0pO1xuXG4gICAgLy8gRGV0ZXJtaW5lIHRoZSBjb250cm9sbGVyIGJhc2UgcGF0aCBieSBmaW5kaW5nIHRoZSBsb25nZXN0IGNvbW1vbiBwcmVmaXggdGhhdCBlbmRzIHdpdGggdGhlIGNvbnRyb2xsZXIgbmFtZVxuICAgIGxldCBjb250cm9sbGVyQmFzZVBhdGggPSBgLyR7Y29udHJvbGxlci5jb250cm9sbGVyTmFtZX1gO1xuICAgIGxldCByZXNvdXJjZVdpdGhvdXRSb290ID0gJy8nO1xuXG4gICAgLy8gRm9yIGNvbnRyb2xsZXJzIGluIHN1YmRpcmVjdG9yaWVzLCB3ZSBuZWVkIHRvIG1hdGNoIHRoZSBhY3R1YWwgcmVzb3VyY2UgcGF0aFxuICAgIC8vIENoZWNrIGlmIHJlc291cmNlIGNvbnRhaW5zIHRoZSBjb250cm9sbGVyIG5hbWUgYXMgcGFydCBvZiBhIGxvbmdlciBwYXRoXG4gICAgY29uc3QgcmVzb3VyY2VQYXJ0cyA9IHJlcXVlc3REYXRhLnJlc291cmNlLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lUGFydHMgPSBjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xuXG4gICAgLy8gRmluZCBpZiB0aGUgY29udHJvbGxlciBuYW1lIHBhcnRzIGFyZSBwcmVzZW50IGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgbGV0IGJhc2VQYXRoRW5kSW5kZXggPSAtMTtcbiAgICBpZiAoY29udHJvbGxlck5hbWVQYXJ0cy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyBMb29rIGZvciB0aGUgY29udHJvbGxlciBuYW1lIHNlcXVlbmNlIGluIHRoZSByZXNvdXJjZSBwYXRoXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSByZXNvdXJjZVBhcnRzLmxlbmd0aCAtIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgbGV0IG1hdGNoZXMgPSB0cnVlO1xuICAgICAgICBmb3IgKGxldCBqID0gMDsgaiA8IGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBpZiAocmVzb3VyY2VQYXJ0c1sgaSArIGogXSAhPT0gY29udHJvbGxlck5hbWVQYXJ0c1sgaiBdKSB7XG4gICAgICAgICAgICBtYXRjaGVzID0gZmFsc2U7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgICBiYXNlUGF0aEVuZEluZGV4ID0gaSArIGNvbnRyb2xsZXJOYW1lUGFydHMubGVuZ3RoIC0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChiYXNlUGF0aEVuZEluZGV4ID49IDApIHtcbiAgICAgIC8vIEZvdW5kIHRoZSBjb250cm9sbGVyIGJhc2UgcGF0aCBpbiB0aGUgcmVzb3VyY2VcbiAgICAgIGNvbnN0IGJhc2VQYXRoUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKDAsIGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIGNvbnRyb2xsZXJCYXNlUGF0aCA9ICcvJyArIGJhc2VQYXRoUGFydHMuam9pbignLycpO1xuICAgICAgY29uc3QgcmVtYWluaW5nUGFydHMgPSByZXNvdXJjZVBhcnRzLnNsaWNlKGJhc2VQYXRoRW5kSW5kZXggKyAxKTtcbiAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZW1haW5pbmdQYXJ0cy5sZW5ndGggPiAwID8gJy8nICsgcmVtYWluaW5nUGFydHMuam9pbignLycpIDogJy8nO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGYWxsYmFjayB0byBvcmlnaW5hbCBsb2dpYyBmb3Igc2ltcGxlIGNhc2VzXG4gICAgICBpZiAocmVxdWVzdERhdGEucmVzb3VyY2Uuc3RhcnRzV2l0aChjb250cm9sbGVyQmFzZVBhdGgpKSB7XG4gICAgICAgIHJlc291cmNlV2l0aG91dFJvb3QgPSByZXF1ZXN0RGF0YS5yZXNvdXJjZS5zdWJzdHJpbmcoY29udHJvbGxlckJhc2VQYXRoLmxlbmd0aCkgfHwgJy8nO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHRoaXMubG9nZ2VyLmluZm8oJ2NvbnRyb2xsZXJCYXNlUGF0aDogJywgY29udHJvbGxlckJhc2VQYXRoKTtcbiAgICAvLyB0aGlzLmxvZ2dlci5pbmZvKCdyZXNvdXJjZVdpdGhvdXRSb290OiAnLCByZXNvdXJjZVdpdGhvdXRSb290KTtcblxuICAgIC8vIFNlcGFyYXRlIHJvdXRlcyBpbnRvIGV4YWN0IGFuZCBwYXJhbWV0ZXJpemVkIGZvciBwcm9wZXIgcHJpb3JpdGl6YXRpb25cbiAgICBjb25zdCBleGFjdE1hdGNoZXM6IEFycmF5PHsgcm91dGVLZXk6IHN0cmluZywgcm91dGU6IFJvdXRlIH0+ID0gW107XG4gICAgY29uc3QgcGFyYW1ldGVyaXplZE1hdGNoZXM6IEFycmF5PHsgcm91dGVLZXk6IHN0cmluZywgcm91dGU6IFJvdXRlIH0+ID0gW107XG5cbiAgICAvLyBGaXJzdCBwYXNzOiBjYXRlZ29yaXplIHJvdXRlcyBieSB0eXBlIGFuZCBtZXRob2RcbiAgICBmb3IgKGNvbnN0IFsgcm91dGVLZXksIHJvdXRlIF0gb2YgT2JqZWN0LmVudHJpZXMoY29udHJvbGxlci5yb3V0ZXMgfHwge30pIGFzIFsgc3RyaW5nLCBSb3V0ZSBdW10pIHtcbiAgICAgIGNvbnN0IFsgcm91dGVNZXRob2QsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgLy8gU2tpcCBpZiBIVFRQIG1ldGhvZCBkb2Vzbid0IG1hdGNoXG4gICAgICBpZiAocm91dGVNZXRob2QgIT09IHJlcXVlc3REYXRhLmh0dHBNZXRob2QpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIENhdGVnb3JpemUgcm91dGUgdHlwZVxuICAgICAgaWYgKHJvdXRlUGF0aC5pbmNsdWRlcygneycpICYmIHJvdXRlUGF0aC5pbmNsdWRlcygnfScpKSB7XG4gICAgICAgIHBhcmFtZXRlcml6ZWRNYXRjaGVzLnB1c2goeyByb3V0ZUtleSwgcm91dGUgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleGFjdE1hdGNoZXMucHVzaCh7IHJvdXRlS2V5LCByb3V0ZSB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZWNvbmQgcGFzczogVHJ5IGV4YWN0IG1hdGNoZXMgZmlyc3QgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgZm9yIChjb25zdCB7IHJvdXRlS2V5LCByb3V0ZSB9IG9mIGV4YWN0TWF0Y2hlcykge1xuICAgICAgY29uc3QgWyAsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgaWYgKHJvdXRlUGF0aCA9PT0gcmVzb3VyY2VXaXRob3V0Um9vdCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBGb3VuZCBleGFjdCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCk7XG4gICAgICAgIHJldHVybiByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUaGlyZCBwYXNzOiBUcnkgcGFyYW1ldGVyaXplZCBtYXRjaGVzIChzb3J0ZWQgYnkgc3BlY2lmaWNpdHkpXG4gICAgLy8gU29ydCBwYXJhbWV0ZXJpemVkIHJvdXRlcyBieSBzcGVjaWZpY2l0eSAobW9yZSBsaXRlcmFsIHNlZ21lbnRzID0gaGlnaGVyIHByaW9yaXR5KVxuICAgIGNvbnN0IHNvcnRlZFBhcmFtZXRlcml6ZWRNYXRjaGVzID0gcGFyYW1ldGVyaXplZE1hdGNoZXNcbiAgICAgIC5tYXAoKHsgcm91dGVLZXksIHJvdXRlIH0pID0+IHtcbiAgICAgICAgY29uc3QgWyAsIHJvdXRlUGF0aCBdID0gcm91dGVLZXkuc3BsaXQoJ3wnKTtcbiAgICAgICAgY29uc3Qgc2VnbWVudHMgPSByb3V0ZVBhdGguc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgIGNvbnN0IGxpdGVyYWxTZWdtZW50cyA9IHNlZ21lbnRzLmZpbHRlcihzZWdtZW50ID0+ICFzZWdtZW50LmluY2x1ZGVzKCd7JykpO1xuXG4gICAgICAgIC8vIFNwZWNpZmljaXR5IHNjb3JlOiBtb3JlIGxpdGVyYWwgc2VnbWVudHMgPSBoaWdoZXIgc2NvcmVcbiAgICAgICAgLy8gRm9yIGVxdWFsIGxpdGVyYWwgc2VnbWVudHMsIGZld2VyIHRvdGFsIHNlZ21lbnRzID0gaGlnaGVyIHNjb3JlICBcbiAgICAgICAgY29uc3Qgc3BlY2lmaWNpdHlTY29yZSA9IChsaXRlcmFsU2VnbWVudHMubGVuZ3RoICogMTAwMCkgLSBzZWdtZW50cy5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGgsIHNwZWNpZmljaXR5U2NvcmUgfTtcbiAgICAgIH0pXG4gICAgICAuc29ydCgoYSwgYikgPT4gYi5zcGVjaWZpY2l0eVNjb3JlIC0gYS5zcGVjaWZpY2l0eVNjb3JlKTsgLy8gSGlnaGVyIHNjb3JlIGZpcnN0XG5cbiAgICBmb3IgKGNvbnN0IHsgcm91dGVLZXksIHJvdXRlLCByb3V0ZVBhdGggfSBvZiBzb3J0ZWRQYXJhbWV0ZXJpemVkTWF0Y2hlcykge1xuICAgICAgLy8gQ29udmVydCBmcmFtZXdvcmsge2lkfSBzeW50YXggdG8gcGF0aC10by1yZWdleHAgOmlkIHN5bnRheFxuICAgICAgY29uc3QgcGF0aFRvUmVnZXhwUGF0dGVybiA9IHJvdXRlUGF0aC5yZXBsYWNlKC9cXHsoW159XSspXFx9L2csICc6JDEnKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gVXNlIHBhdGgtdG8tcmVnZXhwIGZvciBwcm9wZXIgcGFyYW1ldGVyIG1hdGNoaW5nXG4gICAgICAgIGNvbnN0IHsgbWF0Y2ggfSA9IHJlcXVpcmUoJ3BhdGgtdG8tcmVnZXhwJyk7XG4gICAgICAgIGNvbnN0IG1hdGNoZXIgPSBtYXRjaChwYXRoVG9SZWdleHBQYXR0ZXJuLCB7IGRlY29kZTogZGVjb2RlVVJJQ29tcG9uZW50IH0pO1xuICAgICAgICBjb25zdCBtYXRjaFJlc3VsdCA9IG1hdGNoZXIocmVzb3VyY2VXaXRob3V0Um9vdCk7XG5cbiAgICAgICAgaWYgKG1hdGNoUmVzdWx0KSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRm91bmQgcGFyYW1ldGVyaXplZCBtYXRjaCBmb3Igcm91dGU6ICR7cm91dGVLZXl9YCwge1xuICAgICAgICAgICAgcGF0dGVybjogcGF0aFRvUmVnZXhwUGF0dGVybixcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hSZXN1bHQucGFyYW1zLFxuICAgICAgICAgICAgc3BlY2lmaWNpdHlTY29yZTogc29ydGVkUGFyYW1ldGVyaXplZE1hdGNoZXMuZmluZChtID0+IG0ucm91dGVLZXkgPT09IHJvdXRlS2V5KT8uc3BlY2lmaWNpdHlTY29yZVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gTm90ZTogV2UgZG9uJ3QgbmVlZCB0byBtYW51YWxseSBleHRyYWN0IHBhcmFtZXRlcnMgc2luY2UgQVBJIEdhdGV3YXlcbiAgICAgICAgICAvLyBhbHJlYWR5IHByb3ZpZGVzIHRoZW0gaW4gcmVxdWVzdERhdGEucGF0aFBhcmFtZXRlcnNcbiAgICAgICAgICByZXR1cm4gcm91dGU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYEVycm9yIG1hdGNoaW5nIHJvdXRlIHBhdHRlcm4gJHtwYXRoVG9SZWdleHBQYXR0ZXJufTpgLCBlcnJvcik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIG1hdGNoaW5nIHJvdXRlIGZvdW5kIGZvciAke3JlcXVlc3REYXRhLmh0dHBNZXRob2R9fCR7cmVzb3VyY2VXaXRob3V0Um9vdH1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZXMgdGhlIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgcm91dGUuXG4gICAqIEBwYXJhbSByb3V0ZSAtIFRoZSBtYXRjaGVkIHJvdXRlLlxuICAgKiBAcmV0dXJucyBUaGUgZnVuY3Rpb24gYXNzb2NpYXRlZCB3aXRoIHRoZSByb3V0ZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0Um91dGVGdW5jdGlvbihyb3V0ZTogUm91dGUgfCBudWxsKTogRnVuY3Rpb24ge1xuICAgIGlmICghcm91dGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmhhbmRsZU5vdEZvdW5kLmJpbmQodGhpcyk7XG4gICAgfVxuXG4gICAgLy9AdHMtaWdub3JlXG4gICAgY29uc3Qgcm91dGVGdW5jdGlvbiA9IHRoaXNbIHJvdXRlLmZ1bmN0aW9uTmFtZSBdO1xuXG4gICAgcmV0dXJuIHR5cGVvZiByb3V0ZUZ1bmN0aW9uID09PSBcImZ1bmN0aW9uXCIgPyByb3V0ZUZ1bmN0aW9uIDogdGhpcy5oYW5kbGVOb3RGb3VuZC5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgdGhlIE5vdEZvdW5kIHJvdXRlLlxuICAgKiBAcGFyYW0gX3JlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNDA0IHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZU5vdEZvdW5kKF9yZXE6IFJlcXVlc3QpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogXCJObyBSb3V0ZSBGb3VuZCFcIiB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlcnJvckhhbmRsZXI/OiBDb250cm9sbGVyRXJyb3JIYW5kbGVyO1xuICBwcm90ZWN0ZWQgZ2V0RXJyb3JIYW5kbGVyKCk6IENvbnRyb2xsZXJFcnJvckhhbmRsZXIge1xuICAgIGlmICghdGhpcy5lcnJvckhhbmRsZXIpIHtcbiAgICAgIHRoaXMuZXJyb3JIYW5kbGVyID0gY3JlYXRlRXJyb3JIYW5kbGVyKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmVycm9ySGFuZGxlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGV4Y2VwdGlvbnMgYW5kIHJldHVybnMgYSBKU09OIHJlc3BvbnNlIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSBfcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuICAgKiBAcGFyYW0gZXJyIC0gVGhlIGVycm9yIG9iamVjdC5cbiAgICogQHJldHVybnMgVGhlIHJlc3BvbnNlIG9iamVjdCB3aXRoIGEgNTAwIHN0YXR1cyBjb2RlLlxuICAgKi9cbiAgcHJvdGVjdGVkIGhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogUmVzcG9uc2UpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSB0aGlzLmdldEVycm9ySGFuZGxlcigpKGVyciwgcmVxLCByZXMpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVJlc3BvbnNlKGVycm9yUmVzcG9uc2UpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVJlc3BvbnNlKHJlczogUmVzcG9uc2UgfCBBUElHYXRld2F5UHJveHlSZXN1bHQpOiBBUElHYXRld2F5UHJveHlSZXN1bHQge1xuICAgIGlmIChyZXMgaW5zdGFuY2VvZiBSZXNwb25zZUNvbnRleHQpIHtcbiAgICAgIHJldHVybiByZXMuYnVpbGQoKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcztcbiAgfVxuXG4gIHByb3RlY3RlZCBidWlsZEN0eChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgICByZXR1cm4ge1xuICAgICAgZXZlbnQsXG4gICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgcmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgYWN0b3I6IHVuZGVmaW5lZCxcbiAgICAgIGRlYnVnSW5mbzoge31cbiAgICB9O1xuICB9XG59XG4iXX0=