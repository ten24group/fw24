import { gzipSync, gunzipSync } from 'node:zlib';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Runtime tests for the log-forwarder handler: they stand up a local HTTP server as a fake ingest,
 * invoke the handler with a synthetic CloudWatch Logs event, and assert on the records it ships —
 * proving the account/region tagging and the noise/severity reduction actually transform lines
 * (not just that env vars are injected).
 */
function makeCwEvent(messages: string[]) {
	const payload = {
		messageType: 'DATA_MESSAGE',
		logGroup: '/aws/lambda/plusfan-trials-foo',
		logStream: '2024/01/01/[$LATEST]abcdef',
		logEvents: messages.map((m, i) => ({ id: String(i), timestamp: 1_700_000_000_000, message: m })),
	};
	return { awslogs: { data: gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64') } };
}

async function runHandler(
	messages: string[],
	env: Record<string, string>,
	arn = 'arn:aws:lambda:us-east-1:123456789012:function:fwd',
): Promise<Array<Record<string, any>>> {
	const received: Array<Record<string, any>> = [];
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c as Buffer));
		req.on('end', () => {
			try {
				const json = gunzipSync(Buffer.concat(chunks)).toString('utf8');
				for (const r of JSON.parse(json)) received.push(r);
			} catch {
				/* ignore */
			}
			res.writeHead(200);
			res.end('ok');
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const port = (server.address() as AddressInfo).port;

	jest.resetModules();
	const prev = { ...process.env };
	process.env.FORWARDER_INGEST_URL = `http://127.0.0.1:${port}/`;
	process.env.AWS_REGION = 'us-east-1';
	Object.assign(process.env, env);
	try {
		// Require AFTER env is set (the handler reads env at module load).
		const { handler } = require('./log-forwarder-handler');
		await handler(makeCwEvent(messages), { invokedFunctionArn: arn });
	} finally {
		process.env = prev;
		await new Promise<void>((r) => server.close(() => r()));
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
		const a = await runHandler(['x'], { FORWARDER_SERVICE: 'plusfan-trials', FORWARDER_ENV: 'local' },
			'arn:aws:lambda:us-east-1:111111111111:function:fwd');
		const b = await runHandler(['x'], { FORWARDER_SERVICE: 'plusfan-trials', FORWARDER_ENV: 'local' },
			'arn:aws:lambda:us-east-1:222222222222:function:fwd');
		// Same service label, but the account field tells them apart.
		expect(a[0].service).toBe(b[0].service);
		expect(a[0].account).toBe('111111111111');
		expect(b[0].account).toBe('222222222222');
	});

	it('applies noise reduction: benign->warn, drop removed, noise->debug', async () => {
		const recs = await runHandler(
			[
				'2024-01-01T00:00:00.000Z\treqid\tERROR\tECONNRESET while calling upstream', // benign error
				'GET /healthz probe',      // drop
				'deprecation warning: old api', // downgrade
				'a normal info line',      // untouched
			],
			{
				FORWARDER_SERVICE: 'svc',
				FORWARDER_ENV: 'test',
				FORWARDER_NOISE_BENIGN: JSON.stringify(['\\bECONNRESET\\b']),
				FORWARDER_NOISE_DROP: JSON.stringify(['GET /(?:healthz)']),
				FORWARDER_NOISE_DOWNGRADE: JSON.stringify(['deprecation.?warning']),
			},
		);
		// The drop line is gone → 3 shipped, not 4.
		expect(recs).toHaveLength(3);
		const benign = recs.find((r) => r.message.includes('ECONNRESET'))!;
		expect(benign.level).toBe('warn');
		expect(benign.reclassified).toBe('benign');
		const downgraded = recs.find((r) => r.message.includes('deprecation'))!;
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
			FORWARDER_FIELDS: JSON.stringify([ 'correlationId', 'orderId' ]),
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
			FORWARDER_FIELDS: JSON.stringify([ 'service', 'orderId' ]),
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
		const recs = await runHandler(
			['2026-07-19 22:28:04.552 ERROR SportsPersistenceService Persistence batch failed'],
			{ FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' },
		);
		expect(recs[0].level).toBe('error');
		expect(recs[0].message).toBe('SportsPersistenceService Persistence batch failed');
	});

	it('leaves an ordinary line that merely starts with digits untouched (no false-positive strip)', async () => {
		const recs = await runHandler(['404 not found for /widgets/123'], { FORWARDER_SERVICE: 'svc', FORWARDER_ENV: 'test' });
		expect(recs[0].message).toBe('404 not found for /widgets/123');
	});
});
