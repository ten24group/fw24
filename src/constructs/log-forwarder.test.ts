import { App, Stack, NestedStack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Function as LambdaFunction, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Fw24 } from '../core/fw24';
import { LogForwarderConstruct, DEFAULT_LOG_NOISE_RULES, DEFAULT_LIFT_FIELDS } from './log-forwarder';

/**
 * Unit tests for LogForwarderConstruct — verify the emitted CloudFormation without needing AWS creds:
 * a forwarder Lambda is created, every OTHER function gets a subscription filter (the forwarder never
 * subscribes itself), a single wildcard invoke permission is added, and the app-level noise rules are
 * injected into the forwarder's environment.
 */
function makeStack(): { app: App; stack: Stack } {
	(Fw24 as any).instance = undefined;
	const app = new App();
	const stack = new Stack(app, 'TestStack', { env: { account: '123456789012', region: 'us-east-1' } });
	const fw24 = Fw24.getInstance();
	fw24.setApp(app);
	fw24.setConfig({ name: 'test-app', region: 'us-east-1', account: '123456789012' });
	fw24.addStack('main', stack);
	return { app, stack };
}

function dummyFn(stack: Stack, id: string): LambdaFunction {
	return new LambdaFunction(stack, id, {
		runtime: Runtime.NODEJS_22_X,
		handler: 'index.handler',
		code: Code.fromInline('exports.handler = async () => {};'),
	});
}

/** Pull the forwarder function's environment out of a synthesized template. */
function forwarderEnv(template: Template, ingestUrl: string): Record<string, string> {
	const fns = template.findResources('AWS::Lambda::Function');
	const match = Object.values(fns)
		.map((f: any) => f.Properties?.Environment?.Variables)
		.find((v: any) => v && v.FORWARDER_INGEST_URL === ingestUrl);
	if (!match) throw new Error('forwarder function not found in template');
	return match as Record<string, string>;
}

