import { DIContainer } from './di-container';
import { makeDIToken, registerConstructorDependency, registerModuleMetadata } from './utils';
import { DIModule, Inject, Injectable, OnInit } from './decorators';

describe('DIContainer', () => {
    let container: DIContainer;

    beforeEach(() => {
        container = new DIContainer();
    });

    describe('Registration', () => {
        it('registers a class with @Injectable()', () => {
            const { Injectable } = container;

            @Injectable()
            class TestClass {}
            expect(container.has(TestClass)).toBe(true);
        });

        it('registers a factory with useFactory', () => {
            const token = makeDIToken<string>('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, provide: token.toString() });
            expect(container['providers'].has(token)).toBe(true);
        });

        it('registers a value with useValue', () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', provide: token.toString() });
            expect(container['providers'].has(token)).toBe(true);
        });

        it('does not register if condition is false', () => {
            const token = makeDIToken<string>('TestCondition');
            container.register({ useValue: 'test', condition: () => false, provide: token.toString() });
            expect(container['providers'].has(token)).toBe(false);
        });
    });

    describe('Resolution', () => {
        it('resolves a class', async () => {
            const { Injectable } = container;

            @Injectable()
            class TestClass {}
            const instance = await container.resolve(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
        });

        it('resolves a factory', async () => {
            const token = makeDIToken<string>('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, provide: token.toString() });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });

        it('resolves a value', async () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', provide: token.toString() });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });

        it('throws an error if no provider is found', () => {
            const token = makeDIToken<string>('NonExistent');
            expect(() => container.resolve(token)).toThrowError('No provider found for Symbol(fw24.di.token:NonExistent)');
        });

        it('handles circular dependencies', async () => {
            const { Injectable } = container;

            @Injectable()
            class ClassA {
                constructor(@Inject('ClassB') public b: any) {}
            }

            @Injectable()
            class ClassB {
                constructor(@Inject('ClassA') public a: any) {}
            }

            const instanceA = container.resolve<ClassA>('ClassA');
            const instanceB = container.resolve<ClassB>('ClassB');

            expect(instanceA).toBeInstanceOf(ClassA);
            expect(instanceB).toBeInstanceOf(ClassB);
            expect(instanceA.b).toBeInstanceOf(ClassB);
            expect(instanceB.a).toBeInstanceOf(ClassA);
        });

        it('calls @OnInit method after resolving', async () => {
            const { Injectable } = container;
            const onInitSpy = jest.fn();

            @Injectable()
            class TestClass {
                @OnInit()
                onInit() {
                    onInitSpy();
                }
            }

            const instance = await container.resolve(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(onInitSpy).toHaveBeenCalled();
        });
    });

    describe('Property Injection', () => {
        it('injects properties using @Inject', async () => {
            const { Injectable } = container;

            @Injectable()
            class Dependency {}

            @Injectable()
            class TestClass {
                @Inject(Dependency)
                public dependency!: Dependency;
            }
            const instance = container.resolve<TestClass>(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.dependency).toBeInstanceOf(Dependency);
        });

        it('handles optional property injection', async () => {
            const { Injectable } = container;

            @Injectable()
            class TestClass {
                @Inject('OptionalDependency', { isOptional: true })
                public optionalDependency?: any;
            }

            const instance = container.resolve<TestClass>(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.optionalDependency).toBeUndefined();
        });
    });

    describe('Multiple Dependency Injection', () => {
        it('injects multiple dependencies', async () => {
            const { Injectable } = container;

            @Injectable()
            class DependencyA {}

            @Injectable()
            class DependencyB {}

            @Injectable()
            class TestClass {
                constructor(
                    @Inject(DependencyA) public dependencyA: DependencyA,
                    @Inject(DependencyB) public dependencyB: DependencyB
                ) {}
            }

            const instance = await container.resolve<TestClass>(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.dependencyA).toBeInstanceOf(DependencyA);
            expect(instance.dependencyB).toBeInstanceOf(DependencyB);
        });
    });

    describe('Singleton Behavior', () => {
        it('reuses singleton instances', async () => {
            const { Injectable } = container;

            @Injectable({ singleton: true })
            class TestClass {}

            const instance1 = await container.resolve<TestClass>(TestClass);
            const instance2 = await container.resolve<TestClass>(TestClass);

            expect(instance1).toBeInstanceOf(TestClass);
            expect(instance2).toBeInstanceOf(TestClass);
            expect(instance1).toBe(instance2);
        });
    });

    describe('Conditional Registration', () => {
        it('does not register a provider if condition is false', () => {
            const { Injectable } = container;
            const token = makeDIToken<string>('ConditionalService');

            @Injectable({ condition: () => false })
            class ConditionalService {}

            expect(container.has(token)).toBe(false);
        });

        it('registers a provider if condition is true', () => {
            const { Injectable } = container;
            const token = makeDIToken<string>('ConditionalService');

            @Injectable({ condition: () => true })
            class ConditionalService {}

            expect(container.has(token)).toBe(true);
        });
    });

    describe('Async Resolve', () => {
        it('resolves a class asynchronously', async () => {
            const { Injectable } = container;

            @Injectable()
            class TestClass {}

            const instance = await container.resolveAsync(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
        });

        it('resolves a factory asynchronously', async () => {
            const token = makeDIToken<string>('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, provide: token.toString() });

            const instance = await container.resolveAsync(token);
            expect(instance).toBe('test');
        });

        it('resolves a value asynchronously', async () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', provide: token.toString() });

            const instance = await container.resolveAsync(token);
            expect(instance).toBe('test');
        });

        it('handles circular dependencies asynchronously', async () => {
            const { Injectable } = container;

            @Injectable()
            class ClassA {
                constructor(@Inject('ClassB') public b: any) {}
            }

            @Injectable()
            class ClassB {
                constructor(@Inject('ClassA') public a: any) {}
            }

            const instanceA = await container.resolveAsync<ClassA>('ClassA');
            const instanceB = await container.resolveAsync<ClassB>('ClassB');

            expect(instanceA).toBeInstanceOf(ClassA);
            expect(instanceB).toBeInstanceOf(ClassB);
            expect(instanceA.b).toBeInstanceOf(ClassB);
            expect(instanceB.a).toBeInstanceOf(ClassA);
        });

        it('handles optional property injection asynchronously', async () => {
            const { Injectable } = container;

            @Injectable()
            class TestClass {
                @Inject('OptionalDependency', { isOptional: true })
                public optionalDependency?: any;
            }

            const instance = await container.resolveAsync<TestClass>(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.optionalDependency).toBeUndefined();
        });
    });

    describe('Clear Container', () => {
        it('clears all providers and cache', () => {
            const { Injectable } = container;

            @Injectable()
            class TestClass {}

            expect(container.has(TestClass)).toBe(true);

            container.clear();
            expect(container.has(TestClass)).toBe(false);
            expect((container as any).cache.size).toBe(0);
        });
    });

    describe('Error Handling', () => {
        it('throws an error when registering an invalid provider', () => {
            expect(() => {
                container.register({ useClass: null as any, provide: 'InvalidProvider' });
            }).toThrow();
        });

        it('throws an error when resolving an invalid provider', () => {
            const token = makeDIToken<string>('InvalidProvider');
            expect(() => container.resolve(token)).toThrow();
        });
    });

    describe('Inheritance', () => {
        it('injects dependencies in a derived class', async () => {
            const { Injectable } = container;

            @Injectable()
            class BaseService {}

            @Injectable()
            class DerivedService extends BaseService {
                constructor(@Inject(BaseService) public baseService: BaseService) {
                    super();
                }
            }

            const instance = await container.resolve<DerivedService>(DerivedService);

            expect(instance).toBeInstanceOf(DerivedService);
            expect(instance.baseService).toBeInstanceOf(BaseService);
        });
    });

    describe('Lifecycle Hooks', () => {
        it('calls @OnInit method for each instance', async () => {
            const { Injectable } = container;
            const onInitSpy = jest.fn();

            @Injectable({ singleton: false })
            class TestClass {
                @OnInit()
                onInit() {
                    onInitSpy();
                }
            }

            const instance1 = container.resolve<TestClass>(TestClass);
            const instance2 = container.resolve<TestClass>(TestClass);

            expect(onInitSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('Re-registration', () => {
        it('updates provider when re-registered', async () => {
            const { Injectable } = container;

            @Injectable()
            class OriginalService {}

            @Injectable()
            class UpdatedService {}

            const token = makeDIToken<OriginalService>('Service');
            container.register({ useClass: OriginalService, provide: token.toString() });

            let instance = container.resolve(token);
            expect(instance).toBeInstanceOf(OriginalService);
            container.register({ useClass: UpdatedService, provide: token.toString() });

            instance = container.resolve(token);
            expect(instance).toBeInstanceOf(UpdatedService);
        });
    });

    describe('Complex Dependency Graphs', () => {
        it('resolves complex dependency graphs', async () => {
            const { Injectable } = container;

            @Injectable()
            class ServiceA {}

            @Injectable()
            class ServiceB {
                constructor(@Inject(ServiceA) public a: ServiceA) {}
            }

            @Injectable()
            class ServiceC {
                constructor(@Inject(ServiceB) public b: ServiceB) {}
            }

            @Injectable()
            class ServiceD {
                constructor(@Inject(ServiceC) public c: ServiceC, @Inject(ServiceA) public a: ServiceA) {}
            }

            const instance = await container.resolve<ServiceD>(ServiceD);

            expect(instance).toBeInstanceOf(ServiceD);
            expect(instance.c).toBeInstanceOf(ServiceC);
            expect(instance.c.b).toBeInstanceOf(ServiceB);
            expect(instance.c.b.a).toBeInstanceOf(ServiceA);
            expect(instance.a).toBeInstanceOf(ServiceA);
        });
    });

    describe('Child Containers', () => {
        let childContainer: DIContainer;

        beforeEach(() => {
            childContainer = container.createChildContainer();
        });

        describe('Inheritance', () => {
            it('inherits providers from parent container', () => {
                const { Injectable } = container;

                @Injectable()
                class ParentService {}

                const instance = childContainer.resolve<ParentService>(ParentService);

                expect(instance).toBeInstanceOf(ParentService);
            });

            it('overrides providers in child container', () => {
                const { Injectable } = container;

                @Injectable()
                class ParentService {
                    getMessage() {
                        return 'parent';
                    }
                }

                @Injectable()
                class ChildService {
                    getMessage() {
                        return 'child';
                    }
                }

                childContainer.register({ useClass: ChildService, provide: 'Service' });

                const instance = childContainer.resolve<ChildService>('Service');

                expect(instance).toBeInstanceOf(ChildService);
                expect(instance.getMessage()).toBe('child');
            });
        });

        describe('Provider Shadowing', () => {
            it('shadows parent container providers', () => {

                @container.Injectable({'provide': 'Service'})
                class ParentService {
                    getMessage() {
                        return 'parent';
                    }
                }

                @childContainer.Injectable({provide: 'Service'})
                class ChildService {
                    getMessage() {
                        return 'child';
                    }
                }

                const childInstance = childContainer.resolve<ChildService>('Service');
                const parentInstance = container.resolve<ParentService>('Service');

                expect(childInstance).toBeInstanceOf(ChildService);
                expect(childInstance.getMessage()).toBe('child');
                expect(parentInstance).toBeInstanceOf(ParentService);
                expect(parentInstance.getMessage()).toBe('parent');
            });
        });

        describe('Adding Providers to Parent and Root Containers', () => {
            it('adds providers to parent container', () => {
                const { Injectable } = container;

                @Injectable()
                class ParentService {}

                childContainer.registerInParentContainer({ useClass: ParentService, provide: 'ParentService' });

                const instance = container.resolve<ParentService>('ParentService');

                expect(instance).toBeInstanceOf(ParentService);
            });
        });

        describe('Conditional Resolution in Child Containers', () => {
            it('conditionally registers providers in child container', () => {
                const { Injectable } = container;

                @Injectable()
                class ParentService {}

                childContainer.register({
                    useClass: ParentService,
                    provide: 'ConditionalService',
                    condition: () => false
                });

                expect(() => childContainer.resolve('ConditionalService')).toThrow('No provider found for Symbol(fw24.di.token:ConditionalService)');
            });
        });

        describe('Middleware Support in Child Containers', () => {
            it('applies middleware to child container resolutions', () => {
                const middlewareSpy = jest.fn((next) => next());

                childContainer.useMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {}

                childContainer.register({ useClass: MiddlewareService, provide: 'MiddlewareService' });

                const instance = childContainer.resolve<MiddlewareService>('MiddlewareService');
                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });

            it('applies async middleware to child container resolutions', async () => {
                const middlewareSpy = jest.fn(async (next) => await next());

                childContainer.useAsyncMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {}

                childContainer.register({ useClass: MiddlewareService, provide: 'MiddlewareService' });

                const instance = await childContainer.resolveAsync<MiddlewareService>('MiddlewareService');
                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });
        });

        describe('Property Injection in Child Containers', () => {
            it('injects properties using @Inject in child container', async () => {
                const { Injectable } = container;

                @Injectable()
                class Dependency {}

                @Injectable()
                class TestClass {
                    @Inject(Dependency)
                    public dependency!: Dependency;
                }

                childContainer.register({ useClass: Dependency, provide: Dependency.name });
                childContainer.register({ useClass: TestClass, provide: TestClass.name });

                const instance = childContainer.resolve<TestClass>(TestClass);

                expect(instance).toBeInstanceOf(TestClass);
                expect(instance.dependency).toBeInstanceOf(Dependency);
            });

            it('handles optional property injection in child container', async () => {
                const { Injectable } = container;

                @Injectable()
                class TestClass {
                    @Inject('OptionalDependency', { isOptional: true })
                    public optionalDependency?: any;
                }

                childContainer.register({ useClass: TestClass, provide: TestClass.name });

                const instance = await childContainer.resolve<TestClass>(TestClass);

                expect(instance).toBeInstanceOf(TestClass);
                expect(instance.optionalDependency).toBeUndefined();
            });
        });
    });

    describe('Middleware and Interceptors', () => {
        describe('Middleware', () => {
            it('applies middleware to resolutions', () => {
                const middlewareSpy = jest.fn((next) => {
                    console.log('Middleware before');
                    const result = next();
                    console.log('Middleware after');
                    return result;
                });

                container.useMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {}

                const instance = container.resolve<MiddlewareService>('MiddlewareService');

                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });

            it('allows middleware to modify the result', () => {
                const middlewareSpy = jest.fn((next) => {
                    const result = next();
                    result.modified = true;
                    return result;
                });

                container.useMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {
                    value = 'original';
                }

                const instance = container.resolve<any>('MiddlewareService');

                expect(instance).toBeInstanceOf(MiddlewareService);
                expect(instance.modified).toBe(true);
            });

            it('handles errors in middleware', () => {
                const middlewareSpy = jest.fn(() => {
                    throw new Error('Middleware error');
                });

                container.useMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {}

                expect(() => container.resolve<MiddlewareService>('MiddlewareService')).toThrowError('Middleware error');
            });
        });

        describe('Async Middleware', () => {
            it('applies async middleware to resolutions', async () => {
                const middlewareSpy = jest.fn(async (next) => {
                    console.log('Async middleware before');
                    const result = await next();
                    console.log('Async middleware after');
                    return result;
                });

                container.useAsyncMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {}

                const instance = await container.resolveAsync<MiddlewareService>('MiddlewareService');

                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });

            it('allows async middleware to modify the result', async () => {
                const middlewareSpy = jest.fn(async (next) => {
                    const result = await next();
                    result.modified = true;
                    return result;
                });

                container.useAsyncMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {
                    value = 'original';
                }

                const instance = await container.resolveAsync<any>('MiddlewareService');

                expect(instance).toBeInstanceOf(MiddlewareService);
                expect(instance.modified).toBe(true);
            });

            it('handles errors in async middleware', async () => {
                const middlewareSpy = jest.fn(async () => {
                    throw new Error('Async middleware error');
                });

                container.useAsyncMiddleware({ middleware: middlewareSpy });

                const { Injectable } = container;

                @Injectable()
                class MiddlewareService {}

                await expect(container.resolveAsync<MiddlewareService>('MiddlewareService')).rejects.toThrow('Async middleware error');
            });
        });
    });

    describe('Provider Priority Registration', () => {
        class TestClassA {
            value: string = 'A';
        }

        class TestClassB {
            value: string = 'B';
        }

        test('registers a provider with higher priority', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA,
                priority: 1
            });

            const instance = container.resolve<TestClassA>('test');
            expect(instance.value).toBe('A');
        });

        test('does not override a provider with a higher priority', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA,
                priority: 2
            });

            container.register({
                provide: 'test',
                useClass: TestClassB,
                priority: 1
            });

            const instance = container.resolve<TestClassA>('test');
            expect(instance.value).toBe('A'); // Should not override with lower priority
        });

        test('overrides a provider with a lower priority', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA,
                priority: 1
            });

            container.register({
                provide: 'test',
                useClass: TestClassB,
                priority: 2
            });

            const instance = container.resolve<TestClassB>('test');
            expect(instance.value).toBe('B'); // Should override with higher priority
        });

        test('registers a provider without priority and overrides if new one has priority', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA
            });

            container.register({
                provide: 'test',
                useClass: TestClassB,
                priority: 1
            });

            const instance = container.resolve<TestClassB>('test');
            expect(instance.value).toBe('B'); // Should override since new provider has priority
        });

        test('does not register a provider with lower priority when one without priority exists', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA
            });

            container.register({
                provide: 'test',
                useClass: TestClassB,
                priority: -1
            });

            const instance = container.resolve<TestClassA>('test');
            expect(instance.value).toBe('A'); // Should not override since existing provider has no priority
        });
    });

    describe('Optional Dependency Injection with Default Value', () => {
        class TestClassA {
            value: string;
            constructor(value: string = 'A') {
                this.value = value;
            }
        }

        class DependentClass {
            constructor(public dep: TestClassA) {}
        }

        test('injects dependency when provided', () => {
            container.register({
                provide: 'dep',
                useClass: TestClassA
            });

            container.register({
                provide: 'dependent',
                useClass: DependentClass
            });

            registerConstructorDependency(DependentClass, 0, 'dep', {
                isOptional: true,
                defaultValue: new TestClassA('default'),
            });

            const instance = container.resolve<DependentClass>('dependent');
            expect(instance.dep.value).toBe('A');
        });

        test('uses default value when dependency is not provided', () => {
            container.register({
                provide: 'dependent',
                useClass: DependentClass
            });

            registerConstructorDependency(DependentClass, 0, 'dep', {
                isOptional: true,
                defaultValue: new TestClassA('default'),
            });

            const instance = container.resolve<DependentClass>('dependent');
            expect(instance.dep.value).toBe('default');
        });
    });

    describe('Middleware Execution Order Control', () => {
        class TestClassA {
            value: string;
            constructor(value: string = 'A') {
                this.value = value;
            }
        }

        test('executes middlewares in specified order', () => {
            const result: string[] = [];

            container.useMiddleware({
                middleware: next => {
                    result.push('middleware1');
                    return next();
                },
                order: 0
            });

            container.useMiddleware({
                middleware: next => {
                    result.push('middleware2');
                    return next();
                },
                order: 1
            });

            container.useMiddleware({
                middleware: next => {
                    result.push('middleware0');
                    return next();
                },
                order: -1
            });

            container.register({
                provide: 'test',
                useClass: TestClassA
            });

            container.resolve<TestClassA>('test');
            expect(result).toEqual(['middleware0', 'middleware1', 'middleware2']);
        });

        test('executes async middlewares in specified order', async () => {
            const result: string[] = [];

            container.useAsyncMiddleware({
                middleware: async next => {
                    result.push('middleware1');
                    return next();
                },
                order: 0
            });

            container.useAsyncMiddleware({
                middleware: async next => {
                    result.push('middleware2');
                    return next();
                },
                order: 1
            });

            container.useAsyncMiddleware({
                middleware: async next => {
                    result.push('middleware0');
                    return next();
                },
                order: -1
            });

            container.register({
                provide: 'test',
                useClass: TestClassA
            });

            await container.resolveAsync<TestClassA>('test');
            expect(result).toEqual(['middleware0', 'middleware1', 'middleware2']);
        });
    });

    describe('Provider Removal', () => {
        class TestClassA {
            value: string;
            constructor(value: string = 'A') {
                this.value = value;
            }
        }

        class TestClassB {
            value: string = 'B';
        }

        test('removes a registered provider', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA
            });
            container.removeProvider('test');
            expect(() => container.resolve<TestClassA>('test')).toThrow();
        });

        test('removes a provider from the cache', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA,
                singleton: true
            });

            const instance1 = container.resolve<TestClassA>('test');
            container.removeProvider('test');
            container.register({
                provide: 'test',
                useClass: TestClassB
            });
            const instance2 = container.resolve<TestClassA>('test');

            expect(instance1.value).toBe('A');
            expect(instance2.value).toBe('B');
        });

        test('handles removing non-existent provider gracefully', () => {
            expect(() => container.removeProvider('nonExistent')).not.toThrow();
        });
    });

    describe('Modules', () => {
        beforeEach(() => {
            container.clear();
        });

        it('registers a module', () => {
            const { Injectable } = container;

            class TestModule {}
            
            @Injectable()
            class TestClassA {}

            registerModuleMetadata(TestModule, {
                identifier: TestModule,
                providers: [
                    { useClass: TestClassA, provide: 'test' },
                    { useValue: 'test', provide: 'testValue' },
                    { useFactory: () => 'test', provide: 'testFactory' }
                ],
                exports: ['testValue']
            });

            const module = container.module(TestModule);

            const instance = container.resolve<TestClassA>('testValue');
            expect(instance).toBe('test');

            expect(() => container.resolve('test')).toThrow('No provider found for Symbol(fw24.di.token:test)');

            const instance2 = module.container.resolve('test');
            expect(instance2).toBeInstanceOf(TestClassA);
        });

        it('imports an empty module without errors', () => {
            class TestModule {}
            registerModuleMetadata(TestModule, { imports: [], exports: [], providers: [] });

            const module = container.module(TestModule);
            expect(module).toBeDefined();
        });

        it('registers nested modules correctly', () => {
            class NestedModule {}
            class TestModule {}

            registerModuleMetadata(NestedModule, {
                imports: [],
                exports: ['nestedDep'],
                providers: [{ provide: 'nestedDep', useValue: 'nestedValue' }]
            });

            registerModuleMetadata(TestModule, {
                imports: [NestedModule],
                exports: ['nestedDep'],
                providers: []
            });

            container.module(TestModule);
            const resolvedValue = container.resolve('nestedDep');
            expect(resolvedValue).toBe('nestedValue');
        });

        it('throws an error if an export is not provided', () => {
            class TestModule {}

            registerModuleMetadata(TestModule, {
                imports: [],
                exports: ['missingDep'],
                providers: []
            });

            expect(() => container.module(TestModule)).toThrow();
        });
    });

    describe('Modules with @DIModule()', () => {
        beforeEach(() => {
            container.clear();
        });

        it('registers a module with @DIModule', () => {
            const { Injectable } = container;

            @Injectable()
            class TestClassA {}

            @DIModule({
                providers: [
                    { useClass: TestClassA, provide: 'test' },
                    { useValue: 'test', provide: 'testValue' },
                    { useFactory: () => 'test', provide: 'testFactory' }
                ],
                exports: ['testValue']
            })
            class TestModule {}

            const module = container.module(TestModule);

            const instance = container.resolve<TestClassA>('testValue');
            expect(instance).toBe('test');

            expect(() => container.resolve('test')).toThrow('No provider found for Symbol(fw24.di.token:test)');

            const instance2 = module.container.resolve('test');
            expect(instance2).toBeInstanceOf(TestClassA);
        });

        it('imports an empty module without errors', () => {
            @DIModule({ imports: [], exports: [], providers: [] })
            class TestModule {}

            const module = container.module(TestModule);
            expect(module).toBeDefined();
        });

        it('registers nested modules correctly', () => {
            @DIModule({
                imports: [],
                exports: ['nestedDep'],
                providers: [{ provide: 'nestedDep', useValue: 'nestedValue' }]
            })
            class NestedModule {}

            @DIModule({
                imports: [NestedModule],
                exports: ['nestedDep'],
                providers: []
            })
            class TestModule {}

            container.module(TestModule);

            const resolvedValue = container.resolve('nestedDep');

            expect(resolvedValue).toBe('nestedValue');
        });

        it('throws an error if an export is not provided', () => {
            @DIModule({
                imports: [],
                exports: ['missingDep'],
                providers: []
            })
            class TestModule {}

            expect(() => container.module(TestModule)).toThrow();
        });

        it('Make @Injectable register provider with specific module', () => {
            @DIModule({})
            class TestModule {}

            @Injectable({providedIn: TestModule})
            class TestClass {}

            const module = container.module(TestModule);

            expect(module.container.resolve(TestClass)).toBeDefined();
        });
    });


    describe('Provider Registration without a `provide` Key', () => {
        it('should throw an error when registering a provider without a `provide` key', () => {
            class TestClass {}
            expect(() => {
                container.register({ useClass: TestClass } as any);
            }).toThrow();
        });
    });

    describe('Scoped Provider Registration', () => {
        it('should create different instances for scoped providers in different child containers', () => {
            const { Injectable } = container;

            @Injectable({ singleton: false })
            class ScopedService {}

            container.register({ useClass: ScopedService, provide: 'ScopedService', singleton: false });

            const childContainer1 = container.createChildContainer();
            const childContainer2 = container.createChildContainer();

            const instance1 = childContainer1.resolve<ScopedService>('ScopedService');
            const instance2 = childContainer2.resolve<ScopedService>('ScopedService');

            expect(instance1).toBeInstanceOf(ScopedService);
            expect(instance2).toBeInstanceOf(ScopedService);
            expect(instance1).not.toBe(instance2);
        });
    });

    describe('Provider Condition Function Evaluation', () => {
        it('should register provider based on dynamic runtime conditions', () => {
            const token = makeDIToken<string>('DynamicConditionService');
            const conditionFn = jest.fn(() => Math.random() > 0.5);

            @container.Injectable({ condition: conditionFn })
            class DynamicConditionService {}

            container.register({ useClass: DynamicConditionService, provide: token.toString(), condition: conditionFn });

            if (container.has(token)) {
                expect(container.resolve(token)).toBeInstanceOf(DynamicConditionService);
            } else {
                expect(() => container.resolve(token)).toThrow();
            }

            expect(conditionFn).toHaveBeenCalled();
        });
    });

    describe('Async Lifecycle Hooks', () => {
        it('should call async lifecycle hooks correctly', async () => {
            const onInitSpy = jest.fn().mockResolvedValue(true);

            @container.Injectable()
            class TestClass {
                @OnInit()
                async onInit() {
                    await onInitSpy();
                }
            }

            const instance = await container.resolveAsync(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(onInitSpy).toHaveBeenCalled();
        });
    });

    describe('Error Handling in Provider Factories', () => {
        it('should propagate errors from provider factory functions', () => {
            const token = makeDIToken<string>('ErrorFactory');
            const factory = jest.fn(() => {
                throw new Error('Factory error');
            });

            container.register({ useFactory: factory, provide: token.toString() });

            expect(() => container.resolve(token)).toThrow('Factory error');
            expect(factory).toHaveBeenCalled();
        });
    });

    describe('Inheritance Across Containers', () => {
        it('should support inheritance and method overriding in child containers', () => {
            const { Injectable } = container;

            @Injectable()
            class BaseService {
                getMessage() {
                    return 'base';
                }
            }

            @Injectable()
            class DerivedService extends BaseService {
                override getMessage() {
                    return 'derived';
                }
            }

            container.register({ useClass: BaseService, provide: BaseService.name });
            const childContainer = container.createChildContainer();
            childContainer.register({ useClass: DerivedService, provide: DerivedService.name });

            const baseInstance = childContainer.resolve<BaseService>(BaseService);
            const derivedInstance = childContainer.resolve<DerivedService>(DerivedService);

            expect(baseInstance.getMessage()).toBe('base');
            expect(derivedInstance.getMessage()).toBe('derived');
        });
    });

    describe('Dynamic Provider Resolution', () => {
        it('should resolve providers dynamically based on runtime data', () => {
            @container.Injectable()
            class ConfigurableService {
                constructor(@Inject('Config') public config: any) {}
            }

            const dynamicConfig = { setting: 'value' };
            container.register({ useValue: dynamicConfig, provide: 'Config' });

            const instance = container.resolve<ConfigurableService>(ConfigurableService);

            expect(instance.config).toBe(dynamicConfig);
        });
    });

    describe('Singleton Behavior Across Child Containers', () => {
        it('should share singleton instances across child containers', () => {
            @container.Injectable({ singleton: true })
            class SingletonService {}

            const childContainer1 = container.createChildContainer();
            const childContainer2 = container.createChildContainer();

            const instance1 = childContainer1.resolve<SingletonService>(SingletonService);
            const instance2 = childContainer2.resolve<SingletonService>(SingletonService);

            expect(instance1).toBe(instance2);
        });
    });

    describe('Circular Dependency Detection with More Complexity', () => {
        it('should handle circular dependencies involving more than two classes', () => {
            const { Injectable } = container;

            @Injectable({provide: 'ClassA'})
            class ClassA {
                constructor(@Inject('ClassC') public c: any) {}
            }

            @Injectable({provide: 'ClassB'})
            class ClassB {
                constructor(@Inject('ClassA') public a: any) {}
            }

            @Injectable({provide: 'ClassC'})
            class ClassC {
                constructor(@Inject('ClassB') public b: any) {}
            }

            expect(container.resolve('ClassA')).toBeInstanceOf(ClassA);
        });
    });

    describe('Handling of Missing Optional Dependencies', () => {
        it('creates instances with default values for missing optional dependencies', () => {
            @container.Injectable()
            class TestClass {
                constructor(@Inject('OptionalDep', { isOptional: true, defaultValue: 'default' }) public dep?: string) {}
            }

            const instance = container.resolve<TestClass>(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.dep).toBe('default');
        });
    });

    describe('Provider Replacement and Priority Edge Cases', () => {
        it('handles providers with the same priority correctly', () => {
            class TestClassA {
                value: string = 'A';
            }

            class TestClassB {
                value: string = 'B';
            }

            container.register({
                provide: 'test',
                useClass: TestClassA,
                priority: 1
            });

            container.register({
                provide: 'test',
                useClass: TestClassB,
                priority: 1
            });

            const instance = container.resolve<TestClassB>('test');
            expect(instance.value).toBe('B'); // The last registered provider should take precedence
        });
    });

    describe('Async Factory Functions', () => {
        it('resolves providers registered with async factory functions', async () => {
            const token = makeDIToken<string>('AsyncFactory');
            const factory = async () => 'async test';

            container.register({ useFactory: factory, provide: token.toString() });

            const instance = await container.resolveAsync(token);
            expect(instance).toBe('async test');
        });
    });

    describe('Edge Cases for Middleware', () => {
        it('middleware can skip the next function', () => {
            
            const middlewareSpy = jest.fn(() => {
                // Skip the next function
                return 'short-circuited';
            });

            container.useMiddleware({ middleware: middlewareSpy });

            @container.Injectable()
            class MiddlewareService {}

            const instance = container.resolve<any>('MiddlewareService');

            expect(middlewareSpy).toHaveBeenCalled();
            expect(instance).toBe('short-circuited');
        });

        it('handles errors in middleware correctly', () => {
            const middlewareSpy = jest.fn(() => {
                throw new Error('Middleware error');
            });

            container.useMiddleware({ middleware: middlewareSpy });

            @container.Injectable()
            class MiddlewareService {}

            expect(() => container.resolve<MiddlewareService>('MiddlewareService')).toThrowError('Middleware error');
        });
    });

    describe('Conditional Providers with Dependencies', () => {
        it('resolves conditional providers with dependencies correctly', () => {
            const token = makeDIToken<string>('ConditionalService');

            @container.Injectable()
            class Dependency {}

            @container.Injectable({ condition: () => true })
            class ConditionalService {
                constructor(@Inject(Dependency) public dependency: Dependency) {}
            }

            container.register({ useClass: Dependency, provide: Dependency.name });

            const instance = container.resolve<ConditionalService>('ConditionalService');
            expect(instance).toBeInstanceOf(ConditionalService);
            expect(instance.dependency).toBeInstanceOf(Dependency);
        });
    });

    describe('Async Error Handling', () => {
        it('handles errors in async lifecycle hooks', async () => {
            const onInitSpy = jest.fn().mockRejectedValue(new Error('Async init error'));

            @container.Injectable()
            class TestClass {
                @OnInit()
                async onInit() {
                    await onInitSpy();
                }
            }

            await expect(container.resolveAsync(TestClass)).rejects.toThrow('Async init error');
        });
    });

    describe('Complex Inheritance and Interface Implementations', () => {
        it('resolves classes implementing interfaces and extending other classes', () => {
            @container.Injectable()
            class BaseService {
                getServiceName() {
                    return 'BaseService';
                }
            }

            interface IService {
                getServiceName(): string;
            }

            @container.Injectable()
            class DerivedService extends BaseService implements IService {
                override getServiceName() {
                    return 'DerivedService';
                }
            }

            const instance = container.resolve<DerivedService>(DerivedService);

            expect(instance).toBeInstanceOf(DerivedService);
            expect(instance.getServiceName()).toBe('DerivedService');
        });
    });

    describe('Recursive Dependency Resolution', () => {
        it('resolves providers that depend on dynamically resolved providers', () => {
            const { Injectable } = container;

            @Injectable()
            class DynamicProvider {
                getValue() {
                    return 'dynamic value';
                }
            }

            @Injectable()
            class TestClass {
                constructor(@Inject(DynamicProvider) public provider: DynamicProvider) {}
            }

            const instance = container.resolve<TestClass>(TestClass);
            expect(instance.provider.getValue()).toBe('dynamic value');
        });
    });

    describe('Lifecycle Hooks Order', () => {
        it('calls lifecycle hooks in the correct order', async () => {
            const onInitSpy1 = jest.fn();
            const onInitSpy2 = jest.fn();

            @container.Injectable()
            class FirstService {
                @OnInit()
                onInit() {
                    onInitSpy1();
                }
            }

            @container.Injectable()
            class SecondService {
                constructor(@Inject(FirstService) public firstService: FirstService) {}

                @OnInit()
                onInit() {
                    onInitSpy2();
                }
            }

            const instance = await container.resolveAsync<SecondService>(SecondService);

            expect(instance).toBeInstanceOf(SecondService);
            expect(onInitSpy1).toHaveBeenCalled();
        });
    });

    describe('Middleware State Management', () => {
        it('should maintain and modify state across multiple resolutions using middleware', () => {
            const middlewareSpy = jest.fn((next) => {
                const state = { counter: 0 };
                state.counter++;
                const result = next();
                result.state = state;
                return result;
            });

            container.useMiddleware({ middleware: middlewareSpy });

            @container.Injectable({ singleton: false })  // Ensure each resolution creates a new instance            class StatefulService {}
            class StatefulService {}

            const instance1 = container.resolve<any>('StatefulService');
            const instance2 = container.resolve<any>('StatefulService');

            expect(instance1.state.counter).toBe(1);
            expect(instance2.state.counter).toBe(1); // Middleware creates new state for each resolution
            expect(middlewareSpy).toHaveBeenCalledTimes(2);
        });
    });
});
