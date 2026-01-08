import type {
    AuthorizationType,
    CorsOptions,
    IResource,
    Method,
    MethodOptions,
    RestApiProps
} from "aws-cdk-lib/aws-apigateway";

import {
    AwsIntegration,
    CfnResource,
    Cors,
    Deployment,
    Resource,
    ResponseType,
    RestApi,
    ApiKey,
    Period,
    UsagePlan
} from "aws-cdk-lib/aws-apigateway";

import { CfnOutput, Duration, NestedStack, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";

import { Role, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Queue } from "aws-cdk-lib/aws-sqs";

import type { IFw24Module } from "../core/";
import type HandlerDescriptor from "../interfaces/handler-descriptor";

import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Helper } from "../core/helper";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { createLogger } from "../logging";
import Mutable from "../types/mutable";
import { merge } from "../utils";
import { LambdaFunction } from "./lambda-function";
import { LambdaIntegration } from "./lambda-integration";

interface IAPIReference {
    api: RestApi;
    isImported: boolean;
}

interface IAuthorizerConfig {
    name?: string;
    type?: string;
    groups?: string | string[];
    requireRouteInGroupConfig?: boolean;
    default?: boolean;
}

interface IControllerConfigWithAuthorizer extends IControllerConfig {
    requireRouteInGroupConfig?: boolean;
    authorizer?: string | IAuthorizerConfig | IAuthorizerConfig[];
}

interface IRouteWithAuthorizer {
    httpMethod: string;
    path: string;
    target?: string;
    parameters?: string[] | String[];
    authorizer?: string | IAuthorizerConfig;
}

import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path, { join } from 'node:path';
import { IControllerConfig } from "../decorators/controller";
import { ENV_KEYS } from "../fw24";
import { IConstructConfig } from "../interfaces/construct-config";
import { isArray, isString } from "../utils";
import { AuthConstruct } from "./auth";
import { CertificateConstruct } from "./certificate";
import { DynamoDBConstruct } from "./dynamodb";
import { LayerConstruct } from "./layer";
import { MailerConstruct } from "./mailer";
import { QueueConstruct } from "./queue";
import { TopicConstruct } from "./topic";
import { VpcConstruct } from "./vpc";

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
     * Enable automatic resource migration for nested controller root resources.
     * 
     * When enabled, a migration resolver runs during deployment to:
     * 1. Query AWS to detect if root resources are in the wrong stack
     * 2. Delete conflicting resources (if any)
     * 3. Allow CloudFormation to recreate them in the correct location
     * 
     * The resolver is idempotent - if resources are already correct, it does nothing.
     * 
     * When disabled (default), CloudFormation will fail with "resource already exists" 
     * if there's a conflict, allowing manual intervention.
     * 
     * Enable this if you're adding new controllers to existing nested paths and 
     * encounter resource conflict errors during deployment.
     * 
     * ⚠️  First-time migration may cause brief API downtime (~30-60s).
     * 
     * @default false
     */
    enableAutoResourceMigration?: boolean;

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

