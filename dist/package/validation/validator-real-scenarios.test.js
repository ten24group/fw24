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
                apiKeyId: 'sync-key-123',
                sourceIp: '10.0.1.100'
            };
            const entityValidations = {
                actor: {
                    actorType: [{ eq: 'service' }],
                    authMethod: [{ eq: 'api-key' }],
                    apiKeyId: [{ required: true }],
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
                actorId: 'system',
                actorType: 'system',
                requestId: 'req-system-001',
                timestamp: '2024-01-15T02:00:00.000Z',
                authMethod: 'system',
                maintenanceWindow: true
            };
            const entityValidations = {
                actor: {
                    actorId: [{ eq: 'system' }],
                    actorType: [{ eq: 'system' }],
                    authMethod: [{ eq: 'system' }],
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
                cognitoGroups: ['team-admin'],
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
        (0, globals_1.it)('should reject unqualified practitioners', async () => {
            const studentActor = {
                actorId: 'student-001',
                actorType: 'user',
                requestId: 'req-student-001',
                timestamp: '2024-01-15T19:00:00.000Z',
                profession: 'medical-student', // Not a qualified doctor
                isActive: true
            };
            const entityValidations = {
                actor: {
                    profession: [{ eq: 'doctor' }], // Must be doctor
                    licenseNumber: [{ required: true }] // Must have license
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
            (0, globals_1.expect)(result.errors).toHaveLength(2); // profession and licenseNumber both fail
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
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdG9yLXJlYWwtc2NlbmFyaW9zLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdmFsaWRhdGlvbi92YWxpZGF0b3ItcmVhbC1zY2VuYXJpb3MudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUFxRDtBQUNyRCwyQ0FBd0M7QUFJeEMsSUFBQSxrQkFBUSxFQUFDLHNDQUFzQyxFQUFFLEdBQUcsRUFBRTtJQUNwRCxNQUFNLFNBQVMsR0FBRyxJQUFJLHFCQUFTLEVBQUUsQ0FBQztJQUVsQyxJQUFBLGtCQUFRLEVBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO1FBRXhDLElBQUEsWUFBRSxFQUFDLDJEQUEyRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3pFLE1BQU0sVUFBVSxHQUFVO2dCQUN4QixPQUFPLEVBQUUsZ0JBQWdCO2dCQUN6QixTQUFTLEVBQUUsTUFBTTtnQkFDakIsU0FBUyxFQUFFLGVBQWU7Z0JBQzFCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixJQUFJLEVBQUUsT0FBTztnQkFDYixVQUFVLEVBQUUsZ0JBQWdCO2dCQUM1QixjQUFjLEVBQUUsTUFBTTthQUNoQixDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsQ0FBQztvQkFDdkIsY0FBYyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLENBQUM7b0JBQ2hDLFVBQVUsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDO2lCQUNoQztnQkFDRCxLQUFLLEVBQUU7b0JBQ0wsYUFBYSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsdUJBQXVCLEVBQUUsQ0FBQztvQkFDaEQsYUFBYSxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFF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LElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLDhDQUE4QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzVELE1BQU0sZ0JBQWdCLEdBQVU7Z0JBQzlCLE9BQU8sRUFBRSxVQUFVO2dCQUNuQixTQUFTLEVBQUUsdUJBQXVCO2dCQUNsQyxTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxJQUFJLEVBQUUsTUFBTSxDQUFDLGtCQUFrQjthQUN6QixDQUFDO1lBRVQsTUFBTSxpQkFBaUIsR0FBcUM7Z0JBQzFELEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDLDBCQUEwQjtpQkFDdkQ7YUFDRixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsY0FBYyxDQUFDO2dCQUM1QyxhQUFhLEVBQUUsaUJBQWlCO2dCQUNoQyxVQUFVLEVBQUUsbUJBQW1CO2dCQUMvQixpQkFBaUI7Z0JBQ2pCLEtBQUssRUFBRSxnQkFBZ0I7Z0JBQ3ZCLEtBQUssRUFBRTtvQkFDTCxNQUFNLEVBQUUsUUFBUTtvQkFDaEIsU0FBUyxFQUFFLFVBQVU7aUJBQ3RCO2dCQUNELGFBQWEsRUFBRSxJQUFJO2FBQ3BCLENBQUMsQ0FBQztZQUVILElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2hDLElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3hDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0IH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5pbXBvcnQgeyBWYWxpZGF0b3IgfSBmcm9tICcuL3ZhbGlkYXRvcic7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvYWN0b3InO1xuaW1wb3J0IHsgRW50aXR5VmFsaWRhdGlvbnMgfSBmcm9tICcuL3R5cGVzJztcblxuZGVzY3JpYmUoJ1ZhbGlkYXRvciBSZWFsLVdvcmxkIEFjdG9yIFNjZW5hcmlvcycsICgpID0+IHtcbiAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvcigpO1xuXG4gIGRlc2NyaWJlKCdSb2xlLUJhc2VkIEF1dGhvcml6YXRpb24nLCAoKSA9PiB7XG4gICAgXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhZG1pbiB1c2VyIGFjY2VzcyB0byBzZW5zaXRpdmUgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFkbWluQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYWRtaW4tdXNlci0wMDEnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFkbWluLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcm9sZTogJ2FkbWluJyxcbiAgICAgICAgZGVwYXJ0bWVudDogJ2FkbWluaXN0cmF0aW9uJyxcbiAgICAgICAgY2xlYXJhbmNlTGV2ZWw6ICdoaWdoJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ2FkbWluJyB9XSxcbiAgICAgICAgICBjbGVhcmFuY2VMZXZlbDogW3sgZXE6ICdoaWdoJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbeyBlcTogJ2NvZ25pdG8nIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgb3BlcmF0aW9uVHlwZTogW3sgZXE6ICdzZW5zaXRpdmUtZGF0YS1hY2Nlc3MnIH1dLFxuICAgICAgICAgIGp1c3RpZmljYXRpb246IFt7IHJlcXVpcmVkOiB0cnVlIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdhY2Nlc3NTZW5zaXRpdmVEYXRhJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1NlY3VyaXR5T3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBhZG1pbkFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICdzZW5zaXRpdmUtZGF0YS1hY2Nlc3MnLFxuICAgICAgICAgIGp1c3RpZmljYXRpb246ICdTZWN1cml0eSBhdWRpdCByZXF1aXJlZCBieSBjb21wbGlhbmNlIHRlYW0nXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCByZWd1bGFyIHVzZXIgYWNjZXNzIHRvIGFkbWluIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWd1bGFyVXNlckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS11c2VyLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTE6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcm9sZTogJ3VzZXInLCAvLyBOb3QgYWRtaW5cbiAgICAgICAgZGVwYXJ0bWVudDogJ21hcmtldGluZydcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcm9sZTogW3sgZXE6ICdhZG1pbicgfV0gLy8gUmVxdWlyZXMgYWRtaW4gcm9sZVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnYWNjZXNzU2Vuc2l0aXZlRGF0YScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdTZWN1cml0eU9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogcmVndWxhclVzZXJBY3RvcixcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZSxcbiAgICAgICAgdmVyYm9zZUVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnM/LlswXT8ubWVzc2FnZUlkcykudG9Db250YWluKCd2YWxpZGF0aW9uLmVudGl0eS5zZWN1cml0eW9wZXJhdGlvbi5hY3Rvci5yb2xlLmVxLmFkbWluJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG1hbmFnZXIgYXBwcm92YWwgbGltaXRzIGJhc2VkIG9uIGFjdG9yIHByb3BlcnRpZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBtYW5hZ2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnbWdyLTAwMScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1hcHByb3ZhbC0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEyOjAwOjAwLjAwMFonLFxuICAgICAgICByb2xlOiAnbWFuYWdlcicsXG4gICAgICAgIGRlcGFydG1lbnQ6ICdmaW5hbmNlJyxcbiAgICAgICAgYXBwcm92YWxMaW1pdDogMTAwMDBcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgcm9sZTogW3sgZXE6ICdtYW5hZ2VyJyB9XSxcbiAgICAgICAgICBkZXBhcnRtZW50OiBbeyBlcTogJ2ZpbmFuY2UnIH1dLFxuICAgICAgICAgIGFwcHJvdmFsTGltaXQ6IFt7IGd0ZTogNTAwMCB9XSAvLyBNdXN0IGhhdmUgYXBwcm92YWwgbGltaXQgPj0gNTAwMFxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFtb3VudDogW3sgbHRlOiAxMDAwMCB9XSwgLy8gQW1vdW50IG11c3QgYmUgd2l0aGluIGxpbWl0XG4gICAgICAgICAgdmVuZG9yOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBjYXRlZ29yeTogW3sgaW5MaXN0OiBbJ29mZmljZS1zdXBwbGllcycsICdzb2Z0d2FyZScsICdlcXVpcG1lbnQnXSB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnYXBwcm92ZUV4cGVuc2UnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnRXhwZW5zZUFwcHJvdmFsJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBtYW5hZ2VyQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYW1vdW50OiA3NTAwLFxuICAgICAgICAgIHZlbmRvcjogJ09mZmljZSBEZXBvdCcsXG4gICAgICAgICAgY2F0ZWdvcnk6ICdvZmZpY2Utc3VwcGxpZXMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTW9udGhseSBvZmZpY2Ugc3VwcGx5IG9yZGVyJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgYXBwcm92YWwgd2hlbiBhbW91bnQgZXhjZWVkcyBhY3RvciBhcHByb3ZhbCBsaW1pdCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGxvd0xldmVsTWFuYWdlckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ21nci1qdW5pb3ItMDAxJyxcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFwcHJvdmFsLTAwMicsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTM6MDA6MDAuMDAwWicsXG4gICAgICAgIHJvbGU6ICdtYW5hZ2VyJyxcbiAgICAgICAgZGVwYXJ0bWVudDogJ2ZpbmFuY2UnLFxuICAgICAgICBhcHByb3ZhbExpbWl0OiAyMDAwIC8vIExvdyBhcHByb3ZhbCBsaW1pdFxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBhcHByb3ZhbExpbWl0OiBbeyBndGU6IDUwMDAgfV0gLy8gUmVxdWlyZXMgaGlnaGVyIGFwcHJvdmFsIGxpbWl0XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdhcHByb3ZlRXhwZW5zZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdFeHBlbnNlQXBwcm92YWwnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IGxvd0xldmVsTWFuYWdlckFjdG9yLFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTZXJ2aWNlIEF1dGhlbnRpY2F0aW9uJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgQVBJIGtleSBzZXJ2aWNlIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlTZXJ2aWNlQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnYXBpLWtleTpkYXRhLXN5bmMtc2VydmljZScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtc2VydmljZS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDE0OjAwOjAwLjAwMFonLFxuICAgICAgICBhdXRoTWV0aG9kOiAnYXBpLWtleScsXG4gICAgICAgIGFwaUtleUlkOiAnc3luYy1rZXktMTIzJyxcbiAgICAgICAgc291cmNlSXA6ICcxMC4wLjEuMTAwJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGFjdG9yVHlwZTogW3sgZXE6ICdzZXJ2aWNlJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbeyBlcTogJ2FwaS1rZXknIH1dLFxuICAgICAgICAgIGFwaUtleUlkOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBzb3VyY2VJcDogW3sgcmVxdWlyZWQ6IHRydWUgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBiYXRjaFNpemU6IFt7IGx0ZTogMTAwMCB9XSwgLy8gU2VydmljZXMgY2FuIHByb2Nlc3MgdXAgdG8gMTAwMCByZWNvcmRzXG4gICAgICAgICAgZGF0YVNvdXJjZTogW3sgcmVxdWlyZWQ6IHRydWUgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2JhdGNoU3luYycsXG4gICAgICAgIGVudGl0eU5hbWU6ICdEYXRhU3luY2hyb25pemF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBhcGlTZXJ2aWNlQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgYmF0Y2hTaXplOiA1MDAsXG4gICAgICAgICAgZGF0YVNvdXJjZTogJ2V4dGVybmFsLWNybScsXG4gICAgICAgICAgcmVjb3JkczogWydyZWNvcmQxJywgJ3JlY29yZDInLCAncmVjb3JkMyddXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCB1c2VyIGF1dGhlbnRpY2F0aW9uIGZvciBzZXJ2aWNlLW9ubHkgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHVzZXJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLTAwMScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLCAvLyBTaG91bGQgYmUgc2VydmljZVxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdXNlci1zZXJ2aWNlLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTU6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyAvLyBTaG91bGQgYmUgYXBpLWtleVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIGFjdG9yVHlwZTogW3sgZXE6ICdzZXJ2aWNlJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbeyBlcTogJ2FwaS1rZXknIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdiYXRjaFN5bmMnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnRGF0YVN5bmNocm9uaXphdGlvbicsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogdXNlckFjdG9yLFxuICAgICAgICBjb2xsZWN0RXJyb3JzOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMik7IC8vIEJvdGggYWN0b3JUeXBlIGFuZCBhdXRoTWV0aG9kIHdpbGwgZmFpbFxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzeXN0ZW0gYWN0b3IgZm9yIG1haW50ZW5hbmNlIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzeXN0ZW1BY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICdzeXN0ZW0nLFxuICAgICAgICBhY3RvclR5cGU6ICdzeXN0ZW0nLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtc3lzdGVtLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMDI6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdzeXN0ZW0nLFxuICAgICAgICBtYWludGVuYW5jZVdpbmRvdzogdHJ1ZVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBhY3RvcklkOiBbeyBlcTogJ3N5c3RlbScgfV0sXG4gICAgICAgICAgYWN0b3JUeXBlOiBbeyBlcTogJ3N5c3RlbScgfV0sXG4gICAgICAgICAgYXV0aE1ldGhvZDogW3sgZXE6ICdzeXN0ZW0nIH1dLFxuICAgICAgICAgIG1haW50ZW5hbmNlV2luZG93OiBbeyBlcTogdHJ1ZSB9XVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIG9wZXJhdGlvblR5cGU6IFt7IGluTGlzdDogWydjbGVhbnVwJywgJ2JhY2t1cCcsICdtaWdyYXRpb24nXSB9XSxcbiAgICAgICAgICBhZmZlY3RlZFRhYmxlczogW3sgcmVxdWlyZWQ6IHRydWUgfV1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlRW50aXR5KHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogJ3N5c3RlbU1haW50ZW5hbmNlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ01haW50ZW5hbmNlT3BlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBzeXN0ZW1BY3RvcixcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBvcGVyYXRpb25UeXBlOiAnY2xlYW51cCcsXG4gICAgICAgICAgYWZmZWN0ZWRUYWJsZXM6IFsnbG9ncycsICd0ZW1wX2RhdGEnXSxcbiAgICAgICAgICByZXRlbnRpb25EYXlzOiA5MFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5wYXNzKS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnVGVuYW50IElzb2xhdGlvbicsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHRlbmFudC1zY29wZWQgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHRlbmFudFVzZXJBY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd0ZW5hbnQtYWRtaW4tMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS10ZW5hbnQtMDAxJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxNjowMDowMC4wMDBaJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICB0ZW5hbnRJZDogJ2NvbXBhbnktYS10ZW5hbnQnLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiBbJ3RlYW0tYWRtaW4nXSxcbiAgICAgICAgcm9sZTogJ2FkbWluJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICB0ZW5hbnRJZDogW3sgZXE6ICdjb21wYW55LWEtdGVuYW50JyB9XSxcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ2FkbWluJyB9XSxcbiAgICAgICAgICBhdXRoTWV0aG9kOiBbeyBlcTogJ2NvZ25pdG8nIH1dXG4gICAgICAgIH0sXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdGFyZ2V0VGVuYW50SWQ6IFt7IGVxOiAnY29tcGFueS1hLXRlbmFudCcgfV0sIC8vIE11c3QgbWF0Y2ggYWN0b3IncyB0ZW5hbnRcbiAgICAgICAgICBvcGVyYXRpb246IFt7IGluTGlzdDogWydjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZSddIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICd0ZW5hbnRBZG1pbk9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdUZW5hbnRSZXNvdXJjZScsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogdGVuYW50VXNlckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHRhcmdldFRlbmFudElkOiAnY29tcGFueS1hLXRlbmFudCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlJyxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6ICd1c2VyLWFjY291bnQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByZXZlbnQgY3Jvc3MtdGVuYW50IGFjY2VzcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1hbGljaW91c1RlbmFudEFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ21hbGljaW91cy11c2VyLTAwMScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3Jvc3MtdGVuYW50LTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTc6MDA6MDAuMDAwWicsXG4gICAgICAgIHRlbmFudElkOiAnY29tcGFueS1iLXRlbmFudCcsXG4gICAgICAgIHJvbGU6ICdhZG1pbidcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBjb25zdCBlbnRpdHlWYWxpZGF0aW9uczogRW50aXR5VmFsaWRhdGlvbnM8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgdGVuYW50SWQ6IFt7IGVxOiAnY29tcGFueS1hLXRlbmFudCcgfV0gLy8gTXVzdCBiZSBmcm9tIGNvbXBhbnkgQVxuICAgICAgICB9LFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHRhcmdldFRlbmFudElkOiBbeyBlcTogJ2NvbXBhbnktYS10ZW5hbnQnIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICd0ZW5hbnRBZG1pbk9wZXJhdGlvbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdUZW5hbnRSZXNvdXJjZScsXG4gICAgICAgIGVudGl0eVZhbGlkYXRpb25zLFxuICAgICAgICBhY3RvcjogbWFsaWNpb3VzVGVuYW50QWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdGFyZ2V0VGVuYW50SWQ6ICdjb21wYW55LWEtdGVuYW50JywgLy8gVHJ5aW5nIHRvIGFjY2VzcyBjb21wYW55IEEgZGF0YVxuICAgICAgICAgIG9wZXJhdGlvbjogJ2RlbGV0ZSdcbiAgICAgICAgfSxcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQ29tcGxleCBBY3RvciBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgIFxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgbXVsdGktZmllbGQgYWN0b3IgcmVxdWlyZW1lbnRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcXVhbGlmaWVkRG9jdG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnZHItc21pdGgtMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1tZWRpY2FsLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTg6MDA6MDAuMDAwWicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgcHJvZmVzc2lvbjogJ2RvY3RvcicsXG4gICAgICAgIGxpY2Vuc2VOdW1iZXI6ICdNRC0xMjM0NTYnLFxuICAgICAgICBzcGVjaWFsaXphdGlvbjogJ2NhcmRpb2xvZ3knLFxuICAgICAgICBob3NwaXRhbElkOiAnaG9zcC1tYWluLTAwMScsXG4gICAgICAgIGlzQWN0aXZlOiB0cnVlXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHByb2Zlc3Npb246IFt7IGVxOiAnZG9jdG9yJyB9XSxcbiAgICAgICAgICBsaWNlbnNlTnVtYmVyOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBzcGVjaWFsaXphdGlvbjogW3sgaW5MaXN0OiBbJ2NhcmRpb2xvZ3knLCAnc3VyZ2VyeScsICduZXVyb2xvZ3knXSB9XSxcbiAgICAgICAgICBob3NwaXRhbElkOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBpc0FjdGl2ZTogW3sgZXE6IHRydWUgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBwYXRpZW50SWQ6IFt7IHJlcXVpcmVkOiB0cnVlIH1dLFxuICAgICAgICAgIHByb2NlZHVyZVR5cGU6IFt7IGluTGlzdDogWydleGFtaW5hdGlvbicsICdzdXJnZXJ5JywgJ2NvbnN1bHRhdGlvbiddIH1dLFxuICAgICAgICAgIHVyZ2VuY3lMZXZlbDogW3sgaW5MaXN0OiBbJ2xvdycsICdtZWRpdW0nLCAnaGlnaCcsICdjcml0aWNhbCddIH1dXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdtZWRpY2FsUHJvY2VkdXJlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ01lZGljYWxSZWNvcmQnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IHF1YWxpZmllZERvY3RvckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIHBhdGllbnRJZDogJ3BhdGllbnQtMDAxJyxcbiAgICAgICAgICBwcm9jZWR1cmVUeXBlOiAnZXhhbWluYXRpb24nLFxuICAgICAgICAgIHVyZ2VuY3lMZXZlbDogJ21lZGl1bScsXG4gICAgICAgICAgbm90ZXM6ICdSb3V0aW5lIGNhcmRpYWMgZXhhbWluYXRpb24nXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCB1bnF1YWxpZmllZCBwcmFjdGl0aW9uZXJzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3R1ZGVudEFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3N0dWRlbnQtMDAxJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1zdHVkZW50LTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTk6MDA6MDAuMDAwWicsXG4gICAgICAgIHByb2Zlc3Npb246ICdtZWRpY2FsLXN0dWRlbnQnLCAvLyBOb3QgYSBxdWFsaWZpZWQgZG9jdG9yXG4gICAgICAgIGlzQWN0aXZlOiB0cnVlXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHByb2Zlc3Npb246IFt7IGVxOiAnZG9jdG9yJyB9XSwgLy8gTXVzdCBiZSBkb2N0b3JcbiAgICAgICAgICBsaWNlbnNlTnVtYmVyOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSAvLyBNdXN0IGhhdmUgbGljZW5zZVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnbWVkaWNhbFByb2NlZHVyZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdNZWRpY2FsUmVjb3JkJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiBzdHVkZW50QWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgcGF0aWVudElkOiAncGF0aWVudC0wMDEnLFxuICAgICAgICAgIHByb2NlZHVyZVR5cGU6ICdleGFtaW5hdGlvbidcbiAgICAgICAgfSxcbiAgICAgICAgY29sbGVjdEVycm9yczogdHJ1ZVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocmVzdWx0LmVycm9ycykudG9IYXZlTGVuZ3RoKDIpOyAvLyBwcm9mZXNzaW9uIGFuZCBsaWNlbnNlTnVtYmVyIGJvdGggZmFpbFxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhY3RvciB3aXRoIGN1c3RvbSBidXNpbmVzcyBsb2dpYyBmaWVsZHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwcmVtaXVtVXNlckFjdG9yOiBBY3RvciA9IHtcbiAgICAgICAgYWN0b3JJZDogJ3ByZW1pdW0tdXNlci0wMDEnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtcHJlbWl1bS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDIwOjAwOjAwLjAwMFonLFxuICAgICAgICBzdWJzY3JpcHRpb25UaWVyOiAncHJlbWl1bScsXG4gICAgICAgIGFjY291bnRBZ2U6IDM2NSwgLy8gZGF5c1xuICAgICAgICB0cnVzdFNjb3JlOiA4NTAsXG4gICAgICAgIHZlcmlmaWNhdGlvblN0YXR1czogJ3ZlcmlmaWVkJ1xuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICBzdWJzY3JpcHRpb25UaWVyOiBbeyBpbkxpc3Q6IFsncHJlbWl1bScsICdlbnRlcnByaXNlJ10gfV0sXG4gICAgICAgICAgYWNjb3VudEFnZTogW3sgZ3RlOiAzMCB9XSwgLy8gTXVzdCBiZSBhdCBsZWFzdCAzMCBkYXlzIG9sZFxuICAgICAgICAgIHRydXN0U2NvcmU6IFt7IGd0ZTogNzAwIH1dLCAvLyBNdXN0IGhhdmUgaGlnaCB0cnVzdCBzY29yZVxuICAgICAgICAgIHZlcmlmaWNhdGlvblN0YXR1czogW3sgZXE6ICd2ZXJpZmllZCcgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICB1cGxvYWRTaXplOiBbeyBsdGU6IDEwMDAwMDAwMDAgfV0sIC8vIFByZW1pdW0gdXNlcnMgZ2V0IDFHQiBsaW1pdFxuICAgICAgICAgIGZpbGVUeXBlOiBbeyBpbkxpc3Q6IFsndmlkZW8nLCAnYXVkaW8nLCAnZG9jdW1lbnQnLCAnaW1hZ2UnXSB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAndXBsb2FkTGFyZ2VGaWxlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0ZpbGVVcGxvYWQnLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IHByZW1pdW1Vc2VyQWN0b3IsXG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgdXBsb2FkU2l6ZTogNTAwMDAwMDAwLCAvLyA1MDBNQlxuICAgICAgICAgIGZpbGVUeXBlOiAndmlkZW8nLFxuICAgICAgICAgIGZpbGVOYW1lOiAncHJlc2VudGF0aW9uLm1wNCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0lucHV0IFZhbGlkYXRpb24gQmFzZWQgb24gQWN0b3IgQ29udGV4dCcsICgpID0+IHtcbiAgICBcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGRpZmZlcmVudCBpbnB1dCBydWxlcyBmb3IgZGlmZmVyZW50IGFjdG9yIHR5cGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbW9kZXJhdG9yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAnbW9kLTAwMScsXG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1tb2RlcmF0aW9uLTAwMScsXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMjE6MDA6MDAuMDAwWicsXG4gICAgICAgIHJvbGU6ICdtb2RlcmF0b3InLFxuICAgICAgICBwZXJtaXNzaW9uczogWydjb250ZW50LXJldmlldycsICd1c2VyLW1hbmFnZW1lbnQnXVxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIGNvbnN0IGVudGl0eVZhbGlkYXRpb25zOiBFbnRpdHlWYWxpZGF0aW9uczxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICByb2xlOiBbeyBlcTogJ21vZGVyYXRvcicgfV1cbiAgICAgICAgfSxcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBhY3Rpb246IFt7IGluTGlzdDogWydhcHByb3ZlJywgJ3JlamVjdCcsICdmbGFnJywgJ2RlbGV0ZSddIH1dLCAvLyBNb2RlcmF0b3JzIGhhdmUgbW9yZSBvcHRpb25zXG4gICAgICAgICAgcmVhc29uOiBbeyByZXF1aXJlZDogdHJ1ZSB9XSxcbiAgICAgICAgICBub3RpZnlVc2VyOiBbeyBlcTogdHJ1ZSB9XSAvLyBNb2RlcmF0b3JzIG11c3Qgbm90aWZ5IHVzZXJzXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZUVudGl0eSh7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdtb2RlcmF0ZUNvbnRlbnQnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnQ29udGVudE1vZGVyYXRpb24nLFxuICAgICAgICBlbnRpdHlWYWxpZGF0aW9ucyxcbiAgICAgICAgYWN0b3I6IG1vZGVyYXRvckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFjdGlvbjogJ2ZsYWcnLFxuICAgICAgICAgIHJlYXNvbjogJ0luYXBwcm9wcmlhdGUgY29udGVudCBkZXRlY3RlZCcsXG4gICAgICAgICAgbm90aWZ5VXNlcjogdHJ1ZSxcbiAgICAgICAgICBjb250ZW50SWQ6ICdwb3N0LTEyMydcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucGFzcykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IGludmFsaWQgYWN0aW9ucyBmb3IgYWN0b3Igcm9sZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlZ3VsYXJVc2VyQWN0b3I6IEFjdG9yID0ge1xuICAgICAgICBhY3RvcklkOiAndXNlci0wMDEnLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdXNlci1tb2RlcmF0ZS0wMDEnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDIyOjAwOjAwLjAwMFonLFxuICAgICAgICByb2xlOiAndXNlcicgLy8gTm90IGEgbW9kZXJhdG9yXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgY29uc3QgZW50aXR5VmFsaWRhdGlvbnM6IEVudGl0eVZhbGlkYXRpb25zPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgIHJvbGU6IFt7IGVxOiAnbW9kZXJhdG9yJyB9XSAvLyBPbmx5IG1vZGVyYXRvcnMgYWxsb3dlZFxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGVFbnRpdHkoe1xuICAgICAgICBvcGVyYXRpb25OYW1lOiAnbW9kZXJhdGVDb250ZW50JyxcbiAgICAgICAgZW50aXR5TmFtZTogJ0NvbnRlbnRNb2RlcmF0aW9uJyxcbiAgICAgICAgZW50aXR5VmFsaWRhdGlvbnMsXG4gICAgICAgIGFjdG9yOiByZWd1bGFyVXNlckFjdG9yLFxuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGFjdGlvbjogJ2RlbGV0ZScsXG4gICAgICAgICAgY29udGVudElkOiAncG9zdC0xMjMnXG4gICAgICAgIH0sXG4gICAgICAgIGNvbGxlY3RFcnJvcnM6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzdWx0LnBhc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5lcnJvcnMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==