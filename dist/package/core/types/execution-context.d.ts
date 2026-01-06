import { APIGatewayEvent, Context } from 'aws-lambda';
import { Request, Response } from '../../interfaces';
import type { ExecutionContextData } from '../runtime/execution-context';
/**
 * Handler execution context for API Gateway handlers.
 *
 * Contains handler-specific data (request, response) plus the execution context.
 * The execution context is also available via getCurrentExecutionContext().
 */
export interface ExecutionContext<TDebugInfo = unknown> {
    readonly event: APIGatewayEvent;
    readonly lambdaContext: Context;
    readonly request: Request;
    readonly response: Response;
    /** Current actor extracted from request context */
    actor?: Actor;
    /**
     * Execution context - the framework context for cross-cutting concerns.
     * Same object is available via getCurrentExecutionContext().
     */
    executionContext?: ExecutionContextData;
    /** Debug info (for development) */
    debugInfo?: TDebugInfo;
    /** Simple actor enhancement method */
    enhanceActor?: (enhancement: Partial<Actor>) => void;
}
/**
 * Actor represents the entity performing an action.
 * Focused on practical identity and authorization context.
 */
export interface Actor {
    actorId?: string;
    actorType?: 'user' | 'service' | 'anonymous';
    authMethod?: 'cognito' | 'iam' | 'api-key' | 'anonymous' | 'system';
    requestId: string;
    timestamp: string;
    sourceIp?: string;
    userAgent?: string;
    correlationId?: string;
    /**
     * Timestamp (milliseconds since epoch) when this actor was set on the entity.
     * Used to detect stale actor data in audit logs.
     * Set automatically by the framework during entity operations.
     */
    actorTimestamp?: number;
    email?: string;
    emailVerified?: boolean;
    phoneNumber?: string;
    phoneVerified?: boolean;
    name?: string;
    locale?: string;
    cognito?: {
        sub?: string;
        username?: string;
        groups?: string[];
        customAttributes?: Record<string, any>;
        [key: string]: any;
    };
    apiKey?: {
        id?: string;
        source?: 'request-context' | 'header';
    };
    iam?: {
        userArn?: string;
        userId?: string;
        accountId?: string;
        caller?: string;
    };
    sessionId?: string;
    tenantId?: string;
    apiStage?: string;
    apiId?: string;
    rawAuthContext?: any;
    [key: string]: any;
}
