import { QueryBuilder } from "../query-builder";
import { SearchQuery } from "../../../types";
import { isAttributeFilter, isGenericFilterGroup, isGenericTypedFilter, AttributeFilter, GenericTypedFilter, GenericFilterGroup } from "../../../../entity/query-types";
import { createLogger } from "../../../../logging";
import { SearchQueryError } from "../../../errors";

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

function applyGenericTypedFilter(qb: QueryBuilder<any>, filter: GenericTypedFilter) {
  // Extract metadata
  const { filterId, filterLabel, logicalOp = 'and', ...fieldFilters } = filter;

  // Apply each field filter
  for (const [ field, criteria ] of Object.entries(fieldFilters)) {
    if ([ 'filterId', 'filterLabel', 'logicalOp' ].includes(field)) continue;
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