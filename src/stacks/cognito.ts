import * as awsCognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { CognitoUserPoolsAuthorizer } from "aws-cdk-lib/aws-apigateway";

import { IApplicationConfig } from "../interfaces/config.interface";

export interface ICognitoConfig {
    userPool: ICognitoUserPoolConfig
}

export interface ICognitoUserPoolConfig {
    props: awsCognito.UserPoolProps;
}

export class CognitoStack {
    
    userPool!: awsCognito.UserPool;
    userPoolClient!: awsCognito.UserPoolClient;
    userPoolAuthorizer!: CognitoUserPoolsAuthorizer;
    role!: iam.Role;

    constructor(private config: ICognitoConfig) {
        console.log("Cognito Stack constructor", config);
    }

    public construct(appConfig: IApplicationConfig) {
        console.log("Cognito construct", appConfig); 
        const userPoolConfig = this.config.userPool;

        const mainStack = Reflect.get(globalThis, "mainStack");

        // TODO: Add ability to create multiple user pools
        // TODO: Add ability to create multi-teant user pools
        const userPool = new awsCognito.UserPool(mainStack, `${appConfig?.name}-${this.getTenantId()}-userPool`, {
            selfSignUpEnabled: userPoolConfig.props.selfSignUpEnabled,
            accountRecovery: userPoolConfig.props.accountRecovery,
            userVerification: {
              emailStyle: awsCognito.VerificationEmailStyle.CODE,
            },
            autoVerify: {
                email: true,
            },
            signInAliases: {
                email: true,
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
                tempPasswordValidity: Duration.days(3),
            }
        });

        this.userPool = userPool;
        
        const userPoolClient = new awsCognito.UserPoolClient(mainStack, `${appConfig?.name}-${this.getTenantId()}-userPoolclient`, { 
            userPool,
            generateSecret: false,
            authFlows: {
                userPassword: true,
            },
        });
        this.userPoolClient = userPoolClient;

        const identityPool = new awsCognito.CfnIdentityPool(mainStack, `${appConfig?.name}-${this.getTenantId()}-identityPool`, {
            allowUnauthenticatedIdentities: true,
            cognitoIdentityProviders: [{
                clientId: userPoolClient.userPoolClientId,
                providerName: userPool.userPoolProviderName,
            }],
        });

        // IAM role for unauthenticated users
        this.role = new iam.Role(mainStack, `${appConfig?.name}-cognitoAuthenticatedRole`, {
            assumedBy: new iam.FederatedPrincipal(
              "cognito-identity.amazonaws.com",
              {
                StringEquals: {
                  "cognito-identity.amazonaws.com:aud": identityPool.ref,
                },
                "ForAnyValue:StringLike": {
                  "cognito-identity.amazonaws.com:amr": "authenticated",
                },
              },
              "sts:AssumeRoleWithWebIdentity"
            ),
          });
          this.role.addToPolicy(
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "mobileanalytics:PutEvents",
                "cognito-sync:*",
                "cognito-identity:*",
              ],
              resources: ["*"],
            })
          );
          this.role.addToPolicy(
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "execute-api:Invoke"
              ],
              resources: ["*"],
            })
          );
        new awsCognito.CfnIdentityPoolRoleAttachment(mainStack, `${appConfig?.name}-IPRA`, {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: this.role.roleArn,
            },
        });

        this.userPoolAuthorizer = new CognitoUserPoolsAuthorizer(mainStack, `${appConfig?.name}-Authorizer`, {
            cognitoUserPools: [userPool],
            identitySource: 'method.request.header.Authorization',
        });

        Reflect.set(globalThis, "userPoolID", userPool.userPoolId);
        Reflect.set(globalThis, "userPoolClientID", userPoolClient.userPoolClientId)
        Reflect.set(globalThis, "userPoolAuthorizer", this.userPoolAuthorizer)

    }

    public addCognitoTrigger(lambdaFunction: any){
        this.userPool.addTrigger(awsCognito.UserPoolOperation.POST_CONFIRMATION, lambdaFunction);
    }

    private getTenantId() {
        return Reflect.get(globalThis, "tenantId");
    }

}
