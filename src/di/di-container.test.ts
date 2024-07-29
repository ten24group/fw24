import { Injectable, Inject, OnInit } from './decorators';
import { DIContainer } from './di-container';
import { makeDIToken } from './utils';

const container = DIContainer.INSTANCE;

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
            container.register({ useValue: 'test', condition: () => false, name: token.toString() });
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

        it('should throw an error if no provider found', () => {
            const token = makeDIToken<string>('NonExistent');
            expect(() => container.resolve(token)).toThrowError('No provider found for Symbol(fw24.di.token:NonExistent)');
        });

        it('should handle circular dependencies', async () => {
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
    });

    describe('multiple dependency injection', () => {
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

});
