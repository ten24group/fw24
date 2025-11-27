# Universal Condition Evaluation System

> **SUPERSEDED BY:** `UNIVERSAL_EVALUATION_SYSTEM_FINAL.md`
> 
> This document contains design exploration. The final comprehensive implementation plan
> is in `UNIVERSAL_EVALUATION_SYSTEM_FINAL.md` which includes:
> - Complete codebase analysis (both fw24 and ui24)
> - Detailed implementation plan with checklists
> - Backward compatibility strategy
> - Deprecation timeline
> - Testing & verification procedures
> - Real implementation examples

---

## Overview

A **universal, serializable evaluation system** for controlling visibility, enablement, and behavior across the entire framework.

**Key Innovation**: Define conditions once in backend (serializable JSON), evaluate in frontend with a universal registry that serves ALL framework needs.

---

## Core Problems Solved

### 1. Backend-to-Frontend Serialization ✅
- ❌ **Bad**: Maintain same logic in backend AND frontend
- ✅ **Good**: Define in backend, serialize through config, evaluate in frontend
- ✅ **Custom logic**: Define once in frontend, reference by name in backend

### 2. Universal Registry ✅
- ❌ **Bad**: Separate registries for actions, forms, widgets, etc.
- ✅ **Good**: One registry for ALL evaluation needs
- ✅ **Used by**: Actions, form controls, widgets, page types, features, table config

### 3. Rich Context Utilization ✅
- Uses: `actor`, `record`, `selectedRecords`, `queryParams`, `pageType`, `entityName`, `modalDepth`
- Different contexts drive different evaluations
- Examples: Bulk actions (selectedRecords), filter actions (queryParams), page-specific actions (pageType)

### 4. Modal Chain Handling ✅
- Tracks modal depth
- Handles nested evaluations
- Batch evaluation support
- Proper memoization

---

## Architecture

```
Backend (fw24)                  Config Gen                  Frontend (ui24)
┌─────────────────┐            ┌──────────┐                ┌────────────────┐
│ Entity Schema   │            │          │                │ AppContext     │
│                 │            │          │                │  └─ Registry   │
│ visibility: {   │────────────→│ JSON cfg │────────────────→│  └─ Evaluator │
│   actor: {...}  │ serialize  │          │  deserialize   │                │
│   custom: 'foo' │            │          │                │ Components     │
│ }               │            │          │                │  └─ useEval()  │
└─────────────────┘            └──────────┘                └────────────────┘
                                                                    ↓
                                                            ┌────────────────┐
                                                            │ Custom Funcs   │
                                                            │ 'foo': (ctx)=> │
                                                            └────────────────┘
```

---

## Type Definitions (Serializable)

```typescript
/**
 * Evaluation rule for a single field (SERIALIZABLE)
 * Mirrors validation framework structure
 */
export type EvaluationRule<T = any> = {
  readonly eq?: T;
  readonly neq?: T;
  readonly gt?: T | string;  // String for template: '{actor.id}'
  readonly gte?: T | string;
  readonly lt?: T | string;
  readonly lte?: T | string;
  readonly inList?: Array<T>;
  readonly notInList?: Array<T>;
  
  // SERIALIZATION: string reference to registered function
  // RUNTIME: evaluator resolves to actual function
  readonly custom?: string;
  
  // Pattern matching for strings
  readonly pattern?: string;  // Regex pattern as string
  
  // Existence checks
  readonly exists?: boolean;
  readonly empty?: boolean;
};

/**
 * Condition structure (SERIALIZABLE)
 * Can check actor, record, selectedRecords, queryParams, context
 */
export interface EvaluationCondition {
  /**
   * Rules for checking actor properties (user, roles, permissions)
   */
  readonly actor?: {
    [path: string]: EvaluationRule;
  };
  
  /**
   * Rules for checking current record properties
   */
  readonly record?: {
    [path: string]: EvaluationRule;
  };
  
  /**
   * Rules for checking selected records (bulk actions)
   * Can use aggregation functions
   */
  readonly selectedRecords?: {
    'length'?: EvaluationRule<number>;
    'all'?: { [path: string]: EvaluationRule };  // All selected match
    'some'?: { [path: string]: EvaluationRule }; // At least one matches
    'none'?: { [path: string]: EvaluationRule }; // None match
  };
  
  /**
   * Rules for checking URL query parameters
   */
  readonly queryParams?: {
    [key: string]: EvaluationRule;
  };
  
  /**
   * Rules for checking evaluation context
   */
  readonly context?: {
    'pageType'?: EvaluationRule<'list' | 'view' | 'edit' | 'create'>;
    'modalDepth'?: EvaluationRule<number>;
    'entityName'?: EvaluationRule<string>;
    [key: string]: EvaluationRule | undefined;
  };
}

/**
 * Visibility configuration (SERIALIZABLE)
 * Can be inline conditions OR custom function reference
 */
export type VisibilityConfig = 
  | EvaluationCondition  // Inline serializable conditions
  | { custom: string }   // Reference to registered function
  | { 
      // Named conditions with scope
      conditions: string[];  // Names of registered conditions
      scope?: 'all' | 'any' | 'none';
    }
  | {
      // Shortcuts (most common cases)
      requiredRoles?: string[];
      excludedRoles?: string[];
      showWhen?: Record<string, any>;  // Simple record field checks
      hideWhen?: Record<string, any>;
    };

/**
 * Evaluation context (passed to all evaluations)
 */
export interface EvaluationContext {
  /** Current user/actor */
  actor: {
    actorId?: string;
    cognito?: {
      groups?: string[];
      username?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  
  /** Current record (view/edit pages, table rows) */
  record?: Record<string, any>;
  
  /** Selected records (bulk actions) */
  selectedRecords?: Array<Record<string, any>>;
  
  /** URL query parameters */
  queryParams?: Record<string, any>;
  
  /** Page type */
  pageType?: 'list' | 'view' | 'edit' | 'create';
  
  /** Entity name */
  entityName?: string;
  
  /** Modal nesting depth (0 = not in modal) */
  modalDepth?: number;
  
  /** Form values (if evaluating within a form) */
  formValues?: Record<string, any>;
  
  /** Additional context from parent */
  [key: string]: any;
}

/**
 * Evaluation result
 */
export interface EvaluationResult {
  /** Is the item visible? */
  visible: boolean;
  
  /** Is the item enabled? (only matters if visible) */
  enabled: boolean;
  
  /** Message to show when disabled */
  disabledMessage?: string;
  
  /** Additional metadata */
  [key: string]: any;
}

/**
 * Custom evaluator function signature
 */
export type CustomEvaluatorFunction = (
  context: EvaluationContext
) => Promise<EvaluationResult> | EvaluationResult;
```

