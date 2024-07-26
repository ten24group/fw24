import { describe, expect, it } from '@jest/globals';
import { diContainer, createToken, Injectable, Inject, Conditional, OnInit } from './';

describe('DI Decorators', () => {
    
    // Clear metadata before each test
    beforeEach(() => {
        diContainer.clear();
    });

    it('should register a class with @Injectable', () => {
        @Injectable({ singleton: true })
        class TestService {}

        const token = createToken<TestService>('TestService', 'MyApp');
        diContainer.register(token, { useClass: TestService, singleton: true });

        const provider = (diContainer as any).providers.get(token.toString());
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(TestService);
    });

    it('should inject a dependency with @Inject', async () => {
        @Injectable()
        class DependencyService {}

        const DependencyServiceToken = createToken<DependencyService>('DependencyService');

        @Injectable()
        class TestService {
            constructor(@Inject(DependencyServiceToken) private dependencyService: DependencyService) {}
        }

        const TestServiceToken = createToken<TestService>('TestService');
        diContainer.register(DependencyServiceToken, { useClass: DependencyService });
        diContainer.register(TestServiceToken, { useClass: TestService });

        const testServiceInstance = await diContainer.resolve(TestServiceToken);
        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect((testServiceInstance as any).dependencyService).toBeInstanceOf(DependencyService);
    });

    it('should conditionally register a provider with @Conditional', () => {
        const condition = jest.fn(() => true);

        @Conditional(condition)
        @Injectable({ singleton: true })
        class ConditionalService {}

        const token = createToken<ConditionalService>('ConditionalService');
        diContainer.register(token, { useClass: ConditionalService, singleton: true });

        const provider = (diContainer as any).providers.get(token.toString());
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(ConditionalService);
    })

    it('should call method on initialization with @OnInit', async () => {
        const onInitSpy = jest.fn();

        @Injectable()
        class TestService {
            @OnInit()
            async onInit11() {
                onInitSpy();
            }
        }

        const testServiceInstance = await diContainer.resolve(TestService.name);

        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect(onInitSpy).toHaveBeenCalled();
    });
});
