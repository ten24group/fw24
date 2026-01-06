/**
 * Entity Compression Tests
 * 
 * Tests for automatic compression/decompression in BaseEntityService
 */

import { randomUUID } from 'crypto';
import { createEntitySchema, DefaultEntityOperations } from '../base-entity';
import { BaseEntityService } from '../base-service';
import { DIContainer } from '../../di';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { isCompressed, decompress } from '../../utils/compression';

// Test schema with compressed fields
const TestEntitySchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'testEntity',
    entityNamePlural: 'Test Entities',
    service: 'test',
    entityOperations: DefaultEntityOperations,
  },
  attributes: {
    testId: {
      type: 'string',
      required: true,
      default: () => randomUUID(),
    },
    name: {
      type: 'string',
      required: true,
    },
    // Large field with default compression (10KB threshold)
    largeData: {
      type: 'any',
      compressed: true,
    },
    // Large field with custom threshold (50KB)
    hugeData: {
      type: 'any',
      compressed: { threshold: 50 * 1024 },
    },
    // Regular field - no compression
    regularData: {
      type: 'any',
    },
    createdAt: {
      type: 'string',
      readOnly: true,
      required: true,
      default: () => new Date().toISOString(),
      set: () => new Date().toISOString(),
    },
    updatedAt: {
      type: 'string',
      watch: '*',
      required: true,
      readOnly: true,
      default: () => new Date().toISOString(),
      set: () => new Date().toISOString(),
    },
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: [ 'testId' ],
      },
      sk: {
        field: 'sk',
        composite: [],
      },
    },
  },
} as const);

type TestEntitySchemaType = typeof TestEntitySchema;

class TestEntityService extends BaseEntityService<TestEntitySchemaType> {
  constructor() {
    const client = new DynamoDBClient({
      region: 'us-east-1',
      endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
    });
    const docClient = DynamoDBDocumentClient.from(client);

    super(
      TestEntitySchema,
      {
        table: process.env.TEST_TABLE || 'test-table',
        client: docClient,
      },
      DIContainer.ROOT
    );
  }
}

