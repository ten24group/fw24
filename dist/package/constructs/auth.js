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
    dependencies = [vpc_1.VpcConstruct.name, mailer_1.MailerConstruct.name];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2F1dGgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEseURBZWlDO0FBRWpDLCtEQUF5RjtBQUV6Riw2Q0FBNkQ7QUFDN0QsMkRBQXNEO0FBQ3RELHVEQUF3RTtBQUN4RSx1Q0FBb0M7QUFDcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQUN2RCxrQ0FBaUM7QUFFakMsK0VBQWlFO0FBQ2pFLCtCQUFxQztBQUNyQyxxQ0FBMkM7QUE2SzNDLE1BQU0sMkJBQTJCLEdBQXlCO0lBQ3RELFFBQVEsRUFBRTtRQUNOLEtBQUssRUFBRTtZQUNILGlCQUFpQixFQUFFLEtBQUs7WUFDeEIsZ0JBQWdCLEVBQUU7Z0JBQ2QsVUFBVSxFQUFFLG9DQUFzQixDQUFDLElBQUk7YUFDMUM7WUFDRCxVQUFVLEVBQUU7Z0JBQ1IsS0FBSyxFQUFFLElBQUk7YUFDZDtZQUNELGFBQWEsRUFBRTtnQkFDWCxLQUFLLEVBQUUsSUFBSTthQUNkO1lBQ0QsY0FBYyxFQUFFO2dCQUNaLFNBQVMsRUFBRSxDQUFDO2dCQUNaLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGFBQWEsRUFBRSxJQUFJO2dCQUNuQixjQUFjLEVBQUUsSUFBSTtnQkFDcEIsb0JBQW9CLEVBQUUsc0JBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO2FBQ3pDO1lBQ0QsYUFBYSxFQUFFLDJCQUFhLENBQUMsTUFBTTtTQUN0QztLQUNKO0lBQ0QsY0FBYyxFQUFFO1FBQ1osS0FBSyxFQUFFO1lBQ0gsY0FBYyxFQUFFLEtBQUs7WUFDckIsU0FBUyxFQUFFO2dCQUNQLFlBQVksRUFBRSxJQUFJO2FBQ3JCO1NBQ0o7S0FDSjtJQUNELHVCQUF1QixFQUFFLE1BQU07Q0FDbEMsQ0FBQTtBQUVELE1BQWEsYUFBYTtJQXFCRjtJQXBCWCxNQUFNLEdBQUcsSUFBQSxzQkFBWSxF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QTRWQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFxuICAgIENmbklkZW50aXR5UG9vbCwgXG4gICAgQ2ZuSWRlbnRpdHlQb29sUm9sZUF0dGFjaG1lbnQsXG4gICAgQ2ZuVXNlclBvb2xHcm91cCxcbiAgICBVc2VyUG9vbCwgXG4gICAgVXNlclBvb2xDbGllbnQsIFxuICAgIFVzZXJQb29sUHJvcHMsIFxuICAgIFVzZXJQb29sT3BlcmF0aW9uLFxuICAgIFZlcmlmaWNhdGlvbkVtYWlsU3R5bGUsXG4gICAgVXNlclBvb2xDbGllbnRQcm9wcyxcbiAgICBVc2VyUG9vbENsaWVudE9wdGlvbnMsXG4gICAgVXNlclBvb2xJZGVudGl0eVByb3ZpZGVyR29vZ2xlLFxuICAgIFVzZXJQb29sSWRlbnRpdHlQcm92aWRlckZhY2Vib29rLFxuICAgIFVzZXJQb29sRG9tYWluLFxuICAgIFByb3ZpZGVyQXR0cmlidXRlLFxufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNvZ25pdG9cIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBDb2duaXRvVXNlclBvb2xzQXV0aG9yaXplciwgVG9rZW5BdXRob3JpemVyIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5pbXBvcnQgeyBQb2xpY3lTdGF0ZW1lbnQsIFBvbGljeVN0YXRlbWVudFByb3BzLCBSb2xlLCBVc2VyIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IER1cmF0aW9uLCBSZW1vdmFsUG9saWN5LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29nbml0b0F1dGhSb2xlIH0gZnJvbSBcIi4vY29nbml0by1hdXRoLXJvbGVcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uLCBMYW1iZGFGdW5jdGlvblByb3BzIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBMb2dEdXJhdGlvbiB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZVwiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IENlcnRpZmljYXRlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXJcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5cbmV4cG9ydCB0eXBlIFRyaWdnZXJUeXBlID0gXG4gICAgfCAnQ1VTVE9NX01FU1NBR0UnXG4gICAgfCAnUFJFX1NJR05fVVAnXG4gICAgfCAnUE9TVF9DT05GSVJNQVRJT04nXG4gICAgfCAnUFJFX1RPS0VOX0dFTkVSQVRJT04nXG4gICAgfCAnVVNFUl9NSUdSQVRJT04nXG4gICAgfCAnREVGSU5FX0FVVEhfQ0hBTExFTkdFJ1xuICAgIHwgJ0NSRUFURV9BVVRIX0NIQUxMRU5HRSdcbiAgICB8ICdQT1NUX0FVVEhFTlRJQ0FUSU9OJ1xuICAgIHwgJ1BSRV9BVVRIRU5USUNBVElPTidcbiAgICB8ICdQUkVfVE9LRU5fR0VORVJBVElPTl9DT05GSUcnXG4gICAgfCAnVkVSSUZZX0FVVEhfQ0hBTExFTkdFX1JFU1BPTlNFJ1xuICAgIHwgJ0NVU1RPTV9FTUFJTF9TRU5ERVInXG4gICAgfCAnQ1VTVE9NX1NNU19TRU5ERVInO1xuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gaW50ZXJmYWNlIGZvciBzb2NpYWwgaWRlbnRpdHkgcHJvdmlkZXJzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElTb2NpYWxQcm92aWRlckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogT0F1dGggY2xpZW50IElEIGZvciB0aGUgc29jaWFsIHByb3ZpZGVyXG4gICAgICovXG4gICAgY2xpZW50SWQ6IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBPQXV0aCBjbGllbnQgc2VjcmV0IGZvciB0aGUgc29jaWFsIHByb3ZpZGVyXG4gICAgICovXG4gICAgY2xpZW50U2VjcmV0OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgT0F1dGggc2NvcGVzIHRvIHJlcXVlc3RcbiAgICAgKi9cbiAgICBzY29wZXM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBhdHRyaWJ1dGUgbWFwcGluZyBmcm9tIHByb3ZpZGVyIHRvIENvZ25pdG9cbiAgICAgKi9cbiAgICBhdHRyaWJ1dGVNYXBwaW5nPzoge1xuICAgICAgICBba2V5OiBzdHJpbmddOiBzdHJpbmc7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgQ29nbml0byBkb21haW5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRG9tYWluQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZG9tYWluIHByZWZpeCBmb3IgQ29nbml0byBob3N0ZWQgVUkuXG4gICAgICogSWYgdXNpbmcgYSBjdXN0b20gZG9tYWluLCB0aGlzIGlzIGlnbm9yZWQuXG4gICAgICovXG4gICAgY29nbml0b0RvbWFpblByZWZpeD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBDb25maWd1cmF0aW9uIGZvciBhIGN1c3RvbSBkb21haW5cbiAgICAgKi9cbiAgICBjdXN0b21Eb21haW4/OiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgZG9tYWluIG5hbWUgdG8gdXNlIChlLmcuICdhdXRoLmV4YW1wbGUuY29tJylcbiAgICAgICAgICovXG4gICAgICAgIGRvbWFpbk5hbWU6IHN0cmluZztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBBUk4gb2YgYW4gZXhpc3RpbmcgQUNNIGNlcnRpZmljYXRlIGZvciB0aGUgZG9tYWluXG4gICAgICAgICAqL1xuICAgICAgICBjZXJ0aWZpY2F0ZUFybjogc3RyaW5nO1xuICAgIH07XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBpbnRlcmZhY2UgZm9yIHRoZSBBdXRoQ29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElBdXRoQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIFVzZXIgUG9vbC5cbiAgICAgKi9cbiAgICB1c2VyUG9vbD86IHtcbiAgICAgICAgcHJvcHM6IFVzZXJQb29sUHJvcHM7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBEb21haW4gY29uZmlndXJhdGlvbiBmb3IgdGhlIHVzZXIgcG9vbC5cbiAgICAgICAgICogUmVxdWlyZWQgZm9yIHNvY2lhbCBzaWduLWluIGFuZCBob3N0ZWQgVUkgZmVhdHVyZXMuXG4gICAgICAgICAqL1xuICAgICAgICBkb21haW4/OiBJRG9tYWluQ29uZmlnO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3Igc29jaWFsIGlkZW50aXR5IHByb3ZpZGVycy5cbiAgICAgICAgICogV2hlbiBjb25maWd1cmVkLCBPQXV0aCBmbG93cyBhcmUgYXV0b21hdGljYWxseSBlbmFibGVkIHdpdGggYXBwcm9wcmlhdGUgc2V0dGluZ3MuXG4gICAgICAgICAqL1xuICAgICAgICBzb2NpYWxQcm92aWRlcnM/OiB7XG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEdvb2dsZSBpZGVudGl0eSBwcm92aWRlciBjb25maWd1cmF0aW9uXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGdvb2dsZT86IElTb2NpYWxQcm92aWRlckNvbmZpZztcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogRmFjZWJvb2sgaWRlbnRpdHkgcHJvdmlkZXIgY29uZmlndXJhdGlvblxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBmYWNlYm9vaz86IElTb2NpYWxQcm92aWRlckNvbmZpZztcbiAgICAgICAgfTtcbiAgICB9O1xuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBVc2VyIFBvb2wgQ2xpZW50LlxuICAgICAqL1xuICAgIHVzZXJQb29sQ2xpZW50Pzoge1xuICAgICAgICBwcm9wczogVXNlclBvb2xDbGllbnRPcHRpb25zO1xuICAgIH07XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgcG9saWNpZXMgdG8gYXR0YWNoIHRvIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZS5cbiAgICAgKi9cbiAgICBwb2xpY2llcz86IEFycmF5PFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PjtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBmaWxlIHBhdGhzIGZvciBwb2xpY3kgZmlsZXMuXG4gICAgICovXG4gICAgcG9saWN5RmlsZVBhdGhzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogQXJyYXkgb2YgdHJpZ2dlcnMgZm9yIHVzZXIgcG9vbCBvcGVyYXRpb25zLlxuICAgICAqL1xuICAgIHRyaWdnZXJzPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHVzZXIgcG9vbCBvcGVyYXRpb24gdGhhdCB0cmlnZ2VycyB0aGUgZnVuY3Rpb24uXG4gICAgICAgICAqL1xuICAgICAgICB0cmlnZ2VyOiBVc2VyUG9vbE9wZXJhdGlvbiB8IFRyaWdnZXJUeXBlO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHM7XG4gICAgfVtdO1xuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIGdyb3VwcyBmb3IgdGhlIEF1dGhDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgZ3JvdXBzPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIG5hbWUgb2YgdGhlIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHByZWNlZGVuY2Ugb2YgdGhlIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgcHJlY2VkZW5jZT86IG51bWJlcjtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIHBvbGljaWVzIHRvIGF0dGFjaCB0byB0aGUgZ3JvdXAuXG4gICAgICAgICAqL1xuICAgICAgICBwb2xpY2llcz86IEFycmF5PFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50PjtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIGZpbGUgcGF0aHMgZm9yIHBvbGljeSBmaWxlcyBzcGVjaWZpYyB0byB0aGlzIGdyb3VwLlxuICAgICAgICAgKi9cbiAgICAgICAgcG9saWN5RmlsZVBhdGhzPzogc3RyaW5nW107XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBGbGFnIGluZGljYXRpbmcgd2hldGhlciB0aGUgdXNlciBzaG91bGQgYmUgYXV0b21hdGljYWxseSBzaWduZWQgdXAgdG8gdGhpcyBncm91cCBkdXJpbmcgc2lnbnVwLlxuICAgICAgICAgKi9cbiAgICAgICAgYXV0b1VzZXJTaWdudXA/OiBib29sZWFuO1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbiB0aGF0IGhhbmRsZXMgYXV0b21hdGljIHVzZXIgc2lnbnVwLlxuICAgICAgICAgKi9cbiAgICAgICAgYXV0b1VzZXJTaWdudXBIYW5kbGVyPzogTGFtYmRhRnVuY3Rpb25Qcm9wcztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFycmF5IG9mIHJvdXRlcyBwcm90ZWN0ZWQgYnkgdGhpcyBncm91cC5cbiAgICAgICAgICovXG4gICAgICAgIHJvdXRlcz86IHN0cmluZ1tdO1xuICAgIH1bXTtcbiAgICAvKipcbiAgICAgKiBGbGFnIGluZGljYXRpbmcgd2hldGhlciB0byB1c2UgdGhpcyBBdXRoQ29uc3RydWN0IGFzIHRoZSBkZWZhdWx0IGF1dGhvcml6ZXIuXG4gICAgICovXG4gICAgdXNlQXNEZWZhdWx0QXV0aG9yaXplcj86IGJvb2xlYW47XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJhdGlvbiBmb3IgYSBjdXN0b20gTGFtYmRhIGF1dGhvcml6ZXIuXG4gICAgICovXG4gICAgY3VzdG9tQXV0aG9yaXplcj86IHtcbiAgICAgICAgdHlwZTogc3RyaW5nO1xuICAgICAgICBmdW5jdGlvblByb3BzOiBMYW1iZGFGdW5jdGlvblByb3BzO1xuICAgIH07XG4gICAgLyoqXG4gICAgICogSG93IHRvIHJlc29sdmUgYW1iaWd1b3VzIHJvbGUgYXNzaWdubWVudHMuXG4gICAgICogRGVmYXVsdHMgdG8gXCJVc2VEZWZhdWx0Um9sZVwiIHdoaWNoIHdpbGwgdXNlIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZSB3aGVuIHRoZXJlJ3MgYW1iaWd1aXR5LlxuICAgICAqIENhbiBiZSBzZXQgdG8gXCJEZW55XCIgdG8gZGVueSBhY2Nlc3Mgd2hlbiB0aGVyZSdzIGFtYmlndWl0eS5cbiAgICAgKi9cbiAgICBhbWJpZ3VvdXNSb2xlUmVzb2x1dGlvbj86ICdVc2VEZWZhdWx0Um9sZScgfCAnRGVueSc7XG59XG5cbmNvbnN0IEF1dGhDb25zdHJ1Y3RDb25maWdEZWZhdWx0czogSUF1dGhDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgdXNlclBvb2w6IHtcbiAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHNlbGZTaWduVXBFbmFibGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHVzZXJWZXJpZmljYXRpb246IHtcbiAgICAgICAgICAgICAgICBlbWFpbFN0eWxlOiBWZXJpZmljYXRpb25FbWFpbFN0eWxlLkNPREUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYXV0b1ZlcmlmeToge1xuICAgICAgICAgICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICAgICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICAgICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgICAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcbiAgICAgICAgICAgICAgICB0ZW1wUGFzc3dvcmRWYWxpZGl0eTogRHVyYXRpb24uZGF5cygzKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgfVxuICAgIH0sXG4gICAgdXNlclBvb2xDbGllbnQ6IHtcbiAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgICAgICAgIGF1dGhGbG93czoge1xuICAgICAgICAgICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgYW1iaWd1b3VzUm9sZVJlc29sdXRpb246ICdEZW55J1xufVxuXG5leHBvcnQgY2xhc3MgQXV0aENvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihBdXRoQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBBdXRoQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtWcGNDb25zdHJ1Y3QubmFtZSwgTWFpbGVyQ29uc3RydWN0Lm5hbWVdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICBcbiAgICAvKipcbiAgICAgKiBDcmVhdGUgYSBuZXcgQXV0aENvbnN0cnVjdC5cbiAgICAgKiBAcGFyYW0gYXV0aENvbnN0cnVjdENvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIG9iamVjdCBmb3IgdGhlIEF1dGggY29uc3RydWN0LlxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gQ3JlYXRlIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBBdXRoIGNsYXNzXG4gICAgICogY29uc3QgYXV0aENvbmZpZzogSUF1dGhDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICogICAvLyBQcm92aWRlIHRoZSBuZWNlc3NhcnkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gICAgICogICAvLyAuLi5cbiAgICAgKiB9O1xuICAgICAqIGNvbnN0IGF1dGggPSBuZXcgQXV0aChhdXRoQ29uZmlnKTtcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIGF1dGhDb25zdHJ1Y3RDb25maWc6IElBdXRoQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGF1dGhDb25zdHJ1Y3RDb25maWcsJ0NPR05JVE8nKTtcbiAgICB9XG5cbiAgICAvLyBjb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2tcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImNvbnN0cnVjdFwiKTtcblxuICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmN1c3RvbUF1dGhvcml6ZXI/LnR5cGUgPT09ICdqd3QnKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZUxhbWJkYUF1dGhvcml6ZXIodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZUFzRGVmYXVsdEF1dGhvcml6ZXIgfHwgZmFsc2UpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdXNlclBvb2xDb25maWcgPSB7Li4uQXV0aENvbnN0cnVjdENvbmZpZ0RlZmF1bHRzLnVzZXJQb29sPy5wcm9wcywgLi4udGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5wcm9wc307XG4gICAgICAgIGNvbnN0IHVzZXJQb29sTmFtZSA9IHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8ucHJvcHM/LnVzZXJQb29sTmFtZSB8fCAnZGVmYXVsdCc7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJDcmVhdGluZyB1c2VyIHBvb2w6IFwiLCB1c2VyUG9vbE5hbWUpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcInVzZXIgcG9vbCBjb25maWc6IFwiLCB1c2VyUG9vbE5hbWUsIHVzZXJQb29sQ29uZmlnKTtcblxuICAgICAgICBpZih0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlQXNEZWZhdWx0QXV0aG9yaXplciA9PT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VBc0RlZmF1bHRBdXRob3JpemVyID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRPRE86IEFkZCBhYmlsaXR5IHRvIGNyZWF0ZSBtdWx0aS10ZW5hbnQgdXNlciBwb29sc1xuICAgICAgICBjb25zdCB1c2VyUG9vbDogVXNlclBvb2wgPSBuZXcgVXNlclBvb2wodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tdXNlclBvb2xgLCB7XG4gICAgICAgICAgICAuLi51c2VyUG9vbENvbmZpZyxcbiAgICAgICAgICAgIHVzZXJQb29sTmFtZTogdGhpcy5jcmVhdGVVbmlxdWVVc2VyUG9vbE5hbWUodXNlclBvb2xOYW1lKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ29uZmlndXJlIGRvbWFpbiBpZiBzcGVjaWZpZWQgb3IgaWYgc29jaWFsIHByb3ZpZGVycyBhcmUgZW5hYmxlZFxuICAgICAgICB0aGlzLmNvbmZpZ3VyZURvbWFpbih1c2VyUG9vbCwgdXNlclBvb2xOYW1lKTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdXNlclBvb2xOYW1lLCB1c2VyUG9vbCwgT3V0cHV0VHlwZS5VU0VSUE9PTCwgJ3VzZXJQb29sSWQnKTtcblxuICAgICAgICBjb25zdCB1c2VyUG9vbENsaWVudENvbmZpZzogVXNlclBvb2xDbGllbnRQcm9wcyA9IHtcbiAgICAgICAgICAgIHVzZXJQb29sOiB1c2VyUG9vbCxcbiAgICAgICAgICAgIC4uLkF1dGhDb25zdHJ1Y3RDb25maWdEZWZhdWx0cy51c2VyUG9vbENsaWVudD8ucHJvcHMsIFxuICAgICAgICAgICAgLi4udGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sQ2xpZW50Py5wcm9wcyxcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBVc2VyUG9vbENsaWVudCh0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS11c2VyUG9vbGNsaWVudGAsIHVzZXJQb29sQ2xpZW50Q29uZmlnKTtcblxuICAgICAgICAvLyBDb25maWd1cmUgc29jaWFsIHByb3ZpZGVycyBpZiBzcGVjaWZpZWRcbiAgICAgICAgdGhpcy5jb25maWd1cmVTb2NpYWxQcm92aWRlcnModXNlclBvb2wsIHVzZXJQb29sQ2xpZW50LCB1c2VyUG9vbE5hbWUpO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdXNlclBvb2xOYW1lLCB1c2VyUG9vbENsaWVudCwgT3V0cHV0VHlwZS5VU0VSUE9PTENMSUVOVCwgJ3VzZXJQb29sQ2xpZW50SWQnKTtcblxuICAgICAgICAvLyBJZGVudGl0eSBwb29sIGJhc2VkIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgIGlmKHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5ncm91cHMgfHwgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnBvbGljeUZpbGVQYXRocyB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlID09ICdBV1NfSUFNJykge1xuICAgICAgICAgICAgdGhpcy5jcmVhdGVJZGVudGl0eVBvb2xBdXRob3JpemVyKHVzZXJQb29sLCB1c2VyUG9vbENsaWVudCwgdXNlclBvb2xOYW1lLCB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlQXNEZWZhdWx0QXV0aG9yaXplcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyB1c2VyIHBvb2wgYmFzZSBhdXRoZW50aWNhdGlvblxuICAgICAgICAgICAgdGhpcy5jcmVhdGVVc2VyUG9vbEF1dGhvcml6ZXIodXNlclBvb2wsIHVzZXJQb29sTmFtZSwgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZUFzRGVmYXVsdEF1dGhvcml6ZXIpO1xuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZVVzZXJQb29sQXV0aG9yaXplcih1c2VyUG9vbDogVXNlclBvb2wsIHVzZXJQb29sTmFtZTogc3RyaW5nLCB1c2VBc0RlZmF1bHRBdXRob3JpemVyOiBib29sZWFuKSB7XG4gICAgICAgIC8vIGNvZ25pdG8gYXV0aG9yaXplciBcbiAgICAgICAgY29uc3QgdXNlclBvb2xBdXRob3JpemVyID0gbmV3IENvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LUF1dGhvcml6ZXJgLCB7XG4gICAgICAgICAgICBjb2duaXRvVXNlclBvb2xzOiBbdXNlclBvb2xdLFxuICAgICAgICAgICAgaWRlbnRpdHlTb3VyY2U6ICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb2duaXRvQXV0aG9yaXplcihcbiAgICAgICAgICAgIHVzZXJQb29sTmFtZSwgXG4gICAgICAgICAgICB1c2VyUG9vbEF1dGhvcml6ZXIsXG4gICAgICAgICAgICAvLyBUT0RPOiBiZXR0ZXIgbG9naWMgdG8gY29udHJvbCB0aGUgZGVmYXVsdCBhdXRob3JpemVyXG4gICAgICAgICAgICB1c2VBc0RlZmF1bHRBdXRob3JpemVyXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYodXNlQXNEZWZhdWx0QXV0aG9yaXplciAhPT0gZmFsc2Upe1xuICAgICAgICAgICAgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSA9ICdDT0dOSVRPX1VTRVJfUE9PTFMnO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldERlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUodXNlclBvb2xOYW1lKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJEZWZhdWx0IEF1dGhvcml6ZXIgc2V0IHRvIENPR05JVE9fVVNFUl9QT09MU1wiKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlSWRlbnRpdHlQb29sQXV0aG9yaXplcih1c2VyUG9vbDogVXNlclBvb2wsIHVzZXJQb29sQ2xpZW50OiBVc2VyUG9vbENsaWVudCwgdXNlclBvb2xOYW1lOiBzdHJpbmcsIHVzZUFzRGVmYXVsdEF1dGhvcml6ZXI6IGJvb2xlYW4pIHtcblxuICAgICAgICBjb25zdCBpZGVudGl0eVBvb2wgPSBuZXcgQ2ZuSWRlbnRpdHlQb29sKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LWlkZW50aXR5UG9vbGAsIHtcbiAgICAgICAgICAgIGFsbG93VW5hdXRoZW50aWNhdGVkSWRlbnRpdGllczogdHJ1ZSxcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eVByb3ZpZGVyczogW3tcbiAgICAgICAgICAgICAgICBjbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgICAgICAgICBwcm92aWRlck5hbWU6IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lLFxuICAgICAgICAgICAgfV0sXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHVzZXJQb29sTmFtZSwgaWRlbnRpdHlQb29sLCBPdXRwdXRUeXBlLklERU5USVRZUE9PTCwgJ3JlZicsICdpZGVudGl0eVBvb2xJZCcpO1xuXG4gICAgICAgIC8vIGNvbmZpZ3VyZSBpZGVudGl0eSBwb29sIHJvbGUgYXR0YWNobWVudFxuICAgICAgICBjb25zdCBpZGVudGl0eVByb3ZpZGVyID0gdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUgKyAnOicgKyB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkO1xuICAgICAgICBjb25zdCByb2xlQXR0YWNobWVudDogYW55ID0ge1xuICAgICAgICAgICAgaWRlbnRpdHlQb29sSWQ6IGlkZW50aXR5UG9vbC5yZWYsXG4gICAgICAgIH1cblxuICAgICAgICAvLyBjcmVhdGUgdXNlciBwb29sIGdyb3Vwc1xuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcykge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBOYW1lcyA9IHRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5ncm91cHMubWFwKGdyb3VwID0+IGdyb3VwLm5hbWUpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ0dyb3VwcycsIGdyb3VwTmFtZXMsICdjb2duaXRvJyk7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnYXV0aEdyb3VwcycsIGdyb3VwTmFtZXMuam9pbignLCcpLCBgdXNlcnBvb2xfJHt1c2VyUG9vbE5hbWV9YCk7XG4gICAgICAgICAgICAvL3RoaXMuZncyNC5zZXQoJ0F1dG9Vc2VyU2lnbnVwR3JvdXBzJywgdGhpcy5hdXRoQ29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5uYW1lKS50b1N0cmluZygpLCB1c2VyUG9vbE5hbWUpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBncm91cCBvZiB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuZ3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgLy8gY3JlYXRlIGEgcm9sZSBmb3IgdGhlIGdyb3VwXG4gICAgICAgICAgICAgICAgY29uc3QgcG9saWN5RmlsZVBhdGhzID0gZ3JvdXAucG9saWN5RmlsZVBhdGhzO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJvbGUgPSBuZXcgQ29nbml0b0F1dGhSb2xlKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LSR7Z3JvdXAubmFtZX0tQ29nbml0b0F1dGhSb2xlYCwge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGl0eVBvb2w6IGlkZW50aXR5UG9vbCxcbiAgICAgICAgICAgICAgICAgICAgcG9saWN5RmlsZVBhdGhzOiBwb2xpY3lGaWxlUGF0aHMsXG4gICAgICAgICAgICAgICAgICAgIHBvbGljaWVzOiBncm91cC5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICB9KSBhcyBSb2xlO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ1JvbGUnLCByb2xlLCBgY29nbml0b18ke2dyb3VwLm5hbWV9YCk7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ1JvdXRlcycsIGdyb3VwLnJvdXRlcywgYGNvZ25pdG9fJHtncm91cC5uYW1lfWApO1xuXG4gICAgICAgICAgICAgICAgbmV3IENmblVzZXJQb29sR3JvdXAodGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tJHtncm91cC5uYW1lfS1ncm91cGAsIHtcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBOYW1lOiBncm91cC5uYW1lLFxuICAgICAgICAgICAgICAgICAgICB1c2VyUG9vbElkOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgICAgICAgICAgICByb2xlQXJuOiByb2xlLnJvbGVBcm4sXG4gICAgICAgICAgICAgICAgICAgIHByZWNlZGVuY2U6IGdyb3VwLnByZWNlZGVuY2UgfHwgMCxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGF1dG9Vc2VyU2lnbnVwR3JvdXBzID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5uYW1lKS50b1N0cmluZygpO1xuICAgICAgICAgICAgY29uc3QgYXV0b1VzZXJTaWdudXBHcm91cHNIYW5kbGVyID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmdyb3Vwcy5maWx0ZXIoZ3JvdXAgPT4gZ3JvdXAuYXV0b1VzZXJTaWdudXApLm1hcChncm91cCA9PiBncm91cC5hdXRvVXNlclNpZ251cEhhbmRsZXIpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBOb3RlOiBvbmx5IG9uZSBhdXRvIHNpZ251cCBoYW5kbGVyIGlzIHN1cHBvcnRlZCwgcGljayB0aGUgZmlyc3Qgb25lXG4gICAgICAgICAgICBjb25zdCBhdXRvR3JvdXBzQWRkSGFuZGxlciA9IGF1dG9Vc2VyU2lnbnVwR3JvdXBzSGFuZGxlclswXSB8fCAnJztcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYoYXV0b1VzZXJTaWdudXBHcm91cHMgJiYgYXV0b0dyb3Vwc0FkZEhhbmRsZXIpe1xuICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBhIHBvc3QgY29uZmlybWF0aW9uIHRyaWdnZXIgdG8gYWRkIHVzZXJzIHRvIGF1dG8gc2lnbnVwIGdyb3Vwc1xuICAgICAgICAgICAgICAgIGNvbnN0IHByb3BzID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXV0b1NpZ251cEdyb3VwczogYXV0b1VzZXJTaWdudXBHcm91cHMsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogWydjb2duaXRvLWlkcDpBZG1pbkFkZFVzZXJUb0dyb3VwJ10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb25zdCBsYW1iZGFGdW5jdGlvblByb3BzID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi5hdXRvR3JvdXBzQWRkSGFuZGxlcixcbiAgICAgICAgICAgICAgICAgICAgLi4ucHJvcHNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJhdXRvVXNlclNpZ251cEdyb3Vwc0hhbmRsZXI6IFwiLCBsYW1iZGFGdW5jdGlvblByb3BzKTtcbiAgICAgICAgICAgICAgICBjb25zdCBsYW1iZGFUcmlnZ2VyID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LWF1dG8tcG9zdC1jb25maXJtYXRpb24tbGFtYmRhRnVuY3Rpb25gLCB7XG4gICAgICAgICAgICAgICAgICAgIC4uLmxhbWJkYUZ1bmN0aW9uUHJvcHMsXG4gICAgICAgICAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG4gICAgICAgICAgICAgICAgdXNlclBvb2wuYWRkVHJpZ2dlcihVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0NPTkZJUk1BVElPTiwgbGFtYmRhVHJpZ2dlcik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGNvbmZpZ3VyZSByb2xlIG1hcHBpbmdcbiAgICAgICAgICAgIHJvbGVBdHRhY2htZW50LnJvbGVNYXBwaW5ncyA9IHtcbiAgICAgICAgICAgICAgICBcInVzZXJwb29sXCI6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJUb2tlblwiLFxuICAgICAgICAgICAgICAgICAgICBhbWJpZ3VvdXNSb2xlUmVzb2x1dGlvbjogdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmFtYmlndW91c1JvbGVSZXNvbHV0aW9uIHx8ICdEZW55JyxcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpdHlQcm92aWRlcjogaWRlbnRpdHlQcm92aWRlcixcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJQU0gcm9sZSBmb3IgYXV0aGVudGljYXRlZCB1c2VycyBpZiBubyBncm91cHMgYXJlIGRlZmluZWRcbiAgICAgICAgY29uc3QgcG9saWN5RmlsZVBhdGhzID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnBvbGljeUZpbGVQYXRocztcbiAgICAgICAgY29uc3QgYXV0aGVudGljYXRlZFJvbGUgPSBuZXcgQ29nbml0b0F1dGhSb2xlKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LUNvZ25pdG9BdXRoUm9sZWAsIHtcbiAgICAgICAgICAgIGlkZW50aXR5UG9vbDogaWRlbnRpdHlQb29sLFxuICAgICAgICAgICAgcG9saWN5RmlsZVBhdGhzOiBwb2xpY3lGaWxlUGF0aHMsXG4gICAgICAgICAgICBwb2xpY2llczogdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnBvbGljaWVzLFxuICAgICAgICB9KSBhcyBSb2xlO1xuXG4gICAgICAgIC8vIGlmIG5vIGdyb3VwcyBhcmUgZGVmaW5lZCBhbGwgcG9saWNpZXMgYXJlIGFkZGVkIHRvIHRoZSBkZWZhdWx0IGF1dGhlbnRpY2F0ZWQgcm9sZVxuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnUm9sZScsIGF1dGhlbnRpY2F0ZWRSb2xlLCBgY29nbml0b19kZWZhdWx0YCk7XG5cbiAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZXMgPSB7fTtcbiAgICAgICAgcm9sZUF0dGFjaG1lbnQucm9sZXMuYXV0aGVudGljYXRlZCA9IGF1dGhlbnRpY2F0ZWRSb2xlLnJvbGVBcm47XG5cbiAgICAgICAgbmV3IENmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LUlkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50YCwgcm9sZUF0dGFjaG1lbnQpO1xuXG4gICAgICAgIC8vIGNyZWF0ZSB0cmlnZ2Vyc1xuICAgICAgICBpZiAodGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnRyaWdnZXJzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHRyaWdnZXIgb2YgdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnRyaWdnZXJzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhVHJpZ2dlciA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS0ke3RyaWdnZXIudHJpZ2dlcn0tbGFtYmRhRnVuY3Rpb25gLCB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnRyaWdnZXIuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbC5hZGRUcmlnZ2VyKCB0aGlzLm1hcFRyaWdnZXJUeXBlKHRyaWdnZXIudHJpZ2dlciksIGxhbWJkYVRyaWdnZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYodXNlQXNEZWZhdWx0QXV0aG9yaXplciAhPT0gZmFsc2Upe1xuICAgICAgICAgICAgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSA9ICdBV1NfSUFNJztcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJEZWZhdWx0IEF1dGhvcml6ZXIgc2V0IHRvIEFXU19JQU1cIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIG1hcFRyaWdnZXJUeXBlKHRyaWdnZXJUeXBlOiBUcmlnZ2VyVHlwZSB8IFVzZXJQb29sT3BlcmF0aW9uKTogVXNlclBvb2xPcGVyYXRpb24ge1xuICAgICAgICBcbiAgICAgICAgaWYoIHRyaWdnZXJUeXBlIGluc3RhbmNlb2YgVXNlclBvb2xPcGVyYXRpb24pe1xuICAgICAgICAgICAgcmV0dXJuIHRyaWdnZXJUeXBlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCB0cmlnZ2VyTWFwcGluZzogeyBba2V5IGluIFRyaWdnZXJUeXBlXTogVXNlclBvb2xPcGVyYXRpb24gfSA9IHtcbiAgICAgICAgICAgIENVU1RPTV9NRVNTQUdFOiBVc2VyUG9vbE9wZXJhdGlvbi5DVVNUT01fTUVTU0FHRSxcbiAgICAgICAgICAgIFBSRV9TSUdOX1VQOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfU0lHTl9VUCxcbiAgICAgICAgICAgIFBPU1RfQ09ORklSTUFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0NPTkZJUk1BVElPTixcbiAgICAgICAgICAgIFBSRV9UT0tFTl9HRU5FUkFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfVE9LRU5fR0VORVJBVElPTixcbiAgICAgICAgICAgIFVTRVJfTUlHUkFUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5VU0VSX01JR1JBVElPTixcbiAgICAgICAgICAgIERFRklORV9BVVRIX0NIQUxMRU5HRTogVXNlclBvb2xPcGVyYXRpb24uREVGSU5FX0FVVEhfQ0hBTExFTkdFLFxuICAgICAgICAgICAgQ1JFQVRFX0FVVEhfQ0hBTExFTkdFOiBVc2VyUG9vbE9wZXJhdGlvbi5DUkVBVEVfQVVUSF9DSEFMTEVOR0UsXG4gICAgICAgICAgICBQT1NUX0FVVEhFTlRJQ0FUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QT1NUX0FVVEhFTlRJQ0FUSU9OLFxuICAgICAgICAgICAgUFJFX0FVVEhFTlRJQ0FUSU9OOiBVc2VyUG9vbE9wZXJhdGlvbi5QUkVfQVVUSEVOVElDQVRJT04sXG4gICAgICAgICAgICBQUkVfVE9LRU5fR0VORVJBVElPTl9DT05GSUc6IFVzZXJQb29sT3BlcmF0aW9uLlBSRV9UT0tFTl9HRU5FUkFUSU9OX0NPTkZJRyxcbiAgICAgICAgICAgIFZFUklGWV9BVVRIX0NIQUxMRU5HRV9SRVNQT05TRTogVXNlclBvb2xPcGVyYXRpb24uVkVSSUZZX0FVVEhfQ0hBTExFTkdFX1JFU1BPTlNFLFxuICAgICAgICAgICAgQ1VTVE9NX0VNQUlMX1NFTkRFUjogVXNlclBvb2xPcGVyYXRpb24uQ1VTVE9NX0VNQUlMX1NFTkRFUixcbiAgICAgICAgICAgIENVU1RPTV9TTVNfU0VOREVSOiBVc2VyUG9vbE9wZXJhdGlvbi5DVVNUT01fU01TX1NFTkRFUixcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gdHJpZ2dlck1hcHBpbmdbdHJpZ2dlclR5cGVdO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlVW5pcXVlVXNlclBvb2xOYW1lKHVzZXJQb29sTmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHt1c2VyUG9vbE5hbWV9YDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbmZpZ3VyZVNvY2lhbFByb3ZpZGVycyh1c2VyUG9vbDogVXNlclBvb2wsIHVzZXJQb29sQ2xpZW50OiBVc2VyUG9vbENsaWVudCwgdXNlclBvb2xOYW1lOiBzdHJpbmcpIHtcbiAgICAgICAgaWYgKCF0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnNvY2lhbFByb3ZpZGVycykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHN1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzID0gJyc7XG4gICAgICAgIC8vIENvbmZpZ3VyZSBHb29nbGUgcHJvdmlkZXIgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnNvY2lhbFByb3ZpZGVycz8uZ29vZ2xlKSB7XG4gICAgICAgICAgICBjb25zdCB7IGNsaWVudElkLCBjbGllbnRTZWNyZXQsIHNjb3BlcywgYXR0cmlidXRlTWFwcGluZyB9ID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sLnNvY2lhbFByb3ZpZGVycy5nb29nbGU7XG5cbiAgICAgICAgICAgIGNvbnN0IGdvb2dsZVByb3ZpZGVyID0gbmV3IFVzZXJQb29sSWRlbnRpdHlQcm92aWRlckdvb2dsZSh0aGlzLm1haW5TdGFjaywgJ0dvb2dsZVByb3ZpZGVyJywge1xuICAgICAgICAgICAgICAgIHVzZXJQb29sOiB1c2VyUG9vbCxcbiAgICAgICAgICAgICAgICBjbGllbnRJZDogY2xpZW50SWQsXG4gICAgICAgICAgICAgICAgY2xpZW50U2VjcmV0OiBjbGllbnRTZWNyZXQsXG4gICAgICAgICAgICAgICAgc2NvcGVzOiBzY29wZXMgfHwgWydlbWFpbCcsICdwcm9maWxlJywgJ29wZW5pZCddLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IGF0dHJpYnV0ZU1hcHBpbmcgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbWFpbDogUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0VNQUlMLFxuICAgICAgICAgICAgICAgICAgICBlbWFpbFZlcmlmaWVkOiBQcm92aWRlckF0dHJpYnV0ZS5HT09HTEVfRU1BSUxfVkVSSUZJRUQsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHVzZXJQb29sQ2xpZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShnb29nbGVQcm92aWRlcik7XG4gICAgICAgICAgICBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVycyArPSAnR29vZ2xlLCc7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb25maWd1cmUgRmFjZWJvb2sgcHJvdmlkZXIgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmICh0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnNvY2lhbFByb3ZpZGVycz8uZmFjZWJvb2spIHtcbiAgICAgICAgICAgIGNvbnN0IHsgY2xpZW50SWQsIGNsaWVudFNlY3JldCwgc2NvcGVzLCBhdHRyaWJ1dGVNYXBwaW5nIH0gPSB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2wuc29jaWFsUHJvdmlkZXJzLmZhY2Vib29rO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjb25zdCBmYWNlYm9va1Byb3ZpZGVyID0gbmV3IFVzZXJQb29sSWRlbnRpdHlQcm92aWRlckZhY2Vib29rKHRoaXMubWFpblN0YWNrLCAnRmFjZWJvb2tQcm92aWRlcicsIHtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbCxcbiAgICAgICAgICAgICAgICBjbGllbnRJZCxcbiAgICAgICAgICAgICAgICBjbGllbnRTZWNyZXQsXG4gICAgICAgICAgICAgICAgc2NvcGVzOiBzY29wZXMgfHwgWydlbWFpbCcsICdwdWJsaWNfcHJvZmlsZSddLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IGF0dHJpYnV0ZU1hcHBpbmcgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbWFpbDogUHJvdmlkZXJBdHRyaWJ1dGUuRkFDRUJPT0tfRU1BSUwsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHVzZXJQb29sQ2xpZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShmYWNlYm9va1Byb3ZpZGVyKTtcbiAgICAgICAgICAgIHN1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzICs9ICdGYWNlYm9vaywnO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoJ3N1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzJywgc3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnMsIGB1c2VycG9vbF8ke3VzZXJQb29sTmFtZX1gKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbmZpZ3VyZURvbWFpbih1c2VyUG9vbDogVXNlclBvb2wsIHVzZXJQb29sTmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgICAgIC8vIFNraXAgZG9tYWluIGNvbmZpZ3VyYXRpb24gaWYgbm90IG5lZWRlZFxuICAgICAgICBpZiAoIXRoaXMuYXV0aENvbnN0cnVjdENvbmZpZy51c2VyUG9vbD8uZG9tYWluICYmICF0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcudXNlclBvb2w/LnNvY2lhbFByb3ZpZGVycykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZG9tYWluQ29uZmlnID0gdGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLnVzZXJQb29sPy5kb21haW47XG4gICAgICAgIGxldCBkb21haW46IFVzZXJQb29sRG9tYWluO1xuICAgICAgICBsZXQgZG9tYWluVXJsOiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKGRvbWFpbkNvbmZpZz8uY3VzdG9tRG9tYWluICYmIGRvbWFpbkNvbmZpZy5jdXN0b21Eb21haW4uZG9tYWluTmFtZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBDb25maWd1cmUgY3VzdG9tIGRvbWFpblxuICAgICAgICAgICAgY29uc3QgeyBkb21haW5OYW1lLCBjZXJ0aWZpY2F0ZUFybiB9ID0gZG9tYWluQ29uZmlnLmN1c3RvbURvbWFpbjtcbiAgICAgICAgICAgIGRvbWFpbiA9IG5ldyBVc2VyUG9vbERvbWFpbih0aGlzLm1haW5TdGFjaywgYCR7dXNlclBvb2xOYW1lfS1kb21haW5gLCB7XG4gICAgICAgICAgICAgICAgdXNlclBvb2wsXG4gICAgICAgICAgICAgICAgY3VzdG9tRG9tYWluOiB7XG4gICAgICAgICAgICAgICAgICAgIGRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlOiBDZXJ0aWZpY2F0ZS5mcm9tQ2VydGlmaWNhdGVBcm4odGhpcy5tYWluU3RhY2ssIGAke3VzZXJQb29sTmFtZX0tY2VydGAsIGNlcnRpZmljYXRlQXJuKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGRvbWFpblVybCA9IGRvbWFpbk5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBVc2UgQ29nbml0byBkb21haW5cbiAgICAgICAgICAgIGNvbnN0IGRvbWFpblByZWZpeCA9IGRvbWFpbkNvbmZpZz8uY29nbml0b0RvbWFpblByZWZpeCB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHt1c2VyUG9vbE5hbWV9LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLmFjY291bnR9YC50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05LV0vZywgJy0nKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZG9tYWluID0gbmV3IFVzZXJQb29sRG9tYWluKHRoaXMubWFpblN0YWNrLCBgJHt1c2VyUG9vbE5hbWV9LWRvbWFpbmAsIHtcbiAgICAgICAgICAgICAgICB1c2VyUG9vbCxcbiAgICAgICAgICAgICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgICAgICAgICAgICAgIGRvbWFpblByZWZpeCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGRvbWFpblVybCA9IGAke2RvbWFpblByZWZpeH0uYXV0aC4ke3RoaXMuZncyNC5nZXRDb25maWcoKS5yZWdpb259LmFtYXpvbmNvZ25pdG8uY29tYDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB0aGUgZG9tYWluIFVSTCBhcyBhIGVudmlyb25tZW50IHZhcmlhYmxlXG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdhdXRoRG9tYWluJywgZG9tYWluVXJsLCBgdXNlcnBvb2xfJHt1c2VyUG9vbE5hbWV9YCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVMYW1iZGFBdXRob3JpemVyKHVzZUFzRGVmYXVsdEF1dGhvcml6ZXI6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCF0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplcikge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXV0aG9yaXplckZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplci50eXBlfS1DdXN0b21BdXRob3JpemVyYCwge1xuICAgICAgICAgICAgLi4udGhpcy5hdXRoQ29uc3RydWN0Q29uZmlnLmN1c3RvbUF1dGhvcml6ZXIuZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgYXV0aG9yaXplciA9IG5ldyBUb2tlbkF1dGhvcml6ZXIodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuYXV0aENvbnN0cnVjdENvbmZpZy5jdXN0b21BdXRob3JpemVyLnR5cGV9LVRva2VuQXV0aG9yaXplcmAsIHtcbiAgICAgICAgICAgIGhhbmRsZXI6IGF1dGhvcml6ZXJGdW5jdGlvbiBhcyBOb2RlanNGdW5jdGlvbixcbiAgICAgICAgICAgIGlkZW50aXR5U291cmNlOiAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLkF1dGhvcml6YXRpb24nLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5mdzI0LnNldEp3dEF1dGhvcml6ZXIoYXV0aG9yaXplciwgdXNlQXNEZWZhdWx0QXV0aG9yaXplcik7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCB0aGlzLmF1dGhDb25zdHJ1Y3RDb25maWcuY3VzdG9tQXV0aG9yaXplci50eXBlLCBhdXRob3JpemVyLCBPdXRwdXRUeXBlLkFVVEhPUklaRVIpO1xuICAgICAgICBcbiAgICB9XG59XG4iXX0=