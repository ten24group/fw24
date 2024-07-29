import { Injectable } from './decorators';
import { DIContainer } from './di-container';
import { makeDIToken } from './utils';

const container = new DIContainer();

describe('DIContainer', () => {

    beforeEach(() => {

        container.clear();
    });

    describe('register', () => {
        it('should register a class with useClass', () => {
            @Injectable()
            class TestClass {}
            
            container.register({ useClass: TestClass, name: TestClass.name });

            expect(container.has(TestClass)).toBe(true);
        });

        it('should register a factory with useFactory', () => {
            const token = makeDIToken<string>('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, name: token.toString() });
            expect(container['providers'].has(token.toString())).toBe(true);
        });

        it('should register a value with useValue', () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', name: token.toString() });
            expect(container['providers'].has(token.toString())).toBe(true);
        });

        it('should not register if condition is false', () => {
            const token = makeDIToken<string>('TestCondition');
            container.register({ useValue: 'test', condition: () => false , name: token.toString() });
            expect(container['providers'].has(token.toString())).toBe(false);
        });
    });

    describe('resolve', () => {
        it('should resolve a class', async () => {
            @Injectable()
            class TestClass {}
            const token = makeDIToken<TestClass>('TestClass');
            container.register({ useClass: TestClass, name: token.toString() });
            const instance = await container.resolve(token);
            expect(instance).toBeInstanceOf(TestClass);
        });

        it('should resolve a factory', async () => {
            const token = makeDIToken<string>('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, name: token.toString() });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });

        it('should resolve a value', async () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', name: token.toString() });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });
    });
});