describe('Entity Compression', () => {
  let service: TestEntityService;

  beforeEach(() => {
    service = new TestEntityService();
  });

  describe('compressFields', () => {
    it('should compress large data exceeding default threshold (10KB)', () => {
      const largeObject = { data: 'x'.repeat(15 * 1024) }; // 15KB

      const result = (service as any).compressFields({
        testId: '123',
        name: 'Test',
        largeData: largeObject,
        regularData: { small: 'data' },
      });

      expect(isCompressed(result.largeData)).toBe(true);
      expect(result.largeData._algorithm).toBe('gzip');
      expect(result.largeData._originalSize).toBeGreaterThan(10 * 1024);
      expect(result.regularData).toEqual({ small: 'data' });
    });

    it('should NOT compress small data below threshold', () => {
      const smallObject = { data: 'small' }; // < 10KB

      const result = (service as any).compressFields({
        testId: '123',
        name: 'Test',
        largeData: smallObject,
      });

      expect(isCompressed(result.largeData)).toBe(false);
      expect(result.largeData).toEqual(smallObject);
    });

    it('should respect custom threshold (50KB)', () => {
      const mediumObject = { data: 'x'.repeat(30 * 1024) }; // 30KB

      const result = (service as any).compressFields({
        testId: '123',
        name: 'Test',
        hugeData: mediumObject, // 50KB threshold - should NOT compress
      });

      // 30KB is below 50KB threshold
      expect(isCompressed(result.hugeData)).toBe(false);

      const hugeObject = { data: 'x'.repeat(60 * 1024) }; // 60KB
      const result2 = (service as any).compressFields({
        testId: '123',
        name: 'Test',
        hugeData: hugeObject, // 50KB threshold - SHOULD compress
      });

      expect(isCompressed(result2.hugeData)).toBe(true);
    });

    it('should not compress fields without compressed metadata', () => {
      const largeObject = { data: 'x'.repeat(15 * 1024) }; // 15KB

      const result = (service as any).compressFields({
        testId: '123',
        name: 'Test',
        regularData: largeObject, // No compression metadata
      });

      expect(isCompressed(result.regularData)).toBe(false);
      expect(result.regularData).toEqual(largeObject);
    });

    it('should handle missing fields gracefully', () => {
      const result = (service as any).compressFields({
        testId: '123',
        name: 'Test',
        // largeData missing
      });

      expect(result.largeData).toBeUndefined();
      expect(result.testId).toBe('123');
    });
  });

  describe('decompressFields', () => {
    it('should decompress compressed data', () => {
      const originalData = { nested: { value: 'x'.repeat(15 * 1024) } };

      // First compress
      const compressed = (service as any).compressFields({
        testId: '123',
        largeData: originalData,
      });

      expect(isCompressed(compressed.largeData)).toBe(true);

      // Then decompress
      const decompressed = (service as any).decompressFields(compressed);

      expect(isCompressed(decompressed.largeData)).toBe(false);
      expect(decompressed.largeData).toEqual(originalData);
    });

    it('should handle non-compressed data', () => {
      const data = {
        testId: '123',
        regularData: { value: 'test' },
      };

      const result = (service as any).decompressFields(data);

      expect(result).toEqual(data);
    });

    it('should decompress multiple fields', () => {
      const largeData1 = { data: 'x'.repeat(15 * 1024) };
      const largeData2 = { data: 'y'.repeat(60 * 1024) };

      const compressed = (service as any).compressFields({
        testId: '123',
        largeData: largeData1,
        hugeData: largeData2,
      });

      const decompressed = (service as any).decompressFields(compressed);

      expect(decompressed.largeData).toEqual(largeData1);
      expect(decompressed.hugeData).toEqual(largeData2);
    });
  });

  describe('Round-trip compression', () => {
    it('should preserve data through compress -> decompress cycle', () => {
      const testData = {
        testId: '123',
        name: 'Test Entity',
        largeData: {
          array: Array(1000).fill({ key: 'value', count: 42 }),
          nested: { deep: { data: 'x'.repeat(5000) } },
        },
        hugeData: {
          bigArray: Array(5000).fill('data'),
        },
        regularData: { small: 'field' },
      };

      const compressed = (service as any).compressFields(testData);
      const decompressed = (service as any).decompressFields(compressed);

      expect(decompressed).toEqual(testData);
    });

    it('should handle complex nested structures', () => {
      const complexData = {
        testId: '456',
        name: 'Complex Test',
        largeData: {
          users: Array(100).fill(null).map((_, i) => ({
            id: i,
            name: `User ${i}`,
            metadata: { created: new Date().toISOString(), tags: [ 'tag1', 'tag2' ] },
          })),
          config: {
            deeply: { nested: { object: { with: { many: { levels: 'x'.repeat(2000) } } } } },
          },
        },
      };

      const compressed = (service as any).compressFields(complexData);
      expect(isCompressed(compressed.largeData)).toBe(true);

      const decompressed = (service as any).decompressFields(compressed);
      expect(decompressed).toEqual(complexData);
    });
  });

  describe('Compression efficiency', () => {
    it('should achieve compression ratio > 50% for repetitive data', () => {
      const repetitiveData = {
        testId: '789',
        name: 'Efficiency Test',
        largeData: {
          repeated: 'This is a repeated string. '.repeat(1000),
          array: Array(500).fill({ same: 'structure', every: 'time' }),
        },
      };

      const compressed = (service as any).compressFields(repetitiveData);

      expect(isCompressed(compressed.largeData)).toBe(true);

      const originalSize = compressed.largeData._originalSize;
      const compressedSize = compressed.largeData._compressedSize;
      const ratio = compressedSize / originalSize;

      expect(ratio).toBeLessThan(0.5); // More than 50% compression
    });

    it('should include size metadata in compressed payload', () => {
      const data = { data: 'x'.repeat(15 * 1024) };

      const compressed = (service as any).compressFields({
        testId: '999',
        largeData: data,
      });

      expect(compressed.largeData._compressed).toBe(true);
      expect(compressed.largeData._algorithm).toBe('gzip');
      expect(typeof compressed.largeData._data).toBe('string'); // base64
      expect(typeof compressed.largeData._originalSize).toBe('number');
      expect(typeof compressed.largeData._compressedSize).toBe('number');
      expect(compressed.largeData._originalSize).toBeGreaterThan(compressed.largeData._compressedSize);
    });
  });
});
