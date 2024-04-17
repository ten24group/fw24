import { 
    CfnIdentityPool, 
    CfnIdentityPoolRoleAttachment,
    CfnUserPoolGroup,
    UserPool, 
    UserPoolClient, 
    UserPoolProps, 
    UserPoolOperation,
    VerificationEmailStyle,
    UserPoolClientProps, 
} from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CognitoUserPoolsAuthorizer } from "aws-cdk-lib/aws-apigateway";
import { Role, User } from "aws-cdk-lib/aws-iam";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { CognitoAuthRole } from "../constructs/cognito-auth-role";
import { LambdaFunction } from "../constructs/lambda-function";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";
import { createLogger, LogDuration } from "../logging";

export interface ICognitoConfig {
    name?: string;
    userPool?: {
        props: UserPoolProps;
    };
    userPoolClient?: {
        props: any;
    };
    policyFilePaths?: string[];
    triggers?: {
        trigger: UserPoolOperation;
        lambdaFunctionPath: string;
    }[];
    groups?: {
        name: string;
        precedence?: number;
        policyFilePaths?: string[];
        // during signup the user will be added to default group
        autoUserSignup?: boolean;
        // Routes protected by this group
        routes?: string[];
    }[];
    useAsDefaultAuthorizer?: boolean;
}


const CognitoConfigDefaults: ICognitoConfig = {
    userPool: {
        props: {
            selfSignUpEnabled: false,
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
            removalPolicy: RemovalPolicy.RETAIN,

        }
    },
    userPoolClient: {
        props: {
            generateSecret: false,
            authFlows: {
                userPassword: true,
            }
        }
    }
}


export class CognitoStack implements IStack {
    readonly logger = createLogger(CognitoStack.name);

    fw24: Fw24 = Fw24.getInstance();
    dependencies: string[] = [];
    mainStack!: Stack;
    
    // default constructor to initialize the stack configuration
    constructor(private stackConfig: ICognitoConfig) {
        this.logger.debug("constructor: ", stackConfig);
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        this.logger.debug("construct");

        this.mainStack = this.fw24.getStack("main");

        const userPoolConfig = {...CognitoConfigDefaults.userPool?.props, ...this.stackConfig.userPool?.props};
        const userPoolName = this.stackConfig.name || 'default';
        this.logger.debug("user pool config: ", userPoolName, userPoolConfig);

        const namePrefix = this.createNamePrefix(userPoolName);
        if(this.stackConfig.useAsDefaultAuthorizer === undefined){
            this.stackConfig.useAsDefaultAuthorizer = true;
        }

        // TODO: Add ability to create multi-tenant user pools
        const userPool: UserPool = new UserPool(this.mainStack, `${namePrefix}-userPool`, {
            ...userPoolConfig,
            userPoolName: namePrefix
        });

        const userPoolClientConfig: UserPoolClientProps = {
            userPool: userPool,
            ...CognitoConfigDefaults.userPoolClient?.props, 
            ...this.stackConfig.userPoolClient?.props
        };

        const userPoolClient = new UserPoolClient(this.mainStack, `${namePrefix}-userPoolclient`, {
            ...userPoolClientConfig
        });

        // Identity pool based authentication
        if(this.stackConfig.groups || this.stackConfig.policyFilePaths || this.fw24.getConfig().defaultAuthorizationType == 'AWS_IAM') {
            this.createIdentityPoolAuthorizer(userPool, userPoolClient, userPoolName, this.stackConfig.useAsDefaultAuthorizer);
        } else {
            // user pool base authentification
            this.createUserPoolAutorizer(userPool, userPoolName, this.stackConfig.useAsDefaultAuthorizer);
        }

        this.fw24.set("userPoolID", userPool.userPoolId, userPoolName);
        this.fw24.set("userPoolClientID", userPoolClient.userPoolClientId, userPoolName);

    }

    private createUserPoolAutorizer(userPool: UserPool, userPoolName: string, useAsDefaultAuthorizer: boolean) {
        // cognito authorizer 
        const userPoolAuthorizer = new CognitoUserPoolsAuthorizer(this.mainStack, `${this.createNamePrefix(userPoolName)}-Authorizer`, {
            cognitoUserPools: [userPool],
            identitySource: 'method.request.header.Authorization',
        });

        this.fw24.setCognitoAuthorizer(
            userPoolName, 
            userPoolAuthorizer,
            // TODO: better logic to control the default authorizer
            useAsDefaultAuthorizer
        );
        if(useAsDefaultAuthorizer){
            this.fw24.getConfig().defaultAuthorizationType = 'COGNITO_USER_POOLS';
        }
    }

    private createIdentityPoolAuthorizer(userPool: UserPool, userPoolClient: UserPoolClient, userPoolName: string, useAsDefaultAuthorizer: boolean) {
        const namePrefix = this.createNamePrefix(userPoolName)

        const identityPool = new CfnIdentityPool(this.mainStack, `${namePrefix}-identityPool`, {
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
            this.fw24.set('Groups', this.stackConfig.groups.map(group => group.name), 'cognito');
            this.fw24.set('AutoUserSignupGroups', this.stackConfig.groups.filter(group => group.autoUserSignup).map(group => group.name).toString(), userPoolName);
            for (const group of this.stackConfig.groups) {
                // create a role for the group
                const policyFilePaths = group.policyFilePaths;
                const role = new CognitoAuthRole(this.mainStack, `${namePrefix}-${group.name}-CognitoAuthRole`, {
                    identityPool,
                    policyFilePaths,
                }) as Role;

                this.fw24.set('Role', role, `cognito_${group.name}`);
                this.fw24.set('Routes', group.routes, `cognito_${group.name}`);

                new CfnUserPoolGroup(this.mainStack, `${namePrefix}-${group.name}-group`, {
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
        const authenticatedRole = new CognitoAuthRole(this.mainStack, `${namePrefix}-CognitoAuthRole`, {
            identityPool,
            policyFilePaths
        }) as Role;

        roleAttachment.roles = {};
        roleAttachment.roles.authenticated = authenticatedRole.roleArn;

        new CfnIdentityPoolRoleAttachment(this.mainStack, `${namePrefix}-IdentityPoolRoleAttachment`, roleAttachment);

        // create triggers
        if (this.stackConfig.triggers) {
            for (const trigger of this.stackConfig.triggers) {
                const lambdaTrigger = new LambdaFunction(this.mainStack, `${namePrefix}-${trigger.trigger}-lambdaFunction`, {
                    entry: trigger.lambdaFunctionPath,
                    layerArn: this.fw24.getLayerARN(),
                }) as NodejsFunction;
                userPool.addTrigger(trigger.trigger, lambdaTrigger);
            }
        }
        this.fw24.set("identityPoolID", identityPool.ref, userPoolName);
        if(useAsDefaultAuthorizer){
            this.fw24.getConfig().defaultAuthorizationType = 'AWS_IAM';
        }
    }

    private createNamePrefix(userPoolName: string) {
        var namePrefix = `${this.fw24.appName}`;
        namePrefix = `${namePrefix}-${userPoolName}`;
        if(this.fw24.get("tenantId")){
            namePrefix = `${namePrefix}-${this.fw24.get("tenantId")}`
        }
        return namePrefix;
    }
}
