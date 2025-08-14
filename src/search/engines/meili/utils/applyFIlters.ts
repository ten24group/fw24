import { AttributeFilter, GenericFilterGroup, GenericTypedFilter, isAttributeFilter, isGenericFilterGroup, isGenericTypedFilter } from "../../../../entity/query-types";
import {
  coerceValue,
  extractFilterValue,
  isArrayOperator,
  isCoreOperator,
  isContainsOp,
  isEqualityOp,
  isGreaterThanOp,
  isGreaterThanOrEqualOp,
  isInOp,
  isInequalityOp,
  isLessThanOp,
  isLessThanOrEqualOp,
  isNotContainsOp,
  isNotInOp,
  isNumericOperator,
  isOperatorAlias,
  isRangeOp,
  isStringPatternOp,
  isValidOperator,
  normalizeOperator,
  normalizeRangeValue,
  normalizeToArray
} from "../../../../entity/query-utils";
import { createLogger } from "../../../../logging";
import { SearchQueryError } from "../../../errors";
import { SearchQuery } from "../../../types";
import { QueryBuilder } from "../query-builder";

const logger = createLogger('MeiliSearchApplyFilters');

export function applyFilters(qb: QueryBuilder<any>, filters: SearchQuery[ 'filters' ]) {
  if (!filters) {
    return;
  }

  if (isGenericTypedFilter(filters)) {
    applyGenericTypedFilter(qb, filters);
  } else if (isGenericFilterGroup(filters)) {
    applyFilterGroup(qb, filters);
  } else if (isAttributeFilter(filters)) {
    applyAttributeFilter(qb, filters);
  } else {
    const msg = `Invalid filter format`;
    logger.error(`applyFilters: ${msg}`, { filters });
    throw new SearchQueryError(msg, { filters });
  }
}

function applyAttributeFilter(qb: QueryBuilder<any>, filter: AttributeFilter) {
  const { filterId, filterLabel, attribute: field, logicalOp = 'and', ...criteria } = filter;

  // If it's a primitive, treat as eq
  if (
    typeof criteria !== 'object' ||
    criteria === null ||
    Array.isArray(criteria)
  ) {
    qb.where(field).eq(criteria as any);
    return;
  }

  // It's an object of operators:
  for (const [ op, rawVal ] of Object.entries(criteria)) {
    try {
      applyFilterOperation(qb, field, op, rawVal);
    } catch (error) {
      logger.error(`Failed to apply filter operation`, { field, op, rawVal, error });
      throw new SearchQueryError(`Failed to apply filter operation '${op}' on field '${field}'`, { field, op, rawVal, error });
    }
  }
}

