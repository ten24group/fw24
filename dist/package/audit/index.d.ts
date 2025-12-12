/**
 * Audit Module - DynamoDB Stream Entity Auditing ONLY
 *
 * For request/event/metrics logging, use the observability module directly.
 */
export { AUDIT_ENV_KEYS } from './interfaces';
export { DynamoDBStreamAuditLogger, DynamoDBStreamAuditLogger as DefaultAuditHandler, } from './loggers';
export { getChangedProperties, DEFAULT_IGNORED_FIELDS, } from './helpers/change-detection';
