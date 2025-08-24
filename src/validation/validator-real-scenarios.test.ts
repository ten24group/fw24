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
        apiKey: {
          id: 'sync-key-123',
          source: 'request-context'
        },
        sourceIp: '10.0.1.100'
      };

      const entityValidations: EntityValidations<any, any, any> = {
        actor: {
          actorType: [{ eq: 'service' }],
          authMethod: [ { eq: 'api-key' } ],
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
        actorId: 'anonymous',
        actorType: 'anonymous',
        requestId: 'req-system-001',
        timestamp: '2024-01-15T02:00:00.000Z',
        authMethod: 'anonymous',
        maintenanceWindow: true
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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
        cognito: {
          groups: ['team-admin']
        },
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
      };

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

    it('should reject actors missing required business context fields', async () => {
      // This tests complex business validation that controllers can add via extractActorContext override
      // Example: Medical system controller adds license validation, financial system adds credit checks, etc.
      const studentActor: Actor = {
        actorId: 'student-001',
        actorType: 'user',
        requestId: 'req-student-001',
        timestamp: '2024-01-15T19:00:00.000Z',
        profession: 'medical-student', // Missing required profession
        isActive: true
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(2); // profession and licenseNumber validation both fail
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

  describe('Enhanced Actor Context Validation', () => {
    
    it('should validate complex role-based access control', async () => {
      // Enhanced actor from controller override
      const managerActor: Actor = {
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
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
                  actor: {
            // Role validation - using custom function for array contains
            roles: [{ custom: (roles: string[]) => Array.isArray(roles) && roles.includes('approver') }],
            primaryRole: [{ inList: ['manager', 'director', 'vp'] }],
            
            // Permission validation - using custom function for array contains
            permissions: [{ custom: (permissions: string[]) => Array.isArray(permissions) && permissions.includes('budget.approve') }],
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

      expect(result.pass).toBe(true);
    });

    it('should reject insufficient role permissions', async () => {
      const juniorActor: Actor = {
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
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
        actor: {
          roles: [{ custom: (roles: string[]) => Array.isArray(roles) && roles.includes('approver') }], // Missing approver role
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(2); // roles and securityClearance validations should fail
    });

    it('should validate subscription-based feature access', async () => {
      // Enhanced actor with subscription context
      const enterpriseActor: Actor = {
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
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
        actor: {
          // Subscription validation - use custom validators for nested properties
          subscription: [{ custom: (sub: any) => sub?.tier === 'enterprise' || sub?.tier === 'premium' }],
          
          // License validation - use custom for array contains
          activeLicenses: [{ custom: (licenses: string[]) => Array.isArray(licenses) && licenses.includes('analytics-pro') }],
          
          // Feature flag validation - use custom for nested property
          featureFlags: [{ custom: (flags: any) => flags?.['advanced-reporting'] === true }]
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

      expect(result.pass).toBe(true);
    });

    it('should validate middleware-enhanced security context', async () => {
      // Enhanced actor with security context from middleware
      const secureActor: Actor = {
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
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
        actor: {
          // Risk assessment validation - use custom for nested properties
          riskProfile: [{ custom: (risk: any) => risk?.level === 'low' || risk?.level === 'minimal' }],
          
          // Device security validation
          device: [{ custom: (device: any) => device?.trusted === true }],
          
          // Security validation  
          security: [{ custom: (sec: any) => sec?.mfaVerified === true && sec?.vpnDetected === false }],
          
          // Session validation
          session: [{ custom: (sess: any) => sess?.deviceTrusted === true && sess?.mfaVerified === true }]
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

      expect(result.pass).toBe(true);
    });

    it('should reject high-risk security scenarios', async () => {
      const riskyActor: Actor = {
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
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
        actor: {
          riskProfile: [{ custom: (risk: any) => (risk?.level === 'low' || risk?.level === 'minimal') && risk?.score <= 50 }],
          device: [{ custom: (device: any) => device?.trusted === true }],
          security: [{ custom: (sec: any) => sec?.mfaVerified === true && sec?.vpnDetected === false }]
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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(3); // riskProfile, device, and security validations should fail
    });

    it('should validate compliance and audit requirements', async () => {
      const complianceActor: Actor = {
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
      } as any;

      const entityValidations: EntityValidations<any, any, any> = {
        actor: {
          // Compliance validation - use custom for nested properties
          compliance: [{ custom: (comp: any) => 
            comp?.status === 'compliant' && 
            Array.isArray(comp?.certifications) && comp.certifications.includes('SOC2-Type2') &&
            Array.isArray(comp?.violations) && comp.violations.length === 0 &&
            comp?.soxCompliant?.certified === true
          }],
          
          // Audit validation - use custom for nested properties
          audit: [{ custom: (audit: any) => 
            audit?.trailEnabled === true && 
            audit?.retentionPeriod >= 2555 &&
            audit?.realTimeMonitoring === true
          }],
          
          // Role validation
          roles: [{ custom: (roles: string[]) => Array.isArray(roles) && roles.includes('compliance-officer') }],
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

      expect(result.pass).toBe(true);
    });
  });
});
