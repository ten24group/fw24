import { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { Request } from "../interfaces/request";
import { Response } from "../interfaces/response";
import { Route } from "../interfaces/route";
import { createLogger } from "../logging";
import { DefaultValidator, HttpRequestValidations, IValidator, InputValidationRule } from "../validation";
import { RequestContext } from "./request-context";
import { ResponseContext } from "./response-context";
import { isHttpRequestValidationRule, isInputValidationRule } from "../validation/utils";
import { getCircularReplacer } from "../utils";
import { Get, RouteMethods } from "../decorators/method";
import { Controller, IControllerConfig } from "../decorators";

import AWSXRay from 'aws-xray-sdk-core';

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

    const {name, path = '', method = Get, ...controllerConfig} = options;

    @Controller(name, controllerConfig)
    class ControllerDescriptor{
        @method(path)
        async inlineHandler(){
            // placeholder function
        }
    }

    Object.defineProperty(handler, 'name', { value: 'handler' });
    
    return { 
        handler, 
        descriptor: ControllerDescriptor
    };
}

/**
 * Base controller class for handling API Gateway events.
 */
abstract class APIController {
  readonly logger = createLogger(APIController.name);
  protected validator: IValidator = DefaultValidator;

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this)
  }

  abstract initialize(event: APIGatewayEvent, context: Context): Promise<void>;

  protected async getOverriddenHttpRequestValidationErrorMessages() {
      return Promise.resolve( new Map<string, string>());
  }

  async validate( requestContext: Request, validations: InputValidationRule | HttpRequestValidations ){

    return await AWSXRay.captureAsyncFunc(`${APIController.name}::LambdaHandler::process`, async (subsegment) => {
      try {

        let validationRules: HttpRequestValidations = validations;

        if(isInputValidationRule(validations)){
          if( ['GET', 'DELETE'].includes( requestContext.httpMethod.toUpperCase()) ){

              validationRules = { query: validations }

          } else if( ['POST', 'PUT', 'PATCH'].includes( requestContext.httpMethod.toUpperCase()) ){

            validationRules = { body: validations }
          }
        }

        subsegment?.addMetadata('validationRules', validationRules);
        
        if(!isHttpRequestValidationRule(validationRules)){
          throw (new Error("Invalid http-request validation rule"));
        }

        const result = await this.validator.validateHttpRequest({
          requestContext, 
          validations: validationRules, 
          collectErrors: true,
          verboseErrors: requestContext.debugMode,
          overriddenErrorMessages: await this.getOverriddenHttpRequestValidationErrorMessages()
        });

        subsegment?.addMetadata('validationResult', result);

        return result;

      } catch (error: any) {
        subsegment?.addError(error);
        this.logger.error("Error processing event:", error);
        throw error;
      } finally {
        subsegment?.close();
      }
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

    // Create request and response objects
    const requestContext: Request = new RequestContext(event, context);
    const responseContext: Response = new ResponseContext();

    await AWSXRay.captureAsyncFunc(`${APIController.name}::LambdaHandler::initialize`, async (subsegment) => {
      try {

        // hook for the application to initialize it's state, Dependencies, config etc
        await this.initialize(event, context);

      } catch (error: any) {
        subsegment?.addError(error);
        this.logger.error("Error processing event:", error);
        throw error;
      } finally {
        subsegment?.close();
      }
    });

    try {
      // Find the matching route for the received request
      const route = this.findMatchingRoute(requestContext);

      if(route?.validations){
        this.logger.info("Validation rules found for route:", route);
        
        const validationResult = await this.validate(requestContext, route.validations);
        
        if(!validationResult.pass){
          return this.handleResponse({
            statusCode: 400,
            body: JSON.stringify({
              message: 'Validation failed!!!',
              errors: validationResult.errors 
            }),
          });
        }
        
      } else {
        this.logger.info("No validation rules found for route:", route);
      }

      const routeFunction = this.getRouteFunction(route);
      
      const controllerResponse = await AWSXRay.captureAsyncFunc(`${APIController.name}::LambdaHandler::call`, async (subsegment) => {
        
        try {
          // Execute the associated route function
          const result = await routeFunction.call(this, requestContext, responseContext);
          
          return result;
        } catch (error: any) {
          subsegment?.addError(error);
          this.logger.error("Error processing event:", error);
          throw error;
        } finally {
          subsegment?.close();
        }
      });

    
      // If the response is an instance of ResponseContext, use its status code and body
      if (controllerResponse instanceof ResponseContext) {
        this.logger.debug("LambdaHandler Response:", JSON.stringify(controllerResponse, null, 2));
        return this.handleResponse({
          statusCode: controllerResponse.statusCode || 500,
          body: controllerResponse.body,
        });
      }

    } catch (err) {
      // If an error occurs, log it and handle with the Exception method
      this.logger.error('LambdaHandler error: ', err);
      return this.handleException(requestContext, err as Error);
    }

    this.logger.debug("LambdaHandler Default Response:", JSON.stringify(responseContext, null, 2));
    // Return the finalized API Gateway response
    return this.handleResponse({
      statusCode: responseContext.statusCode,
      body: requestContext.body,
    });
  }

  /**
   * Finds the route that matches the HTTP method and resource.
   * @param requestData - The request data object.
   * @returns The matching route or null if not found.
   */
  private findMatchingRoute(requestData: Request): Route | null {
    let controller: any = this;
    var resourceWithoutRoot = '/' + requestData.resource.split('/').slice(2).join('/');
    this.logger.debug('resourceWithoutRoot: ', resourceWithoutRoot);
    this.logger.debug(`${requestData.httpMethod}|${resourceWithoutRoot}`,controller.routes);
    return controller.routes[`${requestData.httpMethod}|${resourceWithoutRoot}`] || null;
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
    const routeFunction = this[route.functionName];

    return typeof routeFunction === "function" ? routeFunction : this.handleNotFound.bind(this);
  }

  /**
   * Handles the NotFound route.
   * @param _req - The request object.
   * @returns The response object with a 404 status code.
   */
  private handleNotFound(_req: Request): APIGatewayProxyResult {
    return this.handleResponse({
      statusCode: 404,
      body: JSON.stringify({ message: "Not Found" }),
    });
  }

  /**
   * Handles exceptions and returns a JSON response with the error message.
   * @param _req - The request object.
   * @param err - The error object.
   * @returns The response object with a 500 status code.
   */
  private handleException(req: Request, err: Error): APIGatewayProxyResult {
    
    const result: any = {
      message: err.message,
    }

    if(req.debugMode){
      result.req = req;
      result.errors = [err];
    }
    
    return this.handleResponse({
      statusCode: 500,
      body: JSON.stringify(result, getCircularReplacer()),
    });
  }

  private handleResponse(res: APIGatewayProxyResult): APIGatewayProxyResult {
    res.headers = res.headers || {};

    /**
     * 
     * From : https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
     * 
     * To enable CORS for the Lambda proxy integration, 
     * you must add Access-Control-Allow-Origin:domain-name to the output headers. 
     * domain-name can be * for any domain name.
     * 
     */
    
    // TODO: control the header using some config
    res.headers["Access-Control-Allow-Origin"] = res.headers["Access-Control-Allow-Origin"] ||  "*";

    return res;
  }

  /**
   * Creates a new instance of the controller and returns its LambdaHandler method.
   * @returns The LambdaHandler method of the controller.
   */
  static CreateHandler( constructorFunc: { new (): APIController} ) {
    const controller = new constructorFunc();
    return controller.LambdaHandler;
  }
}

export { APIController };
