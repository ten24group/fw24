import type { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import type { Request, Response, Route } from "../../interfaces";
import { IControllerConfig } from "../../decorators";
import { RouteMethods } from "../../decorators/method";
import { HttpRequestValidations, InputValidationRule } from "../../validation";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { ResponseConfig } from "./response-config";
import { createErrorHandler } from "../../errors/";
import { ExecutionContext, Actor } from '../types/execution-context';
import { AuditContext, RequestAuditContext } from '../../audit/interfaces';
export type ControllerErrorHandler = ReturnType<typeof createErrorHandler>;
export interface APIControllerMiddleware {
    before?: (request: Request, response: Response, ctx?: ExecutionContext) => Promise<void>;
    after?: (request: Request, response: Response, ctx?: ExecutionContext) => Promise<void>;
    onError?: (error: Error, request: Request, response: Response, ctx?: ExecutionContext) => Promise<void>;
}
export declare const useMiddleware: (middleware: APIControllerMiddleware) => void;
export declare const clearMiddlewares: () => void;
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
export declare function createApiHandler(options: {
    name: string;
    path?: string;
    method?: RouteMethods;
} & IControllerConfig, handler: (event: APIGatewayEvent, context: Context) => Promise<APIGatewayProxyResult>): {
    handler: (event: APIGatewayEvent, context: Context) => Promise<APIGatewayProxyResult>;
    descriptor: {
        new (): {
            inlineHandler(): Promise<void>;
        };
    };
};
export interface APIControllerConfig {
    responseConfig?: Partial<ResponseConfig>;
}
export declare abstract class APIController extends AbstractLambdaHandler {
    protected middlewares: Set<APIControllerMiddleware>;
    protected responseConfig: ResponseConfig;
    constructor(config?: APIControllerConfig);
    /**
     * can be used to run some logic just before the request is processed like creating clients, di-injection ans so on.
     * @param _event - The event object from the API Gateway.
     * @param _context - The context object from the API Gateway.
     * @returns A promise that resolves when the controller is initialized.
    */
    protected initialize(_event: APIGatewayEvent, _context: Context): Promise<void>;
    protected getOverriddenHttpRequestValidationErrorMessages(): Promise<Map<string, string>>;
    protected useMiddleware(middleware: APIControllerMiddleware): void;
    protected getMiddlewares(): APIControllerMiddleware[];
    private executeMiddlewarePipeline;
    validate(requestContext: Request, validations: InputValidationRule | HttpRequestValidations, _ctx?: ExecutionContext): Promise<import("../../validation").ValidatorResult>;
    makeRequestContext(event: APIGatewayEvent, context: Context): Promise<Request>;
    makeResponseContext(requestContext: Request): Promise<Response>;
    /**
     * Lambda handler for the controller.
     * Handles incoming API Gateway events.
     * @param event - The event object from the API Gateway.
     * @param context - The context object from the API Gateway.
     * @returns The API Gateway response object.
     */
    LambdaHandler(event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult>;
    /**
     * Finds the route that matches the HTTP method and resource.
     * @param requestData - The request data object.
     * @returns The matching route or null if not found.
     */
    private findMatchingRoute;
    /**
     * Retrieves the function associated with the route.
     * @param route - The matched route.
     * @returns The function associated with the route.
     */
    private getRouteFunction;
    /**
     * Handles the NotFound route.
     * @param _req - The request object.
     * @returns The response object with a 404 status code.
     */
    protected handleNotFound(_req: Request): APIGatewayProxyResult;
    protected errorHandler?: ControllerErrorHandler;
    protected getErrorHandler(): ControllerErrorHandler;
    /**
     * Handles exceptions and returns a JSON response with the error message.
     * @param _req - The request object.
     * @param err - The error object.
     * @returns The response object with a 500 status code.
     */
    protected handleException(req: Request, err: Error, res: Response): APIGatewayProxyResult;
    protected handleResponse(res: Response | APIGatewayProxyResult): APIGatewayProxyResult;
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
    protected buildCtx(event: APIGatewayEvent, context: Context, request: Request, response: Response): ExecutionContext;
    /**
     * Creates audit context for the request following the existing buildCtx pattern
     * @param ctx - The execution context
     * @param route - The matched route (optional, for method-level audit config)
     * @returns AuditContext or null if audit is disabled
     */
    protected makeAuditContext(ctx: ExecutionContext, route?: Route | null): AuditContext | null;
    /**
     * Merges controller-level and method-level audit configurations
     * Method-level config takes precedence over controller-level config
     * @param controllerAudit - Controller-level audit config
     * @param methodAudit - Method-level audit config
     * @returns Merged audit configuration
     */
    private mergeAuditConfigs;
    /**
     * Captures audit log for request start
     */
    protected captureStart(auditContext: AuditContext, requestContext: RequestAuditContext): Promise<void>;
    /**
     * Captures audit log for request end (success or error)
     */
    protected captureEnd(auditContext: AuditContext, response: Response, error: Error | null): Promise<void>;
    /**
     * Builds request context for audit logging
     */
    private buildRequestContext;
    /**
     * Selectively includes fields from an object based on field list
     * If no fields specified, returns the entire object
     */
    private selectivelyIncludeFields;
    /**
     * Selectively includes fields from response body (handles JSON string bodies)
     * If no fields specified, returns the entire body
     */
    private selectivelyIncludeResponseBody;
    /**
     * Builds response context for audit logging
     */
    private buildResponseContext;
    /**
     * Gets the controller configuration
     */
    protected getControllerConfig(): IControllerConfig;
    /**
     * Extracts actor context from the request
     * Override this method for custom actor extraction logic
     *
     * @param event - The event object from the API Gateway.
     * @param request - The request object from the API Gateway.
     * @returns The actor context.
     * ```
     */
    protected extractActorContext(event: APIGatewayEvent, request: Request): Actor;
    /**
     * Extract Cognito actor context based on documented AWS Cognito JWT claims
     * Only extracts what's officially documented and available in API Gateway context
     *
     * @param claims - Cognito JWT claims from the authorizer
     * @param actor - Actor object to populate
     */
    protected extractCognitoContext(claims: any, actor: Actor): void;
    /**
     * Parse Cognito groups from comma-separated string (documented Cognito format)
     */
    protected parseGroups(groups: any): string[];
    /**
     * Extract custom attributes using documented Cognito pattern (custom:*)
     */
    protected extractCustomAttributes(claims: any): Record<string, any>;
    /**
   * Extract session and tenant context - focused approach
   */
    protected extractSessionAndTenantContext(event: APIGatewayEvent, request: Request, actor: Actor): void;
    /**
     * Extract API Key context
     */
    protected extractApiKeyContext(event: APIGatewayEvent, request: Request, actor: Actor): void;
    /**
     * Extract IAM context
     */
    protected extractIamContext(event: APIGatewayEvent, actor: Actor): void;
}
