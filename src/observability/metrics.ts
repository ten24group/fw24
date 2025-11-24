import { randomUUID } from 'crypto';
import { ObservabilityManager } from './manager';
import type { ObservabilityEvent } from './types';

export interface RecordMetricOptions {
  name: string;
  value: number;
  unit?: string;
  type?: 'counter' | 'gauge' | 'histogram';
  level?: ObservabilityEvent['level'];
  attributes?: Record<string, any>;
  traceId?: string;
}

export const recordMetric = (options: RecordMetricOptions): void => {
  const metricId = randomUUID();
  ObservabilityManager.capture({
    type: 'metric',
    level: options.level ?? 'info',
    correlationId: options.traceId ?? randomUUID(),
    entityName: 'metric',
    entityId: metricId,
    timestampMs: Date.now(),
    operation: options.name,
    metrics: {
      [options.name]: options.value,
    },
    attributes: {
      unit: options.unit,
      metricType: options.type ?? 'gauge',
      ...options.attributes,
    },
  });
};

