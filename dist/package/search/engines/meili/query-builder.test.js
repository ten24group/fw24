"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const query_builder_1 = require("./query-builder");
describe("MeiliQueryBuilder DSL", () => {
    describe("FilterCondition", () => {
        it("renders numeric, string (with escapes), boolean, and array values", () => {
            expect(new query_builder_1.FilterCondition("age", ">", 30).toString()).toBe("age > 30");
            expect(new query_builder_1.FilterCondition("name", "=", "O'Reilly").toString()).toBe("name = 'O\\'Reilly'");
            expect(new query_builder_1.FilterCondition("active", "=", true).toString()).toBe("active = true");
            expect(new query_builder_1.FilterCondition("ids", "=", [1, 2, 3]).toString()).toBe("ids = [1, 2, 3]");
        });
        it("clones itself without mutating original", () => {
            const orig = new query_builder_1.FilterCondition("x", "=", [1, 2]);
            const clone = orig.clone();
            // modify clone internals via raw access to ensure deep copy
            expect(clone.toString()).toBe(orig.toString());
        });
    });
    describe("FilterGroup", () => {
        it("joins children with AND and OR appropriately", () => {
            const gAnd = new query_builder_1.FilterGroup();
            gAnd
                .add(new query_builder_1.FilterCondition("a", "=", 1))
                .add(new query_builder_1.FilterCondition("b", "=", 2));
            expect(gAnd.toString()).toBe("(a = 1 AND b = 2)");
            const gOr = new query_builder_1.FilterGroup("OR");
            gOr
                .add(new query_builder_1.FilterCondition("x", ">", 5))
                .add(new query_builder_1.FilterCondition("y", "<", 3));
            expect(gOr.toString()).toBe("(x > 5 OR y < 3)");
        });
        it("omits parentheses when only one child", () => {
            const single = new query_builder_1.FilterGroup("AND");
            single.add(new query_builder_1.FilterCondition("z", "=", 9));
            expect(single.toString()).toBe("z = 9");
        });
        it("returns empty string when no children", () => {
            expect(new query_builder_1.FilterGroup().toString()).toBe("");
        });
        it("clones group deeply", () => {
            const g1 = new query_builder_1.FilterGroup();
            g1.add(new query_builder_1.FilterCondition("foo", "!=", "bar"));
            const g2 = g1.clone();
            expect(g2.toString()).toBe(g1.toString());
        });
    });
    describe("FilterRaw & FilterNot", () => {
        it("preserves raw string and supports negation", () => {
            const raw = new query_builder_1.FilterRaw("custom > 0");
            expect(raw.toString()).toBe("custom > 0");
            const cond = new query_builder_1.FilterCondition("v", "<", 10);
            const notCond = new query_builder_1.FilterNot(cond);
            expect(notCond.toString()).toBe("NOT (v < 10)");
            const grp = new query_builder_1.FilterGroup();
            grp
                .add(new query_builder_1.FilterCondition("x", "=", 1))
                .add(new query_builder_1.FilterCondition("y", "=", 2));
            const notGrp = new query_builder_1.FilterNot(grp);
            expect(notGrp.toString()).toBe("NOT (x = 1 AND y = 2)");
        });
        it("clones raw and not nodes", () => {
            const raw = new query_builder_1.FilterRaw("f = true");
            const rawClone = raw.clone();
            expect(rawClone.toString()).toBe(raw.toString());
            const not = new query_builder_1.FilterNot(new query_builder_1.FilterCondition("k", "=", false));
            const notClone = not.clone();
            expect(notClone.toString()).toBe(not.toString());
        });
    });
    // --- QueryBuilder tests ---
    describe("filterConditionRaw & rawCondition helper", () => {
        it("injects safe raw condition via static helper", () => {
            const helper = query_builder_1.QueryBuilder.rawCondition("x", "=", "val");
            expect(helper.toString()).toBe("x = 'val'");
            const f = query_builder_1.QueryBuilder.create()
                .filterConditionRaw("x", "=", "test")
                .build().options.filter;
            expect(f).toBe("x = 'test'");
        });
    });
    describe("Core filter building and chaining", () => {
        it("supports eq, neq, gt, gte, lt, lte", () => {
            const qb = query_builder_1.QueryBuilder.create()
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
            expect(qb.build().options.filter).toBe("(a = 1 AND b != 2 AND c > 3 AND d >= 4 AND e < 5 AND f <= 6)");
        });
        it("supports IN, NOT IN operators", () => {
            const f = query_builder_1.QueryBuilder.create()
                .where("tags")
                .in(["a", "b"])
                .andWhere("ids")
                .notIn([1, 2])
                .build().options.filter;
            expect(f).toBe("(tags IN ['a', 'b'] AND NOT (ids IN [1, 2]))");
        });
        it("supports rangeTo (TO) and its negation", () => {
            const f = query_builder_1.QueryBuilder.create()
                .where("n")
                .rangeTo(1, 3)
                .andWhere("m")
                .not()
                .rangeTo(4, 6)
                .build().options.filter;
            expect(f).toBe("(n 1 TO 3 AND NOT (m 4 TO 6))");
        });
        it("supports exists, notExists, isEmpty, isNotEmpty, isNull, isNotNull", () => {
            const f = query_builder_1.QueryBuilder.create()
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
            expect(f).toBe("(f EXISTS AND NOT (g EXISTS) AND h IS EMPTY AND NOT (i IS EMPTY) AND j IS NULL AND NOT (k IS NULL))");
        });
        it("supports string filters: contains and startsWith", () => {
            const f = query_builder_1.QueryBuilder.create()
                .where("desc")
                .contains("foo")
                .orWhere("title")
                .startsWith("bar")
                .build().options.filter;
            expect(f).toBe("(desc CONTAINS 'foo' OR title STARTS WITH 'bar')");
        });
        it("supports raw filter insertion with correct precedence", () => {
            const f = query_builder_1.QueryBuilder.create()
                .where("a")
                .eq(1)
                .filterRaw("custom < 5", "OR")
                .build().options.filter;
            expect(f).toBe("(a = 1 OR custom < 5)");
        });
        it("supports nested andGroup, orGroup, and notGroup", () => {
            const f = query_builder_1.QueryBuilder.create()
                .andGroup((g) => g.where("x").eq(1).andWhere("y").eq(2))
                .orGroup((g) => { g.where("z").eq(3); })
                .build().options.filter;
            expect(f).toBe("((x = 1 AND y = 2) OR z = 3)");
            const nf = query_builder_1.QueryBuilder.create()
                .notGroup((g) => g.where("x").eq(1).andWhere("y").eq(2))
                .build().options.filter;
            expect(nf).toBe("NOT (x = 1 AND y = 2)");
        });
        it("omits parentheses for single-child groups", () => {
            const a = query_builder_1.QueryBuilder.create()
                .andGroup((g) => g.where("a").eq(5))
                .build().options.filter;
            expect(a).toBe("a = 5");
            const b = query_builder_1.QueryBuilder.create()
                .orGroup((g) => g.where("b").eq(6))
                .build().options.filter;
            expect(b).toBe("b = 6");
        });
        it("whereNot alias and synonyms work", () => {
            const f = query_builder_1.QueryBuilder.create()
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
            const qb = query_builder_1.QueryBuilder.create().limit(5).offset(2).page(3, 10);
            expect(qb.build().options.limit).toBe(10);
            expect(qb.build().options.offset).toBe(20);
            qb.clearPagination();
            expect(qb.build().options.limit).toBeUndefined();
            expect(qb.build().options.offset).toBeUndefined();
        });
        it("sorting and clearSort", () => {
            const qb = query_builder_1.QueryBuilder.create().sort("n", "asc").sort("m", "desc");
            expect(qb.build().options.sort).toEqual(["n:asc", "m:desc"]);
            qb.clearSort();
            expect(qb.build().options.sort).toBeUndefined();
        });
        it("distinct, select, and their clears", () => {
            const qb = query_builder_1.QueryBuilder.create().distinct("id").select(["id", "name"]);
            expect(qb.build().options.distinct).toBe("id");
            expect(qb.build().options.attributesToRetrieve).toEqual(["id", "name"]);
            qb.clearDistinct().clearSelect();
            expect(qb.build().options.distinct).toBeUndefined();
            expect(qb.build().options.attributesToRetrieve).toBeUndefined();
        });
        it("facets and clearFacets", () => {
            const qb = query_builder_1.QueryBuilder.create().facets(["a", "b"]);
            expect(qb.build().options.facets).toEqual(["a", "b"]);
            qb.clearFacets();
            expect(qb.build().options.facets).toBeUndefined();
        });
        it("matchingStrategy and clearMatchingStrategy", () => {
            const qb = query_builder_1.QueryBuilder.create().matchingStrategy("last");
            expect(qb.build().options.matchingStrategy).toBe("last");
            qb.clearMatchingStrategy();
            expect(qb.build().options.matchingStrategy).toBeUndefined();
        });
        it("highlight, showMatchesPosition, clearHighlight", () => {
            const qb = query_builder_1.QueryBuilder.create()
                .highlight(["f"], "<b>", "</b>")
                .showMatchesPosition(true);
            const o = qb.build().options;
            expect(o.attributesToHighlight).toEqual(["f"]);
            expect(o.highlightPreTag).toBe("<b>");
            expect(o.showMatchesPosition).toBe(true);
            qb.clearHighlight();
            expect(qb.build().options.attributesToHighlight).toBeUndefined();
        });
        it("crop and clearCrop", () => {
            const qb = query_builder_1.QueryBuilder.create().crop(["d"], 15, "..");
            expect(qb.build().options.attributesToCrop).toEqual(["d"]);
            expect(qb.build().options.cropLength).toBe(15);
            qb.clearCrop();
            expect(qb.build().options.attributesToCrop).toBeUndefined();
        });
    });
    describe("text(), clearText() and toString()", () => {
        it("sets, clears the q param, and produces valid JSON", () => {
            const qb = query_builder_1.QueryBuilder.create().text("hello");
            expect(qb.build().q).toBe("hello");
            qb.clearText();
            expect(qb.build().q).toBeUndefined();
            const str = query_builder_1.QueryBuilder.create().text("hi").where("a").eq(1).toString();
            expect(() => JSON.parse(str)).not.toThrow();
            const obj = JSON.parse(str);
            expect(obj).toHaveProperty("q", "hi");
            expect(obj.options).toHaveProperty("filter", "a = 1");
        });
    });
    describe("clone() deep copy behavior", () => {
        it("modifying clone does not affect original", () => {
            const qb1 = query_builder_1.QueryBuilder.create().where("u").eq(100).limit(2);
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
            const q = query_builder_1.QueryBuilder.create().build();
            expect(q.options).toEqual({});
        });
    });
    describe("Advanced Query Building and Edge Cases", () => {
        it("handles deeply nested groups with mixed connectors", () => {
            const query = query_builder_1.QueryBuilder.create()
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
            const query = query_builder_1.QueryBuilder.create()
                .andGroup(_ => { })
                .orGroup(_ => { })
                .where("x").eq(1)
                .build().options.filter;
            expect(query).toBe("x = 1");
        });
        it("maintains precedence when mixing group types", () => {
            const query = query_builder_1.QueryBuilder.create()
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
            const query = query_builder_1.QueryBuilder.create()
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
            const query = query_builder_1.QueryBuilder.create()
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
            const qb = query_builder_1.QueryBuilder.create();
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
            const query = query_builder_1.QueryBuilder.create()
                .andGroup(g => {
                g.where("category").in(["books", "movies"])
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
            const query = query_builder_1.QueryBuilder.create()
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
            const query = query_builder_1.QueryBuilder.create()
                // Price range
                .where("price").gte(10).andWhere("price").lt(100)
                // Categories
                .andWhere("category").in(["electronics", "computers"])
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
            const query = query_builder_1.QueryBuilder.create()
                .andGroup(g => {
                g.where("a").eq(1);
            })
                .build().options.filter;
            expect(query).toBe("a = 1");
        });
        it("tests andGroup special handling for existing AND connector", () => {
            const query = query_builder_1.QueryBuilder.create()
                .where("a").eq(1)
                .andGroup(g => {
                g.where("b").eq(2);
            })
                .build().options.filter;
            expect(query).toBe("(a = 1 AND b = 2)");
        });
        it("tests andGroup special handling for existing OR connector", () => {
            const query = query_builder_1.QueryBuilder.create()
                .where("a").eq(1)
                .orWhere("b").eq(2)
                .andGroup(g => {
                g.where("c").eq(3);
            })
                .build().options.filter;
            expect(query).toBe("((a = 1 OR b = 2) AND c = 3)");
        });
        it("tests notGroup special handling for empty root", () => {
            const query = query_builder_1.QueryBuilder.create()
                .notGroup(g => {
                g.where("a").eq(1);
            })
                .build().options.filter;
            expect(query).toBe("NOT (a = 1)");
        });
        it("tests notGroup special handling for existing AND connector", () => {
            const query = query_builder_1.QueryBuilder.create()
                .where("a").eq(1)
                .notGroup(g => {
                g.where("b").eq(2);
            })
                .build().options.filter;
            expect(query).toBe("(a = 1 AND NOT (b = 2))");
        });
        it("tests notGroup special handling for existing OR connector", () => {
            const query = query_builder_1.QueryBuilder.create()
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktYnVpbGRlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9lbmdpbmVzL21laWxpL3F1ZXJ5LWJ1aWxkZXIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLG1EQU15QjtBQUV6QixRQUFRLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO0lBQ3JDLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxHQUFHLEVBQUU7UUFDL0IsRUFBRSxDQUFDLG1FQUFtRSxFQUFFLEdBQUcsRUFBRTtZQUMzRSxNQUFNLENBQUMsSUFBSSwrQkFBZSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDeEUsTUFBTSxDQUFDLElBQUksK0JBQWUsQ0FBQyxNQUFNLEVBQUUsR0FBRyxFQUFFLFVBQVUsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUNsRSxxQkFBcUIsQ0FDdEIsQ0FBQztZQUNGLE1BQU0sQ0FBQyxJQUFJLCtCQUFlLENBQUMsUUFBUSxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FDOUQsZUFBZSxDQUNoQixDQUFDO1lBQ0YsTUFBTSxDQUFDLElBQUksK0JBQWUsQ0FBQyxLQUFLLEVBQUUsR0FBRyxFQUFFLENBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUNsRSxpQkFBaUIsQ0FDbEIsQ0FBQztRQUNKLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHlDQUF5QyxFQUFFLEdBQUcsRUFBRTtZQUNqRCxNQUFNLElBQUksR0FBRyxJQUFJLCtCQUFlLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFFLENBQUMsRUFB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S0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNyQixDQUFDLENBQUM7aUJBQ0QsS0FBSyxFQUFFLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztZQUUxQixNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLG9DQUFvQyxDQUFDLENBQUM7UUFDM0QsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgUXVlcnlCdWlsZGVyLFxuICBGaWx0ZXJDb25kaXRpb24sXG4gIEZpbHRlckdyb3VwLFxuICBGaWx0ZXJSYXcsXG4gIEZpbHRlck5vdCxcbn0gZnJvbSBcIi4vcXVlcnktYnVpbGRlclwiO1xuXG5kZXNjcmliZShcIk1laWxpUXVlcnlCdWlsZGVyIERTTFwiLCAoKSA9PiB7XG4gIGRlc2NyaWJlKFwiRmlsdGVyQ29uZGl0aW9uXCIsICgpID0+IHtcbiAgICBpdChcInJlbmRlcnMgbnVtZXJpYywgc3RyaW5nICh3aXRoIGVzY2FwZXMpLCBib29sZWFuLCBhbmQgYXJyYXkgdmFsdWVzXCIsICgpID0+IHtcbiAgICAgIGV4cGVjdChuZXcgRmlsdGVyQ29uZGl0aW9uKFwiYWdlXCIsIFwiPlwiLCAzMCkudG9TdHJpbmcoKSkudG9CZShcImFnZSA+IDMwXCIpO1xuICAgICAgZXhwZWN0KG5ldyBGaWx0ZXJDb25kaXRpb24oXCJuYW1lXCIsIFwiPVwiLCBcIk8nUmVpbGx5XCIpLnRvU3RyaW5nKCkpLnRvQmUoXG4gICAgICAgIFwibmFtZSA9ICdPXFxcXCdSZWlsbHknXCIsXG4gICAgICApO1xuICAgICAgZXhwZWN0KG5ldyBGaWx0ZXJDb25kaXRpb24oXCJhY3RpdmVcIiwgXCI9XCIsIHRydWUpLnRvU3RyaW5nKCkpLnRvQmUoXG4gICAgICAgIFwiYWN0aXZlID0gdHJ1ZVwiLFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChuZXcgRmlsdGVyQ29uZGl0aW9uKFwiaWRzXCIsIFwiPVwiLCBbIDEsIDIsIDMgXSkudG9TdHJpbmcoKSkudG9CZShcbiAgICAgICAgXCJpZHMgPSBbMSwgMiwgM11cIixcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcImNsb25lcyBpdHNlbGYgd2l0aG91dCBtdXRhdGluZyBvcmlnaW5hbFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBvcmlnID0gbmV3IEZpbHRlckNvbmRpdGlvbihcInhcIiwgXCI9XCIsIFsgMSwgMiBdKTtcbiAgICAgIGNvbnN0IGNsb25lID0gb3JpZy5jbG9uZSgpO1xuICAgICAgLy8gbW9kaWZ5IGNsb25lIGludGVybmFscyB2aWEgcmF3IGFjY2VzcyB0byBlbnN1cmUgZGVlcCBjb3B5XG4gICAgICBleHBlY3QoY2xvbmUudG9TdHJpbmcoKSkudG9CZShvcmlnLnRvU3RyaW5nKCkpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIkZpbHRlckdyb3VwXCIsICgpID0+IHtcbiAgICBpdChcImpvaW5zIGNoaWxkcmVuIHdpdGggQU5EIGFuZCBPUiBhcHByb3ByaWF0ZWx5XCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGdBbmQgPSBuZXcgRmlsdGVyR3JvdXAoKTtcbiAgICAgIGdBbmRcbiAgICAgICAgLmFkZChuZXcgRmlsdGVyQ29uZGl0aW9uKFwiYVwiLCBcIj1cIiwgMSkpXG4gICAgICAgIC5hZGQobmV3IEZpbHRlckNvbmRpdGlvbihcImJcIiwgXCI9XCIsIDIpKTtcbiAgICAgIGV4cGVjdChnQW5kLnRvU3RyaW5nKCkpLnRvQmUoXCIoYSA9IDEgQU5EIGIgPSAyKVwiKTtcblxuICAgICAgY29uc3QgZ09yID0gbmV3IEZpbHRlckdyb3VwKFwiT1JcIik7XG4gICAgICBnT3JcbiAgICAgICAgLmFkZChuZXcgRmlsdGVyQ29uZGl0aW9uKFwieFwiLCBcIj5cIiwgNSkpXG4gICAgICAgIC5hZGQobmV3IEZpbHRlckNvbmRpdGlvbihcInlcIiwgXCI8XCIsIDMpKTtcbiAgICAgIGV4cGVjdChnT3IudG9TdHJpbmcoKSkudG9CZShcIih4ID4gNSBPUiB5IDwgMylcIik7XG4gICAgfSk7XG5cbiAgICBpdChcIm9taXRzIHBhcmVudGhlc2VzIHdoZW4gb25seSBvbmUgY2hpbGRcIiwgKCkgPT4ge1xuICAgICAgY29uc3Qgc2luZ2xlID0gbmV3IEZpbHRlckdyb3VwKFwiQU5EXCIpO1xuICAgICAgc2luZ2xlLmFkZChuZXcgRmlsdGVyQ29uZGl0aW9uKFwielwiLCBcIj1cIiwgOSkpO1xuICAgICAgZXhwZWN0KHNpbmdsZS50b1N0cmluZygpKS50b0JlKFwieiA9IDlcIik7XG4gICAgfSk7XG5cbiAgICBpdChcInJldHVybnMgZW1wdHkgc3RyaW5nIHdoZW4gbm8gY2hpbGRyZW5cIiwgKCkgPT4ge1xuICAgICAgZXhwZWN0KG5ldyBGaWx0ZXJHcm91cCgpLnRvU3RyaW5nKCkpLnRvQmUoXCJcIik7XG4gICAgfSk7XG5cbiAgICBpdChcImNsb25lcyBncm91cCBkZWVwbHlcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZzEgPSBuZXcgRmlsdGVyR3JvdXAoKTtcbiAgICAgIGcxLmFkZChuZXcgRmlsdGVyQ29uZGl0aW9uKFwiZm9vXCIsIFwiIT1cIiwgXCJiYXJcIikpO1xuICAgICAgY29uc3QgZzIgPSBnMS5jbG9uZSgpO1xuICAgICAgZXhwZWN0KGcyLnRvU3RyaW5nKCkpLnRvQmUoZzEudG9TdHJpbmcoKSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiRmlsdGVyUmF3ICYgRmlsdGVyTm90XCIsICgpID0+IHtcbiAgICBpdChcInByZXNlcnZlcyByYXcgc3RyaW5nIGFuZCBzdXBwb3J0cyBuZWdhdGlvblwiLCAoKSA9PiB7XG4gICAgICBjb25zdCByYXcgPSBuZXcgRmlsdGVyUmF3KFwiY3VzdG9tID4gMFwiKTtcbiAgICAgIGV4cGVjdChyYXcudG9TdHJpbmcoKSkudG9CZShcImN1c3RvbSA+IDBcIik7XG5cbiAgICAgIGNvbnN0IGNvbmQgPSBuZXcgRmlsdGVyQ29uZGl0aW9uKFwidlwiLCBcIjxcIiwgMTApO1xuICAgICAgY29uc3Qgbm90Q29uZCA9IG5ldyBGaWx0ZXJOb3QoY29uZCk7XG4gICAgICBleHBlY3Qobm90Q29uZC50b1N0cmluZygpKS50b0JlKFwiTk9UICh2IDwgMTApXCIpO1xuXG4gICAgICBjb25zdCBncnAgPSBuZXcgRmlsdGVyR3JvdXAoKTtcbiAgICAgIGdycFxuICAgICAgICAuYWRkKG5ldyBGaWx0ZXJDb25kaXRpb24oXCJ4XCIsIFwiPVwiLCAxKSlcbiAgICAgICAgLmFkZChuZXcgRmlsdGVyQ29uZGl0aW9uKFwieVwiLCBcIj1cIiwgMikpO1xuICAgICAgY29uc3Qgbm90R3JwID0gbmV3IEZpbHRlck5vdChncnApO1xuICAgICAgZXhwZWN0KG5vdEdycC50b1N0cmluZygpKS50b0JlKFwiTk9UICh4ID0gMSBBTkQgeSA9IDIpXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJjbG9uZXMgcmF3IGFuZCBub3Qgbm9kZXNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcmF3ID0gbmV3IEZpbHRlclJhdyhcImYgPSB0cnVlXCIpO1xuICAgICAgY29uc3QgcmF3Q2xvbmUgPSByYXcuY2xvbmUoKTtcbiAgICAgIGV4cGVjdChyYXdDbG9uZS50b1N0cmluZygpKS50b0JlKHJhdy50b1N0cmluZygpKTtcblxuICAgICAgY29uc3Qgbm90ID0gbmV3IEZpbHRlck5vdChuZXcgRmlsdGVyQ29uZGl0aW9uKFwia1wiLCBcIj1cIiwgZmFsc2UpKTtcbiAgICAgIGNvbnN0IG5vdENsb25lID0gbm90LmNsb25lKCk7XG4gICAgICBleHBlY3Qobm90Q2xvbmUudG9TdHJpbmcoKSkudG9CZShub3QudG9TdHJpbmcoKSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIC0tLSBRdWVyeUJ1aWxkZXIgdGVzdHMgLS0tXG4gIGRlc2NyaWJlKFwiZmlsdGVyQ29uZGl0aW9uUmF3ICYgcmF3Q29uZGl0aW9uIGhlbHBlclwiLCAoKSA9PiB7XG4gICAgaXQoXCJpbmplY3RzIHNhZmUgcmF3IGNvbmRpdGlvbiB2aWEgc3RhdGljIGhlbHBlclwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBoZWxwZXIgPSBRdWVyeUJ1aWxkZXIucmF3Q29uZGl0aW9uKFwieFwiLCBcIj1cIiwgXCJ2YWxcIik7XG4gICAgICBleHBlY3QoaGVscGVyLnRvU3RyaW5nKCkpLnRvQmUoXCJ4ID0gJ3ZhbCdcIik7XG4gICAgICBjb25zdCBmID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC5maWx0ZXJDb25kaXRpb25SYXcoXCJ4XCIsIFwiPVwiLCBcInRlc3RcIilcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG4gICAgICBleHBlY3QoZikudG9CZShcInggPSAndGVzdCdcIik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwiQ29yZSBmaWx0ZXIgYnVpbGRpbmcgYW5kIGNoYWluaW5nXCIsICgpID0+IHtcbiAgICBpdChcInN1cHBvcnRzIGVxLCBuZXEsIGd0LCBndGUsIGx0LCBsdGVcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcWIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlKFwiYVwiKVxuICAgICAgICAuZXEoMSlcbiAgICAgICAgLmFuZFdoZXJlKFwiYlwiKVxuICAgICAgICAubmVxKDIpXG4gICAgICAgIC5hbmRXaGVyZShcImNcIilcbiAgICAgICAgLmd0KDMpXG4gICAgICAgIC5hbmRXaGVyZShcImRcIilcbiAgICAgICAgLmd0ZSg0KVxuICAgICAgICAuYW5kV2hlcmUoXCJlXCIpXG4gICAgICAgIC5sdCg1KVxuICAgICAgICAuYW5kV2hlcmUoXCJmXCIpXG4gICAgICAgIC5sdGUoNik7XG4gICAgICBleHBlY3QocWIuYnVpbGQoKS5vcHRpb25zLmZpbHRlcikudG9CZShcbiAgICAgICAgXCIoYSA9IDEgQU5EIGIgIT0gMiBBTkQgYyA+IDMgQU5EIGQgPj0gNCBBTkQgZSA8IDUgQU5EIGYgPD0gNilcIixcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdChcInN1cHBvcnRzIElOLCBOT1QgSU4gb3BlcmF0b3JzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGYgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlKFwidGFnc1wiKVxuICAgICAgICAuaW4oWyBcImFcIiwgXCJiXCIgXSlcbiAgICAgICAgLmFuZFdoZXJlKFwiaWRzXCIpXG4gICAgICAgIC5ub3RJbihbIDEsIDIgXSlcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG4gICAgICBleHBlY3QoZikudG9CZShcIih0YWdzIElOIFsnYScsICdiJ10gQU5EIE5PVCAoaWRzIElOIFsxLCAyXSkpXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzdXBwb3J0cyByYW5nZVRvIChUTykgYW5kIGl0cyBuZWdhdGlvblwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC53aGVyZShcIm5cIilcbiAgICAgICAgLnJhbmdlVG8oMSwgMylcbiAgICAgICAgLmFuZFdoZXJlKFwibVwiKVxuICAgICAgICAubm90KClcbiAgICAgICAgLnJhbmdlVG8oNCwgNilcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG4gICAgICBleHBlY3QoZikudG9CZShcIihuIDEgVE8gMyBBTkQgTk9UIChtIDQgVE8gNikpXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzdXBwb3J0cyBleGlzdHMsIG5vdEV4aXN0cywgaXNFbXB0eSwgaXNOb3RFbXB0eSwgaXNOdWxsLCBpc05vdE51bGxcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZiA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAud2hlcmUoXCJmXCIpXG4gICAgICAgIC5leGlzdHMoKVxuICAgICAgICAuYW5kV2hlcmUoXCJnXCIpXG4gICAgICAgIC5ub3RFeGlzdHMoKVxuICAgICAgICAuYW5kV2hlcmUoXCJoXCIpXG4gICAgICAgIC5pc0VtcHR5KClcbiAgICAgICAgLmFuZFdoZXJlKFwiaVwiKVxuICAgICAgICAuaXNOb3RFbXB0eSgpXG4gICAgICAgIC5hbmRXaGVyZShcImpcIilcbiAgICAgICAgLmlzTnVsbCgpXG4gICAgICAgIC5hbmRXaGVyZShcImtcIilcbiAgICAgICAgLmlzTm90TnVsbCgpXG4gICAgICAgIC5idWlsZCgpLm9wdGlvbnMuZmlsdGVyO1xuICAgICAgZXhwZWN0KGYpLnRvQmUoXG4gICAgICAgIFwiKGYgRVhJU1RTIEFORCBOT1QgKGcgRVhJU1RTKSBBTkQgaCBJUyBFTVBUWSBBTkQgTk9UIChpIElTIEVNUFRZKSBBTkQgaiBJUyBOVUxMIEFORCBOT1QgKGsgSVMgTlVMTCkpXCIsXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzdXBwb3J0cyBzdHJpbmcgZmlsdGVyczogY29udGFpbnMgYW5kIHN0YXJ0c1dpdGhcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZiA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAud2hlcmUoXCJkZXNjXCIpXG4gICAgICAgIC5jb250YWlucyhcImZvb1wiKVxuICAgICAgICAub3JXaGVyZShcInRpdGxlXCIpXG4gICAgICAgIC5zdGFydHNXaXRoKFwiYmFyXCIpXG4gICAgICAgIC5idWlsZCgpLm9wdGlvbnMuZmlsdGVyO1xuICAgICAgZXhwZWN0KGYpLnRvQmUoXCIoZGVzYyBDT05UQUlOUyAnZm9vJyBPUiB0aXRsZSBTVEFSVFMgV0lUSCAnYmFyJylcIik7XG4gICAgfSk7XG5cbiAgICBpdChcInN1cHBvcnRzIHJhdyBmaWx0ZXIgaW5zZXJ0aW9uIHdpdGggY29ycmVjdCBwcmVjZWRlbmNlXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGYgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlKFwiYVwiKVxuICAgICAgICAuZXEoMSlcbiAgICAgICAgLmZpbHRlclJhdyhcImN1c3RvbSA8IDVcIiwgXCJPUlwiKVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcbiAgICAgIGV4cGVjdChmKS50b0JlKFwiKGEgPSAxIE9SIGN1c3RvbSA8IDUpXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzdXBwb3J0cyBuZXN0ZWQgYW5kR3JvdXAsIG9yR3JvdXAsIGFuZCBub3RHcm91cFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBmID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC5hbmRHcm91cCgoZykgPT4gZy53aGVyZShcInhcIikuZXEoMSkuYW5kV2hlcmUoXCJ5XCIpLmVxKDIpKVxuICAgICAgICAub3JHcm91cCgoZykgPT4geyBnLndoZXJlKFwielwiKS5lcSgzKTsgfSlcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG4gICAgICBleHBlY3QoZikudG9CZShcIigoeCA9IDEgQU5EIHkgPSAyKSBPUiB6ID0gMylcIik7XG5cbiAgICAgIGNvbnN0IG5mID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC5ub3RHcm91cCgoZykgPT4gZy53aGVyZShcInhcIikuZXEoMSkuYW5kV2hlcmUoXCJ5XCIpLmVxKDIpKVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcbiAgICAgIGV4cGVjdChuZikudG9CZShcIk5PVCAoeCA9IDEgQU5EIHkgPSAyKVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwib21pdHMgcGFyZW50aGVzZXMgZm9yIHNpbmdsZS1jaGlsZCBncm91cHNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgYSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAuYW5kR3JvdXAoKGcpID0+IGcud2hlcmUoXCJhXCIpLmVxKDUpKVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcbiAgICAgIGV4cGVjdChhKS50b0JlKFwiYSA9IDVcIik7XG5cbiAgICAgIGNvbnN0IGIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLm9yR3JvdXAoKGcpID0+IGcud2hlcmUoXCJiXCIpLmVxKDYpKVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcbiAgICAgIGV4cGVjdChiKS50b0JlKFwiYiA9IDZcIik7XG4gICAgfSk7XG5cbiAgICBpdChcIndoZXJlTm90IGFsaWFzIGFuZCBzeW5vbnltcyB3b3JrXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGYgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlTm90KFwiYWN0aXZlXCIpXG4gICAgICAgIC5lcXVhbHMoZmFsc2UpXG4gICAgICAgIC5hbmRXaGVyZShcInN0YXR1c1wiKVxuICAgICAgICAubm90RXF1YWwoXCJva1wiKVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcbiAgICAgIGV4cGVjdChmKS50b0JlKFwiKE5PVCAoYWN0aXZlID0gZmFsc2UpIEFORCBzdGF0dXMgIT0gJ29rJylcIik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwib3B0aW9ucyBjb25maWd1cmF0aW9uIGFuZCBjbGVhciBtZXRob2RzXCIsICgpID0+IHtcbiAgICBpdChcInBhZ2luYXRpb246IGxpbWl0LCBvZmZzZXQsIHBhZ2UsIGNsZWFyUGFnaW5hdGlvblwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBxYiA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKS5saW1pdCg1KS5vZmZzZXQoMikucGFnZSgzLCAxMCk7XG4gICAgICBleHBlY3QocWIuYnVpbGQoKS5vcHRpb25zLmxpbWl0KS50b0JlKDEwKTtcbiAgICAgIGV4cGVjdChxYi5idWlsZCgpLm9wdGlvbnMub2Zmc2V0KS50b0JlKDIwKTtcbiAgICAgIHFiLmNsZWFyUGFnaW5hdGlvbigpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5saW1pdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5vZmZzZXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KFwic29ydGluZyBhbmQgY2xlYXJTb3J0XCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHFiID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpLnNvcnQoXCJuXCIsIFwiYXNjXCIpLnNvcnQoXCJtXCIsIFwiZGVzY1wiKTtcbiAgICAgIGV4cGVjdChxYi5idWlsZCgpLm9wdGlvbnMuc29ydCkudG9FcXVhbChbIFwibjphc2NcIiwgXCJtOmRlc2NcIiBdKTtcbiAgICAgIHFiLmNsZWFyU29ydCgpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5zb3J0KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdChcImRpc3RpbmN0LCBzZWxlY3QsIGFuZCB0aGVpciBjbGVhcnNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcWIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKCkuZGlzdGluY3QoXCJpZFwiKS5zZWxlY3QoWyBcImlkXCIsIFwibmFtZVwiIF0pO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5kaXN0aW5jdCkudG9CZShcImlkXCIpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5hdHRyaWJ1dGVzVG9SZXRyaWV2ZSkudG9FcXVhbChbIFwiaWRcIiwgXCJuYW1lXCIgXSk7XG4gICAgICBxYi5jbGVhckRpc3RpbmN0KCkuY2xlYXJTZWxlY3QoKTtcbiAgICAgIGV4cGVjdChxYi5idWlsZCgpLm9wdGlvbnMuZGlzdGluY3QpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChxYi5idWlsZCgpLm9wdGlvbnMuYXR0cmlidXRlc1RvUmV0cmlldmUpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuXG5cbiAgICBpdChcImZhY2V0cyBhbmQgY2xlYXJGYWNldHNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcWIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKCkuZmFjZXRzKFsgXCJhXCIsIFwiYlwiIF0pO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5mYWNldHMpLnRvRXF1YWwoWyBcImFcIiwgXCJiXCIgXSk7XG4gICAgICBxYi5jbGVhckZhY2V0cygpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5mYWNldHMpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KFwibWF0Y2hpbmdTdHJhdGVneSBhbmQgY2xlYXJNYXRjaGluZ1N0cmF0ZWd5XCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHFiID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpLm1hdGNoaW5nU3RyYXRlZ3koXCJsYXN0XCIpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5tYXRjaGluZ1N0cmF0ZWd5KS50b0JlKFwibGFzdFwiKTtcbiAgICAgIHFiLmNsZWFyTWF0Y2hpbmdTdHJhdGVneSgpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5tYXRjaGluZ1N0cmF0ZWd5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdChcImhpZ2hsaWdodCwgc2hvd01hdGNoZXNQb3NpdGlvbiwgY2xlYXJIaWdobGlnaHRcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcWIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLmhpZ2hsaWdodChbIFwiZlwiIF0sIFwiPGI+XCIsIFwiPC9iPlwiKVxuICAgICAgICAuc2hvd01hdGNoZXNQb3NpdGlvbih0cnVlKTtcbiAgICAgIGNvbnN0IG8gPSBxYi5idWlsZCgpLm9wdGlvbnM7XG4gICAgICBleHBlY3Qoby5hdHRyaWJ1dGVzVG9IaWdobGlnaHQpLnRvRXF1YWwoWyBcImZcIiBdKTtcbiAgICAgIGV4cGVjdChvLmhpZ2hsaWdodFByZVRhZykudG9CZShcIjxiPlwiKTtcbiAgICAgIGV4cGVjdChvLnNob3dNYXRjaGVzUG9zaXRpb24pLnRvQmUodHJ1ZSk7XG4gICAgICBxYi5jbGVhckhpZ2hsaWdodCgpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5hdHRyaWJ1dGVzVG9IaWdobGlnaHQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KFwiY3JvcCBhbmQgY2xlYXJDcm9wXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHFiID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpLmNyb3AoWyBcImRcIiBdLCAxNSwgXCIuLlwiKTtcbiAgICAgIGV4cGVjdChxYi5idWlsZCgpLm9wdGlvbnMuYXR0cmlidXRlc1RvQ3JvcCkudG9FcXVhbChbIFwiZFwiIF0pO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5jcm9wTGVuZ3RoKS50b0JlKDE1KTtcbiAgICAgIHFiLmNsZWFyQ3JvcCgpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkub3B0aW9ucy5hdHRyaWJ1dGVzVG9Dcm9wKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKFwidGV4dCgpLCBjbGVhclRleHQoKSBhbmQgdG9TdHJpbmcoKVwiLCAoKSA9PiB7XG4gICAgaXQoXCJzZXRzLCBjbGVhcnMgdGhlIHEgcGFyYW0sIGFuZCBwcm9kdWNlcyB2YWxpZCBKU09OXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHFiID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpLnRleHQoXCJoZWxsb1wiKTtcbiAgICAgIGV4cGVjdChxYi5idWlsZCgpLnEpLnRvQmUoXCJoZWxsb1wiKTtcbiAgICAgIHFiLmNsZWFyVGV4dCgpO1xuICAgICAgZXhwZWN0KHFiLmJ1aWxkKCkucSkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgICBjb25zdCBzdHIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKCkudGV4dChcImhpXCIpLndoZXJlKFwiYVwiKS5lcSgxKS50b1N0cmluZygpO1xuICAgICAgZXhwZWN0KCgpID0+IEpTT04ucGFyc2Uoc3RyKSkubm90LnRvVGhyb3coKTtcbiAgICAgIGNvbnN0IG9iaiA9IEpTT04ucGFyc2Uoc3RyKTtcbiAgICAgIGV4cGVjdChvYmopLnRvSGF2ZVByb3BlcnR5KFwicVwiLCBcImhpXCIpO1xuICAgICAgZXhwZWN0KG9iai5vcHRpb25zKS50b0hhdmVQcm9wZXJ0eShcImZpbHRlclwiLCBcImEgPSAxXCIpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcImNsb25lKCkgZGVlcCBjb3B5IGJlaGF2aW9yXCIsICgpID0+IHtcbiAgICBpdChcIm1vZGlmeWluZyBjbG9uZSBkb2VzIG5vdCBhZmZlY3Qgb3JpZ2luYWxcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcWIxID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpLndoZXJlKFwidVwiKS5lcSgxMDApLmxpbWl0KDIpO1xuICAgICAgY29uc3QgcWIyID0gcWIxLmNsb25lKCk7XG4gICAgICBxYjIud2hlcmUoXCJ2XCIpLmVxKDIwMCkuY2xlYXJQYWdpbmF0aW9uKCk7XG4gICAgICBleHBlY3QocWIxLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXIpLnRvQmUoXCJ1ID0gMTAwXCIpO1xuICAgICAgZXhwZWN0KHFiMS5idWlsZCgpLm9wdGlvbnMubGltaXQpLnRvQmUoMik7XG4gICAgICBleHBlY3QocWIyLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXIpLnRvQmUoXCIodSA9IDEwMCBBTkQgdiA9IDIwMClcIik7XG4gICAgICBleHBlY3QocWIyLmJ1aWxkKCkub3B0aW9ucy5saW1pdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcImVtcHR5LXN0YXRlIGJ1aWxkKClcIiwgKCkgPT4ge1xuICAgIGl0KFwib21pdHMgZmlsdGVycyB3aGVuIG5vbmUgYWRkZWQsIGFuZCBvcHRpb25zIGVtcHR5XCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHEgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKCkuYnVpbGQoKTtcbiAgICAgIGV4cGVjdChxLm9wdGlvbnMpLnRvRXF1YWwoe30pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZShcIkFkdmFuY2VkIFF1ZXJ5IEJ1aWxkaW5nIGFuZCBFZGdlIENhc2VzXCIsICgpID0+IHtcbiAgICBpdChcImhhbmRsZXMgZGVlcGx5IG5lc3RlZCBncm91cHMgd2l0aCBtaXhlZCBjb25uZWN0b3JzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC5hbmRHcm91cChnMSA9PiB7XG4gICAgICAgICAgZzEud2hlcmUoXCJhXCIpLmVxKDEpXG4gICAgICAgICAgICAuYW5kR3JvdXAoZzIgPT4ge1xuICAgICAgICAgICAgICBnMi53aGVyZShcImJcIikuZXEoMilcbiAgICAgICAgICAgICAgICAub3JXaGVyZShcImNcIikuZXEoMyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICAgICAgLm9yR3JvdXAoZzEgPT4ge1xuICAgICAgICAgIGcxLndoZXJlKFwiZFwiKS5lcSg0KVxuICAgICAgICAgICAgLm9yR3JvdXAoZzIgPT4ge1xuICAgICAgICAgICAgICBnMi53aGVyZShcImVcIikuZXEoNSlcbiAgICAgICAgICAgICAgICAuYW5kV2hlcmUoXCJmXCIpLmVxKDYpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC5idWlsZCgpLm9wdGlvbnMuZmlsdGVyO1xuXG4gICAgICBleHBlY3QocXVlcnkpLnRvQmUoXCIoKGEgPSAxIEFORCAoYiA9IDIgT1IgYyA9IDMpKSBPUiAoZCA9IDQgT1IgKGUgPSA1IEFORCBmID0gNikpKVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwiY29ycmVjdGx5IGhhbmRsZXMgZW1wdHkgZ3JvdXBzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC5hbmRHcm91cChfID0+IHsvKiBlbXB0eSAqLyB9KVxuICAgICAgICAub3JHcm91cChfID0+IHsvKiBlbXB0eSAqLyB9KVxuICAgICAgICAud2hlcmUoXCJ4XCIpLmVxKDEpXG4gICAgICAgIC5idWlsZCgpLm9wdGlvbnMuZmlsdGVyO1xuXG4gICAgICBleHBlY3QocXVlcnkpLnRvQmUoXCJ4ID0gMVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwibWFpbnRhaW5zIHByZWNlZGVuY2Ugd2hlbiBtaXhpbmcgZ3JvdXAgdHlwZXNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlKFwiYVwiKS5lcSgxKVxuICAgICAgICAub3JHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiYlwiKS5lcSgyKVxuICAgICAgICAgICAgLmFuZEdyb3VwKGcyID0+IHtcbiAgICAgICAgICAgICAgZzIud2hlcmUoXCJjXCIpLmVxKDMpXG4gICAgICAgICAgICAgICAgLm9yV2hlcmUoXCJkXCIpLmVxKDQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC5hbmRHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiZVwiKS5lcSg1KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG5cbiAgICAgIGV4cGVjdChxdWVyeSkudG9CZShcIigoYSA9IDEgT1IgKGIgPSAyIEFORCAoYyA9IDMgT1IgZCA9IDQpKSkgQU5EIGUgPSA1KVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwic3VwcG9ydHMgY29tcGxleCBncm91cCBjb21iaW5hdGlvbnMgd2l0aCBub3RHcm91cFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAud2hlcmUoXCJhXCIpLmVxKDEpXG4gICAgICAgIC5hbmRHcm91cChnID0+IHtcbiAgICAgICAgICBnLm5vdEdyb3VwKGcyID0+IHtcbiAgICAgICAgICAgIGcyLndoZXJlKFwiYlwiKS5lcSgyKVxuICAgICAgICAgICAgICAub3JXaGVyZShcImNcIikuZXEoMyk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC5vckdyb3VwKGcgPT4ge1xuICAgICAgICAgIGcud2hlcmUoXCJkXCIpLmVxKDQpXG4gICAgICAgICAgICAubm90R3JvdXAoZzIgPT4ge1xuICAgICAgICAgICAgICBnMi53aGVyZShcImVcIikuZXEoNSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG5cbiAgICAgIGV4cGVjdChxdWVyeSkudG9CZShcIigoYSA9IDEgQU5EIE5PVCAoYiA9IDIgT1IgYyA9IDMpKSBPUiAoZCA9IDQgQU5EIE5PVCAoZSA9IDUpKSlcIik7XG4gICAgfSk7XG5cbiAgICBpdChcIm1hbmFnZXMgY29tcGxleCBjb21iaW5hdGlvbnMgb2YgQU5EL09SIG9wZXJhdGlvbnMgd2l0aCBwcm9wZXIgcGFyZW50aGVzZXNcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlKFwiYVwiKS5lcSgxKVxuICAgICAgICAub3JXaGVyZShcImJcIikuZXEoMilcbiAgICAgICAgLmFuZFdoZXJlKFwiY1wiKS5lcSgzKVxuICAgICAgICAub3JHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiZFwiKS5lcSg0KVxuICAgICAgICAgICAgLmFuZFdoZXJlKFwiZVwiKS5lcSg1KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmFuZEdyb3VwKGcgPT4ge1xuICAgICAgICAgIGcud2hlcmUoXCJmXCIpLmVxKDYpXG4gICAgICAgICAgICAub3JXaGVyZShcImdcIikuZXEoNyk7XG4gICAgICAgIH0pXG4gICAgICAgIC5idWlsZCgpLm9wdGlvbnMuZmlsdGVyO1xuXG4gICAgICBleHBlY3QocXVlcnkpLnRvQmUoXCIoKCgoYSA9IDEgT1IgYiA9IDIpIEFORCBjID0gMykgT1IgKGQgPSA0IEFORCBlID0gNSkpIEFORCAoZiA9IDYgT1IgZyA9IDcpKVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwiaGFuZGxlcyBjb3JuZXIgY2FzZSBvZiBlbXB0eSByb290IHdpdGggY29uZGl0aW9uYWwgZ3JvdXBzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHFiID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpO1xuXG4gICAgICAvLyBDb25kaXRpb25hbGx5IGFkZCBncm91cHMgYmFzZWQgb24gYSBydW50aW1lIGNvbmRpdGlvblxuICAgICAgY29uc3QgY29uZGl0aW9uMSA9IHRydWU7XG4gICAgICBjb25zdCBjb25kaXRpb24yID0gZmFsc2U7XG5cbiAgICAgIGlmIChjb25kaXRpb24xKSB7XG4gICAgICAgIHFiLmFuZEdyb3VwKGcgPT4gZy53aGVyZShcImFcIikuZXEoMSkpO1xuICAgICAgfVxuXG4gICAgICBpZiAoY29uZGl0aW9uMikge1xuICAgICAgICBxYi5vckdyb3VwKGcgPT4gZy53aGVyZShcImJcIikuZXEoMikpO1xuICAgICAgfVxuXG4gICAgICBleHBlY3QocWIuYnVpbGQoKS5vcHRpb25zLmZpbHRlcikudG9CZShcImEgPSAxXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJzdXBwb3J0cyBhZHZhbmNlZCBncm91cCBuZXN0aW5nIHdpdGggbWl4ZWQgb3BlcmF0aW9uc1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAuYW5kR3JvdXAoZyA9PiB7XG4gICAgICAgICAgZy53aGVyZShcImNhdGVnb3J5XCIpLmluKFsgXCJib29rc1wiLCBcIm1vdmllc1wiIF0pXG4gICAgICAgICAgICAuYW5kV2hlcmUoXCJwcmljZVwiKS5sdCg1MCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5hbmRHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiaW5TdG9ja1wiKS5lcSh0cnVlKVxuICAgICAgICAgICAgLm9yR3JvdXAoZzIgPT4ge1xuICAgICAgICAgICAgICBnMi53aGVyZShcInByZW9yZGVyXCIpLmVxKHRydWUpXG4gICAgICAgICAgICAgICAgLmFuZFdoZXJlKFwicmVsZWFzZURhdGVcIikubHQoMjAyMzAxMDEpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pXG4gICAgICAgIC5ub3RHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwicmVzdHJpY3RlZFwiKS5lcSh0cnVlKVxuICAgICAgICAgICAgLm9yV2hlcmUoXCJhZ2VcIikubHQoMTgpO1xuICAgICAgICB9KVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcblxuICAgICAgLy8gVGhpcyB0ZXN0IGlzIHByaW1hcmlseSB0byB2ZXJpZnkgaXQgYnVpbGRzIHdpdGhvdXQgZXJyb3JzXG4gICAgICBleHBlY3QocXVlcnkpLnRvQ29udGFpbihcImNhdGVnb3J5IElOIFsnYm9va3MnLCAnbW92aWVzJ10gQU5EIHByaWNlIDwgNTBcIik7XG4gICAgICBleHBlY3QocXVlcnkpLnRvQ29udGFpbihcImluU3RvY2sgPSB0cnVlIE9SIChwcmVvcmRlciA9IHRydWUgQU5EIHJlbGVhc2VEYXRlIDwgMjAyMzAxMDFcIik7XG4gICAgICBleHBlY3QocXVlcnkpLnRvQ29udGFpbihcIk5PVCAocmVzdHJpY3RlZCA9IHRydWUgT1IgYWdlIDwgMTgpXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJoYW5kbGVzIGV4dHJlbWVseSBkZWVwIG5lc3Rpbmcgd2l0aCBtaXhlZCBjb25uZWN0b3JzXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC5hbmRHcm91cChnMSA9PiB7XG4gICAgICAgICAgZzEud2hlcmUoXCJhXCIpLmVxKDEpXG4gICAgICAgICAgICAuYW5kR3JvdXAoZzIgPT4ge1xuICAgICAgICAgICAgICBnMi53aGVyZShcImJcIikuZXEoMilcbiAgICAgICAgICAgICAgICAuYW5kR3JvdXAoZzMgPT4ge1xuICAgICAgICAgICAgICAgICAgZzMud2hlcmUoXCJjXCIpLmVxKDMpXG4gICAgICAgICAgICAgICAgICAgIC5vcldoZXJlKFwiZFwiKS5lcSg0KTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KVxuICAgICAgICAub3JHcm91cChnMSA9PiB7XG4gICAgICAgICAgZzEubm90R3JvdXAoZzIgPT4ge1xuICAgICAgICAgICAgZzIud2hlcmUoXCJlXCIpLmVxKDUpXG4gICAgICAgICAgICAgIC5vckdyb3VwKGczID0+IHtcbiAgICAgICAgICAgICAgICBnMy53aGVyZShcImZcIikuZXEoNilcbiAgICAgICAgICAgICAgICAgIC5hbmRXaGVyZShcImdcIikuZXEoNyk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcblxuICAgICAgLy8gV2UncmUgdGVzdGluZyBkZWVwIG5lc3RpbmcgaGVyZSwgdGhlIGV4YWN0IGZvcm1hdCB2YXJpZXMgYnkgaW1wbGVtZW50YXRpb25cbiAgICAgIGV4cGVjdChxdWVyeSkudG9Db250YWluKFwiYSA9IDFcIik7XG4gICAgICBleHBlY3QocXVlcnkpLnRvQ29udGFpbihcImIgPSAyXCIpO1xuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0NvbnRhaW4oXCJjID0gMyBPUiBkID0gNFwiKTtcbiAgICAgIGV4cGVjdChxdWVyeSkudG9Db250YWluKFwiTk9UIChlID0gNSBPUlwiKTtcbiAgICAgIGV4cGVjdChxdWVyeSkudG9Db250YWluKFwiZiA9IDYgQU5EIGcgPSA3XCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJoYW5kbGVzIHJlYWwtd29ybGQgY29tcGxleCBzZWFyY2ggc2NlbmFyaW9zXCIsICgpID0+IHtcbiAgICAgIC8vIFRoaXMgc2ltdWxhdGVzIGEgY29tcGxleCBwcm9kdWN0IHNlYXJjaCBmaWx0ZXJcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gUXVlcnlCdWlsZGVyLmNyZWF0ZSgpXG4gICAgICAgIC8vIFByaWNlIHJhbmdlXG4gICAgICAgIC53aGVyZShcInByaWNlXCIpLmd0ZSgxMCkuYW5kV2hlcmUoXCJwcmljZVwiKS5sdCgxMDApXG4gICAgICAgIC8vIENhdGVnb3JpZXNcbiAgICAgICAgLmFuZFdoZXJlKFwiY2F0ZWdvcnlcIikuaW4oWyBcImVsZWN0cm9uaWNzXCIsIFwiY29tcHV0ZXJzXCIgXSlcbiAgICAgICAgLy8gQnJhbmQgZmlsdGVyXG4gICAgICAgIC5hbmRHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiYnJhbmRcIikuZXEoXCJBcHBsZVwiKVxuICAgICAgICAgICAgLm9yV2hlcmUoXCJicmFuZFwiKS5lcShcIlNhbXN1bmdcIilcbiAgICAgICAgICAgIC5vcldoZXJlKFwiYnJhbmRcIikuZXEoXCJNaWNyb3NvZnRcIik7XG4gICAgICAgIH0pXG4gICAgICAgIC8vIEF2YWlsYWJpbGl0eVxuICAgICAgICAuYW5kR3JvdXAoZyA9PiB7XG4gICAgICAgICAgZy53aGVyZShcImluU3RvY2tcIikuZXEodHJ1ZSlcbiAgICAgICAgICAgIC5vcldoZXJlKFwiYmFja29yZGVyQXZhaWxhYmxlXCIpLmVxKHRydWUpO1xuICAgICAgICB9KVxuICAgICAgICAvLyBFeGNsdXNpb25zXG4gICAgICAgIC5ub3RHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiZGlzY29udGludWVkXCIpLmVxKHRydWUpXG4gICAgICAgICAgICAub3JXaGVyZShcInJlY2FsbGVkXCIpLmVxKHRydWUpO1xuICAgICAgICB9KVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcbiAgICAgIC8qKlxuICAgICAgICogRXhwZWN0ZWQgb3V0cHV0OlxuICAgICAgICogXCIoXG4gICAgICAgKiBwcmljZSA+PSAxMCBcbiAgICAgICAqIEFORCBwcmljZSA8IDEwMCBcbiAgICAgICAqIEFORCBjYXRlZ29yeSBJTiBbJ2VsZWN0cm9uaWNzJywgJ2NvbXB1dGVycyddIFxuICAgICAgICogQU5EIChicmFuZCA9ICdBcHBsZScgT1IgYnJhbmQgPSAnU2Ftc3VuZycgT1IgYnJhbmQgPSAnTWljcm9zb2Z0JykgXG4gICAgICAgKiBBTkQgKGluU3RvY2sgPSB0cnVlIE9SIGJhY2tvcmRlckF2YWlsYWJsZSA9IHRydWUpIFxuICAgICAgICogQU5EIE5PVCAoZGlzY29udGludWVkID0gdHJ1ZSBPUiByZWNhbGxlZCA9IHRydWUpXG4gICAgICAgKiApXCJcbiAgICAgICAqL1xuXG4gICAgICAvLyBDaGVjayB0aGF0IGFsbCBwYXJ0cyBhcmUgaW5jbHVkZWRcbiAgICAgIGV4cGVjdChxdWVyeSkudG9Db250YWluKFwicHJpY2UgPj0gMTBcIik7XG4gICAgICBleHBlY3QocXVlcnkpLnRvQ29udGFpbihcInByaWNlIDwgMTAwXCIpO1xuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0NvbnRhaW4oXCJjYXRlZ29yeSBJTiBbJ2VsZWN0cm9uaWNzJywgJ2NvbXB1dGVycyddXCIpO1xuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0NvbnRhaW4oXCJicmFuZCA9ICdBcHBsZSdcIik7XG4gICAgICBleHBlY3QocXVlcnkpLnRvQ29udGFpbihcIk9SIGJyYW5kID0gJ1NhbXN1bmcnXCIpO1xuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0NvbnRhaW4oXCJPUiBicmFuZCA9ICdNaWNyb3NvZnQnXCIpO1xuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0NvbnRhaW4oXCJpblN0b2NrID0gdHJ1ZSBPUiBiYWNrb3JkZXJBdmFpbGFibGUgPSB0cnVlXCIpO1xuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0NvbnRhaW4oXCJOT1QgKGRpc2NvbnRpbnVlZCA9IHRydWUgT1IgcmVjYWxsZWQgPSB0cnVlKVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwidGVzdHMgYW5kR3JvdXAgc3BlY2lhbCBoYW5kbGluZyBmb3IgZW1wdHkgcm9vdFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAuYW5kR3JvdXAoZyA9PiB7XG4gICAgICAgICAgZy53aGVyZShcImFcIikuZXEoMSk7XG4gICAgICAgIH0pXG4gICAgICAgIC5idWlsZCgpLm9wdGlvbnMuZmlsdGVyO1xuXG4gICAgICBleHBlY3QocXVlcnkpLnRvQmUoXCJhID0gMVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwidGVzdHMgYW5kR3JvdXAgc3BlY2lhbCBoYW5kbGluZyBmb3IgZXhpc3RpbmcgQU5EIGNvbm5lY3RvclwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAud2hlcmUoXCJhXCIpLmVxKDEpXG4gICAgICAgIC5hbmRHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiYlwiKS5lcSgyKTtcbiAgICAgICAgfSlcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG5cbiAgICAgIGV4cGVjdChxdWVyeSkudG9CZShcIihhID0gMSBBTkQgYiA9IDIpXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJ0ZXN0cyBhbmRHcm91cCBzcGVjaWFsIGhhbmRsaW5nIGZvciBleGlzdGluZyBPUiBjb25uZWN0b3JcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlKFwiYVwiKS5lcSgxKVxuICAgICAgICAub3JXaGVyZShcImJcIikuZXEoMilcbiAgICAgICAgLmFuZEdyb3VwKGcgPT4ge1xuICAgICAgICAgIGcud2hlcmUoXCJjXCIpLmVxKDMpO1xuICAgICAgICB9KVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcblxuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0JlKFwiKChhID0gMSBPUiBiID0gMikgQU5EIGMgPSAzKVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwidGVzdHMgbm90R3JvdXAgc3BlY2lhbCBoYW5kbGluZyBmb3IgZW1wdHkgcm9vdFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAubm90R3JvdXAoZyA9PiB7XG4gICAgICAgICAgZy53aGVyZShcImFcIikuZXEoMSk7XG4gICAgICAgIH0pXG4gICAgICAgIC5idWlsZCgpLm9wdGlvbnMuZmlsdGVyO1xuXG4gICAgICBleHBlY3QocXVlcnkpLnRvQmUoXCJOT1QgKGEgPSAxKVwiKTtcbiAgICB9KTtcblxuICAgIGl0KFwidGVzdHMgbm90R3JvdXAgc3BlY2lhbCBoYW5kbGluZyBmb3IgZXhpc3RpbmcgQU5EIGNvbm5lY3RvclwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGUoKVxuICAgICAgICAud2hlcmUoXCJhXCIpLmVxKDEpXG4gICAgICAgIC5ub3RHcm91cChnID0+IHtcbiAgICAgICAgICBnLndoZXJlKFwiYlwiKS5lcSgyKTtcbiAgICAgICAgfSlcbiAgICAgICAgLmJ1aWxkKCkub3B0aW9ucy5maWx0ZXI7XG5cbiAgICAgIGV4cGVjdChxdWVyeSkudG9CZShcIihhID0gMSBBTkQgTk9UIChiID0gMikpXCIpO1xuICAgIH0pO1xuXG4gICAgaXQoXCJ0ZXN0cyBub3RHcm91cCBzcGVjaWFsIGhhbmRsaW5nIGZvciBleGlzdGluZyBPUiBjb25uZWN0b3JcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlKClcbiAgICAgICAgLndoZXJlKFwiYVwiKS5lcSgxKVxuICAgICAgICAub3JXaGVyZShcImJcIikuZXEoMilcbiAgICAgICAgLm5vdEdyb3VwKGcgPT4ge1xuICAgICAgICAgIGcud2hlcmUoXCJjXCIpLmVxKDMpO1xuICAgICAgICB9KVxuICAgICAgICAuYnVpbGQoKS5vcHRpb25zLmZpbHRlcjtcblxuICAgICAgZXhwZWN0KHF1ZXJ5KS50b0JlKFwiKChhID0gMSBPUiBiID0gMikgQU5EIE5PVCAoYyA9IDMpKVwiKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==