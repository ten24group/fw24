import { randomUUID } from 'crypto';
import { ObservabilityManager } from './manager';
import { ObservabilityEvent } from './types';

export interface LogOptions {
  level?: ObservabilityEvent['level'];
  message: string;
  entityName?: string;
  entityId?: string;
  operation?: string;
  data?: Record<string, any>;
  error?: Error;
  traceId?: string;
}

export const logEvent = (options: LogOptions): void => {
  const correlationId = options.traceId ?? randomUUID();
  const logId = randomUUID();
  void ObservabilityManager.capture({
    type: 'log',
    level: options.level ?? 'info',
    correlationId,
    entityName: options.entityName ?? 'log',
    entityId: options.entityId ?? logId,
    timestampMs: Date.now(),
    operation: options.operation ?? options.message,
    data: {
      message: options.message,
      ...options.data,
    },
    error: options.error
      ? {
          type: options.error.name,
          message: options.error.message,
          stack: options.error.stack,
        }
      : undefined,
  });
};

