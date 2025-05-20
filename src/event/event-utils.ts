import type { EventMatcher, StructuredEventMatcher } from './event-types';

const STRUCTURED_MATCHER_KEY_SEPARATOR = '|';
const STRUCTURED_MATCHER_KV_SEPARATOR = ':';

export const STRUCTURED_EVENT_WILDCARD_KEY = '__STRUCTURED_WILDCARD__';

/**
 * Converts an EventMatcher into a canonical string key for use in listener maps.
 * - If the matcher is a string, it's returned directly.
 * - If the matcher is a StructuredEventMatcher, its defined properties are sorted alphabetically by key,
 *   then joined into a string like "key1:value1|key2:value2".
 *   This ensures that { entity: 'User', phase: 'post' } and { phase: 'post', entity: 'User' }
 *   produce the same canonical key.
 * @param matcher The EventMatcher to canonicalize.
 * @returns A string key.
 */
export function getMatcherKey(matcher: EventMatcher): string {
  if (typeof matcher === 'string') {
    return matcher;
  }

  if (typeof matcher === 'object' && matcher !== null) {
    const keys = Object.keys(matcher).sort();
    if (keys.length === 0) {
      return STRUCTURED_EVENT_WILDCARD_KEY;
    }
    return keys
      .map(key => `${key}:${matcher[ key ]}`)
      .join(STRUCTURED_MATCHER_KEY_SEPARATOR);
  }

  // Should not happen with proper TypeScript usage, but handle defensively.
  console.warn('getMatcherKey received invalid matcher type:', matcher);
  return '__INVALID_MATCHER__';
} 