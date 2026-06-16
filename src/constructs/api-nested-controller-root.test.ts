import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MockIntegration, PassthroughBehavior, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { APIConstruct } from './api';
import { Fw24 } from '../core/fw24';
import { OutputType } from '../interfaces/construct';
import { buildNestedControllerRootExportName } from './nested-controller-root-resources';

describe('APIConstruct nested controller root resources', () => {
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
    });

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
