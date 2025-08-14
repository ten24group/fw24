import { createLogger } from '../../logging';
import { resolveEnvValueFor } from '../../utils';
import { AUDIT_ENV_KEYS, AuditLoggerConfig, AuditLoggerType, IAuditLogger } from '../interfaces';
import { CloudWatchAuditLogger } from './cloudwatch';
import { ConsoleAuditLogger } from './console';
import { DummyAuditLogger } from './dummy';
import { DynamoDbAuditLogger } from './dynamodb';

export class AuditLoggerFactory {
    private static instance: AuditLoggerFactory;
    private auditLoggerCache: Map<string, IAuditLogger> = new Map();
    private logger = createLogger(AuditLoggerFactory);
    private constructor() { }

    public static getInstance(): AuditLoggerFactory {
        if (!AuditLoggerFactory.instance) {
            AuditLoggerFactory.instance = new AuditLoggerFactory();
        }
        return AuditLoggerFactory.instance;
    }

    /**
     * Get the default auditor configuration based on environment variables
     */
    private getDefaultConfig(): AuditLoggerConfig {
        const envType = resolveEnvValueFor({ key: AUDIT_ENV_KEYS.TYPE }) || AuditLoggerType.CLOUDWATCH;

        return {
            enabled: resolveEnvValueFor({ key: AUDIT_ENV_KEYS.ENABLED }) === 'true',
            type: envType as AuditLoggerType,
            logGroupName: resolveEnvValueFor({ key: AUDIT_ENV_KEYS.LOG_GROUP_NAME }),
            region: resolveEnvValueFor({ key: AUDIT_ENV_KEYS.REGION }),
        };
    }

    /**
     * Create an auditor instance. If no configuration is provided, uses environment variables.
     * If no environment variables are set, defaults to console auditor.
     */
    public create(config?: AuditLoggerConfig): IAuditLogger {

        const effectiveConfig = {
            ...this.getDefaultConfig(),
            ...config
        };

        // Return cached instance if available
        const cacheKey = this.getCacheKey(effectiveConfig);
        if (this.auditLoggerCache.has(cacheKey)) {
            return this.auditLoggerCache.get(cacheKey)!;
        }

        this.logger.debug('Creating audit logger', effectiveConfig);

        let auditLogger: IAuditLogger;

        // If auditing is disabled, return dummy auditor
        switch (effectiveConfig.type) {
            case AuditLoggerType.DYNAMODB:
                auditLogger = new DynamoDbAuditLogger(effectiveConfig);
                break;
            case AuditLoggerType.CONSOLE:
                auditLogger = new ConsoleAuditLogger(effectiveConfig);
                break;
            case AuditLoggerType.DUMMY:
                auditLogger = new DummyAuditLogger();
                break;
            case AuditLoggerType.CLOUDWATCH:
            default:
                auditLogger = new CloudWatchAuditLogger(effectiveConfig);
                break;
        }

        // Cache the instance
        this.auditLoggerCache.set(cacheKey, auditLogger);
        return auditLogger;
    }

    private getCacheKey(config: AuditLoggerConfig): string {
        return `${config.type}`;
    }
}