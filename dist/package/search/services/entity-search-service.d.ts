import { BaseSearchService } from './base-search-service';
import { EntitySchema, EntityRecordTypeFromSchema, BaseEntityService } from '../../entity';
import { SearchResult, EntitySearchQuery } from '../types';
import { SearchIndexConfig } from '../types';
import { ExecutionContext } from '../../core/types/execution-context';
import { BaseSearchEngine } from '../engines';
export declare class EntitySearchService<S extends EntitySchema<any, any, any>> extends BaseSearchService {
    protected readonly entityService: BaseEntityService<S>;
    protected readonly searchEngine: BaseSearchEngine;
    constructor(entityService: BaseEntityService<S>, searchEngine: BaseSearchEngine);
    protected getEntitySearchConfig(): {
        enabled: boolean;
        indexConfig?: SearchIndexConfig;
        serviceClass?: import("../../interfaces").DepIdentifier<EntitySearchService<any>> | typeof EntitySearchService | EntitySearchService<any>;
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
    getSearchIndexConfig(): SearchIndexConfig;
    search(query: EntitySearchQuery<S>, searchIndexConfig?: SearchIndexConfig, ctx?: ExecutionContext): Promise<SearchResult<any>>;
    syncToIndex(entity: EntityRecordTypeFromSchema<S>, searchIndexConfig?: SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    deleteFromIndex(entityId: string, searchIndexConfig?: SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    bulkSync(entities: EntityRecordTypeFromSchema<S>[], searchIndexConfig?: SearchIndexConfig, ctx?: ExecutionContext, synchronous?: boolean): Promise<void>;
    transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>>;
}
