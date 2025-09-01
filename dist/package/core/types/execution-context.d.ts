import { APIGatewayEvent, Context } from 'aws-lambda';
import { Request, Response } from '../../interfaces';
export interface ExecutionContext<TObservability = unknown, TDebugInfo = unknown> {
    event: APIGatewayEvent;
    lambdaContext: Context;
    request: Request;
    response: Response;
    actor?: Actor;
    observability?: TObservability;
    debugInfo?: TDebugInfo;
    enhanceActor?: (enhancement: Partial<Actor>) => void;
}
/**
 * Actor represents the entity performing an action
 * Focused on practical identity and authorization context
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
