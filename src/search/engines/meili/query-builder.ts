/*
 * MeiliQueryBuilder.ts
 *
 * A TypeScript DSL for building Meilisearch queries programmatically,
 * fully supporting filter expressions per:
 * https://www.meilisearch.com/docs/learn/filtering_and_sorting/filter_expression_reference
 */

import { isString } from "../../../utils/datatypes";

export type Operator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "IN"
  | "CONTAINS"
  | "STARTS WITH";

export type MatchingStrategy = "all" | "last" | "frequency";

export interface MeiliSearchOptions {
  // Core search
  filters?: string;
  sort?: string[];
  limit?: number;
  offset?: number;
  distinctAttribute?: string;
  hitsPerPage?: number;
  page?: number;
  post_filter?: string;

  // Attribute selection
  attributesToRetrieve?: string[];
  attributesToHighlight?: string[];
  attributesToCrop?: string[];
  attributesToSearchOn?: string[];

  // Faceting
  facetFilters?: Array<string | string[]>;
  facetsDistribution?: string[];
  facets?: string[];
  facetStats?: boolean;

  // Behavior
  matchingStrategy?: MatchingStrategy;
  locales?: string[];

  // Highlight/Crop tags
  highlightPreTag?: string;
  highlightPostTag?: string;
  cropLength?: number;
  cropMarker?: string;
  showMatchesPosition?: boolean;

  // Geolocation search
  aroundLatLng?: string;
  aroundRadius?: number;
  aroundPrecision?: number;

  // Hybrid & vector search
  hybrid?: {
    semanticRatio?: number;
    embedder?: string;
  };
  vector?: number[];
  retrieveVectors?: boolean;

  // Ranking & scoring
  showRankingScore?: boolean;
  showRankingScoreDetails?: boolean;
  rankingScoreThreshold?: number;

  // Custom options
  [ key: string ]: any;
}

export interface MeiliSearchQuery {
  q?: string;
  options: MeiliSearchOptions;
}

/** FilterNode AST interface */
export interface FilterNode {
  toString(): string;
  clone(): FilterNode;
}

/** Raw filter injection */
export class FilterRaw implements FilterNode {
  constructor(private raw: string) { }
  toString(): string {
    return this.raw;
  }
  clone(): FilterRaw {
    return new FilterRaw(this.raw);
  }
}

/** Negation of another FilterNode */
export class FilterNot implements FilterNode {
  constructor(private node: FilterNode) { }
  toString(): string {
    const text = this.node.toString();
    return text.startsWith("(") ? `NOT ${text}` : `NOT (${text})`;
  }
  clone(): FilterNot {
    return new FilterNot(this.node.clone());
  }
}

/** Simple condition: field operator value */
export class FilterCondition implements FilterNode {
  constructor(
    private field: string,
    private operator: Operator,
    private value: string | number | boolean | Array<string | number | boolean>,
  ) { }

  toString(): string {
    const val = Array.isArray(this.value)
      ? `[${this.value.map((v) => this.format(v)).join(", ")}]`
      : this.format(this.value);
    return `${this.field} ${this.operator} ${val}`;
  }

  clone(): FilterCondition {
    // shallow-copy array or primitive
    const valCopy = Array.isArray(this.value)
      ? ([ ...this.value ] as Array<string | number | boolean>)
      : this.value;
    return new FilterCondition(this.field, this.operator, valCopy);
  }

  private format(v: string | number | boolean): string {
    if (typeof v === "string") return `'${v.replace(/'/g, "\\'")}'`;
    return String(v);
  }
}

/** Group of filters joined by AND or OR */
export class FilterGroup implements FilterNode {
  private children: FilterNode[] = [];
  constructor(public connector: "AND" | "OR" = "AND") { }

  add(node: FilterNode): this {
    this.children.push(node);
    return this;
  }

  get isEmpty(): boolean {
    return this.children.length === 0;
  }

  toString(): string {
    if (this.isEmpty) return "";
    const parts = this.children.map((c) => {
      const res = c.toString()

      if (!isString(res)) {
        debugger;
        throw new Error("FilterGroup contains non-string child");
      }
      return res;
    }).filter(Boolean);
    if (!parts.length) return "";
    const joined = parts.join(` ${this.connector} `);
    // Only wrap in parentheses if it has multiple parts
    return parts.length > 1 ? `(${joined})` : joined;
  }

