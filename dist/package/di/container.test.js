"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
const container_1 = require("./container");
const utils_1 = require("./utils");
const decorators_1 = require("./decorators");
const metadata_1 = require("./metadata");
describe('DIContainer', () => {
    let container;
    beforeEach(() => {
        container_1.DIContainer.DIMetadataStore.clearMetadata();
        container = new container_1.DIContainer();
    });
    describe('Registration', () => {
        it('registers a class with @Injectable()', () => {
            const { Injectable } = container;
            let TestClass = class TestClass {
            };
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            expect(container.has(TestClass)).toBe(true);
        });
        it('registers a factory with useFactory', () => {
            const token = (0, utils_1.makeDIToken)('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, provide: token });
            expect(container['providers'].has(token)).toBe(true);
        });
        it('registers a value with useValue', () => {
            const token = (0, utils_1.makeDIToken)('TestValue');
            container.register({ useValue: 'test', provide: token });
            expect(container['providers'].has(token)).toBe(true);
        });
        it('does not register if condition is false', () => {
            const token = (0, utils_1.makeDIToken)('TestCondition');
            container.register({ useValue: 'test', condition: () => false, provide: token });
            expect(container['providers'].has(token)).toBe(false);
        });
    });
    describe('Resolution', () => {
        it('resolves a class', async () => {
            const { Injectable } = container;
            let TestClass = class TestClass {
            };
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            const instance = await container.resolve(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
        });
        it('resolves a factory', async () => {
            const token = (0, utils_1.makeDIToken)('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, provide: token });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });
        it('resolves a value', async () => {
            const token = (0, utils_1.makeDIToken)('TestValue');
            container.register({ useValue: 'test', provide: token });
            const instance = await container.resolve(token);
            expect(instance).toBe('test');
        });
        it('throws an error if no provider is found', () => {
            const token = (0, utils_1.makeDIToken)('NonExistent');
            expect(() => container.resolve(token)).toThrow();
        });
        it('handles circular dependencies', async () => {
            const { Injectable } = container;
            let ClassA = class ClassA {
                b;
                constructor(b) {
                    this.b = b;
                }
            };
            ClassA = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)('ClassB'))
            ], ClassA);
            let ClassB = class ClassB {
                a;
                constructor(a) {
                    this.a = a;
                }
            };
            ClassB = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)('ClassA'))
            ], ClassB);
            const instanceA = container.resolve('ClassA');
            const instanceB = container.resolve('ClassB');
            expect(instanceA).toBeInstanceOf(ClassA);
            expect(instanceB).toBeInstanceOf(ClassB);
            expect(instanceA.b).toBeInstanceOf(ClassB);
            expect(instanceB.a).toBeInstanceOf(ClassA);
        });
        it('calls @OnInit method after resolving', async () => {
            const { Injectable } = container;
            const onInitSpy = jest.fn();
            let TestClass = class TestClass {
                onInit() {
                    onInitSpy();
                }
            };
            __decorate([
                (0, decorators_1.OnInit)()
            ], TestClass.prototype, "onInit", null);
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            const instance = await container.resolve(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
            expect(onInitSpy).toHaveBeenCalled();
        });
    });
    describe('Property Injection', () => {
        it('injects properties using @Inject', async () => {
            const { Injectable } = container;
            let Dependency = class Dependency {
            };
            Dependency = __decorate([
                Injectable()
            ], Dependency);
            let TestClass = class TestClass {
                dependency;
            };
            __decorate([
                (0, decorators_1.Inject)(Dependency)
            ], TestClass.prototype, "dependency", void 0);
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            const instance = container.resolve(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.dependency).toBeInstanceOf(Dependency);
        });
        it('handles optional property injection', async () => {
            const { Injectable } = container;
            let TestClass = class TestClass {
                optionalDependency;
            };
            __decorate([
                (0, decorators_1.Inject)('OptionalDependency', { isOptional: true })
            ], TestClass.prototype, "optionalDependency", void 0);
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            const instance = container.resolve(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.optionalDependency).toBeUndefined();
        });
    });
    describe('Multiple Dependency Injection', () => {
        it('injects multiple dependencies', async () => {
            const { Injectable } = container;
            let DependencyA = class DependencyA {
            };
            DependencyA = __decorate([
                Injectable()
            ], DependencyA);
            let DependencyB = class DependencyB {
            };
            DependencyB = __decorate([
                Injectable()
            ], DependencyB);
            let TestClass = class TestClass {
                dependencyA;
                dependencyB;
                constructor(dependencyA, dependencyB) {
                    this.dependencyA = dependencyA;
                    this.dependencyB = dependencyB;
                }
            };
            TestClass = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)(DependencyA)),
                __param(1, (0, decorators_1.Inject)(DependencyB))
            ], TestClass);
            const instance = await container.resolve(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.dependencyA).toBeInstanceOf(DependencyA);
            expect(instance.dependencyB).toBeInstanceOf(DependencyB);
        });
    });
    describe('Singleton Behavior', () => {
        it('reuses singleton instances', async () => {
            const { Injectable } = container;
            let TestClass = class TestClass {
            };
            TestClass = __decorate([
                Injectable({ singleton: true })
            ], TestClass);
            const instance1 = await container.resolve(TestClass);
            const instance2 = await container.resolve(TestClass);
            expect(instance1).toBeInstanceOf(TestClass);
            expect(instance2).toBeInstanceOf(TestClass);
            expect(instance1).toBe(instance2);
        });
    });
    describe('Conditional Registration', () => {
        it('does not register a provider if condition is false', () => {
            const { Injectable } = container;
            const token = (0, utils_1.makeDIToken)('ConditionalService');
            let ConditionalService = class ConditionalService {
            };
            ConditionalService = __decorate([
                Injectable({ condition: () => false })
            ], ConditionalService);
            expect(container.has(token)).toBe(false);
        });
        it('registers a provider if condition is true', () => {
            const { Injectable } = container;
            const token = (0, utils_1.makeDIToken)('ConditionalService');
            let ConditionalService = class ConditionalService {
            };
            ConditionalService = __decorate([
                Injectable({ condition: () => true })
            ], ConditionalService);
            expect(container.has(token)).toBe(true);
        });
    });
    describe('Async Resolve', () => {
        it('resolves a class asynchronously', async () => {
            const { Injectable } = container;
            let TestClass = class TestClass {
            };
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            const instance = await container.resolveAsync(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
        });
        it('resolves a factory asynchronously', async () => {
            const token = (0, utils_1.makeDIToken)('TestFactory');
            const factory = () => 'test';
            container.register({ useFactory: factory, provide: token });
            const instance = await container.resolveAsync(token);
            expect(instance).toBe('test');
        });
        it('resolves a value asynchronously', async () => {
            const token = (0, utils_1.makeDIToken)('TestValue');
            container.register({ useValue: 'test', provide: token });
            const instance = await container.resolveAsync(token);
            expect(instance).toBe('test');
        });
        it('handles circular dependencies asynchronously', async () => {
            const { Injectable } = container;
            let ClassA = class ClassA {
                b;
                constructor(b) {
                    this.b = b;
                }
            };
            ClassA = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)('ClassB'))
            ], ClassA);
            let ClassB = class ClassB {
                a;
                constructor(a) {
                    this.a = a;
                }
            };
            ClassB = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)('ClassA'))
            ], ClassB);
            const instanceA = await container.resolveAsync('ClassA');
            const instanceB = await container.resolveAsync('ClassB');
            expect(instanceA).toBeInstanceOf(ClassA);
            expect(instanceB).toBeInstanceOf(ClassB);
            expect(instanceA.b).toBeInstanceOf(ClassB);
            expect(instanceB.a).toBeInstanceOf(ClassA);
        });
        it('handles optional property injection asynchronously', async () => {
            const { Injectable } = container;
            let TestClass = class TestClass {
                optionalDependency;
            };
            __decorate([
                (0, decorators_1.Inject)('OptionalDependency', { isOptional: true })
            ], TestClass.prototype, "optionalDependency", void 0);
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            const instance = await container.resolveAsync(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.optionalDependency).toBeUndefined();
        });
    });
    describe('Clear Container', () => {
        it('clears all providers and cache', () => {
            const { Injectable } = container;
            let TestClass = class TestClass {
            };
            TestClass = __decorate([
                Injectable()
            ], TestClass);
            expect(container.has(TestClass)).toBe(true);
            container.clear();
            expect(container.has(TestClass)).toBe(false);
            expect(container.cache.size).toBe(0);
        });
    });
    describe('Error Handling', () => {
        it('throws an error when registering an invalid provider', () => {
            expect(() => {
                container.register({ useClass: null, provide: 'InvalidProvider' });
            }).toThrow();
        });
        it('throws an error when resolving an invalid provider', () => {
            const token = (0, utils_1.makeDIToken)('InvalidProvider');
            expect(() => container.resolve(token)).toThrow();
        });
    });
    describe('Inheritance', () => {
        it('injects dependencies in a derived class', async () => {
            const { Injectable } = container;
            let BaseService = class BaseService {
            };
            BaseService = __decorate([
                Injectable()
            ], BaseService);
            let DerivedService = class DerivedService extends BaseService {
                baseService;
                constructor(baseService) {
                    super();
                    this.baseService = baseService;
                }
            };
            DerivedService = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)(BaseService))
            ], DerivedService);
            const instance = await container.resolve(DerivedService);
            expect(instance).toBeInstanceOf(DerivedService);
            expect(instance.baseService).toBeInstanceOf(BaseService);
        });
    });
    describe('Lifecycle Hooks', () => {
        it('calls @OnInit method for each instance', async () => {
            const { Injectable } = container;
            const onInitSpy = jest.fn();
            let TestClass = class TestClass {
                onInit() {
                    onInitSpy();
                }
            };
            __decorate([
                (0, decorators_1.OnInit)()
            ], TestClass.prototype, "onInit", null);
            TestClass = __decorate([
                Injectable({ singleton: false })
            ], TestClass);
            const instance1 = container.resolve(TestClass);
            const instance2 = container.resolve(TestClass);
            expect(onInitSpy).toHaveBeenCalledTimes(2);
        });
    });
    describe('Re-registration', () => {
        it('updates provider when re-registered', async () => {
            const { Injectable } = container;
            let OriginalService = class OriginalService {
            };
            OriginalService = __decorate([
                Injectable()
            ], OriginalService);
            let UpdatedService = class UpdatedService {
            };
            UpdatedService = __decorate([
                Injectable()
            ], UpdatedService);
            const token = (0, utils_1.makeDIToken)('Service');
            container.register({ useClass: OriginalService, provide: token });
            let instance = container.resolve(token);
            expect(instance).toBeInstanceOf(OriginalService);
            container.register({ useClass: UpdatedService, provide: token, priority: 1 });
            instance = container.resolve(token);
            expect(instance).toBeInstanceOf(UpdatedService);
        });
    });
    describe('Complex Dependency Graphs', () => {
        it('resolves complex dependency graphs', async () => {
            const { Injectable } = container;
            let ServiceA = class ServiceA {
            };
            ServiceA = __decorate([
                Injectable()
            ], ServiceA);
            let ServiceB = class ServiceB {
                a;
                constructor(a) {
                    this.a = a;
                }
            };
            ServiceB = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)(ServiceA))
            ], ServiceB);
            let ServiceC = class ServiceC {
                b;
                constructor(b) {
                    this.b = b;
                }
            };
            ServiceC = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)(ServiceB))
            ], ServiceC);
            let ServiceD = class ServiceD {
                c;
                a;
                constructor(c, a) {
                    this.c = c;
                    this.a = a;
                }
            };
            ServiceD = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)(ServiceC)),
                __param(1, (0, decorators_1.Inject)(ServiceA))
            ], ServiceD);
            const instance = await container.resolve(ServiceD);
            expect(instance).toBeInstanceOf(ServiceD);
            expect(instance.c).toBeInstanceOf(ServiceC);
            expect(instance.c.b).toBeInstanceOf(ServiceB);
            expect(instance.c.b.a).toBeInstanceOf(ServiceA);
            expect(instance.a).toBeInstanceOf(ServiceA);
        });
    });
    describe('Child Containers', () => {
        let childContainer;
        beforeEach(() => {
            childContainer = container.createChildContainer('child');
            container_1.DIContainer.DIMetadataStore.clearMetadata();
        });
        describe('Inheritance', () => {
            it('inherits providers from parent container', () => {
                const { Injectable } = container;
                let ParentService = class ParentService {
                };
                ParentService = __decorate([
                    Injectable()
                ], ParentService);
                const instance = childContainer.resolve(ParentService);
                expect(instance).toBeInstanceOf(ParentService);
            });
            it('overrides providers in child container', () => {
                const { Injectable } = container;
                let ParentService = class ParentService {
                    getMessage() {
                        return 'parent';
                    }
                };
                ParentService = __decorate([
                    Injectable()
                ], ParentService);
                let ChildService = class ChildService {
                    getMessage() {
                        return 'child';
                    }
                };
                ChildService = __decorate([
                    Injectable()
                ], ChildService);
                childContainer.register({ useClass: ChildService, provide: 'Service' });
                const instance = childContainer.resolve('Service');
                expect(instance).toBeInstanceOf(ChildService);
                expect(instance.getMessage()).toBe('child');
            });
        });
        describe('Provider Shadowing', () => {
            it('shadows parent container providers', () => {
                let ParentService = class ParentService {
                    getMessage() {
                        return 'parent';
                    }
                };
                ParentService = __decorate([
                    container.Injectable({ 'provide': 'Service' })
                ], ParentService);
                let ChildService = class ChildService {
                    getMessage() {
                        return 'child';
                    }
                };
                ChildService = __decorate([
                    childContainer.Injectable({ provide: 'Service' })
                ], ChildService);
                const childInstance = childContainer.resolve('Service');
                const parentInstance = container.resolve('Service');
                expect(childInstance).toBeInstanceOf(ChildService);
                expect(childInstance.getMessage()).toBe('child');
                expect(parentInstance).toBeInstanceOf(ParentService);
                expect(parentInstance.getMessage()).toBe('parent');
            });
        });
        describe('Conditional Resolution in Child Containers', () => {
            it('conditionally registers providers in child container', () => {
                const { Injectable } = container;
                let ParentService = class ParentService {
                };
                ParentService = __decorate([
                    Injectable()
                ], ParentService);
                childContainer.register({
                    useClass: ParentService,
                    provide: 'ConditionalService',
                    condition: () => false
                });
                expect(() => childContainer.resolve('ConditionalService')).toThrow();
            });
        });
        describe('Middleware Support in Child Containers', () => {
            it('applies middleware to child container resolutions', () => {
                const middlewareSpy = jest.fn((next) => next());
                childContainer.useMiddleware({ middleware: middlewareSpy });
                const { Injectable } = container;
                let MiddlewareService = class MiddlewareService {
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                childContainer.register({ useClass: MiddlewareService, provide: 'MiddlewareService' });
                const instance = childContainer.resolve('MiddlewareService');
                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });
            it('applies async middleware to child container resolutions', async () => {
                const middlewareSpy = jest.fn(async (next) => await next());
                childContainer.useMiddlewareAsync({ middleware: middlewareSpy });
                const { Injectable } = container;
                let MiddlewareService = class MiddlewareService {
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                childContainer.register({ useClass: MiddlewareService, provide: 'MiddlewareService' });
                const instance = await childContainer.resolveAsync('MiddlewareService');
                expect(middlewareSpy).toHaveBeenCalled();
                expect(instance).toBeInstanceOf(MiddlewareService);
            });
        });
        describe('Property Injection in Child Containers', () => {
            it('injects properties using @Inject in child container', async () => {
                const { Injectable } = container;
                let Dependency = class Dependency {
                };
                Dependency = __decorate([
                    Injectable()
                ], Dependency);
                let TestClass = class TestClass {
                    dependency;
                };
                __decorate([
                    (0, decorators_1.Inject)(Dependency)
                ], TestClass.prototype, "dependency", void 0);
                TestClass = __decorate([
                    Injectable()
                ], TestClass);
                childContainer.register({ useClass: Dependency, provide: Dependency.name });
                childContainer.register({ useClass: TestClass, provide: TestClass.name });
                const instance = childContainer.resolve(TestClass);
                expect(instance).toBeInstanceOf(TestClass);
                expect(instance.dependency).toBeInstanceOf(Dependency);
            });
            it('handles optional property injection in child container', async () => {
                const { Injectable } = container;
                let TestClass = class TestClass {
                    optionalDependency;
                };
                __decorate([
                    (0, decorators_1.Inject)('OptionalDependency', { isOptional: true })
                ], TestClass.prototype, "optionalDependency", void 0);
                TestClass = __decorate([
                    Injectable()
                ], TestClass);
                childContainer.register({ useClass: TestClass, provide: TestClass.name });
                const instance = await childContainer.resolve(TestClass);
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
                let MiddlewareService = class MiddlewareService {
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                const instance = container.resolve('MiddlewareService');
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
                let MiddlewareService = class MiddlewareService {
                    value = 'original';
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                const instance = container.resolve('MiddlewareService');
                expect(instance).toBeInstanceOf(MiddlewareService);
                expect(instance.modified).toBe(true);
            });
            it('handles errors in middleware', () => {
                const middlewareSpy = jest.fn(() => {
                    throw new Error('Middleware error');
                });
                container.useMiddleware({ middleware: middlewareSpy });
                const { Injectable } = container;
                let MiddlewareService = class MiddlewareService {
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                expect(() => container.resolve('MiddlewareService'))
                    .toThrow('Middleware error');
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
                let MiddlewareService = class MiddlewareService {
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                const instance = await container.resolveAsync('MiddlewareService');
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
                let MiddlewareService = class MiddlewareService {
                    value = 'original';
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                const instance = await container.resolveAsync('MiddlewareService');
                expect(instance).toBeInstanceOf(MiddlewareService);
                expect(instance.modified).toBe(true);
            });
            it('handles errors in async middleware', async () => {
                const middlewareSpy = jest.fn(async () => {
                    throw new Error('Async middleware error');
                });
                container.useMiddlewareAsync({ middleware: middlewareSpy });
                const { Injectable } = container;
                let MiddlewareService = class MiddlewareService {
                };
                MiddlewareService = __decorate([
                    Injectable()
                ], MiddlewareService);
                await expect(container.resolveAsync('MiddlewareService')).rejects.toThrow('Async middleware error');
            });
        });
    });
    describe('Provider Priority Registration', () => {
        class TestClassA {
            value = 'A';
        }
        class TestClassB {
            value = 'B';
        }
        test('registers a provider with higher priority', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA,
                priority: 1
            });
            const instance = container.resolve('test');
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
            const instance = container.resolve('test');
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
            const instance = container.resolve('test');
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
            const instance = container.resolve('test');
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
            const instance = container.resolve('test');
            expect(instance.value).toBe('A'); // Should not override since existing provider has no priority
        });
    });
    describe('Optional Dependency Injection with Default Value', () => {
        class TestClassA {
            value;
            constructor(value = 'A') {
                this.value = value;
            }
        }
        class DependentClass {
            dep;
            constructor(dep) {
                this.dep = dep;
            }
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
            (0, metadata_1.registerConstructorDependency)(DependentClass, 0, 'dep', {
                isOptional: true,
                defaultValue: new TestClassA('default'),
            });
            const instance = container.resolve('dependent');
            expect(instance.dep.value).toBe('A');
        });
        test('uses default value when dependency is not provided', () => {
            container.register({
                provide: 'dependent',
                useClass: DependentClass
            });
            (0, metadata_1.registerConstructorDependency)(DependentClass, 0, 'dep', {
                isOptional: true,
                defaultValue: new TestClassA('default'),
            });
            const instance = container.resolve('dependent');
            expect(instance.dep.value).toBe('default');
        });
    });
    describe('Middleware Execution Order Control', () => {
        class TestClassA {
            value;
            constructor(value = 'A') {
                this.value = value;
            }
        }
        test('executes middlewares in specified order', () => {
            const result = [];
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
            container.resolve('test');
            expect(result).toEqual(['middleware0', 'middleware1', 'middleware2']);
        });
        test('executes async middlewares in specified order', async () => {
            const result = [];
            container.useMiddlewareAsync({
                middleware: async (next) => {
                    result.push('middleware1');
                    return next();
                },
                order: 0
            });
            container.useMiddlewareAsync({
                middleware: async (next) => {
                    result.push('middleware2');
                    return next();
                },
                order: 1
            });
            container.useMiddlewareAsync({
                middleware: async (next) => {
                    result.push('middleware0');
                    return next();
                },
                order: -1
            });
            container.register({
                provide: 'test',
                useClass: TestClassA
            });
            await container.resolveAsync('test');
            expect(result).toEqual(['middleware0', 'middleware1', 'middleware2']);
        });
    });
    describe('Provider Removal', () => {
        class TestClassA {
            value;
            constructor(value = 'A') {
                this.value = value;
            }
        }
        class TestClassB {
            value = 'B';
        }
        test('removes a registered provider', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA
            });
            container.removeProvidersFor('test');
            expect(() => container.resolve('test')).toThrow();
        });
        test('removes a provider from the cache', () => {
            container.register({
                provide: 'test',
                useClass: TestClassA,
                singleton: true
            });
            const instance1 = container.resolve('test');
            container.removeProvidersFor('test');
            container.register({
                provide: 'test',
                useClass: TestClassB
            });
            const instance2 = container.resolve('test');
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
            container_1.DIContainer.DIMetadataStore.clearMetadata();
        });
        it('registers a module', () => {
            const { Injectable } = container;
            class TestModule {
            }
            let TestClassA = class TestClassA {
            };
            TestClassA = __decorate([
                Injectable()
            ], TestClassA);
            (0, metadata_1.registerModuleMetadata)(TestModule, {
                providers: [
                    { useClass: TestClassA, provide: 'test' },
                    { useValue: 'test', provide: 'testValue' },
                    { useFactory: () => 'test', provide: 'testFactory' }
                ],
                exports: ['testValue']
            });
            const module = container.module(TestModule);
            const instance = container.resolve('testValue');
            expect(instance).toBe('test');
            expect(() => container.resolve('test')).toThrow();
            const instance2 = module.container.resolve('test');
            expect(instance2).toBeInstanceOf(TestClassA);
        });
        it('register a provider as a class reference', () => {
            class TestClass {
            }
            let TestClass2 = class TestClass2 {
                test;
                constructor(test) {
                    this.test = test;
                }
            };
            TestClass2 = __decorate([
                __param(0, (0, decorators_1.Inject)(TestClass))
            ], TestClass2);
            let TestModule = class TestModule {
            };
            TestModule = __decorate([
                (0, decorators_1.DIModule)({
                    providers: [TestClass, TestClass2],
                    exports: [TestClass]
                })
            ], TestModule);
            const { container: moduleContainer } = container.module(TestModule);
            const instance = moduleContainer.resolve(TestClass2);
            expect(instance).toBeInstanceOf(TestClass2);
            expect(instance.test).toBeInstanceOf(TestClass);
            const instance1 = container.resolve(TestClass);
            expect(instance1).toBeInstanceOf(TestClass);
        });
        it('imports an empty module without errors', () => {
            class TestModule {
            }
            (0, metadata_1.registerModuleMetadata)(TestModule, { imports: [], exports: [], providers: [] });
            const module = container.module(TestModule);
            expect(module).toBeDefined();
        });
        it('registers nested modules correctly', () => {
            class NestedModule {
            }
            class TestModule {
            }
            (0, metadata_1.registerModuleMetadata)(NestedModule, {
                imports: [],
                providers: [{ provide: 'nestedDep', useValue: 'nestedValue' }],
                exports: ['nestedDep'],
            });
            (0, metadata_1.registerModuleMetadata)(TestModule, {
                imports: [NestedModule],
                exports: ['nestedDep'],
                providers: []
            });
            container.module(TestModule);
            const resolvedValue = container.resolve('nestedDep');
            expect(resolvedValue).toBe('nestedValue');
        });
        it('throws an error if an export is not provided', () => {
            class TestModule {
            }
            (0, metadata_1.registerModuleMetadata)(TestModule, {
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
            container_1.DIContainer.DIMetadataStore.clearMetadata();
        });
        it('registers a module with @DIModule', () => {
            const { Injectable } = container;
            let TestClassA = class TestClassA {
            };
            TestClassA = __decorate([
                Injectable()
            ], TestClassA);
            let TestModule = class TestModule {
            };
            TestModule = __decorate([
                (0, decorators_1.DIModule)({
                    providers: [
                        { useClass: TestClassA, provide: 'test' },
                        { useValue: 'test', provide: 'testValue' },
                        { useFactory: () => 'test', provide: 'testFactory' }
                    ],
                    exports: ['testValue']
                })
            ], TestModule);
            const module = container.module(TestModule);
            const instance = container.resolve('testValue');
            expect(instance).toBe('test');
            expect(() => container.resolve('test')).toThrow();
            const instance2 = module.container.resolve('test');
            expect(instance2).toBeInstanceOf(TestClassA);
        });
        it('imports an empty module without errors', () => {
            let TestModule = class TestModule {
            };
            TestModule = __decorate([
                (0, decorators_1.DIModule)({ imports: [], exports: [], providers: [] })
            ], TestModule);
            const module = container.module(TestModule);
            expect(module).toBeDefined();
        });
        it('registers nested modules correctly', () => {
            let NestedModule = class NestedModule {
            };
            NestedModule = __decorate([
                (0, decorators_1.DIModule)({
                    imports: [],
                    exports: ['nestedDep'],
                    providers: [{ provide: 'nestedDep', useValue: 'nestedValue' }]
                })
            ], NestedModule);
            let TestModule = class TestModule {
            };
            TestModule = __decorate([
                (0, decorators_1.DIModule)({
                    imports: [NestedModule],
                    exports: ['nestedDep'],
                    providers: []
                })
            ], TestModule);
            container.module(TestModule);
            const resolvedValue = container.resolve('nestedDep');
            expect(resolvedValue).toBe('nestedValue');
        });
        it('throws an error if an export is not provided', () => {
            let TestModule = class TestModule {
            };
            TestModule = __decorate([
                (0, decorators_1.DIModule)({
                    imports: [],
                    exports: ['missingDep'],
                    providers: []
                })
            ], TestModule);
            expect(() => container.module(TestModule)).toThrow();
        });
        it('Make @Injectable register provider with specific module', () => {
            let TestModule = class TestModule {
            };
            TestModule = __decorate([
                (0, decorators_1.DIModule)({})
            ], TestModule);
            let TestClass = class TestClass {
            };
            TestClass = __decorate([
                (0, decorators_1.Injectable)({ providedIn: TestModule })
            ], TestClass);
            const module = container.module(TestModule);
            expect(module.container.resolve(TestClass)).toBeDefined();
        });
    });
    describe('DIContainer - hasChildContainerById', () => {
        let container;
        beforeEach(() => {
            container = new container_1.DIContainer();
            container_1.DIContainer.DIMetadataStore.clearMetadata();
        });
        it('should return true if a direct child container has the identifier', () => {
            const childContainer1 = container.createChildContainer('child1');
            const childContainer2 = container.createChildContainer('child2');
            expect(container.hasChildContainerById('child1')).toBe(true);
            expect(container.hasChildContainerById('child2')).toBe(true);
        });
        it('should return true if a nested child container has the identifier', () => {
            const childContainer1 = container.createChildContainer('child1');
            const nestedChildContainer = childContainer1.createChildContainer('nested-child1');
            expect(container.hasChildContainerById('nested-child1')).toBe(true);
        });
        it('should return false if no child container has the identifier', () => {
            const childContainer1 = container.createChildContainer('child1');
            expect(container.hasChildContainerById('non-existent')).toBe(false);
        });
        it('should return false if there are no child containers', () => {
            expect(container.hasChildContainerById('any-id')).toBe(false);
        });
        it('should return true if a nested child container has the identifier even if the direct child does not', () => {
            const childContainer1 = container.createChildContainer('child1');
            const nestedChildContainer = childContainer1.createChildContainer('nested-child1');
            expect(container.hasChildContainerById('nested-child1')).toBe(true);
            expect(container.hasChildContainerById('child1')).toBe(true);
            expect(container.hasChildContainerById('non-existent')).toBe(false);
        });
    });
    describe('Provider Registration without a `provide` Key', () => {
        it('should throw an error when registering a provider without a `provide` key', () => {
            class TestClass {
            }
            expect(() => {
                container.register({ useClass: TestClass });
            }).toThrow();
        });
    });
    describe('Scoped Provider Registration', () => {
        it('should create different instances for scoped providers in different child containers', () => {
            const { Injectable } = container;
            let ScopedService = class ScopedService {
            };
            ScopedService = __decorate([
                Injectable({ singleton: false })
            ], ScopedService);
            container.register({ useClass: ScopedService, provide: 'ScopedService', singleton: false });
            const childContainer1 = container.createChildContainer('child1');
            const childContainer2 = container.createChildContainer('child2');
            const instance1 = childContainer1.resolve('ScopedService');
            const instance2 = childContainer2.resolve('ScopedService');
            expect(instance1).toBeInstanceOf(ScopedService);
            expect(instance2).toBeInstanceOf(ScopedService);
            expect(instance1).not.toBe(instance2);
        });
    });
    describe('Provider Condition Function Evaluation', () => {
        it('should register provider based on dynamic runtime conditions', () => {
            const token = (0, utils_1.makeDIToken)('DynamicConditionService');
            const conditionFn = jest.fn(() => Math.random() > 0.5);
            let DynamicConditionService = class DynamicConditionService {
            };
            DynamicConditionService = __decorate([
                container.Injectable({ condition: conditionFn })
            ], DynamicConditionService);
            container.register({ useClass: DynamicConditionService, provide: token, condition: conditionFn });
            if (container.has(token)) {
                expect(container.resolve(token)).toBeInstanceOf(DynamicConditionService);
            }
            else {
                expect(() => container.resolve(token)).toThrow();
            }
            expect(conditionFn).toHaveBeenCalled();
        });
    });
    describe('Async Lifecycle Hooks', () => {
        it('should call async lifecycle hooks correctly', async () => {
            const onInitSpy = jest.fn().mockResolvedValue(true);
            let TestClass = class TestClass {
                async onInit() {
                    await onInitSpy();
                }
            };
            __decorate([
                (0, decorators_1.OnInit)()
            ], TestClass.prototype, "onInit", null);
            TestClass = __decorate([
                container.Injectable()
            ], TestClass);
            const instance = await container.resolveAsync(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
            expect(onInitSpy).toHaveBeenCalled();
        });
    });
    describe('Error Handling in Provider Factories', () => {
        it('should propagate errors from provider factory functions', () => {
            const token = (0, utils_1.makeDIToken)('ErrorFactory');
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
            let BaseService = class BaseService {
                getMessage() {
                    return 'base';
                }
            };
            BaseService = __decorate([
                Injectable()
            ], BaseService);
            let DerivedService = class DerivedService extends BaseService {
                getMessage() {
                    return 'derived';
                }
            };
            DerivedService = __decorate([
                Injectable()
            ], DerivedService);
            container.register({ useClass: BaseService, provide: BaseService.name });
            const childContainer = container.createChildContainer('child');
            childContainer.register({ useClass: DerivedService, provide: DerivedService.name });
            const baseInstance = childContainer.resolve(BaseService);
            const derivedInstance = childContainer.resolve(DerivedService);
            expect(baseInstance.getMessage()).toBe('base');
            expect(derivedInstance.getMessage()).toBe('derived');
        });
    });
    describe('Dynamic Provider Resolution', () => {
        it('should resolve providers dynamically based on runtime data', () => {
            let ConfigurableService = class ConfigurableService {
                config;
                constructor(config) {
                    this.config = config;
                }
            };
            ConfigurableService = __decorate([
                container.Injectable(),
                __param(0, (0, decorators_1.Inject)('Config'))
            ], ConfigurableService);
            const dynamicConfig = { setting: 'value' };
            container.register({ useValue: dynamicConfig, provide: 'Config' });
            const instance = container.resolve(ConfigurableService);
            expect(instance.config).toBe(dynamicConfig);
        });
    });
    describe('Singleton Behavior Across Child Containers', () => {
        it('should share singleton instances across child containers', () => {
            let SingletonService = class SingletonService {
            };
            SingletonService = __decorate([
                container.Injectable({ singleton: true })
            ], SingletonService);
            const childContainer1 = container.createChildContainer('child1');
            const childContainer2 = container.createChildContainer('child2');
            const instance1 = childContainer1.resolve(SingletonService);
            const instance2 = childContainer2.resolve(SingletonService);
            expect(instance1).toBe(instance2);
        });
    });
    describe('Circular Dependency Detection with More Complexity', () => {
        it('should handle circular dependencies involving more than two classes', () => {
            const { Injectable } = container;
            let ClassA = class ClassA {
                c;
                constructor(c) {
                    this.c = c;
                }
            };
            ClassA = __decorate([
                Injectable({ provide: 'ClassA' }),
                __param(0, (0, decorators_1.Inject)('ClassC'))
            ], ClassA);
            let ClassB = class ClassB {
                a;
                constructor(a) {
                    this.a = a;
                }
            };
            ClassB = __decorate([
                Injectable({ provide: 'ClassB' }),
                __param(0, (0, decorators_1.Inject)('ClassA'))
            ], ClassB);
            let ClassC = class ClassC {
                b;
                constructor(b) {
                    this.b = b;
                }
            };
            ClassC = __decorate([
                Injectable({ provide: 'ClassC' }),
                __param(0, (0, decorators_1.Inject)('ClassB'))
            ], ClassC);
            expect(container.resolve('ClassA')).toBeInstanceOf(ClassA);
        });
    });
    describe('Handling of Missing Optional Dependencies', () => {
        it('creates instances with default values for missing optional dependencies', () => {
            let TestClass = class TestClass {
                dep;
                constructor(dep) {
                    this.dep = dep;
                }
            };
            TestClass = __decorate([
                container.Injectable(),
                __param(0, (0, decorators_1.Inject)('OptionalDep', { isOptional: true, defaultValue: 'default' }))
            ], TestClass);
            const instance = container.resolve(TestClass);
            expect(instance).toBeInstanceOf(TestClass);
            expect(instance.dep).toBe('default');
        });
    });
    describe('Provider Replacement and Priority Edge Cases', () => {
        it('handles providers with the same priority correctly', () => {
            class TestClassA {
                value = 'A';
            }
            class TestClassB {
                value = 'B';
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
            const instance = container.resolve('test');
            expect(instance.value).toBe('A'); // The first registered provider should take precedence
        });
    });
    describe('Async Factory Functions', () => {
        it('resolves providers registered with async factory functions', async () => {
            const token = (0, utils_1.makeDIToken)('AsyncFactory');
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
            let MiddlewareService = class MiddlewareService {
            };
            MiddlewareService = __decorate([
                container.Injectable()
            ], MiddlewareService);
            const instance = container.resolve('MiddlewareService');
            expect(middlewareSpy).toHaveBeenCalled();
            expect(instance).toBe('short-circuited');
        });
        it('handles errors in middleware correctly', () => {
            const middlewareSpy = jest.fn(() => {
                throw new Error('Middleware error');
            });
            container.useMiddleware({ middleware: middlewareSpy });
            let MiddlewareService = class MiddlewareService {
            };
            MiddlewareService = __decorate([
                container.Injectable()
            ], MiddlewareService);
            expect(() => container.resolve('MiddlewareService')).toThrow('Middleware error');
        });
    });
    describe('Conditional Providers with Dependencies', () => {
        it('resolves conditional providers with dependencies correctly', () => {
            const token = (0, utils_1.makeDIToken)('ConditionalService');
            let Dependency = class Dependency {
            };
            Dependency = __decorate([
                container.Injectable()
            ], Dependency);
            let ConditionalService = class ConditionalService {
                dependency;
                constructor(dependency) {
                    this.dependency = dependency;
                }
            };
            ConditionalService = __decorate([
                container.Injectable({ condition: () => true }),
                __param(0, (0, decorators_1.Inject)(Dependency))
            ], ConditionalService);
            container.register({ useClass: Dependency, provide: Dependency.name });
            const instance = container.resolve('ConditionalService');
            expect(instance).toBeInstanceOf(ConditionalService);
            expect(instance.dependency).toBeInstanceOf(Dependency);
        });
    });
    describe('Async Error Handling', () => {
        it('handles errors in async lifecycle hooks', async () => {
            const onInitSpy = jest.fn().mockRejectedValue(new Error('Async init error'));
            let TestClass = class TestClass {
                async onInit() {
                    await onInitSpy();
                }
            };
            __decorate([
                (0, decorators_1.OnInit)()
            ], TestClass.prototype, "onInit", null);
            TestClass = __decorate([
                container.Injectable()
            ], TestClass);
            await expect(container.resolveAsync(TestClass)).rejects.toThrow('Async init error');
        });
    });
    describe('Complex Inheritance and Interface Implementations', () => {
        it('resolves classes implementing interfaces and extending other classes', () => {
            let BaseService = class BaseService {
                getServiceName() {
                    return 'BaseService';
                }
            };
            BaseService = __decorate([
                container.Injectable()
            ], BaseService);
            let DerivedService = class DerivedService extends BaseService {
                getServiceName() {
                    return 'DerivedService';
                }
            };
            DerivedService = __decorate([
                container.Injectable()
            ], DerivedService);
            const instance = container.resolve(DerivedService);
            expect(instance).toBeInstanceOf(DerivedService);
            expect(instance.getServiceName()).toBe('DerivedService');
        });
    });
    describe('Recursive Dependency Resolution', () => {
        it('resolves providers that depend on dynamically resolved providers', () => {
            const { Injectable } = container;
            let DynamicProvider = class DynamicProvider {
                getValue() {
                    return 'dynamic value';
                }
            };
            DynamicProvider = __decorate([
                Injectable()
            ], DynamicProvider);
            let TestClass = class TestClass {
                provider;
                constructor(provider) {
                    this.provider = provider;
                }
            };
            TestClass = __decorate([
                Injectable(),
                __param(0, (0, decorators_1.Inject)(DynamicProvider))
            ], TestClass);
            const instance = container.resolve(TestClass);
            expect(instance.provider.getValue()).toBe('dynamic value');
        });
    });
    describe('Lifecycle Hooks Order', () => {
        it('calls lifecycle hooks in the correct order', async () => {
            const onInitSpy1 = jest.fn();
            const onInitSpy2 = jest.fn();
            let FirstService = class FirstService {
                onInit() {
                    onInitSpy1();
                }
            };
            __decorate([
                (0, decorators_1.OnInit)()
            ], FirstService.prototype, "onInit", null);
            FirstService = __decorate([
                container.Injectable()
            ], FirstService);
            let SecondService = class SecondService {
                firstService;
                constructor(firstService) {
                    this.firstService = firstService;
                }
                onInit() {
                    onInitSpy2();
                }
            };
            __decorate([
                (0, decorators_1.OnInit)()
            ], SecondService.prototype, "onInit", null);
            SecondService = __decorate([
                container.Injectable(),
                __param(0, (0, decorators_1.Inject)(FirstService))
            ], SecondService);
            const instance = await container.resolveAsync(SecondService);
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
            let StatefulService = class StatefulService {
            };
            StatefulService = __decorate([
                container.Injectable({ singleton: false }) // Ensure each resolution creates a new instance            class StatefulService {}
            ], StatefulService);
            const instance1 = container.resolve('StatefulService');
            const instance2 = container.resolve('StatefulService');
            expect(instance1.state.counter).toBe(1);
            expect(instance2.state.counter).toBe(1); // Middleware creates new state for each resolution
            expect(middlewareSpy).toHaveBeenCalledTimes(2);
        });
    });
    describe('Config resolveConfig', () => {
        let rootContainer;
        let childContainer;
        beforeEach(() => {
            container_1.DIContainer.DIMetadataStore.clearMetadata();
            rootContainer = new container_1.DIContainer(undefined, 'ROOT');
            childContainer = rootContainer.createChildContainer('CHILD');
        });
        it('should register and resolve configuration from the root container', () => {
            const configProvider = {
                provide: 'app.name',
                useConfig: 'TestApp',
                priority: 1,
            };
            rootContainer.registerConfigProvider(configProvider);
            const resolvedConfig = rootContainer.resolveConfig('app.name');
            expect(resolvedConfig).toBe('TestApp');
        });
        it('should merge and resolve configurations from parent and child containers', () => {
            const rootConfigProvider = {
                provide: 'app',
                useConfig: { name: 'TestApp', version: '1.0' },
                priority: 1,
            };
            const childConfigProvider = {
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
            const lowPriorityConfig = {
                provide: 'app.name',
                useConfig: 'LowPriorityApp',
                priority: 1,
            };
            const highPriorityConfig = {
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
            const configWithTag = {
                provide: 'app.name',
                useConfig: 'TaggedApp',
                tags: ['release'],
            };
            const configWithoutTag = {
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
        it('should preserve arrays in configuration (not convert to objects)', () => {
            const configWithArrays = {
                provide: 'observability',
                useConfig: {
                    enabled: true,
                    backends: [
                        { type: 'cloudwatch', enabled: true },
                        { type: 'dynamodb', enabled: true }
                    ],
                    dataProtection: {
                        blacklistedKeys: ['password', 'secret', 'apiKey']
                    }
                },
                priority: 1,
            };
            rootContainer.registerConfigProvider(configWithArrays);
            const resolvedConfig = rootContainer.resolveConfig('observability');
            // Verify arrays are preserved as arrays, not converted to objects
            expect(Array.isArray(resolvedConfig.backends)).toBe(true);
            expect(resolvedConfig.backends).toHaveLength(2);
            expect(resolvedConfig.backends[0].type).toBe('cloudwatch');
            expect(resolvedConfig.backends[1].type).toBe('dynamodb');
            // Verify array methods work
            expect(resolvedConfig.backends.filter((b) => b.type === 'cloudwatch')).toHaveLength(1);
            expect(resolvedConfig.backends.map((b) => b.type)).toEqual(['cloudwatch', 'dynamodb']);
            // Verify nested arrays
            expect(Array.isArray(resolvedConfig.dataProtection.blacklistedKeys)).toBe(true);
            expect(resolvedConfig.dataProtection.blacklistedKeys).toContain('password');
            expect(resolvedConfig.dataProtection.blacklistedKeys.includes('secret')).toBe(true);
        });
        it('should preserve arrays when merging configs with different priorities', () => {
            // Framework default (priority 0)
            const frameworkConfig = {
                provide: 'observability',
                useConfig: {
                    enabled: false,
                    backends: [{ type: 'cloudwatch', enabled: true }],
                    serviceName: 'default-service'
                },
                priority: 0,
            };
            // App override (priority 10)
            const appConfig = {
                provide: 'observability',
                useConfig: {
                    enabled: true,
                    backends: [
                        { type: 'cloudwatch', enabled: true },
                        { type: 'dynamodb', enabled: true }
                    ],
                    serviceName: 'my-app'
                },
                priority: 10,
            };
            rootContainer.registerConfigProvider(frameworkConfig);
            rootContainer.registerConfigProvider(appConfig);
            const resolvedConfig = rootContainer.resolveConfig('observability');
            // Higher priority config should win
            expect(resolvedConfig.enabled).toBe(true);
            expect(resolvedConfig.serviceName).toBe('my-app');
            // Arrays should be preserved from the winning config
            expect(Array.isArray(resolvedConfig.backends)).toBe(true);
            expect(resolvedConfig.backends).toHaveLength(2);
        });
        it('should preserve empty arrays in configuration', () => {
            const configWithEmptyArray = {
                provide: 'test',
                useConfig: {
                    items: [],
                    nested: {
                        emptyList: []
                    }
                },
                priority: 1,
            };
            rootContainer.registerConfigProvider(configWithEmptyArray);
            const resolvedConfig = rootContainer.resolveConfig('test');
            expect(Array.isArray(resolvedConfig.items)).toBe(true);
            expect(resolvedConfig.items).toHaveLength(0);
            expect(Array.isArray(resolvedConfig.nested.emptyList)).toBe(true);
        });
        it('should preserve arrays of primitives', () => {
            const configWithPrimitiveArrays = {
                provide: 'test',
                useConfig: {
                    strings: ['a', 'b', 'c'],
                    numbers: [1, 2, 3],
                    mixed: ['a', 1, true, null]
                },
                priority: 1,
            };
            rootContainer.registerConfigProvider(configWithPrimitiveArrays);
            const resolvedConfig = rootContainer.resolveConfig('test');
            expect(resolvedConfig.strings).toEqual(['a', 'b', 'c']);
            expect(resolvedConfig.numbers).toEqual([1, 2, 3]);
            expect(resolvedConfig.mixed).toEqual(['a', 1, true, null]);
        });
    });
    describe('DI Container Self Injection', () => {
        let rootContainer;
        beforeEach(() => {
            rootContainer = new container_1.DIContainer(undefined, 'ROOT');
            container_1.DIContainer.DIMetadataStore.clearMetadata();
        });
        it('should inject DIContainer into a service', () => {
            let ServiceWithContainer = class ServiceWithContainer {
                container;
                constructor(container) {
                    this.container = container;
                }
                getContainerIdentifier() {
                    return this.container.containerId;
                }
            };
            ServiceWithContainer = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.InjectContainer)())
            ], ServiceWithContainer);
            rootContainer.register({ provide: ServiceWithContainer, useClass: ServiceWithContainer });
            const serviceInstance = rootContainer.resolve(ServiceWithContainer);
            expect(serviceInstance).toBeInstanceOf(ServiceWithContainer);
            expect(serviceInstance?.getContainerIdentifier()).toBe('ROOT');
        });
        it('should resolve dependencies and inject DIContainer', () => {
            // Another mock service class to test dependency resolution
            let AnotherService = class AnotherService {
                getValue() {
                    return 'Hello from AnotherService';
                }
            };
            AnotherService = __decorate([
                (0, decorators_1.Injectable)()
            ], AnotherService);
            // Service class that depends on another service and the container
            let ServiceWithDependencies = class ServiceWithDependencies {
                anotherService;
                container;
                constructor(anotherService, container) {
                    this.anotherService = anotherService;
                    this.container = container;
                }
                getServiceValue() {
                    return this.anotherService.getValue();
                }
                getContainerIdentifier() {
                    return this.container.containerId;
                }
            };
            ServiceWithDependencies = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.Inject)(AnotherService)),
                __param(1, (0, decorators_1.InjectContainer)())
            ], ServiceWithDependencies);
            rootContainer.register({ provide: AnotherService, useClass: AnotherService });
            rootContainer.register({ provide: ServiceWithDependencies, useClass: ServiceWithDependencies });
            const serviceInstance = rootContainer.resolve(ServiceWithDependencies);
            expect(serviceInstance).toBeInstanceOf(ServiceWithDependencies);
            expect(serviceInstance?.getServiceValue()).toBe('Hello from AnotherService');
            expect(serviceInstance?.getContainerIdentifier()).toBe('ROOT');
        });
        it('should resolve dependencies and inject DIContainer as property injection', () => {
            // Another mock service class to test dependency resolution
            let AnotherService = class AnotherService {
                getValue() {
                    return 'Hello from AnotherService';
                }
            };
            AnotherService = __decorate([
                (0, decorators_1.Injectable)()
            ], AnotherService);
            let ServiceWithPropertyDependencies = class ServiceWithPropertyDependencies {
                anotherService;
                container;
                constructor(anotherService) {
                    this.anotherService = anotherService;
                }
                getServiceValue() {
                    return this.anotherService.getValue();
                }
                getContainerIdentifier() {
                    return this.container?.containerId;
                }
            };
            __decorate([
                (0, decorators_1.InjectContainer)()
            ], ServiceWithPropertyDependencies.prototype, "container", void 0);
            ServiceWithPropertyDependencies = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.Inject)(AnotherService))
            ], ServiceWithPropertyDependencies);
            rootContainer.register({ provide: AnotherService, useClass: AnotherService });
            rootContainer.register({ provide: ServiceWithPropertyDependencies, useClass: ServiceWithPropertyDependencies });
            const serviceInstance = rootContainer.resolve(ServiceWithPropertyDependencies);
            expect(serviceInstance).toBeInstanceOf(ServiceWithPropertyDependencies);
            expect(serviceInstance?.getServiceValue()).toBe('Hello from AnotherService');
            expect(serviceInstance?.getContainerIdentifier()).toBe('ROOT');
        });
        it('should inject DIContainer into a service with child container', () => {
            let ServiceWithContainer = class ServiceWithContainer {
                container;
                constructor(container) {
                    this.container = container;
                }
                getContainerIdentifier() {
                    return this.container.containerId;
                }
            };
            ServiceWithContainer = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.InjectContainer)())
            ], ServiceWithContainer);
            const childContainer = rootContainer.createChildContainer('CHILD');
            childContainer.register({ provide: ServiceWithContainer, useClass: ServiceWithContainer });
            const serviceInstance = childContainer.resolve(ServiceWithContainer);
            expect(serviceInstance).toBeInstanceOf(ServiceWithContainer);
            expect(serviceInstance?.getContainerIdentifier()).toBe('CHILD');
        });
        it('should resolve from child container and inject DIContainer', () => {
            // Another mock service class to test dependency resolution
            let AnotherService = class AnotherService {
                getValue() {
                    return 'Hello from AnotherService';
                }
            };
            AnotherService = __decorate([
                (0, decorators_1.Injectable)()
            ], AnotherService);
            let ServiceWithDependencies = class ServiceWithDependencies {
                anotherService;
                container;
                constructor(anotherService, container) {
                    this.anotherService = anotherService;
                    this.container = container;
                }
                getServiceValue() {
                    return this.anotherService.getValue();
                }
                getContainerIdentifier() {
                    return this.container.containerId;
                }
            };
            ServiceWithDependencies = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.Inject)(AnotherService)),
                __param(1, (0, decorators_1.InjectContainer)())
            ], ServiceWithDependencies);
            const childContainer = rootContainer.createChildContainer('CHILD');
            childContainer.register({ provide: AnotherService, useClass: AnotherService });
            childContainer.register({ provide: ServiceWithDependencies, useClass: ServiceWithDependencies });
            const serviceInstance = childContainer.resolve(ServiceWithDependencies);
            expect(serviceInstance).toBeInstanceOf(ServiceWithDependencies);
            expect(serviceInstance?.getServiceValue()).toBe('Hello from AnotherService');
            expect(serviceInstance?.getContainerIdentifier()).toBe('CHILD');
        });
        it('should resolve from child container and inject DIContainer as property injection', () => {
            // Another mock service class to test dependency resolution
            let AnotherService = class AnotherService {
                getValue() {
                    return 'Hello from AnotherService';
                }
            };
            AnotherService = __decorate([
                (0, decorators_1.Injectable)()
            ], AnotherService);
            let ServiceWithPropertyDependencies = class ServiceWithPropertyDependencies {
                anotherService;
                container;
                constructor(anotherService) {
                    this.anotherService = anotherService;
                }
                getServiceValue() {
                    return this.anotherService.getValue();
                }
                getContainerIdentifier() {
                    return this.container?.containerId;
                }
            };
            __decorate([
                (0, decorators_1.InjectContainer)()
            ], ServiceWithPropertyDependencies.prototype, "container", void 0);
            ServiceWithPropertyDependencies = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.Inject)(AnotherService))
            ], ServiceWithPropertyDependencies);
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
        let rootContainer;
        let childContainer;
        beforeEach(() => {
            container_1.DIContainer.DIMetadataStore.clearMetadata();
            rootContainer = new container_1.DIContainer(undefined, 'ROOT');
            childContainer = rootContainer.createChildContainer('CHILD');
        });
        it('should inject configuration into a service via constructor', () => {
            rootContainer.registerConfigProvider({
                provide: 'app',
                useConfig: { name: 'TestApp', version: '1.0' }
            });
            // Mock service class that requires configuration injection
            let ServiceWithConfig = class ServiceWithConfig {
                appName;
                appVersion;
                constructor(appName, appVersion) {
                    this.appName = appName;
                    this.appVersion = appVersion;
                }
                getAppDetails() {
                    return `App: ${this.appName}, Version: ${this.appVersion}`;
                }
            };
            ServiceWithConfig = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.InjectConfig)('app.name')),
                __param(1, (0, decorators_1.InjectConfig)('app.version'))
            ], ServiceWithConfig);
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
            // Another service with configuration injected via property
            let ServiceWithPropertyConfig = class ServiceWithPropertyConfig {
                appName;
                appVersion;
                getAppDetails() {
                    return `App: ${this.appName}, Version: ${this.appVersion}`;
                }
            };
            __decorate([
                (0, decorators_1.InjectConfig)('app.name')
            ], ServiceWithPropertyConfig.prototype, "appName", void 0);
            __decorate([
                (0, decorators_1.InjectConfig)('app.version')
            ], ServiceWithPropertyConfig.prototype, "appVersion", void 0);
            ServiceWithPropertyConfig = __decorate([
                (0, decorators_1.Injectable)()
            ], ServiceWithPropertyConfig);
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
            // Mock service class that requires configuration injection
            let ServiceWithConfig = class ServiceWithConfig {
                appName;
                appVersion;
                constructor(appName, appVersion) {
                    this.appName = appName;
                    this.appVersion = appVersion;
                }
                getAppDetails() {
                    return `App: ${this.appName}, Version: ${this.appVersion}`;
                }
            };
            ServiceWithConfig = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.InjectConfig)('app.name')),
                __param(1, (0, decorators_1.InjectConfig)('app.version'))
            ], ServiceWithConfig);
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
            // Mock service class that requires configuration injection
            let ServiceWithConfig = class ServiceWithConfig {
                appName;
                appVersion;
                constructor(appName, appVersion) {
                    this.appName = appName;
                    this.appVersion = appVersion;
                }
                getAppDetails() {
                    return `App: ${this.appName}, Version: ${this.appVersion}`;
                }
            };
            ServiceWithConfig = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.InjectConfig)('app.name')),
                __param(1, (0, decorators_1.InjectConfig)('app.version'))
            ], ServiceWithConfig);
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
            // Mock service class that requires configuration injection
            let ServiceWithConfig = class ServiceWithConfig {
                appName;
                appVersion;
                constructor(appName, appVersion) {
                    this.appName = appName;
                    this.appVersion = appVersion;
                }
                getAppDetails() {
                    return `App: ${this.appName}, Version: ${this.appVersion}`;
                }
            };
            ServiceWithConfig = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.InjectConfig)('app.name')),
                __param(1, (0, decorators_1.InjectConfig)('app.version'))
            ], ServiceWithConfig);
            rootContainer.register({ provide: ServiceWithConfig, useClass: ServiceWithConfig, tags: ['release'] });
            const serviceInstance = rootContainer.resolve(ServiceWithConfig, { tags: ['release'] });
            expect(serviceInstance).toBeInstanceOf(ServiceWithConfig);
            expect(serviceInstance?.getAppDetails()).toContain('TaggedApp');
        });
        it('should throw an error for non-existent configuration paths during injection', () => {
            // Mock service class that requires configuration injection
            let ServiceWithConfig = class ServiceWithConfig {
                appName;
                appVersion;
                constructor(appName, appVersion) {
                    this.appName = appName;
                    this.appVersion = appVersion;
                }
                getAppDetails() {
                    return `App: ${this.appName}, Version: ${this.appVersion}`;
                }
            };
            ServiceWithConfig = __decorate([
                (0, decorators_1.Injectable)(),
                __param(0, (0, decorators_1.InjectConfig)('app.name')),
                __param(1, (0, decorators_1.InjectConfig)('app.version'))
            ], ServiceWithConfig);
            rootContainer.register({ provide: ServiceWithConfig, useClass: ServiceWithConfig });
            expect(() => rootContainer.resolve(ServiceWithConfig)).toThrow();
        });
    });
    describe('Module Exports and Imports', () => {
        it('resolves exported dependencies from imported modules', () => {
            class ModuleA {
            }
            class ModuleB {
            }
            let ServiceA = class ServiceA {
            };
            ServiceA = __decorate([
                container.Injectable()
            ], ServiceA);
            let ServiceB = class ServiceB {
                serviceA;
                constructor(serviceA) {
                    this.serviceA = serviceA;
                }
            };
            ServiceB = __decorate([
                container.Injectable(),
                __param(0, (0, decorators_1.Inject)(ServiceA))
            ], ServiceB);
            (0, metadata_1.registerModuleMetadata)(ModuleA, {
                providers: [{ provide: ServiceA, useClass: ServiceA }],
                exports: [ServiceA]
            });
            (0, metadata_1.registerModuleMetadata)(ModuleB, {
                imports: [ModuleA],
                providers: [{ provide: ServiceB, useClass: ServiceB }]
            });
            container.module(ModuleB);
            const instanceB = container.resolve(ServiceB);
            expect(instanceB).toBeInstanceOf(ServiceB);
            expect(instanceB.serviceA).toBeInstanceOf(ServiceA);
        });
        it('imports a module with no exports without errors', () => {
            class ModuleWithNoExports {
            }
            (0, metadata_1.registerModuleMetadata)(ModuleWithNoExports, {
                providers: [{ provide: 'service', useValue: 'test' }],
                exports: []
            });
            expect(() => container.module(ModuleWithNoExports)).not.toThrow();
        });
        it('resolves overlapping exports from multiple modules correctly', () => {
            class ModuleA {
            }
            class ModuleB {
            }
            let ServiceA = class ServiceA {
                getMessage() {
                    return 'from A';
                }
            };
            ServiceA = __decorate([
                container.Injectable()
            ], ServiceA);
            let ServiceB = class ServiceB {
                getMessage() {
                    return 'from B';
                }
            };
            ServiceB = __decorate([
                container.Injectable()
            ], ServiceB);
            (0, metadata_1.registerModuleMetadata)(ModuleA, {
                providers: [{ provide: 'shared', useClass: ServiceA }],
                exports: ['shared']
            });
            (0, metadata_1.registerModuleMetadata)(ModuleB, {
                providers: [{ provide: 'shared', useClass: ServiceB, priority: 1 }],
                exports: ['shared']
            });
            container.module(ModuleA);
            container.module(ModuleB);
            const instance = container.resolve('shared');
            expect(instance.getMessage()).toBe('from B'); // Assumes ModuleB was registered after ModuleA
        });
        it('correctly resolves providers from nested module exports', () => {
            class GrandchildModule {
            }
            class ChildModule {
            }
            class ParentModule {
            }
            let GrandchildService = class GrandchildService {
                getValue() {
                    return 'grandchild';
                }
            };
            GrandchildService = __decorate([
                container.Injectable()
            ], GrandchildService);
            (0, metadata_1.registerModuleMetadata)(GrandchildModule, {
                providers: [{ provide: 'grandchild', useClass: GrandchildService }],
                exports: ['grandchild']
            });
            (0, metadata_1.registerModuleMetadata)(ChildModule, {
                imports: [GrandchildModule],
                exports: ['grandchild']
            });
            (0, metadata_1.registerModuleMetadata)(ParentModule, {
                imports: [ChildModule],
                exports: ['grandchild']
            });
            container.module(ParentModule);
            const instance = container.resolve('grandchild');
            expect(instance).toBeInstanceOf(GrandchildService);
            expect(instance.getValue()).toBe('grandchild');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGkvY29udGFpbmVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQSwyQ0FBMEM7QUFDMUMsbUNBQXNDO0FBQ3RDLDZDQUFtRztBQUVuRyx5Q0FBbUY7QUFFbkYsUUFBUSxDQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUU7SUFDekIsSUFBSSxTQUFzQixDQUFDO0lBRTNCLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDWix1QkFBVyxDQUFDLGVBQWUsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUM1QyxTQUFTLEdBQUcsSUFBSSx1QkFBVyxFQUFFLENBQUM7SUFDbEMsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsY0FBYyxFQUFFLEdBQUcsRUFBRTtRQUMxQixFQUFFLENBQUMsc0NBQXNDLEVBQUUsR0FBRyxFQUFFO1lBQzVDLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxTQUFTLENBQUM7WUFHakMsSUFBTSxTQUFTLEdBQWYsTUFBTSxTQUFTO2FBQUksQ0FBQTtZQUFiLFNBQVM7Z0JBRGQsVUFBVSxFQUFFO2VBQ1AsU0FBUyxDQUFJO1lBQ25CLE1BQU0sQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2hELENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHFDQUFxQyxFQUFFLEdBQUcsRUFBRTtZQUMzQyxNQUFNLEtBQUssR0FBRyxJQUFBLG1CQUFXLEVBQVMsYUFBYSxDQUFDLENBQUM7WUFDakQsTUFBTSxPQUFPLEdBQUcsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDO1lBQzdCLFNBQVMsQ0FBQyxRQUFRLENBQUMsRUFBRSxVQUFVLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQzVELE1BQU0sQ0FB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LENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDbkQsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQztBQUdQLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuL2NvbnRhaW5lcic7XG5pbXBvcnQgeyBtYWtlRElUb2tlbiB9IGZyb20gJy4vdXRpbHMnO1xuaW1wb3J0IHsgRElNb2R1bGUsIEluamVjdCwgSW5qZWN0YWJsZSwgSW5qZWN0Q29uZmlnLCBJbmplY3RDb250YWluZXIsIE9uSW5pdCB9IGZyb20gJy4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBDb25maWdQcm92aWRlck9wdGlvbnMgfSBmcm9tICcuLi9pbnRlcmZhY2VzL2RpJztcbmltcG9ydCB7IHJlZ2lzdGVyQ29uc3RydWN0b3JEZXBlbmRlbmN5LCByZWdpc3Rlck1vZHVsZU1ldGFkYXRhIH0gZnJvbSAnLi9tZXRhZGF0YSc7XG5cbmRlc2NyaWJlKCdESUNvbnRhaW5lcicsICgpID0+IHtcbiAgICBsZXQgY29udGFpbmVyOiBESUNvbnRhaW5lcjtcblxuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICBESUNvbnRhaW5lci5ESU1ldGFkYXRhU3RvcmUuY2xlYXJNZXRhZGF0YSgpO1xuICAgICAgICBjb250YWluZXIgPSBuZXcgRElDb250YWluZXIoKTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdSZWdpc3RyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdyZWdpc3RlcnMgYSBjbGFzcyB3aXRoIEBJbmplY3RhYmxlKCknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHsgfVxuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXMoVGVzdENsYXNzKSkudG9CZSh0cnVlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3JlZ2lzdGVycyBhIGZhY3Rvcnkgd2l0aCB1c2VGYWN0b3J5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdUZXN0RmFjdG9yeScpO1xuICAgICAgICAgICAgY29uc3QgZmFjdG9yeSA9ICgpID0+ICd0ZXN0JztcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUZhY3Rvcnk6IGZhY3RvcnksIHByb3ZpZGU6IHRva2VuIH0pO1xuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lclsgJ3Byb3ZpZGVycycgXS5oYXModG9rZW4pKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVnaXN0ZXJzIGEgdmFsdWUgd2l0aCB1c2VWYWx1ZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignVGVzdFZhbHVlJyk7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VWYWx1ZTogJ3Rlc3QnLCBwcm92aWRlOiB0b2tlbiB9KTtcbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXJbICdwcm92aWRlcnMnIF0uaGFzKHRva2VuKSkudG9CZSh0cnVlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2RvZXMgbm90IHJlZ2lzdGVyIGlmIGNvbmRpdGlvbiBpcyBmYWxzZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignVGVzdENvbmRpdGlvbicpO1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlVmFsdWU6ICd0ZXN0JywgY29uZGl0aW9uOiAoKSA9PiBmYWxzZSwgcHJvdmlkZTogdG9rZW4gfSk7XG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyWyAncHJvdmlkZXJzJyBdLmhhcyh0b2tlbikpLnRvQmUoZmFsc2UpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdSZXNvbHV0aW9uJywgKCkgPT4ge1xuICAgICAgICBpdCgncmVzb2x2ZXMgYSBjbGFzcycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3MgeyB9XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZXNvbHZlcyBhIGZhY3RvcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPHN0cmluZz4oJ1Rlc3RGYWN0b3J5Jyk7XG4gICAgICAgICAgICBjb25zdCBmYWN0b3J5ID0gKCkgPT4gJ3Rlc3QnO1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlRmFjdG9yeTogZmFjdG9yeSwgcHJvdmlkZTogdG9rZW4gfSk7XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlKHRva2VuKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZSgndGVzdCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVzb2x2ZXMgYSB2YWx1ZScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignVGVzdFZhbHVlJyk7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VWYWx1ZTogJ3Rlc3QnLCBwcm92aWRlOiB0b2tlbiB9KTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmUodG9rZW4pO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlKCd0ZXN0Jyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCd0aHJvd3MgYW4gZXJyb3IgaWYgbm8gcHJvdmlkZXIgaXMgZm91bmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPHN0cmluZz4oJ05vbkV4aXN0ZW50Jyk7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLnJlc29sdmUodG9rZW4pKS50b1Rocm93KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdoYW5kbGVzIGNpcmN1bGFyIGRlcGVuZGVuY2llcycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBDbGFzc0Ege1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NsYXNzQicpIHB1YmxpYyBiOiBhbnkpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBDbGFzc0Ige1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NsYXNzQScpIHB1YmxpYyBhOiBhbnkpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZUEgPSBjb250YWluZXIucmVzb2x2ZTxDbGFzc0E+KCdDbGFzc0EnKTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlQiA9IGNvbnRhaW5lci5yZXNvbHZlPENsYXNzQj4oJ0NsYXNzQicpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2VBKS50b0JlSW5zdGFuY2VPZihDbGFzc0EpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlQikudG9CZUluc3RhbmNlT2YoQ2xhc3NCKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZUEuYikudG9CZUluc3RhbmNlT2YoQ2xhc3NCKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZUIuYSkudG9CZUluc3RhbmNlT2YoQ2xhc3NBKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2NhbGxzIEBPbkluaXQgbWV0aG9kIGFmdGVyIHJlc29sdmluZycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuICAgICAgICAgICAgY29uc3Qgb25Jbml0U3B5ID0gamVzdC5mbigpO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3Mge1xuICAgICAgICAgICAgICAgIEBPbkluaXQoKVxuICAgICAgICAgICAgICAgIG9uSW5pdCgpIHtcbiAgICAgICAgICAgICAgICAgICAgb25Jbml0U3B5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlKFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChvbkluaXRTcHkpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnUHJvcGVydHkgSW5qZWN0aW9uJywgKCkgPT4ge1xuICAgICAgICBpdCgnaW5qZWN0cyBwcm9wZXJ0aWVzIHVzaW5nIEBJbmplY3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgRGVwZW5kZW5jeSB7IH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICBASW5qZWN0KERlcGVuZGVuY3kpXG4gICAgICAgICAgICAgICAgcHVibGljIGRlcGVuZGVuY3khOiBEZXBlbmRlbmN5O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5kZXBlbmRlbmN5KS50b0JlSW5zdGFuY2VPZihEZXBlbmRlbmN5KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2hhbmRsZXMgb3B0aW9uYWwgcHJvcGVydHkgaW5qZWN0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgQEluamVjdCgnT3B0aW9uYWxEZXBlbmRlbmN5JywgeyBpc09wdGlvbmFsOiB0cnVlIH0pXG4gICAgICAgICAgICAgICAgcHVibGljIG9wdGlvbmFsRGVwZW5kZW5jeT86IGFueTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5vcHRpb25hbERlcGVuZGVuY3kpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnTXVsdGlwbGUgRGVwZW5kZW5jeSBJbmplY3Rpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdpbmplY3RzIG11bHRpcGxlIGRlcGVuZGVuY2llcycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBEZXBlbmRlbmN5QSB7IH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgRGVwZW5kZW5jeUIgeyB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3QoRGVwZW5kZW5jeUEpIHB1YmxpYyBkZXBlbmRlbmN5QTogRGVwZW5kZW5jeUEsXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3QoRGVwZW5kZW5jeUIpIHB1YmxpYyBkZXBlbmRlbmN5QjogRGVwZW5kZW5jeUJcbiAgICAgICAgICAgICAgICApIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzcz4oVGVzdENsYXNzKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmRlcGVuZGVuY3lBKS50b0JlSW5zdGFuY2VPZihEZXBlbmRlbmN5QSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuZGVwZW5kZW5jeUIpLnRvQmVJbnN0YW5jZU9mKERlcGVuZGVuY3lCKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnU2luZ2xldG9uIEJlaGF2aW9yJywgKCkgPT4ge1xuICAgICAgICBpdCgncmV1c2VzIHNpbmdsZXRvbiBpbnN0YW5jZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoeyBzaW5nbGV0b246IHRydWUgfSlcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7IH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UxID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzPihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UyID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzPihUZXN0Q2xhc3MpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UxKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlMikudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTEpLnRvQmUoaW5zdGFuY2UyKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ29uZGl0aW9uYWwgUmVnaXN0cmF0aW9uJywgKCkgPT4ge1xuICAgICAgICBpdCgnZG9lcyBub3QgcmVnaXN0ZXIgYSBwcm92aWRlciBpZiBjb25kaXRpb24gaXMgZmFsc2UnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignQ29uZGl0aW9uYWxTZXJ2aWNlJyk7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKHsgY29uZGl0aW9uOiAoKSA9PiBmYWxzZSB9KVxuICAgICAgICAgICAgY2xhc3MgQ29uZGl0aW9uYWxTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyLmhhcyh0b2tlbikpLnRvQmUoZmFsc2UpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVnaXN0ZXJzIGEgcHJvdmlkZXIgaWYgY29uZGl0aW9uIGlzIHRydWUnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignQ29uZGl0aW9uYWxTZXJ2aWNlJyk7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKHsgY29uZGl0aW9uOiAoKSA9PiB0cnVlIH0pXG4gICAgICAgICAgICBjbGFzcyBDb25kaXRpb25hbFNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzKHRva2VuKSkudG9CZSh0cnVlKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQXN5bmMgUmVzb2x2ZScsICgpID0+IHtcbiAgICAgICAgaXQoJ3Jlc29sdmVzIGEgY2xhc3MgYXN5bmNocm9ub3VzbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHsgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlQXN5bmMoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Jlc29sdmVzIGEgZmFjdG9yeSBhc3luY2hyb25vdXNseScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignVGVzdEZhY3RvcnknKTtcbiAgICAgICAgICAgIGNvbnN0IGZhY3RvcnkgPSAoKSA9PiAndGVzdCc7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VGYWN0b3J5OiBmYWN0b3J5LCBwcm92aWRlOiB0b2tlbiB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jKHRva2VuKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZSgndGVzdCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVzb2x2ZXMgYSB2YWx1ZSBhc3luY2hyb25vdXNseScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignVGVzdFZhbHVlJyk7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VWYWx1ZTogJ3Rlc3QnLCBwcm92aWRlOiB0b2tlbiB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jKHRva2VuKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZSgndGVzdCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnaGFuZGxlcyBjaXJjdWxhciBkZXBlbmRlbmNpZXMgYXN5bmNocm9ub3VzbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgQ2xhc3NBIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KCdDbGFzc0InKSBwdWJsaWMgYjogYW55KSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgQ2xhc3NCIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KCdDbGFzc0EnKSBwdWJsaWMgYTogYW55KSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2VBID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYzxDbGFzc0E+KCdDbGFzc0EnKTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlQiA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlQXN5bmM8Q2xhc3NCPignQ2xhc3NCJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZUEpLnRvQmVJbnN0YW5jZU9mKENsYXNzQSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2VCKS50b0JlSW5zdGFuY2VPZihDbGFzc0IpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlQS5iKS50b0JlSW5zdGFuY2VPZihDbGFzc0IpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlQi5hKS50b0JlSW5zdGFuY2VPZihDbGFzc0EpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnaGFuZGxlcyBvcHRpb25hbCBwcm9wZXJ0eSBpbmplY3Rpb24gYXN5bmNocm9ub3VzbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICBASW5qZWN0KCdPcHRpb25hbERlcGVuZGVuY3knLCB7IGlzT3B0aW9uYWw6IHRydWUgfSlcbiAgICAgICAgICAgICAgICBwdWJsaWMgb3B0aW9uYWxEZXBlbmRlbmN5PzogYW55O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlQXN5bmM8VGVzdENsYXNzPihUZXN0Q2xhc3MpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2Uub3B0aW9uYWxEZXBlbmRlbmN5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NsZWFyIENvbnRhaW5lcicsICgpID0+IHtcbiAgICAgICAgaXQoJ2NsZWFycyBhbGwgcHJvdmlkZXJzIGFuZCBjYWNoZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3MgeyB9XG5cbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzKFRlc3RDbGFzcykpLnRvQmUodHJ1ZSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5jbGVhcigpO1xuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXMoVGVzdENsYXNzKSkudG9CZShmYWxzZSk7XG4gICAgICAgICAgICBleHBlY3QoKGNvbnRhaW5lciBhcyBhbnkpLmNhY2hlLnNpemUpLnRvQmUoMCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0Vycm9yIEhhbmRsaW5nJywgKCkgPT4ge1xuICAgICAgICBpdCgndGhyb3dzIGFuIGVycm9yIHdoZW4gcmVnaXN0ZXJpbmcgYW4gaW52YWxpZCBwcm92aWRlcicsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IG51bGwgYXMgYW55LCBwcm92aWRlOiAnSW52YWxpZFByb3ZpZGVyJyB9KTtcbiAgICAgICAgICAgIH0pLnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Rocm93cyBhbiBlcnJvciB3aGVuIHJlc29sdmluZyBhbiBpbnZhbGlkIHByb3ZpZGVyJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdJbnZhbGlkUHJvdmlkZXInKTtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIucmVzb2x2ZSh0b2tlbikpLnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnSW5oZXJpdGFuY2UnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdpbmplY3RzIGRlcGVuZGVuY2llcyBpbiBhIGRlcml2ZWQgY2xhc3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgQmFzZVNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIERlcml2ZWRTZXJ2aWNlIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoQmFzZVNlcnZpY2UpIHB1YmxpYyBiYXNlU2VydmljZTogQmFzZVNlcnZpY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmU8RGVyaXZlZFNlcnZpY2U+KERlcml2ZWRTZXJ2aWNlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihEZXJpdmVkU2VydmljZSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuYmFzZVNlcnZpY2UpLnRvQmVJbnN0YW5jZU9mKEJhc2VTZXJ2aWNlKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnTGlmZWN5Y2xlIEhvb2tzJywgKCkgPT4ge1xuICAgICAgICBpdCgnY2FsbHMgQE9uSW5pdCBtZXRob2QgZm9yIGVhY2ggaW5zdGFuY2UnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcbiAgICAgICAgICAgIGNvbnN0IG9uSW5pdFNweSA9IGplc3QuZm4oKTtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoeyBzaW5nbGV0b246IGZhbHNlIH0pXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3Mge1xuICAgICAgICAgICAgICAgIEBPbkluaXQoKVxuICAgICAgICAgICAgICAgIG9uSW5pdCgpIHtcbiAgICAgICAgICAgICAgICAgICAgb25Jbml0U3B5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTEgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTIgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChvbkluaXRTcHkpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnUmUtcmVnaXN0cmF0aW9uJywgKCkgPT4ge1xuICAgICAgICBpdCgndXBkYXRlcyBwcm92aWRlciB3aGVuIHJlLXJlZ2lzdGVyZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgT3JpZ2luYWxTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBVcGRhdGVkU2VydmljZSB7IH1cblxuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxPcmlnaW5hbFNlcnZpY2U+KCdTZXJ2aWNlJyk7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogT3JpZ2luYWxTZXJ2aWNlLCBwcm92aWRlOiB0b2tlbiB9KTtcblxuICAgICAgICAgICAgbGV0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmUodG9rZW4pO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihPcmlnaW5hbFNlcnZpY2UpO1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IFVwZGF0ZWRTZXJ2aWNlLCBwcm92aWRlOiB0b2tlbiwgcHJpb3JpdHk6IDEgfSk7XG5cbiAgICAgICAgICAgIGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmUodG9rZW4pO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihVcGRhdGVkU2VydmljZSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NvbXBsZXggRGVwZW5kZW5jeSBHcmFwaHMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdyZXNvbHZlcyBjb21wbGV4IGRlcGVuZGVuY3kgZ3JhcGhzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VBIHsgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlQiB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdChTZXJ2aWNlQSkgcHVibGljIGE6IFNlcnZpY2VBKSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZUMge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoU2VydmljZUIpIHB1YmxpYyBiOiBTZXJ2aWNlQikgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VEIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KFNlcnZpY2VDKSBwdWJsaWMgYzogU2VydmljZUMsIEBJbmplY3QoU2VydmljZUEpIHB1YmxpYyBhOiBTZXJ2aWNlQSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmU8U2VydmljZUQ+KFNlcnZpY2VEKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlRCk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuYykudG9CZUluc3RhbmNlT2YoU2VydmljZUMpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmMuYikudG9CZUluc3RhbmNlT2YoU2VydmljZUIpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmMuYi5hKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlQSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuYSkudG9CZUluc3RhbmNlT2YoU2VydmljZUEpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdDaGlsZCBDb250YWluZXJzJywgKCkgPT4ge1xuICAgICAgICBsZXQgY2hpbGRDb250YWluZXI6IERJQ29udGFpbmVyO1xuXG4gICAgICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICAgICAgY2hpbGRDb250YWluZXIgPSBjb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ2NoaWxkJyk7XG4gICAgICAgICAgICBESUNvbnRhaW5lci5ESU1ldGFkYXRhU3RvcmUuY2xlYXJNZXRhZGF0YSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBkZXNjcmliZSgnSW5oZXJpdGFuY2UnLCAoKSA9PiB7XG4gICAgICAgICAgICBpdCgnaW5oZXJpdHMgcHJvdmlkZXJzIGZyb20gcGFyZW50IGNvbnRhaW5lcicsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBQYXJlbnRTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlPFBhcmVudFNlcnZpY2U+KFBhcmVudFNlcnZpY2UpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihQYXJlbnRTZXJ2aWNlKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpdCgnb3ZlcnJpZGVzIHByb3ZpZGVycyBpbiBjaGlsZCBjb250YWluZXInLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgUGFyZW50U2VydmljZSB7XG4gICAgICAgICAgICAgICAgICAgIGdldE1lc3NhZ2UoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3BhcmVudCc7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgQ2hpbGRTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICAgICAgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnY2hpbGQnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogQ2hpbGRTZXJ2aWNlLCBwcm92aWRlOiAnU2VydmljZScgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8Q2hpbGRTZXJ2aWNlPignU2VydmljZScpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihDaGlsZFNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5nZXRNZXNzYWdlKCkpLnRvQmUoJ2NoaWxkJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZGVzY3JpYmUoJ1Byb3ZpZGVyIFNoYWRvd2luZycsICgpID0+IHtcbiAgICAgICAgICAgIGl0KCdzaGFkb3dzIHBhcmVudCBjb250YWluZXIgcHJvdmlkZXJzJywgKCkgPT4ge1xuXG4gICAgICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKHsgJ3Byb3ZpZGUnOiAnU2VydmljZScgfSlcbiAgICAgICAgICAgICAgICBjbGFzcyBQYXJlbnRTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICAgICAgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAncGFyZW50JztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIEBjaGlsZENvbnRhaW5lci5JbmplY3RhYmxlKHsgcHJvdmlkZTogJ1NlcnZpY2UnIH0pXG4gICAgICAgICAgICAgICAgY2xhc3MgQ2hpbGRTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICAgICAgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnY2hpbGQnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgY2hpbGRJbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8Q2hpbGRTZXJ2aWNlPignU2VydmljZScpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudEluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8UGFyZW50U2VydmljZT4oJ1NlcnZpY2UnKTtcblxuICAgICAgICAgICAgICAgIGV4cGVjdChjaGlsZEluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihDaGlsZFNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChjaGlsZEluc3RhbmNlLmdldE1lc3NhZ2UoKSkudG9CZSgnY2hpbGQnKTtcbiAgICAgICAgICAgICAgICBleHBlY3QocGFyZW50SW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFBhcmVudFNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJlbnRJbnN0YW5jZS5nZXRNZXNzYWdlKCkpLnRvQmUoJ3BhcmVudCcpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlc2NyaWJlKCdDb25kaXRpb25hbCBSZXNvbHV0aW9uIGluIENoaWxkIENvbnRhaW5lcnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBpdCgnY29uZGl0aW9uYWxseSByZWdpc3RlcnMgcHJvdmlkZXJzIGluIGNoaWxkIGNvbnRhaW5lcicsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBQYXJlbnRTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgICAgICB1c2VDbGFzczogUGFyZW50U2VydmljZSxcbiAgICAgICAgICAgICAgICAgICAgcHJvdmlkZTogJ0NvbmRpdGlvbmFsU2VydmljZScsXG4gICAgICAgICAgICAgICAgICAgIGNvbmRpdGlvbjogKCkgPT4gZmFsc2VcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjaGlsZENvbnRhaW5lci5yZXNvbHZlKCdDb25kaXRpb25hbFNlcnZpY2UnKSkudG9UaHJvdygpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlc2NyaWJlKCdNaWRkbGV3YXJlIFN1cHBvcnQgaW4gQ2hpbGQgQ29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgICAgIGl0KCdhcHBsaWVzIG1pZGRsZXdhcmUgdG8gY2hpbGQgY29udGFpbmVyIHJlc29sdXRpb25zJywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKChuZXh0KSA9PiBuZXh0KCkpO1xuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIudXNlTWlkZGxld2FyZSh7IG1pZGRsZXdhcmU6IG1pZGRsZXdhcmVTcHkgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBNaWRkbGV3YXJlU2VydmljZSB7IH1cblxuICAgICAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IE1pZGRsZXdhcmVTZXJ2aWNlLCBwcm92aWRlOiAnTWlkZGxld2FyZVNlcnZpY2UnIH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlPE1pZGRsZXdhcmVTZXJ2aWNlPignTWlkZGxld2FyZVNlcnZpY2UnKTtcbiAgICAgICAgICAgICAgICBleHBlY3QobWlkZGxld2FyZVNweSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoTWlkZGxld2FyZVNlcnZpY2UpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGl0KCdhcHBsaWVzIGFzeW5jIG1pZGRsZXdhcmUgdG8gY2hpbGQgY29udGFpbmVyIHJlc29sdXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKGFzeW5jIChuZXh0KSA9PiBhd2FpdCBuZXh0KCkpO1xuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIudXNlTWlkZGxld2FyZUFzeW5jKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIE1pZGRsZXdhcmVTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogTWlkZGxld2FyZVNlcnZpY2UsIHByb3ZpZGU6ICdNaWRkbGV3YXJlU2VydmljZScgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNoaWxkQ29udGFpbmVyLnJlc29sdmVBc3luYzxNaWRkbGV3YXJlU2VydmljZT4oJ01pZGRsZXdhcmVTZXJ2aWNlJyk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KG1pZGRsZXdhcmVTcHkpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKE1pZGRsZXdhcmVTZXJ2aWNlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBkZXNjcmliZSgnUHJvcGVydHkgSW5qZWN0aW9uIGluIENoaWxkIENvbnRhaW5lcnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBpdCgnaW5qZWN0cyBwcm9wZXJ0aWVzIHVzaW5nIEBJbmplY3QgaW4gY2hpbGQgY29udGFpbmVyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIERlcGVuZGVuY3kgeyB9XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdChEZXBlbmRlbmN5KVxuICAgICAgICAgICAgICAgICAgICBwdWJsaWMgZGVwZW5kZW5jeSE6IERlcGVuZGVuY3k7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogRGVwZW5kZW5jeSwgcHJvdmlkZTogRGVwZW5kZW5jeS5uYW1lIH0pO1xuICAgICAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IFRlc3RDbGFzcywgcHJvdmlkZTogVGVzdENsYXNzLm5hbWUgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzPihUZXN0Q2xhc3MpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5kZXBlbmRlbmN5KS50b0JlSW5zdGFuY2VPZihEZXBlbmRlbmN5KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpdCgnaGFuZGxlcyBvcHRpb25hbCBwcm9wZXJ0eSBpbmplY3Rpb24gaW4gY2hpbGQgY29udGFpbmVyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3QoJ09wdGlvbmFsRGVwZW5kZW5jeScsIHsgaXNPcHRpb25hbDogdHJ1ZSB9KVxuICAgICAgICAgICAgICAgICAgICBwdWJsaWMgb3B0aW9uYWxEZXBlbmRlbmN5PzogYW55O1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IFRlc3RDbGFzcywgcHJvdmlkZTogVGVzdENsYXNzLm5hbWUgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzPihUZXN0Q2xhc3MpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5vcHRpb25hbERlcGVuZGVuY3kpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdNaWRkbGV3YXJlIGFuZCBJbnRlcmNlcHRvcnMnLCAoKSA9PiB7XG4gICAgICAgIGRlc2NyaWJlKCdNaWRkbGV3YXJlJywgKCkgPT4ge1xuICAgICAgICAgICAgaXQoJ2FwcGxpZXMgbWlkZGxld2FyZSB0byByZXNvbHV0aW9ucycsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtaWRkbGV3YXJlU3B5ID0gamVzdC5mbigobmV4dCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTWlkZGxld2FyZSBiZWZvcmUnKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gbmV4dCgpO1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTWlkZGxld2FyZSBhZnRlcicpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY29udGFpbmVyLnVzZU1pZGRsZXdhcmUoeyBtaWRkbGV3YXJlOiBtaWRkbGV3YXJlU3B5IH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgTWlkZGxld2FyZVNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPE1pZGRsZXdhcmVTZXJ2aWNlPignTWlkZGxld2FyZVNlcnZpY2UnKTtcblxuICAgICAgICAgICAgICAgIGV4cGVjdChtaWRkbGV3YXJlU3B5KS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihNaWRkbGV3YXJlU2VydmljZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaXQoJ2FsbG93cyBtaWRkbGV3YXJlIHRvIG1vZGlmeSB0aGUgcmVzdWx0JywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKChuZXh0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IG5leHQoKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0Lm1vZGlmaWVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIE1pZGRsZXdhcmVTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSAnb3JpZ2luYWwnO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8YW55PignTWlkZGxld2FyZVNlcnZpY2UnKTtcblxuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoTWlkZGxld2FyZVNlcnZpY2UpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5tb2RpZmllZCkudG9CZSh0cnVlKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpdCgnaGFuZGxlcyBlcnJvcnMgaW4gbWlkZGxld2FyZScsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtaWRkbGV3YXJlU3B5ID0gamVzdC5mbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWlkZGxld2FyZSBlcnJvcicpO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY29udGFpbmVyLnVzZU1pZGRsZXdhcmUoeyBtaWRkbGV3YXJlOiBtaWRkbGV3YXJlU3B5IH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgTWlkZGxld2FyZVNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLnJlc29sdmU8TWlkZGxld2FyZVNlcnZpY2U+KCdNaWRkbGV3YXJlU2VydmljZScpKVxuICAgICAgICAgICAgICAgICAgICAudG9UaHJvdygnTWlkZGxld2FyZSBlcnJvcicpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlc2NyaWJlKCdBc3luYyBNaWRkbGV3YXJlJywgKCkgPT4ge1xuICAgICAgICAgICAgaXQoJ2FwcGxpZXMgYXN5bmMgbWlkZGxld2FyZSB0byByZXNvbHV0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtaWRkbGV3YXJlU3B5ID0gamVzdC5mbihhc3luYyAobmV4dCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQXN5bmMgbWlkZGxld2FyZSBiZWZvcmUnKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbmV4dCgpO1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQXN5bmMgbWlkZGxld2FyZSBhZnRlcicpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY29udGFpbmVyLnVzZU1pZGRsZXdhcmVBc3luYyh7IG1pZGRsZXdhcmU6IG1pZGRsZXdhcmVTcHkgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBNaWRkbGV3YXJlU2VydmljZSB7IH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYzxNaWRkbGV3YXJlU2VydmljZT4oJ01pZGRsZXdhcmVTZXJ2aWNlJyk7XG5cbiAgICAgICAgICAgICAgICBleHBlY3QobWlkZGxld2FyZVNweSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoTWlkZGxld2FyZVNlcnZpY2UpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGl0KCdhbGxvd3MgYXN5bmMgbWlkZGxld2FyZSB0byBtb2RpZnkgdGhlIHJlc3VsdCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtaWRkbGV3YXJlU3B5ID0gamVzdC5mbihhc3luYyAobmV4dCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBuZXh0KCk7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5tb2RpZmllZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZUFzeW5jKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIE1pZGRsZXdhcmVTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSAnb3JpZ2luYWwnO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYzxhbnk+KCdNaWRkbGV3YXJlU2VydmljZScpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihNaWRkbGV3YXJlU2VydmljZSk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLm1vZGlmaWVkKS50b0JlKHRydWUpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGl0KCdoYW5kbGVzIGVycm9ycyBpbiBhc3luYyBtaWRkbGV3YXJlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBc3luYyBtaWRkbGV3YXJlIGVycm9yJyk7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZUFzeW5jKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIE1pZGRsZXdhcmVTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICAgICAgYXdhaXQgZXhwZWN0KGNvbnRhaW5lci5yZXNvbHZlQXN5bmM8TWlkZGxld2FyZVNlcnZpY2U+KCdNaWRkbGV3YXJlU2VydmljZScpKS5yZWplY3RzLnRvVGhyb3coJ0FzeW5jIG1pZGRsZXdhcmUgZXJyb3InKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdQcm92aWRlciBQcmlvcml0eSBSZWdpc3RyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGNsYXNzIFRlc3RDbGFzc0Ege1xuICAgICAgICAgICAgdmFsdWU6IHN0cmluZyA9ICdBJztcbiAgICAgICAgfVxuXG4gICAgICAgIGNsYXNzIFRlc3RDbGFzc0Ige1xuICAgICAgICAgICAgdmFsdWU6IHN0cmluZyA9ICdCJztcbiAgICAgICAgfVxuXG4gICAgICAgIHRlc3QoJ3JlZ2lzdGVycyBhIHByb3ZpZGVyIHdpdGggaGlnaGVyIHByaW9yaXR5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0EsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDFcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzc0E+KCd0ZXN0Jyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UudmFsdWUpLnRvQmUoJ0EnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGVzdCgnZG9lcyBub3Qgb3ZlcnJpZGUgYSBwcm92aWRlciB3aXRoIGEgaGlnaGVyIHByaW9yaXR5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0EsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDJcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQixcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQT4oJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS52YWx1ZSkudG9CZSgnQScpOyAvLyBTaG91bGQgbm90IG92ZXJyaWRlIHdpdGggbG93ZXIgcHJpb3JpdHlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGVzdCgnb3ZlcnJpZGVzIGEgcHJvdmlkZXIgd2l0aCBhIGxvd2VyIHByaW9yaXR5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0EsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDFcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQixcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMlxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQj4oJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS52YWx1ZSkudG9CZSgnQicpOyAvLyBTaG91bGQgb3ZlcnJpZGUgd2l0aCBoaWdoZXIgcHJpb3JpdHlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGVzdCgncmVnaXN0ZXJzIGEgcHJvdmlkZXIgd2l0aG91dCBwcmlvcml0eSBhbmQgb3ZlcnJpZGVzIGlmIG5ldyBvbmUgaGFzIHByaW9yaXR5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0FcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQixcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQj4oJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS52YWx1ZSkudG9CZSgnQicpOyAvLyBTaG91bGQgb3ZlcnJpZGUgc2luY2UgbmV3IHByb3ZpZGVyIGhhcyBwcmlvcml0eVxuICAgICAgICB9KTtcblxuICAgICAgICB0ZXN0KCdkb2VzIG5vdCByZWdpc3RlciBhIHByb3ZpZGVyIHdpdGggbG93ZXIgcHJpb3JpdHkgd2hlbiBvbmUgd2l0aG91dCBwcmlvcml0eSBleGlzdHMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NCLFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAtMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQT4oJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS52YWx1ZSkudG9CZSgnQScpOyAvLyBTaG91bGQgbm90IG92ZXJyaWRlIHNpbmNlIGV4aXN0aW5nIHByb3ZpZGVyIGhhcyBubyBwcmlvcml0eVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdPcHRpb25hbCBEZXBlbmRlbmN5IEluamVjdGlvbiB3aXRoIERlZmF1bHQgVmFsdWUnLCAoKSA9PiB7XG4gICAgICAgIGNsYXNzIFRlc3RDbGFzc0Ege1xuICAgICAgICAgICAgdmFsdWU6IHN0cmluZztcbiAgICAgICAgICAgIGNvbnN0cnVjdG9yKHZhbHVlOiBzdHJpbmcgPSAnQScpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjbGFzcyBEZXBlbmRlbnRDbGFzcyB7XG4gICAgICAgICAgICBjb25zdHJ1Y3RvcihwdWJsaWMgZGVwOiBUZXN0Q2xhc3NBKSB7IH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRlc3QoJ2luamVjdHMgZGVwZW5kZW5jeSB3aGVuIHByb3ZpZGVkJywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnZGVwJyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2RlcGVuZGVudCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IERlcGVuZGVudENsYXNzXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmVnaXN0ZXJDb25zdHJ1Y3RvckRlcGVuZGVuY3koRGVwZW5kZW50Q2xhc3MsIDAsICdkZXAnLCB7XG4gICAgICAgICAgICAgICAgaXNPcHRpb25hbDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IG5ldyBUZXN0Q2xhc3NBKCdkZWZhdWx0JyksXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxEZXBlbmRlbnRDbGFzcz4oJ2RlcGVuZGVudCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmRlcC52YWx1ZSkudG9CZSgnQScpO1xuICAgICAgICB9KTtcblxuICAgICAgICB0ZXN0KCd1c2VzIGRlZmF1bHQgdmFsdWUgd2hlbiBkZXBlbmRlbmN5IGlzIG5vdCBwcm92aWRlZCcsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2RlcGVuZGVudCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IERlcGVuZGVudENsYXNzXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmVnaXN0ZXJDb25zdHJ1Y3RvckRlcGVuZGVuY3koRGVwZW5kZW50Q2xhc3MsIDAsICdkZXAnLCB7XG4gICAgICAgICAgICAgICAgaXNPcHRpb25hbDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IG5ldyBUZXN0Q2xhc3NBKCdkZWZhdWx0JyksXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxEZXBlbmRlbnRDbGFzcz4oJ2RlcGVuZGVudCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmRlcC52YWx1ZSkudG9CZSgnZGVmYXVsdCcpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdNaWRkbGV3YXJlIEV4ZWN1dGlvbiBPcmRlciBDb250cm9sJywgKCkgPT4ge1xuICAgICAgICBjbGFzcyBUZXN0Q2xhc3NBIHtcbiAgICAgICAgICAgIHZhbHVlOiBzdHJpbmc7XG4gICAgICAgICAgICBjb25zdHJ1Y3Rvcih2YWx1ZTogc3RyaW5nID0gJ0EnKSB7XG4gICAgICAgICAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGVzdCgnZXhlY3V0ZXMgbWlkZGxld2FyZXMgaW4gc3BlY2lmaWVkIG9yZGVyJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0OiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7XG4gICAgICAgICAgICAgICAgbWlkZGxld2FyZTogbmV4dCA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKCdtaWRkbGV3YXJlMScpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dCgpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgb3JkZXI6IDBcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7XG4gICAgICAgICAgICAgICAgbWlkZGxld2FyZTogbmV4dCA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKCdtaWRkbGV3YXJlMicpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dCgpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgb3JkZXI6IDFcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7XG4gICAgICAgICAgICAgICAgbWlkZGxld2FyZTogbmV4dCA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKCdtaWRkbGV3YXJlMCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dCgpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgb3JkZXI6IC0xXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0FcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NBPigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChbICdtaWRkbGV3YXJlMCcsICdtaWRkbGV3YXJlMScsICdtaWRkbGV3YXJlMicgXSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRlc3QoJ2V4ZWN1dGVzIGFzeW5jIG1pZGRsZXdhcmVzIGluIHNwZWNpZmllZCBvcmRlcicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdDogc3RyaW5nW10gPSBbXTtcblxuICAgICAgICAgICAgY29udGFpbmVyLnVzZU1pZGRsZXdhcmVBc3luYyh7XG4gICAgICAgICAgICAgICAgbWlkZGxld2FyZTogYXN5bmMgbmV4dCA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKCdtaWRkbGV3YXJlMScpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dCgpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgb3JkZXI6IDBcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZUFzeW5jKHtcbiAgICAgICAgICAgICAgICBtaWRkbGV3YXJlOiBhc3luYyBuZXh0ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goJ21pZGRsZXdhcmUyJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBvcmRlcjogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlQXN5bmMoe1xuICAgICAgICAgICAgICAgIG1pZGRsZXdhcmU6IGFzeW5jIG5leHQgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQucHVzaCgnbWlkZGxld2FyZTAnKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHQoKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG9yZGVyOiAtMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NBXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYzxUZXN0Q2xhc3NBPigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChbICdtaWRkbGV3YXJlMCcsICdtaWRkbGV3YXJlMScsICdtaWRkbGV3YXJlMicgXSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1Byb3ZpZGVyIFJlbW92YWwnLCAoKSA9PiB7XG4gICAgICAgIGNsYXNzIFRlc3RDbGFzc0Ege1xuICAgICAgICAgICAgdmFsdWU6IHN0cmluZztcbiAgICAgICAgICAgIGNvbnN0cnVjdG9yKHZhbHVlOiBzdHJpbmcgPSAnQScpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjbGFzcyBUZXN0Q2xhc3NCIHtcbiAgICAgICAgICAgIHZhbHVlOiBzdHJpbmcgPSAnQic7XG4gICAgICAgIH1cblxuICAgICAgICB0ZXN0KCdyZW1vdmVzIGEgcmVnaXN0ZXJlZCBwcm92aWRlcicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NBXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZW1vdmVQcm92aWRlcnNGb3IoJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NBPigndGVzdCcpKS50b1Rocm93KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRlc3QoJ3JlbW92ZXMgYSBwcm92aWRlciBmcm9tIHRoZSBjYWNoZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NBLFxuICAgICAgICAgICAgICAgIHNpbmdsZXRvbjogdHJ1ZVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzc0E+KCd0ZXN0Jyk7XG4gICAgICAgICAgICBjb250YWluZXIucmVtb3ZlUHJvdmlkZXJzRm9yKCd0ZXN0Jyk7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQlxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTIgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NBPigndGVzdCcpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UxLnZhbHVlKS50b0JlKCdBJyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UyLnZhbHVlKS50b0JlKCdCJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRlc3QoJ2hhbmRsZXMgcmVtb3Zpbmcgbm9uLWV4aXN0ZW50IHByb3ZpZGVyIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLnJlbW92ZVByb3ZpZGVyc0Zvcignbm9uRXhpc3RlbnQnKSkubm90LnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnTW9kdWxlcycsICgpID0+IHtcbiAgICAgICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIuY2xlYXIoKTtcbiAgICAgICAgICAgIERJQ29udGFpbmVyLkRJTWV0YWRhdGFTdG9yZS5jbGVhck1ldGFkYXRhKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZWdpc3RlcnMgYSBtb2R1bGUnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgY2xhc3MgVGVzdE1vZHVsZSB7IH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzQSB7IH1cblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShUZXN0TW9kdWxlLCB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgdXNlQ2xhc3M6IFRlc3RDbGFzc0EsIHByb3ZpZGU6ICd0ZXN0JyB9LFxuICAgICAgICAgICAgICAgICAgICB7IHVzZVZhbHVlOiAndGVzdCcsIHByb3ZpZGU6ICd0ZXN0VmFsdWUnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgdXNlRmFjdG9yeTogKCkgPT4gJ3Rlc3QnLCBwcm92aWRlOiAndGVzdEZhY3RvcnknIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ3Rlc3RWYWx1ZScgXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQT4oJ3Rlc3RWYWx1ZScpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlKCd0ZXN0Jyk7XG5cbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIucmVzb2x2ZSgndGVzdCcpKS50b1Rocm93KCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMiA9IG1vZHVsZS5jb250YWluZXIucmVzb2x2ZSgndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlMikudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzQSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZWdpc3RlciBhIHByb3ZpZGVyIGFzIGEgY2xhc3MgcmVmZXJlbmNlJywgKCkgPT4ge1xuXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3MgeyB9XG5cbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzczIge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0KFRlc3RDbGFzcykgcHVibGljIHRlc3Q6IFRlc3RDbGFzc1xuICAgICAgICAgICAgICAgICkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBESU1vZHVsZSh7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbIFRlc3RDbGFzcywgVGVzdENsYXNzMiBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgVGVzdENsYXNzIF1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjbGFzcyBUZXN0TW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBjb25zdCB7IGNvbnRhaW5lcjogbW9kdWxlQ29udGFpbmVyIH0gPSBjb250YWluZXIubW9kdWxlKFRlc3RNb2R1bGUpO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG1vZHVsZUNvbnRhaW5lci5yZXNvbHZlKFRlc3RDbGFzczIpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MyKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS50ZXN0KS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuXG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMSA9IGNvbnRhaW5lci5yZXNvbHZlKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UxKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuXG4gICAgICAgIH0pXG5cbiAgICAgICAgaXQoJ2ltcG9ydHMgYW4gZW1wdHkgbW9kdWxlIHdpdGhvdXQgZXJyb3JzJywgKCkgPT4ge1xuICAgICAgICAgICAgY2xhc3MgVGVzdE1vZHVsZSB7IH1cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoVGVzdE1vZHVsZSwgeyBpbXBvcnRzOiBbXSwgZXhwb3J0czogW10sIHByb3ZpZGVyczogW10gfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSk7XG4gICAgICAgICAgICBleHBlY3QobW9kdWxlKS50b0JlRGVmaW5lZCgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVnaXN0ZXJzIG5lc3RlZCBtb2R1bGVzIGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgICAgICAgIGNsYXNzIE5lc3RlZE1vZHVsZSB7IH1cbiAgICAgICAgICAgIGNsYXNzIFRlc3RNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoTmVzdGVkTW9kdWxlLCB7XG4gICAgICAgICAgICAgICAgaW1wb3J0czogW10sXG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbIHsgcHJvdmlkZTogJ25lc3RlZERlcCcsIHVzZVZhbHVlOiAnbmVzdGVkVmFsdWUnIH0gXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbICduZXN0ZWREZXAnIF0sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShUZXN0TW9kdWxlLCB7XG4gICAgICAgICAgICAgICAgaW1wb3J0czogWyBOZXN0ZWRNb2R1bGUgXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbICduZXN0ZWREZXAnIF0sXG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSk7XG4gICAgICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlID0gY29udGFpbmVyLnJlc29sdmUoJ25lc3RlZERlcCcpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkVmFsdWUpLnRvQmUoJ25lc3RlZFZhbHVlJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCd0aHJvd3MgYW4gZXJyb3IgaWYgYW4gZXhwb3J0IGlzIG5vdCBwcm92aWRlZCcsICgpID0+IHtcbiAgICAgICAgICAgIGNsYXNzIFRlc3RNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoVGVzdE1vZHVsZSwge1xuICAgICAgICAgICAgICAgIGltcG9ydHM6IFtdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ21pc3NpbmdEZXAnIF0sXG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIubW9kdWxlKFRlc3RNb2R1bGUpKS50b1Rocm93KCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ01vZHVsZXMgd2l0aCBARElNb2R1bGUoKScsICgpID0+IHtcbiAgICAgICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIuY2xlYXIoKTtcbiAgICAgICAgICAgIERJQ29udGFpbmVyLkRJTWV0YWRhdGFTdG9yZS5jbGVhck1ldGFkYXRhKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZWdpc3RlcnMgYSBtb2R1bGUgd2l0aCBARElNb2R1bGUnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzQSB7IH1cblxuICAgICAgICAgICAgQERJTW9kdWxlKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFtcbiAgICAgICAgICAgICAgICAgICAgeyB1c2VDbGFzczogVGVzdENsYXNzQSwgcHJvdmlkZTogJ3Rlc3QnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgdXNlVmFsdWU6ICd0ZXN0JywgcHJvdmlkZTogJ3Rlc3RWYWx1ZScgfSxcbiAgICAgICAgICAgICAgICAgICAgeyB1c2VGYWN0b3J5OiAoKSA9PiAndGVzdCcsIHByb3ZpZGU6ICd0ZXN0RmFjdG9yeScgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAndGVzdFZhbHVlJyBdXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY2xhc3MgVGVzdE1vZHVsZSB7IH1cblxuICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gY29udGFpbmVyLm1vZHVsZShUZXN0TW9kdWxlKTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NBPigndGVzdFZhbHVlJyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmUoJ3Rlc3QnKTtcblxuICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5yZXNvbHZlKCd0ZXN0JykpLnRvVGhyb3coKTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UyID0gbW9kdWxlLmNvbnRhaW5lci5yZXNvbHZlKCd0ZXN0Jyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UyKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3NBKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2ltcG9ydHMgYW4gZW1wdHkgbW9kdWxlIHdpdGhvdXQgZXJyb3JzJywgKCkgPT4ge1xuICAgICAgICAgICAgQERJTW9kdWxlKHsgaW1wb3J0czogW10sIGV4cG9ydHM6IFtdLCBwcm92aWRlcnM6IFtdIH0pXG4gICAgICAgICAgICBjbGFzcyBUZXN0TW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBjb250YWluZXIubW9kdWxlKFRlc3RNb2R1bGUpO1xuICAgICAgICAgICAgZXhwZWN0KG1vZHVsZSkudG9CZURlZmluZWQoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3JlZ2lzdGVycyBuZXN0ZWQgbW9kdWxlcyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICAgICAgICBARElNb2R1bGUoe1xuICAgICAgICAgICAgICAgIGltcG9ydHM6IFtdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ25lc3RlZERlcCcgXSxcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgeyBwcm92aWRlOiAnbmVzdGVkRGVwJywgdXNlVmFsdWU6ICduZXN0ZWRWYWx1ZScgfSBdXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgY2xhc3MgTmVzdGVkTW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBARElNb2R1bGUoe1xuICAgICAgICAgICAgICAgIGltcG9ydHM6IFsgTmVzdGVkTW9kdWxlIF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnbmVzdGVkRGVwJyBdLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogW11cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjbGFzcyBUZXN0TW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBjb250YWluZXIubW9kdWxlKFRlc3RNb2R1bGUpO1xuXG4gICAgICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlID0gY29udGFpbmVyLnJlc29sdmUoJ25lc3RlZERlcCcpO1xuXG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRWYWx1ZSkudG9CZSgnbmVzdGVkVmFsdWUnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Rocm93cyBhbiBlcnJvciBpZiBhbiBleHBvcnQgaXMgbm90IHByb3ZpZGVkJywgKCkgPT4ge1xuICAgICAgICAgICAgQERJTW9kdWxlKHtcbiAgICAgICAgICAgICAgICBpbXBvcnRzOiBbXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbICdtaXNzaW5nRGVwJyBdLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogW11cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjbGFzcyBUZXN0TW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLm1vZHVsZShUZXN0TW9kdWxlKSkudG9UaHJvdygpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnTWFrZSBASW5qZWN0YWJsZSByZWdpc3RlciBwcm92aWRlciB3aXRoIHNwZWNpZmljIG1vZHVsZScsICgpID0+IHtcbiAgICAgICAgICAgIEBESU1vZHVsZSh7fSlcbiAgICAgICAgICAgIGNsYXNzIFRlc3RNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKHsgcHJvdmlkZWRJbjogVGVzdE1vZHVsZSB9KVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHsgfVxuXG4gICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBjb250YWluZXIubW9kdWxlKFRlc3RNb2R1bGUpO1xuXG4gICAgICAgICAgICBleHBlY3QobW9kdWxlLmNvbnRhaW5lci5yZXNvbHZlKFRlc3RDbGFzcykpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0RJQ29udGFpbmVyIC0gaGFzQ2hpbGRDb250YWluZXJCeUlkJywgKCkgPT4ge1xuICAgICAgICBsZXQgY29udGFpbmVyOiBESUNvbnRhaW5lcjtcblxuICAgICAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgICAgICAgIGNvbnRhaW5lciA9IG5ldyBESUNvbnRhaW5lcigpO1xuICAgICAgICAgICAgRElDb250YWluZXIuRElNZXRhZGF0YVN0b3JlLmNsZWFyTWV0YWRhdGEoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gdHJ1ZSBpZiBhIGRpcmVjdCBjaGlsZCBjb250YWluZXIgaGFzIHRoZSBpZGVudGlmaWVyJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIxID0gY29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdjaGlsZDEnKTtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyMiA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQyJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKCdjaGlsZDEnKSkudG9CZSh0cnVlKTtcbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKCdjaGlsZDInKSkudG9CZSh0cnVlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gdHJ1ZSBpZiBhIG5lc3RlZCBjaGlsZCBjb250YWluZXIgaGFzIHRoZSBpZGVudGlmaWVyJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIxID0gY29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdjaGlsZDEnKTtcbiAgICAgICAgICAgIGNvbnN0IG5lc3RlZENoaWxkQ29udGFpbmVyID0gY2hpbGRDb250YWluZXIxLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCduZXN0ZWQtY2hpbGQxJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKCduZXN0ZWQtY2hpbGQxJykpLnRvQmUodHJ1ZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIGZhbHNlIGlmIG5vIGNoaWxkIGNvbnRhaW5lciBoYXMgdGhlIGlkZW50aWZpZXInLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lcjEgPSBjb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ2NoaWxkMScpO1xuXG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyLmhhc0NoaWxkQ29udGFpbmVyQnlJZCgnbm9uLWV4aXN0ZW50JykpLnRvQmUoZmFsc2UpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJldHVybiBmYWxzZSBpZiB0aGVyZSBhcmUgbm8gY2hpbGQgY29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKCdhbnktaWQnKSkudG9CZShmYWxzZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIHRydWUgaWYgYSBuZXN0ZWQgY2hpbGQgY29udGFpbmVyIGhhcyB0aGUgaWRlbnRpZmllciBldmVuIGlmIHRoZSBkaXJlY3QgY2hpbGQgZG9lcyBub3QnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lcjEgPSBjb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ2NoaWxkMScpO1xuICAgICAgICAgICAgY29uc3QgbmVzdGVkQ2hpbGRDb250YWluZXIgPSBjaGlsZENvbnRhaW5lcjEuY3JlYXRlQ2hpbGRDb250YWluZXIoJ25lc3RlZC1jaGlsZDEnKTtcblxuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQoJ25lc3RlZC1jaGlsZDEnKSkudG9CZSh0cnVlKTtcbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKCdjaGlsZDEnKSkudG9CZSh0cnVlKTtcbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKCdub24tZXhpc3RlbnQnKSkudG9CZShmYWxzZSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1Byb3ZpZGVyIFJlZ2lzdHJhdGlvbiB3aXRob3V0IGEgYHByb3ZpZGVgIEtleScsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCB0aHJvdyBhbiBlcnJvciB3aGVuIHJlZ2lzdGVyaW5nIGEgcHJvdmlkZXIgd2l0aG91dCBhIGBwcm92aWRlYCBrZXknLCAoKSA9PiB7XG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3MgeyB9XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUNsYXNzOiBUZXN0Q2xhc3MgfSBhcyBhbnkpO1xuICAgICAgICAgICAgfSkudG9UaHJvdygpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdTY29wZWQgUHJvdmlkZXIgUmVnaXN0cmF0aW9uJywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIGNyZWF0ZSBkaWZmZXJlbnQgaW5zdGFuY2VzIGZvciBzY29wZWQgcHJvdmlkZXJzIGluIGRpZmZlcmVudCBjaGlsZCBjb250YWluZXJzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKHsgc2luZ2xldG9uOiBmYWxzZSB9KVxuICAgICAgICAgICAgY2xhc3MgU2NvcGVkU2VydmljZSB7IH1cblxuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IFNjb3BlZFNlcnZpY2UsIHByb3ZpZGU6ICdTY29wZWRTZXJ2aWNlJywgc2luZ2xldG9uOiBmYWxzZSB9KTtcblxuICAgICAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIxID0gY29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdjaGlsZDEnKTtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyMiA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQyJyk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMSA9IGNoaWxkQ29udGFpbmVyMS5yZXNvbHZlPFNjb3BlZFNlcnZpY2U+KCdTY29wZWRTZXJ2aWNlJyk7XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTIgPSBjaGlsZENvbnRhaW5lcjIucmVzb2x2ZTxTY29wZWRTZXJ2aWNlPignU2NvcGVkU2VydmljZScpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UxKS50b0JlSW5zdGFuY2VPZihTY29wZWRTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTIpLnRvQmVJbnN0YW5jZU9mKFNjb3BlZFNlcnZpY2UpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlMSkubm90LnRvQmUoaW5zdGFuY2UyKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnUHJvdmlkZXIgQ29uZGl0aW9uIEZ1bmN0aW9uIEV2YWx1YXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgcmVnaXN0ZXIgcHJvdmlkZXIgYmFzZWQgb24gZHluYW1pYyBydW50aW1lIGNvbmRpdGlvbnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPHN0cmluZz4oJ0R5bmFtaWNDb25kaXRpb25TZXJ2aWNlJyk7XG4gICAgICAgICAgICBjb25zdCBjb25kaXRpb25GbiA9IGplc3QuZm4oKCkgPT4gTWF0aC5yYW5kb20oKSA+IDAuNSk7XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSh7IGNvbmRpdGlvbjogY29uZGl0aW9uRm4gfSlcbiAgICAgICAgICAgIGNsYXNzIER5bmFtaWNDb25kaXRpb25TZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogRHluYW1pY0NvbmRpdGlvblNlcnZpY2UsIHByb3ZpZGU6IHRva2VuLCBjb25kaXRpb246IGNvbmRpdGlvbkZuIH0pO1xuXG4gICAgICAgICAgICBpZiAoY29udGFpbmVyLmhhcyh0b2tlbikpIHtcbiAgICAgICAgICAgICAgICBleHBlY3QoY29udGFpbmVyLnJlc29sdmUodG9rZW4pKS50b0JlSW5zdGFuY2VPZihEeW5hbWljQ29uZGl0aW9uU2VydmljZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIucmVzb2x2ZSh0b2tlbikpLnRvVGhyb3coKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZXhwZWN0KGNvbmRpdGlvbkZuKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0FzeW5jIExpZmVjeWNsZSBIb29rcycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBjYWxsIGFzeW5jIGxpZmVjeWNsZSBob29rcyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBvbkluaXRTcHkgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodHJ1ZSk7XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3Mge1xuICAgICAgICAgICAgICAgIEBPbkluaXQoKVxuICAgICAgICAgICAgICAgIGFzeW5jIG9uSW5pdCgpIHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgb25Jbml0U3B5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlQXN5bmMoVGVzdENsYXNzKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KG9uSW5pdFNweSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdFcnJvciBIYW5kbGluZyBpbiBQcm92aWRlciBGYWN0b3JpZXMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgcHJvcGFnYXRlIGVycm9ycyBmcm9tIHByb3ZpZGVyIGZhY3RvcnkgZnVuY3Rpb25zJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdFcnJvckZhY3RvcnknKTtcbiAgICAgICAgICAgIGNvbnN0IGZhY3RvcnkgPSBqZXN0LmZuKCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhY3RvcnkgZXJyb3InKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VGYWN0b3J5OiBmYWN0b3J5LCBwcm92aWRlOiB0b2tlbiB9KTtcblxuICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5yZXNvbHZlKHRva2VuKSkudG9UaHJvdygnRmFjdG9yeSBlcnJvcicpO1xuICAgICAgICAgICAgZXhwZWN0KGZhY3RvcnkpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnSW5oZXJpdGFuY2UgQWNyb3NzIENvbnRhaW5lcnMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgc3VwcG9ydCBpbmhlcml0YW5jZSBhbmQgbWV0aG9kIG92ZXJyaWRpbmcgaW4gY2hpbGQgY29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBCYXNlU2VydmljZSB7XG4gICAgICAgICAgICAgICAgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdiYXNlJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIERlcml2ZWRTZXJ2aWNlIGV4dGVuZHMgQmFzZVNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIG92ZXJyaWRlIGdldE1lc3NhZ2UoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnZGVyaXZlZCc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogQmFzZVNlcnZpY2UsIHByb3ZpZGU6IEJhc2VTZXJ2aWNlLm5hbWUgfSk7XG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lciA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQnKTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IERlcml2ZWRTZXJ2aWNlLCBwcm92aWRlOiBEZXJpdmVkU2VydmljZS5uYW1lIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBiYXNlSW5zdGFuY2UgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlPEJhc2VTZXJ2aWNlPihCYXNlU2VydmljZSk7XG4gICAgICAgICAgICBjb25zdCBkZXJpdmVkSW5zdGFuY2UgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlPERlcml2ZWRTZXJ2aWNlPihEZXJpdmVkU2VydmljZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChiYXNlSW5zdGFuY2UuZ2V0TWVzc2FnZSgpKS50b0JlKCdiYXNlJyk7XG4gICAgICAgICAgICBleHBlY3QoZGVyaXZlZEluc3RhbmNlLmdldE1lc3NhZ2UoKSkudG9CZSgnZGVyaXZlZCcpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdEeW5hbWljIFByb3ZpZGVyIFJlc29sdXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgcmVzb2x2ZSBwcm92aWRlcnMgZHluYW1pY2FsbHkgYmFzZWQgb24gcnVudGltZSBkYXRhJywgKCkgPT4ge1xuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIENvbmZpZ3VyYWJsZVNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NvbmZpZycpIHB1YmxpYyBjb25maWc6IGFueSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGR5bmFtaWNDb25maWcgPSB7IHNldHRpbmc6ICd2YWx1ZScgfTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZVZhbHVlOiBkeW5hbWljQ29uZmlnLCBwcm92aWRlOiAnQ29uZmlnJyB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxDb25maWd1cmFibGVTZXJ2aWNlPihDb25maWd1cmFibGVTZXJ2aWNlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmNvbmZpZykudG9CZShkeW5hbWljQ29uZmlnKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnU2luZ2xldG9uIEJlaGF2aW9yIEFjcm9zcyBDaGlsZCBDb250YWluZXJzJywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIHNoYXJlIHNpbmdsZXRvbiBpbnN0YW5jZXMgYWNyb3NzIGNoaWxkIGNvbnRhaW5lcnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoeyBzaW5nbGV0b246IHRydWUgfSlcbiAgICAgICAgICAgIGNsYXNzIFNpbmdsZXRvblNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyMSA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQxJyk7XG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lcjIgPSBjb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ2NoaWxkMicpO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTEgPSBjaGlsZENvbnRhaW5lcjEucmVzb2x2ZTxTaW5nbGV0b25TZXJ2aWNlPihTaW5nbGV0b25TZXJ2aWNlKTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMiA9IGNoaWxkQ29udGFpbmVyMi5yZXNvbHZlPFNpbmdsZXRvblNlcnZpY2U+KFNpbmdsZXRvblNlcnZpY2UpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UxKS50b0JlKGluc3RhbmNlMik7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NpcmN1bGFyIERlcGVuZGVuY3kgRGV0ZWN0aW9uIHdpdGggTW9yZSBDb21wbGV4aXR5JywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBjaXJjdWxhciBkZXBlbmRlbmNpZXMgaW52b2x2aW5nIG1vcmUgdGhhbiB0d28gY2xhc3NlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSh7IHByb3ZpZGU6ICdDbGFzc0EnIH0pXG4gICAgICAgICAgICBjbGFzcyBDbGFzc0Ege1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NsYXNzQycpIHB1YmxpYyBjOiBhbnkpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSh7IHByb3ZpZGU6ICdDbGFzc0InIH0pXG4gICAgICAgICAgICBjbGFzcyBDbGFzc0Ige1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NsYXNzQScpIHB1YmxpYyBhOiBhbnkpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSh7IHByb3ZpZGU6ICdDbGFzc0MnIH0pXG4gICAgICAgICAgICBjbGFzcyBDbGFzc0Mge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NsYXNzQicpIHB1YmxpYyBiOiBhbnkpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyLnJlc29sdmUoJ0NsYXNzQScpKS50b0JlSW5zdGFuY2VPZihDbGFzc0EpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdIYW5kbGluZyBvZiBNaXNzaW5nIE9wdGlvbmFsIERlcGVuZGVuY2llcycsICgpID0+IHtcbiAgICAgICAgaXQoJ2NyZWF0ZXMgaW5zdGFuY2VzIHdpdGggZGVmYXVsdCB2YWx1ZXMgZm9yIG1pc3Npbmcgb3B0aW9uYWwgZGVwZW5kZW5jaWVzJywgKCkgPT4ge1xuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdCgnT3B0aW9uYWxEZXAnLCB7IGlzT3B0aW9uYWw6IHRydWUsIGRlZmF1bHRWYWx1ZTogJ2RlZmF1bHQnIH0pIHB1YmxpYyBkZXA/OiBzdHJpbmcpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzcz4oVGVzdENsYXNzKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmRlcCkudG9CZSgnZGVmYXVsdCcpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdQcm92aWRlciBSZXBsYWNlbWVudCBhbmQgUHJpb3JpdHkgRWRnZSBDYXNlcycsICgpID0+IHtcbiAgICAgICAgaXQoJ2hhbmRsZXMgcHJvdmlkZXJzIHdpdGggdGhlIHNhbWUgcHJpb3JpdHkgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzQSB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IHN0cmluZyA9ICdBJztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzQiB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IHN0cmluZyA9ICdCJztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0EsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDFcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQixcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQj4oJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS52YWx1ZSkudG9CZSgnQScpOyAvLyBUaGUgZmlyc3QgcmVnaXN0ZXJlZCBwcm92aWRlciBzaG91bGQgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0FzeW5jIEZhY3RvcnkgRnVuY3Rpb25zJywgKCkgPT4ge1xuICAgICAgICBpdCgncmVzb2x2ZXMgcHJvdmlkZXJzIHJlZ2lzdGVyZWQgd2l0aCBhc3luYyBmYWN0b3J5IGZ1bmN0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignQXN5bmNGYWN0b3J5Jyk7XG4gICAgICAgICAgICBjb25zdCBmYWN0b3J5ID0gYXN5bmMgKCkgPT4gJ2FzeW5jIHRlc3QnO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VGYWN0b3J5OiBmYWN0b3J5LCBwcm92aWRlOiB0b2tlbiB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jKHRva2VuKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZSgnYXN5bmMgdGVzdCcpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdFZGdlIENhc2VzIGZvciBNaWRkbGV3YXJlJywgKCkgPT4ge1xuICAgICAgICBpdCgnbWlkZGxld2FyZSBjYW4gc2tpcCB0aGUgbmV4dCBmdW5jdGlvbicsICgpID0+IHtcblxuICAgICAgICAgICAgY29uc3QgbWlkZGxld2FyZVNweSA9IGplc3QuZm4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIFNraXAgdGhlIG5leHQgZnVuY3Rpb25cbiAgICAgICAgICAgICAgICByZXR1cm4gJ3Nob3J0LWNpcmN1aXRlZCc7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLnVzZU1pZGRsZXdhcmUoeyBtaWRkbGV3YXJlOiBtaWRkbGV3YXJlU3B5IH0pO1xuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgTWlkZGxld2FyZVNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8YW55PignTWlkZGxld2FyZVNlcnZpY2UnKTtcblxuICAgICAgICAgICAgZXhwZWN0KG1pZGRsZXdhcmVTcHkpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZSgnc2hvcnQtY2lyY3VpdGVkJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdoYW5kbGVzIGVycm9ycyBpbiBtaWRkbGV3YXJlIGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ01pZGRsZXdhcmUgZXJyb3InKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7IG1pZGRsZXdhcmU6IG1pZGRsZXdhcmVTcHkgfSk7XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBNaWRkbGV3YXJlU2VydmljZSB7IH1cblxuICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5yZXNvbHZlPE1pZGRsZXdhcmVTZXJ2aWNlPignTWlkZGxld2FyZVNlcnZpY2UnKSkudG9UaHJvdygnTWlkZGxld2FyZSBlcnJvcicpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdDb25kaXRpb25hbCBQcm92aWRlcnMgd2l0aCBEZXBlbmRlbmNpZXMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdyZXNvbHZlcyBjb25kaXRpb25hbCBwcm92aWRlcnMgd2l0aCBkZXBlbmRlbmNpZXMgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdDb25kaXRpb25hbFNlcnZpY2UnKTtcblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIERlcGVuZGVuY3kgeyB9XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSh7IGNvbmRpdGlvbjogKCkgPT4gdHJ1ZSB9KVxuICAgICAgICAgICAgY2xhc3MgQ29uZGl0aW9uYWxTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KERlcGVuZGVuY3kpIHB1YmxpYyBkZXBlbmRlbmN5OiBEZXBlbmRlbmN5KSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IERlcGVuZGVuY3ksIHByb3ZpZGU6IERlcGVuZGVuY3kubmFtZSB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxDb25kaXRpb25hbFNlcnZpY2U+KCdDb25kaXRpb25hbFNlcnZpY2UnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoQ29uZGl0aW9uYWxTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5kZXBlbmRlbmN5KS50b0JlSW5zdGFuY2VPZihEZXBlbmRlbmN5KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQXN5bmMgRXJyb3IgSGFuZGxpbmcnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdoYW5kbGVzIGVycm9ycyBpbiBhc3luYyBsaWZlY3ljbGUgaG9va3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBvbkluaXRTcHkgPSBqZXN0LmZuKCkubW9ja1JlamVjdGVkVmFsdWUobmV3IEVycm9yKCdBc3luYyBpbml0IGVycm9yJykpO1xuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICBAT25Jbml0KClcbiAgICAgICAgICAgICAgICBhc3luYyBvbkluaXQoKSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IG9uSW5pdFNweSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgZXhwZWN0KGNvbnRhaW5lci5yZXNvbHZlQXN5bmMoVGVzdENsYXNzKSkucmVqZWN0cy50b1Rocm93KCdBc3luYyBpbml0IGVycm9yJyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NvbXBsZXggSW5oZXJpdGFuY2UgYW5kIEludGVyZmFjZSBJbXBsZW1lbnRhdGlvbnMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdyZXNvbHZlcyBjbGFzc2VzIGltcGxlbWVudGluZyBpbnRlcmZhY2VzIGFuZCBleHRlbmRpbmcgb3RoZXIgY2xhc3NlcycsICgpID0+IHtcbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBCYXNlU2VydmljZSB7XG4gICAgICAgICAgICAgICAgZ2V0U2VydmljZU5hbWUoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnQmFzZVNlcnZpY2UnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaW50ZXJmYWNlIElTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBnZXRTZXJ2aWNlTmFtZSgpOiBzdHJpbmc7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBEZXJpdmVkU2VydmljZSBleHRlbmRzIEJhc2VTZXJ2aWNlIGltcGxlbWVudHMgSVNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIG92ZXJyaWRlIGdldFNlcnZpY2VOYW1lKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0Rlcml2ZWRTZXJ2aWNlJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8RGVyaXZlZFNlcnZpY2U+KERlcml2ZWRTZXJ2aWNlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihEZXJpdmVkU2VydmljZSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuZ2V0U2VydmljZU5hbWUoKSkudG9CZSgnRGVyaXZlZFNlcnZpY2UnKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnUmVjdXJzaXZlIERlcGVuZGVuY3kgUmVzb2x1dGlvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Jlc29sdmVzIHByb3ZpZGVycyB0aGF0IGRlcGVuZCBvbiBkeW5hbWljYWxseSByZXNvbHZlZCBwcm92aWRlcnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgRHluYW1pY1Byb3ZpZGVyIHtcbiAgICAgICAgICAgICAgICBnZXRWYWx1ZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdkeW5hbWljIHZhbHVlJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdChEeW5hbWljUHJvdmlkZXIpIHB1YmxpYyBwcm92aWRlcjogRHluYW1pY1Byb3ZpZGVyKSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UucHJvdmlkZXIuZ2V0VmFsdWUoKSkudG9CZSgnZHluYW1pYyB2YWx1ZScpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdMaWZlY3ljbGUgSG9va3MgT3JkZXInLCAoKSA9PiB7XG4gICAgICAgIGl0KCdjYWxscyBsaWZlY3ljbGUgaG9va3MgaW4gdGhlIGNvcnJlY3Qgb3JkZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBvbkluaXRTcHkxID0gamVzdC5mbigpO1xuICAgICAgICAgICAgY29uc3Qgb25Jbml0U3B5MiA9IGplc3QuZm4oKTtcblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIEZpcnN0U2VydmljZSB7XG4gICAgICAgICAgICAgICAgQE9uSW5pdCgpXG4gICAgICAgICAgICAgICAgb25Jbml0KCkge1xuICAgICAgICAgICAgICAgICAgICBvbkluaXRTcHkxKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2Vjb25kU2VydmljZSB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdChGaXJzdFNlcnZpY2UpIHB1YmxpYyBmaXJzdFNlcnZpY2U6IEZpcnN0U2VydmljZSkgeyB9XG5cbiAgICAgICAgICAgICAgICBAT25Jbml0KClcbiAgICAgICAgICAgICAgICBvbkluaXQoKSB7XG4gICAgICAgICAgICAgICAgICAgIG9uSW5pdFNweTIoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYzxTZWNvbmRTZXJ2aWNlPihTZWNvbmRTZXJ2aWNlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZWNvbmRTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChvbkluaXRTcHkxKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ01pZGRsZXdhcmUgU3RhdGUgTWFuYWdlbWVudCcsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBtYWludGFpbiBhbmQgbW9kaWZ5IHN0YXRlIGFjcm9zcyBtdWx0aXBsZSByZXNvbHV0aW9ucyB1c2luZyBtaWRkbGV3YXJlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbWlkZGxld2FyZVNweSA9IGplc3QuZm4oKG5leHQpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdGF0ZSA9IHsgY291bnRlcjogMCB9O1xuICAgICAgICAgICAgICAgIHN0YXRlLmNvdW50ZXIrKztcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBuZXh0KCk7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnN0YXRlID0gc3RhdGU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7IG1pZGRsZXdhcmU6IG1pZGRsZXdhcmVTcHkgfSk7XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSh7IHNpbmdsZXRvbjogZmFsc2UgfSkgIC8vIEVuc3VyZSBlYWNoIHJlc29sdXRpb24gY3JlYXRlcyBhIG5ldyBpbnN0YW5jZSAgICAgICAgICAgIGNsYXNzIFN0YXRlZnVsU2VydmljZSB7fVxuICAgICAgICAgICAgY2xhc3MgU3RhdGVmdWxTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTEgPSBjb250YWluZXIucmVzb2x2ZTxhbnk+KCdTdGF0ZWZ1bFNlcnZpY2UnKTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMiA9IGNvbnRhaW5lci5yZXNvbHZlPGFueT4oJ1N0YXRlZnVsU2VydmljZScpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UxLnN0YXRlLmNvdW50ZXIpLnRvQmUoMSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UyLnN0YXRlLmNvdW50ZXIpLnRvQmUoMSk7IC8vIE1pZGRsZXdhcmUgY3JlYXRlcyBuZXcgc3RhdGUgZm9yIGVhY2ggcmVzb2x1dGlvblxuICAgICAgICAgICAgZXhwZWN0KG1pZGRsZXdhcmVTcHkpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ29uZmlnIHJlc29sdmVDb25maWcnLCAoKSA9PiB7XG4gICAgICAgIGxldCByb290Q29udGFpbmVyOiBESUNvbnRhaW5lcjtcbiAgICAgICAgbGV0IGNoaWxkQ29udGFpbmVyOiBESUNvbnRhaW5lcjtcblxuICAgICAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgICAgICAgIERJQ29udGFpbmVyLkRJTWV0YWRhdGFTdG9yZS5jbGVhck1ldGFkYXRhKCk7XG4gICAgICAgICAgICByb290Q29udGFpbmVyID0gbmV3IERJQ29udGFpbmVyKHVuZGVmaW5lZCwgJ1JPT1QnKTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyID0gcm9vdENvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignQ0hJTEQnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZWdpc3RlciBhbmQgcmVzb2x2ZSBjb25maWd1cmF0aW9uIGZyb20gdGhlIHJvb3QgY29udGFpbmVyJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnUHJvdmlkZXI6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwLm5hbWUnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogJ1Rlc3RBcHAnLFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAxLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKGNvbmZpZ1Byb3ZpZGVyKTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSByb290Q29udGFpbmVyLnJlc29sdmVDb25maWcoJ2FwcC5uYW1lJyk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWcpLnRvQmUoJ1Rlc3RBcHAnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBtZXJnZSBhbmQgcmVzb2x2ZSBjb25maWd1cmF0aW9ucyBmcm9tIHBhcmVudCBhbmQgY2hpbGQgY29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJvb3RDb25maWdQcm92aWRlcjogQ29uZmlnUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogeyBuYW1lOiAnVGVzdEFwcCcsIHZlcnNpb246ICcxLjAnIH0sXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbmZpZ1Byb3ZpZGVyOiBDb25maWdQcm92aWRlck9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcCcsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7IHZlcnNpb246ICcyLjAnIH0sXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIocm9vdENvbmZpZ1Byb3ZpZGVyKTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoY2hpbGRDb25maWdQcm92aWRlcik7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkQ29uZmlnID0gY2hpbGRDb250YWluZXIucmVzb2x2ZUNvbmZpZygnYXBwJyk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWcpLnRvRXF1YWwoeyBuYW1lOiAnVGVzdEFwcCcsIHZlcnNpb246ICcyLjAnIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJlc3BlY3QgcHJpb3JpdHkgd2hlbiByZXNvbHZpbmcgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxvd1ByaW9yaXR5Q29uZmlnOiBDb25maWdQcm92aWRlck9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcC5uYW1lJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6ICdMb3dQcmlvcml0eUFwcCcsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBoaWdoUHJpb3JpdHlDb25maWc6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwLm5hbWUnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogJ0hpZ2hQcmlvcml0eUFwcCcsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDIsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIobG93UHJpb3JpdHlDb25maWcpO1xuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKGhpZ2hQcmlvcml0eUNvbmZpZyk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkQ29uZmlnID0gcm9vdENvbnRhaW5lci5yZXNvbHZlQ29uZmlnKCdhcHAubmFtZScpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkQ29uZmlnKS50b0JlKCdIaWdoUHJpb3JpdHlBcHAnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBmaWx0ZXIgY29uZmlndXJhdGlvbnMgYmFzZWQgb24gdGFncycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZ1dpdGhUYWc6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwLm5hbWUnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogJ1RhZ2dlZEFwcCcsXG4gICAgICAgICAgICAgICAgdGFnczogWyAncmVsZWFzZScgXSxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZ1dpdGhvdXRUYWc6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwLm5hbWUnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogJ1VudGFnZ2VkQXBwJyxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcihjb25maWdXaXRoVGFnKTtcbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcihjb25maWdXaXRob3V0VGFnKTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRDb25maWdXaXRoVGFncyA9IHJvb3RDb250YWluZXIucmVzb2x2ZUNvbmZpZygnYXBwLm5hbWUnLCB7XG4gICAgICAgICAgICAgICAgdGFnczogWyAncmVsZWFzZScgXSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkQ29uZmlnV2l0aFRhZ3MpLnRvQmUoJ1RhZ2dlZEFwcCcpO1xuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdGhyb3cgZm9yIG5vbi1leGlzdGVudCBjb25maWd1cmF0aW9uIHBhdGhzJywgKCkgPT4ge1xuICAgICAgICAgICAgZXhwZWN0KCgpID0+IHJvb3RDb250YWluZXIucmVzb2x2ZUNvbmZpZygnbm9uLmV4aXN0ZW50LnBhdGgnKSkudG9UaHJvdygpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHByZXNlcnZlIGFycmF5cyBpbiBjb25maWd1cmF0aW9uIChub3QgY29udmVydCB0byBvYmplY3RzKScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZ1dpdGhBcnJheXM6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGJhY2tlbmRzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7IHR5cGU6ICdjbG91ZHdhdGNoJywgZW5hYmxlZDogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgeyB0eXBlOiAnZHluYW1vZGInLCBlbmFibGVkOiB0cnVlIH1cbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YVByb3RlY3Rpb246IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJsYWNrbGlzdGVkS2V5czogWydwYXNzd29yZCcsICdzZWNyZXQnLCAnYXBpS2V5J11cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoY29uZmlnV2l0aEFycmF5cyk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkQ29uZmlnOiBhbnkgPSByb290Q29udGFpbmVyLnJlc29sdmVDb25maWcoJ29ic2VydmFiaWxpdHknKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVmVyaWZ5IGFycmF5cyBhcmUgcHJlc2VydmVkIGFzIGFycmF5cywgbm90IGNvbnZlcnRlZCB0byBvYmplY3RzXG4gICAgICAgICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShyZXNvbHZlZENvbmZpZy5iYWNrZW5kcykpLnRvQmUodHJ1ZSk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWcuYmFja2VuZHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZENvbmZpZy5iYWNrZW5kc1swXS50eXBlKS50b0JlKCdjbG91ZHdhdGNoJyk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWcuYmFja2VuZHNbMV0udHlwZSkudG9CZSgnZHluYW1vZGInKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVmVyaWZ5IGFycmF5IG1ldGhvZHMgd29ya1xuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkQ29uZmlnLmJhY2tlbmRzLmZpbHRlcigoYjogYW55KSA9PiBiLnR5cGUgPT09ICdjbG91ZHdhdGNoJykpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZENvbmZpZy5iYWNrZW5kcy5tYXAoKGI6IGFueSkgPT4gYi50eXBlKSkudG9FcXVhbChbJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInXSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFZlcmlmeSBuZXN0ZWQgYXJyYXlzXG4gICAgICAgICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShyZXNvbHZlZENvbmZpZy5kYXRhUHJvdGVjdGlvbi5ibGFja2xpc3RlZEtleXMpKS50b0JlKHRydWUpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkQ29uZmlnLmRhdGFQcm90ZWN0aW9uLmJsYWNrbGlzdGVkS2V5cykudG9Db250YWluKCdwYXNzd29yZCcpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkQ29uZmlnLmRhdGFQcm90ZWN0aW9uLmJsYWNrbGlzdGVkS2V5cy5pbmNsdWRlcygnc2VjcmV0JykpLnRvQmUodHJ1ZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcHJlc2VydmUgYXJyYXlzIHdoZW4gbWVyZ2luZyBjb25maWdzIHdpdGggZGlmZmVyZW50IHByaW9yaXRpZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBGcmFtZXdvcmsgZGVmYXVsdCAocHJpb3JpdHkgMClcbiAgICAgICAgICAgIGNvbnN0IGZyYW1ld29ya0NvbmZpZzogQ29uZmlnUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIGJhY2tlbmRzOiBbeyB0eXBlOiAnY2xvdWR3YXRjaCcsIGVuYWJsZWQ6IHRydWUgfV0sXG4gICAgICAgICAgICAgICAgICAgIHNlcnZpY2VOYW1lOiAnZGVmYXVsdC1zZXJ2aWNlJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDAsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBBcHAgb3ZlcnJpZGUgKHByaW9yaXR5IDEwKVxuICAgICAgICAgICAgY29uc3QgYXBwQ29uZmlnOiBDb25maWdQcm92aWRlck9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ29ic2VydmFiaWxpdHknLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICBiYWNrZW5kczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgeyB0eXBlOiAnY2xvdWR3YXRjaCcsIGVuYWJsZWQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgdHlwZTogJ2R5bmFtb2RiJywgZW5hYmxlZDogdHJ1ZSB9XG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIHNlcnZpY2VOYW1lOiAnbXktYXBwJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDEwLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKGZyYW1ld29ya0NvbmZpZyk7XG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoYXBwQ29uZmlnKTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRDb25maWc6IGFueSA9IHJvb3RDb250YWluZXIucmVzb2x2ZUNvbmZpZygnb2JzZXJ2YWJpbGl0eScpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBIaWdoZXIgcHJpb3JpdHkgY29uZmlnIHNob3VsZCB3aW5cbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZENvbmZpZy5lbmFibGVkKS50b0JlKHRydWUpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkQ29uZmlnLnNlcnZpY2VOYW1lKS50b0JlKCdteS1hcHAnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQXJyYXlzIHNob3VsZCBiZSBwcmVzZXJ2ZWQgZnJvbSB0aGUgd2lubmluZyBjb25maWdcbiAgICAgICAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KHJlc29sdmVkQ29uZmlnLmJhY2tlbmRzKSkudG9CZSh0cnVlKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZENvbmZpZy5iYWNrZW5kcykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHByZXNlcnZlIGVtcHR5IGFycmF5cyBpbiBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnV2l0aEVtcHR5QXJyYXk6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGl0ZW1zOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgbmVzdGVkOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbXB0eUxpc3Q6IFtdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAxLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKGNvbmZpZ1dpdGhFbXB0eUFycmF5KTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRDb25maWc6IGFueSA9IHJvb3RDb250YWluZXIucmVzb2x2ZUNvbmZpZygndGVzdCcpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShyZXNvbHZlZENvbmZpZy5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWcuaXRlbXMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICAgICAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KHJlc29sdmVkQ29uZmlnLm5lc3RlZC5lbXB0eUxpc3QpKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHByZXNlcnZlIGFycmF5cyBvZiBwcmltaXRpdmVzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnV2l0aFByaW1pdGl2ZUFycmF5czogQ29uZmlnUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgc3RyaW5nczogWydhJywgJ2InLCAnYyddLFxuICAgICAgICAgICAgICAgICAgICBudW1iZXJzOiBbMSwgMiwgM10sXG4gICAgICAgICAgICAgICAgICAgIG1peGVkOiBbJ2EnLCAxLCB0cnVlLCBudWxsXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoY29uZmlnV2l0aFByaW1pdGl2ZUFycmF5cyk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkQ29uZmlnOiBhbnkgPSByb290Q29udGFpbmVyLnJlc29sdmVDb25maWcoJ3Rlc3QnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZXhwZWN0KHJlc29sdmVkQ29uZmlnLnN0cmluZ3MpLnRvRXF1YWwoWydhJywgJ2InLCAnYyddKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZENvbmZpZy5udW1iZXJzKS50b0VxdWFsKFsxLCAyLCAzXSk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWcubWl4ZWQpLnRvRXF1YWwoWydhJywgMSwgdHJ1ZSwgbnVsbF0pO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuXG4gICAgZGVzY3JpYmUoJ0RJIENvbnRhaW5lciBTZWxmIEluamVjdGlvbicsICgpID0+IHtcbiAgICAgICAgbGV0IHJvb3RDb250YWluZXI6IERJQ29udGFpbmVyO1xuXG4gICAgICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICAgICAgcm9vdENvbnRhaW5lciA9IG5ldyBESUNvbnRhaW5lcih1bmRlZmluZWQsICdST09UJyk7XG4gICAgICAgICAgICBESUNvbnRhaW5lci5ESU1ldGFkYXRhU3RvcmUuY2xlYXJNZXRhZGF0YSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGluamVjdCBESUNvbnRhaW5lciBpbnRvIGEgc2VydmljZScsICgpID0+IHtcbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoQ29udGFpbmVyIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbnRhaW5lcigpIHByaXZhdGUgY29udGFpbmVyOiBESUNvbnRhaW5lclxuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRDb250YWluZXJJZGVudGlmaWVyKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbnRhaW5lci5jb250YWluZXJJZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXIoeyBwcm92aWRlOiBTZXJ2aWNlV2l0aENvbnRhaW5lciwgdXNlQ2xhc3M6IFNlcnZpY2VXaXRoQ29udGFpbmVyIH0pO1xuICAgICAgICAgICAgY29uc3Qgc2VydmljZUluc3RhbmNlID0gcm9vdENvbnRhaW5lci5yZXNvbHZlKFNlcnZpY2VXaXRoQ29udGFpbmVyKTtcblxuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoU2VydmljZVdpdGhDb250YWluZXIpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0Q29udGFpbmVySWRlbnRpZmllcigpKS50b0JlKCdST09UJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmVzb2x2ZSBkZXBlbmRlbmNpZXMgYW5kIGluamVjdCBESUNvbnRhaW5lcicsICgpID0+IHtcbiAgICAgICAgICAgIC8vIEFub3RoZXIgbW9jayBzZXJ2aWNlIGNsYXNzIHRvIHRlc3QgZGVwZW5kZW5jeSByZXNvbHV0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBBbm90aGVyU2VydmljZSB7XG4gICAgICAgICAgICAgICAgZ2V0VmFsdWUoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdIZWxsbyBmcm9tIEFub3RoZXJTZXJ2aWNlJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFNlcnZpY2UgY2xhc3MgdGhhdCBkZXBlbmRzIG9uIGFub3RoZXIgc2VydmljZSBhbmQgdGhlIGNvbnRhaW5lclxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZVdpdGhEZXBlbmRlbmNpZXMge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0KEFub3RoZXJTZXJ2aWNlKSBwcml2YXRlIGFub3RoZXJTZXJ2aWNlOiBBbm90aGVyU2VydmljZSxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbnRhaW5lcigpIHByaXZhdGUgY29udGFpbmVyOiBESUNvbnRhaW5lclxuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRTZXJ2aWNlVmFsdWUoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYW5vdGhlclNlcnZpY2UuZ2V0VmFsdWUoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBnZXRDb250YWluZXJJZGVudGlmaWVyKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbnRhaW5lci5jb250YWluZXJJZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXIoeyBwcm92aWRlOiBBbm90aGVyU2VydmljZSwgdXNlQ2xhc3M6IEFub3RoZXJTZXJ2aWNlIH0pO1xuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoRGVwZW5kZW5jaWVzLCB1c2VDbGFzczogU2VydmljZVdpdGhEZXBlbmRlbmNpZXMgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IHJvb3RDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aERlcGVuZGVuY2llcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoRGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldFNlcnZpY2VWYWx1ZSgpKS50b0JlKCdIZWxsbyBmcm9tIEFub3RoZXJTZXJ2aWNlJyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRDb250YWluZXJJZGVudGlmaWVyKCkpLnRvQmUoJ1JPT1QnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXNvbHZlIGRlcGVuZGVuY2llcyBhbmQgaW5qZWN0IERJQ29udGFpbmVyIGFzIHByb3BlcnR5IGluamVjdGlvbicsICgpID0+IHtcbiAgICAgICAgICAgIC8vIEFub3RoZXIgbW9jayBzZXJ2aWNlIGNsYXNzIHRvIHRlc3QgZGVwZW5kZW5jeSByZXNvbHV0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBBbm90aGVyU2VydmljZSB7XG4gICAgICAgICAgICAgICAgZ2V0VmFsdWUoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdIZWxsbyBmcm9tIEFub3RoZXJTZXJ2aWNlJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMge1xuICAgICAgICAgICAgICAgIEBJbmplY3RDb250YWluZXIoKVxuICAgICAgICAgICAgICAgIHByaXZhdGUgY29udGFpbmVyPzogRElDb250YWluZXJcblxuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0KEFub3RoZXJTZXJ2aWNlKSBwcml2YXRlIGFub3RoZXJTZXJ2aWNlOiBBbm90aGVyU2VydmljZSxcbiAgICAgICAgICAgICAgICApIHsgfVxuXG4gICAgICAgICAgICAgICAgZ2V0U2VydmljZVZhbHVlKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFub3RoZXJTZXJ2aWNlLmdldFZhbHVlKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZ2V0Q29udGFpbmVySWRlbnRpZmllcigpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29udGFpbmVyPy5jb250YWluZXJJZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXIoeyBwcm92aWRlOiBBbm90aGVyU2VydmljZSwgdXNlQ2xhc3M6IEFub3RoZXJTZXJ2aWNlIH0pO1xuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aFByb3BlcnR5RGVwZW5kZW5jaWVzIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSByb290Q29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhQcm9wZXJ0eURlcGVuZGVuY2llcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0U2VydmljZVZhbHVlKCkpLnRvQmUoJ0hlbGxvIGZyb20gQW5vdGhlclNlcnZpY2UnKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldENvbnRhaW5lcklkZW50aWZpZXIoKSkudG9CZSgnUk9PVCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGluamVjdCBESUNvbnRhaW5lciBpbnRvIGEgc2VydmljZSB3aXRoIGNoaWxkIGNvbnRhaW5lcicsICgpID0+IHtcbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoQ29udGFpbmVyIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbnRhaW5lcigpIHByaXZhdGUgY29udGFpbmVyOiBESUNvbnRhaW5lclxuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRDb250YWluZXJJZGVudGlmaWVyKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbnRhaW5lci5jb250YWluZXJJZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyID0gcm9vdENvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignQ0hJTEQnKTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhDb250YWluZXIsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aENvbnRhaW5lciB9KTtcblxuICAgICAgICAgICAgY29uc3Qgc2VydmljZUluc3RhbmNlID0gY2hpbGRDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aENvbnRhaW5lcik7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoQ29udGFpbmVyKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldENvbnRhaW5lcklkZW50aWZpZXIoKSkudG9CZSgnQ0hJTEQnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXNvbHZlIGZyb20gY2hpbGQgY29udGFpbmVyIGFuZCBpbmplY3QgRElDb250YWluZXInLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBBbm90aGVyIG1vY2sgc2VydmljZSBjbGFzcyB0byB0ZXN0IGRlcGVuZGVuY3kgcmVzb2x1dGlvblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgQW5vdGhlclNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIGdldFZhbHVlKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnSGVsbG8gZnJvbSBBbm90aGVyU2VydmljZSc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZVdpdGhEZXBlbmRlbmNpZXMge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0KEFub3RoZXJTZXJ2aWNlKSBwcml2YXRlIGFub3RoZXJTZXJ2aWNlOiBBbm90aGVyU2VydmljZSxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbnRhaW5lcigpIHByaXZhdGUgY29udGFpbmVyOiBESUNvbnRhaW5lclxuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRTZXJ2aWNlVmFsdWUoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYW5vdGhlclNlcnZpY2UuZ2V0VmFsdWUoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBnZXRDb250YWluZXJJZGVudGlmaWVyKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbnRhaW5lci5jb250YWluZXJJZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lciA9IHJvb3RDb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ0NISUxEJyk7XG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IEFub3RoZXJTZXJ2aWNlLCB1c2VDbGFzczogQW5vdGhlclNlcnZpY2UgfSk7XG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoRGVwZW5kZW5jaWVzLCB1c2VDbGFzczogU2VydmljZVdpdGhEZXBlbmRlbmNpZXMgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhEZXBlbmRlbmNpZXMpO1xuXG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlV2l0aERlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRTZXJ2aWNlVmFsdWUoKSkudG9CZSgnSGVsbG8gZnJvbSBBbm90aGVyU2VydmljZScpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0Q29udGFpbmVySWRlbnRpZmllcigpKS50b0JlKCdDSElMRCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJlc29sdmUgZnJvbSBjaGlsZCBjb250YWluZXIgYW5kIGluamVjdCBESUNvbnRhaW5lciBhcyBwcm9wZXJ0eSBpbmplY3Rpb24nLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBBbm90aGVyIG1vY2sgc2VydmljZSBjbGFzcyB0byB0ZXN0IGRlcGVuZGVuY3kgcmVzb2x1dGlvblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgQW5vdGhlclNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIGdldFZhbHVlKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnSGVsbG8gZnJvbSBBbm90aGVyU2VydmljZSc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aFByb3BlcnR5RGVwZW5kZW5jaWVzIHtcbiAgICAgICAgICAgICAgICBASW5qZWN0Q29udGFpbmVyKClcbiAgICAgICAgICAgICAgICBwcml2YXRlIGNvbnRhaW5lcj86IERJQ29udGFpbmVyXG5cbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdChBbm90aGVyU2VydmljZSkgcHJpdmF0ZSBhbm90aGVyU2VydmljZTogQW5vdGhlclNlcnZpY2UsXG4gICAgICAgICAgICAgICAgKSB7IH1cblxuICAgICAgICAgICAgICAgIGdldFNlcnZpY2VWYWx1ZSgpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hbm90aGVyU2VydmljZS5nZXRWYWx1ZSgpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGdldENvbnRhaW5lcklkZW50aWZpZXIoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbnRhaW5lcj8uY29udGFpbmVySWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lciA9IHJvb3RDb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ0NISUxEJyk7XG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IEFub3RoZXJTZXJ2aWNlLCB1c2VDbGFzczogQW5vdGhlclNlcnZpY2UgfSk7XG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aFByb3BlcnR5RGVwZW5kZW5jaWVzIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlKFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMpO1xuXG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlV2l0aFByb3BlcnR5RGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldFNlcnZpY2VWYWx1ZSgpKS50b0JlKCdIZWxsbyBmcm9tIEFub3RoZXJTZXJ2aWNlJyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRDb250YWluZXJJZGVudGlmaWVyKCkpLnRvQmUoJ0NISUxEJyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NvbmZpZyBJbmplY3Rpb24gdmlhIERlY29yYXRvcicsICgpID0+IHtcbiAgICAgICAgbGV0IHJvb3RDb250YWluZXI6IERJQ29udGFpbmVyO1xuICAgICAgICBsZXQgY2hpbGRDb250YWluZXI6IERJQ29udGFpbmVyO1xuXG4gICAgICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICAgICAgRElDb250YWluZXIuRElNZXRhZGF0YVN0b3JlLmNsZWFyTWV0YWRhdGEoKTtcbiAgICAgICAgICAgIHJvb3RDb250YWluZXIgPSBuZXcgRElDb250YWluZXIodW5kZWZpbmVkLCAnUk9PVCcpO1xuICAgICAgICAgICAgY2hpbGRDb250YWluZXIgPSByb290Q29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdDSElMRCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGluamVjdCBjb25maWd1cmF0aW9uIGludG8gYSBzZXJ2aWNlIHZpYSBjb25zdHJ1Y3RvcicsICgpID0+IHtcbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcCcsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7IG5hbWU6ICdUZXN0QXBwJywgdmVyc2lvbjogJzEuMCcgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIE1vY2sgc2VydmljZSBjbGFzcyB0aGF0IHJlcXVpcmVzIGNvbmZpZ3VyYXRpb24gaW5qZWN0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aENvbmZpZyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC5uYW1lJykgcHJpdmF0ZSBhcHBOYW1lOiBzdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC52ZXJzaW9uJykgcHJpdmF0ZSBhcHBWZXJzaW9uOiBzdHJpbmdcbiAgICAgICAgICAgICAgICApIHsgfVxuXG4gICAgICAgICAgICAgICAgZ2V0QXBwRGV0YWlscygpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYEFwcDogJHt0aGlzLmFwcE5hbWV9LCBWZXJzaW9uOiAke3RoaXMuYXBwVmVyc2lvbn1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoQ29uZmlnLCB1c2VDbGFzczogU2VydmljZVdpdGhDb25maWcgfSk7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSByb290Q29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhDb25maWcpO1xuXG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlV2l0aENvbmZpZyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRBcHBEZXRhaWxzKCkpLnRvQmUoJ0FwcDogVGVzdEFwcCwgVmVyc2lvbjogMS4wJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaW5qZWN0IGNvbmZpZ3VyYXRpb24gaW50byBhIHNlcnZpY2UgdmlhIHByb3BlcnRpZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogeyBuYW1lOiAnVGVzdEFwcCcsIHZlcnNpb246ICcxLjAnIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBBbm90aGVyIHNlcnZpY2Ugd2l0aCBjb25maWd1cmF0aW9uIGluamVjdGVkIHZpYSBwcm9wZXJ0eVxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZVdpdGhQcm9wZXJ0eUNvbmZpZyB7XG4gICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLm5hbWUnKVxuICAgICAgICAgICAgICAgIHByaXZhdGUgYXBwTmFtZSE6IHN0cmluZztcblxuICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC52ZXJzaW9uJylcbiAgICAgICAgICAgICAgICBwcml2YXRlIGFwcFZlcnNpb24hOiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICBnZXRBcHBEZXRhaWxzKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBgQXBwOiAke3RoaXMuYXBwTmFtZX0sIFZlcnNpb246ICR7dGhpcy5hcHBWZXJzaW9ufWA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhQcm9wZXJ0eUNvbmZpZywgdXNlQ2xhc3M6IFNlcnZpY2VXaXRoUHJvcGVydHlDb25maWcgfSk7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSByb290Q29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhQcm9wZXJ0eUNvbmZpZyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoUHJvcGVydHlDb25maWcpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0QXBwRGV0YWlscygpKS50b0JlKCdBcHA6IFRlc3RBcHAsIFZlcnNpb246IDEuMCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIG1lcmdlIGNvbmZpZ3VyYXRpb25zIGZyb20gcGFyZW50IGFuZCBjaGlsZCBjb250YWluZXJzIGFuZCBpbmplY3QnLCAoKSA9PiB7XG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogeyBuYW1lOiAnVGVzdEFwcCcsIHZlcnNpb246ICcxLjAnIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6IHsgdmVyc2lvbjogJzIuMCcgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIE1vY2sgc2VydmljZSBjbGFzcyB0aGF0IHJlcXVpcmVzIGNvbmZpZ3VyYXRpb24gaW5qZWN0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aENvbmZpZyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC5uYW1lJykgcHJpdmF0ZSBhcHBOYW1lOiBzdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC52ZXJzaW9uJykgcHJpdmF0ZSBhcHBWZXJzaW9uOiBzdHJpbmdcbiAgICAgICAgICAgICAgICApIHsgfVxuXG4gICAgICAgICAgICAgICAgZ2V0QXBwRGV0YWlscygpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYEFwcDogJHt0aGlzLmFwcE5hbWV9LCBWZXJzaW9uOiAke3RoaXMuYXBwVmVyc2lvbn1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyBwcm92aWRlOiBTZXJ2aWNlV2l0aENvbmZpZywgdXNlQ2xhc3M6IFNlcnZpY2VXaXRoQ29uZmlnIH0pO1xuICAgICAgICAgICAgY29uc3Qgc2VydmljZUluc3RhbmNlID0gY2hpbGRDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aENvbmZpZyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoQ29uZmlnKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldEFwcERldGFpbHMoKSkudG9CZSgnQXBwOiBUZXN0QXBwLCBWZXJzaW9uOiAyLjAnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXNwZWN0IHByaW9yaXR5IHdoZW4gaW5qZWN0aW5nIGNvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnTG93UHJpb3JpdHlBcHAnLFxuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiAnMS4wJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDFcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAubmFtZScsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiAnSGlnaFByaW9yaXR5QXBwJyxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMlxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIE1vY2sgc2VydmljZSBjbGFzcyB0aGF0IHJlcXVpcmVzIGNvbmZpZ3VyYXRpb24gaW5qZWN0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aENvbmZpZyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC5uYW1lJykgcHJpdmF0ZSBhcHBOYW1lOiBzdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC52ZXJzaW9uJykgcHJpdmF0ZSBhcHBWZXJzaW9uOiBzdHJpbmdcbiAgICAgICAgICAgICAgICApIHsgfVxuXG4gICAgICAgICAgICAgICAgZ2V0QXBwRGV0YWlscygpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYEFwcDogJHt0aGlzLmFwcE5hbWV9LCBWZXJzaW9uOiAke3RoaXMuYXBwVmVyc2lvbn1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoQ29uZmlnLCB1c2VDbGFzczogU2VydmljZVdpdGhDb25maWcgfSk7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSByb290Q29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhDb25maWcpO1xuXG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlV2l0aENvbmZpZyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRBcHBEZXRhaWxzKCkpLnRvQ29udGFpbignSGlnaFByaW9yaXR5QXBwJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgZmlsdGVyIGNvbmZpZ3VyYXRpb25zIGJhc2VkIG9uIHRhZ3MgYW5kIGluamVjdCcsICgpID0+IHtcblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogJzEuMC0tLSdcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcC5uYW1lJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6ICdUYWdnZWRBcHAnLFxuICAgICAgICAgICAgICAgIHRhZ3M6IFsgJ3JlbGVhc2UnIF1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAubmFtZScsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiAnVW50YWdnZWRBcHAnXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gTW9jayBzZXJ2aWNlIGNsYXNzIHRoYXQgcmVxdWlyZXMgY29uZmlndXJhdGlvbiBpbmplY3Rpb25cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoQ29uZmlnIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLm5hbWUnKSBwcml2YXRlIGFwcE5hbWU6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLnZlcnNpb24nKSBwcml2YXRlIGFwcFZlcnNpb246IHN0cmluZ1xuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRBcHBEZXRhaWxzKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBgQXBwOiAke3RoaXMuYXBwTmFtZX0sIFZlcnNpb246ICR7dGhpcy5hcHBWZXJzaW9ufWA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhDb25maWcsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aENvbmZpZywgdGFnczogWyAncmVsZWFzZScgXSB9KTtcbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IHJvb3RDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aENvbmZpZywgeyB0YWdzOiBbICdyZWxlYXNlJyBdIH0pO1xuXG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlV2l0aENvbmZpZyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRBcHBEZXRhaWxzKCkpLnRvQ29udGFpbignVGFnZ2VkQXBwJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdGhyb3cgYW4gZXJyb3IgZm9yIG5vbi1leGlzdGVudCBjb25maWd1cmF0aW9uIHBhdGhzIGR1cmluZyBpbmplY3Rpb24nLCAoKSA9PiB7XG5cbiAgICAgICAgICAgIC8vIE1vY2sgc2VydmljZSBjbGFzcyB0aGF0IHJlcXVpcmVzIGNvbmZpZ3VyYXRpb24gaW5qZWN0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aENvbmZpZyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC5uYW1lJykgcHJpdmF0ZSBhcHBOYW1lOiBzdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3RDb25maWcoJ2FwcC52ZXJzaW9uJykgcHJpdmF0ZSBhcHBWZXJzaW9uOiBzdHJpbmdcbiAgICAgICAgICAgICAgICApIHsgfVxuXG4gICAgICAgICAgICAgICAgZ2V0QXBwRGV0YWlscygpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYEFwcDogJHt0aGlzLmFwcE5hbWV9LCBWZXJzaW9uOiAke3RoaXMuYXBwVmVyc2lvbn1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoQ29uZmlnLCB1c2VDbGFzczogU2VydmljZVdpdGhDb25maWcgfSk7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gcm9vdENvbnRhaW5lci5yZXNvbHZlKFNlcnZpY2VXaXRoQ29uZmlnKSkudG9UaHJvdygpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdNb2R1bGUgRXhwb3J0cyBhbmQgSW1wb3J0cycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Jlc29sdmVzIGV4cG9ydGVkIGRlcGVuZGVuY2llcyBmcm9tIGltcG9ydGVkIG1vZHVsZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjbGFzcyBNb2R1bGVBIHsgfVxuICAgICAgICAgICAgY2xhc3MgTW9kdWxlQiB7IH1cblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VBIHsgfVxuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZUIge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoU2VydmljZUEpIHB1YmxpYyBzZXJ2aWNlQTogU2VydmljZUEpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKE1vZHVsZUEsIHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgeyBwcm92aWRlOiBTZXJ2aWNlQSwgdXNlQ2xhc3M6IFNlcnZpY2VBIH0gXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbIFNlcnZpY2VBIF1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKE1vZHVsZUIsIHtcbiAgICAgICAgICAgICAgICBpbXBvcnRzOiBbIE1vZHVsZUEgXSxcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgeyBwcm92aWRlOiBTZXJ2aWNlQiwgdXNlQ2xhc3M6IFNlcnZpY2VCIH0gXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5tb2R1bGUoTW9kdWxlQik7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlQiA9IGNvbnRhaW5lci5yZXNvbHZlPFNlcnZpY2VCPihTZXJ2aWNlQik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2VCKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlQik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2VCLnNlcnZpY2VBKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlQSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdpbXBvcnRzIGEgbW9kdWxlIHdpdGggbm8gZXhwb3J0cyB3aXRob3V0IGVycm9ycycsICgpID0+IHtcbiAgICAgICAgICAgIGNsYXNzIE1vZHVsZVdpdGhOb0V4cG9ydHMgeyB9XG5cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoTW9kdWxlV2l0aE5vRXhwb3J0cywge1xuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogWyB7IHByb3ZpZGU6ICdzZXJ2aWNlJywgdXNlVmFsdWU6ICd0ZXN0JyB9IF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogW11cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLm1vZHVsZShNb2R1bGVXaXRoTm9FeHBvcnRzKSkubm90LnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Jlc29sdmVzIG92ZXJsYXBwaW5nIGV4cG9ydHMgZnJvbSBtdWx0aXBsZSBtb2R1bGVzIGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgICAgICAgIGNsYXNzIE1vZHVsZUEgeyB9XG4gICAgICAgICAgICBjbGFzcyBNb2R1bGVCIHsgfVxuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZUEge1xuICAgICAgICAgICAgICAgIGdldE1lc3NhZ2UoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnZnJvbSBBJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlQiB7XG4gICAgICAgICAgICAgICAgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdmcm9tIEInO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShNb2R1bGVBLCB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbIHsgcHJvdmlkZTogJ3NoYXJlZCcsIHVzZUNsYXNzOiBTZXJ2aWNlQSB9IF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnc2hhcmVkJyBdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShNb2R1bGVCLCB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbIHsgcHJvdmlkZTogJ3NoYXJlZCcsIHVzZUNsYXNzOiBTZXJ2aWNlQiwgcHJpb3JpdHk6IDEgfSBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ3NoYXJlZCcgXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5tb2R1bGUoTW9kdWxlQSk7XG4gICAgICAgICAgICBjb250YWluZXIubW9kdWxlKE1vZHVsZUIpO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPGFueT4oJ3NoYXJlZCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmdldE1lc3NhZ2UoKSkudG9CZSgnZnJvbSBCJyk7IC8vIEFzc3VtZXMgTW9kdWxlQiB3YXMgcmVnaXN0ZXJlZCBhZnRlciBNb2R1bGVBXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdjb3JyZWN0bHkgcmVzb2x2ZXMgcHJvdmlkZXJzIGZyb20gbmVzdGVkIG1vZHVsZSBleHBvcnRzJywgKCkgPT4ge1xuICAgICAgICAgICAgY2xhc3MgR3JhbmRjaGlsZE1vZHVsZSB7IH1cbiAgICAgICAgICAgIGNsYXNzIENoaWxkTW9kdWxlIHsgfVxuICAgICAgICAgICAgY2xhc3MgUGFyZW50TW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgR3JhbmRjaGlsZFNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIGdldFZhbHVlKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ2dyYW5kY2hpbGQnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShHcmFuZGNoaWxkTW9kdWxlLCB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbIHsgcHJvdmlkZTogJ2dyYW5kY2hpbGQnLCB1c2VDbGFzczogR3JhbmRjaGlsZFNlcnZpY2UgfSBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ2dyYW5kY2hpbGQnIF1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKENoaWxkTW9kdWxlLCB7XG4gICAgICAgICAgICAgICAgaW1wb3J0czogWyBHcmFuZGNoaWxkTW9kdWxlIF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnZ3JhbmRjaGlsZCcgXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoUGFyZW50TW9kdWxlLCB7XG4gICAgICAgICAgICAgICAgaW1wb3J0czogWyBDaGlsZE1vZHVsZSBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ2dyYW5kY2hpbGQnIF1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIubW9kdWxlKFBhcmVudE1vZHVsZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8R3JhbmRjaGlsZFNlcnZpY2U+KCdncmFuZGNoaWxkJyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKEdyYW5kY2hpbGRTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5nZXRWYWx1ZSgpKS50b0JlKCdncmFuZGNoaWxkJyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG5cbn0pO1xuIl19