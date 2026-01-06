"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTopicMessage = void 0;
const client_sns_1 = require("@aws-sdk/client-sns");
const snsClient = new client_sns_1.SNSClient({});
/**
 * Send message to queue
 * @param topicUrl
 * @param message
 */
const sendTopicMessage = async (topicUrl, message) => {
    //check if message group ID is provided
    const { messageGroupID = "" } = message;
    const messageGroupPayload = messageGroupID !== "" ? {
        MessageGroupId: messageGroupID,
    } : {};
    const snsCommand = new client_sns_1.PublishCommand({
        TopicArn: topicUrl,
        Message: JSON.stringify({ message: message }),
        ...messageGroupPayload
    });
    const result = await snsClient.send(snsCommand);
    return result;
};
exports.sendTopicMessage = sendTopicMessage;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic25zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NsaWVudC9zbnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsb0RBQWdFO0FBRWhFLE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUNwQzs7OztHQUlHO0FBQ0ksTUFBTSxnQkFBZ0IsR0FBRyxLQUFLLEVBQUUsUUFBZ0IsRUFBRSxPQUFZLEVBQUUsRUFBRTtJQUVyRSx1Q0FBdUM7SUFDdkMsTUFBTSxFQUFFLGNBQWMsR0FBRyxFQUFFLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFDeEMsTUFBTSxtQkFBbUIsR0FBRyxjQUFjLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNoRCxjQUFjLEVBQUcsY0FBYztLQUNsQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7SUFFTixNQUFNLFVBQVUsR0FBRyxJQUFJLDJCQUFjLENBQUM7UUFDbEMsUUFBUSxFQUFFLFFBQVE7UUFDbEIsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7UUFDN0MsR0FBRyxtQkFBbUI7S0FDekIsQ0FBQyxDQUFDO0lBRUgsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ2hELE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUMsQ0FBQTtBQWhCWSxRQUFBLGdCQUFnQixvQkFnQjVCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU05TQ2xpZW50LCBQdWJsaXNoQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zbnMnO1xuXG5jb25zdCBzbnNDbGllbnQgPSBuZXcgU05TQ2xpZW50KHt9KTtcbi8qKlxuICogU2VuZCBtZXNzYWdlIHRvIHF1ZXVlXG4gKiBAcGFyYW0gdG9waWNVcmwgXG4gKiBAcGFyYW0gbWVzc2FnZVxuICovXG5leHBvcnQgY29uc3Qgc2VuZFRvcGljTWVzc2FnZSA9IGFzeW5jICh0b3BpY1VybDogc3RyaW5nLCBtZXNzYWdlOiBhbnkpID0+IHtcblxuICAgIC8vY2hlY2sgaWYgbWVzc2FnZSBncm91cCBJRCBpcyBwcm92aWRlZFxuICAgIGNvbnN0IHsgbWVzc2FnZUdyb3VwSUQgPSBcIlwiIH0gPSBtZXNzYWdlO1xuICAgIGNvbnN0IG1lc3NhZ2VHcm91cFBheWxvYWQgPSBtZXNzYWdlR3JvdXBJRCAhPT0gXCJcIiA/IHtcbiAgICAgICAgTWVzc2FnZUdyb3VwSWQgOiBtZXNzYWdlR3JvdXBJRCxcbiAgICB9IDoge31cblxuICAgIGNvbnN0IHNuc0NvbW1hbmQgPSBuZXcgUHVibGlzaENvbW1hbmQoeyBcbiAgICAgICAgVG9waWNBcm46IHRvcGljVXJsLCBcbiAgICAgICAgTWVzc2FnZTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiBtZXNzYWdlIH0pLFxuICAgICAgICAuLi5tZXNzYWdlR3JvdXBQYXlsb2FkXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzbnNDbGllbnQuc2VuZChzbnNDb21tYW5kKTtcbiAgICByZXR1cm4gcmVzdWx0O1xufSJdfQ==