import type { EventHandler, EventMatcher, IEventDispatcher, IEventPayload, StructuredEventMatcher } from './event-types';
import { getMatcherKey, STRUCTURED_EVENT_WILDCARD_KEY } from './event-utils';
import { getGlobalListenerMetadata } from './decorator';
import { createLogger } from '../logging';

/**
 * The EventDispatcher is the central hub for the event system.
 * It manages listener registration, event dispatching, and synchronous/asynchronous handler execution.
 * - Synchronous listener errors are logged to `logger.error`.
 * - Asynchronous listener invocation issues and errors during promise execution (caught by `awaitAsyncHandlers`)
 *   are logged using an internal logger instance (`this.logger`).
 * It can auto-register listeners decorated with `@OnEvent`.
 */
export class EventDispatcher implements IEventDispatcher {
  private readonly logger = createLogger(this.constructor.name);
  private syncListeners: Map<string, Set<EventHandler>> = new Map();
  private asyncListeners: Map<string, Set<EventHandler>> = new Map();
  /**
   * Stores promises from dispatched asynchronous handlers, keyed by the event matcher string.
   * This allows `awaitAsyncHandlers` to wait for their completion.
   */
  private asyncHandlersPromises: Map<string, Set<Promise<void>>> = new Map();

  /**
   * Creates or retrieves an EventDispatcher instance.
   * If autoRegisterGlobalListeners is true, it registers all listeners
   * collected by the @OnEvent decorator.
   *
   * @param autoRegisterGlobalListeners - Whether to automatically register decorated listeners.
   * @param listenerInstanceContext - Optional context (e.g., a class instance) to scope listener registration from decorators.
   *                                  This helps in correctly binding `this` for decorated instance methods.
   */
  constructor(autoRegisterGlobalListeners: boolean = true, listenerInstanceContext?: any) {
    if (autoRegisterGlobalListeners) {
      this.registerGlobalListeners(listenerInstanceContext);
    }
  }

  private registerGlobalListeners(listenerInstanceContext?: any): void {
    const allMetadata = getGlobalListenerMetadata();
    allMetadata.forEach(meta => {
      // If a context is provided, only register listeners from that context (class instance)
      // This is a simplified check; a more robust solution might involve comparing constructors or instance equality.
      if (listenerInstanceContext && meta.targetConstructor !== listenerInstanceContext.constructor) {
        return;
      }

      const handler = meta.handlerMethod.bind(listenerInstanceContext || meta.targetConstructor.prototype);

      if (Array.isArray(meta.matcher)) {
        meta.matcher.forEach(m => this._register(m, handler, meta.isAsync));
      } else {
        this._register(meta.matcher, handler, meta.isAsync);
      }
    });
  }

