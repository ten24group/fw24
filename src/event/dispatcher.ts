import type { EventMatcher, IEventPayload, StructuredEventMatcher } from './event-types';
import { getMatcherKey, STRUCTURED_EVENT_WILDCARD_KEY } from './event-utils';
import { getGlobalListenerMetadata, ListenerMethodMetadata } from './decorator';

// Type for the handler function stored in the maps
type EventHandler = (payload: IEventPayload<any>) => void | Promise<void>;


export interface IEventDispatcher {
  dispatch<P = any>(eventPayload: IEventPayload<P>): Promise<void>;
  on(matcher: EventMatcher, handler: EventHandler): void;
  onAsync(matcher: EventMatcher, handler: EventHandler): void;
  off(matcher: EventMatcher, handler: EventHandler): void;
}

export class EventDispatcher implements IEventDispatcher {
  private syncListeners: Map<string, Set<EventHandler>> = new Map();
  private asyncListeners: Map<string, Set<EventHandler>> = new Map();
  private static instances: Map<any, EventDispatcher> = new Map(); // For singleton behavior per class instance for listeners

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
      console.warn('Event dispatch called with invalid event type:', eventMatcher);
      return;
    }

    // Execute synchronous listeners sequentially
    for (const handler of collectedSyncHandlers) {
      try {
        await handler(eventPayload);
      } catch (error) {
        console.error('Error in synchronous event listener:', {
          eventMatcher: eventPayload.type,
          handler: handler.name || 'anonymous',
          error,
        });
      }
    }

    // Execute asynchronous listeners (fire-and-forget)
    for (const handler of collectedAsyncHandlers) {
      try {
        // TODO: This is a hack to get the event dispatcher to work with the async handlers.
        // We should find a better way to do this.
        handler(eventPayload); // Intentionally not awaited
      } catch (error) {
        // This catch might not always work for unhandled promise rejections within the async handler
        // Proper error handling within the async listeners themselves is crucial.
        console.error('Error invoking asynchronous event listener:', {
          eventMatcher: eventPayload.type,
          handler: handler.name || 'anonymous',
          error,
        });
      }
    }
  }
} 