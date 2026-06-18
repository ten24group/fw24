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
    Cors,
    Deployment,
    Resource,
    ResponseType,
    RestApi,
    Stage,
    ApiKey,
    Period,
    UsagePlan
} from "aws-cdk-lib/aws-apigateway";

import { CfnOutput, Duration, NestedStack, RemovalPolicy, Stack } from "aws-cdk-lib";

import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Queue } from "aws-cdk-lib/aws-sqs";

import type { IFw24Module } from "../core/";
import type HandlerDescriptor from "../interfaces/handler-descriptor";

import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import {
    createCloudFormationNestedRootLookup,
    NestedRootCloudFormationLookup,
    resolveDeployedNestedRootOwners,
} from "./nested-controller-root-lookup";
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
import path from 'node:path';
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
     * Ownership strategy for shared nested-controller root segments (the first path part of a
     * nested route, e.g. `internal` in `internal/notifications`). In every strategy the owner is
     * decided up front — never by controller registration order — so the shared resource's
     * CloudFormation logical id is stable and the historical 409/ordering bug cannot occur. No
     * hardcoded segment names in any strategy.
     *
     * - `'main-stack'` (default): the main RestApi stack owns every shared root. Zero config, fully
     *   deterministic (no AWS calls) — new apps need nothing. An app already deployed with the root
     *   in a nested stack moves it once per environment via `cdk refactor`.
     * - `'pinned'`: a shared root stays in the controller stack that already owns it — you supply
     *   `nestedControllerRootOwners`. Deterministic and offline; moves no live resource. Roots not
     *   listed fall back to the main stack.
     * - `'auto'`: at build time it looks up deployed CloudFormation to discover which controller
     *   stack currently owns each root (matched by route, not logical id), and keeps it there. No
     *   config and moves no live resource — but the build needs AWS credentials (present in CI/CD
     *   deploy). It fails loud if it cannot resolve an owner (rather than guessing); set a
     *   `nestedControllerRootOwners` entry as an explicit fallback for those cases.
     *
     * @default 'main-stack'
     */
    nestedControllerRootStrategy?: 'main-stack' | 'pinned' | 'auto';

    /**
     * The controller stack that already owns a shared root in the deployed app, e.g.
     * `{ internal: 'internal/team' }`. Required with `'pinned'`; optional with `'auto'` as an
     * explicit fallback when the lookup can't resolve (no creds / ambiguous / unmatched). The named
     * stack keeps creating the root resource (preserving its existing CloudFormation logical id) and
     * every sibling references it — so upgrading moves nothing and stays zero-downtime.
     */
    nestedControllerRootOwners?: Record<string, string>;

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

    /**
     * Shared root segments for nested controllers (e.g. `internal` for `internal/notifications`),
     * each created exactly once in a STABLE owner stack and referenced by every sibling nested stack
     * via the resource-id token. The owner is the main stack by default, or a pinned controller
     * stack (`nestedControllerRootOwners`) for already-deployed apps. Either way the owner is fixed
     * by config — never by registration order — so the segment's CloudFormation logical id is
     * identical on every synth. No 409, no live AWS lookups.
     */
    private readonly sharedControllerRoots = new Map<string, { resource: IResource; ownerStack: Stack }>();
    /** 'auto' strategy: resolved `rootSegment -> owning controller stack name`, discovered from deployed state. */
    private readonly resolvedAutoRootOwners = new Map<string, string>();
    /** Injectable CloudFormation lookup for the 'auto' strategy (overridable in tests). */
    private nestedRootLookup?: NestedRootCloudFormationLookup;
    /** True once an api-key usage plan was requested while deployment was still deferred. */
    private deferredApiKeyPlanRequested = false;

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
        } else if (this.isNestedControllerDeployment()) {
            // Nested-controller apps publish a single, explicit stage AFTER every nested stack is
            // registered (see createSingleDeployment). Letting RestApi auto-deploy here would
            // publish an early stage that misses late-registered nested routes (the "deploy twice"
            // bug). We assign this.api.deploymentStage ourselves once the deployment exists.
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

        // Set up usage plans if configured. Usage plans bind to this.api.deploymentStage; for
        // nested-controller apps that stage does not exist yet (deploy:false), so we defer plan
        // setup until after the single deployment creates the stage (see flushDeferredUsagePlans).
        if (!this.isNestedControllerDeployment() && this.apiConstructConfig.usagePlans?.length) {
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
        } else if (this.fw24.hasImportedAPI(this.name) || this.isNestedControllerDeployment()) {
            await this.createSingleDeployment();
        }

        // Usage plans were deferred for nested-controller apps until the stage exists; flush now.
        this.flushDeferredUsagePlans();
    }

    /**
     * Nested-controller layout: controllers live in nested stacks under a shared parent, so the API
     * must publish a single explicit stage after all nested stacks register (not auto-deploy early).
     * Mutually exclusive with multiStack (getStack forbids parentStackName under multiStack).
     */
    private isNestedControllerDeployment(): boolean {
        return !!this.apiConstructConfig.controllerParentStackName && !this.fw24.useMultiStackSetup();
    }

    /** Set up usage plans deferred during a nested-controller deployment, once the stage exists. */
    private flushDeferredUsagePlans(): void {
        if (!this.isNestedControllerDeployment()) {
            return;
        }
        if (this.apiConstructConfig.usagePlans?.length) {
            for (const planConfig of this.apiConstructConfig.usagePlans) {
                this.setupUsagePlan(planConfig);
            }
        }
        if (this.deferredApiKeyPlanRequested) {
            this.setupUsagePlan(undefined, true);
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

        // Collect descriptors first so the 'auto' strategy can resolve shared-root owners from
        // deployed state BEFORE any controller is registered (registration order stays irrelevant).
        const collected: Array<{ descriptor: HandlerDescriptor; ownerModule?: IFw24Module }> = [];
        await Helper.registerHandlers(controllersDirectory, (desc: HandlerDescriptor) => { collected.push({ descriptor: desc }); });

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("API-gateway stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [ , module ] of modules) {
                this.logger.debug("Load controllers from module base-path: ", module.getBasePath());
                Helper.registerControllersFromModule(
                    module,
                    (desc: HandlerDescriptor) => { collected.push({ descriptor: desc, ownerModule: module }); }
                );
            }
        } else {
            this.logger.debug("API-gateway stack: construct: app has NO modules ");
        }

        // 'auto' strategy: discover which deployed stack currently owns each shared root.
        await this.resolveAutoSharedRootOwners(collected.map((c) => c.descriptor));

        for (const { descriptor, ownerModule } of collected) {
            await this.registerController(descriptor, ownerModule);
        }

        // Register system controllers from fw24 singleton
        if (this.fw24.hasSystemControllers()) {
            this.logger.debug("API-gateway stack: construct: registering system controllers");

            // Copy system controllers to app dist and register from there
            await this.copyAndRegisterSystemControllers();
        } else {
            this.logger.debug("API-gateway stack: construct: app has NO system controllers");
        }
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

        // Set up API key if required. For nested-controller apps the deployment stage does not exist
        // yet, so record the request and create the plan in flushDeferredUsagePlans (post-deployment).
        if (controllerConfig.requireApiKey) {
            if (this.isNestedControllerDeployment()) {
                this.deferredApiKeyPlanRequested = true;
            } else {
                this.setupUsagePlan(undefined, true);
            }
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

        const nestedControllerDeployment = this.isNestedControllerDeployment();
        const deployOptions = this.apiConstructConfig.apiOptions?.deployOptions;

        const deployment = new Deployment(this.fw24.getStack(this.name), deploymentName, {
            api: this.api,
            description: deployOptions?.description,
            // For nested-controller apps we publish the stage explicitly below (so it can depend on
            // every nested stack and so this.api.deploymentStage gets set for usage plans). For the
            // imported-API path, keep the original behaviour of letting Deployment create the stage.
            ...(nestedControllerDeployment ? {} : { stageName }),
        });

        for (const [ controllerStackName, { methods, resources } ] of this.controllerStacks.entries()) {
            // The deployment must wait for every nested stack's resources/methods to exist, otherwise
            // the published stage can miss late-registered routes (the "deploy twice" bug).
            const controllerStack = this.fw24.getStack(controllerStackName);
            if (controllerStack !== this.mainStack) {
                this.logger.debug(`Adding nested stack dependency ${controllerStackName} to deployment`);
                deployment.node.addDependency(controllerStack);
            }

            for (const method of methods) {
                this.logger.debug(`Adding method dependency ${method.httpMethod} ${method.resource.path} to deployment`);
                deployment.node.addDependency(method)
            }

            for (const resource of resources) {
                this.logger.debug(`Adding resource dependency ${resource.path} to deployment`);
                deployment.node.addDependency(resource);
            }
        }

        // Ensure main-stack-owned shared roots exist before the deployment publishes the stage.
        // (Pinned roots live in nested stacks, already covered by the nested-stack dependency above.)
        for (const { resource, ownerStack } of this.sharedControllerRoots.values()) {
            if (ownerStack === this.mainStack) {
                deployment.node.addDependency(resource);
            }
        }

        if (nestedControllerDeployment) {
            // Publish exactly one stage, wired to this deployment, and expose it as the API's
            // deploymentStage so usage plans / api keys can bind to a real stage.
            this.api.deploymentStage = new Stage(this.mainStack, `${this.fw24.appName}-${stageName}-stage`, {
                ...(deployOptions ?? {}),
                deployment,
                stageName,
            });
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

    /** Route + stack name for a controller descriptor (mirrors registerController's derivation). */
    private describeController(descriptor: HandlerDescriptor): { route: string; stackName: string } {
        const { handlerClass, fileName } = descriptor;
        const folderPath = fileName.split('/').slice(0, -1).join('/');
        const handlerInstance = new handlerClass();
        const route = fileName.includes('/') ? `${folderPath}/${handlerInstance.controllerName}` : handlerInstance.controllerName;
        const stackName = handlerInstance?.controllerConfig?.stackName || route;
        return { route, stackName };
    }

    /**
     * 'auto' strategy: for each shared root, discover from deployed CloudFormation which controller
     * stack currently owns it, and record that stack as the owner. The owning controller is matched
     * by ROUTE (a semantic value present in both the deployed template and the app's controllers) —
     * never by CloudFormation logical id (which is an unresolved token at synth) and with no hardcoded
     * segment names. Fails loud rather than guessing; honours a `nestedControllerRootOwners` value as
     * an explicit fallback for the unresolvable cases (no creds / ambiguous / unmatched).
     */
    private async resolveAutoSharedRootOwners(descriptors: HandlerDescriptor[]): Promise<void> {
        if (this.apiConstructConfig.nestedControllerRootStrategy !== 'auto') {
            return;
        }

        const routeToStackName = new Map<string, string>();
        const rootsWithNestedControllers = new Set<string>();
        for (const descriptor of descriptors) {
            const { route, stackName } = this.describeController(descriptor);
            routeToStackName.set(route, stackName);
            const parts = route.split('/');
            if (parts.length > 1) {
                rootsWithNestedControllers.add(parts[ 0 ]);
            }
        }
        if (rootsWithNestedControllers.size === 0) {
            return;
        }

        const fallback = (rootSegment: string): string | undefined => this.apiConstructConfig.nestedControllerRootOwners?.[ rootSegment ];

        let resolutions;
        try {
            const lookup = this.nestedRootLookup ?? createCloudFormationNestedRootLookup();
            resolutions = await resolveDeployedNestedRootOwners(this.mainStack.stackName, [ ...rootsWithNestedControllers ], lookup);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // No silent guessing: every root either resolves, has an explicit fallback, or we fail loud.
            const unresolved = [ ...rootsWithNestedControllers ].filter((root) => !fallback(root));
            if (unresolved.length > 0) {
                throw new Error(
                    `nestedControllerRootStrategy 'auto' could not look up deployed shared-root owners on `
                    + `${this.mainStack.stackName} (${message}). Run the build with AWS credentials, or set `
                    + `nestedControllerRootOwners for: ${unresolved.join(', ')}, or use the 'pinned'/'main-stack' strategy.`,
                );
            }
            for (const root of rootsWithNestedControllers) {
                this.resolvedAutoRootOwners.set(root, fallback(root)!);
            }
            return;
        }

        for (const [ root, resolution ] of resolutions) {
            if (resolution.kind === 'not-found') {
                // greenfield root — nothing deployed owns it yet; main stack will create it
                continue;
            }
            if (resolution.kind === 'ambiguous') {
                const pinned = fallback(root);
                if (pinned) {
                    this.resolvedAutoRootOwners.set(root, pinned);
                    continue;
                }
                throw new Error(
                    `nestedControllerRootStrategy 'auto' found multiple deployed owners for /${root} `
                    + `(${resolution.ownerStackLogicalIds.join(', ')}). Resolve the drift or set `
                    + `nestedControllerRootOwners.${root}.`,
                );
            }
            // owned: the owning controller is the deployed route that matches one of our controllers
            const ownerRoute = resolution.candidateRoutes.find((candidate) => routeToStackName.has(candidate));
            if (ownerRoute) {
                this.resolvedAutoRootOwners.set(root, routeToStackName.get(ownerRoute)!);
                this.logger.info(`Nested root /${root} resolved (auto) to existing owner stack ${routeToStackName.get(ownerRoute)}`);
                continue;
            }
            const pinned = fallback(root);
            if (pinned) {
                this.resolvedAutoRootOwners.set(root, pinned);
                continue;
            }
            throw new Error(
                `nestedControllerRootStrategy 'auto' found /${root} deployed but could not match its owner to a `
                + `current controller (deployed routes under /${root}: ${resolution.candidateRoutes.join(', ') || 'none'}). `
                + `Set nestedControllerRootOwners.${root}.`,
            );
        }
    }

    /** Resolve the controller stack that should own a shared root, per the configured strategy. */
    private resolveSharedRootOwnerStackName(rootSegment: string): string | undefined {
        switch (this.apiConstructConfig.nestedControllerRootStrategy) {
            case 'pinned':
                return this.apiConstructConfig.nestedControllerRootOwners?.[ rootSegment ];
            case 'auto':
                return this.resolvedAutoRootOwners.get(rootSegment)
                    ?? this.apiConstructConfig.nestedControllerRootOwners?.[ rootSegment ];
            default:
                return undefined; // 'main-stack'
        }
    }

    /**
     * Create (once) the shared root segment for a nested controller in its STABLE owner stack, and
     * publish its resource-id token so sibling nested stacks can reference it. The owner is decided
     * by the configured strategy (main stack, pinned, or auto-resolved) — never by registration
     * order — so the segment's CloudFormation logical id is identical on every synth. That is what
     * removes the 409/ordering bug.
     */
    private getOrCreateSharedControllerRoot(rootSegment: string): { resource: IResource; ownerStack: Stack } {
        const existing = this.sharedControllerRoots.get(rootSegment);
        if (existing) {
            return existing;
        }

        const ownerStackName = this.resolveSharedRootOwnerStackName(rootSegment);

        let resource: IResource;
        let ownerStack: Stack;
        if (ownerStackName) {
            // pinned/auto: create the root in its existing owner stack — moves no live resource
            this.fw24.getStack(ownerStackName, this.apiConstructConfig.controllerParentStackName);
            ownerStack = this.fw24.getStack(ownerStackName);
            resource = this.getAPI(ownerStackName).api.root.addResource(rootSegment);
            this.logger.debug(`Shared root /${rootSegment} owned by existing controller stack ${ownerStackName}`);
        } else {
            // default ('main-stack'), or a greenfield root under 'auto': the main stack owns it
            ownerStack = this.mainStack;
            resource = this.api.root.addResource(rootSegment);
        }

        const entry = { resource, ownerStack };
        this.sharedControllerRoots.set(rootSegment, entry);
        this.fw24.setConstructOutput(this, `restAPI_controller_${rootSegment}`, resource, OutputType.RESOURCE, 'resourceId');
        return entry;
    }

    private readonly getOrCreateControllerResource = (controllerName: string, controllerStackName: string): IResource => {
        let restAPI = this.getAPI(controllerStackName);
        let controllerResource: IResource = restAPI.api.root;
        const currentStack = this.fw24.getStack(controllerStackName);
        const pathParts = controllerName.split('/');
        for (const pathPart of pathParts) {
            let childResource = controllerResource.getResource(pathPart) as IResource;
            // The first path part of a nested controller (e.g. `internal` in `internal/notifications`)
            // is a SHARED root owned by the main stack. Resolve it from there instead of letting
            // whichever controller registers first create it — this is what removes the 409/ordering bug.
            const isNestedController = pathParts.length > 1;
            if (!childResource && isNestedController && pathPart === pathParts[ 0 ]) {
                const sharedRoot = this.getOrCreateSharedControllerRoot(pathPart);
                if (currentStack === sharedRoot.ownerStack) {
                    // same stack as the owner (single-stack app, or this controller IS the owner) — use it directly
                    childResource = sharedRoot.resource;
                } else {
                    // reference the owner stack's root by its resource-id token; CDK wires it across stacks
                    this.logger.debug(`Referencing shared root /${pathPart} (owner ${sharedRoot.ownerStack.stackName}) from ${controllerStackName}`);
                    childResource = Resource.fromResourceAttributes(currentStack, `${this.fw24.appName}-${controllerStackName}-${pathPart}`, {
                        resourceId: sharedRoot.resource.resourceId,
                        restApi: restAPI.api,
                        path: '/' + pathPart
                    });
                }
            }
            if (!childResource) {
                // for nested resources add / to the path
                this.logger.debug(`Creating controller resource for path ${pathPart} under ${controllerResource.path}`);
                childResource = controllerResource.addResource(pathPart) as IResource;
                if (restAPI.isImported) {
                    const corsPreflightMethod = childResource.addCorsPreflight(this.getCorsPreflightOptions());
                    this.methods.push(corsPreflightMethod);
                }
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
                : [defaultAuthorizerGroups];

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
                    : [routeGroups];
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
