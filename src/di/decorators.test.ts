import { describe, expect, it } from '@jest/globals';
import { DIContainer, createToken, Injectable, Inject, OnInit } from './';
import { PROPERTY_INJECT_KEY, CONSTRUCTOR_INJECT_KEY, ON_INIT_METHOD_KEY } from './const';

describe('DI Decorators', () => {
    
    // Clear metadata before each test
    beforeEach(() => {
        DIContainer.INSTANCE.clear();
    });

    it('should register a class with @Injectable', () => {
        @Injectable({ singleton: true })
        class TestService {}

        const token = createToken<TestService>('TestService');
        DIContainer.INSTANCE.register({ useClass: TestService, singleton: true, name: token.toString() });
        const provider = (DIContainer.INSTANCE as any).providers.get(token.toString());
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(TestService);
    });

    it('should inject a dependency with @Inject', async () => {
        @Injectable()
        class DependencyService {}

        @Injectable()
        class TestService {
            constructor(
                @Inject(DependencyService) private dependencyService: DependencyService
            ) {}
        }

        const testServiceInstance = DIContainer.INSTANCE.resolve(TestService);
        
        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect((testServiceInstance as any).dependencyService).toBeInstanceOf(DependencyService);
    });

    it('should conditionally register a provider with @Injectable', () => {
        const condition = jest.fn(() => true);

        @Injectable({ singleton: true, condition })
        class ConditionalService {}

        const token = createToken<ConditionalService>('ConditionalService');
        DIContainer.INSTANCE.register({ useClass: ConditionalService, singleton: true, name: token.toString() });

        const provider = (DIContainer.INSTANCE as any).providers.get(token.toString());
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(ConditionalService);
    });

    it('should call method on initialization with @OnInit', async () => {
        const onInitSpy = jest.fn();

        @Injectable()
        class TestService {
            @OnInit()
            onInit11() {
                onInitSpy();
            }
        }

        const testServiceInstance = DIContainer.INSTANCE.resolve(TestService.name);

        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect(onInitSpy).toHaveBeenCalled();
    });

    it('should add metadata for constructor parameter injection', () => {
        const metadataMock = jest.spyOn(DIContainer.INSTANCE, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            constructor(@Inject(token) private dep: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken') }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should add metadata for property injection', () => {
        const metadataMock = jest.spyOn(DIContainer.INSTANCE, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @Inject(token)
            private dep: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep' }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });

    it('should handle optional constructor parameter injection', () => {
        const metadataMock = jest.spyOn(DIContainer.INSTANCE, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            constructor(@Inject(token, { isOptional: true }) private dep?: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken'), isOptional: true }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should handle optional property injection', () => {
        const metadataMock = jest.spyOn(DIContainer.INSTANCE, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @Inject(token, { isOptional: true })
            private dep?: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep', isOptional: true }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });
});


describe('DI Instance Decorators', () => {
    const container = DIContainer.INSTANCE.createChildContainer();
    
    // Clear metadata before each test
    beforeEach(() => {
        container.clear();
    });

    it('should register a class with @container.Injectable', () => {
        @container.Injectable({ singleton: true })
        class TestService {}

        const token = createToken<TestService>('TestService');
        container.register({ useClass: TestService, singleton: true, name: token.toString() });
        const provider = (container as any).providers.get(token.toString());

        expect(provider).toBeDefined();

        expect(provider.useClass).toBe(TestService);
    });

    it('should inject a dependency with @Inject', async () => {
        @container.Injectable()
        class DependencyService {}

        @container.Injectable()
        class TestService {
            constructor(
                @container.Inject(DependencyService) private dependencyService: DependencyService
            ) {}
        }

        const testServiceInstance = container.resolve(TestService);
        
        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect((testServiceInstance as any).dependencyService).toBeInstanceOf(DependencyService);
    });

    it('should conditionally register a provider with @Injectable', () => {
        const condition = jest.fn(() => true);

        @container.Injectable({ singleton: true, condition })
        class ConditionalService {}

        const token = createToken<ConditionalService>('ConditionalService');
        container.register({ useClass: ConditionalService, singleton: true, name: token.toString() });

        const provider = (container as any).providers.get(token.toString());
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(ConditionalService);
    });

    it('should call method on initialization with @OnInit', async () => {
        const onInitSpy = jest.fn();

        @container.Injectable()
        class TestService {
            @container.OnInit()
            onInit11() {
                onInitSpy();
            }
        }

        const testServiceInstance = container.resolve(TestService.name);

        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect(onInitSpy).toHaveBeenCalled();
    });

    it('should add metadata for constructor parameter injection', () => {
        const metadataMock = jest.spyOn(container, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            constructor(@container.Inject(token) private dep: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken') }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should add metadata for property injection', () => {
        const metadataMock = jest.spyOn(container, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @container.Inject(token)
            private dep: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep' }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });

    it('should handle optional constructor parameter injection', () => {
        const metadataMock = jest.spyOn(container, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            constructor(@container.Inject(token, { isOptional: true }) private dep?: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken'), isOptional: true }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should handle optional property injection', () => {
        const metadataMock = jest.spyOn(container, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @container.Inject(token, { isOptional: true })
            private dep?: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep', isOptional: true }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });
});