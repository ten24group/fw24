import { ExecutionContext } from '../core/types/execution-context';
/**
 * Simple audit helper that auto-extracts context from ExecutionContext
 */
export declare function captureAuditLog(options: {
    eventType: string;
    entityName?: string;
    severity?: 'info' | 'warn' | 'error' | 'critical';
    success?: boolean;
    timestamp?: string;
    ctx?: ExecutionContext;
    data?: Record<string, any>;
    entity?: any;
    identifiers?: Record<string, any>;
}): Promise<void>;
