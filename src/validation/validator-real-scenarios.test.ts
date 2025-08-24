import { describe, expect, it } from '@jest/globals';
import { Validator } from './validator';
import { Actor } from '../core/types/actor';
import { EntityValidations } from './types';

describe('Validator Real-World Actor Scenarios', () => {
  const validator = new Validator();

  describe('Role-Based Authorization', () => {
    
    it('should validate admin user access to sensitive operations', async () => {
      const adminActor: Actor = {
        actorId: 'admin-user-001',
        actorType: 'user',
        requestId: 'req-admin-001',
        timestamp: '2024-01-15T10:30:00.000Z',
        authMethod: 'cognito',
        role: 'admin',
        department: 'administration',
        clearanceLevel: 'high'
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject regular user access to admin operations', async () => {
      const regularUserActor: Actor = {
        actorId: 'user-001',
        actorType: 'user',
        requestId: 'req-user-001',
        timestamp: '2024-01-15T11:00:00.000Z',
        authMethod: 'cognito',
        role: 'user', // Not admin
        department: 'marketing'
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.messageIds).toContain('validation.entity.securityoperation.actor.role.eq.admin');
    });

    it('should validate manager approval limits based on actor properties', async () => {
      const managerActor: Actor = {
        actorId: 'mgr-001',
        requestId: 'req-approval-001',
        timestamp: '2024-01-15T12:00:00.000Z',
        role: 'manager',
        department: 'finance',
        approvalLimit: 10000
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
    });

    it('should reject approval when amount exceeds actor approval limit', async () => {
      const lowLevelManagerActor: Actor = {
        actorId: 'mgr-junior-001',
        requestId: 'req-approval-002',
        timestamp: '2024-01-15T13:00:00.000Z',
        role: 'manager',
        department: 'finance',
        approvalLimit: 2000 // Low approval limit
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('Service Authentication', () => {
    
    it('should validate API key service operations', async () => {
      const apiServiceActor: Actor = {
        actorId: 'api-key:data-sync-service',
        actorType: 'service',
        requestId: 'req-service-001',
        timestamp: '2024-01-15T14:00:00.000Z',
        authMethod: 'api-key',
        apiKeyId: 'sync-key-123',
        sourceIp: '10.0.1.100'
      };

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
    });

    it('should reject user authentication for service-only operations', async () => {
      const userActor: Actor = {
        actorId: 'user-001',
        actorType: 'user', // Should be service
        requestId: 'req-user-service-001',
        timestamp: '2024-01-15T15:00:00.000Z',
        authMethod: 'cognito' // Should be api-key
      };

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(2); // Both actorType and authMethod will fail
    });

    it('should validate system actor for maintenance operations', async () => {
      const systemActor: Actor = {
        actorId: 'system',
        actorType: 'system',
        requestId: 'req-system-001',
        timestamp: '2024-01-15T02:00:00.000Z',
        authMethod: 'system',
        maintenanceWindow: true
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
    });
  });

  describe('Tenant Isolation', () => {
    
    it('should validate tenant-scoped operations', async () => {
      const tenantUserActor: Actor = {
        actorId: 'tenant-admin-001',
        actorType: 'user',
        requestId: 'req-tenant-001',
        timestamp: '2024-01-15T16:00:00.000Z',
        authMethod: 'cognito',
        tenantId: 'company-a-tenant',
        cognitoGroups: ['team-admin'],
        role: 'admin'
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
    });

    it('should prevent cross-tenant access', async () => {
      const maliciousTenantActor: Actor = {
        actorId: 'malicious-user-001',
        actorType: 'user',
        requestId: 'req-cross-tenant-001',
        timestamp: '2024-01-15T17:00:00.000Z',
        tenantId: 'company-b-tenant',
        role: 'admin'
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('Complex Actor Validation', () => {
    
    it('should validate multi-field actor requirements', async () => {
      const qualifiedDoctorActor: Actor = {
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
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
    });

    it('should reject unqualified practitioners', async () => {
      const studentActor: Actor = {
        actorId: 'student-001',
        actorType: 'user',
        requestId: 'req-student-001',
        timestamp: '2024-01-15T19:00:00.000Z',
        profession: 'medical-student', // Not a qualified doctor
        isActive: true
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(2); // profession and licenseNumber both fail
    });

    it('should validate actor with custom business logic fields', async () => {
      const premiumUserActor: Actor = {
        actorId: 'premium-user-001',
        requestId: 'req-premium-001',
        timestamp: '2024-01-15T20:00:00.000Z',
        subscriptionTier: 'premium',
        accountAge: 365, // days
        trustScore: 850,
        verificationStatus: 'verified'
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
    });
  });

  describe('Input Validation Based on Actor Context', () => {
    
    it('should validate different input rules for different actor types', async () => {
      const moderatorActor: Actor = {
        actorId: 'mod-001',
        requestId: 'req-moderation-001',
        timestamp: '2024-01-15T21:00:00.000Z',
        role: 'moderator',
        permissions: ['content-review', 'user-management']
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(true);
    });

    it('should reject invalid actions for actor role', async () => {
      const regularUserActor: Actor = {
        actorId: 'user-001',
        requestId: 'req-user-moderate-001',
        timestamp: '2024-01-15T22:00:00.000Z',
        role: 'user' // Not a moderator
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });
});
