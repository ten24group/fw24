"use strict";
/**
 * DecisionObserver - For algorithm/rule decisions, feature flags, and A/B tests
 *
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context
 * - Captures decision input, output, and reasoning
 * - Supports rule-based, algorithm-based, and feature flag decisions
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     DecisionObserver.record({
 *       name: 'pricing.discount',
 *       input: { customerId, orderTotal },
 *       output: { discountPercent: 15, reason: 'loyalty' },
 *       rules: [
 *         { rule: 'loyalty_tier', matched: true, value: 'gold' },
 *         { rule: 'order_threshold', matched: true, value: 100 },
 *       ],
 *     });
 *
 *     // For feature flags
 *     DecisionObserver.featureFlag({
 *       flag: 'new_checkout',
 *       enabled: true,
 *       variant: 'B',
 *       userId: user.id,
 *     });
 *   }
 * );
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecisionObserver = void 0;
const base_1 = require("./base");
const OBSERVER_NAME = 'DecisionObserver';
class DecisionObserver {
    /**
     * Record a decision
     */
    static record(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            actor: options.actor,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'decision',
            level: 'info',
            operation: options.name,
            data: {
                input: options.input,
                output: options.output,
                rules: options.rules,
                reasoning: options.reasoning,
                algorithm: options.algorithm,
            },
            durationMs: options.durationMs,
            tags: { ...fields.tags, decision: options.name },
        });
    }
    /**
     * Record rule-based decision
     */
    static ruleEvaluation(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            actor: options.actor,
            tags: options.tags,
        });
        if (!fields)
            return undefined;
        const matchedRules = options.rules.filter((r) => r.matched);
        return (0, base_1.captureEvent)(fields, {
            type: 'decision.rule',
            level: 'info',
            operation: options.name,
            data: {
                input: options.input,
                output: options.output,
                rules: options.rules,
                matchedRuleCount: matchedRules.length,
                totalRuleCount: options.rules.length,
            },
            tags: { ...fields.tags, decision: options.name, decisionType: 'rule' },
            metrics: {
                matchedRules: matchedRules.length,
                totalRules: options.rules.length,
            },
        });
    }
    /**
     * Record algorithm-based decision (ML, scoring, etc.)
     *
     * @param options.metadata - Flexible metadata for ML model info (modelId, features, etc.)
     */
    static algorithmEvaluation(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            actor: options.actor,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'decision.algorithm',
            level: 'info',
            operation: options.name,
            data: {
                algorithm: options.algorithm,
                version: options.version,
                input: options.input,
                output: options.output,
                confidence: options.confidence,
            },
            durationMs: options.durationMs,
            tags: {
                ...fields.tags,
                decision: options.name,
                decisionType: 'algorithm',
                algorithm: options.algorithm,
            },
            metrics: options.confidence !== undefined ? { confidence: options.confidence } : undefined,
        });
    }
    /**
     * Record feature flag evaluation
     */
    static featureFlag(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            tags: options.tags,
            source: options.source,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'decision.feature_flag',
            level: 'debug', // Feature flags are high-volume
            operation: `feature.${options.flag}`,
            data: {
                flag: options.flag,
                enabled: options.enabled,
                variant: options.variant,
                userId: options.userId,
                context: options.context,
                defaultValue: options.defaultValue,
                source: options.source,
            },
            tags: {
                ...fields.tags,
                feature_flag: options.flag,
                variant: options.variant ?? (options.enabled ? 'enabled' : 'disabled'),
            },
        });
    }
    /**
     * Record A/B test participation
     */
    static abTest(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'decision.ab_test',
            level: 'debug',
            operation: `experiment.${options.experiment}`,
            data: {
                experiment: options.experiment,
                variant: options.variant,
                userId: options.userId,
                metadata: options.metadata,
            },
            tags: {
                ...fields.tags,
                experiment: options.experiment,
                variant: options.variant,
            },
        });
    }
    /**
     * Record A/B test conversion
     */
    static abTestConversion(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'decision.ab_test',
            subType: 'conversion',
            level: 'info',
            operation: `experiment.${options.experiment}.conversion`,
            data: {
                experiment: options.experiment,
                variant: options.variant,
                userId: options.userId,
                conversionType: options.conversionType,
                value: options.value,
                metadata: options.metadata,
            },
            tags: {
                ...fields.tags,
                experiment: options.experiment,
                variant: options.variant,
                conversionType: options.conversionType,
            },
            metrics: options.value !== undefined ? { conversionValue: options.value } : undefined,
        });
    }
}
exports.DecisionObserver = DecisionObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVjaXNpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvZGVjaXNpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0NHOzs7QUFHSCxpQ0FBOEU7QUFFOUUsTUFBTSxhQUFhLEdBQUcsa0JBQWtCLENBQUM7QUFVekMsTUFBYSxnQkFBZ0I7SUFFM0I7O09BRUc7SUFDSCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BYWI7UUFDQyxNQUFNLE1BQU0sR0FBRyxJQUFBLHdCQUFpQixFQUFDLGFBQWEsRUFBRTtZQUM5QyxhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7WUFDcEMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLO1lBQ3BCLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtZQUNsQixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7U0FDM0IsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLE1BQU07WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUU5QixPQUFPLElBQUEsbUJBQVksRUFBQyxNQUFNLEVBQUU7WUFDMUIsSUFBSSxFQUFFLFVBQVU7WUFDaEIsS0FBSyxFQUFFLE1BQU07WUFDYixTQUFTLEVBQUUsT0FBTyxDQUFDLElBQUk7WUFDdkIsSUFBSSxFQUFFO2dCQUNKLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztnQkFDcEIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO2dCQUN0QixLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0JBQ3BCLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUztnQkFDNUIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2FBQzdCO1lBQ0QsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1lBQzlCLElBQUksRUFBRSxFQUFFLEdBQUcsTUFBTSxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxD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VSxFQUFFLE9BQU8sQ0FBQyxVQUFVO2dCQUM5QixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87Z0JBQ3hCLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtnQkFDdEIsY0FBYyxFQUFFLE9BQU8sQ0FBQyxjQUFjO2dCQUN0QyxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0JBQ3BCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTthQUMzQjtZQUNELElBQUksRUFBRTtnQkFDSixHQUFHLE1BQU0sQ0FBQyxJQUFJO2dCQUNkLFVBQVUsRUFBRSxPQUFPLENBQUMsVUFBVTtnQkFDOUIsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO2dCQUN4QixjQUFjLEVBQUUsT0FBTyxDQUFDLGNBQWM7YUFDdkM7WUFDRCxPQUFPLEVBQUUsT0FBTyxDQUFDLEtBQUssS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUsZUFBZSxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUN0RixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUExUEQsNENBMFBDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBEZWNpc2lvbk9ic2VydmVyIC0gRm9yIGFsZ29yaXRobS9ydWxlIGRlY2lzaW9ucywgZmVhdHVyZSBmbGFncywgYW5kIEEvQiB0ZXN0c1xuICogXG4gKiBERVNJR04gUFJJTkNJUExFUzpcbiAqIC0gUmVxdWlyZXMgY29ycmVsYXRpb25JZCBmcm9tIGNvbnRleHRcbiAqIC0gQ2FwdHVyZXMgZGVjaXNpb24gaW5wdXQsIG91dHB1dCwgYW5kIHJlYXNvbmluZ1xuICogLSBTdXBwb3J0cyBydWxlLWJhc2VkLCBhbGdvcml0aG0tYmFzZWQsIGFuZCBmZWF0dXJlIGZsYWcgZGVjaXNpb25zXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gRklSU1Q6IEVzdGFibGlzaCBjb250ZXh0XG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICBEZWNpc2lvbk9ic2VydmVyLnJlY29yZCh7XG4gKiAgICAgICBuYW1lOiAncHJpY2luZy5kaXNjb3VudCcsXG4gKiAgICAgICBpbnB1dDogeyBjdXN0b21lcklkLCBvcmRlclRvdGFsIH0sXG4gKiAgICAgICBvdXRwdXQ6IHsgZGlzY291bnRQZXJjZW50OiAxNSwgcmVhc29uOiAnbG95YWx0eScgfSxcbiAqICAgICAgIHJ1bGVzOiBbXG4gKiAgICAgICAgIHsgcnVsZTogJ2xveWFsdHlfdGllcicsIG1hdGNoZWQ6IHRydWUsIHZhbHVlOiAnZ29sZCcgfSxcbiAqICAgICAgICAgeyBydWxlOiAnb3JkZXJfdGhyZXNob2xkJywgbWF0Y2hlZDogdHJ1ZSwgdmFsdWU6IDEwMCB9LFxuICogICAgICAgXSxcbiAqICAgICB9KTtcbiAqICAgICBcbiAqICAgICAvLyBGb3IgZmVhdHVyZSBmbGFnc1xuICogICAgIERlY2lzaW9uT2JzZXJ2ZXIuZmVhdHVyZUZsYWcoe1xuICogICAgICAgZmxhZzogJ25ld19jaGVja291dCcsXG4gKiAgICAgICBlbmFibGVkOiB0cnVlLFxuICogICAgICAgdmFyaWFudDogJ0InLFxuICogICAgICAgdXNlcklkOiB1c2VyLmlkLFxuICogICAgIH0pO1xuICogICB9XG4gKiApO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IGJ1aWxkQ29tbW9uRmllbGRzLCBjYXB0dXJlRXZlbnQsIEJhc2VPYnNlcnZlck9wdGlvbnMgfSBmcm9tICcuL2Jhc2UnO1xuXG5jb25zdCBPQlNFUlZFUl9OQU1FID0gJ0RlY2lzaW9uT2JzZXJ2ZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIERlY2lzaW9uUnVsZSB7XG4gIHJ1bGU6IHN0cmluZztcbiAgbWF0Y2hlZDogYm9vbGVhbjtcbiAgLyoqIFJ1bGUgdmFsdWUgLSBmbGV4aWJsZSBmb3IgYXBwLXNwZWNpZmljIGRhdGEgKi9cbiAgdmFsdWU/OiB1bmtub3duO1xuICB3ZWlnaHQ/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBEZWNpc2lvbk9ic2VydmVyIHtcblxuICAvKipcbiAgICogUmVjb3JkIGEgZGVjaXNpb25cbiAgICovXG4gIHN0YXRpYyByZWNvcmQob3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBpbnB1dD86IHVua25vd247XG4gICAgb3V0cHV0OiB1bmtub3duO1xuICAgIHJ1bGVzPzogRGVjaXNpb25SdWxlW107XG4gICAgcmVhc29uaW5nPzogc3RyaW5nO1xuICAgIGFsZ29yaXRobT86IHN0cmluZztcbiAgICBkdXJhdGlvbk1zPzogbnVtYmVyO1xuICAgIC8qKiBFeHBsaWNpdCBjb3JyZWxhdGlvbiBJRCAoZGVmYXVsdHMgdG8gY29udGV4dCkgKi9cbiAgICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgY29ycmVsYXRpb25JZDogb3B0aW9ucy5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IG9wdGlvbnMuYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICB9KTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnZGVjaXNpb24nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5uYW1lLFxuICAgICAgZGF0YToge1xuICAgICAgICBpbnB1dDogb3B0aW9ucy5pbnB1dCxcbiAgICAgICAgb3V0cHV0OiBvcHRpb25zLm91dHB1dCxcbiAgICAgICAgcnVsZXM6IG9wdGlvbnMucnVsZXMsXG4gICAgICAgIHJlYXNvbmluZzogb3B0aW9ucy5yZWFzb25pbmcsXG4gICAgICAgIGFsZ29yaXRobTogb3B0aW9ucy5hbGdvcml0aG0sXG4gICAgICB9LFxuICAgICAgZHVyYXRpb25Nczogb3B0aW9ucy5kdXJhdGlvbk1zLFxuICAgICAgdGFnczogeyAuLi5maWVsZHMudGFncywgZGVjaXNpb246IG9wdGlvbnMubmFtZSB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBydWxlLWJhc2VkIGRlY2lzaW9uXG4gICAqL1xuICBzdGF0aWMgcnVsZUV2YWx1YXRpb24ob3B0aW9uczoge1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBydWxlczogRGVjaXNpb25SdWxlW107XG4gICAgaW5wdXQ6IHVua25vd247XG4gICAgb3V0cHV0OiB1bmtub3duO1xuICAgIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gICAgYWN0b3I/OiBBY3RvcjtcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgY29ycmVsYXRpb25JZDogb3B0aW9ucy5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IG9wdGlvbnMuYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgfSk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBtYXRjaGVkUnVsZXMgPSBvcHRpb25zLnJ1bGVzLmZpbHRlcigocikgPT4gci5tYXRjaGVkKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnZGVjaXNpb24ucnVsZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBvcHRpb25zLm5hbWUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlucHV0OiBvcHRpb25zLmlucHV0LFxuICAgICAgICBvdXRwdXQ6IG9wdGlvbnMub3V0cHV0LFxuICAgICAgICBydWxlczogb3B0aW9ucy5ydWxlcyxcbiAgICAgICAgbWF0Y2hlZFJ1bGVDb3VudDogbWF0Y2hlZFJ1bGVzLmxlbmd0aCxcbiAgICAgICAgdG90YWxSdWxlQ291bnQ6IG9wdGlvbnMucnVsZXMubGVuZ3RoLFxuICAgICAgfSxcbiAgICAgIHRhZ3M6IHsgLi4uZmllbGRzLnRhZ3MsIGRlY2lzaW9uOiBvcHRpb25zLm5hbWUsIGRlY2lzaW9uVHlwZTogJ3J1bGUnIH0sXG4gICAgICBtZXRyaWNzOiB7XG4gICAgICAgIG1hdGNoZWRSdWxlczogbWF0Y2hlZFJ1bGVzLmxlbmd0aCxcbiAgICAgICAgdG90YWxSdWxlczogb3B0aW9ucy5ydWxlcy5sZW5ndGgsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBhbGdvcml0aG0tYmFzZWQgZGVjaXNpb24gKE1MLCBzY29yaW5nLCBldGMuKVxuICAgKiBcbiAgICogQHBhcmFtIG9wdGlvbnMubWV0YWRhdGEgLSBGbGV4aWJsZSBtZXRhZGF0YSBmb3IgTUwgbW9kZWwgaW5mbyAobW9kZWxJZCwgZmVhdHVyZXMsIGV0Yy4pXG4gICAqL1xuICBzdGF0aWMgYWxnb3JpdGhtRXZhbHVhdGlvbihvcHRpb25zOiB7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGFsZ29yaXRobTogc3RyaW5nO1xuICAgIHZlcnNpb24/OiBzdHJpbmc7XG4gICAgaW5wdXQ6IHVua25vd247XG4gICAgb3V0cHV0OiB1bmtub3duO1xuICAgIGNvbmZpZGVuY2U/OiBudW1iZXI7XG4gICAgZHVyYXRpb25Ncz86IG51bWJlcjtcbiAgICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgLyoqIEFsZ29yaXRobSBtZXRhZGF0YSAtIGZsZXhpYmxlIGZvciBhcHAtc3BlY2lmaWMgcmVxdWlyZW1lbnRzICovXG4gICAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgY29ycmVsYXRpb25JZDogb3B0aW9ucy5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IG9wdGlvbnMuYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICB9KTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnZGVjaXNpb24uYWxnb3JpdGhtJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246IG9wdGlvbnMubmFtZSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgYWxnb3JpdGhtOiBvcHRpb25zLmFsZ29yaXRobSxcbiAgICAgICAgdmVyc2lvbjogb3B0aW9ucy52ZXJzaW9uLFxuICAgICAgICBpbnB1dDogb3B0aW9ucy5pbnB1dCxcbiAgICAgICAgb3V0cHV0OiBvcHRpb25zLm91dHB1dCxcbiAgICAgICAgY29uZmlkZW5jZTogb3B0aW9ucy5jb25maWRlbmNlLFxuICAgICAgfSxcbiAgICAgIGR1cmF0aW9uTXM6IG9wdGlvbnMuZHVyYXRpb25NcyxcbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgLi4uZmllbGRzLnRhZ3MsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLm5hbWUsXG4gICAgICAgIGRlY2lzaW9uVHlwZTogJ2FsZ29yaXRobScsXG4gICAgICAgIGFsZ29yaXRobTogb3B0aW9ucy5hbGdvcml0aG0sXG4gICAgICB9LFxuICAgICAgbWV0cmljczogb3B0aW9ucy5jb25maWRlbmNlICE9PSB1bmRlZmluZWQgPyB7IGNvbmZpZGVuY2U6IG9wdGlvbnMuY29uZmlkZW5jZSB9IDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBmZWF0dXJlIGZsYWcgZXZhbHVhdGlvblxuICAgKi9cbiAgc3RhdGljIGZlYXR1cmVGbGFnKG9wdGlvbnM6IHtcbiAgICBmbGFnOiBzdHJpbmc7XG4gICAgZW5hYmxlZDogYm9vbGVhbjtcbiAgICB2YXJpYW50Pzogc3RyaW5nO1xuICAgIHVzZXJJZD86IHN0cmluZztcbiAgICBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgICBkZWZhdWx0VmFsdWU/OiBib29sZWFuO1xuICAgIHNvdXJjZT86IHN0cmluZzsgLy8gZS5nLiwgJ2xhdW5jaGRhcmtseScsICdzcGxpdCcsICdsb2NhbCdcbiAgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgY29ycmVsYXRpb25JZDogb3B0aW9ucy5jb3JyZWxhdGlvbklkLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgICAgc291cmNlOiBvcHRpb25zLnNvdXJjZSxcbiAgICB9KTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnZGVjaXNpb24uZmVhdHVyZV9mbGFnJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLCAvLyBGZWF0dXJlIGZsYWdzIGFyZSBoaWdoLXZvbHVtZVxuICAgICAgb3BlcmF0aW9uOiBgZmVhdHVyZS4ke29wdGlvbnMuZmxhZ31gLFxuICAgICAgZGF0YToge1xuICAgICAgICBmbGFnOiBvcHRpb25zLmZsYWcsXG4gICAgICAgIGVuYWJsZWQ6IG9wdGlvbnMuZW5hYmxlZCxcbiAgICAgICAgdmFyaWFudDogb3B0aW9ucy52YXJpYW50LFxuICAgICAgICB1c2VySWQ6IG9wdGlvbnMudXNlcklkLFxuICAgICAgICBjb250ZXh0OiBvcHRpb25zLmNvbnRleHQsXG4gICAgICAgIGRlZmF1bHRWYWx1ZTogb3B0aW9ucy5kZWZhdWx0VmFsdWUsXG4gICAgICAgIHNvdXJjZTogb3B0aW9ucy5zb3VyY2UsXG4gICAgICB9LFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5maWVsZHMudGFncyxcbiAgICAgICAgZmVhdHVyZV9mbGFnOiBvcHRpb25zLmZsYWcsXG4gICAgICAgIHZhcmlhbnQ6IG9wdGlvbnMudmFyaWFudCA/PyAob3B0aW9ucy5lbmFibGVkID8gJ2VuYWJsZWQnIDogJ2Rpc2FibGVkJyksXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBBL0IgdGVzdCBwYXJ0aWNpcGF0aW9uXG4gICAqL1xuICBzdGF0aWMgYWJUZXN0KG9wdGlvbnM6IHtcbiAgICBleHBlcmltZW50OiBzdHJpbmc7XG4gICAgdmFyaWFudDogc3RyaW5nO1xuICAgIHVzZXJJZDogc3RyaW5nO1xuICAgIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gICAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgY29ycmVsYXRpb25JZDogb3B0aW9ucy5jb3JyZWxhdGlvbklkLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnMubWV0YWRhdGEsXG4gICAgfSk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2RlY2lzaW9uLmFiX3Rlc3QnLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICBvcGVyYXRpb246IGBleHBlcmltZW50LiR7b3B0aW9ucy5leHBlcmltZW50fWAsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGV4cGVyaW1lbnQ6IG9wdGlvbnMuZXhwZXJpbWVudCxcbiAgICAgICAgdmFyaWFudDogb3B0aW9ucy52YXJpYW50LFxuICAgICAgICB1c2VySWQ6IG9wdGlvbnMudXNlcklkLFxuICAgICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICAgIH0sXG4gICAgICB0YWdzOiB7XG4gICAgICAgIC4uLmZpZWxkcy50YWdzLFxuICAgICAgICBleHBlcmltZW50OiBvcHRpb25zLmV4cGVyaW1lbnQsXG4gICAgICAgIHZhcmlhbnQ6IG9wdGlvbnMudmFyaWFudCxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIEEvQiB0ZXN0IGNvbnZlcnNpb25cbiAgICovXG4gIHN0YXRpYyBhYlRlc3RDb252ZXJzaW9uKG9wdGlvbnM6IHtcbiAgICBleHBlcmltZW50OiBzdHJpbmc7XG4gICAgdmFyaWFudDogc3RyaW5nO1xuICAgIHVzZXJJZDogc3RyaW5nO1xuICAgIGNvbnZlcnNpb25UeXBlOiBzdHJpbmc7XG4gICAgdmFsdWU/OiBudW1iZXI7XG4gICAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICB9KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBvcHRpb25zLmNvcnJlbGF0aW9uSWQsXG4gICAgICBtZXRhZGF0YTogb3B0aW9ucy5tZXRhZGF0YSxcbiAgICB9KTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnZGVjaXNpb24uYWJfdGVzdCcsXG4gICAgICBzdWJUeXBlOiAnY29udmVyc2lvbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBgZXhwZXJpbWVudC4ke29wdGlvbnMuZXhwZXJpbWVudH0uY29udmVyc2lvbmAsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGV4cGVyaW1lbnQ6IG9wdGlvbnMuZXhwZXJpbWVudCxcbiAgICAgICAgdmFyaWFudDogb3B0aW9ucy52YXJpYW50LFxuICAgICAgICB1c2VySWQ6IG9wdGlvbnMudXNlcklkLFxuICAgICAgICBjb252ZXJzaW9uVHlwZTogb3B0aW9ucy5jb252ZXJzaW9uVHlwZSxcbiAgICAgICAgdmFsdWU6IG9wdGlvbnMudmFsdWUsXG4gICAgICAgIG1ldGFkYXRhOiBvcHRpb25zLm1ldGFkYXRhLFxuICAgICAgfSxcbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgLi4uZmllbGRzLnRhZ3MsXG4gICAgICAgIGV4cGVyaW1lbnQ6IG9wdGlvbnMuZXhwZXJpbWVudCxcbiAgICAgICAgdmFyaWFudDogb3B0aW9ucy52YXJpYW50LFxuICAgICAgICBjb252ZXJzaW9uVHlwZTogb3B0aW9ucy5jb252ZXJzaW9uVHlwZSxcbiAgICAgIH0sXG4gICAgICBtZXRyaWNzOiBvcHRpb25zLnZhbHVlICE9PSB1bmRlZmluZWQgPyB7IGNvbnZlcnNpb25WYWx1ZTogb3B0aW9ucy52YWx1ZSB9IDogdW5kZWZpbmVkLFxuICAgIH0pO1xuICB9XG59XG4iXX0=