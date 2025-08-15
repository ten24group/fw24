import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';
export declare class CloudWatchAuditLogger implements IAuditLogger {
    private client;
    private logGroupName;
    private logger;
    private enabled;
    constructor(config: AuditLoggerConfig);
    audit(options: AuditOptions): Promise<void>;
    private addLogEvents;
}
