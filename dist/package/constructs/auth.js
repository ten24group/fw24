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
        const userPoolConfig = { ...AuthConstructConfigDefaults.userPool?.props, ...this.authConstructConfig.userPool?.props };
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
        const userPoolClientConfig = {
            userPool: userPool,
            ...AuthConstructConfigDefaults.userPoolClient?.props,
            ...this.authConstructConfig.userPoolClient?.props,
        };
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
                const lambdaFunctionProps = {
                    ...autoGroupsAddHandler,
                    ...props
                };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2F1dGgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEseURBZWlDO0FBRWpDLCtEQUF5RjtBQUV6Riw2Q0FBNkQ7QUFDN0QsMkRBQXNEO0FBQ3RELHVEQUF3RTtBQUN4RSx1Q0FBb0M7QUFDcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQUN2RCxrQ0FBaUM7QUFFakMsK0VBQWlFO0FBQ2pFLCtCQUFxQztBQUNyQyxxQ0FBMkM7QUFDM0MsbUNBQXlDO0FBNkt6QyxNQUFNLDJCQUEyQixHQUF5QjtJQUN0RCxRQUFRLEVBQUU7UUFDTixLQUFLLEVBQUU7WUFDSCxpQkFBaUIsRUFBRSxLQUFLO1lBQ3hCLGdCQUFnQixFQUFFO2dCQUNkLFVBQVUsRUFBRSxvQ0FBc0IsQ0FBQyxJQUFJO2FBQzFDO1lBQ0QsVUFBVSxFQUFFO2dCQUNSLEtBQUssRUFBRSxJQUFJO2FBQ2Q7WUFDRCxhQUFhLEVBQUU7Z0JBQ1gsS0FBSyxFQUFFLElBQUk7YUFDZDtZQUNELGNBQWMsRUFBRTtnQkFDWixTQUFTLEVBQUUsQ0FBQztnQkFDWixnQkFBZ0IsRUFBRSxJQUFJO2dCQUN0QixnQkFBZ0IsRUFBRSxJQUFJO2dCQUN0QixhQUFhLEVBQUUsSUFBSTtnQkFDbkIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLG9CQUFvQixFQUFFLHNCQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQzthQUN6QztZQUNELGFBQWEsRUFBRSwyQkFBYSxDQUFDLE1BQU07U0FDdEM7S0FDSjtJQUNELGNBQWMsRUFBRTtRQUNaLEtBQUssRUFBRTtZQUNILGNBQWMsRUFBRSxLQUFLO1lBQ3JCLFNBQVMsRUFBRTtnQkFDUCxZQUFZLEVBQUUsSUFBSTthQUNyQjtTQUNKO0tBQ0o7SUFDRCx1QkFBdUIsRUFBRSxNQUFNO0NBQ2xDLENBQUE7QUFFRCxNQUFhLGFBQWE7SUFxQkY7SUFwQlgsTUFBTSxHQUFH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Q0FBQyxDQUFDO0lBRTFILENBQUM7Q0FDSjtBQTVWRCxzQ0E0VkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICAgIENmbklkZW50aXR5UG9vbCxcbiAgICBDZm5JZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCxcbiAgICBDZm5Vc2VyUG9vbEdyb3VwLFxuICAgIFVzZXJQb29sLFxuICAgIFVzZXJQb29sQ2xpZW50LFxuICAgIFVzZXJQb29sUHJvcHMsXG4gICAgVXNlclBvb2xPcGVyYXRpb24sXG4gICAgVmVyaWZpY2F0aW9uRW1haWxTdHlsZSxcbiAgICBVc2VyUG9vbENsaWVudFByb3BzLFxuICAgIFVzZXJQb29sQ2xpZW50T3B0aW9ucyxcbiAgICBVc2VyUG9vbElkZW50aXR5UHJvdmlkZXJHb29nbGUsXG4gICAgVXNlclBvb2xJZGVudGl0eVByb3ZpZGVyRmFjZWJvb2ssXG4gICAgVXNlclBvb2xEb21haW4sXG4gICAgUHJvdmlkZXJBdHRyaWJ1dGUsXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY29nbml0b1wiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IENvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyLCBUb2tlbkF1dGhvcml6ZXIgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCwgUG9saWN5U3RhdGVtZW50UHJvcHMsIFJvbGUsIFVzZXIgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgRHVyYXRpb24sIFJlbW92YWxQb2xpY3ksIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb2duaXRvQXV0aFJvbGUgfSBmcm9tIFwiLi9jb2duaXRvLWF1dGgtcm9sZVwiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24sIExhbWJkYUZ1bmN0aW9uUHJvcHMgfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIExvZ0R1cmF0aW9uIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgQ2VydGlmaWNhdGUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlclwiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcblxuZXhwb3J0IHR5cGUgVHJpZ2dlclR5cGUgPVxuICAgIHwgJ0NVU1RPTV9NRVNTQUdFJ1xuICAgIHwgJ1BSRV9TSUdOX1VQJ1xuICAgIHwgJ1BPU1RfQ09ORklSTUFUSU9OJ1xuICAgIHwgJ1BSRV9UT0tFTl9HRU5FUkFUSU9OJ1xuICAgIHwgJ1VTRVJfTUlHUkFUSU9OJ1xuICAgIHwgJ0RFRklORV9BVVRIX0NIQUxMRU5HRSdcbiAgICB8ICdDUkVBVEVfQVVUSF9DSEFMTEVOR0UnXG4gICAgfCAnUE9TVF9BVVRIRU5USUNBVElPTidcbiAgICB8ICdQUkVfQVVUSEVOVElDQVRJT04nXG4gICAgfCAnUFJFX1RPS0VOX0dFTkVSQVRJT05fQ09ORklHJ1xuICAgIHwgJ1ZFUklGWV9BVVRIX0NIQUxMRU5HRV9SRVNQT05TRSdcbiAgICB8ICdDVVNUT01fRU1BSUxfU0VOREVSJ1xuICAgIHwgJ0NVU1RPTV9TTVNfU0VOREVSJztcblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGludGVyZmFjZSBmb3Igc29jaWFsIGlkZW50aXR5IHByb3ZpZGVycy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJU29jaWFsUHJvdmlkZXJDb25maWcge1xuICAgIC8qKlxuICAgICAqIE9BdXRoIGNsaWVudCBJRCBmb3IgdGhlIHNvY2lhbCBwcm92aWRlclxuICAgICAqL1xuICAgIGNsaWVudElkOiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogT0F1dGggY2xpZW50IHNlY3JldCBmb3IgdGhlIHNvY2lhbCBwcm92aWRlclxuICAgICAqL1xuICAgIGNsaWVudFNlY3JldDogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIE9wdGlvbmFsIE9BdXRoIHNjb3BlcyB0byByZXF1ZXN0XG4gICAgICovXG4gICAgc2NvcGVzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgYXR0cmlidXRlIG1hcHBpbmcgZnJvbSBwcm92aWRlciB0byBDb2duaXRvXG4gICAgICovXG4gICAgYXR0cmlidXRlTWFwcGluZz86IHtcbiAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmc7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgQ29nbml0byBkb21haW5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRG9tYWluQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZG9tYWluIHByZWZpeCBmb3IgQ29nbml0byBob3N0ZWQgVUkuXG4gICAgICogSWYgdXNpbmcgYSBjdXN0b20gZG9tYWluLCB0aGlzIGlzIGlnbm9yZWQuXG4gICAgICovXG4gICAgY29nbml0b0RvbWFpblByZWZpeD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBDb25maWd1cmF0aW9uIGZvciBhIGN1c3RvbSBkb21haW5cbiAgICAgKi9cbiAgICBjdXN0b21Eb21haW4/OiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgZG9tYWluIG5hbWUgdG8gdXNlIChlLmcuICdhdXRoLmV4YW1wbGUuY29tJylcbiAgICAgICAgICovXG4gICAgICAgIGRvbWFpbk5hbWU6IHN0cmluZztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBBUk4gb2YgYW4gZXhpc3RpbmcgQUNNIGNlcnRpZmljYXRlIGZvciB0aGUgZG9tYWluXG4gICAgICAgICAqL1xuICAgICAgICBjZXJ0aWZpY2F0ZUFybjogc3RyaW5nO1xuICAgIH07XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBpbnRlcmZhY2UgZm9yIHRoZSBBdXRoQ29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElBdXRoQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIFVzZXIgUG9vbC5cbiAgICAgKi9cbiAgICB1c2VyUG9vbD86IHtcbiAgICAgICAgcHJvcHM6IFVzZXJQb29sUHJvcHM7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBEb21haW4gY29uZmlndXJhdGlvbiBmb3IgdGhlIHVzZXIgcG9vbC5cbiAgICAgICAgICogUmVxdWlyZWQgZm9yIHNvY2lhbCBzaWduLWluIGFuZCBob3N0ZWQgVUkgZmVhdHVyZXMuXG4gICAgICAgICAqL1xuICAgICAgICBkb21haW4/OiBJRG9tYWluQ29uZmlnO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3Igc29jaWFsIGlkZW50aXR5IHByb3ZpZGVycy5cbiAgICAgICAgICogV2hlbiBjb25maWd1cmVkLCBPQXV0aCBmbG93cyBhcmUgYXV0b21hdGljYWxseSBlbmFibGVkIHdpdGggYXBwcm9wcmlhdGUgc2V0dGluZ3MuXG4gICAgICAgICAqL1xuICAgICAgICBzb2NpYWxQcm92aWRlcnM/OiB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEdvb2dsZSBpZGVudGl0eSBwcm92aWRlciBjb25maWd1cmF0aW9uXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGdvb2dsZT86IElTb2NpYWxQcm92aWRlckNvbmZpZztcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogRmFjZWJvb2sgaWRlbnRpdHkgcHJvdmlkZXIgY29uZmlndXJhdGlvblxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBmYWNlYm9vaz86IElTb2NpYWxQcm92aWRlckNvbmZpZztcbiAgICAgICAgfTtcbiAgICB9O1xuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBVc2VyIFBvb2wgQ2xpZW50LlxuICAgICAqL1xuICAgIHVzZXJQb29sQ2xpZW50Pzoge1xuICAgICAgICBwcm9wczogVXNlclBvb2xDbGllbnRPcHRpb25zO1xuICAgIH07XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgcG9saWNpZXMgdG8gYXR0YWNoIHRvIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZS5cbiAgICAgKi9cbiAgICBwb2xpY2llcz86IEFycmF5PFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PjtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBmaWxlIHBhdGhzIGZvciBwb2xpY3kgZmlsZXMuXG4gICAgICovXG4gICAgcG9saWN5RmlsZVBhdGhzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgdHJpZ2dlcnMgZm9yIHVzZXIgcG9vbCBvcGVyYXRpb25zLlxuICAgICAqL1xuICAgIHRyaWdnZXJzPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHVzZXIgcG9vbCBvcGVyYXRpb24gdGhhdCB0cmlnZ2VycyB0aGUgZnVuY3Rpb24uXG4gICAgICAgICAqL1xuICAgICAgICB0cmlnZ2VyOiBVc2VyUG9vbE9wZXJhdGlvbiB8IFRyaWdnZXJUeXBlO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHM7XG4gICAgfVtdO1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGdyb3VwcyBmb3IgdGhlIEF1dGhDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgZ3JvdXBzPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIG5hbWUgb2YgdGhlIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHByZWNlZGVuY2Ugb2YgdGhlIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgcHJlY2VkZW5jZT86IG51bWJlcjtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIHBvbGljaWVzIHRvIGF0dGFjaCB0byB0aGUgZ3JvdXAuXG4gICAgICAgICAqL1xuICAgICAgICBwb2xpY2llcz86IEFycmF5PFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PjtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIGZpbGUgcGF0aHMgZm9yIHBvbGljeSBmaWxlcyBzcGVjaWZpYyB0byB0aGlzIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgcG9saWN5RmlsZVBhdGhzPzogc3RyaW5nW107XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBGbGFnIGluZGljYXRpbmcgd2hldGhlciB0aGUgdXNlciBzaG91bGQgYmUgYXV0b21hdGljYWxseSBzaWduZWQgdXAgdG8gdGhpcyBncm91cCBkdXJpbmcgc2lnbnVwLlxuICAgICAgICAgKi9cbiAgICAgICAgYXV0b1VzZXJTaWdudXA/OiBib29sZWFuO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbiB0aGF0IGhhbmRsZXMgYXV0b21hdGljIHVzZXIgc2lnbnVwLlxuICAgICAgICAgKi9cbiAgICAgICAgYXV0b1VzZXJTaWdudXBIYW5kbGVyPzogTGFtYmRhRnVuY3Rpb25Qcm9wcztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIHJvdXRlcyBwcm90ZWN0ZWQgYnkgdGhpcyBncm91cC5cbiAgICAgICAgICovXG4gICAgICAgIHJvdXRlcz86IHN0cmluZ1tdO1xuICAgIH1bXTtcbiAgICAvKipcbiAgICAgKiBGbGFnIGluZGljYXRpbmcgd2hldGhlciB0byB1c2UgdGhpcyBBdXRoQ29uc3RydWN0IGFzIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXIuXG4gICAgICovXG4gICAgdXNlQXNEZWZhdWx0QXV0aG9yaXplcj86IGJvb2xlYW47XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhdGlvbiBmb3IgYSBjdXN0b20gTGFtYmRhIGF1dGhvcml6ZXIuXG4gICAgICovXG4gICAgY3VzdG9tQXV0aG9yaXplcj86IHtcbiAgICAgICAgdHlwZTogc3RyaW5nO1xuICAgICAgICBmdW5jdGlvblByb3BzOiBMYW1iZGFGdW5jdGlvblByb3BzO1xuICAgIH07XG4gICAgLyoqXG4gICAgICogSG93IHRvIHJlc29sdmUgYW1iaWd1b3VzIHJvbGUgYXNzaWdubWVudHMuXG4gICAgICogRGVmYXVsdHMgdG8gXCJVc2VEZWZhdWx0Um9sZVwiIHdoaWNoIHdpbGwgdXNlIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZSB3aGVuIHRoZXJlJ3MgYW1iaWd1aXR5LlxuICAgICAqIENhbiBiZSBzZXQgdG8gXCJEZW55XCIgdG8gZGVueSBhY2Nlc3Mgd2hlbiB0aGVyZSdzIGFtYmlndWl0eS5cbiAgICAgKi9cbiAgICBhbWJpZ3VvdXNSb2xlUmVzb2x1dGlvbj86ICdVc2VEZWZhdWx0Um9sZScgfCAnRGVueSc7XG59XG5cbmNvbnN0IEF1dGhDb25zdHJ1Y3RDb25maWdEZWZhdWx0czogSUF1dGhDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgdXNlclBvb2w6IHtcbiAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHNlbGZTaWduVXBFbmFibGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHVzZXJWZXJpZmljYXRpb246IHtcbiAgICAgICAgICAgICAgICBlbWFpbFN0eWxlOiBWZXJpZmljYXRpb25FbWFpbFN0eWxlLkNPREUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYXV0b1ZlcmlmeToge1xuICAgICAgICAgICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICAgICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICAgICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgICAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcbiAgICAgICAgICAgICAgICB0ZW1wUGFzc3dvcmRWYWxpZGl0eTogRHVyYXRpb24uZGF5cygzKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgfVxuICAgIH0sXG4gICAgdXNlclBvb2xDbGllbnQ6IHtcbiAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgICAgICAgIGF1dGhGbG93czoge1xuICAgICAgICAgICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgYW1iaWd1b3VzUm9sZVJlc29sdXRpb246ICdEZW55J1xufVxuXG5leHBvcnQgY2xhc3MgQXV0aENvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihBdXRoQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBBdXRoQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIE1haWxlckNvbnN0cnVjdC5uYW1lLCBMYXllckNvbnN0cnVjdC5uYW1lIF07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlIGEgbmV3IEF1dGhDb25zdHJ1Y3QuXG4gICAgICogQHBhcmFtIGF1dGhDb25zdHJ1Y3RDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBvYmplY3QgZm9yIHRoZSBBdXRoIGNvbnN0cnVjdC5cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIC8vIENyZWF0ZSBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgQXV0aCBjbGFzc1xuICAgICAqIGNvbnN0IGF1dGhDb25maWc6IElBdXRoQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAqICAgLy8gUHJvdmlkZSB0aGUgbmVjZXNzYXJ5IGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICAgICAqICAgLy8gLi4uXG4gICAgICogfTtcbiAgICAgKiBjb25zdCBhdXRoID0gbmV3IEF1dGgoYXV0aENvbmZpZyk7XG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBhdXRoQ29uc3RydWN0Q29uZmlnOiBJQXV0aENvbnN0cnVjdENvbmZpZykge1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhhdXRoQ29uc3RydWN0Q29uZmlnLCAnQ09HTklUTycpO1xuICAgIH1cblxuICAgIC8vIGNvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFja1xuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiY29uc3RydWN0XCIpO1xuXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplcj8udHlwZSA9PT0gJ2p3dCcpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlTGFtYmRhQXV0aG9yaXplcih0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlQXNEZWZhdWx0QXV0aG9yaXplciB8fCBmYWxzZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1c2VyUG9vbENvbmZpZyA9IHsgLi4uQXV0aENvbnN0cnVjdENvbmZpZ0RlZmF1bHRzLnVzZXJQb29sPy5wcm9wcywgLi4udGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5wcm9wcyB9O1xuICAgICAgICBjb25zdCB1c2VyUG9vbE5hbWUgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnByb3BzPy51c2VyUG9vbE5hbWUgfHwgJ2RlZmF1bHQnO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQ3JlYXRpbmcgdXNlciBwb29sOiBcIiwgdXNlclBvb2xOYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJ1c2VyIHBvb2wgY29uZmlnOiBcIiwgdXNlclBvb2xOYW1lLCB1c2VyUG9vbENvbmZpZyk7XG5cbiAgICAgICAgaWYgKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRPRE86IEFkZCBhYmlsaXR5IHRvIGNyZWF0ZSBtdWx0aS10ZW5hbnQgdXNlciBwb29sc1xuICAgICAgICBjb25zdCB1c2VyUG9vbDogVXNlclBvb2wgPSBuZXcgVXNlclBvb2wodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tdXNlclBvb2xgLCB7XG4gICAgICAgICAgICAuLi51c2VyUG9vbENvbmZpZyxcbiAgICAgICAgICAgIHVzZXJQb29sTmFtZTogdGhpcy5jcmVhdGVVbmlxdWVVc2VyUG9vbE5hbWUodXNlclBvb2xOYW1lKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ29uZmlndXJlIGRvbWFpbiBpZiBzcGVjaWZpZWQgb3IgaWYgc29jaWFsIHByb3ZpZGVycyBhcmUgZW5hYmxlZFxuICAgICAgICB0aGlzLmNvbmZpZ3VyZURvbWFpbih1c2VyUG9vbCwgdXNlclBvb2xOYW1lKTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHVzZXJQb29sTmFtZSwgdXNlclBvb2wsIE91dHB1dFR5cGUuVVNFUlBPT0wsICd1c2VyUG9vbElkJyk7XG5cbiAgICAgICAgY29uc3QgdXNlclBvb2xDbGllbnRDb25maWc6IFVzZXJQb29sQ2xpZW50UHJvcHMgPSB7XG4gICAgICAgICAgICB1c2VyUG9vbDogdXNlclBvb2wsXG4gICAgICAgICAgICAuLi5BdXRoQ29uc3RydWN0Q29uZmlnRGVmYXVsdHMudXNlclBvb2xDbGllbnQ/LnByb3BzLFxuICAgICAgICAgICAgLi4udGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sQ2xpZW50Py5wcm9wcyxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBVc2VyUG9vbENsaWVudCh0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS11c2VyUG9vbGNsaWVudGAsIHVzZXJQb29sQ2xpZW50Q29uZmlnKTtcblxuICAgICAgICAvLyBDb25maWd1cmUgc29jaWFsIHByb3ZpZGVycyBpZiBzcGVjaWZpZWRcbiAgICAgICAgdGhpcy5jb25maWd1cmVTb2NpYWxQcm92aWRlcnModXNlclBvb2wsIHVzZXJQb29sQ2xpZW50LCB1c2VyUG9vbE5hbWUpO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdXNlclBvb2xOYW1lLCB1c2VyUG9vbENsaWVudCwgT3V0cHV0VHlwZS5VU0VSUE9PTENMSUVOVCwgJ3VzZXJQb29sQ2xpZW50SWQnKTtcblxuICAgICAgICAvLyBJZGVudGl0eSBwb29sIGJhc2VkIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzIHx8IHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5wb2xpY3lGaWxlUGF0aHMgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSA9PSAnQVdTX0lBTScpIHtcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlSWRlbnRpdHlQb29sQXV0aG9yaXplcih1c2VyUG9vbCwgdXNlclBvb2xDbGllbnQsIHVzZXJQb29sTmFtZSwgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZUFzRGVmYXVsdEF1dGhvcml6ZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gdXNlciBwb29sIGJhc2UgYXV0aGVudGljYXRpb25cbiAgICAgICAgICAgIHRoaXMuY3JlYXRlVXNlclBvb2xBdXRob3JpemVyKHVzZXJQb29sLCB1c2VyUG9vbE5hbWUsIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyKTtcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVVc2VyUG9vbEF1dGhvcml6ZXIodXNlclBvb2w6IFVzZXJQb29sLCB1c2VyUG9vbE5hbWU6IHN0cmluZywgdXNlQXNEZWZhdWx0QXV0aG9yaXplcjogYm9vbGVhbikge1xuICAgICAgICAvLyBjb2duaXRvIGF1dGhvcml6ZXIgXG4gICAgICAgIGNvbnN0IHVzZXJQb29sQXV0aG9yaXplciA9IG5ldyBDb2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1BdXRob3JpemVyYCwge1xuICAgICAgICAgICAgY29nbml0b1VzZXJQb29sczogWyB1c2VyUG9vbCBdLFxuICAgICAgICAgICAgaWRlbnRpdHlTb3VyY2U6ICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb2duaXRvQXV0aG9yaXplcihcbiAgICAgICAgICAgIHVzZXJQb29sTmFtZSxcbiAgICAgICAgICAgIHVzZXJQb29sQXV0aG9yaXplcixcbiAgICAgICAgICAgIC8vIFRPRE86IGJldHRlciBsb2dpYyB0byBjb250cm9sIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXJcbiAgICAgICAgICAgIHVzZUFzRGVmYXVsdEF1dGhvcml6ZXJcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAodXNlQXNEZWZhdWx0QXV0aG9yaXplciAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUgPSAnQ09HTklUT19VU0VSX1BPT0xTJztcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKHVzZXJQb29sTmFtZSk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiRGVmYXVsdCBBdXRob3JpemVyIHNldCB0byBDT0dOSVRPX1VTRVJfUE9PTFNcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZUlkZW50aXR5UG9vbEF1dGhvcml6ZXIodXNlclBvb2w6IFVzZXJQb29sLCB1c2VyUG9vbENsaWVudDogVXNlclBvb2xDbGllbnQsIHVzZXJQb29sTmFtZTogc3RyaW5nLCB1c2VBc0RlZmF1bHRBdXRob3JpemVyOiBib29sZWFuKSB7XG5cbiAgICAgICAgY29uc3QgaWRlbnRpdHlQb29sID0gbmV3IENmbklkZW50aXR5UG9vbCh0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1pZGVudGl0eVBvb2xgLCB7XG4gICAgICAgICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IHRydWUsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQcm92aWRlcnM6IFsge1xuICAgICAgICAgICAgICAgIGNsaWVudElkOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICAgICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICAgICAgICB9IF0sXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHVzZXJQb29sTmFtZSwgaWRlbnRpdHlQb29sLCBPdXRwdXRUeXBlLklERU5USVRZUE9PTCwgJ3JlZicsICdpZGVudGl0eVBvb2xJZCcpO1xuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBpZGVudGl0eSBwb29sIHJvbGUgYXR0YWNobWVudFxuICAgICAgICBjb25zdCBpZGVudGl0eVByb3ZpZGVyID0gdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUgKyAnOicgKyB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkO1xuICAgICAgICBjb25zdCByb2xlQXR0YWNobWVudDogYW55ID0ge1xuICAgICAgICAgICAgaWRlbnRpdHlQb29sSWQ6IGlkZW50aXR5UG9vbC5yZWYsXG4gICAgICAgIH1cblxuICAgICAgICAvLyBjcmVhdGUgdXNlciBwb29sIGdyb3Vwc1xuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcykge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBOYW1lcyA9IHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5ncm91cHMubWFwKGdyb3VwID0+IGdyb3VwLm5hbWUpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0dyb3VwcycsIGdyb3VwTmFtZXMsICdjb2duaXRvJyk7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnYXV0aEdyb3VwcycsIGdyb3VwTmFtZXMuam9pbignLCcpLCBgdXNlcnBvb2xfJHt1c2VyUG9vbE5hbWV9YCk7XG4gICAgICAgICAgICAvL3RoaXMuZncyNC5zZXQoJ0F1dG9Vc2VyU2lnbnVwR3JvdXBzJywgdGhpcy5hdXRoQ29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5uYW1lKS50b1N0cmluZygpLCB1c2VyUG9vbE5hbWUpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgLy8gY3JlYXRlIGEgcm9sZSBmb3IgdGhlIGdyb3VwXG4gICAgICAgICAgICAgICAgY29uc3QgcG9saWN5RmlsZVBhdGhzID0gZ3JvdXAucG9saWN5RmlsZVBhdGhzO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJvbGUgPSBuZXcgQ29nbml0b0F1dGhSb2xlKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LSR7Z3JvdXAubmFtZX0tQ29nbml0b0F1dGhSb2xlYCwge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eVBvb2w6IGlkZW50aXR5UG9vbCxcbiAgICAgICAgICAgICAgICAgICAgcG9saWN5RmlsZVBhdGhzOiBwb2xpY3lGaWxlUGF0aHMsXG4gICAgICAgICAgICAgICAgICAgIHBvbGljaWVzOiBncm91cC5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICB9KSBhcyBSb2xlO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ1JvbGUnLCByb2xlLCBgY29nbml0b18ke2dyb3VwLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ1JvdXRlcycsIGdyb3VwLnJvdXRlcywgYGNvZ25pdG9fJHtncm91cC5uYW1lfWApO1xuXG4gICAgICAgICAgICAgICAgbmV3IENmblVzZXJQb29sR3JvdXAodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tJHtncm91cC5uYW1lfS1ncm91cGAsIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBOYW1lOiBncm91cC5uYW1lLFxuICAgICAgICAgICAgICAgICAgICB1c2VyUG9vbElkOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgICAgICAgICAgICByb2xlQXJuOiByb2xlLnJvbGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHByZWNlZGVuY2U6IGdyb3VwLnByZWNlZGVuY2UgfHwgMCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGF1dG9Vc2VyU2lnbnVwR3JvdXBzID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5uYW1lKS50b1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3QgYXV0b1VzZXJTaWdudXBHcm91cHNIYW5kbGVyID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5hdXRvVXNlclNpZ251cEhhbmRsZXIpO1xuXG4gICAgICAgICAgICAvLyBOb3RlOiBvbmx5IG9uZSBhdXRvIHNpZ251cCBoYW5kbGVyIGlzIHN1cHBvcnRlZCwgcGljayB0aGUgZmlyc3Qgb25lXG4gICAgICAgICAgICBjb25zdCBhdXRvR3JvdXBzQWRkSGFuZGxlciA9IGF1dG9Vc2VyU2lnbnVwR3JvdXBzSGFuZGxlclsgMCBdIHx8ICcnO1xuXG4gICAgICAgICAgICBpZiAoYXV0b1VzZXJTaWdudXBHcm91cHMgJiYgYXV0b0dyb3Vwc0FkZEhhbmRsZXIpIHtcbiAgICAgICAgICAgICAgICAvLyBjcmVhdGUgYSBwb3N0IGNvbmZpcm1hdGlvbiB0cmlnZ2VyIHRvIGFkZCB1c2VycyB0byBhdXRvIHNpZ251cCBncm91cHNcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9wcyA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF1dG9TaWdudXBHcm91cHM6IGF1dG9Vc2VyU2lnbnVwR3JvdXBzLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsgJ2NvZ25pdG8taWRwOkFkbWluQWRkVXNlclRvR3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbICcqJyBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uUHJvcHMgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmF1dG9Hcm91cHNBZGRIYW5kbGVyLFxuICAgICAgICAgICAgICAgICAgICAuLi5wcm9wc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImF1dG9Vc2VyU2lnbnVwR3JvdXBzSGFuZGxlcjogXCIsIGxhbWJkYUZ1bmN0aW9uUHJvcHMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhbWJkYVRyaWdnZXIgPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tYXV0by1wb3N0LWNvbmZpcm1hdGlvbi1sYW1iZGFGdW5jdGlvbmAsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubGFtYmRhRnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbC5hZGRUcmlnZ2VyKFVzZXJQb29sT3BlcmF0aW9uLlBPU1RfQ09ORklSTUFUSU9OLCBsYW1iZGFUcmlnZ2VyKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gY29uZmlndXJlIHJvbGUgbWFwcGluZ1xuICAgICAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZU1hcHBpbmdzID0ge1xuICAgICAgICAgICAgICAgIFwidXNlcnBvb2xcIjoge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcIlRva2VuXCIsXG4gICAgICAgICAgICAgICAgICAgIGFtYmlndW91c1JvbGVSZXNvbHV0aW9uOiB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuYW1iaWd1b3VzUm9sZVJlc29sdXRpb24gfHwgJ0RlbnknLFxuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eVByb3ZpZGVyOiBpZGVudGl0eVByb3ZpZGVyLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElBTSByb2xlIGZvciBhdXRoZW50aWNhdGVkIHVzZXJzIGlmIG5vIGdyb3VwcyBhcmUgZGVmaW5lZFxuICAgICAgICBjb25zdCBwb2xpY3lGaWxlUGF0aHMgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcucG9saWN5RmlsZVBhdGhzO1xuICAgICAgICBjb25zdCBhdXRoZW50aWNhdGVkUm9sZSA9IG5ldyBDb2duaXRvQXV0aFJvbGUodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tQ29nbml0b0F1dGhSb2xlYCwge1xuICAgICAgICAgICAgaWRlbnRpdHlQb29sOiBpZGVudGl0eVBvb2wsXG4gICAgICAgICAgICBwb2xpY3lGaWxlUGF0aHM6IHBvbGljeUZpbGVQYXRocyxcbiAgICAgICAgICAgIHBvbGljaWVzOiB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcucG9saWNpZXMsXG4gICAgICAgIH0pIGFzIFJvbGU7XG5cbiAgICAgICAgLy8gaWYgbm8gZ3JvdXBzIGFyZSBkZWZpbmVkIGFsbCBwb2xpY2llcyBhcmUgYWRkZWQgdG8gdGhlIGRlZmF1bHQgYXV0aGVudGljYXRlZCByb2xlXG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdSb2xlJywgYXV0aGVudGljYXRlZFJvbGUsIGBjb2duaXRvX2RlZmF1bHRgKTtcblxuICAgICAgICByb2xlQXR0YWNobWVudC5yb2xlcyA9IHt9O1xuICAgICAgICByb2xlQXR0YWNobWVudC5yb2xlcy5hdXRoZW50aWNhdGVkID0gYXV0aGVudGljYXRlZFJvbGUucm9sZUFybjtcblxuICAgICAgICBuZXcgQ2ZuSWRlbnRpdHlQb29sUm9sZUF0dGFjaG1lbnQodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tSWRlbnRpdHlQb29sUm9sZUF0dGFjaG1lbnRgLCByb2xlQXR0YWNobWVudCk7XG5cbiAgICAgICAgLy8gY3JlYXRlIHRyaWdnZXJzXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudHJpZ2dlcnMpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgdHJpZ2dlciBvZiB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudHJpZ2dlcnMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBsYW1iZGFUcmlnZ2VyID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LSR7dHJpZ2dlci50cmlnZ2VyfS1sYW1iZGFGdW5jdGlvbmAsIHtcbiAgICAgICAgICAgICAgICAgICAgLi4udHJpZ2dlci5mdW5jdGlvblByb3BzLFxuICAgICAgICAgICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuICAgICAgICAgICAgICAgIHVzZXJQb29sLmFkZFRyaWdnZXIodGhpcy5tYXBUcmlnZ2VyVHlwZSh0cmlnZ2VyLnRyaWdnZXIpLCBsYW1iZGFUcmlnZ2VyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh1c2VBc0RlZmF1bHRBdXRob3JpemVyICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSA9ICdBV1NfSUFNJztcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJEZWZhdWx0IEF1dGhvcml6ZXIgc2V0IHRvIEFXU19JQU1cIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIG1hcFRyaWdnZXJUeXBlKHRyaWdnZXJUeXBlOiBUcmlnZ2VyVHlwZSB8IFVzZXJQb29sT3BlcmF0aW9uKTogVXNlclBvb2xPcGVyYXRpb24ge1xuXG4gICAgICAgIGlmICh0cmlnZ2VyVHlwZSBpbnN0YW5jZW9mIFVzZXJQb29sT3BlcmF0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJpZ2dlclR5cGU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0cmlnZ2VyTWFwcGluZzogeyBbIGtleSBpbiBUcmlnZ2VyVHlwZSBdOiBVc2VyUG9vbE9wZXJhdGlvbiB9ID0ge1xuICAgICAgICAgICAgQ1VTVE9NX01FU1NBR0U6IFVzZXJQb29sT3BlcmF0aW9uLkNVU1RPTV9NRVNTQUdFLFxuICAgICAgICAgICAgUFJFX1NJR05fVVA6IFVzZXJQb29sT3BlcmF0aW9uLlBSRV9TSUdOX1VQLFxuICAgICAgICAgICAgUE9TVF9DT05GSVJNQVRJT046IFVzZXJQb29sT3BlcmF0aW9uLlBPU1RfQ09ORklSTUFUSU9OLFxuICAgICAgICAgICAgUFJFX1RPS0VOX0dFTkVSQVRJT046IFVzZXJQb29sT3BlcmF0aW9uLlBSRV9UT0tFTl9HRU5FUkFUSU9OLFxuICAgICAgICAgICAgVVNFUl9NSUdSQVRJT046IFVzZXJQb29sT3BlcmF0aW9uLlVTRVJfTUlHUkFUSU9OLFxuICAgICAgICAgICAgREVGSU5FX0FVVEhfQ0hBTExFTkdFOiBVc2VyUG9vbE9wZXJhdGlvbi5ERUZJTkVfQVVUSF9DSEFMTEVOR0UsXG4gICAgICAgICAgICBDUkVBVEVfQVVUSF9DSEFMTEVOR0U6IFVzZXJQb29sT3BlcmF0aW9uLkNSRUFURV9BVVRIX0NIQUxMRU5HRSxcbiAgICAgICAgICAgIFBPU1RfQVVUSEVOVElDQVRJT046IFVzZXJQb29sT3BlcmF0aW9uLlBPU1RfQVVUSEVOVElDQVRJT04sXG4gICAgICAgICAgICBQUkVfQVVUSEVOVElDQVRJT046IFVzZXJQb29sT3BlcmF0aW9uLlBSRV9BVVRIRU5USUNBVElPTixcbiAgICAgICAgICAgIFBSRV9UT0tFTl9HRU5FUkFUSU9OX0NPTkZJRzogVXNlclBvb2xPcGVyYXRpb24uUFJFX1RPS0VOX0dFTkVSQVRJT05fQ09ORklHLFxuICAgICAgICAgICAgVkVSSUZZX0FVVEhfQ0hBTExFTkdFX1JFU1BPTlNFOiBVc2VyUG9vbE9wZXJhdGlvbi5WRVJJRllfQVVUSF9DSEFMTEVOR0VfUkVTUE9OU0UsXG4gICAgICAgICAgICBDVVNUT01fRU1BSUxfU0VOREVSOiBVc2VyUG9vbE9wZXJhdGlvbi5DVVNUT01fRU1BSUxfU0VOREVSLFxuICAgICAgICAgICAgQ1VTVE9NX1NNU19TRU5ERVI6IFVzZXJQb29sT3BlcmF0aW9uLkNVU1RPTV9TTVNfU0VOREVSLFxuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiB0cmlnZ2VyTWFwcGluZ1sgdHJpZ2dlclR5cGUgXTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZVVuaXF1ZVVzZXJQb29sTmFtZSh1c2VyUG9vbE5hbWU6IHN0cmluZykge1xuICAgICAgICByZXR1cm4gYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7dXNlclBvb2xOYW1lfWA7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb25maWd1cmVTb2NpYWxQcm92aWRlcnModXNlclBvb2w6IFVzZXJQb29sLCB1c2VyUG9vbENsaWVudDogVXNlclBvb2xDbGllbnQsIHVzZXJQb29sTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIGlmICghdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5zb2NpYWxQcm92aWRlcnMpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVycyA9ICcnO1xuICAgICAgICAvLyBDb25maWd1cmUgR29vZ2xlIHByb3ZpZGVyIGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5zb2NpYWxQcm92aWRlcnM/Lmdvb2dsZSkge1xuICAgICAgICAgICAgY29uc3QgeyBjbGllbnRJZCwgY2xpZW50U2VjcmV0LCBzY29wZXMsIGF0dHJpYnV0ZU1hcHBpbmcgfSA9IHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbC5zb2NpYWxQcm92aWRlcnMuZ29vZ2xlO1xuXG4gICAgICAgICAgICBjb25zdCBnb29nbGVQcm92aWRlciA9IG5ldyBVc2VyUG9vbElkZW50aXR5UHJvdmlkZXJHb29nbGUodGhpcy5tYWluU3RhY2ssICdHb29nbGVQcm92aWRlcicsIHtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbDogdXNlclBvb2wsXG4gICAgICAgICAgICAgICAgY2xpZW50SWQ6IGNsaWVudElkLFxuICAgICAgICAgICAgICAgIGNsaWVudFNlY3JldDogY2xpZW50U2VjcmV0LFxuICAgICAgICAgICAgICAgIHNjb3Blczogc2NvcGVzIHx8IFsgJ2VtYWlsJywgJ3Byb2ZpbGUnLCAnb3BlbmlkJyBdLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IGF0dHJpYnV0ZU1hcHBpbmcgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbWFpbDogUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0VNQUlMLFxuICAgICAgICAgICAgICAgICAgICBlbWFpbFZlcmlmaWVkOiBQcm92aWRlckF0dHJpYnV0ZS5HT09HTEVfRU1BSUxfVkVSSUZJRUQsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHVzZXJQb29sQ2xpZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShnb29nbGVQcm92aWRlcik7XG4gICAgICAgICAgICBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVycyArPSAnR29vZ2xlLCc7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb25maWd1cmUgRmFjZWJvb2sgcHJvdmlkZXIgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnNvY2lhbFByb3ZpZGVycz8uZmFjZWJvb2spIHtcbiAgICAgICAgICAgIGNvbnN0IHsgY2xpZW50SWQsIGNsaWVudFNlY3JldCwgc2NvcGVzLCBhdHRyaWJ1dGVNYXBwaW5nIH0gPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2wuc29jaWFsUHJvdmlkZXJzLmZhY2Vib29rO1xuXG4gICAgICAgICAgICBjb25zdCBmYWNlYm9va1Byb3ZpZGVyID0gbmV3IFVzZXJQb29sSWRlbnRpdHlQcm92aWRlckZhY2Vib29rKHRoaXMubWFpblN0YWNrLCAnRmFjZWJvb2tQcm92aWRlcicsIHtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbCxcbiAgICAgICAgICAgICAgICBjbGllbnRJZCxcbiAgICAgICAgICAgICAgICBjbGllbnRTZWNyZXQsXG4gICAgICAgICAgICAgICAgc2NvcGVzOiBzY29wZXMgfHwgWyAnZW1haWwnLCAncHVibGljX3Byb2ZpbGUnIF0sXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlTWFwcGluZzogYXR0cmlidXRlTWFwcGluZyB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVtYWlsOiBQcm92aWRlckF0dHJpYnV0ZS5GQUNFQk9PS19FTUFJTCxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdXNlclBvb2xDbGllbnQubm9kZS5hZGREZXBlbmRlbmN5KGZhY2Vib29rUHJvdmlkZXIpO1xuICAgICAgICAgICAgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMgKz0gJ0ZhY2Vib29rLCc7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMnLCBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVycywgYHVzZXJwb29sXyR7dXNlclBvb2xOYW1lfWApO1xuICAgIH1cblxuICAgIHByaXZhdGUgY29uZmlndXJlRG9tYWluKHVzZXJQb29sOiBVc2VyUG9vbCwgdXNlclBvb2xOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgICAgLy8gU2tpcCBkb21haW4gY29uZmlndXJhdGlvbiBpZiBub3QgbmVlZGVkXG4gICAgICAgIGlmICghdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5kb21haW4gJiYgIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uc29jaWFsUHJvdmlkZXJzKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkb21haW5Db25maWcgPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LmRvbWFpbjtcbiAgICAgICAgbGV0IGRvbWFpbjogVXNlclBvb2xEb21haW47XG4gICAgICAgIGxldCBkb21haW5Vcmw6IHN0cmluZztcblxuICAgICAgICBpZiAoZG9tYWluQ29uZmlnPy5jdXN0b21Eb21haW4gJiYgZG9tYWluQ29uZmlnLmN1c3RvbURvbWFpbi5kb21haW5OYW1lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIENvbmZpZ3VyZSBjdXN0b20gZG9tYWluXG4gICAgICAgICAgICBjb25zdCB7IGRvbWFpbk5hbWUsIGNlcnRpZmljYXRlQXJuIH0gPSBkb21haW5Db25maWcuY3VzdG9tRG9tYWluO1xuICAgICAgICAgICAgZG9tYWluID0gbmV3IFVzZXJQb29sRG9tYWluKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LWRvbWFpbmAsIHtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbCxcbiAgICAgICAgICAgICAgICBjdXN0b21Eb21haW46IHtcbiAgICAgICAgICAgICAgICAgICAgZG9tYWluTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgY2VydGlmaWNhdGU6IENlcnRpZmljYXRlLmZyb21DZXJ0aWZpY2F0ZUFybih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1jZXJ0YCwgY2VydGlmaWNhdGVBcm4pLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZG9tYWluVXJsID0gZG9tYWluTmFtZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFVzZSBDb2duaXRvIGRvbWFpblxuICAgICAgICAgICAgY29uc3QgZG9tYWluUHJlZml4ID0gZG9tYWluQ29uZmlnPy5jb2duaXRvRG9tYWluUHJlZml4IHx8XG4gICAgICAgICAgICAgICAgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7dXNlclBvb2xOYW1lfS0ke3RoaXMuZncyNC5nZXRDb25maWcoKS5hY2NvdW50fWAudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOS1dL2csICctJyk7XG5cbiAgICAgICAgICAgIGRvbWFpbiA9IG5ldyBVc2VyUG9vbERvbWFpbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1kb21haW5gLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2wsXG4gICAgICAgICAgICAgICAgY29nbml0b0RvbWFpbjoge1xuICAgICAgICAgICAgICAgICAgICBkb21haW5QcmVmaXgsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBkb21haW5VcmwgPSBgJHtkb21haW5QcmVmaXh9LmF1dGguJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkucmVnaW9ufS5hbWF6b25jb2duaXRvLmNvbWA7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXQgdGhlIGRvbWFpbiBVUkwgYXMgYSBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnYXV0aERvbWFpbicsIGRvbWFpblVybCwgYHVzZXJwb29sXyR7dXNlclBvb2xOYW1lfWApO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlTGFtYmRhQXV0aG9yaXplcih1c2VBc0RlZmF1bHRBdXRob3JpemVyOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmN1c3RvbUF1dGhvcml6ZXIpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGF1dGhvcml6ZXJGdW5jdGlvbiA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmN1c3RvbUF1dGhvcml6ZXIudHlwZX0tQ3VzdG9tQXV0aG9yaXplcmAsIHtcbiAgICAgICAgICAgIC4uLnRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyLmZ1bmN0aW9uUHJvcHMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGF1dGhvcml6ZXIgPSBuZXcgVG9rZW5BdXRob3JpemVyKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplci50eXBlfS1Ub2tlbkF1dGhvcml6ZXJgLCB7XG4gICAgICAgICAgICBoYW5kbGVyOiBhdXRob3JpemVyRnVuY3Rpb24gYXMgTm9kZWpzRnVuY3Rpb24sXG4gICAgICAgICAgICBpZGVudGl0eVNvdXJjZTogJ21ldGhvZC5yZXF1ZXN0LmhlYWRlci5BdXRob3JpemF0aW9uJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRKd3RBdXRob3JpemVyKGF1dGhvcml6ZXIsIHVzZUFzRGVmYXVsdEF1dGhvcml6ZXIpO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmN1c3RvbUF1dGhvcml6ZXIudHlwZSwgYXV0aG9yaXplciwgT3V0cHV0VHlwZS5BVVRIT1JJWkVSKTtcblxuICAgIH1cbn1cbiJdfQ==