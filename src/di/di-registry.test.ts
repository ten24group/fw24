import { Injectable } from './decorators';
import { DependencyRegistry } from './di-registry';
import { createToken } from './utils';

const registry = new DependencyRegistry();

describe('DependencyRegistry', () => {

    beforeEach(() => {
        registry.clear();
    });

    describe('register', () => {
        it('should register a class with useClass', () => {
            @Injectable()
            class TestClass {}
            
            const token = createToken<TestClass>(TestClass.name);
            registry.register(token, { useClass: TestClass });

            expect(registry['providers'].has(token.toString())).toBe(true);
        });

        it('should register a factory with useFactory', () => {
            const token = createToken<string>('TestFactory');
            const factory = () => 'test';
            registry.register(token, { useFactory: factory });
            expect(registry['providers'].has(token.toString())).toBe(true);
        });

        it('should register a value with useValue', () => {
            const token = createToken<string>('TestValue');
            registry.register(token, { useValue: 'test' });
            expect(registry['providers'].has(token.toString())).toBe(true);
        });

        it('should not register if condition is false', () => {
            const token = createToken<string>('TestCondition');
            registry.register(token, { useValue: 'test', condition: () => false });
            expect(registry['providers'].has(token.toString())).toBe(false);
        });
    });

    describe('resolve', () => {
        it('should resolve a class', async () => {
            @Injectable()
            class TestClass {}
            const token = createToken<TestClass>('TestClass');
            registry.register(token, { useClass: TestClass });
            const instance = await registry.resolve(token);
            expect(instance).toBeInstanceOf(TestClass);
        });

        it('should resolve a factory', async () => {
            const token = createToken<string>('TestFactory');
            const factory = () => 'test';
            registry.register(token, { useFactory: factory });
            const instance = await registry.resolve(token);
            expect(instance).toBe('test');
        });

        it('should resolve a value', async () => {
            const token = createToken<string>('TestValue');
            registry.register(token, { useValue: 'test' });
            const instance = await registry.resolve(token);
            expect(instance).toBe('test');
        });
    });

    describe('resolveAll', () => {
        it('should resolve all instances of a token', async () => {
            @Injectable()
            class TestClass {}
            
            const token = createToken<TestClass>('TestClass');
            registry.register(token, { useClass: TestClass });
            const instances = await registry.resolveAll(token);
            expect(instances.length).toBe(1);
            expect(instances[0]).toBeInstanceOf(TestClass);
        });
    });
});