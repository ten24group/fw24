import { DynamoDBStreamAuditLogger } from '../loggers/dynamo-db-stream-audit-logger';

/**
 * Default audit handler export for framework usage
 * Uses the DefaultAuditHandler that extends AbstractLambdaHandler
 */
export const handler = DynamoDBStreamAuditLogger.CreateHandler(DynamoDBStreamAuditLogger);
