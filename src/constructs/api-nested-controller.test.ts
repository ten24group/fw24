import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MockIntegration, PassthroughBehavior, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { APIConstruct } from './api';
import { Fw24 } from '../core/fw24';
import { OutputType } from '../interfaces/construct';
import HandlerDescriptor from '../interfaces/handler-descriptor';
import * as nestedRootResources from './nested-controller-root-resources';
import { buildNestedControllerRootExportName } from './nested-controller-root-resources';

function makeDescriptor(fileName: string, controllerName: string): HandlerDescriptor {
    class TestController {
        controllerName = controllerName;
        controllerConfig = {};
    }

    return {
        handlerClass: TestController,
        fileName,
        filePath: '/app/src/controllers',
        handlerHash: fileName,
    };
}

describe('APIConstruct nested controllers', () => {
    let app: App;
    let mainStack: Stack;

    const addMinimalMethod = (api: RestApi) => {
        api.root.addResource('health').addMethod('GET', new MockIntegration({
            integrationResponses: [ { statusCode: '200' } ],
            passthroughBehavior: PassthroughBehavior.NEVER,
            requestTemplates: { 'application/json': '{"statusCode": 200}' },
        }), {
            methodResponses: [ { statusCode: '200' } ],
        });
    };

    beforeEach(() => {
        (Fw24 as any).instance = undefined;

        app = new App();
        mainStack = new Stack(app, 'test-app-main-stack', {
            env: { account: '123456789012', region: 'us-east-1' },
        });

        const fw24 = Fw24.getInstance();
        fw24.setApp(app);
        fw24.setConfig({
            name: 'test-app',
            region: 'us-east-1',
            account: '123456789012',
        });
        fw24.addStack('main', mainStack);
    });

    afterEach(() => {
        (Fw24 as any).instance = undefined;
        jest.restoreAllMocks();
    });

    describe('deployment', () => {
        it('does not create RestApi auto deployment when controllerParentStackName is set', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
                apiOptions: {
                    deployOptions: {
                        stageName: 'v1',
                    },
                },
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const template = Template.fromStack(mainStack);
            template.resourceCountIs('AWS::ApiGateway::Deployment', 0);
            template.resourceCountIs('AWS::ApiGateway::Stage', 0);
        });

        it('creates a single deployment after createSingleDeployment', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
                apiOptions: {
                    deployOptions: {
                        stageName: 'v1',
                    },
                },
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const fw24 = Fw24.getInstance();
            const controllerStackName = 'internal/team';
            fw24.getStack(controllerStackName, 'main');
            const nestedStack = fw24.getStack(controllerStackName) as NestedStack;

            const pingResource = apiConstruct.api.root
                .addResource('internal')
                .addResource('team')
                .addResource('ping');
            const pingMethod = pingResource.addMethod('GET', new MockIntegration({
                integrationResponses: [ { statusCode: '200' } ],
                passthroughBehavior: PassthroughBehavior.NEVER,
                requestTemplates: { 'application/json': '{"statusCode": 200}' },
            }), {
                methodResponses: [ { statusCode: '200' } ],
            });

            (apiConstruct as any).controllerStacks.set(controllerStackName, {
                methods: [ pingMethod ],
                resources: [ pingResource ],
                controllersHash: [ 'team-hash' ],
            });

            await (apiConstruct as any).createSingleDeployment();

            const template = Template.fromStack(mainStack);
            template.resourceCountIs('AWS::ApiGateway::Deployment', 1);
            template.hasResourceProperties('AWS::ApiGateway::Deployment', {
                StageName: 'v1',
            });

            const deployments = template.findResources('AWS::ApiGateway::Deployment');
            const deploymentDependsOn = Object.values(deployments)[ 0 ].DependsOn as string[] | undefined;
            expect(deploymentDependsOn?.some((dependency) => dependency.includes('internalteam'))).toBe(true);
            expect(nestedStack).toBeDefined();
        });
    });

    describe('setupNestedControllerRootResources', () => {
        it('marks shared roots for per-stack import without pre-binding a global Fn::ImportValue', async () => {
            const planSpy = jest.spyOn(nestedRootResources, 'planNestedControllerRootImports').mockResolvedValue([
                {
                    rootPath: 'internal',
                    exportName: buildNestedControllerRootExportName('test-app-main-stack', 'internal'),
                    controllerCount: 2,
                    strategy: 'import-from-export',
                },
            ]);

            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: false,
            });
            await apiConstruct.construct();

            const descriptors = [
                makeDescriptor('internal/notifications.ts', 'notifications'),
                makeDescriptor('internal/verify-access.ts', 'verify-access'),
            ];

            await (apiConstruct as any).setupNestedControllerRootResources(descriptors);

            const fw24 = Fw24.getInstance();
            const resourceId = fw24.getEnvironmentVariable(
                nestedRootResources.getNestedControllerRootResourceEnvKey('internal'),
                'resource',
                fw24.getStack('internal/notifications', 'main')
            );

            expect(planSpy).toHaveBeenCalledWith(descriptors, 'test-app-main-stack');
            expect(resourceId).toBeUndefined();
            expect((apiConstruct as any).nestedControllerRootsImportedFromExport.has('internal')).toBe(true);
        });

        it('does not mark roots for import when planning selects create-on-register', async () => {
            jest.spyOn(nestedRootResources, 'planNestedControllerRootImports').mockResolvedValue([
                {
                    rootPath: 'internal',
                    exportName: buildNestedControllerRootExportName('test-app-main-stack', 'internal'),
                    controllerCount: 2,
                    strategy: 'create-on-register',
                },
            ]);

            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: false,
            });
            await apiConstruct.construct();

            await (apiConstruct as any).setupNestedControllerRootResources([
                makeDescriptor('internal/notifications.ts', 'notifications'),
                makeDescriptor('internal/verify-access.ts', 'verify-access'),
            ]);

            expect((apiConstruct as any).nestedControllerRootsImportedFromExport.size).toBe(0);
        });
    });

    describe('root resources', () => {
        it('emits the same CloudFormation export name that import planning expects', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const internalResource = apiConstruct.api.root.addResource('internal');
            Fw24.getInstance().setConstructOutput(
                apiConstruct,
                'restAPI_controller_internal',
                internalResource,
                OutputType.RESOURCE,
                'resourceId'
            );

            const template = Template.fromStack(mainStack);
            template.hasOutput('*', {
                Export: {
                    Name: buildNestedControllerRootExportName(mainStack.stackName, 'internal'),
                },
            });
        });

        it('creates only the leaf resource in a nested stack when the shared root is imported', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const fw24 = Fw24.getInstance();
            const ownerStackName = 'internal/z-team';
            const controllerStackName = 'internal/notifications';
            fw24.getStack(ownerStackName, 'main');
            fw24.getStack(controllerStackName, 'main');

            (apiConstruct as any).nestedControllerRootsImportedFromExport.add('internal');
            (apiConstruct as any).nestedControllerRootImportPlans.set('internal', {
                rootPath: 'internal',
                exportName: buildNestedControllerRootExportName(mainStack.stackName, 'internal'),
                controllerCount: 2,
                strategy: 'import-from-export',
            });

            (apiConstruct as any).getOrCreateControllerResource('internal/team', ownerStackName);
            (apiConstruct as any).getOrCreateControllerResource('internal/notifications', controllerStackName);

            const nestedStack = fw24.getStack(controllerStackName) as NestedStack;
            const template = Template.fromStack(nestedStack);

            template.resourceCountIs('AWS::ApiGateway::Resource', 1);
            template.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'notifications',
            });
        });

        it('lets the first registrant claim an exported shared root without addResource', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const fw24 = Fw24.getInstance();
            const ownerStackName = 'internal/z-team';
            const controllerStackName = 'internal/notifications';
            fw24.getStack(ownerStackName, 'main');
            fw24.getStack(controllerStackName, 'main');

            (apiConstruct as any).nestedControllerRootsImportedFromExport.add('internal');
            (apiConstruct as any).nestedControllerRootImportPlans.set('internal', {
                rootPath: 'internal',
                exportName: buildNestedControllerRootExportName(mainStack.stackName, 'internal'),
                controllerCount: 2,
                strategy: 'import-from-export',
            });
            (apiConstruct as any).getOrCreateControllerResource('internal/team', ownerStackName);
            (apiConstruct as any).getOrCreateControllerResource('internal/notifications', controllerStackName);

            const ownerStack = fw24.getStack(ownerStackName) as NestedStack;
            const ownerTemplate = Template.fromStack(ownerStack);
            ownerTemplate.resourceCountIs('AWS::ApiGateway::Resource', 1);
            ownerTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'team',
            });

            const siblingStack = fw24.getStack(controllerStackName) as NestedStack;
            const siblingTemplate = Template.fromStack(siblingStack);
            siblingTemplate.resourceCountIs('AWS::ApiGateway::Resource', 1);
            siblingTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'notifications',
            });
        });

        it('avoids addResource on /internal when a later registrant claims the export first', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const fw24 = Fw24.getInstance();
            const ownerStackName = 'internal/z-user';
            const controllerStackName = 'internal/z-team';
            fw24.getStack(ownerStackName, 'main');
            fw24.getStack(controllerStackName, 'main');

            (apiConstruct as any).nestedControllerRootsImportedFromExport.add('internal');
            (apiConstruct as any).nestedControllerRootImportPlans.set('internal', {
                rootPath: 'internal',
                exportName: buildNestedControllerRootExportName(mainStack.stackName, 'internal'),
                controllerCount: 5,
                strategy: 'import-from-export',
            });
            (apiConstruct as any).getOrCreateControllerResource('internal/users', ownerStackName);
            (apiConstruct as any).getOrCreateControllerResource('internal/team', controllerStackName);

            const firstStack = fw24.getStack(ownerStackName) as NestedStack;
            const firstTemplate = Template.fromStack(firstStack);
            firstTemplate.resourceCountIs('AWS::ApiGateway::Resource', 1);
            firstTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'users',
            });

            const secondStack = fw24.getStack(controllerStackName) as NestedStack;
            const secondTemplate = Template.fromStack(secondStack);
            secondTemplate.resourceCountIs('AWS::ApiGateway::Resource', 1);
            secondTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'team',
            });
        });

        it('keeps addResource on an already-deployed owner when siblings are added', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const fw24 = Fw24.getInstance();
            const ownerStackName = 'internal/team';
            const siblingStackName = 'internal/notifications';
            fw24.getStack(ownerStackName, 'main');
            fw24.getStack(siblingStackName, 'main');

            (apiConstruct as any).nestedControllerRootsImportedFromExport.add('internal');
            (apiConstruct as any).nestedControllerRootImportPlans.set('internal', {
                rootPath: 'internal',
                exportName: buildNestedControllerRootExportName(mainStack.stackName, 'internal'),
                controllerCount: 2,
                strategy: 'import-from-export',
            });
            (apiConstruct as any).deployedNestedControllerRootOwners = new Map([ [ 'internal', ownerStackName ] ]);
            (apiConstruct as any).getOrCreateControllerResource('internal/team', ownerStackName);
            (apiConstruct as any).getOrCreateControllerResource('internal/notifications', siblingStackName);

            const ownerStack = fw24.getStack(ownerStackName) as NestedStack;
            const ownerTemplate = Template.fromStack(ownerStack);
            ownerTemplate.resourceCountIs('AWS::ApiGateway::Resource', 2);
            ownerTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'internal',
            });
            ownerTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'team',
            });

            const siblingStack = fw24.getStack(siblingStackName) as NestedStack;
            const siblingTemplate = Template.fromStack(siblingStack);
            siblingTemplate.resourceCountIs('AWS::ApiGateway::Resource', 1);
            siblingTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'notifications',
            });
        });

        it('creates both parent and leaf resources in a nested stack when no shared root import exists', async () => {
            const apiConstruct = new APIConstruct({
                controllerParentStackName: 'main',
                skipControllers: true,
                cors: true,
            });

            await apiConstruct.construct();
            addMinimalMethod(apiConstruct.api);

            const fw24 = Fw24.getInstance();
            const controllerStackName = 'internal/notifications';
            fw24.getStack(controllerStackName, 'main');

            (apiConstruct as any).getOrCreateControllerResource('internal/notifications', controllerStackName);

            const nestedStack = fw24.getStack(controllerStackName) as NestedStack;
            const template = Template.fromStack(nestedStack);

            template.resourceCountIs('AWS::ApiGateway::Resource', 2);
            template.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'internal',
            });
            template.hasResourceProperties('AWS::ApiGateway::Resource', {
                PathPart: 'notifications',
            });
        });
    });
});
