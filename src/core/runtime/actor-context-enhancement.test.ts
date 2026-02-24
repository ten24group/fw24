import { APIGatewayEvent, Context, Context as LambdaContext } from 'aws-lambda';
import { APIController, APIControllerMiddleware } from './api-gateway-controller';
import { Actor } from "../types/execution-context";
import { ExecutionContext } from '../types/execution-context';
import { Request, Response } from '../../interfaces';


// Helper functions to create mock objects
function createMockAPIGatewayEvent(overrides: Partial<APIGatewayEvent> = {}): APIGatewayEvent {
  const baseEvent = {
    resource: '/test',
    path: '/test',
    httpMethod: 'GET',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      resourceId: 'test',
      resourcePath: '/test',
      httpMethod: 'GET',
      requestId: 'test-request',
      stage: 'test',
      identity: {
        cognitoIdentityPoolId: null,
        accountId: null,
        cognitoIdentityId: null,
        caller: null,
        sourceIp: '127.0.0.1',
        principalOrgId: null,
        accessKey: null,
        cognitoAuthenticationType: null,
        cognitoAuthenticationProvider: null,
        userArn: null,
        userAgent: 'test-agent',
        user: null,
        apiKey: null,
        apiKeyId: null,
        clientCert: null
      },
      protocol: 'HTTP/1.1',
      requestTime: '09/Apr/2015:12:34:56 +0000',
      requestTimeEpoch: 1428582896000,
      apiId: 'test-api'
    },
    body: null,
    isBase64Encoded: false,
  } as APIGatewayEvent;

  return {
    ...baseEvent,
    ...overrides,
    requestContext: {
      ...baseEvent.requestContext,
      ...overrides.requestContext
    }
  } as APIGatewayEvent;
}

function createMockLambdaContext(): LambdaContext {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2023/01/01/[$LATEST]abcdef',

    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };
}

