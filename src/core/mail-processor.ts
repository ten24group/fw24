import { SQSHandler, SQSEvent } from 'aws-lambda';
import { SESv2Client, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-sesv2';

export const handler: SQSHandler = async (event: SQSEvent) => {
    console.log('Received event:', event);

    // Initialize SES client
    const sesClient = new SESv2Client();

    for (const record of event.Records) {
        console.log('Processing message with ID:', record.messageId);

        // Parse message body
        const body = JSON.parse(record.body) as EmailMessage;

        // Construct email parameters
        const mailParams: SendEmailCommandInput = {
            FromEmailAddress: body.FromEmailAddress,
            Destination: {
                ToAddresses: [body.ToEmailAddress],
            },
            Content: {}
        };

         // If a template name is provided, use it
         if (body.TemplateName) {
            mailParams.Content = {};
            mailParams.Content.Template = {
                TemplateName: body.TemplateName, //change to get full template name from fw24
                TemplateData: JSON.stringify(body)
            } 
        }
        // if body and subject are provided, use them
        else if (body.Message && body.Subject) {
            mailParams.Content = {};
            mailParams.Content.Simple = {
                Body: { Text: { Data: body.Message } },
                Subject: { Data: body.Subject },
            }
        } else {
            console.error('Invalid message format. Either provide TemplateName or Message and Subject. Skipping message:', body);
            continue;
        }


        // if reply to address is provided, use it
        if (body.ReplyToEmailAddress) {
            mailParams.ReplyToAddresses = [body.ReplyToEmailAddress];
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

interface EmailMessage {
    FromEmailAddress: string;
    ToEmailAddress: string;
    Subject?: string;
    Message?: string;
    TemplateName?: string;
    ReplyToEmailAddress?: string;
}
