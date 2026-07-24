import {
    sanitizeTraceId,
    extractFromHeaders,
    extractFromSqs,
    extractFromEventBridge,
    extractFromStepFunctions,
    extractFromKinesis,
    createHttpHeaders,
    createExecutionContext,
    runWithExecutionContextSync,
} from './execution-context';
import { createLogger } from '../../logging';

describe('sanitizeTraceId', () => {
    it('accepts UUIDs, W3C hex ids, and AWS request ids', () => {
        expect(sanitizeTraceId('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
        expect(sanitizeTraceId('0af7651916cd43dd8448eb211c80319c')).toBe('0af7651916cd43dd8448eb211c80319c');
        expect(sanitizeTraceId('  abc.123_DEF-456  ')).toBe('abc.123_DEF-456');
    });

    it('rejects CR/LF (outbound-header-splitting) and control chars', () => {
        expect(sanitizeTraceId('abc\r\nSet-Cookie: x=y')).toBeUndefined();
        expect(sanitizeTraceId('abc\ndef')).toBeUndefined();
        expect(sanitizeTraceId('abc\tdef')).toBeUndefined();
    });

    it('rejects spaces, disallowed punctuation, and over-length values', () => {
        expect(sanitizeTraceId('has space')).toBeUndefined();
        expect(sanitizeTraceId('semi;colon')).toBeUndefined();
        expect(sanitizeTraceId('a'.repeat(129))).toBeUndefined();
        expect(sanitizeTraceId('a'.repeat(128))).toBe('a'.repeat(128));
    });

    it('treats blank / non-string as absent', () => {
        expect(sanitizeTraceId('   ')).toBeUndefined();
        expect(sanitizeTraceId('')).toBeUndefined();
        expect(sanitizeTraceId(undefined)).toBeUndefined();
        expect(sanitizeTraceId(null)).toBeUndefined();
    });

    // Regression: a producer somewhere upstream can stringify an unset value via a
    // template literal (`${x.correlationId}`) or `String(x)`, yielding the literal
    // text "undefined" (or "null"/"NaN"). That text is alphanumeric, so it passed the
    // charset regex and propagated as if it were a real id — this is what showed up as
    // a bogus 9-character "undefined" trace in Logtrail's Recent Traces list. Reject it
    // as a defense-in-depth backstop, case-insensitively, whatever the real fix at the
    // producer turns out to be.
    it('rejects the literal empty-value tokens "undefined"/"null"/"nan" (any case)', () => {
        expect(sanitizeTraceId('undefined')).toBeUndefined();
        expect(sanitizeTraceId('Undefined')).toBeUndefined();
        expect(sanitizeTraceId('UNDEFINED')).toBeUndefined();
        expect(sanitizeTraceId('null')).toBeUndefined();
        expect(sanitizeTraceId('NULL')).toBeUndefined();
        expect(sanitizeTraceId('nan')).toBeUndefined();
        expect(sanitizeTraceId('NaN')).toBeUndefined();
        expect(sanitizeTraceId('  undefined  ')).toBeUndefined();
    });

    it('does not reject ids that merely contain these tokens as a substring', () => {
        expect(sanitizeTraceId('undefined-1234')).toBe('undefined-1234');
        expect(sanitizeTraceId('req_null_terminated')).toBe('req_null_terminated');
    });
});

describe('extractFromHeaders: inbound sanitization (P0)', () => {
    it('reuses a clean x-correlation-id and caused-by', () => {
        expect(extractFromHeaders({ 'x-correlation-id': 'clean-id-1', 'x-caused-by': 'up-1' })).toEqual({
            correlationId: 'clean-id-1',
            causedBy: 'up-1',
        });
    });

    it('drops a poisoned x-correlation-id (returns undefined so a fresh id is minted)', () => {
        expect(extractFromHeaders({ 'x-correlation-id': 'evil\r\nX-Injected: 1' })).toBeUndefined();
    });

    it('drops only a poisoned caused-by, keeping a clean correlationId', () => {
        expect(extractFromHeaders({ 'x-correlation-id': 'good', 'x-caused-by': 'bad\r\nboom' })).toEqual({
            correlationId: 'good',
            causedBy: undefined,
        });
    });

    it('drops a literal "undefined" x-correlation-id (a stringified unset value upstream)', () => {
        expect(extractFromHeaders({ 'x-correlation-id': 'undefined' })).toBeUndefined();
    });
});

describe('extractFromSqs: inbound sanitization', () => {
    it('drops a poisoned correlationId attribute', () => {
        expect(
            extractFromSqs({ correlationId: { stringValue: 'evil\r\ninjected' } })
        ).toBeUndefined();
    });

    it('keeps a clean correlationId attribute', () => {
        expect(
            extractFromSqs({ correlationId: { stringValue: 'msg-123' } })
        ).toEqual({ correlationId: 'msg-123', causedBy: undefined, sampled: false });
    });

    it('drops a literal "undefined" correlationId attribute (a stringified unset value upstream)', () => {
        expect(
            extractFromSqs({ correlationId: { stringValue: 'undefined' } })
        ).toBeUndefined();
    });
});

describe('extractFromEventBridge / extractFromStepFunctions / extractFromKinesis: literal-token rejection', () => {
    it('EventBridge: drops a literal "undefined" correlationId in detail', () => {
        expect(extractFromEventBridge({ detail: { correlationId: 'undefined' } })).toBeUndefined();
    });

    it('EventBridge: drops a literal "undefined" nested traceContext.correlationId', () => {
        expect(extractFromEventBridge({ detail: { traceContext: { correlationId: 'undefined' } } })).toBeUndefined();
    });

    it('StepFunctions: drops a literal "null" correlationId', () => {
        expect(extractFromStepFunctions({ correlationId: 'null' })).toBeUndefined();
    });

    it('Kinesis: drops a literal "undefined" correlationId embedded in the record data', () => {
        const data = { correlationId: 'undefined' };
        const encoded = Buffer.from(JSON.stringify(data), 'utf-8').toString('base64');
        expect(extractFromKinesis({ kinesis: { data: encoded, partitionKey: 'undefined' } })).toBeUndefined();
    });

    it('Kinesis: drops a literal "undefined" partitionKey fallback when there is no JSON data match', () => {
        const encoded = Buffer.from(JSON.stringify({ unrelated: true }), 'utf-8').toString('base64');
        expect(extractFromKinesis({ kinesis: { data: encoded, partitionKey: 'undefined' } })).toBeUndefined();
    });
});

describe('createHttpHeaders: no x-trace-id (folded onto correlationId)', () => {
    it('emits x-correlation-id + traceparent, and NO x-trace-id', () => {
        const ctx = createExecutionContext({ correlationId: 'corr-123' });
        const headers = createHttpHeaders(ctx);
        expect(headers['x-correlation-id']).toBe('corr-123');
        expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/);
        expect(headers['x-trace-id']).toBeUndefined();
    });
});

describe('logger stamps correlationId onto _meta (forwarder path)', () => {
    // tslog (type:'json') emits one JSON line per log via console.log.
    function captureLoggedMeta(fn: () => void): any {
        const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
        try {
            fn();
            for (const call of spy.mock.calls) {
                const line = call[0];
                if (typeof line !== 'string' || line[0] !== '{') continue;
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

    it('includes correlationId in _meta within an ExecutionContext', () => {
        const logger = createLogger({ name: 'corr-test', type: 'json' });
        const ctx = createExecutionContext({ correlationId: 'log-corr-id' });
        const meta = captureLoggedMeta(() => {
            runWithExecutionContextSync(ctx, () => {
                logger.info('hello with correlation');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('log-corr-id');
        expect(meta.logLevelName).toBeDefined();
    });

    it('omits correlationId when no ExecutionContext (backward-compatible)', () => {
        const logger = createLogger({ name: 'corr-test-2', type: 'json' });
        const meta = captureLoggedMeta(() => {
            logger.info('hello without context');
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBeUndefined();
    });

    it('also includes causedBy in _meta, additively, alongside correlationId', () => {
        const logger = createLogger({ name: 'corr-test-3', type: 'json' });
        const ctx = createExecutionContext({ correlationId: 'own-id', causedBy: 'upstream-id' });
        const meta = captureLoggedMeta(() => {
            runWithExecutionContextSync(ctx, () => {
                logger.info('hello with causedBy');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('own-id');
        expect(meta.causedBy).toBe('upstream-id');
    });

    it('omits causedBy when the context has none (no upstream caller)', () => {
        const logger = createLogger({ name: 'corr-test-4', type: 'json' });
        const ctx = createExecutionContext({ correlationId: 'own-id-only' });
        const meta = captureLoggedMeta(() => {
            runWithExecutionContextSync(ctx, () => {
                logger.info('hello with no upstream');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('own-id-only');
        expect(meta.causedBy).toBeUndefined();
    });

    it('also includes actorId in _meta, additively, alongside correlationId', () => {
        const logger = createLogger({ name: 'corr-test-5', type: 'json' });
        const ctx = createExecutionContext({
            correlationId: 'own-id-2',
            actor: { requestId: 'req-1', timestamp: new Date().toISOString(), actorId: 'user-123' },
        });
        const meta = captureLoggedMeta(() => {
            runWithExecutionContextSync(ctx, () => {
                logger.info('hello with actor');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('own-id-2');
        expect(meta.actorId).toBe('user-123');
    });

    it('omits actorId when the context has no actor', () => {
        const logger = createLogger({ name: 'corr-test-6', type: 'json' });
        const ctx = createExecutionContext({ correlationId: 'own-id-3' });
        const meta = captureLoggedMeta(() => {
            runWithExecutionContextSync(ctx, () => {
                logger.info('hello with no actor');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.actorId).toBeUndefined();
    });

    it('stamps the unverified clientSuppliedActorId instead of actorId when both are present', () => {
        const logger = createLogger({ name: 'corr-test-7', type: 'json' });
        const ctx = createExecutionContext({
            correlationId: 'own-id-4',
            actor: {
                requestId: 'req-2',
                timestamp: new Date().toISOString(),
                actorId: 'arn:aws:iam::123456789012:role/authenticated-role',
                clientSuppliedActorId: 'real-end-user-id',
                clientSuppliedActor: true,
            },
        });
        const meta = captureLoggedMeta(() => {
            runWithExecutionContextSync(ctx, () => {
                logger.info('hello with client-supplied actor');
            });
        });
        expect(meta).toBeDefined();
        // The claimed identity is more useful for triage than the shared IAM role ARN — but this is
        // observability only; base-service.ts's audit stamping never sees clientSuppliedActorId.
        expect(meta.actorId).toBe('real-end-user-id');
    });
});
