import { EventDispatcher } from './dispatcher';
import { OnEvent, clearGlobalListenerRegistry, getGlobalListenerMetadata } from './decorator';
import { getMatcherKey, STRUCTURED_EVENT_WILDCARD_KEY } from './event-utils';
import type { IEventPayload, EventMatcher, StructuredEventMatcher } from './event-types';

// Define EventHandler for clarity in tests, matching the one in dispatcher.ts
type TestEventHandler = (payload: IEventPayload) => void | Promise<void>;

describe('Unified Event System', () => {
  let dispatcher: EventDispatcher;

  beforeEach(() => {
    clearGlobalListenerRegistry(); // Ensure clean state for decorator tests
    // For most tests, we don't want auto-registration from previous test suites' decorators
    dispatcher = new EventDispatcher(false);
  });

  describe('getMatcherKey Utility', () => {
    it('should return string for string matcher', () => {
      expect(getMatcherKey('app:start')).toBe('app:start');
    });
    it('should create canonical key for StructuredEventMatcher', () => {
      const m1: StructuredEventMatcher = { phase: 'post', entity: 'User' };
      const m2: StructuredEventMatcher = { entity: 'User', phase: 'post' };
      expect(getMatcherKey(m1)).toBe('entity:User|phase:post');
      expect(getMatcherKey(m2)).toBe('entity:User|phase:post');
    });
    it('should return STRUCTURED_EVENT_WILDCARD_KEY for empty object matcher', () => {
      expect(getMatcherKey({})).toBe(STRUCTURED_EVENT_WILDCARD_KEY);
    });
    it('should handle simple structured matcher with sorted keys', () => {
      // Simplified to ensure no misinterpretation of keys
      const m: StructuredEventMatcher = { "b": "2", "a": "1" };
      expect(getMatcherKey(m)).toBe('a:1|b:2');
    });
  });

  describe('EventDispatcher - Manual Registration & Dispatch', () => {
    it('should call sync listener for exact string match', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      dispatcher.on('exact:string', mockHandler);
      await dispatcher.dispatch({ type: 'exact:string', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should call async listener for exact string match (fire-and-forget)', async () => {
      const mockHandler: jest.Mock<Promise<void>, [ IEventPayload ]> = jest.fn(async (_payload: IEventPayload) => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });
      dispatcher.onAsync('exact:async:string', mockHandler);
      await dispatcher.dispatch({ type: 'exact:async:string', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
      await new Promise(r => setTimeout(r, 10));
    });

    it('should call sync listener for exact StructuredEventMatcher match', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      const matcher: StructuredEventMatcher = { phase: 'post', operation: 'create' };
      dispatcher.on(matcher, mockHandler);
      await dispatcher.dispatch({ type: matcher, entityName: 'Test', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should remove listener with off()', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      const eventType = 'event:off';
      dispatcher.on(eventType, mockHandler);
      dispatcher.off(eventType, mockHandler);
      await dispatcher.dispatch({ type: eventType, timestamp: new Date() });
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('EventDispatcher - Wildcard Matching for StructuredEventMatcher', () => {
    it('should call listener for partial match (phase only)', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      dispatcher.on({ phase: 'post' }, mockHandler);
      await dispatcher.dispatch({ type: { phase: 'post', operation: 'create', entity: 'User' }, entityName: 'User', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should call listener for partial match (entity only)', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      dispatcher.on({ entity: 'User' }, mockHandler);
      await dispatcher.dispatch({ type: { phase: 'post', operation: 'create', entity: 'User' }, entityName: 'User', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should call listener for global wildcard matcher {} (structured events only)', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      dispatcher.on({}, mockHandler);
      await dispatcher.dispatch({ type: { phase: 'post', operation: 'create', entity: 'User' }, entityName: 'User', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
      mockHandler.mockClear();
      await dispatcher.dispatch({ type: 'app:init', timestamp: new Date() });
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should call listener registered with string "*" for ALL event types', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      dispatcher.on('*', mockHandler);
      await dispatcher.dispatch({ type: { phase: 'post', operation: 'create', entity: 'User' }, entityName: 'User', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
      mockHandler.mockClear();
      await dispatcher.dispatch({ type: 'app:init', timestamp: new Date() });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should not call non-matching structured listener', async () => {
      const mockHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      dispatcher.on({ phase: 'pre' }, mockHandler);
      await dispatcher.dispatch({ type: { phase: 'post', operation: 'create' }, entityName: 'Test', timestamp: new Date() });
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should call multiple matching listeners once each for a structured event', async () => {
      const handlerSpecific: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      const handlerPhase: jest.Mock<void, [ IEventPayload ]> = jest.fn();
      const handlerGlobalStructured: jest.Mock<void, [ IEventPayload ]> = jest.fn();

      dispatcher.on({ phase: 'post', operation: 'create', entity: 'Order' }, handlerSpecific);
      dispatcher.on({ phase: 'post' }, handlerPhase);
      dispatcher.on({}, handlerGlobalStructured);

      const event: IEventPayload = { type: { phase: 'post', operation: 'create', entity: 'Order' }, entityName: 'Order', timestamp: new Date() };
      await dispatcher.dispatch(event);

      expect(handlerSpecific).toHaveBeenCalledTimes(1);
      expect(handlerPhase).toHaveBeenCalledTimes(1);
      expect(handlerGlobalStructured).toHaveBeenCalledTimes(1);
    });
  });

  describe('@OnEvent Decorator and Auto-Registration', () => {
    it('should auto-register decorated listeners and call them', async () => {
      class TestListenerService {
        syncHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();
        asyncHandler: jest.Mock<Promise<void>, [ IEventPayload ]> = jest.fn(async (_payload: IEventPayload) => {
          await new Promise(r => setTimeout(r, 0));
        });
        multiMatcherHandler: jest.Mock<void, [ IEventPayload ]> = jest.fn();

        @OnEvent('decorator:test:sync')
        handleSync(payload: IEventPayload): void {
          this.syncHandler(payload);
        }

        @OnEvent('decorator:test:async', { async: true })
        async handleAsync(payload: IEventPayload): Promise<void> {
          this.asyncHandler(payload);
        }

        @OnEvent([ { operation: 'op1' }, 'stringOp2' ])
        handleMultiple(payload: IEventPayload): void {
          this.multiMatcherHandler(payload);
        }
      }

      const serviceInstance = new TestListenerService();
      // Create dispatcher *after* serviceInstance is created and decorated methods are defined.
      const autoDispatcher = new EventDispatcher(true, serviceInstance);

      await autoDispatcher.dispatch({ type: 'decorator:test:sync', timestamp: new Date() });
      expect(serviceInstance.syncHandler).toHaveBeenCalledTimes(1);

      serviceInstance.asyncHandler.mockClear();
      await autoDispatcher.dispatch({ type: 'decorator:test:async', timestamp: new Date() });
      expect(serviceInstance.asyncHandler).toHaveBeenCalledTimes(1);
      await new Promise(r => setTimeout(r, 10)); // Allow async handler to complete

      serviceInstance.multiMatcherHandler.mockClear();
      await autoDispatcher.dispatch({ type: { operation: 'op1' }, entityName: 'TestOp1', timestamp: new Date() });
      expect(serviceInstance.multiMatcherHandler).toHaveBeenCalledTimes(1);

      serviceInstance.multiMatcherHandler.mockClear();
      await autoDispatcher.dispatch({ type: 'stringOp2', timestamp: new Date() });
      expect(serviceInstance.multiMatcherHandler).toHaveBeenCalledTimes(1);
    });

    it('should not register listeners if autoRegisterGlobalListeners is false', async () => {
      const manualDispatcher = new EventDispatcher(false);

      const key = getMatcherKey('decorator:test:sync');
      // @ts-ignore - Accessing private members for test verification
      expect(manualDispatcher.syncListeners.has(key)).toBe(false);
      // @ts-ignore
      expect(manualDispatcher.asyncListeners.has(key)).toBe(false);
    });

    it('handlers registered via decorator should maintain "this" context', async () => {
      class MyService {
        identity: string = 'MyServiceInstance';
        eventHandled: boolean = false;
        handlerSpy: jest.Mock<void, [ IEventPayload ]> = jest.fn();

        @OnEvent('contextTestEvent')
        handleEvent(payload: IEventPayload): void {
          this.handlerSpy(payload);
          expect(this.identity).toBe('MyServiceInstance');
          this.eventHandled = true;
        }
      }

      const myServiceInstance = new MyService();
      const dispatcherForInstance = new EventDispatcher(true, myServiceInstance);

      await dispatcherForInstance.dispatch({ type: 'contextTestEvent', timestamp: new Date() });
      expect(myServiceInstance.handlerSpy).toHaveBeenCalledTimes(1);
      expect(myServiceInstance.eventHandled).toBe(true);
    });
  });
}); 