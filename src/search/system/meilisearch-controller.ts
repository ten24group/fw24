import { Controller, Delete, Get, Post, Put } from '../../decorators';
import { Request, Response } from '../../interfaces';
import { SearchSystemController } from './search-controller';
import { MeiliSearchEngine } from '../engines';
import { SearchEngineError } from '../errors';
import { BaseEntityService } from '../../entity/base-service';
import { DeleteOrCancelTasksQuery, DocumentsQuery, TasksOrBatchesQuery } from 'meilisearch';

@Controller('system/search/meili', {
  // Config will be merged from construct registration
})
export class MeiliSearchSystemController extends SearchSystemController {

  private getMeiliEngine(): MeiliSearchEngine {
    const engine = this.container.resolveSearchEngine();

    if (engine instanceof MeiliSearchEngine) {
      return engine;
    }

    throw new SearchEngineError('Could not resolve MeiliSearchEngine from di-container');
  }

  @Get('/stats')
  async getStats(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const stats = await engine.getStats();
    return res.json(stats);
  }

  @Post('/experimental-features', {
    validations: {
      body: {
        metrics: { datatype: 'boolean', required: false },
        network: { datatype: 'boolean', required: false },
        logsRoute: { datatype: 'boolean', required: false },
        containsFilter: { datatype: 'boolean', required: false },
        editDocumentsByFunction: { datatype: 'boolean', required: false },
      },
    },
  })
  async updateExperimentalFeatures(req: Request<{ body: { metrics?: boolean, logsRoute?: boolean, containsFilter?: boolean, editDocumentsByFunction?: boolean, network?: boolean } }>, res: Response) {
    const { metrics = false, logsRoute = false, containsFilter = false, editDocumentsByFunction = false, network = false } = req.body;
    const engine = this.getMeiliEngine();
    const task = await engine.setExperimentalFeaturesStatus({
      metrics,
      network,
      logsRoute,
      containsFilter,
      editDocumentsByFunction,
    });
    return res.json(task);
  }

  @Get('/version')
  async getVersion(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const version = await engine.getVersion();
    return res.json(version);
  }

  @Get('/health')
  async getHealth(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const health = await engine.health();
    return res.json(health);
  }

  @Get('/is-healthy')
  async isHealthy(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const isHealthy = await engine.isHealthy();
    return res.json({ isHealthy });
  }

  @Post('/dumps')
  async createDump(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const task = await engine.createDump();
    return res.json(task);
  }

  @Post('/snapshots')
  async createSnapshot(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const task = await engine.createSnapshot();
    return res.json(task);
  }

  @Post('/indices/swap', {
    validations: {
      body: {
        swaps: { datatype: 'array', required: true },
      },
    },
  })
  async swapIndices(req: Request<{ body: { swaps: [ string, string ][] } }>, res: Response) {
    const { swaps } = req.body;
    // Invalid swap payload. Expected { swaps: [["indexA", "indexB"]] }

    const engine = this.getMeiliEngine();
    const task = await engine.swapIndexes(
      swaps.map(pair => ({ indexes: pair })),
      true
    );
    return res.json(task);
  }

  @Post('/multi-search', {
    validations: {
      body: {
        queries: { datatype: 'array', required: true },
      },
    },
  })
  async multiSearch(
    req: Request<{ body: { queries: any[] } }>,
    res: Response
  ) {
    const { queries } = req.body;
    const engine = this.getMeiliEngine();
    const results = await engine.multiSearch(queries);
    return res.json(results);
  }

  @Get('/index-documents/{indexName}')
  async getIndexDocuments(
    req: Request<{ path: { indexName: string }, query: DocumentsQuery<any> }>,
    res: Response
  ) {

    const { indexName } = req.pathParameters;
    const options = req.queryStringParameters;
    const engine = this.getMeiliEngine();

    const documents = await engine.getDocuments(indexName, options);

    return res.json({ documents });
  }

  @Get('/tasks')
  async getTasks(req: Request<{ query: TasksOrBatchesQuery }>, res: Response) {
    const engine = this.getMeiliEngine();
    const tasks = await engine.getClient().tasks.getTasks(req.queryStringParameters);
    return res.json({ tasks });
  }

  @Get('/tasks/{taskId}')
  async getTask(req: Request<{ path: { taskId: number } }>, res: Response) {
    const { taskId } = req.pathParameters ?? {};

    const engine = this.getMeiliEngine();
    const task = await engine.waitForTask(Number(taskId));

    return res.json(task);
  }

  @Post('/tasks/cancel')
  async cancelTasks(req: Request<{ body: DeleteOrCancelTasksQuery }>, res: Response) {
    const query = req.body;
    const engine = this.getMeiliEngine();
    const task = await engine.cancelTasks(query);
    return res.json(task);
  }

  @Delete('/tasks')
  async deleteTasks(req: Request<{ body: DeleteOrCancelTasksQuery }>, res: Response) {
    const query = req.body;
    const engine = this.getMeiliEngine();
    const task = await engine.deleteTasks(query);
    return res.json(task);
  }

  @Get('/api-keys')
  async getKeys(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const keys = await engine.getKeys();
    return res.json(keys);
  }

  @Get('/api-keys/{keyOrUid}')
  async getKey(req: Request<{ path: { keyOrUid: string } }>, res: Response) {
    const { keyOrUid } = req.pathParameters;
    const engine = this.getMeiliEngine();
    const key = await engine.getKey(keyOrUid);
    return res.json(key);
  }

  @Post('/api-keys', {
    validations: {
      body: {
        name: { datatype: 'string', required: true },
        description: { datatype: 'string' },
        actions: { datatype: 'array', required: true },
        indexes: { datatype: 'array', required: true },
        expiresAt: { datatype: 'string', required: true },
      },
    },
  })
  async createKey(req: Request<{ body: any }>, res: Response) {
    const options = req.body;
    const engine = this.getMeiliEngine();

    const key = await engine.createKey({
      ...options,
      expiresAt: options.expiresAt ? new Date(options.expiresAt) : undefined
    });

    return res.json(key);
  }

  @Put('/api-keys/{keyOrUid}')
  async updateKey(
    req: Request<{
      path: { keyOrUid: string };
      body: {
        name?: string;
        description?: string;
      }
    }>,
    res: Response
  ) {
    const { keyOrUid } = req.pathParameters;
    const options = req.body;
    const engine = this.getMeiliEngine();
    const key = await engine.updateKey(keyOrUid, options);
    return res.json(key);
  }

  @Delete('/api-keys/{keyOrUid}')
  async deleteKey(req: Request<{ path: { keyOrUid: string } }>, res: Response) {
    const { keyOrUid } = req.pathParameters;
    const engine = this.getMeiliEngine();
    await engine.deleteKey(keyOrUid);
    return res.status(204).json({
      message: 'Key deleted successfully',
    });
  }
}