  clone(): FilterGroup {
    const copy = new FilterGroup(this.connector);
    this.children.forEach((child) => copy.add(child.clone()));
    return copy;
  }
}

/**
 * The main QueryBuilder DSL
 */
export class QueryBuilder<T = Record<string, any>> {
  private q?: string;
  private root: FilterGroup;
  private options: MeiliSearchOptions = {};

  constructor(connector: "AND" | "OR" = "AND") {
    this.root = new FilterGroup(connector);
  }

  /** Create a new builder */
  static create<U = Record<string, any>>(connector?: "AND" | "OR"): QueryBuilder<U> {
    return new QueryBuilder<U>(connector);
  }

  /**
   * Helper to build a single raw condition safely (quotes & escapes strings for you),
   * serializing arrays and objects correctly.
   */
  static rawCondition(
    field: string,
    operator: Operator,
    value: string | number | boolean | Array<any> | Record<string, any>,
  ): FilterRaw {

    let valStr: string;
    if (typeof value === "string") {
      valStr = `'${value.replace(/'/g, "\\'")}'`;
    } else if (typeof value === "number" || typeof value === "boolean") {
      valStr = String(value);
    } else {
      // arrays or objects
      valStr = JSON.stringify(value);
    }
    return new FilterRaw(`${field} ${operator} ${valStr}`);
  }

  /** Full-text query */
  text(str: string): this {
    this.q = str;
    return this;
  }
  clearText(): this {
    this.q = undefined;
    return this;
  }

  /** Raw filter string insertion */
  filterRaw(raw: string, connector: "AND" | "OR" = "AND"): this {
    this.addFilterNode(new FilterRaw(raw), connector);
    return this;
  }

  /**
   * Shortcut: inject a single condition as a raw filter, safely quoting/escaping strings.
   */
  filterConditionRaw<K extends keyof T>(
    field: K,
    operator: Operator,
    value: T[ K ] | string | number | boolean,
    connector: "AND" | "OR" = "AND",
  ): this {
    const node = QueryBuilder.rawCondition(
      String(field),
      operator,
      value as any,
    );
    this.addFilterNode(node, connector);
    return this;
  }

  /** AND condition on a field */
  where<K extends keyof T>(field: K): ConditionBuilder<T, K> {
    return new ConditionBuilder<T, K>(this as any, "AND", String(field), false);
  }
  andWhere = this.where;

  /** OR condition on a field */
  orWhere<K extends keyof T>(field: K): ConditionBuilder<T, K> {
    return new ConditionBuilder<T, K>(this as any, "OR", String(field), false);
  }
  or = this.orWhere;

  /** NOT condition on a field */
  notWhere<K extends keyof T>(field: K): ConditionBuilder<T, K> {
    return new ConditionBuilder<T, K>(this as any, "AND", String(field), true);
  }
  whereNot = this.notWhere;

  /** 
   * Creates a nested group of filters joined with AND connector.
   * @param fn Callback function receiving a new query builder to define the group
   * @returns This builder instance for chaining
   */
  group(fn: (qb: QueryBuilder<T>) => void): this {
    const sub = QueryBuilder.create<T>("AND");
    fn(sub);

    // Special handling for AND groups similar to orGroup
    if (this.root.isEmpty) {
      // If our root is empty, just use the subquery's root
      this.root = sub.root;
    } else if (this.root.connector === "AND") {
      // If current root is already AND, just add the subquery root to it
      this.root.add(sub.root);
    } else {
      // If current root is OR but we need to add with AND, create a new 
      // root group with AND connector
      const newRoot = new FilterGroup("AND");
      newRoot.add(this.root);
      newRoot.add(sub.root);
      this.root = newRoot;
    }
    return this;
  }

  /** Alias for group() - creates a nested group of filters joined with AND */
  andGroup = this.group;

