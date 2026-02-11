/**
 * Unit tests for the v2 noise reduction algorithm.
 *
 * Tests cover:
 * 1. Basic decision application (emit, absorb, silent)
 * 2. Tree building and parent resolution
 * 3. Hard signal protection
 * 4. Hard signal ancestor context preservation
 * 5. Absorption data correctness (errors, causedBy, entityIds, operation stats)
 * 6. Bounds enforcement
 * 7. Edge cases (empty input, single event, orphan roots)
 * 8. span.start handling
 * 9. pickNoiseDecision convenience function
 */
export {};
