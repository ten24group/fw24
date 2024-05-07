import { RemovalPolicy } from "aws-cdk-lib";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";

export interface IApplicationConfig {
    name?: string;
    region?: string;
    account?: string;
    authEndpoint?: string;
    defaultAuthorizationType?: any;
    environment?: string; // local, dev, prod
    logRetentionDays?: number;
    logRemovalPolicy?: RemovalPolicy;
    functionProps?: NodejsFunctionProps
}

