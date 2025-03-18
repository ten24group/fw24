import { AuditorConfig, AuditLoggerType, IAuditor, AUDIT_ENV_KEYS } from '../interfaces';
import { ConsoleAuditor } from './console';
import { CloudWatchAuditor } from './cloudwatch';
import { DynamoDbAuditor } from './dynamodb';
import { DummyAuditor } from './dummy';
import { resolveEnvValueFor } from '../../utils';
import { createLogger } from '../../logging';

export class AuditorFactory {
    private static instance: AuditorFactory;
    private auditorCache: Map<string, IAuditor> = new Map();
    private logger = createLogger(AuditorFactory.name);
    private constructor() {}

    public static getInstance(): AuditorFactory {
        if (!AuditorFactory.instance) {
            AuditorFactory.instance = new AuditorFactory();
        }
        return AuditorFactory.instance;
    }

    /**
     * Get the default auditor configuration based on environment variables
     */
    private getDefaultConfig(): AuditorConfig {
        return {
            enabled: resolveEnvValueFor({ key: AUDIT_ENV_KEYS.ENABLED }) === 'true',
            type: (resolveEnvValueFor({ key: AUDIT_ENV_KEYS.TYPE }) as AuditLoggerType) || 'console',
            logGroupName: resolveEnvValueFor({ key: AUDIT_ENV_KEYS.LOG_GROUP_NAME }),
            region: resolveEnvValueFor({ key: AUDIT_ENV_KEYS.REGION }),
        };
    }

    /**
     * Create an auditor instance. If no configuration is provided, uses environment variables.
     * If no environment variables are set, defaults to console auditor.
     */
    public create(config?: AuditorConfig): IAuditor {

        const effectiveConfig = {
            ...this.getDefaultConfig(),
            ...config
        };

        this.logger.debug('Creating auditor', effectiveConfig);

        // Return cached instance if available
        const cacheKey = this.getCacheKey(effectiveConfig);
        if (this.auditorCache.has(cacheKey)) {
            return this.auditorCache.get(cacheKey)!;
        }

        let auditor: IAuditor;
        
        // If auditing is disabled, return dummy auditor
        if (!effectiveConfig.enabled) {
            auditor = new DummyAuditor();
        } else {
            switch (effectiveConfig.type) {
                case 'cloudwatch':
                    auditor = new CloudWatchAuditor(effectiveConfig);
                    break;
                case 'dynamodb':
                    auditor = new DynamoDbAuditor(effectiveConfig);
                    break;
                case 'custom':
                    throw new Error('Custom logger not implemented yet');
                case 'console':
                default:
                    auditor = new ConsoleAuditor(effectiveConfig);
                    break;
            }
        }

        // Cache the instance
        this.auditorCache.set(cacheKey, auditor);
        return auditor;
    }

    private getCacheKey(config: AuditorConfig): string {
        return `${config.type}`;
    }
}

export const Auditor = AuditorFactory.getInstance();
export const DefaultAuditor = Auditor.create();
export const NullAuditor = Auditor.create({ enabled: false, type: 'console' });