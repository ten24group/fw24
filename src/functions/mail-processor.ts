import { SQSHandler, SQSEvent } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';


export const handler: SQSHandler = async (event: SQSEvent) => {
    console.log('Event: ', event);

    const sesClient = new SESClient( { region: 'us-east-1' }) ;

    for (const record of event.Records) {
        console.log("messageId: " + record.messageId);

        const body = JSON.parse(record.body) as {
          FromEmailAddress: any;
          ToEmailAddress: any;
          Subject: string;
          Message: string;
        };

        const mailParam = {
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

        console.log("Mail: ", mailParam);
    
        // send the email
        const command = new SendEmailCommand(mailParam);
        const result = await sesClient.send(command);
        console.log("Result: ", result);
    }

    return Promise.resolve();
}