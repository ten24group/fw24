/*
 * MeiliQueryBuilder.ts
 *
 * A TypeScript DSL for building Meilisearch queries programmatically,
 * fully supporting filter expressions per:
 * https://www.meilisearch.com/docs/learn/filtering_and_sorting/filter_expression_reference
 */

import { ExtraRequestInit, SearchParams } from "meilisearch";
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

export interface MeiliSearchQuery {
  q?: string;
  options: SearchParams;
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
  private options: SearchParams = {};

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

  /** Distinct attribute */
  distinct(field: keyof T | string): this {
    this.options.distinct = String(field);
    return this;
  }
  clearDistinct(): this {
    delete this.options.distinct;
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

  clearFacets(): this {
    delete this.options.facets;
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
    if (f) opts.filter = f;
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

  /**
   * Filter results within a radius of a geographic point.
   * Requires `_geo` to be in `filterableAttributes`.
   * @param lat Latitude of the center point.
   * @param lng Longitude of the center point.
   * @param distanceInMeters Radius in meters.
   * @param connector How to connect this filter ("AND" or "OR").
   */
  geoRadius(
    lat: number,
    lng: number,
    distanceInMeters: number,
    connector: "AND" | "OR" = "AND",
  ): this {
    const rawFilter = `_geoRadius(${lat}, ${lng}, ${distanceInMeters})`;
    this.addFilterNode(new FilterRaw(rawFilter), connector);
    return this;
  }

  /**
   * Filter results within a geographic bounding box.
   * Requires `_geo` to be in `filterableAttributes`.
   * @param topLeft Object with lat and lng for the top-left corner.
   * @param bottomRight Object with lat and lng for the bottom-right corner.
   * @param connector How to connect this filter ("AND" or "OR").
   */
  geoBoundingBox(
    topLeft: { lat: number; lng: number },
    bottomRight: { lat: number; lng: number },
    connector: "AND" | "OR" = "AND",
  ): this {
    const rawFilter = `_geoBoundingBox([${topLeft.lat}, ${topLeft.lng}], [${bottomRight.lat}, ${bottomRight.lng}])`;
    this.addFilterNode(new FilterRaw(rawFilter), connector);
    return this;
  }

  /**
   * Sort results by distance from a geographic point.
   * Requires `_geo` to be in `sortableAttributes`.
   * @param lat Latitude of the reference point.
   * @param lng Longitude of the reference point.
   * @param dir Sort direction ("asc" or "desc").
   */
  sortByGeoPoint(
    lat: number,
    lng: number,
    dir: "asc" | "desc" = "asc",
  ): this {
    const sortRule = `_geoPoint(${lat}, ${lng}):${dir}`;
    this.options.sort = [ ...(this.options.sort || []), sortRule ];
    return this;
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