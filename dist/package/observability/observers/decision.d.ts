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
import { Actor } from '../../core/types/execution-context';
export interface DecisionRule {
    rule: string;
    matched: boolean;
    /** Rule value - flexible for app-specific data */
    value?: unknown;
    weight?: number;
}
export declare class DecisionObserver {
    /**
     * Record a decision
     */
    static record(options: {
        name: string;
        input?: unknown;
        output: unknown;
        rules?: DecisionRule[];
        reasoning?: string;
        algorithm?: string;
        durationMs?: number;
        /** Explicit correlation ID (defaults to context) */
        correlationId?: string;
        actor?: Actor;
        tags?: Record<string, string>;
        metadata?: Record<string, unknown>;
    }): string | undefined;
    /**
     * Record rule-based decision
     */
    static ruleEvaluation(options: {
        name: string;
        rules: DecisionRule[];
        input: unknown;
        output: unknown;
        correlationId?: string;
        actor?: Actor;
        tags?: Record<string, string>;
    }): string | undefined;
    /**
     * Record algorithm-based decision (ML, scoring, etc.)
     *
     * @param options.metadata - Flexible metadata for ML model info (modelId, features, etc.)
     */
    static algorithmEvaluation(options: {
        name: string;
        algorithm: string;
        version?: string;
        input: unknown;
        output: unknown;
        confidence?: number;
        durationMs?: number;
        correlationId?: string;
        actor?: Actor;
        tags?: Record<string, string>;
        /** Algorithm metadata - flexible for app-specific requirements */
        metadata?: Record<string, unknown>;
    }): string | undefined;
    /**
     * Record feature flag evaluation
     */
    static featureFlag(options: {
        flag: string;
        enabled: boolean;
        variant?: string;
        userId?: string;
        context?: Record<string, unknown>;
        correlationId?: string;
        tags?: Record<string, string>;
        defaultValue?: boolean;
        source?: string;
    }): string | undefined;
    /**
     * Record A/B test participation
     */
    static abTest(options: {
        experiment: string;
        variant: string;
        userId: string;
        correlationId?: string;
        metadata?: Record<string, unknown>;
        tags?: Record<string, string>;
    }): string | undefined;
    /**
     * Record A/B test conversion
     */
    static abTestConversion(options: {
        experiment: string;
        variant: string;
        userId: string;
        conversionType: string;
        value?: number;
        correlationId?: string;
        metadata?: Record<string, unknown>;
    }): string | undefined;
}
