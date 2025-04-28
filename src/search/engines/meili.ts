import { Index, MeiliSearch } from 'meilisearch';
import { EntitySchema } from '../../entity';
import { AttributeFilter, EntityFilter, EntityFilterCriteria, EntityQuery, FilterGroup, isAttributeFilter, isComplexFilterValue, isEntityFilter, isFilterGroup } from '../../entity/query-types';
import { isNumeric, isObject } from '../../utils';
import { SearchEngineConfig, SearchOptions, SearchResult } from '../types';
import { BaseSearchEngine } from './base';

export interface MeiliSearchConfig {
  host: string;
  apiKey: string;
}

export class MeiliSearchEngine extends BaseSearchEngine {
  private client: MeiliSearch;
  private indices: Map<string, Index> = new Map();

  constructor(config: MeiliSearchConfig) {
    super(config);
    this.client = new MeiliSearch(config);
  }

  private async getIndex(config: SearchEngineConfig): Promise<Index> {
    this.validateConfig(config);

    const indexName = config.indexName!;

    if (!this.indices.has(indexName)) {
      const index = this.client.index(indexName);

      // Update settings if provided
      if (config.settings) {
        await index.updateSettings(config.settings);
      }

      this.indices.set(indexName, index);
    }

    return this.indices.get(indexName)!;
  }

  async index<T extends Record<string, any>>(documents: T[], config: SearchEngineConfig): Promise<void> {
    const index = await this.getIndex(config);
    await index.addDocuments(documents);
  }

  async search<T>(query: EntityQuery<any>, config: SearchEngineConfig): Promise<SearchResult<T>> {
    const index = await this.getIndex(config);

    let offset = 0;
    let limit = query.pagination?.count || 20;

    if (query.pagination?.pages && isNumeric(query.pagination.pages)) {
      offset = (query.pagination.pages - 1) * (query.pagination.count || 20);
    }

    const searchOptions: SearchOptions = {
      filter: this.transformFilters(query.filters),
      facets: config.faceting?.facets ? Object.keys(config.faceting.facets) : undefined,
      limit,
      offset,
      sort: query.pagination?.order ? [ `createdAt:${query.pagination.order}` ] : undefined,
    };

    const searchPhrase = Array.isArray(query.search)
      ? query.search.join(' ')
      : query.search || '';

    const results = await index.search(searchPhrase, searchOptions);

    return {
      ...results,
      hits: results.hits as T[],
      facets: results.facetDistribution,
      total: results.estimatedTotalHits,
    };
  }

  async delete(ids: string[], indexName: string): Promise<void> {
    if (!indexName) {
      throw new Error('Index name is required for delete operation in MeiliSearchEngine');
    }
    await this.client.index(indexName).deleteDocuments(ids);
  }

  private transformFilters(filters: EntityFilterCriteria<any> | undefined): string[] {
    if (!filters) return [];
    return this.transformFilterItem(filters);
  }

  private transformFilterItem(item: EntityFilterCriteria<any>): string[] {
    if (item && typeof item === 'object') {
      if ('and' in item || 'or' in item || 'not' in item) {
        return this.handleFilterGroup(item as FilterGroup<any>);
      } else if (Object.keys(item).some(key => key !== 'filterId' && key !== 'filterLabel' && key !== 'logicalOp' && key !== 'attribute')) {
        return this.handleEntityFilter(item as EntityFilter<any>);
      } else if ('attribute' in item) {
        const attributeFilter = item as AttributeFilter<any>;
        return this.transformAttributeFilter(attributeFilter.attribute as string, attributeFilter);
      }
    }
    this.logger.warn('Unknown filter item type:', item);
    return [];
  }

  private handleFilterGroup(group: any): string[] {
    const expressions: string[] = [];

    if (group.and) {
      const andFilters = Array.isArray(group.and) ? group.and : [ group.and ];
      const andExpressions = andFilters.flatMap((f: EntityFilterCriteria<any>) => this.transformFilterItem(f));
      if (andExpressions.length > 0) {
        expressions.push(andExpressions.join(' AND '));
      }
    }
    if (group.or) {
      const orFilters = Array.isArray(group.or) ? group.or : [ group.or ];
      const orExpressions = orFilters.flatMap((f: EntityFilterCriteria<any>) => this.transformFilterItem(f));
      if (orExpressions.length > 0) {
        expressions.push(`(${orExpressions.join(' OR ')})`);
      }
    }
    if (group.not) {
      const notFilters = Array.isArray(group.not) ? group.not : [ group.not ];
      const notExpressions = notFilters.flatMap((f: EntityFilterCriteria<any>) => this.transformFilterItem(f));
      if (notExpressions.length > 0) {
        expressions.push(`NOT (${notExpressions.join(' AND ')})`);
      }
    }
    return expressions;
  }

  private handleEntityFilter(filter: any): string[] {
    const expressions: string[] = [];
    const logicalOp = filter.logicalOp || 'and';

    Object.entries(filter).forEach(([ field, criteria ]) => {
      if (field === 'filterId' || field === 'filterLabel' || field === 'logicalOp' || !criteria) return;
      const filterExpressions = this.transformAttributeFilter(field, criteria);
      if (filterExpressions.length > 0) {
        expressions.push(filterExpressions.join(' AND '));
      }
    });

    if (expressions.length === 0) return [];
    return [ expressions.join(` ${logicalOp.toUpperCase()} `) ];
  }

