import { Stack } from "aws-cdk-lib";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Represents the configuration for the Mailer construct.
 */
export interface IMailerConstructConfig extends IConstructConfig {
    /**
     * The domain for the mailer.
     */
    domain?: string;
    /**
     * Optional SES options.
     */
    sesOptions?: {};
    /**
     * The directory where the templates are located.
     */
    templatesDirectory?: string;
    /**
     * The properties for the queue.
     */
    queueProps?: QueueProps;
    /**
     * Track successful email sends (in addition to failures).
     * Enable for compliance, audit trails, or debugging.
     *
     * @default false
     * @example
     * ```ts
     * const mailerConfig: IMailerConstructConfig = {
     *   domain: 'example.com',
     *   trackEmailSuccess: true  // Enable for compliance/audit
     * };
     * ```
     */
    trackEmailSuccess?: boolean;
}
/**
 * Represents a Mailer construct that handles sending emails using AWS SES.
 */
export declare class MailerConstruct implements FW24Construct {
    private mailerConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    /**
     * Creates an instance of MailerConstruct.
     *
     * @param mailerConstructConfig - The configuration for the MailerConstruct.
     *
     * @example
     * ```ts
     * const mailerConfig: IMailerConstructConfig = {
     *   domain: 'example.com',
     *   queueProps: {
     *     visibilityTimeout: Duration.seconds(30),
     *     receiveMessageWaitTime: Duration.seconds(10),
     *   },
     *   templatesDirectory: './src/templates/email',
     * };
     * const mailer = new MailerConstruct(mailerConfig);
     * ```
     */
    constructor(mailerConstructConfig: IMailerConstructConfig);
    /**
     * Constructs the Mailer construct and creates the necessary AWS resources.
     */
    construct(): Promise<void>;
    /**
     * Registers the email templates.
     *
     * @param path - The path to the templates directory.
     *
     * @remarks
     * This method reads the template files from the specified directory, registers them as SES templates,
     * and sets the template names in the FW24 instance.
     *
     * @example
     * ```ts
     * const templatesDirectory = './src/templates/email';
     * this.registerTemplates(templatesDirectory);
     * ```
     */
    private registerTemplates;
}
