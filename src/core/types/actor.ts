/**
 * Actor represents the entity performing an action
 * Focused on practical identity and authorization context
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
  
  // Generic user fields (commonly available)
  email?: string;
  emailVerified?: boolean;
  phoneNumber?: string;
  phoneVerified?: boolean;
  name?: string;
  locale?: string;
  
  // Auth-specific data nested
  cognito?: {
    sub?: string;                           // Subject - unique user identifier
    username?: string;                      // cognito:username claim
    groups?: string[];                      // cognito:groups claim (parsed)
    customAttributes?: Record<string, any>; // custom:* claims
    [key: string]: any;                     // For any other cognito-specific fields
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
  
  // Session/tenant for multi-tenancy
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
