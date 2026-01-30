import { UserPoolProps, UserPoolOperation, UserPoolClientOptions } from "aws-cdk-lib/aws-cognito";
import { PolicyStatement, PolicyStatementProps } from "aws-cdk-lib/aws-iam";
import { Stack } from "aws-cdk-lib";
import { LambdaFunctionProps } from "./lambda-function";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
export type TriggerType = 'CUSTOM_MESSAGE' | 'PRE_SIGN_UP' | 'POST_CONFIRMATION' | 'PRE_TOKEN_GENERATION' | 'USER_MIGRATION' | 'DEFINE_AUTH_CHALLENGE' | 'CREATE_AUTH_CHALLENGE' | 'POST_AUTHENTICATION' | 'PRE_AUTHENTICATION' | 'PRE_TOKEN_GENERATION_CONFIG' | 'VERIFY_AUTH_CHALLENGE_RESPONSE' | 'CUSTOM_EMAIL_SENDER' | 'CUSTOM_SMS_SENDER';
/**
 * Configuration interface for social identity providers.
 */
export interface ISocialProviderConfig {
    /**
     * OAuth client ID for the social provider
     */
    clientId: string;
    /**
     * OAuth client secret for the social provider
     */
    clientSecret: string;
    /**
     * Optional OAuth scopes to request
     */
    scopes?: string[];
    /**
     * Optional attribute mapping from provider to Cognito
     */
    attributeMapping?: {
        [key: string]: string;
    };
}
/**
 * Configuration for the Cognito domain
 */
export interface IDomainConfig {
    /**
     * The domain prefix for Cognito hosted UI.
     * If using a custom domain, this is ignored.
     */
    cognitoDomainPrefix?: string;
    /**
     * Configuration for a custom domain
     */
    customDomain?: {
        /**
         * The domain name to use (e.g. 'auth.example.com')
         */
        domainName: string;
        /**
         * The ARN of an existing ACM certificate for the domain
         */
        certificateArn: string;
    };
}
/**
 * Configuration interface for the AuthConstruct.
 */
export interface IAuthConstructConfig extends IConstructConfig {
    /**
     * Configuration for the User Pool.
     */
    userPool?: {
        props: UserPoolProps;
        /**
         * Domain configuration for the user pool.
         * Required for social sign-in and hosted UI features.
         */
        domain?: IDomainConfig;
        /**
         * Configuration for social identity providers.
         * When configured, OAuth flows are automatically enabled with appropriate settings.
         */
        socialProviders?: {
            /**
             * Google identity provider configuration
             */
            google?: ISocialProviderConfig;
            /**
             * Facebook identity provider configuration
             */
            facebook?: ISocialProviderConfig;
        };
    };
    /**
     * Configuration for the User Pool Client.
     */
    userPoolClient?: {
        props: UserPoolClientOptions;
    };
    /**
     * Array of policies to attach to the default authenticated role.
     */
    policies?: Array<PolicyStatementProps | PolicyStatement>;
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
         * Array of policies to attach to the group.
         */
        policies?: Array<PolicyStatementProps | PolicyStatement>;
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
    /**
     * Configuration for a custom Lambda authorizer.
     */
    customAuthorizer?: {
        type: string;
        functionProps: LambdaFunctionProps;
    };
    /**
     * How to resolve ambiguous role assignments.
     * Defaults to "UseDefaultRole" which will use the default authenticated role when there's ambiguity.
     * Can be set to "Deny" to deny access when there's ambiguity.
     */
    ambiguousRoleResolution?: 'UseDefaultRole' | 'Deny';
}
export declare class AuthConstruct implements FW24Construct {
    private authConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
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
    constructor(authConstructConfig: IAuthConstructConfig);
    construct(): Promise<void>;
    private createUserPoolAuthorizer;
    private createIdentityPoolAuthorizer;
    private mapTriggerType;
    private createUniqueUserPoolName;
    private configureSocialProviders;
    private configureDomain;
    private createLambdaAuthorizer;
}
