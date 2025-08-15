import { IEmailMessage } from '../core/runtime/mail-processor';
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
export declare const sendMail: (emailMessage: IEmailMessage, templateData?: any) => Promise<import("@aws-sdk/client-sqs").SendMessageCommandOutput>;
