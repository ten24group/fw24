import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export interface LambdaIntegrationOnePermissionOnlyOptions extends apigateway.LambdaIntegrationOptions {
  restApi: apigateway.IRestApi,
  path: string
}

export class LambdaIntegration extends apigateway.LambdaIntegration {

  constructor(handler: lambda.IFunction, options: LambdaIntegrationOnePermissionOnlyOptions) {
    super(handler, options);

    handler.addPermission('BaseRoutesHandler_ApiGatewayPermissions', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: options.restApi.arnForExecuteApi('*',`/${options.path}`,'*')
    });   
    
    handler.addPermission('AllRoutesHandler_ApiGatewayPermissions', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: options.restApi.arnForExecuteApi('*',`/${options.path}`,'*') + '/*'
    });   

  }

  bind(method: apigateway.Method): apigateway.IntegrationConfig {
    const integrationConfig = super.bind(method);

    // Remove all AWS::Lambda::Permission on methods
    const permissions = method.node.children.filter(c => c instanceof lambda.CfnPermission);
    permissions.forEach(p => method.node.tryRemoveChild(p.node.id));
    return integrationConfig;
  }
}