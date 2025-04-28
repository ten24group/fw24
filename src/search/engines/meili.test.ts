import { SearchEngineConfig, SearchResult, FacetConfig } from "../types";
import { MeiliSearchEngine, MeiliSearchConfig } from "./meili";
import { EntityQuery } from "../../entity/query-types";
import { Index, MeiliSearch } from "meilisearch";

// Mock the meilisearch module
jest.mock('meilisearch');

describe('MeiliSearchEngine', () => {
  let engine: MeiliSearchEngine;
  let mockMeiliSearch: jest.Mocked<MeiliSearch>;
  let mockIndex: jest.Mocked<Index>;
  let config: MeiliSearchConfig;
  let searchConfig: SearchEngineConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock index
    mockIndex = {
      addDocuments: jest.fn(),
      search: jest.fn(),
      deleteDocuments: jest.fn(),
      updateSettings: jest.fn(),
    } as any;

    // Setup mock MeiliSearch client
    mockMeiliSearch = {
      index: jest.fn().mockReturnValue(mockIndex),
    } as any;

    (MeiliSearch as jest.Mock).mockImplementation(() => mockMeiliSearch);

    // Setup configs
    config = {
      host: 'http://localhost:7700',
      apiKey: 'test-api-key',
    };

    searchConfig = {
      provider: 'meili',
      indexName: 'test-index',
      settings: {
        searchableAttributes: [ 'title', 'description' ],
        filterableAttributes: [ 'category', 'status' ],
      },
    };

    // Create engine instance
    engine = new MeiliSearchEngine(config);
  });

  describe('index', () => {
    it('should index documents', async () => {
      const documents = [
        { id: '1', title: 'Test Document 1' },
        { id: '2', title: 'Test Document 2' },
      ];

      await engine.index(documents, searchConfig);

      expect(mockMeiliSearch.index).toHaveBeenCalledWith(searchConfig.indexName);
      expect(mockIndex.addDocuments).toHaveBeenCalledWith(documents);
    });

    it('should throw an error if indexName is missing', async () => {
      const documents = [ { id: '1', title: 'Test Document' } ];
      const invalidConfig = { ...searchConfig, indexName: undefined };

      await expect(engine.index(documents, invalidConfig)).rejects.toThrow('Index name is required');
    });
  });

  describe('search', () => {
    it('should perform a search with basic query', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        processingTimeMs: 10,
        facetDistribution: { category: { 'cat1': 5 } },
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      const result = await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith('test query', {
        filter: [],
        facets: undefined,
        limit: 20,
        offset: 0,
        sort: undefined,
      });

      expect(result).toEqual({
        estimatedTotalHits: 1,
        facetDistribution: {
          category: {
            cat1: 5,
          },
        },
        hits: mockResults.hits,
        total: mockResults.estimatedTotalHits,
        processingTimeMs: mockResults.processingTimeMs,
        facets: mockResults.facetDistribution,
      });
    });

    it('should handle pagination', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        pagination: {
          pages: 2,
          count: 10,
        },
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith('test query', {
        filter: [],
        facets: undefined,
        limit: 10,
        offset: 10, // (page 2 - 1) * count 10
        sort: undefined,
      });
    });

    it('should handle sorting', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        pagination: {
          order: 'desc',
        },
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith('test query', {
        filter: [],
        facets: undefined,
        limit: 20,
        offset: 0,
        sort: [ 'createdAt:desc' ],
      });
    });

    it('should handle faceting', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
      };

      const facetingConfig: SearchEngineConfig = {
        ...searchConfig,
        faceting: {
          maxValuesPerFacet: 10,
          facets: {
            category: { attribute: 'category', type: 'value' },
            status: { attribute: 'status', type: 'value' },
          },
        },
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        facetDistribution: {
          category: { 'cat1': 5, 'cat2': 3 },
          status: { 'active': 8 },
        },
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      const result = await engine.search(query, facetingConfig);

      expect(mockIndex.search).toHaveBeenCalledWith('test query', {
        filter: [],
        facets: [ 'category', 'status' ],
        limit: 20,
        offset: 0,
        sort: undefined,
      });

      expect(result.facets).toEqual(mockResults.facetDistribution);
    });

    it('should handle array search terms', async () => {
      const query: EntityQuery<any> = {
        search: [ 'test', 'query' ],
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith('test query', expect.any(Object));
    });

    it('should handle complex filter combinations', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        filters: {
          and: [
            { category: { in: [ 'books', 'magazines' ] } },
            {
              or: [
                { price: { between: [ 10, 100 ] } },
                { status: { eq: 'active' } }
              ]
            },
            { not: { author: { isNull: true } } }
          ]
        }
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        facetDistribution: {}
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          filter: expect.arrayContaining([
            expect.stringContaining('category IN ["books", "magazines"]'),
            expect.stringContaining('(price 10 TO 100 OR status = "active")'),
            expect.stringContaining('NOT (author NOT EXISTS)')
          ])
        })
      );
    });

    it('should handle range faceting', async () => {
      const query: EntityQuery<any> = {
        search: 'test query'
      };

      const facetingConfig: SearchEngineConfig = {
        ...searchConfig,
        faceting: {
          maxValuesPerFacet: 10,
          facets: {
            price: {
              attribute: 'price',
              type: 'range',
              ranges: [
                { from: 0, to: 100, label: 'Budget' },
                { from: 101, to: 500, label: 'Mid-range' },
                { from: 501, to: 999999, label: 'Premium' }
              ]
            }
          }
        }
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        facetDistribution: {
          price: {
            'Budget': 5,
            'Mid-range': 3,
            'Premium': 2
          }
        }
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      const result = await engine.search(query, facetingConfig);

      expect(mockIndex.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          facets: [ 'price' ]
        })
      );

      expect(result.facets).toEqual(mockResults.facetDistribution);
    });

    it('should handle multiple sort fields', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        pagination: {
          order: 'desc'
        }
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          sort: [ 'createdAt:desc' ]
        })
      );
    });

    it('should handle complex search with filters and faceting', async () => {
      const query: EntityQuery<any> = {
        search: [ 'test', 'query' ],
        filters: {
          and: [
            { category: { in: [ 'books' ] } },
            { price: { between: [ 10, 100 ] } }
          ]
        },
        pagination: {
          pages: 2,
          count: 10,
          order: 'desc'
        }
      };

      const facetingConfig: SearchEngineConfig = {
        ...searchConfig,
        faceting: {
          maxValuesPerFacet: 10,
          facets: {
            category: { attribute: 'category', type: 'value' },
            status: { attribute: 'status', type: 'value' }
          }
        }
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        facetDistribution: {
          category: { 'books': 5 },
          status: { 'active': 3 }
        }
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      const result = await engine.search(query, facetingConfig);

      expect(mockIndex.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          filter: expect.arrayContaining([
            expect.stringContaining('category IN ["books"]'),
            expect.stringContaining('price 10 TO 100')
          ]),
          facets: [ 'category', 'status' ],
          limit: 10,
          offset: 10,
          sort: [ 'createdAt:desc' ]
        })
      );

      expect(result.facets).toEqual(mockResults.facetDistribution);
    });

    it('should handle search errors gracefully', async () => {
      const query: EntityQuery<any> = {
        search: 'test query'
      };

      mockIndex.search.mockRejectedValue(new Error('Search failed'));

      await expect(engine.search(query, searchConfig)).rejects.toThrow('Search failed');
    });
  });

  describe('delete', () => {
    it('should delete documents by ids', async () => {
      const ids = [ '1', '2', '3' ];

      await engine.delete(ids, 'test-index');

      expect(mockIndex.deleteDocuments).toHaveBeenCalledWith(ids);
    });
  });

  describe('filter transformation', () => {
    it('should handle array values in filters', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        filters: {
          category: { in: [ 'books', 'magazines' ] }
        }
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        facetDistribution: {}
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          filter: expect.arrayContaining([
            expect.stringContaining('category IN ["books", "magazines"]')
          ])
        })
      );
    });

    it('should handle range filters', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        filters: {
          price: { between: [ 10, 100 ] }
        }
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        facetDistribution: {}
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          filter: expect.arrayContaining([
            expect.stringContaining('price 10 TO 100')
          ])
        })
      );
    });

    it('should handle null/empty checks', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        filters: {
          description: { isNull: true }
        }
      };

      const mockResults = {
        hits: [ { id: '1', title: 'Test Document' } ],
        estimatedTotalHits: 1,
        facetDistribution: {}
      };

      mockIndex.search.mockResolvedValue(mockResults as any);

      await engine.search(query, searchConfig);

      expect(mockIndex.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          filter: expect.arrayContaining([
            expect.stringContaining('description NOT EXISTS')
          ])
        })
      );
    });
  });
});