  /** 
   * Creates a nested group of filters joined with OR connector.
   * This handles special logic to ensure OR precedence is maintained correctly.
   * 
   * @param fn Callback function receiving a new query builder to define the group
   * @returns This builder instance for chaining
   */
  orGroup(fn: (qb: QueryBuilder<T>) => void): this {
    const sub = QueryBuilder.create<T>("OR");
    fn(sub);

    // Handle the logic specially for OR groups to ensure proper connector
    if (this.root.isEmpty) {
      // If our root is empty, just use the subquery's root
      this.root = sub.root;
    } else if (this.root.connector === "OR") {
      // If current root is already OR, just add the subquery root to it
      this.root.add(sub.root);
    } else {
      // If current root is AND but we need to add with OR, create a new 
      // root group with OR connector
      const newRoot = new FilterGroup("OR");
      newRoot.add(this.root);
      newRoot.add(sub.root);
      this.root = newRoot;
    }
    return this;
  }

  /** 
   * Creates a negated group of filters.
   * The entire group will be prefixed with NOT.
   * 
   * @param fn Callback function receiving a new query builder to define the group
   * @returns This builder instance for chaining
   */
  notGroup(fn: (qb: QueryBuilder<T>) => void): this {
    // Create a sub-builder with default AND connector
    const sub = QueryBuilder.create<T>("AND");
    fn(sub);

    // Wrap the sub-query's filter tree with a FilterNot node
    const notNode = new FilterNot(sub.root);

    // Handle the integration into the main filter tree
    if (this.root.isEmpty) {
      // If root is empty, create a new group with the NOT node
      this.root = new FilterGroup("AND");
      this.root.add(notNode);
    } else if (this.root.connector === "AND") {
      // If root is already AND, just add the NOT node
      this.root.add(notNode);
    } else {
      // If root is OR, create a new AND group with the NOT node
      const newRoot = new FilterGroup("AND");
      newRoot.add(this.root);
      newRoot.add(notNode);
      this.root = newRoot;
    }

    return this;
  }

  /** Sorting */
  sort(field: keyof T | string, dir: "asc" | "desc"): this {
    this.options.sort = [
      ...(this.options.sort || []),
      `${field as string}:${dir}`,
    ];
    return this;
  }
  clearSort(): this {
    delete this.options.sort;
    return this;
  }

  /** Pagination shortcuts */
  limit(n: number): this {
    this.options.limit = n;
    return this;
  }
  offset(n: number): this {
    this.options.offset = n;
    return this;
  }

  /**
   * Configure pagination with hitsPerPage parameter
   * This provides exhaustive pagination with total hits and total pages
   * @param hits Number of hits per page
   */
  hitsPerPage(hits: number): this {
    this.options.hitsPerPage = hits;
    return this;
  }

  /**
   * Set the page number for pagination
   * @param pageNum Page number (1-based)
   * @param size Optional page size, sets limit & offset if hitsPerPage not used
   */
  page(pageNum: number, size?: number): this {
    if (this.options.hitsPerPage !== undefined || size === undefined) {
      // Use new pagination style with hitsPerPage/page
      this.options.page = pageNum;
    } else {
      // Use legacy limit/offset style pagination
      this.options.limit = size;
      this.options.offset = (pageNum - 1) * size;
    }
    return this;
  }

  clearPagination(): this {
    delete this.options.limit;
    delete this.options.offset;
    delete this.options.hitsPerPage;
    delete this.options.page;
    return this;
  }

  /**
   * Add a post filter to filter search hits after aggregations
   * This can be used for faceted search to preserve aggregation values
   * @param filter The filter string or expression
   */
  postFilter(filter: string): this {
    this.options.post_filter = filter;
    return this;
  }

  /**
   * Add a post filter (filtering after search) using a builder
   * This is useful for faceted search to preserve facet counts while filtering results
   * @param builderFn Function that configures filter conditions
   */
  withPostFilter(builderFn: (qb: QueryBuilder<T>) => void): this {
    const postFilterBuilder = QueryBuilder.create<T>();
    builderFn(postFilterBuilder);
    this.options.post_filter = postFilterBuilder.root.toString();
    return this;
  }

  /**
   * Clear post filter configuration
   */
  clearPostFilter(): this {
    delete this.options.post_filter;
    return this;
  }

  /** Distinct attribute */
  distinct(field: keyof T | string): this {
    this.options.distinctAttribute = String(field);
    return this;
  }
  clearDistinct(): this {
    delete this.options.distinctAttribute;
    return this;
  }

  /** Field selection */
  select(fields: Array<keyof T | string>): this {
    this.options.attributesToRetrieve = fields as string[];
    return this;
  }
  clearSelect(): this {
    delete this.options.attributesToRetrieve;
    return this;
  }

