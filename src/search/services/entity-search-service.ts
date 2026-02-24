import type { ExecutionContext } from '../../core/types/execution-context';
import type { BaseEntityService, EntityRecordTypeFromSchema, EntitySchema } from '../../entity';
import type { BaseSearchEngine } from '../engines';
import type { EntitySearchQuery, SearchResult } from '../types';
import { BaseSearchService } from './base-search-service';
import { BatchProgress } from '../../observability/utils/batch-progress';

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
   * Resync all entity documents from database to search index.
   * Uses cursor-based pagination to handle large datasets efficiently.
   *
   * @param options.batchSize - Number of records to fetch per iteration (default: 50)
   * @param options.ctx - Execution context for the operation
   * @param options.maxIterations - Safety limit on number of iterations (default: 10000)
   */
  async resyncAllDocuments(options?: {
    batchSize?: number;
    ctx?: ExecutionContext;
    maxIterations?: number;
  }): Promise<{
    processedCount: number;
    failedCount: number;
    totalIterations: number;
  }> {
    const { batchSize = 50, ctx, maxIterations = 10000 } = options || {};
    const searchConfig = this.getSearchIndexConfig();
    const entityName = this.entityService.getEntityName();

    let cursor: string | undefined = 'init';
    let iterationCount = 0;
    let processedCount = 0;
    let failedCount = 0;

    this.logger.info(`Starting resync for ${entityName}`);

    // Iterate through all records using cursor-based pagination
    while (cursor && iterationCount < maxIterations) {
      iterationCount++;

      // Fetch next batch
      const queryResult = await this.entityService.query({
        pagination: {
          limit: batchSize,
          cursor: cursor === 'init' ? undefined : cursor
        }
      }, ctx);

      if (!queryResult.data?.length) {
        break;
      }

      // Sync batch to search index
      const { summary } = await BatchProgress.all(
        `Resync ${entityName}`,
        queryResult.data,
        async (docs) => {
          await this.bulkSync(docs as EntityRecordTypeFromSchema<S>[], searchConfig, ctx, true);
          return docs;
        },
        {
          // Show progress on first iteration, then only errors
          observe: iterationCount === 1 ? 'progress' : 'errors',
          tags: { entity: entityName },
        }
      );

      processedCount += summary.succeeded;
      failedCount += summary.failed;
      cursor = queryResult.cursor ?? undefined;
    }

    this.logger.info(`Resync completed for ${entityName}`, {
      processedCount,
      failedCount,
      iterations: iterationCount
    });

    return { processedCount, failedCount, totalIterations: iterationCount };
  }
}