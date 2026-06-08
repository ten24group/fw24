"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMail = void 0;
const util_1 = require("./util");
const sqs_1 = require("./sqs");
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
const sendMail = async (emailMessage, templateData) => {
    // TemplateName or subject and message are required
    if (!emailMessage.TemplateName
        && (!emailMessage.Subject
            ||
                (!emailMessage.Message && !emailMessage.HTMLMessage))) {
        throw new Error('TemplateName or Subject and Message/HTMLMessage are required');
    }
    const queueUrl = util_1.Environment.emailQueueUrl;
    const emailData = {
        emailMessage: emailMessage,
        templateData: templateData
    };
    const result = await (0, sqs_1.sendQueueMessage)(queueUrl, emailData);
    return result;
};
exports.sendMail = sendMail;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NsaWVudC9zZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsaUNBQW9DO0FBQ3BDLCtCQUF3QztBQUd4Qzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFDRztBQUNJLE1BQU0sUUFBUSxHQUFHLEtBQUssRUFBRSxZQUEyQixFQUFFLFlBQWtCLEVBQUUsRUFBRTtJQUM5RSxtREFBbUQ7SUFDbkQsSUFDSSxDQUFDLFlBQVksQ0FBQyxZQUFZO1dBQ3ZCLENBQ0MsQ0FBQyxZQUFZLENBQUMsT0FBTzs7Z0JBRXJCLENBQUMsQ0FBQyxZQUFZLENBQUMsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLFdBQVcsQ0FBQyxDQUN2RCxFQUNILENBQUM7UUFDQyxNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7SUFDcEYsQ0FBQztJQUVELE1BQU0sUUFBUSxHQUFHLGtCQUFXLENBQUMsYUFBYSxDQUFDO0lBRTNDLE1BQU0sU0FBUyxHQUFHO1FBQ2QsWUFBWSxFQUFFLFlBQVk7UUFDMUIsWUFBWSxFQUFFLFlBQVk7S0FDN0IsQ0FBQztJQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSxzQkFBZ0IsRUFBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDM0QsT0FBTyxNQUFNLENBQUM7QUFDbEIsQ0FBQyxDQUFBO0FBdEJZLFFBQUEsUUFBUSxZQXNCcEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFbnZpcm9ubWVudCB9IGZyb20gJy4vdXRpbCdcbmltcG9ydCB7IHNlbmRRdWV1ZU1lc3NhZ2UgfSBmcm9tICcuL3NxcydcbmltcG9ydCB7IElFbWFpbE1lc3NhZ2UgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvbWFpbC1wcm9jZXNzb3InXG5cbi8qKlxuICogU2VuZHMgYW4gZW1haWwgYnkgcXVldWluZyBpdCB0aHJvdWdoIHRoZSBtYWlsIHByb2Nlc3Npbmcgc3lzdGVtLlxuICogVGhpcyBpcyBhIGZhY2FkZSB0aGF0IHF1ZXVlcyB0aGUgZW1haWwgbWVzc2FnZSBmb3IgYXN5bmNocm9ub3VzIHByb2Nlc3NpbmcuXG4gKiBcbiAqIEBwYXJhbSBlbWFpbE1lc3NhZ2UgLSBUaGUgZW1haWwgbWVzc2FnZSBjb25maWd1cmF0aW9uIGluY2x1ZGluZyByZWNpcGllbnQsIGNvbnRlbnQsIGFuZCB0ZW1wbGF0ZSBzZXR0aW5nc1xuICogQHBhcmFtIHRlbXBsYXRlRGF0YSAtIE9wdGlvbmFsIGRhdGEgdG8gYmUgdXNlZCB3aGVuIHJlbmRlcmluZyB0aGUgZW1haWwgdGVtcGxhdGVcbiAqIEByZXR1cm5zIFByb21pc2Ugd2l0aCB0aGUgU1FTIG1lc3NhZ2Ugc2VuZCByZXN1bHRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFNlbmQgdXNpbmcgYSB0ZW1wbGF0ZVxuICogYXdhaXQgc2VuZE1haWwoe1xuICogICBGcm9tRW1haWxBZGRyZXNzOiAnc2VuZGVyQGV4YW1wbGUuY29tJyxcbiAqICAgVG9FbWFpbEFkZHJlc3M6ICdyZWNpcGllbnRAZXhhbXBsZS5jb20nLFxuICogICBUZW1wbGF0ZU5hbWU6ICd3ZWxjb21lLWVtYWlsJyxcbiAqICAgUmVwbHlUb0VtYWlsQWRkcmVzczogJ3N1cHBvcnRAZXhhbXBsZS5jb20nXG4gKiB9LCB7XG4gKiAgIHVzZXJOYW1lOiAnSm9obicsXG4gKiAgIGFjdGl2YXRpb25MaW5rOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9hY3RpdmF0ZSdcbiAqIH0pO1xuICogXG4gKiAvLyBTZW5kIHdpdGggZGlyZWN0IGNvbnRlbnRcbiAqIGF3YWl0IHNlbmRNYWlsKHtcbiAqICAgRnJvbUVtYWlsQWRkcmVzczogJ3NlbmRlckBleGFtcGxlLmNvbScsXG4gKiAgIFRvRW1haWxBZGRyZXNzOiAncmVjaXBpZW50QGV4YW1wbGUuY29tJyxcbiAqICAgU3ViamVjdDogJ1dlbGNvbWUgdG8gb3VyIHNlcnZpY2UnLFxuICogICBNZXNzYWdlOiAnVGhhbmsgeW91IGZvciBqb2luaW5nIHVzISdcbiAqIH0pO1xuICogXG4gKiAvLyBTZW5kIHdpdGggaHRtbCBjb250ZW50XG4gKiBhd2FpdCBzZW5kTWFpbCh7XG4gKiAgIEZyb21FbWFpbEFkZHJlc3M6ICdzZW5kZXJAZXhhbXBsZS5jb20nLFxuICogICBUb0VtYWlsQWRkcmVzczogJ3JlY2lwaWVudEBleGFtcGxlLmNvbScsXG4gKiAgIFN1YmplY3Q6ICdXZWxjb21lIHRvIG91ciBzZXJ2aWNlJyxcbiAqICAgSFRNTE1lc3NhZ2U6ICc8cD5UaGFuayB5b3UgZm9yIGpvaW5pbmcgdXMhPC9wPidcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZW5kTWFpbCA9IGFzeW5jIChlbWFpbE1lc3NhZ2U6IElFbWFpbE1lc3NhZ2UsIHRlbXBsYXRlRGF0YT86IGFueSkgPT4ge1xuICAgIC8vIFRlbXBsYXRlTmFtZSBvciBzdWJqZWN0IGFuZCBtZXNzYWdlIGFyZSByZXF1aXJlZFxuICAgIGlmIChcbiAgICAgICAgIWVtYWlsTWVzc2FnZS5UZW1wbGF0ZU5hbWVcbiAgICAgICAgJiYgKFxuICAgICAgICAgICAgIWVtYWlsTWVzc2FnZS5TdWJqZWN0XG4gICAgICAgICAgICB8fFxuICAgICAgICAgICAgKCFlbWFpbE1lc3NhZ2UuTWVzc2FnZSAmJiAhZW1haWxNZXNzYWdlLkhUTUxNZXNzYWdlKVxuICAgICAgICApXG4gICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignVGVtcGxhdGVOYW1lIG9yIFN1YmplY3QgYW5kIE1lc3NhZ2UvSFRNTE1lc3NhZ2UgYXJlIHJlcXVpcmVkJyk7XG4gICAgfVxuXG4gICAgY29uc3QgcXVldWVVcmwgPSBFbnZpcm9ubWVudC5lbWFpbFF1ZXVlVXJsO1xuXG4gICAgY29uc3QgZW1haWxEYXRhID0ge1xuICAgICAgICBlbWFpbE1lc3NhZ2U6IGVtYWlsTWVzc2FnZSxcbiAgICAgICAgdGVtcGxhdGVEYXRhOiB0ZW1wbGF0ZURhdGFcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShxdWV1ZVVybCwgZW1haWxEYXRhKTtcbiAgICByZXR1cm4gcmVzdWx0O1xufSJdfQ==