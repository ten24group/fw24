/**
 * Audit Module - DynamoDB Stream Entity Auditing ONLY
 * 
 * For request/event/metrics logging, use the observability module directly.
 */

// ============================================================================
// ENTITY FILTERING CONFIG
// ============================================================================

export { AUDIT_ENV_KEYS } from './interfaces';

// ============================================================================
// STREAM HANDLER
// ============================================================================

export {
    DynamoDBStreamAuditLogger,
    DynamoDBStreamAuditLogger as DefaultAuditHandler,
} from './loggers';

// ============================================================================
// CHANGE DETECTION UTILITIES
// ============================================================================

export {
    getChangedProperties,
    DEFAULT_IGNORED_FIELDS,
} from './helpers/change-detection';
