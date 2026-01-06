"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const validator_1 = require("./validator");
(0, globals_1.describe)('Validator Real-World Actor Scenarios', () => {
    const validator = new validator_1.Validator();
    (0, globals_1.describe)('Role-Based Authorization', () => {
        (0, globals_1.it)('should validate admin user access to sensitive operations', async () => {
            const adminActor = {
                actorId: 'admin-user-001',
                actorType: 'user',
                requestId: 'req-admin-001',
                timestamp: '2024-01-15T10:30:00.000Z',
                authMethod: 'cognito',
                role: 'admin',
                department: 'administration',
                clearanceLevel: 'high'
            };
            const entityValidations = {
                actor: {
                    role: [{ eq: 'admin' }],
                    clearanceLevel: [{ eq: 'high' }],
                    authMethod: [{ eq: 'cognito' }]
                },
                input: {
                    operationType: [{ eq: 'sensitive-data-access' }],
                    justification: [{ required: true }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'accessSensitiveData',
                entityName: 'SecurityOperation',
                entityValidations,
                actor: adminActor,
                input: {
                    operationType: 'sensitive-data-access',
                    justification: 'Security audit required by compliance team'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
            (0, globals_1.expect)(result.errors).toEqual([]);
        });
        (0, globals_1.it)('should reject regular user access to admin operations', async () => {
            const regularUserActor = {
                actorId: 'user-001',
                actorType: 'user',
                requestId: 'req-user-001',
                timestamp: '2024-01-15T11:00:00.000Z',
                authMethod: 'cognito',
                role: 'user', // Not admin
                department: 'marketing'
            };
            const entityValidations = {
                actor: {
                    role: [{ eq: 'admin' }] // Requires admin role
                }
            };
            const result = await validator.validateEntity({
                operationName: 'accessSensitiveData',
                entityName: 'SecurityOperation',
                entityValidations,
                actor: regularUserActor,
                collectErrors: true,
                verboseErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
            (0, globals_1.expect)(result.errors?.[0]?.messageIds).toContain('validation.entity.securityoperation.actor.role.eq.admin');
        });
        (0, globals_1.it)('should validate manager approval limits based on actor properties', async () => {
            const managerActor = {
                actorId: 'mgr-001',
                requestId: 'req-approval-001',
                timestamp: '2024-01-15T12:00:00.000Z',
                role: 'manager',
                department: 'finance',
                approvalLimit: 10000
            };
            const entityValidations = {
                actor: {
                    role: [{ eq: 'manager' }],
                    department: [{ eq: 'finance' }],
                    approvalLimit: [{ gte: 5000 }] // Must have approval limit >= 5000
                },
                input: {
                    amount: [{ lte: 10000 }], // Amount must be within limit
                    vendor: [{ required: true }],
                    category: [{ inList: ['office-supplies', 'software', 'equipment'] }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'approveExpense',
                entityName: 'ExpenseApproval',
                entityValidations,
                actor: managerActor,
                input: {
                    amount: 7500,
                    vendor: 'Office Depot',
                    category: 'office-supplies',
                    description: 'Monthly office supply order'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should reject approval when amount exceeds actor approval limit', async () => {
            const lowLevelManagerActor = {
                actorId: 'mgr-junior-001',
                requestId: 'req-approval-002',
                timestamp: '2024-01-15T13:00:00.000Z',
                role: 'manager',
                department: 'finance',
                approvalLimit: 2000 // Low approval limit
            };
            const entityValidations = {
                actor: {
                    approvalLimit: [{ gte: 5000 }] // Requires higher approval limit
                }
            };
            const result = await validator.validateEntity({
                operationName: 'approveExpense',
                entityName: 'ExpenseApproval',
                entityValidations,
                actor: lowLevelManagerActor,
                collectErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
        });
    });
    (0, globals_1.describe)('Service Authentication', () => {
        (0, globals_1.it)('should validate API key service operations', async () => {
            const apiServiceActor = {
                actorId: 'api-key:data-sync-service',
                actorType: 'service',
                requestId: 'req-service-001',
                timestamp: '2024-01-15T14:00:00.000Z',
                authMethod: 'api-key',
                apiKey: {
                    id: 'sync-key-123',
                    source: 'request-context'
                },
                sourceIp: '10.0.1.100'
            };
            const entityValidations = {
                actor: {
                    actorType: [{ eq: 'service' }],
                    authMethod: [{ eq: 'api-key' }],
                    apiKey: [{ required: true }],
                    sourceIp: [{ required: true }]
                },
                input: {
                    batchSize: [{ lte: 1000 }], // Services can process up to 1000 records
                    dataSource: [{ required: true }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'batchSync',
                entityName: 'DataSynchronization',
                entityValidations,
                actor: apiServiceActor,
                input: {
                    batchSize: 500,
                    dataSource: 'external-crm',
                    records: ['record1', 'record2', 'record3']
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should reject user authentication for service-only operations', async () => {
            const userActor = {
                actorId: 'user-001',
                actorType: 'user', // Should be service
                requestId: 'req-user-service-001',
                timestamp: '2024-01-15T15:00:00.000Z',
                authMethod: 'cognito' // Should be api-key
            };
            const entityValidations = {
                actor: {
                    actorType: [{ eq: 'service' }],
                    authMethod: [{ eq: 'api-key' }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'batchSync',
                entityName: 'DataSynchronization',
                entityValidations,
                actor: userActor,
                collectErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(2); // Both actorType and authMethod will fail
        });
        (0, globals_1.it)('should validate system actor for maintenance operations', async () => {
            const systemActor = {
                actorId: 'anonymous',
                actorType: 'anonymous',
                requestId: 'req-system-001',
                timestamp: '2024-01-15T02:00:00.000Z',
                authMethod: 'anonymous',
                maintenanceWindow: true
            };
            const entityValidations = {
                actor: {
                    actorId: [{ eq: 'anonymous' }],
                    actorType: [{ eq: 'anonymous' }],
                    authMethod: [{ eq: 'anonymous' }],
                    maintenanceWindow: [{ eq: true }]
                },
                input: {
                    operationType: [{ inList: ['cleanup', 'backup', 'migration'] }],
                    affectedTables: [{ required: true }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'systemMaintenance',
                entityName: 'MaintenanceOperation',
                entityValidations,
                actor: systemActor,
                input: {
                    operationType: 'cleanup',
                    affectedTables: ['logs', 'temp_data'],
                    retentionDays: 90
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
    });
    (0, globals_1.describe)('Tenant Isolation', () => {
        (0, globals_1.it)('should validate tenant-scoped operations', async () => {
            const tenantUserActor = {
                actorId: 'tenant-admin-001',
                actorType: 'user',
                requestId: 'req-tenant-001',
                timestamp: '2024-01-15T16:00:00.000Z',
                authMethod: 'cognito',
                tenantId: 'company-a-tenant',
                cognito: {
                    groups: ['team-admin']
                },
                role: 'admin'
            };
            const entityValidations = {
                actor: {
                    tenantId: [{ eq: 'company-a-tenant' }],
                    role: [{ eq: 'admin' }],
                    authMethod: [{ eq: 'cognito' }]
                },
                input: {
                    targetTenantId: [{ eq: 'company-a-tenant' }], // Must match actor's tenant
                    operation: [{ inList: ['create', 'update', 'delete'] }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'tenantAdminOperation',
                entityName: 'TenantResource',
                entityValidations,
                actor: tenantUserActor,
                input: {
                    targetTenantId: 'company-a-tenant',
                    operation: 'create',
                    resourceType: 'user-account'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should prevent cross-tenant access', async () => {
            const maliciousTenantActor = {
                actorId: 'malicious-user-001',
                actorType: 'user',
                requestId: 'req-cross-tenant-001',
                timestamp: '2024-01-15T17:00:00.000Z',
                tenantId: 'company-b-tenant',
                role: 'admin'
            };
            const entityValidations = {
                actor: {
                    tenantId: [{ eq: 'company-a-tenant' }] // Must be from company A
                },
                input: {
                    targetTenantId: [{ eq: 'company-a-tenant' }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'tenantAdminOperation',
                entityName: 'TenantResource',
                entityValidations,
                actor: maliciousTenantActor,
                input: {
                    targetTenantId: 'company-a-tenant', // Trying to access company A data
                    operation: 'delete'
                },
                collectErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
        });
    });
    (0, globals_1.describe)('Complex Actor Validation', () => {
        (0, globals_1.it)('should validate multi-field actor requirements', async () => {
            const qualifiedDoctorActor = {
                actorId: 'dr-smith-001',
                actorType: 'user',
                requestId: 'req-medical-001',
                timestamp: '2024-01-15T18:00:00.000Z',
                authMethod: 'cognito',
                profession: 'doctor',
                licenseNumber: 'MD-123456',
                specialization: 'cardiology',
                hospitalId: 'hosp-main-001',
                isActive: true
            };
            const entityValidations = {
                actor: {
                    profession: [{ eq: 'doctor' }],
                    licenseNumber: [{ required: true }],
                    specialization: [{ inList: ['cardiology', 'surgery', 'neurology'] }],
                    hospitalId: [{ required: true }],
                    isActive: [{ eq: true }]
                },
                input: {
                    patientId: [{ required: true }],
                    procedureType: [{ inList: ['examination', 'surgery', 'consultation'] }],
                    urgencyLevel: [{ inList: ['low', 'medium', 'high', 'critical'] }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'medicalProcedure',
                entityName: 'MedicalRecord',
                entityValidations,
                actor: qualifiedDoctorActor,
                input: {
                    patientId: 'patient-001',
                    procedureType: 'examination',
                    urgencyLevel: 'medium',
                    notes: 'Routine cardiac examination'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should reject actors missing required business context fields', async () => {
            // This tests complex business validation that controllers can add via extractActorContext override
            // Example: Medical system controller adds license validation, financial system adds credit checks, etc.
            const studentActor = {
                actorId: 'student-001',
                actorType: 'user',
                requestId: 'req-student-001',
                timestamp: '2024-01-15T19:00:00.000Z',
                profession: 'medical-student', // Missing required profession
                isActive: true
            };
            const entityValidations = {
                actor: {
                    profession: [{ eq: 'doctor' }], // Must have specific profession
                    licenseNumber: [{ required: true }] // Must have business license/certification
                }
            };
            const result = await validator.validateEntity({
                operationName: 'medicalProcedure',
                entityName: 'MedicalRecord',
                entityValidations,
                actor: studentActor,
                input: {
                    patientId: 'patient-001',
                    procedureType: 'examination'
                },
                collectErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(2); // profession and licenseNumber validation both fail
        });
        (0, globals_1.it)('should validate actor with custom business logic fields', async () => {
            const premiumUserActor = {
                actorId: 'premium-user-001',
                requestId: 'req-premium-001',
                timestamp: '2024-01-15T20:00:00.000Z',
                subscriptionTier: 'premium',
                accountAge: 365, // days
                trustScore: 850,
                verificationStatus: 'verified'
            };
            const entityValidations = {
                actor: {
                    subscriptionTier: [{ inList: ['premium', 'enterprise'] }],
                    accountAge: [{ gte: 30 }], // Must be at least 30 days old
                    trustScore: [{ gte: 700 }], // Must have high trust score
                    verificationStatus: [{ eq: 'verified' }]
                },
                input: {
                    uploadSize: [{ lte: 1000000000 }], // Premium users get 1GB limit
                    fileType: [{ inList: ['video', 'audio', 'document', 'image'] }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'uploadLargeFile',
                entityName: 'FileUpload',
                entityValidations,
                actor: premiumUserActor,
                input: {
                    uploadSize: 500000000, // 500MB
                    fileType: 'video',
                    fileName: 'presentation.mp4'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
    });
    (0, globals_1.describe)('Input Validation Based on Actor Context', () => {
        (0, globals_1.it)('should validate different input rules for different actor types', async () => {
            const moderatorActor = {
                actorId: 'mod-001',
                requestId: 'req-moderation-001',
                timestamp: '2024-01-15T21:00:00.000Z',
                role: 'moderator',
                permissions: ['content-review', 'user-management']
            };
            const entityValidations = {
                actor: {
                    role: [{ eq: 'moderator' }]
                },
                input: {
                    action: [{ inList: ['approve', 'reject', 'flag', 'delete'] }], // Moderators have more options
                    reason: [{ required: true }],
                    notifyUser: [{ eq: true }] // Moderators must notify users
                }
            };
            const result = await validator.validateEntity({
                operationName: 'moderateContent',
                entityName: 'ContentModeration',
                entityValidations,
                actor: moderatorActor,
                input: {
                    action: 'flag',
                    reason: 'Inappropriate content detected',
                    notifyUser: true,
                    contentId: 'post-123'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should reject invalid actions for actor role', async () => {
            const regularUserActor = {
                actorId: 'user-001',
                requestId: 'req-user-moderate-001',
                timestamp: '2024-01-15T22:00:00.000Z',
                role: 'user' // Not a moderator
            };
            const entityValidations = {
                actor: {
                    role: [{ eq: 'moderator' }] // Only moderators allowed
                }
            };
            const result = await validator.validateEntity({
                operationName: 'moderateContent',
                entityName: 'ContentModeration',
                entityValidations,
                actor: regularUserActor,
                input: {
                    action: 'delete',
                    contentId: 'post-123'
                },
                collectErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(1);
        });
    });
    (0, globals_1.describe)('Enhanced Actor Context Validation', () => {
        (0, globals_1.it)('should validate complex role-based access control', async () => {
            // Enhanced actor from controller override
            const managerActor = {
                actorId: 'john.manager',
                actorType: 'user',
                authMethod: 'cognito',
                requestId: 'req-rbac-001',
                timestamp: '2024-01-15T21:00:00.000Z',
                // Enhanced by controller
                roles: ['manager', 'approver', 'budget-owner'],
                primaryRole: 'manager',
                permissions: ['user.read', 'user.write', 'budget.approve', 'report.generate'],
                permissionLevel: 'senior',
                department: 'engineering',
                approvalLimits: {
                    financial: 50000,
                    timeOff: 30,
                    procurement: 25000
                },
                securityClearance: 'confidential'
            };
            const entityValidations = {
                actor: {
                    // Role validation - using custom function for array contains
                    roles: [{ custom: (roles) => Array.isArray(roles) && roles.includes('approver') }],
                    primaryRole: [{ inList: ['manager', 'director', 'vp'] }],
                    // Permission validation - using custom function for array contains
                    permissions: [{ custom: (permissions) => Array.isArray(permissions) && permissions.includes('budget.approve') }],
                    permissionLevel: [{ inList: ['senior', 'executive'] }],
                    // Department-based access
                    department: [{ eq: 'engineering' }],
                    // Security clearance
                    securityClearance: [{ inList: ['confidential', 'secret', 'top-secret'] }]
                },
                input: {
                    // Amount must be within approval limits
                    amount: [{ lte: 50000 }],
                    // Request type must match permissions
                    requestType: [{ eq: 'budget-approval' }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'financialApproval',
                entityName: 'BudgetRequest',
                entityValidations,
                actor: managerActor,
                input: {
                    amount: 35000,
                    requestType: 'budget-approval',
                    department: 'engineering',
                    description: 'New server infrastructure'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should reject insufficient role permissions', async () => {
            const juniorActor = {
                actorId: 'jane.junior',
                actorType: 'user',
                authMethod: 'cognito',
                requestId: 'req-rbac-002',
                timestamp: '2024-01-15T21:15:00.000Z',
                roles: ['employee', 'viewer'],
                primaryRole: 'employee',
                permissions: ['user.read', 'report.view'],
                permissionLevel: 'junior',
                department: 'engineering',
                approvalLimits: {
                    financial: 0,
                    timeOff: 0,
                    procurement: 0
                },
                securityClearance: 'public'
            };
            const entityValidations = {
                actor: {
                    roles: [{ custom: (roles) => Array.isArray(roles) && roles.includes('approver') }], // Missing approver role
                    securityClearance: [{ inList: ['confidential', 'secret'] }] // Insufficient clearance
                }
            };
            const result = await validator.validateEntity({
                operationName: 'financialApproval',
                entityName: 'BudgetRequest',
                entityValidations,
                actor: juniorActor,
                input: {
                    amount: 35000,
                    requestType: 'budget-approval'
                },
                collectErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(2); // roles and securityClearance validations should fail
        });
        (0, globals_1.it)('should validate subscription-based feature access', async () => {
            // Enhanced actor with subscription context
            const enterpriseActor = {
                actorId: 'enterprise.user',
                actorType: 'user',
                authMethod: 'cognito',
                requestId: 'req-sub-001',
                timestamp: '2024-01-15T22:00:00.000Z',
                tenantId: 'enterprise-corp',
                // Enhanced by controller with subscription data
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
                licenses: ['enterprise-admin', 'analytics-pro'],
                activeLicenses: ['enterprise-admin', 'analytics-pro'],
                usage: {
                    apiCallsThisMonth: 45000,
                    storageUsed: 26843545600, // 25GB
                    usersActive: 89
                },
                featureFlags: {
                    'beta-ai-features': true,
                    'advanced-reporting': true
                }
            };
            const entityValidations = {
                actor: {
                    // Subscription validation - use custom validators for nested properties
                    subscription: [{ custom: (sub) => sub?.tier === 'enterprise' || sub?.tier === 'premium' }],
                    // License validation - use custom for array contains
                    activeLicenses: [{ custom: (licenses) => Array.isArray(licenses) && licenses.includes('analytics-pro') }],
                    // Feature flag validation - use custom for nested property
                    featureFlags: [{ custom: (flags) => flags?.['advanced-reporting'] === true }]
                },
                input: {
                    // Feature-specific validation
                    reportType: [{ inList: ['advanced', 'custom'] }],
                    dataRange: [{ inList: ['1year', '2years', 'all-time'] }] // Enterprise gets extended ranges
                }
            };
            const result = await validator.validateEntity({
                operationName: 'generateAdvancedReport',
                entityName: 'AnalyticsReport',
                entityValidations,
                actor: enterpriseActor,
                input: {
                    reportType: 'advanced',
                    dataRange: '2years',
                    includeRawData: true
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should validate middleware-enhanced security context', async () => {
            // Enhanced actor with security context from middleware
            const secureActor = {
                actorId: 'security.analyst',
                actorType: 'user',
                authMethod: 'cognito',
                requestId: 'req-sec-001',
                timestamp: '2024-01-15T23:00:00.000Z',
                // Enhanced by middleware
                riskProfile: {
                    score: 25, // low risk
                    level: 'low',
                    factors: [],
                    threatLevel: 'minimal'
                },
                device: {
                    type: 'desktop',
                    trusted: true,
                    platform: 'Windows'
                },
                security: {
                    mfaVerified: true,
                    vpnDetected: false,
                    anomalyFlags: []
                },
                session: {
                    mfaVerified: true,
                    deviceTrusted: true,
                    startedAt: '2024-01-15T08:00:00.000Z'
                }
            };
            const entityValidations = {
                actor: {
                    // Risk assessment validation - use custom for nested properties
                    riskProfile: [{ custom: (risk) => risk?.level === 'low' || risk?.level === 'minimal' }],
                    // Device security validation
                    device: [{ custom: (device) => device?.trusted === true }],
                    // Security validation  
                    security: [{ custom: (sec) => sec?.mfaVerified === true && sec?.vpnDetected === false }],
                    // Session validation
                    session: [{ custom: (sess) => sess?.deviceTrusted === true && sess?.mfaVerified === true }]
                },
                input: {
                    // Sensitive operation validation
                    operationType: [{ inList: ['user.suspend', 'security.audit', 'admin.access'] }],
                    dataClassification: [{ inList: ['confidential', 'internal'] }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'sensitiveSecurityOperation',
                entityName: 'SecurityAction',
                entityValidations,
                actor: secureActor,
                input: {
                    operationType: 'security.audit',
                    dataClassification: 'confidential',
                    targetUserId: 'suspicious.user'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
        (0, globals_1.it)('should reject high-risk security scenarios', async () => {
            const riskyActor = {
                actorId: 'risky.user',
                actorType: 'user',
                authMethod: 'cognito',
                requestId: 'req-risk-001',
                timestamp: '2024-01-15T23:30:00.000Z',
                riskProfile: {
                    score: 85, // high risk
                    level: 'high',
                    factors: ['new-device', 'unusual-location', 'velocity-anomaly'],
                    threatLevel: 'elevated'
                },
                device: {
                    type: 'mobile',
                    trusted: false, // Untrusted device
                    platform: 'iOS'
                },
                security: {
                    mfaVerified: false, // MFA not verified
                    vpnDetected: true, // VPN detected
                    anomalyFlags: ['login-time-unusual', 'location-anomaly']
                }
            };
            const entityValidations = {
                actor: {
                    riskProfile: [{ custom: (risk) => (risk?.level === 'low' || risk?.level === 'minimal') && risk?.score <= 50 }],
                    device: [{ custom: (device) => device?.trusted === true }],
                    security: [{ custom: (sec) => sec?.mfaVerified === true && sec?.vpnDetected === false }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'sensitiveSecurityOperation',
                entityName: 'SecurityAction',
                entityValidations,
                actor: riskyActor,
                input: {
                    operationType: 'user.suspend',
                    dataClassification: 'confidential'
                },
                collectErrors: true
            });
            (0, globals_1.expect)(result.pass).toBe(false);
            (0, globals_1.expect)(result.errors).toHaveLength(3); // riskProfile, device, and security validations should fail
        });
        (0, globals_1.it)('should validate compliance and audit requirements', async () => {
            const complianceActor = {
                actorId: 'compliance.officer',
                actorType: 'user',
                authMethod: 'cognito',
                requestId: 'req-comp-001',
                timestamp: '2024-01-16T00:00:00.000Z',
                tenantId: 'regulated-financial',
                // Enhanced by middleware with compliance context
                compliance: {
                    status: 'compliant',
                    certifications: ['SOC2-Type2', 'ISO27001', 'PCI-DSS'],
                    violations: [],
                    gdprStatus: { lawfulBasis: 'legitimate-interest', dataSubject: true },
                    soxCompliant: { certified: true, lastCertification: '2023-12-31' }
                },
                audit: {
                    trailEnabled: true,
                    sensitiveOperations: ['financial.approve', 'data.export'],
                    retentionPeriod: 2555, // 7 years
                    highRiskOperations: ['user.delete', 'audit.modify'],
                    realTimeMonitoring: true
                },
                roles: ['compliance-officer', 'auditor'],
                securityClearance: 'confidential'
            };
            const entityValidations = {
                actor: {
                    // Compliance validation - use custom for nested properties
                    compliance: [{ custom: (comp) => comp?.status === 'compliant' &&
                                Array.isArray(comp?.certifications) && comp.certifications.includes('SOC2-Type2') &&
                                Array.isArray(comp?.violations) && comp.violations.length === 0 &&
                                comp?.soxCompliant?.certified === true
                        }],
                    // Audit validation - use custom for nested properties
                    audit: [{ custom: (audit) => audit?.trailEnabled === true &&
                                audit?.retentionPeriod >= 2555 &&
                                audit?.realTimeMonitoring === true
                        }],
                    // Role validation
                    roles: [{ custom: (roles) => Array.isArray(roles) && roles.includes('compliance-officer') }],
                    securityClearance: [{ inList: ['confidential', 'secret'] }]
                },
                input: {
                    // Financial compliance validation
                    transactionType: [{ inList: ['audit-review', 'compliance-check'] }],
                    amount: [{ gte: 0 }],
                    regulatoryFramework: [{ inList: ['SOX', 'GDPR', 'PCI-DSS'] }]
                }
            };
            const result = await validator.validateEntity({
                operationName: 'financialComplianceReview',
                entityName: 'ComplianceReport',
                entityValidations,
                actor: complianceActor,
                input: {
                    transactionType: 'audit-review',
                    amount: 250000,
                    regulatoryFramework: 'SOX',
                    reviewType: 'quarterly'
                }
            });
            (0, globals_1.expect)(result.pass).toBe(true);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLXJlYWwtc2NlbmFyaW9zLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdmFsaWRhdGlvbi92YWxpZGF0b3ItcmVhbC1zY2VuYXJpb3MudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUFxRDtBQUNyRCwyQ0FBd0M7QUFJeEMsSUFBQSxrQkFBUSxFQUFDLHNDQUFzQyxFQUFFLEdBQUcsRUFBRTtJQUNwRCxNQUFNLFNBQVMsR0FBRyxJQUFJLHFCQUFTLEVBQUUsQ0FBQztJQUVsQyxJQUFBLGtCQUFRLEVBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO1FBRXhDLElBQUEsWUFBRSxFQUFDLDJEQUEyRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3pFLE1BQU0sVUFBVSxHQUFVO2dCQUN4QixPQUFPLEVBQUUsZ0JBQWdCO2dCQUN6QixTQUFTLEVBQUUsTUFBTTtnQkFDakIsU0FBUyxFQUFFLGVBQWU7Z0JBQzFCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixJQUFJLEVBQUUsT0FBTztnQkFDYixVQUFVLEVBQUUsZ0JBQWdCO2dCQUM1QixjQUFjLEVBQUUsTUFBTTthQUNoQixDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsQ0FBQztvQkFDdkIsY0FBYyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLENBQUM7b0JBQ2hDLFVBQVUsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDO2lCQUNoQztnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsYUFBYSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsdUJBQXVCLEVBQUUsQ0FBQztvQkFDaEQsYUFBYSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQ3BDO2FBQ0YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLHFCQUFxQjtnQkFDcEMsVUFBVSxFQUFFLG1CQUFtQjtnQkFDL0IsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsVUFBVTtnQkFDakIsS0FBSyxFQUFFO29CQUNMLGFBQWEsRUFBRSx1QkFBdUI7b0JBQ3RDLGFBQWEsRUFBRSw0Q0FBNEM7aUJBQzVEO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDL0IsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDcEMsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyx1REFBdUQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNyRSxNQUFNLGdCQUFnQixHQUFVO2dCQUM5QixPQUFPLEVBQUUsVUFBVTtnQkFDbkIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFNBQVMsRUFBRSxjQUFjO2dCQUN6QixTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxVQUFVLEVBQUUsU0FBUztnQkFDckIsSUFBSSxFQUFFLE1BQU0sRUFBRSxZQUFZO2dCQUMxQixVQUFVLEVBQUUsV0FBVzthQUNqQixDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDLHNCQUFzQjtpQkFDL0M7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUscUJBQXFCO2dCQUNwQyxVQUFVLEVBQUUsbUJBQW1CO2dCQUMvQixpQkFBaUI7Z0JBQ2pCLEtBQUssRUFBRSxnQkFBZ0I7Z0JBQ3ZCLGFBQWEsRUFBRSxJQUFJO2dCQUNuQixhQUFhLEVBQUUsSUFBSTthQUNwQixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNoQyxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN0QyxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLFVBQVUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyx5REFBeUQsQ0FBQyxDQUFDO1FBQzlHLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsbUVBQW1FLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDakYsTUFBTSxZQUFZLEdBQVU7Z0JBQzFCLE9BQU8sRUFBRSxTQUFTO2dCQUNsQixTQUFTLEVBQUUsa0JBQWtCO2dCQUM3QixTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxJQUFJLEVBQUUsU0FBUztnQkFDZixVQUFVLEVBQUUsU0FBUztnQkFDckIsYUFBYSxFQUFFLEtBQUs7YUFDZCxDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsQ0FBQztvQkFDekIsVUFBVSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUM7b0JBQy9CLGFBQWEsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsbUNBQW1DO2lCQUNuRTtnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsTUFBTSxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSw4QkFBOEI7b0JBQ3hELE1BQU0sRUFBRSxDQUFDLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFDO29CQUM1QixRQUFRLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLGlCQUFpQixFQUFFLFVBQVUsRUFBRSxXQUFXLENBQUMsRUFBRSxDQUFDO2lCQUNyRTthQUNGLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7Z0JBQzVDLGFBQWEsRUFBRSxnQkFBZ0I7Z0JBQy9CLFVBQVUsRUFBRSxpQkFBaUI7Z0JBQzdCLGlCQUFpQjtnQkFDakIsS0FBSyxFQUFFLFlBQVk7Z0JBQ25CLEtBQUssRUFBRTtvQkFDTCxNQUFNLEVBQUUsSUFBSTtvQkFDWixNQUFNLEVBQUUsY0FBYztvQkFDdEIsUUFBUSxFQUFFLGlCQUFpQjtvQkFDM0IsV0FBVyxFQUFFLDZCQUE2QjtpQkFDM0M7YUFDRixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLGlFQUFpRSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQy9FLE1BQU0sb0JBQW9CLEdBQVU7Z0JBQ2xDLE9BQU8sRUFBRSxnQkFBZ0I7Z0JBQ3pCLFNBQVMsRUFBRSxrQkFBa0I7Z0JBQzdCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLElBQUksRUFBRSxTQUFTO2dCQUNmLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixhQUFhLEVBQUUsSUFBSSxDQUFDLHFCQUFxQjthQUNuQyxDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxhQUFhLEVBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLGlDQUFpQztpQkFDakU7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsZ0JBQWdCO2dCQUMvQixVQUFVLEVBQUUsaUJBQWlCO2dCQUM3QixpQkFBaUI7Z0JBQ2pCLEtBQUssRUFBRSxvQkFBb0I7Z0JBQzNCLGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2hDLElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3hDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFO1FBRXRDLElBQUEsWUFBRSxFQUFDLDRDQUE0QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzFELE1BQU0sZUFBZSxHQUFVO2dCQUM3QixPQUFPLEVBQUUsMkJBQTJCO2dCQUNwQyxTQUFTLEVBQUUsU0FBUztnQkFDcEIsU0FBUyxFQUFFLGlCQUFpQjtnQkFDNUIsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLE1BQU0sRUFBRTtvQkFDTixFQUFFLEVBQUUsY0FBYztvQkFDbEIsTUFBTSxFQUFFLGlCQUFpQjtpQkFDMUI7Z0JBQ0QsUUFBUSxFQUFFLFlBQVk7YUFDdkIsQ0FBQztZQUVGLE1BQU0saUJBQWlCLEdBQXFDO2dCQUMxRCxLQUFLLEVBQUU7b0JBQ0wsU0FBUyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUM7b0JBQzlCLFVBQVUsRUFBRSxDQUFFLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFFO29CQUNqQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQztvQkFDNUIsUUFBUSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQy9CO2dCQUNELEtBQUssRUFBRTtvQkFDTCxTQUFTLEVBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLDBDQUEwQztvQkFDdEUsVUFBVSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQ2pDO2FBQ0YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLFdBQVc7Z0JBQzFCLFVBQVUsRUFBRSxxQkFBcUI7Z0JBQ2pDLGlCQUFpQjtnQkFDakIsS0FBSyxFQUFFLGVBQWU7Z0JBQ3RCLEtBQUssRUFBRTtvQkFDTCxTQUFTLEVBQUUsR0FBRztvQkFDZCxVQUFVLEVBQUUsY0FBYztvQkFDMUIsT0FBTyxFQUFFLENBQUMsU0FBUyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUM7aUJBQzNDO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDakMsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQywrREFBK0QsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM3RSxNQUFNLFNBQVMsR0FBVTtnQkFDdkIsT0FBTyxFQUFFLFVBQVU7Z0JBQ25CLFNBQVMsRUFBRSxNQUFNLEVBQUUsb0JBQW9CO2dCQUN2QyxTQUFTLEVBQUUsc0JBQXNCO2dCQUNqQyxTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxVQUFVLEVBQUUsU0FBUyxDQUFDLG9CQUFvQjthQUMzQyxDQUFDO1lBRUYsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxTQUFTLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsQ0FBQztvQkFDOUIsVUFBVSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUM7aUJBQ2hDO2FBQ0YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLFdBQVc7Z0JBQzFCLFVBQVUsRUFBRSxxQkFBcUI7Z0JBQ2pDLGlCQUFpQjtnQkFDakIsS0FBSyxFQUFFLFNBQVM7Z0JBQ2hCLGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2hDLElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsMENBQTBDO1FBQ25GLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMseURBQXlELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDdkUsTUFBTSxXQUFXLEdBQVU7Z0JBQ3pCLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixTQUFTLEVBQUUsV0FBVztnQkFDdEIsU0FBUyxFQUFFLGdCQUFnQjtnQkFDM0IsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLGlCQUFpQixFQUFFLElBQUk7YUFDakIsQ0FBQztZQUVULE1BQU0saUJBQWlCLEdBQXFDO2dCQUMxRCxLQUFLLEVBQUU7b0JBQ0wsT0FBTyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFFLENBQUM7b0JBQzlCLFNBQVMsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLFdBQVcsRUFBRSxDQUFDO29CQUNoQyxVQUFVLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxXQUFXLEVBQUUsQ0FBQztvQkFDakMsaUJBQWlCLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQztpQkFDbEM7Z0JBQ0QsS0FBSyxFQUFFO29CQUNMLGFBQWEsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsU0FBUyxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQUMsRUFBRSxDQUFDO29CQUMvRCxjQUFjLEVBQUUsQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQztpQkFDckM7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsbUJBQW1CO2dCQUNsQyxVQUFVLEVBQUUsc0JBQXNCO2dCQUNsQyxpQkFBaUI7Z0JBQ2pCLEtBQUssRUFBRSxXQUFXO2dCQUNsQixLQUFLLEVBQUU7b0JBQ0wsYUFBYSxFQUFFLFNBQVM7b0JBQ3hCLGNBQWMsRUFBRSxDQUFDLE1BQU0sRUFBRSxXQUFXLENBQUM7b0JBQ3JDLGFBQWEsRUFBRSxFQUFFO2lCQUNsQjthQUNGLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2pDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsa0JBQWtCLEVBQUUsR0FBRyxFQUFFO1FBRWhDLElBQUEsWUFBRSxFQUFDLDBDQUEwQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3hELE1BQU0sZUFBZSxHQUFVO2dCQUM3QixPQUFPLEVBQUUsa0JBQWtCO2dCQUMzQixTQUFTLEVBQUUsTUFBTTtnQkFDakIsU0FBUyxFQUFFLGdCQUFnQjtnQkFDM0IsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFFBQVEsRUFBRSxrQkFBa0I7Z0JBQzVCLE9BQU8sRUFBRTtvQkFDUCxNQUFNLEVBQUUsQ0FBQyxZQUFZLENBQUM7aUJBQ3ZCO2dCQUNELElBQUksRUFBRSxPQUFPO2FBQ1AsQ0FBQztZQUVULE1BQU0saUJBQWlCLEdBQXFDO2dCQUMxRCxLQUFLLEVBQUU7b0JBQ0wsUUFBUSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQztvQkFDdEMsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsT0FBTyxFQUFFLENBQUM7b0JBQ3ZCLFVBQVUsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDO2lCQUNoQztnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsY0FBYyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxFQUFFLDRCQUE0QjtvQkFDMUUsU0FBUyxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBQyxFQUFFLENBQUM7aUJBQ3hEO2FBQ0YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLHNCQUFzQjtnQkFDckMsVUFBVSxFQUFFLGdCQUFnQjtnQkFDNUIsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsZUFBZTtnQkFDdEIsS0FBSyxFQUFFO29CQUNMLGNBQWMsRUFBRSxrQkFBa0I7b0JBQ2xDLFNBQVMsRUFBRSxRQUFRO29CQUNuQixZQUFZLEVBQUUsY0FBYztpQkFDN0I7YUFDRixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLG9DQUFvQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2xELE1BQU0sb0JBQW9CLEdBQVU7Z0JBQ2xDLE9BQU8sRUFBRSxvQkFBb0I7Z0JBQzdCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixTQUFTLEVBQUUsc0JBQXNCO2dCQUNqQyxTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxRQUFRLEVBQUUsa0JBQWtCO2dCQUM1QixJQUFJLEVBQUUsT0FBTzthQUNQLENBQUM7WUFFVCxNQUFNLGlCQUFpQixHQUFxQztnQkFDMUQsS0FBSyxFQUFFO29CQUNMLFFBQVEsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQyx5QkFBeUI7aUJBQ2pFO2dCQUNELEtBQUssRUFBRTtvQkFDTCxjQUFjLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxrQkFBa0IsRUFBRSxDQUFDO2lCQUM3QzthQUNGLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7Z0JBQzVDLGFBQWEsRUFBRSxzQkFBc0I7Z0JBQ3JDLFVBQVUsRUFBRSxnQkFBZ0I7Z0JBQzVCLGlCQUFpQjtnQkFDakIsS0FBSyxFQUFFLG9CQUFvQjtnQkFDM0IsS0FBSyxFQUFFO29CQUNMLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxrQ0FBa0M7b0JBQ3RFLFNBQVMsRUFBRSxRQUFRO2lCQUNwQjtnQkFDRCxhQUFhLEVBQUUsSUFBSTthQUNwQixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNoQyxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN4QyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLDBCQUEwQixFQUFFLEdBQUcsRUFBRTtRQUV4QyxJQUFBLFlBQUUsRUFBQyxnREFBZ0QsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM5RCxNQUFNLG9CQUFvQixHQUFVO2dCQUNsQyxPQUFPLEVBQUUsY0FBYztnQkFDdkIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFNBQVMsRUFBRSxpQkFBaUI7Z0JBQzVCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixVQUFVLEVBQUUsUUFBUTtnQkFDcEIsYUFBYSxFQUFFLFdBQVc7Z0JBQzFCLGNBQWMsRUFBRSxZQUFZO2dCQUM1QixVQUFVLEVBQUUsZUFBZTtnQkFDM0IsUUFBUSxFQUFFLElBQUk7YUFDZixDQUFDO1lBRUYsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxVQUFVLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxRQUFRLEVBQUUsQ0FBQztvQkFDOUIsYUFBYSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7b0JBQ25DLGNBQWMsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsWUFBWSxFQUFFLFNBQVMsRUFBRSxXQUFXLENBQUMsRUFBRSxDQUFDO29CQUNwRSxVQUFVLEVBQUUsQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQztvQkFDaEMsUUFBUSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQ3pCO2dCQUNELEtBQUssRUFBRTtvQkFDTCxTQUFTLEVBQUUsQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQztvQkFDL0IsYUFBYSxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxhQUFhLEVBQUUsU0FBUyxFQUFFLGNBQWMsQ0FBQyxFQUFFLENBQUM7b0JBQ3ZFLFlBQVksRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsVUFBVSxDQUFDLEVBQUUsQ0FBQztpQkFDbEU7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsa0JBQWtCO2dCQUNqQyxVQUFVLEVBQUUsZUFBZTtnQkFDM0IsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsb0JBQW9CO2dCQUMzQixLQUFLLEVBQUU7b0JBQ0wsU0FBUyxFQUFFLGFBQWE7b0JBQ3hCLGFBQWEsRUFBRSxhQUFhO29CQUM1QixZQUFZLEVBQUUsUUFBUTtvQkFDdEIsS0FBSyxFQUFFLDZCQUE2QjtpQkFDckM7YUFDRixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLCtEQUErRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzdFLG1HQUFtRztZQUNuRyx3R0FBd0c7WUFDeEcsTUFBTSxZQUFZLEdBQVU7Z0JBQzFCLE9BQU8sRUFBRSxhQUFhO2dCQUN0QixTQUFTLEVBQUUsTUFBTTtnQkFDakIsU0FBUyxFQUFFLGlCQUFpQjtnQkFDNUIsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsVUFBVSxFQUFFLGlCQUFpQixFQUFFLDhCQUE4QjtnQkFDN0QsUUFBUSxFQUFFLElBQUk7YUFDUixDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxVQUFVLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxRQUFRLEVBQUUsQ0FBQyxFQUFFLGdDQUFnQztvQkFDaEUsYUFBYSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQywyQ0FBMkM7aUJBQ2hGO2FBQ0YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLGtCQUFrQjtnQkFDakMsVUFBVSxFQUFFLGVBQWU7Z0JBQzNCLGlCQUFpQjtnQkFDakIsS0FBSyxFQUFFLFlBQVk7Z0JBQ25CLEtBQUssRUFBRTtvQkFDTCxTQUFTLEVBQUUsYUFBYTtvQkFDeEIsYUFBYSxFQUFFLGFBQWE7aUJBQzdCO2dCQUNELGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2hDLElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsb0RBQW9EO1FBQzdGLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMseURBQXlELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDdkUsTUFBTSxnQkFBZ0IsR0FBVTtnQkFDOUIsT0FBTyxFQUFFLGtCQUFrQjtnQkFDM0IsU0FBUyxFQUFFLGlCQUFpQjtnQkFDNUIsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsZ0JBQWdCLEVBQUUsU0FBUztnQkFDM0IsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPO2dCQUN4QixVQUFVLEVBQUUsR0FBRztnQkFDZixrQkFBa0IsRUFBRSxVQUFVO2FBQ3hCLENBQUM7WUFFVCxNQUFNLGlCQUFpQixHQUFxQztnQkFDMUQsS0FBSyxFQUFFO29CQUNMLGdCQUFnQixFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLEVBQUUsQ0FBQztvQkFDekQsVUFBVSxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRSwrQkFBK0I7b0JBQzFELFVBQVUsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsNkJBQTZCO29CQUN6RCxrQkFBa0IsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLFVBQVUsRUFBRSxDQUFDO2lCQUN6QztnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsVUFBVSxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRSw4QkFBOEI7b0JBQ2pFLFFBQVEsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLEVBQUUsQ0FBQztpQkFDaEU7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsaUJBQWlCO2dCQUNoQyxVQUFVLEVBQUUsWUFBWTtnQkFDeEIsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsZ0JBQWdCO2dCQUN2QixLQUFLLEVBQUU7b0JBQ0wsVUFBVSxFQUFFLFNBQVMsRUFBRSxRQUFRO29CQUMvQixRQUFRLEVBQUUsT0FBTztvQkFDakIsUUFBUSxFQUFFLGtCQUFrQjtpQkFDN0I7YUFDRixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLHlDQUF5QyxFQUFFLEdBQUcsRUFBRTtRQUV2RCxJQUFBLFlBQUUsRUFBQyxpRUFBaUUsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMvRSxNQUFNLGNBQWMsR0FBVTtnQkFDNUIsT0FBTyxFQUFFLFNBQVM7Z0JBQ2xCLFNBQVMsRUFBRSxvQkFBb0I7Z0JBQy9CLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLElBQUksRUFBRSxXQUFXO2dCQUNqQixXQUFXLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxpQkFBaUIsQ0FBQzthQUM1QyxDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxXQUFXLEVBQUUsQ0FBQztpQkFDNUI7Z0JBQ0QsS0FBSyxFQUFFO29CQUNMLE1BQU0sRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsU0FBUyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsUUFBUSxDQUFDLEVBQUUsQ0FBQyxFQUFFLCtCQUErQjtvQkFDOUYsTUFBTSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7b0JBQzVCLFVBQVUsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsK0JBQStCO2lCQUMzRDthQUNGLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxjQUFjLENBQUM7Z0JBQzVDLGFBQWEsRUFBRSxpQkFBaUI7Z0JBQ2hDLFVBQVUsRUFBRSxtQkFBbUI7Z0JBQy9CLGlCQUFpQjtnQkFDakIsS0FBSyxFQUFFLGNBQWM7Z0JBQ3JCLEtBQUssRUFBRTtvQkFDTCxNQUFNLEVBQUUsTUFBTTtvQkFDZCxNQUFNLEVBQUUsZ0NBQWdDO29CQUN4QyxVQUFVLEVBQUUsSUFBSTtvQkFDaEIsU0FBUyxFQUFFLFVBQVU7aUJBQ3RCO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDakMsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyw4Q0FBOEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM1RCxNQUFNLGdCQUFnQixHQUFVO2dCQUM5QixPQUFPLEVBQUUsVUFBVTtnQkFDbkIsU0FBUyxFQUFFLHVCQUF1QjtnQkFDbEMsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxrQkFBa0I7YUFDekIsQ0FBQztZQUVULE1BQU0saUJBQWlCLEdBQXFDO2dCQUMxRCxLQUFLLEVBQUU7b0JBQ0wsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQywwQkFBMEI7aUJBQ3ZEO2FBQ0YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLGlCQUFpQjtnQkFDaEMsVUFBVSxFQUFFLG1CQUFtQjtnQkFDL0IsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsZ0JBQWdCO2dCQUN2QixLQUFLLEVBQUU7b0JBQ0wsTUFBTSxFQUFFLFFBQVE7b0JBQ2hCLFNBQVMsRUFBRSxVQUFVO2lCQUN0QjtnQkFDRCxhQUFhLEVBQUUsSUFBSTthQUNwQixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNoQyxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN4QyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLG1DQUFtQyxFQUFFLEdBQUcsRUFBRTtRQUVqRCxJQUFBLFlBQUUsRUFBQyxtREFBbUQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRSwwQ0FBMEM7WUFDMUMsTUFBTSxZQUFZLEdBQVU7Z0JBQzFCLE9BQU8sRUFBRSxjQUFjO2dCQUN2QixTQUFTLEVBQUUsTUFBTTtnQkFDakIsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFNBQVMsRUFBRSxjQUFjO2dCQUN6QixTQUFTLEVBQUUsMEJBQTBCO2dCQUVyQyx5QkFBeUI7Z0JBQ3pCLEtBQUssRUFBRSxDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsY0FBYyxDQUFDO2dCQUM5QyxXQUFXLEVBQUUsU0FBUztnQkFDdEIsV0FBVyxFQUFFLENBQUMsV0FBVyxFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBRSxpQkFBaUIsQ0FBQztnQkFDN0UsZUFBZSxFQUFFLFFBQVE7Z0JBQ3pCLFVBQVUsRUFBRSxhQUFhO2dCQUN6QixjQUFjLEVBQUU7b0JBQ2QsU0FBUyxFQUFFLEtBQUs7b0JBQ2hCLE9BQU8sRUFBRSxFQUFFO29CQUNYLFdBQVcsRUFBRSxLQUFLO2lCQUNuQjtnQkFDRCxpQkFBaUIsRUFBRSxjQUFjO2FBQzNCLENBQUM7WUFFVCxNQUFNLGlCQUFpQixHQUFxQztnQkFDaEQsS0FBSyxFQUFFO29CQUNiLDZEQUE2RDtvQkFDN0QsS0FBSyxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFlLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO29CQUM1RixXQUFXLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQztvQkFFeEQsbUVBQW1FO29CQUNuRSxXQUFXLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLFdBQXFCLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLElBQUksV0FBVyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7b0JBQzFILGVBQWUsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUM7b0JBRXRELDBCQUEwQjtvQkFDMUIsVUFBVSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsYUFBYSxFQUFFLENBQUM7b0JBRW5DLHFCQUFxQjtvQkFDckIsaUJBQWlCLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLGNBQWMsRUFBRSxRQUFRLEVBQUUsWUFBWSxDQUFDLEVBQUUsQ0FBQztpQkFDMUU7Z0JBQ0gsS0FBSyxFQUFFO29CQUNMLHdDQUF3QztvQkFDeEMsTUFBTSxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLENBQUM7b0JBQ3hCLHNDQUFzQztvQkFDdEMsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQztpQkFDekM7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsbUJBQW1CO2dCQUNsQyxVQUFVLEVBQUUsZUFBZTtnQkFDM0IsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsWUFBWTtnQkFDbkIsS0FBSyxFQUFFO29CQUNMLE1BQU0sRUFBRSxLQUFLO29CQUNiLFdBQVcsRUFBRSxpQkFBaUI7b0JBQzlCLFVBQVUsRUFBRSxhQUFhO29CQUN6QixXQUFXLEVBQUUsMkJBQTJCO2lCQUN6QzthQUNGLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2pDLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsNkNBQTZDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDM0QsTUFBTSxXQUFXLEdBQVU7Z0JBQ3pCLE9BQU8sRUFBRSxhQUFhO2dCQUN0QixTQUFTLEVBQUUsTUFBTTtnQkFDakIsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFNBQVMsRUFBRSxjQUFjO2dCQUN6QixTQUFTLEVBQUUsMEJBQTBCO2dCQUVyQyxLQUFLLEVBQUUsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDO2dCQUM3QixXQUFXLEVBQUUsVUFBVTtnQkFDdkIsV0FBVyxFQUFFLENBQUMsV0FBVyxFQUFFLGFBQWEsQ0FBQztnQkFDekMsZUFBZSxFQUFFLFFBQVE7Z0JBQ3pCLFVBQVUsRUFBRSxhQUFhO2dCQUN6QixjQUFjLEVBQUU7b0JBQ2QsU0FBUyxFQUFFLENBQUM7b0JBQ1osT0FBTyxFQUFFLENBQUM7b0JBQ1YsV0FBVyxFQUFFLENBQUM7aUJBQ2Y7Z0JBQ0QsaUJBQWlCLEVBQUUsUUFBUTthQUNyQixDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxLQUFLLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEtBQWUsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUMsRUFBRSx3QkFBd0I7b0JBQ3RILGlCQUFpQixFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxjQUFjLEVBQUUsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLHlCQUF5QjtpQkFDdEY7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsbUJBQW1CO2dCQUNsQyxVQUFVLEVBQUUsZUFBZTtnQkFDM0IsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsV0FBVztnQkFDbEIsS0FBSyxFQUFFO29CQUNMLE1BQU0sRUFBRSxLQUFLO29CQUNiLFdBQVcsRUFBRSxpQkFBaUI7aUJBQy9CO2dCQUNELGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2hDLElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsc0RBQXNEO1FBQy9GLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsbURBQW1ELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDakUsMkNBQTJDO1lBQzNDLE1BQU0sZUFBZSxHQUFVO2dCQUM3QixPQUFPLEVBQUUsaUJBQWlCO2dCQUMxQixTQUFTLEVBQUUsTUFBTTtnQkFDakIsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFNBQVMsRUFBRSxhQUFhO2dCQUN4QixTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxRQUFRLEVBQUUsaUJBQWlCO2dCQUUzQixnREFBZ0Q7Z0JBQ2hELFlBQVksRUFBRTtvQkFDWixJQUFJLEVBQUUsWUFBWTtvQkFDbEIsTUFBTSxFQUFFLFFBQVE7b0JBQ2hCLFFBQVEsRUFBRSxDQUFDLG9CQUFvQixFQUFFLGlCQUFpQixFQUFFLEtBQUssRUFBRSxZQUFZLENBQUM7b0JBQ3hFLE1BQU0sRUFBRTt3QkFDTixLQUFLLEVBQUUsSUFBSTt3QkFDWCxPQUFPLEVBQUUsWUFBWSxFQUFFLFFBQVE7d0JBQy9CLGdCQUFnQixFQUFFLE9BQU87cUJBQzFCO2lCQUNGO2dCQUNELFFBQVEsRUFBRSxDQUFDLGtCQUFrQixFQUFFLGVBQWUsQ0FBQztnQkFDL0MsY0FBYyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsZUFBZSxDQUFDO2dCQUNyRCxLQUFLLEVBQUU7b0JBQ0wsaUJBQWlCLEVBQUUsS0FBSztvQkFDeEIsV0FBVyxFQUFFLFdBQVcsRUFBRSxPQUFPO29CQUNqQyxXQUFXLEVBQUUsRUFBRTtpQkFDaEI7Z0JBQ0QsWUFBWSxFQUFFO29CQUNaLGtCQUFrQixFQUFFLElBQUk7b0JBQ3hCLG9CQUFvQixFQUFFLElBQUk7aUJBQzNCO2FBQ0ssQ0FBQztZQUVULE1BQU0saUJBQWlCLEdBQXFDO2dCQUMxRCxLQUFLLEVBQUU7b0JBQ0wsd0VBQXdFO29CQUN4RSxZQUFZLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEdBQVEsRUFBRSxFQUFFLENBQUMsR0FBRyxFQUFFLElBQUksS0FBSyxZQUFZLElBQUksR0FBRyxFQUFFLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztvQkFFL0YscURBQXFEO29CQUNyRCxjQUFjLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLFFBQWtCLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO29CQUVuSCwyREFBMkQ7b0JBQzNELFlBQVksRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsS0FBVSxFQUFFLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDO2lCQUNuRjtnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsOEJBQThCO29CQUM5QixVQUFVLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsRUFBRSxDQUFDO29CQUNoRCxTQUFTLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLE9BQU8sRUFBRSxRQUFRLEVBQUUsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQztpQkFDNUY7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsd0JBQXdCO2dCQUN2QyxVQUFVLEVBQUUsaUJBQWlCO2dCQUM3QixpQkFBaUI7Z0JBQ2pCLEtBQUssRUFBRSxlQUFlO2dCQUN0QixLQUFLLEVBQUU7b0JBQ0wsVUFBVSxFQUFFLFVBQVU7b0JBQ3RCLFNBQVMsRUFBRSxRQUFRO29CQUNuQixjQUFjLEVBQUUsSUFBSTtpQkFDckI7YUFDRixDQUFDLENBQUM7WUFFSCxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLHNEQUFzRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3BFLHVEQUF1RDtZQUN2RCxNQUFNLFdBQVcsR0FBVTtnQkFDekIsT0FBTyxFQUFFLGtCQUFrQjtnQkFDM0IsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixTQUFTLEVBQUUsYUFBYTtnQkFDeEIsU0FBUyxFQUFFLDBCQUEwQjtnQkFFckMseUJBQXlCO2dCQUN6QixXQUFXLEVBQUU7b0JBQ1gsS0FBSyxFQUFFLEVBQUUsRUFBRSxXQUFXO29CQUN0QixLQUFLLEVBQUUsS0FBSztvQkFDWixPQUFPLEVBQUUsRUFBRTtvQkFDWCxXQUFXLEVBQUUsU0FBUztpQkFDdkI7Z0JBQ0QsTUFBTSxFQUFFO29CQUNOLElBQUksRUFBRSxTQUFTO29CQUNmLE9BQU8sRUFBRSxJQUFJO29CQUNiLFFBQVEsRUFBRSxTQUFTO2lCQUNwQjtnQkFDRCxRQUFRLEVBQUU7b0JBQ1IsV0FBVyxFQUFFLElBQUk7b0JBQ2pCLFdBQVcsRUFBRSxLQUFLO29CQUNsQixZQUFZLEVBQUUsRUFBRTtpQkFDakI7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLFdBQVcsRUFBRSxJQUFJO29CQUNqQixhQUFhLEVBQUUsSUFBSTtvQkFDbkIsU0FBUyxFQUFFLDBCQUEwQjtpQkFDdEM7YUFDSyxDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxnRUFBZ0U7b0JBQ2hFLFdBQVcsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsSUFBUyxFQUFFLEVBQUUsQ0FBQyxJQUFJLEVBQUUsS0FBSyxLQUFLLEtBQUssSUFBSSxJQUFJLEVBQUUsS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUU1Riw2QkFBNkI7b0JBQzdCLE1BQU0sRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsTUFBVyxFQUFFLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxLQUFLLElBQUksRUFBRSxDQUFDO29CQUUvRCx3QkFBd0I7b0JBQ3hCLFFBQVEsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FBQyxHQUFHLEVBQUUsV0FBVyxLQUFLLElBQUksSUFBSSxHQUFHLEVBQUUsV0FBVyxLQUFLLEtBQUssRUFBRSxDQUFDO29CQUU3RixxQkFBcUI7b0JBQ3JCLE9BQU8sRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsSUFBUyxFQUFFLEVBQUUsQ0FBQyxJQUFJLEVBQUUsYUFBYSxLQUFLLElBQUksSUFBSSxJQUFJLEVBQUUsV0FBVyxLQUFLLElBQUksRUFBRSxDQUFDO2lCQUNqRztnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsaUNBQWlDO29CQUNqQyxhQUFhLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSxjQUFjLENBQUMsRUFBRSxDQUFDO29CQUMvRSxrQkFBa0IsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsY0FBYyxFQUFFLFVBQVUsQ0FBQyxFQUFFLENBQUM7aUJBQy9EO2FBQ0YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLGNBQWMsQ0FBQztnQkFDNUMsYUFBYSxFQUFFLDRCQUE0QjtnQkFDM0MsVUFBVSxFQUFFLGdCQUFnQjtnQkFDNUIsaUJBQWlCO2dCQUNqQixLQUFLLEVBQUUsV0FBVztnQkFDbEIsS0FBSyxFQUFFO29CQUNMLGFBQWEsRUFBRSxnQkFBZ0I7b0JBQy9CLGtCQUFrQixFQUFFLGNBQWM7b0JBQ2xDLFlBQVksRUFBRSxpQkFBaUI7aUJBQ2hDO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDakMsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyw0Q0FBNEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMxRCxNQUFNLFVBQVUsR0FBVTtnQkFDeEIsT0FBTyxFQUFFLFlBQVk7Z0JBQ3JCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixVQUFVLEVBQUUsU0FBUztnQkFDckIsU0FBUyxFQUFFLGNBQWM7Z0JBQ3pCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBRXJDLFdBQVcsRUFBRTtvQkFDWCxLQUFLLEVBQUUsRUFBRSxFQUFFLFlBQVk7b0JBQ3ZCLEtBQUssRUFBRSxNQUFNO29CQUNiLE9BQU8sRUFBRSxDQUFDLFlBQVksRUFBRSxrQkFBa0IsRUFBRSxrQkFBa0IsQ0FBQztvQkFDL0QsV0FBVyxFQUFFLFVBQVU7aUJBQ3hCO2dCQUNELE1BQU0sRUFBRTtvQkFDTixJQUFJLEVBQUUsUUFBUTtvQkFDZCxPQUFPLEVBQUUsS0FBSyxFQUFFLG1CQUFtQjtvQkFDbkMsUUFBUSxFQUFFLEtBQUs7aUJBQ2hCO2dCQUNELFFBQVEsRUFBRTtvQkFDUixXQUFXLEVBQUUsS0FBSyxFQUFFLG1CQUFtQjtvQkFDdkMsV0FBVyxFQUFFLElBQUksRUFBRSxlQUFlO29CQUNsQyxZQUFZLEVBQUUsQ0FBQyxvQkFBb0IsRUFBRSxrQkFBa0IsQ0FBQztpQkFDekQ7YUFDSyxDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxXQUFXLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLElBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxLQUFLLEtBQUssSUFBSSxJQUFJLEVBQUUsS0FBSyxLQUFLLFNBQVMsQ0FBQyxJQUFJLElBQUksRUFBRSxLQUFLLElBQUksRUFBRSxFQUFFLENBQUM7b0JBQ25ILE1BQU0sRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsTUFBVyxFQUFFLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxLQUFLLElBQUksRUFBRSxDQUFDO29CQUMvRCxRQUFRLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEdBQVEsRUFBRSxFQUFFLENBQUMsR0FBRyxFQUFFLFdBQVcsS0FBSyxJQUFJLElBQUksR0FBRyxFQUFFLFdBQVcsS0FBSyxLQUFLLEVBQUUsQ0FBQztpQkFDOUY7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsNEJBQTRCO2dCQUMzQyxVQUFVLEVBQUUsZ0JBQWdCO2dCQUM1QixpQkFBaUI7Z0JBQ2pCLEtBQUssRUFBRSxVQUFVO2dCQUNqQixLQUFLLEVBQUU7b0JBQ0wsYUFBYSxFQUFFLGNBQWM7b0JBQzdCLGtCQUFrQixFQUFFLGNBQWM7aUJBQ25DO2dCQUNELGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2hDLElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsNERBQTREO1FBQ3JHLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsbURBQW1ELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDakUsTUFBTSxlQUFlLEdBQVU7Z0JBQzdCLE9BQU8sRUFBRSxvQkFBb0I7Z0JBQzdCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixVQUFVLEVBQUUsU0FBUztnQkFDckIsU0FBUyxFQUFFLGNBQWM7Z0JBQ3pCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFFBQVEsRUFBRSxxQkFBcUI7Z0JBRS9CLGlEQUFpRDtnQkFDakQsVUFBVSxFQUFFO29CQUNWLE1BQU0sRUFBRSxXQUFXO29CQUNuQixjQUFjLEVBQUUsQ0FBQyxZQUFZLEVBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBQztvQkFDckQsVUFBVSxFQUFFLEVBQUU7b0JBQ2QsVUFBVSxFQUFFLEVBQUUsV0FBVyxFQUFFLHFCQUFxQixFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUU7b0JBQ3JFLFlBQVksRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsaUJBQWlCLEVBQUUsWUFBWSxFQUFFO2lCQUNuRTtnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsWUFBWSxFQUFFLElBQUk7b0JBQ2xCLG1CQUFtQixFQUFFLENBQUMsbUJBQW1CLEVBQUUsYUFBYSxDQUFDO29CQUN6RCxlQUFlLEVBQUUsSUFBSSxFQUFFLFVBQVU7b0JBQ2pDLGtCQUFrQixFQUFFLENBQUMsYUFBYSxFQUFFLGNBQWMsQ0FBQztvQkFDbkQsa0JBQWtCLEVBQUUsSUFBSTtpQkFDekI7Z0JBQ0QsS0FBSyxFQUFFLENBQUMsb0JBQW9CLEVBQUUsU0FBUyxDQUFDO2dCQUN4QyxpQkFBaUIsRUFBRSxjQUFjO2FBQzNCLENBQUM7WUFFVCxNQUFNLGlCQUFpQixHQUFxQztnQkFDMUQsS0FBSyxFQUFFO29CQUNMLDJEQUEyRDtvQkFDM0QsVUFBVSxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxJQUFTLEVBQUUsRUFBRSxDQUNuQyxJQUFJLEVBQUUsTUFBTSxLQUFLLFdBQVc7Z0NBQzVCLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLGNBQWMsQ0FBQyxJQUFJLElBQUksQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQztnQ0FDakYsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEtBQUssQ0FBQztnQ0FDL0QsSUFBSSxFQUFFLFlBQVksRUFBRSxTQUFTLEtBQUssSUFBSTt5QkFDdkMsQ0FBQztvQkFFRixzREFBc0Q7b0JBQ3RELEtBQUssRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsS0FBVSxFQUFFLEVBQUUsQ0FDL0IsS0FBSyxFQUFFLFlBQVksS0FBSyxJQUFJO2dDQUM1QixLQUFLLEVBQUUsZUFBZSxJQUFJLElBQUk7Z0NBQzlCLEtBQUssRUFBRSxrQkFBa0IsS0FBSyxJQUFJO3lCQUNuQyxDQUFDO29CQUVGLGtCQUFrQjtvQkFDbEIsS0FBSyxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFlLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUM7b0JBQ3RHLGlCQUFpQixFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxjQUFjLEVBQUUsUUFBUSxDQUFDLEVBQUUsQ0FBQztpQkFDNUQ7Z0JBQ0QsS0FBSyxFQUFFO29CQUNMLGtDQUFrQztvQkFDbEMsZUFBZSxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxjQUFjLEVBQUUsa0JBQWtCLENBQUMsRUFBRSxDQUFDO29CQUNuRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQztvQkFDcEIsbUJBQW1CLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsU0FBUyxDQUFDLEVBQUUsQ0FBQztpQkFDOUQ7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsMkJBQTJCO2dCQUMxQyxVQUFVLEVBQUUsa0JBQWtCO2dCQUM5QixpQkFBaUI7Z0JBQ2pCLEtBQUssRUFBRSxlQUFlO2dCQUN0QixLQUFLLEVBQUU7b0JBQ0wsZUFBZSxFQUFFLGNBQWM7b0JBQy9CLE1BQU0sRUFBRSxNQUFNO29CQUNkLG1CQUFtQixFQUFFLEtBQUs7b0JBQzFCLFVBQVUsRUFBRSxXQUFXO2lCQUN4QjthQUNGLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2pDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0IH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5pbXBvcnQgeyBWYWxpZGF0b3IgfSBmcm9tICcuL3ZhbGlkYXRvcic7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gXCIuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBFbnRpdHlWYWxpZGF0aW9ucyB9IGZyb20gJy4vdHlwZXMnO1xuXG5kZXNjcmliZSgnVmFsaWRhdG9yIFJlYWwtV29ybGQgQWN0b3IgU2NlbmFyaW9zJywgKCkgPT4ge1xuICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yKCk7XG5cbiAgZGVzY3JpYmUoJ1JvbGUtQmFzZWQgQXV0aG9yaXphdGlvbicsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGFkbWluIHVzZXIgYWNjZXNzIHRvIHNlbnNpdGl2ZSBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWRtaW5BY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdhZG1pbi11c2VyLTAwMScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYWRtaW4tMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByb2xlOiAnYWRtaW4nLFxuICAgICAgICBkZXBhcnRtZW50OiAnYWRtaW5pc3RyYXRpb24nLFxuICAgICAgICBjbGVhcmFuY2VMZXZlbDogJ2hpZ2gnXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHJvbGU6IFt7IGVxOiAnYWRtaW4nIH1dLFxuICAgICAgICAgIGNsZWFyYW5jZUxldmVsOiBbeyBlcTogJ2hpZ2gnIH1dLFxuICAgICAgICAgIGF1dGhNZXRob2Q6IFt7IGVxOiAnY29nbml0bycgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBvcGVyYXRpb25UeXBlOiBbeyBlcTogJ3NlbnNpdGl2ZS1kYXRhLWFjY2VzcycgfV0sXG4gICAgICAgICAganVzdGlmaWNhdGlvbjogW3sgcmVxdWlyZWQ6IHRydWUgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2FjY2Vzc1NlbnNpdGl2ZURhdGEnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnU2VjdXJpdHlPcGVyYXRpb24nLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IGFkbWluQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ3NlbnNpdGl2ZS1kYXRhLWFjY2VzcycsXG4gICAgICAgICAganVzdGlmaWNhdGlvbjogJ1NlY3VyaXR5IGF1ZGl0IHJlcXVpcmVkIGJ5IGNvbXBsaWFuY2UgdGVhbSdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IHJlZ3VsYXIgdXNlciBhY2Nlc3MgdG8gYWRtaW4gb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlZ3VsYXJVc2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci0wMDEnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXVzZXItMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMTowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByb2xlOiAndXNlcicsIC8vIE5vdCBhZG1pblxuICAgICAgICBkZXBhcnRtZW50OiAnbWFya2V0aW5nJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ2FkbWluJyB9XSAvLyBSZXF1aXJlcyBhZG1pbiByb2xlXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdhY2Nlc3NTZW5zaXRpdmVEYXRhJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1NlY3VyaXR5T3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiByZWd1bGFyVXNlckFjdG9yLFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlLFxuICAgICAgICB2ZXJib3NlRXJyb3JzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycz8uWzBdPy5tZXNzYWdlSWRzKS50b0NvbnRhaW4oJ3ZhbGlkYXRpb24uZW50aXR5LnNlY3VyaXR5b3BlcmF0aW9uLmFjdG9yLnJvbGUuZXEuYWRtaW4nKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgbWFuYWdlciBhcHByb3ZhbCBsaW1pdHMgYmFzZWQgb24gYWN0b3IgcHJvcGVydGllcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1hbmFnZXJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdtZ3ItMDAxJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFwcHJvdmFsLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTI6MDA6MDAuMDAwWicsXG4gICAgICAgIHJvbGU6ICdtYW5hZ2VyJyxcbiAgICAgICAgZGVwYXJ0bWVudDogJ2ZpbmFuY2UnLFxuICAgICAgICBhcHByb3ZhbExpbWl0OiAxMDAwMFxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ21hbmFnZXInIH1dLFxuICAgICAgICAgIGRlcGFydG1lbnQ6IFt7IGVxOiAnZmluYW5jZScgfV0sXG4gICAgICAgICAgYXBwcm92YWxMaW1pdDogW3sgZ3RlOiA1MDAwIH1dIC8vIE11c3QgaGF2ZSBhcHByb3ZhbCBsaW1pdCA+PSA1MDAwXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYW1vdW50OiBbeyBsdGU6IDEwMDAwIH1dLCAvLyBBbW91bnQgbXVzdCBiZSB3aXRoaW4gbGltaXRcbiAgICAgICAgICB2ZW5kb3I6IFt7IHJlcXVpcmVkOiB0cnVlIH1dLFxuICAgICAgICAgIGNhdGVnb3J5OiBbeyBpbkxpc3Q6IFsnb2ZmaWNlLXN1cHBsaWVzJywgJ3NvZnR3YXJlJywgJ2VxdWlwbWVudCddIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdhcHByb3ZlRXhwZW5zZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdFeHBlbnNlQXBwcm92YWwnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IG1hbmFnZXJBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBhbW91bnQ6IDc1MDAsXG4gICAgICAgICAgdmVuZG9yOiAnT2ZmaWNlIERlcG90JyxcbiAgICAgICAgICBjYXRlZ29yeTogJ29mZmljZS1zdXBwbGllcycsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdNb250aGx5IG9mZmljZSBzdXBwbHkgb3JkZXInXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCBhcHByb3ZhbCB3aGVuIGFtb3VudCBleGNlZWRzIGFjdG9yIGFwcHJvdmFsIGxpbWl0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbG93TGV2ZWxNYW5hZ2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnbWdyLWp1bmlvci0wMDEnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYXBwcm92YWwtMDAyJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMzowMDowMC4wMDBaJyxcbiAgICAgICAgcm9sZTogJ21hbmFnZXInLFxuICAgICAgICBkZXBhcnRtZW50OiAnZmluYW5jZScsXG4gICAgICAgIGFwcHJvdmFsTGltaXQ6IDIwMDAgLy8gTG93IGFwcHJvdmFsIGxpbWl0XG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGFwcHJvdmFsTGltaXQ6IFt7IGd0ZTogNTAwMCB9XSAvLyBSZXF1aXJlcyBoaWdoZXIgYXBwcm92YWwgbGltaXRcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2FwcHJvdmVFeHBlbnNlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0V4cGVuc2VBcHByb3ZhbCcsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogbG93TGV2ZWxNYW5hZ2VyQWN0b3IsXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NlcnZpY2UgQXV0aGVudGljYXRpb24nLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBBUEkga2V5IHNlcnZpY2Ugb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaVNlcnZpY2VBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdhcGkta2V5OmRhdGEtc3luYy1zZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1zZXJ2aWNlLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTQ6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYXBpS2V5OiB7XG4gICAgICAgICAgaWQ6ICdzeW5jLWtleS0xMjMnLFxuICAgICAgICAgIHNvdXJjZTogJ3JlcXVlc3QtY29udGV4dCdcbiAgICAgICAgfSxcbiAgICAgICAgc291cmNlSXA6ICcxMC4wLjEuMTAwJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGFjdG9yVHlwZTogW3sgZXE6ICdzZXJ2aWNlJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbIHsgZXE6ICdhcGkta2V5JyB9IF0sXG4gICAgICAgICAgYXBpS2V5OiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBzb3VyY2VJcDogW3sgcmVxdWlyZWQ6IHRydWUgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBiYXRjaFNpemU6IFt7IGx0ZTogMTAwMCB9XSwgLy8gU2VydmljZXMgY2FuIHByb2Nlc3MgdXAgdG8gMTAwMCByZWNvcmRzXG4gICAgICAgICAgZGF0YVNvdXJjZTogW3sgcmVxdWlyZWQ6IHRydWUgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2JhdGNoU3luYycsXG4gICAgICAgIGVudGl0eU5hbWU6ICdEYXRhU3luY2hyb25pemF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBhcGlTZXJ2aWNlQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYmF0Y2hTaXplOiA1MDAsXG4gICAgICAgICAgZGF0YVNvdXJjZTogJ2V4dGVybmFsLWNybScsXG4gICAgICAgICAgcmVjb3JkczogWydyZWNvcmQxJywgJ3JlY29yZDInLCAncmVjb3JkMyddXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCB1c2VyIGF1dGhlbnRpY2F0aW9uIGZvciBzZXJ2aWNlLW9ubHkgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHVzZXJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLTAwMScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLCAvLyBTaG91bGQgYmUgc2VydmljZVxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdXNlci1zZXJ2aWNlLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTU6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyAvLyBTaG91bGQgYmUgYXBpLWtleVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGFjdG9yVHlwZTogW3sgZXE6ICdzZXJ2aWNlJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbeyBlcTogJ2FwaS1rZXknIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdiYXRjaFN5bmMnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnRGF0YVN5bmNocm9uaXphdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogdXNlckFjdG9yLFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMik7IC8vIEJvdGggYWN0b3JUeXBlIGFuZCBhdXRoTWV0aG9kIHdpbGwgZmFpbFxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzeXN0ZW0gYWN0b3IgZm9yIG1haW50ZW5hbmNlIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzeXN0ZW1BY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvclR5cGU6ICdhbm9ueW1vdXMnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtc3lzdGVtLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMDI6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBtYWludGVuYW5jZVdpbmRvdzogdHJ1ZVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBhY3RvcklkOiBbeyBlcTogJ2Fub255bW91cycgfV0sXG4gICAgICAgICAgYWN0b3JUeXBlOiBbeyBlcTogJ2Fub255bW91cycgfV0sXG4gICAgICAgICAgYXV0aE1ldGhvZDogW3sgZXE6ICdhbm9ueW1vdXMnIH1dLFxuICAgICAgICAgIG1haW50ZW5hbmNlV2luZG93OiBbeyBlcTogdHJ1ZSB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG9wZXJhdGlvblR5cGU6IFt7IGluTGlzdDogWydjbGVhbnVwJywgJ2JhY2t1cCcsICdtaWdyYXRpb24nXSB9XSxcbiAgICAgICAgICBhZmZlY3RlZFRhYmxlczogW3sgcmVxdWlyZWQ6IHRydWUgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ3N5c3RlbU1haW50ZW5hbmNlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ01haW50ZW5hbmNlT3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBzeXN0ZW1BY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBvcGVyYXRpb25UeXBlOiAnY2xlYW51cCcsXG4gICAgICAgICAgYWZmZWN0ZWRUYWJsZXM6IFsnbG9ncycsICd0ZW1wX2RhdGEnXSxcbiAgICAgICAgICByZXRlbnRpb25EYXlzOiA5MFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnVGVuYW50IElzb2xhdGlvbicsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHRlbmFudC1zY29wZWQgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHRlbmFudFVzZXJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd0ZW5hbnQtYWRtaW4tMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS10ZW5hbnQtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxNjowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICB0ZW5hbnRJZDogJ2NvbXBhbnktYS10ZW5hbnQnLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgZ3JvdXBzOiBbJ3RlYW0tYWRtaW4nXVxuICAgICAgICB9LFxuICAgICAgICByb2xlOiAnYWRtaW4nXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHRlbmFudElkOiBbeyBlcTogJ2NvbXBhbnktYS10ZW5hbnQnIH1dLFxuICAgICAgICAgIHJvbGU6IFt7IGVxOiAnYWRtaW4nIH1dLFxuICAgICAgICAgIGF1dGhNZXRob2Q6IFt7IGVxOiAnY29nbml0bycgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICB0YXJnZXRUZW5hbnRJZDogW3sgZXE6ICdjb21wYW55LWEtdGVuYW50JyB9XSwgLy8gTXVzdCBtYXRjaCBhY3RvcidzIHRlbmFudFxuICAgICAgICAgIG9wZXJhdGlvbjogW3sgaW5MaXN0OiBbJ2NyZWF0ZScsICd1cGRhdGUnLCAnZGVsZXRlJ10gfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ3RlbmFudEFkbWluT3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1RlbmFudFJlc291cmNlJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiB0ZW5hbnRVc2VyQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdGFyZ2V0VGVuYW50SWQ6ICdjb21wYW55LWEtdGVuYW50JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUnLFxuICAgICAgICAgIHJlc291cmNlVHlwZTogJ3VzZXItYWNjb3VudCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJldmVudCBjcm9zcy10ZW5hbnQgYWNjZXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbWFsaWNpb3VzVGVuYW50QWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnbWFsaWNpb3VzLXVzZXItMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1jcm9zcy10ZW5hbnQtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxNzowMDowMC4wMDBaJyxcbiAgICAgICAgdGVuYW50SWQ6ICdjb21wYW55LWItdGVuYW50JyxcbiAgICAgICAgcm9sZTogJ2FkbWluJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICB0ZW5hbnRJZDogW3sgZXE6ICdjb21wYW55LWEtdGVuYW50JyB9XSAvLyBNdXN0IGJlIGZyb20gY29tcGFueSBBXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdGFyZ2V0VGVuYW50SWQ6IFt7IGVxOiAnY29tcGFueS1hLXRlbmFudCcgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ3RlbmFudEFkbWluT3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1RlbmFudFJlc291cmNlJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBtYWxpY2lvdXNUZW5hbnRBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICB0YXJnZXRUZW5hbnRJZDogJ2NvbXBhbnktYS10ZW5hbnQnLCAvLyBUcnlpbmcgdG8gYWNjZXNzIGNvbXBhbnkgQSBkYXRhXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZGVsZXRlJ1xuICAgICAgICB9LFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDb21wbGV4IEFjdG9yIFZhbGlkYXRpb24nLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBtdWx0aS1maWVsZCBhY3RvciByZXF1aXJlbWVudHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBxdWFsaWZpZWREb2N0b3JBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdkci1zbWl0aC0wMDEnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLW1lZGljYWwtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxODowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBwcm9mZXNzaW9uOiAnZG9jdG9yJyxcbiAgICAgICAgbGljZW5zZU51bWJlcjogJ01ELTEyMzQ1NicsXG4gICAgICAgIHNwZWNpYWxpemF0aW9uOiAnY2FyZGlvbG9neScsXG4gICAgICAgIGhvc3BpdGFsSWQ6ICdob3NwLW1haW4tMDAxJyxcbiAgICAgICAgaXNBY3RpdmU6IHRydWVcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBwcm9mZXNzaW9uOiBbeyBlcTogJ2RvY3RvcicgfV0sXG4gICAgICAgICAgbGljZW5zZU51bWJlcjogW3sgcmVxdWlyZWQ6IHRydWUgfV0sXG4gICAgICAgICAgc3BlY2lhbGl6YXRpb246IFt7IGluTGlzdDogWydjYXJkaW9sb2d5JywgJ3N1cmdlcnknLCAnbmV1cm9sb2d5J10gfV0sXG4gICAgICAgICAgaG9zcGl0YWxJZDogW3sgcmVxdWlyZWQ6IHRydWUgfV0sXG4gICAgICAgICAgaXNBY3RpdmU6IFt7IGVxOiB0cnVlIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgcGF0aWVudElkOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBwcm9jZWR1cmVUeXBlOiBbeyBpbkxpc3Q6IFsnZXhhbWluYXRpb24nLCAnc3VyZ2VyeScsICdjb25zdWx0YXRpb24nXSB9XSxcbiAgICAgICAgICB1cmdlbmN5TGV2ZWw6IFt7IGluTGlzdDogWydsb3cnLCAnbWVkaXVtJywgJ2hpZ2gnLCAnY3JpdGljYWwnXSB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnbWVkaWNhbFByb2NlZHVyZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdNZWRpY2FsUmVjb3JkJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBxdWFsaWZpZWREb2N0b3JBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBwYXRpZW50SWQ6ICdwYXRpZW50LTAwMScsXG4gICAgICAgICAgcHJvY2VkdXJlVHlwZTogJ2V4YW1pbmF0aW9uJyxcbiAgICAgICAgICB1cmdlbmN5TGV2ZWw6ICdtZWRpdW0nLFxuICAgICAgICAgIG5vdGVzOiAnUm91dGluZSBjYXJkaWFjIGV4YW1pbmF0aW9uJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgYWN0b3JzIG1pc3NpbmcgcmVxdWlyZWQgYnVzaW5lc3MgY29udGV4dCBmaWVsZHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBUaGlzIHRlc3RzIGNvbXBsZXggYnVzaW5lc3MgdmFsaWRhdGlvbiB0aGF0IGNvbnRyb2xsZXJzIGNhbiBhZGQgdmlhIGV4dHJhY3RBY3RvckNvbnRleHQgb3ZlcnJpZGVcbiAgICAgIC8vIEV4YW1wbGU6IE1lZGljYWwgc3lzdGVtIGNvbnRyb2xsZXIgYWRkcyBsaWNlbnNlIHZhbGlkYXRpb24sIGZpbmFuY2lhbCBzeXN0ZW0gYWRkcyBjcmVkaXQgY2hlY2tzLCBldGMuXG4gICAgICBjb25zdCBzdHVkZW50QWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnc3R1ZGVudC0wMDEnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXN0dWRlbnQtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxOTowMDowMC4wMDBaJyxcbiAgICAgICAgcHJvZmVzc2lvbjogJ21lZGljYWwtc3R1ZGVudCcsIC8vIE1pc3NpbmcgcmVxdWlyZWQgcHJvZmVzc2lvblxuICAgICAgICBpc0FjdGl2ZTogdHJ1ZVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBwcm9mZXNzaW9uOiBbeyBlcTogJ2RvY3RvcicgfV0sIC8vIE11c3QgaGF2ZSBzcGVjaWZpYyBwcm9mZXNzaW9uXG4gICAgICAgICAgbGljZW5zZU51bWJlcjogW3sgcmVxdWlyZWQ6IHRydWUgfV0gLy8gTXVzdCBoYXZlIGJ1c2luZXNzIGxpY2Vuc2UvY2VydGlmaWNhdGlvblxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnbWVkaWNhbFByb2NlZHVyZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdNZWRpY2FsUmVjb3JkJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBzdHVkZW50QWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgcGF0aWVudElkOiAncGF0aWVudC0wMDEnLFxuICAgICAgICAgIHByb2NlZHVyZVR5cGU6ICdleGFtaW5hdGlvbidcbiAgICAgICAgfSxcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDIpOyAvLyBwcm9mZXNzaW9uIGFuZCBsaWNlbnNlTnVtYmVyIHZhbGlkYXRpb24gYm90aCBmYWlsXG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGFjdG9yIHdpdGggY3VzdG9tIGJ1c2luZXNzIGxvZ2ljIGZpZWxkcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHByZW1pdW1Vc2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAncHJlbWl1bS11c2VyLTAwMScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcmVtaXVtLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjA6MDA6MDAuMDAwWicsXG4gICAgICAgIHN1YnNjcmlwdGlvblRpZXI6ICdwcmVtaXVtJyxcbiAgICAgICAgYWNjb3VudEFnZTogMzY1LCAvLyBkYXlzXG4gICAgICAgIHRydXN0U2NvcmU6IDg1MCxcbiAgICAgICAgdmVyaWZpY2F0aW9uU3RhdHVzOiAndmVyaWZpZWQnXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHN1YnNjcmlwdGlvblRpZXI6IFt7IGluTGlzdDogWydwcmVtaXVtJywgJ2VudGVycHJpc2UnXSB9XSxcbiAgICAgICAgICBhY2NvdW50QWdlOiBbeyBndGU6IDMwIH1dLCAvLyBNdXN0IGJlIGF0IGxlYXN0IDMwIGRheXMgb2xkXG4gICAgICAgICAgdHJ1c3RTY29yZTogW3sgZ3RlOiA3MDAgfV0sIC8vIE11c3QgaGF2ZSBoaWdoIHRydXN0IHNjb3JlXG4gICAgICAgICAgdmVyaWZpY2F0aW9uU3RhdHVzOiBbeyBlcTogJ3ZlcmlmaWVkJyB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHVwbG9hZFNpemU6IFt7IGx0ZTogMTAwMDAwMDAwMCB9XSwgLy8gUHJlbWl1bSB1c2VycyBnZXQgMUdCIGxpbWl0XG4gICAgICAgICAgZmlsZVR5cGU6IFt7IGluTGlzdDogWyd2aWRlbycsICdhdWRpbycsICdkb2N1bWVudCcsICdpbWFnZSddIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICd1cGxvYWRMYXJnZUZpbGUnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnRmlsZVVwbG9hZCcsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogcHJlbWl1bVVzZXJBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICB1cGxvYWRTaXplOiA1MDAwMDAwMDAsIC8vIDUwME1CXG4gICAgICAgICAgZmlsZVR5cGU6ICd2aWRlbycsXG4gICAgICAgICAgZmlsZU5hbWU6ICdwcmVzZW50YXRpb24ubXA0J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnSW5wdXQgVmFsaWRhdGlvbiBCYXNlZCBvbiBBY3RvciBDb250ZXh0JywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgZGlmZmVyZW50IGlucHV0IHJ1bGVzIGZvciBkaWZmZXJlbnQgYWN0b3IgdHlwZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtb2RlcmF0b3JBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdtb2QtMDAxJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLW1vZGVyYXRpb24tMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQyMTowMDowMC4wMDBaJyxcbiAgICAgICAgcm9sZTogJ21vZGVyYXRvcicsXG4gICAgICAgIHBlcm1pc3Npb25zOiBbJ2NvbnRlbnQtcmV2aWV3JywgJ3VzZXItbWFuYWdlbWVudCddXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHJvbGU6IFt7IGVxOiAnbW9kZXJhdG9yJyB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFjdGlvbjogW3sgaW5MaXN0OiBbJ2FwcHJvdmUnLCAncmVqZWN0JywgJ2ZsYWcnLCAnZGVsZXRlJ10gfV0sIC8vIE1vZGVyYXRvcnMgaGF2ZSBtb3JlIG9wdGlvbnNcbiAgICAgICAgICByZWFzb246IFt7IHJlcXVpcmVkOiB0cnVlIH1dLFxuICAgICAgICAgIG5vdGlmeVVzZXI6IFt7IGVxOiB0cnVlIH1dIC8vIE1vZGVyYXRvcnMgbXVzdCBub3RpZnkgdXNlcnNcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ21vZGVyYXRlQ29udGVudCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdDb250ZW50TW9kZXJhdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogbW9kZXJhdG9yQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYWN0aW9uOiAnZmxhZycsXG4gICAgICAgICAgcmVhc29uOiAnSW5hcHByb3ByaWF0ZSBjb250ZW50IGRldGVjdGVkJyxcbiAgICAgICAgICBub3RpZnlVc2VyOiB0cnVlLFxuICAgICAgICAgIGNvbnRlbnRJZDogJ3Bvc3QtMTIzJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgaW52YWxpZCBhY3Rpb25zIGZvciBhY3RvciByb2xlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVndWxhclVzZXJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLTAwMScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS11c2VyLW1vZGVyYXRlLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjI6MDA6MDAuMDAwWicsXG4gICAgICAgIHJvbGU6ICd1c2VyJyAvLyBOb3QgYSBtb2RlcmF0b3JcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcm9sZTogW3sgZXE6ICdtb2RlcmF0b3InIH1dIC8vIE9ubHkgbW9kZXJhdG9ycyBhbGxvd2VkXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdtb2RlcmF0ZUNvbnRlbnQnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnQ29udGVudE1vZGVyYXRpb24nLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IHJlZ3VsYXJVc2VyQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYWN0aW9uOiAnZGVsZXRlJyxcbiAgICAgICAgICBjb250ZW50SWQ6ICdwb3N0LTEyMydcbiAgICAgICAgfSxcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRW5oYW5jZWQgQWN0b3IgQ29udGV4dCBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgY29tcGxleCByb2xlLWJhc2VkIGFjY2VzcyBjb250cm9sJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gRW5oYW5jZWQgYWN0b3IgZnJvbSBjb250cm9sbGVyIG92ZXJyaWRlXG4gICAgICBjb25zdCBtYW5hZ2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnam9obi5tYW5hZ2VyJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXJiYWMtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQyMTowMDowMC4wMDBaJyxcbiAgICAgICAgXG4gICAgICAgIC8vIEVuaGFuY2VkIGJ5IGNvbnRyb2xsZXJcbiAgICAgICAgcm9sZXM6IFsnbWFuYWdlcicsICdhcHByb3ZlcicsICdidWRnZXQtb3duZXInXSxcbiAgICAgICAgcHJpbWFyeVJvbGU6ICdtYW5hZ2VyJyxcbiAgICAgICAgcGVybWlzc2lvbnM6IFsndXNlci5yZWFkJywgJ3VzZXIud3JpdGUnLCAnYnVkZ2V0LmFwcHJvdmUnLCAncmVwb3J0LmdlbmVyYXRlJ10sXG4gICAgICAgIHBlcm1pc3Npb25MZXZlbDogJ3NlbmlvcicsXG4gICAgICAgIGRlcGFydG1lbnQ6ICdlbmdpbmVlcmluZycsXG4gICAgICAgIGFwcHJvdmFsTGltaXRzOiB7XG4gICAgICAgICAgZmluYW5jaWFsOiA1MDAwMCxcbiAgICAgICAgICB0aW1lT2ZmOiAzMCxcbiAgICAgICAgICBwcm9jdXJlbWVudDogMjUwMDBcbiAgICAgICAgfSxcbiAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6ICdjb25maWRlbnRpYWwnXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgIC8vIFJvbGUgdmFsaWRhdGlvbiAtIHVzaW5nIGN1c3RvbSBmdW5jdGlvbiBmb3IgYXJyYXkgY29udGFpbnNcbiAgICAgICAgICAgIHJvbGVzOiBbeyBjdXN0b206IChyb2xlczogc3RyaW5nW10pID0+IEFycmF5LmlzQXJyYXkocm9sZXMpICYmIHJvbGVzLmluY2x1ZGVzKCdhcHByb3ZlcicpIH1dLFxuICAgICAgICAgICAgcHJpbWFyeVJvbGU6IFt7IGluTGlzdDogWydtYW5hZ2VyJywgJ2RpcmVjdG9yJywgJ3ZwJ10gfV0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFBlcm1pc3Npb24gdmFsaWRhdGlvbiAtIHVzaW5nIGN1c3RvbSBmdW5jdGlvbiBmb3IgYXJyYXkgY29udGFpbnNcbiAgICAgICAgICAgIHBlcm1pc3Npb25zOiBbeyBjdXN0b206IChwZXJtaXNzaW9uczogc3RyaW5nW10pID0+IEFycmF5LmlzQXJyYXkocGVybWlzc2lvbnMpICYmIHBlcm1pc3Npb25zLmluY2x1ZGVzKCdidWRnZXQuYXBwcm92ZScpIH1dLFxuICAgICAgICAgICAgcGVybWlzc2lvbkxldmVsOiBbeyBpbkxpc3Q6IFsnc2VuaW9yJywgJ2V4ZWN1dGl2ZSddIH1dLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBEZXBhcnRtZW50LWJhc2VkIGFjY2Vzc1xuICAgICAgICAgICAgZGVwYXJ0bWVudDogW3sgZXE6ICdlbmdpbmVlcmluZycgfV0sXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFNlY3VyaXR5IGNsZWFyYW5jZVxuICAgICAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6IFt7IGluTGlzdDogWydjb25maWRlbnRpYWwnLCAnc2VjcmV0JywgJ3RvcC1zZWNyZXQnXSB9XVxuICAgICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgLy8gQW1vdW50IG11c3QgYmUgd2l0aGluIGFwcHJvdmFsIGxpbWl0c1xuICAgICAgICAgIGFtb3VudDogW3sgbHRlOiA1MDAwMCB9XSxcbiAgICAgICAgICAvLyBSZXF1ZXN0IHR5cGUgbXVzdCBtYXRjaCBwZXJtaXNzaW9uc1xuICAgICAgICAgIHJlcXVlc3RUeXBlOiBbeyBlcTogJ2J1ZGdldC1hcHByb3ZhbCcgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2ZpbmFuY2lhbEFwcHJvdmFsJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0J1ZGdldFJlcXVlc3QnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IG1hbmFnZXJBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBhbW91bnQ6IDM1MDAwLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiAnYnVkZ2V0LWFwcHJvdmFsJyxcbiAgICAgICAgICBkZXBhcnRtZW50OiAnZW5naW5lZXJpbmcnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTmV3IHNlcnZlciBpbmZyYXN0cnVjdHVyZSdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IGluc3VmZmljaWVudCByb2xlIHBlcm1pc3Npb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QganVuaW9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnamFuZS5qdW5pb3InLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtcmJhYy0wMDInLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDIxOjE1OjAwLjAwMFonLFxuICAgICAgICBcbiAgICAgICAgcm9sZXM6IFsnZW1wbG95ZWUnLCAndmlld2VyJ10sXG4gICAgICAgIHByaW1hcnlSb2xlOiAnZW1wbG95ZWUnLFxuICAgICAgICBwZXJtaXNzaW9uczogWyd1c2VyLnJlYWQnLCAncmVwb3J0LnZpZXcnXSxcbiAgICAgICAgcGVybWlzc2lvbkxldmVsOiAnanVuaW9yJyxcbiAgICAgICAgZGVwYXJ0bWVudDogJ2VuZ2luZWVyaW5nJyxcbiAgICAgICAgYXBwcm92YWxMaW1pdHM6IHtcbiAgICAgICAgICBmaW5hbmNpYWw6IDAsXG4gICAgICAgICAgdGltZU9mZjogMCxcbiAgICAgICAgICBwcm9jdXJlbWVudDogMFxuICAgICAgICB9LFxuICAgICAgICBzZWN1cml0eUNsZWFyYW5jZTogJ3B1YmxpYydcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcm9sZXM6IFt7IGN1c3RvbTogKHJvbGVzOiBzdHJpbmdbXSkgPT4gQXJyYXkuaXNBcnJheShyb2xlcykgJiYgcm9sZXMuaW5jbHVkZXMoJ2FwcHJvdmVyJykgfV0sIC8vIE1pc3NpbmcgYXBwcm92ZXIgcm9sZVxuICAgICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiBbeyBpbkxpc3Q6IFsnY29uZmlkZW50aWFsJywgJ3NlY3JldCddIH1dIC8vIEluc3VmZmljaWVudCBjbGVhcmFuY2VcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2ZpbmFuY2lhbEFwcHJvdmFsJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0J1ZGdldFJlcXVlc3QnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IGp1bmlvckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFtb3VudDogMzUwMDAsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6ICdidWRnZXQtYXBwcm92YWwnXG4gICAgICAgIH0sXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgyKTsgLy8gcm9sZXMgYW5kIHNlY3VyaXR5Q2xlYXJhbmNlIHZhbGlkYXRpb25zIHNob3VsZCBmYWlsXG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHN1YnNjcmlwdGlvbi1iYXNlZCBmZWF0dXJlIGFjY2VzcycsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEVuaGFuY2VkIGFjdG9yIHdpdGggc3Vic2NyaXB0aW9uIGNvbnRleHRcbiAgICAgIGNvbnN0IGVudGVycHJpc2VBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdlbnRlcnByaXNlLnVzZXInLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtc3ViLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjI6MDA6MDAuMDAwWicsXG4gICAgICAgIHRlbmFudElkOiAnZW50ZXJwcmlzZS1jb3JwJyxcbiAgICAgICAgXG4gICAgICAgIC8vIEVuaGFuY2VkIGJ5IGNvbnRyb2xsZXIgd2l0aCBzdWJzY3JpcHRpb24gZGF0YVxuICAgICAgICBzdWJzY3JpcHRpb246IHtcbiAgICAgICAgICB0aWVyOiAnZW50ZXJwcmlzZScsXG4gICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICBmZWF0dXJlczogWydhZHZhbmNlZC1hbmFseXRpY3MnLCAnY3VzdG9tLWJyYW5kaW5nJywgJ3NzbycsICdhdWRpdC1sb2dzJ10sXG4gICAgICAgICAgbGltaXRzOiB7XG4gICAgICAgICAgICB1c2VyczogMTAwMCxcbiAgICAgICAgICAgIHN0b3JhZ2U6IDEwNzM3NDE4MjQwMCwgLy8gMTAwR0JcbiAgICAgICAgICAgIGFwaUNhbGxzUGVyTW9udGg6IDEwMDAwMDBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGxpY2Vuc2VzOiBbJ2VudGVycHJpc2UtYWRtaW4nLCAnYW5hbHl0aWNzLXBybyddLFxuICAgICAgICBhY3RpdmVMaWNlbnNlczogWydlbnRlcnByaXNlLWFkbWluJywgJ2FuYWx5dGljcy1wcm8nXSxcbiAgICAgICAgdXNhZ2U6IHtcbiAgICAgICAgICBhcGlDYWxsc1RoaXNNb250aDogNDUwMDAsXG4gICAgICAgICAgc3RvcmFnZVVzZWQ6IDI2ODQzNTQ1NjAwLCAvLyAyNUdCXG4gICAgICAgICAgdXNlcnNBY3RpdmU6IDg5XG4gICAgICAgIH0sXG4gICAgICAgIGZlYXR1cmVGbGFnczoge1xuICAgICAgICAgICdiZXRhLWFpLWZlYXR1cmVzJzogdHJ1ZSxcbiAgICAgICAgICAnYWR2YW5jZWQtcmVwb3J0aW5nJzogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIC8vIFN1YnNjcmlwdGlvbiB2YWxpZGF0aW9uIC0gdXNlIGN1c3RvbSB2YWxpZGF0b3JzIGZvciBuZXN0ZWQgcHJvcGVydGllc1xuICAgICAgICAgIHN1YnNjcmlwdGlvbjogW3sgY3VzdG9tOiAoc3ViOiBhbnkpID0+IHN1Yj8udGllciA9PT0gJ2VudGVycHJpc2UnIHx8IHN1Yj8udGllciA9PT0gJ3ByZW1pdW0nIH1dLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIExpY2Vuc2UgdmFsaWRhdGlvbiAtIHVzZSBjdXN0b20gZm9yIGFycmF5IGNvbnRhaW5zXG4gICAgICAgICAgYWN0aXZlTGljZW5zZXM6IFt7IGN1c3RvbTogKGxpY2Vuc2VzOiBzdHJpbmdbXSkgPT4gQXJyYXkuaXNBcnJheShsaWNlbnNlcykgJiYgbGljZW5zZXMuaW5jbHVkZXMoJ2FuYWx5dGljcy1wcm8nKSB9XSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBGZWF0dXJlIGZsYWcgdmFsaWRhdGlvbiAtIHVzZSBjdXN0b20gZm9yIG5lc3RlZCBwcm9wZXJ0eVxuICAgICAgICAgIGZlYXR1cmVGbGFnczogW3sgY3VzdG9tOiAoZmxhZ3M6IGFueSkgPT4gZmxhZ3M/LlsnYWR2YW5jZWQtcmVwb3J0aW5nJ10gPT09IHRydWUgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICAvLyBGZWF0dXJlLXNwZWNpZmljIHZhbGlkYXRpb25cbiAgICAgICAgICByZXBvcnRUeXBlOiBbeyBpbkxpc3Q6IFsnYWR2YW5jZWQnLCAnY3VzdG9tJ10gfV0sXG4gICAgICAgICAgZGF0YVJhbmdlOiBbeyBpbkxpc3Q6IFsnMXllYXInLCAnMnllYXJzJywgJ2FsbC10aW1lJ10gfV0gLy8gRW50ZXJwcmlzZSBnZXRzIGV4dGVuZGVkIHJhbmdlc1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnZ2VuZXJhdGVBZHZhbmNlZFJlcG9ydCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdBbmFseXRpY3NSZXBvcnQnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IGVudGVycHJpc2VBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICByZXBvcnRUeXBlOiAnYWR2YW5jZWQnLFxuICAgICAgICAgIGRhdGFSYW5nZTogJzJ5ZWFycycsXG4gICAgICAgICAgaW5jbHVkZVJhd0RhdGE6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgbWlkZGxld2FyZS1lbmhhbmNlZCBzZWN1cml0eSBjb250ZXh0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gRW5oYW5jZWQgYWN0b3Igd2l0aCBzZWN1cml0eSBjb250ZXh0IGZyb20gbWlkZGxld2FyZVxuICAgICAgY29uc3Qgc2VjdXJlQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnc2VjdXJpdHkuYW5hbHlzdCcsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1zZWMtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQyMzowMDowMC4wMDBaJyxcbiAgICAgICAgXG4gICAgICAgIC8vIEVuaGFuY2VkIGJ5IG1pZGRsZXdhcmVcbiAgICAgICAgcmlza1Byb2ZpbGU6IHtcbiAgICAgICAgICBzY29yZTogMjUsIC8vIGxvdyByaXNrXG4gICAgICAgICAgbGV2ZWw6ICdsb3cnLFxuICAgICAgICAgIGZhY3RvcnM6IFtdLFxuICAgICAgICAgIHRocmVhdExldmVsOiAnbWluaW1hbCdcbiAgICAgICAgfSxcbiAgICAgICAgZGV2aWNlOiB7XG4gICAgICAgICAgdHlwZTogJ2Rlc2t0b3AnLFxuICAgICAgICAgIHRydXN0ZWQ6IHRydWUsXG4gICAgICAgICAgcGxhdGZvcm06ICdXaW5kb3dzJ1xuICAgICAgICB9LFxuICAgICAgICBzZWN1cml0eToge1xuICAgICAgICAgIG1mYVZlcmlmaWVkOiB0cnVlLFxuICAgICAgICAgIHZwbkRldGVjdGVkOiBmYWxzZSxcbiAgICAgICAgICBhbm9tYWx5RmxhZ3M6IFtdXG4gICAgICAgIH0sXG4gICAgICAgIHNlc3Npb246IHtcbiAgICAgICAgICBtZmFWZXJpZmllZDogdHJ1ZSxcbiAgICAgICAgICBkZXZpY2VUcnVzdGVkOiB0cnVlLFxuICAgICAgICAgIHN0YXJ0ZWRBdDogJzIwMjQtMDEtMTVUMDg6MDA6MDAuMDAwWidcbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAvLyBSaXNrIGFzc2Vzc21lbnQgdmFsaWRhdGlvbiAtIHVzZSBjdXN0b20gZm9yIG5lc3RlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgcmlza1Byb2ZpbGU6IFt7IGN1c3RvbTogKHJpc2s6IGFueSkgPT4gcmlzaz8ubGV2ZWwgPT09ICdsb3cnIHx8IHJpc2s/LmxldmVsID09PSAnbWluaW1hbCcgfV0sXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRGV2aWNlIHNlY3VyaXR5IHZhbGlkYXRpb25cbiAgICAgICAgICBkZXZpY2U6IFt7IGN1c3RvbTogKGRldmljZTogYW55KSA9PiBkZXZpY2U/LnRydXN0ZWQgPT09IHRydWUgfV0sXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2VjdXJpdHkgdmFsaWRhdGlvbiAgXG4gICAgICAgICAgc2VjdXJpdHk6IFt7IGN1c3RvbTogKHNlYzogYW55KSA9PiBzZWM/Lm1mYVZlcmlmaWVkID09PSB0cnVlICYmIHNlYz8udnBuRGV0ZWN0ZWQgPT09IGZhbHNlIH1dLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFNlc3Npb24gdmFsaWRhdGlvblxuICAgICAgICAgIHNlc3Npb246IFt7IGN1c3RvbTogKHNlc3M6IGFueSkgPT4gc2Vzcz8uZGV2aWNlVHJ1c3RlZCA9PT0gdHJ1ZSAmJiBzZXNzPy5tZmFWZXJpZmllZCA9PT0gdHJ1ZSB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIC8vIFNlbnNpdGl2ZSBvcGVyYXRpb24gdmFsaWRhdGlvblxuICAgICAgICAgIG9wZXJhdGlvblR5cGU6IFt7IGluTGlzdDogWyd1c2VyLnN1c3BlbmQnLCAnc2VjdXJpdHkuYXVkaXQnLCAnYWRtaW4uYWNjZXNzJ10gfV0sXG4gICAgICAgICAgZGF0YUNsYXNzaWZpY2F0aW9uOiBbeyBpbkxpc3Q6IFsnY29uZmlkZW50aWFsJywgJ2ludGVybmFsJ10gfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ3NlbnNpdGl2ZVNlY3VyaXR5T3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1NlY3VyaXR5QWN0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBzZWN1cmVBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBvcGVyYXRpb25UeXBlOiAnc2VjdXJpdHkuYXVkaXQnLFxuICAgICAgICAgIGRhdGFDbGFzc2lmaWNhdGlvbjogJ2NvbmZpZGVudGlhbCcsXG4gICAgICAgICAgdGFyZ2V0VXNlcklkOiAnc3VzcGljaW91cy51c2VyJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgaGlnaC1yaXNrIHNlY3VyaXR5IHNjZW5hcmlvcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJpc2t5QWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAncmlza3kudXNlcicsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1yaXNrLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjM6MzA6MDAuMDAwWicsXG4gICAgICAgIFxuICAgICAgICByaXNrUHJvZmlsZToge1xuICAgICAgICAgIHNjb3JlOiA4NSwgLy8gaGlnaCByaXNrXG4gICAgICAgICAgbGV2ZWw6ICdoaWdoJyxcbiAgICAgICAgICBmYWN0b3JzOiBbJ25ldy1kZXZpY2UnLCAndW51c3VhbC1sb2NhdGlvbicsICd2ZWxvY2l0eS1hbm9tYWx5J10sXG4gICAgICAgICAgdGhyZWF0TGV2ZWw6ICdlbGV2YXRlZCdcbiAgICAgICAgfSxcbiAgICAgICAgZGV2aWNlOiB7XG4gICAgICAgICAgdHlwZTogJ21vYmlsZScsXG4gICAgICAgICAgdHJ1c3RlZDogZmFsc2UsIC8vIFVudHJ1c3RlZCBkZXZpY2VcbiAgICAgICAgICBwbGF0Zm9ybTogJ2lPUydcbiAgICAgICAgfSxcbiAgICAgICAgc2VjdXJpdHk6IHtcbiAgICAgICAgICBtZmFWZXJpZmllZDogZmFsc2UsIC8vIE1GQSBub3QgdmVyaWZpZWRcbiAgICAgICAgICB2cG5EZXRlY3RlZDogdHJ1ZSwgLy8gVlBOIGRldGVjdGVkXG4gICAgICAgICAgYW5vbWFseUZsYWdzOiBbJ2xvZ2luLXRpbWUtdW51c3VhbCcsICdsb2NhdGlvbi1hbm9tYWx5J11cbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICByaXNrUHJvZmlsZTogW3sgY3VzdG9tOiAocmlzazogYW55KSA9PiAocmlzaz8ubGV2ZWwgPT09ICdsb3cnIHx8IHJpc2s/LmxldmVsID09PSAnbWluaW1hbCcpICYmIHJpc2s/LnNjb3JlIDw9IDUwIH1dLFxuICAgICAgICAgIGRldmljZTogW3sgY3VzdG9tOiAoZGV2aWNlOiBhbnkpID0+IGRldmljZT8udHJ1c3RlZCA9PT0gdHJ1ZSB9XSxcbiAgICAgICAgICBzZWN1cml0eTogW3sgY3VzdG9tOiAoc2VjOiBhbnkpID0+IHNlYz8ubWZhVmVyaWZpZWQgPT09IHRydWUgJiYgc2VjPy52cG5EZXRlY3RlZCA9PT0gZmFsc2UgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ3NlbnNpdGl2ZVNlY3VyaXR5T3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1NlY3VyaXR5QWN0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiByaXNreUFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICd1c2VyLnN1c3BlbmQnLFxuICAgICAgICAgIGRhdGFDbGFzc2lmaWNhdGlvbjogJ2NvbmZpZGVudGlhbCdcbiAgICAgICAgfSxcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDMpOyAvLyByaXNrUHJvZmlsZSwgZGV2aWNlLCBhbmQgc2VjdXJpdHkgdmFsaWRhdGlvbnMgc2hvdWxkIGZhaWxcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgY29tcGxpYW5jZSBhbmQgYXVkaXQgcmVxdWlyZW1lbnRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29tcGxpYW5jZUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2NvbXBsaWFuY2Uub2ZmaWNlcicsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1jb21wLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTZUMDA6MDA6MDAuMDAwWicsXG4gICAgICAgIHRlbmFudElkOiAncmVndWxhdGVkLWZpbmFuY2lhbCcsXG4gICAgICAgIFxuICAgICAgICAvLyBFbmhhbmNlZCBieSBtaWRkbGV3YXJlIHdpdGggY29tcGxpYW5jZSBjb250ZXh0XG4gICAgICAgIGNvbXBsaWFuY2U6IHtcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGlhbnQnLFxuICAgICAgICAgIGNlcnRpZmljYXRpb25zOiBbJ1NPQzItVHlwZTInLCAnSVNPMjcwMDEnLCAnUENJLURTUyddLFxuICAgICAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgICAgIGdkcHJTdGF0dXM6IHsgbGF3ZnVsQmFzaXM6ICdsZWdpdGltYXRlLWludGVyZXN0JywgZGF0YVN1YmplY3Q6IHRydWUgfSxcbiAgICAgICAgICBzb3hDb21wbGlhbnQ6IHsgY2VydGlmaWVkOiB0cnVlLCBsYXN0Q2VydGlmaWNhdGlvbjogJzIwMjMtMTItMzEnIH1cbiAgICAgICAgfSxcbiAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICB0cmFpbEVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgc2Vuc2l0aXZlT3BlcmF0aW9uczogWydmaW5hbmNpYWwuYXBwcm92ZScsICdkYXRhLmV4cG9ydCddLFxuICAgICAgICAgIHJldGVudGlvblBlcmlvZDogMjU1NSwgLy8gNyB5ZWFyc1xuICAgICAgICAgIGhpZ2hSaXNrT3BlcmF0aW9uczogWyd1c2VyLmRlbGV0ZScsICdhdWRpdC5tb2RpZnknXSxcbiAgICAgICAgICByZWFsVGltZU1vbml0b3Jpbmc6IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgcm9sZXM6IFsnY29tcGxpYW5jZS1vZmZpY2VyJywgJ2F1ZGl0b3InXSxcbiAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6ICdjb25maWRlbnRpYWwnXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIC8vIENvbXBsaWFuY2UgdmFsaWRhdGlvbiAtIHVzZSBjdXN0b20gZm9yIG5lc3RlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgY29tcGxpYW5jZTogW3sgY3VzdG9tOiAoY29tcDogYW55KSA9PiBcbiAgICAgICAgICAgIGNvbXA/LnN0YXR1cyA9PT0gJ2NvbXBsaWFudCcgJiYgXG4gICAgICAgICAgICBBcnJheS5pc0FycmF5KGNvbXA/LmNlcnRpZmljYXRpb25zKSAmJiBjb21wLmNlcnRpZmljYXRpb25zLmluY2x1ZGVzKCdTT0MyLVR5cGUyJykgJiZcbiAgICAgICAgICAgIEFycmF5LmlzQXJyYXkoY29tcD8udmlvbGF0aW9ucykgJiYgY29tcC52aW9sYXRpb25zLmxlbmd0aCA9PT0gMCAmJlxuICAgICAgICAgICAgY29tcD8uc294Q29tcGxpYW50Py5jZXJ0aWZpZWQgPT09IHRydWVcbiAgICAgICAgICB9XSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBBdWRpdCB2YWxpZGF0aW9uIC0gdXNlIGN1c3RvbSBmb3IgbmVzdGVkIHByb3BlcnRpZXNcbiAgICAgICAgICBhdWRpdDogW3sgY3VzdG9tOiAoYXVkaXQ6IGFueSkgPT4gXG4gICAgICAgICAgICBhdWRpdD8udHJhaWxFbmFibGVkID09PSB0cnVlICYmIFxuICAgICAgICAgICAgYXVkaXQ/LnJldGVudGlvblBlcmlvZCA+PSAyNTU1ICYmXG4gICAgICAgICAgICBhdWRpdD8ucmVhbFRpbWVNb25pdG9yaW5nID09PSB0cnVlXG4gICAgICAgICAgfV0sXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUm9sZSB2YWxpZGF0aW9uXG4gICAgICAgICAgcm9sZXM6IFt7IGN1c3RvbTogKHJvbGVzOiBzdHJpbmdbXSkgPT4gQXJyYXkuaXNBcnJheShyb2xlcykgJiYgcm9sZXMuaW5jbHVkZXMoJ2NvbXBsaWFuY2Utb2ZmaWNlcicpIH1dLFxuICAgICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiBbeyBpbkxpc3Q6IFsnY29uZmlkZW50aWFsJywgJ3NlY3JldCddIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgLy8gRmluYW5jaWFsIGNvbXBsaWFuY2UgdmFsaWRhdGlvblxuICAgICAgICAgIHRyYW5zYWN0aW9uVHlwZTogW3sgaW5MaXN0OiBbJ2F1ZGl0LXJldmlldycsICdjb21wbGlhbmNlLWNoZWNrJ10gfV0sXG4gICAgICAgICAgYW1vdW50OiBbeyBndGU6IDAgfV0sXG4gICAgICAgICAgcmVndWxhdG9yeUZyYW1ld29yazogW3sgaW5MaXN0OiBbJ1NPWCcsICdHRFBSJywgJ1BDSS1EU1MnXSB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnZmluYW5jaWFsQ29tcGxpYW5jZVJldmlldycsXG4gICAgICAgIGVudGl0eU5hbWU6ICdDb21wbGlhbmNlUmVwb3J0JyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBjb21wbGlhbmNlQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdHJhbnNhY3Rpb25UeXBlOiAnYXVkaXQtcmV2aWV3JyxcbiAgICAgICAgICBhbW91bnQ6IDI1MDAwMCxcbiAgICAgICAgICByZWd1bGF0b3J5RnJhbWV3b3JrOiAnU09YJyxcbiAgICAgICAgICByZXZpZXdUeXBlOiAncXVhcnRlcmx5J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19