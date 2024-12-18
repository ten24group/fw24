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
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { createLogger, LogDuration } from "../logging";
import { Helper } from "../core";

export type TriggerType = 
    | 'CUSTOM_MESSAGE'
    | 'PRE_SIGN_UP'
    | 'POST_CONFIRMATION'
    | 'PRE_TOKEN_GENERATION'
    | 'USER_MIGRATION'
    | 'DEFINE_AUTH_CHALLENGE'
    | 'CREATE_AUTH_CHALLENGE'
    | 'POST_AUTHENTICATION'
    | 'PRE_AUTHENTICATION'
    | 'PRE_TOKEN_GENERATION_CONFIG'
    | 'VERIFY_AUTH_CHALLENGE_RESPONSE'
    | 'CUSTOM_EMAIL_SENDER'
    | 'CUSTOM_SMS_SENDER';

/**
 * Configuration interface for the AuthConstruct.
 */
export interface IAuthConstructConfig {
    /**
     * Configuration for the User Pool.
     */
    userPool?: {
        props: UserPoolProps;
    };
    /**
     * Configuration for the User Pool Client.
     */
    userPoolClient?: {
        props: any;
    };
    /**
     * Array of file paths for policy files.
     */
    policyFilePaths?: string[];
    /**
     * Array of triggers for user pool operations.
     */
    triggers?: {
        /**
         * The user pool operation that triggers the function.
         */
        trigger: UserPoolOperation | TriggerType;
        /**
         * Configuration for the Lambda function.
         */
        functionProps: LambdaFunctionProps;
    }[];
    /**
     * Array of groups for the AuthConstruct.
     */
    groups?: {
        /**
         * The name of the group.
         */
        name: string;
        /**
         * The precedence of the group.
         */
        precedence?: number;
        /**
         * Array of file paths for policy files specific to this group.
         */
        policyFilePaths?: string[];
        /**
         * Flag indicating whether the user should be automatically signed up to this group during signup.
         */
        autoUserSignup?: boolean;
        /**
         * Configuration for the Lambda function that handles automatic user signup.
         */
        autoUserSignupHandler?: LambdaFunctionProps;
        /**
         * Array of routes protected by this group.
         */
        routes?: string[];
    }[];
    /**
     * Flag indicating whether to use this AuthConstruct as the default authorizer.
     */
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

export class AuthConstruct implements FW24Construct {
    readonly logger = createLogger(AuthConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = AuthConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    mainStack!: Stack;
    
    /**
     * Create a new AuthConstruct.
     * @param authConstructConfig - The configuration object for the Auth construct.
     * @example
     * // Create a new instance of the Auth class
     * const authConfig: IAuthConstructConfig = {
     *   // Provide the necessary configuration options
     *   // ...
     * };
     * const auth = new Auth(authConfig);
     */
    constructor(private authConstructConfig: IAuthConstructConfig) {
        Helper.hydrateConfig(authConstructConfig,'COGNITO');
    }

    // construct method to create the stack
    public async construct() {
        this.logger.debug("construct");

        this.mainStack = this.fw24.getStack("main");

        const userPoolConfig = {...AuthConstructConfigDefaults.userPool?.props, ...this.authConstructConfig.userPool?.props};
        const userPoolName = this.authConstructConfig.userPool?.props?.userPoolName || 'default';
        this.logger.info("Creating user pool: ", userPoolName);
        this.logger.debug("user pool config: ", userPoolName, userPoolConfig);

        if(this.authConstructConfig.useAsDefaultAuthorizer === undefined){
            this.authConstructConfig.useAsDefaultAuthorizer = true;
        }

        // TODO: Add ability to create multi-tenant user pools
        const userPool: UserPool = new UserPool(this.mainStack, `${userPoolName}-userPool`, {
            ...userPoolConfig,
            userPoolName: this.createUniqueUserPoolName(userPoolName),
        });
        // verificationMessageConfiguration
        
        this.fw24.setConstructOutput(this, userPoolName, userPool, OutputType.USERPOOL);

        const userPoolClientConfig: UserPoolClientProps = {
            userPool: userPool,
            ...AuthConstructConfigDefaults.userPoolClient?.props, 
            ...this.authConstructConfig.userPoolClient?.props
        };

        const userPoolClient = new UserPoolClient(this.mainStack, `${userPoolName}-userPoolclient`, {
            ...userPoolClientConfig
        });
        this.fw24.setConstructOutput(this, userPoolName, userPoolClient, OutputType.USERPOOLCLIENT);

        // Identity pool based authentication
        if(this.authConstructConfig.groups || this.authConstructConfig.policyFilePaths || this.fw24.getConfig().defaultAuthorizationType == 'AWS_IAM') {
            this.createIdentityPoolAuthorizer(userPool, userPoolClient, userPoolName, this.authConstructConfig.useAsDefaultAuthorizer);
        } else {
            // user pool base authentication
            this.createUserPoolAuthorizer(userPool, userPoolName, this.authConstructConfig.useAsDefaultAuthorizer);
        }

        this.fw24.setEnvironmentVariable("userPoolID", userPool.userPoolId, userPoolName);
        this.fw24.setEnvironmentVariable("userPoolClientID", userPoolClient.userPoolClientId, userPoolName);

    }

    private createUserPoolAuthorizer(userPool: UserPool, userPoolName: string, useAsDefaultAuthorizer: boolean) {
        // cognito authorizer 
        const userPoolAuthorizer = new CognitoUserPoolsAuthorizer(this.mainStack, `${userPoolName}-Authorizer`, {
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

        const identityPool = new CfnIdentityPool(this.mainStack, `${userPoolName}-identityPool`, {
            allowUnauthenticatedIdentities: true,
            cognitoIdentityProviders: [{
                clientId: userPoolClient.userPoolClientId,
                providerName: userPool.userPoolProviderName,
            }],
        });
        this.fw24.setConstructOutput(this, userPoolName, identityPool, OutputType.IDENTITYPOOL);

        // configure identity pool role attachment
        const identityProvider = userPool.userPoolProviderName + ':' + userPoolClient.userPoolClientId;
        const roleAttachment: any = {
            identityPoolId: identityPool.ref,
        }

        // create user pool groups
        if (this.authConstructConfig.groups) {
            this.fw24.setEnvironmentVariable('Groups', this.authConstructConfig.groups.map(group => group.name), 'cognito');
            //this.fw24.set('AutoUserSignupGroups', this.authConfig.groups.filter(group => group.autoUserSignup).map(group => group.name).toString(), userPoolName);
            for (const group of this.authConstructConfig.groups) {
                // create a role for the group
                const policyFilePaths = group.policyFilePaths;
                const role = new CognitoAuthRole(this.mainStack, `${userPoolName}-${group.name}-CognitoAuthRole`, {
                    identityPool,
                    policyFilePaths,
                }) as Role;

                this.fw24.setEnvironmentVariable('Role', role, `cognito_${group.name}`);
                this.fw24.setEnvironmentVariable('Routes', group.routes, `cognito_${group.name}`);

                new CfnUserPoolGroup(this.mainStack, `${userPoolName}-${group.name}-group`, {
                    groupName: group.name,
                    userPoolId: userPool.userPoolId,
                    roleArn: role.roleArn,
                    precedence: group.precedence || 0,
                });
            }
            const autoUserSignupGroups = this.authConstructConfig.groups.filter(group => group.autoUserSignup).map(group => group.name).toString();
            const autoUserSignupGroupsHandler = this.authConstructConfig.groups.filter(group => group.autoUserSignup).map(group => group.autoUserSignupHandler);
            
            // Note: only one auto signup handler is supported, pick the first one
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
                const lambdaTrigger = new LambdaFunction(this.mainStack, `${userPoolName}-auto-post-confirmation-lambdaFunction`, {
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
        const authenticatedRole = new CognitoAuthRole(this.mainStack, `${userPoolName}-CognitoAuthRole`, {
            identityPool,
            policyFilePaths
        }) as Role;

        // if no groups are defined all policies are added to the default authenticated role
        this.fw24.setEnvironmentVariable('Role', authenticatedRole, `cognito_default`);

        roleAttachment.roles = {};
        roleAttachment.roles.authenticated = authenticatedRole.roleArn;

        new CfnIdentityPoolRoleAttachment(this.mainStack, `${userPoolName}-IdentityPoolRoleAttachment`, roleAttachment);

        // create triggers
        if (this.authConstructConfig.triggers) {
            for (const trigger of this.authConstructConfig.triggers) {
                const lambdaTrigger = new LambdaFunction(this.mainStack, `${userPoolName}-${trigger.trigger}-lambdaFunction`, {
                    ...trigger.functionProps,
                }) as NodejsFunction;
                userPool.addTrigger( this.mapTriggerType(trigger.trigger), lambdaTrigger);
            }
        }
        this.fw24.setEnvironmentVariable("identityPoolID", identityPool.ref, userPoolName);
        if(useAsDefaultAuthorizer !== false){
            this.fw24.getConfig().defaultAuthorizationType = 'AWS_IAM';
            this.logger.info("Default Authorizer set to AWS_IAM");
        }
    }

    private mapTriggerType(triggerType: TriggerType | UserPoolOperation): UserPoolOperation {
        
        if( triggerType instanceof UserPoolOperation){
            return triggerType;
        }
        
        const triggerMapping: { [key in TriggerType]: UserPoolOperation } = {
            CUSTOM_MESSAGE: UserPoolOperation.CUSTOM_MESSAGE,
            PRE_SIGN_UP: UserPoolOperation.PRE_SIGN_UP,
            POST_CONFIRMATION: UserPoolOperation.POST_CONFIRMATION,
            PRE_TOKEN_GENERATION: UserPoolOperation.PRE_TOKEN_GENERATION,
            USER_MIGRATION: UserPoolOperation.USER_MIGRATION,
            DEFINE_AUTH_CHALLENGE: UserPoolOperation.DEFINE_AUTH_CHALLENGE,
            CREATE_AUTH_CHALLENGE: UserPoolOperation.CREATE_AUTH_CHALLENGE,
            POST_AUTHENTICATION: UserPoolOperation.POST_AUTHENTICATION,
            PRE_AUTHENTICATION: UserPoolOperation.PRE_AUTHENTICATION,
            PRE_TOKEN_GENERATION_CONFIG: UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
            VERIFY_AUTH_CHALLENGE_RESPONSE: UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE,
            CUSTOM_EMAIL_SENDER: UserPoolOperation.CUSTOM_EMAIL_SENDER,
            CUSTOM_SMS_SENDER: UserPoolOperation.CUSTOM_SMS_SENDER,
        };

        return triggerMapping[triggerType];
    }

    private createUniqueUserPoolName(userPoolName: string) {
        return `${this.fw24.appName}-${userPoolName}`;
    }
}
