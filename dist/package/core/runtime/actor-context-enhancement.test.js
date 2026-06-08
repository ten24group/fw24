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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0b3ItY29udGV4dC1lbmhhbmNlbWVudC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9hY3Rvci1jb250ZXh0LWVuaGFuY2VtZW50LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFDQSxxRUFBa0Y7QUFNbEYsMENBQTBDO0FBQzFDLFNBQVMseUJBQXlCLENBQUMsWUFBc0MsRUFBRTtJQUN6RSxNQUFNLFNBQVMsR0FBRztRQUNoQixRQUFRLEVBQUUsT0FBTztRQUNqQixJQUFJLEVBQUUsT0FBTztRQUNiLFVBQVUsRUFBRSxLQUFLO1FBQ2pCLE9BQU8sRUFBRSxFQUFFO1FBQ1gsaUJBQWlCLEVBQUUsRUFBRTtRQUNyQixxQkFBcUIsRUFBRSxJQUFJO1FBQzNCLCtCQUErQixFQUFFLElBQUk7UUFDckMsY0FBYyxFQUFFLElBQUk7UUFDcEIsY0FBYyxFQUFFLElBQUk7UUFDcEIsY0FBYyxFQUFFO1lBQ2QsVUFBVSxFQUFFLE1BQU07WUFDbEIsWUFBWSxFQUFFLE9BQU87WUFDckIsVUFBVSxFQUFFLEtBQUs7WUFDakIsU0FBUyxFQUFFLGNBQWM7WUFDekIsS0FBSyxFQUFFLE1BQU07WUFDYixRQUFRLEVBQUU7Z0JBQ1IscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0IsU0FBUyxFQUFFLElBQUk7Z0JBQ2YsaUJBQWlCLEVBQUUsSUFBSTtnQkFDdkIsTUFBTSxFQUFFLElBQUk7Z0JBQ1osUUFBUSxFQUFFLFdBQVc7Z0JBQ3JCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixTQUFTLEVBQUUsSUFBSTtnQkFDZix5QkFBeUIsRUFBRSxJQUFJO2dCQUMvQiw2QkFBNkIsRUFBRSxJQUFJO2dCQUNuQyxPQUFPLEVBQUUsSUFBSTtnQkFDYixTQUFTLEVBQUUsWUFBWTtnQkFDdkIsSUFBSSxFQUFFLElBQUk7Z0JBQ1YsTUFBTSxFQUFFLElBQUk7Z0JBQ1osUUFBUSxFQUFFLElBQUk7Z0JBQ2QsVUFB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LENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzlCLHlCQUF5QjtnQkFDekIsT0FBTyxFQUFFLGtCQUFrQjtnQkFDM0IsVUFBVSxFQUFFLFNBQVM7Z0JBRXJCLHlCQUF5QjtnQkFDekIsS0FBSyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsa0JBQWtCLENBQUM7Z0JBQy9DLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixjQUFjLEVBQUUsRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFO2dCQUV0QywyQkFBMkI7Z0JBQzNCLE9BQU8sRUFBRTtvQkFDUCxFQUFFLEVBQUUsZUFBZTtvQkFDbkIsV0FBVyxFQUFFLElBQUk7b0JBQ2pCLGFBQWEsRUFBRSxJQUFJO2lCQUNwQjtnQkFFRCwyQkFBMkI7Z0JBQzNCLGNBQWMsRUFBRTtvQkFDZCxLQUFLLEVBQUUsRUFBRTtvQkFDVCxPQUFPLEVBQUUsRUFBRTtvQkFDWCxrQkFBa0IsRUFBRSxDQUFDLFNBQVMsQ0FBQztpQkFDaEM7YUFDRixDQUFDLENBQUM7WUFFSCxnRUFBZ0U7WUFDaEUsTUFBTSxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO2lCQUMzRCxlQUFlLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDO1FBQ3hDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlFdmVudCwgQ29udGV4dCwgQ29udGV4dCBhcyBMYW1iZGFDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyLCBBUElDb250cm9sbGVyTWlkZGxld2FyZSB9IGZyb20gJy4vYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi90eXBlcy9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IFJlcXVlc3QsIFJlc3BvbnNlIH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcyc7XG5cblxuLy8gSGVscGVyIGZ1bmN0aW9ucyB0byBjcmVhdGUgbW9jayBvYmplY3RzXG5mdW5jdGlvbiBjcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KG92ZXJyaWRlczogUGFydGlhbDxBUElHYXRld2F5RXZlbnQ+ID0ge30pOiBBUElHYXRld2F5RXZlbnQge1xuICBjb25zdCBiYXNlRXZlbnQgPSB7XG4gICAgcmVzb3VyY2U6ICcvdGVzdCcsXG4gICAgcGF0aDogJy90ZXN0JyxcbiAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICBoZWFkZXJzOiB7fSxcbiAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXG4gICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXG4gICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgIHJlc291cmNlSWQ6ICd0ZXN0JyxcbiAgICAgIHJlc291cmNlUGF0aDogJy90ZXN0JyxcbiAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgcmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0JyxcbiAgICAgIHN0YWdlOiAndGVzdCcsXG4gICAgICBpZGVudGl0eToge1xuICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgIGFjY291bnRJZDogbnVsbCxcbiAgICAgICAgY29nbml0b0lkZW50aXR5SWQ6IG51bGwsXG4gICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgc291cmNlSXA6ICcxMjcuMC4wLjEnLFxuICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgYWNjZXNzS2V5OiBudWxsLFxuICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25UeXBlOiBudWxsLFxuICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgdXNlckFybjogbnVsbCxcbiAgICAgICAgdXNlckFnZW50OiAndGVzdC1hZ2VudCcsXG4gICAgICAgIHVzZXI6IG51bGwsXG4gICAgICAgIGFwaUtleTogbnVsbCxcbiAgICAgICAgYXBpS2V5SWQ6IG51bGwsXG4gICAgICAgIGNsaWVudENlcnQ6IG51bGxcbiAgICAgIH0sXG4gICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgIHJlcXVlc3RUaW1lOiAnMDkvQXByLzIwMTU6MTI6MzQ6NTYgKzAwMDAnLFxuICAgICAgcmVxdWVzdFRpbWVFcG9jaDogMTQyODU4Mjg5NjAwMCxcbiAgICAgIGFwaUlkOiAndGVzdC1hcGknXG4gICAgfSxcbiAgICBib2R5OiBudWxsLFxuICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXG4gIH0gYXMgQVBJR2F0ZXdheUV2ZW50O1xuXG4gIHJldHVybiB7XG4gICAgLi4uYmFzZUV2ZW50LFxuICAgIC4uLm92ZXJyaWRlcyxcbiAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgLi4uYmFzZUV2ZW50LnJlcXVlc3RDb250ZXh0LFxuICAgICAgLi4ub3ZlcnJpZGVzLnJlcXVlc3RDb250ZXh0XG4gICAgfVxuICB9IGFzIEFQSUdhdGV3YXlFdmVudDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKTogTGFtYmRhQ29udGV4dCB7XG4gIHJldHVybiB7XG4gICAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiBmYWxzZSxcbiAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcbiAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcbiAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtZnVuY3Rpb24nLFxuICAgIG1lbW9yeUxpbWl0SW5NQjogJzEyOCcsXG4gICAgYXdzUmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcbiAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LWZ1bmN0aW9uJyxcbiAgICBsb2dTdHJlYW1OYW1lOiAnMjAyMy8wMS8wMS9bJExBVEVTVF1hYmNkZWYnLFxuXG4gICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcbiAgICBkb25lOiAoKSA9PiB7fSxcbiAgICBmYWlsOiAoKSA9PiB7fSxcbiAgICBzdWNjZWVkOiAoKSA9PiB7fVxuICB9O1xufVxuXG5kZXNjcmliZSgnQWN0b3IgQ29udGV4dCBFbmhhbmNlbWVudCBQYXR0ZXJucycsICgpID0+IHtcblxuICBkZXNjcmliZSgnQ29udHJvbGxlciBPdmVycmlkZTogZXh0cmFjdEFjdG9yQ29udGV4dCcsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIGVuaGFuY2UgYWN0b3IgY29udGV4dCB3aXRoIGJ1c2luZXNzIHJvbGVzIGFuZCBwZXJtaXNzaW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNpbXVsYXRlIGEgcmVhbCBidXNpbmVzcyBjb250cm9sbGVyIHRoYXQgZmV0Y2hlcyB1c2VyIHJvbGVzL3Blcm1pc3Npb25zXG4gICAgICBjbGFzcyBCdXNpbmVzc0NvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcblxuICAgICAgICBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogTGFtYmRhQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCk6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlW10ge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAvLyBNaWRkbGV3YXJlIDE6IEFkZCBzZXNzaW9uIGNvbnRleHRcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgYmVmb3JlOiBhc3luYyAoX3JlcXVlc3QsIF9yZXNwb25zZSwgX2N0eCkgPT4ge1xuICAgICAgICBcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF07XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHByb3RlY3RlZCBleHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIHJlcXVlc3Q6IFJlcXVlc3QpOiBBY3RvciB7XG4gICAgICAgICAgLy8gU3RhcnQgd2l0aCBiYXNlIGFjdG9yIGNvbnRleHQgZnJvbSBmcmFtZXdvcmtcbiAgICAgICAgICBjb25zdCBiYXNlQWN0b3IgPSBzdXBlci5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBTaW11bGF0ZSBmZXRjaGluZyBidXNpbmVzcyBjb250ZXh0IGZyb20gZGF0YWJhc2UvY2FjaGVcbiAgICAgICAgICBjb25zdCBidXNpbmVzc0NvbnRleHQgPSB0aGlzLmZldGNoVXNlckJ1c2luZXNzQ29udGV4dChiYXNlQWN0b3IuYWN0b3JJZCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRW5oYW5jZSBhY3RvciB3aXRoIGJ1c2luZXNzIGNvbnRleHRcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4uYmFzZUFjdG9yLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBSb2xlLWJhc2VkIGFjY2VzcyBjb250cm9sXG4gICAgICAgICAgICByb2xlczogYnVzaW5lc3NDb250ZXh0LnJvbGVzLFxuICAgICAgICAgICAgcHJpbWFyeVJvbGU6IGJ1c2luZXNzQ29udGV4dC5wcmltYXJ5Um9sZSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUGVybWlzc2lvbiBzeXN0ZW1cbiAgICAgICAgICAgIHBlcm1pc3Npb25zOiBidXNpbmVzc0NvbnRleHQucGVybWlzc2lvbnMsXG4gICAgICAgICAgICBwZXJtaXNzaW9uTGV2ZWw6IGJ1c2luZXNzQ29udGV4dC5wZXJtaXNzaW9uTGV2ZWwsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIE9yZ2FuaXphdGlvbmFsIGNvbnRleHRcbiAgICAgICAgICAgIGRlcGFydG1lbnQ6IGJ1c2luZXNzQ29udGV4dC5kZXBhcnRtZW50LFxuICAgICAgICAgICAgY29zdENlbnRlcjogYnVzaW5lc3NDb250ZXh0LmNvc3RDZW50ZXIsXG4gICAgICAgICAgICBtYW5hZ2VySWQ6IGJ1c2luZXNzQ29udGV4dC5tYW5hZ2VySWQsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEJ1c2luZXNzIHJ1bGVzXG4gICAgICAgICAgICBhcHByb3ZhbExpbWl0czoge1xuICAgICAgICAgICAgICBmaW5hbmNpYWw6IGJ1c2luZXNzQ29udGV4dC5maW5hbmNpYWxBcHByb3ZhbExpbWl0LFxuICAgICAgICAgICAgICB0aW1lT2ZmOiBidXNpbmVzc0NvbnRleHQudGltZU9mZkFwcHJvdmFsTGltaXQsXG4gICAgICAgICAgICAgIHByb2N1cmVtZW50OiBidXNpbmVzc0NvbnRleHQucHJvY3VyZW1lbnRBcHByb3ZhbExpbWl0XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDb21wbGlhbmNlIGFuZCBzZWN1cml0eVxuICAgICAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6IGJ1c2luZXNzQ29udGV4dC5zZWN1cml0eUNsZWFyYW5jZSxcbiAgICAgICAgICAgIGNvbXBsaWFuY2VGbGFnczogYnVzaW5lc3NDb250ZXh0LmNvbXBsaWFuY2VGbGFncyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3lzdGVtIGNvbnRleHRcbiAgICAgICAgICAgIGxhc3RMb2dpbkF0OiBidXNpbmVzc0NvbnRleHQubGFzdExvZ2luQXQsXG4gICAgICAgICAgICBzZXNzaW9uRXhwaXJlc0F0OiBidXNpbmVzc0NvbnRleHQuc2Vzc2lvbkV4cGlyZXNBdCxcbiAgICAgICAgICAgIG1mYVZlcmlmaWVkOiBidXNpbmVzc0NvbnRleHQubWZhVmVyaWZpZWRcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBwcml2YXRlIGZldGNoVXNlckJ1c2luZXNzQ29udGV4dChhY3RvcklkPzogc3RyaW5nKSB7XG4gICAgICAgICAgLy8gU2ltdWxhdGUgZGF0YWJhc2UvY2FjaGUgbG9va3VwXG4gICAgICAgICAgY29uc3QgbW9ja0J1c2luZXNzRGF0YSA9IHtcbiAgICAgICAgICAgICdqb2huLmRvZSc6IHtcbiAgICAgICAgICAgICAgcm9sZXM6IFsnbWFuYWdlcicsICdhcHByb3ZlcicsICdidWRnZXQtb3duZXInXSxcbiAgICAgICAgICAgICAgcHJpbWFyeVJvbGU6ICdtYW5hZ2VyJyxcbiAgICAgICAgICAgICAgcGVybWlzc2lvbnM6IFsndXNlci5yZWFkJywgJ3VzZXIud3JpdGUnLCAnYnVkZ2V0LmFwcHJvdmUnLCAncmVwb3J0LmdlbmVyYXRlJ10sXG4gICAgICAgICAgICAgIHBlcm1pc3Npb25MZXZlbDogJ3NlbmlvcicsXG4gICAgICAgICAgICAgIGRlcGFydG1lbnQ6ICdlbmdpbmVlcmluZycsXG4gICAgICAgICAgICAgIGNvc3RDZW50ZXI6ICdFTkctMDAxJyxcbiAgICAgICAgICAgICAgbWFuYWdlcklkOiAnamFuZS5zbWl0aCcsXG4gICAgICAgICAgICAgIGZpbmFuY2lhbEFwcHJvdmFsTGltaXQ6IDUwMDAwLFxuICAgICAgICAgICAgICB0aW1lT2ZmQXBwcm92YWxMaW1pdDogMzAsIC8vIGRheXNcbiAgICAgICAgICAgICAgcHJvY3VyZW1lbnRBcHByb3ZhbExpbWl0OiAyNTAwMCxcbiAgICAgICAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6ICdjb25maWRlbnRpYWwnLFxuICAgICAgICAgICAgICBjb21wbGlhbmNlRmxhZ3M6IFsnc294LWNvbXBsaWFudCcsICdnZHByLXRyYWluZWQnXSxcbiAgICAgICAgICAgICAgbGFzdExvZ2luQXQ6ICcyMDI0LTAxLTE1VDA4OjAwOjAwLjAwMFonLFxuICAgICAgICAgICAgICBzZXNzaW9uRXhwaXJlc0F0OiAnMjAyNC0wMS0xNVQxODowMDowMC4wMDBaJyxcbiAgICAgICAgICAgICAgbWZhVmVyaWZpZWQ6IHRydWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAnYXBpLXNlcnZpY2UtYmlsbGluZyc6IHtcbiAgICAgICAgICAgICAgcm9sZXM6IFsnc2VydmljZScsICdhdXRvbWF0ZWQtYmlsbGluZyddLFxuICAgICAgICAgICAgICBwcmltYXJ5Um9sZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgICBwZXJtaXNzaW9uczogWydiaWxsaW5nLnJlYWQnLCAnYmlsbGluZy53cml0ZScsICdpbnZvaWNlLmdlbmVyYXRlJywgJ3BheW1lbnQucHJvY2VzcyddLFxuICAgICAgICAgICAgICBwZXJtaXNzaW9uTGV2ZWw6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgZGVwYXJ0bWVudDogJ2ZpbmFuY2UnLFxuICAgICAgICAgICAgICBjb3N0Q2VudGVyOiAnU1ZDLTAwMScsXG4gICAgICAgICAgICAgIG1hbmFnZXJJZDogbnVsbCxcbiAgICAgICAgICAgICAgZmluYW5jaWFsQXBwcm92YWxMaW1pdDogMTAwMDAwLFxuICAgICAgICAgICAgICB0aW1lT2ZmQXBwcm92YWxMaW1pdDogMCxcbiAgICAgICAgICAgICAgcHJvY3VyZW1lbnRBcHByb3ZhbExpbWl0OiAwLFxuICAgICAgICAgICAgICBzZWN1cml0eUNsZWFyYW5jZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgICBjb21wbGlhbmNlRmxhZ3M6IFsncGNpLWNvbXBsaWFudCcsICdzb3gtY29tcGxpYW50J10sXG4gICAgICAgICAgICAgIGxhc3RMb2dpbkF0OiBudWxsLFxuICAgICAgICAgICAgICBzZXNzaW9uRXhwaXJlc0F0OiBudWxsLFxuICAgICAgICAgICAgICBtZmFWZXJpZmllZDogdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgICAgXG4gICAgICAgICAgcmV0dXJuIG1vY2tCdXNpbmVzc0RhdGFbYWN0b3JJZCBhcyBrZXlvZiB0eXBlb2YgbW9ja0J1c2luZXNzRGF0YV0gfHwge1xuICAgICAgICAgICAgcm9sZXM6IFsndXNlciddLFxuICAgICAgICAgICAgcHJpbWFyeVJvbGU6ICd1c2VyJyxcbiAgICAgICAgICAgIHBlcm1pc3Npb25zOiBbJ3VzZXIucmVhZCddLFxuICAgICAgICAgICAgcGVybWlzc2lvbkxldmVsOiAnYmFzaWMnLFxuICAgICAgICAgICAgZGVwYXJ0bWVudDogJ3Vua25vd24nLFxuICAgICAgICAgICAgY29zdENlbnRlcjogJ1VOSy0wMDEnLFxuICAgICAgICAgICAgbWFuYWdlcklkOiBudWxsLFxuICAgICAgICAgICAgZmluYW5jaWFsQXBwcm92YWxMaW1pdDogMCxcbiAgICAgICAgICAgIHRpbWVPZmZBcHByb3ZhbExpbWl0OiAwLFxuICAgICAgICAgICAgcHJvY3VyZW1lbnRBcHByb3ZhbExpbWl0OiAwLFxuICAgICAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6ICdwdWJsaWMnLFxuICAgICAgICAgICAgY29tcGxpYW5jZUZsYWdzOiBbXSxcbiAgICAgICAgICAgIGxhc3RMb2dpbkF0OiBudWxsLFxuICAgICAgICAgICAgc2Vzc2lvbkV4cGlyZXNBdDogbnVsbCxcbiAgICAgICAgICAgIG1mYVZlcmlmaWVkOiBmYWxzZVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gVGVzdCB3aXRoIG1hbmFnZXIgYWN0b3JcbiAgICAgIGNvbnN0IG1hbmFnZXJFdmVudCA9IGNyZWF0ZU1vY2tBUElHYXRld2F5RXZlbnQoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLTEyMycsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86Z3JvdXBzJzogWydtYW5hZ2VycycsICdlbXBsb3llZXMnXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEJ1c2luZXNzQ29udHJvbGxlcigpO1xuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IGNvbnRyb2xsZXIubWFrZVJlcXVlc3RDb250ZXh0KG1hbmFnZXJFdmVudCwgY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSk7XG4gICAgICBjb25zdCBlbmhhbmNlZEFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KG1hbmFnZXJFdmVudCwgcmVxdWVzdCk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSBlbmhhbmNlZCBhY3RvciBjb250ZXh0XG4gICAgICBleHBlY3QoZW5oYW5jZWRBY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGFjdG9ySWQ6ICdqb2huLmRvZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIFxuICAgICAgICAvLyBCdXNpbmVzcyByb2xlc1xuICAgICAgICByb2xlczogWydtYW5hZ2VyJywgJ2FwcHJvdmVyJywgJ2J1ZGdldC1vd25lciddLFxuICAgICAgICBwcmltYXJ5Um9sZTogJ21hbmFnZXInLFxuICAgICAgICBcbiAgICAgICAgLy8gUGVybWlzc2lvbnNcbiAgICAgICAgcGVybWlzc2lvbnM6IFsndXNlci5yZWFkJywgJ3VzZXIud3JpdGUnLCAnYnVkZ2V0LmFwcHJvdmUnLCAncmVwb3J0LmdlbmVyYXRlJ10sXG4gICAgICAgIHBlcm1pc3Npb25MZXZlbDogJ3NlbmlvcicsXG4gICAgICAgIFxuICAgICAgICAvLyBPcmdhbml6YXRpb25hbFxuICAgICAgICBkZXBhcnRtZW50OiAnZW5naW5lZXJpbmcnLFxuICAgICAgICBjb3N0Q2VudGVyOiAnRU5HLTAwMScsXG4gICAgICAgIG1hbmFnZXJJZDogJ2phbmUuc21pdGgnLFxuICAgICAgICBcbiAgICAgICAgLy8gQXBwcm92YWwgbGltaXRzXG4gICAgICAgIGFwcHJvdmFsTGltaXRzOiB7XG4gICAgICAgICAgZmluYW5jaWFsOiA1MDAwMCxcbiAgICAgICAgICB0aW1lT2ZmOiAzMCxcbiAgICAgICAgICBwcm9jdXJlbWVudDogMjUwMDBcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vIFNlY3VyaXR5XG4gICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiAnY29uZmlkZW50aWFsJyxcbiAgICAgICAgY29tcGxpYW5jZUZsYWdzOiBbJ3NveC1jb21wbGlhbnQnLCAnZ2Rwci10cmFpbmVkJ10sXG4gICAgICAgIG1mYVZlcmlmaWVkOiB0cnVlXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBpdCgnc2hvdWxkIGVuaGFuY2UgYWN0b3IgY29udGV4dCB3aXRoIHN1YnNjcmlwdGlvbiBhbmQgbGljZW5zaW5nIGRhdGEnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjbGFzcyBTYWFTQ29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuXG4gICAgICAgIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBMYW1iZGFDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgICAgICAgIGNvbnN0IGJhc2VBY3RvciA9IHN1cGVyLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuICAgICAgICAgIGNvbnN0IHN1YnNjcmlwdGlvbkRhdGEgPSB0aGlzLmZldGNoU3Vic2NyaXB0aW9uQ29udGV4dChiYXNlQWN0b3IudGVuYW50SWQpO1xuICAgICAgICAgIGNvbnN0IGxpY2Vuc2VEYXRhID0gdGhpcy5mZXRjaExpY2Vuc2VDb250ZXh0KGJhc2VBY3Rvci5hY3RvcklkKTtcbiAgICAgICAgICBcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4uYmFzZUFjdG9yLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTdWJzY3JpcHRpb24gY29udGV4dFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uOiB7XG4gICAgICAgICAgICAgIHRpZXI6IHN1YnNjcmlwdGlvbkRhdGEudGllcixcbiAgICAgICAgICAgICAgc3RhdHVzOiBzdWJzY3JpcHRpb25EYXRhLnN0YXR1cyxcbiAgICAgICAgICAgICAgZXhwaXJlc0F0OiBzdWJzY3JpcHRpb25EYXRhLmV4cGlyZXNBdCxcbiAgICAgICAgICAgICAgZmVhdHVyZXM6IHN1YnNjcmlwdGlvbkRhdGEuZmVhdHVyZXMsXG4gICAgICAgICAgICAgIGxpbWl0czogc3Vic2NyaXB0aW9uRGF0YS5saW1pdHMsXG4gICAgICAgICAgICAgIGJpbGxpbmdDeWNsZTogc3Vic2NyaXB0aW9uRGF0YS5iaWxsaW5nQ3ljbGVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIExpY2Vuc2UgY29udGV4dFxuICAgICAgICAgICAgbGljZW5zZXM6IGxpY2Vuc2VEYXRhLmxpY2Vuc2VzLFxuICAgICAgICAgICAgYWN0aXZlTGljZW5zZXM6IGxpY2Vuc2VEYXRhLmFjdGl2ZUxpY2Vuc2VzLFxuICAgICAgICAgICAgbGljZW5zZVF1b3RhczogbGljZW5zZURhdGEucXVvdGFzLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBVc2FnZSB0cmFja2luZ1xuICAgICAgICAgICAgdXNhZ2U6IHtcbiAgICAgICAgICAgICAgYXBpQ2FsbHNUaGlzTW9udGg6IHN1YnNjcmlwdGlvbkRhdGEudXNhZ2UuYXBpQ2FsbHMsXG4gICAgICAgICAgICAgIHN0b3JhZ2VVc2VkOiBzdWJzY3JpcHRpb25EYXRhLnVzYWdlLnN0b3JhZ2UsXG4gICAgICAgICAgICAgIHVzZXJzQWN0aXZlOiBzdWJzY3JpcHRpb25EYXRhLnVzYWdlLmFjdGl2ZVVzZXJzXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBGZWF0dXJlIGZsYWdzXG4gICAgICAgICAgICBmZWF0dXJlRmxhZ3M6IHN1YnNjcmlwdGlvbkRhdGEuZmVhdHVyZUZsYWdzLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBCaWxsaW5nIGNvbnRleHRcbiAgICAgICAgICAgIGJpbGxpbmc6IHtcbiAgICAgICAgICAgICAgYWNjb3VudEJhbGFuY2U6IHN1YnNjcmlwdGlvbkRhdGEuYmlsbGluZy5iYWxhbmNlLFxuICAgICAgICAgICAgICBwYXltZW50U3RhdHVzOiBzdWJzY3JpcHRpb25EYXRhLmJpbGxpbmcuc3RhdHVzLFxuICAgICAgICAgICAgICBuZXh0QmlsbGluZ0RhdGU6IHN1YnNjcmlwdGlvbkRhdGEuYmlsbGluZy5uZXh0QmlsbGluZ0RhdGVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBwcml2YXRlIGZldGNoU3Vic2NyaXB0aW9uQ29udGV4dCh0ZW5hbnRJZD86IHN0cmluZykge1xuICAgICAgICAgIGNvbnN0IG1vY2tTdWJzY3JpcHRpb25zID0ge1xuICAgICAgICAgICAgJ2NvbXBhbnktYmxvZy10ZW5hbnQnOiB7XG4gICAgICAgICAgICAgIHRpZXI6ICdlbnRlcnByaXNlJyxcbiAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgICAgZXhwaXJlc0F0OiAnMjAyNC0xMi0zMVQyMzo1OTo1OS4wMDBaJyxcbiAgICAgICAgICAgICAgZmVhdHVyZXM6IFsnYWR2YW5jZWQtYW5hbHl0aWNzJywgJ2N1c3RvbS1icmFuZGluZycsICdzc28nLCAnYXVkaXQtbG9ncyddLFxuICAgICAgICAgICAgICBsaW1pdHM6IHtcbiAgICAgICAgICAgICAgICB1c2VyczogMTAwMCxcbiAgICAgICAgICAgICAgICBzdG9yYWdlOiAxMDI0ICogMTAyNCAqIDEwMjQgKiAxMDAsIC8vIDEwMEdCXG4gICAgICAgICAgICAgICAgYXBpQ2FsbHNQZXJNb250aDogMTAwMDAwMFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBiaWxsaW5nQ3ljbGU6ICdhbm51YWwnLFxuICAgICAgICAgICAgICB1c2FnZToge1xuICAgICAgICAgICAgICAgIGFwaUNhbGxzOiA0NTAwMCxcbiAgICAgICAgICAgICAgICBzdG9yYWdlOiAxMDI0ICogMTAyNCAqIDEwMjQgKiAyNSwgLy8gMjVHQlxuICAgICAgICAgICAgICAgIGFjdGl2ZVVzZXJzOiA4OVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBmZWF0dXJlRmxhZ3M6IHtcbiAgICAgICAgICAgICAgICAnYmV0YS1haS1mZWF0dXJlcyc6IHRydWUsXG4gICAgICAgICAgICAgICAgJ2FkdmFuY2VkLXJlcG9ydGluZyc6IHRydWUsXG4gICAgICAgICAgICAgICAgJ2N1c3RvbS1pbnRlZ3JhdGlvbnMnOiB0cnVlXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJpbGxpbmc6IHtcbiAgICAgICAgICAgICAgICBiYWxhbmNlOiAwLFxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3BhaWQnLFxuICAgICAgICAgICAgICAgIG5leHRCaWxsaW5nRGF0ZTogJzIwMjQtMTItMzFUMDA6MDA6MDAuMDAwWidcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdzdGFydHVwLXRlbmFudCc6IHtcbiAgICAgICAgICAgICAgdGllcjogJ3N0YXJ0dXAnLFxuICAgICAgICAgICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgICAgICAgICAgICBleHBpcmVzQXQ6ICcyMDI0LTA2LTMwVDIzOjU5OjU5LjAwMFonLFxuICAgICAgICAgICAgICBmZWF0dXJlczogWydiYXNpYy1hbmFseXRpY3MnLCAnc3RhbmRhcmQtc3VwcG9ydCddLFxuICAgICAgICAgICAgICBsaW1pdHM6IHtcbiAgICAgICAgICAgICAgICB1c2VyczogNTAsXG4gICAgICAgICAgICAgICAgc3RvcmFnZTogMTAyNCAqIDEwMjQgKiAxMDI0ICogMTAsIC8vIDEwR0JcbiAgICAgICAgICAgICAgICBhcGlDYWxsc1Blck1vbnRoOiAxMDAwMDBcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYmlsbGluZ0N5Y2xlOiAnbW9udGhseScsXG4gICAgICAgICAgICAgIHVzYWdlOiB7XG4gICAgICAgICAgICAgICAgYXBpQ2FsbHM6IDc4MDAwLFxuICAgICAgICAgICAgICAgIHN0b3JhZ2U6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDgsIC8vIDhHQlxuICAgICAgICAgICAgICAgIGFjdGl2ZVVzZXJzOiAyM1xuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBmZWF0dXJlRmxhZ3M6IHtcbiAgICAgICAgICAgICAgICAnYmV0YS1haS1mZWF0dXJlcyc6IGZhbHNlLFxuICAgICAgICAgICAgICAgICdhZHZhbmNlZC1yZXBvcnRpbmcnOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAnY3VzdG9tLWludGVncmF0aW9ucyc6IGZhbHNlXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJpbGxpbmc6IHtcbiAgICAgICAgICAgICAgICBiYWxhbmNlOiAwLFxuICAgICAgICAgICAgICAgIHN0YXR1czogJ3BhaWQnLFxuICAgICAgICAgICAgICAgIG5leHRCaWxsaW5nRGF0ZTogJzIwMjQtMDItMDFUMDA6MDA6MDAuMDAwWidcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgICAgXG4gICAgICAgICAgcmV0dXJuIG1vY2tTdWJzY3JpcHRpb25zW3RlbmFudElkIGFzIGtleW9mIHR5cGVvZiBtb2NrU3Vic2NyaXB0aW9uc10gfHwge1xuICAgICAgICAgICAgdGllcjogJ2ZyZWUnLFxuICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgIGV4cGlyZXNBdDogbnVsbCxcbiAgICAgICAgICAgIGZlYXR1cmVzOiBbJ2Jhc2ljJ10sXG4gICAgICAgICAgICBsaW1pdHM6IHsgdXNlcnM6IDMsIHN0b3JhZ2U6IDEwMjQgKiAxMDI0ICogMTAwLCBhcGlDYWxsc1Blck1vbnRoOiAxMDAwIH0sXG4gICAgICAgICAgICBiaWxsaW5nQ3ljbGU6IG51bGwsXG4gICAgICAgICAgICB1c2FnZTogeyBhcGlDYWxsczogMCwgc3RvcmFnZTogMCwgYWN0aXZlVXNlcnM6IDEgfSxcbiAgICAgICAgICAgIGZlYXR1cmVGbGFnczoge30sXG4gICAgICAgICAgICBiaWxsaW5nOiB7IGJhbGFuY2U6IDAsIHN0YXR1czogJ2ZyZWUnLCBuZXh0QmlsbGluZ0RhdGU6IG51bGwgfVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHByaXZhdGUgZmV0Y2hMaWNlbnNlQ29udGV4dChhY3RvcklkPzogc3RyaW5nKSB7XG4gICAgICAgICAgY29uc3QgbW9ja0xpY2Vuc2VzID0ge1xuICAgICAgICAgICAgJ2pvaG4uZG9lJzoge1xuICAgICAgICAgICAgICBsaWNlbnNlczogWydlbnRlcnByaXNlLWFkbWluJywgJ2FuYWx5dGljcy1wcm8nLCAnc2VjdXJpdHktbWFuYWdlciddLFxuICAgICAgICAgICAgICBhY3RpdmVMaWNlbnNlczogWydlbnRlcnByaXNlLWFkbWluJywgJ2FuYWx5dGljcy1wcm8nXSxcbiAgICAgICAgICAgICAgcXVvdGFzOiB7XG4gICAgICAgICAgICAgICAgJ2VudGVycHJpc2UtYWRtaW4nOiB7IGFzc2lnbmVkOiAxLCB0b3RhbDogNSB9LFxuICAgICAgICAgICAgICAgICdhbmFseXRpY3MtcHJvJzogeyBhc3NpZ25lZDogMSwgdG90YWw6IDEwIH0sXG4gICAgICAgICAgICAgICAgJ3NlY3VyaXR5LW1hbmFnZXInOiB7IGFzc2lnbmVkOiAwLCB0b3RhbDogMyB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIFxuICAgICAgICAgIHJldHVybiBtb2NrTGljZW5zZXNbYWN0b3JJZCBhcyBrZXlvZiB0eXBlb2YgbW9ja0xpY2Vuc2VzXSB8fCB7XG4gICAgICAgICAgICBsaWNlbnNlczogWydiYXNpYy11c2VyJ10sXG4gICAgICAgICAgICBhY3RpdmVMaWNlbnNlczogWydiYXNpYy11c2VyJ10sXG4gICAgICAgICAgICBxdW90YXM6IHsgJ2Jhc2ljLXVzZXInOiB7IGFzc2lnbmVkOiAxLCB0b3RhbDogMSB9IH1cbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNvbnN0IHRlbmFudEV2ZW50ID0gY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudCh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgLi4uY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudCgpLnJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLTEyMycsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgICAgICAgJ2N1c3RvbTp0ZW5hbnRJZCc6ICdjb21wYW55LWJsb2ctdGVuYW50J1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgU2FhU0NvbnRyb2xsZXIoKTtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCBjb250cm9sbGVyLm1ha2VSZXF1ZXN0Q29udGV4dCh0ZW5hbnRFdmVudCwgY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSk7XG4gICAgICBjb25zdCBlbmhhbmNlZEFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KHRlbmFudEV2ZW50LCByZXF1ZXN0KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGVuaGFuY2VkQWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBhY3RvcklkOiAnam9obi5kb2UnLFxuICAgICAgICB0ZW5hbnRJZDogJ2NvbXBhbnktYmxvZy10ZW5hbnQnLFxuICAgICAgICBcbiAgICAgICAgc3Vic2NyaXB0aW9uOiB7XG4gICAgICAgICAgdGllcjogJ2VudGVycHJpc2UnLFxuICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgZmVhdHVyZXM6IFsnYWR2YW5jZWQtYW5hbHl0aWNzJywgJ2N1c3RvbS1icmFuZGluZycsICdzc28nLCAnYXVkaXQtbG9ncyddLFxuICAgICAgICAgIGxpbWl0czoge1xuICAgICAgICAgICAgdXNlcnM6IDEwMDAsXG4gICAgICAgICAgICBzdG9yYWdlOiAxMDczNzQxODI0MDAsIC8vIDEwMEdCXG4gICAgICAgICAgICBhcGlDYWxsc1Blck1vbnRoOiAxMDAwMDAwXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgbGljZW5zZXM6IFsnZW50ZXJwcmlzZS1hZG1pbicsICdhbmFseXRpY3MtcHJvJywgJ3NlY3VyaXR5LW1hbmFnZXInXSxcbiAgICAgICAgYWN0aXZlTGljZW5zZXM6IFsnZW50ZXJwcmlzZS1hZG1pbicsICdhbmFseXRpY3MtcHJvJ10sXG4gICAgICAgIFxuICAgICAgICB1c2FnZToge1xuICAgICAgICAgIGFwaUNhbGxzVGhpc01vbnRoOiA0NTAwMCxcbiAgICAgICAgICBzdG9yYWdlVXNlZDogMjY4NDM1NDU2MDAsIC8vIDI1R0JcbiAgICAgICAgICB1c2Vyc0FjdGl2ZTogODlcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIGZlYXR1cmVGbGFnczoge1xuICAgICAgICAgICdiZXRhLWFpLWZlYXR1cmVzJzogdHJ1ZSxcbiAgICAgICAgICAnYWR2YW5jZWQtcmVwb3J0aW5nJzogdHJ1ZSxcbiAgICAgICAgICAnY3VzdG9tLWludGVncmF0aW9ucyc6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuICBcbiAgZGVzY3JpYmUoJ01pZGRsZXdhcmUgRW5oYW5jZW1lbnQ6IEFjdG9yIENvbnRleHQnLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBlbmhhbmNlIGFjdG9yIGNvbnRleHQgdmlhIGJlZm9yZSBtaWRkbGV3YXJlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gQnVzaW5lc3MgY29udGV4dCBtaWRkbGV3YXJlIHRoYXQgZW5oYW5jZXMgYWN0b3IgdXNpbmcgZnJhbWV3b3JrIEFQSVxuICAgICAgY29uc3QgYnVzaW5lc3NDb250ZXh0TWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gICAgICAgIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0OiBSZXF1ZXN0LCBfcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiB7XG4gICAgICAgICAgaWYgKCFjdHg/LmFjdG9yIHx8ICFjdHguZW5oYW5jZUFjdG9yKSByZXR1cm47XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2ltdWxhdGUgZmV0Y2hpbmcgYWRkaXRpb25hbCBidXNpbmVzcyBjb250ZXh0XG4gICAgICAgICAgY29uc3Qgcmlza1Byb2ZpbGUgPSBhd2FpdCBmZXRjaFJpc2tQcm9maWxlKGN0eC5hY3Rvci5hY3RvcklkKTtcbiAgICAgICAgICBjb25zdCBwcmVmZXJlbmNlcyA9IGF3YWl0IGZldGNoVXNlclByZWZlcmVuY2VzKGN0eC5hY3Rvci5hY3RvcklkKTtcbiAgICAgICAgICBjb25zdCBkZXZpY2VJbmZvID0gYXdhaXQgZmV0Y2hEZXZpY2VDb250ZXh0KF9yZXF1ZXN0KTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBVc2Ugc2ltcGxlIGZyYW1ld29yayBBUEkgdG8gZW5oYW5jZSBhY3RvciBjb250ZXh0XG4gICAgICAgICAgY3R4LmVuaGFuY2VBY3Rvcj8uKHtcbiAgICAgICAgICAgIHJpc2tQcm9maWxlOiB7XG4gICAgICAgICAgICAgIHNjb3JlOiByaXNrUHJvZmlsZS5zY29yZSxcbiAgICAgICAgICAgICAgbGV2ZWw6IHJpc2tQcm9maWxlLmxldmVsLFxuICAgICAgICAgICAgICBmYWN0b3JzOiByaXNrUHJvZmlsZS5mYWN0b3JzLFxuICAgICAgICAgICAgICBsYXN0QXNzZXNzbWVudDogcmlza1Byb2ZpbGUubGFzdEFzc2Vzc21lbnRcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVmZXJlbmNlczoge1xuICAgICAgICAgICAgICBsYW5ndWFnZTogcHJlZmVyZW5jZXMubGFuZ3VhZ2UsXG4gICAgICAgICAgICAgIHRpbWV6b25lOiBwcmVmZXJlbmNlcy50aW1lem9uZSxcbiAgICAgICAgICAgICAgbm90aWZpY2F0aW9uczogcHJlZmVyZW5jZXMubm90aWZpY2F0aW9ucyxcbiAgICAgICAgICAgICAgcHJpdmFjeTogcHJlZmVyZW5jZXMucHJpdmFjeVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRldmljZToge1xuICAgICAgICAgICAgICB0eXBlOiBkZXZpY2VJbmZvLnR5cGUsXG4gICAgICAgICAgICAgIHBsYXRmb3JtOiBkZXZpY2VJbmZvLnBsYXRmb3JtLFxuICAgICAgICAgICAgICBicm93c2VyOiBkZXZpY2VJbmZvLmJyb3dzZXIsXG4gICAgICAgICAgICAgIGlwOiBkZXZpY2VJbmZvLmlwLFxuICAgICAgICAgICAgICBsb2NhdGlvbjogZGV2aWNlSW5mby5sb2NhdGlvbixcbiAgICAgICAgICAgICAgdHJ1c3RlZDogZGV2aWNlSW5mby50cnVzdGVkXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2VjdXJpdHk6IHtcbiAgICAgICAgICAgICAgdGhyZWF0TGV2ZWw6IHJpc2tQcm9maWxlLnRocmVhdExldmVsLFxuICAgICAgICAgICAgICBhbm9tYWx5RmxhZ3M6IHJpc2tQcm9maWxlLmFub21hbGllcyxcbiAgICAgICAgICAgICAgdHJ1c3RlZERldmljZTogZGV2aWNlSW5mby50cnVzdGVkLFxuICAgICAgICAgICAgICB2cG5EZXRlY3RlZDogZGV2aWNlSW5mby52cG5EZXRlY3RlZCxcbiAgICAgICAgICAgICAgbWZhVmVyaWZpZWQ6IHRydWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzZXNzaW9uOiB7XG4gICAgICAgICAgICAgIG1mYVZlcmlmaWVkOiB0cnVlLFxuICAgICAgICAgICAgICBkZXZpY2VUcnVzdGVkOiBkZXZpY2VJbmZvLnRydXN0ZWQsXG4gICAgICAgICAgICAgIHN0YXJ0ZWRBdDogJzIwMjQtMDEtMTVUMDg6MDA6MDAuMDAwWidcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIFxuICAgICAgLy8gTW9jayBjb250cm9sbGVyIHRoYXQgdXNlcyB0aGUgbWlkZGxld2FyZVxuICAgICAgY2xhc3MgVGVzdENvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgICAgICAgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH1cblxuXG4gICAgICAgIHByb3RlY3RlZCBnZXRNaWRkbGV3YXJlcygpOiBBUElDb250cm9sbGVyTWlkZGxld2FyZVtdIHtcbiAgICAgICAgICByZXR1cm4gW2J1c2luZXNzQ29udGV4dE1pZGRsZXdhcmVdO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBUZXN0IHJvdXRlIHRoYXQgY2FuIGFjY2VzcyBlbmhhbmNlZCBhY3RvclxuICAgICAgICBhc3luYyB0ZXN0Um91dGUoX3JlcXVlc3Q6IFJlcXVlc3QsIF9yZXNwb25zZTogUmVzcG9uc2UsIGN0eDogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICAgIHJldHVybiB7IGFjdG9yOiBjdHguYWN0b3IgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBNb2NrIGZ1bmN0aW9uc1xuICAgICAgYXN5bmMgZnVuY3Rpb24gZmV0Y2hSaXNrUHJvZmlsZShhY3RvcklkPzogc3RyaW5nKSB7XG4gICAgICAgIGNvbnN0IHByb2ZpbGVzID0ge1xuICAgICAgICAgICdqb2huLmRvZSc6IHtcbiAgICAgICAgICAgIHNjb3JlOiA3NSxcbiAgICAgICAgICAgIGxldmVsOiAnbWVkaXVtJyxcbiAgICAgICAgICAgIGZhY3RvcnM6IFsnbmV3LWRldmljZScsICd1bnVzdWFsLWxvY2F0aW9uJ10sXG4gICAgICAgICAgICBsYXN0QXNzZXNzbWVudDogJzIwMjQtMDEtMTVUMDk6MDA6MDAuMDAwWicsXG4gICAgICAgICAgICB0aHJlYXRMZXZlbDogJ2xvdycsXG4gICAgICAgICAgICBhbm9tYWxpZXM6IFsnbG9naW4tdGltZS11bnVzdWFsJ11cbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiBwcm9maWxlc1thY3RvcklkIGFzIGtleW9mIHR5cGVvZiBwcm9maWxlc10gfHwge1xuICAgICAgICAgIHNjb3JlOiA1MCwgbGV2ZWw6ICdsb3cnLCBmYWN0b3JzOiBbXSwgbGFzdEFzc2Vzc21lbnQ6IG51bGwsIHRocmVhdExldmVsOiAnbWluaW1hbCcsIGFub21hbGllczogW11cbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgYXN5bmMgZnVuY3Rpb24gZmV0Y2hVc2VyUHJlZmVyZW5jZXMoYWN0b3JJZD86IHN0cmluZykge1xuICAgICAgICBjb25zdCBwcmVmZXJlbmNlcyA9IHtcbiAgICAgICAgICAnam9obi5kb2UnOiB7XG4gICAgICAgICAgICBsYW5ndWFnZTogJ2VuLVVTJyxcbiAgICAgICAgICAgIHRpbWV6b25lOiAnQW1lcmljYS9OZXdfWW9yaycsXG4gICAgICAgICAgICBub3RpZmljYXRpb25zOiB7IGVtYWlsOiB0cnVlLCBzbXM6IGZhbHNlLCBwdXNoOiB0cnVlIH0sXG4gICAgICAgICAgICBwcml2YWN5OiB7IGFuYWx5dGljczogdHJ1ZSwgbWFya2V0aW5nOiBmYWxzZSwgY29va2llczogJ2Vzc2VudGlhbCcgfVxuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHByZWZlcmVuY2VzW2FjdG9ySWQgYXMga2V5b2YgdHlwZW9mIHByZWZlcmVuY2VzXSB8fCB7XG4gICAgICAgICAgbGFuZ3VhZ2U6ICdlbi1VUycsIHRpbWV6b25lOiAnVVRDJywgbm90aWZpY2F0aW9uczoge30sIHByaXZhY3k6IHt9XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBcbiAgICAgIGFzeW5jIGZ1bmN0aW9uIGZldGNoRGV2aWNlQ29udGV4dChfcmVxdWVzdDogUmVxdWVzdCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHR5cGU6ICdkZXNrdG9wJyxcbiAgICAgICAgICBwbGF0Zm9ybTogJ1dpbmRvd3MnLFxuICAgICAgICAgIGJyb3dzZXI6ICdDaHJvbWUnLFxuICAgICAgICAgIGlwOiAnMTkyLjE2OC4xLjEwMCcsXG4gICAgICAgICAgbG9jYXRpb246IHsgY291bnRyeTogJ1VTJywgY2l0eTogJ05ldyBZb3JrJyB9LFxuICAgICAgICAgIHRydXN0ZWQ6IHRydWUsXG4gICAgICAgICAgdnBuRGV0ZWN0ZWQ6IGZhbHNlXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIFRlc3QgZXhlY3V0aW9uXG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tBUElHYXRld2F5RXZlbnQoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIC4uLmNyZWF0ZU1vY2tBUElHYXRld2F5RXZlbnQoKS5yZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci0xMjMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgY29udHJvbGxlci5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCkpO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyLm1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdCk7XG4gICAgICBjb25zdCBjdHggPSAoY29udHJvbGxlciBhcyBhbnkpLmJ1aWxkQ3R4KGV2ZW50LCBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpLCByZXF1ZXN0LCByZXNwb25zZSk7XG4gICAgICBcbiAgICAgIC8vIEV4ZWN1dGUgbWlkZGxld2FyZSBwaXBlbGluZVxuICAgICAgYXdhaXQgKGNvbnRyb2xsZXIgYXMgYW55KS5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIFxuICAgICAgLy8gVmVyaWZ5IGVuaGFuY2VkIGFjdG9yIGNvbnRleHRcbiAgICAgIGV4cGVjdChjdHguYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBhY3RvcklkOiAnam9obi5kb2UnLFxuICAgICAgICBcbiAgICAgICAgcmlza1Byb2ZpbGU6IHtcbiAgICAgICAgICBzY29yZTogNzUsXG4gICAgICAgICAgbGV2ZWw6ICdtZWRpdW0nLFxuICAgICAgICAgIGZhY3RvcnM6IFsnbmV3LWRldmljZScsICd1bnVzdWFsLWxvY2F0aW9uJ10sXG4gICAgICAgICAgbGFzdEFzc2Vzc21lbnQ6ICcyMDI0LTAxLTE1VDA5OjAwOjAwLjAwMFonXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBwcmVmZXJlbmNlczoge1xuICAgICAgICAgIGxhbmd1YWdlOiAnZW4tVVMnLFxuICAgICAgICAgIHRpbWV6b25lOiAnQW1lcmljYS9OZXdfWW9yaycsXG4gICAgICAgICAgbm90aWZpY2F0aW9uczogeyBlbWFpbDogdHJ1ZSwgc21zOiBmYWxzZSwgcHVzaDogdHJ1ZSB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBkZXZpY2U6IHtcbiAgICAgICAgICB0eXBlOiAnZGVza3RvcCcsXG4gICAgICAgICAgcGxhdGZvcm06ICdXaW5kb3dzJyxcbiAgICAgICAgICBicm93c2VyOiAnQ2hyb21lJyxcbiAgICAgICAgICB0cnVzdGVkOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICBzZWN1cml0eToge1xuICAgICAgICAgIHRocmVhdExldmVsOiAnbG93JyxcbiAgICAgICAgICBhbm9tYWx5RmxhZ3M6IFsnbG9naW4tdGltZS11bnVzdWFsJ10sXG4gICAgICAgICAgdHJ1c3RlZERldmljZTogdHJ1ZSxcbiAgICAgICAgICB2cG5EZXRlY3RlZDogZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBlbmhhbmNlIGFjdG9yIHdpdGggcmVhbC10aW1lIGNvbXBsaWFuY2UgYW5kIGF1ZGl0IGNvbnRleHQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb21wbGlhbmNlTWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gICAgICAgIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0OiBSZXF1ZXN0LCBfcmVzcG9uc2U6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSA9PiB7XG4gICAgICAgICAgaWYgKCFjdHg/LmFjdG9yKSByZXR1cm47XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRmV0Y2ggY29tcGxpYW5jZSBjb250ZXh0XG4gICAgICAgICAgY29uc3QgY29tcGxpYW5jZVN0YXR1cyA9IGF3YWl0IGZldGNoQ29tcGxpYW5jZVN0YXR1cyhjdHguYWN0b3IuYWN0b3JJZCwgY3R4LmFjdG9yLnRlbmFudElkKTtcbiAgICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBhd2FpdCBmZXRjaEF1ZGl0Q29udGV4dChjdHguYWN0b3IuYWN0b3JJZCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVXNlIGZyYW1ld29yayBBUEkgdG8gZW5oYW5jZSB3aXRoIGNvbXBsaWFuY2UgZGF0YVxuICAgICAgICAgIGN0eC5lbmhhbmNlQWN0b3I/Lih7XG4gICAgICAgICAgICBjb21wbGlhbmNlOiB7XG4gICAgICAgICAgICAgIHN0YXR1czogY29tcGxpYW5jZVN0YXR1cy5zdGF0dXMsXG4gICAgICAgICAgICAgIGNlcnRpZmljYXRpb25zOiBjb21wbGlhbmNlU3RhdHVzLmNlcnRpZmljYXRpb25zLFxuICAgICAgICAgICAgICB2aW9sYXRpb25zOiBjb21wbGlhbmNlU3RhdHVzLnZpb2xhdGlvbnMsXG4gICAgICAgICAgICAgIGxhc3RBdWRpdDogY29tcGxpYW5jZVN0YXR1cy5sYXN0QXVkaXQsXG4gICAgICAgICAgICAgIG5leHRSZXZpZXc6IGNvbXBsaWFuY2VTdGF0dXMubmV4dFJldmlldyxcbiAgICAgICAgICAgICAgZGF0YUNsYXNzaWZpY2F0aW9uczogY29tcGxpYW5jZVN0YXR1cy5kYXRhQWNjZXNzLFxuICAgICAgICAgICAgICByZXRlbnRpb25Qb2xpY2llczogY29tcGxpYW5jZVN0YXR1cy5yZXRlbnRpb24sXG4gICAgICAgICAgICAgIGdkcHJTdGF0dXM6IGNvbXBsaWFuY2VTdGF0dXMuZ2RwcixcbiAgICAgICAgICAgICAgc294Q29tcGxpYW50OiBjb21wbGlhbmNlU3RhdHVzLnNveCxcbiAgICAgICAgICAgICAgaGlwYWFBY2Nlc3M6IGNvbXBsaWFuY2VTdGF0dXMuaGlwYWFcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhdWRpdDoge1xuICAgICAgICAgICAgICB0cmFpbEVuYWJsZWQ6IGF1ZGl0Q29udGV4dC5lbmFibGVkLFxuICAgICAgICAgICAgICBzZW5zaXRpdmVPcGVyYXRpb25zOiBhdWRpdENvbnRleHQuc2Vuc2l0aXZlT3BzLFxuICAgICAgICAgICAgICByZXRlbnRpb25QZXJpb2Q6IGF1ZGl0Q29udGV4dC5yZXRlbnRpb25EYXlzLFxuICAgICAgICAgICAgICBsYXN0QWN0aXZpdHk6IGF1ZGl0Q29udGV4dC5sYXN0QWN0aXZpdHksXG4gICAgICAgICAgICAgIGhpZ2hSaXNrT3BlcmF0aW9uczogYXVkaXRDb250ZXh0LmhpZ2hSaXNrLFxuICAgICAgICAgICAgICBhbm9tYWx5RGV0ZWN0aW9uOiBhdWRpdENvbnRleHQuYW5vbWFseURldGVjdGlvbixcbiAgICAgICAgICAgICAgcmVhbFRpbWVNb25pdG9yaW5nOiBhdWRpdENvbnRleHQucmVhbFRpbWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIFxuICAgICAgYXN5bmMgZnVuY3Rpb24gZmV0Y2hDb21wbGlhbmNlU3RhdHVzKF9hY3RvcklkPzogc3RyaW5nLCBfdGVuYW50SWQ/OiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGlhbnQnLFxuICAgICAgICAgIGNlcnRpZmljYXRpb25zOiBbJ0lTTzI3MDAxJywgJ1NPQzItVHlwZTInLCAnR0RQUiddLFxuICAgICAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgICAgIGxhc3RBdWRpdDogJzIwMjQtMDEtMDFUMDA6MDA6MDAuMDAwWicsXG4gICAgICAgICAgbmV4dFJldmlldzogJzIwMjQtMDctMDFUMDA6MDA6MDAuMDAwWicsXG4gICAgICAgICAgZGF0YUFjY2VzczogWydwdWJsaWMnLCAnaW50ZXJuYWwnLCAnY29uZmlkZW50aWFsJ10sXG4gICAgICAgICAgcmV0ZW50aW9uOiB7IGxvZ3M6IDI1NTUsIHVzZXJEYXRhOiAyMTkwLCBmaW5hbmNpYWw6IDI1NTUgfSwgLy8gZGF5c1xuICAgICAgICAgIGdkcHI6IHsgbGF3ZnVsQmFzaXM6ICdsZWdpdGltYXRlLWludGVyZXN0JywgZGF0YVN1YmplY3Q6IHRydWUgfSxcbiAgICAgICAgICBzb3g6IHsgY2VydGlmaWVkOiB0cnVlLCBsYXN0Q2VydGlmaWNhdGlvbjogJzIwMjMtMTItMzEnIH0sXG4gICAgICAgICAgaGlwYWE6IHsgYXV0aG9yaXplZDogZmFsc2UsIHJlYXNvbjogJ25vLWhlYWx0aGNhcmUtZGF0YScgfVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgXG4gICAgICBhc3luYyBmdW5jdGlvbiBmZXRjaEF1ZGl0Q29udGV4dChfYWN0b3JJZD86IHN0cmluZykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgc2Vuc2l0aXZlT3BzOiBbJ3VzZXIuZGVsZXRlJywgJ2RhdGEuZXhwb3J0JywgJ2FkbWluLmFjY2VzcyddLFxuICAgICAgICAgIHJldGVudGlvbkRheXM6IDI1NTUsIC8vIDcgeWVhcnNcbiAgICAgICAgICBsYXN0QWN0aXZpdHk6ICcyMDI0LTAxLTE1VDA5OjE1OjAwLjAwMFonLFxuICAgICAgICAgIGhpZ2hSaXNrOiBbJ2ZpbmFuY2lhbC5hcHByb3ZlJywgJ3NlY3VyaXR5Lm1vZGlmeSddLFxuICAgICAgICAgIGFub21hbHlEZXRlY3Rpb246IHRydWUsXG4gICAgICAgICAgcmVhbFRpbWU6IHRydWVcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgY2xhc3MgQ29tcGxpYW5jZUNvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgICAgICAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IExhbWJkYUNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICAvLyBOby1vcCBmb3IgdGVzdGluZ1xuICAgICAgICB9XG5cbiAgICAgICAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCk6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlW10ge1xuICAgICAgICAgIHJldHVybiBbY29tcGxpYW5jZU1pZGRsZXdhcmVdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudCh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgLi4uY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudCgpLnJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLTEyMycsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2NvbXBsaWFuY2Uub2ZmaWNlcicsXG4gICAgICAgICAgICAgICdjdXN0b206dGVuYW50SWQnOiAncmVndWxhdGVkLWNvbXBhbnknXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBDb21wbGlhbmNlQ29udHJvbGxlcigpO1xuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IGNvbnRyb2xsZXIubWFrZVJlcXVlc3RDb250ZXh0KGV2ZW50LCBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY29udHJvbGxlci5tYWtlUmVzcG9uc2VDb250ZXh0KHJlcXVlc3QpO1xuICAgICAgY29uc3QgY3R4ID0gKGNvbnRyb2xsZXIgYXMgYW55KS5idWlsZEN0eChldmVudCwgY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuICAgICAgXG4gICAgICBhd2FpdCAoY29udHJvbGxlciBhcyBhbnkpLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUoJ2JlZm9yZScsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpO1xuICAgICAgXG4gICAgICBleHBlY3QoY3R4LmFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgYWN0b3JJZDogJ2NvbXBsaWFuY2Uub2ZmaWNlcicsXG4gICAgICAgIHRlbmFudElkOiAncmVndWxhdGVkLWNvbXBhbnknLFxuICAgICAgICBcbiAgICAgICAgY29tcGxpYW5jZToge1xuICAgICAgICAgIHN0YXR1czogJ2NvbXBsaWFudCcsXG4gICAgICAgICAgY2VydGlmaWNhdGlvbnM6IFsnSVNPMjcwMDEnLCAnU09DMi1UeXBlMicsICdHRFBSJ10sXG4gICAgICAgICAgdmlvbGF0aW9uczogW10sXG4gICAgICAgICAgZGF0YUNsYXNzaWZpY2F0aW9uczogWydwdWJsaWMnLCAnaW50ZXJuYWwnLCAnY29uZmlkZW50aWFsJ10sXG4gICAgICAgICAgZ2RwclN0YXR1czogeyBsYXdmdWxCYXNpczogJ2xlZ2l0aW1hdGUtaW50ZXJlc3QnLCBkYXRhU3ViamVjdDogdHJ1ZSB9LFxuICAgICAgICAgIHNveENvbXBsaWFudDogeyBjZXJ0aWZpZWQ6IHRydWUsIGxhc3RDZXJ0aWZpY2F0aW9uOiAnMjAyMy0xMi0zMScgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICB0cmFpbEVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgc2Vuc2l0aXZlT3BlcmF0aW9uczogWyd1c2VyLmRlbGV0ZScsICdkYXRhLmV4cG9ydCcsICdhZG1pbi5hY2Nlc3MnXSxcbiAgICAgICAgICByZXRlbnRpb25QZXJpb2Q6IDI1NTUsXG4gICAgICAgICAgaGlnaFJpc2tPcGVyYXRpb25zOiBbJ2ZpbmFuY2lhbC5hcHByb3ZlJywgJ3NlY3VyaXR5Lm1vZGlmeSddLFxuICAgICAgICAgIGFub21hbHlEZXRlY3Rpb246IHRydWUsXG4gICAgICAgICAgcmVhbFRpbWVNb25pdG9yaW5nOiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgXG4gIGRlc2NyaWJlKCdDb21iaW5lZCBFbmhhbmNlbWVudDogQ29udHJvbGxlciArIE1pZGRsZXdhcmUnLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCBzdXBwb3J0IGJvdGggY29udHJvbGxlciBvdmVycmlkZSBhbmQgbWlkZGxld2FyZSBlbmhhbmNlbWVudCB0b2dldGhlcicsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIENvbnRyb2xsZXIgYWRkcyBidXNpbmVzcyBjb250ZXh0XG4gICAgICBjbGFzcyBFbnRlcnByaXNlQ29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICAgICAgICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogTGFtYmRhQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAgIC8vIE5vLW9wIGZvciB0ZXN0aW5nXG4gICAgICAgIH1cblxuICAgICAgICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yQ29udGV4dChldmVudDogQVBJR2F0ZXdheUV2ZW50LCByZXF1ZXN0OiBSZXF1ZXN0KTogQWN0b3Ige1xuICAgICAgICAgIGNvbnN0IGJhc2VBY3RvciA9IHN1cGVyLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuICAgICAgICAgIFxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5iYXNlQWN0b3IsXG4gICAgICAgICAgICAvLyBDb250cm9sbGVyIGFkZHMgY29yZSBidXNpbmVzcyBjb250ZXh0XG4gICAgICAgICAgICByb2xlczogWydlbnRlcnByaXNlLWFkbWluJywgJ2ZpbmFuY2UtYXBwcm92ZXInXSxcbiAgICAgICAgICAgIGRlcGFydG1lbnQ6ICdmaW5hbmNlJyxcbiAgICAgICAgICAgIGFwcHJvdmFsTGltaXRzOiB7IGZpbmFuY2lhbDogMTAwMDAwMCB9XG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcHJvdGVjdGVkIGdldE1pZGRsZXdhcmVzKCk6IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlW10ge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAvLyBNaWRkbGV3YXJlIDE6IEFkZCBzZXNzaW9uIGNvbnRleHRcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgYmVmb3JlOiBhc3luYyAoX3JlcXVlc3QsIF9yZXNwb25zZSwgY3R4KSA9PiB7XG4gICAgICAgICAgICAgICAgY3R4Py5lbmhhbmNlQWN0b3I/Lih7XG4gICAgICAgICAgICAgICAgICBzZXNzaW9uOiB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnc2Vzc2lvbi0xMjM0NScsXG4gICAgICAgICAgICAgICAgICAgIHN0YXJ0ZWRBdDogJzIwMjQtMDEtMTVUMDg6MDA6MDAuMDAwWicsXG4gICAgICAgICAgICAgICAgICAgIG1mYVZlcmlmaWVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBkZXZpY2VUcnVzdGVkOiB0cnVlXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBNaWRkbGV3YXJlIDI6IEFkZCByZWFsLXRpbWUgcmlzayBhc3Nlc3NtZW50XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGJlZm9yZTogYXN5bmMgKF9yZXF1ZXN0LCBfcmVzcG9uc2UsIGN0eCkgPT4ge1xuICAgICAgICAgICAgICAgIGN0eD8uZW5oYW5jZUFjdG9yPy4oe1xuICAgICAgICAgICAgICAgICAgcmlza0Fzc2Vzc21lbnQ6IHtcbiAgICAgICAgICAgICAgICAgICAgc2NvcmU6IDI1LCAvLyBsb3cgcmlza1xuICAgICAgICAgICAgICAgICAgICBmYWN0b3JzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgcmVjb21tZW5kZWRBY3Rpb25zOiBbJ3Byb2NlZWQnXSxcbiAgICAgICAgICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICAuLi5jcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KCkucmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItMTIzJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnZW50ZXJwcmlzZS5hZG1pbidcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEVudGVycHJpc2VDb250cm9sbGVyKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgY29udHJvbGxlci5tYWtlUmVxdWVzdENvbnRleHQoZXZlbnQsIGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCkpO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjb250cm9sbGVyLm1ha2VSZXNwb25zZUNvbnRleHQocmVxdWVzdCk7XG4gICAgICBjb25zdCBjdHggPSAoY29udHJvbGxlciBhcyBhbnkpLmJ1aWxkQ3R4KGV2ZW50LCBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpLCByZXF1ZXN0LCByZXNwb25zZSk7XG4gICAgICBcbiAgICAgIC8vIEV4ZWN1dGUgbWlkZGxld2FyZSBwaXBlbGluZVxuICAgICAgYXdhaXQgKGNvbnRyb2xsZXIgYXMgYW55KS5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKCdiZWZvcmUnLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4KTtcbiAgICAgIFxuICAgICAgLy8gVmVyaWZ5IGNvbWJpbmVkIGVuaGFuY2VtZW50XG4gICAgICBleHBlY3QoY3R4LmFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgLy8gQmFzZSBmcmFtZXdvcmsgY29udGV4dFxuICAgICAgICBhY3RvcklkOiAnZW50ZXJwcmlzZS5hZG1pbicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgXG4gICAgICAgIC8vIENvbnRyb2xsZXIgZW5oYW5jZW1lbnRcbiAgICAgICAgcm9sZXM6IFsnZW50ZXJwcmlzZS1hZG1pbicsICdmaW5hbmNlLWFwcHJvdmVyJ10sXG4gICAgICAgIGRlcGFydG1lbnQ6ICdmaW5hbmNlJyxcbiAgICAgICAgYXBwcm92YWxMaW1pdHM6IHsgZmluYW5jaWFsOiAxMDAwMDAwIH0sXG4gICAgICAgIFxuICAgICAgICAvLyBNaWRkbGV3YXJlIDEgZW5oYW5jZW1lbnRcbiAgICAgICAgc2Vzc2lvbjoge1xuICAgICAgICAgIGlkOiAnc2Vzc2lvbi0xMjM0NScsXG4gICAgICAgICAgbWZhVmVyaWZpZWQ6IHRydWUsXG4gICAgICAgICAgZGV2aWNlVHJ1c3RlZDogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gTWlkZGxld2FyZSAyIGVuaGFuY2VtZW50XG4gICAgICAgIHJpc2tBc3Nlc3NtZW50OiB7XG4gICAgICAgICAgc2NvcmU6IDI1LFxuICAgICAgICAgIGZhY3RvcnM6IFtdLFxuICAgICAgICAgIHJlY29tbWVuZGVkQWN0aW9uczogWydwcm9jZWVkJ11cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSB0aW1lc3RhbXBzIGFyZSByZWNlbnQgKG1pZGRsZXdhcmUgMiBhZGRzIGN1cnJlbnQgdGltZSlcbiAgICAgIGV4cGVjdChuZXcgRGF0ZShjdHguYWN0b3Iucmlza0Fzc2Vzc21lbnQudGltZXN0YW1wKS5nZXRUaW1lKCkpXG4gICAgICAgIC50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19