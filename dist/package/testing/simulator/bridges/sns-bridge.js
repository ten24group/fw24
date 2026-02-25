"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnsBridge = void 0;
const logging_1 = require("../../../logging");
const client_sns_1 = require("@aws-sdk/client-sns");
const client_sqs_1 = require("@aws-sdk/client-sqs");
class SnsBridge {
    lambdaRunner;
    name = 'SNS';
    logger = (0, logging_1.createLogger)(SnsBridge.name);
    subscriptions = [];
    lambdaConfigs = new Map();
    snsClient;
    sqsClient;
    interval;
    constructor(lambdaRunner) {
        this.lambdaRunner = lambdaRunner;
        this.snsClient = new client_sns_1.SNSClient({
            endpoint: 'http://localhost:4566',
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        });
        this.sqsClient = new client_sqs_1.SQSClient({
            endpoint: 'http://localhost:9324',
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        });
    }
    setLambdaConfigs(configs) {
        this.lambdaConfigs = configs;
    }
    setSubscriptions(subs) {
        this.subscriptions = subs;
    }
    async start() {
        this.logger.info("Starting SNS Bridge...");
        // Since we are mocking SNS, we could either poll local SNS or intercept calls.
        // For LocalStack-less, we'll implement a simple in-memory relay if needed,
        // but if we use a sidecar for SNS (LocalStack), we'd need to poll it or use its triggers.
        // However, user said "no LocalStack".
        // If I use a sidecar like softwaremill/elasticmq for SQS, it doesn't do SNS.
        // So for SNS I'll implement a small Express mock for Publish and Relay.
    }
    async stop() {
        if (this.interval)
            clearInterval(this.interval);
    }
    // This would be called by SimulatorCoordinator when it detects a Publish action to its own mock SNS
    async relayPublish(topicArn, message, messageAttributes) {
        this.logger.info(`Relaying SNS Publish for ${topicArn}`);
        const targets = this.subscriptions.filter(s => s.topicArn === topicArn);
        for (const target of targets) {
            if (target.protocol === 'lambda') {
                const lambdaId = target.endpoint.split(':').pop();
                const config = this.lambdaConfigs.get(lambdaId);
                if (config) {
                    await this.lambdaRunner.runHandler(config.entry, config.handlerClassName, {
                        Records: [{
                                EventSource: 'aws:sns',
                                Sns: {
                                    TopicArn: topicArn,
                                    Message: message,
                                    MessageAttributes: messageAttributes
                                }
                            }]
                    }, {}, config.environment);
                }
            }
            else if (target.protocol === 'sqs') {
                const queueName = target.endpoint.split(':').pop();
                await this.sqsClient.send(new client_sqs_1.SendMessageCommand({
                    QueueUrl: `http://localhost:9324/queue/${queueName}`,
                    MessageBody: JSON.stringify({
                        Type: 'Notification',
                        TopicArn: topicArn,
                        Message: message,
                        MessageAttributes: messageAttributes
                    })
                }));
            }
        }
    }
}
exports.SnsBridge = SnsBridge;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic25zLWJyaWRnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL3NpbXVsYXRvci9icmlkZ2VzL3Nucy1icmlkZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOENBQWdEO0FBQ2hELG9EQUFrRjtBQUNsRixvREFBb0U7QUFTcEUsTUFBYSxTQUFTO0lBU1c7SUFScEIsSUFBSSxHQUFHLEtBQUssQ0FBQztJQUNMLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9DLGFBQWEsR0FBc0IsRUFBRSxDQUFDO0lBQ3RDLGFBQWEsR0FBcUIsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUM1QyxTQUFTLENBQVk7SUFDckIsU0FBUyxDQUFZO0lBQ3JCLFFBQVEsQ0FBa0I7SUFFbEMsWUFBNkIsWUFBMkI7UUFBM0IsaUJBQVksR0FBWixZQUFZLENBQWU7UUFDcEQsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUM7WUFDM0IsUUFBUSxFQUFFLHVCQUF1QjtZQUNqQyxNQUFNLEVBQUUsV0FBVztZQUNuQixXQUFXLEVBQUUsRUFBRSxXQUFXLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUU7U0FDbEUsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUM7WUFDM0IsUUFBUSxFQUFFLHVCQUF1QjtZQUNqQyxNQUFNLEVBQUUsV0FBVztZQUNuQixXQUFXLEVBQUUsRUFBRSxXQUFXLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUU7U0FDbEUsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELGdCQUFnQixDQUFDLE9BQXlCO1FBQ3RDLElBQUksQ0FBQyxhQUFhLEdBQUcsT0FBTyxDQUFDO0lBQ2pDLENBQUM7SUFFRCxnQkFBZ0IsQ0FBQyxJQUF1QjtRQUNwQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQztJQUM5QixDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDUCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO1FBQzNDLCtFQUErRTtRQUMvRSwyRUFBMkU7UUFDM0UsMEZBQTBGO1FBRTFGLHVDQUF1QztRQUN2Qyw2RUFBNkU7UUFDN0Usd0VBQXdFO0lBQzVFLENBQUM7SUFFRCxLQUFLLENBQUMsSUFBSTtRQUNOLElBQUksSUFBSSxDQUFDLFFBQVE7WUFBRSxhQUFhLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3BELENBQUM7SUFFRCxvR0FBb0c7SUFDcEcsS0FBSyxDQUFDLFlBQVksQ0FBQyxRQUFnQixFQUFFLE9BQWUsRUFBRSxpQkFBdUI7UUFDekUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsNEJBQTRCLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFDekQsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxLQUFLLFFBQVEsQ0FBQyxDQUFDO1FBRXhFLEtBQUssTUFBTSxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7WUFDM0IsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUMvQixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUcsQ0FBQztnQkFDbkQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQ2hELElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ1QsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FDOUIsTUFBTSxDQUFDLEtBQUssRUFDWixNQUFNLENBQUMsZ0JBQWdCLEVBQ3ZCO3dCQUNJLE9BQU8sRUFBRSxDQUFDO2dDQUNOLFdBQVcsRUFBRSxTQUFTO2dDQUN0QixHQUFHLEVBQUU7b0NBQ0QsUUFBUSxFQUFFLFFBQVE7b0NBQ2xCLE9BQU8sRUFBRSxPQUFPO29DQUNoQixpQkFBaUIsRUFBRSxpQkFBaUI7aUNBQ3ZDOzZCQUNKLENBQUM7cUJBQ0wsRUFDRCxFQUFFLEVBQ0YsTUFBTSxDQUFDLFdBQVcsQ0FDckIsQ0FBQztnQkFDTixDQUFDO1lBQ0wsQ0FBQztpQkFBTSxJQUFJLE1BQU0sQ0FBQyxRQUFRLEtBQUssS0FBSyxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRyxDQUFDO2dCQUNwRCxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksK0JBQWtCLENBQUM7b0JBQzdDLFFBQVEsRUFBRSwrQkFBK0IsU0FBUyxFQUFFO29CQUNwRCxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQzt3QkFDeEIsSUFBSSxFQUFFLGNBQWM7d0JBQ3BCLFFBQVEsRUFBRSxRQUFRO3dCQUNsQixPQUFPLEVBQUUsT0FBTzt3QkFDaEIsaUJBQWlCLEVBQUUsaUJBQWlCO3FCQUN2QyxDQUFDO2lCQUNMLENBQUMsQ0FBQyxDQUFDO1lBQ1IsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUF0RkQsOEJBc0ZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSUJyaWRnZSwgSUxhbWJkYVJ1bm5lciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBTTlNDbGllbnQsIFN1YnNjcmliZUNvbW1hbmQsIFB1Ymxpc2hDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XG5pbXBvcnQgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNuc1N1YnNjcmlwdGlvbiB7XG4gICAgaWQ6IHN0cmluZztcbiAgICB0b3BpY0Fybjogc3RyaW5nO1xuICAgIGVuZHBvaW50OiBzdHJpbmc7XG4gICAgcHJvdG9jb2w6ICdsYW1iZGEnIHwgJ3NxcycgfCAnZW1haWwnO1xufVxuXG5leHBvcnQgY2xhc3MgU25zQnJpZGdlIGltcGxlbWVudHMgSUJyaWRnZSB7XG4gICAgcmVhZG9ubHkgbmFtZSA9ICdTTlMnO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFNuc0JyaWRnZS5uYW1lKTtcbiAgICBwcml2YXRlIHN1YnNjcmlwdGlvbnM6IFNuc1N1YnNjcmlwdGlvbltdID0gW107XG4gICAgcHJpdmF0ZSBsYW1iZGFDb25maWdzOiBNYXA8c3RyaW5nLCBhbnk+ID0gbmV3IE1hcCgpO1xuICAgIHByaXZhdGUgc25zQ2xpZW50OiBTTlNDbGllbnQ7XG4gICAgcHJpdmF0ZSBzcXNDbGllbnQ6IFNRU0NsaWVudDtcbiAgICBwcml2YXRlIGludGVydmFsPzogTm9kZUpTLlRpbWVvdXQ7XG5cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGxhbWJkYVJ1bm5lcjogSUxhbWJkYVJ1bm5lcikge1xuICAgICAgICB0aGlzLnNuc0NsaWVudCA9IG5ldyBTTlNDbGllbnQoe1xuICAgICAgICAgICAgZW5kcG9pbnQ6ICdodHRwOi8vbG9jYWxob3N0OjQ1NjYnLFxuICAgICAgICAgICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICAgICAgICAgIGNyZWRlbnRpYWxzOiB7IGFjY2Vzc0tleUlkOiAnbG9jYWwnLCBzZWNyZXRBY2Nlc3NLZXk6ICdsb2NhbCcgfVxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KHtcbiAgICAgICAgICAgIGVuZHBvaW50OiAnaHR0cDovL2xvY2FsaG9zdDo5MzI0JyxcbiAgICAgICAgICAgIHJlZ2lvbjogJ3VzLWVhc3QtMScsXG4gICAgICAgICAgICBjcmVkZW50aWFsczogeyBhY2Nlc3NLZXlJZDogJ2xvY2FsJywgc2VjcmV0QWNjZXNzS2V5OiAnbG9jYWwnIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgc2V0TGFtYmRhQ29uZmlncyhjb25maWdzOiBNYXA8c3RyaW5nLCBhbnk+KSB7XG4gICAgICAgIHRoaXMubGFtYmRhQ29uZmlncyA9IGNvbmZpZ3M7XG4gICAgfVxuXG4gICAgc2V0U3Vic2NyaXB0aW9ucyhzdWJzOiBTbnNTdWJzY3JpcHRpb25bXSkge1xuICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMgPSBzdWJzO1xuICAgIH1cblxuICAgIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiU3RhcnRpbmcgU05TIEJyaWRnZS4uLlwiKTtcbiAgICAgICAgLy8gU2luY2Ugd2UgYXJlIG1vY2tpbmcgU05TLCB3ZSBjb3VsZCBlaXRoZXIgcG9sbCBsb2NhbCBTTlMgb3IgaW50ZXJjZXB0IGNhbGxzLlxuICAgICAgICAvLyBGb3IgTG9jYWxTdGFjay1sZXNzLCB3ZSdsbCBpbXBsZW1lbnQgYSBzaW1wbGUgaW4tbWVtb3J5IHJlbGF5IGlmIG5lZWRlZCxcbiAgICAgICAgLy8gYnV0IGlmIHdlIHVzZSBhIHNpZGVjYXIgZm9yIFNOUyAoTG9jYWxTdGFjayksIHdlJ2QgbmVlZCB0byBwb2xsIGl0IG9yIHVzZSBpdHMgdHJpZ2dlcnMuXG4gICAgICAgIFxuICAgICAgICAvLyBIb3dldmVyLCB1c2VyIHNhaWQgXCJubyBMb2NhbFN0YWNrXCIuIFxuICAgICAgICAvLyBJZiBJIHVzZSBhIHNpZGVjYXIgbGlrZSBzb2Z0d2FyZW1pbGwvZWxhc3RpY21xIGZvciBTUVMsIGl0IGRvZXNuJ3QgZG8gU05TLlxuICAgICAgICAvLyBTbyBmb3IgU05TIEknbGwgaW1wbGVtZW50IGEgc21hbGwgRXhwcmVzcyBtb2NrIGZvciBQdWJsaXNoIGFuZCBSZWxheS5cbiAgICB9XG5cbiAgICBhc3luYyBzdG9wKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAodGhpcy5pbnRlcnZhbCkgY2xlYXJJbnRlcnZhbCh0aGlzLmludGVydmFsKTtcbiAgICB9XG5cbiAgICAvLyBUaGlzIHdvdWxkIGJlIGNhbGxlZCBieSBTaW11bGF0b3JDb29yZGluYXRvciB3aGVuIGl0IGRldGVjdHMgYSBQdWJsaXNoIGFjdGlvbiB0byBpdHMgb3duIG1vY2sgU05TXG4gICAgYXN5bmMgcmVsYXlQdWJsaXNoKHRvcGljQXJuOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZywgbWVzc2FnZUF0dHJpYnV0ZXM/OiBhbnkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUmVsYXlpbmcgU05TIFB1Ymxpc2ggZm9yICR7dG9waWNBcm59YCk7XG4gICAgICAgIGNvbnN0IHRhcmdldHMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZmlsdGVyKHMgPT4gcy50b3BpY0FybiA9PT0gdG9waWNBcm4pO1xuXG4gICAgICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRhcmdldHMpIHtcbiAgICAgICAgICAgIGlmICh0YXJnZXQucHJvdG9jb2wgPT09ICdsYW1iZGEnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhSWQgPSB0YXJnZXQuZW5kcG9pbnQuc3BsaXQoJzonKS5wb3AoKSE7XG4gICAgICAgICAgICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5sYW1iZGFDb25maWdzLmdldChsYW1iZGFJZCk7XG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZykge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxhbWJkYVJ1bm5lci5ydW5IYW5kbGVyKFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLmVudHJ5LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLmhhbmRsZXJDbGFzc05hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUmVjb3JkczogW3tcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgRXZlbnRTb3VyY2U6ICdhd3M6c25zJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgU25zOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUb3BpY0FybjogdG9waWNBcm4sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNZXNzYWdlOiBtZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTWVzc2FnZUF0dHJpYnV0ZXM6IG1lc3NhZ2VBdHRyaWJ1dGVzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHt9LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLmVudmlyb25tZW50XG4gICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQucHJvdG9jb2wgPT09ICdzcXMnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcXVldWVOYW1lID0gdGFyZ2V0LmVuZHBvaW50LnNwbGl0KCc6JykucG9wKCkhO1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgIFF1ZXVlVXJsOiBgaHR0cDovL2xvY2FsaG9zdDo5MzI0L3F1ZXVlLyR7cXVldWVOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgIE1lc3NhZ2VCb2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgICAgICBUeXBlOiAnTm90aWZpY2F0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIFRvcGljQXJuOiB0b3BpY0FybixcbiAgICAgICAgICAgICAgICAgICAgICAgIE1lc3NhZ2U6IG1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBNZXNzYWdlQXR0cmlidXRlczogbWVzc2FnZUF0dHJpYnV0ZXNcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4iXX0=