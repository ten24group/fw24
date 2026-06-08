"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBuiltinRules = getBuiltinRules;
exports.clearBuiltinRulesCache = clearBuiltinRulesCache;
/**
 * Cache for builtin rules by preset combination.
 */
const builtinRulesCache = new Map();
/**
 * Get builtin rules for specified presets.
 * Results are cached for performance.
 *
 * @param presets - Array of preset names to activate
 * @returns Readonly array of builtin rules
 */
function getBuiltinRules(presets) {
    const cacheKey = [...presets].sort().join(',');
    const cached = builtinRulesCache.get(cacheKey);
    if (cached)
        return cached;
    const rules = [];
    // ═══════════════════════════════════════════════════════════════════════
    // PRESET: fw24.hotpaths
    // Safe defaults for framework hot paths (streams, audit, queries, API)
    // ═══════════════════════════════════════════════════════════════════════
    if (presets.includes('fw24.hotpaths')) {
        // ─────────────────────────────────────────────────────────────────────
        // Infrastructure Noise (health checks, warmups)
        // ─────────────────────────────────────────────────────────────────────
        rules.push({
            id: 'fw24.hotpaths.infra.silent_healthcheck',
            priority: 90,
            match: {
                type: 'span',
                operation: '/^(HTTP )?(GET|HEAD)\\s+\\/health/',
            },
            decision: 'silent',
            reason: 'Health check endpoints are infrastructure noise',
        }, {
            id: 'fw24.hotpaths.infra.silent_warmup',
            priority: 90,
            match: {
                type: 'span',
                tags: { source: 'warmup' },
            },
            decision: 'silent',
            reason: 'Lambda warmup invocations are infrastructure noise',
        });
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
                { level: ['error', 'critical', 'warn'] },
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
                { level: ['error', 'critical', 'warn'] },
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
        rules.push({
            id: 'fw24.hotpaths.task.silent_routine_success',
            priority: 5, // Very low: any user rule can easily override
            match: {
                type: 'span',
                tags: { handler_type: 'task' },
                success: true,
            },
            except: [
                { success: false },
                { level: ['error', 'critical', 'warn'] },
            ],
            decision: 'silent',
            reason: 'Silence successful task invocations (routine infrastructure noise)',
        }, {
            id: 'fw24.hotpaths.event_processor.silent_routine_success',
            priority: 5, // Very low: any user rule can easily override
            match: {
                type: 'span',
                tags: { handler_type: 'event_processor' },
                success: true,
            },
            except: [
                { success: false },
                { level: ['error', 'critical', 'warn'] },
            ],
            decision: 'silent',
            reason: 'Silence successful event processor invocations (routine infrastructure noise)',
        });
        // ─────────────────────────────────────────────────────────────────────
        // Stream Processors
        // ─────────────────────────────────────────────────────────────────────
        rules.push({
            id: 'fw24.hotpaths.stream.absorb_publish_done',
            match: {
                type: 'log',
                source: '/^DynamoDBStreamToSNSProcessor\\./',
                level: ['info', 'debug', 'trace'],
                operation: '/Publish (SNS|FIFO) done/',
            },
            decision: 'absorb',
            reason: 'Absorb stream publish completion logs into parent span',
        }, {
            id: 'fw24.hotpaths.stream.absorb_audit_done',
            match: {
                type: 'log',
                source: '/^DynamoDBStreamAuditLogger\\./',
                level: ['info', 'debug', 'trace'],
                operation: '/done|Captured (create|update|delete) audit/',
            },
            decision: 'absorb',
            reason: 'Absorb stream audit logger completion logs into parent span',
        }, {
            id: 'fw24.hotpaths.stream.silent_low_level_noise',
            match: {
                type: 'log',
                source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\./',
                level: ['trace', 'debug'],
            },
            decision: 'silent',
            reason: 'Silence low-level stream noise',
        }, {
            id: 'fw24.hotpaths.stream.silent_batch_spans',
            match: {
                type: 'span',
                source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\.process$/',
                operation: '/^aws:(sqs|dynamodb) DynamoDBStream/',
            },
            decision: 'silent',
            reason: 'Silence stream processor batch spans',
        });
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
                { level: ['error', 'critical'] },
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
                { level: ['error', 'critical', 'warn'] },
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
        rules.push({
            id: 'fw24.batch.absorb_item_processing',
            match: {
                type: 'span',
                operation: '/process(Item|Record|Message|Event)/',
                source: '/Processor\\./',
            },
            except: [{ success: false }],
            decision: 'absorb',
            reason: 'Absorb successful item processing spans into parent',
        }, {
            id: 'fw24.batch.absorb_item_logs',
            match: {
                type: 'log',
                level: ['info', 'debug'],
                operation: '/processed|completed|done/',
            },
            decision: 'absorb',
            reason: 'Absorb batch item completion logs into parent span',
        });
    }
    const frozenRules = Object.freeze(rules);
    builtinRulesCache.set(cacheKey, frozenRules);
    return frozenRules;
}
/**
 * Clear the builtin rules cache.
 * Primarily for testing purposes.
 */