  private _register(matcher: EventMatcher, handler: EventHandler, isAsync: boolean): void {
    const key = getMatcherKey(matcher);
    const map = isAsync ? this.asyncListeners : this.syncListeners;
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key)!.add(handler);
  }

  private _unregister(matcher: EventMatcher, handler: EventHandler, isAsync: boolean): void {
    const key = getMatcherKey(matcher);
    const map = isAsync ? this.asyncListeners : this.syncListeners;
    map.get(key)?.delete(handler);
    if (map.get(key)?.size === 0) {
      map.delete(key);
    }
  }

  /**
   * Registers a synchronous event listener.
   * @param matcher - The event criteria to listen for.
   * @param handler - The function to call when the event is dispatched.
   */
  on(matcher: EventMatcher, handler: EventHandler): void {
    this._register(matcher, handler, false);
  }

  /**
   * Registers an asynchronous (fire-and-forget) event listener.
   * @param matcher - The event criteria to listen for.
   * @param handler - The function to call when the event is dispatched.
   */
  onAsync(matcher: EventMatcher, handler: EventHandler): void {
    this._register(matcher, handler, true);
  }

  /**
   * Unregisters an event listener.
   * @param matcher - The event criteria the listener was registered with.
   * @param handler - The handler function to remove.
   */
  off(matcher: EventMatcher, handler: EventHandler): void {
    // Attempt to remove from both sync and async, as we don't know its original type without more info
    this._unregister(matcher, handler, false);
    this._unregister(matcher, handler, true);
  }

  /**
   * Dispatches an event to all matching listeners.
   *
   * 1. Ensures the event payload has a timestamp.
   * 2. Collects all synchronous and asynchronous handlers that match the event's `type`:
   *    - Handlers registered with the universal wildcard (`'*'`).
   *    - For string event types: handlers registered with the exact string.
   *    - For structured event types:
   *        - Handlers registered with an exact `StructuredEventMatcher`.
   *        - Handlers registered with `StructuredEventMatcher`s that are subsets of the event's type.
   *        - Handlers registered with the structured wildcard (`{}`).
   * 3. Executes all collected synchronous handlers sequentially. Any error thrown by a synchronous handler
   *    is caught and logged to `logger.error`. The dispatcher continues to execute other synchronous handlers.
   * 4. Invokes all collected asynchronous handlers (fire-and-forget style from the perspective of the `dispatch` call).
   *    - If an async handler returns a `Promise`, it's added to the `this.asyncHandlersPromises` map for later settlement by `awaitAsyncHandlers()`.
   *    - If an async handler returns a non-Promise value, a warning is logged via `this.logger.warn`.
   *    - Errors during the immediate invocation of an async handler (e.g., if the handler is not a function) are logged via `this.logger.error`.
   *
   * @template P - The type of the event data in the payload.
   * @param eventPayload - The event object to dispatch.
   */
  async dispatch<P = any>(eventPayload: IEventPayload<P>): Promise<void> {
    if (!eventPayload.timestamp) {
      eventPayload.timestamp = new Date(); // Ensure timestamp is set
    }

    const { type: eventMatcher } = eventPayload;
    const collectedSyncHandlers: Set<EventHandler> = new Set();
    const collectedAsyncHandlers: Set<EventHandler> = new Set();

    const addHandlersForKey = (key: string) => {
      this.syncListeners.get(key)?.forEach(handler => collectedSyncHandlers.add(handler));
      this.asyncListeners.get(key)?.forEach(handler => collectedAsyncHandlers.add(handler));
    };

    // 1. Always check for the universal string wildcard '*' listener
    addHandlersForKey('*');

    if (typeof eventMatcher === 'string') {
      // 2. For string events, add specific string match
      addHandlersForKey(getMatcherKey(eventMatcher));
    } else if (typeof eventMatcher === 'object' && eventMatcher !== null) {
      // 2. For structured events, add specific match for the full object
      addHandlersForKey(getMatcherKey(eventMatcher));

      // 3. For structured events, generate and add handlers for subset wildcard keys
      const eventKeys = Object.keys(eventMatcher).filter(k => eventMatcher[ k ] !== undefined);
      if (eventKeys.length > 0) {
        for (let i = 0; i < (1 << eventKeys.length); i++) {
          const subsetMatcher: StructuredEventMatcher = {};
          for (let j = 0; j < eventKeys.length; j++) {
            if ((i & (1 << j))) {
              const key = eventKeys[ j ];
              subsetMatcher[ key ] = eventMatcher[ key ];
            }
          }
          // Add if it's a real subset (not the original full matcher, which is already added)
          // And not an empty object (which is STRUCTURED_EVENT_WILDCARD_KEY, handled separately)
          if (Object.keys(subsetMatcher).length < eventKeys.length) {
            const subsetKey = getMatcherKey(subsetMatcher);
            // Ensure we don't re-add STRUCTURED_EVENT_WILDCARD_KEY if the subset becomes empty and it has its own handler.
            // This also prevents adding '*' if a subset somehow resolved to it, though getMatcherKey for objects won't do that.
            if (subsetKey !== STRUCTURED_EVENT_WILDCARD_KEY && subsetKey !== '*') {
              addHandlersForKey(subsetKey);
            }
          }
        }
      }
      // 4. For structured events, always check for the structured wildcard (empty object matcher)
      addHandlersForKey(STRUCTURED_EVENT_WILDCARD_KEY);

    } else {
      this.logger.warn('Event dispatch called with invalid event type:', eventMatcher);
      return;
    }

    // Execute synchronous listeners sequentially
    for (const handler of collectedSyncHandlers) {
      try {
        await handler(eventPayload);
      } catch (error) {
        this.logger.error('Error in synchronous event listener:', {
          eventMatcher: eventPayload.type,
          handler: handler.name || 'anonymous',
          error,
        });
      }
    }

    // Execute asynchronous listeners (fire-and-forget)
    for (const handler of collectedAsyncHandlers) {

      try {
        const promise = handler(eventPayload);

        if (promise instanceof Promise) {

          const promises = this.asyncHandlersPromises.get(getMatcherKey(eventPayload.type)) || new Set();
          promises.add(promise);

          this.asyncHandlersPromises.set(getMatcherKey(eventPayload.type), promises);

        } else {

          this.logger.warn('Async handler returned a non-promise value:', {
            eventMatcher: eventPayload.type,
            handler: handler.name || 'anonymous',
            value: promise,
          });
        }
      } catch (error) {
        // This catch might not always work for unhandled promise rejections within the async handler
        // Proper error handling within the async listeners themselves is crucial.
        this.logger.error('Error invoking asynchronous event listener:', {
          eventMatcher: eventPayload.type,
          handler: handler.name || 'anonymous',
          error,
        });
      }
    }
  }

  /**
   * Awaits the completion of all asynchronous event handler promises that were initiated by previous `dispatch` calls.
   *
   * This method iterates through all promises stored in `this.asyncHandlersPromises`.
   * For each promise, it awaits its settlement.
   * - If a promise rejects, the error is caught and logged using `this.logger.error` (including the event key associated with the promise).
   *   The dispatcher continues to await other promises.
   * - After attempting to await all promises, `this.asyncHandlersPromises` is cleared.
   * This is crucial in environments like AWS Lambda to ensure all background tasks complete before the function exits.
   */
  async awaitAsyncHandlers(): Promise<void> {

    const promises = Array.from(this.asyncHandlersPromises.entries()).flatMap(([ k, p ]) => Array.from(p).map(p => [ k, p ]));

    try {
      // ensure each handler runs separately and does not affect other handlers
      for (const [ key, promise ] of promises) {
        try {
          await promise;
        } catch (error) {
          this.logger.error('Error awaiting asynchronous event listener: for key', {
            key: key,
            error,
          });
        }
      }
    } catch (error) {
      this.logger.error('Error awaiting asynchronous event listeners:', {
        error,
      });
    }

    this.asyncHandlersPromises.clear();
  }
}

export const defaultEventDispatcher = new EventDispatcher();