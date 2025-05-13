import { MeiliSearchEngine } from '../engine';
import { config, indexConfig, TEST_DOCS, pollForDocument, pollForSetting } from './testUtils';

const TEST_INDEX = indexConfig.indexName;
const TEST_SYNONYMS_INDEX = 'test-synonyms-index';
const TEST_SETTINGS_INDEX = 'test-settings-updates';

describe('MeiliSearchEngine Advanced Features Integration Tests', () => {
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

  it('should highlight search results', async () => {
    const result = await engine.search<any>({
      search: 'special',
      highlight: {
        fields: [ 'title', 'content' ],
        preTag: '<em>',
        postTag: '</em>'
      }
    }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result.hits.length).toBeGreaterThan(0);
    const hit = result.hits.find(h => h.id === '4');
    expect(hit?._formatted).toBeDefined();
    expect(hit?._formatted?.content).toContain('<em>special</em>');
  });

  it('should crop search results', async () => {
    const uniqueIndex = `test-integration-index-crop-${Math.random().toString(36).substring(2, 10)}`;
    const cropIndexConfig = { ...indexConfig, indexName: uniqueIndex };
    try {
      await engine.initIndex(cropIndexConfig, true);
      await engine.indexDocuments(TEST_DOCS, cropIndexConfig, true);
      await pollForDocument(engine, cropIndexConfig, TEST_DOCS[ 0 ].id);
      const result = await engine.search<any>({
        search: 'brown fox',
        crop: {
          fields: [ 'content' ],
          length: 10,
          marker: '...'
        }
      }, cropIndexConfig);
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[ 0 ]._formatted?.content?.length).toBeLessThanOrEqual(result.hits[ 0 ].content.length);
      expect(result.hits[ 0 ]._formatted?.content).toContain('...');
    } finally {
      await engine.deleteIndex(uniqueIndex, true);
    }
  });

  it('should handle "exists" filter operation', async () => {
    const docWithMissingField = { id: '100', title: 'Document with missing field' };
    await engine.indexDocuments([ docWithMissingField ], { ...indexConfig, indexName: TEST_INDEX as string }, true);
    await pollForDocument(engine, { ...indexConfig, indexName: TEST_INDEX as string }, '100');
    const result = await engine.search<any>({
      filters: {
        category: { exists: true }
      }
    }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some(hit => hit.id === '100')).toBe(false);
  }, 60000);

  it('should search with array values using "in" operator', async () => {
    const result = await engine.search<any>({
      filters: {
        tags: { in: [ 'special', 'guide' ] }
      }
    }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every(hit => {
      return hit.tags.some((tag: string) => [ 'special', 'guide' ].includes(tag));
    })).toBe(true);
  });

  it('should search with between range filters', async () => {
    const result = await engine.search<any>({
      filters: {
        price: { between: [ 15, 35 ] }
      }
    }, { ...indexConfig, indexName: TEST_INDEX as string });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every(hit => hit.price >= 15 && hit.price <= 35)).toBe(true);
  }, 60000);

  it('should create and use index with synonyms', async () => {
    try {
      const synonymsConfig = {
        indexName: TEST_SYNONYMS_INDEX,
        primaryKey: 'id',
        settings: {
          searchableAttributes: [ 'title', 'content' ],
        },
        meiliSearchIndexSettings: {
          synonyms: {
            'smartphone': [ 'phone', 'mobile', 'cellphone' ],
            'automobile': [ 'car', 'vehicle' ],
            'phone': [ 'smartphone' ],
            'mobile': [ 'smartphone' ],
            'cellphone': [ 'smartphone' ],
            'car': [ 'automobile' ],
            'vehicle': [ 'automobile' ]
          }
        }
      };
      await engine.initIndex(synonymsConfig, true);
      await engine.indexDocuments([
        { id: 's1', title: 'Smartphone review', content: 'This is about a smartphone' },
        { id: 's2', title: 'Car review', content: 'This is about an automobile' }
      ], synonymsConfig, true);
      await pollForDocument(engine, synonymsConfig, 's1');
      const phoneResult = await engine.search<any>({ search: 'phone' }, synonymsConfig);
      expect(phoneResult.hits.length).toBe(1);
      expect(phoneResult.hits[ 0 ].id).toBe('s1');
      const carResult = await engine.search<any>({ search: 'car' }, synonymsConfig);
      expect(carResult.hits.length).toBe(1);
      expect(carResult.hits[ 0 ].id).toBe('s2');
    } finally {
      try {
        await engine.deleteIndex(TEST_SYNONYMS_INDEX, true);
      } catch { }
    }
  }, 60000);

  it('should update and use various index settings', async () => {
    const settingsConfig = {
      indexName: TEST_SETTINGS_INDEX,
      settings: {
        searchableAttributes: [ 'title', 'content' ],
        filterableAttributes: [ 'category' ]
      }
    };
    try {
      await engine.initIndex(settingsConfig, true);
      await engine.updateSearchableAttributes(TEST_SETTINGS_INDEX, [ 'title', 'content', 'tags' ], true);
      await engine.updateFilterableAttributes(TEST_SETTINGS_INDEX, [ 'category', 'status' ], true);
      await engine.updateSortableAttributes(TEST_SETTINGS_INDEX, [ 'createdAt', 'price' ], true);
      await pollForSetting(engine, TEST_SETTINGS_INDEX, 'sortableAttributes', [ 'createdAt', 'price' ]);
      const settings = await engine.getIndexSettings(TEST_SETTINGS_INDEX);
      expect(settings.searchableAttributes).toContain('tags');
      expect(settings.filterableAttributes).toContain('status');
      expect(settings.sortableAttributes).toContain('price');
    } finally {
      try {
        await engine.deleteIndex(TEST_SETTINGS_INDEX, true);
      } catch { }
    }
  }, 60000);

  it('should get server health and stats', async () => {
    const health = await engine.isHealthy();
    expect(health).toBe(true);
    const stats = await engine.getStats();
    expect(stats).toBeDefined();
    expect(stats.databaseSize).toBeDefined();
    const version = await engine.getVersion();
    expect(version).toBeDefined();
    expect(version.pkgVersion).toBeDefined();
  }, 30000);

  it('should get and manage tasks', async () => {
    const task = await engine.indexDocuments([ { id: 'task-test', title: 'Task Test' } ], { ...indexConfig, indexName: TEST_INDEX as string }, false);
    expect(task).toBeDefined();
    expect(task.taskUid).toBeDefined();
    const taskInfo = await engine.getTask(task.taskUid);
    expect(taskInfo).toBeDefined();
    expect(taskInfo.uid).toBe(task.taskUid);
    const tasks = await engine.getTasks();
    expect(tasks).toBeDefined();
    expect(tasks.results.length).toBeGreaterThan(0);
    const filteredTasks = await engine.getTasks({
      indexUids: [ TEST_INDEX as string ],
      limit: 5
    });
    expect(filteredTasks).toBeDefined();
    expect(filteredTasks.results.length).toBeGreaterThan(0);
    expect(filteredTasks.results.every(t => t.indexUid === TEST_INDEX)).toBe(true);
    await engine.deleteDocuments([ 'task-test' ], TEST_INDEX as string, true);
  }, 60000);
}); 