---

## Universal Registry (ui24/src/core/context/EvaluatorRegistry.ts)

```typescript
/**
 * Universal registry for ALL framework evaluation needs
 * 
 * Use cases:
 * - Action visibility
 * - Form control visibility/enablement
 * - Widget availability
 * - Feature flags
 * - Page type authorization
 * - Table config (row selection, columns)
 * - Custom page logic
 */
export class ConditionEvaluatorRegistry {
  private static evaluators: Map<string, CustomEvaluatorFunction> = new Map();
  
  /**
   * Register a custom evaluator function
   * 
   * @example
   * ConditionEvaluatorRegistry.register('canEditGame', async (ctx) => {
   *   if (ctx.actor?.cognito?.groups?.includes('admin')) {
   *     return { visible: true, enabled: true };
   *   }
   *   if (ctx.record?.createdBy === ctx.actor?.actorId && 
   *       ctx.record?.status === 'draft') {
   *     return { visible: true, enabled: true };
   *   }
   *   return { visible: false, enabled: false };
   * });
   */
  static register(name: string, evaluator: CustomEvaluatorFunction): void {
    if (this.evaluators.has(name)) {
      console.warn(`[ConditionEvaluatorRegistry] Overwriting evaluator: ${name}`);
    }
    this.evaluators.set(name, evaluator);
  }
  
  /**
   * Register multiple evaluators at once
   */
  static registerAll(evaluators: Record<string, CustomEvaluatorFunction>): void {
    Object.entries(evaluators).forEach(([name, fn]) => {
      this.register(name, fn);
    });
  }
  
  /**
   * Get an evaluator by name
   */
  static get(name: string): CustomEvaluatorFunction | undefined {
    return this.evaluators.get(name);
  }
  
  /**
   * Check if evaluator exists
   */
  static has(name: string): boolean {
    return this.evaluators.has(name);
  }
  
  /**
   * Clear all evaluators (useful for testing)
   */
  static clear(): void {
    this.evaluators.clear();
  }
  
  /**
   * Get all registered evaluator names
   */
  static getNames(): string[] {
    return Array.from(this.evaluators.keys());
  }
}

// Export singleton instance
export const registry = ConditionEvaluatorRegistry;
```

---

## Universal Evaluator (ui24/src/core/context/UniversalEvaluator.ts)

