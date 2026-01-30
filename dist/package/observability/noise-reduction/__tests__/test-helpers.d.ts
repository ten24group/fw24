/**
 * Test Helpers for Noise Reduction
 *
 * Provides utilities for validating noise reduction output and behavior.
 */
import type { ObservabilityEvent } from '../../types';
/**
 * Verify that all kept nodes form a valid hierarchy (no dangling references).
 */
export declare function verifyKeptHierarchy(events: ObservabilityEvent[]): void;
/**
 * Find an event in the output by ID.
 */
export declare function findEvent(events: ObservabilityEvent[], id: string): ObservabilityEvent | undefined;
/**
 * Verify that an event has checkpoints (was a parent of folded children).
 */
export declare function hasCheckpoints(event: ObservabilityEvent): boolean;
/**
 * Verify that an event has aggregate data.
 */
export declare function hasAggregateData(event: ObservabilityEvent): boolean;
/**
 * Get checkpoint names from an event.
 */
export declare function getCheckpointNames(event: ObservabilityEvent): string[];
/**
 * Count events by type.
 */
export declare function countByType(events: ObservabilityEvent[]): Record<string, number>;
/**
 * Count events by level.
 */
export declare function countByLevel(events: ObservabilityEvent[]): Record<string, number>;
/**
 * Find all error events in output.
 */
export declare function findErrors(events: ObservabilityEvent[]): ObservabilityEvent[];
/**
 * Verify that no events reference a dropped parent.
 */
export declare function verifyNoOrphanedReferences(events: ObservabilityEvent[], originalEvents: ObservabilityEvent[]): void;
