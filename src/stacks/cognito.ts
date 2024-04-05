import { 
    UserPool, 
    UserPoolClient, 
    VerificationEmailStyle, 
    CfnIdentityPool, 
    UserPoolProps, 
    UserPoolOperation 
} from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CognitoUserPoolsAuthorizer } from "aws-cdk-lib/aws-apigateway";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { readFileSync } from "fs";
import { CognitoAuthRole } from "../constructs/cognito-auth-role";
import { LambdaFunction } from "../constructs/lambda-function";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";


export interface ICognitoConfig {
    userPool: {
        props: UserPoolProps;
    };
    policyFilePath?: string;
    triggers?: {
        trigger: UserPoolOperation;
        lambdaFunctionPath: string;
    }[];
}

export class CognitoStack implements IStack {
    fw24: Fw24 = Fw24.getInstance();
    dependencies: string[] = [];
    
    // default constructor to initialize the stack configuration
    constructor(private stackConfig: ICognitoConfig) {
        console.log("Cognito Stack constructor", stackConfig);
    }

    // construct method to create the stack
    public construct() {
        console.log("Cognito construct");

        const fw24 = Fw24.getInstance();
        const userPoolConfig = this.stackConfig.userPool;
        const mainStack = fw24.getStack("main");
        var namePrefix = `${fw24.appName}`;

        if(fw24.get("tenantId")){
            namePrefix = `${namePrefix}-${fw24.get("tenantId")}`
        }

        // TODO: Add ability to create multiple user pools
        // TODO: Add ability to create multi-teant user pools
        const userPool = new UserPool(mainStack, `${namePrefix}-userPool`, {
            selfSignUpEnabled: userPoolConfig.props.selfSignUpEnabled,
            accountRecovery: userPoolConfig.props.accountRecovery,
            userVerification: {
                emailStyle: VerificationEmailStyle.CODE,
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

        const userPoolClient = new UserPoolClient(mainStack, `${namePrefix}-userPoolclient`, {
            userPool,
            generateSecret: false,
            authFlows: {
                userPassword: true,
            },
        });

        // cognito autorizer 
        const userPoolAuthorizer = new CognitoUserPoolsAuthorizer(mainStack, `${namePrefix}-Authorizer`, {
            cognitoUserPools: [userPool],
            identitySource: 'method.request.header.Authorization',
        });

        // Identity pool based authentication
        const identityPool = new CfnIdentityPool(mainStack, `${namePrefix}-identityPool`, {
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
        if (this.stackConfig.policyFilePath) {
            // read file from policyFilePath
            const policyfile: string = readFileSync(this.stackConfig.policyFilePath, 'utf8');
            authenticatedRole.role.addToPolicy(
                new PolicyStatement({
                    effect: JSON.parse(policyfile).Effect,
                    actions: JSON.parse(policyfile).Action,
                    resources: JSON.parse(policyfile).Resource,
                })
            );
        }
        // create triggers
        if (this.stackConfig.triggers) {
            for (const trigger of this.stackConfig.triggers) {
                const lambdaTrigger = new LambdaFunction(mainStack, `${namePrefix}-${trigger.trigger}-lambdaFunction`, {
                    entry: trigger.lambdaFunctionPath,
                    layerArn: fw24.getLayerARN(),
                }) as NodejsFunction;
                userPool.addTrigger(trigger.trigger, lambdaTrigger);
            }
        }

        fw24.set("userPoolID", userPool.userPoolId);
        fw24.set("userPoolClientID", userPoolClient.userPoolClientId);
        fw24.setCognitoAuthorizer(this.stackConfig.userPool.props.userPoolName || 'default', userPoolAuthorizer, true);
    }
}