```typescript
/**
 * Universal evaluation engine
 * Evaluates serializable conditions AND custom function references
 */
export class UniversalEvaluator {
  
  /**
   * Main evaluation entry point
   * Handles ALL visibility config formats
   */
  async evaluate(
    config: VisibilityConfig | undefined,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    const defaultResult: EvaluationResult = {
      visible: true,
      enabled: true
    };
    
    if (!config) {
      return defaultResult;
    }
    
    // Custom function reference
    if ('custom' in config && typeof config.custom === 'string') {
      return await this.evaluateCustom(config.custom, context);
    }
    
    // Named conditions with scope
    if ('conditions' in config && Array.isArray(config.conditions)) {
      return await this.evaluateNamedConditions(
        config.conditions,
        config.scope || 'all',
        context
      );
    }
    
    // Shortcuts (requiredRoles, showWhen, etc.)
    if ('requiredRoles' in config || 'showWhen' in config || 'hideWhen' in config) {
      return await this.evaluateShortcuts(config, context);
    }
    
    // Full condition structure
    return await this.evaluateCondition(config as EvaluationCondition, context);
  }
  
  /**
   * Evaluate custom function reference
   */
  private async evaluateCustom(
    name: string,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    const fn = registry.get(name);
    
    if (!fn) {
      console.error(`[UniversalEvaluator] Custom evaluator not found: "${name}"`);
      return { visible: false, enabled: false };
    }
    
    try {
      const result = await fn(context);
      return result;
    } catch (error) {
      console.error(`[UniversalEvaluator] Error in custom evaluator "${name}":`, error);
      return { visible: false, enabled: false };
    }
  }
  
  /**
   * Evaluate named conditions with scope logic
   */
  private async evaluateNamedConditions(
    names: string[],
    scope: 'all' | 'any' | 'none',
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    const results = await Promise.all(
      names.map(name => this.evaluateCustom(name, context))
    );
    
    const visibleResults = results.filter(r => r.visible);
    
    let finalVisible = false;
    switch (scope) {
      case 'all':
        finalVisible = visibleResults.length === names.length;
        break;
      case 'any':
        finalVisible = visibleResults.length > 0;
        break;
      case 'none':
        finalVisible = visibleResults.length === 0;
        break;
    }
    
    return {
      visible: finalVisible,
      enabled: finalVisible
    };
  }
  
  /**
   * Evaluate shortcuts (common cases)
   */
  private async evaluateShortcuts(
    config: any,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    // Required roles
    if (config.requiredRoles && Array.isArray(config.requiredRoles)) {
      const userRoles = context.actor?.cognito?.groups || [];
      const hasRole = config.requiredRoles.some(role => userRoles.includes(role));
      if (!hasRole) {
        return { visible: false, enabled: false };
      }
    }
    
    // Excluded roles
    if (config.excludedRoles && Array.isArray(config.excludedRoles)) {
      const userRoles = context.actor?.cognito?.groups || [];
      const hasExcluded = config.excludedRoles.some(role => userRoles.includes(role));
      if (hasExcluded) {
        return { visible: false, enabled: false };
      }
    }
    
    // Show when (record fields match)
    if (config.showWhen && context.record) {
      const matches = this.matchesObject(config.showWhen, context.record, context);
      if (!matches) {
        return { visible: false, enabled: false };
      }
    }
    
    // Hide when (record fields match)
    if (config.hideWhen && context.record) {
      const matches = this.matchesObject(config.hideWhen, context.record, context);
      if (matches) {
        return { visible: false, enabled: false };
      }
    }
    
    return { visible: true, enabled: true };
  }
  
  /**
   * Evaluate full condition structure
   */
  private async evaluateCondition(
    condition: EvaluationCondition,
    context: EvaluationContext
  ): Promise<EvaluationResult> {
    
    // Check actor rules
    if (condition.actor) {
      const passed = await this.evaluateRules(condition.actor, context.actor, context);
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check record rules
    if (condition.record && context.record) {
      const passed = await this.evaluateRules(condition.record, context.record, context);
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check selectedRecords rules
    if (condition.selectedRecords && context.selectedRecords) {
      const passed = await this.evaluateSelectedRecordsRules(
        condition.selectedRecords,
        context.selectedRecords,
        context
      );
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check queryParams rules
    if (condition.queryParams && context.queryParams) {
      const passed = await this.evaluateRules(
        condition.queryParams,
        context.queryParams,
        context
      );
      if (!passed) return { visible: false, enabled: false };
    }
    
    // Check context rules
    if (condition.context) {
      const contextData = {
        pageType: context.pageType,
        modalDepth: context.modalDepth,
        entityName: context.entityName
      };
      const passed = await this.evaluateRules(condition.context, contextData, context);
      if (!passed) return { visible: false, enabled: false };
    }
    
    return { visible: true, enabled: true };
  }
  
  /**
   * Evaluate rules against an object
   */
  private async evaluateRules(
    rules: Record<string, EvaluationRule>,
    data: any,
    context: EvaluationContext
  ): Promise<boolean> {
    
    for (const [path, rule] of Object.entries(rules)) {
      const value = this.getNestedValue(data, path);
      const passed = await this.evaluateRule(rule, value, context);
      if (!passed) return false;
    }
    
    return true;
  }
  
  /**
   * Evaluate selectedRecords rules (supports aggregations)
   */
  private async evaluateSelectedRecordsRules(
    rules: NonNullable<EvaluationCondition['selectedRecords']>,
    selectedRecords: Array<Record<string, any>>,
    context: EvaluationContext
  ): Promise<boolean> {
    
    // Length check
    if (rules.length) {
      const passed = await this.evaluateRule(rules.length, selectedRecords.length, context);
      if (!passed) return false;
    }
    
    // All records match
    if (rules.all) {
      const allMatch = await Promise.all(
        selectedRecords.map(record => 
          this.evaluateRules(rules.all!, record, context)
        )
      );
      if (!allMatch.every(Boolean)) return false;
    }
    
    // At least one matches
    if (rules.some) {
      const someMatch = await Promise.all(
        selectedRecords.map(record => 
          this.evaluateRules(rules.some!, record, context)
        )
      );
      if (!someMatch.some(Boolean)) return false;
    }
    
    // None match
    if (rules.none) {
      const noneMatch = await Promise.all(
        selectedRecords.map(record => 
          this.evaluateRules(rules.none!, record, context)
        )
      );
      if (noneMatch.some(Boolean)) return false;
    }
    
    return true;
  }
  
  /**
   * Evaluate single rule
   */
  private async evaluateRule(
    rule: EvaluationRule,
    value: any,
    context: EvaluationContext
  ): Promise<boolean> {
    
    // Template resolution
    const resolve = (val: any) => this.resolveTemplate(val, context);
    
    // Equality checks
    if (rule.eq !== undefined && value !== resolve(rule.eq)) return false;
    if (rule.neq !== undefined && value === resolve(rule.neq)) return false;
    
    // Comparison checks
    if (rule.gt !== undefined && !(Number(value) > Number(resolve(rule.gt)))) return false;
    if (rule.gte !== undefined && !(Number(value) >= Number(resolve(rule.gte)))) return false;
    if (rule.lt !== undefined && !(Number(value) < Number(resolve(rule.lt)))) return false;
    if (rule.lte !== undefined && !(Number(value) <= Number(resolve(rule.lte)))) return false;
    
    // List checks
    if (rule.inList && !rule.inList.includes(value)) return false;
    if (rule.notInList && rule.notInList.includes(value)) return false;
    
    // Pattern matching
    if (rule.pattern) {
      const regex = new RegExp(rule.pattern);
      if (!regex.test(String(value))) return false;
    }
    
    // Existence checks
    if (rule.exists !== undefined) {
      const exists = value !== undefined && value !== null;
      if (exists !== rule.exists) return false;
    }
    
    if (rule.empty !== undefined) {
      const empty = !value || (Array.isArray(value) && value.length === 0) || 
                    (typeof value === 'object' && Object.keys(value).length === 0);
      if (empty !== rule.empty) return false;
    }
    
    // Custom function (string reference)
    if (rule.custom && typeof rule.custom === 'string') {
      const result = await this.evaluateCustom(rule.custom, {
        ...context,
        _currentValue: value
      });
      return result.visible;
    }
    
    return true;
  }
  
  /**
   * Simple object matching (for showWhen/hideWhen)
   */
  private matchesObject(
    expected: Record<string, any>,
    actual: Record<string, any>,
    context: EvaluationContext
  ): boolean {
    return Object.entries(expected).every(([key, value]) => {
      const actualValue = this.getNestedValue(actual, key);
      const resolvedValue = this.resolveTemplate(value, context);
      return actualValue === resolvedValue;
    });
  }
  
  /**
   * Get nested value using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
  
  /**
   * Resolve template strings like '{actor.actorId}'
   */
  private resolveTemplate(value: any, context: EvaluationContext): any {
    if (typeof value !== 'string') return value;
    
    const match = value.match(/^\{(.+)\}$/);
    if (!match) return value;
    
    const path = match[1];
    
    // Try different context sources
    if (path.startsWith('actor.')) {
      return this.getNestedValue(context.actor, path.substring(6));
    }
    if (path.startsWith('record.')) {
      return this.getNestedValue(context.record, path.substring(7));
    }
    if (path.startsWith('context.')) {
      return this.getNestedValue(context, path.substring(8));
    }
    
    // Direct context property
    return this.getNestedValue(context, path);
  }
}

// Export singleton
export const universalEvaluator = new UniversalEvaluator();
```

---

## Context Provider (ui24/src/core/context/EvaluationContext.tsx)

```typescript
import React, { createContext, useContext, ReactNode } from 'react';
import { EvaluationContext } from './types';
import { useAuth } from './AuthContext';
import { useLocation, useParams } from 'react-router-dom';
import { useModalDepth } from '../../modal/Modal';

/**
 * Provides evaluation context to all children
 * Automatically includes: actor, queryParams, pageType, modalDepth
 */
interface EvaluationContextProviderProps {
  children: ReactNode;
  
  /** Additional context to merge */
  additionalContext?: Partial<EvaluationContext>;
  
  /** Current record (for view/edit pages) */
  record?: Record<string, any>;
  
  /** Selected records (for list pages with selection) */
  selectedRecords?: Array<Record<string, any>>;
  
  /** Page type override */
  pageType?: 'list' | 'view' | 'edit' | 'create';
  
  /** Entity name override */
  entityName?: string;
}

const EvalContext = createContext<EvaluationContext | null>(null);

export function EvaluationContextProvider({
  children,
  additionalContext = {},
  record,
  selectedRecords,
  pageType,
  entityName
}: EvaluationContextProviderProps) {
  
  const { user } = useAuth();
  const location = useLocation();
  const params = useParams();
  const modalDepth = useModalDepth();
  
  // Build query params
  const queryParams = React.useMemo(() => {
    return Object.fromEntries(new URLSearchParams(location.search));
  }, [location.search]);
  
  // Auto-detect page type from route if not provided
  const detectedPageType = React.useMemo(() => {
    if (pageType) return pageType;
    if (location.pathname.includes('/list-')) return 'list';
    if (location.pathname.includes('/view-')) return 'view';
    if (location.pathname.includes('/edit-')) return 'edit';
    if (location.pathname.includes('/create-')) return 'create';
    return undefined;
  }, [location.pathname, pageType]);
  
  // Auto-detect entity name from route
  const detectedEntityName = React.useMemo(() => {
    if (entityName) return entityName;
    const match = location.pathname.match(/\/(list|view|edit|create)-([^/]+)/);
    return match ? match[2] : undefined;
  }, [location.pathname, entityName]);
  
  const context: EvaluationContext = React.useMemo(() => ({
    actor: {
      actorId: user?.id,
      cognito: {
        groups: user?.groups || [],
        username: user?.username,
        ...user?.cognitoData
      },
      ...user
    },
    record,
    selectedRecords,
    queryParams,
    pageType: detectedPageType,
    entityName: detectedEntityName,
    modalDepth,
    ...additionalContext
  }), [
    user,
    record,
    selectedRecords,
    queryParams,
    detectedPageType,
    detectedEntityName,
    modalDepth,
    additionalContext
  ]);
  
  return (
    <EvalContext.Provider value={context}>
      {children}
    </EvalContext.Provider>
  );
}

/**
 * Get current evaluation context
 */
export function useEvaluationContext(): EvaluationContext {
  const context = useContext(EvalContext);
  
  if (!context) {
    throw new Error('useEvaluationContext must be used within EvaluationContextProvider');
  }
  
  return context;
}
```

