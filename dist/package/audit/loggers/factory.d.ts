import { AuditLoggerConfig, IAuditLogger } from '../interfaces';
export declare class AuditLoggerFactory {
    private static instance;
    private auditLoggerCache;
    private logger;
    private constructor();
    static getInstance(): AuditLoggerFactory;
    /**
     * Get the default auditor configuration based on environment variables
     */
    private getDefaultConfig;
    /**
     * Create an auditor instance. If no configuration is provided, uses environment variables.
     * If no environment variables are set, defaults to console auditor.
     */
    create(config?: AuditLoggerConfig): IAuditLogger;
    private getCacheKey;
}
