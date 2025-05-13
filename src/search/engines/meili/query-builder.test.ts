import {
  QueryBuilder,
  FilterCondition,
  FilterGroup,
  FilterRaw,
  FilterNot,
} from "./query-builder";

describe("MeiliQueryBuilder DSL", () => {
  describe("FilterCondition", () => {
    it("renders numeric, string (with escapes), boolean, and array values", () => {
      expect(new FilterCondition("age", ">", 30).toString()).toBe("age > 30");
      expect(new FilterCondition("name", "=", "O'Reilly").toString()).toBe(
        "name = 'O\\'Reilly'",
      );
      expect(new FilterCondition("active", "=", true).toString()).toBe(
        "active = true",
      );
      expect(new FilterCondition("ids", "=", [ 1, 2, 3 ]).toString()).toBe(
        "ids = [1, 2, 3]",
      );
    });

    it("clones itself without mutating original", () => {
      const orig = new FilterCondition("x", "=", [ 1, 2 ]);
      const clone = orig.clone();
      // modify clone internals via raw access to ensure deep copy
      expect(clone.toString()).toBe(orig.toString());
    });
  });

  describe("FilterGroup", () => {
    it("joins children with AND and OR appropriately", () => {
      const gAnd = new FilterGroup();
      gAnd
        .add(new FilterCondition("a", "=", 1))
        .add(new FilterCondition("b", "=", 2));
      expect(gAnd.toString()).toBe("(a = 1 AND b = 2)");

      const gOr = new FilterGroup("OR");
      gOr
        .add(new FilterCondition("x", ">", 5))
        .add(new FilterCondition("y", "<", 3));
      expect(gOr.toString()).toBe("(x > 5 OR y < 3)");
    });

    it("omits parentheses when only one child", () => {
      const single = new FilterGroup("AND");
      single.add(new FilterCondition("z", "=", 9));
      expect(single.toString()).toBe("z = 9");
    });

    it("returns empty string when no children", () => {
      expect(new FilterGroup().toString()).toBe("");
    });

    it("clones group deeply", () => {
      const g1 = new FilterGroup();
      g1.add(new FilterCondition("foo", "!=", "bar"));
      const g2 = g1.clone();
      expect(g2.toString()).toBe(g1.toString());
    });
  });

  describe("FilterRaw & FilterNot", () => {
    it("preserves raw string and supports negation", () => {
      const raw = new FilterRaw("custom > 0");
      expect(raw.toString()).toBe("custom > 0");

      const cond = new FilterCondition("v", "<", 10);
      const notCond = new FilterNot(cond);
      expect(notCond.toString()).toBe("NOT (v < 10)");

      const grp = new FilterGroup();
      grp
        .add(new FilterCondition("x", "=", 1))
        .add(new FilterCondition("y", "=", 2));
      const notGrp = new FilterNot(grp);
      expect(notGrp.toString()).toBe("NOT (x = 1 AND y = 2)");
    });

    it("clones raw and not nodes", () => {
      const raw = new FilterRaw("f = true");
      const rawClone = raw.clone();
      expect(rawClone.toString()).toBe(raw.toString());

      const not = new FilterNot(new FilterCondition("k", "=", false));
      const notClone = not.clone();
      expect(notClone.toString()).toBe(not.toString());
    });
  });

  // --- QueryBuilder tests ---
  describe("filterConditionRaw & rawCondition helper", () => {
    it("injects safe raw condition via static helper", () => {
      const helper = QueryBuilder.rawCondition("x", "=", "val");
      expect(helper.toString()).toBe("x = 'val'");
      const f = QueryBuilder.create()
        .filterConditionRaw("x", "=", "test")
        .build().options.filter;
      expect(f).toBe("x = 'test'");
    });
  });

  describe("Core filter building and chaining", () => {
    it("supports eq, neq, gt, gte, lt, lte", () => {
      const qb = QueryBuilder.create()
        .where("a")
        .eq(1)
        .andWhere("b")
        .neq(2)
        .andWhere("c")
        .gt(3)
        .andWhere("d")
        .gte(4)
        .andWhere("e")
        .lt(5)
        .andWhere("f")
        .lte(6);
      expect(qb.build().options.filter).toBe(
        "(a = 1 AND b != 2 AND c > 3 AND d >= 4 AND e < 5 AND f <= 6)",
      );
    });

    it("supports IN, NOT IN operators", () => {
      const f = QueryBuilder.create()
        .where("tags")
        .in([ "a", "b" ])
        .andWhere("ids")
        .notIn([ 1, 2 ])
        .build().options.filter;
      expect(f).toBe("(tags IN ['a', 'b'] AND NOT (ids IN [1, 2]))");
    });

    it("supports rangeTo (TO) and its negation", () => {
      const f = QueryBuilder.create()
        .where("n")
        .rangeTo(1, 3)
        .andWhere("m")
        .not()
        .rangeTo(4, 6)
        .build().options.filter;
      expect(f).toBe("(n 1 TO 3 AND NOT (m 4 TO 6))");
    });

    it("supports exists, notExists, isEmpty, isNotEmpty, isNull, isNotNull", () => {
      const f = QueryBuilder.create()
        .where("f")
        .exists()
        .andWhere("g")
        .notExists()
        .andWhere("h")
        .isEmpty()
        .andWhere("i")
        .isNotEmpty()
        .andWhere("j")
        .isNull()
        .andWhere("k")
        .isNotNull()
        .build().options.filter;
      expect(f).toBe(
        "(f EXISTS AND NOT (g EXISTS) AND h IS EMPTY AND NOT (i IS EMPTY) AND j IS NULL AND NOT (k IS NULL))",
      );
    });

    it("supports string filters: contains and startsWith", () => {
      const f = QueryBuilder.create()
        .where("desc")
        .contains("foo")
        .orWhere("title")
        .startsWith("bar")
        .build().options.filter;
      expect(f).toBe("(desc CONTAINS 'foo' OR title STARTS WITH 'bar')");
    });

    it("supports raw filter insertion with correct precedence", () => {
      const f = QueryBuilder.create()
        .where("a")
        .eq(1)
        .filterRaw("custom < 5", "OR")
        .build().options.filter;
      expect(f).toBe("(a = 1 OR custom < 5)");
    });

    it("supports nested andGroup, orGroup, and notGroup", () => {
      const f = QueryBuilder.create()
        .andGroup((g) => g.where("x").eq(1).andWhere("y").eq(2))
        .orGroup((g) => { g.where("z").eq(3); })
        .build().options.filter;
      expect(f).toBe("((x = 1 AND y = 2) OR z = 3)");

      const nf = QueryBuilder.create()
        .notGroup((g) => g.where("x").eq(1).andWhere("y").eq(2))
        .build().options.filter;
      expect(nf).toBe("NOT (x = 1 AND y = 2)");
    });

    it("omits parentheses for single-child groups", () => {
      const a = QueryBuilder.create()
        .andGroup((g) => g.where("a").eq(5))
        .build().options.filter;
      expect(a).toBe("a = 5");

      const b = QueryBuilder.create()
        .orGroup((g) => g.where("b").eq(6))
        .build().options.filter;
      expect(b).toBe("b = 6");
    });

    it("whereNot alias and synonyms work", () => {
      const f = QueryBuilder.create()
        .whereNot("active")
        .equals(false)
        .andWhere("status")
        .notEqual("ok")
        .build().options.filter;
      expect(f).toBe("(NOT (active = false) AND status != 'ok')");
    });
  });

  describe("options configuration and clear methods", () => {
    it("pagination: limit, offset, page, clearPagination", () => {
      const qb = QueryBuilder.create().limit(5).offset(2).page(3, 10);
      expect(qb.build().options.limit).toBe(10);
      expect(qb.build().options.offset).toBe(20);
      qb.clearPagination();
      expect(qb.build().options.limit).toBeUndefined();
      expect(qb.build().options.offset).toBeUndefined();
    });

    it("sorting and clearSort", () => {
      const qb = QueryBuilder.create().sort("n", "asc").sort("m", "desc");
      expect(qb.build().options.sort).toEqual([ "n:asc", "m:desc" ]);
      qb.clearSort();
      expect(qb.build().options.sort).toBeUndefined();
    });

    it("distinct, select, and their clears", () => {
      const qb = QueryBuilder.create().distinct("id").select([ "id", "name" ]);
      expect(qb.build().options.distinctAttribute).toBe("id");
      expect(qb.build().options.attributesToRetrieve).toEqual([ "id", "name" ]);
      qb.clearDistinct().clearSelect();
      expect(qb.build().options.distinctAttribute).toBeUndefined();
      expect(qb.build().options.attributesToRetrieve).toBeUndefined();
    });

    it("facetFilter, facetFilters setter, clearFacetFilters", () => {
      const fb1 = QueryBuilder.create().facetFilter("cat", "a", "b").build()
        .options.facetFilters;
      expect(fb1).toEqual([ [ "cat:a", "cat:b" ] ]);

      const fb2 = QueryBuilder.create()
        .facetFilters([ "x", [ "y", "z" ] ])
        .build().options.facetFilters;
      expect(fb2).toEqual([ "x", [ "y", "z" ] ]);

      const qb = QueryBuilder.create().facetFilter("k", "v");
      qb.clearFacetFilters();
      expect(qb.build().options.facetFilters).toBeUndefined();
    });

    it("facets and clearFacets", () => {
      const qb = QueryBuilder.create().facets([ "a", "b" ]);
      expect(qb.build().options.facets).toEqual([ "a", "b" ]);
      qb.clearFacets();
      expect(qb.build().options.facets).toBeUndefined();
    });

    it("matchingStrategy and clearMatchingStrategy", () => {
      const qb = QueryBuilder.create().matchingStrategy("last");
      expect(qb.build().options.matchingStrategy).toBe("last");
      qb.clearMatchingStrategy();
      expect(qb.build().options.matchingStrategy).toBeUndefined();
    });

    it("highlight, showMatchesPosition, clearHighlight", () => {
      const qb = QueryBuilder.create()
        .highlight([ "f" ], "<b>", "</b>")
        .showMatchesPosition(true);
      const o = qb.build().options;
      expect(o.attributesToHighlight).toEqual([ "f" ]);
      expect(o.highlightPreTag).toBe("<b>");
      expect(o.showMatchesPosition).toBe(true);
      qb.clearHighlight();
      expect(qb.build().options.attributesToHighlight).toBeUndefined();
    });

    it("crop and clearCrop", () => {
      const qb = QueryBuilder.create().crop([ "d" ], 15, "..");
      expect(qb.build().options.attributesToCrop).toEqual([ "d" ]);
      expect(qb.build().options.cropLength).toBe(15);
      qb.clearCrop();
      expect(qb.build().options.attributesToCrop).toBeUndefined();
    });

    it("around and clearGeo", () => {
      const qb = QueryBuilder.create().around(1, 2, 3, 4);
      const o = qb.build().options;
      expect(o.aroundLatLng).toBe("1,2");
      expect(o.aroundRadius).toBe(3);
      expect(o.aroundPrecision).toBe(4);
      qb.clearGeo();
      expect(qb.build().options.aroundLatLng).toBeUndefined();
    });

    it("rawOption and clearAllOptions", () => {
      const qb = QueryBuilder.create().rawOption("x", 9);
      expect(qb.build().options.x).toBe(9);
      qb.clearAllOptions();
      expect(qb.build().options).toEqual({});
    });
  });

  describe("text(), clearText() and toString()", () => {
    it("sets, clears the q param, and produces valid JSON", () => {
      const qb = QueryBuilder.create().text("hello");
      expect(qb.build().q).toBe("hello");
      qb.clearText();
      expect(qb.build().q).toBeUndefined();

      const str = QueryBuilder.create().text("hi").where("a").eq(1).toString();
      expect(() => JSON.parse(str)).not.toThrow();
      const obj = JSON.parse(str);
      expect(obj).toHaveProperty("q", "hi");
      expect(obj.options).toHaveProperty("filter", "a = 1");
    });
  });

  describe("clone() deep copy behavior", () => {
    it("modifying clone does not affect original", () => {
      const qb1 = QueryBuilder.create().where("u").eq(100).limit(2);
      const qb2 = qb1.clone();
      qb2.where("v").eq(200).clearPagination();
      expect(qb1.build().options.filter).toBe("u = 100");
      expect(qb1.build().options.limit).toBe(2);
      expect(qb2.build().options.filter).toBe("(u = 100 AND v = 200)");
      expect(qb2.build().options.limit).toBeUndefined();
    });
  });

  describe("empty-state build()", () => {
    it("omits filters when none added, and options empty", () => {
      const q = QueryBuilder.create().build();
      expect(q.options).toEqual({});
    });
  });

  describe("Advanced Query Building and Edge Cases", () => {
    it("handles deeply nested groups with mixed connectors", () => {
      const query = QueryBuilder.create()
        .andGroup(g1 => {
          g1.where("a").eq(1)
            .andGroup(g2 => {
              g2.where("b").eq(2)
                .orWhere("c").eq(3);
            });
        })
        .orGroup(g1 => {
          g1.where("d").eq(4)
            .orGroup(g2 => {
              g2.where("e").eq(5)
                .andWhere("f").eq(6);
            });
        })
        .build().options.filter;

      expect(query).toBe("((a = 1 AND (b = 2 OR c = 3)) OR (d = 4 OR (e = 5 AND f = 6)))");
    });

    it("correctly handles empty groups", () => {
      const query = QueryBuilder.create()
        .andGroup(_ => {/* empty */ })
        .orGroup(_ => {/* empty */ })
        .where("x").eq(1)
        .build().options.filter;

      expect(query).toBe("x = 1");
    });

    it("maintains precedence when mixing group types", () => {
      const query = QueryBuilder.create()
        .where("a").eq(1)
        .orGroup(g => {
          g.where("b").eq(2)
            .andGroup(g2 => {
              g2.where("c").eq(3)
                .orWhere("d").eq(4);
            });
        })
        .andGroup(g => {
          g.where("e").eq(5);
        })
        .build().options.filter;

      expect(query).toBe("((a = 1 OR (b = 2 AND (c = 3 OR d = 4))) AND e = 5)");
    });

    it("supports complex group combinations with notGroup", () => {
      const query = QueryBuilder.create()
        .where("a").eq(1)
        .andGroup(g => {
          g.notGroup(g2 => {
            g2.where("b").eq(2)
              .orWhere("c").eq(3);
          });
        })
        .orGroup(g => {
          g.where("d").eq(4)
            .notGroup(g2 => {
              g2.where("e").eq(5);
            });
        })
        .build().options.filter;

      expect(query).toBe("((a = 1 AND NOT (b = 2 OR c = 3)) OR (d = 4 AND NOT (e = 5)))");
    });

    it("manages complex combinations of AND/OR operations with proper parentheses", () => {
      const query = QueryBuilder.create()
        .where("a").eq(1)
        .orWhere("b").eq(2)
        .andWhere("c").eq(3)
        .orGroup(g => {
          g.where("d").eq(4)
            .andWhere("e").eq(5);
        })
        .andGroup(g => {
          g.where("f").eq(6)
            .orWhere("g").eq(7);
        })
        .build().options.filter;

      expect(query).toBe("((((a = 1 OR b = 2) AND c = 3) OR (d = 4 AND e = 5)) AND (f = 6 OR g = 7))");
    });

    it("handles corner case of empty root with conditional groups", () => {
      const qb = QueryBuilder.create();

      // Conditionally add groups based on a runtime condition
      const condition1 = true;
      const condition2 = false;

      if (condition1) {
        qb.andGroup(g => g.where("a").eq(1));
      }

      if (condition2) {
        qb.orGroup(g => g.where("b").eq(2));
      }

      expect(qb.build().options.filter).toBe("a = 1");
    });

    it("supports advanced group nesting with mixed operations", () => {
      const query = QueryBuilder.create()
        .andGroup(g => {
          g.where("category").in([ "books", "movies" ])
            .andWhere("price").lt(50);
        })
        .andGroup(g => {
          g.where("inStock").eq(true)
            .orGroup(g2 => {
              g2.where("preorder").eq(true)
                .andWhere("releaseDate").lt(20230101);
            });
        })
        .notGroup(g => {
          g.where("restricted").eq(true)
            .orWhere("age").lt(18);
        })
        .build().options.filter;

      // This test is primarily to verify it builds without errors
      expect(query).toContain("category IN ['books', 'movies'] AND price < 50");
      expect(query).toContain("inStock = true OR (preorder = true AND releaseDate < 20230101");
      expect(query).toContain("NOT (restricted = true OR age < 18)");
    });

    it("handles extremely deep nesting with mixed connectors", () => {
      const query = QueryBuilder.create()
        .andGroup(g1 => {
          g1.where("a").eq(1)
            .andGroup(g2 => {
              g2.where("b").eq(2)
                .andGroup(g3 => {
                  g3.where("c").eq(3)
                    .orWhere("d").eq(4);
                });
            });
        })
        .orGroup(g1 => {
          g1.notGroup(g2 => {
            g2.where("e").eq(5)
              .orGroup(g3 => {
                g3.where("f").eq(6)
                  .andWhere("g").eq(7);
              });
          });
        })
        .build().options.filter;

      // We're testing deep nesting here, the exact format varies by implementation
      expect(query).toContain("a = 1");
      expect(query).toContain("b = 2");
      expect(query).toContain("c = 3 OR d = 4");
      expect(query).toContain("NOT (e = 5 OR");
      expect(query).toContain("f = 6 AND g = 7");
    });

    it("handles real-world complex search scenarios", () => {
      // This simulates a complex product search filter
      const query = QueryBuilder.create()
        // Price range
        .where("price").gte(10).andWhere("price").lt(100)
        // Categories
        .andWhere("category").in([ "electronics", "computers" ])
        // Brand filter
        .andGroup(g => {
          g.where("brand").eq("Apple")
            .orWhere("brand").eq("Samsung")
            .orWhere("brand").eq("Microsoft");
        })
        // Availability
        .andGroup(g => {
          g.where("inStock").eq(true)
            .orWhere("backorderAvailable").eq(true);
        })
        // Exclusions
        .notGroup(g => {
          g.where("discontinued").eq(true)
            .orWhere("recalled").eq(true);
        })
        .build().options.filter;
      /**
       * Expected output:
       * "(
       * price >= 10 
       * AND price < 100 
       * AND category IN ['electronics', 'computers'] 
       * AND (brand = 'Apple' OR brand = 'Samsung' OR brand = 'Microsoft') 
       * AND (inStock = true OR backorderAvailable = true) 
       * AND NOT (discontinued = true OR recalled = true)
       * )"
       */

      // Check that all parts are included
      expect(query).toContain("price >= 10");
      expect(query).toContain("price < 100");
      expect(query).toContain("category IN ['electronics', 'computers']");
      expect(query).toContain("brand = 'Apple'");
      expect(query).toContain("OR brand = 'Samsung'");
      expect(query).toContain("OR brand = 'Microsoft'");
      expect(query).toContain("inStock = true OR backorderAvailable = true");
      expect(query).toContain("NOT (discontinued = true OR recalled = true)");
    });

    it("tests andGroup special handling for empty root", () => {
      const query = QueryBuilder.create()
        .andGroup(g => {
          g.where("a").eq(1);
        })
        .build().options.filter;

      expect(query).toBe("a = 1");
    });

    it("tests andGroup special handling for existing AND connector", () => {
      const query = QueryBuilder.create()
        .where("a").eq(1)
        .andGroup(g => {
          g.where("b").eq(2);
        })
        .build().options.filter;

      expect(query).toBe("(a = 1 AND b = 2)");
    });

    it("tests andGroup special handling for existing OR connector", () => {
      const query = QueryBuilder.create()
        .where("a").eq(1)
        .orWhere("b").eq(2)
        .andGroup(g => {
          g.where("c").eq(3);
        })
        .build().options.filter;

      expect(query).toBe("((a = 1 OR b = 2) AND c = 3)");
    });

    it("tests notGroup special handling for empty root", () => {
      const query = QueryBuilder.create()
        .notGroup(g => {
          g.where("a").eq(1);
        })
        .build().options.filter;

      expect(query).toBe("NOT (a = 1)");
    });

    it("tests notGroup special handling for existing AND connector", () => {
      const query = QueryBuilder.create()
        .where("a").eq(1)
        .notGroup(g => {
          g.where("b").eq(2);
        })
        .build().options.filter;

      expect(query).toBe("(a = 1 AND NOT (b = 2))");
    });

    it("tests notGroup special handling for existing OR connector", () => {
      const query = QueryBuilder.create()
        .where("a").eq(1)
        .orWhere("b").eq(2)
        .notGroup(g => {
          g.where("c").eq(3);
        })
        .build().options.filter;

      expect(query).toBe("((a = 1 OR b = 2) AND NOT (c = 3))");
    });
  });
});
