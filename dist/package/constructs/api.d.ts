import type { RestApiProps } from "aws-cdk-lib/aws-apigateway";
import { RestApi } from "aws-cdk-lib/aws-apigateway";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
import { ApiKey, UsagePlan, Period } from "aws-cdk-lib/aws-apigateway";
/**
 * Represents the configuration options for an API construct.
 */
export interface IAPIConstructConfig extends IConstructConfig {
    /**
     * Specifies the CORS configuration for the API.
     * It can be a boolean value, a single string, or an array of strings.
     */
    cors?: boolean | string | string[];
    /**
     * Specifies additional options for the API.
     */
    apiOptions?: RestApiProps;
    /**
     * Specifies the directory where the controllers are located.
     */
    controllersDirectory?: string;
    /**
     * Specifies the properties for the Node.js function.
     */
    functionProps?: NodejsFunctionProps;
    /**
     * Specifies the number of days to retain the API logs.
     */
    logRetentionDays?: RetentionDays;
    /**
     * Specifies the removal policy for the API logs.
     */
    logRemovalPolicy?: RemovalPolicy;
    /**
     * The custom domain name for the API.
     */
    domainName?: string;
    /**
     * The certificate ARN for the custom domain name.
     */
    certificateArn?: string;
    /**
     * API Gateway Lambda integration timeout in seconds.
     */
    integrationTimeout?: number;
    /**
     * The parent stack name for the Controllers.
     */
    controllerParentStackName?: string;
    /**
     * Set to false if you want to skip creation of controllers resources and methods
     * This will delete all the controllers resources and methods from the API
     */
    skipControllers?: boolean;
    /**
     * Force a deployment of the API when using imported APIs
     */
    forceDeployment?: boolean;
    /**
     * API key configuration for the API
     */
    apiKeyConfig?: {
        /**
         * List of valid API keys. If empty, keys will be auto-generated
         */
        keys?: string[];
        /**
         * Name of the API key (used when auto-generating)
         */
        keyName?: string;
    };
    /**
     * Usage plan configuration for the API
     */
    usagePlans?: IUsagePlanConfig[];
}
/**
 * Configuration for API key within a usage plan
 */
interface IUsagePlanApiKeyConfig {
    /**
     * List of valid API keys. If empty, keys will be auto-generated
     */
    keys?: string[];
    /**
     * Name prefix for the API keys (used when auto-generating)
     */
    keyNamePrefix?: string;
}
/**
 * Configuration for a usage plan
 */
interface IUsagePlanConfig {
    /**
     * Name of the usage plan
     */
    name: string;
    /**
     * Description of the usage plan
     */
    description?: string;
    /**
     * Rate limit per second
     */
    rateLimit?: number;
    /**
     * Burst limit
     */
    burstLimit?: number;
    /**
     * Quota limit per period
     */
    quotaLimit?: number;
    /**
     * Quota period
     */
    quotaPeriod?: Period;
    /**
     * API key configuration for this usage plan
     */
    apiKeys?: IUsagePlanApiKeyConfig;
}
export declare class APIConstruct implements FW24Construct {
    private apiConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    api: RestApi;
    mainStack: Stack;
    usagePlans: Map<string, {
        plan: UsagePlan;
        name: string;
    }>;
    apiKeys: Map<string, ApiKey[]>;
    keyValues: Map<string, ApiKey>;
    private resources;
    private methods;
    private controllerStacks;
    constructor(apiConstructConfig: IAPIConstructConfig);
    construct(): Promise<void>;
    private getAPI;
    private registerControllers;
    private copyAndRegisterSystemControllers;
    private prepareEntryPackages;
    private registerController;
    private getStageName;
    private createDeployments;
    private createSingleDeployment;
    private getCorsPreflightOptions;
    private getCorsOrigins;
    private getOrCreateControllerResource;
    private createLambdaFunction;
    private extractDefaultAuthorizer;
    private getOrCreateRouteResource;
    private extractRouteAuthorizer;
    private createMethodOptions;
    private createSQSIntegration;
    private createSNSIntegration;
    private outputApiEndpoint;
    private setupUsagePlan;
}
export {};
