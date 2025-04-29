import { createLogger } from '../../logging';
import { EntityQuery, EntitySchema, EntityRecordTypeFromSchema, BaseEntityService } from '../../entity';
import { ISearchEngine, SearchEngineConfig, SearchResult } from '../types';
import { ExecutionContext } from '../../core/types/execution-context';
import { isObject } from '../../utils';

export abstract class BaseSearchService<S extends EntitySchema<any, any, any> = EntitySchema<any, any, any>> {
  protected readonly logger = createLogger(`BaseSearchService:${this.constructor.name}`);

  constructor(
    protected readonly entityService: BaseEntityService<S>,
    protected readonly searchEngine: ISearchEngine,
    protected readonly searchConfig: SearchEngineConfig
  ) { }

  abstract transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>>;

  async search(query: EntityQuery<S>, _ctx?: ExecutionContext): Promise<SearchResult<S>> {
    this.logger.debug('Executing search:', query);

    const results = await this.searchEngine.search<S>(query, this.searchConfig);

    if (results.hits && results.hits.length > 0 && query.attributes) {
      const relationalAttributes = Object.entries(query.attributes)
        ?.map(([ attributeName, options ]) => [ attributeName, options ])
        .filter(([ , options ]) => isObject(options));

      if (relationalAttributes.length > 0) {
        await this.entityService.hydrateRecords(relationalAttributes as any, results.hits);
      }
    }

    return results;
  }

  async syncToIndex(entity: EntityRecordTypeFromSchema<S>): Promise<void> {
    const document = await this.transformDocumentForIndexing(entity);
    await this.searchEngine.index([ document ], this.searchConfig);
  }

  async deleteFromIndex(entityId: string): Promise<void> {
    await this.searchEngine.delete([ entityId ], this.searchConfig.indexName!);
  }

  async bulkSync(entities: EntityRecordTypeFromSchema<S>[]): Promise<void> {
    const documents = await Promise.all(
      entities.map(entity => this.transformDocumentForIndexing(entity))
    );
    await this.searchEngine.index(documents, this.searchConfig);
  }
} 