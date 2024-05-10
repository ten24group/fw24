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
import { CognitoAuthRole } from "./cognito-auth-role";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { Fw24 } from "../core/fw24";
import { IConstruct, IConstructOutout, OutputType } from "../interfaces/construct";
import { createLogger, LogDuration } from "../logging";
import { Helper } from "../core";

export interface IAuthConstructConfig {
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
        functionProps: LambdaFunctionProps;
    }[];
    groups?: {
        name: string;
        precedence?: number;
        policyFilePaths?: string[];
        // during signup the user will be added to this group
        autoUserSignup?: boolean;
        autoUserSignupHandler?: LambdaFunctionProps;
        // Routes protected by this group
        routes?: string[];
    }[];
    useAsDefaultAuthorizer?: boolean;
}


const AuthConstructConfigDefaults: IAuthConstructConfig = {
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


export class AuthConstruct implements IConstruct {
    readonly logger = createLogger(AuthConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = AuthConstruct.name;
    dependencies: string[] = [];
    output!: IConstructOutout;

    mainStack!: Stack;
    
    // default constructor to initialize the stack configuration
    constructor(private authConstructConfig: IAuthConstructConfig) {
        Helper.hydrateConfig(authConstructConfig,'COGNITO');
    }

    // construct method to create the stack
    public async construct() {
        this.logger.debug("construct");

        this.mainStack = this.fw24.getStack("main");

        const userPoolConfig = {...AuthConstructConfigDefaults.userPool?.props, ...this.authConstructConfig.userPool?.props};
        const userPoolName = this.authConstructConfig.name || 'default';
        this.logger.debug("user pool config: ", userPoolName, userPoolConfig);

        const namePrefix = this.createNamePrefix(userPoolName);
        if(this.authConstructConfig.useAsDefaultAuthorizer === undefined){
            this.authConstructConfig.useAsDefaultAuthorizer = true;
        }

        // TODO: Add ability to create multi-tenant user pools
        const userPool: UserPool = new UserPool(this.mainStack, `${namePrefix}-userPool`, {
            ...userPoolConfig,
            userPoolName: namePrefix
        });
        this.fw24.setConstructOutput(this, OutputType.USERPOOL, userPoolName, userPool);

        const userPoolClientConfig: UserPoolClientProps = {
            userPool: userPool,
            ...AuthConstructConfigDefaults.userPoolClient?.props, 
            ...this.authConstructConfig.userPoolClient?.props
        };

        const userPoolClient = new UserPoolClient(this.mainStack, `${namePrefix}-userPoolclient`, {
            ...userPoolClientConfig
        });
        this.fw24.setConstructOutput(this, OutputType.USERPOOLCLIENT, userPoolName, userPoolClient);

        // Identity pool based authentication
        if(this.authConstructConfig.groups || this.authConstructConfig.policyFilePaths || this.fw24.getConfig().defaultAuthorizationType == 'AWS_IAM') {
            this.createIdentityPoolAuthorizer(userPool, userPoolClient, userPoolName, this.authConstructConfig.useAsDefaultAuthorizer);
        } else {
            // user pool base authentification
            this.createUserPoolAutorizer(userPool, userPoolName, this.authConstructConfig.useAsDefaultAuthorizer);
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

        if(useAsDefaultAuthorizer !== false){
            this.fw24.getConfig().defaultAuthorizationType = 'COGNITO_USER_POOLS';
            this.fw24.setDefaultCognitoAuthorizerName(userPoolName);
            this.logger.info("Default Authorizer set to COGNITO_USER_POOLS");
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
        if (this.authConstructConfig.groups) {
            this.fw24.set('Groups', this.authConstructConfig.groups.map(group => group.name), 'cognito');
            //this.fw24.set('AutoUserSignupGroups', this.authConfig.groups.filter(group => group.autoUserSignup).map(group => group.name).toString(), userPoolName);
            for (const group of this.authConstructConfig.groups) {
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
            const autoUserSignupGroups = this.authConstructConfig.groups.filter(group => group.autoUserSignup).map(group => group.name).toString();
            const autoUserSignupGroupsHandler = this.authConstructConfig.groups.filter(group => group.autoUserSignup).map(group => group.autoUserSignupHandler);
            // only one auto signup handler is supported, pick the first one
            const autoGroupsAddHandler = autoUserSignupGroupsHandler[0] || '';
            if(autoUserSignupGroups && autoGroupsAddHandler){
                // create a post confirmation trigger to add users to auto signup groups
                const props = {
                    environmentVariables: {
                        autoSignupGroups: autoUserSignupGroups,
                    },
                    policies: [
                        {
                            actions: ['cognito-idp:AdminAddUserToGroup'],
                            resources: ['*'],
                        }
                    ]
                }
                const lambdaFunctionProps = {
                    ...autoGroupsAddHandler,
                    ...props
                }
                this.logger.debug("autoUserSignupGroupsHandler: ", lambdaFunctionProps);
                const lambdaTrigger = new LambdaFunction(this.mainStack, `${namePrefix}-auto-post-confirmation-lambdaFunction`, {
                    ...lambdaFunctionProps,
                }) as NodejsFunction;
                userPool.addTrigger(UserPoolOperation.POST_CONFIRMATION, lambdaTrigger);
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
        const policyFilePaths = this.authConstructConfig.policyFilePaths;
        const authenticatedRole = new CognitoAuthRole(this.mainStack, `${namePrefix}-CognitoAuthRole`, {
            identityPool,
            policyFilePaths
        }) as Role;

        // if no groups are defined all policies are added to the default authenticated role
        this.fw24.set('Role', authenticatedRole, `cognito_default`);

        roleAttachment.roles = {};
        roleAttachment.roles.authenticated = authenticatedRole.roleArn;

        new CfnIdentityPoolRoleAttachment(this.mainStack, `${namePrefix}-IdentityPoolRoleAttachment`, roleAttachment);

        // create triggers
        if (this.authConstructConfig.triggers) {
            for (const trigger of this.authConstructConfig.triggers) {
                const lambdaTrigger = new LambdaFunction(this.mainStack, `${namePrefix}-${trigger.trigger}-lambdaFunction`, {
                    ...trigger.functionProps,
                }) as NodejsFunction;
                userPool.addTrigger(trigger.trigger, lambdaTrigger);
            }
        }
        this.fw24.set("identityPoolID", identityPool.ref, userPoolName);
        if(useAsDefaultAuthorizer !== false){
            this.fw24.getConfig().defaultAuthorizationType = 'AWS_IAM';
            this.logger.info("Default Authorizer set to AWS_IAM");
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
