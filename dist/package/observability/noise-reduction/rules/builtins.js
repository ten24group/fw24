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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbHRpbnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vcnVsZXMvYnVpbHRpbnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7R0FZRzs7QUFnQkgsMENBcVVDO0FBTUQsd0RBRUM7QUF6VkQ7O0dBRUc7QUFDSCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxFQUFnQyxDQUFDO0FBRWxFOzs7Ozs7R0FNRztBQUNILFNBQWdCLGVBQWUsQ0FBQyxPQUEwQjtJQUN4RCxNQUFNLFFBQVEsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRWpELE1BQU0sTUFBTSxHQUFHLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUMvQyxJQUFJLE1BQU07UUFBRSxPQUFPLE1BQU0sQ0FBQztJQUUxQixNQUFNLEtBQUssR0FBZ0IsRUFBRSxDQUFDO0lBRTlCLDBFQUEwRTtJQUMxRSx3QkFBd0I7SUFDeEIsdUVBQXVFO0lBQ3ZFLDBFQUEwRTtJQUUxRSxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztRQUN0Qyx3RUFBd0U7UUFDeEUsZ0RBQWdEO1FBQ2hELHdFQUF3RTtRQUV4RSxLQUFLLENBQUMsSUFBSSxDQUNSO1lBQ0UsRUFBRSxFQUFFLHdDQUF3QztZQUM1QyxRQUFRLEVBQUUsRUFBRTtZQUNaLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsTUFBTTtnQkFDWixTQUFTLEVBQUUsb0NBQW9DO2FBQ2hEO1lBQ0QsUUFBUSxFQUFFLFFBQVE7WUFDbEIsTUFBTSxFQUFFLGlEQUFpRDtTQUMxRCxFQUNEO1lBQ0UsRUFBRSxFQUFFLG1DQUFtQztZQUN2QyxRQUFRLEVBQUUsRUFBRTtZQUNaLEtBQUssRUFBRTtn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LGdDQUFnQztJQUNoQyw0REFBNEQ7SUFDNUQsMEVBQTBFO0lBRTFFLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLENBQUM7UUFDOUMsS0FBSyxDQUFDLElBQUksQ0FDUjtZQUNFLEVBQUUsRUFBRSxtQ0FBbUM7WUFDdkMsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxNQUFNO2dCQUNaLFNBQVMsRUFBRSxzQ0FBc0M7Z0JBQ2pELE1BQU0sRUFBRSxnQkFBZ0I7YUFDekI7WUFDRCxNQUFNLEVBQUUsQ0FBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBRTtZQUM5QixRQUFRLEVBQUUsUUFBUTtZQUNsQixNQUFNLEVBQUUscURBQXFEO1NBQzlELEVBQ0Q7WUFDRSxFQUFFLEVBQUUsNkJBQTZCO1lBQ2pDLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsS0FBSztnQkFDWCxLQUFLLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxDQUFFO2dCQUMxQixTQUFTLEVBQUUsNEJBQTRCO2FBQ3hDO1lBQ0QsUUFBUSxFQUFFLFFBQVE7WUFDbEIsTUFBTSxFQUFFLG9EQUFvRDtTQUM3RCxDQUNGLENBQUM7SUFDSixDQUFDO0lBRUQsTUFBTSxXQUFXLEdBQXlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDL0QsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUU3QyxPQUFPLFdBQVcsQ0FBQztBQUNyQixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0Isc0JBQXNCO0lBQ3BDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxDQUFDO0FBQzVCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEJ1aWx0LWluIG5vaXNlIHJlZHVjdGlvbiBydWxlcyAodjI6IHRocmVlLWRlY2lzaW9uIG1vZGVsKS5cbiAqIFxuICogVGhlc2UgcnVsZXMgcHJvdmlkZSBzZW5zaWJsZSBkZWZhdWx0cyBmb3IgY29tbW9uIGZyYW1ld29yayBob3QgcGF0aHMuXG4gKiBBcHBsaWNhdGlvbnMgY2FuIG92ZXJyaWRlIG9yIGV4dGVuZCB0aGVzZSBydWxlcyB2aWEgY29uZmlndXJhdGlvbi5cbiAqIFxuICogRGVjaXNpb24gbWFwcGluZyBmcm9tIHYxOlxuICogLSBrZWVwICAgICAg4oaSIGVtaXRcbiAqIC0gZm9sZCAgICAgIOKGkiBhYnNvcmIgKHN0cnVjdHVyZWQgaW5mbyBvbiBwYXJlbnQpXG4gKiAtIGFnZ3JlZ2F0ZSDihpIgYWJzb3JiIChzdHJ1Y3R1cmVkIGluZm8gb24gcGFyZW50KVxuICogLSBkcm9wICAgICAg4oaSIHNpbGVudCAoY291bnRlciBvbmx5KVxuICogLSBkb3duZ3JhZGUg4oaSIHJlbW92ZWQgKHVzZSBhYnNvcmIgb3Igc2lsZW50IGluc3RlYWQpXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBOb2lzZVJ1bGUgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5cbi8qKlxuICogQ2FjaGUgZm9yIGJ1aWx0aW4gcnVsZXMgYnkgcHJlc2V0IGNvbWJpbmF0aW9uLlxuICovXG5jb25zdCBidWlsdGluUnVsZXNDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCByZWFkb25seSBOb2lzZVJ1bGVbXT4oKTtcblxuLyoqXG4gKiBHZXQgYnVpbHRpbiBydWxlcyBmb3Igc3BlY2lmaWVkIHByZXNldHMuXG4gKiBSZXN1bHRzIGFyZSBjYWNoZWQgZm9yIHBlcmZvcm1hbmNlLlxuICogXG4gKiBAcGFyYW0gcHJlc2V0cyAtIEFycmF5IG9mIHByZXNldCBuYW1lcyB0byBhY3RpdmF0ZVxuICogQHJldHVybnMgUmVhZG9ubHkgYXJyYXkgb2YgYnVpbHRpbiBydWxlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0QnVpbHRpblJ1bGVzKHByZXNldHM6IHJlYWRvbmx5IHN0cmluZ1tdKTogcmVhZG9ubHkgTm9pc2VSdWxlW10ge1xuICBjb25zdCBjYWNoZUtleSA9IFsgLi4ucHJlc2V0cyBdLnNvcnQoKS5qb2luKCcsJyk7XG5cbiAgY29uc3QgY2FjaGVkID0gYnVpbHRpblJ1bGVzQ2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgaWYgKGNhY2hlZCkgcmV0dXJuIGNhY2hlZDtcblxuICBjb25zdCBydWxlczogTm9pc2VSdWxlW10gPSBbXTtcblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gUFJFU0VUOiBmdzI0LmhvdHBhdGhzXG4gIC8vIFNhZmUgZGVmYXVsdHMgZm9yIGZyYW1ld29yayBob3QgcGF0aHMgKHN0cmVhbXMsIGF1ZGl0LCBxdWVyaWVzLCBBUEkpXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGlmIChwcmVzZXRzLmluY2x1ZGVzKCdmdzI0LmhvdHBhdGhzJykpIHtcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBJbmZyYXN0cnVjdHVyZSBOb2lzZSAoaGVhbHRoIGNoZWNrcywgd2FybXVwcylcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICAgIHJ1bGVzLnB1c2goXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5pbmZyYS5zaWxlbnRfaGVhbHRoY2hlY2snLFxuICAgICAgICBwcmlvcml0eTogOTAsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9eKEhUVFAgKT8oR0VUfEhFQUQpXFxcXHMrXFxcXC9oZWFsdGgvJyxcbiAgICAgICAgfSxcbiAgICAgICAgZGVjaXNpb246ICdzaWxlbnQnLFxuICAgICAgICByZWFzb246ICdIZWFsdGggY2hlY2sgZW5kcG9pbnRzIGFyZSBpbmZyYXN0cnVjdHVyZSBub2lzZScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuaW5mcmEuc2lsZW50X3dhcm11cCcsXG4gICAgICAgIHByaW9yaXR5OiA5MCxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgdGFnczogeyBzb3VyY2U6ICd3YXJtdXAnIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgcmVhc29uOiAnTGFtYmRhIHdhcm11cCBpbnZvY2F0aW9ucyBhcmUgaW5mcmFzdHJ1Y3R1cmUgbm9pc2UnLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gRGF0YWJhc2UgUXVlcnkgTm9pc2UgUmVkdWN0aW9uXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICAvLyBISUdIRVNUIFBSSU9SSVRZOiBFbWl0IHF1ZXJ5IGVycm9ycyBhcyBzdGFuZGFsb25lIHJlY29yZHNcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmVtaXRfZXJyb3JzJyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAnZW1pdCcsXG4gICAgICByZWFzb246ICdFbWl0IHF1ZXJ5IGVycm9ycyBhcyBzdGFuZGFsb25lIHJlY29yZHMgZm9yIGRlYnVnZ2luZycsXG4gICAgfSk7XG5cbiAgICAvLyBFbWl0IHRhYmxlIHNjYW5zIChhbHdheXMgd29ydGggaW52ZXN0aWdhdGluZylcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmVtaXRfc2NhbnMnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgdGFnczogeyBzY2FuOiAndHJ1ZScgfSxcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2VtaXQnLFxuICAgICAgcmVhc29uOiAnRW1pdCB0YWJsZSBzY2FuIG9wZXJhdGlvbnMgYXMgc3RhbmRhbG9uZSB3YXJuaW5ncycsXG4gICAgfSk7XG5cbiAgICAvLyBFbWl0IHNsb3cgcXVlcmllcyBmb3IgaW52ZXN0aWdhdGlvblxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuZW1pdF9zbG93JyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIG1pbkR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdlbWl0JyxcbiAgICAgIHJlYXNvbjogJ0VtaXQgc2xvdyBxdWVyaWVzICg+PTEwMDBtcykgYXMgc3RhbmRhbG9uZSByZWNvcmRzJyxcbiAgICB9KTtcblxuICAgIC8vIEFic29yYiBzdWNjZXNzZnVsIFJFQUQgcXVlcmllcyBpbnRvIHBhcmVudCBzcGFuLlxuICAgIC8vIFdyaXRlIHF1ZXJpZXMgKGNyZWF0ZSwgdXBzZXJ0LCB1cGRhdGUsIGRlbGV0ZSkgYXJlIGtlcHQgYXMgdGltZWxpbmVcbiAgICAvLyBlbnRyaWVzIGJlY2F1c2UgdGhleSByZXByZXNlbnQgYWN0dWFsIGRhdGEgbXV0YXRpb25zIHdvcnRoIHRyYWNraW5nLlxuICAgIC8vIEVycm9ycywgc2NhbnMsIGFuZCBzbG93IHF1ZXJpZXMgKD49MXMpIGFyZSBhbHJlYWR5IGhhbmRsZWQgYWJvdmUgd2l0aFxuICAgIC8vIGhpZ2hlci1wcmlvcml0eSBlbWl0IHJ1bGVzLlxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuYWJzb3JiX3JlYWRfcXVlcmllcycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBvcGVyYXRpb246ICcvXFxcXC4oZ2V0fGJhdGNoR2V0fGxpc3R8cXVlcnl8c2NhbnxmaW5kfGZldGNofHJlYWQpKD86XFxcXCh8JCkvJyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICByZWFzb246ICdBYnNvcmIgc3VjY2Vzc2Z1bCByZWFkIHF1ZXJpZXMgaW50byBwYXJlbnQgc3BhbiAod3JpdGUgcXVlcmllcyBwcmVzZXJ2ZWQgZm9yIHRpbWVsaW5lKScsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBBUEkgUmVhZCBPcGVyYXRpb25zXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5hcGkuc2lsZW50X2Zhc3Rfc3VjY2Vzc2Z1bF9yZWFkcycsXG4gICAgICBwcmlvcml0eTogMTAsIC8vIExvdyBwcmlvcml0eSAtIGVhc3kgdG8gb3ZlcnJpZGVcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnL14oSFRUUCApPyhHRVR8SEVBRHxPUFRJT05TKVxcXFxzfFxcXFwuKGxpc3R8Z2V0fHJlYWR8ZmV0Y2h8ZmluZCkoPzpbKC9dfCQpfFxcXFwvKGxpc3R8Z2V0fHJlYWR8ZmV0Y2h8ZmluZCkoPzpbLz9dfCQpLycsXG4gICAgICAgIG1heER1cmF0aW9uTXM6IDUwMDAsXG4gICAgICB9LFxuICAgICAgZXhjZXB0OiBbXG4gICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSxcbiAgICAgICAgeyBsZXZlbDogWyAnZXJyb3InLCAnY3JpdGljYWwnLCAnd2FybicgXSB9LFxuICAgICAgXSxcbiAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIHJlYXNvbjogJ1NpbGVuY2UgZmFzdCBzdWNjZXNzZnVsIHJlYWQgb3BlcmF0aW9ucyAoPDVzKScsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBBdXRoIE9wZXJhdGlvbnNcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmF1dGguc2lsZW50X3JvdXRpbmVfYXV0aCcsXG4gICAgICBwcmlvcml0eTogMTAsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9wZXJhdGlvbjogJy9eKEhUVFAgKT8oUE9TVHxHRVQpXFxcXHMuKlxcXFwvKGF1dGh8bWF1dGh8b2F1dGh8dG9rZW58bG9naW58bG9nb3V0fHJlZnJlc2h8Y3JlZGVudGlhbHN8c2Vzc2lvbilcXFxcLz98XkF1dGhbQS1aYS16MC05XSpcXFxcLihnZXR8cmVmcmVzaHx2YWxpZGF0ZXx2ZXJpZnl8Y2hlY2t8bG9naW58bG9nb3V0KS8nLFxuICAgICAgICBtYXhEdXJhdGlvbk1zOiA1MDAwLFxuICAgICAgfSxcbiAgICAgIGV4Y2VwdDogW1xuICAgICAgICB7IHN1Y2Nlc3M6IGZhbHNlIH0sXG4gICAgICAgIHsgbGV2ZWw6IFsgJ2Vycm9yJywgJ2NyaXRpY2FsJywgJ3dhcm4nIF0gfSxcbiAgICAgIF0sXG4gICAgICBkZWNpc2lvbjogJ3NpbGVudCcsXG4gICAgICByZWFzb246ICdTaWxlbmNlIHJvdXRpbmUgYXV0aCBvcGVyYXRpb25zICg8NXMpIC0gZXJyb3JzL2ZhaWx1cmVzL3Nsb3cvd2FybmluZ3MgYXJlIGVtaXR0ZWQnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gUm91dGluZSBUYXNrICYgRXZlbnQgUHJvY2Vzc29yIEludm9jYXRpb25zXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gU3VjY2Vzc2Z1bCwgZXJyb3ItZnJlZSByb290IHNwYW5zIGZvciBzY2hlZHVsZWQgdGFza3MgYW5kIHN0cmVhbVxuICAgIC8vIHByb2Nlc3NvcnMgYXJlIGluZnJhc3RydWN0dXJlIG5vaXNlLiBDb21iaW5lZCB3aXRoIHJvb3Qgc3VwcHJlc3Npb25cbiAgICAvLyBpbiB0aGUgYWxnb3JpdGhtLCBlbnRpcmUgbm9pc2Utb25seSBpbnZvY2F0aW9ucyBhcmUgZHJvcHBlZC5cblxuICAgIHJ1bGVzLnB1c2goXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy50YXNrLnNpbGVudF9yb3V0aW5lX3N1Y2Nlc3MnLFxuICAgICAgICBwcmlvcml0eTogNSwgLy8gVmVyeSBsb3c6IGFueSB1c2VyIHJ1bGUgY2FuIGVhc2lseSBvdmVycmlkZVxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0sXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgZXhjZXB0OiBbXG4gICAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LFxuICAgICAgICAgIHsgbGV2ZWw6IFsgJ2Vycm9yJywgJ2NyaXRpY2FsJywgJ3dhcm4nIF0gfSxcbiAgICAgICAgXSxcbiAgICAgICAgZGVjaXNpb246ICdzaWxlbnQnLFxuICAgICAgICByZWFzb246ICdTaWxlbmNlIHN1Y2Nlc3NmdWwgdGFzayBpbnZvY2F0aW9ucyAocm91dGluZSBpbmZyYXN0cnVjdHVyZSBub2lzZSknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmV2ZW50X3Byb2Nlc3Nvci5zaWxlbnRfcm91dGluZV9zdWNjZXNzJyxcbiAgICAgICAgcHJpb3JpdHk6IDUsIC8vIFZlcnkgbG93OiBhbnkgdXNlciBydWxlIGNhbiBlYXNpbHkgb3ZlcnJpZGVcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InIH0sXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgZXhjZXB0OiBbXG4gICAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LFxuICAgICAgICAgIHsgbGV2ZWw6IFsgJ2Vycm9yJywgJ2NyaXRpY2FsJywgJ3dhcm4nIF0gfSxcbiAgICAgICAgXSxcbiAgICAgICAgZGVjaXNpb246ICdzaWxlbnQnLFxuICAgICAgICByZWFzb246ICdTaWxlbmNlIHN1Y2Nlc3NmdWwgZXZlbnQgcHJvY2Vzc29yIGludm9jYXRpb25zIChyb3V0aW5lIGluZnJhc3RydWN0dXJlIG5vaXNlKScsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBTdHJlYW0gUHJvY2Vzc29yc1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaChcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnN0cmVhbS5hYnNvcmJfcHVibGlzaF9kb25lJyxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3JcXFxcLi8nLFxuICAgICAgICAgIGxldmVsOiBbICdpbmZvJywgJ2RlYnVnJywgJ3RyYWNlJyBdLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9QdWJsaXNoIChTTlN8RklGTykgZG9uZS8nLFxuICAgICAgICB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICAgIHJlYXNvbjogJ0Fic29yYiBzdHJlYW0gcHVibGlzaCBjb21wbGV0aW9uIGxvZ3MgaW50byBwYXJlbnQgc3BhbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc3RyZWFtLmFic29yYl9hdWRpdF9kb25lJyxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXJcXFxcLi8nLFxuICAgICAgICAgIGxldmVsOiBbICdpbmZvJywgJ2RlYnVnJywgJ3RyYWNlJyBdLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9kb25lfENhcHR1cmVkIChjcmVhdGV8dXBkYXRlfGRlbGV0ZSkgYXVkaXQvJyxcbiAgICAgICAgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgICByZWFzb246ICdBYnNvcmIgc3RyZWFtIGF1ZGl0IGxvZ2dlciBjb21wbGV0aW9uIGxvZ3MgaW50byBwYXJlbnQgc3BhbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc3RyZWFtLnNpbGVudF9sb3dfbGV2ZWxfbm9pc2UnLFxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW0oVG9TTlNQcm9jZXNzb3J8QXVkaXRMb2dnZXIpXFxcXC4vJyxcbiAgICAgICAgICBsZXZlbDogWyAndHJhY2UnLCAnZGVidWcnIF0sXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgcmVhc29uOiAnU2lsZW5jZSBsb3ctbGV2ZWwgc3RyZWFtIG5vaXNlJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5zdHJlYW0uc2lsZW50X2JhdGNoX3NwYW5zJyxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgc291cmNlOiAnL15EeW5hbW9EQlN0cmVhbShUb1NOU1Byb2Nlc3NvcnxBdWRpdExvZ2dlcilcXFxcLnByb2Nlc3MkLycsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnL15hd3M6KHNxc3xkeW5hbW9kYikgRHluYW1vREJTdHJlYW0vJyxcbiAgICAgICAgfSxcbiAgICAgICAgZGVjaXNpb246ICdzaWxlbnQnLFxuICAgICAgICByZWFzb246ICdTaWxlbmNlIHN0cmVhbSBwcm9jZXNzb3IgYmF0Y2ggc3BhbnMnLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gRW50aXR5IE9wZXJhdGlvbnNcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmVudGl0eS5hYnNvcmJfd3JpdGVfc3BhbnMnLFxuICAgICAgcHJpb3JpdHk6IDUwLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvcGVyYXRpb246ICcvQmFzZUVudGl0eVNlcnZpY2VcXFxcLihjcmVhdGV8dXBzZXJ0fHVwZGF0ZSkvJyxcbiAgICAgICAgc291cmNlOiAnL15zZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlXFxcXC4vJyxcbiAgICAgIH0sXG4gICAgICBleGNlcHQ6IFtcbiAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LFxuICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSB9LFxuICAgICAgXSxcbiAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgIHJlYXNvbjogJ0Fic29yYiBzdWNjZXNzZnVsIGVudGl0eSB3cml0ZSBzcGFucyBpbnRvIHBhcmVudCcsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBBUEkgQ09SUyAvIFByZWZsaWdodCBOb2lzZVxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuYXBpLnNpbGVudF9vcHRpb25zX2NvcnMnLFxuICAgICAgcHJpb3JpdHk6IDk1LCAvLyBIaWdoIHByaW9yaXR5IOKAlCBPUFRJT05TIHJlcXVlc3RzIGFyZSBwdXJlIGluZnJhc3RydWN0dXJlIG5vaXNlXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9wZXJhdGlvbjogJy9eSFRUUCBPUFRJT05TXFxcXHMvJyxcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ3NpbGVudCcsXG4gICAgICByZWFzb246ICdTaWxlbmNlIENPUlMgcHJlZmxpZ2h0IE9QVElPTlMgcmVxdWVzdHMnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gRmF2aWNvbiBOb2lzZVxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuYXBpLnNpbGVudF9mYXZpY29uJyxcbiAgICAgIHByaW9yaXR5OiA5NSxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnL2Zhdmljb25cXFxcLmljby8nLFxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIHJlYXNvbjogJ1NpbGVuY2UgZmF2aWNvbi5pY28gcmVxdWVzdHMnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gU3VjY2Vzc2Z1bCBXcml0ZSBRdWVyeSBBYnNvcnB0aW9uXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmFic29yYl93cml0ZV9zdWNjZXNzJyxcbiAgICAgIHByaW9yaXR5OiAzMCwgLy8gTG93ZXIgdGhhbiBlcnJvci9zY2FuL3Nsb3cgZW1pdCBydWxlc1xuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnL1xcXFwuKGNyZWF0ZXx1cHNlcnR8dXBkYXRlfGRlbGV0ZXxiYXRjaERlbGV0ZXxwdXR8YmF0Y2hXcml0ZSkoPzpcXFxcKHwkKS8nLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgIHJlYXNvbjogJ0Fic29yYiBzdWNjZXNzZnVsIHdyaXRlIHF1ZXJpZXMgaW50byBwYXJlbnQgc3BhbiAoZXJyb3JzL3Nsb3cgcHJlc2VydmVkKScsXG4gICAgfSk7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gUFJFU0VUOiBmdzI0LmJhdGNoX3Byb2Nlc3NvcnNcbiAgLy8gQWdncmVzc2l2ZSBub2lzZSByZWR1Y3Rpb24gZm9yIGJhdGNoIHByb2Nlc3Npbmcgc2NlbmFyaW9zXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGlmIChwcmVzZXRzLmluY2x1ZGVzKCdmdzI0LmJhdGNoX3Byb2Nlc3NvcnMnKSkge1xuICAgIHJ1bGVzLnB1c2goXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5iYXRjaC5hYnNvcmJfaXRlbV9wcm9jZXNzaW5nJyxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnL3Byb2Nlc3MoSXRlbXxSZWNvcmR8TWVzc2FnZXxFdmVudCkvJyxcbiAgICAgICAgICBzb3VyY2U6ICcvUHJvY2Vzc29yXFxcXC4vJyxcbiAgICAgICAgfSxcbiAgICAgICAgZXhjZXB0OiBbIHsgc3VjY2VzczogZmFsc2UgfSBdLFxuICAgICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICAgIHJlYXNvbjogJ0Fic29yYiBzdWNjZXNzZnVsIGl0ZW0gcHJvY2Vzc2luZyBzcGFucyBpbnRvIHBhcmVudCcsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuYmF0Y2guYWJzb3JiX2l0ZW1fbG9ncycsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6IFsgJ2luZm8nLCAnZGVidWcnIF0sXG4gICAgICAgICAgb3BlcmF0aW9uOiAnL3Byb2Nlc3NlZHxjb21wbGV0ZWR8ZG9uZS8nLFxuICAgICAgICB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICAgIHJlYXNvbjogJ0Fic29yYiBiYXRjaCBpdGVtIGNvbXBsZXRpb24gbG9ncyBpbnRvIHBhcmVudCBzcGFuJyxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGZyb3plblJ1bGVzOiByZWFkb25seSBOb2lzZVJ1bGVbXSA9IE9iamVjdC5mcmVlemUocnVsZXMpO1xuICBidWlsdGluUnVsZXNDYWNoZS5zZXQoY2FjaGVLZXksIGZyb3plblJ1bGVzKTtcblxuICByZXR1cm4gZnJvemVuUnVsZXM7XG59XG5cbi8qKlxuICogQ2xlYXIgdGhlIGJ1aWx0aW4gcnVsZXMgY2FjaGUuXG4gKiBQcmltYXJpbHkgZm9yIHRlc3RpbmcgcHVycG9zZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhckJ1aWx0aW5SdWxlc0NhY2hlKCk6IHZvaWQge1xuICBidWlsdGluUnVsZXNDYWNoZS5jbGVhcigpO1xufVxuIl19