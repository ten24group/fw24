/**
 * Actor represents the entity performing an action
 * Generic fields at top level, auth-specific fields nested
 */
export interface Actor {
    actorId?: string;
    actorType?: 'user' | 'service' | 'anonymous';
    authMethod?: 'cognito' | 'iam' | 'api-key' | 'anonymous';
    requestId: string;
    timestamp: string;
    sourceIp?: string;
    userAgent?: string;
    correlationId?: string;
    email?: string;
    emailVerified?: boolean;
    phoneNumber?: string;
    phoneVerified?: boolean;
    firstName?: string;
    lastName?: string;
    name?: string;
    locale?: string;
    cognito?: {
        sub?: string;
        username?: string;
        groups?: string[];
        authTime?: number;
        identities?: any[];
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
