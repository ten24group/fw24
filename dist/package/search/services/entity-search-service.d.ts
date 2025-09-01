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
        serviceClass?: import("../../fw24").DepIdentifier<EntitySearchService<any>> | typeof EntitySearchService | EntitySearchService<any>;
        documentTransformer?: ((entity: import("electrodb").ResponseItem<any, any, any, EntitySchema<any, any, any, {
            get: string;
            list: string;
            query: string;
            create: string;
            upsert: string;
            update: string;
            delete: string;
            duplicate: string;
        }>>) => Promise<Record<string, any>>) | undefined;
    };
    getSearchIndexConfig(): import("../types").SearchIndexConfig;
    search(query: EntitySearchQuery<S>, searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext): Promise<SearchResult<any>>;
    syncToIndex(entity: EntityRecordTypeFromSchema<S>, searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    deleteFromIndex(entityId: string, searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    bulkSync(entities: EntityRecordTypeFromSchema<S>[], searchIndexConfig?: import("../types").SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>>;
}
