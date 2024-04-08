import { Environment } from './util'
import { sendQueueMessage } from './sqs'
import { IEmailMessage } from '../core/mail-processor'

export const sendMail = async (emailMessage: IEmailMessage, templateData?: any) => {
    
    // TemplateName or subject and message are required
    if (!emailMessage.TemplateName && (!emailMessage.Subject || !emailMessage.Message)) {
        throw new Error('TemplateName or Subject and Message are required');
    }
    const queueUrl = Environment.emailQueueUrl;

    const emailData = { emailMessage: emailMessage, templateData: templateData };

    const result = await sendQueueMessage(queueUrl, emailData);
    return result;
}
