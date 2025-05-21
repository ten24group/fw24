/**
 * @file Implements the `@OnEvent` decorator for class methods to subscribe to events,
 * and manages a global registry of these decorated listeners.
 */
import type { EventMatcher } from './event-types';

/**
 * Interface for storing metadata about a method decorated with `@OnEvent`.
 * This metadata is collected in a global registry and used by the `EventDispatcher`
 * to automatically register these methods as event listeners.
 */
export interface ListenerMethodMetadata {
  /** The `EventMatcher` (or array of matchers) the decorated method subscribes to. */
  matcher: EventMatcher | EventMatcher[];
  /** The name of the decorated method. */
  propertyKey: string | symbol;
  /** The actual function (method) that was decorated. */
  handlerMethod: Function; // Ideally, a more specific function signature like EventHandler
  /** Indicates if the listener should be treated as asynchronous (fire-and-forget). */
  isAsync: boolean;
  /** 
   * The constructor of the class to which the decorated method belongs.
   * Used by the `EventDispatcher` to correctly bind `this` when invoking the handler, 
   * especially if a `listenerInstanceContext` is provided to the dispatcher.
   */
  targetConstructor: any;
}

/** 
 * Global registry storing metadata for all methods decorated with `@OnEvent` across the application.
 * The `EventDispatcher` reads from this registry during its initialization to auto-register listeners.
 * Should be treated as internal to the event system; direct manipulation is discouraged outside of testing.
 */
const globalListenerRegistry: ListenerMethodMetadata[] = [];

/**
 * Decorator to mark a class method as an event listener.
 * When an `EventDispatcher` is initialized with `autoRegisterGlobalListeners: true` (the default),
 * it will automatically register all methods decorated with `@OnEvent`.
 * 
 * @param matcher - A single `EventMatcher` (string or `StructuredEventMatcher`) or an array of `EventMatcher`s.
 *                  The decorated method will be called if an emitted event matches *any* of these criteria.
 * @param options - Optional configuration for the listener.
 * @param options.async - If `true`, the listener is treated as asynchronous (fire-and-forget)
 *                        and will not block the `dispatch` call. Defaults to `false` (synchronous).
 * 
 * @example
 * class MyNotificationService {
 *   @OnEvent('user:created')
 *   sendWelcomeEmail(payload: IEventPayload) {
 *     // ... send email
 *   }
 * 
 *   @OnEvent({ entity: 'Order', phase: 'post', operation: 'update' }, { async: true })
 *   async updateOrderAnalytics(payload: IEventPayload) {
 *     // ... update analytics asynchronously
 *   }
 * 
 *   @OnEvent([{ entity: 'System', customType: 'Error' }, 'critical:failure'])
 *   handleCriticalEvents(payload: IEventPayload) {
 *     // ... handle critical system events
 *   }
 * }
 */
export function OnEvent(
  matcher: EventMatcher | EventMatcher[],
  options?: { async?: boolean }
): MethodDecorator {
  return (
    target: Object, // Class prototype for instance methods, or constructor function for static methods
    propertyKey: string | symbol, // Name of the decorated method
    descriptor: PropertyDescriptor // Property descriptor of the decorated method
  ) => {
    if (typeof descriptor.value !== 'function') {
      throw new Error(`@OnEvent decorator can only be applied to methods, not to ${String(propertyKey)}.`);
    }

    globalListenerRegistry.push({
      matcher,
      propertyKey,
      handlerMethod: descriptor.value,
      isAsync: !!options?.async, // Ensure boolean value
      targetConstructor: target.constructor, // For instance methods, `target` is the prototype, so `target.constructor` is the class.
      // For static methods, `target` is the constructor function itself.
    });
  };
}

/**
 * Retrieves a copy of all listener metadata collected by the `@OnEvent` decorator.
 * This is intended for use by the `EventDispatcher` during its initialization phase
 * to auto-register decorated listeners.
 * 
 * @returns An array of `ListenerMethodMetadata` objects. The returned array is a shallow copy
 *          to prevent external modification of the internal registry.
 */
export function getGlobalListenerMetadata(): ListenerMethodMetadata[] {
  return [ ...globalListenerRegistry ]; // Return a copy to prevent external modification
}

/**
 * Clears the global listener registry.
 * This is primarily useful for testing purposes to ensure a clean state between tests
 * that might involve dynamic class definitions with `@OnEvent` decorators.
 * **Caution:** Calling this in production could unregister all decorator-based listeners 
 * if dispatchers are re-initialized afterwards.
 */
export function clearGlobalListenerRegistry(): void {
  globalListenerRegistry.length = 0;
} 