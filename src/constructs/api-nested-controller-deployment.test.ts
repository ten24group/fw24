import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MockIntegration, PassthroughBehavior, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { APIConstruct } from './api';
import { Fw24 } from '../core/fw24';

describe('APIConstruct nested controller deployment', () => {
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

    it('creates a single deployment and stage after createSingleDeployment', async () => {
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
