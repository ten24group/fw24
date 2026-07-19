"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = exports.MailProcessor = void 0;
const client_sesv2_1 = require("@aws-sdk/client-sesv2");
const sqs_controller_1 = require("./sqs-controller");
const execution_context_1 = require("./execution-context");
const observability_1 = require("../../observability");
const user_agent_1 = require("../../client/user-agent");
/**
 * Mail processor that sends emails via AWS SES.
 *
 * Key Design Decisions:
 * 1. Per-record execution context for distributed tracing
 * 2. Granular failure tracking with detailed attributes (always enabled)
 * 3. Optional success tracking (disabled by default) via TRACK_EMAIL_SUCCESS env var
 * 4. SES client initialized in constructor for reuse across warm starts
 * 5. Returns void for all success, SQSBatchResponse only for failures
 *
 * Configuration:
 *
 * Via MailerConstruct:
 * ```typescript
 * new MailerConstruct({
 *   domain: 'example.com',
 *   trackEmailSuccess: true  // Enable for compliance/audit
 * });
 * ```
 *
 * Or set TRACK_EMAIL_SUCCESS='true' environment variable directly.
 */
class MailProcessor extends sqs_controller_1.QueueController {
    sesClient;
    constructor() {
        super();
        // Initialize SES client once per Lambda container
        // Reused across warm starts for better performance
        this.sesClient = new client_sesv2_1.SESv2Client({ userAgentAppId: user_agent_1.FW24_UA_APP_ID });
    }
    async initialize(_event, _context) {
        // SES client already initialized in constructor
    }
    async process(event, _context, _ctx) {
        this.logger.debug('Mail Handler Received event:', event);
        const batchItemFailures = [];
        // Check success tracking config once for the batch (via environment variable)
        const trackSuccess = process.env.TRACK_EMAIL_SUCCESS === 'true';
        for (const record of event.Records) {
            // Extract trace context from SQS message attributes for distributed tracing.
            // This links the email processing back to the immediate upstream invocation via `causedBy`.
            const traceCtx = (0, execution_context_1.extractFromSqs)(record.messageAttributes);
            const recordCtx = (0, execution_context_1.createExecutionContext)({
                // Strict contract:
                // - correlationId is local to this record processing slice
                // - causedBy links to the upstream sender's correlationId
                correlationId: record.messageId,
                causedBy: traceCtx?.causedBy ?? traceCtx?.correlationId,
                sampled: traceCtx?.sampled,
            });
            // Process each email in its own execution context
            // This ensures observability events (failures) are linked to the correct originating request
            await (0, execution_context_1.runWithExecutionContext)(recordCtx, async () => {
                // Declare variables in outer scope so they're accessible in catch block
                // even if JSON.parse fails
                let emailMessage;
                let templateData;
                try {
                    this.logger.info('Processing message with ID:', record.messageId);
                    // Parse message body
                    const parsed = JSON.parse(record.body);
                    emailMessage = parsed.emailMessage;
                    templateData = parsed.templateData;
                    // Special case: Test render template (used for validation/preview)
                    // Does not send actual email, just validates template rendering
                    if (templateData && templateData['testRenderEmailTemplate']) {
                        const command = new client_sesv2_1.TestRenderEmailTemplateCommand({
                            TemplateName: emailMessage.TemplateName,
                            TemplateData: JSON.stringify({ ...emailMessage, ...templateData }),
                        });
                        const response = await this.sesClient.send(command);
                        this.logger.info('Test render response:', response);
                        return;
                    }
                    // Construct email parameters
                    const mailParams = {
                        FromEmailAddress: emailMessage.FromEmailAddress,
                        Destination: {
                            ToAddresses: [emailMessage.ToEmailAddress],
                        },
                        Content: {}
                    };
                    // If a template name is provided, use it
                    if (emailMessage.TemplateName) {
                        mailParams.Content.Template = {
                            TemplateName: emailMessage.TemplateName, //change to get full template name from fw24
                            TemplateData: JSON.stringify({ ...emailMessage, ...templateData })
                        };
                    }
                    // if body and subject are provided, use them
                    else if (emailMessage.Message && emailMessage.Subject) {
                        mailParams.Content.Simple = {
                            Body: {
                                Text: { Data: emailMessage.Message },
                            },
                            Subject: { Data: emailMessage.Subject },
                        };
                    }
                    else if (emailMessage.HTMLMessage && emailMessage.Subject) {
                        mailParams.Content.Simple = {
                            Body: {
                                Html: { Data: emailMessage.HTMLMessage },
                            },
                            Subject: { Data: emailMessage.Subject },
                        };
                    }
                    else {
                        throw new Error('Invalid message format. Either provide [`TemplateName` or `Message` or `HTMLMessage`] and `Subject`.');
                    }
                    // if reply to address is provided, use it
                    if (emailMessage.ReplyToEmailAddress) {
                        mailParams.ReplyToAddresses = [emailMessage.ReplyToEmailAddress];
                    }
                    this.logger.debug('Sending email with parameters:', mailParams);
                    // Send the email
                    const command = new client_sesv2_1.SendEmailCommand(mailParams);
                    await this.sesClient.send(command);
                    // Optional success tracking (opt-in via observability.trackSuccess config)
                    if (trackSuccess) {
                        observability_1.SpanObserver.getCurrentSpan()?.checkpoint?.('email.sent', {
                            tags: {
                                'email.message_id': record.messageId,
                                'email.recipient': emailMessage.ToEmailAddress,
                                'email.type': emailMessage.TemplateName ? 'template' : 'simple',
                                'email.template_name': emailMessage.TemplateName || '',
                            },
                            metrics: {
                                'email.sent': 1,
                            },
                            data: {
                                emailSubject: emailMessage.Subject,
                            },
                        });
                    }
                }
                catch (error) {
                    this.logger.error('Error processing message:', record);
                    this.logger.error('Error:', error);
                    // Track failure with detailed context.
                    // Safe even if JSON.parse failed (emailMessage will be undefined).
                    // This enables filtering/querying failed emails by recipient, template, etc.
                    observability_1.SpanObserver.getCurrentSpan()?.checkpoint?.('email.send.failed', {
                        metrics: {
                            'email.failed': 1,
                        },
                        tags: {
                            'email.message_id': record.messageId,
                            'email.recipient': emailMessage?.ToEmailAddress || 'unknown',
                            'email.type': emailMessage?.TemplateName ? 'template' : 'simple',
                            'email.template_name': emailMessage?.TemplateName || '',
                            'error.type': error instanceof Error ? error.constructor.name : typeof error,
                            'error.message': error instanceof Error ? error.message : String(error),
                        },
                        data: {
                            emailSubject: emailMessage?.Subject,
                        },
                        error: error instanceof Error ? error : new Error(String(error)),
                    });
                    // Mark this message for retry by SQS
                    const batchItemFailure = {
                        itemIdentifier: record.messageId
                    };
                    batchItemFailures.push(batchItemFailure);
                }
            });
        }
        this.logger.info('Mail Processing complete.', {
            totalRecords: event.Records.length,
            failures: batchItemFailures.length,
            successes: event.Records.length - batchItemFailures.length,
        });
        // SQS Partial Batch Failure contract:
        // - Return void/undefined if all messages processed successfully
        // - Return SQSBatchResponse with failed message IDs if some failed
        // Failed messages will be retried by SQS, successful ones won't be reprocessed
        if (batchItemFailures.length === 0) {
            return;
        }
        return {
            batchItemFailures: batchItemFailures
        };
    }
}
exports.MailProcessor = MailProcessor;
// Export handler using the CreateHandler pattern
// This instantiates the class and binds the LambdaHandler method
exports.handler = MailProcessor.CreateHandler(MailProcessor);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbC1wcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL21haWwtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHdEQUE2SDtBQUU3SCxxREFBOEY7QUFDOUYsMkRBQXNHO0FBQ3RHLHVEQUFtRDtBQUNuRCx3REFBeUQ7QUFlekQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILE1BQWEsYUFBYyxTQUFRLGdDQUFlO0lBQ3RDLFNBQVMsQ0FBYztJQUUvQjtRQUNJLEtBQUssRUFBRSxDQUFDO1FBQ1Isa0RBQWtEO1FBQ2xELG1EQUFtRDtRQUNuRCxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksMEJBQVcsQ0FBQyxFQUFFLGNBQWMsRUFBRSwyQkFBYyxFQUFFLENBQUMsQ0FBQztJQUN6RSxDQUFDO0lBRVMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFnQixFQUFFLFFBQWlCO1FBQzFELGdEQUFnRDtJQUNwRCxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFlLEVBQUUsUUFBaUIsRUFBRSxJQUE0QjtRQUMxRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV6RCxNQUFNLGlCQUFpQixHQUEwQixFQUFFLENBQUM7UUFFcEQsOEVBQThFO1FBQzlFLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLEtBQUssTUFBTSxDQUFDO1FBRWhFLEtBQUssTUFBTSxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2pDLDZFQUE2RTtZQUM3RSw0RkFBNEY7WUFDNUYsTUFBTSxRQUFRLEdBQUcsSUFBQSxrQ0FBYyxFQUFDLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQzFELE1BQU0sU0FBUyxHQUFHLElBQUEsMENBQXNCLEVBQUM7Z0JBQ3JDLG1C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Z0IsR0FBd0I7d0JBQzFDLGNBQWMsRUFBRSxNQUFNLENBQUMsU0FBUztxQkFDbkMsQ0FBQztvQkFDRixpQkFBaUIsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztnQkFDN0MsQ0FBQztZQUNMLENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDJCQUEyQixFQUFFO1lBQzFDLFlBQVksRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07WUFDbEMsUUFBUSxFQUFFLGlCQUFpQixDQUFDLE1BQU07WUFDbEMsU0FBUyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLGlCQUFpQixDQUFDLE1BQU07U0FDN0QsQ0FBQyxDQUFDO1FBRUgsc0NBQXNDO1FBQ3RDLGlFQUFpRTtRQUNqRSxtRUFBbUU7UUFDbkUsK0VBQStFO1FBQy9FLElBQUksaUJBQWlCLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2pDLE9BQU87UUFDWCxDQUFDO1FBRUQsT0FBTztZQUNILGlCQUFpQixFQUFFLGlCQUFpQjtTQUN2QyxDQUFDO0lBQ04sQ0FBQztDQUNKO0FBekxELHNDQXlMQztBQUVELGlEQUFpRDtBQUNqRCxpRUFBaUU7QUFDcEQsUUFBQSxPQUFPLEdBQUcsYUFBYSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNFU3YyQ2xpZW50LCBTZW5kRW1haWxDb21tYW5kLCBTZW5kRW1haWxDb21tYW5kSW5wdXQsIFRlc3RSZW5kZXJFbWFpbFRlbXBsYXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZXN2Mic7XG5pbXBvcnQgdHlwZSB7IFNRU0JhdGNoSXRlbUZhaWx1cmUsIFNRU0JhdGNoUmVzcG9uc2UsIFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBRdWV1ZUNvbnRyb2xsZXIsIFF1ZXVlUHJvY2Vzc1Jlc3VsdCwgUXVldWVFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi9zcXMtY29udHJvbGxlcic7XG5pbXBvcnQgeyBleHRyYWN0RnJvbVNxcywgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHsgRlcyNF9VQV9BUFBfSUQgfSBmcm9tICcuLi8uLi9jbGllbnQvdXNlci1hZ2VudCc7XG5cbi8qKlxuICogRW1haWwgbWVzc2FnZSBzdHJ1Y3R1cmUgc2VudCB2aWEgU1FTXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUVtYWlsTWVzc2FnZSB7XG4gICAgRnJvbUVtYWlsQWRkcmVzczogc3RyaW5nO1xuICAgIFRvRW1haWxBZGRyZXNzOiBzdHJpbmc7XG4gICAgU3ViamVjdD86IHN0cmluZztcbiAgICBNZXNzYWdlPzogc3RyaW5nO1xuICAgIEhUTUxNZXNzYWdlPzogc3RyaW5nO1xuICAgIFRlbXBsYXRlTmFtZT86IHN0cmluZztcbiAgICBSZXBseVRvRW1haWxBZGRyZXNzPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIE1haWwgcHJvY2Vzc29yIHRoYXQgc2VuZHMgZW1haWxzIHZpYSBBV1MgU0VTLlxuICogXG4gKiBLZXkgRGVzaWduIERlY2lzaW9uczpcbiAqIDEuIFBlci1yZWNvcmQgZXhlY3V0aW9uIGNvbnRleHQgZm9yIGRpc3RyaWJ1dGVkIHRyYWNpbmdcbiAqIDIuIEdyYW51bGFyIGZhaWx1cmUgdHJhY2tpbmcgd2l0aCBkZXRhaWxlZCBhdHRyaWJ1dGVzIChhbHdheXMgZW5hYmxlZClcbiAqIDMuIE9wdGlvbmFsIHN1Y2Nlc3MgdHJhY2tpbmcgKGRpc2FibGVkIGJ5IGRlZmF1bHQpIHZpYSBUUkFDS19FTUFJTF9TVUNDRVNTIGVudiB2YXJcbiAqIDQuIFNFUyBjbGllbnQgaW5pdGlhbGl6ZWQgaW4gY29uc3RydWN0b3IgZm9yIHJldXNlIGFjcm9zcyB3YXJtIHN0YXJ0c1xuICogNS4gUmV0dXJucyB2b2lkIGZvciBhbGwgc3VjY2VzcywgU1FTQmF0Y2hSZXNwb25zZSBvbmx5IGZvciBmYWlsdXJlc1xuICogXG4gKiBDb25maWd1cmF0aW9uOlxuICogXG4gKiBWaWEgTWFpbGVyQ29uc3RydWN0OlxuICogYGBgdHlwZXNjcmlwdFxuICogbmV3IE1haWxlckNvbnN0cnVjdCh7XG4gKiAgIGRvbWFpbjogJ2V4YW1wbGUuY29tJyxcbiAqICAgdHJhY2tFbWFpbFN1Y2Nlc3M6IHRydWUgIC8vIEVuYWJsZSBmb3IgY29tcGxpYW5jZS9hdWRpdFxuICogfSk7XG4gKiBgYGBcbiAqIFxuICogT3Igc2V0IFRSQUNLX0VNQUlMX1NVQ0NFU1M9J3RydWUnIGVudmlyb25tZW50IHZhcmlhYmxlIGRpcmVjdGx5LlxuICovXG5leHBvcnQgY2xhc3MgTWFpbFByb2Nlc3NvciBleHRlbmRzIFF1ZXVlQ29udHJvbGxlciB7XG4gICAgcHJpdmF0ZSBzZXNDbGllbnQ6IFNFU3YyQ2xpZW50O1xuXG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIC8vIEluaXRpYWxpemUgU0VTIGNsaWVudCBvbmNlIHBlciBMYW1iZGEgY29udGFpbmVyXG4gICAgICAgIC8vIFJldXNlZCBhY3Jvc3Mgd2FybSBzdGFydHMgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxuICAgICAgICB0aGlzLnNlc0NsaWVudCA9IG5ldyBTRVN2MkNsaWVudCh7IHVzZXJBZ2VudEFwcElkOiBGVzI0X1VBX0FQUF9JRCB9KTtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IFNRU0V2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBTRVMgY2xpZW50IGFscmVhZHkgaW5pdGlhbGl6ZWQgaW4gY29uc3RydWN0b3JcbiAgICB9XG5cbiAgICBhc3luYyBwcm9jZXNzKGV2ZW50OiBTUVNFdmVudCwgX2NvbnRleHQ6IENvbnRleHQsIF9jdHg/OiBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFF1ZXVlUHJvY2Vzc1Jlc3VsdD4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTWFpbCBIYW5kbGVyIFJlY2VpdmVkIGV2ZW50OicsIGV2ZW50KTtcblxuICAgICAgICBjb25zdCBiYXRjaEl0ZW1GYWlsdXJlczogU1FTQmF0Y2hJdGVtRmFpbHVyZVtdID0gW107XG5cbiAgICAgICAgLy8gQ2hlY2sgc3VjY2VzcyB0cmFja2luZyBjb25maWcgb25jZSBmb3IgdGhlIGJhdGNoICh2aWEgZW52aXJvbm1lbnQgdmFyaWFibGUpXG4gICAgICAgIGNvbnN0IHRyYWNrU3VjY2VzcyA9IHByb2Nlc3MuZW52LlRSQUNLX0VNQUlMX1NVQ0NFU1MgPT09ICd0cnVlJztcblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XG4gICAgICAgICAgICAvLyBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciBkaXN0cmlidXRlZCB0cmFjaW5nLlxuICAgICAgICAgICAgLy8gVGhpcyBsaW5rcyB0aGUgZW1haWwgcHJvY2Vzc2luZyBiYWNrIHRvIHRoZSBpbW1lZGlhdGUgdXBzdHJlYW0gaW52b2NhdGlvbiB2aWEgYGNhdXNlZEJ5YC5cbiAgICAgICAgICAgIGNvbnN0IHRyYWNlQ3R4ID0gZXh0cmFjdEZyb21TcXMocmVjb3JkLm1lc3NhZ2VBdHRyaWJ1dGVzKTtcbiAgICAgICAgICAgIGNvbnN0IHJlY29yZEN0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgICAgICAgICAgIC8vIFN0cmljdCBjb250cmFjdDpcbiAgICAgICAgICAgICAgICAvLyAtIGNvcnJlbGF0aW9uSWQgaXMgbG9jYWwgdG8gdGhpcyByZWNvcmQgcHJvY2Vzc2luZyBzbGljZVxuICAgICAgICAgICAgICAgIC8vIC0gY2F1c2VkQnkgbGlua3MgdG8gdGhlIHVwc3RyZWFtIHNlbmRlcidzIGNvcnJlbGF0aW9uSWRcbiAgICAgICAgICAgICAgICBjb3JyZWxhdGlvbklkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICAgICAgICAgIGNhdXNlZEJ5OiB0cmFjZUN0eD8uY2F1c2VkQnkgPz8gdHJhY2VDdHg/LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgICAgICAgc2FtcGxlZDogdHJhY2VDdHg/LnNhbXBsZWQsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gUHJvY2VzcyBlYWNoIGVtYWlsIGluIGl0cyBvd24gZXhlY3V0aW9uIGNvbnRleHRcbiAgICAgICAgICAgIC8vIFRoaXMgZW5zdXJlcyBvYnNlcnZhYmlsaXR5IGV2ZW50cyAoZmFpbHVyZXMpIGFyZSBsaW5rZWQgdG8gdGhlIGNvcnJlY3Qgb3JpZ2luYXRpbmcgcmVxdWVzdFxuICAgICAgICAgICAgYXdhaXQgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQocmVjb3JkQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gRGVjbGFyZSB2YXJpYWJsZXMgaW4gb3V0ZXIgc2NvcGUgc28gdGhleSdyZSBhY2Nlc3NpYmxlIGluIGNhdGNoIGJsb2NrXG4gICAgICAgICAgICAgICAgLy8gZXZlbiBpZiBKU09OLnBhcnNlIGZhaWxzXG4gICAgICAgICAgICAgICAgbGV0IGVtYWlsTWVzc2FnZTogSUVtYWlsTWVzc2FnZSB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICBsZXQgdGVtcGxhdGVEYXRhOiBhbnk7XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIG1lc3NhZ2Ugd2l0aCBJRDonLCByZWNvcmQubWVzc2FnZUlkKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBQYXJzZSBtZXNzYWdlIGJvZHlcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyZWNvcmQuYm9keSkgYXMgeyBlbWFpbE1lc3NhZ2U6IElFbWFpbE1lc3NhZ2UsIHRlbXBsYXRlRGF0YTogYW55IH07XG4gICAgICAgICAgICAgICAgICAgIGVtYWlsTWVzc2FnZSA9IHBhcnNlZC5lbWFpbE1lc3NhZ2U7XG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlRGF0YSA9IHBhcnNlZC50ZW1wbGF0ZURhdGE7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU3BlY2lhbCBjYXNlOiBUZXN0IHJlbmRlciB0ZW1wbGF0ZSAodXNlZCBmb3IgdmFsaWRhdGlvbi9wcmV2aWV3KVxuICAgICAgICAgICAgICAgICAgICAvLyBEb2VzIG5vdCBzZW5kIGFjdHVhbCBlbWFpbCwganVzdCB2YWxpZGF0ZXMgdGVtcGxhdGUgcmVuZGVyaW5nXG4gICAgICAgICAgICAgICAgICAgIGlmICh0ZW1wbGF0ZURhdGEgJiYgdGVtcGxhdGVEYXRhWyAndGVzdFJlbmRlckVtYWlsVGVtcGxhdGUnIF0pIHtcblxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBUZXN0UmVuZGVyRW1haWxUZW1wbGF0ZUNvbW1hbmQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRlbXBsYXRlTmFtZTogZW1haWxNZXNzYWdlLlRlbXBsYXRlTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUZW1wbGF0ZURhdGE6IEpTT04uc3RyaW5naWZ5KHsgLi4uZW1haWxNZXNzYWdlLCAuLi50ZW1wbGF0ZURhdGEgfSksXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnNlc0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdUZXN0IHJlbmRlciByZXNwb25zZTonLCByZXNwb25zZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIENvbnN0cnVjdCBlbWFpbCBwYXJhbWV0ZXJzXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG1haWxQYXJhbXM6IFNlbmRFbWFpbENvbW1hbmRJbnB1dCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEZyb21FbWFpbEFkZHJlc3M6IGVtYWlsTWVzc2FnZS5Gcm9tRW1haWxBZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgICAgICAgRGVzdGluYXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUb0FkZHJlc3NlczogWyBlbWFpbE1lc3NhZ2UuVG9FbWFpbEFkZHJlc3MgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBDb250ZW50OiB7fVxuICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIGEgdGVtcGxhdGUgbmFtZSBpcyBwcm92aWRlZCwgdXNlIGl0XG4gICAgICAgICAgICAgICAgICAgIGlmIChlbWFpbE1lc3NhZ2UuVGVtcGxhdGVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYWlsUGFyYW1zLkNvbnRlbnQhLlRlbXBsYXRlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRlbXBsYXRlTmFtZTogZW1haWxNZXNzYWdlLlRlbXBsYXRlTmFtZSwgLy9jaGFuZ2UgdG8gZ2V0IGZ1bGwgdGVtcGxhdGUgbmFtZSBmcm9tIGZ3MjRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUZW1wbGF0ZURhdGE6IEpTT04uc3RyaW5naWZ5KHsgLi4uZW1haWxNZXNzYWdlLCAuLi50ZW1wbGF0ZURhdGEgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAvLyBpZiBib2R5IGFuZCBzdWJqZWN0IGFyZSBwcm92aWRlZCwgdXNlIHRoZW1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoZW1haWxNZXNzYWdlLk1lc3NhZ2UgJiYgZW1haWxNZXNzYWdlLlN1YmplY3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1haWxQYXJhbXMuQ29udGVudCEuU2ltcGxlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEJvZHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgVGV4dDogeyBEYXRhOiBlbWFpbE1lc3NhZ2UuTWVzc2FnZSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgU3ViamVjdDogeyBEYXRhOiBlbWFpbE1lc3NhZ2UuU3ViamVjdCB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGVtYWlsTWVzc2FnZS5IVE1MTWVzc2FnZSAmJiBlbWFpbE1lc3NhZ2UuU3ViamVjdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFpbFBhcmFtcy5Db250ZW50IS5TaW1wbGUgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgQm9keToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBIdG1sOiB7IERhdGE6IGVtYWlsTWVzc2FnZS5IVE1MTWVzc2FnZSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgU3ViamVjdDogeyBEYXRhOiBlbWFpbE1lc3NhZ2UuU3ViamVjdCB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIG1lc3NhZ2UgZm9ybWF0LiBFaXRoZXIgcHJvdmlkZSBbYFRlbXBsYXRlTmFtZWAgb3IgYE1lc3NhZ2VgIG9yIGBIVE1MTWVzc2FnZWBdIGFuZCBgU3ViamVjdGAuJyk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBpZiByZXBseSB0byBhZGRyZXNzIGlzIHByb3ZpZGVkLCB1c2UgaXRcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVtYWlsTWVzc2FnZS5SZXBseVRvRW1haWxBZGRyZXNzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYWlsUGFyYW1zLlJlcGx5VG9BZGRyZXNzZXMgPSBbIGVtYWlsTWVzc2FnZS5SZXBseVRvRW1haWxBZGRyZXNzIF07XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU2VuZGluZyBlbWFpbCB3aXRoIHBhcmFtZXRlcnM6JywgbWFpbFBhcmFtcyk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU2VuZCB0aGUgZW1haWxcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBTZW5kRW1haWxDb21tYW5kKG1haWxQYXJhbXMpO1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIE9wdGlvbmFsIHN1Y2Nlc3MgdHJhY2tpbmcgKG9wdC1pbiB2aWEgb2JzZXJ2YWJpbGl0eS50cmFja1N1Y2Nlc3MgY29uZmlnKVxuICAgICAgICAgICAgICAgICAgICBpZiAodHJhY2tTdWNjZXNzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBTcGFuT2JzZXJ2ZXIuZ2V0Q3VycmVudFNwYW4oKT8uY2hlY2twb2ludD8uKCdlbWFpbC5zZW50Jywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLm1lc3NhZ2VfaWQnOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwucmVjaXBpZW50JzogZW1haWxNZXNzYWdlLlRvRW1haWxBZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwudHlwZSc6IGVtYWlsTWVzc2FnZS5UZW1wbGF0ZU5hbWUgPyAndGVtcGxhdGUnIDogJ3NpbXBsZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC50ZW1wbGF0ZV9uYW1lJzogZW1haWxNZXNzYWdlLlRlbXBsYXRlTmFtZSB8fCAnJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLnNlbnQnOiAxLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbWFpbFN1YmplY3Q6IGVtYWlsTWVzc2FnZS5TdWJqZWN0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Vycm9yIHByb2Nlc3NpbmcgbWVzc2FnZTonLCByZWNvcmQpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3I6JywgZXJyb3IpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFRyYWNrIGZhaWx1cmUgd2l0aCBkZXRhaWxlZCBjb250ZXh0LlxuICAgICAgICAgICAgICAgICAgICAvLyBTYWZlIGV2ZW4gaWYgSlNPTi5wYXJzZSBmYWlsZWQgKGVtYWlsTWVzc2FnZSB3aWxsIGJlIHVuZGVmaW5lZCkuXG4gICAgICAgICAgICAgICAgICAgIC8vIFRoaXMgZW5hYmxlcyBmaWx0ZXJpbmcvcXVlcnlpbmcgZmFpbGVkIGVtYWlscyBieSByZWNpcGllbnQsIHRlbXBsYXRlLCBldGMuXG4gICAgICAgICAgICAgICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ2VtYWlsLnNlbmQuZmFpbGVkJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC5mYWlsZWQnOiAxLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwubWVzc2FnZV9pZCc6IHJlY29yZC5tZXNzYWdlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLnJlY2lwaWVudCc6IGVtYWlsTWVzc2FnZT8uVG9FbWFpbEFkZHJlc3MgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC50eXBlJzogZW1haWxNZXNzYWdlPy5UZW1wbGF0ZU5hbWUgPyAndGVtcGxhdGUnIDogJ3NpbXBsZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLnRlbXBsYXRlX25hbWUnOiBlbWFpbE1lc3NhZ2U/LlRlbXBsYXRlTmFtZSB8fCAnJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZXJyb3IudHlwZSc6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5jb25zdHJ1Y3Rvci5uYW1lIDogdHlwZW9mIGVycm9yLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlcnJvci5tZXNzYWdlJzogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbWFpbFN1YmplY3Q6IGVtYWlsTWVzc2FnZT8uU3ViamVjdCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpLFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuXG4gICAgICAgICAgICAgICAgICAgIC8vIE1hcmsgdGhpcyBtZXNzYWdlIGZvciByZXRyeSBieSBTUVNcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYmF0Y2hJdGVtRmFpbHVyZTogU1FTQmF0Y2hJdGVtRmFpbHVyZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1JZGVudGlmaWVyOiByZWNvcmQubWVzc2FnZUlkXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGJhdGNoSXRlbUZhaWx1cmVzLnB1c2goYmF0Y2hJdGVtRmFpbHVyZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdNYWlsIFByb2Nlc3NpbmcgY29tcGxldGUuJywge1xuICAgICAgICAgICAgdG90YWxSZWNvcmRzOiBldmVudC5SZWNvcmRzLmxlbmd0aCxcbiAgICAgICAgICAgIGZhaWx1cmVzOiBiYXRjaEl0ZW1GYWlsdXJlcy5sZW5ndGgsXG4gICAgICAgICAgICBzdWNjZXNzZXM6IGV2ZW50LlJlY29yZHMubGVuZ3RoIC0gYmF0Y2hJdGVtRmFpbHVyZXMubGVuZ3RoLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBTUVMgUGFydGlhbCBCYXRjaCBGYWlsdXJlIGNvbnRyYWN0OlxuICAgICAgICAvLyAtIFJldHVybiB2b2lkL3VuZGVmaW5lZCBpZiBhbGwgbWVzc2FnZXMgcHJvY2Vzc2VkIHN1Y2Nlc3NmdWxseVxuICAgICAgICAvLyAtIFJldHVybiBTUVNCYXRjaFJlc3BvbnNlIHdpdGggZmFpbGVkIG1lc3NhZ2UgSURzIGlmIHNvbWUgZmFpbGVkXG4gICAgICAgIC8vIEZhaWxlZCBtZXNzYWdlcyB3aWxsIGJlIHJldHJpZWQgYnkgU1FTLCBzdWNjZXNzZnVsIG9uZXMgd29uJ3QgYmUgcmVwcm9jZXNzZWRcbiAgICAgICAgaWYgKGJhdGNoSXRlbUZhaWx1cmVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGJhdGNoSXRlbUZhaWx1cmVzOiBiYXRjaEl0ZW1GYWlsdXJlc1xuICAgICAgICB9O1xuICAgIH1cbn1cblxuLy8gRXhwb3J0IGhhbmRsZXIgdXNpbmcgdGhlIENyZWF0ZUhhbmRsZXIgcGF0dGVyblxuLy8gVGhpcyBpbnN0YW50aWF0ZXMgdGhlIGNsYXNzIGFuZCBiaW5kcyB0aGUgTGFtYmRhSGFuZGxlciBtZXRob2RcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gTWFpbFByb2Nlc3Nvci5DcmVhdGVIYW5kbGVyKE1haWxQcm9jZXNzb3IpOyJdfQ==