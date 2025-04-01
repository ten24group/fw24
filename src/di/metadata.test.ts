import { Middleware, MiddlewareAsync, ProviderOptions } from '../interfaces/di';
import { DIContainer } from './container';
import {
  getModuleMetadata,
  registerPropertyDependency,
  registerConstructorDependency,
  getPropertyDependenciesMetadata,
  getConstructorDependenciesMetadata,
} from './metadata';

describe('Utility Functions - Complex Scenarios', () => {
  beforeEach(() => {
    DIContainer.DIMetadataStore.clearMetadata();
  });

  describe('registerConstructorDependency', () => {
    it('should handle multiple dependencies for the same parameter', () => {
      class TestClass {}
      const depToken1 = 'Dep1';
      const depToken2 = 'Dep2';

      registerConstructorDependency(TestClass, 0, depToken1);
      registerConstructorDependency(TestClass, 0, depToken2);

      const dependencies = getConstructorDependenciesMetadata(TestClass);

      expect(dependencies.length).toBe(1);
      expect(dependencies[0].token.toString()).toBe('fw24.di.token:Dep2');
    });

    it('should merge options for the same dependency', () => {
      class TestClass {}
      const depToken = 'Dep';

      registerConstructorDependency(TestClass, 0, depToken, { isOptional: true });
      registerConstructorDependency(TestClass, 1, depToken, { defaultValue: 'default' });

      const dependencies = getConstructorDependenciesMetadata(TestClass);

      expect(dependencies[0].isOptional).toBe(true);
      expect(dependencies[1].defaultValue).toBe('default');
    });
  });

  describe('registerPropertyDependency', () => {
    it('should handle dependencies for multiple properties', () => {
      class TestClass {}
      const depToken1 = 'Dep1';
      const depToken2 = 'Dep2';

      registerPropertyDependency(TestClass, 'property1', depToken1);
      registerPropertyDependency(TestClass, 'property2', depToken2);

      const dependencies = getPropertyDependenciesMetadata(TestClass);

      expect(dependencies.length).toBe(2);
      expect(dependencies[0].propertyKey).toBe('property1');
      expect(dependencies[1].propertyKey).toBe('property2');
    });

    it('should handle symbol property keys', () => {
      class TestClass {}
      const symbolKey = Symbol('propertyKey');
      const depToken = 'Dep';

      registerPropertyDependency(TestClass, symbolKey, depToken);

      const dependencies = getPropertyDependenciesMetadata(TestClass);

      expect(dependencies[0].propertyKey).toBe(symbolKey);
    });
  });

  describe('getModuleMetadata', () => {
    it('should return undefined for targets without metadata', () => {
      class NoMetadataClass {}

      const result = getModuleMetadata(NoMetadataClass);

      expect(result).toBeUndefined();
    });
  });
});
