/**
 * Tests for hierarchy preservation and span.start filtering bugs
 *
 * These tests reproduce the exact issues seen in production:
 * 1. span.start events reaching DynamoDB (should be OTEL only)
 * 2. Parent spans being filtered while children are captured
 * 3. Broken parent references in the resulting logs
 */
export {};
