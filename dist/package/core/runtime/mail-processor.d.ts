import type { SQSEvent, Context } from 'aws-lambda';
import { QueueController, QueueProcessResult, QueueExecutionContext } from './sqs-controller';
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
export declare class MailProcessor extends QueueController {
    private sesClient;
    constructor();
    protected initialize(_event: SQSEvent, _context: Context): Promise<void>;
    process(event: SQSEvent, _context: Context, _ctx?: QueueExecutionContext): Promise<QueueProcessResult>;
}
export declare const handler: (event: any, context: any) => Promise<any>;
