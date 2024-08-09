import { MetadataManager } from './metadata';

describe('MetadataManager', () => {
  let metadataManager: MetadataManager;

  beforeEach(() => {
    metadataManager = new MetadataManager();
  });

  it('should use the default namespace if none is provided', () => {
    expect(metadataManager['namespace']).toBe('fw24:metadata:default');
  });

  it('should use the provided namespace', () => {
    const customNamespaceManager = new MetadataManager({ namespace: 'customNamespace' });
    expect(customNamespaceManager['namespace']).toBe('customNamespace');
  });

  describe('setClassMetadata and getClassMetadata', () => {
    it('should set and get metadata for a class', () => {
      class TestClass {}
      metadataManager.setClassMetadata(TestClass, { test: 'data' });
      expect(metadataManager.getClassMetadata(TestClass)).toEqual({ test: 'data' });
    });

    it('should throw an error if metadata already exists and override is not set', () => {
      class TestClass {}
      metadataManager.setClassMetadata(TestClass, { test: 'data' });
      expect(() => metadataManager.setClassMetadata(TestClass, { newTest: 'data' })).toThrowError('Metadata for key "classMetadata" already exists and override flag is not set.');
    });
  });

  describe('setPropertyMetadata and getPropertyMetadata', () => {
    it('should set and get metadata for a class property', () => {
      const obj = { prop: 'value' };
      metadataManager.setPropertyMetadata(obj, 'prop', 'metadataValue');
      expect(metadataManager.getPropertyMetadata(obj, 'prop')).toBe('metadataValue');
    });

    it('should throw an error if property metadata already exists and override is not set', () => {
      const obj = { prop: 'value' };
      metadataManager.setPropertyMetadata(obj, 'prop', 'metadataValue');
      expect(() => metadataManager.setPropertyMetadata(obj, 'prop', 'newMetadataValue')).toThrowError('Metadata for key "propertyMetadata_prop" already exists and override flag is not set.');
    });
  });

  describe('setMethodMetadata and getMethodMetadata', () => {
    it('should set and get metadata for a class method', () => {
      const obj = { method: () => {} };
      metadataManager.setMethodMetadata(obj, 'method', 'metadataValue');
      expect(metadataManager.getMethodMetadata(obj, 'method')).toBe('metadataValue');
    });

    it('should throw an error if method metadata already exists and override is not set', () => {
      const obj = { method: () => {} };
      metadataManager.setMethodMetadata(obj, 'method', 'metadataValue');
      expect(() => metadataManager.setMethodMetadata(obj, 'method', 'newMetadataValue')).toThrowError('Metadata for key "methodMetadata_method" already exists and override flag is not set.');
    });
  });

  describe('setParameterMetadata and getParameterMetadata', () => {
    it('should set and get metadata for a constructor parameter', () => {
      class TestClass {
        constructor() {}
      }
      metadataManager.setParameterMetadata(TestClass.prototype, undefined, 0, 'metadataValue');
      expect(metadataManager.getParameterMetadata(TestClass.prototype, undefined)).toEqual(['metadataValue']);
    });

    it('should throw an error if parameter metadata already exists and override is not set', () => {
      class TestClass {
        constructor() {}
      }
      metadataManager.setParameterMetadata(TestClass, undefined, 0, 'metadataValue');
      expect(() => metadataManager.setParameterMetadata(TestClass, undefined, 0, 'newMetadataValue')).toThrowError('Metadata for parameter at index "0" already exists and override flag is not set.');
    });
  });

  describe('remove metadata methods', () => {
    it('should remove class metadata', () => {
      class TestClass {}
      metadataManager.setClassMetadata(TestClass, { test: 'data' });
      metadataManager.removeClassMetadata(TestClass);
      expect(metadataManager.getClassMetadata(TestClass)).toBeUndefined();
    });

    it('should remove property metadata', () => {
      const obj = { prop: 'value' };
      metadataManager.setPropertyMetadata(obj, 'prop', 'metadataValue');
      metadataManager.removePropertyMetadata(obj, 'prop');
      expect(metadataManager.getPropertyMetadata(obj, 'prop')).toBeUndefined();
    });

    it('should remove method metadata', () => {
      const obj = { method: () => {} };
      metadataManager.setMethodMetadata(obj, 'method', 'metadataValue');
      metadataManager.removeMethodMetadata(obj, 'method');
      expect(metadataManager.getMethodMetadata(obj, 'method')).toBeUndefined();
    });

    it('should remove parameter metadata', () => {
      class TestClass {
        constructor() {}
      }
      metadataManager.setParameterMetadata(TestClass, undefined, 0, 'metadataValue');
      metadataManager.removeParameterMetadata(TestClass, undefined);
      expect(metadataManager.getParameterMetadata(TestClass, undefined)).toEqual([]);
    });
  });

  describe('listMetadataKeys', () => {
    it('should list all metadata keys for a target', () => {
      const obj = { key1: 'value1', key2: 'value2' };
      const keys = metadataManager.listMetadataKeys(obj);
      expect(keys).toEqual(['key1', 'key2']);
    });
  });

  describe('mergeMetadata', () => {
    it('should merge metadata from multiple sources', () => {
      const obj = { prop: 'value' };
      metadataManager.mergeMetadata(obj, 'prop', { key1: 'value1' }, { key2: 'value2' });
      expect(metadataManager.getPropertyMetadata(obj, 'prop')).toEqual({ key1: 'value1', key2: 'value2' });
    });
  });

  describe('cloneMetadata', () => {
    it('should clone metadata from one target to another', () => {
      const source = { prop: 'value' };
      const target = { prop: 'newValue' };
      metadataManager.setPropertyMetadata(source, 'prop', 'metadataValue');
      metadataManager.cloneMetadata(source, target);
      expect(metadataManager.getPropertyMetadata(target, 'prop')).toBe('metadataValue');
    });
  });

  describe('setPropertiesMetadata and getPropertiesMetadata', () => {
    it('should set and get metadata for multiple properties', () => {
      const obj = { prop1: 'value1', prop2: 'value2' };
      metadataManager.setPropertiesMetadata(obj, { prop1: 'metadata1', prop2: 'metadata2' });
      expect(metadataManager.getPropertiesMetadata(obj, ['prop1', 'prop2'])).toEqual({ prop1: 'metadata1', prop2: 'metadata2' });
    });
  });

  describe('removePropertiesMetadata', () => {
    it('should remove metadata for multiple properties', () => {
      const obj = { prop1: 'value1', prop2: 'value2' };
      metadataManager.setPropertiesMetadata(obj, { prop1: 'metadata1', prop2: 'metadata2' });
      metadataManager.removePropertiesMetadata(obj, ['prop1', 'prop2']);
      expect(metadataManager.getPropertiesMetadata(obj, ['prop1', 'prop2'])).toEqual({ prop1: undefined, prop2: undefined });
    });
  });
});
