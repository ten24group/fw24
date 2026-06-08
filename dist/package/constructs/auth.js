"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthConstruct = void 0;
const aws_cognito_1 = require("aws-cdk-lib/aws-cognito");
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cognito_auth_role_1 = require("./cognito-auth-role");
const lambda_function_1 = require("./lambda-function");
const fw24_1 = require("../core/fw24");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const core_1 = require("../core");
const utils_1 = require("../utils");
const aws_certificatemanager_1 = require("aws-cdk-lib/aws-certificatemanager");
const vpc_1 = require("./vpc");
const mailer_1 = require("./mailer");
const layer_1 = require("./layer");
const AuthConstructConfigDefaults = {
    userPool: {
        props: {
            selfSignUpEnabled: false,
            userVerification: {
                emailStyle: aws_cognito_1.VerificationEmailStyle.CODE,
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
                tempPasswordValidity: aws_cdk_lib_1.Duration.days(3),
            },
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
        }
    },
    userPoolClient: {
        props: {
            generateSecret: false,
            authFlows: {
                userPassword: true,
            }
        }
    },
    ambiguousRoleResolution: 'Deny'
};
class AuthConstruct {
    authConstructConfig;
    logger = (0, logging_1.createLogger)(AuthConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = AuthConstruct.name;
    dependencies = [vpc_1.VpcConstruct.name, mailer_1.MailerConstruct.name, layer_1.LayerConstruct.name];
    output;
    mainStack;
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
    constructor(authConstructConfig) {
        this.authConstructConfig = authConstructConfig;
        core_1.Helper.hydrateConfig(authConstructConfig, 'COGNITO');
    }
    // construct method to create the stack
    async construct() {
        this.logger.debug("construct");
        this.mainStack = this.fw24.getStack(this.authConstructConfig.stackName, this.authConstructConfig.parentStackName);
        if (this.authConstructConfig.customAuthorizer?.type === 'jwt') {
            await this.createLambdaAuthorizer(this.authConstructConfig.useAsDefaultAuthorizer || false);
            return;
        }
        const userPoolConfig = (0, utils_1.merge)([
            AuthConstructConfigDefaults.userPool?.props ?? {},
            this.authConstructConfig.userPool?.props ?? {}
        ]);
        const userPoolName = this.authConstructConfig.userPool?.props?.userPoolName || 'default';
        this.logger.info("Creating user pool: ", userPoolName);
        this.logger.debug("user pool config: ", userPoolName, userPoolConfig);
        if (this.authConstructConfig.useAsDefaultAuthorizer === undefined) {
            this.authConstructConfig.useAsDefaultAuthorizer = true;
        }
        // TODO: Add ability to create multi-tenant user pools
        const userPool = new aws_cognito_1.UserPool(this.mainStack, `${userPoolName}-userPool`, {
            ...userPoolConfig,
            userPoolName: this.createUniqueUserPoolName(userPoolName),
        });
        // Configure domain if specified or if social providers are enabled
        this.configureDomain(userPool, userPoolName);
        this.fw24.setConstructOutput(this, userPoolName, userPool, construct_1.OutputType.USERPOOL, 'userPoolId');
        const userPoolClientConfig = (0, utils_1.merge)([
            { userPool: userPool },
            AuthConstructConfigDefaults.userPoolClient?.props ?? {},
            this.authConstructConfig.userPoolClient?.props ?? {}
        ]);
        const userPoolClient = new aws_cognito_1.UserPoolClient(this.mainStack, `${userPoolName}-userPoolclient`, userPoolClientConfig);
        // Configure social providers if specified
        this.configureSocialProviders(userPool, userPoolClient, userPoolName);
        this.fw24.setConstructOutput(this, userPoolName, userPoolClient, construct_1.OutputType.USERPOOLCLIENT, 'userPoolClientId');
        // Identity pool based authentication
        if (this.authConstructConfig.groups || this.authConstructConfig.policyFilePaths || this.fw24.getConfig().defaultAuthorizationType == 'AWS_IAM') {
            this.createIdentityPoolAuthorizer(userPool, userPoolClient, userPoolName, this.authConstructConfig.useAsDefaultAuthorizer);
        }
        else {
            // user pool base authentication
            this.createUserPoolAuthorizer(userPool, userPoolName, this.authConstructConfig.useAsDefaultAuthorizer);
        }
    }
    createUserPoolAuthorizer(userPool, userPoolName, useAsDefaultAuthorizer) {
        // cognito authorizer 
        const userPoolAuthorizer = new aws_apigateway_1.CognitoUserPoolsAuthorizer(this.mainStack, `${userPoolName}-Authorizer`, {
            cognitoUserPools: [userPool],
            identitySource: 'method.request.header.Authorization',
        });
        this.fw24.setCognitoAuthorizer(userPoolName, userPoolAuthorizer, 
        // TODO: better logic to control the default authorizer
        useAsDefaultAuthorizer);
        if (useAsDefaultAuthorizer !== false) {
            this.fw24.getConfig().defaultAuthorizationType = 'COGNITO_USER_POOLS';
            this.fw24.setDefaultCognitoAuthorizerName(userPoolName);
            this.logger.info("Default Authorizer set to COGNITO_USER_POOLS");
        }
    }
    createIdentityPoolAuthorizer(userPool, userPoolClient, userPoolName, useAsDefaultAuthorizer) {
        const identityPool = new aws_cognito_1.CfnIdentityPool(this.mainStack, `${userPoolName}-identityPool`, {
            allowUnauthenticatedIdentities: true,
            cognitoIdentityProviders: [{
                    clientId: userPoolClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                }],
        });
        this.fw24.setConstructOutput(this, userPoolName, identityPool, construct_1.OutputType.IDENTITYPOOL, 'ref', 'identityPoolId');
        // configure identity pool role attachment
        const identityProvider = userPool.userPoolProviderName + ':' + userPoolClient.userPoolClientId;
        const roleAttachment = {
            identityPoolId: identityPool.ref,
        };
        // create user pool groups
        if (this.authConstructConfig.groups) {
            const groupNames = this.authConstructConfig.groups.map(group => group.name);
            this.fw24.setEnvironmentVariable('Groups', groupNames, 'cognito');
            this.fw24.setEnvironmentVariable('authGroups', groupNames.join(','), `userpool_${userPoolName}`);
            //this.fw24.set('AutoUserSignupGroups', this.authConfig.groups.filter(group => group.autoUserSignup).map(group => group.name).toString(), userPoolName);
            for (const group of this.authConstructConfig.groups) {
                // create a role for the group (use getRole() so policy collector is keyed by the IAM Role)
                const policyFilePaths = group.policyFilePaths;
                const cognitoAuthRole = new cognito_auth_role_1.CognitoAuthRole(this.mainStack, `${userPoolName}-${group.name}-CognitoAuthRole`, {
                    identityPool: identityPool,
                    policyFilePaths: policyFilePaths,
                    policies: group.policies,
                });
                const role = cognitoAuthRole.getRole();
                this.fw24.setEnvironmentVariable('Role', role, `cognito_${group.name}`);
                this.fw24.setEnvironmentVariable('Routes', group.routes, `cognito_${group.name}`);
                new aws_cognito_1.CfnUserPoolGroup(this.mainStack, `${userPoolName}-${group.name}-group`, {
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
            if (autoUserSignupGroups && autoGroupsAddHandler) {
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
                };
                const lambdaFunctionProps = (0, utils_1.merge)([
                    autoGroupsAddHandler,
                    props
                ]);
                this.logger.debug("autoUserSignupGroupsHandler: ", lambdaFunctionProps);
                const lambdaTrigger = new lambda_function_1.LambdaFunction(this.mainStack, `${userPoolName}-auto-post-confirmation-lambdaFunction`, {
                    ...lambdaFunctionProps,
                });
                userPool.addTrigger(aws_cognito_1.UserPoolOperation.POST_CONFIRMATION, lambdaTrigger);
            }
            // configure role mapping
            roleAttachment.roleMappings = {
                "userpool": {
                    type: "Token",
                    ambiguousRoleResolution: this.authConstructConfig.ambiguousRoleResolution || 'Deny',
                    identityProvider: identityProvider,
                }
            };
        }
        // IAM role for authenticated users if no groups are defined
        const policyFilePaths = this.authConstructConfig.policyFilePaths;
        const authenticatedCognitoRole = new cognito_auth_role_1.CognitoAuthRole(this.mainStack, `${userPoolName}-CognitoAuthRole`, {
            identityPool: identityPool,
            policyFilePaths: policyFilePaths,
            policies: this.authConstructConfig.policies,
        });
        const authenticatedRole = authenticatedCognitoRole.getRole();
        // if no groups are defined all policies are added to the default authenticated role
        this.fw24.setEnvironmentVariable('Role', authenticatedRole, `cognito_default`);
        roleAttachment.roles = {};
        roleAttachment.roles.authenticated = authenticatedRole.roleArn;
        new aws_cognito_1.CfnIdentityPoolRoleAttachment(this.mainStack, `${userPoolName}-IdentityPoolRoleAttachment`, roleAttachment);
        // create triggers
        if (this.authConstructConfig.triggers) {
            for (const trigger of this.authConstructConfig.triggers) {
                const lambdaTrigger = new lambda_function_1.LambdaFunction(this.mainStack, `${userPoolName}-${trigger.trigger}-lambdaFunction`, {
                    ...trigger.functionProps,
                });
                userPool.addTrigger(this.mapTriggerType(trigger.trigger), lambdaTrigger);
            }
        }
        if (useAsDefaultAuthorizer !== false) {
            this.fw24.getConfig().defaultAuthorizationType = 'AWS_IAM';
            this.logger.info("Default Authorizer set to AWS_IAM");
        }
    }
    mapTriggerType(triggerType) {
        if (triggerType instanceof aws_cognito_1.UserPoolOperation) {
            return triggerType;
        }
        const triggerMapping = {
            CUSTOM_MESSAGE: aws_cognito_1.UserPoolOperation.CUSTOM_MESSAGE,
            PRE_SIGN_UP: aws_cognito_1.UserPoolOperation.PRE_SIGN_UP,
            POST_CONFIRMATION: aws_cognito_1.UserPoolOperation.POST_CONFIRMATION,
            PRE_TOKEN_GENERATION: aws_cognito_1.UserPoolOperation.PRE_TOKEN_GENERATION,
            USER_MIGRATION: aws_cognito_1.UserPoolOperation.USER_MIGRATION,
            DEFINE_AUTH_CHALLENGE: aws_cognito_1.UserPoolOperation.DEFINE_AUTH_CHALLENGE,
            CREATE_AUTH_CHALLENGE: aws_cognito_1.UserPoolOperation.CREATE_AUTH_CHALLENGE,
            POST_AUTHENTICATION: aws_cognito_1.UserPoolOperation.POST_AUTHENTICATION,
            PRE_AUTHENTICATION: aws_cognito_1.UserPoolOperation.PRE_AUTHENTICATION,
            PRE_TOKEN_GENERATION_CONFIG: aws_cognito_1.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
            VERIFY_AUTH_CHALLENGE_RESPONSE: aws_cognito_1.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE,
            CUSTOM_EMAIL_SENDER: aws_cognito_1.UserPoolOperation.CUSTOM_EMAIL_SENDER,
            CUSTOM_SMS_SENDER: aws_cognito_1.UserPoolOperation.CUSTOM_SMS_SENDER,
        };
        return triggerMapping[triggerType];
    }
    createUniqueUserPoolName(userPoolName) {
        return `${this.fw24.appName}-${userPoolName}`;
    }
    configureSocialProviders(userPool, userPoolClient, userPoolName) {
        if (!this.authConstructConfig.userPool?.socialProviders) {
            return;
        }
        let supportedIdentityProviders = '';
        // Configure Google provider if specified
        if (this.authConstructConfig.userPool?.socialProviders?.google) {
            const { clientId, clientSecret, scopes, attributeMapping } = this.authConstructConfig.userPool.socialProviders.google;
            const googleProvider = new aws_cognito_1.UserPoolIdentityProviderGoogle(this.mainStack, 'GoogleProvider', {
                userPool: userPool,
                clientId: clientId,
                clientSecret: clientSecret,
                scopes: scopes || ['email', 'profile', 'openid'],
                attributeMapping: attributeMapping || {
                    email: aws_cognito_1.ProviderAttribute.GOOGLE_EMAIL,
                    emailVerified: aws_cognito_1.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
                }
            });
            userPoolClient.node.addDependency(googleProvider);
            supportedIdentityProviders += 'Google,';
        }
        // Configure Facebook provider if specified
        if (this.authConstructConfig.userPool?.socialProviders?.facebook) {
            const { clientId, clientSecret, scopes, attributeMapping } = this.authConstructConfig.userPool.socialProviders.facebook;
            const facebookProvider = new aws_cognito_1.UserPoolIdentityProviderFacebook(this.mainStack, 'FacebookProvider', {
                userPool,
                clientId,
                clientSecret,
                scopes: scopes || ['email', 'public_profile'],
                attributeMapping: attributeMapping || {
                    email: aws_cognito_1.ProviderAttribute.FACEBOOK_EMAIL,
                }
            });
            userPoolClient.node.addDependency(facebookProvider);
            supportedIdentityProviders += 'Facebook,';
        }
        this.fw24.setEnvironmentVariable('supportedIdentityProviders', supportedIdentityProviders, `userpool_${userPoolName}`);
    }
    configureDomain(userPool, userPoolName) {
        // Skip domain configuration if not needed
        if (!this.authConstructConfig.userPool?.domain && !this.authConstructConfig.userPool?.socialProviders) {
            return;
        }
        const domainConfig = this.authConstructConfig.userPool?.domain;
        let domain;
        let domainUrl;
        if (domainConfig?.customDomain && domainConfig.customDomain.domainName.length > 0) {
            // Configure custom domain
            const { domainName, certificateArn } = domainConfig.customDomain;
            domain = new aws_cognito_1.UserPoolDomain(this.mainStack, `${userPoolName}-domain`, {
                userPool,
                customDomain: {
                    domainName,
                    certificate: aws_certificatemanager_1.Certificate.fromCertificateArn(this.mainStack, `${userPoolName}-cert`, certificateArn),
                },
            });
            domainUrl = domainName;
        }
        else {
            // Use Cognito domain
            const domainPrefix = domainConfig?.cognitoDomainPrefix ||
                `${this.fw24.appName}-${userPoolName}-${this.fw24.getConfig().account}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
            domain = new aws_cognito_1.UserPoolDomain(this.mainStack, `${userPoolName}-domain`, {
                userPool,
                cognitoDomain: {
                    domainPrefix,
                },
            });
            domainUrl = `${domainPrefix}.auth.${this.fw24.getConfig().region}.amazoncognito.com`;
        }
        // Set the domain URL as a environment variable
        this.fw24.setEnvironmentVariable('authDomain', domainUrl, `userpool_${userPoolName}`);
    }
    async createLambdaAuthorizer(useAsDefaultAuthorizer) {
        if (!this.authConstructConfig.customAuthorizer) {
            return;
        }
        const authorizerFunction = new lambda_function_1.LambdaFunction(this.mainStack, `${this.authConstructConfig.customAuthorizer.type}-CustomAuthorizer`, {
            ...this.authConstructConfig.customAuthorizer.functionProps,
        });
        const authorizer = new aws_apigateway_1.TokenAuthorizer(this.mainStack, `${this.authConstructConfig.customAuthorizer.type}-TokenAuthorizer`, {
            handler: authorizerFunction,
            identitySource: 'method.request.header.Authorization',
        });
        this.fw24.setJwtAuthorizer(authorizer, useAsDefaultAuthorizer);
        this.fw24.setConstructOutput(this, this.authConstructConfig.customAuthorizer.type, authorizer, construct_1.OutputType.AUTHORIZER);
    }
}
exports.AuthConstruct = AuthConstruct;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2F1dGgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEseURBZWlDO0FBRWpDLCtEQUF5RjtBQUV6Riw2Q0FBNkQ7QUFDN0QsMkRBQXNEO0FBQ3RELHVEQUF3RTtBQUN4RSx1Q0FBb0M7QUFDcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQUN2RCxrQ0FBaUM7QUFFakMsb0NBQWlDO0FBQ2pDLCtFQUFpRTtBQUNqRSwrQkFBcUM7QUFDckMscUNBQTJDO0FBQzNDLG1DQUF5QztBQTRMekMsTUFBTSwyQkFBMkIsR0FBeUI7SUFDdEQsUUFBUSxFQUFFO1FBQ04sS0FBSyxFQUFFO1lBQ0gsaUJBQWlCLEVBQUUsS0FBSztZQUN4QixnQkFBZ0IsRUFBRTtnQkFDZCxVQUFVLEVBQUUsb0NBQXNCLENBQUMsSUFBSTthQUMxQztZQUNELFVBQVUsRUFBRTtnQkFDUixLQUFLLEVBQUUsSUFBSTthQUNkO1lBQ0QsYUFBYSxFQUFFO2dCQUNYLEtBQUssRUFBRSxJQUFJO2FBQ2Q7WUFDRCxjQUFjLEVBQUU7Z0JBQ1osU0FBUyxFQUFFLENBQUM7Z0JBQ1osZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixvQkFBb0IsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7YUFDekM7WUFDRCxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxNQUFNO1NBQ3RDO0tBQ0o7SUFDRCxjQUFjLEVBQUU7UUFDWixLQUFLLEVBQUU7WUFDSCxjQUFjLEVBQUUsS0FBSztZQUNyQixTQUFTLEVBQUU7Z0JBQ1AsWUFBWSxFQUFFLElBQUk7YUFDckI7U0FDSjtLQUNKO0lBQ0QsdUJBQXVCLEVBQUUsTUFBTTtDQUNsQyxDQUFBO0FBRUQsTUFBYSxhQUFhO0lBcUJGO0lB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RCxDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFVBQVUsRUFBRSxzQkFBc0IsQ0FBQyxDQUFDO1FBRS9ELElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLHNCQUFVLENBQUMsVUFBVSxDQUFDLENBQUM7SUFFMUgsQ0FBQztDQUNKO0FBaldELHNDQWlXQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gICAgQ2ZuSWRlbnRpdHlQb29sLFxuICAgIENmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50LFxuICAgIENmblVzZXJQb29sR3JvdXAsXG4gICAgVXNlclBvb2wsXG4gICAgVXNlclBvb2xDbGllbnQsXG4gICAgVXNlclBvb2xQcm9wcyxcbiAgICBVc2VyUG9vbE9wZXJhdGlvbixcbiAgICBWZXJpZmljYXRpb25FbWFpbFN0eWxlLFxuICAgIFVzZXJQb29sQ2xpZW50UHJvcHMsXG4gICAgVXNlclBvb2xDbGllbnRPcHRpb25zLFxuICAgIFVzZXJQb29sSWRlbnRpdHlQcm92aWRlckdvb2dsZSxcbiAgICBVc2VyUG9vbElkZW50aXR5UHJvdmlkZXJGYWNlYm9vayxcbiAgICBVc2VyUG9vbERvbWFpbixcbiAgICBQcm92aWRlckF0dHJpYnV0ZSxcbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jb2duaXRvXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIsIFRva2VuQXV0aG9yaXplciB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuaW1wb3J0IHsgUG9saWN5U3RhdGVtZW50LCBQb2xpY3lTdGF0ZW1lbnRQcm9wcywgUm9sZSwgVXNlciB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvZ25pdG9BdXRoUm9sZSB9IGZyb20gXCIuL2NvZ25pdG8tYXV0aC1yb2xlXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiwgTGFtYmRhRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciwgTG9nRHVyYXRpb24gfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmVcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgQ2VydGlmaWNhdGUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlclwiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcblxuaW50ZXJmYWNlIElSb2xlQXR0YWNobWVudENvbmZpZyB7XG4gICAgaWRlbnRpdHlQb29sSWQ6IHN0cmluZztcbiAgICByb2xlcz86IHtcbiAgICAgICAgYXV0aGVudGljYXRlZD86IHN0cmluZztcbiAgICAgICAgdW5hdXRoZW50aWNhdGVkPzogc3RyaW5nO1xuICAgIH07XG4gICAgcm9sZU1hcHBpbmdzPzoge1xuICAgICAgICBbIGtleTogc3RyaW5nIF06IHtcbiAgICAgICAgICAgIHR5cGU6IHN0cmluZztcbiAgICAgICAgICAgIGFtYmlndW91c1JvbGVSZXNvbHV0aW9uOiBzdHJpbmc7XG4gICAgICAgICAgICBpZGVudGl0eVByb3ZpZGVyOiBzdHJpbmc7XG4gICAgICAgIH07XG4gICAgfTtcbn1cblxuZXhwb3J0IHR5cGUgVHJpZ2dlclR5cGUgPVxuICAgIHwgJ0NVU1RPTV9NRVNTQUdFJ1xuICAgIHwgJ1BSRV9TSUdOX1VQJ1xuICAgIHwgJ1BPU1RfQ09ORklSTUFUSU9OJ1xuICAgIHwgJ1BSRV9UT0tFTl9HRU5FUkFUSU9OJ1xuICAgIHwgJ1VTRVJfTUlHUkFUSU9OJ1xuICAgIHwgJ0RFRklORV9BVVRIX0NIQUxMRU5HRSdcbiAgICB8ICdDUkVBVEVfQVVUSF9DSEFMTEVOR0UnXG4gICAgfCAnUE9TVF9BVVRIRU5USUNBVElPTidcbiAgICB8ICdQUkVfQVVUSEVOVElDQVRJT04nXG4gICAgfCAnUFJFX1RPS0VOX0dFTkVSQVRJT05fQ09ORklHJ1xuICAgIHwgJ1ZFUklGWV9BVVRIX0NIQUxMRU5HRV9SRVNQT05TRSdcbiAgICB8ICdDVVNUT01fRU1BSUxfU0VOREVSJ1xuICAgIHwgJ0NVU1RPTV9TTVNfU0VOREVSJztcblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGludGVyZmFjZSBmb3Igc29jaWFsIGlkZW50aXR5IHByb3ZpZGVycy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJU29jaWFsUHJvdmlkZXJDb25maWcge1xuICAgIC8qKlxuICAgICAqIE9BdXRoIGNsaWVudCBJRCBmb3IgdGhlIHNvY2lhbCBwcm92aWRlclxuICAgICAqL1xuICAgIGNsaWVudElkOiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogT0F1dGggY2xpZW50IHNlY3JldCBmb3IgdGhlIHNvY2lhbCBwcm92aWRlclxuICAgICAqL1xuICAgIGNsaWVudFNlY3JldDogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIE9BdXRoIHNjb3BlcyB0byByZXF1ZXN0XG4gICAgICovXG4gICAgc2NvcGVzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXR0cmlidXRlIG1hcHBpbmcgZnJvbSBwcm92aWRlciB0byBDb2duaXRvXG4gICAgICovXG4gICAgYXR0cmlidXRlTWFwcGluZz86IHtcbiAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmc7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgQ29nbml0byBkb21haW5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRG9tYWluQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZG9tYWluIHByZWZpeCBmb3IgQ29nbml0byBob3N0ZWQgVUkuXG4gICAgICogSWYgdXNpbmcgYSBjdXN0b20gZG9tYWluLCB0aGlzIGlzIGlnbm9yZWQuXG4gICAgICovXG4gICAgY29nbml0b0RvbWFpblByZWZpeD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBDb25maWd1cmF0aW9uIGZvciBhIGN1c3RvbSBkb21haW5cbiAgICAgKi9cbiAgICBjdXN0b21Eb21haW4/OiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgZG9tYWluIG5hbWUgdG8gdXNlIChlLmcuICdhdXRoLmV4YW1wbGUuY29tJylcbiAgICAgICAgICovXG4gICAgICAgIGRvbWFpbk5hbWU6IHN0cmluZztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBBUk4gb2YgYW4gZXhpc3RpbmcgQUNNIGNlcnRpZmljYXRlIGZvciB0aGUgZG9tYWluXG4gICAgICAgICAqL1xuICAgICAgICBjZXJ0aWZpY2F0ZUFybjogc3RyaW5nO1xuICAgIH07XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBpbnRlcmZhY2UgZm9yIHRoZSBBdXRoQ29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElBdXRoQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIFVzZXIgUG9vbC5cbiAgICAgKi9cbiAgICB1c2VyUG9vbD86IHtcbiAgICAgICAgcHJvcHM6IFVzZXJQb29sUHJvcHM7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBEb21haW4gY29uZmlndXJhdGlvbiBmb3IgdGhlIHVzZXIgcG9vbC5cbiAgICAgICAgICogUmVxdWlyZWQgZm9yIHNvY2lhbCBzaWduLWluIGFuZCBob3N0ZWQgVUkgZmVhdHVyZXMuXG4gICAgICAgICAqL1xuICAgICAgICBkb21haW4/OiBJRG9tYWluQ29uZmlnO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3Igc29jaWFsIGlkZW50aXR5IHByb3ZpZGVycy5cbiAgICAgICAgICogV2hlbiBjb25maWd1cmVkLCBPQXV0aCBmbG93cyBhcmUgYXV0b21hdGljYWxseSBlbmFibGVkIHdpdGggYXBwcm9wcmlhdGUgc2V0dGluZ3MuXG4gICAgICAgICAqL1xuICAgICAgICBzb2NpYWxQcm92aWRlcnM/OiB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEdvb2dsZSBpZGVudGl0eSBwcm92aWRlciBjb25maWd1cmF0aW9uXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGdvb2dsZT86IElTb2NpYWxQcm92aWRlckNvbmZpZztcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogRmFjZWJvb2sgaWRlbnRpdHkgcHJvdmlkZXIgY29uZmlndXJhdGlvblxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBmYWNlYm9vaz86IElTb2NpYWxQcm92aWRlckNvbmZpZztcbiAgICAgICAgfTtcbiAgICB9O1xuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBVc2VyIFBvb2wgQ2xpZW50LlxuICAgICAqL1xuICAgIHVzZXJQb29sQ2xpZW50Pzoge1xuICAgICAgICBwcm9wczogVXNlclBvb2xDbGllbnRPcHRpb25zO1xuICAgIH07XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgcG9saWNpZXMgdG8gYXR0YWNoIHRvIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZS5cbiAgICAgKi9cbiAgICBwb2xpY2llcz86IEFycmF5PFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PjtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBmaWxlIHBhdGhzIGZvciBwb2xpY3kgZmlsZXMuXG4gICAgICovXG4gICAgcG9saWN5RmlsZVBhdGhzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgdHJpZ2dlcnMgZm9yIHVzZXIgcG9vbCBvcGVyYXRpb25zLlxuICAgICAqL1xuICAgIHRyaWdnZXJzPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHVzZXIgcG9vbCBvcGVyYXRpb24gdGhhdCB0cmlnZ2VycyB0aGUgZnVuY3Rpb24uXG4gICAgICAgICAqL1xuICAgICAgICB0cmlnZ2VyOiBVc2VyUG9vbE9wZXJhdGlvbiB8IFRyaWdnZXJUeXBlO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHM7XG4gICAgfVtdO1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGdyb3VwcyBmb3IgdGhlIEF1dGhDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgZ3JvdXBzPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIG5hbWUgb2YgdGhlIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHByZWNlZGVuY2Ugb2YgdGhlIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgcHJlY2VkZW5jZT86IG51bWJlcjtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIHBvbGljaWVzIHRvIGF0dGFjaCB0byB0aGUgZ3JvdXAuXG4gICAgICAgICAqL1xuICAgICAgICBwb2xpY2llcz86IEFycmF5PFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PjtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIGZpbGUgcGF0aHMgZm9yIHBvbGljeSBmaWxlcyBzcGVjaWZpYyB0byB0aGlzIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgcG9saWN5RmlsZVBhdGhzPzogc3RyaW5nW107XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBGbGFnIGluZGljYXRpbmcgd2hldGhlciB0aGUgdXNlciBzaG91bGQgYmUgYXV0b21hdGljYWxseSBzaWduZWQgdXAgdG8gdGhpcyBncm91cCBkdXJpbmcgc2lnbnVwLlxuICAgICAgICAgKi9cbiAgICAgICAgYXV0b1VzZXJTaWdudXA/OiBib29sZWFuO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbiB0aGF0IGhhbmRsZXMgYXV0b21hdGljIHVzZXIgc2lnbnVwLlxuICAgICAgICAgKi9cbiAgICAgICAgYXV0b1VzZXJTaWdudXBIYW5kbGVyPzogTGFtYmRhRnVuY3Rpb25Qcm9wcztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIHJvdXRlcyBwcm90ZWN0ZWQgYnkgdGhpcyBncm91cC5cbiAgICAgICAgICovXG4gICAgICAgIHJvdXRlcz86IHN0cmluZ1tdO1xuICAgIH1bXTtcbiAgICAvKipcbiAgICAgKiBGbGFnIGluZGljYXRpbmcgd2hldGhlciB0byB1c2UgdGhpcyBBdXRoQ29uc3RydWN0IGFzIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXIuXG4gICAgICovXG4gICAgdXNlQXNEZWZhdWx0QXV0aG9yaXplcj86IGJvb2xlYW47XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhdGlvbiBmb3IgYSBjdXN0b20gTGFtYmRhIGF1dGhvcml6ZXIuXG4gICAgICovXG4gICAgY3VzdG9tQXV0aG9yaXplcj86IHtcbiAgICAgICAgdHlwZTogc3RyaW5nO1xuICAgICAgICBmdW5jdGlvblByb3BzOiBMYW1iZGFGdW5jdGlvblByb3BzO1xuICAgIH07XG4gICAgLyoqXG4gICAgICogSG93IHRvIHJlc29sdmUgYW1iaWd1b3VzIHJvbGUgYXNzaWdubWVudHMuXG4gICAgICogRGVmYXVsdHMgdG8gXCJVc2VEZWZhdWx0Um9sZVwiIHdoaWNoIHdpbGwgdXNlIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZSB3aGVuIHRoZXJlJ3MgYW1iaWd1aXR5LlxuICAgICAqIENhbiBiZSBzZXQgdG8gXCJEZW55XCIgdG8gZGVueSBhY2Nlc3Mgd2hlbiB0aGVyZSdzIGFtYmlndWl0eS5cbiAgICAgKi9cbiAgICBhbWJpZ3VvdXNSb2xlUmVzb2x1dGlvbj86ICdVc2VEZWZhdWx0Um9sZScgfCAnRGVueSc7XG59XG5cbmNvbnN0IEF1dGhDb25zdHJ1Y3RDb25maWdEZWZhdWx0czogSUF1dGhDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgdXNlclBvb2w6IHtcbiAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHNlbGZTaWduVXBFbmFibGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHVzZXJWZXJpZmljYXRpb246IHtcbiAgICAgICAgICAgICAgICBlbWFpbFN0eWxlOiBWZXJpZmljYXRpb25FbWFpbFN0eWxlLkNPREUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYXV0b1ZlcmlmeToge1xuICAgICAgICAgICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICAgICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICAgICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgICAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcbiAgICAgICAgICAgICAgICB0ZW1wUGFzc3dvcmRWYWxpZGl0eTogRHVyYXRpb24uZGF5cygzKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgfVxuICAgIH0sXG4gICAgdXNlclBvb2xDbGllbnQ6IHtcbiAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgICAgICAgIGF1dGhGbG93czoge1xuICAgICAgICAgICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgYW1iaWd1b3VzUm9sZVJlc29sdXRpb246ICdEZW55J1xufVxuXG5leHBvcnQgY2xhc3MgQXV0aENvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihBdXRoQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBBdXRoQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIE1haWxlckNvbnN0cnVjdC5uYW1lLCBMYXllckNvbnN0cnVjdC5uYW1lIF07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlIGEgbmV3IEF1dGhDb25zdHJ1Y3QuXG4gICAgICogQHBhcmFtIGF1dGhDb25zdHJ1Y3RDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBvYmplY3QgZm9yIHRoZSBBdXRoIGNvbnN0cnVjdC5cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIENyZWF0ZSBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgQXV0aCBjbGFzc1xuICAgICAqIGNvbnN0IGF1dGhDb25maWc6IElBdXRoQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAqICAgLy8gUHJvdmlkZSB0aGUgbmVjZXNzYXJ5IGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICAgICAqICAgLy8gLi4uXG4gICAgICogfTtcbiAgICAgKiBjb25zdCBhdXRoID0gbmV3IEF1dGgoYXV0aENvbmZpZyk7XG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBhdXRoQ29uc3RydWN0Q29uZmlnOiBJQXV0aENvbnN0cnVjdENvbmZpZykge1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhhdXRoQ29uc3RydWN0Q29uZmlnLCAnQ09HTklUTycpO1xuICAgIH1cblxuICAgIC8vIGNvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFja1xuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiY29uc3RydWN0XCIpO1xuXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplcj8udHlwZSA9PT0gJ2p3dCcpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlTGFtYmRhQXV0aG9yaXplcih0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlQXNEZWZhdWx0QXV0aG9yaXplciB8fCBmYWxzZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1c2VyUG9vbENvbmZpZyA9IG1lcmdlKFtcbiAgICAgICAgICAgIEF1dGhDb25zdHJ1Y3RDb25maWdEZWZhdWx0cy51c2VyUG9vbD8ucHJvcHMgPz8ge30sXG4gICAgICAgICAgICB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnByb3BzID8/IHt9XG4gICAgICAgIF0pITtcbiAgICAgICAgY29uc3QgdXNlclBvb2xOYW1lID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5wcm9wcz8udXNlclBvb2xOYW1lIHx8ICdkZWZhdWx0JztcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkNyZWF0aW5nIHVzZXIgcG9vbDogXCIsIHVzZXJQb29sTmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwidXNlciBwb29sIGNvbmZpZzogXCIsIHVzZXJQb29sTmFtZSwgdXNlclBvb2xDb25maWcpO1xuXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlQXNEZWZhdWx0QXV0aG9yaXplciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlQXNEZWZhdWx0QXV0aG9yaXplciA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUT0RPOiBBZGQgYWJpbGl0eSB0byBjcmVhdGUgbXVsdGktdGVuYW50IHVzZXIgcG9vbHNcbiAgICAgICAgY29uc3QgdXNlclBvb2w6IFVzZXJQb29sID0gbmV3IFVzZXJQb29sKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LXVzZXJQb29sYCwge1xuICAgICAgICAgICAgLi4uKHVzZXJQb29sQ29uZmlnIGFzIFVzZXJQb29sUHJvcHMpLFxuICAgICAgICAgICAgdXNlclBvb2xOYW1lOiB0aGlzLmNyZWF0ZVVuaXF1ZVVzZXJQb29sTmFtZSh1c2VyUG9vbE5hbWUpLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDb25maWd1cmUgZG9tYWluIGlmIHNwZWNpZmllZCBvciBpZiBzb2NpYWwgcHJvdmlkZXJzIGFyZSBlbmFibGVkXG4gICAgICAgIHRoaXMuY29uZmlndXJlRG9tYWluKHVzZXJQb29sLCB1c2VyUG9vbE5hbWUpO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdXNlclBvb2xOYW1lLCB1c2VyUG9vbCwgT3V0cHV0VHlwZS5VU0VSUE9PTCwgJ3VzZXJQb29sSWQnKTtcblxuICAgICAgICBjb25zdCB1c2VyUG9vbENsaWVudENvbmZpZzogVXNlclBvb2xDbGllbnRQcm9wcyA9IG1lcmdlKFtcbiAgICAgICAgICAgIHsgdXNlclBvb2w6IHVzZXJQb29sIH0sXG4gICAgICAgICAgICBBdXRoQ29uc3RydWN0Q29uZmlnRGVmYXVsdHMudXNlclBvb2xDbGllbnQ/LnByb3BzID8/IHt9LFxuICAgICAgICAgICAgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sQ2xpZW50Py5wcm9wcyA/PyB7fVxuICAgICAgICBdKSE7XG5cbiAgICAgICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgVXNlclBvb2xDbGllbnQodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tdXNlclBvb2xjbGllbnRgLCB1c2VyUG9vbENsaWVudENvbmZpZyk7XG5cbiAgICAgICAgLy8gQ29uZmlndXJlIHNvY2lhbCBwcm92aWRlcnMgaWYgc3BlY2lmaWVkXG4gICAgICAgIHRoaXMuY29uZmlndXJlU29jaWFsUHJvdmlkZXJzKHVzZXJQb29sLCB1c2VyUG9vbENsaWVudCwgdXNlclBvb2xOYW1lKTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHVzZXJQb29sTmFtZSwgdXNlclBvb2xDbGllbnQsIE91dHB1dFR5cGUuVVNFUlBPT0xDTElFTlQsICd1c2VyUG9vbENsaWVudElkJyk7XG5cbiAgICAgICAgLy8gSWRlbnRpdHkgcG9vbCBiYXNlZCBhdXRoZW50aWNhdGlvblxuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3VwcyB8fCB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcucG9saWN5RmlsZVBhdGhzIHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUgPT0gJ0FXU19JQU0nKSB7XG4gICAgICAgICAgICB0aGlzLmNyZWF0ZUlkZW50aXR5UG9vbEF1dGhvcml6ZXIodXNlclBvb2wsIHVzZXJQb29sQ2xpZW50LCB1c2VyUG9vbE5hbWUsIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHVzZXIgcG9vbCBiYXNlIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgICAgICB0aGlzLmNyZWF0ZVVzZXJQb29sQXV0aG9yaXplcih1c2VyUG9vbCwgdXNlclBvb2xOYW1lLCB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlQXNEZWZhdWx0QXV0aG9yaXplcik7XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlVXNlclBvb2xBdXRob3JpemVyKHVzZXJQb29sOiBVc2VyUG9vbCwgdXNlclBvb2xOYW1lOiBzdHJpbmcsIHVzZUFzRGVmYXVsdEF1dGhvcml6ZXI6IGJvb2xlYW4pIHtcbiAgICAgICAgLy8gY29nbml0byBhdXRob3JpemVyIFxuICAgICAgICBjb25zdCB1c2VyUG9vbEF1dGhvcml6ZXIgPSBuZXcgQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tQXV0aG9yaXplcmAsIHtcbiAgICAgICAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFsgdXNlclBvb2wgXSxcbiAgICAgICAgICAgIGlkZW50aXR5U291cmNlOiAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLkF1dGhvcml6YXRpb24nLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29nbml0b0F1dGhvcml6ZXIoXG4gICAgICAgICAgICB1c2VyUG9vbE5hbWUsXG4gICAgICAgICAgICB1c2VyUG9vbEF1dGhvcml6ZXIsXG4gICAgICAgICAgICAvLyBUT0RPOiBiZXR0ZXIgbG9naWMgdG8gY29udHJvbCB0aGUgZGVmYXVsdCBhdXRob3JpemVyXG4gICAgICAgICAgICB1c2VBc0RlZmF1bHRBdXRob3JpemVyXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKHVzZUFzRGVmYXVsdEF1dGhvcml6ZXIgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlID0gJ0NPR05JVE9fVVNFUl9QT09MUyc7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZSh1c2VyUG9vbE5hbWUpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkRlZmF1bHQgQXV0aG9yaXplciBzZXQgdG8gQ09HTklUT19VU0VSX1BPT0xTXCIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVJZGVudGl0eVBvb2xBdXRob3JpemVyKHVzZXJQb29sOiBVc2VyUG9vbCwgdXNlclBvb2xDbGllbnQ6IFVzZXJQb29sQ2xpZW50LCB1c2VyUG9vbE5hbWU6IHN0cmluZywgdXNlQXNEZWZhdWx0QXV0aG9yaXplcjogYm9vbGVhbikge1xuXG4gICAgICAgIGNvbnN0IGlkZW50aXR5UG9vbCA9IG5ldyBDZm5JZGVudGl0eVBvb2wodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0taWRlbnRpdHlQb29sYCwge1xuICAgICAgICAgICAgYWxsb3dVbmF1dGhlbnRpY2F0ZWRJZGVudGl0aWVzOiB0cnVlLFxuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5UHJvdmlkZXJzOiBbIHtcbiAgICAgICAgICAgICAgICBjbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgICAgICAgICBwcm92aWRlck5hbWU6IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lLFxuICAgICAgICAgICAgfSBdLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCB1c2VyUG9vbE5hbWUsIGlkZW50aXR5UG9vbCwgT3V0cHV0VHlwZS5JREVOVElUWVBPT0wsICdyZWYnLCAnaWRlbnRpdHlQb29sSWQnKTtcblxuICAgICAgICAvLyBjb25maWd1cmUgaWRlbnRpdHkgcG9vbCByb2xlIGF0dGFjaG1lbnRcbiAgICAgICAgY29uc3QgaWRlbnRpdHlQcm92aWRlciA9IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lICsgJzonICsgdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZDtcbiAgICAgICAgY29uc3Qgcm9sZUF0dGFjaG1lbnQ6IElSb2xlQXR0YWNobWVudENvbmZpZyA9IHtcbiAgICAgICAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgICB9XG5cbiAgICAgICAgLy8gY3JlYXRlIHVzZXIgcG9vbCBncm91cHNcbiAgICAgICAgaWYgKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5ncm91cHMpIHtcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwTmFtZXMgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzLm1hcChncm91cCA9PiBncm91cC5uYW1lKTtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdHcm91cHMnLCBncm91cE5hbWVzLCAnY29nbml0bycpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ2F1dGhHcm91cHMnLCBncm91cE5hbWVzLmpvaW4oJywnKSwgYHVzZXJwb29sXyR7dXNlclBvb2xOYW1lfWApO1xuICAgICAgICAgICAgLy90aGlzLmZ3MjQuc2V0KCdBdXRvVXNlclNpZ251cEdyb3VwcycsIHRoaXMuYXV0aENvbmZpZy5ncm91cHMuZmlsdGVyKGdyb3VwID0+IGdyb3VwLmF1dG9Vc2VyU2lnbnVwKS5tYXAoZ3JvdXAgPT4gZ3JvdXAubmFtZSkudG9TdHJpbmcoKSwgdXNlclBvb2xOYW1lKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcykge1xuICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBhIHJvbGUgZm9yIHRoZSBncm91cCAodXNlIGdldFJvbGUoKSBzbyBwb2xpY3kgY29sbGVjdG9yIGlzIGtleWVkIGJ5IHRoZSBJQU0gUm9sZSlcbiAgICAgICAgICAgICAgICBjb25zdCBwb2xpY3lGaWxlUGF0aHMgPSBncm91cC5wb2xpY3lGaWxlUGF0aHM7XG4gICAgICAgICAgICAgICAgY29uc3QgY29nbml0b0F1dGhSb2xlID0gbmV3IENvZ25pdG9BdXRoUm9sZSh0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS0ke2dyb3VwLm5hbWV9LUNvZ25pdG9BdXRoUm9sZWAsIHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpdHlQb29sOiBpZGVudGl0eVBvb2wsXG4gICAgICAgICAgICAgICAgICAgIHBvbGljeUZpbGVQYXRoczogcG9saWN5RmlsZVBhdGhzLFxuICAgICAgICAgICAgICAgICAgICBwb2xpY2llczogZ3JvdXAucG9saWNpZXMsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY29uc3Qgcm9sZSA9IGNvZ25pdG9BdXRoUm9sZS5nZXRSb2xlKCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm9sZScsIHJvbGUsIGBjb2duaXRvXyR7Z3JvdXAubmFtZX1gKTtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm91dGVzJywgZ3JvdXAucm91dGVzLCBgY29nbml0b18ke2dyb3VwLm5hbWV9YCk7XG5cbiAgICAgICAgICAgICAgICBuZXcgQ2ZuVXNlclBvb2xHcm91cCh0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS0ke2dyb3VwLm5hbWV9LWdyb3VwYCwge1xuICAgICAgICAgICAgICAgICAgICBncm91cE5hbWU6IGdyb3VwLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgICAgICAgICAgICAgIHJvbGVBcm46IHJvbGUucm9sZUFybixcbiAgICAgICAgICAgICAgICAgICAgcHJlY2VkZW5jZTogZ3JvdXAucHJlY2VkZW5jZSB8fCAwLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgYXV0b1VzZXJTaWdudXBHcm91cHMgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzLmZpbHRlcihncm91cCA9PiBncm91cC5hdXRvVXNlclNpZ251cCkubWFwKGdyb3VwID0+IGdyb3VwLm5hbWUpLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICBjb25zdCBhdXRvVXNlclNpZ251cEdyb3Vwc0hhbmRsZXIgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzLmZpbHRlcihncm91cCA9PiBncm91cC5hdXRvVXNlclNpZ251cCkubWFwKGdyb3VwID0+IGdyb3VwLmF1dG9Vc2VyU2lnbnVwSGFuZGxlcik7XG5cbiAgICAgICAgICAgIC8vIE5vdGU6IG9ubHkgb25lIGF1dG8gc2lnbnVwIGhhbmRsZXIgaXMgc3VwcG9ydGVkLCBwaWNrIHRoZSBmaXJzdCBvbmVcbiAgICAgICAgICAgIGNvbnN0IGF1dG9Hcm91cHNBZGRIYW5kbGVyID0gYXV0b1VzZXJTaWdudXBHcm91cHNIYW5kbGVyWyAwIF0gfHwgJyc7XG5cbiAgICAgICAgICAgIGlmIChhdXRvVXNlclNpZ251cEdyb3VwcyAmJiBhdXRvR3JvdXBzQWRkSGFuZGxlcikge1xuICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBhIHBvc3QgY29uZmlybWF0aW9uIHRyaWdnZXIgdG8gYWRkIHVzZXJzIHRvIGF1dG8gc2lnbnVwIGdyb3Vwc1xuICAgICAgICAgICAgICAgIGNvbnN0IHByb3BzID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXV0b1NpZ251cEdyb3VwczogYXV0b1VzZXJTaWdudXBHcm91cHMsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogWyAnY29nbml0by1pZHA6QWRtaW5BZGRVc2VyVG9Hcm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsgJyonIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhRnVuY3Rpb25Qcm9wcyA9IG1lcmdlKFtcbiAgICAgICAgICAgICAgICAgICAgYXV0b0dyb3Vwc0FkZEhhbmRsZXIsXG4gICAgICAgICAgICAgICAgICAgIHByb3BzXG4gICAgICAgICAgICAgICAgXSkhO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiYXV0b1VzZXJTaWdudXBHcm91cHNIYW5kbGVyOiBcIiwgbGFtYmRhRnVuY3Rpb25Qcm9wcyk7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhVHJpZ2dlciA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1hdXRvLXBvc3QtY29uZmlybWF0aW9uLWxhbWJkYUZ1bmN0aW9uYCwge1xuICAgICAgICAgICAgICAgICAgICAuLi4obGFtYmRhRnVuY3Rpb25Qcm9wcyBhcyBMYW1iZGFGdW5jdGlvblByb3BzKSxcbiAgICAgICAgICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbC5hZGRUcmlnZ2VyKFVzZXJQb29sT3BlcmF0aW9uLlBPU1RfQ09ORklSTUFUSU9OLCBsYW1iZGFUcmlnZ2VyKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gY29uZmlndXJlIHJvbGUgbWFwcGluZ1xuICAgICAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZU1hcHBpbmdzID0ge1xuICAgICAgICAgICAgICAgIFwidXNlcnBvb2xcIjoge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIlRva2VuXCIsXG4gICAgICAgICAgICAgICAgICAgIGFtYmlndW91c1JvbGVSZXNvbHV0aW9uOiB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuYW1iaWd1b3VzUm9sZVJlc29sdXRpb24gfHwgJ0RlbnknLFxuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eVByb3ZpZGVyOiBpZGVudGl0eVByb3ZpZGVyLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElBTSByb2xlIGZvciBhdXRoZW50aWNhdGVkIHVzZXJzIGlmIG5vIGdyb3VwcyBhcmUgZGVmaW5lZFxuICAgICAgICBjb25zdCBwb2xpY3lGaWxlUGF0aHMgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcucG9saWN5RmlsZVBhdGhzO1xuICAgICAgICBjb25zdCBhdXRoZW50aWNhdGVkQ29nbml0b1JvbGUgPSBuZXcgQ29nbml0b0F1dGhSb2xlKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LUNvZ25pdG9BdXRoUm9sZWAsIHtcbiAgICAgICAgICAgIGlkZW50aXR5UG9vbDogaWRlbnRpdHlQb29sLFxuICAgICAgICAgICAgcG9saWN5RmlsZVBhdGhzOiBwb2xpY3lGaWxlUGF0aHMsXG4gICAgICAgICAgICBwb2xpY2llczogdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnBvbGljaWVzLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgYXV0aGVudGljYXRlZFJvbGUgPSBhdXRoZW50aWNhdGVkQ29nbml0b1JvbGUuZ2V0Um9sZSgpO1xuXG4gICAgICAgIC8vIGlmIG5vIGdyb3VwcyBhcmUgZGVmaW5lZCBhbGwgcG9saWNpZXMgYXJlIGFkZGVkIHRvIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZVxuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm9sZScsIGF1dGhlbnRpY2F0ZWRSb2xlLCBgY29nbml0b19kZWZhdWx0YCk7XG5cbiAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZXMgPSB7fTtcbiAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZXMuYXV0aGVudGljYXRlZCA9IGF1dGhlbnRpY2F0ZWRSb2xlLnJvbGVBcm47XG5cbiAgICAgICAgbmV3IENmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LUlkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50YCwgcm9sZUF0dGFjaG1lbnQpO1xuXG4gICAgICAgIC8vIGNyZWF0ZSB0cmlnZ2Vyc1xuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnRyaWdnZXJzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHRyaWdnZXIgb2YgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnRyaWdnZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhVHJpZ2dlciA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS0ke3RyaWdnZXIudHJpZ2dlcn0tbGFtYmRhRnVuY3Rpb25gLCB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnRyaWdnZXIuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbC5hZGRUcmlnZ2VyKHRoaXMubWFwVHJpZ2dlclR5cGUodHJpZ2dlci50cmlnZ2VyKSwgbGFtYmRhVHJpZ2dlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodXNlQXNEZWZhdWx0QXV0aG9yaXplciAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUgPSAnQVdTX0lBTSc7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiRGVmYXVsdCBBdXRob3JpemVyIHNldCB0byBBV1NfSUFNXCIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBtYXBUcmlnZ2VyVHlwZSh0cmlnZ2VyVHlwZTogVHJpZ2dlclR5cGUgfCBVc2VyUG9vbE9wZXJhdGlvbik6IFVzZXJQb29sT3BlcmF0aW9uIHtcblxuICAgICAgICBpZiAodHJpZ2dlclR5cGUgaW5zdGFuY2VvZiBVc2VyUG9vbE9wZXJhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIHRyaWdnZXJUeXBlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdHJpZ2dlck1hcHBpbmc6IHsgWyBrZXkgaW4gVHJpZ2dlclR5cGUgXTogVXNlclBvb2xPcGVyYXRpb24gfSA9IHtcbiAgICAgICAgICAgIENVU1RPTV9NRVNTQUdFOiBVc2VyUG9vbE9wZXJhdGlvbi5DVVNUT01fTUVTU0FHRSxcbiAgICAgICAgICAgIFBSRV9TSUdOX1VQOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfU0lHTl9VUCxcbiAgICAgICAgICAgIFBPU1RfQ09ORklSTUFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0NPTkZJUk1BVElPTixcbiAgICAgICAgICAgIFBSRV9UT0tFTl9HRU5FUkFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfVE9LRU5fR0VORVJBVElPTixcbiAgICAgICAgICAgIFVTRVJfTUlHUkFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5VU0VSX01JR1JBVElPTixcbiAgICAgICAgICAgIERFRklORV9BVVRIX0NIQUxMRU5HRTogVXNlclBvb2xPcGVyYXRpb24uREVGSU5FX0FVVEhfQ0hBTExFTkdFLFxuICAgICAgICAgICAgQ1JFQVRFX0FVVEhfQ0hBTExFTkdFOiBVc2VyUG9vbE9wZXJhdGlvbi5DUkVBVEVfQVVUSF9DSEFMTEVOR0UsXG4gICAgICAgICAgICBQT1NUX0FVVEhFTlRJQ0FUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0FVVEhFTlRJQ0FUSU9OLFxuICAgICAgICAgICAgUFJFX0FVVEhFTlRJQ0FUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfQVVUSEVOVElDQVRJT04sXG4gICAgICAgICAgICBQUkVfVE9LRU5fR0VORVJBVElPTl9DT05GSUc6IFVzZXJQb29sT3BlcmF0aW9uLlBSRV9UT0tFTl9HRU5FUkFUSU9OX0NPTkZJRyxcbiAgICAgICAgICAgIFZFUklGWV9BVVRIX0NIQUxMRU5HRV9SRVNQT05TRTogVXNlclBvb2xPcGVyYXRpb24uVkVSSUZZX0FVVEhfQ0hBTExFTkdFX1JFU1BPTlNFLFxuICAgICAgICAgICAgQ1VTVE9NX0VNQUlMX1NFTkRFUjogVXNlclBvb2xPcGVyYXRpb24uQ1VTVE9NX0VNQUlMX1NFTkRFUixcbiAgICAgICAgICAgIENVU1RPTV9TTVNfU0VOREVSOiBVc2VyUG9vbE9wZXJhdGlvbi5DVVNUT01fU01TX1NFTkRFUixcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gdHJpZ2dlck1hcHBpbmdbIHRyaWdnZXJUeXBlIF07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVVbmlxdWVVc2VyUG9vbE5hbWUodXNlclBvb2xOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3VzZXJQb29sTmFtZX1gO1xuICAgIH1cblxuICAgIHByaXZhdGUgY29uZmlndXJlU29jaWFsUHJvdmlkZXJzKHVzZXJQb29sOiBVc2VyUG9vbCwgdXNlclBvb2xDbGllbnQ6IFVzZXJQb29sQ2xpZW50LCB1c2VyUG9vbE5hbWU6IHN0cmluZykge1xuICAgICAgICBpZiAoIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uc29jaWFsUHJvdmlkZXJzKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMgPSAnJztcbiAgICAgICAgLy8gQ29uZmlndXJlIEdvb2dsZSBwcm92aWRlciBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uc29jaWFsUHJvdmlkZXJzPy5nb29nbGUpIHtcbiAgICAgICAgICAgIGNvbnN0IHsgY2xpZW50SWQsIGNsaWVudFNlY3JldCwgc2NvcGVzLCBhdHRyaWJ1dGVNYXBwaW5nIH0gPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2wuc29jaWFsUHJvdmlkZXJzLmdvb2dsZTtcblxuICAgICAgICAgICAgY29uc3QgZ29vZ2xlUHJvdmlkZXIgPSBuZXcgVXNlclBvb2xJZGVudGl0eVByb3ZpZGVyR29vZ2xlKHRoaXMubWFpblN0YWNrLCAnR29vZ2xlUHJvdmlkZXInLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2w6IHVzZXJQb29sLFxuICAgICAgICAgICAgICAgIGNsaWVudElkOiBjbGllbnRJZCxcbiAgICAgICAgICAgICAgICBjbGllbnRTZWNyZXQ6IGNsaWVudFNlY3JldCxcbiAgICAgICAgICAgICAgICBzY29wZXM6IHNjb3BlcyB8fCBbICdlbWFpbCcsICdwcm9maWxlJywgJ29wZW5pZCcgXSxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVNYXBwaW5nOiBhdHRyaWJ1dGVNYXBwaW5nIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW1haWw6IFByb3ZpZGVyQXR0cmlidXRlLkdPT0dMRV9FTUFJTCxcbiAgICAgICAgICAgICAgICAgICAgZW1haWxWZXJpZmllZDogUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0VNQUlMX1ZFUklGSUVELFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB1c2VyUG9vbENsaWVudC5ub2RlLmFkZERlcGVuZGVuY3koZ29vZ2xlUHJvdmlkZXIpO1xuICAgICAgICAgICAgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMgKz0gJ0dvb2dsZSwnO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29uZmlndXJlIEZhY2Vib29rIHByb3ZpZGVyIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5zb2NpYWxQcm92aWRlcnM/LmZhY2Vib29rKSB7XG4gICAgICAgICAgICBjb25zdCB7IGNsaWVudElkLCBjbGllbnRTZWNyZXQsIHNjb3BlcywgYXR0cmlidXRlTWFwcGluZyB9ID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sLnNvY2lhbFByb3ZpZGVycy5mYWNlYm9vaztcblxuICAgICAgICAgICAgY29uc3QgZmFjZWJvb2tQcm92aWRlciA9IG5ldyBVc2VyUG9vbElkZW50aXR5UHJvdmlkZXJGYWNlYm9vayh0aGlzLm1haW5TdGFjaywgJ0ZhY2Vib29rUHJvdmlkZXInLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2wsXG4gICAgICAgICAgICAgICAgY2xpZW50SWQsXG4gICAgICAgICAgICAgICAgY2xpZW50U2VjcmV0LFxuICAgICAgICAgICAgICAgIHNjb3Blczogc2NvcGVzIHx8IFsgJ2VtYWlsJywgJ3B1YmxpY19wcm9maWxlJyBdLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IGF0dHJpYnV0ZU1hcHBpbmcgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbWFpbDogUHJvdmlkZXJBdHRyaWJ1dGUuRkFDRUJPT0tfRU1BSUwsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHVzZXJQb29sQ2xpZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShmYWNlYm9va1Byb3ZpZGVyKTtcbiAgICAgICAgICAgIHN1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzICs9ICdGYWNlYm9vaywnO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ3N1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzJywgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMsIGB1c2VycG9vbF8ke3VzZXJQb29sTmFtZX1gKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbmZpZ3VyZURvbWFpbih1c2VyUG9vbDogVXNlclBvb2wsIHVzZXJQb29sTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIC8vIFNraXAgZG9tYWluIGNvbmZpZ3VyYXRpb24gaWYgbm90IG5lZWRlZFxuICAgICAgICBpZiAoIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uZG9tYWluICYmICF0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnNvY2lhbFByb3ZpZGVycykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZG9tYWluQ29uZmlnID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5kb21haW47XG4gICAgICAgIGxldCBkb21haW46IFVzZXJQb29sRG9tYWluO1xuICAgICAgICBsZXQgZG9tYWluVXJsOiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKGRvbWFpbkNvbmZpZz8uY3VzdG9tRG9tYWluICYmIGRvbWFpbkNvbmZpZy5jdXN0b21Eb21haW4uZG9tYWluTmFtZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBDb25maWd1cmUgY3VzdG9tIGRvbWFpblxuICAgICAgICAgICAgY29uc3QgeyBkb21haW5OYW1lLCBjZXJ0aWZpY2F0ZUFybiB9ID0gZG9tYWluQ29uZmlnLmN1c3RvbURvbWFpbjtcbiAgICAgICAgICAgIGRvbWFpbiA9IG5ldyBVc2VyUG9vbERvbWFpbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1kb21haW5gLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2wsXG4gICAgICAgICAgICAgICAgY3VzdG9tRG9tYWluOiB7XG4gICAgICAgICAgICAgICAgICAgIGRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlOiBDZXJ0aWZpY2F0ZS5mcm9tQ2VydGlmaWNhdGVBcm4odGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tY2VydGAsIGNlcnRpZmljYXRlQXJuKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGRvbWFpblVybCA9IGRvbWFpbk5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBVc2UgQ29nbml0byBkb21haW5cbiAgICAgICAgICAgIGNvbnN0IGRvbWFpblByZWZpeCA9IGRvbWFpbkNvbmZpZz8uY29nbml0b0RvbWFpblByZWZpeCB8fFxuICAgICAgICAgICAgICAgIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3VzZXJQb29sTmFtZX0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudH1gLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTktXS9nLCAnLScpO1xuXG4gICAgICAgICAgICBkb21haW4gPSBuZXcgVXNlclBvb2xEb21haW4odGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tZG9tYWluYCwge1xuICAgICAgICAgICAgICAgIHVzZXJQb29sLFxuICAgICAgICAgICAgICAgIGNvZ25pdG9Eb21haW46IHtcbiAgICAgICAgICAgICAgICAgICAgZG9tYWluUHJlZml4LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZG9tYWluVXJsID0gYCR7ZG9tYWluUHJlZml4fS5hdXRoLiR7dGhpcy5mdzI0LmdldENvbmZpZygpLnJlZ2lvbn0uYW1hem9uY29nbml0by5jb21gO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHRoZSBkb21haW4gVVJMIGFzIGEgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ2F1dGhEb21haW4nLCBkb21haW5VcmwsIGB1c2VycG9vbF8ke3VzZXJQb29sTmFtZX1gKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZUxhbWJkYUF1dGhvcml6ZXIodXNlQXNEZWZhdWx0QXV0aG9yaXplcjogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdXRob3JpemVyRnVuY3Rpb24gPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyLnR5cGV9LUN1c3RvbUF1dGhvcml6ZXJgLCB7XG4gICAgICAgICAgICAuLi50aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplci5mdW5jdGlvblByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBhdXRob3JpemVyID0gbmV3IFRva2VuQXV0aG9yaXplcih0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmN1c3RvbUF1dGhvcml6ZXIudHlwZX0tVG9rZW5BdXRob3JpemVyYCwge1xuICAgICAgICAgICAgaGFuZGxlcjogYXV0aG9yaXplckZ1bmN0aW9uIGFzIE5vZGVqc0Z1bmN0aW9uLFxuICAgICAgICAgICAgaWRlbnRpdHlTb3VyY2U6ICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbicsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Snd0QXV0aG9yaXplcihhdXRob3JpemVyLCB1c2VBc0RlZmF1bHRBdXRob3JpemVyKTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyLnR5cGUsIGF1dGhvcml6ZXIsIE91dHB1dFR5cGUuQVVUSE9SSVpFUik7XG5cbiAgICB9XG59XG4iXX0=