---

## Universal Evaluation Hook (ui24/src/core/hooks/useEvaluation.ts)

```typescript
import { useMemo, useCallback } from 'react';
import { useEvaluationContext } from '../context/EvaluationContext';
import { universalEvaluator } from '../context/UniversalEvaluator';
import { VisibilityConfig, EvaluationResult, EvaluationContext } from '../context/types';

/**
 * Hook for evaluating visibility conditions
 * 
 * Handles:
 * - Single evaluations
 * - Batch evaluations (multiple items at once)
 * - Context merging (additional context from parent)
 * - Proper memoization
 * - Modal chain support
 * 
 * @example Single evaluation
 * const { visible, enabled } = useEvaluation(action.visibility);
 * 
 * @example Batch evaluation
 * const results = useEvaluationBatch(actions.map(a => a.visibility));
 * 
 * @example With additional context
 * const { visible } = useEvaluation(config, { formValues });
 */
export function useEvaluation(
  config: VisibilityConfig | undefined,
  additionalContext?: Partial<EvaluationContext>
): EvaluationResult {
  
  const baseContext = useEvaluationContext();
  
  // Merge contexts
  const context = useMemo(() => ({
    ...baseContext,
    ...additionalContext
  }), [baseContext, additionalContext]);
  
  // Evaluate (memoized)
  const result = useMemo(async () => {
    if (!config) {
      return { visible: true, enabled: true };
    }
    
    return await universalEvaluator.evaluate(config, context);
  }, [config, context]);
  
  // Return synchronously (will update on next render)
  const [state, setState] = React.useState<EvaluationResult>({
    visible: true,
    enabled: true
  });
  
  React.useEffect(() => {
    result.then(setState);
  }, [result]);
  
  return state;
}

/**
 * Batch evaluation hook
 * Evaluates multiple configs at once (more efficient)
 */
export function useEvaluationBatch(
  configs: Array<VisibilityConfig | undefined>,
  additionalContext?: Partial<EvaluationContext>
): EvaluationResult[] {
  
  const baseContext = useEvaluationContext();
  
  const context = useMemo(() => ({
    ...baseContext,
    ...additionalContext
  }), [baseContext, additionalContext]);
  
  const results = useMemo(async () => {
    return await Promise.all(
      configs.map(config => 
        config 
          ? universalEvaluator.evaluate(config, context)
          : { visible: true, enabled: true }
      )
    );
  }, [configs, context]);
  
  const [state, setState] = React.useState<EvaluationResult[]>(
    configs.map(() => ({ visible: true, enabled: true }))
  );
  
  React.useEffect(() => {
    results.then(setState);
  }, [results]);
  
  return state;
}

/**
 * Imperative evaluation function
 * Use when you need to evaluate on-demand (not in render)
 */
export function useEvaluator() {
  const baseContext = useEvaluationContext();
  
  return useCallback(async (
    config: VisibilityConfig | undefined,
    additionalContext?: Partial<EvaluationContext>
  ): Promise<EvaluationResult> => {
    const context = { ...baseContext, ...additionalContext };
    
    if (!config) {
      return { visible: true, enabled: true };
    }
    
    return await universalEvaluator.evaluate(config, context);
  }, [baseContext]);
}
```

