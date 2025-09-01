export {
  AuditLoggerType,
  AuditLoggerConfig,
  AuditOptions,
  AuditEntry,
  IAuditLogger,
} from './interfaces';

export {
  DynamoDbAuditLogger,
  CloudWatchAuditLogger,
  AuditLoggerFactory,
  ConsoleAuditLogger,
  DummyAuditLogger,
  DefaultAuditHandler,
  DynamoDBAuditEntitySchema,
  getChangedProperties,
  AUDIT_ENV_KEYS,
} from './loggers';

export {
  DynamoDBAuditEntityService,
} from './system/audit-entity-service';

export {
  captureLog,
  captureError,
} from './helpers/audit-helpers';

export type { CaptureLogOptions } from './helpers/audit-helpers';

export {
  type AuditConfig,
  type AuditContext,
  type CorrelationContext,
  type RequestAuditContext,
  type QueueAuditContext,
  type TaskAuditContext,
  type SamplingFunction
} from './interfaces';

export {
  createHashBasedSampling,
  createRandomSampling,
  createAlwaysSample,
  createNeverSample
} from './helpers/sampling';

export {
  protectAuditData,
  createRedactConfig
} from './helpers/data-protection';

export type { DataProtectionConfig, DeepRedactConfig } from './helpers/data-protection';

export {
  AuditCustomPageConfigs
} from './system/ui-config';

export {
  DynamoDBAuditSystemController,
} from './system/audit-controller';