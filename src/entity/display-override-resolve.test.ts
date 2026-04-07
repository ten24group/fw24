import { readStoredValueAtPath, resolveWithDisplayOverrides } from './display-override-resolve';

describe('resolveWithDisplayOverrides', () => {
  it('returns stored value when no map', () => {
    expect(
      resolveWithDisplayOverrides({
        storedValue: 'https://a.com/logo.png',
        overrideMap: undefined,
        fieldPath: 'homeTeamLogo',
      }).resolvedValue
    ).toBe('https://a.com/logo.png');
  });

  it('uses override when map has path', () => {
    expect(
      resolveWithDisplayOverrides({
        storedValue: 'https://synced.com/x.png',
        overrideMap: { homeTeamLogo: { value: 'https://admin.com/y.png', kind: 'value' } },
        fieldPath: 'homeTeamLogo',
      }).resolvedValue
    ).toBe('https://admin.com/y.png');
  });

  it('ignores visibility-only entries for the resolved value', () => {
    const r = resolveWithDisplayOverrides({
      storedValue: 'https://synced.com/x.png',
      overrideMap: { homeTeamLogo: { kind: 'visibility' } },
      fieldPath: 'homeTeamLogo',
    });
    expect(r.resolvedValue).toBe('https://synced.com/x.png');
    expect(r.valueFromOverride).toBe(false);
  });

  it('works with readStoredValueAtPath directly for records', () => {
    const record = {
      teamLogo: 'a',
      displayOverrides: { teamLogo: { value: 'b' } },
    } as Record<string, unknown>;

    const resolved = resolveWithDisplayOverrides({
      storedValue: readStoredValueAtPath(record, 'teamLogo'),
      overrideMap: record.displayOverrides as Record<string, unknown>,
      fieldPath: 'teamLogo',
    });

    expect(resolved.resolvedValue).toBe('b');
  });
});

describe('readStoredValueAtPath', () => {
  it('reads nested paths safely', () => {
    const r = { a: { b: 1 } } as Record<string, unknown>;
    expect(readStoredValueAtPath(r, 'a.b')).toBe(1);
    expect(readStoredValueAtPath(r, 'a.missing')).toBeUndefined();
  });
});