---

## Context Usage Examples

### 1. selectedRecords - Bulk Actions

```typescript
// Backend: Show "Delete Selected" only if 2+ records selected
{
  label: 'Delete Selected',
  url: '/game/bulk-delete',
  visibility: {
    actor: {
      'cognito.groups': { inList: ['admin'] }
    },
    selectedRecords: {
      'length': { gte: 2 }  // At least 2 selected
    }
  }
}

// Backend: Show "Export Selected" if any records selected
{
  label: 'Export Selected',
  url: '/game/bulk-export',
  visibility: {
    selectedRecords: {
      'length': { gte: 1 }
    }
  }
}

// Backend: Show "Approve All" only if ALL selected are pending
{
  label: 'Approve All',
  url: '/game/bulk-approve',
  visibility: {
    requiredRoles: ['admin'],
    selectedRecords: {
      'all': {  // ALL selected records must match
        status: { eq: 'pending' }
      }
    }
  }
}
```

### 2. queryParams - Filter-Aware Actions

```typescript
// Backend: Show "Clear Filters" only if filters applied
{
  label: 'Clear Filters',
  url: '/list-game',
  visibility: {
    queryParams: {
      // At least one filter param exists
      'status': { exists: true },
      // OR
      'teamId': { exists: true }
    }
  }
}

// Backend: Show "Download Filtered Results" if filters applied
{
  label: 'Download Results',
  url: '/game/export',
  visibility: {
    context: {
      // Check if ANY query params exist
      'queryParams': { empty: false }
    }
  }
}
```

### 3. pageType - Page-Specific Actions

```typescript
// Backend: Show "Edit" only on view pages
{
  label: 'Edit',
  url: '/edit-game/:id',
  visibility: {
    context: {
      'pageType': { eq: 'view' }
    }
  }
}

// Backend: Show "Cancel" only on edit/create pages
{
  label: 'Cancel',
  url: '/list-game',
  visibility: {
    context: {
      'pageType': { inList: ['edit', 'create'] }
    }
  }
}
```

### 4. modalDepth - Modal Chain Handling

```typescript
// Backend: Hide action when in nested modals
{
  label: 'Open Advanced Settings',
  url: '/game/:id/settings',
  openInModal: true,
  visibility: {
    context: {
      'modalDepth': { lt: 2 }  // Only show in top-level or 1st modal
    }
  }
}

// Backend: Show "Close All Modals" only in nested modals
{
  label: 'Close All',
  onClick: 'closeAllModals',
  visibility: {
    context: {
      'modalDepth': { gt: 1 }
    }
  }
}
```

### 5. Complex Multi-Context Evaluation

```typescript
// Backend: Bulk action with multiple context checks
{
  label: 'Batch Publish Games',
  url: '/game/bulk-publish',
  visibility: {
    // Must be admin
    actor: {
      'cognito.groups': { inList: ['admin'] }
    },
    // At least 1 selected
    selectedRecords: {
      'length': { gte: 1 },
      // All selected must be approved
      'all': {
        status: { eq: 'approved' },
        isPublished: { eq: false }
      }
    },
    // Only on list page
    context: {
      'pageType': { eq: 'list' }
    },
    // Not in modal
    context: {
      'modalDepth': { eq: 0 }
    }
  }
}

// Or use custom evaluator for complex logic
{
  label: 'Batch Publish Games',
  url: '/game/bulk-publish',
  visibility: {
    custom: 'canBatchPublish'
  }
}

// Frontend registration:
registry.register('canBatchPublish', async (ctx) => {
  const { actor, selectedRecords, pageType, modalDepth } = ctx;
  
  // Admin only
  if (!actor?.cognito?.groups?.includes('admin')) {
    return { visible: false, enabled: false };
  }
  
  // List page only
  if (pageType !== 'list') {
    return { visible: false, enabled: false };
  }
  
  // Not in modal
  if (modalDepth && modalDepth > 0) {
    return { visible: false, enabled: false };
  }
  
  // At least 1 selected, all approved and unpublished
  if (!selectedRecords || selectedRecords.length === 0) {
    return { visible: false, enabled: false };
  }
  
  const allEligible = selectedRecords.every(r => 
    r.status === 'approved' && !r.isPublished
  );
  
  if (!allEligible) {
    return { 
      visible: true, 
      enabled: false,
      disabledMessage: 'Some selected games cannot be published'
    };
  }
  
  return { visible: true, enabled: true };
});
```

---

