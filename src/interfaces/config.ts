import { RemovalPolicy } from "aws-cdk-lib";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";

export interface IApplicationConfig {
    name?: string;
    region?: string;
    account?: string;
    disableUIConfigGen?: boolean;
    uiConfigGenOptions?: {
        authEndpoint?: string;
        disableSignIn?: boolean;
        disableSignUp?: boolean;
        disableForgotPassword?: boolean;
        disableAccountVerification?: boolean;
    };
    defaultAuthorizationType?: any;
    environment?: string; // local, dev, prod
    environmentVariables?: Record<string, string>;
    logRetentionDays?: number;
    logRemovalPolicy?: RemovalPolicy;
    functionProps?: NodejsFunctionProps
}

