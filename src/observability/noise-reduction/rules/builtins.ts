/**
 * Built-in noise reduction rules.
 * 
 * These rules provide sensible defaults for common framework hot paths.
 * Applications can override or extend these rules via configuration.
 */

import type { NoiseRule } from '../../types';

/**
 * Cache for builtin rules by preset combination.
 */
const builtinRulesCache = new Map<string, ReadonlyArray<NoiseRule>>();

/**
 * Get builtin rules for specified presets.
 * Results are cached for performance.
 * 
 * @param presets - Array of preset names to activate
 * @returns Array of builtin rules
 */
export function getBuiltinRules(presets: readonly string[]): ReadonlyArray<NoiseRule> {
  // Create cache key from sorted presets (order-independent)
  const cacheKey = [ ...presets ].sort().join(',');

  const cached = builtinRulesCache.get(cacheKey);
  if (cached) return cached;

  const rules: NoiseRule[] = [];

  // ═══════════════════════════════════════════════════════════════════════
  // PRESET: fw24.hotpaths
  // Safe defaults for framework hot paths (streams, audit, queries, API)
  // ═══════════════════════════════════════════════════════════════════════

  if (presets.includes('fw24.hotpaths')) {
    // ─────────────────────────────────────────────────────────────────────
    // Database Query Noise Reduction
    // ─────────────────────────────────────────────────────────────────────

    // HIGHEST PRIORITY: Keep query errors
    rules.push({
      id: 'fw24.hotpaths.queries.keep_errors',
      match: {
        type: 'database.query',
        success: false,
      },
      decision: 'keep',
      reason: 'Keep query errors as standalone logs for debugging',
    });

    // Keep table scans (always warnings, even if fast)
    rules.push({
      id: 'fw24.hotpaths.queries.keep_scans',
      match: {
        type: 'database.query',
        tags: { scan: 'true' },
      },
      decision: 'keep',
      reason: 'Keep table scan operations as standalone warnings',
    });

    // Keep slow queries for investigation
    rules.push({
      id: 'fw24.hotpaths.queries.keep_slow',
      match: {
        type: 'database.query',
        minDurationMs: 1000,
      },
      decision: 'keep',
      reason: 'Keep slow queries (>=1000ms) as standalone logs',
    });

    // LOWEST PRIORITY: Fold fast successful queries
    rules.push({
      id: 'fw24.hotpaths.queries.fold_fast_success',
      match: {
        type: 'database.query',
        maxDurationMs: 100,
        success: true,
      },
      decision: 'fold',
      reason: 'Fold fast successful queries (<100ms) into parent span',
    });

    // ─────────────────────────────────────────────────────────────────────
    // API Read Operations
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.api.drop_fast_successful_reads',
      priority: 10, // Low priority - easy to override
      match: {
        type: 'span',
        // Matches controller operations (HTTP GET/HEAD/OPTIONS) and read methods
        operation: '/^(HTTP )?(GET|HEAD|OPTIONS)\\s|\\.(list|get|read|fetch|find)(?:[(/]|$)|\\/(list|get|read|fetch|find)(?:[/?]|$)/',
        maxDurationMs: 5000,
      },
      except: [
        { success: false },                         // Never drop failures
        { level: [ 'error', 'critical', 'warn' ] }, // Never drop warnings/errors
      ],
      decision: 'drop',
      reason: 'Drop fast successful read operations (<5 S)',
    });

    // ─────────────────────────────────────────────────────────────────────
    // Auth Operations
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.auth.drop_routine_auth',
      priority: 10, // Low priority - easy to override
      match: {
        type: 'span',
        // Matches auth controller operations and auth-related endpoints
        operation: '/^(HTTP )?(POST|GET)\\s.*\\/(auth|mauth|oauth|token|login|logout|refresh|credentials|session)\\/?|^Auth[A-Za-z0-9]*\\.(get|refresh|validate|verify|check|login|logout)/',
        maxDurationMs: 5000,
      },
      except: [
        { success: false },                         // Never drop auth failures
        { level: [ 'error', 'critical', 'warn' ] }, // Never drop auth warnings/errors
      ],
      decision: 'drop',
      reason: 'Drop routine auth operations (<5 S) - errors/failures/slow/warnings are kept',
    });

    // ─────────────────────────────────────────────────────────────────────
    // Stream Processors
    // ─────────────────────────────────────────────────────────────────────

    rules.push(
      {
        id: 'fw24.hotpaths.stream.fold_publish_done',
        match: {
          type: 'log',
          source: '/^DynamoDBStreamToSNSProcessor\\./',
          level: [ 'info', 'debug', 'trace' ],
          operation: '/Publish (SNS|FIFO) done/',
        },
        decision: 'fold',
        reason: 'Fold noisy stream publish completion logs',
      },
      {
        id: 'fw24.hotpaths.stream.fold_audit_done',
        match: {
          type: 'log',
          source: '/^DynamoDBStreamAuditLogger\\./',
          level: [ 'info', 'debug', 'trace' ],
          operation: '/done|Captured (create|update|delete) audit/',
        },
        decision: 'fold',
        reason: 'Fold noisy stream audit logger logs',
      },
      {
        id: 'fw24.hotpaths.stream.drop_info_noise',
        match: {
          type: 'log',
          source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\./',
          level: [ 'trace', 'debug' ],
        },
        decision: 'drop',
        reason: 'Drop low-level stream noise',
      },
      {
        id: 'fw24.hotpaths.stream.drop_batch_spans',
        match: {
          type: 'span',
          source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\.process$/',
          operation: '/^aws:(sqs|dynamodb) DynamoDBStream/',
        },
        decision: 'drop',
        reason: 'Drop stream processor batch spans',
      }
    );

    // ─────────────────────────────────────────────────────────────────────
    // Entity Operations
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.entity.aggregate_upsert_spans',
      priority: 50, // Default aggregate priority
      match: {
        type: 'span',
        operation: '/BaseEntityService\\.(upsert|update)/',
        source: '/^service:BaseEntityService\\./',
      },
      except: [
        { success: false },                // Keep failed writes
        { level: [ 'error', 'critical' ] },  // Keep error writes
      ],
      decision: 'aggregate',
      reason: 'Aggregate successful entity write spans into parent',
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRESET: fw24.batch_processors
  // Aggressive noise reduction for batch processing scenarios
  // ═══════════════════════════════════════════════════════════════════════

  if (presets.includes('fw24.batch_processors')) {
    rules.push(
      {
        id: 'fw24.batch.aggregate_item_processing',
        match: {
          type: 'span',
          operation: '/process(Item|Record|Message|Event)/',
          source: '/Processor\\./',
        },
        except: [ { success: false } ],
        decision: 'aggregate',
        reason: 'Aggregate successful item processing spans',
      },
      {
        id: 'fw24.batch.fold_item_logs',
        match: {
          type: 'log',
          level: [ 'info', 'debug' ],
          operation: '/processed|completed|done/',
        },
        decision: 'fold',
        reason: 'Fold batch item completion logs',
      }
    );
  }

  // Cache the result
  const frozenRules = Object.freeze(rules) as ReadonlyArray<NoiseRule>;
  builtinRulesCache.set(cacheKey, frozenRules);

  return frozenRules;
}

/**
 * Clear the builtin rules cache.
 * Primarily for testing purposes.
 */
export function clearBuiltinRulesCache(): void {
  builtinRulesCache.clear();
}
