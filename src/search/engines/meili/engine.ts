import { Index, MeiliSearch, Config as MeiliSearchClientConfig, Settings as MeiliSearchIndexSettings } from "meilisearch";
import { SearchIndexConfig, SearchOptions, SearchQuery, SearchResult } from "../../types";
import { BaseSearchEngine } from "../base";
import { QueryBuilder } from "./query-builder";

export interface ExtendedMeiliSearchClientConfig extends MeiliSearchClientConfig {
}

export interface SearchIndexConfigExt extends SearchIndexConfig {
  meiliSearchIndexSettings?: MeiliSearchIndexSettings
}

export class MeiliSearchEngine extends BaseSearchEngine {
  private client: MeiliSearch;
  private indices = new Map<string, Index>();

  constructor(config: ExtendedMeiliSearchClientConfig) {
    super(config);
    this.client = new MeiliSearch(config);
  }

  async initIndex(config: SearchIndexConfigExt) {
    const idx = config.indexName!;

    const index = this.client.index(idx);

    if (index) {
      return index;
    }

    const res = await this.client.createIndex(idx);

    if (!res) {
      throw new Error(`Failed to create index ${idx}`);
    }

    return res;
  }

  private async getIndex(config: SearchIndexConfigExt): Promise<Index> {
    this.validateConfig(config);
    const idx = config.indexName!;
    if (!this.indices.has(idx)) {
      const index = this.client.index(idx);
      if (config.settings) {

        const indexSettings = {
          ...config.settings,
          ...config.meiliSearchIndexSettings,
        };
        await index.updateSettings(indexSettings);
      }
      this.indices.set(idx, index);
    }
    return this.indices.get(idx)!;
  }

  async index<T extends Record<string, any>>(
    docs: T[],
    config: SearchIndexConfig,
  ): Promise<void> {
    const index = await this.getIndex(config);
    await index.addDocuments(docs);
  }

  async search<T>(
    query: SearchQuery,
    config: SearchIndexConfig,
  ): Promise<SearchResult<T>> {
    const index = await this.getIndex(config);
    const builder = QueryBuilder.create<T>();

    // ─── Full-text search ───────────────────────────────────────────────────────
    const phrase = Array.isArray(query.search)
      ? query.search.join(" ")
      : query.search ?? "";
    builder.text(phrase);

    // ─── Filters ────────────────────────────────────────────────────────────────
    if (query.filters) {
      this.applyFilters(builder, query.filters);
    }

    // ─── Post Filters ────────────────────────────────────────────────────────────────
    if (query.postFilters) {
      // Apply post filters (filtering after aggregations)
      builder.withPostFilter(sub => {
        this.applyFilters(sub, query.postFilters);
      });
    }

    // ─── Sorting ───────────────────────────────────────────────────────────────
    if (query.sort) {
      for (const { field, dir } of query.sort) {
        builder.sort(field, dir);
      }
    }

    // ─── Pagination ────────────────────────────────────────────────────────────
    if (query.pagination?.usePagination) {
      // Use page/hitsPerPage pagination for exhaustive results
      const pageSize = query.pagination?.limit ?? 20;
      const pageNum = Number(query.pagination?.page ?? 1);
      builder.hitsPerPage(pageSize).page(pageNum);
    } else {
      // Use limit/offset pagination (default, faster)
      const pageSize = query.pagination?.limit ?? 20;
      const pageNum = Number(query.pagination?.page ?? 1);
      const offset = (pageNum - 1) * pageSize;
      builder.limit(pageSize).offset(offset);
    }

    // ─── Distinct ──────────────────────────────────────────────────────────────
    if (query.distinctAttribute) {
      builder.distinct(query.distinctAttribute);
    }

    // ─── Field selection ──────────────────────────────────────────────────────
    if (query.select) {
      builder.select(query.select);
    }

    // ─── Attributes to search on ───────────────────────────────────────────────
    if (query.searchAttributes) {
      builder.attributesToSearchOn(query.searchAttributes);
    }

    // ─── Highlighting ─────────────────────────────────────────────────────────
    if (query.highlight) {
      const { fields, preTag, postTag, showMatchesPosition } = query.highlight;
      builder.highlight(fields, preTag, postTag);
      if (showMatchesPosition) builder.showMatchesPosition();
    }

    // ─── Cropping ──────────────────────────────────────────────────────────────
    if (query.crop) {
      const { fields, length, marker } = query.crop;
      builder.crop(fields, length, marker);
    }

    // ─── Faceting ──────────────────────────────────────────────────────────────
    if (query.facetFilters) {
      builder.facetFilters(query.facetFilters);
    }

    let returnFacets: string[] = []

    if (query.returnFacets) {
      returnFacets = query.returnFacets;
    } else if (config.faceting?.facets) {
      returnFacets = Object.keys(config.faceting.facets);
    }

    if (returnFacets.length > 0) {
      builder.facetsDistribution(returnFacets);
      // Enable facet stats for numeric facets
      builder.facetStats(true);
    }

    // ─── Matching strategy ────────────────────────────────────────────────────
    if (query.matchingStrategy) {
      builder.matchingStrategy(query.matchingStrategy);
    }

    // ─── Geo-search ───────────────────────────────────────────────────────────
    if (query.geo) {
      const { lat, lng, radius, precision } = query.geo;
      builder.around(lat, lng, radius, precision);
    }

    // ─── Ranking Score ─────────────────────────────────────────────────────────
    if (query.showRankingScore) {
      builder.showRankingScore(true);
    }

    if (query.showRankingScoreDetails) {
      builder.showRankingScoreDetails(true);
    }

    if (query.rankingScoreThreshold !== undefined) {
      builder.rankingScoreThreshold(query.rankingScoreThreshold);
    }

    // ─── Hybrid & Vector Search ───────────────────────────────────────────────
    if (query.hybrid) {
      const { embedder, semanticRatio } = query.hybrid;
      builder.hybrid(embedder, semanticRatio);
    }

    if (query.vector) {
      builder.vectorSearch(query.vector);

      if (query.retrieveVectors) {
        builder.retrieveVectors(true);
      }
    }

    // ─── Locales ────────────────────────────────────────────────────────────
    if (query.locales && query.locales.length > 0) {
      builder.locales(query.locales);
    }

    // ─── Any custom raw options ───────────────────────────────────────────────
    if (query.rawOptions) {
      for (const [ key, val ] of Object.entries(query.rawOptions)) {
        builder.rawOption(key, val);
      }
    }

    // ─── Build + execute ──────────────────────────────────────────────────────
    const { q: qParam, options } = builder.build();
    const searchOpts: SearchOptions = {
      ...options
    };

    const results = await index.search(qParam ?? "", searchOpts);

    return {
      ...results,
      hits: results.hits as T[],
      facets: results.facetDistribution,
      facetStats: results.facetStats,
      total: results.estimatedTotalHits ?? (results as any).totalHits, // in case of FinitePagination result will have totalHits
      processingTimeMs: results.processingTimeMs,
      query: results.query,
      // Include pagination fields if available
      ...((results as any).page !== undefined && {
        page: (results as any).page,
        hitsPerPage: (results as any).hitsPerPage,
        totalPages: (results as any).totalPages
      })
    };
  }

