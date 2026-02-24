import { Queue, QueueController } from '@ten24group/fw24';
import type { SQSEvent, Context } from 'aws-lambda';

@Queue('notifications-queue')
export class NotificationQueueController extends QueueController {
    async process(event: SQSEvent, _context: Context) {
        for (const record of event.Records) {
            console.log(`✉️ Processing notification: ${record.body}`);
        }
    }
}
