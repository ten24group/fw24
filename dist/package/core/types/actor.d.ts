/**
 * Actor represents the entity (user, system, service) performing an action
 * Used throughout the framework for authorization, audit, and tracking
 */
export interface Actor {
    actorId?: string;
    actorType?: 'user' | 'system' | 'service' | 'anonymous';
    tenantId?: string;
    requestId: string;
    timestamp: string;
    sourceIp?: string;
    userAgent?: string;
    authMethod?: 'cognito' | 'api-key' | 'iam' | 'system';
    cognitoSub?: string;
    cognitoUsername?: string;
    cognitoGroups?: string[];
    apiKeyId?: string;
    iamRole?: string;
    iamUserId?: string;
    sessionId?: string;
    correlationId?: string;
    rawAuthContext?: any;
    [key: string]: any;
}