  /**
   * Specify facets to return in the response
   * @param fields Array of facet fields or ['*'] for all facets
   */
  facets(fields: Array<keyof T | string> | [ "*" ]): this {
    this.options.facets = fields as string[];
    return this;
  }

  /**
   * Enable facet stats in the response
   * Returns min/max values for numerical facets
   */
  facetStats(enabled: boolean = true): this {
    this.options.facetStats = enabled;
    return this;
  }

  clearFacets(): this {
    delete this.options.facets;
    delete this.options.facetStats;
    return this;
  }

  /** Faceting filters */
  facetFilter<K extends keyof T>(field: K, ...vals: T[ K ][]): this {
    const key = String(field);
    // reuse existing array or start fresh
    const arr = this.options.facetFilters || [];
    const f = vals.map((v) => `${key}:${String(v)}`);
    arr.push(f);
    this.options.facetFilters = arr;
    return this;
  }
  facetFilters(filters: Array<string | string[]>): this {
    this.options.facetFilters = filters;
    return this;
  }
  clearFacetFilters(): this {
    delete this.options.facetFilters;
    return this;
  }

  /**
   * Add a facet filter using a more flexible builder pattern
   * @param field The facet field to filter on
   * @param filterFn Function to build filter conditions for this facet
   * @returns This builder instance for chaining
   */
  withFacetFilter<K extends keyof T>(field: K, filterFn: (builder: FacetFilterBuilder<T[ K ]>) => void): this {
    // Initialize the builder
    const builder = new FacetFilterBuilder<T[ K ]>(String(field));
    filterFn(builder);

    // Get the built facet filter
    const filter = builder.build();
    if (!filter) return this; // No filters added

    // Add to the facet filters array
    const arr = this.options.facetFilters || [];
    arr.push(filter);
    this.options.facetFilters = arr;
    return this;
  }

  /** Facets distribution */
  facetsDistribution(fields: Array<keyof T | string>): this {
    this.options.facetsDistribution = fields as string[];
    return this;
  }
  clearFacetsDistribution(): this {
    delete this.options.facetsDistribution;
    return this;
  }

  /** Matching strategy */
  matchingStrategy(ms: MatchingStrategy): this {
    this.options.matchingStrategy = ms;
    return this;
  }
  clearMatchingStrategy(): this {
    delete this.options.matchingStrategy;
    return this;
  }

  /**
   * Specify the locales/languages to search in
   * @param localeList Array of locale codes (e.g. ["en-US", "fr-FR"])
   */
  locales(localeList: string[]): this {
    this.options.locales = localeList;
    return this;
  }

  clearLocales(): this {
    delete this.options.locales;
    return this;
  }

  /** 
   * Configure hybrid search that combines keyword and semantic search
   * @param embedder The name of an embedder configured in Meilisearch
   * @param semanticRatio A number between 0.0 and 1.0 indicating proportion between keyword and semantic results
   */
  hybrid(embedder: string, semanticRatio: number = 0.5): this {
    this.options.hybrid = { embedder, semanticRatio };
    return this;
  }
  clearHybrid(): this {
    delete this.options.hybrid;
    return this;
  }

  /** 
   * Specify which attributes to search on for this query
   * @param fields Array of fields to search on, or ["*"] for all fields
   */
  attributesToSearchOn(fields: Array<keyof T | string>): this {
    this.options.attributesToSearchOn = fields as string[];
    return this;
  }
  clearAttributesToSearchOn(): this {
    delete this.options.attributesToSearchOn;
    return this;
  }

  /**
   * Set a vector for vector search
   * @param vector Array of numbers representing the embedding vector
   */
  vectorSearch(vector: number[]): this {
    this.options.vector = vector;
    return this;
  }
  retrieveVectors(flag: boolean = true): this {
    this.options.retrieveVectors = flag;
    return this;
  }
  clearVectorSearch(): this {
    delete this.options.vector;
    delete this.options.retrieveVectors;
    return this;
  }

  /**
   * Show ranking score in search results
   */
  showRankingScore(flag: boolean = true): this {
    this.options.showRankingScore = flag;
    return this;
  }

  /**
   * Show detailed ranking score information in search results
   */
  showRankingScoreDetails(flag: boolean = true): this {
    this.options.showRankingScoreDetails = flag;
    return this;
  }

