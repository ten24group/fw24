import type { APIGatewayProxyEvent, Context } from "aws-lambda";

import { sendQueueMessage } from "../../client/sqs";
import { APIController } from '../../core/runtime/api-gateway-controller';
import type { ExecutionContext } from "../../core/types/execution-context";
import { Controller, Delete, Get, Post, Put } from '../../decorators';
import { InjectContainer } from '../../di';
import { type BaseEntityService } from '../../entity';
import { type IDIContainer, type Request, type Response } from '../../interfaces';
import { deepCopy, resolveEnvValueFor } from '../../utils';

export enum SEARCH_CONTROLLER_ENV_KEYS {
  MEILISEARCH_SYNC_QUEUE_URL = 'MEILISEARCH_SYNC_QUEUE_URL',
}

@Controller('system/search', {
  env: [ {
    name: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_URL,
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
    const indexSettings = await searchService.getIndexSettings();

    return res.json({
      indexInfo,
      indexStats,
      entityName,
      indexSettings,
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
    const searchService = this.getEntitySearchService(entityName);
    const doc = await searchService.getDocument(documentId);
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
    const query = deepCopy(req.body);

    const results = await entityService.search(query as any, ctx);

    const { hits, ...rest } = results;
    const response = {
      ...rest,
      items: hits,
    };

    if (req.debugMode) {
      Object.assign(response, {
        inputQuery: query,
        processingTimeMs: results.processingTimeMs
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

        const searchService = service.getSearchService();
        if (!searchService) {
          throw new Error(`Search service not found for entity ${entityName}`);
        }

        await searchService.initSearchIndex();
        const config = await searchService.getSearchIndexConfig();

        results.push({
          entityName,
          indexName: config.indexName,
          indexConfig: config,
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
    const settings = await searchService.getIndexSettings();
    return res.json({ settings });
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
      message: 'Index settings reset to code configuration'
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

    const config = await searchService.getSearchIndexConfig();
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
      body: { batchSize?: number; queueUrl?: string }
    }>,
    res: Response
  ) {

    const { entityName } = req.pathParameters ?? {};
    const { batchSize = 25, queueUrl } = req.body || {};

    const entityService = this.getEntityService(entityName);

    // Use provided queueUrl or resolve from environment
    const resolvedQueueUrl = queueUrl || resolveEnvValueFor({ key: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_URL });

    if (!resolvedQueueUrl) {
      throw new Error(`Queue URL not provided and ${SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_URL} not configured`);
    }

    // Get all entity records in batches and queue them for sync
    let failedCount = 0;
    let processedCount = 0;
    let cursor: string | undefined = 'init';

    while (!!cursor) {

      this.logger.info(`Fetching ${entityName} records from cursor: ${cursor}`);

      const queryResult = await entityService.query({
        pagination: {
          limit: batchSize,
          cursor: cursor === 'init' ? undefined : cursor
        }
      });

      await Promise.all(
        (queryResult.data ?? []).map(async (entityRecord) => {
          try {
            await sendQueueMessage(resolvedQueueUrl, {
              data: { ...entityRecord },
              eventName: "RESYNC",
              entityName,
            })
            processedCount++;
          } catch (error: any) {
            this.logger.error(`Error queueing record for sync: ${error.message}`);
            failedCount++;
          }
        })
      );

      cursor = queryResult.cursor ?? undefined;
    }

    let message = `Queued ${processedCount} records for re-indexing`;
    if (failedCount > 0) {
      message += `, ${failedCount} records failed to be queued`;
    }

    return res.json({
      message,
      success: processedCount > 0,
      entityName,
      failedCount,
      processedCount,
    });
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