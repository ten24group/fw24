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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbC1wcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL21haWwtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHdEQUE2SDtBQUU3SCxxREFBOEY7QUFDOUYsMkRBQXNHO0FBQ3RHLHVEQUFtRDtBQWVuRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBcUJHO0FBQ0gsTUFBYSxhQUFjLFNBQVEsZ0NBQWU7SUFDdEMsU0FBUyxDQUFjO0lBRS9CO1FBQ0ksS0FBSyxFQUFFLENBQUM7UUFDUixrREFBa0Q7UUFDbEQsbURBQW1EO1FBQ25ELElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSwwQkFBVyxFQUFFLENBQUM7SUFDdkMsQ0FBQztJQUVTLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBZ0IsRUFBRSxRQUFpQjtRQUMxRCxnREFBZ0Q7SUFDcEQsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBZSxFQUFFLFFBQWlCLEVBQUUsSUFBNEI7UUFDMUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFekQsTUFBTSxpQkFBaUIsR0FBMEIsRUFBRSxDQUFDO1FBRXBELDhFQUE4RTtRQUM5RSxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixLQUFLLE1BQU0sQ0FBQztRQUVoRSxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNqQyw2RUFBNkU7WUFDN0UsNEZBQTRGO1lBQzVGLE1BQU0sUUFBUSxHQUFHLElBQUEsa0NBQWMsRUFBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUMxRCxNQUFNLFNBQVMsR0FBRyxJQUFBLDBDQUFzQixFQUFDO2dCQUNyQyxtQkFBbUI7Z0JBQ25CLDJEQUEyRDtnQkFDM0QsMERBQTBEO2dCQUMxRCxhQUFh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Q25DLENBQUM7b0JBQ0YsaUJBQWlCLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUM7Z0JBQzdDLENBQUM7WUFDTCxDQUFDLENBQUMsQ0FBQztRQUNQLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywyQkFBMkIsRUFBRTtZQUMxQyxZQUFZLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNO1lBQ2xDLFFBQVEsRUFBRSxpQkFBaUIsQ0FBQyxNQUFNO1lBQ2xDLFNBQVMsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sR0FBRyxpQkFBaUIsQ0FBQyxNQUFNO1NBQzdELENBQUMsQ0FBQztRQUVILHNDQUFzQztRQUN0QyxpRUFBaUU7UUFDakUsbUVBQW1FO1FBQ25FLCtFQUErRTtRQUMvRSxJQUFJLGlCQUFpQixDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNqQyxPQUFPO1FBQ1gsQ0FBQztRQUVELE9BQU87WUFDSCxpQkFBaUIsRUFBRSxpQkFBaUI7U0FDdkMsQ0FBQztJQUNOLENBQUM7Q0FDSjtBQXpMRCxzQ0F5TEM7QUFFRCxpREFBaUQ7QUFDakQsaUVBQWlFO0FBQ3BELFFBQUEsT0FBTyxHQUFHLGFBQWEsQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTRVN2MkNsaWVudCwgU2VuZEVtYWlsQ29tbWFuZCwgU2VuZEVtYWlsQ29tbWFuZElucHV0LCBUZXN0UmVuZGVyRW1haWxUZW1wbGF0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc2VzdjInO1xuaW1wb3J0IHR5cGUgeyBTUVNCYXRjaEl0ZW1GYWlsdXJlLCBTUVNCYXRjaFJlc3BvbnNlLCBTUVNFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUXVldWVDb250cm9sbGVyLCBRdWV1ZVByb2Nlc3NSZXN1bHQsIFF1ZXVlRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4vc3FzLWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgZXh0cmFjdEZyb21TcXMsIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LCBjcmVhdGVFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcblxuLyoqXG4gKiBFbWFpbCBtZXNzYWdlIHN0cnVjdHVyZSBzZW50IHZpYSBTUVNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRW1haWxNZXNzYWdlIHtcbiAgICBGcm9tRW1haWxBZGRyZXNzOiBzdHJpbmc7XG4gICAgVG9FbWFpbEFkZHJlc3M6IHN0cmluZztcbiAgICBTdWJqZWN0Pzogc3RyaW5nO1xuICAgIE1lc3NhZ2U/OiBzdHJpbmc7XG4gICAgSFRNTE1lc3NhZ2U/OiBzdHJpbmc7XG4gICAgVGVtcGxhdGVOYW1lPzogc3RyaW5nO1xuICAgIFJlcGx5VG9FbWFpbEFkZHJlc3M/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogTWFpbCBwcm9jZXNzb3IgdGhhdCBzZW5kcyBlbWFpbHMgdmlhIEFXUyBTRVMuXG4gKiBcbiAqIEtleSBEZXNpZ24gRGVjaXNpb25zOlxuICogMS4gUGVyLXJlY29yZCBleGVjdXRpb24gY29udGV4dCBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICogMi4gR3JhbnVsYXIgZmFpbHVyZSB0cmFja2luZyB3aXRoIGRldGFpbGVkIGF0dHJpYnV0ZXMgKGFsd2F5cyBlbmFibGVkKVxuICogMy4gT3B0aW9uYWwgc3VjY2VzcyB0cmFja2luZyAoZGlzYWJsZWQgYnkgZGVmYXVsdCkgdmlhIFRSQUNLX0VNQUlMX1NVQ0NFU1MgZW52IHZhclxuICogNC4gU0VTIGNsaWVudCBpbml0aWFsaXplZCBpbiBjb25zdHJ1Y3RvciBmb3IgcmV1c2UgYWNyb3NzIHdhcm0gc3RhcnRzXG4gKiA1LiBSZXR1cm5zIHZvaWQgZm9yIGFsbCBzdWNjZXNzLCBTUVNCYXRjaFJlc3BvbnNlIG9ubHkgZm9yIGZhaWx1cmVzXG4gKiBcbiAqIENvbmZpZ3VyYXRpb246XG4gKiBcbiAqIFZpYSBNYWlsZXJDb25zdHJ1Y3Q6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBuZXcgTWFpbGVyQ29uc3RydWN0KHtcbiAqICAgZG9tYWluOiAnZXhhbXBsZS5jb20nLFxuICogICB0cmFja0VtYWlsU3VjY2VzczogdHJ1ZSAgLy8gRW5hYmxlIGZvciBjb21wbGlhbmNlL2F1ZGl0XG4gKiB9KTtcbiAqIGBgYFxuICogXG4gKiBPciBzZXQgVFJBQ0tfRU1BSUxfU1VDQ0VTUz0ndHJ1ZScgZW52aXJvbm1lbnQgdmFyaWFibGUgZGlyZWN0bHkuXG4gKi9cbmV4cG9ydCBjbGFzcyBNYWlsUHJvY2Vzc29yIGV4dGVuZHMgUXVldWVDb250cm9sbGVyIHtcbiAgICBwcml2YXRlIHNlc0NsaWVudDogU0VTdjJDbGllbnQ7XG5cbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBTRVMgY2xpZW50IG9uY2UgcGVyIExhbWJkYSBjb250YWluZXJcbiAgICAgICAgLy8gUmV1c2VkIGFjcm9zcyB3YXJtIHN0YXJ0cyBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlXG4gICAgICAgIHRoaXMuc2VzQ2xpZW50ID0gbmV3IFNFU3YyQ2xpZW50KCk7XG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBTUVNFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gU0VTIGNsaWVudCBhbHJlYWR5IGluaXRpYWxpemVkIGluIGNvbnN0cnVjdG9yXG4gICAgfVxuXG4gICAgYXN5bmMgcHJvY2VzcyhldmVudDogU1FTRXZlbnQsIF9jb250ZXh0OiBDb250ZXh0LCBfY3R4PzogUXVldWVFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxRdWV1ZVByb2Nlc3NSZXN1bHQ+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ01haWwgSGFuZGxlciBSZWNlaXZlZCBldmVudDonLCBldmVudCk7XG5cbiAgICAgICAgY29uc3QgYmF0Y2hJdGVtRmFpbHVyZXM6IFNRU0JhdGNoSXRlbUZhaWx1cmVbXSA9IFtdO1xuXG4gICAgICAgIC8vIENoZWNrIHN1Y2Nlc3MgdHJhY2tpbmcgY29uZmlnIG9uY2UgZm9yIHRoZSBiYXRjaCAodmlhIGVudmlyb25tZW50IHZhcmlhYmxlKVxuICAgICAgICBjb25zdCB0cmFja1N1Y2Nlc3MgPSBwcm9jZXNzLmVudi5UUkFDS19FTUFJTF9TVUNDRVNTID09PSAndHJ1ZSc7XG5cbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgZXZlbnQuUmVjb3Jkcykge1xuICAgICAgICAgICAgLy8gRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU1FTIG1lc3NhZ2UgYXR0cmlidXRlcyBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZy5cbiAgICAgICAgICAgIC8vIFRoaXMgbGlua3MgdGhlIGVtYWlsIHByb2Nlc3NpbmcgYmFjayB0byB0aGUgaW1tZWRpYXRlIHVwc3RyZWFtIGludm9jYXRpb24gdmlhIGBjYXVzZWRCeWAuXG4gICAgICAgICAgICBjb25zdCB0cmFjZUN0eCA9IGV4dHJhY3RGcm9tU3FzKHJlY29yZC5tZXNzYWdlQXR0cmlidXRlcyk7XG4gICAgICAgICAgICBjb25zdCByZWNvcmRDdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgICAgICAgICAgICAvLyBTdHJpY3QgY29udHJhY3Q6XG4gICAgICAgICAgICAgICAgLy8gLSBjb3JyZWxhdGlvbklkIGlzIGxvY2FsIHRvIHRoaXMgcmVjb3JkIHByb2Nlc3Npbmcgc2xpY2VcbiAgICAgICAgICAgICAgICAvLyAtIGNhdXNlZEJ5IGxpbmtzIHRvIHRoZSB1cHN0cmVhbSBzZW5kZXIncyBjb3JyZWxhdGlvbklkXG4gICAgICAgICAgICAgICAgY29ycmVsYXRpb25JZDogcmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgICAgICAgICAgICBjYXVzZWRCeTogdHJhY2VDdHg/LmNhdXNlZEJ5ID8/IHRyYWNlQ3R4Py5jb3JyZWxhdGlvbklkLFxuICAgICAgICAgICAgICAgIHNhbXBsZWQ6IHRyYWNlQ3R4Py5zYW1wbGVkLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFByb2Nlc3MgZWFjaCBlbWFpbCBpbiBpdHMgb3duIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICAgICAgICAvLyBUaGlzIGVuc3VyZXMgb2JzZXJ2YWJpbGl0eSBldmVudHMgKGZhaWx1cmVzKSBhcmUgbGlua2VkIHRvIHRoZSBjb3JyZWN0IG9yaWdpbmF0aW5nIHJlcXVlc3RcbiAgICAgICAgICAgIGF3YWl0IHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KHJlY29yZEN0eCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIERlY2xhcmUgdmFyaWFibGVzIGluIG91dGVyIHNjb3BlIHNvIHRoZXkncmUgYWNjZXNzaWJsZSBpbiBjYXRjaCBibG9ja1xuICAgICAgICAgICAgICAgIC8vIGV2ZW4gaWYgSlNPTi5wYXJzZSBmYWlsc1xuICAgICAgICAgICAgICAgIGxldCBlbWFpbE1lc3NhZ2U6IElFbWFpbE1lc3NhZ2UgfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgbGV0IHRlbXBsYXRlRGF0YTogYW55O1xuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBtZXNzYWdlIHdpdGggSUQ6JywgcmVjb3JkLm1lc3NhZ2VJZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gUGFyc2UgbWVzc2FnZSBib2R5XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmVjb3JkLmJvZHkpIGFzIHsgZW1haWxNZXNzYWdlOiBJRW1haWxNZXNzYWdlLCB0ZW1wbGF0ZURhdGE6IGFueSB9O1xuICAgICAgICAgICAgICAgICAgICBlbWFpbE1lc3NhZ2UgPSBwYXJzZWQuZW1haWxNZXNzYWdlO1xuICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZURhdGEgPSBwYXJzZWQudGVtcGxhdGVEYXRhO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFNwZWNpYWwgY2FzZTogVGVzdCByZW5kZXIgdGVtcGxhdGUgKHVzZWQgZm9yIHZhbGlkYXRpb24vcHJldmlldylcbiAgICAgICAgICAgICAgICAgICAgLy8gRG9lcyBub3Qgc2VuZCBhY3R1YWwgZW1haWwsIGp1c3QgdmFsaWRhdGVzIHRlbXBsYXRlIHJlbmRlcmluZ1xuICAgICAgICAgICAgICAgICAgICBpZiAodGVtcGxhdGVEYXRhICYmIHRlbXBsYXRlRGF0YVsgJ3Rlc3RSZW5kZXJFbWFpbFRlbXBsYXRlJyBdKSB7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgVGVzdFJlbmRlckVtYWlsVGVtcGxhdGVDb21tYW5kKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUZW1wbGF0ZU5hbWU6IGVtYWlsTWVzc2FnZS5UZW1wbGF0ZU5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgVGVtcGxhdGVEYXRhOiBKU09OLnN0cmluZ2lmeSh7IC4uLmVtYWlsTWVzc2FnZSwgLi4udGVtcGxhdGVEYXRhIH0pLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5zZXNDbGllbnQuc2VuZChjb21tYW5kKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnVGVzdCByZW5kZXIgcmVzcG9uc2U6JywgcmVzcG9uc2UpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBDb25zdHJ1Y3QgZW1haWwgcGFyYW1ldGVyc1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYWlsUGFyYW1zOiBTZW5kRW1haWxDb21tYW5kSW5wdXQgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBGcm9tRW1haWxBZGRyZXNzOiBlbWFpbE1lc3NhZ2UuRnJvbUVtYWlsQWRkcmVzcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIERlc3RpbmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgVG9BZGRyZXNzZXM6IFsgZW1haWxNZXNzYWdlLlRvRW1haWxBZGRyZXNzIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgQ29udGVudDoge31cbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBJZiBhIHRlbXBsYXRlIG5hbWUgaXMgcHJvdmlkZWQsIHVzZSBpdFxuICAgICAgICAgICAgICAgICAgICBpZiAoZW1haWxNZXNzYWdlLlRlbXBsYXRlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFpbFBhcmFtcy5Db250ZW50IS5UZW1wbGF0ZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBUZW1wbGF0ZU5hbWU6IGVtYWlsTWVzc2FnZS5UZW1wbGF0ZU5hbWUsIC8vY2hhbmdlIHRvIGdldCBmdWxsIHRlbXBsYXRlIG5hbWUgZnJvbSBmdzI0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgVGVtcGxhdGVEYXRhOiBKU09OLnN0cmluZ2lmeSh7IC4uLmVtYWlsTWVzc2FnZSwgLi4udGVtcGxhdGVEYXRhIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gaWYgYm9keSBhbmQgc3ViamVjdCBhcmUgcHJvdmlkZWQsIHVzZSB0aGVtXG4gICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKGVtYWlsTWVzc2FnZS5NZXNzYWdlICYmIGVtYWlsTWVzc2FnZS5TdWJqZWN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtYWlsUGFyYW1zLkNvbnRlbnQhLlNpbXBsZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCb2R5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRleHQ6IHsgRGF0YTogZW1haWxNZXNzYWdlLk1lc3NhZ2UgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1YmplY3Q6IHsgRGF0YTogZW1haWxNZXNzYWdlLlN1YmplY3QgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChlbWFpbE1lc3NhZ2UuSFRNTE1lc3NhZ2UgJiYgZW1haWxNZXNzYWdlLlN1YmplY3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1haWxQYXJhbXMuQ29udGVudCEuU2ltcGxlID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEJvZHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgSHRtbDogeyBEYXRhOiBlbWFpbE1lc3NhZ2UuSFRNTE1lc3NhZ2UgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1YmplY3Q6IHsgRGF0YTogZW1haWxNZXNzYWdlLlN1YmplY3QgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBtZXNzYWdlIGZvcm1hdC4gRWl0aGVyIHByb3ZpZGUgW2BUZW1wbGF0ZU5hbWVgIG9yIGBNZXNzYWdlYCBvciBgSFRNTE1lc3NhZ2VgXSBhbmQgYFN1YmplY3RgLicpO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gaWYgcmVwbHkgdG8gYWRkcmVzcyBpcyBwcm92aWRlZCwgdXNlIGl0XG4gICAgICAgICAgICAgICAgICAgIGlmIChlbWFpbE1lc3NhZ2UuUmVwbHlUb0VtYWlsQWRkcmVzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWFpbFBhcmFtcy5SZXBseVRvQWRkcmVzc2VzID0gWyBlbWFpbE1lc3NhZ2UuUmVwbHlUb0VtYWlsQWRkcmVzcyBdO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1NlbmRpbmcgZW1haWwgd2l0aCBwYXJhbWV0ZXJzOicsIG1haWxQYXJhbXMpO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFNlbmQgdGhlIGVtYWlsXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgU2VuZEVtYWlsQ29tbWFuZChtYWlsUGFyYW1zKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXNDbGllbnQuc2VuZChjb21tYW5kKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBPcHRpb25hbCBzdWNjZXNzIHRyYWNraW5nIChvcHQtaW4gdmlhIG9ic2VydmFiaWxpdHkudHJhY2tTdWNjZXNzIGNvbmZpZylcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRyYWNrU3VjY2Vzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgU3Bhbk9ic2VydmVyLmdldEN1cnJlbnRTcGFuKCk/LmNoZWNrcG9pbnQ/LignZW1haWwuc2VudCcsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC5tZXNzYWdlX2lkJzogcmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLnJlY2lwaWVudCc6IGVtYWlsTWVzc2FnZS5Ub0VtYWlsQWRkcmVzcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLnR5cGUnOiBlbWFpbE1lc3NhZ2UuVGVtcGxhdGVOYW1lID8gJ3RlbXBsYXRlJyA6ICdzaW1wbGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwudGVtcGxhdGVfbmFtZSc6IGVtYWlsTWVzc2FnZS5UZW1wbGF0ZU5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC5zZW50JzogMSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZW1haWxTdWJqZWN0OiBlbWFpbE1lc3NhZ2UuU3ViamVjdCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciBwcm9jZXNzaW5nIG1lc3NhZ2U6JywgcmVjb3JkKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Vycm9yOicsIGVycm9yKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBUcmFjayBmYWlsdXJlIHdpdGggZGV0YWlsZWQgY29udGV4dC5cbiAgICAgICAgICAgICAgICAgICAgLy8gU2FmZSBldmVuIGlmIEpTT04ucGFyc2UgZmFpbGVkIChlbWFpbE1lc3NhZ2Ugd2lsbCBiZSB1bmRlZmluZWQpLlxuICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIGVuYWJsZXMgZmlsdGVyaW5nL3F1ZXJ5aW5nIGZhaWxlZCBlbWFpbHMgYnkgcmVjaXBpZW50LCB0ZW1wbGF0ZSwgZXRjLlxuICAgICAgICAgICAgICAgICAgICBTcGFuT2JzZXJ2ZXIuZ2V0Q3VycmVudFNwYW4oKT8uY2hlY2twb2ludD8uKCdlbWFpbC5zZW5kLmZhaWxlZCcsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwuZmFpbGVkJzogMSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2VtYWlsLm1lc3NhZ2VfaWQnOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC5yZWNpcGllbnQnOiBlbWFpbE1lc3NhZ2U/LlRvRW1haWxBZGRyZXNzIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwudHlwZSc6IGVtYWlsTWVzc2FnZT8uVGVtcGxhdGVOYW1lID8gJ3RlbXBsYXRlJyA6ICdzaW1wbGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlbWFpbC50ZW1wbGF0ZV9uYW1lJzogZW1haWxNZXNzYWdlPy5UZW1wbGF0ZU5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Vycm9yLnR5cGUnOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IuY29uc3RydWN0b3IubmFtZSA6IHR5cGVvZiBlcnJvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnZXJyb3IubWVzc2FnZSc6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW1haWxTdWJqZWN0OiBlbWFpbE1lc3NhZ2U/LlN1YmplY3QsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cblxuICAgICAgICAgICAgICAgICAgICAvLyBNYXJrIHRoaXMgbWVzc2FnZSBmb3IgcmV0cnkgYnkgU1FTXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJhdGNoSXRlbUZhaWx1cmU6IFNRU0JhdGNoSXRlbUZhaWx1cmUgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpdGVtSWRlbnRpZmllcjogcmVjb3JkLm1lc3NhZ2VJZFxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBiYXRjaEl0ZW1GYWlsdXJlcy5wdXNoKGJhdGNoSXRlbUZhaWx1cmUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTWFpbCBQcm9jZXNzaW5nIGNvbXBsZXRlLicsIHtcbiAgICAgICAgICAgIHRvdGFsUmVjb3JkczogZXZlbnQuUmVjb3Jkcy5sZW5ndGgsXG4gICAgICAgICAgICBmYWlsdXJlczogYmF0Y2hJdGVtRmFpbHVyZXMubGVuZ3RoLFxuICAgICAgICAgICAgc3VjY2Vzc2VzOiBldmVudC5SZWNvcmRzLmxlbmd0aCAtIGJhdGNoSXRlbUZhaWx1cmVzLmxlbmd0aCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gU1FTIFBhcnRpYWwgQmF0Y2ggRmFpbHVyZSBjb250cmFjdDpcbiAgICAgICAgLy8gLSBSZXR1cm4gdm9pZC91bmRlZmluZWQgaWYgYWxsIG1lc3NhZ2VzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHlcbiAgICAgICAgLy8gLSBSZXR1cm4gU1FTQmF0Y2hSZXNwb25zZSB3aXRoIGZhaWxlZCBtZXNzYWdlIElEcyBpZiBzb21lIGZhaWxlZFxuICAgICAgICAvLyBGYWlsZWQgbWVzc2FnZXMgd2lsbCBiZSByZXRyaWVkIGJ5IFNRUywgc3VjY2Vzc2Z1bCBvbmVzIHdvbid0IGJlIHJlcHJvY2Vzc2VkXG4gICAgICAgIGlmIChiYXRjaEl0ZW1GYWlsdXJlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBiYXRjaEl0ZW1GYWlsdXJlczogYmF0Y2hJdGVtRmFpbHVyZXNcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbi8vIEV4cG9ydCBoYW5kbGVyIHVzaW5nIHRoZSBDcmVhdGVIYW5kbGVyIHBhdHRlcm5cbi8vIFRoaXMgaW5zdGFudGlhdGVzIHRoZSBjbGFzcyBhbmQgYmluZHMgdGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IE1haWxQcm9jZXNzb3IuQ3JlYXRlSGFuZGxlcihNYWlsUHJvY2Vzc29yKTsiXX0=