  /**
   * Set a minimum threshold for ranking scores
   * @param threshold A number between 0.0 and 1.0
   */
  rankingScoreThreshold(threshold: number): this {
    this.options.rankingScoreThreshold = threshold;
    return this;
  }

  clearRankingOptions(): this {
    delete this.options.showRankingScore;
    delete this.options.showRankingScoreDetails;
    delete this.options.rankingScoreThreshold;
    return this;
  }

  /** Highlight options */
  highlight(
    fields: Array<keyof T | string>,
    pre = "<em>",
    post = "</em>",
  ): this {
    this.options.attributesToHighlight = fields as string[];
    this.options.highlightPreTag = pre;
    this.options.highlightPostTag = post;
    return this;
  }
  showMatchesPosition(flag = true): this {
    this.options.showMatchesPosition = flag;
    return this;
  }
  clearHighlight(): this {
    delete this.options.attributesToHighlight;
    delete this.options.highlightPreTag;
    delete this.options.highlightPostTag;
    delete this.options.showMatchesPosition;
    return this;
  }

  /** Crop options */
  crop(fields: Array<keyof T | string>, length = 50, marker = "..."): this {
    this.options.attributesToCrop = fields as string[];
    this.options.cropLength = length;
    this.options.cropMarker = marker;
    return this;
  }
  clearCrop(): this {
    delete this.options.attributesToCrop;
    delete this.options.cropLength;
    delete this.options.cropMarker;
    return this;
  }

  /** Geolocation search */
  around(lat: number, lng: number, radius?: number, precision?: number): this {
    this.options.aroundLatLng = `${lat},${lng}`;
    if (radius !== undefined) this.options.aroundRadius = radius;
    if (precision !== undefined) this.options.aroundPrecision = precision;
    return this;
  }
  clearGeo(): this {
    delete this.options.aroundLatLng;
    delete this.options.aroundRadius;
    delete this.options.aroundPrecision;
    return this;
  }

  /** Raw option setter */
  rawOption(key: string, value: any): this {
    this.options[ key ] = value;
    return this;
  }

  /** Clear filters or all options */
  clearFilters(): this {
    this.root = new FilterGroup("AND");
    return this;
  }
  clearAllOptions(): this {
    this.options = {};
    return this;
  }

  /** Clone builder with deep copy of the filter AST and options */
  clone(): QueryBuilder<T> {
    const copy = QueryBuilder.create<T>();
    copy.q = this.q;
    copy.root = this.root.clone();
    // deep copy options (primitives & arrays)
    copy.options = JSON.parse(JSON.stringify(this.options));
    return copy;
  }

  /** Build Meilisearch query */
  build(): MeiliSearchQuery {
    const opts = { ...this.options };
    const f = this.root.toString();
    if (f) opts.filters = f;
    return { q: this.q, options: opts };
  }

  toString(): string {
    return JSON.stringify(this.build(), null, 2);
  }

  /** Internal: add filter node respecting connector precedence */
  private addFilterNode(node: FilterNode, connector: "AND" | "OR") {
    if (this.root.isEmpty) {
      // first node ever: use its connector
      this.root.connector = connector;
      this.root.add(node);
    } else if (this.root.connector === connector) {
      this.root.add(node);
    } else {
      // If we're adding an OR node to an AND group or vice versa,
      // create a new group with the appropriate connector
      const grp = new FilterGroup(connector);
      if (node instanceof FilterGroup) {
        // Preserve the connector of the nested group
        grp.connector = node.connector;
      }
      grp.add(this.root).add(node);
      this.root = grp;
    }
  }
}

/** Builder for a single field condition */
export class ConditionBuilder<T, K extends keyof T> {
  private negated: boolean;
  constructor(
    private parent: QueryBuilder<T>,
    private connector: "AND" | "OR",
    private field: string,
    negated = false,
  ) {
    this.negated = negated;
  }

  /** Invert next condition */
  not(): this {
    this.negated = !this.negated;
    return this;
  }

  private apply(op: Operator, val: T[ K ] | T[ K ][]): QueryBuilder<T> {
    let node: FilterNode = new FilterCondition(this.field, op, val as any);
    if (this.negated) node = new FilterNot(node);
    (this.parent as any).addFilterNode(node, this.connector);
    return this.parent;
  }

