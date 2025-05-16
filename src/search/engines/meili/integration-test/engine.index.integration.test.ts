import { MeiliSearchEngine } from '../engine';
import { config, indexConfig, pollForSetting } from './testUtils';

const TEST_INDEX = indexConfig.indexName + '-indexing';

describe('MeiliSearchEngine Index Management Integration Tests', () => {
  let engine: MeiliSearchEngine;

  beforeAll(async () => {
    engine = new MeiliSearchEngine(config);
    // Clean up and create index
    try {
      const exists = await engine.indexExists(TEST_INDEX as string);
      if (exists) await engine.deleteIndex(TEST_INDEX as string, true);
    } catch { }

    await engine.initIndex({ ...indexConfig, indexName: TEST_INDEX as string }, true);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, 60000);

  afterAll(async () => {
    try {
      await engine.deleteIndex(TEST_INDEX as string);
    } catch { }
  }, 60000);

  it('should check if an index exists', async () => {
    const exists = await engine.indexExists(TEST_INDEX as string);
    expect(exists).toBe(true);
    const nonExistentIndex = await engine.indexExists('non-existent-index');
    expect(nonExistentIndex).toBe(false);
  }, 60000);

  it('should get index information', async () => {
    const indexInfo = await engine.getIndexInfo(TEST_INDEX as string);
    expect(indexInfo).toBeDefined();
    expect(indexInfo.uid).toBe(TEST_INDEX);
    expect(indexInfo.primaryKey).toBe('id');
  }, 60000);

  it('should get index settings', async () => {
    const settings = await engine.getIndexSettings(TEST_INDEX as string);
    await pollForSetting(engine, TEST_INDEX!, 'searchableAttributes', [ 'title', 'content', 'tags' ]);
    expect(settings).toBeDefined();
    expect(settings.searchableAttributes).toEqual([ 'title', 'content', 'tags' ]);
    expect(settings.filterableAttributes).toEqual([ 'category', 'tags', 'price', 'status' ]);
  }, 60000);

  it('should list all indices', async () => {
    const indices = await engine.listIndices();
    expect(indices).toBeDefined();
    expect(indices.results.some(index => index.uid === TEST_INDEX)).toBe(true);
  }, 60000);

  it('should get index stats', async () => {
    const stats = await engine.getIndexStats(TEST_INDEX as string);
    expect(stats).toBeDefined();
    expect(stats.numberOfDocuments).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('should create and configure a new index with settings', async () => {
    const tempIndex = `test-custom-settings-${Math.random().toString(36).substring(2, 10)}`;

    const settingsIndexConfig = {
      indexName: tempIndex,
      primaryKey: 'id',
      settings: {
        searchableAttributes: [ 'title' ],
        filterableAttributes: [ 'category' ],
        sortableAttributes: [ 'createdAt' ],
      },
      meiliSearchIndexSettings: {
        rankingRules: [ 'words', 'typo', 'proximity', 'attribute', 'sort', 'exactness' ],
      }
    };
    try {
      const index = await engine.initIndex(settingsIndexConfig, true);
      await new Promise(resolve => setTimeout(resolve, 1000));

      await pollForSetting(engine, tempIndex, 'searchableAttributes', [ 'title' ]);

      expect(index).toBeDefined();
      const settings = await engine.getIndexSettings(tempIndex);

      expect(settings.searchableAttributes).toEqual([ 'title' ]);
      expect(settings.filterableAttributes).toEqual([ 'category' ]);
      expect(settings.sortableAttributes).toEqual([ 'createdAt' ]);
    } finally {
      try {
        await engine.deleteIndex(tempIndex, true);
      } catch { }
    }
  }, 60000);

  it('should reset index settings to default', async () => {
    const tempIndex = `test-reset-settings-${Math.random().toString(36).substring(2, 10)}`;
    const tempConfig = { ...indexConfig, indexName: tempIndex };
    try {
      await engine.initIndex(tempConfig, true);
      await new Promise(resolve => setTimeout(resolve, 1000));

      await engine.updateSearchableAttributes(tempIndex, [ 'title' ], true);
      await pollForSetting(engine, tempIndex, 'searchableAttributes', [ 'title' ]);

      await engine.resetIndexSettings(tempIndex, true);
      await pollForSetting(engine, tempIndex, 'searchableAttributes', [ '*' ]);

      const settings = await engine.getIndexSettings(tempIndex);
      // After reset, settings should be default (searchableAttributes is null or default)
      expect(settings.searchableAttributes).toContain('*');
    } finally {
      await engine.deleteIndex(tempIndex, true);
    }
  }, 60000);

  it('should update displayed attributes', async () => {
    const tempIndex = `test-displayed-attrs-${Math.random().toString(36).substring(2, 10)}`;
    const tempConfig = { ...indexConfig, indexName: tempIndex };
    try {
      await engine.initIndex(tempConfig, true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await engine.updateDisplayedAttributes(tempIndex, [ 'id', 'title' ], true);
      await pollForSetting(engine, tempIndex, 'displayedAttributes', [ 'id', 'title' ]);

      const settings = await engine.getIndexSettings(tempIndex);
      expect(settings.displayedAttributes).toEqual([ 'id', 'title' ]);
    } finally {
      await engine.deleteIndex(tempIndex, true);
    }
  }, 60000);

  it('should update stop words', async () => {
    const tempIndex = `test-stopwords-${Math.random().toString(36).substring(2, 10)}`;
    const tempConfig = { ...indexConfig, indexName: tempIndex };
    try {
      await engine.initIndex(tempConfig, true);

      await engine.updateStopWords(tempIndex, [ 'the', 'a' ], true);

      await new Promise(resolve => setTimeout(resolve, 1000));

      const settings = await engine.getIndexSettings(tempIndex);

      expect(settings.stopWords).toContain('the');
      expect(settings.stopWords).toContain('a');
    } finally {
      await engine.deleteIndex(tempIndex, true);
    }
  }, 60000);

  it('should update ranking rules', async () => {
    const tempIndex = `test-rankingrules-${Math.random().toString(36).substring(2, 10)}`;
    const tempConfig = { ...indexConfig, indexName: tempIndex };
    try {
      await engine.initIndex(tempConfig, true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const rules = [ 'words', 'typo', 'proximity', 'attribute', 'sort', 'exactness' ];
      await engine.updateRankingRules(tempIndex, rules, true);
      await pollForSetting(engine, tempIndex, 'rankingRules', rules);

      const settings = await engine.getIndexSettings(tempIndex);
      expect(settings.rankingRules).toEqual(rules);
    } finally {
      await engine.deleteIndex(tempIndex, true);
    }
  }, 60000);

  it('should swap two indexes', async () => {
    const indexA = `test-swap-a-${Math.random().toString(36).substring(2, 10)}`;
    const indexB = `test-swap-b-${Math.random().toString(36).substring(2, 10)}`;
    const configA = { ...indexConfig, indexName: indexA };
    const configB = { ...indexConfig, indexName: indexB };
    try {
      await engine.initIndex(configA, true);
      await engine.initIndex(configB, true);

      await engine.swapIndexes([ { indexes: [ indexA, indexB ] } ], true);

      await new Promise(resolve => setTimeout(resolve, 1000));

      // After swap, both indexes should still exist
      const existsA = await engine.indexExists(indexA);
      const existsB = await engine.indexExists(indexB);

      expect(existsA).toBe(true);
      expect(existsB).toBe(true);
    } finally {
      await engine.deleteIndex(indexA, true);
      await engine.deleteIndex(indexB, true);
    }
  }, 60000);
}); 