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
import { buildCommonFields, captureEvent, BaseObserverOptions } from './base';

const OBSERVER_NAME = 'DecisionObserver';

export interface DecisionRule {
  rule: string;
  matched: boolean;
  /** Rule value - flexible for app-specific data */
  value?: unknown;
  weight?: number;
}

export class DecisionObserver {

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
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options.correlationId,
      actor: options.actor,
      tags: options.tags,
      metadata: options.metadata,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
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
  static ruleEvaluation(options: {
    name: string;
    rules: DecisionRule[];
    input: unknown;
    output: unknown;
    correlationId?: string;
    actor?: Actor;
    tags?: Record<string, string>;
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options.correlationId,
      actor: options.actor,
      tags: options.tags,
    });
    if (!fields) return undefined;

    const matchedRules = options.rules.filter((r) => r.matched);

    return captureEvent(fields, {
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
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options.correlationId,
      actor: options.actor,
      tags: options.tags,
      metadata: options.metadata,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
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
  static featureFlag(options: {
    flag: string;
    enabled: boolean;
    variant?: string;
    userId?: string;
    context?: Record<string, unknown>;
    correlationId?: string;
    tags?: Record<string, string>;
    defaultValue?: boolean;
    source?: string; // e.g., 'launchdarkly', 'split', 'local'
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options.correlationId,
      tags: options.tags,
      source: options.source,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
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
  static abTest(options: {
    experiment: string;
    variant: string;
    userId: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
    tags?: Record<string, string>;
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options.correlationId,
      tags: options.tags,
      metadata: options.metadata,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
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
  static abTestConversion(options: {
    experiment: string;
    variant: string;
    userId: string;
    conversionType: string;
    value?: number;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options.correlationId,
      metadata: options.metadata,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
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
