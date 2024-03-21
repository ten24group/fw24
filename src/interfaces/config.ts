export interface IApplicationConfig {
    name?: string;
    env?: string
    coreVersion?: number;
    region?: string;
    account?: string;
    defaultAuthorizationType?: any;
    mailQueueName?: string;
}
