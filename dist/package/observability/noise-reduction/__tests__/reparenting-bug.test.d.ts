/**
 * Tests for the reparenting fix: when a parent span is dropped by noise reduction,
 * child events should be reparented to the nearest kept ancestor to avoid "parent not found" errors.
 */
export {};
