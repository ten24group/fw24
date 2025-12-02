/**
 * Storage Layer
 *
 * Entity schema and service for observability data.
 * Service is self-contained - creates its own DynamoDB client.
 */
export { ObservabilityLogEntitySchema, ObservabilityLogSchema, getTtlDays, } from './log-entity';
export { ObservabilityLogService, ReconstructedSpan, LogRecord, } from './service';
