import { SQSHandler, SQSEvent } from 'aws-lambda';
import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';

export const handler: SQSHandler = async (event: SQSEvent) => {
    console.log('Received event:', event);

    // Initialize SES client
    const sesClient = new SESClient({ region: 'us-east-1' });

    for (const record of event.Records) {
        console.log('Processing message with ID:', record.messageId);

        // Parse message body
        const body = JSON.parse(record.body) as EmailMessage;

        // Construct email parameters
        const mailParams: SendEmailCommandInput = {
            Destination: {
                ToAddresses: [body.ToEmailAddress],
            },
            Message: {
                Body: {
                    Text: { Data: body.Message },
                },
                Subject: { Data: body.Subject },
            },
            Source: body.FromEmailAddress,
        };

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
    Subject: string;
    Message: string;
}
