import type { RemovalPolicy } from 'aws-cdk-lib';
import type { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { IDIContainer } from './di';

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
  defaultAdminGroups?: string[];
  environment?: string; // local, dev, prod
  environmentVariables?: Record<string, string>;
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
}
