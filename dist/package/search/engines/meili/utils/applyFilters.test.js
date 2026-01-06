"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const applyFIlters_1 = require("./applyFIlters");
// Mock the logger
jest.mock("../../../../logging", () => ({
    createLogger: jest.fn(() => ({
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));
describe("MeiliSearch:applyFilters", () => {
    let mockQueryBuilder;
    let mockWhereBuilder;
    beforeEach(() => {
        jest.clearAllMocks();
        // Create mock where builder with chainable methods
        mockWhereBuilder = {
            eq: jest.fn().mockReturnThis(),
            neq: jest.fn().mockReturnThis(),
            gt: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lt: jest.fn().mockReturnThis(),
            lte: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            notIn: jest.fn().mockReturnThis(),
            rangeTo: jest.fn().mockReturnThis(),
            isNull: jest.fn().mockReturnThis(),
            isNotNull: jest.fn().mockReturnThis(),
            exists: jest.fn().mockReturnThis(),
            notExists: jest.fn().mockReturnThis(),
            contains: jest.fn().mockReturnThis(),
            startsWith: jest.fn().mockReturnThis(),
        };
        mockQueryBuilder = {
            where: jest.fn().mockReturnValue(mockWhereBuilder),
            andGroup: jest.fn(),
            orGroup: jest.fn(),
            notGroup: jest.fn(),
            filterRaw: jest.fn(),
        };
    });
    describe("Core Operators", () => {
        it("should handle all basic comparison operators", () => {
            const filters = {
                field: {
                    eq: "value",
                    neq: "other",
                    gt: 10,
                    gte: 5,
                    lt: 20,
                    lte: 15
                }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockQueryBuilder.where).toHaveBeenCalledWith("field");
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value");
            expect(mockWhereBuilder.neq).toHaveBeenCalledWith("other");
            expect(mockWhereBuilder.gt).toHaveBeenCalledWith(10);
            expect(mockWhereBuilder.gte).toHaveBeenCalledWith(5);
            expect(mockWhereBuilder.lt).toHaveBeenCalledWith(20);
            expect(mockWhereBuilder.lte).toHaveBeenCalledWith(15);
        });
        it("should handle array operators", () => {
            const filters = {
                tags: { in: ["tag1", "tag2"] },
                categories: { nin: ["cat1", "cat2"] }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.in).toHaveBeenCalledWith(["tag1", "tag2"]);
            expect(mockWhereBuilder.notIn).toHaveBeenCalledWith(["cat1", "cat2"]);
        });
        it("should handle range operators", () => {
            const filters = {
                price: { between: [10, 20] },
                score: { bt: { from: 0.5, to: 0.9 } }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.rangeTo).toHaveBeenCalledWith(10, 20);
            expect(mockWhereBuilder.rangeTo).toHaveBeenCalledWith(0.5, 0.9);
        });
        it("should handle string pattern operators", () => {
            const filters = {
                name: { startsWith: "John" },
                description: { contains: "test" }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.startsWith).toHaveBeenCalledWith("John");
            expect(mockWhereBuilder.contains).toHaveBeenCalledWith("test");
        });
        it("should handle exists and notExists operators", () => {
            const filters = {
                field1: { exists: true },
                field2: { notExists: true }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.exists).toHaveBeenCalled();
            expect(mockWhereBuilder.notExists).toHaveBeenCalled();
        });
    });
    describe("New Operators", () => {
        it("should handle notContains with NOT group", () => {
            const filters = {
                description: { notContains: "unwanted" }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockQueryBuilder.notGroup).toHaveBeenCalled();
        });
        it("should handle containsSome with OR group", () => {
            const filters = {
                tags: { containsSome: ["tag1", "tag2", "tag3"] }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockQueryBuilder.orGroup).toHaveBeenCalled();
        });
        it("should handle endsWith with raw filter fallback", () => {
            const filters = {
                filename: { endsWith: ".pdf" }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockQueryBuilder.filterRaw).toHaveBeenCalledWith('filename ENDS WITH ".pdf"');
        });
        it("should handle like operator with contains approximation", () => {
            const filters = {
                title: { like: "pattern%" }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.contains).toHaveBeenCalledWith("pattern%");
        });
    });
    describe("Operator Aliases", () => {
        it("should handle equality aliases", () => {
            const filters = {
                field: {
                    equalTo: "value1",
                    equal: "value2",
                    "===": "value3",
                    "==": "value4"
                }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value1");
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value2");
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value3");
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value4");
        });
        it("should handle inequality aliases", () => {
            const filters = {
                field: {
                    notEqualTo: "value1",
                    "!=": "value2",
                    "<>": "value3",
                    ne: "value4"
                }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value1");
            expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value2");
            expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value3");
            expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value4");
        });
        it("should handle comparison aliases", () => {
            const filters = {
                field: {
                    greaterThan: 10,
                    ">": 15,
                    greaterThanOrEqualTo: 20,
                    ">=": 25,
                    lessThan: 30,
                    "<": 35,
                    lessThanOrEqualTo: 40,
                    "<=": 45
                }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.gt).toHaveBeenCalledWith(10);
            expect(mockWhereBuilder.gt).toHaveBeenCalledWith(15);
            expect(mockWhereBuilder.gte).toHaveBeenCalledWith(20);
            expect(mockWhereBuilder.gte).toHaveBeenCalledWith(25);
            expect(mockWhereBuilder.lt).toHaveBeenCalledWith(30);
            expect(mockWhereBuilder.lt).toHaveBeenCalledWith(35);
            expect(mockWhereBuilder.lte).toHaveBeenCalledWith(40);
            expect(mockWhereBuilder.lte).toHaveBeenCalledWith(45);
        });
        it("should handle array operation aliases", () => {
            const filters = {
                field: {
                    inList: ["a", "b"],
                    notInList: ["c", "d"]
                }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.in).toHaveBeenCalledWith(["a", "b"]);
            expect(mockWhereBuilder.notIn).toHaveBeenCalledWith(["c", "d"]);
        });
        it("should handle string pattern aliases", () => {
            const filters = {
                field: {
                    begins: "start",
                    beginsWith: "prefix",
                    includes: "contains",
                    has: "content"
                }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.startsWith).toHaveBeenCalledWith("start");
            expect(mockWhereBuilder.startsWith).toHaveBeenCalledWith("prefix");
            expect(mockWhereBuilder.contains).toHaveBeenCalledWith("contains");
            expect(mockWhereBuilder.contains).toHaveBeenCalledWith("content");
        });
    });
    describe("ComplexFilterOperatorValue Support", () => {
        it("should extract value from ComplexFilterOperatorValue", () => {
            const complexValue = {
                val: "test_value",
                valType: "literal",
                valLabel: "Test Value"
            };
            const filters = {
                field: { eq: complexValue }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("test_value");
        });
        it("should warn about unsupported valTypes", () => {
            const complexValue = {
                val: "field_reference",
                valType: "propRef",
                valLabel: "Other Field"
            };
            const filters = {
                field: { eq: complexValue }
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            // Should still use the value but log a warning
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("field_reference");
        });
    });
    describe("Type Coercion", () => {
        it("should coerce numeric strings to numbers for comparison operations", () => {
            const filters = {
                age: { gt: "18" }, // String that should be coerced
                score: { lte: "95.5" } // String that should be coerced
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.gt).toHaveBeenCalledWith(18);
            expect(mockWhereBuilder.lte).toHaveBeenCalledWith(95.5);
        });
        it("should not coerce non-numeric strings for comparison operations", () => {
            const filters = {
                name: { gt: "zebra" } // String that should not be coerced
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.gt).toHaveBeenCalledWith("zebra");
        });
        it("should not coerce for non-comparison operations", () => {
            const filters = {
                field: { eq: "123" } // Should remain as string
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.eq).toHaveBeenCalledWith("123");
        });
    });
    describe("Array Normalization", () => {
        it("should convert single values to arrays for array operations", () => {
            const filters = {
                tags: { in: ["single_tag"] } // Use array to satisfy type requirements
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.in).toHaveBeenCalledWith(["single_tag"]);
        });
        it("should preserve arrays for array operations", () => {
            const filters = {
                tags: { in: ["tag1", "tag2"] } // Array that should remain as array
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockWhereBuilder.in).toHaveBeenCalledWith(["tag1", "tag2"]);
        });
    });
    describe("Error Handling", () => {
        it("should throw SearchQueryError on filter operation failure", () => {
            mockWhereBuilder.eq.mockImplementation(() => {
                throw new Error("Mock error");
            });
            const filters = {
                field: { eq: "value" }
            };
            expect(() => (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters)).toThrow();
        });
    });
    describe("Filter Groups", () => {
        it("should handle AND groups", () => {
            const filters = {
                and: [
                    { field1: { eq: "value1" } },
                    { field2: { gt: 10 } }
                ]
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockQueryBuilder.andGroup).toHaveBeenCalled();
        });
        it("should handle OR groups", () => {
            const filters = {
                or: [
                    { field1: { eq: "value1" } },
                    { field2: { eq: "value2" } }
                ]
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockQueryBuilder.orGroup).toHaveBeenCalled();
        });
        it("should handle NOT groups", () => {
            const filters = {
                not: [
                    { field: { eq: "unwanted" } }
                ]
            };
            (0, applyFIlters_1.applyFilters)(mockQueryBuilder, filters);
            expect(mockQueryBuilder.notGroup).toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbHlGaWx0ZXJzLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL2VuZ2luZXMvbWVpbGkvdXRpbHMvYXBwbHlGaWx0ZXJzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQSxpREFBOEM7QUFFOUMsa0JBQWtCO0FBQ2xCLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN0QyxZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzNCLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsS0FBSyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7S0FDakIsQ0FBQyxDQUFDO0NBQ0osQ0FBQyxDQUFDLENBQUM7QUFFSixRQUFRLENBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO0lBQ3hDLElBQUksZ0JBQTJDLENBQUM7SUFDaEQsSUFBSSxnQkFBcUIsQ0FBQztJQUUxQixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBRXJCLG1EQUFtRDtRQUNuRCxnQkFBZ0IsR0FBRztZQUNqQixFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUM5QixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUMvQixFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUM5QixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUMvQixFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUM5QixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUMvQixFQUFF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QUMsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFeEMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFDdkQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWUsIEdlbmVyaWNGaWx0ZXJDcml0ZXJpYSB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbnRpdHkvcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7IFF1ZXJ5QnVpbGRlciB9IGZyb20gXCIuLi9xdWVyeS1idWlsZGVyXCI7XG5pbXBvcnQgeyBhcHBseUZpbHRlcnMgfSBmcm9tIFwiLi9hcHBseUZJbHRlcnNcIjtcblxuLy8gTW9jayB0aGUgbG9nZ2VyXG5qZXN0Lm1vY2soXCIuLi8uLi8uLi8uLi9sb2dnaW5nXCIsICgpID0+ICh7XG4gIGNyZWF0ZUxvZ2dlcjogamVzdC5mbigoKSA9PiAoe1xuICAgIHdhcm46IGplc3QuZm4oKSxcbiAgICBlcnJvcjogamVzdC5mbigpLFxuICB9KSksXG59KSk7XG5cbmRlc2NyaWJlKFwiTWVpbGlTZWFyY2g6YXBwbHlGaWx0ZXJzXCIsICgpID0+IHtcbiAgbGV0IG1vY2tRdWVyeUJ1aWxkZXI6IGplc3QuTW9ja2VkPFF1ZXJ5QnVpbGRlcj47XG4gIGxldCBtb2NrV2hlcmVCdWlsZGVyOiBhbnk7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG5cbiAgICAvLyBDcmVhdGUgbW9jayB3aGVyZSBidWlsZGVyIHdpdGggY2hhaW5hYmxlIG1ldGhvZHNcbiAgICBtb2NrV2hlcmVCdWlsZGVyID0ge1xuICAgICAgZXE6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgbmVxOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICAgIGd0OiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICAgIGd0ZTogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBsdDogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBsdGU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgaW46IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgbm90SW46IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgcmFuZ2VUbzogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBpc051bGw6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgaXNOb3ROdWxsOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICAgIGV4aXN0czogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBub3RFeGlzdHM6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgY29udGFpbnM6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgc3RhcnRzV2l0aDogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgfTtcblxuICAgIG1vY2tRdWVyeUJ1aWxkZXIgPSB7XG4gICAgICB3aGVyZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShtb2NrV2hlcmVCdWlsZGVyKSxcbiAgICAgIGFuZEdyb3VwOiBqZXN0LmZuKCksXG4gICAgICBvckdyb3VwOiBqZXN0LmZuKCksXG4gICAgICBub3RHcm91cDogamVzdC5mbigpLFxuICAgICAgZmlsdGVyUmF3OiBqZXN0LmZuKCksXG4gICAgfSBhcyBhbnk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiQ29yZSBPcGVyYXRvcnNcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBhbGwgYmFzaWMgY29tcGFyaXNvbiBvcGVyYXRvcnNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQ6IHN0cmluZyB9PiA9IHtcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBlcTogXCJ2YWx1ZVwiLFxuICAgICAgICAgIG5lcTogXCJvdGhlclwiLFxuICAgICAgICAgIGd0OiAxMCxcbiAgICAgICAgICBndGU6IDUsXG4gICAgICAgICAgbHQ6IDIwLFxuICAgICAgICAgIGx0ZTogMTVcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1F1ZXJ5QnVpbGRlci53aGVyZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJmaWVsZFwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlXCIpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcIm90aGVyXCIpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuZ3QpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDEwKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmd0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoNSk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5sdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMjApO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubHRlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgxNSk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgYXJyYXkgb3BlcmF0b3JzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHRhZ3M6IHN0cmluZ1tdLCBjYXRlZ29yaWVzOiBzdHJpbmdbXSB9PiA9IHtcbiAgICAgICAgdGFnczogeyBpbjogWyBcInRhZzFcIiwgXCJ0YWcyXCIgXSB9LFxuICAgICAgICBjYXRlZ29yaWVzOiB7IG5pbjogWyBcImNhdDFcIiwgXCJjYXQyXCIgXSB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmluKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChbIFwidGFnMVwiLCBcInRhZzJcIiBdKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLm5vdEluKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChbIFwiY2F0MVwiLCBcImNhdDJcIiBdKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSByYW5nZSBvcGVyYXRvcnNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgcHJpY2U6IG51bWJlciwgc2NvcmU6IG51bWJlciB9PiA9IHtcbiAgICAgICAgcHJpY2U6IHsgYmV0d2VlbjogWyAxMCwgMjAgXSB9LFxuICAgICAgICBzY29yZTogeyBidDogeyBmcm9tOiAwLjUsIHRvOiAwLjkgfSB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLnJhbmdlVG8pLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDEwLCAyMCk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5yYW5nZVRvKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgwLjUsIDAuOSk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgc3RyaW5nIHBhdHRlcm4gb3BlcmF0b3JzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IG5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZyB9PiA9IHtcbiAgICAgICAgbmFtZTogeyBzdGFydHNXaXRoOiBcIkpvaG5cIiB9LFxuICAgICAgICBkZXNjcmlwdGlvbjogeyBjb250YWluczogXCJ0ZXN0XCIgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5zdGFydHNXaXRoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcIkpvaG5cIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5jb250YWlucykudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ0ZXN0XCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIGV4aXN0cyBhbmQgbm90RXhpc3RzIG9wZXJhdG9yc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDE6IGFueSwgZmllbGQyOiBhbnkgfT4gPSB7XG4gICAgICAgIGZpZWxkMTogeyBleGlzdHM6IHRydWUgfSxcbiAgICAgICAgZmllbGQyOiB7IG5vdEV4aXN0czogdHJ1ZSB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmV4aXN0cykudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubm90RXhpc3RzKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiTmV3IE9wZXJhdG9yc1wiLCAoKSA9PiB7XG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIG5vdENvbnRhaW5zIHdpdGggTk9UIGdyb3VwXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGRlc2NyaXB0aW9uOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiB7IG5vdENvbnRhaW5zOiBcInVud2FudGVkXCIgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1F1ZXJ5QnVpbGRlci5ub3RHcm91cCkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIGNvbnRhaW5zU29tZSB3aXRoIE9SIGdyb3VwXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHRhZ3M6IHN0cmluZ1tdIH0+ID0ge1xuICAgICAgICB0YWdzOiB7IGNvbnRhaW5zU29tZTogWyBcInRhZzFcIiwgXCJ0YWcyXCIsIFwidGFnM1wiIF0gfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1F1ZXJ5QnVpbGRlci5vckdyb3VwKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgZW5kc1dpdGggd2l0aCByYXcgZmlsdGVyIGZhbGxiYWNrXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpbGVuYW1lOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIGZpbGVuYW1lOiB7IGVuZHNXaXRoOiBcIi5wZGZcIiB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrUXVlcnlCdWlsZGVyLmZpbHRlclJhdykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2ZpbGVuYW1lIEVORFMgV0lUSCBcIi5wZGZcIicpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIGxpa2Ugb3BlcmF0b3Igd2l0aCBjb250YWlucyBhcHByb3hpbWF0aW9uXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHRpdGxlOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIHRpdGxlOiB7IGxpa2U6IFwicGF0dGVybiVcIiB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmNvbnRhaW5zKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInBhdHRlcm4lXCIpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIk9wZXJhdG9yIEFsaWFzZXNcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBlcXVhbGl0eSBhbGlhc2VzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBhbnkgfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgZXF1YWxUbzogXCJ2YWx1ZTFcIixcbiAgICAgICAgICBlcXVhbDogXCJ2YWx1ZTJcIixcbiAgICAgICAgICBcIj09PVwiOiBcInZhbHVlM1wiLFxuICAgICAgICAgIFwiPT1cIjogXCJ2YWx1ZTRcIlxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlMVwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlMlwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlM1wiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlNFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBpbmVxdWFsaXR5IGFsaWFzZXNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQ6IGFueSB9PiA9IHtcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBub3RFcXVhbFRvOiBcInZhbHVlMVwiLFxuICAgICAgICAgIFwiIT1cIjogXCJ2YWx1ZTJcIixcbiAgICAgICAgICBcIjw+XCI6IFwidmFsdWUzXCIsXG4gICAgICAgICAgbmU6IFwidmFsdWU0XCJcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5uZXEpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidmFsdWUxXCIpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlMlwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLm5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ2YWx1ZTNcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5uZXEpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidmFsdWU0XCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIGNvbXBhcmlzb24gYWxpYXNlc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDogbnVtYmVyIH0+ID0ge1xuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGdyZWF0ZXJUaGFuOiAxMCxcbiAgICAgICAgICBcIj5cIjogMTUsXG4gICAgICAgICAgZ3JlYXRlclRoYW5PckVxdWFsVG86IDIwLFxuICAgICAgICAgIFwiPj1cIjogMjUsXG4gICAgICAgICAgbGVzc1RoYW46IDMwLFxuICAgICAgICAgIFwiPFwiOiAzNSxcbiAgICAgICAgICBsZXNzVGhhbk9yRXF1YWxUbzogNDAsXG4gICAgICAgICAgXCI8PVwiOiA0NVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmd0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgxMCk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ndCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMTUpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuZ3RlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgyMCk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ndGUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDI1KTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmx0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgzMCk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5sdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMzUpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubHRlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCg0MCk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5sdGUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDQ1KTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBhcnJheSBvcGVyYXRpb24gYWxpYXNlc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDogc3RyaW5nW10gfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgaW5MaXN0OiBbIFwiYVwiLCBcImJcIiBdLFxuICAgICAgICAgIG5vdEluTGlzdDogWyBcImNcIiwgXCJkXCIgXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmluKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChbIFwiYVwiLCBcImJcIiBdKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLm5vdEluKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChbIFwiY1wiLCBcImRcIiBdKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBzdHJpbmcgcGF0dGVybiBhbGlhc2VzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgYmVnaW5zOiBcInN0YXJ0XCIsXG4gICAgICAgICAgYmVnaW5zV2l0aDogXCJwcmVmaXhcIixcbiAgICAgICAgICBpbmNsdWRlczogXCJjb250YWluc1wiLFxuICAgICAgICAgIGhhczogXCJjb250ZW50XCJcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5zdGFydHNXaXRoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInN0YXJ0XCIpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuc3RhcnRzV2l0aCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJwcmVmaXhcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5jb250YWlucykudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJjb250YWluc1wiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmNvbnRhaW5zKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcImNvbnRlbnRcIik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWUgU3VwcG9ydFwiLCAoKSA9PiB7XG4gICAgaXQoXCJzaG91bGQgZXh0cmFjdCB2YWx1ZSBmcm9tIENvbXBsZXhGaWx0ZXJPcGVyYXRvclZhbHVlXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBsZXhWYWx1ZTogQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWU8c3RyaW5nPiA9IHtcbiAgICAgICAgdmFsOiBcInRlc3RfdmFsdWVcIixcbiAgICAgICAgdmFsVHlwZTogXCJsaXRlcmFsXCIsXG4gICAgICAgIHZhbExhYmVsOiBcIlRlc3QgVmFsdWVcIlxuICAgICAgfTtcblxuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQ6IHN0cmluZyB9PiA9IHtcbiAgICAgICAgZmllbGQ6IHsgZXE6IGNvbXBsZXhWYWx1ZSB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInRlc3RfdmFsdWVcIik7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCB3YXJuIGFib3V0IHVuc3VwcG9ydGVkIHZhbFR5cGVzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBsZXhWYWx1ZTogQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWU8c3RyaW5nPiA9IHtcbiAgICAgICAgdmFsOiBcImZpZWxkX3JlZmVyZW5jZVwiLFxuICAgICAgICB2YWxUeXBlOiBcInByb3BSZWZcIixcbiAgICAgICAgdmFsTGFiZWw6IFwiT3RoZXIgRmllbGRcIlxuICAgICAgfTtcblxuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQ6IHN0cmluZyB9PiA9IHtcbiAgICAgICAgZmllbGQ6IHsgZXE6IGNvbXBsZXhWYWx1ZSB9XG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIC8vIFNob3VsZCBzdGlsbCB1c2UgdGhlIHZhbHVlIGJ1dCBsb2cgYSB3YXJuaW5nXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJmaWVsZF9yZWZlcmVuY2VcIik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiVHlwZSBDb2VyY2lvblwiLCAoKSA9PiB7XG4gICAgaXQoXCJzaG91bGQgY29lcmNlIG51bWVyaWMgc3RyaW5ncyB0byBudW1iZXJzIGZvciBjb21wYXJpc29uIG9wZXJhdGlvbnNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgYWdlOiBhbnksIHNjb3JlOiBhbnkgfT4gPSB7XG4gICAgICAgIGFnZTogeyBndDogXCIxOFwiIH0sIC8vIFN0cmluZyB0aGF0IHNob3VsZCBiZSBjb2VyY2VkXG4gICAgICAgIHNjb3JlOiB7IGx0ZTogXCI5NS41XCIgfSAvLyBTdHJpbmcgdGhhdCBzaG91bGQgYmUgY29lcmNlZFxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ndCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMTgpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubHRlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCg5NS41KTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIG5vdCBjb2VyY2Ugbm9uLW51bWVyaWMgc3RyaW5ncyBmb3IgY29tcGFyaXNvbiBvcGVyYXRpb25zXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IG5hbWU6IHN0cmluZyB9PiA9IHtcbiAgICAgICAgbmFtZTogeyBndDogXCJ6ZWJyYVwiIH0gLy8gU3RyaW5nIHRoYXQgc2hvdWxkIG5vdCBiZSBjb2VyY2VkXG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmd0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInplYnJhXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgbm90IGNvZXJjZSBmb3Igbm9uLWNvbXBhcmlzb24gb3BlcmF0aW9uc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDogc3RyaW5nIH0+ID0ge1xuICAgICAgICBmaWVsZDogeyBlcTogXCIxMjNcIiB9IC8vIFNob3VsZCByZW1haW4gYXMgc3RyaW5nXG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcIjEyM1wiKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJBcnJheSBOb3JtYWxpemF0aW9uXCIsICgpID0+IHtcbiAgICBpdChcInNob3VsZCBjb252ZXJ0IHNpbmdsZSB2YWx1ZXMgdG8gYXJyYXlzIGZvciBhcnJheSBvcGVyYXRpb25zXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHRhZ3M6IHN0cmluZ1tdIH0+ID0ge1xuICAgICAgICB0YWdzOiB7IGluOiBbIFwic2luZ2xlX3RhZ1wiIF0gfSAvLyBVc2UgYXJyYXkgdG8gc2F0aXNmeSB0eXBlIHJlcXVpcmVtZW50c1xuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5pbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoWyBcInNpbmdsZV90YWdcIiBdKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIHByZXNlcnZlIGFycmF5cyBmb3IgYXJyYXkgb3BlcmF0aW9uc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyB0YWdzOiBzdHJpbmdbXSB9PiA9IHtcbiAgICAgICAgdGFnczogeyBpbjogWyBcInRhZzFcIiwgXCJ0YWcyXCIgXSB9IC8vIEFycmF5IHRoYXQgc2hvdWxkIHJlbWFpbiBhcyBhcnJheVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5pbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoWyBcInRhZzFcIiwgXCJ0YWcyXCIgXSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiRXJyb3IgSGFuZGxpbmdcIiwgKCkgPT4ge1xuXG4gICAgaXQoXCJzaG91bGQgdGhyb3cgU2VhcmNoUXVlcnlFcnJvciBvbiBmaWx0ZXIgb3BlcmF0aW9uIGZhaWx1cmVcIiwgKCkgPT4ge1xuICAgICAgbW9ja1doZXJlQnVpbGRlci5lcS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4ge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJNb2NrIGVycm9yXCIpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7IGVxOiBcInZhbHVlXCIgfVxuICAgICAgfTtcblxuICAgICAgZXhwZWN0KCgpID0+IGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKSkudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIkZpbHRlciBHcm91cHNcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBBTkQgZ3JvdXBzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkMTogc3RyaW5nLCBmaWVsZDI6IG51bWJlciB9PiA9IHtcbiAgICAgICAgYW5kOiBbXG4gICAgICAgICAgeyBmaWVsZDE6IHsgZXE6IFwidmFsdWUxXCIgfSB9LFxuICAgICAgICAgIHsgZmllbGQyOiB7IGd0OiAxMCB9IH1cbiAgICAgICAgXVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1F1ZXJ5QnVpbGRlci5hbmRHcm91cCkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIE9SIGdyb3Vwc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDE6IHN0cmluZywgZmllbGQyOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIG9yOiBbXG4gICAgICAgICAgeyBmaWVsZDE6IHsgZXE6IFwidmFsdWUxXCIgfSB9LFxuICAgICAgICAgIHsgZmllbGQyOiB7IGVxOiBcInZhbHVlMlwiIH0gfVxuICAgICAgICBdXG4gICAgICB9O1xuXG4gICAgICBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycyk7XG5cbiAgICAgIGV4cGVjdChtb2NrUXVlcnlCdWlsZGVyLm9yR3JvdXApLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBOT1QgZ3JvdXBzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIG5vdDogW1xuICAgICAgICAgIHsgZmllbGQ6IHsgZXE6IFwidW53YW50ZWRcIiB9IH1cbiAgICAgICAgXVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1F1ZXJ5QnVpbGRlci5ub3RHcm91cCkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuICB9KTtcbn0pOyAiXX0=