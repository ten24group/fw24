import { AuditorConfig, AuditLoggerType, IAuditor } from '../interfaces';
import { ConsoleAuditor } from './console';
import { CloudWatchAuditor } from './cloudwatch';
import { DynamoDbAuditor } from './dynamodb';
import { resolveEnvValueFor } from '../../utils';
import { DummyAuditor } from './dummy';

export class AuditorFactory {
    private static instance: AuditorFactory;
    private auditorCache: Map<string, IAuditor> = new Map();

    private constructor() {}

    public static getInstance(): AuditorFactory {
        if (!AuditorFactory.instance) {
            AuditorFactory.instance = new AuditorFactory();
        }
        return AuditorFactory.instance;
    }

    public create(): IAuditor {
        const enabled = resolveEnvValueFor({ key: 'AUDIT_ENABLED' }) === 'true';
        const type = resolveEnvValueFor({ key: 'AUDIT_TYPE' }) as AuditLoggerType || 'console';
        const logGroupName = resolveEnvValueFor({ key: 'AUDIT_CLOUDWATCH_LOG_GROUP' });
        const region = resolveEnvValueFor({ key: 'AUDIT_CLOUDWATCH_REGION' });

        const config: AuditorConfig = {
            enabled,
            type,
            logGroupName,
            region
        };

        const cacheKey = this.getCacheKey(config);
        if (this.auditorCache.has(cacheKey)) {
            return this.auditorCache.get(cacheKey)!;
        }

        let auditor: IAuditor;

        // if not enabled, return a dummy auditor
        if (!enabled) { 
            auditor = new DummyAuditor();
        } else {
            switch (type) {
                case 'cloudwatch':
                    auditor = new CloudWatchAuditor(config);
                break;
            case 'dynamodb':
                auditor = new DynamoDbAuditor(config);
                break;
            case 'console':
            default:
                auditor = new ConsoleAuditor(config);
                    break;
            }
        }

        this.auditorCache.set(cacheKey, auditor);
        return auditor;
    }

    private getCacheKey(config: AuditorConfig): string {
        return `${config.type}`;
    }
} 

export const Auditor = AuditorFactory.getInstance();
export const NullAuditor: IAuditor = new DummyAuditor();