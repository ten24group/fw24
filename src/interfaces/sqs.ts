import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { ILambdaEnvConfig } from "./lambda-env";

export interface ISQSConfig {
    queuesDirectory?: string;
    queueOptions?: QueueProps;
    env?: ILambdaEnvConfig[];
}