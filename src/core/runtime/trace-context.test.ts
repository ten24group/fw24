import {
    TRACE_ID_HEADER,
    generateTraceIdValue,
    readTraceIdHeader,
    resolveIncomingTraceId,
    getTraceId,
    runWithTraceId,
    runWithIncomingTraceContext,
    traceHeaders,
    injectTraceHeaders,
} from './trace-context';
import { createLogger } from '../../logging';
import { createExecutionContext } from './execution-context';
import { createHttpHeaders } from './execution-context/propagation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('trace-context: id generation', () => {
    it('generates a v4 UUID', () => {
        expect(generateTraceIdValue()).toMatch(UUID_RE);
    });

    it('generates unique ids', () => {
        const a = generateTraceIdValue();
        const b = generateTraceIdValue();
        expect(a).not.toEqual(b);
    });
});

describe('trace-context: readTraceIdHeader', () => {
    it('reads x-trace-id case-insensitively and trims', () => {
        expect(readTraceIdHeader({ 'X-Trace-Id': '  abc-123  ' })).toBe('abc-123');
        expect(readTraceIdHeader({ 'x-trace-id': 'lower' })).toBe('lower');
    });

    it('tolerates array-valued headers', () => {
        expect(readTraceIdHeader({ 'x-trace-id': [ 'first', 'second' ] })).toBe('first');
    });

    it('returns undefined when absent, blank, or headers missing', () => {
        expect(readTraceIdHeader({ 'x-other': 'y' })).toBeUndefined();
        expect(readTraceIdHeader({ 'x-trace-id': '   ' })).toBeUndefined();
        expect(readTraceIdHeader(undefined)).toBeUndefined();
        expect(readTraceIdHeader(null)).toBeUndefined();
    });
});

describe('trace-context: resolveIncomingTraceId (reuse vs generate)', () => {
    it('reuses an incoming trace id', () => {
        expect(resolveIncomingTraceId({ 'x-trace-id': 'upstream-id' })).toBe('upstream-id');
    });

    it('generates a new UUID when no incoming header', () => {
        expect(resolveIncomingTraceId({})).toMatch(UUID_RE);
        expect(resolveIncomingTraceId(undefined)).toMatch(UUID_RE);
    });
});

describe('trace-context: getTraceId + context propagation', () => {
    it('returns undefined with no context (graceful)', () => {
        expect(getTraceId()).toBeUndefined();
    });

    it('exposes the id inside runWithTraceId', () => {
        runWithTraceId('fixed-id', () => {
            expect(getTraceId()).toBe('fixed-id');
        });
        // restored to no-context after scope exit
        expect(getTraceId()).toBeUndefined();
    });

    it('generates an id when given a blank one', () => {
        runWithTraceId('   ', () => {
            expect(getTraceId()).toMatch(UUID_RE);
        });
    });

    it('propagates across async boundaries', async () => {
        await runWithTraceId('async-id', async () => {
            await Promise.resolve();
            await new Promise((r) => setTimeout(r, 1));
            expect(getTraceId()).toBe('async-id');
        });
    });

    it('isolates concurrent contexts', async () => {
        const seen: Record<string, string | undefined> = {};
        await Promise.all([
            runWithTraceId('ctx-a', async () => {
                await new Promise((r) => setTimeout(r, 5));
                seen.a = getTraceId();
            }),
            runWithTraceId('ctx-b', async () => {
                await new Promise((r) => setTimeout(r, 1));
                seen.b = getTraceId();
            }),
        ]);
        expect(seen.a).toBe('ctx-a');
        expect(seen.b).toBe('ctx-b');
    });

    it('runWithIncomingTraceContext resolves + runs in one call', () => {
        runWithIncomingTraceContext({ 'x-trace-id': 'from-header' }, () => {
            expect(getTraceId()).toBe('from-header');
        });
        runWithIncomingTraceContext({}, () => {
            expect(getTraceId()).toMatch(UUID_RE);
        });
    });
});

describe('trace-context: outbound header injection', () => {
    it('traceHeaders is empty with no context', () => {
        expect(traceHeaders()).toEqual({});
    });

    it('traceHeaders carries the current id inside a context', () => {
        runWithTraceId('out-id', () => {
            expect(traceHeaders()).toEqual({ [ TRACE_ID_HEADER ]: 'out-id' });
        });
    });

    it('injectTraceHeaders merges without a context = unchanged', () => {
        const h = { 'content-type': 'application/json' };
        expect(injectTraceHeaders(h)).toEqual(h);
        expect(injectTraceHeaders()).toEqual({});
    });

    it('injectTraceHeaders adds x-trace-id inside a context', () => {
        runWithTraceId('inj-id', () => {
            expect(injectTraceHeaders({ 'content-type': 'application/json' })).toEqual({
                'content-type': 'application/json',
                [ TRACE_ID_HEADER ]: 'inj-id',
            });
        });
    });

    it('injectTraceHeaders never overwrites an explicit caller value', () => {
        runWithTraceId('ambient-id', () => {
            expect(injectTraceHeaders({ 'X-Trace-Id': 'explicit' })).toEqual({ 'X-Trace-Id': 'explicit' });
        });
    });
});

describe('trace-context: createHttpHeaders auto-injects x-trace-id', () => {
    const ctx = createExecutionContext({ correlationId: 'corr-123' });

    it('adds x-trace-id when a trace context is active', () => {
        runWithTraceId('http-trace', () => {
            expect(createHttpHeaders(ctx)[ TRACE_ID_HEADER ]).toBe('http-trace');
        });
    });

    it('omits x-trace-id when no trace context', () => {
        expect(createHttpHeaders(ctx)[ TRACE_ID_HEADER ]).toBeUndefined();
    });
});

describe('trace-context: logger attaches traceId to _meta', () => {
    // tslog (stylePrettyLogs:false) emits one JSON line per log via console.log.
    function captureLoggedMeta(fn: () => void): any {
        const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
        try {
            fn();
            for (const call of spy.mock.calls) {
                const line = call[ 0 ];
                if (typeof line !== 'string' || line[ 0 ] !== '{') continue;
                try {
                    const obj = JSON.parse(line);
                    if (obj && obj._meta) return obj._meta;
                } catch { /* not our JSON line */ }
            }
            return undefined;
        } finally {
            spy.mockRestore();
        }
    }

    it('includes traceId in _meta within a trace context (JSON forwarder path)', () => {
        // type:'json' mirrors the JSON console output the log forwarder parses.
        const logger = createLogger({ name: 'trace-test', type: 'json' });
        const meta = captureLoggedMeta(() => {
            runWithTraceId('log-trace-id', () => {
                logger.info('hello with trace');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.traceId).toBe('log-trace-id');
        // existing meta fields are preserved
        expect(meta.logLevelName).toBeDefined();
    });

    it('omits traceId when no trace context (backward-compatible)', () => {
        const logger = createLogger({ name: 'trace-test-2', type: 'json' });
        const meta = captureLoggedMeta(() => {
            logger.info('hello without trace');
        });
        expect(meta).toBeDefined();
        expect(meta.traceId).toBeUndefined();
    });
});
