import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { IDIContainer } from "./di";
import { IControllerConfig } from '../decorators';
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
        signInMethods?: ('EMAIL_PASSWORD' | 'EMAIL_OTP' | 'SMS_OTP' | 'PASSKEY')[];
        customPagesDirectory?: string;
    };
    defaultAuthorizationType?: any;
    defaultAdminGroups?: string[];
    environment?: string;
    environmentVariables?: Record<string, string>;
    globalEnvironmentVariables?: Record<string, string>;
    logRetentionDays?: number;
    logRemovalPolicy?: RemovalPolicy;
    functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
        readonly layers?: Array<ILayerVersion | string>;
    };
    /**
     * The timeout duration for the Lambda function in seconds.
     * Use this timeout to avoid importing the duration class from aws-cdk-lib.
     */
    functionTimeout?: number;
    appDIContainer?: IDIContainer;
    lambdaEntryPackages?: string[];
    defaultStackName?: string;
    layerStackName?: string;
    multiStack?: boolean;
    systemFeatures?: {
        controller?: {
            enabled?: boolean;
            config?: IControllerConfig;
        };
        uiConfig?: {
            enabled?: boolean;
            menuGroup?: 'nav' | 'system';
        };
    };
}
export interface SystemControllerDefinition {
    path: string;
    filePath: string;
    uiConfig?: SystemUIPageDefinition;
}
export interface SystemUIPageDefinition {
    pageId: string;
    title: string;
    description?: string;
    icon?: string;
    order?: number;
    config: any;
}
