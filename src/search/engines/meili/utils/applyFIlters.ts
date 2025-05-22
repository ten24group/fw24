import { QueryBuilder } from "../query-builder";
import { SearchQuery } from "../../../types";

export function applyFilters(qb: QueryBuilder<any>, filters: SearchQuery[ 'filters' ]) {
  if (!filters) {
    return;
  }

  // 1) Group filters
  if (filters.and) {
    qb.andGroup(sub => {
      for (const clause of [].concat(filters.and as [])) {
        sub.andGroup(sub2 => applyFilters(sub2, clause));
      }
    });
    return;
  }

  if (filters.or) {
    qb.orGroup(sub => {
      for (const clause of [].concat(filters.or as [])) {
        sub.orGroup(sub2 => applyFilters(sub2, clause));
      }
    });
    return;
  }

  if (filters.not) {
    qb.notGroup(sub => {
      for (const clause of [].concat(filters.not as [])) {
        sub.andGroup(sub2 => applyFilters(sub2, clause));
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
}