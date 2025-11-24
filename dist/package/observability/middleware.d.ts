import { APIControllerMiddleware } from '../core/runtime/api-gateway-controller';
/**
 * API Gateway middleware for automatic observability instrumentation
 *
 * @example
 * ```typescript
 * export class MyController extends APIController {
 *   constructor() {
 *     super();
 *     this.useMiddleware(apiGatewayObservabilityMiddleware);
 *   }
 * }
 * ```
 */
export declare const apiGatewayObservabilityMiddleware: APIControllerMiddleware;
/**
 * SQS middleware for automatic observability instrumentation
 * Note: This is applied automatically in the SQS controller
 */
export declare const sqsObservabilityMiddleware: {};
