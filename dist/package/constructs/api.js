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
            const controllerLambda = this.createLambdaFunction(controllerName, filePath, fileName, controllerConfig, controllerStackName, handlerClass.name);
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
        // Store routing metadata for simulator
        const simulatedApi = this.fw24.getEnvironmentVariable('SIMULATED_API_ROUTES') || [];
        for (const route of Object.values(controllerInfo.routes ?? {})) {
            const { routeAuthorizerType, routeAuthorizerName, routeAuthorizerGroups } = this.extractRouteAuthorizer(route, defaultAuthorizerType, defaultAuthorizerName, defaultAuthorizerGroups, defaultRequireRouteInGroupConfig);
            simulatedApi.push({
                controllerName,
                httpMethod: route.httpMethod,
                path: `/${controllerName}${route.path}`,
                handlerId: controllerName + "-controller", // This matches the ID used in LambdaFunction
                authorizer: {
                    type: routeAuthorizerType,
                    name: routeAuthorizerName,
                    groups: routeAuthorizerGroups
                }
            });
        }
        this.fw24.setEnvironmentVariable('SIMULATED_API_ROUTES', simulatedApi);
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
    createLambdaFunction = (controllerName, filePath, fileName, controllerConfig, controllerStackName, handlerClassName) => {
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
            handlerClassName,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVNBLCtEQVVvQztBQUVwQyw2Q0FBcUY7QUFFckYsaURBQTZEO0FBRTdELGlEQUE0QztBQUM1QyxpREFBNEM7QUFNNUMsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx1REFBeUY7QUFDekYsd0NBQTBDO0FBRTFDLG9DQUFpQztBQUNqQyx1REFBbUQ7QUFDbkQsNkRBQXlEO0FBNEJ6RCw2Q0FBcUQ7QUFDckQscUNBQThEO0FBQzlELDBEQUE2QjtBQUU3QixrQ0FBbUM7QUFFbkMsb0NBQTZDO0FBQzdDLGlDQUF1QztBQUN2QywrQ0FBcUQ7QUFDckQseUNBQStDO0FBQy9DLG1DQUF5QztBQUN6QyxxQ0FBMkM7QUFDM0MsbUNBQXlDO0FBQ3pDLG1DQUF5QztBQUN6QywrQkFBcUM7QUF3SXJDLE1BQWEsWUFBWTtJQW1CUTtJQWxCcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDekMsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsWUFBWSxDQUFDLElBQUksQ0FBQztJQUNqQyxZQUFZLEdBQWEsQ0FBRSxrQkFBWSxDQUFDLElBQUksRUFBRSx3QkFBZSxDQUFDLElBQUksRUFBRSw0QkFBaUIsQ0FBQyxJQUFJLEVBQUUsb0JBQWEsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLENBQUUsQ0FBQztJQUNoTCxNQUFNLENBQXVCO0lBRTdCLEdBQUcsQ0FBVztJQUNkLFNBQVMsQ0FBUztJQUNsQixVQUFVLEdBQW1ELElBQUksR0FBRyxFQUFFLENBQUM7SUFDdkUsT0FBTyxHQUEwQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lB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QUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztvQkFDL0MsSUFBSSxXQUFXLEVBQUUsQ0FBQzt3QkFDZCxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO29CQUNsQyxDQUFDO2dCQUNMLENBQUMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztRQUNMLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNoRCxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDYixNQUFNLElBQUksS0FBSyxDQUFDLGNBQWMsUUFBUSxZQUFZLENBQUMsQ0FBQztRQUN4RCxDQUFDO1FBQ0QsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztDQUVKO0FBeDFCRCxvQ0F3MUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUge1xuICAgIEF1dGhvcml6YXRpb25UeXBlLFxuICAgIENvcnNPcHRpb25zLFxuICAgIElSZXNvdXJjZSxcbiAgICBNZXRob2QsXG4gICAgTWV0aG9kT3B0aW9ucyxcbiAgICBSZXN0QXBpUHJvcHNcbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5cbmltcG9ydCB7XG4gICAgQXdzSW50ZWdyYXRpb24sXG4gICAgQ29ycyxcbiAgICBEZXBsb3ltZW50LFxuICAgIFJlc291cmNlLFxuICAgIFJlc3BvbnNlVHlwZSxcbiAgICBSZXN0QXBpLFxuICAgIEFwaUtleSxcbiAgICBQZXJpb2QsXG4gICAgVXNhZ2VQbGFuXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuXG5pbXBvcnQgeyBDZm5PdXRwdXQsIER1cmF0aW9uLCBOZXN0ZWRTdGFjaywgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5cbmltcG9ydCB0eXBlIHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi4vY29yZS9cIjtcbmltcG9ydCB0eXBlIEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuXG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCBNdXRhYmxlIGZyb20gXCIuLi90eXBlcy9tdXRhYmxlXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24gfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IExhbWJkYUludGVncmF0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWludGVncmF0aW9uXCI7XG5cbmludGVyZmFjZSBJQVBJUmVmZXJlbmNlIHtcbiAgICBhcGk6IFJlc3RBcGk7XG4gICAgaXNJbXBvcnRlZDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIElBdXRob3JpemVyQ29uZmlnIHtcbiAgICBuYW1lPzogc3RyaW5nO1xuICAgIHR5cGU/OiBzdHJpbmc7XG4gICAgZ3JvdXBzPzogc3RyaW5nIHwgc3RyaW5nW107XG4gICAgcmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZz86IGJvb2xlYW47XG4gICAgZGVmYXVsdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBJQ29udHJvbGxlckNvbmZpZ1dpdGhBdXRob3JpemVyIGV4dGVuZHMgSUNvbnRyb2xsZXJDb25maWcge1xuICAgIHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc/OiBib29sZWFuO1xuICAgIGF1dGhvcml6ZXI/OiBzdHJpbmcgfCBJQXV0aG9yaXplckNvbmZpZyB8IElBdXRob3JpemVyQ29uZmlnW107XG59XG5cbmludGVyZmFjZSBJUm91dGVXaXRoQXV0aG9yaXplciB7XG4gICAgaHR0cE1ldGhvZDogc3RyaW5nO1xuICAgIHBhdGg6IHN0cmluZztcbiAgICB0YXJnZXQ/OiBzdHJpbmc7XG4gICAgcGFyYW1ldGVycz86IHN0cmluZ1tdIHwgU3RyaW5nW107XG4gICAgYXV0aG9yaXplcj86IHN0cmluZyB8IElBdXRob3JpemVyQ29uZmlnO1xufVxuXG5pbXBvcnQgeyBjcmVhdGVIYXNoLCByYW5kb21VVUlEIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCI7XG5pbXBvcnQgeyBjb3B5RmlsZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IElDb250cm9sbGVyQ29uZmlnIH0gZnJvbSBcIi4uL2RlY29yYXRvcnMvY29udHJvbGxlclwiO1xuaW1wb3J0IHsgRU5WX0tFWVMgfSBmcm9tIFwiLi4vZncyNFwiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGlzQXJyYXksIGlzU3RyaW5nIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBBdXRoQ29uc3RydWN0IH0gZnJvbSBcIi4vYXV0aFwiO1xuaW1wb3J0IHsgQ2VydGlmaWNhdGVDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jZXJ0aWZpY2F0ZVwiO1xuaW1wb3J0IHsgRHluYW1vREJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9keW5hbW9kYlwiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5pbXBvcnQgeyBRdWV1ZUNvbnN0cnVjdCB9IGZyb20gXCIuL3F1ZXVlXCI7XG5pbXBvcnQgeyBUb3BpY0NvbnN0cnVjdCB9IGZyb20gXCIuL3RvcGljXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIGFuIEFQSSBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUFQSUNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgQ09SUyBjb25maWd1cmF0aW9uIGZvciB0aGUgQVBJLlxuICAgICAqIEl0IGNhbiBiZSBhIGJvb2xlYW4gdmFsdWUsIGEgc2luZ2xlIHN0cmluZywgb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncy5cbiAgICAgKi9cbiAgICBjb3JzPzogYm9vbGVhbiB8IHN0cmluZyB8IHN0cmluZ1tdO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIGFkZGl0aW9uYWwgb3B0aW9ucyBmb3IgdGhlIEFQSS5cbiAgICAgKi9cbiAgICBhcGlPcHRpb25zPzogUmVzdEFwaVByb3BzO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIGNvbnRyb2xsZXJzIGFyZSBsb2NhdGVkLlxuICAgICAqL1xuICAgIGNvbnRyb2xsZXJzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvbi5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wcztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgbnVtYmVyIG9mIGRheXMgdG8gcmV0YWluIHRoZSBBUEkgbG9ncy5cbiAgICAgKi9cbiAgICBsb2dSZXRlbnRpb25EYXlzPzogUmV0ZW50aW9uRGF5cztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgcmVtb3ZhbCBwb2xpY3kgZm9yIHRoZSBBUEkgbG9ncy5cbiAgICAgKi9cbiAgICBsb2dSZW1vdmFsUG9saWN5PzogUmVtb3ZhbFBvbGljeTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBjdXN0b20gZG9tYWluIG5hbWUgZm9yIHRoZSBBUEkuXG4gICAgICovXG4gICAgZG9tYWluTmFtZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBjZXJ0aWZpY2F0ZSBBUk4gZm9yIHRoZSBjdXN0b20gZG9tYWluIG5hbWUuXG4gICAgICovXG4gICAgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBBUEkgR2F0ZXdheSBMYW1iZGEgaW50ZWdyYXRpb24gdGltZW91dCBpbiBzZWNvbmRzLlxuICAgICAqL1xuICAgIGludGVncmF0aW9uVGltZW91dD86IG51bWJlcjtcblxuICAgIC8qKlxuICAgICAqIFRoZSBwYXJlbnQgc3RhY2sgbmFtZSBmb3IgdGhlIENvbnRyb2xsZXJzLlxuICAgICAqL1xuICAgIGNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBTZXQgdG8gZmFsc2UgaWYgeW91IHdhbnQgdG8gc2tpcCBjcmVhdGlvbiBvZiBjb250cm9sbGVycyByZXNvdXJjZXMgYW5kIG1ldGhvZHNcbiAgICAgKiBUaGlzIHdpbGwgZGVsZXRlIGFsbCB0aGUgY29udHJvbGxlcnMgcmVzb3VyY2VzIGFuZCBtZXRob2RzIGZyb20gdGhlIEFQSVxuICAgICAqL1xuICAgIHNraXBDb250cm9sbGVycz86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBGb3JjZSBhIGRlcGxveW1lbnQgb2YgdGhlIEFQSSB3aGVuIHVzaW5nIGltcG9ydGVkIEFQSXNcbiAgICAgKi9cbiAgICBmb3JjZURlcGxveW1lbnQ/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogQVBJIGtleSBjb25maWd1cmF0aW9uIGZvciB0aGUgQVBJXG4gICAgICovXG4gICAgYXBpS2V5Q29uZmlnPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogTGlzdCBvZiB2YWxpZCBBUEkga2V5cy4gSWYgZW1wdHksIGtleXMgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZFxuICAgICAgICAgKi9cbiAgICAgICAga2V5cz86IHN0cmluZ1tdO1xuICAgICAgICAvKipcbiAgICAgICAgICogTmFtZSBvZiB0aGUgQVBJIGtleSAodXNlZCB3aGVuIGF1dG8tZ2VuZXJhdGluZylcbiAgICAgICAgICovXG4gICAgICAgIGtleU5hbWU/OiBzdHJpbmc7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFVzYWdlIHBsYW4gY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSVxuICAgICAqL1xuICAgIHVzYWdlUGxhbnM/OiBJVXNhZ2VQbGFuQ29uZmlnW107XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgQVBJIGtleSB3aXRoaW4gYSB1c2FnZSBwbGFuXG4gKi9cbmludGVyZmFjZSBJVXNhZ2VQbGFuQXBpS2V5Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBMaXN0IG9mIHZhbGlkIEFQSSBrZXlzLiBJZiBlbXB0eSwga2V5cyB3aWxsIGJlIGF1dG8tZ2VuZXJhdGVkXG4gICAgICovXG4gICAga2V5cz86IHN0cmluZ1tdO1xuICAgIC8qKlxuICAgICAqIE5hbWUgcHJlZml4IGZvciB0aGUgQVBJIGtleXMgKHVzZWQgd2hlbiBhdXRvLWdlbmVyYXRpbmcpXG4gICAgICovXG4gICAga2V5TmFtZVByZWZpeD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBhIHVzYWdlIHBsYW5cbiAqL1xuaW50ZXJmYWNlIElVc2FnZVBsYW5Db25maWcge1xuICAgIC8qKlxuICAgICAqIE5hbWUgb2YgdGhlIHVzYWdlIHBsYW5cbiAgICAgKi9cbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogRGVzY3JpcHRpb24gb2YgdGhlIHVzYWdlIHBsYW5cbiAgICAgKi9cbiAgICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBSYXRlIGxpbWl0IHBlciBzZWNvbmRcbiAgICAgKi9cbiAgICByYXRlTGltaXQ/OiBudW1iZXI7XG4gICAgLyoqXG4gICAgICogQnVyc3QgbGltaXRcbiAgICAgKi9cbiAgICBidXJzdExpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIFF1b3RhIGxpbWl0IHBlciBwZXJpb2RcbiAgICAgKi9cbiAgICBxdW90YUxpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIFF1b3RhIHBlcmlvZFxuICAgICAqL1xuICAgIHF1b3RhUGVyaW9kPzogUGVyaW9kO1xuICAgIC8qKlxuICAgICAqIEFQSSBrZXkgY29uZmlndXJhdGlvbiBmb3IgdGhpcyB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgYXBpS2V5cz86IElVc2FnZVBsYW5BcGlLZXlDb25maWc7XG59XG5cbmV4cG9ydCBjbGFzcyBBUElDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoQVBJQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBBUElDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gWyBWcGNDb25zdHJ1Y3QubmFtZSwgTWFpbGVyQ29uc3RydWN0Lm5hbWUsIER5bmFtb0RCQ29uc3RydWN0Lm5hbWUsIEF1dGhDb25zdHJ1Y3QubmFtZSwgUXVldWVDb25zdHJ1Y3QubmFtZSwgVG9waWNDb25zdHJ1Y3QubmFtZSwgTGF5ZXJDb25zdHJ1Y3QubmFtZSBdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBhcGkhOiBSZXN0QXBpO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuICAgIHVzYWdlUGxhbnM6IE1hcDxzdHJpbmcsIHsgcGxhbjogVXNhZ2VQbGFuOyBuYW1lOiBzdHJpbmcgfT4gPSBuZXcgTWFwKCk7XG4gICAgYXBpS2V5czogTWFwPHN0cmluZywgQXBpS2V5W10+ID0gbmV3IE1hcCgpO1xuICAgIGtleVZhbHVlczogTWFwPHN0cmluZywgQXBpS2V5PiA9IG5ldyBNYXAoKTtcblxuICAgIHByaXZhdGUgcmVzb3VyY2VzOiBJUmVzb3VyY2VbXSA9IFtdO1xuICAgIHByaXZhdGUgbWV0aG9kczogTWV0aG9kW10gPSBbXTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbnRyb2xsZXJTdGFja3MgPSBuZXcgTWFwPHN0cmluZywgeyBtZXRob2RzOiBNZXRob2RbXSwgcmVzb3VyY2VzOiBJUmVzb3VyY2VbXSwgY29udHJvbGxlcnNIYXNoOiBzdHJpbmdbXSB9PigpO1xuXG4gICAgLy8gZGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhcGlDb25zdHJ1Y3RDb25maWc6IElBUElDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgLy8gaHlkcmF0ZSB0aGUgY29uZmlnIG9iamVjdCB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlcyBleDogQVBJR0FURVdBWV9DT05UUk9MTEVSU1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhhcGlDb25zdHJ1Y3RDb25maWcsICdBUElHQVRFV0FZJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gc2V0IHRoZSBkZWZhdWx0IGFwaSBvcHRpb25zXG4gICAgICAgIGNvbnN0IHBhcmFtc0FwaTogTXV0YWJsZTxSZXN0QXBpUHJvcHM+ID0geyAuLi50aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlPcHRpb25zIHx8IHt9IH07XG4gICAgICAgIC8vIEVuYWJsZSBDT1JTIGlmIGRlZmluZWRcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiRW5hYmxpbmcgQ09SUy4uLiB0aGlzLmNvbmZpZy5jb3JzOiBcIiwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyk7XG4gICAgICAgICAgICBwYXJhbXNBcGkuZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zID0gdGhpcy5nZXRDb3JzUHJlZmxpZ2h0T3B0aW9ucygpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lICYmIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGVDb25zdHJ1Y3QgPSBuZXcgQ2VydGlmaWNhdGVDb25zdHJ1Y3Qoe1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgY2VydGlmaWNhdGVBcm46IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNlcnRpZmljYXRlQXJuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNlcnRpZmljYXRlQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGUgPSBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5vdXRwdXRbIE91dHB1dFR5cGUuQ0VSVElGSUNBVEUgXVsgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSBdO1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRvbWFpbk5hbWUgPSB7XG4gICAgICAgICAgICAgICAgZG9tYWluTmFtZTogdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSxcbiAgICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZTogY2VydGlmaWNhdGUsXG4gICAgICAgICAgICAgICAgYmFzZVBhdGg6IHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zPy5zdGFnZU5hbWUgfHwgJy8nLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBmb3IgbXVsdGlzdGFjayBhcHBsaWNhdGlvbiwgc2V0IGRlcGxveSB0byBmYWxzZVxuICAgICAgICBpZiAodGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBwYXJhbXNBcGkuZGVwbG95ID0gZmFsc2U7XG4gICAgICAgICAgICBkZWxldGUgcGFyYW1zQXBpLmRlcGxveU9wdGlvbnM7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBBUEkgR2F0ZXdheS4uLiBcIik7XG4gICAgICAgIC8vIGdldCB0aGUgbWFpbiBzdGFjayBmcm9tIHRoZSBmcmFtZXdvcmtcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICAvLyBjcmVhdGUgdGhlIGFwaSBnYXRld2F5XG4gICAgICAgIHRoaXMuYXBpID0gbmV3IFJlc3RBcGkodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS1hcGlgLCB7XG4gICAgICAgICAgICAuLi5wYXJhbXNBcGksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKSB7XG4gICAgICAgICAgICBjb25zdCBjb3JzT3JpZ2lucyA9IHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKS5hbGxvd09yaWdpbnM/LmpvaW4oJywnKTtcbiAgICAgICAgICAgIHRoaXMuYXBpLmFkZEdhdGV3YXlSZXNwb25zZSgnZGVmYXVsdDR4eCcsIHtcbiAgICAgICAgICAgICAgICB0eXBlOiBSZXNwb25zZVR5cGUuREVGQVVMVF80WFgsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VIZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBgJyR7Y29yc09yaWdpbnN9J2AsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLmFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ2RlZmF1bHQ1eHgnLCB7XG4gICAgICAgICAgICAgICAgdHlwZTogUmVzcG9uc2VUeXBlLkRFRkFVTFRfNVhYLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlSGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYCcke2NvcnNPcmlnaW5zfSdgLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHVwIHVzYWdlIHBsYW5zIGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnM/Lmxlbmd0aCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwbGFuQ29uZmlnIG9mIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNldHVwVXNhZ2VQbGFuKHBsYW5Db25maWcpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5mdzI0LmFkZEFQSSh0aGlzLm5hbWUsICdyb290JywgdGhpcy5hcGksIGZhbHNlKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCAncmVzdEFQSScsIHRoaXMuYXBpLCBPdXRwdXRUeXBlLkFQSSwgJ3Jlc3RBcGlJZCcpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsICdyZXN0QVBJJywgdGhpcy5hcGksIE91dHB1dFR5cGUuQVBJLCAncmVzdEFwaVJvb3RSZXNvdXJjZUlkJyk7XG5cbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnNraXBDb250cm9sbGVycykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5yZWdpc3RlckNvbnRyb2xsZXJzKCk7XG5cbiAgICAgICAgLy8gaWYgbXVsdGkvbmVzdGVkLXN0YWNrIHNldHVwLCB0aGVuIGNyZWF0ZSBvbmUgZGVwbG95bWVudCBwZXIgY29udHJvbGxlciBzdGFja1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBBUEktZ2F0ZXdheSBjb25zdHJ1Y3Q6ICR7dGhpcy5uYW1lfSBoYXMgaW1wb3J0ZWQgQVBJczogJHt0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKX1gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpICYmIHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVEZXBsb3ltZW50cygpO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZVNpbmdsZURlcGxveW1lbnQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0QVBJID0gKHN0YWNrTmFtZTogc3RyaW5nKTogSUFQSVJlZmVyZW5jZSA9PiB7XG4gICAgICAgIGxldCBjdXJyZW50QVBJID0gdGhpcy5mdzI0LmdldEFQSSh0aGlzLm5hbWUsICdyb290JykgYXMgSUFQSVJlZmVyZW5jZSB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBpZiB0aGUgc3RhY2sgaXMgbm90IHRoZSBtYWluIHN0YWNrIGFuZCBpdHMgYSBtdWx0aS1zdGFjayBhcHBsaWNhdGlvbiBvciBhIG5lc3RlZCBzdGFjaywgdGhlbiBpbXBvcnQgdGhlIEFQSVxuICAgICAgICBjb25zdCBjdXJyZW50U3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2soc3RhY2tOYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEN1cnJlbnQgU3RhY2s6ICR7Y3VycmVudFN0YWNrLnN0YWNrTmFtZX0gaXMgbmVzdGVkIHN0YWNrOiAke2N1cnJlbnRTdGFjayBpbnN0YW5jZW9mIE5lc3RlZFN0YWNrfWApO1xuICAgICAgICBpZiAodGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cChzdGFja05hbWUsIHRoaXMubWFpblN0YWNrKSB8fCBjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFjaykge1xuICAgICAgICAgICAgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCBzdGFja05hbWUpIGFzIElBUElSZWZlcmVuY2UgfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICBpZiAoIWN1cnJlbnRBUEkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRlZEFQSSA9IFJlc3RBcGkuZnJvbVJlc3RBcGlBdHRyaWJ1dGVzKGN1cnJlbnRTdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7c3RhY2tOYW1lfS1hcGlgLCB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3RBcGlJZDogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ3Jlc3RBUElfcmVzdEFwaUlkJywgJ2FwaScsIGN1cnJlbnRTdGFjayksXG4gICAgICAgICAgICAgICAgICAgIHJvb3RSZXNvdXJjZUlkOiB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgncmVzdEFQSV9yZXN0QXBpUm9vdFJlc291cmNlSWQnLCAnYXBpJywgY3VycmVudFN0YWNrKSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkQVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lLCBpbXBvcnRlZEFQSSwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCBzdGFja05hbWUpIGFzIElBUElSZWZlcmVuY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWN1cnJlbnRBUEkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQVBJIG5vdCBmb3VuZCBmb3Igc3RhY2s6ICR7c3RhY2tOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGN1cnJlbnRBUEk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyByZWdpc3RlckNvbnRyb2xsZXJzKCkge1xuICAgICAgICAvLyBzZXRzIHRoZSBkZWZhdWx0IGNvbnRyb2xsZXJzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBjb25zdCBjb250cm9sbGVyc0RpcmVjdG9yeSA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJzRGlyZWN0b3J5IHx8IFwiLi9zcmMvY29udHJvbGxlcnNcIjtcblxuICAgICAgICAvLyByZWdpc3RlciB0aGUgY29udHJvbGxlcnNcbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoY29udHJvbGxlcnNEaXJlY3RvcnksIHRoaXMucmVnaXN0ZXJDb250cm9sbGVyKTtcblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlcyA9IHRoaXMuZncyNC5nZXRNb2R1bGVzKCk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgbW9kdWxlcyBcIiwgQXJyYXkuZnJvbShtb2R1bGVzLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgbW9kdWxlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkxvYWQgY29udHJvbGxlcnMgZnJvbSBtb2R1bGUgYmFzZS1wYXRoOiBcIiwgYmFzZVBhdGgpO1xuXG4gICAgICAgICAgICAgICAgSGVscGVyLnJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlKFxuICAgICAgICAgICAgICAgICAgICBtb2R1bGUsXG4gICAgICAgICAgICAgICAgICAgIChkZXNjOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdGhpcy5yZWdpc3RlckNvbnRyb2xsZXIoZGVzYywgbW9kdWxlKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgTk8gbW9kdWxlcyBcIik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWdpc3RlciBzeXN0ZW0gY29udHJvbGxlcnMgZnJvbSBmdzI0IHNpbmdsZXRvblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc1N5c3RlbUNvbnRyb2xsZXJzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogcmVnaXN0ZXJpbmcgc3lzdGVtIGNvbnRyb2xsZXJzXCIpO1xuXG4gICAgICAgICAgICAvLyBDb3B5IHN5c3RlbSBjb250cm9sbGVycyB0byBhcHAgZGlzdCBhbmQgcmVnaXN0ZXIgZnJvbSB0aGVyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb3B5QW5kUmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVycygpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIE5PIHN5c3RlbSBjb250cm9sbGVyc1wiKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY29weUFuZFJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcnMoKSB7XG4gICAgICAgIGNvbnN0IHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICdkaXN0JywgJ3N5c3RlbS1jb250cm9sbGVycycpO1xuXG4gICAgICAgIC8vIEVuc3VyZSB0YXJnZXQgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIpKSB7XG4gICAgICAgICAgICBta2RpclN5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzeXN0ZW1Db250cm9sbGVyIG9mIHRoaXMuZncyNC5nZXRTeXN0ZW1Db250cm9sbGVycygpKSB7XG4gICAgICAgICAgICBsZXQgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayA9ICcnO1xuICAgICAgICAgICAgLy8gRmFsbGJhY2s6IHVzZSB0aGUgbGFzdCBmZXcgZGlyZWN0b3JpZXMgdG8gcHJlc2VydmUgc3RydWN0dXJlXG4gICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRoLnNwbGl0KCcvJyk7XG4gICAgICAgICAgICBjb25zdCByZWxldmFudFBhcnRzID0gcGF0aFBhcnRzLnNsaWNlKC0zKTsgLy8gZS5nLiwgWydzZWFyY2gnLCAnc3lzdGVtJywgJ3NlYXJjaC1jb250cm9sbGVyLmpzJ11cbiAgICAgICAgICAgIHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmsgPSByZWxldmFudFBhcnRzLmpvaW4oJy8nKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU3lzdGVtIGNvbnRyb2xsZXIgcmVsYXRpdmUgcGF0aDogJHtyZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrfWApO1xuXG4gICAgICAgICAgICBjb25zdCB0YXJnZXRGaWxlUGF0aCA9IHBhdGguam9pbihzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciwgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXREaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU3lzdGVtIGNvbnRyb2xsZXIgdGFyZ2V0LWRpcmVjdG9yeTogJHt0YXJnZXREaXJlY3Rvcnl9LCB0YXJnZXRGaWxlUGF0aDogJHt0YXJnZXRGaWxlUGF0aH1gKTtcblxuICAgICAgICAgICAgLy8gRW5zdXJlIHRhcmdldCBzdWJkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0RGlyZWN0b3J5KSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDb3B5IHRoZSBzeXN0ZW0gY29udHJvbGxlciBmaWxlXG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc3lzdGVtQ29udHJvbGxlci5maWxlUGF0aCwgdGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ29waWVkIHN5c3RlbSBjb250cm9sbGVyIGZyb20gJHtzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRofSB0byAke3RhcmdldEZpbGVQYXRofWApO1xuXG4gICAgICAgICAgICAvLyBSZWdpc3RlciBmcm9tIHRoZSBjb3BpZWQgbG9jYXRpb25cbiAgICAgICAgICAgIGNvbnN0IGRpcmVjdG9yeSA9IHBhdGguZGlybmFtZSh0YXJnZXRGaWxlUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgc3lzdGVtIGNvbnRyb2xsZXI6ICR7ZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKFxuICAgICAgICAgICAgICAgIGRpcmVjdG9yeSxcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcixcbiAgICAgICAgICAgICAgICBbIGZpbGVOYW1lIF1cbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKTogc3RyaW5nW10ge1xuICAgICAgICBsZXQgZW50cnlQYWNrYWdlcyA9IGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyB8fCBbXTtcblxuICAgICAgICBpZiAoaXNBcnJheShlbnRyeVBhY2thZ2VzKSkge1xuICAgICAgICAgICAgZW50cnlQYWNrYWdlcyA9IHtcbiAgICAgICAgICAgICAgICBvdmVycmlkZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgcGFja2FnZU5hbWVzOiBlbnRyeVBhY2thZ2VzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiB0aGUgY29udHJvbGxlciBkb2VzIG5vdCB3YW50IHRvIG92ZXJyaWRlIHRoZSBhcHBsaWNhdGlvbi9tb2R1bGUgZW50cnkgcGFja2FnZXMgYW5kIGluY2x1ZGUgdGhlbSBhcyB3ZWxsXG4gICAgICAgIGlmICghZW50cnlQYWNrYWdlcy5vdmVycmlkZSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlRW50cnlQYWNrYWdlcyA9IG93bmVyTW9kdWxlPy5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCkgfHwgW107XG4gICAgICAgICAgICBjb25zdCBhcHBFbnRyeVBhY2thZ2VzID0gdGhpcy5mdzI0LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKTtcbiAgICAgICAgICAgIGVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzID0gW1xuICAgICAgICAgICAgICAgIC4uLmVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzLFxuICAgICAgICAgICAgICAgIC4uLm1vZHVsZUVudHJ5UGFja2FnZXMsXG4gICAgICAgICAgICAgICAgLi4uYXBwRW50cnlQYWNrYWdlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRyeVBhY2thZ2VzLnBhY2thZ2VOYW1lcy5tYXAodGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSk7XG4gICAgfVxuXG5cbiAgICAvLyByZWdpc3RlciBhIHNpbmdsZSBjb250cm9sbGVyXG4gICAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlckNvbnRyb2xsZXIgPSBhc3luYyAoY29udHJvbGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKSA9PiB7XG4gICAgICAgIGNvbnN0IHsgaGFuZGxlckNsYXNzLCBmaWxlUGF0aCwgZmlsZU5hbWUgfSA9IGNvbnRyb2xsZXJJbmZvO1xuICAgICAgICAvLyBBZGQgdGhlIGZvbGRlciBwYXRoIGZyb20gZmlsZW5hbWUgdG8gdGhlIGNvbnRyb2xsZXIgbmFtZVxuICAgICAgICBjb25zdCBmb2xkZXJQYXRoID0gZmlsZU5hbWUuc3BsaXQoJy8nKS5zbGljZSgwLCAtMSkuam9pbignLycpO1xuICAgICAgICBjb25zdCBoYW5kbGVySW5zdGFuY2UgPSBuZXcgaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gZmlsZU5hbWUuaW5jbHVkZXMoJy8nKSA/IGZvbGRlclBhdGggKyAnLycgKyBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWUgOiBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnID0gaGFuZGxlckluc3RhbmNlPy5jb250cm9sbGVyQ29uZmlnIHx8IHt9O1xuICAgICAgICBjb25zdCBjb250cm9sbGVyU3RhY2tOYW1lID0gY29udHJvbGxlckNvbmZpZy5zdGFja05hbWUgfHwgY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IHBhcmVudFN0YWNrTmFtZSA9IGNvbnRyb2xsZXJDb25maWcucGFyZW50U3RhY2tOYW1lIHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU7XG5cbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBjb250cm9sbGVyIHN0YWNrIGluZm8gaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuY29udHJvbGxlclN0YWNrcy5oYXMoY29udHJvbGxlclN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5zZXQoY29udHJvbGxlclN0YWNrTmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGhvZHM6IFtdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW10sXG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGNvbnRyb2xsZXIgc3RhY2sgZXhpc3RzXG4gICAgICAgIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lLCBwYXJlbnRTdGFja05hbWUpO1xuICAgICAgICBjb250cm9sbGVySW5mby5yb3V0ZXMgPSBoYW5kbGVySW5zdGFuY2Uucm91dGVzO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyBjb250cm9sbGVyICR7Y29udHJvbGxlck5hbWV9YCk7XG5cbiAgICAgICAgLy8gcHJlcGFyZSB0aGUgZW50cnkgcGFja2FnZXMgZm9yIHRoZSBjb250cm9sbGVyJ3MgbGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXMgPSB0aGlzLnByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlKTtcbiAgICAgICAgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzID0gZW50cnlQYWNrYWdlcztcblxuICAgICAgICB0aGlzLnJlc291cmNlcyA9IFtdO1xuICAgICAgICB0aGlzLm1ldGhvZHMgPSBbXTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgcmVzb3VyY2UgZm9yIHRoZSBjb250cm9sbGVyIGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZUNvbnRyb2xsZXJSZXNvdXJjZShjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgbGV0IGNvbnRyb2xsZXJUYXJnZXQgPSBjb250cm9sbGVyQ29uZmlnLnRhcmdldDtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJJbnRlZ3JhdGlvbjogTGFtYmRhSW50ZWdyYXRpb24gfCBBd3NJbnRlZ3JhdGlvbiB8IHVuZGVmaW5lZDtcbiAgICAgICAgLy8gY3JlYXRlIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIGNvbnRyb2xsZXJcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJUYXJnZXQgPT09ICdmdW5jdGlvbicgfHwgY29udHJvbGxlclRhcmdldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgPSBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubG9nUmV0ZW50aW9uRGF5cztcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSA9IGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSB8fCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5sb2dSZW1vdmFsUG9saWN5O1xuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlckxhbWJkYSA9IHRoaXMuY3JlYXRlTGFtYmRhRnVuY3Rpb24oY29udHJvbGxlck5hbWUsIGZpbGVQYXRoLCBmaWxlTmFtZSwgY29udHJvbGxlckNvbmZpZywgY29udHJvbGxlclN0YWNrTmFtZSwgaGFuZGxlckNsYXNzLm5hbWUpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlckxhbWJkYSwgT3V0cHV0VHlwZS5GVU5DVElPTik7XG5cbiAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IG5ldyBMYW1iZGFJbnRlZ3JhdGlvbihjb250cm9sbGVyTGFtYmRhLCB7XG4gICAgICAgICAgICAgICAgcmVzdEFwaTogdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSkuYXBpLFxuICAgICAgICAgICAgICAgIHBhdGg6IGNvbnRyb2xsZXJOYW1lLFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHModGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuaW50ZWdyYXRpb25UaW1lb3V0IHx8IDI5KSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH0gPSB0aGlzLmV4dHJhY3REZWZhdWx0QXV0aG9yaXplcihjb250cm9sbGVyQ29uZmlnKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXIgQ29udHJvbGxlciB+IERlZmF1bHQgQXV0aG9yaXplcjogbmFtZTogJHtkZWZhdWx0QXV0aG9yaXplck5hbWV9IC0gdHlwZTogJHtkZWZhdWx0QXV0aG9yaXplclR5cGV9IC0gZ3JvdXBzOiAke2RlZmF1bHRBdXRob3JpemVyR3JvdXBzfWApO1xuXG4gICAgICAgIC8vIFNldCB1cCBBUEkga2V5IGlmIHJlcXVpcmVkXG4gICAgICAgIGlmIChjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0dXBVc2FnZVBsYW4odW5kZWZpbmVkLCB0cnVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB1cCByb3V0ZXMgZm9yIHRoZSBjb250cm9sbGVyXG4gICAgICAgIGZvciAoY29uc3Qgcm91dGUgb2YgT2JqZWN0LnZhbHVlcyhjb250cm9sbGVySW5mby5yb3V0ZXMgPz8ge30pKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgcm91dGUgJHtyb3V0ZS5odHRwTWV0aG9kfSAke3JvdXRlLnBhdGh9YCk7XG4gICAgICAgICAgICBjb25zdCByb3V0ZVRhcmdldCA9IHJvdXRlLnRhcmdldCB8fCBjb250cm9sbGVyVGFyZ2V0O1xuICAgICAgICAgICAgY29uc3QgY3VycmVudFJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZVJvdXRlUmVzb3VyY2UoY29udHJvbGxlclJlc291cmNlLCByb3V0ZS5wYXRoLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IHsgcm91dGVBdXRob3JpemVyTmFtZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfSA9IHRoaXMuZXh0cmFjdFJvdXRlQXV0aG9yaXplcihyb3V0ZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgcm91dGUgQXV0aG9yaXplcjogJHtyb3V0ZUF1dGhvcml6ZXJOYW1lfSAtICR7cm91dGVBdXRob3JpemVyVHlwZX0gLSAke3JvdXRlQXV0aG9yaXplckdyb3Vwc31gKTtcblxuICAgICAgICAgICAgbGV0IG1ldGhvZE9wdGlvbnMgPSB0aGlzLmNyZWF0ZU1ldGhvZE9wdGlvbnMocm91dGUsIHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplck5hbWUsIGNvbnRyb2xsZXJDb25maWcpO1xuXG4gICAgICAgICAgICBpZiAocm91dGVUYXJnZXQgPT09ICdxdWV1ZScpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSByb3V0ZS5wYXRoLnJlcGxhY2UoJy8nLCAnJyk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gdGhpcy5jcmVhdGVTUVNJbnRlZ3JhdGlvbihxdWV1ZU5hbWUsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBtZXRob2RPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi5tZXRob2RPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJvdXRlVGFyZ2V0ID09PSAndG9waWMnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdG9waWNOYW1lID0gcm91dGUucGF0aC5yZXBsYWNlKCcvJywgJycpO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IHRoaXMuY3JlYXRlU05TSW50ZWdyYXRpb24odG9waWNOYW1lLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgbWV0aG9kT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubWV0aG9kT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBtZXRob2QgPSBjdXJyZW50UmVzb3VyY2UuYWRkTWV0aG9kKHJvdXRlLmh0dHBNZXRob2QsIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiwgbWV0aG9kT3B0aW9ucyk7XG4gICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChtZXRob2QpO1xuXG4gICAgICAgICAgICAvLyBpZiBhdXRob3JpemVyIGlzIEFXU19JQU0sIHRoZW4gYWRkIHRoZSByb3V0ZSB0byB0aGUgcG9saWN5XG4gICAgICAgICAgICBpZiAocm91dGVBdXRob3JpemVyVHlwZSA9PT0gJ0FXU19JQU0nKSB7XG4gICAgICAgICAgICAgICAgbGV0IGZ1bGxSb3V0ZVBhdGggPSBjb250cm9sbGVyTmFtZSArIHJvdXRlLnBhdGg7XG5cbiAgICAgICAgICAgICAgICAvLyAqIHJlcGxhY2UgZWFjaCBwYXJhbSBwbGFjZWhvbGRlciBge2lkfWAgd2l0aCBhbiBgKmBcbiAgICAgICAgICAgICAgICByb3V0ZS5wYXJhbWV0ZXJzPy5mb3JFYWNoKHBhciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGZ1bGxSb3V0ZVBhdGggPSBmdWxsUm91dGVQYXRoLnJlcGxhY2UoYHske3Bhcn19YCwgJyonKTtcbiAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZFJvdXRlVG9Sb2xlUG9saWN5KGZ1bGxSb3V0ZVBhdGgsIHJvdXRlQXV0aG9yaXplckdyb3Vwcywgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGtlZXAgdHJhY2sgb2YgdGhlIGNvbnRyb2xsZXIgc3RhY2tzIHdpdGggbWV0aG9kcyBhbmQgcmVzb3VyY2VzIGluIGEgbXVsdGktc3RhY2sgc2V0dXAgdG8gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSkge1xuICAgICAgICAgICAgY29uc3Qgc3RhY2tJbmZvID0gdGhpcy5jb250cm9sbGVyU3RhY2tzLmdldChjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGlmIChzdGFja0luZm8pIHtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8ubWV0aG9kcyA9IFsgLi4udGhpcy5tZXRob2RzIF07XG4gICAgICAgICAgICAgICAgc3RhY2tJbmZvLnJlc291cmNlcyA9IFsgLi4udGhpcy5yZXNvdXJjZXMgXTtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8uY29udHJvbGxlcnNIYXNoLnB1c2goY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEpTT04uc3RyaW5naWZ5KGNvbnRyb2xsZXJDb25maWcpKS5kaWdlc3QoJ2hleCcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG91dHB1dCB0aGUgYXBpIGVuZHBvaW50XG4gICAgICAgIHRoaXMub3V0cHV0QXBpRW5kcG9pbnQoY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJSZXNvdXJjZSwgdGhpcy5nZXRTdGFnZU5hbWUoKSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgLy8gU3RvcmUgcm91dGluZyBtZXRhZGF0YSBmb3Igc2ltdWxhdG9yXG4gICAgICAgIGNvbnN0IHNpbXVsYXRlZEFwaSA9IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdTSU1VTEFURURfQVBJX1JPVVRFUycpIHx8IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IHJvdXRlIG9mIE9iamVjdC52YWx1ZXMoY29udHJvbGxlckluZm8ucm91dGVzID8/IHt9KSkge1xuICAgICAgICAgICAgY29uc3QgeyByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJOYW1lLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMgfSA9IHRoaXMuZXh0cmFjdFJvdXRlQXV0aG9yaXplcihyb3V0ZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyk7XG4gICAgICAgICAgICBzaW11bGF0ZWRBcGkucHVzaCh7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlck5hbWUsXG4gICAgICAgICAgICAgICAgaHR0cE1ldGhvZDogcm91dGUuaHR0cE1ldGhvZCxcbiAgICAgICAgICAgICAgICBwYXRoOiBgLyR7Y29udHJvbGxlck5hbWV9JHtyb3V0ZS5wYXRofWAsXG4gICAgICAgICAgICAgICAgaGFuZGxlcklkOiBjb250cm9sbGVyTmFtZSArIFwiLWNvbnRyb2xsZXJcIiwgLy8gVGhpcyBtYXRjaGVzIHRoZSBJRCB1c2VkIGluIExhbWJkYUZ1bmN0aW9uXG4gICAgICAgICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiByb3V0ZUF1dGhvcml6ZXJUeXBlLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiByb3V0ZUF1dGhvcml6ZXJOYW1lLFxuICAgICAgICAgICAgICAgICAgICBncm91cHM6IHJvdXRlQXV0aG9yaXplckdyb3Vwc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdTSU1VTEFURURfQVBJX1JPVVRFUycsIHNpbXVsYXRlZEFwaSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRTdGFnZU5hbWUgPSAoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlPcHRpb25zPy5kZXBsb3lPcHRpb25zPy5zdGFnZU5hbWUgfHwgJ3Byb2QnO1xuICAgIH1cblxuICAgIC8vIGlmIHRoZSBBUEkgaXMgaW1wb3J0ZWQsIHRoZW4gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrIGFuZCBhZGQgbWV0aG9kIGFuZCByZXNvdXJjZSBhcyBkZXBlbmRlbmN5XG4gICAgLy8gVGhpcyBpcyBuZWVkZWQgYmVjYXVzZSBpbXBvcnRlZCBBUEkgZG9lcyBub3QgcHJvcG9nYXRlIENPUlMgc2V0dGluZ3MgdG8gdGhlIG1ldGhvZHNcbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZURlcGxveW1lbnRzKCkge1xuXG4gICAgICAgIGNvbnN0IHN0YWdlTmFtZSA9IHRoaXMuZ2V0U3RhZ2VOYW1lKCk7XG4gICAgICAgIGZvciAoY29uc3QgWyBjb250cm9sbGVyU3RhY2tOYW1lLCB7IG1ldGhvZHMsIHJlc291cmNlcywgY29udHJvbGxlcnNIYXNoIH0gXSBvZiB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZW50cmllcygpKSB7XG4gICAgICAgICAgICAvLyBUT0RPOiBhZGQgYmV0dGVyIGxvZ2ljIHRvIGZvcmNlIGEgZGVwbG95bWVudCB3aGVuIHRoZXJlIGlzIGEgY2hhbmdlIGluIGZyYW1ld29yayBjb2RlXG4gICAgICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZm9yY2VEZXBsb3ltZW50KSB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoLnB1c2gocmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlckhhc2ggPSBjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoY29udHJvbGxlcnNIYXNoKSkuZGlnZXN0KCdoZXgnKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBkZXBsb3ltZW50IGZvciBjb250cm9sbGVyIHN0YWNrICR7Y29udHJvbGxlclN0YWNrTmFtZX0gd2l0aCBoYXNoICR7Y29udHJvbGxlckhhc2h9YCk7XG4gICAgICAgICAgICBjb25zdCBkZXBsb3ltZW50ID0gbmV3IERlcGxveW1lbnQodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgZGVwbG95bWVudC0ke2NvbnRyb2xsZXJIYXNofWAsIHtcbiAgICAgICAgICAgICAgICBhcGk6IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaSxcbiAgICAgICAgICAgICAgICBzdGFnZU5hbWU6IHN0YWdlTmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBtZXRob2RzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyBtZXRob2QgZGVwZW5kZW5jeSAke21ldGhvZC5odHRwTWV0aG9kfSAke21ldGhvZC5yZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kobWV0aG9kKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBhZGQgZGVwZW5kZWN5IG9uIGFsbCByZXNvdXJjZXMgZm9yIHRoaXMgY29udHJvbGxlclxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNvdXJjZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIHJlc291cmNlIGRlcGVuZGVuY3kgJHtyZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kocmVzb3VyY2UpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBpZiB0aGUgYXBpIGlzIGltcG9ydGVkIGFuZCBpdCdzIG5vdCBhIG11bHRpLXN0YWNrIHNldHVwLCB0aGVuIGNyZWF0ZSBhIHNpbmdsZSBkZXBsb3ltZW50IGZvciBhbGwgY29udHJvbGxlcnNcbiAgICAvLyBTaW5nbGUgZGVwbG95bWVudCBpcyBuZWVkZWQgdG8gYXZvaWQgc2ltdWx0YXRpb24gZGVwbG95bWVudCB3aGljaCBjYXVzZXMgZXJyb3Igb24gQVBJIEdhdGV3YXlcbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZVNpbmdsZURlcGxveW1lbnQoKSB7XG4gICAgICAgIGNvbnN0IHN0YWdlTmFtZSA9IHRoaXMuZ2V0U3RhZ2VOYW1lKCk7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5mb3JFYWNoKGMgPT4gYy5jb250cm9sbGVyc0hhc2gucHVzaChyYW5kb21VVUlEKCkpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjcmVhdGUgdGhlIG5hbWUgZnJvbSBhbGwgdGhlIGNvbnRyb2xsZXIgaGFzaCB2YWx1ZXMgY29tYmluZWQgYXMgYSBzaW5nbGUgaGFzaCBhbmQgYWRkIGRlcGVuZGVuY3kgb24gYWxsIHRoZSBjb250cm9sbGVyc1xuICAgICAgICBjb25zdCBkZXBsb3ltZW50TmFtZSA9IGBkZXBsb3ltZW50LSR7Y3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEFycmF5LmZyb20odGhpcy5jb250cm9sbGVyU3RhY2tzLnZhbHVlcygpKS5tYXAoYyA9PiBjLmNvbnRyb2xsZXJzSGFzaCkuam9pbignLScpKS5kaWdlc3QoJ2hleCcpfWA7XG5cbiAgICAgICAgY29uc3QgZGVwbG95bWVudCA9IG5ldyBEZXBsb3ltZW50KHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLm5hbWUpLCBkZXBsb3ltZW50TmFtZSwge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgICAgICAgIHN0YWdlTmFtZTogc3RhZ2VOYW1lLFxuICAgICAgICB9KTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgX2NvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzIH0gXSBvZiB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZW50cmllcygpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBtZXRob2RzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyBtZXRob2QgZGVwZW5kZW5jeSAke21ldGhvZC5odHRwTWV0aG9kfSAke21ldGhvZC5yZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kobWV0aG9kKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgcmVzb3VyY2UgZGVwZW5kZW5jeSAke3Jlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGdldENvcnNQcmVmbGlnaHRPcHRpb25zKCk6IENvcnNPcHRpb25zIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGFsbG93SGVhZGVyczogW1xuICAgICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXG4gICAgICAgICAgICAgICAgXCJBdXRob3JpemF0aW9uXCIsXG4gICAgICAgICAgICAgICAgXCJYLUFwaS1LZXlcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LURhdGVcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LUNvbnRlbnQtU2hhMjU2XCIsXG4gICAgICAgICAgICAgICAgXCJYLUFtei1TZWN1cml0eS1Ub2tlblwiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHNcIixcbiAgICAgICAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnNcIixcbiAgICAgICAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiLFxuICAgICAgICAgICAgICAgIFwiSW1wZXJzb25hdGluZy1Vc2VyLVN1YlwiLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGFsbG93TWV0aG9kczogWyBcIk9QVElPTlNcIiwgXCJHRVRcIiwgXCJQT1NUXCIsIFwiUFVUXCIsIFwiUEFUQ0hcIiwgXCJERUxFVEVcIiBdLFxuICAgICAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcbiAgICAgICAgICAgIGFsbG93T3JpZ2luczogdGhpcy5nZXRDb3JzT3JpZ2lucygpLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc09yaWdpbnMoKTogc3RyaW5nW10ge1xuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyA9PT0gdHJ1ZSkgcmV0dXJuIENvcnMuQUxMX09SSUdJTlM7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIFsgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyBdO1xuICAgICAgICByZXR1cm4gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyB8fCBbXTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldE9yQ3JlYXRlQ29udHJvbGxlclJlc291cmNlID0gKGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IElSZXNvdXJjZSA9PiB7XG4gICAgICAgIGxldCByZXN0QVBJID0gdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgIGxldCBjb250cm9sbGVyUmVzb3VyY2U6IElSZXNvdXJjZSA9IHJlc3RBUEkuYXBpLnJvb3Q7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRTdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgY29uc3QgcGF0aFBhcnRzID0gY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKTtcbiAgICAgICAgZm9yIChjb25zdCBwYXRoUGFydCBvZiBwYXRoUGFydHMpIHtcbiAgICAgICAgICAgIGxldCBjaGlsZFJlc291cmNlID0gY29udHJvbGxlclJlc291cmNlLmdldFJlc291cmNlKHBhdGhQYXJ0KSBhcyBJUmVzb3VyY2U7XG4gICAgICAgICAgICAvLyBpZiBpdCdzIGEgbmVzdGVkIGNvbnRyb2xsZXIsIHRoZSByb290IHJlc291cmNlIG1heSBub3QgYmUgY3JlYXRlZCBpbiBhbm90aGVyIHN0YWNrXG4gICAgICAgICAgICBjb25zdCBpc05lc3RlZENvbnRyb2xsZXIgPSBwYXRoUGFydHMubGVuZ3RoID4gMTtcbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSAmJiBpc05lc3RlZENvbnRyb2xsZXIgJiYgcGF0aFBhcnQgPT09IHBhdGhQYXJ0c1sgMCBdKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJ5IHRvIGdldCB0aGUgcm9vdCByZXNvdXJjZSBmcm9tIHRoZSBmdzI0IG91dHB1dFxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBHZXR0aW5nIGNvbnRyb2xsZXIgcmVzb3VyY2UgZm9yICR7cGF0aFBhcnR9IGZyb20gZncyNCBvdXRwdXRgKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sbGVyUmVzb3VyY2VJZCA9IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGByZXN0QVBJX2NvbnRyb2xsZXJfJHtwYXRoUGFydH1fcmVzb3VyY2VJZGAsICdyZXNvdXJjZScsIGN1cnJlbnRTdGFjayk7XG4gICAgICAgICAgICAgICAgaWYgKGNvbnRyb2xsZXJSZXNvdXJjZUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb250cm9sbGVyIHJlc291cmNlIGZvciAke3BhdGhQYXJ0fSBmb3VuZCBpbiBmdzI0IG91dHB1dDogJHtjb250cm9sbGVyUmVzb3VyY2VJZH1gKTtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IFJlc291cmNlLmZyb21SZXNvdXJjZUF0dHJpYnV0ZXMoY3VycmVudFN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb250cm9sbGVyU3RhY2tOYW1lfS0ke3BhdGhQYXJ0fWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlSWQ6IGNvbnRyb2xsZXJSZXNvdXJjZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdEFwaTogcmVzdEFQSS5hcGksXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiAnLycgKyBwYXRoUGFydFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWNoaWxkUmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICAvLyBmb3IgbmVzdGVkIHJlc291cmNlcyBhZGQgLyB0byB0aGUgcGF0aFxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBjb250cm9sbGVyIHJlc291cmNlIGZvciBwYXRoICR7cGF0aFBhcnR9IHVuZGVyICR7Y29udHJvbGxlclJlc291cmNlLnBhdGh9YCk7XG4gICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IGNvbnRyb2xsZXJSZXNvdXJjZS5hZGRSZXNvdXJjZShwYXRoUGFydCkgYXMgSVJlc291cmNlO1xuICAgICAgICAgICAgICAgIGlmIChyZXN0QVBJLmlzSW1wb3J0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29yc1ByZWZsaWdodE1ldGhvZCA9IGNoaWxkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChjb3JzUHJlZmxpZ2h0TWV0aG9kKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGlzTmVzdGVkQ29udHJvbGxlciAmJiBwYXRoUGFydCA9PT0gcGF0aFBhcnRzWyAwIF0pIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFNldHRpbmcgb3V0cHV0IGZvciBjb250b3JsbGVyIHJlc291cmNlICR7Y29udHJvbGxlclN0YWNrTmFtZX0gcGF0aCAke3BhdGhQYXJ0fWApO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGByZXN0QVBJX2NvbnRyb2xsZXJfJHtwYXRoUGFydH1gLCBjaGlsZFJlc291cmNlLCBPdXRwdXRUeXBlLlJFU09VUkNFLCAncmVzb3VyY2VJZCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRyb2xsZXJSZXNvdXJjZSA9IGNoaWxkUmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY29udHJvbGxlclJlc291cmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlTGFtYmRhRnVuY3Rpb24gPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZywgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZywgaGFuZGxlckNsYXNzTmFtZT86IHN0cmluZyk6IE5vZGVqc0Z1bmN0aW9uID0+IHtcbiAgICAgICAgY29uc3QgZnVuY3Rpb25Qcm9wcyA9IG1lcmdlKFtcbiAgICAgICAgICAgIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMgPz8ge30sXG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnPy5mdW5jdGlvblByb3BzID8/IHt9XG4gICAgICAgIF0pITtcblxuICAgICAgICBjb25zdCBlbnZWYXJpYWJsZXMgPSB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyhjb250cm9sbGVyQ29uZmlnLmVudiwgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKTtcblxuICAgICAgICAvLyBkbyBub3Qgb3ZlcnJpZGUgdGhlIGVudHJ5IHBhY2thZ2VzIGlmIGFscmVhZHkgc2V0XG4gICAgICAgIGlmICghKEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTIGluIGVudlZhcmlhYmxlcykgJiYgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzKSB7XG4gICAgICAgICAgICBlbnZWYXJpYWJsZXNbIEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTIF0gPSAoY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzIGFzIEFycmF5PHN0cmluZz4pLmpvaW4oJywnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBjb250cm9sbGVyTmFtZSArIFwiLWNvbnRyb2xsZXJcIiwge1xuICAgICAgICAgICAgZW50cnk6IGZpbGVQYXRoICsgXCIvXCIgKyBmaWxlTmFtZSxcbiAgICAgICAgICAgIGhhbmRsZXJDbGFzc05hbWUsXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczogZW52VmFyaWFibGVzLFxuICAgICAgICAgICAgcG9saWNpZXM6IGNvbnRyb2xsZXJDb25maWc/LnBvbGljaWVzLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IGNvbnRyb2xsZXJDb25maWc/LnJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgYWxsb3dTZW5kRW1haWw6IHRydWUsXG4gICAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IGNvbnRyb2xsZXJDb25maWc/LmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgcHJvY2Vzc29yQXJjaGl0ZWN0dXJlOiBjb250cm9sbGVyQ29uZmlnPy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiBmdW5jdGlvblByb3BzLFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzLFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGV4dHJhY3REZWZhdWx0QXV0aG9yaXplciA9IChjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZ1dpdGhBdXRob3JpemVyKTogeyBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzOiBzdHJpbmdbXSwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc6IGJvb2xlYW4gfSA9PiB7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSB0aGlzLmZ3MjQuZ2V0RGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZSgpO1xuICAgICAgICBsZXQgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNvbnRyb2xsZXJDb25maWc/LmF1dGhvcml6ZXIpKSB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0QXV0aG9yaXplciA9IChjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIgYXMgSUF1dGhvcml6ZXJDb25maWdbXSkuZmluZCgoYXV0aCkgPT4gYXV0aC5kZWZhdWx0KSB8fCBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXJbIDAgXTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IGRlZmF1bHRBdXRob3JpemVyLm5hbWUgfHwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXIuZ3JvdXBzIHx8IFtdO1xuICAgICAgICAgICAgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0QXV0aG9yaXplci5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLmdyb3VwcyB8fCBbXTtcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gY29udHJvbGxlckNvbmZpZy5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFkZWZhdWx0QXV0aG9yaXplclR5cGUgJiYgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSkge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChkZWZhdWx0QXV0aG9yaXplckdyb3Vwcykge1xuXG4gICAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgZm9yIHRoZSBncm91cHMgaXMgYSB0ZW1wbGF0ZSBzdHJpbmcsIFxuICAgICAgICAgICAgLy8gcmVzb2x2ZSBpdCBbd2hlbiB0aGUgYXBwbGljYXRpb24gd2FudCB0byBhbGxvdyBtdWx0aXBsZSB1c2VyIGdyb3VwcyB0byBoYXZlIGFjY2Vzc11cbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgXCJlbnY6eHh4Omdyb3VwMVwiID09PiBcImdyb3VwMS1yZXNvbHZlZFwiIHx8IFwiZ3JvdXAxLGdyb3VwMlwiIHx8IFwiZW52Onh4eDpncm91cDEsZW52Onh4eDpncm91cDJcIlxuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSkge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gdGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShkZWZhdWx0QXV0aG9yaXplckdyb3VwcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIG5vdyBpZiB0aGUgcmVzb2x2ZWQgdmFsdWUgaXMgYWdhaW4gYSBzdHJpbmcsIHNwbGl0IGl0IGJ5IGNvbW1hXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFwiZ3JvdXAxLGdyb3VwMlwiID09PiBbXCJncm91cDFcIiwgXCJncm91cDJcIl1cbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhkZWZhdWx0QXV0aG9yaXplckdyb3VwcykpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLnNwbGl0KCcsJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMubGVuZ3RoICYmIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHMpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHJlc29sdmUgdGhlIGdyb3VwIG5hbWVzIGZyb20gZncyNC1zY29wZSBpZiBpdCdzIGEgdGVtcGxhdGVcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgW1wiZW52Onh4eDpncm91cDFcIixcImVudjp4eHg6Z3JvdXAyXCJdID09PiBbXCJncm91cDEtcmVzb2x2ZWRcIiwgXCJncm91cDItcmVzb2x2ZWRcIl1cbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzIGFzIEFycmF5PHN0cmluZz4pLm1hcCh0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKTtcblxuICAgICAgICAgICAgLy8gZmxhdC1tYXAgdGhlIGdyb3VwcyBpZiB0aGV5IHJlc29sdmVkIGdyb3VwIHZhbHVlcyBhcmUgYWdhaW4gY29tbWEgc2VwYXJhdGVkXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSByZXNvbHZlZCB2YWx1ZSBpcyBsaWtlIFtcImEsYlwiLCBcImMsZFwiXSA9PT4gW1wiYVwiLCBcImJcIiwgXCJjXCIsIFwiZFwiXVxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplckdyb3Vwcy5mbGF0TWFwKGdyb3VwID0+IGdyb3VwLnNwbGl0KCcsJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRW5zdXJlIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzIGlzIGFsd2F5cyBhbiBhcnJheVxuICAgICAgICBjb25zdCBub3JtYWxpemVkR3JvdXBzOiBzdHJpbmdbXSA9ICFkZWZhdWx0QXV0aG9yaXplckdyb3VwcyBcbiAgICAgICAgICAgID8gW10gXG4gICAgICAgICAgICA6IEFycmF5LmlzQXJyYXkoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpIFxuICAgICAgICAgICAgICAgID8gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgXG4gICAgICAgICAgICAgICAgOiBbZGVmYXVsdEF1dGhvcml6ZXJHcm91cHNdO1xuXG4gICAgICAgIHJldHVybiB7IFxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJOYW1lLCBcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3Vwczogbm9ybWFsaXplZEdyb3VwcywgXG4gICAgICAgICAgICBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyBcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldE9yQ3JlYXRlUm91dGVSZXNvdXJjZSA9IChwYXJlbnRSZXNvdXJjZTogSVJlc291cmNlLCBwYXRoOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IElSZXNvdXJjZSA9PiB7XG4gICAgICAgIGxldCBjdXJyZW50UmVzb3VyY2U6IElSZXNvdXJjZSA9IHBhcmVudFJlc291cmNlO1xuICAgICAgICBjb25zdCByZXN0QVBJID0gdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwYXRoUGFydCBvZiBwYXRoLnNwbGl0KFwiL1wiKSkge1xuICAgICAgICAgICAgaWYgKHBhdGhQYXJ0ID09PSBcIlwiKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBjaGlsZFJlc291cmNlID0gY3VycmVudFJlc291cmNlLmdldFJlc291cmNlKHBhdGhQYXJ0KTtcbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSkge1xuICAgICAgICAgICAgICAgIGNoaWxkUmVzb3VyY2UgPSBjdXJyZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UocGF0aFBhcnQpO1xuICAgICAgICAgICAgICAgIGlmIChyZXN0QVBJLmlzSW1wb3J0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29yc1ByZWZsaWdodE1ldGhvZCA9IGNoaWxkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChjb3JzUHJlZmxpZ2h0TWV0aG9kKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNvdXJjZXMucHVzaChjaGlsZFJlc291cmNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjdXJyZW50UmVzb3VyY2UgPSBjaGlsZFJlc291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGN1cnJlbnRSZXNvdXJjZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGV4dHJhY3RSb3V0ZUF1dGhvcml6ZXIgPSAocm91dGU6IElSb3V0ZVdpdGhBdXRob3JpemVyLCBkZWZhdWx0QXV0aG9yaXplclR5cGU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJOYW1lOiBzdHJpbmcsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzOiBzdHJpbmdbXSwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc6IGJvb2xlYW4pOiB7IHJvdXRlQXV0aG9yaXplck5hbWU6IHN0cmluZywgcm91dGVBdXRob3JpemVyVHlwZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc6IGJvb2xlYW4gfSA9PiB7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJOYW1lID0gZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyVHlwZSA9IGRlZmF1bHRBdXRob3JpemVyVHlwZTtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzO1xuICAgICAgICBsZXQgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc7XG5cbiAgICAgICAgaWYgKHJvdXRlLmF1dGhvcml6ZXIgJiYgdHlwZW9mIHJvdXRlLmF1dGhvcml6ZXIgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJUeXBlID0gcm91dGUuYXV0aG9yaXplci50eXBlIHx8IGRlZmF1bHRBdXRob3JpemVyVHlwZTtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplck5hbWUgPSByb3V0ZS5hdXRob3JpemVyLm5hbWUgfHwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICAgICAgY29uc3Qgcm91dGVHcm91cHMgPSByb3V0ZS5hdXRob3JpemVyLmdyb3VwcyB8fCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplckdyb3VwcyA9ICFyb3V0ZUdyb3VwcyBcbiAgICAgICAgICAgICAgICA/IFtdIFxuICAgICAgICAgICAgICAgIDogQXJyYXkuaXNBcnJheShyb3V0ZUdyb3VwcykgXG4gICAgICAgICAgICAgICAgICAgID8gcm91dGVHcm91cHMgXG4gICAgICAgICAgICAgICAgICAgIDogW3JvdXRlR3JvdXBzXTtcbiAgICAgICAgICAgIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IHJvdXRlLmF1dGhvcml6ZXIucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVBdXRob3JpemVyTmFtZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZU1ldGhvZE9wdGlvbnMgPSAocm91dGU6IElSb3V0ZVdpdGhBdXRob3JpemVyLCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplck5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCwgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcpOiBNZXRob2RPcHRpb25zID0+IHtcbiAgICAgICAgY29uc3QgcmVxdWVzdFBhcmFtZXRlcnM6IHsgWyBrZXk6IHN0cmluZyBdOiBib29sZWFuIH0gPSB7fTtcblxuICAgICAgICAvLyBBZGQgcGF0aCBwYXJhbWV0ZXJzXG4gICAgICAgIGZvciAoY29uc3QgcGFyYW0gb2Ygcm91dGUucGFyYW1ldGVycyB8fCBbXSkge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnNbIGBtZXRob2QucmVxdWVzdC5wYXRoLiR7cGFyYW19YCBdID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBBUEkga2V5IGhlYWRlciByZXF1aXJlbWVudCBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb25maWcucmVxdWlyZUFwaUtleSkge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnNbICdtZXRob2QucmVxdWVzdC5oZWFkZXIueC1hcGkta2V5JyBdID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHRoZSBhdXRob3JpemVyIGlzIEpXVCwgY29udmVydCBpdCB0byBDVVNUT01cbiAgICAgICAgY29uc3QgYXV0aG9yaXplciA9IHRoaXMuZncyNC5nZXRBdXRob3JpemVyKHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplck5hbWUpO1xuICAgICAgICBpZiAocm91dGVBdXRob3JpemVyVHlwZSA9PT0gJ0pXVCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSAnQ1VTVE9NJztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVycyxcbiAgICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiByb3V0ZUF1dGhvcml6ZXJUeXBlIGFzIEF1dGhvcml6YXRpb25UeXBlLFxuICAgICAgICAgICAgYXV0aG9yaXplcjogYXV0aG9yaXplcixcbiAgICAgICAgICAgIGFwaUtleVJlcXVpcmVkOiBjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkgfHwgZmFsc2VcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZVNRU0ludGVncmF0aW9uID0gKHF1ZXVlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBBd3NJbnRlZ3JhdGlvbiA9PiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBTUVMgaW50ZWdyYXRpb24gZm9yIHF1ZXVlICR7cXVldWVOYW1lfSBpbiBjb250cm9sbGVyICR7Y29udHJvbGxlck5hbWV9IGluIHN0YWNrICR7Y29udHJvbGxlclN0YWNrTmFtZX1gKTtcbiAgICAgICAgY29uc3QgaW50ZWdyYXRpb25Sb2xlID0gbmV3IFJvbGUodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHtxdWV1ZU5hbWV9LXNxcy1pbnRlZ3JhdGlvbi1yb2xlYCwge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlQXJuID0gdGhpcy5mdzI0LmdldEFybignc3FzJywgdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUocXVldWVOYW1lICsgJ19xdWV1ZU5hbWUnLCAncXVldWUnLCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpKTtcbiAgICAgICAgY29uc3QgcXVldWVJbnN0YW5jZSA9IFF1ZXVlLmZyb21RdWV1ZUFybih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3F1ZXVlTmFtZX0tcXVldWVgLCBxdWV1ZUFybik7XG4gICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRTZW5kTWVzc2FnZXMoaW50ZWdyYXRpb25Sb2xlKTtcbiAgICAgICAgcmV0dXJuIG5ldyBBd3NJbnRlZ3JhdGlvbih7XG4gICAgICAgICAgICBzZXJ2aWNlOiBcInNxc1wiLFxuICAgICAgICAgICAgcGF0aDogdGhpcy5mdzI0LmdldENvbmZpZygpLmFjY291bnQgKyBcIi9cIiArIHF1ZXVlSW5zdGFuY2UucXVldWVOYW1lLFxuICAgICAgICAgICAgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjcmVkZW50aWFsc1JvbGU6IGludGVncmF0aW9uUm9sZSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICAgICBcImludGVncmF0aW9uLnJlcXVlc3QuaGVhZGVyLkNvbnRlbnQtVHlwZVwiOiBcIidhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiYXBwbGljYXRpb24vanNvblwiOiBgQWN0aW9uPVNlbmRNZXNzYWdlJk1lc3NhZ2VCb2R5PSR1dGlsLnVybEVuY29kZSgkaW5wdXQuYm9keSlgLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVTTlNJbnRlZ3JhdGlvbiA9ICh0b3BpY05hbWU6IHN0cmluZywgY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogQXdzSW50ZWdyYXRpb24gPT4ge1xuICAgICAgICBjb25zdCBpbnRlZ3JhdGlvblJvbGUgPSBuZXcgUm9sZSh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3RvcGljTmFtZX0tc25zLWludGVncmF0aW9uLXJvbGVgLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwiYXBpZ2F0ZXdheS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSB0aGlzLmZ3MjQuZ2V0QXJuKCdzbnMnLCB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSh0b3BpY05hbWUgKyAnX3RvcGljTmFtZScsICd0b3BpYycsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSkpO1xuICAgICAgICBjb25zdCB0b3BpY0luc3RhbmNlID0gVG9waWMuZnJvbVRvcGljQXJuKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7dG9waWNOYW1lfS10b3BpY2AsIHRvcGljQXJuKTtcbiAgICAgICAgdG9waWNJbnN0YW5jZS5ncmFudFB1Ymxpc2goaW50ZWdyYXRpb25Sb2xlKTtcbiAgICAgICAgcmV0dXJuIG5ldyBBd3NJbnRlZ3JhdGlvbih7XG4gICAgICAgICAgICBzZXJ2aWNlOiBcInNuc1wiLFxuICAgICAgICAgICAgcGF0aDogJy8nLFxuICAgICAgICAgICAgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjcmVkZW50aWFsc1JvbGU6IGludGVncmF0aW9uUm9sZSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICAgICBcImludGVncmF0aW9uLnJlcXVlc3QuaGVhZGVyLkNvbnRlbnQtVHlwZVwiOiBcIidhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiYXBwbGljYXRpb24vanNvblwiOiBgQWN0aW9uPVB1Ymxpc2gmVG9waWNBcm49JHV0aWwudXJsRW5jb2RlKCcke3RvcGljSW5zdGFuY2UudG9waWNBcm59JykmTWVzc2FnZT0kdXRpbC51cmxFbmNvZGUoJGlucHV0LmJvZHkpYCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0QXBpRW5kcG9pbnQgPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclJlc291cmNlOiBJUmVzb3VyY2UsIHN0YWdlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpID0+IHtcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGBFbmRwb2ludCR7Y29udHJvbGxlck5hbWV9YCwge1xuICAgICAgICAgICAgdmFsdWU6ICdodHRwczovLycgKyB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGkucmVzdEFwaUlkICsgJy5leGVjdXRlLWFwaS4nICsgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLnJlZ2lvbiArICcuYW1hem9uYXdzLmNvbS8nICsgc3RhZ2VOYW1lICsgJy8nICsgY29udHJvbGxlclJlc291cmNlLnBhdGguc2xpY2UoMSksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBUEkgR2F0ZXdheSBFbmRwb2ludCBmb3IgXCIgKyBjb250cm9sbGVyTmFtZSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZXR1cFVzYWdlUGxhbihwbGFuQ29uZmlnPzogSVVzYWdlUGxhbkNvbmZpZywgY3JlYXRlS2V5OiBib29sZWFuID0gZmFsc2UpOiB7IHBsYW46IFVzYWdlUGxhbjsgbmFtZTogc3RyaW5nIH0ge1xuICAgICAgICAvLyBJZiBubyBwbGFuIGNvbmZpZyBpcyBwcm92aWRlZCBhbmQgd2UgbmVlZCBhIGtleSwgdXNlIHRoZSBmaXJzdCBjb25maWd1cmVkIHBsYW4gb3IgY3JlYXRlIGEgZGVmYXVsdCBvbmVcbiAgICAgICAgaWYgKCFwbGFuQ29uZmlnICYmIGNyZWF0ZUtleSkge1xuICAgICAgICAgICAgLy8gVHJ5IHRvIHVzZSB0aGUgZmlyc3QgY29uZmlndXJlZCBwbGFuIHRoYXQgaGFzIEFQSSBrZXlzXG4gICAgICAgICAgICBjb25zdCBjb25maWd1cmVkUGxhbiA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnM/LmZpbmQocGxhbiA9PiBwbGFuLmFwaUtleXMpO1xuICAgICAgICAgICAgaWYgKGNvbmZpZ3VyZWRQbGFuKSB7XG4gICAgICAgICAgICAgICAgcGxhbkNvbmZpZyA9IGNvbmZpZ3VyZWRQbGFuO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBJZiBubyBjb25maWd1cmVkIHBsYW4gd2l0aCBrZXlzIGV4aXN0cywgY3JlYXRlIGEgZGVmYXVsdCBwbGFuXG4gICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgYSBkZXRlcm1pbmlzdGljIGtleSBiYXNlZCBvbiBhcHAgbmFtZSBhbmQgYSBmaXhlZCBpZGVudGlmaWVyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdEtleSA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgICAgICAgICAgICAgICAgIC51cGRhdGUoYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLmFjY291bnR9LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLnJlZ2lvbn0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZW52aXJvbm1lbnR9LWRlZmF1bHQtYXBpLWtleWApXG4gICAgICAgICAgICAgICAgICAgIC5kaWdlc3QoJ2hleCcpXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCAzMik7IC8vIFVzZSBmaXJzdCAzMiBjaGFycyBmb3IgYSByZWFzb25hYmxlIGtleSBsZW5ndGhcblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIHVzYWdlIHBsYW4gd2l0aCBBUEkga2V5cyBmb3VuZCwgY3JlYXRpbmcgYSBkZWZhdWx0IG9uZS4gVGhpcyBpcyBub3QgcmVjb21tZW5kZWQgZm9yIHByb2R1Y3Rpb24gZW52aXJvbm1lbnRzLiBQbGVhc2UgY29uZmlndXJlIGEgdXNhZ2UgcGxhbiB3aXRoIEFQSSBrZXlzIGZvciB5b3VyIEFQSS5gKTtcblxuICAgICAgICAgICAgICAgIHBsYW5Db25maWcgPSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGAke3RoaXMuZncyNC5hcHBOYW1lfS1kZWZhdWx0LXVzYWdlLXBsYW5gLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYERlZmF1bHQgdXNhZ2UgcGxhbiBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgICAgICBhcGlLZXlzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXlzOiBbIGRlZmF1bHRLZXkgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBsYW5OYW1lID0gcGxhbkNvbmZpZz8ubmFtZSB8fCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tZGVmYXVsdC11c2FnZS1wbGFuYDtcblxuICAgICAgICBpZiAoIXRoaXMudXNhZ2VQbGFucy5oYXMocGxhbk5hbWUpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTZXR0aW5nIHVwIHVzYWdlIHBsYW46ICR7cGxhbk5hbWV9YCk7XG4gICAgICAgICAgICBjb25zdCB1c2FnZVBsYW4gPSBuZXcgVXNhZ2VQbGFuKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtwbGFuTmFtZX0tdXNhZ2UtcGxhbmAsIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBwbGFuTmFtZSxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogcGxhbkNvbmZpZz8uZGVzY3JpcHRpb24gfHwgYFVzYWdlIHBsYW4gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICBhcGlTdGFnZXM6IFsge1xuICAgICAgICAgICAgICAgICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgICAgICAgICAgICAgICBzdGFnZTogdGhpcy5hcGkuZGVwbG95bWVudFN0YWdlXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgICAgIHRocm90dGxlOiB7XG4gICAgICAgICAgICAgICAgICAgIHJhdGVMaW1pdDogcGxhbkNvbmZpZz8ucmF0ZUxpbWl0IHx8IDEwLFxuICAgICAgICAgICAgICAgICAgICBidXJzdExpbWl0OiBwbGFuQ29uZmlnPy5idXJzdExpbWl0IHx8IDIwXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBxdW90YToge1xuICAgICAgICAgICAgICAgICAgICBsaW1pdDogcGxhbkNvbmZpZz8ucXVvdGFMaW1pdCB8fCAxMDAwMCxcbiAgICAgICAgICAgICAgICAgICAgcGVyaW9kOiBwbGFuQ29uZmlnPy5xdW90YVBlcmlvZCB8fCBQZXJpb2QuTU9OVEhcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMudXNhZ2VQbGFucy5zZXQocGxhbk5hbWUsIHsgcGxhbjogdXNhZ2VQbGFuLCBuYW1lOiBwbGFuTmFtZSB9KTtcbiAgICAgICAgICAgIHRoaXMuYXBpS2V5cy5zZXQocGxhbk5hbWUsIFtdKTtcblxuICAgICAgICAgICAgLy8gQ3JlYXRlIEFQSSBrZXlzIGlmIGNvbmZpZ3VyZWQgZm9yIHRoaXMgdXNhZ2UgcGxhblxuICAgICAgICAgICAgaWYgKHBsYW5Db25maWc/LmFwaUtleXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDcmVhdGluZyBBUEkga2V5cyBmb3IgdXNhZ2UgcGxhbjogJHtwbGFuTmFtZX1gKTtcbiAgICAgICAgICAgICAgICBjb25zdCBrZXlzID0gcGxhbkNvbmZpZy5hcGlLZXlzLmtleXMgfHwgW107XG4gICAgICAgICAgICAgICAga2V5cy5mb3JFYWNoKChrZXksIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUga2V5IG5hbWUgZnJvbSBjb25maWcgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgdXNlIHRoZSBwcmVmaXggb3IgZ2VuZXJhdGUgYSBuYW1lXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleU5hbWUgPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlLZXlDb25maWc/LmtleU5hbWUgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgIChwbGFuQ29uZmlnLmFwaUtleXM/LmtleU5hbWVQcmVmaXhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGAke3BsYW5Db25maWcuYXBpS2V5cy5rZXlOYW1lUHJlZml4fS0ke2luZGV4fWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGAke3RoaXMuZncyNC5hcHBOYW1lfS1hcGkta2V5LSR7aW5kZXh9YCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYga2V5IGFscmVhZHkgZXhpc3RzXG4gICAgICAgICAgICAgICAgICAgIGxldCBleGlzdGluZ0tleSA9IHRoaXMua2V5VmFsdWVzLmdldChrZXkpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0aW5nS2V5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ0tleSA9IG5ldyBBcGlLZXkodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2tleU5hbWV9LWFwaS1rZXlgLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYEFQSSBrZXkgJHtpbmRleCArIDF9IGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGtleVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2tleU5hbWV9LWlkYCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiBleGlzdGluZ0tleS5rZXlJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYEFQSSBLZXkgJHtpbmRleCArIDF9IElEIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmtleVZhbHVlcy5zZXQoa2V5LCBleGlzdGluZ0tleSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB1c2FnZVBsYW4uYWRkQXBpS2V5KGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXBpS2V5c0xpc3QgPSB0aGlzLmFwaUtleXMuZ2V0KHBsYW5OYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFwaUtleXNMaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhcGlLZXlzTGlzdC5wdXNoKGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdXNhZ2VQbGFuID0gdGhpcy51c2FnZVBsYW5zLmdldChwbGFuTmFtZSk7XG4gICAgICAgIGlmICghdXNhZ2VQbGFuKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVzYWdlIHBsYW4gJHtwbGFuTmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVzYWdlUGxhbjtcbiAgICB9XG5cbn1cbiJdfQ==