function applyFilterOperation(qb: QueryBuilder<any>, field: string, op: string, rawVal: any) {
  // Validate operator before processing
  if (!isValidOperator(op)) {
    logger.warn(`Unknown filter operator '${op}', using raw filter`, { field, op, rawVal });
    qb.filterRaw(`${field} ${op} ${JSON.stringify(rawVal)}`);
    return;
  }

  // Extract actual value from FilterOperatorValue using shared utility
  const val = extractFilterValue(rawVal);

  // Use operator matcher functions instead of switch statement
  if (isEqualityOp(op)) {
    qb.where(field).eq(val);

  } else if (isInequalityOp(op)) {
    qb.where(field).neq(val);

  } else if (isGreaterThanOp(op)) {
    qb.where(field).gt(coerceValue(val, op));

  } else if (isGreaterThanOrEqualOp(op)) {
    qb.where(field).gte(coerceValue(val, op));

  } else if (isLessThanOp(op)) {
    qb.where(field).lt(coerceValue(val, op));

  } else if (isLessThanOrEqualOp(op)) {
    qb.where(field).lte(coerceValue(val, op));

  } else if (isInOp(op)) {
    qb.where(field).in(normalizeToArray(val));

  } else if (isNotInOp(op)) {
    qb.where(field).notIn(normalizeToArray(val));

  } else if (isRangeOp(op)) {
    try {
      const [ min, max ] = normalizeRangeValue(val);
      const numMin = coerceValue(min, op);
      const numMax = coerceValue(max, op);
      qb.where(field).rangeTo(numMin, numMax);
    } catch (error) {
      logger.error(`Invalid range value format`, { field, op, val, error });
      throw new SearchQueryError(`Invalid range value format for '${field}'`, { field, op, val, error });
    }

  } else if (isOperatorAlias(op, 'exists') || isOperatorAlias(op, 'isNull')) {
    // Handle the semantic difference: 'exists' means field exists (not null), 'isNull' means field is null
    if (isOperatorAlias(op, 'exists')) {
      qb.where(field).exists();
    } else {
      qb.where(field).isNull();
    }

  } else if (isOperatorAlias(op, 'isEmpty')) {
    qb.where(field).isEmpty();

  } else if (isContainsOp(op)) {
    qb.where(field).contains(String(val));

  } else if (isNotContainsOp(op)) {
    // MeiliSearch doesn't have native NOT CONTAINS, use NOT filter group
    qb.notGroup(sub => sub.where(field).contains(String(val)));

  } else if (isOperatorAlias(op, 'containsSome')) {
    // For arrays: field contains at least one of the provided values
    const arrayVals = normalizeToArray(val);
    if (arrayVals.length > 0) {
      qb.orGroup(sub => {
        for (const item of arrayVals) {
          sub.where(field).contains(String(item));
        }
      });
    } else {
      qb.where(field).contains(String(val));
    }

  } else if (isStringPatternOp(op)) {
    qb.where(field).startsWith(String(val));

  } else if (isOperatorAlias(op, 'endsWith')) {
    // MeiliSearch doesn't have native endsWith, we could use contains or regex
    // For now, fall back to raw filter
    logger.warn(`endsWith operator not natively supported in MeiliSearch, using raw filter`, { field, val });
    qb.filterRaw(`${field} ENDS WITH "${String(val)}"`);

  } else if (isOperatorAlias(op, 'like')) {
    // MeiliSearch doesn't have SQL LIKE, use contains for basic pattern matching
    logger.warn(`LIKE operator approximated with CONTAINS in MeiliSearch`, { field, val });
    qb.where(field).contains(String(val));

  } else {
    // Fallback for any remaining unhandled operators
    const normalizedOp = normalizeOperator(op);
    logger.warn(`Unhandled filter operator '${op}' (normalized: '${normalizedOp}'), using raw filter`, { field, op, normalizedOp, val });
    qb.filterRaw(`${field} ${normalizedOp} ${JSON.stringify(val)}`);
  }
}

function applyGenericTypedFilter(qb: QueryBuilder<any>, filter: GenericTypedFilter) {
  // Extract metadata
  const { filterId, filterLabel, logicalOp = 'and', ...fieldFilters } = filter;

  // Apply each field filter
  for (const [ field, criteria ] of Object.entries(fieldFilters)) {
    if ([ 'filterId', 'filterLabel', 'logicalOp' ].includes(field)) {
      continue;
    }
    applyAttributeFilter(qb, { ...criteria, attribute: field });
  }
}

function applyFilterGroup(qb: QueryBuilder<any>, filterGroup: GenericFilterGroup) {
  const { filterId, filterLabel, and = [], or = [], not = [] } = filterGroup;

  if (and.length) {
    qb.andGroup(sub => {
      for (const clause of and) {
        sub.andGroup(sub2 => applyFilters(sub2, clause));
      }
    });
  }

  if (or.length) {
    qb.orGroup(sub => {
      for (const clause of or) {
        sub.orGroup(sub2 => applyFilters(sub2, clause));
      }
    });
  }

  if (not.length) {
    qb.notGroup(sub => {
      for (const clause of not) {
        sub.andGroup(sub2 => applyFilters(sub2, clause));
      }
    });
  }
}