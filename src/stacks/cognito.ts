import { UserPool, UserPoolClient, VerificationEmailStyle, CfnIdentityPool } from "aws-cdk-lib/aws-cognito";
import { CognitoUserPoolsAuthorizer } from "aws-cdk-lib/aws-apigateway";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { readFileSync } from "fs";
import { IApplicationConfig } from "../interfaces/config.interface";
import { CognitoAuthRole } from "../constructs/cognito-auth-role";
import { LambdaFunction } from "../constructs/lambda-function";
import { ICognitoConfig } from "../interfaces/cognito.config.interface";
import { Fw24 } from "../core/fw24";

export class CognitoStack {
    userPool!: UserPool;
    userPoolClient!: UserPoolClient;
    userPoolAuthorizer!: CognitoUserPoolsAuthorizer;
    //role!: Role;

    constructor(private config: ICognitoConfig) {
        console.log("Cognito Stack constructor", config);
    }

    public construct(fw24: Fw24) {
        console.log("Cognito construct");
        const userPoolConfig = this.config.userPool;

        const mainStack = Reflect.get(globalThis, "mainStack");
        const namePrefix = `${fw24.appName}-${this.getTenantId()}`


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

        this.userPool = userPool;

        const userPoolClient = new UserPoolClient(mainStack, `${namePrefix}-userPoolclient`, {
            userPool,
            generateSecret: false,
            authFlows: {
                userPassword: true,
            },
        });
        this.userPoolClient = userPoolClient;

        // cognito autorizer 
        this.userPoolAuthorizer = new CognitoUserPoolsAuthorizer(mainStack, `${namePrefix}-Authorizer`, { // do we need to add tenantId to the name??
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
        const authenticatedRole = new CognitoAuthRole(mainStack, "CognitoAuthRole", { // do we need to add tenantId to the name??
            identityPool,
        });

        // apply the policy to the role
        if (this.config.policyFilePath) {
            // read file from policyFilePath
            const policyfile: string = readFileSync(this.config.policyFilePath, 'utf8');
            authenticatedRole.role.addToPolicy(
                new PolicyStatement({
                    effect: JSON.parse(policyfile).Effect,
                    actions: JSON.parse(policyfile).Action,
                    resources: JSON.parse(policyfile).Resource,
                })
            );
        }
        // create triggers
        if (this.config.triggers) {
            for (const trigger of this.config.triggers) {
                // Will it be one lambda per tenant?
                const lambdaTrigger = new LambdaFunction(mainStack, `${namePrefix}-${trigger.trigger}-lambdaFunction`, {
                    entry: trigger.lambdaFunctionPath,
                    // do we need the layer?
                });
                userPool.addTrigger(trigger.trigger, lambdaTrigger.fn);
            }
        }

        Reflect.set(globalThis, "userPoolID", userPool.userPoolId);
        Reflect.set(globalThis, "userPoolClientID", userPoolClient.userPoolClientId)
        Reflect.set(globalThis, "userPoolAuthorizer", this.userPoolAuthorizer)
    }

    private getTenantId() {
        return Reflect.get(globalThis, "tenantId");
    }
}