describe('LogForwarderConstruct', () => {
	afterEach(() => {
		(Fw24 as any).instance = undefined;
	});

	it('creates a forwarder and subscribes every other function (never itself)', async () => {
		const { stack } = makeStack();
		dummyFn(stack, 'AlphaFn');
		dummyFn(stack, 'BetaFn');

		await new LogForwarderConstruct({
			stackName: 'main',
			ingestHttpUrl: 'http://ingest.example/',
			service: 'svc',
			env: 'test',
		}).construct();

		const t = Template.fromStack(stack);
		// Alpha + Beta get a subscription filter; the forwarder does not subscribe to itself.
		t.resourceCountIs('AWS::Logs::SubscriptionFilter', 2);
		// One broad invoke permission for CloudWatch Logs (not one per log group).
		t.hasResourceProperties(
			'AWS::Lambda::Permission',
			Match.objectLike({ Principal: 'logs.amazonaws.com', Action: 'lambda:InvokeFunction' }),
		);
	});

	it('injects the default noise/severity rules into the forwarder env', async () => {
		const { stack } = makeStack();
		dummyFn(stack, 'AlphaFn');
		await new LogForwarderConstruct({
			stackName: 'main',
			ingestHttpUrl: 'http://ingest.example/',
		}).construct();

		const env = forwarderEnv(Template.fromStack(stack), 'http://ingest.example/');
		expect(JSON.parse(env.FORWARDER_NOISE_BENIGN)).toEqual(DEFAULT_LOG_NOISE_RULES.benign);
		expect(JSON.parse(env.FORWARDER_NOISE_DROP)).toEqual(DEFAULT_LOG_NOISE_RULES.drop);
		expect(JSON.parse(env.FORWARDER_NOISE_DOWNGRADE)).toEqual(DEFAULT_LOG_NOISE_RULES.downgrade);
	});

	it('uses ONLY custom rules when useDefaults is false', async () => {
		const { stack } = makeStack();
		dummyFn(stack, 'AlphaFn');
		await new LogForwarderConstruct({
			stackName: 'main',
			ingestHttpUrl: 'http://only-custom/',
			noise: { drop: ['^custom-drop$'], useDefaults: false },
		}).construct();

		const env = forwarderEnv(Template.fromStack(stack), 'http://only-custom/');
		expect(JSON.parse(env.FORWARDER_NOISE_DROP)).toEqual(['^custom-drop$']);
		// No defaults merged in → benign/downgrade env vars are absent.
		expect(env.FORWARDER_NOISE_BENIGN).toBeUndefined();
		expect(env.FORWARDER_NOISE_DOWNGRADE).toBeUndefined();
	});

	it("subscribes Lambdas in nested stacks under the forwarder's stack (scope 'stack')", async () => {
		const { stack } = makeStack();
		// Controller-style nested stacks under 'main' (how fw24 lays out controllerParentStackName apps).
		const nestedA = new NestedStack(stack, 'ControllerNestedA');
		const nestedB = new NestedStack(stack, 'ControllerNestedB');
		dummyFn(nestedA, 'ControllerAFn');
		dummyFn(nestedB, 'ControllerBFn');
		dummyFn(stack, 'MainFn');

		await new LogForwarderConstruct({ stackName: 'main', ingestHttpUrl: 'http://x/' }).construct();

		// Every Lambda in every nested stack must get a subscription filter — not just the main stack's.
		Template.fromStack(nestedA).resourceCountIs('AWS::Logs::SubscriptionFilter', 1);
		Template.fromStack(nestedB).resourceCountIs('AWS::Logs::SubscriptionFilter', 1);
		Template.fromStack(stack).resourceCountIs('AWS::Logs::SubscriptionFilter', 1); // MainFn only
	});

	it('infers service + env from fw24 config when not passed', async () => {
		(Fw24 as any).instance = undefined;
		const app = new App();
		const stack = new Stack(app, 'TestStack', { env: { account: '123456789012', region: 'us-east-1' } });
		const fw24 = Fw24.getInstance();
		fw24.setApp(app);
		fw24.setConfig({ name: 'plusfan-trials-backend', region: 'us-east-1', account: '123456789012', environment: 'develop' } as any);
		fw24.addStack('main', stack);
		dummyFn(stack, 'AlphaFn');

		// No service/env passed — they should come from fw24's config (APP_NAME / APP_ENVIRONMENT).
		await new LogForwarderConstruct({ stackName: 'main', ingestHttpUrl: 'http://infer/' }).construct();

		const env = forwarderEnv(Template.fromStack(stack), 'http://infer/');
		expect(env.FORWARDER_SERVICE).toBe('plusfan-trials-backend');
		expect(env.FORWARDER_ENV).toBe('develop');
	});

	it('lifts correlationId by default and merges app-declared business fields', async () => {
		const { stack } = makeStack();
		dummyFn(stack, 'AlphaFn');
		await new LogForwarderConstruct({
			stackName: 'main',
			ingestHttpUrl: 'http://fields/',
			liftFields: [ 'orderId', 'userId' ],
			version: '2.0.0',
		}).construct();

		const env = forwarderEnv(Template.fromStack(stack), 'http://fields/');
		expect(JSON.parse(env.FORWARDER_FIELDS)).toEqual([ ...DEFAULT_LIFT_FIELDS, 'orderId', 'userId' ]);
		expect(env.FORWARDER_VERSION).toBe('2.0.0');
	});

	it('lifts ONLY the app list when liftFieldDefaults is false', async () => {
		const { stack } = makeStack();
		dummyFn(stack, 'AlphaFn');
		await new LogForwarderConstruct({
			stackName: 'main',
			ingestHttpUrl: 'http://only-fields/',
			liftFields: [ 'orderId' ],
			liftFieldDefaults: false,
		}).construct();

		const env = forwarderEnv(Template.fromStack(stack), 'http://only-fields/');
		expect(JSON.parse(env.FORWARDER_FIELDS)).toEqual([ 'orderId' ]);
		// No version passed and none in env → the key is omitted entirely.
		expect(env.FORWARDER_VERSION).toBeUndefined();
	});

	it('merges custom rules on top of defaults by default', async () => {
		const { stack } = makeStack();
		dummyFn(stack, 'AlphaFn');
		await new LogForwarderConstruct({
			stackName: 'main',
			ingestHttpUrl: 'http://merged/',
			noise: { drop: ['^extra-drop$'] },
		}).construct();

		const env = forwarderEnv(Template.fromStack(stack), 'http://merged/');
		const drop = JSON.parse(env.FORWARDER_NOISE_DROP);
		expect(drop).toEqual([ ...DEFAULT_LOG_NOISE_RULES.drop, '^extra-drop$' ]);
	});
});
