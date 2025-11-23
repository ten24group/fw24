import type { APIGatewayProxyEvent, Context } from "aws-lambda";

import { getQueueMessageMetadata, sendQueueMessage } from "../../client/sqs";
import { APIController } from '../../core/runtime/api-gateway-controller';
import type { ExecutionContext } from "../../core/types/execution-context";
import { Controller, Delete, Get, Post, Put } from '../../decorators';
import { InjectContainer } from '../../di';
import { type BaseEntityService } from '../../entity';
import { type IDIContainer, type Request, type Response } from '../../interfaces';
import { deepCopy, resolveEnvValueFor } from '../../utils';
import { parseSearchQuery } from "../search-utils";
import { Environment } from "../../client";

export enum SEARCH_CONTROLLER_ENV_KEYS {
  MEILISEARCH_SYNC_QUEUE_NAME = 'MEILISEARCH_SYNC_QUEUE_NAME',
}

@Controller('system/search', {
  env: [ {
    name: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME,
  } ],
})
export class SearchSystemController extends APIController {
  constructor(@InjectContainer() protected container: IDIContainer) {
    super();
  }

  async initialize(_event: APIGatewayProxyEvent, _context: Context) { }

  @Get('/indices')
  async listIndices(_request: Request, response: Response) {
    // Auto-discover entities with search enabled
    const entityProviders = this.container.collectBestProvidersFor({
      type: 'service',
      allProvidersFromChildContainers: true,
    })
      .filter(p => {
        return !!p._provider.forEntity
      });

    const indicesData: any[] = [];

    await Promise.all(entityProviders.map(async (provider) => {

      const entityName = provider._provider.forEntity as string;

      try {

        // use provider's container  to resolve the service
        const service = provider._container.resolve<BaseEntityService<any>>(
          provider._provider.provide
        );

        if (!service) {
          throw new Error(`Service ${String(provider._provider.provide)} not found for entity ${entityName}`);
        }

        const searchService = service.getSearchService();
        if (!searchService) {
          throw new Error(`Search service not found for entity ${entityName}`);
        }

        const indexInfo = await searchService.getIndexInfo();

        indicesData.push({
          ...indexInfo,
          entityName,
          indexName: indexInfo.uid,
        });

      } catch (error: any) {

        indicesData.push({
          indexName: `[${entityName}]-index-name-not-resolved`,
          entityName,
          error: error.message,
        });

        this.logger.error(error);
      }
    }));

    return response.json({ indices: indicesData });
  }

  /**
   * Add new api to get index details
   * 
   */

  @Get('/indices/{entityName}', {})
  async getIndexDetails(
    req: Request<{ path: { entityName: string } }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters ?? {};

    const searchService = this.getEntitySearchService(entityName);

    const indexInfo = await searchService.getIndexInfo();
    const indexStats = await searchService.getIndexStats();

    return res.json({
      details: {
        indexInfo,
        indexStats,
        entityName,
      }
    });
  }

  @Get('/entities')
  async getSearchEntities(_request: Request, response: Response) {
    const entityProviders = this.container.collectBestProvidersFor({
      type: 'service',
      allProvidersFromChildContainers: true,
    })
      .filter(p => !!p._provider.forEntity);

    const entitiesData: {
      entityName: string;
      searchEnabled: boolean;
      indexExists?: boolean;
      indexName?: string;
      error?: string;
    }[] = [];

    await Promise.all(entityProviders.map(async (provider) => {
      const entityName = provider._provider.forEntity as string;

      try {
        const service = provider._container.resolve<BaseEntityService<any>>(
          provider._provider.provide
        );

        if (!service) {
          throw new Error(`Service not found for entity ${entityName}`);
        }

        const searchEnabled = service.isSearchEnabled();
        let indexExists = false;
        let indexName = '';

        if (searchEnabled) {
          const searchService = service.getSearchService();
          if (searchService) {
            const config = await searchService.getSearchIndexConfig();
            indexName = config.indexName!;
            indexExists = await searchService.getEngine().indexExists(indexName);
          }
        }

        entitiesData.push({
          entityName,
          searchEnabled,
          indexExists,
          indexName,
        });

      } catch (error: any) {
        entitiesData.push({
          entityName,
          searchEnabled: false,
          error: error.message,
        });
      }
    }));

    return response.json({ entities: entitiesData });
  }

