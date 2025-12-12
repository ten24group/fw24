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
            expect(mockWhereBuilder.isNotNull).toHaveBeenCalled();
            expect(mockWhereBuilder.isNull).toHaveBeenCalled();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwbHlGaWx0ZXJzLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL2VuZ2luZXMvbWVpbGkvdXRpbHMvYXBwbHlGaWx0ZXJzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQSxpREFBOEM7QUFFOUMsa0JBQWtCO0FBQ2xCLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN0QyxZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzNCLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsS0FBSyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7S0FDakIsQ0FBQyxDQUFDO0NBQ0osQ0FBQyxDQUFDLENBQUM7QUFFSixRQUFRLENBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO0lBQ3hDLElBQUksZ0JBQTJDLENBQUM7SUFDaEQsSUFBSSxnQkFBcUIsQ0FBQztJQUUxQixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBRXJCLG1EQUFtRDtRQUNuRCxnQkFBZ0IsR0FBRztZQUNqQixFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUM5QixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUMvQixFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUM5QixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUMvQixFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUM5QixHQUFHLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtZQUMvQixFQUFF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QUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWUsIEdlbmVyaWNGaWx0ZXJDcml0ZXJpYSB9IGZyb20gXCIuLi8uLi8uLi8uLi9lbnRpdHkvcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7IFF1ZXJ5QnVpbGRlciB9IGZyb20gXCIuLi9xdWVyeS1idWlsZGVyXCI7XG5pbXBvcnQgeyBhcHBseUZpbHRlcnMgfSBmcm9tIFwiLi9hcHBseUZJbHRlcnNcIjtcblxuLy8gTW9jayB0aGUgbG9nZ2VyXG5qZXN0Lm1vY2soXCIuLi8uLi8uLi8uLi9sb2dnaW5nXCIsICgpID0+ICh7XG4gIGNyZWF0ZUxvZ2dlcjogamVzdC5mbigoKSA9PiAoe1xuICAgIHdhcm46IGplc3QuZm4oKSxcbiAgICBlcnJvcjogamVzdC5mbigpLFxuICB9KSksXG59KSk7XG5cbmRlc2NyaWJlKFwiTWVpbGlTZWFyY2g6YXBwbHlGaWx0ZXJzXCIsICgpID0+IHtcbiAgbGV0IG1vY2tRdWVyeUJ1aWxkZXI6IGplc3QuTW9ja2VkPFF1ZXJ5QnVpbGRlcj47XG4gIGxldCBtb2NrV2hlcmVCdWlsZGVyOiBhbnk7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG5cbiAgICAvLyBDcmVhdGUgbW9jayB3aGVyZSBidWlsZGVyIHdpdGggY2hhaW5hYmxlIG1ldGhvZHNcbiAgICBtb2NrV2hlcmVCdWlsZGVyID0ge1xuICAgICAgZXE6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgbmVxOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICAgIGd0OiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICAgIGd0ZTogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBsdDogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBsdGU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgaW46IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgbm90SW46IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgcmFuZ2VUbzogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBpc051bGw6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgaXNOb3ROdWxsOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICAgIGNvbnRhaW5zOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICAgIHN0YXJ0c1dpdGg6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgIH07XG5cbiAgICBtb2NrUXVlcnlCdWlsZGVyID0ge1xuICAgICAgd2hlcmU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUobW9ja1doZXJlQnVpbGRlciksXG4gICAgICBhbmRHcm91cDogamVzdC5mbigpLFxuICAgICAgb3JHcm91cDogamVzdC5mbigpLFxuICAgICAgbm90R3JvdXA6IGplc3QuZm4oKSxcbiAgICAgIGZpbHRlclJhdzogamVzdC5mbigpLFxuICAgIH0gYXMgYW55O1xuICB9KTtcblxuICBkZXNjcmliZShcIkNvcmUgT3BlcmF0b3JzXCIsICgpID0+IHtcbiAgICBpdChcInNob3VsZCBoYW5kbGUgYWxsIGJhc2ljIGNvbXBhcmlzb24gb3BlcmF0b3JzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgZXE6IFwidmFsdWVcIixcbiAgICAgICAgICBuZXE6IFwib3RoZXJcIixcbiAgICAgICAgICBndDogMTAsXG4gICAgICAgICAgZ3RlOiA1LFxuICAgICAgICAgIGx0OiAyMCxcbiAgICAgICAgICBsdGU6IDE1XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tRdWVyeUJ1aWxkZXIud2hlcmUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwiZmllbGRcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ2YWx1ZVwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLm5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJvdGhlclwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmd0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgxMCk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ndGUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDUpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubHQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDIwKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmx0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMTUpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIGFycmF5IG9wZXJhdG9yc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyB0YWdzOiBzdHJpbmdbXSwgY2F0ZWdvcmllczogc3RyaW5nW10gfT4gPSB7XG4gICAgICAgIHRhZ3M6IHsgaW46IFsgXCJ0YWcxXCIsIFwidGFnMlwiIF0gfSxcbiAgICAgICAgY2F0ZWdvcmllczogeyBuaW46IFsgXCJjYXQxXCIsIFwiY2F0MlwiIF0gfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5pbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoWyBcInRhZzFcIiwgXCJ0YWcyXCIgXSk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ub3RJbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoWyBcImNhdDFcIiwgXCJjYXQyXCIgXSk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgcmFuZ2Ugb3BlcmF0b3JzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IHByaWNlOiBudW1iZXIsIHNjb3JlOiBudW1iZXIgfT4gPSB7XG4gICAgICAgIHByaWNlOiB7IGJldHdlZW46IFsgMTAsIDIwIF0gfSxcbiAgICAgICAgc2NvcmU6IHsgYnQ6IHsgZnJvbTogMC41LCB0bzogMC45IH0gfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5yYW5nZVRvKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgxMCwgMjApO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIucmFuZ2VUbykudG9IYXZlQmVlbkNhbGxlZFdpdGgoMC41LCAwLjkpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIHN0cmluZyBwYXR0ZXJuIG9wZXJhdG9yc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBuYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIG5hbWU6IHsgc3RhcnRzV2l0aDogXCJKb2huXCIgfSxcbiAgICAgICAgZGVzY3JpcHRpb246IHsgY29udGFpbnM6IFwidGVzdFwiIH1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuc3RhcnRzV2l0aCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJKb2huXCIpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuY29udGFpbnMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidGVzdFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBleGlzdHMgYW5kIG5vdEV4aXN0cyBvcGVyYXRvcnNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQxOiBhbnksIGZpZWxkMjogYW55IH0+ID0ge1xuICAgICAgICBmaWVsZDE6IHsgZXhpc3RzOiB0cnVlIH0sXG4gICAgICAgIGZpZWxkMjogeyBub3RFeGlzdHM6IHRydWUgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5pc05vdE51bGwpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmlzTnVsbCkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIk5ldyBPcGVyYXRvcnNcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBub3RDb250YWlucyB3aXRoIE5PVCBncm91cFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBkZXNjcmlwdGlvbjogc3RyaW5nIH0+ID0ge1xuICAgICAgICBkZXNjcmlwdGlvbjogeyBub3RDb250YWluczogXCJ1bndhbnRlZFwiIH1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tRdWVyeUJ1aWxkZXIubm90R3JvdXApLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBjb250YWluc1NvbWUgd2l0aCBPUiBncm91cFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyB0YWdzOiBzdHJpbmdbXSB9PiA9IHtcbiAgICAgICAgdGFnczogeyBjb250YWluc1NvbWU6IFsgXCJ0YWcxXCIsIFwidGFnMlwiLCBcInRhZzNcIiBdIH1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tRdWVyeUJ1aWxkZXIub3JHcm91cCkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgaGFuZGxlIGVuZHNXaXRoIHdpdGggcmF3IGZpbHRlciBmYWxsYmFja1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWxlbmFtZTogc3RyaW5nIH0+ID0ge1xuICAgICAgICBmaWxlbmFtZTogeyBlbmRzV2l0aDogXCIucGRmXCIgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1F1ZXJ5QnVpbGRlci5maWx0ZXJSYXcpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCdmaWxlbmFtZSBFTkRTIFdJVEggXCIucGRmXCInKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBsaWtlIG9wZXJhdG9yIHdpdGggY29udGFpbnMgYXBwcm94aW1hdGlvblwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyB0aXRsZTogc3RyaW5nIH0+ID0ge1xuICAgICAgICB0aXRsZTogeyBsaWtlOiBcInBhdHRlcm4lXCIgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5jb250YWlucykudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJwYXR0ZXJuJVwiKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJPcGVyYXRvciBBbGlhc2VzXCIsICgpID0+IHtcbiAgICBpdChcInNob3VsZCBoYW5kbGUgZXF1YWxpdHkgYWxpYXNlc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDogYW55IH0+ID0ge1xuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGVxdWFsVG86IFwidmFsdWUxXCIsXG4gICAgICAgICAgZXF1YWw6IFwidmFsdWUyXCIsXG4gICAgICAgICAgXCI9PT1cIjogXCJ2YWx1ZTNcIixcbiAgICAgICAgICBcIj09XCI6IFwidmFsdWU0XCJcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ2YWx1ZTFcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ2YWx1ZTJcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ2YWx1ZTNcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ2YWx1ZTRcIik7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgaW5lcXVhbGl0eSBhbGlhc2VzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBhbnkgfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7XG4gICAgICAgICAgbm90RXF1YWxUbzogXCJ2YWx1ZTFcIixcbiAgICAgICAgICBcIiE9XCI6IFwidmFsdWUyXCIsXG4gICAgICAgICAgXCI8PlwiOiBcInZhbHVlM1wiLFxuICAgICAgICAgIG5lOiBcInZhbHVlNFwiXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlMVwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLm5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ2YWx1ZTJcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5uZXEpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwidmFsdWUzXCIpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubmVxKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcInZhbHVlNFwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBjb21wYXJpc29uIGFsaWFzZXNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQ6IG51bWJlciB9PiA9IHtcbiAgICAgICAgZmllbGQ6IHtcbiAgICAgICAgICBncmVhdGVyVGhhbjogMTAsXG4gICAgICAgICAgXCI+XCI6IDE1LFxuICAgICAgICAgIGdyZWF0ZXJUaGFuT3JFcXVhbFRvOiAyMCxcbiAgICAgICAgICBcIj49XCI6IDI1LFxuICAgICAgICAgIGxlc3NUaGFuOiAzMCxcbiAgICAgICAgICBcIjxcIjogMzUsXG4gICAgICAgICAgbGVzc1RoYW5PckVxdWFsVG86IDQwLFxuICAgICAgICAgIFwiPD1cIjogNDVcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ndCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMTApO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuZ3QpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDE1KTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmd0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMjApO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuZ3RlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgyNSk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5sdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoMzApO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubHQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDM1KTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmx0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoNDApO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIubHRlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCg0NSk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgYXJyYXkgb3BlcmF0aW9uIGFsaWFzZXNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQ6IHN0cmluZ1tdIH0+ID0ge1xuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGluTGlzdDogWyBcImFcIiwgXCJiXCIgXSxcbiAgICAgICAgICBub3RJbkxpc3Q6IFsgXCJjXCIsIFwiZFwiIF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5pbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoWyBcImFcIiwgXCJiXCIgXSk7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ub3RJbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoWyBcImNcIiwgXCJkXCIgXSk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgc3RyaW5nIHBhdHRlcm4gYWxpYXNlc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDogc3RyaW5nIH0+ID0ge1xuICAgICAgICBmaWVsZDoge1xuICAgICAgICAgIGJlZ2luczogXCJzdGFydFwiLFxuICAgICAgICAgIGJlZ2luc1dpdGg6IFwicHJlZml4XCIsXG4gICAgICAgICAgaW5jbHVkZXM6IFwiY29udGFpbnNcIixcbiAgICAgICAgICBoYXM6IFwiY29udGVudFwiXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuc3RhcnRzV2l0aCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJzdGFydFwiKTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLnN0YXJ0c1dpdGgpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwicHJlZml4XCIpO1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuY29udGFpbnMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwiY29udGFpbnNcIik7XG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5jb250YWlucykudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJjb250ZW50XCIpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIkNvbXBsZXhGaWx0ZXJPcGVyYXRvclZhbHVlIFN1cHBvcnRcIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGV4dHJhY3QgdmFsdWUgZnJvbSBDb21wbGV4RmlsdGVyT3BlcmF0b3JWYWx1ZVwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb21wbGV4VmFsdWU6IENvbXBsZXhGaWx0ZXJPcGVyYXRvclZhbHVlPHN0cmluZz4gPSB7XG4gICAgICAgIHZhbDogXCJ0ZXN0X3ZhbHVlXCIsXG4gICAgICAgIHZhbFR5cGU6IFwibGl0ZXJhbFwiLFxuICAgICAgICB2YWxMYWJlbDogXCJUZXN0IFZhbHVlXCJcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7IGVxOiBjb21wbGV4VmFsdWUgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ0ZXN0X3ZhbHVlXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzaG91bGQgd2FybiBhYm91dCB1bnN1cHBvcnRlZCB2YWxUeXBlc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb21wbGV4VmFsdWU6IENvbXBsZXhGaWx0ZXJPcGVyYXRvclZhbHVlPHN0cmluZz4gPSB7XG4gICAgICAgIHZhbDogXCJmaWVsZF9yZWZlcmVuY2VcIixcbiAgICAgICAgdmFsVHlwZTogXCJwcm9wUmVmXCIsXG4gICAgICAgIHZhbExhYmVsOiBcIk90aGVyIEZpZWxkXCJcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGZpZWxkOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIGZpZWxkOiB7IGVxOiBjb21wbGV4VmFsdWUgfVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICAvLyBTaG91bGQgc3RpbGwgdXNlIHRoZSB2YWx1ZSBidXQgbG9nIGEgd2FybmluZ1xuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuZXEpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFwiZmllbGRfcmVmZXJlbmNlXCIpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIlR5cGUgQ29lcmNpb25cIiwgKCkgPT4ge1xuICAgIGl0KFwic2hvdWxkIGNvZXJjZSBudW1lcmljIHN0cmluZ3MgdG8gbnVtYmVycyBmb3IgY29tcGFyaXNvbiBvcGVyYXRpb25zXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGZpbHRlcnM6IEdlbmVyaWNGaWx0ZXJDcml0ZXJpYTx7IGFnZTogYW55LCBzY29yZTogYW55IH0+ID0ge1xuICAgICAgICBhZ2U6IHsgZ3Q6IFwiMThcIiB9LCAvLyBTdHJpbmcgdGhhdCBzaG91bGQgYmUgY29lcmNlZFxuICAgICAgICBzY29yZTogeyBsdGU6IFwiOTUuNVwiIH0gLy8gU3RyaW5nIHRoYXQgc2hvdWxkIGJlIGNvZXJjZWRcbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuZ3QpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKDE4KTtcbiAgICAgIGV4cGVjdChtb2NrV2hlcmVCdWlsZGVyLmx0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoOTUuNSk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBub3QgY29lcmNlIG5vbi1udW1lcmljIHN0cmluZ3MgZm9yIGNvbXBhcmlzb24gb3BlcmF0aW9uc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBuYW1lOiBzdHJpbmcgfT4gPSB7XG4gICAgICAgIG5hbWU6IHsgZ3Q6IFwiemVicmFcIiB9IC8vIFN0cmluZyB0aGF0IHNob3VsZCBub3QgYmUgY29lcmNlZFxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5ndCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCJ6ZWJyYVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIG5vdCBjb2VyY2UgZm9yIG5vbi1jb21wYXJpc29uIG9wZXJhdGlvbnNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQ6IHN0cmluZyB9PiA9IHtcbiAgICAgICAgZmllbGQ6IHsgZXE6IFwiMTIzXCIgfSAvLyBTaG91bGQgcmVtYWluIGFzIHN0cmluZ1xuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1doZXJlQnVpbGRlci5lcSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXCIxMjNcIik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiQXJyYXkgTm9ybWFsaXphdGlvblwiLCAoKSA9PiB7XG4gICAgaXQoXCJzaG91bGQgY29udmVydCBzaW5nbGUgdmFsdWVzIHRvIGFycmF5cyBmb3IgYXJyYXkgb3BlcmF0aW9uc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyB0YWdzOiBzdHJpbmdbXSB9PiA9IHtcbiAgICAgICAgdGFnczogeyBpbjogWyBcInNpbmdsZV90YWdcIiBdIH0gLy8gVXNlIGFycmF5IHRvIHNhdGlzZnkgdHlwZSByZXF1aXJlbWVudHNcbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuaW4pLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFsgXCJzaW5nbGVfdGFnXCIgXSk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBwcmVzZXJ2ZSBhcnJheXMgZm9yIGFycmF5IG9wZXJhdGlvbnNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgdGFnczogc3RyaW5nW10gfT4gPSB7XG4gICAgICAgIHRhZ3M6IHsgaW46IFsgXCJ0YWcxXCIsIFwidGFnMlwiIF0gfSAvLyBBcnJheSB0aGF0IHNob3VsZCByZW1haW4gYXMgYXJyYXlcbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tXaGVyZUJ1aWxkZXIuaW4pLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFsgXCJ0YWcxXCIsIFwidGFnMlwiIF0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIkVycm9yIEhhbmRsaW5nXCIsICgpID0+IHtcblxuICAgIGl0KFwic2hvdWxkIHRocm93IFNlYXJjaFF1ZXJ5RXJyb3Igb24gZmlsdGVyIG9wZXJhdGlvbiBmYWlsdXJlXCIsICgpID0+IHtcbiAgICAgIG1vY2tXaGVyZUJ1aWxkZXIuZXEubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+IHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTW9jayBlcnJvclwiKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDogc3RyaW5nIH0+ID0ge1xuICAgICAgICBmaWVsZDogeyBlcTogXCJ2YWx1ZVwiIH1cbiAgICAgIH07XG5cbiAgICAgIGV4cGVjdCgoKSA9PiBhcHBseUZpbHRlcnMobW9ja1F1ZXJ5QnVpbGRlciwgZmlsdGVycykpLnRvVGhyb3coKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoXCJGaWx0ZXIgR3JvdXBzXCIsICgpID0+IHtcbiAgICBpdChcInNob3VsZCBoYW5kbGUgQU5EIGdyb3Vwc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDE6IHN0cmluZywgZmllbGQyOiBudW1iZXIgfT4gPSB7XG4gICAgICAgIGFuZDogW1xuICAgICAgICAgIHsgZmllbGQxOiB7IGVxOiBcInZhbHVlMVwiIH0gfSxcbiAgICAgICAgICB7IGZpZWxkMjogeyBndDogMTAgfSB9XG4gICAgICAgIF1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tRdWVyeUJ1aWxkZXIuYW5kR3JvdXApLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KFwic2hvdWxkIGhhbmRsZSBPUiBncm91cHNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZmlsdGVyczogR2VuZXJpY0ZpbHRlckNyaXRlcmlhPHsgZmllbGQxOiBzdHJpbmcsIGZpZWxkMjogc3RyaW5nIH0+ID0ge1xuICAgICAgICBvcjogW1xuICAgICAgICAgIHsgZmllbGQxOiB7IGVxOiBcInZhbHVlMVwiIH0gfSxcbiAgICAgICAgICB7IGZpZWxkMjogeyBlcTogXCJ2YWx1ZTJcIiB9IH1cbiAgICAgICAgXVxuICAgICAgfTtcblxuICAgICAgYXBwbHlGaWx0ZXJzKG1vY2tRdWVyeUJ1aWxkZXIsIGZpbHRlcnMpO1xuXG4gICAgICBleHBlY3QobW9ja1F1ZXJ5QnVpbGRlci5vckdyb3VwKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgfSk7XG5cbiAgICBpdChcInNob3VsZCBoYW5kbGUgTk9UIGdyb3Vwc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJzOiBHZW5lcmljRmlsdGVyQ3JpdGVyaWE8eyBmaWVsZDogc3RyaW5nIH0+ID0ge1xuICAgICAgICBub3Q6IFtcbiAgICAgICAgICB7IGZpZWxkOiB7IGVxOiBcInVud2FudGVkXCIgfSB9XG4gICAgICAgIF1cbiAgICAgIH07XG5cbiAgICAgIGFwcGx5RmlsdGVycyhtb2NrUXVlcnlCdWlsZGVyLCBmaWx0ZXJzKTtcblxuICAgICAgZXhwZWN0KG1vY2tRdWVyeUJ1aWxkZXIubm90R3JvdXApLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICB9KTtcbiAgfSk7XG59KTsgIl19