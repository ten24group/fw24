import type { APIGatewayProxyEvent, Context } from "aws-lambda";

import { APIController } from '../../core/runtime/api-gateway-controller';
import { Controller, Get, Post } from '../../decorators';
import { InjectContainer } from '../../di';
import { type BaseEntityService } from '../../entity';
import { type IDIContainer, type Request, type Response } from '../../interfaces';

@Controller('system/search', {
  // Config will be merged from construct registration
})
export class SearchSystemController extends APIController {
  constructor(@InjectContainer() private container: IDIContainer) {
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

    const indicesData: {
      indexName: string;
      entityName: string;
      stats?: any;
      error?: string;
      indexConfig?: any;
    }[] = [];

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

        if (!service.isSearchEnabled()) {
          throw new Error(`Search is not enabled for entity ${entityName}`);
        }

        const searchService = service.getSearchService();
        if (!searchService) {
          throw new Error(`Search service not found for entity ${entityName}`);
        }

        const stats = await searchService.getIndexStats();
        const indexConfig = await searchService.getSearchIndexConfig();

        indicesData.push({
          indexName: indexConfig.indexName!,
          stats,
          indexConfig,
          entityName,
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

  @Get('/indices/{entityName}/{indexName}', {})
  async getIndexDetails(
    req: Request<{ path: { entityName: string, indexName: string } }>,
    res: Response
  ) {
    const { entityName, indexName } = req.pathParameters ?? {};

    if (!entityName || !indexName) {
      return res.status(400).json({ error: 'Entity name and index name are required' });
    }

    const entityService = this.getEntityService(entityName);
    const searchService = entityService.getSearchService();
    if (!searchService) {
      throw new Error(`Search service not found for entity ${entityName}`);
    }

    const searchEngine = searchService.getEngine();
    if (!searchEngine) {
      throw new Error(`Search engine not found for entity ${entityName}`);
    }

    const indexInfo = await searchEngine.getIndexInfo(indexName);
    const indexStats = await searchEngine.getIndexStats(indexName);
    const indexSettings = await searchEngine.getIndexSettings(indexName);

    return res.json({
      indexName,
      indexInfo,
      indexStats,
      entityName,
      indexSettings,
    });
  }

  private getEntityService(entityName: string) {
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

  @Post('/indices/rebuild')
  async rebuildIndices(req: Request, res: Response) {
    const { entityName } = req.body;

    const message = entityName ? `Rebuilt index for ${entityName}` : 'Rebuild initiated for all entities';

    const providersCriteria: Parameters<typeof this.container.collectBestProvidersFor>[ '0' ] = {
      type: 'service',
      allProvidersFromChildContainers: true,
    }

    if (entityName) {
      providersCriteria.forEntity = entityName;
    }

    const searchableServices = this.container.collectBestProvidersFor(providersCriteria)
      .filter(p => p._provider.forEntity)
      .map(p => p._container.resolve<BaseEntityService<any>>(p._provider.provide))
      .filter(service => service.getSearchService());

    const results = [];

    for (const service of searchableServices) {
      try {
        await service.rebuildIndex();
        results.push({ entity: service.getEntityName(), status: 'success' });
      } catch (error: any) {
        results.push({ entity: service.getEntityName(), status: 'error', error: error.message });
      }
    }

    return res.json({ message, results });
  }

}