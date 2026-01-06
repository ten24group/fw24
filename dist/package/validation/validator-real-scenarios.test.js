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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLXJlYWwtc2NlbmFyaW9zLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdmFsaWRhdGlvbi92YWxpZGF0b3ItcmVhbC1zY2VuYXJpb3MudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUFxRDtBQUNyRCwyQ0FBd0M7QUFJeEMsSUFBQSxrQkFBUSxFQUFDLHNDQUFzQyxFQUFFLEdBQUcsRUFBRTtJQUNwRCxNQUFNLFNBQVMsR0FBRyxJQUFJLHFCQUFTLEVBQUUsQ0FBQztJQUVsQyxJQUFBLGtCQUFRLEVBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO1FBRXhDLElBQUEsWUFBRSxFQUFDLDJEQUEyRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3pFLE1BQU0sVUFBVSxHQUFVO2dCQUN4QixPQUFPLEVBQUUsZ0JBQWdCO2dCQUN6QixTQUFTLEVBQUUsTUFBTTtnQkFDakIsU0FBUyxFQUFFLGVBQWU7Z0JBQzFCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixJQUFJLEVBQUUsT0FBTztnQkFDYixVQUFVLEVBQUUsZ0JBQWdCO2dCQUM1QixjQUFjLEVBQUUsTUFBTTthQUNoQixDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsQ0FBQztvQkFDdkIsY0FBYyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLENBQUM7b0JBQ2hDLFVBQVUsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDO2lCQUNoQztnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsYUFBYSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsdUJBQXVCLEVBQUUsQ0FBQztvQkFDaEQsYUFBYSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFF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QyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0IH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5pbXBvcnQgeyBWYWxpZGF0b3IgfSBmcm9tICcuL3ZhbGlkYXRvcic7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvYWN0b3InO1xuaW1wb3J0IHsgRW50aXR5VmFsaWRhdGlvbnMgfSBmcm9tICcuL3R5cGVzJztcblxuZGVzY3JpYmUoJ1ZhbGlkYXRvciBSZWFsLVdvcmxkIEFjdG9yIFNjZW5hcmlvcycsICgpID0+IHtcbiAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuXG4gIGRlc2NyaWJlKCdSb2xlLUJhc2VkIEF1dGhvcml6YXRpb24nLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhZG1pbiB1c2VyIGFjY2VzcyB0byBzZW5zaXRpdmUgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFkbWluQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYWRtaW4tdXNlci0wMDEnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFkbWluLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcm9sZTogJ2FkbWluJyxcbiAgICAgICAgZGVwYXJ0bWVudDogJ2FkbWluaXN0cmF0aW9uJyxcbiAgICAgICAgY2xlYXJhbmNlTGV2ZWw6ICdoaWdoJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ2FkbWluJyB9XSxcbiAgICAgICAgICBjbGVhcmFuY2VMZXZlbDogW3sgZXE6ICdoaWdoJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbeyBlcTogJ2NvZ25pdG8nIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgb3BlcmF0aW9uVHlwZTogW3sgZXE6ICdzZW5zaXRpdmUtZGF0YS1hY2Nlc3MnIH1dLFxuICAgICAgICAgIGp1c3RpZmljYXRpb246IFt7IHJlcXVpcmVkOiB0cnVlIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdhY2Nlc3NTZW5zaXRpdmVEYXRhJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1NlY3VyaXR5T3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBhZG1pbkFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICdzZW5zaXRpdmUtZGF0YS1hY2Nlc3MnLFxuICAgICAgICAgIGp1c3RpZmljYXRpb246ICdTZWN1cml0eSBhdWRpdCByZXF1aXJlZCBieSBjb21wbGlhbmNlIHRlYW0nXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCByZWd1bGFyIHVzZXIgYWNjZXNzIHRvIGFkbWluIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWd1bGFyVXNlckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS11c2VyLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTE6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcm9sZTogJ3VzZXInLCAvLyBOb3QgYWRtaW5cbiAgICAgICAgZGVwYXJ0bWVudDogJ21hcmtldGluZydcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcm9sZTogW3sgZXE6ICdhZG1pbicgfV0gLy8gUmVxdWlyZXMgYWRtaW4gcm9sZVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnYWNjZXNzU2Vuc2l0aXZlRGF0YScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdTZWN1cml0eU9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogcmVndWxhclVzZXJBY3RvcixcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZSxcbiAgICAgICAgdmVyYm9zZUVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnM/LlswXT8ubWVzc2FnZUlkcykudG9Db250YWluKCd2YWxpZGF0aW9uLmVudGl0eS5zZWN1cml0eW9wZXJhdGlvbi5hY3Rvci5yb2xlLmVxLmFkbWluJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG1hbmFnZXIgYXBwcm92YWwgbGltaXRzIGJhc2VkIG9uIGFjdG9yIHByb3BlcnRpZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtYW5hZ2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnbWdyLTAwMScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1hcHByb3ZhbC0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEyOjAwOjAwLjAwMFonLFxuICAgICAgICByb2xlOiAnbWFuYWdlcicsXG4gICAgICAgIGRlcGFydG1lbnQ6ICdmaW5hbmNlJyxcbiAgICAgICAgYXBwcm92YWxMaW1pdDogMTAwMDBcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcm9sZTogW3sgZXE6ICdtYW5hZ2VyJyB9XSxcbiAgICAgICAgICBkZXBhcnRtZW50OiBbeyBlcTogJ2ZpbmFuY2UnIH1dLFxuICAgICAgICAgIGFwcHJvdmFsTGltaXQ6IFt7IGd0ZTogNTAwMCB9XSAvLyBNdXN0IGhhdmUgYXBwcm92YWwgbGltaXQgPj0gNTAwMFxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFtb3VudDogW3sgbHRlOiAxMDAwMCB9XSwgLy8gQW1vdW50IG11c3QgYmUgd2l0aGluIGxpbWl0XG4gICAgICAgICAgdmVuZG9yOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBjYXRlZ29yeTogW3sgaW5MaXN0OiBbJ29mZmljZS1zdXBwbGllcycsICdzb2Z0d2FyZScsICdlcXVpcG1lbnQnXSB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnYXBwcm92ZUV4cGVuc2UnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnRXhwZW5zZUFwcHJvdmFsJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBtYW5hZ2VyQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYW1vdW50OiA3NTAwLFxuICAgICAgICAgIHZlbmRvcjogJ09mZmljZSBEZXBvdCcsXG4gICAgICAgICAgY2F0ZWdvcnk6ICdvZmZpY2Utc3VwcGxpZXMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTW9udGhseSBvZmZpY2Ugc3VwcGx5IG9yZGVyJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgYXBwcm92YWwgd2hlbiBhbW91bnQgZXhjZWVkcyBhY3RvciBhcHByb3ZhbCBsaW1pdCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGxvd0xldmVsTWFuYWdlckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ21nci1qdW5pb3ItMDAxJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFwcHJvdmFsLTAwMicsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTM6MDA6MDAuMDAwWicsXG4gICAgICAgIHJvbGU6ICdtYW5hZ2VyJyxcbiAgICAgICAgZGVwYXJ0bWVudDogJ2ZpbmFuY2UnLFxuICAgICAgICBhcHByb3ZhbExpbWl0OiAyMDAwIC8vIExvdyBhcHByb3ZhbCBsaW1pdFxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBhcHByb3ZhbExpbWl0OiBbeyBndGU6IDUwMDAgfV0gLy8gUmVxdWlyZXMgaGlnaGVyIGFwcHJvdmFsIGxpbWl0XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdhcHByb3ZlRXhwZW5zZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdFeHBlbnNlQXBwcm92YWwnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IGxvd0xldmVsTWFuYWdlckFjdG9yLFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTZXJ2aWNlIEF1dGhlbnRpY2F0aW9uJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgQVBJIGtleSBzZXJ2aWNlIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlTZXJ2aWNlQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYXBpLWtleTpkYXRhLXN5bmMtc2VydmljZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtc2VydmljZS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDE0OjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnYXBpLWtleScsXG4gICAgICAgIGFwaUtleToge1xuICAgICAgICAgIGlkOiAnc3luYy1rZXktMTIzJyxcbiAgICAgICAgICBzb3VyY2U6ICdyZXF1ZXN0LWNvbnRleHQnXG4gICAgICAgIH0sXG4gICAgICAgIHNvdXJjZUlwOiAnMTAuMC4xLjEwMCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBhY3RvclR5cGU6IFt7IGVxOiAnc2VydmljZScgfV0sXG4gICAgICAgICAgYXV0aE1ldGhvZDogWyB7IGVxOiAnYXBpLWtleScgfSBdLFxuICAgICAgICAgIGFwaUtleTogW3sgcmVxdWlyZWQ6IHRydWUgfV0sXG4gICAgICAgICAgc291cmNlSXA6IFt7IHJlcXVpcmVkOiB0cnVlIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYmF0Y2hTaXplOiBbeyBsdGU6IDEwMDAgfV0sIC8vIFNlcnZpY2VzIGNhbiBwcm9jZXNzIHVwIHRvIDEwMDAgcmVjb3Jkc1xuICAgICAgICAgIGRhdGFTb3VyY2U6IFt7IHJlcXVpcmVkOiB0cnVlIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdiYXRjaFN5bmMnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnRGF0YVN5bmNocm9uaXphdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogYXBpU2VydmljZUFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGJhdGNoU2l6ZTogNTAwLFxuICAgICAgICAgIGRhdGFTb3VyY2U6ICdleHRlcm5hbC1jcm0nLFxuICAgICAgICAgIHJlY29yZHM6IFsncmVjb3JkMScsICdyZWNvcmQyJywgJ3JlY29yZDMnXVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgdXNlciBhdXRoZW50aWNhdGlvbiBmb3Igc2VydmljZS1vbmx5IG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB1c2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci0wMDEnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJywgLy8gU2hvdWxkIGJlIHNlcnZpY2VcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXVzZXItc2VydmljZS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDE1OjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycgLy8gU2hvdWxkIGJlIGFwaS1rZXlcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBhY3RvclR5cGU6IFt7IGVxOiAnc2VydmljZScgfV0sXG4gICAgICAgICAgYXV0aE1ldGhvZDogW3sgZXE6ICdhcGkta2V5JyB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnYmF0Y2hTeW5jJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0RhdGFTeW5jaHJvbml6YXRpb24nLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IHVzZXJBY3RvcixcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDIpOyAvLyBCb3RoIGFjdG9yVHlwZSBhbmQgYXV0aE1ldGhvZCB3aWxsIGZhaWxcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc3lzdGVtIGFjdG9yIGZvciBtYWludGVuYW5jZSBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3lzdGVtQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgICAgYWN0b3JUeXBlOiAnYW5vbnltb3VzJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXN5c3RlbS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDAyOjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnYW5vbnltb3VzJyxcbiAgICAgICAgbWFpbnRlbmFuY2VXaW5kb3c6IHRydWVcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgYWN0b3JJZDogW3sgZXE6ICdhbm9ueW1vdXMnIH1dLFxuICAgICAgICAgIGFjdG9yVHlwZTogW3sgZXE6ICdhbm9ueW1vdXMnIH1dLFxuICAgICAgICAgIGF1dGhNZXRob2Q6IFt7IGVxOiAnYW5vbnltb3VzJyB9XSxcbiAgICAgICAgICBtYWludGVuYW5jZVdpbmRvdzogW3sgZXE6IHRydWUgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBvcGVyYXRpb25UeXBlOiBbeyBpbkxpc3Q6IFsnY2xlYW51cCcsICdiYWNrdXAnLCAnbWlncmF0aW9uJ10gfV0sXG4gICAgICAgICAgYWZmZWN0ZWRUYWJsZXM6IFt7IHJlcXVpcmVkOiB0cnVlIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdzeXN0ZW1NYWludGVuYW5jZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdNYWludGVuYW5jZU9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3Rvcjogc3lzdGVtQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ2NsZWFudXAnLFxuICAgICAgICAgIGFmZmVjdGVkVGFibGVzOiBbJ2xvZ3MnLCAndGVtcF9kYXRhJ10sXG4gICAgICAgICAgcmV0ZW50aW9uRGF5czogOTBcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1RlbmFudCBJc29sYXRpb24nLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSB0ZW5hbnQtc2NvcGVkIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB0ZW5hbnRVc2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndGVuYW50LWFkbWluLTAwMScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdGVuYW50LTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTY6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgdGVuYW50SWQ6ICdjb21wYW55LWEtdGVuYW50JyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIGdyb3VwczogWyd0ZWFtLWFkbWluJ11cbiAgICAgICAgfSxcbiAgICAgICAgcm9sZTogJ2FkbWluJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICB0ZW5hbnRJZDogW3sgZXE6ICdjb21wYW55LWEtdGVuYW50JyB9XSxcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ2FkbWluJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbeyBlcTogJ2NvZ25pdG8nIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdGFyZ2V0VGVuYW50SWQ6IFt7IGVxOiAnY29tcGFueS1hLXRlbmFudCcgfV0sIC8vIE11c3QgbWF0Y2ggYWN0b3IncyB0ZW5hbnRcbiAgICAgICAgICBvcGVyYXRpb246IFt7IGluTGlzdDogWydjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZSddIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICd0ZW5hbnRBZG1pbk9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdUZW5hbnRSZXNvdXJjZScsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogdGVuYW50VXNlckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHRhcmdldFRlbmFudElkOiAnY29tcGFueS1hLXRlbmFudCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlJyxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6ICd1c2VyLWFjY291bnQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByZXZlbnQgY3Jvc3MtdGVuYW50IGFjY2VzcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1hbGljaW91c1RlbmFudEFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ21hbGljaW91cy11c2VyLTAwMScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3Jvc3MtdGVuYW50LTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTc6MDA6MDAuMDAwWicsXG4gICAgICAgIHRlbmFudElkOiAnY29tcGFueS1iLXRlbmFudCcsXG4gICAgICAgIHJvbGU6ICdhZG1pbidcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgdGVuYW50SWQ6IFt7IGVxOiAnY29tcGFueS1hLXRlbmFudCcgfV0gLy8gTXVzdCBiZSBmcm9tIGNvbXBhbnkgQVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHRhcmdldFRlbmFudElkOiBbeyBlcTogJ2NvbXBhbnktYS10ZW5hbnQnIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICd0ZW5hbnRBZG1pbk9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdUZW5hbnRSZXNvdXJjZScsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogbWFsaWNpb3VzVGVuYW50QWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdGFyZ2V0VGVuYW50SWQ6ICdjb21wYW55LWEtdGVuYW50JywgLy8gVHJ5aW5nIHRvIGFjY2VzcyBjb21wYW55IEEgZGF0YVxuICAgICAgICAgIG9wZXJhdGlvbjogJ2RlbGV0ZSdcbiAgICAgICAgfSxcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQ29tcGxleCBBY3RvciBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgbXVsdGktZmllbGQgYWN0b3IgcmVxdWlyZW1lbnRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcXVhbGlmaWVkRG9jdG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnZHItc21pdGgtMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1tZWRpY2FsLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTg6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcHJvZmVzc2lvbjogJ2RvY3RvcicsXG4gICAgICAgIGxpY2Vuc2VOdW1iZXI6ICdNRC0xMjM0NTYnLFxuICAgICAgICBzcGVjaWFsaXphdGlvbjogJ2NhcmRpb2xvZ3knLFxuICAgICAgICBob3NwaXRhbElkOiAnaG9zcC1tYWluLTAwMScsXG4gICAgICAgIGlzQWN0aXZlOiB0cnVlXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcHJvZmVzc2lvbjogW3sgZXE6ICdkb2N0b3InIH1dLFxuICAgICAgICAgIGxpY2Vuc2VOdW1iZXI6IFt7IHJlcXVpcmVkOiB0cnVlIH1dLFxuICAgICAgICAgIHNwZWNpYWxpemF0aW9uOiBbeyBpbkxpc3Q6IFsnY2FyZGlvbG9neScsICdzdXJnZXJ5JywgJ25ldXJvbG9neSddIH1dLFxuICAgICAgICAgIGhvc3BpdGFsSWQ6IFt7IHJlcXVpcmVkOiB0cnVlIH1dLFxuICAgICAgICAgIGlzQWN0aXZlOiBbeyBlcTogdHJ1ZSB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHBhdGllbnRJZDogW3sgcmVxdWlyZWQ6IHRydWUgfV0sXG4gICAgICAgICAgcHJvY2VkdXJlVHlwZTogW3sgaW5MaXN0OiBbJ2V4YW1pbmF0aW9uJywgJ3N1cmdlcnknLCAnY29uc3VsdGF0aW9uJ10gfV0sXG4gICAgICAgICAgdXJnZW5jeUxldmVsOiBbeyBpbkxpc3Q6IFsnbG93JywgJ21lZGl1bScsICdoaWdoJywgJ2NyaXRpY2FsJ10gfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ21lZGljYWxQcm9jZWR1cmUnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnTWVkaWNhbFJlY29yZCcsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogcXVhbGlmaWVkRG9jdG9yQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgcGF0aWVudElkOiAncGF0aWVudC0wMDEnLFxuICAgICAgICAgIHByb2NlZHVyZVR5cGU6ICdleGFtaW5hdGlvbicsXG4gICAgICAgICAgdXJnZW5jeUxldmVsOiAnbWVkaXVtJyxcbiAgICAgICAgICBub3RlczogJ1JvdXRpbmUgY2FyZGlhYyBleGFtaW5hdGlvbidcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IGFjdG9ycyBtaXNzaW5nIHJlcXVpcmVkIGJ1c2luZXNzIGNvbnRleHQgZmllbGRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gVGhpcyB0ZXN0cyBjb21wbGV4IGJ1c2luZXNzIHZhbGlkYXRpb24gdGhhdCBjb250cm9sbGVycyBjYW4gYWRkIHZpYSBleHRyYWN0QWN0b3JDb250ZXh0IG92ZXJyaWRlXG4gICAgICAvLyBFeGFtcGxlOiBNZWRpY2FsIHN5c3RlbSBjb250cm9sbGVyIGFkZHMgbGljZW5zZSB2YWxpZGF0aW9uLCBmaW5hbmNpYWwgc3lzdGVtIGFkZHMgY3JlZGl0IGNoZWNrcywgZXRjLlxuICAgICAgY29uc3Qgc3R1ZGVudEFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3N0dWRlbnQtMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1zdHVkZW50LTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTk6MDA6MDAuMDAwWicsXG4gICAgICAgIHByb2Zlc3Npb246ICdtZWRpY2FsLXN0dWRlbnQnLCAvLyBNaXNzaW5nIHJlcXVpcmVkIHByb2Zlc3Npb25cbiAgICAgICAgaXNBY3RpdmU6IHRydWVcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcHJvZmVzc2lvbjogW3sgZXE6ICdkb2N0b3InIH1dLCAvLyBNdXN0IGhhdmUgc3BlY2lmaWMgcHJvZmVzc2lvblxuICAgICAgICAgIGxpY2Vuc2VOdW1iZXI6IFt7IHJlcXVpcmVkOiB0cnVlIH1dIC8vIE11c3QgaGF2ZSBidXNpbmVzcyBsaWNlbnNlL2NlcnRpZmljYXRpb25cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ21lZGljYWxQcm9jZWR1cmUnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnTWVkaWNhbFJlY29yZCcsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3Rvcjogc3R1ZGVudEFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHBhdGllbnRJZDogJ3BhdGllbnQtMDAxJyxcbiAgICAgICAgICBwcm9jZWR1cmVUeXBlOiAnZXhhbWluYXRpb24nXG4gICAgICAgIH0sXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgyKTsgLy8gcHJvZmVzc2lvbiBhbmQgbGljZW5zZU51bWJlciB2YWxpZGF0aW9uIGJvdGggZmFpbFxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhY3RvciB3aXRoIGN1c3RvbSBidXNpbmVzcyBsb2dpYyBmaWVsZHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwcmVtaXVtVXNlckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3ByZW1pdW0tdXNlci0wMDEnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtcHJlbWl1bS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDIwOjAwOjAwLjAwMFonLFxuICAgICAgICBzdWJzY3JpcHRpb25UaWVyOiAncHJlbWl1bScsXG4gICAgICAgIGFjY291bnRBZ2U6IDM2NSwgLy8gZGF5c1xuICAgICAgICB0cnVzdFNjb3JlOiA4NTAsXG4gICAgICAgIHZlcmlmaWNhdGlvblN0YXR1czogJ3ZlcmlmaWVkJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBzdWJzY3JpcHRpb25UaWVyOiBbeyBpbkxpc3Q6IFsncHJlbWl1bScsICdlbnRlcnByaXNlJ10gfV0sXG4gICAgICAgICAgYWNjb3VudEFnZTogW3sgZ3RlOiAzMCB9XSwgLy8gTXVzdCBiZSBhdCBsZWFzdCAzMCBkYXlzIG9sZFxuICAgICAgICAgIHRydXN0U2NvcmU6IFt7IGd0ZTogNzAwIH1dLCAvLyBNdXN0IGhhdmUgaGlnaCB0cnVzdCBzY29yZVxuICAgICAgICAgIHZlcmlmaWNhdGlvblN0YXR1czogW3sgZXE6ICd2ZXJpZmllZCcgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICB1cGxvYWRTaXplOiBbeyBsdGU6IDEwMDAwMDAwMDAgfV0sIC8vIFByZW1pdW0gdXNlcnMgZ2V0IDFHQiBsaW1pdFxuICAgICAgICAgIGZpbGVUeXBlOiBbeyBpbkxpc3Q6IFsndmlkZW8nLCAnYXVkaW8nLCAnZG9jdW1lbnQnLCAnaW1hZ2UnXSB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAndXBsb2FkTGFyZ2VGaWxlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0ZpbGVVcGxvYWQnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IHByZW1pdW1Vc2VyQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdXBsb2FkU2l6ZTogNTAwMDAwMDAwLCAvLyA1MDBNQlxuICAgICAgICAgIGZpbGVUeXBlOiAndmlkZW8nLFxuICAgICAgICAgIGZpbGVOYW1lOiAncHJlc2VudGF0aW9uLm1wNCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0lucHV0IFZhbGlkYXRpb24gQmFzZWQgb24gQWN0b3IgQ29udGV4dCcsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGRpZmZlcmVudCBpbnB1dCBydWxlcyBmb3IgZGlmZmVyZW50IGFjdG9yIHR5cGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9kZXJhdG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnbW9kLTAwMScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1tb2RlcmF0aW9uLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjE6MDA6MDAuMDAwWicsXG4gICAgICAgIHJvbGU6ICdtb2RlcmF0b3InLFxuICAgICAgICBwZXJtaXNzaW9uczogWydjb250ZW50LXJldmlldycsICd1c2VyLW1hbmFnZW1lbnQnXVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ21vZGVyYXRvcicgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBhY3Rpb246IFt7IGluTGlzdDogWydhcHByb3ZlJywgJ3JlamVjdCcsICdmbGFnJywgJ2RlbGV0ZSddIH1dLCAvLyBNb2RlcmF0b3JzIGhhdmUgbW9yZSBvcHRpb25zXG4gICAgICAgICAgcmVhc29uOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBub3RpZnlVc2VyOiBbeyBlcTogdHJ1ZSB9XSAvLyBNb2RlcmF0b3JzIG11c3Qgbm90aWZ5IHVzZXJzXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdtb2RlcmF0ZUNvbnRlbnQnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnQ29udGVudE1vZGVyYXRpb24nLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IG1vZGVyYXRvckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFjdGlvbjogJ2ZsYWcnLFxuICAgICAgICAgIHJlYXNvbjogJ0luYXBwcm9wcmlhdGUgY29udGVudCBkZXRlY3RlZCcsXG4gICAgICAgICAgbm90aWZ5VXNlcjogdHJ1ZSxcbiAgICAgICAgICBjb250ZW50SWQ6ICdwb3N0LTEyMydcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IGludmFsaWQgYWN0aW9ucyBmb3IgYWN0b3Igcm9sZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlZ3VsYXJVc2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci0wMDEnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdXNlci1tb2RlcmF0ZS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDIyOjAwOjAwLjAwMFonLFxuICAgICAgICByb2xlOiAndXNlcicgLy8gTm90IGEgbW9kZXJhdG9yXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHJvbGU6IFt7IGVxOiAnbW9kZXJhdG9yJyB9XSAvLyBPbmx5IG1vZGVyYXRvcnMgYWxsb3dlZFxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnbW9kZXJhdGVDb250ZW50JyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0NvbnRlbnRNb2RlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiByZWd1bGFyVXNlckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFjdGlvbjogJ2RlbGV0ZScsXG4gICAgICAgICAgY29udGVudElkOiAncG9zdC0xMjMnXG4gICAgICAgIH0sXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VuaGFuY2VkIEFjdG9yIENvbnRleHQgVmFsaWRhdGlvbicsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGNvbXBsZXggcm9sZS1iYXNlZCBhY2Nlc3MgY29udHJvbCcsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEVuaGFuY2VkIGFjdG9yIGZyb20gY29udHJvbGxlciBvdmVycmlkZVxuICAgICAgY29uc3QgbWFuYWdlckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2pvaG4ubWFuYWdlcicsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1yYmFjLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjE6MDA6MDAuMDAwWicsXG4gICAgICAgIFxuICAgICAgICAvLyBFbmhhbmNlZCBieSBjb250cm9sbGVyXG4gICAgICAgIHJvbGVzOiBbJ21hbmFnZXInLCAnYXBwcm92ZXInLCAnYnVkZ2V0LW93bmVyJ10sXG4gICAgICAgIHByaW1hcnlSb2xlOiAnbWFuYWdlcicsXG4gICAgICAgIHBlcm1pc3Npb25zOiBbJ3VzZXIucmVhZCcsICd1c2VyLndyaXRlJywgJ2J1ZGdldC5hcHByb3ZlJywgJ3JlcG9ydC5nZW5lcmF0ZSddLFxuICAgICAgICBwZXJtaXNzaW9uTGV2ZWw6ICdzZW5pb3InLFxuICAgICAgICBkZXBhcnRtZW50OiAnZW5naW5lZXJpbmcnLFxuICAgICAgICBhcHByb3ZhbExpbWl0czoge1xuICAgICAgICAgIGZpbmFuY2lhbDogNTAwMDAsXG4gICAgICAgICAgdGltZU9mZjogMzAsXG4gICAgICAgICAgcHJvY3VyZW1lbnQ6IDI1MDAwXG4gICAgICAgIH0sXG4gICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiAnY29uZmlkZW50aWFsJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICAvLyBSb2xlIHZhbGlkYXRpb24gLSB1c2luZyBjdXN0b20gZnVuY3Rpb24gZm9yIGFycmF5IGNvbnRhaW5zXG4gICAgICAgICAgICByb2xlczogW3sgY3VzdG9tOiAocm9sZXM6IHN0cmluZ1tdKSA9PiBBcnJheS5pc0FycmF5KHJvbGVzKSAmJiByb2xlcy5pbmNsdWRlcygnYXBwcm92ZXInKSB9XSxcbiAgICAgICAgICAgIHByaW1hcnlSb2xlOiBbeyBpbkxpc3Q6IFsnbWFuYWdlcicsICdkaXJlY3RvcicsICd2cCddIH1dLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBQZXJtaXNzaW9uIHZhbGlkYXRpb24gLSB1c2luZyBjdXN0b20gZnVuY3Rpb24gZm9yIGFycmF5IGNvbnRhaW5zXG4gICAgICAgICAgICBwZXJtaXNzaW9uczogW3sgY3VzdG9tOiAocGVybWlzc2lvbnM6IHN0cmluZ1tdKSA9PiBBcnJheS5pc0FycmF5KHBlcm1pc3Npb25zKSAmJiBwZXJtaXNzaW9ucy5pbmNsdWRlcygnYnVkZ2V0LmFwcHJvdmUnKSB9XSxcbiAgICAgICAgICAgIHBlcm1pc3Npb25MZXZlbDogW3sgaW5MaXN0OiBbJ3NlbmlvcicsICdleGVjdXRpdmUnXSB9XSxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRGVwYXJ0bWVudC1iYXNlZCBhY2Nlc3NcbiAgICAgICAgICAgIGRlcGFydG1lbnQ6IFt7IGVxOiAnZW5naW5lZXJpbmcnIH1dLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTZWN1cml0eSBjbGVhcmFuY2VcbiAgICAgICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiBbeyBpbkxpc3Q6IFsnY29uZmlkZW50aWFsJywgJ3NlY3JldCcsICd0b3Atc2VjcmV0J10gfV1cbiAgICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIC8vIEFtb3VudCBtdXN0IGJlIHdpdGhpbiBhcHByb3ZhbCBsaW1pdHNcbiAgICAgICAgICBhbW91bnQ6IFt7IGx0ZTogNTAwMDAgfV0sXG4gICAgICAgICAgLy8gUmVxdWVzdCB0eXBlIG11c3QgbWF0Y2ggcGVybWlzc2lvbnNcbiAgICAgICAgICByZXF1ZXN0VHlwZTogW3sgZXE6ICdidWRnZXQtYXBwcm92YWwnIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdmaW5hbmNpYWxBcHByb3ZhbCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdCdWRnZXRSZXF1ZXN0JyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBtYW5hZ2VyQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYW1vdW50OiAzNTAwMCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogJ2J1ZGdldC1hcHByb3ZhbCcsXG4gICAgICAgICAgZGVwYXJ0bWVudDogJ2VuZ2luZWVyaW5nJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ05ldyBzZXJ2ZXIgaW5mcmFzdHJ1Y3R1cmUnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCBpbnN1ZmZpY2llbnQgcm9sZSBwZXJtaXNzaW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGp1bmlvckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ2phbmUuanVuaW9yJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXJiYWMtMDAyJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQyMToxNTowMC4wMDBaJyxcbiAgICAgICAgXG4gICAgICAgIHJvbGVzOiBbJ2VtcGxveWVlJywgJ3ZpZXdlciddLFxuICAgICAgICBwcmltYXJ5Um9sZTogJ2VtcGxveWVlJyxcbiAgICAgICAgcGVybWlzc2lvbnM6IFsndXNlci5yZWFkJywgJ3JlcG9ydC52aWV3J10sXG4gICAgICAgIHBlcm1pc3Npb25MZXZlbDogJ2p1bmlvcicsXG4gICAgICAgIGRlcGFydG1lbnQ6ICdlbmdpbmVlcmluZycsXG4gICAgICAgIGFwcHJvdmFsTGltaXRzOiB7XG4gICAgICAgICAgZmluYW5jaWFsOiAwLFxuICAgICAgICAgIHRpbWVPZmY6IDAsXG4gICAgICAgICAgcHJvY3VyZW1lbnQ6IDBcbiAgICAgICAgfSxcbiAgICAgICAgc2VjdXJpdHlDbGVhcmFuY2U6ICdwdWJsaWMnXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHJvbGVzOiBbeyBjdXN0b206IChyb2xlczogc3RyaW5nW10pID0+IEFycmF5LmlzQXJyYXkocm9sZXMpICYmIHJvbGVzLmluY2x1ZGVzKCdhcHByb3ZlcicpIH1dLCAvLyBNaXNzaW5nIGFwcHJvdmVyIHJvbGVcbiAgICAgICAgICBzZWN1cml0eUNsZWFyYW5jZTogW3sgaW5MaXN0OiBbJ2NvbmZpZGVudGlhbCcsICdzZWNyZXQnXSB9XSAvLyBJbnN1ZmZpY2llbnQgY2xlYXJhbmNlXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdmaW5hbmNpYWxBcHByb3ZhbCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdCdWRnZXRSZXF1ZXN0JyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBqdW5pb3JBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBhbW91bnQ6IDM1MDAwLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiAnYnVkZ2V0LWFwcHJvdmFsJ1xuICAgICAgICB9LFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMik7IC8vIHJvbGVzIGFuZCBzZWN1cml0eUNsZWFyYW5jZSB2YWxpZGF0aW9ucyBzaG91bGQgZmFpbFxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzdWJzY3JpcHRpb24tYmFzZWQgZmVhdHVyZSBhY2Nlc3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBFbmhhbmNlZCBhY3RvciB3aXRoIHN1YnNjcmlwdGlvbiBjb250ZXh0XG4gICAgICBjb25zdCBlbnRlcnByaXNlQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnZW50ZXJwcmlzZS51c2VyJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXN1Yi0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDIyOjAwOjAwLjAwMFonLFxuICAgICAgICB0ZW5hbnRJZDogJ2VudGVycHJpc2UtY29ycCcsXG4gICAgICAgIFxuICAgICAgICAvLyBFbmhhbmNlZCBieSBjb250cm9sbGVyIHdpdGggc3Vic2NyaXB0aW9uIGRhdGFcbiAgICAgICAgc3Vic2NyaXB0aW9uOiB7XG4gICAgICAgICAgdGllcjogJ2VudGVycHJpc2UnLFxuICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgZmVhdHVyZXM6IFsnYWR2YW5jZWQtYW5hbHl0aWNzJywgJ2N1c3RvbS1icmFuZGluZycsICdzc28nLCAnYXVkaXQtbG9ncyddLFxuICAgICAgICAgIGxpbWl0czoge1xuICAgICAgICAgICAgdXNlcnM6IDEwMDAsXG4gICAgICAgICAgICBzdG9yYWdlOiAxMDczNzQxODI0MDAsIC8vIDEwMEdCXG4gICAgICAgICAgICBhcGlDYWxsc1Blck1vbnRoOiAxMDAwMDAwXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBsaWNlbnNlczogWydlbnRlcnByaXNlLWFkbWluJywgJ2FuYWx5dGljcy1wcm8nXSxcbiAgICAgICAgYWN0aXZlTGljZW5zZXM6IFsnZW50ZXJwcmlzZS1hZG1pbicsICdhbmFseXRpY3MtcHJvJ10sXG4gICAgICAgIHVzYWdlOiB7XG4gICAgICAgICAgYXBpQ2FsbHNUaGlzTW9udGg6IDQ1MDAwLFxuICAgICAgICAgIHN0b3JhZ2VVc2VkOiAyNjg0MzU0NTYwMCwgLy8gMjVHQlxuICAgICAgICAgIHVzZXJzQWN0aXZlOiA4OVxuICAgICAgICB9LFxuICAgICAgICBmZWF0dXJlRmxhZ3M6IHtcbiAgICAgICAgICAnYmV0YS1haS1mZWF0dXJlcyc6IHRydWUsXG4gICAgICAgICAgJ2FkdmFuY2VkLXJlcG9ydGluZyc6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAvLyBTdWJzY3JpcHRpb24gdmFsaWRhdGlvbiAtIHVzZSBjdXN0b20gdmFsaWRhdG9ycyBmb3IgbmVzdGVkIHByb3BlcnRpZXNcbiAgICAgICAgICBzdWJzY3JpcHRpb246IFt7IGN1c3RvbTogKHN1YjogYW55KSA9PiBzdWI/LnRpZXIgPT09ICdlbnRlcnByaXNlJyB8fCBzdWI/LnRpZXIgPT09ICdwcmVtaXVtJyB9XSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBMaWNlbnNlIHZhbGlkYXRpb24gLSB1c2UgY3VzdG9tIGZvciBhcnJheSBjb250YWluc1xuICAgICAgICAgIGFjdGl2ZUxpY2Vuc2VzOiBbeyBjdXN0b206IChsaWNlbnNlczogc3RyaW5nW10pID0+IEFycmF5LmlzQXJyYXkobGljZW5zZXMpICYmIGxpY2Vuc2VzLmluY2x1ZGVzKCdhbmFseXRpY3MtcHJvJykgfV0sXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRmVhdHVyZSBmbGFnIHZhbGlkYXRpb24gLSB1c2UgY3VzdG9tIGZvciBuZXN0ZWQgcHJvcGVydHlcbiAgICAgICAgICBmZWF0dXJlRmxhZ3M6IFt7IGN1c3RvbTogKGZsYWdzOiBhbnkpID0+IGZsYWdzPy5bJ2FkdmFuY2VkLXJlcG9ydGluZyddID09PSB0cnVlIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgLy8gRmVhdHVyZS1zcGVjaWZpYyB2YWxpZGF0aW9uXG4gICAgICAgICAgcmVwb3J0VHlwZTogW3sgaW5MaXN0OiBbJ2FkdmFuY2VkJywgJ2N1c3RvbSddIH1dLFxuICAgICAgICAgIGRhdGFSYW5nZTogW3sgaW5MaXN0OiBbJzF5ZWFyJywgJzJ5ZWFycycsICdhbGwtdGltZSddIH1dIC8vIEVudGVycHJpc2UgZ2V0cyBleHRlbmRlZCByYW5nZXNcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2dlbmVyYXRlQWR2YW5jZWRSZXBvcnQnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnQW5hbHl0aWNzUmVwb3J0JyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBlbnRlcnByaXNlQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgcmVwb3J0VHlwZTogJ2FkdmFuY2VkJyxcbiAgICAgICAgICBkYXRhUmFuZ2U6ICcyeWVhcnMnLFxuICAgICAgICAgIGluY2x1ZGVSYXdEYXRhOiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG1pZGRsZXdhcmUtZW5oYW5jZWQgc2VjdXJpdHkgY29udGV4dCcsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEVuaGFuY2VkIGFjdG9yIHdpdGggc2VjdXJpdHkgY29udGV4dCBmcm9tIG1pZGRsZXdhcmVcbiAgICAgIGNvbnN0IHNlY3VyZUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3NlY3VyaXR5LmFuYWx5c3QnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtc2VjLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjM6MDA6MDAuMDAwWicsXG4gICAgICAgIFxuICAgICAgICAvLyBFbmhhbmNlZCBieSBtaWRkbGV3YXJlXG4gICAgICAgIHJpc2tQcm9maWxlOiB7XG4gICAgICAgICAgc2NvcmU6IDI1LCAvLyBsb3cgcmlza1xuICAgICAgICAgIGxldmVsOiAnbG93JyxcbiAgICAgICAgICBmYWN0b3JzOiBbXSxcbiAgICAgICAgICB0aHJlYXRMZXZlbDogJ21pbmltYWwnXG4gICAgICAgIH0sXG4gICAgICAgIGRldmljZToge1xuICAgICAgICAgIHR5cGU6ICdkZXNrdG9wJyxcbiAgICAgICAgICB0cnVzdGVkOiB0cnVlLFxuICAgICAgICAgIHBsYXRmb3JtOiAnV2luZG93cydcbiAgICAgICAgfSxcbiAgICAgICAgc2VjdXJpdHk6IHtcbiAgICAgICAgICBtZmFWZXJpZmllZDogdHJ1ZSxcbiAgICAgICAgICB2cG5EZXRlY3RlZDogZmFsc2UsXG4gICAgICAgICAgYW5vbWFseUZsYWdzOiBbXVxuICAgICAgICB9LFxuICAgICAgICBzZXNzaW9uOiB7XG4gICAgICAgICAgbWZhVmVyaWZpZWQ6IHRydWUsXG4gICAgICAgICAgZGV2aWNlVHJ1c3RlZDogdHJ1ZSxcbiAgICAgICAgICBzdGFydGVkQXQ6ICcyMDI0LTAxLTE1VDA4OjAwOjAwLjAwMFonXG4gICAgICAgIH1cbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgLy8gUmlzayBhc3Nlc3NtZW50IHZhbGlkYXRpb24gLSB1c2UgY3VzdG9tIGZvciBuZXN0ZWQgcHJvcGVydGllc1xuICAgICAgICAgIHJpc2tQcm9maWxlOiBbeyBjdXN0b206IChyaXNrOiBhbnkpID0+IHJpc2s/LmxldmVsID09PSAnbG93JyB8fCByaXNrPy5sZXZlbCA9PT0gJ21pbmltYWwnIH1dLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIERldmljZSBzZWN1cml0eSB2YWxpZGF0aW9uXG4gICAgICAgICAgZGV2aWNlOiBbeyBjdXN0b206IChkZXZpY2U6IGFueSkgPT4gZGV2aWNlPy50cnVzdGVkID09PSB0cnVlIH1dLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFNlY3VyaXR5IHZhbGlkYXRpb24gIFxuICAgICAgICAgIHNlY3VyaXR5OiBbeyBjdXN0b206IChzZWM6IGFueSkgPT4gc2VjPy5tZmFWZXJpZmllZCA9PT0gdHJ1ZSAmJiBzZWM/LnZwbkRldGVjdGVkID09PSBmYWxzZSB9XSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBTZXNzaW9uIHZhbGlkYXRpb25cbiAgICAgICAgICBzZXNzaW9uOiBbeyBjdXN0b206IChzZXNzOiBhbnkpID0+IHNlc3M/LmRldmljZVRydXN0ZWQgPT09IHRydWUgJiYgc2Vzcz8ubWZhVmVyaWZpZWQgPT09IHRydWUgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICAvLyBTZW5zaXRpdmUgb3BlcmF0aW9uIHZhbGlkYXRpb25cbiAgICAgICAgICBvcGVyYXRpb25UeXBlOiBbeyBpbkxpc3Q6IFsndXNlci5zdXNwZW5kJywgJ3NlY3VyaXR5LmF1ZGl0JywgJ2FkbWluLmFjY2VzcyddIH1dLFxuICAgICAgICAgIGRhdGFDbGFzc2lmaWNhdGlvbjogW3sgaW5MaXN0OiBbJ2NvbmZpZGVudGlhbCcsICdpbnRlcm5hbCddIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdzZW5zaXRpdmVTZWN1cml0eU9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdTZWN1cml0eUFjdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3Rvcjogc2VjdXJlQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ3NlY3VyaXR5LmF1ZGl0JyxcbiAgICAgICAgICBkYXRhQ2xhc3NpZmljYXRpb246ICdjb25maWRlbnRpYWwnLFxuICAgICAgICAgIHRhcmdldFVzZXJJZDogJ3N1c3BpY2lvdXMudXNlcidcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IGhpZ2gtcmlzayBzZWN1cml0eSBzY2VuYXJpb3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByaXNreUFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3Jpc2t5LnVzZXInLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtcmlzay0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDIzOjMwOjAwLjAwMFonLFxuICAgICAgICBcbiAgICAgICAgcmlza1Byb2ZpbGU6IHtcbiAgICAgICAgICBzY29yZTogODUsIC8vIGhpZ2ggcmlza1xuICAgICAgICAgIGxldmVsOiAnaGlnaCcsXG4gICAgICAgICAgZmFjdG9yczogWyduZXctZGV2aWNlJywgJ3VudXN1YWwtbG9jYXRpb24nLCAndmVsb2NpdHktYW5vbWFseSddLFxuICAgICAgICAgIHRocmVhdExldmVsOiAnZWxldmF0ZWQnXG4gICAgICAgIH0sXG4gICAgICAgIGRldmljZToge1xuICAgICAgICAgIHR5cGU6ICdtb2JpbGUnLFxuICAgICAgICAgIHRydXN0ZWQ6IGZhbHNlLCAvLyBVbnRydXN0ZWQgZGV2aWNlXG4gICAgICAgICAgcGxhdGZvcm06ICdpT1MnXG4gICAgICAgIH0sXG4gICAgICAgIHNlY3VyaXR5OiB7XG4gICAgICAgICAgbWZhVmVyaWZpZWQ6IGZhbHNlLCAvLyBNRkEgbm90IHZlcmlmaWVkXG4gICAgICAgICAgdnBuRGV0ZWN0ZWQ6IHRydWUsIC8vIFZQTiBkZXRlY3RlZFxuICAgICAgICAgIGFub21hbHlGbGFnczogWydsb2dpbi10aW1lLXVudXN1YWwnLCAnbG9jYXRpb24tYW5vbWFseSddXG4gICAgICAgIH1cbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcmlza1Byb2ZpbGU6IFt7IGN1c3RvbTogKHJpc2s6IGFueSkgPT4gKHJpc2s/LmxldmVsID09PSAnbG93JyB8fCByaXNrPy5sZXZlbCA9PT0gJ21pbmltYWwnKSAmJiByaXNrPy5zY29yZSA8PSA1MCB9XSxcbiAgICAgICAgICBkZXZpY2U6IFt7IGN1c3RvbTogKGRldmljZTogYW55KSA9PiBkZXZpY2U/LnRydXN0ZWQgPT09IHRydWUgfV0sXG4gICAgICAgICAgc2VjdXJpdHk6IFt7IGN1c3RvbTogKHNlYzogYW55KSA9PiBzZWM/Lm1mYVZlcmlmaWVkID09PSB0cnVlICYmIHNlYz8udnBuRGV0ZWN0ZWQgPT09IGZhbHNlIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdzZW5zaXRpdmVTZWN1cml0eU9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdTZWN1cml0eUFjdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3Rvcjogcmlza3lBY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBvcGVyYXRpb25UeXBlOiAndXNlci5zdXNwZW5kJyxcbiAgICAgICAgICBkYXRhQ2xhc3NpZmljYXRpb246ICdjb25maWRlbnRpYWwnXG4gICAgICAgIH0sXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgzKTsgLy8gcmlza1Byb2ZpbGUsIGRldmljZSwgYW5kIHNlY3VyaXR5IHZhbGlkYXRpb25zIHNob3VsZCBmYWlsXG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGNvbXBsaWFuY2UgYW5kIGF1ZGl0IHJlcXVpcmVtZW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBsaWFuY2VBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdjb21wbGlhbmNlLm9mZmljZXInLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY29tcC0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE2VDAwOjAwOjAwLjAwMFonLFxuICAgICAgICB0ZW5hbnRJZDogJ3JlZ3VsYXRlZC1maW5hbmNpYWwnLFxuICAgICAgICBcbiAgICAgICAgLy8gRW5oYW5jZWQgYnkgbWlkZGxld2FyZSB3aXRoIGNvbXBsaWFuY2UgY29udGV4dFxuICAgICAgICBjb21wbGlhbmNlOiB7XG4gICAgICAgICAgc3RhdHVzOiAnY29tcGxpYW50JyxcbiAgICAgICAgICBjZXJ0aWZpY2F0aW9uczogWydTT0MyLVR5cGUyJywgJ0lTTzI3MDAxJywgJ1BDSS1EU1MnXSxcbiAgICAgICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgICAgICBnZHByU3RhdHVzOiB7IGxhd2Z1bEJhc2lzOiAnbGVnaXRpbWF0ZS1pbnRlcmVzdCcsIGRhdGFTdWJqZWN0OiB0cnVlIH0sXG4gICAgICAgICAgc294Q29tcGxpYW50OiB7IGNlcnRpZmllZDogdHJ1ZSwgbGFzdENlcnRpZmljYXRpb246ICcyMDIzLTEyLTMxJyB9XG4gICAgICAgIH0sXG4gICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgdHJhaWxFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNlbnNpdGl2ZU9wZXJhdGlvbnM6IFsnZmluYW5jaWFsLmFwcHJvdmUnLCAnZGF0YS5leHBvcnQnXSxcbiAgICAgICAgICByZXRlbnRpb25QZXJpb2Q6IDI1NTUsIC8vIDcgeWVhcnNcbiAgICAgICAgICBoaWdoUmlza09wZXJhdGlvbnM6IFsndXNlci5kZWxldGUnLCAnYXVkaXQubW9kaWZ5J10sXG4gICAgICAgICAgcmVhbFRpbWVNb25pdG9yaW5nOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIHJvbGVzOiBbJ2NvbXBsaWFuY2Utb2ZmaWNlcicsICdhdWRpdG9yJ10sXG4gICAgICAgIHNlY3VyaXR5Q2xlYXJhbmNlOiAnY29uZmlkZW50aWFsJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAvLyBDb21wbGlhbmNlIHZhbGlkYXRpb24gLSB1c2UgY3VzdG9tIGZvciBuZXN0ZWQgcHJvcGVydGllc1xuICAgICAgICAgIGNvbXBsaWFuY2U6IFt7IGN1c3RvbTogKGNvbXA6IGFueSkgPT4gXG4gICAgICAgICAgICBjb21wPy5zdGF0dXMgPT09ICdjb21wbGlhbnQnICYmIFxuICAgICAgICAgICAgQXJyYXkuaXNBcnJheShjb21wPy5jZXJ0aWZpY2F0aW9ucykgJiYgY29tcC5jZXJ0aWZpY2F0aW9ucy5pbmNsdWRlcygnU09DMi1UeXBlMicpICYmXG4gICAgICAgICAgICBBcnJheS5pc0FycmF5KGNvbXA/LnZpb2xhdGlvbnMpICYmIGNvbXAudmlvbGF0aW9ucy5sZW5ndGggPT09IDAgJiZcbiAgICAgICAgICAgIGNvbXA/LnNveENvbXBsaWFudD8uY2VydGlmaWVkID09PSB0cnVlXG4gICAgICAgICAgfV0sXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gQXVkaXQgdmFsaWRhdGlvbiAtIHVzZSBjdXN0b20gZm9yIG5lc3RlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgYXVkaXQ6IFt7IGN1c3RvbTogKGF1ZGl0OiBhbnkpID0+IFxuICAgICAgICAgICAgYXVkaXQ/LnRyYWlsRW5hYmxlZCA9PT0gdHJ1ZSAmJiBcbiAgICAgICAgICAgIGF1ZGl0Py5yZXRlbnRpb25QZXJpb2QgPj0gMjU1NSAmJlxuICAgICAgICAgICAgYXVkaXQ/LnJlYWxUaW1lTW9uaXRvcmluZyA9PT0gdHJ1ZVxuICAgICAgICAgIH1dLFxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFJvbGUgdmFsaWRhdGlvblxuICAgICAgICAgIHJvbGVzOiBbeyBjdXN0b206IChyb2xlczogc3RyaW5nW10pID0+IEFycmF5LmlzQXJyYXkocm9sZXMpICYmIHJvbGVzLmluY2x1ZGVzKCdjb21wbGlhbmNlLW9mZmljZXInKSB9XSxcbiAgICAgICAgICBzZWN1cml0eUNsZWFyYW5jZTogW3sgaW5MaXN0OiBbJ2NvbmZpZGVudGlhbCcsICdzZWNyZXQnXSB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIC8vIEZpbmFuY2lhbCBjb21wbGlhbmNlIHZhbGlkYXRpb25cbiAgICAgICAgICB0cmFuc2FjdGlvblR5cGU6IFt7IGluTGlzdDogWydhdWRpdC1yZXZpZXcnLCAnY29tcGxpYW5jZS1jaGVjayddIH1dLFxuICAgICAgICAgIGFtb3VudDogW3sgZ3RlOiAwIH1dLFxuICAgICAgICAgIHJlZ3VsYXRvcnlGcmFtZXdvcms6IFt7IGluTGlzdDogWydTT1gnLCAnR0RQUicsICdQQ0ktRFNTJ10gfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2ZpbmFuY2lhbENvbXBsaWFuY2VSZXZpZXcnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnQ29tcGxpYW5jZVJlcG9ydCcsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogY29tcGxpYW5jZUFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHRyYW5zYWN0aW9uVHlwZTogJ2F1ZGl0LXJldmlldycsXG4gICAgICAgICAgYW1vdW50OiAyNTAwMDAsXG4gICAgICAgICAgcmVndWxhdG9yeUZyYW1ld29yazogJ1NPWCcsXG4gICAgICAgICAgcmV2aWV3VHlwZTogJ3F1YXJ0ZXJseSdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==