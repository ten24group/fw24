import type { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { IControllerConfig } from "../../decorators";
import { RouteMethods } from "../../decorators/method";
import { createErrorHandler } from "../../errors/";
import type { Request, Response, Route } from "../../interfaces";
import { SpanObserver } from '../../observability';
import { ControllerObservabilityConfig } from '../../observability/controller-config';
import { HttpRequestValidations, InputValidationRule } from "../../validation";
import { Actor, ExecutionContext } from '../types/execution-context';
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { ResponseConfig } from "./response-config";
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
     *
     * All handler execution is wrapped in execution context, making
     * getCurrentExecutionContext() available throughout the request lifecycle.
     *
     * @param event - The event object from the API Gateway.
     * @param context - The context object from the API Gateway.
     * @returns The API Gateway response object.
     */
    LambdaHandler(event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult>;
    /**
     * Gets merged observability config from controller and method level
     */
    protected getObservabilityConfig(route?: Route | null): ControllerObservabilityConfig | undefined;
    /**
     * Build automatic tags for HTTP requests.
     * These tags enable powerful filtering in observability UIs.
     */
    protected buildAutomaticTags(request: Request, actor: Actor | undefined, event: APIGatewayEvent): Record<string, string>;
    /**
     * Build span attributes based on observability config.
     * Always includes basic HTTP info. Request body/headers/query are only
     * included if explicitly configured via `includes`.
     */
    protected buildSpanAttributes(event: APIGatewayEvent, request: Request, config?: ControllerObservabilityConfig): Record<string, unknown>;
    /**
     * Build response attributes based on observability config.
     * Only captures response body/headers if explicitly configured via `includes`.
     */
    protected buildResponseAttributes(response: Response, config?: ControllerObservabilityConfig): Record<string, unknown> | undefined;
    /**
     * Tag the span with HTTP status code, status code class, response size,
     * and error category (for 4xx/5xx responses).
     */
    protected tagResponseMetrics(span: SpanObserver, response: Response): void;
    /**
     * Classify HTTP status code into a class string for DynamoDB-safe filtering.
     */
    protected getStatusCodeClass(statusCode: number): string;
    /**
     * Classify an error into a broad category for filtering and triage.
     * Categories: auth, validation, infrastructure, server, application.
     */
    protected categorizeError(statusCode: number, error?: Error): string;
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
     * Gets the controller configuration
     */
    protected getControllerConfig(): IControllerConfig;
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
    /**
     * Fills in the calling end-user's identity from an optional, client-supplied
     * `x-actor` header, for auth methods that never expose it server-side.
     *
     * SigV4-signed requests (e.g. via a Cognito Identity Pool) authenticate as an
     * assumed IAM role — `extractIamContext` only ever sees that role's ARN, which is
     * typically shared by every user of an app, not the real end-user. The client
     * still holds the actual Cognito ID token (that's how it obtained AWS credentials
     * in the first place), so it can send a small decoded summary of it here.
     *
     * SECURITY: this is NEVER server-verified — it's whatever JSON the caller sent, so
     * it's only merged for the IAM/anonymous branches (never overrides a Cognito-JWT-
     * authorizer-derived actor). It deliberately does NOT overwrite `actor.actorId`
     * (which stays the auth-verified IAM ARN / 'anonymous' — the value
     * `base-service.ts`'s `createdBy`/`updatedBy`/`deletedBy`/`tenantId` audit stamping
     * trusts); instead it's exposed only under `actor.clientSuppliedActorId` /
     * `actor.clientSuppliedActor = true`, which log stamping (`src/logging/index.ts`)
     * prefers for observability. It must never be used for authorization decisions or
     * persisted audit fields — observability only. (Before this existed, IAM/anonymous
     * requests could already forge `actor.tenantId` via the pre-existing `x-tenant-id`
     * header, for every auth method, Cognito included — that's a separate, pre-existing
     * exposure this doesn't change either way.)
     *
     * Reads the raw event headers (case-insensitive key match) rather than
     * `request.headers`, which lowercases header VALUES too — that would corrupt the
     * JSON payload (mixed-case ids/emails) this header needs to carry intact.
     */
    protected mergeClientSuppliedActor(event: APIGatewayEvent, actor: Actor): void;
}
