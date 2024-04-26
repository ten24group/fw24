import { RemovalPolicy } from "aws-cdk-lib";

export interface IApplicationConfig {
    name?: string;
    coreVersion?: number;
    region?: string;
    account?: string;
    defaultAuthorizationType?: any;
    environment?: string; // local, dev, prod
    logRetentionDays?: number;
    logRemovalPolicy?: RemovalPolicy;
}

