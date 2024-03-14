import * as awsCognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { CognitoUserPoolsAuthorizer } from "aws-cdk-lib/aws-apigateway";
import { IApplicationConfig } from "../interfaces/config.interface";
import { CognitoAuthRole } from "../constructs/CognitoAuthRole";
import * as fs from "fs";

export interface ICognitoConfig {
    userPool: ICognitoUserPoolConfig,
    policyFilePath?: string;
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

        // cognito autorizer
        this.userPoolAuthorizer = new CognitoUserPoolsAuthorizer(mainStack, `${appConfig?.name}-Authorizer`, {
            cognitoUserPools: [userPool],
            identitySource: 'method.request.header.Authorization',
        });

        // Identity pool based authentication
        const identityPool = new awsCognito.CfnIdentityPool(mainStack, `${appConfig?.name}-${this.getTenantId()}-identityPool`, {
            allowUnauthenticatedIdentities: true,
            cognitoIdentityProviders: [{
                clientId: userPoolClient.userPoolClientId,
                providerName: userPool.userPoolProviderName,
            }],
        });

        // IAM role for authenticated users
        const authenticatedRole = new CognitoAuthRole(mainStack, "CognitoAuthRole", {
            identityPool,
        });

        // apply the policy to the role
        if (this.config.policyFilePath) {
            // read file from policyFilePath
            const policyfile: string = fs.readFileSync(this.config.policyFilePath, 'utf8');
            authenticatedRole.role.addToPolicy(
                new iam.PolicyStatement(JSON.parse(policyfile))
            );
        }

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
