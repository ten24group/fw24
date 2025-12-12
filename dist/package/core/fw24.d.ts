import { App, Stack } from 'aws-cdk-lib';
import { IAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement, type PolicyStatementProps } from 'aws-cdk-lib/aws-iam';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { type ILambdaEnvConfig } from '../interfaces';
import { IApplicationConfig, SystemControllerDefinition, SystemUIPageDefinition } from '../interfaces/config';
import { FW24Construct, OutputType } from '../interfaces/construct';
import { type IDIContainer } from '../interfaces/di';
import { type IFw24Module } from './runtime/module';
import type { TImportedPolicy, TPolicyStatementOrProps, IFunctionResourceAccess } from '../constructs/lambda-function';
export declare class Fw24 {
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    appName: string;
    emailProvider: any;
    private config;
    private app;
    private stacks;
    private apis;
    private environmentVariables;
    private readonly globalEnvironmentVariables;
    private readonly globalPolicies;
    private globalResourceAccess;
    private readonly policyStatements;
    private defaultAuthorizer;
    private cognitoAuthorizers;
    private jwtAuthorizer;
    private dynamoTables;
    private static instance;
    private readonly queues;
    private readonly topics;
    private readonly modules;
    private readonly constructs;
    private readonly globalLambdaLayerNames;
    private readonly globalLambdaEntryPackages;
    private readonly systemUIConfigs;
    private readonly systemControllers;
    private constructor();
    static getInstance(): Fw24;
    setApp(app: App): void;
    getApp(): App;
    setConfig(config: IApplicationConfig): void;
    getConfig(): IApplicationConfig;
    getAppDIContainer(): IDIContainer;
    getLambdaEntryPackages(): string[];
    addGlobalLambdaEntryPackage(packageName: string, priority?: number): void;
    hasGlobalLambdaEntryPackage(packageName: string): boolean;
    removeGlobalLambdaEntryPackage(packageName: string): void;
    getGlobalLambdaLayerNames(): Set<string>;
    addGlobalLambdaLayerNames(layerName: string): void;
    hasGlobalLambdaLayerNames(layerName: string): boolean;
    removeGlobalLambdaLayerNames(layerName: string): void;
    addStack(name: string, stack: any): this;
    /**
     * Get a stack by name. If the stack does not exist, create it.
     *
     * @param name - The name of the stack to get.
     * @param parentStackName - The name of the parent stack.
     * @returns The stack.
     */
    getStack(name?: string, parentStackName?: string): any;
    getDefaultStackName(): string;
    useMultiStackSetup: (currentStackName?: string, resourceStack?: Stack) => boolean;
    addAPI(apiConstructName: string, name: string, api: any, isImported?: boolean): this;
    getAPI(apiConstructName: string, name: string): any;
    getAPIs(apiConstructName: string): any;
    hasImportedAPI(apiConstructName: string): boolean;
    addModule(name: string, module: IFw24Module): void;
    getModules(): Map<string, IFw24Module>;
    hasModules(): boolean;
    getUniqueName(name: string): string;
    getArn(type: string, name: string): string;
    setCognitoAuthorizer(name: string, authorizer: IAuthorizer, defaultAuthorizer?: boolean): void;
    getCognitoAuthorizer(name?: string): IAuthorizer | undefined;
    getAuthorizer(authorizationType: string, name?: string): IAuthorizer | undefined;
    setDefaultCognitoAuthorizerName(name: string): void;
    getDefaultCognitoAuthorizerName(): any;
    setEnvironmentVariable(name: string, value: any, prefix?: string): void;
    getEnvironmentVariable(name: string, prefix?: string, scope?: any): any;
    hasEnvironmentVariable(name: string, prefix?: string): boolean;
    resolveEnvVariables: (env?: ILambdaEnvConfig[], scope?: any) => any;
    /**
     * Resolves the value for the given template from the Fw24-scope env if it follows the conventions like `env:xxx:yyy`, `env:yyy`.
     *
     * @param keyTemplate - The template for the environment key to resolve.
     *  e.g. env:Users_Table_name, env:userModule:Users_Table_name
     * @returns The resolved value for the key.
     */
    tryResolveEnvKeyTemplate: (keyTemplate: string) => string;
    /**
     * Set a global environment variable. This variable will be available to all lambda functions.
     * @param name The name of the environment variable.
     * @param value The value of the environment variable.
     */
    setGlobalEnvironmentVariable(name: string, value: any): void;
    getGlobalEnvironmentVariables(): string[];
    /**
     * Add a policy statement that should be attached to ALL Lambda functions in the application.
     * This is useful for cross-cutting concerns like observability, logging, or shared resources.
     *
     * @example
     * // Add an imported policy by name
     * fw24.addGlobalPolicy('my-policy-name');
     * fw24.addGlobalPolicy('my-policy-name', 'my-prefix');
     * fw24.addGlobalPolicy({ name: 'my-policy-name', prefix: 'my-prefix', isOptional: true });
     *
     * // Add a direct policy statement
     * fw24.addGlobalPolicy(new PolicyStatement({
     *   effect: Effect.ALLOW,
     *   actions: ['s3:GetObject'],
     *   resources: ['*']
     * }));
     *
     * // Add policy statement props
     * fw24.addGlobalPolicy({
     *   effect: Effect.ALLOW,
     *   actions: ['s3:GetObject'],
     *   resources: ['*']
     * });
     *
     * @param policy The policy to add - can be a name string, TImportedPolicy, PolicyStatement, or PolicyStatementProps
     * @param prefix The prefix for imported policy name (optional, only used when policy is a string)
     * @param isOptional Whether the policy is optional (optional, only used when policy is a string)
     */
    addGlobalPolicy(policy: string | TPolicyStatementOrProps | TImportedPolicy, prefix?: string, isOptional?: boolean): void;
    /**
     * Get all global policies that should be attached to ALL Lambda functions.
     * @returns Set of policies (can be TPolicyStatementOrProps or TImportedPolicy)
     */
    getGlobalPolicies(): Set<TPolicyStatementOrProps | TImportedPolicy>;
    /**
     * Set global resource access that should be applied to ALL Lambda functions.
     * This replaces any existing global resource access configuration.
     *
     * @example
     * fw24.setGlobalResourceAccess({
     *   tables: ['users-table', { name: 'orders-table', access: ['read'] }],
     *   buckets: ['assets-bucket'],
     *   queues: ['notifications-queue'],
     *   topics: ['events-topic']
     * });
     *
     * @param resourceAccess The resource access configuration
     */
    setGlobalResourceAccess(resourceAccess: IFunctionResourceAccess): void;
    /**
     * Add to global resource access configuration.
     * This merges with existing global resource access configuration.
     *
     * @example
     * fw24.addGlobalResourceAccess({
     *   tables: ['users-table'],
     *   buckets: ['assets-bucket']
     * });
     *
     * @param resourceAccess The resource access to add
     */
    addGlobalResourceAccess(resourceAccess: Partial<IFunctionResourceAccess>): void;
    /**
     * Get global resource access configuration.
     * @returns The global resource access configuration
     */
    getGlobalResourceAccess(): IFunctionResourceAccess;
    setPolicy(policyName: string, value: PolicyStatementProps | PolicyStatement, prefix?: string): void;
    getPolicy(policyName: string, prefix?: string): PolicyStatementProps | PolicyStatement | undefined;
    hasPolicy(policyName: string, prefix?: string): boolean;
    setConstructOutput(construct: FW24Construct, key: string, value: any, outputType?: OutputType, exportValueKey?: string, exportValueAlias?: string): void;
    addDynamoTable(name: string, table: TableV2): void;
    getDynamoTable(name: string): TableV2;
    /**
     * Gets a queue reference by name, following the framework's pattern for existing resource references.
     * @param queueName The name of the queue
     * @param scope Optional scope for stack resolution
     * @param constructId Optional construct ID for unique naming
     * @returns Queue instance referenced by ARN
     */
    getQueueByName(queueName: string, scope?: any, constructId?: string): IQueue;
    /**
     * Gets a topic reference by name, following the framework's pattern for existing resource references.
     * @param topicName The name of the topic
     * @param scope Optional scope for stack resolution
     * @param constructId Optional construct ID for unique naming
     * @returns Topic instance referenced by ARN
     */
    getTopicByName(topicName: string, scope?: any, constructId?: string): ITopic;
    addRouteToRolePolicy(route: string, groups: string[], requireRouteInGroupConfig?: boolean): void;
    getRoutePolicyStatement(route: string): PolicyStatement;
    getConstructOutput<T>(type: OutputType, name: string): T | undefined;
    addConstruct(construct: FW24Construct): void;
    getVpc(vpcName: string): Vpc;
    getHostedZone(domainName: string): IHostedZone;
    setJwtAuthorizer(authorizer: IAuthorizer, defaultAuthorizer?: boolean): void;
    getJwtAuthorizer(): IAuthorizer | undefined;
    registerSystemController(controller: SystemControllerDefinition): void;
    hasSystemController(path: string): boolean;
    getSystemController(path: string): SystemControllerDefinition | undefined;
    hasSystemControllers(): boolean;
    getSystemControllers(): SystemControllerDefinition[];
    registerSystemUIConfig(name: string, config: SystemUIPageDefinition): Promise<void>;
    hasSystemUIConfig(name: string): boolean;
    getSystemUIConfig(name: string): SystemUIPageDefinition | undefined;
    getSystemUIConfigs(): SystemUIPageDefinition[];
    hasSystemUIConfigs(): boolean;
}
