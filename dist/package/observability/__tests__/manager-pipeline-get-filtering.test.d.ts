/**
 * Manager pipeline tests: HTTP GET request filtering via noise reduction.
 *
 * Exercises the REAL manager pipeline:
 *   SpanObserver/LogObserver → capture → buffer → flush → noise reduction → MockBackend
 *
 * Validates that user-defined rules for silencing routine HTTP GET operations
 * work correctly end-to-end, including except clauses for errors/warnings.
 */
export {};
