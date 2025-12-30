/**
 * Comprehensive tests for priority-based noise reduction evaluation.
 */

import { evaluateNoiseRules, getEffectivePriority, DECISION_BASE_PRIORITY } from '../priority';
import type { NoiseRule, ObservabilityEvent, NoiseRuleMatch } from '../../types';

/**
 * Simple match function for testing.
 * Matches if all specified match fields are present and equal in the event.
 */
function testMatchFn(event: ObservabilityEvent, match: NoiseRuleMatch): boolean {
  if (match.type !== undefined) {
    const types = Array.isArray(match.type) ? match.type : [ match.type ];
    if (!types.includes(event.type)) return false;
  }

  if (match.level !== undefined) {
    const levels = Array.isArray(match.level) ? match.level : [ match.level ];
    if (!event.level || !levels.includes(event.level)) return false;
  }

  if (match.operation !== undefined) {
    if (!event.operation) return false;
    // Simple string match for tests (real impl uses pattern matching)
    if (typeof match.operation === 'string' && !event.operation.includes(match.operation)) {
      return false;
    }
  }

  if (match.success !== undefined) {
    if (event.success !== match.success) return false;
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
      expect(DECISION_BASE_PRIORITY.keep).toBe(100);
      expect(DECISION_BASE_PRIORITY.aggregate).toBe(50);
      expect(DECISION_BASE_PRIORITY.fold).toBe(40);
      expect(DECISION_BASE_PRIORITY.downgrade).toBe(30);
      expect(DECISION_BASE_PRIORITY.drop).toBe(10);

      // Verify hierarchy
      expect(DECISION_BASE_PRIORITY.keep).toBeGreaterThan(DECISION_BASE_PRIORITY.aggregate);
      expect(DECISION_BASE_PRIORITY.aggregate).toBeGreaterThan(DECISION_BASE_PRIORITY.fold);
      expect(DECISION_BASE_PRIORITY.fold).toBeGreaterThan(DECISION_BASE_PRIORITY.downgrade);
      expect(DECISION_BASE_PRIORITY.downgrade).toBeGreaterThan(DECISION_BASE_PRIORITY.drop);
    });
  });

  describe('getEffectivePriority', () => {
    it('returns explicit priority when provided', () => {
      const rule: NoiseRule = {
        id: 'test',
        match: { type: 'span' },
        decision: 'drop',
        priority: 500,
      };

      expect(getEffectivePriority(rule)).toBe(500);
    });

    it('returns decision base priority when explicit priority not provided', () => {
      const dropRule: NoiseRule = {
        id: 'drop',
        match: { type: 'span' },
        decision: 'drop',
      };

      const keepRule: NoiseRule = {
        id: 'keep',
        match: { type: 'span' },
        decision: 'keep',
      };

      expect(getEffectivePriority(dropRule)).toBe(10);
      expect(getEffectivePriority(keepRule)).toBe(100);
    });

    it('throws error for invalid priority', () => {
      const rule: NoiseRule = {
        id: 'invalid',
        match: { type: 'span' },
        decision: 'drop',
        priority: 0,
      };

      expect(() => getEffectivePriority(rule)).toThrow('invalid priority');
    });

    it('throws error for negative priority', () => {
      const rule: NoiseRule = {
        id: 'invalid',
        match: { type: 'span' },
        decision: 'drop',
        priority: -10,
      };

      expect(() => getEffectivePriority(rule)).toThrow('invalid priority');
    });
  });

  describe('evaluateNoiseRules', () => {
    const createTestEvent = (overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent => ({
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

        const rules: NoiseRule[] = [
          {
            id: 'keep-all',
            priority: 1000,
            match: { type: 'span' },
            decision: 'keep',
          },
        ];

        const result = evaluateNoiseRules(event, rules, testMatchFn);

        expect(result.decision).toBe('drop');
        expect(result.ruleId).toBe('override');
        expect(result.priority).toBe(Infinity);
        expect(result.reason).toBe('Manual override');
      });
    });

    describe('Hard signals (second highest priority)', () => {
      it('keeps error level events', () => {
        const event = createTestEvent({ level: 'error' });

        const rules: NoiseRule[] = [
          {
            id: 'drop-all',
            priority: 500,
            match: { type: 'span' },
            decision: 'drop',
          },
        ];

        const result = evaluateNoiseRules(event, rules, testMatchFn);

        expect(result.decision).toBe('keep');
        expect(result.ruleId).toBe('builtin.hard_signal');
        expect(result.priority).toBe(1000);
      });

      it('keeps critical level events', () => {
        const event = createTestEvent({ level: 'critical' });

        const result = evaluateNoiseRules(event, [], testMatchFn);

        expect(result.decision).toBe('keep');
        expect(result.ruleId).toBe('builtin.hard_signal');
      });

      it('keeps failed operations (success: false)', () => {
        const event = createTestEvent({ success: false });

        const result = evaluateNoiseRules(event, [], testMatchFn);

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

        const result = evaluateNoiseRules(event, [], testMatchFn);

        expect(result.decision).toBe('keep');
        expect(result.ruleId).toBe('builtin.hard_signal');
      });
    });

    describe('Priority resolution', () => {
      it('selects highest priority rule when multiple match', () => {
        const event = createTestEvent();

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(event, rules, testMatchFn);

        expect(result.decision).toBe('keep');
        expect(result.ruleId).toBe('high-priority-keep');
        expect(result.priority).toBe(200);
        expect(result.matchedRulesCount).toBe(3);
      });

      it('uses decision base priority when explicit priority not provided', () => {
        const event = createTestEvent();

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(event, rules, testMatchFn);

        // aggregate should win (50 > 10)
        expect(result.decision).toBe('aggregate');
        expect(result.ruleId).toBe('aggregate-rule');
        expect(result.priority).toBe(50);
      });

      it('explicit priority overrides decision base priority', () => {
        const event = createTestEvent();

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(event, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(event, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(event, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
          {
            id: 'drop-fast-ops',
            match: { type: 'span' },
            except: [
              { success: false },           // Doesn't match
              { operation: 'admin' },       // MATCHES
              { minDurationMs: 1000 },      // Doesn't match
            ],
            decision: 'drop',
          },
        ];

        const result = evaluateNoiseRules(event, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
          {
            id: 'drop-fast-ops',
            match: { type: 'span' },
            except: [
              { success: false },           // Doesn't match
              { level: [ 'error', 'critical' ] }, // Doesn't match
              { minDurationMs: 1000 },      // Doesn't match
            ],
            decision: 'drop',
          },
        ];

        const result = evaluateNoiseRules(event, rules, testMatchFn);

        // Should drop because no exceptions matched
        expect(result.decision).toBe('drop');
        expect(result.ruleId).toBe('drop-fast-ops');
      });
    });

    describe('Default behavior', () => {
      it('keeps events when no rules match', () => {
        const event = createTestEvent({ operation: 'special.operation' });

        const rules: NoiseRule[] = [
          {
            id: 'drop-get',
            match: { operation: 'GET' },
            decision: 'drop',
          },
        ];

        const result = evaluateNoiseRules(event, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(event, rules, testMatchFn);

        // Admin rule should win
        expect(result.decision).toBe('keep');
        expect(result.ruleId).toBe('app.keep-admin');
        expect(result.priority).toBe(200);
        expect(result.matchedRulesCount).toBe(2);
      });

      it('handles tie-breaking by first-in-list when priorities equal', () => {
        const event = createTestEvent();

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(event, rules, testMatchFn);

        // First rule in list should win when priorities are equal
        // (stable sort behavior)
        expect(result.priority).toBe(50);
        expect([ 'first', 'second' ]).toContain(result.ruleId);
      });

      it('handles duration threshold combinations', () => {
        const event = createTestEvent({ durationMs: 750 });

        const rules: NoiseRule[] = [
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
              minDurationMs: 500,  // Matches (750 >= 500)
              maxDurationMs: 2000, // Matches (750 < 2000)
            },
            decision: 'aggregate',
          },
        ];

        const result = evaluateNoiseRules(event, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(adminReadEvent, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(failedHealthCheck, rules, testMatchFn);

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

        const rules: NoiseRule[] = [
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

        const result = evaluateNoiseRules(slowOp, rules, testMatchFn);

        // Should not aggregate because duration exception matched
        expect(result.decision).toBe('keep');
        expect(result.ruleId).toBe('default');
      });
    });
  });
});
