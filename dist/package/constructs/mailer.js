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
/**
 * Represents a Mailer construct that handles sending emails using AWS SES.
 */
class MailerConstruct {
    mailerConstructConfig;
    logger = (0, logging_1.createLogger)(MailerConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = MailerConstruct.name;
    dependencies = [vpc_1.VpcConstruct.name];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbWFpbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUF5RDtBQUN6RCxpREFBMkU7QUFFM0UsaURBQTZDO0FBQzdDLDJCQUEyRDtBQUMzRCwrQkFBcUM7QUFFckMsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix1Q0FBb0M7QUFDcEMsaURBQTZDO0FBQzdDLHdDQUF1RDtBQUV2RCwrQkFBcUM7QUEyQnJDOztHQUVHO0FBQ0gsTUFBYSxlQUFlO0lBNEJKO0lBM0JYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLGVBQWUsQ0FBQyxJQUFJLENBQUM7SUFDcEMsWUFBWSxHQUFhLENBQUMsa0JBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM3QyxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQjs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSCxZQUFvQixxQkFBNkM7UUFBN0MsMEJBQXFCLEdBQXJCLHFCQUFxQixDQUF3QjtRQUM3RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUVsQyxlQUFNLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ25ELElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQztJQUNuQyxDQUFDO0lBRUQ7O09BRUc7SUFFVSxBQUFOLEtBQUssQ0FBQyxTQUFTO1FBQ2xCLDZDQUE2QztRQUM3QyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxTQUFTLEVBQUUsSUFBSSxD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QUN4QixNQUFNLGtCQUFrQixHQUFHLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksWUFBWSxlQUFlLENBQUM7Z0JBQy9FLE1BQU0sV0FBVyxHQUFHLElBQUkscUJBQVcsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLGtCQUFrQixFQUFFO29CQUNwRSxRQUFRLEVBQUUsUUFBUTtpQkFDckIsQ0FBQyxDQUFDO2dCQUNILElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsWUFBWSxFQUFFLFdBQVcsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFDeEcsQ0FBQztZQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7Z0JBQ1gsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMscURBQXFELEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDbEYsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUF6SkQsMENBeUpDO0FBbEhnQjtJQURaLElBQUEscUJBQVcsR0FBRTtnREFvRGIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTdGFjaywgRHVyYXRpb24sIENmbk91dHB1dCB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgRW1haWxJZGVudGl0eSwgSWRlbnRpdHksIENmblRlbXBsYXRlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zZXNcIjtcbmltcG9ydCB7IFF1ZXVlUHJvcHMsIFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IEVmZmVjdCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyByZWFkZGlyU3luYywgcmVhZEZpbGVTeW5jLCBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyByZXNvbHZlLCBqb2luIH0gZnJvbSBcInBhdGhcIjtcblxuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgUXVldWVMYW1iZGEgfSBmcm9tIFwiLi9xdWV1ZS1sYW1iZGFcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciwgTG9nRHVyYXRpb24gfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBNYWlsZXIgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElNYWlsZXJDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZG9tYWluIGZvciB0aGUgbWFpbGVyLlxuICAgICAqL1xuICAgIGRvbWFpbj86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIFNFUyBvcHRpb25zLlxuICAgICAqL1xuICAgIHNlc09wdGlvbnM/OiB7fTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIHRlbXBsYXRlcyBhcmUgbG9jYXRlZC5cbiAgICAgKi9cbiAgICB0ZW1wbGF0ZXNEaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIHF1ZXVlLlxuICAgICAqL1xuICAgIHF1ZXVlUHJvcHM/OiBRdWV1ZVByb3BzO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBNYWlsZXIgY29uc3RydWN0IHRoYXQgaGFuZGxlcyBzZW5kaW5nIGVtYWlscyB1c2luZyBBV1MgU0VTLlxuICovXG5leHBvcnQgY2xhc3MgTWFpbGVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKE1haWxlckNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gTWFpbGVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtWcGNDb25zdHJ1Y3QubmFtZV07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhbiBpbnN0YW5jZSBvZiBNYWlsZXJDb25zdHJ1Y3QuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbWFpbGVyQ29uc3RydWN0Q29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBNYWlsZXJDb25zdHJ1Y3QuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHRzXG4gICAgICogY29uc3QgbWFpbGVyQ29uZmlnOiBJTWFpbGVyQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAqICAgZG9tYWluOiAnZXhhbXBsZS5jb20nLFxuICAgICAqICAgcXVldWVQcm9wczoge1xuICAgICAqICAgICB2aXNpYmlsaXR5VGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICogICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWU6IER1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAqICAgfSxcbiAgICAgKiAgIHRlbXBsYXRlc0RpcmVjdG9yeTogJy4vc3JjL3RlbXBsYXRlcy9lbWFpbCcsXG4gICAgICogfTtcbiAgICAgKiBjb25zdCBtYWlsZXIgPSBuZXcgTWFpbGVyQ29uc3RydWN0KG1haWxlckNvbmZpZyk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBtYWlsZXJDb25zdHJ1Y3RDb25maWc6IElNYWlsZXJDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJjb25zdHJ1Y3RvcjpcIik7XG5cbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcobWFpbGVyQ29uc3RydWN0Q29uZmlnLCBcIlNFU1wiKTtcbiAgICAgICAgdGhpcy5mdzI0LmVtYWlsUHJvdmlkZXIgPSB0aGlzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdHMgdGhlIE1haWxlciBjb25zdHJ1Y3QgYW5kIGNyZWF0ZXMgdGhlIG5lY2Vzc2FyeSBBV1MgcmVzb3VyY2VzLlxuICAgICAqL1xuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gbWFrZSB0aGUgbWFpbiBzdGFjayBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMubWFpbGVyQ29uc3RydWN0Q29uZmlnLnN0YWNrTmFtZSwgdGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICAvLyBjcmVhdGUgaWRlbnRpdHlcbiAgICAgICAgaWYodGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcuZG9tYWluICE9PSB1bmRlZmluZWQgJiYgdGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcuZG9tYWluICE9PSBcIlwiKSB7XG4gICAgICAgICAgICBjb25zdCBpZGVudGl0eSA9IG5ldyBFbWFpbElkZW50aXR5KHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tc2VzLWlkZW50aXR5YCwge1xuICAgICAgICAgICAgICAgIGlkZW50aXR5OiBJZGVudGl0eS5kb21haW4odGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcuZG9tYWluKSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gY3JlYXRlIG1haW4gcXVldWVcbiAgICAgICAgY29uc3QgcXVldWUgPSBuZXcgUXVldWVMYW1iZGEodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS1tYWlsLXF1ZXVlYCwge1xuICAgICAgICAgICAgcXVldWVOYW1lOiBgZW1haWxRdWV1ZWAsXG4gICAgICAgICAgICBxdWV1ZVByb3BzOiB7XG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICAgICAgICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWU6IER1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAgICAgICAgICAgIC4uLnRoaXMubWFpbGVyQ29uc3RydWN0Q29uZmlnLnF1ZXVlUHJvcHMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbGFtYmRhRnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgICAgICAgIGVudHJ5OiBqb2luKF9fZGlybmFtZSwgXCIuLi9jb3JlL3J1bnRpbWUvbWFpbC1wcm9jZXNzb3IuanNcIiksXG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwic2VzOlNlbmRFbWFpbFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiU0VTOlNlbmRSYXdFbWFpbFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiU0VTOlNlbmRUZW1wbGF0ZWRFbWFpbFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiU0VTOlNlbmRCdWxrVGVtcGxhdGVkRW1haWxcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIlNFUzpUZXN0UmVuZGVyRW1haWxUZW1wbGF0ZVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlczogW1wiKlwiXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3FzRXZlbnRTb3VyY2VQcm9wczoge1xuICAgICAgICAgICAgICAgIGJhdGNoU2l6ZTogNSxcbiAgICAgICAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgICAgICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pIGFzIFF1ZXVlO1xuXG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgdGVtcGxhdGVzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZiAodGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcudGVtcGxhdGVzRGlyZWN0b3J5ID09PSB1bmRlZmluZWQgfHwgdGhpcy5tYWlsZXJDb25zdHJ1Y3RDb25maWcudGVtcGxhdGVzRGlyZWN0b3J5ID09PSBcIlwiKSB7XG4gICAgICAgICAgICB0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy50ZW1wbGF0ZXNEaXJlY3RvcnkgPSBcIi4vc3JjL3RlbXBsYXRlcy9lbWFpbFwiO1xuICAgICAgICB9XG4gICAgICAgIC8vIHJlZ2lzdGVyIHRoZSB0ZW1wbGF0ZXNcbiAgICAgICAgdGhpcy5yZWdpc3RlclRlbXBsYXRlcyh0aGlzLm1haWxlckNvbnN0cnVjdENvbmZpZy50ZW1wbGF0ZXNEaXJlY3RvcnkpO1xuXG4gICAgICAgIC8vIFNldCBxdWV1ZSBVUkwgYXMgY29uc3RydWN0IG91dHB1dCBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNlXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ2VtYWlsUXVldWUnLCBxdWV1ZSwgT3V0cHV0VHlwZS5RVUVVRSwgJ3F1ZXVlTmFtZScpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVycyB0aGUgZW1haWwgdGVtcGxhdGVzLlxuICAgICAqXG4gICAgICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCB0byB0aGUgdGVtcGxhdGVzIGRpcmVjdG9yeS5cbiAgICAgKlxuICAgICAqIEByZW1hcmtzXG4gICAgICogVGhpcyBtZXRob2QgcmVhZHMgdGhlIHRlbXBsYXRlIGZpbGVzIGZyb20gdGhlIHNwZWNpZmllZCBkaXJlY3RvcnksIHJlZ2lzdGVycyB0aGVtIGFzIFNFUyB0ZW1wbGF0ZXMsXG4gICAgICogYW5kIHNldHMgdGhlIHRlbXBsYXRlIG5hbWVzIGluIHRoZSBGVzI0IGluc3RhbmNlLlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0c1xuICAgICAqIGNvbnN0IHRlbXBsYXRlc0RpcmVjdG9yeSA9ICcuL3NyYy90ZW1wbGF0ZXMvZW1haWwnO1xuICAgICAqIHRoaXMucmVnaXN0ZXJUZW1wbGF0ZXModGVtcGxhdGVzRGlyZWN0b3J5KTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBwcml2YXRlIHJlZ2lzdGVyVGVtcGxhdGVzKHBhdGg6IHN0cmluZykge1xuICAgICAgICAvLyBSZXNvbHZlIHRoZSBhYnNvbHV0ZSBwYXRoXG4gICAgICAgIGNvbnN0IHRlbXBsYXRlRGlyZWN0b3J5ID0gcmVzb2x2ZShwYXRoKTtcbiAgICAgICAgLy8gR2V0IGFsbCB0aGUgZmlsZXMgaW4gdGhlIHRlbXBsYXRlIGRpcmVjdG9yeVxuICAgICAgICBjb25zdCB0ZW1wbGF0ZUZpbGVzID0gZXhpc3RzU3luYyh0ZW1wbGF0ZURpcmVjdG9yeSkgPyByZWFkZGlyU3luYyh0ZW1wbGF0ZURpcmVjdG9yeSkgOiBbXTtcbiAgICAgICAgLy8gRmlsdGVyIHRoZSBmaWxlcyB0byBvbmx5IGluY2x1ZGUgaHRtbCBmaWxlc1xuICAgICAgICBjb25zdCB0ZW1wbGF0ZVBhdGhzID0gdGVtcGxhdGVGaWxlcy5maWx0ZXIoKGZpbGUpID0+IGZpbGUuZW5kc1dpdGgoXCIuaHRtbFwiKSk7XG4gICAgICAgIC8vIFJlZ2lzdGVyIHRoZSB0ZW1wbGF0ZXNcbiAgICAgICAgZm9yIChjb25zdCB0ZW1wbGF0ZVBhdGggb2YgdGVtcGxhdGVQYXRocykge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAvLyByZWFkIHRoZSB0ZW1wbGF0ZSBmaWxlXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGVIVE1MQ29udGVudCA9IHJlYWRGaWxlU3luYyhqb2luKHRlbXBsYXRlRGlyZWN0b3J5LCB0ZW1wbGF0ZVBhdGgpLCBcInV0ZjhcIik7XG4gICAgICAgICAgICAgICAgLy8gZ2V0IHRoZSB0ZW1wbGF0ZSBuYW1lXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGVOYW1lID0gdGVtcGxhdGVQYXRoLnNwbGl0KFwiLlwiKVswXTtcbiAgICAgICAgICAgICAgICAvLyBnZXQgdGhlIHN1YmplY3QgZnJvbSB0aGUgdGVtcGxhdGUgYnkgZmluZGluZyBjb250ZW50IGZyb20gPHRpdGxlPiB0YWdcbiAgICAgICAgICAgICAgICBjb25zdCB0aXRsZU1hdGNoID0gdGVtcGxhdGVIVE1MQ29udGVudC5tYXRjaCgvPHRpdGxlPiguKj8pPFxcL3RpdGxlPi8pO1xuICAgICAgICAgICAgICAgIGNvbnN0IHN1YmplY3QgPSB0aXRsZU1hdGNoID8gdGl0bGVNYXRjaFsxXSA6IFwiXCI7XG5cbiAgICAgICAgICAgICAgICBjb25zdCB0ZW1wbGF0ZTogYW55ID0ge1xuICAgICAgICAgICAgICAgICAgICBzdWJqZWN0UGFydDogc3ViamVjdCxcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGVOYW1lOiB0ZW1wbGF0ZU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGh0bWxQYXJ0OiB0ZW1wbGF0ZUhUTUxDb250ZW50LFxuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICAvLyBjaGVjayBpZiBmaWxlIGV4aXN0cyBmb3IgdGV4dCB2ZXJzaW9uIG9mIHRoZSB0ZW1wbGF0ZSB3aXRoIHNhbWUgbmFtZVxuICAgICAgICAgICAgICAgIGNvbnN0IHRleHRUZW1wbGF0ZVBhdGggPSB0ZW1wbGF0ZVBhdGgucmVwbGFjZShcIi5odG1sXCIsIFwiLnR4dFwiKTtcbiAgICAgICAgICAgICAgICBpZiAodGVtcGxhdGVGaWxlcy5pbmNsdWRlcyh0ZXh0VGVtcGxhdGVQYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICAvLyByZWFkIHRoZSB0ZXh0IHRlbXBsYXRlIGZpbGVcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGV4dFRlbXBsYXRlQ29udGVudCA9IHJlYWRGaWxlU3luYyhqb2luKHRlbXBsYXRlRGlyZWN0b3J5LCB0ZXh0VGVtcGxhdGVQYXRoKSwgXCJ1dGY4XCIpO1xuICAgICAgICAgICAgICAgICAgICAvLyBhZGQgdGhlIHRleHQgcGFydCB0byB0aGUgdGVtcGxhdGVcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGVbXCJ0ZXh0UGFydFwiXSA9IHRleHRUZW1wbGF0ZUNvbnRlbnQ7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJyZWdpc3RlclRlbXBsYXRlczogdGV4dFRlbXBsYXRlUGF0aDogXCIsIHRleHRUZW1wbGF0ZVBhdGgpO1xuXG4gICAgICAgICAgICAgICAgLy8gcmVnaXN0ZXIgdGhlIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGVJZGVudGlmaWVyID0gYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7dGVtcGxhdGVOYW1lfS1zZXMtdGVtcGxhdGVgO1xuICAgICAgICAgICAgICAgIGNvbnN0IHNlc1RlbXBsYXRlID0gbmV3IENmblRlbXBsYXRlKHRoaXMubWFpblN0YWNrLCB0ZW1wbGF0ZUlkZW50aWZpZXIsIHtcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHRlbXBsYXRlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRlbXBsYXRlTmFtZSwgc2VzVGVtcGxhdGUuZ2V0QXR0KFwiVGVtcGxhdGVOYW1lXCIpLCBcInRlbXBsYXRlTmFtZV9cIik7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihcInJlZ2lzdGVyVGVtcGxhdGVzOiBFcnJvciByZWdpc3RlcmluZyB0ZW1wbGF0ZSBlcnI6IFwiLCBlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuIl19