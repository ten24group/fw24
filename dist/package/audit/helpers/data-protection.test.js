"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const data_protection_1 = require("./data-protection");
describe('Data Protection', () => {
    describe('protectAuditData', () => {
        const sampleAuditEntry = {
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
                const result = (0, data_protection_1.protectAuditData)(sampleAuditEntry);
                // Should redact authorization headers
                expect(result.data.request.headers.authorization).toBe('[REDACTED]');
                expect(result.context.request.headers.authorization).toBe('[REDACTED]');
                // Should redact passwords and secrets
                expect(result.data.request.body.password).toBe('[REDACTED]');
                expect(result.context.request.body.secret).toBe('[REDACTED]');
                expect(result.context.request.body.apiKey).toBe('[REDACTED]');
            });
            it('should redact cookie headers', () => {
                const result = (0, data_protection_1.protectAuditData)(sampleAuditEntry);
                // Should redact all cookie headers
                expect(result.data.request.headers.cookie).toBe('[REDACTED]');
                expect(result.context.request.headers.cookie).toBe('[REDACTED]');
            });
            it('should redact set-cookie headers using specific paths', () => {
                const result = (0, data_protection_1.protectAuditData)(sampleAuditEntry);
                // Should redact set-cookie headers (hyphenated field names)
                expect(result.data.response.headers['set-cookie']).toBe('[REDACTED]');
                expect(result.context.response.headers['set-cookie']).toBe('[REDACTED]');
            });
            it('should preserve non-sensitive fields', () => {
                const result = (0, data_protection_1.protectAuditData)(sampleAuditEntry);
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
                const entryWithNestedSecrets = {
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
                const result = (0, data_protection_1.protectAuditData)(entryWithNestedSecrets);
                expect(result.data.request.body.user.credentials.password).toBe('[REDACTED]');
                expect(result.data.request.body.user.credentials.token).toBe('[REDACTED]');
            });
        });
        describe('Configuration Options', () => {
            it('should respect disabled data protection', () => {
                const config = { enabled: false };
                const result = (0, data_protection_1.protectAuditData)(sampleAuditEntry, config);
                // Should return original data unchanged
                expect(result).toEqual(sampleAuditEntry);
                expect(result.data.request.headers.authorization).toBe('Bearer secret-token-123');
                expect(result.data.request.body.password).toBe('user-secret-password');
            });
            it('should use custom deep-redact configuration', () => {
                const config = {
                    enabled: true,
                    deepRedact: {
                        blacklistedKeys: ['email'],
                        replacement: '[CUSTOM_REDACTED]'
                    }
                };
                const result = (0, data_protection_1.protectAuditData)(sampleAuditEntry, config);
                // Should only redact email with custom censor
                expect(result.data.request.body.email).toBe('[CUSTOM_REDACTED]');
                // Should not redact other fields (not in custom blacklist)
                expect(result.data.request.body.password).toBe('user-secret-password');
                expect(result.data.request.headers.authorization).toBe('Bearer secret-token-123');
            });
            it('should use custom protection function when provided', () => {
                const customProtectionFn = jest.fn((auditEntry) => {
                    return {
                        ...auditEntry,
                        data: {
                            ...auditEntry.data,
                            custom: 'CUSTOM_PROTECTED'
                        }
                    };
                });
                const config = {
                    enabled: true,
                    customProtectionFn
                };
                const result = (0, data_protection_1.protectAuditData)(sampleAuditEntry, config);
                expect(customProtectionFn).toHaveBeenCalledWith(sampleAuditEntry, config);
                expect(result.data.custom).toBe('CUSTOM_PROTECTED');
            });
        });
        describe('Edge Cases', () => {
            it('should handle empty audit entry', () => {
                const emptyEntry = {
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
                expect(() => (0, data_protection_1.protectAuditData)(emptyEntry)).not.toThrow();
                const result = (0, data_protection_1.protectAuditData)(emptyEntry);
                expect(result.auditId).toBe('empty-test');
            });
            it('should handle null/undefined values in sensitive fields', () => {
                const entryWithNulls = {
                    ...sampleAuditEntry,
                    data: {
                        request: {
                            headers: {
                                authorization: null,
                                cookie: undefined
                            },
                            body: {
                                password: null,
                                secret: undefined
                            }
                        }
                    }
                };
                expect(() => (0, data_protection_1.protectAuditData)(entryWithNulls)).not.toThrow();
                const result = (0, data_protection_1.protectAuditData)(entryWithNulls);
                expect(result.data.request.headers.authorization).toBe(null); // null values aren't redacted
                expect(result.data.request.body.password).toBe(null); // null values aren't redacted
            });
            it('should handle circular references', () => {
                const circularEntry = {
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
                expect(() => (0, data_protection_1.protectAuditData)(circularEntry)).not.toThrow();
            });
        });
        describe('Payment and Financial Data', () => {
            it('should redact payment sensitive fields', () => {
                const paymentEntry = {
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
                const result = (0, data_protection_1.protectAuditData)(paymentEntry);
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
                const headerEntry = {
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
                expect(() => (0, data_protection_1.protectAuditData)(headerEntry)).not.toThrow();
                const result = (0, data_protection_1.protectAuditData)(headerEntry);
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
            const config = (0, data_protection_1.createRedactConfig)(['password', 'secret']);
            expect(config.blacklistedKeys).toEqual(['password', 'secret']);
            expect(config.replacement).toBe('[REDACTED]');
            expect(config.caseSensitiveKeyMatch).toBe(false);
            expect(config.remove).toBe(false);
        });
        it('should allow custom options', () => {
            const config = (0, data_protection_1.createRedactConfig)(['email'], {
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
            const config = (0, data_protection_1.createRedactConfig)(['password', 'secret']);
            expect(config.blacklistedKeys).toEqual(['password', 'secret']);
            expect(config.replacement).toBe('[REDACTED]');
            expect(config.caseSensitiveKeyMatch).toBe(false);
            expect(config.remove).toBe(false);
        });
        it('should allow custom options', () => {
            const config = (0, data_protection_1.createRedactConfig)(['email'], {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1wcm90ZWN0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvaGVscGVycy9kYXRhLXByb3RlY3Rpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVEQUErRjtBQUcvRixRQUFRLENBQUMsaUJBQWlCLEVBQUUsR0FBRyxFQUFFO0lBQy9CLFFBQVEsQ0FBQyxrQkFBa0IsRUFBRSxHQUFHLEVBQUU7UUFDaEMsTUFBTSxnQkFBZ0IsR0FBZTtZQUNuQyxPQUFPLEVBQUUsZUFBZTtZQUN4QixTQUFTLEVBQUUsS0FBSztZQUNoQixPQUFPLEVBQUUsT0FBTztZQUNoQixPQUFPLEVBQUUsYUFBYTtZQUN0QixVQUFVLEVBQUUsZ0JBQWdCO1lBQzVCLFNBQVMsRUFBRSxlQUFlO1lBQzFCLFNBQVMsRUFBRSwwQkFBMEI7WUFDckMsV0FBVyxFQUFFLGFBQWE7WUFDMUIsTUFBTSxFQUFFLFdBQVc7WUFDbkIsT0FBTyxFQUFFLElBQUk7WUFDYixhQUFhLEVBQUUscUJBQXFCO1lBQ3BDLElBQUksRUFBRTtnQkFDSixPQUFPLEVBQUU7b0JBQ1AsT0FBTyxFQUFFO3dCQUNQLGFBQWEsRUFBRSx5QkFBeUI7d0JBQ3hDLE1BQU0sRUFBRSwyQkFBMkI7d0JBQ25DLGNBQWMsRUFBRSxrQkFBa0I7cUJBQ25DO29CQUNELElBQUksRUFBRTt3QkFDSixRQUFRLEVBQUUsc0JBQXNCO3dCQUNoQyxLQUFLLEVBQUUsa0JBQWtCO3dCQUN6QixXQUFXLEVBQUUsb0JBQW9CO3FCQUNsQztpQkFDRjtnQkFDRCxRQUFRLEVBQUU7b0JBQ1IsT0FBTyxFQUFFO3dCQUNQLFlBQVksRUFBRSxrQ0FBa0M7d0JBQ2hELGNBQWMsRUFBRSxrQkFBa0I7cUJBQ25DO29CQUNELElBQUksRUFBRTt3QkFDSixPQUFPLEVBQUUsSUFBSTt3QkFDYixJQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUUsVUFBVSxFQUFFO3FCQUN6Qjtp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QU8sQ0FBQyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDO1lBQy9ELE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQzlDLE1BQU0sQ0FBQyxNQUFNLENBQUMscUJBQXFCLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDcEMsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsNkJBQTZCLEVBQUUsR0FBRyxFQUFFO1lBQ3JDLE1BQU0sTUFBTSxHQUFHLElBQUEsb0NBQWtCLEVBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRTtnQkFDM0MsV0FBVyxFQUFFLFVBQVU7Z0JBQ3ZCLHFCQUFxQixFQUFFLElBQUk7Z0JBQzNCLE1BQU0sRUFBRSxJQUFJO2FBQ2IsQ0FBQyxDQUFDO1lBRUgsTUFBTSxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQ2xELE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQzVDLE1BQU0sQ0FBQyxNQUFNLENBQUMscUJBQXFCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDaEQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbkMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcHJvdGVjdEF1ZGl0RGF0YSwgY3JlYXRlUmVkYWN0Q29uZmlnLCBEYXRhUHJvdGVjdGlvbkNvbmZpZyB9IGZyb20gJy4vZGF0YS1wcm90ZWN0aW9uJztcbmltcG9ydCB7IEF1ZGl0RW50cnkgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcblxuZGVzY3JpYmUoJ0RhdGEgUHJvdGVjdGlvbicsICgpID0+IHtcbiAgZGVzY3JpYmUoJ3Byb3RlY3RBdWRpdERhdGEnLCAoKSA9PiB7XG4gICAgY29uc3Qgc2FtcGxlQXVkaXRFbnRyeTogQXVkaXRFbnRyeSA9IHtcbiAgICAgIGF1ZGl0SWQ6ICd0ZXN0LWF1ZGl0LWlkJyxcbiAgICAgIGF1ZGl0VHlwZTogJ2FwaScsXG4gICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICAgIGVudGl0eU5hbWU6ICdUZXN0Q29udHJvbGxlcicsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0T3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICB0aW1lc3RhbXBNczogMTcwNTMxNDYwMDAwMCxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24taWQnLFxuICAgICAgZGF0YToge1xuICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgYXV0aG9yaXphdGlvbjogJ0JlYXJlciBzZWNyZXQtdG9rZW4tMTIzJyxcbiAgICAgICAgICAgIGNvb2tpZTogJ3Nlc3Npb249YWJjMTIzOyB1c2VyPWpvaG4nLFxuICAgICAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgcGFzc3dvcmQ6ICd1c2VyLXNlY3JldC1wYXNzd29yZCcsXG4gICAgICAgICAgICBlbWFpbDogJ3VzZXJAZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgcHVibGljRmllbGQ6ICd0aGlzLXNob3VsZC1yZW1haW4nXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICdzZXQtY29va2llJzogJ3Nlc3Npb249bmV3LXNlc3Npb24taWQ7IEh0dHBPbmx5JyxcbiAgICAgICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBkYXRhOiB7IGlkOiAndXNlci0xMjMnIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICBhdXRob3JpemF0aW9uOiAnQmVhcmVyIGFub3RoZXItc2VjcmV0LXRva2VuJyxcbiAgICAgICAgICAgIGNvb2tpZTogJ3RyYWNraW5nPXh5ejc4OSdcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgIHNlY3JldDogJ2FwaS1zZWNyZXQta2V5JyxcbiAgICAgICAgICAgIGFwaUtleTogJ3NrLTEyMzQ1Njc4OTBhYmNkZWYnLFxuICAgICAgICAgICAgbm9ybWFsRmllbGQ6ICdub3JtYWwtdmFsdWUnXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICdzZXQtY29va2llJzogJ2F1dGg9YXV0aGVudGljYXRlZDsgU2VjdXJlJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGFjdG9yOiB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLTEyMycsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJ1xuICAgICAgfSxcbiAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgZHVyYXRpb246IDE1MCxcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwXG4gICAgICB9XG4gICAgfTtcblxuICAgIGRlc2NyaWJlKCdEZWZhdWx0IENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIHJlZGFjdCBzZW5zaXRpdmUgYXV0aGVudGljYXRpb24gZmllbGRzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBwcm90ZWN0QXVkaXREYXRhKHNhbXBsZUF1ZGl0RW50cnkpO1xuXG4gICAgICAgIC8vIFNob3VsZCByZWRhY3QgYXV0aG9yaXphdGlvbiBoZWFkZXJzXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmhlYWRlcnMuYXV0aG9yaXphdGlvbikudG9CZSgnW1JFREFDVEVEXScpO1xuICAgICAgICBleHBlY3QocmVzdWx0LmNvbnRleHQucmVxdWVzdC5oZWFkZXJzLmF1dGhvcml6YXRpb24pLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNob3VsZCByZWRhY3QgcGFzc3dvcmRzIGFuZCBzZWNyZXRzXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmJvZHkucGFzc3dvcmQpLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5jb250ZXh0LnJlcXVlc3QuYm9keS5zZWNyZXQpLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5jb250ZXh0LnJlcXVlc3QuYm9keS5hcGlLZXkpLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHJlZGFjdCBjb29raWUgaGVhZGVycycsICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcHJvdGVjdEF1ZGl0RGF0YShzYW1wbGVBdWRpdEVudHJ5KTtcblxuICAgICAgICAvLyBTaG91bGQgcmVkYWN0IGFsbCBjb29raWUgaGVhZGVyc1xuICAgICAgICBleHBlY3QocmVzdWx0LmRhdGEucmVxdWVzdC5oZWFkZXJzLmNvb2tpZSkudG9CZSgnW1JFREFDVEVEXScpO1xuICAgICAgICBleHBlY3QocmVzdWx0LmNvbnRleHQucmVxdWVzdC5oZWFkZXJzLmNvb2tpZSkudG9CZSgnW1JFREFDVEVEXScpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgcmVkYWN0IHNldC1jb29raWUgaGVhZGVycyB1c2luZyBzcGVjaWZpYyBwYXRocycsICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcHJvdGVjdEF1ZGl0RGF0YShzYW1wbGVBdWRpdEVudHJ5KTtcblxuICAgICAgICAvLyBTaG91bGQgcmVkYWN0IHNldC1jb29raWUgaGVhZGVycyAoaHlwaGVuYXRlZCBmaWVsZCBuYW1lcylcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlc3BvbnNlLmhlYWRlcnNbJ3NldC1jb29raWUnXSkudG9CZSgnW1JFREFDVEVEXScpO1xuICAgICAgICBleHBlY3QocmVzdWx0LmNvbnRleHQucmVzcG9uc2UuaGVhZGVyc1snc2V0LWNvb2tpZSddKS50b0JlKCdbUkVEQUNURURdJyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBwcmVzZXJ2ZSBub24tc2Vuc2l0aXZlIGZpZWxkcycsICgpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcHJvdGVjdEF1ZGl0RGF0YShzYW1wbGVBdWRpdEVudHJ5KTtcblxuICAgICAgICAvLyBTaG91bGQgcHJlc2VydmUgYXVkaXQgbWV0YWRhdGFcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5hdWRpdElkKS50b0JlKCd0ZXN0LWF1ZGl0LWlkJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZW50aXR5TmFtZSkudG9CZSgnVGVzdENvbnRyb2xsZXInKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5jb3JyZWxhdGlvbklkKS50b0JlKCd0ZXN0LWNvcnJlbGF0aW9uLWlkJyk7XG5cbiAgICAgICAgLy8gU2hvdWxkIHByZXNlcnZlIG5vbi1zZW5zaXRpdmUgaGVhZGVyc1xuICAgICAgICBleHBlY3QocmVzdWx0LmRhdGEucmVxdWVzdC5oZWFkZXJzWydjb250ZW50LXR5cGUnXSkudG9CZSgnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICBcbiAgICAgICAgLy8gU2hvdWxkIHByZXNlcnZlIG5vbi1zZW5zaXRpdmUgYm9keSBmaWVsZHNcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlcXVlc3QuYm9keS5wdWJsaWNGaWVsZCkudG9CZSgndGhpcy1zaG91bGQtcmVtYWluJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuY29udGV4dC5yZXF1ZXN0LmJvZHkubm9ybWFsRmllbGQpLnRvQmUoJ25vcm1hbC12YWx1ZScpO1xuICAgICAgICBcbiAgICAgICAgLy8gU2hvdWxkIHByZXNlcnZlIHJlc3BvbnNlIGRhdGFcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlc3BvbnNlLmJvZHkuc3VjY2VzcykudG9CZSh0cnVlKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlc3BvbnNlLmJvZHkuZGF0YS5pZCkudG9CZSgndXNlci0xMjMnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNob3VsZCBwcmVzZXJ2ZSBhY3RvciBhbmQgbWV0cmljc1xuICAgICAgICBleHBlY3QocmVzdWx0LmFjdG9yPy5hY3RvcklkKS50b0JlKCd1c2VyLTEyMycpO1xuICAgICAgICBleHBlY3QocmVzdWx0Lm1ldHJpY3M/LmR1cmF0aW9uKS50b0JlKDE1MCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgbmVzdGVkIHNlbnNpdGl2ZSBmaWVsZHMnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGVudHJ5V2l0aE5lc3RlZFNlY3JldHM6IEF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgLi4uc2FtcGxlQXVkaXRFbnRyeSxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgICAgICB1c2VyOiB7XG4gICAgICAgICAgICAgICAgICBjcmVkZW50aWFsczoge1xuICAgICAgICAgICAgICAgICAgICBwYXNzd29yZDogJ25lc3RlZC1wYXNzd29yZCcsXG4gICAgICAgICAgICAgICAgICAgIHRva2VuOiAnbmVzdGVkLXRva2VuJ1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBwcm90ZWN0QXVkaXREYXRhKGVudHJ5V2l0aE5lc3RlZFNlY3JldHMpO1xuXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmJvZHkudXNlci5jcmVkZW50aWFscy5wYXNzd29yZCkudG9CZSgnW1JFREFDVEVEXScpO1xuICAgICAgICBleHBlY3QocmVzdWx0LmRhdGEucmVxdWVzdC5ib2R5LnVzZXIuY3JlZGVudGlhbHMudG9rZW4pLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NvbmZpZ3VyYXRpb24gT3B0aW9ucycsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgcmVzcGVjdCBkaXNhYmxlZCBkYXRhIHByb3RlY3Rpb24nLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbmZpZzogRGF0YVByb3RlY3Rpb25Db25maWcgPSB7IGVuYWJsZWQ6IGZhbHNlIH07XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHByb3RlY3RBdWRpdERhdGEoc2FtcGxlQXVkaXRFbnRyeSwgY29uZmlnKTtcblxuICAgICAgICAvLyBTaG91bGQgcmV0dXJuIG9yaWdpbmFsIGRhdGEgdW5jaGFuZ2VkXG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoc2FtcGxlQXVkaXRFbnRyeSk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmhlYWRlcnMuYXV0aG9yaXphdGlvbikudG9CZSgnQmVhcmVyIHNlY3JldC10b2tlbi0xMjMnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlcXVlc3QuYm9keS5wYXNzd29yZCkudG9CZSgndXNlci1zZWNyZXQtcGFzc3dvcmQnKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHVzZSBjdXN0b20gZGVlcC1yZWRhY3QgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgICAgY29uc3QgY29uZmlnOiBEYXRhUHJvdGVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGRlZXBSZWRhY3Q6IHtcbiAgICAgICAgICAgIGJsYWNrbGlzdGVkS2V5czogWydlbWFpbCddLFxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6ICdbQ1VTVE9NX1JFREFDVEVEXSdcbiAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcHJvdGVjdEF1ZGl0RGF0YShzYW1wbGVBdWRpdEVudHJ5LCBjb25maWcpO1xuXG4gICAgICAgIC8vIFNob3VsZCBvbmx5IHJlZGFjdCBlbWFpbCB3aXRoIGN1c3RvbSBjZW5zb3JcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlcXVlc3QuYm9keS5lbWFpbCkudG9CZSgnW0NVU1RPTV9SRURBQ1RFRF0nKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNob3VsZCBub3QgcmVkYWN0IG90aGVyIGZpZWxkcyAobm90IGluIGN1c3RvbSBibGFja2xpc3QpXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmJvZHkucGFzc3dvcmQpLnRvQmUoJ3VzZXItc2VjcmV0LXBhc3N3b3JkJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmhlYWRlcnMuYXV0aG9yaXphdGlvbikudG9CZSgnQmVhcmVyIHNlY3JldC10b2tlbi0xMjMnKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHVzZSBjdXN0b20gcHJvdGVjdGlvbiBmdW5jdGlvbiB3aGVuIHByb3ZpZGVkJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBjdXN0b21Qcm90ZWN0aW9uRm4gPSBqZXN0LmZuKChhdWRpdEVudHJ5OiBBdWRpdEVudHJ5KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLmF1ZGl0RW50cnksXG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIC4uLmF1ZGl0RW50cnkuZGF0YSxcbiAgICAgICAgICAgICAgY3VzdG9tOiAnQ1VTVE9NX1BST1RFQ1RFRCdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBjb25maWc6IERhdGFQcm90ZWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgY3VzdG9tUHJvdGVjdGlvbkZuXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcHJvdGVjdEF1ZGl0RGF0YShzYW1wbGVBdWRpdEVudHJ5LCBjb25maWcpO1xuXG4gICAgICAgIGV4cGVjdChjdXN0b21Qcm90ZWN0aW9uRm4pLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHNhbXBsZUF1ZGl0RW50cnksIGNvbmZpZyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5jdXN0b20pLnRvQmUoJ0NVU1RPTV9QUk9URUNURUQnKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0VkZ2UgQ2FzZXMnLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBhdWRpdCBlbnRyeScsICgpID0+IHtcbiAgICAgICAgY29uc3QgZW1wdHlFbnRyeTogQXVkaXRFbnRyeSA9IHtcbiAgICAgICAgICBhdWRpdElkOiAnZW1wdHktdGVzdCcsXG4gICAgICAgICAgYXVkaXRUeXBlOiAnYXBpJyxcbiAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgIHN1YlR5cGU6ICd0ZXN0JyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTcwNTMxNDYwMDAwMCxcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnXG4gICAgICAgIH07XG5cbiAgICAgICAgZXhwZWN0KCgpID0+IHByb3RlY3RBdWRpdERhdGEoZW1wdHlFbnRyeSkpLm5vdC50b1Rocm93KCk7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHByb3RlY3RBdWRpdERhdGEoZW1wdHlFbnRyeSk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuYXVkaXRJZCkudG9CZSgnZW1wdHktdGVzdCcpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG51bGwvdW5kZWZpbmVkIHZhbHVlcyBpbiBzZW5zaXRpdmUgZmllbGRzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBlbnRyeVdpdGhOdWxsczogQXVkaXRFbnRyeSA9IHtcbiAgICAgICAgICAuLi5zYW1wbGVBdWRpdEVudHJ5LFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgIGF1dGhvcml6YXRpb246IG51bGwgYXMgYW55LFxuICAgICAgICAgICAgICAgIGNvb2tpZTogdW5kZWZpbmVkIGFzIGFueVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICAgICAgcGFzc3dvcmQ6IG51bGwgYXMgYW55LFxuICAgICAgICAgICAgICAgIHNlY3JldDogdW5kZWZpbmVkIGFzIGFueVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGV4cGVjdCgoKSA9PiBwcm90ZWN0QXVkaXREYXRhKGVudHJ5V2l0aE51bGxzKSkubm90LnRvVGhyb3coKTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcHJvdGVjdEF1ZGl0RGF0YShlbnRyeVdpdGhOdWxscyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmhlYWRlcnMuYXV0aG9yaXphdGlvbikudG9CZShudWxsKTsgLy8gbnVsbCB2YWx1ZXMgYXJlbid0IHJlZGFjdGVkXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmJvZHkucGFzc3dvcmQpLnRvQmUobnVsbCk7IC8vIG51bGwgdmFsdWVzIGFyZW4ndCByZWRhY3RlZFxuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGNpcmN1bGFyIHJlZmVyZW5jZXMnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGNpcmN1bGFyRW50cnk6IGFueSA9IHtcbiAgICAgICAgICBhdWRpdElkOiAnY2lyY3VsYXItdGVzdCcsXG4gICAgICAgICAgYXVkaXRUeXBlOiAnYXBpJyxcbiAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgIHN1YlR5cGU6ICd0ZXN0JyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTcwNTMxNDYwMDAwMCxcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIHBhc3N3b3JkOiAnc2VjcmV0LXBhc3N3b3JkJ1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIC8vIENyZWF0ZSBjaXJjdWxhciByZWZlcmVuY2VcbiAgICAgICAgY2lyY3VsYXJFbnRyeS5zZWxmID0gY2lyY3VsYXJFbnRyeTtcblxuICAgICAgICBleHBlY3QoKCkgPT4gcHJvdGVjdEF1ZGl0RGF0YShjaXJjdWxhckVudHJ5KSkubm90LnRvVGhyb3coKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1BheW1lbnQgYW5kIEZpbmFuY2lhbCBEYXRhJywgKCkgPT4ge1xuICAgICAgaXQoJ3Nob3VsZCByZWRhY3QgcGF5bWVudCBzZW5zaXRpdmUgZmllbGRzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBwYXltZW50RW50cnk6IEF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgLi4uc2FtcGxlQXVkaXRFbnRyeSxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgICAgICBjcmVkaXRDYXJkOiAnNDExMS0xMTExLTExMTEtMTExMScsXG4gICAgICAgICAgICAgICAgY2FyZE51bWJlcjogJzQwMDAtMDAwMC0wMDAwLTAwMDInLFxuICAgICAgICAgICAgICAgIGN2djogJzEyMycsXG4gICAgICAgICAgICAgICAgc3NuOiAnMTIzLTQ1LTY3ODknLFxuICAgICAgICAgICAgICAgIGJhbmtBY2NvdW50OiAnMTIzNDU2Nzg5JyxcbiAgICAgICAgICAgICAgICByb3V0aW5nTnVtYmVyOiAnMDIxMDAwMDIxJ1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHByb3RlY3RBdWRpdERhdGEocGF5bWVudEVudHJ5KTtcblxuICAgICAgICBleHBlY3QocmVzdWx0LmRhdGEucmVxdWVzdC5ib2R5LmNyZWRpdENhcmQpLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlcXVlc3QuYm9keS5jYXJkTnVtYmVyKS50b0JlKCdbUkVEQUNURURdJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmJvZHkuY3Z2KS50b0JlKCdbUkVEQUNURURdJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmJvZHkuc3NuKS50b0JlKCdbUkVEQUNURURdJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXF1ZXN0LmJvZHkuYmFua0FjY291bnQpLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kYXRhLnJlcXVlc3QuYm9keS5yb3V0aW5nTnVtYmVyKS50b0JlKCdbUkVEQUNURURdJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdIZWFkZXIgUGF0aCBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgICAgaXQoJ3Nob3VsZCBub3QgY2F1c2UgcnVudGltZSBlcnJvcnMgd2l0aCBoeXBoZW5hdGVkIGhlYWRlciBuYW1lcycsICgpID0+IHtcbiAgICAgICAgY29uc3QgaGVhZGVyRW50cnk6IEF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgLi4uc2FtcGxlQXVkaXRFbnRyeSxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAneC1hcGkta2V5JzogJ3NlY3JldC1hcGkta2V5JyxcbiAgICAgICAgICAgICAgICAndXNlci1hZ2VudCc6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgICAgICAgJ2FjY2VwdC1sYW5ndWFnZSc6ICdlbi1VUydcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnc2V0LWNvb2tpZSc6ICdzZXNzaW9uPWFiYzEyMycsXG4gICAgICAgICAgICAgICAgJ2NhY2hlLWNvbnRyb2wnOiAnbm8tY2FjaGUnLFxuICAgICAgICAgICAgICAgICd4LWN1c3RvbS1oZWFkZXInOiAnY3VzdG9tLXZhbHVlJ1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFRoaXMgc2hvdWxkIG5vdCB0aHJvdyB0aGUgXCJJbnZhbGlkIHBhdGggKCouc2V0LWNvb2tpZSlcIiBlcnJvclxuICAgICAgICBleHBlY3QoKCkgPT4gcHJvdGVjdEF1ZGl0RGF0YShoZWFkZXJFbnRyeSkpLm5vdC50b1Rocm93KCk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCByZXN1bHQgPSBwcm90ZWN0QXVkaXREYXRhKGhlYWRlckVudHJ5KTtcbiAgICAgICAgXG4gICAgICAgIC8vIHNldC1jb29raWUgc2hvdWxkIGJlIHJlZGFjdGVkIHZpYSBzcGVjaWZpYyBwYXRoXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXNwb25zZS5oZWFkZXJzWydzZXQtY29va2llJ10pLnRvQmUoJ1tSRURBQ1RFRF0nKTtcbiAgICAgICAgXG4gICAgICAgIC8vIE90aGVyIGhlYWRlcnMgc2hvdWxkIHJlbWFpblxuICAgICAgICBleHBlY3QocmVzdWx0LmRhdGEucmVxdWVzdC5oZWFkZXJzWyd1c2VyLWFnZW50J10pLnRvQmUoJ01vemlsbGEvNS4wJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGF0YS5yZXNwb25zZS5oZWFkZXJzWydjYWNoZS1jb250cm9sJ10pLnRvQmUoJ25vLWNhY2hlJyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2NyZWF0ZVJlZGFjdENvbmZpZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB2YWxpZCByZWRhY3QgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZVJlZGFjdENvbmZpZyhbJ3Bhc3N3b3JkJywgJ3NlY3JldCddKTtcblxuICAgICAgZXhwZWN0KGNvbmZpZy5ibGFja2xpc3RlZEtleXMpLnRvRXF1YWwoWydwYXNzd29yZCcsICdzZWNyZXQnXSk7XG4gICAgICBleHBlY3QoY29uZmlnLnJlcGxhY2VtZW50KS50b0JlKCdbUkVEQUNURURdJyk7XG4gICAgICBleHBlY3QoY29uZmlnLmNhc2VTZW5zaXRpdmVLZXlNYXRjaCkudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QoY29uZmlnLnJlbW92ZSkudG9CZShmYWxzZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFsbG93IGN1c3RvbSBvcHRpb25zJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnID0gY3JlYXRlUmVkYWN0Q29uZmlnKFsnZW1haWwnXSwge1xuICAgICAgICByZXBsYWNlbWVudDogJ1tISURERU5dJyxcbiAgICAgICAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoOiB0cnVlLFxuICAgICAgICByZW1vdmU6IHRydWVcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoY29uZmlnLmJsYWNrbGlzdGVkS2V5cykudG9FcXVhbChbJ2VtYWlsJ10pO1xuICAgICAgZXhwZWN0KGNvbmZpZy5yZXBsYWNlbWVudCkudG9CZSgnW0hJRERFTl0nKTtcbiAgICAgIGV4cGVjdChjb25maWcuY2FzZVNlbnNpdGl2ZUtleU1hdGNoKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGNvbmZpZy5yZW1vdmUpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdjcmVhdGVSZWRhY3RDb25maWcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdmFsaWQgcmVkYWN0IGNvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWcgPSBjcmVhdGVSZWRhY3RDb25maWcoWydwYXNzd29yZCcsICdzZWNyZXQnXSk7XG5cbiAgICAgIGV4cGVjdChjb25maWcuYmxhY2tsaXN0ZWRLZXlzKS50b0VxdWFsKFsncGFzc3dvcmQnLCAnc2VjcmV0J10pO1xuICAgICAgZXhwZWN0KGNvbmZpZy5yZXBsYWNlbWVudCkudG9CZSgnW1JFREFDVEVEXScpO1xuICAgICAgZXhwZWN0KGNvbmZpZy5jYXNlU2Vuc2l0aXZlS2V5TWF0Y2gpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KGNvbmZpZy5yZW1vdmUpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBhbGxvdyBjdXN0b20gb3B0aW9ucycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZVJlZGFjdENvbmZpZyhbJ2VtYWlsJ10sIHtcbiAgICAgICAgcmVwbGFjZW1lbnQ6ICdbSElEREVOXScsXG4gICAgICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogdHJ1ZSxcbiAgICAgICAgcmVtb3ZlOiB0cnVlXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGNvbmZpZy5ibGFja2xpc3RlZEtleXMpLnRvRXF1YWwoWydlbWFpbCddKTtcbiAgICAgIGV4cGVjdChjb25maWcucmVwbGFjZW1lbnQpLnRvQmUoJ1tISURERU5dJyk7XG4gICAgICBleHBlY3QoY29uZmlnLmNhc2VTZW5zaXRpdmVLZXlNYXRjaCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChjb25maWcucmVtb3ZlKS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19