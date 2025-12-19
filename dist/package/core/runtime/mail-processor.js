"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = exports.MailProcessor = void 0;
const client_sesv2_1 = require("@aws-sdk/client-sesv2");
const sqs_controller_1 = require("./sqs-controller");
const execution_context_1 = require("./execution-context");
const observability_1 = require("../../observability");
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
        this.sesClient = new client_sesv2_1.SESv2Client();
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
            // This links the email processing back to the originating API request/task.
            const traceCtx = (0, execution_context_1.extractFromSqs)(record.messageAttributes);
            const recordCtx = (0, execution_context_1.createExecutionContext)({
                correlationId: traceCtx?.correlationId || record.messageId,
                parentObservabilityLogId: traceCtx?.parentObservabilityLogId,
                causedBy: traceCtx?.causedBy,
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
                        observability_1.SpanObserver.addEventToCurrentSpan('email.sent', {
                            level: 'info',
                            metrics: {
                                'email.sent': 1,
                            },
                            attributes: {
                                'email.message_id': record.messageId,
                                'email.recipient': emailMessage.ToEmailAddress,
                                'email.type': emailMessage.TemplateName ? 'template' : 'simple',
                                'email.template_name': emailMessage.TemplateName,
                            },
                            data: {
                                subject: emailMessage.Subject,
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
                    observability_1.SpanObserver.addEventToCurrentSpan('email.send.failed', {
                        level: 'error',
                        metrics: {
                            'email.failed': 1,
                        },
                        attributes: {
                            'email.message_id': record.messageId,
                            'email.recipient': emailMessage?.ToEmailAddress || 'unknown',
                            'email.type': emailMessage?.TemplateName ? 'template' : 'simple',
                            'email.template_name': emailMessage?.TemplateName,
                            'error.type': error instanceof Error ? error.constructor.name : typeof error,
                            'error.message': error instanceof Error ? error.message : String(error),
                        },
                        data: {
                            subject: emailMessage?.Subject,
                            error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
                        },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbC1wcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL21haWwtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHdEQUE2SDtBQUU3SCxxREFBOEY7QUFDOUYsMkRBQXNHO0FBQ3RHLHVEQUFtRDtBQWVuRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsTUFBYSxhQUFjLFNBQVEsZ0NBQWU7SUFDdEMsU0FBUyxDQUFjO0lBRS9CO1FBQ0ksS0FBSyxFQUFFLENBQUM7UUFDUixrREFBa0Q7UUFDbEQsbURBQW1EO1FBQ25ELElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSwwQkFBVyxFQUFFLENBQUM7SUFDdkMsQ0FBQztJQUVTLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBZ0IsRUFBRSxRQUFpQjtRQUMxRCxnREFBZ0Q7SUFDcEQsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBZSxFQUFFLFFBQWlCLEVBQUUsSUFBNEI7UUFDMUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBMEIsRUFBRSxDQUFDO1FBRXBELDhFQUE4RTtRQUM5RSxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixLQUFLLE1BQU0sQ0FBQztRQUVoRSxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNqQyw2RUFBNkU7WUFDN0UsNEVBQTRFO1lBQzVFLE1BQU0sUUFBUSxHQUFHLElBQUEsa0NBQWMsRUFBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUMxRCxNQUFNLFNBQVMsR0FBRyxJQUFBLDBDQUFzQixFQUFDO2dCQUNyQyxhQUFhLEVBQUUsUUFBUSxFQUFFLGFBQWEsSUFBSSxNQUFNLENBQUMsU0FBUztn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RSxNQUFNLENBQUMsU0FBUztxQkFDbkMsQ0FBQztvQkFDRixpQkFBaUIsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztnQkFDN0MsQ0FBQztZQUNMLENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDJCQUEyQixFQUFFO1lBQzFDLFlBQVksRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07WUFDbEMsUUFBUSxFQUFFLGlCQUFpQixDQUFDLE1BQU07WUFDbEMsU0FBUyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLGlCQUFpQixDQUFDLE1BQU07U0FDN0QsQ0FBQyxDQUFDO1FBRUgsc0NBQXNDO1FBQ3RDLGlFQUFpRTtRQUNqRSxtRUFBbUU7UUFDbkUsK0VBQStFO1FBQy9FLElBQUksaUJBQWlCLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2pDLE9BQU87UUFDWCxDQUFDO1FBRUQsT0FBTztZQUNILGlCQUFpQixFQUFFLGlCQUFpQjtTQUN2QyxDQUFDO0lBQ04sQ0FBQztDQUNKO0FBeExELHNDQXdMQztBQUVELGlEQUFpRDtBQUNqRCxpRUFBaUU7QUFDcEQsUUFBQSxPQUFPLEdBQUcsYUFBYSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNFU3YyQ2xpZW50LCBTZW5kRW1haWxDb21tYW5kLCBTZW5kRW1haWxDb21tYW5kSW5wdXQsIFRlc3RSZW5kZXJFbWFpbFRlbXBsYXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZXN2Mic7XG5pbXBvcnQgdHlwZSB7IFNRU0JhdGNoSXRlbUZhaWx1cmUsIFNRU0JhdGNoUmVzcG9uc2UsIFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBRdWV1ZUNvbnRyb2xsZXIsIFF1ZXVlUHJvY2Vzc1Jlc3VsdCwgUXVldWVFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi9zcXMtY29udHJvbGxlcic7XG5pbXBvcnQgeyBleHRyYWN0RnJvbVNxcywgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuXG4vKipcbiAqIEVtYWlsIG1lc3NhZ2Ugc3RydWN0dXJlIHNlbnQgdmlhIFNRU1xuICovXG5leHBvcnQgaW50ZXJmYWNlIElFbWFpbE1lc3NhZ2Uge1xuICAgIEZyb21FbWFpbEFkZHJlc3M6IHN0cmluZztcbiAgICBUb0VtYWlsQWRkcmVzczogc3RyaW5nO1xuICAgIFN1YmplY3Q/OiBzdHJpbmc7XG4gICAgTWVzc2FnZT86IHN0cmluZztcbiAgICBIVE1MTWVzc2FnZT86IHN0cmluZztcbiAgICBUZW1wbGF0ZU5hbWU/OiBzdHJpbmc7XG4gICAgUmVwbHlUb0VtYWlsQWRkcmVzcz86IHN0cmluZztcbn1cblxuLyoqXG4gKiBNYWlsIHByb2Nlc3NvciB0aGF0IHNlbmRzIGVtYWlscyB2aWEgQVdTIFNFUy5cbiAqIFxuICogS2V5IERlc2lnbiBEZWNpc2lvbnM6XG4gKiAxLiBQZXItcmVjb3JkIGV4ZWN1dGlvbiBjb250ZXh0IGZvciBkaXN0cmlidXRlZCB0cmFjaW5nXG4gKiAyLiBHcmFudWxhciBmYWlsdXJlIHRyYWNraW5nIHdpdGggZGV0YWlsZWQgYXR0cmlidXRlcyAoYWx3YXlzIGVuYWJsZWQpXG4gKiAzLiBPcHRpb25hbCBzdWNjZXNzIHRyYWNraW5nIChkaXNhYmxlZCBieSBkZWZhdWx0KSB2aWEgVFJBQ0tfRU1BSUxfU1VDQ0VTUyBlbnYgdmFyXG4gKiA0LiBTRVMgY2xpZW50IGluaXRpYWxpemVkIGluIGNvbnN0cnVjdG9yIGZvciByZXVzZSBhY3Jvc3Mgd2FybSBzdGFydHNcbiAqIDUuIFJldHVybnMgdm9pZCBmb3IgYWxsIHN1Y2Nlc3MsIFNRU0JhdGNoUmVzcG9uc2Ugb25seSBmb3IgZmFpbHVyZXNcbiAqIFxuICogQ29uZmlndXJhdGlvbjpcbiAqIFxuICogVmlhIE1haWxlckNvbnN0cnVjdDpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIG5ldyBNYWlsZXJDb25zdHJ1Y3Qoe1xuICogICBkb21haW46ICdleGFtcGxlLmNvbScsXG4gKiAgIHRyYWNrRW1haWxTdWNjZXNzOiB0cnVlICAvLyBFbmFibGUgZm9yIGNvbXBsaWFuY2UvYXVkaXRcbiAqIH0pO1xuICogYGBgXG4gKiBcbiAqIE9yIHNldCBUUkFDS19FTUFJTF9TVUNDRVNTPSd0cnVlJyBlbnZpcm9ubWVudCB2YXJpYWJsZSBkaXJlY3RseS5cbiAqL1xuZXhwb3J0IGNsYXNzIE1haWxQcm9jZXNzb3IgZXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXIge1xuICAgIHByaXZhdGUgc2VzQ2xpZW50OiBTRVN2MkNsaWVudDtcblxuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICAvLyBJbml0aWFsaXplIFNFUyBjbGllbnQgb25jZSBwZXIgTGFtYmRhIGNvbnRhaW5lclxuICAgICAgICAvLyBSZXVzZWQgYWNyb3NzIHdhcm0gc3RhcnRzIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2VcbiAgICAgICAgdGhpcy5zZXNDbGllbnQgPSBuZXcgU0VTdjJDbGllbnQoKTtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IFNRU0V2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBTRVMgY2xpZW50IGFscmVhZHkgaW5pdGlhbGl6ZWQgaW4gY29uc3RydWN0b3JcbiAgICB9XG5cbiAgICBhc3luYyBwcm9jZXNzKGV2ZW50OiBTUVNFdmVudCwgX2NvbnRleHQ6IENvbnRleHQsIF9jdHg/OiBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFF1ZXVlUHJvY2Vzc1Jlc3VsdD4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTWFpbCBIYW5kbGVyIFJlY2VpdmVkIGV2ZW50OicsIGV2ZW50KTtcblxuICAgICAgICBjb25zdCBiYXRjaEl0ZW1GYWlsdXJlczogU1FTQmF0Y2hJdGVtRmFpbHVyZVtdID0gW107XG5cbiAgICAgICAgLy8gQ2hlY2sgc3VjY2VzcyB0cmFja2luZyBjb25maWcgb25jZSBmb3IgdGhlIGJhdGNoICh2aWEgZW52aXJvbm1lbnQgdmFyaWFibGUpXG4gICAgICAgIGNvbnN0IHRyYWNrU3VjY2VzcyA9IHByb2Nlc3MuZW52LlRSQUNLX0VNQUlMX1NVQ0NFU1MgPT09ICd0cnVlJztcblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XG4gICAgICAgICAgICAvLyBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciBkaXN0cmlidXRlZCB0cmFjaW5nLlxuICAgICAgICAgICAgLy8gVGhpcyBsaW5rcyB0aGUgZW1haWwgcHJvY2Vzc2luZyBiYWNrIHRvIHRoZSBvcmlnaW5hdGluZyBBUEkgcmVxdWVzdC90YXNrLlxuICAgICAgICAgICAgY29uc3QgdHJhY2VDdHggPSBleHRyYWN0RnJvbVNxcyhyZWNvcmQubWVzc2FnZUF0dHJpYnV0ZXMpO1xuICAgICAgICAgICAgY29uc3QgcmVjb3JkQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICAgICAgICAgICAgY29ycmVsYXRpb25JZDogdHJhY2VDdHg/LmNvcnJlbGF0aW9uSWQgfHwgcmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgICAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHRyYWNlQ3R4Py5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgICAgICAgICAgY2F1c2VkQnk6IHRyYWNlQ3R4Py5jYXVzZWRCeSxcbiAgICAgICAgICAgICAgICBzYW1wbGVkOiB0cmFjZUN0eD8uc2FtcGxlZCxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGVhY2ggZW1haWwgaW4gaXRzIG93biBleGVjdXRpb24gY29udGV4dFxuICAgICAgICAgICAgLy8gVGhpcyBlbnN1cmVzIG9ic2VydmFiaWxpdHkgZXZlbnRzIChmYWlsdXJlcykgYXJlIGxpbmtlZCB0byB0aGUgY29ycmVjdCBvcmlnaW5hdGluZyByZXF1ZXN0XG4gICAgICAgICAgICBhd2FpdCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChyZWNvcmRDdHgsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBEZWNsYXJlIHZhcmlhYmxlcyBpbiBvdXRlciBzY29wZSBzbyB0aGV5J3JlIGFjY2Vzc2libGUgaW4gY2F0Y2ggYmxvY2tcbiAgICAgICAgICAgICAgICAvLyBldmVuIGlmIEpTT04ucGFyc2UgZmFpbHNcbiAgICAgICAgICAgICAgICBsZXQgZW1haWxNZXNzYWdlOiBJRW1haWxNZXNzYWdlIHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgICAgIGxldCB0ZW1wbGF0ZURhdGE6IGFueTtcblxuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Byb2Nlc3NpbmcgbWVzc2FnZSB3aXRoIElEOicsIHJlY29yZC5tZXNzYWdlSWQpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhcnNlIG1lc3NhZ2UgYm9keVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJlY29yZC5ib2R5KSBhcyB7IGVtYWlsTWVzc2FnZTogSUVtYWlsTWVzc2FnZSwgdGVtcGxhdGVEYXRhOiBhbnkgfTtcbiAgICAgICAgICAgICAgICAgICAgZW1haWxNZXNzYWdlID0gcGFyc2VkLmVtYWlsTWVzc2FnZTtcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGVEYXRhID0gcGFyc2VkLnRlbXBsYXRlRGF0YTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBTcGVjaWFsIGNhc2U6IFRlc3QgcmVuZGVyIHRlbXBsYXRlICh1c2VkIGZvciB2YWxpZGF0aW9uL3ByZXZpZXcpXG4gICAgICAgICAgICAgICAgICAgIC8vIERvZXMgbm90IHNlbmQgYWN0dWFsIGVtYWlsLCBqdXN0IHZhbGlkYXRlcyB0ZW1wbGF0ZSByZW5kZXJpbmdcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRlbXBsYXRlRGF0YSAmJiB0ZW1wbGF0ZURhdGFbICd0ZXN0UmVuZGVyRW1haWxUZW1wbGF0ZScgXSkge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IFRlc3RSZW5kZXJFbWFpbFRlbXBsYXRlQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgVGVtcGxhdGVOYW1lOiBlbWFpbE1lc3NhZ2UuVGVtcGxhdGVOYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRlbXBsYXRlRGF0YTogSlNPTi5zdHJpbmdpZnkoeyAuLi5lbWFpbE1lc3NhZ2UsIC4uLnRlbXBsYXRlRGF0YSB9KSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuc2VzQ2xpZW50LnNlbmQoY29tbWFuZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Rlc3QgcmVuZGVyIHJlc3BvbnNlOicsIHJlc3BvbnNlKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gQ29uc3RydWN0IGVtYWlsIHBhcmFtZXRlcnNcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbWFpbFBhcmFtczogU2VuZEVtYWlsQ29tbWFuZElucHV0ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgRnJvbUVtYWlsQWRkcmVzczogZW1haWxNZXNzYWdlLkZyb21FbWFpbEFkZHJlc3MsXG4gICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbjoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRvQWRkcmVzc2VzOiBbIGVtYWlsTWVzc2FnZS5Ub0VtYWlsQWRkcmVzcyBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIENvbnRlbnQ6IHt9XG4gICAgICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgYSB0ZW1wbGF0ZSBuYW1lIGlzIHByb3ZpZGVkLCB1c2UgaXRcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVtYWlsTWVzc2FnZS5UZW1wbGF0ZU5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1haWxQYXJhbXMuQ29udGVudCEuVGVtcGxhdGUgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgVGVtcGxhdGVOYW1lOiBlbWFpbE1lc3NhZ2UuVGVtcGxhdGVOYW1lLCAvL2NoYW5nZSB0byBnZXQgZnVsbCB0ZW1wbGF0ZSBuYW1lIGZyb20gZncyNFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRlbXBsYXRlRGF0YTogSlNPTi5zdHJpbmdpZnkoeyAuLi5lbWFpbE1lc3NhZ2UsIC4uLnRlbXBsYXRlRGF0YSB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIC8vIGlmIGJvZHkgYW5kIHN1YmplY3QgYXJlIHByb3ZpZGVkLCB1c2UgdGhlbVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChlbWFpbE1lc3NhZ2UuTWVzc2FnZSAmJiBlbWFpbE1lc3NhZ2UuU3ViamVjdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFpbFBhcmFtcy5Db250ZW50IS5TaW1wbGUgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgQm9keToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUZXh0OiB7IERhdGE6IGVtYWlsTWVzc2FnZS5NZXNzYWdlIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWJqZWN0OiB7IERhdGE6IGVtYWlsTWVzc2FnZS5TdWJqZWN0IH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZW1haWxNZXNzYWdlLkhUTUxNZXNzYWdlICYmIGVtYWlsTWVzc2FnZS5TdWJqZWN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYWlsUGFyYW1zLkNvbnRlbnQhLlNpbXBsZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCb2R5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEh0bWw6IHsgRGF0YTogZW1haWxNZXNzYWdlLkhUTUxNZXNzYWdlIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWJqZWN0OiB7IERhdGE6IGVtYWlsTWVzc2FnZS5TdWJqZWN0IH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbWVzc2FnZSBmb3JtYXQuIEVpdGhlciBwcm92aWRlIFtgVGVtcGxhdGVOYW1lYCBvciBgTWVzc2FnZWAgb3IgYEhUTUxNZXNzYWdlYF0gYW5kIGBTdWJqZWN0YC4nKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIGlmIHJlcGx5IHRvIGFkZHJlc3MgaXMgcHJvdmlkZWQsIHVzZSBpdFxuICAgICAgICAgICAgICAgICAgICBpZiAoZW1haWxNZXNzYWdlLlJlcGx5VG9FbWFpbEFkZHJlc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1haWxQYXJhbXMuUmVwbHlUb0FkZHJlc3NlcyA9IFsgZW1haWxNZXNzYWdlLlJlcGx5VG9FbWFpbEFkZHJlc3MgXTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTZW5kaW5nIGVtYWlsIHdpdGggcGFyYW1ldGVyczonLCBtYWlsUGFyYW1zKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBTZW5kIHRoZSBlbWFpbFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IFNlbmRFbWFpbENvbW1hbmQobWFpbFBhcmFtcyk7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2VzQ2xpZW50LnNlbmQoY29tbWFuZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gT3B0aW9uYWwgc3VjY2VzcyB0cmFja2luZyAob3B0LWluIHZpYSBvYnNlcnZhYmlsaXR5LnRyYWNrU3VjY2VzcyBjb25maWcpXG4gICAgICAgICAgICAgICAgICAgIGlmICh0cmFja1N1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFNwYW5PYnNlcnZlci5hZGRFdmVudFRvQ3VycmVudFNwYW4oJ2VtYWlsLnNlbnQnLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC5zZW50JzogMSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLm1lc3NhZ2VfaWQnOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwucmVjaXBpZW50JzogZW1haWxNZXNzYWdlLlRvRW1haWxBZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwudHlwZSc6IGVtYWlsTWVzc2FnZS5UZW1wbGF0ZU5hbWUgPyAndGVtcGxhdGUnIDogJ3NpbXBsZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC50ZW1wbGF0ZV9uYW1lJzogZW1haWxNZXNzYWdlLlRlbXBsYXRlTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3ViamVjdDogZW1haWxNZXNzYWdlLlN1YmplY3QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3IgcHJvY2Vzc2luZyBtZXNzYWdlOicsIHJlY29yZCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvcjonLCBlcnJvcik7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gVHJhY2sgZmFpbHVyZSB3aXRoIGRldGFpbGVkIGNvbnRleHQuXG4gICAgICAgICAgICAgICAgICAgIC8vIFNhZmUgZXZlbiBpZiBKU09OLnBhcnNlIGZhaWxlZCAoZW1haWxNZXNzYWdlIHdpbGwgYmUgdW5kZWZpbmVkKS5cbiAgICAgICAgICAgICAgICAgICAgLy8gVGhpcyBlbmFibGVzIGZpbHRlcmluZy9xdWVyeWluZyBmYWlsZWQgZW1haWxzIGJ5IHJlY2lwaWVudCwgdGVtcGxhdGUsIGV0Yy5cbiAgICAgICAgICAgICAgICAgICAgU3Bhbk9ic2VydmVyLmFkZEV2ZW50VG9DdXJyZW50U3BhbignZW1haWwuc2VuZC5mYWlsZWQnLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwuZmFpbGVkJzogMSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLm1lc3NhZ2VfaWQnOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC5yZWNpcGllbnQnOiBlbWFpbE1lc3NhZ2U/LlRvRW1haWxBZGRyZXNzIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwudHlwZSc6IGVtYWlsTWVzc2FnZT8uVGVtcGxhdGVOYW1lID8gJ3RlbXBsYXRlJyA6ICdzaW1wbGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC50ZW1wbGF0ZV9uYW1lJzogZW1haWxNZXNzYWdlPy5UZW1wbGF0ZU5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Vycm9yLnR5cGUnOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IuY29uc3RydWN0b3IubmFtZSA6IHR5cGVvZiBlcnJvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZXJyb3IubWVzc2FnZSc6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3ViamVjdDogZW1haWxNZXNzYWdlPy5TdWJqZWN0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8geyBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLCBzdGFjazogZXJyb3Iuc3RhY2sgfSA6IFN0cmluZyhlcnJvciksXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBNYXJrIHRoaXMgbWVzc2FnZSBmb3IgcmV0cnkgYnkgU1FTXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJhdGNoSXRlbUZhaWx1cmU6IFNRU0JhdGNoSXRlbUZhaWx1cmUgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpdGVtSWRlbnRpZmllcjogcmVjb3JkLm1lc3NhZ2VJZFxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBiYXRjaEl0ZW1GYWlsdXJlcy5wdXNoKGJhdGNoSXRlbUZhaWx1cmUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTWFpbCBQcm9jZXNzaW5nIGNvbXBsZXRlLicsIHtcbiAgICAgICAgICAgIHRvdGFsUmVjb3JkczogZXZlbnQuUmVjb3Jkcy5sZW5ndGgsXG4gICAgICAgICAgICBmYWlsdXJlczogYmF0Y2hJdGVtRmFpbHVyZXMubGVuZ3RoLFxuICAgICAgICAgICAgc3VjY2Vzc2VzOiBldmVudC5SZWNvcmRzLmxlbmd0aCAtIGJhdGNoSXRlbUZhaWx1cmVzLmxlbmd0aCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gU1FTIFBhcnRpYWwgQmF0Y2ggRmFpbHVyZSBjb250cmFjdDpcbiAgICAgICAgLy8gLSBSZXR1cm4gdm9pZC91bmRlZmluZWQgaWYgYWxsIG1lc3NhZ2VzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHlcbiAgICAgICAgLy8gLSBSZXR1cm4gU1FTQmF0Y2hSZXNwb25zZSB3aXRoIGZhaWxlZCBtZXNzYWdlIElEcyBpZiBzb21lIGZhaWxlZFxuICAgICAgICAvLyBGYWlsZWQgbWVzc2FnZXMgd2lsbCBiZSByZXRyaWVkIGJ5IFNRUywgc3VjY2Vzc2Z1bCBvbmVzIHdvbid0IGJlIHJlcHJvY2Vzc2VkXG4gICAgICAgIGlmIChiYXRjaEl0ZW1GYWlsdXJlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBiYXRjaEl0ZW1GYWlsdXJlczogYmF0Y2hJdGVtRmFpbHVyZXNcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbi8vIEV4cG9ydCBoYW5kbGVyIHVzaW5nIHRoZSBDcmVhdGVIYW5kbGVyIHBhdHRlcm5cbi8vIFRoaXMgaW5zdGFudGlhdGVzIHRoZSBjbGFzcyBhbmQgYmluZHMgdGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IE1haWxQcm9jZXNzb3IuQ3JlYXRlSGFuZGxlcihNYWlsUHJvY2Vzc29yKTsiXX0=