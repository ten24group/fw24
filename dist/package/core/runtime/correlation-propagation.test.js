"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const execution_context_1 = require("./execution-context");
const logging_1 = require("../../logging");
describe('sanitizeTraceId', () => {
    it('accepts UUIDs, W3C hex ids, and AWS request ids', () => {
        expect((0, execution_context_1.sanitizeTraceId)('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
        expect((0, execution_context_1.sanitizeTraceId)('0af7651916cd43dd8448eb211c80319c')).toBe('0af7651916cd43dd8448eb211c80319c');
        expect((0, execution_context_1.sanitizeTraceId)('  abc.123_DEF-456  ')).toBe('abc.123_DEF-456');
    });
    it('rejects CR/LF (outbound-header-splitting) and control chars', () => {
        expect((0, execution_context_1.sanitizeTraceId)('abc\r\nSet-Cookie: x=y')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('abc\ndef')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('abc\tdef')).toBeUndefined();
    });
    it('rejects spaces, disallowed punctuation, and over-length values', () => {
        expect((0, execution_context_1.sanitizeTraceId)('has space')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('semi;colon')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('a'.repeat(129))).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('a'.repeat(128))).toBe('a'.repeat(128));
    });
    it('treats blank / non-string as absent', () => {
        expect((0, execution_context_1.sanitizeTraceId)('   ')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)(undefined)).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)(null)).toBeUndefined();
    });
    // Regression: a producer somewhere upstream can stringify an unset value via a
    // template literal (`${x.correlationId}`) or `String(x)`, yielding the literal
    // text "undefined" (or "null"/"NaN"). That text is alphanumeric, so it passed the
    // charset regex and propagated as if it were a real id — this is what showed up as
    // a bogus 9-character "undefined" trace in Logtrail's Recent Traces list. Reject it
    // as a defense-in-depth backstop, case-insensitively, whatever the real fix at the
    // producer turns out to be.
    it('rejects the literal empty-value tokens "undefined"/"null"/"nan" (any case)', () => {
        expect((0, execution_context_1.sanitizeTraceId)('undefined')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('Undefined')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('UNDEFINED')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('null')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('NULL')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('nan')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('NaN')).toBeUndefined();
        expect((0, execution_context_1.sanitizeTraceId)('  undefined  ')).toBeUndefined();
    });
    it('does not reject ids that merely contain these tokens as a substring', () => {
        expect((0, execution_context_1.sanitizeTraceId)('undefined-1234')).toBe('undefined-1234');
        expect((0, execution_context_1.sanitizeTraceId)('req_null_terminated')).toBe('req_null_terminated');
    });
});
describe('extractFromHeaders: inbound sanitization (P0)', () => {
    it('reuses a clean x-correlation-id and caused-by', () => {
        expect((0, execution_context_1.extractFromHeaders)({ 'x-correlation-id': 'clean-id-1', 'x-caused-by': 'up-1' })).toEqual({
            correlationId: 'clean-id-1',
            causedBy: 'up-1',
        });
    });
    it('drops a poisoned x-correlation-id (returns undefined so a fresh id is minted)', () => {
        expect((0, execution_context_1.extractFromHeaders)({ 'x-correlation-id': 'evil\r\nX-Injected: 1' })).toBeUndefined();
    });
    it('drops only a poisoned caused-by, keeping a clean correlationId', () => {
        expect((0, execution_context_1.extractFromHeaders)({ 'x-correlation-id': 'good', 'x-caused-by': 'bad\r\nboom' })).toEqual({
            correlationId: 'good',
            causedBy: undefined,
        });
    });
    it('drops a literal "undefined" x-correlation-id (a stringified unset value upstream)', () => {
        expect((0, execution_context_1.extractFromHeaders)({ 'x-correlation-id': 'undefined' })).toBeUndefined();
    });
});
describe('extractFromSqs: inbound sanitization', () => {
    it('drops a poisoned correlationId attribute', () => {
        expect((0, execution_context_1.extractFromSqs)({ correlationId: { stringValue: 'evil\r\ninjected' } })).toBeUndefined();
    });
    it('keeps a clean correlationId attribute', () => {
        expect((0, execution_context_1.extractFromSqs)({ correlationId: { stringValue: 'msg-123' } })).toEqual({ correlationId: 'msg-123', causedBy: undefined, sampled: false });
    });
    it('drops a literal "undefined" correlationId attribute (a stringified unset value upstream)', () => {
        expect((0, execution_context_1.extractFromSqs)({ correlationId: { stringValue: 'undefined' } })).toBeUndefined();
    });
});
describe('extractFromEventBridge / extractFromStepFunctions / extractFromKinesis: literal-token rejection', () => {
    it('EventBridge: drops a literal "undefined" correlationId in detail', () => {
        expect((0, execution_context_1.extractFromEventBridge)({ detail: { correlationId: 'undefined' } })).toBeUndefined();
    });
    it('EventBridge: drops a literal "undefined" nested traceContext.correlationId', () => {
        expect((0, execution_context_1.extractFromEventBridge)({ detail: { traceContext: { correlationId: 'undefined' } } })).toBeUndefined();
    });
    it('StepFunctions: drops a literal "null" correlationId', () => {
        expect((0, execution_context_1.extractFromStepFunctions)({ correlationId: 'null' })).toBeUndefined();
    });
    it('Kinesis: drops a literal "undefined" correlationId embedded in the record data', () => {
        const data = { correlationId: 'undefined' };
        const encoded = Buffer.from(JSON.stringify(data), 'utf-8').toString('base64');
        expect((0, execution_context_1.extractFromKinesis)({ kinesis: { data: encoded, partitionKey: 'undefined' } })).toBeUndefined();
    });
    it('Kinesis: drops a literal "undefined" partitionKey fallback when there is no JSON data match', () => {
        const encoded = Buffer.from(JSON.stringify({ unrelated: true }), 'utf-8').toString('base64');
        expect((0, execution_context_1.extractFromKinesis)({ kinesis: { data: encoded, partitionKey: 'undefined' } })).toBeUndefined();
    });
});
describe('createHttpHeaders: no x-trace-id (folded onto correlationId)', () => {
    it('emits x-correlation-id + traceparent, and NO x-trace-id', () => {
        const ctx = (0, execution_context_1.createExecutionContext)({ correlationId: 'corr-123' });
        const headers = (0, execution_context_1.createHttpHeaders)(ctx);
        expect(headers['x-correlation-id']).toBe('corr-123');
        expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/);
        expect(headers['x-trace-id']).toBeUndefined();
    });
});
describe('logger stamps correlationId onto _meta (forwarder path)', () => {
    // tslog (type:'json') emits one JSON line per log via console.log.
    function captureLoggedMeta(fn) {
        const spy = jest.spyOn(console, 'log').mockImplementation(() => { });
        try {
            fn();
            for (const call of spy.mock.calls) {
                const line = call[0];
                if (typeof line !== 'string' || line[0] !== '{')
                    continue;
                try {
                    const obj = JSON.parse(line);
                    if (obj && obj._meta)
                        return obj._meta;
                }
                catch { /* not our JSON line */ }
            }
            return undefined;
        }
        finally {
            spy.mockRestore();
        }
    }
    it('includes correlationId in _meta within an ExecutionContext', () => {
        const logger = (0, logging_1.createLogger)({ name: 'corr-test', type: 'json' });
        const ctx = (0, execution_context_1.createExecutionContext)({ correlationId: 'log-corr-id' });
        const meta = captureLoggedMeta(() => {
            (0, execution_context_1.runWithExecutionContextSync)(ctx, () => {
                logger.info('hello with correlation');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('log-corr-id');
        expect(meta.logLevelName).toBeDefined();
    });
    it('omits correlationId when no ExecutionContext (backward-compatible)', () => {
        const logger = (0, logging_1.createLogger)({ name: 'corr-test-2', type: 'json' });
        const meta = captureLoggedMeta(() => {
            logger.info('hello without context');
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBeUndefined();
    });
    it('also includes causedBy in _meta, additively, alongside correlationId', () => {
        const logger = (0, logging_1.createLogger)({ name: 'corr-test-3', type: 'json' });
        const ctx = (0, execution_context_1.createExecutionContext)({ correlationId: 'own-id', causedBy: 'upstream-id' });
        const meta = captureLoggedMeta(() => {
            (0, execution_context_1.runWithExecutionContextSync)(ctx, () => {
                logger.info('hello with causedBy');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('own-id');
        expect(meta.causedBy).toBe('upstream-id');
    });
    it('omits causedBy when the context has none (no upstream caller)', () => {
        const logger = (0, logging_1.createLogger)({ name: 'corr-test-4', type: 'json' });
        const ctx = (0, execution_context_1.createExecutionContext)({ correlationId: 'own-id-only' });
        const meta = captureLoggedMeta(() => {
            (0, execution_context_1.runWithExecutionContextSync)(ctx, () => {
                logger.info('hello with no upstream');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('own-id-only');
        expect(meta.causedBy).toBeUndefined();
    });
    it('also includes actorId in _meta, additively, alongside correlationId', () => {
        const logger = (0, logging_1.createLogger)({ name: 'corr-test-5', type: 'json' });
        const ctx = (0, execution_context_1.createExecutionContext)({
            correlationId: 'own-id-2',
            actor: { requestId: 'req-1', timestamp: new Date().toISOString(), actorId: 'user-123' },
        });
        const meta = captureLoggedMeta(() => {
            (0, execution_context_1.runWithExecutionContextSync)(ctx, () => {
                logger.info('hello with actor');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.correlationId).toBe('own-id-2');
        expect(meta.actorId).toBe('user-123');
    });
    it('omits actorId when the context has no actor', () => {
        const logger = (0, logging_1.createLogger)({ name: 'corr-test-6', type: 'json' });
        const ctx = (0, execution_context_1.createExecutionContext)({ correlationId: 'own-id-3' });
        const meta = captureLoggedMeta(() => {
            (0, execution_context_1.runWithExecutionContextSync)(ctx, () => {
                logger.info('hello with no actor');
            });
        });
        expect(meta).toBeDefined();
        expect(meta.actorId).toBeUndefined();
    });
    it('stamps the unverified clientSuppliedActorId instead of actorId when both are present', () => {
        const logger = (0, logging_1.createLogger)({ name: 'corr-test-7', type: 'json' });
        const ctx = (0, execution_context_1.createExecutionContext)({
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
            (0, execution_context_1.runWithExecutionContextSync)(ctx, () => {
                logger.info('hello with client-supplied actor');
            });
        });
        expect(meta).toBeDefined();
        // The claimed identity is more useful for triage than the shared IAM role ARN — but this is
        // observability only; base-service.ts's audit stamping never sees clientSuppliedActorId.
        expect(meta.actorId).toBe('real-end-user-id');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29ycmVsYXRpb24tcHJvcGFnYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvY29ycmVsYXRpb24tcHJvcGFnYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJEQVU2QjtBQUM3QiwyQ0FBNkM7QUFFN0MsUUFBUSxDQUFDLGlCQUFpQixFQUFFLEdBQUcsRUFBRTtJQUM3QixFQUFFLENBQUMsaURBQWlELEVBQUUsR0FBRyxFQUFFO1FBQ3ZELE1BQU0sQ0FBQyxJQUFBLG1DQUFlLEVBQUMsc0NBQXNDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO1FBQzdHLE1BQU0sQ0FBQyxJQUFBLG1DQUFlLEVBQUMsa0NBQWtDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO1FBQ3JHLE1BQU0sQ0FBQyxJQUFBLG1DQUFlLEVBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQzNFLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLDZEQUE2RCxFQUFFLEdBQUcsRUFBRTtRQUNuRSxNQUFNLENBQUMsSUFBQSxtQ0FBZSxFQUFDLHdCQUF3QixDQUFDLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNsRSxNQUFNLENBQUMsSUFBQSxtQ0FBZSxFQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDcEQsTUFBTSxDQUFDLElBQUEsbUNBQWUsRUFBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ3hELENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLGdFQUFnRSxFQUFFLEdBQUcsRUFBRTtRQUN0RSxNQUFNLENBQUMsSUFBQSxtQ0FBZSxFQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7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QixDQUFDLEdBQUcsRUFBRTtZQUNoQyxJQUFBLCtDQUEyQixFQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUU7Z0JBQ2xDLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0NBQWtDLENBQUMsQ0FBQztZQUNwRCxDQUFDLENBQUMsQ0FBQztRQUNQLENBQUMsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQzNCLDRGQUE0RjtRQUM1Rix5RkFBeUY7UUFDekYsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQztJQUNsRCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgICBzYW5pdGl6ZVRyYWNlSWQsXG4gICAgZXh0cmFjdEZyb21IZWFkZXJzLFxuICAgIGV4dHJhY3RGcm9tU3FzLFxuICAgIGV4dHJhY3RGcm9tRXZlbnRCcmlkZ2UsXG4gICAgZXh0cmFjdEZyb21TdGVwRnVuY3Rpb25zLFxuICAgIGV4dHJhY3RGcm9tS2luZXNpcyxcbiAgICBjcmVhdGVIdHRwSGVhZGVycyxcbiAgICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICAgIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyxcbn0gZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuZGVzY3JpYmUoJ3Nhbml0aXplVHJhY2VJZCcsICgpID0+IHtcbiAgICBpdCgnYWNjZXB0cyBVVUlEcywgVzNDIGhleCBpZHMsIGFuZCBBV1MgcmVxdWVzdCBpZHMnLCAoKSA9PiB7XG4gICAgICAgIGV4cGVjdChzYW5pdGl6ZVRyYWNlSWQoJzNmMmIxYzRkLTVlNmYtNGE3Yi04YzlkLTBlMWYyYTNiNGM1ZCcpKS50b0JlKCczZjJiMWM0ZC01ZTZmLTRhN2ItOGM5ZC0wZTFmMmEzYjRjNWQnKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnMGFmNzY1MTkxNmNkNDNkZDg0NDhlYjIxMWM4MDMxOWMnKSkudG9CZSgnMGFmNzY1MTkxNmNkNDNkZDg0NDhlYjIxMWM4MDMxOWMnKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnICBhYmMuMTIzX0RFRi00NTYgICcpKS50b0JlKCdhYmMuMTIzX0RFRi00NTYnKTtcbiAgICB9KTtcblxuICAgIGl0KCdyZWplY3RzIENSL0xGIChvdXRib3VuZC1oZWFkZXItc3BsaXR0aW5nKSBhbmQgY29udHJvbCBjaGFycycsICgpID0+IHtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnYWJjXFxyXFxuU2V0LUNvb2tpZTogeD15JykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnYWJjXFxuZGVmJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnYWJjXFx0ZGVmJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdyZWplY3RzIHNwYWNlcywgZGlzYWxsb3dlZCBwdW5jdHVhdGlvbiwgYW5kIG92ZXItbGVuZ3RoIHZhbHVlcycsICgpID0+IHtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnaGFzIHNwYWNlJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnc2VtaTtjb2xvbicpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIGV4cGVjdChzYW5pdGl6ZVRyYWNlSWQoJ2EnLnJlcGVhdCgxMjkpKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3Qoc2FuaXRpemVUcmFjZUlkKCdhJy5yZXBlYXQoMTI4KSkpLnRvQmUoJ2EnLnJlcGVhdCgxMjgpKTtcbiAgICB9KTtcblxuICAgIGl0KCd0cmVhdHMgYmxhbmsgLyBub24tc3RyaW5nIGFzIGFic2VudCcsICgpID0+IHtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnICAgJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCh1bmRlZmluZWQpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIGV4cGVjdChzYW5pdGl6ZVRyYWNlSWQobnVsbCkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIC8vIFJlZ3Jlc3Npb246IGEgcHJvZHVjZXIgc29tZXdoZXJlIHVwc3RyZWFtIGNhbiBzdHJpbmdpZnkgYW4gdW5zZXQgdmFsdWUgdmlhIGFcbiAgICAvLyB0ZW1wbGF0ZSBsaXRlcmFsIChgJHt4LmNvcnJlbGF0aW9uSWR9YCkgb3IgYFN0cmluZyh4KWAsIHlpZWxkaW5nIHRoZSBsaXRlcmFsXG4gICAgLy8gdGV4dCBcInVuZGVmaW5lZFwiIChvciBcIm51bGxcIi9cIk5hTlwiKS4gVGhhdCB0ZXh0IGlzIGFscGhhbnVtZXJpYywgc28gaXQgcGFzc2VkIHRoZVxuICAgIC8vIGNoYXJzZXQgcmVnZXggYW5kIHByb3BhZ2F0ZWQgYXMgaWYgaXQgd2VyZSBhIHJlYWwgaWQg4oCUIHRoaXMgaXMgd2hhdCBzaG93ZWQgdXAgYXNcbiAgICAvLyBhIGJvZ3VzIDktY2hhcmFjdGVyIFwidW5kZWZpbmVkXCIgdHJhY2UgaW4gTG9ndHJhaWwncyBSZWNlbnQgVHJhY2VzIGxpc3QuIFJlamVjdCBpdFxuICAgIC8vIGFzIGEgZGVmZW5zZS1pbi1kZXB0aCBiYWNrc3RvcCwgY2FzZS1pbnNlbnNpdGl2ZWx5LCB3aGF0ZXZlciB0aGUgcmVhbCBmaXggYXQgdGhlXG4gICAgLy8gcHJvZHVjZXIgdHVybnMgb3V0IHRvIGJlLlxuICAgIGl0KCdyZWplY3RzIHRoZSBsaXRlcmFsIGVtcHR5LXZhbHVlIHRva2VucyBcInVuZGVmaW5lZFwiL1wibnVsbFwiL1wibmFuXCIgKGFueSBjYXNlKScsICgpID0+IHtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgndW5kZWZpbmVkJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnVW5kZWZpbmVkJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnVU5ERUZJTkVEJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KHNhbml0aXplVHJhY2VJZCgnbnVsbCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIGV4cGVjdChzYW5pdGl6ZVRyYWNlSWQoJ05VTEwnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3Qoc2FuaXRpemVUcmFjZUlkKCduYW4nKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3Qoc2FuaXRpemVUcmFjZUlkKCdOYU4nKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3Qoc2FuaXRpemVUcmFjZUlkKCcgIHVuZGVmaW5lZCAgJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdkb2VzIG5vdCByZWplY3QgaWRzIHRoYXQgbWVyZWx5IGNvbnRhaW4gdGhlc2UgdG9rZW5zIGFzIGEgc3Vic3RyaW5nJywgKCkgPT4ge1xuICAgICAgICBleHBlY3Qoc2FuaXRpemVUcmFjZUlkKCd1bmRlZmluZWQtMTIzNCcpKS50b0JlKCd1bmRlZmluZWQtMTIzNCcpO1xuICAgICAgICBleHBlY3Qoc2FuaXRpemVUcmFjZUlkKCdyZXFfbnVsbF90ZXJtaW5hdGVkJykpLnRvQmUoJ3JlcV9udWxsX3Rlcm1pbmF0ZWQnKTtcbiAgICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnZXh0cmFjdEZyb21IZWFkZXJzOiBpbmJvdW5kIHNhbml0aXphdGlvbiAoUDApJywgKCkgPT4ge1xuICAgIGl0KCdyZXVzZXMgYSBjbGVhbiB4LWNvcnJlbGF0aW9uLWlkIGFuZCBjYXVzZWQtYnknLCAoKSA9PiB7XG4gICAgICAgIGV4cGVjdChleHRyYWN0RnJvbUhlYWRlcnMoeyAneC1jb3JyZWxhdGlvbi1pZCc6ICdjbGVhbi1pZC0xJywgJ3gtY2F1c2VkLWJ5JzogJ3VwLTEnIH0pKS50b0VxdWFsKHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjbGVhbi1pZC0xJyxcbiAgICAgICAgICAgIGNhdXNlZEJ5OiAndXAtMScsXG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ2Ryb3BzIGEgcG9pc29uZWQgeC1jb3JyZWxhdGlvbi1pZCAocmV0dXJucyB1bmRlZmluZWQgc28gYSBmcmVzaCBpZCBpcyBtaW50ZWQpJywgKCkgPT4ge1xuICAgICAgICBleHBlY3QoZXh0cmFjdEZyb21IZWFkZXJzKHsgJ3gtY29ycmVsYXRpb24taWQnOiAnZXZpbFxcclxcblgtSW5qZWN0ZWQ6IDEnIH0pKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnZHJvcHMgb25seSBhIHBvaXNvbmVkIGNhdXNlZC1ieSwga2VlcGluZyBhIGNsZWFuIGNvcnJlbGF0aW9uSWQnLCAoKSA9PiB7XG4gICAgICAgIGV4cGVjdChleHRyYWN0RnJvbUhlYWRlcnMoeyAneC1jb3JyZWxhdGlvbi1pZCc6ICdnb29kJywgJ3gtY2F1c2VkLWJ5JzogJ2JhZFxcclxcbmJvb20nIH0pKS50b0VxdWFsKHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdnb29kJyxcbiAgICAgICAgICAgIGNhdXNlZEJ5OiB1bmRlZmluZWQsXG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ2Ryb3BzIGEgbGl0ZXJhbCBcInVuZGVmaW5lZFwiIHgtY29ycmVsYXRpb24taWQgKGEgc3RyaW5naWZpZWQgdW5zZXQgdmFsdWUgdXBzdHJlYW0pJywgKCkgPT4ge1xuICAgICAgICBleHBlY3QoZXh0cmFjdEZyb21IZWFkZXJzKHsgJ3gtY29ycmVsYXRpb24taWQnOiAndW5kZWZpbmVkJyB9KSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdleHRyYWN0RnJvbVNxczogaW5ib3VuZCBzYW5pdGl6YXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ2Ryb3BzIGEgcG9pc29uZWQgY29ycmVsYXRpb25JZCBhdHRyaWJ1dGUnLCAoKSA9PiB7XG4gICAgICAgIGV4cGVjdChcbiAgICAgICAgICAgIGV4dHJhY3RGcm9tU3FzKHsgY29ycmVsYXRpb25JZDogeyBzdHJpbmdWYWx1ZTogJ2V2aWxcXHJcXG5pbmplY3RlZCcgfSB9KVxuICAgICAgICApLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdrZWVwcyBhIGNsZWFuIGNvcnJlbGF0aW9uSWQgYXR0cmlidXRlJywgKCkgPT4ge1xuICAgICAgICBleHBlY3QoXG4gICAgICAgICAgICBleHRyYWN0RnJvbVNxcyh7IGNvcnJlbGF0aW9uSWQ6IHsgc3RyaW5nVmFsdWU6ICdtc2ctMTIzJyB9IH0pXG4gICAgICAgICkudG9FcXVhbCh7IGNvcnJlbGF0aW9uSWQ6ICdtc2ctMTIzJywgY2F1c2VkQnk6IHVuZGVmaW5lZCwgc2FtcGxlZDogZmFsc2UgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnZHJvcHMgYSBsaXRlcmFsIFwidW5kZWZpbmVkXCIgY29ycmVsYXRpb25JZCBhdHRyaWJ1dGUgKGEgc3RyaW5naWZpZWQgdW5zZXQgdmFsdWUgdXBzdHJlYW0pJywgKCkgPT4ge1xuICAgICAgICBleHBlY3QoXG4gICAgICAgICAgICBleHRyYWN0RnJvbVNxcyh7IGNvcnJlbGF0aW9uSWQ6IHsgc3RyaW5nVmFsdWU6ICd1bmRlZmluZWQnIH0gfSlcbiAgICAgICAgKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ2V4dHJhY3RGcm9tRXZlbnRCcmlkZ2UgLyBleHRyYWN0RnJvbVN0ZXBGdW5jdGlvbnMgLyBleHRyYWN0RnJvbUtpbmVzaXM6IGxpdGVyYWwtdG9rZW4gcmVqZWN0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdFdmVudEJyaWRnZTogZHJvcHMgYSBsaXRlcmFsIFwidW5kZWZpbmVkXCIgY29ycmVsYXRpb25JZCBpbiBkZXRhaWwnLCAoKSA9PiB7XG4gICAgICAgIGV4cGVjdChleHRyYWN0RnJvbUV2ZW50QnJpZGdlKHsgZGV0YWlsOiB7IGNvcnJlbGF0aW9uSWQ6ICd1bmRlZmluZWQnIH0gfSkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdFdmVudEJyaWRnZTogZHJvcHMgYSBsaXRlcmFsIFwidW5kZWZpbmVkXCIgbmVzdGVkIHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkJywgKCkgPT4ge1xuICAgICAgICBleHBlY3QoZXh0cmFjdEZyb21FdmVudEJyaWRnZSh7IGRldGFpbDogeyB0cmFjZUNvbnRleHQ6IHsgY29ycmVsYXRpb25JZDogJ3VuZGVmaW5lZCcgfSB9IH0pKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnU3RlcEZ1bmN0aW9uczogZHJvcHMgYSBsaXRlcmFsIFwibnVsbFwiIGNvcnJlbGF0aW9uSWQnLCAoKSA9PiB7XG4gICAgICAgIGV4cGVjdChleHRyYWN0RnJvbVN0ZXBGdW5jdGlvbnMoeyBjb3JyZWxhdGlvbklkOiAnbnVsbCcgfSkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdLaW5lc2lzOiBkcm9wcyBhIGxpdGVyYWwgXCJ1bmRlZmluZWRcIiBjb3JyZWxhdGlvbklkIGVtYmVkZGVkIGluIHRoZSByZWNvcmQgZGF0YScsICgpID0+IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHsgY29ycmVsYXRpb25JZDogJ3VuZGVmaW5lZCcgfTtcbiAgICAgICAgY29uc3QgZW5jb2RlZCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KGRhdGEpLCAndXRmLTgnKS50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgICAgIGV4cGVjdChleHRyYWN0RnJvbUtpbmVzaXMoeyBraW5lc2lzOiB7IGRhdGE6IGVuY29kZWQsIHBhcnRpdGlvbktleTogJ3VuZGVmaW5lZCcgfSB9KSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ0tpbmVzaXM6IGRyb3BzIGEgbGl0ZXJhbCBcInVuZGVmaW5lZFwiIHBhcnRpdGlvbktleSBmYWxsYmFjayB3aGVuIHRoZXJlIGlzIG5vIEpTT04gZGF0YSBtYXRjaCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgZW5jb2RlZCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHsgdW5yZWxhdGVkOiB0cnVlIH0pLCAndXRmLTgnKS50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgICAgIGV4cGVjdChleHRyYWN0RnJvbUtpbmVzaXMoeyBraW5lc2lzOiB7IGRhdGE6IGVuY29kZWQsIHBhcnRpdGlvbktleTogJ3VuZGVmaW5lZCcgfSB9KSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdjcmVhdGVIdHRwSGVhZGVyczogbm8geC10cmFjZS1pZCAoZm9sZGVkIG9udG8gY29ycmVsYXRpb25JZCknLCAoKSA9PiB7XG4gICAgaXQoJ2VtaXRzIHgtY29ycmVsYXRpb24taWQgKyB0cmFjZXBhcmVudCwgYW5kIE5PIHgtdHJhY2UtaWQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoeyBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnIH0pO1xuICAgICAgICBjb25zdCBoZWFkZXJzID0gY3JlYXRlSHR0cEhlYWRlcnMoY3R4KTtcbiAgICAgICAgZXhwZWN0KGhlYWRlcnNbJ3gtY29ycmVsYXRpb24taWQnXSkudG9CZSgnY29yci0xMjMnKTtcbiAgICAgICAgZXhwZWN0KGhlYWRlcnNbJ3RyYWNlcGFyZW50J10pLnRvTWF0Y2goL14wMC1bMC05YS1mXXszMn0tWzAtOWEtZl17MTZ9LSgwMHwwMSkkLyk7XG4gICAgICAgIGV4cGVjdChoZWFkZXJzWyd4LXRyYWNlLWlkJ10pLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnbG9nZ2VyIHN0YW1wcyBjb3JyZWxhdGlvbklkIG9udG8gX21ldGEgKGZvcndhcmRlciBwYXRoKScsICgpID0+IHtcbiAgICAvLyB0c2xvZyAodHlwZTonanNvbicpIGVtaXRzIG9uZSBKU09OIGxpbmUgcGVyIGxvZyB2aWEgY29uc29sZS5sb2cuXG4gICAgZnVuY3Rpb24gY2FwdHVyZUxvZ2dlZE1ldGEoZm46ICgpID0+IHZvaWQpOiBhbnkge1xuICAgICAgICBjb25zdCBzcHkgPSBqZXN0LnNweU9uKGNvbnNvbGUsICdsb2cnKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4geyB9KTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGZuKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNhbGwgb2Ygc3B5Lm1vY2suY2FsbHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lID0gY2FsbFswXTtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGxpbmUgIT09ICdzdHJpbmcnIHx8IGxpbmVbMF0gIT09ICd7JykgY29udGludWU7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgb2JqID0gSlNPTi5wYXJzZShsaW5lKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9iaiAmJiBvYmouX21ldGEpIHJldHVybiBvYmouX21ldGE7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7IC8qIG5vdCBvdXIgSlNPTiBsaW5lICovIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBzcHkubW9ja1Jlc3RvcmUoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGl0KCdpbmNsdWRlcyBjb3JyZWxhdGlvbklkIGluIF9tZXRhIHdpdGhpbiBhbiBFeGVjdXRpb25Db250ZXh0JywgKCkgPT4ge1xuICAgICAgICBjb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoeyBuYW1lOiAnY29yci10ZXN0JywgdHlwZTogJ2pzb24nIH0pO1xuICAgICAgICBjb25zdCBjdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHsgY29ycmVsYXRpb25JZDogJ2xvZy1jb3JyLWlkJyB9KTtcbiAgICAgICAgY29uc3QgbWV0YSA9IGNhcHR1cmVMb2dnZWRNZXRhKCgpID0+IHtcbiAgICAgICAgICAgIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyhjdHgsICgpID0+IHtcbiAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbygnaGVsbG8gd2l0aCBjb3JyZWxhdGlvbicpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QobWV0YSkudG9CZURlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KG1ldGEuY29ycmVsYXRpb25JZCkudG9CZSgnbG9nLWNvcnItaWQnKTtcbiAgICAgICAgZXhwZWN0KG1ldGEubG9nTGV2ZWxOYW1lKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ29taXRzIGNvcnJlbGF0aW9uSWQgd2hlbiBubyBFeGVjdXRpb25Db250ZXh0IChiYWNrd2FyZC1jb21wYXRpYmxlKScsICgpID0+IHtcbiAgICAgICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKHsgbmFtZTogJ2NvcnItdGVzdC0yJywgdHlwZTogJ2pzb24nIH0pO1xuICAgICAgICBjb25zdCBtZXRhID0gY2FwdHVyZUxvZ2dlZE1ldGEoKCkgPT4ge1xuICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ2hlbGxvIHdpdGhvdXQgY29udGV4dCcpO1xuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KG1ldGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAgIGV4cGVjdChtZXRhLmNvcnJlbGF0aW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdhbHNvIGluY2x1ZGVzIGNhdXNlZEJ5IGluIF9tZXRhLCBhZGRpdGl2ZWx5LCBhbG9uZ3NpZGUgY29ycmVsYXRpb25JZCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKHsgbmFtZTogJ2NvcnItdGVzdC0zJywgdHlwZTogJ2pzb24nIH0pO1xuICAgICAgICBjb25zdCBjdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHsgY29ycmVsYXRpb25JZDogJ293bi1pZCcsIGNhdXNlZEJ5OiAndXBzdHJlYW0taWQnIH0pO1xuICAgICAgICBjb25zdCBtZXRhID0gY2FwdHVyZUxvZ2dlZE1ldGEoKCkgPT4ge1xuICAgICAgICAgICAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jKGN0eCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKCdoZWxsbyB3aXRoIGNhdXNlZEJ5Jyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChtZXRhKS50b0JlRGVmaW5lZCgpO1xuICAgICAgICBleHBlY3QobWV0YS5jb3JyZWxhdGlvbklkKS50b0JlKCdvd24taWQnKTtcbiAgICAgICAgZXhwZWN0KG1ldGEuY2F1c2VkQnkpLnRvQmUoJ3Vwc3RyZWFtLWlkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnb21pdHMgY2F1c2VkQnkgd2hlbiB0aGUgY29udGV4dCBoYXMgbm9uZSAobm8gdXBzdHJlYW0gY2FsbGVyKScsICgpID0+IHtcbiAgICAgICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKHsgbmFtZTogJ2NvcnItdGVzdC00JywgdHlwZTogJ2pzb24nIH0pO1xuICAgICAgICBjb25zdCBjdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHsgY29ycmVsYXRpb25JZDogJ293bi1pZC1vbmx5JyB9KTtcbiAgICAgICAgY29uc3QgbWV0YSA9IGNhcHR1cmVMb2dnZWRNZXRhKCgpID0+IHtcbiAgICAgICAgICAgIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyhjdHgsICgpID0+IHtcbiAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbygnaGVsbG8gd2l0aCBubyB1cHN0cmVhbScpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QobWV0YSkudG9CZURlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KG1ldGEuY29ycmVsYXRpb25JZCkudG9CZSgnb3duLWlkLW9ubHknKTtcbiAgICAgICAgZXhwZWN0KG1ldGEuY2F1c2VkQnkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdhbHNvIGluY2x1ZGVzIGFjdG9ySWQgaW4gX21ldGEsIGFkZGl0aXZlbHksIGFsb25nc2lkZSBjb3JyZWxhdGlvbklkJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoeyBuYW1lOiAnY29yci10ZXN0LTUnLCB0eXBlOiAnanNvbicgfSk7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogJ293bi1pZC0yJyxcbiAgICAgICAgICAgIGFjdG9yOiB7IHJlcXVlc3RJZDogJ3JlcS0xJywgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksIGFjdG9ySWQ6ICd1c2VyLTEyMycgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IG1ldGEgPSBjYXB0dXJlTG9nZ2VkTWV0YSgoKSA9PiB7XG4gICAgICAgICAgICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMoY3R4LCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ2hlbGxvIHdpdGggYWN0b3InKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KG1ldGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAgIGV4cGVjdChtZXRhLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ293bi1pZC0yJyk7XG4gICAgICAgIGV4cGVjdChtZXRhLmFjdG9ySWQpLnRvQmUoJ3VzZXItMTIzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnb21pdHMgYWN0b3JJZCB3aGVuIHRoZSBjb250ZXh0IGhhcyBubyBhY3RvcicsICgpID0+IHtcbiAgICAgICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKHsgbmFtZTogJ2NvcnItdGVzdC02JywgdHlwZTogJ2pzb24nIH0pO1xuICAgICAgICBjb25zdCBjdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHsgY29ycmVsYXRpb25JZDogJ293bi1pZC0zJyB9KTtcbiAgICAgICAgY29uc3QgbWV0YSA9IGNhcHR1cmVMb2dnZWRNZXRhKCgpID0+IHtcbiAgICAgICAgICAgIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyhjdHgsICgpID0+IHtcbiAgICAgICAgICAgICAgICBsb2dnZXIuaW5mbygnaGVsbG8gd2l0aCBubyBhY3RvcicpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QobWV0YSkudG9CZURlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KG1ldGEuYWN0b3JJZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3N0YW1wcyB0aGUgdW52ZXJpZmllZCBjbGllbnRTdXBwbGllZEFjdG9ySWQgaW5zdGVhZCBvZiBhY3RvcklkIHdoZW4gYm90aCBhcmUgcHJlc2VudCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKHsgbmFtZTogJ2NvcnItdGVzdC03JywgdHlwZTogJ2pzb24nIH0pO1xuICAgICAgICBjb25zdCBjdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdvd24taWQtNCcsXG4gICAgICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgICAgIHJlcXVlc3RJZDogJ3JlcS0yJyxcbiAgICAgICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICBhY3RvcklkOiAnYXJuOmF3czppYW06OjEyMzQ1Njc4OTAxMjpyb2xlL2F1dGhlbnRpY2F0ZWQtcm9sZScsXG4gICAgICAgICAgICAgICAgY2xpZW50U3VwcGxpZWRBY3RvcklkOiAncmVhbC1lbmQtdXNlci1pZCcsXG4gICAgICAgICAgICAgICAgY2xpZW50U3VwcGxpZWRBY3RvcjogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBtZXRhID0gY2FwdHVyZUxvZ2dlZE1ldGEoKCkgPT4ge1xuICAgICAgICAgICAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jKGN0eCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGxvZ2dlci5pbmZvKCdoZWxsbyB3aXRoIGNsaWVudC1zdXBwbGllZCBhY3RvcicpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QobWV0YSkudG9CZURlZmluZWQoKTtcbiAgICAgICAgLy8gVGhlIGNsYWltZWQgaWRlbnRpdHkgaXMgbW9yZSB1c2VmdWwgZm9yIHRyaWFnZSB0aGFuIHRoZSBzaGFyZWQgSUFNIHJvbGUgQVJOIOKAlCBidXQgdGhpcyBpc1xuICAgICAgICAvLyBvYnNlcnZhYmlsaXR5IG9ubHk7IGJhc2Utc2VydmljZS50cydzIGF1ZGl0IHN0YW1waW5nIG5ldmVyIHNlZXMgY2xpZW50U3VwcGxpZWRBY3RvcklkLlxuICAgICAgICBleHBlY3QobWV0YS5hY3RvcklkKS50b0JlKCdyZWFsLWVuZC11c2VyLWlkJyk7XG4gICAgfSk7XG59KTtcbiJdfQ==