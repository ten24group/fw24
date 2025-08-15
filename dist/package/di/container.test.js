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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGkvY29udGFpbmVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQSwyQ0FBMEM7QUFDMUMsbUNBQXNDO0FBQ3RDLDZDQUFtRztBQUVuRyx5Q0FBbUY7QUFFbkYsUUFBUSxDQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUU7SUFDekIsSUFBSSxTQUFzQixDQUFDO0lBRTNCLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDWix1QkFBVyxDQUFDLGVBQWUsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUM1QyxTQUFTLEdBQUcsSUFBSSx1QkFBVyxFQUFFLENBQUM7SUFDbEMsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsY0FBYyxFQUFFLEdBQUcsRUFBRTtRQUMxQixFQUFFLENBQUMsc0NBQXNDLEVBQUUsR0FBRyxFQUFFO1lBQzVDLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxTQUFTLENBQUM7WUFHakMsSUFBTSxTQUFTLEdBQWYsTUFBTSxTQUFTO2FBQUksQ0FBQTtZQUFiLFNBQVM7Z0JBRGQsVUFBVSxFQUFFO2VBQ1AsU0FBUyxDQUFJO1lBQ25CLE1BQU0sQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2hELENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHFDQUFxQyxFQUFFLEdBQUcsRUFBRTtZQUMzQyxNQUFNLEtBQUssR0FBRyxJQUFBLG1CQUFXLEVBQVMsYUFBYSxDQUFDLENBQUM7WUFDakQsTUFBTSxPQUFPLEdBQUcsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDO1lBQzdCLFNBQVMsQ0FBQyxRQUFRLENBQUMsRUFBRSxVQUFVLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQzVELE1BQU0sQ0FB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IGZyb20gJy4vY29udGFpbmVyJztcbmltcG9ydCB7IG1ha2VESVRva2VuIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQgeyBESU1vZHVsZSwgSW5qZWN0LCBJbmplY3RhYmxlLCBJbmplY3RDb25maWcsIEluamVjdENvbnRhaW5lciwgT25Jbml0IH0gZnJvbSAnLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyB9IGZyb20gJy4uL2ludGVyZmFjZXMvZGknO1xuaW1wb3J0IHsgcmVnaXN0ZXJDb25zdHJ1Y3RvckRlcGVuZGVuY3ksIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEgfSBmcm9tICcuL21ldGFkYXRhJztcblxuZGVzY3JpYmUoJ0RJQ29udGFpbmVyJywgKCkgPT4ge1xuICAgIGxldCBjb250YWluZXI6IERJQ29udGFpbmVyO1xuXG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAgIERJQ29udGFpbmVyLkRJTWV0YWRhdGFTdG9yZS5jbGVhck1ldGFkYXRhKCk7XG4gICAgICAgIGNvbnRhaW5lciA9IG5ldyBESUNvbnRhaW5lcigpO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1JlZ2lzdHJhdGlvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ3JlZ2lzdGVycyBhIGNsYXNzIHdpdGggQEluamVjdGFibGUoKScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3MgeyB9XG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyLmhhcyhUZXN0Q2xhc3MpKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVnaXN0ZXJzIGEgZmFjdG9yeSB3aXRoIHVzZUZhY3RvcnknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPHN0cmluZz4oJ1Rlc3RGYWN0b3J5Jyk7XG4gICAgICAgICAgICBjb25zdCBmYWN0b3J5ID0gKCkgPT4gJ3Rlc3QnO1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlRmFjdG9yeTogZmFjdG9yeSwgcHJvdmlkZTogdG9rZW4gfSk7XG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyWyAncHJvdmlkZXJzJyBdLmhhcyh0b2tlbikpLnRvQmUodHJ1ZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZWdpc3RlcnMgYSB2YWx1ZSB3aXRoIHVzZVZhbHVlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdUZXN0VmFsdWUnKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZVZhbHVlOiAndGVzdCcsIHByb3ZpZGU6IHRva2VuIH0pO1xuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lclsgJ3Byb3ZpZGVycycgXS5oYXModG9rZW4pKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnZG9lcyBub3QgcmVnaXN0ZXIgaWYgY29uZGl0aW9uIGlzIGZhbHNlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdUZXN0Q29uZGl0aW9uJyk7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VWYWx1ZTogJ3Rlc3QnLCBjb25kaXRpb246ICgpID0+IGZhbHNlLCBwcm92aWRlOiB0b2tlbiB9KTtcbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXJbICdwcm92aWRlcnMnIF0uaGFzKHRva2VuKSkudG9CZShmYWxzZSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1Jlc29sdXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdyZXNvbHZlcyBhIGNsYXNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7IH1cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmUoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Jlc29sdmVzIGEgZmFjdG9yeScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignVGVzdEZhY3RvcnknKTtcbiAgICAgICAgICAgIGNvbnN0IGZhY3RvcnkgPSAoKSA9PiAndGVzdCc7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VGYWN0b3J5OiBmYWN0b3J5LCBwcm92aWRlOiB0b2tlbiB9KTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmUodG9rZW4pO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlKCd0ZXN0Jyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZXNvbHZlcyBhIHZhbHVlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdUZXN0VmFsdWUnKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZVZhbHVlOiAndGVzdCcsIHByb3ZpZGU6IHRva2VuIH0pO1xuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZSh0b2tlbik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmUoJ3Rlc3QnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Rocm93cyBhbiBlcnJvciBpZiBubyBwcm92aWRlciBpcyBmb3VuZCcsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignTm9uRXhpc3RlbnQnKTtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIucmVzb2x2ZSh0b2tlbikpLnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2hhbmRsZXMgY2lyY3VsYXIgZGVwZW5kZW5jaWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIENsYXNzQSB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdCgnQ2xhc3NCJykgcHVibGljIGI6IGFueSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIENsYXNzQiB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdCgnQ2xhc3NBJykgcHVibGljIGE6IGFueSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlQSA9IGNvbnRhaW5lci5yZXNvbHZlPENsYXNzQT4oJ0NsYXNzQScpO1xuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2VCID0gY29udGFpbmVyLnJlc29sdmU8Q2xhc3NCPignQ2xhc3NCJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZUEpLnRvQmVJbnN0YW5jZU9mKENsYXNzQSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2VCKS50b0JlSW5zdGFuY2VPZihDbGFzc0IpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlQS5iKS50b0JlSW5zdGFuY2VPZihDbGFzc0IpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlQi5hKS50b0JlSW5zdGFuY2VPZihDbGFzc0EpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnY2FsbHMgQE9uSW5pdCBtZXRob2QgYWZ0ZXIgcmVzb2x2aW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG4gICAgICAgICAgICBjb25zdCBvbkluaXRTcHkgPSBqZXN0LmZuKCk7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgQE9uSW5pdCgpXG4gICAgICAgICAgICAgICAgb25Jbml0KCkge1xuICAgICAgICAgICAgICAgICAgICBvbkluaXRTcHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmUoVGVzdENsYXNzKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KG9uSW5pdFNweSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdQcm9wZXJ0eSBJbmplY3Rpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdpbmplY3RzIHByb3BlcnRpZXMgdXNpbmcgQEluamVjdCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBEZXBlbmRlbmN5IHsgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3Mge1xuICAgICAgICAgICAgICAgIEBJbmplY3QoRGVwZW5kZW5jeSlcbiAgICAgICAgICAgICAgICBwdWJsaWMgZGVwZW5kZW5jeSE6IERlcGVuZGVuY3k7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzcz4oVGVzdENsYXNzKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmRlcGVuZGVuY3kpLnRvQmVJbnN0YW5jZU9mKERlcGVuZGVuY3kpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnaGFuZGxlcyBvcHRpb25hbCBwcm9wZXJ0eSBpbmplY3Rpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICBASW5qZWN0KCdPcHRpb25hbERlcGVuZGVuY3knLCB7IGlzT3B0aW9uYWw6IHRydWUgfSlcbiAgICAgICAgICAgICAgICBwdWJsaWMgb3B0aW9uYWxEZXBlbmRlbmN5PzogYW55O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzcz4oVGVzdENsYXNzKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLm9wdGlvbmFsRGVwZW5kZW5jeSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdNdWx0aXBsZSBEZXBlbmRlbmN5IEluamVjdGlvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ2luamVjdHMgbXVsdGlwbGUgZGVwZW5kZW5jaWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIERlcGVuZGVuY3lBIHsgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBEZXBlbmRlbmN5QiB7IH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdChEZXBlbmRlbmN5QSkgcHVibGljIGRlcGVuZGVuY3lBOiBEZXBlbmRlbmN5QSxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdChEZXBlbmRlbmN5QikgcHVibGljIGRlcGVuZGVuY3lCOiBEZXBlbmRlbmN5QlxuICAgICAgICAgICAgICAgICkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzPihUZXN0Q2xhc3MpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuZGVwZW5kZW5jeUEpLnRvQmVJbnN0YW5jZU9mKERlcGVuZGVuY3lBKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5kZXBlbmRlbmN5QikudG9CZUluc3RhbmNlT2YoRGVwZW5kZW5jeUIpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdTaW5nbGV0b24gQmVoYXZpb3InLCAoKSA9PiB7XG4gICAgICAgIGl0KCdyZXVzZXMgc2luZ2xldG9uIGluc3RhbmNlcycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSh7IHNpbmdsZXRvbjogdHJ1ZSB9KVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHsgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTEgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTIgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTEpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UyKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlMSkudG9CZShpbnN0YW5jZTIpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdDb25kaXRpb25hbCBSZWdpc3RyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdkb2VzIG5vdCByZWdpc3RlciBhIHByb3ZpZGVyIGlmIGNvbmRpdGlvbiBpcyBmYWxzZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdDb25kaXRpb25hbFNlcnZpY2UnKTtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoeyBjb25kaXRpb246ICgpID0+IGZhbHNlIH0pXG4gICAgICAgICAgICBjbGFzcyBDb25kaXRpb25hbFNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzKHRva2VuKSkudG9CZShmYWxzZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZWdpc3RlcnMgYSBwcm92aWRlciBpZiBjb25kaXRpb24gaXMgdHJ1ZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdDb25kaXRpb25hbFNlcnZpY2UnKTtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoeyBjb25kaXRpb246ICgpID0+IHRydWUgfSlcbiAgICAgICAgICAgIGNsYXNzIENvbmRpdGlvbmFsU2VydmljZSB7IH1cblxuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXModG9rZW4pKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdBc3luYyBSZXNvbHZlJywgKCkgPT4ge1xuICAgICAgICBpdCgncmVzb2x2ZXMgYSBjbGFzcyBhc3luY2hyb25vdXNseScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3MgeyB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYyhUZXN0Q2xhc3MpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3MpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVzb2x2ZXMgYSBmYWN0b3J5IGFzeW5jaHJvbm91c2x5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdUZXN0RmFjdG9yeScpO1xuICAgICAgICAgICAgY29uc3QgZmFjdG9yeSA9ICgpID0+ICd0ZXN0JztcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUZhY3Rvcnk6IGZhY3RvcnksIHByb3ZpZGU6IHRva2VuIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlQXN5bmModG9rZW4pO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlKCd0ZXN0Jyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZXNvbHZlcyBhIHZhbHVlIGFzeW5jaHJvbm91c2x5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdUZXN0VmFsdWUnKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZVZhbHVlOiAndGVzdCcsIHByb3ZpZGU6IHRva2VuIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlQXN5bmModG9rZW4pO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlKCd0ZXN0Jyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdoYW5kbGVzIGNpcmN1bGFyIGRlcGVuZGVuY2llcyBhc3luY2hyb25vdXNseScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBDbGFzc0Ege1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NsYXNzQicpIHB1YmxpYyBiOiBhbnkpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBDbGFzc0Ige1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoJ0NsYXNzQScpIHB1YmxpYyBhOiBhbnkpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZUEgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jPENsYXNzQT4oJ0NsYXNzQScpO1xuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2VCID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYzxDbGFzc0I+KCdDbGFzc0InKTtcblxuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlQSkudG9CZUluc3RhbmNlT2YoQ2xhc3NBKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZUIpLnRvQmVJbnN0YW5jZU9mKENsYXNzQik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2VBLmIpLnRvQmVJbnN0YW5jZU9mKENsYXNzQik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2VCLmEpLnRvQmVJbnN0YW5jZU9mKENsYXNzQSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdoYW5kbGVzIG9wdGlvbmFsIHByb3BlcnR5IGluamVjdGlvbiBhc3luY2hyb25vdXNseScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3Mge1xuICAgICAgICAgICAgICAgIEBJbmplY3QoJ09wdGlvbmFsRGVwZW5kZW5jeScsIHsgaXNPcHRpb25hbDogdHJ1ZSB9KVxuICAgICAgICAgICAgICAgIHB1YmxpYyBvcHRpb25hbERlcGVuZGVuY3k/OiBhbnk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYzxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5vcHRpb25hbERlcGVuZGVuY3kpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ2xlYXIgQ29udGFpbmVyJywgKCkgPT4ge1xuICAgICAgICBpdCgnY2xlYXJzIGFsbCBwcm92aWRlcnMgYW5kIGNhY2hlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7IH1cblxuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXMoVGVzdENsYXNzKSkudG9CZSh0cnVlKTtcblxuICAgICAgICAgICAgY29udGFpbmVyLmNsZWFyKCk7XG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyLmhhcyhUZXN0Q2xhc3MpKS50b0JlKGZhbHNlKTtcbiAgICAgICAgICAgIGV4cGVjdCgoY29udGFpbmVyIGFzIGFueSkuY2FjaGUuc2l6ZSkudG9CZSgwKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnRXJyb3IgSGFuZGxpbmcnLCAoKSA9PiB7XG4gICAgICAgIGl0KCd0aHJvd3MgYW4gZXJyb3Igd2hlbiByZWdpc3RlcmluZyBhbiBpbnZhbGlkIHByb3ZpZGVyJywgKCkgPT4ge1xuICAgICAgICAgICAgZXhwZWN0KCgpID0+IHtcbiAgICAgICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogbnVsbCBhcyBhbnksIHByb3ZpZGU6ICdJbnZhbGlkUHJvdmlkZXInIH0pO1xuICAgICAgICAgICAgfSkudG9UaHJvdygpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgndGhyb3dzIGFuIGVycm9yIHdoZW4gcmVzb2x2aW5nIGFuIGludmFsaWQgcHJvdmlkZXInLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPHN0cmluZz4oJ0ludmFsaWRQcm92aWRlcicpO1xuICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5yZXNvbHZlKHRva2VuKSkudG9UaHJvdygpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdJbmhlcml0YW5jZScsICgpID0+IHtcbiAgICAgICAgaXQoJ2luamVjdHMgZGVwZW5kZW5jaWVzIGluIGEgZGVyaXZlZCBjbGFzcycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBCYXNlU2VydmljZSB7IH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgRGVyaXZlZFNlcnZpY2UgZXh0ZW5kcyBCYXNlU2VydmljZSB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdChCYXNlU2VydmljZSkgcHVibGljIGJhc2VTZXJ2aWNlOiBCYXNlU2VydmljZSkge1xuICAgICAgICAgICAgICAgICAgICBzdXBlcigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZTxEZXJpdmVkU2VydmljZT4oRGVyaXZlZFNlcnZpY2UpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKERlcml2ZWRTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5iYXNlU2VydmljZSkudG9CZUluc3RhbmNlT2YoQmFzZVNlcnZpY2UpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdMaWZlY3ljbGUgSG9va3MnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdjYWxscyBAT25Jbml0IG1ldGhvZCBmb3IgZWFjaCBpbnN0YW5jZScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuICAgICAgICAgICAgY29uc3Qgb25Jbml0U3B5ID0gamVzdC5mbigpO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSh7IHNpbmdsZXRvbjogZmFsc2UgfSlcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgQE9uSW5pdCgpXG4gICAgICAgICAgICAgICAgb25Jbml0KCkge1xuICAgICAgICAgICAgICAgICAgICBvbkluaXRTcHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzcz4oVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMiA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzcz4oVGVzdENsYXNzKTtcblxuICAgICAgICAgICAgZXhwZWN0KG9uSW5pdFNweSkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDIpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdSZS1yZWdpc3RyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCd1cGRhdGVzIHByb3ZpZGVyIHdoZW4gcmUtcmVnaXN0ZXJlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBPcmlnaW5hbFNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFVwZGF0ZWRTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPE9yaWdpbmFsU2VydmljZT4oJ1NlcnZpY2UnKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUNsYXNzOiBPcmlnaW5hbFNlcnZpY2UsIHByb3ZpZGU6IHRva2VuIH0pO1xuXG4gICAgICAgICAgICBsZXQgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZSh0b2tlbik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKE9yaWdpbmFsU2VydmljZSk7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogVXBkYXRlZFNlcnZpY2UsIHByb3ZpZGU6IHRva2VuLCBwcmlvcml0eTogMSB9KTtcblxuICAgICAgICAgICAgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZSh0b2tlbik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFVwZGF0ZWRTZXJ2aWNlKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ29tcGxleCBEZXBlbmRlbmN5IEdyYXBocycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Jlc29sdmVzIGNvbXBsZXggZGVwZW5kZW5jeSBncmFwaHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZUEgeyB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VCIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KFNlcnZpY2VBKSBwdWJsaWMgYTogU2VydmljZUEpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlQyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdChTZXJ2aWNlQikgcHVibGljIGI6IFNlcnZpY2VCKSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZUQge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoU2VydmljZUMpIHB1YmxpYyBjOiBTZXJ2aWNlQywgQEluamVjdChTZXJ2aWNlQSkgcHVibGljIGE6IFNlcnZpY2VBKSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZTxTZXJ2aWNlRD4oU2VydmljZUQpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VEKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5jKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlQyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuYy5iKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlQik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuYy5iLmEpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VBKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5hKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlQSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NoaWxkIENvbnRhaW5lcnMnLCAoKSA9PiB7XG4gICAgICAgIGxldCBjaGlsZENvbnRhaW5lcjogRElDb250YWluZXI7XG5cbiAgICAgICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lciA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQnKTtcbiAgICAgICAgICAgIERJQ29udGFpbmVyLkRJTWV0YWRhdGFTdG9yZS5jbGVhck1ldGFkYXRhKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlc2NyaWJlKCdJbmhlcml0YW5jZScsICgpID0+IHtcbiAgICAgICAgICAgIGl0KCdpbmhlcml0cyBwcm92aWRlcnMgZnJvbSBwYXJlbnQgY29udGFpbmVyJywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIFBhcmVudFNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8UGFyZW50U2VydmljZT4oUGFyZW50U2VydmljZSk7XG5cbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFBhcmVudFNlcnZpY2UpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGl0KCdvdmVycmlkZXMgcHJvdmlkZXJzIGluIGNoaWxkIGNvbnRhaW5lcicsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBQYXJlbnRTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICAgICAgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAncGFyZW50JztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBDaGlsZFNlcnZpY2Uge1xuICAgICAgICAgICAgICAgICAgICBnZXRNZXNzYWdlKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdjaGlsZCc7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUNsYXNzOiBDaGlsZFNlcnZpY2UsIHByb3ZpZGU6ICdTZXJ2aWNlJyB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY2hpbGRDb250YWluZXIucmVzb2x2ZTxDaGlsZFNlcnZpY2U+KCdTZXJ2aWNlJyk7XG5cbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKENoaWxkU2VydmljZSk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmdldE1lc3NhZ2UoKSkudG9CZSgnY2hpbGQnKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBkZXNjcmliZSgnUHJvdmlkZXIgU2hhZG93aW5nJywgKCkgPT4ge1xuICAgICAgICAgICAgaXQoJ3NoYWRvd3MgcGFyZW50IGNvbnRhaW5lciBwcm92aWRlcnMnLCAoKSA9PiB7XG5cbiAgICAgICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoeyAncHJvdmlkZSc6ICdTZXJ2aWNlJyB9KVxuICAgICAgICAgICAgICAgIGNsYXNzIFBhcmVudFNlcnZpY2Uge1xuICAgICAgICAgICAgICAgICAgICBnZXRNZXNzYWdlKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdwYXJlbnQnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgQGNoaWxkQ29udGFpbmVyLkluamVjdGFibGUoeyBwcm92aWRlOiAnU2VydmljZScgfSlcbiAgICAgICAgICAgICAgICBjbGFzcyBDaGlsZFNlcnZpY2Uge1xuICAgICAgICAgICAgICAgICAgICBnZXRNZXNzYWdlKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdjaGlsZCc7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBjaGlsZEluc3RhbmNlID0gY2hpbGRDb250YWluZXIucmVzb2x2ZTxDaGlsZFNlcnZpY2U+KCdTZXJ2aWNlJyk7XG4gICAgICAgICAgICAgICAgY29uc3QgcGFyZW50SW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxQYXJlbnRTZXJ2aWNlPignU2VydmljZScpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KGNoaWxkSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKENoaWxkU2VydmljZSk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGNoaWxkSW5zdGFuY2UuZ2V0TWVzc2FnZSgpKS50b0JlKCdjaGlsZCcpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJlbnRJbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoUGFyZW50U2VydmljZSk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHBhcmVudEluc3RhbmNlLmdldE1lc3NhZ2UoKSkudG9CZSgncGFyZW50Jyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZGVzY3JpYmUoJ0NvbmRpdGlvbmFsIFJlc29sdXRpb24gaW4gQ2hpbGQgQ29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgICAgIGl0KCdjb25kaXRpb25hbGx5IHJlZ2lzdGVycyBwcm92aWRlcnMgaW4gY2hpbGQgY29udGFpbmVyJywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIFBhcmVudFNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBQYXJlbnRTZXJ2aWNlLFxuICAgICAgICAgICAgICAgICAgICBwcm92aWRlOiAnQ29uZGl0aW9uYWxTZXJ2aWNlJyxcbiAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9uOiAoKSA9PiBmYWxzZVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNoaWxkQ29udGFpbmVyLnJlc29sdmUoJ0NvbmRpdGlvbmFsU2VydmljZScpKS50b1Rocm93KCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZGVzY3JpYmUoJ01pZGRsZXdhcmUgU3VwcG9ydCBpbiBDaGlsZCBDb250YWluZXJzJywgKCkgPT4ge1xuICAgICAgICAgICAgaXQoJ2FwcGxpZXMgbWlkZGxld2FyZSB0byBjaGlsZCBjb250YWluZXIgcmVzb2x1dGlvbnMnLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWlkZGxld2FyZVNweSA9IGplc3QuZm4oKG5leHQpID0+IG5leHQoKSk7XG5cbiAgICAgICAgICAgICAgICBjaGlsZENvbnRhaW5lci51c2VNaWRkbGV3YXJlKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIE1pZGRsZXdhcmVTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogTWlkZGxld2FyZVNlcnZpY2UsIHByb3ZpZGU6ICdNaWRkbGV3YXJlU2VydmljZScgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8TWlkZGxld2FyZVNlcnZpY2U+KCdNaWRkbGV3YXJlU2VydmljZScpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChtaWRkbGV3YXJlU3B5KS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihNaWRkbGV3YXJlU2VydmljZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaXQoJ2FwcGxpZXMgYXN5bmMgbWlkZGxld2FyZSB0byBjaGlsZCBjb250YWluZXIgcmVzb2x1dGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWlkZGxld2FyZVNweSA9IGplc3QuZm4oYXN5bmMgKG5leHQpID0+IGF3YWl0IG5leHQoKSk7XG5cbiAgICAgICAgICAgICAgICBjaGlsZENvbnRhaW5lci51c2VNaWRkbGV3YXJlQXN5bmMoeyBtaWRkbGV3YXJlOiBtaWRkbGV3YXJlU3B5IH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgTWlkZGxld2FyZVNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUNsYXNzOiBNaWRkbGV3YXJlU2VydmljZSwgcHJvdmlkZTogJ01pZGRsZXdhcmVTZXJ2aWNlJyB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY2hpbGRDb250YWluZXIucmVzb2x2ZUFzeW5jPE1pZGRsZXdhcmVTZXJ2aWNlPignTWlkZGxld2FyZVNlcnZpY2UnKTtcbiAgICAgICAgICAgICAgICBleHBlY3QobWlkZGxld2FyZVNweSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoTWlkZGxld2FyZVNlcnZpY2UpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGRlc2NyaWJlKCdQcm9wZXJ0eSBJbmplY3Rpb24gaW4gQ2hpbGQgQ29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgICAgIGl0KCdpbmplY3RzIHByb3BlcnRpZXMgdXNpbmcgQEluamVjdCBpbiBjaGlsZCBjb250YWluZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgRGVwZW5kZW5jeSB7IH1cblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3Mge1xuICAgICAgICAgICAgICAgICAgICBASW5qZWN0KERlcGVuZGVuY3kpXG4gICAgICAgICAgICAgICAgICAgIHB1YmxpYyBkZXBlbmRlbmN5ITogRGVwZW5kZW5jeTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUNsYXNzOiBEZXBlbmRlbmN5LCBwcm92aWRlOiBEZXBlbmRlbmN5Lm5hbWUgfSk7XG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogVGVzdENsYXNzLCBwcm92aWRlOiBUZXN0Q2xhc3MubmFtZSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY2hpbGRDb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmRlcGVuZGVuY3kpLnRvQmVJbnN0YW5jZU9mKERlcGVuZGVuY3kpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGl0KCdoYW5kbGVzIG9wdGlvbmFsIHByb3BlcnR5IGluamVjdGlvbiBpbiBjaGlsZCBjb250YWluZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdCgnT3B0aW9uYWxEZXBlbmRlbmN5JywgeyBpc09wdGlvbmFsOiB0cnVlIH0pXG4gICAgICAgICAgICAgICAgICAgIHB1YmxpYyBvcHRpb25hbERlcGVuZGVuY3k/OiBhbnk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogVGVzdENsYXNzLCBwcm92aWRlOiBUZXN0Q2xhc3MubmFtZSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY2hpbGRDb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3M+KFRlc3RDbGFzcyk7XG5cbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLm9wdGlvbmFsRGVwZW5kZW5jeSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ01pZGRsZXdhcmUgYW5kIEludGVyY2VwdG9ycycsICgpID0+IHtcbiAgICAgICAgZGVzY3JpYmUoJ01pZGRsZXdhcmUnLCAoKSA9PiB7XG4gICAgICAgICAgICBpdCgnYXBwbGllcyBtaWRkbGV3YXJlIHRvIHJlc29sdXRpb25zJywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKChuZXh0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNaWRkbGV3YXJlIGJlZm9yZScpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBuZXh0KCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNaWRkbGV3YXJlIGFmdGVyJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7IG1pZGRsZXdhcmU6IG1pZGRsZXdhcmVTcHkgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBNaWRkbGV3YXJlU2VydmljZSB7IH1cblxuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8TWlkZGxld2FyZVNlcnZpY2U+KCdNaWRkbGV3YXJlU2VydmljZScpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KG1pZGRsZXdhcmVTcHkpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKE1pZGRsZXdhcmVTZXJ2aWNlKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpdCgnYWxsb3dzIG1pZGRsZXdhcmUgdG8gbW9kaWZ5IHRoZSByZXN1bHQnLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWlkZGxld2FyZVNweSA9IGplc3QuZm4oKG5leHQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gbmV4dCgpO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQubW9kaWZpZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgY29udGFpbmVyLnVzZU1pZGRsZXdhcmUoeyBtaWRkbGV3YXJlOiBtaWRkbGV3YXJlU3B5IH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgTWlkZGxld2FyZVNlcnZpY2Uge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9ICdvcmlnaW5hbCc7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxhbnk+KCdNaWRkbGV3YXJlU2VydmljZScpO1xuXG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihNaWRkbGV3YXJlU2VydmljZSk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLm1vZGlmaWVkKS50b0JlKHRydWUpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGl0KCdoYW5kbGVzIGVycm9ycyBpbiBtaWRkbGV3YXJlJywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNaWRkbGV3YXJlIGVycm9yJyk7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7IG1pZGRsZXdhcmU6IG1pZGRsZXdhcmVTcHkgfSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgICAgICBjbGFzcyBNaWRkbGV3YXJlU2VydmljZSB7IH1cblxuICAgICAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIucmVzb2x2ZTxNaWRkbGV3YXJlU2VydmljZT4oJ01pZGRsZXdhcmVTZXJ2aWNlJykpXG4gICAgICAgICAgICAgICAgICAgIC50b1Rocm93KCdNaWRkbGV3YXJlIGVycm9yJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZGVzY3JpYmUoJ0FzeW5jIE1pZGRsZXdhcmUnLCAoKSA9PiB7XG4gICAgICAgICAgICBpdCgnYXBwbGllcyBhc3luYyBtaWRkbGV3YXJlIHRvIHJlc29sdXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKGFzeW5jIChuZXh0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBc3luYyBtaWRkbGV3YXJlIGJlZm9yZScpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBuZXh0KCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdBc3luYyBtaWRkbGV3YXJlIGFmdGVyJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZUFzeW5jKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgICAgIGNsYXNzIE1pZGRsZXdhcmVTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jPE1pZGRsZXdhcmVTZXJ2aWNlPignTWlkZGxld2FyZVNlcnZpY2UnKTtcblxuICAgICAgICAgICAgICAgIGV4cGVjdChtaWRkbGV3YXJlU3B5KS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihNaWRkbGV3YXJlU2VydmljZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaXQoJ2FsbG93cyBhc3luYyBtaWRkbGV3YXJlIHRvIG1vZGlmeSB0aGUgcmVzdWx0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1pZGRsZXdhcmVTcHkgPSBqZXN0LmZuKGFzeW5jIChuZXh0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG5leHQoKTtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0Lm1vZGlmaWVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlQXN5bmMoeyBtaWRkbGV3YXJlOiBtaWRkbGV3YXJlU3B5IH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgTWlkZGxld2FyZVNlcnZpY2Uge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9ICdvcmlnaW5hbCc7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jPGFueT4oJ01pZGRsZXdhcmVTZXJ2aWNlJyk7XG5cbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKE1pZGRsZXdhcmVTZXJ2aWNlKTtcbiAgICAgICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UubW9kaWZpZWQpLnRvQmUodHJ1ZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaXQoJ2hhbmRsZXMgZXJyb3JzIGluIGFzeW5jIG1pZGRsZXdhcmUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWlkZGxld2FyZVNweSA9IGplc3QuZm4oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FzeW5jIG1pZGRsZXdhcmUgZXJyb3InKTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlQXN5bmMoeyBtaWRkbGV3YXJlOiBtaWRkbGV3YXJlU3B5IH0pO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICAgICAgY2xhc3MgTWlkZGxld2FyZVNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgICAgICBhd2FpdCBleHBlY3QoY29udGFpbmVyLnJlc29sdmVBc3luYzxNaWRkbGV3YXJlU2VydmljZT4oJ01pZGRsZXdhcmVTZXJ2aWNlJykpLnJlamVjdHMudG9UaHJvdygnQXN5bmMgbWlkZGxld2FyZSBlcnJvcicpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1Byb3ZpZGVyIFByaW9yaXR5IFJlZ2lzdHJhdGlvbicsICgpID0+IHtcbiAgICAgICAgY2xhc3MgVGVzdENsYXNzQSB7XG4gICAgICAgICAgICB2YWx1ZTogc3RyaW5nID0gJ0EnO1xuICAgICAgICB9XG5cbiAgICAgICAgY2xhc3MgVGVzdENsYXNzQiB7XG4gICAgICAgICAgICB2YWx1ZTogc3RyaW5nID0gJ0InO1xuICAgICAgICB9XG5cbiAgICAgICAgdGVzdCgncmVnaXN0ZXJzIGEgcHJvdmlkZXIgd2l0aCBoaWdoZXIgcHJpb3JpdHknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQSxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQT4oJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS52YWx1ZSkudG9CZSgnQScpO1xuICAgICAgICB9KTtcblxuICAgICAgICB0ZXN0KCdkb2VzIG5vdCBvdmVycmlkZSBhIHByb3ZpZGVyIHdpdGggYSBoaWdoZXIgcHJpb3JpdHknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQSxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMlxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NCLFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAxXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NBPigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLnZhbHVlKS50b0JlKCdBJyk7IC8vIFNob3VsZCBub3Qgb3ZlcnJpZGUgd2l0aCBsb3dlciBwcmlvcml0eVxuICAgICAgICB9KTtcblxuICAgICAgICB0ZXN0KCdvdmVycmlkZXMgYSBwcm92aWRlciB3aXRoIGEgbG93ZXIgcHJpb3JpdHknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQSxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NCLFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAyXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NCPigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLnZhbHVlKS50b0JlKCdCJyk7IC8vIFNob3VsZCBvdmVycmlkZSB3aXRoIGhpZ2hlciBwcmlvcml0eVxuICAgICAgICB9KTtcblxuICAgICAgICB0ZXN0KCdyZWdpc3RlcnMgYSBwcm92aWRlciB3aXRob3V0IHByaW9yaXR5IGFuZCBvdmVycmlkZXMgaWYgbmV3IG9uZSBoYXMgcHJpb3JpdHknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NCLFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAxXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NCPigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLnZhbHVlKS50b0JlKCdCJyk7IC8vIFNob3VsZCBvdmVycmlkZSBzaW5jZSBuZXcgcHJvdmlkZXIgaGFzIHByaW9yaXR5XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRlc3QoJ2RvZXMgbm90IHJlZ2lzdGVyIGEgcHJvdmlkZXIgd2l0aCBsb3dlciBwcmlvcml0eSB3aGVuIG9uZSB3aXRob3V0IHByaW9yaXR5IGV4aXN0cycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NBXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0IsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IC0xXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NBPigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLnZhbHVlKS50b0JlKCdBJyk7IC8vIFNob3VsZCBub3Qgb3ZlcnJpZGUgc2luY2UgZXhpc3RpbmcgcHJvdmlkZXIgaGFzIG5vIHByaW9yaXR5XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ09wdGlvbmFsIERlcGVuZGVuY3kgSW5qZWN0aW9uIHdpdGggRGVmYXVsdCBWYWx1ZScsICgpID0+IHtcbiAgICAgICAgY2xhc3MgVGVzdENsYXNzQSB7XG4gICAgICAgICAgICB2YWx1ZTogc3RyaW5nO1xuICAgICAgICAgICAgY29uc3RydWN0b3IodmFsdWU6IHN0cmluZyA9ICdBJykge1xuICAgICAgICAgICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNsYXNzIERlcGVuZGVudENsYXNzIHtcbiAgICAgICAgICAgIGNvbnN0cnVjdG9yKHB1YmxpYyBkZXA6IFRlc3RDbGFzc0EpIHsgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGVzdCgnaW5qZWN0cyBkZXBlbmRlbmN5IHdoZW4gcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdkZXAnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NBXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnZGVwZW5kZW50JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogRGVwZW5kZW50Q2xhc3NcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZWdpc3RlckNvbnN0cnVjdG9yRGVwZW5kZW5jeShEZXBlbmRlbnRDbGFzcywgMCwgJ2RlcCcsIHtcbiAgICAgICAgICAgICAgICBpc09wdGlvbmFsOiB0cnVlLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogbmV3IFRlc3RDbGFzc0EoJ2RlZmF1bHQnKSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPERlcGVuZGVudENsYXNzPignZGVwZW5kZW50Jyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuZGVwLnZhbHVlKS50b0JlKCdBJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRlc3QoJ3VzZXMgZGVmYXVsdCB2YWx1ZSB3aGVuIGRlcGVuZGVuY3kgaXMgbm90IHByb3ZpZGVkJywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnZGVwZW5kZW50JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogRGVwZW5kZW50Q2xhc3NcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZWdpc3RlckNvbnN0cnVjdG9yRGVwZW5kZW5jeShEZXBlbmRlbnRDbGFzcywgMCwgJ2RlcCcsIHtcbiAgICAgICAgICAgICAgICBpc09wdGlvbmFsOiB0cnVlLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogbmV3IFRlc3RDbGFzc0EoJ2RlZmF1bHQnKSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPERlcGVuZGVudENsYXNzPignZGVwZW5kZW50Jyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuZGVwLnZhbHVlKS50b0JlKCdkZWZhdWx0Jyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ01pZGRsZXdhcmUgRXhlY3V0aW9uIE9yZGVyIENvbnRyb2wnLCAoKSA9PiB7XG4gICAgICAgIGNsYXNzIFRlc3RDbGFzc0Ege1xuICAgICAgICAgICAgdmFsdWU6IHN0cmluZztcbiAgICAgICAgICAgIGNvbnN0cnVjdG9yKHZhbHVlOiBzdHJpbmcgPSAnQScpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0ZXN0KCdleGVjdXRlcyBtaWRkbGV3YXJlcyBpbiBzcGVjaWZpZWQgb3JkZXInLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlKHtcbiAgICAgICAgICAgICAgICBtaWRkbGV3YXJlOiBuZXh0ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goJ21pZGRsZXdhcmUxJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBvcmRlcjogMFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlKHtcbiAgICAgICAgICAgICAgICBtaWRkbGV3YXJlOiBuZXh0ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goJ21pZGRsZXdhcmUyJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBvcmRlcjogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlKHtcbiAgICAgICAgICAgICAgICBtaWRkbGV3YXJlOiBuZXh0ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goJ21pZGRsZXdhcmUwJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBvcmRlcjogLTFcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzc0E+KCd0ZXN0Jyk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKFsgJ21pZGRsZXdhcmUwJywgJ21pZGRsZXdhcmUxJywgJ21pZGRsZXdhcmUyJyBdKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGVzdCgnZXhlY3V0ZXMgYXN5bmMgbWlkZGxld2FyZXMgaW4gc3BlY2lmaWVkIG9yZGVyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0OiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZUFzeW5jKHtcbiAgICAgICAgICAgICAgICBtaWRkbGV3YXJlOiBhc3luYyBuZXh0ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goJ21pZGRsZXdhcmUxJyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBvcmRlcjogMFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlQXN5bmMoe1xuICAgICAgICAgICAgICAgIG1pZGRsZXdhcmU6IGFzeW5jIG5leHQgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQucHVzaCgnbWlkZGxld2FyZTInKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHQoKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG9yZGVyOiAxXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLnVzZU1pZGRsZXdhcmVBc3luYyh7XG4gICAgICAgICAgICAgICAgbWlkZGxld2FyZTogYXN5bmMgbmV4dCA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKCdtaWRkbGV3YXJlMCcpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dCgpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgb3JkZXI6IC0xXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0FcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jPFRlc3RDbGFzc0E+KCd0ZXN0Jyk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKFsgJ21pZGRsZXdhcmUwJywgJ21pZGRsZXdhcmUxJywgJ21pZGRsZXdhcmUyJyBdKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnUHJvdmlkZXIgUmVtb3ZhbCcsICgpID0+IHtcbiAgICAgICAgY2xhc3MgVGVzdENsYXNzQSB7XG4gICAgICAgICAgICB2YWx1ZTogc3RyaW5nO1xuICAgICAgICAgICAgY29uc3RydWN0b3IodmFsdWU6IHN0cmluZyA9ICdBJykge1xuICAgICAgICAgICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNsYXNzIFRlc3RDbGFzc0Ige1xuICAgICAgICAgICAgdmFsdWU6IHN0cmluZyA9ICdCJztcbiAgICAgICAgfVxuXG4gICAgICAgIHRlc3QoJ3JlbW92ZXMgYSByZWdpc3RlcmVkIHByb3ZpZGVyJywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0FcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29udGFpbmVyLnJlbW92ZVByb3ZpZGVyc0ZvcigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzc0E+KCd0ZXN0JykpLnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGVzdCgncmVtb3ZlcyBhIHByb3ZpZGVyIGZyb20gdGhlIGNhY2hlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAndGVzdCcsXG4gICAgICAgICAgICAgICAgdXNlQ2xhc3M6IFRlc3RDbGFzc0EsXG4gICAgICAgICAgICAgICAgc2luZ2xldG9uOiB0cnVlXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UxID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzQT4oJ3Rlc3QnKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZW1vdmVQcm92aWRlcnNGb3IoJ3Rlc3QnKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NCXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMiA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzc0E+KCd0ZXN0Jyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTEudmFsdWUpLnRvQmUoJ0EnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTIudmFsdWUpLnRvQmUoJ0InKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGVzdCgnaGFuZGxlcyByZW1vdmluZyBub24tZXhpc3RlbnQgcHJvdmlkZXIgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIucmVtb3ZlUHJvdmlkZXJzRm9yKCdub25FeGlzdGVudCcpKS5ub3QudG9UaHJvdygpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdNb2R1bGVzJywgKCkgPT4ge1xuICAgICAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgICAgICAgIGNvbnRhaW5lci5jbGVhcigpO1xuICAgICAgICAgICAgRElDb250YWluZXIuRElNZXRhZGF0YVN0b3JlLmNsZWFyTWV0YWRhdGEoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3JlZ2lzdGVycyBhIG1vZHVsZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBjbGFzcyBUZXN0TW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3NBIHsgfVxuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKFRlc3RNb2R1bGUsIHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFtcbiAgICAgICAgICAgICAgICAgICAgeyB1c2VDbGFzczogVGVzdENsYXNzQSwgcHJvdmlkZTogJ3Rlc3QnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgdXNlVmFsdWU6ICd0ZXN0JywgcHJvdmlkZTogJ3Rlc3RWYWx1ZScgfSxcbiAgICAgICAgICAgICAgICAgICAgeyB1c2VGYWN0b3J5OiAoKSA9PiAndGVzdCcsIHByb3ZpZGU6ICd0ZXN0RmFjdG9yeScgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAndGVzdFZhbHVlJyBdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gY29udGFpbmVyLm1vZHVsZShUZXN0TW9kdWxlKTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NBPigndGVzdFZhbHVlJyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmUoJ3Rlc3QnKTtcblxuICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5yZXNvbHZlKCd0ZXN0JykpLnRvVGhyb3coKTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UyID0gbW9kdWxlLmNvbnRhaW5lci5yZXNvbHZlKCd0ZXN0Jyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UyKS50b0JlSW5zdGFuY2VPZihUZXN0Q2xhc3NBKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3JlZ2lzdGVyIGEgcHJvdmlkZXIgYXMgYSBjbGFzcyByZWZlcmVuY2UnLCAoKSA9PiB7XG5cbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7IH1cblxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzMiB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3QoVGVzdENsYXNzKSBwdWJsaWMgdGVzdDogVGVzdENsYXNzXG4gICAgICAgICAgICAgICAgKSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQERJTW9kdWxlKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgVGVzdENsYXNzLCBUZXN0Q2xhc3MyIF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyBUZXN0Q2xhc3MgXVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNsYXNzIFRlc3RNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIGNvbnN0IHsgY29udGFpbmVyOiBtb2R1bGVDb250YWluZXIgfSA9IGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gbW9kdWxlQ29udGFpbmVyLnJlc29sdmUoVGVzdENsYXNzMik7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzczIpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLnRlc3QpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG5cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UxID0gY29udGFpbmVyLnJlc29sdmUoVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTEpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG5cbiAgICAgICAgfSlcblxuICAgICAgICBpdCgnaW1wb3J0cyBhbiBlbXB0eSBtb2R1bGUgd2l0aG91dCBlcnJvcnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjbGFzcyBUZXN0TW9kdWxlIHsgfVxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShUZXN0TW9kdWxlLCB7IGltcG9ydHM6IFtdLCBleHBvcnRzOiBbXSwgcHJvdmlkZXJzOiBbXSB9KTtcblxuICAgICAgICAgICAgY29uc3QgbW9kdWxlID0gY29udGFpbmVyLm1vZHVsZShUZXN0TW9kdWxlKTtcbiAgICAgICAgICAgIGV4cGVjdChtb2R1bGUpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdyZWdpc3RlcnMgbmVzdGVkIG1vZHVsZXMgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgICAgICAgY2xhc3MgTmVzdGVkTW9kdWxlIHsgfVxuICAgICAgICAgICAgY2xhc3MgVGVzdE1vZHVsZSB7IH1cblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShOZXN0ZWRNb2R1bGUsIHtcbiAgICAgICAgICAgICAgICBpbXBvcnRzOiBbXSxcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgeyBwcm92aWRlOiAnbmVzdGVkRGVwJywgdXNlVmFsdWU6ICduZXN0ZWRWYWx1ZScgfSBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ25lc3RlZERlcCcgXSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKFRlc3RNb2R1bGUsIHtcbiAgICAgICAgICAgICAgICBpbXBvcnRzOiBbIE5lc3RlZE1vZHVsZSBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ25lc3RlZERlcCcgXSxcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFtdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLm1vZHVsZShUZXN0TW9kdWxlKTtcbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkVmFsdWUgPSBjb250YWluZXIucmVzb2x2ZSgnbmVzdGVkRGVwJyk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRWYWx1ZSkudG9CZSgnbmVzdGVkVmFsdWUnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Rocm93cyBhbiBlcnJvciBpZiBhbiBleHBvcnQgaXMgbm90IHByb3ZpZGVkJywgKCkgPT4ge1xuICAgICAgICAgICAgY2xhc3MgVGVzdE1vZHVsZSB7IH1cblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShUZXN0TW9kdWxlLCB7XG4gICAgICAgICAgICAgICAgaW1wb3J0czogW10sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnbWlzc2luZ0RlcCcgXSxcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFtdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSkpLnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnTW9kdWxlcyB3aXRoIEBESU1vZHVsZSgpJywgKCkgPT4ge1xuICAgICAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgICAgICAgIGNvbnRhaW5lci5jbGVhcigpO1xuICAgICAgICAgICAgRElDb250YWluZXIuRElNZXRhZGF0YVN0b3JlLmNsZWFyTWV0YWRhdGEoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3JlZ2lzdGVycyBhIG1vZHVsZSB3aXRoIEBESU1vZHVsZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3NBIHsgfVxuXG4gICAgICAgICAgICBARElNb2R1bGUoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogW1xuICAgICAgICAgICAgICAgICAgICB7IHVzZUNsYXNzOiBUZXN0Q2xhc3NBLCBwcm92aWRlOiAndGVzdCcgfSxcbiAgICAgICAgICAgICAgICAgICAgeyB1c2VWYWx1ZTogJ3Rlc3QnLCBwcm92aWRlOiAndGVzdFZhbHVlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IHVzZUZhY3Rvcnk6ICgpID0+ICd0ZXN0JywgcHJvdmlkZTogJ3Rlc3RGYWN0b3J5JyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbICd0ZXN0VmFsdWUnIF1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjbGFzcyBUZXN0TW9kdWxlIHsgfVxuXG4gICAgICAgICAgICBjb25zdCBtb2R1bGUgPSBjb250YWluZXIubW9kdWxlKFRlc3RNb2R1bGUpO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzc0E+KCd0ZXN0VmFsdWUnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZSgndGVzdCcpO1xuXG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLnJlc29sdmUoJ3Rlc3QnKSkudG9UaHJvdygpO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZTIgPSBtb2R1bGUuY29udGFpbmVyLnJlc29sdmUoJ3Rlc3QnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTIpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzc0EpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnaW1wb3J0cyBhbiBlbXB0eSBtb2R1bGUgd2l0aG91dCBlcnJvcnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBARElNb2R1bGUoeyBpbXBvcnRzOiBbXSwgZXhwb3J0czogW10sIHByb3ZpZGVyczogW10gfSlcbiAgICAgICAgICAgIGNsYXNzIFRlc3RNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSk7XG4gICAgICAgICAgICBleHBlY3QobW9kdWxlKS50b0JlRGVmaW5lZCgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVnaXN0ZXJzIG5lc3RlZCBtb2R1bGVzIGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgICAgICAgIEBESU1vZHVsZSh7XG4gICAgICAgICAgICAgICAgaW1wb3J0czogW10sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnbmVzdGVkRGVwJyBdLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogWyB7IHByb3ZpZGU6ICduZXN0ZWREZXAnLCB1c2VWYWx1ZTogJ25lc3RlZFZhbHVlJyB9IF1cbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBjbGFzcyBOZXN0ZWRNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIEBESU1vZHVsZSh7XG4gICAgICAgICAgICAgICAgaW1wb3J0czogWyBOZXN0ZWRNb2R1bGUgXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbICduZXN0ZWREZXAnIF0sXG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbXVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNsYXNzIFRlc3RNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc29sdmVkVmFsdWUgPSBjb250YWluZXIucmVzb2x2ZSgnbmVzdGVkRGVwJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZFZhbHVlKS50b0JlKCduZXN0ZWRWYWx1ZScpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgndGhyb3dzIGFuIGVycm9yIGlmIGFuIGV4cG9ydCBpcyBub3QgcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBARElNb2R1bGUoe1xuICAgICAgICAgICAgICAgIGltcG9ydHM6IFtdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgJ21pc3NpbmdEZXAnIF0sXG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbXVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGNsYXNzIFRlc3RNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIubW9kdWxlKFRlc3RNb2R1bGUpKS50b1Rocm93KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdNYWtlIEBJbmplY3RhYmxlIHJlZ2lzdGVyIHByb3ZpZGVyIHdpdGggc3BlY2lmaWMgbW9kdWxlJywgKCkgPT4ge1xuICAgICAgICAgICAgQERJTW9kdWxlKHt9KVxuICAgICAgICAgICAgY2xhc3MgVGVzdE1vZHVsZSB7IH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoeyBwcm92aWRlZEluOiBUZXN0TW9kdWxlIH0pXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3MgeyB9XG5cbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZSA9IGNvbnRhaW5lci5tb2R1bGUoVGVzdE1vZHVsZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChtb2R1bGUuY29udGFpbmVyLnJlc29sdmUoVGVzdENsYXNzKSkudG9CZURlZmluZWQoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnRElDb250YWluZXIgLSBoYXNDaGlsZENvbnRhaW5lckJ5SWQnLCAoKSA9PiB7XG4gICAgICAgIGxldCBjb250YWluZXI6IERJQ29udGFpbmVyO1xuXG4gICAgICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICAgICAgY29udGFpbmVyID0gbmV3IERJQ29udGFpbmVyKCk7XG4gICAgICAgICAgICBESUNvbnRhaW5lci5ESU1ldGFkYXRhU3RvcmUuY2xlYXJNZXRhZGF0YSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJldHVybiB0cnVlIGlmIGEgZGlyZWN0IGNoaWxkIGNvbnRhaW5lciBoYXMgdGhlIGlkZW50aWZpZXInLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lcjEgPSBjb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ2NoaWxkMScpO1xuICAgICAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIyID0gY29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdjaGlsZDInKTtcblxuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQoJ2NoaWxkMScpKS50b0JlKHRydWUpO1xuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQoJ2NoaWxkMicpKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJldHVybiB0cnVlIGlmIGEgbmVzdGVkIGNoaWxkIGNvbnRhaW5lciBoYXMgdGhlIGlkZW50aWZpZXInLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lcjEgPSBjb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ2NoaWxkMScpO1xuICAgICAgICAgICAgY29uc3QgbmVzdGVkQ2hpbGRDb250YWluZXIgPSBjaGlsZENvbnRhaW5lcjEuY3JlYXRlQ2hpbGRDb250YWluZXIoJ25lc3RlZC1jaGlsZDEnKTtcblxuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQoJ25lc3RlZC1jaGlsZDEnKSkudG9CZSh0cnVlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gZmFsc2UgaWYgbm8gY2hpbGQgY29udGFpbmVyIGhhcyB0aGUgaWRlbnRpZmllcicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyMSA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQxJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIuaGFzQ2hpbGRDb250YWluZXJCeUlkKCdub24tZXhpc3RlbnQnKSkudG9CZShmYWxzZSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIGZhbHNlIGlmIHRoZXJlIGFyZSBubyBjaGlsZCBjb250YWluZXJzJywgKCkgPT4ge1xuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQoJ2FueS1pZCcpKS50b0JlKGZhbHNlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gdHJ1ZSBpZiBhIG5lc3RlZCBjaGlsZCBjb250YWluZXIgaGFzIHRoZSBpZGVudGlmaWVyIGV2ZW4gaWYgdGhlIGRpcmVjdCBjaGlsZCBkb2VzIG5vdCcsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyMSA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQxJyk7XG4gICAgICAgICAgICBjb25zdCBuZXN0ZWRDaGlsZENvbnRhaW5lciA9IGNoaWxkQ29udGFpbmVyMS5jcmVhdGVDaGlsZENvbnRhaW5lcignbmVzdGVkLWNoaWxkMScpO1xuXG4gICAgICAgICAgICBleHBlY3QoY29udGFpbmVyLmhhc0NoaWxkQ29udGFpbmVyQnlJZCgnbmVzdGVkLWNoaWxkMScpKS50b0JlKHRydWUpO1xuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQoJ2NoaWxkMScpKS50b0JlKHRydWUpO1xuICAgICAgICAgICAgZXhwZWN0KGNvbnRhaW5lci5oYXNDaGlsZENvbnRhaW5lckJ5SWQoJ25vbi1leGlzdGVudCcpKS50b0JlKGZhbHNlKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnUHJvdmlkZXIgUmVnaXN0cmF0aW9uIHdpdGhvdXQgYSBgcHJvdmlkZWAgS2V5JywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIHRocm93IGFuIGVycm9yIHdoZW4gcmVnaXN0ZXJpbmcgYSBwcm92aWRlciB3aXRob3V0IGEgYHByb3ZpZGVgIGtleScsICgpID0+IHtcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7IH1cbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlQ2xhc3M6IFRlc3RDbGFzcyB9IGFzIGFueSk7XG4gICAgICAgICAgICB9KS50b1Rocm93KCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1Njb3BlZCBQcm92aWRlciBSZWdpc3RyYXRpb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgY3JlYXRlIGRpZmZlcmVudCBpbnN0YW5jZXMgZm9yIHNjb3BlZCBwcm92aWRlcnMgaW4gZGlmZmVyZW50IGNoaWxkIGNvbnRhaW5lcnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IEluamVjdGFibGUgfSA9IGNvbnRhaW5lcjtcblxuICAgICAgICAgICAgQEluamVjdGFibGUoeyBzaW5nbGV0b246IGZhbHNlIH0pXG4gICAgICAgICAgICBjbGFzcyBTY29wZWRTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogU2NvcGVkU2VydmljZSwgcHJvdmlkZTogJ1Njb3BlZFNlcnZpY2UnLCBzaW5nbGV0b246IGZhbHNlIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBjaGlsZENvbnRhaW5lcjEgPSBjb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ2NoaWxkMScpO1xuICAgICAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIyID0gY29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdjaGlsZDInKTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UxID0gY2hpbGRDb250YWluZXIxLnJlc29sdmU8U2NvcGVkU2VydmljZT4oJ1Njb3BlZFNlcnZpY2UnKTtcbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMiA9IGNoaWxkQ29udGFpbmVyMi5yZXNvbHZlPFNjb3BlZFNlcnZpY2U+KCdTY29wZWRTZXJ2aWNlJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTEpLnRvQmVJbnN0YW5jZU9mKFNjb3BlZFNlcnZpY2UpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlMikudG9CZUluc3RhbmNlT2YoU2NvcGVkU2VydmljZSk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UxKS5ub3QudG9CZShpbnN0YW5jZTIpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdQcm92aWRlciBDb25kaXRpb24gRnVuY3Rpb24gRXZhbHVhdGlvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCByZWdpc3RlciBwcm92aWRlciBiYXNlZCBvbiBkeW5hbWljIHJ1bnRpbWUgY29uZGl0aW9ucycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuID0gbWFrZURJVG9rZW48c3RyaW5nPignRHluYW1pY0NvbmRpdGlvblNlcnZpY2UnKTtcbiAgICAgICAgICAgIGNvbnN0IGNvbmRpdGlvbkZuID0gamVzdC5mbigoKSA9PiBNYXRoLnJhbmRvbSgpID4gMC41KTtcblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKHsgY29uZGl0aW9uOiBjb25kaXRpb25GbiB9KVxuICAgICAgICAgICAgY2xhc3MgRHluYW1pY0NvbmRpdGlvblNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUNsYXNzOiBEeW5hbWljQ29uZGl0aW9uU2VydmljZSwgcHJvdmlkZTogdG9rZW4sIGNvbmRpdGlvbjogY29uZGl0aW9uRm4gfSk7XG5cbiAgICAgICAgICAgIGlmIChjb250YWluZXIuaGFzKHRva2VuKSkge1xuICAgICAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIucmVzb2x2ZSh0b2tlbikpLnRvQmVJbnN0YW5jZU9mKER5bmFtaWNDb25kaXRpb25TZXJ2aWNlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KCgpID0+IGNvbnRhaW5lci5yZXNvbHZlKHRva2VuKSkudG9UaHJvdygpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBleHBlY3QoY29uZGl0aW9uRm4pLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQXN5bmMgTGlmZWN5Y2xlIEhvb2tzJywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIGNhbGwgYXN5bmMgbGlmZWN5Y2xlIGhvb2tzIGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9uSW5pdFNweSA9IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh0cnVlKTtcblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFRlc3RDbGFzcyB7XG4gICAgICAgICAgICAgICAgQE9uSW5pdCgpXG4gICAgICAgICAgICAgICAgYXN5bmMgb25Jbml0KCkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBvbkluaXRTcHkoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gYXdhaXQgY29udGFpbmVyLnJlc29sdmVBc3luYyhUZXN0Q2xhc3MpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3Qob25Jbml0U3B5KS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0Vycm9yIEhhbmRsaW5nIGluIFByb3ZpZGVyIEZhY3RvcmllcycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBwcm9wYWdhdGUgZXJyb3JzIGZyb20gcHJvdmlkZXIgZmFjdG9yeSBmdW5jdGlvbnMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPHN0cmluZz4oJ0Vycm9yRmFjdG9yeScpO1xuICAgICAgICAgICAgY29uc3QgZmFjdG9yeSA9IGplc3QuZm4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFjdG9yeSBlcnJvcicpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUZhY3Rvcnk6IGZhY3RvcnksIHByb3ZpZGU6IHRva2VuIH0pO1xuXG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLnJlc29sdmUodG9rZW4pKS50b1Rocm93KCdGYWN0b3J5IGVycm9yJyk7XG4gICAgICAgICAgICBleHBlY3QoZmFjdG9yeSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdJbmhlcml0YW5jZSBBY3Jvc3MgQ29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBzdXBwb3J0IGluaGVyaXRhbmNlIGFuZCBtZXRob2Qgb3ZlcnJpZGluZyBpbiBjaGlsZCBjb250YWluZXJzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIEJhc2VTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBnZXRNZXNzYWdlKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ2Jhc2UnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgRGVyaXZlZFNlcnZpY2UgZXh0ZW5kcyBCYXNlU2VydmljZSB7XG4gICAgICAgICAgICAgICAgb3ZlcnJpZGUgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdkZXJpdmVkJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUNsYXNzOiBCYXNlU2VydmljZSwgcHJvdmlkZTogQmFzZVNlcnZpY2UubmFtZSB9KTtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyID0gY29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdjaGlsZCcpO1xuICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogRGVyaXZlZFNlcnZpY2UsIHByb3ZpZGU6IERlcml2ZWRTZXJ2aWNlLm5hbWUgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGJhc2VJbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8QmFzZVNlcnZpY2U+KEJhc2VTZXJ2aWNlKTtcbiAgICAgICAgICAgIGNvbnN0IGRlcml2ZWRJbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmU8RGVyaXZlZFNlcnZpY2U+KERlcml2ZWRTZXJ2aWNlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGJhc2VJbnN0YW5jZS5nZXRNZXNzYWdlKCkpLnRvQmUoJ2Jhc2UnKTtcbiAgICAgICAgICAgIGV4cGVjdChkZXJpdmVkSW5zdGFuY2UuZ2V0TWVzc2FnZSgpKS50b0JlKCdkZXJpdmVkJyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0R5bmFtaWMgUHJvdmlkZXIgUmVzb2x1dGlvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCByZXNvbHZlIHByb3ZpZGVycyBkeW5hbWljYWxseSBiYXNlZCBvbiBydW50aW1lIGRhdGEnLCAoKSA9PiB7XG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgQ29uZmlndXJhYmxlU2VydmljZSB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdCgnQ29uZmlnJykgcHVibGljIGNvbmZpZzogYW55KSB7IH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgZHluYW1pY0NvbmZpZyA9IHsgc2V0dGluZzogJ3ZhbHVlJyB9O1xuICAgICAgICAgICAgY29udGFpbmVyLnJlZ2lzdGVyKHsgdXNlVmFsdWU6IGR5bmFtaWNDb25maWcsIHByb3ZpZGU6ICdDb25maWcnIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPENvbmZpZ3VyYWJsZVNlcnZpY2U+KENvbmZpZ3VyYWJsZVNlcnZpY2UpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuY29uZmlnKS50b0JlKGR5bmFtaWNDb25maWcpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdTaW5nbGV0b24gQmVoYXZpb3IgQWNyb3NzIENoaWxkIENvbnRhaW5lcnMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgc2hhcmUgc2luZ2xldG9uIGluc3RhbmNlcyBhY3Jvc3MgY2hpbGQgY29udGFpbmVycycsICgpID0+IHtcbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSh7IHNpbmdsZXRvbjogdHJ1ZSB9KVxuICAgICAgICAgICAgY2xhc3MgU2luZ2xldG9uU2VydmljZSB7IH1cblxuICAgICAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIxID0gY29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdjaGlsZDEnKTtcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyMiA9IGNvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignY2hpbGQyJyk7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMSA9IGNoaWxkQ29udGFpbmVyMS5yZXNvbHZlPFNpbmdsZXRvblNlcnZpY2U+KFNpbmdsZXRvblNlcnZpY2UpO1xuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UyID0gY2hpbGRDb250YWluZXIyLnJlc29sdmU8U2luZ2xldG9uU2VydmljZT4oU2luZ2xldG9uU2VydmljZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTEpLnRvQmUoaW5zdGFuY2UyKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ2lyY3VsYXIgRGVwZW5kZW5jeSBEZXRlY3Rpb24gd2l0aCBNb3JlIENvbXBsZXhpdHknLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGNpcmN1bGFyIGRlcGVuZGVuY2llcyBpbnZvbHZpbmcgbW9yZSB0aGFuIHR3byBjbGFzc2VzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgeyBJbmplY3RhYmxlIH0gPSBjb250YWluZXI7XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKHsgcHJvdmlkZTogJ0NsYXNzQScgfSlcbiAgICAgICAgICAgIGNsYXNzIENsYXNzQSB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdCgnQ2xhc3NDJykgcHVibGljIGM6IGFueSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKHsgcHJvdmlkZTogJ0NsYXNzQicgfSlcbiAgICAgICAgICAgIGNsYXNzIENsYXNzQiB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdCgnQ2xhc3NBJykgcHVibGljIGE6IGFueSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKHsgcHJvdmlkZTogJ0NsYXNzQycgfSlcbiAgICAgICAgICAgIGNsYXNzIENsYXNzQyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdCgnQ2xhc3NCJykgcHVibGljIGI6IGFueSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGV4cGVjdChjb250YWluZXIucmVzb2x2ZSgnQ2xhc3NBJykpLnRvQmVJbnN0YW5jZU9mKENsYXNzQSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0hhbmRsaW5nIG9mIE1pc3NpbmcgT3B0aW9uYWwgRGVwZW5kZW5jaWVzJywgKCkgPT4ge1xuICAgICAgICBpdCgnY3JlYXRlcyBpbnN0YW5jZXMgd2l0aCBkZWZhdWx0IHZhbHVlcyBmb3IgbWlzc2luZyBvcHRpb25hbCBkZXBlbmRlbmNpZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KCdPcHRpb25hbERlcCcsIHsgaXNPcHRpb25hbDogdHJ1ZSwgZGVmYXVsdFZhbHVlOiAnZGVmYXVsdCcgfSkgcHVibGljIGRlcD86IHN0cmluZykgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8VGVzdENsYXNzPihUZXN0Q2xhc3MpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFRlc3RDbGFzcyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuZGVwKS50b0JlKCdkZWZhdWx0Jyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1Byb3ZpZGVyIFJlcGxhY2VtZW50IGFuZCBQcmlvcml0eSBFZGdlIENhc2VzJywgKCkgPT4ge1xuICAgICAgICBpdCgnaGFuZGxlcyBwcm92aWRlcnMgd2l0aCB0aGUgc2FtZSBwcmlvcml0eSBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3NBIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogc3RyaW5nID0gJ0EnO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3NCIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogc3RyaW5nID0gJ0InO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICd0ZXN0JyxcbiAgICAgICAgICAgICAgICB1c2VDbGFzczogVGVzdENsYXNzQSxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ3Rlc3QnLFxuICAgICAgICAgICAgICAgIHVzZUNsYXNzOiBUZXN0Q2xhc3NCLFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAxXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxUZXN0Q2xhc3NCPigndGVzdCcpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLnZhbHVlKS50b0JlKCdBJyk7IC8vIFRoZSBmaXJzdCByZWdpc3RlcmVkIHByb3ZpZGVyIHNob3VsZCB0YWtlIHByZWNlZGVuY2VcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQXN5bmMgRmFjdG9yeSBGdW5jdGlvbnMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdyZXNvbHZlcyBwcm92aWRlcnMgcmVnaXN0ZXJlZCB3aXRoIGFzeW5jIGZhY3RvcnkgZnVuY3Rpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdG9rZW4gPSBtYWtlRElUb2tlbjxzdHJpbmc+KCdBc3luY0ZhY3RvcnknKTtcbiAgICAgICAgICAgIGNvbnN0IGZhY3RvcnkgPSBhc3luYyAoKSA9PiAnYXN5bmMgdGVzdCc7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5yZWdpc3Rlcih7IHVzZUZhY3Rvcnk6IGZhY3RvcnksIHByb3ZpZGU6IHRva2VuIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGF3YWl0IGNvbnRhaW5lci5yZXNvbHZlQXN5bmModG9rZW4pO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlKCdhc3luYyB0ZXN0Jyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0VkZ2UgQ2FzZXMgZm9yIE1pZGRsZXdhcmUnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdtaWRkbGV3YXJlIGNhbiBza2lwIHRoZSBuZXh0IGZ1bmN0aW9uJywgKCkgPT4ge1xuXG4gICAgICAgICAgICBjb25zdCBtaWRkbGV3YXJlU3B5ID0gamVzdC5mbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gU2tpcCB0aGUgbmV4dCBmdW5jdGlvblxuICAgICAgICAgICAgICAgIHJldHVybiAnc2hvcnQtY2lyY3VpdGVkJztcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb250YWluZXIudXNlTWlkZGxld2FyZSh7IG1pZGRsZXdhcmU6IG1pZGRsZXdhcmVTcHkgfSk7XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBNaWRkbGV3YXJlU2VydmljZSB7IH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxhbnk+KCdNaWRkbGV3YXJlU2VydmljZScpO1xuXG4gICAgICAgICAgICBleHBlY3QobWlkZGxld2FyZVNweSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlKCdzaG9ydC1jaXJjdWl0ZWQnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2hhbmRsZXMgZXJyb3JzIGluIG1pZGRsZXdhcmUgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbWlkZGxld2FyZVNweSA9IGplc3QuZm4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWlkZGxld2FyZSBlcnJvcicpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIE1pZGRsZXdhcmVTZXJ2aWNlIHsgfVxuXG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gY29udGFpbmVyLnJlc29sdmU8TWlkZGxld2FyZVNlcnZpY2U+KCdNaWRkbGV3YXJlU2VydmljZScpKS50b1Rocm93KCdNaWRkbGV3YXJlIGVycm9yJyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0NvbmRpdGlvbmFsIFByb3ZpZGVycyB3aXRoIERlcGVuZGVuY2llcycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Jlc29sdmVzIGNvbmRpdGlvbmFsIHByb3ZpZGVycyB3aXRoIGRlcGVuZGVuY2llcyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0b2tlbiA9IG1ha2VESVRva2VuPHN0cmluZz4oJ0NvbmRpdGlvbmFsU2VydmljZScpO1xuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgRGVwZW5kZW5jeSB7IH1cblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKHsgY29uZGl0aW9uOiAoKSA9PiB0cnVlIH0pXG4gICAgICAgICAgICBjbGFzcyBDb25kaXRpb25hbFNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKEBJbmplY3QoRGVwZW5kZW5jeSkgcHVibGljIGRlcGVuZGVuY3k6IERlcGVuZGVuY3kpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb250YWluZXIucmVnaXN0ZXIoeyB1c2VDbGFzczogRGVwZW5kZW5jeSwgcHJvdmlkZTogRGVwZW5kZW5jeS5uYW1lIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPENvbmRpdGlvbmFsU2VydmljZT4oJ0NvbmRpdGlvbmFsU2VydmljZScpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihDb25kaXRpb25hbFNlcnZpY2UpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmRlcGVuZGVuY3kpLnRvQmVJbnN0YW5jZU9mKERlcGVuZGVuY3kpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdBc3luYyBFcnJvciBIYW5kbGluZycsICgpID0+IHtcbiAgICAgICAgaXQoJ2hhbmRsZXMgZXJyb3JzIGluIGFzeW5jIGxpZmVjeWNsZSBob29rcycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9uSW5pdFNweSA9IGplc3QuZm4oKS5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoJ0FzeW5jIGluaXQgZXJyb3InKSk7XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBUZXN0Q2xhc3Mge1xuICAgICAgICAgICAgICAgIEBPbkluaXQoKVxuICAgICAgICAgICAgICAgIGFzeW5jIG9uSW5pdCgpIHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgb25Jbml0U3B5KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhd2FpdCBleHBlY3QoY29udGFpbmVyLnJlc29sdmVBc3luYyhUZXN0Q2xhc3MpKS5yZWplY3RzLnRvVGhyb3coJ0FzeW5jIGluaXQgZXJyb3InKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ29tcGxleCBJbmhlcml0YW5jZSBhbmQgSW50ZXJmYWNlIEltcGxlbWVudGF0aW9ucycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Jlc29sdmVzIGNsYXNzZXMgaW1wbGVtZW50aW5nIGludGVyZmFjZXMgYW5kIGV4dGVuZGluZyBvdGhlciBjbGFzc2VzJywgKCkgPT4ge1xuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIEJhc2VTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBnZXRTZXJ2aWNlTmFtZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdCYXNlU2VydmljZSc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpbnRlcmZhY2UgSVNlcnZpY2Uge1xuICAgICAgICAgICAgICAgIGdldFNlcnZpY2VOYW1lKCk6IHN0cmluZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIERlcml2ZWRTZXJ2aWNlIGV4dGVuZHMgQmFzZVNlcnZpY2UgaW1wbGVtZW50cyBJU2VydmljZSB7XG4gICAgICAgICAgICAgICAgb3ZlcnJpZGUgZ2V0U2VydmljZU5hbWUoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnRGVyaXZlZFNlcnZpY2UnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxEZXJpdmVkU2VydmljZT4oRGVyaXZlZFNlcnZpY2UpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKERlcml2ZWRTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5nZXRTZXJ2aWNlTmFtZSgpKS50b0JlKCdEZXJpdmVkU2VydmljZScpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdSZWN1cnNpdmUgRGVwZW5kZW5jeSBSZXNvbHV0aW9uJywgKCkgPT4ge1xuICAgICAgICBpdCgncmVzb2x2ZXMgcHJvdmlkZXJzIHRoYXQgZGVwZW5kIG9uIGR5bmFtaWNhbGx5IHJlc29sdmVkIHByb3ZpZGVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgSW5qZWN0YWJsZSB9ID0gY29udGFpbmVyO1xuXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBEeW5hbWljUHJvdmlkZXIge1xuICAgICAgICAgICAgICAgIGdldFZhbHVlKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ2R5bmFtaWMgdmFsdWUnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgVGVzdENsYXNzIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KER5bmFtaWNQcm92aWRlcikgcHVibGljIHByb3ZpZGVyOiBEeW5hbWljUHJvdmlkZXIpIHsgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IGNvbnRhaW5lci5yZXNvbHZlPFRlc3RDbGFzcz4oVGVzdENsYXNzKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZS5wcm92aWRlci5nZXRWYWx1ZSgpKS50b0JlKCdkeW5hbWljIHZhbHVlJyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0xpZmVjeWNsZSBIb29rcyBPcmRlcicsICgpID0+IHtcbiAgICAgICAgaXQoJ2NhbGxzIGxpZmVjeWNsZSBob29rcyBpbiB0aGUgY29ycmVjdCBvcmRlcicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9uSW5pdFNweTEgPSBqZXN0LmZuKCk7XG4gICAgICAgICAgICBjb25zdCBvbkluaXRTcHkyID0gamVzdC5mbigpO1xuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgRmlyc3RTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBAT25Jbml0KClcbiAgICAgICAgICAgICAgICBvbkluaXQoKSB7XG4gICAgICAgICAgICAgICAgICAgIG9uSW5pdFNweTEoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZWNvbmRTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihASW5qZWN0KEZpcnN0U2VydmljZSkgcHVibGljIGZpcnN0U2VydmljZTogRmlyc3RTZXJ2aWNlKSB7IH1cblxuICAgICAgICAgICAgICAgIEBPbkluaXQoKVxuICAgICAgICAgICAgICAgIG9uSW5pdCgpIHtcbiAgICAgICAgICAgICAgICAgICAgb25Jbml0U3B5MigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBhd2FpdCBjb250YWluZXIucmVzb2x2ZUFzeW5jPFNlY29uZFNlcnZpY2U+KFNlY29uZFNlcnZpY2UpO1xuXG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlY29uZFNlcnZpY2UpO1xuICAgICAgICAgICAgZXhwZWN0KG9uSW5pdFNweTEpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnTWlkZGxld2FyZSBTdGF0ZSBNYW5hZ2VtZW50JywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIG1haW50YWluIGFuZCBtb2RpZnkgc3RhdGUgYWNyb3NzIG11bHRpcGxlIHJlc29sdXRpb25zIHVzaW5nIG1pZGRsZXdhcmUnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBtaWRkbGV3YXJlU3B5ID0gamVzdC5mbigobmV4dCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRlID0geyBjb3VudGVyOiAwIH07XG4gICAgICAgICAgICAgICAgc3RhdGUuY291bnRlcisrO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IG5leHQoKTtcbiAgICAgICAgICAgICAgICByZXN1bHQuc3RhdGUgPSBzdGF0ZTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci51c2VNaWRkbGV3YXJlKHsgbWlkZGxld2FyZTogbWlkZGxld2FyZVNweSB9KTtcblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKHsgc2luZ2xldG9uOiBmYWxzZSB9KSAgLy8gRW5zdXJlIGVhY2ggcmVzb2x1dGlvbiBjcmVhdGVzIGEgbmV3IGluc3RhbmNlICAgICAgICAgICAgY2xhc3MgU3RhdGVmdWxTZXJ2aWNlIHt9XG4gICAgICAgICAgICBjbGFzcyBTdGF0ZWZ1bFNlcnZpY2UgeyB9XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlMSA9IGNvbnRhaW5lci5yZXNvbHZlPGFueT4oJ1N0YXRlZnVsU2VydmljZScpO1xuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UyID0gY29udGFpbmVyLnJlc29sdmU8YW55PignU3RhdGVmdWxTZXJ2aWNlJyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTEuc3RhdGUuY291bnRlcikudG9CZSgxKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZTIuc3RhdGUuY291bnRlcikudG9CZSgxKTsgLy8gTWlkZGxld2FyZSBjcmVhdGVzIG5ldyBzdGF0ZSBmb3IgZWFjaCByZXNvbHV0aW9uXG4gICAgICAgICAgICBleHBlY3QobWlkZGxld2FyZVNweSkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDIpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdDb25maWcgcmVzb2x2ZUNvbmZpZycsICgpID0+IHtcbiAgICAgICAgbGV0IHJvb3RDb250YWluZXI6IERJQ29udGFpbmVyO1xuICAgICAgICBsZXQgY2hpbGRDb250YWluZXI6IERJQ29udGFpbmVyO1xuXG4gICAgICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICAgICAgRElDb250YWluZXIuRElNZXRhZGF0YVN0b3JlLmNsZWFyTWV0YWRhdGEoKTtcbiAgICAgICAgICAgIHJvb3RDb250YWluZXIgPSBuZXcgRElDb250YWluZXIodW5kZWZpbmVkLCAnUk9PVCcpO1xuICAgICAgICAgICAgY2hpbGRDb250YWluZXIgPSByb290Q29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdDSElMRCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJlZ2lzdGVyIGFuZCByZXNvbHZlIGNvbmZpZ3VyYXRpb24gZnJvbSB0aGUgcm9vdCBjb250YWluZXInLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjb25maWdQcm92aWRlcjogQ29uZmlnUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAubmFtZScsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiAnVGVzdEFwcCcsXG4gICAgICAgICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoY29uZmlnUHJvdmlkZXIpO1xuXG4gICAgICAgICAgICBjb25zdCByZXNvbHZlZENvbmZpZyA9IHJvb3RDb250YWluZXIucmVzb2x2ZUNvbmZpZygnYXBwLm5hbWUnKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZENvbmZpZykudG9CZSgnVGVzdEFwcCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIG1lcmdlIGFuZCByZXNvbHZlIGNvbmZpZ3VyYXRpb25zIGZyb20gcGFyZW50IGFuZCBjaGlsZCBjb250YWluZXJzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgcm9vdENvbmZpZ1Byb3ZpZGVyOiBDb25maWdQcm92aWRlck9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcCcsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7IG5hbWU6ICdUZXN0QXBwJywgdmVyc2lvbjogJzEuMCcgfSxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMSxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29uZmlnUHJvdmlkZXI6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6IHsgdmVyc2lvbjogJzIuMCcgfSxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMSxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcihyb290Q29uZmlnUHJvdmlkZXIpO1xuICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcihjaGlsZENvbmZpZ1Byb3ZpZGVyKTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlQ29uZmlnKCdhcHAnKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXNvbHZlZENvbmZpZykudG9FcXVhbCh7IG5hbWU6ICdUZXN0QXBwJywgdmVyc2lvbjogJzIuMCcgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmVzcGVjdCBwcmlvcml0eSB3aGVuIHJlc29sdmluZyBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbG93UHJpb3JpdHlDb25maWc6IENvbmZpZ1Byb3ZpZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwLm5hbWUnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogJ0xvd1ByaW9yaXR5QXBwJyxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMSxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGhpZ2hQcmlvcml0eUNvbmZpZzogQ29uZmlnUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAubmFtZScsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiAnSGlnaFByaW9yaXR5QXBwJyxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMixcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcihsb3dQcmlvcml0eUNvbmZpZyk7XG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoaGlnaFByaW9yaXR5Q29uZmlnKTtcblxuICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSByb290Q29udGFpbmVyLnJlc29sdmVDb25maWcoJ2FwcC5uYW1lJyk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWcpLnRvQmUoJ0hpZ2hQcmlvcml0eUFwcCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGZpbHRlciBjb25maWd1cmF0aW9ucyBiYXNlZCBvbiB0YWdzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnV2l0aFRhZzogQ29uZmlnUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAubmFtZScsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiAnVGFnZ2VkQXBwJyxcbiAgICAgICAgICAgICAgICB0YWdzOiBbICdyZWxlYXNlJyBdLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgY29uZmlnV2l0aG91dFRhZzogQ29uZmlnUHJvdmlkZXJPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAubmFtZScsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiAnVW50YWdnZWRBcHAnLFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKGNvbmZpZ1dpdGhUYWcpO1xuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKGNvbmZpZ1dpdGhvdXRUYWcpO1xuXG4gICAgICAgICAgICBjb25zdCByZXNvbHZlZENvbmZpZ1dpdGhUYWdzID0gcm9vdENvbnRhaW5lci5yZXNvbHZlQ29uZmlnKCdhcHAubmFtZScsIHtcbiAgICAgICAgICAgICAgICB0YWdzOiBbICdyZWxlYXNlJyBdLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBleHBlY3QocmVzb2x2ZWRDb25maWdXaXRoVGFncykudG9CZSgnVGFnZ2VkQXBwJyk7XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCB0aHJvdyBmb3Igbm9uLWV4aXN0ZW50IGNvbmZpZ3VyYXRpb24gcGF0aHMnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gcm9vdENvbnRhaW5lci5yZXNvbHZlQ29uZmlnKCdub24uZXhpc3RlbnQucGF0aCcpKS50b1Rocm93KCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG5cbiAgICBkZXNjcmliZSgnREkgQ29udGFpbmVyIFNlbGYgSW5qZWN0aW9uJywgKCkgPT4ge1xuICAgICAgICBsZXQgcm9vdENvbnRhaW5lcjogRElDb250YWluZXI7XG5cbiAgICAgICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAgICAgICByb290Q29udGFpbmVyID0gbmV3IERJQ29udGFpbmVyKHVuZGVmaW5lZCwgJ1JPT1QnKTtcbiAgICAgICAgICAgIERJQ29udGFpbmVyLkRJTWV0YWRhdGFTdG9yZS5jbGVhck1ldGFkYXRhKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaW5qZWN0IERJQ29udGFpbmVyIGludG8gYSBzZXJ2aWNlJywgKCkgPT4ge1xuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZVdpdGhDb250YWluZXIge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0Q29udGFpbmVyKCkgcHJpdmF0ZSBjb250YWluZXI6IERJQ29udGFpbmVyXG4gICAgICAgICAgICAgICAgKSB7IH1cblxuICAgICAgICAgICAgICAgIGdldENvbnRhaW5lcklkZW50aWZpZXIoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29udGFpbmVyLmNvbnRhaW5lcklkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoQ29udGFpbmVyLCB1c2VDbGFzczogU2VydmljZVdpdGhDb250YWluZXIgfSk7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSByb290Q29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhDb250YWluZXIpO1xuXG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlKS50b0JlSW5zdGFuY2VPZihTZXJ2aWNlV2l0aENvbnRhaW5lcik7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRDb250YWluZXJJZGVudGlmaWVyKCkpLnRvQmUoJ1JPT1QnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXNvbHZlIGRlcGVuZGVuY2llcyBhbmQgaW5qZWN0IERJQ29udGFpbmVyJywgKCkgPT4ge1xuICAgICAgICAgICAgLy8gQW5vdGhlciBtb2NrIHNlcnZpY2UgY2xhc3MgdG8gdGVzdCBkZXBlbmRlbmN5IHJlc29sdXRpb25cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIEFub3RoZXJTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBnZXRWYWx1ZSgpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0hlbGxvIGZyb20gQW5vdGhlclNlcnZpY2UnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gU2VydmljZSBjbGFzcyB0aGF0IGRlcGVuZHMgb24gYW5vdGhlciBzZXJ2aWNlIGFuZCB0aGUgY29udGFpbmVyXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aERlcGVuZGVuY2llcyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3QoQW5vdGhlclNlcnZpY2UpIHByaXZhdGUgYW5vdGhlclNlcnZpY2U6IEFub3RoZXJTZXJ2aWNlLFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0Q29udGFpbmVyKCkgcHJpdmF0ZSBjb250YWluZXI6IERJQ29udGFpbmVyXG4gICAgICAgICAgICAgICAgKSB7IH1cblxuICAgICAgICAgICAgICAgIGdldFNlcnZpY2VWYWx1ZSgpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hbm90aGVyU2VydmljZS5nZXRWYWx1ZSgpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGdldENvbnRhaW5lcklkZW50aWZpZXIoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29udGFpbmVyLmNvbnRhaW5lcklkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IEFub3RoZXJTZXJ2aWNlLCB1c2VDbGFzczogQW5vdGhlclNlcnZpY2UgfSk7XG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhEZXBlbmRlbmNpZXMsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aERlcGVuZGVuY2llcyB9KTtcblxuICAgICAgICAgICAgY29uc3Qgc2VydmljZUluc3RhbmNlID0gcm9vdENvbnRhaW5lci5yZXNvbHZlKFNlcnZpY2VXaXRoRGVwZW5kZW5jaWVzKTtcblxuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoU2VydmljZVdpdGhEZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0U2VydmljZVZhbHVlKCkpLnRvQmUoJ0hlbGxvIGZyb20gQW5vdGhlclNlcnZpY2UnKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldENvbnRhaW5lcklkZW50aWZpZXIoKSkudG9CZSgnUk9PVCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJlc29sdmUgZGVwZW5kZW5jaWVzIGFuZCBpbmplY3QgRElDb250YWluZXIgYXMgcHJvcGVydHkgaW5qZWN0aW9uJywgKCkgPT4ge1xuICAgICAgICAgICAgLy8gQW5vdGhlciBtb2NrIHNlcnZpY2UgY2xhc3MgdG8gdGVzdCBkZXBlbmRlbmN5IHJlc29sdXRpb25cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIEFub3RoZXJTZXJ2aWNlIHtcbiAgICAgICAgICAgICAgICBnZXRWYWx1ZSgpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0hlbGxvIGZyb20gQW5vdGhlclNlcnZpY2UnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZVdpdGhQcm9wZXJ0eURlcGVuZGVuY2llcyB7XG4gICAgICAgICAgICAgICAgQEluamVjdENvbnRhaW5lcigpXG4gICAgICAgICAgICAgICAgcHJpdmF0ZSBjb250YWluZXI/OiBESUNvbnRhaW5lclxuXG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3QoQW5vdGhlclNlcnZpY2UpIHByaXZhdGUgYW5vdGhlclNlcnZpY2U6IEFub3RoZXJTZXJ2aWNlLFxuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRTZXJ2aWNlVmFsdWUoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYW5vdGhlclNlcnZpY2UuZ2V0VmFsdWUoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBnZXRDb250YWluZXJJZGVudGlmaWVyKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5jb250YWluZXI/LmNvbnRhaW5lcklkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IEFub3RoZXJTZXJ2aWNlLCB1c2VDbGFzczogQW5vdGhlclNlcnZpY2UgfSk7XG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhQcm9wZXJ0eURlcGVuZGVuY2llcywgdXNlQ2xhc3M6IFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IHJvb3RDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aFByb3BlcnR5RGVwZW5kZW5jaWVzKTtcblxuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoU2VydmljZVdpdGhQcm9wZXJ0eURlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRTZXJ2aWNlVmFsdWUoKSkudG9CZSgnSGVsbG8gZnJvbSBBbm90aGVyU2VydmljZScpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0Q29udGFpbmVySWRlbnRpZmllcigpKS50b0JlKCdST09UJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaW5qZWN0IERJQ29udGFpbmVyIGludG8gYSBzZXJ2aWNlIHdpdGggY2hpbGQgY29udGFpbmVyJywgKCkgPT4ge1xuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZVdpdGhDb250YWluZXIge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0Q29udGFpbmVyKCkgcHJpdmF0ZSBjb250YWluZXI6IERJQ29udGFpbmVyXG4gICAgICAgICAgICAgICAgKSB7IH1cblxuICAgICAgICAgICAgICAgIGdldENvbnRhaW5lcklkZW50aWZpZXIoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29udGFpbmVyLmNvbnRhaW5lcklkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY2hpbGRDb250YWluZXIgPSByb290Q29udGFpbmVyLmNyZWF0ZUNoaWxkQ29udGFpbmVyKCdDSElMRCcpO1xuICAgICAgICAgICAgY2hpbGRDb250YWluZXIucmVnaXN0ZXIoeyBwcm92aWRlOiBTZXJ2aWNlV2l0aENvbnRhaW5lciwgdXNlQ2xhc3M6IFNlcnZpY2VXaXRoQ29udGFpbmVyIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlKFNlcnZpY2VXaXRoQ29udGFpbmVyKTtcblxuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoU2VydmljZVdpdGhDb250YWluZXIpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0Q29udGFpbmVySWRlbnRpZmllcigpKS50b0JlKCdDSElMRCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJlc29sdmUgZnJvbSBjaGlsZCBjb250YWluZXIgYW5kIGluamVjdCBESUNvbnRhaW5lcicsICgpID0+IHtcbiAgICAgICAgICAgIC8vIEFub3RoZXIgbW9jayBzZXJ2aWNlIGNsYXNzIHRvIHRlc3QgZGVwZW5kZW5jeSByZXNvbHV0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBBbm90aGVyU2VydmljZSB7XG4gICAgICAgICAgICAgICAgZ2V0VmFsdWUoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdIZWxsbyBmcm9tIEFub3RoZXJTZXJ2aWNlJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aERlcGVuZGVuY2llcyB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoXG4gICAgICAgICAgICAgICAgICAgIEBJbmplY3QoQW5vdGhlclNlcnZpY2UpIHByaXZhdGUgYW5vdGhlclNlcnZpY2U6IEFub3RoZXJTZXJ2aWNlLFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0Q29udGFpbmVyKCkgcHJpdmF0ZSBjb250YWluZXI6IERJQ29udGFpbmVyXG4gICAgICAgICAgICAgICAgKSB7IH1cblxuICAgICAgICAgICAgICAgIGdldFNlcnZpY2VWYWx1ZSgpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hbm90aGVyU2VydmljZS5nZXRWYWx1ZSgpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGdldENvbnRhaW5lcklkZW50aWZpZXIoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29udGFpbmVyLmNvbnRhaW5lcklkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyID0gcm9vdENvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignQ0hJTEQnKTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogQW5vdGhlclNlcnZpY2UsIHVzZUNsYXNzOiBBbm90aGVyU2VydmljZSB9KTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhEZXBlbmRlbmNpZXMsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aERlcGVuZGVuY2llcyB9KTtcblxuICAgICAgICAgICAgY29uc3Qgc2VydmljZUluc3RhbmNlID0gY2hpbGRDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aERlcGVuZGVuY2llcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoRGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldFNlcnZpY2VWYWx1ZSgpKS50b0JlKCdIZWxsbyBmcm9tIEFub3RoZXJTZXJ2aWNlJyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRDb250YWluZXJJZGVudGlmaWVyKCkpLnRvQmUoJ0NISUxEJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmVzb2x2ZSBmcm9tIGNoaWxkIGNvbnRhaW5lciBhbmQgaW5qZWN0IERJQ29udGFpbmVyIGFzIHByb3BlcnR5IGluamVjdGlvbicsICgpID0+IHtcbiAgICAgICAgICAgIC8vIEFub3RoZXIgbW9jayBzZXJ2aWNlIGNsYXNzIHRvIHRlc3QgZGVwZW5kZW5jeSByZXNvbHV0aW9uXG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBBbm90aGVyU2VydmljZSB7XG4gICAgICAgICAgICAgICAgZ2V0VmFsdWUoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdIZWxsbyBmcm9tIEFub3RoZXJTZXJ2aWNlJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMge1xuICAgICAgICAgICAgICAgIEBJbmplY3RDb250YWluZXIoKVxuICAgICAgICAgICAgICAgIHByaXZhdGUgY29udGFpbmVyPzogRElDb250YWluZXJcblxuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0KEFub3RoZXJTZXJ2aWNlKSBwcml2YXRlIGFub3RoZXJTZXJ2aWNlOiBBbm90aGVyU2VydmljZSxcbiAgICAgICAgICAgICAgICApIHsgfVxuXG4gICAgICAgICAgICAgICAgZ2V0U2VydmljZVZhbHVlKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFub3RoZXJTZXJ2aWNlLmdldFZhbHVlKCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZ2V0Q29udGFpbmVySWRlbnRpZmllcigpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29udGFpbmVyPy5jb250YWluZXJJZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkQ29udGFpbmVyID0gcm9vdENvbnRhaW5lci5jcmVhdGVDaGlsZENvbnRhaW5lcignQ0hJTEQnKTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogQW5vdGhlclNlcnZpY2UsIHVzZUNsYXNzOiBBbm90aGVyU2VydmljZSB9KTtcbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhQcm9wZXJ0eURlcGVuZGVuY2llcywgdXNlQ2xhc3M6IFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IGNoaWxkQ29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhQcm9wZXJ0eURlcGVuZGVuY2llcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoUHJvcGVydHlEZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0U2VydmljZVZhbHVlKCkpLnRvQmUoJ0hlbGxvIGZyb20gQW5vdGhlclNlcnZpY2UnKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldENvbnRhaW5lcklkZW50aWZpZXIoKSkudG9CZSgnQ0hJTEQnKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ29uZmlnIEluamVjdGlvbiB2aWEgRGVjb3JhdG9yJywgKCkgPT4ge1xuICAgICAgICBsZXQgcm9vdENvbnRhaW5lcjogRElDb250YWluZXI7XG4gICAgICAgIGxldCBjaGlsZENvbnRhaW5lcjogRElDb250YWluZXI7XG5cbiAgICAgICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAgICAgICBESUNvbnRhaW5lci5ESU1ldGFkYXRhU3RvcmUuY2xlYXJNZXRhZGF0YSgpO1xuICAgICAgICAgICAgcm9vdENvbnRhaW5lciA9IG5ldyBESUNvbnRhaW5lcih1bmRlZmluZWQsICdST09UJyk7XG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lciA9IHJvb3RDb250YWluZXIuY3JlYXRlQ2hpbGRDb250YWluZXIoJ0NISUxEJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaW5qZWN0IGNvbmZpZ3VyYXRpb24gaW50byBhIHNlcnZpY2UgdmlhIGNvbnN0cnVjdG9yJywgKCkgPT4ge1xuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6IHsgbmFtZTogJ1Rlc3RBcHAnLCB2ZXJzaW9uOiAnMS4wJyB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gTW9jayBzZXJ2aWNlIGNsYXNzIHRoYXQgcmVxdWlyZXMgY29uZmlndXJhdGlvbiBpbmplY3Rpb25cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoQ29uZmlnIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLm5hbWUnKSBwcml2YXRlIGFwcE5hbWU6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLnZlcnNpb24nKSBwcml2YXRlIGFwcFZlcnNpb246IHN0cmluZ1xuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRBcHBEZXRhaWxzKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBgQXBwOiAke3RoaXMuYXBwTmFtZX0sIFZlcnNpb246ICR7dGhpcy5hcHBWZXJzaW9ufWA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhDb25maWcsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aENvbmZpZyB9KTtcbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IHJvb3RDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aENvbmZpZyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoQ29uZmlnKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldEFwcERldGFpbHMoKSkudG9CZSgnQXBwOiBUZXN0QXBwLCBWZXJzaW9uOiAxLjAnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBpbmplY3QgY29uZmlndXJhdGlvbiBpbnRvIGEgc2VydmljZSB2aWEgcHJvcGVydGllcycsICgpID0+IHtcbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcCcsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7IG5hbWU6ICdUZXN0QXBwJywgdmVyc2lvbjogJzEuMCcgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEFub3RoZXIgc2VydmljZSB3aXRoIGNvbmZpZ3VyYXRpb24gaW5qZWN0ZWQgdmlhIHByb3BlcnR5XG4gICAgICAgICAgICBASW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlV2l0aFByb3BlcnR5Q29uZmlnIHtcbiAgICAgICAgICAgICAgICBASW5qZWN0Q29uZmlnKCdhcHAubmFtZScpXG4gICAgICAgICAgICAgICAgcHJpdmF0ZSBhcHBOYW1lITogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLnZlcnNpb24nKVxuICAgICAgICAgICAgICAgIHByaXZhdGUgYXBwVmVyc2lvbiE6IHN0cmluZztcblxuICAgICAgICAgICAgICAgIGdldEFwcERldGFpbHMoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGBBcHA6ICR7dGhpcy5hcHBOYW1lfSwgVmVyc2lvbjogJHt0aGlzLmFwcFZlcnNpb259YDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXIoeyBwcm92aWRlOiBTZXJ2aWNlV2l0aFByb3BlcnR5Q29uZmlnLCB1c2VDbGFzczogU2VydmljZVdpdGhQcm9wZXJ0eUNvbmZpZyB9KTtcbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IHJvb3RDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aFByb3BlcnR5Q29uZmlnKTtcblxuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoU2VydmljZVdpdGhQcm9wZXJ0eUNvbmZpZyk7XG4gICAgICAgICAgICBleHBlY3Qoc2VydmljZUluc3RhbmNlPy5nZXRBcHBEZXRhaWxzKCkpLnRvQmUoJ0FwcDogVGVzdEFwcCwgVmVyc2lvbjogMS4wJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgbWVyZ2UgY29uZmlndXJhdGlvbnMgZnJvbSBwYXJlbnQgYW5kIGNoaWxkIGNvbnRhaW5lcnMgYW5kIGluamVjdCcsICgpID0+IHtcbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcCcsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7IG5hbWU6ICdUZXN0QXBwJywgdmVyc2lvbjogJzEuMCcgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNoaWxkQ29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogeyB2ZXJzaW9uOiAnMi4wJyB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gTW9jayBzZXJ2aWNlIGNsYXNzIHRoYXQgcmVxdWlyZXMgY29uZmlndXJhdGlvbiBpbmplY3Rpb25cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoQ29uZmlnIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLm5hbWUnKSBwcml2YXRlIGFwcE5hbWU6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLnZlcnNpb24nKSBwcml2YXRlIGFwcFZlcnNpb246IHN0cmluZ1xuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRBcHBEZXRhaWxzKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBgQXBwOiAke3RoaXMuYXBwTmFtZX0sIFZlcnNpb246ICR7dGhpcy5hcHBWZXJzaW9ufWA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjaGlsZENvbnRhaW5lci5yZWdpc3Rlcih7IHByb3ZpZGU6IFNlcnZpY2VXaXRoQ29uZmlnLCB1c2VDbGFzczogU2VydmljZVdpdGhDb25maWcgfSk7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlSW5zdGFuY2UgPSBjaGlsZENvbnRhaW5lci5yZXNvbHZlKFNlcnZpY2VXaXRoQ29uZmlnKTtcblxuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoU2VydmljZVdpdGhDb25maWcpO1xuICAgICAgICAgICAgZXhwZWN0KHNlcnZpY2VJbnN0YW5jZT8uZ2V0QXBwRGV0YWlscygpKS50b0JlKCdBcHA6IFRlc3RBcHAsIFZlcnNpb246IDIuMCcpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJlc3BlY3QgcHJpb3JpdHkgd2hlbiBpbmplY3RpbmcgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcCcsXG4gICAgICAgICAgICAgICAgdXNlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdMb3dQcmlvcml0eUFwcCcsXG4gICAgICAgICAgICAgICAgICAgIHZlcnNpb246ICcxLjAnXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwcmlvcml0eTogMVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcC5uYW1lJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6ICdIaWdoUHJpb3JpdHlBcHAnLFxuICAgICAgICAgICAgICAgIHByaW9yaXR5OiAyXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gTW9jayBzZXJ2aWNlIGNsYXNzIHRoYXQgcmVxdWlyZXMgY29uZmlndXJhdGlvbiBpbmplY3Rpb25cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoQ29uZmlnIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLm5hbWUnKSBwcml2YXRlIGFwcE5hbWU6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLnZlcnNpb24nKSBwcml2YXRlIGFwcFZlcnNpb246IHN0cmluZ1xuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRBcHBEZXRhaWxzKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBgQXBwOiAke3RoaXMuYXBwTmFtZX0sIFZlcnNpb246ICR7dGhpcy5hcHBWZXJzaW9ufWA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhDb25maWcsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aENvbmZpZyB9KTtcbiAgICAgICAgICAgIGNvbnN0IHNlcnZpY2VJbnN0YW5jZSA9IHJvb3RDb250YWluZXIucmVzb2x2ZShTZXJ2aWNlV2l0aENvbmZpZyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoQ29uZmlnKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldEFwcERldGFpbHMoKSkudG9Db250YWluKCdIaWdoUHJpb3JpdHlBcHAnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBmaWx0ZXIgY29uZmlndXJhdGlvbnMgYmFzZWQgb24gdGFncyBhbmQgaW5qZWN0JywgKCkgPT4ge1xuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGU6ICdhcHAnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiAnMS4wLS0tJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcm9vdENvbnRhaW5lci5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlOiAnYXBwLm5hbWUnLFxuICAgICAgICAgICAgICAgIHVzZUNvbmZpZzogJ1RhZ2dlZEFwcCcsXG4gICAgICAgICAgICAgICAgdGFnczogWyAncmVsZWFzZScgXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gICAgICAgICAgICAgICAgcHJvdmlkZTogJ2FwcC5uYW1lJyxcbiAgICAgICAgICAgICAgICB1c2VDb25maWc6ICdVbnRhZ2dlZEFwcCdcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBNb2NrIHNlcnZpY2UgY2xhc3MgdGhhdCByZXF1aXJlcyBjb25maWd1cmF0aW9uIGluamVjdGlvblxuICAgICAgICAgICAgQEluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZVdpdGhDb25maWcge1xuICAgICAgICAgICAgICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0Q29uZmlnKCdhcHAubmFtZScpIHByaXZhdGUgYXBwTmFtZTogc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICBASW5qZWN0Q29uZmlnKCdhcHAudmVyc2lvbicpIHByaXZhdGUgYXBwVmVyc2lvbjogc3RyaW5nXG4gICAgICAgICAgICAgICAgKSB7IH1cblxuICAgICAgICAgICAgICAgIGdldEFwcERldGFpbHMoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGBBcHA6ICR7dGhpcy5hcHBOYW1lfSwgVmVyc2lvbjogJHt0aGlzLmFwcFZlcnNpb259YDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJvb3RDb250YWluZXIucmVnaXN0ZXIoeyBwcm92aWRlOiBTZXJ2aWNlV2l0aENvbmZpZywgdXNlQ2xhc3M6IFNlcnZpY2VXaXRoQ29uZmlnLCB0YWdzOiBbICdyZWxlYXNlJyBdIH0pO1xuICAgICAgICAgICAgY29uc3Qgc2VydmljZUluc3RhbmNlID0gcm9vdENvbnRhaW5lci5yZXNvbHZlKFNlcnZpY2VXaXRoQ29uZmlnLCB7IHRhZ3M6IFsgJ3JlbGVhc2UnIF0gfSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2UpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VXaXRoQ29uZmlnKTtcbiAgICAgICAgICAgIGV4cGVjdChzZXJ2aWNlSW5zdGFuY2U/LmdldEFwcERldGFpbHMoKSkudG9Db250YWluKCdUYWdnZWRBcHAnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCB0aHJvdyBhbiBlcnJvciBmb3Igbm9uLWV4aXN0ZW50IGNvbmZpZ3VyYXRpb24gcGF0aHMgZHVyaW5nIGluamVjdGlvbicsICgpID0+IHtcblxuICAgICAgICAgICAgLy8gTW9jayBzZXJ2aWNlIGNsYXNzIHRoYXQgcmVxdWlyZXMgY29uZmlndXJhdGlvbiBpbmplY3Rpb25cbiAgICAgICAgICAgIEBJbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VXaXRoQ29uZmlnIHtcbiAgICAgICAgICAgICAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLm5hbWUnKSBwcml2YXRlIGFwcE5hbWU6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgQEluamVjdENvbmZpZygnYXBwLnZlcnNpb24nKSBwcml2YXRlIGFwcFZlcnNpb246IHN0cmluZ1xuICAgICAgICAgICAgICAgICkgeyB9XG5cbiAgICAgICAgICAgICAgICBnZXRBcHBEZXRhaWxzKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBgQXBwOiAke3RoaXMuYXBwTmFtZX0sIFZlcnNpb246ICR7dGhpcy5hcHBWZXJzaW9ufWA7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByb290Q29udGFpbmVyLnJlZ2lzdGVyKHsgcHJvdmlkZTogU2VydmljZVdpdGhDb25maWcsIHVzZUNsYXNzOiBTZXJ2aWNlV2l0aENvbmZpZyB9KTtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiByb290Q29udGFpbmVyLnJlc29sdmUoU2VydmljZVdpdGhDb25maWcpKS50b1Rocm93KCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ01vZHVsZSBFeHBvcnRzIGFuZCBJbXBvcnRzJywgKCkgPT4ge1xuICAgICAgICBpdCgncmVzb2x2ZXMgZXhwb3J0ZWQgZGVwZW5kZW5jaWVzIGZyb20gaW1wb3J0ZWQgbW9kdWxlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNsYXNzIE1vZHVsZUEgeyB9XG4gICAgICAgICAgICBjbGFzcyBNb2R1bGVCIHsgfVxuXG4gICAgICAgICAgICBAY29udGFpbmVyLkluamVjdGFibGUoKVxuICAgICAgICAgICAgY2xhc3MgU2VydmljZUEgeyB9XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlQiB7XG4gICAgICAgICAgICAgICAgY29uc3RydWN0b3IoQEluamVjdChTZXJ2aWNlQSkgcHVibGljIHNlcnZpY2VBOiBTZXJ2aWNlQSkgeyB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoTW9kdWxlQSwge1xuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogWyB7IHByb3ZpZGU6IFNlcnZpY2VBLCB1c2VDbGFzczogU2VydmljZUEgfSBdLFxuICAgICAgICAgICAgICAgIGV4cG9ydHM6IFsgU2VydmljZUEgXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoTW9kdWxlQiwge1xuICAgICAgICAgICAgICAgIGltcG9ydHM6IFsgTW9kdWxlQSBdLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyczogWyB7IHByb3ZpZGU6IFNlcnZpY2VCLCB1c2VDbGFzczogU2VydmljZUIgfSBdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLm1vZHVsZShNb2R1bGVCKTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2VCID0gY29udGFpbmVyLnJlc29sdmU8U2VydmljZUI+KFNlcnZpY2VCKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZUIpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VCKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZUIuc2VydmljZUEpLnRvQmVJbnN0YW5jZU9mKFNlcnZpY2VBKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2ltcG9ydHMgYSBtb2R1bGUgd2l0aCBubyBleHBvcnRzIHdpdGhvdXQgZXJyb3JzJywgKCkgPT4ge1xuICAgICAgICAgICAgY2xhc3MgTW9kdWxlV2l0aE5vRXhwb3J0cyB7IH1cblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShNb2R1bGVXaXRoTm9FeHBvcnRzLCB7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXJzOiBbIHsgcHJvdmlkZTogJ3NlcnZpY2UnLCB1c2VWYWx1ZTogJ3Rlc3QnIH0gXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBjb250YWluZXIubW9kdWxlKE1vZHVsZVdpdGhOb0V4cG9ydHMpKS5ub3QudG9UaHJvdygpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgncmVzb2x2ZXMgb3ZlcmxhcHBpbmcgZXhwb3J0cyBmcm9tIG11bHRpcGxlIG1vZHVsZXMgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgICAgICAgY2xhc3MgTW9kdWxlQSB7IH1cbiAgICAgICAgICAgIGNsYXNzIE1vZHVsZUIgeyB9XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBTZXJ2aWNlQSB7XG4gICAgICAgICAgICAgICAgZ2V0TWVzc2FnZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdmcm9tIEEnO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgQGNvbnRhaW5lci5JbmplY3RhYmxlKClcbiAgICAgICAgICAgIGNsYXNzIFNlcnZpY2VCIHtcbiAgICAgICAgICAgICAgICBnZXRNZXNzYWdlKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ2Zyb20gQic7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKE1vZHVsZUEsIHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgeyBwcm92aWRlOiAnc2hhcmVkJywgdXNlQ2xhc3M6IFNlcnZpY2VBIH0gXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbICdzaGFyZWQnIF1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKE1vZHVsZUIsIHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgeyBwcm92aWRlOiAnc2hhcmVkJywgdXNlQ2xhc3M6IFNlcnZpY2VCLCBwcmlvcml0eTogMSB9IF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnc2hhcmVkJyBdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29udGFpbmVyLm1vZHVsZShNb2R1bGVBKTtcbiAgICAgICAgICAgIGNvbnRhaW5lci5tb2R1bGUoTW9kdWxlQik7XG5cbiAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gY29udGFpbmVyLnJlc29sdmU8YW55Pignc2hhcmVkJyk7XG4gICAgICAgICAgICBleHBlY3QoaW5zdGFuY2UuZ2V0TWVzc2FnZSgpKS50b0JlKCdmcm9tIEInKTsgLy8gQXNzdW1lcyBNb2R1bGVCIHdhcyByZWdpc3RlcmVkIGFmdGVyIE1vZHVsZUFcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ2NvcnJlY3RseSByZXNvbHZlcyBwcm92aWRlcnMgZnJvbSBuZXN0ZWQgbW9kdWxlIGV4cG9ydHMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjbGFzcyBHcmFuZGNoaWxkTW9kdWxlIHsgfVxuICAgICAgICAgICAgY2xhc3MgQ2hpbGRNb2R1bGUgeyB9XG4gICAgICAgICAgICBjbGFzcyBQYXJlbnRNb2R1bGUgeyB9XG5cbiAgICAgICAgICAgIEBjb250YWluZXIuSW5qZWN0YWJsZSgpXG4gICAgICAgICAgICBjbGFzcyBHcmFuZGNoaWxkU2VydmljZSB7XG4gICAgICAgICAgICAgICAgZ2V0VmFsdWUoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnZ3JhbmRjaGlsZCc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZWdpc3Rlck1vZHVsZU1ldGFkYXRhKEdyYW5kY2hpbGRNb2R1bGUsIHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcnM6IFsgeyBwcm92aWRlOiAnZ3JhbmRjaGlsZCcsIHVzZUNsYXNzOiBHcmFuZGNoaWxkU2VydmljZSB9IF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnZ3JhbmRjaGlsZCcgXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJlZ2lzdGVyTW9kdWxlTWV0YWRhdGEoQ2hpbGRNb2R1bGUsIHtcbiAgICAgICAgICAgICAgICBpbXBvcnRzOiBbIEdyYW5kY2hpbGRNb2R1bGUgXSxcbiAgICAgICAgICAgICAgICBleHBvcnRzOiBbICdncmFuZGNoaWxkJyBdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmVnaXN0ZXJNb2R1bGVNZXRhZGF0YShQYXJlbnRNb2R1bGUsIHtcbiAgICAgICAgICAgICAgICBpbXBvcnRzOiBbIENoaWxkTW9kdWxlIF0sXG4gICAgICAgICAgICAgICAgZXhwb3J0czogWyAnZ3JhbmRjaGlsZCcgXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnRhaW5lci5tb2R1bGUoUGFyZW50TW9kdWxlKTtcblxuICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBjb250YWluZXIucmVzb2x2ZTxHcmFuZGNoaWxkU2VydmljZT4oJ2dyYW5kY2hpbGQnKTtcbiAgICAgICAgICAgIGV4cGVjdChpbnN0YW5jZSkudG9CZUluc3RhbmNlT2YoR3JhbmRjaGlsZFNlcnZpY2UpO1xuICAgICAgICAgICAgZXhwZWN0KGluc3RhbmNlLmdldFZhbHVlKCkpLnRvQmUoJ2dyYW5kY2hpbGQnKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cblxufSk7XG4iXX0=