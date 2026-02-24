/**
 * Built-in noise reduction rules (v2: three-decision model).
 *
 * These rules provide sensible defaults for common framework hot paths.
 * Applications can override or extend these rules via configuration.
 *
 * Decision mapping from v1:
 * - keep      → emit
 * - fold      → absorb (structured info on parent)
 * - aggregate → absorb (structured info on parent)
 * - drop      → silent (counter only)
 * - downgrade → removed (use absorb or silent instead)
 */

import type { NoiseRule } from '../../types';

/**
 * Cache for builtin rules by preset combination.
 */
const builtinRulesCache = new Map<string, readonly NoiseRule[]>();

/**
 * Get builtin rules for specified presets.
 * Results are cached for performance.
 *
 * @param presets - Array of preset names to activate
 * @returns Readonly array of builtin rules
 */
export function getBuiltinRules(presets: readonly string[]): readonly NoiseRule[] {
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
    // Infrastructure Noise (health checks, warmups)
    // ─────────────────────────────────────────────────────────────────────

    rules.push(
      {
        id: 'fw24.hotpaths.infra.silent_healthcheck',
        priority: 90,
        match: {
          type: 'span',
          operation: '/^(HTTP )?(GET|HEAD)\\s+\\/health/',
        },
        decision: 'silent',
        reason: 'Health check endpoints are infrastructure noise',
      },
      {
        id: 'fw24.hotpaths.infra.silent_warmup',
        priority: 90,
        match: {
          type: 'span',
          tags: { source: 'warmup' },
        },
        decision: 'silent',
        reason: 'Lambda warmup invocations are infrastructure noise',
      },
    );

    // ─────────────────────────────────────────────────────────────────────
    // Database Query Noise Reduction
    // ─────────────────────────────────────────────────────────────────────

    // HIGHEST PRIORITY: Emit query errors as standalone records
    rules.push({
      id: 'fw24.hotpaths.queries.emit_errors',
      match: {
        type: 'database.query',
        success: false,
      },
      decision: 'emit',
      reason: 'Emit query errors as standalone records for debugging',
    });

    // Emit table scans (always worth investigating)
    rules.push({
      id: 'fw24.hotpaths.queries.emit_scans',
      match: {
        type: 'database.query',
        tags: { scan: 'true' },
      },
      decision: 'emit',
      reason: 'Emit table scan operations as standalone warnings',
    });

    // Emit slow queries for investigation
    rules.push({
      id: 'fw24.hotpaths.queries.emit_slow',
      match: {
        type: 'database.query',
        minDurationMs: 1000,
      },
      decision: 'emit',
      reason: 'Emit slow queries (>=1000ms) as standalone records',
    });

    // Absorb successful READ queries into parent span.
    // Write queries (create, upsert, update, delete) are kept as timeline
    // entries because they represent actual data mutations worth tracking.
    // Errors, scans, and slow queries (>=1s) are already handled above with
    // higher-priority emit rules.
    rules.push({
      id: 'fw24.hotpaths.queries.absorb_read_queries',
      match: {
        type: 'database.query',
        operation: '/\\.(get|batchGet|list|query|scan|find|fetch|read)(?:\\(|$)/',
        success: true,
      },
      decision: 'absorb',
      reason: 'Absorb successful read queries into parent span (write queries preserved for timeline)',
    });

    // ─────────────────────────────────────────────────────────────────────
    // API Read Operations
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.api.silent_fast_successful_reads',
      priority: 10, // Low priority - easy to override
      match: {
        type: 'span',
        operation: '/^(HTTP )?(GET|HEAD|OPTIONS)\\s|\\.(list|get|read|fetch|find)(?:[(/]|$)|\\/(list|get|read|fetch|find)(?:[/?]|$)/',
        maxDurationMs: 5000,
      },
      except: [
        { success: false },
        { level: [ 'error', 'critical', 'warn' ] },
      ],
      decision: 'silent',
      reason: 'Silence fast successful read operations (<5s)',
    });

    // ─────────────────────────────────────────────────────────────────────
    // Auth Operations
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.auth.silent_routine_auth',
      priority: 10,
      match: {
        type: 'span',
        operation: '/^(HTTP )?(POST|GET)\\s.*\\/(auth|mauth|oauth|token|login|logout|refresh|credentials|session)\\/?|^Auth[A-Za-z0-9]*\\.(get|refresh|validate|verify|check|login|logout)/',
        maxDurationMs: 5000,
      },
      except: [
        { success: false },
        { level: [ 'error', 'critical', 'warn' ] },
      ],
      decision: 'silent',
      reason: 'Silence routine auth operations (<5s) - errors/failures/slow/warnings are emitted',
    });

    // ─────────────────────────────────────────────────────────────────────
    // Routine Task & Event Processor Invocations
    // ─────────────────────────────────────────────────────────────────────
    // Successful, error-free root spans for scheduled tasks and stream
    // processors are infrastructure noise. Combined with root suppression
    // in the algorithm, entire noise-only invocations are dropped.

    rules.push(
      {
        id: 'fw24.hotpaths.task.silent_routine_success',
        priority: 5, // Very low: any user rule can easily override
        match: {
          type: 'span',
          tags: { handler_type: 'task' },
          success: true,
        },
        except: [
          { success: false },
          { level: [ 'error', 'critical', 'warn' ] },
        ],
        decision: 'silent',
        reason: 'Silence successful task invocations (routine infrastructure noise)',
      },
      {
        id: 'fw24.hotpaths.event_processor.silent_routine_success',
        priority: 5, // Very low: any user rule can easily override
        match: {
          type: 'span',
          tags: { handler_type: 'event_processor' },
          success: true,
        },
        except: [
          { success: false },
          { level: [ 'error', 'critical', 'warn' ] },
        ],
        decision: 'silent',
        reason: 'Silence successful event processor invocations (routine infrastructure noise)',
      },
    );

    // ─────────────────────────────────────────────────────────────────────
    // Stream Processors
    // ─────────────────────────────────────────────────────────────────────

    rules.push(
      {
        id: 'fw24.hotpaths.stream.absorb_publish_done',
        match: {
          type: 'log',
          source: '/^DynamoDBStreamToSNSProcessor\\./',
          level: [ 'info', 'debug', 'trace' ],
          operation: '/Publish (SNS|FIFO) done/',
        },
        decision: 'absorb',
        reason: 'Absorb stream publish completion logs into parent span',
      },
      {
        id: 'fw24.hotpaths.stream.absorb_audit_done',
        match: {
          type: 'log',
          source: '/^DynamoDBStreamAuditLogger\\./',
          level: [ 'info', 'debug', 'trace' ],
          operation: '/done|Captured (create|update|delete) audit/',
        },
        decision: 'absorb',
        reason: 'Absorb stream audit logger completion logs into parent span',
      },
      {
        id: 'fw24.hotpaths.stream.silent_low_level_noise',
        match: {
          type: 'log',
          source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\./',
          level: [ 'trace', 'debug' ],
        },
        decision: 'silent',
        reason: 'Silence low-level stream noise',
      },
      {
        id: 'fw24.hotpaths.stream.silent_batch_spans',
        match: {
          type: 'span',
          source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\.process$/',
          operation: '/^aws:(sqs|dynamodb) DynamoDBStream/',
        },
        decision: 'silent',
        reason: 'Silence stream processor batch spans',
      },
    );

    // ─────────────────────────────────────────────────────────────────────
    // Entity Operations
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.entity.absorb_write_spans',
      priority: 50,
      match: {
        type: 'span',
        operation: '/BaseEntityService\\.(create|upsert|update)/',
        source: '/^service:BaseEntityService\\./',
      },
      except: [
        { success: false },
        { level: [ 'error', 'critical' ] },
      ],
      decision: 'absorb',
      reason: 'Absorb successful entity write spans into parent',
    });

    // ─────────────────────────────────────────────────────────────────────
    // Internal Service Layer Spans
    // ─────────────────────────────────────────────────────────────────────
    // Service-layer spans (operation: "service:ClassName.method") are
    // implementation details. When successful, they add noise without value
    // — the parent span already captures the outcome. Errors and slow
    // operations are protected by hard-signal logic and always emitted.

    rules.push({
      id: 'fw24.hotpaths.service.absorb_routine_success',
      priority: 5, // Very low: easy to override
      match: {
        type: 'span',
        operation: '/^service:/',
        success: true,
        maxDurationMs: 5000,
      },
      except: [
        { success: false },
        { level: [ 'error', 'critical', 'warn' ] },
      ],
      decision: 'absorb',
      reason: 'Absorb successful service-layer spans into parent (errors/slow preserved)',
    });

    // ─────────────────────────────────────────────────────────────────────
    // API CORS / Preflight Noise
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.api.silent_options_cors',
      priority: 95, // High priority — OPTIONS requests are pure infrastructure noise
      match: {
        type: 'span',
        operation: '/^HTTP OPTIONS\\s/',
      },
      decision: 'silent',
      reason: 'Silence CORS preflight OPTIONS requests',
    });

    // ─────────────────────────────────────────────────────────────────────
    // Favicon Noise
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.api.silent_favicon',
      priority: 95,
      match: {
        type: 'span',
        operation: '/favicon\\.ico/',
      },
      decision: 'silent',
      reason: 'Silence favicon.ico requests',
    });

    // ─────────────────────────────────────────────────────────────────────
    // Successful Write Query Absorption
    // ─────────────────────────────────────────────────────────────────────

    rules.push({
      id: 'fw24.hotpaths.queries.absorb_write_success',
      priority: 30, // Lower than error/scan/slow emit rules
      match: {
        type: 'database.query',
        operation: '/\\.(create|upsert|update|delete|batchDelete|put|batchWrite)(?:\\(|$)/',
        success: true,
      },
      decision: 'absorb',
      reason: 'Absorb successful write queries into parent span (errors/slow preserved)',
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRESET: fw24.batch_processors
  // Aggressive noise reduction for batch processing scenarios
  // ═══════════════════════════════════════════════════════════════════════

  if (presets.includes('fw24.batch_processors')) {
    rules.push(
      {
        id: 'fw24.batch.absorb_item_processing',
        match: {
          type: 'span',
          operation: '/process(Item|Record|Message|Event)/',
          source: '/Processor\\./',
        },
        except: [ { success: false } ],
        decision: 'absorb',
        reason: 'Absorb successful item processing spans into parent',
      },
      {
        id: 'fw24.batch.absorb_item_logs',
        match: {
          type: 'log',
          level: [ 'info', 'debug' ],
          operation: '/processed|completed|done/',
        },
        decision: 'absorb',
        reason: 'Absorb batch item completion logs into parent span',
      },
    );
  }

  const frozenRules: readonly NoiseRule[] = Object.freeze(rules);
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