export class APIConstruct implements FW24Construct {
    readonly logger = createLogger(APIConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = APIConstruct.name;
    dependencies: string[] = [ VpcConstruct.name, MailerConstruct.name, DynamoDBConstruct.name, AuthConstruct.name, QueueConstruct.name, TopicConstruct.name, LayerConstruct.name ];
    output!: FW24ConstructOutput;

    api!: RestApi;
    mainStack!: Stack;
    usagePlans: Map<string, { plan: UsagePlan; name: string }> = new Map();
    apiKeys: Map<string, ApiKey[]> = new Map();
    keyValues: Map<string, ApiKey> = new Map();

    private resources: IResource[] = [];
    private methods: Method[] = [];
    private readonly controllerStacks = new Map<string, { methods: Method[], resources: IResource[], controllersHash: string[] }>();

    // default constructor to initialize the stack configuration
    constructor(private readonly apiConstructConfig: IAPIConstructConfig) {
        // hydrate the config object with environment variables ex: APIGATEWAY_CONTROLLERS
        Helper.hydrateConfig(apiConstructConfig, 'APIGATEWAY');
    }

    // construct method to create the stack
    public async construct() {
        // set the default api options
        const paramsApi: Mutable<RestApiProps> = { ...this.apiConstructConfig.apiOptions || {} };
        // Enable CORS if defined
        if (this.apiConstructConfig.cors) {
            this.logger.debug("Enabling CORS... this.config.cors: ", this.apiConstructConfig.cors);
            paramsApi.defaultCorsPreflightOptions = this.getCorsPreflightOptions();
        }
        if (this.apiConstructConfig.domainName && this.apiConstructConfig.domainName.length > 0) {
            const certificateConstruct = new CertificateConstruct({
                domainName: this.apiConstructConfig.domainName,
                certificateArn: this.apiConstructConfig.certificateArn
            });
            certificateConstruct.construct();
            const certificate = certificateConstruct.output[ OutputType.CERTIFICATE ][ this.apiConstructConfig.domainName ];
            paramsApi.domainName = {
                domainName: this.apiConstructConfig.domainName,
                certificate: certificate,
                basePath: paramsApi.deployOptions?.stageName || '/',
            };
        }
        // for multistack application, set deploy to false
        if (this.fw24.useMultiStackSetup()) {
            paramsApi.deploy = false;
            delete paramsApi.deployOptions;
        }
        this.logger.debug("Creating API Gateway... ");
        // get the main stack from the framework
        this.mainStack = this.fw24.getStack(this.apiConstructConfig.stackName, this.apiConstructConfig.parentStackName);
        // create the api gateway
        this.api = new RestApi(this.mainStack, `${this.fw24.appName}-api`, {
            ...paramsApi,
        });

        if (this.apiConstructConfig.cors) {
            const corsOrigins = this.getCorsPreflightOptions().allowOrigins?.join(',');
            this.api.addGatewayResponse('default4xx', {
                type: ResponseType.DEFAULT_4XX,
                responseHeaders: {
                    'Access-Control-Allow-Origin': `'${corsOrigins}'`,
                }
            });
            this.api.addGatewayResponse('default5xx', {
                type: ResponseType.DEFAULT_5XX,
                responseHeaders: {
                    'Access-Control-Allow-Origin': `'${corsOrigins}'`,
                }
            });
        }

        // Set up usage plans if configured
        if (this.apiConstructConfig.usagePlans?.length) {
            for (const planConfig of this.apiConstructConfig.usagePlans) {
                this.setupUsagePlan(planConfig);
            }
        }

        this.fw24.addAPI(this.name, 'root', this.api, false);
        this.fw24.setConstructOutput(this, 'restAPI', this.api, OutputType.API, 'restApiId');
        this.fw24.setConstructOutput(this, 'restAPI', this.api, OutputType.API, 'restApiRootResourceId');

        if (this.apiConstructConfig.skipControllers) {
            return;
        }

        await this.registerControllers();

        // if multi/nested-stack setup, then create one deployment per controller stack
        this.logger.info(`API-gateway construct: ${this.name} has imported APIs: ${this.fw24.hasImportedAPI(this.name)}`);
        if (this.fw24.hasImportedAPI(this.name) && this.fw24.useMultiStackSetup()) {
            await this.createDeployments();
        } else if (this.fw24.hasImportedAPI(this.name)) {
            await this.createSingleDeployment();
        }
    }

    private readonly getAPI = (stackName: string): IAPIReference => {
        let currentAPI = this.fw24.getAPI(this.name, 'root') as IAPIReference | undefined;

        // if the stack is not the main stack and its a multi-stack application or a nested stack, then import the API
        const currentStack = this.fw24.getStack(stackName);
        this.logger.debug(`Current Stack: ${currentStack.stackName} is nested stack: ${currentStack instanceof NestedStack}`);
        if (this.fw24.useMultiStackSetup(stackName, this.mainStack) || currentStack instanceof NestedStack) {
            currentAPI = this.fw24.getAPI(this.name, stackName) as IAPIReference | undefined;
            if (!currentAPI) {
                const importedAPI = RestApi.fromRestApiAttributes(currentStack, `${this.fw24.appName}-${stackName}-api`, {
                    restApiId: this.fw24.getEnvironmentVariable('restAPI_restApiId', 'api', currentStack),
                    rootResourceId: this.fw24.getEnvironmentVariable('restAPI_restApiRootResourceId', 'api', currentStack),
                });
                this.fw24.addAPI(this.name, stackName, importedAPI, true);
                currentAPI = this.fw24.getAPI(this.name, stackName) as IAPIReference;
            }
        }

        if (!currentAPI) {
            throw new Error(`API not found for stack: ${stackName}`);
        }

        return currentAPI;
    }

    private async registerControllers() {
        // sets the default controllers directory if not defined
        const controllersDirectory = this.apiConstructConfig.controllersDirectory || "./src/controllers";

        // Phase 1: Collect all controller descriptors
        const controllerDescriptors: HandlerDescriptor[] = [];
        const collectController = (desc: HandlerDescriptor) => {
            controllerDescriptors.push(desc);
        };

        await Helper.registerHandlers(controllersDirectory, collectController);

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("API-gateway stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [ , module ] of modules) {
                const basePath = module.getBasePath();
                this.logger.debug("Load controllers from module base-path: ", basePath);
                Helper.registerControllersFromModule(module, collectController);
            }
        } else {
            this.logger.debug("API-gateway stack: construct: app has NO modules ");
        }

        // Phase 2: Handle root resource migration for nested controllers
        this.setupRootPathResources(controllerDescriptors);

        // Phase 3: Register all controllers
        for (const desc of controllerDescriptors) {
            await this.registerController(desc);
        }

        // Register system controllers from fw24 singleton
        if (this.fw24.hasSystemControllers()) {
            this.logger.debug("API-gateway stack: construct: registering system controllers");
            await this.copyAndRegisterSystemControllers();
        } else {
            this.logger.debug("API-gateway stack: construct: app has NO system controllers");
        }
    }

    /**
     * Sets up root path resources in the main stack for nested controllers.
     * If enableAutoResourceMigration is true, creates a migration resolver to handle any conflicts.
     */
    private setupRootPathResources(descriptors: HandlerDescriptor[]): void {
        if (!this.apiConstructConfig.controllerParentStackName) {
            return; // No nested stacks, nothing to do
        }

        // Identify all unique root paths from nested controllers
        const rootPaths = new Set<string>();
        for (const desc of descriptors) {
            const { handlerClass, fileName } = desc;
            const folderPath = fileName.split('/').slice(0, -1).join('/');
            const handlerInstance = new handlerClass();
            const controllerName = fileName.includes('/') ? folderPath + '/' + handlerInstance.controllerName : handlerInstance.controllerName;
            const pathParts = controllerName.split('/');
            if (pathParts.length > 1) {
                rootPaths.add(pathParts[ 0 ]);
            }
        }

        if (rootPaths.size === 0) {
            return;
        }

        this.logger.info(`🏗️  Managing ${rootPaths.size} root resource(s) for nested controllers: ${Array.from(rootPaths).join(', ')}`);

        // Check if automatic resource migration is enabled
        const autoMigrationEnabled = this.apiConstructConfig?.enableAutoResourceMigration === true;

        let migrationResolver: AwsCustomResource | undefined;
        if (autoMigrationEnabled) {
            // Create resource migration resolver to handle any conflicts
            // The resolver queries AWS state and only deletes resources if they're in the wrong stack
            // It's idempotent and safe to run on every deployment
            this.logger.info(`🔄 Resource migration enabled - will handle conflicts automatically`);
            migrationResolver = this.createResourceMigrationResolver(Array.from(rootPaths));
        }
        // Create root resources in main stack
        for (const rootPath of rootPaths) {
            this.logger.info(`🆕 Creating /${rootPath} in main stack as CloudFormation resource...`);

            // Create the resource as an explicit CloudFormation resource
            // This is necessary because this.api is imported, so addResource() doesn't create CFN resources
            const cfnResource = new CfnResource(this.mainStack, `RootResource-${rootPath}`, {
                parentId: this.api.root.resourceId,
                pathPart: rootPath,
                restApiId: this.api.restApiId,
            });

            // If migration resolver was created, make this resource depend on it
            // This ensures any conflicting resources are deleted before we try to create new ones
            if (migrationResolver) {
                cfnResource.node.addDependency(migrationResolver);
                this.logger.info(`   🔗 Added dependency on migration resolver`);
            }

            // Wrap the CfnResource in an IResource for compatibility
            const rootResource = Resource.fromResourceAttributes(this.mainStack, `RootResourceWrapper-${rootPath}`, {
                resourceId: cfnResource.ref,
                restApi: this.api,
                path: `/${rootPath}`
            });

            // Don't add CORS preflight here - nested stacks will handle it
            this.logger.info(`   ℹ️  Nested stacks will add CORS preflight methods`);

            // Store resource ID - fw24 will pass this to nested stacks as parameters
            this.fw24.setConstructOutput(this, `restAPI_controller_${rootPath}`, rootResource, OutputType.RESOURCE, 'resourceId');
            this.logger.info(`💾 Stored /${rootPath} resourceId for nested stack parameters`);
        }
    }