describe('Actor Context Enhancement Patterns', () => {

  describe('Controller Override: extractActorContext', () => {

    it('should enhance actor context with business roles and permissions', async () => {
      // Simulate a real business controller that fetches user roles/permissions
      class BusinessController extends APIController {

        initialize(_event: APIGatewayEvent, _context: LambdaContext): Promise<void> {
          return Promise.resolve();
        }

        protected getMiddlewares(): APIControllerMiddleware[] {
          return [
            // Middleware 1: Add session context
            {
              before: async (_request, _response, _ctx) => {

              }
            }
          ];
        }

        protected extractActorContext(event: APIGatewayEvent, request: Request): Actor {
          // Start with base actor context from framework
          const baseActor = super.extractActorContext(event, request);

          // Simulate fetching business context from database/cache
          const businessContext = this.fetchUserBusinessContext(baseActor.actorId);

          // Enhance actor with business context
          return {
            ...baseActor,

            // Role-based access control
            roles: businessContext.roles,
            primaryRole: businessContext.primaryRole,

            // Permission system
            permissions: businessContext.permissions,
            permissionLevel: businessContext.permissionLevel,

            // Organizational context
            department: businessContext.department,
            costCenter: businessContext.costCenter,
            managerId: businessContext.managerId,

            // Business rules
            approvalLimits: {
              financial: businessContext.financialApprovalLimit,
              timeOff: businessContext.timeOffApprovalLimit,
              procurement: businessContext.procurementApprovalLimit
            },

            // Compliance and security
            securityClearance: businessContext.securityClearance,
            complianceFlags: businessContext.complianceFlags,

            // System context
            lastLoginAt: businessContext.lastLoginAt,
            sessionExpiresAt: businessContext.sessionExpiresAt,
            mfaVerified: businessContext.mfaVerified
          };
        }

        private fetchUserBusinessContext(actorId?: string) {
          // Simulate database/cache lookup
          const mockBusinessData = {
            'john.doe': {
              roles: ['manager', 'approver', 'budget-owner'],
              primaryRole: 'manager',
              permissions: ['user.read', 'user.write', 'budget.approve', 'report.generate'],
              permissionLevel: 'senior',
              department: 'engineering',
              costCenter: 'ENG-001',
              managerId: 'jane.smith',
              financialApprovalLimit: 50000,
              timeOffApprovalLimit: 30, // days
              procurementApprovalLimit: 25000,
              securityClearance: 'confidential',
              complianceFlags: ['sox-compliant', 'gdpr-trained'],
              lastLoginAt: '2024-01-15T08:00:00.000Z',
              sessionExpiresAt: '2024-01-15T18:00:00.000Z',
              mfaVerified: true
            },
            'api-service-billing': {
              roles: ['service', 'automated-billing'],
              primaryRole: 'service',
              permissions: ['billing.read', 'billing.write', 'invoice.generate', 'payment.process'],
              permissionLevel: 'service',
              department: 'finance',
              costCenter: 'SVC-001',
              managerId: null,
              financialApprovalLimit: 100000,
              timeOffApprovalLimit: 0,
              procurementApprovalLimit: 0,
              securityClearance: 'service',
              complianceFlags: ['pci-compliant', 'sox-compliant'],
              lastLoginAt: null,
              sessionExpiresAt: null,
              mfaVerified: true
            }
          };

          return mockBusinessData[actorId as keyof typeof mockBusinessData] || {
            roles: ['user'],
            primaryRole: 'user',
            permissions: ['user.read'],
            permissionLevel: 'basic',
            department: 'unknown',
            costCenter: 'UNK-001',
            managerId: null,
            financialApprovalLimit: 0,
            timeOffApprovalLimit: 0,
            procurementApprovalLimit: 0,
            securityClearance: 'public',
            complianceFlags: [],
            lastLoginAt: null,
            sessionExpiresAt: null,
            mfaVerified: false
          };
        }
      }

      // Test with manager actor
      const managerEvent = createMockAPIGatewayEvent({
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123',
              'cognito:username': 'john.doe',
              'cognito:groups': ['managers', 'employees']
            }
          }
        } as any
      });

      const controller = new BusinessController();
      const request = await controller.makeRequestContext(managerEvent, createMockLambdaContext());
      const enhancedActor = (controller as any).extractActorContext(managerEvent, request);

      // Verify enhanced actor context
      expect(enhancedActor).toMatchObject({
        actorId: 'john.doe',
        actorType: 'user',
        authMethod: 'cognito',

        // Business roles
        roles: ['manager', 'approver', 'budget-owner'],
        primaryRole: 'manager',

        // Permissions
        permissions: ['user.read', 'user.write', 'budget.approve', 'report.generate'],
        permissionLevel: 'senior',

        // Organizational
        department: 'engineering',
        costCenter: 'ENG-001',
        managerId: 'jane.smith',

        // Approval limits
        approvalLimits: {
          financial: 50000,
          timeOff: 30,
          procurement: 25000
        },

        // Security
        securityClearance: 'confidential',
        complianceFlags: ['sox-compliant', 'gdpr-trained'],
        mfaVerified: true
      });
    });

    it('should enhance actor context with subscription and licensing data', async () => {
      class SaaSController extends APIController {

        initialize(_event: APIGatewayEvent, _context: LambdaContext): Promise<void> {
          return Promise.resolve();
        }

        protected extractActorContext(event: APIGatewayEvent, request: Request): Actor {
          const baseActor = super.extractActorContext(event, request);
          const subscriptionData = this.fetchSubscriptionContext(baseActor.tenantId);
          const licenseData = this.fetchLicenseContext(baseActor.actorId);

          return {
            ...baseActor,

            // Subscription context
            subscription: {
              tier: subscriptionData.tier,
              status: subscriptionData.status,
              expiresAt: subscriptionData.expiresAt,
              features: subscriptionData.features,
              limits: subscriptionData.limits,
              billingCycle: subscriptionData.billingCycle
            },

            // License context
            licenses: licenseData.licenses,
            activeLicenses: licenseData.activeLicenses,
            licenseQuotas: licenseData.quotas,

            // Usage tracking
            usage: {
              apiCallsThisMonth: subscriptionData.usage.apiCalls,
              storageUsed: subscriptionData.usage.storage,
              usersActive: subscriptionData.usage.activeUsers
            },

            // Feature flags
            featureFlags: subscriptionData.featureFlags,

            // Billing context
            billing: {
              accountBalance: subscriptionData.billing.balance,
              paymentStatus: subscriptionData.billing.status,
              nextBillingDate: subscriptionData.billing.nextBillingDate
            }
          };
        }

        private fetchSubscriptionContext(tenantId?: string) {
          const mockSubscriptions = {
            'company-blog-tenant': {
              tier: 'enterprise',
              status: 'active',
              expiresAt: '2024-12-31T23:59:59.000Z',
              features: ['advanced-analytics', 'custom-branding', 'sso', 'audit-logs'],
              limits: {
                users: 1000,
                storage: 1024 * 1024 * 1024 * 100, // 100GB
                apiCallsPerMonth: 1000000
              },
              billingCycle: 'annual',
              usage: {
                apiCalls: 45000,
                storage: 1024 * 1024 * 1024 * 25, // 25GB
                activeUsers: 89
              },
              featureFlags: {
                'beta-ai-features': true,
                'advanced-reporting': true,
                'custom-integrations': true
              },
              billing: {
                balance: 0,
                status: 'paid',
                nextBillingDate: '2024-12-31T00:00:00.000Z'
              }
            },
            'startup-tenant': {
              tier: 'startup',
              status: 'active',
              expiresAt: '2024-06-30T23:59:59.000Z',
              features: ['basic-analytics', 'standard-support'],
              limits: {
                users: 50,
                storage: 1024 * 1024 * 1024 * 10, // 10GB
                apiCallsPerMonth: 100000
              },
              billingCycle: 'monthly',
              usage: {
                apiCalls: 78000,
                storage: 1024 * 1024 * 1024 * 8, // 8GB
                activeUsers: 23
              },
              featureFlags: {
                'beta-ai-features': false,
                'advanced-reporting': false,
                'custom-integrations': false
              },
              billing: {
                balance: 0,
                status: 'paid',
                nextBillingDate: '2024-02-01T00:00:00.000Z'
              }
            }
          };

          return mockSubscriptions[tenantId as keyof typeof mockSubscriptions] || {
            tier: 'free',
            status: 'active',
            expiresAt: null,
            features: ['basic'],
            limits: { users: 3, storage: 1024 * 1024 * 100, apiCallsPerMonth: 1000 },
            billingCycle: null,
            usage: { apiCalls: 0, storage: 0, activeUsers: 1 },
            featureFlags: {},
            billing: { balance: 0, status: 'free', nextBillingDate: null }
          };
        }

        private fetchLicenseContext(actorId?: string) {
          const mockLicenses = {
            'john.doe': {
              licenses: ['enterprise-admin', 'analytics-pro', 'security-manager'],
              activeLicenses: ['enterprise-admin', 'analytics-pro'],
              quotas: {
                'enterprise-admin': { assigned: 1, total: 5 },
                'analytics-pro': { assigned: 1, total: 10 },
                'security-manager': { assigned: 0, total: 3 }
              }
            }
          };

          return mockLicenses[actorId as keyof typeof mockLicenses] || {
            licenses: ['basic-user'],
            activeLicenses: ['basic-user'],
            quotas: { 'basic-user': { assigned: 1, total: 1 } }
          };
        }
      }

      const tenantEvent = createMockAPIGatewayEvent({
        requestContext: {
          ...createMockAPIGatewayEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              'cognito:username': 'john.doe',
              'custom:tenantId': 'company-blog-tenant'
            }
          }
        }
      });

      const controller = new SaaSController();
      const request = await controller.makeRequestContext(tenantEvent, createMockLambdaContext());
      const enhancedActor = (controller as any).extractActorContext(tenantEvent, request);

      expect(enhancedActor).toMatchObject({
        actorId: 'john.doe',
        tenantId: 'company-blog-tenant',

        subscription: {
          tier: 'enterprise',
          status: 'active',
          features: ['advanced-analytics', 'custom-branding', 'sso', 'audit-logs'],
          limits: {
            users: 1000,
            storage: 107374182400, // 100GB
            apiCallsPerMonth: 1000000
          }
        },

        licenses: ['enterprise-admin', 'analytics-pro', 'security-manager'],
        activeLicenses: ['enterprise-admin', 'analytics-pro'],

        usage: {
          apiCallsThisMonth: 45000,
          storageUsed: 26843545600, // 25GB
          usersActive: 89
        },

        featureFlags: {
          'beta-ai-features': true,
          'advanced-reporting': true,
          'custom-integrations': true
        }
      });
    });
  });

  describe('Middleware Enhancement: Actor Context', () => {

    it('should enhance actor context via before middleware', async () => {
      // Business context middleware that enhances actor using framework API
      const businessContextMiddleware: APIControllerMiddleware = {
        before: async (_request: Request, _response: Response, ctx?: ExecutionContext) => {
          if (!ctx?.actor || !ctx.enhanceActor) return;

          // Simulate fetching additional business context
          const riskProfile = await fetchRiskProfile(ctx.actor.actorId);
          const preferences = await fetchUserPreferences(ctx.actor.actorId);
          const deviceInfo = await fetchDeviceContext(_request);

          // Use simple framework API to enhance actor context
          ctx.enhanceActor?.({
            riskProfile: {
              score: riskProfile.score,
              level: riskProfile.level,
              factors: riskProfile.factors,
              lastAssessment: riskProfile.lastAssessment
            },
            preferences: {
              language: preferences.language,
              timezone: preferences.timezone,
              notifications: preferences.notifications,
              privacy: preferences.privacy
            },
            device: {
              type: deviceInfo.type,
              platform: deviceInfo.platform,
              browser: deviceInfo.browser,
              ip: deviceInfo.ip,
              location: deviceInfo.location,
              trusted: deviceInfo.trusted
            },
            security: {
              threatLevel: riskProfile.threatLevel,
              anomalyFlags: riskProfile.anomalies,
              trustedDevice: deviceInfo.trusted,
              vpnDetected: deviceInfo.vpnDetected,
              mfaVerified: true
            },
            session: {
              mfaVerified: true,
              deviceTrusted: deviceInfo.trusted,
              startedAt: '2024-01-15T08:00:00.000Z'
            }
          });
        }
      };

      // Mock controller that uses the middleware
      class TestController extends APIController {
        initialize(_event: APIGatewayEvent, _context: Context): Promise<void> {
          return Promise.resolve();
        }


        protected getMiddlewares(): APIControllerMiddleware[] {
          return [businessContextMiddleware];
        }

        // Test route that can access enhanced actor
        async testRoute(_request: Request, _response: Response, ctx: ExecutionContext) {
          return { actor: ctx.actor };
        }
      }

      // Mock functions
      async function fetchRiskProfile(actorId?: string) {
        const profiles = {
          'john.doe': {
            score: 75,
            level: 'medium',
            factors: ['new-device', 'unusual-location'],
            lastAssessment: '2024-01-15T09:00:00.000Z',
            threatLevel: 'low',
            anomalies: ['login-time-unusual']
          }
        };
        return profiles[actorId as keyof typeof profiles] || {
          score: 50, level: 'low', factors: [], lastAssessment: null, threatLevel: 'minimal', anomalies: []
        };
      }

      async function fetchUserPreferences(actorId?: string) {
        const preferences = {
          'john.doe': {
            language: 'en-US',
            timezone: 'America/New_York',
            notifications: { email: true, sms: false, push: true },
            privacy: { analytics: true, marketing: false, cookies: 'essential' }
          }
        };
        return preferences[actorId as keyof typeof preferences] || {
          language: 'en-US', timezone: 'UTC', notifications: {}, privacy: {}
        };
      }

      async function fetchDeviceContext(_request: Request) {
        return {
          type: 'desktop',
          platform: 'Windows',
          browser: 'Chrome',
          ip: '192.168.1.100',
          location: { country: 'US', city: 'New York' },
          trusted: true,
          vpnDetected: false
        };
      }

      // Test execution
      const event = createMockAPIGatewayEvent({
        requestContext: {
          ...createMockAPIGatewayEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              'cognito:username': 'john.doe'
            }
          }
        }
      });

      const controller = new TestController();
      const request = await controller.makeRequestContext(event, createMockLambdaContext());
      const response = await controller.makeResponseContext(request);
      const ctx = (controller as any).buildCtx(event, createMockLambdaContext(), request, response);

      // Execute middleware pipeline
      await (controller as any).executeMiddlewarePipeline('before', request, response, ctx);

      // Verify enhanced actor context
      expect(ctx.actor).toMatchObject({
        actorId: 'john.doe',

        riskProfile: {
          score: 75,
          level: 'medium',
          factors: ['new-device', 'unusual-location'],
          lastAssessment: '2024-01-15T09:00:00.000Z'
        },

        preferences: {
          language: 'en-US',
          timezone: 'America/New_York',
          notifications: { email: true, sms: false, push: true }
        },

        device: {
          type: 'desktop',
          platform: 'Windows',
          browser: 'Chrome',
          trusted: true
        },

        security: {
          threatLevel: 'low',
          anomalyFlags: ['login-time-unusual'],
          trustedDevice: true,
          vpnDetected: false
        }
      });
    });

    it('should enhance actor with real-time compliance and audit context', async () => {
      const complianceMiddleware: APIControllerMiddleware = {
        before: async (_request: Request, _response: Response, ctx?: ExecutionContext) => {
          if (!ctx?.actor) return;

          // Fetch compliance context
          const complianceStatus = await fetchComplianceStatus(ctx.actor.actorId, ctx.actor.tenantId);
          const auditContext = await fetchAuditContext(ctx.actor.actorId);

          // Use framework API to enhance with compliance data
          ctx.enhanceActor?.({
            compliance: {
              status: complianceStatus.status,
              certifications: complianceStatus.certifications,
              violations: complianceStatus.violations,
              lastAudit: complianceStatus.lastAudit,
              nextReview: complianceStatus.nextReview,
              dataClassifications: complianceStatus.dataAccess,
              retentionPolicies: complianceStatus.retention,
              gdprStatus: complianceStatus.gdpr,
              soxCompliant: complianceStatus.sox,
              hipaaAccess: complianceStatus.hipaa
            },
            audit: {
              trailEnabled: auditContext.enabled,
              sensitiveOperations: auditContext.sensitiveOps,
              retentionPeriod: auditContext.retentionDays,
              lastActivity: auditContext.lastActivity,
              highRiskOperations: auditContext.highRisk,
              anomalyDetection: auditContext.anomalyDetection,
              realTimeMonitoring: auditContext.realTime
            }
          });
        }
      };

      async function fetchComplianceStatus(_actorId?: string, _tenantId?: string) {
        return {
          status: 'compliant',
          certifications: ['ISO27001', 'SOC2-Type2', 'GDPR'],
          violations: [],
          lastAudit: '2024-01-01T00:00:00.000Z',
          nextReview: '2024-07-01T00:00:00.000Z',
          dataAccess: ['public', 'internal', 'confidential'],
          retention: { logs: 2555, userData: 2190, financial: 2555 }, // days
          gdpr: { lawfulBasis: 'legitimate-interest', dataSubject: true },
          sox: { certified: true, lastCertification: '2023-12-31' },
          hipaa: { authorized: false, reason: 'no-healthcare-data' }
        };
      }

      async function fetchAuditContext(_actorId?: string) {
        return {
          enabled: true,
          sensitiveOps: ['user.delete', 'data.export', 'admin.access'],
          retentionDays: 2555, // 7 years
          lastActivity: '2024-01-15T09:15:00.000Z',
          highRisk: ['financial.approve', 'security.modify'],
          anomalyDetection: true,
          realTime: true
        };
      }

      class ComplianceController extends APIController {
        async initialize(_event: APIGatewayEvent, _context: LambdaContext): Promise<void> {
          // No-op for testing
        }

        protected getMiddlewares(): APIControllerMiddleware[] {
          return [complianceMiddleware];
        }
      }

      const event = createMockAPIGatewayEvent({
        requestContext: {
          ...createMockAPIGatewayEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              'cognito:username': 'compliance.officer',
              'custom:tenantId': 'regulated-company'
            }
          }
        }
      });

      const controller = new ComplianceController();
      const request = await controller.makeRequestContext(event, createMockLambdaContext());
      const response = await controller.makeResponseContext(request);
      const ctx = (controller as any).buildCtx(event, createMockLambdaContext(), request, response);

      await (controller as any).executeMiddlewarePipeline('before', request, response, ctx);

      expect(ctx.actor).toMatchObject({
        actorId: 'compliance.officer',
        tenantId: 'regulated-company',

        compliance: {
          status: 'compliant',
          certifications: ['ISO27001', 'SOC2-Type2', 'GDPR'],
          violations: [],
          dataClassifications: ['public', 'internal', 'confidential'],
          gdprStatus: { lawfulBasis: 'legitimate-interest', dataSubject: true },
          soxCompliant: { certified: true, lastCertification: '2023-12-31' }
        },

        audit: {
          trailEnabled: true,
          sensitiveOperations: ['user.delete', 'data.export', 'admin.access'],
          retentionPeriod: 2555,
          highRiskOperations: ['financial.approve', 'security.modify'],
          anomalyDetection: true,
          realTimeMonitoring: true
        }
      });
    });
  });

  describe('Combined Enhancement: Controller + Middleware', () => {

    it('should support both controller override and middleware enhancement together', async () => {
      // Controller adds business context
      class EnterpriseController extends APIController {
        async initialize(_event: APIGatewayEvent, _context: LambdaContext): Promise<void> {
          // No-op for testing
        }

        protected extractActorContext(event: APIGatewayEvent, request: Request): Actor {
          const baseActor = super.extractActorContext(event, request);

          return {
            ...baseActor,
            // Controller adds core business context
            roles: ['enterprise-admin', 'finance-approver'],
            department: 'finance',
            approvalLimits: { financial: 1000000 }
          };
        }

        protected getMiddlewares(): APIControllerMiddleware[] {
          return [
            // Middleware 1: Add session context
            {
              before: async (_request, _response, ctx) => {
                ctx?.enhanceActor?.({
                  session: {
                    id: 'session-12345',
                    startedAt: '2024-01-15T08:00:00.000Z',
                    mfaVerified: true,
                    deviceTrusted: true
                  }
                });
              }
            },
            // Middleware 2: Add real-time risk assessment
            {
              before: async (_request, _response, ctx) => {
                ctx?.enhanceActor?.({
                  riskAssessment: {
                    score: 25, // low risk
                    factors: [],
                    recommendedActions: ['proceed'],
                    timestamp: new Date().toISOString()
                  }
                });
              }
            }
          ];
        }
      }

      const event = createMockAPIGatewayEvent({
        requestContext: {
          ...createMockAPIGatewayEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              'cognito:username': 'enterprise.admin'
            }
          }
        }
      });

      const controller = new EnterpriseController();
      const request = await controller.makeRequestContext(event, createMockLambdaContext());
      const response = await controller.makeResponseContext(request);
      const ctx = (controller as any).buildCtx(event, createMockLambdaContext(), request, response);

      // Execute middleware pipeline
      await (controller as any).executeMiddlewarePipeline('before', request, response, ctx);

      // Verify combined enhancement
      expect(ctx.actor).toMatchObject({
        // Base framework context
        actorId: 'enterprise.admin',
        authMethod: 'cognito',

        // Controller enhancement
        roles: ['enterprise-admin', 'finance-approver'],
        department: 'finance',
        approvalLimits: { financial: 1000000 },

        // Middleware 1 enhancement
        session: {
          id: 'session-12345',
          mfaVerified: true,
          deviceTrusted: true
        },

        // Middleware 2 enhancement
        riskAssessment: {
          score: 25,
          factors: [],
          recommendedActions: ['proceed']
        }
      });

      // Verify timestamps are recent (middleware 2 adds current time)
      expect(new Date(ctx.actor.riskAssessment.timestamp).getTime())
        .toBeGreaterThan(Date.now() - 5000);
    });
  });
});
