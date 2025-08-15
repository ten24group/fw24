"use strict";
/*
 * MeiliQueryBuilder.ts
 *
 * A TypeScript DSL for building Meilisearch queries programmatically,
 * fully supporting filter expressions per:
 * https://www.meilisearch.com/docs/learn/filtering_and_sorting/filter_expression_reference
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConditionBuilder = exports.QueryBuilder = exports.FilterGroup = exports.FilterCondition = exports.FilterNot = exports.FilterRaw = void 0;
const datatypes_1 = require("../../../utils/datatypes");
/** Raw filter injection */
class FilterRaw {
    raw;
    constructor(raw) {
        this.raw = raw;
    }
    toString() {
        return this.raw;
    }
    clone() {
        return new FilterRaw(this.raw);
    }
}
exports.FilterRaw = FilterRaw;
/** Negation of another FilterNode */
class FilterNot {
    node;
    constructor(node) {
        this.node = node;
    }
    toString() {
        const text = this.node.toString();
        return text.startsWith("(") ? `NOT ${text}` : `NOT (${text})`;
    }
    clone() {
        return new FilterNot(this.node.clone());
    }
}
exports.FilterNot = FilterNot;
/** Simple condition: field operator value */
class FilterCondition {
    field;
    operator;
    value;
    constructor(field, operator, value) {
        this.field = field;
        this.operator = operator;
        this.value = value;
    }
    toString() {
        const val = Array.isArray(this.value)
            ? `[${this.value.map((v) => this.format(v)).join(", ")}]`
            : this.format(this.value);
        return `${this.field} ${this.operator} ${val}`;
    }
    clone() {
        // shallow-copy array or primitive
        const valCopy = Array.isArray(this.value)
            ? [...this.value]
            : this.value;
        return new FilterCondition(this.field, this.operator, valCopy);
    }
    format(v) {
        if (typeof v === "string")
            return `'${v.replace(/'/g, "\\'")}'`;
        return String(v);
    }
}
exports.FilterCondition = FilterCondition;
/** Group of filters joined by AND or OR */
class FilterGroup {
    connector;
    children = [];
    constructor(connector = "AND") {
        this.connector = connector;
    }
    add(node) {
        this.children.push(node);
        return this;
    }
    get isEmpty() {
        return this.children.length === 0;
    }
    toString() {
        if (this.isEmpty)
            return "";
        const parts = this.children.map((c) => {
            const res = c.toString();
            if (!(0, datatypes_1.isString)(res)) {
                throw new Error("FilterGroup contains non-string child");
            }
            return res;
        }).filter(Boolean);
        if (!parts.length)
            return "";
        const joined = parts.join(` ${this.connector} `);
        // Only wrap in parentheses if it has multiple parts
        return parts.length > 1 ? `(${joined})` : joined;
    }
    clone() {
        const copy = new FilterGroup(this.connector);
        this.children.forEach((child) => copy.add(child.clone()));
        return copy;
    }
}
exports.FilterGroup = FilterGroup;
/**
 * The main QueryBuilder DSL
 */
