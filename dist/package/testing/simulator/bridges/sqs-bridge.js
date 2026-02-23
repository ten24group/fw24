"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqsBridge = void 0;
const logging_1 = require("../../../logging");
class SqsBridge {
    lambdaRunner;
    sqsEmulator;
    name = 'SQS';
    logger = (0, logging_1.createLogger)(SqsBridge.name);
    interval;
    subscriptions = [];
    lambdaConfigs = new Map();
    constructor(lambdaRunner, sqsEmulator // We'll need to access the in-memory queues
    ) {
        this.lambdaRunner = lambdaRunner;
        this.sqsEmulator = sqsEmulator;
    }
    setLambdaConfigs(configs) {
        this.lambdaConfigs = configs;
    }
    setSubscriptions(subs) {
        this.subscriptions = subs;
    }
    async start() {
        this.logger.info("Starting SQS Bridge...");
        // Simple polling mechanism for the in-memory SQS emulator
        this.interval = setInterval(async () => {
            for (const sub of this.subscriptions) {
                const messages = this.sqsEmulator.getMessages?.(sub.queueName);
                if (messages && messages.length > 0) {
                    this.logger.info(`SQS Bridge: Found ${messages.length} messages for ${sub.queueName}`);
                    // Take one message (or all) and process
                    const message = messages.shift();
                    try {
                        const lambdaConfig = this.lambdaConfigs.get(sub.handlerId);
                        if (!lambdaConfig) {
                            this.logger.error(`Lambda configuration not found for ID: ${sub.handlerId}`);
                            continue;
                        }
                        const event = {
                            Records: [
                                {
                                    messageId: message.id,
                                    body: message.body,
                                    eventSource: 'aws:sqs'
                                }
                            ]
                        };
                        await this.lambdaRunner.runHandler(lambdaConfig.entry, lambdaConfig.handlerClassName, event, {}, lambdaConfig.environment);
                    }
                    catch (error) {
                        this.logger.error(`Error processing SQS message for ${sub.queueName}:`, error);
                        // Put message back? (Simple mock doesn't handle retries well)
                    }
                }
            }
        }, 1000);
    }
    async stop() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}