  private transformAttributeFilter(attribute: string, criteria: any): string[] {
    const expressions: string[] = [];
    const logicalOp = criteria.logicalOp || 'and';
    const filterCriteria = this.cleanupCriteria(criteria);

    Object.entries(filterCriteria).forEach(([ op, value ]) => {
      const formattedValue = isComplexFilterValue(value) ? value.val : value;

      if (this.isBetweenOperator(op)) {
        expressions.push(...this.handleBetweenValue(attribute, formattedValue));
      } else if (Array.isArray(formattedValue)) {
        expressions.push(...this.handleArrayValue(attribute, op, formattedValue));
      } else {
        expressions.push(...this.handleSingleValue(attribute, op, formattedValue));
      }
    });

    if (expressions.length === 0) return [];
    return expressions;
  }

  private cleanupCriteria(criteria: any): any {
    const { filterId, filterLabel, logicalOp, attribute, ...rest } = criteria;
    return rest;
  }

  private handleArrayValue(attribute: string, op: string, values: any[]): string[] {
    switch (op) {
      case 'in':
      case 'inList':
        return [ `${attribute} IN [${values.map(v => this.formatValue(v)).join(', ')}]` ];
      case 'nin':
      case 'notIn':
      case 'notInList':
        return [ `${attribute} NOT IN [${values.map(v => this.formatValue(v)).join(', ')}]` ];
      case 'contains':
      case 'includes':
      case 'has':
        return [ `(${values.map(v => `${attribute} = ${this.formatValue(v)}`).join(' OR ')})` ];
      case 'notContains':
      case 'notHas':
      case 'notIncludes':
        return [ `(${values.map(v => `${attribute} != ${this.formatValue(v)}`).join(' AND ')})` ];
      default:
        return [];
    }
  }

  private handleSingleValue(attribute: string, op: string, value: any): string[] {
    const meiliOperator = this.mapOperator(op);
    if (!meiliOperator) return [];

    if (op === 'exists') {
      return [ `${attribute} ${value ? 'EXISTS' : 'NOT EXISTS'}` ];
    }
    if (op === 'isNull') {
      return [ `${attribute} ${value ? 'NOT EXISTS' : 'EXISTS'}` ];
    }

    if (op === 'isEmpty') {
      return [ `${attribute} = ""` ];
    }
    if (this.isBetweenOperator(op)) {
      return this.handleBetweenValue(attribute, value);
    }
    return [ `${attribute} ${meiliOperator} ${this.formatValue(value)}` ];
  }

  private isBetweenOperator(op: string): boolean {
    return [ 'between', 'bt', 'bw', '><' ].includes(op);
  }

  private handleBetweenValue(attribute: string, value: any): string[] {
    if (Array.isArray(value) && value.length === 2) {
      return [ `${attribute} ${this.formatValue(value[ 0 ])} TO ${this.formatValue(value[ 1 ])}` ];
    }
    if (isObject(value) && value.from !== undefined && value.to !== undefined) {
      return [ `${attribute} ${this.formatValue(value.from)} TO ${this.formatValue(value.to)}` ];
    }
    return [];
  }

  private mapOperator(op: string): string | undefined {
    const operatorMap: Record<string, string> = {
      eq: '=', equalTo: '=', equal: '=', '==': '=', '===': '=',
      ne: '!=', neq: '!=', notEqualTo: '!=', notEqual: '!=', '!=': '!=', '!==': '!=', '<>': '!=',
      gt: '>', greaterThan: '>', '>': '>',
      gte: '>=', greaterThanOrEqualTo: '>=', '>=': '>=', '>==': '>=',
      lt: '<', lessThan: '<', '<': '<',
      lte: '<=', lessThanOrEqualTo: '<=', '<=': '<=', '<==': '<=',
      like: 'CONTAINS',
      begins: 'STARTS WITH', startsWith: 'STARTS WITH', beginsWith: 'STARTS WITH',
      '><': 'BETWEEN', bt: 'BETWEEN', bw: 'BETWEEN', between: 'BETWEEN',
      exists: 'EXISTS', isNull: 'EXISTS', isEmpty: 'EXISTS',
      in: 'IN', inList: 'IN',
      nin: 'NOT IN', notInList: 'NOT IN', notIn: 'NOT IN',
      includes: 'IN', endsWith: 'ENDS WITH',
      contains: 'CONTAINS', containsSome: 'CONTAINS',
      notContains: 'NOT CONTAINS', notHas: 'NOT CONTAINS', notIncludes: 'NOT CONTAINS',
      has: 'HAS', hasSome: 'HAS', includesSome: 'HAS'
    };
    return operatorMap[ op ];
  }

  private formatValue(value: any): string {
    if (Array.isArray(value)) {
      this.logger.warn('Formatting array value in formatValue. This might indicate a filter translation issue. Value:', value);
      return `[${value.map(v => this.formatValue(v)).join(', ')}]`;
    }
    if (typeof value === 'string') {
      const escapedValue = value.replace(/"/g, '\\"');
      return `"${escapedValue}"`;
    }
    return String(value);
  }
} 