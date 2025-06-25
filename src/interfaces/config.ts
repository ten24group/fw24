import { Authorizer } from './../decorators/authorizer';
import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { DIContainer } from "../di/container";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { IDIContainer } from "./di";
import { AuthorizerTypeMetadata, IControllerConfig } from '../decorators';

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
    environment?: string; // local, dev, prod
    environmentVariables?: Record<string, string>;
    logRetentionDays?: number;
    logRemovalPolicy?: RemovalPolicy;
    functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
        readonly layers?: Array<ILayerVersion | string>;
    }
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
    // TODO: integrate this into the application
    systemFeatures?: {
        controller?: {
            enabled?: boolean;
            config?: IControllerConfig
        };
        uiConfig?: {
            enabled?: boolean;
            menuGroup?: 'nav' | 'system';
        }
    };
}

// fw24/src/interfaces/system-controller.ts
export interface SystemControllerDefinition {
    path: string; // Base path (e.g., '/system/search')
    filePath: string; // Path to the controller file
    // config?: IControllerConfig;
    uiConfig?: SystemUIPageDefinition;
}

export interface SystemUIPageDefinition {
    pageId: string;
    title: string;
    description?: string;
    icon?: string;
    order?: number;
    config: any; // TODO: UI page configuration
}

