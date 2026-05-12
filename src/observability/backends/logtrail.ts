/**
 * Ships observability events to Logtrail’s Vector HTTP source (same contract as tslog logging).
 */

import { Injectable, InjectConfig } from '../../di';
import { shipLogtrailVectorJson } from '../../logging/logtrail';
import type { ObservabilityBackend, ObservabilityBackendConfig, ObservabilityEvent } from '../types';
import { ObservabilityLevel } from '../types';
import { safeSerialize } from '../utils/payload';

@Injectable({
  provide: 'ObservabilityBackend',
  providedIn: 'ROOT',
  tags: [ 'observability', 'backend', 'logtrail' ],
})
export class LogtrailObservabilityBackend implements ObservabilityBackend {
  public readonly name = 'logtrail' as const;
  public readonly minLevel?: ObservabilityLevel;

  private serviceLabelOverride: string | undefined;

  constructor(
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel,
  ) {
    this.minLevel = minLevel;
  }

  configureFromBackendEntry(entry: ObservabilityBackendConfig): void {
    if (entry.type !== 'logtrail') return;
    const s = entry.config?.service?.trim();
    this.serviceLabelOverride = s || undefined;
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    if (event.type === 'span.start') {
      return;
    }

    const levelStr = event.level.toLowerCase();

    try {
      const payload = safeSerialize(event, { maxLength: 256 * 1024 });
      const message = typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);

      shipLogtrailVectorJson({
        level: levelStr,
        message,
        ...(this.serviceLabelOverride ? { service: this.serviceLabelOverride } : {}),
      });
    } catch {
      shipLogtrailVectorJson({
        level: levelStr || 'info',
        message: JSON.stringify({ _fw24: 'observability_serialize_failed', type: event.type }),
        ...(this.serviceLabelOverride ? { service: this.serviceLabelOverride } : {}),
      });
    }
  }
}
