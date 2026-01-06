import {
  mergeObservabilityConfigs,
  normalizeIncludes,
  selectFields,
  selectFieldsFromBody,
  ControllerObservabilityConfig,
} from './controller-config';

describe('controller-config', () => {
  describe('mergeObservabilityConfigs', () => {
    it('returns undefined when both configs are undefined', () => {
      expect(mergeObservabilityConfigs(undefined, undefined)).toBeUndefined();
    });

    it('returns method config when controller config is undefined', () => {
      const methodConfig: ControllerObservabilityConfig = { enabled: true };
      expect(mergeObservabilityConfigs(undefined, methodConfig)).toEqual(methodConfig);
    });

    it('returns controller config when method config is undefined', () => {
      const controllerConfig: ControllerObservabilityConfig = { enabled: true };
      expect(mergeObservabilityConfigs(controllerConfig, undefined)).toEqual(controllerConfig);
    });

    it('method enabled=false overrides controller enabled=true', () => {
      const controllerConfig: ControllerObservabilityConfig = { enabled: true };
      const methodConfig: ControllerObservabilityConfig = { enabled: false };
      const merged = mergeObservabilityConfigs(controllerConfig, methodConfig);
      expect(merged?.enabled).toBe(false);
    });

    it('method includes takes precedence', () => {
      const controllerConfig: ControllerObservabilityConfig = {
        includes: { request: true },
      };
      const methodConfig: ControllerObservabilityConfig = {
        includes: { request: { body: true } },
      };
      const merged = mergeObservabilityConfigs(controllerConfig, methodConfig);
      expect(merged?.includes?.request).toEqual({ body: true });
    });

    it('merges data protection configs', () => {
      const controllerConfig: ControllerObservabilityConfig = {
        dataProtection: { enabled: true },
      };
      const methodConfig: ControllerObservabilityConfig = {
        dataProtection: { blacklistedKeys: ['password'] },
      };
      const merged = mergeObservabilityConfigs(controllerConfig, methodConfig);
      expect(merged?.dataProtection?.enabled).toBe(true);
      expect(merged?.dataProtection?.blacklistedKeys).toEqual(['password']);
    });
  });

  describe('normalizeIncludes', () => {
    it('returns all false when includes is undefined', () => {
      const result = normalizeIncludes(undefined);
      expect(result.request).toEqual({ headers: false, body: false, query: false });
      expect(result.response).toEqual({ headers: false, body: false });
    });

    it('handles request: true', () => {
      const result = normalizeIncludes({ request: true });
      expect(result.request).toEqual({ headers: true, body: true, query: true });
    });

    it('handles request: false', () => {
      const result = normalizeIncludes({ request: false });
      expect(result.request).toEqual({ headers: false, body: false, query: false });
    });

    it('handles request as array', () => {
      const result = normalizeIncludes({ request: ['headers', 'body'] });
      expect(result.request).toEqual({ headers: true, body: true, query: false });
    });

    it('handles request as object with specific fields', () => {
      const result = normalizeIncludes({
        request: { headers: ['content-type'], body: true, query: false },
      });
      expect(result.request).toEqual({
        headers: ['content-type'],
        body: true,
        query: false,
      });
    });

    it('handles response: true', () => {
      const result = normalizeIncludes({ response: true });
      expect(result.response).toEqual({ headers: true, body: true });
    });

    it('handles response as array', () => {
      const result = normalizeIncludes({ response: ['body'] });
      expect(result.response).toEqual({ headers: false, body: true });
    });
  });

  describe('selectFields', () => {
    it('returns undefined for undefined object', () => {
      expect(selectFields(undefined, true)).toBeUndefined();
    });

    it('returns undefined when fields is false', () => {
      expect(selectFields({ a: 1 }, false)).toBeUndefined();
    });

    it('returns full object when fields is true', () => {
      const obj = { a: 1, b: 2 };
      expect(selectFields(obj, true)).toEqual(obj);
    });

    it('selects specific fields', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(selectFields(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });

    it('ignores non-existent fields', () => {
      const obj = { a: 1 };
      expect(selectFields(obj, ['a', 'x'])).toEqual({ a: 1 });
    });

    it('returns undefined when no fields match', () => {
      const obj = { a: 1 };
      expect(selectFields(obj, ['x', 'y'])).toBeUndefined();
    });
  });

  describe('selectFieldsFromBody', () => {
    it('returns undefined for undefined body', () => {
      expect(selectFieldsFromBody(undefined, true)).toBeUndefined();
    });

    it('returns undefined when fields is false', () => {
      expect(selectFieldsFromBody('{"a":1}', false)).toBeUndefined();
    });

    it('parses and returns full JSON when fields is true', () => {
      expect(selectFieldsFromBody('{"a":1,"b":2}', true)).toEqual({ a: 1, b: 2 });
    });

    it('returns raw string for non-JSON when fields is true', () => {
      expect(selectFieldsFromBody('not json', true)).toBe('not json');
    });

    it('selects specific fields from JSON', () => {
      expect(selectFieldsFromBody('{"a":1,"b":2,"c":3}', ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });

    it('returns undefined for non-JSON when selecting fields', () => {
      expect(selectFieldsFromBody('not json', ['a'])).toBeUndefined();
    });
  });
});

