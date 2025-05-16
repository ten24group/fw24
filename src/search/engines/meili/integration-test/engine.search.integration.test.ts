import { MeiliSearchEngine } from '../engine';
import { config, indexConfig, TEST_DOCS, pollForDocument } from './testUtils';

const TEST_INDEX = indexConfig.indexName + '-search';

describe('MeiliSearchEngine Search Operations Integration Tests', () => {
  let engine: MeiliSearchEngine;

  beforeAll(async () => {
    engine = new MeiliSearchEngine(config);
    try {
      const exists = await engine.indexExists(TEST_INDEX as string);
      if (exists) await engine.deleteIndex(TEST_INDEX as string, true);
    } catch { }
    await engine.initIndex({ ...indexConfig, indexName: TEST_INDEX as string }, true);
    await engine.indexDocuments(TEST_DOCS, { ...indexConfig, indexName: TEST_INDEX as string }, true);
    await pollForDocument(engine, { ...indexConfig, indexName: TEST_INDEX as string }, TEST_DOCS[ 0 ].id);
  }, 60000);

  afterAll(async () => {
    try {
      await engine.deleteIndex(TEST_INDEX as string);
    } catch { }
  }, 60000);

  it('should perform a basic search', async () => {
    const result = await engine.search<any>({ search: 'document' }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result).toBeDefined();
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.hits.some(hit => hit.id === '1')).toBe(true);
  });

  it('should perform a search with filters', async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = await engine.search<any>({
      search: 'document',
      filters: { category: { eq: 'tutorial' } }
    }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result).toBeDefined();
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every(hit => hit.category === 'tutorial')).toBe(true);
  });

  it('should perform a search with complex filters', async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = await engine.search<any>({
      search: 'document',
      filters: {
        and: [
          { price: { gte: 20 } },
          { status: { eq: 'active' } }
        ]
      }
    }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result).toBeDefined();
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every(hit => hit.price >= 20 && hit.status === 'active')).toBe(true);
  });

  it('should search with OR filters', async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = await engine.search<any>({
      search: 'document',
      filters: {
        or: [
          { category: { eq: 'tutorial' } },
          { category: { eq: 'guide' } }
        ]
      }
    }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result).toBeDefined();
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every(hit => [ 'tutorial', 'guide' ].includes(hit.category))).toBe(true);
  });

  it('should search with NOT filters', async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = await engine.search<any>({
      search: 'document',
      filters: {
        not: { category: { eq: 'test' } }
      }
    } as any, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result).toBeDefined();
    expect(result.hits.every(hit => hit.category !== 'test')).toBe(true);
  });

  it('should search with a specific term', async () => {
    const result = await engine.search<any>({ search: 'xylophone' }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result).toBeDefined();
    expect(result.hits.length).toBe(1);
    expect(result.hits[ 0 ].id).toBe('4');
  });

  it('should search with pagination', async () => {
    const result1 = await engine.search<any>({ search: 'document', pagination: { page: 1, limit: 2 } }, { ...indexConfig, indexName: TEST_INDEX as string });
    const result2 = await engine.search<any>({ search: 'document', pagination: { page: 2, limit: 2 } }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result1.hits.length).toBe(2);
    expect(result2.hits.length).toBeGreaterThan(0);
    expect(result1.hits[ 0 ].id).not.toBe(result2.hits[ 0 ].id);
  });

  it('should search with sorting', async () => {
    // Use a unique index for this test
    const uniqueIndex = `test-integration-index-sorting-${Math.random().toString(36).substring(2, 10)}`;
    const sortingIndexConfig = { ...indexConfig, indexName: uniqueIndex };
    try {
      await engine.initIndex(sortingIndexConfig, true);
      await engine.indexDocuments(TEST_DOCS, sortingIndexConfig, true);
      await pollForDocument(engine, sortingIndexConfig, TEST_DOCS[ 0 ].id);
      const ascResult = await engine.search<any>({ search: 'document', sort: [ { field: 'price', dir: 'asc' } ] }, sortingIndexConfig);
      const descResult = await engine.search<any>({ search: 'document', sort: [ { field: 'price', dir: 'desc' } ] }, sortingIndexConfig);
      expect(ascResult.hits.length).toBeGreaterThan(1);
      expect(descResult.hits.length).toBeGreaterThan(1);
      for (let i = 0; i < ascResult.hits.length - 1; i++) {
        expect(ascResult.hits[ i ].price <= ascResult.hits[ i + 1 ].price).toBe(true);
      }
      for (let i = 0; i < descResult.hits.length - 1; i++) {
        expect(descResult.hits[ i ].price >= descResult.hits[ i + 1 ].price).toBe(true);
      }
      expect(ascResult.hits[ 0 ].id).not.toBe(descResult.hits[ 0 ].id);
    } finally {
      await engine.deleteIndex(uniqueIndex, true);
    }
  });

  it('should search with field selection', async () => {
    const result = await engine.search<any>({ search: 'document', select: [ 'id', 'title' ] }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(Object.keys(result.hits[ 0 ]).sort()).toEqual([ 'id', 'title' ].sort());
  });

  it('should search with faceting', async () => {
    const facetConfig: any = {
      ...indexConfig,
      indexName: TEST_INDEX as string,
      faceting: {
        facets: {
          category: { attribute: 'category', type: 'value' },
          status: { attribute: 'status', type: 'value' }
        }
      }
    };
    const result = await engine.search<any>({ search: 'document', facets: [ 'category', 'status' ] }, facetConfig);
    expect(result.facets).toBeDefined();
    expect(result.facets?.category).toBeDefined();
    expect(result.facets?.status).toBeDefined();
    expect(Object.keys(result.facets?.category || {}).length).toBeGreaterThan(0);
  });

  it('should perform a multi-search query', async () => {
    const queries = [
      { indexUid: TEST_INDEX as string, query: 'document', searchParams: { limit: 2 } },
      { indexUid: TEST_INDEX as string, query: 'special', searchParams: { filter: 'category = tutorial' } }
    ];
    const result = await engine.multiSearch<any>(queries);
    expect(result).toBeDefined();
    expect(result.results.length).toBe(2);
    expect(result.results[ 0 ].hits.length).toBeLessThanOrEqual(2);
    expect(result.results[ 1 ].hits.length).toBeGreaterThan(0);
    expect(result.results[ 1 ].hits.every((hit: any) => hit.category === 'tutorial')).toBe(true);
  }, 60000);
}); 