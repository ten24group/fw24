/**
 * Actor represents the entity performing an action
 * Generic fields at top level, auth-specific fields nested
 */
export interface Actor {
  // Core identity
  actorId?: string;
  actorType?: 'user' | 'service' | 'anonymous';
  authMethod?: 'cognito' | 'iam' | 'api-key' | 'anonymous';
  
  // Request context
  requestId: string;
  timestamp: string;
  sourceIp?: string;
  userAgent?: string;
  correlationId?: string;
  
  // Generic user fields (regardless of auth method)
  email?: string;
  emailVerified?: boolean;
  phoneNumber?: string;
  phoneVerified?: boolean;
  firstName?: string;
  lastName?: string;
  name?: string;
  locale?: string;
  
  // Auth-specific data nested
  cognito?: {
    sub?: string;
    username?: string;
    groups?: string[];
    authTime?: number;
    identities?: any[];      // For social login analytics
    customAttributes?: Record<string, any>;
    [key: string]: any;      // For any other cognito-specific fields
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
  
  // Session/tenant for analytics
  sessionId?: string;
  tenantId?: string;
  
  // API Gateway context
  apiStage?: string;
  apiId?: string;
  
  // Raw context for extensibility
  rawAuthContext?: any;
  
  // Allow any additional fields
  [key: string]: any;
}
