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
const fw24_1 = require("../core/fw24");
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const lambda_function_1 = require("./lambda-function");
const lambda_integration_1 = require("./lambda-integration");
const fw24_2 = require("../fw24");
const utils_1 = require("../utils");
const auth_1 = require("./auth");
const certificate_1 = require("./certificate");
const dynamodb_1 = require("./dynamodb");
const layer_1 = require("./layer");
const mailer_1 = require("./mailer");
const queue_1 = require("./queue");
const topic_1 = require("./topic");
const crypto_1 = require("crypto");
const vpc_1 = require("./vpc");
const aws_apigateway_2 = require("aws-cdk-lib/aws-apigateway");
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
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
        // Set up usage plans if configured
        if (this.apiConstructConfig.usagePlans?.length) {
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
        else if (this.fw24.hasImportedAPI(this.name)) {
            await this.createSingleDeployment();
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
        return currentAPI;
    };
    async registerControllers() {
        // Check if manifest exists and use it instead of scanning
        const manifestPath = path_1.default.join(process.cwd(), '.fw24', 'out', 'manifest.json');
        if ((0, fs_1.existsSync)(manifestPath)) {
            this.logger.info("Using manifest-based controller registration");
            await this.registerControllersFromManifest(manifestPath);
        }
        else {
            this.logger.info("Manifest not found, falling back to directory scanning");
            // sets the default controllers directory if not defined
            const controllersDirectory = this.apiConstructConfig.controllersDirectory || "./src/controllers";
            // register the controllers
            await helper_1.Helper.registerHandlers(controllersDirectory, this.registerController);
        }
        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("API-gateway stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                this.logger.debug("Load controllers from module base-path: ", basePath);
                helper_1.Helper.registerControllersFromModule(module, (desc) => this.registerController(desc, module));
            }
        }
        else {
            this.logger.debug("API-gateway stack: construct: app has NO modules ");
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
    async registerControllersFromManifest(manifestPath) {
        this.logger.info("Loading manifest from:", manifestPath);
        const manifestContent = (0, fs_1.readFileSync)(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        // Register API deployment units (which contain grouped controllers)
        const apiDUs = manifest.deploymentUnits.filter(du => du.kind === 'api');
        for (const du of apiDUs) {
            this.logger.info(`Registering API DU: ${du.name}`);
            // Use the generated bootstrap file instead of individual controllers
            const bootstrapPath = `.fw24/.generated/du-${du.name}.bootstrap.ts`;
            const handlerDescriptor = {
                handlerClass: null,
                fileName: `du-${du.name}.bootstrap.ts`,
                filePath: path_1.default.resolve('.fw24/.generated'),
                handlerHash: `du-${du.name}`,
                deploymentUnit: du,
                manifestCapabilities: manifest.capabilities.filter(cap => cap.kind === 'controller' && this.isCapabilityInDU(cap, du, manifest))
            };
            this.registerController(handlerDescriptor);
        }
    }
    isCapabilityInDU(capability, du, _manifest) {
        // For now, simple logic - all controllers go to 'api' DU
        // TODO: Implement proper DU matching logic based on du.include/exclude
        return du.name === 'api' && capability.kind === 'controller';
    }
    async copyAndRegisterSystemControllers() {
        const systemControllersTargetDir = path_1.default.join(process.cwd(), 'dist', 'system-controllers');
        // Ensure target directory exists
        if (!(0, fs_1.existsSync)(systemControllersTargetDir)) {
            (0, fs_1.mkdirSync)(systemControllersTargetDir, { recursive: true });
        }
        for (const systemController of this.fw24.getSystemControllers()) {
            let relativePathFromFramework = '';
            // Fallback: use the last few directories to preserve structure
            const pathParts = systemController.filePath.split('/');
            const relevantParts = pathParts.slice(-3); // e.g., ['search', 'system', 'search-controller.js']
            relativePathFromFramework = relevantParts.join('/');
            this.logger.warn(`System controller relative path: ${relativePathFromFramework}`);
            const targetFilePath = path_1.default.join(systemControllersTargetDir, relativePathFromFramework);
            const targetDirectory = path_1.default.dirname(targetFilePath);
            this.logger.warn(`System controller target-directory: ${targetDirectory}, targetFilePath: ${targetFilePath}`);
            // Ensure target subdirectory exists
            if (!(0, fs_1.existsSync)(targetDirectory)) {
                (0, fs_1.mkdirSync)(targetDirectory, { recursive: true });
            }
            // Copy the system controller file
            (0, fs_1.copyFileSync)(systemController.filePath, targetFilePath);
            this.logger.info(`Copied system controller from ${systemController.filePath} to ${targetFilePath}`);
            // Register from the copied location
            const directory = path_1.default.dirname(targetFilePath);
            const fileName = path_1.default.basename(targetFilePath);
            this.logger.info(`Registering system controller from ${directory}-->${fileName}`);
            await helper_1.Helper.registerHandlers(directory, this.registerController, [fileName]);
        }
    }
    prepareEntryPackages(controllerConfig, ownerModule) {
        let entryPackages = controllerConfig.entryPackages || [];
        if ((0, utils_1.isArray)(entryPackages)) {
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
        const { handlerClass, filePath, fileName, handlerHash, manifestCapability, deploymentUnit, manifestCapabilities } = controllerInfo;
        let controllerName;
        let controllerConfig;
        let routes;
        if (deploymentUnit && manifestCapabilities) {
            // DU-based registration - register the entire deployment unit
            controllerName = deploymentUnit.name;
            controllerConfig = this.extractDUConfigFromManifest(deploymentUnit, manifestCapabilities);
            routes = this.extractDURoutesFromManifest(manifestCapabilities);
        }
        else if (manifestCapability) {
            // Single capability manifest-based registration
            controllerName = manifestCapability.id.split(':')[0];
            controllerConfig = this.extractControllerConfigFromManifest(manifestCapability);
            routes = this.extractRoutesFromManifest(manifestCapability);
        }
        else {
            // Traditional registration - instantiate class
            const folderPath = fileName.split('/').slice(0, -1).join('/');
            const handlerInstance = new handlerClass();
            controllerName = !fileName.includes('/') ? handlerInstance.controllerName : folderPath + '/' + handlerInstance.controllerName;
            controllerConfig = handlerInstance?.controllerConfig || {};
            routes = handlerInstance.routes;
        }
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
        controllerInfo.routes = routes;
        this.logger.info(`Registering controller ${controllerName} from ${filePath}/${fileName}`);
        // prepare the entry packages for the controller's lambda function
        const entryPackages = this.prepareEntryPackages(controllerConfig, ownerModule);
        controllerConfig.entryPackages = entryPackages;
        this.resources = [];
        this.methods = [];
        // create the api resource for the controller if it doesn't exist
        const controllerResource = this.getOrCreateControllerResource(controllerName, controllerStackName);
        var controllerTarget = controllerConfig.target;
        var controllerIntegration;
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
                stackInfo.controllersHash.push((0, crypto_1.createHash)('md5').update(JSON.stringify(controllerConfig)).digest('hex'));
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
                controllersHash.push((0, crypto_1.randomUUID)());
            }
            const controllerHash = (0, crypto_1.createHash)('md5').update(JSON.stringify(controllersHash)).digest('hex');
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
            this.controllerStacks.forEach(c => c.controllersHash.push((0, crypto_1.randomUUID)()));
        }
        // create the name from all the controller hash values combined as a single hash and add dependency on all the controllers
        const deploymentName = `deployment-${(0, crypto_1.createHash)('md5').update(Array.from(this.controllerStacks.values()).map(c => c.controllersHash).join('-')).digest('hex')}`;
        const deployment = new aws_apigateway_1.Deployment(this.fw24.getStack(this.name), deploymentName, {
            api: this.api,
            stageName: stageName,
        });
        for (const [controllerStackName, { methods, resources, controllersHash }] of this.controllerStacks.entries()) {
            for (const method of methods) {
                this.logger.debug(`Adding method dependency ${method.httpMethod} ${method.resource.path} to deployment`);
                deployment.node.addDependency(method);
            }
            for (const resource of resources) {
                this.logger.debug(`Adding resource dependency ${resource.path} to deployment`);
                deployment.node.addDependency(resource);
            }
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
    getOrCreateControllerResource = (controllerName, controllerStackName) => {
        let restAPI = this.getAPI(controllerStackName);
        let controllerResource = restAPI.api.root;
        const currentStack = this.fw24.getStack(controllerStackName);
        const pathParts = controllerName.split('/');
        for (const pathPart of pathParts) {
            let childResource = controllerResource.getResource(pathPart);
            // if it's a nested controller, the root resource may not be created in another stack
            const isNestedController = pathParts.length > 1;
            if (!childResource && isNestedController && pathPart === pathParts[0]) {
                // try to get the root resource from the fw24 output
                this.logger.debug(`Getting controller resource for ${pathPart} from fw24 output`);
                const controllerResourceId = this.fw24.getEnvironmentVariable(`restAPI_controller_${pathPart}_resourceId`, 'resource', currentStack);
                if (controllerResourceId) {
                    this.logger.debug(`Controller resource for ${pathPart} found in fw24 output: ${controllerResourceId}`);
                    childResource = aws_apigateway_1.Resource.fromResourceAttributes(currentStack, `${this.fw24.appName}-${controllerStackName}-${pathPart}`, {
                        resourceId: controllerResourceId,
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
                if (isNestedController && pathPart === pathParts[0]) {
                    this.logger.debug(`Setting output for contorller resource ${controllerStackName} path ${pathPart}`);
                    this.fw24.setConstructOutput(this, `restAPI_controller_${pathPart}`, childResource, construct_1.OutputType.RESOURCE, 'resourceId');
                }
            }
            controllerResource = childResource;
        }
        return controllerResource;
    };
    createLambdaFunction = (controllerName, filePath, fileName, controllerConfig, controllerStackName) => {
        const functionProps = { ...this.apiConstructConfig.functionProps, ...controllerConfig?.functionProps };
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
            if ((0, utils_1.isString)(defaultAuthorizerGroups)) {
                defaultAuthorizerGroups = this.fw24.tryResolveEnvKeyTemplate(defaultAuthorizerGroups);
            }
            // now if the resolved value is again a string, split it by comma
            // when the value is like "group1,group2" ==> ["group1", "group2"]
            if ((0, utils_1.isString)(defaultAuthorizerGroups)) {
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
            defaultAuthorizerGroups = defaultAuthorizerGroups.flatMap((group) => group.split(','));
        }
        return { defaultAuthorizerName, defaultAuthorizerType, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig };
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
            routeAuthorizerGroups = route.authorizer.groups || defaultAuthorizerGroups;
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
                    "application/json": `Action=Publish&TopicArn=$util.urlEncode(\'${topicInstance.topicArn}\')&Message=$util.urlEncode($input.body)`,
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
                const defaultKey = (0, crypto_1.createHash)('sha256')
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
            const usagePlan = new aws_apigateway_2.UsagePlan(this.mainStack, `${this.fw24.appName}-${planName}-usage-plan`, {
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
                    period: planConfig?.quotaPeriod || aws_apigateway_2.Period.MONTH
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
                        existingKey = new aws_apigateway_2.ApiKey(this.mainStack, `${this.fw24.appName}-${keyName}-api-key`, {
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
                    this.apiKeys.get(planName).push(existingKey);
                });
            }
        }
        return this.usagePlans.get(planName);
    }
    extractControllerConfigFromManifest(capability) {
        // Extract controller config from manifest capability
        // This is a simplified version - in full implementation would handle all config options
        const config = {};
        if (capability.requires?.resourceIntents) {
            // Convert resource intents to legacy resourceAccess format
            const resourceAccess = {};
            for (const intent of capability.requires.resourceIntents) {
                if (intent.kind === 'table') {
                    if (!resourceAccess.tables)
                        resourceAccess.tables = [];
                    resourceAccess.tables.push(intent.name);
                }
                // Add other resource types as needed
            }
            config.resourceAccess = resourceAccess;
        }
        return config;
    }
    extractRoutesFromManifest(capability) {
        const routes = {};
        if (capability.routing?.routes) {
            for (const route of capability.routing.routes) {
                const routeKey = `${route.method.toLowerCase()}${route.path}`;
                routes[routeKey] = {
                    httpMethod: route.method,
                    functionName: capability.exportName,
                    path: route.path,
                    parameters: [], // Extract from path parameters if needed
                    authorizer: route.authorizer,
                    target: route.target || 'function'
                };
            }
        }
        return routes;
    }
    extractDUConfigFromManifest(_du, capabilities) {
        // Merge resource intents from all capabilities in the DU
        const allIntents = capabilities.flatMap(cap => cap.requires?.resourceIntents || []);
        const resourceAccess = this.translateIntentsToResourceAccess(allIntents);
        return {
            resourceAccess,
            // TODO: Convert DU functionProps to proper format
            // TODO: Convert DU env to proper format
        };
    }
    extractDURoutesFromManifest(capabilities) {
        const routes = {};
        for (const capability of capabilities) {
            if (capability.kind === 'controller' && capability.routing?.routes) {
                const basePath = capability.routing.basePath || '';
                for (const route of capability.routing.routes) {
                    const fullPath = `${basePath}${route.path}`;
                    const routeKey = `${route.method}|${fullPath}`;
                    routes[routeKey] = {
                        httpMethod: route.method,
                        functionName: capability.exportName,
                        path: fullPath,
                        authorizer: route.authorizer,
                        target: route.target || 'function',
                        parameters: [] // TODO: Extract parameters from route path
                    };
                }
            }
        }
        return routes;
    }
    translateIntentsToResourceAccess(intents) {
        const resourceAccess = {};
        const tables = intents.filter(i => i.kind === 'table').map(i => i.name);
        const buckets = intents.filter(i => i.kind === 'bucket').map(i => i.name);
        const queues = intents.filter(i => i.kind === 'queue').map(i => i.name);
        const topics = intents.filter(i => i.kind === 'topic').map(i => i.name);
        if (tables.length > 0)
            resourceAccess.tables = tables;
        if (buckets.length > 0)
            resourceAccess.buckets = buckets;
        if (queues.length > 0)
            resourceAccess.queues = queues;
        if (topics.length > 0)
            resourceAccess.topics = topics;
        return resourceAccess;
    }
}
exports.APIConstruct = APIConstruct;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVNBLCtEQVVvQztBQUVwQyw2Q0FBcUY7QUFFckYsaURBQTZEO0FBRTdELGlEQUE0QztBQUM1QyxpREFBNEM7QUFNNUMsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx1REFBeUY7QUFDekYsd0NBQTBDO0FBRTFDLHVEQUFtRDtBQUNuRCw2REFBeUQ7QUFHekQsa0NBQTBDO0FBQzFDLG9DQUE2QztBQUM3QyxpQ0FBdUM7QUFDdkMsK0NBQXFEO0FBQ3JELHlDQUErQztBQUMvQyxtQ0FBeUM7QUFDekMscUNBQTJDO0FBQzNDLG1DQUF5QztBQUN6QyxtQ0FBeUM7QUFFekMsbUNBQWdEO0FBQ2hELCtCQUFxQztBQUNyQywrREFBdUU7QUFDdkUsZ0RBQXdCO0FBQ3hCLDJCQUF1RTtBQXlJdkUsTUFBYSxZQUFZO0lBbUJEO0lBbEJYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLFlBQVksQ0FBQyxJQUFJLENBQUM7SUFDakMsWUFBWSxHQUFhLENBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsd0JBQWUsQ0FBQyxJQUFJLEVBQUUsNEJBQWlCLENBQUMsSUFBSSxFQUFFLG9CQUFhLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxDQUFFLENBQUM7SUFDaEwsTUFBTSxDQUF1QjtJQUU3QixHQUFHLENBQVc7SUFDZCxTQUFTLENBQVM7SUFDbEIsVUFBVSxHQUFtRCxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3ZFLE9BQU8sR0FBMEIsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUMz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QztRQUN4RSxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFeEUsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxjQUFjLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUN0RCxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLGNBQWMsQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3pELElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsY0FBYyxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDdEQsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxjQUFjLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUV0RCxPQUFPLGNBQWMsQ0FBQztJQUMxQixDQUFDO0NBRUo7QUF0OEJELG9DQXM4QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7XG4gICAgQXV0aG9yaXphdGlvblR5cGUsXG4gICAgQ29yc09wdGlvbnMsXG4gICAgSVJlc291cmNlLFxuICAgIE1ldGhvZCxcbiAgICBNZXRob2RPcHRpb25zLFxuICAgIFJlc3RBcGlQcm9wc1xufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcblxuaW1wb3J0IHtcbiAgICBBd3NJbnRlZ3JhdGlvbixcbiAgICBDb3JzLFxuICAgIERlcGxveW1lbnQsXG4gICAgUmVzdEFwaSxcbiAgICBJUmVzdEFwaSxcbiAgICBSZXNvdXJjZSxcbiAgICBNZXRob2RMb2dnaW5nTGV2ZWwsXG4gICAgU3RhZ2UsXG4gICAgUmVzcG9uc2VUeXBlXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuXG5pbXBvcnQgeyBDZm5PdXRwdXQsIER1cmF0aW9uLCBOZXN0ZWRTdGFjaywgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5cbmltcG9ydCB0eXBlIHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi4vY29yZS9cIjtcbmltcG9ydCB0eXBlIEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuXG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCBNdXRhYmxlIGZyb20gXCIuLi90eXBlcy9tdXRhYmxlXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgTGFtYmRhSW50ZWdyYXRpb24gfSBmcm9tIFwiLi9sYW1iZGEtaW50ZWdyYXRpb25cIjtcblxuaW1wb3J0IHsgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vZGVjb3JhdG9ycy9jb250cm9sbGVyXCI7XG5pbXBvcnQgeyBFTlZfS0VZUywgUm91dGUgfSBmcm9tIFwiLi4vZncyNFwiO1xuaW1wb3J0IHsgaXNBcnJheSwgaXNTdHJpbmcgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IEF1dGhDb25zdHJ1Y3QgfSBmcm9tIFwiLi9hdXRoXCI7XG5pbXBvcnQgeyBDZXJ0aWZpY2F0ZUNvbnN0cnVjdCB9IGZyb20gXCIuL2NlcnRpZmljYXRlXCI7XG5pbXBvcnQgeyBEeW5hbW9EQkNvbnN0cnVjdCB9IGZyb20gXCIuL2R5bmFtb2RiXCI7XG5pbXBvcnQgeyBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2xheWVyXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IFF1ZXVlQ29uc3RydWN0IH0gZnJvbSBcIi4vcXVldWVcIjtcbmltcG9ydCB7IFRvcGljQ29uc3RydWN0IH0gZnJvbSBcIi4vdG9waWNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBjcmVhdGVIYXNoLCByYW5kb21VVUlEIH0gZnJvbSBcImNyeXB0b1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBBcGlLZXksIFVzYWdlUGxhbiwgUGVyaW9kIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IG1rZGlyU3luYywgZXhpc3RzU3luYywgY29weUZpbGVTeW5jLCByZWFkRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBDYXBhYmlsaXR5RGVzY3JpcHRvciwgTWFuaWZlc3QsIERlcGxveW1lbnRVbml0RGVzY3JpcHRvciwgUmVzb3VyY2VJbnRlbnQgfSBmcm9tIFwiLi4vbWFuaWZlc3QvdHlwZXNcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIGFuIEFQSSBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUFQSUNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgQ09SUyBjb25maWd1cmF0aW9uIGZvciB0aGUgQVBJLlxuICAgICAqIEl0IGNhbiBiZSBhIGJvb2xlYW4gdmFsdWUsIGEgc2luZ2xlIHN0cmluZywgb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncy5cbiAgICAgKi9cbiAgICBjb3JzPzogYm9vbGVhbiB8IHN0cmluZyB8IHN0cmluZ1tdO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIGFkZGl0aW9uYWwgb3B0aW9ucyBmb3IgdGhlIEFQSS5cbiAgICAgKi9cbiAgICBhcGlPcHRpb25zPzogUmVzdEFwaVByb3BzO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIGNvbnRyb2xsZXJzIGFyZSBsb2NhdGVkLlxuICAgICAqL1xuICAgIGNvbnRyb2xsZXJzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvbi5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wcztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgbnVtYmVyIG9mIGRheXMgdG8gcmV0YWluIHRoZSBBUEkgbG9ncy5cbiAgICAgKi9cbiAgICBsb2dSZXRlbnRpb25EYXlzPzogUmV0ZW50aW9uRGF5cztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgcmVtb3ZhbCBwb2xpY3kgZm9yIHRoZSBBUEkgbG9ncy5cbiAgICAgKi9cbiAgICBsb2dSZW1vdmFsUG9saWN5PzogUmVtb3ZhbFBvbGljeTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBjdXN0b20gZG9tYWluIG5hbWUgZm9yIHRoZSBBUEkuXG4gICAgICovXG4gICAgZG9tYWluTmFtZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBjZXJ0aWZpY2F0ZSBBUk4gZm9yIHRoZSBjdXN0b20gZG9tYWluIG5hbWUuXG4gICAgICovXG4gICAgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBBUEkgR2F0ZXdheSBMYW1iZGEgaW50ZWdyYXRpb24gdGltZW91dCBpbiBzZWNvbmRzLlxuICAgICAqL1xuICAgIGludGVncmF0aW9uVGltZW91dD86IG51bWJlcjtcblxuICAgIC8qKlxuICAgICAqIFRoZSBwYXJlbnQgc3RhY2sgbmFtZSBmb3IgdGhlIENvbnRyb2xsZXJzLlxuICAgICAqL1xuICAgIGNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBTZXQgdG8gZmFsc2UgaWYgeW91IHdhbnQgdG8gc2tpcCBjcmVhdGlvbiBvZiBjb250cm9sbGVycyByZXNvdXJjZXMgYW5kIG1ldGhvZHNcbiAgICAgKiBUaGlzIHdpbGwgZGVsZXRlIGFsbCB0aGUgY29udHJvbGxlcnMgcmVzb3VyY2VzIGFuZCBtZXRob2RzIGZyb20gdGhlIEFQSVxuICAgICAqL1xuICAgIHNraXBDb250cm9sbGVycz86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBGb3JjZSBhIGRlcGxveW1lbnQgb2YgdGhlIEFQSSB3aGVuIHVzaW5nIGltcG9ydGVkIEFQSXNcbiAgICAgKi9cbiAgICBmb3JjZURlcGxveW1lbnQ/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogQVBJIGtleSBjb25maWd1cmF0aW9uIGZvciB0aGUgQVBJXG4gICAgICovXG4gICAgYXBpS2V5Q29uZmlnPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogTGlzdCBvZiB2YWxpZCBBUEkga2V5cy4gSWYgZW1wdHksIGtleXMgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZFxuICAgICAgICAgKi9cbiAgICAgICAga2V5cz86IHN0cmluZ1tdO1xuICAgICAgICAvKipcbiAgICAgICAgICogTmFtZSBvZiB0aGUgQVBJIGtleSAodXNlZCB3aGVuIGF1dG8tZ2VuZXJhdGluZylcbiAgICAgICAgICovXG4gICAgICAgIGtleU5hbWU/OiBzdHJpbmc7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFVzYWdlIHBsYW4gY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSVxuICAgICAqL1xuICAgIHVzYWdlUGxhbnM/OiBJVXNhZ2VQbGFuQ29uZmlnW107XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgQVBJIGtleSB3aXRoaW4gYSB1c2FnZSBwbGFuXG4gKi9cbmludGVyZmFjZSBJVXNhZ2VQbGFuQXBpS2V5Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBMaXN0IG9mIHZhbGlkIEFQSSBrZXlzLiBJZiBlbXB0eSwga2V5cyB3aWxsIGJlIGF1dG8tZ2VuZXJhdGVkXG4gICAgICovXG4gICAga2V5cz86IHN0cmluZ1tdO1xuICAgIC8qKlxuICAgICAqIE5hbWUgcHJlZml4IGZvciB0aGUgQVBJIGtleXMgKHVzZWQgd2hlbiBhdXRvLWdlbmVyYXRpbmcpXG4gICAgICovXG4gICAga2V5TmFtZVByZWZpeD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBhIHVzYWdlIHBsYW5cbiAqL1xuaW50ZXJmYWNlIElVc2FnZVBsYW5Db25maWcge1xuICAgIC8qKlxuICAgICAqIE5hbWUgb2YgdGhlIHVzYWdlIHBsYW5cbiAgICAgKi9cbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogRGVzY3JpcHRpb24gb2YgdGhlIHVzYWdlIHBsYW5cbiAgICAgKi9cbiAgICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBSYXRlIGxpbWl0IHBlciBzZWNvbmRcbiAgICAgKi9cbiAgICByYXRlTGltaXQ/OiBudW1iZXI7XG4gICAgLyoqXG4gICAgICogQnVyc3QgbGltaXRcbiAgICAgKi9cbiAgICBidXJzdExpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIFF1b3RhIGxpbWl0IHBlciBwZXJpb2RcbiAgICAgKi9cbiAgICBxdW90YUxpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIFF1b3RhIHBlcmlvZFxuICAgICAqL1xuICAgIHF1b3RhUGVyaW9kPzogUGVyaW9kO1xuICAgIC8qKlxuICAgICAqIEFQSSBrZXkgY29uZmlndXJhdGlvbiBmb3IgdGhpcyB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgYXBpS2V5cz86IElVc2FnZVBsYW5BcGlLZXlDb25maWc7XG59XG5cbmV4cG9ydCBjbGFzcyBBUElDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoQVBJQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBBUElDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gWyBWcGNDb25zdHJ1Y3QubmFtZSwgTWFpbGVyQ29uc3RydWN0Lm5hbWUsIER5bmFtb0RCQ29uc3RydWN0Lm5hbWUsIEF1dGhDb25zdHJ1Y3QubmFtZSwgUXVldWVDb25zdHJ1Y3QubmFtZSwgVG9waWNDb25zdHJ1Y3QubmFtZSwgTGF5ZXJDb25zdHJ1Y3QubmFtZSBdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBhcGkhOiBSZXN0QXBpO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuICAgIHVzYWdlUGxhbnM6IE1hcDxzdHJpbmcsIHsgcGxhbjogVXNhZ2VQbGFuOyBuYW1lOiBzdHJpbmcgfT4gPSBuZXcgTWFwKCk7XG4gICAgYXBpS2V5czogTWFwPHN0cmluZywgQXBpS2V5W10+ID0gbmV3IE1hcCgpO1xuICAgIGtleVZhbHVlczogTWFwPHN0cmluZywgQXBpS2V5PiA9IG5ldyBNYXAoKTtcblxuICAgIHByaXZhdGUgcmVzb3VyY2VzOiBJUmVzb3VyY2VbXSA9IFtdO1xuICAgIHByaXZhdGUgbWV0aG9kczogTWV0aG9kW10gPSBbXTtcbiAgICBwcml2YXRlIGNvbnRyb2xsZXJTdGFja3MgPSBuZXcgTWFwPHN0cmluZywgeyBtZXRob2RzOiBNZXRob2RbXSwgcmVzb3VyY2VzOiBJUmVzb3VyY2VbXSwgY29udHJvbGxlcnNIYXNoOiBzdHJpbmdbXSB9PigpO1xuXG4gICAgLy8gZGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBhcGlDb25zdHJ1Y3RDb25maWc6IElBUElDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgLy8gaHlkcmF0ZSB0aGUgY29uZmlnIG9iamVjdCB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlcyBleDogQVBJR0FURVdBWV9DT05UUk9MTEVSU1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhhcGlDb25zdHJ1Y3RDb25maWcsICdBUElHQVRFV0FZJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gc2V0IHRoZSBkZWZhdWx0IGFwaSBvcHRpb25zXG4gICAgICAgIGNvbnN0IHBhcmFtc0FwaTogTXV0YWJsZTxSZXN0QXBpUHJvcHM+ID0geyAuLi50aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlPcHRpb25zIHx8IHt9IH07XG4gICAgICAgIC8vIEVuYWJsZSBDT1JTIGlmIGRlZmluZWRcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiRW5hYmxpbmcgQ09SUy4uLiB0aGlzLmNvbmZpZy5jb3JzOiBcIiwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyk7XG4gICAgICAgICAgICBwYXJhbXNBcGkuZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zID0gdGhpcy5nZXRDb3JzUHJlZmxpZ2h0T3B0aW9ucygpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lICYmIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGVDb25zdHJ1Y3QgPSBuZXcgQ2VydGlmaWNhdGVDb25zdHJ1Y3Qoe1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgY2VydGlmaWNhdGVBcm46IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNlcnRpZmljYXRlQXJuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNlcnRpZmljYXRlQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGUgPSBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5vdXRwdXRbIE91dHB1dFR5cGUuQ0VSVElGSUNBVEUgXVsgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSBdO1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRvbWFpbk5hbWUgPSB7XG4gICAgICAgICAgICAgICAgZG9tYWluTmFtZTogdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSxcbiAgICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZTogY2VydGlmaWNhdGUsXG4gICAgICAgICAgICAgICAgYmFzZVBhdGg6IHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zPy5zdGFnZU5hbWUgfHwgJy8nLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBmb3IgbXVsdGlzdGFjayBhcHBsaWNhdGlvbiwgc2V0IGRlcGxveSB0byBmYWxzZVxuICAgICAgICBpZiAodGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBwYXJhbXNBcGkuZGVwbG95ID0gZmFsc2U7XG4gICAgICAgICAgICBkZWxldGUgcGFyYW1zQXBpLmRlcGxveU9wdGlvbnM7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBBUEkgR2F0ZXdheS4uLiBcIik7XG4gICAgICAgIC8vIGdldCB0aGUgbWFpbiBzdGFjayBmcm9tIHRoZSBmcmFtZXdvcmtcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICAvLyBjcmVhdGUgdGhlIGFwaSBnYXRld2F5XG4gICAgICAgIHRoaXMuYXBpID0gbmV3IFJlc3RBcGkodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS1hcGlgLCB7XG4gICAgICAgICAgICAuLi5wYXJhbXNBcGksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKSB7XG4gICAgICAgICAgICBjb25zdCBjb3JzT3JpZ2lucyA9IHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKS5hbGxvd09yaWdpbnM/LmpvaW4oJywnKSE7XG4gICAgICAgICAgICB0aGlzLmFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ2RlZmF1bHQ0eHgnLCB7XG4gICAgICAgICAgICAgICAgdHlwZTogUmVzcG9uc2VUeXBlLkRFRkFVTFRfNFhYLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlSGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYCcke2NvcnNPcmlnaW5zfSdgLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdkZWZhdWx0NXh4Jywge1xuICAgICAgICAgICAgICAgIHR5cGU6IFJlc3BvbnNlVHlwZS5ERUZBVUxUXzVYWCxcbiAgICAgICAgICAgICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGAnJHtjb3JzT3JpZ2luc30nYCxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB1cCB1c2FnZSBwbGFucyBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy51c2FnZVBsYW5zPy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGxhbkNvbmZpZyBvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy51c2FnZVBsYW5zKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXR1cFVzYWdlUGxhbihwbGFuQ29uZmlnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZncyNC5hZGRBUEkodGhpcy5uYW1lLCAncm9vdCcsIHRoaXMuYXBpLCBmYWxzZSk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ3Jlc3RBUEknLCB0aGlzLmFwaSwgT3V0cHV0VHlwZS5BUEksICdyZXN0QXBpSWQnKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCAncmVzdEFQSScsIHRoaXMuYXBpLCBPdXRwdXRUeXBlLkFQSSwgJ3Jlc3RBcGlSb290UmVzb3VyY2VJZCcpO1xuXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5za2lwQ29udHJvbGxlcnMpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJDb250cm9sbGVycygpO1xuXG4gICAgICAgIC8vIGlmIG11bHRpL25lc3RlZC1zdGFjayBzZXR1cCwgdGhlbiBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2tcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQVBJLWdhdGV3YXkgY29uc3RydWN0OiAke3RoaXMubmFtZX0gaGFzIGltcG9ydGVkIEFQSXM6ICR7dGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSl9YCk7XG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSAmJiB0aGlzLmZ3MjQudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlRGVwbG95bWVudHMoKTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVTaW5nbGVEZXBsb3ltZW50KCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGdldEFQSSA9IChzdGFja05hbWU6IHN0cmluZyk6IGFueSA9PiB7XG4gICAgICAgIGxldCBjdXJyZW50QVBJOiBhbnkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgJ3Jvb3QnKTtcblxuICAgICAgICAvLyBpZiB0aGUgc3RhY2sgaXMgbm90IHRoZSBtYWluIHN0YWNrIGFuZCBpdHMgYSBtdWx0aS1zdGFjayBhcHBsaWNhdGlvbiBvciBhIG5lc3RlZCBzdGFjaywgdGhlbiBpbXBvcnQgdGhlIEFQSVxuICAgICAgICBjb25zdCBjdXJyZW50U3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2soc3RhY2tOYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEN1cnJlbnQgU3RhY2s6ICR7Y3VycmVudFN0YWNrLnN0YWNrTmFtZX0gaXMgbmVzdGVkIHN0YWNrOiAke2N1cnJlbnRTdGFjayBpbnN0YW5jZW9mIE5lc3RlZFN0YWNrfWApO1xuICAgICAgICBpZiAodGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cChzdGFja05hbWUsIHRoaXMubWFpblN0YWNrKSB8fCBjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFjaykge1xuICAgICAgICAgICAgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCBzdGFja05hbWUpO1xuICAgICAgICAgICAgaWYgKCFjdXJyZW50QVBJKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0ZWRBUEkgPSBSZXN0QXBpLmZyb21SZXN0QXBpQXR0cmlidXRlcyhjdXJyZW50U3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3N0YWNrTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgICAgICAgICByZXN0QXBpSWQ6IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdyZXN0QVBJX3Jlc3RBcGlJZCcsICdhcGknLCBjdXJyZW50U3RhY2spLFxuICAgICAgICAgICAgICAgICAgICByb290UmVzb3VyY2VJZDogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ3Jlc3RBUElfcmVzdEFwaVJvb3RSZXNvdXJjZUlkJywgJ2FwaScsIGN1cnJlbnRTdGFjayksXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEFQSSh0aGlzLm5hbWUsIHN0YWNrTmFtZSwgaW1wb3J0ZWRBUEksIHRydWUpO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjdXJyZW50QVBJO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVnaXN0ZXJDb250cm9sbGVycygpIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgbWFuaWZlc3QgZXhpc3RzIGFuZCB1c2UgaXQgaW5zdGVhZCBvZiBzY2FubmluZ1xuICAgICAgICBjb25zdCBtYW5pZmVzdFBhdGggPSBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgJy5mdzI0JywgJ291dCcsICdtYW5pZmVzdC5qc29uJyk7XG4gICAgICAgIGlmIChleGlzdHNTeW5jKG1hbmlmZXN0UGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJVc2luZyBtYW5pZmVzdC1iYXNlZCBjb250cm9sbGVyIHJlZ2lzdHJhdGlvblwiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJDb250cm9sbGVyc0Zyb21NYW5pZmVzdChtYW5pZmVzdFBhdGgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIk1hbmlmZXN0IG5vdCBmb3VuZCwgZmFsbGluZyBiYWNrIHRvIGRpcmVjdG9yeSBzY2FubmluZ1wiKTtcbiAgICAgICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgY29udHJvbGxlcnMgZGlyZWN0b3J5IGlmIG5vdCBkZWZpbmVkXG4gICAgICAgICAgICBjb25zdCBjb250cm9sbGVyc0RpcmVjdG9yeSA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJzRGlyZWN0b3J5IHx8IFwiLi9zcmMvY29udHJvbGxlcnNcIjtcblxuICAgICAgICAgICAgLy8gcmVnaXN0ZXIgdGhlIGNvbnRyb2xsZXJzXG4gICAgICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhjb250cm9sbGVyc0RpcmVjdG9yeSwgdGhpcy5yZWdpc3RlckNvbnRyb2xsZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIG1vZHVsZXMgXCIsIEFycmF5LmZyb20obW9kdWxlcy5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJMb2FkIGNvbnRyb2xsZXJzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcblxuICAgICAgICAgICAgICAgIEhlbHBlci5yZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZShcbiAgICAgICAgICAgICAgICAgICAgbW9kdWxlLFxuICAgICAgICAgICAgICAgICAgICAoZGVzYzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHRoaXMucmVnaXN0ZXJDb250cm9sbGVyKGRlc2MsIG1vZHVsZSlcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIE5PIG1vZHVsZXMgXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVnaXN0ZXIgc3lzdGVtIGNvbnRyb2xsZXJzIGZyb20gZncyNCBzaW5nbGV0b25cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNTeXN0ZW1Db250cm9sbGVycygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IHJlZ2lzdGVyaW5nIHN5c3RlbSBjb250cm9sbGVyc1wiKTtcblxuICAgICAgICAgICAgLy8gQ29weSBzeXN0ZW0gY29udHJvbGxlcnMgdG8gYXBwIGRpc3QgYW5kIHJlZ2lzdGVyIGZyb20gdGhlcmVcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29weUFuZFJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcnMoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBOTyBzeXN0ZW0gY29udHJvbGxlcnNcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTWFuaWZlc3QobWFuaWZlc3RQYXRoOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkxvYWRpbmcgbWFuaWZlc3QgZnJvbTpcIiwgbWFuaWZlc3RQYXRoKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IG1hbmlmZXN0Q29udGVudCA9IHJlYWRGaWxlU3luYyhtYW5pZmVzdFBhdGgsICd1dGYtOCcpO1xuICAgICAgICBjb25zdCBtYW5pZmVzdDogTWFuaWZlc3QgPSBKU09OLnBhcnNlKG1hbmlmZXN0Q29udGVudCk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZWdpc3RlciBBUEkgZGVwbG95bWVudCB1bml0cyAod2hpY2ggY29udGFpbiBncm91cGVkIGNvbnRyb2xsZXJzKVxuICAgICAgICBjb25zdCBhcGlEVXMgPSBtYW5pZmVzdC5kZXBsb3ltZW50VW5pdHMuZmlsdGVyKGR1ID0+IGR1LmtpbmQgPT09ICdhcGknKTtcbiAgICAgICAgXG4gICAgICAgIGZvciAoY29uc3QgZHUgb2YgYXBpRFVzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWdpc3RlcmluZyBBUEkgRFU6ICR7ZHUubmFtZX1gKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVXNlIHRoZSBnZW5lcmF0ZWQgYm9vdHN0cmFwIGZpbGUgaW5zdGVhZCBvZiBpbmRpdmlkdWFsIGNvbnRyb2xsZXJzXG4gICAgICAgICAgICBjb25zdCBib290c3RyYXBQYXRoID0gYC5mdzI0Ly5nZW5lcmF0ZWQvZHUtJHtkdS5uYW1lfS5ib290c3RyYXAudHNgO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjb25zdCBoYW5kbGVyRGVzY3JpcHRvcjogSGFuZGxlckRlc2NyaXB0b3IgPSB7XG4gICAgICAgICAgICAgICAgaGFuZGxlckNsYXNzOiBudWxsLFxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBgZHUtJHtkdS5uYW1lfS5ib290c3RyYXAudHNgLFxuICAgICAgICAgICAgICAgIGZpbGVQYXRoOiBwYXRoLnJlc29sdmUoJy5mdzI0Ly5nZW5lcmF0ZWQnKSxcbiAgICAgICAgICAgICAgICBoYW5kbGVySGFzaDogYGR1LSR7ZHUubmFtZX1gLFxuICAgICAgICAgICAgICAgIGRlcGxveW1lbnRVbml0OiBkdSxcbiAgICAgICAgICAgICAgICBtYW5pZmVzdENhcGFiaWxpdGllczogbWFuaWZlc3QuY2FwYWJpbGl0aWVzLmZpbHRlcihjYXAgPT4gXG4gICAgICAgICAgICAgICAgICAgIGNhcC5raW5kID09PSAnY29udHJvbGxlcicgJiYgdGhpcy5pc0NhcGFiaWxpdHlJbkRVKGNhcCwgZHUsIG1hbmlmZXN0KVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb250cm9sbGVyKGhhbmRsZXJEZXNjcmlwdG9yKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIGlzQ2FwYWJpbGl0eUluRFUoY2FwYWJpbGl0eTogQ2FwYWJpbGl0eURlc2NyaXB0b3IsIGR1OiBEZXBsb3ltZW50VW5pdERlc2NyaXB0b3IsIF9tYW5pZmVzdDogTWFuaWZlc3QpOiBib29sZWFuIHtcbiAgICAgICAgLy8gRm9yIG5vdywgc2ltcGxlIGxvZ2ljIC0gYWxsIGNvbnRyb2xsZXJzIGdvIHRvICdhcGknIERVXG4gICAgICAgIC8vIFRPRE86IEltcGxlbWVudCBwcm9wZXIgRFUgbWF0Y2hpbmcgbG9naWMgYmFzZWQgb24gZHUuaW5jbHVkZS9leGNsdWRlXG4gICAgICAgIHJldHVybiBkdS5uYW1lID09PSAnYXBpJyAmJiBjYXBhYmlsaXR5LmtpbmQgPT09ICdjb250cm9sbGVyJztcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGNvcHlBbmRSZWdpc3RlclN5c3RlbUNvbnRyb2xsZXJzKCkge1xuICAgICAgICBjb25zdCBzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciA9IHBhdGguam9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdCcsICdzeXN0ZW0tY29udHJvbGxlcnMnKTtcblxuICAgICAgICAvLyBFbnN1cmUgdGFyZ2V0IGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyKSkge1xuICAgICAgICAgICAgbWtkaXJTeW5jKHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3lzdGVtQ29udHJvbGxlciBvZiB0aGlzLmZ3MjQuZ2V0U3lzdGVtQ29udHJvbGxlcnMoKSkge1xuICAgICAgICAgICAgbGV0IHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmsgPSAnJztcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgdGhlIGxhc3QgZmV3IGRpcmVjdG9yaWVzIHRvIHByZXNlcnZlIHN0cnVjdHVyZVxuICAgICAgICAgICAgY29uc3QgcGF0aFBhcnRzID0gc3lzdGVtQ29udHJvbGxlci5maWxlUGF0aC5zcGxpdCgnLycpO1xuICAgICAgICAgICAgY29uc3QgcmVsZXZhbnRQYXJ0cyA9IHBhdGhQYXJ0cy5zbGljZSgtMyk7IC8vIGUuZy4sIFsnc2VhcmNoJywgJ3N5c3RlbScsICdzZWFyY2gtY29udHJvbGxlci5qcyddXG4gICAgICAgICAgICByZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrID0gcmVsZXZhbnRQYXJ0cy5qb2luKCcvJyk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFN5c3RlbSBjb250cm9sbGVyIHJlbGF0aXZlIHBhdGg6ICR7cmVsYXRpdmVQYXRoRnJvbUZyYW1ld29ya31gKTtcblxuICAgICAgICAgICAgY29uc3QgdGFyZ2V0RmlsZVBhdGggPSBwYXRoLmpvaW4oc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIsIHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmspO1xuICAgICAgICAgICAgY29uc3QgdGFyZ2V0RGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKHRhcmdldEZpbGVQYXRoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU3lzdGVtIGNvbnRyb2xsZXIgdGFyZ2V0LWRpcmVjdG9yeTogJHt0YXJnZXREaXJlY3Rvcnl9LCB0YXJnZXRGaWxlUGF0aDogJHt0YXJnZXRGaWxlUGF0aH1gKTtcblxuICAgICAgICAgICAgLy8gRW5zdXJlIHRhcmdldCBzdWJkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0RGlyZWN0b3J5KSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDb3B5IHRoZSBzeXN0ZW0gY29udHJvbGxlciBmaWxlXG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc3lzdGVtQ29udHJvbGxlci5maWxlUGF0aCwgdGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDb3BpZWQgc3lzdGVtIGNvbnRyb2xsZXIgZnJvbSAke3N5c3RlbUNvbnRyb2xsZXIuZmlsZVBhdGh9IHRvICR7dGFyZ2V0RmlsZVBhdGh9YCk7XG5cbiAgICAgICAgICAgIC8vIFJlZ2lzdGVyIGZyb20gdGhlIGNvcGllZCBsb2NhdGlvblxuICAgICAgICAgICAgY29uc3QgZGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKHRhcmdldEZpbGVQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gcGF0aC5iYXNlbmFtZSh0YXJnZXRGaWxlUGF0aCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlZ2lzdGVyaW5nIHN5c3RlbSBjb250cm9sbGVyIGZyb20gJHtkaXJlY3Rvcnl9LS0+JHtmaWxlTmFtZX1gKTtcblxuICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoXG4gICAgICAgICAgICAgICAgZGlyZWN0b3J5LFxuICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb250cm9sbGVyLFxuICAgICAgICAgICAgICAgIFsgZmlsZU5hbWUgXVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcHJlcGFyZUVudHJ5UGFja2FnZXMoY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlPzogSUZ3MjRNb2R1bGUpOiBzdHJpbmdbXSB7XG4gICAgICAgIGxldCBlbnRyeVBhY2thZ2VzID0gY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzIHx8IFtdO1xuXG4gICAgICAgIGlmIChpc0FycmF5KGVudHJ5UGFja2FnZXMpKSB7XG4gICAgICAgICAgICBlbnRyeVBhY2thZ2VzID0ge1xuICAgICAgICAgICAgICAgIG92ZXJyaWRlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBwYWNrYWdlTmFtZXM6IGVudHJ5UGFja2FnZXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGlmIHRoZSBjb250cm9sbGVyIGRvZXMgbm90IHdhbnQgdG8gb3ZlcnJpZGUgdGhlIGFwcGxpY2F0aW9uL21vZHVsZSBlbnRyeSBwYWNrYWdlcyBhbmQgaW5jbHVkZSB0aGVtIGFzIHdlbGxcbiAgICAgICAgaWYgKCFlbnRyeVBhY2thZ2VzLm92ZXJyaWRlKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVFbnRyeVBhY2thZ2VzID0gb3duZXJNb2R1bGU/LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IGFwcEVudHJ5UGFja2FnZXMgPSB0aGlzLmZ3MjQuZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpO1xuICAgICAgICAgICAgZW50cnlQYWNrYWdlcy5wYWNrYWdlTmFtZXMgPSBbXG4gICAgICAgICAgICAgICAgLi4uZW50cnlQYWNrYWdlcy5wYWNrYWdlTmFtZXMsXG4gICAgICAgICAgICAgICAgLi4ubW9kdWxlRW50cnlQYWNrYWdlcyxcbiAgICAgICAgICAgICAgICAuLi5hcHBFbnRyeVBhY2thZ2VzXG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzLm1hcCh0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKTtcbiAgICB9XG5cblxuICAgIC8vIHJlZ2lzdGVyIGEgc2luZ2xlIGNvbnRyb2xsZXJcbiAgICBwcml2YXRlIHJlZ2lzdGVyQ29udHJvbGxlciA9IGFzeW5jIChjb250cm9sbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IsIG93bmVyTW9kdWxlPzogSUZ3MjRNb2R1bGUpID0+IHtcbiAgICAgICAgY29uc3QgeyBoYW5kbGVyQ2xhc3MsIGZpbGVQYXRoLCBmaWxlTmFtZSwgaGFuZGxlckhhc2gsIG1hbmlmZXN0Q2FwYWJpbGl0eSwgZGVwbG95bWVudFVuaXQsIG1hbmlmZXN0Q2FwYWJpbGl0aWVzIH0gPSBjb250cm9sbGVySW5mbztcbiAgICAgICAgXG4gICAgICAgIGxldCBjb250cm9sbGVyTmFtZTogc3RyaW5nO1xuICAgICAgICBsZXQgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWc7XG4gICAgICAgIGxldCByb3V0ZXM6IFJlY29yZDxzdHJpbmcsIFJvdXRlPjtcbiAgICAgICAgXG4gICAgICAgIGlmIChkZXBsb3ltZW50VW5pdCAmJiBtYW5pZmVzdENhcGFiaWxpdGllcykge1xuICAgICAgICAgICAgLy8gRFUtYmFzZWQgcmVnaXN0cmF0aW9uIC0gcmVnaXN0ZXIgdGhlIGVudGlyZSBkZXBsb3ltZW50IHVuaXRcbiAgICAgICAgICAgIGNvbnRyb2xsZXJOYW1lID0gZGVwbG95bWVudFVuaXQubmFtZTtcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcgPSB0aGlzLmV4dHJhY3REVUNvbmZpZ0Zyb21NYW5pZmVzdChkZXBsb3ltZW50VW5pdCwgbWFuaWZlc3RDYXBhYmlsaXRpZXMpO1xuICAgICAgICAgICAgcm91dGVzID0gdGhpcy5leHRyYWN0RFVSb3V0ZXNGcm9tTWFuaWZlc3QobWFuaWZlc3RDYXBhYmlsaXRpZXMpO1xuICAgICAgICB9IGVsc2UgaWYgKG1hbmlmZXN0Q2FwYWJpbGl0eSkge1xuICAgICAgICAgICAgLy8gU2luZ2xlIGNhcGFiaWxpdHkgbWFuaWZlc3QtYmFzZWQgcmVnaXN0cmF0aW9uXG4gICAgICAgICAgICBjb250cm9sbGVyTmFtZSA9IG1hbmlmZXN0Q2FwYWJpbGl0eS5pZC5zcGxpdCgnOicpWzBdO1xuICAgICAgICAgICAgY29udHJvbGxlckNvbmZpZyA9IHRoaXMuZXh0cmFjdENvbnRyb2xsZXJDb25maWdGcm9tTWFuaWZlc3QobWFuaWZlc3RDYXBhYmlsaXR5KTtcbiAgICAgICAgICAgIHJvdXRlcyA9IHRoaXMuZXh0cmFjdFJvdXRlc0Zyb21NYW5pZmVzdChtYW5pZmVzdENhcGFiaWxpdHkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gVHJhZGl0aW9uYWwgcmVnaXN0cmF0aW9uIC0gaW5zdGFudGlhdGUgY2xhc3NcbiAgICAgICAgICAgIGNvbnN0IGZvbGRlclBhdGggPSBmaWxlTmFtZS5zcGxpdCgnLycpLnNsaWNlKDAsIC0xKS5qb2luKCcvJyk7XG4gICAgICAgICAgICBjb25zdCBoYW5kbGVySW5zdGFuY2UgPSBuZXcgaGFuZGxlckNsYXNzKCk7XG4gICAgICAgICAgICBjb250cm9sbGVyTmFtZSA9ICFmaWxlTmFtZS5pbmNsdWRlcygnLycpID8gaGFuZGxlckluc3RhbmNlLmNvbnRyb2xsZXJOYW1lIDogZm9sZGVyUGF0aCArICcvJyArIGhhbmRsZXJJbnN0YW5jZS5jb250cm9sbGVyTmFtZTtcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcgPSBoYW5kbGVySW5zdGFuY2U/LmNvbnRyb2xsZXJDb25maWcgfHwge307XG4gICAgICAgICAgICByb3V0ZXMgPSBoYW5kbGVySW5zdGFuY2Uucm91dGVzO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBjb250cm9sbGVyU3RhY2tOYW1lID0gY29udHJvbGxlckNvbmZpZy5zdGFja05hbWUgfHwgY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IHBhcmVudFN0YWNrTmFtZSA9IGNvbnRyb2xsZXJDb25maWcucGFyZW50U3RhY2tOYW1lIHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU7XG5cbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBjb250cm9sbGVyIHN0YWNrIGluZm8gaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuY29udHJvbGxlclN0YWNrcy5oYXMoY29udHJvbGxlclN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5zZXQoY29udHJvbGxlclN0YWNrTmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGhvZHM6IFtdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW10sXG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGNvbnRyb2xsZXIgc3RhY2sgZXhpc3RzXG4gICAgICAgIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lLCBwYXJlbnRTdGFja05hbWUpO1xuICAgICAgICBjb250cm9sbGVySW5mby5yb3V0ZXMgPSByb3V0ZXM7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUmVnaXN0ZXJpbmcgY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfSBmcm9tICR7ZmlsZVBhdGh9LyR7ZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgLy8gcHJlcGFyZSB0aGUgZW50cnkgcGFja2FnZXMgZm9yIHRoZSBjb250cm9sbGVyJ3MgbGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXMgPSB0aGlzLnByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlKTtcbiAgICAgICAgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzID0gZW50cnlQYWNrYWdlcztcblxuICAgICAgICB0aGlzLnJlc291cmNlcyA9IFtdO1xuICAgICAgICB0aGlzLm1ldGhvZHMgPSBbXTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgcmVzb3VyY2UgZm9yIHRoZSBjb250cm9sbGVyIGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZUNvbnRyb2xsZXJSZXNvdXJjZShjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgdmFyIGNvbnRyb2xsZXJUYXJnZXQgPSBjb250cm9sbGVyQ29uZmlnLnRhcmdldDtcbiAgICAgICAgdmFyIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbjogYW55O1xuICAgICAgICAvLyBjcmVhdGUgbGFtYmRhIGZ1bmN0aW9uIGZvciB0aGUgY29udHJvbGxlclxuICAgICAgICBpZiAoY29udHJvbGxlclRhcmdldCA9PT0gJ2Z1bmN0aW9uJyB8fCBjb250cm9sbGVyVGFyZ2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcubG9nUmV0ZW50aW9uRGF5cyA9IGNvbnRyb2xsZXJDb25maWcubG9nUmV0ZW50aW9uRGF5cyB8fCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5sb2dSZXRlbnRpb25EYXlzO1xuICAgICAgICAgICAgY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5ID0gY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5IHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmxvZ1JlbW92YWxQb2xpY3k7XG4gICAgICAgICAgICBjb25zdCBjb250cm9sbGVyTGFtYmRhID0gdGhpcy5jcmVhdGVMYW1iZGFGdW5jdGlvbihjb250cm9sbGVyTmFtZSwgZmlsZVBhdGgsIGZpbGVOYW1lLCBjb250cm9sbGVyQ29uZmlnLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJMYW1iZGEsIE91dHB1dFR5cGUuRlVOQ1RJT04pO1xuXG4gICAgICAgICAgICBjb250cm9sbGVySW50ZWdyYXRpb24gPSBuZXcgTGFtYmRhSW50ZWdyYXRpb24oY29udHJvbGxlckxhbWJkYSwge1xuICAgICAgICAgICAgICAgIHJlc3RBcGk6IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaSxcbiAgICAgICAgICAgICAgICBwYXRoOiBjb250cm9sbGVyTmFtZSxcbiAgICAgICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmludGVncmF0aW9uVGltZW91dCB8fCAyOSksXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgZGVmYXVsdEF1dGhvcml6ZXJOYW1lLCBkZWZhdWx0QXV0aG9yaXplclR5cGUsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9ID0gdGhpcy5leHRyYWN0RGVmYXVsdEF1dGhvcml6ZXIoY29udHJvbGxlckNvbmZpZyk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyIENvbnRyb2xsZXIgfiBEZWZhdWx0IEF1dGhvcml6ZXI6IG5hbWU6ICR7ZGVmYXVsdEF1dGhvcml6ZXJOYW1lfSAtIHR5cGU6ICR7ZGVmYXVsdEF1dGhvcml6ZXJUeXBlfSAtIGdyb3VwczogJHtkZWZhdWx0QXV0aG9yaXplckdyb3Vwc31gKTtcblxuICAgICAgICAvLyBTZXQgdXAgQVBJIGtleSBpZiByZXF1aXJlZFxuICAgICAgICBpZiAoY29udHJvbGxlckNvbmZpZy5yZXF1aXJlQXBpS2V5KSB7XG4gICAgICAgICAgICB0aGlzLnNldHVwVXNhZ2VQbGFuKHVuZGVmaW5lZCwgdHJ1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXQgdXAgcm91dGVzIGZvciB0aGUgY29udHJvbGxlclxuICAgICAgICBmb3IgKGNvbnN0IHJvdXRlIG9mIE9iamVjdC52YWx1ZXMoY29udHJvbGxlckluZm8ucm91dGVzID8/IHt9KSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIHJvdXRlICR7cm91dGUuaHR0cE1ldGhvZH0gJHtyb3V0ZS5wYXRofWApO1xuICAgICAgICAgICAgY29uc3Qgcm91dGVUYXJnZXQgPSByb3V0ZS50YXJnZXQgfHwgY29udHJvbGxlclRhcmdldDtcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRSZXNvdXJjZSA9IHRoaXMuZ2V0T3JDcmVhdGVSb3V0ZVJlc291cmNlKGNvbnRyb2xsZXJSZXNvdXJjZSwgcm91dGUucGF0aCwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICBjb25zdCB7IHJvdXRlQXV0aG9yaXplck5hbWUsIHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplckdyb3Vwcywgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH0gPSB0aGlzLmV4dHJhY3RSb3V0ZUF1dGhvcml6ZXIocm91dGUsIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lLCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcywgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIHJvdXRlIEF1dGhvcml6ZXI6ICR7cm91dGVBdXRob3JpemVyTmFtZX0gLSAke3JvdXRlQXV0aG9yaXplclR5cGV9IC0gJHtyb3V0ZUF1dGhvcml6ZXJHcm91cHN9YCk7XG5cbiAgICAgICAgICAgIGxldCBtZXRob2RPcHRpb25zID0gdGhpcy5jcmVhdGVNZXRob2RPcHRpb25zKHJvdXRlLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJOYW1lLCBjb250cm9sbGVyQ29uZmlnKTtcblxuICAgICAgICAgICAgaWYgKHJvdXRlVGFyZ2V0ID09PSAncXVldWUnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcm91dGUucGF0aC5yZXBsYWNlKCcvJywgJycpO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IHRoaXMuY3JlYXRlU1FTSW50ZWdyYXRpb24ocXVldWVOYW1lLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgbWV0aG9kT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubWV0aG9kT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChyb3V0ZVRhcmdldCA9PT0gJ3RvcGljJykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcGljTmFtZSA9IHJvdXRlLnBhdGgucmVwbGFjZSgnLycsICcnKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVySW50ZWdyYXRpb24gPSB0aGlzLmNyZWF0ZVNOU0ludGVncmF0aW9uKHRvcGljTmFtZSwgY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLm1ldGhvZE9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgbWV0aG9kID0gY3VycmVudFJlc291cmNlLmFkZE1ldGhvZChyb3V0ZS5odHRwTWV0aG9kLCBjb250cm9sbGVySW50ZWdyYXRpb24sIG1ldGhvZE9wdGlvbnMpO1xuICAgICAgICAgICAgdGhpcy5tZXRob2RzLnB1c2gobWV0aG9kKTtcblxuICAgICAgICAgICAgLy8gaWYgYXV0aG9yaXplciBpcyBBV1NfSUFNLCB0aGVuIGFkZCB0aGUgcm91dGUgdG8gdGhlIHBvbGljeVxuICAgICAgICAgICAgaWYgKHJvdXRlQXV0aG9yaXplclR5cGUgPT09ICdBV1NfSUFNJykge1xuICAgICAgICAgICAgICAgIGxldCBmdWxsUm91dGVQYXRoID0gY29udHJvbGxlck5hbWUgKyByb3V0ZS5wYXRoO1xuXG4gICAgICAgICAgICAgICAgLy8gKiByZXBsYWNlIGVhY2ggcGFyYW0gcGxhY2Vob2xkZXIgYHtpZH1gIHdpdGggYW4gYCpgXG4gICAgICAgICAgICAgICAgcm91dGUucGFyYW1ldGVycz8uZm9yRWFjaChwYXIgPT4ge1xuICAgICAgICAgICAgICAgICAgICBmdWxsUm91dGVQYXRoID0gZnVsbFJvdXRlUGF0aC5yZXBsYWNlKGB7JHtwYXJ9fWAsICcqJyk7XG4gICAgICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5hZGRSb3V0ZVRvUm9sZVBvbGljeShmdWxsUm91dGVQYXRoLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBrZWVwIHRyYWNrIG9mIHRoZSBjb250cm9sbGVyIHN0YWNrcyB3aXRoIG1ldGhvZHMgYW5kIHJlc291cmNlcyBpbiBhIG11bHRpLXN0YWNrIHNldHVwIHRvIGNyZWF0ZSBvbmUgZGVwbG95bWVudCBwZXIgY29udHJvbGxlciBzdGFja1xuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IHN0YWNrSW5mbyA9IHRoaXMuY29udHJvbGxlclN0YWNrcy5nZXQoY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICBpZiAoc3RhY2tJbmZvKSB7XG4gICAgICAgICAgICAgICAgc3RhY2tJbmZvLm1ldGhvZHMgPSBbIC4uLnRoaXMubWV0aG9kcyBdO1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5yZXNvdXJjZXMgPSBbIC4uLnRoaXMucmVzb3VyY2VzIF07XG4gICAgICAgICAgICAgICAgc3RhY2tJbmZvLmNvbnRyb2xsZXJzSGFzaC5wdXNoKGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShKU09OLnN0cmluZ2lmeShjb250cm9sbGVyQ29uZmlnKSkuZGlnZXN0KCdoZXgnKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBvdXRwdXQgdGhlIGFwaSBlbmRwb2ludFxuICAgICAgICB0aGlzLm91dHB1dEFwaUVuZHBvaW50KGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyUmVzb3VyY2UsIHRoaXMuZ2V0U3RhZ2VOYW1lKCksIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0U3RhZ2VOYW1lID0gKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpT3B0aW9ucz8uZGVwbG95T3B0aW9ucz8uc3RhZ2VOYW1lIHx8ICdwcm9kJztcbiAgICB9XG5cbiAgICAvLyBpZiB0aGUgQVBJIGlzIGltcG9ydGVkLCB0aGVuIGNyZWF0ZSBvbmUgZGVwbG95bWVudCBwZXIgY29udHJvbGxlciBzdGFjayBhbmQgYWRkIG1ldGhvZCBhbmQgcmVzb3VyY2UgYXMgZGVwZW5kZW5jeVxuICAgIC8vIFRoaXMgaXMgbmVlZGVkIGJlY2F1c2UgaW1wb3J0ZWQgQVBJIGRvZXMgbm90IHByb3BvZ2F0ZSBDT1JTIHNldHRpbmdzIHRvIHRoZSBtZXRob2RzXG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVEZXBsb3ltZW50cygpIHtcblxuICAgICAgICBjb25zdCBzdGFnZU5hbWUgPSB0aGlzLmdldFN0YWdlTmFtZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IFsgY29udHJvbGxlclN0YWNrTmFtZSwgeyBtZXRob2RzLCByZXNvdXJjZXMsIGNvbnRyb2xsZXJzSGFzaCB9IF0gb2YgdGhpcy5jb250cm9sbGVyU3RhY2tzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgLy8gVE9ETzogYWRkIGJldHRlciBsb2dpYyB0byBmb3JjZSBhIGRlcGxveW1lbnQgd2hlbiB0aGVyZSBpcyBhIGNoYW5nZSBpbiBmcmFtZXdvcmsgY29kZVxuICAgICAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZvcmNlRGVwbG95bWVudCkge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzSGFzaC5wdXNoKHJhbmRvbVVVSUQoKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJIYXNoID0gY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEpTT04uc3RyaW5naWZ5KGNvbnRyb2xsZXJzSGFzaCkpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3JlYXRpbmcgZGVwbG95bWVudCBmb3IgY29udHJvbGxlciBzdGFjayAke2NvbnRyb2xsZXJTdGFja05hbWV9IHdpdGggaGFzaCAke2NvbnRyb2xsZXJIYXNofWApO1xuICAgICAgICAgICAgY29uc3QgZGVwbG95bWVudCA9IG5ldyBEZXBsb3ltZW50KHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYGRlcGxveW1lbnQtJHtjb250cm9sbGVySGFzaH1gLCB7XG4gICAgICAgICAgICAgICAgYXBpOiB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGksXG4gICAgICAgICAgICAgICAgc3RhZ2VOYW1lOiBzdGFnZU5hbWUsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBtZXRob2Qgb2YgbWV0aG9kcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgbWV0aG9kIGRlcGVuZGVuY3kgJHttZXRob2QuaHR0cE1ldGhvZH0gJHttZXRob2QucmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KG1ldGhvZClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gYWRkIGRlcGVuZGVjeSBvbiBhbGwgcmVzb3VyY2VzIGZvciB0aGlzIGNvbnRyb2xsZXJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyByZXNvdXJjZSBkZXBlbmRlbmN5ICR7cmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KHJlc291cmNlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gaWYgdGhlIGFwaSBpcyBpbXBvcnRlZCBhbmQgaXQncyBub3QgYSBtdWx0aS1zdGFjayBzZXR1cCwgdGhlbiBjcmVhdGUgYSBzaW5nbGUgZGVwbG95bWVudCBmb3IgYWxsIGNvbnRyb2xsZXJzXG4gICAgLy8gU2luZ2xlIGRlcGxveW1lbnQgaXMgbmVlZGVkIHRvIGF2b2lkIHNpbXVsdGF0aW9uIGRlcGxveW1lbnQgd2hpY2ggY2F1c2VzIGVycm9yIG9uIEFQSSBHYXRld2F5XG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVTaW5nbGVEZXBsb3ltZW50KCkge1xuICAgICAgICBjb25zdCBzdGFnZU5hbWUgPSB0aGlzLmdldFN0YWdlTmFtZSgpO1xuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZm9yY2VEZXBsb3ltZW50KSB7XG4gICAgICAgICAgICB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZm9yRWFjaChjID0+IGMuY29udHJvbGxlcnNIYXNoLnB1c2gocmFuZG9tVVVJRCgpKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY3JlYXRlIHRoZSBuYW1lIGZyb20gYWxsIHRoZSBjb250cm9sbGVyIGhhc2ggdmFsdWVzIGNvbWJpbmVkIGFzIGEgc2luZ2xlIGhhc2ggYW5kIGFkZCBkZXBlbmRlbmN5IG9uIGFsbCB0aGUgY29udHJvbGxlcnNcbiAgICAgICAgY29uc3QgZGVwbG95bWVudE5hbWUgPSBgZGVwbG95bWVudC0ke2NyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShBcnJheS5mcm9tKHRoaXMuY29udHJvbGxlclN0YWNrcy52YWx1ZXMoKSkubWFwKGMgPT4gYy5jb250cm9sbGVyc0hhc2gpLmpvaW4oJy0nKSkuZGlnZXN0KCdoZXgnKX1gO1xuXG4gICAgICAgIGNvbnN0IGRlcGxveW1lbnQgPSBuZXcgRGVwbG95bWVudCh0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5uYW1lKSwgZGVwbG95bWVudE5hbWUsIHtcbiAgICAgICAgICAgIGFwaTogdGhpcy5hcGksXG4gICAgICAgICAgICBzdGFnZU5hbWU6IHN0YWdlTmFtZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzLCBjb250cm9sbGVyc0hhc2ggfSBdIG9mIHRoaXMuY29udHJvbGxlclN0YWNrcy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgbWV0aG9kIG9mIG1ldGhvZHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIG1ldGhvZCBkZXBlbmRlbmN5ICR7bWV0aG9kLmh0dHBNZXRob2R9ICR7bWV0aG9kLnJlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShtZXRob2QpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyByZXNvdXJjZSBkZXBlbmRlbmN5ICR7cmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KHJlc291cmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTogQ29yc09wdGlvbnMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcbiAgICAgICAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIixcbiAgICAgICAgICAgICAgICBcIlgtQXBpLUtleVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotRGF0ZVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotQ29udGVudC1TaGEyNTZcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LVNlY3VyaXR5LVRva2VuXCIsXG4gICAgICAgICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFsc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIsXG4gICAgICAgICAgICAgICAgXCJJbXBlcnNvbmF0aW5nLVVzZXItU3ViXCIsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWxsb3dNZXRob2RzOiBbIFwiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiIF0sXG4gICAgICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxuICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiB0aGlzLmdldENvcnNPcmlnaW5zKCksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRDb3JzT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSB0cnVlKSByZXR1cm4gQ29ycy5BTExfT1JJR0lOUztcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSBcInN0cmluZ1wiKSByZXR1cm4gWyB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIF07XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIHx8IFtdO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0T3JDcmVhdGVDb250cm9sbGVyUmVzb3VyY2UgPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogSVJlc291cmNlID0+IHtcbiAgICAgICAgbGV0IHJlc3RBUEkgPSB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJSZXNvdXJjZTogSVJlc291cmNlID0gcmVzdEFQSS5hcGkucm9vdDtcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBjb250cm9sbGVyTmFtZS5zcGxpdCgnLycpO1xuICAgICAgICBmb3IgKGNvbnN0IHBhdGhQYXJ0IG9mIHBhdGhQYXJ0cykge1xuICAgICAgICAgICAgbGV0IGNoaWxkUmVzb3VyY2UgPSBjb250cm9sbGVyUmVzb3VyY2UuZ2V0UmVzb3VyY2UocGF0aFBhcnQpIGFzIElSZXNvdXJjZTtcbiAgICAgICAgICAgIC8vIGlmIGl0J3MgYSBuZXN0ZWQgY29udHJvbGxlciwgdGhlIHJvb3QgcmVzb3VyY2UgbWF5IG5vdCBiZSBjcmVhdGVkIGluIGFub3RoZXIgc3RhY2tcbiAgICAgICAgICAgIGNvbnN0IGlzTmVzdGVkQ29udHJvbGxlciA9IHBhdGhQYXJ0cy5sZW5ndGggPiAxO1xuICAgICAgICAgICAgaWYgKCFjaGlsZFJlc291cmNlICYmIGlzTmVzdGVkQ29udHJvbGxlciAmJiBwYXRoUGFydCA9PT0gcGF0aFBhcnRzWyAwIF0pIHtcbiAgICAgICAgICAgICAgICAvLyB0cnkgdG8gZ2V0IHRoZSByb290IHJlc291cmNlIGZyb20gdGhlIGZ3MjQgb3V0cHV0XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEdldHRpbmcgY29udHJvbGxlciByZXNvdXJjZSBmb3IgJHtwYXRoUGFydH0gZnJvbSBmdzI0IG91dHB1dGApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJSZXNvdXJjZUlkID0gdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoYHJlc3RBUElfY29udHJvbGxlcl8ke3BhdGhQYXJ0fV9yZXNvdXJjZUlkYCwgJ3Jlc291cmNlJywgY3VycmVudFN0YWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoY29udHJvbGxlclJlc291cmNlSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvbnRyb2xsZXIgcmVzb3VyY2UgZm9yICR7cGF0aFBhcnR9IGZvdW5kIGluIGZ3MjQgb3V0cHV0OiAke2NvbnRyb2xsZXJSZXNvdXJjZUlkfWApO1xuICAgICAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gUmVzb3VyY2UuZnJvbVJlc291cmNlQXR0cmlidXRlcyhjdXJyZW50U3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2NvbnRyb2xsZXJTdGFja05hbWV9LSR7cGF0aFBhcnR9YCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VJZDogY29udHJvbGxlclJlc291cmNlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN0QXBpOiByZXN0QVBJLmFwaSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6ICcvJyArIHBhdGhQYXJ0XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSkge1xuICAgICAgICAgICAgICAgIC8vIGZvciBuZXN0ZWQgcmVzb3VyY2VzIGFkZCAvIHRvIHRoZSBwYXRoXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGNvbnRyb2xsZXIgcmVzb3VyY2UgZm9yIHBhdGggJHtwYXRoUGFydH0gdW5kZXIgJHtjb250cm9sbGVyUmVzb3VyY2UucGF0aH1gKTtcbiAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gY29udHJvbGxlclJlc291cmNlLmFkZFJlc291cmNlKHBhdGhQYXJ0KSBhcyBJUmVzb3VyY2U7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoaXNOZXN0ZWRDb250cm9sbGVyICYmIHBhdGhQYXJ0ID09PSBwYXRoUGFydHNbIDAgXSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU2V0dGluZyBvdXRwdXQgZm9yIGNvbnRvcmxsZXIgcmVzb3VyY2UgJHtjb250cm9sbGVyU3RhY2tOYW1lfSBwYXRoICR7cGF0aFBhcnR9YCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYHJlc3RBUElfY29udHJvbGxlcl8ke3BhdGhQYXJ0fWAsIGNoaWxkUmVzb3VyY2UsIE91dHB1dFR5cGUuUkVTT1VSQ0UsICdyZXNvdXJjZUlkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udHJvbGxlclJlc291cmNlID0gY2hpbGRSZXNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjb250cm9sbGVyUmVzb3VyY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVMYW1iZGFGdW5jdGlvbiA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogTm9kZWpzRnVuY3Rpb24gPT4ge1xuICAgICAgICBjb25zdCBmdW5jdGlvblByb3BzID0geyAuLi50aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzLCAuLi5jb250cm9sbGVyQ29uZmlnPy5mdW5jdGlvblByb3BzIH07XG5cbiAgICAgICAgY29uc3QgZW52VmFyaWFibGVzID0gdGhpcy5mdzI0LnJlc29sdmVFbnZWYXJpYWJsZXMoY29udHJvbGxlckNvbmZpZy5lbnYsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSk7XG5cbiAgICAgICAgLy8gZG8gbm90IG92ZXJyaWRlIHRoZSBlbnRyeSBwYWNrYWdlcyBpZiBhbHJlYWR5IHNldFxuICAgICAgICBpZiAoIShFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyBpbiBlbnZWYXJpYWJsZXMpICYmIGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcykge1xuICAgICAgICAgICAgZW52VmFyaWFibGVzWyBFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyBdID0gKGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyBhcyBBcnJheTxzdHJpbmc+KS5qb2luKCcsJyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgY29udHJvbGxlck5hbWUgKyBcIi1jb250cm9sbGVyXCIsIHtcbiAgICAgICAgICAgIGVudHJ5OiBmaWxlUGF0aCArIFwiL1wiICsgZmlsZU5hbWUsXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczogZW52VmFyaWFibGVzLFxuICAgICAgICAgICAgcG9saWNpZXM6IGNvbnRyb2xsZXJDb25maWc/LnBvbGljaWVzLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IGNvbnRyb2xsZXJDb25maWc/LnJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgYWxsb3dTZW5kRW1haWw6IHRydWUsXG4gICAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IGNvbnRyb2xsZXJDb25maWc/LmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgcHJvY2Vzc29yQXJjaGl0ZWN0dXJlOiBjb250cm9sbGVyQ29uZmlnPy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiBmdW5jdGlvblByb3BzLFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzLFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICB9XG5cbiAgICBwcml2YXRlIGV4dHJhY3REZWZhdWx0QXV0aG9yaXplciA9IChjb250cm9sbGVyQ29uZmlnOiBhbnkpOiB7IGRlZmF1bHRBdXRob3JpemVyTmFtZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplclR5cGU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IHRoaXMuZncyNC5nZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKCk7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgbGV0IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29udHJvbGxlckNvbmZpZz8uYXV0aG9yaXplcikpIHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRBdXRob3JpemVyID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLmZpbmQoKGF1dGg6IGFueSkgPT4gYXV0aC5kZWZhdWx0KSB8fCBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXJbIDAgXTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IGRlZmF1bHRBdXRob3JpemVyLm5hbWUgfHwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXIuZ3JvdXBzIHx8IFtdO1xuICAgICAgICAgICAgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0QXV0aG9yaXplci5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLmdyb3VwcyB8fCBbXTtcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gY29udHJvbGxlckNvbmZpZy5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFkZWZhdWx0QXV0aG9yaXplclR5cGUgJiYgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSkge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChkZWZhdWx0QXV0aG9yaXplckdyb3Vwcykge1xuXG4gICAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgZm9yIHRoZSBncm91cHMgaXMgYSB0ZW1wbGF0ZSBzdHJpbmcsIFxuICAgICAgICAgICAgLy8gcmVzb2x2ZSBpdCBbd2hlbiB0aGUgYXBwbGljYXRpb24gd2FudCB0byBhbGxvdyBtdWx0aXBsZSB1c2VyIGdyb3VwcyB0byBoYXZlIGFjY2Vzc11cbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgXCJlbnY6eHh4Omdyb3VwMVwiID09PiBcImdyb3VwMS1yZXNvbHZlZFwiIHx8IFwiZ3JvdXAxLGdyb3VwMlwiIHx8IFwiZW52Onh4eDpncm91cDEsZW52Onh4eDpncm91cDJcIlxuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSkge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gdGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShkZWZhdWx0QXV0aG9yaXplckdyb3VwcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIG5vdyBpZiB0aGUgcmVzb2x2ZWQgdmFsdWUgaXMgYWdhaW4gYSBzdHJpbmcsIHNwbGl0IGl0IGJ5IGNvbW1hXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFwiZ3JvdXAxLGdyb3VwMlwiID09PiBbXCJncm91cDFcIiwgXCJncm91cDJcIl1cbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhkZWZhdWx0QXV0aG9yaXplckdyb3VwcykpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLnNwbGl0KCcsJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMubGVuZ3RoICYmIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHMpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHJlc29sdmUgdGhlIGdyb3VwIG5hbWVzIGZyb20gZncyNC1zY29wZSBpZiBpdCdzIGEgdGVtcGxhdGVcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgW1wiZW52Onh4eDpncm91cDFcIixcImVudjp4eHg6Z3JvdXAyXCJdID09PiBbXCJncm91cDEtcmVzb2x2ZWRcIiwgXCJncm91cDItcmVzb2x2ZWRcIl1cbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzIGFzIEFycmF5PHN0cmluZz4pLm1hcCh0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKTtcblxuICAgICAgICAgICAgLy8gZmxhdC1tYXAgdGhlIGdyb3VwcyBpZiB0aGV5IHJlc29sdmVkIGdyb3VwIHZhbHVlcyBhcmUgYWdhaW4gY29tbWEgc2VwYXJhdGVkXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSByZXNvbHZlZCB2YWx1ZSBpcyBsaWtlIFtcImEsYlwiLCBcImMsZFwiXSA9PT4gW1wiYVwiLCBcImJcIiwgXCJjXCIsIFwiZFwiXVxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSAoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgYXMgQXJyYXk8c3RyaW5nPikuZmxhdE1hcCgoZ3JvdXA6IHN0cmluZykgPT4gZ3JvdXAuc3BsaXQoJywnKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRPckNyZWF0ZVJvdXRlUmVzb3VyY2UgPSAocGFyZW50UmVzb3VyY2U6IElSZXNvdXJjZSwgcGF0aDogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBJUmVzb3VyY2UgPT4ge1xuICAgICAgICBsZXQgY3VycmVudFJlc291cmNlOiBJUmVzb3VyY2UgPSBwYXJlbnRSZXNvdXJjZTtcbiAgICAgICAgY29uc3QgcmVzdEFQSSA9IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGF0aFBhcnQgb2YgcGF0aC5zcGxpdChcIi9cIikpIHtcbiAgICAgICAgICAgIGlmIChwYXRoUGFydCA9PT0gXCJcIikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgY2hpbGRSZXNvdXJjZSA9IGN1cnJlbnRSZXNvdXJjZS5nZXRSZXNvdXJjZShwYXRoUGFydCk7XG4gICAgICAgICAgICBpZiAoIWNoaWxkUmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gY3VycmVudFJlc291cmNlLmFkZFJlc291cmNlKHBhdGhQYXJ0KTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdEFQSS5pc0ltcG9ydGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvcnNQcmVmbGlnaHRNZXRob2QgPSBjaGlsZFJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQodGhpcy5nZXRDb3JzUHJlZmxpZ2h0T3B0aW9ucygpKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5tZXRob2RzLnB1c2goY29yc1ByZWZsaWdodE1ldGhvZCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzb3VyY2VzLnB1c2goY2hpbGRSZXNvdXJjZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY3VycmVudFJlc291cmNlID0gY2hpbGRSZXNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjdXJyZW50UmVzb3VyY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBleHRyYWN0Um91dGVBdXRob3JpemVyID0gKHJvdXRlOiBhbnksIGRlZmF1bHRBdXRob3JpemVyVHlwZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbik6IHsgcm91dGVBdXRob3JpemVyTmFtZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplck5hbWUgPSBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcblxuICAgICAgICBpZiAocm91dGUuYXV0aG9yaXplciAmJiB0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyLnR5cGUgfHwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyTmFtZSA9IHJvdXRlLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJHcm91cHMgPSByb3V0ZS5hdXRob3JpemVyLmdyb3VwcyB8fCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgICAgIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IHJvdXRlLmF1dGhvcml6ZXIucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVBdXRob3JpemVyTmFtZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZU1ldGhvZE9wdGlvbnMgPSAocm91dGU6IGFueSwgcm91dGVBdXRob3JpemVyVHlwZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnKTogTWV0aG9kT3B0aW9ucyA9PiB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RQYXJhbWV0ZXJzOiB7IFsga2V5OiBzdHJpbmcgXTogYm9vbGVhbiB9ID0ge307XG5cbiAgICAgICAgLy8gQWRkIHBhdGggcGFyYW1ldGVyc1xuICAgICAgICBmb3IgKGNvbnN0IHBhcmFtIG9mIHJvdXRlLnBhcmFtZXRlcnMgfHwgW10pIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzWyBgbWV0aG9kLnJlcXVlc3QucGF0aC4ke3BhcmFtfWAgXSA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgQVBJIGtleSBoZWFkZXIgcmVxdWlyZW1lbnQgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkpIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzWyAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLngtYXBpLWtleScgXSA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiB0aGUgYXV0aG9yaXplciBpcyBKV1QsIGNvbnZlcnQgaXQgdG8gQ1VTVE9NXG4gICAgICAgIGNvbnN0IGF1dGhvcml6ZXIgPSB0aGlzLmZ3MjQuZ2V0QXV0aG9yaXplcihyb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJOYW1lKTtcbiAgICAgICAgaWYgKHJvdXRlQXV0aG9yaXplclR5cGUgPT09ICdKV1QnKSB7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJUeXBlID0gJ0NVU1RPTSc7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnMsXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogcm91dGVBdXRob3JpemVyVHlwZSBhcyBBdXRob3JpemF0aW9uVHlwZSxcbiAgICAgICAgICAgIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIsXG4gICAgICAgICAgICBhcGlLZXlSZXF1aXJlZDogY29udHJvbGxlckNvbmZpZy5yZXF1aXJlQXBpS2V5IHx8IGZhbHNlXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVTUVNJbnRlZ3JhdGlvbiA9IChxdWV1ZU5hbWU6IHN0cmluZywgY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogQXdzSW50ZWdyYXRpb24gPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3JlYXRpbmcgU1FTIGludGVncmF0aW9uIGZvciBxdWV1ZSAke3F1ZXVlTmFtZX0gaW4gY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfSBpbiBzdGFjayAke2NvbnRyb2xsZXJTdGFja05hbWV9YCk7XG4gICAgICAgIGNvbnN0IGludGVncmF0aW9uUm9sZSA9IG5ldyBSb2xlKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7cXVldWVOYW1lfS1zcXMtaW50ZWdyYXRpb24tcm9sZWAsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBxdWV1ZUFybiA9IHRoaXMuZncyNC5nZXRBcm4oJ3NxcycsIHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlSW5zdGFuY2UgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHtxdWV1ZU5hbWV9LXF1ZXVlYCwgcXVldWVBcm4pO1xuICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50U2VuZE1lc3NhZ2VzKGludGVncmF0aW9uUm9sZSk7XG4gICAgICAgIHJldHVybiBuZXcgQXdzSW50ZWdyYXRpb24oe1xuICAgICAgICAgICAgc2VydmljZTogXCJzcXNcIixcbiAgICAgICAgICAgIHBhdGg6IHRoaXMuZncyNC5nZXRDb25maWcoKS5hY2NvdW50ICsgXCIvXCIgKyBxdWV1ZUluc3RhbmNlLnF1ZXVlTmFtZSxcbiAgICAgICAgICAgIGludGVncmF0aW9uSHR0cE1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY3JlZGVudGlhbHNSb2xlOiBpbnRlZ3JhdGlvblJvbGUsXG4gICAgICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJpbnRlZ3JhdGlvbi5yZXF1ZXN0LmhlYWRlci5Db250ZW50LVR5cGVcIjogXCInYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJ1wiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVxdWVzdFRlbXBsYXRlczoge1xuICAgICAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL2pzb25cIjogYEFjdGlvbj1TZW5kTWVzc2FnZSZNZXNzYWdlQm9keT0kdXRpbC51cmxFbmNvZGUoJGlucHV0LmJvZHkpYCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlU05TSW50ZWdyYXRpb24gPSAodG9waWNOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IEF3c0ludGVncmF0aW9uID0+IHtcbiAgICAgICAgY29uc3QgaW50ZWdyYXRpb25Sb2xlID0gbmV3IFJvbGUodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHt0b3BpY05hbWV9LXNucy1pbnRlZ3JhdGlvbi1yb2xlYCwge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHRvcGljQXJuID0gdGhpcy5mdzI0LmdldEFybignc25zJywgdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUodG9waWNOYW1lICsgJ190b3BpY05hbWUnLCAndG9waWMnLCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpKTtcbiAgICAgICAgY29uc3QgdG9waWNJbnN0YW5jZSA9IFRvcGljLmZyb21Ub3BpY0Fybih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3RvcGljTmFtZX0tdG9waWNgLCB0b3BpY0Fybik7XG4gICAgICAgIHRvcGljSW5zdGFuY2UuZ3JhbnRQdWJsaXNoKGludGVncmF0aW9uUm9sZSk7XG4gICAgICAgIHJldHVybiBuZXcgQXdzSW50ZWdyYXRpb24oe1xuICAgICAgICAgICAgc2VydmljZTogXCJzbnNcIixcbiAgICAgICAgICAgIHBhdGg6ICcvJyxcbiAgICAgICAgICAgIGludGVncmF0aW9uSHR0cE1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY3JlZGVudGlhbHNSb2xlOiBpbnRlZ3JhdGlvblJvbGUsXG4gICAgICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJpbnRlZ3JhdGlvbi5yZXF1ZXN0LmhlYWRlci5Db250ZW50LVR5cGVcIjogXCInYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJ1wiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVxdWVzdFRlbXBsYXRlczoge1xuICAgICAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL2pzb25cIjogYEFjdGlvbj1QdWJsaXNoJlRvcGljQXJuPSR1dGlsLnVybEVuY29kZShcXCcke3RvcGljSW5zdGFuY2UudG9waWNBcm59XFwnKSZNZXNzYWdlPSR1dGlsLnVybEVuY29kZSgkaW5wdXQuYm9keSlgLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBvdXRwdXRBcGlFbmRwb2ludCA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyUmVzb3VyY2U6IElSZXNvdXJjZSwgc3RhZ2VOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZykgPT4ge1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYEVuZHBvaW50JHtjb250cm9sbGVyTmFtZX1gLCB7XG4gICAgICAgICAgICB2YWx1ZTogJ2h0dHBzOi8vJyArIHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaS5yZXN0QXBpSWQgKyAnLmV4ZWN1dGUtYXBpLicgKyB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkucmVnaW9uICsgJy5hbWF6b25hd3MuY29tLycgKyBzdGFnZU5hbWUgKyAnLycgKyBjb250cm9sbGVyUmVzb3VyY2UucGF0aC5zbGljZSgxKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBHYXRld2F5IEVuZHBvaW50IGZvciBcIiArIGNvbnRyb2xsZXJOYW1lLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNldHVwVXNhZ2VQbGFuKHBsYW5Db25maWc/OiBJVXNhZ2VQbGFuQ29uZmlnLCBjcmVhdGVLZXk6IGJvb2xlYW4gPSBmYWxzZSk6IHsgcGxhbjogVXNhZ2VQbGFuOyBuYW1lOiBzdHJpbmcgfSB7XG4gICAgICAgIC8vIElmIG5vIHBsYW4gY29uZmlnIGlzIHByb3ZpZGVkIGFuZCB3ZSBuZWVkIGEga2V5LCB1c2UgdGhlIGZpcnN0IGNvbmZpZ3VyZWQgcGxhbiBvciBjcmVhdGUgYSBkZWZhdWx0IG9uZVxuICAgICAgICBpZiAoIXBsYW5Db25maWcgJiYgY3JlYXRlS2V5KSB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gdXNlIHRoZSBmaXJzdCBjb25maWd1cmVkIHBsYW4gdGhhdCBoYXMgQVBJIGtleXNcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZ3VyZWRQbGFuID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucz8uZmluZChwbGFuID0+IHBsYW4uYXBpS2V5cyk7XG4gICAgICAgICAgICBpZiAoY29uZmlndXJlZFBsYW4pIHtcbiAgICAgICAgICAgICAgICBwbGFuQ29uZmlnID0gY29uZmlndXJlZFBsYW47XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIElmIG5vIGNvbmZpZ3VyZWQgcGxhbiB3aXRoIGtleXMgZXhpc3RzLCBjcmVhdGUgYSBkZWZhdWx0IHBsYW5cbiAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBhIGRldGVybWluaXN0aWMga2V5IGJhc2VkIG9uIGFwcCBuYW1lIGFuZCBhIGZpeGVkIGlkZW50aWZpZXJcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0S2V5ID0gY3JlYXRlSGFzaCgnc2hhMjU2JylcbiAgICAgICAgICAgICAgICAgICAgLnVwZGF0ZShgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudH0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkucmVnaW9ufS0ke3RoaXMuZncyNC5nZXRDb25maWcoKS5lbnZpcm9ubWVudH0tZGVmYXVsdC1hcGkta2V5YClcbiAgICAgICAgICAgICAgICAgICAgLmRpZ2VzdCgnaGV4JylcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDMyKTsgLy8gVXNlIGZpcnN0IDMyIGNoYXJzIGZvciBhIHJlYXNvbmFibGUga2V5IGxlbmd0aFxuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gdXNhZ2UgcGxhbiB3aXRoIEFQSSBrZXlzIGZvdW5kLCBjcmVhdGluZyBhIGRlZmF1bHQgb25lLiBUaGlzIGlzIG5vdCByZWNvbW1lbmRlZCBmb3IgcHJvZHVjdGlvbiBlbnZpcm9ubWVudHMuIFBsZWFzZSBjb25maWd1cmUgYSB1c2FnZSBwbGFuIHdpdGggQVBJIGtleXMgZm9yIHlvdXIgQVBJLmApO1xuXG4gICAgICAgICAgICAgICAgcGxhbkNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWRlZmF1bHQtdXNhZ2UtcGxhbmAsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgRGVmYXVsdCB1c2FnZSBwbGFuIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleXM6IFsgZGVmYXVsdEtleSBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGxhbk5hbWUgPSBwbGFuQ29uZmlnPy5uYW1lIHx8IGAke3RoaXMuZncyNC5hcHBOYW1lfS1kZWZhdWx0LXVzYWdlLXBsYW5gO1xuXG4gICAgICAgIGlmICghdGhpcy51c2FnZVBsYW5zLmhhcyhwbGFuTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFNldHRpbmcgdXAgdXNhZ2UgcGxhbjogJHtwbGFuTmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0IHVzYWdlUGxhbiA9IG5ldyBVc2FnZVBsYW4odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3BsYW5OYW1lfS11c2FnZS1wbGFuYCwge1xuICAgICAgICAgICAgICAgIG5hbWU6IHBsYW5OYW1lLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBwbGFuQ29uZmlnPy5kZXNjcmlwdGlvbiB8fCBgVXNhZ2UgcGxhbiBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgIGFwaVN0YWdlczogWyB7XG4gICAgICAgICAgICAgICAgICAgIGFwaTogdGhpcy5hcGksXG4gICAgICAgICAgICAgICAgICAgIHN0YWdlOiB0aGlzLmFwaS5kZXBsb3ltZW50U3RhZ2VcbiAgICAgICAgICAgICAgICB9IF0sXG4gICAgICAgICAgICAgICAgdGhyb3R0bGU6IHtcbiAgICAgICAgICAgICAgICAgICAgcmF0ZUxpbWl0OiBwbGFuQ29uZmlnPy5yYXRlTGltaXQgfHwgMTAsXG4gICAgICAgICAgICAgICAgICAgIGJ1cnN0TGltaXQ6IHBsYW5Db25maWc/LmJ1cnN0TGltaXQgfHwgMjBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHF1b3RhOiB7XG4gICAgICAgICAgICAgICAgICAgIGxpbWl0OiBwbGFuQ29uZmlnPy5xdW90YUxpbWl0IHx8IDEwMDAwLFxuICAgICAgICAgICAgICAgICAgICBwZXJpb2Q6IHBsYW5Db25maWc/LnF1b3RhUGVyaW9kIHx8IFBlcmlvZC5NT05USFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy51c2FnZVBsYW5zLnNldChwbGFuTmFtZSwgeyBwbGFuOiB1c2FnZVBsYW4sIG5hbWU6IHBsYW5OYW1lIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGlLZXlzLnNldChwbGFuTmFtZSwgW10pO1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgQVBJIGtleXMgaWYgY29uZmlndXJlZCBmb3IgdGhpcyB1c2FnZSBwbGFuXG4gICAgICAgICAgICBpZiAocGxhbkNvbmZpZz8uYXBpS2V5cykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENyZWF0aW5nIEFQSSBrZXlzIGZvciB1c2FnZSBwbGFuOiAke3BsYW5OYW1lfWApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGtleXMgPSBwbGFuQ29uZmlnLmFwaUtleXMua2V5cyB8fCBbXTtcbiAgICAgICAgICAgICAgICBrZXlzLmZvckVhY2goKGtleSwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBrZXkgbmFtZSBmcm9tIGNvbmZpZyBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSB1c2UgdGhlIHByZWZpeCBvciBnZW5lcmF0ZSBhIG5hbWVcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5TmFtZSA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaUtleUNvbmZpZz8ua2V5TmFtZSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgKHBsYW5Db25maWcuYXBpS2V5cz8ua2V5TmFtZVByZWZpeFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYCR7cGxhbkNvbmZpZy5hcGlLZXlzLmtleU5hbWVQcmVmaXh9LSR7aW5kZXh9YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWFwaS1rZXktJHtpbmRleH1gKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBrZXkgYWxyZWFkeSBleGlzdHNcbiAgICAgICAgICAgICAgICAgICAgbGV0IGV4aXN0aW5nS2V5ID0gdGhpcy5rZXlWYWx1ZXMuZ2V0KGtleSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RpbmdLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nS2V5ID0gbmV3IEFwaUtleSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0tYXBpLWtleWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIGtleSAke2luZGV4ICsgMX0gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZToga2V5XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0taWRgLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGV4aXN0aW5nS2V5LmtleUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIEtleSAke2luZGV4ICsgMX0gSUQgZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMua2V5VmFsdWVzLnNldChrZXksIGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHVzYWdlUGxhbi5hZGRBcGlLZXkoZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmFwaUtleXMuZ2V0KHBsYW5OYW1lKSEucHVzaChleGlzdGluZ0tleSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy51c2FnZVBsYW5zLmdldChwbGFuTmFtZSkhO1xuICAgIH1cblxuICAgIHByaXZhdGUgZXh0cmFjdENvbnRyb2xsZXJDb25maWdGcm9tTWFuaWZlc3QoY2FwYWJpbGl0eTogQ2FwYWJpbGl0eURlc2NyaXB0b3IpOiBJQ29udHJvbGxlckNvbmZpZyB7XG4gICAgICAgIC8vIEV4dHJhY3QgY29udHJvbGxlciBjb25maWcgZnJvbSBtYW5pZmVzdCBjYXBhYmlsaXR5XG4gICAgICAgIC8vIFRoaXMgaXMgYSBzaW1wbGlmaWVkIHZlcnNpb24gLSBpbiBmdWxsIGltcGxlbWVudGF0aW9uIHdvdWxkIGhhbmRsZSBhbGwgY29uZmlnIG9wdGlvbnNcbiAgICAgICAgY29uc3QgY29uZmlnOiBJQ29udHJvbGxlckNvbmZpZyA9IHt9O1xuICAgICAgICBcbiAgICAgICAgaWYgKGNhcGFiaWxpdHkucmVxdWlyZXM/LnJlc291cmNlSW50ZW50cykge1xuICAgICAgICAgICAgLy8gQ29udmVydCByZXNvdXJjZSBpbnRlbnRzIHRvIGxlZ2FjeSByZXNvdXJjZUFjY2VzcyBmb3JtYXRcbiAgICAgICAgICAgIGNvbnN0IHJlc291cmNlQWNjZXNzOiBhbnkgPSB7fTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZm9yIChjb25zdCBpbnRlbnQgb2YgY2FwYWJpbGl0eS5yZXF1aXJlcy5yZXNvdXJjZUludGVudHMpIHtcbiAgICAgICAgICAgICAgICBpZiAoaW50ZW50LmtpbmQgPT09ICd0YWJsZScpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFyZXNvdXJjZUFjY2Vzcy50YWJsZXMpIHJlc291cmNlQWNjZXNzLnRhYmxlcyA9IFtdO1xuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZUFjY2Vzcy50YWJsZXMucHVzaChpbnRlbnQubmFtZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIEFkZCBvdGhlciByZXNvdXJjZSB0eXBlcyBhcyBuZWVkZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uZmlnLnJlc291cmNlQWNjZXNzID0gcmVzb3VyY2VBY2Nlc3M7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBjb25maWc7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBleHRyYWN0Um91dGVzRnJvbU1hbmlmZXN0KGNhcGFiaWxpdHk6IENhcGFiaWxpdHlEZXNjcmlwdG9yKTogUmVjb3JkPHN0cmluZywgUm91dGU+IHtcbiAgICAgICAgY29uc3Qgcm91dGVzOiBSZWNvcmQ8c3RyaW5nLCBSb3V0ZT4gPSB7fTtcbiAgICAgICAgXG4gICAgICAgIGlmIChjYXBhYmlsaXR5LnJvdXRpbmc/LnJvdXRlcykge1xuICAgICAgICAgICAgZm9yIChjb25zdCByb3V0ZSBvZiBjYXBhYmlsaXR5LnJvdXRpbmcucm91dGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgcm91dGVLZXkgPSBgJHtyb3V0ZS5tZXRob2QudG9Mb3dlckNhc2UoKX0ke3JvdXRlLnBhdGh9YDtcbiAgICAgICAgICAgICAgICByb3V0ZXNbcm91dGVLZXldID0ge1xuICAgICAgICAgICAgICAgICAgICBodHRwTWV0aG9kOiByb3V0ZS5tZXRob2QsXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uTmFtZTogY2FwYWJpbGl0eS5leHBvcnROYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYXRoOiByb3V0ZS5wYXRoLFxuICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJzOiBbXSwgLy8gRXh0cmFjdCBmcm9tIHBhdGggcGFyYW1ldGVycyBpZiBuZWVkZWRcbiAgICAgICAgICAgICAgICAgICAgYXV0aG9yaXplcjogcm91dGUuYXV0aG9yaXplcixcbiAgICAgICAgICAgICAgICAgICAgdGFyZ2V0OiByb3V0ZS50YXJnZXQgfHwgJ2Z1bmN0aW9uJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiByb3V0ZXM7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBleHRyYWN0RFVDb25maWdGcm9tTWFuaWZlc3QoX2R1OiBEZXBsb3ltZW50VW5pdERlc2NyaXB0b3IsIGNhcGFiaWxpdGllczogQ2FwYWJpbGl0eURlc2NyaXB0b3JbXSk6IElDb250cm9sbGVyQ29uZmlnIHtcbiAgICAgICAgLy8gTWVyZ2UgcmVzb3VyY2UgaW50ZW50cyBmcm9tIGFsbCBjYXBhYmlsaXRpZXMgaW4gdGhlIERVXG4gICAgICAgIGNvbnN0IGFsbEludGVudHMgPSBjYXBhYmlsaXRpZXMuZmxhdE1hcChjYXAgPT4gY2FwLnJlcXVpcmVzPy5yZXNvdXJjZUludGVudHMgfHwgW10pO1xuICAgICAgICBjb25zdCByZXNvdXJjZUFjY2VzcyA9IHRoaXMudHJhbnNsYXRlSW50ZW50c1RvUmVzb3VyY2VBY2Nlc3MoYWxsSW50ZW50cyk7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICAvLyBUT0RPOiBDb252ZXJ0IERVIGZ1bmN0aW9uUHJvcHMgdG8gcHJvcGVyIGZvcm1hdFxuICAgICAgICAgICAgLy8gVE9ETzogQ29udmVydCBEVSBlbnYgdG8gcHJvcGVyIGZvcm1hdFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgZXh0cmFjdERVUm91dGVzRnJvbU1hbmlmZXN0KGNhcGFiaWxpdGllczogQ2FwYWJpbGl0eURlc2NyaXB0b3JbXSk6IFJlY29yZDxzdHJpbmcsIFJvdXRlPiB7XG4gICAgICAgIGNvbnN0IHJvdXRlczogUmVjb3JkPHN0cmluZywgUm91dGU+ID0ge307XG4gICAgICAgIFxuICAgICAgICBmb3IgKGNvbnN0IGNhcGFiaWxpdHkgb2YgY2FwYWJpbGl0aWVzKSB7XG4gICAgICAgICAgICBpZiAoY2FwYWJpbGl0eS5raW5kID09PSAnY29udHJvbGxlcicgJiYgY2FwYWJpbGl0eS5yb3V0aW5nPy5yb3V0ZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IGNhcGFiaWxpdHkucm91dGluZy5iYXNlUGF0aCB8fCAnJztcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHJvdXRlIG9mIGNhcGFiaWxpdHkucm91dGluZy5yb3V0ZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZnVsbFBhdGggPSBgJHtiYXNlUGF0aH0ke3JvdXRlLnBhdGh9YDtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgcm91dGVLZXkgPSBgJHtyb3V0ZS5tZXRob2R9fCR7ZnVsbFBhdGh9YDtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIHJvdXRlc1tyb3V0ZUtleV0gPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBodHRwTWV0aG9kOiByb3V0ZS5tZXRob2QsXG4gICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvbk5hbWU6IGNhcGFiaWxpdHkuZXhwb3J0TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IGZ1bGxQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgYXV0aG9yaXplcjogcm91dGUuYXV0aG9yaXplcixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldDogcm91dGUudGFyZ2V0IHx8ICdmdW5jdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJhbWV0ZXJzOiBbXSAvLyBUT0RPOiBFeHRyYWN0IHBhcmFtZXRlcnMgZnJvbSByb3V0ZSBwYXRoXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcm91dGVzO1xuICAgIH1cblxuICAgIHByaXZhdGUgdHJhbnNsYXRlSW50ZW50c1RvUmVzb3VyY2VBY2Nlc3MoaW50ZW50czogUmVzb3VyY2VJbnRlbnRbXSk6IGFueSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlQWNjZXNzOiBhbnkgPSB7fTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHRhYmxlcyA9IGludGVudHMuZmlsdGVyKGkgPT4gaS5raW5kID09PSAndGFibGUnKS5tYXAoaSA9PiBpLm5hbWUpO1xuICAgICAgICBjb25zdCBidWNrZXRzID0gaW50ZW50cy5maWx0ZXIoaSA9PiBpLmtpbmQgPT09ICdidWNrZXQnKS5tYXAoaSA9PiBpLm5hbWUpO1xuICAgICAgICBjb25zdCBxdWV1ZXMgPSBpbnRlbnRzLmZpbHRlcihpID0+IGkua2luZCA9PT0gJ3F1ZXVlJykubWFwKGkgPT4gaS5uYW1lKTtcbiAgICAgICAgY29uc3QgdG9waWNzID0gaW50ZW50cy5maWx0ZXIoaSA9PiBpLmtpbmQgPT09ICd0b3BpYycpLm1hcChpID0+IGkubmFtZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAodGFibGVzLmxlbmd0aCA+IDApIHJlc291cmNlQWNjZXNzLnRhYmxlcyA9IHRhYmxlcztcbiAgICAgICAgaWYgKGJ1Y2tldHMubGVuZ3RoID4gMCkgcmVzb3VyY2VBY2Nlc3MuYnVja2V0cyA9IGJ1Y2tldHM7XG4gICAgICAgIGlmIChxdWV1ZXMubGVuZ3RoID4gMCkgcmVzb3VyY2VBY2Nlc3MucXVldWVzID0gcXVldWVzO1xuICAgICAgICBpZiAodG9waWNzLmxlbmd0aCA+IDApIHJlc291cmNlQWNjZXNzLnRvcGljcyA9IHRvcGljcztcbiAgICAgICAgXG4gICAgICAgIHJldHVybiByZXNvdXJjZUFjY2VzcztcbiAgICB9XG5cbn1cbiJdfQ==