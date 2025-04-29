import { Index, MeiliSearch } from "meilisearch";
import { EntityQuery } from "../../entity/query-types";
import { isNumeric } from "../../utils";
import { SearchEngineConfig, SearchOptions, SearchResult } from "../types";
import { BaseSearchEngine } from "./base";
import { QueryBuilder } from "./meili-search-query-builder";

export interface MeiliSearchConfig {
  host: string;
  apiKey: string;
}

export class MeiliSearchEngine extends BaseSearchEngine {
  private client: MeiliSearch;
  private indices = new Map<string, Index>();

  constructor(config: MeiliSearchConfig) {
    super(config);
    this.client = new MeiliSearch(config);
  }

  private async getIndex(config: SearchEngineConfig): Promise<Index> {
    this.validateConfig(config);
    const idx = config.indexName!;
    if (!this.indices.has(idx)) {
      const index = this.client.index(idx);
      if (config.settings) {
        await index.updateSettings(config.settings);
      }
      this.indices.set(idx, index);
    }
    return this.indices.get(idx)!;
  }

  async index<T extends Record<string, any>>(
    docs: T[],
    config: SearchEngineConfig,
  ): Promise<void> {
    const index = await this.getIndex(config);
    await index.addDocuments(docs);
  }

  // async search<T>(
  //   query: EntityQuery<any>,
  //   config: SearchEngineConfig,
  // ): Promise<SearchResult<T>> {
  //   const index = await this.getIndex(config);
  //   const builder = QueryBuilder.create();

  //   // full-text
  //   if (query.search) {
  //     const phrase = Array.isArray(query.search)
  //       ? query.search.join(" ")
  //       : query.search;
  //     builder.text(phrase);
  //   } else {
  //     builder.text("");
  //   }

  //   // Recursively walk any combination of AND/OR/NOT + leaf filters
  //   const applyFilters = (
  //     qb: QueryBuilder<any>,
  //     filters: any
  //   ) => {
  //     // 1) Group filters
  //     if (filters.and) {
  //       qb.andGroup(sub => {
  //         for (const clause of [].concat(filters.and)) {
  //           applyFilters(sub, clause);
  //         }
  //       });
  //       return;
  //     }
  //     if (filters.or) {
  //       // Create a direct OR relation between all the clauses
  //       const orClauses = [].concat(filters.or);
  //       if (orClauses.length === 0) {
  //         return; // Empty OR, nothing to do
  //       }

  //       // Handle the first clause with regular where
  //       applyFilters(qb, orClauses[ 0 ]);

  //       // Handle subsequent clauses with orWhere to ensure OR relation
  //       for (let i = 1; i < orClauses.length; i++) {
  //         // Create new builder for each OR clause
  //         const orBuilder = QueryBuilder.create();
  //         applyFilters(orBuilder, orClauses[ i ]);

  //         // Add as raw filter with OR connector
  //         const orFilter = orBuilder.build().options.filters;
  //         if (orFilter) {
  //           qb.filterRaw(orFilter, "OR");
  //         }
  //       }
  //       return;
  //     }
  //     if (filters.not) {
  //       // 'not' can be a single object or array
  //       qb.notGroup(sub => {
  //         const negs = Array.isArray(filters.not)
  //           ? filters.not
  //           : [ filters.not ];
  //         for (const clause of negs) {
  //           applyFilters(sub, clause);
  //         }
  //       });
  //       return;
  //     }

  //     // 2) Leaf filter: an object mapping field -> operator object
  //     //    (ignoring metadata keys)
  //     for (const [ field, criteria ] of Object.entries(filters)) {
  //       if ([ 'filterId', 'filterLabel', 'logicalOp' ].includes(field)) continue;

  //       // If it's a primitive, treat as eq
  //       if (
  //         typeof criteria !== 'object' ||
  //         criteria === null ||
  //         Array.isArray(criteria)
  //       ) {
  //         qb.where(field).eq(criteria as any);
  //         continue;
  //       }

  //       // It's an object of operators:
  //       for (const [ op, rawVal ] of Object.entries(criteria)) {
  //         const val = (rawVal && (rawVal as any).val != null)
  //           ? (rawVal as any).val
  //           : rawVal;

  //         switch (op) {
  //           case 'eq': qb.where(field).eq(val); break;
  //           case 'neq': qb.where(field).neq(val); break;
  //           case 'gt': qb.where(field).gt(Number(val)); break;
  //           case 'gte': qb.where(field).gte(Number(val)); break;
  //           case 'lt': qb.where(field).lt(Number(val)); break;
  //           case 'lte': qb.where(field).lte(Number(val)); break;
  //           case 'in': qb.where(field).in([].concat(val)); break;
  //           case 'notIn': qb.where(field).notIn([].concat(val)); break;
  //           case 'between':
  //             // support both [min,max] and {from,to}
  //             const [ min, max ] = Array.isArray(val)
  //               ? val
  //               : [ (val as any).from, (val as any).to ];
  //             qb.where(field).rangeTo(Number(min), Number(max));
  //             break;
  //           case 'exists': qb.where(field).exists(); break;
  //           case 'isEmpty': qb.where(field).isEmpty(); break;
  //           case 'isNull': qb.where(field).isNull(); break;
  //           case 'contains': qb.where(field).contains(String(val)); break;
  //           case 'startsWith':
  //             qb.where(field).startsWith(String(val));
  //             break;
  //           default:
  //             // unknown -> raw
  //             qb.filterRaw(`${field} ${op} ${JSON.stringify(val)}`);
  //         }
  //       }
  //     }
  //   };

