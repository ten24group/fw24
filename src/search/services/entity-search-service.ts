import { BaseSearchService } from './base-search-service';
import { EntitySchema, EntityRecordTypeFromSchema, BaseEntityService } from '../../entity';
import { SearchResult, EntitySearchQuery } from '../types';
import { SearchIndexConfig } from '../types';
import { ExecutionContext } from '../../core/types/execution-context';
import { BaseSearchEngine } from '../engines';

export class EntitySearchService<S extends EntitySchema<any, any, any>> extends BaseSearchService {

  constructor(
    protected readonly entityService: BaseEntityService<S>,
    protected readonly searchEngine: BaseSearchEngine,
  ) {
    super(searchEngine);
  }

  protected getEntitySearchConfig() {
    return this.entityService.getEntitySchema().model.search;
  }

  protected getSearchIndexConfig() {
    const searchConfig = this.getEntitySearchConfig();
    if (!searchConfig) {
      throw new Error('Search config not found');
    }

    return searchConfig.config;
  }

  async search(query: EntitySearchQuery<S>, searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext): Promise<SearchResult<any>> {
    return super.search(query, searchIndexConfig, ctx);
  }

  async syncToIndex(entity: EntityRecordTypeFromSchema<S>, searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext): Promise<void> {
    return super.syncToIndex(entity, searchIndexConfig, ctx);
  }

  async deleteFromIndex(entityId: string, searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext): Promise<void> {
    return super.deleteFromIndex(entityId, searchIndexConfig, ctx);
  }

  async bulkSync(entities: EntityRecordTypeFromSchema<S>[], searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext): Promise<void> {
    return super.bulkSync(entities, searchIndexConfig, ctx);
  }

  // extends EntitySchema<any, any, any> = EntitySchema<any, any, any>
  async transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>> {
    const searchConfig = this.getEntitySearchConfig();

    // Use schema-defined transformer if available
    if (searchConfig?.documentTransformer) {
      return searchConfig.documentTransformer(entity);
    }

    // Default transformation
    const document: Record<string, any> = { ...entity };

    // Handle searchable relations if defined
    const searchableRelations = searchConfig?.config.settings?.searchableAttributes
      ?.filter(attr => attr.includes('.')) || [];

    for (const relation of searchableRelations) {
      const [ relationName, field ] = relation.split('.');
      if (entity[ relationName ]) {
        document[ relation ] = entity[ relationName ][ field ];
      }
    }

    return document;
  }
} 