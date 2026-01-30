import { merge } from './index';

describe('merge utility', () => {
  describe('basic object merging', () => {
    it('should merge two simple objects', () => {
      const result = merge([ { a: 1 }, { b: 2 } ]);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should override properties from left to right', () => {
      const result = merge([ { a: 1 }, { a: 2 } ]);
      expect(result).toEqual({ a: 2 });
    });

    it('should merge three objects', () => {
      const result = merge([ { a: 1 }, { b: 2 }, { c: 3 } ]);
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('should handle empty objects', () => {
      const result = merge([ {}, { a: 1 }, {} ]);
      expect(result).toEqual({ a: 1 });
    });
  });

  describe('nested object merging', () => {
    it('should deep merge nested objects', () => {
      const result = merge([
        { a: { b: 1, c: 2 } },
        { a: { c: 3, d: 4 } }
      ]);
      expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } });
    });

    it('should merge deeply nested objects', () => {
      const result = merge([
        { a: { b: { c: 1, d: 2 } } },
        { a: { b: { d: 3, e: 4 } } }
      ]);
      expect(result).toEqual({ a: { b: { c: 1, d: 3, e: 4 } } });
    });

    it('should handle mixed nested structures', () => {
      const result = merge([
        { a: 1, b: { c: 2 } },
        { a: 2, b: { d: 3 }, e: 4 }
      ]);
      expect(result).toEqual({ a: 2, b: { c: 2, d: 3 }, e: 4 });
    });
  });

  describe('null and undefined handling', () => {
    it('should filter out null values', () => {
      const result = merge([ { a: 1 }, null, { b: 2 } ]);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should filter out undefined values', () => {
      const result = merge([ { a: 1 }, undefined, { b: 2 } ]);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should return last value if all are null/undefined', () => {
      const result = merge([ null, undefined, null ]);
      expect(result).toBeNull();
    });

    it('should handle null in first position', () => {
      const result = merge([ null, { a: 1 } ]);
      expect(result).toEqual({ a: 1 });
    });
  });

  describe('array merging', () => {
    it('should merge arrays by index', () => {
      const result = merge([ [ 1, 2 ], [ 3, 4 ] ]);
      expect(result).toEqual([ 3, 4 ]);
    });

    it('should merge arrays of different lengths', () => {
      const result = merge([ [ 1, 2, 3 ], [ 4, 5 ] ]);
      expect(result).toEqual([ 4, 5, 3 ]);
    });

    it('should deep merge nested arrays', () => {
      const result = merge([
        [ { a: 1 }, { b: 2 } ],
        [ { a: 2 }, { c: 3 } ]
      ]);
      expect(result).toEqual([ { a: 2 }, { b: 2, c: 3 } ]);
    });
  });

  describe('CDK-like props merging (complex scenarios)', () => {
    it('should merge NodejsFunctionProps-like objects', () => {
      const defaultProps = {
        runtime: 'nodejs22',
        timeout: 5,
        memorySize: 128,
        bundling: {
          sourceMap: false,
          externalModules: [ 'aws-sdk' ]
        }
      };

      const customProps = {
        timeout: 10,
        bundling: {
          sourceMap: true,
          externalModules: [ '@ten24group/fw24' ]
        }
      };

      const result = merge([ defaultProps, customProps ]);

      expect(result).toEqual({
        runtime: 'nodejs22',
        timeout: 10,
        memorySize: 128,
        bundling: {
          sourceMap: true,
          externalModules: [ '@ten24group/fw24' ]
        }
      });
    });

    it('should merge three layers of props (default, config, override)', () => {
      const defaultProps = {
        timeout: 5,
        memorySize: 128,
        environment: { LOG_LEVEL: 'info' }
      };

      const configProps = {
        timeout: 10,
        environment: { API_KEY: 'test' }
      };

      const overrideProps = {
        memorySize: 256,
        environment: { LOG_LEVEL: 'debug' }
      };

      const result = merge([ defaultProps, configProps, overrideProps ]);

      expect(result).toEqual({
        timeout: 10,
        memorySize: 256,
        environment: { LOG_LEVEL: 'debug', API_KEY: 'test' }
      });
    });

    it('should handle QueueProps-like merging', () => {
      const queueProps = {
        queueName: 'myQueue',
        visibilityTimeout: 30,
        deadLetterQueue: {
          queue: 'dlq',
          maxReceiveCount: 3
        }
      };

      const customProps = {
        visibilityTimeout: 60,
        deadLetterQueue: {
          maxReceiveCount: 5
        }
      };

      const result = merge([ queueProps, customProps ]);

      expect(result).toEqual({
        queueName: 'myQueue',
        visibilityTimeout: 60,
        deadLetterQueue: {
          queue: 'dlq',
          maxReceiveCount: 5
        }
      });
    });

    it('should merge bundling.externalModules arrays properly', () => {
      const defaultBundling = {
        bundling: {
          sourceMap: true,
          externalModules: [ 'aws-sdk', 'pg' ]
        }
      };

      const customBundling = {
        bundling: {
          externalModules: [ '@ten24group/fw24' ]
        }
      };

      const result = merge([ defaultBundling, customBundling ]);

      // Arrays merge by index, so index 0 gets '@ten24group/fw24', index 1 keeps 'pg'
      expect(result).toEqual({
        bundling: {
          sourceMap: true,
          externalModules: [ '@ten24group/fw24', 'pg' ]
        }
      });
    });

    it('should handle complex SQS event source props merging', () => {
      const defaults = {
        batchSize: 10,
        maxBatchingWindow: 5,
        reportBatchItemFailures: true
      };

      const decoratorProps = {
        batchSize: 20,
        maxBatchingWindow: 10
      };

      const configProps = {
        batchSize: 5
      };

      const result = merge([ defaults, decoratorProps, configProps ]);

      expect(result).toEqual({
        batchSize: 5,
        maxBatchingWindow: 10,
        reportBatchItemFailures: true
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty array', () => {
      const result = merge([]);
      expect(result).toBeNull();
    });

    it('should handle single object', () => {
      const result = merge([ { a: 1 } ]);
      expect(result).toEqual({ a: 1 });
    });

    it('should handle primitive values', () => {
      const result = merge([ { a: 1 }, { a: 'string' } ]);
      expect(result).toEqual({ a: 'string' });
    });

    it('should handle boolean values', () => {
      const result = merge([ { flag: false }, { flag: true } ]);
      expect(result).toEqual({ flag: true });
    });

    it('should handle number zero', () => {
      const result = merge([ { count: 5 }, { count: 0 } ]);
      expect(result).toEqual({ count: 0 });
    });

    it('should handle empty string', () => {
      const result = merge([ { name: 'test' }, { name: '' } ]);
      expect(result).toEqual({ name: '' });
    });
  });

  describe('circular references', () => {
    it('should handle circular references without throwing', () => {
      const obj1: any = { a: 1 };
      obj1.self = obj1;

      const obj2 = { b: 2 };

      // The merge function should handle circular references without throwing
      expect(() => {
        const result = merge([ obj1, obj2 ]) as any;
        expect(result.a).toBe(1);
        expect(result.self).toBe(obj1.self);
      }).not.toThrow();
    });

    it('should handle nested circular references without throwing', () => {
      const obj1: any = { a: { b: 1 } };
      obj1.a.circular = obj1;

      const obj2: any = { a: { c: 2 } };

      // The merge function should handle nested circular references without throwing
      expect(() => {
        const result = merge([ obj1, obj2 ]) as any;
        expect(result.a.b).toBe(1);
        expect(result.a.c).toBe(2);
      }).not.toThrow();
    });
  });

  describe('real-world Lambda function props merging', () => {
    it('should correctly merge LambdaFunction props as used in framework', () => {
      // Simulate real scenario from lambda-function.ts
      const defaultProps = {
        runtime: 'nodejs22',
        architecture: 'arm64',
        handler: 'handler',
        timeout: 5,
        memorySize: 128,
        bundling: {
          minify: true,
          externalModules: [ 'aws-sdk' ]
        }
      };

      const userFunctionProps = {
        timeout: 30,
        memorySize: 512,
        bundling: {
          sourceMap: true
        }
      };

      const additionalProps = {
        entry: './dist/handler.js',
        bundling: {
          externalModules: [ '@ten24group/fw24', 'axios' ]
        },
        logGroup: 'test-log-group'
      };

      const result = merge([ defaultProps, userFunctionProps, additionalProps ]);

      expect(result).toMatchObject({
        runtime: 'nodejs22',
        architecture: 'arm64',
        handler: 'handler',
        timeout: 30,
        memorySize: 512,
        entry: './dist/handler.js',
        logGroup: 'test-log-group'
      });

      // Bundling should be deeply merged
      expect((result as any).bundling.minify).toBe(true);
      expect((result as any).bundling.sourceMap).toBe(true);
      expect((result as any).bundling.externalModules).toEqual([ '@ten24group/fw24', 'axios' ]);
    });
  });
});

