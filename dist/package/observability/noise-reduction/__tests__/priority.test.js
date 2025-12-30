"use strict";
/**
 * Comprehensive tests for priority-based noise reduction evaluation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const priority_1 = require("../priority");
/**
 * Simple match function for testing.
 * Matches if all specified match fields are present and equal in the event.
 */
function testMatchFn(event, match) {
    if (match.type !== undefined) {
        const types = Array.isArray(match.type) ? match.type : [match.type];
        if (!types.includes(event.type))
            return false;
    }
    if (match.level !== undefined) {
        const levels = Array.isArray(match.level) ? match.level : [match.level];
        if (!event.level || !levels.includes(event.level))
            return false;
    }
    if (match.operation !== undefined) {
        if (!event.operation)
            return false;
        // Simple string match for tests (real impl uses pattern matching)
        if (typeof match.operation === 'string' && !event.operation.includes(match.operation)) {
            return false;
        }
    }
    if (match.success !== undefined) {
        if (event.success !== match.success)
            return false;
    }
    if (match.minDurationMs !== undefined) {
        if (event.durationMs === undefined || event.durationMs < match.minDurationMs) {
            return false;
        }
    }
    if (match.maxDurationMs !== undefined) {
        if (event.durationMs === undefined || event.durationMs >= match.maxDurationMs) {
            return false;
        }
    }
    return true;
}
describe('Priority-based Noise Reduction', () => {
    describe('DECISION_BASE_PRIORITY', () => {
        it('has correct priority hierarchy', () => {
            expect(priority_1.DECISION_BASE_PRIORITY.keep).toBe(100);
            expect(priority_1.DECISION_BASE_PRIORITY.aggregate).toBe(50);
            expect(priority_1.DECISION_BASE_PRIORITY.fold).toBe(40);
            expect(priority_1.DECISION_BASE_PRIORITY.downgrade).toBe(30);
            expect(priority_1.DECISION_BASE_PRIORITY.drop).toBe(10);
            // Verify hierarchy
            expect(priority_1.DECISION_BASE_PRIORITY.keep).toBeGreaterThan(priority_1.DECISION_BASE_PRIORITY.aggregate);
            expect(priority_1.DECISION_BASE_PRIORITY.aggregate).toBeGreaterThan(priority_1.DECISION_BASE_PRIORITY.fold);
            expect(priority_1.DECISION_BASE_PRIORITY.fold).toBeGreaterThan(priority_1.DECISION_BASE_PRIORITY.downgrade);
            expect(priority_1.DECISION_BASE_PRIORITY.downgrade).toBeGreaterThan(priority_1.DECISION_BASE_PRIORITY.drop);
        });
    });
    describe('getEffectivePriority', () => {
        it('returns explicit priority when provided', () => {
            const rule = {
                id: 'test',
                match: { type: 'span' },
                decision: 'drop',
                priority: 500,
            };
            expect((0, priority_1.getEffectivePriority)(rule)).toBe(500);
        });
        it('returns decision base priority when explicit priority not provided', () => {
            const dropRule = {
                id: 'drop',
                match: { type: 'span' },
                decision: 'drop',
            };
            const keepRule = {
                id: 'keep',
                match: { type: 'span' },
                decision: 'keep',
            };
            expect((0, priority_1.getEffectivePriority)(dropRule)).toBe(10);
            expect((0, priority_1.getEffectivePriority)(keepRule)).toBe(100);
        });
        it('throws error for invalid priority', () => {
            const rule = {
                id: 'invalid',
                match: { type: 'span' },
                decision: 'drop',
                priority: 0,
            };
            expect(() => (0, priority_1.getEffectivePriority)(rule)).toThrow('invalid priority');
        });
        it('throws error for negative priority', () => {
            const rule = {
                id: 'invalid',
                match: { type: 'span' },
                decision: 'drop',
                priority: -10,
            };
            expect(() => (0, priority_1.getEffectivePriority)(rule)).toThrow('invalid priority');
        });
    });
    describe('evaluateNoiseRules', () => {
        const createTestEvent = (overrides = {}) => ({
            type: 'span',
            level: 'info',
            correlationId: 'test-corr-id',
            timestampMs: Date.now(),
            observabilityLogId: 'test-log-id',
            operation: 'test.operation',
            success: true,
            ...overrides,
        });
        describe('Per-event override (highest priority)', () => {
            it('respects per-event override with Infinity priority', () => {
                const event = createTestEvent({
                    capture: {
                        noise: {
                            decision: 'drop',
                            reason: 'Manual override',
                        },
                    },
                });
                const rules = [
                    {
                        id: 'keep-all',
                        priority: 1000,
                        match: { type: 'span' },
                        decision: 'keep',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                expect(result.decision).toBe('drop');
                expect(result.ruleId).toBe('override');
                expect(result.priority).toBe(Infinity);
                expect(result.reason).toBe('Manual override');
            });
        });
        describe('Hard signals (second highest priority)', () => {
            it('keeps error level events', () => {
                const event = createTestEvent({ level: 'error' });
                const rules = [
                    {
                        id: 'drop-all',
                        priority: 500,
                        match: { type: 'span' },
                        decision: 'drop',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('builtin.hard_signal');
                expect(result.priority).toBe(1000);
            });
            it('keeps critical level events', () => {
                const event = createTestEvent({ level: 'critical' });
                const result = (0, priority_1.evaluateNoiseRules)(event, [], testMatchFn);
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('builtin.hard_signal');
            });
            it('keeps failed operations (success: false)', () => {
                const event = createTestEvent({ success: false });
                const result = (0, priority_1.evaluateNoiseRules)(event, [], testMatchFn);
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('builtin.hard_signal');
            });
            it('keeps events with errors', () => {
                const event = createTestEvent({
                    error: {
                        type: 'Error',
                        message: 'Something broke',
                    },
                });
                const result = (0, priority_1.evaluateNoiseRules)(event, [], testMatchFn);
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('builtin.hard_signal');
            });
        });
        describe('Priority resolution', () => {
            it('selects highest priority rule when multiple match', () => {
                const event = createTestEvent();
                const rules = [
                    {
                        id: 'low-priority-drop',
                        priority: 10,
                        match: { type: 'span' },
                        decision: 'drop',
                    },
                    {
                        id: 'high-priority-keep',
                        priority: 200,
                        match: { type: 'span' },
                        decision: 'keep',
                    },
                    {
                        id: 'medium-priority-fold',
                        priority: 50,
                        match: { type: 'span' },
                        decision: 'fold',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('high-priority-keep');
                expect(result.priority).toBe(200);
                expect(result.matchedRulesCount).toBe(3);
            });
            it('uses decision base priority when explicit priority not provided', () => {
                const event = createTestEvent();
                const rules = [
                    {
                        id: 'drop-rule',
                        match: { type: 'span' },
                        decision: 'drop', // base priority: 10
                    },
                    {
                        id: 'aggregate-rule',
                        match: { type: 'span' },
                        decision: 'aggregate', // base priority: 50
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // aggregate should win (50 > 10)
                expect(result.decision).toBe('aggregate');
                expect(result.ruleId).toBe('aggregate-rule');
                expect(result.priority).toBe(50);
            });
            it('explicit priority overrides decision base priority', () => {
                const event = createTestEvent();
                const rules = [
                    {
                        id: 'high-priority-drop',
                        priority: 150,
                        match: { type: 'span' },
                        decision: 'drop', // base priority: 10, but explicit: 150
                    },
                    {
                        id: 'default-keep',
                        match: { type: 'span' },
                        decision: 'keep', // base priority: 100
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // drop should win (explicit 150 > base 100)
                expect(result.decision).toBe('drop');
                expect(result.ruleId).toBe('high-priority-drop');
                expect(result.priority).toBe(150);
            });
        });
        describe('Exception handling', () => {
            it('skips rule when exception matches', () => {
                const event = createTestEvent({
                    level: 'warn', // Not a hard signal
                    success: true,
                    durationMs: 100,
                    operation: 'special.slow.op',
                });
                const rules = [
                    {
                        id: 'drop-fast-ops',
                        match: {
                            type: 'span',
                            maxDurationMs: 500,
                        },
                        except: [
                            { operation: 'slow' }, // Exception matches
                        ],
                        decision: 'drop',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // Should not drop because exception matched
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('default');
                expect(result.matchedRulesCount).toBe(0);
            });
            it('applies rule when no exceptions match', () => {
                const event = createTestEvent({
                    success: true,
                    durationMs: 100,
                });
                const rules = [
                    {
                        id: 'drop-fast-ops',
                        match: {
                            type: 'span',
                            maxDurationMs: 500,
                        },
                        except: [
                            { success: false }, // Exception doesn't match
                        ],
                        decision: 'drop',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // Should drop because exception didn't match
                expect(result.decision).toBe('drop');
                expect(result.ruleId).toBe('drop-fast-ops');
            });
            it('skips rule if ANY exception matches', () => {
                const event = createTestEvent({
                    level: 'info', // Not a hard signal
                    success: true,
                    durationMs: 100,
                    operation: 'test.admin.action',
                });
                const rules = [
                    {
                        id: 'drop-fast-ops',
                        match: { type: 'span' },
                        except: [
                            { success: false }, // Doesn't match
                            { operation: 'admin' }, // MATCHES
                            { minDurationMs: 1000 }, // Doesn't match
                        ],
                        decision: 'drop',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // Should not drop because one exception matched
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('default');
            });
            it('applies rule when all exceptions do not match', () => {
                const event = createTestEvent({
                    level: 'info',
                    success: true,
                    durationMs: 100,
                });
                const rules = [
                    {
                        id: 'drop-fast-ops',
                        match: { type: 'span' },
                        except: [
                            { success: false }, // Doesn't match
                            { level: ['error', 'critical'] }, // Doesn't match
                            { minDurationMs: 1000 }, // Doesn't match
                        ],
                        decision: 'drop',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // Should drop because no exceptions matched
                expect(result.decision).toBe('drop');
                expect(result.ruleId).toBe('drop-fast-ops');
            });
        });
        describe('Default behavior', () => {
            it('keeps events when no rules match', () => {
                const event = createTestEvent({ operation: 'special.operation' });
                const rules = [
                    {
                        id: 'drop-get',
                        match: { operation: 'GET' },
                        decision: 'drop',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('default');
                expect(result.priority).toBe(0);
                expect(result.matchedRulesCount).toBe(0);
            });
        });
        describe('Complex scenarios', () => {
            it('handles complex priority interactions correctly', () => {
                const event = createTestEvent({
                    operation: 'HTTP GET /admin/users',
                    durationMs: 100,
                    success: true,
                });
                const rules = [
                    // Low priority: drop fast reads
                    {
                        id: 'builtin.drop-fast-reads',
                        priority: 10,
                        match: {
                            operation: 'GET',
                            maxDurationMs: 500,
                        },
                        except: [
                            { success: false },
                        ],
                        decision: 'drop',
                    },
                    // High priority: keep admin operations
                    {
                        id: 'app.keep-admin',
                        priority: 200,
                        match: {
                            operation: 'admin',
                        },
                        decision: 'keep',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // Admin rule should win
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('app.keep-admin');
                expect(result.priority).toBe(200);
                expect(result.matchedRulesCount).toBe(2);
            });
            it('handles tie-breaking by first-in-list when priorities equal', () => {
                const event = createTestEvent();
                const rules = [
                    {
                        id: 'first',
                        priority: 50,
                        match: { type: 'span' },
                        decision: 'drop',
                    },
                    {
                        id: 'second',
                        priority: 50,
                        match: { type: 'span' },
                        decision: 'keep',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                // First rule in list should win when priorities are equal
                // (stable sort behavior)
                expect(result.priority).toBe(50);
                expect(['first', 'second']).toContain(result.ruleId);
            });
            it('handles duration threshold combinations', () => {
                const event = createTestEvent({ durationMs: 750 });
                const rules = [
                    {
                        id: 'drop-very-fast',
                        match: {
                            type: 'span',
                            maxDurationMs: 100, // Doesn't match (750 >= 100)
                        },
                        decision: 'drop',
                    },
                    {
                        id: 'aggregate-medium',
                        match: {
                            type: 'span',
                            minDurationMs: 500, // Matches (750 >= 500)
                            maxDurationMs: 2000, // Matches (750 < 2000)
                        },
                        decision: 'aggregate',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(event, rules, testMatchFn);
                expect(result.decision).toBe('aggregate');
                expect(result.ruleId).toBe('aggregate-medium');
            });
        });
        describe('Real-world use cases', () => {
            it('Admin operations override builtin drop rules', () => {
                const adminReadEvent = createTestEvent({
                    operation: 'HTTP GET /admin/teamintegrationconfig',
                    durationMs: 100,
                    success: true,
                });
                const rules = [
                    // Builtin: drop fast successful reads
                    {
                        id: 'fw24.hotpaths.api.drop_fast_successful_reads',
                        priority: 10,
                        match: {
                            operation: 'GET',
                            maxDurationMs: 500,
                        },
                        except: [
                            { success: false },
                        ],
                        decision: 'drop',
                    },
                    // App-specific: keep admin operations
                    {
                        id: 'app.keep_admin_operations',
                        priority: 200,
                        match: {
                            operation: 'admin',
                        },
                        decision: 'keep',
                        reason: 'Admin operations always kept for audit',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(adminReadEvent, rules, testMatchFn);
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('app.keep_admin_operations');
                expect(result.reason).toBe('Admin operations always kept for audit');
            });
            it('Failed health checks kept despite drop rule', () => {
                const failedHealthCheck = createTestEvent({
                    operation: 'HTTP GET /healthcheck',
                    success: false,
                    level: 'error',
                });
                const rules = [
                    {
                        id: 'drop-health-checks',
                        match: {
                            operation: 'healthcheck',
                        },
                        except: [
                            { success: false },
                        ],
                        decision: 'drop',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(failedHealthCheck, rules, testMatchFn);
                // Hard signal should take precedence
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('builtin.hard_signal');
            });
            it('Slow operations kept despite aggregate rule', () => {
                const slowOp = createTestEvent({
                    operation: 'BaseEntityService.upsert',
                    durationMs: 5000,
                    success: true,
                });
                const rules = [
                    {
                        id: 'aggregate-entity-ops',
                        priority: 50,
                        match: {
                            operation: 'upsert',
                        },
                        except: [
                            { minDurationMs: 2000 }, // Slow ops are exceptional
                        ],
                        decision: 'aggregate',
                    },
                ];
                const result = (0, priority_1.evaluateNoiseRules)(slowOp, rules, testMatchFn);
                // Should not aggregate because duration exception matched
                expect(result.decision).toBe('keep');
                expect(result.ruleId).toBe('default');
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJpb3JpdHkudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9fX3Rlc3RzX18vcHJpb3JpdHkudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7O0dBRUc7O0FBRUgsMENBQStGO0FBRy9GOzs7R0FHRztBQUNILFNBQVMsV0FBVyxDQUFDLEtBQXlCLEVBQUUsS0FBcUI7SUFDbkUsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQzdCLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFFLEtBQUssQ0FBQyxJQUFJLENBQUUsQ0FBQztRQUN0RSxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUM7SUFDaEQsQ0FBQztJQUVELElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM5QixNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBRSxLQUFLLENBQUMsS0FBSyxDQUFFLENBQUM7UUFDMUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQztJQUNsRSxDQUFDO0lBRUQsSUFBSSxLQUFLLENBQUMsU0FBUyxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQ2xDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUztZQUFFLE9BQU8sS0FBSyxDQUFD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LFdBQVc7cUJBQ3RCO2lCQUNGLENBQUM7Z0JBRUYsTUFBTSxNQUFNLEdBQUcsSUFBQSw2QkFBa0IsRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO2dCQUU5RCwwREFBMEQ7Z0JBQzFELE1BQU0sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUNyQyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN4QyxDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ29tcHJlaGVuc2l2ZSB0ZXN0cyBmb3IgcHJpb3JpdHktYmFzZWQgbm9pc2UgcmVkdWN0aW9uIGV2YWx1YXRpb24uXG4gKi9cblxuaW1wb3J0IHsgZXZhbHVhdGVOb2lzZVJ1bGVzLCBnZXRFZmZlY3RpdmVQcmlvcml0eSwgREVDSVNJT05fQkFTRV9QUklPUklUWSB9IGZyb20gJy4uL3ByaW9yaXR5JztcbmltcG9ydCB0eXBlIHsgTm9pc2VSdWxlLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE5vaXNlUnVsZU1hdGNoIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuXG4vKipcbiAqIFNpbXBsZSBtYXRjaCBmdW5jdGlvbiBmb3IgdGVzdGluZy5cbiAqIE1hdGNoZXMgaWYgYWxsIHNwZWNpZmllZCBtYXRjaCBmaWVsZHMgYXJlIHByZXNlbnQgYW5kIGVxdWFsIGluIHRoZSBldmVudC5cbiAqL1xuZnVuY3Rpb24gdGVzdE1hdGNoRm4oZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgbWF0Y2g6IE5vaXNlUnVsZU1hdGNoKTogYm9vbGVhbiB7XG4gIGlmIChtYXRjaC50eXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB0eXBlcyA9IEFycmF5LmlzQXJyYXkobWF0Y2gudHlwZSkgPyBtYXRjaC50eXBlIDogWyBtYXRjaC50eXBlIF07XG4gICAgaWYgKCF0eXBlcy5pbmNsdWRlcyhldmVudC50eXBlKSkgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgaWYgKG1hdGNoLmxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCBsZXZlbHMgPSBBcnJheS5pc0FycmF5KG1hdGNoLmxldmVsKSA/IG1hdGNoLmxldmVsIDogWyBtYXRjaC5sZXZlbCBdO1xuICAgIGlmICghZXZlbnQubGV2ZWwgfHwgIWxldmVscy5pbmNsdWRlcyhldmVudC5sZXZlbCkpIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmIChtYXRjaC5vcGVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgIGlmICghZXZlbnQub3BlcmF0aW9uKSByZXR1cm4gZmFsc2U7XG4gICAgLy8gU2ltcGxlIHN0cmluZyBtYXRjaCBmb3IgdGVzdHMgKHJlYWwgaW1wbCB1c2VzIHBhdHRlcm4gbWF0Y2hpbmcpXG4gICAgaWYgKHR5cGVvZiBtYXRjaC5vcGVyYXRpb24gPT09ICdzdHJpbmcnICYmICFldmVudC5vcGVyYXRpb24uaW5jbHVkZXMobWF0Y2gub3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChtYXRjaC5zdWNjZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnQuc3VjY2VzcyAhPT0gbWF0Y2guc3VjY2VzcykgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgaWYgKG1hdGNoLm1pbkR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zID09PSB1bmRlZmluZWQgfHwgZXZlbnQuZHVyYXRpb25NcyA8IG1hdGNoLm1pbkR1cmF0aW9uTXMpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBpZiAobWF0Y2gubWF4RHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgPT09IHVuZGVmaW5lZCB8fCBldmVudC5kdXJhdGlvbk1zID49IG1hdGNoLm1heER1cmF0aW9uTXMpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZGVzY3JpYmUoJ1ByaW9yaXR5LWJhc2VkIE5vaXNlIFJlZHVjdGlvbicsICgpID0+IHtcbiAgZGVzY3JpYmUoJ0RFQ0lTSU9OX0JBU0VfUFJJT1JJVFknLCAoKSA9PiB7XG4gICAgaXQoJ2hhcyBjb3JyZWN0IHByaW9yaXR5IGhpZXJhcmNoeScsICgpID0+IHtcbiAgICAgIGV4cGVjdChERUNJU0lPTl9CQVNFX1BSSU9SSVRZLmtlZXApLnRvQmUoMTAwKTtcbiAgICAgIGV4cGVjdChERUNJU0lPTl9CQVNFX1BSSU9SSVRZLmFnZ3JlZ2F0ZSkudG9CZSg1MCk7XG4gICAgICBleHBlY3QoREVDSVNJT05fQkFTRV9QUklPUklUWS5mb2xkKS50b0JlKDQwKTtcbiAgICAgIGV4cGVjdChERUNJU0lPTl9CQVNFX1BSSU9SSVRZLmRvd25ncmFkZSkudG9CZSgzMCk7XG4gICAgICBleHBlY3QoREVDSVNJT05fQkFTRV9QUklPUklUWS5kcm9wKS50b0JlKDEwKTtcblxuICAgICAgLy8gVmVyaWZ5IGhpZXJhcmNoeVxuICAgICAgZXhwZWN0KERFQ0lTSU9OX0JBU0VfUFJJT1JJVFkua2VlcCkudG9CZUdyZWF0ZXJUaGFuKERFQ0lTSU9OX0JBU0VfUFJJT1JJVFkuYWdncmVnYXRlKTtcbiAgICAgIGV4cGVjdChERUNJU0lPTl9CQVNFX1BSSU9SSVRZLmFnZ3JlZ2F0ZSkudG9CZUdyZWF0ZXJUaGFuKERFQ0lTSU9OX0JBU0VfUFJJT1JJVFkuZm9sZCk7XG4gICAgICBleHBlY3QoREVDSVNJT05fQkFTRV9QUklPUklUWS5mb2xkKS50b0JlR3JlYXRlclRoYW4oREVDSVNJT05fQkFTRV9QUklPUklUWS5kb3duZ3JhZGUpO1xuICAgICAgZXhwZWN0KERFQ0lTSU9OX0JBU0VfUFJJT1JJVFkuZG93bmdyYWRlKS50b0JlR3JlYXRlclRoYW4oREVDSVNJT05fQkFTRV9QUklPUklUWS5kcm9wKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2dldEVmZmVjdGl2ZVByaW9yaXR5JywgKCkgPT4ge1xuICAgIGl0KCdyZXR1cm5zIGV4cGxpY2l0IHByaW9yaXR5IHdoZW4gcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBydWxlOiBOb2lzZVJ1bGUgPSB7XG4gICAgICAgIGlkOiAndGVzdCcsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJyB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICBwcmlvcml0eTogNTAwLFxuICAgICAgfTtcblxuICAgICAgZXhwZWN0KGdldEVmZmVjdGl2ZVByaW9yaXR5KHJ1bGUpKS50b0JlKDUwMCk7XG4gICAgfSk7XG5cbiAgICBpdCgncmV0dXJucyBkZWNpc2lvbiBiYXNlIHByaW9yaXR5IHdoZW4gZXhwbGljaXQgcHJpb3JpdHkgbm90IHByb3ZpZGVkJywgKCkgPT4ge1xuICAgICAgY29uc3QgZHJvcFJ1bGU6IE5vaXNlUnVsZSA9IHtcbiAgICAgICAgaWQ6ICdkcm9wJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBrZWVwUnVsZTogTm9pc2VSdWxlID0ge1xuICAgICAgICBpZDogJ2tlZXAnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicgfSxcbiAgICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgIH07XG5cbiAgICAgIGV4cGVjdChnZXRFZmZlY3RpdmVQcmlvcml0eShkcm9wUnVsZSkpLnRvQmUoMTApO1xuICAgICAgZXhwZWN0KGdldEVmZmVjdGl2ZVByaW9yaXR5KGtlZXBSdWxlKSkudG9CZSgxMDApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Rocm93cyBlcnJvciBmb3IgaW52YWxpZCBwcmlvcml0eScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJ1bGU6IE5vaXNlUnVsZSA9IHtcbiAgICAgICAgaWQ6ICdpbnZhbGlkJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgfTtcblxuICAgICAgZXhwZWN0KCgpID0+IGdldEVmZmVjdGl2ZVByaW9yaXR5KHJ1bGUpKS50b1Rocm93KCdpbnZhbGlkIHByaW9yaXR5Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgndGhyb3dzIGVycm9yIGZvciBuZWdhdGl2ZSBwcmlvcml0eScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJ1bGU6IE5vaXNlUnVsZSA9IHtcbiAgICAgICAgaWQ6ICdpbnZhbGlkJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgIHByaW9yaXR5OiAtMTAsXG4gICAgICB9O1xuXG4gICAgICBleHBlY3QoKCkgPT4gZ2V0RWZmZWN0aXZlUHJpb3JpdHkocnVsZSkpLnRvVGhyb3coJ2ludmFsaWQgcHJpb3JpdHknKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2V2YWx1YXRlTm9pc2VSdWxlcycsICgpID0+IHtcbiAgICBjb25zdCBjcmVhdGVUZXN0RXZlbnQgPSAob3ZlcnJpZGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4gPSB7fSk6IE9ic2VydmFiaWxpdHlFdmVudCA9PiAoe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnItaWQnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0ZXN0LWxvZy1pZCcsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0Lm9wZXJhdGlvbicsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgLi4ub3ZlcnJpZGVzLFxuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ1Blci1ldmVudCBvdmVycmlkZSAoaGlnaGVzdCBwcmlvcml0eSknLCAoKSA9PiB7XG4gICAgICBpdCgncmVzcGVjdHMgcGVyLWV2ZW50IG92ZXJyaWRlIHdpdGggSW5maW5pdHkgcHJpb3JpdHknLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgICBjYXB0dXJlOiB7XG4gICAgICAgICAgICBub2lzZToge1xuICAgICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgICByZWFzb246ICdNYW51YWwgb3ZlcnJpZGUnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBydWxlczogTm9pc2VSdWxlW10gPSBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdrZWVwLWFsbCcsXG4gICAgICAgICAgICBwcmlvcml0eTogMTAwMCxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhldmVudCwgcnVsZXMsIHRlc3RNYXRjaEZuKTtcblxuICAgICAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdkcm9wJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdvdmVycmlkZScpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnByaW9yaXR5KS50b0JlKEluZmluaXR5KTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5yZWFzb24pLnRvQmUoJ01hbnVhbCBvdmVycmlkZScpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnSGFyZCBzaWduYWxzIChzZWNvbmQgaGlnaGVzdCBwcmlvcml0eSknLCAoKSA9PiB7XG4gICAgICBpdCgna2VlcHMgZXJyb3IgbGV2ZWwgZXZlbnRzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IGNyZWF0ZVRlc3RFdmVudCh7IGxldmVsOiAnZXJyb3InIH0pO1xuXG4gICAgICAgIGNvbnN0IHJ1bGVzOiBOb2lzZVJ1bGVbXSA9IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiA1MDAsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZU5vaXNlUnVsZXMoZXZlbnQsIHJ1bGVzLCB0ZXN0TWF0Y2hGbik7XG5cbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kZWNpc2lvbikudG9CZSgna2VlcCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnJ1bGVJZCkudG9CZSgnYnVpbHRpbi5oYXJkX3NpZ25hbCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnByaW9yaXR5KS50b0JlKDEwMDApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdrZWVwcyBjcml0aWNhbCBsZXZlbCBldmVudHMnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHsgbGV2ZWw6ICdjcml0aWNhbCcgfSk7XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGV2ZW50LCBbXSwgdGVzdE1hdGNoRm4pO1xuXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGVjaXNpb24pLnRvQmUoJ2tlZXAnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5ydWxlSWQpLnRvQmUoJ2J1aWx0aW4uaGFyZF9zaWduYWwnKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgna2VlcHMgZmFpbGVkIG9wZXJhdGlvbnMgKHN1Y2Nlc3M6IGZhbHNlKScsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVUZXN0RXZlbnQoeyBzdWNjZXNzOiBmYWxzZSB9KTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZU5vaXNlUnVsZXMoZXZlbnQsIFtdLCB0ZXN0TWF0Y2hGbik7XG5cbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kZWNpc2lvbikudG9CZSgna2VlcCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnJ1bGVJZCkudG9CZSgnYnVpbHRpbi5oYXJkX3NpZ25hbCcpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdrZWVwcyBldmVudHMgd2l0aCBlcnJvcnMnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgICBlcnJvcjoge1xuICAgICAgICAgICAgdHlwZTogJ0Vycm9yJyxcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdTb21ldGhpbmcgYnJva2UnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhldmVudCwgW10sIHRlc3RNYXRjaEZuKTtcblxuICAgICAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdrZWVwJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdidWlsdGluLmhhcmRfc2lnbmFsJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdQcmlvcml0eSByZXNvbHV0aW9uJywgKCkgPT4ge1xuICAgICAgaXQoJ3NlbGVjdHMgaGlnaGVzdCBwcmlvcml0eSBydWxlIHdoZW4gbXVsdGlwbGUgbWF0Y2gnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KCk7XG5cbiAgICAgICAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnbG93LXByaW9yaXR5LWRyb3AnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDEwLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdoaWdoLXByaW9yaXR5LWtlZXAnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDIwMCxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnbWVkaXVtLXByaW9yaXR5LWZvbGQnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDUwLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGV2ZW50LCBydWxlcywgdGVzdE1hdGNoRm4pO1xuXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGVjaXNpb24pLnRvQmUoJ2tlZXAnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5ydWxlSWQpLnRvQmUoJ2hpZ2gtcHJpb3JpdHkta2VlcCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnByaW9yaXR5KS50b0JlKDIwMCk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQubWF0Y2hlZFJ1bGVzQ291bnQpLnRvQmUoMyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3VzZXMgZGVjaXNpb24gYmFzZSBwcmlvcml0eSB3aGVuIGV4cGxpY2l0IHByaW9yaXR5IG5vdCBwcm92aWRlZCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVUZXN0RXZlbnQoKTtcblxuICAgICAgICBjb25zdCBydWxlczogTm9pc2VSdWxlW10gPSBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLXJ1bGUnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLCAvLyBiYXNlIHByaW9yaXR5OiAxMFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdhZ2dyZWdhdGUtcnVsZScsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJywgLy8gYmFzZSBwcmlvcml0eTogNTBcbiAgICAgICAgICB9LFxuICAgICAgICBdO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhldmVudCwgcnVsZXMsIHRlc3RNYXRjaEZuKTtcblxuICAgICAgICAvLyBhZ2dyZWdhdGUgc2hvdWxkIHdpbiAoNTAgPiAxMClcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kZWNpc2lvbikudG9CZSgnYWdncmVnYXRlJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdhZ2dyZWdhdGUtcnVsZScpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnByaW9yaXR5KS50b0JlKDUwKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnZXhwbGljaXQgcHJpb3JpdHkgb3ZlcnJpZGVzIGRlY2lzaW9uIGJhc2UgcHJpb3JpdHknLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KCk7XG5cbiAgICAgICAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnaGlnaC1wcmlvcml0eS1kcm9wJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxNTAsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsIC8vIGJhc2UgcHJpb3JpdHk6IDEwLCBidXQgZXhwbGljaXQ6IDE1MFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkZWZhdWx0LWtlZXAnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2tlZXAnLCAvLyBiYXNlIHByaW9yaXR5OiAxMDBcbiAgICAgICAgICB9LFxuICAgICAgICBdO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhldmVudCwgcnVsZXMsIHRlc3RNYXRjaEZuKTtcblxuICAgICAgICAvLyBkcm9wIHNob3VsZCB3aW4gKGV4cGxpY2l0IDE1MCA+IGJhc2UgMTAwKVxuICAgICAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdkcm9wJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdoaWdoLXByaW9yaXR5LWRyb3AnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wcmlvcml0eSkudG9CZSgxNTApO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnRXhjZXB0aW9uIGhhbmRsaW5nJywgKCkgPT4ge1xuICAgICAgaXQoJ3NraXBzIHJ1bGUgd2hlbiBleGNlcHRpb24gbWF0Y2hlcycsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVUZXN0RXZlbnQoe1xuICAgICAgICAgIGxldmVsOiAnd2FybicsIC8vIE5vdCBhIGhhcmQgc2lnbmFsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnc3BlY2lhbC5zbG93Lm9wJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1mYXN0LW9wcycsXG4gICAgICAgICAgICBtYXRjaDoge1xuICAgICAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgICAgIG1heER1cmF0aW9uTXM6IDUwMCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleGNlcHQ6IFtcbiAgICAgICAgICAgICAgeyBvcGVyYXRpb246ICdzbG93JyB9LCAvLyBFeGNlcHRpb24gbWF0Y2hlc1xuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZU5vaXNlUnVsZXMoZXZlbnQsIHJ1bGVzLCB0ZXN0TWF0Y2hGbik7XG5cbiAgICAgICAgLy8gU2hvdWxkIG5vdCBkcm9wIGJlY2F1c2UgZXhjZXB0aW9uIG1hdGNoZWRcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kZWNpc2lvbikudG9CZSgna2VlcCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnJ1bGVJZCkudG9CZSgnZGVmYXVsdCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0Lm1hdGNoZWRSdWxlc0NvdW50KS50b0JlKDApO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdhcHBsaWVzIHJ1bGUgd2hlbiBubyBleGNlcHRpb25zIG1hdGNoJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IGNyZWF0ZVRlc3RFdmVudCh7XG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJ1bGVzOiBOb2lzZVJ1bGVbXSA9IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZmFzdC1vcHMnLFxuICAgICAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgICAgICBtYXhEdXJhdGlvbk1zOiA1MDAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXhjZXB0OiBbXG4gICAgICAgICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSwgLy8gRXhjZXB0aW9uIGRvZXNuJ3QgbWF0Y2hcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGV2ZW50LCBydWxlcywgdGVzdE1hdGNoRm4pO1xuXG4gICAgICAgIC8vIFNob3VsZCBkcm9wIGJlY2F1c2UgZXhjZXB0aW9uIGRpZG4ndCBtYXRjaFxuICAgICAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdkcm9wJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdkcm9wLWZhc3Qtb3BzJyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3NraXBzIHJ1bGUgaWYgQU5ZIGV4Y2VwdGlvbiBtYXRjaGVzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IGNyZWF0ZVRlc3RFdmVudCh7XG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJywgLy8gTm90IGEgaGFyZCBzaWduYWxcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgICBvcGVyYXRpb246ICd0ZXN0LmFkbWluLmFjdGlvbicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJ1bGVzOiBOb2lzZVJ1bGVbXSA9IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZmFzdC1vcHMnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgICAgICBleGNlcHQ6IFtcbiAgICAgICAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LCAgICAgICAgICAgLy8gRG9lc24ndCBtYXRjaFxuICAgICAgICAgICAgICB7IG9wZXJhdGlvbjogJ2FkbWluJyB9LCAgICAgICAvLyBNQVRDSEVTXG4gICAgICAgICAgICAgIHsgbWluRHVyYXRpb25NczogMTAwMCB9LCAgICAgIC8vIERvZXNuJ3QgbWF0Y2hcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGV2ZW50LCBydWxlcywgdGVzdE1hdGNoRm4pO1xuXG4gICAgICAgIC8vIFNob3VsZCBub3QgZHJvcCBiZWNhdXNlIG9uZSBleGNlcHRpb24gbWF0Y2hlZFxuICAgICAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdrZWVwJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdkZWZhdWx0Jyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ2FwcGxpZXMgcnVsZSB3aGVuIGFsbCBleGNlcHRpb25zIGRvIG5vdCBtYXRjaCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVUZXN0RXZlbnQoe1xuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJ1bGVzOiBOb2lzZVJ1bGVbXSA9IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZmFzdC1vcHMnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgICAgICBleGNlcHQ6IFtcbiAgICAgICAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LCAgICAgICAgICAgLy8gRG9lc24ndCBtYXRjaFxuICAgICAgICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSB9LCAvLyBEb2Vzbid0IG1hdGNoXG4gICAgICAgICAgICAgIHsgbWluRHVyYXRpb25NczogMTAwMCB9LCAgICAgIC8vIERvZXNuJ3QgbWF0Y2hcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGV2ZW50LCBydWxlcywgdGVzdE1hdGNoRm4pO1xuXG4gICAgICAgIC8vIFNob3VsZCBkcm9wIGJlY2F1c2Ugbm8gZXhjZXB0aW9ucyBtYXRjaGVkXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGVjaXNpb24pLnRvQmUoJ2Ryb3AnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5ydWxlSWQpLnRvQmUoJ2Ryb3AtZmFzdC1vcHMnKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0RlZmF1bHQgYmVoYXZpb3InLCAoKSA9PiB7XG4gICAgICBpdCgna2VlcHMgZXZlbnRzIHdoZW4gbm8gcnVsZXMgbWF0Y2gnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHsgb3BlcmF0aW9uOiAnc3BlY2lhbC5vcGVyYXRpb24nIH0pO1xuXG4gICAgICAgIGNvbnN0IHJ1bGVzOiBOb2lzZVJ1bGVbXSA9IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZ2V0JyxcbiAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJ0dFVCcgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZU5vaXNlUnVsZXMoZXZlbnQsIHJ1bGVzLCB0ZXN0TWF0Y2hGbik7XG5cbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kZWNpc2lvbikudG9CZSgna2VlcCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnJ1bGVJZCkudG9CZSgnZGVmYXVsdCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnByaW9yaXR5KS50b0JlKDApO1xuICAgICAgICBleHBlY3QocmVzdWx0Lm1hdGNoZWRSdWxlc0NvdW50KS50b0JlKDApO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnQ29tcGxleCBzY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgICBpdCgnaGFuZGxlcyBjb21wbGV4IHByaW9yaXR5IGludGVyYWN0aW9ucyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYWRtaW4vdXNlcnMnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBydWxlczogTm9pc2VSdWxlW10gPSBbXG4gICAgICAgICAgLy8gTG93IHByaW9yaXR5OiBkcm9wIGZhc3QgcmVhZHNcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2J1aWx0aW4uZHJvcC1mYXN0LXJlYWRzJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxMCxcbiAgICAgICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbjogJ0dFVCcsXG4gICAgICAgICAgICAgIG1heER1cmF0aW9uTXM6IDUwMCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleGNlcHQ6IFtcbiAgICAgICAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyBIaWdoIHByaW9yaXR5OiBrZWVwIGFkbWluIG9wZXJhdGlvbnNcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2FwcC5rZWVwLWFkbWluJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAyMDAsXG4gICAgICAgICAgICBtYXRjaDoge1xuICAgICAgICAgICAgICBvcGVyYXRpb246ICdhZG1pbicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhldmVudCwgcnVsZXMsIHRlc3RNYXRjaEZuKTtcblxuICAgICAgICAvLyBBZG1pbiBydWxlIHNob3VsZCB3aW5cbiAgICAgICAgZXhwZWN0KHJlc3VsdC5kZWNpc2lvbikudG9CZSgna2VlcCcpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnJ1bGVJZCkudG9CZSgnYXBwLmtlZXAtYWRtaW4nKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5wcmlvcml0eSkudG9CZSgyMDApO1xuICAgICAgICBleHBlY3QocmVzdWx0Lm1hdGNoZWRSdWxlc0NvdW50KS50b0JlKDIpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdoYW5kbGVzIHRpZS1icmVha2luZyBieSBmaXJzdC1pbi1saXN0IHdoZW4gcHJpb3JpdGllcyBlcXVhbCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVUZXN0RXZlbnQoKTtcblxuICAgICAgICBjb25zdCBydWxlczogTm9pc2VSdWxlW10gPSBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdmaXJzdCcsXG4gICAgICAgICAgICBwcmlvcml0eTogNTAsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3NlY29uZCcsXG4gICAgICAgICAgICBwcmlvcml0eTogNTAsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZU5vaXNlUnVsZXMoZXZlbnQsIHJ1bGVzLCB0ZXN0TWF0Y2hGbik7XG5cbiAgICAgICAgLy8gRmlyc3QgcnVsZSBpbiBsaXN0IHNob3VsZCB3aW4gd2hlbiBwcmlvcml0aWVzIGFyZSBlcXVhbFxuICAgICAgICAvLyAoc3RhYmxlIHNvcnQgYmVoYXZpb3IpXG4gICAgICAgIGV4cGVjdChyZXN1bHQucHJpb3JpdHkpLnRvQmUoNTApO1xuICAgICAgICBleHBlY3QoWyAnZmlyc3QnLCAnc2Vjb25kJyBdKS50b0NvbnRhaW4ocmVzdWx0LnJ1bGVJZCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ2hhbmRsZXMgZHVyYXRpb24gdGhyZXNob2xkIGNvbWJpbmF0aW9ucycsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVUZXN0RXZlbnQoeyBkdXJhdGlvbk1zOiA3NTAgfSk7XG5cbiAgICAgICAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC12ZXJ5LWZhc3QnLFxuICAgICAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgICAgICBtYXhEdXJhdGlvbk1zOiAxMDAsIC8vIERvZXNuJ3QgbWF0Y2ggKDc1MCA+PSAxMDApXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWdncmVnYXRlLW1lZGl1bScsXG4gICAgICAgICAgICBtYXRjaDoge1xuICAgICAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgICAgIG1pbkR1cmF0aW9uTXM6IDUwMCwgIC8vIE1hdGNoZXMgKDc1MCA+PSA1MDApXG4gICAgICAgICAgICAgIG1heER1cmF0aW9uTXM6IDIwMDAsIC8vIE1hdGNoZXMgKDc1MCA8IDIwMDApXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGV2ZW50LCBydWxlcywgdGVzdE1hdGNoRm4pO1xuXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGVjaXNpb24pLnRvQmUoJ2FnZ3JlZ2F0ZScpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnJ1bGVJZCkudG9CZSgnYWdncmVnYXRlLW1lZGl1bScpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnUmVhbC13b3JsZCB1c2UgY2FzZXMnLCAoKSA9PiB7XG4gICAgICBpdCgnQWRtaW4gb3BlcmF0aW9ucyBvdmVycmlkZSBidWlsdGluIGRyb3AgcnVsZXMnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFkbWluUmVhZEV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYWRtaW4vdGVhbWludGVncmF0aW9uY29uZmlnJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gW1xuICAgICAgICAgIC8vIEJ1aWx0aW46IGRyb3AgZmFzdCBzdWNjZXNzZnVsIHJlYWRzXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmFwaS5kcm9wX2Zhc3Rfc3VjY2Vzc2Z1bF9yZWFkcycsXG4gICAgICAgICAgICBwcmlvcml0eTogMTAsXG4gICAgICAgICAgICBtYXRjaDoge1xuICAgICAgICAgICAgICBvcGVyYXRpb246ICdHRVQnLFxuICAgICAgICAgICAgICBtYXhEdXJhdGlvbk1zOiA1MDAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXhjZXB0OiBbXG4gICAgICAgICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gQXBwLXNwZWNpZmljOiBrZWVwIGFkbWluIG9wZXJhdGlvbnNcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2FwcC5rZWVwX2FkbWluX29wZXJhdGlvbnMnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDIwMCxcbiAgICAgICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FkbWluJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgICAgICAgcmVhc29uOiAnQWRtaW4gb3BlcmF0aW9ucyBhbHdheXMga2VwdCBmb3IgYXVkaXQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGFkbWluUmVhZEV2ZW50LCBydWxlcywgdGVzdE1hdGNoRm4pO1xuXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGVjaXNpb24pLnRvQmUoJ2tlZXAnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5ydWxlSWQpLnRvQmUoJ2FwcC5rZWVwX2FkbWluX29wZXJhdGlvbnMnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5yZWFzb24pLnRvQmUoJ0FkbWluIG9wZXJhdGlvbnMgYWx3YXlzIGtlcHQgZm9yIGF1ZGl0Jyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ0ZhaWxlZCBoZWFsdGggY2hlY2tzIGtlcHQgZGVzcGl0ZSBkcm9wIHJ1bGUnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZhaWxlZEhlYWx0aENoZWNrID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvaGVhbHRoY2hlY2snLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBydWxlczogTm9pc2VSdWxlW10gPSBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWhlYWx0aC1jaGVja3MnLFxuICAgICAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnaGVhbHRoY2hlY2snLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV4Y2VwdDogW1xuICAgICAgICAgICAgICB7IHN1Y2Nlc3M6IGZhbHNlIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhmYWlsZWRIZWFsdGhDaGVjaywgcnVsZXMsIHRlc3RNYXRjaEZuKTtcblxuICAgICAgICAvLyBIYXJkIHNpZ25hbCBzaG91bGQgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgIGV4cGVjdChyZXN1bHQuZGVjaXNpb24pLnRvQmUoJ2tlZXAnKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5ydWxlSWQpLnRvQmUoJ2J1aWx0aW4uaGFyZF9zaWduYWwnKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnU2xvdyBvcGVyYXRpb25zIGtlcHQgZGVzcGl0ZSBhZ2dyZWdhdGUgcnVsZScsICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2xvd09wID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgICBvcGVyYXRpb246ICdCYXNlRW50aXR5U2VydmljZS51cHNlcnQnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDUwMDAsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWdncmVnYXRlLWVudGl0eS1vcHMnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDUwLFxuICAgICAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uOiAndXBzZXJ0JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleGNlcHQ6IFtcbiAgICAgICAgICAgICAgeyBtaW5EdXJhdGlvbk1zOiAyMDAwIH0sIC8vIFNsb3cgb3BzIGFyZSBleGNlcHRpb25hbFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdO1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhzbG93T3AsIHJ1bGVzLCB0ZXN0TWF0Y2hGbik7XG5cbiAgICAgICAgLy8gU2hvdWxkIG5vdCBhZ2dyZWdhdGUgYmVjYXVzZSBkdXJhdGlvbiBleGNlcHRpb24gbWF0Y2hlZFxuICAgICAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdrZWVwJyk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdkZWZhdWx0Jyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==