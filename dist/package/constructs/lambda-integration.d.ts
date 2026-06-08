import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
export interface LambdaIntegrationOnePermissionOnlyOptions extends apigateway.LambdaIntegrationOptions {
    restApi: apigateway.IRestApi;
    path: string;
}
export declare class LambdaIntegration extends apigateway.LambdaIntegration {
    constructor(handler: lambda.IFunction, options: LambdaIntegrationOnePermissionOnlyOptions);
    bind(method: apigateway.Method): apigateway.IntegrationConfig;
}
