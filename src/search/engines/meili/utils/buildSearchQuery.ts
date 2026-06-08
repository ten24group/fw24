import { SearchParams } from "meilisearch";
import { SearchQuery } from "../../../types";
import { QueryBuilder } from "../query-builder";
import { applyFilters } from "./applyFIlters";

export function buildMeiliSearchQuery<T>(query: SearchQuery) {
  const builder = QueryBuilder.create<T>();

  // ─── Full-text search ───────────────────────────────────────────────────────
  const phrase = Array.isArray(query.search)
    ? query.search.join(" ")
    : query.search ?? "";
  builder.text(phrase);

  // ─── Filters ────────────────────────────────────────────────────────────────
  if (query.filters) {
    applyFilters(builder, query.filters);
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
  if (query.distinct) {
    builder.distinct(query.distinct);
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
  if (query.facets) {
    builder.facets(query.facets);
  }

  // ─── Matching strategy ────────────────────────────────────────────────────
  if (query.matchingStrategy) {
    builder.matchingStrategy(query.matchingStrategy);
  }

  // ─── Geo-search ───────────────────────────────────────────────────────────
  if (query.geoRadiusFilter) {
    const { center, distanceInMeters } = query.geoRadiusFilter;
    builder.geoRadius(center.lat, center.lng, distanceInMeters);
  }

  if (query.geoBoundingBoxFilter) {
    const { topLeft, bottomRight } = query.geoBoundingBoxFilter;
    builder.geoBoundingBox(topLeft, bottomRight);
  }

  if (query.geoSort) {
    const { point, direction } = query.geoSort;
    builder.sortByGeoPoint(point.lat, point.lng, direction);
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

  return builder.build();
} 