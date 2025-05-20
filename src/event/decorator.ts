import type { EventMatcher } from './event-types';

export interface ListenerMethodMetadata {
  matcher: EventMatcher | EventMatcher[];
  propertyKey: string | symbol;
  handlerMethod: Function; // Ideally, a more specific function signature
  isAsync: boolean;
  targetConstructor: any; // The constructor of the class the listener is on
}

const globalListenerRegistry: ListenerMethodMetadata[] = [];

/**
 * Decorator to mark a class method as an event listener.
 * 
 * @param matcher - A single EventMatcher (string or StructuredEventMatcher) or an array of EventMatchers.
 *                  The decorated method will be called if an emitted event matches any of these criteria.
 * @param options - Optional configuration for the listener.
 *                  `async`: If true, the listener is treated as asynchronous (fire-and-forget)
 *                           and will not block the dispatch call. Defaults to false (synchronous).
 */
export function OnEvent(
  matcher: EventMatcher | EventMatcher[],
  options?: { async?: boolean }
): MethodDecorator {
  return (
    target: Object, // Class prototype for instance methods, or constructor for static methods
    propertyKey: string | symbol, // Name of the decorated method
    descriptor: PropertyDescriptor
  ) => {
    if (typeof descriptor.value !== 'function') {
      throw new Error(`@OnEvent decorator can only be applied to methods, not to ${String(propertyKey)}.`);
    }

    globalListenerRegistry.push({
      matcher,
      propertyKey,
      handlerMethod: descriptor.value,
      isAsync: !!options?.async,
      targetConstructor: target.constructor, // For instance methods, target is prototype, so target.constructor is the class
      // For static methods, target is the constructor itself.
    });
  };
}

/**
 * Retrieves all listener metadata collected by the @OnEvent decorator.
 * This is intended for use by the EventDispatcher during its initialization phase.
 * @returns An array of ListenerMethodMetadata objects.
 */
export function getGlobalListenerMetadata(): ListenerMethodMetadata[] {
  return [ ...globalListenerRegistry ]; // Return a copy to prevent external modification
}

/**
 * Clears the global listener registry.
 * Useful for testing purposes to ensure a clean state between tests.
 */
export function clearGlobalListenerRegistry(): void {
  globalListenerRegistry.length = 0;
} 