class QueryBuilder {
    q;
    root;
    options = {};
    constructor(connector = "AND") {
        this.root = new FilterGroup(connector);
    }
    /** Create a new builder */
    static create(connector) {
        return new QueryBuilder(connector);
    }
    /**
     * Helper to build a single raw condition safely (quotes & escapes strings for you),
     * serializing arrays and objects correctly.
     */
    static rawCondition(field, operator, value) {
        let valStr;
        if (typeof value === "string") {
            valStr = `'${value.replace(/'/g, "\\'")}'`;
        }
        else if (typeof value === "number" || typeof value === "boolean") {
            valStr = String(value);
        }
        else {
            // arrays or objects
            valStr = JSON.stringify(value);
        }
        return new FilterRaw(`${field} ${operator} ${valStr}`);
    }
    /** Full-text query */
    text(str) {
        this.q = str;
        return this;
    }
    clearText() {
        this.q = undefined;
        return this;
    }
    /** Raw filter string insertion */
    filterRaw(raw, connector = "AND") {
        this.addFilterNode(new FilterRaw(raw), connector);
        return this;
    }
    /**
     * Shortcut: inject a single condition as a raw filter, safely quoting/escaping strings.
     */
    filterConditionRaw(field, operator, value, connector = "AND") {
        const node = QueryBuilder.rawCondition(String(field), operator, value);
        this.addFilterNode(node, connector);
        return this;
    }
    /** AND condition on a field */
    where(field) {
        return new ConditionBuilder(this, "AND", String(field), false);
    }
    andWhere = this.where;
    /** OR condition on a field */
    orWhere(field) {
        return new ConditionBuilder(this, "OR", String(field), false);
    }
    or = this.orWhere;
    /** NOT condition on a field */
    notWhere(field) {
        return new ConditionBuilder(this, "AND", String(field), true);
    }
    whereNot = this.notWhere;
    /**
     * Creates a nested group of filters joined with AND connector.
     * @param fn Callback function receiving a new query builder to define the group
     * @returns This builder instance for chaining
     */
    group(fn) {
        const sub = QueryBuilder.create("AND");
        fn(sub);
        // Special handling for AND groups similar to orGroup
        if (this.root.isEmpty) {
            // If our root is empty, just use the subquery's root
            this.root = sub.root;
        }
        else if (this.root.connector === "AND") {
            // If current root is already AND, just add the subquery root to it
            this.root.add(sub.root);
        }
        else {
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
    orGroup(fn) {
        const sub = QueryBuilder.create("OR");
        fn(sub);
        // Handle the logic specially for OR groups to ensure proper connector
        if (this.root.isEmpty) {
            // If our root is empty, just use the subquery's root
            this.root = sub.root;
        }
        else if (this.root.connector === "OR") {
            // If current root is already OR, just add the subquery root to it
            this.root.add(sub.root);
        }
        else {
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
    notGroup(fn) {
        // Create a sub-builder with default AND connector
        const sub = QueryBuilder.create("AND");
        fn(sub);
        // Wrap the sub-query's filter tree with a FilterNot node
        const notNode = new FilterNot(sub.root);
        // Handle the integration into the main filter tree
        if (this.root.isEmpty) {
            // If root is empty, create a new group with the NOT node
            this.root = new FilterGroup("AND");
            this.root.add(notNode);
        }
        else if (this.root.connector === "AND") {
            // If root is already AND, just add the NOT node
            this.root.add(notNode);
        }
        else {
            // If root is OR, create a new AND group with the NOT node
            const newRoot = new FilterGroup("AND");
            newRoot.add(this.root);
            newRoot.add(notNode);
            this.root = newRoot;
        }
        return this;
    }
    /** Sorting */
    sort(field, dir) {
        this.options.sort = [
            ...(this.options.sort || []),
            `${field}:${dir}`,
        ];
        return this;
    }
    clearSort() {
        delete this.options.sort;
        return this;
    }
    /** Pagination shortcuts */
    limit(n) {
        this.options.limit = n;
        return this;
    }
    offset(n) {
        this.options.offset = n;
        return this;
    }
    /**
     * Configure pagination with hitsPerPage parameter
     * This provides exhaustive pagination with total hits and total pages
     * @param hits Number of hits per page
     */
    hitsPerPage(hits) {
        this.options.hitsPerPage = hits;
        return this;
    }
    /**
     * Set the page number for pagination
     * @param pageNum Page number (1-based)
     * @param size Optional page size, sets limit & offset if hitsPerPage not used
     */
    page(pageNum, size) {
        if (this.options.hitsPerPage !== undefined || size === undefined) {
            // Use new pagination style with hitsPerPage/page
            this.options.page = pageNum;
        }
        else {
            // Use legacy limit/offset style pagination
            this.options.limit = size;
            this.options.offset = (pageNum - 1) * size;
        }
        return this;
    }
    clearPagination() {
        delete this.options.limit;
        delete this.options.offset;
        delete this.options.hitsPerPage;
        delete this.options.page;
        return this;
    }
    /** Distinct attribute */
    distinct(field) {
        this.options.distinct = String(field);
        return this;
    }
    clearDistinct() {
        delete this.options.distinct;
        return this;
    }
    /** Field selection */
    select(fields) {
        this.options.attributesToRetrieve = fields;
        return this;
    }
    clearSelect() {
        delete this.options.attributesToRetrieve;
        return this;
    }
    /**
     * Specify facets to return in the response
     * @param fields Array of facet fields or ['*'] for all facets
     */
    facets(fields) {
        this.options.facets = fields;
        return this;
    }
    clearFacets() {
        delete this.options.facets;
        return this;
    }
    /** Matching strategy */
    matchingStrategy(ms) {
        this.options.matchingStrategy = ms;
        return this;
    }
    clearMatchingStrategy() {
        delete this.options.matchingStrategy;
        return this;
    }
    /**
     * Specify the locales/languages to search in
     * @param localeList Array of locale codes (e.g. ["en-US", "fr-FR"])
     */
    locales(localeList) {
        this.options.locales = localeList;
        return this;
    }
    clearLocales() {
        delete this.options.locales;
        return this;
    }
    /**
     * Configure hybrid search that combines keyword and semantic search
     * @param embedder The name of an embedder configured in Meilisearch
     * @param semanticRatio A number between 0.0 and 1.0 indicating proportion between keyword and semantic results
     */
    hybrid(embedder, semanticRatio = 0.5) {
        this.options.hybrid = { embedder, semanticRatio };
        return this;
    }
    clearHybrid() {
        delete this.options.hybrid;
        return this;
    }
    /**
     * Specify which attributes to search on for this query
     * @param fields Array of fields to search on, or ["*"] for all fields
     */
    attributesToSearchOn(fields) {
        this.options.attributesToSearchOn = fields;
        return this;
    }
    clearAttributesToSearchOn() {
        delete this.options.attributesToSearchOn;
        return this;
    }
    /**
     * Set a vector for vector search
     * @param vector Array of numbers representing the embedding vector
     */
    vectorSearch(vector) {
        this.options.vector = vector;
        return this;
    }
    retrieveVectors(flag = true) {
        this.options.retrieveVectors = flag;
        return this;
    }
    clearVectorSearch() {
        delete this.options.vector;
        delete this.options.retrieveVectors;
        return this;
    }
    /**
     * Show ranking score in search results
     */
    showRankingScore(flag = true) {
        this.options.showRankingScore = flag;
        return this;
    }
    /**
     * Show detailed ranking score information in search results
     */
    showRankingScoreDetails(flag = true) {
        this.options.showRankingScoreDetails = flag;
        return this;
    }
    /**
     * Set a minimum threshold for ranking scores
     * @param threshold A number between 0.0 and 1.0
     */
    rankingScoreThreshold(threshold) {
        this.options.rankingScoreThreshold = threshold;
        return this;
    }
    clearRankingOptions() {
        delete this.options.showRankingScore;
        delete this.options.showRankingScoreDetails;
        delete this.options.rankingScoreThreshold;
        return this;
    }
    /** Highlight options */
    highlight(fields, pre = "<em>", post = "</em>") {
        this.options.attributesToHighlight = fields;
        this.options.highlightPreTag = pre;
        this.options.highlightPostTag = post;
        return this;
    }
    showMatchesPosition(flag = true) {
        this.options.showMatchesPosition = flag;
        return this;
    }
    clearHighlight() {
        delete this.options.attributesToHighlight;
        delete this.options.highlightPreTag;
        delete this.options.highlightPostTag;
        delete this.options.showMatchesPosition;
        return this;
    }
    /** Crop options */
    crop(fields, length = 50, marker = "...") {
        this.options.attributesToCrop = fields;
        this.options.cropLength = length;
        this.options.cropMarker = marker;
        return this;
    }
    clearCrop() {
        delete this.options.attributesToCrop;
        delete this.options.cropLength;
        delete this.options.cropMarker;
        return this;
    }
    /** Clear filters or all options */
    clearFilters() {
        this.root = new FilterGroup("AND");
        return this;
    }
    clearAllOptions() {
        this.options = {};
        return this;
    }
    /** Clone builder with deep copy of the filter AST and options */
    clone() {
        const copy = QueryBuilder.create();
        copy.q = this.q;
        copy.root = this.root.clone();
        // deep copy options (primitives & arrays)
        copy.options = JSON.parse(JSON.stringify(this.options));
        return copy;
    }
    /** Build Meilisearch query */
    build() {
        const opts = { ...this.options };
        const f = this.root.toString();
        if (f)
            opts.filter = f;
        return { q: this.q, options: opts };
    }
    toString() {
        return JSON.stringify(this.build(), null, 2);
    }
    /** Internal: add filter node respecting connector precedence */
    addFilterNode(node, connector) {
        if (this.root.isEmpty) {
            // first node ever: use its connector
            this.root.connector = connector;
            this.root.add(node);
        }
        else if (this.root.connector === connector) {
            this.root.add(node);
        }
        else {
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
    geoRadius(lat, lng, distanceInMeters, connector = "AND") {
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
    geoBoundingBox(topLeft, bottomRight, connector = "AND") {
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
    sortByGeoPoint(lat, lng, dir = "asc") {
        const sortRule = `_geoPoint(${lat}, ${lng}):${dir}`;
        this.options.sort = [...(this.options.sort || []), sortRule];
        return this;
    }
}
exports.QueryBuilder = QueryBuilder;
/** Builder for a single field condition */
class ConditionBuilder {
    parent;
    connector;
    field;
    negated;
    constructor(parent, connector, field, negated = false) {
        this.parent = parent;
        this.connector = connector;
        this.field = field;
        this.negated = negated;
    }
    /** Invert next condition */
    not() {
        this.negated = !this.negated;
        return this;
    }
    apply(op, val) {
        let node = new FilterCondition(this.field, op, val);
        if (this.negated)
            node = new FilterNot(node);
        this.parent.addFilterNode(node, this.connector);
        return this.parent;
    }
    // Basic comparisons
    eq(v) {
        return this.apply("=", v);
    }
    neq(v) {
        return this.apply("!=", v);
    }
    gt(v) {
        return this.apply(">", v);
    }
    gte(v) {
        return this.apply(">=", v);
    }
    lt(v) {
        return this.apply("<", v);
    }
    lte(v) {
        return this.apply("<=", v);
    }
    // Array and range
    in(vals) {
        return this.apply("IN", vals);
    }
    notIn(vals) {
        this.not();
        return this.apply("IN", vals);
    }
    // Range with TO
    rangeTo(min, max) {
        // use FilterNode here, since you may wrap it in FilterNot
        let node = new FilterRaw(`${this.field} ${min} TO ${max}`);
        if (this.negated) {
            node = new FilterNot(node);
        }
        // add the node (whether raw or negated) into the AST
        this.parent.addFilterNode(node, this.connector);
        return this.parent;
    }
    // EXISTS / IS NULL / IS EMPTY
    exists() {
        let raw = new FilterRaw(`${this.field} EXISTS`);
        if (this.negated)
            raw = new FilterNot(raw);
        this.parent.addFilterNode(raw, this.connector);
        return this.parent;
    }
    notExists() {
        return this.not().exists();
    }
    isEmpty() {
        let raw = new FilterRaw(`${this.field} IS EMPTY`);
        if (this.negated)
            raw = new FilterNot(raw);
        this.parent.addFilterNode(raw, this.connector);
        return this.parent;
    }
    isNotEmpty() {
        return this.not().isEmpty();
    }
    isNull() {
        let raw = new FilterRaw(`${this.field} IS NULL`);
        if (this.negated)
            raw = new FilterNot(raw);
        this.parent.addFilterNode(raw, this.connector);
        return this.parent;
    }
    isNotNull() {
        return this.not().isNull();
    }
    // String‐pattern matching (experimental)
    contains(v) {
        return this.apply("CONTAINS", v);
    }
    startsWith(v) {
        return this.apply("STARTS WITH", v);
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
exports.ConditionBuilder = ConditionBuilder;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktYnVpbGRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvZW5naW5lcy9tZWlsaS9xdWVyeS1idWlsZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7OztBQUdILHdEQUFvRDtBQTBCcEQsMkJBQTJCO0FBQzNCLE1BQWEsU0FBUztJQUNBO0lBQXBCLFlBQW9CLEdBQVc7UUFBWCxRQUFHLEdBQUgsR0FBRyxDQUFRO0lBQUksQ0FBQztJQUNwQyxRQUFRO1FBQ04sT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ2xCLENBQUM7SUFDRCxLQUFLO1FBQ0gsT0FBTyxJQUFJLFNBQVMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDakMsQ0FBQztDQUNGO0FBUkQsOEJBUUM7QUFFRCxxQ0FBcUM7QUFDckMsTUFBYSxTQUFTO0lBQ0E7SUFBcEIsWUFBb0IsSUFBZ0I7UUFBaEIsU0FBSSxHQUFKLElBQUksQ0FBWTtJQUFJLENBQUM7SUFDekMsUUFBUTtRQUNOLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLElBQUksR0FBRyxDQUFDO0lBQ2hFLENBQUM7SUFDRCxLQUFLO1FBQ0gsT0FBTyxJQUFJLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBVEQsOEJBU0M7QUFFRCw2Q0FBNkM7QUFDN0MsTUFBYSxlQUFlO0lBRWhCO0lBQ0E7SUFDQTtJQUhWLFlBQ1UsS0FBYSxFQUNiLFFBQWtCLEVBQ2xCLEtBQW1FO1FBRm5FLFVBQUssR0FBTCxLQUFLLENBQVE7UUFDYixhQUFRLEdBQVIs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QUMsTUFBYyxDQUFDLGFBQWEsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3hELE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUNyQixDQUFDO0lBQ0QsU0FBUztRQUNQLE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO0lBQzdCLENBQUM7SUFFRCx5Q0FBeUM7SUFDekMsUUFBUSxDQUFDLENBQVM7UUFDaEIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFRLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBQ0QsVUFBVSxDQUFDLENBQVM7UUFDbEIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFRLENBQUMsQ0FBQztJQUM3QyxDQUFDO0lBRUQsV0FBVztJQUNYLE1BQU0sR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ2pCLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ3BCLFdBQVcsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ3RCLGNBQWMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQzFCLFFBQVEsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ25CLFdBQVcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ3ZCLE1BQU0sR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ2pCLFNBQVMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ3ZCLE9BQU8sR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsc0NBQXNDO0lBQzlELFVBQVUsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztDQUM1QztBQXZIRCw0Q0F1SEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICogTWVpbGlRdWVyeUJ1aWxkZXIudHNcbiAqXG4gKiBBIFR5cGVTY3JpcHQgRFNMIGZvciBidWlsZGluZyBNZWlsaXNlYXJjaCBxdWVyaWVzIHByb2dyYW1tYXRpY2FsbHksXG4gKiBmdWxseSBzdXBwb3J0aW5nIGZpbHRlciBleHByZXNzaW9ucyBwZXI6XG4gKiBodHRwczovL3d3dy5tZWlsaXNlYXJjaC5jb20vZG9jcy9sZWFybi9maWx0ZXJpbmdfYW5kX3NvcnRpbmcvZmlsdGVyX2V4cHJlc3Npb25fcmVmZXJlbmNlXG4gKi9cblxuaW1wb3J0IHsgRXh0cmFSZXF1ZXN0SW5pdCwgU2VhcmNoUGFyYW1zIH0gZnJvbSBcIm1laWxpc2VhcmNoXCI7XG5pbXBvcnQgeyBpc1N0cmluZyB9IGZyb20gXCIuLi8uLi8uLi91dGlscy9kYXRhdHlwZXNcIjtcblxuZXhwb3J0IHR5cGUgT3BlcmF0b3IgPVxuICB8IFwiPVwiXG4gIHwgXCIhPVwiXG4gIHwgXCI+XCJcbiAgfCBcIj49XCJcbiAgfCBcIjxcIlxuICB8IFwiPD1cIlxuICB8IFwiSU5cIlxuICB8IFwiQ09OVEFJTlNcIlxuICB8IFwiU1RBUlRTIFdJVEhcIjtcblxuZXhwb3J0IHR5cGUgTWF0Y2hpbmdTdHJhdGVneSA9IFwiYWxsXCIgfCBcImxhc3RcIiB8IFwiZnJlcXVlbmN5XCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVpbGlTZWFyY2hRdWVyeSB7XG4gIHE/OiBzdHJpbmc7XG4gIG9wdGlvbnM6IFNlYXJjaFBhcmFtcztcbn1cblxuLyoqIEZpbHRlck5vZGUgQVNUIGludGVyZmFjZSAqL1xuZXhwb3J0IGludGVyZmFjZSBGaWx0ZXJOb2RlIHtcbiAgdG9TdHJpbmcoKTogc3RyaW5nO1xuICBjbG9uZSgpOiBGaWx0ZXJOb2RlO1xufVxuXG4vKiogUmF3IGZpbHRlciBpbmplY3Rpb24gKi9cbmV4cG9ydCBjbGFzcyBGaWx0ZXJSYXcgaW1wbGVtZW50cyBGaWx0ZXJOb2RlIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByYXc6IHN0cmluZykgeyB9XG4gIHRvU3RyaW5nKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMucmF3O1xuICB9XG4gIGNsb25lKCk6IEZpbHRlclJhdyB7XG4gICAgcmV0dXJuIG5ldyBGaWx0ZXJSYXcodGhpcy5yYXcpO1xuICB9XG59XG5cbi8qKiBOZWdhdGlvbiBvZiBhbm90aGVyIEZpbHRlck5vZGUgKi9cbmV4cG9ydCBjbGFzcyBGaWx0ZXJOb3QgaW1wbGVtZW50cyBGaWx0ZXJOb2RlIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBub2RlOiBGaWx0ZXJOb2RlKSB7IH1cbiAgdG9TdHJpbmcoKTogc3RyaW5nIHtcbiAgICBjb25zdCB0ZXh0ID0gdGhpcy5ub2RlLnRvU3RyaW5nKCk7XG4gICAgcmV0dXJuIHRleHQuc3RhcnRzV2l0aChcIihcIikgPyBgTk9UICR7dGV4dH1gIDogYE5PVCAoJHt0ZXh0fSlgO1xuICB9XG4gIGNsb25lKCk6IEZpbHRlck5vdCB7XG4gICAgcmV0dXJuIG5ldyBGaWx0ZXJOb3QodGhpcy5ub2RlLmNsb25lKCkpO1xuICB9XG59XG5cbi8qKiBTaW1wbGUgY29uZGl0aW9uOiBmaWVsZCBvcGVyYXRvciB2YWx1ZSAqL1xuZXhwb3J0IGNsYXNzIEZpbHRlckNvbmRpdGlvbiBpbXBsZW1lbnRzIEZpbHRlck5vZGUge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIGZpZWxkOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSBvcGVyYXRvcjogT3BlcmF0b3IsXG4gICAgcHJpdmF0ZSB2YWx1ZTogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IEFycmF5PHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+LFxuICApIHsgfVxuXG4gIHRvU3RyaW5nKCk6IHN0cmluZyB7XG4gICAgY29uc3QgdmFsID0gQXJyYXkuaXNBcnJheSh0aGlzLnZhbHVlKVxuICAgICAgPyBgWyR7dGhpcy52YWx1ZS5tYXAoKHYpID0+IHRoaXMuZm9ybWF0KHYpKS5qb2luKFwiLCBcIil9XWBcbiAgICAgIDogdGhpcy5mb3JtYXQodGhpcy52YWx1ZSk7XG4gICAgcmV0dXJuIGAke3RoaXMuZmllbGR9ICR7dGhpcy5vcGVyYXRvcn0gJHt2YWx9YDtcbiAgfVxuXG4gIGNsb25lKCk6IEZpbHRlckNvbmRpdGlvbiB7XG4gICAgLy8gc2hhbGxvdy1jb3B5IGFycmF5IG9yIHByaW1pdGl2ZVxuICAgIGNvbnN0IHZhbENvcHkgPSBBcnJheS5pc0FycmF5KHRoaXMudmFsdWUpXG4gICAgICA/IChbIC4uLnRoaXMudmFsdWUgXSBhcyBBcnJheTxzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPilcbiAgICAgIDogdGhpcy52YWx1ZTtcbiAgICByZXR1cm4gbmV3IEZpbHRlckNvbmRpdGlvbih0aGlzLmZpZWxkLCB0aGlzLm9wZXJhdG9yLCB2YWxDb3B5KTtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0KHY6IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4pOiBzdHJpbmcge1xuICAgIGlmICh0eXBlb2YgdiA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIGAnJHt2LnJlcGxhY2UoLycvZywgXCJcXFxcJ1wiKX0nYDtcbiAgICByZXR1cm4gU3RyaW5nKHYpO1xuICB9XG59XG5cbi8qKiBHcm91cCBvZiBmaWx0ZXJzIGpvaW5lZCBieSBBTkQgb3IgT1IgKi9cbmV4cG9ydCBjbGFzcyBGaWx0ZXJHcm91cCBpbXBsZW1lbnRzIEZpbHRlck5vZGUge1xuICBwcml2YXRlIGNoaWxkcmVuOiBGaWx0ZXJOb2RlW10gPSBbXTtcbiAgY29uc3RydWN0b3IocHVibGljIGNvbm5lY3RvcjogXCJBTkRcIiB8IFwiT1JcIiA9IFwiQU5EXCIpIHsgfVxuXG4gIGFkZChub2RlOiBGaWx0ZXJOb2RlKTogdGhpcyB7XG4gICAgdGhpcy5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgZ2V0IGlzRW1wdHkoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuY2hpbGRyZW4ubGVuZ3RoID09PSAwO1xuICB9XG5cbiAgdG9TdHJpbmcoKTogc3RyaW5nIHtcbiAgICBpZiAodGhpcy5pc0VtcHR5KSByZXR1cm4gXCJcIjtcbiAgICBjb25zdCBwYXJ0cyA9IHRoaXMuY2hpbGRyZW4ubWFwKChjKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBjLnRvU3RyaW5nKClcblxuICAgICAgaWYgKCFpc1N0cmluZyhyZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkZpbHRlckdyb3VwIGNvbnRhaW5zIG5vbi1zdHJpbmcgY2hpbGRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzO1xuICAgIH0pLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAoIXBhcnRzLmxlbmd0aCkgcmV0dXJuIFwiXCI7XG4gICAgY29uc3Qgam9pbmVkID0gcGFydHMuam9pbihgICR7dGhpcy5jb25uZWN0b3J9IGApO1xuICAgIC8vIE9ubHkgd3JhcCBpbiBwYXJlbnRoZXNlcyBpZiBpdCBoYXMgbXVsdGlwbGUgcGFydHNcbiAgICByZXR1cm4gcGFydHMubGVuZ3RoID4gMSA/IGAoJHtqb2luZWR9KWAgOiBqb2luZWQ7XG4gIH1cblxuICBjbG9uZSgpOiBGaWx0ZXJHcm91cCB7XG4gICAgY29uc3QgY29weSA9IG5ldyBGaWx0ZXJHcm91cCh0aGlzLmNvbm5lY3Rvcik7XG4gICAgdGhpcy5jaGlsZHJlbi5mb3JFYWNoKChjaGlsZCkgPT4gY29weS5hZGQoY2hpbGQuY2xvbmUoKSkpO1xuICAgIHJldHVybiBjb3B5O1xuICB9XG59XG5cbi8qKlxuICogVGhlIG1haW4gUXVlcnlCdWlsZGVyIERTTFxuICovXG5leHBvcnQgY2xhc3MgUXVlcnlCdWlsZGVyPFQgPSBSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gIHByaXZhdGUgcT86IHN0cmluZztcbiAgcHJpdmF0ZSByb290OiBGaWx0ZXJHcm91cDtcbiAgcHJpdmF0ZSBvcHRpb25zOiBTZWFyY2hQYXJhbXMgPSB7fTtcblxuICBjb25zdHJ1Y3Rvcihjb25uZWN0b3I6IFwiQU5EXCIgfCBcIk9SXCIgPSBcIkFORFwiKSB7XG4gICAgdGhpcy5yb290ID0gbmV3IEZpbHRlckdyb3VwKGNvbm5lY3Rvcik7XG4gIH1cblxuICAvKiogQ3JlYXRlIGEgbmV3IGJ1aWxkZXIgKi9cbiAgc3RhdGljIGNyZWF0ZTxVID0gUmVjb3JkPHN0cmluZywgYW55Pj4oY29ubmVjdG9yPzogXCJBTkRcIiB8IFwiT1JcIik6IFF1ZXJ5QnVpbGRlcjxVPiB7XG4gICAgcmV0dXJuIG5ldyBRdWVyeUJ1aWxkZXI8VT4oY29ubmVjdG9yKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIZWxwZXIgdG8gYnVpbGQgYSBzaW5nbGUgcmF3IGNvbmRpdGlvbiBzYWZlbHkgKHF1b3RlcyAmIGVzY2FwZXMgc3RyaW5ncyBmb3IgeW91KSxcbiAgICogc2VyaWFsaXppbmcgYXJyYXlzIGFuZCBvYmplY3RzIGNvcnJlY3RseS5cbiAgICovXG4gIHN0YXRpYyByYXdDb25kaXRpb24oXG4gICAgZmllbGQ6IHN0cmluZyxcbiAgICBvcGVyYXRvcjogT3BlcmF0b3IsXG4gICAgdmFsdWU6IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBBcnJheTxhbnk+IHwgUmVjb3JkPHN0cmluZywgYW55PixcbiAgKTogRmlsdGVyUmF3IHtcblxuICAgIGxldCB2YWxTdHI6IHN0cmluZztcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB2YWxTdHIgPSBgJyR7dmFsdWUucmVwbGFjZSgvJy9nLCBcIlxcXFwnXCIpfSdgO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHZhbFN0ciA9IFN0cmluZyh2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGFycmF5cyBvciBvYmplY3RzXG4gICAgICB2YWxTdHIgPSBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgRmlsdGVyUmF3KGAke2ZpZWxkfSAke29wZXJhdG9yfSAke3ZhbFN0cn1gKTtcbiAgfVxuXG4gIC8qKiBGdWxsLXRleHQgcXVlcnkgKi9cbiAgdGV4dChzdHI6IHN0cmluZyk6IHRoaXMge1xuICAgIHRoaXMucSA9IHN0cjtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBjbGVhclRleHQoKTogdGhpcyB7XG4gICAgdGhpcy5xID0gdW5kZWZpbmVkO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqIFJhdyBmaWx0ZXIgc3RyaW5nIGluc2VydGlvbiAqL1xuICBmaWx0ZXJSYXcocmF3OiBzdHJpbmcsIGNvbm5lY3RvcjogXCJBTkRcIiB8IFwiT1JcIiA9IFwiQU5EXCIpOiB0aGlzIHtcbiAgICB0aGlzLmFkZEZpbHRlck5vZGUobmV3IEZpbHRlclJhdyhyYXcpLCBjb25uZWN0b3IpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFNob3J0Y3V0OiBpbmplY3QgYSBzaW5nbGUgY29uZGl0aW9uIGFzIGEgcmF3IGZpbHRlciwgc2FmZWx5IHF1b3RpbmcvZXNjYXBpbmcgc3RyaW5ncy5cbiAgICovXG4gIGZpbHRlckNvbmRpdGlvblJhdzxLIGV4dGVuZHMga2V5b2YgVD4oXG4gICAgZmllbGQ6IEssXG4gICAgb3BlcmF0b3I6IE9wZXJhdG9yLFxuICAgIHZhbHVlOiBUWyBLIF0gfCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuLFxuICAgIGNvbm5lY3RvcjogXCJBTkRcIiB8IFwiT1JcIiA9IFwiQU5EXCIsXG4gICk6IHRoaXMge1xuICAgIGNvbnN0IG5vZGUgPSBRdWVyeUJ1aWxkZXIucmF3Q29uZGl0aW9uKFxuICAgICAgU3RyaW5nKGZpZWxkKSxcbiAgICAgIG9wZXJhdG9yLFxuICAgICAgdmFsdWUgYXMgYW55LFxuICAgICk7XG4gICAgdGhpcy5hZGRGaWx0ZXJOb2RlKG5vZGUsIGNvbm5lY3Rvcik7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKiogQU5EIGNvbmRpdGlvbiBvbiBhIGZpZWxkICovXG4gIHdoZXJlPEsgZXh0ZW5kcyBrZXlvZiBUPihmaWVsZDogSyk6IENvbmRpdGlvbkJ1aWxkZXI8VCwgSz4ge1xuICAgIHJldHVybiBuZXcgQ29uZGl0aW9uQnVpbGRlcjxULCBLPih0aGlzIGFzIGFueSwgXCJBTkRcIiwgU3RyaW5nKGZpZWxkKSwgZmFsc2UpO1xuICB9XG4gIGFuZFdoZXJlID0gdGhpcy53aGVyZTtcblxuICAvKiogT1IgY29uZGl0aW9uIG9uIGEgZmllbGQgKi9cbiAgb3JXaGVyZTxLIGV4dGVuZHMga2V5b2YgVD4oZmllbGQ6IEspOiBDb25kaXRpb25CdWlsZGVyPFQsIEs+IHtcbiAgICByZXR1cm4gbmV3IENvbmRpdGlvbkJ1aWxkZXI8VCwgSz4odGhpcyBhcyBhbnksIFwiT1JcIiwgU3RyaW5nKGZpZWxkKSwgZmFsc2UpO1xuICB9XG4gIG9yID0gdGhpcy5vcldoZXJlO1xuXG4gIC8qKiBOT1QgY29uZGl0aW9uIG9uIGEgZmllbGQgKi9cbiAgbm90V2hlcmU8SyBleHRlbmRzIGtleW9mIFQ+KGZpZWxkOiBLKTogQ29uZGl0aW9uQnVpbGRlcjxULCBLPiB7XG4gICAgcmV0dXJuIG5ldyBDb25kaXRpb25CdWlsZGVyPFQsIEs+KHRoaXMgYXMgYW55LCBcIkFORFwiLCBTdHJpbmcoZmllbGQpLCB0cnVlKTtcbiAgfVxuICB3aGVyZU5vdCA9IHRoaXMubm90V2hlcmU7XG5cbiAgLyoqIFxuICAgKiBDcmVhdGVzIGEgbmVzdGVkIGdyb3VwIG9mIGZpbHRlcnMgam9pbmVkIHdpdGggQU5EIGNvbm5lY3Rvci5cbiAgICogQHBhcmFtIGZuIENhbGxiYWNrIGZ1bmN0aW9uIHJlY2VpdmluZyBhIG5ldyBxdWVyeSBidWlsZGVyIHRvIGRlZmluZSB0aGUgZ3JvdXBcbiAgICogQHJldHVybnMgVGhpcyBidWlsZGVyIGluc3RhbmNlIGZvciBjaGFpbmluZ1xuICAgKi9cbiAgZ3JvdXAoZm46IChxYjogUXVlcnlCdWlsZGVyPFQ+KSA9PiB2b2lkKTogdGhpcyB7XG4gICAgY29uc3Qgc3ViID0gUXVlcnlCdWlsZGVyLmNyZWF0ZTxUPihcIkFORFwiKTtcbiAgICBmbihzdWIpO1xuXG4gICAgLy8gU3BlY2lhbCBoYW5kbGluZyBmb3IgQU5EIGdyb3VwcyBzaW1pbGFyIHRvIG9yR3JvdXBcbiAgICBpZiAodGhpcy5yb290LmlzRW1wdHkpIHtcbiAgICAgIC8vIElmIG91ciByb290IGlzIGVtcHR5LCBqdXN0IHVzZSB0aGUgc3VicXVlcnkncyByb290XG4gICAgICB0aGlzLnJvb3QgPSBzdWIucm9vdDtcbiAgICB9IGVsc2UgaWYgKHRoaXMucm9vdC5jb25uZWN0b3IgPT09IFwiQU5EXCIpIHtcbiAgICAgIC8vIElmIGN1cnJlbnQgcm9vdCBpcyBhbHJlYWR5IEFORCwganVzdCBhZGQgdGhlIHN1YnF1ZXJ5IHJvb3QgdG8gaXRcbiAgICAgIHRoaXMucm9vdC5hZGQoc3ViLnJvb3QpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBjdXJyZW50IHJvb3QgaXMgT1IgYnV0IHdlIG5lZWQgdG8gYWRkIHdpdGggQU5ELCBjcmVhdGUgYSBuZXcgXG4gICAgICAvLyByb290IGdyb3VwIHdpdGggQU5EIGNvbm5lY3RvclxuICAgICAgY29uc3QgbmV3Um9vdCA9IG5ldyBGaWx0ZXJHcm91cChcIkFORFwiKTtcbiAgICAgIG5ld1Jvb3QuYWRkKHRoaXMucm9vdCk7XG4gICAgICBuZXdSb290LmFkZChzdWIucm9vdCk7XG4gICAgICB0aGlzLnJvb3QgPSBuZXdSb290O1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKiBBbGlhcyBmb3IgZ3JvdXAoKSAtIGNyZWF0ZXMgYSBuZXN0ZWQgZ3JvdXAgb2YgZmlsdGVycyBqb2luZWQgd2l0aCBBTkQgKi9cbiAgYW5kR3JvdXAgPSB0aGlzLmdyb3VwO1xuXG4gIC8qKiBcbiAgICogQ3JlYXRlcyBhIG5lc3RlZCBncm91cCBvZiBmaWx0ZXJzIGpvaW5lZCB3aXRoIE9SIGNvbm5lY3Rvci5cbiAgICogVGhpcyBoYW5kbGVzIHNwZWNpYWwgbG9naWMgdG8gZW5zdXJlIE9SIHByZWNlZGVuY2UgaXMgbWFpbnRhaW5lZCBjb3JyZWN0bHkuXG4gICAqIFxuICAgKiBAcGFyYW0gZm4gQ2FsbGJhY2sgZnVuY3Rpb24gcmVjZWl2aW5nIGEgbmV3IHF1ZXJ5IGJ1aWxkZXIgdG8gZGVmaW5lIHRoZSBncm91cFxuICAgKiBAcmV0dXJucyBUaGlzIGJ1aWxkZXIgaW5zdGFuY2UgZm9yIGNoYWluaW5nXG4gICAqL1xuICBvckdyb3VwKGZuOiAocWI6IFF1ZXJ5QnVpbGRlcjxUPikgPT4gdm9pZCk6IHRoaXMge1xuICAgIGNvbnN0IHN1YiA9IFF1ZXJ5QnVpbGRlci5jcmVhdGU8VD4oXCJPUlwiKTtcbiAgICBmbihzdWIpO1xuXG4gICAgLy8gSGFuZGxlIHRoZSBsb2dpYyBzcGVjaWFsbHkgZm9yIE9SIGdyb3VwcyB0byBlbnN1cmUgcHJvcGVyIGNvbm5lY3RvclxuICAgIGlmICh0aGlzLnJvb3QuaXNFbXB0eSkge1xuICAgICAgLy8gSWYgb3VyIHJvb3QgaXMgZW1wdHksIGp1c3QgdXNlIHRoZSBzdWJxdWVyeSdzIHJvb3RcbiAgICAgIHRoaXMucm9vdCA9IHN1Yi5yb290O1xuICAgIH0gZWxzZSBpZiAodGhpcy5yb290LmNvbm5lY3RvciA9PT0gXCJPUlwiKSB7XG4gICAgICAvLyBJZiBjdXJyZW50IHJvb3QgaXMgYWxyZWFkeSBPUiwganVzdCBhZGQgdGhlIHN1YnF1ZXJ5IHJvb3QgdG8gaXRcbiAgICAgIHRoaXMucm9vdC5hZGQoc3ViLnJvb3QpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBjdXJyZW50IHJvb3QgaXMgQU5EIGJ1dCB3ZSBuZWVkIHRvIGFkZCB3aXRoIE9SLCBjcmVhdGUgYSBuZXcgXG4gICAgICAvLyByb290IGdyb3VwIHdpdGggT1IgY29ubmVjdG9yXG4gICAgICBjb25zdCBuZXdSb290ID0gbmV3IEZpbHRlckdyb3VwKFwiT1JcIik7XG4gICAgICBuZXdSb290LmFkZCh0aGlzLnJvb3QpO1xuICAgICAgbmV3Um9vdC5hZGQoc3ViLnJvb3QpO1xuICAgICAgdGhpcy5yb290ID0gbmV3Um9vdDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKiogXG4gICAqIENyZWF0ZXMgYSBuZWdhdGVkIGdyb3VwIG9mIGZpbHRlcnMuXG4gICAqIFRoZSBlbnRpcmUgZ3JvdXAgd2lsbCBiZSBwcmVmaXhlZCB3aXRoIE5PVC5cbiAgICogXG4gICAqIEBwYXJhbSBmbiBDYWxsYmFjayBmdW5jdGlvbiByZWNlaXZpbmcgYSBuZXcgcXVlcnkgYnVpbGRlciB0byBkZWZpbmUgdGhlIGdyb3VwXG4gICAqIEByZXR1cm5zIFRoaXMgYnVpbGRlciBpbnN0YW5jZSBmb3IgY2hhaW5pbmdcbiAgICovXG4gIG5vdEdyb3VwKGZuOiAocWI6IFF1ZXJ5QnVpbGRlcjxUPikgPT4gdm9pZCk6IHRoaXMge1xuICAgIC8vIENyZWF0ZSBhIHN1Yi1idWlsZGVyIHdpdGggZGVmYXVsdCBBTkQgY29ubmVjdG9yXG4gICAgY29uc3Qgc3ViID0gUXVlcnlCdWlsZGVyLmNyZWF0ZTxUPihcIkFORFwiKTtcbiAgICBmbihzdWIpO1xuXG4gICAgLy8gV3JhcCB0aGUgc3ViLXF1ZXJ5J3MgZmlsdGVyIHRyZWUgd2l0aCBhIEZpbHRlck5vdCBub2RlXG4gICAgY29uc3Qgbm90Tm9kZSA9IG5ldyBGaWx0ZXJOb3Qoc3ViLnJvb3QpO1xuXG4gICAgLy8gSGFuZGxlIHRoZSBpbnRlZ3JhdGlvbiBpbnRvIHRoZSBtYWluIGZpbHRlciB0cmVlXG4gICAgaWYgKHRoaXMucm9vdC5pc0VtcHR5KSB7XG4gICAgICAvLyBJZiByb290IGlzIGVtcHR5LCBjcmVhdGUgYSBuZXcgZ3JvdXAgd2l0aCB0aGUgTk9UIG5vZGVcbiAgICAgIHRoaXMucm9vdCA9IG5ldyBGaWx0ZXJHcm91cChcIkFORFwiKTtcbiAgICAgIHRoaXMucm9vdC5hZGQobm90Tm9kZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLnJvb3QuY29ubmVjdG9yID09PSBcIkFORFwiKSB7XG4gICAgICAvLyBJZiByb290IGlzIGFscmVhZHkgQU5ELCBqdXN0IGFkZCB0aGUgTk9UIG5vZGVcbiAgICAgIHRoaXMucm9vdC5hZGQobm90Tm9kZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIHJvb3QgaXMgT1IsIGNyZWF0ZSBhIG5ldyBBTkQgZ3JvdXAgd2l0aCB0aGUgTk9UIG5vZGVcbiAgICAgIGNvbnN0IG5ld1Jvb3QgPSBuZXcgRmlsdGVyR3JvdXAoXCJBTkRcIik7XG4gICAgICBuZXdSb290LmFkZCh0aGlzLnJvb3QpO1xuICAgICAgbmV3Um9vdC5hZGQobm90Tm9kZSk7XG4gICAgICB0aGlzLnJvb3QgPSBuZXdSb290O1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqIFNvcnRpbmcgKi9cbiAgc29ydChmaWVsZDoga2V5b2YgVCB8IHN0cmluZywgZGlyOiBcImFzY1wiIHwgXCJkZXNjXCIpOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMuc29ydCA9IFtcbiAgICAgIC4uLih0aGlzLm9wdGlvbnMuc29ydCB8fCBbXSksXG4gICAgICBgJHtmaWVsZCBhcyBzdHJpbmd9OiR7ZGlyfWAsXG4gICAgXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBjbGVhclNvcnQoKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5zb3J0O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqIFBhZ2luYXRpb24gc2hvcnRjdXRzICovXG4gIGxpbWl0KG46IG51bWJlcik6IHRoaXMge1xuICAgIHRoaXMub3B0aW9ucy5saW1pdCA9IG47XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgb2Zmc2V0KG46IG51bWJlcik6IHRoaXMge1xuICAgIHRoaXMub3B0aW9ucy5vZmZzZXQgPSBuO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIENvbmZpZ3VyZSBwYWdpbmF0aW9uIHdpdGggaGl0c1BlclBhZ2UgcGFyYW1ldGVyXG4gICAqIFRoaXMgcHJvdmlkZXMgZXhoYXVzdGl2ZSBwYWdpbmF0aW9uIHdpdGggdG90YWwgaGl0cyBhbmQgdG90YWwgcGFnZXNcbiAgICogQHBhcmFtIGhpdHMgTnVtYmVyIG9mIGhpdHMgcGVyIHBhZ2VcbiAgICovXG4gIGhpdHNQZXJQYWdlKGhpdHM6IG51bWJlcik6IHRoaXMge1xuICAgIHRoaXMub3B0aW9ucy5oaXRzUGVyUGFnZSA9IGhpdHM7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHRoZSBwYWdlIG51bWJlciBmb3IgcGFnaW5hdGlvblxuICAgKiBAcGFyYW0gcGFnZU51bSBQYWdlIG51bWJlciAoMS1iYXNlZClcbiAgICogQHBhcmFtIHNpemUgT3B0aW9uYWwgcGFnZSBzaXplLCBzZXRzIGxpbWl0ICYgb2Zmc2V0IGlmIGhpdHNQZXJQYWdlIG5vdCB1c2VkXG4gICAqL1xuICBwYWdlKHBhZ2VOdW06IG51bWJlciwgc2l6ZT86IG51bWJlcik6IHRoaXMge1xuICAgIGlmICh0aGlzLm9wdGlvbnMuaGl0c1BlclBhZ2UgIT09IHVuZGVmaW5lZCB8fCBzaXplID09PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIFVzZSBuZXcgcGFnaW5hdGlvbiBzdHlsZSB3aXRoIGhpdHNQZXJQYWdlL3BhZ2VcbiAgICAgIHRoaXMub3B0aW9ucy5wYWdlID0gcGFnZU51bTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVXNlIGxlZ2FjeSBsaW1pdC9vZmZzZXQgc3R5bGUgcGFnaW5hdGlvblxuICAgICAgdGhpcy5vcHRpb25zLmxpbWl0ID0gc2l6ZTtcbiAgICAgIHRoaXMub3B0aW9ucy5vZmZzZXQgPSAocGFnZU51bSAtIDEpICogc2l6ZTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBjbGVhclBhZ2luYXRpb24oKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5saW1pdDtcbiAgICBkZWxldGUgdGhpcy5vcHRpb25zLm9mZnNldDtcbiAgICBkZWxldGUgdGhpcy5vcHRpb25zLmhpdHNQZXJQYWdlO1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMucGFnZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKiBEaXN0aW5jdCBhdHRyaWJ1dGUgKi9cbiAgZGlzdGluY3QoZmllbGQ6IGtleW9mIFQgfCBzdHJpbmcpOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMuZGlzdGluY3QgPSBTdHJpbmcoZmllbGQpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGNsZWFyRGlzdGluY3QoKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5kaXN0aW5jdDtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKiBGaWVsZCBzZWxlY3Rpb24gKi9cbiAgc2VsZWN0KGZpZWxkczogQXJyYXk8a2V5b2YgVCB8IHN0cmluZz4pOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMuYXR0cmlidXRlc1RvUmV0cmlldmUgPSBmaWVsZHMgYXMgc3RyaW5nW107XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgY2xlYXJTZWxlY3QoKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5hdHRyaWJ1dGVzVG9SZXRyaWV2ZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGVjaWZ5IGZhY2V0cyB0byByZXR1cm4gaW4gdGhlIHJlc3BvbnNlXG4gICAqIEBwYXJhbSBmaWVsZHMgQXJyYXkgb2YgZmFjZXQgZmllbGRzIG9yIFsnKiddIGZvciBhbGwgZmFjZXRzXG4gICAqL1xuICBmYWNldHMoZmllbGRzOiBBcnJheTxrZXlvZiBUIHwgc3RyaW5nPiB8IFsgXCIqXCIgXSk6IHRoaXMge1xuICAgIHRoaXMub3B0aW9ucy5mYWNldHMgPSBmaWVsZHMgYXMgc3RyaW5nW107XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBjbGVhckZhY2V0cygpOiB0aGlzIHtcbiAgICBkZWxldGUgdGhpcy5vcHRpb25zLmZhY2V0cztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKiBNYXRjaGluZyBzdHJhdGVneSAqL1xuICBtYXRjaGluZ1N0cmF0ZWd5KG1zOiBNYXRjaGluZ1N0cmF0ZWd5KTogdGhpcyB7XG4gICAgdGhpcy5vcHRpb25zLm1hdGNoaW5nU3RyYXRlZ3kgPSBtcztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBjbGVhck1hdGNoaW5nU3RyYXRlZ3koKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5tYXRjaGluZ1N0cmF0ZWd5O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFNwZWNpZnkgdGhlIGxvY2FsZXMvbGFuZ3VhZ2VzIHRvIHNlYXJjaCBpblxuICAgKiBAcGFyYW0gbG9jYWxlTGlzdCBBcnJheSBvZiBsb2NhbGUgY29kZXMgKGUuZy4gW1wiZW4tVVNcIiwgXCJmci1GUlwiXSlcbiAgICovXG4gIGxvY2FsZXMobG9jYWxlTGlzdDogc3RyaW5nW10pOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMubG9jYWxlcyA9IGxvY2FsZUxpc3Q7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBjbGVhckxvY2FsZXMoKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5sb2NhbGVzO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqIFxuICAgKiBDb25maWd1cmUgaHlicmlkIHNlYXJjaCB0aGF0IGNvbWJpbmVzIGtleXdvcmQgYW5kIHNlbWFudGljIHNlYXJjaFxuICAgKiBAcGFyYW0gZW1iZWRkZXIgVGhlIG5hbWUgb2YgYW4gZW1iZWRkZXIgY29uZmlndXJlZCBpbiBNZWlsaXNlYXJjaFxuICAgKiBAcGFyYW0gc2VtYW50aWNSYXRpbyBBIG51bWJlciBiZXR3ZWVuIDAuMCBhbmQgMS4wIGluZGljYXRpbmcgcHJvcG9ydGlvbiBiZXR3ZWVuIGtleXdvcmQgYW5kIHNlbWFudGljIHJlc3VsdHNcbiAgICovXG4gIGh5YnJpZChlbWJlZGRlcjogc3RyaW5nLCBzZW1hbnRpY1JhdGlvOiBudW1iZXIgPSAwLjUpOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMuaHlicmlkID0geyBlbWJlZGRlciwgc2VtYW50aWNSYXRpbyB9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGNsZWFySHlicmlkKCk6IHRoaXMge1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMuaHlicmlkO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqIFxuICAgKiBTcGVjaWZ5IHdoaWNoIGF0dHJpYnV0ZXMgdG8gc2VhcmNoIG9uIGZvciB0aGlzIHF1ZXJ5XG4gICAqIEBwYXJhbSBmaWVsZHMgQXJyYXkgb2YgZmllbGRzIHRvIHNlYXJjaCBvbiwgb3IgW1wiKlwiXSBmb3IgYWxsIGZpZWxkc1xuICAgKi9cbiAgYXR0cmlidXRlc1RvU2VhcmNoT24oZmllbGRzOiBBcnJheTxrZXlvZiBUIHwgc3RyaW5nPik6IHRoaXMge1xuICAgIHRoaXMub3B0aW9ucy5hdHRyaWJ1dGVzVG9TZWFyY2hPbiA9IGZpZWxkcyBhcyBzdHJpbmdbXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBjbGVhckF0dHJpYnV0ZXNUb1NlYXJjaE9uKCk6IHRoaXMge1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMuYXR0cmlidXRlc1RvU2VhcmNoT247XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGEgdmVjdG9yIGZvciB2ZWN0b3Igc2VhcmNoXG4gICAqIEBwYXJhbSB2ZWN0b3IgQXJyYXkgb2YgbnVtYmVycyByZXByZXNlbnRpbmcgdGhlIGVtYmVkZGluZyB2ZWN0b3JcbiAgICovXG4gIHZlY3RvclNlYXJjaCh2ZWN0b3I6IG51bWJlcltdKTogdGhpcyB7XG4gICAgdGhpcy5vcHRpb25zLnZlY3RvciA9IHZlY3RvcjtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICByZXRyaWV2ZVZlY3RvcnMoZmxhZzogYm9vbGVhbiA9IHRydWUpOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMucmV0cmlldmVWZWN0b3JzID0gZmxhZztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBjbGVhclZlY3RvclNlYXJjaCgpOiB0aGlzIHtcbiAgICBkZWxldGUgdGhpcy5vcHRpb25zLnZlY3RvcjtcbiAgICBkZWxldGUgdGhpcy5vcHRpb25zLnJldHJpZXZlVmVjdG9ycztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTaG93IHJhbmtpbmcgc2NvcmUgaW4gc2VhcmNoIHJlc3VsdHNcbiAgICovXG4gIHNob3dSYW5raW5nU2NvcmUoZmxhZzogYm9vbGVhbiA9IHRydWUpOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMuc2hvd1JhbmtpbmdTY29yZSA9IGZsYWc7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2hvdyBkZXRhaWxlZCByYW5raW5nIHNjb3JlIGluZm9ybWF0aW9uIGluIHNlYXJjaCByZXN1bHRzXG4gICAqL1xuICBzaG93UmFua2luZ1Njb3JlRGV0YWlscyhmbGFnOiBib29sZWFuID0gdHJ1ZSk6IHRoaXMge1xuICAgIHRoaXMub3B0aW9ucy5zaG93UmFua2luZ1Njb3JlRGV0YWlscyA9IGZsYWc7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGEgbWluaW11bSB0aHJlc2hvbGQgZm9yIHJhbmtpbmcgc2NvcmVzXG4gICAqIEBwYXJhbSB0aHJlc2hvbGQgQSBudW1iZXIgYmV0d2VlbiAwLjAgYW5kIDEuMFxuICAgKi9cbiAgcmFua2luZ1Njb3JlVGhyZXNob2xkKHRocmVzaG9sZDogbnVtYmVyKTogdGhpcyB7XG4gICAgdGhpcy5vcHRpb25zLnJhbmtpbmdTY29yZVRocmVzaG9sZCA9IHRocmVzaG9sZDtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGNsZWFyUmFua2luZ09wdGlvbnMoKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5zaG93UmFua2luZ1Njb3JlO1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMuc2hvd1JhbmtpbmdTY29yZURldGFpbHM7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5yYW5raW5nU2NvcmVUaHJlc2hvbGQ7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKiogSGlnaGxpZ2h0IG9wdGlvbnMgKi9cbiAgaGlnaGxpZ2h0KFxuICAgIGZpZWxkczogQXJyYXk8a2V5b2YgVCB8IHN0cmluZz4sXG4gICAgcHJlID0gXCI8ZW0+XCIsXG4gICAgcG9zdCA9IFwiPC9lbT5cIixcbiAgKTogdGhpcyB7XG4gICAgdGhpcy5vcHRpb25zLmF0dHJpYnV0ZXNUb0hpZ2hsaWdodCA9IGZpZWxkcyBhcyBzdHJpbmdbXTtcbiAgICB0aGlzLm9wdGlvbnMuaGlnaGxpZ2h0UHJlVGFnID0gcHJlO1xuICAgIHRoaXMub3B0aW9ucy5oaWdobGlnaHRQb3N0VGFnID0gcG9zdDtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBzaG93TWF0Y2hlc1Bvc2l0aW9uKGZsYWcgPSB0cnVlKTogdGhpcyB7XG4gICAgdGhpcy5vcHRpb25zLnNob3dNYXRjaGVzUG9zaXRpb24gPSBmbGFnO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGNsZWFySGlnaGxpZ2h0KCk6IHRoaXMge1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMuYXR0cmlidXRlc1RvSGlnaGxpZ2h0O1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMuaGlnaGxpZ2h0UHJlVGFnO1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMuaGlnaGxpZ2h0UG9zdFRhZztcbiAgICBkZWxldGUgdGhpcy5vcHRpb25zLnNob3dNYXRjaGVzUG9zaXRpb247XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKiogQ3JvcCBvcHRpb25zICovXG4gIGNyb3AoZmllbGRzOiBBcnJheTxrZXlvZiBUIHwgc3RyaW5nPiwgbGVuZ3RoID0gNTAsIG1hcmtlciA9IFwiLi4uXCIpOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMuYXR0cmlidXRlc1RvQ3JvcCA9IGZpZWxkcyBhcyBzdHJpbmdbXTtcbiAgICB0aGlzLm9wdGlvbnMuY3JvcExlbmd0aCA9IGxlbmd0aDtcbiAgICB0aGlzLm9wdGlvbnMuY3JvcE1hcmtlciA9IG1hcmtlcjtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBjbGVhckNyb3AoKTogdGhpcyB7XG4gICAgZGVsZXRlIHRoaXMub3B0aW9ucy5hdHRyaWJ1dGVzVG9Dcm9wO1xuICAgIGRlbGV0ZSB0aGlzLm9wdGlvbnMuY3JvcExlbmd0aDtcbiAgICBkZWxldGUgdGhpcy5vcHRpb25zLmNyb3BNYXJrZXI7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKiogQ2xlYXIgZmlsdGVycyBvciBhbGwgb3B0aW9ucyAqL1xuICBjbGVhckZpbHRlcnMoKTogdGhpcyB7XG4gICAgdGhpcy5yb290ID0gbmV3IEZpbHRlckdyb3VwKFwiQU5EXCIpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGNsZWFyQWxsT3B0aW9ucygpOiB0aGlzIHtcbiAgICB0aGlzLm9wdGlvbnMgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKiBDbG9uZSBidWlsZGVyIHdpdGggZGVlcCBjb3B5IG9mIHRoZSBmaWx0ZXIgQVNUIGFuZCBvcHRpb25zICovXG4gIGNsb25lKCk6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgY29uc3QgY29weSA9IFF1ZXJ5QnVpbGRlci5jcmVhdGU8VD4oKTtcbiAgICBjb3B5LnEgPSB0aGlzLnE7XG4gICAgY29weS5yb290ID0gdGhpcy5yb290LmNsb25lKCk7XG4gICAgLy8gZGVlcCBjb3B5IG9wdGlvbnMgKHByaW1pdGl2ZXMgJiBhcnJheXMpXG4gICAgY29weS5vcHRpb25zID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh0aGlzLm9wdGlvbnMpKTtcbiAgICByZXR1cm4gY29weTtcbiAgfVxuXG4gIC8qKiBCdWlsZCBNZWlsaXNlYXJjaCBxdWVyeSAqL1xuICBidWlsZCgpOiBNZWlsaVNlYXJjaFF1ZXJ5IHtcbiAgICBjb25zdCBvcHRzID0geyAuLi50aGlzLm9wdGlvbnMgfTtcbiAgICBjb25zdCBmID0gdGhpcy5yb290LnRvU3RyaW5nKCk7XG4gICAgaWYgKGYpIG9wdHMuZmlsdGVyID0gZjtcbiAgICByZXR1cm4geyBxOiB0aGlzLnEsIG9wdGlvbnM6IG9wdHMgfTtcbiAgfVxuXG4gIHRvU3RyaW5nKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHRoaXMuYnVpbGQoKSwgbnVsbCwgMik7XG4gIH1cblxuICAvKiogSW50ZXJuYWw6IGFkZCBmaWx0ZXIgbm9kZSByZXNwZWN0aW5nIGNvbm5lY3RvciBwcmVjZWRlbmNlICovXG4gIHByaXZhdGUgYWRkRmlsdGVyTm9kZShub2RlOiBGaWx0ZXJOb2RlLCBjb25uZWN0b3I6IFwiQU5EXCIgfCBcIk9SXCIpIHtcbiAgICBpZiAodGhpcy5yb290LmlzRW1wdHkpIHtcbiAgICAgIC8vIGZpcnN0IG5vZGUgZXZlcjogdXNlIGl0cyBjb25uZWN0b3JcbiAgICAgIHRoaXMucm9vdC5jb25uZWN0b3IgPSBjb25uZWN0b3I7XG4gICAgICB0aGlzLnJvb3QuYWRkKG5vZGUpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5yb290LmNvbm5lY3RvciA9PT0gY29ubmVjdG9yKSB7XG4gICAgICB0aGlzLnJvb3QuYWRkKG5vZGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiB3ZSdyZSBhZGRpbmcgYW4gT1Igbm9kZSB0byBhbiBBTkQgZ3JvdXAgb3IgdmljZSB2ZXJzYSxcbiAgICAgIC8vIGNyZWF0ZSBhIG5ldyBncm91cCB3aXRoIHRoZSBhcHByb3ByaWF0ZSBjb25uZWN0b3JcbiAgICAgIGNvbnN0IGdycCA9IG5ldyBGaWx0ZXJHcm91cChjb25uZWN0b3IpO1xuICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBGaWx0ZXJHcm91cCkge1xuICAgICAgICAvLyBQcmVzZXJ2ZSB0aGUgY29ubmVjdG9yIG9mIHRoZSBuZXN0ZWQgZ3JvdXBcbiAgICAgICAgZ3JwLmNvbm5lY3RvciA9IG5vZGUuY29ubmVjdG9yO1xuICAgICAgfVxuICAgICAgZ3JwLmFkZCh0aGlzLnJvb3QpLmFkZChub2RlKTtcbiAgICAgIHRoaXMucm9vdCA9IGdycDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmlsdGVyIHJlc3VsdHMgd2l0aGluIGEgcmFkaXVzIG9mIGEgZ2VvZ3JhcGhpYyBwb2ludC5cbiAgICogUmVxdWlyZXMgYF9nZW9gIHRvIGJlIGluIGBmaWx0ZXJhYmxlQXR0cmlidXRlc2AuXG4gICAqIEBwYXJhbSBsYXQgTGF0aXR1ZGUgb2YgdGhlIGNlbnRlciBwb2ludC5cbiAgICogQHBhcmFtIGxuZyBMb25naXR1ZGUgb2YgdGhlIGNlbnRlciBwb2ludC5cbiAgICogQHBhcmFtIGRpc3RhbmNlSW5NZXRlcnMgUmFkaXVzIGluIG1ldGVycy5cbiAgICogQHBhcmFtIGNvbm5lY3RvciBIb3cgdG8gY29ubmVjdCB0aGlzIGZpbHRlciAoXCJBTkRcIiBvciBcIk9SXCIpLlxuICAgKi9cbiAgZ2VvUmFkaXVzKFxuICAgIGxhdDogbnVtYmVyLFxuICAgIGxuZzogbnVtYmVyLFxuICAgIGRpc3RhbmNlSW5NZXRlcnM6IG51bWJlcixcbiAgICBjb25uZWN0b3I6IFwiQU5EXCIgfCBcIk9SXCIgPSBcIkFORFwiLFxuICApOiB0aGlzIHtcbiAgICBjb25zdCByYXdGaWx0ZXIgPSBgX2dlb1JhZGl1cygke2xhdH0sICR7bG5nfSwgJHtkaXN0YW5jZUluTWV0ZXJzfSlgO1xuICAgIHRoaXMuYWRkRmlsdGVyTm9kZShuZXcgRmlsdGVyUmF3KHJhd0ZpbHRlciksIGNvbm5lY3Rvcik7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRmlsdGVyIHJlc3VsdHMgd2l0aGluIGEgZ2VvZ3JhcGhpYyBib3VuZGluZyBib3guXG4gICAqIFJlcXVpcmVzIGBfZ2VvYCB0byBiZSBpbiBgZmlsdGVyYWJsZUF0dHJpYnV0ZXNgLlxuICAgKiBAcGFyYW0gdG9wTGVmdCBPYmplY3Qgd2l0aCBsYXQgYW5kIGxuZyBmb3IgdGhlIHRvcC1sZWZ0IGNvcm5lci5cbiAgICogQHBhcmFtIGJvdHRvbVJpZ2h0IE9iamVjdCB3aXRoIGxhdCBhbmQgbG5nIGZvciB0aGUgYm90dG9tLXJpZ2h0IGNvcm5lci5cbiAgICogQHBhcmFtIGNvbm5lY3RvciBIb3cgdG8gY29ubmVjdCB0aGlzIGZpbHRlciAoXCJBTkRcIiBvciBcIk9SXCIpLlxuICAgKi9cbiAgZ2VvQm91bmRpbmdCb3goXG4gICAgdG9wTGVmdDogeyBsYXQ6IG51bWJlcjsgbG5nOiBudW1iZXIgfSxcbiAgICBib3R0b21SaWdodDogeyBsYXQ6IG51bWJlcjsgbG5nOiBudW1iZXIgfSxcbiAgICBjb25uZWN0b3I6IFwiQU5EXCIgfCBcIk9SXCIgPSBcIkFORFwiLFxuICApOiB0aGlzIHtcbiAgICBjb25zdCByYXdGaWx0ZXIgPSBgX2dlb0JvdW5kaW5nQm94KFske3RvcExlZnQubGF0fSwgJHt0b3BMZWZ0LmxuZ31dLCBbJHtib3R0b21SaWdodC5sYXR9LCAke2JvdHRvbVJpZ2h0LmxuZ31dKWA7XG4gICAgdGhpcy5hZGRGaWx0ZXJOb2RlKG5ldyBGaWx0ZXJSYXcocmF3RmlsdGVyKSwgY29ubmVjdG9yKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTb3J0IHJlc3VsdHMgYnkgZGlzdGFuY2UgZnJvbSBhIGdlb2dyYXBoaWMgcG9pbnQuXG4gICAqIFJlcXVpcmVzIGBfZ2VvYCB0byBiZSBpbiBgc29ydGFibGVBdHRyaWJ1dGVzYC5cbiAgICogQHBhcmFtIGxhdCBMYXRpdHVkZSBvZiB0aGUgcmVmZXJlbmNlIHBvaW50LlxuICAgKiBAcGFyYW0gbG5nIExvbmdpdHVkZSBvZiB0aGUgcmVmZXJlbmNlIHBvaW50LlxuICAgKiBAcGFyYW0gZGlyIFNvcnQgZGlyZWN0aW9uIChcImFzY1wiIG9yIFwiZGVzY1wiKS5cbiAgICovXG4gIHNvcnRCeUdlb1BvaW50KFxuICAgIGxhdDogbnVtYmVyLFxuICAgIGxuZzogbnVtYmVyLFxuICAgIGRpcjogXCJhc2NcIiB8IFwiZGVzY1wiID0gXCJhc2NcIixcbiAgKTogdGhpcyB7XG4gICAgY29uc3Qgc29ydFJ1bGUgPSBgX2dlb1BvaW50KCR7bGF0fSwgJHtsbmd9KToke2Rpcn1gO1xuICAgIHRoaXMub3B0aW9ucy5zb3J0ID0gWyAuLi4odGhpcy5vcHRpb25zLnNvcnQgfHwgW10pLCBzb3J0UnVsZSBdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG59XG5cbi8qKiBCdWlsZGVyIGZvciBhIHNpbmdsZSBmaWVsZCBjb25kaXRpb24gKi9cbmV4cG9ydCBjbGFzcyBDb25kaXRpb25CdWlsZGVyPFQsIEsgZXh0ZW5kcyBrZXlvZiBUPiB7XG4gIHByaXZhdGUgbmVnYXRlZDogYm9vbGVhbjtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSBwYXJlbnQ6IFF1ZXJ5QnVpbGRlcjxUPixcbiAgICBwcml2YXRlIGNvbm5lY3RvcjogXCJBTkRcIiB8IFwiT1JcIixcbiAgICBwcml2YXRlIGZpZWxkOiBzdHJpbmcsXG4gICAgbmVnYXRlZCA9IGZhbHNlLFxuICApIHtcbiAgICB0aGlzLm5lZ2F0ZWQgPSBuZWdhdGVkO1xuICB9XG5cbiAgLyoqIEludmVydCBuZXh0IGNvbmRpdGlvbiAqL1xuICBub3QoKTogdGhpcyB7XG4gICAgdGhpcy5uZWdhdGVkID0gIXRoaXMubmVnYXRlZDtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHkob3A6IE9wZXJhdG9yLCB2YWw6IFRbIEsgXSB8IFRbIEsgXVtdKTogUXVlcnlCdWlsZGVyPFQ+IHtcbiAgICBsZXQgbm9kZTogRmlsdGVyTm9kZSA9IG5ldyBGaWx0ZXJDb25kaXRpb24odGhpcy5maWVsZCwgb3AsIHZhbCBhcyBhbnkpO1xuICAgIGlmICh0aGlzLm5lZ2F0ZWQpIG5vZGUgPSBuZXcgRmlsdGVyTm90KG5vZGUpO1xuICAgICh0aGlzLnBhcmVudCBhcyBhbnkpLmFkZEZpbHRlck5vZGUobm9kZSwgdGhpcy5jb25uZWN0b3IpO1xuICAgIHJldHVybiB0aGlzLnBhcmVudDtcbiAgfVxuXG4gIC8vIEJhc2ljIGNvbXBhcmlzb25zXG4gIGVxKHY6IFRbIEsgXSk6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgcmV0dXJuIHRoaXMuYXBwbHkoXCI9XCIsIHYpO1xuICB9XG4gIG5lcSh2OiBUWyBLIF0pOiBRdWVyeUJ1aWxkZXI8VD4ge1xuICAgIHJldHVybiB0aGlzLmFwcGx5KFwiIT1cIiwgdik7XG4gIH1cbiAgZ3QodjogbnVtYmVyKTogUXVlcnlCdWlsZGVyPFQ+IHtcbiAgICByZXR1cm4gdGhpcy5hcHBseShcIj5cIiwgdiBhcyBhbnkpO1xuICB9XG4gIGd0ZSh2OiBudW1iZXIpOiBRdWVyeUJ1aWxkZXI8VD4ge1xuICAgIHJldHVybiB0aGlzLmFwcGx5KFwiPj1cIiwgdiBhcyBhbnkpO1xuICB9XG4gIGx0KHY6IG51bWJlcik6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgcmV0dXJuIHRoaXMuYXBwbHkoXCI8XCIsIHYgYXMgYW55KTtcbiAgfVxuICBsdGUodjogbnVtYmVyKTogUXVlcnlCdWlsZGVyPFQ+IHtcbiAgICByZXR1cm4gdGhpcy5hcHBseShcIjw9XCIsIHYgYXMgYW55KTtcbiAgfVxuXG4gIC8vIEFycmF5IGFuZCByYW5nZVxuICBpbih2YWxzOiBUWyBLIF1bXSk6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgcmV0dXJuIHRoaXMuYXBwbHkoXCJJTlwiLCB2YWxzKTtcbiAgfVxuICBub3RJbih2YWxzOiBUWyBLIF1bXSk6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgdGhpcy5ub3QoKTtcbiAgICByZXR1cm4gdGhpcy5hcHBseShcIklOXCIsIHZhbHMpO1xuICB9XG5cbiAgLy8gUmFuZ2Ugd2l0aCBUT1xuICByYW5nZVRvKG1pbjogbnVtYmVyLCBtYXg6IG51bWJlcik6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgLy8gdXNlIEZpbHRlck5vZGUgaGVyZSwgc2luY2UgeW91IG1heSB3cmFwIGl0IGluIEZpbHRlck5vdFxuICAgIGxldCBub2RlOiBGaWx0ZXJOb2RlID0gbmV3IEZpbHRlclJhdyhcbiAgICAgIGAke3RoaXMuZmllbGR9ICR7bWlufSBUTyAke21heH1gXG4gICAgKTtcblxuICAgIGlmICh0aGlzLm5lZ2F0ZWQpIHtcbiAgICAgIG5vZGUgPSBuZXcgRmlsdGVyTm90KG5vZGUpO1xuICAgIH1cblxuICAgIC8vIGFkZCB0aGUgbm9kZSAod2hldGhlciByYXcgb3IgbmVnYXRlZCkgaW50byB0aGUgQVNUXG4gICAgKHRoaXMucGFyZW50IGFzIGFueSkuYWRkRmlsdGVyTm9kZShub2RlLCB0aGlzLmNvbm5lY3Rvcik7XG4gICAgcmV0dXJuIHRoaXMucGFyZW50O1xuICB9XG5cbiAgLy8gRVhJU1RTIC8gSVMgTlVMTCAvIElTIEVNUFRZXG4gIGV4aXN0cygpOiBRdWVyeUJ1aWxkZXI8VD4ge1xuICAgIGxldCByYXc6IEZpbHRlck5vZGUgPSBuZXcgRmlsdGVyUmF3KGAke3RoaXMuZmllbGR9IEVYSVNUU2ApO1xuICAgIGlmICh0aGlzLm5lZ2F0ZWQpIHJhdyA9IG5ldyBGaWx0ZXJOb3QocmF3KTtcbiAgICAodGhpcy5wYXJlbnQgYXMgYW55KS5hZGRGaWx0ZXJOb2RlKHJhdywgdGhpcy5jb25uZWN0b3IpO1xuICAgIHJldHVybiB0aGlzLnBhcmVudDtcbiAgfVxuICBub3RFeGlzdHMoKTogUXVlcnlCdWlsZGVyPFQ+IHtcbiAgICByZXR1cm4gdGhpcy5ub3QoKS5leGlzdHMoKTtcbiAgfVxuXG4gIGlzRW1wdHkoKTogUXVlcnlCdWlsZGVyPFQ+IHtcbiAgICBsZXQgcmF3OiBGaWx0ZXJOb2RlID0gbmV3IEZpbHRlclJhdyhgJHt0aGlzLmZpZWxkfSBJUyBFTVBUWWApO1xuICAgIGlmICh0aGlzLm5lZ2F0ZWQpIHJhdyA9IG5ldyBGaWx0ZXJOb3QocmF3KTtcbiAgICAodGhpcy5wYXJlbnQgYXMgYW55KS5hZGRGaWx0ZXJOb2RlKHJhdywgdGhpcy5jb25uZWN0b3IpO1xuICAgIHJldHVybiB0aGlzLnBhcmVudDtcbiAgfVxuICBpc05vdEVtcHR5KCk6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgcmV0dXJuIHRoaXMubm90KCkuaXNFbXB0eSgpO1xuICB9XG5cbiAgaXNOdWxsKCk6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgbGV0IHJhdzogRmlsdGVyTm9kZSA9IG5ldyBGaWx0ZXJSYXcoYCR7dGhpcy5maWVsZH0gSVMgTlVMTGApO1xuICAgIGlmICh0aGlzLm5lZ2F0ZWQpIHJhdyA9IG5ldyBGaWx0ZXJOb3QocmF3KTtcbiAgICAodGhpcy5wYXJlbnQgYXMgYW55KS5hZGRGaWx0ZXJOb2RlKHJhdywgdGhpcy5jb25uZWN0b3IpO1xuICAgIHJldHVybiB0aGlzLnBhcmVudDtcbiAgfVxuICBpc05vdE51bGwoKTogUXVlcnlCdWlsZGVyPFQ+IHtcbiAgICByZXR1cm4gdGhpcy5ub3QoKS5pc051bGwoKTtcbiAgfVxuXG4gIC8vIFN0cmluZ+KAkHBhdHRlcm4gbWF0Y2hpbmcgKGV4cGVyaW1lbnRhbClcbiAgY29udGFpbnModjogc3RyaW5nKTogUXVlcnlCdWlsZGVyPFQ+IHtcbiAgICByZXR1cm4gdGhpcy5hcHBseShcIkNPTlRBSU5TXCIsIHYgYXMgYW55KTtcbiAgfVxuICBzdGFydHNXaXRoKHY6IHN0cmluZyk6IFF1ZXJ5QnVpbGRlcjxUPiB7XG4gICAgcmV0dXJuIHRoaXMuYXBwbHkoXCJTVEFSVFMgV0lUSFwiLCB2IGFzIGFueSk7XG4gIH1cblxuICAvLyBTeW5vbnltc1xuICBlcXVhbHMgPSB0aGlzLmVxO1xuICBub3RFcXVhbCA9IHRoaXMubmVxO1xuICBncmVhdGVyVGhhbiA9IHRoaXMuZ3Q7XG4gIGdyZWF0ZXJPckVxdWFsID0gdGhpcy5ndGU7XG4gIGxlc3NUaGFuID0gdGhpcy5sdDtcbiAgbGVzc09yRXF1YWwgPSB0aGlzLmx0ZTtcbiAgaW5MaXN0ID0gdGhpcy5pbjtcbiAgbm90SW5MaXN0ID0gdGhpcy5ub3RJbjtcbiAgYmV0d2VlbiA9IHRoaXMucmFuZ2VUbzsgLy8gY29udmVuaWVuY2UgaWYgeW91IHByZWZlciBUTyBzeW50YXhcbiAgbm90QmV0d2VlbiA9IHRoaXMubm90KCkucmFuZ2VUby5iaW5kKHRoaXMpO1xufSJdfQ==