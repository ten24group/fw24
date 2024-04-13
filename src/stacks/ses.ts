import { Stack, Duration, CfnOutput } from "aws-cdk-lib";
import { EmailIdentity, Identity, CfnTemplate } from "aws-cdk-lib/aws-ses";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Effect } from "aws-cdk-lib/aws-iam";
import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join, } from "path";

import { Helper } from "../core/helper";
import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";
import { QueueLambda } from "../constructs/queue-lambda";
import { createLogger, LogDuration } from "../logging";

export interface ISESConfig {
    domain: string;
    sesOptions?: {};
    templatesDirectory?: string;
}

export class SESStack implements IStack {
    readonly logger = createLogger(SESStack.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    dependencies: string[] = [];
    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private stackConfig: ISESConfig) {
        this.logger.debug("constructor: stackConfig", stackConfig);
        
        Helper.hydrateConfig(stackConfig,'SES');
        this.fw24.emailProvider = this;
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        this.logger.debug("construct:");

        // make the main stack available to the class
        this.mainStack = this.fw24.getStack("main");
       
        // create identity
        const identity = new EmailIdentity(this.mainStack, `${this.fw24.appName}-ses-identity`, {
            identity: Identity.domain(this.stackConfig.domain)
        });
        
        // create main queue
        const queue = new QueueLambda(this.mainStack, `${this.fw24.appName}-mail-queue`, {
            queueName: `emailQueue`,
            queueProps: {
                visibilityTimeout: Duration.seconds(30),
                receiveMessageWaitTime: Duration.seconds(10),
            },
            lambdaFunctionProps: {
                entry: join(__dirname,"../core/mail-processor.js"),
                policies: [{
                    actions: ["ses:SendEmail", "SES:SendRawEmail", "SES:SendTemplatedEmail", "SES:SendBulkTemplatedEmail", "SES:TestRenderEmailTemplate"],
                    resources: ["*"],
                    effect: Effect.ALLOW,
                }],
            },
            sqsEventSourceProps: {
                batchSize: 1,
                maxBatchingWindow: Duration.seconds(5),
                reportBatchItemFailures: true,
            },
        }) as Queue;

         // sets the default templates directory if not defined
         if(this.stackConfig.templatesDirectory === undefined || this.stackConfig.templatesDirectory === ""){
            this.stackConfig.templatesDirectory = "./src/templates/email";
        }
        // register the templates
        this.registerTemplates(this.stackConfig.templatesDirectory);
        
        // print queue url
        new CfnOutput(this.mainStack, "mail-queue-url", {
            value: queue.queueUrl,
            exportName: `${this.fw24.appName}-mail-queue`,
        });
    }

    private registerTemplates(path: string){
        // Resolve the absolute path
        const templateDirectory = resolve(path);
        // Get all the files in the template directory
        const templateFiles =  existsSync(templateDirectory) ? readdirSync(templateDirectory) : [];
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
                if(templateFiles.includes(textTemplatePath)){
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
                this.fw24.set(templateName, sesTemplate.getAtt('TemplateName'), "templateName_");

            } catch (err) {
                this.logger.error("registerTemplates: Error registering template err: ", err);
            }
        }
    }
}
