import { SimulatorCoordinator } from '../coordinator';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

describe('Simulator Integration (CDK-First)', () => {
    let coordinator: SimulatorCoordinator;
    const testAppDir = path.resolve(__dirname, 'test-app-stable');

    beforeAll(async () => {
        if (!fs.existsSync(testAppDir)) {
            fs.mkdirSync(testAppDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(testAppDir)) {
            fs.rmSync(testAppDir, { recursive: true, force: true });
        }
    });

    it('should parse CDK template and route requests to mocked LambdaRunner', async () => {
        const cdkOutDir = path.join(testAppDir, 'cdk.out');
        fs.mkdirSync(cdkOutDir, { recursive: true });

        const manifest = {
            artifacts: {
                testStack: {
                    type: "aws:cloudformation:stack",
                    properties: { templateFile: "test.template.json" }
                }
            }
        };
        fs.writeFileSync(path.join(cdkOutDir, 'manifest.json'), JSON.stringify(manifest));

        const template = {
            Resources: {
                MyLambda: {
                    Type: "AWS::Lambda::Function",
                    Properties: {
                        Handler: "index.handler",
                        Runtime: "nodejs18.x",
                        Environment: { Variables: { FOO: "BAR" } }
                    },
                    Metadata: { "aws:asset:path": "asset.123" }
                },
                MyApiResource: {
                    Type: "AWS::ApiGateway::Resource",
                    Properties: { PathPart: "hello", ParentId: { Ref: "Root" } }
                },
                MyApiMethod: {
                    Type: "AWS::ApiGateway::Method",
                    Properties: {
                        HttpMethod: "GET",
                        ResourceId: { Ref: "MyApiResource" },
                        Integration: { Uri: { "Fn::Join": ["", ["arn:aws:apigateway:...", { Ref: "MyLambda" }]] } }
                    }
                }
            }
        };
        fs.writeFileSync(path.join(cdkOutDir, 'test.template.json'), JSON.stringify(template));

        coordinator = new SimulatorCoordinator({ port: 3020 });

        const mockRunner = coordinator.getLambdaRunner();
        mockRunner.runHandler = jest.fn().mockResolvedValue({
            statusCode: 200,
            body: JSON.stringify({ message: "Mock Success" })
        });

        (coordinator as any).sidecarManager.startDynamoDB = jest.fn();
        (coordinator as any).sidecarManager.initResources = jest.fn();

        await coordinator.syncWithCDK(cdkOutDir);
        await coordinator.start();

        const response = await axios.get('http://localhost:3020/hello');
        expect(response.status).toBe(200);
        expect(response.data.message).toBe("Mock Success");

        expect(mockRunner.runHandler).toHaveBeenCalledWith(
            expect.stringContaining('asset.123'),
            'handler',
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ FOO: "BAR" })
        );

        await coordinator.stop();
    });

    it('should simulate SNS fan-out to SQS', async () => {
        coordinator = new SimulatorCoordinator({ port: 3021, snsPort: 4568 });

        const mockRunner = coordinator.getLambdaRunner();
        mockRunner.runHandler = jest.fn();

        // 1. Setup subscription metadata
        const subscriptions = [
            {
                id: 'sub-1',
                topicArn: 'arn:aws:sns:local:topic-1',
                endpoint: 'arn:aws:sqs:local:queue-1',
                protocol: 'sqs'
            }
        ];

        (coordinator as any).snsBridge.setSubscriptions(subscriptions);
        (coordinator as any).snsBridge.sqsClient.send = jest.fn().mockResolvedValue({});

        // 2. Trigger Publish to mock SNS
        await (coordinator as any).snsBridge.relayPublish('arn:aws:sns:local:topic-1', 'test message');

        // 3. Verify SQS client was called by SNS Bridge
        const { SendMessageCommand } = require('@aws-sdk/client-sqs');
        expect((coordinator as any).snsBridge.sqsClient.send).toHaveBeenCalledWith(
            expect.any(SendMessageCommand)
        );
    });
});
