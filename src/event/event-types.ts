/**
 * Defines the structure for a complex event matcher, allowing for wildcarding.
 * All properties are optional. An absent property means it matches any value for that dimension.
 */
export type StructuredEventMatcher = {
  phase?: 'pre' | 'post' | 'fail' | 'success' | string; // Lifecycle phase or custom string
  operation?: 'create' | 'update' | 'delete' | 'get' | 'list' | 'query' | 'upsert' | 'validate' | string; // Action or custom string
  entity?: string;    // Specific entity type like 'User', 'Order', or a category like 'customer-related'
  customType?: string;// For uniquely identifying custom structured events, or a general category

  // Allows for future extension with more specific dimensions without breaking changes.
  [ key: string ]: string | undefined;
};

/**
 * Represents the criteria a listener subscribes to or an event is emitted with.
 * It can be a simple string for unique, global events, or a StructuredEventMatcher for more complex, dimensional events.
 */
export type EventMatcher = string | StructuredEventMatcher;

/**
 * Interface for the actual event object that is dispatched and received by listeners.
 */
export interface IEventPayload<TData = any> {
  /** 
   * The specific EventMatcher that characterizes this event instance. 
   * If it's a StructuredEventMatcher, it should be the most specific representation of the event.
   */
  type: EventMatcher;

  /** The actual data or content of the event. */
  data?: TData;

  /** Timestamp of when the event was created/occurred. */
  timestamp: Date;

  /** 
   * For events related to a specific data entity, this holds the entity's name or type.
   * May be redundant if `type` is a `StructuredEventMatcher` already containing an `entity` property.
   */
  entityName?: string;

  /** Optional ID for tracing event flows across systems or correlating logs. */
  correlationId?: string;

  /** Optional context, like user/tenant information, request details, etc. */
  context?: Record<string, any>;
} 