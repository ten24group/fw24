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
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const fw24_2 = require("../fw24");
const utils_1 = require("../utils");
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
            defaultAuthorizerGroups = defaultAuthorizerGroups.flatMap(group => group.split(','));
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
                    this.apiKeys.get(planName).push(existingKey);
                });
            }
        }
        return this.usagePlans.get(planName);
    }
}
exports.APIConstruct = APIConstruct;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVNBLCtEQVVvQztBQUVwQyw2Q0FBcUY7QUFFckYsaURBQTZEO0FBRTdELGlEQUE0QztBQUM1QyxpREFBNEM7QUFNNUMsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx1REFBeUY7QUFDekYsd0NBQTBDO0FBRTFDLHVEQUFtRDtBQUNuRCw2REFBeUQ7QUFFekQsNkNBQXFEO0FBQ3JELHFDQUE4RDtBQUM5RCwwREFBNkI7QUFFN0Isa0NBQW1DO0FBRW5DLG9DQUE2QztBQUM3QyxpQ0FBdUM7QUFDdkMsK0NBQXFEO0FBQ3JELHlDQUErQztBQUMvQyxtQ0FBeUM7QUFDekMscUNBQTJDO0FBQzNDLG1DQUF5QztBQUN6QyxtQ0FBeUM7QUFDekMsK0JBQXFDO0FBd0lyQyxNQUFhLFlBQVk7SUFtQlE7SUFsQnBCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLFlBQVksQ0FBQyxJQUFJLENBQUM7SUFDakMsWUFBWSxHQUFhLENBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsd0JBQWUsQ0FBQyxJQUFJLEVBQUUsNEJBQWlCLENBQUMsSUFBSSxFQUFFLG9CQUFhLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxDQUFFLENBQUM7SUFDaEwsTUFBTSxDQUF1QjtJQUU3QixHQUFHLENBQVc7SUFDZCxTQUFTLENBQVM7SUFDbEIsVUFBVSxHQUFtRCxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3ZFLE9BQU8sR0FBMEIsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUMzQyxTQUFTLEdBQXdC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VyxHQUFHLElBQUksdUJBQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksT0FBTyxVQUFVLEVBQUU7NEJBQ2hGLE9BQU8sRUFBRSxJQUFJOzRCQUNiLFdBQVcsRUFBRSxXQUFXLEtBQUssR0FBRyxDQUFDLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7NEJBQzVELEtBQUssRUFBRSxHQUFHO3lCQUNiLENBQUMsQ0FBQzt3QkFFSCxJQUFJLHVCQUFTLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sS0FBSyxFQUFFOzRCQUNoRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUs7NEJBQ3hCLFdBQVcsRUFBRSxXQUFXLEtBQUssR0FBRyxDQUFDLFdBQVcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7eUJBQ2xFLENBQUMsQ0FBQzt3QkFFSCxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsV0FBVyxDQUFDLENBQUM7b0JBQ3pDLENBQUM7b0JBRUQsU0FBUyxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQztvQkFDakMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO2dCQUNsRCxDQUFDLENBQUMsQ0FBQztZQUNQLENBQUM7UUFDTCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUUsQ0FBQztJQUMxQyxDQUFDO0NBRUo7QUF0eUJELG9DQXN5QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7XG4gICAgQXV0aG9yaXphdGlvblR5cGUsXG4gICAgQ29yc09wdGlvbnMsXG4gICAgSVJlc291cmNlLFxuICAgIE1ldGhvZCxcbiAgICBNZXRob2RPcHRpb25zLFxuICAgIFJlc3RBcGlQcm9wc1xufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcblxuaW1wb3J0IHtcbiAgICBBd3NJbnRlZ3JhdGlvbixcbiAgICBDb3JzLFxuICAgIERlcGxveW1lbnQsXG4gICAgUmVzb3VyY2UsXG4gICAgUmVzcG9uc2VUeXBlLFxuICAgIFJlc3RBcGksXG4gICAgQXBpS2V5LCBcbiAgICBQZXJpb2QsIFxuICAgIFVzYWdlUGxhblxufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcblxuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBEdXJhdGlvbiwgTmVzdGVkU3RhY2ssIFJlbW92YWxQb2xpY3ksIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5cbmltcG9ydCB7IFJvbGUsIFNlcnZpY2VQcmluY2lwYWwgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgVG9waWMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNuc1wiO1xuaW1wb3J0IHsgUXVldWUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuXG5pbXBvcnQgdHlwZSB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4uL2NvcmUvXCI7XG5pbXBvcnQgdHlwZSBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgTXV0YWJsZSBmcm9tIFwiLi4vdHlwZXMvbXV0YWJsZVwiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24gfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IExhbWJkYUludGVncmF0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWludGVncmF0aW9uXCI7XG5cbmltcG9ydCB7IGNyZWF0ZUhhc2gsIHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIjtcbmltcG9ydCB7IGNvcHlGaWxlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vZGVjb3JhdG9ycy9jb250cm9sbGVyXCI7XG5pbXBvcnQgeyBFTlZfS0VZUyB9IGZyb20gXCIuLi9mdzI0XCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgaXNBcnJheSwgaXNTdHJpbmcgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IEF1dGhDb25zdHJ1Y3QgfSBmcm9tIFwiLi9hdXRoXCI7XG5pbXBvcnQgeyBDZXJ0aWZpY2F0ZUNvbnN0cnVjdCB9IGZyb20gXCIuL2NlcnRpZmljYXRlXCI7XG5pbXBvcnQgeyBEeW5hbW9EQkNvbnN0cnVjdCB9IGZyb20gXCIuL2R5bmFtb2RiXCI7XG5pbXBvcnQgeyBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2xheWVyXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IFF1ZXVlQ29uc3RydWN0IH0gZnJvbSBcIi4vcXVldWVcIjtcbmltcG9ydCB7IFRvcGljQ29uc3RydWN0IH0gZnJvbSBcIi4vdG9waWNcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgYW4gQVBJIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQVBJQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBDT1JTIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBUEkuXG4gICAgICogSXQgY2FuIGJlIGEgYm9vbGVhbiB2YWx1ZSwgYSBzaW5nbGUgc3RyaW5nLCBvciBhbiBhcnJheSBvZiBzdHJpbmdzLlxuICAgICAqL1xuICAgIGNvcnM/OiBib29sZWFuIHwgc3RyaW5nIHwgc3RyaW5nW107XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgYWRkaXRpb25hbCBvcHRpb25zIGZvciB0aGUgQVBJLlxuICAgICAqL1xuICAgIGFwaU9wdGlvbnM/OiBSZXN0QXBpUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIGRpcmVjdG9yeSB3aGVyZSB0aGUgY29udHJvbGxlcnMgYXJlIGxvY2F0ZWQuXG4gICAgICovXG4gICAgY29udHJvbGxlcnNEaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIGZ1bmN0aW9uLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBudW1iZXIgb2YgZGF5cyB0byByZXRhaW4gdGhlIEFQSSBsb2dzLlxuICAgICAqL1xuICAgIGxvZ1JldGVudGlvbkRheXM/OiBSZXRlbnRpb25EYXlzO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSByZW1vdmFsIHBvbGljeSBmb3IgdGhlIEFQSSBsb2dzLlxuICAgICAqL1xuICAgIGxvZ1JlbW92YWxQb2xpY3k/OiBSZW1vdmFsUG9saWN5O1xuXG4gICAgLyoqXG4gICAgICogVGhlIGN1c3RvbSBkb21haW4gbmFtZSBmb3IgdGhlIEFQSS5cbiAgICAgKi9cbiAgICBkb21haW5OYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGNlcnRpZmljYXRlIEFSTiBmb3IgdGhlIGN1c3RvbSBkb21haW4gbmFtZS5cbiAgICAgKi9cbiAgICBjZXJ0aWZpY2F0ZUFybj86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEFQSSBHYXRld2F5IExhbWJkYSBpbnRlZ3JhdGlvbiB0aW1lb3V0IGluIHNlY29uZHMuXG4gICAgICovXG4gICAgaW50ZWdyYXRpb25UaW1lb3V0PzogbnVtYmVyO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHBhcmVudCBzdGFjayBuYW1lIGZvciB0aGUgQ29udHJvbGxlcnMuXG4gICAgICovXG4gICAgY29udHJvbGxlclBhcmVudFN0YWNrTmFtZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFNldCB0byBmYWxzZSBpZiB5b3Ugd2FudCB0byBza2lwIGNyZWF0aW9uIG9mIGNvbnRyb2xsZXJzIHJlc291cmNlcyBhbmQgbWV0aG9kc1xuICAgICAqIFRoaXMgd2lsbCBkZWxldGUgYWxsIHRoZSBjb250cm9sbGVycyByZXNvdXJjZXMgYW5kIG1ldGhvZHMgZnJvbSB0aGUgQVBJXG4gICAgICovXG4gICAgc2tpcENvbnRyb2xsZXJzPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIEZvcmNlIGEgZGVwbG95bWVudCBvZiB0aGUgQVBJIHdoZW4gdXNpbmcgaW1wb3J0ZWQgQVBJc1xuICAgICAqL1xuICAgIGZvcmNlRGVwbG95bWVudD86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBBUEkga2V5IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBUElcbiAgICAgKi9cbiAgICBhcGlLZXlDb25maWc/OiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBMaXN0IG9mIHZhbGlkIEFQSSBrZXlzLiBJZiBlbXB0eSwga2V5cyB3aWxsIGJlIGF1dG8tZ2VuZXJhdGVkXG4gICAgICAgICAqL1xuICAgICAgICBrZXlzPzogc3RyaW5nW107XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBOYW1lIG9mIHRoZSBBUEkga2V5ICh1c2VkIHdoZW4gYXV0by1nZW5lcmF0aW5nKVxuICAgICAgICAgKi9cbiAgICAgICAga2V5TmFtZT86IHN0cmluZztcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogVXNhZ2UgcGxhbiBjb25maWd1cmF0aW9uIGZvciB0aGUgQVBJXG4gICAgICovXG4gICAgdXNhZ2VQbGFucz86IElVc2FnZVBsYW5Db25maWdbXTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBBUEkga2V5IHdpdGhpbiBhIHVzYWdlIHBsYW5cbiAqL1xuaW50ZXJmYWNlIElVc2FnZVBsYW5BcGlLZXlDb25maWcge1xuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgdmFsaWQgQVBJIGtleXMuIElmIGVtcHR5LCBrZXlzIHdpbGwgYmUgYXV0by1nZW5lcmF0ZWRcbiAgICAgKi9cbiAgICBrZXlzPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogTmFtZSBwcmVmaXggZm9yIHRoZSBBUEkga2V5cyAodXNlZCB3aGVuIGF1dG8tZ2VuZXJhdGluZylcbiAgICAgKi9cbiAgICBrZXlOYW1lUHJlZml4Pzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIGEgdXNhZ2UgcGxhblxuICovXG5pbnRlcmZhY2UgSVVzYWdlUGxhbkNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogTmFtZSBvZiB0aGUgdXNhZ2UgcGxhblxuICAgICAqL1xuICAgIG5hbWU6IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBEZXNjcmlwdGlvbiBvZiB0aGUgdXNhZ2UgcGxhblxuICAgICAqL1xuICAgIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIFJhdGUgbGltaXQgcGVyIHNlY29uZFxuICAgICAqL1xuICAgIHJhdGVMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBCdXJzdCBsaW1pdFxuICAgICAqL1xuICAgIGJ1cnN0TGltaXQ/OiBudW1iZXI7XG4gICAgLyoqXG4gICAgICogUXVvdGEgbGltaXQgcGVyIHBlcmlvZFxuICAgICAqL1xuICAgIHF1b3RhTGltaXQ/OiBudW1iZXI7XG4gICAgLyoqXG4gICAgICogUXVvdGEgcGVyaW9kXG4gICAgICovXG4gICAgcXVvdGFQZXJpb2Q/OiBQZXJpb2Q7XG4gICAgLyoqXG4gICAgICogQVBJIGtleSBjb25maWd1cmF0aW9uIGZvciB0aGlzIHVzYWdlIHBsYW5cbiAgICAgKi9cbiAgICBhcGlLZXlzPzogSVVzYWdlUGxhbkFwaUtleUNvbmZpZztcbn1cblxuZXhwb3J0IGNsYXNzIEFQSUNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihBUElDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIG5hbWU6IHN0cmluZyA9IEFQSUNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbIFZwY0NvbnN0cnVjdC5uYW1lLCBNYWlsZXJDb25zdHJ1Y3QubmFtZSwgRHluYW1vREJDb25zdHJ1Y3QubmFtZSwgQXV0aENvbnN0cnVjdC5uYW1lLCBRdWV1ZUNvbnN0cnVjdC5uYW1lLCBUb3BpY0NvbnN0cnVjdC5uYW1lLCBMYXllckNvbnN0cnVjdC5uYW1lIF07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIGFwaSE6IFJlc3RBcGk7XG4gICAgbWFpblN0YWNrITogU3RhY2s7XG4gICAgdXNhZ2VQbGFuczogTWFwPHN0cmluZywgeyBwbGFuOiBVc2FnZVBsYW47IG5hbWU6IHN0cmluZyB9PiA9IG5ldyBNYXAoKTtcbiAgICBhcGlLZXlzOiBNYXA8c3RyaW5nLCBBcGlLZXlbXT4gPSBuZXcgTWFwKCk7XG4gICAga2V5VmFsdWVzOiBNYXA8c3RyaW5nLCBBcGlLZXk+ID0gbmV3IE1hcCgpO1xuXG4gICAgcHJpdmF0ZSByZXNvdXJjZXM6IElSZXNvdXJjZVtdID0gW107XG4gICAgcHJpdmF0ZSBtZXRob2RzOiBNZXRob2RbXSA9IFtdO1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY29udHJvbGxlclN0YWNrcyA9IG5ldyBNYXA8c3RyaW5nLCB7IG1ldGhvZHM6IE1ldGhvZFtdLCByZXNvdXJjZXM6IElSZXNvdXJjZVtdLCBjb250cm9sbGVyc0hhc2g6IHN0cmluZ1tdIH0+KCk7XG5cbiAgICAvLyBkZWZhdWx0IGNvbnN0cnVjdG9yIHRvIGluaXRpYWxpemUgdGhlIHN0YWNrIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGFwaUNvbnN0cnVjdENvbmZpZzogSUFQSUNvbnN0cnVjdENvbmZpZykge1xuICAgICAgICAvLyBoeWRyYXRlIHRoZSBjb25maWcgb2JqZWN0IHdpdGggZW52aXJvbm1lbnQgdmFyaWFibGVzIGV4OiBBUElHQVRFV0FZX0NPTlRST0xMRVJTXG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGFwaUNvbnN0cnVjdENvbmZpZywgJ0FQSUdBVEVXQVknKTtcbiAgICB9XG5cbiAgICAvLyBjb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2tcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBzZXQgdGhlIGRlZmF1bHQgYXBpIG9wdGlvbnNcbiAgICAgICAgY29uc3QgcGFyYW1zQXBpOiBNdXRhYmxlPFJlc3RBcGlQcm9wcz4gPSB7IC4uLnRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaU9wdGlvbnMgfHwge30gfTtcbiAgICAgICAgLy8gRW5hYmxlIENPUlMgaWYgZGVmaW5lZFxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJFbmFibGluZyBDT1JTLi4uIHRoaXMuY29uZmlnLmNvcnM6IFwiLCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKTtcbiAgICAgICAgICAgIHBhcmFtc0FwaS5kZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnMgPSB0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUgJiYgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBjb25zdCBjZXJ0aWZpY2F0ZUNvbnN0cnVjdCA9IG5ldyBDZXJ0aWZpY2F0ZUNvbnN0cnVjdCh7XG4gICAgICAgICAgICAgICAgZG9tYWluTmFtZTogdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSxcbiAgICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZUFybjogdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY2VydGlmaWNhdGVBcm5cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY2VydGlmaWNhdGVDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICAgICAgICBjb25zdCBjZXJ0aWZpY2F0ZSA9IGNlcnRpZmljYXRlQ29uc3RydWN0Lm91dHB1dFsgT3V0cHV0VHlwZS5DRVJUSUZJQ0FURSBdWyB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lIF07XG4gICAgICAgICAgICBwYXJhbXNBcGkuZG9tYWluTmFtZSA9IHtcbiAgICAgICAgICAgICAgICBkb21haW5OYW1lOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLFxuICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlOiBjZXJ0aWZpY2F0ZSxcbiAgICAgICAgICAgICAgICBiYXNlUGF0aDogcGFyYW1zQXBpLmRlcGxveU9wdGlvbnM/LnN0YWdlTmFtZSB8fCAnLycsXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIGZvciBtdWx0aXN0YWNrIGFwcGxpY2F0aW9uLCBzZXQgZGVwbG95IHRvIGZhbHNlXG4gICAgICAgIGlmICh0aGlzLmZ3MjQudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgIHBhcmFtc0FwaS5kZXBsb3kgPSBmYWxzZTtcbiAgICAgICAgICAgIGRlbGV0ZSBwYXJhbXNBcGkuZGVwbG95T3B0aW9ucztcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0aW5nIEFQSSBHYXRld2F5Li4uIFwiKTtcbiAgICAgICAgLy8gZ2V0IHRoZSBtYWluIHN0YWNrIGZyb20gdGhlIGZyYW1ld29ya1xuICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgIC8vIGNyZWF0ZSB0aGUgYXBpIGdhdGV3YXlcbiAgICAgICAgdGhpcy5hcGkgPSBuZXcgUmVzdEFwaSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWFwaWAsIHtcbiAgICAgICAgICAgIC4uLnBhcmFtc0FwaSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvcnNPcmlnaW5zID0gdGhpcy5nZXRDb3JzUHJlZmxpZ2h0T3B0aW9ucygpLmFsbG93T3JpZ2lucz8uam9pbignLCcpO1xuICAgICAgICAgICAgdGhpcy5hcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdkZWZhdWx0NHh4Jywge1xuICAgICAgICAgICAgICAgIHR5cGU6IFJlc3BvbnNlVHlwZS5ERUZBVUxUXzRYWCxcbiAgICAgICAgICAgICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGAnJHtjb3JzT3JpZ2luc30nYCxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuYXBpLmFkZEdhdGV3YXlSZXNwb25zZSgnZGVmYXVsdDV4eCcsIHtcbiAgICAgICAgICAgICAgICB0eXBlOiBSZXNwb25zZVR5cGUuREVGQVVMVF81WFgsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VIZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBgJyR7Y29yc09yaWdpbnN9J2AsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXQgdXAgdXNhZ2UgcGxhbnMgaWYgY29uZmlndXJlZFxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucz8ubGVuZ3RoKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBsYW5Db25maWcgb2YgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucykge1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0dXBVc2FnZVBsYW4ocGxhbkNvbmZpZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmZ3MjQuYWRkQVBJKHRoaXMubmFtZSwgJ3Jvb3QnLCB0aGlzLmFwaSwgZmFsc2UpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsICdyZXN0QVBJJywgdGhpcy5hcGksIE91dHB1dFR5cGUuQVBJLCAncmVzdEFwaUlkJyk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ3Jlc3RBUEknLCB0aGlzLmFwaSwgT3V0cHV0VHlwZS5BUEksICdyZXN0QXBpUm9vdFJlc291cmNlSWQnKTtcblxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuc2tpcENvbnRyb2xsZXJzKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcnMoKTtcblxuICAgICAgICAvLyBpZiBtdWx0aS9uZXN0ZWQtc3RhY2sgc2V0dXAsIHRoZW4gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEFQSS1nYXRld2F5IGNvbnN0cnVjdDogJHt0aGlzLm5hbWV9IGhhcyBpbXBvcnRlZCBBUElzOiAke3RoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpfWApO1xuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSkgJiYgdGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZURlcGxveW1lbnRzKCk7XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSkpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU2luZ2xlRGVwbG95bWVudCgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRBUEkgPSAoc3RhY2tOYW1lOiBzdHJpbmcpOiBhbnkgPT4ge1xuICAgICAgICBsZXQgY3VycmVudEFQSTogYW55ID0gdGhpcy5mdzI0LmdldEFQSSh0aGlzLm5hbWUsICdyb290Jyk7XG5cbiAgICAgICAgLy8gaWYgdGhlIHN0YWNrIGlzIG5vdCB0aGUgbWFpbiBzdGFjayBhbmQgaXRzIGEgbXVsdGktc3RhY2sgYXBwbGljYXRpb24gb3IgYSBuZXN0ZWQgc3RhY2ssIHRoZW4gaW1wb3J0IHRoZSBBUElcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHN0YWNrTmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXJyZW50IFN0YWNrOiAke2N1cnJlbnRTdGFjay5zdGFja05hbWV9IGlzIG5lc3RlZCBzdGFjazogJHtjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFja31gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCB0aGlzLm1haW5TdGFjaykgfHwgY3VycmVudFN0YWNrIGluc3RhbmNlb2YgTmVzdGVkU3RhY2spIHtcbiAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGlmICghY3VycmVudEFQSSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGltcG9ydGVkQVBJID0gUmVzdEFwaS5mcm9tUmVzdEFwaUF0dHJpYnV0ZXMoY3VycmVudFN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtzdGFja05hbWV9LWFwaWAsIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdEFwaUlkOiB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgncmVzdEFQSV9yZXN0QXBpSWQnLCAnYXBpJywgY3VycmVudFN0YWNrKSxcbiAgICAgICAgICAgICAgICAgICAgcm9vdFJlc291cmNlSWQ6IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdyZXN0QVBJX3Jlc3RBcGlSb290UmVzb3VyY2VJZCcsICdhcGknLCBjdXJyZW50U3RhY2spLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5hZGRBUEkodGhpcy5uYW1lLCBzdGFja05hbWUsIGltcG9ydGVkQVBJLCB0cnVlKTtcbiAgICAgICAgICAgICAgICBjdXJyZW50QVBJID0gdGhpcy5mdzI0LmdldEFQSSh0aGlzLm5hbWUsIHN0YWNrTmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3VycmVudEFQSTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHJlZ2lzdGVyQ29udHJvbGxlcnMoKSB7XG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgY29udHJvbGxlcnMgZGlyZWN0b3J5IGlmIG5vdCBkZWZpbmVkXG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzRGlyZWN0b3J5ID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29udHJvbGxlcnNEaXJlY3RvcnkgfHwgXCIuL3NyYy9jb250cm9sbGVyc1wiO1xuXG4gICAgICAgIC8vIHJlZ2lzdGVyIHRoZSBjb250cm9sbGVyc1xuICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhjb250cm9sbGVyc0RpcmVjdG9yeSwgdGhpcy5yZWdpc3RlckNvbnRyb2xsZXIpO1xuXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVzID0gdGhpcy5mdzI0LmdldE1vZHVsZXMoKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBtb2R1bGVzIFwiLCBBcnJheS5mcm9tKG1vZHVsZXMua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBtb2R1bGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiTG9hZCBjb250cm9sbGVycyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG5cbiAgICAgICAgICAgICAgICBIZWxwZXIucmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGUoXG4gICAgICAgICAgICAgICAgICAgIG1vZHVsZSxcbiAgICAgICAgICAgICAgICAgICAgKGRlc2M6IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcihkZXNjLCBtb2R1bGUpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBOTyBtb2R1bGVzIFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlZ2lzdGVyIHN5c3RlbSBjb250cm9sbGVycyBmcm9tIGZ3MjQgc2luZ2xldG9uXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzU3lzdGVtQ29udHJvbGxlcnMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiByZWdpc3RlcmluZyBzeXN0ZW0gY29udHJvbGxlcnNcIik7XG5cbiAgICAgICAgICAgIC8vIENvcHkgc3lzdGVtIGNvbnRyb2xsZXJzIHRvIGFwcCBkaXN0IGFuZCByZWdpc3RlciBmcm9tIHRoZXJlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvcHlBbmRSZWdpc3RlclN5c3RlbUNvbnRyb2xsZXJzKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgTk8gc3lzdGVtIGNvbnRyb2xsZXJzXCIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBjb3B5QW5kUmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVycygpIHtcbiAgICAgICAgY29uc3Qgc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIgPSBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgJ2Rpc3QnLCAnc3lzdGVtLWNvbnRyb2xsZXJzJyk7XG5cbiAgICAgICAgLy8gRW5zdXJlIHRhcmdldCBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgIGlmICghZXhpc3RzU3luYyhzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpcikpIHtcbiAgICAgICAgICAgIG1rZGlyU3luYyhzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHN5c3RlbUNvbnRyb2xsZXIgb2YgdGhpcy5mdzI0LmdldFN5c3RlbUNvbnRyb2xsZXJzKCkpIHtcbiAgICAgICAgICAgIGxldCByZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrID0gJyc7XG4gICAgICAgICAgICAvLyBGYWxsYmFjazogdXNlIHRoZSBsYXN0IGZldyBkaXJlY3RvcmllcyB0byBwcmVzZXJ2ZSBzdHJ1Y3R1cmVcbiAgICAgICAgICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHN5c3RlbUNvbnRyb2xsZXIuZmlsZVBhdGguc3BsaXQoJy8nKTtcbiAgICAgICAgICAgIGNvbnN0IHJlbGV2YW50UGFydHMgPSBwYXRoUGFydHMuc2xpY2UoLTMpOyAvLyBlLmcuLCBbJ3NlYXJjaCcsICdzeXN0ZW0nLCAnc2VhcmNoLWNvbnRyb2xsZXIuanMnXVxuICAgICAgICAgICAgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayA9IHJlbGV2YW50UGFydHMuam9pbignLycpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTeXN0ZW0gY29udHJvbGxlciByZWxhdGl2ZSBwYXRoOiAke3JlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmt9YCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHRhcmdldEZpbGVQYXRoID0gcGF0aC5qb2luKHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyLCByZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrKTtcbiAgICAgICAgICAgIGNvbnN0IHRhcmdldERpcmVjdG9yeSA9IHBhdGguZGlybmFtZSh0YXJnZXRGaWxlUGF0aCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBTeXN0ZW0gY29udHJvbGxlciB0YXJnZXQtZGlyZWN0b3J5OiAke3RhcmdldERpcmVjdG9yeX0sIHRhcmdldEZpbGVQYXRoOiAke3RhcmdldEZpbGVQYXRofWApO1xuXG4gICAgICAgICAgICAvLyBFbnN1cmUgdGFyZ2V0IHN1YmRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyh0YXJnZXREaXJlY3RvcnkpKSB7XG4gICAgICAgICAgICAgICAgbWtkaXJTeW5jKHRhcmdldERpcmVjdG9yeSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENvcHkgdGhlIHN5c3RlbSBjb250cm9sbGVyIGZpbGVcbiAgICAgICAgICAgIGNvcHlGaWxlU3luYyhzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRoLCB0YXJnZXRGaWxlUGF0aCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb3BpZWQgc3lzdGVtIGNvbnRyb2xsZXIgZnJvbSAke3N5c3RlbUNvbnRyb2xsZXIuZmlsZVBhdGh9IHRvICR7dGFyZ2V0RmlsZVBhdGh9YCk7XG5cbiAgICAgICAgICAgIC8vIFJlZ2lzdGVyIGZyb20gdGhlIGNvcGllZCBsb2NhdGlvblxuICAgICAgICAgICAgY29uc3QgZGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKHRhcmdldEZpbGVQYXRoKTtcbiAgICAgICAgICAgIGNvbnN0IGZpbGVOYW1lID0gcGF0aC5iYXNlbmFtZSh0YXJnZXRGaWxlUGF0aCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyBzeXN0ZW0gY29udHJvbGxlcjogJHtmaWxlTmFtZX1gKTtcblxuICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoXG4gICAgICAgICAgICAgICAgZGlyZWN0b3J5LFxuICAgICAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJDb250cm9sbGVyLFxuICAgICAgICAgICAgICAgIFsgZmlsZU5hbWUgXVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcHJlcGFyZUVudHJ5UGFja2FnZXMoY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlPzogSUZ3MjRNb2R1bGUpOiBzdHJpbmdbXSB7XG4gICAgICAgIGxldCBlbnRyeVBhY2thZ2VzID0gY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzIHx8IFtdO1xuXG4gICAgICAgIGlmIChpc0FycmF5KGVudHJ5UGFja2FnZXMpKSB7XG4gICAgICAgICAgICBlbnRyeVBhY2thZ2VzID0ge1xuICAgICAgICAgICAgICAgIG92ZXJyaWRlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBwYWNrYWdlTmFtZXM6IGVudHJ5UGFja2FnZXNcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGlmIHRoZSBjb250cm9sbGVyIGRvZXMgbm90IHdhbnQgdG8gb3ZlcnJpZGUgdGhlIGFwcGxpY2F0aW9uL21vZHVsZSBlbnRyeSBwYWNrYWdlcyBhbmQgaW5jbHVkZSB0aGVtIGFzIHdlbGxcbiAgICAgICAgaWYgKCFlbnRyeVBhY2thZ2VzLm92ZXJyaWRlKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVFbnRyeVBhY2thZ2VzID0gb3duZXJNb2R1bGU/LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKSB8fCBbXTtcbiAgICAgICAgICAgIGNvbnN0IGFwcEVudHJ5UGFja2FnZXMgPSB0aGlzLmZ3MjQuZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpO1xuICAgICAgICAgICAgZW50cnlQYWNrYWdlcy5wYWNrYWdlTmFtZXMgPSBbXG4gICAgICAgICAgICAgICAgLi4uZW50cnlQYWNrYWdlcy5wYWNrYWdlTmFtZXMsXG4gICAgICAgICAgICAgICAgLi4ubW9kdWxlRW50cnlQYWNrYWdlcyxcbiAgICAgICAgICAgICAgICAuLi5hcHBFbnRyeVBhY2thZ2VzXG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzLm1hcCh0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKTtcbiAgICB9XG5cblxuICAgIC8vIHJlZ2lzdGVyIGEgc2luZ2xlIGNvbnRyb2xsZXJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lzdGVyQ29udHJvbGxlciA9IGFzeW5jIChjb250cm9sbGVySW5mbzogSGFuZGxlckRlc2NyaXB0b3IsIG93bmVyTW9kdWxlPzogSUZ3MjRNb2R1bGUpID0+IHtcbiAgICAgICAgY29uc3QgeyBoYW5kbGVyQ2xhc3MsIGZpbGVQYXRoLCBmaWxlTmFtZSB9ID0gY29udHJvbGxlckluZm87XG4gICAgICAgIC8vIEFkZCB0aGUgZm9sZGVyIHBhdGggZnJvbSBmaWxlbmFtZSB0byB0aGUgY29udHJvbGxlciBuYW1lXG4gICAgICAgIGNvbnN0IGZvbGRlclBhdGggPSBmaWxlTmFtZS5zcGxpdCgnLycpLnNsaWNlKDAsIC0xKS5qb2luKCcvJyk7XG4gICAgICAgIGNvbnN0IGhhbmRsZXJJbnN0YW5jZSA9IG5ldyBoYW5kbGVyQ2xhc3MoKTtcbiAgICAgICAgY29uc3QgY29udHJvbGxlck5hbWUgPSBmaWxlTmFtZS5pbmNsdWRlcygnLycpID8gZm9sZGVyUGF0aCArICcvJyArIGhhbmRsZXJJbnN0YW5jZS5jb250cm9sbGVyTmFtZSA6IGhhbmRsZXJJbnN0YW5jZS5jb250cm9sbGVyTmFtZTtcbiAgICAgICAgY29uc3QgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcgPSBoYW5kbGVySW5zdGFuY2U/LmNvbnRyb2xsZXJDb25maWcgfHwge307XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJTdGFja05hbWUgPSBjb250cm9sbGVyQ29uZmlnLnN0YWNrTmFtZSB8fCBjb250cm9sbGVyTmFtZTtcbiAgICAgICAgY29uc3QgcGFyZW50U3RhY2tOYW1lID0gY29udHJvbGxlckNvbmZpZy5wYXJlbnRTdGFja05hbWUgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29udHJvbGxlclBhcmVudFN0YWNrTmFtZTtcblxuICAgICAgICAvLyBJbml0aWFsaXplIGNvbnRyb2xsZXIgc3RhY2sgaW5mbyBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5jb250cm9sbGVyU3RhY2tzLmhhcyhjb250cm9sbGVyU3RhY2tOYW1lKSkge1xuICAgICAgICAgICAgdGhpcy5jb250cm9sbGVyU3RhY2tzLnNldChjb250cm9sbGVyU3RhY2tOYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0aG9kczogW10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXSxcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyc0hhc2g6IFtdXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG1ha2Ugc3VyZSB0aGUgY29udHJvbGxlciBzdGFjayBleGlzdHNcbiAgICAgICAgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUsIHBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgIGNvbnRyb2xsZXJJbmZvLnJvdXRlcyA9IGhhbmRsZXJJbnN0YW5jZS5yb3V0ZXM7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIGNvbnRyb2xsZXIgJHtjb250cm9sbGVyTmFtZX1gKTtcblxuICAgICAgICAvLyBwcmVwYXJlIHRoZSBlbnRyeSBwYWNrYWdlcyBmb3IgdGhlIGNvbnRyb2xsZXIncyBsYW1iZGEgZnVuY3Rpb25cbiAgICAgICAgY29uc3QgZW50cnlQYWNrYWdlcyA9IHRoaXMucHJlcGFyZUVudHJ5UGFja2FnZXMoY29udHJvbGxlckNvbmZpZywgb3duZXJNb2R1bGUpO1xuICAgICAgICBjb250cm9sbGVyQ29uZmlnLmVudHJ5UGFja2FnZXMgPSBlbnRyeVBhY2thZ2VzO1xuXG4gICAgICAgIHRoaXMucmVzb3VyY2VzID0gW107XG4gICAgICAgIHRoaXMubWV0aG9kcyA9IFtdO1xuICAgICAgICAvLyBjcmVhdGUgdGhlIGFwaSByZXNvdXJjZSBmb3IgdGhlIGNvbnRyb2xsZXIgaWYgaXQgZG9lc24ndCBleGlzdFxuICAgICAgICBjb25zdCBjb250cm9sbGVyUmVzb3VyY2UgPSB0aGlzLmdldE9yQ3JlYXRlQ29udHJvbGxlclJlc291cmNlKGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcblxuICAgICAgICBsZXQgY29udHJvbGxlclRhcmdldCA9IGNvbnRyb2xsZXJDb25maWcudGFyZ2V0O1xuICAgICAgICBsZXQgY29udHJvbGxlckludGVncmF0aW9uOiBhbnk7XG4gICAgICAgIC8vIGNyZWF0ZSBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSBjb250cm9sbGVyXG4gICAgICAgIGlmIChjb250cm9sbGVyVGFyZ2V0ID09PSAnZnVuY3Rpb24nIHx8IGNvbnRyb2xsZXJUYXJnZXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzID0gY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzIHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmxvZ1JldGVudGlvbkRheXM7XG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3kgPSBjb250cm9sbGVyQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3kgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubG9nUmVtb3ZhbFBvbGljeTtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJMYW1iZGEgPSB0aGlzLmNyZWF0ZUxhbWJkYUZ1bmN0aW9uKGNvbnRyb2xsZXJOYW1lLCBmaWxlUGF0aCwgZmlsZU5hbWUsIGNvbnRyb2xsZXJDb25maWcsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlckxhbWJkYSwgT3V0cHV0VHlwZS5GVU5DVElPTik7XG5cbiAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IG5ldyBMYW1iZGFJbnRlZ3JhdGlvbihjb250cm9sbGVyTGFtYmRhLCB7XG4gICAgICAgICAgICAgICAgcmVzdEFwaTogdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSkuYXBpLFxuICAgICAgICAgICAgICAgIHBhdGg6IGNvbnRyb2xsZXJOYW1lLFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHModGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuaW50ZWdyYXRpb25UaW1lb3V0IHx8IDI5KSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH0gPSB0aGlzLmV4dHJhY3REZWZhdWx0QXV0aG9yaXplcihjb250cm9sbGVyQ29uZmlnKTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXIgQ29udHJvbGxlciB+IERlZmF1bHQgQXV0aG9yaXplcjogbmFtZTogJHtkZWZhdWx0QXV0aG9yaXplck5hbWV9IC0gdHlwZTogJHtkZWZhdWx0QXV0aG9yaXplclR5cGV9IC0gZ3JvdXBzOiAke2RlZmF1bHRBdXRob3JpemVyR3JvdXBzfWApO1xuXG4gICAgICAgIC8vIFNldCB1cCBBUEkga2V5IGlmIHJlcXVpcmVkXG4gICAgICAgIGlmIChjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkpIHtcbiAgICAgICAgICAgIHRoaXMuc2V0dXBVc2FnZVBsYW4odW5kZWZpbmVkLCB0cnVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB1cCByb3V0ZXMgZm9yIHRoZSBjb250cm9sbGVyXG4gICAgICAgIGZvciAoY29uc3Qgcm91dGUgb2YgT2JqZWN0LnZhbHVlcyhjb250cm9sbGVySW5mby5yb3V0ZXMgPz8ge30pKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgcm91dGUgJHtyb3V0ZS5odHRwTWV0aG9kfSAke3JvdXRlLnBhdGh9YCk7XG4gICAgICAgICAgICBjb25zdCByb3V0ZVRhcmdldCA9IHJvdXRlLnRhcmdldCB8fCBjb250cm9sbGVyVGFyZ2V0O1xuICAgICAgICAgICAgY29uc3QgY3VycmVudFJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZVJvdXRlUmVzb3VyY2UoY29udHJvbGxlclJlc291cmNlLCByb3V0ZS5wYXRoLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IHsgcm91dGVBdXRob3JpemVyTmFtZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfSA9IHRoaXMuZXh0cmFjdFJvdXRlQXV0aG9yaXplcihyb3V0ZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgcm91dGUgQXV0aG9yaXplcjogJHtyb3V0ZUF1dGhvcml6ZXJOYW1lfSAtICR7cm91dGVBdXRob3JpemVyVHlwZX0gLSAke3JvdXRlQXV0aG9yaXplckdyb3Vwc31gKTtcblxuICAgICAgICAgICAgbGV0IG1ldGhvZE9wdGlvbnMgPSB0aGlzLmNyZWF0ZU1ldGhvZE9wdGlvbnMocm91dGUsIHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplck5hbWUsIGNvbnRyb2xsZXJDb25maWcpO1xuXG4gICAgICAgICAgICBpZiAocm91dGVUYXJnZXQgPT09ICdxdWV1ZScpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSByb3V0ZS5wYXRoLnJlcGxhY2UoJy8nLCAnJyk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gdGhpcy5jcmVhdGVTUVNJbnRlZ3JhdGlvbihxdWV1ZU5hbWUsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBtZXRob2RPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi5tZXRob2RPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJvdXRlVGFyZ2V0ID09PSAndG9waWMnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdG9waWNOYW1lID0gcm91dGUucGF0aC5yZXBsYWNlKCcvJywgJycpO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IHRoaXMuY3JlYXRlU05TSW50ZWdyYXRpb24odG9waWNOYW1lLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgbWV0aG9kT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubWV0aG9kT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBtZXRob2QgPSBjdXJyZW50UmVzb3VyY2UuYWRkTWV0aG9kKHJvdXRlLmh0dHBNZXRob2QsIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiwgbWV0aG9kT3B0aW9ucyk7XG4gICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChtZXRob2QpO1xuXG4gICAgICAgICAgICAvLyBpZiBhdXRob3JpemVyIGlzIEFXU19JQU0sIHRoZW4gYWRkIHRoZSByb3V0ZSB0byB0aGUgcG9saWN5XG4gICAgICAgICAgICBpZiAocm91dGVBdXRob3JpemVyVHlwZSA9PT0gJ0FXU19JQU0nKSB7XG4gICAgICAgICAgICAgICAgbGV0IGZ1bGxSb3V0ZVBhdGggPSBjb250cm9sbGVyTmFtZSArIHJvdXRlLnBhdGg7XG5cbiAgICAgICAgICAgICAgICAvLyAqIHJlcGxhY2UgZWFjaCBwYXJhbSBwbGFjZWhvbGRlciBge2lkfWAgd2l0aCBhbiBgKmBcbiAgICAgICAgICAgICAgICByb3V0ZS5wYXJhbWV0ZXJzPy5mb3JFYWNoKHBhciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGZ1bGxSb3V0ZVBhdGggPSBmdWxsUm91dGVQYXRoLnJlcGxhY2UoYHske3Bhcn19YCwgJyonKTtcbiAgICAgICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZFJvdXRlVG9Sb2xlUG9saWN5KGZ1bGxSb3V0ZVBhdGgsIHJvdXRlQXV0aG9yaXplckdyb3Vwcywgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGtlZXAgdHJhY2sgb2YgdGhlIGNvbnRyb2xsZXIgc3RhY2tzIHdpdGggbWV0aG9kcyBhbmQgcmVzb3VyY2VzIGluIGEgbXVsdGktc3RhY2sgc2V0dXAgdG8gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSkge1xuICAgICAgICAgICAgY29uc3Qgc3RhY2tJbmZvID0gdGhpcy5jb250cm9sbGVyU3RhY2tzLmdldChjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGlmIChzdGFja0luZm8pIHtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8ubWV0aG9kcyA9IFsgLi4udGhpcy5tZXRob2RzIF07XG4gICAgICAgICAgICAgICAgc3RhY2tJbmZvLnJlc291cmNlcyA9IFsgLi4udGhpcy5yZXNvdXJjZXMgXTtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8uY29udHJvbGxlcnNIYXNoLnB1c2goY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEpTT04uc3RyaW5naWZ5KGNvbnRyb2xsZXJDb25maWcpKS5kaWdlc3QoJ2hleCcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG91dHB1dCB0aGUgYXBpIGVuZHBvaW50XG4gICAgICAgIHRoaXMub3V0cHV0QXBpRW5kcG9pbnQoY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJSZXNvdXJjZSwgdGhpcy5nZXRTdGFnZU5hbWUoKSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRTdGFnZU5hbWUgPSAoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlPcHRpb25zPy5kZXBsb3lPcHRpb25zPy5zdGFnZU5hbWUgfHwgJ3Byb2QnO1xuICAgIH1cblxuICAgIC8vIGlmIHRoZSBBUEkgaXMgaW1wb3J0ZWQsIHRoZW4gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrIGFuZCBhZGQgbWV0aG9kIGFuZCByZXNvdXJjZSBhcyBkZXBlbmRlbmN5XG4gICAgLy8gVGhpcyBpcyBuZWVkZWQgYmVjYXVzZSBpbXBvcnRlZCBBUEkgZG9lcyBub3QgcHJvcG9nYXRlIENPUlMgc2V0dGluZ3MgdG8gdGhlIG1ldGhvZHNcbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZURlcGxveW1lbnRzKCkge1xuXG4gICAgICAgIGNvbnN0IHN0YWdlTmFtZSA9IHRoaXMuZ2V0U3RhZ2VOYW1lKCk7XG4gICAgICAgIGZvciAoY29uc3QgWyBjb250cm9sbGVyU3RhY2tOYW1lLCB7IG1ldGhvZHMsIHJlc291cmNlcywgY29udHJvbGxlcnNIYXNoIH0gXSBvZiB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZW50cmllcygpKSB7XG4gICAgICAgICAgICAvLyBUT0RPOiBhZGQgYmV0dGVyIGxvZ2ljIHRvIGZvcmNlIGEgZGVwbG95bWVudCB3aGVuIHRoZXJlIGlzIGEgY2hhbmdlIGluIGZyYW1ld29yayBjb2RlXG4gICAgICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZm9yY2VEZXBsb3ltZW50KSB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoLnB1c2gocmFuZG9tVVVJRCgpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlckhhc2ggPSBjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoY29udHJvbGxlcnNIYXNoKSkuZGlnZXN0KCdoZXgnKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBkZXBsb3ltZW50IGZvciBjb250cm9sbGVyIHN0YWNrICR7Y29udHJvbGxlclN0YWNrTmFtZX0gd2l0aCBoYXNoICR7Y29udHJvbGxlckhhc2h9YCk7XG4gICAgICAgICAgICBjb25zdCBkZXBsb3ltZW50ID0gbmV3IERlcGxveW1lbnQodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgZGVwbG95bWVudC0ke2NvbnRyb2xsZXJIYXNofWAsIHtcbiAgICAgICAgICAgICAgICBhcGk6IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaSxcbiAgICAgICAgICAgICAgICBzdGFnZU5hbWU6IHN0YWdlTmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBtZXRob2RzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyBtZXRob2QgZGVwZW5kZW5jeSAke21ldGhvZC5odHRwTWV0aG9kfSAke21ldGhvZC5yZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kobWV0aG9kKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBhZGQgZGVwZW5kZWN5IG9uIGFsbCByZXNvdXJjZXMgZm9yIHRoaXMgY29udHJvbGxlclxuICAgICAgICAgICAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNvdXJjZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIHJlc291cmNlIGRlcGVuZGVuY3kgJHtyZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kocmVzb3VyY2UpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBpZiB0aGUgYXBpIGlzIGltcG9ydGVkIGFuZCBpdCdzIG5vdCBhIG11bHRpLXN0YWNrIHNldHVwLCB0aGVuIGNyZWF0ZSBhIHNpbmdsZSBkZXBsb3ltZW50IGZvciBhbGwgY29udHJvbGxlcnNcbiAgICAvLyBTaW5nbGUgZGVwbG95bWVudCBpcyBuZWVkZWQgdG8gYXZvaWQgc2ltdWx0YXRpb24gZGVwbG95bWVudCB3aGljaCBjYXVzZXMgZXJyb3Igb24gQVBJIEdhdGV3YXlcbiAgICBwcml2YXRlIGFzeW5jIGNyZWF0ZVNpbmdsZURlcGxveW1lbnQoKSB7XG4gICAgICAgIGNvbnN0IHN0YWdlTmFtZSA9IHRoaXMuZ2V0U3RhZ2VOYW1lKCk7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5mb3JFYWNoKGMgPT4gYy5jb250cm9sbGVyc0hhc2gucHVzaChyYW5kb21VVUlEKCkpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjcmVhdGUgdGhlIG5hbWUgZnJvbSBhbGwgdGhlIGNvbnRyb2xsZXIgaGFzaCB2YWx1ZXMgY29tYmluZWQgYXMgYSBzaW5nbGUgaGFzaCBhbmQgYWRkIGRlcGVuZGVuY3kgb24gYWxsIHRoZSBjb250cm9sbGVyc1xuICAgICAgICBjb25zdCBkZXBsb3ltZW50TmFtZSA9IGBkZXBsb3ltZW50LSR7Y3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEFycmF5LmZyb20odGhpcy5jb250cm9sbGVyU3RhY2tzLnZhbHVlcygpKS5tYXAoYyA9PiBjLmNvbnRyb2xsZXJzSGFzaCkuam9pbignLScpKS5kaWdlc3QoJ2hleCcpfWA7XG5cbiAgICAgICAgY29uc3QgZGVwbG95bWVudCA9IG5ldyBEZXBsb3ltZW50KHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLm5hbWUpLCBkZXBsb3ltZW50TmFtZSwge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgICAgICAgIHN0YWdlTmFtZTogc3RhZ2VOYW1lLFxuICAgICAgICB9KTtcblxuICAgICAgICBmb3IgKGNvbnN0IFsgX2NvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzIH0gXSBvZiB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZW50cmllcygpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBtZXRob2RzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyBtZXRob2QgZGVwZW5kZW5jeSAke21ldGhvZC5odHRwTWV0aG9kfSAke21ldGhvZC5yZXNvdXJjZS5wYXRofSB0byBkZXBsb3ltZW50YCk7XG4gICAgICAgICAgICAgICAgZGVwbG95bWVudC5ub2RlLmFkZERlcGVuZGVuY3kobWV0aG9kKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgcmVzb3VyY2UgZGVwZW5kZW5jeSAke3Jlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGdldENvcnNQcmVmbGlnaHRPcHRpb25zKCk6IENvcnNPcHRpb25zIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGFsbG93SGVhZGVyczogW1xuICAgICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXG4gICAgICAgICAgICAgICAgXCJBdXRob3JpemF0aW9uXCIsXG4gICAgICAgICAgICAgICAgXCJYLUFwaS1LZXlcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LURhdGVcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LUNvbnRlbnQtU2hhMjU2XCIsXG4gICAgICAgICAgICAgICAgXCJYLUFtei1TZWN1cml0eS1Ub2tlblwiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHNcIixcbiAgICAgICAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnNcIixcbiAgICAgICAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiLFxuICAgICAgICAgICAgICAgIFwiSW1wZXJzb25hdGluZy1Vc2VyLVN1YlwiLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGFsbG93TWV0aG9kczogWyBcIk9QVElPTlNcIiwgXCJHRVRcIiwgXCJQT1NUXCIsIFwiUFVUXCIsIFwiUEFUQ0hcIiwgXCJERUxFVEVcIiBdLFxuICAgICAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcbiAgICAgICAgICAgIGFsbG93T3JpZ2luczogdGhpcy5nZXRDb3JzT3JpZ2lucygpLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc09yaWdpbnMoKTogc3RyaW5nW10ge1xuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyA9PT0gdHJ1ZSkgcmV0dXJuIENvcnMuQUxMX09SSUdJTlM7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIFsgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyBdO1xuICAgICAgICByZXR1cm4gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyB8fCBbXTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldE9yQ3JlYXRlQ29udHJvbGxlclJlc291cmNlID0gKGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IElSZXNvdXJjZSA9PiB7XG4gICAgICAgIGxldCByZXN0QVBJID0gdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgIGxldCBjb250cm9sbGVyUmVzb3VyY2U6IElSZXNvdXJjZSA9IHJlc3RBUEkuYXBpLnJvb3Q7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRTdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgY29uc3QgcGF0aFBhcnRzID0gY29udHJvbGxlck5hbWUuc3BsaXQoJy8nKTtcbiAgICAgICAgZm9yIChjb25zdCBwYXRoUGFydCBvZiBwYXRoUGFydHMpIHtcbiAgICAgICAgICAgIGxldCBjaGlsZFJlc291cmNlID0gY29udHJvbGxlclJlc291cmNlLmdldFJlc291cmNlKHBhdGhQYXJ0KSBhcyBJUmVzb3VyY2U7XG4gICAgICAgICAgICAvLyBpZiBpdCdzIGEgbmVzdGVkIGNvbnRyb2xsZXIsIHRoZSByb290IHJlc291cmNlIG1heSBub3QgYmUgY3JlYXRlZCBpbiBhbm90aGVyIHN0YWNrXG4gICAgICAgICAgICBjb25zdCBpc05lc3RlZENvbnRyb2xsZXIgPSBwYXRoUGFydHMubGVuZ3RoID4gMTtcbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSAmJiBpc05lc3RlZENvbnRyb2xsZXIgJiYgcGF0aFBhcnQgPT09IHBhdGhQYXJ0c1sgMCBdKSB7XG4gICAgICAgICAgICAgICAgLy8gdHJ5IHRvIGdldCB0aGUgcm9vdCByZXNvdXJjZSBmcm9tIHRoZSBmdzI0IG91dHB1dFxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBHZXR0aW5nIGNvbnRyb2xsZXIgcmVzb3VyY2UgZm9yICR7cGF0aFBhcnR9IGZyb20gZncyNCBvdXRwdXRgKTtcbiAgICAgICAgICAgICAgICBjb25zdCBjb250cm9sbGVyUmVzb3VyY2VJZCA9IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGByZXN0QVBJX2NvbnRyb2xsZXJfJHtwYXRoUGFydH1fcmVzb3VyY2VJZGAsICdyZXNvdXJjZScsIGN1cnJlbnRTdGFjayk7XG4gICAgICAgICAgICAgICAgaWYgKGNvbnRyb2xsZXJSZXNvdXJjZUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDb250cm9sbGVyIHJlc291cmNlIGZvciAke3BhdGhQYXJ0fSBmb3VuZCBpbiBmdzI0IG91dHB1dDogJHtjb250cm9sbGVyUmVzb3VyY2VJZH1gKTtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IFJlc291cmNlLmZyb21SZXNvdXJjZUF0dHJpYnV0ZXMoY3VycmVudFN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb250cm9sbGVyU3RhY2tOYW1lfS0ke3BhdGhQYXJ0fWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlSWQ6IGNvbnRyb2xsZXJSZXNvdXJjZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdEFwaTogcmVzdEFQSS5hcGksXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiAnLycgKyBwYXRoUGFydFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWNoaWxkUmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICAvLyBmb3IgbmVzdGVkIHJlc291cmNlcyBhZGQgLyB0byB0aGUgcGF0aFxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBjb250cm9sbGVyIHJlc291cmNlIGZvciBwYXRoICR7cGF0aFBhcnR9IHVuZGVyICR7Y29udHJvbGxlclJlc291cmNlLnBhdGh9YCk7XG4gICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IGNvbnRyb2xsZXJSZXNvdXJjZS5hZGRSZXNvdXJjZShwYXRoUGFydCkgYXMgSVJlc291cmNlO1xuICAgICAgICAgICAgICAgIGlmIChyZXN0QVBJLmlzSW1wb3J0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29yc1ByZWZsaWdodE1ldGhvZCA9IGNoaWxkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChjb3JzUHJlZmxpZ2h0TWV0aG9kKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGlzTmVzdGVkQ29udHJvbGxlciAmJiBwYXRoUGFydCA9PT0gcGF0aFBhcnRzWyAwIF0pIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFNldHRpbmcgb3V0cHV0IGZvciBjb250b3JsbGVyIHJlc291cmNlICR7Y29udHJvbGxlclN0YWNrTmFtZX0gcGF0aCAke3BhdGhQYXJ0fWApO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGByZXN0QVBJX2NvbnRyb2xsZXJfJHtwYXRoUGFydH1gLCBjaGlsZFJlc291cmNlLCBPdXRwdXRUeXBlLlJFU09VUkNFLCAncmVzb3VyY2VJZCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRyb2xsZXJSZXNvdXJjZSA9IGNoaWxkUmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY29udHJvbGxlclJlc291cmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlTGFtYmRhRnVuY3Rpb24gPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZywgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IE5vZGVqc0Z1bmN0aW9uID0+IHtcbiAgICAgICAgY29uc3QgZnVuY3Rpb25Qcm9wcyA9IHsgLi4udGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcywgLi4uY29udHJvbGxlckNvbmZpZz8uZnVuY3Rpb25Qcm9wcyB9O1xuXG4gICAgICAgIGNvbnN0IGVudlZhcmlhYmxlcyA9IHRoaXMuZncyNC5yZXNvbHZlRW52VmFyaWFibGVzKGNvbnRyb2xsZXJDb25maWcuZW52LCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpO1xuXG4gICAgICAgIC8vIGRvIG5vdCBvdmVycmlkZSB0aGUgZW50cnkgcGFja2FnZXMgaWYgYWxyZWFkeSBzZXRcbiAgICAgICAgaWYgKCEoRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMgaW4gZW52VmFyaWFibGVzKSAmJiBjb250cm9sbGVyQ29uZmlnLmVudHJ5UGFja2FnZXMpIHtcbiAgICAgICAgICAgIGVudlZhcmlhYmxlc1sgRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMgXSA9IChjb250cm9sbGVyQ29uZmlnLmVudHJ5UGFja2FnZXMgYXMgQXJyYXk8c3RyaW5nPikuam9pbignLCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGNvbnRyb2xsZXJOYW1lICsgXCItY29udHJvbGxlclwiLCB7XG4gICAgICAgICAgICBlbnRyeTogZmlsZVBhdGggKyBcIi9cIiArIGZpbGVOYW1lLFxuICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IGVudlZhcmlhYmxlcyxcbiAgICAgICAgICAgIHBvbGljaWVzOiBjb250cm9sbGVyQ29uZmlnPy5wb2xpY2llcyxcbiAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiBjb250cm9sbGVyQ29uZmlnPy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiBjb250cm9sbGVyQ29uZmlnPy5mdW5jdGlvblRpbWVvdXQgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmZ1bmN0aW9uVGltZW91dCxcbiAgICAgICAgICAgIHByb2Nlc3NvckFyY2hpdGVjdHVyZTogY29udHJvbGxlckNvbmZpZz8ucHJvY2Vzc29yQXJjaGl0ZWN0dXJlLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczogZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IGNvbnRyb2xsZXJDb25maWcubG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSxcbiAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBleHRyYWN0RGVmYXVsdEF1dGhvcml6ZXIgPSAoY29udHJvbGxlckNvbmZpZzogYW55KTogeyBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzOiBzdHJpbmdbXSwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc6IGJvb2xlYW4gfSA9PiB7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSB0aGlzLmZ3MjQuZ2V0RGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZSgpO1xuICAgICAgICBsZXQgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNvbnRyb2xsZXJDb25maWc/LmF1dGhvcml6ZXIpKSB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0QXV0aG9yaXplciA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplci5maW5kKChhdXRoOiBhbnkpID0+IGF1dGguZGVmYXVsdCkgfHwgY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyWyAwIF07XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSBkZWZhdWx0QXV0aG9yaXplci5uYW1lIHx8IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IGRlZmF1bHRBdXRob3JpemVyLnR5cGU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyLmdyb3VwcyB8fCBbXTtcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gZGVmYXVsdEF1dGhvcml6ZXIucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJOYW1lID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLm5hbWUgfHwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLnR5cGU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplci5ncm91cHMgfHwgW107XG4gICAgICAgICAgICBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGNvbnRyb2xsZXJDb25maWcucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplcjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZGVmYXVsdEF1dGhvcml6ZXJUeXBlICYmIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUpIHtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpIHtcblxuICAgICAgICAgICAgLy8gaWYgdGhlIHZhbHVlIGZvciB0aGUgZ3JvdXBzIGlzIGEgdGVtcGxhdGUgc3RyaW5nLCBcbiAgICAgICAgICAgIC8vIHJlc29sdmUgaXQgW3doZW4gdGhlIGFwcGxpY2F0aW9uIHdhbnQgdG8gYWxsb3cgbXVsdGlwbGUgdXNlciBncm91cHMgdG8gaGF2ZSBhY2Nlc3NdXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFwiZW52Onh4eDpncm91cDFcIiA9PT4gXCJncm91cDEtcmVzb2x2ZWRcIiB8fCBcImdyb3VwMSxncm91cDJcIiB8fCBcImVudjp4eHg6Z3JvdXAxLGVudjp4eHg6Z3JvdXAyXCJcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhkZWZhdWx0QXV0aG9yaXplckdyb3VwcykpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IHRoaXMuZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBub3cgaWYgdGhlIHJlc29sdmVkIHZhbHVlIGlzIGFnYWluIGEgc3RyaW5nLCBzcGxpdCBpdCBieSBjb21tYVxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgdmFsdWUgaXMgbGlrZSBcImdyb3VwMSxncm91cDJcIiA9PT4gW1wiZ3JvdXAxXCIsIFwiZ3JvdXAyXCJdXG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpKSB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplckdyb3Vwcy5zcGxpdCgnLCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWRlZmF1bHRBdXRob3JpemVyR3JvdXBzLmxlbmd0aCAmJiB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEFkbWluR3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEFkbWluR3JvdXBzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyByZXNvbHZlIHRoZSBncm91cCBuYW1lcyBmcm9tIGZ3MjQtc2NvcGUgaWYgaXQncyBhIHRlbXBsYXRlXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFtcImVudjp4eHg6Z3JvdXAxXCIsXCJlbnY6eHh4Omdyb3VwMlwiXSA9PT4gW1wiZ3JvdXAxLXJlc29sdmVkXCIsIFwiZ3JvdXAyLXJlc29sdmVkXCJdXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IChkZWZhdWx0QXV0aG9yaXplckdyb3VwcyBhcyBBcnJheTxzdHJpbmc+KS5tYXAodGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSk7XG5cbiAgICAgICAgICAgIC8vIGZsYXQtbWFwIHRoZSBncm91cHMgaWYgdGhleSByZXNvbHZlZCBncm91cCB2YWx1ZXMgYXJlIGFnYWluIGNvbW1hIHNlcGFyYXRlZFxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgcmVzb2x2ZWQgdmFsdWUgaXMgbGlrZSBbXCJhLGJcIiwgXCJjLGRcIl0gPT0+IFtcImFcIiwgXCJiXCIsIFwiY1wiLCBcImRcIl1cbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMuZmxhdE1hcChncm91cCA9PiBncm91cC5zcGxpdCgnLCcpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IGRlZmF1bHRBdXRob3JpemVyTmFtZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcywgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldE9yQ3JlYXRlUm91dGVSZXNvdXJjZSA9IChwYXJlbnRSZXNvdXJjZTogSVJlc291cmNlLCBwYXRoOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IElSZXNvdXJjZSA9PiB7XG4gICAgICAgIGxldCBjdXJyZW50UmVzb3VyY2U6IElSZXNvdXJjZSA9IHBhcmVudFJlc291cmNlO1xuICAgICAgICBjb25zdCByZXN0QVBJID0gdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBwYXRoUGFydCBvZiBwYXRoLnNwbGl0KFwiL1wiKSkge1xuICAgICAgICAgICAgaWYgKHBhdGhQYXJ0ID09PSBcIlwiKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBjaGlsZFJlc291cmNlID0gY3VycmVudFJlc291cmNlLmdldFJlc291cmNlKHBhdGhQYXJ0KTtcbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSkge1xuICAgICAgICAgICAgICAgIGNoaWxkUmVzb3VyY2UgPSBjdXJyZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UocGF0aFBhcnQpO1xuICAgICAgICAgICAgICAgIGlmIChyZXN0QVBJLmlzSW1wb3J0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29yc1ByZWZsaWdodE1ldGhvZCA9IGNoaWxkUmVzb3VyY2UuYWRkQ29yc1ByZWZsaWdodCh0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm1ldGhvZHMucHVzaChjb3JzUHJlZmxpZ2h0TWV0aG9kKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNvdXJjZXMucHVzaChjaGlsZFJlc291cmNlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjdXJyZW50UmVzb3VyY2UgPSBjaGlsZFJlc291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGN1cnJlbnRSZXNvdXJjZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGV4dHJhY3RSb3V0ZUF1dGhvcml6ZXIgPSAocm91dGU6IGFueSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIGRlZmF1bHRBdXRob3JpemVyTmFtZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBib29sZWFuKTogeyByb3V0ZUF1dGhvcml6ZXJOYW1lOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplclR5cGU6IHN0cmluZywgcm91dGVBdXRob3JpemVyR3JvdXBzOiBzdHJpbmdbXSwgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBib29sZWFuIH0gPT4ge1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyTmFtZSA9IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplclR5cGUgPSBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgbGV0IHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuXG4gICAgICAgIGlmIChyb3V0ZS5hdXRob3JpemVyICYmIHR5cGVvZiByb3V0ZS5hdXRob3JpemVyID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyVHlwZSA9IHJvdXRlLmF1dGhvcml6ZXIudHlwZSB8fCBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJOYW1lID0gcm91dGUuYXV0aG9yaXplci5uYW1lIHx8IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplckdyb3VwcyA9IHJvdXRlLmF1dGhvcml6ZXIuZ3JvdXBzIHx8IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzO1xuICAgICAgICAgICAgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gcm91dGUuYXV0aG9yaXplci5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiByb3V0ZS5hdXRob3JpemVyID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyVHlwZSA9IHJvdXRlLmF1dGhvcml6ZXI7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyByb3V0ZUF1dGhvcml6ZXJOYW1lLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlTWV0aG9kT3B0aW9ucyA9IChyb3V0ZTogYW55LCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplck5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCwgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcpOiBNZXRob2RPcHRpb25zID0+IHtcbiAgICAgICAgY29uc3QgcmVxdWVzdFBhcmFtZXRlcnM6IHsgWyBrZXk6IHN0cmluZyBdOiBib29sZWFuIH0gPSB7fTtcblxuICAgICAgICAvLyBBZGQgcGF0aCBwYXJhbWV0ZXJzXG4gICAgICAgIGZvciAoY29uc3QgcGFyYW0gb2Ygcm91dGUucGFyYW1ldGVycyB8fCBbXSkge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnNbIGBtZXRob2QucmVxdWVzdC5wYXRoLiR7cGFyYW19YCBdID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBBUEkga2V5IGhlYWRlciByZXF1aXJlbWVudCBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb25maWcucmVxdWlyZUFwaUtleSkge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnNbICdtZXRob2QucmVxdWVzdC5oZWFkZXIueC1hcGkta2V5JyBdID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHRoZSBhdXRob3JpemVyIGlzIEpXVCwgY29udmVydCBpdCB0byBDVVNUT01cbiAgICAgICAgY29uc3QgYXV0aG9yaXplciA9IHRoaXMuZncyNC5nZXRBdXRob3JpemVyKHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplck5hbWUpO1xuICAgICAgICBpZiAocm91dGVBdXRob3JpemVyVHlwZSA9PT0gJ0pXVCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSAnQ1VTVE9NJztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVycyxcbiAgICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiByb3V0ZUF1dGhvcml6ZXJUeXBlIGFzIEF1dGhvcml6YXRpb25UeXBlLFxuICAgICAgICAgICAgYXV0aG9yaXplcjogYXV0aG9yaXplcixcbiAgICAgICAgICAgIGFwaUtleVJlcXVpcmVkOiBjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkgfHwgZmFsc2VcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZVNRU0ludGVncmF0aW9uID0gKHF1ZXVlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBBd3NJbnRlZ3JhdGlvbiA9PiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBTUVMgaW50ZWdyYXRpb24gZm9yIHF1ZXVlICR7cXVldWVOYW1lfSBpbiBjb250cm9sbGVyICR7Y29udHJvbGxlck5hbWV9IGluIHN0YWNrICR7Y29udHJvbGxlclN0YWNrTmFtZX1gKTtcbiAgICAgICAgY29uc3QgaW50ZWdyYXRpb25Sb2xlID0gbmV3IFJvbGUodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHtxdWV1ZU5hbWV9LXNxcy1pbnRlZ3JhdGlvbi1yb2xlYCwge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlQXJuID0gdGhpcy5mdzI0LmdldEFybignc3FzJywgdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUocXVldWVOYW1lICsgJ19xdWV1ZU5hbWUnLCAncXVldWUnLCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpKTtcbiAgICAgICAgY29uc3QgcXVldWVJbnN0YW5jZSA9IFF1ZXVlLmZyb21RdWV1ZUFybih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3F1ZXVlTmFtZX0tcXVldWVgLCBxdWV1ZUFybik7XG4gICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRTZW5kTWVzc2FnZXMoaW50ZWdyYXRpb25Sb2xlKTtcbiAgICAgICAgcmV0dXJuIG5ldyBBd3NJbnRlZ3JhdGlvbih7XG4gICAgICAgICAgICBzZXJ2aWNlOiBcInNxc1wiLFxuICAgICAgICAgICAgcGF0aDogdGhpcy5mdzI0LmdldENvbmZpZygpLmFjY291bnQgKyBcIi9cIiArIHF1ZXVlSW5zdGFuY2UucXVldWVOYW1lLFxuICAgICAgICAgICAgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjcmVkZW50aWFsc1JvbGU6IGludGVncmF0aW9uUm9sZSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICAgICBcImludGVncmF0aW9uLnJlcXVlc3QuaGVhZGVyLkNvbnRlbnQtVHlwZVwiOiBcIidhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiYXBwbGljYXRpb24vanNvblwiOiBgQWN0aW9uPVNlbmRNZXNzYWdlJk1lc3NhZ2VCb2R5PSR1dGlsLnVybEVuY29kZSgkaW5wdXQuYm9keSlgLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVTTlNJbnRlZ3JhdGlvbiA9ICh0b3BpY05hbWU6IHN0cmluZywgY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogQXdzSW50ZWdyYXRpb24gPT4ge1xuICAgICAgICBjb25zdCBpbnRlZ3JhdGlvblJvbGUgPSBuZXcgUm9sZSh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3RvcGljTmFtZX0tc25zLWludGVncmF0aW9uLXJvbGVgLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwiYXBpZ2F0ZXdheS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSB0aGlzLmZ3MjQuZ2V0QXJuKCdzbnMnLCB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSh0b3BpY05hbWUgKyAnX3RvcGljTmFtZScsICd0b3BpYycsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSkpO1xuICAgICAgICBjb25zdCB0b3BpY0luc3RhbmNlID0gVG9waWMuZnJvbVRvcGljQXJuKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7dG9waWNOYW1lfS10b3BpY2AsIHRvcGljQXJuKTtcbiAgICAgICAgdG9waWNJbnN0YW5jZS5ncmFudFB1Ymxpc2goaW50ZWdyYXRpb25Sb2xlKTtcbiAgICAgICAgcmV0dXJuIG5ldyBBd3NJbnRlZ3JhdGlvbih7XG4gICAgICAgICAgICBzZXJ2aWNlOiBcInNuc1wiLFxuICAgICAgICAgICAgcGF0aDogJy8nLFxuICAgICAgICAgICAgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjcmVkZW50aWFsc1JvbGU6IGludGVncmF0aW9uUm9sZSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICAgICBcImludGVncmF0aW9uLnJlcXVlc3QuaGVhZGVyLkNvbnRlbnQtVHlwZVwiOiBcIidhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiYXBwbGljYXRpb24vanNvblwiOiBgQWN0aW9uPVB1Ymxpc2gmVG9waWNBcm49JHV0aWwudXJsRW5jb2RlKCcke3RvcGljSW5zdGFuY2UudG9waWNBcm59JykmTWVzc2FnZT0kdXRpbC51cmxFbmNvZGUoJGlucHV0LmJvZHkpYCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0QXBpRW5kcG9pbnQgPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclJlc291cmNlOiBJUmVzb3VyY2UsIHN0YWdlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpID0+IHtcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGBFbmRwb2ludCR7Y29udHJvbGxlck5hbWV9YCwge1xuICAgICAgICAgICAgdmFsdWU6ICdodHRwczovLycgKyB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGkucmVzdEFwaUlkICsgJy5leGVjdXRlLWFwaS4nICsgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLnJlZ2lvbiArICcuYW1hem9uYXdzLmNvbS8nICsgc3RhZ2VOYW1lICsgJy8nICsgY29udHJvbGxlclJlc291cmNlLnBhdGguc2xpY2UoMSksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBUEkgR2F0ZXdheSBFbmRwb2ludCBmb3IgXCIgKyBjb250cm9sbGVyTmFtZSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZXR1cFVzYWdlUGxhbihwbGFuQ29uZmlnPzogSVVzYWdlUGxhbkNvbmZpZywgY3JlYXRlS2V5OiBib29sZWFuID0gZmFsc2UpOiB7IHBsYW46IFVzYWdlUGxhbjsgbmFtZTogc3RyaW5nIH0ge1xuICAgICAgICAvLyBJZiBubyBwbGFuIGNvbmZpZyBpcyBwcm92aWRlZCBhbmQgd2UgbmVlZCBhIGtleSwgdXNlIHRoZSBmaXJzdCBjb25maWd1cmVkIHBsYW4gb3IgY3JlYXRlIGEgZGVmYXVsdCBvbmVcbiAgICAgICAgaWYgKCFwbGFuQ29uZmlnICYmIGNyZWF0ZUtleSkge1xuICAgICAgICAgICAgLy8gVHJ5IHRvIHVzZSB0aGUgZmlyc3QgY29uZmlndXJlZCBwbGFuIHRoYXQgaGFzIEFQSSBrZXlzXG4gICAgICAgICAgICBjb25zdCBjb25maWd1cmVkUGxhbiA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnM/LmZpbmQocGxhbiA9PiBwbGFuLmFwaUtleXMpO1xuICAgICAgICAgICAgaWYgKGNvbmZpZ3VyZWRQbGFuKSB7XG4gICAgICAgICAgICAgICAgcGxhbkNvbmZpZyA9IGNvbmZpZ3VyZWRQbGFuO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBJZiBubyBjb25maWd1cmVkIHBsYW4gd2l0aCBrZXlzIGV4aXN0cywgY3JlYXRlIGEgZGVmYXVsdCBwbGFuXG4gICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgYSBkZXRlcm1pbmlzdGljIGtleSBiYXNlZCBvbiBhcHAgbmFtZSBhbmQgYSBmaXhlZCBpZGVudGlmaWVyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdEtleSA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgICAgICAgICAgICAgICAgIC51cGRhdGUoYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLmFjY291bnR9LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLnJlZ2lvbn0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZW52aXJvbm1lbnR9LWRlZmF1bHQtYXBpLWtleWApXG4gICAgICAgICAgICAgICAgICAgIC5kaWdlc3QoJ2hleCcpXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCAzMik7IC8vIFVzZSBmaXJzdCAzMiBjaGFycyBmb3IgYSByZWFzb25hYmxlIGtleSBsZW5ndGhcblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIHVzYWdlIHBsYW4gd2l0aCBBUEkga2V5cyBmb3VuZCwgY3JlYXRpbmcgYSBkZWZhdWx0IG9uZS4gVGhpcyBpcyBub3QgcmVjb21tZW5kZWQgZm9yIHByb2R1Y3Rpb24gZW52aXJvbm1lbnRzLiBQbGVhc2UgY29uZmlndXJlIGEgdXNhZ2UgcGxhbiB3aXRoIEFQSSBrZXlzIGZvciB5b3VyIEFQSS5gKTtcblxuICAgICAgICAgICAgICAgIHBsYW5Db25maWcgPSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGAke3RoaXMuZncyNC5hcHBOYW1lfS1kZWZhdWx0LXVzYWdlLXBsYW5gLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYERlZmF1bHQgdXNhZ2UgcGxhbiBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgICAgICBhcGlLZXlzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXlzOiBbIGRlZmF1bHRLZXkgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBsYW5OYW1lID0gcGxhbkNvbmZpZz8ubmFtZSB8fCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tZGVmYXVsdC11c2FnZS1wbGFuYDtcblxuICAgICAgICBpZiAoIXRoaXMudXNhZ2VQbGFucy5oYXMocGxhbk5hbWUpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTZXR0aW5nIHVwIHVzYWdlIHBsYW46ICR7cGxhbk5hbWV9YCk7XG4gICAgICAgICAgICBjb25zdCB1c2FnZVBsYW4gPSBuZXcgVXNhZ2VQbGFuKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtwbGFuTmFtZX0tdXNhZ2UtcGxhbmAsIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBwbGFuTmFtZSxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogcGxhbkNvbmZpZz8uZGVzY3JpcHRpb24gfHwgYFVzYWdlIHBsYW4gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICBhcGlTdGFnZXM6IFsge1xuICAgICAgICAgICAgICAgICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgICAgICAgICAgICAgICBzdGFnZTogdGhpcy5hcGkuZGVwbG95bWVudFN0YWdlXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgICAgIHRocm90dGxlOiB7XG4gICAgICAgICAgICAgICAgICAgIHJhdGVMaW1pdDogcGxhbkNvbmZpZz8ucmF0ZUxpbWl0IHx8IDEwLFxuICAgICAgICAgICAgICAgICAgICBidXJzdExpbWl0OiBwbGFuQ29uZmlnPy5idXJzdExpbWl0IHx8IDIwXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBxdW90YToge1xuICAgICAgICAgICAgICAgICAgICBsaW1pdDogcGxhbkNvbmZpZz8ucXVvdGFMaW1pdCB8fCAxMDAwMCxcbiAgICAgICAgICAgICAgICAgICAgcGVyaW9kOiBwbGFuQ29uZmlnPy5xdW90YVBlcmlvZCB8fCBQZXJpb2QuTU9OVEhcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMudXNhZ2VQbGFucy5zZXQocGxhbk5hbWUsIHsgcGxhbjogdXNhZ2VQbGFuLCBuYW1lOiBwbGFuTmFtZSB9KTtcbiAgICAgICAgICAgIHRoaXMuYXBpS2V5cy5zZXQocGxhbk5hbWUsIFtdKTtcblxuICAgICAgICAgICAgLy8gQ3JlYXRlIEFQSSBrZXlzIGlmIGNvbmZpZ3VyZWQgZm9yIHRoaXMgdXNhZ2UgcGxhblxuICAgICAgICAgICAgaWYgKHBsYW5Db25maWc/LmFwaUtleXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDcmVhdGluZyBBUEkga2V5cyBmb3IgdXNhZ2UgcGxhbjogJHtwbGFuTmFtZX1gKTtcbiAgICAgICAgICAgICAgICBjb25zdCBrZXlzID0gcGxhbkNvbmZpZy5hcGlLZXlzLmtleXMgfHwgW107XG4gICAgICAgICAgICAgICAga2V5cy5mb3JFYWNoKChrZXksIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUga2V5IG5hbWUgZnJvbSBjb25maWcgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgdXNlIHRoZSBwcmVmaXggb3IgZ2VuZXJhdGUgYSBuYW1lXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleU5hbWUgPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlLZXlDb25maWc/LmtleU5hbWUgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgIChwbGFuQ29uZmlnLmFwaUtleXM/LmtleU5hbWVQcmVmaXhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGAke3BsYW5Db25maWcuYXBpS2V5cy5rZXlOYW1lUHJlZml4fS0ke2luZGV4fWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGAke3RoaXMuZncyNC5hcHBOYW1lfS1hcGkta2V5LSR7aW5kZXh9YCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYga2V5IGFscmVhZHkgZXhpc3RzXG4gICAgICAgICAgICAgICAgICAgIGxldCBleGlzdGluZ0tleSA9IHRoaXMua2V5VmFsdWVzLmdldChrZXkpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0aW5nS2V5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ0tleSA9IG5ldyBBcGlLZXkodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2tleU5hbWV9LWFwaS1rZXlgLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYEFQSSBrZXkgJHtpbmRleCArIDF9IGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGtleVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2tleU5hbWV9LWlkYCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiBleGlzdGluZ0tleS5rZXlJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYEFQSSBLZXkgJHtpbmRleCArIDF9IElEIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmtleVZhbHVlcy5zZXQoa2V5LCBleGlzdGluZ0tleSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB1c2FnZVBsYW4uYWRkQXBpS2V5KGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hcGlLZXlzLmdldChwbGFuTmFtZSkhLnB1c2goZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMudXNhZ2VQbGFucy5nZXQocGxhbk5hbWUpITtcbiAgICB9XG5cbn1cbiJdfQ==