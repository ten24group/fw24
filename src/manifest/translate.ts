import { ResourceIntent } from './types';

type QueueAccess = 'send' | 'receive' | 'delete';
type TableAccess = 'read' | 'write' | 'readwrite';
type BucketAccess = 'read' | 'write' | 'readwrite';
type TopicAccess = 'publish';

export function mapTableAccessToPermissions(access: TableAccess | undefined): Array<'read' | 'write'> {
  if (!access) return ['read', 'write'];
  if (access === 'readwrite') return ['read', 'write'];
  if (access === 'read') return ['read'];
  if (access === 'write') return ['write'];
  return ['read', 'write'];
}

export function mapBucketAccessToPermissions(access: BucketAccess | undefined): Array<'read' | 'write'> {
  return mapTableAccessToPermissions(access as any);
}

export function mapQueueAccessToPermissions(access: QueueAccess | undefined): Array<'publish' | 'subscribe'> {
  if (!access) return ['publish'];
  switch (access) {
    case 'send':
      return ['publish'];
    case 'receive':
    case 'delete':
      return ['subscribe'];
    default:
      return ['publish'];
  }
}

export interface ResourceAccessConfig {
  tables?: Array<{ name: string; access?: TableAccess[] } | string>;
  buckets?: Array<{ name: string; access?: BucketAccess[] } | string>;
  topics?: Array<{ name: string; access?: TopicAccess[] } | string>;
  queues?: Array<{ name: string; access?: QueueAccess[] } | string>;
}

export function translateResourceAccessToIntents(resourceAccess: ResourceAccessConfig | undefined): ResourceIntent[] {
  const intents: ResourceIntent[] = [];
  if (!resourceAccess) return intents;

  for (const table of resourceAccess.tables || []) {
    const name = typeof table === 'string' ? table : table.name;
    const access = typeof table === 'string' ? ['readwrite'] as TableAccess[] : (table.access || ['readwrite']);
    const perms = new Set<'read' | 'write'>();
    access.forEach(a => mapTableAccessToPermissions(a).forEach(p => perms.add(p)));
    intents.push({ kind: 'table', name, permissions: Array.from(perms) });
  }

  for (const bucket of resourceAccess.buckets || []) {
    const name = typeof bucket === 'string' ? bucket : bucket.name;
    const access = typeof bucket === 'string' ? ['readwrite'] as BucketAccess[] : (bucket.access || ['readwrite']);
    const perms = new Set<'read' | 'write'>();
    access.forEach(a => mapBucketAccessToPermissions(a).forEach(p => perms.add(p)));
    intents.push({ kind: 'bucket', name, permissions: Array.from(perms) });
  }

  for (const topic of resourceAccess.topics || []) {
    const name = typeof topic === 'string' ? topic : topic.name;
    const access = typeof topic === 'string' ? ['publish'] as TopicAccess[] : (topic.access || ['publish']);
    const perms = new Set<'publish'>();
    access.forEach(_ => perms.add('publish'));
    intents.push({ kind: 'topic', name, permissions: Array.from(perms) });
  }

  for (const queue of resourceAccess.queues || []) {
    const name = typeof queue === 'string' ? queue : queue.name;
    const access = typeof queue === 'string' ? ['send'] as QueueAccess[] : (queue.access || ['send']);
    const perms = new Set<'publish' | 'subscribe'>();
    access.forEach(a => mapQueueAccessToPermissions(a).forEach(p => perms.add(p)));
    intents.push({ kind: 'queue', name, permissions: Array.from(perms) });
  }

  return intents;
}


