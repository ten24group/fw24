"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_zlib_1 = require("node:zlib");
const http = __importStar(require("node:http"));
/**
 * Runtime tests for the log-forwarder handler: they stand up a local HTTP server as a fake ingest,
 * invoke the handler with a synthetic CloudWatch Logs event, and assert on the records it ships —
 * proving the account/region tagging and the noise/severity reduction actually transform lines
 * (not just that env vars are injected).
 */
function makeCwEvent(messages) {
    const payload = {
        messageType: 'DATA_MESSAGE',
        logGroup: '/aws/lambda/plusfan-trials-foo',
        logStream: '2024/01/01/[$LATEST]abcdef',
        logEvents: messages.map((m, i) => ({ id: String(i), timestamp: 1_700_000_000_000, message: m })),
    };
    return { awslogs: { data: (0, node_zlib_1.gzipSync)(Buffer.from(JSON.stringify(payload))).toString('base64') } };
}
async function runHandler(messages, env, arn = 'arn:aws:lambda:us-east-1:123456789012:function:fwd') {
    const received = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            try {
                const json = (0, node_zlib_1.gunzipSync)(Buffer.concat(chunks)).toString('utf8');
                for (const r of JSON.parse(json))
                    received.push(r);
            }
            catch {
                /* ignore */
            }
            res.writeHead(200);
            res.end('ok');
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    jest.resetModules();
    const prev = { ...process.env };
    process.env.FORWARDER_INGEST_URL = `http://127.0.0.1:${port}/`;
    process.env.AWS_REGION = 'us-east-1';
    Object.assign(process.env, env);
    try {
        // Require AFTER env is set (the handler reads env at module load).
        const { handler } = require('./log-forwarder-handler');
        await handler(makeCwEvent(messages), { invokedFunctionArn: arn });
    }
    finally {
        process.env = prev;
        await new Promise((r) => server.close(() => r()));
    }
    return received;
}
describe('log-forwarder handler runtime', () => {
    it('tags every record with account (from ARN) and region', async () => {
        const recs = await runHandler(['hello world'], { FORWARDER_SERVICE: 'plusfan-trials', FORWARDER_ENV: 'local' });
        expect(recs).toHaveLength(1);
        expect(recs[0].account).toBe('123456789012');
        expect(recs[0].region).toBe('us-east-1');
        expect(recs[0].service).toBe('plusfan-trials-local');
    });
    it('distinguishes same-named deploys in different accounts by account', async () => {
        const a = await runHandler(['x'], { FORWARDER_SERVICE: 'plusfan-trials', FORWARDER_ENV: 'local' }, 'arn:aws:lambda:us-east-1:111111111111:function:fwd');
        const b = await runHandler(['x'], { FORWARDER_SERVICE: 'plusfan-trials', FORWARDER_ENV: 'local' }, 'arn:aws:lambda:us-east-1:222222222222:function:fwd');
        // Same service label, but the account field tells them apart.
        expect(a[0].service).toBe(b[0].service);
        expect(a[0].account).toBe('111111111111');
        expect(b[0].account).toBe('222222222222');
    });
    it('applies noise reduction: benign->warn, drop removed, noise->debug', async () => {
        const recs = await runHandler([
            '2024-01-01T00:00:00.000Z\treqid\tERROR\tECONNRESET while calling upstream', // benign error
            'GET /healthz probe', // drop
            'deprecation warning: old api', // downgrade
            'a normal info line', // untouched
        ], {
            FORWARDER_SERVICE: 'svc',
            FORWARDER_ENV: 'test',
            FORWARDER_NOISE_BENIGN: JSON.stringify(['\\bECONNRESET\\b']),
            FORWARDER_NOISE_DROP: JSON.stringify(['GET /(?:healthz)']),
            FORWARDER_NOISE_DOWNGRADE: JSON.stringify(['deprecation.?warning']),
        });
        // The drop line is gone → 3 shipped, not 4.
        expect(recs).toHaveLength(3);
        const benign = recs.find((r) => r.message.includes('ECONNRESET'));
        expect(benign.level).toBe('warn');
        expect(benign.reclassified).toBe('benign');
        const downgraded = recs.find((r) => r.message.includes('deprecation'));
        expect(downgraded.level).toBe('debug');
        expect(downgraded.reclassified).toBe('noise');
        expect(recs.some((r) => r.message.includes('healthz'))).toBe(false);
    });
    it('lifts app-declared fields (top-level and nested in tslog args) into record fields', async () => {
        // tslog JSON: positional "0" is the message, "1" is a structured arg object; correlationId is a
        // top-level key. Only the configured fields (correlationId, orderId) are lifted — not userId/secret.
        const line = JSON.stringify({
            '0': 'charge failed for order',
            '1': { orderId: '991', userId: 'u123', secret: 'nope' },
            correlationId: 'corr-abc-123',
            _meta: { name: 'PaymentsService', logLevelName: 'ERROR', date: '2024-01-01T00:00:00.000Z' },
        });
        const recs = await runHandler([line], {
            FORWARDER_SERVICE: 'plusfan-trials',
            FORWARDER_ENV: 'develop',
            FORWARDER_FIELDS: JSON.stringify(['correlationId', 'orderId']),
        });
        expect(recs).toHaveLength(1);
        const r = recs[0];
        expect(r.correlationId).toBe('corr-abc-123'); // top-level key
        expect(r.orderId).toBe('991'); // nested one level into the arg object
        expect(r.userId).toBeUndefined(); // logged but not configured → not lifted
        expect(r.secret).toBeUndefined();
        expect(r.message).toContain('charge failed for order'); // message still readable
        expect(r.level).toBe('error');
    });
    it('keeps lifted keys OUT of the message (no duplication), preserves non-lifted keys', async () => {
        const line = JSON.stringify({
            '0': 'Duplicate store order detected',
            '1': { remoteId: '1625', orderId: 'store_woo_o_1625' },
            _meta: { logLevelName: 'INFO' },
        });
        const recs = await runHandler([line], {
            FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test',
            FORWARDER_FIELDS: JSON.stringify(['orderId']),
        });
        expect(recs[0].orderId).toBe('store_woo_o_1625'); // lifted to a field
        expect(recs[0].message).toBe('Duplicate store order detected {"remoteId":"1625"}'); // orderId gone, remoteId kept
        expect(recs[0].message).not.toContain('orderId');
    });
    it('lifts nothing when FORWARDER_FIELDS is unset (opt-in)', async () => {
        const line = JSON.stringify({ '0': 'hi', correlationId: 'x', _meta: { logLevelName: 'INFO' } });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].correlationId).toBeUndefined();
    });
    it('never lets a lifted field overwrite a reserved record key', async () => {
        // An app that logs a field literally named "service" must not clobber the forwarder's service label.
        const line = JSON.stringify({ '0': 'hi', service: 'evil-override', orderId: '5', _meta: { logLevelName: 'INFO' } });
        const recs = await runHandler([line], {
            FORWARDER_SERVICE: 'plusfan-trials',
            FORWARDER_ENV: 'develop',
            FORWARDER_FIELDS: JSON.stringify(['service', 'orderId']),
        });
        expect(recs[0].service).toBe('plusfan-trials-develop'); // reserved key wins
        expect(recs[0].orderId).toBe('5'); // ordinary field still lifted
    });
    it('lifts source position from _srcloc into codeFile/codeLine and keeps it out of the message', async () => {
        const line = JSON.stringify({
            '0': 'charge failed for order',
            '1': { _srcloc: 'src/services/store-order.service.ts:337' },
            _meta: { logLevelName: 'ERROR' },
        });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs).toHaveLength(1);
        expect(recs[0].codeFile).toBe('src/services/store-order.service.ts');
        expect(recs[0].codeLine).toBe('337');
        expect(recs[0].message).toBe('charge failed for order'); // _srcloc must NOT be joined into the message
        expect(recs[0].message).not.toContain('_srcloc');
    });
    it('lifts source position from tslog native _meta.path (mode all)', async () => {
        const line = JSON.stringify({
            '0': 'boom',
            _meta: { logLevelName: 'ERROR', path: { filePathWithLine: '/var/task/src/lib/pay.ts:12', fileLine: '12' } },
        });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].codeFile).toBe('src/lib/pay.ts');
        expect(recs[0].codeLine).toBe('12');
    });
    it('lifts _meta.causedBy alongside _meta.correlationId, both as top-level fields', async () => {
        const line = JSON.stringify({
            '0': 'downstream call failed',
            _meta: { logLevelName: 'ERROR', correlationId: 'own-invocation-id', causedBy: 'upstream-caller-id' },
        });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].correlationId).toBe('own-invocation-id');
        expect(recs[0].causedBy).toBe('upstream-caller-id');
    });
    it('omits causedBy when absent from _meta (no upstream caller)', async () => {
        const line = JSON.stringify({
            '0': 'root-level call',
            _meta: { logLevelName: 'INFO', correlationId: 'own-id-only' },
        });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].correlationId).toBe('own-id-only');
        expect(recs[0].causedBy).toBeUndefined();
    });
    it('lifts _meta.actorId as a top-level field', async () => {
        const line = JSON.stringify({
            '0': 'user-triggered call',
            _meta: { logLevelName: 'ERROR', correlationId: 'own-id', actorId: 'user-123' },
        });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].actorId).toBe('user-123');
    });
    it('omits actorId when absent from _meta', async () => {
        const line = JSON.stringify({
            '0': 'system call',
            _meta: { logLevelName: 'INFO', correlationId: 'own-id-only-2' },
        });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].actorId).toBeUndefined();
    });
    it('drops logStream/logGroup by default (keeps host) to cut size', async () => {
        const recs = await runHandler(['hello'], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].logGroup).toBeUndefined();
        expect(recs[0].logStream).toBeUndefined();
        expect(recs[0].host).toBeDefined(); // host (derived) is kept
        expect(recs[0].message).toBe('hello');
    });
    it('respects FORWARDER_DROP_FIELDS (empty = drop nothing; core keys never dropped)', async () => {
        const keepAll = await runHandler(['hi'], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test', FORWARDER_DROP_FIELDS: '[]' });
        expect(keepAll[0].logGroup).toBeDefined();
        expect(keepAll[0].logStream).toBeDefined();
        const custom = await runHandler(['hi'], {
            FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test',
            FORWARDER_DROP_FIELDS: JSON.stringify(['logGroup', 'service', 'message']),
        });
        expect(custom[0].logGroup).toBeUndefined(); // dropped
        expect(custom[0].service).toBe('svc-test'); // core key never dropped
        expect(custom[0].message).toBe('hi'); // core key never dropped
    });
    it('stamps version on every record when FORWARDER_VERSION is set', async () => {
        const recs = await runHandler(['hello'], {
            FORWARDER_SERVICE: 'svc',
            FORWARDER_ENV: 'test',
            FORWARDER_VERSION: '1.2.3-beta.4',
        });
        expect(recs[0].version).toBe('1.2.3-beta.4');
    });
    it('strips tslog\'s "pretty" (non-JSON) date+level prefix so it does not duplicate the TIME/LVL columns', async () => {
        const line = '2026-07-19 22:27:59.178 INFO AnalyticsMetricsService [getOrdersForPeriod] Found 12 orders for teamId: glob';
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'plusfan-team-playbook', FORWARDER_ENV: 'backend' });
        expect(recs).toHaveLength(1);
        expect(recs[0].level).toBe('info');
        expect(recs[0].message).toBe('AnalyticsMetricsService [getOrdersForPeriod] Found 12 orders for teamId: glob');
        expect(recs[0].message).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
    it('respects an ERROR/WARN level in the pretty tslog prefix', async () => {
        const recs = await runHandler(['2026-07-19 22:28:04.552 ERROR SportsPersistenceService Persistence batch failed'], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].level).toBe('error');
        expect(recs[0].message).toBe('SportsPersistenceService Persistence batch failed');
    });
    it('leaves an ordinary line that merely starts with digits untouched (no false-positive strip)', async () => {
        const recs = await runHandler(['404 not found for /widgets/123'], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].message).toBe('404 not found for /widgets/123');
    });
    // Root cause (found via live Loki data): AWS Lambda's Node.js runtime has no request id yet
    // during the INIT phase (module load / DI container construction, before the first invocation),
    // so a line logged then still gets the usual `‹iso›\t‹requestId›\t‹LEVEL›\t‹message›` shape, but
    // with the still-unset id stringified to the literal text "undefined" by the runtime itself.
    // Confirmed in production: multiple Lambdas across a consuming service log at cold start
    // (before their first real invocation), every one carrying `undefined` as its requestId —
    // which Logtrail's Recent Traces then grouped into one bogus cross-service "trace" literally
    // named "undefined".
    it('treats a Lambda-prefix requestId of literal "undefined" as absent (AWS INIT-phase quirk)', async () => {
        const line = '2026-07-19T22:28:04.552Z\tundefined\tINFO\tService registry initialized';
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].requestId).toBeUndefined();
        expect(recs[0].message).toBe('Service registry initialized');
    });
    it('still lifts a real Lambda-prefix requestId normally', async () => {
        const line = '2026-07-19T22:28:04.552Z\treq-abc-123\tINFO\thello';
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].requestId).toBe('req-abc-123');
    });
    it.each(['undefined', 'Undefined', 'null', 'NaN'])('rejects a literal "%s" token from _meta.correlationId/causedBy/actorId the same way', async (token) => {
        const line = JSON.stringify({
            '0': 'poisoned meta',
            _meta: { logLevelName: 'INFO', correlationId: token, causedBy: token, actorId: token },
        });
        const recs = await runHandler([line], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
        expect(recs[0].correlationId).toBeUndefined();
        expect(recs[0].causedBy).toBeUndefined();
        expect(recs[0].actorId).toBeUndefined();
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2xvZy1mb3J3YXJkZXItaGFuZGxlci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEseUNBQWlEO0FBQ2pELGdEQUFrQztBQUdsQzs7Ozs7R0FLRztBQUNILFNBQVMsV0FBVyxDQUFDLFFBQWtCO0lBQ3RDLE1BQU0sT0FBTyxHQUFHO1FBQ2YsV0FBVyxFQUFFLGNBQWM7UUFDM0IsUUFBUSxFQUFFLGdDQUFnQztRQUMxQyxTQUFTLEVBQUUsNEJBQTRCO1FBQ3ZDLFNBQVMsRUFBRSxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFFLE9BQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0tBQ2hHLENBQUM7SUFDRixPQUFPLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUEsb0JBQVEsRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDakcsQ0FBQztBQUVELEtBQUssVUFBVSxVQUFVLENBQ3hCLFFBQWtCLEVBQ2xCLEdBQTJCLEVBQzNCLEdBQUcsR0FBRyxvREFBb0Q7SUFFMUQsTUFBTSxRQUFRLEdBQStCLEVBQUUsQ0FBQztJQUNoRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFO1FBQzdDLE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztR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Iiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZ3ppcFN5bmMsIGd1bnppcFN5bmMgfSBmcm9tICdub2RlOnpsaWInO1xuaW1wb3J0ICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnO1xuaW1wb3J0IHR5cGUgeyBBZGRyZXNzSW5mbyB9IGZyb20gJ25vZGU6bmV0JztcblxuLyoqXG4gKiBSdW50aW1lIHRlc3RzIGZvciB0aGUgbG9nLWZvcndhcmRlciBoYW5kbGVyOiB0aGV5IHN0YW5kIHVwIGEgbG9jYWwgSFRUUCBzZXJ2ZXIgYXMgYSBmYWtlIGluZ2VzdCxcbiAqIGludm9rZSB0aGUgaGFuZGxlciB3aXRoIGEgc3ludGhldGljIENsb3VkV2F0Y2ggTG9ncyBldmVudCwgYW5kIGFzc2VydCBvbiB0aGUgcmVjb3JkcyBpdCBzaGlwcyDigJRcbiAqIHByb3ZpbmcgdGhlIGFjY291bnQvcmVnaW9uIHRhZ2dpbmcgYW5kIHRoZSBub2lzZS9zZXZlcml0eSByZWR1Y3Rpb24gYWN0dWFsbHkgdHJhbnNmb3JtIGxpbmVzXG4gKiAobm90IGp1c3QgdGhhdCBlbnYgdmFycyBhcmUgaW5qZWN0ZWQpLlxuICovXG5mdW5jdGlvbiBtYWtlQ3dFdmVudChtZXNzYWdlczogc3RyaW5nW10pIHtcblx0Y29uc3QgcGF5bG9hZCA9IHtcblx0XHRtZXNzYWdlVHlwZTogJ0RBVEFfTUVTU0FHRScsXG5cdFx0bG9nR3JvdXA6ICcvYXdzL2xhbWJkYS9wbHVzZmFuLXRyaWFscy1mb28nLFxuXHRcdGxvZ1N0cmVhbTogJzIwMjQvMDEvMDEvWyRMQVRFU1RdYWJjZGVmJyxcblx0XHRsb2dFdmVudHM6IG1lc3NhZ2VzLm1hcCgobSwgaSkgPT4gKHsgaWQ6IFN0cmluZyhpKSwgdGltZXN0YW1wOiAxXzcwMF8wMDBfMDAwXzAwMCwgbWVzc2FnZTogbSB9KSksXG5cdH07XG5cdHJldHVybiB7IGF3c2xvZ3M6IHsgZGF0YTogZ3ppcFN5bmMoQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpKS50b1N0cmluZygnYmFzZTY0JykgfSB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBydW5IYW5kbGVyKFxuXHRtZXNzYWdlczogc3RyaW5nW10sXG5cdGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcblx0YXJuID0gJ2Fybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6ZnVuY3Rpb246ZndkJyxcbik6IFByb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgYW55Pj4+IHtcblx0Y29uc3QgcmVjZWl2ZWQ6IEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+ID0gW107XG5cdGNvbnN0IHNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKChyZXEsIHJlcykgPT4ge1xuXHRcdGNvbnN0IGNodW5rczogQnVmZmVyW10gPSBbXTtcblx0XHRyZXEub24oJ2RhdGEnLCAoYykgPT4gY2h1bmtzLnB1c2goYyBhcyBCdWZmZXIpKTtcblx0XHRyZXEub24oJ2VuZCcsICgpID0+IHtcblx0XHRcdHRyeSB7XG5cdFx0XHRcdGNvbnN0IGpzb24gPSBndW56aXBTeW5jKEJ1ZmZlci5jb25jYXQoY2h1bmtzKSkudG9TdHJpbmcoJ3V0ZjgnKTtcblx0XHRcdFx0Zm9yIChjb25zdCByIG9mIEpTT04ucGFyc2UoanNvbikpIHJlY2VpdmVkLnB1c2gocik7XG5cdFx0XHR9IGNhdGNoIHtcblx0XHRcdFx0LyogaWdub3JlICovXG5cdFx0XHR9XG5cdFx0XHRyZXMud3JpdGVIZWFkKDIwMCk7XG5cdFx0XHRyZXMuZW5kKCdvaycpO1xuXHRcdH0pO1xuXHR9KTtcblx0YXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHIpID0+IHNlcnZlci5saXN0ZW4oMCwgJzEyNy4wLjAuMScsIHIpKTtcblx0Y29uc3QgcG9ydCA9IChzZXJ2ZXIuYWRkcmVzcygpIGFzIEFkZHJlc3NJbmZvKS5wb3J0O1xuXG5cdGplc3QucmVzZXRNb2R1bGVzKCk7XG5cdGNvbnN0IHByZXYgPSB7IC4uLnByb2Nlc3MuZW52IH07XG5cdHByb2Nlc3MuZW52LkZPUldBUkRFUl9JTkdFU1RfVVJMID0gYGh0dHA6Ly8xMjcuMC4wLjE6JHtwb3J0fS9gO1xuXHRwcm9jZXNzLmVudi5BV1NfUkVHSU9OID0gJ3VzLWVhc3QtMSc7XG5cdE9iamVjdC5hc3NpZ24ocHJvY2Vzcy5lbnYsIGVudik7XG5cdHRyeSB7XG5cdFx0Ly8gUmVxdWlyZSBBRlRFUiBlbnYgaXMgc2V0ICh0aGUgaGFuZGxlciByZWFkcyBlbnYgYXQgbW9kdWxlIGxvYWQpLlxuXHRcdGNvbnN0IHsgaGFuZGxlciB9ID0gcmVxdWlyZSgnLi9sb2ctZm9yd2FyZGVyLWhhbmRsZXInKTtcblx0XHRhd2FpdCBoYW5kbGVyKG1ha2VDd0V2ZW50KG1lc3NhZ2VzKSwgeyBpbnZva2VkRnVuY3Rpb25Bcm46IGFybiB9KTtcblx0fSBmaW5hbGx5IHtcblx0XHRwcm9jZXNzLmVudiA9IHByZXY7XG5cdFx0YXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHIpID0+IHNlcnZlci5jbG9zZSgoKSA9PiByKCkpKTtcblx0fVxuXHRyZXR1cm4gcmVjZWl2ZWQ7XG59XG5cbmRlc2NyaWJlKCdsb2ctZm9yd2FyZGVyIGhhbmRsZXIgcnVudGltZScsICgpID0+IHtcblx0aXQoJ3RhZ3MgZXZlcnkgcmVjb3JkIHdpdGggYWNjb3VudCAoZnJvbSBBUk4pIGFuZCByZWdpb24nLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoWydoZWxsbyB3b3JsZCddLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAncGx1c2Zhbi10cmlhbHMnLCBGT1JXQVJERVJfRU5WOiAnbG9jYWwnIH0pO1xuXHRcdGV4cGVjdChyZWNzKS50b0hhdmVMZW5ndGgoMSk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0uYWNjb3VudCkudG9CZSgnMTIzNDU2Nzg5MDEyJyk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0ucmVnaW9uKS50b0JlKCd1cy1lYXN0LTEnKTtcblx0XHRleHBlY3QocmVjc1swXS5zZXJ2aWNlKS50b0JlKCdwbHVzZmFuLXRyaWFscy1sb2NhbCcpO1xuXHR9KTtcblxuXHRpdCgnZGlzdGluZ3Vpc2hlcyBzYW1lLW5hbWVkIGRlcGxveXMgaW4gZGlmZmVyZW50IGFjY291bnRzIGJ5IGFjY291bnQnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgYSA9IGF3YWl0IHJ1bkhhbmRsZXIoWyd4J10sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdwbHVzZmFuLXRyaWFscycsIEZPUldBUkRFUl9FTlY6ICdsb2NhbCcgfSxcblx0XHRcdCdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTExMTExMTExMTExOmZ1bmN0aW9uOmZ3ZCcpO1xuXHRcdGNvbnN0IGIgPSBhd2FpdCBydW5IYW5kbGVyKFsneCddLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAncGx1c2Zhbi10cmlhbHMnLCBGT1JXQVJERVJfRU5WOiAnbG9jYWwnIH0sXG5cdFx0XHQnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjIyMjIyMjIyMjIyMjpmdW5jdGlvbjpmd2QnKTtcblx0XHQvLyBTYW1lIHNlcnZpY2UgbGFiZWwsIGJ1dCB0aGUgYWNjb3VudCBmaWVsZCB0ZWxscyB0aGVtIGFwYXJ0LlxuXHRcdGV4cGVjdChhWzBdLnNlcnZpY2UpLnRvQmUoYlswXS5zZXJ2aWNlKTtcblx0XHRleHBlY3QoYVswXS5hY2NvdW50KS50b0JlKCcxMTExMTExMTExMTEnKTtcblx0XHRleHBlY3QoYlswXS5hY2NvdW50KS50b0JlKCcyMjIyMjIyMjIyMjInKTtcblx0fSk7XG5cblx0aXQoJ2FwcGxpZXMgbm9pc2UgcmVkdWN0aW9uOiBiZW5pZ24tPndhcm4sIGRyb3AgcmVtb3ZlZCwgbm9pc2UtPmRlYnVnJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IHJlY3MgPSBhd2FpdCBydW5IYW5kbGVyKFxuXHRcdFx0W1xuXHRcdFx0XHQnMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaXFx0cmVxaWRcXHRFUlJPUlxcdEVDT05OUkVTRVQgd2hpbGUgY2FsbGluZyB1cHN0cmVhbScsIC8vIGJlbmlnbiBlcnJvclxuXHRcdFx0XHQnR0VUIC9oZWFsdGh6IHByb2JlJywgICAgICAvLyBkcm9wXG5cdFx0XHRcdCdkZXByZWNhdGlvbiB3YXJuaW5nOiBvbGQgYXBpJywgLy8gZG93bmdyYWRlXG5cdFx0XHRcdCdhIG5vcm1hbCBpbmZvIGxpbmUnLCAgICAgIC8vIHVudG91Y2hlZFxuXHRcdFx0XSxcblx0XHRcdHtcblx0XHRcdFx0Rk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLFxuXHRcdFx0XHRGT1JXQVJERVJfRU5WOiAndGVzdCcsXG5cdFx0XHRcdEZPUldBUkRFUl9OT0lTRV9CRU5JR046IEpTT04uc3RyaW5naWZ5KFsnXFxcXGJFQ09OTlJFU0VUXFxcXGInXSksXG5cdFx0XHRcdEZPUldBUkRFUl9OT0lTRV9EUk9QOiBKU09OLnN0cmluZ2lmeShbJ0dFVCAvKD86aGVhbHRoeiknXSksXG5cdFx0XHRcdEZPUldBUkRFUl9OT0lTRV9ET1dOR1JBREU6IEpTT04uc3RyaW5naWZ5KFsnZGVwcmVjYXRpb24uP3dhcm5pbmcnXSksXG5cdFx0XHR9LFxuXHRcdCk7XG5cdFx0Ly8gVGhlIGRyb3AgbGluZSBpcyBnb25lIOKGkiAzIHNoaXBwZWQsIG5vdCA0LlxuXHRcdGV4cGVjdChyZWNzKS50b0hhdmVMZW5ndGgoMyk7XG5cdFx0Y29uc3QgYmVuaWduID0gcmVjcy5maW5kKChyKSA9PiByLm1lc3NhZ2UuaW5jbHVkZXMoJ0VDT05OUkVTRVQnKSkhO1xuXHRcdGV4cGVjdChiZW5pZ24ubGV2ZWwpLnRvQmUoJ3dhcm4nKTtcblx0XHRleHBlY3QoYmVuaWduLnJlY2xhc3NpZmllZCkudG9CZSgnYmVuaWduJyk7XG5cdFx0Y29uc3QgZG93bmdyYWRlZCA9IHJlY3MuZmluZCgocikgPT4gci5tZXNzYWdlLmluY2x1ZGVzKCdkZXByZWNhdGlvbicpKSE7XG5cdFx0ZXhwZWN0KGRvd25ncmFkZWQubGV2ZWwpLnRvQmUoJ2RlYnVnJyk7XG5cdFx0ZXhwZWN0KGRvd25ncmFkZWQucmVjbGFzc2lmaWVkKS50b0JlKCdub2lzZScpO1xuXHRcdGV4cGVjdChyZWNzLnNvbWUoKHIpID0+IHIubWVzc2FnZS5pbmNsdWRlcygnaGVhbHRoeicpKSkudG9CZShmYWxzZSk7XG5cdH0pO1xuXG5cdGl0KCdsaWZ0cyBhcHAtZGVjbGFyZWQgZmllbGRzICh0b3AtbGV2ZWwgYW5kIG5lc3RlZCBpbiB0c2xvZyBhcmdzKSBpbnRvIHJlY29yZCBmaWVsZHMnLCBhc3luYyAoKSA9PiB7XG5cdFx0Ly8gdHNsb2cgSlNPTjogcG9zaXRpb25hbCBcIjBcIiBpcyB0aGUgbWVzc2FnZSwgXCIxXCIgaXMgYSBzdHJ1Y3R1cmVkIGFyZyBvYmplY3Q7IGNvcnJlbGF0aW9uSWQgaXMgYVxuXHRcdC8vIHRvcC1sZXZlbCBrZXkuIE9ubHkgdGhlIGNvbmZpZ3VyZWQgZmllbGRzIChjb3JyZWxhdGlvbklkLCBvcmRlcklkKSBhcmUgbGlmdGVkIOKAlCBub3QgdXNlcklkL3NlY3JldC5cblx0XHRjb25zdCBsaW5lID0gSlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0JzAnOiAnY2hhcmdlIGZhaWxlZCBmb3Igb3JkZXInLFxuXHRcdFx0JzEnOiB7IG9yZGVySWQ6ICc5OTEnLCB1c2VySWQ6ICd1MTIzJywgc2VjcmV0OiAnbm9wZScgfSxcblx0XHRcdGNvcnJlbGF0aW9uSWQ6ICdjb3JyLWFiYy0xMjMnLFxuXHRcdFx0X21ldGE6IHsgbmFtZTogJ1BheW1lbnRzU2VydmljZScsIGxvZ0xldmVsTmFtZTogJ0VSUk9SJywgZGF0ZTogJzIwMjQtMDEtMDFUMDA6MDA6MDAuMDAwWicgfSxcblx0XHR9KTtcblx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbbGluZV0sIHtcblx0XHRcdEZPUldBUkRFUl9TRVJWSUNFOiAncGx1c2Zhbi10cmlhbHMnLFxuXHRcdFx0Rk9SV0FSREVSX0VOVjogJ2RldmVsb3AnLFxuXHRcdFx0Rk9SV0FSREVSX0ZJRUxEUzogSlNPTi5zdHJpbmdpZnkoWyAnY29ycmVsYXRpb25JZCcsICdvcmRlcklkJyBdKSxcblx0XHR9KTtcblx0XHRleHBlY3QocmVjcykudG9IYXZlTGVuZ3RoKDEpO1xuXHRcdGNvbnN0IHIgPSByZWNzWzBdO1xuXHRcdGV4cGVjdChyLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ2NvcnItYWJjLTEyMycpOyAvLyB0b3AtbGV2ZWwga2V5XG5cdFx0ZXhwZWN0KHIub3JkZXJJZCkudG9CZSgnOTkxJyk7IC8vIG5lc3RlZCBvbmUgbGV2ZWwgaW50byB0aGUgYXJnIG9iamVjdFxuXHRcdGV4cGVjdChyLnVzZXJJZCkudG9CZVVuZGVmaW5lZCgpOyAvLyBsb2dnZWQgYnV0IG5vdCBjb25maWd1cmVkIOKGkiBub3QgbGlmdGVkXG5cdFx0ZXhwZWN0KHIuc2VjcmV0KS50b0JlVW5kZWZpbmVkKCk7XG5cdFx0ZXhwZWN0KHIubWVzc2FnZSkudG9Db250YWluKCdjaGFyZ2UgZmFpbGVkIGZvciBvcmRlcicpOyAvLyBtZXNzYWdlIHN0aWxsIHJlYWRhYmxlXG5cdFx0ZXhwZWN0KHIubGV2ZWwpLnRvQmUoJ2Vycm9yJyk7XG5cdH0pO1xuXG5cdGl0KCdrZWVwcyBsaWZ0ZWQga2V5cyBPVVQgb2YgdGhlIG1lc3NhZ2UgKG5vIGR1cGxpY2F0aW9uKSwgcHJlc2VydmVzIG5vbi1saWZ0ZWQga2V5cycsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCBsaW5lID0gSlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0JzAnOiAnRHVwbGljYXRlIHN0b3JlIG9yZGVyIGRldGVjdGVkJyxcblx0XHRcdCcxJzogeyByZW1vdGVJZDogJzE2MjUnLCBvcmRlcklkOiAnc3RvcmVfd29vX29fMTYyNScgfSxcblx0XHRcdF9tZXRhOiB7IGxvZ0xldmVsTmFtZTogJ0lORk8nIH0sXG5cdFx0fSk7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoW2xpbmVdLCB7XG5cdFx0XHRGT1JXQVJERVJfU0VSVklDRTogJ3N2YycsIEZPUldBUkRFUl9FTlY6ICd0ZXN0Jyxcblx0XHRcdEZPUldBUkRFUl9GSUVMRFM6IEpTT04uc3RyaW5naWZ5KFsgJ29yZGVySWQnIF0pLFxuXHRcdH0pO1xuXHRcdGV4cGVjdChyZWNzWzBdLm9yZGVySWQpLnRvQmUoJ3N0b3JlX3dvb19vXzE2MjUnKTsgLy8gbGlmdGVkIHRvIGEgZmllbGRcblx0XHRleHBlY3QocmVjc1swXS5tZXNzYWdlKS50b0JlKCdEdXBsaWNhdGUgc3RvcmUgb3JkZXIgZGV0ZWN0ZWQge1wicmVtb3RlSWRcIjpcIjE2MjVcIn0nKTsgLy8gb3JkZXJJZCBnb25lLCByZW1vdGVJZCBrZXB0XG5cdFx0ZXhwZWN0KHJlY3NbMF0ubWVzc2FnZSkubm90LnRvQ29udGFpbignb3JkZXJJZCcpO1xuXHR9KTtcblxuXHRpdCgnbGlmdHMgbm90aGluZyB3aGVuIEZPUldBUkRFUl9GSUVMRFMgaXMgdW5zZXQgKG9wdC1pbiknLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgbGluZSA9IEpTT04uc3RyaW5naWZ5KHsgJzAnOiAnaGknLCBjb3JyZWxhdGlvbklkOiAneCcsIF9tZXRhOiB7IGxvZ0xldmVsTmFtZTogJ0lORk8nIH0gfSk7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoW2xpbmVdLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAnc3ZjJywgRk9SV0FSREVSX0VOVjogJ3Rlc3QnIH0pO1xuXHRcdGV4cGVjdChyZWNzWzBdLmNvcnJlbGF0aW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcblx0fSk7XG5cblx0aXQoJ25ldmVyIGxldHMgYSBsaWZ0ZWQgZmllbGQgb3ZlcndyaXRlIGEgcmVzZXJ2ZWQgcmVjb3JkIGtleScsIGFzeW5jICgpID0+IHtcblx0XHQvLyBBbiBhcHAgdGhhdCBsb2dzIGEgZmllbGQgbGl0ZXJhbGx5IG5hbWVkIFwic2VydmljZVwiIG11c3Qgbm90IGNsb2JiZXIgdGhlIGZvcndhcmRlcidzIHNlcnZpY2UgbGFiZWwuXG5cdFx0Y29uc3QgbGluZSA9IEpTT04uc3RyaW5naWZ5KHsgJzAnOiAnaGknLCBzZXJ2aWNlOiAnZXZpbC1vdmVycmlkZScsIG9yZGVySWQ6ICc1JywgX21ldGE6IHsgbG9nTGV2ZWxOYW1lOiAnSU5GTycgfSB9KTtcblx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbbGluZV0sIHtcblx0XHRcdEZPUldBUkRFUl9TRVJWSUNFOiAncGx1c2Zhbi10cmlhbHMnLFxuXHRcdFx0Rk9SV0FSREVSX0VOVjogJ2RldmVsb3AnLFxuXHRcdFx0Rk9SV0FSREVSX0ZJRUxEUzogSlNPTi5zdHJpbmdpZnkoWyAnc2VydmljZScsICdvcmRlcklkJyBdKSxcblx0XHR9KTtcblx0XHRleHBlY3QocmVjc1swXS5zZXJ2aWNlKS50b0JlKCdwbHVzZmFuLXRyaWFscy1kZXZlbG9wJyk7IC8vIHJlc2VydmVkIGtleSB3aW5zXG5cdFx0ZXhwZWN0KHJlY3NbMF0ub3JkZXJJZCkudG9CZSgnNScpOyAvLyBvcmRpbmFyeSBmaWVsZCBzdGlsbCBsaWZ0ZWRcblx0fSk7XG5cblx0aXQoJ2xpZnRzIHNvdXJjZSBwb3NpdGlvbiBmcm9tIF9zcmNsb2MgaW50byBjb2RlRmlsZS9jb2RlTGluZSBhbmQga2VlcHMgaXQgb3V0IG9mIHRoZSBtZXNzYWdlJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IGxpbmUgPSBKU09OLnN0cmluZ2lmeSh7XG5cdFx0XHQnMCc6ICdjaGFyZ2UgZmFpbGVkIGZvciBvcmRlcicsXG5cdFx0XHQnMSc6IHsgX3NyY2xvYzogJ3NyYy9zZXJ2aWNlcy9zdG9yZS1vcmRlci5zZXJ2aWNlLnRzOjMzNycgfSxcblx0XHRcdF9tZXRhOiB7IGxvZ0xldmVsTmFtZTogJ0VSUk9SJyB9LFxuXHRcdH0pO1xuXHRcdGNvbnN0IHJlY3MgPSBhd2FpdCBydW5IYW5kbGVyKFtsaW5lXSwgeyBGT1JXQVJERVJfU0VSVklDRTogJ3N2YycsIEZPUldBUkRFUl9FTlY6ICd0ZXN0JyB9KTtcblx0XHRleHBlY3QocmVjcykudG9IYXZlTGVuZ3RoKDEpO1xuXHRcdGV4cGVjdChyZWNzWzBdLmNvZGVGaWxlKS50b0JlKCdzcmMvc2VydmljZXMvc3RvcmUtb3JkZXIuc2VydmljZS50cycpO1xuXHRcdGV4cGVjdChyZWNzWzBdLmNvZGVMaW5lKS50b0JlKCczMzcnKTtcblx0XHRleHBlY3QocmVjc1swXS5tZXNzYWdlKS50b0JlKCdjaGFyZ2UgZmFpbGVkIGZvciBvcmRlcicpOyAvLyBfc3JjbG9jIG11c3QgTk9UIGJlIGpvaW5lZCBpbnRvIHRoZSBtZXNzYWdlXG5cdFx0ZXhwZWN0KHJlY3NbMF0ubWVzc2FnZSkubm90LnRvQ29udGFpbignX3NyY2xvYycpO1xuXHR9KTtcblxuXHRpdCgnbGlmdHMgc291cmNlIHBvc2l0aW9uIGZyb20gdHNsb2cgbmF0aXZlIF9tZXRhLnBhdGggKG1vZGUgYWxsKScsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCBsaW5lID0gSlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0JzAnOiAnYm9vbScsXG5cdFx0XHRfbWV0YTogeyBsb2dMZXZlbE5hbWU6ICdFUlJPUicsIHBhdGg6IHsgZmlsZVBhdGhXaXRoTGluZTogJy92YXIvdGFzay9zcmMvbGliL3BheS50czoxMicsIGZpbGVMaW5lOiAnMTInIH0gfSxcblx0XHR9KTtcblx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbbGluZV0sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLCBGT1JXQVJERVJfRU5WOiAndGVzdCcgfSk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0uY29kZUZpbGUpLnRvQmUoJ3NyYy9saWIvcGF5LnRzJyk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0uY29kZUxpbmUpLnRvQmUoJzEyJyk7XG5cdH0pO1xuXG5cdGl0KCdsaWZ0cyBfbWV0YS5jYXVzZWRCeSBhbG9uZ3NpZGUgX21ldGEuY29ycmVsYXRpb25JZCwgYm90aCBhcyB0b3AtbGV2ZWwgZmllbGRzJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IGxpbmUgPSBKU09OLnN0cmluZ2lmeSh7XG5cdFx0XHQnMCc6ICdkb3duc3RyZWFtIGNhbGwgZmFpbGVkJyxcblx0XHRcdF9tZXRhOiB7IGxvZ0xldmVsTmFtZTogJ0VSUk9SJywgY29ycmVsYXRpb25JZDogJ293bi1pbnZvY2F0aW9uLWlkJywgY2F1c2VkQnk6ICd1cHN0cmVhbS1jYWxsZXItaWQnIH0sXG5cdFx0fSk7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoW2xpbmVdLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAnc3ZjJywgRk9SV0FSREVSX0VOVjogJ3Rlc3QnIH0pO1xuXHRcdGV4cGVjdChyZWNzWzBdLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ293bi1pbnZvY2F0aW9uLWlkJyk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0uY2F1c2VkQnkpLnRvQmUoJ3Vwc3RyZWFtLWNhbGxlci1pZCcpO1xuXHR9KTtcblxuXHRpdCgnb21pdHMgY2F1c2VkQnkgd2hlbiBhYnNlbnQgZnJvbSBfbWV0YSAobm8gdXBzdHJlYW0gY2FsbGVyKScsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCBsaW5lID0gSlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0JzAnOiAncm9vdC1sZXZlbCBjYWxsJyxcblx0XHRcdF9tZXRhOiB7IGxvZ0xldmVsTmFtZTogJ0lORk8nLCBjb3JyZWxhdGlvbklkOiAnb3duLWlkLW9ubHknIH0sXG5cdFx0fSk7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoW2xpbmVdLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAnc3ZjJywgRk9SV0FSREVSX0VOVjogJ3Rlc3QnIH0pO1xuXHRcdGV4cGVjdChyZWNzWzBdLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ293bi1pZC1vbmx5Jyk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0uY2F1c2VkQnkpLnRvQmVVbmRlZmluZWQoKTtcblx0fSk7XG5cblx0aXQoJ2xpZnRzIF9tZXRhLmFjdG9ySWQgYXMgYSB0b3AtbGV2ZWwgZmllbGQnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgbGluZSA9IEpTT04uc3RyaW5naWZ5KHtcblx0XHRcdCcwJzogJ3VzZXItdHJpZ2dlcmVkIGNhbGwnLFxuXHRcdFx0X21ldGE6IHsgbG9nTGV2ZWxOYW1lOiAnRVJST1InLCBjb3JyZWxhdGlvbklkOiAnb3duLWlkJywgYWN0b3JJZDogJ3VzZXItMTIzJyB9LFxuXHRcdH0pO1xuXHRcdGNvbnN0IHJlY3MgPSBhd2FpdCBydW5IYW5kbGVyKFtsaW5lXSwgeyBGT1JXQVJERVJfU0VSVklDRTogJ3N2YycsIEZPUldBUkRFUl9FTlY6ICd0ZXN0JyB9KTtcblx0XHRleHBlY3QocmVjc1swXS5hY3RvcklkKS50b0JlKCd1c2VyLTEyMycpO1xuXHR9KTtcblxuXHRpdCgnb21pdHMgYWN0b3JJZCB3aGVuIGFic2VudCBmcm9tIF9tZXRhJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IGxpbmUgPSBKU09OLnN0cmluZ2lmeSh7XG5cdFx0XHQnMCc6ICdzeXN0ZW0gY2FsbCcsXG5cdFx0XHRfbWV0YTogeyBsb2dMZXZlbE5hbWU6ICdJTkZPJywgY29ycmVsYXRpb25JZDogJ293bi1pZC1vbmx5LTInIH0sXG5cdFx0fSk7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoW2xpbmVdLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAnc3ZjJywgRk9SV0FSREVSX0VOVjogJ3Rlc3QnIH0pO1xuXHRcdGV4cGVjdChyZWNzWzBdLmFjdG9ySWQpLnRvQmVVbmRlZmluZWQoKTtcblx0fSk7XG5cblx0aXQoJ2Ryb3BzIGxvZ1N0cmVhbS9sb2dHcm91cCBieSBkZWZhdWx0IChrZWVwcyBob3N0KSB0byBjdXQgc2l6ZScsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbJ2hlbGxvJ10sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLCBGT1JXQVJERVJfRU5WOiAndGVzdCcgfSk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0ubG9nR3JvdXApLnRvQmVVbmRlZmluZWQoKTtcblx0XHRleHBlY3QocmVjc1swXS5sb2dTdHJlYW0pLnRvQmVVbmRlZmluZWQoKTtcblx0XHRleHBlY3QocmVjc1swXS5ob3N0KS50b0JlRGVmaW5lZCgpOyAvLyBob3N0IChkZXJpdmVkKSBpcyBrZXB0XG5cdFx0ZXhwZWN0KHJlY3NbMF0ubWVzc2FnZSkudG9CZSgnaGVsbG8nKTtcblx0fSk7XG5cblx0aXQoJ3Jlc3BlY3RzIEZPUldBUkRFUl9EUk9QX0ZJRUxEUyAoZW1wdHkgPSBkcm9wIG5vdGhpbmc7IGNvcmUga2V5cyBuZXZlciBkcm9wcGVkKScsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCBrZWVwQWxsID0gYXdhaXQgcnVuSGFuZGxlcihbJ2hpJ10sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLCBGT1JXQVJERVJfRU5WOiAndGVzdCcsIEZPUldBUkRFUl9EUk9QX0ZJRUxEUzogJ1tdJyB9KTtcblx0XHRleHBlY3Qoa2VlcEFsbFswXS5sb2dHcm91cCkudG9CZURlZmluZWQoKTtcblx0XHRleHBlY3Qoa2VlcEFsbFswXS5sb2dTdHJlYW0pLnRvQmVEZWZpbmVkKCk7XG5cblx0XHRjb25zdCBjdXN0b20gPSBhd2FpdCBydW5IYW5kbGVyKFsnaGknXSwge1xuXHRcdFx0Rk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLCBGT1JXQVJERVJfRU5WOiAndGVzdCcsXG5cdFx0XHRGT1JXQVJERVJfRFJPUF9GSUVMRFM6IEpTT04uc3RyaW5naWZ5KFsnbG9nR3JvdXAnLCAnc2VydmljZScsICdtZXNzYWdlJ10pLFxuXHRcdH0pO1xuXHRcdGV4cGVjdChjdXN0b21bMF0ubG9nR3JvdXApLnRvQmVVbmRlZmluZWQoKTsgLy8gZHJvcHBlZFxuXHRcdGV4cGVjdChjdXN0b21bMF0uc2VydmljZSkudG9CZSgnc3ZjLXRlc3QnKTsgLy8gY29yZSBrZXkgbmV2ZXIgZHJvcHBlZFxuXHRcdGV4cGVjdChjdXN0b21bMF0ubWVzc2FnZSkudG9CZSgnaGknKTsgLy8gY29yZSBrZXkgbmV2ZXIgZHJvcHBlZFxuXHR9KTtcblxuXHRpdCgnc3RhbXBzIHZlcnNpb24gb24gZXZlcnkgcmVjb3JkIHdoZW4gRk9SV0FSREVSX1ZFUlNJT04gaXMgc2V0JywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IHJlY3MgPSBhd2FpdCBydW5IYW5kbGVyKFsnaGVsbG8nXSwge1xuXHRcdFx0Rk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLFxuXHRcdFx0Rk9SV0FSREVSX0VOVjogJ3Rlc3QnLFxuXHRcdFx0Rk9SV0FSREVSX1ZFUlNJT046ICcxLjIuMy1iZXRhLjQnLFxuXHRcdH0pO1xuXHRcdGV4cGVjdChyZWNzWzBdLnZlcnNpb24pLnRvQmUoJzEuMi4zLWJldGEuNCcpO1xuXHR9KTtcblxuXHRpdCgnc3RyaXBzIHRzbG9nXFwncyBcInByZXR0eVwiIChub24tSlNPTikgZGF0ZStsZXZlbCBwcmVmaXggc28gaXQgZG9lcyBub3QgZHVwbGljYXRlIHRoZSBUSU1FL0xWTCBjb2x1bW5zJywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IGxpbmUgPSAnMjAyNi0wNy0xOSAyMjoyNzo1OS4xNzggSU5GTyBBbmFseXRpY3NNZXRyaWNzU2VydmljZSBbZ2V0T3JkZXJzRm9yUGVyaW9kXSBGb3VuZCAxMiBvcmRlcnMgZm9yIHRlYW1JZDogZ2xvYic7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoW2xpbmVdLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAncGx1c2Zhbi10ZWFtLXBsYXlib29rJywgRk9SV0FSREVSX0VOVjogJ2JhY2tlbmQnIH0pO1xuXHRcdGV4cGVjdChyZWNzKS50b0hhdmVMZW5ndGgoMSk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0ubGV2ZWwpLnRvQmUoJ2luZm8nKTtcblx0XHRleHBlY3QocmVjc1swXS5tZXNzYWdlKS50b0JlKCdBbmFseXRpY3NNZXRyaWNzU2VydmljZSBbZ2V0T3JkZXJzRm9yUGVyaW9kXSBGb3VuZCAxMiBvcmRlcnMgZm9yIHRlYW1JZDogZ2xvYicpO1xuXHRcdGV4cGVjdChyZWNzWzBdLm1lc3NhZ2UpLm5vdC50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0vKTtcblx0fSk7XG5cblx0aXQoJ3Jlc3BlY3RzIGFuIEVSUk9SL1dBUk4gbGV2ZWwgaW4gdGhlIHByZXR0eSB0c2xvZyBwcmVmaXgnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoXG5cdFx0XHRbJzIwMjYtMDctMTkgMjI6Mjg6MDQuNTUyIEVSUk9SIFNwb3J0c1BlcnNpc3RlbmNlU2VydmljZSBQZXJzaXN0ZW5jZSBiYXRjaCBmYWlsZWQnXSxcblx0XHRcdHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLCBGT1JXQVJERVJfRU5WOiAndGVzdCcgfSxcblx0XHQpO1xuXHRcdGV4cGVjdChyZWNzWzBdLmxldmVsKS50b0JlKCdlcnJvcicpO1xuXHRcdGV4cGVjdChyZWNzWzBdLm1lc3NhZ2UpLnRvQmUoJ1Nwb3J0c1BlcnNpc3RlbmNlU2VydmljZSBQZXJzaXN0ZW5jZSBiYXRjaCBmYWlsZWQnKTtcblx0fSk7XG5cblx0aXQoJ2xlYXZlcyBhbiBvcmRpbmFyeSBsaW5lIHRoYXQgbWVyZWx5IHN0YXJ0cyB3aXRoIGRpZ2l0cyB1bnRvdWNoZWQgKG5vIGZhbHNlLXBvc2l0aXZlIHN0cmlwKScsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbJzQwNCBub3QgZm91bmQgZm9yIC93aWRnZXRzLzEyMyddLCB7IEZPUldBUkRFUl9TRVJWSUNFOiAnc3ZjJywgRk9SV0FSREVSX0VOVjogJ3Rlc3QnIH0pO1xuXHRcdGV4cGVjdChyZWNzWzBdLm1lc3NhZ2UpLnRvQmUoJzQwNCBub3QgZm91bmQgZm9yIC93aWRnZXRzLzEyMycpO1xuXHR9KTtcblxuXHQvLyBSb290IGNhdXNlIChmb3VuZCB2aWEgbGl2ZSBMb2tpIGRhdGEpOiBBV1MgTGFtYmRhJ3MgTm9kZS5qcyBydW50aW1lIGhhcyBubyByZXF1ZXN0IGlkIHlldFxuXHQvLyBkdXJpbmcgdGhlIElOSVQgcGhhc2UgKG1vZHVsZSBsb2FkIC8gREkgY29udGFpbmVyIGNvbnN0cnVjdGlvbiwgYmVmb3JlIHRoZSBmaXJzdCBpbnZvY2F0aW9uKSxcblx0Ly8gc28gYSBsaW5lIGxvZ2dlZCB0aGVuIHN0aWxsIGdldHMgdGhlIHVzdWFsIGDigLlpc2/igLpcXHTigLlyZXF1ZXN0SWTigLpcXHTigLlMRVZFTOKAulxcdOKAuW1lc3NhZ2XigLpgIHNoYXBlLCBidXRcblx0Ly8gd2l0aCB0aGUgc3RpbGwtdW5zZXQgaWQgc3RyaW5naWZpZWQgdG8gdGhlIGxpdGVyYWwgdGV4dCBcInVuZGVmaW5lZFwiIGJ5IHRoZSBydW50aW1lIGl0c2VsZi5cblx0Ly8gQ29uZmlybWVkIGluIHByb2R1Y3Rpb246IG11bHRpcGxlIExhbWJkYXMgYWNyb3NzIGEgY29uc3VtaW5nIHNlcnZpY2UgbG9nIGF0IGNvbGQgc3RhcnRcblx0Ly8gKGJlZm9yZSB0aGVpciBmaXJzdCByZWFsIGludm9jYXRpb24pLCBldmVyeSBvbmUgY2FycnlpbmcgYHVuZGVmaW5lZGAgYXMgaXRzIHJlcXVlc3RJZCDigJRcblx0Ly8gd2hpY2ggTG9ndHJhaWwncyBSZWNlbnQgVHJhY2VzIHRoZW4gZ3JvdXBlZCBpbnRvIG9uZSBib2d1cyBjcm9zcy1zZXJ2aWNlIFwidHJhY2VcIiBsaXRlcmFsbHlcblx0Ly8gbmFtZWQgXCJ1bmRlZmluZWRcIi5cblx0aXQoJ3RyZWF0cyBhIExhbWJkYS1wcmVmaXggcmVxdWVzdElkIG9mIGxpdGVyYWwgXCJ1bmRlZmluZWRcIiBhcyBhYnNlbnQgKEFXUyBJTklULXBoYXNlIHF1aXJrKScsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCBsaW5lID0gJzIwMjYtMDctMTlUMjI6Mjg6MDQuNTUyWlxcdHVuZGVmaW5lZFxcdElORk9cXHRTZXJ2aWNlIHJlZ2lzdHJ5IGluaXRpYWxpemVkJztcblx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbbGluZV0sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLCBGT1JXQVJERVJfRU5WOiAndGVzdCcgfSk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0ucmVxdWVzdElkKS50b0JlVW5kZWZpbmVkKCk7XG5cdFx0ZXhwZWN0KHJlY3NbMF0ubWVzc2FnZSkudG9CZSgnU2VydmljZSByZWdpc3RyeSBpbml0aWFsaXplZCcpO1xuXHR9KTtcblxuXHRpdCgnc3RpbGwgbGlmdHMgYSByZWFsIExhbWJkYS1wcmVmaXggcmVxdWVzdElkIG5vcm1hbGx5JywgYXN5bmMgKCkgPT4ge1xuXHRcdGNvbnN0IGxpbmUgPSAnMjAyNi0wNy0xOVQyMjoyODowNC41NTJaXFx0cmVxLWFiYy0xMjNcXHRJTkZPXFx0aGVsbG8nO1xuXHRcdGNvbnN0IHJlY3MgPSBhd2FpdCBydW5IYW5kbGVyKFtsaW5lXSwgeyBGT1JXQVJERVJfU0VSVklDRTogJ3N2YycsIEZPUldBUkRFUl9FTlY6ICd0ZXN0JyB9KTtcblx0XHRleHBlY3QocmVjc1swXS5yZXF1ZXN0SWQpLnRvQmUoJ3JlcS1hYmMtMTIzJyk7XG5cdH0pO1xuXG5cdGl0LmVhY2goWyAndW5kZWZpbmVkJywgJ1VuZGVmaW5lZCcsICdudWxsJywgJ05hTicgXSkoXG5cdFx0J3JlamVjdHMgYSBsaXRlcmFsIFwiJXNcIiB0b2tlbiBmcm9tIF9tZXRhLmNvcnJlbGF0aW9uSWQvY2F1c2VkQnkvYWN0b3JJZCB0aGUgc2FtZSB3YXknLFxuXHRcdGFzeW5jICh0b2tlbikgPT4ge1xuXHRcdFx0Y29uc3QgbGluZSA9IEpTT04uc3RyaW5naWZ5KHtcblx0XHRcdFx0JzAnOiAncG9pc29uZWQgbWV0YScsXG5cdFx0XHRcdF9tZXRhOiB7IGxvZ0xldmVsTmFtZTogJ0lORk8nLCBjb3JyZWxhdGlvbklkOiB0b2tlbiwgY2F1c2VkQnk6IHRva2VuLCBhY3RvcklkOiB0b2tlbiB9LFxuXHRcdFx0fSk7XG5cdFx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbbGluZV0sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdzdmMnLCBGT1JXQVJERVJfRU5WOiAndGVzdCcgfSk7XG5cdFx0XHRleHBlY3QocmVjc1swXS5jb3JyZWxhdGlvbklkKS50b0JlVW5kZWZpbmVkKCk7XG5cdFx0XHRleHBlY3QocmVjc1swXS5jYXVzZWRCeSkudG9CZVVuZGVmaW5lZCgpO1xuXHRcdFx0ZXhwZWN0KHJlY3NbMF0uYWN0b3JJZCkudG9CZVVuZGVmaW5lZCgpO1xuXHRcdH0sXG5cdCk7XG59KTtcbiJdfQ==