  @Get('/records/{entityName}/{documentId}')
  async getSingleDocument(
    req: Request<{ path: { entityName: string, documentId: string } }>,
    res: Response
  ) {
    const { entityName, documentId } = req.pathParameters;
    const entityService = this.getEntityService(entityName);
    const searchService = this.getEntitySearchService(entityName);
    const primaryIdFieldName = entityService.getEntityPrimaryIdPropertyName();
    
    const doc = await searchService.getDocument(documentId);

    doc[ 'id' ] = doc[ 'id' ] || doc[ primaryIdFieldName as string ];
    doc[ 'fullRecord' ] = { ...doc };
    doc[ 'entityName' ] = entityName;

    return res.json(doc);
  }

  @Get('/records/{entityName}')
  async getEntityRecords(
    req: Request<{
      path: { entityName: string };
      queryStringParameters?: Record<string, any>
    }>,
    res: Response,
    ctx?: ExecutionContext
  ) {

    const { entityName } = req.pathParameters ?? {};

    const entityService = this.getEntityService(entityName);
    const query = deepCopy(req.queryStringParameters);

    const parsedQuery = parseSearchQuery(query);
    const { select: _select, ...restQueryParams } = parsedQuery;

    const results = await entityService.search(restQueryParams, ctx);

    const { hits, ...rest } = results;
    
    // Get the entity's primary identifier field name
    const primaryIdFieldName = entityService.getEntityPrimaryIdPropertyName();
    
    // Ensure all records have a consistent 'id' field for generic UI listing
    const normalizedHits = hits.map((hit: any) => {
      const normalizedHit = { ...hit };

      normalizedHit[ 'entityName' ] = entityName;
      normalizedHit[ 'fullRecord' ] = hit;
      
      // If the record doesn't have an 'id' field but has the primary identifier field,
      // map it to 'id' for consistent generic listing
      if (!normalizedHit.id && primaryIdFieldName && normalizedHit[ primaryIdFieldName ]) {
        normalizedHit.id = normalizedHit[ primaryIdFieldName ];
      }
      
      // If still no id field, try common identifier patterns
      if (!normalizedHit.id) {
        const idFields = [ `${entityName}Id`, `${entityName.toLowerCase()}Id` ];
        for (const idField of idFields) {
          if (normalizedHit[ idField ]) {
            normalizedHit.id = normalizedHit[ idField ];
            break;
          }
        }
      }
      
      return normalizedHit;
    });

    const response = {
      ...rest,
      items: normalizedHits,
    };

    if (req.debugMode) {
      Object.assign(response, {
        inputQuery: query,
        processingTimeMs: results.processingTimeMs,
        primaryIdFieldName
      });
    }

    return res.json(response);
  }

  @Post('/initIndices')
  async initSearchIndices(
    req: Request<{ body: { entities?: string[] } }>,
    res: Response
  ) {

    const { entities: requestedEntities = [] } = req.body || {};

    // collect provider for entity-services from container-hierarchy
    const entityProviders = this.container.collectBestProvidersFor({
      type: 'service',
      allProvidersFromChildContainers: true,
    })
      .filter(p => (
        // filter out providers that do not have a forEntity property
        !!p._provider.forEntity
        && (
          // if no entities are requested, include all entities
          !requestedEntities?.length
          // if entities are requested, include only the requested entities
          || requestedEntities.includes(p._provider.forEntity as string)
        )
      ));

    const results: {
      error?: string;
      success: boolean;
      message?: string;
      resyncResult?: any;
      entityName: string;
      indexName?: string;
      indexConfig?: any;
    }[] = [];

    await Promise.all(entityProviders.map(async (provider) => {
      const entityName = provider._provider.forEntity as string;

      try {

        const service = provider._container.resolve<BaseEntityService<any>>(
          provider._provider.provide
        );
        if (!service) {
          throw new Error(`EntityService could not be resolved for entity ${entityName}`);
        }

        // Check if search is enabled before attempting to initialize
        if (!service.isSearchEnabled()) {
          results.push({
            entityName,
            success: false,
            message: `Search is not enabled for entity ${entityName}`,
          });
          return;
        }

        const searchService = service.getSearchService();
        if (!searchService) {
          throw new Error(`Search service not found for entity ${entityName}`);
        }

        await searchService.initSearchIndex();
        const config = searchService.getSearchIndexConfig();

        let resyncResult: any;

        try {
          resyncResult = await this.queueDocumentsForResync(entityName, { batchSize: 50, queueUrl: undefined, byBatch: true });
        } catch (error: any) {
          this.logger.error(`Error resyncing records for entity ${entityName}: ${error.message}`, { error });
          resyncResult = {
            success: false,
            message: `Error resyncing records for entity ${entityName}: ${error.message}`,
          };
        }

        results.push({
          entityName,
          indexName: config.indexName,
          indexConfig: config,
          resyncResult,
          success: true,
          message: `Index ${config.indexName} initialized successfully`,
        });

      } catch (error: any) {
        results.push({
          entityName,
          error: error,
          success: false,
          message: `Error initializing index for entity ${entityName}: ${error.message}`,
        });
      }
    }));

    return res.json({ results });
  }

