import { DIContainer } from './di-container';
import { makeDIToken } from './utils';


describe('DIContainer', () => {
    
    describe('register', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;
        
        beforeEach(() => {
            container.clear();
        });

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
            expect(container['providers'].has(token)).toBe(true);
        });

        it('should register a value with useValue', () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', name: token.toString() });
            expect(container['providers'].has(token)).toBe(true);
        });

        it('should not register if condition is false', () => {
            const token = makeDIToken<string>('TestCondition');
            container.register({ useValue: 'test', condition: () => false, name: token.toString() });
            expect(container['providers'].has(token)).toBe(false);
        });
    });

    describe('resolve', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

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

        it('should throw an error if no provider found', () => {
            const token = makeDIToken<string>('NonExistent');
            expect(() => container.resolve(token)).toThrowError('No provider found for Symbol(fw24.di.token:NonExistent)');
        });

        it('should handle circular dependencies', async () => {
            class ClassA {
                constructor(@Inject('ClassB') public b: any) {}
            }

            class ClassB {
                constructor(@Inject('ClassA') public a: any) {}
            }

            container.register({ useClass: ClassA, name: 'ClassA' });
            container.register({ useClass: ClassB, name: 'ClassB' });

            const instanceA = container.resolve<ClassA>('ClassA');
            const instanceB = container.resolve<ClassB>('ClassB');

            expect(instanceA).toBeInstanceOf(ClassA);
            expect(instanceB).toBeInstanceOf(ClassB);
            expect(instanceA.b).toBeInstanceOf(ClassB);
            expect(instanceB.a).toBeInstanceOf(ClassA);
        });

        it('should call @OnInit method after resolving', async () => {
            const onInitSpy = jest.fn();

            @Injectable()
            class TestClass {
                @OnInit()
                onInit() {
                    onInitSpy();
                }
            }

            const token = makeDIToken<TestClass>('TestClass');
            container.register({ useClass: TestClass, name: token.toString() });

            const instance = await container.resolve(token);

            expect(instance).toBeInstanceOf(TestClass);
            expect(onInitSpy).toHaveBeenCalled();
        });
    });

    describe('property injection', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should inject properties using @Inject', async () => {
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

        it('should handle optional property injection', async () => {
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

    describe('multiple dependency injection', () => {

        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should inject multiple dependencies', async () => {
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

            container.register({ useClass: DependencyA, name: DependencyA.name });
            container.register({ useClass: DependencyB, name: DependencyB.name });
            container.register({ useClass: TestClass, name: TestClass.name });

            const instance = await container.resolve<TestClass>(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.dependencyA).toBeInstanceOf(DependencyA);
            expect(instance.dependencyB).toBeInstanceOf(DependencyB);
        });
    });

    describe('optional constructor parameter injection', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should handle optional constructor parameter injection', async () => {
            @Injectable()
            class TestClass {
                constructor(
                    @Inject('OptionalDependency', { isOptional: true }) public optionalDependency?: any
                ) {}
            }

            container.register({ useClass: TestClass, name: TestClass.name });

            const instance = await container.resolve<TestClass>(TestClass);

            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.optionalDependency).toBeUndefined();
        });
    });

    describe('singleton behavior', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should reuse singleton instances', async () => {
            @Injectable({ singleton: true })
            class TestClass {}

            container.register({ useClass: TestClass, name: TestClass.name });

            const instance1 = await container.resolve<TestClass>(TestClass);
            const instance2 = await container.resolve<TestClass>(TestClass);

            expect(instance1).toBeInstanceOf(TestClass);
            expect(instance2).toBeInstanceOf(TestClass);
            expect(instance1).toBe(instance2);
        });
    });

    describe('conditionally registered providers', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should not register a provider if condition is false', () => {
            const token = makeDIToken<string>('ConditionalService');

            @Injectable({ condition: () => false })
            class ConditionalService {}

            expect(container.has(token)).toBe(false);
        });

        it('should register a provider if condition is true', () => {
            const token = makeDIToken<string>('ConditionalService');

            @Injectable({ condition: () => true })
            class ConditionalService {}

            container.register({ useClass: ConditionalService, name: token.toString() });

            expect(container.has(token)).toBe(true);
        });
    });

    describe('async resolve', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should resolve a class asynchronously', async () => {
            @Injectable()
            class TestClass {}

            const token = makeDIToken<TestClass>('TestClass');
            container.register({ useClass: TestClass, name: token.toString() });

            const instance = await container.resolveAsync(token);
            expect(instance).toBeInstanceOf(TestClass);
        });

        it('should resolve a factory asynchronously', async () => {
            const token = makeDIToken<string>('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, name: token.toString() });

            const instance = await container.resolveAsync(token);
            expect(instance).toBe('test');
        });

        it('should resolve a value asynchronously', async () => {
            const token = makeDIToken<string>('TestValue');
            container.register({ useValue: 'test', name: token.toString() });

            const instance = await container.resolveAsync(token);
            expect(instance).toBe('test');
        });

        it('should handle circular dependencies asynchronously', async () => {
            @Injectable()
            class ClassA {
                constructor(@Inject('ClassB') public b: any) {}
            }

            @Injectable()
            class ClassB {
                constructor(@Inject('ClassA') public a: any) {}
            }

            container.register({ useClass: ClassA, name: 'ClassA' });
            container.register({ useClass: ClassB, name: 'ClassB' });

            const instanceA = await container.resolveAsync<ClassA>('ClassA');
            const instanceB = await container.resolveAsync<ClassB>('ClassB');

            expect(instanceA).toBeInstanceOf(ClassA);
            expect(instanceB).toBeInstanceOf(ClassB);
            expect(instanceA.b).toBeInstanceOf(ClassB);
            expect(instanceB.a).toBeInstanceOf(ClassA);
        });

        it('should handle optional property injection asynchronously', async () => {
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

    describe('clear', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should clear all providers and cache', () => {
            @Injectable()
            class TestClass {}

            container.register({ useClass: TestClass, name: TestClass.name });
            expect(container.has(TestClass)).toBe(true);

            container.clear();
            expect(container.has(TestClass)).toBe(false);
            expect((container as any).cache.size).toBe(0);
        });
    });

    describe('error handling', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should throw an error when registering an invalid provider', () => {
            expect(() => {
                container.register({ useClass: null as any, name: 'InvalidProvider' });
            }).toThrow();
        });

        it('should throw an error when resolving an invalid provider', () => {
            const token = makeDIToken<string>('InvalidProvider');
            expect(() => container.resolve(token)).toThrow();
        });
    });

    describe('inheritance', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should inject dependencies in a derived class', async () => {
            @Injectable()
            class BaseService {}

            @Injectable()
            class DerivedService extends BaseService {
                constructor(@Inject(BaseService) public baseService: BaseService) {
                    super();
                }
            }

            container.register({ useClass: BaseService, name: BaseService.name });
            container.register({ useClass: DerivedService, name: DerivedService.name });

            const instance = await container.resolve<DerivedService>(DerivedService);

            expect(instance).toBeInstanceOf(DerivedService);
            expect(instance.baseService).toBeInstanceOf(BaseService);
        });
    });

    describe('lifecycle hooks', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should call @OnInit method for each instance', async () => {
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

    describe('re-registration', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should update provider when re-registered', async () => {
            class OriginalService {}

            class UpdatedService {}

            const token = makeDIToken<OriginalService>('Service');
            container.register({ useClass: OriginalService, name: token.toString() });

            let instance = container.resolve(token);
            expect(instance).toBeInstanceOf(OriginalService);
            container.register({ useClass: UpdatedService, name: token.toString() });

            instance = container.resolve(token);
            expect(instance).toBeInstanceOf(UpdatedService);
        });
    });

    describe('complex dependency graphs', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        it('should resolve complex dependency graphs', async () => {
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

            container.register({ useClass: ServiceA, name: ServiceA.name });
            container.register({ useClass: ServiceB, name: ServiceB.name });
            container.register({ useClass: ServiceC, name: ServiceC.name });
            container.register({ useClass: ServiceD, name: ServiceD.name });

            const instance = await container.resolve<ServiceD>(ServiceD);

            expect(instance).toBeInstanceOf(ServiceD);
            expect(instance.c).toBeInstanceOf(ServiceC);
            expect(instance.c.b).toBeInstanceOf(ServiceB);
            expect(instance.c.b.a).toBeInstanceOf(ServiceA);
            expect(instance.a).toBeInstanceOf(ServiceA);
        });
    });

    describe('Child Containers', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        describe('inheritance', () => {
            it('should inherit providers from parent container', () => {
                @Injectable({name: 'ParentService'})
                class ParentService {}

                const childContainer = container.createChildContainer();
                const instance = childContainer.resolve<ParentService>('ParentService');

                expect(instance).toBeInstanceOf(ParentService);
            });

            it('should override providers in child container', () => {
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

                container.register({ useClass: ParentService, name: 'Service' });

                const childContainer = container.createChildContainer();
                childContainer.register({ useClass: ChildService, name: 'Service' });

                const instance = childContainer.resolve<ChildService>('Service');

                expect(instance).toBeInstanceOf(ChildService);
                expect(instance.getMessage()).toBe('child');
            });
        });

        describe('provider shadowing', () => {
            it('should shadow parent container providers', () => {
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

                container.register({ useClass: ParentService, name: 'Service' });

                const childContainer = container.createChildContainer();
                childContainer.register({ useClass: ChildService, name: 'Service' });

                const childInstance = childContainer.resolve<ChildService>('Service');
                const parentInstance = container.resolve<ParentService>('Service');

                expect(childInstance).toBeInstanceOf(ChildService);
                expect(childInstance.getMessage()).toBe('child');
                expect(parentInstance).toBeInstanceOf(ParentService);
                expect(parentInstance.getMessage()).toBe('parent');
            });
        });

        describe('adding providers to parent and root containers', () => {
            it('should add providers to parent container', () => {
                @Injectable()
                class ParentService {}

                @Injectable()
                class ChildService {}

                const childContainer = container.createChildContainer();
                childContainer.registerInParentContainer({ useClass: ParentService, name: 'ParentService' });

                const instance = container.resolve<ParentService>('ParentService');

                expect(instance).toBeInstanceOf(ParentService);
            });

            it('should add providers to root container', () => {
                @Injectable()
                class RootService {}

                const childContainer = container.createChildContainer();
                childContainer.registerInRootContainer({ useClass: RootService, name: 'RootService' });

                const instance = container.resolve<RootService>('RootService');

                expect(instance).toBeInstanceOf(RootService);
            });
        });

        describe('conditional resolution in child containers', () => {
            it('should conditionally register providers in child container', () => {
                @Injectable()
                class ParentService {}

                const childContainer = container.createChildContainer();
                childContainer.register({
                    useClass: ParentService,
                    name: 'ConditionalService',
                    condition: () => false
                });

                expect(() => childContainer.resolve('ConditionalService')).toThrow('No provider found for Symbol(fw24.di.token:ConditionalService)');
            });
        });

        describe('middleware support in child containers', () => {
            it('should apply middleware to child container resolutions', () => {
                const middlewareSpy = jest.fn((next) => next());
                
                const childContainer = container.createChildContainer();

                childContainer.useMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {}

                childContainer.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                const instance = childContainer.resolve<MiddlewareService>('MiddlewareService');
                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });

            it('should apply async middleware to child container resolutions', async () => {
                const middlewareSpy = jest.fn(async (next) => await next());
                const childContainer = container.createChildContainer();

                childContainer.useAsyncMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {}

                childContainer.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                const instance = await childContainer.resolveAsync<MiddlewareService>('MiddlewareService');
                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });
        });

        describe('property injection in child containers', () => {
            it('should inject properties using @Inject', async () => {
                @Injectable()
                class Dependency {}

                @Injectable()
                class TestClass {
                    @Inject(Dependency)
                    public dependency!: Dependency;
                }

                container.register({ useClass: Dependency, name: Dependency.name });
                container.register({ useClass: TestClass, name: TestClass.name });

                const instance = await container.resolve<TestClass>(TestClass);

                expect(instance).toBeInstanceOf(TestClass);
                expect(instance.dependency).toBeInstanceOf(Dependency);
            });

            it('should handle optional property injection', async () => {
                @Injectable()
                class TestClass {
                    @Inject('OptionalDependency', { isOptional: true })
                    public optionalDependency?: any;
                }

                container.register({ useClass: TestClass, name: TestClass.name });

                const instance = await container.resolve<TestClass>(TestClass);

                expect(instance).toBeInstanceOf(TestClass);
                expect(instance.optionalDependency).toBeUndefined();
            });

            it('should inject properties using @Inject in child container', async () => {
                @Injectable()
                class Dependency {}

                @Injectable()
                class TestClass {
                    @Inject(Dependency)
                    public dependency!: Dependency;
                }

                const childContainer = container.createChildContainer();
                childContainer.register({ useClass: Dependency, name: Dependency.name });
                childContainer.register({ useClass: TestClass, name: TestClass.name });
                const instance = childContainer.resolve<TestClass>(TestClass);

                expect(instance).toBeInstanceOf(TestClass);
                expect(instance.dependency).toBeInstanceOf(Dependency);
            });

            it('should handle optional property injection in child container', async () => {
                @Injectable()
                class TestClass {
                    @Inject('OptionalDependency', { isOptional: true })
                    public optionalDependency?: any;
                }

                const childContainer = container.createChildContainer();
                childContainer.register({ useClass: TestClass, name: TestClass.name });

                const instance = await childContainer.resolve<TestClass>(TestClass);

                expect(instance).toBeInstanceOf(TestClass);
                expect(instance.optionalDependency).toBeUndefined();
            });
        });
    });

    describe('Middlewares/Interceptors', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        describe('middleware', () => {

            const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

            beforeEach(() => {
                container.clear();
            });

            it('should apply middleware to resolutions', () => {
                const middlewareSpy = jest.fn((next) => {
                    console.log('Middleware before');
                    const result = next();
                    console.log('Middleware after');
                    return result;
                });

                container.useMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {}

                container.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                const instance = container.resolve<MiddlewareService>('MiddlewareService');

                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });

            it('should allow middleware to modify the result', () => {
                const middlewareSpy = jest.fn((next) => {
                    const result = next();

                    result.modified = true;
                    return result;
                });

                container.useMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {
                    value = 'original';
                }

                container.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                const instance = container.resolve<any>('MiddlewareService');

                expect(instance).toBeInstanceOf(MiddlewareService);
                expect(instance.modified).toBe(true);
            });

            it('should handle errors in middleware', () => {
                const middlewareSpy = jest.fn(() => {
                    throw new Error('Middleware error');
                });

                container.useMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {}

                container.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                expect(() => container.resolve<MiddlewareService>('MiddlewareService')).toThrowError('Middleware error');
            });
        });

        describe('async middleware', () => {
            it('should apply async middleware to resolutions', async () => {
                const middlewareSpy = jest.fn(async (next) => {
                    console.log('Async middleware before');
                    const result = await next();
                    console.log('Async middleware after');
                    return result;
                });

                container.useAsyncMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {}

                container.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                const instance = await container.resolveAsync<MiddlewareService>('MiddlewareService');

                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });

            it('should allow async middleware to modify the result', async () => {
                const middlewareSpy = jest.fn(async (next) => {
                    const result = await next();
                    result.modified = true;
                    return result;
                });

                container.useAsyncMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {
                    value = 'original';
                }

                container.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                const instance = await container.resolveAsync<any>('MiddlewareService');

                expect(instance).toBeInstanceOf(MiddlewareService);
                expect(instance.modified).toBe(true);
            });

            it('should handle errors in async middleware', async () => {
                const middlewareSpy = jest.fn(async () => {
                    throw new Error('Async middleware error');
                });

                container.useAsyncMiddleware({middleware: middlewareSpy});

                @Injectable()
                class MiddlewareService {}

                container.register({ useClass: MiddlewareService, name: 'MiddlewareService' });

                await expect(container.resolveAsync<MiddlewareService>('MiddlewareService')).rejects.toThrow('Async middleware error');
            });
        });
    });
    
    describe('Provider Priority Registration', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        class TestClassA {
            value: string = 'A';
        }

        class TestClassB {
            value: string = 'B';
        }

        test('should register a provider with higher priority', () => {
            container.register({
                name: 'test',
                useClass: TestClassA,
                priority: 1
            });

            const instance = container.resolve<TestClassA>('test');
            expect(instance.value).toBe('A');
        });

        test('should not override a provider with a higher priority', () => {
            container.register({
                name: 'test',
                useClass: TestClassA,
                priority: 2
            });

            container.register({
                name: 'test',
                useClass: TestClassB,
                priority: 1
            });

            const instance = container.resolve<TestClassA>('test');
            expect(instance.value).toBe('A'); // Should not override with lower priority
        });

        test('should override a provider with a lower priority', () => {
            container.register({
                name: 'test',
                useClass: TestClassA,
                priority: 1
            });

            container.register({
                name: 'test',
                useClass: TestClassB,
                priority: 2
            });

            const instance = container.resolve<TestClassB>('test');
            expect(instance.value).toBe('B'); // Should override with higher priority
        });

        test('should register a provider without priority and override if new one has priority', () => {
            container.register({
                name: 'test',
                useClass: TestClassA
            });

            container.register({
                name: 'test',
                useClass: TestClassB,
                priority: 1
            });

            const instance = container.resolve<TestClassB>('test');
            expect(instance.value).toBe('B'); // Should override since new provider has priority
        });

        test('should not register a provider with lower priority when one without priority exists', () => {
            container.register({
                name: 'test',
                useClass: TestClassA
            });
            
            container.register({
                name: 'test',
                useClass: TestClassB,
                priority: -1
            });

            const instance = container.resolve<TestClassA>('test');
            expect(instance.value).toBe('A'); // Should not override since existing provider has no priority
        });
    });

    describe('Optional Dependency Injection with Default Value', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        class TestClassA {
            value: string;
            constructor(value: string = 'A') {
                this.value = value;
            }
        }

        class DependentClass {
            constructor( 
                public dep: TestClassA
            ) {}
        }

        test('should inject dependency when provided', () => {
            
            container.register({
                name: 'dep',
                useClass: TestClassA
            });

            container.register({
                name: 'dependent',
                useClass: DependentClass
            });

            container.registerConstructorDependency(DependentClass, 0, 'dep', { 
                isOptional: true,
                defaultValue: new TestClassA('default'),
            });

            const instance = container.resolve<DependentClass>('dependent');
            expect(instance.dep.value).toBe('A');
        });

        test('should use default value when dependency is not provided', () => {
            container.register({
                name: 'dependent',
                useClass: DependentClass
            });

            container.registerConstructorDependency(DependentClass, 0, 'dep', { 
                isOptional: true,
                defaultValue: new TestClassA('default'),
            });

            const instance = container.resolve<DependentClass>('dependent');
            expect(instance.dep.value).toBe('default');
        });
    });

    describe('Middleware Execution Order Control', () => {
        const container = new DIContainer();
        const { Injectable, Inject, OnInit } = container;

        beforeEach(() => {
            container.clear();
        });

        class TestClassA {
            value: string;
            constructor(value: string = 'A') {
                this.value = value;
            }
        }

        test('should execute middlewares in specified order', () => {
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
                name: 'test',
                useClass: TestClassA
            });

            container.resolve<TestClassA>('test');
            expect(result).toEqual(['middleware0', 'middleware1', 'middleware2']);
        });

        test('should execute async middlewares in specified order', async () => {
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
                name: 'test',
                useClass: TestClassA
            });

            await container.resolveAsync<TestClassA>('test');
            expect(result).toEqual(['middleware0', 'middleware1', 'middleware2']);
        });
    });

    describe('Provider Removal', () => {

        const container = new DIContainer();

        beforeEach(() => {
            container.clear();
        });

        class TestClassA {
            value: string;
            constructor(value: string = 'A') {
                this.value = value;
            }
        }

        class TestClassB {
            value: string = 'B';
        }

        test('should remove a registered provider', () => {
            container.register({
                name: 'test',
                useClass: TestClassA
            });
            container.removeProvider('test');
            expect(() => container.resolve<TestClassA>('test')).toThrow();
        });

        test('should remove a provider from the cache', () => {
            container.register({
                name: 'test',
                useClass: TestClassA,
                singleton: true
            });

            const instance1 = container.resolve<TestClassA>('test');
            container.removeProvider('test');
            container.register({
                name: 'test',
                useClass: TestClassB
            });
            const instance2 = container.resolve<TestClassA>('test');

            expect(instance1.value).toBe('A');
            expect(instance2.value).toBe('B');
        });

        test('should handle removing non-existent provider gracefully', () => {
            expect(() => container.removeProvider('nonExistent')).not.toThrow();
        });
    });

});
