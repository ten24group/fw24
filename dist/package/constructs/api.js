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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQVNBLCtEQVVvQztBQUVwQyw2Q0FBcUY7QUFFckYsaURBQTZEO0FBRTdELGlEQUE0QztBQUM1QyxpREFBNEM7QUFNNUMsdUNBQW9DO0FBQ3BDLDJDQUF3QztBQUN4Qyx1REFBeUY7QUFDekYsd0NBQTBDO0FBRTFDLG9DQUFpQztBQUNqQyx1REFBbUQ7QUFDbkQsNkRBQXlEO0FBNEJ6RCw2Q0FBcUQ7QUFDckQscUNBQThEO0FBQzlELDBEQUE2QjtBQUU3QixrQ0FBbUM7QUFFbkMsb0NBQTZDO0FBQzdDLGlDQUF1QztBQUN2QywrQ0FBcUQ7QUFDckQseUNBQStDO0FBQy9DLG1DQUF5QztBQUN6QyxxQ0FBMkM7QUFDM0MsbUNBQXlDO0FBQ3pDLG1DQUF5QztBQUN6QywrQkFBcUM7QUF3SXJDLE1BQWEsWUFBWTtJQW1CUTtJQWxCcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDekMsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsWUFBWSxDQUFDLElBQUksQ0FBQztJQUNqQyxZQUFZLEdBQWEsQ0FBRSxrQkFBWSxDQUFDLElBQUksRUFBRSx3QkFBZSxDQUFDLElBQUksRUFBRSw0QkFBaUIsQ0FBQyxJQUFJLEVBQUUsb0JBQWEsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLENBQUUsQ0FBQztJQUNoTCxNQUFNLENBQXVCO0lBRTdCLEdBQUcsQ0FBVztJQUNkLFNBQVMsQ0FBUztJQUNsQixVQUFVLEdBQW1ELElBQUksR0FBRyxFQUFFLENBQUM7SUFDdkUsT0FBTyxHQUEwQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lB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SSxDQUFDLE9BQU8sRUFBRTt5QkFDbEUsQ0FBQyxDQUFDO3dCQUVILElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxXQUFXLENBQUMsQ0FBQztvQkFDekMsQ0FBQztvQkFFRCxTQUFTLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxDQUFDO29CQUNqQyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztvQkFDL0MsSUFBSSxXQUFXLEVBQUUsQ0FBQzt3QkFDZCxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO29CQUNsQyxDQUFDO2dCQUNMLENBQUMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztRQUNMLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNoRCxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDYixNQUFNLElBQUksS0FBSyxDQUFDLGNBQWMsUUFBUSxZQUFZLENBQUMsQ0FBQztRQUN4RCxDQUFDO1FBQ0QsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztDQUVKO0FBcjBCRCxvQ0FxMEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUge1xuICAgIEF1dGhvcml6YXRpb25UeXBlLFxuICAgIENvcnNPcHRpb25zLFxuICAgIElSZXNvdXJjZSxcbiAgICBNZXRob2QsXG4gICAgTWV0aG9kT3B0aW9ucyxcbiAgICBSZXN0QXBpUHJvcHNcbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5cbmltcG9ydCB7XG4gICAgQXdzSW50ZWdyYXRpb24sXG4gICAgQ29ycyxcbiAgICBEZXBsb3ltZW50LFxuICAgIFJlc291cmNlLFxuICAgIFJlc3BvbnNlVHlwZSxcbiAgICBSZXN0QXBpLFxuICAgIEFwaUtleSxcbiAgICBQZXJpb2QsXG4gICAgVXNhZ2VQbGFuXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuXG5pbXBvcnQgeyBDZm5PdXRwdXQsIER1cmF0aW9uLCBOZXN0ZWRTdGFjaywgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHsgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5cbmltcG9ydCB0eXBlIHsgSUZ3MjRNb2R1bGUgfSBmcm9tIFwiLi4vY29yZS9cIjtcbmltcG9ydCB0eXBlIEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuXG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCBNdXRhYmxlIGZyb20gXCIuLi90eXBlcy9tdXRhYmxlXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24gfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IExhbWJkYUludGVncmF0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWludGVncmF0aW9uXCI7XG5cbmludGVyZmFjZSBJQVBJUmVmZXJlbmNlIHtcbiAgICBhcGk6IFJlc3RBcGk7XG4gICAgaXNJbXBvcnRlZDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIElBdXRob3JpemVyQ29uZmlnIHtcbiAgICBuYW1lPzogc3RyaW5nO1xuICAgIHR5cGU/OiBzdHJpbmc7XG4gICAgZ3JvdXBzPzogc3RyaW5nIHwgc3RyaW5nW107XG4gICAgcmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZz86IGJvb2xlYW47XG4gICAgZGVmYXVsdD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBJQ29udHJvbGxlckNvbmZpZ1dpdGhBdXRob3JpemVyIGV4dGVuZHMgSUNvbnRyb2xsZXJDb25maWcge1xuICAgIHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc/OiBib29sZWFuO1xuICAgIGF1dGhvcml6ZXI/OiBzdHJpbmcgfCBJQXV0aG9yaXplckNvbmZpZyB8IElBdXRob3JpemVyQ29uZmlnW107XG59XG5cbmludGVyZmFjZSBJUm91dGVXaXRoQXV0aG9yaXplciB7XG4gICAgaHR0cE1ldGhvZDogc3RyaW5nO1xuICAgIHBhdGg6IHN0cmluZztcbiAgICB0YXJnZXQ/OiBzdHJpbmc7XG4gICAgcGFyYW1ldGVycz86IHN0cmluZ1tdIHwgU3RyaW5nW107XG4gICAgYXV0aG9yaXplcj86IHN0cmluZyB8IElBdXRob3JpemVyQ29uZmlnO1xufVxuXG5pbXBvcnQgeyBjcmVhdGVIYXNoLCByYW5kb21VVUlEIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCI7XG5pbXBvcnQgeyBjb3B5RmlsZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IElDb250cm9sbGVyQ29uZmlnIH0gZnJvbSBcIi4uL2RlY29yYXRvcnMvY29udHJvbGxlclwiO1xuaW1wb3J0IHsgRU5WX0tFWVMgfSBmcm9tIFwiLi4vZncyNFwiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IGlzQXJyYXksIGlzU3RyaW5nIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBBdXRoQ29uc3RydWN0IH0gZnJvbSBcIi4vYXV0aFwiO1xuaW1wb3J0IHsgQ2VydGlmaWNhdGVDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jZXJ0aWZpY2F0ZVwiO1xuaW1wb3J0IHsgRHluYW1vREJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9keW5hbW9kYlwiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5pbXBvcnQgeyBRdWV1ZUNvbnN0cnVjdCB9IGZyb20gXCIuL3F1ZXVlXCI7XG5pbXBvcnQgeyBUb3BpY0NvbnN0cnVjdCB9IGZyb20gXCIuL3RvcGljXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIGFuIEFQSSBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUFQSUNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgQ09SUyBjb25maWd1cmF0aW9uIGZvciB0aGUgQVBJLlxuICAgICAqIEl0IGNhbiBiZSBhIGJvb2xlYW4gdmFsdWUsIGEgc2luZ2xlIHN0cmluZywgb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncy5cbiAgICAgKi9cbiAgICBjb3JzPzogYm9vbGVhbiB8IHN0cmluZyB8IHN0cmluZ1tdO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIGFkZGl0aW9uYWwgb3B0aW9ucyBmb3IgdGhlIEFQSS5cbiAgICAgKi9cbiAgICBhcGlPcHRpb25zPzogUmVzdEFwaVByb3BzO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIGNvbnRyb2xsZXJzIGFyZSBsb2NhdGVkLlxuICAgICAqL1xuICAgIGNvbnRyb2xsZXJzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvbi5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wcztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgbnVtYmVyIG9mIGRheXMgdG8gcmV0YWluIHRoZSBBUEkgbG9ncy5cbiAgICAgKi9cbiAgICBsb2dSZXRlbnRpb25EYXlzPzogUmV0ZW50aW9uRGF5cztcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB0aGUgcmVtb3ZhbCBwb2xpY3kgZm9yIHRoZSBBUEkgbG9ncy5cbiAgICAgKi9cbiAgICBsb2dSZW1vdmFsUG9saWN5PzogUmVtb3ZhbFBvbGljeTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBjdXN0b20gZG9tYWluIG5hbWUgZm9yIHRoZSBBUEkuXG4gICAgICovXG4gICAgZG9tYWluTmFtZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBjZXJ0aWZpY2F0ZSBBUk4gZm9yIHRoZSBjdXN0b20gZG9tYWluIG5hbWUuXG4gICAgICovXG4gICAgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBBUEkgR2F0ZXdheSBMYW1iZGEgaW50ZWdyYXRpb24gdGltZW91dCBpbiBzZWNvbmRzLlxuICAgICAqL1xuICAgIGludGVncmF0aW9uVGltZW91dD86IG51bWJlcjtcblxuICAgIC8qKlxuICAgICAqIFRoZSBwYXJlbnQgc3RhY2sgbmFtZSBmb3IgdGhlIENvbnRyb2xsZXJzLlxuICAgICAqL1xuICAgIGNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBTZXQgdG8gZmFsc2UgaWYgeW91IHdhbnQgdG8gc2tpcCBjcmVhdGlvbiBvZiBjb250cm9sbGVycyByZXNvdXJjZXMgYW5kIG1ldGhvZHNcbiAgICAgKiBUaGlzIHdpbGwgZGVsZXRlIGFsbCB0aGUgY29udHJvbGxlcnMgcmVzb3VyY2VzIGFuZCBtZXRob2RzIGZyb20gdGhlIEFQSVxuICAgICAqL1xuICAgIHNraXBDb250cm9sbGVycz86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBGb3JjZSBhIGRlcGxveW1lbnQgb2YgdGhlIEFQSSB3aGVuIHVzaW5nIGltcG9ydGVkIEFQSXNcbiAgICAgKi9cbiAgICBmb3JjZURlcGxveW1lbnQ/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogQVBJIGtleSBjb25maWd1cmF0aW9uIGZvciB0aGUgQVBJXG4gICAgICovXG4gICAgYXBpS2V5Q29uZmlnPzoge1xuICAgICAgICAvKipcbiAgICAgICAgICogTGlzdCBvZiB2YWxpZCBBUEkga2V5cy4gSWYgZW1wdHksIGtleXMgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZFxuICAgICAgICAgKi9cbiAgICAgICAga2V5cz86IHN0cmluZ1tdO1xuICAgICAgICAvKipcbiAgICAgICAgICogTmFtZSBvZiB0aGUgQVBJIGtleSAodXNlZCB3aGVuIGF1dG8tZ2VuZXJhdGluZylcbiAgICAgICAgICovXG4gICAgICAgIGtleU5hbWU/OiBzdHJpbmc7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFVzYWdlIHBsYW4gY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSVxuICAgICAqL1xuICAgIHVzYWdlUGxhbnM/OiBJVXNhZ2VQbGFuQ29uZmlnW107XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgQVBJIGtleSB3aXRoaW4gYSB1c2FnZSBwbGFuXG4gKi9cbmludGVyZmFjZSBJVXNhZ2VQbGFuQXBpS2V5Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBMaXN0IG9mIHZhbGlkIEFQSSBrZXlzLiBJZiBlbXB0eSwga2V5cyB3aWxsIGJlIGF1dG8tZ2VuZXJhdGVkXG4gICAgICovXG4gICAga2V5cz86IHN0cmluZ1tdO1xuICAgIC8qKlxuICAgICAqIE5hbWUgcHJlZml4IGZvciB0aGUgQVBJIGtleXMgKHVzZWQgd2hlbiBhdXRvLWdlbmVyYXRpbmcpXG4gICAgICovXG4gICAga2V5TmFtZVByZWZpeD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBhIHVzYWdlIHBsYW5cbiAqL1xuaW50ZXJmYWNlIElVc2FnZVBsYW5Db25maWcge1xuICAgIC8qKlxuICAgICAqIE5hbWUgb2YgdGhlIHVzYWdlIHBsYW5cbiAgICAgKi9cbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogRGVzY3JpcHRpb24gb2YgdGhlIHVzYWdlIHBsYW5cbiAgICAgKi9cbiAgICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBSYXRlIGxpbWl0IHBlciBzZWNvbmRcbiAgICAgKi9cbiAgICByYXRlTGltaXQ/OiBudW1iZXI7XG4gICAgLyoqXG4gICAgICogQnVyc3QgbGltaXRcbiAgICAgKi9cbiAgICBidXJzdExpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIFF1b3RhIGxpbWl0IHBlciBwZXJpb2RcbiAgICAgKi9cbiAgICBxdW90YUxpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIFF1b3RhIHBlcmlvZFxuICAgICAqL1xuICAgIHF1b3RhUGVyaW9kPzogUGVyaW9kO1xuICAgIC8qKlxuICAgICAqIEFQSSBrZXkgY29uZmlndXJhdGlvbiBmb3IgdGhpcyB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgYXBpS2V5cz86IElVc2FnZVBsYW5BcGlLZXlDb25maWc7XG59XG5cbmV4cG9ydCBjbGFzcyBBUElDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoQVBJQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBBUElDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gWyBWcGNDb25zdHJ1Y3QubmFtZSwgTWFpbGVyQ29uc3RydWN0Lm5hbWUsIER5bmFtb0RCQ29uc3RydWN0Lm5hbWUsIEF1dGhDb25zdHJ1Y3QubmFtZSwgUXVldWVDb25zdHJ1Y3QubmFtZSwgVG9waWNDb25zdHJ1Y3QubmFtZSwgTGF5ZXJDb25zdHJ1Y3QubmFtZSBdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBhcGkhOiBSZXN0QXBpO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuICAgIHVzYWdlUGxhbnM6IE1hcDxzdHJpbmcsIHsgcGxhbjogVXNhZ2VQbGFuOyBuYW1lOiBzdHJpbmcgfT4gPSBuZXcgTWFwKCk7XG4gICAgYXBpS2V5czogTWFwPHN0cmluZywgQXBpS2V5W10+ID0gbmV3IE1hcCgpO1xuICAgIGtleVZhbHVlczogTWFwPHN0cmluZywgQXBpS2V5PiA9IG5ldyBNYXAoKTtcblxuICAgIHByaXZhdGUgcmVzb3VyY2VzOiBJUmVzb3VyY2VbXSA9IFtdO1xuICAgIHByaXZhdGUgbWV0aG9kczogTWV0aG9kW10gPSBbXTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbnRyb2xsZXJTdGFja3MgPSBuZXcgTWFwPHN0cmluZywgeyBtZXRob2RzOiBNZXRob2RbXSwgcmVzb3VyY2VzOiBJUmVzb3VyY2VbXSwgY29udHJvbGxlcnNIYXNoOiBzdHJpbmdbXSB9PigpO1xuXG4gICAgLy8gZGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhcGlDb25zdHJ1Y3RDb25maWc6IElBUElDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgLy8gaHlkcmF0ZSB0aGUgY29uZmlnIG9iamVjdCB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlcyBleDogQVBJR0FURVdBWV9DT05UUk9MTEVSU1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhhcGlDb25zdHJ1Y3RDb25maWcsICdBUElHQVRFV0FZJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gc2V0IHRoZSBkZWZhdWx0IGFwaSBvcHRpb25zXG4gICAgICAgIGNvbnN0IHBhcmFtc0FwaTogTXV0YWJsZTxSZXN0QXBpUHJvcHM+ID0geyAuLi50aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlPcHRpb25zIHx8IHt9IH07XG4gICAgICAgIC8vIEVuYWJsZSBDT1JTIGlmIGRlZmluZWRcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiRW5hYmxpbmcgQ09SUy4uLiB0aGlzLmNvbmZpZy5jb3JzOiBcIiwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycyk7XG4gICAgICAgICAgICBwYXJhbXNBcGkuZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zID0gdGhpcy5nZXRDb3JzUHJlZmxpZ2h0T3B0aW9ucygpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lICYmIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGVDb25zdHJ1Y3QgPSBuZXcgQ2VydGlmaWNhdGVDb25zdHJ1Y3Qoe1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgY2VydGlmaWNhdGVBcm46IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNlcnRpZmljYXRlQXJuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNlcnRpZmljYXRlQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGUgPSBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5vdXRwdXRbIE91dHB1dFR5cGUuQ0VSVElGSUNBVEUgXVsgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSBdO1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRvbWFpbk5hbWUgPSB7XG4gICAgICAgICAgICAgICAgZG9tYWluTmFtZTogdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSxcbiAgICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZTogY2VydGlmaWNhdGUsXG4gICAgICAgICAgICAgICAgYmFzZVBhdGg6IHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zPy5zdGFnZU5hbWUgfHwgJy8nLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBmb3IgbXVsdGlzdGFjayBhcHBsaWNhdGlvbiwgc2V0IGRlcGxveSB0byBmYWxzZVxuICAgICAgICBpZiAodGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cCgpKSB7XG4gICAgICAgICAgICBwYXJhbXNBcGkuZGVwbG95ID0gZmFsc2U7XG4gICAgICAgICAgICBkZWxldGUgcGFyYW1zQXBpLmRlcGxveU9wdGlvbnM7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBBUEkgR2F0ZXdheS4uLiBcIik7XG4gICAgICAgIC8vIGdldCB0aGUgbWFpbiBzdGFjayBmcm9tIHRoZSBmcmFtZXdvcmtcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICAvLyBjcmVhdGUgdGhlIGFwaSBnYXRld2F5XG4gICAgICAgIHRoaXMuYXBpID0gbmV3IFJlc3RBcGkodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS1hcGlgLCB7XG4gICAgICAgICAgICAuLi5wYXJhbXNBcGksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKSB7XG4gICAgICAgICAgICBjb25zdCBjb3JzT3JpZ2lucyA9IHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKS5hbGxvd09yaWdpbnM/LmpvaW4oJywnKTtcbiAgICAgICAgICAgIHRoaXMuYXBpLmFkZEdhdGV3YXlSZXNwb25zZSgnZGVmYXVsdDR4eCcsIHtcbiAgICAgICAgICAgICAgICB0eXBlOiBSZXNwb25zZVR5cGUuREVGQVVMVF80WFgsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VIZWFkZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBgJyR7Y29yc09yaWdpbnN9J2AsXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLmFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ2RlZmF1bHQ1eHgnLCB7XG4gICAgICAgICAgICAgICAgdHlwZTogUmVzcG9uc2VUeXBlLkRFRkFVTFRfNVhYLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlSGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYCcke2NvcnNPcmlnaW5zfSdgLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHVwIHVzYWdlIHBsYW5zIGlmIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnM/Lmxlbmd0aCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwbGFuQ29uZmlnIG9mIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNldHVwVXNhZ2VQbGFuKHBsYW5Db25maWcpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5mdzI0LmFkZEFQSSh0aGlzLm5hbWUsICdyb290JywgdGhpcy5hcGksIGZhbHNlKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCAncmVzdEFQSScsIHRoaXMuYXBpLCBPdXRwdXRUeXBlLkFQSSwgJ3Jlc3RBcGlJZCcpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsICdyZXN0QVBJJywgdGhpcy5hcGksIE91dHB1dFR5cGUuQVBJLCAncmVzdEFwaVJvb3RSZXNvdXJjZUlkJyk7XG5cbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnNraXBDb250cm9sbGVycykge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5yZWdpc3RlckNvbnRyb2xsZXJzKCk7XG5cbiAgICAgICAgLy8gaWYgbXVsdGkvbmVzdGVkLXN0YWNrIHNldHVwLCB0aGVuIGNyZWF0ZSBvbmUgZGVwbG95bWVudCBwZXIgY29udHJvbGxlciBzdGFja1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBBUEktZ2F0ZXdheSBjb25zdHJ1Y3Q6ICR7dGhpcy5uYW1lfSBoYXMgaW1wb3J0ZWQgQVBJczogJHt0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKX1gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpICYmIHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVEZXBsb3ltZW50cygpO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZVNpbmdsZURlcGxveW1lbnQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0QVBJID0gKHN0YWNrTmFtZTogc3RyaW5nKTogSUFQSVJlZmVyZW5jZSA9PiB7XG4gICAgICAgIGxldCBjdXJyZW50QVBJID0gdGhpcy5mdzI0LmdldEFQSSh0aGlzLm5hbWUsICdyb290JykgYXMgSUFQSVJlZmVyZW5jZSB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBpZiB0aGUgc3RhY2sgaXMgbm90IHRoZSBtYWluIHN0YWNrIGFuZCBpdHMgYSBtdWx0aS1zdGFjayBhcHBsaWNhdGlvbiBvciBhIG5lc3RlZCBzdGFjaywgdGhlbiBpbXBvcnQgdGhlIEFQSVxuICAgICAgICBjb25zdCBjdXJyZW50U3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2soc3RhY2tOYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEN1cnJlbnQgU3RhY2s6ICR7Y3VycmVudFN0YWNrLnN0YWNrTmFtZX0gaXMgbmVzdGVkIHN0YWNrOiAke2N1cnJlbnRTdGFjayBpbnN0YW5jZW9mIE5lc3RlZFN0YWNrfWApO1xuICAgICAgICBpZiAodGhpcy5mdzI0LnVzZU11bHRpU3RhY2tTZXR1cChzdGFja05hbWUsIHRoaXMubWFpblN0YWNrKSB8fCBjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFjaykge1xuICAgICAgICAgICAgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCBzdGFja05hbWUpIGFzIElBUElSZWZlcmVuY2UgfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICBpZiAoIWN1cnJlbnRBUEkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRlZEFQSSA9IFJlc3RBcGkuZnJvbVJlc3RBcGlBdHRyaWJ1dGVzKGN1cnJlbnRTdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7c3RhY2tOYW1lfS1hcGlgLCB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3RBcGlJZDogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ3Jlc3RBUElfcmVzdEFwaUlkJywgJ2FwaScsIGN1cnJlbnRTdGFjayksXG4gICAgICAgICAgICAgICAgICAgIHJvb3RSZXNvdXJjZUlkOiB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgncmVzdEFQSV9yZXN0QXBpUm9vdFJlc291cmNlSWQnLCAnYXBpJywgY3VycmVudFN0YWNrKSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkQVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lLCBpbXBvcnRlZEFQSSwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCBzdGFja05hbWUpIGFzIElBUElSZWZlcmVuY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWN1cnJlbnRBUEkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQVBJIG5vdCBmb3VuZCBmb3Igc3RhY2s6ICR7c3RhY2tOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGN1cnJlbnRBUEk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyByZWdpc3RlckNvbnRyb2xsZXJzKCkge1xuICAgICAgICAvLyBzZXRzIHRoZSBkZWZhdWx0IGNvbnRyb2xsZXJzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBjb25zdCBjb250cm9sbGVyc0RpcmVjdG9yeSA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJzRGlyZWN0b3J5IHx8IFwiLi9zcmMvY29udHJvbGxlcnNcIjtcblxuICAgICAgICAvLyByZWdpc3RlciB0aGUgY29udHJvbGxlcnNcbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMoY29udHJvbGxlcnNEaXJlY3RvcnksIHRoaXMucmVnaXN0ZXJDb250cm9sbGVyKTtcblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlcyA9IHRoaXMuZncyNC5nZXRNb2R1bGVzKCk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgbW9kdWxlcyBcIiwgQXJyYXkuZnJvbShtb2R1bGVzLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgbW9kdWxlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkxvYWQgY29udHJvbGxlcnMgZnJvbSBtb2R1bGUgYmFzZS1wYXRoOiBcIiwgYmFzZVBhdGgpO1xuXG4gICAgICAgICAgICAgICAgSGVscGVyLnJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlKFxuICAgICAgICAgICAgICAgICAgICBtb2R1bGUsXG4gICAgICAgICAgICAgICAgICAgIChkZXNjOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4gdGhpcy5yZWdpc3RlckNvbnRyb2xsZXIoZGVzYywgbW9kdWxlKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgTk8gbW9kdWxlcyBcIik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWdpc3RlciBzeXN0ZW0gY29udHJvbGxlcnMgZnJvbSBmdzI0IHNpbmdsZXRvblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc1N5c3RlbUNvbnRyb2xsZXJzKCkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogcmVnaXN0ZXJpbmcgc3lzdGVtIGNvbnRyb2xsZXJzXCIpO1xuXG4gICAgICAgICAgICAvLyBDb3B5IHN5c3RlbSBjb250cm9sbGVycyB0byBhcHAgZGlzdCBhbmQgcmVnaXN0ZXIgZnJvbSB0aGVyZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb3B5QW5kUmVnaXN0ZXJTeXN0ZW1Db250cm9sbGVycygpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIE5PIHN5c3RlbSBjb250cm9sbGVyc1wiKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY29weUFuZFJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcnMoKSB7XG4gICAgICAgIGNvbnN0IHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICdkaXN0JywgJ3N5c3RlbS1jb250cm9sbGVycycpO1xuXG4gICAgICAgIC8vIEVuc3VyZSB0YXJnZXQgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIpKSB7XG4gICAgICAgICAgICBta2RpclN5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzeXN0ZW1Db250cm9sbGVyIG9mIHRoaXMuZncyNC5nZXRTeXN0ZW1Db250cm9sbGVycygpKSB7XG4gICAgICAgICAgICBsZXQgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayA9ICcnO1xuICAgICAgICAgICAgLy8gRmFsbGJhY2s6IHVzZSB0aGUgbGFzdCBmZXcgZGlyZWN0b3JpZXMgdG8gcHJlc2VydmUgc3RydWN0dXJlXG4gICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRoLnNwbGl0KCcvJyk7XG4gICAgICAgICAgICBjb25zdCByZWxldmFudFBhcnRzID0gcGF0aFBhcnRzLnNsaWNlKC0zKTsgLy8gZS5nLiwgWydzZWFyY2gnLCAnc3lzdGVtJywgJ3NlYXJjaC1jb250cm9sbGVyLmpzJ11cbiAgICAgICAgICAgIHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmsgPSByZWxldmFudFBhcnRzLmpvaW4oJy8nKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU3lzdGVtIGNvbnRyb2xsZXIgcmVsYXRpdmUgcGF0aDogJHtyZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrfWApO1xuXG4gICAgICAgICAgICBjb25zdCB0YXJnZXRGaWxlUGF0aCA9IHBhdGguam9pbihzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciwgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXREaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU3lzdGVtIGNvbnRyb2xsZXIgdGFyZ2V0LWRpcmVjdG9yeTogJHt0YXJnZXREaXJlY3Rvcnl9LCB0YXJnZXRGaWxlUGF0aDogJHt0YXJnZXRGaWxlUGF0aH1gKTtcblxuICAgICAgICAgICAgLy8gRW5zdXJlIHRhcmdldCBzdWJkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0RGlyZWN0b3J5KSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDb3B5IHRoZSBzeXN0ZW0gY29udHJvbGxlciBmaWxlXG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc3lzdGVtQ29udHJvbGxlci5maWxlUGF0aCwgdGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ29waWVkIHN5c3RlbSBjb250cm9sbGVyIGZyb20gJHtzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRofSB0byAke3RhcmdldEZpbGVQYXRofWApO1xuXG4gICAgICAgICAgICAvLyBSZWdpc3RlciBmcm9tIHRoZSBjb3BpZWQgbG9jYXRpb25cbiAgICAgICAgICAgIGNvbnN0IGRpcmVjdG9yeSA9IHBhdGguZGlybmFtZSh0YXJnZXRGaWxlUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgc3lzdGVtIGNvbnRyb2xsZXI6ICR7ZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKFxuICAgICAgICAgICAgICAgIGRpcmVjdG9yeSxcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcixcbiAgICAgICAgICAgICAgICBbIGZpbGVOYW1lIF1cbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKTogc3RyaW5nW10ge1xuICAgICAgICBsZXQgZW50cnlQYWNrYWdlcyA9IGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyB8fCBbXTtcblxuICAgICAgICBpZiAoaXNBcnJheShlbnRyeVBhY2thZ2VzKSkge1xuICAgICAgICAgICAgZW50cnlQYWNrYWdlcyA9IHtcbiAgICAgICAgICAgICAgICBvdmVycmlkZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgcGFja2FnZU5hbWVzOiBlbnRyeVBhY2thZ2VzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiB0aGUgY29udHJvbGxlciBkb2VzIG5vdCB3YW50IHRvIG92ZXJyaWRlIHRoZSBhcHBsaWNhdGlvbi9tb2R1bGUgZW50cnkgcGFja2FnZXMgYW5kIGluY2x1ZGUgdGhlbSBhcyB3ZWxsXG4gICAgICAgIGlmICghZW50cnlQYWNrYWdlcy5vdmVycmlkZSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlRW50cnlQYWNrYWdlcyA9IG93bmVyTW9kdWxlPy5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCkgfHwgW107XG4gICAgICAgICAgICBjb25zdCBhcHBFbnRyeVBhY2thZ2VzID0gdGhpcy5mdzI0LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKTtcbiAgICAgICAgICAgIGVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzID0gW1xuICAgICAgICAgICAgICAgIC4uLmVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzLFxuICAgICAgICAgICAgICAgIC4uLm1vZHVsZUVudHJ5UGFja2FnZXMsXG4gICAgICAgICAgICAgICAgLi4uYXBwRW50cnlQYWNrYWdlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRyeVBhY2thZ2VzLnBhY2thZ2VOYW1lcy5tYXAodGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSk7XG4gICAgfVxuXG5cbiAgICAvLyByZWdpc3RlciBhIHNpbmdsZSBjb250cm9sbGVyXG4gICAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlckNvbnRyb2xsZXIgPSBhc3luYyAoY29udHJvbGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKSA9PiB7XG4gICAgICAgIGNvbnN0IHsgaGFuZGxlckNsYXNzLCBmaWxlUGF0aCwgZmlsZU5hbWUgfSA9IGNvbnRyb2xsZXJJbmZvO1xuICAgICAgICAvLyBBZGQgdGhlIGZvbGRlciBwYXRoIGZyb20gZmlsZW5hbWUgdG8gdGhlIGNvbnRyb2xsZXIgbmFtZVxuICAgICAgICBjb25zdCBmb2xkZXJQYXRoID0gZmlsZU5hbWUuc3BsaXQoJy8nKS5zbGljZSgwLCAtMSkuam9pbignLycpO1xuICAgICAgICBjb25zdCBoYW5kbGVySW5zdGFuY2UgPSBuZXcgaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gZmlsZU5hbWUuaW5jbHVkZXMoJy8nKSA/IGZvbGRlclBhdGggKyAnLycgKyBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWUgOiBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnID0gaGFuZGxlckluc3RhbmNlPy5jb250cm9sbGVyQ29uZmlnIHx8IHt9O1xuICAgICAgICBjb25zdCBjb250cm9sbGVyU3RhY2tOYW1lID0gY29udHJvbGxlckNvbmZpZy5zdGFja05hbWUgfHwgY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IHBhcmVudFN0YWNrTmFtZSA9IGNvbnRyb2xsZXJDb25maWcucGFyZW50U3RhY2tOYW1lIHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU7XG5cbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBjb250cm9sbGVyIHN0YWNrIGluZm8gaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuY29udHJvbGxlclN0YWNrcy5oYXMoY29udHJvbGxlclN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5zZXQoY29udHJvbGxlclN0YWNrTmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGhvZHM6IFtdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW10sXG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGNvbnRyb2xsZXIgc3RhY2sgZXhpc3RzXG4gICAgICAgIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lLCBwYXJlbnRTdGFja05hbWUpO1xuICAgICAgICBjb250cm9sbGVySW5mby5yb3V0ZXMgPSBoYW5kbGVySW5zdGFuY2Uucm91dGVzO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyBjb250cm9sbGVyICR7Y29udHJvbGxlck5hbWV9YCk7XG5cbiAgICAgICAgLy8gcHJlcGFyZSB0aGUgZW50cnkgcGFja2FnZXMgZm9yIHRoZSBjb250cm9sbGVyJ3MgbGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXMgPSB0aGlzLnByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlKTtcbiAgICAgICAgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzID0gZW50cnlQYWNrYWdlcztcblxuICAgICAgICB0aGlzLnJlc291cmNlcyA9IFtdO1xuICAgICAgICB0aGlzLm1ldGhvZHMgPSBbXTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgcmVzb3VyY2UgZm9yIHRoZSBjb250cm9sbGVyIGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZUNvbnRyb2xsZXJSZXNvdXJjZShjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgbGV0IGNvbnRyb2xsZXJUYXJnZXQgPSBjb250cm9sbGVyQ29uZmlnLnRhcmdldDtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJJbnRlZ3JhdGlvbjogTGFtYmRhSW50ZWdyYXRpb24gfCBBd3NJbnRlZ3JhdGlvbiB8IHVuZGVmaW5lZDtcbiAgICAgICAgLy8gY3JlYXRlIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIGNvbnRyb2xsZXJcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJUYXJnZXQgPT09ICdmdW5jdGlvbicgfHwgY29udHJvbGxlclRhcmdldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgPSBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubG9nUmV0ZW50aW9uRGF5cztcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSA9IGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSB8fCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5sb2dSZW1vdmFsUG9saWN5O1xuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlckxhbWJkYSA9IHRoaXMuY3JlYXRlTGFtYmRhRnVuY3Rpb24oY29udHJvbGxlck5hbWUsIGZpbGVQYXRoLCBmaWxlTmFtZSwgY29udHJvbGxlckNvbmZpZywgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyTGFtYmRhLCBPdXRwdXRUeXBlLkZVTkNUSU9OKTtcblxuICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gbmV3IExhbWJkYUludGVncmF0aW9uKGNvbnRyb2xsZXJMYW1iZGEsIHtcbiAgICAgICAgICAgICAgICByZXN0QXBpOiB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGksXG4gICAgICAgICAgICAgICAgcGF0aDogY29udHJvbGxlck5hbWUsXG4gICAgICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5pbnRlZ3JhdGlvblRpbWVvdXQgfHwgMjkpLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGRlZmF1bHRBdXRob3JpemVyTmFtZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcywgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfSA9IHRoaXMuZXh0cmFjdERlZmF1bHRBdXRob3JpemVyKGNvbnRyb2xsZXJDb25maWcpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlciBDb250cm9sbGVyIH4gRGVmYXVsdCBBdXRob3JpemVyOiBuYW1lOiAke2RlZmF1bHRBdXRob3JpemVyTmFtZX0gLSB0eXBlOiAke2RlZmF1bHRBdXRob3JpemVyVHlwZX0gLSBncm91cHM6ICR7ZGVmYXVsdEF1dGhvcml6ZXJHcm91cHN9YCk7XG5cbiAgICAgICAgLy8gU2V0IHVwIEFQSSBrZXkgaWYgcmVxdWlyZWRcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb25maWcucmVxdWlyZUFwaUtleSkge1xuICAgICAgICAgICAgdGhpcy5zZXR1cFVzYWdlUGxhbih1bmRlZmluZWQsIHRydWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHVwIHJvdXRlcyBmb3IgdGhlIGNvbnRyb2xsZXJcbiAgICAgICAgZm9yIChjb25zdCByb3V0ZSBvZiBPYmplY3QudmFsdWVzKGNvbnRyb2xsZXJJbmZvLnJvdXRlcyA/PyB7fSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyByb3V0ZSAke3JvdXRlLmh0dHBNZXRob2R9ICR7cm91dGUucGF0aH1gKTtcbiAgICAgICAgICAgIGNvbnN0IHJvdXRlVGFyZ2V0ID0gcm91dGUudGFyZ2V0IHx8IGNvbnRyb2xsZXJUYXJnZXQ7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50UmVzb3VyY2UgPSB0aGlzLmdldE9yQ3JlYXRlUm91dGVSZXNvdXJjZShjb250cm9sbGVyUmVzb3VyY2UsIHJvdXRlLnBhdGgsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgY29uc3QgeyByb3V0ZUF1dGhvcml6ZXJOYW1lLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9ID0gdGhpcy5leHRyYWN0Um91dGVBdXRob3JpemVyKHJvdXRlLCBkZWZhdWx0QXV0aG9yaXplclR5cGUsIGRlZmF1bHRBdXRob3JpemVyTmFtZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyByb3V0ZSBBdXRob3JpemVyOiAke3JvdXRlQXV0aG9yaXplck5hbWV9IC0gJHtyb3V0ZUF1dGhvcml6ZXJUeXBlfSAtICR7cm91dGVBdXRob3JpemVyR3JvdXBzfWApO1xuXG4gICAgICAgICAgICBsZXQgbWV0aG9kT3B0aW9ucyA9IHRoaXMuY3JlYXRlTWV0aG9kT3B0aW9ucyhyb3V0ZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyTmFtZSwgY29udHJvbGxlckNvbmZpZyk7XG5cbiAgICAgICAgICAgIGlmIChyb3V0ZVRhcmdldCA9PT0gJ3F1ZXVlJykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJvdXRlLnBhdGgucmVwbGFjZSgnLycsICcnKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVySW50ZWdyYXRpb24gPSB0aGlzLmNyZWF0ZVNRU0ludGVncmF0aW9uKHF1ZXVlTmFtZSwgY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLm1ldGhvZE9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAocm91dGVUYXJnZXQgPT09ICd0b3BpYycpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3BpY05hbWUgPSByb3V0ZS5wYXRoLnJlcGxhY2UoJy8nLCAnJyk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gdGhpcy5jcmVhdGVTTlNJbnRlZ3JhdGlvbih0b3BpY05hbWUsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBtZXRob2RPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi5tZXRob2RPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IG1ldGhvZCA9IGN1cnJlbnRSZXNvdXJjZS5hZGRNZXRob2Qocm91dGUuaHR0cE1ldGhvZCwgY29udHJvbGxlckludGVncmF0aW9uLCBtZXRob2RPcHRpb25zKTtcbiAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKG1ldGhvZCk7XG5cbiAgICAgICAgICAgIC8vIGlmIGF1dGhvcml6ZXIgaXMgQVdTX0lBTSwgdGhlbiBhZGQgdGhlIHJvdXRlIHRvIHRoZSBwb2xpY3lcbiAgICAgICAgICAgIGlmIChyb3V0ZUF1dGhvcml6ZXJUeXBlID09PSAnQVdTX0lBTScpIHtcbiAgICAgICAgICAgICAgICBsZXQgZnVsbFJvdXRlUGF0aCA9IGNvbnRyb2xsZXJOYW1lICsgcm91dGUucGF0aDtcblxuICAgICAgICAgICAgICAgIC8vICogcmVwbGFjZSBlYWNoIHBhcmFtIHBsYWNlaG9sZGVyIGB7aWR9YCB3aXRoIGFuIGAqYFxuICAgICAgICAgICAgICAgIHJvdXRlLnBhcmFtZXRlcnM/LmZvckVhY2gocGFyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZnVsbFJvdXRlUGF0aCA9IGZ1bGxSb3V0ZVBhdGgucmVwbGFjZShgeyR7cGFyfX1gLCAnKicpO1xuICAgICAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkUm91dGVUb1JvbGVQb2xpY3koZnVsbFJvdXRlUGF0aCwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8ga2VlcCB0cmFjayBvZiB0aGUgY29udHJvbGxlciBzdGFja3Mgd2l0aCBtZXRob2RzIGFuZCByZXNvdXJjZXMgaW4gYSBtdWx0aS1zdGFjayBzZXR1cCB0byBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2tcbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFja0luZm8gPSB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZ2V0KGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgaWYgKHN0YWNrSW5mbykge1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5tZXRob2RzID0gWyAuLi50aGlzLm1ldGhvZHMgXTtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8ucmVzb3VyY2VzID0gWyAuLi50aGlzLnJlc291cmNlcyBdO1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5jb250cm9sbGVyc0hhc2gucHVzaChjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoY29udHJvbGxlckNvbmZpZykpLmRpZ2VzdCgnaGV4JykpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gb3V0cHV0IHRoZSBhcGkgZW5kcG9pbnRcbiAgICAgICAgdGhpcy5vdXRwdXRBcGlFbmRwb2ludChjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclJlc291cmNlLCB0aGlzLmdldFN0YWdlTmFtZSgpLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldFN0YWdlTmFtZSA9ICgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaU9wdGlvbnM/LmRlcGxveU9wdGlvbnM/LnN0YWdlTmFtZSB8fCAncHJvZCc7XG4gICAgfVxuXG4gICAgLy8gaWYgdGhlIEFQSSBpcyBpbXBvcnRlZCwgdGhlbiBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2sgYW5kIGFkZCBtZXRob2QgYW5kIHJlc291cmNlIGFzIGRlcGVuZGVuY3lcbiAgICAvLyBUaGlzIGlzIG5lZWRlZCBiZWNhdXNlIGltcG9ydGVkIEFQSSBkb2VzIG5vdCBwcm9wb2dhdGUgQ09SUyBzZXR0aW5ncyB0byB0aGUgbWV0aG9kc1xuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlRGVwbG95bWVudHMoKSB7XG5cbiAgICAgICAgY29uc3Qgc3RhZ2VOYW1lID0gdGhpcy5nZXRTdGFnZU5hbWUoKTtcbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzLCBjb250cm9sbGVyc0hhc2ggfSBdIG9mIHRoaXMuY29udHJvbGxlclN0YWNrcy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIC8vIFRPRE86IGFkZCBiZXR0ZXIgbG9naWMgdG8gZm9yY2UgYSBkZXBsb3ltZW50IHdoZW4gdGhlcmUgaXMgYSBjaGFuZ2UgaW4gZnJhbWV3b3JrIGNvZGVcbiAgICAgICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyc0hhc2gucHVzaChyYW5kb21VVUlEKCkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjb250cm9sbGVySGFzaCA9IGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShKU09OLnN0cmluZ2lmeShjb250cm9sbGVyc0hhc2gpKS5kaWdlc3QoJ2hleCcpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGRlcGxveW1lbnQgZm9yIGNvbnRyb2xsZXIgc3RhY2sgJHtjb250cm9sbGVyU3RhY2tOYW1lfSB3aXRoIGhhc2ggJHtjb250cm9sbGVySGFzaH1gKTtcbiAgICAgICAgICAgIGNvbnN0IGRlcGxveW1lbnQgPSBuZXcgRGVwbG95bWVudCh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGBkZXBsb3ltZW50LSR7Y29udHJvbGxlckhhc2h9YCwge1xuICAgICAgICAgICAgICAgIGFwaTogdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSkuYXBpLFxuICAgICAgICAgICAgICAgIHN0YWdlTmFtZTogc3RhZ2VOYW1lLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgbWV0aG9kIG9mIG1ldGhvZHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIG1ldGhvZCBkZXBlbmRlbmN5ICR7bWV0aG9kLmh0dHBNZXRob2R9ICR7bWV0aG9kLnJlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShtZXRob2QpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGFkZCBkZXBlbmRlY3kgb24gYWxsIHJlc291cmNlcyBmb3IgdGhpcyBjb250cm9sbGVyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgcmVzb3VyY2UgZGVwZW5kZW5jeSAke3Jlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGlmIHRoZSBhcGkgaXMgaW1wb3J0ZWQgYW5kIGl0J3Mgbm90IGEgbXVsdGktc3RhY2sgc2V0dXAsIHRoZW4gY3JlYXRlIGEgc2luZ2xlIGRlcGxveW1lbnQgZm9yIGFsbCBjb250cm9sbGVyc1xuICAgIC8vIFNpbmdsZSBkZXBsb3ltZW50IGlzIG5lZWRlZCB0byBhdm9pZCBzaW11bHRhdGlvbiBkZXBsb3ltZW50IHdoaWNoIGNhdXNlcyBlcnJvciBvbiBBUEkgR2F0ZXdheVxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlU2luZ2xlRGVwbG95bWVudCgpIHtcbiAgICAgICAgY29uc3Qgc3RhZ2VOYW1lID0gdGhpcy5nZXRTdGFnZU5hbWUoKTtcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZvcmNlRGVwbG95bWVudCkge1xuICAgICAgICAgICAgdGhpcy5jb250cm9sbGVyU3RhY2tzLmZvckVhY2goYyA9PiBjLmNvbnRyb2xsZXJzSGFzaC5wdXNoKHJhbmRvbVVVSUQoKSkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSB0aGUgbmFtZSBmcm9tIGFsbCB0aGUgY29udHJvbGxlciBoYXNoIHZhbHVlcyBjb21iaW5lZCBhcyBhIHNpbmdsZSBoYXNoIGFuZCBhZGQgZGVwZW5kZW5jeSBvbiBhbGwgdGhlIGNvbnRyb2xsZXJzXG4gICAgICAgIGNvbnN0IGRlcGxveW1lbnROYW1lID0gYGRlcGxveW1lbnQtJHtjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoQXJyYXkuZnJvbSh0aGlzLmNvbnRyb2xsZXJTdGFja3MudmFsdWVzKCkpLm1hcChjID0+IGMuY29udHJvbGxlcnNIYXNoKS5qb2luKCctJykpLmRpZ2VzdCgnaGV4Jyl9YDtcblxuICAgICAgICBjb25zdCBkZXBsb3ltZW50ID0gbmV3IERlcGxveW1lbnQodGhpcy5mdzI0LmdldFN0YWNrKHRoaXMubmFtZSksIGRlcGxveW1lbnROYW1lLCB7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgICAgICAgc3RhZ2VOYW1lOiBzdGFnZU5hbWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBfY29udHJvbGxlclN0YWNrTmFtZSwgeyBtZXRob2RzLCByZXNvdXJjZXMgfSBdIG9mIHRoaXMuY29udHJvbGxlclN0YWNrcy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgbWV0aG9kIG9mIG1ldGhvZHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIG1ldGhvZCBkZXBlbmRlbmN5ICR7bWV0aG9kLmh0dHBNZXRob2R9ICR7bWV0aG9kLnJlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShtZXRob2QpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyByZXNvdXJjZSBkZXBlbmRlbmN5ICR7cmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KHJlc291cmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTogQ29yc09wdGlvbnMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcbiAgICAgICAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIixcbiAgICAgICAgICAgICAgICBcIlgtQXBpLUtleVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotRGF0ZVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotQ29udGVudC1TaGEyNTZcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LVNlY3VyaXR5LVRva2VuXCIsXG4gICAgICAgICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFsc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIsXG4gICAgICAgICAgICAgICAgXCJJbXBlcnNvbmF0aW5nLVVzZXItU3ViXCIsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWxsb3dNZXRob2RzOiBbIFwiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiIF0sXG4gICAgICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxuICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiB0aGlzLmdldENvcnNPcmlnaW5zKCksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRDb3JzT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSB0cnVlKSByZXR1cm4gQ29ycy5BTExfT1JJR0lOUztcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSBcInN0cmluZ1wiKSByZXR1cm4gWyB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIF07XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIHx8IFtdO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0T3JDcmVhdGVDb250cm9sbGVyUmVzb3VyY2UgPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogSVJlc291cmNlID0+IHtcbiAgICAgICAgbGV0IHJlc3RBUEkgPSB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJSZXNvdXJjZTogSVJlc291cmNlID0gcmVzdEFQSS5hcGkucm9vdDtcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBjb250cm9sbGVyTmFtZS5zcGxpdCgnLycpO1xuICAgICAgICBmb3IgKGNvbnN0IHBhdGhQYXJ0IG9mIHBhdGhQYXJ0cykge1xuICAgICAgICAgICAgbGV0IGNoaWxkUmVzb3VyY2UgPSBjb250cm9sbGVyUmVzb3VyY2UuZ2V0UmVzb3VyY2UocGF0aFBhcnQpIGFzIElSZXNvdXJjZTtcbiAgICAgICAgICAgIC8vIGlmIGl0J3MgYSBuZXN0ZWQgY29udHJvbGxlciwgdGhlIHJvb3QgcmVzb3VyY2UgbWF5IG5vdCBiZSBjcmVhdGVkIGluIGFub3RoZXIgc3RhY2tcbiAgICAgICAgICAgIGNvbnN0IGlzTmVzdGVkQ29udHJvbGxlciA9IHBhdGhQYXJ0cy5sZW5ndGggPiAxO1xuICAgICAgICAgICAgaWYgKCFjaGlsZFJlc291cmNlICYmIGlzTmVzdGVkQ29udHJvbGxlciAmJiBwYXRoUGFydCA9PT0gcGF0aFBhcnRzWyAwIF0pIHtcbiAgICAgICAgICAgICAgICAvLyB0cnkgdG8gZ2V0IHRoZSByb290IHJlc291cmNlIGZyb20gdGhlIGZ3MjQgb3V0cHV0XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEdldHRpbmcgY29udHJvbGxlciByZXNvdXJjZSBmb3IgJHtwYXRoUGFydH0gZnJvbSBmdzI0IG91dHB1dGApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJSZXNvdXJjZUlkID0gdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoYHJlc3RBUElfY29udHJvbGxlcl8ke3BhdGhQYXJ0fV9yZXNvdXJjZUlkYCwgJ3Jlc291cmNlJywgY3VycmVudFN0YWNrKTtcbiAgICAgICAgICAgICAgICBpZiAoY29udHJvbGxlclJlc291cmNlSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENvbnRyb2xsZXIgcmVzb3VyY2UgZm9yICR7cGF0aFBhcnR9IGZvdW5kIGluIGZ3MjQgb3V0cHV0OiAke2NvbnRyb2xsZXJSZXNvdXJjZUlkfWApO1xuICAgICAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gUmVzb3VyY2UuZnJvbVJlc291cmNlQXR0cmlidXRlcyhjdXJyZW50U3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2NvbnRyb2xsZXJTdGFja05hbWV9LSR7cGF0aFBhcnR9YCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VJZDogY29udHJvbGxlclJlc291cmNlSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXN0QXBpOiByZXN0QVBJLmFwaSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6ICcvJyArIHBhdGhQYXJ0XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghY2hpbGRSZXNvdXJjZSkge1xuICAgICAgICAgICAgICAgIC8vIGZvciBuZXN0ZWQgcmVzb3VyY2VzIGFkZCAvIHRvIHRoZSBwYXRoXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGNvbnRyb2xsZXIgcmVzb3VyY2UgZm9yIHBhdGggJHtwYXRoUGFydH0gdW5kZXIgJHtjb250cm9sbGVyUmVzb3VyY2UucGF0aH1gKTtcbiAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gY29udHJvbGxlclJlc291cmNlLmFkZFJlc291cmNlKHBhdGhQYXJ0KSBhcyBJUmVzb3VyY2U7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoaXNOZXN0ZWRDb250cm9sbGVyICYmIHBhdGhQYXJ0ID09PSBwYXRoUGFydHNbIDAgXSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU2V0dGluZyBvdXRwdXQgZm9yIGNvbnRvcmxsZXIgcmVzb3VyY2UgJHtjb250cm9sbGVyU3RhY2tOYW1lfSBwYXRoICR7cGF0aFBhcnR9YCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYHJlc3RBUElfY29udHJvbGxlcl8ke3BhdGhQYXJ0fWAsIGNoaWxkUmVzb3VyY2UsIE91dHB1dFR5cGUuUkVTT1VSQ0UsICdyZXNvdXJjZUlkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udHJvbGxlclJlc291cmNlID0gY2hpbGRSZXNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjb250cm9sbGVyUmVzb3VyY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVMYW1iZGFGdW5jdGlvbiA9IChjb250cm9sbGVyTmFtZTogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogTm9kZWpzRnVuY3Rpb24gPT4ge1xuICAgICAgICBjb25zdCBmdW5jdGlvblByb3BzID0gbWVyZ2UoW1xuICAgICAgICAgICAgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcyA/PyB7fSxcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWc/LmZ1bmN0aW9uUHJvcHMgPz8ge31cbiAgICAgICAgXSkhO1xuXG4gICAgICAgIGNvbnN0IGVudlZhcmlhYmxlcyA9IHRoaXMuZncyNC5yZXNvbHZlRW52VmFyaWFibGVzKGNvbnRyb2xsZXJDb25maWcuZW52LCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpO1xuXG4gICAgICAgIC8vIGRvIG5vdCBvdmVycmlkZSB0aGUgZW50cnkgcGFja2FnZXMgaWYgYWxyZWFkeSBzZXRcbiAgICAgICAgaWYgKCEoRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMgaW4gZW52VmFyaWFibGVzKSAmJiBjb250cm9sbGVyQ29uZmlnLmVudHJ5UGFja2FnZXMpIHtcbiAgICAgICAgICAgIGVudlZhcmlhYmxlc1sgRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMgXSA9IChjb250cm9sbGVyQ29uZmlnLmVudHJ5UGFja2FnZXMgYXMgQXJyYXk8c3RyaW5nPikuam9pbignLCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGNvbnRyb2xsZXJOYW1lICsgXCItY29udHJvbGxlclwiLCB7XG4gICAgICAgICAgICBlbnRyeTogZmlsZVBhdGggKyBcIi9cIiArIGZpbGVOYW1lLFxuICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IGVudlZhcmlhYmxlcyxcbiAgICAgICAgICAgIHBvbGljaWVzOiBjb250cm9sbGVyQ29uZmlnPy5wb2xpY2llcyxcbiAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiBjb250cm9sbGVyQ29uZmlnPy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiBjb250cm9sbGVyQ29uZmlnPy5mdW5jdGlvblRpbWVvdXQgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmZ1bmN0aW9uVGltZW91dCxcbiAgICAgICAgICAgIHByb2Nlc3NvckFyY2hpdGVjdHVyZTogY29udHJvbGxlckNvbmZpZz8ucHJvY2Vzc29yQXJjaGl0ZWN0dXJlLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczogZnVuY3Rpb25Qcm9wcyxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IGNvbnRyb2xsZXJDb25maWcubG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSxcbiAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBleHRyYWN0RGVmYXVsdEF1dGhvcml6ZXIgPSAoY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWdXaXRoQXV0aG9yaXplcik6IHsgZGVmYXVsdEF1dGhvcml6ZXJOYW1lOiBzdHJpbmcsIGRlZmF1bHRBdXRob3JpemVyVHlwZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBib29sZWFuIH0gPT4ge1xuICAgICAgICBsZXQgZGVmYXVsdEF1dGhvcml6ZXJOYW1lID0gdGhpcy5mdzI0LmdldERlZmF1bHRDb2duaXRvQXV0aG9yaXplck5hbWUoKTtcbiAgICAgICAgbGV0IGRlZmF1bHRBdXRob3JpemVyVHlwZTtcbiAgICAgICAgbGV0IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzO1xuICAgICAgICBsZXQgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBmYWxzZTtcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjb250cm9sbGVyQ29uZmlnPy5hdXRob3JpemVyKSkge1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEF1dGhvcml6ZXIgPSAoY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyIGFzIElBdXRob3JpemVyQ29uZmlnW10pLmZpbmQoKGF1dGgpID0+IGF1dGguZGVmYXVsdCkgfHwgY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyWyAwIF07XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSBkZWZhdWx0QXV0aG9yaXplci5uYW1lIHx8IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IGRlZmF1bHRBdXRob3JpemVyLnR5cGU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyLmdyb3VwcyB8fCBbXTtcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gZGVmYXVsdEF1dGhvcml6ZXIucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJOYW1lID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLm5hbWUgfHwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLnR5cGU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplci5ncm91cHMgfHwgW107XG4gICAgICAgICAgICBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGNvbnRyb2xsZXJDb25maWcucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IGNvbnRyb2xsZXJDb25maWcuYXV0aG9yaXplcjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZGVmYXVsdEF1dGhvcml6ZXJUeXBlICYmIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGUpIHtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyVHlwZSA9IHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QXV0aG9yaXphdGlvblR5cGU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpIHtcblxuICAgICAgICAgICAgLy8gaWYgdGhlIHZhbHVlIGZvciB0aGUgZ3JvdXBzIGlzIGEgdGVtcGxhdGUgc3RyaW5nLCBcbiAgICAgICAgICAgIC8vIHJlc29sdmUgaXQgW3doZW4gdGhlIGFwcGxpY2F0aW9uIHdhbnQgdG8gYWxsb3cgbXVsdGlwbGUgdXNlciBncm91cHMgdG8gaGF2ZSBhY2Nlc3NdXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFwiZW52Onh4eDpncm91cDFcIiA9PT4gXCJncm91cDEtcmVzb2x2ZWRcIiB8fCBcImdyb3VwMSxncm91cDJcIiB8fCBcImVudjp4eHg6Z3JvdXAxLGVudjp4eHg6Z3JvdXAyXCJcbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhkZWZhdWx0QXV0aG9yaXplckdyb3VwcykpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IHRoaXMuZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBub3cgaWYgdGhlIHJlc29sdmVkIHZhbHVlIGlzIGFnYWluIGEgc3RyaW5nLCBzcGxpdCBpdCBieSBjb21tYVxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgdmFsdWUgaXMgbGlrZSBcImdyb3VwMSxncm91cDJcIiA9PT4gW1wiZ3JvdXAxXCIsIFwiZ3JvdXAyXCJdXG4gICAgICAgICAgICBpZiAoaXNTdHJpbmcoZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMpKSB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplckdyb3Vwcy5zcGxpdCgnLCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIWRlZmF1bHRBdXRob3JpemVyR3JvdXBzLmxlbmd0aCAmJiB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEFkbWluR3JvdXBzKSB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZGVmYXVsdEFkbWluR3JvdXBzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyByZXNvbHZlIHRoZSBncm91cCBuYW1lcyBmcm9tIGZ3MjQtc2NvcGUgaWYgaXQncyBhIHRlbXBsYXRlXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFtcImVudjp4eHg6Z3JvdXAxXCIsXCJlbnY6eHh4Omdyb3VwMlwiXSA9PT4gW1wiZ3JvdXAxLXJlc29sdmVkXCIsIFwiZ3JvdXAyLXJlc29sdmVkXCJdXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IChkZWZhdWx0QXV0aG9yaXplckdyb3VwcyBhcyBBcnJheTxzdHJpbmc+KS5tYXAodGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSk7XG5cbiAgICAgICAgICAgIC8vIGZsYXQtbWFwIHRoZSBncm91cHMgaWYgdGhleSByZXNvbHZlZCBncm91cCB2YWx1ZXMgYXJlIGFnYWluIGNvbW1hIHNlcGFyYXRlZFxuICAgICAgICAgICAgLy8gd2hlbiB0aGUgcmVzb2x2ZWQgdmFsdWUgaXMgbGlrZSBbXCJhLGJcIiwgXCJjLGRcIl0gPT0+IFtcImFcIiwgXCJiXCIsIFwiY1wiLCBcImRcIl1cbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMuZmxhdE1hcChncm91cCA9PiBncm91cC5zcGxpdCgnLCcpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEVuc3VyZSBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyBpcyBhbHdheXMgYW4gYXJyYXlcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZEdyb3Vwczogc3RyaW5nW10gPSAhZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgXG4gICAgICAgICAgICA/IFtdIFxuICAgICAgICAgICAgOiBBcnJheS5pc0FycmF5KGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSBcbiAgICAgICAgICAgICAgICA/IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzIFxuICAgICAgICAgICAgICAgIDogW2RlZmF1bHRBdXRob3JpemVyR3JvdXBzXTtcblxuICAgICAgICByZXR1cm4geyBcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyTmFtZSwgXG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUsIFxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IG5vcm1hbGl6ZWRHcm91cHMsIFxuICAgICAgICAgICAgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRPckNyZWF0ZVJvdXRlUmVzb3VyY2UgPSAocGFyZW50UmVzb3VyY2U6IElSZXNvdXJjZSwgcGF0aDogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBJUmVzb3VyY2UgPT4ge1xuICAgICAgICBsZXQgY3VycmVudFJlc291cmNlOiBJUmVzb3VyY2UgPSBwYXJlbnRSZXNvdXJjZTtcbiAgICAgICAgY29uc3QgcmVzdEFQSSA9IHRoaXMuZ2V0QVBJKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGF0aFBhcnQgb2YgcGF0aC5zcGxpdChcIi9cIikpIHtcbiAgICAgICAgICAgIGlmIChwYXRoUGFydCA9PT0gXCJcIikge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBsZXQgY2hpbGRSZXNvdXJjZSA9IGN1cnJlbnRSZXNvdXJjZS5nZXRSZXNvdXJjZShwYXRoUGFydCk7XG4gICAgICAgICAgICBpZiAoIWNoaWxkUmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBjaGlsZFJlc291cmNlID0gY3VycmVudFJlc291cmNlLmFkZFJlc291cmNlKHBhdGhQYXJ0KTtcbiAgICAgICAgICAgICAgICBpZiAocmVzdEFQSS5pc0ltcG9ydGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvcnNQcmVmbGlnaHRNZXRob2QgPSBjaGlsZFJlc291cmNlLmFkZENvcnNQcmVmbGlnaHQodGhpcy5nZXRDb3JzUHJlZmxpZ2h0T3B0aW9ucygpKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5tZXRob2RzLnB1c2goY29yc1ByZWZsaWdodE1ldGhvZCk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzb3VyY2VzLnB1c2goY2hpbGRSZXNvdXJjZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY3VycmVudFJlc291cmNlID0gY2hpbGRSZXNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjdXJyZW50UmVzb3VyY2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBleHRyYWN0Um91dGVBdXRob3JpemVyID0gKHJvdXRlOiBJUm91dGVXaXRoQXV0aG9yaXplciwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIGRlZmF1bHRBdXRob3JpemVyTmFtZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBib29sZWFuKTogeyByb3V0ZUF1dGhvcml6ZXJOYW1lOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplclR5cGU6IHN0cmluZywgcm91dGVBdXRob3JpemVyR3JvdXBzOiBzdHJpbmdbXSwgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnOiBib29sZWFuIH0gPT4ge1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyTmFtZSA9IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplclR5cGUgPSBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplckdyb3VwcztcbiAgICAgICAgbGV0IHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuXG4gICAgICAgIGlmIChyb3V0ZS5hdXRob3JpemVyICYmIHR5cGVvZiByb3V0ZS5hdXRob3JpemVyID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyVHlwZSA9IHJvdXRlLmF1dGhvcml6ZXIudHlwZSB8fCBkZWZhdWx0QXV0aG9yaXplclR5cGU7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJOYW1lID0gcm91dGUuYXV0aG9yaXplci5uYW1lIHx8IGRlZmF1bHRBdXRob3JpemVyTmFtZTtcbiAgICAgICAgICAgIGNvbnN0IHJvdXRlR3JvdXBzID0gcm91dGUuYXV0aG9yaXplci5ncm91cHMgfHwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJHcm91cHMgPSAhcm91dGVHcm91cHMgXG4gICAgICAgICAgICAgICAgPyBbXSBcbiAgICAgICAgICAgICAgICA6IEFycmF5LmlzQXJyYXkocm91dGVHcm91cHMpIFxuICAgICAgICAgICAgICAgICAgICA/IHJvdXRlR3JvdXBzIFxuICAgICAgICAgICAgICAgICAgICA6IFtyb3V0ZUdyb3Vwc107XG4gICAgICAgICAgICByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSByb3V0ZS5hdXRob3JpemVyLnJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfHwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHJvdXRlLmF1dGhvcml6ZXIgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJUeXBlID0gcm91dGUuYXV0aG9yaXplcjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7IHJvdXRlQXV0aG9yaXplck5hbWUsIHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplckdyb3Vwcywgcm91dGVSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVNZXRob2RPcHRpb25zID0gKHJvdXRlOiBJUm91dGVXaXRoQXV0aG9yaXplciwgcm91dGVBdXRob3JpemVyVHlwZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQsIGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnKTogTWV0aG9kT3B0aW9ucyA9PiB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RQYXJhbWV0ZXJzOiB7IFsga2V5OiBzdHJpbmcgXTogYm9vbGVhbiB9ID0ge307XG5cbiAgICAgICAgLy8gQWRkIHBhdGggcGFyYW1ldGVyc1xuICAgICAgICBmb3IgKGNvbnN0IHBhcmFtIG9mIHJvdXRlLnBhcmFtZXRlcnMgfHwgW10pIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzWyBgbWV0aG9kLnJlcXVlc3QucGF0aC4ke3BhcmFtfWAgXSA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgQVBJIGtleSBoZWFkZXIgcmVxdWlyZW1lbnQgaWYgc3BlY2lmaWVkXG4gICAgICAgIGlmIChjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkpIHtcbiAgICAgICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzWyAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLngtYXBpLWtleScgXSA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJZiB0aGUgYXV0aG9yaXplciBpcyBKV1QsIGNvbnZlcnQgaXQgdG8gQ1VTVE9NXG4gICAgICAgIGNvbnN0IGF1dGhvcml6ZXIgPSB0aGlzLmZ3MjQuZ2V0QXV0aG9yaXplcihyb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJOYW1lKTtcbiAgICAgICAgaWYgKHJvdXRlQXV0aG9yaXplclR5cGUgPT09ICdKV1QnKSB7XG4gICAgICAgICAgICByb3V0ZUF1dGhvcml6ZXJUeXBlID0gJ0NVU1RPTSc7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnMsXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogcm91dGVBdXRob3JpemVyVHlwZSBhcyBBdXRob3JpemF0aW9uVHlwZSxcbiAgICAgICAgICAgIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIsXG4gICAgICAgICAgICBhcGlLZXlSZXF1aXJlZDogY29udHJvbGxlckNvbmZpZy5yZXF1aXJlQXBpS2V5IHx8IGZhbHNlXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVTUVNJbnRlZ3JhdGlvbiA9IChxdWV1ZU5hbWU6IHN0cmluZywgY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogQXdzSW50ZWdyYXRpb24gPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3JlYXRpbmcgU1FTIGludGVncmF0aW9uIGZvciBxdWV1ZSAke3F1ZXVlTmFtZX0gaW4gY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfSBpbiBzdGFjayAke2NvbnRyb2xsZXJTdGFja05hbWV9YCk7XG4gICAgICAgIGNvbnN0IGludGVncmF0aW9uUm9sZSA9IG5ldyBSb2xlKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7cXVldWVOYW1lfS1zcXMtaW50ZWdyYXRpb24tcm9sZWAsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBxdWV1ZUFybiA9IHRoaXMuZncyNC5nZXRBcm4oJ3NxcycsIHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpKSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlSW5zdGFuY2UgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHtxdWV1ZU5hbWV9LXF1ZXVlYCwgcXVldWVBcm4pO1xuICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50U2VuZE1lc3NhZ2VzKGludGVncmF0aW9uUm9sZSk7XG4gICAgICAgIHJldHVybiBuZXcgQXdzSW50ZWdyYXRpb24oe1xuICAgICAgICAgICAgc2VydmljZTogXCJzcXNcIixcbiAgICAgICAgICAgIHBhdGg6IHRoaXMuZncyNC5nZXRDb25maWcoKS5hY2NvdW50ICsgXCIvXCIgKyBxdWV1ZUluc3RhbmNlLnF1ZXVlTmFtZSxcbiAgICAgICAgICAgIGludGVncmF0aW9uSHR0cE1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY3JlZGVudGlhbHNSb2xlOiBpbnRlZ3JhdGlvblJvbGUsXG4gICAgICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJpbnRlZ3JhdGlvbi5yZXF1ZXN0LmhlYWRlci5Db250ZW50LVR5cGVcIjogXCInYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJ1wiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVxdWVzdFRlbXBsYXRlczoge1xuICAgICAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL2pzb25cIjogYEFjdGlvbj1TZW5kTWVzc2FnZSZNZXNzYWdlQm9keT0kdXRpbC51cmxFbmNvZGUoJGlucHV0LmJvZHkpYCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlU05TSW50ZWdyYXRpb24gPSAodG9waWNOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJTdGFja05hbWU6IHN0cmluZyk6IEF3c0ludGVncmF0aW9uID0+IHtcbiAgICAgICAgY29uc3QgaW50ZWdyYXRpb25Sb2xlID0gbmV3IFJvbGUodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHt0b3BpY05hbWV9LXNucy1pbnRlZ3JhdGlvbi1yb2xlYCwge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHRvcGljQXJuID0gdGhpcy5mdzI0LmdldEFybignc25zJywgdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUodG9waWNOYW1lICsgJ190b3BpY05hbWUnLCAndG9waWMnLCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpKTtcbiAgICAgICAgY29uc3QgdG9waWNJbnN0YW5jZSA9IFRvcGljLmZyb21Ub3BpY0Fybih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3RvcGljTmFtZX0tdG9waWNgLCB0b3BpY0Fybik7XG4gICAgICAgIHRvcGljSW5zdGFuY2UuZ3JhbnRQdWJsaXNoKGludGVncmF0aW9uUm9sZSk7XG4gICAgICAgIHJldHVybiBuZXcgQXdzSW50ZWdyYXRpb24oe1xuICAgICAgICAgICAgc2VydmljZTogXCJzbnNcIixcbiAgICAgICAgICAgIHBhdGg6ICcvJyxcbiAgICAgICAgICAgIGludGVncmF0aW9uSHR0cE1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY3JlZGVudGlhbHNSb2xlOiBpbnRlZ3JhdGlvblJvbGUsXG4gICAgICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJpbnRlZ3JhdGlvbi5yZXF1ZXN0LmhlYWRlci5Db250ZW50LVR5cGVcIjogXCInYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJ1wiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcmVxdWVzdFRlbXBsYXRlczoge1xuICAgICAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL2pzb25cIjogYEFjdGlvbj1QdWJsaXNoJlRvcGljQXJuPSR1dGlsLnVybEVuY29kZSgnJHt0b3BpY0luc3RhbmNlLnRvcGljQXJufScpJk1lc3NhZ2U9JHV0aWwudXJsRW5jb2RlKCRpbnB1dC5ib2R5KWAsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dEFwaUVuZHBvaW50ID0gKGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJSZXNvdXJjZTogSVJlc291cmNlLCBzdGFnZU5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgRW5kcG9pbnQke2NvbnRyb2xsZXJOYW1lfWAsIHtcbiAgICAgICAgICAgIHZhbHVlOiAnaHR0cHM6Ly8nICsgdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSkuYXBpLnJlc3RBcGlJZCArICcuZXhlY3V0ZS1hcGkuJyArIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKS5yZWdpb24gKyAnLmFtYXpvbmF3cy5jb20vJyArIHN0YWdlTmFtZSArICcvJyArIGNvbnRyb2xsZXJSZXNvdXJjZS5wYXRoLnNsaWNlKDEpLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQVBJIEdhdGV3YXkgRW5kcG9pbnQgZm9yIFwiICsgY29udHJvbGxlck5hbWUsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2V0dXBVc2FnZVBsYW4ocGxhbkNvbmZpZz86IElVc2FnZVBsYW5Db25maWcsIGNyZWF0ZUtleTogYm9vbGVhbiA9IGZhbHNlKTogeyBwbGFuOiBVc2FnZVBsYW47IG5hbWU6IHN0cmluZyB9IHtcbiAgICAgICAgLy8gSWYgbm8gcGxhbiBjb25maWcgaXMgcHJvdmlkZWQgYW5kIHdlIG5lZWQgYSBrZXksIHVzZSB0aGUgZmlyc3QgY29uZmlndXJlZCBwbGFuIG9yIGNyZWF0ZSBhIGRlZmF1bHQgb25lXG4gICAgICAgIGlmICghcGxhbkNvbmZpZyAmJiBjcmVhdGVLZXkpIHtcbiAgICAgICAgICAgIC8vIFRyeSB0byB1c2UgdGhlIGZpcnN0IGNvbmZpZ3VyZWQgcGxhbiB0aGF0IGhhcyBBUEkga2V5c1xuICAgICAgICAgICAgY29uc3QgY29uZmlndXJlZFBsYW4gPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy51c2FnZVBsYW5zPy5maW5kKHBsYW4gPT4gcGxhbi5hcGlLZXlzKTtcbiAgICAgICAgICAgIGlmIChjb25maWd1cmVkUGxhbikge1xuICAgICAgICAgICAgICAgIHBsYW5Db25maWcgPSBjb25maWd1cmVkUGxhbjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gSWYgbm8gY29uZmlndXJlZCBwbGFuIHdpdGgga2V5cyBleGlzdHMsIGNyZWF0ZSBhIGRlZmF1bHQgcGxhblxuICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGEgZGV0ZXJtaW5pc3RpYyBrZXkgYmFzZWQgb24gYXBwIG5hbWUgYW5kIGEgZml4ZWQgaWRlbnRpZmllclxuICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRLZXkgPSBjcmVhdGVIYXNoKCdzaGEyNTYnKVxuICAgICAgICAgICAgICAgICAgICAudXBkYXRlKGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3RoaXMuZncyNC5nZXRDb25maWcoKS5hY2NvdW50fS0ke3RoaXMuZncyNC5nZXRDb25maWcoKS5yZWdpb259LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLmVudmlyb25tZW50fS1kZWZhdWx0LWFwaS1rZXlgKVxuICAgICAgICAgICAgICAgICAgICAuZGlnZXN0KCdoZXgnKVxuICAgICAgICAgICAgICAgICAgICAuc2xpY2UoMCwgMzIpOyAvLyBVc2UgZmlyc3QgMzIgY2hhcnMgZm9yIGEgcmVhc29uYWJsZSBrZXkgbGVuZ3RoXG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBObyB1c2FnZSBwbGFuIHdpdGggQVBJIGtleXMgZm91bmQsIGNyZWF0aW5nIGEgZGVmYXVsdCBvbmUuIFRoaXMgaXMgbm90IHJlY29tbWVuZGVkIGZvciBwcm9kdWN0aW9uIGVudmlyb25tZW50cy4gUGxlYXNlIGNvbmZpZ3VyZSBhIHVzYWdlIHBsYW4gd2l0aCBBUEkga2V5cyBmb3IgeW91ciBBUEkuYCk7XG5cbiAgICAgICAgICAgICAgICBwbGFuQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tZGVmYXVsdC11c2FnZS1wbGFuYCxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGBEZWZhdWx0IHVzYWdlIHBsYW4gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICAgICAgYXBpS2V5czoge1xuICAgICAgICAgICAgICAgICAgICAgICAga2V5czogWyBkZWZhdWx0S2V5IF1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBwbGFuTmFtZSA9IHBsYW5Db25maWc/Lm5hbWUgfHwgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LWRlZmF1bHQtdXNhZ2UtcGxhbmA7XG5cbiAgICAgICAgaWYgKCF0aGlzLnVzYWdlUGxhbnMuaGFzKHBsYW5OYW1lKSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgU2V0dGluZyB1cCB1c2FnZSBwbGFuOiAke3BsYW5OYW1lfWApO1xuICAgICAgICAgICAgY29uc3QgdXNhZ2VQbGFuID0gbmV3IFVzYWdlUGxhbih0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7cGxhbk5hbWV9LXVzYWdlLXBsYW5gLCB7XG4gICAgICAgICAgICAgICAgbmFtZTogcGxhbk5hbWUsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IHBsYW5Db25maWc/LmRlc2NyaXB0aW9uIHx8IGBVc2FnZSBwbGFuIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgYXBpU3RhZ2VzOiBbIHtcbiAgICAgICAgICAgICAgICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgICAgICAgICAgICAgICAgc3RhZ2U6IHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZVxuICAgICAgICAgICAgICAgIH0gXSxcbiAgICAgICAgICAgICAgICB0aHJvdHRsZToge1xuICAgICAgICAgICAgICAgICAgICByYXRlTGltaXQ6IHBsYW5Db25maWc/LnJhdGVMaW1pdCB8fCAxMCxcbiAgICAgICAgICAgICAgICAgICAgYnVyc3RMaW1pdDogcGxhbkNvbmZpZz8uYnVyc3RMaW1pdCB8fCAyMFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcXVvdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgbGltaXQ6IHBsYW5Db25maWc/LnF1b3RhTGltaXQgfHwgMTAwMDAsXG4gICAgICAgICAgICAgICAgICAgIHBlcmlvZDogcGxhbkNvbmZpZz8ucXVvdGFQZXJpb2QgfHwgUGVyaW9kLk1PTlRIXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aGlzLnVzYWdlUGxhbnMuc2V0KHBsYW5OYW1lLCB7IHBsYW46IHVzYWdlUGxhbiwgbmFtZTogcGxhbk5hbWUgfSk7XG4gICAgICAgICAgICB0aGlzLmFwaUtleXMuc2V0KHBsYW5OYW1lLCBbXSk7XG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSBBUEkga2V5cyBpZiBjb25maWd1cmVkIGZvciB0aGlzIHVzYWdlIHBsYW5cbiAgICAgICAgICAgIGlmIChwbGFuQ29uZmlnPy5hcGlLZXlzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQ3JlYXRpbmcgQVBJIGtleXMgZm9yIHVzYWdlIHBsYW46ICR7cGxhbk5hbWV9YCk7XG4gICAgICAgICAgICAgICAgY29uc3Qga2V5cyA9IHBsYW5Db25maWcuYXBpS2V5cy5rZXlzIHx8IFtdO1xuICAgICAgICAgICAgICAgIGtleXMuZm9yRWFjaCgoa2V5LCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvLyBVc2UgdGhlIGtleSBuYW1lIGZyb20gY29uZmlnIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIHVzZSB0aGUgcHJlZml4IG9yIGdlbmVyYXRlIGEgbmFtZVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXlOYW1lID0gdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpS2V5Q29uZmlnPy5rZXlOYW1lIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICAocGxhbkNvbmZpZy5hcGlLZXlzPy5rZXlOYW1lUHJlZml4XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBgJHtwbGFuQ29uZmlnLmFwaUtleXMua2V5TmFtZVByZWZpeH0tJHtpbmRleH1gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tYXBpLWtleS0ke2luZGV4fWApO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIGtleSBhbHJlYWR5IGV4aXN0c1xuICAgICAgICAgICAgICAgICAgICBsZXQgZXhpc3RpbmdLZXkgPSB0aGlzLmtleVZhbHVlcy5nZXQoa2V5KTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFleGlzdGluZ0tleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdLZXkgPSBuZXcgQXBpS2V5KHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtrZXlOYW1lfS1hcGkta2V5YCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGBBUEkga2V5ICR7aW5kZXggKyAxfSBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiBrZXlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtrZXlOYW1lfS1pZGAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZTogZXhpc3RpbmdLZXkua2V5SWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGBBUEkgS2V5ICR7aW5kZXggKyAxfSBJRCBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5rZXlWYWx1ZXMuc2V0KGtleSwgZXhpc3RpbmdLZXkpO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdXNhZ2VQbGFuLmFkZEFwaUtleShleGlzdGluZ0tleSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFwaUtleXNMaXN0ID0gdGhpcy5hcGlLZXlzLmdldChwbGFuTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhcGlLZXlzTGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXBpS2V5c0xpc3QucHVzaChleGlzdGluZ0tleSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHVzYWdlUGxhbiA9IHRoaXMudXNhZ2VQbGFucy5nZXQocGxhbk5hbWUpO1xuICAgICAgICBpZiAoIXVzYWdlUGxhbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVc2FnZSBwbGFuICR7cGxhbk5hbWV9IG5vdCBmb3VuZGApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1c2FnZVBsYW47XG4gICAgfVxuXG59XG4iXX0=