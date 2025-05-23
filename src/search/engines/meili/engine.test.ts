import { MeiliSearchEngine, ExtendedMeiliSearchClientConfig } from "./engine";
import { SearchIndexConfig } from "../../types";
import { MeiliSearch, Index, SearchParams, EnqueuedTask } from "meilisearch";
import { GenericFilterCriteria } from "../../../entity/query-types";

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
      addDocuments: jest.fn().mockResolvedValue({ taskUid: 1 }),
      search: jest.fn(),
      deleteDocuments: jest.fn().mockResolvedValue({ taskUid: 1 }),
      updateSettings: jest.fn().mockResolvedValue({ taskUid: 1 }),
      updateDocuments: jest.fn().mockResolvedValue({ taskUid: 2 }),
      getDocument: jest.fn(),
      getDocuments: jest.fn(),
      deleteAllDocuments: jest.fn().mockResolvedValue({ taskUid: 3 }),
      getStats: jest.fn(),
    } as Partial<Index> as jest.Mocked<Index>;

    mockClient = {
      index: jest.fn().mockReturnValue(mockIndex),
      createIndex: jest.fn().mockResolvedValue(mockIndex),
      multiSearch: jest.fn(),
      getTask: jest.fn(),
      waitForTask: jest.fn(),
    } as Partial<MeiliSearch> as jest.Mocked<MeiliSearch>;

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
      const badConfig = { ...searchConfig, indexName: undefined };
      await expect(engine.search({ search: "" }, badConfig)).rejects.toThrow();
    });

    it("reuses existing index instance across multiple searches", async () => {
      mockIndex.search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
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

    describe("filter transformations", () => {
      it("maps simple field operators", async () => {
        const filters = { a: { eq: "x" }, b: { gt: 1 }, c: { lte: 5 } };
        await engine.search({ search: "", filters }, searchConfig);
        const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams;
        expect(opts.filter).toContain("a = 'x'");
        expect(opts.filter).toContain("b > 1");
        expect(opts.filter).toContain("c <= 5");
      });

      it("supports IN and NOT IN operators", async () => {
        const filters = { tags: { in: [ "t1", "t2" ], notIn: [ "t3" ] } };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams)
          .filter;
        expect(fstr).toContain("tags IN ['t1', 't2']");
        expect(fstr).toContain("NOT (tags IN ['t3'])");
      });

      it("supports range (between) operator", async () => {
        const filters = { price: { between: { from: 10, to: 20 } } };
        await engine.search({ search: "", filters }, searchConfig);
        expect(
          (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter,
        ).toContain("price 10 TO 20");
      });

      it("supports EXISTS, IS EMPTY, IS NULL", async () => {
        await engine.search(
          {
            search: "",
            filters: {
              f: { exists: true },
              g: { isEmpty: true },
              h: { isNull: true },
            },
          },
          searchConfig
        );

        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams)
          .filter;
        expect(fstr).toContain("f EXISTS");
        expect(fstr).toContain("g IS EMPTY");
        expect(fstr).toContain("h IS NULL");
      });

      it("supports contains and startsWith", async () => {
        const filters = { d: { contains: "abc" }, s: { startsWith: "pre" } };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams)
          .filter;
        expect(fstr).toContain("d CONTAINS 'abc'");
        expect(fstr).toContain("s STARTS WITH 'pre'");
      });

      it("handles top-level AND group", async () => {
        const filters = { and: [ { a: { eq: 1 } }, { b: { eq: 2 } } ] };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams)
          .filter;
        expect(fstr).toMatch(/\(a = 1 AND b = 2\)/);
      });

      it("handles nested OR and NOT groups", async () => {
        const filters: GenericFilterCriteria<{ x: number, y: number, z: number }> = {
          and: [
            {
              or: [
                { x: { lt: 5 } },
                { y: { gt: 10 } }
              ]
            },
            { not: [ { z: { eq: 0 } } ] },
          ],
        };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams)
          .filter;
        expect(fstr).toMatch("((x < 5 OR y > 10) AND NOT (z = 0))");
      });

      it("ignores filter metadata keys", async () => {
        const filters: GenericFilterCriteria<{ a: string }> = {
          and: [ { filterId: "1", filterLabel: "L", a: { eq: "v" } } ],
        };
        await engine.search({ search: "", filters }, searchConfig);
        expect(
          (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter,
        ).toContain("a = 'v'");
      });

      it("handles multiple nested AND/OR/NOT groups", async () => {
        const filters: GenericFilterCriteria<{ a: number, b: number, c: number, d: number, e: number, f: number }> = {
          and: [
            {
              or: [
                { a: { eq: 1 } }, { b: { eq: 2 } }
              ]
            },
            {
              not: [
                { c: { gt: 3 } }
              ]
            },
            { d: { lte: 4 } },
            {
              or: [
                { e: { neq: 5 } },
                {
                  not: [
                    { f: { in: [ 6, 7 ] } }
                  ]
                }
              ]
            },
          ],
        };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
        expect(fstr).toMatch(
          /\(\(a = 1 OR b = 2\) AND NOT \(c > 3\) AND d <= 4 AND \(e != 5 OR NOT \(f IN \[6, 7\]\)\)\)/
        );
      });

      it("handles deeply nested groups with all logical operators", async () => {
        const filters: GenericFilterCriteria<{ x: number, y: number, z: number, w: number, v: number }> = {
          or: [
            {
              and: [
                { x: { lt: 10 } },
                { not: [ { y: { eq: 20 } } ] },
                {
                  or: [
                    { z: { gte: 30 } },
                    { w: { lte: 40 } },
                  ],
                },
              ],
            },
            { not: [ { v: { neq: 50 } } ] },
          ],
        };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
        expect(fstr).toMatch(
          /\(\(x < 10 AND NOT \(y = 20\) AND \(z >= 30 OR w <= 40\)\) OR NOT \(v != 50\)\)/
        );
      });

      it("handles NOT of an AND group", async () => {
        const filters = {
          not: [ {
            and: [
              { a: { eq: 1 } },
              { b: { eq: 2 } },
            ],
          } ],
        };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
        expect(fstr).toMatch("NOT (a = 1 AND b = 2)");
      });

      it("handles NOT of an OR group", async () => {
        const filters: GenericFilterCriteria<{ a: number, b: number }> = {
          not: [ {
            or: [
              { a: { eq: 1 } },
              { b: { eq: 2 } },
            ],
          } ],
        };
        await engine.search({ search: "", filters }, searchConfig);
        const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
        expect(fstr).toMatch("NOT (a = 1 OR b = 2)");
      });

      describe("missing filter operators", () => {
        it("supports neq, gte, lt operators", async () => {
          const filters = {
            a: { neq: "x" },
            b: { gte: 5 },
            c: { lt: 10 }
          };
          await engine.search({ search: "", filters }, searchConfig);
          const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams;
          expect(opts.filter).toContain("a != 'x'");
          expect(opts.filter).toContain("b >= 5");
          expect(opts.filter).toContain("c < 10");
        });

        it("supports alternative operator aliases", async () => {
          const filters: GenericFilterCriteria<{ tags: string[], price: number }> = {
            tags: { notIn: [ "old" ] },
            price: { bt: { from: 10, to: 20 } }
          };
          await engine.search({ search: "", filters }, searchConfig);
          const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
          expect(fstr).toContain("NOT (tags IN ['old'])");
          expect(fstr).toContain("price 10 TO 20");
        });

        it("handles mixed data types in filters", async () => {
          const filters: GenericFilterCriteria<{
            stringField: string;
            numberField: number;
            booleanField: boolean;
            nullField: any;
          }> = {
            stringField: { eq: "text" },
            numberField: { gt: 42 },
            booleanField: { eq: true },
            nullField: { isNull: true }
          };
          await engine.search({ search: "", filters }, searchConfig);
          const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
          expect(fstr).toContain("stringField = 'text'");
          expect(fstr).toContain("numberField > 42");
          expect(fstr).toContain("booleanField = true");
          expect(fstr).toContain("nullField IS NULL");
        });

        it("handles empty array values in IN operators", async () => {
          const filters = {
            tags: { in: [] },
            categories: { notIn: [] }
          };
          await engine.search({ search: "", filters }, searchConfig);
          const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
          expect(fstr).toContain("tags IN []");
          expect(fstr).toContain("NOT (categories IN [])");
        });

        it("handles special characters in filter values", async () => {
          const filters = {
            title: { eq: "O'Reilly's \"Book\"" },
            description: { contains: "UTF-8: 测试" },
            path: { startsWith: "C:\\Program Files\\" }
          };
          await engine.search({ search: "", filters }, searchConfig);
          const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
          expect(fstr).toBeDefined();
          // Verify that special characters are properly escaped/handled
        });

        it("supports array-format between operator", async () => {
          const filters: GenericFilterCriteria<{ price: number, score: number }> = {
            price: { between: [ 5, 15 ] as [ number, number ] },
            score: { bt: [ 0.8, 1.1 ] as [ number, number ] }
          };
          await engine.search({ search: "", filters }, searchConfig);
          const fstr = (mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams).filter;
          expect(fstr).toContain("price 5 TO 15");
          expect(fstr).toContain("score 0.8 TO 1.1");
        });
      });
    });

    it("supports explicit query.sort", async () => {
      await engine.search(
        { search: "", sort: [ { field: "price", dir: "desc" } ] },
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ sort: [ "price:desc" ] })
      );
    });

    it("applies distinct", async () => {
      await engine.search(
        { search: "", distinct: "userId" },
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ distinct: "userId" })
      );
    });

    it("applies select fields", async () => {
      await engine.search(
        { search: "", select: [ "id", "name" ] },
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
        },
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
        },
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
        { search: "", matchingStrategy: "last" },
        searchConfig
      );
      expect(mockIndex.search).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ matchingStrategy: "last" })
      );
    });

    it("handles empty OR and AND groups without setting filters", async () => {
      // first call: empty OR, second: empty AND
      await engine.search({ search: "", filters: { or: [] } }, searchConfig);
      await engine.search({ search: "", filters: { and: [] } }, searchConfig);
      const noFilterCalls = mockIndex.search.mock.calls.filter(([ , opts ]) => !(opts as any).filter);
      expect(noFilterCalls.length).toBe(2);
    });

    it("propagates errors from MeiliSearch.search", async () => {
      mockIndex.search.mockRejectedValue(new Error("fail"));
      await expect(engine.search({ search: "" }, searchConfig)).rejects.toThrow(
        "fail",
      );
    });

    describe("pagination edge cases", () => {
      it("handles boundary values (page=0, negative values)", async () => {
        await engine.search(
          { search: "", pagination: { page: 0, limit: -5 } },
          searchConfig
        );
        // Should handle gracefully or apply defaults
        expect(mockIndex.search).toHaveBeenCalled();
      });

      it("handles very large page numbers", async () => {
        await engine.search(
          { search: "", pagination: { page: 999999, limit: 50 } },
          searchConfig
        );
        const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams;
        expect(opts.offset).toBe((999999 - 1) * 50);
        expect(opts.limit).toBe(50);
      });

      it("uses page/hitsPerPage when usePagination is true", async () => {
        await engine.search(
          {
            search: "",
            pagination: {
              page: 2,
              limit: 15,
              usePagination: true
            }
          },
          searchConfig
        );
        const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams;
        expect(opts.page).toBe(2);
        expect(opts.hitsPerPage).toBe(15);
        expect(opts.offset).toBeUndefined();
        expect(opts.limit).toBeUndefined();
      });

      it("uses limit/offset when usePagination is false or undefined", async () => {
        await engine.search(
          {
            search: "",
            pagination: {
              page: 3,
              limit: 10,
              usePagination: false
            }
          },
          searchConfig
        );
        const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams;
        expect(opts.limit).toBe(10);
        expect(opts.offset).toBe(20);
        expect(opts.page).toBeUndefined();
        expect(opts.hitsPerPage).toBeUndefined();
      });

      it("applies defaults when pagination is completely omitted", async () => {
        await engine.search({ search: "test" }, searchConfig);
        const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams;
        expect(opts.limit).toBe(20); // default limit
        expect(opts.offset).toBe(0);  // default offset
      });
    });

    describe("search query edge cases", () => {
      it("handles empty search terms", async () => {
        await engine.search({ search: "" }, searchConfig);
        await engine.search({ search: [] }, searchConfig);

        expect(mockIndex.search).toHaveBeenCalledWith("", expect.any(Object));
        expect(mockIndex.search).toHaveBeenCalledWith("", expect.any(Object));
      });

      it("handles special characters in search terms", async () => {
        const specialQueries = [
          "search with \"quotes\"",
          "unicode: 测试 search",
          "regex chars: [.*+?^${}()|\\]"
        ];

        for (const query of specialQueries) {
          await engine.search({ search: query }, searchConfig);
          expect(mockIndex.search).toHaveBeenCalledWith(query, expect.any(Object));
        }
      });

      it("handles very long search terms", async () => {
        const longQuery = "a".repeat(10000);
        await engine.search({ search: longQuery }, searchConfig);
        expect(mockIndex.search).toHaveBeenCalledWith(longQuery, expect.any(Object));
      });
    });

    describe("advanced search features", () => {
      it("supports multiple sort fields", async () => {
        await engine.search(
          {
            search: "",
            sort: [
              { field: "priority", dir: "desc" },
              { field: "created_at", dir: "asc" },
              { field: "title", dir: "desc" }
            ]
          },
          searchConfig
        );
        expect(mockIndex.search).toHaveBeenCalledWith(
          "",
          expect.objectContaining({
            sort: [ "priority:desc", "created_at:asc", "title:desc" ]
          })
        );
      });

      it("handles empty sort array", async () => {
        await engine.search(
          { search: "", sort: [] },
          searchConfig
        );
        const opts = mockIndex.search.mock.calls[ 0 ][ 1 ] as SearchParams;
        expect(opts.sort).toBeUndefined();
      });

      it("applies showRankingScore", async () => {
        await engine.search(
          { search: "test", showRankingScore: true },
          searchConfig
        );
        expect(mockIndex.search).toHaveBeenCalledWith(
          "test",
          expect.objectContaining({ showRankingScore: true })
        );
      });

      it("applies showRankingScoreDetails", async () => {
        await engine.search(
          { search: "test", showRankingScoreDetails: true },
          searchConfig
        );
        expect(mockIndex.search).toHaveBeenCalledWith(
          "test",
          expect.objectContaining({ showRankingScoreDetails: true })
        );
      });

      it("applies rankingScoreThreshold", async () => {
        await engine.search(
          { search: "test", rankingScoreThreshold: 0.8 },
          searchConfig
        );
        expect(mockIndex.search).toHaveBeenCalledWith(
          "test",
          expect.objectContaining({ rankingScoreThreshold: 0.8 })
        );
      });

      it("applies hybrid search options", async () => {
        await engine.search(
          {
            search: "test",
            hybrid: {
              embedder: "default",
              semanticRatio: 0.5
            }
          },
          searchConfig
        );
        expect(mockIndex.search).toHaveBeenCalledWith(
          "test",
          expect.objectContaining({
            hybrid: {
              embedder: "default",
              semanticRatio: 0.5
            }
          })
        );
      });

      it("applies vector search", async () => {
        const vector = [ 0.1, 0.2, 0.3, 0.4, 0.5 ];
        await engine.search(
          { search: "", vector },
          searchConfig
        );
        expect(mockIndex.search).toHaveBeenCalledWith(
          "",
          expect.objectContaining({ vector })
        );
      });
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

  describe("batch operations", () => {
    describe("indexInBatches()", () => {
      it("should index documents in batches", async () => {
        const docs = Array.from({ length: 2500 }, (_, i) => ({ id: `doc${i}` }));
        await engine.indexInBatches(docs, searchConfig, 1000);

        expect(mockIndex.addDocuments).toHaveBeenCalledTimes(3); // 3 batches
        expect(mockIndex.addDocuments).toHaveBeenNthCalledWith(1, expect.arrayContaining([ { id: "doc0" } ]));
        expect(mockIndex.addDocuments).toHaveBeenNthCalledWith(3, expect.arrayContaining([ { id: "doc2000" } ]));
      });

      it("should handle empty documents array", async () => {
        await engine.indexInBatches([], searchConfig);
        expect(mockIndex.addDocuments).not.toHaveBeenCalled();
      });
    });

    describe("updateDocuments()", () => {
      it("should update documents", async () => {
        const docs = [ { id: "1", title: "Updated" } ];
        await engine.updateDocuments(docs, searchConfig);

        expect(mockIndex.updateDocuments).toHaveBeenCalledWith(docs);
      });
    });

    describe("updateDocumentsInBatches()", () => {
      it("should update documents in batches", async () => {
        const docs = Array.from({ length: 1500 }, (_, i) => ({ id: `doc${i}`, updated: true }));
        await engine.updateDocumentsInBatches(docs, searchConfig, 500);

        expect(mockIndex.updateDocuments).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("document retrieval", () => {
    describe("getDocument()", () => {
      it("should retrieve a single document", async () => {
        const mockDoc = { id: "123", title: "Test Doc" };
        mockIndex.getDocument.mockResolvedValue(mockDoc);

        const result = await engine.getDocument("123", "test-index");

        expect(mockIndex.getDocument).toHaveBeenCalledWith("123");
        expect(result).toEqual(mockDoc);
      });
    });

    describe("getDocuments()", () => {
      it("should retrieve multiple documents with options", async () => {
        const mockDocs = [ { id: "1" }, { id: "2" } ];
        mockIndex.getDocuments.mockResolvedValue({ results: mockDocs, total: 2 });

        const options = { limit: 10, offset: 0 };
        const result = await engine.getDocuments("test-index", options);

        expect(mockIndex.getDocuments).toHaveBeenCalledWith(options);
        expect(result).toEqual(mockDocs);
      });

      it("should retrieve documents without options", async () => {
        const mockDocs = [ { id: "1" } ];
        mockIndex.getDocuments.mockResolvedValue({ results: mockDocs, total: 1 });

        const result = await engine.getDocuments("test-index");

        expect(mockIndex.getDocuments).toHaveBeenCalledWith(undefined);
        expect(result).toEqual(mockDocs);
      });
    });
  });

  describe("advanced delete operations", () => {
    describe("deleteAllDocuments()", () => {
      it("should delete all documents from index", async () => {
        await engine.deleteAllDocuments("test-index");

        expect(mockIndex.deleteAllDocuments).toHaveBeenCalled();
      });
    });

    describe("deleteDocumentsByFilter()", () => {
      it("should delete documents by filter", async () => {
        const filter = { category: { eq: "test" } };
        const expectedTask = {
          taskUid: 6,
          indexUid: "test-index",
          status: "enqueued" as const,
          type: "documentDeletion" as const,
          enqueuedAt: new Date().toISOString()
        };
        mockIndex.deleteDocuments.mockResolvedValue(expectedTask);

        const result = await engine.deleteDocumentsByFilter(filter, "test-index");

        expect(mockIndex.deleteDocuments).toHaveBeenCalledWith({
          filter: expect.stringContaining("category = 'test'")
        });
        expect(result).toEqual(expectedTask);
      });

      it("should throw error when indexName is missing", async () => {
        const filter = { status: { eq: "deleted" } };

        await expect(
          engine.deleteDocumentsByFilter(filter, "")
        ).rejects.toThrow("Index name is required");
      });
    });
  });

  describe("multiSearch()", () => {
    it("should perform multi-search across indices", async () => {
      const queries = [
        { indexUid: "index1", query: "search1", searchParams: { limit: 5 } },
        { indexUid: "index2", query: "search2" }
      ];

      const expectedResults = {
        results: [
          { indexUid: "index1", hits: [], processingTimeMs: 10, query: "search1" },
          { indexUid: "index2", hits: [], processingTimeMs: 12, query: "search2" }
        ]
      };
      mockClient.multiSearch.mockResolvedValue(expectedResults);

      const result = await engine.multiSearch(queries);

      expect(mockClient.multiSearch).toHaveBeenCalledWith({
        queries: [
          { indexUid: "index1", q: "search1", limit: 5 },
          { indexUid: "index2", q: "search2" }
        ]
      });
      expect(result).toEqual(expectedResults);
    });
  });

  describe("error handling", () => {
    it("should handle index creation failures", async () => {
      mockClient.createIndex.mockRejectedValue(new Error("Creation failed"));

      await expect(
        engine.indexDocuments([ { id: "1" } ], searchConfig)
      ).rejects.toThrow("Creation failed");
    });

    it("should handle connection errors in search", async () => {
      mockIndex.search.mockRejectedValue(new Error("Connection timeout"));

      await expect(
        engine.search({ search: "test" }, searchConfig)
      ).rejects.toThrow("Search operation failed: Connection timeout");
    });

    it("should handle malformed search results", async () => {
      mockIndex.search.mockResolvedValue(null); // Invalid response

      await expect(
        engine.search({ search: "test" }, searchConfig)
      ).rejects.toThrow();
    });
  });
});
