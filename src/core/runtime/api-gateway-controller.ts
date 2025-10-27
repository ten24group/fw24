import type { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import type { Request, Response, Route } from "../../interfaces";
import { Controller, IControllerConfig } from "../../decorators";
import { Get, RouteMethods } from "../../decorators/method";
import { DefaultValidator, HttpRequestValidations, IValidator, InputValidationRule } from "../../validation";
import { isHttpRequestValidationRule, isInputValidationRule } from "../../validation/utils";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { RequestContext } from "./request-context";
import { ResponseContext } from "./response-context";
import { ResponseConfig, mergeResponseConfig } from "./response-config";
import { ValidationFailedError, InvalidHttpRequestValidationRuleError, createErrorHandler } from "../../errors/";
import { ExecutionContext, Actor } from '../types/execution-context';

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
   * @param event - The event object from the API Gateway.
   * @param context - The context object from the API Gateway.
   * @returns The API Gateway response object.
   */
  async LambdaHandler(event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> {
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
          throw new ValidationFailedError(validationResult.errors);
        }
      }

      // call the route function
      const routeFunction = this.getRouteFunction(route);
      let controllerResponse: any = routeFunction.call(this, request, response, ctx);
      if (controllerResponse instanceof Promise) {
        controllerResponse = await controllerResponse;
      }

      // Execute after middleware
      await this.executeMiddlewarePipeline('after', request, response, ctx);

      // If the controller returned anything (ResponseContext or raw API result), emit that
      if (controllerResponse != null) {
        return this.handleResponse(controllerResponse);
      }

    } catch (err) {

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
  private findMatchingRoute(requestData: Request): Route | null {
    let controller: any = this;
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
      if (requestData.resource.startsWith(controllerBasePath)) {
        resourceWithoutRoot = requestData.resource.substring(controllerBasePath.length) || '/';
      }
    }

    // this.logger.info('controllerBasePath: ', controllerBasePath);
    // this.logger.info('resourceWithoutRoot: ', resourceWithoutRoot);

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
        this.logger.info(`Found exact match for route: ${routeKey}`);
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
          this.logger.info(`Found parameterized match for route: ${routeKey}`, {
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
   * Extracts actor context from the request
   * Override this method for custom actor extraction logic
   *
   * @param event - The event object from the API Gateway.
   * @param request - The request object from the API Gateway.
   * @returns The actor context.
   * ```
   */
  protected extractActorContext(event: APIGatewayEvent, request: Request): Actor {
    const timestamp = new Date().toISOString();
    const requestId = request.requestId;
    
    const actor: Actor = {
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
  private extractCognitoContext(claims: any, actor: Actor): void {
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
  private parseGroups(groups: any): string[] {
    if (typeof groups === 'string' && groups.length > 0) {
      return groups.split(',').map(g => g.trim()).filter(g => g.length > 0);
    }
    return [];
  }

  /**
   * Extract custom attributes using documented Cognito pattern (custom:*)
   */
  private extractCustomAttributes(claims: any): Record<string, any> {
    const customAttributes: Record<string, any> = {};
    
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
  private extractSessionAndTenantContext(event: APIGatewayEvent, request: Request, actor: Actor): void {
    // Session context
    actor.sessionId = request.headers?.['x-session-id'];
    
    // Tenant context - check custom attributes first, then headers
    actor.tenantId = request.headers?.['x-tenant-id'] || 
                    event.requestContext?.authorizer?.claims?.['custom:tenantId'];
  }

  /**
   * Extract API Key context
   */
  private extractApiKeyContext(event: APIGatewayEvent, request: Request, actor: Actor): void {
    actor.authMethod = 'api-key';
    actor.actorType = 'service';
    
    let apiKeyId: string;
    let source: 'request-context' | 'header';
    
    if (event.requestContext?.identity?.apiKey) {
      apiKeyId = event.requestContext.identity.apiKeyId || event.requestContext.identity.apiKey;
      source = 'request-context';
    } else {
      apiKeyId = request.headers['x-api-key']!;
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
  private extractIamContext(event: APIGatewayEvent, actor: Actor): void {
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