  @Get('/indices/{entityName}/settings')
  async getIndexSettings(
    req: Request<{ path: { entityName: string } }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters ?? {};
    const searchService = this.getEntitySearchService(entityName);
    
    // Get current settings from the search engine
    const currentSettings = await searchService.getIndexSettings();

    // Get auto-generated settings from entity schema
    const searchConfig = searchService.getSearchIndexConfig();
    const schemaSettings = searchConfig.settings || {};

    // Calculate deep diff
    const { diff, hasDifferences } = this.calculateSettingsDiff(currentSettings, schemaSettings);

    // Build informative status message
    let status = '✓ Index settings match entity schema';
    if (hasDifferences) {
      const summary: string[] = [];
      for (const [field, fieldDiff] of Object.entries(diff)) {
        if (fieldDiff.status === 'different' && fieldDiff.type === 'array') {
          const added = (fieldDiff as any).added?.length || 0;
          const removed = (fieldDiff as any).removed?.length || 0;
          if (added > 0) summary.push(`${added} new in schema (${field})`);
          if (removed > 0) summary.push(`${removed} only in index (${field})`);
        }
      }
      status = summary.length > 0 
        ? `ℹ️ Differences found: ${summary.join(', ')}`
        : 'ℹ️ Settings differ from schema';
    }

    return res.json({ 
      settings: currentSettings,
      schemaSettings,
      diff,
      hasDifferences,
      status,
    });
  }

