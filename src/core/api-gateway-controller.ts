import { APIGatewayEvent, Context, APIGatewayProxyResult } from "aws-lambda";
import { Route } from "../interfaces/route";
import { Request } from "../interfaces/request";
import { Response } from "../interfaces/response";
import { RequestContext } from "./request-context";
import { ResponseContext } from "./response-context";

/**
 * Base controller class for handling API Gateway events.
 */
abstract class APIGatewayController {

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this)
  }

  abstract initialize(event: APIGatewayEvent, context: Context): Promise<void>;

  /**
   * Lambda handler for the controller.
   * Handles incoming API Gateway events.
   * @param event - The event object from the API Gateway.
   * @param context - The context object from the API Gateway.
   * @returns The API Gateway response object.
   */
  async LambdaHandler(event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> {
    console.log("Received event:", JSON.stringify(event, null, 2));
    // Create request and response objects
    const requestContext: Request = new RequestContext(event, context);
    const responseContext: Response = new ResponseContext();

    // hook for the application to initialize it's state, Dependencies, config etc
    await this.initialize(event, context);

    try {
      // Find the matching route for the received request
      const route = this.findMatchingRoute(requestContext);
      // const validation = this.findMatchingValidation(requestContext);
      // TODO: Add Validation Check
      // requestContext: any = validation.call(this, requestContext, responseContext);

      const routeFunction = this.getRouteFunction(route);
      // Execute the associated route function
      let controllerResponse: any = routeFunction.call(this, requestContext, responseContext);

      // Resolve promises, if any
      if (controllerResponse instanceof Promise) {
        controllerResponse = await controllerResponse;
      }

      // If the response is an instance of ResponseContext, use its status code and body
      if (controllerResponse instanceof ResponseContext) {
        console.log("Response:", JSON.stringify(controllerResponse, null, 2));
        return this.handleResponse({
          statusCode: controllerResponse.statusCode || 500,
          body: controllerResponse.body,
        });
      }
    } catch (err) {
      // If an error occurs, log it and handle with the Exception method
      console.error(err);
      return this.handleException(requestContext, err as Error);
    }

    console.log("Default Response:", JSON.stringify(responseContext, null, 2));
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
    console.log('resourceWithoutRoot: ', resourceWithoutRoot);
    console.log(`${requestData.httpMethod}|${resourceWithoutRoot}`,controller.routes);
    return controller.routes[`${requestData.httpMethod}|${resourceWithoutRoot}`] || null;
  }

  // Allow dynamic method assignment
  [key: string]: Function;

  /**
   * Retrieves the function associated with the route.
   * @param route - The matched route.
   * @returns The function associated with the route.
   */
  private getRouteFunction(route: Route | null): Function {
    if (!route) {
      return this.handleNotFound.bind(this);
    }
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
      body: JSON.stringify({ error: "Not Found" }),
    });
  }

  /**
   * Handles exceptions and returns a JSON response with the error message.
   * @param _req - The request object.
   * @param err - The error object.
   * @returns The response object with a 500 status code.
   */
  private handleException(_req: Request, err: Error): APIGatewayProxyResult {
    return this.handleResponse({
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
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
  static CreateHandler( constructorFunc: { new (): APIGatewayController} ) {
    const controller = new constructorFunc();
    return controller.LambdaHandler;
  }
}

export { APIGatewayController };