  // Basic comparisons
  eq(v: T[ K ]): QueryBuilder<T> {
    return this.apply("=", v);
  }
  neq(v: T[ K ]): QueryBuilder<T> {
    return this.apply("!=", v);
  }
  gt(v: number): QueryBuilder<T> {
    return this.apply(">", v as any);
  }
  gte(v: number): QueryBuilder<T> {
    return this.apply(">=", v as any);
  }
  lt(v: number): QueryBuilder<T> {
    return this.apply("<", v as any);
  }
  lte(v: number): QueryBuilder<T> {
    return this.apply("<=", v as any);
  }

  // Array and range
  in(vals: T[ K ][]): QueryBuilder<T> {
    return this.apply("IN", vals);
  }
  notIn(vals: T[ K ][]): QueryBuilder<T> {
    this.not();
    return this.apply("IN", vals);
  }

  // Range with TO
  rangeTo(min: number, max: number): QueryBuilder<T> {
    // use FilterNode here, since you may wrap it in FilterNot
    let node: FilterNode = new FilterRaw(
      `${this.field} ${min} TO ${max}`
    );

    if (this.negated) {
      node = new FilterNot(node);
    }

    // add the node (whether raw or negated) into the AST
    (this.parent as any).addFilterNode(node, this.connector);
    return this.parent;
  }

  // EXISTS / IS NULL / IS EMPTY
  exists(): QueryBuilder<T> {
    let raw: FilterNode = new FilterRaw(`${this.field} EXISTS`);
    if (this.negated) raw = new FilterNot(raw);
    (this.parent as any).addFilterNode(raw, this.connector);
    return this.parent;
  }
  notExists(): QueryBuilder<T> {
    return this.not().exists();
  }

  isEmpty(): QueryBuilder<T> {
    let raw: FilterNode = new FilterRaw(`${this.field} IS EMPTY`);
    if (this.negated) raw = new FilterNot(raw);
    (this.parent as any).addFilterNode(raw, this.connector);
    return this.parent;
  }
  isNotEmpty(): QueryBuilder<T> {
    return this.not().isEmpty();
  }

  isNull(): QueryBuilder<T> {
    let raw: FilterNode = new FilterRaw(`${this.field} IS NULL`);
    if (this.negated) raw = new FilterNot(raw);
    (this.parent as any).addFilterNode(raw, this.connector);
    return this.parent;
  }
  isNotNull(): QueryBuilder<T> {
    return this.not().isNull();
  }

  // String‐pattern matching (experimental)
  contains(v: string): QueryBuilder<T> {
    return this.apply("CONTAINS", v as any);
  }
  startsWith(v: string): QueryBuilder<T> {
    return this.apply("STARTS WITH", v as any);
  }

  // Synonyms
  equals = this.eq;
  notEqual = this.neq;
  greaterThan = this.gt;
  greaterOrEqual = this.gte;
  lessThan = this.lt;
  lessOrEqual = this.lte;
  inList = this.in;
  notInList = this.notIn;
  between = this.rangeTo; // convenience if you prefer TO syntax
  notBetween = this.not().rangeTo.bind(this);
}

/**
 * Builder for facet filters
 * Provides type-safe methods for building facet filter expressions
 */
export class FacetFilterBuilder<T> {
  private filters: string[] = [];

  constructor(private field: string) { }

  /**
   * Add a value to include in this facet filter
   * @param value The facet value to include
   */
  eq(value: T): this {
    this.filters.push(`${this.field}:${String(value)}`);
    return this;
  }

  /**
   * Add multiple values to include in this facet filter (OR relation)
   * @param values The facet values to include
   */
  in(values: T[]): this {
    values.forEach(value => this.eq(value));
    return this;
  }

  /**
   * Exclude a specific value from this facet
   * @param value The facet value to exclude
   */
  not(value: T): this {
    this.filters.push(`NOT ${this.field}:${String(value)}`);
    return this;
  }

  /**
   * Exclude multiple values from this facet (AND NOT relation)
   * @param values The facet values to exclude
   */
  notIn(values: T[]): this {
    values.forEach(value => this.not(value));
    return this;
  }

  /**
   * Build the facet filter array
   * @returns Array of facet filter strings or undefined if no filters
   */
  build(): string[] | undefined {
    return this.filters.length > 0 ? this.filters : undefined;
  }
}
