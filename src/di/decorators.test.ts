import { describe, expect, it } from '@jest/globals';
import { DIContainer, createToken, Injectable, Inject, OnInit } from './';
import { PROPERTY_INJECT_METADATA_KEY, CONSTRUCTOR_INJECT_METADATA_KEY, ON_INIT_HOOK_METADATA_KEY } from './const';
const container = DIContainer.ROOT;
describe('DI Decorators', () => {
    
    // Clear metadata before each test
    beforeEach(() => {
        container.clear();
    });

    it('should register a class with @Injectable', () => {
        @Injectable({ singleton: true }, container)
        class TestService {}

        const token = createToken<TestService>(TestService);
        debugger;
        const provider = (container as any).providers.get(token);
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(TestService);
    });

    it('should inject a dependency with @Inject', async () => {
        @Injectable({}, container)
        class DependencyService {}

        @Injectable({}, container)
        class TestService {
            constructor(
                @Inject(DependencyService, {}, container) private dependencyService: DependencyService
            ) {}
        }

        const testServiceInstance = container.resolve(TestService);
        
        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect((testServiceInstance as any).dependencyService).toBeInstanceOf(DependencyService);
    });

    it('should conditionally register a provider with @Injectable', () => {
        const condition = jest.fn(() => true);

        @Injectable({ singleton: true, condition }, container)
        class ConditionalService {}

        const token = createToken<ConditionalService>('ConditionalService');
        container.register({ useClass: ConditionalService, singleton: true, name: token.toString() });

        const provider = (container as any).providers.get(token);
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(ConditionalService);
    });

    it('should call method on initialization with @OnInit', async () => {
        const onInitSpy = jest.fn();

        @Injectable({}, container)
        class TestService {
            @OnInit(container)
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
            constructor(@Inject(token, {}, container) private dep: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken') }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should add metadata for property injection', () => {
        const metadataMock = jest.spyOn(container, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @Inject(token, {}, container)
            private dep: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep' }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });

    it('should handle optional constructor parameter injection', () => {
        const metadataMock = jest.spyOn(container, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            constructor(@Inject(token, { isOptional: true }, container) private dep?: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken'), isOptional: true }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should handle optional property injection', () => {
        const metadataMock = jest.spyOn(container, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @Inject(token, { isOptional: true }, container)
            private dep?: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep', isOptional: true }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });
});


describe('DI Instance Decorators', () => {
    const childContainer = container.createChildContainer();
    
    // Clear metadata before each test
    beforeEach(() => {
        childContainer.clear();
    });

    it('should register a class with @childContainer.Injectable', () => {
        @childContainer.Injectable({ singleton: true })
        class TestService {}

        const token = createToken<TestService>('TestService');
        childContainer.register({ useClass: TestService, singleton: true, name: token.toString() });
        const provider = (childContainer as any).providers.get(token);

        expect(provider).toBeDefined();

        expect(provider.useClass).toBe(TestService);
    });

    it('should inject a dependency with @Inject', async () => {
        @childContainer.Injectable()
        class DependencyService {}

        @childContainer.Injectable()
        class TestService {
            constructor(
                @childContainer.Inject(DependencyService) private dependencyService: DependencyService
            ) {}
        }

        const testServiceInstance = childContainer.resolve(TestService);
        
        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect((testServiceInstance as any).dependencyService).toBeInstanceOf(DependencyService);
    });

    it('should conditionally register a provider with @Injectable', () => {
        const condition = jest.fn(() => true);

        @childContainer.Injectable({ singleton: true, condition })
        class ConditionalService {}

        const token = createToken<ConditionalService>('ConditionalService');
        childContainer.register({ useClass: ConditionalService, singleton: true, name: token.toString() });

        const provider = (childContainer as any).providers.get(token);
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(ConditionalService);
    });

    it('should call method on initialization with @OnInit', async () => {
        const onInitSpy = jest.fn();

        @childContainer.Injectable()
        class TestService {
            @childContainer.OnInit()
            onInit11() {
                onInitSpy();
            }
        }

        const testServiceInstance = childContainer.resolve(TestService.name);

        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect(onInitSpy).toHaveBeenCalled();
    });

    it('should add metadata for constructor parameter injection', () => {
        const metadataMock = jest.spyOn(childContainer, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            constructor(@childContainer.Inject(token) private dep: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken') }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should add metadata for property injection', () => {
        const metadataMock = jest.spyOn(childContainer, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @childContainer.Inject(token)
            private dep: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep' }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });

    it('should handle optional constructor parameter injection', () => {
        const metadataMock = jest.spyOn(childContainer, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            constructor(@childContainer.Inject(token, { isOptional: true }) private dep?: any) {}
        }

        const expectedMetadata = {
            0: { token: Symbol.for('fw24.di.token:testToken'), isOptional: true }
        };

        expect(metadataMock).toHaveBeenCalledWith({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass
        });
    });

    it('should handle optional property injection', () => {
        const metadataMock = jest.spyOn(childContainer, 'defineMetadata');
        const token = createToken('testToken');

        class TestClass {
            @childContainer.Inject(token, { isOptional: true })
            private dep?: any;
        }

        const expectedMetadata = [
            { token: Symbol.for('fw24.di.token:testToken'), propertyKey: 'dep', isOptional: true }
        ];

        expect(metadataMock).toHaveBeenCalledWith({
            key: PROPERTY_INJECT_METADATA_KEY,
            value: expectedMetadata,
            target: TestClass.prototype
        });
    });
});