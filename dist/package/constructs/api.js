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
        const { handlerClass, filePath, fileName, handlerHash } = controllerInfo;
        // Add the folder path from filename to the controller name
        const folderPath = fileName.split('/').slice(0, -1).join('/');
        const handlerInstance = new handlerClass();
        const controllerName = !fileName.includes('/') ? handlerInstance.controllerName : folderPath + '/' + handlerInstance.controllerName;
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
}
exports.APIConstruct = APIConstruct;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVNBLCtEQVVvQztBQUVwQyw2Q0FBcUY7QUFFckYsaURBQTZEO0FBRTdELGlEQUE0QztBQUM1QyxpREFBNEM7QUFNNUMsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx1REFBeUY7QUFDekYsd0NBQTBDO0FBRTFDLHVEQUFtRDtBQUNuRCw2REFBeUQ7QUFHekQsa0NBQW1DO0FBQ25DLG9DQUE2QztBQUM3QyxpQ0FBdUM7QUFDdkMsK0NBQXFEO0FBQ3JELHlDQUErQztBQUMvQyxtQ0FBeUM7QUFDekMscUNBQTJDO0FBQzNDLG1DQUF5QztBQUN6QyxtQ0FBeUM7QUFFekMsbUNBQWdEO0FBQ2hELCtCQUFxQztBQUNyQywrREFBdUU7QUFDdkUsZ0RBQXdCO0FBQ3hCLDJCQUF5RDtBQXdJekQsTUFBYSxZQUFZO0lBbUJEO0lBbEJYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLFlBQVksQ0FBQyxJQUFJLENBQUM7SUFDakMsWUFBWSxHQUFhLENBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsd0JBQWUsQ0FBQyxJQUFJLEVBQUUsNEJBQWlCLENBQUMsSUFBSSxFQUFFLG9CQUFhLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxDQUFFLENBQUM7SUFDaEwsTUFBTSxDQUF1QjtJQUU3QixHQUFHLENBQVc7SUFDZCxTQUFTLENBQVM7SUFDbEIsVUFBVSxHQUFtRCxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3ZFLE9BQU8sR0FBMEIsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUMz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QUcsQ0FBQyxDQUFDO29CQUMxQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7d0JBQ2YsV0FBVyxHQUFHLElBQUksdUJBQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksT0FBTyxVQUFVLEVBQUU7NEJBQ2hGLE9BQU8sRUFBRSxJQUFJOzRCQUNiLFdBQVcsRUFBRSxXQUFXLEtBQUssR0FBRyxDQUFDLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7NEJBQzVELEtBQUssRUFBRSxHQUFHO3lCQUNiLENBQUMsQ0FBQzt3QkFFSCxJQUFJLHVCQUFTLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sS0FBSyxFQUFFOzRCQUNoRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUs7NEJBQ3hCLFdBQVcsRUFBRSxXQUFXLEtBQUssR0FBRyxDQUFDLFdBQVcsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7eUJBQ2xFLENBQUMsQ0FBQzt3QkFFSCxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsV0FBVyxDQUFDLENBQUM7b0JBQ3pDLENBQUM7b0JBRUQsU0FBUyxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQztvQkFDakMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO2dCQUNsRCxDQUFDLENBQUMsQ0FBQztZQUNQLENBQUM7UUFDTCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUUsQ0FBQztJQUMxQyxDQUFDO0NBRUo7QUF0eUJELG9DQXN5QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7XG4gICAgQXV0aG9yaXphdGlvblR5cGUsXG4gICAgQ29yc09wdGlvbnMsXG4gICAgSVJlc291cmNlLFxuICAgIE1ldGhvZCxcbiAgICBNZXRob2RPcHRpb25zLFxuICAgIFJlc3RBcGlQcm9wc1xufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcblxuaW1wb3J0IHtcbiAgICBBd3NJbnRlZ3JhdGlvbixcbiAgICBDb3JzLFxuICAgIERlcGxveW1lbnQsXG4gICAgUmVzdEFwaSxcbiAgICBJUmVzdEFwaSxcbiAgICBSZXNvdXJjZSxcbiAgICBNZXRob2RMb2dnaW5nTGV2ZWwsXG4gICAgU3RhZ2UsXG4gICAgUmVzcG9uc2VUeXBlXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuXG5pbXBvcnQgeyBDZm5PdXRwdXQsIER1cmF0aW9uLCBOZXN0ZWRTdGFjaywgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5cbmltcG9ydCB0eXBlIHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi4vY29yZS9cIjtcbmltcG9ydCB0eXBlIEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuXG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCBNdXRhYmxlIGZyb20gXCIuLi90eXBlcy9tdXRhYmxlXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgTGFtYmRhSW50ZWdyYXRpb24gfSBmcm9tIFwiLi9sYW1iZGEtaW50ZWdyYXRpb25cIjtcblxuaW1wb3J0IHsgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vZGVjb3JhdG9ycy9jb250cm9sbGVyXCI7XG5pbXBvcnQgeyBFTlZfS0VZUyB9IGZyb20gXCIuLi9mdzI0XCI7XG5pbXBvcnQgeyBpc0FycmF5LCBpc1N0cmluZyB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgQXV0aENvbnN0cnVjdCB9IGZyb20gXCIuL2F1dGhcIjtcbmltcG9ydCB7IENlcnRpZmljYXRlQ29uc3RydWN0IH0gZnJvbSBcIi4vY2VydGlmaWNhdGVcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0IH0gZnJvbSBcIi4vZHluYW1vZGJcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcbmltcG9ydCB7IE1haWxlckNvbnN0cnVjdCB9IGZyb20gXCIuL21haWxlclwiO1xuaW1wb3J0IHsgUXVldWVDb25zdHJ1Y3QgfSBmcm9tIFwiLi9xdWV1ZVwiO1xuaW1wb3J0IHsgVG9waWNDb25zdHJ1Y3QgfSBmcm9tIFwiLi90b3BpY1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2gsIHJhbmRvbVVVSUQgfSBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcbmltcG9ydCB7IEFwaUtleSwgVXNhZ2VQbGFuLCBQZXJpb2QgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgbWtkaXJTeW5jLCBleGlzdHNTeW5jLCBjb3B5RmlsZVN5bmMgfSBmcm9tICdmcyc7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBvcHRpb25zIGZvciBhbiBBUEkgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElBUElDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIENPUlMgY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSS5cbiAgICAgKiBJdCBjYW4gYmUgYSBib29sZWFuIHZhbHVlLCBhIHNpbmdsZSBzdHJpbmcsIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MuXG4gICAgICovXG4gICAgY29ycz86IGJvb2xlYW4gfCBzdHJpbmcgfCBzdHJpbmdbXTtcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyBhZGRpdGlvbmFsIG9wdGlvbnMgZm9yIHRoZSBBUEkuXG4gICAgICovXG4gICAgYXBpT3B0aW9ucz86IFJlc3RBcGlQcm9wcztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgZGlyZWN0b3J5IHdoZXJlIHRoZSBjb250cm9sbGVycyBhcmUgbG9jYXRlZC5cbiAgICAgKi9cbiAgICBjb250cm9sbGVyc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgZnVuY3Rpb24uXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIG51bWJlciBvZiBkYXlzIHRvIHJldGFpbiB0aGUgQVBJIGxvZ3MuXG4gICAgICovXG4gICAgbG9nUmV0ZW50aW9uRGF5cz86IFJldGVudGlvbkRheXM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIHJlbW92YWwgcG9saWN5IGZvciB0aGUgQVBJIGxvZ3MuXG4gICAgICovXG4gICAgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY3VzdG9tIGRvbWFpbiBuYW1lIGZvciB0aGUgQVBJLlxuICAgICAqL1xuICAgIGRvbWFpbk5hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY2VydGlmaWNhdGUgQVJOIGZvciB0aGUgY3VzdG9tIGRvbWFpbiBuYW1lLlxuICAgICAqL1xuICAgIGNlcnRpZmljYXRlQXJuPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogQVBJIEdhdGV3YXkgTGFtYmRhIGludGVncmF0aW9uIHRpbWVvdXQgaW4gc2Vjb25kcy5cbiAgICAgKi9cbiAgICBpbnRlZ3JhdGlvblRpbWVvdXQ/OiBudW1iZXI7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcGFyZW50IHN0YWNrIG5hbWUgZm9yIHRoZSBDb250cm9sbGVycy5cbiAgICAgKi9cbiAgICBjb250cm9sbGVyUGFyZW50U3RhY2tOYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogU2V0IHRvIGZhbHNlIGlmIHlvdSB3YW50IHRvIHNraXAgY3JlYXRpb24gb2YgY29udHJvbGxlcnMgcmVzb3VyY2VzIGFuZCBtZXRob2RzXG4gICAgICogVGhpcyB3aWxsIGRlbGV0ZSBhbGwgdGhlIGNvbnRyb2xsZXJzIHJlc291cmNlcyBhbmQgbWV0aG9kcyBmcm9tIHRoZSBBUElcbiAgICAgKi9cbiAgICBza2lwQ29udHJvbGxlcnM/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogRm9yY2UgYSBkZXBsb3ltZW50IG9mIHRoZSBBUEkgd2hlbiB1c2luZyBpbXBvcnRlZCBBUElzXG4gICAgICovXG4gICAgZm9yY2VEZXBsb3ltZW50PzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIEFQSSBrZXkgY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSVxuICAgICAqL1xuICAgIGFwaUtleUNvbmZpZz86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIExpc3Qgb2YgdmFsaWQgQVBJIGtleXMuIElmIGVtcHR5LCBrZXlzIHdpbGwgYmUgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICovXG4gICAgICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIE5hbWUgb2YgdGhlIEFQSSBrZXkgKHVzZWQgd2hlbiBhdXRvLWdlbmVyYXRpbmcpXG4gICAgICAgICAqL1xuICAgICAgICBrZXlOYW1lPzogc3RyaW5nO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBVc2FnZSBwbGFuIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBUElcbiAgICAgKi9cbiAgICB1c2FnZVBsYW5zPzogSVVzYWdlUGxhbkNvbmZpZ1tdO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIEFQSSBrZXkgd2l0aGluIGEgdXNhZ2UgcGxhblxuICovXG5pbnRlcmZhY2UgSVVzYWdlUGxhbkFwaUtleUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogTGlzdCBvZiB2YWxpZCBBUEkga2V5cy4gSWYgZW1wdHksIGtleXMgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZFxuICAgICAqL1xuICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBOYW1lIHByZWZpeCBmb3IgdGhlIEFQSSBrZXlzICh1c2VkIHdoZW4gYXV0by1nZW5lcmF0aW5nKVxuICAgICAqL1xuICAgIGtleU5hbWVQcmVmaXg/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgYSB1c2FnZSBwbGFuXG4gKi9cbmludGVyZmFjZSBJVXNhZ2VQbGFuQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgbmFtZTogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIERlc2NyaXB0aW9uIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogUmF0ZSBsaW1pdCBwZXIgc2Vjb25kXG4gICAgICovXG4gICAgcmF0ZUxpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIEJ1cnN0IGxpbWl0XG4gICAgICovXG4gICAgYnVyc3RMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBsaW1pdCBwZXIgcGVyaW9kXG4gICAgICovXG4gICAgcXVvdGFMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBwZXJpb2RcbiAgICAgKi9cbiAgICBxdW90YVBlcmlvZD86IFBlcmlvZDtcbiAgICAvKipcbiAgICAgKiBBUEkga2V5IGNvbmZpZ3VyYXRpb24gZm9yIHRoaXMgdXNhZ2UgcGxhblxuICAgICAqL1xuICAgIGFwaUtleXM/OiBJVXNhZ2VQbGFuQXBpS2V5Q29uZmlnO1xufVxuXG5leHBvcnQgY2xhc3MgQVBJQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEFQSUNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gQVBJQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIE1haWxlckNvbnN0cnVjdC5uYW1lLCBEeW5hbW9EQkNvbnN0cnVjdC5uYW1lLCBBdXRoQ29uc3RydWN0Lm5hbWUsIFF1ZXVlQ29uc3RydWN0Lm5hbWUsIFRvcGljQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWUgXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgYXBpITogUmVzdEFwaTtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICB1c2FnZVBsYW5zOiBNYXA8c3RyaW5nLCB7IHBsYW46IFVzYWdlUGxhbjsgbmFtZTogc3RyaW5nIH0+ID0gbmV3IE1hcCgpO1xuICAgIGFwaUtleXM6IE1hcDxzdHJpbmcsIEFwaUtleVtdPiA9IG5ldyBNYXAoKTtcbiAgICBrZXlWYWx1ZXM6IE1hcDxzdHJpbmcsIEFwaUtleT4gPSBuZXcgTWFwKCk7XG5cbiAgICBwcml2YXRlIHJlc291cmNlczogSVJlc291cmNlW10gPSBbXTtcbiAgICBwcml2YXRlIG1ldGhvZHM6IE1ldGhvZFtdID0gW107XG4gICAgcHJpdmF0ZSBjb250cm9sbGVyU3RhY2tzID0gbmV3IE1hcDxzdHJpbmcsIHsgbWV0aG9kczogTWV0aG9kW10sIHJlc291cmNlczogSVJlc291cmNlW10sIGNvbnRyb2xsZXJzSGFzaDogc3RyaW5nW10gfT4oKTtcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgYXBpQ29uc3RydWN0Q29uZmlnOiBJQVBJQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIC8vIGh5ZHJhdGUgdGhlIGNvbmZpZyBvYmplY3Qgd2l0aCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZXg6IEFQSUdBVEVXQVlfQ09OVFJPTExFUlNcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoYXBpQ29uc3RydWN0Q29uZmlnLCAnQVBJR0FURVdBWScpO1xuICAgIH1cblxuICAgIC8vIGNvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFja1xuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIHNldCB0aGUgZGVmYXVsdCBhcGkgb3B0aW9uc1xuICAgICAgICBjb25zdCBwYXJhbXNBcGk6IE11dGFibGU8UmVzdEFwaVByb3BzPiA9IHsgLi4udGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpT3B0aW9ucyB8fCB7fSB9O1xuICAgICAgICAvLyBFbmFibGUgQ09SUyBpZiBkZWZpbmVkXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkVuYWJsaW5nIENPUlMuLi4gdGhpcy5jb25maWcuY29yczogXCIsIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpO1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9ucyA9IHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSAmJiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlQ29uc3RydWN0ID0gbmV3IENlcnRpZmljYXRlQ29uc3RydWN0KHtcbiAgICAgICAgICAgICAgICBkb21haW5OYW1lOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLFxuICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlQXJuOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jZXJ0aWZpY2F0ZUFyblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlID0gY2VydGlmaWNhdGVDb25zdHJ1Y3Qub3V0cHV0WyBPdXRwdXRUeXBlLkNFUlRJRklDQVRFIF1bIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUgXTtcbiAgICAgICAgICAgIHBhcmFtc0FwaS5kb21haW5OYW1lID0ge1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgY2VydGlmaWNhdGU6IGNlcnRpZmljYXRlLFxuICAgICAgICAgICAgICAgIGJhc2VQYXRoOiBwYXJhbXNBcGkuZGVwbG95T3B0aW9ucz8uc3RhZ2VOYW1lIHx8ICcvJyxcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gZm9yIG11bHRpc3RhY2sgYXBwbGljYXRpb24sIHNldCBkZXBsb3kgdG8gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlcGxveSA9IGZhbHNlO1xuICAgICAgICAgICAgZGVsZXRlIHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgQVBJIEdhdGV3YXkuLi4gXCIpO1xuICAgICAgICAvLyBnZXQgdGhlIG1haW4gc3RhY2sgZnJvbSB0aGUgZnJhbWV3b3JrXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnN0YWNrTmFtZSwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgZ2F0ZXdheVxuICAgICAgICB0aGlzLmFwaSA9IG5ldyBSZXN0QXBpKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgLi4ucGFyYW1zQXBpLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycykge1xuICAgICAgICAgICAgY29uc3QgY29yc09yaWdpbnMgPSB0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkuYWxsb3dPcmlnaW5zPy5qb2luKCcsJykhO1xuICAgICAgICAgICAgdGhpcy5hcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdkZWZhdWx0NHh4Jywge1xuICAgICAgICAgICAgICAgIHR5cGU6IFJlc3BvbnNlVHlwZS5ERUZBVUxUXzRYWCxcbiAgICAgICAgICAgICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGAnJHtjb3JzT3JpZ2luc30nYCxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuYXBpLmFkZEdhdGV3YXlSZXNwb25zZSgnZGVmYXVsdDV4eCcsIHtcbiAgICAgICAgICAgICAgICB0eXBlOiBSZXNwb25zZVR5cGUuREVGQVVMVF81WFgsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VIZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBgJyR7Y29yc09yaWdpbnN9J2AsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXQgdXAgdXNhZ2UgcGxhbnMgaWYgY29uZmlndXJlZFxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucz8ubGVuZ3RoKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBsYW5Db25maWcgb2YgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucykge1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0dXBVc2FnZVBsYW4ocGxhbkNvbmZpZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmZ3MjQuYWRkQVBJKHRoaXMubmFtZSwgJ3Jvb3QnLCB0aGlzLmFwaSwgZmFsc2UpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsICdyZXN0QVBJJywgdGhpcy5hcGksIE91dHB1dFR5cGUuQVBJLCAncmVzdEFwaUlkJyk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ3Jlc3RBUEknLCB0aGlzLmFwaSwgT3V0cHV0VHlwZS5BUEksICdyZXN0QXBpUm9vdFJlc291cmNlSWQnKTtcblxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuc2tpcENvbnRyb2xsZXJzKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcnMoKTtcblxuICAgICAgICAvLyBpZiBtdWx0aS9uZXN0ZWQtc3RhY2sgc2V0dXAsIHRoZW4gY3JlYXRlIG9uZSBkZXBsb3ltZW50IHBlciBjb250cm9sbGVyIHN0YWNrXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEFQSS1nYXRld2F5IGNvbnN0cnVjdDogJHt0aGlzLm5hbWV9IGhhcyBpbXBvcnRlZCBBUElzOiAke3RoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpfWApO1xuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSkgJiYgdGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZURlcGxveW1lbnRzKCk7XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSkpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU2luZ2xlRGVwbG95bWVudCgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRBUEkgPSAoc3RhY2tOYW1lOiBzdHJpbmcpOiBhbnkgPT4ge1xuICAgICAgICBsZXQgY3VycmVudEFQSTogYW55ID0gdGhpcy5mdzI0LmdldEFQSSh0aGlzLm5hbWUsICdyb290Jyk7XG5cbiAgICAgICAgLy8gaWYgdGhlIHN0YWNrIGlzIG5vdCB0aGUgbWFpbiBzdGFjayBhbmQgaXRzIGEgbXVsdGktc3RhY2sgYXBwbGljYXRpb24gb3IgYSBuZXN0ZWQgc3RhY2ssIHRoZW4gaW1wb3J0IHRoZSBBUElcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHN0YWNrTmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXJyZW50IFN0YWNrOiAke2N1cnJlbnRTdGFjay5zdGFja05hbWV9IGlzIG5lc3RlZCBzdGFjazogJHtjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFja31gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCB0aGlzLm1haW5TdGFjaykgfHwgY3VycmVudFN0YWNrIGluc3RhbmNlb2YgTmVzdGVkU3RhY2spIHtcbiAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKTtcbiAgICAgICAgICAgIGlmICghY3VycmVudEFQSSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGltcG9ydGVkQVBJID0gUmVzdEFwaS5mcm9tUmVzdEFwaUF0dHJpYnV0ZXMoY3VycmVudFN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtzdGFja05hbWV9LWFwaWAsIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdEFwaUlkOiB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgncmVzdEFQSV9yZXN0QXBpSWQnLCAnYXBpJywgY3VycmVudFN0YWNrKSxcbiAgICAgICAgICAgICAgICAgICAgcm9vdFJlc291cmNlSWQ6IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdyZXN0QVBJX3Jlc3RBcGlSb290UmVzb3VyY2VJZCcsICdhcGknLCBjdXJyZW50U3RhY2spLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5hZGRBUEkodGhpcy5uYW1lLCBzdGFja05hbWUsIGltcG9ydGVkQVBJLCB0cnVlKTtcbiAgICAgICAgICAgICAgICBjdXJyZW50QVBJID0gdGhpcy5mdzI0LmdldEFQSSh0aGlzLm5hbWUsIHN0YWNrTmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3VycmVudEFQSTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHJlZ2lzdGVyQ29udHJvbGxlcnMoKSB7XG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgY29udHJvbGxlcnMgZGlyZWN0b3J5IGlmIG5vdCBkZWZpbmVkXG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJzRGlyZWN0b3J5ID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29udHJvbGxlcnNEaXJlY3RvcnkgfHwgXCIuL3NyYy9jb250cm9sbGVyc1wiO1xuXG4gICAgICAgIC8vIHJlZ2lzdGVyIHRoZSBjb250cm9sbGVyc1xuICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyhjb250cm9sbGVyc0RpcmVjdG9yeSwgdGhpcy5yZWdpc3RlckNvbnRyb2xsZXIpO1xuXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVzID0gdGhpcy5mdzI0LmdldE1vZHVsZXMoKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBtb2R1bGVzIFwiLCBBcnJheS5mcm9tKG1vZHVsZXMua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBtb2R1bGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiTG9hZCBjb250cm9sbGVycyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG5cbiAgICAgICAgICAgICAgICBIZWxwZXIucmVnaXN0ZXJDb250cm9sbGVyc0Zyb21Nb2R1bGUoXG4gICAgICAgICAgICAgICAgICAgIG1vZHVsZSxcbiAgICAgICAgICAgICAgICAgICAgKGRlc2M6IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcihkZXNjLCBtb2R1bGUpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBOTyBtb2R1bGVzIFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlZ2lzdGVyIHN5c3RlbSBjb250cm9sbGVycyBmcm9tIGZ3MjQgc2luZ2xldG9uXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzU3lzdGVtQ29udHJvbGxlcnMoKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiByZWdpc3RlcmluZyBzeXN0ZW0gY29udHJvbGxlcnNcIik7XG5cbiAgICAgICAgICAgIC8vIENvcHkgc3lzdGVtIGNvbnRyb2xsZXJzIHRvIGFwcCBkaXN0IGFuZCByZWdpc3RlciBmcm9tIHRoZXJlXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvcHlBbmRSZWdpc3RlclN5c3RlbUNvbnRyb2xsZXJzKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgTk8gc3lzdGVtIGNvbnRyb2xsZXJzXCIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBjb3B5QW5kUmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVycygpIHtcbiAgICAgICAgY29uc3Qgc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIgPSBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgJ2Rpc3QnLCAnc3lzdGVtLWNvbnRyb2xsZXJzJyk7XG5cbiAgICAgICAgLy8gRW5zdXJlIHRhcmdldCBkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgIGlmICghZXhpc3RzU3luYyhzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpcikpIHtcbiAgICAgICAgICAgIG1rZGlyU3luYyhzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHN5c3RlbUNvbnRyb2xsZXIgb2YgdGhpcy5mdzI0LmdldFN5c3RlbUNvbnRyb2xsZXJzKCkpIHtcbiAgICAgICAgICAgIGxldCByZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrID0gJyc7XG4gICAgICAgICAgICAvLyBGYWxsYmFjazogdXNlIHRoZSBsYXN0IGZldyBkaXJlY3RvcmllcyB0byBwcmVzZXJ2ZSBzdHJ1Y3R1cmVcbiAgICAgICAgICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHN5c3RlbUNvbnRyb2xsZXIuZmlsZVBhdGguc3BsaXQoJy8nKTtcbiAgICAgICAgICAgIGNvbnN0IHJlbGV2YW50UGFydHMgPSBwYXRoUGFydHMuc2xpY2UoLTMpOyAvLyBlLmcuLCBbJ3NlYXJjaCcsICdzeXN0ZW0nLCAnc2VhcmNoLWNvbnRyb2xsZXIuanMnXVxuICAgICAgICAgICAgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayA9IHJlbGV2YW50UGFydHMuam9pbignLycpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBTeXN0ZW0gY29udHJvbGxlciByZWxhdGl2ZSBwYXRoOiAke3JlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmt9YCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHRhcmdldEZpbGVQYXRoID0gcGF0aC5qb2luKHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyLCByZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrKTtcbiAgICAgICAgICAgIGNvbnN0IHRhcmdldERpcmVjdG9yeSA9IHBhdGguZGlybmFtZSh0YXJnZXRGaWxlUGF0aCk7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFN5c3RlbSBjb250cm9sbGVyIHRhcmdldC1kaXJlY3Rvcnk6ICR7dGFyZ2V0RGlyZWN0b3J5fSwgdGFyZ2V0RmlsZVBhdGg6ICR7dGFyZ2V0RmlsZVBhdGh9YCk7XG5cbiAgICAgICAgICAgIC8vIEVuc3VyZSB0YXJnZXQgc3ViZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKHRhcmdldERpcmVjdG9yeSkpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmModGFyZ2V0RGlyZWN0b3J5LCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ29weSB0aGUgc3lzdGVtIGNvbnRyb2xsZXIgZmlsZVxuICAgICAgICAgICAgY29weUZpbGVTeW5jKHN5c3RlbUNvbnRyb2xsZXIuZmlsZVBhdGgsIHRhcmdldEZpbGVQYXRoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ29waWVkIHN5c3RlbSBjb250cm9sbGVyIGZyb20gJHtzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRofSB0byAke3RhcmdldEZpbGVQYXRofWApO1xuXG4gICAgICAgICAgICAvLyBSZWdpc3RlciBmcm9tIHRoZSBjb3BpZWQgbG9jYXRpb25cbiAgICAgICAgICAgIGNvbnN0IGRpcmVjdG9yeSA9IHBhdGguZGlybmFtZSh0YXJnZXRGaWxlUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWdpc3RlcmluZyBzeXN0ZW0gY29udHJvbGxlciBmcm9tICR7ZGlyZWN0b3J5fS0tPiR7ZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKFxuICAgICAgICAgICAgICAgIGRpcmVjdG9yeSxcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcixcbiAgICAgICAgICAgICAgICBbIGZpbGVOYW1lIF1cbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKTogc3RyaW5nW10ge1xuICAgICAgICBsZXQgZW50cnlQYWNrYWdlcyA9IGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyB8fCBbXTtcblxuICAgICAgICBpZiAoaXNBcnJheShlbnRyeVBhY2thZ2VzKSkge1xuICAgICAgICAgICAgZW50cnlQYWNrYWdlcyA9IHtcbiAgICAgICAgICAgICAgICBvdmVycmlkZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgcGFja2FnZU5hbWVzOiBlbnRyeVBhY2thZ2VzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiB0aGUgY29udHJvbGxlciBkb2VzIG5vdCB3YW50IHRvIG92ZXJyaWRlIHRoZSBhcHBsaWNhdGlvbi9tb2R1bGUgZW50cnkgcGFja2FnZXMgYW5kIGluY2x1ZGUgdGhlbSBhcyB3ZWxsXG4gICAgICAgIGlmICghZW50cnlQYWNrYWdlcy5vdmVycmlkZSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlRW50cnlQYWNrYWdlcyA9IG93bmVyTW9kdWxlPy5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCkgfHwgW107XG4gICAgICAgICAgICBjb25zdCBhcHBFbnRyeVBhY2thZ2VzID0gdGhpcy5mdzI0LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKTtcbiAgICAgICAgICAgIGVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzID0gW1xuICAgICAgICAgICAgICAgIC4uLmVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzLFxuICAgICAgICAgICAgICAgIC4uLm1vZHVsZUVudHJ5UGFja2FnZXMsXG4gICAgICAgICAgICAgICAgLi4uYXBwRW50cnlQYWNrYWdlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRyeVBhY2thZ2VzLnBhY2thZ2VOYW1lcy5tYXAodGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSk7XG4gICAgfVxuXG5cbiAgICAvLyByZWdpc3RlciBhIHNpbmdsZSBjb250cm9sbGVyXG4gICAgcHJpdmF0ZSByZWdpc3RlckNvbnRyb2xsZXIgPSBhc3luYyAoY29udHJvbGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKSA9PiB7XG4gICAgICAgIGNvbnN0IHsgaGFuZGxlckNsYXNzLCBmaWxlUGF0aCwgZmlsZU5hbWUsIGhhbmRsZXJIYXNoIH0gPSBjb250cm9sbGVySW5mbztcbiAgICAgICAgLy8gQWRkIHRoZSBmb2xkZXIgcGF0aCBmcm9tIGZpbGVuYW1lIHRvIHRoZSBjb250cm9sbGVyIG5hbWVcbiAgICAgICAgY29uc3QgZm9sZGVyUGF0aCA9IGZpbGVOYW1lLnNwbGl0KCcvJykuc2xpY2UoMCwgLTEpLmpvaW4oJy8nKTtcbiAgICAgICAgY29uc3QgaGFuZGxlckluc3RhbmNlID0gbmV3IGhhbmRsZXJDbGFzcygpO1xuICAgICAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9ICFmaWxlTmFtZS5pbmNsdWRlcygnLycpID8gaGFuZGxlckluc3RhbmNlLmNvbnRyb2xsZXJOYW1lIDogZm9sZGVyUGF0aCArICcvJyArIGhhbmRsZXJJbnN0YW5jZS5jb250cm9sbGVyTmFtZTtcbiAgICAgICAgY29uc3QgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcgPSBoYW5kbGVySW5zdGFuY2U/LmNvbnRyb2xsZXJDb25maWcgfHwge307XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJTdGFja05hbWUgPSBjb250cm9sbGVyQ29uZmlnLnN0YWNrTmFtZSB8fCBjb250cm9sbGVyTmFtZTtcbiAgICAgICAgY29uc3QgcGFyZW50U3RhY2tOYW1lID0gY29udHJvbGxlckNvbmZpZy5wYXJlbnRTdGFja05hbWUgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29udHJvbGxlclBhcmVudFN0YWNrTmFtZTtcblxuICAgICAgICAvLyBJbml0aWFsaXplIGNvbnRyb2xsZXIgc3RhY2sgaW5mbyBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5jb250cm9sbGVyU3RhY2tzLmhhcyhjb250cm9sbGVyU3RhY2tOYW1lKSkge1xuICAgICAgICAgICAgdGhpcy5jb250cm9sbGVyU3RhY2tzLnNldChjb250cm9sbGVyU3RhY2tOYW1lLCB7XG4gICAgICAgICAgICAgICAgbWV0aG9kczogW10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXSxcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyc0hhc2g6IFtdXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG1ha2Ugc3VyZSB0aGUgY29udHJvbGxlciBzdGFjayBleGlzdHNcbiAgICAgICAgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUsIHBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgIGNvbnRyb2xsZXJJbmZvLnJvdXRlcyA9IGhhbmRsZXJJbnN0YW5jZS5yb3V0ZXM7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUmVnaXN0ZXJpbmcgY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfSBmcm9tICR7ZmlsZVBhdGh9LyR7ZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgLy8gcHJlcGFyZSB0aGUgZW50cnkgcGFja2FnZXMgZm9yIHRoZSBjb250cm9sbGVyJ3MgbGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXMgPSB0aGlzLnByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlKTtcbiAgICAgICAgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzID0gZW50cnlQYWNrYWdlcztcblxuICAgICAgICB0aGlzLnJlc291cmNlcyA9IFtdO1xuICAgICAgICB0aGlzLm1ldGhvZHMgPSBbXTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgcmVzb3VyY2UgZm9yIHRoZSBjb250cm9sbGVyIGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZUNvbnRyb2xsZXJSZXNvdXJjZShjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgdmFyIGNvbnRyb2xsZXJUYXJnZXQgPSBjb250cm9sbGVyQ29uZmlnLnRhcmdldDtcbiAgICAgICAgdmFyIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbjogYW55O1xuICAgICAgICAvLyBjcmVhdGUgbGFtYmRhIGZ1bmN0aW9uIGZvciB0aGUgY29udHJvbGxlclxuICAgICAgICBpZiAoY29udHJvbGxlclRhcmdldCA9PT0gJ2Z1bmN0aW9uJyB8fCBjb250cm9sbGVyVGFyZ2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcubG9nUmV0ZW50aW9uRGF5cyA9IGNvbnRyb2xsZXJDb25maWcubG9nUmV0ZW50aW9uRGF5cyB8fCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5sb2dSZXRlbnRpb25EYXlzO1xuICAgICAgICAgICAgY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5ID0gY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5IHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmxvZ1JlbW92YWxQb2xpY3k7XG4gICAgICAgICAgICBjb25zdCBjb250cm9sbGVyTGFtYmRhID0gdGhpcy5jcmVhdGVMYW1iZGFGdW5jdGlvbihjb250cm9sbGVyTmFtZSwgZmlsZVBhdGgsIGZpbGVOYW1lLCBjb250cm9sbGVyQ29uZmlnLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJMYW1iZGEsIE91dHB1dFR5cGUuRlVOQ1RJT04pO1xuXG4gICAgICAgICAgICBjb250cm9sbGVySW50ZWdyYXRpb24gPSBuZXcgTGFtYmRhSW50ZWdyYXRpb24oY29udHJvbGxlckxhbWJkYSwge1xuICAgICAgICAgICAgICAgIHJlc3RBcGk6IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaSxcbiAgICAgICAgICAgICAgICBwYXRoOiBjb250cm9sbGVyTmFtZSxcbiAgICAgICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmludGVncmF0aW9uVGltZW91dCB8fCAyOSksXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgZGVmYXVsdEF1dGhvcml6ZXJOYW1lLCBkZWZhdWx0QXV0aG9yaXplclR5cGUsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9ID0gdGhpcy5leHRyYWN0RGVmYXVsdEF1dGhvcml6ZXIoY29udHJvbGxlckNvbmZpZyk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyIENvbnRyb2xsZXIgfiBEZWZhdWx0IEF1dGhvcml6ZXI6IG5hbWU6ICR7ZGVmYXVsdEF1dGhvcml6ZXJOYW1lfSAtIHR5cGU6ICR7ZGVmYXVsdEF1dGhvcml6ZXJUeXBlfSAtIGdyb3VwczogJHtkZWZhdWx0QXV0aG9yaXplckdyb3Vwc31gKTtcblxuICAgICAgICAvLyBTZXQgdXAgQVBJIGtleSBpZiByZXF1aXJlZFxuICAgICAgICBpZiAoY29udHJvbGxlckNvbmZpZy5yZXF1aXJlQXBpS2V5KSB7XG4gICAgICAgICAgICB0aGlzLnNldHVwVXNhZ2VQbGFuKHVuZGVmaW5lZCwgdHJ1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXQgdXAgcm91dGVzIGZvciB0aGUgY29udHJvbGxlclxuICAgICAgICBmb3IgKGNvbnN0IHJvdXRlIG9mIE9iamVjdC52YWx1ZXMoY29udHJvbGxlckluZm8ucm91dGVzID8/IHt9KSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIHJvdXRlICR7cm91dGUuaHR0cE1ldGhvZH0gJHtyb3V0ZS5wYXRofWApO1xuICAgICAgICAgICAgY29uc3Qgcm91dGVUYXJnZXQgPSByb3V0ZS50YXJnZXQgfHwgY29udHJvbGxlclRhcmdldDtcbiAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRSZXNvdXJjZSA9IHRoaXMuZ2V0T3JDcmVhdGVSb3V0ZVJlc291cmNlKGNvbnRyb2xsZXJSZXNvdXJjZSwgcm91dGUucGF0aCwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICBjb25zdCB7IHJvdXRlQXV0aG9yaXplck5hbWUsIHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplckdyb3Vwcywgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH0gPSB0aGlzLmV4dHJhY3RSb3V0ZUF1dGhvcml6ZXIocm91dGUsIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lLCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcywgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIHJvdXRlIEF1dGhvcml6ZXI6ICR7cm91dGVBdXRob3JpemVyTmFtZX0gLSAke3JvdXRlQXV0aG9yaXplclR5cGV9IC0gJHtyb3V0ZUF1dGhvcml6ZXJHcm91cHN9YCk7XG5cbiAgICAgICAgICAgIGxldCBtZXRob2RPcHRpb25zID0gdGhpcy5jcmVhdGVNZXRob2RPcHRpb25zKHJvdXRlLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJOYW1lLCBjb250cm9sbGVyQ29uZmlnKTtcblxuICAgICAgICAgICAgaWYgKHJvdXRlVGFyZ2V0ID09PSAncXVldWUnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcm91dGUucGF0aC5yZXBsYWNlKCcvJywgJycpO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJJbnRlZ3JhdGlvbiA9IHRoaXMuY3JlYXRlU1FTSW50ZWdyYXRpb24ocXVldWVOYW1lLCBjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICAgICAgbWV0aG9kT3B0aW9ucyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4ubWV0aG9kT3B0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChyb3V0ZVRhcmdldCA9PT0gJ3RvcGljJykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvcGljTmFtZSA9IHJvdXRlLnBhdGgucmVwbGFjZSgnLycsICcnKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVySW50ZWdyYXRpb24gPSB0aGlzLmNyZWF0ZVNOU0ludGVncmF0aW9uKHRvcGljTmFtZSwgY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLm1ldGhvZE9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgbWV0aG9kID0gY3VycmVudFJlc291cmNlLmFkZE1ldGhvZChyb3V0ZS5odHRwTWV0aG9kLCBjb250cm9sbGVySW50ZWdyYXRpb24sIG1ldGhvZE9wdGlvbnMpO1xuICAgICAgICAgICAgdGhpcy5tZXRob2RzLnB1c2gobWV0aG9kKTtcblxuICAgICAgICAgICAgLy8gaWYgYXV0aG9yaXplciBpcyBBV1NfSUFNLCB0aGVuIGFkZCB0aGUgcm91dGUgdG8gdGhlIHBvbGljeVxuICAgICAgICAgICAgaWYgKHJvdXRlQXV0aG9yaXplclR5cGUgPT09ICdBV1NfSUFNJykge1xuICAgICAgICAgICAgICAgIGxldCBmdWxsUm91dGVQYXRoID0gY29udHJvbGxlck5hbWUgKyByb3V0ZS5wYXRoO1xuXG4gICAgICAgICAgICAgICAgLy8gKiByZXBsYWNlIGVhY2ggcGFyYW0gcGxhY2Vob2xkZXIgYHtpZH1gIHdpdGggYW4gYCpgXG4gICAgICAgICAgICAgICAgcm91dGUucGFyYW1ldGVycz8uZm9yRWFjaChwYXIgPT4ge1xuICAgICAgICAgICAgICAgICAgICBmdWxsUm91dGVQYXRoID0gZnVsbFJvdXRlUGF0aC5yZXBsYWNlKGB7JHtwYXJ9fWAsICcqJyk7XG4gICAgICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgICAgIHRoaXMuZncyNC5hZGRSb3V0ZVRvUm9sZVBvbGljeShmdWxsUm91dGVQYXRoLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBrZWVwIHRyYWNrIG9mIHRoZSBjb250cm9sbGVyIHN0YWNrcyB3aXRoIG1ldGhvZHMgYW5kIHJlc291cmNlcyBpbiBhIG11bHRpLXN0YWNrIHNldHVwIHRvIGNyZWF0ZSBvbmUgZGVwbG95bWVudCBwZXIgY29udHJvbGxlciBzdGFja1xuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IHN0YWNrSW5mbyA9IHRoaXMuY29udHJvbGxlclN0YWNrcy5nZXQoY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICBpZiAoc3RhY2tJbmZvKSB7XG4gICAgICAgICAgICAgICAgc3RhY2tJbmZvLm1ldGhvZHMgPSBbIC4uLnRoaXMubWV0aG9kcyBdO1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5yZXNvdXJjZXMgPSBbIC4uLnRoaXMucmVzb3VyY2VzIF07XG4gICAgICAgICAgICAgICAgc3RhY2tJbmZvLmNvbnRyb2xsZXJzSGFzaC5wdXNoKGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShKU09OLnN0cmluZ2lmeShjb250cm9sbGVyQ29uZmlnKSkuZGlnZXN0KCdoZXgnKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBvdXRwdXQgdGhlIGFwaSBlbmRwb2ludFxuICAgICAgICB0aGlzLm91dHB1dEFwaUVuZHBvaW50KGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyUmVzb3VyY2UsIHRoaXMuZ2V0U3RhZ2VOYW1lKCksIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0U3RhZ2VOYW1lID0gKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpT3B0aW9ucz8uZGVwbG95T3B0aW9ucz8uc3RhZ2VOYW1lIHx8ICdwcm9kJztcbiAgICB9XG5cbiAgICAvLyBpZiB0aGUgQVBJIGlzIGltcG9ydGVkLCB0aGVuIGNyZWF0ZSBvbmUgZGVwbG95bWVudCBwZXIgY29udHJvbGxlciBzdGFjayBhbmQgYWRkIG1ldGhvZCBhbmQgcmVzb3VyY2UgYXMgZGVwZW5kZW5jeVxuICAgIC8vIFRoaXMgaXMgbmVlZGVkIGJlY2F1c2UgaW1wb3J0ZWQgQVBJIGRvZXMgbm90IHByb3BvZ2F0ZSBDT1JTIHNldHRpbmdzIHRvIHRoZSBtZXRob2RzXG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVEZXBsb3ltZW50cygpIHtcblxuICAgICAgICBjb25zdCBzdGFnZU5hbWUgPSB0aGlzLmdldFN0YWdlTmFtZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IFsgY29udHJvbGxlclN0YWNrTmFtZSwgeyBtZXRob2RzLCByZXNvdXJjZXMsIGNvbnRyb2xsZXJzSGFzaCB9IF0gb2YgdGhpcy5jb250cm9sbGVyU3RhY2tzLmVudHJpZXMoKSkge1xuICAgICAgICAgICAgLy8gVE9ETzogYWRkIGJldHRlciBsb2dpYyB0byBmb3JjZSBhIGRlcGxveW1lbnQgd2hlbiB0aGVyZSBpcyBhIGNoYW5nZSBpbiBmcmFtZXdvcmsgY29kZVxuICAgICAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZvcmNlRGVwbG95bWVudCkge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXJzSGFzaC5wdXNoKHJhbmRvbVVVSUQoKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJIYXNoID0gY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEpTT04uc3RyaW5naWZ5KGNvbnRyb2xsZXJzSGFzaCkpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3JlYXRpbmcgZGVwbG95bWVudCBmb3IgY29udHJvbGxlciBzdGFjayAke2NvbnRyb2xsZXJTdGFja05hbWV9IHdpdGggaGFzaCAke2NvbnRyb2xsZXJIYXNofWApO1xuICAgICAgICAgICAgY29uc3QgZGVwbG95bWVudCA9IG5ldyBEZXBsb3ltZW50KHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYGRlcGxveW1lbnQtJHtjb250cm9sbGVySGFzaH1gLCB7XG4gICAgICAgICAgICAgICAgYXBpOiB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGksXG4gICAgICAgICAgICAgICAgc3RhZ2VOYW1lOiBzdGFnZU5hbWUsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBtZXRob2Qgb2YgbWV0aG9kcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgbWV0aG9kIGRlcGVuZGVuY3kgJHttZXRob2QuaHR0cE1ldGhvZH0gJHttZXRob2QucmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KG1ldGhvZClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gYWRkIGRlcGVuZGVjeSBvbiBhbGwgcmVzb3VyY2VzIGZvciB0aGlzIGNvbnRyb2xsZXJcbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyByZXNvdXJjZSBkZXBlbmRlbmN5ICR7cmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KHJlc291cmNlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gaWYgdGhlIGFwaSBpcyBpbXBvcnRlZCBhbmQgaXQncyBub3QgYSBtdWx0aS1zdGFjayBzZXR1cCwgdGhlbiBjcmVhdGUgYSBzaW5nbGUgZGVwbG95bWVudCBmb3IgYWxsIGNvbnRyb2xsZXJzXG4gICAgLy8gU2luZ2xlIGRlcGxveW1lbnQgaXMgbmVlZGVkIHRvIGF2b2lkIHNpbXVsdGF0aW9uIGRlcGxveW1lbnQgd2hpY2ggY2F1c2VzIGVycm9yIG9uIEFQSSBHYXRld2F5XG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVTaW5nbGVEZXBsb3ltZW50KCkge1xuICAgICAgICBjb25zdCBzdGFnZU5hbWUgPSB0aGlzLmdldFN0YWdlTmFtZSgpO1xuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZm9yY2VEZXBsb3ltZW50KSB7XG4gICAgICAgICAgICB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZm9yRWFjaChjID0+IGMuY29udHJvbGxlcnNIYXNoLnB1c2gocmFuZG9tVVVJRCgpKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY3JlYXRlIHRoZSBuYW1lIGZyb20gYWxsIHRoZSBjb250cm9sbGVyIGhhc2ggdmFsdWVzIGNvbWJpbmVkIGFzIGEgc2luZ2xlIGhhc2ggYW5kIGFkZCBkZXBlbmRlbmN5IG9uIGFsbCB0aGUgY29udHJvbGxlcnNcbiAgICAgICAgY29uc3QgZGVwbG95bWVudE5hbWUgPSBgZGVwbG95bWVudC0ke2NyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShBcnJheS5mcm9tKHRoaXMuY29udHJvbGxlclN0YWNrcy52YWx1ZXMoKSkubWFwKGMgPT4gYy5jb250cm9sbGVyc0hhc2gpLmpvaW4oJy0nKSkuZGlnZXN0KCdoZXgnKX1gO1xuXG4gICAgICAgIGNvbnN0IGRlcGxveW1lbnQgPSBuZXcgRGVwbG95bWVudCh0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5uYW1lKSwgZGVwbG95bWVudE5hbWUsIHtcbiAgICAgICAgICAgIGFwaTogdGhpcy5hcGksXG4gICAgICAgICAgICBzdGFnZU5hbWU6IHN0YWdlTmFtZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzLCBjb250cm9sbGVyc0hhc2ggfSBdIG9mIHRoaXMuY29udHJvbGxlclN0YWNrcy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgbWV0aG9kIG9mIG1ldGhvZHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIG1ldGhvZCBkZXBlbmRlbmN5ICR7bWV0aG9kLmh0dHBNZXRob2R9ICR7bWV0aG9kLnJlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShtZXRob2QpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyByZXNvdXJjZSBkZXBlbmRlbmN5ICR7cmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KHJlc291cmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTogQ29yc09wdGlvbnMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcbiAgICAgICAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIixcbiAgICAgICAgICAgICAgICBcIlgtQXBpLUtleVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotRGF0ZVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotQ29udGVudC1TaGEyNTZcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LVNlY3VyaXR5LVRva2VuXCIsXG4gICAgICAgICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFsc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIsXG4gICAgICAgICAgICAgICAgXCJJbXBlcnNvbmF0aW5nLVVzZXItU3ViXCIsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWxsb3dNZXRob2RzOiBbIFwiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiIF0sXG4gICAgICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxuICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiB0aGlzLmdldENvcnNPcmlnaW5zKCksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRDb3JzT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSB0cnVlKSByZXR1cm4gQ29ycy5BTExfT1JJR0lOUztcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSBcInN0cmluZ1wiKSByZXR1cm4gWyB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIF07XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIHx8IFtdO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0T3JDcmVhdGVDb250cm9sbGVyUmVzb3VyY2UgPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogSVJlc291cmNlID0+IHtcbiAgICAgICAgbGV0IHJlc3RBUEkgPSB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJSZXNvdXJjZTogSVJlc291cmNlID0gcmVzdEFQSS5hcGkucm9vdDtcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBjb250cm9sbGVyTmFtZS5zcGxpdCgnLycpO1xuICAgICAgICBmb3IgKGNvbnN0IHBhdGhQYXJ0IG9mIHBhdGhQYXJ0cykge1xuICAgICAgICAgICAgbGV0IGNoaWxkUmVzb3VyY2UgPSBjb250cm9sbGVyUmVzb3VyY2UuZ2V0UmVzb3VyY2UocGF0aFBhcnQpIGFzIElSZXNvdXJjZTtcbiAgICAgICAgICAgIC8vIGlmIGl0J3MgYSBuZXN0ZWQgY29udHJvbGxlciwgdGhlIHJvb3QgcmVzb3VyY2UgbWF5IG5vdCBiZSBjcmVhdGVkIGluIGFub3RoZXIgc3RhY2tcbiAgICAgICAgICAgIGNvbnN0IGlzTmVzdGVkQ29udHJvbGxlciA9IHBhdGhQYXJ0cy5sZW5ndGggPiAxO1xuICAgICAgICAgICAgaWYgKCFjaGlsZFJlc291cmNlICYmIGlzTmVzdGVkQ29udHJvbGxlciAmJiBwYXRoUGFydCA9PT0gcGF0aFBhcnRzWyAwIF0pIHtcbiAgICAgICAgICAgICAgICAvLyB0cnkgdG8gZ2V0IHRoZSByb290IHJlc291cmNlIGZyb20gdGhlIGZ3MjQgb3V0cHV0XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEdldHRpbmcgY29udHJvbGxlciByZXNvdXJjZSBmb3IgJHtwYXRoUGFydH0gZnJvbSBmdzI0IG91dHB1dGApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJSZXNvdXJjZUlkID0gdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoYHJlc3RBUElfY29udHJvbGxlcl8ke3BhdGhQYXJ0fV9yZXNvdXJjZUlkYCwgJ3Jlc291cmNlJywgY3VycmVudFN0YWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoY29udHJvbGxlclJlc291cmNlSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvbnRyb2xsZXIgcmVzb3VyY2UgZm9yICR7cGF0aFBhcnR9IGZvdW5kIGluIGZ3MjQgb3V0cHV0OiAke2NvbnRyb2xsZXJSZXNvdXJjZUlkfWApO1xuICAgICAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gUmVzb3VyY2UuZnJvbVJlc291cmNlQXR0cmlidXRlcyhjdXJyZW50U3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2NvbnRyb2xsZXJTdGFja05hbWV9LSR7cGF0aFBhcnR9YCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VJZDogY29udHJvbGxlclJlc291cmNlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN0QXBpOiByZXN0QVBJLmFwaSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6ICcvJyArIHBhdGhQYXJ0XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSkge1xuICAgICAgICAgICAgICAgIC8vIGZvciBuZXN0ZWQgcmVzb3VyY2VzIGFkZCAvIHRvIHRoZSBwYXRoXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGNvbnRyb2xsZXIgcmVzb3VyY2UgZm9yIHBhdGggJHtwYXRoUGFydH0gdW5kZXIgJHtjb250cm9sbGVyUmVzb3VyY2UucGF0aH1gKTtcbiAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gY29udHJvbGxlclJlc291cmNlLmFkZFJlc291cmNlKHBhdGhQYXJ0KSBhcyBJUmVzb3VyY2U7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoaXNOZXN0ZWRDb250cm9sbGVyICYmIHBhdGhQYXJ0ID09PSBwYXRoUGFydHNbIDAgXSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU2V0dGluZyBvdXRwdXQgZm9yIGNvbnRvcmxsZXIgcmVzb3VyY2UgJHtjb250cm9sbGVyU3RhY2tOYW1lfSBwYXRoICR7cGF0aFBhcnR9YCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYHJlc3RBUElfY29udHJvbGxlcl8ke3BhdGhQYXJ0fWAsIGNoaWxkUmVzb3VyY2UsIE91dHB1dFR5cGUuUkVTT1VSQ0UsICdyZXNvdXJjZUlkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udHJvbGxlclJlc291cmNlID0gY2hpbGRSZXNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjb250cm9sbGVyUmVzb3VyY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVMYW1iZGFGdW5jdGlvbiA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogTm9kZWpzRnVuY3Rpb24gPT4ge1xuICAgICAgICBjb25zdCBmdW5jdGlvblByb3BzID0geyAuLi50aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzLCAuLi5jb250cm9sbGVyQ29uZmlnPy5mdW5jdGlvblByb3BzIH07XG5cbiAgICAgICAgY29uc3QgZW52VmFyaWFibGVzID0gdGhpcy5mdzI0LnJlc29sdmVFbnZWYXJpYWJsZXMoY29udHJvbGxlckNvbmZpZy5lbnYsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSk7XG5cbiAgICAgICAgLy8gZG8gbm90IG92ZXJyaWRlIHRoZSBlbnRyeSBwYWNrYWdlcyBpZiBhbHJlYWR5IHNldFxuICAgICAgICBpZiAoIShFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyBpbiBlbnZWYXJpYWJsZXMpICYmIGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcykge1xuICAgICAgICAgICAgZW52VmFyaWFibGVzWyBFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyBdID0gKGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyBhcyBBcnJheTxzdHJpbmc+KS5qb2luKCcsJyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgY29udHJvbGxlck5hbWUgKyBcIi1jb250cm9sbGVyXCIsIHtcbiAgICAgICAgICAgIGVudHJ5OiBmaWxlUGF0aCArIFwiL1wiICsgZmlsZU5hbWUsXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczogZW52VmFyaWFibGVzLFxuICAgICAgICAgICAgcG9saWNpZXM6IGNvbnRyb2xsZXJDb25maWc/LnBvbGljaWVzLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IGNvbnRyb2xsZXJDb25maWc/LnJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgYWxsb3dTZW5kRW1haWw6IHRydWUsXG4gICAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IGNvbnRyb2xsZXJDb25maWc/LmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgcHJvY2Vzc29yQXJjaGl0ZWN0dXJlOiBjb250cm9sbGVyQ29uZmlnPy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiBmdW5jdGlvblByb3BzLFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzLFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICB9XG5cbiAgICBwcml2YXRlIGV4dHJhY3REZWZhdWx0QXV0aG9yaXplciA9IChjb250cm9sbGVyQ29uZmlnOiBhbnkpOiB7IGRlZmF1bHRBdXRob3JpemVyTmFtZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplclR5cGU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IHRoaXMuZncyNC5nZXREZWZhdWx0Q29nbml0b0F1dGhvcml6ZXJOYW1lKCk7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgbGV0IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY29udHJvbGxlckNvbmZpZz8uYXV0aG9yaXplcikpIHtcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRBdXRob3JpemVyID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLmZpbmQoKGF1dGg6IGFueSkgPT4gYXV0aC5kZWZhdWx0KSB8fCBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXJbIDAgXTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IGRlZmF1bHRBdXRob3JpemVyLm5hbWUgfHwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXIuZ3JvdXBzIHx8IFtdO1xuICAgICAgICAgICAgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0QXV0aG9yaXplci5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLmdyb3VwcyB8fCBbXTtcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gY29udHJvbGxlckNvbmZpZy5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFkZWZhdWx0QXV0aG9yaXplclR5cGUgJiYgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSkge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChkZWZhdWx0QXV0aG9yaXplckdyb3Vwcykge1xuXG4gICAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgZm9yIHRoZSBncm91cHMgaXMgYSB0ZW1wbGF0ZSBzdHJpbmcsIFxuICAgICAgICAgICAgLy8gcmVzb2x2ZSBpdCBbd2hlbiB0aGUgYXBwbGljYXRpb24gd2FudCB0byBhbGxvdyBtdWx0aXBsZSB1c2VyIGdyb3VwcyB0byBoYXZlIGFjY2Vzc11cbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgXCJlbnY6eHh4Omdyb3VwMVwiID09PiBcImdyb3VwMS1yZXNvbHZlZFwiIHx8IFwiZ3JvdXAxLGdyb3VwMlwiIHx8IFwiZW52Onh4eDpncm91cDEsZW52Onh4eDpncm91cDJcIlxuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSkge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gdGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShkZWZhdWx0QXV0aG9yaXplckdyb3VwcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIG5vdyBpZiB0aGUgcmVzb2x2ZWQgdmFsdWUgaXMgYWdhaW4gYSBzdHJpbmcsIHNwbGl0IGl0IGJ5IGNvbW1hXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFwiZ3JvdXAxLGdyb3VwMlwiID09PiBbXCJncm91cDFcIiwgXCJncm91cDJcIl1cbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhkZWZhdWx0QXV0aG9yaXplckdyb3VwcykpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLnNwbGl0KCcsJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMubGVuZ3RoICYmIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHMpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHJlc29sdmUgdGhlIGdyb3VwIG5hbWVzIGZyb20gZncyNC1zY29wZSBpZiBpdCdzIGEgdGVtcGxhdGVcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgW1wiZW52Onh4eDpncm91cDFcIixcImVudjp4eHg6Z3JvdXAyXCJdID09PiBbXCJncm91cDEtcmVzb2x2ZWRcIiwgXCJncm91cDItcmVzb2x2ZWRcIl1cbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzIGFzIEFycmF5PHN0cmluZz4pLm1hcCh0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKTtcblxuICAgICAgICAgICAgLy8gZmxhdC1tYXAgdGhlIGdyb3VwcyBpZiB0aGV5IHJlc29sdmVkIGdyb3VwIHZhbHVlcyBhcmUgYWdhaW4gY29tbWEgc2VwYXJhdGVkXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSByZXNvbHZlZCB2YWx1ZSBpcyBsaWtlIFtcImEsYlwiLCBcImMsZFwiXSA9PT4gW1wiYVwiLCBcImJcIiwgXCJjXCIsIFwiZFwiXVxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSAoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgYXMgQXJyYXk8c3RyaW5nPikuZmxhdE1hcCgoZ3JvdXA6IHN0cmluZykgPT4gZ3JvdXAuc3BsaXQoJywnKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4geyBkZWZhdWx0QXV0aG9yaXplck5hbWUsIGRlZmF1bHRBdXRob3JpemVyVHlwZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRPckNyZWF0ZVJvdXRlUmVzb3VyY2UgPSAocGFyZW50UmVzb3VyY2U6IElSZXNvdXJjZSwgcGF0aDogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBJUmVzb3VyY2UgPT4ge1xuICAgICAgICBsZXQgY3VycmVudFJlc291cmNlOiBJUmVzb3VyY2UgPSBwYXJlbnRSZXNvdXJjZTtcbiAgICAgICAgY29uc3QgcmVzdEFQSSA9IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGF0aFBhcnQgb2YgcGF0aC5zcGxpdChcIi9cIikpIHtcbiAgICAgICAgICAgIGlmIChwYXRoUGFydCA9PT0gXCJcIikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgY2hpbGRSZXNvdXJjZSA9IGN1cnJlbnRSZXNvdXJjZS5nZXRSZXNvdXJjZShwYXRoUGFydCk7XG4gICAgICAgICAgICBpZiAoIWNoaWxkUmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gY3VycmVudFJlc291cmNlLmFkZFJlc291cmNlKHBhdGhQYXJ0KTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdEFQSS5pc0ltcG9ydGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvcnNQcmVmbGlnaHRNZXRob2QgPSBjaGlsZFJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQodGhpcy5nZXRDb3JzUHJlZmxpZ2h0T3B0aW9ucygpKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5tZXRob2RzLnB1c2goY29yc1ByZWZsaWdodE1ldGhvZCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzb3VyY2VzLnB1c2goY2hpbGRSZXNvdXJjZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY3VycmVudFJlc291cmNlID0gY2hpbGRSZXNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjdXJyZW50UmVzb3VyY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBleHRyYWN0Um91dGVBdXRob3JpemVyID0gKHJvdXRlOiBhbnksIGRlZmF1bHRBdXRob3JpemVyVHlwZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbik6IHsgcm91dGVBdXRob3JpemVyTmFtZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplck5hbWUgPSBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcblxuICAgICAgICBpZiAocm91dGUuYXV0aG9yaXplciAmJiB0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyLnR5cGUgfHwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyTmFtZSA9IHJvdXRlLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJHcm91cHMgPSByb3V0ZS5hdXRob3JpemVyLmdyb3VwcyB8fCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgICAgIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IHJvdXRlLmF1dGhvcml6ZXIucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVBdXRob3JpemVyTmFtZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZU1ldGhvZE9wdGlvbnMgPSAocm91dGU6IGFueSwgcm91dGVBdXRob3JpemVyVHlwZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnKTogTWV0aG9kT3B0aW9ucyA9PiB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RQYXJhbWV0ZXJzOiB7IFsga2V5OiBzdHJpbmcgXTogYm9vbGVhbiB9ID0ge307XG5cbiAgICAgICAgLy8gQWRkIHBhdGggcGFyYW1ldGVyc1xuICAgICAgICBmb3IgKGNvbnN0IHBhcmFtIG9mIHJvdXRlLnBhcmFtZXRlcnMgfHwgW10pIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzWyBgbWV0aG9kLnJlcXVlc3QucGF0aC4ke3BhcmFtfWAgXSA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgQVBJIGtleSBoZWFkZXIgcmVxdWlyZW1lbnQgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkpIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzWyAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLngtYXBpLWtleScgXSA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiB0aGUgYXV0aG9yaXplciBpcyBKV1QsIGNvbnZlcnQgaXQgdG8gQ1VTVE9NXG4gICAgICAgIGNvbnN0IGF1dGhvcml6ZXIgPSB0aGlzLmZ3MjQuZ2V0QXV0aG9yaXplcihyb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJOYW1lKTtcbiAgICAgICAgaWYgKHJvdXRlQXV0aG9yaXplclR5cGUgPT09ICdKV1QnKSB7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJUeXBlID0gJ0NVU1RPTSc7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnMsXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogcm91dGVBdXRob3JpemVyVHlwZSBhcyBBdXRob3JpemF0aW9uVHlwZSxcbiAgICAgICAgICAgIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIsXG4gICAgICAgICAgICBhcGlLZXlSZXF1aXJlZDogY29udHJvbGxlckNvbmZpZy5yZXF1aXJlQXBpS2V5IHx8IGZhbHNlXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVTUVNJbnRlZ3JhdGlvbiA9IChxdWV1ZU5hbWU6IHN0cmluZywgY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogQXdzSW50ZWdyYXRpb24gPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3JlYXRpbmcgU1FTIGludGVncmF0aW9uIGZvciBxdWV1ZSAke3F1ZXVlTmFtZX0gaW4gY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfSBpbiBzdGFjayAke2NvbnRyb2xsZXJTdGFja05hbWV9YCk7XG4gICAgICAgIGNvbnN0IGludGVncmF0aW9uUm9sZSA9IG5ldyBSb2xlKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7cXVldWVOYW1lfS1zcXMtaW50ZWdyYXRpb24tcm9sZWAsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBxdWV1ZUFybiA9IHRoaXMuZncyNC5nZXRBcm4oJ3NxcycsIHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlSW5zdGFuY2UgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHtxdWV1ZU5hbWV9LXF1ZXVlYCwgcXVldWVBcm4pO1xuICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50U2VuZE1lc3NhZ2VzKGludGVncmF0aW9uUm9sZSk7XG4gICAgICAgIHJldHVybiBuZXcgQXdzSW50ZWdyYXRpb24oe1xuICAgICAgICAgICAgc2VydmljZTogXCJzcXNcIixcbiAgICAgICAgICAgIHBhdGg6IHRoaXMuZncyNC5nZXRDb25maWcoKS5hY2NvdW50ICsgXCIvXCIgKyBxdWV1ZUluc3RhbmNlLnF1ZXVlTmFtZSxcbiAgICAgICAgICAgIGludGVncmF0aW9uSHR0cE1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY3JlZGVudGlhbHNSb2xlOiBpbnRlZ3JhdGlvblJvbGUsXG4gICAgICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJpbnRlZ3JhdGlvbi5yZXF1ZXN0LmhlYWRlci5Db250ZW50LVR5cGVcIjogXCInYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJ1wiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVxdWVzdFRlbXBsYXRlczoge1xuICAgICAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL2pzb25cIjogYEFjdGlvbj1TZW5kTWVzc2FnZSZNZXNzYWdlQm9keT0kdXRpbC51cmxFbmNvZGUoJGlucHV0LmJvZHkpYCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlU05TSW50ZWdyYXRpb24gPSAodG9waWNOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IEF3c0ludGVncmF0aW9uID0+IHtcbiAgICAgICAgY29uc3QgaW50ZWdyYXRpb25Sb2xlID0gbmV3IFJvbGUodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHt0b3BpY05hbWV9LXNucy1pbnRlZ3JhdGlvbi1yb2xlYCwge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHRvcGljQXJuID0gdGhpcy5mdzI0LmdldEFybignc25zJywgdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUodG9waWNOYW1lICsgJ190b3BpY05hbWUnLCAndG9waWMnLCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpKTtcbiAgICAgICAgY29uc3QgdG9waWNJbnN0YW5jZSA9IFRvcGljLmZyb21Ub3BpY0Fybih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3RvcGljTmFtZX0tdG9waWNgLCB0b3BpY0Fybik7XG4gICAgICAgIHRvcGljSW5zdGFuY2UuZ3JhbnRQdWJsaXNoKGludGVncmF0aW9uUm9sZSk7XG4gICAgICAgIHJldHVybiBuZXcgQXdzSW50ZWdyYXRpb24oe1xuICAgICAgICAgICAgc2VydmljZTogXCJzbnNcIixcbiAgICAgICAgICAgIHBhdGg6ICcvJyxcbiAgICAgICAgICAgIGludGVncmF0aW9uSHR0cE1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY3JlZGVudGlhbHNSb2xlOiBpbnRlZ3JhdGlvblJvbGUsXG4gICAgICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJpbnRlZ3JhdGlvbi5yZXF1ZXN0LmhlYWRlci5Db250ZW50LVR5cGVcIjogXCInYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJ1wiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVxdWVzdFRlbXBsYXRlczoge1xuICAgICAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL2pzb25cIjogYEFjdGlvbj1QdWJsaXNoJlRvcGljQXJuPSR1dGlsLnVybEVuY29kZShcXCcke3RvcGljSW5zdGFuY2UudG9waWNBcm59XFwnKSZNZXNzYWdlPSR1dGlsLnVybEVuY29kZSgkaW5wdXQuYm9keSlgLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBvdXRwdXRBcGlFbmRwb2ludCA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyUmVzb3VyY2U6IElSZXNvdXJjZSwgc3RhZ2VOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZykgPT4ge1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYEVuZHBvaW50JHtjb250cm9sbGVyTmFtZX1gLCB7XG4gICAgICAgICAgICB2YWx1ZTogJ2h0dHBzOi8vJyArIHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpLmFwaS5yZXN0QXBpSWQgKyAnLmV4ZWN1dGUtYXBpLicgKyB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkucmVnaW9uICsgJy5hbWF6b25hd3MuY29tLycgKyBzdGFnZU5hbWUgKyAnLycgKyBjb250cm9sbGVyUmVzb3VyY2UucGF0aC5zbGljZSgxKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkFQSSBHYXRld2F5IEVuZHBvaW50IGZvciBcIiArIGNvbnRyb2xsZXJOYW1lLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNldHVwVXNhZ2VQbGFuKHBsYW5Db25maWc/OiBJVXNhZ2VQbGFuQ29uZmlnLCBjcmVhdGVLZXk6IGJvb2xlYW4gPSBmYWxzZSk6IHsgcGxhbjogVXNhZ2VQbGFuOyBuYW1lOiBzdHJpbmcgfSB7XG4gICAgICAgIC8vIElmIG5vIHBsYW4gY29uZmlnIGlzIHByb3ZpZGVkIGFuZCB3ZSBuZWVkIGEga2V5LCB1c2UgdGhlIGZpcnN0IGNvbmZpZ3VyZWQgcGxhbiBvciBjcmVhdGUgYSBkZWZhdWx0IG9uZVxuICAgICAgICBpZiAoIXBsYW5Db25maWcgJiYgY3JlYXRlS2V5KSB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gdXNlIHRoZSBmaXJzdCBjb25maWd1cmVkIHBsYW4gdGhhdCBoYXMgQVBJIGtleXNcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZ3VyZWRQbGFuID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcudXNhZ2VQbGFucz8uZmluZChwbGFuID0+IHBsYW4uYXBpS2V5cyk7XG4gICAgICAgICAgICBpZiAoY29uZmlndXJlZFBsYW4pIHtcbiAgICAgICAgICAgICAgICBwbGFuQ29uZmlnID0gY29uZmlndXJlZFBsYW47XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIElmIG5vIGNvbmZpZ3VyZWQgcGxhbiB3aXRoIGtleXMgZXhpc3RzLCBjcmVhdGUgYSBkZWZhdWx0IHBsYW5cbiAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBhIGRldGVybWluaXN0aWMga2V5IGJhc2VkIG9uIGFwcCBuYW1lIGFuZCBhIGZpeGVkIGlkZW50aWZpZXJcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0S2V5ID0gY3JlYXRlSGFzaCgnc2hhMjU2JylcbiAgICAgICAgICAgICAgICAgICAgLnVwZGF0ZShgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuYWNjb3VudH0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkucmVnaW9ufS0ke3RoaXMuZncyNC5nZXRDb25maWcoKS5lbnZpcm9ubWVudH0tZGVmYXVsdC1hcGkta2V5YClcbiAgICAgICAgICAgICAgICAgICAgLmRpZ2VzdCgnaGV4JylcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDMyKTsgLy8gVXNlIGZpcnN0IDMyIGNoYXJzIGZvciBhIHJlYXNvbmFibGUga2V5IGxlbmd0aFxuXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgTm8gdXNhZ2UgcGxhbiB3aXRoIEFQSSBrZXlzIGZvdW5kLCBjcmVhdGluZyBhIGRlZmF1bHQgb25lLiBUaGlzIGlzIG5vdCByZWNvbW1lbmRlZCBmb3IgcHJvZHVjdGlvbiBlbnZpcm9ubWVudHMuIFBsZWFzZSBjb25maWd1cmUgYSB1c2FnZSBwbGFuIHdpdGggQVBJIGtleXMgZm9yIHlvdXIgQVBJLmApO1xuXG4gICAgICAgICAgICAgICAgcGxhbkNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWRlZmF1bHQtdXNhZ2UtcGxhbmAsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgRGVmYXVsdCB1c2FnZSBwbGFuIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgIGFwaUtleXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleXM6IFsgZGVmYXVsdEtleSBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGxhbk5hbWUgPSBwbGFuQ29uZmlnPy5uYW1lIHx8IGAke3RoaXMuZncyNC5hcHBOYW1lfS1kZWZhdWx0LXVzYWdlLXBsYW5gO1xuXG4gICAgICAgIGlmICghdGhpcy51c2FnZVBsYW5zLmhhcyhwbGFuTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFNldHRpbmcgdXAgdXNhZ2UgcGxhbjogJHtwbGFuTmFtZX1gKTtcbiAgICAgICAgICAgIGNvbnN0IHVzYWdlUGxhbiA9IG5ldyBVc2FnZVBsYW4odGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3BsYW5OYW1lfS11c2FnZS1wbGFuYCwge1xuICAgICAgICAgICAgICAgIG5hbWU6IHBsYW5OYW1lLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBwbGFuQ29uZmlnPy5kZXNjcmlwdGlvbiB8fCBgVXNhZ2UgcGxhbiBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgIGFwaVN0YWdlczogWyB7XG4gICAgICAgICAgICAgICAgICAgIGFwaTogdGhpcy5hcGksXG4gICAgICAgICAgICAgICAgICAgIHN0YWdlOiB0aGlzLmFwaS5kZXBsb3ltZW50U3RhZ2VcbiAgICAgICAgICAgICAgICB9IF0sXG4gICAgICAgICAgICAgICAgdGhyb3R0bGU6IHtcbiAgICAgICAgICAgICAgICAgICAgcmF0ZUxpbWl0OiBwbGFuQ29uZmlnPy5yYXRlTGltaXQgfHwgMTAsXG4gICAgICAgICAgICAgICAgICAgIGJ1cnN0TGltaXQ6IHBsYW5Db25maWc/LmJ1cnN0TGltaXQgfHwgMjBcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHF1b3RhOiB7XG4gICAgICAgICAgICAgICAgICAgIGxpbWl0OiBwbGFuQ29uZmlnPy5xdW90YUxpbWl0IHx8IDEwMDAwLFxuICAgICAgICAgICAgICAgICAgICBwZXJpb2Q6IHBsYW5Db25maWc/LnF1b3RhUGVyaW9kIHx8IFBlcmlvZC5NT05USFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy51c2FnZVBsYW5zLnNldChwbGFuTmFtZSwgeyBwbGFuOiB1c2FnZVBsYW4sIG5hbWU6IHBsYW5OYW1lIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGlLZXlzLnNldChwbGFuTmFtZSwgW10pO1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgQVBJIGtleXMgaWYgY29uZmlndXJlZCBmb3IgdGhpcyB1c2FnZSBwbGFuXG4gICAgICAgICAgICBpZiAocGxhbkNvbmZpZz8uYXBpS2V5cykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYENyZWF0aW5nIEFQSSBrZXlzIGZvciB1c2FnZSBwbGFuOiAke3BsYW5OYW1lfWApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGtleXMgPSBwbGFuQ29uZmlnLmFwaUtleXMua2V5cyB8fCBbXTtcbiAgICAgICAgICAgICAgICBrZXlzLmZvckVhY2goKGtleSwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlIHRoZSBrZXkgbmFtZSBmcm9tIGNvbmZpZyBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSB1c2UgdGhlIHByZWZpeCBvciBnZW5lcmF0ZSBhIG5hbWVcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qga2V5TmFtZSA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaUtleUNvbmZpZz8ua2V5TmFtZSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgKHBsYW5Db25maWcuYXBpS2V5cz8ua2V5TmFtZVByZWZpeFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYCR7cGxhbkNvbmZpZy5hcGlLZXlzLmtleU5hbWVQcmVmaXh9LSR7aW5kZXh9YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWFwaS1rZXktJHtpbmRleH1gKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBrZXkgYWxyZWFkeSBleGlzdHNcbiAgICAgICAgICAgICAgICAgICAgbGV0IGV4aXN0aW5nS2V5ID0gdGhpcy5rZXlWYWx1ZXMuZ2V0KGtleSk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghZXhpc3RpbmdLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nS2V5ID0gbmV3IEFwaUtleSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0tYXBpLWtleWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIGtleSAke2luZGV4ICsgMX0gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZToga2V5XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7a2V5TmFtZX0taWRgLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGV4aXN0aW5nS2V5LmtleUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIEtleSAke2luZGV4ICsgMX0gSUQgZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMua2V5VmFsdWVzLnNldChrZXksIGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHVzYWdlUGxhbi5hZGRBcGlLZXkoZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmFwaUtleXMuZ2V0KHBsYW5OYW1lKSEucHVzaChleGlzdGluZ0tleSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy51c2FnZVBsYW5zLmdldChwbGFuTmFtZSkhO1xuICAgIH1cblxufVxuIl19