import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { APIConstruct } from './api';
import { Fw24 } from '../core/fw24';

/**
 * Behaviour contract for the stable shared-root approach to nested controllers:
 *  - a shared root segment (e.g. `internal`) is created exactly once, in a STABLE owner stack,
 *    regardless of controller registration order (no 409, no live AWS lookups);
 *  - by default the main (RestApi) stack owns it; brownfield apps can pin ownership to an
 *    existing nested stack to preserve the historical CloudFormation logical id;
 *  - nested-controller apps publish exactly one deployment + one stage, and that stage is exposed
 *    as api.deploymentStage so usage plans bind correctly.
 */
describe('APIConstruct nested controllers — stable shared root', () => {
    let app: App;
    let mainStack: Stack;

    const newApiConstruct = (config: Record<string, unknown> = {}) => new APIConstruct({
        controllerParentStackName: 'main',
        skipControllers: true,
        cors: true,
        apiOptions: { deployOptions: { stageName: 'v1' } },
        ...config,
    } as any);

    // Register a nested controller the way registerController does: ensure its stack exists,
    // then resolve/attach its resources via getOrCreateControllerResource.
    const registerNestedController = (api: APIConstruct, controllerName: string) => {
        const fw24 = Fw24.getInstance();
        fw24.getStack(controllerName, 'main');
        return (api as any).getOrCreateControllerResource(controllerName, controllerName) as { resourceId: string };
    };

    const apiGatewayResourcesWithPathPart = (stack: Stack, pathPart: string) => {
        const resources = Template.fromStack(stack).findResources('AWS::ApiGateway::Resource');
        return Object.entries(resources).filter(([ , r ]) => (r as any).Properties?.PathPart === pathPart);
    };

    beforeEach(() => {
        (Fw24 as any).instance = undefined;
        app = new App();
        mainStack = new Stack(app, 'test-app-main-stack', { env: { account: '123456789012', region: 'us-east-1' } });
        const fw24 = Fw24.getInstance();
        fw24.setApp(app);
        fw24.setConfig({ name: 'test-app', region: 'us-east-1', account: '123456789012' } as any);
        fw24.addStack('main', mainStack);
    });

    afterEach(() => {
        (Fw24 as any).instance = undefined;
        jest.restoreAllMocks();
    });

    describe('order independence', () => {
        // Build a fresh app in the given registration order and return the single main-stack /internal
        // logical id (asserting it is created exactly once, as a child of the API root).
        const buildAndGetInternalRootLogicalId = async (order: string[]): Promise<string> => {
            (Fw24 as any).instance = undefined;
            const localApp = new App();
            const localMain = new Stack(localApp, 'test-app-main-stack', { env: { account: '123456789012', region: 'us-east-1' } });
            const fw24 = Fw24.getInstance();
            fw24.setApp(localApp);
            fw24.setConfig({ name: 'test-app', region: 'us-east-1', account: '123456789012' } as any);
            fw24.addStack('main', localMain);

            const api = newApiConstruct();
            await api.construct();
            for (const name of order) {
                fw24.getStack(name, 'main');
                (api as any).getOrCreateControllerResource(name, name);
            }

            const internalInMain = apiGatewayResourcesWithPathPart(localMain, 'internal');
            expect(internalInMain).toHaveLength(1);
            const [ logicalId, resource ] = internalInMain[ 0 ];
            // child of the API root (ParentId -> RootResourceId), owned by the main stack
            expect(JSON.stringify((resource as any).Properties?.ParentId)).toContain('RootResourceId');
            // no sibling re-created /internal in its own nested stack
            for (const name of order) {
                expect(apiGatewayResourcesWithPathPart(fw24.getStack(name), 'internal')).toHaveLength(0);
            }
            return logicalId;
        };

        it('produces the SAME /internal logical id regardless of controller registration order', async () => {
            const forwardOrder = await buildAndGetInternalRootLogicalId([ 'internal/team', 'internal/notifications' ]);
            // reversed order — historically this is what flipped the owner and caused 409
            const reversedOrder = await buildAndGetInternalRootLogicalId([ 'internal/notifications', 'internal/team' ]);
            // a brand-new sibling that sorts first — the classic brownfield 409 trigger
            const newSiblingFirst = await buildAndGetInternalRootLogicalId([ 'internal/audit', 'internal/team', 'internal/notifications' ]);

            expect(reversedOrder).toBe(forwardOrder);
            expect(newSiblingFirst).toBe(forwardOrder);
        });
    });

    it('is generic — works for any shared root name, not just internal/admin', async () => {
        const api = newApiConstruct();
        await api.construct();
        registerNestedController(api, 'webhooks/stripe');
        registerNestedController(api, 'webhooks/razorpay');

        expect(apiGatewayResourcesWithPathPart(mainStack, 'webhooks')).toHaveLength(1);
    });

    it('leaf resources live in their own nested stacks and reference the shared root by parameter', async () => {
        const api = newApiConstruct();
        await api.construct();
        registerNestedController(api, 'internal/team');

        const teamStack = Fw24.getInstance().getStack('internal/team') as NestedStack;
        expect(teamStack instanceof NestedStack).toBe(true);
        // the leaf segment is created in the nested stack...
        expect(apiGatewayResourcesWithPathPart(teamStack, 'team')).toHaveLength(1);
        // ...and its parent (/internal) is supplied cross-stack (a CfnParameter on the nested stack)
        const params = Template.fromStack(teamStack).findParameters('*');
        expect(Object.keys(params).length).toBeGreaterThan(0);
    });

    it('default strategy (main-stack): creates the shared root in the MAIN stack, never in a nested stack', async () => {
        const api = newApiConstruct();
        await api.construct();
        registerNestedController(api, 'internal/team');
        registerNestedController(api, 'internal/notifications');

        expect(apiGatewayResourcesWithPathPart(mainStack, 'internal')).toHaveLength(1);
        expect(apiGatewayResourcesWithPathPart(Fw24.getInstance().getStack('internal/team'), 'internal')).toHaveLength(0);
        expect(apiGatewayResourcesWithPathPart(Fw24.getInstance().getStack('internal/notifications'), 'internal')).toHaveLength(0);
    });

    describe("'pinned' strategy (brownfield, moves no live resource)", () => {
        it('keeps the shared root in the pinned owner stack, even when a non-owner registers first', async () => {
            const api = newApiConstruct({
                nestedControllerRootStrategy: 'pinned',
                nestedControllerRootOwners: { internal: 'internal/team' },
            });
            await api.construct();
            // a non-owner registers FIRST (the classic 409 trigger) — must still resolve to the owner
            registerNestedController(api, 'internal/notifications');
            registerNestedController(api, 'internal/team');

            // /internal stays in the pinned owner stack, exactly once; main stack never creates it
            expect(apiGatewayResourcesWithPathPart(Fw24.getInstance().getStack('internal/team'), 'internal')).toHaveLength(1);
            expect(apiGatewayResourcesWithPathPart(mainStack, 'internal')).toHaveLength(0);
        });

        it('falls back to the main stack for roots not listed in the owners map', async () => {
            const api = newApiConstruct({
                nestedControllerRootStrategy: 'pinned',
                nestedControllerRootOwners: { internal: 'internal/team' },
            });
            await api.construct();
            registerNestedController(api, 'webhooks/stripe'); // not pinned -> main stack

            expect(apiGatewayResourcesWithPathPart(mainStack, 'webhooks')).toHaveLength(1);
        });
    });

    describe("'auto' strategy (discovers the existing owner from deployed state)", () => {
        // a controller descriptor shaped like Helper.registerHandlers produces
        const makeDescriptor = (fileName: string, controllerName: string) => {
            class TestController { controllerName = controllerName; controllerConfig = {}; }
            return { handlerClass: TestController, fileName, filePath: '/app/src/controllers', handlerHash: fileName } as any;
        };
        // a mocked CloudFormation lookup: `internal` is owned by a stack whose template carries the
        // internal/team routes (so auto must resolve the owner to the internal/team controller stack)
        const lookupOwnedByTeam = {
            listNestedStacks: async () => [ { logicalId: 'someMangledNestedStackXYZ', physicalId: 'arn:team' } ],
            getTemplate: async () => ({ Resources: {
                Root: { Type: 'AWS::ApiGateway::Resource', Properties: { PathPart: 'internal', ParentId: { 'Fn::GetAtt': [ 'api', 'RootResourceId' ] } } },
                Team: { Type: 'AWS::ApiGateway::Resource', Properties: { PathPart: 'team', ParentId: { Ref: 'Root' } } },
            } }),
        };

        it('resolves the existing owner and keeps /internal there, even when a non-owner registers first', async () => {
            const api = newApiConstruct({ nestedControllerRootStrategy: 'auto' });
            await api.construct();
            (api as any).nestedRootLookup = lookupOwnedByTeam;

            await (api as any).resolveAutoSharedRootOwners([
                makeDescriptor('internal/notifications.ts', 'notifications'),
                makeDescriptor('internal/team.ts', 'team'),
            ]);
            // non-owner registers first (the classic 409 trigger)
            registerNestedController(api, 'internal/notifications');
            registerNestedController(api, 'internal/team');

            expect(apiGatewayResourcesWithPathPart(Fw24.getInstance().getStack('internal/team'), 'internal')).toHaveLength(1);
            expect(apiGatewayResourcesWithPathPart(mainStack, 'internal')).toHaveLength(0);
            expect(apiGatewayResourcesWithPathPart(Fw24.getInstance().getStack('internal/notifications'), 'internal')).toHaveLength(0);
        });

        it('treats a not-yet-deployed (greenfield) root as main-stack owned', async () => {
            const api = newApiConstruct({ nestedControllerRootStrategy: 'auto' });
            await api.construct();
            (api as any).nestedRootLookup = {
                listNestedStacks: async () => [],   // nothing deployed owns anything
                getTemplate: async () => ({}),
            };

            await (api as any).resolveAutoSharedRootOwners([ makeDescriptor('internal/team.ts', 'team') ]);
            registerNestedController(api, 'internal/team');

            expect(apiGatewayResourcesWithPathPart(mainStack, 'internal')).toHaveLength(1);
        });

        it('fails loud when the lookup cannot resolve and no fallback owner is configured', async () => {
            const api = newApiConstruct({ nestedControllerRootStrategy: 'auto' });
            await api.construct();
            (api as any).nestedRootLookup = {
                listNestedStacks: async () => { throw new Error('no credentials'); },
                getTemplate: async () => ({}),
            };

            await expect((api as any).resolveAutoSharedRootOwners([ makeDescriptor('internal/team.ts', 'team') ]))
                .rejects.toThrow(/could not look up deployed shared-root owners/);
        });

        it('uses a configured nestedControllerRootOwners value as an explicit fallback when lookup fails', async () => {
            const api = newApiConstruct({ nestedControllerRootStrategy: 'auto', nestedControllerRootOwners: { internal: 'internal/team' } });
            await api.construct();
            (api as any).nestedRootLookup = {
                listNestedStacks: async () => { throw new Error('no credentials'); },
                getTemplate: async () => ({}),
            };

            await (api as any).resolveAutoSharedRootOwners([ makeDescriptor('internal/team.ts', 'team') ]);
            registerNestedController(api, 'internal/team');

            expect(apiGatewayResourcesWithPathPart(Fw24.getInstance().getStack('internal/team'), 'internal')).toHaveLength(1);
            expect(apiGatewayResourcesWithPathPart(mainStack, 'internal')).toHaveLength(0);
        });
    });

    describe('single deployment + stage', () => {
        it('publishes exactly one deployment and one stage, and sets api.deploymentStage', async () => {
            const api = newApiConstruct();
            await api.construct();
            registerNestedController(api, 'internal/team');

            await (api as any).createSingleDeployment();

            const template = Template.fromStack(mainStack);
            template.resourceCountIs('AWS::ApiGateway::Deployment', 1);
            template.resourceCountIs('AWS::ApiGateway::Stage', 1);
            template.hasResourceProperties('AWS::ApiGateway::Stage', { StageName: 'v1' });
            expect(api.api.deploymentStage).toBeDefined();
        });

        it('does not let RestApi auto-deploy a stage for nested-controller apps', async () => {
            const api = newApiConstruct();
            await api.construct();
            // before createSingleDeployment runs, there must be no stage yet (deploy:false)
            expect(() => Template.fromStack(mainStack).resourceCountIs('AWS::ApiGateway::Stage', 0)).not.toThrow();
        });
    });

    describe('deferred usage plans bind to a real stage', () => {
        it('creates a usage plan bound to the published stage (deploymentStage not undefined)', async () => {
            const api = newApiConstruct({
                usagePlans: [ { name: 'default', apiKeys: { keys: [ 'k-123456789012345678901234' ] } } ],
            });
            await api.construct();

            // simulate the post-registration flow for a nested-controller app
            await (api as any).createSingleDeployment();
            (api as any).flushDeferredUsagePlans();

            const template = Template.fromStack(mainStack);
            template.resourceCountIs('AWS::ApiGateway::Stage', 1);
            template.resourceCountIs('AWS::ApiGateway::UsagePlan', 1);
            const usagePlans = template.findResources('AWS::ApiGateway::UsagePlan');
            const apiStages = (Object.values(usagePlans)[ 0 ] as any).Properties?.ApiStages;
            expect(Array.isArray(apiStages)).toBe(true);
            expect(apiStages.length).toBe(1);
            // the stage ref must resolve to a real stage, not undefined
            expect(apiStages[ 0 ].Stage).toBeDefined();
        });
    });
});
