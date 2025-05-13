import { MeiliSearchEngine } from '../engine';
import { config, indexConfig, pollForSetting } from './testUtils';

const TEST_INDEX = indexConfig.indexName;
const TEST_SETTINGS_INDEX = 'test-settings-index';

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
  });

  it('should get index information', async () => {
    const indexInfo = await engine.getIndexInfo(TEST_INDEX as string);
    expect(indexInfo).toBeDefined();
    expect(indexInfo.uid).toBe(TEST_INDEX);
    expect(indexInfo.primaryKey).toBe('id');
  });

  it('should get index settings', async () => {
    const settings = await engine.getIndexSettings(TEST_INDEX as string);
    expect(settings).toBeDefined();
    expect(settings.searchableAttributes).toEqual([ 'title', 'content', 'tags' ]);
    expect(settings.filterableAttributes).toEqual([ 'category', 'tags', 'price', 'status' ]);
  });

  it('should list all indices', async () => {
    const indices = await engine.listIndices();
    expect(indices).toBeDefined();
    expect(indices.results.some(index => index.uid === TEST_INDEX)).toBe(true);
  });

  it('should get index stats', async () => {
    const stats = await engine.getIndexStats(TEST_INDEX as string);
    expect(stats).toBeDefined();
    expect(stats.numberOfDocuments).toBeGreaterThanOrEqual(0);
  });

  it('should create and configure a new index with settings', async () => {
    const settingsIndexConfig = {
      indexName: TEST_SETTINGS_INDEX,
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
      await pollForSetting(engine, TEST_SETTINGS_INDEX, 'searchableAttributes', [ 'title' ]);
      expect(index).toBeDefined();
      const settings = await engine.getIndexSettings(TEST_SETTINGS_INDEX);
      expect(settings.searchableAttributes).toEqual([ 'title' ]);
      expect(settings.filterableAttributes).toEqual([ 'category' ]);
      expect(settings.sortableAttributes).toEqual([ 'createdAt' ]);
    } finally {
      try {
        await engine.deleteIndex(TEST_SETTINGS_INDEX, true);
      } catch { }
    }
  }, 60000);
}); 