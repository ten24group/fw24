/**
 * Tests for Feature 7: DynamoDB Query Pattern Tags
 *
 * Validates that QueryObserver classifies operations into the correct
 * query_type tag values.
 */

import { QueryObserver } from './query';

// Access private static method via prototype for testing
const classifyQueryType = (QueryObserver as any).classifyQueryType.bind(QueryObserver);

describe('Feature 7: DynamoDB Query Pattern Tags', () => {
  describe('classifyQueryType', () => {
    test('get operation → point-read', () => {
      expect(classifyQueryType('get')).toBe('point-read');
    });

    test('batchGet operation → batch-read', () => {
      expect(classifyQueryType('batchGet')).toBe('batch-read');
    });

    test('scan operation → full-scan', () => {
      expect(classifyQueryType('scan')).toBe('full-scan');
    });

    test('query operation → range-query', () => {
      expect(classifyQueryType('query')).toBe('range-query');
    });

    test('list operation → range-query', () => {
      expect(classifyQueryType('list')).toBe('range-query');
    });

    test('create operation → write', () => {
      expect(classifyQueryType('create')).toBe('write');
    });

    test('upsert operation → write', () => {
      expect(classifyQueryType('upsert')).toBe('write');
    });

    test('update operation → write', () => {
      expect(classifyQueryType('update')).toBe('write');
    });

    test('delete operation → write', () => {
      expect(classifyQueryType('delete')).toBe('write');
    });

    test('batchDelete operation → write', () => {
      expect(classifyQueryType('batchDelete')).toBe('write');
    });

    test('unknown operation → other', () => {
      expect(classifyQueryType('unknownOp')).toBe('other');
    });
  });
});
