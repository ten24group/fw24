import { DIContainer } from './di-container';
import { makeDIToken, registerConstructorDependency, registerModuleMetadata } from './utils';
import { DIModule, Inject, Injectable, InjectConfig, InjectContainer, OnInit } from './decorators';
import { ConfigProviderOptions } from './../interfaces/di';

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
            container.register({ useFactory: factory, provide: token });
            expect(container['providers'].has(token)).toBe(true);
        });

        it('registers a value with useValue', () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', provide: token });
            expect(container['providers'].has(token)).toBe(true);
        });

        it('does not register if condition is false', () => {
            const token = makeDIToken<string>('TestCondition');
            container.register({ useValue: 'test', condition: () => false, provide: token });
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
            container.register({ useFactory: factory, provide: token });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });

        it('resolves a value', async () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', provide: token });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });

        it('throws an error if no provider is found', () => {
            const token = makeDIToken<string>('NonExistent');
            expect(() => container.resolve(token)).toThrowError('No provider found for fw24.di.token:NonExistent');
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
            container.register({ useFactory: factory, provide: token });

            const instance = await container.resolveAsync(token);
            expect(instance).toBe('test');
        });

        it('resolves a value asynchronously', async () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', provide: token });

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
            container.register({ useClass: OriginalService, provide: token });

            let instance = container.resolve(token);
            expect(instance).toBeInstanceOf(OriginalService);
            container.register({ useClass: UpdatedService, provide: token });

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
            childContainer = container.createChildContainer('child');
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

                expect(() => childContainer.resolve('ConditionalService')).toThrow('No provider found for fw24.di.token:ConditionalService');
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

                childContainer.useMiddlewareAsync({ middleware: middlewareSpy });

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

                container.useMiddlewareAsync({ middleware: middlewareSpy });

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

                container.useMiddlewareAsync({ middleware: middlewareSpy });

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

                container.useMiddlewareAsync({ middleware: middlewareSpy });

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

            container.useMiddlewareAsync({
                middleware: async next => {
                    result.push('middleware1');
                    return next();
                },
                order: 0
            });

            container.useMiddlewareAsync({
                middleware: async next => {
                    result.push('middleware2');
                    return next();
                },
                order: 1
            });

            container.useMiddlewareAsync({
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
            container.removeProvidersFor('test');
            expect(() => container.resolve<TestClassA>('test')).toThrow();
        });

        test('removes a provider from the cache', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA,
                singleton: true
            });

            const instance1 = container.resolve<TestClassA>('test');
            container.removeProvidersFor('test');
            container.register({
                provide: 'test',
                useClass: TestClassB
            });
            const instance2 = container.resolve<TestClassA>('test');

            expect(instance1.value).toBe('A');
            expect(instance2.value).toBe('B');
        });

        test('handles removing non-existent provider gracefully', () => {
            expect(() => container.removeProvidersFor('nonExistent')).not.toThrow();
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

            expect(() => container.resolve('test')).toThrow('No provider found for fw24.di.token:test');

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
                providers: [{ provide: 'nestedDep', useValue: 'nestedValue' }],
                exports: ['nestedDep'],
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

            expect(() => container.resolve('test')).toThrow('No provider found for fw24.di.token:test');

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

            const module = container.module(TestModule);

            @Injectable({providedIn: TestModule})
            class TestClass {}

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

            const childContainer1 = container.createChildContainer('child1');
            const childContainer2 = container.createChildContainer('child2');

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

            container.register({ useClass: DynamicConditionService, provide: token, condition: conditionFn });

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

            container.register({ useFactory: factory, provide: token });

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
            const childContainer = container.createChildContainer('child');
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

            const childContainer1 = container.createChildContainer('child1');
            const childContainer2 = container.createChildContainer('child2');

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

            container.register({ useFactory: factory, provide: token });

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

            expect(() => container.resolve<MiddlewareService>('MiddlewareService')).toThrow('Middleware error');
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

    describe('Config resolveConfig', () => {
        let rootContainer: DIContainer;
        let childContainer: DIContainer;

        beforeEach(() => {
            rootContainer = new DIContainer(undefined, 'ROOT');
            childContainer = rootContainer.createChildContainer('CHILD');
        });

        it('should register and resolve configuration from the root container', () => {
            const configProvider: ConfigProviderOptions = {
                provide: 'app.name',
                useConfig: 'TestApp',
                priority: 1,
            };

            rootContainer.registerConfigProvider(configProvider);

            const resolvedConfig = rootContainer.resolveConfig('app.name');
            expect(resolvedConfig).toBe('TestApp');
        });

        it('should merge and resolve configurations from parent and child containers', () => {
            const rootConfigProvider: ConfigProviderOptions = {
                provide: 'app',
                useConfig: { name: 'TestApp', version: '1.0' },
                priority: 1,
            };

            const childConfigProvider: ConfigProviderOptions = {
                provide: 'app',
                useConfig: { version: '2.0' },
                priority: 1,
            };

            rootContainer.registerConfigProvider(rootConfigProvider);
            childContainer.registerConfigProvider(childConfigProvider);

            const resolvedConfig = childContainer.resolveConfig('app');
            expect(resolvedConfig).toEqual({ name: 'TestApp', version: '2.0' });
        });

        it('should respect priority when resolving configuration', () => {
            const lowPriorityConfig: ConfigProviderOptions = {
                provide: 'app.name',
                useConfig: 'LowPriorityApp',
                priority: 1,
            };

            const highPriorityConfig: ConfigProviderOptions = {
                provide: 'app.name',
                useConfig: 'HighPriorityApp',
                priority: 2,
            };

            rootContainer.registerConfigProvider(lowPriorityConfig);
            rootContainer.registerConfigProvider(highPriorityConfig);

            const resolvedConfig = rootContainer.resolveConfig('app.name');
            expect(resolvedConfig).toBe('HighPriorityApp');
        });

        it('should filter configurations based on tags', () => {
            const configWithTag: ConfigProviderOptions = {
                provide: 'app.name',
                useConfig: 'TaggedApp',
                tags: ['release'],
            };

            const configWithoutTag: ConfigProviderOptions = {
                provide: 'app.name',
                useConfig: 'UntaggedApp',
            };

            rootContainer.registerConfigProvider(configWithTag);
            rootContainer.registerConfigProvider(configWithoutTag);

            const resolvedConfigWithTags = rootContainer.resolveConfig('app.name', {
                tags: ['release'],
            });
            expect(resolvedConfigWithTags).toBe('TaggedApp');

        });

        it('should throw for non-existent configuration paths', () => {
            expect(() => rootContainer.resolveConfig('non.existent.path')).toThrow();
        });
    });


    describe('DI Container Self Injection', () => {
        let rootContainer: DIContainer;

        beforeEach(() => {
            rootContainer = new DIContainer(undefined, 'ROOT');
        });

        @Injectable()
        class ServiceWithContainer {
            constructor(
                @InjectContainer() private container: DIContainer
            ) {}

            getContainerIdentifier(): string {
                return this.container.containerId;
            }
        }

        // Another mock service class to test dependency resolution
        @Injectable()
        class AnotherService {
            getValue(): string {
                return 'Hello from AnotherService';
            }
        }

        // Service class that depends on another service and the container
        @Injectable()
        class ServiceWithDependencies {
            constructor(
                @Inject(AnotherService) private anotherService: AnotherService,
                @InjectContainer() private container: DIContainer
            ) {}

            getServiceValue(): string {
                return this.anotherService.getValue();
            }

            getContainerIdentifier(): string {
                return this.container.containerId;
            }
        }

         @Injectable()
        class ServiceWithPropertyDependencies {
            @InjectContainer() 
            private container?: DIContainer

            constructor(
                @Inject(AnotherService) private anotherService: AnotherService,
            ) {}

            getServiceValue(): string {
                return this.anotherService.getValue();
            }

            getContainerIdentifier() {
                return this.container?.containerId;
            }
        }

        it('should inject DIContainer into a service', () => {
            rootContainer.register({ provide: ServiceWithContainer, useClass: ServiceWithContainer });
            const serviceInstance = rootContainer.resolve(ServiceWithContainer);

            expect(serviceInstance).toBeInstanceOf(ServiceWithContainer);
            expect(serviceInstance?.getContainerIdentifier()).toBe('ROOT');
        });

        it('should resolve dependencies and inject DIContainer', () => {
            rootContainer.register({ provide: AnotherService, useClass: AnotherService });
            rootContainer.register({ provide: ServiceWithDependencies, useClass: ServiceWithDependencies });

            const serviceInstance = rootContainer.resolve(ServiceWithDependencies);

            expect(serviceInstance).toBeInstanceOf(ServiceWithDependencies);
            expect(serviceInstance?.getServiceValue()).toBe('Hello from AnotherService');
            expect(serviceInstance?.getContainerIdentifier()).toBe('ROOT');
        });

        it('should resolve dependencies and inject DIContainer as property injection', () => {
            rootContainer.register({ provide: AnotherService, useClass: AnotherService });
            rootContainer.register({ provide: ServiceWithPropertyDependencies, useClass: ServiceWithPropertyDependencies });

            const serviceInstance = rootContainer.resolve(ServiceWithPropertyDependencies);

            expect(serviceInstance).toBeInstanceOf(ServiceWithPropertyDependencies);
            expect(serviceInstance?.getServiceValue()).toBe('Hello from AnotherService');
            expect(serviceInstance?.getContainerIdentifier()).toBe('ROOT');
        });

        it('should inject DIContainer into a service with child container', () => {
            const childContainer = rootContainer.createChildContainer('CHILD');
            childContainer.register({ provide: ServiceWithContainer, useClass: ServiceWithContainer });

            const serviceInstance = childContainer.resolve(ServiceWithContainer);

            expect(serviceInstance).toBeInstanceOf(ServiceWithContainer);
            expect(serviceInstance?.getContainerIdentifier()).toBe('CHILD');
        });

        it('should resolve from child container and inject DIContainer', () => {
            const childContainer = rootContainer.createChildContainer('CHILD');
            childContainer.register({ provide: AnotherService, useClass: AnotherService });
            childContainer.register({ provide: ServiceWithDependencies, useClass: ServiceWithDependencies });

            const serviceInstance = childContainer.resolve(ServiceWithDependencies);

            expect(serviceInstance).toBeInstanceOf(ServiceWithDependencies);
            expect(serviceInstance?.getServiceValue()).toBe('Hello from AnotherService');
            expect(serviceInstance?.getContainerIdentifier()).toBe('CHILD');
        });

        it('should resolve from child container and inject DIContainer as property injection', () => {
            const childContainer = rootContainer.createChildContainer('CHILD');
            childContainer.register({ provide: AnotherService, useClass: AnotherService });
            childContainer.register({ provide: ServiceWithPropertyDependencies, useClass: ServiceWithPropertyDependencies });

            const serviceInstance = childContainer.resolve(ServiceWithPropertyDependencies);

            expect(serviceInstance).toBeInstanceOf(ServiceWithPropertyDependencies);
            expect(serviceInstance?.getServiceValue()).toBe('Hello from AnotherService');
            expect(serviceInstance?.getContainerIdentifier()).toBe('CHILD');
        });
    });

    describe('Config Injection via Decorator', () => {
        let rootContainer: DIContainer;
        let childContainer: DIContainer;

        // Mock service class that requires configuration injection
        @Injectable()
        class ServiceWithConfig {
            constructor(
                @InjectConfig('app.name') private appName: string,
                @InjectConfig('app.version') private appVersion: string
            ) {}

            getAppDetails(): string {
                return `App: ${this.appName}, Version: ${this.appVersion}`;
            }
        }

        // Another service with configuration injected via property
        @Injectable()
        class ServiceWithPropertyConfig {
            @InjectConfig('app.name')
            private appName!: string;

            @InjectConfig('app.version')
            private appVersion!: string;

            getAppDetails(): string {
                return `App: ${this.appName}, Version: ${this.appVersion}`;
            }
        }

        beforeEach(() => {
            rootContainer = new DIContainer(undefined, 'ROOT');
            childContainer = rootContainer.createChildContainer('CHILD');
        });

        it('should inject configuration into a service via constructor', () => {
            rootContainer.registerConfigProvider({
                provide: 'app',
                useConfig: { name: 'TestApp', version: '1.0' }
            });

            rootContainer.register({ provide: ServiceWithConfig, useClass: ServiceWithConfig });
            const serviceInstance = rootContainer.resolve(ServiceWithConfig);

            expect(serviceInstance).toBeInstanceOf(ServiceWithConfig);
            expect(serviceInstance?.getAppDetails()).toBe('App: TestApp, Version: 1.0');
        });

        it('should inject configuration into a service via properties', () => {
            rootContainer.registerConfigProvider({
                provide: 'app',
                useConfig: { name: 'TestApp', version: '1.0' }
            });

            rootContainer.register({ provide: ServiceWithPropertyConfig, useClass: ServiceWithPropertyConfig });
            const serviceInstance = rootContainer.resolve(ServiceWithPropertyConfig);

            expect(serviceInstance).toBeInstanceOf(ServiceWithPropertyConfig);
            expect(serviceInstance?.getAppDetails()).toBe('App: TestApp, Version: 1.0');
        });

        it('should merge configurations from parent and child containers and inject', () => {
            rootContainer.registerConfigProvider({
                provide: 'app',
                useConfig: { name: 'TestApp', version: '1.0' }
            });

            childContainer.registerConfigProvider({
                provide: 'app',
                useConfig: { version: '2.0' }
            });

            childContainer.register({ provide: ServiceWithConfig, useClass: ServiceWithConfig });
            const serviceInstance = childContainer.resolve(ServiceWithConfig);

            expect(serviceInstance).toBeInstanceOf(ServiceWithConfig);
            expect(serviceInstance?.getAppDetails()).toBe('App: TestApp, Version: 2.0');
        });

        it('should respect priority when injecting configuration', () => {
            rootContainer.registerConfigProvider({
                provide: 'app',
                useConfig: {
                    name: 'LowPriorityApp',
                    version: '1.0'
                },
                priority: 1
            });

            rootContainer.registerConfigProvider({
                provide: 'app.name',
                useConfig: 'HighPriorityApp',
                priority: 2
            });

            rootContainer.register({ provide: ServiceWithConfig, useClass: ServiceWithConfig });
            const serviceInstance = rootContainer.resolve(ServiceWithConfig);

            expect(serviceInstance).toBeInstanceOf(ServiceWithConfig);
            expect(serviceInstance?.getAppDetails()).toContain('HighPriorityApp');
        });

        it('should filter configurations based on tags and inject', () => {

            rootContainer.registerConfigProvider({
                provide: 'app',
                useConfig: {
                    version: '1.0---'
                },
            });

            rootContainer.registerConfigProvider({
                provide: 'app.name',
                useConfig: 'TaggedApp',
                tags: ['release']
            });

            rootContainer.registerConfigProvider({
                provide: 'app.name',
                useConfig: 'UntaggedApp'
            });

            rootContainer.register({ provide: ServiceWithConfig, useClass: ServiceWithConfig, tags: ['release'] });
            const serviceInstance = rootContainer.resolve(ServiceWithConfig, { tags: ['release'] });

            expect(serviceInstance).toBeInstanceOf(ServiceWithConfig);
            expect(serviceInstance?.getAppDetails()).toContain('TaggedApp');
        });

        it('should throw an error for non-existent configuration paths during injection', () => {
            rootContainer.register({ provide: ServiceWithConfig, useClass: ServiceWithConfig });
            expect(() => rootContainer.resolve(ServiceWithConfig)).toThrow();
        });
    });

    describe('Module Exports and Imports', () => {
        it('resolves exported dependencies from imported modules', () => {
            class ModuleA {}
            class ModuleB {}

            @container.Injectable()
            class ServiceA {}

            @container.Injectable()
            class ServiceB {
                constructor(@Inject(ServiceA) public serviceA: ServiceA) {}
            }

            registerModuleMetadata(ModuleA, {
                providers: [{ provide: ServiceA, useClass: ServiceA }],
                exports: [ServiceA]
            });

            registerModuleMetadata(ModuleB, {
                imports: [ModuleA],
                providers: [{ provide: ServiceB, useClass: ServiceB }]
            });

            container.module(ModuleB);

            const instanceB = container.resolve<ServiceB>(ServiceB);
            expect(instanceB).toBeInstanceOf(ServiceB);
            expect(instanceB.serviceA).toBeInstanceOf(ServiceA);
        });

        it('imports a module with no exports without errors', () => {
            class ModuleWithNoExports {}

            registerModuleMetadata(ModuleWithNoExports, {
                providers: [{ provide: 'service', useValue: 'test' }],
                exports: []
            });

            expect(() => container.module(ModuleWithNoExports)).not.toThrow();
        });

        it('resolves overlapping exports from multiple modules correctly', () => {
            class ModuleA {}
            class ModuleB {}

            @container.Injectable()
            class ServiceA {
                getMessage() {
                    return 'from A';
                }
            }

            @container.Injectable()
            class ServiceB {
                getMessage() {
                    return 'from B';
                }
            }

            registerModuleMetadata(ModuleA, {
                providers: [{ provide: 'shared', useClass: ServiceA }],
                exports: ['shared']
            });

            registerModuleMetadata(ModuleB, {
                providers: [{ provide: 'shared', useClass: ServiceB, priority: 1 }],
                exports: ['shared']
            });

            container.module(ModuleA);
            container.module(ModuleB);

            const instance = container.resolve<any>('shared');
            expect(instance.getMessage()).toBe('from B'); // Assumes ModuleB was registered after ModuleA
        });

        it('correctly resolves providers from nested module exports', () => {
            class GrandchildModule {}
            class ChildModule {}
            class ParentModule {}

            @container.Injectable()
            class GrandchildService {
                getValue() {
                    return 'grandchild';
                }
            }

            registerModuleMetadata(GrandchildModule, {
                providers: [{ provide: 'grandchild', useClass: GrandchildService }],
                exports: ['grandchild']
            });

            registerModuleMetadata(ChildModule, {
                imports: [GrandchildModule],
                exports: ['grandchild']
            });

            registerModuleMetadata(ParentModule, {
                imports: [ChildModule],
                exports: ['grandchild']
            });

            container.module(ParentModule);

            const instance = container.resolve<GrandchildService>('grandchild');
            expect(instance).toBeInstanceOf(GrandchildService);
            expect(instance.getValue()).toBe('grandchild');
        });
    });


});
