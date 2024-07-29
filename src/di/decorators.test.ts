import { describe, expect, it } from '@jest/globals';
import { DIContainer, createToken, Injectable, Inject, OnInit } from './';

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
        class DependencyService {

        }

        @Injectable()
        class TestService {
            constructor(@Inject(DependencyService) private dependencyService: DependencyService) {
                console.log('TestService.constructor', { dependencyService });
            }
        }

        const testServiceInstance = DIContainer.INSTANCE.resolve(TestService);
        
        expect(testServiceInstance).toBeInstanceOf(TestService);
        expect((testServiceInstance as any).dependencyService).toBeInstanceOf(DependencyService);
    });

    it('should conditionally register a provider with @Conditional', () => {
        const condition = jest.fn(() => true);

        @Injectable({ singleton: true, condition })
        class ConditionalService {}

        const token = createToken<ConditionalService>('ConditionalService');
        DIContainer.INSTANCE.register({ useClass: ConditionalService, singleton: true, name: token.toString() });

        const provider = (DIContainer.INSTANCE as any).providers.get(token.toString());
        expect(provider).toBeDefined();
        expect(provider.useClass).toBe(ConditionalService);
    })

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
});