  protected applyFilters(qb: QueryBuilder<any>, filters: any) {
    // 1) Group filters
    if (filters.and) {
      qb.andGroup(sub => {
        for (const clause of [].concat(filters.and)) {
          this.applyFilters(sub, clause);
        }
      });
      return;
    }
    if (filters.or) {
      // Create a direct OR relation between all the clauses
      const orClauses = [].concat(filters.or);
      if (orClauses.length === 0) {
        return; // Empty OR, nothing to do
      }

      // Handle the first clause with regular where
      this.applyFilters(qb, orClauses[ 0 ]);

      // Handle subsequent clauses with orWhere to ensure OR relation
      for (let i = 1; i < orClauses.length; i++) {
        // Create new builder for each OR clause
        const orBuilder = QueryBuilder.create();
        this.applyFilters(orBuilder, orClauses[ i ]);

        // Add as raw filter with OR connector
        const orFilter = orBuilder.build().options.filters;
        if (orFilter) {
          qb.filterRaw(orFilter, "OR");
        }
      }
      return;
    }
    if (filters.not) {
      // 'not' can be a single object or array
      qb.notGroup(sub => {
        const negs = Array.isArray(filters.not)
          ? filters.not
          : [ filters.not ];
        for (const clause of negs) {
          this.applyFilters(sub, clause);
        }
      });
      return;
    }

    // 2) Leaf filter: an object mapping field -> operator object
    //    (ignoring metadata keys)
    for (const [ field, criteria ] of Object.entries(filters)) {
      if ([ 'filterId', 'filterLabel', 'logicalOp' ].includes(field)) continue;

      // If it's a primitive, treat as eq
      if (
        typeof criteria !== 'object' ||
        criteria === null ||
        Array.isArray(criteria)
      ) {
        qb.where(field).eq(criteria as any);
        continue;
      }

      // It's an object of operators:
      for (const [ op, rawVal ] of Object.entries(criteria)) {
        const val = (rawVal && (rawVal as any).val != null)
          ? (rawVal as any).val
          : rawVal;

        switch (op) {
          case 'eq': qb.where(field).eq(val); break;
          case 'neq': qb.where(field).neq(val); break;
          case 'gt': qb.where(field).gt(Number(val)); break;
          case 'gte': qb.where(field).gte(Number(val)); break;
          case 'lt': qb.where(field).lt(Number(val)); break;
          case 'lte': qb.where(field).lte(Number(val)); break;
          case 'in': qb.where(field).in([].concat(val)); break;
          case 'notIn': qb.where(field).notIn([].concat(val)); break;
          case 'between':
            // support both [min,max] and {from,to}
            const [ min, max ] = Array.isArray(val)
              ? val
              : [ (val as any).from, (val as any).to ];
            qb.where(field).rangeTo(Number(min), Number(max));
            break;
          case 'exists': qb.where(field).exists(); break;
          case 'isEmpty': qb.where(field).isEmpty(); break;
          case 'isNull': qb.where(field).isNull(); break;
          case 'contains': qb.where(field).contains(String(val)); break;
          case 'startsWith':
            qb.where(field).startsWith(String(val));
            break;
          default:
            // unknown -> raw
            qb.filterRaw(`${field} ${op} ${JSON.stringify(val)}`);
        }
      }
    }
  };

  async delete(ids: string[], indexName: string): Promise<void> {
    if (!indexName)
      throw new Error(
        "Index name is required for delete operation in MeiliSearchEngine",
      );
    const idx = this.client.index(indexName);
    await idx.deleteDocuments(ids);
  }
}
