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
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWZvcndhcmRlci1oYW5kbGVyLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2xvZy1mb3J3YXJkZXItaGFuZGxlci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEseUNBQWlEO0FBQ2pELGdEQUFrQztBQUdsQzs7Ozs7R0FLRztBQUNILFNBQVMsV0FBVyxDQUFDLFFBQWtCO0lBQ3RDLE1BQU0sT0FBTyxHQUFHO1FBQ2YsV0FBVyxFQUFFLGNBQWM7UUFDM0IsUUFBUSxFQUFFLGdDQUFnQztRQUMxQyxTQUFTLEVBQUUsNEJBQTRCO1FBQ3ZDLFNBQVMsRUFBRSxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFFLE9BQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0tBQ2hHLENBQUM7SUFDRixPQUFPLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUEsb0JBQVEsRUFBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDakcsQ0FBQztBQUVELEtBQUssVUFBVSxVQUFVLENBQ3hCLFFBQWtCLEVBQ2xCLEdBQTJCLEVBQzNCLEdBQUcsR0FBRyxvREFBb0Q7SUFFMUQsTUFBTSxRQUFRLEdBQStCLEVBQUUsQ0FBQztJQUNoRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFO1FBQzdDLE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztR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QyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBnemlwU3luYywgZ3VuemlwU3luYyB9IGZyb20gJ25vZGU6emxpYic7XG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCc7XG5pbXBvcnQgdHlwZSB7IEFkZHJlc3NJbmZvIH0gZnJvbSAnbm9kZTpuZXQnO1xuXG4vKipcbiAqIFJ1bnRpbWUgdGVzdHMgZm9yIHRoZSBsb2ctZm9yd2FyZGVyIGhhbmRsZXI6IHRoZXkgc3RhbmQgdXAgYSBsb2NhbCBIVFRQIHNlcnZlciBhcyBhIGZha2UgaW5nZXN0LFxuICogaW52b2tlIHRoZSBoYW5kbGVyIHdpdGggYSBzeW50aGV0aWMgQ2xvdWRXYXRjaCBMb2dzIGV2ZW50LCBhbmQgYXNzZXJ0IG9uIHRoZSByZWNvcmRzIGl0IHNoaXBzIOKAlFxuICogcHJvdmluZyB0aGUgYWNjb3VudC9yZWdpb24gdGFnZ2luZyBhbmQgdGhlIG5vaXNlL3NldmVyaXR5IHJlZHVjdGlvbiBhY3R1YWxseSB0cmFuc2Zvcm0gbGluZXNcbiAqIChub3QganVzdCB0aGF0IGVudiB2YXJzIGFyZSBpbmplY3RlZCkuXG4gKi9cbmZ1bmN0aW9uIG1ha2VDd0V2ZW50KG1lc3NhZ2VzOiBzdHJpbmdbXSkge1xuXHRjb25zdCBwYXlsb2FkID0ge1xuXHRcdG1lc3NhZ2VUeXBlOiAnREFUQV9NRVNTQUdFJyxcblx0XHRsb2dHcm91cDogJy9hd3MvbGFtYmRhL3BsdXNmYW4tdHJpYWxzLWZvbycsXG5cdFx0bG9nU3RyZWFtOiAnMjAyNC8wMS8wMS9bJExBVEVTVF1hYmNkZWYnLFxuXHRcdGxvZ0V2ZW50czogbWVzc2FnZXMubWFwKChtLCBpKSA9PiAoeyBpZDogU3RyaW5nKGkpLCB0aW1lc3RhbXA6IDFfNzAwXzAwMF8wMDBfMDAwLCBtZXNzYWdlOiBtIH0pKSxcblx0fTtcblx0cmV0dXJuIHsgYXdzbG9nczogeyBkYXRhOiBnemlwU3luYyhCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSkpLnRvU3RyaW5nKCdiYXNlNjQnKSB9IH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bkhhbmRsZXIoXG5cdG1lc3NhZ2VzOiBzdHJpbmdbXSxcblx0ZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuXHRhcm4gPSAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpmdW5jdGlvbjpmd2QnLFxuKTogUHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pj4ge1xuXHRjb25zdCByZWNlaXZlZDogQXJyYXk8UmVjb3JkPHN0cmluZywgYW55Pj4gPSBbXTtcblx0Y29uc3Qgc2VydmVyID0gaHR0cC5jcmVhdGVTZXJ2ZXIoKHJlcSwgcmVzKSA9PiB7XG5cdFx0Y29uc3QgY2h1bmtzOiBCdWZmZXJbXSA9IFtdO1xuXHRcdHJlcS5vbignZGF0YScsIChjKSA9PiBjaHVua3MucHVzaChjIGFzIEJ1ZmZlcikpO1xuXHRcdHJlcS5vbignZW5kJywgKCkgPT4ge1xuXHRcdFx0dHJ5IHtcblx0XHRcdFx0Y29uc3QganNvbiA9IGd1bnppcFN5bmMoQnVmZmVyLmNvbmNhdChjaHVua3MpKS50b1N0cmluZygndXRmOCcpO1xuXHRcdFx0XHRmb3IgKGNvbnN0IHIgb2YgSlNPTi5wYXJzZShqc29uKSkgcmVjZWl2ZWQucHVzaChyKTtcblx0XHRcdH0gY2F0Y2gge1xuXHRcdFx0XHQvKiBpZ25vcmUgKi9cblx0XHRcdH1cblx0XHRcdHJlcy53cml0ZUhlYWQoMjAwKTtcblx0XHRcdHJlcy5lbmQoJ29rJyk7XG5cdFx0fSk7XG5cdH0pO1xuXHRhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocikgPT4gc2VydmVyLmxpc3RlbigwLCAnMTI3LjAuMC4xJywgcikpO1xuXHRjb25zdCBwb3J0ID0gKHNlcnZlci5hZGRyZXNzKCkgYXMgQWRkcmVzc0luZm8pLnBvcnQ7XG5cblx0amVzdC5yZXNldE1vZHVsZXMoKTtcblx0Y29uc3QgcHJldiA9IHsgLi4ucHJvY2Vzcy5lbnYgfTtcblx0cHJvY2Vzcy5lbnYuRk9SV0FSREVSX0lOR0VTVF9VUkwgPSBgaHR0cDovLzEyNy4wLjAuMToke3BvcnR9L2A7XG5cdHByb2Nlc3MuZW52LkFXU19SRUdJT04gPSAndXMtZWFzdC0xJztcblx0T2JqZWN0LmFzc2lnbihwcm9jZXNzLmVudiwgZW52KTtcblx0dHJ5IHtcblx0XHQvLyBSZXF1aXJlIEFGVEVSIGVudiBpcyBzZXQgKHRoZSBoYW5kbGVyIHJlYWRzIGVudiBhdCBtb2R1bGUgbG9hZCkuXG5cdFx0Y29uc3QgeyBoYW5kbGVyIH0gPSByZXF1aXJlKCcuL2xvZy1mb3J3YXJkZXItaGFuZGxlcicpO1xuXHRcdGF3YWl0IGhhbmRsZXIobWFrZUN3RXZlbnQobWVzc2FnZXMpLCB7IGludm9rZWRGdW5jdGlvbkFybjogYXJuIH0pO1xuXHR9IGZpbmFsbHkge1xuXHRcdHByb2Nlc3MuZW52ID0gcHJldjtcblx0XHRhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocikgPT4gc2VydmVyLmNsb3NlKCgpID0+IHIoKSkpO1xuXHR9XG5cdHJldHVybiByZWNlaXZlZDtcbn1cblxuZGVzY3JpYmUoJ2xvZy1mb3J3YXJkZXIgaGFuZGxlciBydW50aW1lJywgKCkgPT4ge1xuXHRpdCgndGFncyBldmVyeSByZWNvcmQgd2l0aCBhY2NvdW50IChmcm9tIEFSTikgYW5kIHJlZ2lvbicsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCByZWNzID0gYXdhaXQgcnVuSGFuZGxlcihbJ2hlbGxvIHdvcmxkJ10sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdwbHVzZmFuLXRyaWFscycsIEZPUldBUkRFUl9FTlY6ICdsb2NhbCcgfSk7XG5cdFx0ZXhwZWN0KHJlY3MpLnRvSGF2ZUxlbmd0aCgxKTtcblx0XHRleHBlY3QocmVjc1swXS5hY2NvdW50KS50b0JlKCcxMjM0NTY3ODkwMTInKTtcblx0XHRleHBlY3QocmVjc1swXS5yZWdpb24pLnRvQmUoJ3VzLWVhc3QtMScpO1xuXHRcdGV4cGVjdChyZWNzWzBdLnNlcnZpY2UpLnRvQmUoJ3BsdXNmYW4tdHJpYWxzLWxvY2FsJyk7XG5cdH0pO1xuXG5cdGl0KCdkaXN0aW5ndWlzaGVzIHNhbWUtbmFtZWQgZGVwbG95cyBpbiBkaWZmZXJlbnQgYWNjb3VudHMgYnkgYWNjb3VudCcsIGFzeW5jICgpID0+IHtcblx0XHRjb25zdCBhID0gYXdhaXQgcnVuSGFuZGxlcihbJ3gnXSwgeyBGT1JXQVJERVJfU0VSVklDRTogJ3BsdXNmYW4tdHJpYWxzJywgRk9SV0FSREVSX0VOVjogJ2xvY2FsJyB9LFxuXHRcdFx0J2Fybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMTExMTExMTExMTE6ZnVuY3Rpb246ZndkJyk7XG5cdFx0Y29uc3QgYiA9IGF3YWl0IHJ1bkhhbmRsZXIoWyd4J10sIHsgRk9SV0FSREVSX1NFUlZJQ0U6ICdwbHVzZmFuLXRyaWFscycsIEZPUldBUkRFUl9FTlY6ICdsb2NhbCcgfSxcblx0XHRcdCdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MjIyMjIyMjIyMjIyOmZ1bmN0aW9uOmZ3ZCcpO1xuXHRcdC8vIFNhbWUgc2VydmljZSBsYWJlbCwgYnV0IHRoZSBhY2NvdW50IGZpZWxkIHRlbGxzIHRoZW0gYXBhcnQuXG5cdFx0ZXhwZWN0KGFbMF0uc2VydmljZSkudG9CZShiWzBdLnNlcnZpY2UpO1xuXHRcdGV4cGVjdChhWzBdLmFjY291bnQpLnRvQmUoJzExMTExMTExMTExMScpO1xuXHRcdGV4cGVjdChiWzBdLmFjY291bnQpLnRvQmUoJzIyMjIyMjIyMjIyMicpO1xuXHR9KTtcblxuXHRpdCgnYXBwbGllcyBub2lzZSByZWR1Y3Rpb246IGJlbmlnbi0+d2FybiwgZHJvcCByZW1vdmVkLCBub2lzZS0+ZGVidWcnLCBhc3luYyAoKSA9PiB7XG5cdFx0Y29uc3QgcmVjcyA9IGF3YWl0IHJ1bkhhbmRsZXIoXG5cdFx0XHRbXG5cdFx0XHRcdCcyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFpcXHRyZXFpZFxcdEVSUk9SXFx0RUNPTk5SRVNFVCB3aGlsZSBjYWxsaW5nIHVwc3RyZWFtJywgLy8gYmVuaWduIGVycm9yXG5cdFx0XHRcdCdHRVQgL2hlYWx0aHogcHJvYmUnLCAgICAgIC8vIGRyb3Bcblx0XHRcdFx0J2RlcHJlY2F0aW9uIHdhcm5pbmc6IG9sZCBhcGknLCAvLyBkb3duZ3JhZGVcblx0XHRcdFx0J2Egbm9ybWFsIGluZm8gbGluZScsICAgICAgLy8gdW50b3VjaGVkXG5cdFx0XHRdLFxuXHRcdFx0e1xuXHRcdFx0XHRGT1JXQVJERVJfU0VSVklDRTogJ3N2YycsXG5cdFx0XHRcdEZPUldBUkRFUl9FTlY6ICd0ZXN0Jyxcblx0XHRcdFx0Rk9SV0FSREVSX05PSVNFX0JFTklHTjogSlNPTi5zdHJpbmdpZnkoWydcXFxcYkVDT05OUkVTRVRcXFxcYiddKSxcblx0XHRcdFx0Rk9SV0FSREVSX05PSVNFX0RST1A6IEpTT04uc3RyaW5naWZ5KFsnR0VUIC8oPzpoZWFsdGh6KSddKSxcblx0XHRcdFx0Rk9SV0FSREVSX05PSVNFX0RPV05HUkFERTogSlNPTi5zdHJpbmdpZnkoWydkZXByZWNhdGlvbi4/d2FybmluZyddKSxcblx0XHRcdH0sXG5cdFx0KTtcblx0XHQvLyBUaGUgZHJvcCBsaW5lIGlzIGdvbmUg4oaSIDMgc2hpcHBlZCwgbm90IDQuXG5cdFx0ZXhwZWN0KHJlY3MpLnRvSGF2ZUxlbmd0aCgzKTtcblx0XHRjb25zdCBiZW5pZ24gPSByZWNzLmZpbmQoKHIpID0+IHIubWVzc2FnZS5pbmNsdWRlcygnRUNPTk5SRVNFVCcpKSE7XG5cdFx0ZXhwZWN0KGJlbmlnbi5sZXZlbCkudG9CZSgnd2FybicpO1xuXHRcdGV4cGVjdChiZW5pZ24ucmVjbGFzc2lmaWVkKS50b0JlKCdiZW5pZ24nKTtcblx0XHRjb25zdCBkb3duZ3JhZGVkID0gcmVjcy5maW5kKChyKSA9PiByLm1lc3NhZ2UuaW5jbHVkZXMoJ2RlcHJlY2F0aW9uJykpITtcblx0XHRleHBlY3QoZG93bmdyYWRlZC5sZXZlbCkudG9CZSgnZGVidWcnKTtcblx0XHRleHBlY3QoZG93bmdyYWRlZC5yZWNsYXNzaWZpZWQpLnRvQmUoJ25vaXNlJyk7XG5cdFx0ZXhwZWN0KHJlY3Muc29tZSgocikgPT4gci5tZXNzYWdlLmluY2x1ZGVzKCdoZWFsdGh6JykpKS50b0JlKGZhbHNlKTtcblx0fSk7XG59KTtcbiJdfQ==