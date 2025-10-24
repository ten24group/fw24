import { ResourceIntent } from './types';
type QueueAccess = 'send' | 'receive' | 'delete';
type TableAccess = 'read' | 'write' | 'readwrite';
type BucketAccess = 'read' | 'write' | 'readwrite';
type TopicAccess = 'publish';
export declare function mapTableAccessToPermissions(access: TableAccess | undefined): Array<'read' | 'write'>;
export declare function mapBucketAccessToPermissions(access: BucketAccess | undefined): Array<'read' | 'write'>;
export declare function mapQueueAccessToPermissions(access: QueueAccess | undefined): Array<'publish' | 'subscribe'>;
export interface ResourceAccessConfig {
    tables?: Array<{
        name: string;
        access?: TableAccess[];
    } | string>;
    buckets?: Array<{
        name: string;
        access?: BucketAccess[];
    } | string>;
    topics?: Array<{
        name: string;
        access?: TopicAccess[];
    } | string>;
    queues?: Array<{
        name: string;
        access?: QueueAccess[];
    } | string>;
}
export declare function translateResourceAccessToIntents(resourceAccess: ResourceAccessConfig | undefined): ResourceIntent[];
export {};
