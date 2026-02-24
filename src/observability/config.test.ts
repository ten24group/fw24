import { createObservabilityConfig, validateConfig, CONFIG_DEFAULTS, VALID_BACKENDS } from './config';
import { ObservabilityLevel } from './types';

describe('Observability Config', () => {

    describe('createObservabilityConfig', () => {

        it('should create config with defaults when no input provided', () => {
            const config = createObservabilityConfig();

            expect(config.enabled).toBe(CONFIG_DEFAULTS.enabled);
            expect(config.minLevel).toBe(CONFIG_DEFAULTS.minLevel);
            expect(config.serviceName).toBe(CONFIG_DEFAULTS.serviceName);
            expect(config.cloudwatch.namespace).toBe(CONFIG_DEFAULTS.cloudwatchNamespace);
            expect(config.dynamodb.tableKey).toBe(CONFIG_DEFAULTS.tableKey);
            expect(config.dynamodb.ttlDays).toBe(CONFIG_DEFAULTS.ttlDays);
            // Operation normalization defaults
            expect(config.operationNormalization?.enabled).toBe(true);
            expect(Array.isArray(config.operationNormalization?.rules)).toBe(true);
            expect((config.operationNormalization?.rules?.length ?? 0)).toBeGreaterThan(0);
        });

        it('should create config with default backends as array', () => {
            const config = createObservabilityConfig();

            expect(Array.isArray(config.backends)).toBe(true);
            expect(config.backends.length).toBeGreaterThan(0);
            expect(config.backends[ 0 ].type).toBe('cloudwatch');
        });

        it('should preserve custom backends array', () => {
            const config = createObservabilityConfig({
                backends: [
                    { type: 'cloudwatch', enabled: true },
                    { type: 'dynamodb', enabled: true },
                    { type: 'otel', enabled: false }
                ]
            });

            expect(Array.isArray(config.backends)).toBe(true);
            expect(config.backends).toHaveLength(3);
            expect(config.backends[ 0 ].type).toBe('cloudwatch');
            expect(config.backends[ 1 ].type).toBe('dynamodb');
            expect(config.backends[ 2 ].type).toBe('otel');
            expect(config.backends[ 2 ].enabled).toBe(false);
        });

        it('should preserve dataProtection.blacklistedKeys as array', () => {
            const customKeys = [ 'apiKey', 'secretToken', 'privateKey' ];
            const config = createObservabilityConfig({
                dataProtection: {
                    blacklistedKeys: customKeys
                }
            });

            expect(Array.isArray(config.dataProtection.blacklistedKeys)).toBe(true);
            expect(config.dataProtection.blacklistedKeys).toEqual(customKeys);
        });

        it('should preserve dataProtection.fields as array', () => {
            const customFields = [ 'data', 'attributes' ];
            const config = createObservabilityConfig({
                dataProtection: {
                    fields: customFields as any
                }
            });

            expect(Array.isArray(config.dataProtection.fields)).toBe(true);
            expect(config.dataProtection.fields).toEqual(customFields);
        });

        it('should merge partial input with defaults', () => {
            const config = createObservabilityConfig({
                enabled: true,
                serviceName: 'my-service'
            });

            expect(config.enabled).toBe(true);
            expect(config.serviceName).toBe('my-service');
            // Defaults should still be applied
            expect(config.minLevel).toBe(CONFIG_DEFAULTS.minLevel);
            expect(config.cloudwatch.namespace).toBe(CONFIG_DEFAULTS.cloudwatchNamespace);
        });

        it('should support all valid backend types', () => {
            for (const backendType of VALID_BACKENDS) {
                const config = createObservabilityConfig({
                    backends: [ { type: backendType, enabled: true } ]
                });

                expect(config.backends[ 0 ].type).toBe(backendType);
            }
        });

        it('should throw for invalid backend type', () => {
            expect(() => createObservabilityConfig({
                backends: [ { type: 'invalid' as any, enabled: true } ]
            })).toThrow();
        });

        it('should support sampling configuration', () => {
            const config = createObservabilityConfig({
                sampling: {
                    enabled: true,
                    rates: {
                        trace: 0.1,
                        debug: 0.5,
                        info: 1.0
                    }
                }
            });

            expect(config.sampling.enabled).toBe(true);
            expect(config.sampling.rates?.trace).toBe(0.1);
            expect(config.sampling.rates?.debug).toBe(0.5);
            expect(config.sampling.rates?.info).toBe(1.0);
        });

        it('should support empty backends array', () => {
            const config = createObservabilityConfig({
                backends: []
            });

            // Should default to cloudwatch when empty
            expect(Array.isArray(config.backends)).toBe(true);
            expect(config.backends).toHaveLength(1);
            expect(config.backends[ 0 ].type).toBe('cloudwatch');
        });
    });

    describe('validateConfig', () => {

        it('should return no errors for valid config', () => {
            const config = createObservabilityConfig({
                enabled: true,
                serviceName: 'test-service',
                backends: [ { type: 'cloudwatch', enabled: true } ]
            });

            const errors = validateConfig(config);
            expect(errors).toHaveLength(0);
        });

        it('should validate serviceName is not empty', () => {
            const config = createObservabilityConfig();
            config.serviceName = '';

            const errors = validateConfig(config);
            expect(errors.some(e => e.includes('serviceName'))).toBe(true);
        });

        it('should validate backend types', () => {
            const config = createObservabilityConfig();
            (config.backends as any) = [ { type: 'invalid', enabled: true } ];

            const errors = validateConfig(config);
            expect(errors.some(e => e.includes('backend type'))).toBe(true);
        });

        it('should validate sampling rates are between 0 and 1', () => {
            // Create valid config first, then mutate to test validation
            const config = createObservabilityConfig({
                sampling: {
                    enabled: true,
                    rates: {
                        trace: 0.5  // Valid
                    }
                }
            });

            // Mutate to invalid value
            config.sampling.rates!.trace = 1.5;

            const errors = validateConfig(config);
            expect(errors.some(e => e.includes('sampling rate'))).toBe(true);
        });

        it('should validate minLevel is valid', () => {
            const config = createObservabilityConfig();
            (config as any).minLevel = 999;

            const errors = validateConfig(config);
            expect(errors.some(e => e.includes('minLevel'))).toBe(true);
        });
    });

    describe('Array method compatibility', () => {

        it('backends array should support filter()', () => {
            const config = createObservabilityConfig({
                backends: [
                    { type: 'cloudwatch', enabled: true },
                    { type: 'dynamodb', enabled: false },
                    { type: 'otel', enabled: true }
                ]
            });

            const enabledBackends = config.backends.filter(b => b.enabled !== false);
            expect(enabledBackends).toHaveLength(2);
        });

        it('backends array should support map()', () => {
            const config = createObservabilityConfig({
                backends: [
                    { type: 'cloudwatch', enabled: true },
                    { type: 'dynamodb', enabled: true }
                ]
            });

            const types = config.backends.map(b => b.type);
            expect(types).toEqual([ 'cloudwatch', 'dynamodb' ]);
        });

        it('backends array should support forEach()', () => {
            const config = createObservabilityConfig({
                backends: [
                    { type: 'cloudwatch', enabled: true },
                    { type: 'dynamodb', enabled: true }
                ]
            });

            const types: string[] = [];
            config.backends.forEach(b => types.push(b.type));
            expect(types).toEqual([ 'cloudwatch', 'dynamodb' ]);
        });

        it('blacklistedKeys array should support includes()', () => {
            const config = createObservabilityConfig({
                dataProtection: {
                    blacklistedKeys: [ 'password', 'secret', 'apiKey' ]
                }
            });

            expect(config.dataProtection.blacklistedKeys?.includes('password')).toBe(true);
            expect(config.dataProtection.blacklistedKeys?.includes('notInList')).toBe(false);
        });

        it('fields array should support includes()', () => {
            const config = createObservabilityConfig({
                dataProtection: {
                    fields: [ 'data', 'attributes', 'metadata' ]
                }
            });

            expect(config.dataProtection.fields?.includes('data')).toBe(true);
            expect(config.dataProtection.fields?.includes('context')).toBe(false);
        });
    });
});
