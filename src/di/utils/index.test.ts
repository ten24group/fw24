import { flattenConfig, setPathValue, getPathValue, matchesPattern } from './index';

describe('DI Utils', () => {

    describe('flattenConfig', () => {

        it('should flatten simple object properties', () => {
            const config = {
                enabled: true,
                serviceName: 'my-app'
            };

            const flattened = flattenConfig(config, 'app');

            expect(flattened.get('app.enabled')).toBe(true);
            expect(flattened.get('app.serviceName')).toBe('my-app');
        });

        it('should flatten nested object properties', () => {
            const config = {
                database: {
                    host: 'localhost',
                    port: 5432
                }
            };

            const flattened = flattenConfig(config, 'app');

            expect(flattened.get('app.database.host')).toBe('localhost');
            expect(flattened.get('app.database.port')).toBe(5432);
        });

        it('should preserve arrays as leaf values (not flatten into indexed paths)', () => {
            const config = {
                backends: [
                    { type: 'cloudwatch', enabled: true },
                    { type: 'dynamodb', enabled: true }
                ]
            };

            const flattened = flattenConfig(config, 'observability');

            // Array should be stored as a single entry, not flattened
            expect(flattened.has('observability.backends')).toBe(true);
            expect(flattened.has('observability.backends.0')).toBe(false);
            expect(flattened.has('observability.backends.0.type')).toBe(false);

            const backends = flattened.get('observability.backends');
            expect(Array.isArray(backends)).toBe(true);
            expect(backends).toHaveLength(2);
            expect(backends[0].type).toBe('cloudwatch');
        });

        it('should preserve nested arrays', () => {
            const config = {
                dataProtection: {
                    blacklistedKeys: ['password', 'secret', 'apiKey'],
                    fields: ['data', 'attributes']
                }
            };

            const flattened = flattenConfig(config, 'observability');

            const blacklistedKeys = flattened.get('observability.dataProtection.blacklistedKeys');
            expect(Array.isArray(blacklistedKeys)).toBe(true);
            expect(blacklistedKeys).toEqual(['password', 'secret', 'apiKey']);

            const fields = flattened.get('observability.dataProtection.fields');
            expect(Array.isArray(fields)).toBe(true);
            expect(fields).toEqual(['data', 'attributes']);
        });

        it('should preserve empty arrays', () => {
            const config = {
                items: [],
                nested: {
                    emptyList: []
                }
            };

            const flattened = flattenConfig(config, 'test');

            expect(Array.isArray(flattened.get('test.items'))).toBe(true);
            expect(flattened.get('test.items')).toHaveLength(0);
            expect(Array.isArray(flattened.get('test.nested.emptyList'))).toBe(true);
        });

        it('should preserve arrays of primitives', () => {
            const config = {
                strings: ['a', 'b', 'c'],
                numbers: [1, 2, 3],
                booleans: [true, false]
            };

            const flattened = flattenConfig(config, 'test');

            expect(flattened.get('test.strings')).toEqual(['a', 'b', 'c']);
            expect(flattened.get('test.numbers')).toEqual([1, 2, 3]);
            expect(flattened.get('test.booleans')).toEqual([true, false]);
        });

        it('should handle complex nested structures with arrays', () => {
            const config = {
                enabled: true,
                backends: [
                    { type: 'cloudwatch', enabled: true },
                    { type: 'dynamodb', enabled: true, config: { tableName: 'logs' } }
                ],
                sampling: {
                    enabled: true,
                    rates: {
                        trace: 0.1,
                        info: 1.0
                    }
                },
                dataProtection: {
                    blacklistedKeys: ['password', 'secret']
                }
            };

            const flattened = flattenConfig(config, 'observability');

            // Scalars should be flattened
            expect(flattened.get('observability.enabled')).toBe(true);
            expect(flattened.get('observability.sampling.enabled')).toBe(true);
            expect(flattened.get('observability.sampling.rates.trace')).toBe(0.1);

            // Arrays should be preserved as-is
            expect(Array.isArray(flattened.get('observability.backends'))).toBe(true);
            expect(Array.isArray(flattened.get('observability.dataProtection.blacklistedKeys'))).toBe(true);
        });

        it('should handle config without basePath', () => {
            const config = {
                key: 'value',
                list: [1, 2, 3]
            };

            const flattened = flattenConfig(config);

            expect(flattened.get('key')).toBe('value');
            expect(flattened.get('list')).toEqual([1, 2, 3]);
        });
    });

    describe('setPathValue', () => {

        it('should set value at simple path', () => {
            const target: any = {};
            setPathValue(target, 'app.name', 'MyApp');

            expect(target.app.name).toBe('MyApp');
        });

        it('should set value at nested path', () => {
            const target: any = {};
            setPathValue(target, 'app.database.host', 'localhost');

            expect(target.app.database.host).toBe('localhost');
        });

        it('should preserve existing values', () => {
            const target: any = { app: { existing: 'value' } };
            setPathValue(target, 'app.name', 'MyApp');

            expect(target.app.existing).toBe('value');
            expect(target.app.name).toBe('MyApp');
        });

        it('should set arrays as values', () => {
            const target: any = {};
            setPathValue(target, 'app.items', [1, 2, 3]);

            expect(target.app.items).toEqual([1, 2, 3]);
            expect(Array.isArray(target.app.items)).toBe(true);
        });
    });

    describe('getPathValue', () => {

        it('should get value at simple path', () => {
            const obj = { app: { name: 'MyApp' } };
            expect(getPathValue(obj, 'app.name')).toBe('MyApp');
        });

        it('should get array values', () => {
            const obj = { items: [1, 2, 3] };
            expect(getPathValue(obj, 'items')).toEqual([1, 2, 3]);
        });

        it('should get nested array values', () => {
            const obj = { 
                app: { 
                    backends: [{ type: 'a' }, { type: 'b' }] 
                } 
            };
            const backends = getPathValue(obj, 'app.backends');
            expect(Array.isArray(backends)).toBe(true);
            expect(backends).toHaveLength(2);
        });
    });

    describe('matchesPattern', () => {

        it('should match exact paths', () => {
            expect(matchesPattern('app.name', 'app.name')).toBe(true);
            expect(matchesPattern('app.name', 'app.version')).toBe(false);
        });

        it('should match with wildcard', () => {
            expect(matchesPattern('app.name', 'app.*')).toBe(true);
            expect(matchesPattern('app.version', 'app.*')).toBe(true);
        });

        it('should match prefix patterns (used for config path collection)', () => {
            // matchesPattern is designed to match prefix patterns for config collection
            // e.g., pattern 'app' matches path 'app.database.host' because it's a prefix
            expect(matchesPattern('app.database.host', 'app')).toBe(true);
            expect(matchesPattern('app.database.host', 'app.database')).toBe(true);
        });
    });
});