function clearBuiltinRulesCache() {
    builtinRulesCache.clear();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbHRpbnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vcnVsZXMvYnVpbHRpbnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7R0FZRzs7QUFnQkgsMENBOFZDO0FBTUQsd0RBRUM7QUFsWEQ7O0dBRUc7QUFDSCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxFQUFnQyxDQUFDO0FBRWxFOzs7Ozs7R0FNRztBQUNILFNBQWdCLGVBQWUsQ0FBQyxPQUEwQjtJQUN4RCxNQUFNLFFBQVEsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRWpELE1BQU0sTUFBTSxHQUFHLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUMvQyxJQUFJLE1BQU07UUFBRSxPQUFPLE1BQU0sQ0FBQztJQUUxQixNQUFNLEtBQUssR0FBZ0IsRUFBRSxDQUFDO0lBRTlCLDBFQUEwRTtJQUMxRSx3QkFBd0I7SUFDeEIsdUVBQXVFO0lBQ3ZFLDBFQUEwRTtJQUUxRSxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztRQUN0Qyx3RUFBd0U7UUFDeEUsZ0RBQWdEO1FBQ2hELHdFQUF3RTtRQUV4RSxLQUFLLENBQUMsSUFBSSxDQUNSO1lBQ0UsRUFBRSxFQUFFLHdDQUF3QztZQUM1QyxRQUFRLEVBQUUsRUFBRTtZQUNaLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsTUFBTTtnQkFDWixTQUFTLEVBQUUsb0NBQW9DO2FBQ2hEO1lBQ0QsUUFBUSxFQUFFLFFBQVE7WUFDbEIsTUFBTSxFQUFFLGlEQUFpRDtTQUMxRCxFQUNEO1lBQ0UsRUFBRSxFQUFFLG1DQUFtQztZQUN2QyxRQUFRLEVBQUUsRUFBRTtZQUNaLEtBQUssRUFBRTtn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QUE0QjthQUN4QztZQUNELFFBQVEsRUFBRSxRQUFRO1lBQ2xCLE1BQU0sRUFBRSxvREFBb0Q7U0FDN0QsQ0FDRixDQUFDO0lBQ0osQ0FBQztJQUVELE1BQU0sV0FBVyxHQUF5QixNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQy9ELGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFFN0MsT0FBTyxXQUFXLENBQUM7QUFDckIsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQWdCLHNCQUFzQjtJQUNwQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBCdWlsdC1pbiBub2lzZSByZWR1Y3Rpb24gcnVsZXMgKHYyOiB0aHJlZS1kZWNpc2lvbiBtb2RlbCkuXG4gKiBcbiAqIFRoZXNlIHJ1bGVzIHByb3ZpZGUgc2Vuc2libGUgZGVmYXVsdHMgZm9yIGNvbW1vbiBmcmFtZXdvcmsgaG90IHBhdGhzLlxuICogQXBwbGljYXRpb25zIGNhbiBvdmVycmlkZSBvciBleHRlbmQgdGhlc2UgcnVsZXMgdmlhIGNvbmZpZ3VyYXRpb24uXG4gKiBcbiAqIERlY2lzaW9uIG1hcHBpbmcgZnJvbSB2MTpcbiAqIC0ga2VlcCAgICAgIOKGkiBlbWl0XG4gKiAtIGZvbGQgICAgICDihpIgYWJzb3JiIChzdHJ1Y3R1cmVkIGluZm8gb24gcGFyZW50KVxuICogLSBhZ2dyZWdhdGUg4oaSIGFic29yYiAoc3RydWN0dXJlZCBpbmZvIG9uIHBhcmVudClcbiAqIC0gZHJvcCAgICAgIOKGkiBzaWxlbnQgKGNvdW50ZXIgb25seSlcbiAqIC0gZG93bmdyYWRlIOKGkiByZW1vdmVkICh1c2UgYWJzb3JiIG9yIHNpbGVudCBpbnN0ZWFkKVxuICovXG5cbmltcG9ydCB0eXBlIHsgTm9pc2VSdWxlIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuXG4vKipcbiAqIENhY2hlIGZvciBidWlsdGluIHJ1bGVzIGJ5IHByZXNldCBjb21iaW5hdGlvbi5cbiAqL1xuY29uc3QgYnVpbHRpblJ1bGVzQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgcmVhZG9ubHkgTm9pc2VSdWxlW10+KCk7XG5cbi8qKlxuICogR2V0IGJ1aWx0aW4gcnVsZXMgZm9yIHNwZWNpZmllZCBwcmVzZXRzLlxuICogUmVzdWx0cyBhcmUgY2FjaGVkIGZvciBwZXJmb3JtYW5jZS5cbiAqIFxuICogQHBhcmFtIHByZXNldHMgLSBBcnJheSBvZiBwcmVzZXQgbmFtZXMgdG8gYWN0aXZhdGVcbiAqIEByZXR1cm5zIFJlYWRvbmx5IGFycmF5IG9mIGJ1aWx0aW4gcnVsZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEJ1aWx0aW5SdWxlcyhwcmVzZXRzOiByZWFkb25seSBzdHJpbmdbXSk6IHJlYWRvbmx5IE5vaXNlUnVsZVtdIHtcbiAgY29uc3QgY2FjaGVLZXkgPSBbIC4uLnByZXNldHMgXS5zb3J0KCkuam9pbignLCcpO1xuXG4gIGNvbnN0IGNhY2hlZCA9IGJ1aWx0aW5SdWxlc0NhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmIChjYWNoZWQpIHJldHVybiBjYWNoZWQ7XG5cbiAgY29uc3QgcnVsZXM6IE5vaXNlUnVsZVtdID0gW107XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBSRVNFVDogZncyNC5ob3RwYXRoc1xuICAvLyBTYWZlIGRlZmF1bHRzIGZvciBmcmFtZXdvcmsgaG90IHBhdGhzIChzdHJlYW1zLCBhdWRpdCwgcXVlcmllcywgQVBJKVxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBpZiAocHJlc2V0cy5pbmNsdWRlcygnZncyNC5ob3RwYXRocycpKSB7XG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gSW5mcmFzdHJ1Y3R1cmUgTm9pc2UgKGhlYWx0aCBjaGVja3MsIHdhcm11cHMpXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICBydWxlcy5wdXNoKFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuaW5mcmEuc2lsZW50X2hlYWx0aGNoZWNrJyxcbiAgICAgICAgcHJpb3JpdHk6IDkwLFxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBvcGVyYXRpb246ICcvXihIVFRQICk/KEdFVHxIRUFEKVxcXFxzK1xcXFwvaGVhbHRoLycsXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgcmVhc29uOiAnSGVhbHRoIGNoZWNrIGVuZHBvaW50cyBhcmUgaW5mcmFzdHJ1Y3R1cmUgbm9pc2UnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmluZnJhLnNpbGVudF93YXJtdXAnLFxuICAgICAgICBwcmlvcml0eTogOTAsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIHRhZ3M6IHsgc291cmNlOiAnd2FybXVwJyB9LFxuICAgICAgICB9LFxuICAgICAgICBkZWNpc2lvbjogJ3NpbGVudCcsXG4gICAgICAgIHJlYXNvbjogJ0xhbWJkYSB3YXJtdXAgaW52b2NhdGlvbnMgYXJlIGluZnJhc3RydWN0dXJlIG5vaXNlJyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIERhdGFiYXNlIFF1ZXJ5IE5vaXNlIFJlZHVjdGlvblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgLy8gSElHSEVTVCBQUklPUklUWTogRW1pdCBxdWVyeSBlcnJvcnMgYXMgc3RhbmRhbG9uZSByZWNvcmRzXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMucXVlcmllcy5lbWl0X2Vycm9ycycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2VtaXQnLFxuICAgICAgcmVhc29uOiAnRW1pdCBxdWVyeSBlcnJvcnMgYXMgc3RhbmRhbG9uZSByZWNvcmRzIGZvciBkZWJ1Z2dpbmcnLFxuICAgIH0pO1xuXG4gICAgLy8gRW1pdCB0YWJsZSBzY2FucyAoYWx3YXlzIHdvcnRoIGludmVzdGlnYXRpbmcpXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMucXVlcmllcy5lbWl0X3NjYW5zJyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIHRhZ3M6IHsgc2NhbjogJ3RydWUnIH0sXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdlbWl0JyxcbiAgICAgIHJlYXNvbjogJ0VtaXQgdGFibGUgc2NhbiBvcGVyYXRpb25zIGFzIHN0YW5kYWxvbmUgd2FybmluZ3MnLFxuICAgIH0pO1xuXG4gICAgLy8gRW1pdCBzbG93IHF1ZXJpZXMgZm9yIGludmVzdGlnYXRpb25cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmVtaXRfc2xvdycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBtaW5EdXJhdGlvbk1zOiAxMDAwLFxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAnZW1pdCcsXG4gICAgICByZWFzb246ICdFbWl0IHNsb3cgcXVlcmllcyAoPj0xMDAwbXMpIGFzIHN0YW5kYWxvbmUgcmVjb3JkcycsXG4gICAgfSk7XG5cbiAgICAvLyBBYnNvcmIgc3VjY2Vzc2Z1bCBSRUFEIHF1ZXJpZXMgaW50byBwYXJlbnQgc3Bhbi5cbiAgICAvLyBXcml0ZSBxdWVyaWVzIChjcmVhdGUsIHVwc2VydCwgdXBkYXRlLCBkZWxldGUpIGFyZSBrZXB0IGFzIHRpbWVsaW5lXG4gICAgLy8gZW50cmllcyBiZWNhdXNlIHRoZXkgcmVwcmVzZW50IGFjdHVhbCBkYXRhIG11dGF0aW9ucyB3b3J0aCB0cmFja2luZy5cbiAgICAvLyBFcnJvcnMsIHNjYW5zLCBhbmQgc2xvdyBxdWVyaWVzICg+PTFzKSBhcmUgYWxyZWFkeSBoYW5kbGVkIGFib3ZlIHdpdGhcbiAgICAvLyBoaWdoZXItcHJpb3JpdHkgZW1pdCBydWxlcy5cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmFic29yYl9yZWFkX3F1ZXJpZXMnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnL1xcXFwuKGdldHxiYXRjaEdldHxsaXN0fHF1ZXJ5fHNjYW58ZmluZHxmZXRjaHxyZWFkKSg/OlxcXFwofCQpLycsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgcmVhc29uOiAnQWJzb3JiIHN1Y2Nlc3NmdWwgcmVhZCBxdWVyaWVzIGludG8gcGFyZW50IHNwYW4gKHdyaXRlIHF1ZXJpZXMgcHJlc2VydmVkIGZvciB0aW1lbGluZSknLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gQVBJIFJlYWQgT3BlcmF0aW9uc1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuYXBpLnNpbGVudF9mYXN0X3N1Y2Nlc3NmdWxfcmVhZHMnLFxuICAgICAgcHJpb3JpdHk6IDEwLCAvLyBMb3cgcHJpb3JpdHkgLSBlYXN5IHRvIG92ZXJyaWRlXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9wZXJhdGlvbjogJy9eKEhUVFAgKT8oR0VUfEhFQUR8T1BUSU9OUylcXFxcc3xcXFxcLihsaXN0fGdldHxyZWFkfGZldGNofGZpbmQpKD86WygvXXwkKXxcXFxcLyhsaXN0fGdldHxyZWFkfGZldGNofGZpbmQpKD86Wy8/XXwkKS8nLFxuICAgICAgICBtYXhEdXJhdGlvbk1zOiA1MDAwLFxuICAgICAgfSxcbiAgICAgIGV4Y2VwdDogW1xuICAgICAgICB7IHN1Y2Nlc3M6IGZhbHNlIH0sXG4gICAgICAgIHsgbGV2ZWw6IFsgJ2Vycm9yJywgJ2NyaXRpY2FsJywgJ3dhcm4nIF0gfSxcbiAgICAgIF0sXG4gICAgICBkZWNpc2lvbjogJ3NpbGVudCcsXG4gICAgICByZWFzb246ICdTaWxlbmNlIGZhc3Qgc3VjY2Vzc2Z1bCByZWFkIG9wZXJhdGlvbnMgKDw1cyknLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gQXV0aCBPcGVyYXRpb25zXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5hdXRoLnNpbGVudF9yb3V0aW5lX2F1dGgnLFxuICAgICAgcHJpb3JpdHk6IDEwLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvcGVyYXRpb246ICcvXihIVFRQICk/KFBPU1R8R0VUKVxcXFxzLipcXFxcLyhhdXRofG1hdXRofG9hdXRofHRva2VufGxvZ2lufGxvZ291dHxyZWZyZXNofGNyZWRlbnRpYWxzfHNlc3Npb24pXFxcXC8/fF5BdXRoW0EtWmEtejAtOV0qXFxcXC4oZ2V0fHJlZnJlc2h8dmFsaWRhdGV8dmVyaWZ5fGNoZWNrfGxvZ2lufGxvZ291dCkvJyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogNTAwMCxcbiAgICAgIH0sXG4gICAgICBleGNlcHQ6IFtcbiAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LFxuICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcsICd3YXJuJyBdIH0sXG4gICAgICBdLFxuICAgICAgZGVjaXNpb246ICdzaWxlbnQnLFxuICAgICAgcmVhc29uOiAnU2lsZW5jZSByb3V0aW5lIGF1dGggb3BlcmF0aW9ucyAoPDVzKSAtIGVycm9ycy9mYWlsdXJlcy9zbG93L3dhcm5pbmdzIGFyZSBlbWl0dGVkJyxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIFJvdXRpbmUgVGFzayAmIEV2ZW50IFByb2Nlc3NvciBJbnZvY2F0aW9uc1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIFN1Y2Nlc3NmdWwsIGVycm9yLWZyZWUgcm9vdCBzcGFucyBmb3Igc2NoZWR1bGVkIHRhc2tzIGFuZCBzdHJlYW1cbiAgICAvLyBwcm9jZXNzb3JzIGFyZSBpbmZyYXN0cnVjdHVyZSBub2lzZS4gQ29tYmluZWQgd2l0aCByb290IHN1cHByZXNzaW9uXG4gICAgLy8gaW4gdGhlIGFsZ29yaXRobSwgZW50aXJlIG5vaXNlLW9ubHkgaW52b2NhdGlvbnMgYXJlIGRyb3BwZWQuXG5cbiAgICBydWxlcy5wdXNoKFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMudGFzay5zaWxlbnRfcm91dGluZV9zdWNjZXNzJyxcbiAgICAgICAgcHJpb3JpdHk6IDUsIC8vIFZlcnkgbG93OiBhbnkgdXNlciBydWxlIGNhbiBlYXNpbHkgb3ZlcnJpZGVcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICd0YXNrJyB9LFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGV4Y2VwdDogW1xuICAgICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSxcbiAgICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcsICd3YXJuJyBdIH0sXG4gICAgICAgIF0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgcmVhc29uOiAnU2lsZW5jZSBzdWNjZXNzZnVsIHRhc2sgaW52b2NhdGlvbnMgKHJvdXRpbmUgaW5mcmFzdHJ1Y3R1cmUgbm9pc2UpJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5ldmVudF9wcm9jZXNzb3Iuc2lsZW50X3JvdXRpbmVfc3VjY2VzcycsXG4gICAgICAgIHByaW9yaXR5OiA1LCAvLyBWZXJ5IGxvdzogYW55IHVzZXIgcnVsZSBjYW4gZWFzaWx5IG92ZXJyaWRlXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAnZXZlbnRfcHJvY2Vzc29yJyB9LFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGV4Y2VwdDogW1xuICAgICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSxcbiAgICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcsICd3YXJuJyBdIH0sXG4gICAgICAgIF0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgcmVhc29uOiAnU2lsZW5jZSBzdWNjZXNzZnVsIGV2ZW50IHByb2Nlc3NvciBpbnZvY2F0aW9ucyAocm91dGluZSBpbmZyYXN0cnVjdHVyZSBub2lzZSknLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gU3RyZWFtIFByb2Nlc3NvcnNcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICAgIHJ1bGVzLnB1c2goXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5zdHJlYW0uYWJzb3JiX3B1Ymxpc2hfZG9uZScsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgc291cmNlOiAnL15EeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yXFxcXC4vJyxcbiAgICAgICAgICBsZXZlbDogWyAnaW5mbycsICdkZWJ1ZycsICd0cmFjZScgXSxcbiAgICAgICAgICBvcGVyYXRpb246ICcvUHVibGlzaCAoU05TfEZJRk8pIGRvbmUvJyxcbiAgICAgICAgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgICByZWFzb246ICdBYnNvcmIgc3RyZWFtIHB1Ymxpc2ggY29tcGxldGlvbiBsb2dzIGludG8gcGFyZW50IHNwYW4nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnN0cmVhbS5hYnNvcmJfYXVkaXRfZG9uZScsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgc291cmNlOiAnL15EeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyXFxcXC4vJyxcbiAgICAgICAgICBsZXZlbDogWyAnaW5mbycsICdkZWJ1ZycsICd0cmFjZScgXSxcbiAgICAgICAgICBvcGVyYXRpb246ICcvZG9uZXxDYXB0dXJlZCAoY3JlYXRlfHVwZGF0ZXxkZWxldGUpIGF1ZGl0LycsXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgICAgcmVhc29uOiAnQWJzb3JiIHN0cmVhbSBhdWRpdCBsb2dnZXIgY29tcGxldGlvbiBsb2dzIGludG8gcGFyZW50IHNwYW4nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnN0cmVhbS5zaWxlbnRfbG93X2xldmVsX25vaXNlJyxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtKFRvU05TUHJvY2Vzc29yfEF1ZGl0TG9nZ2VyKVxcXFwuLycsXG4gICAgICAgICAgbGV2ZWw6IFsgJ3RyYWNlJywgJ2RlYnVnJyBdLFxuICAgICAgICB9LFxuICAgICAgICBkZWNpc2lvbjogJ3NpbGVudCcsXG4gICAgICAgIHJlYXNvbjogJ1NpbGVuY2UgbG93LWxldmVsIHN0cmVhbSBub2lzZScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc3RyZWFtLnNpbGVudF9iYXRjaF9zcGFucycsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW0oVG9TTlNQcm9jZXNzb3J8QXVkaXRMb2dnZXIpXFxcXC5wcm9jZXNzJC8nLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9eYXdzOihzcXN8ZHluYW1vZGIpIER5bmFtb0RCU3RyZWFtLycsXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgcmVhc29uOiAnU2lsZW5jZSBzdHJlYW0gcHJvY2Vzc29yIGJhdGNoIHNwYW5zJyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEVudGl0eSBPcGVyYXRpb25zXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5lbnRpdHkuYWJzb3JiX3dyaXRlX3NwYW5zJyxcbiAgICAgIHByaW9yaXR5OiA1MCxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnL0Jhc2VFbnRpdHlTZXJ2aWNlXFxcXC4oY3JlYXRlfHVwc2VydHx1cGRhdGUpLycsXG4gICAgICAgIHNvdXJjZTogJy9ec2VydmljZTpCYXNlRW50aXR5U2VydmljZVxcXFwuLycsXG4gICAgICB9LFxuICAgICAgZXhjZXB0OiBbXG4gICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSxcbiAgICAgICAgeyBsZXZlbDogWyAnZXJyb3InLCAnY3JpdGljYWwnIF0gfSxcbiAgICAgIF0sXG4gICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICByZWFzb246ICdBYnNvcmIgc3VjY2Vzc2Z1bCBlbnRpdHkgd3JpdGUgc3BhbnMgaW50byBwYXJlbnQnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gSW50ZXJuYWwgU2VydmljZSBMYXllciBTcGFuc1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIFNlcnZpY2UtbGF5ZXIgc3BhbnMgKG9wZXJhdGlvbjogXCJzZXJ2aWNlOkNsYXNzTmFtZS5tZXRob2RcIikgYXJlXG4gICAgLy8gaW1wbGVtZW50YXRpb24gZGV0YWlscy4gV2hlbiBzdWNjZXNzZnVsLCB0aGV5IGFkZCBub2lzZSB3aXRob3V0IHZhbHVlXG4gICAgLy8g4oCUIHRoZSBwYXJlbnQgc3BhbiBhbHJlYWR5IGNhcHR1cmVzIHRoZSBvdXRjb21lLiBFcnJvcnMgYW5kIHNsb3dcbiAgICAvLyBvcGVyYXRpb25zIGFyZSBwcm90ZWN0ZWQgYnkgaGFyZC1zaWduYWwgbG9naWMgYW5kIGFsd2F5cyBlbWl0dGVkLlxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc2VydmljZS5hYnNvcmJfcm91dGluZV9zdWNjZXNzJyxcbiAgICAgIHByaW9yaXR5OiA1LCAvLyBWZXJ5IGxvdzogZWFzeSB0byBvdmVycmlkZVxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvcGVyYXRpb246ICcvXnNlcnZpY2U6LycsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIG1heER1cmF0aW9uTXM6IDUwMDAsXG4gICAgICB9LFxuICAgICAgZXhjZXB0OiBbXG4gICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSxcbiAgICAgICAgeyBsZXZlbDogWyAnZXJyb3InLCAnY3JpdGljYWwnLCAnd2FybicgXSB9LFxuICAgICAgXSxcbiAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgIHJlYXNvbjogJ0Fic29yYiBzdWNjZXNzZnVsIHNlcnZpY2UtbGF5ZXIgc3BhbnMgaW50byBwYXJlbnQgKGVycm9ycy9zbG93IHByZXNlcnZlZCknLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gQVBJIENPUlMgLyBQcmVmbGlnaHQgTm9pc2VcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmFwaS5zaWxlbnRfb3B0aW9uc19jb3JzJyxcbiAgICAgIHByaW9yaXR5OiA5NSwgLy8gSGlnaCBwcmlvcml0eSDigJQgT1BUSU9OUyByZXF1ZXN0cyBhcmUgcHVyZSBpbmZyYXN0cnVjdHVyZSBub2lzZVxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvcGVyYXRpb246ICcvXkhUVFAgT1BUSU9OU1xcXFxzLycsXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdzaWxlbnQnLFxuICAgICAgcmVhc29uOiAnU2lsZW5jZSBDT1JTIHByZWZsaWdodCBPUFRJT05TIHJlcXVlc3RzJyxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEZhdmljb24gTm9pc2VcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmFwaS5zaWxlbnRfZmF2aWNvbicsXG4gICAgICBwcmlvcml0eTogOTUsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9wZXJhdGlvbjogJy9mYXZpY29uXFxcXC5pY28vJyxcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ3NpbGVudCcsXG4gICAgICByZWFzb246ICdTaWxlbmNlIGZhdmljb24uaWNvIHJlcXVlc3RzJyxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIFN1Y2Nlc3NmdWwgV3JpdGUgUXVlcnkgQWJzb3JwdGlvblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMucXVlcmllcy5hYnNvcmJfd3JpdGVfc3VjY2VzcycsXG4gICAgICBwcmlvcml0eTogMzAsIC8vIExvd2VyIHRoYW4gZXJyb3Ivc2Nhbi9zbG93IGVtaXQgcnVsZXNcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIG9wZXJhdGlvbjogJy9cXFxcLihjcmVhdGV8dXBzZXJ0fHVwZGF0ZXxkZWxldGV8YmF0Y2hEZWxldGV8cHV0fGJhdGNoV3JpdGUpKD86XFxcXCh8JCkvJyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICByZWFzb246ICdBYnNvcmIgc3VjY2Vzc2Z1bCB3cml0ZSBxdWVyaWVzIGludG8gcGFyZW50IHNwYW4gKGVycm9ycy9zbG93IHByZXNlcnZlZCknLFxuICAgIH0pO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBSRVNFVDogZncyNC5iYXRjaF9wcm9jZXNzb3JzXG4gIC8vIEFnZ3Jlc3NpdmUgbm9pc2UgcmVkdWN0aW9uIGZvciBiYXRjaCBwcm9jZXNzaW5nIHNjZW5hcmlvc1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBpZiAocHJlc2V0cy5pbmNsdWRlcygnZncyNC5iYXRjaF9wcm9jZXNzb3JzJykpIHtcbiAgICBydWxlcy5wdXNoKFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuYmF0Y2guYWJzb3JiX2l0ZW1fcHJvY2Vzc2luZycsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9wcm9jZXNzKEl0ZW18UmVjb3JkfE1lc3NhZ2V8RXZlbnQpLycsXG4gICAgICAgICAgc291cmNlOiAnL1Byb2Nlc3NvclxcXFwuLycsXG4gICAgICAgIH0sXG4gICAgICAgIGV4Y2VwdDogWyB7IHN1Y2Nlc3M6IGZhbHNlIH0gXSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgICByZWFzb246ICdBYnNvcmIgc3VjY2Vzc2Z1bCBpdGVtIHByb2Nlc3Npbmcgc3BhbnMgaW50byBwYXJlbnQnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmJhdGNoLmFic29yYl9pdGVtX2xvZ3MnLFxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiBbICdpbmZvJywgJ2RlYnVnJyBdLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9wcm9jZXNzZWR8Y29tcGxldGVkfGRvbmUvJyxcbiAgICAgICAgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgICByZWFzb246ICdBYnNvcmIgYmF0Y2ggaXRlbSBjb21wbGV0aW9uIGxvZ3MgaW50byBwYXJlbnQgc3BhbicsXG4gICAgICB9LFxuICAgICk7XG4gIH1cblxuICBjb25zdCBmcm96ZW5SdWxlczogcmVhZG9ubHkgTm9pc2VSdWxlW10gPSBPYmplY3QuZnJlZXplKHJ1bGVzKTtcbiAgYnVpbHRpblJ1bGVzQ2FjaGUuc2V0KGNhY2hlS2V5LCBmcm96ZW5SdWxlcyk7XG5cbiAgcmV0dXJuIGZyb3plblJ1bGVzO1xufVxuXG4vKipcbiAqIENsZWFyIHRoZSBidWlsdGluIHJ1bGVzIGNhY2hlLlxuICogUHJpbWFyaWx5IGZvciB0ZXN0aW5nIHB1cnBvc2VzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJCdWlsdGluUnVsZXNDYWNoZSgpOiB2b2lkIHtcbiAgYnVpbHRpblJ1bGVzQ2FjaGUuY2xlYXIoKTtcbn1cbiJdfQ==