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
                // create a role for the group
                const policyFilePaths = group.policyFilePaths;
                const role = new cognito_auth_role_1.CognitoAuthRole(this.mainStack, `${userPoolName}-${group.name}-CognitoAuthRole`, {
                    identityPool: identityPool,
                    policyFilePaths: policyFilePaths,
                    policies: group.policies,
                });
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
        const authenticatedRole = new cognito_auth_role_1.CognitoAuthRole(this.mainStack, `${userPoolName}-CognitoAuthRole`, {
            identityPool: identityPool,
            policyFilePaths: policyFilePaths,
            policies: this.authConstructConfig.policies,
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2F1dGgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEseURBZWlDO0FBRWpDLCtEQUF5RjtBQUV6Riw2Q0FBNkQ7QUFDN0QsMkRBQXNEO0FBQ3RELHVEQUF3RTtBQUN4RSx1Q0FBb0M7QUFDcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQUN2RCxrQ0FBaUM7QUFFakMsb0NBQWlDO0FBQ2pDLCtFQUFpRTtBQUNqRSwrQkFBcUM7QUFDckMscUNBQTJDO0FBQzNDLG1DQUF5QztBQTRMekMsTUFBTSwyQkFBMkIsR0FBeUI7SUFDdEQsUUFBUSxFQUFFO1FBQ04sS0FBSyxFQUFFO1lBQ0gsaUJBQWlCLEVBQUUsS0FBSztZQUN4QixnQkFBZ0IsRUFBRTtnQkFDZCxVQUFVLEVBQUUsb0NBQXNCLENBQUMsSUFBSTthQUMxQztZQUNELFVBQVUsRUFBRTtnQkFDUixLQUFLLEVBQUUsSUFBSTthQUNkO1lBQ0QsYUFBYSxFQUFFO2dCQUNYLEtBQUssRUFBRSxJQUFJO2FBQ2Q7WUFDRCxjQUFjLEVBQUU7Z0JBQ1osU0FBUyxFQUFFLENBQUM7Z0JBQ1osZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixvQkFBb0IsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7YUFDekM7WUFDRCxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxNQUFNO1NBQ3RDO0tBQ0o7SUFDRCxjQUFjLEVBQUU7UUFDWixLQUFLLEVBQUU7WUFDSCxjQUFjLEVBQUUsS0FBSztZQUNyQixTQUFTLEVBQUU7Z0JBQ1AsWUFBWSxFQUFFLElBQUk7YUFDckI7U0FDSjtLQUNKO0lBQ0QsdUJBQXVCLEVBQUUsTUFBTTtDQUNsQyxDQUFBO0FBRUQsTUFBYSxhQUFhO0lBcUJGO0lB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Q0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsc0JBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUUxSCxDQUFDO0NBQ0o7QUEvVkQsc0NBK1ZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgICBDZm5JZGVudGl0eVBvb2wsXG4gICAgQ2ZuSWRlbnRpdHlQb29sUm9sZUF0dGFjaG1lbnQsXG4gICAgQ2ZuVXNlclBvb2xHcm91cCxcbiAgICBVc2VyUG9vbCxcbiAgICBVc2VyUG9vbENsaWVudCxcbiAgICBVc2VyUG9vbFByb3BzLFxuICAgIFVzZXJQb29sT3BlcmF0aW9uLFxuICAgIFZlcmlmaWNhdGlvbkVtYWlsU3R5bGUsXG4gICAgVXNlclBvb2xDbGllbnRQcm9wcyxcbiAgICBVc2VyUG9vbENsaWVudE9wdGlvbnMsXG4gICAgVXNlclBvb2xJZGVudGl0eVByb3ZpZGVyR29vZ2xlLFxuICAgIFVzZXJQb29sSWRlbnRpdHlQcm92aWRlckZhY2Vib29rLFxuICAgIFVzZXJQb29sRG9tYWluLFxuICAgIFByb3ZpZGVyQXR0cmlidXRlLFxufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNvZ25pdG9cIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBDb2duaXRvVXNlclBvb2xzQXV0aG9yaXplciwgVG9rZW5BdXRob3JpemVyIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5pbXBvcnQgeyBQb2xpY3lTdGF0ZW1lbnQsIFBvbGljeVN0YXRlbWVudFByb3BzLCBSb2xlLCBVc2VyIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IER1cmF0aW9uLCBSZW1vdmFsUG9saWN5LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29nbml0b0F1dGhSb2xlIH0gZnJvbSBcIi4vY29nbml0by1hdXRoLXJvbGVcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uLCBMYW1iZGFGdW5jdGlvblByb3BzIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBMb2dEdXJhdGlvbiB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZVwiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBDZXJ0aWZpY2F0ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2VydGlmaWNhdGVtYW5hZ2VyXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcbmltcG9ydCB7IE1haWxlckNvbnN0cnVjdCB9IGZyb20gXCIuL21haWxlclwiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuXG5pbnRlcmZhY2UgSVJvbGVBdHRhY2htZW50Q29uZmlnIHtcbiAgICBpZGVudGl0eVBvb2xJZDogc3RyaW5nO1xuICAgIHJvbGVzPzoge1xuICAgICAgICBhdXRoZW50aWNhdGVkPzogc3RyaW5nO1xuICAgICAgICB1bmF1dGhlbnRpY2F0ZWQ/OiBzdHJpbmc7XG4gICAgfTtcbiAgICByb2xlTWFwcGluZ3M/OiB7XG4gICAgICAgIFsga2V5OiBzdHJpbmcgXToge1xuICAgICAgICAgICAgdHlwZTogc3RyaW5nO1xuICAgICAgICAgICAgYW1iaWd1b3VzUm9sZVJlc29sdXRpb246IHN0cmluZztcbiAgICAgICAgICAgIGlkZW50aXR5UHJvdmlkZXI6IHN0cmluZztcbiAgICAgICAgfTtcbiAgICB9O1xufVxuXG5leHBvcnQgdHlwZSBUcmlnZ2VyVHlwZSA9XG4gICAgfCAnQ1VTVE9NX01FU1NBR0UnXG4gICAgfCAnUFJFX1NJR05fVVAnXG4gICAgfCAnUE9TVF9DT05GSVJNQVRJT04nXG4gICAgfCAnUFJFX1RPS0VOX0dFTkVSQVRJT04nXG4gICAgfCAnVVNFUl9NSUdSQVRJT04nXG4gICAgfCAnREVGSU5FX0FVVEhfQ0hBTExFTkdFJ1xuICAgIHwgJ0NSRUFURV9BVVRIX0NIQUxMRU5HRSdcbiAgICB8ICdQT1NUX0FVVEhFTlRJQ0FUSU9OJ1xuICAgIHwgJ1BSRV9BVVRIRU5USUNBVElPTidcbiAgICB8ICdQUkVfVE9LRU5fR0VORVJBVElPTl9DT05GSUcnXG4gICAgfCAnVkVSSUZZX0FVVEhfQ0hBTExFTkdFX1JFU1BPTlNFJ1xuICAgIHwgJ0NVU1RPTV9FTUFJTF9TRU5ERVInXG4gICAgfCAnQ1VTVE9NX1NNU19TRU5ERVInO1xuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gaW50ZXJmYWNlIGZvciBzb2NpYWwgaWRlbnRpdHkgcHJvdmlkZXJzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElTb2NpYWxQcm92aWRlckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogT0F1dGggY2xpZW50IElEIGZvciB0aGUgc29jaWFsIHByb3ZpZGVyXG4gICAgICovXG4gICAgY2xpZW50SWQ6IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBPQXV0aCBjbGllbnQgc2VjcmV0IGZvciB0aGUgc29jaWFsIHByb3ZpZGVyXG4gICAgICovXG4gICAgY2xpZW50U2VjcmV0OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgT0F1dGggc2NvcGVzIHRvIHJlcXVlc3RcbiAgICAgKi9cbiAgICBzY29wZXM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBhdHRyaWJ1dGUgbWFwcGluZyBmcm9tIHByb3ZpZGVyIHRvIENvZ25pdG9cbiAgICAgKi9cbiAgICBhdHRyaWJ1dGVNYXBwaW5nPzoge1xuICAgICAgICBbIGtleTogc3RyaW5nIF06IHN0cmluZztcbiAgICB9O1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBDb2duaXRvIGRvbWFpblxuICovXG5leHBvcnQgaW50ZXJmYWNlIElEb21haW5Db25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBkb21haW4gcHJlZml4IGZvciBDb2duaXRvIGhvc3RlZCBVSS5cbiAgICAgKiBJZiB1c2luZyBhIGN1c3RvbSBkb21haW4sIHRoaXMgaXMgaWdub3JlZC5cbiAgICAgKi9cbiAgICBjb2duaXRvRG9tYWluUHJlZml4Pzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyYXRpb24gZm9yIGEgY3VzdG9tIGRvbWFpblxuICAgICAqL1xuICAgIGN1c3RvbURvbWFpbj86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBkb21haW4gbmFtZSB0byB1c2UgKGUuZy4gJ2F1dGguZXhhbXBsZS5jb20nKVxuICAgICAgICAgKi9cbiAgICAgICAgZG9tYWluTmFtZTogc3RyaW5nO1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIEFSTiBvZiBhbiBleGlzdGluZyBBQ00gY2VydGlmaWNhdGUgZm9yIHRoZSBkb21haW5cbiAgICAgICAgICovXG4gICAgICAgIGNlcnRpZmljYXRlQXJuOiBzdHJpbmc7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGludGVyZmFjZSBmb3IgdGhlIEF1dGhDb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUF1dGhDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBDb25maWd1cmF0aW9uIGZvciB0aGUgVXNlciBQb29sLlxuICAgICAqL1xuICAgIHVzZXJQb29sPzoge1xuICAgICAgICBwcm9wczogVXNlclBvb2xQcm9wcztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIERvbWFpbiBjb25maWd1cmF0aW9uIGZvciB0aGUgdXNlciBwb29sLlxuICAgICAgICAgKiBSZXF1aXJlZCBmb3Igc29jaWFsIHNpZ24taW4gYW5kIGhvc3RlZCBVSSBmZWF0dXJlcy5cbiAgICAgICAgICovXG4gICAgICAgIGRvbWFpbj86IElEb21haW5Db25maWc7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDb25maWd1cmF0aW9uIGZvciBzb2NpYWwgaWRlbnRpdHkgcHJvdmlkZXJzLlxuICAgICAgICAgKiBXaGVuIGNvbmZpZ3VyZWQsIE9BdXRoIGZsb3dzIGFyZSBhdXRvbWF0aWNhbGx5IGVuYWJsZWQgd2l0aCBhcHByb3ByaWF0ZSBzZXR0aW5ncy5cbiAgICAgICAgICovXG4gICAgICAgIHNvY2lhbFByb3ZpZGVycz86IHtcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogR29vZ2xlIGlkZW50aXR5IHByb3ZpZGVyIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgZ29vZ2xlPzogSVNvY2lhbFByb3ZpZGVyQ29uZmlnO1xuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBGYWNlYm9vayBpZGVudGl0eSBwcm92aWRlciBjb25maWd1cmF0aW9uXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGZhY2Vib29rPzogSVNvY2lhbFByb3ZpZGVyQ29uZmlnO1xuICAgICAgICB9O1xuICAgIH07XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIFVzZXIgUG9vbCBDbGllbnQuXG4gICAgICovXG4gICAgdXNlclBvb2xDbGllbnQ/OiB7XG4gICAgICAgIHByb3BzOiBVc2VyUG9vbENsaWVudE9wdGlvbnM7XG4gICAgfTtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBwb2xpY2llcyB0byBhdHRhY2ggdG8gdGhlIGRlZmF1bHQgYXV0aGVudGljYXRlZCByb2xlLlxuICAgICAqL1xuICAgIHBvbGljaWVzPzogQXJyYXk8UG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ+O1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGZpbGUgcGF0aHMgZm9yIHBvbGljeSBmaWxlcy5cbiAgICAgKi9cbiAgICBwb2xpY3lGaWxlUGF0aHM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiB0cmlnZ2VycyBmb3IgdXNlciBwb29sIG9wZXJhdGlvbnMuXG4gICAgICovXG4gICAgdHJpZ2dlcnM/OiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgdXNlciBwb29sIG9wZXJhdGlvbiB0aGF0IHRyaWdnZXJzIHRoZSBmdW5jdGlvbi5cbiAgICAgICAgICovXG4gICAgICAgIHRyaWdnZXI6IFVzZXJQb29sT3BlcmF0aW9uIHwgVHJpZ2dlclR5cGU7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDb25maWd1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgICAgICAgKi9cbiAgICAgICAgZnVuY3Rpb25Qcm9wczogTGFtYmRhRnVuY3Rpb25Qcm9wcztcbiAgICB9W107XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgZ3JvdXBzIGZvciB0aGUgQXV0aENvbnN0cnVjdC5cbiAgICAgKi9cbiAgICBncm91cHM/OiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgbmFtZSBvZiB0aGUgZ3JvdXAuXG4gICAgICAgICAqL1xuICAgICAgICBuYW1lOiBzdHJpbmc7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgcHJlY2VkZW5jZSBvZiB0aGUgZ3JvdXAuXG4gICAgICAgICAqL1xuICAgICAgICBwcmVjZWRlbmNlPzogbnVtYmVyO1xuICAgICAgICAvKipcbiAgICAgICAgICogQXJyYXkgb2YgcG9saWNpZXMgdG8gYXR0YWNoIHRvIHRoZSBncm91cC5cbiAgICAgICAgICovXG4gICAgICAgIHBvbGljaWVzPzogQXJyYXk8UG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ+O1xuICAgICAgICAvKipcbiAgICAgICAgICogQXJyYXkgb2YgZmlsZSBwYXRocyBmb3IgcG9saWN5IGZpbGVzIHNwZWNpZmljIHRvIHRoaXMgZ3JvdXAuXG4gICAgICAgICAqL1xuICAgICAgICBwb2xpY3lGaWxlUGF0aHM/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEZsYWcgaW5kaWNhdGluZyB3aGV0aGVyIHRoZSB1c2VyIHNob3VsZCBiZSBhdXRvbWF0aWNhbGx5IHNpZ25lZCB1cCB0byB0aGlzIGdyb3VwIGR1cmluZyBzaWdudXAuXG4gICAgICAgICAqL1xuICAgICAgICBhdXRvVXNlclNpZ251cD86IGJvb2xlYW47XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDb25maWd1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uIHRoYXQgaGFuZGxlcyBhdXRvbWF0aWMgdXNlciBzaWdudXAuXG4gICAgICAgICAqL1xuICAgICAgICBhdXRvVXNlclNpZ251cEhhbmRsZXI/OiBMYW1iZGFGdW5jdGlvblByb3BzO1xuICAgICAgICAvKipcbiAgICAgICAgICogQXJyYXkgb2Ygcm91dGVzIHByb3RlY3RlZCBieSB0aGlzIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgcm91dGVzPzogc3RyaW5nW107XG4gICAgfVtdO1xuICAgIC8qKlxuICAgICAqIEZsYWcgaW5kaWNhdGluZyB3aGV0aGVyIHRvIHVzZSB0aGlzIEF1dGhDb25zdHJ1Y3QgYXMgdGhlIGRlZmF1bHQgYXV0aG9yaXplci5cbiAgICAgKi9cbiAgICB1c2VBc0RlZmF1bHRBdXRob3JpemVyPzogYm9vbGVhbjtcbiAgICAvKipcbiAgICAgKiBDb25maWd1cmF0aW9uIGZvciBhIGN1c3RvbSBMYW1iZGEgYXV0aG9yaXplci5cbiAgICAgKi9cbiAgICBjdXN0b21BdXRob3JpemVyPzoge1xuICAgICAgICB0eXBlOiBzdHJpbmc7XG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHM7XG4gICAgfTtcbiAgICAvKipcbiAgICAgKiBIb3cgdG8gcmVzb2x2ZSBhbWJpZ3VvdXMgcm9sZSBhc3NpZ25tZW50cy5cbiAgICAgKiBEZWZhdWx0cyB0byBcIlVzZURlZmF1bHRSb2xlXCIgd2hpY2ggd2lsbCB1c2UgdGhlIGRlZmF1bHQgYXV0aGVudGljYXRlZCByb2xlIHdoZW4gdGhlcmUncyBhbWJpZ3VpdHkuXG4gICAgICogQ2FuIGJlIHNldCB0byBcIkRlbnlcIiB0byBkZW55IGFjY2VzcyB3aGVuIHRoZXJlJ3MgYW1iaWd1aXR5LlxuICAgICAqL1xuICAgIGFtYmlndW91c1JvbGVSZXNvbHV0aW9uPzogJ1VzZURlZmF1bHRSb2xlJyB8ICdEZW55Jztcbn1cblxuY29uc3QgQXV0aENvbnN0cnVjdENvbmZpZ0RlZmF1bHRzOiBJQXV0aENvbnN0cnVjdENvbmZpZyA9IHtcbiAgICB1c2VyUG9vbDoge1xuICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICAgICAgdXNlclZlcmlmaWNhdGlvbjoge1xuICAgICAgICAgICAgICAgIGVtYWlsU3R5bGU6IFZlcmlmaWNhdGlvbkVtYWlsU3R5bGUuQ09ERSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhdXRvVmVyaWZ5OiB7XG4gICAgICAgICAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2lnbkluQWxpYXNlczoge1xuICAgICAgICAgICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHBhc3N3b3JkUG9saWN5OiB7XG4gICAgICAgICAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICAgICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgICAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICAgICAgICAgIHJlcXVpcmVTeW1ib2xzOiB0cnVlLFxuICAgICAgICAgICAgICAgIHRlbXBQYXNzd29yZFZhbGlkaXR5OiBEdXJhdGlvbi5kYXlzKDMpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgICB9XG4gICAgfSxcbiAgICB1c2VyUG9vbENsaWVudDoge1xuICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLFxuICAgICAgICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgICAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbiAgICBhbWJpZ3VvdXNSb2xlUmVzb2x1dGlvbjogJ0RlbnknXG59XG5cbmV4cG9ydCBjbGFzcyBBdXRoQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEF1dGhDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIG5hbWU6IHN0cmluZyA9IEF1dGhDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gWyBWcGNDb25zdHJ1Y3QubmFtZSwgTWFpbGVyQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWUgXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGUgYSBuZXcgQXV0aENvbnN0cnVjdC5cbiAgICAgKiBAcGFyYW0gYXV0aENvbnN0cnVjdENvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIG9iamVjdCBmb3IgdGhlIEF1dGggY29uc3RydWN0LlxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gQ3JlYXRlIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBBdXRoIGNsYXNzXG4gICAgICogY29uc3QgYXV0aENvbmZpZzogSUF1dGhDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICogICAvLyBQcm92aWRlIHRoZSBuZWNlc3NhcnkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gICAgICogICAvLyAuLi5cbiAgICAgKiB9O1xuICAgICAqIGNvbnN0IGF1dGggPSBuZXcgQXV0aChhdXRoQ29uZmlnKTtcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIGF1dGhDb25zdHJ1Y3RDb25maWc6IElBdXRoQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGF1dGhDb25zdHJ1Y3RDb25maWcsICdDT0dOSVRPJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJjb25zdHJ1Y3RcIik7XG5cbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnN0YWNrTmFtZSwgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG5cbiAgICAgICAgaWYgKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyPy50eXBlID09PSAnand0Jykge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVMYW1iZGFBdXRob3JpemVyKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyIHx8IGZhbHNlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVzZXJQb29sQ29uZmlnID0gbWVyZ2UoW1xuICAgICAgICAgICAgQXV0aENvbnN0cnVjdENvbmZpZ0RlZmF1bHRzLnVzZXJQb29sPy5wcm9wcyA/PyB7fSxcbiAgICAgICAgICAgIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8ucHJvcHMgPz8ge31cbiAgICAgICAgXSkhO1xuICAgICAgICBjb25zdCB1c2VyUG9vbE5hbWUgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnByb3BzPy51c2VyUG9vbE5hbWUgfHwgJ2RlZmF1bHQnO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQ3JlYXRpbmcgdXNlciBwb29sOiBcIiwgdXNlclBvb2xOYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJ1c2VyIHBvb2wgY29uZmlnOiBcIiwgdXNlclBvb2xOYW1lLCB1c2VyUG9vbENvbmZpZyk7XG5cbiAgICAgICAgaWYgKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRPRE86IEFkZCBhYmlsaXR5IHRvIGNyZWF0ZSBtdWx0aS10ZW5hbnQgdXNlciBwb29sc1xuICAgICAgICBjb25zdCB1c2VyUG9vbDogVXNlclBvb2wgPSBuZXcgVXNlclBvb2wodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tdXNlclBvb2xgLCB7XG4gICAgICAgICAgICAuLi4odXNlclBvb2xDb25maWcgYXMgVXNlclBvb2xQcm9wcyksXG4gICAgICAgICAgICB1c2VyUG9vbE5hbWU6IHRoaXMuY3JlYXRlVW5pcXVlVXNlclBvb2xOYW1lKHVzZXJQb29sTmFtZSksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENvbmZpZ3VyZSBkb21haW4gaWYgc3BlY2lmaWVkIG9yIGlmIHNvY2lhbCBwcm92aWRlcnMgYXJlIGVuYWJsZWRcbiAgICAgICAgdGhpcy5jb25maWd1cmVEb21haW4odXNlclBvb2wsIHVzZXJQb29sTmFtZSk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCB1c2VyUG9vbE5hbWUsIHVzZXJQb29sLCBPdXRwdXRUeXBlLlVTRVJQT09MLCAndXNlclBvb2xJZCcpO1xuXG4gICAgICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50Q29uZmlnOiBVc2VyUG9vbENsaWVudFByb3BzID0gbWVyZ2UoW1xuICAgICAgICAgICAgeyB1c2VyUG9vbDogdXNlclBvb2wgfSxcbiAgICAgICAgICAgIEF1dGhDb25zdHJ1Y3RDb25maWdEZWZhdWx0cy51c2VyUG9vbENsaWVudD8ucHJvcHMgPz8ge30sXG4gICAgICAgICAgICB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2xDbGllbnQ/LnByb3BzID8/IHt9XG4gICAgICAgIF0pITtcblxuICAgICAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBVc2VyUG9vbENsaWVudCh0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS11c2VyUG9vbGNsaWVudGAsIHVzZXJQb29sQ2xpZW50Q29uZmlnKTtcblxuICAgICAgICAvLyBDb25maWd1cmUgc29jaWFsIHByb3ZpZGVycyBpZiBzcGVjaWZpZWRcbiAgICAgICAgdGhpcy5jb25maWd1cmVTb2NpYWxQcm92aWRlcnModXNlclBvb2wsIHVzZXJQb29sQ2xpZW50LCB1c2VyUG9vbE5hbWUpO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdXNlclBvb2xOYW1lLCB1c2VyUG9vbENsaWVudCwgT3V0cHV0VHlwZS5VU0VSUE9PTENMSUVOVCwgJ3VzZXJQb29sQ2xpZW50SWQnKTtcblxuICAgICAgICAvLyBJZGVudGl0eSBwb29sIGJhc2VkIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzIHx8IHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5wb2xpY3lGaWxlUGF0aHMgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSA9PSAnQVdTX0lBTScpIHtcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlSWRlbnRpdHlQb29sQXV0aG9yaXplcih1c2VyUG9vbCwgdXNlclBvb2xDbGllbnQsIHVzZXJQb29sTmFtZSwgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZUFzRGVmYXVsdEF1dGhvcml6ZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gdXNlciBwb29sIGJhc2UgYXV0aGVudGljYXRpb25cbiAgICAgICAgICAgIHRoaXMuY3JlYXRlVXNlclBvb2xBdXRob3JpemVyKHVzZXJQb29sLCB1c2VyUG9vbE5hbWUsIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyKTtcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVVc2VyUG9vbEF1dGhvcml6ZXIodXNlclBvb2w6IFVzZXJQb29sLCB1c2VyUG9vbE5hbWU6IHN0cmluZywgdXNlQXNEZWZhdWx0QXV0aG9yaXplcjogYm9vbGVhbikge1xuICAgICAgICAvLyBjb2duaXRvIGF1dGhvcml6ZXIgXG4gICAgICAgIGNvbnN0IHVzZXJQb29sQXV0aG9yaXplciA9IG5ldyBDb2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1BdXRob3JpemVyYCwge1xuICAgICAgICAgICAgY29nbml0b1VzZXJQb29sczogWyB1c2VyUG9vbCBdLFxuICAgICAgICAgICAgaWRlbnRpdHlTb3VyY2U6ICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb2duaXRvQXV0aG9yaXplcihcbiAgICAgICAgICAgIHVzZXJQb29sTmFtZSxcbiAgICAgICAgICAgIHVzZXJQb29sQXV0aG9yaXplcixcbiAgICAgICAgICAgIC8vIFRPRE86IGJldHRlciBsb2dpYyB0byBjb250cm9sIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXJcbiAgICAgICAgICAgIHVzZUFzRGVmYXVsdEF1dGhvcml6ZXJcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAodXNlQXNEZWZhdWx0QXV0aG9yaXplciAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUgPSAnQ09HTklUT19VU0VSX1BPT0xTJztcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKHVzZXJQb29sTmFtZSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiRGVmYXVsdCBBdXRob3JpemVyIHNldCB0byBDT0dOSVRPX1VTRVJfUE9PTFNcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZUlkZW50aXR5UG9vbEF1dGhvcml6ZXIodXNlclBvb2w6IFVzZXJQb29sLCB1c2VyUG9vbENsaWVudDogVXNlclBvb2xDbGllbnQsIHVzZXJQb29sTmFtZTogc3RyaW5nLCB1c2VBc0RlZmF1bHRBdXRob3JpemVyOiBib29sZWFuKSB7XG5cbiAgICAgICAgY29uc3QgaWRlbnRpdHlQb29sID0gbmV3IENmbklkZW50aXR5UG9vbCh0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1pZGVudGl0eVBvb2xgLCB7XG4gICAgICAgICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IHRydWUsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQcm92aWRlcnM6IFsge1xuICAgICAgICAgICAgICAgIGNsaWVudElkOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICAgICAgICB9IF0sXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHVzZXJQb29sTmFtZSwgaWRlbnRpdHlQb29sLCBPdXRwdXRUeXBlLklERU5USVRZUE9PTCwgJ3JlZicsICdpZGVudGl0eVBvb2xJZCcpO1xuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBpZGVudGl0eSBwb29sIHJvbGUgYXR0YWNobWVudFxuICAgICAgICBjb25zdCBpZGVudGl0eVByb3ZpZGVyID0gdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUgKyAnOicgKyB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkO1xuICAgICAgICBjb25zdCByb2xlQXR0YWNobWVudDogSVJvbGVBdHRhY2htZW50Q29uZmlnID0ge1xuICAgICAgICAgICAgaWRlbnRpdHlQb29sSWQ6IGlkZW50aXR5UG9vbC5yZWYsXG4gICAgICAgIH1cblxuICAgICAgICAvLyBjcmVhdGUgdXNlciBwb29sIGdyb3Vwc1xuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcykge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBOYW1lcyA9IHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5ncm91cHMubWFwKGdyb3VwID0+IGdyb3VwLm5hbWUpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0dyb3VwcycsIGdyb3VwTmFtZXMsICdjb2duaXRvJyk7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnYXV0aEdyb3VwcycsIGdyb3VwTmFtZXMuam9pbignLCcpLCBgdXNlcnBvb2xfJHt1c2VyUG9vbE5hbWV9YCk7XG4gICAgICAgICAgICAvL3RoaXMuZncyNC5zZXQoJ0F1dG9Vc2VyU2lnbnVwR3JvdXBzJywgdGhpcy5hdXRoQ29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5uYW1lKS50b1N0cmluZygpLCB1c2VyUG9vbE5hbWUpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgLy8gY3JlYXRlIGEgcm9sZSBmb3IgdGhlIGdyb3VwXG4gICAgICAgICAgICAgICAgY29uc3QgcG9saWN5RmlsZVBhdGhzID0gZ3JvdXAucG9saWN5RmlsZVBhdGhzO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJvbGUgPSBuZXcgQ29nbml0b0F1dGhSb2xlKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LSR7Z3JvdXAubmFtZX0tQ29nbml0b0F1dGhSb2xlYCwge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eVBvb2w6IGlkZW50aXR5UG9vbCxcbiAgICAgICAgICAgICAgICAgICAgcG9saWN5RmlsZVBhdGhzOiBwb2xpY3lGaWxlUGF0aHMsXG4gICAgICAgICAgICAgICAgICAgIHBvbGljaWVzOiBncm91cC5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICB9KSBhcyBSb2xlO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ1JvbGUnLCByb2xlLCBgY29nbml0b18ke2dyb3VwLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ1JvdXRlcycsIGdyb3VwLnJvdXRlcywgYGNvZ25pdG9fJHtncm91cC5uYW1lfWApO1xuXG4gICAgICAgICAgICAgICAgbmV3IENmblVzZXJQb29sR3JvdXAodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tJHtncm91cC5uYW1lfS1ncm91cGAsIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBOYW1lOiBncm91cC5uYW1lLFxuICAgICAgICAgICAgICAgICAgICB1c2VyUG9vbElkOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgICAgICAgICAgICByb2xlQXJuOiByb2xlLnJvbGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHByZWNlZGVuY2U6IGdyb3VwLnByZWNlZGVuY2UgfHwgMCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGF1dG9Vc2VyU2lnbnVwR3JvdXBzID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5uYW1lKS50b1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3QgYXV0b1VzZXJTaWdudXBHcm91cHNIYW5kbGVyID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5hdXRvVXNlclNpZ251cEhhbmRsZXIpO1xuXG4gICAgICAgICAgICAvLyBOb3RlOiBvbmx5IG9uZSBhdXRvIHNpZ251cCBoYW5kbGVyIGlzIHN1cHBvcnRlZCwgcGljayB0aGUgZmlyc3Qgb25lXG4gICAgICAgICAgICBjb25zdCBhdXRvR3JvdXBzQWRkSGFuZGxlciA9IGF1dG9Vc2VyU2lnbnVwR3JvdXBzSGFuZGxlclsgMCBdIHx8ICcnO1xuXG4gICAgICAgICAgICBpZiAoYXV0b1VzZXJTaWdudXBHcm91cHMgJiYgYXV0b0dyb3Vwc0FkZEhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAvLyBjcmVhdGUgYSBwb3N0IGNvbmZpcm1hdGlvbiB0cmlnZ2VyIHRvIGFkZCB1c2VycyB0byBhdXRvIHNpZ251cCBncm91cHNcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF1dG9TaWdudXBHcm91cHM6IGF1dG9Vc2VyU2lnbnVwR3JvdXBzLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsgJ2NvZ25pdG8taWRwOkFkbWluQWRkVXNlclRvR3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbICcqJyBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uUHJvcHMgPSBtZXJnZShbXG4gICAgICAgICAgICAgICAgICAgIGF1dG9Hcm91cHNBZGRIYW5kbGVyLFxuICAgICAgICAgICAgICAgICAgICBwcm9wc1xuICAgICAgICAgICAgICAgIF0pITtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImF1dG9Vc2VyU2lnbnVwR3JvdXBzSGFuZGxlcjogXCIsIGxhbWJkYUZ1bmN0aW9uUHJvcHMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhbWJkYVRyaWdnZXIgPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tYXV0by1wb3N0LWNvbmZpcm1hdGlvbi1sYW1iZGFGdW5jdGlvbmAsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4uKGxhbWJkYUZ1bmN0aW9uUHJvcHMgYXMgTGFtYmRhRnVuY3Rpb25Qcm9wcyksXG4gICAgICAgICAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG4gICAgICAgICAgICAgICAgdXNlclBvb2wuYWRkVHJpZ2dlcihVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0NPTkZJUk1BVElPTiwgbGFtYmRhVHJpZ2dlcik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGNvbmZpZ3VyZSByb2xlIG1hcHBpbmdcbiAgICAgICAgICAgIHJvbGVBdHRhY2htZW50LnJvbGVNYXBwaW5ncyA9IHtcbiAgICAgICAgICAgICAgICBcInVzZXJwb29sXCI6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJUb2tlblwiLFxuICAgICAgICAgICAgICAgICAgICBhbWJpZ3VvdXNSb2xlUmVzb2x1dGlvbjogdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmFtYmlndW91c1JvbGVSZXNvbHV0aW9uIHx8ICdEZW55JyxcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpdHlQcm92aWRlcjogaWRlbnRpdHlQcm92aWRlcixcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJQU0gcm9sZSBmb3IgYXV0aGVudGljYXRlZCB1c2VycyBpZiBubyBncm91cHMgYXJlIGRlZmluZWRcbiAgICAgICAgY29uc3QgcG9saWN5RmlsZVBhdGhzID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnBvbGljeUZpbGVQYXRocztcbiAgICAgICAgY29uc3QgYXV0aGVudGljYXRlZFJvbGUgPSBuZXcgQ29nbml0b0F1dGhSb2xlKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LUNvZ25pdG9BdXRoUm9sZWAsIHtcbiAgICAgICAgICAgIGlkZW50aXR5UG9vbDogaWRlbnRpdHlQb29sLFxuICAgICAgICAgICAgcG9saWN5RmlsZVBhdGhzOiBwb2xpY3lGaWxlUGF0aHMsXG4gICAgICAgICAgICBwb2xpY2llczogdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnBvbGljaWVzLFxuICAgICAgICB9KSBhcyBSb2xlO1xuXG4gICAgICAgIC8vIGlmIG5vIGdyb3VwcyBhcmUgZGVmaW5lZCBhbGwgcG9saWNpZXMgYXJlIGFkZGVkIHRvIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZVxuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm9sZScsIGF1dGhlbnRpY2F0ZWRSb2xlLCBgY29nbml0b19kZWZhdWx0YCk7XG5cbiAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZXMgPSB7fTtcbiAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZXMuYXV0aGVudGljYXRlZCA9IGF1dGhlbnRpY2F0ZWRSb2xlLnJvbGVBcm47XG5cbiAgICAgICAgbmV3IENmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LUlkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50YCwgcm9sZUF0dGFjaG1lbnQpO1xuXG4gICAgICAgIC8vIGNyZWF0ZSB0cmlnZ2Vyc1xuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnRyaWdnZXJzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHRyaWdnZXIgb2YgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnRyaWdnZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhVHJpZ2dlciA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS0ke3RyaWdnZXIudHJpZ2dlcn0tbGFtYmRhRnVuY3Rpb25gLCB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnRyaWdnZXIuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbC5hZGRUcmlnZ2VyKHRoaXMubWFwVHJpZ2dlclR5cGUodHJpZ2dlci50cmlnZ2VyKSwgbGFtYmRhVHJpZ2dlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodXNlQXNEZWZhdWx0QXV0aG9yaXplciAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUgPSAnQVdTX0lBTSc7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiRGVmYXVsdCBBdXRob3JpemVyIHNldCB0byBBV1NfSUFNXCIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBtYXBUcmlnZ2VyVHlwZSh0cmlnZ2VyVHlwZTogVHJpZ2dlclR5cGUgfCBVc2VyUG9vbE9wZXJhdGlvbik6IFVzZXJQb29sT3BlcmF0aW9uIHtcblxuICAgICAgICBpZiAodHJpZ2dlclR5cGUgaW5zdGFuY2VvZiBVc2VyUG9vbE9wZXJhdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIHRyaWdnZXJUeXBlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdHJpZ2dlck1hcHBpbmc6IHsgWyBrZXkgaW4gVHJpZ2dlclR5cGUgXTogVXNlclBvb2xPcGVyYXRpb24gfSA9IHtcbiAgICAgICAgICAgIENVU1RPTV9NRVNTQUdFOiBVc2VyUG9vbE9wZXJhdGlvbi5DVVNUT01fTUVTU0FHRSxcbiAgICAgICAgICAgIFBSRV9TSUdOX1VQOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfU0lHTl9VUCxcbiAgICAgICAgICAgIFBPU1RfQ09ORklSTUFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0NPTkZJUk1BVElPTixcbiAgICAgICAgICAgIFBSRV9UT0tFTl9HRU5FUkFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfVE9LRU5fR0VORVJBVElPTixcbiAgICAgICAgICAgIFVTRVJfTUlHUkFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5VU0VSX01JR1JBVElPTixcbiAgICAgICAgICAgIERFRklORV9BVVRIX0NIQUxMRU5HRTogVXNlclBvb2xPcGVyYXRpb24uREVGSU5FX0FVVEhfQ0hBTExFTkdFLFxuICAgICAgICAgICAgQ1JFQVRFX0FVVEhfQ0hBTExFTkdFOiBVc2VyUG9vbE9wZXJhdGlvbi5DUkVBVEVfQVVUSF9DSEFMTEVOR0UsXG4gICAgICAgICAgICBQT1NUX0FVVEhFTlRJQ0FUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0FVVEhFTlRJQ0FUSU9OLFxuICAgICAgICAgICAgUFJFX0FVVEhFTlRJQ0FUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfQVVUSEVOVElDQVRJT04sXG4gICAgICAgICAgICBQUkVfVE9LRU5fR0VORVJBVElPTl9DT05GSUc6IFVzZXJQb29sT3BlcmF0aW9uLlBSRV9UT0tFTl9HRU5FUkFUSU9OX0NPTkZJRyxcbiAgICAgICAgICAgIFZFUklGWV9BVVRIX0NIQUxMRU5HRV9SRVNQT05TRTogVXNlclBvb2xPcGVyYXRpb24uVkVSSUZZX0FVVEhfQ0hBTExFTkdFX1JFU1BPTlNFLFxuICAgICAgICAgICAgQ1VTVE9NX0VNQUlMX1NFTkRFUjogVXNlclBvb2xPcGVyYXRpb24uQ1VTVE9NX0VNQUlMX1NFTkRFUixcbiAgICAgICAgICAgIENVU1RPTV9TTVNfU0VOREVSOiBVc2VyUG9vbE9wZXJhdGlvbi5DVVNUT01fU01TX1NFTkRFUixcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gdHJpZ2dlck1hcHBpbmdbIHRyaWdnZXJUeXBlIF07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVVbmlxdWVVc2VyUG9vbE5hbWUodXNlclBvb2xOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3VzZXJQb29sTmFtZX1gO1xuICAgIH1cblxuICAgIHByaXZhdGUgY29uZmlndXJlU29jaWFsUHJvdmlkZXJzKHVzZXJQb29sOiBVc2VyUG9vbCwgdXNlclBvb2xDbGllbnQ6IFVzZXJQb29sQ2xpZW50LCB1c2VyUG9vbE5hbWU6IHN0cmluZykge1xuICAgICAgICBpZiAoIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uc29jaWFsUHJvdmlkZXJzKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMgPSAnJztcbiAgICAgICAgLy8gQ29uZmlndXJlIEdvb2dsZSBwcm92aWRlciBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uc29jaWFsUHJvdmlkZXJzPy5nb29nbGUpIHtcbiAgICAgICAgICAgIGNvbnN0IHsgY2xpZW50SWQsIGNsaWVudFNlY3JldCwgc2NvcGVzLCBhdHRyaWJ1dGVNYXBwaW5nIH0gPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2wuc29jaWFsUHJvdmlkZXJzLmdvb2dsZTtcblxuICAgICAgICAgICAgY29uc3QgZ29vZ2xlUHJvdmlkZXIgPSBuZXcgVXNlclBvb2xJZGVudGl0eVByb3ZpZGVyR29vZ2xlKHRoaXMubWFpblN0YWNrLCAnR29vZ2xlUHJvdmlkZXInLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2w6IHVzZXJQb29sLFxuICAgICAgICAgICAgICAgIGNsaWVudElkOiBjbGllbnRJZCxcbiAgICAgICAgICAgICAgICBjbGllbnRTZWNyZXQ6IGNsaWVudFNlY3JldCxcbiAgICAgICAgICAgICAgICBzY29wZXM6IHNjb3BlcyB8fCBbICdlbWFpbCcsICdwcm9maWxlJywgJ29wZW5pZCcgXSxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGVNYXBwaW5nOiBhdHRyaWJ1dGVNYXBwaW5nIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW1haWw6IFByb3ZpZGVyQXR0cmlidXRlLkdPT0dMRV9FTUFJTCxcbiAgICAgICAgICAgICAgICAgICAgZW1haWxWZXJpZmllZDogUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0VNQUlMX1ZFUklGSUVELFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB1c2VyUG9vbENsaWVudC5ub2RlLmFkZERlcGVuZGVuY3koZ29vZ2xlUHJvdmlkZXIpO1xuICAgICAgICAgICAgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMgKz0gJ0dvb2dsZSwnO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29uZmlndXJlIEZhY2Vib29rIHByb3ZpZGVyIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5zb2NpYWxQcm92aWRlcnM/LmZhY2Vib29rKSB7XG4gICAgICAgICAgICBjb25zdCB7IGNsaWVudElkLCBjbGllbnRTZWNyZXQsIHNjb3BlcywgYXR0cmlidXRlTWFwcGluZyB9ID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sLnNvY2lhbFByb3ZpZGVycy5mYWNlYm9vaztcblxuICAgICAgICAgICAgY29uc3QgZmFjZWJvb2tQcm92aWRlciA9IG5ldyBVc2VyUG9vbElkZW50aXR5UHJvdmlkZXJGYWNlYm9vayh0aGlzLm1haW5TdGFjaywgJ0ZhY2Vib29rUHJvdmlkZXInLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2wsXG4gICAgICAgICAgICAgICAgY2xpZW50SWQsXG4gICAgICAgICAgICAgICAgY2xpZW50U2VjcmV0LFxuICAgICAgICAgICAgICAgIHNjb3Blczogc2NvcGVzIHx8IFsgJ2VtYWlsJywgJ3B1YmxpY19wcm9maWxlJyBdLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IGF0dHJpYnV0ZU1hcHBpbmcgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbWFpbDogUHJvdmlkZXJBdHRyaWJ1dGUuRkFDRUJPT0tfRU1BSUwsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHVzZXJQb29sQ2xpZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShmYWNlYm9va1Byb3ZpZGVyKTtcbiAgICAgICAgICAgIHN1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzICs9ICdGYWNlYm9vaywnO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ3N1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzJywgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMsIGB1c2VycG9vbF8ke3VzZXJQb29sTmFtZX1gKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbmZpZ3VyZURvbWFpbih1c2VyUG9vbDogVXNlclBvb2wsIHVzZXJQb29sTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIC8vIFNraXAgZG9tYWluIGNvbmZpZ3VyYXRpb24gaWYgbm90IG5lZWRlZFxuICAgICAgICBpZiAoIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uZG9tYWluICYmICF0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnNvY2lhbFByb3ZpZGVycykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZG9tYWluQ29uZmlnID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5kb21haW47XG4gICAgICAgIGxldCBkb21haW46IFVzZXJQb29sRG9tYWluO1xuICAgICAgICBsZXQgZG9tYWluVXJsOiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKGRvbWFpbkNvbmZpZz8uY3VzdG9tRG9tYWluICYmIGRvbWFpbkNvbmZpZy5jdXN0b21Eb21haW4uZG9tYWluTmFtZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBDb25maWd1cmUgY3VzdG9tIGRvbWFpblxuICAgICAgICAgICAgY29uc3QgeyBkb21haW5OYW1lLCBjZXJ0aWZpY2F0ZUFybiB9ID0gZG9tYWluQ29uZmlnLmN1c3RvbURvbWFpbjtcbiAgICAgICAgICAgIGRvbWFpbiA9IG5ldyBVc2VyUG9vbERvbWFpbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1kb21haW5gLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2wsXG4gICAgICAgICAgICAgICAgY3VzdG9tRG9tYWluOiB7XG4gICAgICAgICAgICAgICAgICAgIGRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlOiBDZXJ0aWZpY2F0ZS5mcm9tQ2VydGlmaWNhdGVBcm4odGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tY2VydGAsIGNlcnRpZmljYXRlQXJuKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGRvbWFpblVybCA9IGRvbWFpbk5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBVc2UgQ29nbml0byBkb21haW5cbiAgICAgICAgICAgIGNvbnN0IGRvbWFpblByZWZpeCA9IGRvbWFpbkNvbmZpZz8uY29nbml0b0RvbWFpblByZWZpeCB8fFxuICAgICAgICAgICAgICAgIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3VzZXJQb29sTmFtZX0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudH1gLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTktXS9nLCAnLScpO1xuXG4gICAgICAgICAgICBkb21haW4gPSBuZXcgVXNlclBvb2xEb21haW4odGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tZG9tYWluYCwge1xuICAgICAgICAgICAgICAgIHVzZXJQb29sLFxuICAgICAgICAgICAgICAgIGNvZ25pdG9Eb21haW46IHtcbiAgICAgICAgICAgICAgICAgICAgZG9tYWluUHJlZml4LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZG9tYWluVXJsID0gYCR7ZG9tYWluUHJlZml4fS5hdXRoLiR7dGhpcy5mdzI0LmdldENvbmZpZygpLnJlZ2lvbn0uYW1hem9uY29nbml0by5jb21gO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHRoZSBkb21haW4gVVJMIGFzIGEgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ2F1dGhEb21haW4nLCBkb21haW5VcmwsIGB1c2VycG9vbF8ke3VzZXJQb29sTmFtZX1gKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZUxhbWJkYUF1dGhvcml6ZXIodXNlQXNEZWZhdWx0QXV0aG9yaXplcjogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBpZiAoIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdXRob3JpemVyRnVuY3Rpb24gPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyLnR5cGV9LUN1c3RvbUF1dGhvcml6ZXJgLCB7XG4gICAgICAgICAgICAuLi50aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplci5mdW5jdGlvblByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBhdXRob3JpemVyID0gbmV3IFRva2VuQXV0aG9yaXplcih0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmN1c3RvbUF1dGhvcml6ZXIudHlwZX0tVG9rZW5BdXRob3JpemVyYCwge1xuICAgICAgICAgICAgaGFuZGxlcjogYXV0aG9yaXplckZ1bmN0aW9uIGFzIE5vZGVqc0Z1bmN0aW9uLFxuICAgICAgICAgICAgaWRlbnRpdHlTb3VyY2U6ICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbicsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Snd0QXV0aG9yaXplcihhdXRob3JpemVyLCB1c2VBc0RlZmF1bHRBdXRob3JpemVyKTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyLnR5cGUsIGF1dGhvcml6ZXIsIE91dHB1dFR5cGUuQVVUSE9SSVpFUik7XG5cbiAgICB9XG59XG4iXX0=