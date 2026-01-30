import { Request, Response } from '../../interfaces';
import { SearchSystemController } from './search-controller';
import { DeleteOrCancelTasksQuery, DocumentsQuery, TasksOrBatchesQuery } from 'meilisearch';
export declare class MeiliSearchSystemController extends SearchSystemController {
    private getMeiliEngine;
    getStats(req: Request, res: Response): Promise<Response>;
    updateExperimentalFeatures(req: Request<{
        body: {
            metrics?: boolean;
            logsRoute?: boolean;
            containsFilter?: boolean;
            editDocumentsByFunction?: boolean;
            network?: boolean;
        };
    }>, res: Response): Promise<Response>;
    getExperimentalFeatures(_req: Request, res: Response): Promise<Response>;
    getVersion(_req: Request, res: Response): Promise<Response>;
    getHealth(_req: Request, res: Response): Promise<Response>;
    isHealthy(_req: Request, res: Response): Promise<Response>;
    createDump(_req: Request, res: Response): Promise<Response>;
    createSnapshot(_req: Request, res: Response): Promise<Response>;
    swapIndices(req: Request<{
        body: {
            swaps: [string, string][];
        };
    }>, res: Response): Promise<Response>;
    multiSearch(req: Request<{
        body: {
            queries: any[];
        };
    }>, res: Response): Promise<Response>;
    getIndexDocuments(req: Request<{
        path: {
            indexName: string;
        };
        query: DocumentsQuery<any>;
    }>, res: Response): Promise<Response>;
    private entityNameToIndexName;
    getTasks(req: Request<{
        query: TasksOrBatchesQuery;
    }>, res: Response): Promise<Response>;
    getTask(req: Request<{
        path: {
            taskId: number;
        };
    }>, res: Response): Promise<Response>;
    cancelTask(req: Request<{
        path: {
            taskId: string;
        };
    }>, res: Response): Promise<Response>;
    cancelTasks(req: Request<{
        body: DeleteOrCancelTasksQuery;
    }>, res: Response): Promise<Response>;
    deleteTasks(req: Request<{
        body: DeleteOrCancelTasksQuery;
    }>, res: Response): Promise<Response>;
    deleteTask(req: Request<{
        path: {
            taskId: string;
        };
    }>, res: Response): Promise<Response>;
    getKeys(req: Request, res: Response): Promise<Response>;
    getBatches(req: Request<{
        query: TasksOrBatchesQuery;
    }>, res: Response): Promise<Response>;
    getBatch(req: Request<{
        path: {
            uid: number;
        };
    }>, res: Response): Promise<Response>;
    getKey(req: Request<{
        path: {
            keyOrUid: string;
        };
    }>, res: Response): Promise<Response>;
    createKey(req: Request<{
        body: any;
    }>, res: Response): Promise<Response>;
    updateKey(req: Request<{
        path: {
            keyOrUid: string;
        };
        body: {
            name?: string;
            description?: string;
        };
    }>, res: Response): Promise<Response>;
    deleteKey(req: Request<{
        path: {
            keyOrUid: string;
        };
    }>, res: Response): Promise<Response>;
}
