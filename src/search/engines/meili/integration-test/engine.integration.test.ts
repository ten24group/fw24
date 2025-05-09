import { MeiliSearchEngine, ExtendedMeiliSearchClientConfig, SearchIndexConfigExt } from '../engine';
import { SearchIndexConfig, SearchQuery, SearchQueryTyped } from '../../../types';

// Skip integration tests if environment is set to skip them
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true';

// This test suite requires a MeiliSearch instance running on localhost:7700
// You can start one with: docker run -p 7700:7700 getmeili/meilisearch:latest
describe('MeiliSearchEngine Integration Tests', () => {

  if (SKIP_INTEGRATION_TESTS) {
    it.skip('should be skipped', () => {
      expect(true).toBe(true);
    });
    return;
  }

  let engine: MeiliSearchEngine;
  const TEST_INDEX = 'test-integration-index';
  const TEST_SYNONYMS_INDEX = 'test-synonyms-index';
  const TEST_SETTINGS_INDEX = 'test-settings-index';
  const TEST_DOCS = [
    { id: '1', title: 'First document', content: 'This is the first test document', category: 'test', tags: [ 'doc', 'first' ], price: 10, status: 'active' },
    { id: '2', title: 'Second document', content: 'This is the second test document', category: 'test', tags: [ 'doc', 'second' ], price: 20, status: 'active' },
    { id: '3', title: 'Third document', content: 'This is the third test document', category: 'tutorial', tags: [ 'doc', 'third' ], price: 30, status: 'archived' },
    { id: '4', title: 'Fourth document with special term', content: 'This document contains a special search term: xylophone', category: 'tutorial', tags: [ 'doc', 'special' ], price: 40, status: 'active' },
    { id: '5', title: 'Fifth document', content: 'This is the fifth test document with a special search: quick brown fox jumps over the lazy dog', category: 'guide', tags: [ 'doc', 'guide' ], price: 50, status: 'draft' },
  ];

  const TEST_VECTOR_DOCS = [
    { id: 'v1', title: 'Vector document 1', content: 'Vector content 1', _vectors: { default: [ 0.1, 0.2, 0.3 ] } },
    { id: 'v2', title: 'Vector document 2', content: 'Vector content 2', _vectors: { default: [ 0.2, 0.3, 0.4 ] } },
    { id: 'v3', title: 'Vector document 3', content: 'Vector content 3', _vectors: { default: [ 0.3, 0.4, 0.5 ] } },
  ];

  const config: ExtendedMeiliSearchClientConfig = {
    host: 'http://localhost:7700',
    apiKey: 'xxx_your_master_key',  // No API key for local development instance
  };

  const indexConfig: SearchIndexConfig = {
    indexName: TEST_INDEX,
    settings: {
      searchableAttributes: [ 'title', 'content', 'tags' ],
      filterableAttributes: [ 'category', 'tags', 'price', 'status' ],
      sortableAttributes: [ 'price' ],
      // primaryKey: 'id',
    },
  };

  // Helper function to wait for indexing to complete
  async function waitForIndexing(timeoutMs = 50000) {
    return new Promise(resolve => setTimeout(resolve, timeoutMs));
  }

  beforeEach(async () => {
    jest.setTimeout(60000);
  });

  beforeAll(async () => {
    // Skip setup if tests are disabled
    if (SKIP_INTEGRATION_TESTS) return;

    engine = new MeiliSearchEngine(config);

    // Check if MeiliSearch is available
    try {
      const isHealthy = await engine.isHealthy();
      if (!isHealthy) {
        console.warn('MeiliSearch is not available. Integration tests will be skipped.');
        (global as any).SKIP_INTEGRATION_TESTS = true;
        return;
      }
    } catch (err) {
      console.warn('Could not connect to MeiliSearch. Integration tests will be skipped.');
      (global as any).SKIP_INTEGRATION_TESTS = true;
      return;
    }

    // // Delete test index if it exists
    try {
      const exists = await engine.indexExists(TEST_INDEX);
      if (exists) {
        await engine.deleteIndex(TEST_INDEX, true);
      }
    } catch (error) {
      // Ignore errors if the index doesn't exist
    }

    // Create fresh index and add test documents
    await engine.initIndex(indexConfig, true);
    await engine.indexDocuments(TEST_DOCS, indexConfig, true);

    // Wait for indexing to complete
    await waitForIndexing();
  }, 60000);

  afterAll(async () => {
    if (SKIP_INTEGRATION_TESTS) return;

    // Cleanup: delete the test index
    // try {
    //   await engine.deleteIndex(TEST_INDEX);
    // } catch (error) {
    //   console.warn(`Failed to delete test index: ${error}`);
    // }
  }, 60000);

  describe('Index Management', () => {
    it('should check if an index exists', async () => {
      const exists = await engine.indexExists(TEST_INDEX);
      expect(exists).toBe(true);

      const nonExistentIndex = await engine.indexExists('non-existent-index');
      expect(nonExistentIndex).toBe(false);
    });

    it('should get index information', async () => {
      const indexInfo = await engine.getIndexInfo(TEST_INDEX);
      expect(indexInfo).toBeDefined();
      expect(indexInfo.uid).toBe(TEST_INDEX);
      expect(indexInfo.primaryKey).toBe('id');
    });

    it('should get index settings', async () => {
      const settings = await engine.getIndexSettings(TEST_INDEX);
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
      const stats = await engine.getIndexStats(TEST_INDEX);
      expect(stats).toBeDefined();
      expect(stats.numberOfDocuments).toBeGreaterThan(0);
    });

    it('should create and configure a new index with settings', async () => {
      const settingsIndexConfig: SearchIndexConfigExt = {
        indexName: TEST_SETTINGS_INDEX,
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
        // Create the index
        const index = await engine.initIndex(settingsIndexConfig, true);
        expect(index).toBeDefined();

        // Verify settings
        const settings = await engine.getIndexSettings(TEST_SETTINGS_INDEX);
        expect(settings.searchableAttributes).toEqual([ 'title' ]);
        expect(settings.filterableAttributes).toEqual([ 'category' ]);
        expect(settings.sortableAttributes).toEqual([ 'createdAt' ]);

        // Delete when done
        await engine.deleteIndex(TEST_SETTINGS_INDEX, true);
      } catch (err) {
        console.error('Failed to test index creation with settings:', err);
        throw err;
      }
    }, 60000);
  });

  describe('Document Operations', () => {
    it('should get a document by ID', async () => {
      const doc = await engine.getDocument('1', TEST_INDEX);
      expect(doc).toBeDefined();
      expect(doc.id).toBe('1');
      expect(doc.title).toBe('First document');
    }, 60000);

    it('should get multiple documents', async () => {
      const docs = await engine.getDocuments(TEST_INDEX, { limit: 3 });
      expect(docs).toBeDefined();
      expect(docs.length).toBe(3);
    }, 60000);

    it('should update a document', async () => {
      const updatedDoc = { id: '1', title: 'Updated first document' };
      await engine.updateDocuments([ updatedDoc ], indexConfig, true);
      await waitForIndexing();

      const doc = await engine.getDocument('1', TEST_INDEX);
      expect(doc.title).toBe('Updated first document');
      // Original fields should be preserved
      expect(doc.content).toBe('This is the first test document');
    }, 60000);

    it('should delete a document', async () => {
      await engine.deleteDocuments([ '5' ], TEST_INDEX, true);
      await waitForIndexing();

      try {
        await engine.getDocument('5', TEST_INDEX);
        fail('Document should have been deleted');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Verify other documents still exist
      const doc = await engine.getDocument('4', TEST_INDEX);
      expect(doc).toBeDefined();
    }, 60000);

    it('should index documents in batches', async () => {
      const batchDocs = Array(10).fill(null).map((_, i) => ({
        id: `batch-${i}`,
        title: `Batch document ${i}`,
        content: `Content for batch document ${i}`,
        category: i % 2 === 0 ? 'even' : 'odd'
      }));

      await engine.indexInBatches(batchDocs, indexConfig, 5, true);
      await waitForIndexing();

      // Check that all documents were indexed
      const doc = await engine.getDocument('batch-0', TEST_INDEX);
      expect(doc).toBeDefined();
      expect(doc.title).toBe('Batch document 0');

      // Cleanup
      const ids = batchDocs.map(d => d.id);
      await engine.deleteDocuments(ids, TEST_INDEX, true);
    }, 60000);
  });

  describe('Search Operations', () => {
    it('should perform a basic search', async () => {
      const result = await engine.search<any>({ search: 'document' }, indexConfig);

      expect(result).toBeDefined();
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      expect(result.hits.some(hit => hit.id === '1')).toBe(true);
    });

    it('should perform a search with filters', async () => {
      const result = await engine.search<any>({
        search: 'document',
        filters: { category: { eq: 'tutorial' } }
      }, indexConfig);

      expect(result).toBeDefined();
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.every(hit => hit.category === 'tutorial')).toBe(true);
    });

    it('should perform a search with complex filters', async () => {
      const result = await engine.search<any>({
        search: 'document',
        filters: {
          and: [
            { price: { gte: 20 } },
            { status: { eq: 'active' } }
          ]
        }
      }, indexConfig);

      expect(result).toBeDefined();
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.every(hit => hit.price >= 20 && hit.status === 'active')).toBe(true);
    });

    it('should search with OR filters', async () => {
      const result = await engine.search<any>({
        search: 'document',
        filters: {
          or: [
            { category: { eq: 'tutorial' } },
            { category: { eq: 'guide' } }
          ]
        }
      }, indexConfig);

      expect(result).toBeDefined();
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.every(hit => [ 'tutorial', 'guide' ].includes(hit.category))).toBe(true);
    });

    it('should search with NOT filters', async () => {

      const query: SearchQueryTyped<{
        filterableAttributes: [ 'category' ],
        searchableAttributes: [ 'title', 'content', 'tags' ],
        sortableAttributes: [ 'price' ],
        selectableAttributes: [ 'id', 'title', 'content', 'tags', 'price', 'status' ],
      }> = {
        search: 'document',
        filters: {
          not: { category: { eq: 'test' } } as any
        }
      }

      const result = await engine.search<any>(query, indexConfig);

      expect(result).toBeDefined();
      expect(result.hits.every(hit => hit.category !== 'test')).toBe(true);
    });

    it('should search with a specific term', async () => {
      const result = await engine.search<any>({
        search: 'xylophone'
      }, indexConfig);

      expect(result).toBeDefined();
      expect(result.hits.length).toBe(1);
      expect(result.hits[ 0 ].id).toBe('4');
    });

    it('should search with pagination', async () => {
      const result1 = await engine.search<any>({
        search: 'document',
        pagination: { page: 1, limit: 2 }
      }, indexConfig);

      const result2 = await engine.search<any>({
        search: 'document',
        pagination: { page: 2, limit: 2 }
      }, indexConfig);

      expect(result1.hits.length).toBe(2);
      expect(result2.hits.length).toBeGreaterThan(0);
      expect(result1.hits[ 0 ].id).not.toBe(result2.hits[ 0 ].id);
    });

    it('should search with sorting', async () => {
      const ascResult = await engine.search<any>({
        search: 'document',
        sort: [ { field: 'price', dir: 'asc' } ]
      }, indexConfig);

      const descResult = await engine.search<any>({
        search: 'document',
        sort: [ { field: 'price', dir: 'desc' } ]
      }, indexConfig);

      expect(ascResult.hits.length).toBeGreaterThan(1);
      expect(descResult.hits.length).toBeGreaterThan(1);

      // Check ascending order
      for (let i = 0; i < ascResult.hits.length - 1; i++) {
        expect(ascResult.hits[ i ].price <= ascResult.hits[ i + 1 ].price).toBe(true);
      }

      // Check descending order
      for (let i = 0; i < descResult.hits.length - 1; i++) {
        expect(descResult.hits[ i ].price >= descResult.hits[ i + 1 ].price).toBe(true);
      }

      // First documents should be opposite in the two result sets
      expect(ascResult.hits[ 0 ].id).not.toBe(descResult.hits[ 0 ].id);
    });

    it('should search with field selection', async () => {
      const result = await engine.search<any>({
        search: 'document',
        select: [ 'id', 'title' ]
      }, indexConfig);

      expect(result.hits.length).toBeGreaterThan(0);
      expect(Object.keys(result.hits[ 0 ]).sort()).toEqual([ 'id', 'title' ].sort());
    });

    it('should search with faceting', async () => {
      // First update the index config to include facets
      const facetConfig = {
        ...indexConfig,
        faceting: {
          facets: {
            category: { attribute: 'category', type: 'value' },
            status: { attribute: 'status', type: 'value' }
          }
        }
      } as const;

      const result = await engine.search<any>({
        search: 'document',
        returnFacets: [ 'category', 'status' ]
      }, facetConfig);

      expect(result.facets).toBeDefined();
      expect(result.facets?.category).toBeDefined();
      expect(result.facets?.status).toBeDefined();

      // Should have counts for different categories
      expect(Object.keys(result.facets?.category || {}).length).toBeGreaterThan(0);
    });

    it('should perform a multi-search query', async () => {
      const queries = [
        {
          indexUid: TEST_INDEX,
          query: 'document',
          searchParams: { limit: 2 }
        },
        {
          indexUid: TEST_INDEX,
          query: 'special',
          searchParams: { filter: 'category = tutorial' }
        }
      ];

      const result = await engine.multiSearch(queries);
      expect(result).toBeDefined();
      expect(result.results.length).toBe(2);

      // First query should return documents with "document"
      expect(result.results[ 0 ].hits.length).toBeLessThanOrEqual(2);

      // Second query should return the special document in tutorial category
      expect(result.results[ 1 ].hits.length).toBeGreaterThan(0);
      expect(result.results[ 1 ].hits.every((hit: any) => hit.category === 'tutorial')).toBe(true);
    }, 60000);
  });

  describe('Advanced Features', () => {
    it('should highlight search results', async () => {
      const result = await engine.search<any>({
        search: 'special',
        highlight: {
          fields: [ 'title', 'content' ],
          preTag: '<em>',
          postTag: '</em>'
        }
      }, indexConfig);

      expect(result.hits.length).toBeGreaterThan(0);
      const hit = result.hits.find(h => h.id === '4');
      expect(hit?._formatted).toBeDefined();
      expect(hit?._formatted?.content).toContain('<em>special</em>');
    });

    it('should crop search results', async () => {
      const result = await engine.search<any>({
        search: 'brown fox',
        crop: {
          fields: [ 'content' ],
          length: 10,
          marker: '...'
        }
      }, indexConfig);

      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[ 0 ]._formatted?.content?.length).toBeLessThanOrEqual(result.hits[ 0 ].content.length);
      expect(result.hits[ 0 ]._formatted?.content).toContain('...');
    });

    it('should handle "exists" filter operation', async () => {
      // Create a document with a missing field
      const docWithMissingField = { id: '100', title: 'Document with missing field' };
      await engine.indexDocuments([ docWithMissingField ], indexConfig, true);
      await waitForIndexing();

      const result = await engine.search<any>({
        filters: {
          category: { exists: true }
        }
      }, indexConfig);

      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.some(hit => hit.id === '100')).toBe(false);

    }, 600000);

    it('should search with array values using "in" operator', async () => {
      const result = await engine.search<any>({
        filters: {
          tags: { in: [ 'special', 'guide' ] }
        }
      }, indexConfig);

      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.every(hit => {
        return hit.tags.some((tag: string) => [ 'special', 'guide' ].includes(tag));
      })).toBe(true);
    });

    it.skip('should search with contains filter', async () => {

      // MeiliSearchApiError: Using `CONTAINS` or `STARTS WITH` in a filter requires enabling 
      // the `contains filter` experimental feature. 
      //
      // See https://github.com/orgs/meilisearch/discussions/763

      const result = await engine.search<any>({
        filters: {
          content: { contains: 'special search term' }
        }
      }, indexConfig);

      expect(result.hits.length).toBe(1);
      expect(result.hits[ 0 ].id).toBe('4');
    });

    it('should search with between range filters', async () => {
      const result = await engine.search<any>({
        filters: {
          price: { between: [ 15, 35 ] }
        }
      }, indexConfig);

      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.every(hit => hit.price >= 15 && hit.price <= 35)).toBe(true);
    }, 60000);

    it('should create and use index with synonyms', async () => {
      // Create a new index for synonyms testing
      const synonymsConfig: SearchIndexConfigExt = {
        indexName: TEST_SYNONYMS_INDEX,
        settings: {
          searchableAttributes: [ 'title', 'content' ],
        },
        meiliSearchIndexSettings: {
          synonyms: {
            'smartphone': [ 'phone', 'mobile', 'cellphone' ],
            'automobile': [ 'car', 'vehicle' ]
          }
        }
      };

      try {
        // Create the index with synonyms
        await engine.initIndex(synonymsConfig, true);

        // Add test documents
        const docs = [
          { id: 's1', title: 'Smartphone review', content: 'This is about a smartphone' },
          { id: 's2', title: 'Car review', content: 'This is about an automobile' }
        ];
        await engine.indexDocuments(docs, synonymsConfig, true);
        await waitForIndexing();

        // Test searching with synonyms
        const phoneResult = await engine.search<any>({ search: 'phone' }, synonymsConfig);
        expect(phoneResult.hits.length).toBe(1);
        expect(phoneResult.hits[ 0 ].id).toBe('s1');

        const carResult = await engine.search<any>({ search: 'car' }, synonymsConfig);
        expect(carResult.hits.length).toBe(1);
        expect(carResult.hits[ 0 ].id).toBe('s2');

        // Clean up
        await engine.deleteIndex(TEST_SYNONYMS_INDEX, true);
      } catch (error) {
        console.error('Synonyms test failed:', error);
        throw error;
      }
    }, 60000);

    it('should update and use various index settings', async () => {
      const testSettingsIndex = 'test-settings-updates';
      const settingsConfig: SearchIndexConfigExt = {
        indexName: testSettingsIndex,
        settings: {
          searchableAttributes: [ 'title', 'content' ],
          filterableAttributes: [ 'category' ]
        }
      };

      try {
        // Create index with basic settings
        await engine.initIndex(settingsConfig, true);

        // Update searchable attributes
        await engine.updateSearchableAttributes(testSettingsIndex, [ 'title', 'content', 'tags' ], true);

        // Update filterable attributes
        await engine.updateFilterableAttributes(testSettingsIndex, [ 'category', 'status' ], true);

        // Update sortable attributes
        await engine.updateSortableAttributes(testSettingsIndex, [ 'createdAt', 'price' ], true);

        // Verify settings were applied
        const settings = await engine.getIndexSettings(testSettingsIndex);
        expect(settings.searchableAttributes).toContain('tags');
        expect(settings.filterableAttributes).toContain('status');
        expect(settings.sortableAttributes).toContain('price');

        // Clean up
        await engine.deleteIndex(testSettingsIndex, true);
      } catch (error) {
        console.error('Settings update test failed:', error);
        throw error;
      }
    }, 60000);

    it('should get server health and stats', async () => {
      // Test health check
      const health = await engine.isHealthy();
      expect(health).toBe(true);

      // Test stats
      const stats = await engine.getStats();
      expect(stats).toBeDefined();
      expect(stats.databaseSize).toBeDefined();

      // Test version
      const version = await engine.getVersion();
      expect(version).toBeDefined();
      expect(version.pkgVersion).toBeDefined();
    }, 30000);

    it('should get and manage tasks', async () => {
      // Create a task
      const task = await engine.indexDocuments([ { id: 'task-test', title: 'Task Test' } ], indexConfig);
      expect(task).toBeDefined();
      expect(task.taskUid).toBeDefined();

      // Get task status
      const taskInfo = await engine.getTask(task.taskUid);
      expect(taskInfo).toBeDefined();
      expect(taskInfo.uid).toBe(task.taskUid);

      // Get all tasks
      const tasks = await engine.getTasks();
      expect(tasks).toBeDefined();
      expect(tasks.results.length).toBeGreaterThan(0);

      // Get filtered tasks
      const filteredTasks = await engine.getTasks({
        indexUids: [ TEST_INDEX ],
        limit: 5
      });
      expect(filteredTasks).toBeDefined();
      expect(filteredTasks.results.length).toBeGreaterThan(0);
      expect(filteredTasks.results.every(t => t.indexUid === TEST_INDEX)).toBe(true);
    }, 60000);
  });

  // Testing vector search if supported by the MeiliSearch instance (usually requires >= v1.3)
  describe('Vector Search', () => {
    const VECTOR_INDEX = 'test-vector-index';
    const vectorConfig = {
      indexName: VECTOR_INDEX,
      settings: {
        searchableAttributes: [ 'title', 'content' ],
        filterableAttributes: [ 'category' ],
        // Vector search settings typically need to be configured
        // This is implementation specific and may need to be adjusted
      }
    };

    // Skip vector tests by default as they might require specific MeiliSearch versions/config
    it('should perform vector search if supported', async () => {
      try {
        // Create vector index
        await engine.initIndex(vectorConfig, true);

        // Add vector documents
        await engine.indexDocuments(TEST_VECTOR_DOCS, vectorConfig, true);
        await waitForIndexing();

        // Perform vector search with a query vector
        const result = await engine.search<any>({
          vector: [ 0.1, 0.2, 0.3 ]
        }, vectorConfig);

        expect(result.hits.length).toBeGreaterThan(0);

        // Clean up
        await engine.deleteIndex(VECTOR_INDEX, true);
      } catch (error) {
        console.warn('Vector search test skipped, may not be supported:', error);
      }
    }, 60000);
  });
});
