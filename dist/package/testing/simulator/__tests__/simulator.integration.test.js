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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const coordinator_1 = require("../coordinator");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
describe('Simulator Integration (CDK-First)', () => {
    let coordinator;
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
        coordinator = new coordinator_1.SimulatorCoordinator({ port: 3020 });
        const mockRunner = coordinator.getLambdaRunner();
        mockRunner.runHandler = jest.fn().mockResolvedValue({
            statusCode: 200,
            body: JSON.stringify({ message: "Mock Success" })
        });
        coordinator.sidecarManager.startDynamoDB = jest.fn();
        coordinator.sidecarManager.initResources = jest.fn();
        await coordinator.syncWithCDK(cdkOutDir);
        await coordinator.start();
        const response = await axios_1.default.get('http://localhost:3020/hello');
        expect(response.status).toBe(200);
        expect(response.data.message).toBe("Mock Success");
        expect(mockRunner.runHandler).toHaveBeenCalledWith(expect.stringContaining('asset.123'), 'handler', expect.anything(), expect.anything(), expect.objectContaining({ FOO: "BAR" }));
        await coordinator.stop();
    });
    it('should simulate SNS fan-out to SQS', async () => {
        coordinator = new coordinator_1.SimulatorCoordinator({ port: 3021, snsPort: 4568 });
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
        coordinator.snsBridge.setSubscriptions(subscriptions);
        coordinator.snsBridge.sqsClient.send = jest.fn().mockResolvedValue({});
        // 2. Trigger Publish to mock SNS
        await coordinator.snsBridge.relayPublish('arn:aws:sns:local:topic-1', 'test message');
        // 3. Verify SQS client was called by SNS Bridge
        const { SendMessageCommand } = require('@aws-sdk/client-sqs');
        expect(coordinator.snsBridge.sqsClient.send).toHaveBeenCalledWith(expect.any(SendMessageCommand));
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2ltdWxhdG9yLmludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvdGVzdGluZy9zaW11bGF0b3IvX190ZXN0c19fL3NpbXVsYXRvci5pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQXNEO0FBQ3RELHVDQUF5QjtBQUN6QiwyQ0FBNkI7QUFDN0Isa0RBQTBCO0FBRTFCLFFBQVEsQ0FBQyxtQ0FBbUMsRUFBRSxHQUFHLEVBQUU7SUFDL0MsSUFBSSxXQUFpQyxDQUFDO0lBQ3RDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLGlCQUFpQixDQUFDLENBQUM7SUFFOUQsU0FBUyxDQUFDLEtBQUssSUFBSSxFQUFFO1FBQ2pCLElBQUksQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDN0IsRUFBRSxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNsRCxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsR0FBRyxFQUFFO1FBQ1YsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDNUIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQzVELENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxxRUFBcUUsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNqRixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUNuRCxF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Q0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBQzlELE1BQU0sQ0FBRSxXQUFtQixDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsb0JBQW9CLENBQ3RFLE1BQU0sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FDakMsQ0FBQztJQUNOLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTaW11bGF0b3JDb29yZGluYXRvciB9IGZyb20gJy4uL2Nvb3JkaW5hdG9yJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuXG5kZXNjcmliZSgnU2ltdWxhdG9yIEludGVncmF0aW9uIChDREstRmlyc3QpJywgKCkgPT4ge1xuICAgIGxldCBjb29yZGluYXRvcjogU2ltdWxhdG9yQ29vcmRpbmF0b3I7XG4gICAgY29uc3QgdGVzdEFwcERpciA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICd0ZXN0LWFwcC1zdGFibGUnKTtcblxuICAgIGJlZm9yZUFsbChhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICghZnMuZXhpc3RzU3luYyh0ZXN0QXBwRGlyKSkge1xuICAgICAgICAgICAgZnMubWtkaXJTeW5jKHRlc3RBcHBEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBhZnRlckFsbCgoKSA9PiB7XG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKHRlc3RBcHBEaXIpKSB7XG4gICAgICAgICAgICBmcy5ybVN5bmModGVzdEFwcERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHBhcnNlIENESyB0ZW1wbGF0ZSBhbmQgcm91dGUgcmVxdWVzdHMgdG8gbW9ja2VkIExhbWJkYVJ1bm5lcicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY2RrT3V0RGlyID0gcGF0aC5qb2luKHRlc3RBcHBEaXIsICdjZGsub3V0Jyk7XG4gICAgICAgIGZzLm1rZGlyU3luYyhjZGtPdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgbWFuaWZlc3QgPSB7XG4gICAgICAgICAgICBhcnRpZmFjdHM6IHtcbiAgICAgICAgICAgICAgICB0ZXN0U3RhY2s6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJhd3M6Y2xvdWRmb3JtYXRpb246c3RhY2tcIixcbiAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczogeyB0ZW1wbGF0ZUZpbGU6IFwidGVzdC50ZW1wbGF0ZS5qc29uXCIgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhwYXRoLmpvaW4oY2RrT3V0RGlyLCAnbWFuaWZlc3QuanNvbicpLCBKU09OLnN0cmluZ2lmeShtYW5pZmVzdCkpO1xuXG4gICAgICAgIGNvbnN0IHRlbXBsYXRlID0ge1xuICAgICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICAgICAgTXlMYW1iZGE6IHtcbiAgICAgICAgICAgICAgICAgICAgVHlwZTogXCJBV1M6OkxhbWJkYTo6RnVuY3Rpb25cIixcbiAgICAgICAgICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGFuZGxlcjogXCJpbmRleC5oYW5kbGVyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBSdW50aW1lOiBcIm5vZGVqczE4LnhcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIEVudmlyb25tZW50OiB7IFZhcmlhYmxlczogeyBGT086IFwiQkFSXCIgfSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIE1ldGFkYXRhOiB7IFwiYXdzOmFzc2V0OnBhdGhcIjogXCJhc3NldC4xMjNcIiB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBNeUFwaVJlc291cmNlOiB7XG4gICAgICAgICAgICAgICAgICAgIFR5cGU6IFwiQVdTOjpBcGlHYXRld2F5OjpSZXNvdXJjZVwiLFxuICAgICAgICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7IFBhdGhQYXJ0OiBcImhlbGxvXCIsIFBhcmVudElkOiB7IFJlZjogXCJSb290XCIgfSB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBNeUFwaU1ldGhvZDoge1xuICAgICAgICAgICAgICAgICAgICBUeXBlOiBcIkFXUzo6QXBpR2F0ZXdheTo6TWV0aG9kXCIsXG4gICAgICAgICAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEh0dHBNZXRob2Q6IFwiR0VUXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBSZXNvdXJjZUlkOiB7IFJlZjogXCJNeUFwaVJlc291cmNlXCIgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIEludGVncmF0aW9uOiB7IFVyaTogeyBcIkZuOjpKb2luXCI6IFtcIlwiLCBbXCJhcm46YXdzOmFwaWdhdGV3YXk6Li4uXCIsIHsgUmVmOiBcIk15TGFtYmRhXCIgfV1dIH0gfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHBhdGguam9pbihjZGtPdXREaXIsICd0ZXN0LnRlbXBsYXRlLmpzb24nKSwgSlNPTi5zdHJpbmdpZnkodGVtcGxhdGUpKTtcblxuICAgICAgICBjb29yZGluYXRvciA9IG5ldyBTaW11bGF0b3JDb29yZGluYXRvcih7IHBvcnQ6IDMwMjAgfSk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBtb2NrUnVubmVyID0gY29vcmRpbmF0b3IuZ2V0TGFtYmRhUnVubmVyKCk7XG4gICAgICAgIG1vY2tSdW5uZXIucnVuSGFuZGxlciA9IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6IFwiTW9jayBTdWNjZXNzXCIgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgKGNvb3JkaW5hdG9yIGFzIGFueSkuc2lkZWNhck1hbmFnZXIuc3RhcnREeW5hbW9EQiA9IGplc3QuZm4oKTtcbiAgICAgICAgKGNvb3JkaW5hdG9yIGFzIGFueSkuc2lkZWNhck1hbmFnZXIuaW5pdFJlc291cmNlcyA9IGplc3QuZm4oKTtcblxuICAgICAgICBhd2FpdCBjb29yZGluYXRvci5zeW5jV2l0aENESyhjZGtPdXREaXIpO1xuICAgICAgICBhd2FpdCBjb29yZGluYXRvci5zdGFydCgpO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KCdodHRwOi8vbG9jYWxob3N0OjMwMjAvaGVsbG8nKTtcbiAgICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cykudG9CZSgyMDApO1xuICAgICAgICBleHBlY3QocmVzcG9uc2UuZGF0YS5tZXNzYWdlKS50b0JlKFwiTW9jayBTdWNjZXNzXCIpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrUnVubmVyLnJ1bkhhbmRsZXIpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgICAgZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ2Fzc2V0LjEyMycpLFxuICAgICAgICAgICAgJ2hhbmRsZXInLFxuICAgICAgICAgICAgZXhwZWN0LmFueXRoaW5nKCksXG4gICAgICAgICAgICBleHBlY3QuYW55dGhpbmcoKSxcbiAgICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgRk9POiBcIkJBUlwiIH0pXG4gICAgICAgICk7XG5cbiAgICAgICAgYXdhaXQgY29vcmRpbmF0b3Iuc3RvcCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzaW11bGF0ZSBTTlMgZmFuLW91dCB0byBTUVMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvb3JkaW5hdG9yID0gbmV3IFNpbXVsYXRvckNvb3JkaW5hdG9yKHsgcG9ydDogMzAyMSwgc25zUG9ydDogNDU2OCB9KTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IG1vY2tSdW5uZXIgPSBjb29yZGluYXRvci5nZXRMYW1iZGFSdW5uZXIoKTtcbiAgICAgICAgbW9ja1J1bm5lci5ydW5IYW5kbGVyID0gamVzdC5mbigpO1xuXG4gICAgICAgIC8vIDEuIFNldHVwIHN1YnNjcmlwdGlvbiBtZXRhZGF0YVxuICAgICAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnc3ViLTEnLFxuICAgICAgICAgICAgICAgIHRvcGljQXJuOiAnYXJuOmF3czpzbnM6bG9jYWw6dG9waWMtMScsXG4gICAgICAgICAgICAgICAgZW5kcG9pbnQ6ICdhcm46YXdzOnNxczpsb2NhbDpxdWV1ZS0xJyxcbiAgICAgICAgICAgICAgICBwcm90b2NvbDogJ3NxcydcbiAgICAgICAgICAgIH1cbiAgICAgICAgXTtcbiAgICAgICAgXG4gICAgICAgIChjb29yZGluYXRvciBhcyBhbnkpLnNuc0JyaWRnZS5zZXRTdWJzY3JpcHRpb25zKHN1YnNjcmlwdGlvbnMpO1xuICAgICAgICAoY29vcmRpbmF0b3IgYXMgYW55KS5zbnNCcmlkZ2Uuc3FzQ2xpZW50LnNlbmQgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xuXG4gICAgICAgIC8vIDIuIFRyaWdnZXIgUHVibGlzaCB0byBtb2NrIFNOU1xuICAgICAgICBhd2FpdCAoY29vcmRpbmF0b3IgYXMgYW55KS5zbnNCcmlkZ2UucmVsYXlQdWJsaXNoKCdhcm46YXdzOnNuczpsb2NhbDp0b3BpYy0xJywgJ3Rlc3QgbWVzc2FnZScpO1xuXG4gICAgICAgIC8vIDMuIFZlcmlmeSBTUVMgY2xpZW50IHdhcyBjYWxsZWQgYnkgU05TIEJyaWRnZVxuICAgICAgICBjb25zdCB7IFNlbmRNZXNzYWdlQ29tbWFuZCB9ID0gcmVxdWlyZSgnQGF3cy1zZGsvY2xpZW50LXNxcycpO1xuICAgICAgICBleHBlY3QoKGNvb3JkaW5hdG9yIGFzIGFueSkuc25zQnJpZGdlLnNxc0NsaWVudC5zZW5kKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgICAgIGV4cGVjdC5hbnkoU2VuZE1lc3NhZ2VDb21tYW5kKVxuICAgICAgICApO1xuICAgIH0pO1xufSk7XG4iXX0=