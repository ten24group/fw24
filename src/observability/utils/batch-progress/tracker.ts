import { ObserveMode, FailedItem, ProcessContext, BatchSummary, MetricStats } from '.';
import { LogObserver } from '../../observers';
import type { CaptureControl } from '../../types';

// ═══════════════════════════════════════════════════════════════════════════
// Smart Defaults
// ═══════════════════════════════════════════════════════════════════════════

/** Calculate progress interval */
export function calcProgressInterval(total: number, customInterval?: number): number {
  if (customInterval !== undefined) return customInterval;
  if (total <= 10) return 0; // No progress for tiny batches
  if (total <= 50) return 10;
  if (total <= 100) return 25;
  if (total <= 500) return 50;
  if (total <= 1000) return 100;
  return Math.max(100, Math.floor(total / 10)); // ~10% intervals for large batches
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Tracker
// ═══════════════════════════════════════════════════════════════════════════
export class Tracker {
  private readonly name: string;
  private readonly batchId: string;
  private readonly startTime = Date.now();
  private readonly observe: ObserveMode;
  private readonly tags?: Record<string, string>;
  private readonly sampleFirst: number;
  private readonly sampleRate: number;
  private readonly progressEvery: number;

  private total = 0;
  private succeeded = 0;
  private failed = 0;
  private skipped = 0;
  private processed = 0;

  private durations: number[] = [];
  private minDuration = Infinity;
  private maxDuration = 0;
  private slowestItemId?: string;

  private failedItems: FailedItem[] = [];
  private errorsByType = new Map<string, number>();

  private metrics = new Map<string, { sum: number; min: number; max: number; count: number; }>();
  private currentItemMetrics: Record<string, number> = {};

  constructor(config: {
    name: string;
    total: number;
    observe?: ObserveMode;
    tags?: Record<string, string>;
    sampleFirst?: number;
    sampleRate?: number;
    progressEvery?: number;
  }) {
    this.name = config.name;
    this.batchId = `${config.name}-${this.startTime}`;
    this.total = config.total;
    this.observe = config.observe ?? 'progress';
    this.tags = config.tags;
    this.sampleFirst = config.sampleFirst ?? 3;
    this.sampleRate = config.sampleRate ?? 0.02;
    this.progressEvery = calcProgressInterval(config.total, config.progressEvery);
  }

  addMetric(name: string, value: number): void {
    this.currentItemMetrics[ name ] = (this.currentItemMetrics[ name ] ?? 0) + value;
  }

  private flushMetrics(): void {
    for (const [ name, value ] of Object.entries(this.currentItemMetrics)) {
      const existing = this.metrics.get(name);
      if (existing) {
        existing.sum += value;
        existing.count++;
        existing.min = Math.min(existing.min, value);
        existing.max = Math.max(existing.max, value);
      } else {
        this.metrics.set(name, { sum: value, min: value, max: value, count: 1 });
      }
    }
    this.currentItemMetrics = {};
  }

  recordSuccess(durationMs: number, itemId?: string): void {
    this.processed++;
    this.succeeded++;
    this.durations.push(durationMs);

    if (durationMs > this.maxDuration) {
      this.maxDuration = durationMs;
      this.slowestItemId = itemId;
    }
    if (durationMs < this.minDuration) {
      this.minDuration = durationMs;
    }

    this.flushMetrics();
    this.maybeLogProgress();
  }

  recordFailure(durationMs: number, error: Error, itemId: string): void {
    this.processed++;
    this.failed++;
    this.durations.push(durationMs);

    const type = error.name || 'Error';
    this.errorsByType.set(type, (this.errorsByType.get(type) ?? 0) + 1);
    this.failedItems.push({ itemId, error: error.message, errorType: type });

    if (this.observe === 'all' || this.observe === 'errors') {
      LogObserver.error(`${this.name} failed`, {
        itemId,
        error: error.message,
        errorType: type,
        progress: `${this.processed}/${this.total}`,
      }, { tags: this.tags });
    }

    this.flushMetrics();
    this.maybeLogProgress();
  }

  recordSkipped(): void {
    this.processed++;
    this.skipped++;
    this.maybeLogProgress();
  }

  getFailedCount(): number {
    return this.failed;
  }

  /**
   * Get capture control for per-item logging.
   * Always returns group sampling config - decoupled from observe mode.
   * This allows users to control per-item log sampling independently.
   */
  getCaptureControl(): CaptureControl {
    return {
      group: {
        key: this.batchId,
        index: this.processed,
        total: this.total,
        captureFirst: this.sampleFirst,
        sampleRate: this.sampleRate,
      },
    };
  }

  /** Get batch ID */
  getBatchId(): string {
    return this.batchId;
  }

  createContext(itemIndex: number): ProcessContext {
    return {
      getCaptureControl: () => this.getCaptureControl(),
      addMetric: (name, value) => this.addMetric(name, value),
      itemIndex,
      total: this.total,
      batchId: this.batchId,
    };
  }

  private maybeLogProgress(): void {
    if (this.observe === 'none' || this.observe === 'errors' || this.observe === 'summary') return;
    if (this.progressEvery === 0) return;
    if (this.processed % this.progressEvery !== 0) return;

    const elapsed = Date.now() - this.startTime;
    const rate = elapsed > 0 ? (this.processed / elapsed) * 1000 : 0;
    const percent = Math.round((this.processed / this.total) * 100);
    const eta = rate > 0 ? Math.round((this.total - this.processed) / rate) : undefined;

    LogObserver.debug(`${this.name} ${percent}%`, {
      done: this.processed,
      total: this.total,
      ok: this.succeeded,
      fail: this.failed,
      rate: Math.round(rate),
      ...(eta ? { etaSec: eta } : {}),
    }, { tags: this.tags });
  }

  complete(): BatchSummary {
    const durationMs = Date.now() - this.startTime;
    const rate = durationMs > 0 ? (this.processed / durationMs) * 1000 : 0;

    // Timing stats
    let avgMs = 0, minMs = 0, maxMs = 0, p95Ms: number | undefined, p99Ms: number | undefined;
    if (this.durations.length > 0) {
      const sorted = [ ...this.durations ].sort((a, b) => a - b);
      avgMs = Math.round(this.durations.reduce((a, b) => a + b, 0) / this.durations.length);
      minMs = sorted[ 0 ];
      maxMs = sorted[ sorted.length - 1 ];
      if (sorted.length >= 20) {
        p95Ms = sorted[ Math.floor(sorted.length * 0.95) ];
      }
      if (sorted.length >= 100) {
        p99Ms = sorted[ Math.floor(sorted.length * 0.99) ];
      }
    }

    // Build metrics
    const metricsObj: Record<string, MetricStats> = {};
    for (const [ name, data ] of this.metrics) {
      metricsObj[ name ] = {
        sum: data.sum,
        avg: data.count > 0 ? Math.round((data.sum / data.count) * 100) / 100 : 0,
        min: data.min,
        max: data.max,
        count: data.count,
      };
    }

    const summary: BatchSummary = {
      batchId: this.batchId,
      name: this.name,
      total: this.total,
      succeeded: this.succeeded,
      failed: this.failed,
      skipped: this.skipped,
      durationMs,
      itemsPerSecond: Math.round(rate * 100) / 100,
      timing: { avgMs, minMs, maxMs, p95Ms, p99Ms, slowestItemId: this.slowestItemId },
      metrics: metricsObj,
      failedItems: this.failedItems,
      errorsByType: Object.fromEntries(this.errorsByType),
    };

    // Log summary with batch metadata
    if (this.observe !== 'none') {
      const logData: Record<string, unknown> = {
        batchId: this.batchId,
        total: summary.total,
        succeeded: summary.succeeded,
        durationMs: summary.durationMs,
        rate: summary.itemsPerSecond,
      };

      // Timing details for larger batches
      if (summary.total >= 20) {
        logData.timing = {
          avgMs: summary.timing.avgMs,
          p95Ms: summary.timing.p95Ms,
          ...(summary.timing.p99Ms ? { p99Ms: summary.timing.p99Ms } : {}),
          ...(summary.timing.slowestItemId ? { slowest: summary.timing.slowestItemId } : {}),
        };
      }

      if (summary.failed > 0) {
        logData.failed = summary.failed;
        logData.errorRate = `${Math.round((summary.failed / summary.total) * 100)}%`;
        logData.errors = summary.errorsByType;
      }
      if (summary.skipped > 0) logData.skipped = summary.skipped;
      if (Object.keys(metricsObj).length > 0) {
        logData.metrics = Object.fromEntries(
          Object.entries(metricsObj).map(([ k, v ]) => [ k, v.sum ])
        );
      }

      LogObserver.info(`${this.name} done`, logData, {
        tags: this.tags,
        durationMs: summary.durationMs,
        success: summary.failed === 0,
        status: summary.failed > 0 ? 'partial' : 'completed',
        metrics: {
          total: summary.total,
          succeeded: summary.succeeded,
          failed: summary.failed,
          rate: summary.itemsPerSecond,
        },
        capture: { bypass: true },
        metadata: {
          batchId: this.batchId,
          batchName: this.name,
        },
      });
    }

    return summary;
  }
}
