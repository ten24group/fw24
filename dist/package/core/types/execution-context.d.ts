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
    /**
     * True when `clientSuppliedActorId`/email/etc. came from a client-supplied `x-actor`
     * header rather than a server-verified source (Cognito JWT claims, IAM, API key). Set
     * only for SigV4/IAM-authenticated or anonymous requests, to fill the gap where AWS
     * identity federation (e.g. Cognito Identity Pool) never exposes the calling
     * end-user's own identity server-side.
     */
    clientSuppliedActor?: boolean;
    /**
     * The end-user id claimed by an unverified `x-actor` header (see `clientSuppliedActor`).
     * Deliberately a SEPARATE field from `actorId` — `actorId` stays whatever the
     * auth-verified source produced (the IAM role's ARN, or `'anonymous'`), which is what
     * `base-service.ts`'s `createdBy`/`updatedBy`/`deletedBy` audit stamping and any other
     * authorization-adjacent code trusts. `clientSuppliedActorId` is observability-only
     * (log stamping prefers it over `actorId` when present, since it's the more useful
     * "who" for triage) and must NEVER be used for authorization decisions or persisted
     * audit trails — a client can put anything here.
     */
    clientSuppliedActorId?: string;
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
