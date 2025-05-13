import { QueryBuilder } from "./query-builder";

describe("Advanced MeiliQueryBuilder Features", () => {
  describe("Hybrid Search", () => {
    it("configures hybrid search with default semanticRatio", () => {
      const query = QueryBuilder.create()
        .hybrid("custom-embedder")
        .build();

      expect(query.options.hybrid).toEqual({
        embedder: "custom-embedder",
        semanticRatio: 0.5
      });
    });

    it("configures hybrid search with custom semanticRatio", () => {
      const query = QueryBuilder.create()
        .hybrid("custom-embedder", 0.8)
        .build();

      expect(query.options.hybrid).toEqual({
        embedder: "custom-embedder",
        semanticRatio: 0.8
      });
    });

    it("clears hybrid search configuration", () => {
      const query = QueryBuilder.create()
        .hybrid("custom-embedder")
        .clearHybrid()
        .build();

      expect(query.options.hybrid).toBeUndefined();
    });
  });

  describe("Vector Search", () => {
    it("configures vector search", () => {
      const vector = [ 0.1, 0.2, 0.3, 0.4, 0.5 ];
      const query = QueryBuilder.create()
        .vectorSearch(vector)
        .build();

      expect(query.options.vector).toEqual(vector);
    });

    it("enables retrieveVectors option", () => {
      const query = QueryBuilder.create()
        .retrieveVectors()
        .build();

      expect(query.options.retrieveVectors).toBe(true);
    });

    it("clears vector search configuration", () => {
      const query = QueryBuilder.create()
        .vectorSearch([ 0.1, 0.2, 0.3 ])
        .retrieveVectors()
        .clearVectorSearch()
        .build();

      expect(query.options.vector).toBeUndefined();
      expect(query.options.retrieveVectors).toBeUndefined();
    });
  });

  describe("Attributes to Search On", () => {
    it("specifies attributes to search on", () => {
      const query = QueryBuilder.create()
        .attributesToSearchOn([ "title", "description" ])
        .build();

      expect(query.options.attributesToSearchOn).toEqual([ "title", "description" ]);
    });

    it("clears attributes to search on", () => {
      const query = QueryBuilder.create()
        .attributesToSearchOn([ "title", "description" ])
        .clearAttributesToSearchOn()
        .build();

      expect(query.options.attributesToSearchOn).toBeUndefined();
    });
  });

  describe("Ranking Options", () => {
    it("enables showing ranking score", () => {
      const query = QueryBuilder.create()
        .showRankingScore()
        .build();

      expect(query.options.showRankingScore).toBe(true);
    });

    it("enables showing ranking score details", () => {
      const query = QueryBuilder.create()
        .showRankingScoreDetails()
        .build();

      expect(query.options.showRankingScoreDetails).toBe(true);
    });

    it("sets ranking score threshold", () => {
      const query = QueryBuilder.create()
        .rankingScoreThreshold(0.75)
        .build();

      expect(query.options.rankingScoreThreshold).toBe(0.75);
    });

    it("clears ranking options", () => {
      const query = QueryBuilder.create()
        .showRankingScore()
        .showRankingScoreDetails()
        .rankingScoreThreshold(0.75)
        .clearRankingOptions()
        .build();

      expect(query.options.showRankingScore).toBeUndefined();
      expect(query.options.showRankingScoreDetails).toBeUndefined();
      expect(query.options.rankingScoreThreshold).toBeUndefined();
    });
  });

  describe("Matching Strategy", () => {
    it("supports 'frequency' matching strategy", () => {
      const query = QueryBuilder.create()
        .matchingStrategy("frequency")
        .build();

      expect(query.options.matchingStrategy).toBe("frequency");
    });
  });

  // Tests for newly added features
  describe("Enhanced Pagination", () => {
    it("configures pagination with hitsPerPage", () => {
      const query = QueryBuilder.create()
        .hitsPerPage(20)
        .build();

      expect(query.options.hitsPerPage).toBe(20);
    });

    it("configures pagination with page number", () => {
      const query = QueryBuilder.create()
        .hitsPerPage(20)
        .page(3)
        .build();

      expect(query.options.hitsPerPage).toBe(20);
      expect(query.options.page).toBe(3);
      expect(query.options.limit).toBeUndefined();
      expect(query.options.offset).toBeUndefined();
    });

    it("uses legacy pagination when no hitsPerPage is set", () => {
      const query = QueryBuilder.create()
        .page(3, 15)
        .build();

      expect(query.options.limit).toBe(15);
      expect(query.options.offset).toBe(30); // (3-1) * 15 = 30
    });

    it("clears all pagination options", () => {
      const query = QueryBuilder.create()
        .hitsPerPage(20)
        .page(3)
        .clearPagination()
        .build();

      expect(query.options.hitsPerPage).toBeUndefined();
      expect(query.options.page).toBeUndefined();
      expect(query.options.limit).toBeUndefined();
      expect(query.options.offset).toBeUndefined();
    });
  });

  describe("Facets", () => {
    it("specifies facets to return", () => {
      const query = QueryBuilder.create()
        .facets([ "category", "brand" ])
        .build();

      expect(query.options.facets).toEqual([ "category", "brand" ]);
    });

    it("clears facet options", () => {
      const query = QueryBuilder.create()
        .facets([ "category", "brand" ])
        .clearFacets()
        .build();

      expect(query.options.facets).toBeUndefined();
    });
  });

  describe("Locales", () => {
    it("specifies search locales", () => {
      const query = QueryBuilder.create()
        .locales([ "en-US", "fr-FR" ])
        .build();

      expect(query.options.locales).toEqual([ "en-US", "fr-FR" ]);
    });

    it("clears locales", () => {
      const query = QueryBuilder.create()
        .locales([ "en-US" ])
        .clearLocales()
        .build();

      expect(query.options.locales).toBeUndefined();
    });
  });

  describe("Post Filter", () => {
    it("adds post filter", () => {
      const query = QueryBuilder.create()
        .postFilter("category = 'books'")
        .build();

      expect(query.options.postFilter).toBe("category = 'books'");
    });

    it("adds post filter using builder pattern", () => {
      const query = QueryBuilder.create()
        .withPostFilter(qb => {
          qb.where("category").eq("books")
            .andWhere("price").lt(50);
        })
        .build();

      expect(query.options.postFilter).toBe("(category = 'books' AND price < 50)");
    });

    it("clears post filter", () => {
      const query = QueryBuilder.create()
        .postFilter("category = 'books'")
        .clearPostFilter()
        .build();

      expect(query.options.postFilter).toBeUndefined();
    });
  });

  describe("Type-safe Facet Filtering", () => {
    it("adds facet filters using builder pattern", () => {
      const query = QueryBuilder.create()
        .withFacetFilter("category", builder => {
          builder.eq("books").eq("magazines");
        })
        .build();

      expect(query.options.facetFilters).toEqual([
        [ "category:books", "category:magazines" ]
      ]);
    });

    it("adds multiple facet filters with different fields", () => {
      const query = QueryBuilder.create()
        .withFacetFilter("category", b => b.eq("books"))
        .withFacetFilter("author", b => b.eq("John Doe"))
        .build();

      expect(query.options.facetFilters).toEqual([
        [ "category:books" ],
        [ "author:John Doe" ]
      ]);
    });

    it("supports negated facet filters", () => {
      const query = QueryBuilder.create()
        .withFacetFilter("category", b => {
          b.eq("books").not("magazines");
        })
        .build();

      expect(query.options.facetFilters).toEqual([
        [ "category:books", "NOT category:magazines" ]
      ]);
    });

    it("supports in() and notIn() for multiple values", () => {
      const query = QueryBuilder.create()
        .withFacetFilter("category", b => {
          b.in([ "books", "magazines" ]).notIn([ "comics", "newspapers" ]);
        })
        .build();

      expect(query.options.facetFilters).toEqual([
        [
          "category:books",
          "category:magazines",
          "NOT category:comics",
          "NOT category:newspapers"
        ]
      ]);
    });
  });

  describe("Combined Features", () => {
    it("combines multiple advanced features", () => {
      const query = QueryBuilder.create()
        .text("search term")
        .hybrid("openai-embedder", 0.7)
        .attributesToSearchOn([ "title", "content" ])
        .showRankingScore()
        .rankingScoreThreshold(0.6)
        .matchingStrategy("all")
        .locales([ "en-US" ])
        .hitsPerPage(25)
        .page(2)
        .facets([ "category", "brand", "price" ])
        .build();

      expect(query.q).toBe("search term");
      expect(query.options.hybrid).toEqual({
        embedder: "openai-embedder",
        semanticRatio: 0.7
      });
      expect(query.options.attributesToSearchOn).toEqual([ "title", "content" ]);
      expect(query.options.showRankingScore).toBe(true);
      expect(query.options.rankingScoreThreshold).toBe(0.6);
      expect(query.options.matchingStrategy).toBe("all");
      expect(query.options.locales).toEqual([ "en-US" ]);
      expect(query.options.hitsPerPage).toBe(25);
      expect(query.options.page).toBe(2);
      expect(query.options.facets).toEqual([ "category", "brand", "price" ]);
    });

    it("demonstrates advanced type-safe filtering scenario", () => {
      // Simulating an e-commerce product search with complex filtering
      const query = QueryBuilder.create()
        .text("modern furniture")
        // Main filters (applied before search)
        .where("available").eq(true)
        .andWhere("price").gte(100).andWhere("price").lte(1000)
        .andGroup(g => {
          g.where("category").eq("living-room")
            .orWhere("category").eq("office")
            .orWhere("category").eq("bedroom");
        })
        // Facet filtering with type-safety
        .withFacetFilter("brand", b => {
          b.in([ "Herman Miller", "Steelcase", "IKEA" ]);
        })
        .withFacetFilter("color", b => {
          b.eq("black").eq("white").eq("natural");
        })
        .withFacetFilter("rating", b => {
          b.not("1").not("2"); // Exclude low-rated products
        })
        // Post filter (applied after search to preserve facet counts)
        .withPostFilter(qb => {
          qb.where("inStock").eq(true)
            .orGroup(g => {
              g.where("backorderAvailable").eq(true)
                .andWhere("restock_date").lt(20230601);
            });
        })
        // Configure pagination and sorting
        .hitsPerPage(24)
        .page(1)
        .sort("popularity", "desc")
        .build();

      // Verify proper structure of all filter types
      expect(query.q).toBe("modern furniture");

      // Main filter
      expect(query.options.filter).toContain("available = true");
      expect(query.options.filter).toContain("price >= 100");
      expect(query.options.filter).toContain("price <= 1000");
      expect(query.options.filter).toContain("category = 'living-room'");

      // Facet filters
      expect(query.options.facetFilters).toContainEqual([
        "brand:Herman Miller", "brand:Steelcase", "brand:IKEA"
      ]);
      expect(query.options.facetFilters).toContainEqual([
        "color:black", "color:white", "color:natural"
      ]);
      expect(query.options.facetFilters).toContainEqual([
        "NOT rating:1", "NOT rating:2"
      ]);

      // Post filter
      expect(query.options.postFilter).toContain("inStock = true");
      expect(query.options.postFilter).toContain("backorderAvailable = true");
      expect(query.options.postFilter).toContain("restock_date < 20230601");

      // Pagination and sorting
      expect(query.options.hitsPerPage).toBe(24);
      expect(query.options.page).toBe(1);
      expect(query.options.sort).toEqual([ "popularity:desc" ]);
    });
  });
}); 