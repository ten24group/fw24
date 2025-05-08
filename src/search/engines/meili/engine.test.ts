import { MeiliSearchEngine, ExtendedMeiliSearchClientConfig } from "./engine";
import { SearchIndexConfig, SearchOptions } from "../../types";
import { MeiliSearch, Index } from "meilisearch";

jest.mock("meilisearch");

describe("MeiliSearchEngine", () => {
  let engine: MeiliSearchEngine;
  let mockClient: jest.Mocked<MeiliSearch>;
  let mockIndex: jest.Mocked<Index>;
  let config: ExtendedMeiliSearchClientConfig;
  let searchConfig: SearchIndexConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockIndex = {
      addDocuments: jest.fn(),
      search: jest.fn(),
      deleteDocuments: jest.fn(),
      updateSettings: jest.fn(),
    } as any;

    mockClient = {
      index: jest.fn().mockReturnValue(mockIndex),
      createIndex: jest.fn().mockResolvedValue(mockIndex),
    } as any;

    (MeiliSearch as jest.Mock).mockImplementation(() => mockClient);

    config = { host: "http://localhost:7700", apiKey: "key" };
    searchConfig = {
      indexName: "test-index",
      settings: {
        searchableAttributes: [ "title" ],
        filterableAttributes: [ "category" ],
      },
    };
    engine = new MeiliSearchEngine(config);
  });

  describe("index()", () => {
    it("should create index and update settings", async () => {
      const docs = [ { id: "1" } ];
      await engine.indexDocuments(docs, searchConfig);
      expect(mockClient.index).toHaveBeenCalledWith("test-index");
      expect(mockIndex.updateSettings).toHaveBeenCalledWith(
        searchConfig.settings,
      );
      expect(mockIndex.addDocuments).toHaveBeenCalledWith(docs);
    });

    it("should reuse existing index without updating settings again", async () => {
      await engine.indexDocuments([], searchConfig);
      await engine.indexDocuments([], searchConfig);
      expect(mockClient.index).toHaveBeenCalledTimes(2);
      expect(mockIndex.updateSettings).toHaveBeenCalledTimes(1);
    });

    it("throws if indexName is missing", async () => {
      const badConfig = { ...searchConfig, indexName: undefined! };
      await expect(engine.indexDocuments([], badConfig)).rejects.toThrow();
    });

    it("should not update settings when config.settings is omitted", async () => {
      const cfg = { ...searchConfig };
      delete (cfg as any).settings;
      await engine.indexDocuments([], cfg);
      expect(mockIndex.updateSettings).not.toHaveBeenCalled();
    });

    it("propagates errors from addDocuments", async () => {
      mockIndex.addDocuments.mockRejectedValue(new Error("addDocsFail"));
      await expect(engine.indexDocuments([ { id: "x" } ], searchConfig)).rejects.toThrow("addDocsFail");
    });

    it("propagates errors from updateSettings", async () => {
      mockIndex.updateSettings.mockRejectedValue(new Error("settingsFail"));
      await expect(engine.indexDocuments([], searchConfig)).rejects.toThrow("settingsFail");
    });
  });

  describe("search()", () => {
    const baseResults = { hits: [], estimatedTotalHits: 0 } as any;

    beforeEach(() => {
      mockIndex.search.mockResolvedValue(baseResults);
    });

    it("should throw if indexName is missing", async () => {
      const badConfig = { ...searchConfig, indexName: undefined! };
      await expect(engine.search({ search: "" } as any, badConfig as any)).rejects.toThrow();
    });

    it("reuses existing index instance across multiple searches", async () => {
      mockIndex.search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 } as any);
      await engine.search({ search: "a" }, searchConfig);
      await engine.search({ search: "b" }, searchConfig);
      expect(mockClient.index).toHaveBeenCalledTimes(2);
    });

    it("performs simple search with default pagination and no filters", async () => {
      await engine.search({ search: "hello" }, searchConfig);
      expect(mockClient.index).toHaveBeenCalledWith("test-index");
      expect(mockIndex.search).toHaveBeenCalledWith(
        "hello",
        expect.any(Object),
      );
    });

    it("joins array search terms into a single string", async () => {
      await engine.search({ search: [ "foo", "bar" ] }, searchConfig);
      expect(mockIndex.search).toHaveBeenCalledWith(
        "foo bar",
        expect.any(Object),
      );
    });

    it("applies count and pages for pagination", async () => {
      await engine.search(
        { search: "", pagination: { limit: 5, page: 3 } },
        searchConfig,
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ limit: 5, offset: 10 }),
      );
    });

    it("applies default count when pages provided but count missing", async () => {
      await engine.search(
        { search: "", pagination: { page: 2 } },
        searchConfig,
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ limit: 20, offset: 20 }),
      );
    });

    it("includes facet keys when faceting config provided", async () => {
      const faceting = {
        facets: { category: { attribute: "category", type: "value" } },
      };
      const cfg = { ...searchConfig, faceting };
      await engine.search({ search: "" }, cfg as any);
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ facetsDistribution: [ "category" ] }),
      );
    });

    describe("filter transformations", () => {
      it("maps simple field operators", async () => {
        const filters = { a: { eq: "x" }, b: { gt: 1 }, c: { lte: 5 } };
        await engine.search({ search: "", filters } as any, searchConfig);
        const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions;
        expect(opts.filters).toContain("a = 'x'");
        expect(opts.filters).toContain("b > 1");
        expect(opts.filters).toContain("c <= 5");
      });

      it("supports IN and NOT IN operators", async () => {
        const filters = { tags: { in: [ "t1", "t2" ], notIn: [ "t3" ] } };
        await engine.search({ search: "", filters } as any, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions)
          .filters;
        expect(fstr).toContain("tags IN ['t1', 't2']");
        expect(fstr).toContain("NOT (tags IN ['t3'])");
      });

      it("supports range (between) operator", async () => {
        const filters = { price: { between: [ 10, 20 ] } };
        await engine.search({ search: "", filters } as any, searchConfig);
        expect(
          (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions).filters,
        ).toContain("price 10 TO 20");
      });

      it("supports EXISTS, IS EMPTY, IS NULL", async () => {
        const filters = {
          f: { exists: true },
          g: { isEmpty: true },
          h: { isNull: true },
        };
        await engine.search({ search: "", filters } as any, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions)
          .filters;
        expect(fstr).toContain("f EXISTS");
        expect(fstr).toContain("g IS EMPTY");
        expect(fstr).toContain("h IS NULL");
      });

      it("supports contains and startsWith", async () => {
        const filters = { d: { contains: "abc" }, s: { startsWith: "pre" } };
        await engine.search({ search: "", filters } as any, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions)
          .filters;
        expect(fstr).toContain("d CONTAINS 'abc'");
        expect(fstr).toContain("s STARTS WITH 'pre'");
      });

      it("falls back to raw filter for unknown operators", async () => {
        const filters = { x: { customOp: 42 } };
        await engine.search({ search: "", filters } as any, searchConfig);
        expect(
          (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions).filters,
        ).toContain("x customOp 42");
      });

      it("handles top-level AND group", async () => {
        const filters = { and: [ { a: { eq: 1 } }, { b: { eq: 2 } } ] };
        await engine.search({ search: "", filters } as any, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions)
          .filters;
        expect(fstr).toMatch(/\(a = 1 AND b = 2\)/);
      });

      it("handles nested OR and NOT groups", async () => {
        const filters = {
          and: [
            { or: [ { x: { lt: 5 } }, { y: { gt: 10 } } ] },
            { not: { z: { eq: 0 } } },
          ],
        };
        await engine.search({ search: "", filters } as any, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions)
          .filters;
        expect(fstr).toMatch("((x < 5 OR y > 10) AND NOT (z = 0))");
      });

      it("ignores filter metadata keys", async () => {
        const filters = {
          and: [ { filterId: "1", filterLabel: "L", a: { eq: "v" } } ],
        };
        await engine.search({ search: "", filters } as any, searchConfig);
        expect(
          (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchOptions).filters,
        ).toContain("a = 'v'");
      });
    });

    // TODO: enhance query types to support better sorting
    it("supports explicit query.sort", async () => {
      await engine.search(
        { search: "", sort: [ { field: "price", dir: "desc" } ] } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ sort: [ "price:desc" ] })
      );
    });

    it("applies distinctAttribute", async () => {
      await engine.search(
        { search: "", distinctAttribute: "userId" } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ distinctAttribute: "userId" })
      );
    });

    it("applies select fields", async () => {
      await engine.search(
        { search: "", select: [ "id", "name" ] } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ attributesToRetrieve: [ "id", "name" ] })
      );
    });

    it("applies highlight and showMatchesPosition", async () => {
      await engine.search(
        {
          search: "",
          highlight: {
            fields: [ "title" ],
            preTag: "<b>",
            postTag: "</b>",
            showMatchesPosition: true,
          },
        } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          attributesToHighlight: [ "title" ],
          highlightPreTag: "<b>",
          highlightPostTag: "</b>",
          showMatchesPosition: true,
        })
      );
    });

    it("applies crop options", async () => {
      await engine.search(
        {
          search: "",
          crop: { fields: [ "body" ], length: 30, marker: "…" },
        } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          attributesToCrop: [ "body" ],
          cropLength: 30,
          cropMarker: "…",
        })
      );
    });

    it("applies matchingStrategy", async () => {
      await engine.search(
        { search: "", matchingStrategy: "last" } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ matchingStrategy: "last" })
      );
    });

    it("applies geo-search options", async () => {
      await engine.search(
        {
          search: "",
          geo: { lat: 12.9, lng: 77.6, radius: 500, precision: 2 },
        } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          aroundLatLng: "12.9,77.6",
          aroundRadius: 500,
          aroundPrecision: 2,
        })
      );
    });

    it("applies rawOptions", async () => {
      await engine.search(
        {
          search: "",
          rawOptions: { rankingRules: [ "typo", "words" ] },
        } as any,
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ rankingRules: [ "typo", "words" ] })
      );
    });

    it("handles empty OR and AND groups without setting filters", async () => {
      // first call: empty OR, second: empty AND
      await engine.search({ search: "", filters: { or: [] } } as any, searchConfig);
      await engine.search({ search: "", filters: { and: [] } } as any, searchConfig);
      const noFilterCalls = mockIndex.search.mock.calls.filter(([ , opts ]) => !(opts as any).filters);
      expect(noFilterCalls.length).toBe(2);
    });

    it("propagates errors from MeiliSearch.search", async () => {
      mockIndex.search.mockRejectedValue(new Error("fail"));
      await expect(engine.search({ search: "" }, searchConfig)).rejects.toThrow(
        "fail",
      );
    });
  });

  describe("delete()", () => {
    it("deletes documents by ID on correct index", async () => {
      await engine.deleteDocuments([ "1", "2" ], "test-index");
      expect(mockClient.index).toHaveBeenCalledWith("test-index");
      expect(mockIndex.deleteDocuments).toHaveBeenCalledWith([ "1", "2" ]);
    });

    it("throws if indexName is empty", async () => {
      await expect(engine.deleteDocuments([], "")).rejects.toThrow();
    });
  });
});
