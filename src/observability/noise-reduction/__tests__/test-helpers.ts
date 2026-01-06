/**
 * Test Helpers for Noise Reduction
 * 
 * Provides utilities for validating noise reduction output and behavior.
 */

import type { ObservabilityEvent } from '../../types';

/**
 * Verify that all kept nodes form a valid hierarchy (no dangling references).
 */
export function verifyKeptHierarchy(events: ObservabilityEvent[]): void {
  const eventMap = new Map(events.map(e => [ e.observabilityLogId, e ]));

  for (const event of events) {
    if (event.parentObservabilityLogId) {
      const parent = eventMap.get(event.parentObservabilityLogId);
      if (!parent) {
        throw new Error(
          `Event ${event.observabilityLogId} references parent ${event.parentObservabilityLogId} which is not in output`
        );
      }
    }
  }
}

/**
 * Find an event in the output by ID.
 */
export function findEvent(events: ObservabilityEvent[], id: string): ObservabilityEvent | undefined {
  return events.find(e => e.observabilityLogId === id);
}

/**
 * Verify that an event has checkpoints (was a parent of folded children).
 */
export function hasCheckpoints(event: ObservabilityEvent): boolean {
  return Boolean((event as any).data?.checkpoints?.length);
}

/**
 * Verify that an event has aggregate data.
 */
export function hasAggregateData(event: ObservabilityEvent): boolean {
  return Boolean((event as any).data?.noiseReduction?.aggregated);
}

/**
 * Get checkpoint names from an event.
 */
export function getCheckpointNames(event: ObservabilityEvent): string[] {
  const checkpoints = (event as any).data?.checkpoints || [];
  return checkpoints.map((cp: any) => cp.name).filter(Boolean);
}

/**
 * Count events by type.
 */
export function countByType(events: ObservabilityEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[ event.type ] = (counts[ event.type ] || 0) + 1;
  }
  return counts;
}

/**
 * Count events by level.
 */
export function countByLevel(events: ObservabilityEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[ event.level ] = (counts[ event.level ] || 0) + 1;
  }
  return counts;
}

/**
 * Find all error events in output.
 */
export function findErrors(events: ObservabilityEvent[]): ObservabilityEvent[] {
  return events.filter(e => e.level === 'error' || e.level === 'critical');
}

/**
 * Verify that no events reference a dropped parent.
 */
export function verifyNoOrphanedReferences(events: ObservabilityEvent[], originalEvents: ObservabilityEvent[]): void {
  const outputIds = new Set(events.map(e => e.observabilityLogId));
  const originalMap = new Map(originalEvents.map(e => [ e.observabilityLogId, e ]));

  for (const event of events) {
    if (event.parentObservabilityLogId) {
      const originalEvent = originalMap.get(event.observabilityLogId);
      const originalParentId = originalEvent?.parentObservabilityLogId;

      // If parent changed or original parent not in output, verify new parent exists
      if (originalParentId !== event.parentObservabilityLogId) {
        if (!outputIds.has(event.parentObservabilityLogId)) {
          throw new Error(
            `Event ${event.observabilityLogId} references parent ${event.parentObservabilityLogId} which is not in output (reparenting failed)`
          );
        }
      }
    }
  }
}
