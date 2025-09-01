import { protectAuditData, createRedactConfig, DataProtectionConfig } from './data-protection';
import { AuditEntry } from '../interfaces';

describe('Data Protection', () => {
  describe('protectAuditData', () => {
    const sampleAuditEntry: AuditEntry = {
      auditId: 'test-audit-id',
      auditType: 'api',
      logType: 'audit',
      subType: 'api_request',
      entityName: 'TestController',
      operation: 'testOperation',
      timestamp: '2024-01-15T10:30:00.000Z',
      timestampMs: 1705314600000,
      status: 'completed',
      success: true,
      correlationId: 'test-correlation-id',
      data: {
        request: {
          headers: {
            authorization: 'Bearer secret-token-123',
            cookie: 'session=abc123; user=john',
            'content-type': 'application/json'
          },
          body: {
            password: 'user-secret-password',
            email: 'user@example.com',
            publicField: 'this-should-remain'
          }
        },
        response: {
          headers: {
            'set-cookie': 'session=new-session-id; HttpOnly',
            'content-type': 'application/json'
          },
          body: {
            success: true,
            data: { id: 'user-123' }
          }
        }
      },
      context: {
        request: {
          headers: {
            authorization: 'Bearer another-secret-token',
            cookie: 'tracking=xyz789'
          },
          body: {
            secret: 'api-secret-key',
            apiKey: 'sk-1234567890abcdef',
            normalField: 'normal-value'
          }
        },
        response: {
          headers: {
            'set-cookie': 'auth=authenticated; Secure'
          }
        }
      },
      actor: {
        actorId: 'user-123',
        actorType: 'user',
        requestId: 'req-123',
        timestamp: '2024-01-15T10:30:00.000Z'
      },
      metrics: {
        duration: 150,
        statusCode: 200
      }
    };

    describe('Default Configuration', () => {
      it('should redact sensitive authentication fields', () => {
        const result = protectAuditData(sampleAuditEntry);

        // Should redact authorization headers
        expect(result.data.request.headers.authorization).toBe('[REDACTED]');
        expect(result.context.request.headers.authorization).toBe('[REDACTED]');
        
        // Should redact passwords and secrets
        expect(result.data.request.body.password).toBe('[REDACTED]');
        expect(result.context.request.body.secret).toBe('[REDACTED]');
        expect(result.context.request.body.apiKey).toBe('[REDACTED]');
      });

      it('should redact cookie headers', () => {
        const result = protectAuditData(sampleAuditEntry);

        // Should redact all cookie headers
        expect(result.data.request.headers.cookie).toBe('[REDACTED]');
        expect(result.context.request.headers.cookie).toBe('[REDACTED]');
      });

      it('should redact set-cookie headers using specific paths', () => {
        const result = protectAuditData(sampleAuditEntry);

        // Should redact set-cookie headers (hyphenated field names)
        expect(result.data.response.headers['set-cookie']).toBe('[REDACTED]');
        expect(result.context.response.headers['set-cookie']).toBe('[REDACTED]');
      });

      it('should preserve non-sensitive fields', () => {
        const result = protectAuditData(sampleAuditEntry);

        // Should preserve audit metadata
        expect(result.auditId).toBe('test-audit-id');
        expect(result.entityName).toBe('TestController');
        expect(result.correlationId).toBe('test-correlation-id');

        // Should preserve non-sensitive headers
        expect(result.data.request.headers['content-type']).toBe('application/json');
        
        // Should preserve non-sensitive body fields
        expect(result.data.request.body.publicField).toBe('this-should-remain');
        expect(result.context.request.body.normalField).toBe('normal-value');
        
        // Should preserve response data
        expect(result.data.response.body.success).toBe(true);
        expect(result.data.response.body.data.id).toBe('user-123');
        
        // Should preserve actor and metrics
        expect(result.actor?.actorId).toBe('user-123');
        expect(result.metrics?.duration).toBe(150);
      });

      it('should handle nested sensitive fields', () => {
        const entryWithNestedSecrets: AuditEntry = {
          ...sampleAuditEntry,
          data: {
            request: {
              body: {
                user: {
                  credentials: {
                    password: 'nested-password',
                    token: 'nested-token'
                  }
                }
              }
            }
          }
        };

        const result = protectAuditData(entryWithNestedSecrets);

        expect(result.data.request.body.user.credentials.password).toBe('[REDACTED]');
        expect(result.data.request.body.user.credentials.token).toBe('[REDACTED]');
      });
    });

    describe('Configuration Options', () => {
      it('should respect disabled data protection', () => {
        const config: DataProtectionConfig = { enabled: false };
        const result = protectAuditData(sampleAuditEntry, config);

        // Should return original data unchanged
        expect(result).toEqual(sampleAuditEntry);
        expect(result.data.request.headers.authorization).toBe('Bearer secret-token-123');
        expect(result.data.request.body.password).toBe('user-secret-password');
      });

      it('should use custom deep-redact configuration', () => {
        const config: DataProtectionConfig = {
          enabled: true,
          deepRedact: {
            blacklistedKeys: ['email'],
            replacement: '[CUSTOM_REDACTED]'
          }
        };

        const result = protectAuditData(sampleAuditEntry, config);

        // Should only redact email with custom censor
        expect(result.data.request.body.email).toBe('[CUSTOM_REDACTED]');
        
        // Should not redact other fields (not in custom blacklist)
        expect(result.data.request.body.password).toBe('user-secret-password');
        expect(result.data.request.headers.authorization).toBe('Bearer secret-token-123');
      });

      it('should use custom protection function when provided', () => {
        const customProtectionFn = jest.fn((auditEntry: AuditEntry) => {
          return {
            ...auditEntry,
            data: {
              ...auditEntry.data,
              custom: 'CUSTOM_PROTECTED'
            }
          };
        });

        const config: DataProtectionConfig = {
          enabled: true,
          customProtectionFn
        };

        const result = protectAuditData(sampleAuditEntry, config);

        expect(customProtectionFn).toHaveBeenCalledWith(sampleAuditEntry, config);
        expect(result.data.custom).toBe('CUSTOM_PROTECTED');
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty audit entry', () => {
        const emptyEntry: AuditEntry = {
          auditId: 'empty-test',
          auditType: 'api',
          logType: 'audit',
          subType: 'test',
          entityName: 'Test',
          operation: 'test',
          timestamp: '2024-01-15T10:30:00.000Z',
          timestampMs: 1705314600000,
          status: 'completed',
          success: true,
          correlationId: 'test'
        };

        expect(() => protectAuditData(emptyEntry)).not.toThrow();
        const result = protectAuditData(emptyEntry);
        expect(result.auditId).toBe('empty-test');
      });

      it('should handle null/undefined values in sensitive fields', () => {
        const entryWithNulls: AuditEntry = {
          ...sampleAuditEntry,
          data: {
            request: {
              headers: {
                authorization: null as any,
                cookie: undefined as any
              },
              body: {
                password: null as any,
                secret: undefined as any
              }
            }
          }
        };

        expect(() => protectAuditData(entryWithNulls)).not.toThrow();
        const result = protectAuditData(entryWithNulls);
        expect(result.data.request.headers.authorization).toBe(null); // null values aren't redacted
        expect(result.data.request.body.password).toBe(null); // null values aren't redacted
      });

      it('should handle circular references', () => {
        const circularEntry: any = {
          auditId: 'circular-test',
          auditType: 'api',
          logType: 'audit',
          subType: 'test',
          entityName: 'Test',
          operation: 'test',
          timestamp: '2024-01-15T10:30:00.000Z',
          timestampMs: 1705314600000,
          status: 'completed',
          success: true,
          correlationId: 'test',
          data: {
            password: 'secret-password'
          }
        };
        
        // Create circular reference
        circularEntry.self = circularEntry;

        expect(() => protectAuditData(circularEntry)).not.toThrow();
      });
    });

    describe('Payment and Financial Data', () => {
      it('should redact payment sensitive fields', () => {
        const paymentEntry: AuditEntry = {
          ...sampleAuditEntry,
          data: {
            request: {
              body: {
                creditCard: '4111-1111-1111-1111',
                cardNumber: '4000-0000-0000-0002',
                cvv: '123',
                ssn: '123-45-6789',
                bankAccount: '123456789',
                routingNumber: '021000021'
              }
            }
          }
        };

        const result = protectAuditData(paymentEntry);

        expect(result.data.request.body.creditCard).toBe('[REDACTED]');
        expect(result.data.request.body.cardNumber).toBe('[REDACTED]');
        expect(result.data.request.body.cvv).toBe('[REDACTED]');
        expect(result.data.request.body.ssn).toBe('[REDACTED]');
        expect(result.data.request.body.bankAccount).toBe('[REDACTED]');
        expect(result.data.request.body.routingNumber).toBe('[REDACTED]');
      });
    });

    describe('Header Path Validation', () => {
      it('should not cause runtime errors with hyphenated header names', () => {
        const headerEntry: AuditEntry = {
          ...sampleAuditEntry,
          data: {
            request: {
              headers: {
                'x-api-key': 'secret-api-key',
                'user-agent': 'Mozilla/5.0',
                'accept-language': 'en-US'
              }
            },
            response: {
              headers: {
                'set-cookie': 'session=abc123',
                'cache-control': 'no-cache',
                'x-custom-header': 'custom-value'
              }
            }
          }
        };

        // This should not throw the "Invalid path (*.set-cookie)" error
        expect(() => protectAuditData(headerEntry)).not.toThrow();
        
        const result = protectAuditData(headerEntry);
        
        // set-cookie should be redacted via specific path
        expect(result.data.response.headers['set-cookie']).toBe('[REDACTED]');
        
        // Other headers should remain
        expect(result.data.request.headers['user-agent']).toBe('Mozilla/5.0');
        expect(result.data.response.headers['cache-control']).toBe('no-cache');
      });
    });
  });

  describe('createRedactConfig', () => {
    it('should create valid redact configuration', () => {
      const config = createRedactConfig(['password', 'secret']);

      expect(config.blacklistedKeys).toEqual(['password', 'secret']);
      expect(config.replacement).toBe('[REDACTED]');
      expect(config.caseSensitiveKeyMatch).toBe(false);
      expect(config.remove).toBe(false);
    });

    it('should allow custom options', () => {
      const config = createRedactConfig(['email'], {
        replacement: '[HIDDEN]',
        caseSensitiveKeyMatch: true,
        remove: true
      });

      expect(config.blacklistedKeys).toEqual(['email']);
      expect(config.replacement).toBe('[HIDDEN]');
      expect(config.caseSensitiveKeyMatch).toBe(true);
      expect(config.remove).toBe(true);
    });
  });

  describe('createRedactConfig', () => {
    it('should create valid redact configuration', () => {
      const config = createRedactConfig(['password', 'secret']);

      expect(config.blacklistedKeys).toEqual(['password', 'secret']);
      expect(config.replacement).toBe('[REDACTED]');
      expect(config.caseSensitiveKeyMatch).toBe(false);
      expect(config.remove).toBe(false);
    });

    it('should allow custom options', () => {
      const config = createRedactConfig(['email'], {
        replacement: '[HIDDEN]',
        caseSensitiveKeyMatch: true,
        remove: true
      });

      expect(config.blacklistedKeys).toEqual(['email']);
      expect(config.replacement).toBe('[HIDDEN]');
      expect(config.caseSensitiveKeyMatch).toBe(true);
      expect(config.remove).toBe(true);
    });
  });
});