  /**
   * Deep normalize any value for consistent comparison
   * Recursively sorts object keys and handles arrays/primitives
   */
  private deepNormalize(value: any): string {
    // Handle primitives and null/undefined
    if (value === null || value === undefined || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    // Handle arrays - recursively normalize each item
    if (Array.isArray(value)) {
      // Parse back each normalized string to avoid double stringification
      const normalizedArray = value.map(item => JSON.parse(this.deepNormalize(item)));
      return JSON.stringify(normalizedArray);
    }

    // Handle objects - sort keys and recursively normalize values
    const sortedKeys = Object.keys(value).sort();
    const normalizedObj: Record<string, any> = {};
    
    for (const key of sortedKeys) {
      // Parse back the normalized string for nested structures
      try {
        normalizedObj[key] = JSON.parse(this.deepNormalize(value[key]));
      } catch {
        normalizedObj[key] = value[key];
      }
    }

    return JSON.stringify(normalizedObj);
  }

  /**
   * Calculate diff between current index settings and schema-derived settings
   * Only compares fields that exist in schema settings (framework-managed fields)
   */
  private calculateSettingsDiff(current: Record<string, any>, schema: Record<string, any>) {
    const diff: Record<string, any> = {};
    let hasDifferences = false;

    // ONLY compare fields that exist in schema settings (framework-managed)
    // Typically: searchableAttributes, filterableAttributes, sortableAttributes
    const fieldsToCompare = Object.keys(schema || {});

    for (const field of fieldsToCompare) {
      const currentValue = current[field];
      const schemaValue = schema[field];

      // Array comparison (most common case for our managed fields)
      if (Array.isArray(schemaValue)) {
        const currArr = Array.isArray(currentValue) ? currentValue : [];
        const schemaArr = schemaValue;

        // Use deep normalized comparison for array items
        const currNormalizedSet = new Set(currArr.map((item: any) => this.deepNormalize(item)));
        const schemaNormalizedSet = new Set(schemaArr.map((item: any) => this.deepNormalize(item)));

        const added = schemaArr.filter((item: any) => !currNormalizedSet.has(this.deepNormalize(item)));
        const removed = currArr.filter((item: any) => !schemaNormalizedSet.has(this.deepNormalize(item)));

        const isDifferent = added.length > 0 || removed.length > 0;
        if (isDifferent) hasDifferences = true;

        // Only include detailed breakdown if there ARE differences
        if (isDifferent) {
          diff[field] = {
            type: 'array',
            added,
            removed,
            status: 'different'
          };
        } else {
          // Concise for "same" status
          diff[field] = {
            type: 'array',
            status: 'same'
          };
        }

      } else if (schemaValue !== null && typeof schemaValue === 'object') {
        // Object comparison using deep normalization
        const currentNormalized = this.deepNormalize(currentValue);
        const schemaNormalized = this.deepNormalize(schemaValue);
        const isDifferent = currentNormalized !== schemaNormalized;

        if (isDifferent) hasDifferences = true;

        diff[field] = {
          type: 'object',
          current: currentValue,
          schema: schemaValue,
          status: isDifferent ? 'different' : 'same'
        };

      } else {
        // Scalar comparison (string, number, boolean, null, undefined)
        const isDifferent = currentValue !== schemaValue;
        
        if (isDifferent) hasDifferences = true;

        diff[field] = {
          type: 'scalar',
          current: currentValue,
          schema: schemaValue,
          status: isDifferent ? 'different' : 'same'
        };
      }
    }

    return { diff, hasDifferences };
  }

  @Put('/indices/{entityName}/settings', {
    validations: {
      body: {
        settings: { datatype: 'object', required: true },
      },
    },
  })
  async updateIndexSettings(
    req: Request<{
      path: { entityName: string };
      body: { settings: Record<string, any>; }
    }>,
    res: Response
  ) {

    const { entityName } = req.pathParameters ?? {};
    const { settings } = req.body || {};

    const searchService = this.getEntitySearchService(entityName);

    const result = await searchService.updateIndexSettings(settings, true);

    return res.json({
      result,
      entityName,
      success: true,
      message: 'Index settings updated successfully',
    });
  }

  @Post('/indices/{entityName}/reset-settings')
  async resetIndexSettings(
    req: Request<{ path: { entityName: string } }>,
    res: Response
  ) {

    const { entityName } = req.pathParameters ?? {};

    const searchService = this.getEntitySearchService(entityName);

    await searchService.resetIndexSettings();

    return res.json({
      success: true,
      entityName,
      message: 'Index settings reset to Meilisearch defaults'
    });
  }

  @Post('/indices/{entityName}/apply-default-settings')
  async applyDefaultSettings(
    req: Request<{ path: { entityName: string } }>,
    res: Response
  ) {

    const { entityName } = req.pathParameters ?? {};

    const searchService = this.getEntitySearchService(entityName);
    
    // Get schema-derived settings
    const searchConfig = searchService.getSearchIndexConfig();
    const schemaSettings = searchConfig.settings || {};

    // Apply the schema-derived settings
    await searchService.updateIndexSettings(schemaSettings, true);

    return res.json({
      success: true,
      entityName,
      appliedSettings: schemaSettings,
      message: 'Index settings synced successfully from entity schema'
    });
  }

  @Post('/indices/{entityName}/init')
  async initSingleEntityIndex(
    req: Request<{ path: { entityName: string } }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters ?? {};

    const entityService = this.getEntityService(entityName);

    if (!entityService.isSearchEnabled()) {
      return res.status(400).json({
        success: false,
        entityName,
        message: `Search is not enabled for entity ${entityName}`,
      });
    }

    const searchService = this.getEntitySearchService(entityName);

    await searchService.initSearchIndex();
    const config = await searchService.getSearchIndexConfig();

    return res.json({
      success: true,
      entityName,
      indexName: config.indexName,
      config,
      message: `Index ${config.indexName} initialized successfully`,
    });
  }

  @Post('/indices/{entityName}/recreate')
  async recreateIndex(
    req: Request<{
      path: { entityName: string };
      body: {
        resyncDocuments?: boolean;
        syncMethod?: 'direct' | 'queue';
        batchSize?: number;
        queueUrl?: string;
      }
    }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters ?? {};
    const { 
      resyncDocuments = false, 
      syncMethod = 'direct',
      batchSize = 50,
      queueUrl 
    } = req.body || {};

    const searchService = this.getEntitySearchService(entityName);

    const oldConfig = await searchService.getSearchIndexConfig();
    this.logger.info(`Recreating index for entity ${entityName}`, { oldConfig });

    // Delete existing index
    this.logger.info(`Deleting existing index: ${oldConfig.indexName}`);
    try {
      await searchService.deleteSearchIndex(true);
    } catch (error: any) {
      this.logger.warn(`Could not delete index (might not exist): ${error.message}`);
    }

    // Reinitialize index with new configuration
    this.logger.info(`Reinitializing index for entity ${entityName}`);
    await searchService.initSearchIndex();
    const newConfig = await searchService.getSearchIndexConfig();

    let resyncResult = null;

    // Optionally resync all documents
    if (resyncDocuments) {
      if (syncMethod === 'queue') {
        // Queue-based sync (non-blocking, for large datasets)
        this.logger.info(`Queueing documents for resync: ${entityName}`);
        resyncResult = await this.queueDocumentsForResync(entityName, { batchSize, queueUrl });
      } else {
        // Direct sync (blocking, immediate confirmation)
        this.logger.info(`Directly resyncing documents: ${entityName}`);
        resyncResult = await searchService.resyncAllDocuments({ batchSize });
      }
    }

    return res.json({
      success: true,
      entityName,
      oldIndexName: oldConfig.indexName,
      newIndexName: newConfig.indexName,
      syncMethod: resyncDocuments ? syncMethod : null,
      message: `Index recreated successfully${resyncDocuments ? ` (${syncMethod} sync: ${resyncResult?.processedCount || 0} documents)` : ''}`,
      resyncResult,
      configs: { oldConfig, newConfig }
    });
  }

  @Delete('/indices/{entityName}')
  async deleteIndex(
    req: Request<{ path: { entityName: string } }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters;
    const searchService = this.getEntitySearchService(entityName);
    await searchService.deleteSearchIndex(true);
    return res.json({
      success: true,
      entityName,
      message: 'Index deleted successfully'
    });
  }

  @Delete('/indices/{entityName}/documents')
  async clearEntityIndex(
    req: Request<{ path: { entityName: string } }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters ?? {};

    const searchService = this.getEntitySearchService(entityName);

    const config = searchService.getSearchIndexConfig();
    await searchService.getEngine().deleteAllDocuments(config.indexName!, true);

    return res.json({
      success: true,
      entityName,
      indexName: config.indexName,
      message: 'All documents cleared from index'
    });
  }

  @Post('/indices/{entityName}/resync')
  async resyncEntityRecords(
    req: Request<{
      path: { entityName: string };
      body: { batchSize?: number; queueUrl?: string; byBatch?: boolean }
    }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters ?? {};
    const { batchSize = 50, queueUrl, byBatch = true } = req.body || {};

    const result = await this.queueDocumentsForResync(entityName, { batchSize, queueUrl, byBatch });

    let message = `Queued ${result.processedCount} records for re-indexing`;
    if (result.failedCount > 0) {
      message += `, ${result.failedCount} records failed to be queued`;
    }

    return res.json({
      message,
      success: result.processedCount > 0,
      entityName,
      ...result,
    });
  }

  /**
   * Queue documents for async resync via SQS
   * Shared logic used by resync and recreate endpoints
   */
  private async queueDocumentsForResync(
    entityName: string,
    options: {
      batchSize?: number;
      queueUrl?: string;
      byBatch?: boolean;
    }
  ): Promise<{
    processedCount: number;
    failedCount: number;
    totalIterations: number;
  }> {
    const { batchSize = 50, queueUrl, byBatch = true } = options;
    const entityService = this.getEntityService(entityName);

    // Use provided queueUrl or resolve from environment
    const queueName = resolveEnvValueFor({ key: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME });
    const resolvedQueueUrl = queueUrl || Environment.queueUrl(queueName);

    if (!resolvedQueueUrl) {
      throw new Error(`Queue URL not provided for resyncing records for entity ${entityName} and env-key [${SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME}] is not configured`);
    }

    let failedCount = 0;
    let processedCount = 0;
    let cursor: string | undefined = 'init';
    let iterationCount = 0;
    const maxIterations = 100000;

    while (!!cursor && iterationCount < maxIterations) {
      iterationCount++;

      this.logger.info(`Fetching ${entityName} records from cursor: ${cursor}`);

      const queryResult = await entityService.query({
        pagination: {
          limit: batchSize,
          cursor: cursor === 'init' ? undefined : cursor
        }
      });

      if (!queryResult.data || queryResult.data.length === 0) {
        break;
      }

      if (byBatch) {
        const data = await Promise.all(queryResult.data.map(async (rec) => {
          return await entityService.transformDocumentForIndexing(rec);
        }));

        try {
          await sendQueueMessage(resolvedQueueUrl, {
            data,
            eventName: "RESYNC",
            entityName,
          });
          processedCount += data.length;
        } catch (error: any) {
          this.logger.error(`Error queueing batch for sync: ${error.message}`, { entityName, batchSize, error });
          failedCount += data.length;
        }
      } else {
        await Promise.all(
          queryResult.data.map(async (entityRecord) => {
            try {
              const transformed = await entityService.transformDocumentForIndexing(entityRecord);
              await sendQueueMessage(resolvedQueueUrl, {
              data: transformed,
              eventName: "RESYNC",
              entityName,
              });
            processedCount++;
          } catch (error: any) {
              this.logger.error(`Error queueing record for sync: ${error.message}`, { entityName, error });
            failedCount++;
          }
          })
        );
      }

      cursor = queryResult.cursor ?? undefined;
    }

    this.logger.info(`Queue sync completed for ${entityName}`, {
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

  @Get('/queue-info')
  async getQueueInfo(
    req: Request<{ path: { queueUrl: string } }>,
    res: Response
  ) {

    const { queueUrl } = req.queryStringParameters;  

    // Use provided queueUrl or resolve from environment
    const queueName = resolveEnvValueFor({ key: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME });
    const resolvedQueueUrl = queueUrl || Environment.queueUrl(queueName);

    const info = await getQueueMessageMetadata(resolvedQueueUrl);

    return res.json({ info });
  }

  @Put('/records/{entityName}', {
    validations: {
      body: {
        documents: { datatype: 'array', required: true },
      },
    },
  })
  async updateDocuments(
    req: Request<{
      path: { entityName: string };
      body: { documents: any[] }
    }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters;
    const { documents } = req.body;
    const searchService = this.getEntitySearchService(entityName);
    const result = await searchService.updateDocuments(documents, true);
    return res.json({
      result,
      entityName,
      success: true,
      message: 'Documents updated successfully',
    });
  }

  @Delete('/records/{entityName}/by-ids', {
    validations: {
      body: {
        ids: { datatype: 'array', required: true },
      },
    },
  })
  async deleteDocumentsByIds(
    req: Request<{
      path: { entityName: string };
      body: { ids: string[] }
    }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters;
    const { ids } = req.body;
    const searchService = this.getEntitySearchService(entityName);
    const config = await searchService.getSearchIndexConfig();
    await searchService.getEngine().deleteDocuments(ids, config.indexName!, true);

    return res.json({
      success: true,
      entityName,
      indexName: config.indexName,
      message: 'Documents deleted successfully'
    });
  }

  @Delete('/records/{entityName}/by-filter', {
    validations: {
      body: {
        filter: { datatype: 'object', required: true },
      },
    },
  })
  async deleteDocumentsByFilter(
    req: Request<{
      path: { entityName: string };
      body: { filter: any }
    }>,
    res: Response
  ) {
    const { entityName } = req.pathParameters;
    const { filter } = req.body;
    const searchService = this.getEntitySearchService(entityName);

    const config = await searchService.getSearchIndexConfig();
    await searchService.deleteDocumentsByFilter(filter, true);

    return res.json({
      success: true,
      entityName,
      indexName: config.indexName,
      message: 'Documents matching filter have been queued for deletion.'
    });
  }

  protected getEntityService(entityName: string) {
    const provider = this.container.collectBestProvidersFor({
      type: 'service',
      allProvidersFromChildContainers: true,
      forEntity: entityName,
    });

    if (provider.length === 0) {
      throw new Error(`No provider found for entity-service for ${entityName}`);
    }

    return provider[ 0 ]._container.resolve<BaseEntityService<any>>(provider[ 0 ]._provider.provide);
  }

  protected getEntitySearchService(entityName: string) {
    const entityService = this.getEntityService(entityName);
    const searchService = entityService.getSearchService();

    if (!searchService) {
      throw new Error(`Search service not found for entity ${entityName}`);
    }

    return searchService;
  }
}