## Component Integration Examples

### PageHeader with Evaluation

```typescript
// PageHeader.tsx
import { useEvaluationBatch } from '../../core/hooks/useEvaluation';

export function PageHeader({ pageHeaderActions, ...props }: IPageHeader) {
  // Batch evaluate all actions at once
  const evaluations = useEvaluationBatch(
    pageHeaderActions?.map(a => a.visibility) || []
  );
  
  // Filter visible actions
  const visibleActions = pageHeaderActions?.filter((_, i) => 
    evaluations[i]?.visible
  ) || [];
  
  return (
    <div>
      {visibleActions.map((action, i) => (
        <ActionButton 
          key={i}
          action={action}
          enabled={evaluations[i]?.enabled}
          disabledMessage={evaluations[i]?.disabledMessage}
        />
      ))}
    </div>
  );
}
```

### Table Row Actions with Context

```typescript
// addActionUI.tsx
import { EvaluationContextProvider } from '../../core/context/EvaluationContext';
import { useEvaluationBatch } from '../../core/hooks/useEvaluation';

function RowActions({ record, actions }: { record: any; actions: IPageAction[] }) {
  // Provide record context to all child evaluations
  return (
    <EvaluationContextProvider record={record}>
      <RowActionsInner actions={actions} />
    </EvaluationContextProvider>
  );
}

function RowActionsInner({ actions }: { actions: IPageAction[] }) {
  const evaluations = useEvaluationBatch(actions.map(a => a.visibility));
  
  const visibleActions = actions.filter((_, i) => evaluations[i]?.visible);
  
  return (
    <Space>
      {visibleActions.map((action, i) => (
        <ActionIcon 
          key={i}
          action={action}
          enabled={evaluations[i]?.enabled}
        />
      ))}
    </Space>
  );
}
```

### Form Buttons with Form Values

```typescript
// CreateButtons.tsx
import { useEvaluation } from '../../core/hooks/useEvaluation';
import { Form } from 'antd';

function FormButton({ button }: { button: IFormButton }) {
  const form = Form.useFormInstance();
  const formValues = Form.useWatch([], form);
  
  // Evaluate with form values in context
  const { visible, enabled, disabledMessage } = useEvaluation(
    button.visibility,
    { formValues }
  );
  
  if (!visible) return null;
  
  return (
    <Tooltip title={!enabled ? disabledMessage : undefined}>
      <Button
        {...button}
        disabled={!enabled}
      >
        {button.text}
      </Button>
    </Tooltip>
  );
}
```

### Bulk Actions with Selection

```typescript
// ListPage.tsx
import { EvaluationContextProvider } from '../../core/context/EvaluationContext';

function ListPage() {
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const bulkActions = pageConfig.tableConfig?.bulkActions || [];
  
  return (
    <EvaluationContextProvider selectedRecords={selectedRows}>
      {/* Bulk actions automatically see selectedRecords in context */}
      <BulkActionBar actions={bulkActions} />
      
      <Table
        rowSelection={{
          onChange: (keys, rows) => setSelectedRows(rows)
        }}
        {...tableProps}
      />
    </EvaluationContextProvider>
  );
}
```

---

## Backend Schema Changes

### Enhanced IEntityPageAction

```typescript
// fw24/src/entity/base-entity.ts

export interface IEntityPageAction {
  label: string;
  url?: string;
  icon?: string;
  type?: 'button' | 'dropdown';
  items?: Array<Omit<IEntityPageAction, 'items'>>;
  
  openInModal?: boolean;
  modalConfig?: IEntityPageActionModalConfig;
  modalWidth?: number | string;
  modalTitle?: string;
  hideInModal?: boolean;
  openInModalCondition?: 'sm' | 'md' | 'lg' | 'xl';
  
  /**
   * Visibility configuration (SERIALIZABLE)
   * Evaluated in frontend using UniversalEvaluator
   * 
   * Can be:
   * 1. Inline condition (actor, record, selectedRecords, queryParams, context rules)
   * 2. Custom evaluator reference ({ custom: 'functionName' })
   * 3. Named conditions ({ conditions: ['name1', 'name2'], scope: 'all' })
   * 4. Shortcuts ({ requiredRoles: [...], showWhen: {...} })
   */
  visibility?: VisibilityConfig;
}
```

### Nested Configuration Structure

