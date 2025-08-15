import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';
export declare class ConsoleAuditLogger implements IAuditLogger {
    private logger;
    private enabled;
    constructor(config?: AuditLoggerConfig);
    audit(options: AuditOptions): Promise<void>;
}
