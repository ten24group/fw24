"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIConstruct = void 0;
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const nested_controller_root_lookup_1 = require("./nested-controller-root-lookup");
const fw24_1 = require("../core/fw24");
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const utils_1 = require("../utils");
const lambda_function_1 = require("./lambda-function");
const lambda_integration_1 = require("./lambda-integration");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const fw24_2 = require("../fw24");
const utils_2 = require("../utils");
const auth_1 = require("./auth");
const certificate_1 = require("./certificate");
const dynamodb_1 = require("./dynamodb");
const layer_1 = require("./layer");
const mailer_1 = require("./mailer");
const queue_1 = require("./queue");
const topic_1 = require("./topic");
const vpc_1 = require("./vpc");
class APIConstruct {
    apiConstructConfig;
    logger = (0, logging_1.createLogger)(APIConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = APIConstruct.name;
    dependencies = [vpc_1.VpcConstruct.name, mailer_1.MailerConstruct.name, dynamodb_1.DynamoDBConstruct.name, auth_1.AuthConstruct.name, queue_1.QueueConstruct.name, topic_1.TopicConstruct.name, layer_1.LayerConstruct.name];
    output;
    api;
    mainStack;
    usagePlans = new Map();
    apiKeys = new Map();
    keyValues = new Map();
    resources = [];
    methods = [];
    controllerStacks = new Map();
    /**
     * Shared root segments for nested controllers (e.g. `internal` for `internal/notifications`),
     * each created exactly once in a STABLE owner stack and referenced by every sibling nested stack
     * via the resource-id token. The owner is the main stack by default, or a pinned controller
     * stack (`nestedControllerRootOwners`) for already-deployed apps. Either way the owner is fixed
     * by config — never by registration order — so the segment's CloudFormation logical id is
     * identical on every synth. No 409, no live AWS lookups.
     */
    sharedControllerRoots = new Map();
    /** 'auto' strategy: resolved `rootSegment -> owning controller stack name`, discovered from deployed state. */
    resolvedAutoRootOwners = new Map();
    /** Injectable CloudFormation lookup for the 'auto' strategy (overridable in tests). */
    nestedRootLookup;
    /** True once an api-key usage plan was requested while deployment was still deferred. */
    deferredApiKeyPlanRequested = false;
    // default constructor to initialize the stack configuration
    constructor(apiConstructConfig) {
        this.apiConstructConfig = apiConstructConfig;
        // hydrate the config object with environment variables ex: APIGATEWAY_CONTROLLERS
        helper_1.Helper.hydrateConfig(apiConstructConfig, 'APIGATEWAY');
    }
    // construct method to create the stack
    async construct() {
        // set the default api options
        const paramsApi = { ...this.apiConstructConfig.apiOptions || {} };
        // Enable CORS if defined
        if (this.apiConstructConfig.cors) {
            this.logger.debug("Enabling CORS... this.config.cors: ", this.apiConstructConfig.cors);
            paramsApi.defaultCorsPreflightOptions = this.getCorsPreflightOptions();
        }
        if (this.apiConstructConfig.domainName && this.apiConstructConfig.domainName.length > 0) {
            const certificateConstruct = new certificate_1.CertificateConstruct({
                domainName: this.apiConstructConfig.domainName,
                certificateArn: this.apiConstructConfig.certificateArn
            });
            certificateConstruct.construct();
            const certificate = certificateConstruct.output[construct_1.OutputType.CERTIFICATE][this.apiConstructConfig.domainName];
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
        else if (this.isNestedControllerDeployment()) {
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
        this.api = new aws_apigateway_1.RestApi(this.mainStack, `${this.fw24.appName}-api`, {
            ...paramsApi,
        });
        if (this.apiConstructConfig.cors) {
            const corsOrigins = this.getCorsPreflightOptions().allowOrigins?.join(',');
            this.api.addGatewayResponse('default4xx', {
                type: aws_apigateway_1.ResponseType.DEFAULT_4XX,
                responseHeaders: {
                    'Access-Control-Allow-Origin': `'${corsOrigins}'`,
                }
            });
            this.api.addGatewayResponse('default5xx', {
                type: aws_apigateway_1.ResponseType.DEFAULT_5XX,
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
        this.fw24.setConstructOutput(this, 'restAPI', this.api, construct_1.OutputType.API, 'restApiId');
        this.fw24.setConstructOutput(this, 'restAPI', this.api, construct_1.OutputType.API, 'restApiRootResourceId');
        if (this.apiConstructConfig.skipControllers) {
            return;
        }
        await this.registerControllers();
        // if multi/nested-stack setup, then create one deployment per controller stack
        this.logger.info(`API-gateway construct: ${this.name} has imported APIs: ${this.fw24.hasImportedAPI(this.name)}`);
        if (this.fw24.hasImportedAPI(this.name) && this.fw24.useMultiStackSetup()) {
            await this.createDeployments();
        }
        else if (this.fw24.hasImportedAPI(this.name) || this.isNestedControllerDeployment()) {
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
    isNestedControllerDeployment() {
        return !!this.apiConstructConfig.controllerParentStackName && !this.fw24.useMultiStackSetup();
    }
    /** Set up usage plans deferred during a nested-controller deployment, once the stage exists. */
    flushDeferredUsagePlans() {
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
    getAPI = (stackName) => {
        let currentAPI = this.fw24.getAPI(this.name, 'root');
        // if the stack is not the main stack and its a multi-stack application or a nested stack, then import the API
        const currentStack = this.fw24.getStack(stackName);
        this.logger.debug(`Current Stack: ${currentStack.stackName} is nested stack: ${currentStack instanceof aws_cdk_lib_1.NestedStack}`);
        if (this.fw24.useMultiStackSetup(stackName, this.mainStack) || currentStack instanceof aws_cdk_lib_1.NestedStack) {
            currentAPI = this.fw24.getAPI(this.name, stackName);
            if (!currentAPI) {
                const importedAPI = aws_apigateway_1.RestApi.fromRestApiAttributes(currentStack, `${this.fw24.appName}-${stackName}-api`, {
                    restApiId: this.fw24.getEnvironmentVariable('restAPI_restApiId', 'api', currentStack),
                    rootResourceId: this.fw24.getEnvironmentVariable('restAPI_restApiRootResourceId', 'api', currentStack),
                });
                this.fw24.addAPI(this.name, stackName, importedAPI, true);
                currentAPI = this.fw24.getAPI(this.name, stackName);
            }
        }
        if (!currentAPI) {
            throw new Error(`API not found for stack: ${stackName}`);
        }
        return currentAPI;
    };
    async registerControllers() {
        // sets the default controllers directory if not defined
        const controllersDirectory = this.apiConstructConfig.controllersDirectory || "./src/controllers";
        // Collect descriptors first so the 'auto' strategy can resolve shared-root owners from
        // deployed state BEFORE any controller is registered (registration order stays irrelevant).
        const collected = [];
        await helper_1.Helper.registerHandlers(controllersDirectory, (desc) => { collected.push({ descriptor: desc }); });
        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("API-gateway stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                this.logger.debug("Load controllers from module base-path: ", module.getBasePath());
                helper_1.Helper.registerControllersFromModule(module, (desc) => { collected.push({ descriptor: desc, ownerModule: module }); });
            }
        }
        else {
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
        }
        else {
            this.logger.debug("API-gateway stack: construct: app has NO system controllers");
        }
    }
    async copyAndRegisterSystemControllers() {
        const systemControllersTargetDir = node_path_1.default.join(process.cwd(), 'dist', 'system-controllers');
        // Ensure target directory exists
        if (!(0, node_fs_1.existsSync)(systemControllersTargetDir)) {
            (0, node_fs_1.mkdirSync)(systemControllersTargetDir, { recursive: true });
        }
        for (const systemController of this.fw24.getSystemControllers()) {
            let relativePathFromFramework = '';
            // Fallback: use the last few directories to preserve structure
            const pathParts = systemController.filePath.split('/');
            const relevantParts = pathParts.slice(-3); // e.g., ['search', 'system', 'search-controller.js']
            relativePathFromFramework = relevantParts.join('/');
            this.logger.warn(`System controller relative path: ${relativePathFromFramework}`);
            const targetFilePath = node_path_1.default.join(systemControllersTargetDir, relativePathFromFramework);
            const targetDirectory = node_path_1.default.dirname(targetFilePath);
            this.logger.debug(`System controller target-directory: ${targetDirectory}, targetFilePath: ${targetFilePath}`);
            // Ensure target subdirectory exists
            if (!(0, node_fs_1.existsSync)(targetDirectory)) {
                (0, node_fs_1.mkdirSync)(targetDirectory, { recursive: true });
            }
            // Copy the system controller file
            (0, node_fs_1.copyFileSync)(systemController.filePath, targetFilePath);
            this.logger.debug(`Copied system controller from ${systemController.filePath} to ${targetFilePath}`);
            // Register from the copied location
            const directory = node_path_1.default.dirname(targetFilePath);
            const fileName = node_path_1.default.basename(targetFilePath);
            this.logger.debug(`Registering system controller: ${fileName}`);
            await helper_1.Helper.registerHandlers(directory, this.registerController, [fileName]);
        }
    }
    prepareEntryPackages(controllerConfig, ownerModule) {
        let entryPackages = controllerConfig.entryPackages || [];
        if ((0, utils_2.isArray)(entryPackages)) {
            entryPackages = {
                override: false,
                packageNames: entryPackages
            };
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
    registerController = async (controllerInfo, ownerModule) => {
        const { handlerClass, filePath, fileName } = controllerInfo;
        // Add the folder path from filename to the controller name
        const folderPath = fileName.split('/').slice(0, -1).join('/');
        const handlerInstance = new handlerClass();
        const controllerName = fileName.includes('/') ? folderPath + '/' + handlerInstance.controllerName : handlerInstance.controllerName;
        const controllerConfig = handlerInstance?.controllerConfig || {};
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
        let controllerIntegration;
        // create lambda function for the controller
        if (controllerTarget === 'function' || controllerTarget === undefined) {
            controllerConfig.logRetentionDays = controllerConfig.logRetentionDays || this.apiConstructConfig.logRetentionDays;
            controllerConfig.logRemovalPolicy = controllerConfig.logRemovalPolicy || this.apiConstructConfig.logRemovalPolicy;
            const controllerLambda = this.createLambdaFunction(controllerName, filePath, fileName, controllerConfig, controllerStackName);
            this.fw24.setConstructOutput(this, controllerName, controllerLambda, construct_1.OutputType.FUNCTION);
            controllerIntegration = new lambda_integration_1.LambdaIntegration(controllerLambda, {
                restApi: this.getAPI(controllerStackName).api,
                path: controllerName,
                timeout: aws_cdk_lib_1.Duration.seconds(this.apiConstructConfig.integrationTimeout || 29),
            });
        }
        const { defaultAuthorizerName, defaultAuthorizerType, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig } = this.extractDefaultAuthorizer(controllerConfig);
        this.logger.debug(`Register Controller ~ Default Authorizer: name: ${defaultAuthorizerName} - type: ${defaultAuthorizerType} - groups: ${defaultAuthorizerGroups}`);
        // Set up API key if required. For nested-controller apps the deployment stage does not exist
        // yet, so record the request and create the plan in flushDeferredUsagePlans (post-deployment).
        if (controllerConfig.requireApiKey) {
            if (this.isNestedControllerDeployment()) {
                this.deferredApiKeyPlanRequested = true;
            }
            else {
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
                };
            }
            else if (routeTarget === 'topic') {
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
                };
            }
            const method = currentResource.addMethod(route.httpMethod, controllerIntegration, methodOptions);
            this.methods.push(method);
            // if authorizer is AWS_IAM, then add the route to the policy
            if (routeAuthorizerType === 'AWS_IAM') {
                let fullRoutePath = controllerName + route.path;
                // * replace each param placeholder `{id}` with an `*`
                route.parameters?.forEach(par => {
                    fullRoutePath = fullRoutePath.replace(`{${par}}`, '*');
                });
                this.fw24.addRouteToRolePolicy(fullRoutePath, routeAuthorizerGroups, routeRequireRouteInGroupConfig);
            }
        }
        // keep track of the controller stacks with methods and resources in a multi-stack setup to create one deployment per controller stack
        if (this.fw24.hasImportedAPI(this.name)) {
            const stackInfo = this.controllerStacks.get(controllerStackName);
            if (stackInfo) {
                stackInfo.methods = [...this.methods];
                stackInfo.resources = [...this.resources];
                stackInfo.controllersHash.push((0, node_crypto_1.createHash)('md5').update(JSON.stringify(controllerConfig)).digest('hex'));
            }
        }
        // output the api endpoint
        this.outputApiEndpoint(controllerName, controllerResource, this.getStageName(), controllerStackName);
    };
    getStageName = () => {
        return this.apiConstructConfig.apiOptions?.deployOptions?.stageName || 'prod';
    };
    // if the API is imported, then create one deployment per controller stack and add method and resource as dependency
    // This is needed because imported API does not propogate CORS settings to the methods
    async createDeployments() {
        const stageName = this.getStageName();
        for (const [controllerStackName, { methods, resources, controllersHash }] of this.controllerStacks.entries()) {
            // TODO: add better logic to force a deployment when there is a change in framework code
            if (this.apiConstructConfig.forceDeployment) {
                controllersHash.push((0, node_crypto_1.randomUUID)());
            }
            const controllerHash = (0, node_crypto_1.createHash)('md5').update(JSON.stringify(controllersHash)).digest('hex');
            this.logger.debug(`Creating deployment for controller stack ${controllerStackName} with hash ${controllerHash}`);
            const deployment = new aws_apigateway_1.Deployment(this.fw24.getStack(controllerStackName), `deployment-${controllerHash}`, {
                api: this.getAPI(controllerStackName).api,
                stageName: stageName,
            });
            for (const method of methods) {
                this.logger.debug(`Adding method dependency ${method.httpMethod} ${method.resource.path} to deployment`);
                deployment.node.addDependency(method);
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
    async createSingleDeployment() {
        const stageName = this.getStageName();
        if (this.apiConstructConfig.forceDeployment) {
            this.controllerStacks.forEach(c => c.controllersHash.push((0, node_crypto_1.randomUUID)()));
        }
        // create the name from all the controller hash values combined as a single hash and add dependency on all the controllers
        const deploymentName = `deployment-${(0, node_crypto_1.createHash)('md5').update(Array.from(this.controllerStacks.values()).map(c => c.controllersHash).join('-')).digest('hex')}`;
        const nestedControllerDeployment = this.isNestedControllerDeployment();
        const deployOptions = this.apiConstructConfig.apiOptions?.deployOptions;
        const deployment = new aws_apigateway_1.Deployment(this.fw24.getStack(this.name), deploymentName, {
            api: this.api,
            description: deployOptions?.description,
            // For nested-controller apps we publish the stage explicitly below (so it can depend on
            // every nested stack and so this.api.deploymentStage gets set for usage plans). For the
            // imported-API path, keep the original behaviour of letting Deployment create the stage.
            ...(nestedControllerDeployment ? {} : { stageName }),
        });
        for (const [controllerStackName, { methods, resources }] of this.controllerStacks.entries()) {
            // The deployment must wait for every nested stack's resources/methods to exist, otherwise
            // the published stage can miss late-registered routes (the "deploy twice" bug).
            const controllerStack = this.fw24.getStack(controllerStackName);
            if (controllerStack !== this.mainStack) {
                this.logger.debug(`Adding nested stack dependency ${controllerStackName} to deployment`);
                deployment.node.addDependency(controllerStack);
            }
            for (const method of methods) {
                this.logger.debug(`Adding method dependency ${method.httpMethod} ${method.resource.path} to deployment`);
                deployment.node.addDependency(method);
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
            this.api.deploymentStage = new aws_apigateway_1.Stage(this.mainStack, `${this.fw24.appName}-${stageName}-stage`, {
                ...(deployOptions ?? {}),
                deployment,
                stageName,
            });
        }
    }
    getCorsPreflightOptions() {
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
            allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
            allowCredentials: true,
            allowOrigins: this.getCorsOrigins(),
        };
    }
    getCorsOrigins() {
        if (this.apiConstructConfig.cors === true)
            return aws_apigateway_1.Cors.ALL_ORIGINS;
        if (typeof this.apiConstructConfig.cors === "string")
            return [this.apiConstructConfig.cors];
        return this.apiConstructConfig.cors || [];
    }
    /** Route + stack name for a controller descriptor (mirrors registerController's derivation). */
    describeController(descriptor) {
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
    async resolveAutoSharedRootOwners(descriptors) {
        if (this.apiConstructConfig.nestedControllerRootStrategy !== 'auto') {
            return;
        }
        const routeToStackName = new Map();
        const rootsWithNestedControllers = new Set();
        for (const descriptor of descriptors) {
            const { route, stackName } = this.describeController(descriptor);
            routeToStackName.set(route, stackName);
            const parts = route.split('/');
            if (parts.length > 1) {
                rootsWithNestedControllers.add(parts[0]);
            }
        }
        if (rootsWithNestedControllers.size === 0) {
            return;
        }
        const fallback = (rootSegment) => this.apiConstructConfig.nestedControllerRootOwners?.[rootSegment];
        let resolutions;
        try {
            const lookup = this.nestedRootLookup ?? (0, nested_controller_root_lookup_1.createCloudFormationNestedRootLookup)();
            resolutions = await (0, nested_controller_root_lookup_1.resolveDeployedNestedRootOwners)(this.mainStack.stackName, [...rootsWithNestedControllers], lookup);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // No silent guessing: every root either resolves, has an explicit fallback, or we fail loud.
            const unresolved = [...rootsWithNestedControllers].filter((root) => !fallback(root));
            if (unresolved.length > 0) {
                throw new Error(`nestedControllerRootStrategy 'auto' could not look up deployed shared-root owners on `
                    + `${this.mainStack.stackName} (${message}). Run the build with AWS credentials, or set `
                    + `nestedControllerRootOwners for: ${unresolved.join(', ')}, or use the 'pinned'/'main-stack' strategy.`);
            }
            for (const root of rootsWithNestedControllers) {
                this.resolvedAutoRootOwners.set(root, fallback(root));
            }
            return;
        }
        for (const [root, resolution] of resolutions) {
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
                throw new Error(`nestedControllerRootStrategy 'auto' found multiple deployed owners for /${root} `
                    + `(${resolution.ownerStackLogicalIds.join(', ')}). Resolve the drift or set `
                    + `nestedControllerRootOwners.${root}.`);
            }
            // owned: the owning controller is the deployed route that matches one of our controllers
            const ownerRoute = resolution.candidateRoutes.find((candidate) => routeToStackName.has(candidate));
            if (ownerRoute) {
                this.resolvedAutoRootOwners.set(root, routeToStackName.get(ownerRoute));
                this.logger.info(`Nested root /${root} resolved (auto) to existing owner stack ${routeToStackName.get(ownerRoute)}`);
                continue;
            }
            const pinned = fallback(root);
            if (pinned) {
                this.resolvedAutoRootOwners.set(root, pinned);
                continue;
            }
            throw new Error(`nestedControllerRootStrategy 'auto' found /${root} deployed but could not match its owner to a `
                + `current controller (deployed routes under /${root}: ${resolution.candidateRoutes.join(', ') || 'none'}). `
                + `Set nestedControllerRootOwners.${root}.`);
        }
    }
    /** Resolve the controller stack that should own a shared root, per the configured strategy. */
    resolveSharedRootOwnerStackName(rootSegment) {
        switch (this.apiConstructConfig.nestedControllerRootStrategy) {
            case 'pinned':
                return this.apiConstructConfig.nestedControllerRootOwners?.[rootSegment];
            case 'auto':
                return this.resolvedAutoRootOwners.get(rootSegment)
                    ?? this.apiConstructConfig.nestedControllerRootOwners?.[rootSegment];
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
    getOrCreateSharedControllerRoot(rootSegment) {
        const existing = this.sharedControllerRoots.get(rootSegment);
        if (existing) {
            return existing;
        }
        const ownerStackName = this.resolveSharedRootOwnerStackName(rootSegment);
        let resource;
        let ownerStack;
        if (ownerStackName) {
            // pinned/auto: create the root in its existing owner stack — moves no live resource
            this.fw24.getStack(ownerStackName, this.apiConstructConfig.controllerParentStackName);
            ownerStack = this.fw24.getStack(ownerStackName);
            resource = this.getAPI(ownerStackName).api.root.addResource(rootSegment);
            this.logger.debug(`Shared root /${rootSegment} owned by existing controller stack ${ownerStackName}`);
        }
        else {
            // default ('main-stack'), or a greenfield root under 'auto': the main stack owns it
            ownerStack = this.mainStack;
            resource = this.api.root.addResource(rootSegment);
        }
        const entry = { resource, ownerStack };
        this.sharedControllerRoots.set(rootSegment, entry);
        this.fw24.setConstructOutput(this, `restAPI_controller_${rootSegment}`, resource, construct_1.OutputType.RESOURCE, 'resourceId');
        return entry;
    }
    getOrCreateControllerResource = (controllerName, controllerStackName) => {
        let restAPI = this.getAPI(controllerStackName);
        let controllerResource = restAPI.api.root;
        const currentStack = this.fw24.getStack(controllerStackName);
        const pathParts = controllerName.split('/');
        for (const pathPart of pathParts) {
            let childResource = controllerResource.getResource(pathPart);
            // The first path part of a nested controller (e.g. `internal` in `internal/notifications`)
            // is a SHARED root owned by the main stack. Resolve it from there instead of letting
            // whichever controller registers first create it — this is what removes the 409/ordering bug.
            const isNestedController = pathParts.length > 1;
            if (!childResource && isNestedController && pathPart === pathParts[0]) {
                const sharedRoot = this.getOrCreateSharedControllerRoot(pathPart);
                if (currentStack === sharedRoot.ownerStack) {
                    // same stack as the owner (single-stack app, or this controller IS the owner) — use it directly
                    childResource = sharedRoot.resource;
                }
                else {
                    // reference the owner stack's root by its resource-id token; CDK wires it across stacks
                    this.logger.debug(`Referencing shared root /${pathPart} (owner ${sharedRoot.ownerStack.stackName}) from ${controllerStackName}`);
                    childResource = aws_apigateway_1.Resource.fromResourceAttributes(currentStack, `${this.fw24.appName}-${controllerStackName}-${pathPart}`, {
                        resourceId: sharedRoot.resource.resourceId,
                        restApi: restAPI.api,
                        path: '/' + pathPart
                    });
                }
            }
            if (!childResource) {
                // for nested resources add / to the path
                this.logger.debug(`Creating controller resource for path ${pathPart} under ${controllerResource.path}`);
                childResource = controllerResource.addResource(pathPart);
                if (restAPI.isImported) {
                    const corsPreflightMethod = childResource.addCorsPreflight(this.getCorsPreflightOptions());
                    this.methods.push(corsPreflightMethod);
                }
            }
            controllerResource = childResource;
        }
        return controllerResource;
    };
    createLambdaFunction = (controllerName, filePath, fileName, controllerConfig, controllerStackName) => {
        const functionProps = (0, utils_1.merge)([
            this.apiConstructConfig.functionProps ?? {},
            controllerConfig?.functionProps ?? {}
        ]);
        const envVariables = this.fw24.resolveEnvVariables(controllerConfig.env, this.fw24.getStack(controllerStackName));
        // do not override the entry packages if already set
        if (!(fw24_2.ENV_KEYS.ENTRY_PACKAGES in envVariables) && controllerConfig.entryPackages) {
            envVariables[fw24_2.ENV_KEYS.ENTRY_PACKAGES] = controllerConfig.entryPackages.join(',');
        }
        return new lambda_function_1.LambdaFunction(this.fw24.getStack(controllerStackName), controllerName + "-controller", {
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
        });
    };
    extractDefaultAuthorizer = (controllerConfig) => {
        let defaultAuthorizerName = this.fw24.getDefaultCognitoAuthorizerName();
        let defaultAuthorizerType;
        let defaultAuthorizerGroups;
        let defaultRequireRouteInGroupConfig = false;
        if (Array.isArray(controllerConfig?.authorizer)) {
            const defaultAuthorizer = controllerConfig.authorizer.find((auth) => auth.default) || controllerConfig.authorizer[0];
            defaultAuthorizerName = defaultAuthorizer.name || defaultAuthorizerName;
            defaultAuthorizerType = defaultAuthorizer.type;
            defaultAuthorizerGroups = defaultAuthorizer.groups || [];
            defaultRequireRouteInGroupConfig = defaultAuthorizer.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        }
        else if (typeof controllerConfig.authorizer === 'object') {
            defaultAuthorizerName = controllerConfig.authorizer.name || defaultAuthorizerName;
            defaultAuthorizerType = controllerConfig.authorizer.type;
            defaultAuthorizerGroups = controllerConfig.authorizer.groups || [];
            defaultRequireRouteInGroupConfig = controllerConfig.requireRouteInGroupConfig || defaultRequireRouteInGroupConfig;
        }
        else {
            defaultAuthorizerType = controllerConfig.authorizer;
        }
        if (!defaultAuthorizerType && this.fw24.getConfig().defaultAuthorizationType) {
            defaultAuthorizerType = this.fw24.getConfig().defaultAuthorizationType;
        }
        if (defaultAuthorizerGroups) {
            // if the value for the groups is a template string, 
            // resolve it [when the application want to allow multiple user groups to have access]
            // when the value is like "env:xxx:group1" ==> "group1-resolved" || "group1,group2" || "env:xxx:group1,env:xxx:group2"
            if ((0, utils_2.isString)(defaultAuthorizerGroups)) {
                defaultAuthorizerGroups = this.fw24.tryResolveEnvKeyTemplate(defaultAuthorizerGroups);
            }
            // now if the resolved value is again a string, split it by comma
            // when the value is like "group1,group2" ==> ["group1", "group2"]
            if ((0, utils_2.isString)(defaultAuthorizerGroups)) {
                defaultAuthorizerGroups = defaultAuthorizerGroups.split(',');
            }
            if (!defaultAuthorizerGroups.length && this.fw24.getConfig().defaultAdminGroups) {
                defaultAuthorizerGroups = this.fw24.getConfig().defaultAdminGroups;
            }
            // resolve the group names from fw24-scope if it's a template
            // when the value is like ["env:xxx:group1","env:xxx:group2"] ==> ["group1-resolved", "group2-resolved"]
            defaultAuthorizerGroups = defaultAuthorizerGroups.map(this.fw24.tryResolveEnvKeyTemplate);
            // flat-map the groups if they resolved group values are again comma separated
            // when the resolved value is like ["a,b", "c,d"] ==> ["a", "b", "c", "d"]
            defaultAuthorizerGroups = defaultAuthorizerGroups.flatMap(group => group.split(','));
        }
        // Ensure defaultAuthorizerGroups is always an array
        const normalizedGroups = !defaultAuthorizerGroups
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
    };
    getOrCreateRouteResource = (parentResource, path, controllerStackName) => {
        let currentResource = parentResource;
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
    };
    extractRouteAuthorizer = (route, defaultAuthorizerType, defaultAuthorizerName, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig) => {
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
        }
        else if (typeof route.authorizer === 'string') {
            routeAuthorizerType = route.authorizer;
        }
        return { routeAuthorizerName, routeAuthorizerType, routeAuthorizerGroups, routeRequireRouteInGroupConfig };
    };
    createMethodOptions = (route, routeAuthorizerType, routeAuthorizerName, controllerConfig) => {
        const requestParameters = {};
        // Add path parameters
        for (const param of route.parameters || []) {
            requestParameters[`method.request.path.${param}`] = true;
        }
        // Add API key header requirement if specified
        if (controllerConfig.requireApiKey) {
            requestParameters['method.request.header.x-api-key'] = true;
        }
        // If the authorizer is JWT, convert it to CUSTOM
        const authorizer = this.fw24.getAuthorizer(routeAuthorizerType, routeAuthorizerName);
        if (routeAuthorizerType === 'JWT') {
            routeAuthorizerType = 'CUSTOM';
        }
        return {
            requestParameters,
            authorizationType: routeAuthorizerType,
            authorizer: authorizer,
            apiKeyRequired: controllerConfig.requireApiKey || false
        };
    };
    createSQSIntegration = (queueName, controllerName, controllerStackName) => {
        this.logger.debug(`Creating SQS integration for queue ${queueName} in controller ${controllerName} in stack ${controllerStackName}`);
        const integrationRole = new aws_iam_1.Role(this.fw24.getStack(controllerStackName), `${controllerName}-${queueName}-sqs-integration-role`, {
            assumedBy: new aws_iam_1.ServicePrincipal("apigateway.amazonaws.com"),
        });
        const queueArn = this.fw24.getArn('sqs', this.fw24.getEnvironmentVariable(queueName + '_queueName', 'queue', this.fw24.getStack(controllerStackName)));
        const queueInstance = aws_sqs_1.Queue.fromQueueArn(this.fw24.getStack(controllerStackName), `${controllerName}-${queueName}-queue`, queueArn);
        queueInstance.grantSendMessages(integrationRole);
        return new aws_apigateway_1.AwsIntegration({
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
    };
    createSNSIntegration = (topicName, controllerName, controllerStackName) => {
        const integrationRole = new aws_iam_1.Role(this.fw24.getStack(controllerStackName), `${controllerName}-${topicName}-sns-integration-role`, {
            assumedBy: new aws_iam_1.ServicePrincipal("apigateway.amazonaws.com"),
        });
        const topicArn = this.fw24.getArn('sns', this.fw24.getEnvironmentVariable(topicName + '_topicName', 'topic', this.fw24.getStack(controllerStackName)));
        const topicInstance = aws_sns_1.Topic.fromTopicArn(this.fw24.getStack(controllerStackName), `${controllerName}-${topicName}-topic`, topicArn);
        topicInstance.grantPublish(integrationRole);
        return new aws_apigateway_1.AwsIntegration({
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
    };
    outputApiEndpoint = (controllerName, controllerResource, stageName, controllerStackName) => {
        new aws_cdk_lib_1.CfnOutput(this.fw24.getStack(controllerStackName), `Endpoint${controllerName}`, {
            value: 'https://' + this.getAPI(controllerStackName).api.restApiId + '.execute-api.' + this.fw24.getStack(controllerStackName).region + '.amazonaws.com/' + stageName + '/' + controllerResource.path.slice(1),
            description: "API Gateway Endpoint for " + controllerName,
        });
    };
    setupUsagePlan(planConfig, createKey = false) {
        // If no plan config is provided and we need a key, use the first configured plan or create a default one
        if (!planConfig && createKey) {
            // Try to use the first configured plan that has API keys
            const configuredPlan = this.apiConstructConfig.usagePlans?.find(plan => plan.apiKeys);
            if (configuredPlan) {
                planConfig = configuredPlan;
            }
            else {
                // If no configured plan with keys exists, create a default plan
                // Generate a deterministic key based on app name and a fixed identifier
                const defaultKey = (0, node_crypto_1.createHash)('sha256')
                    .update(`${this.fw24.appName}-${this.fw24.getConfig().account}-${this.fw24.getConfig().region}-${this.fw24.getConfig().environment}-default-api-key`)
                    .digest('hex')
                    .slice(0, 32); // Use first 32 chars for a reasonable key length
                this.logger.warn(`No usage plan with API keys found, creating a default one. This is not recommended for production environments. Please configure a usage plan with API keys for your API.`);
                planConfig = {
                    name: `${this.fw24.appName}-default-usage-plan`,
                    description: `Default usage plan for ${this.fw24.appName}`,
                    apiKeys: {
                        keys: [defaultKey]
                    }
                };
            }
        }
        const planName = planConfig?.name || `${this.fw24.appName}-default-usage-plan`;
        if (!this.usagePlans.has(planName)) {
            this.logger.info(`Setting up usage plan: ${planName}`);
            const usagePlan = new aws_apigateway_1.UsagePlan(this.mainStack, `${this.fw24.appName}-${planName}-usage-plan`, {
                name: planName,
                description: planConfig?.description || `Usage plan for ${this.fw24.appName}`,
                apiStages: [{
                        api: this.api,
                        stage: this.api.deploymentStage
                    }],
                throttle: {
                    rateLimit: planConfig?.rateLimit || 10,
                    burstLimit: planConfig?.burstLimit || 20
                },
                quota: {
                    limit: planConfig?.quotaLimit || 10000,
                    period: planConfig?.quotaPeriod || aws_apigateway_1.Period.MONTH
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
                        existingKey = new aws_apigateway_1.ApiKey(this.mainStack, `${this.fw24.appName}-${keyName}-api-key`, {
                            enabled: true,
                            description: `API key ${index + 1} for ${this.fw24.appName}`,
                            value: key
                        });
                        new aws_cdk_lib_1.CfnOutput(this.mainStack, `${this.fw24.appName}-${keyName}-id`, {
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
exports.APIConstruct = APIConstruct;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVNBLCtEQVdvQztBQUVwQyw2Q0FBcUY7QUFFckYsaURBQTZEO0FBRTdELGlEQUE0QztBQUM1QyxpREFBNEM7QUFNNUMsbUZBSXlDO0FBQ3pDLHVDQUFvQztBQUNwQywyQ0FBd0M7QUFDeEMsdURBQXlGO0FBQ3pGLHdDQUEwQztBQUUxQyxvQ0FBaUM7QUFDakMsdURBQW1EO0FBQ25ELDZEQUF5RDtBQTRCekQsNkNBQXFEO0FBQ3JELHFDQUE4RDtBQUM5RCwwREFBNkI7QUFFN0Isa0NBQW1DO0FBRW5DLG9DQUE2QztBQUM3QyxpQ0FBdUM7QUFDdkMsK0NBQXFEO0FBQ3JELHlDQUErQztBQUMvQyxtQ0FBeUM7QUFDekMscUNBQTJDO0FBQzNDLG1DQUF5QztBQUN6QyxtQ0FBeUM7QUFDekMsK0JBQXFDO0FBd0tyQyxNQUFhLFlBQVk7SUFtQ1E7SUFsQ3BCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLFlBQVksQ0FBQyxJQUFJLENBQUM7SUFDakMsWUFBWSxHQUFhLENBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsd0JBQWUsQ0FBQyxJQUFJLEVBQUUsNEJBQWlCLENBQUMsSUFBSSxFQUFFLG9CQUFhLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxDQUFFLENBQUM7SUFDaEwsTUFBTSxDQUF1QjtJQUU3QixHQUFHLENBQVc7SUFDZCxTQUFTLENBQVM7SUFDbEIsVUFBVSxHQUFtRCxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3ZFLE9BQU8sR0FBMEIsSUFBSSxHQUFH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QUFJLFdBQVcsRUFBRSxDQUFDO3dCQUNkLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7b0JBQ2xDLENBQUM7Z0JBQ0wsQ0FBQyxDQUFDLENBQUM7WUFDUCxDQUFDO1FBQ0wsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2hELElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNiLE1BQU0sSUFBSSxLQUFLLENBQUMsY0FBYyxRQUFRLFlBQVksQ0FBQyxDQUFDO1FBQ3hELENBQUM7UUFDRCxPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0NBRUo7QUF0akNELG9DQXNqQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7XG4gICAgQXV0aG9yaXphdGlvblR5cGUsXG4gICAgQ29yc09wdGlvbnMsXG4gICAgSVJlc291cmNlLFxuICAgIE1ldGhvZCxcbiAgICBNZXRob2RPcHRpb25zLFxuICAgIFJlc3RBcGlQcm9wc1xufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcblxuaW1wb3J0IHtcbiAgICBBd3NJbnRlZ3JhdGlvbixcbiAgICBDb3JzLFxuICAgIERlcGxveW1lbnQsXG4gICAgUmVzb3VyY2UsXG4gICAgUmVzcG9uc2VUeXBlLFxuICAgIFJlc3RBcGksXG4gICAgU3RhZ2UsXG4gICAgQXBpS2V5LFxuICAgIFBlcmlvZCxcbiAgICBVc2FnZVBsYW5cbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5cbmltcG9ydCB7IENmbk91dHB1dCwgRHVyYXRpb24sIE5lc3RlZFN0YWNrLCBSZW1vdmFsUG9saWN5LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuXG5pbXBvcnQgeyBSb2xlLCBTZXJ2aWNlUHJpbmNpcGFsIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IFRvcGljIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcblxuaW1wb3J0IHR5cGUgeyBJRncyNE1vZHVsZSB9IGZyb20gXCIuLi9jb3JlL1wiO1xuaW1wb3J0IHR5cGUgSGFuZGxlckRlc2NyaXB0b3IgZnJvbSBcIi4uL2ludGVyZmFjZXMvaGFuZGxlci1kZXNjcmlwdG9yXCI7XG5cbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBOb2RlanNGdW5jdGlvblByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQge1xuICAgIGNyZWF0ZUNsb3VkRm9ybWF0aW9uTmVzdGVkUm9vdExvb2t1cCxcbiAgICBOZXN0ZWRSb290Q2xvdWRGb3JtYXRpb25Mb29rdXAsXG4gICAgcmVzb2x2ZURlcGxveWVkTmVzdGVkUm9vdE93bmVycyxcbn0gZnJvbSBcIi4vbmVzdGVkLWNvbnRyb2xsZXItcm9vdC1sb29rdXBcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgTXV0YWJsZSBmcm9tIFwiLi4vdHlwZXMvbXV0YWJsZVwiO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBMYW1iZGFJbnRlZ3JhdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1pbnRlZ3JhdGlvblwiO1xuXG5pbnRlcmZhY2UgSUFQSVJlZmVyZW5jZSB7XG4gICAgYXBpOiBSZXN0QXBpO1xuICAgIGlzSW1wb3J0ZWQ6IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBJQXV0aG9yaXplckNvbmZpZyB7XG4gICAgbmFtZT86IHN0cmluZztcbiAgICB0eXBlPzogc3RyaW5nO1xuICAgIGdyb3Vwcz86IHN0cmluZyB8IHN0cmluZ1tdO1xuICAgIHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc/OiBib29sZWFuO1xuICAgIGRlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgSUNvbnRyb2xsZXJDb25maWdXaXRoQXV0aG9yaXplciBleHRlbmRzIElDb250cm9sbGVyQ29uZmlnIHtcbiAgICByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnPzogYm9vbGVhbjtcbiAgICBhdXRob3JpemVyPzogc3RyaW5nIHwgSUF1dGhvcml6ZXJDb25maWcgfCBJQXV0aG9yaXplckNvbmZpZ1tdO1xufVxuXG5pbnRlcmZhY2UgSVJvdXRlV2l0aEF1dGhvcml6ZXIge1xuICAgIGh0dHBNZXRob2Q6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgdGFyZ2V0Pzogc3RyaW5nO1xuICAgIHBhcmFtZXRlcnM/OiBzdHJpbmdbXSB8IFN0cmluZ1tdO1xuICAgIGF1dGhvcml6ZXI/OiBzdHJpbmcgfCBJQXV0aG9yaXplckNvbmZpZztcbn1cblxuaW1wb3J0IHsgY3JlYXRlSGFzaCwgcmFuZG9tVVVJRCB9IGZyb20gXCJub2RlOmNyeXB0b1wiO1xuaW1wb3J0IHsgY29weUZpbGVTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBJQ29udHJvbGxlckNvbmZpZyB9IGZyb20gXCIuLi9kZWNvcmF0b3JzL2NvbnRyb2xsZXJcIjtcbmltcG9ydCB7IEVOVl9LRVlTIH0gZnJvbSBcIi4uL2Z3MjRcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBpc0FycmF5LCBpc1N0cmluZyB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgQXV0aENvbnN0cnVjdCB9IGZyb20gXCIuL2F1dGhcIjtcbmltcG9ydCB7IENlcnRpZmljYXRlQ29uc3RydWN0IH0gZnJvbSBcIi4vY2VydGlmaWNhdGVcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0IH0gZnJvbSBcIi4vZHluYW1vZGJcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcbmltcG9ydCB7IE1haWxlckNvbnN0cnVjdCB9IGZyb20gXCIuL21haWxlclwiO1xuaW1wb3J0IHsgUXVldWVDb25zdHJ1Y3QgfSBmcm9tIFwiLi9xdWV1ZVwiO1xuaW1wb3J0IHsgVG9waWNDb25zdHJ1Y3QgfSBmcm9tIFwiLi90b3BpY1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBvcHRpb25zIGZvciBhbiBBUEkgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElBUElDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIENPUlMgY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSS5cbiAgICAgKiBJdCBjYW4gYmUgYSBib29sZWFuIHZhbHVlLCBhIHNpbmdsZSBzdHJpbmcsIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MuXG4gICAgICovXG4gICAgY29ycz86IGJvb2xlYW4gfCBzdHJpbmcgfCBzdHJpbmdbXTtcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyBhZGRpdGlvbmFsIG9wdGlvbnMgZm9yIHRoZSBBUEkuXG4gICAgICovXG4gICAgYXBpT3B0aW9ucz86IFJlc3RBcGlQcm9wcztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgZGlyZWN0b3J5IHdoZXJlIHRoZSBjb250cm9sbGVycyBhcmUgbG9jYXRlZC5cbiAgICAgKi9cbiAgICBjb250cm9sbGVyc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgZnVuY3Rpb24uXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIG51bWJlciBvZiBkYXlzIHRvIHJldGFpbiB0aGUgQVBJIGxvZ3MuXG4gICAgICovXG4gICAgbG9nUmV0ZW50aW9uRGF5cz86IFJldGVudGlvbkRheXM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIHJlbW92YWwgcG9saWN5IGZvciB0aGUgQVBJIGxvZ3MuXG4gICAgICovXG4gICAgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY3VzdG9tIGRvbWFpbiBuYW1lIGZvciB0aGUgQVBJLlxuICAgICAqL1xuICAgIGRvbWFpbk5hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY2VydGlmaWNhdGUgQVJOIGZvciB0aGUgY3VzdG9tIGRvbWFpbiBuYW1lLlxuICAgICAqL1xuICAgIGNlcnRpZmljYXRlQXJuPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogQVBJIEdhdGV3YXkgTGFtYmRhIGludGVncmF0aW9uIHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICAgKi9cbiAgICBpbnRlZ3JhdGlvblRpbWVvdXQ/OiBudW1iZXI7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcGFyZW50IHN0YWNrIG5hbWUgZm9yIHRoZSBDb250cm9sbGVycy5cbiAgICAgKi9cbiAgICBjb250cm9sbGVyUGFyZW50U3RhY2tOYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogT3duZXJzaGlwIHN0cmF0ZWd5IGZvciBzaGFyZWQgbmVzdGVkLWNvbnRyb2xsZXIgcm9vdCBzZWdtZW50cyAodGhlIGZpcnN0IHBhdGggcGFydCBvZiBhXG4gICAgICogbmVzdGVkIHJvdXRlLCBlLmcuIGBpbnRlcm5hbGAgaW4gYGludGVybmFsL25vdGlmaWNhdGlvbnNgKS4gSW4gZXZlcnkgc3RyYXRlZ3kgdGhlIG93bmVyIGlzXG4gICAgICogZGVjaWRlZCB1cCBmcm9udCDigJQgbmV2ZXIgYnkgY29udHJvbGxlciByZWdpc3RyYXRpb24gb3JkZXIg4oCUIHNvIHRoZSBzaGFyZWQgcmVzb3VyY2Unc1xuICAgICAqIENsb3VkRm9ybWF0aW9uIGxvZ2ljYWwgaWQgaXMgc3RhYmxlIGFuZCB0aGUgaGlzdG9yaWNhbCA0MDkvb3JkZXJpbmcgYnVnIGNhbm5vdCBvY2N1ci4gTm9cbiAgICAgKiBoYXJkY29kZWQgc2VnbWVudCBuYW1lcyBpbiBhbnkgc3RyYXRlZ3kuXG4gICAgICpcbiAgICAgKiAtIGAnbWFpbi1zdGFjaydgIChkZWZhdWx0KTogdGhlIG1haW4gUmVzdEFwaSBzdGFjayBvd25zIGV2ZXJ5IHNoYXJlZCByb290LiBaZXJvIGNvbmZpZywgZnVsbHlcbiAgICAgKiAgIGRldGVybWluaXN0aWMgKG5vIEFXUyBjYWxscykg4oCUIG5ldyBhcHBzIG5lZWQgbm90aGluZy4gQW4gYXBwIGFscmVhZHkgZGVwbG95ZWQgd2l0aCB0aGUgcm9vdFxuICAgICAqICAgaW4gYSBuZXN0ZWQgc3RhY2sgbW92ZXMgaXQgb25jZSBwZXIgZW52aXJvbm1lbnQgdmlhIGBjZGsgcmVmYWN0b3JgLlxuICAgICAqIC0gYCdwaW5uZWQnYDogYSBzaGFyZWQgcm9vdCBzdGF5cyBpbiB0aGUgY29udHJvbGxlciBzdGFjayB0aGF0IGFscmVhZHkgb3ducyBpdCDigJQgeW91IHN1cHBseVxuICAgICAqICAgYG5lc3RlZENvbnRyb2xsZXJSb290T3duZXJzYC4gRGV0ZXJtaW5pc3RpYyBhbmQgb2ZmbGluZTsgbW92ZXMgbm8gbGl2ZSByZXNvdXJjZS4gUm9vdHMgbm90XG4gICAgICogICBsaXN0ZWQgZmFsbCBiYWNrIHRvIHRoZSBtYWluIHN0YWNrLlxuICAgICAqIC0gYCdhdXRvJ2A6IGF0IGJ1aWxkIHRpbWUgaXQgbG9va3MgdXAgZGVwbG95ZWQgQ2xvdWRGb3JtYXRpb24gdG8gZGlzY292ZXIgd2hpY2ggY29udHJvbGxlclxuICAgICAqICAgc3RhY2sgY3VycmVudGx5IG93bnMgZWFjaCByb290IChtYXRjaGVkIGJ5IHJvdXRlLCBub3QgbG9naWNhbCBpZCksIGFuZCBrZWVwcyBpdCB0aGVyZS4gTm9cbiAgICAgKiAgIGNvbmZpZyBhbmQgbW92ZXMgbm8gbGl2ZSByZXNvdXJjZSDigJQgYnV0IHRoZSBidWlsZCBuZWVkcyBBV1MgY3JlZGVudGlhbHMgKHByZXNlbnQgaW4gQ0kvQ0RcbiAgICAgKiAgIGRlcGxveSkuIEl0IGZhaWxzIGxvdWQgaWYgaXQgY2Fubm90IHJlc29sdmUgYW4gb3duZXIgKHJhdGhlciB0aGFuIGd1ZXNzaW5nKTsgc2V0IGFcbiAgICAgKiAgIGBuZXN0ZWRDb250cm9sbGVyUm9vdE93bmVyc2AgZW50cnkgYXMgYW4gZXhwbGljaXQgZmFsbGJhY2sgZm9yIHRob3NlIGNhc2VzLlxuICAgICAqXG4gICAgICogQGRlZmF1bHQgJ21haW4tc3RhY2snXG4gICAgICovXG4gICAgbmVzdGVkQ29udHJvbGxlclJvb3RTdHJhdGVneT86ICdtYWluLXN0YWNrJyB8ICdwaW5uZWQnIHwgJ2F1dG8nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGNvbnRyb2xsZXIgc3RhY2sgdGhhdCBhbHJlYWR5IG93bnMgYSBzaGFyZWQgcm9vdCBpbiB0aGUgZGVwbG95ZWQgYXBwLCBlLmcuXG4gICAgICogYHsgaW50ZXJuYWw6ICdpbnRlcm5hbC90ZWFtJyB9YC4gUmVxdWlyZWQgd2l0aCBgJ3Bpbm5lZCdgOyBvcHRpb25hbCB3aXRoIGAnYXV0bydgIGFzIGFuXG4gICAgICogZXhwbGljaXQgZmFsbGJhY2sgd2hlbiB0aGUgbG9va3VwIGNhbid0IHJlc29sdmUgKG5vIGNyZWRzIC8gYW1iaWd1b3VzIC8gdW5tYXRjaGVkKS4gVGhlIG5hbWVkXG4gICAgICogc3RhY2sga2VlcHMgY3JlYXRpbmcgdGhlIHJvb3QgcmVzb3VyY2UgKHByZXNlcnZpbmcgaXRzIGV4aXN0aW5nIENsb3VkRm9ybWF0aW9uIGxvZ2ljYWwgaWQpIGFuZFxuICAgICAqIGV2ZXJ5IHNpYmxpbmcgcmVmZXJlbmNlcyBpdCDigJQgc28gdXBncmFkaW5nIG1vdmVzIG5vdGhpbmcgYW5kIHN0YXlzIHplcm8tZG93bnRpbWUuXG4gICAgICovXG4gICAgbmVzdGVkQ29udHJvbGxlclJvb3RPd25lcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuXG4gICAgLyoqXG4gICAgICogU2V0IHRvIGZhbHNlIGlmIHlvdSB3YW50IHRvIHNraXAgY3JlYXRpb24gb2YgY29udHJvbGxlcnMgcmVzb3VyY2VzIGFuZCBtZXRob2RzXG4gICAgICogVGhpcyB3aWxsIGRlbGV0ZSBhbGwgdGhlIGNvbnRyb2xsZXJzIHJlc291cmNlcyBhbmQgbWV0aG9kcyBmcm9tIHRoZSBBUElcbiAgICAgKi9cbiAgICBza2lwQ29udHJvbGxlcnM/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogRm9yY2UgYSBkZXBsb3ltZW50IG9mIHRoZSBBUEkgd2hlbiB1c2luZyBpbXBvcnRlZCBBUElzXG4gICAgICovXG4gICAgZm9yY2VEZXBsb3ltZW50PzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIEFQSSBrZXkgY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSVxuICAgICAqL1xuICAgIGFwaUtleUNvbmZpZz86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIExpc3Qgb2YgdmFsaWQgQVBJIGtleXMuIElmIGVtcHR5LCBrZXlzIHdpbGwgYmUgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICovXG4gICAgICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIE5hbWUgb2YgdGhlIEFQSSBrZXkgKHVzZWQgd2hlbiBhdXRvLWdlbmVyYXRpbmcpXG4gICAgICAgICAqL1xuICAgICAgICBrZXlOYW1lPzogc3RyaW5nO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBVc2FnZSBwbGFuIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBUElcbiAgICAgKi9cbiAgICB1c2FnZVBsYW5zPzogSVVzYWdlUGxhbkNvbmZpZ1tdO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIEFQSSBrZXkgd2l0aGluIGEgdXNhZ2UgcGxhblxuICovXG5pbnRlcmZhY2UgSVVzYWdlUGxhbkFwaUtleUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogTGlzdCBvZiB2YWxpZCBBUEkga2V5cy4gSWYgZW1wdHksIGtleXMgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZFxuICAgICAqL1xuICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBOYW1lIHByZWZpeCBmb3IgdGhlIEFQSSBrZXlzICh1c2VkIHdoZW4gYXV0by1nZW5lcmF0aW5nKVxuICAgICAqL1xuICAgIGtleU5hbWVQcmVmaXg/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgYSB1c2FnZSBwbGFuXG4gKi9cbmludGVyZmFjZSBJVXNhZ2VQbGFuQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgbmFtZTogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIERlc2NyaXB0aW9uIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogUmF0ZSBsaW1pdCBwZXIgc2Vjb25kXG4gICAgICovXG4gICAgcmF0ZUxpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIEJ1cnN0IGxpbWl0XG4gICAgICovXG4gICAgYnVyc3RMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBsaW1pdCBwZXIgcGVyaW9kXG4gICAgICovXG4gICAgcXVvdGFMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBwZXJpb2RcbiAgICAgKi9cbiAgICBxdW90YVBlcmlvZD86IFBlcmlvZDtcbiAgICAvKipcbiAgICAgKiBBUEkga2V5IGNvbmZpZ3VyYXRpb24gZm9yIHRoaXMgdXNhZ2UgcGxhblxuICAgICAqL1xuICAgIGFwaUtleXM/OiBJVXNhZ2VQbGFuQXBpS2V5Q29uZmlnO1xufVxuXG5leHBvcnQgY2xhc3MgQVBJQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEFQSUNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gQVBJQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIE1haWxlckNvbnN0cnVjdC5uYW1lLCBEeW5hbW9EQkNvbnN0cnVjdC5uYW1lLCBBdXRoQ29uc3RydWN0Lm5hbWUsIFF1ZXVlQ29uc3RydWN0Lm5hbWUsIFRvcGljQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWUgXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgYXBpITogUmVzdEFwaTtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICB1c2FnZVBsYW5zOiBNYXA8c3RyaW5nLCB7IHBsYW46IFVzYWdlUGxhbjsgbmFtZTogc3RyaW5nIH0+ID0gbmV3IE1hcCgpO1xuICAgIGFwaUtleXM6IE1hcDxzdHJpbmcsIEFwaUtleVtdPiA9IG5ldyBNYXAoKTtcbiAgICBrZXlWYWx1ZXM6IE1hcDxzdHJpbmcsIEFwaUtleT4gPSBuZXcgTWFwKCk7XG5cbiAgICBwcml2YXRlIHJlc291cmNlczogSVJlc291cmNlW10gPSBbXTtcbiAgICBwcml2YXRlIG1ldGhvZHM6IE1ldGhvZFtdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBjb250cm9sbGVyU3RhY2tzID0gbmV3IE1hcDxzdHJpbmcsIHsgbWV0aG9kczogTWV0aG9kW10sIHJlc291cmNlczogSVJlc291cmNlW10sIGNvbnRyb2xsZXJzSGFzaDogc3RyaW5nW10gfT4oKTtcblxuICAgIC8qKlxuICAgICAqIFNoYXJlZCByb290IHNlZ21lbnRzIGZvciBuZXN0ZWQgY29udHJvbGxlcnMgKGUuZy4gYGludGVybmFsYCBmb3IgYGludGVybmFsL25vdGlmaWNhdGlvbnNgKSxcbiAgICAgKiBlYWNoIGNyZWF0ZWQgZXhhY3RseSBvbmNlIGluIGEgU1RBQkxFIG93bmVyIHN0YWNrIGFuZCByZWZlcmVuY2VkIGJ5IGV2ZXJ5IHNpYmxpbmcgbmVzdGVkIHN0YWNrXG4gICAgICogdmlhIHRoZSByZXNvdXJjZS1pZCB0b2tlbi4gVGhlIG93bmVyIGlzIHRoZSBtYWluIHN0YWNrIGJ5IGRlZmF1bHQsIG9yIGEgcGlubmVkIGNvbnRyb2xsZXJcbiAgICAgKiBzdGFjayAoYG5lc3RlZENvbnRyb2xsZXJSb290T3duZXJzYCkgZm9yIGFscmVhZHktZGVwbG95ZWQgYXBwcy4gRWl0aGVyIHdheSB0aGUgb3duZXIgaXMgZml4ZWRcbiAgICAgKiBieSBjb25maWcg4oCUIG5ldmVyIGJ5IHJlZ2lzdHJhdGlvbiBvcmRlciDigJQgc28gdGhlIHNlZ21lbnQncyBDbG91ZEZvcm1hdGlvbiBsb2dpY2FsIGlkIGlzXG4gICAgICogaWRlbnRpY2FsIG9uIGV2ZXJ5IHN5bnRoLiBObyA0MDksIG5vIGxpdmUgQVdTIGxvb2t1cHMuXG4gICAgICovXG4gICAgcHJpdmF0ZSByZWFkb25seSBzaGFyZWRDb250cm9sbGVyUm9vdHMgPSBuZXcgTWFwPHN0cmluZywgeyByZXNvdXJjZTogSVJlc291cmNlOyBvd25lclN0YWNrOiBTdGFjayB9PigpO1xuICAgIC8qKiAnYXV0bycgc3RyYXRlZ3k6IHJlc29sdmVkIGByb290U2VnbWVudCAtPiBvd25pbmcgY29udHJvbGxlciBzdGFjayBuYW1lYCwgZGlzY292ZXJlZCBmcm9tIGRlcGxveWVkIHN0YXRlLiAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVzb2x2ZWRBdXRvUm9vdE93bmVycyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gICAgLyoqIEluamVjdGFibGUgQ2xvdWRGb3JtYXRpb24gbG9va3VwIGZvciB0aGUgJ2F1dG8nIHN0cmF0ZWd5IChvdmVycmlkYWJsZSBpbiB0ZXN0cykuICovXG4gICAgcHJpdmF0ZSBuZXN0ZWRSb290TG9va3VwPzogTmVzdGVkUm9vdENsb3VkRm9ybWF0aW9uTG9va3VwO1xuICAgIC8qKiBUcnVlIG9uY2UgYW4gYXBpLWtleSB1c2FnZSBwbGFuIHdhcyByZXF1ZXN0ZWQgd2hpbGUgZGVwbG95bWVudCB3YXMgc3RpbGwgZGVmZXJyZWQuICovXG4gICAgcHJpdmF0ZSBkZWZlcnJlZEFwaUtleVBsYW5SZXF1ZXN0ZWQgPSBmYWxzZTtcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgYXBpQ29uc3RydWN0Q29uZmlnOiBJQVBJQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIC8vIGh5ZHJhdGUgdGhlIGNvbmZpZyBvYmplY3Qgd2l0aCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZXg6IEFQSUdBVEVXQVlfQ09OVFJPTExFUlNcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoYXBpQ29uc3RydWN0Q29uZmlnLCAnQVBJR0FURVdBWScpO1xuICAgIH1cblxuICAgIC8vIGNvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFja1xuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIHNldCB0aGUgZGVmYXVsdCBhcGkgb3B0aW9uc1xuICAgICAgICBjb25zdCBwYXJhbXNBcGk6IE11dGFibGU8UmVzdEFwaVByb3BzPiA9IHsgLi4udGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpT3B0aW9ucyB8fCB7fSB9O1xuICAgICAgICAvLyBFbmFibGUgQ09SUyBpZiBkZWZpbmVkXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkVuYWJsaW5nIENPUlMuLi4gdGhpcy5jb25maWcuY29yczogXCIsIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpO1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9ucyA9IHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSAmJiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlQ29uc3RydWN0ID0gbmV3IENlcnRpZmljYXRlQ29uc3RydWN0KHtcbiAgICAgICAgICAgICAgICBkb21haW5OYW1lOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLFxuICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlQXJuOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jZXJ0aWZpY2F0ZUFyblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlID0gY2VydGlmaWNhdGVDb25zdHJ1Y3Qub3V0cHV0WyBPdXRwdXRUeXBlLkNFUlRJRklDQVRFIF1bIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUgXTtcbiAgICAgICAgICAgIHBhcmFtc0FwaS5kb21haW5OYW1lID0ge1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgY2VydGlmaWNhdGU6IGNlcnRpZmljYXRlLFxuICAgICAgICAgICAgICAgIGJhc2VQYXRoOiBwYXJhbXNBcGkuZGVwbG95T3B0aW9ucz8uc3RhZ2VOYW1lIHx8ICcvJyxcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gZm9yIG11bHRpc3RhY2sgYXBwbGljYXRpb24sIHNldCBkZXBsb3kgdG8gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlcGxveSA9IGZhbHNlO1xuICAgICAgICAgICAgZGVsZXRlIHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXNOZXN0ZWRDb250cm9sbGVyRGVwbG95bWVudCgpKSB7XG4gICAgICAgICAgICAvLyBOZXN0ZWQtY29udHJvbGxlciBhcHBzIHB1Ymxpc2ggYSBzaW5nbGUsIGV4cGxpY2l0IHN0YWdlIEFGVEVSIGV2ZXJ5IG5lc3RlZCBzdGFjayBpc1xuICAgICAgICAgICAgLy8gcmVnaXN0ZXJlZCAoc2VlIGNyZWF0ZVNpbmdsZURlcGxveW1lbnQpLiBMZXR0aW5nIFJlc3RBcGkgYXV0by1kZXBsb3kgaGVyZSB3b3VsZFxuICAgICAgICAgICAgLy8gcHVibGlzaCBhbiBlYXJseSBzdGFnZSB0aGF0IG1pc3NlcyBsYXRlLXJlZ2lzdGVyZWQgbmVzdGVkIHJvdXRlcyAodGhlIFwiZGVwbG95IHR3aWNlXCJcbiAgICAgICAgICAgIC8vIGJ1ZykuIFdlIGFzc2lnbiB0aGlzLmFwaS5kZXBsb3ltZW50U3RhZ2Ugb3Vyc2VsdmVzIG9uY2UgdGhlIGRlcGxveW1lbnQgZXhpc3RzLlxuICAgICAgICAgICAgcGFyYW1zQXBpLmRlcGxveSA9IGZhbHNlO1xuICAgICAgICAgICAgZGVsZXRlIHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgQVBJIEdhdGV3YXkuLi4gXCIpO1xuICAgICAgICAvLyBnZXQgdGhlIG1haW4gc3RhY2sgZnJvbSB0aGUgZnJhbWV3b3JrXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnN0YWNrTmFtZSwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgZ2F0ZXdheVxuICAgICAgICB0aGlzLmFwaSA9IG5ldyBSZXN0QXBpKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgLi4ucGFyYW1zQXBpLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycykge1xuICAgICAgICAgICAgY29uc3QgY29yc09yaWdpbnMgPSB0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkuYWxsb3dPcmlnaW5zPy5qb2luKCcsJyk7XG4gICAgICAgICAgICB0aGlzLmFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ2RlZmF1bHQ0eHgnLCB7XG4gICAgICAgICAgICAgICAgdHlwZTogUmVzcG9uc2VUeXBlLkRFRkFVTFRfNFhYLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlSGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYCcke2NvcnNPcmlnaW5zfSdgLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdkZWZhdWx0NXh4Jywge1xuICAgICAgICAgICAgICAgIHR5cGU6IFJlc3BvbnNlVHlwZS5ERUZBVUxUXzVYWCxcbiAgICAgICAgICAgICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGAnJHtjb3JzT3JpZ2luc30nYCxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB1cCB1c2FnZSBwbGFucyBpZiBjb25maWd1cmVkLiBVc2FnZSBwbGFucyBiaW5kIHRvIHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZTsgZm9yXG4gICAgICAgIC8vIG5lc3RlZC1jb250cm9sbGVyIGFwcHMgdGhhdCBzdGFnZSBkb2VzIG5vdCBleGlzdCB5ZXQgKGRlcGxveTpmYWxzZSksIHNvIHdlIGRlZmVyIHBsYW5cbiAgICAgICAgLy8gc2V0dXAgdW50aWwgYWZ0ZXIgdGhlIHNpbmdsZSBkZXBsb3ltZW50IGNyZWF0ZXMgdGhlIHN0YWdlIChzZWUgZmx1c2hEZWZlcnJlZFVzYWdlUGxhbnMpLlxuICAgICAgICBpZiAoIXRoaXMuaXNOZXN0ZWRDb250cm9sbGVyRGVwbG95bWVudCgpICYmIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnM/Lmxlbmd0aCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwbGFuQ29uZmlnIG9mIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNldHVwVXNhZ2VQbGFuKHBsYW5Db25maWcpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5mdzI0LmFkZEFQSSh0aGlzLm5hbWUsICdyb290JywgdGhpcy5hcGksIGZhbHNlKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCAncmVzdEFQSScsIHRoaXMuYXBpLCBPdXRwdXRUeXBlLkFQSSwgJ3Jlc3RBcGlJZCcpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsICdyZXN0QVBJJywgdGhpcy5hcGksIE91dHB1dFR5cGUuQVBJLCAncmVzdEFwaVJvb3RSZXNvdXJjZUlkJyk7XG5cbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnNraXBDb250cm9sbGVycykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5yZWdpc3RlckNvbnRyb2xsZXJzKCk7XG5cbiAgICAgICAgLy8gaWYgbXVsdGkvbmVzdGVkLXN0YWNrIHNldHVwLCB0aGVuIGNyZWF0ZSBvbmUgZGVwbG95bWVudCBwZXIgY29udHJvbGxlciBzdGFja1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBBUEktZ2F0ZXdheSBjb25zdHJ1Y3Q6ICR7dGhpcy5uYW1lfSBoYXMgaW1wb3J0ZWQgQVBJczogJHt0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKX1gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpICYmIHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVEZXBsb3ltZW50cygpO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpIHx8IHRoaXMuaXNOZXN0ZWRDb250cm9sbGVyRGVwbG95bWVudCgpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZVNpbmdsZURlcGxveW1lbnQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzYWdlIHBsYW5zIHdlcmUgZGVmZXJyZWQgZm9yIG5lc3RlZC1jb250cm9sbGVyIGFwcHMgdW50aWwgdGhlIHN0YWdlIGV4aXN0czsgZmx1c2ggbm93LlxuICAgICAgICB0aGlzLmZsdXNoRGVmZXJyZWRVc2FnZVBsYW5zKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTmVzdGVkLWNvbnRyb2xsZXIgbGF5b3V0OiBjb250cm9sbGVycyBsaXZlIGluIG5lc3RlZCBzdGFja3MgdW5kZXIgYSBzaGFyZWQgcGFyZW50LCBzbyB0aGUgQVBJXG4gICAgICogbXVzdCBwdWJsaXNoIGEgc2luZ2xlIGV4cGxpY2l0IHN0YWdlIGFmdGVyIGFsbCBuZXN0ZWQgc3RhY2tzIHJlZ2lzdGVyIChub3QgYXV0by1kZXBsb3kgZWFybHkpLlxuICAgICAqIE11dHVhbGx5IGV4Y2x1c2l2ZSB3aXRoIG11bHRpU3RhY2sgKGdldFN0YWNrIGZvcmJpZHMgcGFyZW50U3RhY2tOYW1lIHVuZGVyIG11bHRpU3RhY2spLlxuICAgICAqL1xuICAgIHByaXZhdGUgaXNOZXN0ZWRDb250cm9sbGVyRGVwbG95bWVudCgpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuICEhdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29udHJvbGxlclBhcmVudFN0YWNrTmFtZSAmJiAhdGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cCgpO1xuICAgIH1cblxuICAgIC8qKiBTZXQgdXAgdXNhZ2UgcGxhbnMgZGVmZXJyZWQgZHVyaW5nIGEgbmVzdGVkLWNvbnRyb2xsZXIgZGVwbG95bWVudCwgb25jZSB0aGUgc3RhZ2UgZXhpc3RzLiAqL1xuICAgIHByaXZhdGUgZmx1c2hEZWZlcnJlZFVzYWdlUGxhbnMoKTogdm9pZCB7XG4gICAgICAgIGlmICghdGhpcy5pc05lc3RlZENvbnRyb2xsZXJEZXBsb3ltZW50KCkpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucz8ubGVuZ3RoKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBsYW5Db25maWcgb2YgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucykge1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0dXBVc2FnZVBsYW4ocGxhbkNvbmZpZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuZGVmZXJyZWRBcGlLZXlQbGFuUmVxdWVzdGVkKSB7XG4gICAgICAgICAgICB0aGlzLnNldHVwVXNhZ2VQbGFuKHVuZGVmaW5lZCwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldEFQSSA9IChzdGFja05hbWU6IHN0cmluZyk6IElBUElSZWZlcmVuY2UgPT4ge1xuICAgICAgICBsZXQgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCAncm9vdCcpIGFzIElBUElSZWZlcmVuY2UgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gaWYgdGhlIHN0YWNrIGlzIG5vdCB0aGUgbWFpbiBzdGFjayBhbmQgaXRzIGEgbXVsdGktc3RhY2sgYXBwbGljYXRpb24gb3IgYSBuZXN0ZWQgc3RhY2ssIHRoZW4gaW1wb3J0IHRoZSBBUElcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHN0YWNrTmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXJyZW50IFN0YWNrOiAke2N1cnJlbnRTdGFjay5zdGFja05hbWV9IGlzIG5lc3RlZCBzdGFjazogJHtjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFja31gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCB0aGlzLm1haW5TdGFjaykgfHwgY3VycmVudFN0YWNrIGluc3RhbmNlb2YgTmVzdGVkU3RhY2spIHtcbiAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKSBhcyBJQVBJUmVmZXJlbmNlIHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgaWYgKCFjdXJyZW50QVBJKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0ZWRBUEkgPSBSZXN0QXBpLmZyb21SZXN0QXBpQXR0cmlidXRlcyhjdXJyZW50U3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3N0YWNrTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgICAgICAgICByZXN0QXBpSWQ6IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdyZXN0QVBJX3Jlc3RBcGlJZCcsICdhcGknLCBjdXJyZW50U3RhY2spLFxuICAgICAgICAgICAgICAgICAgICByb290UmVzb3VyY2VJZDogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ3Jlc3RBUElfcmVzdEFwaVJvb3RSZXNvdXJjZUlkJywgJ2FwaScsIGN1cnJlbnRTdGFjayksXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEFQSSh0aGlzLm5hbWUsIHN0YWNrTmFtZSwgaW1wb3J0ZWRBUEksIHRydWUpO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKSBhcyBJQVBJUmVmZXJlbmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFjdXJyZW50QVBJKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFQSSBub3QgZm91bmQgZm9yIHN0YWNrOiAke3N0YWNrTmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjdXJyZW50QVBJO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVnaXN0ZXJDb250cm9sbGVycygpIHtcbiAgICAgICAgLy8gc2V0cyB0aGUgZGVmYXVsdCBjb250cm9sbGVycyBkaXJlY3RvcnkgaWYgbm90IGRlZmluZWRcbiAgICAgICAgY29uc3QgY29udHJvbGxlcnNEaXJlY3RvcnkgPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb250cm9sbGVyc0RpcmVjdG9yeSB8fCBcIi4vc3JjL2NvbnRyb2xsZXJzXCI7XG5cbiAgICAgICAgLy8gQ29sbGVjdCBkZXNjcmlwdG9ycyBmaXJzdCBzbyB0aGUgJ2F1dG8nIHN0cmF0ZWd5IGNhbiByZXNvbHZlIHNoYXJlZC1yb290IG93bmVycyBmcm9tXG4gICAgICAgIC8vIGRlcGxveWVkIHN0YXRlIEJFRk9SRSBhbnkgY29udHJvbGxlciBpcyByZWdpc3RlcmVkIChyZWdpc3RyYXRpb24gb3JkZXIgc3RheXMgaXJyZWxldmFudCkuXG4gICAgICAgIGNvbnN0IGNvbGxlY3RlZDogQXJyYXk8eyBkZXNjcmlwdG9yOiBIYW5kbGVyRGVzY3JpcHRvcjsgb3duZXJNb2R1bGU/OiBJRncyNE1vZHVsZSB9PiA9IFtdO1xuICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhjb250cm9sbGVyc0RpcmVjdG9yeSwgKGRlc2M6IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7IGNvbGxlY3RlZC5wdXNoKHsgZGVzY3JpcHRvcjogZGVzYyB9KTsgfSk7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIG1vZHVsZXMgXCIsIEFycmF5LmZyb20obW9kdWxlcy5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkxvYWQgY29udHJvbGxlcnMgZnJvbSBtb2R1bGUgYmFzZS1wYXRoOiBcIiwgbW9kdWxlLmdldEJhc2VQYXRoKCkpO1xuICAgICAgICAgICAgICAgIEhlbHBlci5yZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZShcbiAgICAgICAgICAgICAgICAgICAgbW9kdWxlLFxuICAgICAgICAgICAgICAgICAgICAoZGVzYzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHsgY29sbGVjdGVkLnB1c2goeyBkZXNjcmlwdG9yOiBkZXNjLCBvd25lck1vZHVsZTogbW9kdWxlIH0pOyB9XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBOTyBtb2R1bGVzIFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vICdhdXRvJyBzdHJhdGVneTogZGlzY292ZXIgd2hpY2ggZGVwbG95ZWQgc3RhY2sgY3VycmVudGx5IG93bnMgZWFjaCBzaGFyZWQgcm9vdC5cbiAgICAgICAgYXdhaXQgdGhpcy5yZXNvbHZlQXV0b1NoYXJlZFJvb3RPd25lcnMoY29sbGVjdGVkLm1hcCgoYykgPT4gYy5kZXNjcmlwdG9yKSk7XG5cbiAgICAgICAgZm9yIChjb25zdCB7IGRlc2NyaXB0b3IsIG93bmVyTW9kdWxlIH0gb2YgY29sbGVjdGVkKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcihkZXNjcmlwdG9yLCBvd25lck1vZHVsZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWdpc3RlciBzeXN0ZW0gY29udHJvbGxlcnMgZnJvbSBmdzI0IHNpbmdsZXRvblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc1N5c3RlbUNvbnRyb2xsZXJzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogcmVnaXN0ZXJpbmcgc3lzdGVtIGNvbnRyb2xsZXJzXCIpO1xuXG4gICAgICAgICAgICAvLyBDb3B5IHN5c3RlbSBjb250cm9sbGVycyB0byBhcHAgZGlzdCBhbmQgcmVnaXN0ZXIgZnJvbSB0aGVyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb3B5QW5kUmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVycygpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIE5PIHN5c3RlbSBjb250cm9sbGVyc1wiKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY29weUFuZFJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcnMoKSB7XG4gICAgICAgIGNvbnN0IHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICdkaXN0JywgJ3N5c3RlbS1jb250cm9sbGVycycpO1xuXG4gICAgICAgIC8vIEVuc3VyZSB0YXJnZXQgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIpKSB7XG4gICAgICAgICAgICBta2RpclN5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzeXN0ZW1Db250cm9sbGVyIG9mIHRoaXMuZncyNC5nZXRTeXN0ZW1Db250cm9sbGVycygpKSB7XG4gICAgICAgICAgICBsZXQgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayA9ICcnO1xuICAgICAgICAgICAgLy8gRmFsbGJhY2s6IHVzZSB0aGUgbGFzdCBmZXcgZGlyZWN0b3JpZXMgdG8gcHJlc2VydmUgc3RydWN0dXJlXG4gICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRoLnNwbGl0KCcvJyk7XG4gICAgICAgICAgICBjb25zdCByZWxldmFudFBhcnRzID0gcGF0aFBhcnRzLnNsaWNlKC0zKTsgLy8gZS5nLiwgWydzZWFyY2gnLCAnc3lzdGVtJywgJ3NlYXJjaC1jb250cm9sbGVyLmpzJ11cbiAgICAgICAgICAgIHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmsgPSByZWxldmFudFBhcnRzLmpvaW4oJy8nKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU3lzdGVtIGNvbnRyb2xsZXIgcmVsYXRpdmUgcGF0aDogJHtyZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrfWApO1xuXG4gICAgICAgICAgICBjb25zdCB0YXJnZXRGaWxlUGF0aCA9IHBhdGguam9pbihzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciwgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXREaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU3lzdGVtIGNvbnRyb2xsZXIgdGFyZ2V0LWRpcmVjdG9yeTogJHt0YXJnZXREaXJlY3Rvcnl9LCB0YXJnZXRGaWxlUGF0aDogJHt0YXJnZXRGaWxlUGF0aH1gKTtcblxuICAgICAgICAgICAgLy8gRW5zdXJlIHRhcmdldCBzdWJkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0RGlyZWN0b3J5KSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDb3B5IHRoZSBzeXN0ZW0gY29udHJvbGxlciBmaWxlXG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc3lzdGVtQ29udHJvbGxlci5maWxlUGF0aCwgdGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ29waWVkIHN5c3RlbSBjb250cm9sbGVyIGZyb20gJHtzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRofSB0byAke3RhcmdldEZpbGVQYXRofWApO1xuXG4gICAgICAgICAgICAvLyBSZWdpc3RlciBmcm9tIHRoZSBjb3BpZWQgbG9jYXRpb25cbiAgICAgICAgICAgIGNvbnN0IGRpcmVjdG9yeSA9IHBhdGguZGlybmFtZSh0YXJnZXRGaWxlUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgc3lzdGVtIGNvbnRyb2xsZXI6ICR7ZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKFxuICAgICAgICAgICAgICAgIGRpcmVjdG9yeSxcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcixcbiAgICAgICAgICAgICAgICBbIGZpbGVOYW1lIF1cbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKTogc3RyaW5nW10ge1xuICAgICAgICBsZXQgZW50cnlQYWNrYWdlcyA9IGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyB8fCBbXTtcblxuICAgICAgICBpZiAoaXNBcnJheShlbnRyeVBhY2thZ2VzKSkge1xuICAgICAgICAgICAgZW50cnlQYWNrYWdlcyA9IHtcbiAgICAgICAgICAgICAgICBvdmVycmlkZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgcGFja2FnZU5hbWVzOiBlbnRyeVBhY2thZ2VzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiB0aGUgY29udHJvbGxlciBkb2VzIG5vdCB3YW50IHRvIG92ZXJyaWRlIHRoZSBhcHBsaWNhdGlvbi9tb2R1bGUgZW50cnkgcGFja2FnZXMgYW5kIGluY2x1ZGUgdGhlbSBhcyB3ZWxsXG4gICAgICAgIGlmICghZW50cnlQYWNrYWdlcy5vdmVycmlkZSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlRW50cnlQYWNrYWdlcyA9IG93bmVyTW9kdWxlPy5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCkgfHwgW107XG4gICAgICAgICAgICBjb25zdCBhcHBFbnRyeVBhY2thZ2VzID0gdGhpcy5mdzI0LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKTtcbiAgICAgICAgICAgIGVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzID0gW1xuICAgICAgICAgICAgICAgIC4uLmVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzLFxuICAgICAgICAgICAgICAgIC4uLm1vZHVsZUVudHJ5UGFja2FnZXMsXG4gICAgICAgICAgICAgICAgLi4uYXBwRW50cnlQYWNrYWdlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRyeVBhY2thZ2VzLnBhY2thZ2VOYW1lcy5tYXAodGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSk7XG4gICAgfVxuXG5cbiAgICAvLyByZWdpc3RlciBhIHNpbmdsZSBjb250cm9sbGVyXG4gICAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlckNvbnRyb2xsZXIgPSBhc3luYyAoY29udHJvbGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKSA9PiB7XG4gICAgICAgIGNvbnN0IHsgaGFuZGxlckNsYXNzLCBmaWxlUGF0aCwgZmlsZU5hbWUgfSA9IGNvbnRyb2xsZXJJbmZvO1xuICAgICAgICAvLyBBZGQgdGhlIGZvbGRlciBwYXRoIGZyb20gZmlsZW5hbWUgdG8gdGhlIGNvbnRyb2xsZXIgbmFtZVxuICAgICAgICBjb25zdCBmb2xkZXJQYXRoID0gZmlsZU5hbWUuc3BsaXQoJy8nKS5zbGljZSgwLCAtMSkuam9pbignLycpO1xuICAgICAgICBjb25zdCBoYW5kbGVySW5zdGFuY2UgPSBuZXcgaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gZmlsZU5hbWUuaW5jbHVkZXMoJy8nKSA/IGZvbGRlclBhdGggKyAnLycgKyBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWUgOiBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnID0gaGFuZGxlckluc3RhbmNlPy5jb250cm9sbGVyQ29uZmlnIHx8IHt9O1xuICAgICAgICBjb25zdCBjb250cm9sbGVyU3RhY2tOYW1lID0gY29udHJvbGxlckNvbmZpZy5zdGFja05hbWUgfHwgY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IHBhcmVudFN0YWNrTmFtZSA9IGNvbnRyb2xsZXJDb25maWcucGFyZW50U3RhY2tOYW1lIHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU7XG5cbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBjb250cm9sbGVyIHN0YWNrIGluZm8gaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuY29udHJvbGxlclN0YWNrcy5oYXMoY29udHJvbGxlclN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5zZXQoY29udHJvbGxlclN0YWNrTmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGhvZHM6IFtdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW10sXG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGNvbnRyb2xsZXIgc3RhY2sgZXhpc3RzXG4gICAgICAgIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lLCBwYXJlbnRTdGFja05hbWUpO1xuICAgICAgICBjb250cm9sbGVySW5mby5yb3V0ZXMgPSBoYW5kbGVySW5zdGFuY2Uucm91dGVzO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyBjb250cm9sbGVyICR7Y29udHJvbGxlck5hbWV9YCk7XG5cbiAgICAgICAgLy8gcHJlcGFyZSB0aGUgZW50cnkgcGFja2FnZXMgZm9yIHRoZSBjb250cm9sbGVyJ3MgbGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXMgPSB0aGlzLnByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlKTtcbiAgICAgICAgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzID0gZW50cnlQYWNrYWdlcztcblxuICAgICAgICB0aGlzLnJlc291cmNlcyA9IFtdO1xuICAgICAgICB0aGlzLm1ldGhvZHMgPSBbXTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgcmVzb3VyY2UgZm9yIHRoZSBjb250cm9sbGVyIGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZUNvbnRyb2xsZXJSZXNvdXJjZShjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgbGV0IGNvbnRyb2xsZXJUYXJnZXQgPSBjb250cm9sbGVyQ29uZmlnLnRhcmdldDtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJJbnRlZ3JhdGlvbjogTGFtYmRhSW50ZWdyYXRpb24gfCBBd3NJbnRlZ3JhdGlvbiB8IHVuZGVmaW5lZDtcbiAgICAgICAgLy8gY3JlYXRlIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIGNvbnRyb2xsZXJcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJUYXJnZXQgPT09ICdmdW5jdGlvbicgfHwgY29udHJvbGxlclRhcmdldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgPSBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubG9nUmV0ZW50aW9uRGF5cztcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSA9IGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSB8fCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5sb2dSZW1vdmFsUG9saWN5O1xuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlckxhbWJkYSA9IHRoaXMuY3JlYXRlTGFtYmRhRnVuY3Rpb24oY29udHJvbGxlck5hbWUsIGZpbGVQYXRoLCBmaWxlTmFtZSwgY29udHJvbGxlckNvbmZpZywgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyTGFtYmRhLCBPdXRwdXRUeXBlLkZVTkNUSU9OKTtcblxuICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gbmV3IExhbWJkYUludGVncmF0aW9uKGNvbnRyb2xsZXJMYW1iZGEsIHtcbiAgICAgICAgICAgICAgICByZXN0QXBpOiB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGksXG4gICAgICAgICAgICAgICAgcGF0aDogY29udHJvbGxlck5hbWUsXG4gICAgICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5pbnRlZ3JhdGlvblRpbWVvdXQgfHwgMjkpLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGRlZmF1bHRBdXRob3JpemVyTmFtZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcywgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfSA9IHRoaXMuZXh0cmFjdERlZmF1bHRBdXRob3JpemVyKGNvbnRyb2xsZXJDb25maWcpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlciBDb250cm9sbGVyIH4gRGVmYXVsdCBBdXRob3JpemVyOiBuYW1lOiAke2RlZmF1bHRBdXRob3JpemVyTmFtZX0gLSB0eXBlOiAke2RlZmF1bHRBdXRob3JpemVyVHlwZX0gLSBncm91cHM6ICR7ZGVmYXVsdEF1dGhvcml6ZXJHcm91cHN9YCk7XG5cbiAgICAgICAgLy8gU2V0IHVwIEFQSSBrZXkgaWYgcmVxdWlyZWQuIEZvciBuZXN0ZWQtY29udHJvbGxlciBhcHBzIHRoZSBkZXBsb3ltZW50IHN0YWdlIGRvZXMgbm90IGV4aXN0XG4gICAgICAgIC8vIHlldCwgc28gcmVjb3JkIHRoZSByZXF1ZXN0IGFuZCBjcmVhdGUgdGhlIHBsYW4gaW4gZmx1c2hEZWZlcnJlZFVzYWdlUGxhbnMgKHBvc3QtZGVwbG95bWVudCkuXG4gICAgICAgIGlmIChjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmlzTmVzdGVkQ29udHJvbGxlckRlcGxveW1lbnQoKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuZGVmZXJyZWRBcGlLZXlQbGFuUmVxdWVzdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXR1cFVzYWdlUGxhbih1bmRlZmluZWQsIHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHVwIHJvdXRlcyBmb3IgdGhlIGNvbnRyb2xsZXJcbiAgICAgICAgZm9yIChjb25zdCByb3V0ZSBvZiBPYmplY3QudmFsdWVzKGNvbnRyb2xsZXJJbmZvLnJvdXRlcyA/PyB7fSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyByb3V0ZSAke3JvdXRlLmh0dHBNZXRob2R9ICR7cm91dGUucGF0aH1gKTtcbiAgICAgICAgICAgIGNvbnN0IHJvdXRlVGFyZ2V0ID0gcm91dGUudGFyZ2V0IHx8IGNvbnRyb2xsZXJUYXJnZXQ7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50UmVzb3VyY2UgPSB0aGlzLmdldE9yQ3JlYXRlUm91dGVSZXNvdXJjZShjb250cm9sbGVyUmVzb3VyY2UsIHJvdXRlLnBhdGgsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgY29uc3QgeyByb3V0ZUF1dGhvcml6ZXJOYW1lLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9ID0gdGhpcy5leHRyYWN0Um91dGVBdXRob3JpemVyKHJvdXRlLCBkZWZhdWx0QXV0aG9yaXplclR5cGUsIGRlZmF1bHRBdXRob3JpemVyTmFtZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyByb3V0ZSBBdXRob3JpemVyOiAke3JvdXRlQXV0aG9yaXplck5hbWV9IC0gJHtyb3V0ZUF1dGhvcml6ZXJUeXBlfSAtICR7cm91dGVBdXRob3JpemVyR3JvdXBzfWApO1xuXG4gICAgICAgICAgICBsZXQgbWV0aG9kT3B0aW9ucyA9IHRoaXMuY3JlYXRlTWV0aG9kT3B0aW9ucyhyb3V0ZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyTmFtZSwgY29udHJvbGxlckNvbmZpZyk7XG5cbiAgICAgICAgICAgIGlmIChyb3V0ZVRhcmdldCA9PT0gJ3F1ZXVlJykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJvdXRlLnBhdGgucmVwbGFjZSgnLycsICcnKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVySW50ZWdyYXRpb24gPSB0aGlzLmNyZWF0ZVNRU0ludGVncmF0aW9uKHF1ZXVlTmFtZSwgY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLm1ldGhvZE9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAocm91dGVUYXJnZXQgPT09ICd0b3BpYycpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3BpY05hbWUgPSByb3V0ZS5wYXRoLnJlcGxhY2UoJy8nLCAnJyk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gdGhpcy5jcmVhdGVTTlNJbnRlZ3JhdGlvbih0b3BpY05hbWUsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBtZXRob2RPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi5tZXRob2RPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IG1ldGhvZCA9IGN1cnJlbnRSZXNvdXJjZS5hZGRNZXRob2Qocm91dGUuaHR0cE1ldGhvZCwgY29udHJvbGxlckludGVncmF0aW9uLCBtZXRob2RPcHRpb25zKTtcbiAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKG1ldGhvZCk7XG5cbiAgICAgICAgICAgIC8vIGlmIGF1dGhvcml6ZXIgaXMgQVdTX0lBTSwgdGhlbiBhZGQgdGhlIHJvdXRlIHRvIHRoZSBwb2xpY3lcbiAgICAgICAgICAgIGlmIChyb3V0ZUF1dGhvcml6ZXJUeXBlID09PSAnQVdTX0lBTScpIHtcbiAgICAgICAgICAgICAgICBsZXQgZnVsbFJvdXRlUGF0aCA9IGNvbnRyb2xsZXJOYW1lICsgcm91dGUucGF0aDtcblxuICAgICAgICAgICAgICAgIC8vICogcmVwbGFjZSBlYWNoIHBhcmFtIHBsYWNlaG9sZGVyIGB7aWR9YCB3aXRoIGFuIGAqYFxuICAgICAgICAgICAgICAgIHJvdXRlLnBhcmFtZXRlcnM/LmZvckVhY2gocGFyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZnVsbFJvdXRlUGF0aCA9IGZ1bGxSb3V0ZVBhdGgucmVwbGFjZShgeyR7cGFyfX1gLCAnKicpO1xuICAgICAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkUm91dGVUb1JvbGVQb2xpY3koZnVsbFJvdXRlUGF0aCwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8ga2VlcCB0cmFjayBvZiB0aGUgY29udHJvbGxlciBzdGFja3Mgd2l0aCBtZXRob2RzIGFuZCByZXNvdXJjZXMgaW4gYSBtdWx0aS1zdGFjayBzZXR1cCB0byBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2tcbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFja0luZm8gPSB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZ2V0KGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgaWYgKHN0YWNrSW5mbykge1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5tZXRob2RzID0gWyAuLi50aGlzLm1ldGhvZHMgXTtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8ucmVzb3VyY2VzID0gWyAuLi50aGlzLnJlc291cmNlcyBdO1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5jb250cm9sbGVyc0hhc2gucHVzaChjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoY29udHJvbGxlckNvbmZpZykpLmRpZ2VzdCgnaGV4JykpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gb3V0cHV0IHRoZSBhcGkgZW5kcG9pbnRcbiAgICAgICAgdGhpcy5vdXRwdXRBcGlFbmRwb2ludChjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclJlc291cmNlLCB0aGlzLmdldFN0YWdlTmFtZSgpLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldFN0YWdlTmFtZSA9ICgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaU9wdGlvbnM/LmRlcGxveU9wdGlvbnM/LnN0YWdlTmFtZSB8fCAncHJvZCc7XG4gICAgfVxuXG4gICAgLy8gaWYgdGhlIEFQSSBpcyBpbXBvcnRlZCwgdGhlbiBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2sgYW5kIGFkZCBtZXRob2QgYW5kIHJlc291cmNlIGFzIGRlcGVuZGVuY3lcbiAgICAvLyBUaGlzIGlzIG5lZWRlZCBiZWNhdXNlIGltcG9ydGVkIEFQSSBkb2VzIG5vdCBwcm9wb2dhdGUgQ09SUyBzZXR0aW5ncyB0byB0aGUgbWV0aG9kc1xuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlRGVwbG95bWVudHMoKSB7XG5cbiAgICAgICAgY29uc3Qgc3RhZ2VOYW1lID0gdGhpcy5nZXRTdGFnZU5hbWUoKTtcbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzLCBjb250cm9sbGVyc0hhc2ggfSBdIG9mIHRoaXMuY29udHJvbGxlclN0YWNrcy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIC8vIFRPRE86IGFkZCBiZXR0ZXIgbG9naWMgdG8gZm9yY2UgYSBkZXBsb3ltZW50IHdoZW4gdGhlcmUgaXMgYSBjaGFuZ2UgaW4gZnJhbWV3b3JrIGNvZGVcbiAgICAgICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyc0hhc2gucHVzaChyYW5kb21VVUlEKCkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjb250cm9sbGVySGFzaCA9IGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShKU09OLnN0cmluZ2lmeShjb250cm9sbGVyc0hhc2gpKS5kaWdlc3QoJ2hleCcpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGRlcGxveW1lbnQgZm9yIGNvbnRyb2xsZXIgc3RhY2sgJHtjb250cm9sbGVyU3RhY2tOYW1lfSB3aXRoIGhhc2ggJHtjb250cm9sbGVySGFzaH1gKTtcbiAgICAgICAgICAgIGNvbnN0IGRlcGxveW1lbnQgPSBuZXcgRGVwbG95bWVudCh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGBkZXBsb3ltZW50LSR7Y29udHJvbGxlckhhc2h9YCwge1xuICAgICAgICAgICAgICAgIGFwaTogdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSkuYXBpLFxuICAgICAgICAgICAgICAgIHN0YWdlTmFtZTogc3RhZ2VOYW1lLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgbWV0aG9kIG9mIG1ldGhvZHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIG1ldGhvZCBkZXBlbmRlbmN5ICR7bWV0aG9kLmh0dHBNZXRob2R9ICR7bWV0aG9kLnJlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShtZXRob2QpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGFkZCBkZXBlbmRlY3kgb24gYWxsIHJlc291cmNlcyBmb3IgdGhpcyBjb250cm9sbGVyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgcmVzb3VyY2UgZGVwZW5kZW5jeSAke3Jlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGlmIHRoZSBhcGkgaXMgaW1wb3J0ZWQgYW5kIGl0J3Mgbm90IGEgbXVsdGktc3RhY2sgc2V0dXAsIHRoZW4gY3JlYXRlIGEgc2luZ2xlIGRlcGxveW1lbnQgZm9yIGFsbCBjb250cm9sbGVyc1xuICAgIC8vIFNpbmdsZSBkZXBsb3ltZW50IGlzIG5lZWRlZCB0byBhdm9pZCBzaW11bHRhdGlvbiBkZXBsb3ltZW50IHdoaWNoIGNhdXNlcyBlcnJvciBvbiBBUEkgR2F0ZXdheVxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlU2luZ2xlRGVwbG95bWVudCgpIHtcbiAgICAgICAgY29uc3Qgc3RhZ2VOYW1lID0gdGhpcy5nZXRTdGFnZU5hbWUoKTtcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZvcmNlRGVwbG95bWVudCkge1xuICAgICAgICAgICAgdGhpcy5jb250cm9sbGVyU3RhY2tzLmZvckVhY2goYyA9PiBjLmNvbnRyb2xsZXJzSGFzaC5wdXNoKHJhbmRvbVVVSUQoKSkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSB0aGUgbmFtZSBmcm9tIGFsbCB0aGUgY29udHJvbGxlciBoYXNoIHZhbHVlcyBjb21iaW5lZCBhcyBhIHNpbmdsZSBoYXNoIGFuZCBhZGQgZGVwZW5kZW5jeSBvbiBhbGwgdGhlIGNvbnRyb2xsZXJzXG4gICAgICAgIGNvbnN0IGRlcGxveW1lbnROYW1lID0gYGRlcGxveW1lbnQtJHtjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoQXJyYXkuZnJvbSh0aGlzLmNvbnRyb2xsZXJTdGFja3MudmFsdWVzKCkpLm1hcChjID0+IGMuY29udHJvbGxlcnNIYXNoKS5qb2luKCctJykpLmRpZ2VzdCgnaGV4Jyl9YDtcblxuICAgICAgICBjb25zdCBuZXN0ZWRDb250cm9sbGVyRGVwbG95bWVudCA9IHRoaXMuaXNOZXN0ZWRDb250cm9sbGVyRGVwbG95bWVudCgpO1xuICAgICAgICBjb25zdCBkZXBsb3lPcHRpb25zID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpT3B0aW9ucz8uZGVwbG95T3B0aW9ucztcblxuICAgICAgICBjb25zdCBkZXBsb3ltZW50ID0gbmV3IERlcGxveW1lbnQodGhpcy5mdzI0LmdldFN0YWNrKHRoaXMubmFtZSksIGRlcGxveW1lbnROYW1lLCB7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IGRlcGxveU9wdGlvbnM/LmRlc2NyaXB0aW9uLFxuICAgICAgICAgICAgLy8gRm9yIG5lc3RlZC1jb250cm9sbGVyIGFwcHMgd2UgcHVibGlzaCB0aGUgc3RhZ2UgZXhwbGljaXRseSBiZWxvdyAoc28gaXQgY2FuIGRlcGVuZCBvblxuICAgICAgICAgICAgLy8gZXZlcnkgbmVzdGVkIHN0YWNrIGFuZCBzbyB0aGlzLmFwaS5kZXBsb3ltZW50U3RhZ2UgZ2V0cyBzZXQgZm9yIHVzYWdlIHBsYW5zKS4gRm9yIHRoZVxuICAgICAgICAgICAgLy8gaW1wb3J0ZWQtQVBJIHBhdGgsIGtlZXAgdGhlIG9yaWdpbmFsIGJlaGF2aW91ciBvZiBsZXR0aW5nIERlcGxveW1lbnQgY3JlYXRlIHRoZSBzdGFnZS5cbiAgICAgICAgICAgIC4uLihuZXN0ZWRDb250cm9sbGVyRGVwbG95bWVudCA/IHt9IDogeyBzdGFnZU5hbWUgfSksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBjb250cm9sbGVyU3RhY2tOYW1lLCB7IG1ldGhvZHMsIHJlc291cmNlcyB9IF0gb2YgdGhpcy5jb250cm9sbGVyU3RhY2tzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgLy8gVGhlIGRlcGxveW1lbnQgbXVzdCB3YWl0IGZvciBldmVyeSBuZXN0ZWQgc3RhY2sncyByZXNvdXJjZXMvbWV0aG9kcyB0byBleGlzdCwgb3RoZXJ3aXNlXG4gICAgICAgICAgICAvLyB0aGUgcHVibGlzaGVkIHN0YWdlIGNhbiBtaXNzIGxhdGUtcmVnaXN0ZXJlZCByb3V0ZXMgKHRoZSBcImRlcGxveSB0d2ljZVwiIGJ1ZykuXG4gICAgICAgICAgICBjb25zdCBjb250cm9sbGVyU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICBpZiAoY29udHJvbGxlclN0YWNrICE9PSB0aGlzLm1haW5TdGFjaykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgbmVzdGVkIHN0YWNrIGRlcGVuZGVuY3kgJHtjb250cm9sbGVyU3RhY2tOYW1lfSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3koY29udHJvbGxlclN0YWNrKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9yIChjb25zdCBtZXRob2Qgb2YgbWV0aG9kcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgbWV0aG9kIGRlcGVuZGVuY3kgJHttZXRob2QuaHR0cE1ldGhvZH0gJHttZXRob2QucmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KG1ldGhvZClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNvdXJjZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIHJlc291cmNlIGRlcGVuZGVuY3kgJHtyZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kocmVzb3VyY2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gRW5zdXJlIG1haW4tc3RhY2stb3duZWQgc2hhcmVkIHJvb3RzIGV4aXN0IGJlZm9yZSB0aGUgZGVwbG95bWVudCBwdWJsaXNoZXMgdGhlIHN0YWdlLlxuICAgICAgICAvLyAoUGlubmVkIHJvb3RzIGxpdmUgaW4gbmVzdGVkIHN0YWNrcywgYWxyZWFkeSBjb3ZlcmVkIGJ5IHRoZSBuZXN0ZWQtc3RhY2sgZGVwZW5kZW5jeSBhYm92ZS4pXG4gICAgICAgIGZvciAoY29uc3QgeyByZXNvdXJjZSwgb3duZXJTdGFjayB9IG9mIHRoaXMuc2hhcmVkQ29udHJvbGxlclJvb3RzLnZhbHVlcygpKSB7XG4gICAgICAgICAgICBpZiAob3duZXJTdGFjayA9PT0gdGhpcy5tYWluU3RhY2spIHtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmVzdGVkQ29udHJvbGxlckRlcGxveW1lbnQpIHtcbiAgICAgICAgICAgIC8vIFB1Ymxpc2ggZXhhY3RseSBvbmUgc3RhZ2UsIHdpcmVkIHRvIHRoaXMgZGVwbG95bWVudCwgYW5kIGV4cG9zZSBpdCBhcyB0aGUgQVBJJ3NcbiAgICAgICAgICAgIC8vIGRlcGxveW1lbnRTdGFnZSBzbyB1c2FnZSBwbGFucyAvIGFwaSBrZXlzIGNhbiBiaW5kIHRvIGEgcmVhbCBzdGFnZS5cbiAgICAgICAgICAgIHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZSA9IG5ldyBTdGFnZSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7c3RhZ2VOYW1lfS1zdGFnZWAsIHtcbiAgICAgICAgICAgICAgICAuLi4oZGVwbG95T3B0aW9ucyA/PyB7fSksXG4gICAgICAgICAgICAgICAgZGVwbG95bWVudCxcbiAgICAgICAgICAgICAgICBzdGFnZU5hbWUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTogQ29yc09wdGlvbnMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcbiAgICAgICAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIixcbiAgICAgICAgICAgICAgICBcIlgtQXBpLUtleVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotRGF0ZVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotQ29udGVudC1TaGEyNTZcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LVNlY3VyaXR5LVRva2VuXCIsXG4gICAgICAgICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFsc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIsXG4gICAgICAgICAgICAgICAgXCJJbXBlcnNvbmF0aW5nLVVzZXItU3ViXCIsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWxsb3dNZXRob2RzOiBbIFwiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiIF0sXG4gICAgICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxuICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiB0aGlzLmdldENvcnNPcmlnaW5zKCksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRDb3JzT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSB0cnVlKSByZXR1cm4gQ29ycy5BTExfT1JJR0lOUztcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSBcInN0cmluZ1wiKSByZXR1cm4gWyB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIF07XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIHx8IFtdO1xuICAgIH1cblxuICAgIC8qKiBSb3V0ZSArIHN0YWNrIG5hbWUgZm9yIGEgY29udHJvbGxlciBkZXNjcmlwdG9yIChtaXJyb3JzIHJlZ2lzdGVyQ29udHJvbGxlcidzIGRlcml2YXRpb24pLiAqL1xuICAgIHByaXZhdGUgZGVzY3JpYmVDb250cm9sbGVyKGRlc2NyaXB0b3I6IEhhbmRsZXJEZXNjcmlwdG9yKTogeyByb3V0ZTogc3RyaW5nOyBzdGFja05hbWU6IHN0cmluZyB9IHtcbiAgICAgICAgY29uc3QgeyBoYW5kbGVyQ2xhc3MsIGZpbGVOYW1lIH0gPSBkZXNjcmlwdG9yO1xuICAgICAgICBjb25zdCBmb2xkZXJQYXRoID0gZmlsZU5hbWUuc3BsaXQoJy8nKS5zbGljZSgwLCAtMSkuam9pbignLycpO1xuICAgICAgICBjb25zdCBoYW5kbGVySW5zdGFuY2UgPSBuZXcgaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIGNvbnN0IHJvdXRlID0gZmlsZU5hbWUuaW5jbHVkZXMoJy8nKSA/IGAke2ZvbGRlclBhdGh9LyR7aGFuZGxlckluc3RhbmNlLmNvbnRyb2xsZXJOYW1lfWAgOiBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IHN0YWNrTmFtZSA9IGhhbmRsZXJJbnN0YW5jZT8uY29udHJvbGxlckNvbmZpZz8uc3RhY2tOYW1lIHx8IHJvdXRlO1xuICAgICAgICByZXR1cm4geyByb3V0ZSwgc3RhY2tOYW1lIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogJ2F1dG8nIHN0cmF0ZWd5OiBmb3IgZWFjaCBzaGFyZWQgcm9vdCwgZGlzY292ZXIgZnJvbSBkZXBsb3llZCBDbG91ZEZvcm1hdGlvbiB3aGljaCBjb250cm9sbGVyXG4gICAgICogc3RhY2sgY3VycmVudGx5IG93bnMgaXQsIGFuZCByZWNvcmQgdGhhdCBzdGFjayBhcyB0aGUgb3duZXIuIFRoZSBvd25pbmcgY29udHJvbGxlciBpcyBtYXRjaGVkXG4gICAgICogYnkgUk9VVEUgKGEgc2VtYW50aWMgdmFsdWUgcHJlc2VudCBpbiBib3RoIHRoZSBkZXBsb3llZCB0ZW1wbGF0ZSBhbmQgdGhlIGFwcCdzIGNvbnRyb2xsZXJzKSDigJRcbiAgICAgKiBuZXZlciBieSBDbG91ZEZvcm1hdGlvbiBsb2dpY2FsIGlkICh3aGljaCBpcyBhbiB1bnJlc29sdmVkIHRva2VuIGF0IHN5bnRoKSBhbmQgd2l0aCBubyBoYXJkY29kZWRcbiAgICAgKiBzZWdtZW50IG5hbWVzLiBGYWlscyBsb3VkIHJhdGhlciB0aGFuIGd1ZXNzaW5nOyBob25vdXJzIGEgYG5lc3RlZENvbnRyb2xsZXJSb290T3duZXJzYCB2YWx1ZSBhc1xuICAgICAqIGFuIGV4cGxpY2l0IGZhbGxiYWNrIGZvciB0aGUgdW5yZXNvbHZhYmxlIGNhc2VzIChubyBjcmVkcyAvIGFtYmlndW91cyAvIHVubWF0Y2hlZCkuXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyByZXNvbHZlQXV0b1NoYXJlZFJvb3RPd25lcnMoZGVzY3JpcHRvcnM6IEhhbmRsZXJEZXNjcmlwdG9yW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLm5lc3RlZENvbnRyb2xsZXJSb290U3RyYXRlZ3kgIT09ICdhdXRvJykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgcm91dGVUb1N0YWNrTmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gICAgICAgIGNvbnN0IHJvb3RzV2l0aE5lc3RlZENvbnRyb2xsZXJzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICAgIGZvciAoY29uc3QgZGVzY3JpcHRvciBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgY29uc3QgeyByb3V0ZSwgc3RhY2tOYW1lIH0gPSB0aGlzLmRlc2NyaWJlQ29udHJvbGxlcihkZXNjcmlwdG9yKTtcbiAgICAgICAgICAgIHJvdXRlVG9TdGFja05hbWUuc2V0KHJvdXRlLCBzdGFja05hbWUpO1xuICAgICAgICAgICAgY29uc3QgcGFydHMgPSByb3V0ZS5zcGxpdCgnLycpO1xuICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICByb290c1dpdGhOZXN0ZWRDb250cm9sbGVycy5hZGQocGFydHNbIDAgXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJvb3RzV2l0aE5lc3RlZENvbnRyb2xsZXJzLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZhbGxiYWNrID0gKHJvb3RTZWdtZW50OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQgPT4gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubmVzdGVkQ29udHJvbGxlclJvb3RPd25lcnM/Llsgcm9vdFNlZ21lbnQgXTtcblxuICAgICAgICBsZXQgcmVzb2x1dGlvbnM7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBsb29rdXAgPSB0aGlzLm5lc3RlZFJvb3RMb29rdXAgPz8gY3JlYXRlQ2xvdWRGb3JtYXRpb25OZXN0ZWRSb290TG9va3VwKCk7XG4gICAgICAgICAgICByZXNvbHV0aW9ucyA9IGF3YWl0IHJlc29sdmVEZXBsb3llZE5lc3RlZFJvb3RPd25lcnModGhpcy5tYWluU3RhY2suc3RhY2tOYW1lLCBbIC4uLnJvb3RzV2l0aE5lc3RlZENvbnRyb2xsZXJzIF0sIGxvb2t1cCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgICAgICAgLy8gTm8gc2lsZW50IGd1ZXNzaW5nOiBldmVyeSByb290IGVpdGhlciByZXNvbHZlcywgaGFzIGFuIGV4cGxpY2l0IGZhbGxiYWNrLCBvciB3ZSBmYWlsIGxvdWQuXG4gICAgICAgICAgICBjb25zdCB1bnJlc29sdmVkID0gWyAuLi5yb290c1dpdGhOZXN0ZWRDb250cm9sbGVycyBdLmZpbHRlcigocm9vdCkgPT4gIWZhbGxiYWNrKHJvb3QpKTtcbiAgICAgICAgICAgIGlmICh1bnJlc29sdmVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIGBuZXN0ZWRDb250cm9sbGVyUm9vdFN0cmF0ZWd5ICdhdXRvJyBjb3VsZCBub3QgbG9vayB1cCBkZXBsb3llZCBzaGFyZWQtcm9vdCBvd25lcnMgb24gYFxuICAgICAgICAgICAgICAgICAgICArIGAke3RoaXMubWFpblN0YWNrLnN0YWNrTmFtZX0gKCR7bWVzc2FnZX0pLiBSdW4gdGhlIGJ1aWxkIHdpdGggQVdTIGNyZWRlbnRpYWxzLCBvciBzZXQgYFxuICAgICAgICAgICAgICAgICAgICArIGBuZXN0ZWRDb250cm9sbGVyUm9vdE93bmVycyBmb3I6ICR7dW5yZXNvbHZlZC5qb2luKCcsICcpfSwgb3IgdXNlIHRoZSAncGlubmVkJy8nbWFpbi1zdGFjaycgc3RyYXRlZ3kuYCxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yIChjb25zdCByb290IG9mIHJvb3RzV2l0aE5lc3RlZENvbnRyb2xsZXJzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvbHZlZEF1dG9Sb290T3duZXJzLnNldChyb290LCBmYWxsYmFjayhyb290KSEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBbIHJvb3QsIHJlc29sdXRpb24gXSBvZiByZXNvbHV0aW9ucykge1xuICAgICAgICAgICAgaWYgKHJlc29sdXRpb24ua2luZCA9PT0gJ25vdC1mb3VuZCcpIHtcbiAgICAgICAgICAgICAgICAvLyBncmVlbmZpZWxkIHJvb3Qg4oCUIG5vdGhpbmcgZGVwbG95ZWQgb3ducyBpdCB5ZXQ7IG1haW4gc3RhY2sgd2lsbCBjcmVhdGUgaXRcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXNvbHV0aW9uLmtpbmQgPT09ICdhbWJpZ3VvdXMnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcGlubmVkID0gZmFsbGJhY2socm9vdCk7XG4gICAgICAgICAgICAgICAgaWYgKHBpbm5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc29sdmVkQXV0b1Jvb3RPd25lcnMuc2V0KHJvb3QsIHBpbm5lZCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIGBuZXN0ZWRDb250cm9sbGVyUm9vdFN0cmF0ZWd5ICdhdXRvJyBmb3VuZCBtdWx0aXBsZSBkZXBsb3llZCBvd25lcnMgZm9yIC8ke3Jvb3R9IGBcbiAgICAgICAgICAgICAgICAgICAgKyBgKCR7cmVzb2x1dGlvbi5vd25lclN0YWNrTG9naWNhbElkcy5qb2luKCcsICcpfSkuIFJlc29sdmUgdGhlIGRyaWZ0IG9yIHNldCBgXG4gICAgICAgICAgICAgICAgICAgICsgYG5lc3RlZENvbnRyb2xsZXJSb290T3duZXJzLiR7cm9vdH0uYCxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gb3duZWQ6IHRoZSBvd25pbmcgY29udHJvbGxlciBpcyB0aGUgZGVwbG95ZWQgcm91dGUgdGhhdCBtYXRjaGVzIG9uZSBvZiBvdXIgY29udHJvbGxlcnNcbiAgICAgICAgICAgIGNvbnN0IG93bmVyUm91dGUgPSByZXNvbHV0aW9uLmNhbmRpZGF0ZVJvdXRlcy5maW5kKChjYW5kaWRhdGUpID0+IHJvdXRlVG9TdGFja05hbWUuaGFzKGNhbmRpZGF0ZSkpO1xuICAgICAgICAgICAgaWYgKG93bmVyUm91dGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc29sdmVkQXV0b1Jvb3RPd25lcnMuc2V0KHJvb3QsIHJvdXRlVG9TdGFja05hbWUuZ2V0KG93bmVyUm91dGUpISk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTmVzdGVkIHJvb3QgLyR7cm9vdH0gcmVzb2x2ZWQgKGF1dG8pIHRvIGV4aXN0aW5nIG93bmVyIHN0YWNrICR7cm91dGVUb1N0YWNrTmFtZS5nZXQob3duZXJSb3V0ZSl9YCk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBwaW5uZWQgPSBmYWxsYmFjayhyb290KTtcbiAgICAgICAgICAgIGlmIChwaW5uZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc29sdmVkQXV0b1Jvb3RPd25lcnMuc2V0KHJvb3QsIHBpbm5lZCk7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYG5lc3RlZENvbnRyb2xsZXJSb290U3RyYXRlZ3kgJ2F1dG8nIGZvdW5kIC8ke3Jvb3R9IGRlcGxveWVkIGJ1dCBjb3VsZCBub3QgbWF0Y2ggaXRzIG93bmVyIHRvIGEgYFxuICAgICAgICAgICAgICAgICsgYGN1cnJlbnQgY29udHJvbGxlciAoZGVwbG95ZWQgcm91dGVzIHVuZGVyIC8ke3Jvb3R9OiAke3Jlc29sdXRpb24uY2FuZGlkYXRlUm91dGVzLmpvaW4oJywgJykgfHwgJ25vbmUnfSkuIGBcbiAgICAgICAgICAgICAgICArIGBTZXQgbmVzdGVkQ29udHJvbGxlclJvb3RPd25lcnMuJHtyb290fS5gLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKiBSZXNvbHZlIHRoZSBjb250cm9sbGVyIHN0YWNrIHRoYXQgc2hvdWxkIG93biBhIHNoYXJlZCByb290LCBwZXIgdGhlIGNvbmZpZ3VyZWQgc3RyYXRlZ3kuICovXG4gICAgcHJpdmF0ZSByZXNvbHZlU2hhcmVkUm9vdE93bmVyU3RhY2tOYW1lKHJvb3RTZWdtZW50OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgICAgICBzd2l0Y2ggKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLm5lc3RlZENvbnRyb2xsZXJSb290U3RyYXRlZ3kpIHtcbiAgICAgICAgICAgIGNhc2UgJ3Bpbm5lZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLm5lc3RlZENvbnRyb2xsZXJSb290T3duZXJzPy5bIHJvb3RTZWdtZW50IF07XG4gICAgICAgICAgICBjYXNlICdhdXRvJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlZEF1dG9Sb290T3duZXJzLmdldChyb290U2VnbWVudClcbiAgICAgICAgICAgICAgICAgICAgPz8gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubmVzdGVkQ29udHJvbGxlclJvb3RPd25lcnM/Llsgcm9vdFNlZ21lbnQgXTtcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gJ21haW4tc3RhY2snXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGUgKG9uY2UpIHRoZSBzaGFyZWQgcm9vdCBzZWdtZW50IGZvciBhIG5lc3RlZCBjb250cm9sbGVyIGluIGl0cyBTVEFCTEUgb3duZXIgc3RhY2ssIGFuZFxuICAgICAqIHB1Ymxpc2ggaXRzIHJlc291cmNlLWlkIHRva2VuIHNvIHNpYmxpbmcgbmVzdGVkIHN0YWNrcyBjYW4gcmVmZXJlbmNlIGl0LiBUaGUgb3duZXIgaXMgZGVjaWRlZFxuICAgICAqIGJ5IHRoZSBjb25maWd1cmVkIHN0cmF0ZWd5IChtYWluIHN0YWNrLCBwaW5uZWQsIG9yIGF1dG8tcmVzb2x2ZWQpIOKAlCBuZXZlciBieSByZWdpc3RyYXRpb25cbiAgICAgKiBvcmRlciDigJQgc28gdGhlIHNlZ21lbnQncyBDbG91ZEZvcm1hdGlvbiBsb2dpY2FsIGlkIGlzIGlkZW50aWNhbCBvbiBldmVyeSBzeW50aC4gVGhhdCBpcyB3aGF0XG4gICAgICogcmVtb3ZlcyB0aGUgNDA5L29yZGVyaW5nIGJ1Zy5cbiAgICAgKi9cbiAgICBwcml2YXRlIGdldE9yQ3JlYXRlU2hhcmVkQ29udHJvbGxlclJvb3Qocm9vdFNlZ21lbnQ6IHN0cmluZyk6IHsgcmVzb3VyY2U6IElSZXNvdXJjZTsgb3duZXJTdGFjazogU3RhY2sgfSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5zaGFyZWRDb250cm9sbGVyUm9vdHMuZ2V0KHJvb3RTZWdtZW50KTtcbiAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgICByZXR1cm4gZXhpc3Rpbmc7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBvd25lclN0YWNrTmFtZSA9IHRoaXMucmVzb2x2ZVNoYXJlZFJvb3RPd25lclN0YWNrTmFtZShyb290U2VnbWVudCk7XG5cbiAgICAgICAgbGV0IHJlc291cmNlOiBJUmVzb3VyY2U7XG4gICAgICAgIGxldCBvd25lclN0YWNrOiBTdGFjaztcbiAgICAgICAgaWYgKG93bmVyU3RhY2tOYW1lKSB7XG4gICAgICAgICAgICAvLyBwaW5uZWQvYXV0bzogY3JlYXRlIHRoZSByb290IGluIGl0cyBleGlzdGluZyBvd25lciBzdGFjayDigJQgbW92ZXMgbm8gbGl2ZSByZXNvdXJjZVxuICAgICAgICAgICAgdGhpcy5mdzI0LmdldFN0YWNrKG93bmVyU3RhY2tOYW1lLCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb250cm9sbGVyUGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgICAgIG93bmVyU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sob3duZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgcmVzb3VyY2UgPSB0aGlzLmdldEFQSShvd25lclN0YWNrTmFtZSkuYXBpLnJvb3QuYWRkUmVzb3VyY2Uocm9vdFNlZ21lbnQpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFNoYXJlZCByb290IC8ke3Jvb3RTZWdtZW50fSBvd25lZCBieSBleGlzdGluZyBjb250cm9sbGVyIHN0YWNrICR7b3duZXJTdGFja05hbWV9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBkZWZhdWx0ICgnbWFpbi1zdGFjaycpLCBvciBhIGdyZWVuZmllbGQgcm9vdCB1bmRlciAnYXV0byc6IHRoZSBtYWluIHN0YWNrIG93bnMgaXRcbiAgICAgICAgICAgIG93bmVyU3RhY2sgPSB0aGlzLm1haW5TdGFjaztcbiAgICAgICAgICAgIHJlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZShyb290U2VnbWVudCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlbnRyeSA9IHsgcmVzb3VyY2UsIG93bmVyU3RhY2sgfTtcbiAgICAgICAgdGhpcy5zaGFyZWRDb250cm9sbGVyUm9vdHMuc2V0KHJvb3RTZWdtZW50LCBlbnRyeSk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYHJlc3RBUElfY29udHJvbGxlcl8ke3Jvb3RTZWdtZW50fWAsIHJlc291cmNlLCBPdXRwdXRUeXBlLlJFU09VUkNFLCAncmVzb3VyY2VJZCcpO1xuICAgICAgICByZXR1cm4gZW50cnk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRPckNyZWF0ZUNvbnRyb2xsZXJSZXNvdXJjZSA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBJUmVzb3VyY2UgPT4ge1xuICAgICAgICBsZXQgcmVzdEFQSSA9IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICBsZXQgY29udHJvbGxlclJlc291cmNlOiBJUmVzb3VyY2UgPSByZXN0QVBJLmFwaS5yb290O1xuICAgICAgICBjb25zdCBjdXJyZW50U3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgIGNvbnN0IHBhdGhQYXJ0cyA9IGNvbnRyb2xsZXJOYW1lLnNwbGl0KCcvJyk7XG4gICAgICAgIGZvciAoY29uc3QgcGF0aFBhcnQgb2YgcGF0aFBhcnRzKSB7XG4gICAgICAgICAgICBsZXQgY2hpbGRSZXNvdXJjZSA9IGNvbnRyb2xsZXJSZXNvdXJjZS5nZXRSZXNvdXJjZShwYXRoUGFydCkgYXMgSVJlc291cmNlO1xuICAgICAgICAgICAgLy8gVGhlIGZpcnN0IHBhdGggcGFydCBvZiBhIG5lc3RlZCBjb250cm9sbGVyIChlLmcuIGBpbnRlcm5hbGAgaW4gYGludGVybmFsL25vdGlmaWNhdGlvbnNgKVxuICAgICAgICAgICAgLy8gaXMgYSBTSEFSRUQgcm9vdCBvd25lZCBieSB0aGUgbWFpbiBzdGFjay4gUmVzb2x2ZSBpdCBmcm9tIHRoZXJlIGluc3RlYWQgb2YgbGV0dGluZ1xuICAgICAgICAgICAgLy8gd2hpY2hldmVyIGNvbnRyb2xsZXIgcmVnaXN0ZXJzIGZpcnN0IGNyZWF0ZSBpdCDigJQgdGhpcyBpcyB3aGF0IHJlbW92ZXMgdGhlIDQwOS9vcmRlcmluZyBidWcuXG4gICAgICAgICAgICBjb25zdCBpc05lc3RlZENvbnRyb2xsZXIgPSBwYXRoUGFydHMubGVuZ3RoID4gMTtcbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSAmJiBpc05lc3RlZENvbnRyb2xsZXIgJiYgcGF0aFBhcnQgPT09IHBhdGhQYXJ0c1sgMCBdKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc2hhcmVkUm9vdCA9IHRoaXMuZ2V0T3JDcmVhdGVTaGFyZWRDb250cm9sbGVyUm9vdChwYXRoUGFydCk7XG4gICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRTdGFjayA9PT0gc2hhcmVkUm9vdC5vd25lclN0YWNrKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHNhbWUgc3RhY2sgYXMgdGhlIG93bmVyIChzaW5nbGUtc3RhY2sgYXBwLCBvciB0aGlzIGNvbnRyb2xsZXIgSVMgdGhlIG93bmVyKSDigJQgdXNlIGl0IGRpcmVjdGx5XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkUmVzb3VyY2UgPSBzaGFyZWRSb290LnJlc291cmNlO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHJlZmVyZW5jZSB0aGUgb3duZXIgc3RhY2sncyByb290IGJ5IGl0cyByZXNvdXJjZS1pZCB0b2tlbjsgQ0RLIHdpcmVzIGl0IGFjcm9zcyBzdGFja3NcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZmVyZW5jaW5nIHNoYXJlZCByb290IC8ke3BhdGhQYXJ0fSAob3duZXIgJHtzaGFyZWRSb290Lm93bmVyU3RhY2suc3RhY2tOYW1lfSkgZnJvbSAke2NvbnRyb2xsZXJTdGFja05hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkUmVzb3VyY2UgPSBSZXNvdXJjZS5mcm9tUmVzb3VyY2VBdHRyaWJ1dGVzKGN1cnJlbnRTdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7Y29udHJvbGxlclN0YWNrTmFtZX0tJHtwYXRoUGFydH1gLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZUlkOiBzaGFyZWRSb290LnJlc291cmNlLnJlc291cmNlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN0QXBpOiByZXN0QVBJLmFwaSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6ICcvJyArIHBhdGhQYXJ0XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSkge1xuICAgICAgICAgICAgICAgIC8vIGZvciBuZXN0ZWQgcmVzb3VyY2VzIGFkZCAvIHRvIHRoZSBwYXRoXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGNvbnRyb2xsZXIgcmVzb3VyY2UgZm9yIHBhdGggJHtwYXRoUGFydH0gdW5kZXIgJHtjb250cm9sbGVyUmVzb3VyY2UucGF0aH1gKTtcbiAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gY29udHJvbGxlclJlc291cmNlLmFkZFJlc291cmNlKHBhdGhQYXJ0KSBhcyBJUmVzb3VyY2U7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRyb2xsZXJSZXNvdXJjZSA9IGNoaWxkUmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY29udHJvbGxlclJlc291cmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlTGFtYmRhRnVuY3Rpb24gPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZywgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IE5vZGVqc0Z1bmN0aW9uID0+IHtcbiAgICAgICAgY29uc3QgZnVuY3Rpb25Qcm9wcyA9IG1lcmdlKFtcbiAgICAgICAgICAgIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMgPz8ge30sXG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnPy5mdW5jdGlvblByb3BzID8/IHt9XG4gICAgICAgIF0pITtcblxuICAgICAgICBjb25zdCBlbnZWYXJpYWJsZXMgPSB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyhjb250cm9sbGVyQ29uZmlnLmVudiwgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKTtcblxuICAgICAgICAvLyBkbyBub3Qgb3ZlcnJpZGUgdGhlIGVudHJ5IHBhY2thZ2VzIGlmIGFscmVhZHkgc2V0XG4gICAgICAgIGlmICghKEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTIGluIGVudlZhcmlhYmxlcykgJiYgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzKSB7XG4gICAgICAgICAgICBlbnZWYXJpYWJsZXNbIEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTIF0gPSAoY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzIGFzIEFycmF5PHN0cmluZz4pLmpvaW4oJywnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBjb250cm9sbGVyTmFtZSArIFwiLWNvbnRyb2xsZXJcIiwge1xuICAgICAgICAgICAgZW50cnk6IGZpbGVQYXRoICsgXCIvXCIgKyBmaWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiBlbnZWYXJpYWJsZXMsXG4gICAgICAgICAgICBwb2xpY2llczogY29udHJvbGxlckNvbmZpZz8ucG9saWNpZXMsXG4gICAgICAgICAgICByZXNvdXJjZUFjY2VzczogY29udHJvbGxlckNvbmZpZz8ucmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICBhbGxvd1NlbmRFbWFpbDogdHJ1ZSxcbiAgICAgICAgICAgIGZ1bmN0aW9uVGltZW91dDogY29udHJvbGxlckNvbmZpZz8uZnVuY3Rpb25UaW1lb3V0IHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblRpbWVvdXQsXG4gICAgICAgICAgICBwcm9jZXNzb3JBcmNoaXRlY3R1cmU6IGNvbnRyb2xsZXJDb25maWc/LnByb2Nlc3NvckFyY2hpdGVjdHVyZSxcbiAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IGZ1bmN0aW9uUHJvcHMsXG4gICAgICAgICAgICBsb2dSZXRlbnRpb25EYXlzOiBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiBjb250cm9sbGVyQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFjdERlZmF1bHRBdXRob3JpemVyID0gKGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnV2l0aEF1dGhvcml6ZXIpOiB7IGRlZmF1bHRBdXRob3JpemVyTmFtZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplclR5cGU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IHRoaXMuZncyNC5nZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKCk7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgbGV0IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29udHJvbGxlckNvbmZpZz8uYXV0aG9yaXplcikpIHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRBdXRob3JpemVyID0gKGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplciBhcyBJQXV0aG9yaXplckNvbmZpZ1tdKS5maW5kKChhdXRoKSA9PiBhdXRoLmRlZmF1bHQpIHx8IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplclsgMCBdO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJOYW1lID0gZGVmYXVsdEF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBkZWZhdWx0QXV0aG9yaXplci50eXBlO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplci5ncm91cHMgfHwgW107XG4gICAgICAgICAgICBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGRlZmF1bHRBdXRob3JpemVyLnJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfHwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplci5uYW1lIHx8IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplci50eXBlO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIuZ3JvdXBzIHx8IFtdO1xuICAgICAgICAgICAgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfHwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXI7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWRlZmF1bHRBdXRob3JpemVyVHlwZSAmJiB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlKSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSB7XG5cbiAgICAgICAgICAgIC8vIGlmIHRoZSB2YWx1ZSBmb3IgdGhlIGdyb3VwcyBpcyBhIHRlbXBsYXRlIHN0cmluZywgXG4gICAgICAgICAgICAvLyByZXNvbHZlIGl0IFt3aGVuIHRoZSBhcHBsaWNhdGlvbiB3YW50IHRvIGFsbG93IG11bHRpcGxlIHVzZXIgZ3JvdXBzIHRvIGhhdmUgYWNjZXNzXVxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgdmFsdWUgaXMgbGlrZSBcImVudjp4eHg6Z3JvdXAxXCIgPT0+IFwiZ3JvdXAxLXJlc29sdmVkXCIgfHwgXCJncm91cDEsZ3JvdXAyXCIgfHwgXCJlbnY6eHh4Omdyb3VwMSxlbnY6eHh4Omdyb3VwMlwiXG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpKSB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSB0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gbm93IGlmIHRoZSByZXNvbHZlZCB2YWx1ZSBpcyBhZ2FpbiBhIHN0cmluZywgc3BsaXQgaXQgYnkgY29tbWFcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgXCJncm91cDEsZ3JvdXAyXCIgPT0+IFtcImdyb3VwMVwiLCBcImdyb3VwMlwiXVxuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSkge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMuc3BsaXQoJywnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFkZWZhdWx0QXV0aG9yaXplckdyb3Vwcy5sZW5ndGggJiYgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBZG1pbkdyb3Vwcykge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBZG1pbkdyb3VwcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gcmVzb2x2ZSB0aGUgZ3JvdXAgbmFtZXMgZnJvbSBmdzI0LXNjb3BlIGlmIGl0J3MgYSB0ZW1wbGF0ZVxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgdmFsdWUgaXMgbGlrZSBbXCJlbnY6eHh4Omdyb3VwMVwiLFwiZW52Onh4eDpncm91cDJcIl0gPT0+IFtcImdyb3VwMS1yZXNvbHZlZFwiLCBcImdyb3VwMi1yZXNvbHZlZFwiXVxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSAoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgYXMgQXJyYXk8c3RyaW5nPikubWFwKHRoaXMuZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUpO1xuXG4gICAgICAgICAgICAvLyBmbGF0LW1hcCB0aGUgZ3JvdXBzIGlmIHRoZXkgcmVzb2x2ZWQgZ3JvdXAgdmFsdWVzIGFyZSBhZ2FpbiBjb21tYSBzZXBhcmF0ZWRcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHJlc29sdmVkIHZhbHVlIGlzIGxpa2UgW1wiYSxiXCIsIFwiYyxkXCJdID09PiBbXCJhXCIsIFwiYlwiLCBcImNcIiwgXCJkXCJdXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLmZsYXRNYXAoZ3JvdXAgPT4gZ3JvdXAuc3BsaXQoJywnKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBFbnN1cmUgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgaXMgYWx3YXlzIGFuIGFycmF5XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRHcm91cHM6IHN0cmluZ1tdID0gIWRlZmF1bHRBdXRob3JpemVyR3JvdXBzIFxuICAgICAgICAgICAgPyBbXSBcbiAgICAgICAgICAgIDogQXJyYXkuaXNBcnJheShkZWZhdWx0QXV0aG9yaXplckdyb3VwcykgXG4gICAgICAgICAgICAgICAgPyBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyBcbiAgICAgICAgICAgICAgICA6IFtkZWZhdWx0QXV0aG9yaXplckdyb3Vwc107XG5cbiAgICAgICAgcmV0dXJuIHsgXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUsIFxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzOiBub3JtYWxpemVkR3JvdXBzLCBcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0T3JDcmVhdGVSb3V0ZVJlc291cmNlID0gKHBhcmVudFJlc291cmNlOiBJUmVzb3VyY2UsIHBhdGg6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogSVJlc291cmNlID0+IHtcbiAgICAgICAgbGV0IGN1cnJlbnRSZXNvdXJjZTogSVJlc291cmNlID0gcGFyZW50UmVzb3VyY2U7XG4gICAgICAgIGNvbnN0IHJlc3RBUEkgPSB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhdGhQYXJ0IG9mIHBhdGguc3BsaXQoXCIvXCIpKSB7XG4gICAgICAgICAgICBpZiAocGF0aFBhcnQgPT09IFwiXCIpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IGNoaWxkUmVzb3VyY2UgPSBjdXJyZW50UmVzb3VyY2UuZ2V0UmVzb3VyY2UocGF0aFBhcnQpO1xuICAgICAgICAgICAgaWYgKCFjaGlsZFJlc291cmNlKSB7XG4gICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IGN1cnJlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZShwYXRoUGFydCk7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlcy5wdXNoKGNoaWxkUmVzb3VyY2UpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN1cnJlbnRSZXNvdXJjZSA9IGNoaWxkUmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3VycmVudFJlc291cmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFjdFJvdXRlQXV0aG9yaXplciA9IChyb3V0ZTogSVJvdXRlV2l0aEF1dGhvcml6ZXIsIGRlZmF1bHRBdXRob3JpemVyVHlwZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbik6IHsgcm91dGVBdXRob3JpemVyTmFtZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplck5hbWUgPSBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcblxuICAgICAgICBpZiAocm91dGUuYXV0aG9yaXplciAmJiB0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyLnR5cGUgfHwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyTmFtZSA9IHJvdXRlLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBjb25zdCByb3V0ZUdyb3VwcyA9IHJvdXRlLmF1dGhvcml6ZXIuZ3JvdXBzIHx8IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyR3JvdXBzID0gIXJvdXRlR3JvdXBzIFxuICAgICAgICAgICAgICAgID8gW10gXG4gICAgICAgICAgICAgICAgOiBBcnJheS5pc0FycmF5KHJvdXRlR3JvdXBzKSBcbiAgICAgICAgICAgICAgICAgICAgPyByb3V0ZUdyb3VwcyBcbiAgICAgICAgICAgICAgICAgICAgOiBbcm91dGVHcm91cHNdO1xuICAgICAgICAgICAgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gcm91dGUuYXV0aG9yaXplci5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiByb3V0ZS5hdXRob3JpemVyID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyVHlwZSA9IHJvdXRlLmF1dGhvcml6ZXI7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyByb3V0ZUF1dGhvcml6ZXJOYW1lLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlTWV0aG9kT3B0aW9ucyA9IChyb3V0ZTogSVJvdXRlV2l0aEF1dGhvcml6ZXIsIHJvdXRlQXV0aG9yaXplclR5cGU6IHN0cmluZywgcm91dGVBdXRob3JpemVyTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkLCBjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZyk6IE1ldGhvZE9wdGlvbnMgPT4ge1xuICAgICAgICBjb25zdCByZXF1ZXN0UGFyYW1ldGVyczogeyBbIGtleTogc3RyaW5nIF06IGJvb2xlYW4gfSA9IHt9O1xuXG4gICAgICAgIC8vIEFkZCBwYXRoIHBhcmFtZXRlcnNcbiAgICAgICAgZm9yIChjb25zdCBwYXJhbSBvZiByb3V0ZS5wYXJhbWV0ZXJzIHx8IFtdKSB7XG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyc1sgYG1ldGhvZC5yZXF1ZXN0LnBhdGguJHtwYXJhbX1gIF0gPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIEFQSSBrZXkgaGVhZGVyIHJlcXVpcmVtZW50IGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29udHJvbGxlckNvbmZpZy5yZXF1aXJlQXBpS2V5KSB7XG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyc1sgJ21ldGhvZC5yZXF1ZXN0LmhlYWRlci54LWFwaS1rZXknIF0gPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgdGhlIGF1dGhvcml6ZXIgaXMgSldULCBjb252ZXJ0IGl0IHRvIENVU1RPTVxuICAgICAgICBjb25zdCBhdXRob3JpemVyID0gdGhpcy5mdzI0LmdldEF1dGhvcml6ZXIocm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyTmFtZSk7XG4gICAgICAgIGlmIChyb3V0ZUF1dGhvcml6ZXJUeXBlID09PSAnSldUJykge1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyVHlwZSA9ICdDVVNUT00nO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzLFxuICAgICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IHJvdXRlQXV0aG9yaXplclR5cGUgYXMgQXV0aG9yaXphdGlvblR5cGUsXG4gICAgICAgICAgICBhdXRob3JpemVyOiBhdXRob3JpemVyLFxuICAgICAgICAgICAgYXBpS2V5UmVxdWlyZWQ6IGNvbnRyb2xsZXJDb25maWcucmVxdWlyZUFwaUtleSB8fCBmYWxzZVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlU1FTSW50ZWdyYXRpb24gPSAocXVldWVOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IEF3c0ludGVncmF0aW9uID0+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIFNRUyBpbnRlZ3JhdGlvbiBmb3IgcXVldWUgJHtxdWV1ZU5hbWV9IGluIGNvbnRyb2xsZXIgJHtjb250cm9sbGVyTmFtZX0gaW4gc3RhY2sgJHtjb250cm9sbGVyU3RhY2tOYW1lfWApO1xuICAgICAgICBjb25zdCBpbnRlZ3JhdGlvblJvbGUgPSBuZXcgUm9sZSh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3F1ZXVlTmFtZX0tc3FzLWludGVncmF0aW9uLXJvbGVgLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwiYXBpZ2F0ZXdheS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcXVldWVBcm4gPSB0aGlzLmZ3MjQuZ2V0QXJuKCdzcXMnLCB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShxdWV1ZU5hbWUgKyAnX3F1ZXVlTmFtZScsICdxdWV1ZScsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSkpO1xuICAgICAgICBjb25zdCBxdWV1ZUluc3RhbmNlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7cXVldWVOYW1lfS1xdWV1ZWAsIHF1ZXVlQXJuKTtcbiAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFNlbmRNZXNzYWdlcyhpbnRlZ3JhdGlvblJvbGUpO1xuICAgICAgICByZXR1cm4gbmV3IEF3c0ludGVncmF0aW9uKHtcbiAgICAgICAgICAgIHNlcnZpY2U6IFwic3FzXCIsXG4gICAgICAgICAgICBwYXRoOiB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudCArIFwiL1wiICsgcXVldWVJbnN0YW5jZS5xdWV1ZU5hbWUsXG4gICAgICAgICAgICBpbnRlZ3JhdGlvbkh0dHBNZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNyZWRlbnRpYWxzUm9sZTogaW50ZWdyYXRpb25Sb2xlLFxuICAgICAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiaW50ZWdyYXRpb24ucmVxdWVzdC5oZWFkZXIuQ29udGVudC1UeXBlXCI6IFwiJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCdcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJhcHBsaWNhdGlvbi9qc29uXCI6IGBBY3Rpb249U2VuZE1lc3NhZ2UmTWVzc2FnZUJvZHk9JHV0aWwudXJsRW5jb2RlKCRpbnB1dC5ib2R5KWAsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZVNOU0ludGVncmF0aW9uID0gKHRvcGljTmFtZTogc3RyaW5nLCBjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBBd3NJbnRlZ3JhdGlvbiA9PiB7XG4gICAgICAgIGNvbnN0IGludGVncmF0aW9uUm9sZSA9IG5ldyBSb2xlKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7dG9waWNOYW1lfS1zbnMtaW50ZWdyYXRpb24tcm9sZWAsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0b3BpY0FybiA9IHRoaXMuZncyNC5nZXRBcm4oJ3NucycsIHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSArICdfdG9waWNOYW1lJywgJ3RvcGljJywgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKSk7XG4gICAgICAgIGNvbnN0IHRvcGljSW5zdGFuY2UgPSBUb3BpYy5mcm9tVG9waWNBcm4odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHt0b3BpY05hbWV9LXRvcGljYCwgdG9waWNBcm4pO1xuICAgICAgICB0b3BpY0luc3RhbmNlLmdyYW50UHVibGlzaChpbnRlZ3JhdGlvblJvbGUpO1xuICAgICAgICByZXR1cm4gbmV3IEF3c0ludGVncmF0aW9uKHtcbiAgICAgICAgICAgIHNlcnZpY2U6IFwic25zXCIsXG4gICAgICAgICAgICBwYXRoOiAnLycsXG4gICAgICAgICAgICBpbnRlZ3JhdGlvbkh0dHBNZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNyZWRlbnRpYWxzUm9sZTogaW50ZWdyYXRpb25Sb2xlLFxuICAgICAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiaW50ZWdyYXRpb24ucmVxdWVzdC5oZWFkZXIuQ29udGVudC1UeXBlXCI6IFwiJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCdcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJhcHBsaWNhdGlvbi9qc29uXCI6IGBBY3Rpb249UHVibGlzaCZUb3BpY0Fybj0kdXRpbC51cmxFbmNvZGUoJyR7dG9waWNJbnN0YW5jZS50b3BpY0Fybn0nKSZNZXNzYWdlPSR1dGlsLnVybEVuY29kZSgkaW5wdXQuYm9keSlgLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRBcGlFbmRwb2ludCA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyUmVzb3VyY2U6IElSZXNvdXJjZSwgc3RhZ2VOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZykgPT4ge1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYEVuZHBvaW50JHtjb250cm9sbGVyTmFtZX1gLCB7XG4gICAgICAgICAgICB2YWx1ZTogJ2h0dHBzOi8vJyArIHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaS5yZXN0QXBpSWQgKyAnLmV4ZWN1dGUtYXBpLicgKyB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkucmVnaW9uICsgJy5hbWF6b25hd3MuY29tLycgKyBzdGFnZU5hbWUgKyAnLycgKyBjb250cm9sbGVyUmVzb3VyY2UucGF0aC5zbGljZSgxKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBHYXRld2F5IEVuZHBvaW50IGZvciBcIiArIGNvbnRyb2xsZXJOYW1lLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNldHVwVXNhZ2VQbGFuKHBsYW5Db25maWc/OiBJVXNhZ2VQbGFuQ29uZmlnLCBjcmVhdGVLZXk6IGJvb2xlYW4gPSBmYWxzZSk6IHsgcGxhbjogVXNhZ2VQbGFuOyBuYW1lOiBzdHJpbmcgfSB7XG4gICAgICAgIC8vIElmIG5vIHBsYW4gY29uZmlnIGlzIHByb3ZpZGVkIGFuZCB3ZSBuZWVkIGEga2V5LCB1c2UgdGhlIGZpcnN0IGNvbmZpZ3VyZWQgcGxhbiBvciBjcmVhdGUgYSBkZWZhdWx0IG9uZVxuICAgICAgICBpZiAoIXBsYW5Db25maWcgJiYgY3JlYXRlS2V5KSB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gdXNlIHRoZSBmaXJzdCBjb25maWd1cmVkIHBsYW4gdGhhdCBoYXMgQVBJIGtleXNcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZ3VyZWRQbGFuID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucz8uZmluZChwbGFuID0+IHBsYW4uYXBpS2V5cyk7XG4gICAgICAgICAgICBpZiAoY29uZmlndXJlZFBsYW4pIHtcbiAgICAgICAgICAgICAgICBwbGFuQ29uZmlnID0gY29uZmlndXJlZFBsYW47XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIElmIG5vIGNvbmZpZ3VyZWQgcGxhbiB3aXRoIGtleXMgZXhpc3RzLCBjcmVhdGUgYSBkZWZhdWx0IHBsYW5cbiAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBhIGRldGVybWluaXN0aWMga2V5IGJhc2VkIG9uIGFwcCBuYW1lIGFuZCBhIGZpeGVkIGlkZW50aWZpZXJcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0S2V5ID0gY3JlYXRlSGFzaCgnc2hhMjU2JylcbiAgICAgICAgICAgICAgICAgICAgLnVwZGF0ZShgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudH0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkucmVnaW9ufS0ke3RoaXMuZncyNC5nZXRDb25maWcoKS5lbnZpcm9ubWVudH0tZGVmYXVsdC1hcGkta2V5YClcbiAgICAgICAgICAgICAgICAgICAgLmRpZ2VzdCgnaGV4JylcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDMyKTsgLy8gVXNlIGZpcnN0IDMyIGNoYXJzIGZvciBhIHJlYXNvbmFibGUga2V5IGxlbmd0aFxuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gdXNhZ2UgcGxhbiB3aXRoIEFQSSBrZXlzIGZvdW5kLCBjcmVhdGluZyBhIGRlZmF1bHQgb25lLiBUaGlzIGlzIG5vdCByZWNvbW1lbmRlZCBmb3IgcHJvZHVjdGlvbiBlbnZpcm9ubWVudHMuIFBsZWFzZSBjb25maWd1cmUgYSB1c2FnZSBwbGFuIHdpdGggQVBJIGtleXMgZm9yIHlvdXIgQVBJLmApO1xuXG4gICAgICAgICAgICAgICAgcGxhbkNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWRlZmF1bHQtdXNhZ2UtcGxhbmAsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgRGVmYXVsdCB1c2FnZSBwbGFuIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleXM6IFsgZGVmYXVsdEtleSBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGxhbk5hbWUgPSBwbGFuQ29uZmlnPy5uYW1lIHx8IGAke3RoaXMuZncyNC5hcHBOYW1lfS1kZWZhdWx0LXVzYWdlLXBsYW5gO1xuXG4gICAgICAgIGlmICghdGhpcy51c2FnZVBsYW5zLmhhcyhwbGFuTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFNldHRpbmcgdXAgdXNhZ2UgcGxhbjogJHtwbGFuTmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0IHVzYWdlUGxhbiA9IG5ldyBVc2FnZVBsYW4odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3BsYW5OYW1lfS11c2FnZS1wbGFuYCwge1xuICAgICAgICAgICAgICAgIG5hbWU6IHBsYW5OYW1lLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBwbGFuQ29uZmlnPy5kZXNjcmlwdGlvbiB8fCBgVXNhZ2UgcGxhbiBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgIGFwaVN0YWdlczogWyB7XG4gICAgICAgICAgICAgICAgICAgIGFwaTogdGhpcy5hcGksXG4gICAgICAgICAgICAgICAgICAgIHN0YWdlOiB0aGlzLmFwaS5kZXBsb3ltZW50U3RhZ2VcbiAgICAgICAgICAgICAgICB9IF0sXG4gICAgICAgICAgICAgICAgdGhyb3R0bGU6IHtcbiAgICAgICAgICAgICAgICAgICAgcmF0ZUxpbWl0OiBwbGFuQ29uZmlnPy5yYXRlTGltaXQgfHwgMTAsXG4gICAgICAgICAgICAgICAgICAgIGJ1cnN0TGltaXQ6IHBsYW5Db25maWc/LmJ1cnN0TGltaXQgfHwgMjBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHF1b3RhOiB7XG4gICAgICAgICAgICAgICAgICAgIGxpbWl0OiBwbGFuQ29uZmlnPy5xdW90YUxpbWl0IHx8IDEwMDAwLFxuICAgICAgICAgICAgICAgICAgICBwZXJpb2Q6IHBsYW5Db25maWc/LnF1b3RhUGVyaW9kIHx8IFBlcmlvZC5NT05USFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy51c2FnZVBsYW5zLnNldChwbGFuTmFtZSwgeyBwbGFuOiB1c2FnZVBsYW4sIG5hbWU6IHBsYW5OYW1lIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGlLZXlzLnNldChwbGFuTmFtZSwgW10pO1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgQVBJIGtleXMgaWYgY29uZmlndXJlZCBmb3IgdGhpcyB1c2FnZSBwbGFuXG4gICAgICAgICAgICBpZiAocGxhbkNvbmZpZz8uYXBpS2V5cykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENyZWF0aW5nIEFQSSBrZXlzIGZvciB1c2FnZSBwbGFuOiAke3BsYW5OYW1lfWApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGtleXMgPSBwbGFuQ29uZmlnLmFwaUtleXMua2V5cyB8fCBbXTtcbiAgICAgICAgICAgICAgICBrZXlzLmZvckVhY2goKGtleSwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBrZXkgbmFtZSBmcm9tIGNvbmZpZyBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSB1c2UgdGhlIHByZWZpeCBvciBnZW5lcmF0ZSBhIG5hbWVcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5TmFtZSA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaUtleUNvbmZpZz8ua2V5TmFtZSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgKHBsYW5Db25maWcuYXBpS2V5cz8ua2V5TmFtZVByZWZpeFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYCR7cGxhbkNvbmZpZy5hcGlLZXlzLmtleU5hbWVQcmVmaXh9LSR7aW5kZXh9YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWFwaS1rZXktJHtpbmRleH1gKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBrZXkgYWxyZWFkeSBleGlzdHNcbiAgICAgICAgICAgICAgICAgICAgbGV0IGV4aXN0aW5nS2V5ID0gdGhpcy5rZXlWYWx1ZXMuZ2V0KGtleSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RpbmdLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nS2V5ID0gbmV3IEFwaUtleSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0tYXBpLWtleWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIGtleSAke2luZGV4ICsgMX0gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZToga2V5XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0taWRgLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGV4aXN0aW5nS2V5LmtleUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIEtleSAke2luZGV4ICsgMX0gSUQgZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMua2V5VmFsdWVzLnNldChrZXksIGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHVzYWdlUGxhbi5hZGRBcGlLZXkoZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhcGlLZXlzTGlzdCA9IHRoaXMuYXBpS2V5cy5nZXQocGxhbk5hbWUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXBpS2V5c0xpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwaUtleXNMaXN0LnB1c2goZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1c2FnZVBsYW4gPSB0aGlzLnVzYWdlUGxhbnMuZ2V0KHBsYW5OYW1lKTtcbiAgICAgICAgaWYgKCF1c2FnZVBsYW4pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVXNhZ2UgcGxhbiAke3BsYW5OYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXNhZ2VQbGFuO1xuICAgIH1cblxufVxuIl19