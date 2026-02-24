import { SESv2Client, SendEmailCommand, SendEmailCommandInput, TestRenderEmailTemplateCommand } from '@aws-sdk/client-sesv2';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, Context } from 'aws-lambda';
import { QueueController, QueueProcessResult, QueueExecutionContext } from './sqs-controller';
import { extractFromSqs, runWithExecutionContext, createExecutionContext } from './execution-context';
import { SpanObserver } from '../../observability';

/**
 * Email message structure sent via SQS
 */
export interface IEmailMessage {
    FromEmailAddress: string;
    ToEmailAddress: string;
    Subject?: string;
    Message?: string;
    HTMLMessage?: string;
    TemplateName?: string;
    ReplyToEmailAddress?: string;
}

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
export class MailProcessor extends QueueController {
    private sesClient: SESv2Client;

    constructor() {
        super();
        // Initialize SES client once per Lambda container
        // Reused across warm starts for better performance
        this.sesClient = new SESv2Client();
    }

    protected async initialize(_event: SQSEvent, _context: Context): Promise<void> {
        // SES client already initialized in constructor
    }

    async process(event: SQSEvent, _context: Context, _ctx?: QueueExecutionContext): Promise<QueueProcessResult> {
        this.logger.debug('Mail Handler Received event:', event);

        const batchItemFailures: SQSBatchItemFailure[] = [];

        // Check success tracking config once for the batch (via environment variable)
        const trackSuccess = process.env.TRACK_EMAIL_SUCCESS === 'true';

        for (const record of event.Records) {
            // Extract trace context from SQS message attributes for distributed tracing.
            // This links the email processing back to the immediate upstream invocation via `causedBy`.
            const traceCtx = extractFromSqs(record.messageAttributes);
            const recordCtx = createExecutionContext({
                // Strict contract:
                // - correlationId is local to this record processing slice
                // - causedBy links to the upstream sender's correlationId
                correlationId: record.messageId,
                causedBy: traceCtx?.causedBy ?? traceCtx?.correlationId,
                sampled: traceCtx?.sampled,
            });

            // Process each email in its own execution context
            // This ensures observability events (failures) are linked to the correct originating request
            await runWithExecutionContext(recordCtx, async () => {
                // Declare variables in outer scope so they're accessible in catch block
                // even if JSON.parse fails
                let emailMessage: IEmailMessage | undefined;
                let templateData: any;

                try {
                    this.logger.info('Processing message with ID:', record.messageId);

                    // Parse message body
                    const parsed = JSON.parse(record.body) as { emailMessage: IEmailMessage, templateData: any };
                    emailMessage = parsed.emailMessage;
                    templateData = parsed.templateData;

                    // Special case: Test render template (used for validation/preview)
                    // Does not send actual email, just validates template rendering
                    if (templateData && templateData[ 'testRenderEmailTemplate' ]) {

                        const command = new TestRenderEmailTemplateCommand({
                            TemplateName: emailMessage.TemplateName,
                            TemplateData: JSON.stringify({ ...emailMessage, ...templateData }),
                        });

                        const response = await this.sesClient.send(command);

                        this.logger.info('Test render response:', response);

                        return;
                    }

                    // Construct email parameters
                    const mailParams: SendEmailCommandInput = {
                        FromEmailAddress: emailMessage.FromEmailAddress,
                        Destination: {
                            ToAddresses: [ emailMessage.ToEmailAddress ],
                        },
                        Content: {}
                    };

                    // If a template name is provided, use it
                    if (emailMessage.TemplateName) {
                        mailParams.Content!.Template = {
                            TemplateName: emailMessage.TemplateName, //change to get full template name from fw24
                            TemplateData: JSON.stringify({ ...emailMessage, ...templateData })
                        }
                    }
                    // if body and subject are provided, use them
                    else if (emailMessage.Message && emailMessage.Subject) {
                        mailParams.Content!.Simple = {
                            Body: {
                                Text: { Data: emailMessage.Message },
                            },
                            Subject: { Data: emailMessage.Subject },
                        }
                    } else if (emailMessage.HTMLMessage && emailMessage.Subject) {
                        mailParams.Content!.Simple = {
                            Body: {
                                Html: { Data: emailMessage.HTMLMessage },
                            },
                            Subject: { Data: emailMessage.Subject },
                        }
                    }
                    else {
                        throw new Error('Invalid message format. Either provide [`TemplateName` or `Message` or `HTMLMessage`] and `Subject`.');
                    }

                    // if reply to address is provided, use it
                    if (emailMessage.ReplyToEmailAddress) {
                        mailParams.ReplyToAddresses = [ emailMessage.ReplyToEmailAddress ];
                    }

                    this.logger.debug('Sending email with parameters:', mailParams);

                    // Send the email
                    const command = new SendEmailCommand(mailParams);
                    await this.sesClient.send(command);

                    // Optional success tracking (opt-in via observability.trackSuccess config)
                    if (trackSuccess) {
                        SpanObserver.getCurrentSpan()?.checkpoint?.('email.sent', {
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

                } catch (error) {
                    this.logger.error('Error processing message:', record);
                    this.logger.error('Error:', error);

                    // Track failure with detailed context.
                    // Safe even if JSON.parse failed (emailMessage will be undefined).
                    // This enables filtering/querying failed emails by recipient, template, etc.
                    SpanObserver.getCurrentSpan()?.checkpoint?.('email.send.failed', {
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
                    const batchItemFailure: SQSBatchItemFailure = {
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

// Export handler using the CreateHandler pattern
// This instantiates the class and binds the LambdaHandler method
export const handler = MailProcessor.CreateHandler(MailProcessor);