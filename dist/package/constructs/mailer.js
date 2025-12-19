"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailerConstruct = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_ses_1 = require("aws-cdk-lib/aws-ses");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const fs_1 = require("fs");
const path_1 = require("path");
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const fw24_1 = require("../core/fw24");
const queue_lambda_1 = require("./queue-lambda");
const logging_1 = require("../logging");
const vpc_1 = require("./vpc");
const layer_1 = require("./layer");
/**
 * Represents a Mailer construct that handles sending emails using AWS SES.
 */
class MailerConstruct {
    mailerConstructConfig;
    logger = (0, logging_1.createLogger)(MailerConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = MailerConstruct.name;
    dependencies = [vpc_1.VpcConstruct.name, layer_1.LayerConstruct.name];
    output;
    mainStack;
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
    constructor(mailerConstructConfig) {
        this.mailerConstructConfig = mailerConstructConfig;
        this.logger.debug("constructor:");
        helper_1.Helper.hydrateConfig(mailerConstructConfig, "SES");
        this.fw24.emailProvider = this;
    }
    /**
     * Constructs the Mailer construct and creates the necessary AWS resources.
     */
    async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack(this.mailerConstructConfig.stackName, this.mailerConstructConfig.parentStackName);
        // create identity
        if (this.mailerConstructConfig.domain !== undefined && this.mailerConstructConfig.domain !== "") {
            const identity = new aws_ses_1.EmailIdentity(this.mainStack, `${this.fw24.appName}-ses-identity`, {
                identity: aws_ses_1.Identity.domain(this.mailerConstructConfig.domain),
            });
        }
        // create main queue
        const queue = new queue_lambda_1.QueueLambda(this.mainStack, `${this.fw24.appName}-mail-queue`, {
            queueName: `emailQueue`,
            queueProps: {
                visibilityTimeout: aws_cdk_lib_1.Duration.seconds(30),
                receiveMessageWaitTime: aws_cdk_lib_1.Duration.seconds(10),
                ...this.mailerConstructConfig.queueProps,
            },
            lambdaFunctionProps: {
                entry: (0, path_1.join)(__dirname, "../core/runtime/mail-processor.js"),
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
                        effect: aws_iam_1.Effect.ALLOW,
                    },
                ],
                environmentVariables: {
                    // Pass observability config as environment variable
                    TRACK_EMAIL_SUCCESS: this.mailerConstructConfig.trackEmailSuccess ? 'true' : 'false',
                },
            },
            sqsEventSourceProps: {
                batchSize: 5,
                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(5),
                reportBatchItemFailures: true,
            },
        });
        // sets the default templates directory if not defined
        if (this.mailerConstructConfig.templatesDirectory === undefined || this.mailerConstructConfig.templatesDirectory === "") {
            this.mailerConstructConfig.templatesDirectory = "./src/templates/email";
        }
        // register the templates
        this.registerTemplates(this.mailerConstructConfig.templatesDirectory);
        // Set queue URL as construct output for cross-stack reference
        this.fw24.setConstructOutput(this, 'emailQueue', queue, construct_1.OutputType.QUEUE, 'queueName');
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
    registerTemplates(path) {
        // Resolve the absolute path
        const templateDirectory = (0, path_1.resolve)(path);
        // Get all the files in the template directory
        const templateFiles = (0, fs_1.existsSync)(templateDirectory) ? (0, fs_1.readdirSync)(templateDirectory) : [];
        // Filter the files to only include html files
        const templatePaths = templateFiles.filter((file) => file.endsWith(".html"));
        // Register the templates
        for (const templatePath of templatePaths) {
            try {
                // read the template file
                const templateHTMLContent = (0, fs_1.readFileSync)((0, path_1.join)(templateDirectory, templatePath), "utf8");
                // get the template name
                const templateName = templatePath.split(".")[0];
                // get the subject from the template by finding content from <title> tag
                const titleMatch = templateHTMLContent.match(/<title>(.*?)<\/title>/);
                const subject = titleMatch ? titleMatch[1] : "";
                const template = {
                    subjectPart: subject,
                    templateName: templateName,
                    htmlPart: templateHTMLContent,
                };
                // check if file exists for text version of the template with same name
                const textTemplatePath = templatePath.replace(".html", ".txt");
                if (templateFiles.includes(textTemplatePath)) {
                    // read the text template file
                    const textTemplateContent = (0, fs_1.readFileSync)((0, path_1.join)(templateDirectory, textTemplatePath), "utf8");
                    // add the text part to the template
                    template["textPart"] = textTemplateContent;
                }
                this.logger.debug("registerTemplates: textTemplatePath: ", textTemplatePath);
                // register the template
                const templateIdentifier = `${this.fw24.appName}-${templateName}-ses-template`;
                const sesTemplate = new aws_ses_1.CfnTemplate(this.mainStack, templateIdentifier, {
                    template: template,
                });
                this.fw24.setEnvironmentVariable(templateName, sesTemplate.getAtt("TemplateName"), "templateName_");
            }
            catch (err) {
                this.logger.error("registerTemplates: Error registering template err: ", err);
            }
        }
    }
}
exports.MailerConstruct = MailerConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], MailerConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbWFpbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUF5RDtBQUN6RCxpREFBMkU7QUFFM0UsaURBQTZDO0FBQzdDLDJCQUEyRDtBQUMzRCwrQkFBcUM7QUFFckMsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix1Q0FBb0M7QUFDcEMsaURBQTZDO0FBQzdDLHdDQUF1RDtBQUV2RCwrQkFBcUM7QUFDckMsbUNBQXlDO0FBMEN6Qzs7R0FFRztBQUNILE1BQWEsZUFBZTtJQTRCSjtJQTNCWCxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1QyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxlQUFlLENBQUMsSUFBSSxDQUFDO0lBQ3BDLFlBQVksR0FBYSxDQUFFLGtCQUFZLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxDQUFFLENBQUM7SUFDcEUsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFFbEI7Ozs7Ozs7Ozs7Ozs7Ozs7O09BaUJHO0lBQ0gsWUFBb0IscUJBQTZDO1FBQTdDLDBCQUFxQixHQUFyQixxQkFBcUIsQ0FBd0I7UUFDN0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7UUFFbEMsZUFBTSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNuRCxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUM7SUFDbkMsQ0FBQztJQUVEOztPQUVHO0lBRVUsQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQiw2Q0FBNkM7UUFDN0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJ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Q0FBQyxDQUFDO29CQUM1RixvQ0FBb0M7b0JBQ3BDLFFBQVEsQ0FBRSxVQUFVLENBQUUsR0FBRyxtQkFBbUIsQ0FBQztnQkFDakQsQ0FBQztnQkFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx1Q0FBdUMsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO2dCQUU3RSx3QkFBd0I7Z0JBQ3hCLE1BQU0sa0JBQWtCLEdBQUcsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sSUFBSSxZQUFZLGVBQWUsQ0FBQztnQkFDL0UsTUFBTSxXQUFXLEdBQUcsSUFBSSxxQkFBVyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsa0JBQWtCLEVBQUU7b0JBQ3BFLFFBQVEsRUFBRSxRQUFRO2lCQUNyQixDQUFDLENBQUM7Z0JBQ0gsSUFBSSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxZQUFZLEVBQUUsV0FBVyxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsRUFBRSxlQUFlLENBQUMsQ0FBQztZQUN4RyxDQUFDO1lBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztnQkFDWCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxxREFBcUQsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNsRixDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQTdKRCwwQ0E2SkM7QUF0SGdCO0lBRFosSUFBQSxxQkFBVyxHQUFFO2dEQXdEYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBEdXJhdGlvbiwgQ2ZuT3V0cHV0IH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBFbWFpbElkZW50aXR5LCBJZGVudGl0eSwgQ2ZuVGVtcGxhdGUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNlc1wiO1xuaW1wb3J0IHsgUXVldWVQcm9wcywgUXVldWUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgRWZmZWN0IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IHJlYWRkaXJTeW5jLCByZWFkRmlsZVN5bmMsIGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IHJlc29sdmUsIGpvaW4gfSBmcm9tIFwicGF0aFwiO1xuXG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBRdWV1ZUxhbWJkYSB9IGZyb20gXCIuL3F1ZXVlLWxhbWJkYVwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBMb2dEdXJhdGlvbiB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2xheWVyXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIE1haWxlciBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSU1haWxlckNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBkb21haW4gZm9yIHRoZSBtYWlsZXIuXG4gICAgICovXG4gICAgZG9tYWluPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgU0VTIG9wdGlvbnMuXG4gICAgICovXG4gICAgc2VzT3B0aW9ucz86IHt9O1xuXG4gICAgLyoqXG4gICAgICogVGhlIGRpcmVjdG9yeSB3aGVyZSB0aGUgdGVtcGxhdGVzIGFyZSBsb2NhdGVkLlxuICAgICAqL1xuICAgIHRlbXBsYXRlc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgcXVldWUuXG4gICAgICovXG4gICAgcXVldWVQcm9wcz86IFF1ZXVlUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBUcmFjayBzdWNjZXNzZnVsIGVtYWlsIHNlbmRzIChpbiBhZGRpdGlvbiB0byBmYWlsdXJlcykuXG4gICAgICogRW5hYmxlIGZvciBjb21wbGlhbmNlLCBhdWRpdCB0cmFpbHMsIG9yIGRlYnVnZ2luZy5cbiAgICAgKiBcbiAgICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHNcbiAgICAgKiBjb25zdCBtYWlsZXJDb25maWc6IElNYWlsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICogICBkb21haW46ICdleGFtcGxlLmNvbScsXG4gICAgICogICB0cmFja0VtYWlsU3VjY2VzczogdHJ1ZSAgLy8gRW5hYmxlIGZvciBjb21wbGlhbmNlL2F1ZGl0XG4gICAgICogfTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICB0cmFja0VtYWlsU3VjY2Vzcz86IGJvb2xlYW47XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIE1haWxlciBjb25zdHJ1Y3QgdGhhdCBoYW5kbGVzIHNlbmRpbmcgZW1haWxzIHVzaW5nIEFXUyBTRVMuXG4gKi9cbmV4cG9ydCBjbGFzcyBNYWlsZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoTWFpbGVyQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBNYWlsZXJDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gWyBWcGNDb25zdHJ1Y3QubmFtZSwgTGF5ZXJDb25zdHJ1Y3QubmFtZSBdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYW4gaW5zdGFuY2Ugb2YgTWFpbGVyQ29uc3RydWN0LlxuICAgICAqXG4gICAgICogQHBhcmFtIG1haWxlckNvbnN0cnVjdENvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgTWFpbGVyQ29uc3RydWN0LlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0c1xuICAgICAqIGNvbnN0IG1haWxlckNvbmZpZzogSU1haWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAgICAgKiAgIGRvbWFpbjogJ2V4YW1wbGUuY29tJyxcbiAgICAgKiAgIHF1ZXVlUHJvcHM6IHtcbiAgICAgKiAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAqICAgICByZWNlaXZlTWVzc2FnZVdhaXRUaW1lOiBEdXJhdGlvbi5zZWNvbmRzKDEwKSxcbiAgICAgKiAgIH0sXG4gICAgICogICB0ZW1wbGF0ZXNEaXJlY3Rvcnk6ICcuL3NyYy90ZW1wbGF0ZXMvZW1haWwnLFxuICAgICAqIH07XG4gICAgICogY29uc3QgbWFpbGVyID0gbmV3IE1haWxlckNvbnN0cnVjdChtYWlsZXJDb25maWcpO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgbWFpbGVyQ29uc3RydWN0Q29uZmlnOiBJTWFpbGVyQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiY29uc3RydWN0b3I6XCIpO1xuXG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKG1haWxlckNvbnN0cnVjdENvbmZpZywgXCJTRVNcIik7XG4gICAgICAgIHRoaXMuZncyNC5lbWFpbFByb3ZpZGVyID0gdGhpcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RzIHRoZSBNYWlsZXIgY29uc3RydWN0IGFuZCBjcmVhdGVzIHRoZSBuZWNlc3NhcnkgQVdTIHJlc291cmNlcy5cbiAgICAgKi9cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIG1ha2UgdGhlIG1haW4gc3RhY2sgYXZhaWxhYmxlIHRvIHRoZSBjbGFzc1xuICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMubWFpbGVyQ29uc3RydWN0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cbiAgICAgICAgLy8gY3JlYXRlIGlkZW50aXR5XG4gICAgICAgIGlmICh0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy5kb21haW4gIT09IHVuZGVmaW5lZCAmJiB0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy5kb21haW4gIT09IFwiXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGlkZW50aXR5ID0gbmV3IEVtYWlsSWRlbnRpdHkodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS1zZXMtaWRlbnRpdHlgLCB7XG4gICAgICAgICAgICAgICAgaWRlbnRpdHk6IElkZW50aXR5LmRvbWFpbih0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy5kb21haW4pLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjcmVhdGUgbWFpbiBxdWV1ZVxuICAgICAgICBjb25zdCBxdWV1ZSA9IG5ldyBRdWV1ZUxhbWJkYSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LW1haWwtcXVldWVgLCB7XG4gICAgICAgICAgICBxdWV1ZU5hbWU6IGBlbWFpbFF1ZXVlYCxcbiAgICAgICAgICAgIHF1ZXVlUHJvcHM6IHtcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5VGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgICAgICAgICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZTogRHVyYXRpb24uc2Vjb25kcygxMCksXG4gICAgICAgICAgICAgICAgLi4udGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcucXVldWVQcm9wcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgICAgICAgZW50cnk6IGpvaW4oX19kaXJuYW1lLCBcIi4uL2NvcmUvcnVudGltZS9tYWlsLXByb2Nlc3Nvci5qc1wiKSxcbiAgICAgICAgICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJzZXM6U2VuZEVtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJTRVM6U2VuZFJhd0VtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJTRVM6U2VuZFRlbXBsYXRlZEVtYWlsXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJTRVM6U2VuZEJ1bGtUZW1wbGF0ZWRFbWFpbFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiU0VTOlRlc3RSZW5kZXJFbWFpbFRlbXBsYXRlXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbIFwiKlwiIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3Mgb2JzZXJ2YWJpbGl0eSBjb25maWcgYXMgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAgICAgICAgICAgICAgICAgICAgVFJBQ0tfRU1BSUxfU1VDQ0VTUzogdGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcudHJhY2tFbWFpbFN1Y2Nlc3MgPyAndHJ1ZScgOiAnZmFsc2UnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3FzRXZlbnRTb3VyY2VQcm9wczoge1xuICAgICAgICAgICAgICAgIGJhdGNoU2l6ZTogNSxcbiAgICAgICAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgICAgICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pIGFzIFF1ZXVlO1xuXG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgdGVtcGxhdGVzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZiAodGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcudGVtcGxhdGVzRGlyZWN0b3J5ID09PSB1bmRlZmluZWQgfHwgdGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcudGVtcGxhdGVzRGlyZWN0b3J5ID09PSBcIlwiKSB7XG4gICAgICAgICAgICB0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy50ZW1wbGF0ZXNEaXJlY3RvcnkgPSBcIi4vc3JjL3RlbXBsYXRlcy9lbWFpbFwiO1xuICAgICAgICB9XG4gICAgICAgIC8vIHJlZ2lzdGVyIHRoZSB0ZW1wbGF0ZXNcbiAgICAgICAgdGhpcy5yZWdpc3RlclRlbXBsYXRlcyh0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy50ZW1wbGF0ZXNEaXJlY3RvcnkpO1xuXG4gICAgICAgIC8vIFNldCBxdWV1ZSBVUkwgYXMgY29uc3RydWN0IG91dHB1dCBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNlXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ2VtYWlsUXVldWUnLCBxdWV1ZSwgT3V0cHV0VHlwZS5RVUVVRSwgJ3F1ZXVlTmFtZScpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVycyB0aGUgZW1haWwgdGVtcGxhdGVzLlxuICAgICAqXG4gICAgICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCB0byB0aGUgdGVtcGxhdGVzIGRpcmVjdG9yeS5cbiAgICAgKlxuICAgICAqIEByZW1hcmtzXG4gICAgICogVGhpcyBtZXRob2QgcmVhZHMgdGhlIHRlbXBsYXRlIGZpbGVzIGZyb20gdGhlIHNwZWNpZmllZCBkaXJlY3RvcnksIHJlZ2lzdGVycyB0aGVtIGFzIFNFUyB0ZW1wbGF0ZXMsXG4gICAgICogYW5kIHNldHMgdGhlIHRlbXBsYXRlIG5hbWVzIGluIHRoZSBGVzI0IGluc3RhbmNlLlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0c1xuICAgICAqIGNvbnN0IHRlbXBsYXRlc0RpcmVjdG9yeSA9ICcuL3NyYy90ZW1wbGF0ZXMvZW1haWwnO1xuICAgICAqIHRoaXMucmVnaXN0ZXJUZW1wbGF0ZXModGVtcGxhdGVzRGlyZWN0b3J5KTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBwcml2YXRlIHJlZ2lzdGVyVGVtcGxhdGVzKHBhdGg6IHN0cmluZykge1xuICAgICAgICAvLyBSZXNvbHZlIHRoZSBhYnNvbHV0ZSBwYXRoXG4gICAgICAgIGNvbnN0IHRlbXBsYXRlRGlyZWN0b3J5ID0gcmVzb2x2ZShwYXRoKTtcbiAgICAgICAgLy8gR2V0IGFsbCB0aGUgZmlsZXMgaW4gdGhlIHRlbXBsYXRlIGRpcmVjdG9yeVxuICAgICAgICBjb25zdCB0ZW1wbGF0ZUZpbGVzID0gZXhpc3RzU3luYyh0ZW1wbGF0ZURpcmVjdG9yeSkgPyByZWFkZGlyU3luYyh0ZW1wbGF0ZURpcmVjdG9yeSkgOiBbXTtcbiAgICAgICAgLy8gRmlsdGVyIHRoZSBmaWxlcyB0byBvbmx5IGluY2x1ZGUgaHRtbCBmaWxlc1xuICAgICAgICBjb25zdCB0ZW1wbGF0ZVBhdGhzID0gdGVtcGxhdGVGaWxlcy5maWx0ZXIoKGZpbGUpID0+IGZpbGUuZW5kc1dpdGgoXCIuaHRtbFwiKSk7XG4gICAgICAgIC8vIFJlZ2lzdGVyIHRoZSB0ZW1wbGF0ZXNcbiAgICAgICAgZm9yIChjb25zdCB0ZW1wbGF0ZVBhdGggb2YgdGVtcGxhdGVQYXRocykge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyByZWFkIHRoZSB0ZW1wbGF0ZSBmaWxlXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGVIVE1MQ29udGVudCA9IHJlYWRGaWxlU3luYyhqb2luKHRlbXBsYXRlRGlyZWN0b3J5LCB0ZW1wbGF0ZVBhdGgpLCBcInV0ZjhcIik7XG4gICAgICAgICAgICAgICAgLy8gZ2V0IHRoZSB0ZW1wbGF0ZSBuYW1lXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGVOYW1lID0gdGVtcGxhdGVQYXRoLnNwbGl0KFwiLlwiKVsgMCBdO1xuICAgICAgICAgICAgICAgIC8vIGdldCB0aGUgc3ViamVjdCBmcm9tIHRoZSB0ZW1wbGF0ZSBieSBmaW5kaW5nIGNvbnRlbnQgZnJvbSA8dGl0bGU+IHRhZ1xuICAgICAgICAgICAgICAgIGNvbnN0IHRpdGxlTWF0Y2ggPSB0ZW1wbGF0ZUhUTUxDb250ZW50Lm1hdGNoKC88dGl0bGU+KC4qPyk8XFwvdGl0bGU+Lyk7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3ViamVjdCA9IHRpdGxlTWF0Y2ggPyB0aXRsZU1hdGNoWyAxIF0gOiBcIlwiO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGU6IGFueSA9IHtcbiAgICAgICAgICAgICAgICAgICAgc3ViamVjdFBhcnQ6IHN1YmplY3QsXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlTmFtZTogdGVtcGxhdGVOYW1lLFxuICAgICAgICAgICAgICAgICAgICBodG1sUGFydDogdGVtcGxhdGVIVE1MQ29udGVudCxcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgLy8gY2hlY2sgaWYgZmlsZSBleGlzdHMgZm9yIHRleHQgdmVyc2lvbiBvZiB0aGUgdGVtcGxhdGUgd2l0aCBzYW1lIG5hbWVcbiAgICAgICAgICAgICAgICBjb25zdCB0ZXh0VGVtcGxhdGVQYXRoID0gdGVtcGxhdGVQYXRoLnJlcGxhY2UoXCIuaHRtbFwiLCBcIi50eHRcIik7XG4gICAgICAgICAgICAgICAgaWYgKHRlbXBsYXRlRmlsZXMuaW5jbHVkZXModGV4dFRlbXBsYXRlUGF0aCkpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gcmVhZCB0aGUgdGV4dCB0ZW1wbGF0ZSBmaWxlXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRleHRUZW1wbGF0ZUNvbnRlbnQgPSByZWFkRmlsZVN5bmMoam9pbih0ZW1wbGF0ZURpcmVjdG9yeSwgdGV4dFRlbXBsYXRlUGF0aCksIFwidXRmOFwiKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gYWRkIHRoZSB0ZXh0IHBhcnQgdG8gdGhlIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlWyBcInRleHRQYXJ0XCIgXSA9IHRleHRUZW1wbGF0ZUNvbnRlbnQ7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJyZWdpc3RlclRlbXBsYXRlczogdGV4dFRlbXBsYXRlUGF0aDogXCIsIHRleHRUZW1wbGF0ZVBhdGgpO1xuXG4gICAgICAgICAgICAgICAgLy8gcmVnaXN0ZXIgdGhlIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGVJZGVudGlmaWVyID0gYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7dGVtcGxhdGVOYW1lfS1zZXMtdGVtcGxhdGVgO1xuICAgICAgICAgICAgICAgIGNvbnN0IHNlc1RlbXBsYXRlID0gbmV3IENmblRlbXBsYXRlKHRoaXMubWFpblN0YWNrLCB0ZW1wbGF0ZUlkZW50aWZpZXIsIHtcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHRlbXBsYXRlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRlbXBsYXRlTmFtZSwgc2VzVGVtcGxhdGUuZ2V0QXR0KFwiVGVtcGxhdGVOYW1lXCIpLCBcInRlbXBsYXRlTmFtZV9cIik7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihcInJlZ2lzdGVyVGVtcGxhdGVzOiBFcnJvciByZWdpc3RlcmluZyB0ZW1wbGF0ZSBlcnI6IFwiLCBlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuIl19