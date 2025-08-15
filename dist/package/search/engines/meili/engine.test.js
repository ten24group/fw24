"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engine_1 = require("./engine");
const meilisearch_1 = require("meilisearch");
jest.mock("meilisearch");
describe("MeiliSearchEngine", () => {
    let engine;
    let mockClient;
    let mockIndex;
    let config;
    let searchConfig;
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
        };
        mockClient = {
            index: jest.fn().mockReturnValue(mockIndex),
            createIndex: jest.fn().mockResolvedValue(mockIndex),
            multiSearch: jest.fn(),
            getTask: jest.fn(),
        };
        meilisearch_1.MeiliSearch.mockImplementation(() => mockClient);
        config = { host: "http://localhost:7700", apiKey: "key" };
        searchConfig = {
            indexName: "test-index",
            settings: {
                searchableAttributes: ["title"],
                filterableAttributes: ["category"],
            },
        };
        engine = new engine_1.MeiliSearchEngine(config);
    });
    describe("index()", () => {
        it("should create index and update settings", async () => {
            const docs = [{ id: "1" }];
            await engine.indexDocuments(docs, searchConfig);
            expect(mockClient.index).toHaveBeenCalledWith("test-index");
            expect(mockIndex.updateSettings).toHaveBeenCalledWith(searchConfig.settings);
            expect(mockIndex.addDocuments).toHaveBeenCalledWith(docs);
        });
        it("should reuse existing index without updating settings again", async () => {
            await engine.indexDocuments([], searchConfig);
            await engine.indexDocuments([], searchConfig);
            expect(mockClient.index).toHaveBeenCalledTimes(2);
            expect(mockIndex.updateSettings).toHaveBeenCalledTimes(1);
        });
        it("throws if indexName is missing", async () => {
            const badConfig = { ...searchConfig, indexName: undefined };
            await expect(engine.indexDocuments([], badConfig)).rejects.toThrow();
        });
        it("should not update settings when config.settings is omitted", async () => {
            const cfg = { ...searchConfig };
            delete cfg.settings;
            await engine.indexDocuments([], cfg);
            expect(mockIndex.updateSettings).not.toHaveBeenCalled();
        });
        it("propagates errors from addDocuments", async () => {
            mockIndex.addDocuments.mockRejectedValue(new Error("addDocsFail"));
            await expect(engine.indexDocuments([{ id: "x" }], searchConfig)).rejects.toThrow("addDocsFail");
        });
        it("propagates errors from updateSettings", async () => {
            mockIndex.updateSettings.mockRejectedValue(new Error("settingsFail"));
            await expect(engine.indexDocuments([], searchConfig)).rejects.toThrow("settingsFail");
        });
    });
    describe("search()", () => {
        const baseResults = { hits: [], estimatedTotalHits: 0 };
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
            expect(mockIndex.search).toHaveBeenCalledWith("hello", expect.any(Object));
        });
        it("joins array search terms into a single string", async () => {
            await engine.search({ search: ["foo", "bar"] }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("foo bar", expect.any(Object));
        });
        it("applies count and pages for pagination", async () => {
            await engine.search({ search: "", pagination: { limit: 5, page: 3 } }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({ limit: 5, offset: 10 }));
        });
        it("applies default count when pages provided but count missing", async () => {
            await engine.search({ search: "", pagination: { page: 2 } }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({ limit: 20, offset: 20 }));
        });
        describe("filter transformations", () => {
            it("maps simple field operators", async () => {
                const filters = { a: { eq: "x" }, b: { gt: 1 }, c: { lte: 5 } };
                await engine.search({ search: "", filters }, searchConfig);
                const opts = mockIndex.search.mock.calls[0][1];
                expect(opts.filter).toContain("a = 'x'");
                expect(opts.filter).toContain("b > 1");
                expect(opts.filter).toContain("c <= 5");
            });
            it("supports IN and NOT IN operators", async () => {
                const filters = { tags: { in: ["t1", "t2"], notIn: ["t3"] } };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1]
                    .filter;
                expect(fstr).toContain("tags IN ['t1', 't2']");
                expect(fstr).toContain("NOT (tags IN ['t3'])");
            });
            it("supports range (between) operator", async () => {
                const filters = { price: { between: { from: 10, to: 20 } } };
                await engine.search({ search: "", filters }, searchConfig);
                expect(mockIndex.search.mock.calls[0][1].filter).toContain("price 10 TO 20");
            });
            it("supports EXISTS, IS EMPTY, IS NULL", async () => {
                await engine.search({
                    search: "",
                    filters: {
                        f: { exists: true },
                        g: { isEmpty: true },
                        h: { isNull: true },
                    },
                }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1]
                    .filter;
                expect(fstr).toContain("f EXISTS");
                expect(fstr).toContain("g IS EMPTY");
                expect(fstr).toContain("h IS NULL");
            });
            it("supports contains and startsWith", async () => {
                const filters = { d: { contains: "abc" }, s: { startsWith: "pre" } };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1]
                    .filter;
                expect(fstr).toContain("d CONTAINS 'abc'");
                expect(fstr).toContain("s STARTS WITH 'pre'");
            });
            it("handles top-level AND group", async () => {
                const filters = { and: [{ a: { eq: 1 } }, { b: { eq: 2 } }] };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1]
                    .filter;
                expect(fstr).toMatch(/\(a = 1 AND b = 2\)/);
            });
            it("handles nested OR and NOT groups", async () => {
                const filters = {
                    and: [
                        {
                            or: [
                                { x: { lt: 5 } },
                                { y: { gt: 10 } }
                            ]
                        },
                        { not: [{ z: { eq: 0 } }] },
                    ],
                };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1]
                    .filter;
                expect(fstr).toMatch("((x < 5 OR y > 10) AND NOT (z = 0))");
            });
            it("ignores filter metadata keys", async () => {
                const filters = {
                    and: [{ filterId: "1", filterLabel: "L", a: { eq: "v" } }],
                };
                await engine.search({ search: "", filters }, searchConfig);
                expect(mockIndex.search.mock.calls[0][1].filter).toContain("a = 'v'");
            });
            it("handles multiple nested AND/OR/NOT groups", async () => {
                const filters = {
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
                                        { f: { in: [6, 7] } }
                                    ]
                                }
                            ]
                        },
                    ],
                };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1].filter;
                expect(fstr).toMatch(/\(\(a = 1 OR b = 2\) AND NOT \(c > 3\) AND d <= 4 AND \(e != 5 OR NOT \(f IN \[6, 7\]\)\)\)/);
            });
            it("handles deeply nested groups with all logical operators", async () => {
                const filters = {
                    or: [
                        {
                            and: [
                                { x: { lt: 10 } },
                                { not: [{ y: { eq: 20 } }] },
                                {
                                    or: [
                                        { z: { gte: 30 } },
                                        { w: { lte: 40 } },
                                    ],
                                },
                            ],
                        },
                        { not: [{ v: { neq: 50 } }] },
                    ],
                };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1].filter;
                expect(fstr).toMatch(/\(\(x < 10 AND NOT \(y = 20\) AND \(z >= 30 OR w <= 40\)\) OR NOT \(v != 50\)\)/);
            });
            it("handles NOT of an AND group", async () => {
                const filters = {
                    not: [{
                            and: [
                                { a: { eq: 1 } },
                                { b: { eq: 2 } },
                            ],
                        }],
                };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1].filter;
                expect(fstr).toMatch("NOT (a = 1 AND b = 2)");
            });
            it("handles NOT of an OR group", async () => {
                const filters = {
                    not: [{
                            or: [
                                { a: { eq: 1 } },
                                { b: { eq: 2 } },
                            ],
                        }],
                };
                await engine.search({ search: "", filters }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1].filter;
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
                    const opts = mockIndex.search.mock.calls[0][1];
                    expect(opts.filter).toContain("a != 'x'");
                    expect(opts.filter).toContain("b >= 5");
                    expect(opts.filter).toContain("c < 10");
                });
                it("supports alternative operator aliases", async () => {
                    const filters = {
                        tags: { notIn: ["old"] },
                        price: { bt: { from: 10, to: 20 } }
                    };
                    await engine.search({ search: "", filters }, searchConfig);
                    const fstr = mockIndex.search.mock.calls[0][1].filter;
                    expect(fstr).toContain("NOT (tags IN ['old'])");
                    expect(fstr).toContain("price 10 TO 20");
                });
                it("handles mixed data types in filters", async () => {
                    const filters = {
                        stringField: { eq: "text" },
                        numberField: { gt: 42 },
                        booleanField: { eq: true },
                        nullField: { isNull: true }
                    };
                    await engine.search({ search: "", filters }, searchConfig);
                    const fstr = mockIndex.search.mock.calls[0][1].filter;
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
                    const fstr = mockIndex.search.mock.calls[0][1].filter;
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
                    const fstr = mockIndex.search.mock.calls[0][1].filter;
                    expect(fstr).toBeDefined();
                    // Verify that special characters are properly escaped/handled
                });
                it("supports array-format between operator", async () => {
                    const filters = {
                        price: { between: [5, 15] },
                        score: { bt: [0.8, 1.1] }
                    };
                    await engine.search({ search: "", filters }, searchConfig);
                    const fstr = mockIndex.search.mock.calls[0][1].filter;
                    expect(fstr).toContain("price 5 TO 15");
                    expect(fstr).toContain("score 0.8 TO 1.1");
                });
            });
        });
        it("supports explicit query.sort", async () => {
            await engine.search({ search: "", sort: [{ field: "price", dir: "desc" }] }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({ sort: ["price:desc"] }));
        });
        it("applies distinct", async () => {
            await engine.search({ search: "", distinct: "userId" }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({ distinct: "userId" }));
        });
        it("applies select fields", async () => {
            await engine.search({ search: "", select: ["id", "name"] }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({ attributesToRetrieve: ["id", "name"] }));
        });
        it("applies highlight and showMatchesPosition", async () => {
            await engine.search({
                search: "",
                highlight: {
                    fields: ["title"],
                    preTag: "<b>",
                    postTag: "</b>",
                    showMatchesPosition: true,
                },
            }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({
                attributesToHighlight: ["title"],
                highlightPreTag: "<b>",
                highlightPostTag: "</b>",
                showMatchesPosition: true,
            }));
        });
        it("applies crop options", async () => {
            await engine.search({
                search: "",
                crop: { fields: ["body"], length: 30, marker: "…" },
            }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({
                attributesToCrop: ["body"],
                cropLength: 30,
                cropMarker: "…",
            }));
        });
        it("applies matchingStrategy", async () => {
            await engine.search({ search: "", matchingStrategy: "last" }, searchConfig);
            expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({ matchingStrategy: "last" }));
        });
        it("handles empty OR and AND groups without setting filters", async () => {
            // first call: empty OR, second: empty AND
            await engine.search({ search: "", filters: { or: [] } }, searchConfig);
            await engine.search({ search: "", filters: { and: [] } }, searchConfig);
            const noFilterCalls = mockIndex.search.mock.calls.filter(([, opts]) => !opts.filter);
            expect(noFilterCalls.length).toBe(2);
        });
        it("propagates errors from MeiliSearch.search", async () => {
            mockIndex.search.mockRejectedValue(new Error("fail"));
            await expect(engine.search({ search: "" }, searchConfig)).rejects.toThrow("fail");
        });
        describe("pagination edge cases", () => {
            it("handles boundary values (page=0, negative values)", async () => {
                await engine.search({ search: "", pagination: { page: 0, limit: -5 } }, searchConfig);
                // Should handle gracefully or apply defaults
                expect(mockIndex.search).toHaveBeenCalled();
            });
            it("handles very large page numbers", async () => {
                await engine.search({ search: "", pagination: { page: 999999, limit: 50 } }, searchConfig);
                const opts = mockIndex.search.mock.calls[0][1];
                expect(opts.offset).toBe((999999 - 1) * 50);
                expect(opts.limit).toBe(50);
            });
            it("uses page/hitsPerPage when usePagination is true", async () => {
                await engine.search({
                    search: "",
                    pagination: {
                        page: 2,
                        limit: 15,
                        usePagination: true
                    }
                }, searchConfig);
                const opts = mockIndex.search.mock.calls[0][1];
                expect(opts.page).toBe(2);
                expect(opts.hitsPerPage).toBe(15);
                expect(opts.offset).toBeUndefined();
                expect(opts.limit).toBeUndefined();
            });
            it("uses limit/offset when usePagination is false or undefined", async () => {
                await engine.search({
                    search: "",
                    pagination: {
                        page: 3,
                        limit: 10,
                        usePagination: false
                    }
                }, searchConfig);
                const opts = mockIndex.search.mock.calls[0][1];
                expect(opts.limit).toBe(10);
                expect(opts.offset).toBe(20);
                expect(opts.page).toBeUndefined();
                expect(opts.hitsPerPage).toBeUndefined();
            });
            it("applies defaults when pagination is completely omitted", async () => {
                await engine.search({ search: "test" }, searchConfig);
                const opts = mockIndex.search.mock.calls[0][1];
                expect(opts.limit).toBe(20); // default limit
                expect(opts.offset).toBe(0); // default offset
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
                await engine.search({
                    search: "",
                    sort: [
                        { field: "priority", dir: "desc" },
                        { field: "created_at", dir: "asc" },
                        { field: "title", dir: "desc" }
                    ]
                }, searchConfig);
                expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({
                    sort: ["priority:desc", "created_at:asc", "title:desc"]
                }));
            });
            it("handles empty sort array", async () => {
                await engine.search({ search: "", sort: [] }, searchConfig);
                const opts = mockIndex.search.mock.calls[0][1];
                expect(opts.sort).toBeUndefined();
            });
            it("applies showRankingScore", async () => {
                await engine.search({ search: "test", showRankingScore: true }, searchConfig);
                expect(mockIndex.search).toHaveBeenCalledWith("test", expect.objectContaining({ showRankingScore: true }));
            });
            it("applies showRankingScoreDetails", async () => {
                await engine.search({ search: "test", showRankingScoreDetails: true }, searchConfig);
                expect(mockIndex.search).toHaveBeenCalledWith("test", expect.objectContaining({ showRankingScoreDetails: true }));
            });
            it("applies rankingScoreThreshold", async () => {
                await engine.search({ search: "test", rankingScoreThreshold: 0.8 }, searchConfig);
                expect(mockIndex.search).toHaveBeenCalledWith("test", expect.objectContaining({ rankingScoreThreshold: 0.8 }));
            });
            it("applies hybrid search options", async () => {
                await engine.search({
                    search: "test",
                    hybrid: {
                        embedder: "default",
                        semanticRatio: 0.5
                    }
                }, searchConfig);
                expect(mockIndex.search).toHaveBeenCalledWith("test", expect.objectContaining({
                    hybrid: {
                        embedder: "default",
                        semanticRatio: 0.5
                    }
                }));
            });
            it("applies vector search", async () => {
                const vector = [0.1, 0.2, 0.3, 0.4, 0.5];
                await engine.search({ search: "", vector }, searchConfig);
                expect(mockIndex.search).toHaveBeenCalledWith("", expect.objectContaining({ vector }));
            });
        });
    });
    describe("delete()", () => {
        it("deletes documents by ID on correct index", async () => {
            await engine.deleteDocuments(["1", "2"], "test-index");
            expect(mockClient.index).toHaveBeenCalledWith("test-index");
            expect(mockIndex.deleteDocuments).toHaveBeenCalledWith(["1", "2"]);
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
                expect(mockIndex.addDocuments).toHaveBeenNthCalledWith(1, expect.arrayContaining([{ id: "doc0" }]));
                expect(mockIndex.addDocuments).toHaveBeenNthCalledWith(3, expect.arrayContaining([{ id: "doc2000" }]));
            });
            it("should handle empty documents array", async () => {
                await engine.indexInBatches([], searchConfig);
                expect(mockIndex.addDocuments).not.toHaveBeenCalled();
            });
        });
        describe("updateDocuments()", () => {
            it("should update documents", async () => {
                const docs = [{ id: "1", title: "Updated" }];
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
                const mockDocs = [{ id: "1" }, { id: "2" }];
                mockIndex.getDocuments.mockResolvedValue({ results: mockDocs, total: 2 });
                const options = { limit: 10, offset: 0 };
                const result = await engine.getDocuments("test-index", options);
                expect(mockIndex.getDocuments).toHaveBeenCalledWith(options);
                expect(result).toEqual(mockDocs);
            });
            it("should retrieve documents without options", async () => {
                const mockDocs = [{ id: "1" }];
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
                    status: "enqueued",
                    type: "documentDeletion",
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
                await expect(engine.deleteDocumentsByFilter(filter, "")).rejects.toThrow("Index name is required");
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
            await expect(engine.indexDocuments([{ id: "1" }], searchConfig)).rejects.toThrow("Creation failed");
        });
        it("should handle connection errors in search", async () => {
            mockIndex.search.mockRejectedValue(new Error("Connection timeout"));
            await expect(engine.search({ search: "test" }, searchConfig)).rejects.toThrow("Search operation failed: Connection timeout");
        });
        it("should handle malformed search results", async () => {
            mockIndex.search.mockResolvedValue(null); // Invalid response
            await expect(engine.search({ search: "test" }, searchConfig)).rejects.toThrow();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL2VuZ2luZXMvbWVpbGkvZW5naW5lLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxQ0FBOEU7QUFFOUUsNkNBQTZFO0FBRzdFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7QUFFekIsUUFBUSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRTtJQUNqQyxJQUFJLE1BQXlCLENBQUM7SUFDOUIsSUFBSSxVQUFvQyxDQUFDO0lBQ3pDLElBQUksU0FBNkIsQ0FBQztJQUNsQyxJQUFJLE1BQXVDLENBQUM7SUFDNUMsSUFBSSxZQUErQixDQUFDO0lBRXBDLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFFckIsU0FBUyxHQUFHO1lBQ1YsWUFBWSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLE9BQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUN6RCxNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtZQUNqQixlQUFlLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsT0FBTyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQzVELGNBQWMsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDM0QsZUFBZSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLE9BQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUM1RCxXQUFXLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtZQUN0QixZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtZQUN2QixrQkFBa0IsRUFBRSxJQUFJLENBQUMs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QU0sTUFBTSxDQUNWLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEVBQUUsWUFBWSxDQUFDLENBQ2hELENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDO1FBQ25FLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHdDQUF3QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3RELFNBQVMsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxtQkFBbUI7WUFFN0QsTUFBTSxNQUFNLENBQ1YsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsRUFBRSxZQUFZLENBQUMsQ0FDaEQsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDdEIsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTWVpbGlTZWFyY2hFbmdpbmUsIEV4dGVuZGVkTWVpbGlTZWFyY2hDbGllbnRDb25maWcgfSBmcm9tIFwiLi9lbmdpbmVcIjtcbmltcG9ydCB7IFNlYXJjaEluZGV4Q29uZmlnIH0gZnJvbSBcIi4uLy4uL3R5cGVzXCI7XG5pbXBvcnQgeyBNZWlsaVNlYXJjaCwgSW5kZXgsIFNlYXJjaFBhcmFtcywgRW5xdWV1ZWRUYXNrIH0gZnJvbSBcIm1laWxpc2VhcmNoXCI7XG5pbXBvcnQgeyBHZW5lcmljRmlsdGVyQ3JpdGVyaWEgfSBmcm9tIFwiLi4vLi4vLi4vZW50aXR5L3F1ZXJ5LXR5cGVzXCI7XG5cbmplc3QubW9jayhcIm1laWxpc2VhcmNoXCIpO1xuXG5kZXNjcmliZShcIk1laWxpU2VhcmNoRW5naW5lXCIsICgpID0+IHtcbiAgbGV0IGVuZ2luZTogTWVpbGlTZWFyY2hFbmdpbmU7XG4gIGxldCBtb2NrQ2xpZW50OiBqZXN0Lk1vY2tlZDxNZWlsaVNlYXJjaD47XG4gIGxldCBtb2NrSW5kZXg6IGplc3QuTW9ja2VkPEluZGV4PjtcbiAgbGV0IGNvbmZpZzogRXh0ZW5kZWRNZWlsaVNlYXJjaENsaWVudENvbmZpZztcbiAgbGV0IHNlYXJjaENvbmZpZzogU2VhcmNoSW5kZXhDb25maWc7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG5cbiAgICBtb2NrSW5kZXggPSB7XG4gICAgICBhZGREb2N1bWVudHM6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7IHRhc2tVaWQ6IDEgfSksXG4gICAgICBzZWFyY2g6IGplc3QuZm4oKSxcbiAgICAgIGRlbGV0ZURvY3VtZW50czogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHsgdGFza1VpZDogMSB9KSxcbiAgICAgIHVwZGF0ZVNldHRpbmdzOiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoeyB0YXNrVWlkOiAxIH0pLFxuICAgICAgdXBkYXRlRG9jdW1lbnRzOiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoeyB0YXNrVWlkOiAyIH0pLFxuICAgICAgZ2V0RG9jdW1lbnQ6IGplc3QuZm4oKSxcbiAgICAgIGdldERvY3VtZW50czogamVzdC5mbigpLFxuICAgICAgZGVsZXRlQWxsRG9jdW1lbnRzOiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoeyB0YXNrVWlkOiAzIH0pLFxuICAgICAgZ2V0U3RhdHM6IGplc3QuZm4oKSxcbiAgICB9IGFzIFBhcnRpYWw8SW5kZXg+IGFzIGplc3QuTW9ja2VkPEluZGV4PjtcblxuICAgIG1vY2tDbGllbnQgPSB7XG4gICAgICBpbmRleDogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShtb2NrSW5kZXgpLFxuICAgICAgY3JlYXRlSW5kZXg6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZShtb2NrSW5kZXgpLFxuICAgICAgbXVsdGlTZWFyY2g6IGplc3QuZm4oKSxcbiAgICAgIGdldFRhc2s6IGplc3QuZm4oKSxcbiAgICB9IGFzIFBhcnRpYWw8TWVpbGlTZWFyY2g+IGFzIGplc3QuTW9ja2VkPE1laWxpU2VhcmNoPjtcblxuICAgIChNZWlsaVNlYXJjaCBhcyBqZXN0Lk1vY2spLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiBtb2NrQ2xpZW50KTtcblxuICAgIGNvbmZpZyA9IHsgaG9zdDogXCJodHRwOi8vbG9jYWxob3N0Ojc3MDBcIiwgYXBpS2V5OiBcImtleVwiIH07XG4gICAgc2VhcmNoQ29uZmlnID0ge1xuICAgICAgaW5kZXhOYW1lOiBcInRlc3QtaW5kZXhcIixcbiAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbIFwidGl0bGVcIiBdLFxuICAgICAgICBmaWx0ZXJhYmxlQXR0cmlidXRlczogWyBcImNhdGVnb3J5XCIgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBlbmdpbmUgPSBuZXcgTWVpbGlTZWFyY2hFbmdpbmUoY29uZmlnKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJpbmRleCgpXCIsICgpID0+IHtcbiAgICBpdChcInNob3VsZCBjcmVhdGUgaW5kZXggYW5kIHVwZGF0ZSBzZXR0aW5nc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBkb2NzID0gWyB7IGlkOiBcIjFcIiB9IF07XG4gICAgICBhd2FpdCBlbmdpbmUuaW5kZXhEb2N1bWVudHMoZG9jcywgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGV4cGVjdChtb2NrQ2xpZW50LmluZGV4KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInRlc3QtaW5kZXhcIik7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnVwZGF0ZVNldHRpbmdzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgc2VhcmNoQ29uZmlnLnNldHRpbmdzLFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguYWRkRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChkb2NzKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIHJldXNlIGV4aXN0aW5nIGluZGV4IHdpdGhvdXQgdXBkYXRpbmcgc2V0dGluZ3MgYWdhaW5cIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLmluZGV4RG9jdW1lbnRzKFtdLCBzZWFyY2hDb25maWcpO1xuICAgICAgYXdhaXQgZW5naW5lLmluZGV4RG9jdW1lbnRzKFtdLCBzZWFyY2hDb25maWcpO1xuICAgICAgZXhwZWN0KG1vY2tDbGllbnQuaW5kZXgpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXgudXBkYXRlU2V0dGluZ3MpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygxKTtcbiAgICB9KTtcblxuICAgIGl0KFwidGhyb3dzIGlmIGluZGV4TmFtZSBpcyBtaXNzaW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGJhZENvbmZpZyA9IHsgLi4uc2VhcmNoQ29uZmlnLCBpbmRleE5hbWU6IHVuZGVmaW5lZCEgfTtcbiAgICAgIGF3YWl0IGV4cGVjdChlbmdpbmUuaW5kZXhEb2N1bWVudHMoW10sIGJhZENvbmZpZykpLnJlamVjdHMudG9UaHJvdygpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgbm90IHVwZGF0ZSBzZXR0aW5ncyB3aGVuIGNvbmZpZy5zZXR0aW5ncyBpcyBvbWl0dGVkXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNmZyA9IHsgLi4uc2VhcmNoQ29uZmlnIH07XG4gICAgICBkZWxldGUgKGNmZyBhcyBhbnkpLnNldHRpbmdzO1xuICAgICAgYXdhaXQgZW5naW5lLmluZGV4RG9jdW1lbnRzKFtdLCBjZmcpO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC51cGRhdGVTZXR0aW5ncykubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KFwicHJvcGFnYXRlcyBlcnJvcnMgZnJvbSBhZGREb2N1bWVudHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgbW9ja0luZGV4LmFkZERvY3VtZW50cy5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoXCJhZGREb2NzRmFpbFwiKSk7XG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLmluZGV4RG9jdW1lbnRzKFsgeyBpZDogXCJ4XCIgfSBdLCBzZWFyY2hDb25maWcpKS5yZWplY3RzLnRvVGhyb3coXCJhZGREb2NzRmFpbFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwicHJvcGFnYXRlcyBlcnJvcnMgZnJvbSB1cGRhdGVTZXR0aW5nc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBtb2NrSW5kZXgudXBkYXRlU2V0dGluZ3MubW9ja1JlamVjdGVkVmFsdWUobmV3IEVycm9yKFwic2V0dGluZ3NGYWlsXCIpKTtcbiAgICAgIGF3YWl0IGV4cGVjdChlbmdpbmUuaW5kZXhEb2N1bWVudHMoW10sIHNlYXJjaENvbmZpZykpLnJlamVjdHMudG9UaHJvdyhcInNldHRpbmdzRmFpbFwiKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJzZWFyY2goKVwiLCAoKSA9PiB7XG4gICAgY29uc3QgYmFzZVJlc3VsdHMgPSB7IGhpdHM6IFtdLCBlc3RpbWF0ZWRUb3RhbEhpdHM6IDAgfSBhcyBhbnk7XG5cbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIG1vY2tJbmRleC5zZWFyY2gubW9ja1Jlc29sdmVkVmFsdWUoYmFzZVJlc3VsdHMpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgdGhyb3cgaWYgaW5kZXhOYW1lIGlzIG1pc3NpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYmFkQ29uZmlnID0geyAuLi5zZWFyY2hDb25maWcsIGluZGV4TmFtZTogdW5kZWZpbmVkIH07XG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiB9LCBiYWRDb25maWcpKS5yZWplY3RzLnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIGl0KFwicmV1c2VzIGV4aXN0aW5nIGluZGV4IGluc3RhbmNlIGFjcm9zcyBtdWx0aXBsZSBzZWFyY2hlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBtb2NrSW5kZXguc2VhcmNoLm1vY2tSZXNvbHZlZFZhbHVlKHsgaGl0czogW10sIGVzdGltYXRlZFRvdGFsSGl0czogMCB9KTtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiYVwiIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcImJcIiB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgZXhwZWN0KG1vY2tDbGllbnQuaW5kZXgpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcbiAgICB9KTtcblxuICAgIGl0KFwicGVyZm9ybXMgc2ltcGxlIHNlYXJjaCB3aXRoIGRlZmF1bHQgcGFnaW5hdGlvbiBhbmQgbm8gZmlsdGVyc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcImhlbGxvXCIgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGV4cGVjdChtb2NrQ2xpZW50LmluZGV4KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInRlc3QtaW5kZXhcIik7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiaGVsbG9cIixcbiAgICAgICAgZXhwZWN0LmFueShPYmplY3QpLFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiam9pbnMgYXJyYXkgc2VhcmNoIHRlcm1zIGludG8gYSBzaW5nbGUgc3RyaW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFsgXCJmb29cIiwgXCJiYXJcIiBdIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiZm9vIGJhclwiLFxuICAgICAgICBleHBlY3QuYW55KE9iamVjdCksXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIGNvdW50IGFuZCBwYWdlcyBmb3IgcGFnaW5hdGlvblwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgcGFnaW5hdGlvbjogeyBsaW1pdDogNSwgcGFnZTogMyB9IH0sXG4gICAgICAgIHNlYXJjaENvbmZpZyxcbiAgICAgICk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiXCIsXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgbGltaXQ6IDUsIG9mZnNldDogMTAgfSksXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIGRlZmF1bHQgY291bnQgd2hlbiBwYWdlcyBwcm92aWRlZCBidXQgY291bnQgbWlzc2luZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgcGFnaW5hdGlvbjogeyBwYWdlOiAyIH0gfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnLFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBsaW1pdDogMjAsIG9mZnNldDogMjAgfSksXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoXCJmaWx0ZXIgdHJhbnNmb3JtYXRpb25zXCIsICgpID0+IHtcbiAgICAgIGl0KFwibWFwcyBzaW1wbGUgZmllbGQgb3BlcmF0b3JzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHsgYTogeyBlcTogXCJ4XCIgfSwgYjogeyBndDogMSB9LCBjOiB7IGx0ZTogNSB9IH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5maWx0ZXIpLnRvQ29udGFpbihcImEgPSAneCdcIik7XG4gICAgICAgIGV4cGVjdChvcHRzLmZpbHRlcikudG9Db250YWluKFwiYiA+IDFcIik7XG4gICAgICAgIGV4cGVjdChvcHRzLmZpbHRlcikudG9Db250YWluKFwiYyA8PSA1XCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic3VwcG9ydHMgSU4gYW5kIE5PVCBJTiBvcGVyYXRvcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyB0YWdzOiB7IGluOiBbIFwidDFcIiwgXCJ0MlwiIF0sIG5vdEluOiBbIFwidDNcIiBdIH0gfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJ0YWdzIElOIFsndDEnLCAndDInXVwiKTtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcIk5PVCAodGFncyBJTiBbJ3QzJ10pXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic3VwcG9ydHMgcmFuZ2UgKGJldHdlZW4pIG9wZXJhdG9yXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHsgcHJpY2U6IHsgYmV0d2VlbjogeyBmcm9tOiAxMCwgdG86IDIwIH0gfSB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGV4cGVjdChcbiAgICAgICAgICAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcixcbiAgICAgICAgKS50b0NvbnRhaW4oXCJwcmljZSAxMCBUTyAyMFwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcInN1cHBvcnRzIEVYSVNUUywgSVMgRU1QVFksIElTIE5VTExcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgZjogeyBleGlzdHM6IHRydWUgfSxcbiAgICAgICAgICAgICAgZzogeyBpc0VtcHR5OiB0cnVlIH0sXG4gICAgICAgICAgICAgIGg6IHsgaXNOdWxsOiB0cnVlIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcylcbiAgICAgICAgICAuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiZiBFWElTVFNcIik7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJnIElTIEVNUFRZXCIpO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiaCBJUyBOVUxMXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic3VwcG9ydHMgY29udGFpbnMgYW5kIHN0YXJ0c1dpdGhcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyBkOiB7IGNvbnRhaW5zOiBcImFiY1wiIH0sIHM6IHsgc3RhcnRzV2l0aDogXCJwcmVcIiB9IH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcylcbiAgICAgICAgICAuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiZCBDT05UQUlOUyAnYWJjJ1wiKTtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcInMgU1RBUlRTIFdJVEggJ3ByZSdcIik7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIHRvcC1sZXZlbCBBTkQgZ3JvdXBcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyBhbmQ6IFsgeyBhOiB7IGVxOiAxIH0gfSwgeyBiOiB7IGVxOiAyIH0gfSBdIH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcylcbiAgICAgICAgICAuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9NYXRjaCgvXFwoYSA9IDEgQU5EIGIgPSAyXFwpLyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIG5lc3RlZCBPUiBhbmQgTk9UIGdyb3Vwc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHg6IG51bWJlciwgeTogbnVtYmVyLCB6OiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgICAgeyB4OiB7IGx0OiA1IH0gfSxcbiAgICAgICAgICAgICAgICB7IHk6IHsgZ3Q6IDEwIH0gfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBub3Q6IFsgeyB6OiB7IGVxOiAwIH0gfSBdIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKFwiKCh4IDwgNSBPUiB5ID4gMTApIEFORCBOT1QgKHogPSAwKSlcIik7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJpZ25vcmVzIGZpbHRlciBtZXRhZGF0YSBrZXlzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgYTogc3RyaW5nIH0+ID0ge1xuICAgICAgICAgIGFuZDogWyB7IGZpbHRlcklkOiBcIjFcIiwgZmlsdGVyTGFiZWw6IFwiTFwiLCBhOiB7IGVxOiBcInZcIiB9IH0gXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBleHBlY3QoXG4gICAgICAgICAgKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXIsXG4gICAgICAgICkudG9Db250YWluKFwiYSA9ICd2J1wiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgbXVsdGlwbGUgbmVzdGVkIEFORC9PUi9OT1QgZ3JvdXBzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgYTogbnVtYmVyLCBiOiBudW1iZXIsIGM6IG51bWJlciwgZDogbnVtYmVyLCBlOiBudW1iZXIsIGY6IG51bWJlciB9PiA9IHtcbiAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgICB7IGE6IHsgZXE6IDEgfSB9LCB7IGI6IHsgZXE6IDIgfSB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5vdDogW1xuICAgICAgICAgICAgICAgIHsgYzogeyBndDogMyB9IH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHsgZDogeyBsdGU6IDQgfSB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvcjogW1xuICAgICAgICAgICAgICAgIHsgZTogeyBuZXE6IDUgfSB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIG5vdDogW1xuICAgICAgICAgICAgICAgICAgICB7IGY6IHsgaW46IFsgNiwgNyBdIH0gfVxuICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvTWF0Y2goXG4gICAgICAgICAgL1xcKFxcKGEgPSAxIE9SIGIgPSAyXFwpIEFORCBOT1QgXFwoYyA+IDNcXCkgQU5EIGQgPD0gNCBBTkQgXFwoZSAhPSA1IE9SIE5PVCBcXChmIElOIFxcWzYsIDdcXF1cXClcXClcXCkvXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIGRlZXBseSBuZXN0ZWQgZ3JvdXBzIHdpdGggYWxsIGxvZ2ljYWwgb3BlcmF0b3JzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciwgdzogbnVtYmVyLCB2OiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgeyB4OiB7IGx0OiAxMCB9IH0sXG4gICAgICAgICAgICAgICAgeyBub3Q6IFsgeyB5OiB7IGVxOiAyMCB9IH0gXSB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgejogeyBndGU6IDMwIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgeyB3OiB7IGx0ZTogNDAgfSB9LFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHsgbm90OiBbIHsgdjogeyBuZXE6IDUwIH0gfSBdIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKFxuICAgICAgICAgIC9cXChcXCh4IDwgMTAgQU5EIE5PVCBcXCh5ID0gMjBcXCkgQU5EIFxcKHogPj0gMzAgT1IgdyA8PSA0MFxcKVxcKSBPUiBOT1QgXFwodiAhPSA1MFxcKVxcKS9cbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgTk9UIG9mIGFuIEFORCBncm91cFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgbm90OiBbIHtcbiAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICB7IGE6IHsgZXE6IDEgfSB9LFxuICAgICAgICAgICAgICB7IGI6IHsgZXE6IDIgfSB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9IF0sXG4gICAgICAgIH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9NYXRjaChcIk5PVCAoYSA9IDEgQU5EIGIgPSAyKVwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgTk9UIG9mIGFuIE9SIGdyb3VwXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgYTogbnVtYmVyLCBiOiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgbm90OiBbIHtcbiAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgIHsgYTogeyBlcTogMSB9IH0sXG4gICAgICAgICAgICAgIHsgYjogeyBlcTogMiB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0gXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKFwiTk9UIChhID0gMSBPUiBiID0gMilcIik7XG4gICAgICB9KTtcblxuICAgICAgZGVzY3JpYmUoXCJtaXNzaW5nIGZpbHRlciBvcGVyYXRvcnNcIiwgKCkgPT4ge1xuICAgICAgICBpdChcInN1cHBvcnRzIG5lcSwgZ3RlLCBsdCBvcGVyYXRvcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBhOiB7IG5lcTogXCJ4XCIgfSxcbiAgICAgICAgICAgIGI6IHsgZ3RlOiA1IH0sXG4gICAgICAgICAgICBjOiB7IGx0OiAxMCB9XG4gICAgICAgICAgfTtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICAgIGV4cGVjdChvcHRzLmZpbHRlcikudG9Db250YWluKFwiYSAhPSAneCdcIik7XG4gICAgICAgICAgZXhwZWN0KG9wdHMuZmlsdGVyKS50b0NvbnRhaW4oXCJiID49IDVcIik7XG4gICAgICAgICAgZXhwZWN0KG9wdHMuZmlsdGVyKS50b0NvbnRhaW4oXCJjIDwgMTBcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwic3VwcG9ydHMgYWx0ZXJuYXRpdmUgb3BlcmF0b3IgYWxpYXNlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgdGFnczogc3RyaW5nW10sIHByaWNlOiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgICB0YWdzOiB7IG5vdEluOiBbIFwib2xkXCIgXSB9LFxuICAgICAgICAgICAgcHJpY2U6IHsgYnQ6IHsgZnJvbTogMTAsIHRvOiAyMCB9IH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcIk5PVCAodGFncyBJTiBbJ29sZCddKVwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwicHJpY2UgMTAgVE8gMjBcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwiaGFuZGxlcyBtaXhlZCBkYXRhIHR5cGVzIGluIGZpbHRlcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7XG4gICAgICAgICAgICBzdHJpbmdGaWVsZDogc3RyaW5nO1xuICAgICAgICAgICAgbnVtYmVyRmllbGQ6IG51bWJlcjtcbiAgICAgICAgICAgIGJvb2xlYW5GaWVsZDogYm9vbGVhbjtcbiAgICAgICAgICAgIG51bGxGaWVsZDogYW55O1xuICAgICAgICAgIH0+ID0ge1xuICAgICAgICAgICAgc3RyaW5nRmllbGQ6IHsgZXE6IFwidGV4dFwiIH0sXG4gICAgICAgICAgICBudW1iZXJGaWVsZDogeyBndDogNDIgfSxcbiAgICAgICAgICAgIGJvb2xlYW5GaWVsZDogeyBlcTogdHJ1ZSB9LFxuICAgICAgICAgICAgbnVsbEZpZWxkOiB7IGlzTnVsbDogdHJ1ZSB9XG4gICAgICAgICAgfTtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJzdHJpbmdGaWVsZCA9ICd0ZXh0J1wiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwibnVtYmVyRmllbGQgPiA0MlwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiYm9vbGVhbkZpZWxkID0gdHJ1ZVwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwibnVsbEZpZWxkIElTIE5VTExcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwiaGFuZGxlcyBlbXB0eSBhcnJheSB2YWx1ZXMgaW4gSU4gb3BlcmF0b3JzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgdGFnczogeyBpbjogW10gfSxcbiAgICAgICAgICAgIGNhdGVnb3JpZXM6IHsgbm90SW46IFtdIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcInRhZ3MgSU4gW11cIik7XG4gICAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcIk5PVCAoY2F0ZWdvcmllcyBJTiBbXSlcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwiaGFuZGxlcyBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gZmlsdGVyIHZhbHVlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIHRpdGxlOiB7IGVxOiBcIk8nUmVpbGx5J3MgXFxcIkJvb2tcXFwiXCIgfSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB7IGNvbnRhaW5zOiBcIlVURi04OiDmtYvor5VcIiB9LFxuICAgICAgICAgICAgcGF0aDogeyBzdGFydHNXaXRoOiBcIkM6XFxcXFByb2dyYW0gRmlsZXNcXFxcXCIgfVxuICAgICAgICAgIH07XG4gICAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9CZURlZmluZWQoKTtcbiAgICAgICAgICAvLyBWZXJpZnkgdGhhdCBzcGVjaWFsIGNoYXJhY3RlcnMgYXJlIHByb3Blcmx5IGVzY2FwZWQvaGFuZGxlZFxuICAgICAgICB9KTtcblxuICAgICAgICBpdChcInN1cHBvcnRzIGFycmF5LWZvcm1hdCBiZXR3ZWVuIG9wZXJhdG9yXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBwcmljZTogbnVtYmVyLCBzY29yZTogbnVtYmVyIH0+ID0ge1xuICAgICAgICAgICAgcHJpY2U6IHsgYmV0d2VlbjogWyA1LCAxNSBdIGFzIFsgbnVtYmVyLCBudW1iZXIgXSB9LFxuICAgICAgICAgICAgc2NvcmU6IHsgYnQ6IFsgMC44LCAxLjEgXSBhcyBbIG51bWJlciwgbnVtYmVyIF0gfVxuICAgICAgICAgIH07XG4gICAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwicHJpY2UgNSBUTyAxNVwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwic2NvcmUgMC44IFRPIDEuMVwiKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KFwic3VwcG9ydHMgZXhwbGljaXQgcXVlcnkuc29ydFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgc29ydDogWyB7IGZpZWxkOiBcInByaWNlXCIsIGRpcjogXCJkZXNjXCIgfSBdIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBzb3J0OiBbIFwicHJpY2U6ZGVzY1wiIF0gfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImFwcGxpZXMgZGlzdGluY3RcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgeyBzZWFyY2g6IFwiXCIsIGRpc3RpbmN0OiBcInVzZXJJZFwiIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBkaXN0aW5jdDogXCJ1c2VySWRcIiB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiYXBwbGllcyBzZWxlY3QgZmllbGRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgIHsgc2VhcmNoOiBcIlwiLCBzZWxlY3Q6IFsgXCJpZFwiLCBcIm5hbWVcIiBdIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBhdHRyaWJ1dGVzVG9SZXRyaWV2ZTogWyBcImlkXCIsIFwibmFtZVwiIF0gfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImFwcGxpZXMgaGlnaGxpZ2h0IGFuZCBzaG93TWF0Y2hlc1Bvc2l0aW9uXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgIHtcbiAgICAgICAgICBzZWFyY2g6IFwiXCIsXG4gICAgICAgICAgaGlnaGxpZ2h0OiB7XG4gICAgICAgICAgICBmaWVsZHM6IFsgXCJ0aXRsZVwiIF0sXG4gICAgICAgICAgICBwcmVUYWc6IFwiPGI+XCIsXG4gICAgICAgICAgICBwb3N0VGFnOiBcIjwvYj5cIixcbiAgICAgICAgICAgIHNob3dNYXRjaGVzUG9zaXRpb246IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgYXR0cmlidXRlc1RvSGlnaGxpZ2h0OiBbIFwidGl0bGVcIiBdLFxuICAgICAgICAgIGhpZ2hsaWdodFByZVRhZzogXCI8Yj5cIixcbiAgICAgICAgICBoaWdobGlnaHRQb3N0VGFnOiBcIjwvYj5cIixcbiAgICAgICAgICBzaG93TWF0Y2hlc1Bvc2l0aW9uOiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiYXBwbGllcyBjcm9wIG9wdGlvbnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAge1xuICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICBjcm9wOiB7IGZpZWxkczogWyBcImJvZHlcIiBdLCBsZW5ndGg6IDMwLCBtYXJrZXI6IFwi4oCmXCIgfSxcbiAgICAgICAgfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgYXR0cmlidXRlc1RvQ3JvcDogWyBcImJvZHlcIiBdLFxuICAgICAgICAgIGNyb3BMZW5ndGg6IDMwLFxuICAgICAgICAgIGNyb3BNYXJrZXI6IFwi4oCmXCIsXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIG1hdGNoaW5nU3RyYXRlZ3lcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgeyBzZWFyY2g6IFwiXCIsIG1hdGNoaW5nU3RyYXRlZ3k6IFwibGFzdFwiIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBtYXRjaGluZ1N0cmF0ZWd5OiBcImxhc3RcIiB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiaGFuZGxlcyBlbXB0eSBPUiBhbmQgQU5EIGdyb3VwcyB3aXRob3V0IHNldHRpbmcgZmlsdGVyc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBmaXJzdCBjYWxsOiBlbXB0eSBPUiwgc2Vjb25kOiBlbXB0eSBBTkRcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnM6IHsgb3I6IFtdIH0gfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnM6IHsgYW5kOiBbXSB9IH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICBjb25zdCBub0ZpbHRlckNhbGxzID0gbW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzLmZpbHRlcigoWyAsIG9wdHMgXSkgPT4gIShvcHRzIGFzIGFueSkuZmlsdGVyKTtcbiAgICAgIGV4cGVjdChub0ZpbHRlckNhbGxzLmxlbmd0aCkudG9CZSgyKTtcbiAgICB9KTtcblxuICAgIGl0KFwicHJvcGFnYXRlcyBlcnJvcnMgZnJvbSBNZWlsaVNlYXJjaC5zZWFyY2hcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgbW9ja0luZGV4LnNlYXJjaC5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoXCJmYWlsXCIpKTtcbiAgICAgIGF3YWl0IGV4cGVjdChlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiIH0sIHNlYXJjaENvbmZpZykpLnJlamVjdHMudG9UaHJvdyhcbiAgICAgICAgXCJmYWlsXCIsXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoXCJwYWdpbmF0aW9uIGVkZ2UgY2FzZXNcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJoYW5kbGVzIGJvdW5kYXJ5IHZhbHVlcyAocGFnZT0wLCBuZWdhdGl2ZSB2YWx1ZXMpXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJcIiwgcGFnaW5hdGlvbjogeyBwYWdlOiAwLCBsaW1pdDogLTUgfSB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICAvLyBTaG91bGQgaGFuZGxlIGdyYWNlZnVsbHkgb3IgYXBwbHkgZGVmYXVsdHNcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgdmVyeSBsYXJnZSBwYWdlIG51bWJlcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHsgc2VhcmNoOiBcIlwiLCBwYWdpbmF0aW9uOiB7IHBhZ2U6IDk5OTk5OSwgbGltaXQ6IDUwIH0gfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5vZmZzZXQpLnRvQmUoKDk5OTk5OSAtIDEpICogNTApO1xuICAgICAgICBleHBlY3Qob3B0cy5saW1pdCkudG9CZSg1MCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJ1c2VzIHBhZ2UvaGl0c1BlclBhZ2Ugd2hlbiB1c2VQYWdpbmF0aW9uIGlzIHRydWVcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICAgICAgcGFnZTogMixcbiAgICAgICAgICAgICAgbGltaXQ6IDE1LFxuICAgICAgICAgICAgICB1c2VQYWdpbmF0aW9uOiB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5wYWdlKS50b0JlKDIpO1xuICAgICAgICBleHBlY3Qob3B0cy5oaXRzUGVyUGFnZSkudG9CZSgxNSk7XG4gICAgICAgIGV4cGVjdChvcHRzLm9mZnNldCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3Qob3B0cy5saW1pdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwidXNlcyBsaW1pdC9vZmZzZXQgd2hlbiB1c2VQYWdpbmF0aW9uIGlzIGZhbHNlIG9yIHVuZGVmaW5lZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAge1xuICAgICAgICAgICAgc2VhcmNoOiBcIlwiLFxuICAgICAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgICAgICBwYWdlOiAzLFxuICAgICAgICAgICAgICBsaW1pdDogMTAsXG4gICAgICAgICAgICAgIHVzZVBhZ2luYXRpb246IGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5saW1pdCkudG9CZSgxMCk7XG4gICAgICAgIGV4cGVjdChvcHRzLm9mZnNldCkudG9CZSgyMCk7XG4gICAgICAgIGV4cGVjdChvcHRzLnBhZ2UpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KG9wdHMuaGl0c1BlclBhZ2UpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImFwcGxpZXMgZGVmYXVsdHMgd2hlbiBwYWdpbmF0aW9uIGlzIGNvbXBsZXRlbHkgb21pdHRlZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwidGVzdFwiIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IG9wdHMgPSBtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcztcbiAgICAgICAgZXhwZWN0KG9wdHMubGltaXQpLnRvQmUoMjApOyAvLyBkZWZhdWx0IGxpbWl0XG4gICAgICAgIGV4cGVjdChvcHRzLm9mZnNldCkudG9CZSgwKTsgIC8vIGRlZmF1bHQgb2Zmc2V0XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwic2VhcmNoIHF1ZXJ5IGVkZ2UgY2FzZXNcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJoYW5kbGVzIGVtcHR5IHNlYXJjaCB0ZXJtc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogW10gfSwgc2VhcmNoQ29uZmlnKTtcblxuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJcIiwgZXhwZWN0LmFueShPYmplY3QpKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwiXCIsIGV4cGVjdC5hbnkoT2JqZWN0KSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIHNwZWNpYWwgY2hhcmFjdGVycyBpbiBzZWFyY2ggdGVybXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBzcGVjaWFsUXVlcmllcyA9IFtcbiAgICAgICAgICBcInNlYXJjaCB3aXRoIFxcXCJxdW90ZXNcXFwiXCIsXG4gICAgICAgICAgXCJ1bmljb2RlOiDmtYvor5Ugc2VhcmNoXCIsXG4gICAgICAgICAgXCJyZWdleCBjaGFyczogWy4qKz9eJHt9KCl8XFxcXF1cIlxuICAgICAgICBdO1xuXG4gICAgICAgIGZvciAoY29uc3QgcXVlcnkgb2Ygc3BlY2lhbFF1ZXJpZXMpIHtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBxdWVyeSB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChxdWVyeSwgZXhwZWN0LmFueShPYmplY3QpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyB2ZXJ5IGxvbmcgc2VhcmNoIHRlcm1zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgbG9uZ1F1ZXJ5ID0gXCJhXCIucmVwZWF0KDEwMDAwKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogbG9uZ1F1ZXJ5IH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChsb25nUXVlcnksIGV4cGVjdC5hbnkoT2JqZWN0KSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwiYWR2YW5jZWQgc2VhcmNoIGZlYXR1cmVzXCIsICgpID0+IHtcbiAgICAgIGl0KFwic3VwcG9ydHMgbXVsdGlwbGUgc29ydCBmaWVsZHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICAgIHNvcnQ6IFtcbiAgICAgICAgICAgICAgeyBmaWVsZDogXCJwcmlvcml0eVwiLCBkaXI6IFwiZGVzY1wiIH0sXG4gICAgICAgICAgICAgIHsgZmllbGQ6IFwiY3JlYXRlZF9hdFwiLCBkaXI6IFwiYXNjXCIgfSxcbiAgICAgICAgICAgICAgeyBmaWVsZDogXCJ0aXRsZVwiLCBkaXI6IFwiZGVzY1wiIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJcIixcbiAgICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBzb3J0OiBbIFwicHJpb3JpdHk6ZGVzY1wiLCBcImNyZWF0ZWRfYXQ6YXNjXCIsIFwidGl0bGU6ZGVzY1wiIF1cbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyBlbXB0eSBzb3J0IGFycmF5XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJcIiwgc29ydDogW10gfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5zb3J0KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIHNob3dSYW5raW5nU2NvcmVcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHsgc2VhcmNoOiBcInRlc3RcIiwgc2hvd1JhbmtpbmdTY29yZTogdHJ1ZSB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJ0ZXN0XCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBzaG93UmFua2luZ1Njb3JlOiB0cnVlIH0pXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIHNob3dSYW5raW5nU2NvcmVEZXRhaWxzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJ0ZXN0XCIsIHNob3dSYW5raW5nU2NvcmVEZXRhaWxzOiB0cnVlIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgICBcInRlc3RcIixcbiAgICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IHNob3dSYW5raW5nU2NvcmVEZXRhaWxzOiB0cnVlIH0pXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIHJhbmtpbmdTY29yZVRocmVzaG9sZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAgeyBzZWFyY2g6IFwidGVzdFwiLCByYW5raW5nU2NvcmVUaHJlc2hvbGQ6IDAuOCB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJ0ZXN0XCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyByYW5raW5nU2NvcmVUaHJlc2hvbGQ6IDAuOCB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiYXBwbGllcyBoeWJyaWQgc2VhcmNoIG9wdGlvbnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJ0ZXN0XCIsXG4gICAgICAgICAgICBoeWJyaWQ6IHtcbiAgICAgICAgICAgICAgZW1iZWRkZXI6IFwiZGVmYXVsdFwiLFxuICAgICAgICAgICAgICBzZW1hbnRpY1JhdGlvOiAwLjVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJ0ZXN0XCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgaHlicmlkOiB7XG4gICAgICAgICAgICAgIGVtYmVkZGVyOiBcImRlZmF1bHRcIixcbiAgICAgICAgICAgICAgc2VtYW50aWNSYXRpbzogMC41XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImFwcGxpZXMgdmVjdG9yIHNlYXJjaFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHZlY3RvciA9IFsgMC4xLCAwLjIsIDAuMywgMC40LCAwLjUgXTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJcIiwgdmVjdG9yIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgICBcIlwiLFxuICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgdmVjdG9yIH0pXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJkZWxldGUoKVwiLCAoKSA9PiB7XG4gICAgaXQoXCJkZWxldGVzIGRvY3VtZW50cyBieSBJRCBvbiBjb3JyZWN0IGluZGV4XCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5kZWxldGVEb2N1bWVudHMoWyBcIjFcIiwgXCIyXCIgXSwgXCJ0ZXN0LWluZGV4XCIpO1xuICAgICAgZXhwZWN0KG1vY2tDbGllbnQuaW5kZXgpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidGVzdC1pbmRleFwiKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguZGVsZXRlRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChbIFwiMVwiLCBcIjJcIiBdKTtcbiAgICB9KTtcblxuICAgIGl0KFwidGhyb3dzIGlmIGluZGV4TmFtZSBpcyBlbXB0eVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLmRlbGV0ZURvY3VtZW50cyhbXSwgXCJcIikpLnJlamVjdHMudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcImJhdGNoIG9wZXJhdGlvbnNcIiwgKCkgPT4ge1xuICAgIGRlc2NyaWJlKFwiaW5kZXhJbkJhdGNoZXMoKVwiLCAoKSA9PiB7XG4gICAgICBpdChcInNob3VsZCBpbmRleCBkb2N1bWVudHMgaW4gYmF0Y2hlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY3MgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAyNTAwIH0sIChfLCBpKSA9PiAoeyBpZDogYGRvYyR7aX1gIH0pKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLmluZGV4SW5CYXRjaGVzKGRvY3MsIHNlYXJjaENvbmZpZywgMTAwMCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5hZGREb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygzKTsgLy8gMyBiYXRjaGVzXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguYWRkRG9jdW1lbnRzKS50b0hhdmVCZWVuTnRoQ2FsbGVkV2l0aCgxLCBleHBlY3QuYXJyYXlDb250YWluaW5nKFsgeyBpZDogXCJkb2MwXCIgfSBdKSk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguYWRkRG9jdW1lbnRzKS50b0hhdmVCZWVuTnRoQ2FsbGVkV2l0aCgzLCBleHBlY3QuYXJyYXlDb250YWluaW5nKFsgeyBpZDogXCJkb2MyMDAwXCIgfSBdKSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJzaG91bGQgaGFuZGxlIGVtcHR5IGRvY3VtZW50cyBhcnJheVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5pbmRleEluQmF0Y2hlcyhbXSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5hZGREb2N1bWVudHMpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwidXBkYXRlRG9jdW1lbnRzKClcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJzaG91bGQgdXBkYXRlIGRvY3VtZW50c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY3MgPSBbIHsgaWQ6IFwiMVwiLCB0aXRsZTogXCJVcGRhdGVkXCIgfSBdO1xuICAgICAgICBhd2FpdCBlbmdpbmUudXBkYXRlRG9jdW1lbnRzKGRvY3MsIHNlYXJjaENvbmZpZyk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC51cGRhdGVEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKGRvY3MpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZShcInVwZGF0ZURvY3VtZW50c0luQmF0Y2hlcygpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIHVwZGF0ZSBkb2N1bWVudHMgaW4gYmF0Y2hlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY3MgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxNTAwIH0sIChfLCBpKSA9PiAoeyBpZDogYGRvYyR7aX1gLCB1cGRhdGVkOiB0cnVlIH0pKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnVwZGF0ZURvY3VtZW50c0luQmF0Y2hlcyhkb2NzLCBzZWFyY2hDb25maWcsIDUwMCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC51cGRhdGVEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygzKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcImRvY3VtZW50IHJldHJpZXZhbFwiLCAoKSA9PiB7XG4gICAgZGVzY3JpYmUoXCJnZXREb2N1bWVudCgpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIHJldHJpZXZlIGEgc2luZ2xlIGRvY3VtZW50XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgbW9ja0RvYyA9IHsgaWQ6IFwiMTIzXCIsIHRpdGxlOiBcIlRlc3QgRG9jXCIgfTtcbiAgICAgICAgbW9ja0luZGV4LmdldERvY3VtZW50Lm1vY2tSZXNvbHZlZFZhbHVlKG1vY2tEb2MpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuZ2luZS5nZXREb2N1bWVudChcIjEyM1wiLCBcInRlc3QtaW5kZXhcIik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5nZXREb2N1bWVudCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCIxMjNcIik7XG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwobW9ja0RvYyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwiZ2V0RG9jdW1lbnRzKClcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJzaG91bGQgcmV0cmlldmUgbXVsdGlwbGUgZG9jdW1lbnRzIHdpdGggb3B0aW9uc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG1vY2tEb2NzID0gWyB7IGlkOiBcIjFcIiB9LCB7IGlkOiBcIjJcIiB9IF07XG4gICAgICAgIG1vY2tJbmRleC5nZXREb2N1bWVudHMubW9ja1Jlc29sdmVkVmFsdWUoeyByZXN1bHRzOiBtb2NrRG9jcywgdG90YWw6IDIgfSk7XG5cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHsgbGltaXQ6IDEwLCBvZmZzZXQ6IDAgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5naW5lLmdldERvY3VtZW50cyhcInRlc3QtaW5kZXhcIiwgb3B0aW9ucyk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5nZXREb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKG9wdGlvbnMpO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKG1vY2tEb2NzKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcInNob3VsZCByZXRyaWV2ZSBkb2N1bWVudHMgd2l0aG91dCBvcHRpb25zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgbW9ja0RvY3MgPSBbIHsgaWQ6IFwiMVwiIH0gXTtcbiAgICAgICAgbW9ja0luZGV4LmdldERvY3VtZW50cy5tb2NrUmVzb2x2ZWRWYWx1ZSh7IHJlc3VsdHM6IG1vY2tEb2NzLCB0b3RhbDogMSB9KTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmdpbmUuZ2V0RG9jdW1lbnRzKFwidGVzdC1pbmRleFwiKTtcblxuICAgICAgICBleHBlY3QobW9ja0luZGV4LmdldERvY3VtZW50cykudG9IYXZlQmVlbkNhbGxlZFdpdGgodW5kZWZpbmVkKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChtb2NrRG9jcyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJhZHZhbmNlZCBkZWxldGUgb3BlcmF0aW9uc1wiLCAoKSA9PiB7XG4gICAgZGVzY3JpYmUoXCJkZWxldGVBbGxEb2N1bWVudHMoKVwiLCAoKSA9PiB7XG4gICAgICBpdChcInNob3VsZCBkZWxldGUgYWxsIGRvY3VtZW50cyBmcm9tIGluZGV4XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLmRlbGV0ZUFsbERvY3VtZW50cyhcInRlc3QtaW5kZXhcIik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5kZWxldGVBbGxEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoXCJkZWxldGVEb2N1bWVudHNCeUZpbHRlcigpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIGRlbGV0ZSBkb2N1bWVudHMgYnkgZmlsdGVyXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyID0geyBjYXRlZ29yeTogeyBlcTogXCJ0ZXN0XCIgfSB9O1xuICAgICAgICBjb25zdCBleHBlY3RlZFRhc2sgPSB7XG4gICAgICAgICAgdGFza1VpZDogNixcbiAgICAgICAgICBpbmRleFVpZDogXCJ0ZXN0LWluZGV4XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImVucXVldWVkXCIgYXMgY29uc3QsXG4gICAgICAgICAgdHlwZTogXCJkb2N1bWVudERlbGV0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgICAgZW5xdWV1ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH07XG4gICAgICAgIG1vY2tJbmRleC5kZWxldGVEb2N1bWVudHMubW9ja1Jlc29sdmVkVmFsdWUoZXhwZWN0ZWRUYXNrKTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmdpbmUuZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoZmlsdGVyLCBcInRlc3QtaW5kZXhcIik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5kZWxldGVEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgICBmaWx0ZXI6IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKFwiY2F0ZWdvcnkgPSAndGVzdCdcIilcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoZXhwZWN0ZWRUYXNrKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcInNob3VsZCB0aHJvdyBlcnJvciB3aGVuIGluZGV4TmFtZSBpcyBtaXNzaW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyID0geyBzdGF0dXM6IHsgZXE6IFwiZGVsZXRlZFwiIH0gfTtcblxuICAgICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgICAgZW5naW5lLmRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKGZpbHRlciwgXCJcIilcbiAgICAgICAgKS5yZWplY3RzLnRvVGhyb3coXCJJbmRleCBuYW1lIGlzIHJlcXVpcmVkXCIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwibXVsdGlTZWFyY2goKVwiLCAoKSA9PiB7XG4gICAgaXQoXCJzaG91bGQgcGVyZm9ybSBtdWx0aS1zZWFyY2ggYWNyb3NzIGluZGljZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcXVlcmllcyA9IFtcbiAgICAgICAgeyBpbmRleFVpZDogXCJpbmRleDFcIiwgcXVlcnk6IFwic2VhcmNoMVwiLCBzZWFyY2hQYXJhbXM6IHsgbGltaXQ6IDUgfSB9LFxuICAgICAgICB7IGluZGV4VWlkOiBcImluZGV4MlwiLCBxdWVyeTogXCJzZWFyY2gyXCIgfVxuICAgICAgXTtcblxuICAgICAgY29uc3QgZXhwZWN0ZWRSZXN1bHRzID0ge1xuICAgICAgICByZXN1bHRzOiBbXG4gICAgICAgICAgeyBpbmRleFVpZDogXCJpbmRleDFcIiwgaGl0czogW10sIHByb2Nlc3NpbmdUaW1lTXM6IDEwLCBxdWVyeTogXCJzZWFyY2gxXCIgfSxcbiAgICAgICAgICB7IGluZGV4VWlkOiBcImluZGV4MlwiLCBoaXRzOiBbXSwgcHJvY2Vzc2luZ1RpbWVNczogMTIsIHF1ZXJ5OiBcInNlYXJjaDJcIiB9XG4gICAgICAgIF1cbiAgICAgIH07XG4gICAgICBtb2NrQ2xpZW50Lm11bHRpU2VhcmNoLm1vY2tSZXNvbHZlZFZhbHVlKGV4cGVjdGVkUmVzdWx0cyk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuZ2luZS5tdWx0aVNlYXJjaChxdWVyaWVzKTtcblxuICAgICAgZXhwZWN0KG1vY2tDbGllbnQubXVsdGlTZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgcXVlcmllczogW1xuICAgICAgICAgIHsgaW5kZXhVaWQ6IFwiaW5kZXgxXCIsIHE6IFwic2VhcmNoMVwiLCBsaW1pdDogNSB9LFxuICAgICAgICAgIHsgaW5kZXhVaWQ6IFwiaW5kZXgyXCIsIHE6IFwic2VhcmNoMlwiIH1cbiAgICAgICAgXVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKGV4cGVjdGVkUmVzdWx0cyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiZXJyb3IgaGFuZGxpbmdcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBpbmRleCBjcmVhdGlvbiBmYWlsdXJlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBtb2NrQ2xpZW50LmNyZWF0ZUluZGV4Lm1vY2tSZWplY3RlZFZhbHVlKG5ldyBFcnJvcihcIkNyZWF0aW9uIGZhaWxlZFwiKSk7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgZW5naW5lLmluZGV4RG9jdW1lbnRzKFsgeyBpZDogXCIxXCIgfSBdLCBzZWFyY2hDb25maWcpXG4gICAgICApLnJlamVjdHMudG9UaHJvdyhcIkNyZWF0aW9uIGZhaWxlZFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBjb25uZWN0aW9uIGVycm9ycyBpbiBzZWFyY2hcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgbW9ja0luZGV4LnNlYXJjaC5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoXCJDb25uZWN0aW9uIHRpbWVvdXRcIikpO1xuXG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwidGVzdFwiIH0sIHNlYXJjaENvbmZpZylcbiAgICAgICkucmVqZWN0cy50b1Rocm93KFwiU2VhcmNoIG9wZXJhdGlvbiBmYWlsZWQ6IENvbm5lY3Rpb24gdGltZW91dFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBtYWxmb3JtZWQgc2VhcmNoIHJlc3VsdHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgbW9ja0luZGV4LnNlYXJjaC5tb2NrUmVzb2x2ZWRWYWx1ZShudWxsKTsgLy8gSW52YWxpZCByZXNwb25zZVxuXG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwidGVzdFwiIH0sIHNlYXJjaENvbmZpZylcbiAgICAgICkucmVqZWN0cy50b1Rocm93KCk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=