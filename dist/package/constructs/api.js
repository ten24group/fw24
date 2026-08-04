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
        if (!currentAPI) {
            throw new Error(`API not found for stack: ${stackName}`);
        }
        return currentAPI;
    };
    async registerControllers() {
        // sets the default controllers directory if not defined
        const controllersDirectory = this.apiConstructConfig.controllersDirectory || "./src/controllers";
        // register the controllers
        await helper_1.Helper.registerHandlers(controllersDirectory, this.registerController);
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
        const deployment = new aws_apigateway_1.Deployment(this.fw24.getStack(this.name), deploymentName, {
            api: this.api,
            stageName: stageName,
        });
        for (const [_controllerStackName, { methods, resources }] of this.controllerStacks.entries()) {
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
                // Tracing/identity headers the framework itself consumes: x-correlation-id and
                // x-caused-by feed correlation propagation, x-actor carries the end-user identity on
                // SigV4-signed calls (see api-gateway-controller). Browsers preflight any request
                // carrying them, so they must be allowed here or every instrumented cross-origin
                // call fails CORS before reaching the backend.
                "X-Correlation-Id",
                "X-Caused-By",
                "X-Actor",
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVNBLCtEQVVvQztBQUVwQyw2Q0FBcUY7QUFFckYsaURBQTZEO0FBRTdELGlEQUE0QztBQUM1QyxpREFBNEM7QUFNNUMsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx1REFBeUY7QUFDekYsd0NBQTBDO0FBRTFDLG9DQUFpQztBQUNqQyx1REFBbUQ7QUFDbkQsNkRBQXlEO0FBNEJ6RCw2Q0FBcUQ7QUFDckQscUNBQThEO0FBQzlELDBEQUE2QjtBQUU3QixrQ0FBbUM7QUFFbkMsb0NBQTZDO0FBQzdDLGlDQUF1QztBQUN2QywrQ0FBcUQ7QUFDckQseUNBQStDO0FBQy9DLG1DQUF5QztBQUN6QyxxQ0FBMkM7QUFDM0MsbUNBQXlDO0FBQ3pDLG1DQUF5QztBQUN6QywrQkFBcUM7QUF3SXJDLE1BQWEsWUFBWTtJQW1CUTtJQWxCcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDekMsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsWUFBWSxDQUFDLElBQUksQ0FBQztJQUNqQyxZQUFZLEdBQWEsQ0FBRSxrQkFBWSxDQUFDLElBQUksRUFBRSx3QkFBZSxDQUFDLElBQUksRUFBRSw0QkFBaUIsQ0FBQyxJQUFJLEVBQUUsb0JBQWEsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLENBQUUsQ0FBQztJQUNoTCxNQUFNLENBQXVCO0lBRTdCLEdBQUcsQ0FBVztJQUNkLFNBQVMsQ0FBUztJQUNsQixVQUFVLEdBQW1ELElBQUksR0FBRyxFQUFFLENBQUM7SUFDdkUsT0FBTyxHQUEwQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lB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QUFJLE9BQU8sS0FBSyxFQUFFOzRCQUNoRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUs7NEJBQ3hCLFdBQVcsRUFBRSxXQUFXLEtBQUssR0FBRyxDQUFDLFdBQVcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7eUJBQ2xFLENBQUMsQ0FBQzt3QkFFSCxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsV0FBVyxDQUFDLENBQUM7b0JBQ3pDLENBQUM7b0JBRUQsU0FBUyxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQztvQkFDakMsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7b0JBQy9DLElBQUksV0FBVyxFQUFFLENBQUM7d0JBQ2QsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztvQkFDbEMsQ0FBQztnQkFDTCxDQUFDLENBQUMsQ0FBQztZQUNQLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDaEQsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2IsTUFBTSxJQUFJLEtBQUssQ0FBQyxjQUFjLFFBQVEsWUFBWSxDQUFDLENBQUM7UUFDeEQsQ0FBQztRQUNELE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7Q0FFSjtBQTcwQkQsb0NBNjBCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBBdXRob3JpemF0aW9uVHlwZSxcbiAgICBDb3JzT3B0aW9ucyxcbiAgICBJUmVzb3VyY2UsXG4gICAgTWV0aG9kLFxuICAgIE1ldGhvZE9wdGlvbnMsXG4gICAgUmVzdEFwaVByb3BzXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuXG5pbXBvcnQge1xuICAgIEF3c0ludGVncmF0aW9uLFxuICAgIENvcnMsXG4gICAgRGVwbG95bWVudCxcbiAgICBSZXNvdXJjZSxcbiAgICBSZXNwb25zZVR5cGUsXG4gICAgUmVzdEFwaSxcbiAgICBBcGlLZXksXG4gICAgUGVyaW9kLFxuICAgIFVzYWdlUGxhblxufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcblxuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBEdXJhdGlvbiwgTmVzdGVkU3RhY2ssIFJlbW92YWxQb2xpY3ksIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5cbmltcG9ydCB7IFJvbGUsIFNlcnZpY2VQcmluY2lwYWwgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgVG9waWMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNuc1wiO1xuaW1wb3J0IHsgUXVldWUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuXG5pbXBvcnQgdHlwZSB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4uL2NvcmUvXCI7XG5pbXBvcnQgdHlwZSBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgTXV0YWJsZSBmcm9tIFwiLi4vdHlwZXMvbXV0YWJsZVwiO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBMYW1iZGFJbnRlZ3JhdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1pbnRlZ3JhdGlvblwiO1xuXG5pbnRlcmZhY2UgSUFQSVJlZmVyZW5jZSB7XG4gICAgYXBpOiBSZXN0QXBpO1xuICAgIGlzSW1wb3J0ZWQ6IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBJQXV0aG9yaXplckNvbmZpZyB7XG4gICAgbmFtZT86IHN0cmluZztcbiAgICB0eXBlPzogc3RyaW5nO1xuICAgIGdyb3Vwcz86IHN0cmluZyB8IHN0cmluZ1tdO1xuICAgIHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc/OiBib29sZWFuO1xuICAgIGRlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgSUNvbnRyb2xsZXJDb25maWdXaXRoQXV0aG9yaXplciBleHRlbmRzIElDb250cm9sbGVyQ29uZmlnIHtcbiAgICByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnPzogYm9vbGVhbjtcbiAgICBhdXRob3JpemVyPzogc3RyaW5nIHwgSUF1dGhvcml6ZXJDb25maWcgfCBJQXV0aG9yaXplckNvbmZpZ1tdO1xufVxuXG5pbnRlcmZhY2UgSVJvdXRlV2l0aEF1dGhvcml6ZXIge1xuICAgIGh0dHBNZXRob2Q6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgdGFyZ2V0Pzogc3RyaW5nO1xuICAgIHBhcmFtZXRlcnM/OiBzdHJpbmdbXSB8IFN0cmluZ1tdO1xuICAgIGF1dGhvcml6ZXI/OiBzdHJpbmcgfCBJQXV0aG9yaXplckNvbmZpZztcbn1cblxuaW1wb3J0IHsgY3JlYXRlSGFzaCwgcmFuZG9tVVVJRCB9IGZyb20gXCJub2RlOmNyeXB0b1wiO1xuaW1wb3J0IHsgY29weUZpbGVTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBJQ29udHJvbGxlckNvbmZpZyB9IGZyb20gXCIuLi9kZWNvcmF0b3JzL2NvbnRyb2xsZXJcIjtcbmltcG9ydCB7IEVOVl9LRVlTIH0gZnJvbSBcIi4uL2Z3MjRcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBpc0FycmF5LCBpc1N0cmluZyB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgQXV0aENvbnN0cnVjdCB9IGZyb20gXCIuL2F1dGhcIjtcbmltcG9ydCB7IENlcnRpZmljYXRlQ29uc3RydWN0IH0gZnJvbSBcIi4vY2VydGlmaWNhdGVcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0IH0gZnJvbSBcIi4vZHluYW1vZGJcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcbmltcG9ydCB7IE1haWxlckNvbnN0cnVjdCB9IGZyb20gXCIuL21haWxlclwiO1xuaW1wb3J0IHsgUXVldWVDb25zdHJ1Y3QgfSBmcm9tIFwiLi9xdWV1ZVwiO1xuaW1wb3J0IHsgVG9waWNDb25zdHJ1Y3QgfSBmcm9tIFwiLi90b3BpY1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBvcHRpb25zIGZvciBhbiBBUEkgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElBUElDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIENPUlMgY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSS5cbiAgICAgKiBJdCBjYW4gYmUgYSBib29sZWFuIHZhbHVlLCBhIHNpbmdsZSBzdHJpbmcsIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MuXG4gICAgICovXG4gICAgY29ycz86IGJvb2xlYW4gfCBzdHJpbmcgfCBzdHJpbmdbXTtcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyBhZGRpdGlvbmFsIG9wdGlvbnMgZm9yIHRoZSBBUEkuXG4gICAgICovXG4gICAgYXBpT3B0aW9ucz86IFJlc3RBcGlQcm9wcztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgZGlyZWN0b3J5IHdoZXJlIHRoZSBjb250cm9sbGVycyBhcmUgbG9jYXRlZC5cbiAgICAgKi9cbiAgICBjb250cm9sbGVyc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgZnVuY3Rpb24uXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIG51bWJlciBvZiBkYXlzIHRvIHJldGFpbiB0aGUgQVBJIGxvZ3MuXG4gICAgICovXG4gICAgbG9nUmV0ZW50aW9uRGF5cz86IFJldGVudGlvbkRheXM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIHJlbW92YWwgcG9saWN5IGZvciB0aGUgQVBJIGxvZ3MuXG4gICAgICovXG4gICAgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY3VzdG9tIGRvbWFpbiBuYW1lIGZvciB0aGUgQVBJLlxuICAgICAqL1xuICAgIGRvbWFpbk5hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY2VydGlmaWNhdGUgQVJOIGZvciB0aGUgY3VzdG9tIGRvbWFpbiBuYW1lLlxuICAgICAqL1xuICAgIGNlcnRpZmljYXRlQXJuPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogQVBJIEdhdGV3YXkgTGFtYmRhIGludGVncmF0aW9uIHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICAgKi9cbiAgICBpbnRlZ3JhdGlvblRpbWVvdXQ/OiBudW1iZXI7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcGFyZW50IHN0YWNrIG5hbWUgZm9yIHRoZSBDb250cm9sbGVycy5cbiAgICAgKi9cbiAgICBjb250cm9sbGVyUGFyZW50U3RhY2tOYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogU2V0IHRvIGZhbHNlIGlmIHlvdSB3YW50IHRvIHNraXAgY3JlYXRpb24gb2YgY29udHJvbGxlcnMgcmVzb3VyY2VzIGFuZCBtZXRob2RzXG4gICAgICogVGhpcyB3aWxsIGRlbGV0ZSBhbGwgdGhlIGNvbnRyb2xsZXJzIHJlc291cmNlcyBhbmQgbWV0aG9kcyBmcm9tIHRoZSBBUElcbiAgICAgKi9cbiAgICBza2lwQ29udHJvbGxlcnM/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogRm9yY2UgYSBkZXBsb3ltZW50IG9mIHRoZSBBUEkgd2hlbiB1c2luZyBpbXBvcnRlZCBBUElzXG4gICAgICovXG4gICAgZm9yY2VEZXBsb3ltZW50PzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIEFQSSBrZXkgY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSVxuICAgICAqL1xuICAgIGFwaUtleUNvbmZpZz86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIExpc3Qgb2YgdmFsaWQgQVBJIGtleXMuIElmIGVtcHR5LCBrZXlzIHdpbGwgYmUgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICovXG4gICAgICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIE5hbWUgb2YgdGhlIEFQSSBrZXkgKHVzZWQgd2hlbiBhdXRvLWdlbmVyYXRpbmcpXG4gICAgICAgICAqL1xuICAgICAgICBrZXlOYW1lPzogc3RyaW5nO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBVc2FnZSBwbGFuIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBUElcbiAgICAgKi9cbiAgICB1c2FnZVBsYW5zPzogSVVzYWdlUGxhbkNvbmZpZ1tdO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIEFQSSBrZXkgd2l0aGluIGEgdXNhZ2UgcGxhblxuICovXG5pbnRlcmZhY2UgSVVzYWdlUGxhbkFwaUtleUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogTGlzdCBvZiB2YWxpZCBBUEkga2V5cy4gSWYgZW1wdHksIGtleXMgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZFxuICAgICAqL1xuICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBOYW1lIHByZWZpeCBmb3IgdGhlIEFQSSBrZXlzICh1c2VkIHdoZW4gYXV0by1nZW5lcmF0aW5nKVxuICAgICAqL1xuICAgIGtleU5hbWVQcmVmaXg/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgYSB1c2FnZSBwbGFuXG4gKi9cbmludGVyZmFjZSBJVXNhZ2VQbGFuQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgbmFtZTogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIERlc2NyaXB0aW9uIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogUmF0ZSBsaW1pdCBwZXIgc2Vjb25kXG4gICAgICovXG4gICAgcmF0ZUxpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIEJ1cnN0IGxpbWl0XG4gICAgICovXG4gICAgYnVyc3RMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBsaW1pdCBwZXIgcGVyaW9kXG4gICAgICovXG4gICAgcXVvdGFMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBwZXJpb2RcbiAgICAgKi9cbiAgICBxdW90YVBlcmlvZD86IFBlcmlvZDtcbiAgICAvKipcbiAgICAgKiBBUEkga2V5IGNvbmZpZ3VyYXRpb24gZm9yIHRoaXMgdXNhZ2UgcGxhblxuICAgICAqL1xuICAgIGFwaUtleXM/OiBJVXNhZ2VQbGFuQXBpS2V5Q29uZmlnO1xufVxuXG5leHBvcnQgY2xhc3MgQVBJQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEFQSUNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gQVBJQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIE1haWxlckNvbnN0cnVjdC5uYW1lLCBEeW5hbW9EQkNvbnN0cnVjdC5uYW1lLCBBdXRoQ29uc3RydWN0Lm5hbWUsIFF1ZXVlQ29uc3RydWN0Lm5hbWUsIFRvcGljQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWUgXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgYXBpITogUmVzdEFwaTtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICB1c2FnZVBsYW5zOiBNYXA8c3RyaW5nLCB7IHBsYW46IFVzYWdlUGxhbjsgbmFtZTogc3RyaW5nIH0+ID0gbmV3IE1hcCgpO1xuICAgIGFwaUtleXM6IE1hcDxzdHJpbmcsIEFwaUtleVtdPiA9IG5ldyBNYXAoKTtcbiAgICBrZXlWYWx1ZXM6IE1hcDxzdHJpbmcsIEFwaUtleT4gPSBuZXcgTWFwKCk7XG5cbiAgICBwcml2YXRlIHJlc291cmNlczogSVJlc291cmNlW10gPSBbXTtcbiAgICBwcml2YXRlIG1ldGhvZHM6IE1ldGhvZFtdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBjb250cm9sbGVyU3RhY2tzID0gbmV3IE1hcDxzdHJpbmcsIHsgbWV0aG9kczogTWV0aG9kW10sIHJlc291cmNlczogSVJlc291cmNlW10sIGNvbnRyb2xsZXJzSGFzaDogc3RyaW5nW10gfT4oKTtcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgYXBpQ29uc3RydWN0Q29uZmlnOiBJQVBJQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIC8vIGh5ZHJhdGUgdGhlIGNvbmZpZyBvYmplY3Qgd2l0aCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZXg6IEFQSUdBVEVXQVlfQ09OVFJPTExFUlNcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoYXBpQ29uc3RydWN0Q29uZmlnLCAnQVBJR0FURVdBWScpO1xuICAgIH1cblxuICAgIC8vIGNvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFja1xuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIHNldCB0aGUgZGVmYXVsdCBhcGkgb3B0aW9uc1xuICAgICAgICBjb25zdCBwYXJhbXNBcGk6IE11dGFibGU8UmVzdEFwaVByb3BzPiA9IHsgLi4udGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpT3B0aW9ucyB8fCB7fSB9O1xuICAgICAgICAvLyBFbmFibGUgQ09SUyBpZiBkZWZpbmVkXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkVuYWJsaW5nIENPUlMuLi4gdGhpcy5jb25maWcuY29yczogXCIsIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpO1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9ucyA9IHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSAmJiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlQ29uc3RydWN0ID0gbmV3IENlcnRpZmljYXRlQ29uc3RydWN0KHtcbiAgICAgICAgICAgICAgICBkb21haW5OYW1lOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLFxuICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlQXJuOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jZXJ0aWZpY2F0ZUFyblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlID0gY2VydGlmaWNhdGVDb25zdHJ1Y3Qub3V0cHV0WyBPdXRwdXRUeXBlLkNFUlRJRklDQVRFIF1bIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUgXTtcbiAgICAgICAgICAgIHBhcmFtc0FwaS5kb21haW5OYW1lID0ge1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgY2VydGlmaWNhdGU6IGNlcnRpZmljYXRlLFxuICAgICAgICAgICAgICAgIGJhc2VQYXRoOiBwYXJhbXNBcGkuZGVwbG95T3B0aW9ucz8uc3RhZ2VOYW1lIHx8ICcvJyxcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gZm9yIG11bHRpc3RhY2sgYXBwbGljYXRpb24sIHNldCBkZXBsb3kgdG8gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlcGxveSA9IGZhbHNlO1xuICAgICAgICAgICAgZGVsZXRlIHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgQVBJIEdhdGV3YXkuLi4gXCIpO1xuICAgICAgICAvLyBnZXQgdGhlIG1haW4gc3RhY2sgZnJvbSB0aGUgZnJhbWV3b3JrXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnN0YWNrTmFtZSwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgZ2F0ZXdheVxuICAgICAgICB0aGlzLmFwaSA9IG5ldyBSZXN0QXBpKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgLi4ucGFyYW1zQXBpLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycykge1xuICAgICAgICAgICAgY29uc3QgY29yc09yaWdpbnMgPSB0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkuYWxsb3dPcmlnaW5zPy5qb2luKCcsJyk7XG4gICAgICAgICAgICB0aGlzLmFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ2RlZmF1bHQ0eHgnLCB7XG4gICAgICAgICAgICAgICAgdHlwZTogUmVzcG9uc2VUeXBlLkRFRkFVTFRfNFhYLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlSGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYCcke2NvcnNPcmlnaW5zfSdgLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdkZWZhdWx0NXh4Jywge1xuICAgICAgICAgICAgICAgIHR5cGU6IFJlc3BvbnNlVHlwZS5ERUZBVUxUXzVYWCxcbiAgICAgICAgICAgICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGAnJHtjb3JzT3JpZ2luc30nYCxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB1cCB1c2FnZSBwbGFucyBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy51c2FnZVBsYW5zPy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGxhbkNvbmZpZyBvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy51c2FnZVBsYW5zKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXR1cFVzYWdlUGxhbihwbGFuQ29uZmlnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZncyNC5hZGRBUEkodGhpcy5uYW1lLCAncm9vdCcsIHRoaXMuYXBpLCBmYWxzZSk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ3Jlc3RBUEknLCB0aGlzLmFwaSwgT3V0cHV0VHlwZS5BUEksICdyZXN0QXBpSWQnKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCAncmVzdEFQSScsIHRoaXMuYXBpLCBPdXRwdXRUeXBlLkFQSSwgJ3Jlc3RBcGlSb290UmVzb3VyY2VJZCcpO1xuXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5za2lwQ29udHJvbGxlcnMpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJDb250cm9sbGVycygpO1xuXG4gICAgICAgIC8vIGlmIG11bHRpL25lc3RlZC1zdGFjayBzZXR1cCwgdGhlbiBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2tcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQVBJLWdhdGV3YXkgY29uc3RydWN0OiAke3RoaXMubmFtZX0gaGFzIGltcG9ydGVkIEFQSXM6ICR7dGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSl9YCk7XG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSAmJiB0aGlzLmZ3MjQudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlRGVwbG95bWVudHMoKTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVTaW5nbGVEZXBsb3ltZW50KCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldEFQSSA9IChzdGFja05hbWU6IHN0cmluZyk6IElBUElSZWZlcmVuY2UgPT4ge1xuICAgICAgICBsZXQgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCAncm9vdCcpIGFzIElBUElSZWZlcmVuY2UgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gaWYgdGhlIHN0YWNrIGlzIG5vdCB0aGUgbWFpbiBzdGFjayBhbmQgaXRzIGEgbXVsdGktc3RhY2sgYXBwbGljYXRpb24gb3IgYSBuZXN0ZWQgc3RhY2ssIHRoZW4gaW1wb3J0IHRoZSBBUElcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHN0YWNrTmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXJyZW50IFN0YWNrOiAke2N1cnJlbnRTdGFjay5zdGFja05hbWV9IGlzIG5lc3RlZCBzdGFjazogJHtjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFja31gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCB0aGlzLm1haW5TdGFjaykgfHwgY3VycmVudFN0YWNrIGluc3RhbmNlb2YgTmVzdGVkU3RhY2spIHtcbiAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKSBhcyBJQVBJUmVmZXJlbmNlIHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgaWYgKCFjdXJyZW50QVBJKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0ZWRBUEkgPSBSZXN0QXBpLmZyb21SZXN0QXBpQXR0cmlidXRlcyhjdXJyZW50U3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3N0YWNrTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgICAgICAgICByZXN0QXBpSWQ6IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdyZXN0QVBJX3Jlc3RBcGlJZCcsICdhcGknLCBjdXJyZW50U3RhY2spLFxuICAgICAgICAgICAgICAgICAgICByb290UmVzb3VyY2VJZDogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ3Jlc3RBUElfcmVzdEFwaVJvb3RSZXNvdXJjZUlkJywgJ2FwaScsIGN1cnJlbnRTdGFjayksXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEFQSSh0aGlzLm5hbWUsIHN0YWNrTmFtZSwgaW1wb3J0ZWRBUEksIHRydWUpO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKSBhcyBJQVBJUmVmZXJlbmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFjdXJyZW50QVBJKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFQSSBub3QgZm91bmQgZm9yIHN0YWNrOiAke3N0YWNrTmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjdXJyZW50QVBJO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVnaXN0ZXJDb250cm9sbGVycygpIHtcbiAgICAgICAgLy8gc2V0cyB0aGUgZGVmYXVsdCBjb250cm9sbGVycyBkaXJlY3RvcnkgaWYgbm90IGRlZmluZWRcbiAgICAgICAgY29uc3QgY29udHJvbGxlcnNEaXJlY3RvcnkgPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb250cm9sbGVyc0RpcmVjdG9yeSB8fCBcIi4vc3JjL2NvbnRyb2xsZXJzXCI7XG5cbiAgICAgICAgLy8gcmVnaXN0ZXIgdGhlIGNvbnRyb2xsZXJzXG4gICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKGNvbnRyb2xsZXJzRGlyZWN0b3J5LCB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcik7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIG1vZHVsZXMgXCIsIEFycmF5LmZyb20obW9kdWxlcy5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJMb2FkIGNvbnRyb2xsZXJzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcblxuICAgICAgICAgICAgICAgIEhlbHBlci5yZWdpc3RlckNvbnRyb2xsZXJzRnJvbU1vZHVsZShcbiAgICAgICAgICAgICAgICAgICAgbW9kdWxlLFxuICAgICAgICAgICAgICAgICAgICAoZGVzYzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHRoaXMucmVnaXN0ZXJDb250cm9sbGVyKGRlc2MsIG1vZHVsZSlcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIE5PIG1vZHVsZXMgXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVnaXN0ZXIgc3lzdGVtIGNvbnRyb2xsZXJzIGZyb20gZncyNCBzaW5nbGV0b25cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNTeXN0ZW1Db250cm9sbGVycygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IHJlZ2lzdGVyaW5nIHN5c3RlbSBjb250cm9sbGVyc1wiKTtcblxuICAgICAgICAgICAgLy8gQ29weSBzeXN0ZW0gY29udHJvbGxlcnMgdG8gYXBwIGRpc3QgYW5kIHJlZ2lzdGVyIGZyb20gdGhlcmVcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29weUFuZFJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcnMoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBOTyBzeXN0ZW0gY29udHJvbGxlcnNcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGNvcHlBbmRSZWdpc3RlclN5c3RlbUNvbnRyb2xsZXJzKCkge1xuICAgICAgICBjb25zdCBzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciA9IHBhdGguam9pbihwcm9jZXNzLmN3ZCgpLCAnZGlzdCcsICdzeXN0ZW0tY29udHJvbGxlcnMnKTtcblxuICAgICAgICAvLyBFbnN1cmUgdGFyZ2V0IGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyKSkge1xuICAgICAgICAgICAgbWtkaXJTeW5jKHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3lzdGVtQ29udHJvbGxlciBvZiB0aGlzLmZ3MjQuZ2V0U3lzdGVtQ29udHJvbGxlcnMoKSkge1xuICAgICAgICAgICAgbGV0IHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmsgPSAnJztcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgdGhlIGxhc3QgZmV3IGRpcmVjdG9yaWVzIHRvIHByZXNlcnZlIHN0cnVjdHVyZVxuICAgICAgICAgICAgY29uc3QgcGF0aFBhcnRzID0gc3lzdGVtQ29udHJvbGxlci5maWxlUGF0aC5zcGxpdCgnLycpO1xuICAgICAgICAgICAgY29uc3QgcmVsZXZhbnRQYXJ0cyA9IHBhdGhQYXJ0cy5zbGljZSgtMyk7IC8vIGUuZy4sIFsnc2VhcmNoJywgJ3N5c3RlbScsICdzZWFyY2gtY29udHJvbGxlci5qcyddXG4gICAgICAgICAgICByZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrID0gcmVsZXZhbnRQYXJ0cy5qb2luKCcvJyk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFN5c3RlbSBjb250cm9sbGVyIHJlbGF0aXZlIHBhdGg6ICR7cmVsYXRpdmVQYXRoRnJvbUZyYW1ld29ya31gKTtcblxuICAgICAgICAgICAgY29uc3QgdGFyZ2V0RmlsZVBhdGggPSBwYXRoLmpvaW4oc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIsIHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmspO1xuICAgICAgICAgICAgY29uc3QgdGFyZ2V0RGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKHRhcmdldEZpbGVQYXRoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFN5c3RlbSBjb250cm9sbGVyIHRhcmdldC1kaXJlY3Rvcnk6ICR7dGFyZ2V0RGlyZWN0b3J5fSwgdGFyZ2V0RmlsZVBhdGg6ICR7dGFyZ2V0RmlsZVBhdGh9YCk7XG5cbiAgICAgICAgICAgIC8vIEVuc3VyZSB0YXJnZXQgc3ViZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKHRhcmdldERpcmVjdG9yeSkpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmModGFyZ2V0RGlyZWN0b3J5LCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ29weSB0aGUgc3lzdGVtIGNvbnRyb2xsZXIgZmlsZVxuICAgICAgICAgICAgY29weUZpbGVTeW5jKHN5c3RlbUNvbnRyb2xsZXIuZmlsZVBhdGgsIHRhcmdldEZpbGVQYXRoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvcGllZCBzeXN0ZW0gY29udHJvbGxlciBmcm9tICR7c3lzdGVtQ29udHJvbGxlci5maWxlUGF0aH0gdG8gJHt0YXJnZXRGaWxlUGF0aH1gKTtcblxuICAgICAgICAgICAgLy8gUmVnaXN0ZXIgZnJvbSB0aGUgY29waWVkIGxvY2F0aW9uXG4gICAgICAgICAgICBjb25zdCBkaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuICAgICAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKHRhcmdldEZpbGVQYXRoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIHN5c3RlbSBjb250cm9sbGVyOiAke2ZpbGVOYW1lfWApO1xuXG4gICAgICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhcbiAgICAgICAgICAgICAgICBkaXJlY3RvcnksXG4gICAgICAgICAgICAgICAgdGhpcy5yZWdpc3RlckNvbnRyb2xsZXIsXG4gICAgICAgICAgICAgICAgWyBmaWxlTmFtZSBdXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwcmVwYXJlRW50cnlQYWNrYWdlcyhjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZywgb3duZXJNb2R1bGU/OiBJRncyNE1vZHVsZSk6IHN0cmluZ1tdIHtcbiAgICAgICAgbGV0IGVudHJ5UGFja2FnZXMgPSBjb250cm9sbGVyQ29uZmlnLmVudHJ5UGFja2FnZXMgfHwgW107XG5cbiAgICAgICAgaWYgKGlzQXJyYXkoZW50cnlQYWNrYWdlcykpIHtcbiAgICAgICAgICAgIGVudHJ5UGFja2FnZXMgPSB7XG4gICAgICAgICAgICAgICAgb3ZlcnJpZGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgIHBhY2thZ2VOYW1lczogZW50cnlQYWNrYWdlc1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaWYgdGhlIGNvbnRyb2xsZXIgZG9lcyBub3Qgd2FudCB0byBvdmVycmlkZSB0aGUgYXBwbGljYXRpb24vbW9kdWxlIGVudHJ5IHBhY2thZ2VzIGFuZCBpbmNsdWRlIHRoZW0gYXMgd2VsbFxuICAgICAgICBpZiAoIWVudHJ5UGFja2FnZXMub3ZlcnJpZGUpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZUVudHJ5UGFja2FnZXMgPSBvd25lck1vZHVsZT8uZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpIHx8IFtdO1xuICAgICAgICAgICAgY29uc3QgYXBwRW50cnlQYWNrYWdlcyA9IHRoaXMuZncyNC5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCk7XG4gICAgICAgICAgICBlbnRyeVBhY2thZ2VzLnBhY2thZ2VOYW1lcyA9IFtcbiAgICAgICAgICAgICAgICAuLi5lbnRyeVBhY2thZ2VzLnBhY2thZ2VOYW1lcyxcbiAgICAgICAgICAgICAgICAuLi5tb2R1bGVFbnRyeVBhY2thZ2VzLFxuICAgICAgICAgICAgICAgIC4uLmFwcEVudHJ5UGFja2FnZXNcbiAgICAgICAgICAgIF07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZW50cnlQYWNrYWdlcy5wYWNrYWdlTmFtZXMubWFwKHRoaXMuZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUpO1xuICAgIH1cblxuXG4gICAgLy8gcmVnaXN0ZXIgYSBzaW5nbGUgY29udHJvbGxlclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJDb250cm9sbGVyID0gYXN5bmMgKGNvbnRyb2xsZXJJbmZvOiBIYW5kbGVyRGVzY3JpcHRvciwgb3duZXJNb2R1bGU/OiBJRncyNE1vZHVsZSkgPT4ge1xuICAgICAgICBjb25zdCB7IGhhbmRsZXJDbGFzcywgZmlsZVBhdGgsIGZpbGVOYW1lIH0gPSBjb250cm9sbGVySW5mbztcbiAgICAgICAgLy8gQWRkIHRoZSBmb2xkZXIgcGF0aCBmcm9tIGZpbGVuYW1lIHRvIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICAgICAgY29uc3QgZm9sZGVyUGF0aCA9IGZpbGVOYW1lLnNwbGl0KCcvJykuc2xpY2UoMCwgLTEpLmpvaW4oJy8nKTtcbiAgICAgICAgY29uc3QgaGFuZGxlckluc3RhbmNlID0gbmV3IGhhbmRsZXJDbGFzcygpO1xuICAgICAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IGZpbGVOYW1lLmluY2x1ZGVzKCcvJykgPyBmb2xkZXJQYXRoICsgJy8nICsgaGFuZGxlckluc3RhbmNlLmNvbnRyb2xsZXJOYW1lIDogaGFuZGxlckluc3RhbmNlLmNvbnRyb2xsZXJOYW1lO1xuICAgICAgICBjb25zdCBjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZyA9IGhhbmRsZXJJbnN0YW5jZT8uY29udHJvbGxlckNvbmZpZyB8fCB7fTtcbiAgICAgICAgY29uc3QgY29udHJvbGxlclN0YWNrTmFtZSA9IGNvbnRyb2xsZXJDb25maWcuc3RhY2tOYW1lIHx8IGNvbnRyb2xsZXJOYW1lO1xuICAgICAgICBjb25zdCBwYXJlbnRTdGFja05hbWUgPSBjb250cm9sbGVyQ29uZmlnLnBhcmVudFN0YWNrTmFtZSB8fCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb250cm9sbGVyUGFyZW50U3RhY2tOYW1lO1xuXG4gICAgICAgIC8vIEluaXRpYWxpemUgY29udHJvbGxlciBzdGFjayBpbmZvIGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLmNvbnRyb2xsZXJTdGFja3MuaGFzKGNvbnRyb2xsZXJTdGFja05hbWUpKSB7XG4gICAgICAgICAgICB0aGlzLmNvbnRyb2xsZXJTdGFja3Muc2V0KGNvbnRyb2xsZXJTdGFja05hbWUsIHtcbiAgICAgICAgICAgICAgICBtZXRob2RzOiBbXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtdLFxuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzSGFzaDogW11cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gbWFrZSBzdXJlIHRoZSBjb250cm9sbGVyIHN0YWNrIGV4aXN0c1xuICAgICAgICB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSwgcGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgY29udHJvbGxlckluZm8ucm91dGVzID0gaGFuZGxlckluc3RhbmNlLnJvdXRlcztcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfWApO1xuXG4gICAgICAgIC8vIHByZXBhcmUgdGhlIGVudHJ5IHBhY2thZ2VzIGZvciB0aGUgY29udHJvbGxlcidzIGxhbWJkYSBmdW5jdGlvblxuICAgICAgICBjb25zdCBlbnRyeVBhY2thZ2VzID0gdGhpcy5wcmVwYXJlRW50cnlQYWNrYWdlcyhjb250cm9sbGVyQ29uZmlnLCBvd25lck1vZHVsZSk7XG4gICAgICAgIGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyA9IGVudHJ5UGFja2FnZXM7XG5cbiAgICAgICAgdGhpcy5yZXNvdXJjZXMgPSBbXTtcbiAgICAgICAgdGhpcy5tZXRob2RzID0gW107XG4gICAgICAgIC8vIGNyZWF0ZSB0aGUgYXBpIHJlc291cmNlIGZvciB0aGUgY29udHJvbGxlciBpZiBpdCBkb2Vzbid0IGV4aXN0XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJSZXNvdXJjZSA9IHRoaXMuZ2V0T3JDcmVhdGVDb250cm9sbGVyUmVzb3VyY2UoY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuXG4gICAgICAgIGxldCBjb250cm9sbGVyVGFyZ2V0ID0gY29udHJvbGxlckNvbmZpZy50YXJnZXQ7XG4gICAgICAgIGxldCBjb250cm9sbGVySW50ZWdyYXRpb246IExhbWJkYUludGVncmF0aW9uIHwgQXdzSW50ZWdyYXRpb24gfCB1bmRlZmluZWQ7XG4gICAgICAgIC8vIGNyZWF0ZSBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSBjb250cm9sbGVyXG4gICAgICAgIGlmIChjb250cm9sbGVyVGFyZ2V0ID09PSAnZnVuY3Rpb24nIHx8IGNvbnRyb2xsZXJUYXJnZXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzID0gY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzIHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmxvZ1JldGVudGlvbkRheXM7XG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3kgPSBjb250cm9sbGVyQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3kgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubG9nUmVtb3ZhbFBvbGljeTtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJMYW1iZGEgPSB0aGlzLmNyZWF0ZUxhbWJkYUZ1bmN0aW9uKGNvbnRyb2xsZXJOYW1lLCBmaWxlUGF0aCwgZmlsZU5hbWUsIGNvbnRyb2xsZXJDb25maWcsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlckxhbWJkYSwgT3V0cHV0VHlwZS5GVU5DVElPTik7XG5cbiAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IG5ldyBMYW1iZGFJbnRlZ3JhdGlvbihjb250cm9sbGVyTGFtYmRhLCB7XG4gICAgICAgICAgICAgICAgcmVzdEFwaTogdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSkuYXBpLFxuICAgICAgICAgICAgICAgIHBhdGg6IGNvbnRyb2xsZXJOYW1lLFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHModGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuaW50ZWdyYXRpb25UaW1lb3V0IHx8IDI5KSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH0gPSB0aGlzLmV4dHJhY3REZWZhdWx0QXV0aG9yaXplcihjb250cm9sbGVyQ29uZmlnKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXIgQ29udHJvbGxlciB+IERlZmF1bHQgQXV0aG9yaXplcjogbmFtZTogJHtkZWZhdWx0QXV0aG9yaXplck5hbWV9IC0gdHlwZTogJHtkZWZhdWx0QXV0aG9yaXplclR5cGV9IC0gZ3JvdXBzOiAke2RlZmF1bHRBdXRob3JpemVyR3JvdXBzfWApO1xuXG4gICAgICAgIC8vIFNldCB1cCBBUEkga2V5IGlmIHJlcXVpcmVkXG4gICAgICAgIGlmIChjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0dXBVc2FnZVBsYW4odW5kZWZpbmVkLCB0cnVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB1cCByb3V0ZXMgZm9yIHRoZSBjb250cm9sbGVyXG4gICAgICAgIGZvciAoY29uc3Qgcm91dGUgb2YgT2JqZWN0LnZhbHVlcyhjb250cm9sbGVySW5mby5yb3V0ZXMgPz8ge30pKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgcm91dGUgJHtyb3V0ZS5odHRwTWV0aG9kfSAke3JvdXRlLnBhdGh9YCk7XG4gICAgICAgICAgICBjb25zdCByb3V0ZVRhcmdldCA9IHJvdXRlLnRhcmdldCB8fCBjb250cm9sbGVyVGFyZ2V0O1xuICAgICAgICAgICAgY29uc3QgY3VycmVudFJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZVJvdXRlUmVzb3VyY2UoY29udHJvbGxlclJlc291cmNlLCByb3V0ZS5wYXRoLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IHsgcm91dGVBdXRob3JpemVyTmFtZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfSA9IHRoaXMuZXh0cmFjdFJvdXRlQXV0aG9yaXplcihyb3V0ZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgcm91dGUgQXV0aG9yaXplcjogJHtyb3V0ZUF1dGhvcml6ZXJOYW1lfSAtICR7cm91dGVBdXRob3JpemVyVHlwZX0gLSAke3JvdXRlQXV0aG9yaXplckdyb3Vwc31gKTtcblxuICAgICAgICAgICAgbGV0IG1ldGhvZE9wdGlvbnMgPSB0aGlzLmNyZWF0ZU1ldGhvZE9wdGlvbnMocm91dGUsIHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplck5hbWUsIGNvbnRyb2xsZXJDb25maWcpO1xuXG4gICAgICAgICAgICBpZiAocm91dGVUYXJnZXQgPT09ICdxdWV1ZScpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSByb3V0ZS5wYXRoLnJlcGxhY2UoJy8nLCAnJyk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gdGhpcy5jcmVhdGVTUVNJbnRlZ3JhdGlvbihxdWV1ZU5hbWUsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBtZXRob2RPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi5tZXRob2RPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJvdXRlVGFyZ2V0ID09PSAndG9waWMnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdG9waWNOYW1lID0gcm91dGUucGF0aC5yZXBsYWNlKCcvJywgJycpO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IHRoaXMuY3JlYXRlU05TSW50ZWdyYXRpb24odG9waWNOYW1lLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgbWV0aG9kT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubWV0aG9kT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBtZXRob2QgPSBjdXJyZW50UmVzb3VyY2UuYWRkTWV0aG9kKHJvdXRlLmh0dHBNZXRob2QsIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiwgbWV0aG9kT3B0aW9ucyk7XG4gICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChtZXRob2QpO1xuXG4gICAgICAgICAgICAvLyBpZiBhdXRob3JpemVyIGlzIEFXU19JQU0sIHRoZW4gYWRkIHRoZSByb3V0ZSB0byB0aGUgcG9saWN5XG4gICAgICAgICAgICBpZiAocm91dGVBdXRob3JpemVyVHlwZSA9PT0gJ0FXU19JQU0nKSB7XG4gICAgICAgICAgICAgICAgbGV0IGZ1bGxSb3V0ZVBhdGggPSBjb250cm9sbGVyTmFtZSArIHJvdXRlLnBhdGg7XG5cbiAgICAgICAgICAgICAgICAvLyAqIHJlcGxhY2UgZWFjaCBwYXJhbSBwbGFjZWhvbGRlciBge2lkfWAgd2l0aCBhbiBgKmBcbiAgICAgICAgICAgICAgICByb3V0ZS5wYXJhbWV0ZXJzPy5mb3JFYWNoKHBhciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGZ1bGxSb3V0ZVBhdGggPSBmdWxsUm91dGVQYXRoLnJlcGxhY2UoYHske3Bhcn19YCwgJyonKTtcbiAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZFJvdXRlVG9Sb2xlUG9saWN5KGZ1bGxSb3V0ZVBhdGgsIHJvdXRlQXV0aG9yaXplckdyb3Vwcywgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGtlZXAgdHJhY2sgb2YgdGhlIGNvbnRyb2xsZXIgc3RhY2tzIHdpdGggbWV0aG9kcyBhbmQgcmVzb3VyY2VzIGluIGEgbXVsdGktc3RhY2sgc2V0dXAgdG8gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSkge1xuICAgICAgICAgICAgY29uc3Qgc3RhY2tJbmZvID0gdGhpcy5jb250cm9sbGVyU3RhY2tzLmdldChjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGlmIChzdGFja0luZm8pIHtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8ubWV0aG9kcyA9IFsgLi4udGhpcy5tZXRob2RzIF07XG4gICAgICAgICAgICAgICAgc3RhY2tJbmZvLnJlc291cmNlcyA9IFsgLi4udGhpcy5yZXNvdXJjZXMgXTtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8uY29udHJvbGxlcnNIYXNoLnB1c2goY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEpTT04uc3RyaW5naWZ5KGNvbnRyb2xsZXJDb25maWcpKS5kaWdlc3QoJ2hleCcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG91dHB1dCB0aGUgYXBpIGVuZHBvaW50XG4gICAgICAgIHRoaXMub3V0cHV0QXBpRW5kcG9pbnQoY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJSZXNvdXJjZSwgdGhpcy5nZXRTdGFnZU5hbWUoKSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRTdGFnZU5hbWUgPSAoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlPcHRpb25zPy5kZXBsb3lPcHRpb25zPy5zdGFnZU5hbWUgfHwgJ3Byb2QnO1xuICAgIH1cblxuICAgIC8vIGlmIHRoZSBBUEkgaXMgaW1wb3J0ZWQsIHRoZW4gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrIGFuZCBhZGQgbWV0aG9kIGFuZCByZXNvdXJjZSBhcyBkZXBlbmRlbmN5XG4gICAgLy8gVGhpcyBpcyBuZWVkZWQgYmVjYXVzZSBpbXBvcnRlZCBBUEkgZG9lcyBub3QgcHJvcG9nYXRlIENPUlMgc2V0dGluZ3MgdG8gdGhlIG1ldGhvZHNcbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZURlcGxveW1lbnRzKCkge1xuXG4gICAgICAgIGNvbnN0IHN0YWdlTmFtZSA9IHRoaXMuZ2V0U3RhZ2VOYW1lKCk7XG4gICAgICAgIGZvciAoY29uc3QgWyBjb250cm9sbGVyU3RhY2tOYW1lLCB7IG1ldGhvZHMsIHJlc291cmNlcywgY29udHJvbGxlcnNIYXNoIH0gXSBvZiB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZW50cmllcygpKSB7XG4gICAgICAgICAgICAvLyBUT0RPOiBhZGQgYmV0dGVyIGxvZ2ljIHRvIGZvcmNlIGEgZGVwbG95bWVudCB3aGVuIHRoZXJlIGlzIGEgY2hhbmdlIGluIGZyYW1ld29yayBjb2RlXG4gICAgICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZm9yY2VEZXBsb3ltZW50KSB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoLnB1c2gocmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlckhhc2ggPSBjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoY29udHJvbGxlcnNIYXNoKSkuZGlnZXN0KCdoZXgnKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBkZXBsb3ltZW50IGZvciBjb250cm9sbGVyIHN0YWNrICR7Y29udHJvbGxlclN0YWNrTmFtZX0gd2l0aCBoYXNoICR7Y29udHJvbGxlckhhc2h9YCk7XG4gICAgICAgICAgICBjb25zdCBkZXBsb3ltZW50ID0gbmV3IERlcGxveW1lbnQodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgZGVwbG95bWVudC0ke2NvbnRyb2xsZXJIYXNofWAsIHtcbiAgICAgICAgICAgICAgICBhcGk6IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaSxcbiAgICAgICAgICAgICAgICBzdGFnZU5hbWU6IHN0YWdlTmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBtZXRob2RzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyBtZXRob2QgZGVwZW5kZW5jeSAke21ldGhvZC5odHRwTWV0aG9kfSAke21ldGhvZC5yZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kobWV0aG9kKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBhZGQgZGVwZW5kZWN5IG9uIGFsbCByZXNvdXJjZXMgZm9yIHRoaXMgY29udHJvbGxlclxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNvdXJjZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIHJlc291cmNlIGRlcGVuZGVuY3kgJHtyZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kocmVzb3VyY2UpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBpZiB0aGUgYXBpIGlzIGltcG9ydGVkIGFuZCBpdCdzIG5vdCBhIG11bHRpLXN0YWNrIHNldHVwLCB0aGVuIGNyZWF0ZSBhIHNpbmdsZSBkZXBsb3ltZW50IGZvciBhbGwgY29udHJvbGxlcnNcbiAgICAvLyBTaW5nbGUgZGVwbG95bWVudCBpcyBuZWVkZWQgdG8gYXZvaWQgc2ltdWx0YXRpb24gZGVwbG95bWVudCB3aGljaCBjYXVzZXMgZXJyb3Igb24gQVBJIEdhdGV3YXlcbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZVNpbmdsZURlcGxveW1lbnQoKSB7XG4gICAgICAgIGNvbnN0IHN0YWdlTmFtZSA9IHRoaXMuZ2V0U3RhZ2VOYW1lKCk7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5mb3JFYWNoKGMgPT4gYy5jb250cm9sbGVyc0hhc2gucHVzaChyYW5kb21VVUlEKCkpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjcmVhdGUgdGhlIG5hbWUgZnJvbSBhbGwgdGhlIGNvbnRyb2xsZXIgaGFzaCB2YWx1ZXMgY29tYmluZWQgYXMgYSBzaW5nbGUgaGFzaCBhbmQgYWRkIGRlcGVuZGVuY3kgb24gYWxsIHRoZSBjb250cm9sbGVyc1xuICAgICAgICBjb25zdCBkZXBsb3ltZW50TmFtZSA9IGBkZXBsb3ltZW50LSR7Y3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEFycmF5LmZyb20odGhpcy5jb250cm9sbGVyU3RhY2tzLnZhbHVlcygpKS5tYXAoYyA9PiBjLmNvbnRyb2xsZXJzSGFzaCkuam9pbignLScpKS5kaWdlc3QoJ2hleCcpfWA7XG5cbiAgICAgICAgY29uc3QgZGVwbG95bWVudCA9IG5ldyBEZXBsb3ltZW50KHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLm5hbWUpLCBkZXBsb3ltZW50TmFtZSwge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgICAgICAgIHN0YWdlTmFtZTogc3RhZ2VOYW1lLFxuICAgICAgICB9KTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgX2NvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzIH0gXSBvZiB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZW50cmllcygpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBtZXRob2RzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyBtZXRob2QgZGVwZW5kZW5jeSAke21ldGhvZC5odHRwTWV0aG9kfSAke21ldGhvZC5yZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kobWV0aG9kKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgcmVzb3VyY2UgZGVwZW5kZW5jeSAke3Jlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGdldENvcnNQcmVmbGlnaHRPcHRpb25zKCk6IENvcnNPcHRpb25zIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGFsbG93SGVhZGVyczogW1xuICAgICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXG4gICAgICAgICAgICAgICAgXCJBdXRob3JpemF0aW9uXCIsXG4gICAgICAgICAgICAgICAgXCJYLUFwaS1LZXlcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LURhdGVcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LUNvbnRlbnQtU2hhMjU2XCIsXG4gICAgICAgICAgICAgICAgXCJYLUFtei1TZWN1cml0eS1Ub2tlblwiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHNcIixcbiAgICAgICAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnNcIixcbiAgICAgICAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiLFxuICAgICAgICAgICAgICAgIFwiSW1wZXJzb25hdGluZy1Vc2VyLVN1YlwiLFxuICAgICAgICAgICAgICAgIC8vIFRyYWNpbmcvaWRlbnRpdHkgaGVhZGVycyB0aGUgZnJhbWV3b3JrIGl0c2VsZiBjb25zdW1lczogeC1jb3JyZWxhdGlvbi1pZCBhbmRcbiAgICAgICAgICAgICAgICAvLyB4LWNhdXNlZC1ieSBmZWVkIGNvcnJlbGF0aW9uIHByb3BhZ2F0aW9uLCB4LWFjdG9yIGNhcnJpZXMgdGhlIGVuZC11c2VyIGlkZW50aXR5IG9uXG4gICAgICAgICAgICAgICAgLy8gU2lnVjQtc2lnbmVkIGNhbGxzIChzZWUgYXBpLWdhdGV3YXktY29udHJvbGxlcikuIEJyb3dzZXJzIHByZWZsaWdodCBhbnkgcmVxdWVzdFxuICAgICAgICAgICAgICAgIC8vIGNhcnJ5aW5nIHRoZW0sIHNvIHRoZXkgbXVzdCBiZSBhbGxvd2VkIGhlcmUgb3IgZXZlcnkgaW5zdHJ1bWVudGVkIGNyb3NzLW9yaWdpblxuICAgICAgICAgICAgICAgIC8vIGNhbGwgZmFpbHMgQ09SUyBiZWZvcmUgcmVhY2hpbmcgdGhlIGJhY2tlbmQuXG4gICAgICAgICAgICAgICAgXCJYLUNvcnJlbGF0aW9uLUlkXCIsXG4gICAgICAgICAgICAgICAgXCJYLUNhdXNlZC1CeVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BY3RvclwiLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGFsbG93TWV0aG9kczogWyBcIk9QVElPTlNcIiwgXCJHRVRcIiwgXCJQT1NUXCIsIFwiUFVUXCIsIFwiUEFUQ0hcIiwgXCJERUxFVEVcIiBdLFxuICAgICAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcbiAgICAgICAgICAgIGFsbG93T3JpZ2luczogdGhpcy5nZXRDb3JzT3JpZ2lucygpLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc09yaWdpbnMoKTogc3RyaW5nW10ge1xuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyA9PT0gdHJ1ZSkgcmV0dXJuIENvcnMuQUxMX09SSUdJTlM7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIFsgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyBdO1xuICAgICAgICByZXR1cm4gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyB8fCBbXTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldE9yQ3JlYXRlQ29udHJvbGxlclJlc291cmNlID0gKGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IElSZXNvdXJjZSA9PiB7XG4gICAgICAgIGxldCByZXN0QVBJID0gdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgIGxldCBjb250cm9sbGVyUmVzb3VyY2U6IElSZXNvdXJjZSA9IHJlc3RBUEkuYXBpLnJvb3Q7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRTdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgY29uc3QgcGF0aFBhcnRzID0gY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKTtcbiAgICAgICAgZm9yIChjb25zdCBwYXRoUGFydCBvZiBwYXRoUGFydHMpIHtcbiAgICAgICAgICAgIGxldCBjaGlsZFJlc291cmNlID0gY29udHJvbGxlclJlc291cmNlLmdldFJlc291cmNlKHBhdGhQYXJ0KSBhcyBJUmVzb3VyY2U7XG4gICAgICAgICAgICAvLyBpZiBpdCdzIGEgbmVzdGVkIGNvbnRyb2xsZXIsIHRoZSByb290IHJlc291cmNlIG1heSBub3QgYmUgY3JlYXRlZCBpbiBhbm90aGVyIHN0YWNrXG4gICAgICAgICAgICBjb25zdCBpc05lc3RlZENvbnRyb2xsZXIgPSBwYXRoUGFydHMubGVuZ3RoID4gMTtcbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSAmJiBpc05lc3RlZENvbnRyb2xsZXIgJiYgcGF0aFBhcnQgPT09IHBhdGhQYXJ0c1sgMCBdKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJ5IHRvIGdldCB0aGUgcm9vdCByZXNvdXJjZSBmcm9tIHRoZSBmdzI0IG91dHB1dFxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBHZXR0aW5nIGNvbnRyb2xsZXIgcmVzb3VyY2UgZm9yICR7cGF0aFBhcnR9IGZyb20gZncyNCBvdXRwdXRgKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sbGVyUmVzb3VyY2VJZCA9IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGByZXN0QVBJX2NvbnRyb2xsZXJfJHtwYXRoUGFydH1fcmVzb3VyY2VJZGAsICdyZXNvdXJjZScsIGN1cnJlbnRTdGFjayk7XG4gICAgICAgICAgICAgICAgaWYgKGNvbnRyb2xsZXJSZXNvdXJjZUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb250cm9sbGVyIHJlc291cmNlIGZvciAke3BhdGhQYXJ0fSBmb3VuZCBpbiBmdzI0IG91dHB1dDogJHtjb250cm9sbGVyUmVzb3VyY2VJZH1gKTtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IFJlc291cmNlLmZyb21SZXNvdXJjZUF0dHJpYnV0ZXMoY3VycmVudFN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb250cm9sbGVyU3RhY2tOYW1lfS0ke3BhdGhQYXJ0fWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlSWQ6IGNvbnRyb2xsZXJSZXNvdXJjZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdEFwaTogcmVzdEFQSS5hcGksXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiAnLycgKyBwYXRoUGFydFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWNoaWxkUmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICAvLyBmb3IgbmVzdGVkIHJlc291cmNlcyBhZGQgLyB0byB0aGUgcGF0aFxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBjb250cm9sbGVyIHJlc291cmNlIGZvciBwYXRoICR7cGF0aFBhcnR9IHVuZGVyICR7Y29udHJvbGxlclJlc291cmNlLnBhdGh9YCk7XG4gICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IGNvbnRyb2xsZXJSZXNvdXJjZS5hZGRSZXNvdXJjZShwYXRoUGFydCkgYXMgSVJlc291cmNlO1xuICAgICAgICAgICAgICAgIGlmIChyZXN0QVBJLmlzSW1wb3J0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29yc1ByZWZsaWdodE1ldGhvZCA9IGNoaWxkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChjb3JzUHJlZmxpZ2h0TWV0aG9kKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGlzTmVzdGVkQ29udHJvbGxlciAmJiBwYXRoUGFydCA9PT0gcGF0aFBhcnRzWyAwIF0pIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFNldHRpbmcgb3V0cHV0IGZvciBjb250b3JsbGVyIHJlc291cmNlICR7Y29udHJvbGxlclN0YWNrTmFtZX0gcGF0aCAke3BhdGhQYXJ0fWApO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGByZXN0QVBJX2NvbnRyb2xsZXJfJHtwYXRoUGFydH1gLCBjaGlsZFJlc291cmNlLCBPdXRwdXRUeXBlLlJFU09VUkNFLCAncmVzb3VyY2VJZCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRyb2xsZXJSZXNvdXJjZSA9IGNoaWxkUmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY29udHJvbGxlclJlc291cmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlTGFtYmRhRnVuY3Rpb24gPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZywgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IE5vZGVqc0Z1bmN0aW9uID0+IHtcbiAgICAgICAgY29uc3QgZnVuY3Rpb25Qcm9wcyA9IG1lcmdlKFtcbiAgICAgICAgICAgIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMgPz8ge30sXG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnPy5mdW5jdGlvblByb3BzID8/IHt9XG4gICAgICAgIF0pITtcblxuICAgICAgICBjb25zdCBlbnZWYXJpYWJsZXMgPSB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyhjb250cm9sbGVyQ29uZmlnLmVudiwgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKTtcblxuICAgICAgICAvLyBkbyBub3Qgb3ZlcnJpZGUgdGhlIGVudHJ5IHBhY2thZ2VzIGlmIGFscmVhZHkgc2V0XG4gICAgICAgIGlmICghKEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTIGluIGVudlZhcmlhYmxlcykgJiYgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzKSB7XG4gICAgICAgICAgICBlbnZWYXJpYWJsZXNbIEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTIF0gPSAoY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzIGFzIEFycmF5PHN0cmluZz4pLmpvaW4oJywnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBjb250cm9sbGVyTmFtZSArIFwiLWNvbnRyb2xsZXJcIiwge1xuICAgICAgICAgICAgZW50cnk6IGZpbGVQYXRoICsgXCIvXCIgKyBmaWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiBlbnZWYXJpYWJsZXMsXG4gICAgICAgICAgICBwb2xpY2llczogY29udHJvbGxlckNvbmZpZz8ucG9saWNpZXMsXG4gICAgICAgICAgICByZXNvdXJjZUFjY2VzczogY29udHJvbGxlckNvbmZpZz8ucmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICBhbGxvd1NlbmRFbWFpbDogdHJ1ZSxcbiAgICAgICAgICAgIGZ1bmN0aW9uVGltZW91dDogY29udHJvbGxlckNvbmZpZz8uZnVuY3Rpb25UaW1lb3V0IHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblRpbWVvdXQsXG4gICAgICAgICAgICBwcm9jZXNzb3JBcmNoaXRlY3R1cmU6IGNvbnRyb2xsZXJDb25maWc/LnByb2Nlc3NvckFyY2hpdGVjdHVyZSxcbiAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IGZ1bmN0aW9uUHJvcHMsXG4gICAgICAgICAgICBsb2dSZXRlbnRpb25EYXlzOiBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiBjb250cm9sbGVyQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFjdERlZmF1bHRBdXRob3JpemVyID0gKGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnV2l0aEF1dGhvcml6ZXIpOiB7IGRlZmF1bHRBdXRob3JpemVyTmFtZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplclR5cGU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IHRoaXMuZncyNC5nZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKCk7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgbGV0IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29udHJvbGxlckNvbmZpZz8uYXV0aG9yaXplcikpIHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRBdXRob3JpemVyID0gKGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplciBhcyBJQXV0aG9yaXplckNvbmZpZ1tdKS5maW5kKChhdXRoKSA9PiBhdXRoLmRlZmF1bHQpIHx8IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplclsgMCBdO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJOYW1lID0gZGVmYXVsdEF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBkZWZhdWx0QXV0aG9yaXplci50eXBlO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplci5ncm91cHMgfHwgW107XG4gICAgICAgICAgICBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGRlZmF1bHRBdXRob3JpemVyLnJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfHwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplci5uYW1lIHx8IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplci50eXBlO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIuZ3JvdXBzIHx8IFtdO1xuICAgICAgICAgICAgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfHwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXI7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWRlZmF1bHRBdXRob3JpemVyVHlwZSAmJiB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlKSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEF1dGhvcml6YXRpb25UeXBlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSB7XG5cbiAgICAgICAgICAgIC8vIGlmIHRoZSB2YWx1ZSBmb3IgdGhlIGdyb3VwcyBpcyBhIHRlbXBsYXRlIHN0cmluZywgXG4gICAgICAgICAgICAvLyByZXNvbHZlIGl0IFt3aGVuIHRoZSBhcHBsaWNhdGlvbiB3YW50IHRvIGFsbG93IG11bHRpcGxlIHVzZXIgZ3JvdXBzIHRvIGhhdmUgYWNjZXNzXVxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgdmFsdWUgaXMgbGlrZSBcImVudjp4eHg6Z3JvdXAxXCIgPT0+IFwiZ3JvdXAxLXJlc29sdmVkXCIgfHwgXCJncm91cDEsZ3JvdXAyXCIgfHwgXCJlbnY6eHh4Omdyb3VwMSxlbnY6eHh4Omdyb3VwMlwiXG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpKSB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSB0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gbm93IGlmIHRoZSByZXNvbHZlZCB2YWx1ZSBpcyBhZ2FpbiBhIHN0cmluZywgc3BsaXQgaXQgYnkgY29tbWFcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgXCJncm91cDEsZ3JvdXAyXCIgPT0+IFtcImdyb3VwMVwiLCBcImdyb3VwMlwiXVxuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSkge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMuc3BsaXQoJywnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCFkZWZhdWx0QXV0aG9yaXplckdyb3Vwcy5sZW5ndGggJiYgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBZG1pbkdyb3Vwcykge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBZG1pbkdyb3VwcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gcmVzb2x2ZSB0aGUgZ3JvdXAgbmFtZXMgZnJvbSBmdzI0LXNjb3BlIGlmIGl0J3MgYSB0ZW1wbGF0ZVxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgdmFsdWUgaXMgbGlrZSBbXCJlbnY6eHh4Omdyb3VwMVwiLFwiZW52Onh4eDpncm91cDJcIl0gPT0+IFtcImdyb3VwMS1yZXNvbHZlZFwiLCBcImdyb3VwMi1yZXNvbHZlZFwiXVxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSAoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgYXMgQXJyYXk8c3RyaW5nPikubWFwKHRoaXMuZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUpO1xuXG4gICAgICAgICAgICAvLyBmbGF0LW1hcCB0aGUgZ3JvdXBzIGlmIHRoZXkgcmVzb2x2ZWQgZ3JvdXAgdmFsdWVzIGFyZSBhZ2FpbiBjb21tYSBzZXBhcmF0ZWRcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHJlc29sdmVkIHZhbHVlIGlzIGxpa2UgW1wiYSxiXCIsIFwiYyxkXCJdID09PiBbXCJhXCIsIFwiYlwiLCBcImNcIiwgXCJkXCJdXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLmZsYXRNYXAoZ3JvdXAgPT4gZ3JvdXAuc3BsaXQoJywnKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBFbnN1cmUgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgaXMgYWx3YXlzIGFuIGFycmF5XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRHcm91cHM6IHN0cmluZ1tdID0gIWRlZmF1bHRBdXRob3JpemVyR3JvdXBzIFxuICAgICAgICAgICAgPyBbXSBcbiAgICAgICAgICAgIDogQXJyYXkuaXNBcnJheShkZWZhdWx0QXV0aG9yaXplckdyb3VwcykgXG4gICAgICAgICAgICAgICAgPyBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyBcbiAgICAgICAgICAgICAgICA6IFtkZWZhdWx0QXV0aG9yaXplckdyb3Vwc107XG5cbiAgICAgICAgcmV0dXJuIHsgXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUsIFxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzOiBub3JtYWxpemVkR3JvdXBzLCBcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0T3JDcmVhdGVSb3V0ZVJlc291cmNlID0gKHBhcmVudFJlc291cmNlOiBJUmVzb3VyY2UsIHBhdGg6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogSVJlc291cmNlID0+IHtcbiAgICAgICAgbGV0IGN1cnJlbnRSZXNvdXJjZTogSVJlc291cmNlID0gcGFyZW50UmVzb3VyY2U7XG4gICAgICAgIGNvbnN0IHJlc3RBUEkgPSB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhdGhQYXJ0IG9mIHBhdGguc3BsaXQoXCIvXCIpKSB7XG4gICAgICAgICAgICBpZiAocGF0aFBhcnQgPT09IFwiXCIpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IGNoaWxkUmVzb3VyY2UgPSBjdXJyZW50UmVzb3VyY2UuZ2V0UmVzb3VyY2UocGF0aFBhcnQpO1xuICAgICAgICAgICAgaWYgKCFjaGlsZFJlc291cmNlKSB7XG4gICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IGN1cnJlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZShwYXRoUGFydCk7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlcy5wdXNoKGNoaWxkUmVzb3VyY2UpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN1cnJlbnRSZXNvdXJjZSA9IGNoaWxkUmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3VycmVudFJlc291cmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFjdFJvdXRlQXV0aG9yaXplciA9IChyb3V0ZTogSVJvdXRlV2l0aEF1dGhvcml6ZXIsIGRlZmF1bHRBdXRob3JpemVyVHlwZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbik6IHsgcm91dGVBdXRob3JpemVyTmFtZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplck5hbWUgPSBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcblxuICAgICAgICBpZiAocm91dGUuYXV0aG9yaXplciAmJiB0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyLnR5cGUgfHwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyTmFtZSA9IHJvdXRlLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBjb25zdCByb3V0ZUdyb3VwcyA9IHJvdXRlLmF1dGhvcml6ZXIuZ3JvdXBzIHx8IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyR3JvdXBzID0gIXJvdXRlR3JvdXBzIFxuICAgICAgICAgICAgICAgID8gW10gXG4gICAgICAgICAgICAgICAgOiBBcnJheS5pc0FycmF5KHJvdXRlR3JvdXBzKSBcbiAgICAgICAgICAgICAgICAgICAgPyByb3V0ZUdyb3VwcyBcbiAgICAgICAgICAgICAgICAgICAgOiBbcm91dGVHcm91cHNdO1xuICAgICAgICAgICAgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gcm91dGUuYXV0aG9yaXplci5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiByb3V0ZS5hdXRob3JpemVyID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyVHlwZSA9IHJvdXRlLmF1dGhvcml6ZXI7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyByb3V0ZUF1dGhvcml6ZXJOYW1lLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlTWV0aG9kT3B0aW9ucyA9IChyb3V0ZTogSVJvdXRlV2l0aEF1dGhvcml6ZXIsIHJvdXRlQXV0aG9yaXplclR5cGU6IHN0cmluZywgcm91dGVBdXRob3JpemVyTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkLCBjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZyk6IE1ldGhvZE9wdGlvbnMgPT4ge1xuICAgICAgICBjb25zdCByZXF1ZXN0UGFyYW1ldGVyczogeyBbIGtleTogc3RyaW5nIF06IGJvb2xlYW4gfSA9IHt9O1xuXG4gICAgICAgIC8vIEFkZCBwYXRoIHBhcmFtZXRlcnNcbiAgICAgICAgZm9yIChjb25zdCBwYXJhbSBvZiByb3V0ZS5wYXJhbWV0ZXJzIHx8IFtdKSB7XG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyc1sgYG1ldGhvZC5yZXF1ZXN0LnBhdGguJHtwYXJhbX1gIF0gPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIEFQSSBrZXkgaGVhZGVyIHJlcXVpcmVtZW50IGlmIHNwZWNpZmllZFxuICAgICAgICBpZiAoY29udHJvbGxlckNvbmZpZy5yZXF1aXJlQXBpS2V5KSB7XG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyc1sgJ21ldGhvZC5yZXF1ZXN0LmhlYWRlci54LWFwaS1rZXknIF0gPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgdGhlIGF1dGhvcml6ZXIgaXMgSldULCBjb252ZXJ0IGl0IHRvIENVU1RPTVxuICAgICAgICBjb25zdCBhdXRob3JpemVyID0gdGhpcy5mdzI0LmdldEF1dGhvcml6ZXIocm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyTmFtZSk7XG4gICAgICAgIGlmIChyb3V0ZUF1dGhvcml6ZXJUeXBlID09PSAnSldUJykge1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyVHlwZSA9ICdDVVNUT00nO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzLFxuICAgICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IHJvdXRlQXV0aG9yaXplclR5cGUgYXMgQXV0aG9yaXphdGlvblR5cGUsXG4gICAgICAgICAgICBhdXRob3JpemVyOiBhdXRob3JpemVyLFxuICAgICAgICAgICAgYXBpS2V5UmVxdWlyZWQ6IGNvbnRyb2xsZXJDb25maWcucmVxdWlyZUFwaUtleSB8fCBmYWxzZVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlU1FTSW50ZWdyYXRpb24gPSAocXVldWVOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IEF3c0ludGVncmF0aW9uID0+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIFNRUyBpbnRlZ3JhdGlvbiBmb3IgcXVldWUgJHtxdWV1ZU5hbWV9IGluIGNvbnRyb2xsZXIgJHtjb250cm9sbGVyTmFtZX0gaW4gc3RhY2sgJHtjb250cm9sbGVyU3RhY2tOYW1lfWApO1xuICAgICAgICBjb25zdCBpbnRlZ3JhdGlvblJvbGUgPSBuZXcgUm9sZSh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3F1ZXVlTmFtZX0tc3FzLWludGVncmF0aW9uLXJvbGVgLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwiYXBpZ2F0ZXdheS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcXVldWVBcm4gPSB0aGlzLmZ3MjQuZ2V0QXJuKCdzcXMnLCB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShxdWV1ZU5hbWUgKyAnX3F1ZXVlTmFtZScsICdxdWV1ZScsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSkpO1xuICAgICAgICBjb25zdCBxdWV1ZUluc3RhbmNlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7cXVldWVOYW1lfS1xdWV1ZWAsIHF1ZXVlQXJuKTtcbiAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFNlbmRNZXNzYWdlcyhpbnRlZ3JhdGlvblJvbGUpO1xuICAgICAgICByZXR1cm4gbmV3IEF3c0ludGVncmF0aW9uKHtcbiAgICAgICAgICAgIHNlcnZpY2U6IFwic3FzXCIsXG4gICAgICAgICAgICBwYXRoOiB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudCArIFwiL1wiICsgcXVldWVJbnN0YW5jZS5xdWV1ZU5hbWUsXG4gICAgICAgICAgICBpbnRlZ3JhdGlvbkh0dHBNZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNyZWRlbnRpYWxzUm9sZTogaW50ZWdyYXRpb25Sb2xlLFxuICAgICAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiaW50ZWdyYXRpb24ucmVxdWVzdC5oZWFkZXIuQ29udGVudC1UeXBlXCI6IFwiJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCdcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJhcHBsaWNhdGlvbi9qc29uXCI6IGBBY3Rpb249U2VuZE1lc3NhZ2UmTWVzc2FnZUJvZHk9JHV0aWwudXJsRW5jb2RlKCRpbnB1dC5ib2R5KWAsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZVNOU0ludGVncmF0aW9uID0gKHRvcGljTmFtZTogc3RyaW5nLCBjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBBd3NJbnRlZ3JhdGlvbiA9PiB7XG4gICAgICAgIGNvbnN0IGludGVncmF0aW9uUm9sZSA9IG5ldyBSb2xlKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7dG9waWNOYW1lfS1zbnMtaW50ZWdyYXRpb24tcm9sZWAsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0b3BpY0FybiA9IHRoaXMuZncyNC5nZXRBcm4oJ3NucycsIHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSArICdfdG9waWNOYW1lJywgJ3RvcGljJywgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKSk7XG4gICAgICAgIGNvbnN0IHRvcGljSW5zdGFuY2UgPSBUb3BpYy5mcm9tVG9waWNBcm4odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHt0b3BpY05hbWV9LXRvcGljYCwgdG9waWNBcm4pO1xuICAgICAgICB0b3BpY0luc3RhbmNlLmdyYW50UHVibGlzaChpbnRlZ3JhdGlvblJvbGUpO1xuICAgICAgICByZXR1cm4gbmV3IEF3c0ludGVncmF0aW9uKHtcbiAgICAgICAgICAgIHNlcnZpY2U6IFwic25zXCIsXG4gICAgICAgICAgICBwYXRoOiAnLycsXG4gICAgICAgICAgICBpbnRlZ3JhdGlvbkh0dHBNZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNyZWRlbnRpYWxzUm9sZTogaW50ZWdyYXRpb25Sb2xlLFxuICAgICAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiaW50ZWdyYXRpb24ucmVxdWVzdC5oZWFkZXIuQ29udGVudC1UeXBlXCI6IFwiJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCdcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJhcHBsaWNhdGlvbi9qc29uXCI6IGBBY3Rpb249UHVibGlzaCZUb3BpY0Fybj0kdXRpbC51cmxFbmNvZGUoJyR7dG9waWNJbnN0YW5jZS50b3BpY0Fybn0nKSZNZXNzYWdlPSR1dGlsLnVybEVuY29kZSgkaW5wdXQuYm9keSlgLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRBcGlFbmRwb2ludCA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyUmVzb3VyY2U6IElSZXNvdXJjZSwgc3RhZ2VOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZykgPT4ge1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYEVuZHBvaW50JHtjb250cm9sbGVyTmFtZX1gLCB7XG4gICAgICAgICAgICB2YWx1ZTogJ2h0dHBzOi8vJyArIHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaS5yZXN0QXBpSWQgKyAnLmV4ZWN1dGUtYXBpLicgKyB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkucmVnaW9uICsgJy5hbWF6b25hd3MuY29tLycgKyBzdGFnZU5hbWUgKyAnLycgKyBjb250cm9sbGVyUmVzb3VyY2UucGF0aC5zbGljZSgxKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBHYXRld2F5IEVuZHBvaW50IGZvciBcIiArIGNvbnRyb2xsZXJOYW1lLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNldHVwVXNhZ2VQbGFuKHBsYW5Db25maWc/OiBJVXNhZ2VQbGFuQ29uZmlnLCBjcmVhdGVLZXk6IGJvb2xlYW4gPSBmYWxzZSk6IHsgcGxhbjogVXNhZ2VQbGFuOyBuYW1lOiBzdHJpbmcgfSB7XG4gICAgICAgIC8vIElmIG5vIHBsYW4gY29uZmlnIGlzIHByb3ZpZGVkIGFuZCB3ZSBuZWVkIGEga2V5LCB1c2UgdGhlIGZpcnN0IGNvbmZpZ3VyZWQgcGxhbiBvciBjcmVhdGUgYSBkZWZhdWx0IG9uZVxuICAgICAgICBpZiAoIXBsYW5Db25maWcgJiYgY3JlYXRlS2V5KSB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gdXNlIHRoZSBmaXJzdCBjb25maWd1cmVkIHBsYW4gdGhhdCBoYXMgQVBJIGtleXNcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZ3VyZWRQbGFuID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucz8uZmluZChwbGFuID0+IHBsYW4uYXBpS2V5cyk7XG4gICAgICAgICAgICBpZiAoY29uZmlndXJlZFBsYW4pIHtcbiAgICAgICAgICAgICAgICBwbGFuQ29uZmlnID0gY29uZmlndXJlZFBsYW47XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIElmIG5vIGNvbmZpZ3VyZWQgcGxhbiB3aXRoIGtleXMgZXhpc3RzLCBjcmVhdGUgYSBkZWZhdWx0IHBsYW5cbiAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBhIGRldGVybWluaXN0aWMga2V5IGJhc2VkIG9uIGFwcCBuYW1lIGFuZCBhIGZpeGVkIGlkZW50aWZpZXJcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0S2V5ID0gY3JlYXRlSGFzaCgnc2hhMjU2JylcbiAgICAgICAgICAgICAgICAgICAgLnVwZGF0ZShgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudH0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkucmVnaW9ufS0ke3RoaXMuZncyNC5nZXRDb25maWcoKS5lbnZpcm9ubWVudH0tZGVmYXVsdC1hcGkta2V5YClcbiAgICAgICAgICAgICAgICAgICAgLmRpZ2VzdCgnaGV4JylcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDMyKTsgLy8gVXNlIGZpcnN0IDMyIGNoYXJzIGZvciBhIHJlYXNvbmFibGUga2V5IGxlbmd0aFxuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gdXNhZ2UgcGxhbiB3aXRoIEFQSSBrZXlzIGZvdW5kLCBjcmVhdGluZyBhIGRlZmF1bHQgb25lLiBUaGlzIGlzIG5vdCByZWNvbW1lbmRlZCBmb3IgcHJvZHVjdGlvbiBlbnZpcm9ubWVudHMuIFBsZWFzZSBjb25maWd1cmUgYSB1c2FnZSBwbGFuIHdpdGggQVBJIGtleXMgZm9yIHlvdXIgQVBJLmApO1xuXG4gICAgICAgICAgICAgICAgcGxhbkNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWRlZmF1bHQtdXNhZ2UtcGxhbmAsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgRGVmYXVsdCB1c2FnZSBwbGFuIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleXM6IFsgZGVmYXVsdEtleSBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGxhbk5hbWUgPSBwbGFuQ29uZmlnPy5uYW1lIHx8IGAke3RoaXMuZncyNC5hcHBOYW1lfS1kZWZhdWx0LXVzYWdlLXBsYW5gO1xuXG4gICAgICAgIGlmICghdGhpcy51c2FnZVBsYW5zLmhhcyhwbGFuTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFNldHRpbmcgdXAgdXNhZ2UgcGxhbjogJHtwbGFuTmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0IHVzYWdlUGxhbiA9IG5ldyBVc2FnZVBsYW4odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3BsYW5OYW1lfS11c2FnZS1wbGFuYCwge1xuICAgICAgICAgICAgICAgIG5hbWU6IHBsYW5OYW1lLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBwbGFuQ29uZmlnPy5kZXNjcmlwdGlvbiB8fCBgVXNhZ2UgcGxhbiBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgIGFwaVN0YWdlczogWyB7XG4gICAgICAgICAgICAgICAgICAgIGFwaTogdGhpcy5hcGksXG4gICAgICAgICAgICAgICAgICAgIHN0YWdlOiB0aGlzLmFwaS5kZXBsb3ltZW50U3RhZ2VcbiAgICAgICAgICAgICAgICB9IF0sXG4gICAgICAgICAgICAgICAgdGhyb3R0bGU6IHtcbiAgICAgICAgICAgICAgICAgICAgcmF0ZUxpbWl0OiBwbGFuQ29uZmlnPy5yYXRlTGltaXQgfHwgMTAsXG4gICAgICAgICAgICAgICAgICAgIGJ1cnN0TGltaXQ6IHBsYW5Db25maWc/LmJ1cnN0TGltaXQgfHwgMjBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHF1b3RhOiB7XG4gICAgICAgICAgICAgICAgICAgIGxpbWl0OiBwbGFuQ29uZmlnPy5xdW90YUxpbWl0IHx8IDEwMDAwLFxuICAgICAgICAgICAgICAgICAgICBwZXJpb2Q6IHBsYW5Db25maWc/LnF1b3RhUGVyaW9kIHx8IFBlcmlvZC5NT05USFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy51c2FnZVBsYW5zLnNldChwbGFuTmFtZSwgeyBwbGFuOiB1c2FnZVBsYW4sIG5hbWU6IHBsYW5OYW1lIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGlLZXlzLnNldChwbGFuTmFtZSwgW10pO1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgQVBJIGtleXMgaWYgY29uZmlndXJlZCBmb3IgdGhpcyB1c2FnZSBwbGFuXG4gICAgICAgICAgICBpZiAocGxhbkNvbmZpZz8uYXBpS2V5cykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENyZWF0aW5nIEFQSSBrZXlzIGZvciB1c2FnZSBwbGFuOiAke3BsYW5OYW1lfWApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGtleXMgPSBwbGFuQ29uZmlnLmFwaUtleXMua2V5cyB8fCBbXTtcbiAgICAgICAgICAgICAgICBrZXlzLmZvckVhY2goKGtleSwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBrZXkgbmFtZSBmcm9tIGNvbmZpZyBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSB1c2UgdGhlIHByZWZpeCBvciBnZW5lcmF0ZSBhIG5hbWVcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5TmFtZSA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaUtleUNvbmZpZz8ua2V5TmFtZSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgKHBsYW5Db25maWcuYXBpS2V5cz8ua2V5TmFtZVByZWZpeFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYCR7cGxhbkNvbmZpZy5hcGlLZXlzLmtleU5hbWVQcmVmaXh9LSR7aW5kZXh9YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWFwaS1rZXktJHtpbmRleH1gKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBrZXkgYWxyZWFkeSBleGlzdHNcbiAgICAgICAgICAgICAgICAgICAgbGV0IGV4aXN0aW5nS2V5ID0gdGhpcy5rZXlWYWx1ZXMuZ2V0KGtleSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RpbmdLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nS2V5ID0gbmV3IEFwaUtleSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0tYXBpLWtleWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIGtleSAke2luZGV4ICsgMX0gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZToga2V5XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0taWRgLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGV4aXN0aW5nS2V5LmtleUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIEtleSAke2luZGV4ICsgMX0gSUQgZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMua2V5VmFsdWVzLnNldChrZXksIGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHVzYWdlUGxhbi5hZGRBcGlLZXkoZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhcGlLZXlzTGlzdCA9IHRoaXMuYXBpS2V5cy5nZXQocGxhbk5hbWUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXBpS2V5c0xpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwaUtleXNMaXN0LnB1c2goZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB1c2FnZVBsYW4gPSB0aGlzLnVzYWdlUGxhbnMuZ2V0KHBsYW5OYW1lKTtcbiAgICAgICAgaWYgKCF1c2FnZVBsYW4pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVXNhZ2UgcGxhbiAke3BsYW5OYW1lfSBub3QgZm91bmRgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXNhZ2VQbGFuO1xuICAgIH1cblxufVxuIl19