"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_gateway_controller_1 = require("./api-gateway-controller");
// Helper functions to create mock objects
function createMockAPIGatewayEvent(overrides = {}) {
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
    };
    return {
        ...baseEvent,
        ...overrides,
        requestContext: {
            ...baseEvent.requestContext,
            ...overrides.requestContext
        }
    };
}
function createMockLambdaContext() {
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
        done: () => { },
        fail: () => { },
        succeed: () => { }
    };
}
describe('Actor Context Enhancement Patterns', () => {
    describe('Controller Override: extractActorContext', () => {
        it('should enhance actor context with business roles and permissions', async () => {
            // Simulate a real business controller that fetches user roles/permissions
            class BusinessController extends api_gateway_controller_1.APIController {
                initialize(_event, _context) {
                    return Promise.resolve();
                }
                getMiddlewares() {
                    return [
                        // Middleware 1: Add session context
                        {
                            before: async (_request, _response, _ctx) => {
                            }
                        }
                    ];
                }
                extractActorContext(event, request) {
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
                fetchUserBusinessContext(actorId) {
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
                    return mockBusinessData[actorId] || {
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
                }
            });
            const controller = new BusinessController();
            const request = await controller.makeRequestContext(managerEvent, createMockLambdaContext());
            const enhancedActor = controller.extractActorContext(managerEvent, request);
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
            class SaaSController extends api_gateway_controller_1.APIController {
                initialize(_event, _context) {
                    return Promise.resolve();
                }
                extractActorContext(event, request) {
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
                fetchSubscriptionContext(tenantId) {
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
                    return mockSubscriptions[tenantId] || {
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
                fetchLicenseContext(actorId) {
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
                    return mockLicenses[actorId] || {
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
            const enhancedActor = controller.extractActorContext(tenantEvent, request);
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
            const businessContextMiddleware = {
                before: async (_request, _response, ctx) => {
                    if (!ctx?.actor || !ctx.enhanceActor)
                        return;
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
            class TestController extends api_gateway_controller_1.APIController {
                initialize(_event, _context) {
                    return Promise.resolve();
                }
                getMiddlewares() {
                    return [businessContextMiddleware];
                }
                // Test route that can access enhanced actor
                async testRoute(_request, _response, ctx) {
                    return { actor: ctx.actor };
                }
            }
            // Mock functions
            async function fetchRiskProfile(actorId) {
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
                return profiles[actorId] || {
                    score: 50, level: 'low', factors: [], lastAssessment: null, threatLevel: 'minimal', anomalies: []
                };
            }
            async function fetchUserPreferences(actorId) {
                const preferences = {
                    'john.doe': {
                        language: 'en-US',
                        timezone: 'America/New_York',
                        notifications: { email: true, sms: false, push: true },
                        privacy: { analytics: true, marketing: false, cookies: 'essential' }
                    }
                };
                return preferences[actorId] || {
                    language: 'en-US', timezone: 'UTC', notifications: {}, privacy: {}
                };
            }
            async function fetchDeviceContext(_request) {
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
            const ctx = controller.buildCtx(event, createMockLambdaContext(), request, response);
            // Execute middleware pipeline
            await controller.executeMiddlewarePipeline('before', request, response, ctx);
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
            const complianceMiddleware = {
                before: async (_request, _response, ctx) => {
                    if (!ctx?.actor)
                        return;
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
            async function fetchComplianceStatus(_actorId, _tenantId) {
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
            async function fetchAuditContext(_actorId) {
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
            class ComplianceController extends api_gateway_controller_1.APIController {
                async initialize(_event, _context) {
                    // No-op for testing
                }
                getMiddlewares() {
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
            const ctx = controller.buildCtx(event, createMockLambdaContext(), request, response);
            await controller.executeMiddlewarePipeline('before', request, response, ctx);
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
            class EnterpriseController extends api_gateway_controller_1.APIController {
                async initialize(_event, _context) {
                    // No-op for testing
                }
                extractActorContext(event, request) {
                    const baseActor = super.extractActorContext(event, request);
                    return {
                        ...baseActor,
                        // Controller adds core business context
                        roles: ['enterprise-admin', 'finance-approver'],
                        department: 'finance',
                        approvalLimits: { financial: 1000000 }
                    };
                }
                getMiddlewares() {
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
            const ctx = controller.buildCtx(event, createMockLambdaContext(), request, response);
            // Execute middleware pipeline
            await controller.executeMiddlewarePipeline('before', request, response, ctx);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0b3ItY29udGV4dC1lbmhhbmNlbWVudC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9hY3Rvci1jb250ZXh0LWVuaGFuY2VtZW50LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFDQSxxRUFBa0Y7QUFNbEYsMENBQTBDO0FBQzFDLFNBQVMseUJBQXlCLENBQUMsWUFBc0MsRUFBRTtJQUN6RSxNQUFNLFNBQVMsR0FBRztRQUNoQixRQUFRLEVBQUUsT0FBTztRQUNqQixJQUFJLEVBQUUsT0FBTztRQUNiLFVBQVUsRUFBRSxLQUFLO1FBQ2pCLE9BQU8sRUFBRSxFQUFFO1FBQ1gsaUJBQWlCLEVBQUUsRUFBRTtRQUNyQixxQkFBcUIsRUFBRSxJQUFJO1FBQzNCLCtCQUErQixFQUFFLElBQUk7UUFDckMsY0FBYyxFQUFFLElBQUk7UUFDcEIsY0FBYyxFQUFFLElBQUk7UUFDcEIsY0FBYyxFQUFFO1lBQ2QsVUFBVSxFQUFFLE1BQU07WUFDbEIsWUFBWSxFQUFFLE9BQU87WUFDckIsVUFBVSxFQUFFLEtBQUs7WUFDakIsU0FBUyxFQUFFLGNBQWM7WUFDekIsS0FBSyxFQUFFLE1BQU07WUFDYixRQUFRLEVBQUU7Z0JBQ1IscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0IsU0FBUyxFQUFFLElBQUk7Z0JBQ2YsaUJBQWlCLEVBQUUsSUFBSTtnQkFDdkIsTUFBTSxFQUFFLElBQUk7Z0JBQ1osUUFBUSxFQUFFLFdBQVc7Z0JBQ3JCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixTQUFTLEVBQUUsSUFBSTtnQkFDZix5QkFBeUIsRUFBRSxJQUFJO2dCQUMvQiw2QkFBNkIsRUFBRSxJQUFJO2dCQUNuQyxPQUFPLEVBQUUsSUFBSTtnQkFDYixTQUFTLEVBQUUsWUFBWTtnQkFDdkIsSUFBSSxFQUFFLElBQUk7Z0JBQ1YsTUFBTSxFQUFFLElBQUk7Z0JBQ1osUUFBUSxFQUFFLElBQUk7Z0JBQ2QsVUFB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LENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzlCLHlCQUF5QjtnQkFDekIsT0FBTyxFQUFFLGtCQUFrQjtnQkFDM0IsVUFBVSxFQUFFLFNBQVM7Z0JBRXJCLHlCQUF5QjtnQkFDekIsS0FBSyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsa0JBQWtCLENBQUM7Z0JBQy9DLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixjQUFjLEVBQUUsRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFO2dCQUV0QywyQkFBMkI7Z0JBQzNCLE9BQU8sRUFBRTtvQkFDUCxFQUFFLEVBQUUsZUFBZTtvQkFDbkIsV0FBVyxFQUFFLElBQUk7b0JBQ2pCLGFBQWEsRUFBRSxJQUFJO2lCQUNwQjtnQkFFRCwyQkFBMkI7Z0JBQzNCLGNBQWMsRUFBRTtvQkFDZCxLQUFLLEVBQUUsRUFBRTtvQkFDVCxPQUFPLEVBQUUsRUFBRTtvQkFDWCxrQkFBa0IsRUFBRSxDQUFDLFNBQVMsQ0FBQztpQkFDaEM7YUFDRixDQUFDLENBQUM7WUFFSCxnRUFBZ0U7WUFDaEUsTUFBTSxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO2lCQUMzRCxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDO1FBQ3hDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlFdmVudCwgQ29udGV4dCwgQ29udGV4dCBhcyBMYW1iZGFDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyLCBBUElDb250cm9sbGVyTWlkZGxld2FyZSB9IGZyb20gJy4vYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uL3R5cGVzL2FjdG9yJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBSZXF1ZXN0LCBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuXG5cbi8vIEhlbHBlciBmdW5jdGlvbnMgdG8gY3JlYXRlIG1vY2sgb2JqZWN0c1xuZnVuY3Rpb24gY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudChvdmVycmlkZXM6IFBhcnRpYWw8QVBJR2F0ZXdheUV2ZW50PiA9IHt9KTogQVBJR2F0ZXdheUV2ZW50IHtcbiAgY29uc3QgYmFzZUV2ZW50ID0ge1xuICAgIHJlc291cmNlOiAnL3Rlc3QnLFxuICAgIHBhdGg6ICcvdGVzdCcsXG4gICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgaGVhZGVyczoge30sXG4gICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxuICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxuICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxuICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICByZXNvdXJjZUlkOiAndGVzdCcsXG4gICAgICByZXNvdXJjZVBhdGg6ICcvdGVzdCcsXG4gICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdCcsXG4gICAgICBzdGFnZTogJ3Rlc3QnLFxuICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBudWxsLFxuICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxuICAgICAgICBjYWxsZXI6IG51bGwsXG4gICAgICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcbiAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXG4gICAgICAgIGFjY2Vzc0tleTogbnVsbCxcbiAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcbiAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXG4gICAgICAgIHVzZXJBcm46IG51bGwsXG4gICAgICAgIHVzZXJBZ2VudDogJ3Rlc3QtYWdlbnQnLFxuICAgICAgICB1c2VyOiBudWxsLFxuICAgICAgICBhcGlLZXk6IG51bGwsXG4gICAgICAgIGFwaUtleUlkOiBudWxsLFxuICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICB9LFxuICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXG4gICAgICByZXF1ZXN0VGltZTogJzA5L0Fwci8yMDE1OjEyOjM0OjU2ICswMDAwJyxcbiAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IDE0Mjg1ODI4OTYwMDAsXG4gICAgICBhcGlJZDogJ3Rlc3QtYXBpJ1xuICAgIH0sXG4gICAgYm9keTogbnVsbCxcbiAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxuICB9IGFzIEFQSUdhdGV3YXlFdmVudDtcblxuICByZXR1cm4ge1xuICAgIC4uLmJhc2VFdmVudCxcbiAgICAuLi5vdmVycmlkZXMsXG4gICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgIC4uLmJhc2VFdmVudC5yZXF1ZXN0Q29udGV4dCxcbiAgICAgIC4uLm92ZXJyaWRlcy5yZXF1ZXN0Q29udGV4dFxuICAgIH1cbiAgfSBhcyBBUElHYXRld2F5RXZlbnQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCk6IExhbWJkYUNvbnRleHQge1xuICByZXR1cm4ge1xuICAgIGNhbGxiYWNrV2FpdHNGb3JFbXB0eUV2ZW50TG9vcDogZmFsc2UsXG4gICAgZnVuY3Rpb25OYW1lOiAndGVzdC1mdW5jdGlvbicsXG4gICAgZnVuY3Rpb25WZXJzaW9uOiAnMScsXG4gICAgaW52b2tlZEZ1bmN0aW9uQXJuOiAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpmdW5jdGlvbjp0ZXN0LWZ1bmN0aW9uJyxcbiAgICBtZW1vcnlMaW1pdEluTUI6ICcxMjgnLFxuICAgIGF3c1JlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXG4gICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9sYW1iZGEvdGVzdC1mdW5jdGlvbicsXG4gICAgbG9nU3RyZWFtTmFtZTogJzIwMjMvMDEvMDEvWyRMQVRFU1RdYWJjZGVmJyxcblxuICAgIGdldFJlbWFpbmluZ1RpbWVJbk1pbGxpczogKCkgPT4gMzAwMDAsXG4gICAgZG9uZTogKCkgPT4ge30sXG4gICAgZmFpbDogKCkgPT4ge30sXG4gICAgc3VjY2VlZDogKCkgPT4ge31cbiAgfTtcbn1cblxuZGVzY3JpYmUoJ0FjdG9yIENvbnRleHQgRW5oYW5jZW1lbnQgUGF0dGVybnMnLCAoKSA9PiB7XG5cbiAgZGVzY3JpYmUoJ0NvbnRyb2xsZXIgT3ZlcnJpZGU6IGV4dHJhY3RBY3RvckNvbnRleHQnLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBlbmhhbmNlIGFjdG9yIGNvbnRleHQgd2l0aCBidXNpbmVzcyByb2xlcyBhbmQgcGVybWlzc2lvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTaW11bGF0ZSBhIHJlYWwgYnVzaW5lc3MgY29udHJvbGxlciB0aGF0IGZldGNoZXMgdXNlciByb2xlcy9wZXJtaXNzaW9uc1xuICAgICAgY2xhc3MgQnVzaW5lc3NDb250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG5cbiAgICAgICAgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IExhbWJkYUNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgLy8gTWlkZGxld2FyZSAxOiBBZGQgc2Vzc2lvbiBjb250ZXh0XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0LCBfcmVzcG9uc2UsIF9jdHgpID0+IHtcbiAgICAgICAgXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgICAgICAgIC8vIFN0YXJ0IHdpdGggYmFzZSBhY3RvciBjb250ZXh0IGZyb20gZnJhbWV3b3JrXG4gICAgICAgICAgY29uc3QgYmFzZUFjdG9yID0gc3VwZXIuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2ltdWxhdGUgZmV0Y2hpbmcgYnVzaW5lc3MgY29udGV4dCBmcm9tIGRhdGFiYXNlL2NhY2hlXG4gICAgICAgICAgY29uc3QgYnVzaW5lc3NDb250ZXh0ID0gdGhpcy5mZXRjaFVzZXJCdXNpbmVzc0NvbnRleHQoYmFzZUFjdG9yLmFjdG9ySWQpO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIEVuaGFuY2UgYWN0b3Igd2l0aCBidXNpbmVzcyBjb250ZXh0XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLmJhc2VBY3RvcixcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUm9sZS1iYXNlZCBhY2Nlc3MgY29udHJvbFxuICAgICAgICAgICAgcm9sZXM6IGJ1c2luZXNzQ29udGV4dC5yb2xlcyxcbiAgICAgICAgICAgIHByaW1hcnlSb2xlOiBidXNpbmVzc0NvbnRleHQucHJpbWFyeVJvbGUsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFBlcm1pc3Npb24gc3lzdGVtXG4gICAgICAgICAgICBwZXJtaXNzaW9uczogYnVzaW5lc3NDb250ZXh0LnBlcm1pc3Npb25zLFxuICAgICAgICAgICAgcGVybWlzc2lvbkxldmVsOiBidXNpbmVzc0NvbnRleHQucGVybWlzc2lvbkxldmVsLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPcmdhbml6YXRpb25hbCBjb250ZXh0XG4gICAgICAgICAgICBkZXBhcnRtZW50OiBidXNpbmVzc0NvbnRleHQuZGVwYXJ0bWVudCxcbiAgICAgICAgICAgIGNvc3RDZW50ZXI6IGJ1c2luZXNzQ29udGV4dC5jb3N0Q2VudGVyLFxuICAgICAgICAgICAgbWFuYWdlcklkOiBidXNpbmVzc0NvbnRleHQubWFuYWdlcklkLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBCdXNpbmVzcyBydWxlc1xuICAgICAgICAgICAgYXBwcm92YWxMaW1pdHM6IHtcbiAgICAgICAgICAgICAgZmluYW5jaWFsOiBidXNpbmVzc0NvbnRleHQuZmluYW5jaWFsQXBwcm92YWxMaW1pdCxcbiAgICAgICAgICAgICAgdGltZU9mZjogYnVzaW5lc3NDb250ZXh0LnRpbWVPZmZBcHByb3ZhbExpbWl0LFxuICAgICAgICAgICAgICBwcm9jdXJlbWVudDogYnVzaW5lc3NDb250ZXh0LnByb2N1cmVtZW50QXBwcm92YWxMaW1pdFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ29tcGxpYW5jZSBhbmQgc2VjdXJpdHlcbiAgICAgICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiBidXNpbmVzc0NvbnRleHQuc2VjdXJpdHlDbGVhcmFuY2UsXG4gICAgICAgICAgICBjb21wbGlhbmNlRmxhZ3M6IGJ1c2luZXNzQ29udGV4dC5jb21wbGlhbmNlRmxhZ3MsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFN5c3RlbSBjb250ZXh0XG4gICAgICAgICAgICBsYXN0TG9naW5BdDogYnVzaW5lc3NDb250ZXh0Lmxhc3RMb2dpbkF0LFxuICAgICAgICAgICAgc2Vzc2lvbkV4cGlyZXNBdDogYnVzaW5lc3NDb250ZXh0LnNlc3Npb25FeHBpcmVzQXQsXG4gICAgICAgICAgICBtZmFWZXJpZmllZDogYnVzaW5lc3NDb250ZXh0Lm1mYVZlcmlmaWVkXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcHJpdmF0ZSBmZXRjaFVzZXJCdXNpbmVzc0NvbnRleHQoYWN0b3JJZD86IHN0cmluZykge1xuICAgICAgICAgIC8vIFNpbXVsYXRlIGRhdGFiYXNlL2NhY2hlIGxvb2t1cFxuICAgICAgICAgIGNvbnN0IG1vY2tCdXNpbmVzc0RhdGEgPSB7XG4gICAgICAgICAgICAnam9obi5kb2UnOiB7XG4gICAgICAgICAgICAgIHJvbGVzOiBbJ21hbmFnZXInLCAnYXBwcm92ZXInLCAnYnVkZ2V0LW93bmVyJ10sXG4gICAgICAgICAgICAgIHByaW1hcnlSb2xlOiAnbWFuYWdlcicsXG4gICAgICAgICAgICAgIHBlcm1pc3Npb25zOiBbJ3VzZXIucmVhZCcsICd1c2VyLndyaXRlJywgJ2J1ZGdldC5hcHByb3ZlJywgJ3JlcG9ydC5nZW5lcmF0ZSddLFxuICAgICAgICAgICAgICBwZXJtaXNzaW9uTGV2ZWw6ICdzZW5pb3InLFxuICAgICAgICAgICAgICBkZXBhcnRtZW50OiAnZW5naW5lZXJpbmcnLFxuICAgICAgICAgICAgICBjb3N0Q2VudGVyOiAnRU5HLTAwMScsXG4gICAgICAgICAgICAgIG1hbmFnZXJJZDogJ2phbmUuc21pdGgnLFxuICAgICAgICAgICAgICBmaW5hbmNpYWxBcHByb3ZhbExpbWl0OiA1MDAwMCxcbiAgICAgICAgICAgICAgdGltZU9mZkFwcHJvdmFsTGltaXQ6IDMwLCAvLyBkYXlzXG4gICAgICAgICAgICAgIHByb2N1cmVtZW50QXBwcm92YWxMaW1pdDogMjUwMDAsXG4gICAgICAgICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiAnY29uZmlkZW50aWFsJyxcbiAgICAgICAgICAgICAgY29tcGxpYW5jZUZsYWdzOiBbJ3NveC1jb21wbGlhbnQnLCAnZ2Rwci10cmFpbmVkJ10sXG4gICAgICAgICAgICAgIGxhc3RMb2dpbkF0OiAnMjAyNC0wMS0xNVQwODowMDowMC4wMDBaJyxcbiAgICAgICAgICAgICAgc2Vzc2lvbkV4cGlyZXNBdDogJzIwMjQtMDEtMTVUMTg6MDA6MDAuMDAwWicsXG4gICAgICAgICAgICAgIG1mYVZlcmlmaWVkOiB0cnVlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgJ2FwaS1zZXJ2aWNlLWJpbGxpbmcnOiB7XG4gICAgICAgICAgICAgIHJvbGVzOiBbJ3NlcnZpY2UnLCAnYXV0b21hdGVkLWJpbGxpbmcnXSxcbiAgICAgICAgICAgICAgcHJpbWFyeVJvbGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgcGVybWlzc2lvbnM6IFsnYmlsbGluZy5yZWFkJywgJ2JpbGxpbmcud3JpdGUnLCAnaW52b2ljZS5nZW5lcmF0ZScsICdwYXltZW50LnByb2Nlc3MnXSxcbiAgICAgICAgICAgICAgcGVybWlzc2lvbkxldmVsOiAnc2VydmljZScsXG4gICAgICAgICAgICAgIGRlcGFydG1lbnQ6ICdmaW5hbmNlJyxcbiAgICAgICAgICAgICAgY29zdENlbnRlcjogJ1NWQy0wMDEnLFxuICAgICAgICAgICAgICBtYW5hZ2VySWQ6IG51bGwsXG4gICAgICAgICAgICAgIGZpbmFuY2lhbEFwcHJvdmFsTGltaXQ6IDEwMDAwMCxcbiAgICAgICAgICAgICAgdGltZU9mZkFwcHJvdmFsTGltaXQ6IDAsXG4gICAgICAgICAgICAgIHByb2N1cmVtZW50QXBwcm92YWxMaW1pdDogMCxcbiAgICAgICAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgY29tcGxpYW5jZUZsYWdzOiBbJ3BjaS1jb21wbGlhbnQnLCAnc294LWNvbXBsaWFudCddLFxuICAgICAgICAgICAgICBsYXN0TG9naW5BdDogbnVsbCxcbiAgICAgICAgICAgICAgc2Vzc2lvbkV4cGlyZXNBdDogbnVsbCxcbiAgICAgICAgICAgICAgbWZhVmVyaWZpZWQ6IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIFxuICAgICAgICAgIHJldHVybiBtb2NrQnVzaW5lc3NEYXRhW2FjdG9ySWQgYXMga2V5b2YgdHlwZW9mIG1vY2tCdXNpbmVzc0RhdGFdIHx8IHtcbiAgICAgICAgICAgIHJvbGVzOiBbJ3VzZXInXSxcbiAgICAgICAgICAgIHByaW1hcnlSb2xlOiAndXNlcicsXG4gICAgICAgICAgICBwZXJtaXNzaW9uczogWyd1c2VyLnJlYWQnXSxcbiAgICAgICAgICAgIHBlcm1pc3Npb25MZXZlbDogJ2Jhc2ljJyxcbiAgICAgICAgICAgIGRlcGFydG1lbnQ6ICd1bmtub3duJyxcbiAgICAgICAgICAgIGNvc3RDZW50ZXI6ICdVTkstMDAxJyxcbiAgICAgICAgICAgIG1hbmFnZXJJZDogbnVsbCxcbiAgICAgICAgICAgIGZpbmFuY2lhbEFwcHJvdmFsTGltaXQ6IDAsXG4gICAgICAgICAgICB0aW1lT2ZmQXBwcm92YWxMaW1pdDogMCxcbiAgICAgICAgICAgIHByb2N1cmVtZW50QXBwcm92YWxMaW1pdDogMCxcbiAgICAgICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiAncHVibGljJyxcbiAgICAgICAgICAgIGNvbXBsaWFuY2VGbGFnczogW10sXG4gICAgICAgICAgICBsYXN0TG9naW5BdDogbnVsbCxcbiAgICAgICAgICAgIHNlc3Npb25FeHBpcmVzQXQ6IG51bGwsXG4gICAgICAgICAgICBtZmFWZXJpZmllZDogZmFsc2VcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIFRlc3Qgd2l0aCBtYW5hZ2VyIGFjdG9yXG4gICAgICBjb25zdCBtYW5hZ2VyRXZlbnQgPSBjcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci0xMjMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZScsXG4gICAgICAgICAgICAgICdjb2duaXRvOmdyb3Vwcyc6IFsnbWFuYWdlcnMnLCAnZW1wbG95ZWVzJ11cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBCdXNpbmVzc0NvbnRyb2xsZXIoKTtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCBjb250cm9sbGVyLm1ha2VSZXF1ZXN0Q29udGV4dChtYW5hZ2VyRXZlbnQsIGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCkpO1xuICAgICAgY29uc3QgZW5oYW5jZWRBY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChtYW5hZ2VyRXZlbnQsIHJlcXVlc3QpO1xuICAgICAgXG4gICAgICAvLyBWZXJpZnkgZW5oYW5jZWQgYWN0b3IgY29udGV4dFxuICAgICAgZXhwZWN0KGVuaGFuY2VkQWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBhY3RvcklkOiAnam9obi5kb2UnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBcbiAgICAgICAgLy8gQnVzaW5lc3Mgcm9sZXNcbiAgICAgICAgcm9sZXM6IFsnbWFuYWdlcicsICdhcHByb3ZlcicsICdidWRnZXQtb3duZXInXSxcbiAgICAgICAgcHJpbWFyeVJvbGU6ICdtYW5hZ2VyJyxcbiAgICAgICAgXG4gICAgICAgIC8vIFBlcm1pc3Npb25zXG4gICAgICAgIHBlcm1pc3Npb25zOiBbJ3VzZXIucmVhZCcsICd1c2VyLndyaXRlJywgJ2J1ZGdldC5hcHByb3ZlJywgJ3JlcG9ydC5nZW5lcmF0ZSddLFxuICAgICAgICBwZXJtaXNzaW9uTGV2ZWw6ICdzZW5pb3InLFxuICAgICAgICBcbiAgICAgICAgLy8gT3JnYW5pemF0aW9uYWxcbiAgICAgICAgZGVwYXJ0bWVudDogJ2VuZ2luZWVyaW5nJyxcbiAgICAgICAgY29zdENlbnRlcjogJ0VORy0wMDEnLFxuICAgICAgICBtYW5hZ2VySWQ6ICdqYW5lLnNtaXRoJyxcbiAgICAgICAgXG4gICAgICAgIC8vIEFwcHJvdmFsIGxpbWl0c1xuICAgICAgICBhcHByb3ZhbExpbWl0czoge1xuICAgICAgICAgIGZpbmFuY2lhbDogNTAwMDAsXG4gICAgICAgICAgdGltZU9mZjogMzAsXG4gICAgICAgICAgcHJvY3VyZW1lbnQ6IDI1MDAwXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyBTZWN1cml0eVxuICAgICAgICBzZWN1cml0eUNsZWFyYW5jZTogJ2NvbmZpZGVudGlhbCcsXG4gICAgICAgIGNvbXBsaWFuY2VGbGFnczogWydzb3gtY29tcGxpYW50JywgJ2dkcHItdHJhaW5lZCddLFxuICAgICAgICBtZmFWZXJpZmllZDogdHJ1ZVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBlbmhhbmNlIGFjdG9yIGNvbnRleHQgd2l0aCBzdWJzY3JpcHRpb24gYW5kIGxpY2Vuc2luZyBkYXRhJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY2xhc3MgU2FhU0NvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcblxuICAgICAgICBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogTGFtYmRhQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcHJvdGVjdGVkIGV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCk6IEFjdG9yIHtcbiAgICAgICAgICBjb25zdCBiYXNlQWN0b3IgPSBzdXBlci5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcbiAgICAgICAgICBjb25zdCBzdWJzY3JpcHRpb25EYXRhID0gdGhpcy5mZXRjaFN1YnNjcmlwdGlvbkNvbnRleHQoYmFzZUFjdG9yLnRlbmFudElkKTtcbiAgICAgICAgICBjb25zdCBsaWNlbnNlRGF0YSA9IHRoaXMuZmV0Y2hMaWNlbnNlQ29udGV4dChiYXNlQWN0b3IuYWN0b3JJZCk7XG4gICAgICAgICAgXG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLmJhc2VBY3RvcixcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3Vic2NyaXB0aW9uIGNvbnRleHRcbiAgICAgICAgICAgIHN1YnNjcmlwdGlvbjoge1xuICAgICAgICAgICAgICB0aWVyOiBzdWJzY3JpcHRpb25EYXRhLnRpZXIsXG4gICAgICAgICAgICAgIHN0YXR1czogc3Vic2NyaXB0aW9uRGF0YS5zdGF0dXMsXG4gICAgICAgICAgICAgIGV4cGlyZXNBdDogc3Vic2NyaXB0aW9uRGF0YS5leHBpcmVzQXQsXG4gICAgICAgICAgICAgIGZlYXR1cmVzOiBzdWJzY3JpcHRpb25EYXRhLmZlYXR1cmVzLFxuICAgICAgICAgICAgICBsaW1pdHM6IHN1YnNjcmlwdGlvbkRhdGEubGltaXRzLFxuICAgICAgICAgICAgICBiaWxsaW5nQ3ljbGU6IHN1YnNjcmlwdGlvbkRhdGEuYmlsbGluZ0N5Y2xlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBMaWNlbnNlIGNvbnRleHRcbiAgICAgICAgICAgIGxpY2Vuc2VzOiBsaWNlbnNlRGF0YS5saWNlbnNlcyxcbiAgICAgICAgICAgIGFjdGl2ZUxpY2Vuc2VzOiBsaWNlbnNlRGF0YS5hY3RpdmVMaWNlbnNlcyxcbiAgICAgICAgICAgIGxpY2Vuc2VRdW90YXM6IGxpY2Vuc2VEYXRhLnF1b3RhcyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVXNhZ2UgdHJhY2tpbmdcbiAgICAgICAgICAgIHVzYWdlOiB7XG4gICAgICAgICAgICAgIGFwaUNhbGxzVGhpc01vbnRoOiBzdWJzY3JpcHRpb25EYXRhLnVzYWdlLmFwaUNhbGxzLFxuICAgICAgICAgICAgICBzdG9yYWdlVXNlZDogc3Vic2NyaXB0aW9uRGF0YS51c2FnZS5zdG9yYWdlLFxuICAgICAgICAgICAgICB1c2Vyc0FjdGl2ZTogc3Vic2NyaXB0aW9uRGF0YS51c2FnZS5hY3RpdmVVc2Vyc1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRmVhdHVyZSBmbGFnc1xuICAgICAgICAgICAgZmVhdHVyZUZsYWdzOiBzdWJzY3JpcHRpb25EYXRhLmZlYXR1cmVGbGFncyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQmlsbGluZyBjb250ZXh0XG4gICAgICAgICAgICBiaWxsaW5nOiB7XG4gICAgICAgICAgICAgIGFjY291bnRCYWxhbmNlOiBzdWJzY3JpcHRpb25EYXRhLmJpbGxpbmcuYmFsYW5jZSxcbiAgICAgICAgICAgICAgcGF5bWVudFN0YXR1czogc3Vic2NyaXB0aW9uRGF0YS5iaWxsaW5nLnN0YXR1cyxcbiAgICAgICAgICAgICAgbmV4dEJpbGxpbmdEYXRlOiBzdWJzY3JpcHRpb25EYXRhLmJpbGxpbmcubmV4dEJpbGxpbmdEYXRlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcHJpdmF0ZSBmZXRjaFN1YnNjcmlwdGlvbkNvbnRleHQodGVuYW50SWQ/OiBzdHJpbmcpIHtcbiAgICAgICAgICBjb25zdCBtb2NrU3Vic2NyaXB0aW9ucyA9IHtcbiAgICAgICAgICAgICdjb21wYW55LWJsb2ctdGVuYW50Jzoge1xuICAgICAgICAgICAgICB0aWVyOiAnZW50ZXJwcmlzZScsXG4gICAgICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgICAgIGV4cGlyZXNBdDogJzIwMjQtMTItMzFUMjM6NTk6NTkuMDAwWicsXG4gICAgICAgICAgICAgIGZlYXR1cmVzOiBbJ2FkdmFuY2VkLWFuYWx5dGljcycsICdjdXN0b20tYnJhbmRpbmcnLCAnc3NvJywgJ2F1ZGl0LWxvZ3MnXSxcbiAgICAgICAgICAgICAgbGltaXRzOiB7XG4gICAgICAgICAgICAgICAgdXNlcnM6IDEwMDAsXG4gICAgICAgICAgICAgICAgc3RvcmFnZTogMTAyNCAqIDEwMjQgKiAxMDI0ICogMTAwLCAvLyAxMDBHQlxuICAgICAgICAgICAgICAgIGFwaUNhbGxzUGVyTW9udGg6IDEwMDAwMDBcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYmlsbGluZ0N5Y2xlOiAnYW5udWFsJyxcbiAgICAgICAgICAgICAgdXNhZ2U6IHtcbiAgICAgICAgICAgICAgICBhcGlDYWxsczogNDUwMDAsXG4gICAgICAgICAgICAgICAgc3RvcmFnZTogMTAyNCAqIDEwMjQgKiAxMDI0ICogMjUsIC8vIDI1R0JcbiAgICAgICAgICAgICAgICBhY3RpdmVVc2VyczogODlcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZmVhdHVyZUZsYWdzOiB7XG4gICAgICAgICAgICAgICAgJ2JldGEtYWktZmVhdHVyZXMnOiB0cnVlLFxuICAgICAgICAgICAgICAgICdhZHZhbmNlZC1yZXBvcnRpbmcnOiB0cnVlLFxuICAgICAgICAgICAgICAgICdjdXN0b20taW50ZWdyYXRpb25zJzogdHJ1ZVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBiaWxsaW5nOiB7XG4gICAgICAgICAgICAgICAgYmFsYW5jZTogMCxcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdwYWlkJyxcbiAgICAgICAgICAgICAgICBuZXh0QmlsbGluZ0RhdGU6ICcyMDI0LTEyLTMxVDAwOjAwOjAwLjAwMFonXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAnc3RhcnR1cC10ZW5hbnQnOiB7XG4gICAgICAgICAgICAgIHRpZXI6ICdzdGFydHVwJyxcbiAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgICAgZXhwaXJlc0F0OiAnMjAyNC0wNi0zMFQyMzo1OTo1OS4wMDBaJyxcbiAgICAgICAgICAgICAgZmVhdHVyZXM6IFsnYmFzaWMtYW5hbHl0aWNzJywgJ3N0YW5kYXJkLXN1cHBvcnQnXSxcbiAgICAgICAgICAgICAgbGltaXRzOiB7XG4gICAgICAgICAgICAgICAgdXNlcnM6IDUwLFxuICAgICAgICAgICAgICAgIHN0b3JhZ2U6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwLCAvLyAxMEdCXG4gICAgICAgICAgICAgICAgYXBpQ2FsbHNQZXJNb250aDogMTAwMDAwXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJpbGxpbmdDeWNsZTogJ21vbnRobHknLFxuICAgICAgICAgICAgICB1c2FnZToge1xuICAgICAgICAgICAgICAgIGFwaUNhbGxzOiA3ODAwMCxcbiAgICAgICAgICAgICAgICBzdG9yYWdlOiAxMDI0ICogMTAyNCAqIDEwMjQgKiA4LCAvLyA4R0JcbiAgICAgICAgICAgICAgICBhY3RpdmVVc2VyczogMjNcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZmVhdHVyZUZsYWdzOiB7XG4gICAgICAgICAgICAgICAgJ2JldGEtYWktZmVhdHVyZXMnOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAnYWR2YW5jZWQtcmVwb3J0aW5nJzogZmFsc2UsXG4gICAgICAgICAgICAgICAgJ2N1c3RvbS1pbnRlZ3JhdGlvbnMnOiBmYWxzZVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBiaWxsaW5nOiB7XG4gICAgICAgICAgICAgICAgYmFsYW5jZTogMCxcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdwYWlkJyxcbiAgICAgICAgICAgICAgICBuZXh0QmlsbGluZ0RhdGU6ICcyMDI0LTAyLTAxVDAwOjAwOjAwLjAwMFonXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIFxuICAgICAgICAgIHJldHVybiBtb2NrU3Vic2NyaXB0aW9uc1t0ZW5hbnRJZCBhcyBrZXlvZiB0eXBlb2YgbW9ja1N1YnNjcmlwdGlvbnNdIHx8IHtcbiAgICAgICAgICAgIHRpZXI6ICdmcmVlJyxcbiAgICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgICBleHBpcmVzQXQ6IG51bGwsXG4gICAgICAgICAgICBmZWF0dXJlczogWydiYXNpYyddLFxuICAgICAgICAgICAgbGltaXRzOiB7IHVzZXJzOiAzLCBzdG9yYWdlOiAxMDI0ICogMTAyNCAqIDEwMCwgYXBpQ2FsbHNQZXJNb250aDogMTAwMCB9LFxuICAgICAgICAgICAgYmlsbGluZ0N5Y2xlOiBudWxsLFxuICAgICAgICAgICAgdXNhZ2U6IHsgYXBpQ2FsbHM6IDAsIHN0b3JhZ2U6IDAsIGFjdGl2ZVVzZXJzOiAxIH0sXG4gICAgICAgICAgICBmZWF0dXJlRmxhZ3M6IHt9LFxuICAgICAgICAgICAgYmlsbGluZzogeyBiYWxhbmNlOiAwLCBzdGF0dXM6ICdmcmVlJywgbmV4dEJpbGxpbmdEYXRlOiBudWxsIH1cbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBwcml2YXRlIGZldGNoTGljZW5zZUNvbnRleHQoYWN0b3JJZD86IHN0cmluZykge1xuICAgICAgICAgIGNvbnN0IG1vY2tMaWNlbnNlcyA9IHtcbiAgICAgICAgICAgICdqb2huLmRvZSc6IHtcbiAgICAgICAgICAgICAgbGljZW5zZXM6IFsnZW50ZXJwcmlzZS1hZG1pbicsICdhbmFseXRpY3MtcHJvJywgJ3NlY3VyaXR5LW1hbmFnZXInXSxcbiAgICAgICAgICAgICAgYWN0aXZlTGljZW5zZXM6IFsnZW50ZXJwcmlzZS1hZG1pbicsICdhbmFseXRpY3MtcHJvJ10sXG4gICAgICAgICAgICAgIHF1b3Rhczoge1xuICAgICAgICAgICAgICAgICdlbnRlcnByaXNlLWFkbWluJzogeyBhc3NpZ25lZDogMSwgdG90YWw6IDUgfSxcbiAgICAgICAgICAgICAgICAnYW5hbHl0aWNzLXBybyc6IHsgYXNzaWduZWQ6IDEsIHRvdGFsOiAxMCB9LFxuICAgICAgICAgICAgICAgICdzZWN1cml0eS1tYW5hZ2VyJzogeyBhc3NpZ25lZDogMCwgdG90YWw6IDMgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfTtcbiAgICAgICAgICBcbiAgICAgICAgICByZXR1cm4gbW9ja0xpY2Vuc2VzW2FjdG9ySWQgYXMga2V5b2YgdHlwZW9mIG1vY2tMaWNlbnNlc10gfHwge1xuICAgICAgICAgICAgbGljZW5zZXM6IFsnYmFzaWMtdXNlciddLFxuICAgICAgICAgICAgYWN0aXZlTGljZW5zZXM6IFsnYmFzaWMtdXNlciddLFxuICAgICAgICAgICAgcXVvdGFzOiB7ICdiYXNpYy11c2VyJzogeyBhc3NpZ25lZDogMSwgdG90YWw6IDEgfSB9XG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCB0ZW5hbnRFdmVudCA9IGNyZWF0ZU1vY2tBUElHYXRld2F5RXZlbnQoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIC4uLmNyZWF0ZU1vY2tBUElHYXRld2F5RXZlbnQoKS5yZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci0xMjMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZScsXG4gICAgICAgICAgICAgICdjdXN0b206dGVuYW50SWQnOiAnY29tcGFueS1ibG9nLXRlbmFudCdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFNhYVNDb250cm9sbGVyKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgY29udHJvbGxlci5tYWtlUmVxdWVzdENvbnRleHQodGVuYW50RXZlbnQsIGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCkpO1xuICAgICAgY29uc3QgZW5oYW5jZWRBY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dCh0ZW5hbnRFdmVudCwgcmVxdWVzdCk7XG4gICAgICBcbiAgICAgIGV4cGVjdChlbmhhbmNlZEFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgYWN0b3JJZDogJ2pvaG4uZG9lJyxcbiAgICAgICAgdGVuYW50SWQ6ICdjb21wYW55LWJsb2ctdGVuYW50JyxcbiAgICAgICAgXG4gICAgICAgIHN1YnNjcmlwdGlvbjoge1xuICAgICAgICAgIHRpZXI6ICdlbnRlcnByaXNlJyxcbiAgICAgICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgICAgICAgIGZlYXR1cmVzOiBbJ2FkdmFuY2VkLWFuYWx5dGljcycsICdjdXN0b20tYnJhbmRpbmcnLCAnc3NvJywgJ2F1ZGl0LWxvZ3MnXSxcbiAgICAgICAgICBsaW1pdHM6IHtcbiAgICAgICAgICAgIHVzZXJzOiAxMDAwLFxuICAgICAgICAgICAgc3RvcmFnZTogMTA3Mzc0MTgyNDAwLCAvLyAxMDBHQlxuICAgICAgICAgICAgYXBpQ2FsbHNQZXJNb250aDogMTAwMDAwMFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIGxpY2Vuc2VzOiBbJ2VudGVycHJpc2UtYWRtaW4nLCAnYW5hbHl0aWNzLXBybycsICdzZWN1cml0eS1tYW5hZ2VyJ10sXG4gICAgICAgIGFjdGl2ZUxpY2Vuc2VzOiBbJ2VudGVycHJpc2UtYWRtaW4nLCAnYW5hbHl0aWNzLXBybyddLFxuICAgICAgICBcbiAgICAgICAgdXNhZ2U6IHtcbiAgICAgICAgICBhcGlDYWxsc1RoaXNNb250aDogNDUwMDAsXG4gICAgICAgICAgc3RvcmFnZVVzZWQ6IDI2ODQzNTQ1NjAwLCAvLyAyNUdCXG4gICAgICAgICAgdXNlcnNBY3RpdmU6IDg5XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBmZWF0dXJlRmxhZ3M6IHtcbiAgICAgICAgICAnYmV0YS1haS1mZWF0dXJlcyc6IHRydWUsXG4gICAgICAgICAgJ2FkdmFuY2VkLXJlcG9ydGluZyc6IHRydWUsXG4gICAgICAgICAgJ2N1c3RvbS1pbnRlZ3JhdGlvbnMnOiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgXG4gIGRlc2NyaWJlKCdNaWRkbGV3YXJlIEVuaGFuY2VtZW50OiBBY3RvciBDb250ZXh0JywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgZW5oYW5jZSBhY3RvciBjb250ZXh0IHZpYSBiZWZvcmUgbWlkZGxld2FyZScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEJ1c2luZXNzIGNvbnRleHQgbWlkZGxld2FyZSB0aGF0IGVuaGFuY2VzIGFjdG9yIHVzaW5nIGZyYW1ld29yayBBUElcbiAgICAgIGNvbnN0IGJ1c2luZXNzQ29udGV4dE1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlID0ge1xuICAgICAgICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdDogUmVxdWVzdCwgX3Jlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4ge1xuICAgICAgICAgIGlmICghY3R4Py5hY3RvciB8fCAhY3R4LmVuaGFuY2VBY3RvcikgcmV0dXJuO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFNpbXVsYXRlIGZldGNoaW5nIGFkZGl0aW9uYWwgYnVzaW5lc3MgY29udGV4dFxuICAgICAgICAgIGNvbnN0IHJpc2tQcm9maWxlID0gYXdhaXQgZmV0Y2hSaXNrUHJvZmlsZShjdHguYWN0b3IuYWN0b3JJZCk7XG4gICAgICAgICAgY29uc3QgcHJlZmVyZW5jZXMgPSBhd2FpdCBmZXRjaFVzZXJQcmVmZXJlbmNlcyhjdHguYWN0b3IuYWN0b3JJZCk7XG4gICAgICAgICAgY29uc3QgZGV2aWNlSW5mbyA9IGF3YWl0IGZldGNoRGV2aWNlQ29udGV4dChfcmVxdWVzdCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVXNlIHNpbXBsZSBmcmFtZXdvcmsgQVBJIHRvIGVuaGFuY2UgYWN0b3IgY29udGV4dFxuICAgICAgICAgIGN0eC5lbmhhbmNlQWN0b3I/Lih7XG4gICAgICAgICAgICByaXNrUHJvZmlsZToge1xuICAgICAgICAgICAgICBzY29yZTogcmlza1Byb2ZpbGUuc2NvcmUsXG4gICAgICAgICAgICAgIGxldmVsOiByaXNrUHJvZmlsZS5sZXZlbCxcbiAgICAgICAgICAgICAgZmFjdG9yczogcmlza1Byb2ZpbGUuZmFjdG9ycyxcbiAgICAgICAgICAgICAgbGFzdEFzc2Vzc21lbnQ6IHJpc2tQcm9maWxlLmxhc3RBc3Nlc3NtZW50XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlZmVyZW5jZXM6IHtcbiAgICAgICAgICAgICAgbGFuZ3VhZ2U6IHByZWZlcmVuY2VzLmxhbmd1YWdlLFxuICAgICAgICAgICAgICB0aW1lem9uZTogcHJlZmVyZW5jZXMudGltZXpvbmUsXG4gICAgICAgICAgICAgIG5vdGlmaWNhdGlvbnM6IHByZWZlcmVuY2VzLm5vdGlmaWNhdGlvbnMsXG4gICAgICAgICAgICAgIHByaXZhY3k6IHByZWZlcmVuY2VzLnByaXZhY3lcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZXZpY2U6IHtcbiAgICAgICAgICAgICAgdHlwZTogZGV2aWNlSW5mby50eXBlLFxuICAgICAgICAgICAgICBwbGF0Zm9ybTogZGV2aWNlSW5mby5wbGF0Zm9ybSxcbiAgICAgICAgICAgICAgYnJvd3NlcjogZGV2aWNlSW5mby5icm93c2VyLFxuICAgICAgICAgICAgICBpcDogZGV2aWNlSW5mby5pcCxcbiAgICAgICAgICAgICAgbG9jYXRpb246IGRldmljZUluZm8ubG9jYXRpb24sXG4gICAgICAgICAgICAgIHRydXN0ZWQ6IGRldmljZUluZm8udHJ1c3RlZFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNlY3VyaXR5OiB7XG4gICAgICAgICAgICAgIHRocmVhdExldmVsOiByaXNrUHJvZmlsZS50aHJlYXRMZXZlbCxcbiAgICAgICAgICAgICAgYW5vbWFseUZsYWdzOiByaXNrUHJvZmlsZS5hbm9tYWxpZXMsXG4gICAgICAgICAgICAgIHRydXN0ZWREZXZpY2U6IGRldmljZUluZm8udHJ1c3RlZCxcbiAgICAgICAgICAgICAgdnBuRGV0ZWN0ZWQ6IGRldmljZUluZm8udnBuRGV0ZWN0ZWQsXG4gICAgICAgICAgICAgIG1mYVZlcmlmaWVkOiB0cnVlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2Vzc2lvbjoge1xuICAgICAgICAgICAgICBtZmFWZXJpZmllZDogdHJ1ZSxcbiAgICAgICAgICAgICAgZGV2aWNlVHJ1c3RlZDogZGV2aWNlSW5mby50cnVzdGVkLFxuICAgICAgICAgICAgICBzdGFydGVkQXQ6ICcyMDI0LTAxLTE1VDA4OjAwOjAwLjAwMFonXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBcbiAgICAgIC8vIE1vY2sgY29udHJvbGxlciB0aGF0IHVzZXMgdGhlIG1pZGRsZXdhcmVcbiAgICAgIGNsYXNzIFRlc3RDb250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gICAgICAgIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG5cblxuICAgICAgICBwcm90ZWN0ZWQgZ2V0TWlkZGxld2FyZXMoKTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmVbXSB7XG4gICAgICAgICAgcmV0dXJuIFtidXNpbmVzc0NvbnRleHRNaWRkbGV3YXJlXTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gVGVzdCByb3V0ZSB0aGF0IGNhbiBhY2Nlc3MgZW5oYW5jZWQgYWN0b3JcbiAgICAgICAgYXN5bmMgdGVzdFJvdXRlKF9yZXF1ZXN0OiBSZXF1ZXN0LCBfcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg6IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgICByZXR1cm4geyBhY3RvcjogY3R4LmFjdG9yIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gTW9jayBmdW5jdGlvbnNcbiAgICAgIGFzeW5jIGZ1bmN0aW9uIGZldGNoUmlza1Byb2ZpbGUoYWN0b3JJZD86IHN0cmluZykge1xuICAgICAgICBjb25zdCBwcm9maWxlcyA9IHtcbiAgICAgICAgICAnam9obi5kb2UnOiB7XG4gICAgICAgICAgICBzY29yZTogNzUsXG4gICAgICAgICAgICBsZXZlbDogJ21lZGl1bScsXG4gICAgICAgICAgICBmYWN0b3JzOiBbJ25ldy1kZXZpY2UnLCAndW51c3VhbC1sb2NhdGlvbiddLFxuICAgICAgICAgICAgbGFzdEFzc2Vzc21lbnQ6ICcyMDI0LTAxLTE1VDA5OjAwOjAwLjAwMFonLFxuICAgICAgICAgICAgdGhyZWF0TGV2ZWw6ICdsb3cnLFxuICAgICAgICAgICAgYW5vbWFsaWVzOiBbJ2xvZ2luLXRpbWUtdW51c3VhbCddXG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gcHJvZmlsZXNbYWN0b3JJZCBhcyBrZXlvZiB0eXBlb2YgcHJvZmlsZXNdIHx8IHtcbiAgICAgICAgICBzY29yZTogNTAsIGxldmVsOiAnbG93JywgZmFjdG9yczogW10sIGxhc3RBc3Nlc3NtZW50OiBudWxsLCB0aHJlYXRMZXZlbDogJ21pbmltYWwnLCBhbm9tYWxpZXM6IFtdXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBcbiAgICAgIGFzeW5jIGZ1bmN0aW9uIGZldGNoVXNlclByZWZlcmVuY2VzKGFjdG9ySWQ/OiBzdHJpbmcpIHtcbiAgICAgICAgY29uc3QgcHJlZmVyZW5jZXMgPSB7XG4gICAgICAgICAgJ2pvaG4uZG9lJzoge1xuICAgICAgICAgICAgbGFuZ3VhZ2U6ICdlbi1VUycsXG4gICAgICAgICAgICB0aW1lem9uZTogJ0FtZXJpY2EvTmV3X1lvcmsnLFxuICAgICAgICAgICAgbm90aWZpY2F0aW9uczogeyBlbWFpbDogdHJ1ZSwgc21zOiBmYWxzZSwgcHVzaDogdHJ1ZSB9LFxuICAgICAgICAgICAgcHJpdmFjeTogeyBhbmFseXRpY3M6IHRydWUsIG1hcmtldGluZzogZmFsc2UsIGNvb2tpZXM6ICdlc3NlbnRpYWwnIH1cbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiBwcmVmZXJlbmNlc1thY3RvcklkIGFzIGtleW9mIHR5cGVvZiBwcmVmZXJlbmNlc10gfHwge1xuICAgICAgICAgIGxhbmd1YWdlOiAnZW4tVVMnLCB0aW1lem9uZTogJ1VUQycsIG5vdGlmaWNhdGlvbnM6IHt9LCBwcml2YWN5OiB7fVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgXG4gICAgICBhc3luYyBmdW5jdGlvbiBmZXRjaERldmljZUNvbnRleHQoX3JlcXVlc3Q6IFJlcXVlc3QpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0eXBlOiAnZGVza3RvcCcsXG4gICAgICAgICAgcGxhdGZvcm06ICdXaW5kb3dzJyxcbiAgICAgICAgICBicm93c2VyOiAnQ2hyb21lJyxcbiAgICAgICAgICBpcDogJzE5Mi4xNjguMS4xMDAnLFxuICAgICAgICAgIGxvY2F0aW9uOiB7IGNvdW50cnk6ICdVUycsIGNpdHk6ICdOZXcgWW9yaycgfSxcbiAgICAgICAgICB0cnVzdGVkOiB0cnVlLFxuICAgICAgICAgIHZwbkRldGVjdGVkOiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBUZXN0IGV4ZWN1dGlvblxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICAuLi5jcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KCkucmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItMTIzJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnam9obi5kb2UnXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcigpO1xuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IGNvbnRyb2xsZXIubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY29udHJvbGxlci5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuICAgICAgY29uc3QgY3R4ID0gKGNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eChldmVudCwgY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuICAgICAgXG4gICAgICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgICAgIGF3YWl0IChjb250cm9sbGVyIGFzIGFueSkuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSBlbmhhbmNlZCBhY3RvciBjb250ZXh0XG4gICAgICBleHBlY3QoY3R4LmFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgYWN0b3JJZDogJ2pvaG4uZG9lJyxcbiAgICAgICAgXG4gICAgICAgIHJpc2tQcm9maWxlOiB7XG4gICAgICAgICAgc2NvcmU6IDc1LFxuICAgICAgICAgIGxldmVsOiAnbWVkaXVtJyxcbiAgICAgICAgICBmYWN0b3JzOiBbJ25ldy1kZXZpY2UnLCAndW51c3VhbC1sb2NhdGlvbiddLFxuICAgICAgICAgIGxhc3RBc3Nlc3NtZW50OiAnMjAyNC0wMS0xNVQwOTowMDowMC4wMDBaJ1xuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgcHJlZmVyZW5jZXM6IHtcbiAgICAgICAgICBsYW5ndWFnZTogJ2VuLVVTJyxcbiAgICAgICAgICB0aW1lem9uZTogJ0FtZXJpY2EvTmV3X1lvcmsnLFxuICAgICAgICAgIG5vdGlmaWNhdGlvbnM6IHsgZW1haWw6IHRydWUsIHNtczogZmFsc2UsIHB1c2g6IHRydWUgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgZGV2aWNlOiB7XG4gICAgICAgICAgdHlwZTogJ2Rlc2t0b3AnLFxuICAgICAgICAgIHBsYXRmb3JtOiAnV2luZG93cycsXG4gICAgICAgICAgYnJvd3NlcjogJ0Nocm9tZScsXG4gICAgICAgICAgdHJ1c3RlZDogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgc2VjdXJpdHk6IHtcbiAgICAgICAgICB0aHJlYXRMZXZlbDogJ2xvdycsXG4gICAgICAgICAgYW5vbWFseUZsYWdzOiBbJ2xvZ2luLXRpbWUtdW51c3VhbCddLFxuICAgICAgICAgIHRydXN0ZWREZXZpY2U6IHRydWUsXG4gICAgICAgICAgdnBuRGV0ZWN0ZWQ6IGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIGl0KCdzaG91bGQgZW5oYW5jZSBhY3RvciB3aXRoIHJlYWwtdGltZSBjb21wbGlhbmNlIGFuZCBhdWRpdCBjb250ZXh0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29tcGxpYW5jZU1pZGRsZXdhcmU6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlID0ge1xuICAgICAgICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdDogUmVxdWVzdCwgX3Jlc3BvbnNlOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkgPT4ge1xuICAgICAgICAgIGlmICghY3R4Py5hY3RvcikgcmV0dXJuO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIEZldGNoIGNvbXBsaWFuY2UgY29udGV4dFxuICAgICAgICAgIGNvbnN0IGNvbXBsaWFuY2VTdGF0dXMgPSBhd2FpdCBmZXRjaENvbXBsaWFuY2VTdGF0dXMoY3R4LmFjdG9yLmFjdG9ySWQsIGN0eC5hY3Rvci50ZW5hbnRJZCk7XG4gICAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gYXdhaXQgZmV0Y2hBdWRpdENvbnRleHQoY3R4LmFjdG9yLmFjdG9ySWQpO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFVzZSBmcmFtZXdvcmsgQVBJIHRvIGVuaGFuY2Ugd2l0aCBjb21wbGlhbmNlIGRhdGFcbiAgICAgICAgICBjdHguZW5oYW5jZUFjdG9yPy4oe1xuICAgICAgICAgICAgY29tcGxpYW5jZToge1xuICAgICAgICAgICAgICBzdGF0dXM6IGNvbXBsaWFuY2VTdGF0dXMuc3RhdHVzLFxuICAgICAgICAgICAgICBjZXJ0aWZpY2F0aW9uczogY29tcGxpYW5jZVN0YXR1cy5jZXJ0aWZpY2F0aW9ucyxcbiAgICAgICAgICAgICAgdmlvbGF0aW9uczogY29tcGxpYW5jZVN0YXR1cy52aW9sYXRpb25zLFxuICAgICAgICAgICAgICBsYXN0QXVkaXQ6IGNvbXBsaWFuY2VTdGF0dXMubGFzdEF1ZGl0LFxuICAgICAgICAgICAgICBuZXh0UmV2aWV3OiBjb21wbGlhbmNlU3RhdHVzLm5leHRSZXZpZXcsXG4gICAgICAgICAgICAgIGRhdGFDbGFzc2lmaWNhdGlvbnM6IGNvbXBsaWFuY2VTdGF0dXMuZGF0YUFjY2VzcyxcbiAgICAgICAgICAgICAgcmV0ZW50aW9uUG9saWNpZXM6IGNvbXBsaWFuY2VTdGF0dXMucmV0ZW50aW9uLFxuICAgICAgICAgICAgICBnZHByU3RhdHVzOiBjb21wbGlhbmNlU3RhdHVzLmdkcHIsXG4gICAgICAgICAgICAgIHNveENvbXBsaWFudDogY29tcGxpYW5jZVN0YXR1cy5zb3gsXG4gICAgICAgICAgICAgIGhpcGFhQWNjZXNzOiBjb21wbGlhbmNlU3RhdHVzLmhpcGFhXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgICAgdHJhaWxFbmFibGVkOiBhdWRpdENvbnRleHQuZW5hYmxlZCxcbiAgICAgICAgICAgICAgc2Vuc2l0aXZlT3BlcmF0aW9uczogYXVkaXRDb250ZXh0LnNlbnNpdGl2ZU9wcyxcbiAgICAgICAgICAgICAgcmV0ZW50aW9uUGVyaW9kOiBhdWRpdENvbnRleHQucmV0ZW50aW9uRGF5cyxcbiAgICAgICAgICAgICAgbGFzdEFjdGl2aXR5OiBhdWRpdENvbnRleHQubGFzdEFjdGl2aXR5LFxuICAgICAgICAgICAgICBoaWdoUmlza09wZXJhdGlvbnM6IGF1ZGl0Q29udGV4dC5oaWdoUmlzayxcbiAgICAgICAgICAgICAgYW5vbWFseURldGVjdGlvbjogYXVkaXRDb250ZXh0LmFub21hbHlEZXRlY3Rpb24sXG4gICAgICAgICAgICAgIHJlYWxUaW1lTW9uaXRvcmluZzogYXVkaXRDb250ZXh0LnJlYWxUaW1lXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBcbiAgICAgIGFzeW5jIGZ1bmN0aW9uIGZldGNoQ29tcGxpYW5jZVN0YXR1cyhfYWN0b3JJZD86IHN0cmluZywgX3RlbmFudElkPzogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdHVzOiAnY29tcGxpYW50JyxcbiAgICAgICAgICBjZXJ0aWZpY2F0aW9uczogWydJU08yNzAwMScsICdTT0MyLVR5cGUyJywgJ0dEUFInXSxcbiAgICAgICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgICAgICBsYXN0QXVkaXQ6ICcyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFonLFxuICAgICAgICAgIG5leHRSZXZpZXc6ICcyMDI0LTA3LTAxVDAwOjAwOjAwLjAwMFonLFxuICAgICAgICAgIGRhdGFBY2Nlc3M6IFsncHVibGljJywgJ2ludGVybmFsJywgJ2NvbmZpZGVudGlhbCddLFxuICAgICAgICAgIHJldGVudGlvbjogeyBsb2dzOiAyNTU1LCB1c2VyRGF0YTogMjE5MCwgZmluYW5jaWFsOiAyNTU1IH0sIC8vIGRheXNcbiAgICAgICAgICBnZHByOiB7IGxhd2Z1bEJhc2lzOiAnbGVnaXRpbWF0ZS1pbnRlcmVzdCcsIGRhdGFTdWJqZWN0OiB0cnVlIH0sXG4gICAgICAgICAgc294OiB7IGNlcnRpZmllZDogdHJ1ZSwgbGFzdENlcnRpZmljYXRpb246ICcyMDIzLTEyLTMxJyB9LFxuICAgICAgICAgIGhpcGFhOiB7IGF1dGhvcml6ZWQ6IGZhbHNlLCByZWFzb246ICduby1oZWFsdGhjYXJlLWRhdGEnIH1cbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgYXN5bmMgZnVuY3Rpb24gZmV0Y2hBdWRpdENvbnRleHQoX2FjdG9ySWQ/OiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNlbnNpdGl2ZU9wczogWyd1c2VyLmRlbGV0ZScsICdkYXRhLmV4cG9ydCcsICdhZG1pbi5hY2Nlc3MnXSxcbiAgICAgICAgICByZXRlbnRpb25EYXlzOiAyNTU1LCAvLyA3IHllYXJzXG4gICAgICAgICAgbGFzdEFjdGl2aXR5OiAnMjAyNC0wMS0xNVQwOToxNTowMC4wMDBaJyxcbiAgICAgICAgICBoaWdoUmlzazogWydmaW5hbmNpYWwuYXBwcm92ZScsICdzZWN1cml0eS5tb2RpZnknXSxcbiAgICAgICAgICBhbm9tYWx5RGV0ZWN0aW9uOiB0cnVlLFxuICAgICAgICAgIHJlYWxUaW1lOiB0cnVlXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNsYXNzIENvbXBsaWFuY2VDb250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gICAgICAgIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBMYW1iZGFDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgLy8gTm8tb3AgZm9yIHRlc3RpbmdcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdIHtcbiAgICAgICAgICByZXR1cm4gW2NvbXBsaWFuY2VNaWRkbGV3YXJlXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tBUElHYXRld2F5RXZlbnQoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIC4uLmNyZWF0ZU1vY2tBUElHYXRld2F5RXZlbnQoKS5yZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci0xMjMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdjb21wbGlhbmNlLm9mZmljZXInLFxuICAgICAgICAgICAgICAnY3VzdG9tOnRlbmFudElkJzogJ3JlZ3VsYXRlZC1jb21wYW55J1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQ29tcGxpYW5jZUNvbnRyb2xsZXIoKTtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCBjb250cm9sbGVyLm1ha2VSZXF1ZXN0Q29udGV4dChldmVudCwgY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNvbnRyb2xsZXIubWFrZVJlc3BvbnNlQ29udGV4dChyZXF1ZXN0KTtcbiAgICAgIGNvbnN0IGN0eCA9IChjb250cm9sbGVyIGFzIGFueSkuYnVpbGRDdHgoZXZlbnQsIGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCksIHJlcXVlc3QsIHJlc3BvbnNlKTtcbiAgICAgIFxuICAgICAgYXdhaXQgKGNvbnRyb2xsZXIgYXMgYW55KS5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGN0eC5hY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGFjdG9ySWQ6ICdjb21wbGlhbmNlLm9mZmljZXInLFxuICAgICAgICB0ZW5hbnRJZDogJ3JlZ3VsYXRlZC1jb21wYW55JyxcbiAgICAgICAgXG4gICAgICAgIGNvbXBsaWFuY2U6IHtcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGlhbnQnLFxuICAgICAgICAgIGNlcnRpZmljYXRpb25zOiBbJ0lTTzI3MDAxJywgJ1NPQzItVHlwZTInLCAnR0RQUiddLFxuICAgICAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgICAgIGRhdGFDbGFzc2lmaWNhdGlvbnM6IFsncHVibGljJywgJ2ludGVybmFsJywgJ2NvbmZpZGVudGlhbCddLFxuICAgICAgICAgIGdkcHJTdGF0dXM6IHsgbGF3ZnVsQmFzaXM6ICdsZWdpdGltYXRlLWludGVyZXN0JywgZGF0YVN1YmplY3Q6IHRydWUgfSxcbiAgICAgICAgICBzb3hDb21wbGlhbnQ6IHsgY2VydGlmaWVkOiB0cnVlLCBsYXN0Q2VydGlmaWNhdGlvbjogJzIwMjMtMTItMzEnIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgdHJhaWxFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNlbnNpdGl2ZU9wZXJhdGlvbnM6IFsndXNlci5kZWxldGUnLCAnZGF0YS5leHBvcnQnLCAnYWRtaW4uYWNjZXNzJ10sXG4gICAgICAgICAgcmV0ZW50aW9uUGVyaW9kOiAyNTU1LFxuICAgICAgICAgIGhpZ2hSaXNrT3BlcmF0aW9uczogWydmaW5hbmNpYWwuYXBwcm92ZScsICdzZWN1cml0eS5tb2RpZnknXSxcbiAgICAgICAgICBhbm9tYWx5RGV0ZWN0aW9uOiB0cnVlLFxuICAgICAgICAgIHJlYWxUaW1lTW9uaXRvcmluZzogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG4gIFxuICBkZXNjcmliZSgnQ29tYmluZWQgRW5oYW5jZW1lbnQ6IENvbnRyb2xsZXIgKyBNaWRkbGV3YXJlJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgc3VwcG9ydCBib3RoIGNvbnRyb2xsZXIgb3ZlcnJpZGUgYW5kIG1pZGRsZXdhcmUgZW5oYW5jZW1lbnQgdG9nZXRoZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDb250cm9sbGVyIGFkZHMgYnVzaW5lc3MgY29udGV4dFxuICAgICAgY2xhc3MgRW50ZXJwcmlzZUNvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgICAgICAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IExhbWJkYUNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICAvLyBOby1vcCBmb3IgdGVzdGluZ1xuICAgICAgICB9XG5cbiAgICAgICAgcHJvdGVjdGVkIGV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgcmVxdWVzdDogUmVxdWVzdCk6IEFjdG9yIHtcbiAgICAgICAgICBjb25zdCBiYXNlQWN0b3IgPSBzdXBlci5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcbiAgICAgICAgICBcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4uYmFzZUFjdG9yLFxuICAgICAgICAgICAgLy8gQ29udHJvbGxlciBhZGRzIGNvcmUgYnVzaW5lc3MgY29udGV4dFxuICAgICAgICAgICAgcm9sZXM6IFsnZW50ZXJwcmlzZS1hZG1pbicsICdmaW5hbmNlLWFwcHJvdmVyJ10sXG4gICAgICAgICAgICBkZXBhcnRtZW50OiAnZmluYW5jZScsXG4gICAgICAgICAgICBhcHByb3ZhbExpbWl0czogeyBmaW5hbmNpYWw6IDEwMDAwMDAgfVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgLy8gTWlkZGxld2FyZSAxOiBBZGQgc2Vzc2lvbiBjb250ZXh0XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0LCBfcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgICAgICAgICAgICAgIGN0eD8uZW5oYW5jZUFjdG9yPy4oe1xuICAgICAgICAgICAgICAgICAgc2Vzc2lvbjoge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ3Nlc3Npb24tMTIzNDUnLFxuICAgICAgICAgICAgICAgICAgICBzdGFydGVkQXQ6ICcyMDI0LTAxLTE1VDA4OjAwOjAwLjAwMFonLFxuICAgICAgICAgICAgICAgICAgICBtZmFWZXJpZmllZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgZGV2aWNlVHJ1c3RlZDogdHJ1ZVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gTWlkZGxld2FyZSAyOiBBZGQgcmVhbC10aW1lIHJpc2sgYXNzZXNzbWVudFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBiZWZvcmU6IGFzeW5jIChfcmVxdWVzdCwgX3Jlc3BvbnNlLCBjdHgpID0+IHtcbiAgICAgICAgICAgICAgICBjdHg/LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICAgICAgICAgICAgICAgIHJpc2tBc3Nlc3NtZW50OiB7XG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiAyNSwgLy8gbG93IHJpc2tcbiAgICAgICAgICAgICAgICAgICAgZmFjdG9yczogW10sXG4gICAgICAgICAgICAgICAgICAgIHJlY29tbWVuZGVkQWN0aW9uczogWydwcm9jZWVkJ10sXG4gICAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudCh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgLi4uY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudCgpLnJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLTEyMycsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2VudGVycHJpc2UuYWRtaW4nXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBFbnRlcnByaXNlQ29udHJvbGxlcigpO1xuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IGNvbnRyb2xsZXIubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY29udHJvbGxlci5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuICAgICAgY29uc3QgY3R4ID0gKGNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eChldmVudCwgY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuICAgICAgXG4gICAgICAvLyBFeGVjdXRlIG1pZGRsZXdhcmUgcGlwZWxpbmVcbiAgICAgIGF3YWl0IChjb250cm9sbGVyIGFzIGFueSkuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZSgnYmVmb3JlJywgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSBjb21iaW5lZCBlbmhhbmNlbWVudFxuICAgICAgZXhwZWN0KGN0eC5hY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIC8vIEJhc2UgZnJhbWV3b3JrIGNvbnRleHRcbiAgICAgICAgYWN0b3JJZDogJ2VudGVycHJpc2UuYWRtaW4nLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIFxuICAgICAgICAvLyBDb250cm9sbGVyIGVuaGFuY2VtZW50XG4gICAgICAgIHJvbGVzOiBbJ2VudGVycHJpc2UtYWRtaW4nLCAnZmluYW5jZS1hcHByb3ZlciddLFxuICAgICAgICBkZXBhcnRtZW50OiAnZmluYW5jZScsXG4gICAgICAgIGFwcHJvdmFsTGltaXRzOiB7IGZpbmFuY2lhbDogMTAwMDAwMCB9LFxuICAgICAgICBcbiAgICAgICAgLy8gTWlkZGxld2FyZSAxIGVuaGFuY2VtZW50XG4gICAgICAgIHNlc3Npb246IHtcbiAgICAgICAgICBpZDogJ3Nlc3Npb24tMTIzNDUnLFxuICAgICAgICAgIG1mYVZlcmlmaWVkOiB0cnVlLFxuICAgICAgICAgIGRldmljZVRydXN0ZWQ6IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vIE1pZGRsZXdhcmUgMiBlbmhhbmNlbWVudFxuICAgICAgICByaXNrQXNzZXNzbWVudDoge1xuICAgICAgICAgIHNjb3JlOiAyNSxcbiAgICAgICAgICBmYWN0b3JzOiBbXSxcbiAgICAgICAgICByZWNvbW1lbmRlZEFjdGlvbnM6IFsncHJvY2VlZCddXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICAvLyBWZXJpZnkgdGltZXN0YW1wcyBhcmUgcmVjZW50IChtaWRkbGV3YXJlIDIgYWRkcyBjdXJyZW50IHRpbWUpXG4gICAgICBleHBlY3QobmV3IERhdGUoY3R4LmFjdG9yLnJpc2tBc3Nlc3NtZW50LnRpbWVzdGFtcCkuZ2V0VGltZSgpKVxuICAgICAgICAudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==