import { 
    CfnIdentityPool, 
    CfnIdentityPoolRoleAttachment,
    CfnUserPoolGroup,
    UserPool, 
    UserPoolClient, 
    UserPoolProps, 
    UserPoolOperation,
    VerificationEmailStyle, 
} from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CognitoUserPoolsAuthorizer } from "aws-cdk-lib/aws-apigateway";
import { Role } from "aws-cdk-lib/aws-iam";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { CognitoAuthRole } from "../constructs/cognito-auth-role";
import { LambdaFunction } from "../constructs/lambda-function";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";


export interface ICognitoConfig {
    userPool: {
        props: UserPoolProps;
    };
    policyFilePaths?: string[];
    triggers?: {
        trigger: UserPoolOperation;
        lambdaFunctionPath: string;
    }[];
    groups?: {
        name: string;
        precedence?: number;
        policyFilePaths: string[];
    }[]
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

        const userPoolConfig = this.stackConfig.userPool;
        const mainStack = this.fw24.getStack("main");
        var namePrefix = `${this.fw24.appName}`;

        if(this.fw24.get("tenantId")){
            namePrefix = `${namePrefix}-${this.fw24.get("tenantId")}`
        }

        const userPoolName = userPoolConfig.props.userPoolName || 'default';

        // TODO: Add ability to create multi-tenant user pools
        const userPool = new UserPool(mainStack, `${namePrefix}-${userPoolName}userPool`, {
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
            },
            removalPolicy: userPoolConfig.props.removalPolicy || RemovalPolicy.RETAIN,
        });

        const userPoolClient = new UserPoolClient(mainStack, `${namePrefix}-userPoolclient`, {
            userPool,
            generateSecret: false,
            authFlows: {
                userPassword: true,
            },
        });

        // cognito authorizer 
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

        // configure identity pool role attachment
        const identityProvider = userPool.userPoolProviderName + ':' + userPoolClient.userPoolClientId;
        const roleAttachment: any = {
            identityPoolId: identityPool.ref,
        }

         // create user pool groups
        if (this.stackConfig.groups) {
            for (const group of this.stackConfig.groups) {
                // create a role for the group
                const policyFilePaths = group.policyFilePaths;
                const role = new CognitoAuthRole(mainStack, `${namePrefix}-${group.name}-CognitoAuthRole`, {
                    identityPool,
                    policyFilePaths,
                }) as Role;

                new CfnUserPoolGroup(mainStack, `${namePrefix}-${group.name}-group`, {
                    groupName: group.name,
                    userPoolId: userPool.userPoolId,
                    roleArn: role.roleArn,
                    precedence: group.precedence || 0,
                });
            }
            // configure role mapping
            roleAttachment.roleMappings = {
                "userpool": {
                    type: "Token",
                    ambiguousRoleResolution: "Deny",
                    identityProvider: identityProvider,
                }
            }
        }

        // IAM role for authenticated users if no groups are defined
        const policyFilePaths = this.stackConfig.policyFilePaths;
        const authenticatedRole = new CognitoAuthRole(mainStack, `${namePrefix}-CognitoAuthRole`, {
            identityPool,
            policyFilePaths
        }) as Role;

        roleAttachment.roles = {};
        roleAttachment.roles.authenticated = authenticatedRole.roleArn;

        new CfnIdentityPoolRoleAttachment(mainStack, `${namePrefix}-IdentityPoolRoleAttachment`, roleAttachment);
        // create triggers
        if (this.stackConfig.triggers) {
            for (const trigger of this.stackConfig.triggers) {
                const lambdaTrigger = new LambdaFunction(mainStack, `${namePrefix}-${trigger.trigger}-lambdaFunction`, {
                    entry: trigger.lambdaFunctionPath,
                    layerArn: this.fw24.getLayerARN(),
                }) as NodejsFunction;
                userPool.addTrigger(trigger.trigger, lambdaTrigger);
            }
        }

        this.fw24.set("userPoolID", userPool.userPoolId);
        this.fw24.set("userPoolClientID", userPoolClient.userPoolClientId);
        this.fw24.set("identityPoolID", identityPool.ref);
        this.fw24.setCognitoAuthorizer(userPoolName, userPoolAuthorizer, true);
    }
}