exports.SqsBridge = SqsBridge;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWJyaWRnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL3NpbXVsYXRvci9icmlkZ2VzL3Nxcy1icmlkZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOENBQWdEO0FBT2hELE1BQWEsU0FBUztJQVFHO0lBQ0E7SUFSWixJQUFJLEdBQUcsS0FBSyxDQUFDO0lBQ0wsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDL0MsUUFBUSxDQUFrQjtJQUMxQixhQUFhLEdBQXNCLEVBQUUsQ0FBQztJQUN0QyxhQUFhLEdBQXFCLElBQUksR0FBRyxFQUFFLENBQUM7SUFFcEQsWUFDcUIsWUFBMkIsRUFDM0IsV0FBZ0IsQ0FBQyw0Q0FBNEM7O1FBRDdELGlCQUFZLEdBQVosWUFBWSxDQUFlO1FBQzNCLGdCQUFXLEdBQVgsV0FBVyxDQUFLO0lBQ2xDLENBQUM7SUFFSixnQkFBZ0IsQ0FBQyxPQUF5QjtRQUN0QyxJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQztJQUNqQyxDQUFDO0lBRUQsZ0JBQWdCLENBQUMsSUFBdUI7UUFDcEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUM7SUFDOUIsQ0FBQztJQUVELEtBQUssQ0FBQyxLQUFLO1FBQ1AsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUUzQywwREFBMEQ7UUFDMUQsSUFBSSxDQUFDLFFBQVEsR0FBRyxXQUFXLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDbkMsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVyxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUMvRCxJQUFJLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUNsQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsUUFBUSxDQUFDLE1BQU0saUJBQWlCLEdBQUcsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO29CQUV2Rix3Q0FBd0M7b0JBQ3hDLE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztvQkFFakMsSUFBSSxDQUFDO3dCQUNELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQzt3QkFDM0QsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDOzRCQUNoQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQywwQ0FBMEMsR0FBRyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7NEJBQzdFLFNBQVM7d0JBQ2IsQ0FBQzt3QkFFRCxNQUFNLEtBQUssR0FBRzs0QkFDVixPQUFPLEVBQUU7Z0NBQ0w7b0NBQ0ksU0FBUyxFQUFFLE9BQU8sQ0FBQyxFQUFFO29DQUNyQixJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUk7b0NBQ2xCLFdBQVcsRUFBRSxTQUFTO2lDQUN6Qjs2QkFDSjt5QkFDSixDQUFDO3dCQUVGLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQzlCLFlBQVksQ0FBQyxLQUFLLEVBQ2xCLFlBQVksQ0FBQyxnQkFBZ0IsRUFDN0IsS0FBSyxFQUNMLEVBQUUsRUFDRixZQUFZLENBQUMsV0FBVyxDQUMzQixDQUFDO29CQUNOLENBQUM7b0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQzt3QkFDYixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxvQ0FBb0MsR0FBRyxDQUFDLFNBQVMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO3dCQUMvRSw4REFBOEQ7b0JBQ2xFLENBQUM7Z0JBQ0wsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDYixDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUk7UUFDTixJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNoQixhQUFhLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2pDLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUF2RUQsOEJBdUVDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSUJyaWRnZSwgSUxhbWJkYVJ1bm5lciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vLi4vbG9nZ2luZyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3FzU3Vic2NyaXB0aW9uIHtcbiAgICBxdWV1ZU5hbWU6IHN0cmluZztcbiAgICBoYW5kbGVySWQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFNxc0JyaWRnZSBpbXBsZW1lbnRzIElCcmlkZ2Uge1xuICAgIHJlYWRvbmx5IG5hbWUgPSAnU1FTJztcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihTcXNCcmlkZ2UubmFtZSk7XG4gICAgcHJpdmF0ZSBpbnRlcnZhbD86IE5vZGVKUy5UaW1lb3V0O1xuICAgIHByaXZhdGUgc3Vic2NyaXB0aW9uczogU3FzU3Vic2NyaXB0aW9uW10gPSBbXTtcbiAgICBwcml2YXRlIGxhbWJkYUNvbmZpZ3M6IE1hcDxzdHJpbmcsIGFueT4gPSBuZXcgTWFwKCk7XG5cbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcHJpdmF0ZSByZWFkb25seSBsYW1iZGFSdW5uZXI6IElMYW1iZGFSdW5uZXIsXG4gICAgICAgIHByaXZhdGUgcmVhZG9ubHkgc3FzRW11bGF0b3I6IGFueSAvLyBXZSdsbCBuZWVkIHRvIGFjY2VzcyB0aGUgaW4tbWVtb3J5IHF1ZXVlc1xuICAgICkge31cblxuICAgIHNldExhbWJkYUNvbmZpZ3MoY29uZmlnczogTWFwPHN0cmluZywgYW55Pikge1xuICAgICAgICB0aGlzLmxhbWJkYUNvbmZpZ3MgPSBjb25maWdzO1xuICAgIH1cblxuICAgIHNldFN1YnNjcmlwdGlvbnMoc3ViczogU3FzU3Vic2NyaXB0aW9uW10pIHtcbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25zID0gc3VicztcbiAgICB9XG5cbiAgICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlN0YXJ0aW5nIFNRUyBCcmlkZ2UuLi5cIik7XG4gICAgICAgIFxuICAgICAgICAvLyBTaW1wbGUgcG9sbGluZyBtZWNoYW5pc20gZm9yIHRoZSBpbi1tZW1vcnkgU1FTIGVtdWxhdG9yXG4gICAgICAgIHRoaXMuaW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHN1YiBvZiB0aGlzLnN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXNzYWdlcyA9IHRoaXMuc3FzRW11bGF0b3IuZ2V0TWVzc2FnZXM/LihzdWIucXVldWVOYW1lKTtcbiAgICAgICAgICAgICAgICBpZiAobWVzc2FnZXMgJiYgbWVzc2FnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTUVMgQnJpZGdlOiBGb3VuZCAke21lc3NhZ2VzLmxlbmd0aH0gbWVzc2FnZXMgZm9yICR7c3ViLnF1ZXVlTmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIFRha2Ugb25lIG1lc3NhZ2UgKG9yIGFsbCkgYW5kIHByb2Nlc3NcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IG1lc3NhZ2VzLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhQ29uZmlnID0gdGhpcy5sYW1iZGFDb25maWdzLmdldChzdWIuaGFuZGxlcklkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghbGFtYmRhQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYExhbWJkYSBjb25maWd1cmF0aW9uIG5vdCBmb3VuZCBmb3IgSUQ6ICR7c3ViLmhhbmRsZXJJZH1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUmVjb3JkczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlSWQ6IG1lc3NhZ2UuaWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBib2R5OiBtZXNzYWdlLmJvZHksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxhbWJkYVJ1bm5lci5ydW5IYW5kbGVyKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhbWJkYUNvbmZpZy5lbnRyeSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYW1iZGFDb25maWcuaGFuZGxlckNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBldmVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7fSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYW1iZGFDb25maWcuZW52aXJvbm1lbnRcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBTUVMgbWVzc2FnZSBmb3IgJHtzdWIucXVldWVOYW1lfTpgLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBQdXQgbWVzc2FnZSBiYWNrPyAoU2ltcGxlIG1vY2sgZG9lc24ndCBoYW5kbGUgcmV0cmllcyB3ZWxsKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCAxMDAwKTtcbiAgICB9XG5cbiAgICBhc3luYyBzdG9wKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAodGhpcy5pbnRlcnZhbCkge1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmludGVydmFsKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbiJdfQ==