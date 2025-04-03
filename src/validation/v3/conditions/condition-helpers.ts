/**
 * Helper functions for creating common validation conditions
 */

/**
 * Creates a condition function that checks if a value equals the expected value
 */
export function conditionEquals<TValue, K extends keyof TValue, TContext = unknown>(
  key: K,
  value: TValue[K],
): (entity: TValue, context?: TContext) => boolean {
  return (entity: TValue): boolean => entity && entity[key] === value;
}

/**
 * Creates a condition function that checks if a value does not equal the expected value
 */
export function conditionNotEquals<TValue, K extends keyof TValue, TContext = unknown>(
  key: K,
  value: TValue[K],
): (entity: TValue, context?: TContext) => boolean {
  return (entity: TValue): boolean => entity && entity[key] !== value;
}

/**
 * Creates a condition function that checks if a value is one of the expected values
 */
export function conditionOneOf<TValue, K extends keyof TValue, TContext = unknown>(
  key: K,
  values: TValue[K][],
): (entity: TValue, context?: TContext) => boolean {
  return (entity: TValue): boolean => entity && values.includes(entity[key]);
}

/**
 * Creates a condition function that checks if a value is truthy
 */
export function conditionExists<TValue, K extends keyof TValue, TContext = unknown>(
  key: K,
): (entity: TValue, context?: TContext) => boolean {
  return (entity: TValue): boolean => entity && !!entity[key];
}

/**
 * Creates a condition function that checks if a numeric value is greater than the expected value
 */
export function conditionGreaterThan<TValue, K extends keyof TValue, TContext = unknown>(
  key: K,
  value: number,
): (entity: TValue, context?: TContext) => boolean {
  return (entity: TValue): boolean =>
    entity && typeof entity[key] === 'number' && (entity[key] as unknown as number) > value;
}

/**
 * Creates a condition function that checks if a numeric value is less than the expected value
 */
export function conditionLessThan<TValue, K extends keyof TValue, TContext = unknown>(
  key: K,
  value: number,
): (entity: TValue, context?: TContext) => boolean {
  return (entity: TValue): boolean =>
    entity && typeof entity[key] === 'number' && (entity[key] as unknown as number) < value;
}

/**
 * Creates a condition function that checks context properties
 */
export function conditionContext<
  TValue,
  TContext extends Record<string | number | symbol, unknown>,
  K extends keyof TContext,
>(key: K, expectedValue: TContext[K]): (entity: TValue, context?: TContext | null | undefined) => boolean {
  return (_entity: TValue, context?: TContext | null | undefined): boolean => {
    return context != null && context[key] === expectedValue;
  };
}
