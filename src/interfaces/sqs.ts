import { QueueProps } from "aws-cdk-lib/aws-sqs";

export interface ISQSConfig {
    queues?: string | any[];
    queueOptions?: QueueProps;
}
