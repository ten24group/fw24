"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopicConstruct = void 0;
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sns_subscriptions_1 = require("aws-cdk-lib/aws-sns-subscriptions");
const helper_1 = require("../core/helper");
const fw24_1 = require("../core/fw24");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
class TopicConstruct {
    topicConstructConfig;
    stackName;
    parentStackName;
    logger = (0, logging_1.createLogger)(TopicConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = TopicConstruct.name;
    dependencies = [];
    output;
    mainStack;
    constructor(topicConstructConfig, stackName, parentStackName) {
        this.topicConstructConfig = topicConstructConfig;
        this.stackName = stackName;
        this.parentStackName = parentStackName;
        helper_1.Helper.hydrateConfig(topicConstructConfig, 'SNS');
    }
    async construct() {
        this.logger.debug("construct: ");
        this.topicConstructConfig.forEach((topicConfig) => {
            this.logger.debug("Creating topic: ", topicConfig.topicName);
            this.mainStack = this.fw24.getStack(topicConfig.stackName || this.stackName, topicConfig.parentStackName);
            const topic = new aws_sns_1.Topic(this.mainStack, topicConfig.topicName + '-topic', {
                ...topicConfig.topicProps
            });
            this.fw24.setConstructOutput(this, topicConfig.topicName, topic, construct_1.OutputType.TOPIC);
            this.fw24.setEnvironmentVariable(topicConfig.topicName, topic.topicName, "topicName");
            this.fw24.setEnvironmentVariable(topicConfig.topicName, topic, "topic");
            if (topicConfig.notificationProps?.email) {
                for (const email of topicConfig.notificationProps.email) {
                    topic.addSubscription(new aws_sns_subscriptions_1.EmailSubscription(email));
                }
            }
            if (topicConfig.notificationProps?.sms) {
                for (const sms of topicConfig.notificationProps.sms) {
                    topic.addSubscription(new aws_sns_subscriptions_1.SmsSubscription(sms));
                }
            }
            this.fw24.setConstructOutput(this, topicConfig.topicName, topic, construct_1.OutputType.TOPIC, 'topicName');
        });
    }
}
exports.TopicConstruct = TopicConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], TopicConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9waWMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy90b3BpYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFDQSxpREFBd0Q7QUFDeEQsNkVBQXVGO0FBRXZGLDJDQUF3QztBQUN4Qyx1Q0FBb0M7QUFDcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQWdCdkQsTUFBYSxjQUFjO0lBVUg7SUFBdUQ7SUFBNEI7SUFUOUYsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDM0MsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUNuQyxZQUFZLEdBQWEsRUFBRSxDQUFDO0lBQzVCLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBRWxCLFlBQW9CLG9CQUE2QyxFQUFVLFNBQWtCLEVBQVUsZUFBd0I7UUFBM0cseUJBQW9CLEdBQXBCLG9CQUFvQixDQUF5QjtRQUFVLGNBQVMsR0FBVCxTQUFTLENBQVM7UUFBVSxvQkFBZSxHQUFmLGVBQWUsQ0FBUztRQUMzSCxlQUFNLENBQUMsYUFBYSxDQUFDLG9CQUFvQixFQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFHWSxBQUFOLEtBQUssQ0FBQyxTQUFTO1FBQ2xCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBRWpDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUUsQ0FBRSxXQUFrQyxFQUFHLEVBQUU7WUFDeEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEVBQUUsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQzdELElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUUxRyxNQUFNLEtBQUssR0FBRyxJQUFJLGVBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxTQUFTLEdBQUcsUUFBUSxFQUFFO2dCQUN0RSxHQUFHLFdBQVcsQ0FBQyxVQUFVO2FBQzVCLENBQUMsQ0FBQztZQUNILElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLHNCQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDbkYsSUFBSSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFDdEYsSUFBSSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztZQUV4RSxJQUFHLFdBQVcsQ0FBQyxpQkFBaUIsRUFBRSxLQUFLLEVBQUMsQ0FBQztnQkFDckMsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLENBQUM7b0JBQ3RELEtBQUssQ0FBQyxlQUFlLENBQ2pCLElBQUkseUNBQWlCLENBQUMsS0FBSyxDQUFDLENBQy9CLENBQUM7Z0JBQ04sQ0FBQztZQUNMLENBQUM7WUFFRCxJQUFHLFdBQVcsQ0FBQyxpQkFBaUIsRUFBRSxHQUFHLEVBQUMsQ0FBQztnQkFDbkMsS0FBSyxNQUFNLEdBQUcsSUFBSSxXQUFXLENBQUMsaUJBQWlCLENBQUMsR0FBRyxFQUFFLENBQUM7b0JBQ2xELEtBQUssQ0FBQyxlQUFlLENBQ2pCLElBQUksdUNBQWUsQ0FBQyxHQUFHLENBQUMsQ0FDM0IsQ0FBQztnQkFDTixDQUFDO1lBQ0wsQ0FBQztZQUVELElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLHNCQUFVLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ3BHLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBaERELHdDQWdEQztBQWpDZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7K0NBaUNiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2ZuT3V0cHV0LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgVG9waWMsIFRvcGljUHJvcHMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCB7IEVtYWlsU3Vic2NyaXB0aW9uLCBTbXNTdWJzY3JpcHRpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zLXN1YnNjcmlwdGlvbnMnO1xuXG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIGZvciBhIHRvcGljIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJVG9waWNDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICB0b3BpY05hbWU6IHN0cmluZztcbiAgICB0b3BpY1Byb3BzPzogVG9waWNQcm9wcztcbiAgICBub3RpZmljYXRpb25Qcm9wcz86IHtcbiAgICAgICAgZW1haWw/OiBzdHJpbmdbXTtcbiAgICAgICAgc21zPzogc3RyaW5nW107XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgVG9waWNDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoVG9waWNDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBuYW1lOiBzdHJpbmcgPSBUb3BpY0NvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHRvcGljQ29uc3RydWN0Q29uZmlnOiBJVG9waWNDb25zdHJ1Y3RDb25maWdbXSwgcHJpdmF0ZSBzdGFja05hbWU/OiBzdHJpbmcsIHByaXZhdGUgcGFyZW50U3RhY2tOYW1lPzogc3RyaW5nKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHRvcGljQ29uc3RydWN0Q29uZmlnLCdTTlMnKTtcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiY29uc3RydWN0OiBcIik7XG5cbiAgICAgICAgdGhpcy50b3BpY0NvbnN0cnVjdENvbmZpZy5mb3JFYWNoKCAoIHRvcGljQ29uZmlnOiBJVG9waWNDb25zdHJ1Y3RDb25maWcgKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0aW5nIHRvcGljOiBcIiwgdG9waWNDb25maWcudG9waWNOYW1lKTtcbiAgICAgICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRvcGljQ29uZmlnLnN0YWNrTmFtZSB8fCB0aGlzLnN0YWNrTmFtZSwgdG9waWNDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICAgICAgY29uc3QgdG9waWMgPSBuZXcgVG9waWModGhpcy5tYWluU3RhY2ssIHRvcGljQ29uZmlnLnRvcGljTmFtZSArICctdG9waWMnLCB7XG4gICAgICAgICAgICAgICAgLi4udG9waWNDb25maWcudG9waWNQcm9wc1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHRvcGljQ29uZmlnLnRvcGljTmFtZSwgdG9waWMsIE91dHB1dFR5cGUuVE9QSUMpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUodG9waWNDb25maWcudG9waWNOYW1lLCB0b3BpYy50b3BpY05hbWUsIFwidG9waWNOYW1lXCIpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUodG9waWNDb25maWcudG9waWNOYW1lLCB0b3BpYywgXCJ0b3BpY1wiKTtcblxuICAgICAgICAgICAgaWYodG9waWNDb25maWcubm90aWZpY2F0aW9uUHJvcHM/LmVtYWlsKXtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGVtYWlsIG9mIHRvcGljQ29uZmlnLm5vdGlmaWNhdGlvblByb3BzLmVtYWlsKSB7XG4gICAgICAgICAgICAgICAgICAgIHRvcGljLmFkZFN1YnNjcmlwdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBFbWFpbFN1YnNjcmlwdGlvbihlbWFpbClcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmKHRvcGljQ29uZmlnLm5vdGlmaWNhdGlvblByb3BzPy5zbXMpe1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3Qgc21zIG9mIHRvcGljQ29uZmlnLm5vdGlmaWNhdGlvblByb3BzLnNtcykge1xuICAgICAgICAgICAgICAgICAgICB0b3BpYy5hZGRTdWJzY3JpcHRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXcgU21zU3Vic2NyaXB0aW9uKHNtcylcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdG9waWNDb25maWcudG9waWNOYW1lLCB0b3BpYywgT3V0cHV0VHlwZS5UT1BJQywgJ3RvcGljTmFtZScpO1xuICAgICAgICB9KTtcbiAgICB9XG59ICAgIl19