/**
 * Test to prove Bug #5: allowEvictSpans=false violated by subtree removal
 *
 * HYPOTHESIS:
 * When allowEvictSpans=false, evictLowestPriority() should NEVER evict spans.
 * However, if a non-span event with span children is selected for eviction,
 * the subtree removal logic evicts those span children anyway, violating the contract.
 *
 * EXPECTED BEHAVIOR:
 * - When allowEvictSpans=false, NO spans should be removed from buffer
 * - If a non-span has span children, it should not be selected for eviction
 * - OR the eviction should abort when it detects span children
 *
 * ACTUAL BEHAVIOR (BUG):
 * - Non-span parent is selected for eviction
 * - Subtree removal (BFS) includes span children
 * - Spans are evicted despite allowEvictSpans=false
 */
export {};