    /**
     * Creates a resource migration resolver that handles migration of API Gateway resources
     * from nested stacks to the main stack.
     * 
     * This resolver:
     * 1. Queries actual AWS state (API Gateway + CloudFormation)
     * 2. Detects which resources are in the wrong stack (nested vs main)
     * 3. Selectively deletes only conflicting resources from AWS
     * 4. Allows CloudFormation to create them in the correct stack
     * 5. Is idempotent - safe to run on every deployment
     * 
     * @param rootPaths - All root paths to check and potentially migrate
     */
    private createResourceMigrationResolver(rootPaths: string[]): AwsCustomResource {
        this.logger.info(`🧹 Creating resource migration resolver for ${rootPaths.length} path(s)...`);

        const migrationHandler = this.createMigrationHandlerLambda();

        // The custom resource calls the Lambda which will:
        // 1. Query AWS API Gateway to get actual resource locations
        // 2. Query CloudFormation to determine which stack owns each resource
        // 3. Identify conflicts (resource in nested stack but needed in main)
        // 4. Delete ONLY those resources that are actually conflicting
        // 5. Return detailed information about what was done
        // 
        // This is IDEMPOTENT - if resources are already in the right place, it does nothing.
        // This runs BEFORE CloudFormation creates the new resources in the main stack.

        const payload = {
            restApiId: this.api.restApiId,
            rootPaths: rootPaths,
            mainStackName: Stack.of(this.mainStack).stackName,
            mode: 'migrate'
        };

        const resolverResource = new AwsCustomResource(this.mainStack, 'ResourceMigrationResolver', {
            onCreate: {
                service: 'Lambda',
                action: 'invoke',
                parameters: {
                    FunctionName: migrationHandler.functionName,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload)
                },
                physicalResourceId: PhysicalResourceId.of(`resource-migration-resolver-${Date.now()}`)
            },
            onUpdate: {
                service: 'Lambda',
                action: 'invoke',
                parameters: {
                    FunctionName: migrationHandler.functionName,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload)
                },
                physicalResourceId: PhysicalResourceId.of(`resource-migration-resolver-${Date.now()}`)
            },
            policy: AwsCustomResourcePolicy.fromStatements([
                new PolicyStatement({
                    actions: [ 'lambda:InvokeFunction' ],
                    resources: [ migrationHandler.functionArn ]
                })
            ]),
            installLatestAwsSdk: false
        });

        this.logger.info(`✅ Resource migration resolver created - will run before resource creation`);
        return resolverResource;
    }

    /**
     * Creates a Lambda function that handles resource migration.
     * This Lambda:
     * - Verifies actual resource locations in AWS
     * - Detects conflicts and migration needs
     * - Selectively deletes only problematic resources
     * - Returns detailed resolution report
     */
    private createMigrationHandlerLambda(): NodejsFunction {
        const migrationHandler = new NodejsFunction(this.mainStack, 'ApiGatewayResourceMigrationHandler', {
            entry: join(__dirname, 'api-gateway-resource-migration-handler.js'),
            handler: 'handler',
            timeout: Duration.minutes(5),
            bundling: {
                externalModules: [
                    '@aws-sdk/client-api-gateway',
                    '@aws-sdk/client-cloudformation'
                ]
            },
            initialPolicy: [
                new PolicyStatement({
                    actions: [
                        'apigateway:GET',
                        'apigateway:DELETE'
                    ],
                    resources: [
                        `arn:aws:apigateway:${Stack.of(this.mainStack).region}::/restapis/${this.api.restApiId}`,
                        `arn:aws:apigateway:${Stack.of(this.mainStack).region}::/restapis/${this.api.restApiId}/*`
                    ]
                }),
                new PolicyStatement({
                    actions: [
                        'cloudformation:DescribeStacks',
                        'cloudformation:DescribeStackResources',
                        'cloudformation:ListStackResources'
                    ],
                    resources: [
                        `arn:aws:cloudformation:${Stack.of(this.mainStack).region}:${Stack.of(this.mainStack).account}:stack/${Stack.of(this.mainStack).stackName}`,
                        `arn:aws:cloudformation:${Stack.of(this.mainStack).region}:${Stack.of(this.mainStack).account}:stack/${Stack.of(this.mainStack).stackName}-*/*`
                    ]
                }),
                new PolicyStatement({
                    actions: [ 'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents' ],
                    resources: [ '*' ]
                })
            ]
        });

        return migrationHandler;
    }

    private async copyAndRegisterSystemControllers() {
        const systemControllersTargetDir = path.join(process.cwd(), 'dist', 'system-controllers');

        // Ensure target directory exists
        if (!existsSync(systemControllersTargetDir)) {
            mkdirSync(systemControllersTargetDir, { recursive: true });
        }

        for (const systemController of this.fw24.getSystemControllers()) {
            let relativePathFromFramework = '';
            // Fallback: use the last few directories to preserve structure
            const pathParts = systemController.filePath.split('/');
            const relevantParts = pathParts.slice(-3); // e.g., ['search', 'system', 'search-controller.js']
            relativePathFromFramework = relevantParts.join('/');

            this.logger.warn(`System controller relative path: ${relativePathFromFramework}`);

            const targetFilePath = path.join(systemControllersTargetDir, relativePathFromFramework);
            const targetDirectory = path.dirname(targetFilePath);

            this.logger.debug(`System controller target-directory: ${targetDirectory}, targetFilePath: ${targetFilePath}`);

            // Ensure target subdirectory exists
            if (!existsSync(targetDirectory)) {
                mkdirSync(targetDirectory, { recursive: true });
            }

            // Copy the system controller file
            copyFileSync(systemController.filePath, targetFilePath);

            this.logger.debug(`Copied system controller from ${systemController.filePath} to ${targetFilePath}`);

            // Register from the copied location
            const directory = path.dirname(targetFilePath);
            const fileName = path.basename(targetFilePath);

            this.logger.debug(`Registering system controller: ${fileName}`);

            await Helper.registerHandlers(
                directory,
                this.registerController,
                [ fileName ]
            );
        }
    }

    private prepareEntryPackages(controllerConfig: IControllerConfig, ownerModule?: IFw24Module): string[] {
        let entryPackages = controllerConfig.entryPackages || [];

        if (isArray(entryPackages)) {
            entryPackages = {
                override: false,
                packageNames: entryPackages
            }
        }

        // if the controller does not want to override the application/module entry packages and include them as well
        if (!entryPackages.override) {
            const moduleEntryPackages = ownerModule?.getLambdaEntryPackages() || [];
            const appEntryPackages = this.fw24.getLambdaEntryPackages();
            entryPackages.packageNames = [
                ...entryPackages.packageNames,
                ...moduleEntryPackages,
                ...appEntryPackages
            ];
        }

        return entryPackages.packageNames.map(this.fw24.tryResolveEnvKeyTemplate);
    }


    // register a single controller
    private readonly registerController = async (controllerInfo: HandlerDescriptor, ownerModule?: IFw24Module) => {
        const { handlerClass, filePath, fileName } = controllerInfo;
        // Add the folder path from filename to the controller name
        const folderPath = fileName.split('/').slice(0, -1).join('/');
        const handlerInstance = new handlerClass();
        const controllerName = fileName.includes('/') ? folderPath + '/' + handlerInstance.controllerName : handlerInstance.controllerName;
        const controllerConfig: IControllerConfig = handlerInstance?.controllerConfig || {};
        const controllerStackName = controllerConfig.stackName || controllerName;
        const parentStackName = controllerConfig.parentStackName || this.apiConstructConfig.controllerParentStackName;

        // Initialize controller stack info if not exists
        if (!this.controllerStacks.has(controllerStackName)) {
            this.controllerStacks.set(controllerStackName, {
                methods: [],
                resources: [],
                controllersHash: []
            });
        }

        // make sure the controller stack exists
        this.fw24.getStack(controllerStackName, parentStackName);
        controllerInfo.routes = handlerInstance.routes;

        this.logger.debug(`Registering controller ${controllerName}`);

        // prepare the entry packages for the controller's lambda function
        const entryPackages = this.prepareEntryPackages(controllerConfig, ownerModule);
        controllerConfig.entryPackages = entryPackages;

        this.resources = [];
        this.methods = [];
        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.getOrCreateControllerResource(controllerName, controllerStackName);

        let controllerTarget = controllerConfig.target;
        let controllerIntegration: LambdaIntegration | AwsIntegration | undefined;
        // create lambda function for the controller
        if (controllerTarget === 'function' || controllerTarget === undefined) {
            controllerConfig.logRetentionDays = controllerConfig.logRetentionDays || this.apiConstructConfig.logRetentionDays;
            controllerConfig.logRemovalPolicy = controllerConfig.logRemovalPolicy || this.apiConstructConfig.logRemovalPolicy;
            const controllerLambda = this.createLambdaFunction(controllerName, filePath, fileName, controllerConfig, controllerStackName);
            this.fw24.setConstructOutput(this, controllerName, controllerLambda, OutputType.FUNCTION);

            controllerIntegration = new LambdaIntegration(controllerLambda, {
                restApi: this.getAPI(controllerStackName).api,
                path: controllerName,
                timeout: Duration.seconds(this.apiConstructConfig.integrationTimeout || 29),
            });
        }

        const { defaultAuthorizerName, defaultAuthorizerType, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig } = this.extractDefaultAuthorizer(controllerConfig);

        this.logger.debug(`Register Controller ~ Default Authorizer: name: ${defaultAuthorizerName} - type: ${defaultAuthorizerType} - groups: ${defaultAuthorizerGroups}`);

        // Set up API key if required
        if (controllerConfig.requireApiKey) {
            this.setupUsagePlan(undefined, true);
        }

        // Set up routes for the controller
        for (const route of Object.values(controllerInfo.routes ?? {})) {
            this.logger.debug(`Registering route ${route.httpMethod} ${route.path}`);
            const routeTarget = route.target || controllerTarget;
            const currentResource = this.getOrCreateRouteResource(controllerResource, route.path, controllerStackName);
            const { routeAuthorizerName, routeAuthorizerType, routeAuthorizerGroups, routeRequireRouteInGroupConfig } = this.extractRouteAuthorizer(route, defaultAuthorizerType, defaultAuthorizerName, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig);
            this.logger.debug(`Registering route Authorizer: ${routeAuthorizerName} - ${routeAuthorizerType} - ${routeAuthorizerGroups}`);

            let methodOptions = this.createMethodOptions(route, routeAuthorizerType, routeAuthorizerName, controllerConfig);

            if (routeTarget === 'queue') {
                const queueName = route.path.replace('/', '');
                controllerIntegration = this.createSQSIntegration(queueName, controllerName, controllerStackName);
                methodOptions = {
                    ...methodOptions,
                    methodResponses: [
                        {
                            statusCode: "202",
                        },
                        {
                            statusCode: "400",
                        },
                        {
                            statusCode: "500",
                        },
                    ],
                }
            } else if (routeTarget === 'topic') {
                const topicName = route.path.replace('/', '');
                controllerIntegration = this.createSNSIntegration(topicName, controllerName, controllerStackName);
                methodOptions = {
                    ...methodOptions,
                    methodResponses: [
                        {
                            statusCode: "202",
                        },
                        {
                            statusCode: "400",
                        },
                        {
                            statusCode: "500",
                        },
                    ],
                }
            }

            const method = currentResource.addMethod(route.httpMethod, controllerIntegration, methodOptions);
            this.methods.push(method);

            // if authorizer is AWS_IAM, then add the route to the policy
            if (routeAuthorizerType === 'AWS_IAM') {
                let fullRoutePath = controllerName + route.path;

                // * replace each param placeholder `{id}` with an `*`
                route.parameters?.forEach(par => {
                    fullRoutePath = fullRoutePath.replace(`{${par}}`, '*');
                })

                this.fw24.addRouteToRolePolicy(fullRoutePath, routeAuthorizerGroups, routeRequireRouteInGroupConfig);
            }
        }

        // keep track of the controller stacks with methods and resources in a multi-stack setup to create one deployment per controller stack
        if (this.fw24.hasImportedAPI(this.name)) {
            const stackInfo = this.controllerStacks.get(controllerStackName);
            if (stackInfo) {
                stackInfo.methods = [ ...this.methods ];
                stackInfo.resources = [ ...this.resources ];
                stackInfo.controllersHash.push(createHash('md5').update(JSON.stringify(controllerConfig)).digest('hex'));
            }
        }

        // output the api endpoint
        this.outputApiEndpoint(controllerName, controllerResource, this.getStageName(), controllerStackName);
    }

    private readonly getStageName = () => {
        return this.apiConstructConfig.apiOptions?.deployOptions?.stageName || 'prod';
    }

    // if the API is imported, then create one deployment per controller stack and add method and resource as dependency
    // This is needed because imported API does not propogate CORS settings to the methods
    private async createDeployments() {

        const stageName = this.getStageName();
        for (const [ controllerStackName, { methods, resources, controllersHash } ] of this.controllerStacks.entries()) {
            // TODO: add better logic to force a deployment when there is a change in framework code
            if (this.apiConstructConfig.forceDeployment) {
                controllersHash.push(randomUUID());
            }

            const controllerHash = createHash('md5').update(JSON.stringify(controllersHash)).digest('hex');
            this.logger.debug(`Creating deployment for controller stack ${controllerStackName} with hash ${controllerHash}`);
            const deployment = new Deployment(this.fw24.getStack(controllerStackName), `deployment-${controllerHash}`, {
                api: this.getAPI(controllerStackName).api,
                stageName: stageName,
            });

            for (const method of methods) {
                this.logger.debug(`Adding method dependency ${method.httpMethod} ${method.resource.path} to deployment`);
                deployment.node.addDependency(method)
            }

            // add dependecy on all resources for this controller
            for (const resource of resources) {
                this.logger.debug(`Adding resource dependency ${resource.path} to deployment`);
                deployment.node.addDependency(resource);
            }

        }
    }

    // if the api is imported and it's not a multi-stack setup, then create a single deployment for all controllers
    // Single deployment is needed to avoid simultation deployment which causes error on API Gateway
    private async createSingleDeployment() {
        const stageName = this.getStageName();
        if (this.apiConstructConfig.forceDeployment) {
            this.controllerStacks.forEach(c => c.controllersHash.push(randomUUID()));
        }
        // create the name from all the controller hash values combined as a single hash and add dependency on all the controllers
        const deploymentName = `deployment-${createHash('md5').update(Array.from(this.controllerStacks.values()).map(c => c.controllersHash).join('-')).digest('hex')}`;

        const deployment = new Deployment(this.fw24.getStack(this.name), deploymentName, {
            api: this.api,
            stageName: stageName,
        });

        for (const [ _controllerStackName, { methods, resources } ] of this.controllerStacks.entries()) {
            for (const method of methods) {
                this.logger.debug(`Adding method dependency ${method.httpMethod} ${method.resource.path} to deployment`);
                deployment.node.addDependency(method)
            }

            for (const resource of resources) {
                this.logger.debug(`Adding resource dependency ${resource.path} to deployment`);
                deployment.node.addDependency(resource);
            }
        }
    }

    private getCorsPreflightOptions(): CorsOptions {
        return {
            allowHeaders: [
                "Content-Type",
                "Authorization",
                "X-Api-Key",
                "X-Amz-Date",
                "X-Amz-Content-Sha256",
                "X-Amz-Security-Token",
                "Access-Control-Allow-Credentials",
                "Access-Control-Allow-Headers",
                "Access-Control-Allow-Origin",
                "Impersonating-User-Sub",
            ],
            allowMethods: [ "OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE" ],
            allowCredentials: true,
            allowOrigins: this.getCorsOrigins(),
        };
    }

    private getCorsOrigins(): string[] {
        if (this.apiConstructConfig.cors === true) return Cors.ALL_ORIGINS;
        if (typeof this.apiConstructConfig.cors === "string") return [ this.apiConstructConfig.cors ];
        return this.apiConstructConfig.cors || [];
    }

    private readonly getOrCreateControllerResource = (controllerName: string, controllerStackName: string): IResource => {
        let restAPI = this.getAPI(controllerStackName);
        let controllerResource: IResource = restAPI.api.root;
        const currentStack = this.fw24.getStack(controllerStackName);
        const pathParts = controllerName.split('/');
        const isNestedController = pathParts.length > 1;

        for (const pathPart of pathParts) {
            let childResource = controllerResource.getResource(pathPart) as IResource;
            const isRootPath = pathPart === pathParts[ 0 ];

            // For nested controllers, root resources should always be imported from main stack
            if (!childResource && isNestedController && isRootPath) {
                // Import the root resource from main stack (passed as parameter to nested stack)
                this.logger.debug(`Importing root resource /${pathPart} from main stack for controller ${controllerName}`);
                const controllerResourceId = this.fw24.getEnvironmentVariable(`restAPI_controller_${pathPart}_resourceId`, 'resource', currentStack);

                if (controllerResourceId) {
                    this.logger.debug(`Found resource ID from main stack parameter: ${controllerResourceId}`);
                    childResource = Resource.fromResourceAttributes(currentStack, `${this.fw24.appName}-${controllerStackName}-${pathPart}`, {
                        resourceId: controllerResourceId,
                        restApi: restAPI.api,
                        path: '/' + pathPart
                    });
                } else {
                    // This should not happen if setupRootPathResources ran correctly
                    this.logger.error(`CRITICAL: Root resource /${pathPart} not found in parameters for nested controller ${controllerName}`);
                    throw new Error(`Root resource /${pathPart} not available for import. This indicates a framework bug.`);
                }
            } else if (!childResource) {
                // Create non-root resources normally
                this.logger.debug(`Creating resource ${pathPart} under ${controllerResource.path}`);
                childResource = controllerResource.addResource(pathPart) as IResource;

                if (restAPI.isImported) {
                    const corsPreflightMethod = childResource.addCorsPreflight(this.getCorsPreflightOptions());
                    this.methods.push(corsPreflightMethod);
                }

                // NOTE: We don't set output for root paths here anymore - that's done in setupRootPathResources
            }

            controllerResource = childResource;
        }

        return controllerResource;
    }

    private readonly createLambdaFunction = (controllerName: string, filePath: string, fileName: string, controllerConfig: IControllerConfig, controllerStackName: string): NodejsFunction => {
        const functionProps = merge([
            this.apiConstructConfig.functionProps ?? {},
            controllerConfig?.functionProps ?? {}
        ])!;

        const envVariables = this.fw24.resolveEnvVariables(controllerConfig.env, this.fw24.getStack(controllerStackName));

        // do not override the entry packages if already set
        if (!(ENV_KEYS.ENTRY_PACKAGES in envVariables) && controllerConfig.entryPackages) {
            envVariables[ ENV_KEYS.ENTRY_PACKAGES ] = (controllerConfig.entryPackages as Array<string>).join(',');
        }

        return new LambdaFunction(this.fw24.getStack(controllerStackName), controllerName + "-controller", {
            entry: filePath + "/" + fileName,
            environmentVariables: envVariables,
            policies: controllerConfig?.policies,
            resourceAccess: controllerConfig?.resourceAccess,
            allowSendEmail: true,
            functionTimeout: controllerConfig?.functionTimeout || this.fw24.getConfig().functionTimeout,
            processorArchitecture: controllerConfig?.processorArchitecture,
            functionProps: functionProps,
            logRetentionDays: controllerConfig.logRetentionDays,
            logRemovalPolicy: controllerConfig.logRemovalPolicy,
        }) as NodejsFunction;
    }

    private readonly extractDefaultAuthorizer = (controllerConfig: IControllerConfigWithAuthorizer): { defaultAuthorizerName: string, defaultAuthorizerType: string, defaultAuthorizerGroups: string[], defaultRequireRouteInGroupConfig: boolean } => {
        let defaultAuthorizerName = this.fw24.getDefaultCognitoAuthorizerName();
        let defaultAuthorizerType;
        let defaultAuthorizerGroups;
        let defaultRequireRouteInGroupConfig = false;

        if (Array.isArray(controllerConfig?.authorizer)) {
            const defaultAuthorizer = (controllerConfig.authorizer as IAuthorizerConfig[]).find((auth) => auth.default) || controllerConfig.authorizer[ 0 ];
            defaultAuthorizerName = defaultAuthorizer.name || defaultAuthorizerName;
            defaultAuthorizerType = defaultAuthorizer.type;
            defaultAuthorizerGroups = defaultAuthorizer.groups || [];
            defaultRequireRouteInGroupConfig = defaultAuthorizer.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        } else if (typeof controllerConfig.authorizer === 'object') {
            defaultAuthorizerName = controllerConfig.authorizer.name || defaultAuthorizerName;
            defaultAuthorizerType = controllerConfig.authorizer.type;
            defaultAuthorizerGroups = controllerConfig.authorizer.groups || [];
            defaultRequireRouteInGroupConfig = controllerConfig.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        } else {
            defaultAuthorizerType = controllerConfig.authorizer;
        }

        if (!defaultAuthorizerType && this.fw24.getConfig().defaultAuthorizationType) {
            defaultAuthorizerType = this.fw24.getConfig().defaultAuthorizationType;
        }

        if (defaultAuthorizerGroups) {

            // if the value for the groups is a template string, 
            // resolve it [when the application want to allow multiple user groups to have access]
            // when the value is like "env:xxx:group1" ==> "group1-resolved" || "group1,group2" || "env:xxx:group1,env:xxx:group2"
            if (isString(defaultAuthorizerGroups)) {
                defaultAuthorizerGroups = this.fw24.tryResolveEnvKeyTemplate(defaultAuthorizerGroups)
            }
            // now if the resolved value is again a string, split it by comma
            // when the value is like "group1,group2" ==> ["group1", "group2"]
            if (isString(defaultAuthorizerGroups)) {
                defaultAuthorizerGroups = defaultAuthorizerGroups.split(',');
            }

            if (!defaultAuthorizerGroups.length && this.fw24.getConfig().defaultAdminGroups) {
                defaultAuthorizerGroups = this.fw24.getConfig().defaultAdminGroups;
            }

            // resolve the group names from fw24-scope if it's a template
            // when the value is like ["env:xxx:group1","env:xxx:group2"] ==> ["group1-resolved", "group2-resolved"]
            defaultAuthorizerGroups = (defaultAuthorizerGroups as Array<string>).map(this.fw24.tryResolveEnvKeyTemplate);

            // flat-map the groups if they resolved group values are again comma separated
            // when the resolved value is like ["a,b", "c,d"] ==> ["a", "b", "c", "d"]
            defaultAuthorizerGroups = defaultAuthorizerGroups.flatMap(group => group.split(','));
        }

        // Ensure defaultAuthorizerGroups is always an array
        const normalizedGroups: string[] = !defaultAuthorizerGroups
            ? []
            : Array.isArray(defaultAuthorizerGroups)
                ? defaultAuthorizerGroups
                : [ defaultAuthorizerGroups ];

        return {
            defaultAuthorizerName,
            defaultAuthorizerType,
            defaultAuthorizerGroups: normalizedGroups,
            defaultRequireRouteInGroupConfig
        };
    }

    private readonly getOrCreateRouteResource = (parentResource: IResource, path: string, controllerStackName: string): IResource => {
        let currentResource: IResource = parentResource;
        const restAPI = this.getAPI(controllerStackName);

        for (const pathPart of path.split("/")) {
            if (pathPart === "") {
                continue;
            }

            let childResource = currentResource.getResource(pathPart);
            if (!childResource) {
                childResource = currentResource.addResource(pathPart);
                if (restAPI.isImported) {
                    const corsPreflightMethod = childResource.addCorsPreflight(this.getCorsPreflightOptions());
                    this.methods.push(corsPreflightMethod);
                    this.resources.push(childResource);
                }
            }
            currentResource = childResource;
        }

        return currentResource;
    }

    private readonly extractRouteAuthorizer = (route: IRouteWithAuthorizer, defaultAuthorizerType: string, defaultAuthorizerName: string, defaultAuthorizerGroups: string[], defaultRequireRouteInGroupConfig: boolean): { routeAuthorizerName: string, routeAuthorizerType: string, routeAuthorizerGroups: string[], routeRequireRouteInGroupConfig: boolean } => {
        let routeAuthorizerName = defaultAuthorizerName;
        let routeAuthorizerType = defaultAuthorizerType;
        let routeAuthorizerGroups = defaultAuthorizerGroups;
        let routeRequireRouteInGroupConfig = defaultRequireRouteInGroupConfig;

        if (route.authorizer && typeof route.authorizer === 'object') {
            routeAuthorizerType = route.authorizer.type || defaultAuthorizerType;
            routeAuthorizerName = route.authorizer.name || defaultAuthorizerName;
            const routeGroups = route.authorizer.groups || defaultAuthorizerGroups;
            routeAuthorizerGroups = !routeGroups
                ? []
                : Array.isArray(routeGroups)
                    ? routeGroups
                    : [ routeGroups ];
            routeRequireRouteInGroupConfig = route.authorizer.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        } else if (typeof route.authorizer === 'string') {
            routeAuthorizerType = route.authorizer;
        }

        return { routeAuthorizerName, routeAuthorizerType, routeAuthorizerGroups, routeRequireRouteInGroupConfig };
    }

    private readonly createMethodOptions = (route: IRouteWithAuthorizer, routeAuthorizerType: string, routeAuthorizerName: string | undefined, controllerConfig: IControllerConfig): MethodOptions => {
        const requestParameters: { [ key: string ]: boolean } = {};

        // Add path parameters
        for (const param of route.parameters || []) {
            requestParameters[ `method.request.path.${param}` ] = true;
        }

        // Add API key header requirement if specified
        if (controllerConfig.requireApiKey) {
            requestParameters[ 'method.request.header.x-api-key' ] = true;
        }

        // If the authorizer is JWT, convert it to CUSTOM
        const authorizer = this.fw24.getAuthorizer(routeAuthorizerType, routeAuthorizerName);
        if (routeAuthorizerType === 'JWT') {
            routeAuthorizerType = 'CUSTOM';
        }

        return {
            requestParameters,
            authorizationType: routeAuthorizerType as AuthorizationType,
            authorizer: authorizer,
            apiKeyRequired: controllerConfig.requireApiKey || false
        };
    }

    private readonly createSQSIntegration = (queueName: string, controllerName: string, controllerStackName: string): AwsIntegration => {
        this.logger.debug(`Creating SQS integration for queue ${queueName} in controller ${controllerName} in stack ${controllerStackName}`);
        const integrationRole = new Role(this.fw24.getStack(controllerStackName), `${controllerName}-${queueName}-sqs-integration-role`, {
            assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
        });
        const queueArn = this.fw24.getArn('sqs', this.fw24.getEnvironmentVariable(queueName + '_queueName', 'queue', this.fw24.getStack(controllerStackName)));
        const queueInstance = Queue.fromQueueArn(this.fw24.getStack(controllerStackName), `${controllerName}-${queueName}-queue`, queueArn);
        queueInstance.grantSendMessages(integrationRole);
        return new AwsIntegration({
            service: "sqs",
            path: this.fw24.getConfig().account + "/" + queueInstance.queueName,
            integrationHttpMethod: "POST",
            options: {
                credentialsRole: integrationRole,
                requestParameters: {
                    "integration.request.header.Content-Type": "'application/x-www-form-urlencoded'",
                },
                requestTemplates: {
                    "application/json": `Action=SendMessage&MessageBody=$util.urlEncode($input.body)`,
                },
                integrationResponses: [
                    {
                        statusCode: "202",
                    },
                    {
                        statusCode: "400",
                    },
                    {
                        statusCode: "500",
                    },
                ],
            },
        });
    }

    private readonly createSNSIntegration = (topicName: string, controllerName: string, controllerStackName: string): AwsIntegration => {
        const integrationRole = new Role(this.fw24.getStack(controllerStackName), `${controllerName}-${topicName}-sns-integration-role`, {
            assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
        });
        const topicArn = this.fw24.getArn('sns', this.fw24.getEnvironmentVariable(topicName + '_topicName', 'topic', this.fw24.getStack(controllerStackName)));
        const topicInstance = Topic.fromTopicArn(this.fw24.getStack(controllerStackName), `${controllerName}-${topicName}-topic`, topicArn);
        topicInstance.grantPublish(integrationRole);
        return new AwsIntegration({
            service: "sns",
            path: '/',
            integrationHttpMethod: "POST",
            options: {
                credentialsRole: integrationRole,
                requestParameters: {
                    "integration.request.header.Content-Type": "'application/x-www-form-urlencoded'",
                },
                requestTemplates: {
                    "application/json": `Action=Publish&TopicArn=$util.urlEncode('${topicInstance.topicArn}')&Message=$util.urlEncode($input.body)`,
                },
                integrationResponses: [
                    {
                        statusCode: "202",
                    },
                    {
                        statusCode: "400",
                    },
                    {
                        statusCode: "500",
                    },
                ],
            },
        });
    }

    private readonly outputApiEndpoint = (controllerName: string, controllerResource: IResource, stageName: string, controllerStackName: string) => {
        new CfnOutput(this.fw24.getStack(controllerStackName), `Endpoint${controllerName}`, {
            value: 'https://' + this.getAPI(controllerStackName).api.restApiId + '.execute-api.' + this.fw24.getStack(controllerStackName).region + '.amazonaws.com/' + stageName + '/' + controllerResource.path.slice(1),
            description: "API Gateway Endpoint for " + controllerName,
        });
    }

    private setupUsagePlan(planConfig?: IUsagePlanConfig, createKey: boolean = false): { plan: UsagePlan; name: string } {
        // If no plan config is provided and we need a key, use the first configured plan or create a default one
        if (!planConfig && createKey) {
            // Try to use the first configured plan that has API keys
            const configuredPlan = this.apiConstructConfig.usagePlans?.find(plan => plan.apiKeys);
            if (configuredPlan) {
                planConfig = configuredPlan;
            } else {
                // If no configured plan with keys exists, create a default plan
                // Generate a deterministic key based on app name and a fixed identifier
                const defaultKey = createHash('sha256')
                    .update(`${this.fw24.appName}-${this.fw24.getConfig().account}-${this.fw24.getConfig().region}-${this.fw24.getConfig().environment}-default-api-key`)
                    .digest('hex')
                    .slice(0, 32); // Use first 32 chars for a reasonable key length

                this.logger.warn(`No usage plan with API keys found, creating a default one. This is not recommended for production environments. Please configure a usage plan with API keys for your API.`);

                planConfig = {
                    name: `${this.fw24.appName}-default-usage-plan`,
                    description: `Default usage plan for ${this.fw24.appName}`,
                    apiKeys: {
                        keys: [ defaultKey ]
                    }
                };
            }
        }

        const planName = planConfig?.name || `${this.fw24.appName}-default-usage-plan`;

        if (!this.usagePlans.has(planName)) {
            this.logger.info(`Setting up usage plan: ${planName}`);
            const usagePlan = new UsagePlan(this.mainStack, `${this.fw24.appName}-${planName}-usage-plan`, {
                name: planName,
                description: planConfig?.description || `Usage plan for ${this.fw24.appName}`,
                apiStages: [ {
                    api: this.api,
                    stage: this.api.deploymentStage
                } ],
                throttle: {
                    rateLimit: planConfig?.rateLimit || 10,
                    burstLimit: planConfig?.burstLimit || 20
                },
                quota: {
                    limit: planConfig?.quotaLimit || 10000,
                    period: planConfig?.quotaPeriod || Period.MONTH
                }
            });
            this.usagePlans.set(planName, { plan: usagePlan, name: planName });
            this.apiKeys.set(planName, []);

            // Create API keys if configured for this usage plan
            if (planConfig?.apiKeys) {
                this.logger.info(`Creating API keys for usage plan: ${planName}`);
                const keys = planConfig.apiKeys.keys || [];
                keys.forEach((key, index) => {
                    // Use the key name from config if available, otherwise use the prefix or generate a name
                    const keyName = this.apiConstructConfig.apiKeyConfig?.keyName ||
                        (planConfig.apiKeys?.keyNamePrefix
                            ? `${planConfig.apiKeys.keyNamePrefix}-${index}`
                            : `${this.fw24.appName}-api-key-${index}`);

                    // Check if key already exists
                    let existingKey = this.keyValues.get(key);
                    if (!existingKey) {
                        existingKey = new ApiKey(this.mainStack, `${this.fw24.appName}-${keyName}-api-key`, {
                            enabled: true,
                            description: `API key ${index + 1} for ${this.fw24.appName}`,
                            value: key
                        });

                        new CfnOutput(this.mainStack, `${this.fw24.appName}-${keyName}-id`, {
                            value: existingKey.keyId,
                            description: `API Key ${index + 1} ID for ${this.fw24.appName}`
                        });

                        this.keyValues.set(key, existingKey);
                    }

                    usagePlan.addApiKey(existingKey);
                    const apiKeysList = this.apiKeys.get(planName);
                    if (apiKeysList) {
                        apiKeysList.push(existingKey);
                    }
                });
            }
        }

        const usagePlan = this.usagePlans.get(planName);
        if (!usagePlan) {
            throw new Error(`Usage plan ${planName} not found`);
        }
        return usagePlan;
    }

}
