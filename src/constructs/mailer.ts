import { Stack, Duration, CfnOutput } from "aws-cdk-lib";
import { EmailIdentity, Identity, CfnTemplate } from "aws-cdk-lib/aws-ses";
import { QueueProps, Queue } from "aws-cdk-lib/aws-sqs";
import { Effect } from "aws-cdk-lib/aws-iam";
import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

import { Helper } from "../core/helper";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { QueueLambda } from "./queue-lambda";
import { createLogger, LogDuration } from "../logging";

/**
 * Represents the configuration for the Mailer construct.
 */
export interface IMailerConstructConfig {
    /**
     * The domain for the mailer.
     */
    domain: string;

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
}

/**
 * Represents a Mailer construct that handles sending emails using AWS SES.
 */
export class MailerConstruct implements FW24Construct {
    readonly logger = createLogger(MailerConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = MailerConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

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
    constructor(private mailerConstructConfig: IMailerConstructConfig) {
        this.logger.debug("constructor:");

        Helper.hydrateConfig(mailerConstructConfig, "SES");
        this.fw24.emailProvider = this;
    }

    /**
     * Constructs the Mailer construct and creates the necessary AWS resources.
     */
    @LogDuration()
    public async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack("main");

        // create identity
        const identity = new EmailIdentity(this.mainStack, `${this.fw24.appName}-ses-identity`, {
            identity: Identity.domain(this.mailerConstructConfig.domain),
        });

        // create main queue
        const queue = new QueueLambda(this.mainStack, `${this.fw24.appName}-mail-queue`, {
            queueName: `emailQueue`,
            queueProps: {
                visibilityTimeout: Duration.seconds(30),
                receiveMessageWaitTime: Duration.seconds(10),
                ...this.mailerConstructConfig.queueProps,
            },
            lambdaFunctionProps: {
                entry: join(__dirname, "../core/runtime/mail-processor.js"),
                policies: [
                    {
                        actions: [
                            "ses:SendEmail",
                            "SES:SendRawEmail",
                            "SES:SendTemplatedEmail",
                            "SES:SendBulkTemplatedEmail",
                            "SES:TestRenderEmailTemplate",
                        ],
                        resources: ["*"],
                        effect: Effect.ALLOW,
                    },
                ],
            },
            sqsEventSourceProps: {
                batchSize: 5,
                maxBatchingWindow: Duration.seconds(5),
                reportBatchItemFailures: true,
            },
        }) as Queue;

        // sets the default templates directory if not defined
        if (this.mailerConstructConfig.templatesDirectory === undefined || this.mailerConstructConfig.templatesDirectory === "") {
            this.mailerConstructConfig.templatesDirectory = "./src/templates/email";
        }
        // register the templates
        this.registerTemplates(this.mailerConstructConfig.templatesDirectory);

        // print queue url
        new CfnOutput(this.mainStack, "mail-queue-url", {
            value: queue.queueUrl,
            exportName: `${this.fw24.appName}-mail-queue`,
        });
    }

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
    private registerTemplates(path: string) {
        // Resolve the absolute path
        const templateDirectory = resolve(path);
        // Get all the files in the template directory
        const templateFiles = existsSync(templateDirectory) ? readdirSync(templateDirectory) : [];
        // Filter the files to only include html files
        const templatePaths = templateFiles.filter((file) => file.endsWith(".html"));
        // Register the templates
        for (const templatePath of templatePaths) {
            try {
                // read the template file
                const templateHTMLContent = readFileSync(join(templateDirectory, templatePath), "utf8");
                // get the template name
                const templateName = templatePath.split(".")[0];
                // get the subject from the template by finding content from <title> tag
                const titleMatch = templateHTMLContent.match(/<title>(.*?)<\/title>/);
                const subject = titleMatch ? titleMatch[1] : "";

                const template: any = {
                    subjectPart: subject,
                    templateName: templateName,
                    htmlPart: templateHTMLContent,
                };

                // check if file exists for text version of the template with same name
                const textTemplatePath = templatePath.replace(".html", ".txt");
                if (templateFiles.includes(textTemplatePath)) {
                    // read the text template file
                    const textTemplateContent = readFileSync(join(templateDirectory, textTemplatePath), "utf8");
                    // add the text part to the template
                    template["textPart"] = textTemplateContent;
                }

                this.logger.debug("registerTemplates: textTemplatePath: ", textTemplatePath);

                // register the template
                const templateIdentifier = `${this.fw24.appName}-${templateName}-ses-template`;
                const sesTemplate = new CfnTemplate(this.mainStack, templateIdentifier, {
                    template: template,
                });
                this.fw24.set(templateName, sesTemplate.getAtt("TemplateName"), "templateName_");
            } catch (err) {
                this.logger.error("registerTemplates: Error registering template err: ", err);
            }
        }
    }
}
