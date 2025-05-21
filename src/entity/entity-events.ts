import { defaultEventDispatcher } from '../event/dispatcher';
import type { StructuredEventMatcher, IEventPayload, IEventDispatcher } from '../event/event-types';

type EntityEventPhase = 'pre' | 'post';
type EntityEventSubPhase = 'validate' | 'duplicate' | 'compositeKey';
type EntityEventOperation = 'create' | 'update' | 'delete' | 'get' | 'list' | 'query' | 'upsert' | 'validate' | 'duplicate';
type EntityEventSuccessFail = 'success' | 'fail';

/**
 * Creates a structured event matcher for entity operations.
 * 
 * @param phase The lifecycle phase (pre, post, fail, success)
 * @param operation The CRUD operation (create, read, update, delete, etc.)
 * @param entity The entity name (optional)
 * @returns A structured event matcher for the specified parameters
 */
export function createEntityEventMatcher(options: {
  entity?: string,
  phase?: EntityEventPhase,
  subPhase?: EntityEventSubPhase,
  operation?: EntityEventOperation,
  successFail?: EntityEventSuccessFail,
}) {

  const { entity, phase, subPhase, operation, successFail } = options;

  const matcher: StructuredEventMatcher = {
    entity,
    phase,
    subPhase,
    operation,
    successFail
  };

  return matcher;
}

/**
 * Creates an event payload for entity operations.
 * 
 * @param type The structured event matcher that defines the event type
 * @param data The data associated with the event
 * @param context Additional context information (optional)
 * @returns An event payload object
 */
export function createEntityEventPayload<T = any>(
  options: {
    type: StructuredEventMatcher,
    data: T,
    context?: Record<string, any>
  }
): IEventPayload<T> {
  const { type, data, context = {} } = options;
  return {
    type,
    data,
    timestamp: new Date(),
    entityName: type.entity,
    context
  };
}

export function createEntityEventDispatcher(options: {
  entity: string,
  operation: EntityEventOperation,
  dispatcher?: IEventDispatcher,
  context?: Record<string, any>
}) {

  const { operation, entity, dispatcher = defaultEventDispatcher, context = {} } = options;

  return {
    dispatch: async (options: {
      data: any,
      phase: EntityEventPhase,
      subPhase?: EntityEventSubPhase,
      successFail?: EntityEventSuccessFail,
      context?: Record<string, any>
    }) => {

      const { data, phase, subPhase, successFail, context: newContext = {} } = options;

      const eventMatcher = createEntityEventMatcher({
        entity,
        operation,
        phase,
        subPhase,
        successFail
      });

      await dispatcher.dispatch(
        createEntityEventPayload({
          data,
          type: eventMatcher,
          context: {
            ...context,
            ...newContext
          }
        })
      );
    }
  }
}