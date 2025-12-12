import type { ExecutionContext } from '../../core/types/execution-context';
import type { BaseEntityService, EntityRecordTypeFromSchema, EntitySchema } from '../../entity';
import type { BaseSearchEngine } from '../engines';
import type { EntitySearchQuery, SearchResult } from '../types';
import { BaseSearchService } from './base-search-service';
export declare class EntitySearchService<S extends EntitySchema<any, any, any>> extends BaseSearchService {
    protected readonly entityService: BaseEntityService<S>;
    protected readonly searchEngine: BaseSearchEngine;
    constructor(entityService: BaseEntityService<S>, searchEngine: BaseSearchEngine);
    protected getEntitySearchConfig(): {
        enabled: boolean;
        indexConfig?: import("../types").SearchIndexConfig;
        serviceClass?: import("../../interfaces").DepIdentifier<EntitySearchService<any>> | typeof EntitySearchService | EntitySearchService<any>;
        documentTransformer?: ((entity: import("electrodb").ResponseItem<any, any, any, EntitySchema<any, any, any, {
            readonly get: "get";
            readonly list: "list";
            readonly query: "query";
            readonly create: "create";
            readonly upsert: "upsert";
            readonly update: "update";
            readonly delete: "delete";
            readonly duplicate: "duplicate";
        }>>) => Promise<Record<string, any>>) | undefined;
    };
    getSearchIndexConfig(): import("../types").SearchIndexConfig;
    search(query: EntitySearchQuery<S>, searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext): Promise<SearchResult<any>>;
    syncToIndex(entity: EntityRecordTypeFromSchema<S>, searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    deleteFromIndex(entityId: string, searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    bulkSync(entities: EntityRecordTypeFromSchema<S>[], searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>>;
    /**
     * Resync all entity documents from database to search index
     * Uses cursor-based pagination to handle large datasets efficiently
     */
    resyncAllDocuments(options?: {
        batchSize?: number;
        ctx?: ExecutionContext;
    }): Promise<{
        processedCount: number;
        failedCount: number;
        totalIterations: number;
    }>;
}
