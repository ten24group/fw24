export {
  DynamoDbAuditLogger,
  DynamoDBAuditEntitySchema as DefaultDynamoDBAuditEntitySchema,
  DynamoDBAuditEntityConfiguration as DefaultDynamoDBAuditEntityConfiguration,
} from './dynamodb';

export { CloudWatchAuditLogger } from './cloudwatch';

export { AuditLoggerFactory } from './factory';

export { ConsoleAuditLogger } from './console';

export { DummyAuditLogger } from './dummy';

export {
  DynamoDBStreamAuditLogger as DefaultAuditHandler,
  getChangedProperties,
} from './dynamo-db-stream-audit-logger';