import { Middleware, MiddlewareAsync, ProviderOptions } from "../interfaces/di";
import {
    applyMiddlewares,
    applyMiddlewaresAsync,
    getPathValue,
    makeDIToken,
    validateProviderOptions
} from "./utils";


describe('Utility Functions - Complex Scenarios', () => {
    describe('makeDIToken', () => {
        it('should handle nested function names correctly', () => {
            function OuterFunction() {
                function InnerFunction() {}
                return InnerFunction;
            }

            const token = makeDIToken(OuterFunction());
            expect(String(token)).toBe('fw24.di.token:InnerFunction');
        });

        it('should create a token with custom namespace', () => {
            const token = makeDIToken('test', 'custom.namespace');
            expect(String(token)).toBe('custom.namespace:test');
        });
    });

    describe('applyMiddlewares', () => {
        it('should handle nested middleware calls', () => {
            const log: string[] = [];
            const middleware1: Middleware<any> = {
                middleware: (next) => {
                    log.push('middleware1 start');
                    const result = next();
                    log.push('middleware1 end');
                    return result;
                }
            };
            const middleware2: Middleware<any> = {
                middleware: (next) => {
                    log.push('middleware2 start');
                    const result = next();
                    log.push('middleware2 end');
                    return result;
                }
            };

            applyMiddlewares([middleware1, middleware2], () => {
                log.push('next');
            });

            expect(log).toEqual([
                'middleware1 start',
                'middleware2 start',
                'next',
                'middleware2 end',
                'middleware1 end'
            ]);
        });
    });

    describe('applyMiddlewaresAsync', () => {
        it('should handle async middleware with delays', async () => {
            const log: string[] = [];
            const middleware1: MiddlewareAsync<any> = {
                middleware: async (next) => {
                    log.push('middleware1 start');
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    const result = await next();
                    log.push('middleware1 end');
                    return result;
                }
            };
            const middleware2: MiddlewareAsync<any> = {
                middleware: async (next) => {
                    log.push('middleware2 start');
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    const result = await next();
                    log.push('middleware2 end');
                    return result;
                }
            };

            await applyMiddlewaresAsync([middleware1, middleware2], async () => {
                log.push('next');
            });

            expect(log).toEqual([
                'middleware1 start',
                'middleware2 start',
                'next',
                'middleware2 end',
                'middleware1 end'
            ]);
        });
    });

    describe('validateProviderOptions', () => {
        it('should throw an error for invalid provider types', () => {
            const token = makeDIToken('Test');

            expect(() => validateProviderOptions({} as any, token)).toThrow(
                `Invalid provider configuration for ${token.toString()}`
            );
        });

        it('should handle a combination of valid and invalid provider configurations', () => {
            const token = makeDIToken('Test');

            const validOptions: ProviderOptions<any> = { useClass: class Test {}, provide: token };
            expect(() => validateProviderOptions(validOptions, token)).not.toThrow();

            const invalidOptions: ProviderOptions<any> = { useFactory: undefined as any, provide: token };
            expect(() => validateProviderOptions(invalidOptions, token)).toThrow();
        });
    });

    describe('getPathValue', () => {
        const obj = {
            user: {
                name: 'John Doe',
                address: {
                    city: 'New York',
                    zip: '10001'
                },
                friends: [
                    { name: 'Jane' },
                    { name: 'Doe' }
                ]
            },
            items: [
                { id: 1, value: 'Item 1' },
                { id: 2, value: 'Item 2' }
            ]
        };

        test('should return the value at the given path', () => {
            expect(getPathValue(obj, 'user.name')).toBe('John Doe');
            expect(getPathValue(obj, 'user.address.city')).toBe('New York');
            expect(getPathValue(obj, 'user.friends.0.name')).toBe('Jane');
            expect(getPathValue(obj, 'items.1.value')).toBe('Item 2');
        });

        test('should throw an error for invalid path', () => {
            expect(() => getPathValue(obj, 'user.age')).toThrow("Invalid path at 'user'. Key 'age' not found in object");
            expect(() => getPathValue(obj, 'user.friends.2.name')).toThrow("Invalid path at 'user.friends'. Index '2' out of range");
        });

        test('should support pattern matching', () => {
            expect(getPathValue(obj, 'user.*')).toEqual({
                name: 'John Doe',
                address: {
                    city: 'New York',
                    zip: '10001'
                },
                friends: [
                    { name: 'Jane' },
                    { name: 'Doe' }
                ]
            });
            expect(getPathValue(obj, 'user.address.*')).toEqual({
                city: 'New York',
                zip: '10001'
            });
        });
    });

});