```typescript
export interface EntitySchema {
  model: {
    // ... existing properties
    
    /**
     * List page configuration (RECOMMENDED)
     */
    listPageConfig?: {
      /** Page header actions */
      actions?: IEntityPageAction[];
      
      breadcrumbs?: Array<{ label: string; url?: string }>;
      defaultSort?: { field: string; order: 'asc' | 'desc' };
      
      /** Table configuration */
      tableConfig?: {
        /** Row actions (per-row: edit, delete, view) */
        rowActions?: IEntityPageAction[];
        
        /** Bulk actions (multi-select: delete selected, export selected) */
        bulkActions?: IEntityPageAction[];
        
        /** Row selection config */
        rowSelection?: {
          enabled: boolean;
          /** Control who can select rows */
          visibility?: VisibilityConfig;
        };
        
        /** Column visibility control */
        columns?: Array<{
          field: string;
          /** Control who can see this column */
          visibility?: VisibilityConfig;
        }>;
      };
    };
    
    /**
     * View page configuration (RECOMMENDED)
     */
    viewPageConfig?: {
      actions?: IEntityPageAction[];
      breadcrumbs?: Array<{ label: string; url?: string }>;
      columnsConfig?: IEntityPageColumnConfig;
      
      /** Field-level visibility */
      fields?: Array<{
        name: string;
        visibility?: VisibilityConfig;
      }>;
    };
    
    /**
     * Edit page configuration (RECOMMENDED)
     */
    editPageConfig?: {
      actions?: IEntityPageAction[];
      breadcrumbs?: Array<{ label: string; url?: string }>;
      columnsConfig?: IEntityPageColumnConfig;
      
      /** Form configuration */
      formConfig?: {
        /** Form buttons with conditional visibility */
        buttons?: Array<{
          text: string;
          action: 'submit' | 'reset' | 'cancel';
          url?: string;
          visibility?: VisibilityConfig;
        }>;
        
        /** Field visibility */
        fields?: Array<{
          name: string;
          visibility?: VisibilityConfig;
          /** Field enablement (editable or read-only) */
          enablement?: VisibilityConfig;
        }>;
      };
    };
    
    // OLD STRUCTURE (Deprecated but supported)
    /** @deprecated Use listPageConfig.actions */
    listPageActions?: IEntityPageAction[];
    /** @deprecated Use viewPageConfig.actions */
    viewPageActions?: IEntityPageAction[];
    /** @deprecated Use editPageConfig.actions */
    editPageActions?: IEntityPageAction[];
  }
}
```

---

## Universal Registry Use Cases

### 1. Form Control Visibility

```typescript
// Backend: Conditional form fields
{
  name: 'approvalNotes',
  type: 'textarea',
  visibility: {
    actor: {
      'cognito.groups': { inList: ['admin', 'team-admin'] }
    },
    formValues: {
      'status': { eq: 'pending-approval' }
    }
  }
}

// Or custom
{
  name: 'advancedSettings',
  type: 'map',
  visibility: {
    custom: 'showAdvancedSettings'
  }
}
```

### 2. Widget Availability

```typescript
// Backend: Dashboard widgets
{
  type: 'analytics-widget',
  visibility: {
    requiredRoles: ['admin'],
    context: {
      'pageType': { eq: 'dashboard' }
    }
  }
}
```

### 3. Feature Flags

```typescript
// Backend: Conditional features
{
  feature: 'bulk-operations',
  visibility: {
    actor: {
      'cognito.groups': { inList: ['admin'] }
    }
  }
}
```

### 4. Page Type Authorization

```typescript
// Backend: Page access control
{
  pageType: 'edit',
  visibility: {
    custom: 'canEditEntity'
  }
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Create type definitions
- [ ] Implement ConditionEvaluatorRegistry
- [ ] Implement UniversalEvaluator
- [ ] Create EvaluationContextProvider
- [ ] Create useEvaluation hooks
- [ ] Write comprehensive tests

### Phase 2: Component Integration (Week 3-4)
- [ ] Integrate into PageHeader
- [ ] Integrate into Table row actions
- [ ] Integrate into Form buttons
- [ ] Integrate into Modal actions
- [ ] Add bulk action support

### Phase 3: Backend Schema (Week 5)
- [ ] Add visibility property to IEntityPageAction
- [ ] Add nested config structure
- [ ] Create compatibility layer
- [ ] Update config generation

### Phase 4: Advanced Features (Week 6)
- [ ] Form field visibility
- [ ] Column visibility
- [ ] Widget system
- [ ] Feature flags
- [ ] Documentation

---

## Benefits

✅ **Single Source of Truth** - Define in backend, evaluate in frontend  
✅ **Universal** - Same system for actions, forms, widgets, features  
✅ **Serializable** - JSON config (no functions in transit)  
✅ **Context-Rich** - selectedRecords, queryParams, pageType, modalDepth  
✅ **Efficient** - Batch evaluation, proper memoization  
✅ **Modal-Aware** - Handles chains, nesting, depth  
✅ **Extensible** - Custom functions via registry  
✅ **Type-Safe** - Full TypeScript support  
✅ **Testable** - Pure functions, easy to test  

---

## Questions Addressed

1. ✅ **Serialization**: Backend defines, config serializes, frontend evaluates
2. ✅ **Universal Registry**: One registry for ALL framework needs
3. ✅ **Context Usage**: Rich examples for selectedRecords, queryParams, pageType, modalDepth
4. ✅ **Modal Chains**: Proper tracking, batch evaluation, context merging

What do you think? 🎯

