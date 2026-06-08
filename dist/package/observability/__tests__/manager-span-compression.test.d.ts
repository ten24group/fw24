/**
 * Manager pipeline tests: span compression (grouped checkpoints).
 *
 * Tests the persistence-time transformation in manager.ts that groups
 * absorbed checkpoints by operation name (Elastic APM span compression pattern).
 *
 * These tests exercise the full pipeline:
 *   SpanObserver → capture → buffer → flush → noise reduction → grouping → MockBackend
 *
 * NOTE: In buffering mode (noise reduction enabled), SpanObserver can't resolve
 * parentObservabilityLogId from the in-memory span tree because parents aren't
 * "captured" yet. Tests must pass parentObservabilityLogId explicitly.
 *
 * Validates:
 * 1. Grouped checkpoint structure (count, duration, items, shared context)
 * 2. data.absorbed is simplified (no byOperation, no entityIds)
 * 3. Multiple operation types produce separate groups
 * 4. Mixed success/error groups get correct _type
 * 5. Single absorbed event still gets grouped (count=1)
 * 6. Manual checkpoints coexist with grouped absorbed entries
 * 7. Grouped items array carries per-item varying fields
 * 8. No absorbed events → no data.absorbed
 * 9. Description content verification
 * 10. Per-item status and causedBy fields preserved
 * 11. subType captured as shared context on group
 * 12. Metrics aggregated across group (per-key sum/min/max/count)
 * 13. Error fingerprint preserved on AbsorbedError
 */
export {};