  //   if (query.filters) {
  //     applyFilters(builder, query.filters);
  //   }

  //   const { q: qParam, options: qbOpts } = builder.build();

  //   // pagination
  //   const limit = query.pagination?.count ?? 20;
  //   const offset =
  //     query.pagination?.pages && isNumeric(query.pagination.pages)
  //       ? (query.pagination.pages - 1) * limit
  //       : 0;
  //   const sort =
  //     qbOpts.sort ??
  //     (query.pagination?.order
  //       ? [ `createdAt:${query.pagination.order}` ]
  //       : undefined);
  //   const facets = config.faceting?.facets
  //     ? Object.keys(config.faceting.facets)
  //     : undefined;

  //   const searchOpts: SearchOptions = {
  //     ...qbOpts,
  //     limit,
  //     offset,
  //     sort,
  //     facets,
  //   };

  //   const results = await index.search(qParam || "", searchOpts);
  //   return {
  //     ...results,
  //     hits: results.hits as T[],
  //     facets: results.facetDistribution,
  //     total: results.estimatedTotalHits,
  //   };
  // }

  async search<T>(
    query: EntityQuery<any>,
    config: SearchEngineConfig,
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

    // ─── Sorting ───────────────────────────────────────────────────────────────
    // // TODO: enhance query builder
    // if (query.sort) {
    //   // assume query.sort: Array<{ field: string; dir: 'asc'|'desc' }>
    //   for (const { field, dir } of query.sort) {
    //     builder.sort(field, dir);
    //   }
    // } else if (query.pagination?.order) {
    //   builder.sort("createdAt", query.pagination.order);
    // }

    if (query.pagination?.order) {
      builder.sort("createdAt", query.pagination.order);
    } else {
      builder.sort("createdAt", 'desc');
    }

    // ─── Pagination ────────────────────────────────────────────────────────────
    const pageSize = query.pagination?.count ?? 20;
    const pageNum = Number(query.pagination?.pages ?? 1);
    builder.limit(pageSize).offset((pageNum - 1) * pageSize);

    // ─── Distinct ──────────────────────────────────────────────────────────────
    if ((query as any).distinctAttribute) {
      builder.distinct((query as any).distinctAttribute);
    }

    // ─── Field selection ──────────────────────────────────────────────────────
    if ((query as any).select) {
      builder.select((query as any).select);
    }

    // ─── Highlighting ─────────────────────────────────────────────────────────
    if ((query as any).highlight) {
      const { fields, preTag, postTag, showMatchesPosition } = (query as any).highlight;
      builder.highlight(fields, preTag, postTag);
      if (showMatchesPosition) builder.showMatchesPosition();
    }

    // ─── Cropping ──────────────────────────────────────────────────────────────
    if ((query as any).crop) {
      const { fields, length, marker } = (query as any).crop;
      builder.crop(fields, length, marker);
    }

    // ─── Faceting ──────────────────────────────────────────────────────────────
    if ((query as any).facetFilters) {
      builder.facetFilters((query as any).facetFilters);
    }
    if (config.faceting?.facets) {
      builder.facetsDistribution(Object.keys(config.faceting.facets));
    }

    // ─── Matching strategy ────────────────────────────────────────────────────
    if ((query as any).matchingStrategy) {
      builder.matchingStrategy((query as any).matchingStrategy);
    }

    // ─── Geo-search ───────────────────────────────────────────────────────────
    if ((query as any).geo) {
      const { lat, lng, radius, precision } = (query as any).geo;
      builder.around(lat, lng, radius, precision);
    }

    // ─── Any custom raw options ───────────────────────────────────────────────
    if ((query as any).rawOptions) {
      for (const [ key, val ] of Object.entries((query as any).rawOptions)) {
        builder.rawOption(key, val);
      }
    }

    // ─── Build + execute ──────────────────────────────────────────────────────
    const { q: qParam, options } = builder.build();
    const searchOpts: SearchOptions = {
      ...options,
      // ensure limit/offset/sort are set
      limit: options.limit,
      offset: options.offset,
      sort: options.sort,
    };

    const results = await index.search(qParam ?? "", searchOpts);

    return {
      ...results,
      hits: results.hits as T[],
      facets: results.facetDistribution,
      total: results.estimatedTotalHits,
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
