/**
 * Actor represents the entity (user, system, service) performing an action
 * Used throughout the framework for authorization, audit, and tracking
 */
export interface Actor {
  // Essential identifiers
  actorId?: string;
  actorType?: 'user' | 'system' | 'service' | 'anonymous';
  tenantId?: string;
  
  // Request context
  requestId: string;
  timestamp: string;
  sourceIp?: string;
  userAgent?: string;
  
  // Authentication details
  authMethod?: 'cognito' | 'api-key' | 'iam' | 'system';
  
  // Cognito-specific
  cognitoSub?: string;
  cognitoUsername?: string;
  cognitoGroups?: string[];
  
  // API Key specific
  apiKeyId?: string;
  
  // IAM specific
  iamRole?: string;
  iamUserId?: string;
  
  // Session tracking
  sessionId?: string;
  correlationId?: string;
  
  // Raw authentication context (for extensibility)
  rawAuthContext?: any;
  
  // Custom fields (developer extensible)
  [key: string]: any;
}
