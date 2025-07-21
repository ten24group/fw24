/**
 * @file Utility functions for the event system, primarily for generating canonical keys for event matchers.
 */
import { DefaultLogger } from '../logging';
import type { EventMatcher, StructuredEventMatcher } from './event-types';

/** 
 * Separator used when joining key-value pairs of a `StructuredEventMatcher` 
 * into a canonical string key. 
 */
const STRUCTURED_MATCHER_KEY_SEPARATOR = '|';

/** 
 * Canonical key used for an empty `StructuredEventMatcher` (e.g., `{}`), 
 * which acts as a wildcard for all structured events. 
 */
export const STRUCTURED_EVENT_WILDCARD_KEY = '__STRUCTURED_WILDCARD__';

/**
 * Converts an `EventMatcher` into a canonical string key for use in listener maps.
 * This ensures consistent key generation for matching logic.
 *
 * - If the matcher is a simple string (e.g., `'app:start'`), it's returned directly.
 * - If the matcher is a `StructuredEventMatcher` (e.g., `{ entity: 'User', phase: 'post' }`), 
 *   its defined properties are sorted alphabetically by key, then joined into a string 
 *   like `"entity:User|phase:post"` using `STRUCTURED_MATCHER_KEY_SEPARATOR`.
 *   This ensures that `{ entity: 'User', phase: 'post' }` and `{ phase: 'post', entity: 'User' }`
 *   produce the same canonical key.
 * - An empty `StructuredEventMatcher` (`{}`) results in `STRUCTURED_EVENT_WILDCARD_KEY`.
 * 
 * @param matcher The `EventMatcher` to canonicalize.
 * @returns A string key representing the matcher.
 *          Returns `'__INVALID_MATCHER__'` if the matcher type is unrecognized (should not occur with TypeScript).
 * 
 * @example
 * getMatcherKey('user:created'); // "user:created"
 * getMatcherKey({ entity: 'Order', operation: 'update' }); // "entity:Order|operation:update"
 * getMatcherKey({ operation: 'update', entity: 'Order' }); // "entity:Order|operation:update" (sorted)
 * getMatcherKey({}); // "__STRUCTURED_WILDCARD__"
 */
export function getMatcherKey(matcher: EventMatcher): string {
  if (typeof matcher === 'string') {
    return matcher;
  }

  if (typeof matcher === 'object' && matcher !== null) {
    // Get keys, filter out undefined values (though TS types usually prevent this for StructuredEventMatcher values),
    // then sort for canonical representation.
    const keys = Object.keys(matcher).filter(key => matcher[ key ] !== undefined).sort() as Array<keyof StructuredEventMatcher>;
    if (keys.length === 0) {
      return STRUCTURED_EVENT_WILDCARD_KEY;
    }
    return keys
      .map(key => `${key}:${matcher[ key ]}`)
      .join(STRUCTURED_MATCHER_KEY_SEPARATOR);
  }

  // Should not happen with proper TypeScript usage, but handle defensively.
  DefaultLogger.warn('event/getMatcherKey received invalid matcher type:', matcher);
  return '__INVALID_MATCHER__';
} 