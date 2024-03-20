import { EventType } from 'aws-cdk-lib/aws-s3';

export interface IS3Config {
    bucketName: string;
    removalPolicy?: any;
    autoDeleteObjects?: boolean;
    publicReadAccess?: boolean;
    source?: string;
    triggers?: IS3TriggerConfig[];
}

export interface IS3TriggerConfig {
    events: EventType[];
    destination: string;
    handler?: string;
    queueName?: string;
}

