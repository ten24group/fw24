import { UserPool, UserPoolClient, CfnIdentityPool, CfnUserPoolGroup, UserPoolProps, UserPoolOperation, CfnIdentityPoolRoleAttachment, VerificationEmailStyle} from "aws-cdk-lib/aws-cognito";
import { Role } from "aws-cdk-lib/aws-iam";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { CognitoUserPoolsAuthorizer } from "aws-cdk-lib/aws-apigateway";
import { IApplicationConfig } from "../interfaces/config";
import { CognitoAuthRole } from "../constructs/CognitoAuthRole";

export interface ICognitoConfig {
    userPool: ICognitoUserPoolConfig,
    policyFilePaths?: string[];
    groups?: {
        name: string;
        precedence?: number;
        policyFilePaths: string[];
    }[]
}

export interface ICognitoUserPoolConfig {
    props: UserPoolProps;
}

export class CognitoStack {
    
    userPool!: UserPool;
    userPoolClient!: UserPoolClient;
    userPoolAuthorizer!: CognitoUserPoolsAuthorizer;
    role!: Role;

    constructor(private config: ICognitoConfig) {
        console.log("Cognito Stack constructor", config);
    }

    public construct(appConfig: IApplicationConfig) {
        console.log("Cognito construct", appConfig); 
        const userPoolConfig = this.config.userPool;

        const mainStack = Reflect.get(globalThis, "mainStack");
        const userPoolName = userPoolConfig.props.userPoolName || '';

        // TODO: Add ability to create multiple user pools
        // TODO: Add ability to create multi-teant user pools
        const userPool = new UserPool(mainStack, `${appConfig?.name}-${this.getTenantId()}-${userPoolName}userPool`, {
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

        this.userPool = userPool;
        
        const userPoolClient = new UserPoolClient(mainStack, `${appConfig?.name}-${this.getTenantId()}-userPoolclient`, { 
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
        const identityPool = new CfnIdentityPool(mainStack, `${appConfig?.name}-${this.getTenantId()}-identityPool`, {
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

        const namePrefix = `${appConfig?.name}-${this.getTenantId()}`;
        // create user pool groups
        if (this.config.groups) {
            for (const group of this.config.groups) {
                // create a role for the group
                const policyFilePaths = group.policyFilePaths;
                const role = new CognitoAuthRole(mainStack, `${namePrefix}-${group.name}-CognitoAuthRole`, {
                    identityPool,
                    policyFilePaths,
                }).role;

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
        const policyFilePaths = this.config.policyFilePaths;
        const authenticatedRole = new CognitoAuthRole(mainStack, `${namePrefix}-CognitoAuthRole`, {
            identityPool,
            policyFilePaths
        }).role;

        roleAttachment.roles = {};
        roleAttachment.roles.authenticated = authenticatedRole.roleArn;

        new CfnIdentityPoolRoleAttachment(mainStack, `${namePrefix}-IdentityPoolRoleAttachment`, roleAttachment);

        Reflect.set(globalThis, "userPoolID", userPool.userPoolId);
        Reflect.set(globalThis, "userPoolClientID", userPoolClient.userPoolClientId);
        Reflect.set(globalThis, "identityPoolID", identityPool.ref);
        Reflect.set(globalThis, "userPoolAuthorizer", this.userPoolAuthorizer)

    }

    public addCognitoTrigger(lambdaFunction: any){
        this.userPool.addTrigger(UserPoolOperation.POST_CONFIRMATION, lambdaFunction);
    }

    private getTenantId() {
        return Reflect.get(globalThis, "tenantId");
    }

}
