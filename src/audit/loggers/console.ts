import { createLogger } from '../../logging';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';

export class ConsoleAuditLogger implements IAuditLogger {
  private logger = createLogger('ConsoleAuditLogger');
  private enabled: boolean;

  constructor(config?: AuditLoggerConfig) {
    this.enabled = config?.enabled ?? false;
  }

  async audit(options: AuditOptions): Promise<void> {
    // If explicitly disabled for this operation or globally disabled, skip logging
    if (options.enabled === false || this.enabled === false) {
      return;
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      ...options.auditEntry,
    };
    this.logger.info('Audit Log:', auditEntry);
  }
}
