"use strict";
/**
 * Built-in noise reduction rules.
 *
 * These rules provide sensible defaults for common framework hot paths.
 * Applications can override or extend these rules via configuration.
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
 * @returns Array of builtin rules
 */
function getBuiltinRules(presets) {
    // Create cache key from sorted presets (order-independent)
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
                { success: false }, // Never drop failures
                { level: ['error', 'critical', 'warn'] }, // Never drop warnings/errors
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
                { success: false }, // Never drop auth failures
                { level: ['error', 'critical', 'warn'] }, // Never drop auth warnings/errors
            ],
            decision: 'drop',
            reason: 'Drop routine auth operations (<5 S) - errors/failures/slow/warnings are kept',
        });
        // ─────────────────────────────────────────────────────────────────────
        // Stream Processors
        // ─────────────────────────────────────────────────────────────────────
        rules.push({
            id: 'fw24.hotpaths.stream.fold_publish_done',
            match: {
                type: 'log',
                source: '/^DynamoDBStreamToSNSProcessor\\./',
                level: ['info', 'debug', 'trace'],
                operation: '/Publish (SNS|FIFO) done/',
            },
            decision: 'fold',
            reason: 'Fold noisy stream publish completion logs',
        }, {
            id: 'fw24.hotpaths.stream.fold_audit_done',
            match: {
                type: 'log',
                source: '/^DynamoDBStreamAuditLogger\\./',
                level: ['info', 'debug', 'trace'],
                operation: '/done|Captured (create|update|delete) audit/',
            },
            decision: 'fold',
            reason: 'Fold noisy stream audit logger logs',
        }, {
            id: 'fw24.hotpaths.stream.drop_info_noise',
            match: {
                type: 'log',
                source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\./',
                level: ['trace', 'debug'],
            },
            decision: 'drop',
            reason: 'Drop low-level stream noise',
        }, {
            id: 'fw24.hotpaths.stream.drop_batch_spans',
            match: {
                type: 'span',
                source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\.process$/',
                operation: '/^aws:(sqs|dynamodb) DynamoDBStream/',
            },
            decision: 'drop',
            reason: 'Drop stream processor batch spans',
        });
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
                { success: false }, // Keep failed writes
                { level: ['error', 'critical'] }, // Keep error writes
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
        rules.push({
            id: 'fw24.batch.aggregate_item_processing',
            match: {
                type: 'span',
                operation: '/process(Item|Record|Message|Event)/',
                source: '/Processor\\./',
            },
            except: [{ success: false }],
            decision: 'aggregate',
            reason: 'Aggregate successful item processing spans',
        }, {
            id: 'fw24.batch.fold_item_logs',
            match: {
                type: 'log',
                level: ['info', 'debug'],
                operation: '/processed|completed|done/',
            },
            decision: 'fold',
            reason: 'Fold batch item completion logs',
        });
    }
    // Cache the result
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbHRpbnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vcnVsZXMvYnVpbHRpbnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOztBQWdCSCwwQ0FvTkM7QUFNRCx3REFFQztBQXhPRDs7R0FFRztBQUNILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQW9DLENBQUM7QUFFdEU7Ozs7OztHQU1HO0FBQ0gsU0FBZ0IsZUFBZSxDQUFDLE9BQTBCO0lBQ3hELDJEQUEyRDtJQUMzRCxNQUFNLFFBQVEsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRWpELE1BQU0sTUFBTSxHQUFHLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUMvQyxJQUFJLE1BQU07UUFBRSxPQUFPLE1BQU0sQ0FBQztJQUUxQixNQUFNLEtBQUssR0FBZ0IsRUFBRSxDQUFDO0lBRTlCLDBFQUEwRTtJQUMxRSx3QkFBd0I7SUFDeEIsdUVBQXVFO0lBQ3ZFLDBFQUEwRTtJQUUxRSxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztRQUN0Qyx3RUFBd0U7UUFDeEUsaUNBQWlDO1FBQ2pDLHdFQUF3RTtRQUV4RSxzQ0FBc0M7UUFDdEMsS0FBSyxDQUFDLElBQUksQ0FBQztZQUNULEVBQUUsRUFBRSxtQ0FBbUM7WUFDdkMsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLE9BQU8sRUFBRSxLQUFLO2FBQ2Y7WUFDRCxRQUFRLEVBQUUsTUFBTTtZQUNoQixNQUFNLEVBQUUsb0RBQW9EO1NBQzdELENBQUMsQ0FBQztRQUVILG1EQUFtRDtRQUNuRCxLQUFLLENBQUMsSUFBSSxDQUFDO1lBQ1QsRUFBRSxFQUFFLGtDQUFrQztZQUN0QyxLQUFLLEVBQUU7Z0JBQ0wsSUFBSSxFQUFFLGdCQUFnQjtnQkFDdEIsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRTthQUN2QjtZQUNELFFBQVEsRUFBRSxNQUFNO1lBQ2hCLE1BQU0sRUFBRSxtREFBbUQ7U0FDNUQsQ0FBQyxDQUFDO1FBRUgsc0NBQXNDO1FBQ3RDLEtBQUssQ0FBQyxJQUFJLENBQUM7WUFDVCxFQUFFLEVBQUUsaUNBQWlDO1lBQ3JDLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsZ0JBQWdCO2dCQUN0QixhQUFhLEVBQUUsSUFBSTthQUNwQjtZQUNELFFBQVEsRUFBRSxNQUFNO1lBQ2hCLE1BQU0sRUFBRSxpREFBaUQ7U0FDMUQsQ0FBQyxDQUFDO1FBRUgsZ0RBQWdEO1FBQ2hELEtBQUssQ0FBQyxJQUFJLENBQUM7WUFDVCxFQUFFLEVBQUUseUNBQXlDO1lBQzdDLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsZ0JBQWdCO2dCQUN0QixhQUFhLEVBQUUsR0FBRztnQkFDbEIsT0FBTyxFQUFFLElBQUk7YUFDZDtZQUNELFFBQVEsRUFBRSxNQUFNO1lBQ2hCLE1BQU0sRUFBRSx3REFBd0Q7U0FDakUsQ0FBQyxDQUFDO1FBRUgsd0VBQXdFO1FBQ3hFLHNCQUFzQjtRQUN0Qix3RUFBd0U7UUFFeEUsS0FBSyxDQUFDLElBQUksQ0FBQztZQUNULEVBQUUsRUFBRSw4Q0FBOEM7WUFDbEQsUUFBUSxFQUFFLEVBQUUsRUFBRSxrQ0FBa0M7WUFDaEQsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxNQUFNO2dCQUNaLHlFQUF5RTtnQkFDekUsU0FBUyxFQUFFLGtIQUFrSDtnQkFDN0gsYUFBYSxFQUFFLElBQUk7YUFDcEI7WUFDRCxNQUFNLEVBQUU7Z0JBQ04sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEVBQTBCLHNCQUFzQjtnQkFDbEUsRUFBRSxLQUFLLEVBQUUsQ0FBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sQ0FBRSxFQUFFLEVBQUUsNkJBQTZCO2FBQzFFO1lBQ0QsUUFBUSxFQUFFLE1BQU07WUFDaEIsTUFBTSxFQUFFLDZDQUE2QztTQUN0RCxDQUFDLENBQUM7UUFFSCx3RUFBd0U7UUFDeEUsa0JBQWtCO1FBQ2xCLHdFQUF3RTtRQUV4RSxLQUFLLENBQUMsSUFBSSxDQUFDO1lBQ1QsRUFBRSxFQUFFLHNDQUFzQztZQUMxQyxRQUFRLEVBQUUsRUFBRSxFQUFFLGtDQUFrQztZQUNoRCxLQUFLLEVBQUU7Z0JBQ0wsSUFBSSxFQUFFLE1BQU07Z0JBQ1osZ0VBQWdFO2dCQUNoRSxTQUFTLEVBQUUseUtBQXlLO2dCQUNwTCxhQUFhLEVBQUUsSUFBSTthQUNwQjtZQUNELE1BQU0sRUFBRTtnQkFDTixFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBMEIsMkJBQTJCO2dCQUN2RSxFQUFFLEtBQUssRUFBRSxDQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxDQUFFLEVBQUUsRUFBRSxrQ0FBa0M7YUFDL0U7WUFDRCxRQUFRLEVBQUUsTUFBTTtZQUNoQixNQUFNLEVBQUUsOEVBQThFO1NBQ3ZGLENBQUMsQ0FBQztRQUVILHdFQUF3RTtRQUN4RSxvQkFBb0I7UUFDcEIsd0VBQXdFO1FBRXhFLEtBQUssQ0FBQyxJQUFJLENBQ1I7WUFDRSxFQUFFLEVBQUUsd0NBQXdDO1lBQzVDLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsS0FBSztnQkFDWCxNQUFNLEVBQUUsb0NBQW9DO2dCQUM1QyxLQUFLLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBRTtnQkFDbkMsU0FBUyxFQUFFLDJCQUEyQjthQUN2QztZQUNELFFBQVEsRUFBRSxNQUFNO1lBQ2hCLE1BQU0sRUFBRSwyQ0FBMkM7U0FDcEQsRUFDRDtZQUNFLEVBQUUsRUFBRSxzQ0FBc0M7WUFDMUMsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxLQUFLO2dCQUNYLE1BQU0sRUFBRSxpQ0FBaUM7Z0JBQ3pDLEtBQUssRUFBRSxDQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFFO2dCQUNuQyxTQUFTLEVBQUUsOENBQThDO2FBQzFEO1lBQ0QsUUFBUSxFQUFFLE1BQU07WUFDaEIsTUFBTSxFQUFFLHFDQUFxQztTQUM5QyxFQUNEO1lBQ0UsRUFBRSxFQUFFLHNDQUFzQztZQUMxQyxLQUFLLEVBQUU7Z0JBQ0wsSUFBSSxFQUFFLEtBQUs7Z0JBQ1gsTUFBTSxFQUFFLGtEQUFrRDtnQkFDMUQsS0FBSyxFQUFFLENBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBRTthQUM1QjtZQUNELFFBQVEsRUFBRSxNQUFNO1lBQ2hCLE1BQU0sRUFBRSw2QkFBNkI7U0FDdEMsRUFDRDtZQUNFLEVBQUUsRUFBRSx1Q0FBdUM7WUFDM0MsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxNQUFNO2dCQUNaLE1BQU0sRUFBRSwwREFBMEQ7Z0JBQ2xFLFNBQVMsRUFBRSxzQ0FBc0M7YUFDbEQ7WUFDRCxRQUFRLEVBQUUsTUFBTTtZQUNoQixNQUFNLEVBQUUsbUNBQW1DO1NBQzVDLENBQ0YsQ0FBQztRQUVGLHdFQUF3RTtRQUN4RSxvQkFBb0I7UUFDcEIsd0VBQXdFO1FBRXhFLEtBQUssQ0FBQyxJQUFJLENBQUM7WUFDVCxFQUFFLEVBQUUsNkNBQTZDO1lBQ2pELFFBQVEsRUFBRSxFQUFFLEVBQUUsNkJBQTZCO1lBQzNDLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsTUFBTTtnQkFDWixTQUFTLEVBQUUsdUNBQXVDO2dCQUNsRCxNQUFNLEVBQUUsaUNBQWlDO2FBQzFDO1lBQ0QsTUFBTSxFQUFFO2dCQUNOLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxFQUFpQixxQkFBcUI7Z0JBQ3hELEVBQUUsS0FBSyxFQUFFLENBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBRSxFQUFFLEVBQUcsb0JBQW9CO2FBQzFEO1lBQ0QsUUFBUSxFQUFFLFdBQVc7WUFDckIsTUFBTSxFQUFFLHFEQUFxRDtTQUM5RCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsMEVBQTBFO0lBQzFFLGdDQUFnQztJQUNoQyw0REFBNEQ7SUFDNUQsMEVBQTBFO0lBRTFFLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLENBQUM7UUFDOUMsS0FBSyxDQUFDLElBQUksQ0FDUjtZQUNFLEVBQUUsRUFBRSxzQ0FBc0M7WUFDMUMsS0FBSyxFQUFFO2dCQUNMLElBQUksRUFBRSxNQUFNO2dCQUNaLFNBQVMsRUFBRSxzQ0FBc0M7Z0JBQ2pELE1BQU0sRUFBRSxnQkFBZ0I7YUFDekI7WUFDRCxNQUFNLEVBQUUsQ0FBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBRTtZQUM5QixRQUFRLEVBQUUsV0FBVztZQUNyQixNQUFNLEVBQUUsNENBQTRDO1NBQ3JELEVBQ0Q7WUFDRSxFQUFFLEVBQUUsMkJBQTJCO1lBQy9CLEtBQUssRUFBRTtnQkFDTCxJQUFJLEVBQUUsS0FBSztnQkFDWCxLQUFLLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxDQUFFO2dCQUMxQixTQUFTLEVBQUUsNEJBQTRCO2FBQ3hDO1lBQ0QsUUFBUSxFQUFFLE1BQU07WUFDaEIsTUFBTSxFQUFFLGlDQUFpQztTQUMxQyxDQUNGLENBQUM7SUFDSixDQUFDO0lBRUQsbUJBQW1CO0lBQ25CLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUE2QixDQUFDO0lBQ3JFLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFFN0MsT0FBTyxXQUFXLENBQUM7QUFDckIsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQWdCLHNCQUFzQjtJQUNwQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUM1QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBCdWlsdC1pbiBub2lzZSByZWR1Y3Rpb24gcnVsZXMuXG4gKiBcbiAqIFRoZXNlIHJ1bGVzIHByb3ZpZGUgc2Vuc2libGUgZGVmYXVsdHMgZm9yIGNvbW1vbiBmcmFtZXdvcmsgaG90IHBhdGhzLlxuICogQXBwbGljYXRpb25zIGNhbiBvdmVycmlkZSBvciBleHRlbmQgdGhlc2UgcnVsZXMgdmlhIGNvbmZpZ3VyYXRpb24uXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBOb2lzZVJ1bGUgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5cbi8qKlxuICogQ2FjaGUgZm9yIGJ1aWx0aW4gcnVsZXMgYnkgcHJlc2V0IGNvbWJpbmF0aW9uLlxuICovXG5jb25zdCBidWlsdGluUnVsZXNDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBSZWFkb25seUFycmF5PE5vaXNlUnVsZT4+KCk7XG5cbi8qKlxuICogR2V0IGJ1aWx0aW4gcnVsZXMgZm9yIHNwZWNpZmllZCBwcmVzZXRzLlxuICogUmVzdWx0cyBhcmUgY2FjaGVkIGZvciBwZXJmb3JtYW5jZS5cbiAqIFxuICogQHBhcmFtIHByZXNldHMgLSBBcnJheSBvZiBwcmVzZXQgbmFtZXMgdG8gYWN0aXZhdGVcbiAqIEByZXR1cm5zIEFycmF5IG9mIGJ1aWx0aW4gcnVsZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEJ1aWx0aW5SdWxlcyhwcmVzZXRzOiByZWFkb25seSBzdHJpbmdbXSk6IFJlYWRvbmx5QXJyYXk8Tm9pc2VSdWxlPiB7XG4gIC8vIENyZWF0ZSBjYWNoZSBrZXkgZnJvbSBzb3J0ZWQgcHJlc2V0cyAob3JkZXItaW5kZXBlbmRlbnQpXG4gIGNvbnN0IGNhY2hlS2V5ID0gWyAuLi5wcmVzZXRzIF0uc29ydCgpLmpvaW4oJywnKTtcblxuICBjb25zdCBjYWNoZWQgPSBidWlsdGluUnVsZXNDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICBpZiAoY2FjaGVkKSByZXR1cm4gY2FjaGVkO1xuXG4gIGNvbnN0IHJ1bGVzOiBOb2lzZVJ1bGVbXSA9IFtdO1xuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBQUkVTRVQ6IGZ3MjQuaG90cGF0aHNcbiAgLy8gU2FmZSBkZWZhdWx0cyBmb3IgZnJhbWV3b3JrIGhvdCBwYXRocyAoc3RyZWFtcywgYXVkaXQsIHF1ZXJpZXMsIEFQSSlcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgaWYgKHByZXNldHMuaW5jbHVkZXMoJ2Z3MjQuaG90cGF0aHMnKSkge1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIERhdGFiYXNlIFF1ZXJ5IE5vaXNlIFJlZHVjdGlvblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgLy8gSElHSEVTVCBQUklPUklUWTogS2VlcCBxdWVyeSBlcnJvcnNcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmtlZXBfZXJyb3JzJyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICByZWFzb246ICdLZWVwIHF1ZXJ5IGVycm9ycyBhcyBzdGFuZGFsb25lIGxvZ3MgZm9yIGRlYnVnZ2luZycsXG4gICAgfSk7XG5cbiAgICAvLyBLZWVwIHRhYmxlIHNjYW5zIChhbHdheXMgd2FybmluZ3MsIGV2ZW4gaWYgZmFzdClcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmtlZXBfc2NhbnMnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgdGFnczogeyBzY2FuOiAndHJ1ZScgfSxcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcmVhc29uOiAnS2VlcCB0YWJsZSBzY2FuIG9wZXJhdGlvbnMgYXMgc3RhbmRhbG9uZSB3YXJuaW5ncycsXG4gICAgfSk7XG5cbiAgICAvLyBLZWVwIHNsb3cgcXVlcmllcyBmb3IgaW52ZXN0aWdhdGlvblxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMua2VlcF9zbG93JyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIG1pbkR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgIHJlYXNvbjogJ0tlZXAgc2xvdyBxdWVyaWVzICg+PTEwMDBtcykgYXMgc3RhbmRhbG9uZSBsb2dzJyxcbiAgICB9KTtcblxuICAgIC8vIExPV0VTVCBQUklPUklUWTogRm9sZCBmYXN0IHN1Y2Nlc3NmdWwgcXVlcmllc1xuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuZm9sZF9mYXN0X3N1Y2Nlc3MnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogMTAwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICByZWFzb246ICdGb2xkIGZhc3Qgc3VjY2Vzc2Z1bCBxdWVyaWVzICg8MTAwbXMpIGludG8gcGFyZW50IHNwYW4nLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gQVBJIFJlYWQgT3BlcmF0aW9uc1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuYXBpLmRyb3BfZmFzdF9zdWNjZXNzZnVsX3JlYWRzJyxcbiAgICAgIHByaW9yaXR5OiAxMCwgLy8gTG93IHByaW9yaXR5IC0gZWFzeSB0byBvdmVycmlkZVxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAvLyBNYXRjaGVzIGNvbnRyb2xsZXIgb3BlcmF0aW9ucyAoSFRUUCBHRVQvSEVBRC9PUFRJT05TKSBhbmQgcmVhZCBtZXRob2RzXG4gICAgICAgIG9wZXJhdGlvbjogJy9eKEhUVFAgKT8oR0VUfEhFQUR8T1BUSU9OUylcXFxcc3xcXFxcLihsaXN0fGdldHxyZWFkfGZldGNofGZpbmQpKD86WygvXXwkKXxcXFxcLyhsaXN0fGdldHxyZWFkfGZldGNofGZpbmQpKD86Wy8/XXwkKS8nLFxuICAgICAgICBtYXhEdXJhdGlvbk1zOiA1MDAwLFxuICAgICAgfSxcbiAgICAgIGV4Y2VwdDogW1xuICAgICAgICB7IHN1Y2Nlc3M6IGZhbHNlIH0sICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE5ldmVyIGRyb3AgZmFpbHVyZXNcbiAgICAgICAgeyBsZXZlbDogWyAnZXJyb3InLCAnY3JpdGljYWwnLCAnd2FybicgXSB9LCAvLyBOZXZlciBkcm9wIHdhcm5pbmdzL2Vycm9yc1xuICAgICAgXSxcbiAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICByZWFzb246ICdEcm9wIGZhc3Qgc3VjY2Vzc2Z1bCByZWFkIG9wZXJhdGlvbnMgKDw1IFMpJyxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEF1dGggT3BlcmF0aW9uc1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuYXV0aC5kcm9wX3JvdXRpbmVfYXV0aCcsXG4gICAgICBwcmlvcml0eTogMTAsIC8vIExvdyBwcmlvcml0eSAtIGVhc3kgdG8gb3ZlcnJpZGVcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgLy8gTWF0Y2hlcyBhdXRoIGNvbnRyb2xsZXIgb3BlcmF0aW9ucyBhbmQgYXV0aC1yZWxhdGVkIGVuZHBvaW50c1xuICAgICAgICBvcGVyYXRpb246ICcvXihIVFRQICk/KFBPU1R8R0VUKVxcXFxzLipcXFxcLyhhdXRofG1hdXRofG9hdXRofHRva2VufGxvZ2lufGxvZ291dHxyZWZyZXNofGNyZWRlbnRpYWxzfHNlc3Npb24pXFxcXC8/fF5BdXRoW0EtWmEtejAtOV0qXFxcXC4oZ2V0fHJlZnJlc2h8dmFsaWRhdGV8dmVyaWZ5fGNoZWNrfGxvZ2lufGxvZ291dCkvJyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogNTAwMCxcbiAgICAgIH0sXG4gICAgICBleGNlcHQ6IFtcbiAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LCAgICAgICAgICAgICAgICAgICAgICAgICAvLyBOZXZlciBkcm9wIGF1dGggZmFpbHVyZXNcbiAgICAgICAgeyBsZXZlbDogWyAnZXJyb3InLCAnY3JpdGljYWwnLCAnd2FybicgXSB9LCAvLyBOZXZlciBkcm9wIGF1dGggd2FybmluZ3MvZXJyb3JzXG4gICAgICBdLFxuICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgIHJlYXNvbjogJ0Ryb3Agcm91dGluZSBhdXRoIG9wZXJhdGlvbnMgKDw1IFMpIC0gZXJyb3JzL2ZhaWx1cmVzL3Nsb3cvd2FybmluZ3MgYXJlIGtlcHQnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gU3RyZWFtIFByb2Nlc3NvcnNcbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICAgIHJ1bGVzLnB1c2goXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5zdHJlYW0uZm9sZF9wdWJsaXNoX2RvbmUnLFxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvclxcXFwuLycsXG4gICAgICAgICAgbGV2ZWw6IFsgJ2luZm8nLCAnZGVidWcnLCAndHJhY2UnIF0sXG4gICAgICAgICAgb3BlcmF0aW9uOiAnL1B1Ymxpc2ggKFNOU3xGSUZPKSBkb25lLycsXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgIHJlYXNvbjogJ0ZvbGQgbm9pc3kgc3RyZWFtIHB1Ymxpc2ggY29tcGxldGlvbiBsb2dzJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5zdHJlYW0uZm9sZF9hdWRpdF9kb25lJyxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXJcXFxcLi8nLFxuICAgICAgICAgIGxldmVsOiBbICdpbmZvJywgJ2RlYnVnJywgJ3RyYWNlJyBdLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9kb25lfENhcHR1cmVkIChjcmVhdGV8dXBkYXRlfGRlbGV0ZSkgYXVkaXQvJyxcbiAgICAgICAgfSxcbiAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgcmVhc29uOiAnRm9sZCBub2lzeSBzdHJlYW0gYXVkaXQgbG9nZ2VyIGxvZ3MnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnN0cmVhbS5kcm9wX2luZm9fbm9pc2UnLFxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW0oVG9TTlNQcm9jZXNzb3J8QXVkaXRMb2dnZXIpXFxcXC4vJyxcbiAgICAgICAgICBsZXZlbDogWyAndHJhY2UnLCAnZGVidWcnIF0sXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgIHJlYXNvbjogJ0Ryb3AgbG93LWxldmVsIHN0cmVhbSBub2lzZScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc3RyZWFtLmRyb3BfYmF0Y2hfc3BhbnMnLFxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtKFRvU05TUHJvY2Vzc29yfEF1ZGl0TG9nZ2VyKVxcXFwucHJvY2VzcyQvJyxcbiAgICAgICAgICBvcGVyYXRpb246ICcvXmF3czooc3FzfGR5bmFtb2RiKSBEeW5hbW9EQlN0cmVhbS8nLFxuICAgICAgICB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICByZWFzb246ICdEcm9wIHN0cmVhbSBwcm9jZXNzb3IgYmF0Y2ggc3BhbnMnLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBFbnRpdHkgT3BlcmF0aW9uc1xuICAgIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuZW50aXR5LmFnZ3JlZ2F0ZV91cHNlcnRfc3BhbnMnLFxuICAgICAgcHJpb3JpdHk6IDUwLCAvLyBEZWZhdWx0IGFnZ3JlZ2F0ZSBwcmlvcml0eVxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvcGVyYXRpb246ICcvQmFzZUVudGl0eVNlcnZpY2VcXFxcLih1cHNlcnR8dXBkYXRlKS8nLFxuICAgICAgICBzb3VyY2U6ICcvXnNlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2VcXFxcLi8nLFxuICAgICAgfSxcbiAgICAgIGV4Y2VwdDogW1xuICAgICAgICB7IHN1Y2Nlc3M6IGZhbHNlIH0sICAgICAgICAgICAgICAgIC8vIEtlZXAgZmFpbGVkIHdyaXRlc1xuICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSB9LCAgLy8gS2VlcCBlcnJvciB3cml0ZXNcbiAgICAgIF0sXG4gICAgICBkZWNpc2lvbjogJ2FnZ3JlZ2F0ZScsXG4gICAgICByZWFzb246ICdBZ2dyZWdhdGUgc3VjY2Vzc2Z1bCBlbnRpdHkgd3JpdGUgc3BhbnMgaW50byBwYXJlbnQnLFxuICAgIH0pO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBSRVNFVDogZncyNC5iYXRjaF9wcm9jZXNzb3JzXG4gIC8vIEFnZ3Jlc3NpdmUgbm9pc2UgcmVkdWN0aW9uIGZvciBiYXRjaCBwcm9jZXNzaW5nIHNjZW5hcmlvc1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBpZiAocHJlc2V0cy5pbmNsdWRlcygnZncyNC5iYXRjaF9wcm9jZXNzb3JzJykpIHtcbiAgICBydWxlcy5wdXNoKFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuYmF0Y2guYWdncmVnYXRlX2l0ZW1fcHJvY2Vzc2luZycsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9wcm9jZXNzKEl0ZW18UmVjb3JkfE1lc3NhZ2V8RXZlbnQpLycsXG4gICAgICAgICAgc291cmNlOiAnL1Byb2Nlc3NvclxcXFwuLycsXG4gICAgICAgIH0sXG4gICAgICAgIGV4Y2VwdDogWyB7IHN1Y2Nlc3M6IGZhbHNlIH0gXSxcbiAgICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgICByZWFzb246ICdBZ2dyZWdhdGUgc3VjY2Vzc2Z1bCBpdGVtIHByb2Nlc3Npbmcgc3BhbnMnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmJhdGNoLmZvbGRfaXRlbV9sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogWyAnaW5mbycsICdkZWJ1ZycgXSxcbiAgICAgICAgICBvcGVyYXRpb246ICcvcHJvY2Vzc2VkfGNvbXBsZXRlZHxkb25lLycsXG4gICAgICAgIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgIHJlYXNvbjogJ0ZvbGQgYmF0Y2ggaXRlbSBjb21wbGV0aW9uIGxvZ3MnLFxuICAgICAgfVxuICAgICk7XG4gIH1cblxuICAvLyBDYWNoZSB0aGUgcmVzdWx0XG4gIGNvbnN0IGZyb3plblJ1bGVzID0gT2JqZWN0LmZyZWV6ZShydWxlcykgYXMgUmVhZG9ubHlBcnJheTxOb2lzZVJ1bGU+O1xuICBidWlsdGluUnVsZXNDYWNoZS5zZXQoY2FjaGVLZXksIGZyb3plblJ1bGVzKTtcblxuICByZXR1cm4gZnJvemVuUnVsZXM7XG59XG5cbi8qKlxuICogQ2xlYXIgdGhlIGJ1aWx0aW4gcnVsZXMgY2FjaGUuXG4gKiBQcmltYXJpbHkgZm9yIHRlc3RpbmcgcHVycG9zZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhckJ1aWx0aW5SdWxlc0NhY2hlKCk6IHZvaWQge1xuICBidWlsdGluUnVsZXNDYWNoZS5jbGVhcigpO1xufVxuIl19