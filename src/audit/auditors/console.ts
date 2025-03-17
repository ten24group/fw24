import { createLogger } from '../../logging';
import { AuditorConfig, AuditOptions, IAuditor } from '../interfaces';

export class ConsoleAuditor implements IAuditor {
    private logger = createLogger('ConsoleAuditor');
    private enabled: boolean;

    constructor(config?: AuditorConfig) {
        this.enabled = config?.enabled ?? false;
    }

    async audit(options: AuditOptions): Promise<void> {
        // If explicitly disabled for this operation or globally disabled, skip logging
        if (options.enabled === false || this.enabled === false) {
            return;
        }

        const auditEntry = {
            timestamp: new Date().toISOString(),
            ...options
        };
        this.logger.info('Audit Log:', auditEntry);
    }
} 