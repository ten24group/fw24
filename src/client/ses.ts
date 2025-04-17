import { Environment } from './util'
import { sendQueueMessage } from './sqs'
import { IEmailMessage } from '../core/runtime/mail-processor'

/**
 * Sends an email by queuing it through the mail processing system.
 * This is a facade that queues the email message for asynchronous processing.
 * 
 * @param emailMessage - The email message configuration including recipient, content, and template settings
 * @param templateData - Optional data to be used when rendering the email template
 * @returns Promise with the SQS message send result
 * 
 * @example
 * ```typescript
 * // Send using a template
 * await sendMail({
 *   FromEmailAddress: 'sender@example.com',
 *   ToEmailAddress: 'recipient@example.com',
 *   TemplateName: 'welcome-email',
 *   ReplyToEmailAddress: 'support@example.com'
 * }, {
 *   userName: 'John',
 *   activationLink: 'https://example.com/activate'
 * });
 * 
 * // Send with direct content
 * await sendMail({
 *   FromEmailAddress: 'sender@example.com',
 *   ToEmailAddress: 'recipient@example.com',
 *   Subject: 'Welcome to our service',
 *   Message: 'Thank you for joining us!'
 * });
 * 
 * // Send with html content
 * await sendMail({
 *   FromEmailAddress: 'sender@example.com',
 *   ToEmailAddress: 'recipient@example.com',
 *   Subject: 'Welcome to our service',
 *   HTMLMessage: '<p>Thank you for joining us!</p>'
 * });
 * ```
 */
export const sendMail = async (emailMessage: IEmailMessage, templateData?: any) => {
    // TemplateName or subject and message are required
    if (
        !emailMessage.TemplateName
        && (
            !emailMessage.Subject
            ||
            (!emailMessage.Message && !emailMessage.HTMLMessage)
        )
    ) {
        throw new Error('TemplateName or Subject and Message/HTMLMessage are required');
    }

    const queueUrl = Environment.emailQueueUrl;

    const emailData = {
        emailMessage: emailMessage,
        templateData: templateData
    };

    const result = await sendQueueMessage(queueUrl, emailData);
    return result;
}