/**
 * Storage Layer
 * 
 * Entity schema and service for observability data.
 * Apps extend BaseEntityController<ObservabilityLogSchema> directly for admin UIs.
 */

export { 
  ObservabilityLogEntitySchema, 
  ObservabilityLogSchema,
  ObservabilityLogEntityType,
  ObservabilityLogRecordType,
} from './observability-log-entity';

export { 
  ObservabilityLogService,
  ReconstructedSpan,
  LogRecord,
  ObservabilityLogCreateItem,
} from './service';
