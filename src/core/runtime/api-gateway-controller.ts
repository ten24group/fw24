import type { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import type { Request, Response, Route } from "../../interfaces";
import { Controller, IControllerConfig } from "../../decorators";
import { Get, RouteMethods } from "../../decorators/method";
import { DefaultValidator, HttpRequestValidations, IValidator, InputValidationRule } from "../../validation";
import { isHttpRequestValidationRule, isInputValidationRule } from "../../validation/utils";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { RequestContext } from "./request-context";
import { ResponseContext } from "./response-context";
import { ValidationFailedError, InvalidHttpRequestValidationRuleError, createErrorHandler } from "../../errors/";
import { ResponseConfig, mergeResponseConfig } from './response-config';

export type ControllerErrorHandler = ReturnType<typeof createErrorHandler>;

// New interfaces for middleware and error handling
export interface Middleware {
  before?: (request: Request, response: Response) => Promise<void>;
  after?: (request: Request, response: Response) => Promise<void>;
  onError?: (error: Error, request: Request, response: Response) => Promise<void>;
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

abstract class APIController extends AbstractLambdaHandler {
  protected validator: IValidator = DefaultValidator;
  protected middlewares: Middleware[] = [];
  protected responseConfig: ResponseConfig;

  constructor(config: APIControllerConfig = {}) {
    super();
    this.responseConfig = mergeResponseConfig(config.responseConfig);
  }

  abstract initialize(event: APIGatewayEvent, context: Context): Promise<void>;

  protected async getOverriddenHttpRequestValidationErrorMessages() {
    return Promise.resolve(new Map<string, string>());
  }

  // Add middleware registration method
  protected useMiddleware(middleware: Middleware) {
    this.middlewares.push(middleware);
  }

  // Execute middleware pipeline
  private async executeMiddlewarePipeline(
    phase: 'before' | 'after' | 'onError',
    request: Request,
    response: Response,
    error?: Error
  ): Promise<void> {
    for (const middleware of this.middlewares) {
      if (phase === 'onError' && middleware.onError && error) {
        await middleware.onError(error, request, response);
      } else if (phase !== 'onError' && middleware[ phase ]) {
        await middleware[ phase ]!(request, response);
      }
    }
  }

  async validate(requestContext: Request, validations: InputValidationRule | HttpRequestValidations) {

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
    this.logger.debug("LambdaHandler Received event:", JSON.stringify(event, null, 2));

    const requestContext: Request = await this.makeRequestContext(event, context);
    const responseContext: Response = await this.makeResponseContext(requestContext);

    await this.initialize(event, context);

    try {
      // Execute before middleware
      await this.executeMiddlewarePipeline('before', requestContext, responseContext);

      const route = this.findMatchingRoute(requestContext);

      if (route?.validations) {
        this.logger.debug("Validation rules found for route:", route);
        const validationResult = await this.validate(requestContext, route.validations);
        if (!validationResult.pass) {
          throw new ValidationFailedError(validationResult.errors);
        }
      }

      const routeFunction = this.getRouteFunction(route);
      let controllerResponse: any = routeFunction.call(this, requestContext, responseContext);

      if (controllerResponse instanceof Promise) {
        controllerResponse = await controllerResponse;
      }

      // Execute after middleware
      await this.executeMiddlewarePipeline('after', requestContext, responseContext);

      // If the controller returned anything (ResponseContext or raw API result), emit that
      if (controllerResponse != null) {
        return this.handleResponse(controllerResponse);
      }
    } catch (err) {
      this.logger.error('LambdaHandler error: ', err);
      // Execute error middleware
      await this.executeMiddlewarePipeline('onError', requestContext, responseContext, err as Error);
      return this.handleException(requestContext, err as Error, responseContext);
    }

    // Fallback to the in-memory responseContext
    return responseContext.build();
  }

  /**
   * Finds the route that matches the HTTP method and resource.
   * @param requestData - The request data object.
   * @returns The matching route or null if not found.
   */
  private findMatchingRoute(requestData: Request): Route | null {
    let controller: any = this;
    // find the path parts after the controller name
    const parts = requestData.resource.split('/').filter(Boolean);
    const controllerIndex = parts.findIndex((part: string) => part === controller.controllerName);
    var resourceWithoutRoot = controllerIndex >= 0 && controllerIndex < parts.length - 1
      ? '/' + parts.slice(controllerIndex + 1).join('/')
      : '/';
    this.logger.debug('resourceWithoutRoot: ', resourceWithoutRoot);
    this.logger.debug(`${requestData.httpMethod}|${resourceWithoutRoot}`, controller.routes);
    return controller.routes[ `${requestData.httpMethod}|${resourceWithoutRoot}` ] || null;
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
}

export { APIController };
