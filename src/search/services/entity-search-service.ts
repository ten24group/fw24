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
    return this.entityService.getEntitySearchConfig();
  }

  public getSearchIndexConfig() {
    const searchConfig = this.getEntitySearchConfig();
    if (!searchConfig) {
      throw new Error('Search config not found');
    }

    if (!searchConfig.indexConfig) {
      searchConfig.indexConfig = {};
    }

    return searchConfig.indexConfig;
  }

  async search(query: EntitySearchQuery<S>, searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext): Promise<SearchResult<any>> {
    return super.search(query, searchIndexConfig, ctx);
  }

  async syncToIndex(entity: EntityRecordTypeFromSchema<S>, searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext, synchronous?: boolean): Promise<void> {
    return super.syncToIndex(entity, searchIndexConfig, ctx, synchronous);
  }

  async deleteFromIndex(entityId: string, searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext, synchronous?: boolean): Promise<void> {
    return super.deleteFromIndex(entityId, searchIndexConfig, ctx, synchronous);
  }

  async bulkSync(entities: EntityRecordTypeFromSchema<S>[], searchIndexConfig = this.getSearchIndexConfig(), ctx?: ExecutionContext, synchronous?: boolean): Promise<void> {
    return super.bulkSync(entities, searchIndexConfig, ctx, synchronous);
  }

  // extends EntitySchema<any, any, any> = EntitySchema<any, any, any>
  async transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>> {
    const searchConfig = this.getEntitySearchConfig();

    // Use schema-defined transformer if available
    if (searchConfig?.documentTransformer) {
      this.logger.info('Using schema-defined document transformer', { entityName: this.entityService.getEntityName() });
      return await searchConfig.documentTransformer(entity);
    }

    return await super.transformDocumentForIndexing(entity);
  }

  /**
   * Resync all entity documents from database to search index
   * Uses cursor-based pagination to handle large datasets efficiently
   */
  async resyncAllDocuments(options?: {
    batchSize?: number;
    ctx?: ExecutionContext;
  }): Promise<{
    processedCount: number;
    failedCount: number;
    totalIterations: number;
  }> {
    const { batchSize = 50, ctx } = options || {};
    const searchConfig = this.getSearchIndexConfig();
    
    let processedCount = 0;
    let failedCount = 0;
    let cursor: string | undefined = 'init';
    const maxIterations = 10000;
    let iterationCount = 0;

    this.logger.info(`Starting resync for ${this.entityService.getEntityName()}`);

    while (!!cursor && iterationCount < maxIterations) {
      iterationCount++;

      const queryResult = await this.entityService.query({
        pagination: {
          limit: batchSize,
          cursor: cursor === 'init' ? undefined : cursor
        }
      }, ctx);

      if (!queryResult.data || queryResult.data.length === 0) {
        break;
      }

      try {
        await this.bulkSync(queryResult.data as EntityRecordTypeFromSchema<S>[], searchConfig, ctx, true);
        processedCount += queryResult.data.length;
        
        this.logger.info(`Synced batch of ${queryResult.data.length} documents`, {
          entityName: this.entityService.getEntityName(),
          processedCount,
          iteration: iterationCount
        });
      } catch (error: any) {
        this.logger.error(`Error syncing batch: ${error.message}`, { error });
        failedCount += queryResult.data.length;
      }

      cursor = queryResult.cursor ?? undefined;
    }

    this.logger.info(`Resync completed for ${this.entityService.getEntityName()}`, {
      processedCount,
      failedCount,
      totalIterations: iterationCount
    });

    return {
      processedCount,
      failedCount,
      totalIterations: iterationCount,
    };
  }
} 