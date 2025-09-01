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
        // Helper function to create mock EnqueuedTaskPromise
        const createMockEnqueuedTaskPromise = (taskUid) => {
            const mockPromise = Promise.resolve({ taskUid });
            mockPromise.waitTask = jest.fn().mockResolvedValue({ taskUid });
            return mockPromise;
        };
        mockIndex = {
            addDocuments: jest.fn().mockReturnValue(createMockEnqueuedTaskPromise(1)),
            search: jest.fn(),
            deleteDocuments: jest.fn().mockReturnValue(createMockEnqueuedTaskPromise(1)),
            updateSettings: jest.fn().mockReturnValue(createMockEnqueuedTaskPromise(1)),
            updateDocuments: jest.fn().mockReturnValue(createMockEnqueuedTaskPromise(2)),
            getDocument: jest.fn(),
            getDocuments: jest.fn(),
            deleteAllDocuments: jest.fn().mockReturnValue(createMockEnqueuedTaskPromise(3)),
            getStats: jest.fn(),
        };
        // Default mock for createIndex - returns a promise with waitTask method
        const defaultMockPromise = Promise.resolve(undefined);
        defaultMockPromise.waitTask = jest.fn().mockResolvedValue(undefined);
        mockClient = {
            index: jest.fn().mockReturnValue(mockIndex),
            createIndex: jest.fn().mockReturnValue(defaultMockPromise),
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
            // Mock addDocuments to throw an error when called
            mockIndex.addDocuments.mockImplementation(() => {
                throw new Error("addDocsFail");
            });
            await expect(engine.indexDocuments([{ id: "x" }], searchConfig)).rejects.toThrow("addDocsFail");
        });
        it("propagates errors from updateSettings", async () => {
            // Mock updateSettings to throw an error when called
            mockIndex.updateSettings.mockImplementation(() => {
                throw new Error("settingsFail");
            });
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
            // Mock search to throw an error when called
            mockIndex.search.mockImplementation(() => {
                throw new Error("fail");
            });
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
            // Mock createIndex to return a promise with waitTask that rejects
            const mockPromise = Promise.resolve(undefined);
            mockPromise.waitTask = jest.fn().mockRejectedValue(new Error("Creation failed"));
            mockClient.createIndex.mockReturnValue(mockPromise);
            await expect(engine.indexDocuments([{ id: "1" }], searchConfig)).rejects.toThrow("Creation failed");
        });
        it("should handle connection errors in search", async () => {
            // Mock search to throw an error when called
            mockIndex.search.mockImplementation(() => {
                throw new Error("Connection timeout");
            });
            await expect(engine.search({ search: "test" }, searchConfig)).rejects.toThrow("Search operation failed: Connection timeout");
        });
        it("should handle malformed search results", async () => {
            mockIndex.search.mockResolvedValue(null); // Invalid response
            await expect(engine.search({ search: "test" }, searchConfig)).rejects.toThrow();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL2VuZ2luZXMvbWVpbGkvZW5naW5lLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxQ0FBOEU7QUFFOUUsNkNBQTZFO0FBRzdFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7QUFFekIsUUFBUSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRTtJQUNqQyxJQUFJLE1BQXlCLENBQUM7SUFDOUIsSUFBSSxVQUFvQyxDQUFDO0lBQ3pDLElBQUksU0FBNkIsQ0FBQztJQUNsQyxJQUFJLE1BQXVDLENBQUM7SUFDNUMsSUFBSSxZQUErQixDQUFDO0lBRXBDLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFFckIscURBQXFEO1FBQ3JELE1BQU0sNkJBQTZCLEdBQUcsQ0FBQyxPQUFlLEVBQUUsRUFBRTtZQUN4RCxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxFQUFFLENBQVEsQ0FBQztZQUN4RCxXQUFXLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFDaEUsT0FBTyxXQUFXLENBQUM7UUFDckIsQ0FBQyxDQUFDO1FBRUYsU0FBUyxHQUFHO1lBQ1YsWUFBWSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxlQUFlLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDekUsTUFBTSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7WUFDakIsZUFBZSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxlQUFlLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDNUUsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFF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O1lBQ3RELFNBQVMsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxtQkFBbUI7WUFFN0QsTUFBTSxNQUFNLENBQ1YsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsRUFBRSxZQUFZLENBQUMsQ0FDaEQsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDdEIsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTWVpbGlTZWFyY2hFbmdpbmUsIEV4dGVuZGVkTWVpbGlTZWFyY2hDbGllbnRDb25maWcgfSBmcm9tIFwiLi9lbmdpbmVcIjtcbmltcG9ydCB7IFNlYXJjaEluZGV4Q29uZmlnIH0gZnJvbSBcIi4uLy4uL3R5cGVzXCI7XG5pbXBvcnQgeyBNZWlsaVNlYXJjaCwgSW5kZXgsIFNlYXJjaFBhcmFtcywgRW5xdWV1ZWRUYXNrIH0gZnJvbSBcIm1laWxpc2VhcmNoXCI7XG5pbXBvcnQgeyBHZW5lcmljRmlsdGVyQ3JpdGVyaWEgfSBmcm9tIFwiLi4vLi4vLi4vZW50aXR5L3F1ZXJ5LXR5cGVzXCI7XG5cbmplc3QubW9jayhcIm1laWxpc2VhcmNoXCIpO1xuXG5kZXNjcmliZShcIk1laWxpU2VhcmNoRW5naW5lXCIsICgpID0+IHtcbiAgbGV0IGVuZ2luZTogTWVpbGlTZWFyY2hFbmdpbmU7XG4gIGxldCBtb2NrQ2xpZW50OiBqZXN0Lk1vY2tlZDxNZWlsaVNlYXJjaD47XG4gIGxldCBtb2NrSW5kZXg6IGplc3QuTW9ja2VkPEluZGV4PjtcbiAgbGV0IGNvbmZpZzogRXh0ZW5kZWRNZWlsaVNlYXJjaENsaWVudENvbmZpZztcbiAgbGV0IHNlYXJjaENvbmZpZzogU2VhcmNoSW5kZXhDb25maWc7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG5cbiAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG1vY2sgRW5xdWV1ZWRUYXNrUHJvbWlzZVxuICAgIGNvbnN0IGNyZWF0ZU1vY2tFbnF1ZXVlZFRhc2tQcm9taXNlID0gKHRhc2tVaWQ6IG51bWJlcikgPT4ge1xuICAgICAgY29uc3QgbW9ja1Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUoeyB0YXNrVWlkIH0pIGFzIGFueTtcbiAgICAgIG1vY2tQcm9taXNlLndhaXRUYXNrID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHsgdGFza1VpZCB9KTtcbiAgICAgIHJldHVybiBtb2NrUHJvbWlzZTtcbiAgICB9O1xuXG4gICAgbW9ja0luZGV4ID0ge1xuICAgICAgYWRkRG9jdW1lbnRzOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGNyZWF0ZU1vY2tFbnF1ZXVlZFRhc2tQcm9taXNlKDEpKSxcbiAgICAgIHNlYXJjaDogamVzdC5mbigpLFxuICAgICAgZGVsZXRlRG9jdW1lbnRzOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGNyZWF0ZU1vY2tFbnF1ZXVlZFRhc2tQcm9taXNlKDEpKSxcbiAgICAgIHVwZGF0ZVNldHRpbmdzOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGNyZWF0ZU1vY2tFbnF1ZXVlZFRhc2tQcm9taXNlKDEpKSxcbiAgICAgIHVwZGF0ZURvY3VtZW50czogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShjcmVhdGVNb2NrRW5xdWV1ZWRUYXNrUHJvbWlzZSgyKSksXG4gICAgICBnZXREb2N1bWVudDogamVzdC5mbigpLFxuICAgICAgZ2V0RG9jdW1lbnRzOiBqZXN0LmZuKCksXG4gICAgICBkZWxldGVBbGxEb2N1bWVudHM6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoY3JlYXRlTW9ja0VucXVldWVkVGFza1Byb21pc2UoMykpLFxuICAgICAgZ2V0U3RhdHM6IGplc3QuZm4oKSxcbiAgICB9IGFzIFBhcnRpYWw8SW5kZXg+IGFzIGplc3QuTW9ja2VkPEluZGV4PjtcblxuICAgIC8vIERlZmF1bHQgbW9jayBmb3IgY3JlYXRlSW5kZXggLSByZXR1cm5zIGEgcHJvbWlzZSB3aXRoIHdhaXRUYXNrIG1ldGhvZFxuICAgIGNvbnN0IGRlZmF1bHRNb2NrUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpIGFzIGFueTtcbiAgICBkZWZhdWx0TW9ja1Byb21pc2Uud2FpdFRhc2sgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKTtcblxuICAgIG1vY2tDbGllbnQgPSB7XG4gICAgICBpbmRleDogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShtb2NrSW5kZXgpLFxuICAgICAgY3JlYXRlSW5kZXg6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoZGVmYXVsdE1vY2tQcm9taXNlKSxcbiAgICAgIG11bHRpU2VhcmNoOiBqZXN0LmZuKCksXG4gICAgICBnZXRUYXNrOiBqZXN0LmZuKCksXG4gICAgfSBhcyBQYXJ0aWFsPE1laWxpU2VhcmNoPiBhcyBqZXN0Lk1vY2tlZDxNZWlsaVNlYXJjaD47XG5cbiAgICAoTWVpbGlTZWFyY2ggYXMgamVzdC5Nb2NrKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gbW9ja0NsaWVudCk7XG5cbiAgICBjb25maWcgPSB7IGhvc3Q6IFwiaHR0cDovL2xvY2FsaG9zdDo3NzAwXCIsIGFwaUtleTogXCJrZXlcIiB9O1xuICAgIHNlYXJjaENvbmZpZyA9IHtcbiAgICAgIGluZGV4TmFtZTogXCJ0ZXN0LWluZGV4XCIsXG4gICAgICBzZXR0aW5nczoge1xuICAgICAgICBzZWFyY2hhYmxlQXR0cmlidXRlczogWyBcInRpdGxlXCIgXSxcbiAgICAgICAgZmlsdGVyYWJsZUF0dHJpYnV0ZXM6IFsgXCJjYXRlZ29yeVwiIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgZW5naW5lID0gbmV3IE1laWxpU2VhcmNoRW5naW5lKGNvbmZpZyk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiaW5kZXgoKVwiLCAoKSA9PiB7XG4gICAgaXQoXCJzaG91bGQgY3JlYXRlIGluZGV4IGFuZCB1cGRhdGUgc2V0dGluZ3NcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZG9jcyA9IFsgeyBpZDogXCIxXCIgfSBdO1xuICAgICAgYXdhaXQgZW5naW5lLmluZGV4RG9jdW1lbnRzKGRvY3MsIHNlYXJjaENvbmZpZyk7XG4gICAgICBleHBlY3QobW9ja0NsaWVudC5pbmRleCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ0ZXN0LWluZGV4XCIpO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC51cGRhdGVTZXR0aW5ncykudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIHNlYXJjaENvbmZpZy5zZXR0aW5ncyxcbiAgICAgICk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LmFkZERvY3VtZW50cykudG9IYXZlQmVlbkNhbGxlZFdpdGgoZG9jcyk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCByZXVzZSBleGlzdGluZyBpbmRleCB3aXRob3V0IHVwZGF0aW5nIHNldHRpbmdzIGFnYWluXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5pbmRleERvY3VtZW50cyhbXSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGF3YWl0IGVuZ2luZS5pbmRleERvY3VtZW50cyhbXSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGV4cGVjdChtb2NrQ2xpZW50LmluZGV4KS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMik7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnVwZGF0ZVNldHRpbmdzKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XG4gICAgfSk7XG5cbiAgICBpdChcInRocm93cyBpZiBpbmRleE5hbWUgaXMgbWlzc2luZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBiYWRDb25maWcgPSB7IC4uLnNlYXJjaENvbmZpZywgaW5kZXhOYW1lOiB1bmRlZmluZWQhIH07XG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLmluZGV4RG9jdW1lbnRzKFtdLCBiYWRDb25maWcpKS5yZWplY3RzLnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIG5vdCB1cGRhdGUgc2V0dGluZ3Mgd2hlbiBjb25maWcuc2V0dGluZ3MgaXMgb21pdHRlZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjZmcgPSB7IC4uLnNlYXJjaENvbmZpZyB9O1xuICAgICAgZGVsZXRlIChjZmcgYXMgYW55KS5zZXR0aW5ncztcbiAgICAgIGF3YWl0IGVuZ2luZS5pbmRleERvY3VtZW50cyhbXSwgY2ZnKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXgudXBkYXRlU2V0dGluZ3MpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgfSk7XG5cbiAgICBpdChcInByb3BhZ2F0ZXMgZXJyb3JzIGZyb20gYWRkRG9jdW1lbnRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE1vY2sgYWRkRG9jdW1lbnRzIHRvIHRocm93IGFuIGVycm9yIHdoZW4gY2FsbGVkXG4gICAgICBtb2NrSW5kZXguYWRkRG9jdW1lbnRzLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcImFkZERvY3NGYWlsXCIpO1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGF3YWl0IGV4cGVjdChlbmdpbmUuaW5kZXhEb2N1bWVudHMoWyB7IGlkOiBcInhcIiB9IF0sIHNlYXJjaENvbmZpZykpLnJlamVjdHMudG9UaHJvdyhcImFkZERvY3NGYWlsXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJwcm9wYWdhdGVzIGVycm9ycyBmcm9tIHVwZGF0ZVNldHRpbmdzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE1vY2sgdXBkYXRlU2V0dGluZ3MgdG8gdGhyb3cgYW4gZXJyb3Igd2hlbiBjYWxsZWRcbiAgICAgIG1vY2tJbmRleC51cGRhdGVTZXR0aW5ncy5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4ge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzZXR0aW5nc0ZhaWxcIik7XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgYXdhaXQgZXhwZWN0KGVuZ2luZS5pbmRleERvY3VtZW50cyhbXSwgc2VhcmNoQ29uZmlnKSkucmVqZWN0cy50b1Rocm93KFwic2V0dGluZ3NGYWlsXCIpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcInNlYXJjaCgpXCIsICgpID0+IHtcbiAgICBjb25zdCBiYXNlUmVzdWx0cyA9IHsgaGl0czogW10sIGVzdGltYXRlZFRvdGFsSGl0czogMCB9IGFzIGFueTtcblxuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgbW9ja0luZGV4LnNlYXJjaC5tb2NrUmVzb2x2ZWRWYWx1ZShiYXNlUmVzdWx0cyk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCB0aHJvdyBpZiBpbmRleE5hbWUgaXMgbWlzc2luZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBiYWRDb25maWcgPSB7IC4uLnNlYXJjaENvbmZpZywgaW5kZXhOYW1lOiB1bmRlZmluZWQgfTtcbiAgICAgIGF3YWl0IGV4cGVjdChlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiIH0sIGJhZENvbmZpZykpLnJlamVjdHMudG9UaHJvdygpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJyZXVzZXMgZXhpc3RpbmcgaW5kZXggaW5zdGFuY2UgYWNyb3NzIG11bHRpcGxlIHNlYXJjaGVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIG1vY2tJbmRleC5zZWFyY2gubW9ja1Jlc29sdmVkVmFsdWUoeyBoaXRzOiBbXSwgZXN0aW1hdGVkVG90YWxIaXRzOiAwIH0pO1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJhXCIgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiYlwiIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICBleHBlY3QobW9ja0NsaWVudC5pbmRleCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJwZXJmb3JtcyBzaW1wbGUgc2VhcmNoIHdpdGggZGVmYXVsdCBwYWdpbmF0aW9uIGFuZCBubyBmaWx0ZXJzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiaGVsbG9cIiB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgZXhwZWN0KG1vY2tDbGllbnQuaW5kZXgpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidGVzdC1pbmRleFwiKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJoZWxsb1wiLFxuICAgICAgICBleHBlY3QuYW55KE9iamVjdCksXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJqb2lucyBhcnJheSBzZWFyY2ggdGVybXMgaW50byBhIHNpbmdsZSBzdHJpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogWyBcImZvb1wiLCBcImJhclwiIF0gfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJmb28gYmFyXCIsXG4gICAgICAgIGV4cGVjdC5hbnkoT2JqZWN0KSxcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImFwcGxpZXMgY291bnQgYW5kIHBhZ2VzIGZvciBwYWdpbmF0aW9uXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgIHsgc2VhcmNoOiBcIlwiLCBwYWdpbmF0aW9uOiB7IGxpbWl0OiA1LCBwYWdlOiAzIH0gfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnLFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBsaW1pdDogNSwgb2Zmc2V0OiAxMCB9KSxcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImFwcGxpZXMgZGVmYXVsdCBjb3VudCB3aGVuIHBhZ2VzIHByb3ZpZGVkIGJ1dCBjb3VudCBtaXNzaW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgIHsgc2VhcmNoOiBcIlwiLCBwYWdpbmF0aW9uOiB7IHBhZ2U6IDIgfSB9LFxuICAgICAgICBzZWFyY2hDb25maWcsXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IGxpbWl0OiAyMCwgb2Zmc2V0OiAyMCB9KSxcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZShcImZpbHRlciB0cmFuc2Zvcm1hdGlvbnNcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJtYXBzIHNpbXBsZSBmaWVsZCBvcGVyYXRvcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyBhOiB7IGVxOiBcInhcIiB9LCBiOiB7IGd0OiAxIH0sIGM6IHsgbHRlOiA1IH0gfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBvcHRzID0gbW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXM7XG4gICAgICAgIGV4cGVjdChvcHRzLmZpbHRlcikudG9Db250YWluKFwiYSA9ICd4J1wiKTtcbiAgICAgICAgZXhwZWN0KG9wdHMuZmlsdGVyKS50b0NvbnRhaW4oXCJiID4gMVwiKTtcbiAgICAgICAgZXhwZWN0KG9wdHMuZmlsdGVyKS50b0NvbnRhaW4oXCJjIDw9IDVcIik7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJzdXBwb3J0cyBJTiBhbmQgTk9UIElOIG9wZXJhdG9yc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7IHRhZ3M6IHsgaW46IFsgXCJ0MVwiLCBcInQyXCIgXSwgbm90SW46IFsgXCJ0M1wiIF0gfSB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpXG4gICAgICAgICAgLmZpbHRlcjtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcInRhZ3MgSU4gWyd0MScsICd0MiddXCIpO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiTk9UICh0YWdzIElOIFsndDMnXSlcIik7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJzdXBwb3J0cyByYW5nZSAoYmV0d2Vlbikgb3BlcmF0b3JcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyBwcmljZTogeyBiZXR3ZWVuOiB7IGZyb206IDEwLCB0bzogMjAgfSB9IH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgZXhwZWN0KFxuICAgICAgICAgIChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyLFxuICAgICAgICApLnRvQ29udGFpbihcInByaWNlIDEwIFRPIDIwXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic3VwcG9ydHMgRVhJU1RTLCBJUyBFTVBUWSwgSVMgTlVMTFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAge1xuICAgICAgICAgICAgc2VhcmNoOiBcIlwiLFxuICAgICAgICAgICAgZmlsdGVyczoge1xuICAgICAgICAgICAgICBmOiB7IGV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICBnOiB7IGlzRW1wdHk6IHRydWUgfSxcbiAgICAgICAgICAgICAgaDogeyBpc051bGw6IHRydWUgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJmIEVYSVNUU1wiKTtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcImcgSVMgRU1QVFlcIik7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJoIElTIE5VTExcIik7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJzdXBwb3J0cyBjb250YWlucyBhbmQgc3RhcnRzV2l0aFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7IGQ6IHsgY29udGFpbnM6IFwiYWJjXCIgfSwgczogeyBzdGFydHNXaXRoOiBcInByZVwiIH0gfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJkIENPTlRBSU5TICdhYmMnXCIpO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwicyBTVEFSVFMgV0lUSCAncHJlJ1wiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgdG9wLWxldmVsIEFORCBncm91cFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7IGFuZDogWyB7IGE6IHsgZXE6IDEgfSB9LCB7IGI6IHsgZXE6IDIgfSB9IF0gfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKC9cXChhID0gMSBBTkQgYiA9IDJcXCkvKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgbmVzdGVkIE9SIGFuZCBOT1QgZ3JvdXBzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciB9PiA9IHtcbiAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgICB7IHg6IHsgbHQ6IDUgfSB9LFxuICAgICAgICAgICAgICAgIHsgeTogeyBndDogMTAgfSB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7IG5vdDogWyB7IHo6IHsgZXE6IDAgfSB9IF0gfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpXG4gICAgICAgICAgLmZpbHRlcjtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvTWF0Y2goXCIoKHggPCA1IE9SIHkgPiAxMCkgQU5EIE5PVCAoeiA9IDApKVwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImlnbm9yZXMgZmlsdGVyIG1ldGFkYXRhIGtleXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBhOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgICAgYW5kOiBbIHsgZmlsdGVySWQ6IFwiMVwiLCBmaWx0ZXJMYWJlbDogXCJMXCIsIGE6IHsgZXE6IFwidlwiIH0gfSBdLFxuICAgICAgICB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGV4cGVjdChcbiAgICAgICAgICAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcixcbiAgICAgICAgKS50b0NvbnRhaW4oXCJhID0gJ3YnXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyBtdWx0aXBsZSBuZXN0ZWQgQU5EL09SL05PVCBncm91cHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBhOiBudW1iZXIsIGI6IG51bWJlciwgYzogbnVtYmVyLCBkOiBudW1iZXIsIGU6IG51bWJlciwgZjogbnVtYmVyIH0+ID0ge1xuICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvcjogW1xuICAgICAgICAgICAgICAgIHsgYTogeyBlcTogMSB9IH0sIHsgYjogeyBlcTogMiB9IH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbm90OiBbXG4gICAgICAgICAgICAgICAgeyBjOiB7IGd0OiAzIH0gfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBkOiB7IGx0ZTogNCB9IH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgICAgeyBlOiB7IG5lcTogNSB9IH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgbm90OiBbXG4gICAgICAgICAgICAgICAgICAgIHsgZjogeyBpbjogWyA2LCA3IF0gfSB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9NYXRjaChcbiAgICAgICAgICAvXFwoXFwoYSA9IDEgT1IgYiA9IDJcXCkgQU5EIE5PVCBcXChjID4gM1xcKSBBTkQgZCA8PSA0IEFORCBcXChlICE9IDUgT1IgTk9UIFxcKGYgSU4gXFxbNiwgN1xcXVxcKVxcKVxcKS9cbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgZGVlcGx5IG5lc3RlZCBncm91cHMgd2l0aCBhbGwgbG9naWNhbCBvcGVyYXRvcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyB4OiBudW1iZXIsIHk6IG51bWJlciwgejogbnVtYmVyLCB3OiBudW1iZXIsIHY6IG51bWJlciB9PiA9IHtcbiAgICAgICAgICBvcjogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICB7IHg6IHsgbHQ6IDEwIH0gfSxcbiAgICAgICAgICAgICAgICB7IG5vdDogWyB7IHk6IHsgZXE6IDIwIH0gfSBdIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgICAgICAgeyB6OiB7IGd0ZTogMzAgfSB9LFxuICAgICAgICAgICAgICAgICAgICB7IHc6IHsgbHRlOiA0MCB9IH0sXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBub3Q6IFsgeyB2OiB7IG5lcTogNTAgfSB9IF0gfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvTWF0Y2goXG4gICAgICAgICAgL1xcKFxcKHggPCAxMCBBTkQgTk9UIFxcKHkgPSAyMFxcKSBBTkQgXFwoeiA+PSAzMCBPUiB3IDw9IDQwXFwpXFwpIE9SIE5PVCBcXCh2ICE9IDUwXFwpXFwpL1xuICAgICAgICApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyBOT1Qgb2YgYW4gQU5EIGdyb3VwXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICBub3Q6IFsge1xuICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgIHsgYTogeyBlcTogMSB9IH0sXG4gICAgICAgICAgICAgIHsgYjogeyBlcTogMiB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0gXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKFwiTk9UIChhID0gMSBBTkQgYiA9IDIpXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyBOT1Qgb2YgYW4gT1IgZ3JvdXBcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBhOiBudW1iZXIsIGI6IG51bWJlciB9PiA9IHtcbiAgICAgICAgICBub3Q6IFsge1xuICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgeyBhOiB7IGVxOiAxIH0gfSxcbiAgICAgICAgICAgICAgeyBiOiB7IGVxOiAyIH0gfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSBdLFxuICAgICAgICB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvTWF0Y2goXCJOT1QgKGEgPSAxIE9SIGIgPSAyKVwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBkZXNjcmliZShcIm1pc3NpbmcgZmlsdGVyIG9wZXJhdG9yc1wiLCAoKSA9PiB7XG4gICAgICAgIGl0KFwic3VwcG9ydHMgbmVxLCBndGUsIGx0IG9wZXJhdG9yc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIGE6IHsgbmVxOiBcInhcIiB9LFxuICAgICAgICAgICAgYjogeyBndGU6IDUgfSxcbiAgICAgICAgICAgIGM6IHsgbHQ6IDEwIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICBjb25zdCBvcHRzID0gbW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXM7XG4gICAgICAgICAgZXhwZWN0KG9wdHMuZmlsdGVyKS50b0NvbnRhaW4oXCJhICE9ICd4J1wiKTtcbiAgICAgICAgICBleHBlY3Qob3B0cy5maWx0ZXIpLnRvQ29udGFpbihcImIgPj0gNVwiKTtcbiAgICAgICAgICBleHBlY3Qob3B0cy5maWx0ZXIpLnRvQ29udGFpbihcImMgPCAxMFwiKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoXCJzdXBwb3J0cyBhbHRlcm5hdGl2ZSBvcGVyYXRvciBhbGlhc2VzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyB0YWdzOiBzdHJpbmdbXSwgcHJpY2U6IG51bWJlciB9PiA9IHtcbiAgICAgICAgICAgIHRhZ3M6IHsgbm90SW46IFsgXCJvbGRcIiBdIH0sXG4gICAgICAgICAgICBwcmljZTogeyBidDogeyBmcm9tOiAxMCwgdG86IDIwIH0gfVxuICAgICAgICAgIH07XG4gICAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiTk9UICh0YWdzIElOIFsnb2xkJ10pXCIpO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJwcmljZSAxMCBUTyAyMFwiKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoXCJoYW5kbGVzIG1peGVkIGRhdGEgdHlwZXMgaW4gZmlsdGVyc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHtcbiAgICAgICAgICAgIHN0cmluZ0ZpZWxkOiBzdHJpbmc7XG4gICAgICAgICAgICBudW1iZXJGaWVsZDogbnVtYmVyO1xuICAgICAgICAgICAgYm9vbGVhbkZpZWxkOiBib29sZWFuO1xuICAgICAgICAgICAgbnVsbEZpZWxkOiBhbnk7XG4gICAgICAgICAgfT4gPSB7XG4gICAgICAgICAgICBzdHJpbmdGaWVsZDogeyBlcTogXCJ0ZXh0XCIgfSxcbiAgICAgICAgICAgIG51bWJlckZpZWxkOiB7IGd0OiA0MiB9LFxuICAgICAgICAgICAgYm9vbGVhbkZpZWxkOiB7IGVxOiB0cnVlIH0sXG4gICAgICAgICAgICBudWxsRmllbGQ6IHsgaXNOdWxsOiB0cnVlIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcInN0cmluZ0ZpZWxkID0gJ3RleHQnXCIpO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJudW1iZXJGaWVsZCA+IDQyXCIpO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJib29sZWFuRmllbGQgPSB0cnVlXCIpO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJudWxsRmllbGQgSVMgTlVMTFwiKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoXCJoYW5kbGVzIGVtcHR5IGFycmF5IHZhbHVlcyBpbiBJTiBvcGVyYXRvcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICB0YWdzOiB7IGluOiBbXSB9LFxuICAgICAgICAgICAgY2F0ZWdvcmllczogeyBub3RJbjogW10gfVxuICAgICAgICAgIH07XG4gICAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwidGFncyBJTiBbXVwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiTk9UIChjYXRlZ29yaWVzIElOIFtdKVwiKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoXCJoYW5kbGVzIHNwZWNpYWwgY2hhcmFjdGVycyBpbiBmaWx0ZXIgdmFsdWVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgdGl0bGU6IHsgZXE6IFwiTydSZWlsbHkncyBcXFwiQm9va1xcXCJcIiB9LFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IHsgY29udGFpbnM6IFwiVVRGLTg6IOa1i+ivlVwiIH0sXG4gICAgICAgICAgICBwYXRoOiB7IHN0YXJ0c1dpdGg6IFwiQzpcXFxcUHJvZ3JhbSBGaWxlc1xcXFxcIiB9XG4gICAgICAgICAgfTtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0JlRGVmaW5lZCgpO1xuICAgICAgICAgIC8vIFZlcmlmeSB0aGF0IHNwZWNpYWwgY2hhcmFjdGVycyBhcmUgcHJvcGVybHkgZXNjYXBlZC9oYW5kbGVkXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwic3VwcG9ydHMgYXJyYXktZm9ybWF0IGJldHdlZW4gb3BlcmF0b3JcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHByaWNlOiBudW1iZXIsIHNjb3JlOiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgICBwcmljZTogeyBiZXR3ZWVuOiBbIDUsIDE1IF0gYXMgWyBudW1iZXIsIG51bWJlciBdIH0sXG4gICAgICAgICAgICBzY29yZTogeyBidDogWyAwLjgsIDEuMSBdIGFzIFsgbnVtYmVyLCBudW1iZXIgXSB9XG4gICAgICAgICAgfTtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJwcmljZSA1IFRPIDE1XCIpO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJzY29yZSAwLjggVE8gMS4xXCIpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzdXBwb3J0cyBleHBsaWNpdCBxdWVyeS5zb3J0XCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgIHsgc2VhcmNoOiBcIlwiLCBzb3J0OiBbIHsgZmllbGQ6IFwicHJpY2VcIiwgZGlyOiBcImRlc2NcIiB9IF0gfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IHNvcnQ6IFsgXCJwcmljZTpkZXNjXCIgXSB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiYXBwbGllcyBkaXN0aW5jdFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgZGlzdGluY3Q6IFwidXNlcklkXCIgfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IGRpc3RpbmN0OiBcInVzZXJJZFwiIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIHNlbGVjdCBmaWVsZHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgeyBzZWFyY2g6IFwiXCIsIHNlbGVjdDogWyBcImlkXCIsIFwibmFtZVwiIF0gfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IGF0dHJpYnV0ZXNUb1JldHJpZXZlOiBbIFwiaWRcIiwgXCJuYW1lXCIgXSB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiYXBwbGllcyBoaWdobGlnaHQgYW5kIHNob3dNYXRjaGVzUG9zaXRpb25cIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAge1xuICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICBoaWdobGlnaHQ6IHtcbiAgICAgICAgICAgIGZpZWxkczogWyBcInRpdGxlXCIgXSxcbiAgICAgICAgICAgIHByZVRhZzogXCI8Yj5cIixcbiAgICAgICAgICAgIHBvc3RUYWc6IFwiPC9iPlwiLFxuICAgICAgICAgICAgc2hvd01hdGNoZXNQb3NpdGlvbjogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiXCIsXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBhdHRyaWJ1dGVzVG9IaWdobGlnaHQ6IFsgXCJ0aXRsZVwiIF0sXG4gICAgICAgICAgaGlnaGxpZ2h0UHJlVGFnOiBcIjxiPlwiLFxuICAgICAgICAgIGhpZ2hsaWdodFBvc3RUYWc6IFwiPC9iPlwiLFxuICAgICAgICAgIHNob3dNYXRjaGVzUG9zaXRpb246IHRydWUsXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIGNyb3Agb3B0aW9uc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7XG4gICAgICAgICAgc2VhcmNoOiBcIlwiLFxuICAgICAgICAgIGNyb3A6IHsgZmllbGRzOiBbIFwiYm9keVwiIF0sIGxlbmd0aDogMzAsIG1hcmtlcjogXCLigKZcIiB9LFxuICAgICAgICB9LFxuICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiXCIsXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBhdHRyaWJ1dGVzVG9Dcm9wOiBbIFwiYm9keVwiIF0sXG4gICAgICAgICAgY3JvcExlbmd0aDogMzAsXG4gICAgICAgICAgY3JvcE1hcmtlcjogXCLigKZcIixcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImFwcGxpZXMgbWF0Y2hpbmdTdHJhdGVneVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgbWF0Y2hpbmdTdHJhdGVneTogXCJsYXN0XCIgfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IG1hdGNoaW5nU3RyYXRlZ3k6IFwibGFzdFwiIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJoYW5kbGVzIGVtcHR5IE9SIGFuZCBBTkQgZ3JvdXBzIHdpdGhvdXQgc2V0dGluZyBmaWx0ZXJzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIGZpcnN0IGNhbGw6IGVtcHR5IE9SLCBzZWNvbmQ6IGVtcHR5IEFORFxuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVyczogeyBvcjogW10gfSB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVyczogeyBhbmQ6IFtdIH0gfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGNvbnN0IG5vRmlsdGVyQ2FsbHMgPSBtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHMuZmlsdGVyKChbICwgb3B0cyBdKSA9PiAhKG9wdHMgYXMgYW55KS5maWx0ZXIpO1xuICAgICAgZXhwZWN0KG5vRmlsdGVyQ2FsbHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJwcm9wYWdhdGVzIGVycm9ycyBmcm9tIE1laWxpU2VhcmNoLnNlYXJjaFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIHNlYXJjaCB0byB0aHJvdyBhbiBlcnJvciB3aGVuIGNhbGxlZFxuICAgICAgbW9ja0luZGV4LnNlYXJjaC5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4ge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmYWlsXCIpO1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGF3YWl0IGV4cGVjdChlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiIH0sIHNlYXJjaENvbmZpZykpLnJlamVjdHMudG9UaHJvdyhcbiAgICAgICAgXCJmYWlsXCIsXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoXCJwYWdpbmF0aW9uIGVkZ2UgY2FzZXNcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJoYW5kbGVzIGJvdW5kYXJ5IHZhbHVlcyAocGFnZT0wLCBuZWdhdGl2ZSB2YWx1ZXMpXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJcIiwgcGFnaW5hdGlvbjogeyBwYWdlOiAwLCBsaW1pdDogLTUgfSB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICAvLyBTaG91bGQgaGFuZGxlIGdyYWNlZnVsbHkgb3IgYXBwbHkgZGVmYXVsdHNcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgdmVyeSBsYXJnZSBwYWdlIG51bWJlcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHsgc2VhcmNoOiBcIlwiLCBwYWdpbmF0aW9uOiB7IHBhZ2U6IDk5OTk5OSwgbGltaXQ6IDUwIH0gfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5vZmZzZXQpLnRvQmUoKDk5OTk5OSAtIDEpICogNTApO1xuICAgICAgICBleHBlY3Qob3B0cy5saW1pdCkudG9CZSg1MCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJ1c2VzIHBhZ2UvaGl0c1BlclBhZ2Ugd2hlbiB1c2VQYWdpbmF0aW9uIGlzIHRydWVcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICAgICAgcGFnZTogMixcbiAgICAgICAgICAgICAgbGltaXQ6IDE1LFxuICAgICAgICAgICAgICB1c2VQYWdpbmF0aW9uOiB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5wYWdlKS50b0JlKDIpO1xuICAgICAgICBleHBlY3Qob3B0cy5oaXRzUGVyUGFnZSkudG9CZSgxNSk7XG4gICAgICAgIGV4cGVjdChvcHRzLm9mZnNldCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3Qob3B0cy5saW1pdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwidXNlcyBsaW1pdC9vZmZzZXQgd2hlbiB1c2VQYWdpbmF0aW9uIGlzIGZhbHNlIG9yIHVuZGVmaW5lZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAge1xuICAgICAgICAgICAgc2VhcmNoOiBcIlwiLFxuICAgICAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgICAgICBwYWdlOiAzLFxuICAgICAgICAgICAgICBsaW1pdDogMTAsXG4gICAgICAgICAgICAgIHVzZVBhZ2luYXRpb246IGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5saW1pdCkudG9CZSgxMCk7XG4gICAgICAgIGV4cGVjdChvcHRzLm9mZnNldCkudG9CZSgyMCk7XG4gICAgICAgIGV4cGVjdChvcHRzLnBhZ2UpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KG9wdHMuaGl0c1BlclBhZ2UpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImFwcGxpZXMgZGVmYXVsdHMgd2hlbiBwYWdpbmF0aW9uIGlzIGNvbXBsZXRlbHkgb21pdHRlZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwidGVzdFwiIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IG9wdHMgPSBtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcztcbiAgICAgICAgZXhwZWN0KG9wdHMubGltaXQpLnRvQmUoMjApOyAvLyBkZWZhdWx0IGxpbWl0XG4gICAgICAgIGV4cGVjdChvcHRzLm9mZnNldCkudG9CZSgwKTsgIC8vIGRlZmF1bHQgb2Zmc2V0XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwic2VhcmNoIHF1ZXJ5IGVkZ2UgY2FzZXNcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJoYW5kbGVzIGVtcHR5IHNlYXJjaCB0ZXJtc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogW10gfSwgc2VhcmNoQ29uZmlnKTtcblxuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJcIiwgZXhwZWN0LmFueShPYmplY3QpKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwiXCIsIGV4cGVjdC5hbnkoT2JqZWN0KSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIHNwZWNpYWwgY2hhcmFjdGVycyBpbiBzZWFyY2ggdGVybXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBzcGVjaWFsUXVlcmllcyA9IFtcbiAgICAgICAgICBcInNlYXJjaCB3aXRoIFxcXCJxdW90ZXNcXFwiXCIsXG4gICAgICAgICAgXCJ1bmljb2RlOiDmtYvor5Ugc2VhcmNoXCIsXG4gICAgICAgICAgXCJyZWdleCBjaGFyczogWy4qKz9eJHt9KCl8XFxcXF1cIlxuICAgICAgICBdO1xuXG4gICAgICAgIGZvciAoY29uc3QgcXVlcnkgb2Ygc3BlY2lhbFF1ZXJpZXMpIHtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBxdWVyeSB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChxdWVyeSwgZXhwZWN0LmFueShPYmplY3QpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyB2ZXJ5IGxvbmcgc2VhcmNoIHRlcm1zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgbG9uZ1F1ZXJ5ID0gXCJhXCIucmVwZWF0KDEwMDAwKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogbG9uZ1F1ZXJ5IH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChsb25nUXVlcnksIGV4cGVjdC5hbnkoT2JqZWN0KSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwiYWR2YW5jZWQgc2VhcmNoIGZlYXR1cmVzXCIsICgpID0+IHtcbiAgICAgIGl0KFwic3VwcG9ydHMgbXVsdGlwbGUgc29ydCBmaWVsZHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICAgIHNvcnQ6IFtcbiAgICAgICAgICAgICAgeyBmaWVsZDogXCJwcmlvcml0eVwiLCBkaXI6IFwiZGVzY1wiIH0sXG4gICAgICAgICAgICAgIHsgZmllbGQ6IFwiY3JlYXRlZF9hdFwiLCBkaXI6IFwiYXNjXCIgfSxcbiAgICAgICAgICAgICAgeyBmaWVsZDogXCJ0aXRsZVwiLCBkaXI6IFwiZGVzY1wiIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJcIixcbiAgICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBzb3J0OiBbIFwicHJpb3JpdHk6ZGVzY1wiLCBcImNyZWF0ZWRfYXQ6YXNjXCIsIFwidGl0bGU6ZGVzY1wiIF1cbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyBlbXB0eSBzb3J0IGFycmF5XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJcIiwgc29ydDogW10gfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5zb3J0KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIHNob3dSYW5raW5nU2NvcmVcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHsgc2VhcmNoOiBcInRlc3RcIiwgc2hvd1JhbmtpbmdTY29yZTogdHJ1ZSB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJ0ZXN0XCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBzaG93UmFua2luZ1Njb3JlOiB0cnVlIH0pXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIHNob3dSYW5raW5nU2NvcmVEZXRhaWxzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJ0ZXN0XCIsIHNob3dSYW5raW5nU2NvcmVEZXRhaWxzOiB0cnVlIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgICBcInRlc3RcIixcbiAgICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IHNob3dSYW5raW5nU2NvcmVEZXRhaWxzOiB0cnVlIH0pXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIHJhbmtpbmdTY29yZVRocmVzaG9sZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAgeyBzZWFyY2g6IFwidGVzdFwiLCByYW5raW5nU2NvcmVUaHJlc2hvbGQ6IDAuOCB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJ0ZXN0XCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyByYW5raW5nU2NvcmVUaHJlc2hvbGQ6IDAuOCB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiYXBwbGllcyBoeWJyaWQgc2VhcmNoIG9wdGlvbnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJ0ZXN0XCIsXG4gICAgICAgICAgICBoeWJyaWQ6IHtcbiAgICAgICAgICAgICAgZW1iZWRkZXI6IFwiZGVmYXVsdFwiLFxuICAgICAgICAgICAgICBzZW1hbnRpY1JhdGlvOiAwLjVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJ0ZXN0XCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgaHlicmlkOiB7XG4gICAgICAgICAgICAgIGVtYmVkZGVyOiBcImRlZmF1bHRcIixcbiAgICAgICAgICAgICAgc2VtYW50aWNSYXRpbzogMC41XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImFwcGxpZXMgdmVjdG9yIHNlYXJjaFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHZlY3RvciA9IFsgMC4xLCAwLjIsIDAuMywgMC40LCAwLjUgXTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJcIiwgdmVjdG9yIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgICBcIlwiLFxuICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgdmVjdG9yIH0pXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJkZWxldGUoKVwiLCAoKSA9PiB7XG4gICAgaXQoXCJkZWxldGVzIGRvY3VtZW50cyBieSBJRCBvbiBjb3JyZWN0IGluZGV4XCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5kZWxldGVEb2N1bWVudHMoWyBcIjFcIiwgXCIyXCIgXSwgXCJ0ZXN0LWluZGV4XCIpO1xuICAgICAgZXhwZWN0KG1vY2tDbGllbnQuaW5kZXgpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidGVzdC1pbmRleFwiKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguZGVsZXRlRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChbIFwiMVwiLCBcIjJcIiBdKTtcbiAgICB9KTtcblxuICAgIGl0KFwidGhyb3dzIGlmIGluZGV4TmFtZSBpcyBlbXB0eVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLmRlbGV0ZURvY3VtZW50cyhbXSwgXCJcIikpLnJlamVjdHMudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcImJhdGNoIG9wZXJhdGlvbnNcIiwgKCkgPT4ge1xuICAgIGRlc2NyaWJlKFwiaW5kZXhJbkJhdGNoZXMoKVwiLCAoKSA9PiB7XG4gICAgICBpdChcInNob3VsZCBpbmRleCBkb2N1bWVudHMgaW4gYmF0Y2hlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY3MgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAyNTAwIH0sIChfLCBpKSA9PiAoeyBpZDogYGRvYyR7aX1gIH0pKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLmluZGV4SW5CYXRjaGVzKGRvY3MsIHNlYXJjaENvbmZpZywgMTAwMCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5hZGREb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygzKTsgLy8gMyBiYXRjaGVzXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguYWRkRG9jdW1lbnRzKS50b0hhdmVCZWVuTnRoQ2FsbGVkV2l0aCgxLCBleHBlY3QuYXJyYXlDb250YWluaW5nKFsgeyBpZDogXCJkb2MwXCIgfSBdKSk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguYWRkRG9jdW1lbnRzKS50b0hhdmVCZWVuTnRoQ2FsbGVkV2l0aCgzLCBleHBlY3QuYXJyYXlDb250YWluaW5nKFsgeyBpZDogXCJkb2MyMDAwXCIgfSBdKSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJzaG91bGQgaGFuZGxlIGVtcHR5IGRvY3VtZW50cyBhcnJheVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5pbmRleEluQmF0Y2hlcyhbXSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5hZGREb2N1bWVudHMpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwidXBkYXRlRG9jdW1lbnRzKClcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJzaG91bGQgdXBkYXRlIGRvY3VtZW50c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY3MgPSBbIHsgaWQ6IFwiMVwiLCB0aXRsZTogXCJVcGRhdGVkXCIgfSBdO1xuICAgICAgICBhd2FpdCBlbmdpbmUudXBkYXRlRG9jdW1lbnRzKGRvY3MsIHNlYXJjaENvbmZpZyk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC51cGRhdGVEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKGRvY3MpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZShcInVwZGF0ZURvY3VtZW50c0luQmF0Y2hlcygpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIHVwZGF0ZSBkb2N1bWVudHMgaW4gYmF0Y2hlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY3MgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxNTAwIH0sIChfLCBpKSA9PiAoeyBpZDogYGRvYyR7aX1gLCB1cGRhdGVkOiB0cnVlIH0pKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnVwZGF0ZURvY3VtZW50c0luQmF0Y2hlcyhkb2NzLCBzZWFyY2hDb25maWcsIDUwMCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC51cGRhdGVEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygzKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcImRvY3VtZW50IHJldHJpZXZhbFwiLCAoKSA9PiB7XG4gICAgZGVzY3JpYmUoXCJnZXREb2N1bWVudCgpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIHJldHJpZXZlIGEgc2luZ2xlIGRvY3VtZW50XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgbW9ja0RvYyA9IHsgaWQ6IFwiMTIzXCIsIHRpdGxlOiBcIlRlc3QgRG9jXCIgfTtcbiAgICAgICAgbW9ja0luZGV4LmdldERvY3VtZW50Lm1vY2tSZXNvbHZlZFZhbHVlKG1vY2tEb2MpO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuZ2luZS5nZXREb2N1bWVudChcIjEyM1wiLCBcInRlc3QtaW5kZXhcIik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5nZXREb2N1bWVudCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCIxMjNcIik7XG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwobW9ja0RvYyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwiZ2V0RG9jdW1lbnRzKClcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJzaG91bGQgcmV0cmlldmUgbXVsdGlwbGUgZG9jdW1lbnRzIHdpdGggb3B0aW9uc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG1vY2tEb2NzID0gWyB7IGlkOiBcIjFcIiB9LCB7IGlkOiBcIjJcIiB9IF07XG4gICAgICAgIG1vY2tJbmRleC5nZXREb2N1bWVudHMubW9ja1Jlc29sdmVkVmFsdWUoeyByZXN1bHRzOiBtb2NrRG9jcywgdG90YWw6IDIgfSk7XG5cbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHsgbGltaXQ6IDEwLCBvZmZzZXQ6IDAgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5naW5lLmdldERvY3VtZW50cyhcInRlc3QtaW5kZXhcIiwgb3B0aW9ucyk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5nZXREb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKG9wdGlvbnMpO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKG1vY2tEb2NzKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcInNob3VsZCByZXRyaWV2ZSBkb2N1bWVudHMgd2l0aG91dCBvcHRpb25zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgbW9ja0RvY3MgPSBbIHsgaWQ6IFwiMVwiIH0gXTtcbiAgICAgICAgbW9ja0luZGV4LmdldERvY3VtZW50cy5tb2NrUmVzb2x2ZWRWYWx1ZSh7IHJlc3VsdHM6IG1vY2tEb2NzLCB0b3RhbDogMSB9KTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmdpbmUuZ2V0RG9jdW1lbnRzKFwidGVzdC1pbmRleFwiKTtcblxuICAgICAgICBleHBlY3QobW9ja0luZGV4LmdldERvY3VtZW50cykudG9IYXZlQmVlbkNhbGxlZFdpdGgodW5kZWZpbmVkKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChtb2NrRG9jcyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJhZHZhbmNlZCBkZWxldGUgb3BlcmF0aW9uc1wiLCAoKSA9PiB7XG4gICAgZGVzY3JpYmUoXCJkZWxldGVBbGxEb2N1bWVudHMoKVwiLCAoKSA9PiB7XG4gICAgICBpdChcInNob3VsZCBkZWxldGUgYWxsIGRvY3VtZW50cyBmcm9tIGluZGV4XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLmRlbGV0ZUFsbERvY3VtZW50cyhcInRlc3QtaW5kZXhcIik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5kZWxldGVBbGxEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoXCJkZWxldGVEb2N1bWVudHNCeUZpbHRlcigpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIGRlbGV0ZSBkb2N1bWVudHMgYnkgZmlsdGVyXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyID0geyBjYXRlZ29yeTogeyBlcTogXCJ0ZXN0XCIgfSB9O1xuICAgICAgICBjb25zdCBleHBlY3RlZFRhc2sgPSB7XG4gICAgICAgICAgdGFza1VpZDogNixcbiAgICAgICAgICBpbmRleFVpZDogXCJ0ZXN0LWluZGV4XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImVucXVldWVkXCIgYXMgY29uc3QsXG4gICAgICAgICAgdHlwZTogXCJkb2N1bWVudERlbGV0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgICAgZW5xdWV1ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH07XG4gICAgICAgIG1vY2tJbmRleC5kZWxldGVEb2N1bWVudHMubW9ja1Jlc29sdmVkVmFsdWUoZXhwZWN0ZWRUYXNrKTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmdpbmUuZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoZmlsdGVyLCBcInRlc3QtaW5kZXhcIik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5kZWxldGVEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgICBmaWx0ZXI6IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKFwiY2F0ZWdvcnkgPSAndGVzdCdcIilcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoZXhwZWN0ZWRUYXNrKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcInNob3VsZCB0aHJvdyBlcnJvciB3aGVuIGluZGV4TmFtZSBpcyBtaXNzaW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyID0geyBzdGF0dXM6IHsgZXE6IFwiZGVsZXRlZFwiIH0gfTtcblxuICAgICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgICAgZW5naW5lLmRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKGZpbHRlciwgXCJcIilcbiAgICAgICAgKS5yZWplY3RzLnRvVGhyb3coXCJJbmRleCBuYW1lIGlzIHJlcXVpcmVkXCIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwibXVsdGlTZWFyY2goKVwiLCAoKSA9PiB7XG4gICAgaXQoXCJzaG91bGQgcGVyZm9ybSBtdWx0aS1zZWFyY2ggYWNyb3NzIGluZGljZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcXVlcmllcyA9IFtcbiAgICAgICAgeyBpbmRleFVpZDogXCJpbmRleDFcIiwgcXVlcnk6IFwic2VhcmNoMVwiLCBzZWFyY2hQYXJhbXM6IHsgbGltaXQ6IDUgfSB9LFxuICAgICAgICB7IGluZGV4VWlkOiBcImluZGV4MlwiLCBxdWVyeTogXCJzZWFyY2gyXCIgfVxuICAgICAgXTtcblxuICAgICAgY29uc3QgZXhwZWN0ZWRSZXN1bHRzID0ge1xuICAgICAgICByZXN1bHRzOiBbXG4gICAgICAgICAgeyBpbmRleFVpZDogXCJpbmRleDFcIiwgaGl0czogW10sIHByb2Nlc3NpbmdUaW1lTXM6IDEwLCBxdWVyeTogXCJzZWFyY2gxXCIgfSxcbiAgICAgICAgICB7IGluZGV4VWlkOiBcImluZGV4MlwiLCBoaXRzOiBbXSwgcHJvY2Vzc2luZ1RpbWVNczogMTIsIHF1ZXJ5OiBcInNlYXJjaDJcIiB9XG4gICAgICAgIF1cbiAgICAgIH07XG4gICAgICBtb2NrQ2xpZW50Lm11bHRpU2VhcmNoLm1vY2tSZXNvbHZlZFZhbHVlKGV4cGVjdGVkUmVzdWx0cyk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuZ2luZS5tdWx0aVNlYXJjaChxdWVyaWVzKTtcblxuICAgICAgZXhwZWN0KG1vY2tDbGllbnQubXVsdGlTZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgcXVlcmllczogW1xuICAgICAgICAgIHsgaW5kZXhVaWQ6IFwiaW5kZXgxXCIsIHE6IFwic2VhcmNoMVwiLCBsaW1pdDogNSB9LFxuICAgICAgICAgIHsgaW5kZXhVaWQ6IFwiaW5kZXgyXCIsIHE6IFwic2VhcmNoMlwiIH1cbiAgICAgICAgXVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKGV4cGVjdGVkUmVzdWx0cyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiZXJyb3IgaGFuZGxpbmdcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBpbmRleCBjcmVhdGlvbiBmYWlsdXJlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIGNyZWF0ZUluZGV4IHRvIHJldHVybiBhIHByb21pc2Ugd2l0aCB3YWl0VGFzayB0aGF0IHJlamVjdHNcbiAgICAgIGNvbnN0IG1vY2tQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKHVuZGVmaW5lZCkgYXMgYW55O1xuICAgICAgbW9ja1Byb21pc2Uud2FpdFRhc2sgPSBqZXN0LmZuKCkubW9ja1JlamVjdGVkVmFsdWUobmV3IEVycm9yKFwiQ3JlYXRpb24gZmFpbGVkXCIpKTtcbiAgICAgIG1vY2tDbGllbnQuY3JlYXRlSW5kZXgubW9ja1JldHVyblZhbHVlKG1vY2tQcm9taXNlKTtcblxuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBlbmdpbmUuaW5kZXhEb2N1bWVudHMoWyB7IGlkOiBcIjFcIiB9IF0sIHNlYXJjaENvbmZpZylcbiAgICAgICkucmVqZWN0cy50b1Rocm93KFwiQ3JlYXRpb24gZmFpbGVkXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIGNvbm5lY3Rpb24gZXJyb3JzIGluIHNlYXJjaFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIHNlYXJjaCB0byB0aHJvdyBhbiBlcnJvciB3aGVuIGNhbGxlZFxuICAgICAgbW9ja0luZGV4LnNlYXJjaC5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4ge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uIHRpbWVvdXRcIik7XG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcInRlc3RcIiB9LCBzZWFyY2hDb25maWcpXG4gICAgICApLnJlamVjdHMudG9UaHJvdyhcIlNlYXJjaCBvcGVyYXRpb24gZmFpbGVkOiBDb25uZWN0aW9uIHRpbWVvdXRcIik7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgbWFsZm9ybWVkIHNlYXJjaCByZXN1bHRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIG1vY2tJbmRleC5zZWFyY2gubW9ja1Jlc29sdmVkVmFsdWUobnVsbCk7IC8vIEludmFsaWQgcmVzcG9uc2VcblxuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcInRlc3RcIiB9LCBzZWFyY2hDb25maWcpXG4gICAgICApLnJlamVjdHMudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19