import { Controller, Delete, Get, Post, Put } from '../../decorators';
import { Request, Response } from '../../interfaces';
import { SearchSystemController } from './search-controller';
import { MeiliSearchEngine } from '../engines';
import { SearchEngineError } from '../errors';
import { BaseEntityService } from '../../entity/base-service';
import { DeleteOrCancelTasksQuery, DocumentsQuery, TasksOrBatchesQuery } from 'meilisearch';
import { safeParseInt } from '../../utils/parse';
import { parseUrlQueryStringParameters, queryStringParamsToFilterGroup } from '../../entity/query';

// Helper function to convert cursor-based pagination to offset
function parseCursorPagination(req: Request) {
  const data = req.queryStringParameters;
  const { cursor, count="100", limit="250", ...rest } = data || {};
  
  let offset = null;
  if (cursor) {
    try {
      const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
      offset = cursorData.offset;
    } catch (error) {
      // Invalid cursor, start from beginning
    }
  }
  
  // Use count as primary, limit as fallback (same as entity controller)
  const pageSize = safeParseInt(count, safeParseInt(limit, 250).value).value;
  
  return {
    offset,
    limit: pageSize,
    rest
  };
}

// Helper function to create next cursor
function createNextCursor(offset: number, limit: number, hasMore: boolean) {
  if (!hasMore) {
    return null;
  }
  const nextOffset = offset + limit;
  return Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64');
}

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

  @Get('/experimental-features')
  async getExperimentalFeatures(_req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const features = await engine.getExperimentalFeatures();
    return res.json(features);
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

    const documents = await engine.getDocuments(indexName, {
      // extract manually to avoid unwanted keys errors
      ids: options.ids,
      limit: options.limit,
      offset: options.offset,
      filter: options.filter,
      fields: options.fields,
      retrieveVectors: options.retrieveVectors,
    });

    return res.json({ documents });
  }

  @Get('/tasks')
  async getTasks(req: Request<{ query: TasksOrBatchesQuery }>, res: Response) {
    const engine = this.getMeiliEngine();
    const { offset, limit, rest } = parseCursorPagination(req);

    // Use the same query parsing as entity controller
    const parsedQueryParams = parseUrlQueryStringParameters(rest);
    const filterGroup = queryStringParamsToFilterGroup(parsedQueryParams);

    // Convert filter group to MeiliSearch parameters
    const meiliParams: TasksOrBatchesQuery = {
      limit,
      from: offset,
      reverse: false, // Get tasks in descending order (newest first)
    };

    // Extract MeiliSearch parameters from filter group
    if (filterGroup.and) {
      filterGroup.and.forEach(filter => {
        if (filter.attribute === 'type' && filter.eq) {
          meiliParams.types = filter.eq as any;
        } else if (filter.attribute === 'type' && filter.in) {
          meiliParams.types = filter.in as any;
        } else if (filter.attribute === 'status' && filter.eq) {
          meiliParams.statuses = filter.eq as any;
        } else if (filter.attribute === 'status' && filter.in) {
          meiliParams.statuses = filter.in as any;
        } else if (filter.attribute === 'uid' && filter.eq) {
          meiliParams.uids = [filter.eq as number];
        } else if (filter.attribute === 'uid' && filter.in) {
          meiliParams.uids = filter.in as number[];
        } else if (filter.attribute === 'indexUid' && filter.eq) {
          meiliParams.indexUids = [filter.eq as string];
        } else if (filter.attribute === 'indexUid' && filter.in) {
          meiliParams.indexUids = filter.in as string[];
        } else if (filter.attribute === 'enqueuedAt' && filter.lt) {
          meiliParams.beforeEnqueuedAt = new Date(filter.lt).toISOString();
        } else if (filter.attribute === 'enqueuedAt' && filter.gt) {
          meiliParams.afterEnqueuedAt = new Date(filter.gt).toISOString();
        } else if (filter.attribute === 'startedAt' && filter.lt) {
          meiliParams.beforeStartedAt = new Date(filter.lt).toISOString();
        } else if (filter.attribute === 'startedAt' && filter.gt) {
          meiliParams.afterStartedAt = new Date(filter.gt).toISOString();
        } else if (filter.attribute === 'finishedAt' && filter.lt) {
          meiliParams.beforeFinishedAt = new Date(filter.lt).toISOString();
        } else if (filter.attribute === 'finishedAt' && filter.gt) {
          meiliParams.afterFinishedAt = new Date(filter.gt).toISOString();
        } else if (filter.attribute === 'canceledBy' && filter.eq) {
          meiliParams.canceledBy = [filter.eq as number];
        } else if (filter.attribute === 'batchUid' && filter.eq) {
          meiliParams.batchUids = [filter.eq as number];
        } else if (filter.attribute === 'batchUid' && filter.in) {
          meiliParams.batchUids = filter.in as number[];
        }
      });
    }

    const tasks = await engine.getClient().tasks.getTasks(meiliParams);
    
    // Use MeiliSearch's next value for cursor, or create our own if not available
    let nextCursor = null;
    if (tasks.next) {
      // MeiliSearch provides the next offset
      nextCursor = Buffer.from(JSON.stringify({ offset: tasks.next })).toString('base64');
    }
    
    return res.json({
      cursor: nextCursor,
      items: tasks.results
    });
  }

  @Get('/tasks/{taskId}')
  async getTask(req: Request<{ path: { taskId: number } }>, res: Response) {
    const { taskId } = req.pathParameters ?? {};

    const engine = this.getMeiliEngine();
    const task = await engine.waitForTask(Number(taskId));

    return res.json(task);
  }

  @Get('/tasks/{taskId}/cancel')
  async cancelTask(req: Request<{ path: { taskId: string } }>, res: Response) {
    const { taskId } = req.pathParameters;
    const engine = this.getMeiliEngine();
    const task = await engine.cancelTasks({ uids: [ Number(taskId) ] });
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

  @Delete('/tasks/{taskId}')
  async deleteTask(req: Request<{ path: { taskId: string } }>, res: Response) {
    const { taskId } = req.pathParameters;
    const engine = this.getMeiliEngine();
    const task = await engine.deleteTasks({ uids: [ Number(taskId) ] });
    return res.json(task);
  }

  @Get('/api-keys')
  async getKeys(req: Request, res: Response) {
    const engine = this.getMeiliEngine();
    const { offset, limit, rest } = parseCursorPagination(req);

    // Use the same query parsing as entity controller
    const parsedQueryParams = parseUrlQueryStringParameters(rest);
    const filterGroup = queryStringParamsToFilterGroup(parsedQueryParams);

    const allKeys = await engine.getKeys();
    let keysArray = (allKeys as any).results || allKeys;
    
    // Apply filters from filter group
    if (filterGroup.and) {
      filterGroup.and.forEach(filter => {
        if (filter.attribute === 'name' && filter.eq) {
          keysArray = keysArray.filter((key: any) => 
            key.name?.toLowerCase().includes((filter.eq as string).toLowerCase())
          );
        } else if (filter.attribute === 'name' && filter.contains) {
          keysArray = keysArray.filter((key: any) => 
            key.name?.toLowerCase().includes((filter.contains as string).toLowerCase())
          );
        } else if (filter.attribute === 'actions' && filter.in) {
          keysArray = keysArray.filter((key: any) => 
            key.actions?.some((action: any) => (filter.in as string[]).includes(action))
          );
        } else if (filter.attribute === 'indexes' && filter.in) {
          keysArray = keysArray.filter((key: any) => 
            key.indexes?.some((index: any) => (filter.in as string[]).includes(index))
          );
        }
      });
    }
    
    const paginatedKeys = keysArray.slice(offset, offset + limit);
    const nextCursor = createNextCursor(offset, limit, offset + limit < keysArray.length);
    
    return res.json({
      cursor: nextCursor,
      items: paginatedKeys
    });
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
        name: { required: true },
        actions: { required: true },
        indexes: { required: true },
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
    return res.status(200).json({
      message: 'Key deleted successfully',
    });
  }
}
