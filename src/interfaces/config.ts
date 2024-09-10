import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { DIContainer } from "../di/di-container";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { IDIContainer } from "./di";

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
    functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
		readonly layers?: Array<ILayerVersion | string>;
	}
    appDIContainer?: IDIContainer;
    lambdaEntryPackages?: string[];
}

