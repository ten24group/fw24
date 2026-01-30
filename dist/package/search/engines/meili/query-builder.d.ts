import { SearchParams } from "meilisearch";
export type Operator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "IN" | "CONTAINS" | "STARTS WITH";
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
export declare class FilterRaw implements FilterNode {
    private raw;
    constructor(raw: string);
    toString(): string;
    clone(): FilterRaw;
}
/** Negation of another FilterNode */
export declare class FilterNot implements FilterNode {
    private node;
    constructor(node: FilterNode);
    toString(): string;
    clone(): FilterNot;
}
/** Simple condition: field operator value */
export declare class FilterCondition implements FilterNode {
    private field;
    private operator;
    private value;
    constructor(field: string, operator: Operator, value: string | number | boolean | Array<string | number | boolean>);
    toString(): string;
    clone(): FilterCondition;
    private format;
}
/** Group of filters joined by AND or OR */
export declare class FilterGroup implements FilterNode {
    connector: "AND" | "OR";
    private children;
    constructor(connector?: "AND" | "OR");
    add(node: FilterNode): this;
    get isEmpty(): boolean;
    toString(): string;
    clone(): FilterGroup;
}
/**
 * The main QueryBuilder DSL
 */
export declare class QueryBuilder<T = Record<string, any>> {
    private q?;
    private root;
    private options;
    constructor(connector?: "AND" | "OR");
    /** Create a new builder */
    static create<U = Record<string, any>>(connector?: "AND" | "OR"): QueryBuilder<U>;
    /**
     * Helper to build a single raw condition safely (quotes & escapes strings for you),
     * serializing arrays and objects correctly.
     */
    static rawCondition(field: string, operator: Operator, value: string | number | boolean | Array<any> | Record<string, any>): FilterRaw;
    /** Full-text query */
    text(str: string): this;
    clearText(): this;
    /** Raw filter string insertion */
    filterRaw(raw: string, connector?: "AND" | "OR"): this;
    /**
     * Shortcut: inject a single condition as a raw filter, safely quoting/escaping strings.
     */
    filterConditionRaw<K extends keyof T>(field: K, operator: Operator, value: T[K] | string | number | boolean, connector?: "AND" | "OR"): this;
    /** AND condition on a field */
    where<K extends keyof T>(field: K): ConditionBuilder<T, K>;
    andWhere: <K extends keyof T>(field: K) => ConditionBuilder<T, K>;
    /** OR condition on a field */
    orWhere<K extends keyof T>(field: K): ConditionBuilder<T, K>;
    or: <K extends keyof T>(field: K) => ConditionBuilder<T, K>;
    /** NOT condition on a field */
    notWhere<K extends keyof T>(field: K): ConditionBuilder<T, K>;
    whereNot: <K extends keyof T>(field: K) => ConditionBuilder<T, K>;
    /**
     * Creates a nested group of filters joined with AND connector.
     * @param fn Callback function receiving a new query builder to define the group
     * @returns This builder instance for chaining
     */
    group(fn: (qb: QueryBuilder<T>) => void): this;
    /** Alias for group() - creates a nested group of filters joined with AND */
    andGroup: (fn: (qb: QueryBuilder<T>) => void) => this;
    /**
     * Creates a nested group of filters joined with OR connector.
     * This handles special logic to ensure OR precedence is maintained correctly.
     *
     * @param fn Callback function receiving a new query builder to define the group
     * @returns This builder instance for chaining
     */
    orGroup(fn: (qb: QueryBuilder<T>) => void): this;
    /**
     * Creates a negated group of filters.
     * The entire group will be prefixed with NOT.
     *
     * @param fn Callback function receiving a new query builder to define the group
     * @returns This builder instance for chaining
     */
    notGroup(fn: (qb: QueryBuilder<T>) => void): this;
    /** Sorting */
    sort(field: keyof T | string, dir: "asc" | "desc"): this;
    clearSort(): this;
    /** Pagination shortcuts */
    limit(n: number): this;
    offset(n: number): this;
    /**
     * Configure pagination with hitsPerPage parameter
     * This provides exhaustive pagination with total hits and total pages
     * @param hits Number of hits per page
     */
    hitsPerPage(hits: number): this;
    /**
     * Set the page number for pagination
     * @param pageNum Page number (1-based)
     * @param size Optional page size, sets limit & offset if hitsPerPage not used
     */
    page(pageNum: number, size?: number): this;
    clearPagination(): this;
    /** Distinct attribute */
    distinct(field: keyof T | string): this;
    clearDistinct(): this;
    /** Field selection */
    select(fields: Array<keyof T | string>): this;
    clearSelect(): this;
    /**
     * Specify facets to return in the response
     * @param fields Array of facet fields or ['*'] for all facets
     */
    facets(fields: Array<keyof T | string> | ["*"]): this;
    clearFacets(): this;
    /** Matching strategy */
    matchingStrategy(ms: MatchingStrategy): this;
    clearMatchingStrategy(): this;
    /**
     * Specify the locales/languages to search in
     * @param localeList Array of locale codes (e.g. ["en-US", "fr-FR"])
     */
    locales(localeList: string[]): this;
    clearLocales(): this;
    /**
     * Configure hybrid search that combines keyword and semantic search
     * @param embedder The name of an embedder configured in Meilisearch
     * @param semanticRatio A number between 0.0 and 1.0 indicating proportion between keyword and semantic results
     */
    hybrid(embedder: string, semanticRatio?: number): this;
    clearHybrid(): this;
    /**
     * Specify which attributes to search on for this query
     * @param fields Array of fields to search on, or ["*"] for all fields
     */
    attributesToSearchOn(fields: Array<keyof T | string>): this;
    clearAttributesToSearchOn(): this;
    /**
     * Set a vector for vector search
     * @param vector Array of numbers representing the embedding vector
     */
    vectorSearch(vector: number[]): this;
    retrieveVectors(flag?: boolean): this;
    clearVectorSearch(): this;
    /**
     * Show ranking score in search results
     */
    showRankingScore(flag?: boolean): this;
    /**
     * Show detailed ranking score information in search results
     */
    showRankingScoreDetails(flag?: boolean): this;
    /**
     * Set a minimum threshold for ranking scores
     * @param threshold A number between 0.0 and 1.0
     */
    rankingScoreThreshold(threshold: number): this;
    clearRankingOptions(): this;
    /** Highlight options */
    highlight(fields: Array<keyof T | string>, pre?: string, post?: string): this;
    showMatchesPosition(flag?: boolean): this;
    clearHighlight(): this;
    /** Crop options */
    crop(fields: Array<keyof T | string>, length?: number, marker?: string): this;
    clearCrop(): this;
    /** Clear filters or all options */
    clearFilters(): this;
    clearAllOptions(): this;
    /** Clone builder with deep copy of the filter AST and options */
    clone(): QueryBuilder<T>;
    /** Build Meilisearch query */
    build(): MeiliSearchQuery;
    toString(): string;
    /** Internal: add filter node respecting connector precedence */
    private addFilterNode;
    /**
     * Filter results within a radius of a geographic point.
     * Requires `_geo` to be in `filterableAttributes`.
     * @param lat Latitude of the center point.
     * @param lng Longitude of the center point.
     * @param distanceInMeters Radius in meters.
     * @param connector How to connect this filter ("AND" or "OR").
     */
    geoRadius(lat: number, lng: number, distanceInMeters: number, connector?: "AND" | "OR"): this;
    /**
     * Filter results within a geographic bounding box.
     * Requires `_geo` to be in `filterableAttributes`.
     * @param topLeft Object with lat and lng for the top-left corner.
     * @param bottomRight Object with lat and lng for the bottom-right corner.
     * @param connector How to connect this filter ("AND" or "OR").
     */
    geoBoundingBox(topLeft: {
        lat: number;
        lng: number;
    }, bottomRight: {
        lat: number;
        lng: number;
    }, connector?: "AND" | "OR"): this;
    /**
     * Sort results by distance from a geographic point.
     * Requires `_geo` to be in `sortableAttributes`.
     * @param lat Latitude of the reference point.
     * @param lng Longitude of the reference point.
     * @param dir Sort direction ("asc" or "desc").
     */
    sortByGeoPoint(lat: number, lng: number, dir?: "asc" | "desc"): this;
}
/** Builder for a single field condition */
export declare class ConditionBuilder<T, K extends keyof T> {
    private parent;
    private connector;
    private field;
    private negated;
    constructor(parent: QueryBuilder<T>, connector: "AND" | "OR", field: string, negated?: boolean);
    /** Invert next condition */
    not(): this;
    private apply;
    eq(v: T[K]): QueryBuilder<T>;
    neq(v: T[K]): QueryBuilder<T>;
    gt(v: number): QueryBuilder<T>;
    gte(v: number): QueryBuilder<T>;
    lt(v: number): QueryBuilder<T>;
    lte(v: number): QueryBuilder<T>;
    in(vals: T[K][]): QueryBuilder<T>;
    notIn(vals: T[K][]): QueryBuilder<T>;
    rangeTo(min: number, max: number): QueryBuilder<T>;
    exists(): QueryBuilder<T>;
    notExists(): QueryBuilder<T>;
    isEmpty(): QueryBuilder<T>;
    isNotEmpty(): QueryBuilder<T>;
    isNull(): QueryBuilder<T>;
    isNotNull(): QueryBuilder<T>;
    contains(v: string): QueryBuilder<T>;
    startsWith(v: string): QueryBuilder<T>;
    equals: (v: T[K]) => QueryBuilder<T>;
    notEqual: (v: T[K]) => QueryBuilder<T>;
    greaterThan: (v: number) => QueryBuilder<T>;
    greaterOrEqual: (v: number) => QueryBuilder<T>;
    lessThan: (v: number) => QueryBuilder<T>;
    lessOrEqual: (v: number) => QueryBuilder<T>;
    inList: (vals: T[K][]) => QueryBuilder<T>;
    notInList: (vals: T[K][]) => QueryBuilder<T>;
    between: (min: number, max: number) => QueryBuilder<T>;
    notBetween: (min: number, max: number) => QueryBuilder<T>;
}
