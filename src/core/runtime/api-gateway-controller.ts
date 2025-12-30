import type { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { Controller, IControllerConfig } from "../../decorators";
import { Get, RouteMethods } from "../../decorators/method";
import { InvalidHttpRequestValidationRuleError, ValidationFailedError, createErrorHandler } from "../../errors/";
import type { Request, Response, Route } from "../../interfaces";
import { SpanObserver, generateTraceId, redactSensitiveData } from '../../observability';
import {
  ControllerObservabilityConfig,
  mergeObservabilityConfigs,
  normalizeIncludes,
  selectFields,
  selectFieldsFromBody
} from '../../observability/controller-config';
import { HttpRequestValidations, InputValidationRule } from "../../validation";
import { isHttpRequestValidationRule, isInputValidationRule } from "../../validation/utils";
import { Actor, ExecutionContext } from '../types/execution-context';
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import {
  createExecutionContext,
  extractFromHeaders,
  runWithExecutionContext,
} from './execution-context';
import { RequestContext } from "./request-context";
import { ResponseConfig, mergeResponseConfig } from "./response-config";
import { ResponseContext } from "./response-context";

export type ControllerErrorHandler = ReturnType<typeof createErrorHandler>;

// New interfaces for middleware and error handling
export interface APIControllerMiddleware {
  before?: (request: Request, response: Response, ctx?: ExecutionContext) => Promise<void>;
  after?: (request: Request, response: Response, ctx?: ExecutionContext) => Promise<void>;
  onError?: (error: Error, request: Request, response: Response, ctx?: ExecutionContext) => Promise<void>;
}

// Global middleware management
const globalMiddlewares: Set<APIControllerMiddleware> = new Set();

export const useMiddleware = (middleware: APIControllerMiddleware) => {
  globalMiddlewares.add(middleware);
}
export const clearMiddlewares = () => {
  globalMiddlewares.clear();
}

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
export function createApiHandler(
  options: {
    name: string,
    path?: string,
    method?: RouteMethods,
  } & IControllerConfig,
  handler: (event: APIGatewayEvent, context: Context) => Promise<APIGatewayProxyResult>,
) {

  const { name, path = '', method = Get, ...controllerConfig } = options;

  @Controller(name, { ...controllerConfig, autoExportLambdaHandler: false })
  class ControllerDescriptor {
    @method(path)
    async inlineHandler() {
      // placeholder function only used for routing metadata
    }
  }

  Object.defineProperty(handler, 'name', { value: 'handler' });

  return {
    handler,
    descriptor: ControllerDescriptor
  };
}

export interface APIControllerConfig {
  responseConfig?: Partial<ResponseConfig>;
}

export abstract class APIController extends AbstractLambdaHandler {
  protected middlewares: Set<APIControllerMiddleware> = new Set();
  protected responseConfig: ResponseConfig;

  constructor(config: APIControllerConfig = {}) {
    super();
    this.responseConfig = mergeResponseConfig(config.responseConfig);
  }

  /**
   * can be used to run some logic just before the request is processed like creating clients, di-injection ans so on.
   * @param _event - The event object from the API Gateway.
   * @param _context - The context object from the API Gateway.
   * @returns A promise that resolves when the controller is initialized.
  */
  protected async initialize(_event: APIGatewayEvent, _context: Context): Promise<void> {
    // No-op for API controllers
    return Promise.resolve();
  }

  protected async getOverriddenHttpRequestValidationErrorMessages() {
    return Promise.resolve(new Map<string, string>());
  }

  // Add middleware registration method
  protected useMiddleware(middleware: APIControllerMiddleware) {
    this.middlewares.add(middleware);
  }

  protected getMiddlewares() {
    return [ ...Array.from(globalMiddlewares), ...Array.from(this.middlewares) ];
  }

  // Execute middleware pipeline
  private async executeMiddlewarePipeline(
    phase: 'before' | 'after' | 'onError',
    request: Request,
    response: Response,
    ctx?: ExecutionContext,
    error?: Error
  ): Promise<void> {

    const allMiddlewares = this.getMiddlewares();

    for (const middleware of allMiddlewares) {
      if (phase === 'onError' && middleware.onError && error) {
        await middleware.onError(error, request, response, ctx);
      } else if (phase !== 'onError' && middleware[ phase ]) {
        await middleware[ phase ]!(request, response, ctx);
      }
    }

  }

  async validate(requestContext: Request, validations: InputValidationRule | HttpRequestValidations, _ctx?: ExecutionContext) {

    let validationRules: HttpRequestValidations = validations;
    if (isInputValidationRule(validations)) {
      if ([ 'GET', 'DELETE' ].includes(requestContext.httpMethod.toUpperCase())) {

        validationRules = { query: validations }

      } else if ([ 'POST', 'PUT', 'PATCH' ].includes(requestContext.httpMethod.toUpperCase())) {

        validationRules = { body: validations }
      }
    }

    if (!isHttpRequestValidationRule(validationRules)) {
      throw new InvalidHttpRequestValidationRuleError(validationRules);
    }

    return this.validator.validateHttpRequest({
      requestContext,
      validations: validationRules,
      collectErrors: true,
      verboseErrors: requestContext.debugMode,
      overriddenErrorMessages: await this.getOverriddenHttpRequestValidationErrorMessages()
    });
  }

  async makeRequestContext(event: APIGatewayEvent, context: Context): Promise<Request> {
    return new RequestContext(event, context);
  }

  async makeResponseContext(requestContext: Request): Promise<Response> {
    return new ResponseContext({
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
  async LambdaHandler(event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> {
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
    const traceContext = extractFromHeaders(request.headers || {});
    const correlationId = request.requestId || generateTraceId();
    const causedBy = traceContext?.causedBy ?? traceContext?.correlationId;

    // Create execution context with custom source and tags from decorator
    const execCtx = createExecutionContext({
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
    return runWithExecutionContext(execCtx, async () => {
      // Set ctx.executionContext to point to the execution context
      ctx.executionContext = execCtx;

      // Sync actor.correlationId with the resolved correlationId
      // This ensures actor stored in _actor field has the correct trace ID
      if (ctx.actor) {
        ctx.actor.correlationId = correlationId;
      }

      // Use the base class helper for span + flush pattern
      return this.executeWithSpanAndFlush(
        `HTTP ${request.httpMethod} ${request.path}`,
        async (requestSpan) => {
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
                throw new ValidationFailedError(validationResult.errors);
              }
            }

            // Call the route function
            const routeFunction = this.getRouteFunction(route);
            let controllerResponse: any = routeFunction.call(this, request, response, ctx);
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
                  if (responseAttrs[ 'http.statusCode' ]) {
                    requestSpan.metric('http.statusCode', responseAttrs[ 'http.statusCode' ] as number);
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
                if (responseAttrs[ 'http.statusCode' ]) {
                  requestSpan.metric('http.statusCode', responseAttrs[ 'http.statusCode' ] as number);
                }
                requestSpan.setData(responseAttrs);
              }
            }
            // Flush happens automatically in executeWithSpanAndFlush's finally block
            return response.build();

          } catch (err) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            this.logger.error('LambdaHandler error: ', errorObj);

            // Execute error middleware
            await this.executeMiddlewarePipeline('onError', request, response, ctx, errorObj);

            // Flush happens automatically in executeWithSpanAndFlush's finally block
            // Note: withSpan will call span.end({ success: false, error }) automatically
            // We still need to return a response (error handler may have modified it)
            throw errorObj;
          }
        },
        {
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
        }
      ).catch((err) => {
        // Handle error response after span ends
        return this.handleException(request, err instanceof Error ? err : new Error(String(err)), response);
      });
    });
  }

  /**
   * Gets merged observability config from controller and method level
   */
  protected getObservabilityConfig(route?: Route | null): ControllerObservabilityConfig | undefined {
    const controllerConfig = this.getControllerConfig();
    return mergeObservabilityConfigs(controllerConfig?.observability, route?.observability);
  }

  /**
   * Build automatic tags for HTTP requests.
   * These tags enable powerful filtering in observability UIs.
   */
  protected buildAutomaticTags(
    request: Request,
    actor: Actor | undefined,
    event: APIGatewayEvent
  ): Record<string, string> {
    const tags: Record<string, string> = {};

    // HTTP method category (similar to service operations)
    const method = request.httpMethod.toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      tags.operation_category = 'read';
    } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      tags.operation_category = 'write';
    } else if (method === 'DELETE') {
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
  protected buildSpanAttributes(
    event: APIGatewayEvent,
    request: Request,
    config?: ControllerObservabilityConfig
  ): Record<string, unknown> {
    // Always include basic HTTP attributes
    const attrs: Record<string, unknown> = {
      'http.method': request.httpMethod,
      'http.path': request.path,
      'http.requestId': request.requestId,
      'http.userAgent': event.headers?.[ 'user-agent' ] || event.headers?.[ 'User-Agent' ],
      'http.sourceIp': event.requestContext?.identity?.sourceIp,
    };

    // If disabled or no includes config, return basic attrs only
    if (config?.enabled === false || !config?.includes) {
      return attrs;
    }

    // Build request data based on includes config
    const includes = normalizeIncludes(config.includes);
    const requestData: Record<string, unknown> = {};

    if (includes.request.headers) {
      const headerData = selectFields(request.headers as Record<string, unknown>, includes.request.headers);
      if (headerData) requestData.headers = headerData;
    }

    if (includes.request.body && request.body) {
      const bodyData = typeof request.body === 'string'
        ? selectFieldsFromBody(request.body, includes.request.body)
        : selectFields(request.body as Record<string, unknown>, includes.request.body);
      if (bodyData) requestData.body = bodyData;
    }

    if (includes.request.query && request.queryStringParameters) {
      const queryData = selectFields(request.queryStringParameters as Record<string, unknown>, includes.request.query);
      if (queryData) requestData.query = queryData;
    }

    // Apply data protection and add to attributes
    if (Object.keys(requestData).length > 0) {
      attrs[ 'request' ] = config.dataProtection?.enabled !== false
        ? redactSensitiveData(requestData, config.dataProtection)
        : requestData;
    }

    return attrs;
  }

  /**
   * Build response attributes based on observability config.
   * Only captures response body/headers if explicitly configured via `includes`.
   */
  protected buildResponseAttributes(
    response: Response,
    config?: ControllerObservabilityConfig
  ): Record<string, unknown> | undefined {
    // Always include status code
    const attrs: Record<string, unknown> = {
      'http.statusCode': response.statusCode,
    };

    // If disabled or no includes config, return just status code
    if (config?.enabled === false || !config?.includes) {
      return attrs;
    }

    const includes = normalizeIncludes(config.includes);
    const responseData: Record<string, unknown> = {};

    if (includes.response.headers && response.headers) {
      const headerData = selectFields(response.headers as Record<string, unknown>, includes.response.headers);
      if (headerData) responseData.headers = headerData;
    }

    if (includes.response.body && response.body) {
      const bodyData = selectFieldsFromBody(response.body, includes.response.body);
      if (bodyData) responseData.body = bodyData;
    }

    // Apply data protection and add to attributes
    if (Object.keys(responseData).length > 0) {
      attrs[ 'response' ] = config.dataProtection?.enabled !== false
        ? redactSensitiveData(responseData, config.dataProtection)
        : responseData;
    }

    return attrs;
  }

  /**
   * Finds the route that matches the HTTP method and resource.
   * @param requestData - The request data object.
   * @returns The matching route or null if not found.
   */
  private findMatchingRoute(requestData: Request): Route | null {
    let controller: any = this;

    // Determine the controller base path by finding the longest common prefix that ends with the controller name
    const controllerName = typeof controller.controllerName === 'string' ? controller.controllerName : '';
    let controllerBasePath = controllerName ? `/${controllerName}` : '';
    let resourceWithoutRoot = '/';

    // For controllers in subdirectories, we need to match the actual resource path
    // Check if resource contains the controller name as part of a longer path
    const requestResource = (requestData.resource || requestData.path || '/') as string;
    const resourceParts = requestResource.split('/').filter(Boolean);
    const controllerNameParts = controllerName.split('/').filter(Boolean);

    // Find if the controller name parts are present in the resource path
    let basePathEndIndex = -1;
    if (controllerNameParts.length > 0) {
      // Look for the controller name sequence in the resource path
      for (let i = 0; i <= resourceParts.length - controllerNameParts.length; i++) {
        let matches = true;
        for (let j = 0; j < controllerNameParts.length; j++) {
          if (resourceParts[ i + j ] !== controllerNameParts[ j ]) {
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
    } else {
      // Fallback to original logic for simple cases
      if (controllerBasePath && requestResource.startsWith(controllerBasePath)) {
        resourceWithoutRoot = requestResource.substring(controllerBasePath.length) || '/';
      } else if (!controllerBasePath) {
        // No controllerName configured: treat the full resource as the route path.
        resourceWithoutRoot = requestResource || '/';
      }
    }

    // Separate routes into exact and parameterized for proper prioritization
    const exactMatches: Array<{ routeKey: string, route: Route }> = [];
    const parameterizedMatches: Array<{ routeKey: string, route: Route }> = [];

    // First pass: categorize routes by type and method
    for (const [ routeKey, route ] of Object.entries(controller.routes || {}) as [ string, Route ][]) {
      const [ routeMethod, routePath ] = routeKey.split('|');

      // Skip if HTTP method doesn't match
      if (routeMethod !== requestData.httpMethod) {
        continue;
      }

      // Categorize route type
      if (routePath.includes('{') && routePath.includes('}')) {
        parameterizedMatches.push({ routeKey, route });
      } else {
        exactMatches.push({ routeKey, route });
      }
    }

    // Second pass: Try exact matches first (highest priority)
    for (const { routeKey, route } of exactMatches) {
      const [ , routePath ] = routeKey.split('|');

      if (routePath === resourceWithoutRoot) {
        this.logger.debug(`Found exact match for route: ${routeKey}`);
        return route;
      }
    }

    // Third pass: Try parameterized matches (sorted by specificity)
    // Sort parameterized routes by specificity (more literal segments = higher priority)
    const sortedParameterizedMatches = parameterizedMatches
      .map(({ routeKey, route }) => {
        const [ , routePath ] = routeKey.split('|');
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
      } catch (error) {
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
  private getRouteFunction(route: Route | null): Function {
    if (!route) {
      return this.handleNotFound.bind(this);
    }

    //@ts-ignore
    const routeFunction = this[ route.functionName ];

    return typeof routeFunction === "function" ? routeFunction : this.handleNotFound.bind(this);
  }

  /**
   * Handles the NotFound route.
   * @param _req - The request object.
   * @returns The response object with a 404 status code.
   */
  protected handleNotFound(_req: Request): APIGatewayProxyResult {
    return this.handleResponse({
      statusCode: 404,
      body: JSON.stringify({ message: "No Route Found!" }),
    });
  }

  protected errorHandler?: ControllerErrorHandler;
  protected getErrorHandler(): ControllerErrorHandler {
    if (!this.errorHandler) {
      this.errorHandler = createErrorHandler();
    }
    return this.errorHandler;
  }

  /**
   * Handles exceptions and returns a JSON response with the error message.
   * @param _req - The request object.
   * @param err - The error object.
   * @returns The response object with a 500 status code.
   */
  protected handleException(req: Request, err: Error, res: Response): APIGatewayProxyResult {
    const errorResponse = this.getErrorHandler()(err, req, res);
    return this.handleResponse(errorResponse);
  }

  protected handleResponse(res: Response | APIGatewayProxyResult): APIGatewayProxyResult {
    if (res instanceof ResponseContext) {
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
  protected buildCtx(event: APIGatewayEvent, context: Context, request: Request, response: Response): ExecutionContext {
    const actor = this.extractActorContext(event, request);

    const ctx: ExecutionContext = {
      event,
      lambdaContext: context,
      request,
      response,
      actor,
      debugInfo: {},

      // Simple actor enhancement method
      enhanceActor: (enhancement: Partial<Actor>) => {
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
  protected getControllerConfig(): IControllerConfig {
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
  protected extractActorContext(event: APIGatewayEvent, request: Request): Actor {
    const timestamp = new Date().toISOString();
    const requestId = request.requestId;

    const actor: Actor = {
      requestId,
      timestamp,
      sourceIp: event.requestContext?.identity?.sourceIp,
      userAgent: event.headers?.[ 'user-agent' ] || event.headers?.[ 'User-Agent' ],
      // Note: correlationId is set later after trace context extraction
    };

    // Cognito authentication with focused enhancements
    if (event.requestContext?.authorizer?.claims) {
      this.extractCognitoContext(event.requestContext.authorizer.claims, actor);
    }
    // API Key authentication
    else if (event.requestContext?.identity?.apiKey || request.headers?.[ 'x-api-key' ]) {
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
  protected extractCognitoContext(claims: any, actor: Actor): void {
    try {
      actor.authMethod = 'cognito';
      actor.actorType = 'user';

      // Actor ID with documented fallback strategy: cognito:username -> email -> sub
      actor.actorId = claims[ 'cognito:username' ] || claims.email || claims.sub;

      // Standard user attributes (documented Cognito user attributes)
      actor.email = claims.email;
      actor.emailVerified = claims.email_verified === 'true';
      actor.phoneNumber = claims.phone_number;
      actor.phoneVerified = claims.phone_number_verified === 'true';
      actor.name = claims.name;
      actor.locale = claims.locale;

      // Parse Cognito groups (documented as comma-separated string)
      const groups = this.parseGroups(claims[ 'cognito:groups' ]);

      // Extract custom attributes (documented pattern: custom:*)
      const customAttributes = this.extractCustomAttributes(claims);

      // Build Cognito context with only documented fields
      actor.cognito = {
        sub: claims.sub,
        username: claims[ 'cognito:username' ],
        groups: groups, // Always include groups array (empty or populated)
        customAttributes: Object.keys(customAttributes).length > 0 ? customAttributes : undefined
      };

      // Extract tenant ID from custom attributes (common multi-tenant pattern)
      actor.tenantId = customAttributes.tenantId;

      actor.rawAuthContext = claims;

    } catch (error) {
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
  protected parseGroups(groups: any): string[] {
    if (typeof groups === 'string' && groups.length > 0) {
      return groups.split(',').map(g => g.trim()).filter(g => g.length > 0);
    }
    return [];
  }

  /**
   * Extract custom attributes using documented Cognito pattern (custom:*)
   */
  protected extractCustomAttributes(claims: any): Record<string, any> {
    const customAttributes: Record<string, any> = {};

    Object.keys(claims).forEach(key => {
      if (key.startsWith('custom:')) {
        const attributeName = key.replace('custom:', '');
        customAttributes[ attributeName ] = claims[ key ];
      }
    });

    return customAttributes;
  }

  /**
 * Extract session and tenant context - focused approach
 */
  protected extractSessionAndTenantContext(event: APIGatewayEvent, request: Request, actor: Actor): void {
    // Session context
    actor.sessionId = request.headers?.[ 'x-session-id' ];

    // Tenant context - check custom attributes first, then headers
    actor.tenantId = request.headers?.[ 'x-tenant-id' ] ||
      event.requestContext?.authorizer?.claims?.[ 'custom:tenantId' ];
  }

  /**
   * Extract API Key context
   */
  protected extractApiKeyContext(event: APIGatewayEvent, request: Request, actor: Actor): void {
    actor.authMethod = 'api-key';
    actor.actorType = 'service';

    let apiKeyId: string;
    let source: 'request-context' | 'header';

    if (event.requestContext?.identity?.apiKey) {
      apiKeyId = event.requestContext.identity.apiKeyId || event.requestContext.identity.apiKey;
      source = 'request-context';
    } else {
      apiKeyId = request.headers[ 'x-api-key' ]!;
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
  protected extractIamContext(event: APIGatewayEvent, actor: Actor): void {
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
