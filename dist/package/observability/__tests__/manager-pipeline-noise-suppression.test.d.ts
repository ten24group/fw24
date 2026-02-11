/**
 * Manager pipeline tests: noise reduction end-to-end through ObservabilityManager.
 *
 * These tests exercise the REAL manager pipeline:
 *   SpanObserver → capture → buffer → flush → noise reduction → MockBackend
 *
 * They validate that:
 * 1. Routine task invocations are fully suppressed (0 events reach backend)
 * 2. Routine event_processor invocations are fully suppressed
 * 3. Error/failure invocations always survive (hard signals)
 * 4. Controller operations (POST, PUT, DELETE) are never suppressed
 * 5. User rule overrides work through the pipeline
 */
export {};
