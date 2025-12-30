import { replacePattern, matchesPattern } from './pattern-utils';

describe('Pattern Utils - Regex Normalization', () => {
  it('should normalize UUIDs in operation names using default-like regex', () => {
    const uuid = '12345678-1234-1234-1234-1234567890ab';
    const operation = `GET /orders/${uuid}`;

    // This matches what's in DEFAULT_OPERATION_NORMALIZATION_RULES
    const pattern = '/\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b/gi';
    const replacement = ':uuid';

    const result = replacePattern(operation, pattern, replacement);
    expect(result).toBe('GET /orders/:uuid');
  });

  it('should match regex with word boundaries', () => {
    const pattern = '/\\bfoo\\b/i';
    expect(matchesPattern('foo', pattern)).toBe(true);
    expect(matchesPattern('foobar', pattern)).toBe(false);
  });
});
