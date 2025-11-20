import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { APIController } from '../../core/runtime/api-gateway-controller';
import type { ExecutionContext } from "../../core/types/execution-context";
import { type BaseEntityService } from '../../entity';
import { type IDIContainer, type Request, type Response } from '../../interfaces';
export declare enum SEARCH_CONTROLLER_ENV_KEYS {
    MEILISEARCH_SYNC_QUEUE_NAME = "MEILISEARCH_SYNC_QUEUE_NAME"
}
export declare class SearchSystemController extends APIController {
    protected container: IDIContainer;
    constructor(container: IDIContainer);
    initialize(_event: APIGatewayProxyEvent, _context: Context): Promise<void>;
    listIndices(_request: Request, response: Response): Promise<Response>;
    /**
     * Add new api to get index details
     *
     */
    getIndexDetails(req: Request<{
        path: {
            entityName: string;
        };
    }>, res: Response): Promise<Response>;
    getSearchEntities(_request: Request, response: Response): Promise<Response>;
    getSingleDocument(req: Request<{
        path: {
            entityName: string;
            documentId: string;
        };
    }>, res: Response): Promise<Response>;
    getEntityRecords(req: Request<{
        path: {
            entityName: string;
        };
        queryStringParameters?: Record<string, any>;
    }>, res: Response, ctx?: ExecutionContext): Promise<Response>;
    initSearchIndices(req: Request<{
        body: {
            entities?: string[];
        };
    }>, res: Response): Promise<Response>;
    getIndexSettings(req: Request<{
        path: {
            entityName: string;
        };
    }>, res: Response): Promise<Response>;
    updateIndexSettings(req: Request<{
        path: {
            entityName: string;
        };
        body: {
            settings: Record<string, any>;
        };
    }>, res: Response): Promise<Response>;
    resetIndexSettings(req: Request<{
        path: {
            entityName: string;
        };
    }>, res: Response): Promise<Response>;
    initSingleEntityIndex(req: Request<{
        path: {
            entityName: string;
        };
    }>, res: Response): Promise<Response>;
    recreateIndex(req: Request<{
        path: {
            entityName: string;
        };
        body: {
            resyncDocuments?: boolean;
            syncMethod?: 'direct' | 'queue';
            batchSize?: number;
            queueUrl?: string;
        };
    }>, res: Response): Promise<Response>;
    deleteIndex(req: Request<{
        path: {
            entityName: string;
        };
    }>, res: Response): Promise<Response>;
    clearEntityIndex(req: Request<{
        path: {
            entityName: string;
        };
    }>, res: Response): Promise<Response>;
    resyncEntityRecords(req: Request<{
        path: {
            entityName: string;
        };
        body: {
            batchSize?: number;
            queueUrl?: string;
            byBatch?: boolean;
        };
    }>, res: Response): Promise<Response>;
    /**
     * Queue documents for async resync via SQS
     * Shared logic used by resync and recreate endpoints
     */
    private queueDocumentsForResync;
    getQueueInfo(req: Request<{
        path: {
            queueUrl: string;
        };
    }>, res: Response): Promise<Response>;
    updateDocuments(req: Request<{
        path: {
            entityName: string;
        };
        body: {
            documents: any[];
        };
    }>, res: Response): Promise<Response>;
    deleteDocumentsByIds(req: Request<{
        path: {
            entityName: string;
        };
        body: {
            ids: string[];
        };
    }>, res: Response): Promise<Response>;
    deleteDocumentsByFilter(req: Request<{
        path: {
            entityName: string;
        };
        body: {
            filter: any;
        };
    }>, res: Response): Promise<Response>;
    protected getEntityService(entityName: string): BaseEntityService<any>;
    protected getEntitySearchService(entityName: string): import("..").EntitySearchService<any>;
}
