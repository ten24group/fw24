import type { SQSHandler } from 'aws-lambda';
export interface IEmailMessage {
    FromEmailAddress: string;
    ToEmailAddress: string;
    Subject?: string;
    Message?: string;
    HTMLMessage?: string;
    TemplateName?: string;
    ReplyToEmailAddress?: string;
}
export declare const handler: SQSHandler;
