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
            it("supports exists and notExists operators", async () => {
                await engine.search({
                    search: "",
                    filters: {
                        f: { exists: true },
                        g: { exists: false },
                        h: { notExists: true },
                    },
                }, searchConfig);
                const fstr = mockIndex.search.mock.calls[0][1]
                    .filter;
                // exists: true uses NOT (f IS NULL) in MeiliSearch
                expect(fstr).toContain("NOT (f IS NULL)");
                expect(fstr).toContain("g IS NULL");
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
                        nullField: { notExists: true }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL2VuZ2luZXMvbWVpbGkvZW5naW5lLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxQ0FBOEU7QUFFOUUsNkNBQTZFO0FBRzdFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7QUFFekIsUUFBUSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRTtJQUNqQyxJQUFJLE1BQXlCLENBQUM7SUFDOUIsSUFBSSxVQUFvQyxDQUFDO0lBQ3pDLElBQUksU0FBNkIsQ0FBQztJQUNsQyxJQUFJLE1BQXVDLENBQUM7SUFDNUMsSUFBSSxZQUErQixDQUFDO0lBRXBDLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFFckIscURBQXFEO1FBQ3JELE1BQU0sNkJBQTZCLEdBQUcsQ0FBQyxPQUFlLEVBQUUsRUFBRTtZQUN4RCxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxFQUFFLENBQVEsQ0FBQztZQUN4RCxXQUFXLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFDaEUsT0FBTyxXQUFXLENBQUM7UUFDckIsQ0FBQyxDQUFDO1FBRUYsU0FBUyxHQUFHO1lBQ1YsWUFBWSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxlQUFlLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDekUsTUFBTSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7WUFDakIsZUFBZSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxlQUFlLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDNUUsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFF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RSxLQUFLLElBQUksRUFBRTtZQUN0RCxTQUFTLENBQUMsTUFBTSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsbUJBQW1CO1lBRTdELE1BQU0sTUFBTSxDQUNWLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEVBQUUsWUFBWSxDQUFDLENBQ2hELENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3RCLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE1laWxpU2VhcmNoRW5naW5lLCBFeHRlbmRlZE1laWxpU2VhcmNoQ2xpZW50Q29uZmlnIH0gZnJvbSBcIi4vZW5naW5lXCI7XG5pbXBvcnQgeyBTZWFyY2hJbmRleENvbmZpZyB9IGZyb20gXCIuLi8uLi90eXBlc1wiO1xuaW1wb3J0IHsgTWVpbGlTZWFyY2gsIEluZGV4LCBTZWFyY2hQYXJhbXMsIEVucXVldWVkVGFzayB9IGZyb20gXCJtZWlsaXNlYXJjaFwiO1xuaW1wb3J0IHsgR2VuZXJpY0ZpbHRlckNyaXRlcmlhIH0gZnJvbSBcIi4uLy4uLy4uL2VudGl0eS9xdWVyeS10eXBlc1wiO1xuXG5qZXN0Lm1vY2soXCJtZWlsaXNlYXJjaFwiKTtcblxuZGVzY3JpYmUoXCJNZWlsaVNlYXJjaEVuZ2luZVwiLCAoKSA9PiB7XG4gIGxldCBlbmdpbmU6IE1laWxpU2VhcmNoRW5naW5lO1xuICBsZXQgbW9ja0NsaWVudDogamVzdC5Nb2NrZWQ8TWVpbGlTZWFyY2g+O1xuICBsZXQgbW9ja0luZGV4OiBqZXN0Lk1vY2tlZDxJbmRleD47XG4gIGxldCBjb25maWc6IEV4dGVuZGVkTWVpbGlTZWFyY2hDbGllbnRDb25maWc7XG4gIGxldCBzZWFyY2hDb25maWc6IFNlYXJjaEluZGV4Q29uZmlnO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuXG4gICAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBtb2NrIEVucXVldWVkVGFza1Byb21pc2VcbiAgICBjb25zdCBjcmVhdGVNb2NrRW5xdWV1ZWRUYXNrUHJvbWlzZSA9ICh0YXNrVWlkOiBudW1iZXIpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKHsgdGFza1VpZCB9KSBhcyBhbnk7XG4gICAgICBtb2NrUHJvbWlzZS53YWl0VGFzayA9IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7IHRhc2tVaWQgfSk7XG4gICAgICByZXR1cm4gbW9ja1Byb21pc2U7XG4gICAgfTtcblxuICAgIG1vY2tJbmRleCA9IHtcbiAgICAgIGFkZERvY3VtZW50czogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShjcmVhdGVNb2NrRW5xdWV1ZWRUYXNrUHJvbWlzZSgxKSksXG4gICAgICBzZWFyY2g6IGplc3QuZm4oKSxcbiAgICAgIGRlbGV0ZURvY3VtZW50czogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShjcmVhdGVNb2NrRW5xdWV1ZWRUYXNrUHJvbWlzZSgxKSksXG4gICAgICB1cGRhdGVTZXR0aW5nczogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShjcmVhdGVNb2NrRW5xdWV1ZWRUYXNrUHJvbWlzZSgxKSksXG4gICAgICB1cGRhdGVEb2N1bWVudHM6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoY3JlYXRlTW9ja0VucXVldWVkVGFza1Byb21pc2UoMikpLFxuICAgICAgZ2V0RG9jdW1lbnQ6IGplc3QuZm4oKSxcbiAgICAgIGdldERvY3VtZW50czogamVzdC5mbigpLFxuICAgICAgZGVsZXRlQWxsRG9jdW1lbnRzOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGNyZWF0ZU1vY2tFbnF1ZXVlZFRhc2tQcm9taXNlKDMpKSxcbiAgICAgIGdldFN0YXRzOiBqZXN0LmZuKCksXG4gICAgfSBhcyBQYXJ0aWFsPEluZGV4PiBhcyBqZXN0Lk1vY2tlZDxJbmRleD47XG5cbiAgICAvLyBEZWZhdWx0IG1vY2sgZm9yIGNyZWF0ZUluZGV4IC0gcmV0dXJucyBhIHByb21pc2Ugd2l0aCB3YWl0VGFzayBtZXRob2RcbiAgICBjb25zdCBkZWZhdWx0TW9ja1Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUodW5kZWZpbmVkKSBhcyBhbnk7XG4gICAgZGVmYXVsdE1vY2tQcm9taXNlLndhaXRUYXNrID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZCk7XG5cbiAgICBtb2NrQ2xpZW50ID0ge1xuICAgICAgaW5kZXg6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUobW9ja0luZGV4KSxcbiAgICAgIGNyZWF0ZUluZGV4OiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGRlZmF1bHRNb2NrUHJvbWlzZSksXG4gICAgICBtdWx0aVNlYXJjaDogamVzdC5mbigpLFxuICAgICAgZ2V0VGFzazogamVzdC5mbigpLFxuICAgIH0gYXMgUGFydGlhbDxNZWlsaVNlYXJjaD4gYXMgamVzdC5Nb2NrZWQ8TWVpbGlTZWFyY2g+O1xuXG4gICAgKE1laWxpU2VhcmNoIGFzIGplc3QuTW9jaykubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+IG1vY2tDbGllbnQpO1xuXG4gICAgY29uZmlnID0geyBob3N0OiBcImh0dHA6Ly9sb2NhbGhvc3Q6NzcwMFwiLCBhcGlLZXk6IFwia2V5XCIgfTtcbiAgICBzZWFyY2hDb25maWcgPSB7XG4gICAgICBpbmRleE5hbWU6IFwidGVzdC1pbmRleFwiLFxuICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFsgXCJ0aXRsZVwiIF0sXG4gICAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbIFwiY2F0ZWdvcnlcIiBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGVuZ2luZSA9IG5ldyBNZWlsaVNlYXJjaEVuZ2luZShjb25maWcpO1xuICB9KTtcblxuICBkZXNjcmliZShcImluZGV4KClcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGNyZWF0ZSBpbmRleCBhbmQgdXBkYXRlIHNldHRpbmdzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGRvY3MgPSBbIHsgaWQ6IFwiMVwiIH0gXTtcbiAgICAgIGF3YWl0IGVuZ2luZS5pbmRleERvY3VtZW50cyhkb2NzLCBzZWFyY2hDb25maWcpO1xuICAgICAgZXhwZWN0KG1vY2tDbGllbnQuaW5kZXgpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidGVzdC1pbmRleFwiKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXgudXBkYXRlU2V0dGluZ3MpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBzZWFyY2hDb25maWcuc2V0dGluZ3MsXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5hZGREb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKGRvY3MpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgcmV1c2UgZXhpc3RpbmcgaW5kZXggd2l0aG91dCB1cGRhdGluZyBzZXR0aW5ncyBhZ2FpblwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuaW5kZXhEb2N1bWVudHMoW10sIHNlYXJjaENvbmZpZyk7XG4gICAgICBhd2FpdCBlbmdpbmUuaW5kZXhEb2N1bWVudHMoW10sIHNlYXJjaENvbmZpZyk7XG4gICAgICBleHBlY3QobW9ja0NsaWVudC5pbmRleCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDIpO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC51cGRhdGVTZXR0aW5ncykudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJ0aHJvd3MgaWYgaW5kZXhOYW1lIGlzIG1pc3NpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYmFkQ29uZmlnID0geyAuLi5zZWFyY2hDb25maWcsIGluZGV4TmFtZTogdW5kZWZpbmVkISB9O1xuICAgICAgYXdhaXQgZXhwZWN0KGVuZ2luZS5pbmRleERvY3VtZW50cyhbXSwgYmFkQ29uZmlnKSkucmVqZWN0cy50b1Rocm93KCk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBub3QgdXBkYXRlIHNldHRpbmdzIHdoZW4gY29uZmlnLnNldHRpbmdzIGlzIG9taXR0ZWRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY2ZnID0geyAuLi5zZWFyY2hDb25maWcgfTtcbiAgICAgIGRlbGV0ZSAoY2ZnIGFzIGFueSkuc2V0dGluZ3M7XG4gICAgICBhd2FpdCBlbmdpbmUuaW5kZXhEb2N1bWVudHMoW10sIGNmZyk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnVwZGF0ZVNldHRpbmdzKS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJwcm9wYWdhdGVzIGVycm9ycyBmcm9tIGFkZERvY3VtZW50c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIGFkZERvY3VtZW50cyB0byB0aHJvdyBhbiBlcnJvciB3aGVuIGNhbGxlZFxuICAgICAgbW9ja0luZGV4LmFkZERvY3VtZW50cy5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4ge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJhZGREb2NzRmFpbFwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLmluZGV4RG9jdW1lbnRzKFsgeyBpZDogXCJ4XCIgfSBdLCBzZWFyY2hDb25maWcpKS5yZWplY3RzLnRvVGhyb3coXCJhZGREb2NzRmFpbFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwicHJvcGFnYXRlcyBlcnJvcnMgZnJvbSB1cGRhdGVTZXR0aW5nc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIHVwZGF0ZVNldHRpbmdzIHRvIHRocm93IGFuIGVycm9yIHdoZW4gY2FsbGVkXG4gICAgICBtb2NrSW5kZXgudXBkYXRlU2V0dGluZ3MubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+IHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2V0dGluZ3NGYWlsXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChlbmdpbmUuaW5kZXhEb2N1bWVudHMoW10sIHNlYXJjaENvbmZpZykpLnJlamVjdHMudG9UaHJvdyhcInNldHRpbmdzRmFpbFwiKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJzZWFyY2goKVwiLCAoKSA9PiB7XG4gICAgY29uc3QgYmFzZVJlc3VsdHMgPSB7IGhpdHM6IFtdLCBlc3RpbWF0ZWRUb3RhbEhpdHM6IDAgfSBhcyBhbnk7XG5cbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIG1vY2tJbmRleC5zZWFyY2gubW9ja1Jlc29sdmVkVmFsdWUoYmFzZVJlc3VsdHMpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgdGhyb3cgaWYgaW5kZXhOYW1lIGlzIG1pc3NpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYmFkQ29uZmlnID0geyAuLi5zZWFyY2hDb25maWcsIGluZGV4TmFtZTogdW5kZWZpbmVkIH07XG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiB9LCBiYWRDb25maWcpKS5yZWplY3RzLnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIGl0KFwicmV1c2VzIGV4aXN0aW5nIGluZGV4IGluc3RhbmNlIGFjcm9zcyBtdWx0aXBsZSBzZWFyY2hlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBtb2NrSW5kZXguc2VhcmNoLm1vY2tSZXNvbHZlZFZhbHVlKHsgaGl0czogW10sIGVzdGltYXRlZFRvdGFsSGl0czogMCB9KTtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiYVwiIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcImJcIiB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgZXhwZWN0KG1vY2tDbGllbnQuaW5kZXgpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcbiAgICB9KTtcblxuICAgIGl0KFwicGVyZm9ybXMgc2ltcGxlIHNlYXJjaCB3aXRoIGRlZmF1bHQgcGFnaW5hdGlvbiBhbmQgbm8gZmlsdGVyc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcImhlbGxvXCIgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGV4cGVjdChtb2NrQ2xpZW50LmluZGV4KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInRlc3QtaW5kZXhcIik7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiaGVsbG9cIixcbiAgICAgICAgZXhwZWN0LmFueShPYmplY3QpLFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiam9pbnMgYXJyYXkgc2VhcmNoIHRlcm1zIGludG8gYSBzaW5nbGUgc3RyaW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFsgXCJmb29cIiwgXCJiYXJcIiBdIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiZm9vIGJhclwiLFxuICAgICAgICBleHBlY3QuYW55KE9iamVjdCksXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIGNvdW50IGFuZCBwYWdlcyBmb3IgcGFnaW5hdGlvblwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgcGFnaW5hdGlvbjogeyBsaW1pdDogNSwgcGFnZTogMyB9IH0sXG4gICAgICAgIHNlYXJjaENvbmZpZyxcbiAgICAgICk7XG4gICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIFwiXCIsXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgbGltaXQ6IDUsIG9mZnNldDogMTAgfSksXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIGRlZmF1bHQgY291bnQgd2hlbiBwYWdlcyBwcm92aWRlZCBidXQgY291bnQgbWlzc2luZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgcGFnaW5hdGlvbjogeyBwYWdlOiAyIH0gfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnLFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBsaW1pdDogMjAsIG9mZnNldDogMjAgfSksXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoXCJmaWx0ZXIgdHJhbnNmb3JtYXRpb25zXCIsICgpID0+IHtcbiAgICAgIGl0KFwibWFwcyBzaW1wbGUgZmllbGQgb3BlcmF0b3JzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHsgYTogeyBlcTogXCJ4XCIgfSwgYjogeyBndDogMSB9LCBjOiB7IGx0ZTogNSB9IH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICBleHBlY3Qob3B0cy5maWx0ZXIpLnRvQ29udGFpbihcImEgPSAneCdcIik7XG4gICAgICAgIGV4cGVjdChvcHRzLmZpbHRlcikudG9Db250YWluKFwiYiA+IDFcIik7XG4gICAgICAgIGV4cGVjdChvcHRzLmZpbHRlcikudG9Db250YWluKFwiYyA8PSA1XCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic3VwcG9ydHMgSU4gYW5kIE5PVCBJTiBvcGVyYXRvcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyB0YWdzOiB7IGluOiBbIFwidDFcIiwgXCJ0MlwiIF0sIG5vdEluOiBbIFwidDNcIiBdIH0gfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJ0YWdzIElOIFsndDEnLCAndDInXVwiKTtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcIk5PVCAodGFncyBJTiBbJ3QzJ10pXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic3VwcG9ydHMgcmFuZ2UgKGJldHdlZW4pIG9wZXJhdG9yXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHsgcHJpY2U6IHsgYmV0d2VlbjogeyBmcm9tOiAxMCwgdG86IDIwIH0gfSB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGV4cGVjdChcbiAgICAgICAgICAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcixcbiAgICAgICAgKS50b0NvbnRhaW4oXCJwcmljZSAxMCBUTyAyMFwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcInN1cHBvcnRzIGV4aXN0cyBhbmQgbm90RXhpc3RzIG9wZXJhdG9yc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAge1xuICAgICAgICAgICAgc2VhcmNoOiBcIlwiLFxuICAgICAgICAgICAgZmlsdGVyczoge1xuICAgICAgICAgICAgICBmOiB7IGV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICBnOiB7IGV4aXN0czogZmFsc2UgfSxcbiAgICAgICAgICAgICAgaDogeyBub3RFeGlzdHM6IHRydWUgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIC8vIGV4aXN0czogdHJ1ZSB1c2VzIE5PVCAoZiBJUyBOVUxMKSBpbiBNZWlsaVNlYXJjaFxuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiTk9UIChmIElTIE5VTEwpXCIpO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiZyBJUyBOVUxMXCIpO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiaCBJUyBOVUxMXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic3VwcG9ydHMgY29udGFpbnMgYW5kIHN0YXJ0c1dpdGhcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyBkOiB7IGNvbnRhaW5zOiBcImFiY1wiIH0sIHM6IHsgc3RhcnRzV2l0aDogXCJwcmVcIiB9IH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcylcbiAgICAgICAgICAuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiZCBDT05UQUlOUyAnYWJjJ1wiKTtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcInMgU1RBUlRTIFdJVEggJ3ByZSdcIik7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIHRvcC1sZXZlbCBBTkQgZ3JvdXBcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBmaWx0ZXJzID0geyBhbmQ6IFsgeyBhOiB7IGVxOiAxIH0gfSwgeyBiOiB7IGVxOiAyIH0gfSBdIH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcylcbiAgICAgICAgICAuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9NYXRjaCgvXFwoYSA9IDEgQU5EIGIgPSAyXFwpLyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIG5lc3RlZCBPUiBhbmQgTk9UIGdyb3Vwc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHg6IG51bWJlciwgeTogbnVtYmVyLCB6OiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgICAgeyB4OiB7IGx0OiA1IH0gfSxcbiAgICAgICAgICAgICAgICB7IHk6IHsgZ3Q6IDEwIH0gfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBub3Q6IFsgeyB6OiB7IGVxOiAwIH0gfSBdIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKVxuICAgICAgICAgIC5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKFwiKCh4IDwgNSBPUiB5ID4gMTApIEFORCBOT1QgKHogPSAwKSlcIik7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJpZ25vcmVzIGZpbHRlciBtZXRhZGF0YSBrZXlzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgYTogc3RyaW5nIH0+ID0ge1xuICAgICAgICAgIGFuZDogWyB7IGZpbHRlcklkOiBcIjFcIiwgZmlsdGVyTGFiZWw6IFwiTFwiLCBhOiB7IGVxOiBcInZcIiB9IH0gXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBleHBlY3QoXG4gICAgICAgICAgKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXIsXG4gICAgICAgICkudG9Db250YWluKFwiYSA9ICd2J1wiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgbXVsdGlwbGUgbmVzdGVkIEFORC9PUi9OT1QgZ3JvdXBzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgYTogbnVtYmVyLCBiOiBudW1iZXIsIGM6IG51bWJlciwgZDogbnVtYmVyLCBlOiBudW1iZXIsIGY6IG51bWJlciB9PiA9IHtcbiAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgICB7IGE6IHsgZXE6IDEgfSB9LCB7IGI6IHsgZXE6IDIgfSB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5vdDogW1xuICAgICAgICAgICAgICAgIHsgYzogeyBndDogMyB9IH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHsgZDogeyBsdGU6IDQgfSB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBvcjogW1xuICAgICAgICAgICAgICAgIHsgZTogeyBuZXE6IDUgfSB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIG5vdDogW1xuICAgICAgICAgICAgICAgICAgICB7IGY6IHsgaW46IFsgNiwgNyBdIH0gfVxuICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9O1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgZXhwZWN0KGZzdHIpLnRvTWF0Y2goXG4gICAgICAgICAgL1xcKFxcKGEgPSAxIE9SIGIgPSAyXFwpIEFORCBOT1QgXFwoYyA+IDNcXCkgQU5EIGQgPD0gNCBBTkQgXFwoZSAhPSA1IE9SIE5PVCBcXChmIElOIFxcWzYsIDdcXF1cXClcXClcXCkvXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIGRlZXBseSBuZXN0ZWQgZ3JvdXBzIHdpdGggYWxsIGxvZ2ljYWwgb3BlcmF0b3JzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlciwgdzogbnVtYmVyLCB2OiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgeyB4OiB7IGx0OiAxMCB9IH0sXG4gICAgICAgICAgICAgICAgeyBub3Q6IFsgeyB5OiB7IGVxOiAyMCB9IH0gXSB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgejogeyBndGU6IDMwIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgeyB3OiB7IGx0ZTogNDAgfSB9LFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHsgbm90OiBbIHsgdjogeyBuZXE6IDUwIH0gfSBdIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKFxuICAgICAgICAgIC9cXChcXCh4IDwgMTAgQU5EIE5PVCBcXCh5ID0gMjBcXCkgQU5EIFxcKHogPj0gMzAgT1IgdyA8PSA0MFxcKVxcKSBPUiBOT1QgXFwodiAhPSA1MFxcKVxcKS9cbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgTk9UIG9mIGFuIEFORCBncm91cFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgbm90OiBbIHtcbiAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICB7IGE6IHsgZXE6IDEgfSB9LFxuICAgICAgICAgICAgICB7IGI6IHsgZXE6IDIgfSB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9IF0sXG4gICAgICAgIH07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyO1xuICAgICAgICBleHBlY3QoZnN0cikudG9NYXRjaChcIk5PVCAoYSA9IDEgQU5EIGIgPSAyKVwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgTk9UIG9mIGFuIE9SIGdyb3VwXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgYTogbnVtYmVyLCBiOiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgbm90OiBbIHtcbiAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgIHsgYTogeyBlcTogMSB9IH0sXG4gICAgICAgICAgICAgIHsgYjogeyBlcTogMiB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0gXSxcbiAgICAgICAgfTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgIGV4cGVjdChmc3RyKS50b01hdGNoKFwiTk9UIChhID0gMSBPUiBiID0gMilcIik7XG4gICAgICB9KTtcblxuICAgICAgZGVzY3JpYmUoXCJtaXNzaW5nIGZpbHRlciBvcGVyYXRvcnNcIiwgKCkgPT4ge1xuICAgICAgICBpdChcInN1cHBvcnRzIG5lcSwgZ3RlLCBsdCBvcGVyYXRvcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBhOiB7IG5lcTogXCJ4XCIgfSxcbiAgICAgICAgICAgIGI6IHsgZ3RlOiA1IH0sXG4gICAgICAgICAgICBjOiB7IGx0OiAxMCB9XG4gICAgICAgICAgfTtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgY29uc3Qgb3B0cyA9IG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zO1xuICAgICAgICAgIGV4cGVjdChvcHRzLmZpbHRlcikudG9Db250YWluKFwiYSAhPSAneCdcIik7XG4gICAgICAgICAgZXhwZWN0KG9wdHMuZmlsdGVyKS50b0NvbnRhaW4oXCJiID49IDVcIik7XG4gICAgICAgICAgZXhwZWN0KG9wdHMuZmlsdGVyKS50b0NvbnRhaW4oXCJjIDwgMTBcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwic3VwcG9ydHMgYWx0ZXJuYXRpdmUgb3BlcmF0b3IgYWxpYXNlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgdGFnczogc3RyaW5nW10sIHByaWNlOiBudW1iZXIgfT4gPSB7XG4gICAgICAgICAgICB0YWdzOiB7IG5vdEluOiBbIFwib2xkXCIgXSB9LFxuICAgICAgICAgICAgcHJpY2U6IHsgYnQ6IHsgZnJvbTogMTAsIHRvOiAyMCB9IH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcIk5PVCAodGFncyBJTiBbJ29sZCddKVwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwicHJpY2UgMTAgVE8gMjBcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwiaGFuZGxlcyBtaXhlZCBkYXRhIHR5cGVzIGluIGZpbHRlcnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7XG4gICAgICAgICAgICBzdHJpbmdGaWVsZDogc3RyaW5nO1xuICAgICAgICAgICAgbnVtYmVyRmllbGQ6IG51bWJlcjtcbiAgICAgICAgICAgIGJvb2xlYW5GaWVsZDogYm9vbGVhbjtcbiAgICAgICAgICAgIG51bGxGaWVsZDogYW55O1xuICAgICAgICAgIH0+ID0ge1xuICAgICAgICAgICAgc3RyaW5nRmllbGQ6IHsgZXE6IFwidGV4dFwiIH0sXG4gICAgICAgICAgICBudW1iZXJGaWVsZDogeyBndDogNDIgfSxcbiAgICAgICAgICAgIGJvb2xlYW5GaWVsZDogeyBlcTogdHJ1ZSB9LFxuICAgICAgICAgICAgbnVsbEZpZWxkOiB7IG5vdEV4aXN0czogdHJ1ZSB9XG4gICAgICAgICAgfTtcbiAgICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiLCBmaWx0ZXJzIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgICAgY29uc3QgZnN0ciA9IChtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcykuZmlsdGVyO1xuICAgICAgICAgIGV4cGVjdChmc3RyKS50b0NvbnRhaW4oXCJzdHJpbmdGaWVsZCA9ICd0ZXh0J1wiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwibnVtYmVyRmllbGQgPiA0MlwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwiYm9vbGVhbkZpZWxkID0gdHJ1ZVwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwibnVsbEZpZWxkIElTIE5VTExcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwiaGFuZGxlcyBlbXB0eSBhcnJheSB2YWx1ZXMgaW4gSU4gb3BlcmF0b3JzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgdGFnczogeyBpbjogW10gfSxcbiAgICAgICAgICAgIGNhdGVnb3JpZXM6IHsgbm90SW46IFtdIH1cbiAgICAgICAgICB9O1xuICAgICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnMgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICBjb25zdCBmc3RyID0gKG1vY2tJbmRleC5zZWFyY2gubW9jay5jYWxsc1sgMCBdWyAxIF0gYXMgU2VhcmNoUGFyYW1zKS5maWx0ZXI7XG4gICAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcInRhZ3MgSU4gW11cIik7XG4gICAgICAgICAgZXhwZWN0KGZzdHIpLnRvQ29udGFpbihcIk5PVCAoY2F0ZWdvcmllcyBJTiBbXSlcIik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KFwiaGFuZGxlcyBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gZmlsdGVyIHZhbHVlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIHRpdGxlOiB7IGVxOiBcIk8nUmVpbGx5J3MgXFxcIkJvb2tcXFwiXCIgfSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB7IGNvbnRhaW5zOiBcIlVURi04OiDmtYvor5VcIiB9LFxuICAgICAgICAgICAgcGF0aDogeyBzdGFydHNXaXRoOiBcIkM6XFxcXFByb2dyYW0gRmlsZXNcXFxcXCIgfVxuICAgICAgICAgIH07XG4gICAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9CZURlZmluZWQoKTtcbiAgICAgICAgICAvLyBWZXJpZnkgdGhhdCBzcGVjaWFsIGNoYXJhY3RlcnMgYXJlIHByb3Blcmx5IGVzY2FwZWQvaGFuZGxlZFxuICAgICAgICB9KTtcblxuICAgICAgICBpdChcInN1cHBvcnRzIGFycmF5LWZvcm1hdCBiZXR3ZWVuIG9wZXJhdG9yXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBwcmljZTogbnVtYmVyLCBzY29yZTogbnVtYmVyIH0+ID0ge1xuICAgICAgICAgICAgcHJpY2U6IHsgYmV0d2VlbjogWyA1LCAxNSBdIGFzIFsgbnVtYmVyLCBudW1iZXIgXSB9LFxuICAgICAgICAgICAgc2NvcmU6IHsgYnQ6IFsgMC44LCAxLjEgXSBhcyBbIG51bWJlciwgbnVtYmVyIF0gfVxuICAgICAgICAgIH07XG4gICAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiwgZmlsdGVycyB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICAgIGNvbnN0IGZzdHIgPSAobW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXMpLmZpbHRlcjtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwicHJpY2UgNSBUTyAxNVwiKTtcbiAgICAgICAgICBleHBlY3QoZnN0cikudG9Db250YWluKFwic2NvcmUgMC44IFRPIDEuMVwiKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KFwic3VwcG9ydHMgZXhwbGljaXQgcXVlcnkuc29ydFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICB7IHNlYXJjaDogXCJcIiwgc29ydDogWyB7IGZpZWxkOiBcInByaWNlXCIsIGRpcjogXCJkZXNjXCIgfSBdIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBzb3J0OiBbIFwicHJpY2U6ZGVzY1wiIF0gfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImFwcGxpZXMgZGlzdGluY3RcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgeyBzZWFyY2g6IFwiXCIsIGRpc3RpbmN0OiBcInVzZXJJZFwiIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBkaXN0aW5jdDogXCJ1c2VySWRcIiB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiYXBwbGllcyBzZWxlY3QgZmllbGRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgIHsgc2VhcmNoOiBcIlwiLCBzZWxlY3Q6IFsgXCJpZFwiLCBcIm5hbWVcIiBdIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBhdHRyaWJ1dGVzVG9SZXRyaWV2ZTogWyBcImlkXCIsIFwibmFtZVwiIF0gfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImFwcGxpZXMgaGlnaGxpZ2h0IGFuZCBzaG93TWF0Y2hlc1Bvc2l0aW9uXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgIHtcbiAgICAgICAgICBzZWFyY2g6IFwiXCIsXG4gICAgICAgICAgaGlnaGxpZ2h0OiB7XG4gICAgICAgICAgICBmaWVsZHM6IFsgXCJ0aXRsZVwiIF0sXG4gICAgICAgICAgICBwcmVUYWc6IFwiPGI+XCIsXG4gICAgICAgICAgICBwb3N0VGFnOiBcIjwvYj5cIixcbiAgICAgICAgICAgIHNob3dNYXRjaGVzUG9zaXRpb246IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgYXR0cmlidXRlc1RvSGlnaGxpZ2h0OiBbIFwidGl0bGVcIiBdLFxuICAgICAgICAgIGhpZ2hsaWdodFByZVRhZzogXCI8Yj5cIixcbiAgICAgICAgICBoaWdobGlnaHRQb3N0VGFnOiBcIjwvYj5cIixcbiAgICAgICAgICBzaG93TWF0Y2hlc1Bvc2l0aW9uOiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiYXBwbGllcyBjcm9wIG9wdGlvbnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAge1xuICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICBjcm9wOiB7IGZpZWxkczogWyBcImJvZHlcIiBdLCBsZW5ndGg6IDMwLCBtYXJrZXI6IFwi4oCmXCIgfSxcbiAgICAgICAgfSxcbiAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBcIlwiLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgYXR0cmlidXRlc1RvQ3JvcDogWyBcImJvZHlcIiBdLFxuICAgICAgICAgIGNyb3BMZW5ndGg6IDMwLFxuICAgICAgICAgIGNyb3BNYXJrZXI6IFwi4oCmXCIsXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJhcHBsaWVzIG1hdGNoaW5nU3RyYXRlZ3lcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgeyBzZWFyY2g6IFwiXCIsIG1hdGNoaW5nU3RyYXRlZ3k6IFwibGFzdFwiIH0sXG4gICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgXCJcIixcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBtYXRjaGluZ1N0cmF0ZWd5OiBcImxhc3RcIiB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KFwiaGFuZGxlcyBlbXB0eSBPUiBhbmQgQU5EIGdyb3VwcyB3aXRob3V0IHNldHRpbmcgZmlsdGVyc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBmaXJzdCBjYWxsOiBlbXB0eSBPUiwgc2Vjb25kOiBlbXB0eSBBTkRcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnM6IHsgb3I6IFtdIH0gfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFwiXCIsIGZpbHRlcnM6IHsgYW5kOiBbXSB9IH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICBjb25zdCBub0ZpbHRlckNhbGxzID0gbW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzLmZpbHRlcigoWyAsIG9wdHMgXSkgPT4gIShvcHRzIGFzIGFueSkuZmlsdGVyKTtcbiAgICAgIGV4cGVjdChub0ZpbHRlckNhbGxzLmxlbmd0aCkudG9CZSgyKTtcbiAgICB9KTtcblxuICAgIGl0KFwicHJvcGFnYXRlcyBlcnJvcnMgZnJvbSBNZWlsaVNlYXJjaC5zZWFyY2hcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTW9jayBzZWFyY2ggdG8gdGhyb3cgYW4gZXJyb3Igd2hlbiBjYWxsZWRcbiAgICAgIG1vY2tJbmRleC5zZWFyY2gubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+IHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZmFpbFwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJcIiB9LCBzZWFyY2hDb25maWcpKS5yZWplY3RzLnRvVGhyb3coXG4gICAgICAgIFwiZmFpbFwiLFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwicGFnaW5hdGlvbiBlZGdlIGNhc2VzXCIsICgpID0+IHtcbiAgICAgIGl0KFwiaGFuZGxlcyBib3VuZGFyeSB2YWx1ZXMgKHBhZ2U9MCwgbmVnYXRpdmUgdmFsdWVzKVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAgeyBzZWFyY2g6IFwiXCIsIHBhZ2luYXRpb246IHsgcGFnZTogMCwgbGltaXQ6IC01IH0gfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgLy8gU2hvdWxkIGhhbmRsZSBncmFjZWZ1bGx5IG9yIGFwcGx5IGRlZmF1bHRzXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJoYW5kbGVzIHZlcnkgbGFyZ2UgcGFnZSBudW1iZXJzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJcIiwgcGFnaW5hdGlvbjogeyBwYWdlOiA5OTk5OTksIGxpbWl0OiA1MCB9IH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IG9wdHMgPSBtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcztcbiAgICAgICAgZXhwZWN0KG9wdHMub2Zmc2V0KS50b0JlKCg5OTk5OTkgLSAxKSAqIDUwKTtcbiAgICAgICAgZXhwZWN0KG9wdHMubGltaXQpLnRvQmUoNTApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwidXNlcyBwYWdlL2hpdHNQZXJQYWdlIHdoZW4gdXNlUGFnaW5hdGlvbiBpcyB0cnVlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzZWFyY2g6IFwiXCIsXG4gICAgICAgICAgICBwYWdpbmF0aW9uOiB7XG4gICAgICAgICAgICAgIHBhZ2U6IDIsXG4gICAgICAgICAgICAgIGxpbWl0OiAxNSxcbiAgICAgICAgICAgICAgdXNlUGFnaW5hdGlvbjogdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IG9wdHMgPSBtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcztcbiAgICAgICAgZXhwZWN0KG9wdHMucGFnZSkudG9CZSgyKTtcbiAgICAgICAgZXhwZWN0KG9wdHMuaGl0c1BlclBhZ2UpLnRvQmUoMTUpO1xuICAgICAgICBleHBlY3Qob3B0cy5vZmZzZXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KG9wdHMubGltaXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcInVzZXMgbGltaXQvb2Zmc2V0IHdoZW4gdXNlUGFnaW5hdGlvbiBpcyBmYWxzZSBvciB1bmRlZmluZWRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlYXJjaDogXCJcIixcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICAgICAgcGFnZTogMyxcbiAgICAgICAgICAgICAgbGltaXQ6IDEwLFxuICAgICAgICAgICAgICB1c2VQYWdpbmF0aW9uOiBmYWxzZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IG9wdHMgPSBtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcztcbiAgICAgICAgZXhwZWN0KG9wdHMubGltaXQpLnRvQmUoMTApO1xuICAgICAgICBleHBlY3Qob3B0cy5vZmZzZXQpLnRvQmUoMjApO1xuICAgICAgICBleHBlY3Qob3B0cy5wYWdlKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIGV4cGVjdChvcHRzLmhpdHNQZXJQYWdlKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIGRlZmF1bHRzIHdoZW4gcGFnaW5hdGlvbiBpcyBjb21wbGV0ZWx5IG9taXR0ZWRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcInRlc3RcIiB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBjb25zdCBvcHRzID0gbW9ja0luZGV4LnNlYXJjaC5tb2NrLmNhbGxzWyAwIF1bIDEgXSBhcyBTZWFyY2hQYXJhbXM7XG4gICAgICAgIGV4cGVjdChvcHRzLmxpbWl0KS50b0JlKDIwKTsgLy8gZGVmYXVsdCBsaW1pdFxuICAgICAgICBleHBlY3Qob3B0cy5vZmZzZXQpLnRvQmUoMCk7ICAvLyBkZWZhdWx0IG9mZnNldFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZShcInNlYXJjaCBxdWVyeSBlZGdlIGNhc2VzXCIsICgpID0+IHtcbiAgICAgIGl0KFwiaGFuZGxlcyBlbXB0eSBzZWFyY2ggdGVybXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKHsgc2VhcmNoOiBcIlwiIH0sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IFtdIH0sIHNlYXJjaENvbmZpZyk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwiXCIsIGV4cGVjdC5hbnkoT2JqZWN0KSk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguc2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcIlwiLCBleHBlY3QuYW55KE9iamVjdCkpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiaGFuZGxlcyBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gc2VhcmNoIHRlcm1zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3Qgc3BlY2lhbFF1ZXJpZXMgPSBbXG4gICAgICAgICAgXCJzZWFyY2ggd2l0aCBcXFwicXVvdGVzXFxcIlwiLFxuICAgICAgICAgIFwidW5pY29kZTog5rWL6K+VIHNlYXJjaFwiLFxuICAgICAgICAgIFwicmVnZXggY2hhcnM6IFsuKis/XiR7fSgpfFxcXFxdXCJcbiAgICAgICAgXTtcblxuICAgICAgICBmb3IgKGNvbnN0IHF1ZXJ5IG9mIHNwZWNpYWxRdWVyaWVzKSB7XG4gICAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogcXVlcnkgfSwgc2VhcmNoQ29uZmlnKTtcbiAgICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgocXVlcnksIGV4cGVjdC5hbnkoT2JqZWN0KSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgdmVyeSBsb25nIHNlYXJjaCB0ZXJtc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGxvbmdRdWVyeSA9IFwiYVwiLnJlcGVhdCgxMDAwMCk7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goeyBzZWFyY2g6IGxvbmdRdWVyeSB9LCBzZWFyY2hDb25maWcpO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgobG9uZ1F1ZXJ5LCBleHBlY3QuYW55KE9iamVjdCkpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZShcImFkdmFuY2VkIHNlYXJjaCBmZWF0dXJlc1wiLCAoKSA9PiB7XG4gICAgICBpdChcInN1cHBvcnRzIG11bHRpcGxlIHNvcnQgZmllbGRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzZWFyY2g6IFwiXCIsXG4gICAgICAgICAgICBzb3J0OiBbXG4gICAgICAgICAgICAgIHsgZmllbGQ6IFwicHJpb3JpdHlcIiwgZGlyOiBcImRlc2NcIiB9LFxuICAgICAgICAgICAgICB7IGZpZWxkOiBcImNyZWF0ZWRfYXRcIiwgZGlyOiBcImFzY1wiIH0sXG4gICAgICAgICAgICAgIHsgZmllbGQ6IFwidGl0bGVcIiwgZGlyOiBcImRlc2NcIiB9XG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgc29ydDogWyBcInByaW9yaXR5OmRlc2NcIiwgXCJjcmVhdGVkX2F0OmFzY1wiLCBcInRpdGxlOmRlc2NcIiBdXG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImhhbmRsZXMgZW1wdHkgc29ydCBhcnJheVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAgeyBzZWFyY2g6IFwiXCIsIHNvcnQ6IFtdIH0sXG4gICAgICAgICAgc2VhcmNoQ29uZmlnXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IG9wdHMgPSBtb2NrSW5kZXguc2VhcmNoLm1vY2suY2FsbHNbIDAgXVsgMSBdIGFzIFNlYXJjaFBhcmFtcztcbiAgICAgICAgZXhwZWN0KG9wdHMuc29ydCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiYXBwbGllcyBzaG93UmFua2luZ1Njb3JlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7IHNlYXJjaDogXCJ0ZXN0XCIsIHNob3dSYW5raW5nU2NvcmU6IHRydWUgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgIFwidGVzdFwiLFxuICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgc2hvd1JhbmtpbmdTY29yZTogdHJ1ZSB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiYXBwbGllcyBzaG93UmFua2luZ1Njb3JlRGV0YWlsc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAgeyBzZWFyY2g6IFwidGVzdFwiLCBzaG93UmFua2luZ1Njb3JlRGV0YWlsczogdHJ1ZSB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJ0ZXN0XCIsXG4gICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBzaG93UmFua2luZ1Njb3JlRGV0YWlsczogdHJ1ZSB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwiYXBwbGllcyByYW5raW5nU2NvcmVUaHJlc2hvbGRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuc2VhcmNoKFxuICAgICAgICAgIHsgc2VhcmNoOiBcInRlc3RcIiwgcmFua2luZ1Njb3JlVGhyZXNob2xkOiAwLjggfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgIFwidGVzdFwiLFxuICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgcmFua2luZ1Njb3JlVGhyZXNob2xkOiAwLjggfSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdChcImFwcGxpZXMgaHlicmlkIHNlYXJjaCBvcHRpb25zXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW5naW5lLnNlYXJjaChcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzZWFyY2g6IFwidGVzdFwiLFxuICAgICAgICAgICAgaHlicmlkOiB7XG4gICAgICAgICAgICAgIGVtYmVkZGVyOiBcImRlZmF1bHRcIixcbiAgICAgICAgICAgICAgc2VtYW50aWNSYXRpbzogMC41XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hDb25maWdcbiAgICAgICAgKTtcbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5zZWFyY2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgIFwidGVzdFwiLFxuICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGh5YnJpZDoge1xuICAgICAgICAgICAgICBlbWJlZGRlcjogXCJkZWZhdWx0XCIsXG4gICAgICAgICAgICAgIHNlbWFudGljUmF0aW86IDAuNVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJhcHBsaWVzIHZlY3RvciBzZWFyY2hcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCB2ZWN0b3IgPSBbIDAuMSwgMC4yLCAwLjMsIDAuNCwgMC41IF07XG4gICAgICAgIGF3YWl0IGVuZ2luZS5zZWFyY2goXG4gICAgICAgICAgeyBzZWFyY2g6IFwiXCIsIHZlY3RvciB9LFxuICAgICAgICAgIHNlYXJjaENvbmZpZ1xuICAgICAgICApO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgXCJcIixcbiAgICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IHZlY3RvciB9KVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiZGVsZXRlKClcIiwgKCkgPT4ge1xuICAgIGl0KFwiZGVsZXRlcyBkb2N1bWVudHMgYnkgSUQgb24gY29ycmVjdCBpbmRleFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBlbmdpbmUuZGVsZXRlRG9jdW1lbnRzKFsgXCIxXCIsIFwiMlwiIF0sIFwidGVzdC1pbmRleFwiKTtcbiAgICAgIGV4cGVjdChtb2NrQ2xpZW50LmluZGV4KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInRlc3QtaW5kZXhcIik7XG4gICAgICBleHBlY3QobW9ja0luZGV4LmRlbGV0ZURvY3VtZW50cykudG9IYXZlQmVlbkNhbGxlZFdpdGgoWyBcIjFcIiwgXCIyXCIgXSk7XG4gICAgfSk7XG5cbiAgICBpdChcInRocm93cyBpZiBpbmRleE5hbWUgaXMgZW1wdHlcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZXhwZWN0KGVuZ2luZS5kZWxldGVEb2N1bWVudHMoW10sIFwiXCIpKS5yZWplY3RzLnRvVGhyb3coKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJiYXRjaCBvcGVyYXRpb25zXCIsICgpID0+IHtcbiAgICBkZXNjcmliZShcImluZGV4SW5CYXRjaGVzKClcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJzaG91bGQgaW5kZXggZG9jdW1lbnRzIGluIGJhdGNoZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBkb2NzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMjUwMCB9LCAoXywgaSkgPT4gKHsgaWQ6IGBkb2Mke2l9YCB9KSk7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5pbmRleEluQmF0Y2hlcyhkb2NzLCBzZWFyY2hDb25maWcsIDEwMDApO1xuXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguYWRkRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMyk7IC8vIDMgYmF0Y2hlc1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LmFkZERvY3VtZW50cykudG9IYXZlQmVlbk50aENhbGxlZFdpdGgoMSwgZXhwZWN0LmFycmF5Q29udGFpbmluZyhbIHsgaWQ6IFwiZG9jMFwiIH0gXSkpO1xuICAgICAgICBleHBlY3QobW9ja0luZGV4LmFkZERvY3VtZW50cykudG9IYXZlQmVlbk50aENhbGxlZFdpdGgoMywgZXhwZWN0LmFycmF5Q29udGFpbmluZyhbIHsgaWQ6IFwiZG9jMjAwMFwiIH0gXSkpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KFwic2hvdWxkIGhhbmRsZSBlbXB0eSBkb2N1bWVudHMgYXJyYXlcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbmdpbmUuaW5kZXhJbkJhdGNoZXMoW10sIHNlYXJjaENvbmZpZyk7XG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguYWRkRG9jdW1lbnRzKS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZShcInVwZGF0ZURvY3VtZW50cygpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIHVwZGF0ZSBkb2N1bWVudHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBkb2NzID0gWyB7IGlkOiBcIjFcIiwgdGl0bGU6IFwiVXBkYXRlZFwiIH0gXTtcbiAgICAgICAgYXdhaXQgZW5naW5lLnVwZGF0ZURvY3VtZW50cyhkb2NzLCBzZWFyY2hDb25maWcpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXgudXBkYXRlRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChkb2NzKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoXCJ1cGRhdGVEb2N1bWVudHNJbkJhdGNoZXMoKVwiLCAoKSA9PiB7XG4gICAgICBpdChcInNob3VsZCB1cGRhdGUgZG9jdW1lbnRzIGluIGJhdGNoZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBkb2NzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMTUwMCB9LCAoXywgaSkgPT4gKHsgaWQ6IGBkb2Mke2l9YCwgdXBkYXRlZDogdHJ1ZSB9KSk7XG4gICAgICAgIGF3YWl0IGVuZ2luZS51cGRhdGVEb2N1bWVudHNJbkJhdGNoZXMoZG9jcywgc2VhcmNoQ29uZmlnLCA1MDApO1xuXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXgudXBkYXRlRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJkb2N1bWVudCByZXRyaWV2YWxcIiwgKCkgPT4ge1xuICAgIGRlc2NyaWJlKFwiZ2V0RG9jdW1lbnQoKVwiLCAoKSA9PiB7XG4gICAgICBpdChcInNob3VsZCByZXRyaWV2ZSBhIHNpbmdsZSBkb2N1bWVudFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG1vY2tEb2MgPSB7IGlkOiBcIjEyM1wiLCB0aXRsZTogXCJUZXN0IERvY1wiIH07XG4gICAgICAgIG1vY2tJbmRleC5nZXREb2N1bWVudC5tb2NrUmVzb2x2ZWRWYWx1ZShtb2NrRG9jKTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmdpbmUuZ2V0RG9jdW1lbnQoXCIxMjNcIiwgXCJ0ZXN0LWluZGV4XCIpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguZ2V0RG9jdW1lbnQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwiMTIzXCIpO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKG1vY2tEb2MpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZShcImdldERvY3VtZW50cygpXCIsICgpID0+IHtcbiAgICAgIGl0KFwic2hvdWxkIHJldHJpZXZlIG11bHRpcGxlIGRvY3VtZW50cyB3aXRoIG9wdGlvbnNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBtb2NrRG9jcyA9IFsgeyBpZDogXCIxXCIgfSwgeyBpZDogXCIyXCIgfSBdO1xuICAgICAgICBtb2NrSW5kZXguZ2V0RG9jdW1lbnRzLm1vY2tSZXNvbHZlZFZhbHVlKHsgcmVzdWx0czogbW9ja0RvY3MsIHRvdGFsOiAyIH0pO1xuXG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSB7IGxpbWl0OiAxMCwgb2Zmc2V0OiAwIH07XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVuZ2luZS5nZXREb2N1bWVudHMoXCJ0ZXN0LWluZGV4XCIsIG9wdGlvbnMpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguZ2V0RG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChvcHRpb25zKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChtb2NrRG9jcyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJzaG91bGQgcmV0cmlldmUgZG9jdW1lbnRzIHdpdGhvdXQgb3B0aW9uc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IG1vY2tEb2NzID0gWyB7IGlkOiBcIjFcIiB9IF07XG4gICAgICAgIG1vY2tJbmRleC5nZXREb2N1bWVudHMubW9ja1Jlc29sdmVkVmFsdWUoeyByZXN1bHRzOiBtb2NrRG9jcywgdG90YWw6IDEgfSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5naW5lLmdldERvY3VtZW50cyhcInRlc3QtaW5kZXhcIik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tJbmRleC5nZXREb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHVuZGVmaW5lZCk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwobW9ja0RvY3MpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiYWR2YW5jZWQgZGVsZXRlIG9wZXJhdGlvbnNcIiwgKCkgPT4ge1xuICAgIGRlc2NyaWJlKFwiZGVsZXRlQWxsRG9jdW1lbnRzKClcIiwgKCkgPT4ge1xuICAgICAgaXQoXCJzaG91bGQgZGVsZXRlIGFsbCBkb2N1bWVudHMgZnJvbSBpbmRleFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVuZ2luZS5kZWxldGVBbGxEb2N1bWVudHMoXCJ0ZXN0LWluZGV4XCIpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguZGVsZXRlQWxsRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKFwiZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoKVwiLCAoKSA9PiB7XG4gICAgICBpdChcInNob3VsZCBkZWxldGUgZG9jdW1lbnRzIGJ5IGZpbHRlclwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlciA9IHsgY2F0ZWdvcnk6IHsgZXE6IFwidGVzdFwiIH0gfTtcbiAgICAgICAgY29uc3QgZXhwZWN0ZWRUYXNrID0ge1xuICAgICAgICAgIHRhc2tVaWQ6IDYsXG4gICAgICAgICAgaW5kZXhVaWQ6IFwidGVzdC1pbmRleFwiLFxuICAgICAgICAgIHN0YXR1czogXCJlbnF1ZXVlZFwiIGFzIGNvbnN0LFxuICAgICAgICAgIHR5cGU6IFwiZG9jdW1lbnREZWxldGlvblwiIGFzIGNvbnN0LFxuICAgICAgICAgIGVucXVldWVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9O1xuICAgICAgICBtb2NrSW5kZXguZGVsZXRlRG9jdW1lbnRzLm1vY2tSZXNvbHZlZFZhbHVlKGV4cGVjdGVkVGFzayk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZW5naW5lLmRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKGZpbHRlciwgXCJ0ZXN0LWluZGV4XCIpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrSW5kZXguZGVsZXRlRG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgICAgZmlsdGVyOiBleHBlY3Quc3RyaW5nQ29udGFpbmluZyhcImNhdGVnb3J5ID0gJ3Rlc3QnXCIpXG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKGV4cGVjdGVkVGFzayk7XG4gICAgICB9KTtcblxuICAgICAgaXQoXCJzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiBpbmRleE5hbWUgaXMgbWlzc2luZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbHRlciA9IHsgc3RhdHVzOiB7IGVxOiBcImRlbGV0ZWRcIiB9IH07XG5cbiAgICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICAgIGVuZ2luZS5kZWxldGVEb2N1bWVudHNCeUZpbHRlcihmaWx0ZXIsIFwiXCIpXG4gICAgICAgICkucmVqZWN0cy50b1Rocm93KFwiSW5kZXggbmFtZSBpcyByZXF1aXJlZFwiKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIm11bHRpU2VhcmNoKClcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIHBlcmZvcm0gbXVsdGktc2VhcmNoIGFjcm9zcyBpbmRpY2VzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJpZXMgPSBbXG4gICAgICAgIHsgaW5kZXhVaWQ6IFwiaW5kZXgxXCIsIHF1ZXJ5OiBcInNlYXJjaDFcIiwgc2VhcmNoUGFyYW1zOiB7IGxpbWl0OiA1IH0gfSxcbiAgICAgICAgeyBpbmRleFVpZDogXCJpbmRleDJcIiwgcXVlcnk6IFwic2VhcmNoMlwiIH1cbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IGV4cGVjdGVkUmVzdWx0cyA9IHtcbiAgICAgICAgcmVzdWx0czogW1xuICAgICAgICAgIHsgaW5kZXhVaWQ6IFwiaW5kZXgxXCIsIGhpdHM6IFtdLCBwcm9jZXNzaW5nVGltZU1zOiAxMCwgcXVlcnk6IFwic2VhcmNoMVwiIH0sXG4gICAgICAgICAgeyBpbmRleFVpZDogXCJpbmRleDJcIiwgaGl0czogW10sIHByb2Nlc3NpbmdUaW1lTXM6IDEyLCBxdWVyeTogXCJzZWFyY2gyXCIgfVxuICAgICAgICBdXG4gICAgICB9O1xuICAgICAgbW9ja0NsaWVudC5tdWx0aVNlYXJjaC5tb2NrUmVzb2x2ZWRWYWx1ZShleHBlY3RlZFJlc3VsdHMpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBlbmdpbmUubXVsdGlTZWFyY2gocXVlcmllcyk7XG5cbiAgICAgIGV4cGVjdChtb2NrQ2xpZW50Lm11bHRpU2VhcmNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIHF1ZXJpZXM6IFtcbiAgICAgICAgICB7IGluZGV4VWlkOiBcImluZGV4MVwiLCBxOiBcInNlYXJjaDFcIiwgbGltaXQ6IDUgfSxcbiAgICAgICAgICB7IGluZGV4VWlkOiBcImluZGV4MlwiLCBxOiBcInNlYXJjaDJcIiB9XG4gICAgICAgIF1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChleHBlY3RlZFJlc3VsdHMpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcImVycm9yIGhhbmRsaW5nXCIsICgpID0+IHtcbiAgICBpdChcInNob3VsZCBoYW5kbGUgaW5kZXggY3JlYXRpb24gZmFpbHVyZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTW9jayBjcmVhdGVJbmRleCB0byByZXR1cm4gYSBwcm9taXNlIHdpdGggd2FpdFRhc2sgdGhhdCByZWplY3RzXG4gICAgICBjb25zdCBtb2NrUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSh1bmRlZmluZWQpIGFzIGFueTtcbiAgICAgIG1vY2tQcm9taXNlLndhaXRUYXNrID0gamVzdC5mbigpLm1vY2tSZWplY3RlZFZhbHVlKG5ldyBFcnJvcihcIkNyZWF0aW9uIGZhaWxlZFwiKSk7XG4gICAgICBtb2NrQ2xpZW50LmNyZWF0ZUluZGV4Lm1vY2tSZXR1cm5WYWx1ZShtb2NrUHJvbWlzZSk7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgZW5naW5lLmluZGV4RG9jdW1lbnRzKFsgeyBpZDogXCIxXCIgfSBdLCBzZWFyY2hDb25maWcpXG4gICAgICApLnJlamVjdHMudG9UaHJvdyhcIkNyZWF0aW9uIGZhaWxlZFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBjb25uZWN0aW9uIGVycm9ycyBpbiBzZWFyY2hcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTW9jayBzZWFyY2ggdG8gdGhyb3cgYW4gZXJyb3Igd2hlbiBjYWxsZWRcbiAgICAgIG1vY2tJbmRleC5zZWFyY2gubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+IHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbiB0aW1lb3V0XCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJ0ZXN0XCIgfSwgc2VhcmNoQ29uZmlnKVxuICAgICAgKS5yZWplY3RzLnRvVGhyb3coXCJTZWFyY2ggb3BlcmF0aW9uIGZhaWxlZDogQ29ubmVjdGlvbiB0aW1lb3V0XCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIG1hbGZvcm1lZCBzZWFyY2ggcmVzdWx0c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBtb2NrSW5kZXguc2VhcmNoLm1vY2tSZXNvbHZlZFZhbHVlKG51bGwpOyAvLyBJbnZhbGlkIHJlc3BvbnNlXG5cbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgZW5naW5lLnNlYXJjaCh7IHNlYXJjaDogXCJ0ZXN0XCIgfSwgc2VhcmNoQ29uZmlnKVxuICAgICAgKS5yZWplY3RzLnRvVGhyb3coKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==