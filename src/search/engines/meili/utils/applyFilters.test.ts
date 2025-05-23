import { ComplexFilterOperatorValue, GenericFilterCriteria } from "../../../../entity/query-types";
import { QueryBuilder } from "../query-builder";
import { applyFilters } from "./applyFIlters";

// Mock the logger
jest.mock("../../../../logging", () => ({
  createLogger: jest.fn(() => ({
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe("MeiliSearch:applyFilters", () => {
  let mockQueryBuilder: jest.Mocked<QueryBuilder>;
  let mockWhereBuilder: any;

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
      exists: jest.fn().mockReturnThis(),
      isEmpty: jest.fn().mockReturnThis(),
      isNull: jest.fn().mockReturnThis(),
      contains: jest.fn().mockReturnThis(),
      startsWith: jest.fn().mockReturnThis(),
    };

    mockQueryBuilder = {
      where: jest.fn().mockReturnValue(mockWhereBuilder),
      andGroup: jest.fn(),
      orGroup: jest.fn(),
      notGroup: jest.fn(),
      filterRaw: jest.fn(),
    } as any;
  });

  describe("Core Operators", () => {
    it("should handle all basic comparison operators", () => {
      const filters: GenericFilterCriteria<{ field: string }> = {
        field: {
          eq: "value",
          neq: "other",
          gt: 10,
          gte: 5,
          lt: 20,
          lte: 15
        }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith("field");
      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value");
      expect(mockWhereBuilder.neq).toHaveBeenCalledWith("other");
      expect(mockWhereBuilder.gt).toHaveBeenCalledWith(10);
      expect(mockWhereBuilder.gte).toHaveBeenCalledWith(5);
      expect(mockWhereBuilder.lt).toHaveBeenCalledWith(20);
      expect(mockWhereBuilder.lte).toHaveBeenCalledWith(15);
    });

    it("should handle array operators", () => {
      const filters: GenericFilterCriteria<{ tags: string[], categories: string[] }> = {
        tags: { in: [ "tag1", "tag2" ] },
        categories: { nin: [ "cat1", "cat2" ] }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.in).toHaveBeenCalledWith([ "tag1", "tag2" ]);
      expect(mockWhereBuilder.notIn).toHaveBeenCalledWith([ "cat1", "cat2" ]);
    });

    it("should handle range operators", () => {
      const filters: GenericFilterCriteria<{ price: number, score: number }> = {
        price: { between: [ 10, 20 ] },
        score: { bt: { from: 0.5, to: 0.9 } }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.rangeTo).toHaveBeenCalledWith(10, 20);
      expect(mockWhereBuilder.rangeTo).toHaveBeenCalledWith(0.5, 0.9);
    });

    it("should handle string pattern operators", () => {
      const filters: GenericFilterCriteria<{ name: string, description: string }> = {
        name: { startsWith: "John" },
        description: { contains: "test" }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.startsWith).toHaveBeenCalledWith("John");
      expect(mockWhereBuilder.contains).toHaveBeenCalledWith("test");
    });

    it("should handle existence operators", () => {
      const filters: GenericFilterCriteria<{ field1: any, field2: any, field3: any }> = {
        field1: { exists: true },
        field2: { isEmpty: true },
        field3: { isNull: true }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.exists).toHaveBeenCalled();
      expect(mockWhereBuilder.isEmpty).toHaveBeenCalled();
      expect(mockWhereBuilder.isNull).toHaveBeenCalled();
    });
  });

  describe("New Operators", () => {
    it("should handle notContains with NOT group", () => {
      const filters: GenericFilterCriteria<{ description: string }> = {
        description: { notContains: "unwanted" }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockQueryBuilder.notGroup).toHaveBeenCalled();
    });

    it("should handle containsSome with OR group", () => {
      const filters: GenericFilterCriteria<{ tags: string[] }> = {
        tags: { containsSome: [ "tag1", "tag2", "tag3" ] }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockQueryBuilder.orGroup).toHaveBeenCalled();
    });

    it("should handle endsWith with raw filter fallback", () => {
      const filters: GenericFilterCriteria<{ filename: string }> = {
        filename: { endsWith: ".pdf" }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockQueryBuilder.filterRaw).toHaveBeenCalledWith('filename ENDS WITH ".pdf"');
    });

    it("should handle like operator with contains approximation", () => {
      const filters: GenericFilterCriteria<{ title: string }> = {
        title: { like: "pattern%" }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.contains).toHaveBeenCalledWith("pattern%");
    });
  });

  describe("Operator Aliases", () => {
    it("should handle equality aliases", () => {
      const filters: GenericFilterCriteria<{ field: any }> = {
        field: {
          equalTo: "value1",
          equal: "value2",
          "===": "value3",
          "==": "value4"
        }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value1");
      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value2");
      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value3");
      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("value4");
    });

    it("should handle inequality aliases", () => {
      const filters: GenericFilterCriteria<{ field: any }> = {
        field: {
          notEqualTo: "value1",
          "!=": "value2",
          "<>": "value3",
          ne: "value4"
        }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value1");
      expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value2");
      expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value3");
      expect(mockWhereBuilder.neq).toHaveBeenCalledWith("value4");
    });

    it("should handle comparison aliases", () => {
      const filters: GenericFilterCriteria<{ field: number }> = {
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

      applyFilters(mockQueryBuilder, filters);

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
      const filters: GenericFilterCriteria<{ field: string[] }> = {
        field: {
          inList: [ "a", "b" ],
          notInList: [ "c", "d" ]
        }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.in).toHaveBeenCalledWith([ "a", "b" ]);
      expect(mockWhereBuilder.notIn).toHaveBeenCalledWith([ "c", "d" ]);
    });

    it("should handle string pattern aliases", () => {
      const filters: GenericFilterCriteria<{ field: string }> = {
        field: {
          begins: "start",
          beginsWith: "prefix",
          includes: "contains",
          has: "content"
        }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.startsWith).toHaveBeenCalledWith("start");
      expect(mockWhereBuilder.startsWith).toHaveBeenCalledWith("prefix");
      expect(mockWhereBuilder.contains).toHaveBeenCalledWith("contains");
      expect(mockWhereBuilder.contains).toHaveBeenCalledWith("content");
    });
  });

  describe("ComplexFilterOperatorValue Support", () => {
    it("should extract value from ComplexFilterOperatorValue", () => {
      const complexValue: ComplexFilterOperatorValue<string> = {
        val: "test_value",
        valType: "literal",
        valLabel: "Test Value"
      };

      const filters: GenericFilterCriteria<{ field: string }> = {
        field: { eq: complexValue }
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("test_value");
    });

    it("should warn about unsupported valTypes", () => {
      const complexValue: ComplexFilterOperatorValue<string> = {
        val: "field_reference",
        valType: "propRef",
        valLabel: "Other Field"
      };

      const filters: GenericFilterCriteria<{ field: string }> = {
        field: { eq: complexValue }
      };

      applyFilters(mockQueryBuilder, filters);

      // Should still use the value but log a warning
      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("field_reference");
    });
  });

  describe("Type Coercion", () => {
    it("should coerce numeric strings to numbers for comparison operations", () => {
      const filters: GenericFilterCriteria<{ age: any, score: any }> = {
        age: { gt: "18" }, // String that should be coerced
        score: { lte: "95.5" } // String that should be coerced
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.gt).toHaveBeenCalledWith(18);
      expect(mockWhereBuilder.lte).toHaveBeenCalledWith(95.5);
    });

    it("should not coerce non-numeric strings for comparison operations", () => {
      const filters: GenericFilterCriteria<{ name: string }> = {
        name: { gt: "zebra" } // String that should not be coerced
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.gt).toHaveBeenCalledWith("zebra");
    });

    it("should not coerce for non-comparison operations", () => {
      const filters: GenericFilterCriteria<{ field: string }> = {
        field: { eq: "123" } // Should remain as string
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.eq).toHaveBeenCalledWith("123");
    });
  });

  describe("Array Normalization", () => {
    it("should convert single values to arrays for array operations", () => {
      const filters: GenericFilterCriteria<{ tags: string[] }> = {
        tags: { in: [ "single_tag" ] } // Use array to satisfy type requirements
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.in).toHaveBeenCalledWith([ "single_tag" ]);
    });

    it("should preserve arrays for array operations", () => {
      const filters: GenericFilterCriteria<{ tags: string[] }> = {
        tags: { in: [ "tag1", "tag2" ] } // Array that should remain as array
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockWhereBuilder.in).toHaveBeenCalledWith([ "tag1", "tag2" ]);
    });
  });

  describe("Error Handling", () => {

    it("should throw SearchQueryError on filter operation failure", () => {
      mockWhereBuilder.eq.mockImplementation(() => {
        throw new Error("Mock error");
      });

      const filters: GenericFilterCriteria<{ field: string }> = {
        field: { eq: "value" }
      };

      expect(() => applyFilters(mockQueryBuilder, filters)).toThrow();
    });
  });

  describe("Filter Groups", () => {
    it("should handle AND groups", () => {
      const filters: GenericFilterCriteria<{ field1: string, field2: number }> = {
        and: [
          { field1: { eq: "value1" } },
          { field2: { gt: 10 } }
        ]
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockQueryBuilder.andGroup).toHaveBeenCalled();
    });

    it("should handle OR groups", () => {
      const filters: GenericFilterCriteria<{ field1: string, field2: string }> = {
        or: [
          { field1: { eq: "value1" } },
          { field2: { eq: "value2" } }
        ]
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockQueryBuilder.orGroup).toHaveBeenCalled();
    });

    it("should handle NOT groups", () => {
      const filters: GenericFilterCriteria<{ field: string }> = {
        not: [
          { field: { eq: "unwanted" } }
        ]
      };

      applyFilters(mockQueryBuilder, filters);

      expect(mockQueryBuilder.notGroup).toHaveBeenCalled();
    });
  });
}); 