import { buildCausedByLinks } from './otel-links';

describe('OTEL causedBy links', () => {
  it('creates a span link for causedBy (and never uses it as parent)', () => {
    const links = buildCausedByLinks({
      correlationId: 'local-corr',
      causedBy: 'upstream-corr-123',
    });

    expect(links.length).toBe(1);
    expect(links[ 0 ].attributes).toMatchObject({
      'fw24.link.kind': 'causedBy',
      'fw24.caused_by': 'upstream-corr-123',
    });
  });

  it('does not create a self-link when causedBy == correlationId', () => {
    const links = buildCausedByLinks({
      correlationId: 'same',
      causedBy: 'same',
    });
    expect(links.length).toBe(0);
  });
});


