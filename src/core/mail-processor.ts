import { SQSHandler, SQSEvent } from 'aws-lambda';
import { SESv2Client, SendEmailCommand, SendEmailCommandInput, TestRenderEmailTemplateCommand } from '@aws-sdk/client-sesv2';

export interface IEmailMessage {
    FromEmailAddress: string;
    ToEmailAddress: string;
    Subject?: string;
    Message?: string;
    TemplateName?: string;
    ReplyToEmailAddress?: string;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
    console.log('Received event:', event);

    // Initialize SES client
    const sesClient = new SESv2Client();

    for (const record of event.Records) {
        console.log('Processing message with ID:', record.messageId);

        // Parse message body
        const { emailMessage, templateData } = JSON.parse(record.body) as {emailMessage: IEmailMessage, templateData: any};

        // check if request is for testing template
        if (templateData && templateData['testRenderEmailTemplate']) {
            const command = new TestRenderEmailTemplateCommand({
                TemplateName: emailMessage.TemplateName,
                TemplateData: JSON.stringify({...emailMessage, ...templateData}),
            });
            
            const response = await sesClient.send(command);
            console.log('Test render response:', response);
            continue;
        }

        // Construct email parameters
        const mailParams: SendEmailCommandInput = {
            FromEmailAddress: emailMessage.FromEmailAddress,
            Destination: {
                ToAddresses: [emailMessage.ToEmailAddress],
            },
            Content: {}
        };

         // If a template name is provided, use it
         if (emailMessage.TemplateName) {
            mailParams.Content = {};
            mailParams.Content.Template = {
                TemplateName: emailMessage.TemplateName, //change to get full template name from fw24
                TemplateData: JSON.stringify({...emailMessage, ...templateData})
            } 
        }
        // if body and subject are provided, use them
        else if (emailMessage.Message && emailMessage.Subject) {
            mailParams.Content = {};
            mailParams.Content.Simple = {
                Body: { Text: { Data: emailMessage.Message } },
                Subject: { Data: emailMessage.Subject },
            }
        } else {
            console.error('Invalid message format. Either provide TemplateName or Message and Subject. Skipping message:', emailMessage);
            continue;
        }


        // if reply to address is provided, use it
        if (emailMessage.ReplyToEmailAddress) {
            mailParams.ReplyToAddresses = [emailMessage.ReplyToEmailAddress];
        }


        console.log('Sending email with parameters:', mailParams);

        // Send the email
        try {
            const command = new SendEmailCommand(mailParams);
            const result = await sesClient.send(command);
            console.log('Email sent successfully. Response:', result);
        } catch (error) {
            console.error('Error sending email:', error);
        }
    }

    console.log('Processing complete.');

    return Promise.resolve();
};
