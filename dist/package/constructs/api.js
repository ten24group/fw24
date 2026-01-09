"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIConstruct = void 0;
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const custom_resources_1 = require("aws-cdk-lib/custom-resources");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const fw24_1 = require("../core/fw24");
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const utils_1 = require("../utils");
const lambda_function_1 = require("./lambda-function");
const lambda_integration_1 = require("./lambda-integration");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importStar(require("node:path"));
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
        // Phase 1: Collect all controller descriptors
        const controllerDescriptors = [];
        const collectController = (desc) => {
            controllerDescriptors.push(desc);
        };
        await helper_1.Helper.registerHandlers(controllersDirectory, collectController);
        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("API-gateway stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                this.logger.debug("Load controllers from module base-path: ", basePath);
                helper_1.Helper.registerControllersFromModule(module, collectController);
            }
        }
        else {
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
        }
        else {
            this.logger.debug("API-gateway stack: construct: app has NO system controllers");
        }
    }
    /**
     * Sets up root path resources in the main stack for nested controllers.
     * If enableAutoResourceMigration is true, creates a migration resolver to handle any conflicts.
     */
    setupRootPathResources(descriptors) {
        if (!this.apiConstructConfig.controllerParentStackName) {
            return; // No nested stacks, nothing to do
        }
        // Identify root paths that have MULTIPLE nested controllers
        // Only these need to be in main stack (shared resource)
        // Single-controller paths stay in their nested stack
        const rootPathCounts = new Map();
        for (const desc of descriptors) {
            const { handlerClass, fileName } = desc;
            const folderPath = fileName.split('/').slice(0, -1).join('/');
            const handlerInstance = new handlerClass();
            const controllerName = fileName.includes('/') ? folderPath + '/' + handlerInstance.controllerName : handlerInstance.controllerName;
            const pathParts = controllerName.split('/');
            if (pathParts.length > 1) {
                const rootPath = pathParts[0];
                rootPathCounts.set(rootPath, (rootPathCounts.get(rootPath) || 0) + 1);
            }
        }
        // Filter: only root paths with 2+ controllers need to be in main stack
        const rootPaths = Array.from(rootPathCounts.entries())
            .filter(([_, count]) => count > 1)
            .map(([rootPath, _]) => rootPath);
        if (rootPaths.length === 0) {
            return;
        }
        this.logger.info(`🏗️  Managing ${rootPaths.length} root resource(s) with multiple nested controllers: ${rootPaths.join(', ')}`);
        // Check if automatic resource migration is enabled
        const autoMigrationEnabled = this.apiConstructConfig?.enableAutoResourceMigration === true;
        let migrationResolver;
        if (autoMigrationEnabled) {
            // Create resource migration resolver to handle any conflicts
            // The resolver queries AWS state and only deletes resources if they're in the wrong stack
            // It's idempotent and safe to run on every deployment
            this.logger.info(`🔄 Resource migration enabled - will handle conflicts automatically`);
            migrationResolver = this.createResourceMigrationResolver(rootPaths);
        }
        // Create root resources in main stack
        for (const rootPath of rootPaths) {
            this.logger.info(`🆕 Creating /${rootPath} in main stack as CloudFormation resource...`);
            // Create the resource as an explicit CloudFormation resource
            // This is necessary because this.api is imported, so addResource() doesn't create CFN resources
            const cfnResource = new aws_apigateway_1.CfnResource(this.mainStack, `RootResource-${rootPath}`, {
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
            const rootResource = aws_apigateway_1.Resource.fromResourceAttributes(this.mainStack, `RootResourceWrapper-${rootPath}`, {
                resourceId: cfnResource.ref,
                restApi: this.api,
                path: `/${rootPath}`
            });
            // Don't add CORS preflight here - nested stacks will handle it
            this.logger.info(`   ℹ️  Nested stacks will add CORS preflight methods`);
            // Store resource ID - fw24 will pass this to nested stacks as parameters
            this.fw24.setConstructOutput(this, `restAPI_controller_${rootPath}`, rootResource, construct_1.OutputType.RESOURCE, 'resourceId');
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
    createResourceMigrationResolver(rootPaths) {
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
            mainStackName: aws_cdk_lib_1.Stack.of(this.mainStack).stackName,
            mode: 'migrate'
        };
        const resolverResource = new custom_resources_1.AwsCustomResource(this.mainStack, 'ResourceMigrationResolver', {
            onCreate: {
                service: 'Lambda',
                action: 'invoke',
                parameters: {
                    FunctionName: migrationHandler.functionName,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload)
                },
                physicalResourceId: custom_resources_1.PhysicalResourceId.of(`resource-migration-resolver-${Date.now()}`)
            },
            onUpdate: {
                service: 'Lambda',
                action: 'invoke',
                parameters: {
                    FunctionName: migrationHandler.functionName,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload)
                },
                physicalResourceId: custom_resources_1.PhysicalResourceId.of(`resource-migration-resolver-${Date.now()}`)
            },
            policy: custom_resources_1.AwsCustomResourcePolicy.fromStatements([
                new aws_iam_1.PolicyStatement({
                    actions: ['lambda:InvokeFunction'],
                    resources: [migrationHandler.functionArn]
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
    createMigrationHandlerLambda() {
        const migrationHandler = new aws_lambda_nodejs_1.NodejsFunction(this.mainStack, 'ApiGatewayResourceMigrationHandler', {
            entry: (0, node_path_1.join)(__dirname, 'api-gateway-resource-migration-handler.js'),
            handler: 'handler',
            timeout: aws_cdk_lib_1.Duration.minutes(5),
            bundling: {
                externalModules: [
                    '@aws-sdk/client-api-gateway',
                    '@aws-sdk/client-cloudformation'
                ]
            },
            initialPolicy: [
                new aws_iam_1.PolicyStatement({
                    actions: [
                        'apigateway:GET',
                        'apigateway:DELETE'
                    ],
                    resources: [
                        `arn:aws:apigateway:${aws_cdk_lib_1.Stack.of(this.mainStack).region}::/restapis/${this.api.restApiId}`,
                        `arn:aws:apigateway:${aws_cdk_lib_1.Stack.of(this.mainStack).region}::/restapis/${this.api.restApiId}/*`
                    ]
                }),
                new aws_iam_1.PolicyStatement({
                    actions: [
                        'cloudformation:ListStacks',
                        'cloudformation:DescribeStacks',
                        'cloudformation:DescribeStackResources',
                        'cloudformation:ListStackResources'
                    ],
                    resources: ['*'] // ListStacks requires wildcard resource
                }),
                new aws_iam_1.PolicyStatement({
                    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: ['*']
                })
            ]
        });
        return migrationHandler;
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
        const isNestedController = pathParts.length > 1;
        for (const pathPart of pathParts) {
            let childResource = controllerResource.getResource(pathPart);
            const isRootPath = pathPart === pathParts[0];
            // For nested controllers, root resources should always be imported from main stack
            if (!childResource && isNestedController && isRootPath) {
                // Import the root resource from main stack (passed as parameter to nested stack)
                this.logger.debug(`Importing root resource /${pathPart} from main stack for controller ${controllerName}`);
                const controllerResourceId = this.fw24.getEnvironmentVariable(`restAPI_controller_${pathPart}_resourceId`, 'resource', currentStack);
                if (controllerResourceId) {
                    this.logger.debug(`Found resource ID from main stack parameter: ${controllerResourceId}`);
                    childResource = aws_apigateway_1.Resource.fromResourceAttributes(currentStack, `${this.fw24.appName}-${controllerStackName}-${pathPart}`, {
                        resourceId: controllerResourceId,
                        restApi: restAPI.api,
                        path: '/' + pathPart
                    });
                }
                else {
                    // This should not happen if setupRootPathResources ran correctly
                    this.logger.error(`CRITICAL: Root resource /${pathPart} not found in parameters for nested controller ${controllerName}`);
                    throw new Error(`Root resource /${pathPart} not available for import. This indicates a framework bug.`);
                }
            }
            else if (!childResource) {
                // Create non-root resources normally
                this.logger.debug(`Creating resource ${pathPart} under ${controllerResource.path}`);
                childResource = controllerResource.addResource(pathPart);
                if (restAPI.isImported) {
                    const corsPreflightMethod = childResource.addCorsPreflight(this.getCorsPreflightOptions());
                    this.methods.push(corsPreflightMethod);
                }
                // NOTE: We don't set output for root paths here anymore - that's done in setupRootPathResources
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYXBpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQVNBLCtEQVdvQztBQUVwQyw2Q0FBcUY7QUFDckYsbUVBQThHO0FBRTlHLGlEQUE4RTtBQUU5RSxpREFBNEM7QUFDNUMsaURBQTRDO0FBSzVDLHFFQUFvRjtBQUNwRix1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix3Q0FBMEM7QUFFMUMsb0NBQWlDO0FBQ2pDLHVEQUFtRDtBQUNuRCw2REFBeUQ7QUE0QnpELDZDQUFxRDtBQUNyRCxxQ0FBOEQ7QUFDOUQsdURBQXVDO0FBRXZDLGtDQUFtQztBQUVuQyxvQ0FBNkM7QUFDN0MsaUNBQXVDO0FBQ3ZDLCtDQUFxRDtBQUNyRCx5Q0FBK0M7QUFDL0MsbUNBQXlDO0FBQ3pDLHFDQUEyQztBQUMzQyxtQ0FBeUM7QUFDekMsbUNBQXlDO0FBQ3pDLCtCQUFxQztBQThKckMsTUFBYSxZQUFZO0lBbUJRO0lBbEJwQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN6QyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxZQUFZLENBQUMsSUFBSSxDQUFDO0lBQ2pDLFlBQVksR0FBYSxDQUFFLGtCQUFZLENBQUMsSUFBSSxFQUFFLHdCQUFlLENBQUMsSUFBSSxFQUFFLDRCQUFpQixDQUFDLElBQUksRUFBRSxvQkFBYSxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksQ0FBRSxDQUFDO0lBQ2hMLE1BQU0sQ0FBdUI7SUFFN0IsR0FBRyxDQUFXO0lBQ2QsU0FBUyxDQUFTO0lBQ2xCLFVBQVUsR0FBbUQsSUFB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LENBQUM7Z0JBQ0wsQ0FBQyxDQUFDLENBQUM7WUFDUCxDQUFDO1FBQ0wsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2hELElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNiLE1BQU0sSUFBSSxLQUFLLENBQUMsY0FBYyxRQUFRLFlBQVksQ0FBQyxDQUFDO1FBQ3hELENBQUM7UUFDRCxPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0NBRUo7QUExaENELG9DQTBoQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7XG4gICAgQXV0aG9yaXphdGlvblR5cGUsXG4gICAgQ29yc09wdGlvbnMsXG4gICAgSVJlc291cmNlLFxuICAgIE1ldGhvZCxcbiAgICBNZXRob2RPcHRpb25zLFxuICAgIFJlc3RBcGlQcm9wc1xufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcblxuaW1wb3J0IHtcbiAgICBBd3NJbnRlZ3JhdGlvbixcbiAgICBDZm5SZXNvdXJjZSxcbiAgICBDb3JzLFxuICAgIERlcGxveW1lbnQsXG4gICAgUmVzb3VyY2UsXG4gICAgUmVzcG9uc2VUeXBlLFxuICAgIFJlc3RBcGksXG4gICAgQXBpS2V5LFxuICAgIFBlcmlvZCxcbiAgICBVc2FnZVBsYW5cbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5cbmltcG9ydCB7IENmbk91dHB1dCwgRHVyYXRpb24sIE5lc3RlZFN0YWNrLCBSZW1vdmFsUG9saWN5LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQXdzQ3VzdG9tUmVzb3VyY2UsIEF3c0N1c3RvbVJlc291cmNlUG9saWN5LCBQaHlzaWNhbFJlc291cmNlSWQgfSBmcm9tIFwiYXdzLWNkay1saWIvY3VzdG9tLXJlc291cmNlc1wiO1xuXG5pbXBvcnQgeyBSb2xlLCBTZXJ2aWNlUHJpbmNpcGFsLCBQb2xpY3lTdGF0ZW1lbnQgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgVG9waWMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNuc1wiO1xuaW1wb3J0IHsgUXVldWUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuXG5pbXBvcnQgdHlwZSB7IElGdzI0TW9kdWxlIH0gZnJvbSBcIi4uL2NvcmUvXCI7XG5pbXBvcnQgdHlwZSBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgTXV0YWJsZSBmcm9tIFwiLi4vdHlwZXMvbXV0YWJsZVwiO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBMYW1iZGFJbnRlZ3JhdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1pbnRlZ3JhdGlvblwiO1xuXG5pbnRlcmZhY2UgSUFQSVJlZmVyZW5jZSB7XG4gICAgYXBpOiBSZXN0QXBpO1xuICAgIGlzSW1wb3J0ZWQ6IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBJQXV0aG9yaXplckNvbmZpZyB7XG4gICAgbmFtZT86IHN0cmluZztcbiAgICB0eXBlPzogc3RyaW5nO1xuICAgIGdyb3Vwcz86IHN0cmluZyB8IHN0cmluZ1tdO1xuICAgIHJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc/OiBib29sZWFuO1xuICAgIGRlZmF1bHQ/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgSUNvbnRyb2xsZXJDb25maWdXaXRoQXV0aG9yaXplciBleHRlbmRzIElDb250cm9sbGVyQ29uZmlnIHtcbiAgICByZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnPzogYm9vbGVhbjtcbiAgICBhdXRob3JpemVyPzogc3RyaW5nIHwgSUF1dGhvcml6ZXJDb25maWcgfCBJQXV0aG9yaXplckNvbmZpZ1tdO1xufVxuXG5pbnRlcmZhY2UgSVJvdXRlV2l0aEF1dGhvcml6ZXIge1xuICAgIGh0dHBNZXRob2Q6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgdGFyZ2V0Pzogc3RyaW5nO1xuICAgIHBhcmFtZXRlcnM/OiBzdHJpbmdbXSB8IFN0cmluZ1tdO1xuICAgIGF1dGhvcml6ZXI/OiBzdHJpbmcgfCBJQXV0aG9yaXplckNvbmZpZztcbn1cblxuaW1wb3J0IHsgY3JlYXRlSGFzaCwgcmFuZG9tVVVJRCB9IGZyb20gXCJub2RlOmNyeXB0b1wiO1xuaW1wb3J0IHsgY29weUZpbGVTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCBwYXRoLCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgSUNvbnRyb2xsZXJDb25maWcgfSBmcm9tIFwiLi4vZGVjb3JhdG9ycy9jb250cm9sbGVyXCI7XG5pbXBvcnQgeyBFTlZfS0VZUyB9IGZyb20gXCIuLi9mdzI0XCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgaXNBcnJheSwgaXNTdHJpbmcgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IEF1dGhDb25zdHJ1Y3QgfSBmcm9tIFwiLi9hdXRoXCI7XG5pbXBvcnQgeyBDZXJ0aWZpY2F0ZUNvbnN0cnVjdCB9IGZyb20gXCIuL2NlcnRpZmljYXRlXCI7XG5pbXBvcnQgeyBEeW5hbW9EQkNvbnN0cnVjdCB9IGZyb20gXCIuL2R5bmFtb2RiXCI7XG5pbXBvcnQgeyBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2xheWVyXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IFF1ZXVlQ29uc3RydWN0IH0gZnJvbSBcIi4vcXVldWVcIjtcbmltcG9ydCB7IFRvcGljQ29uc3RydWN0IH0gZnJvbSBcIi4vdG9waWNcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgYW4gQVBJIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQVBJQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBDT1JTIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBUEkuXG4gICAgICogSXQgY2FuIGJlIGEgYm9vbGVhbiB2YWx1ZSwgYSBzaW5nbGUgc3RyaW5nLCBvciBhbiBhcnJheSBvZiBzdHJpbmdzLlxuICAgICAqL1xuICAgIGNvcnM/OiBib29sZWFuIHwgc3RyaW5nIHwgc3RyaW5nW107XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgYWRkaXRpb25hbCBvcHRpb25zIGZvciB0aGUgQVBJLlxuICAgICAqL1xuICAgIGFwaU9wdGlvbnM/OiBSZXN0QXBpUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIGRpcmVjdG9yeSB3aGVyZSB0aGUgY29udHJvbGxlcnMgYXJlIGxvY2F0ZWQuXG4gICAgICovXG4gICAgY29udHJvbGxlcnNEaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgdGhlIHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIGZ1bmN0aW9uLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSBudW1iZXIgb2YgZGF5cyB0byByZXRhaW4gdGhlIEFQSSBsb2dzLlxuICAgICAqL1xuICAgIGxvZ1JldGVudGlvbkRheXM/OiBSZXRlbnRpb25EYXlzO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHRoZSByZW1vdmFsIHBvbGljeSBmb3IgdGhlIEFQSSBsb2dzLlxuICAgICAqL1xuICAgIGxvZ1JlbW92YWxQb2xpY3k/OiBSZW1vdmFsUG9saWN5O1xuXG4gICAgLyoqXG4gICAgICogVGhlIGN1c3RvbSBkb21haW4gbmFtZSBmb3IgdGhlIEFQSS5cbiAgICAgKi9cbiAgICBkb21haW5OYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGNlcnRpZmljYXRlIEFSTiBmb3IgdGhlIGN1c3RvbSBkb21haW4gbmFtZS5cbiAgICAgKi9cbiAgICBjZXJ0aWZpY2F0ZUFybj86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEFQSSBHYXRld2F5IExhbWJkYSBpbnRlZ3JhdGlvbiB0aW1lb3V0IGluIHNlY29uZHMuXG4gICAgICovXG4gICAgaW50ZWdyYXRpb25UaW1lb3V0PzogbnVtYmVyO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHBhcmVudCBzdGFjayBuYW1lIGZvciB0aGUgQ29udHJvbGxlcnMuXG4gICAgICovXG4gICAgY29udHJvbGxlclBhcmVudFN0YWNrTmFtZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFNldCB0byBmYWxzZSBpZiB5b3Ugd2FudCB0byBza2lwIGNyZWF0aW9uIG9mIGNvbnRyb2xsZXJzIHJlc291cmNlcyBhbmQgbWV0aG9kc1xuICAgICAqIFRoaXMgd2lsbCBkZWxldGUgYWxsIHRoZSBjb250cm9sbGVycyByZXNvdXJjZXMgYW5kIG1ldGhvZHMgZnJvbSB0aGUgQVBJXG4gICAgICovXG4gICAgc2tpcENvbnRyb2xsZXJzPzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIEVuYWJsZSBhdXRvbWF0aWMgcmVzb3VyY2UgbWlncmF0aW9uIGZvciBuZXN0ZWQgY29udHJvbGxlciByb290IHJlc291cmNlcy5cbiAgICAgKiBcbiAgICAgKiBXaGVuIGVuYWJsZWQsIGEgbWlncmF0aW9uIHJlc29sdmVyIHJ1bnMgZHVyaW5nIGRlcGxveW1lbnQgdG86XG4gICAgICogMS4gUXVlcnkgQVdTIHRvIGRldGVjdCBpZiByb290IHJlc291cmNlcyBhcmUgaW4gdGhlIHdyb25nIHN0YWNrXG4gICAgICogMi4gRGVsZXRlIGNvbmZsaWN0aW5nIHJlc291cmNlcyAoaWYgYW55KVxuICAgICAqIDMuIEFsbG93IENsb3VkRm9ybWF0aW9uIHRvIHJlY3JlYXRlIHRoZW0gaW4gdGhlIGNvcnJlY3QgbG9jYXRpb25cbiAgICAgKiBcbiAgICAgKiBUaGUgcmVzb2x2ZXIgaXMgaWRlbXBvdGVudCAtIGlmIHJlc291cmNlcyBhcmUgYWxyZWFkeSBjb3JyZWN0LCBpdCBkb2VzIG5vdGhpbmcuXG4gICAgICogXG4gICAgICogV2hlbiBkaXNhYmxlZCAoZGVmYXVsdCksIENsb3VkRm9ybWF0aW9uIHdpbGwgZmFpbCB3aXRoIFwicmVzb3VyY2UgYWxyZWFkeSBleGlzdHNcIiBcbiAgICAgKiBpZiB0aGVyZSdzIGEgY29uZmxpY3QsIGFsbG93aW5nIG1hbnVhbCBpbnRlcnZlbnRpb24uXG4gICAgICogXG4gICAgICogRW5hYmxlIHRoaXMgaWYgeW91J3JlIGFkZGluZyBuZXcgY29udHJvbGxlcnMgdG8gZXhpc3RpbmcgbmVzdGVkIHBhdGhzIGFuZCBcbiAgICAgKiBlbmNvdW50ZXIgcmVzb3VyY2UgY29uZmxpY3QgZXJyb3JzIGR1cmluZyBkZXBsb3ltZW50LlxuICAgICAqIFxuICAgICAqIOKaoO+4jyAgRmlyc3QtdGltZSBtaWdyYXRpb24gbWF5IGNhdXNlIGJyaWVmIEFQSSBkb3dudGltZSAofjMwLTYwcykuXG4gICAgICogXG4gICAgICogQGRlZmF1bHQgZmFsc2VcbiAgICAgKi9cbiAgICBlbmFibGVBdXRvUmVzb3VyY2VNaWdyYXRpb24/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogRm9yY2UgYSBkZXBsb3ltZW50IG9mIHRoZSBBUEkgd2hlbiB1c2luZyBpbXBvcnRlZCBBUElzXG4gICAgICovXG4gICAgZm9yY2VEZXBsb3ltZW50PzogYm9vbGVhbjtcblxuICAgIC8qKlxuICAgICAqIEFQSSBrZXkgY29uZmlndXJhdGlvbiBmb3IgdGhlIEFQSVxuICAgICAqL1xuICAgIGFwaUtleUNvbmZpZz86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIExpc3Qgb2YgdmFsaWQgQVBJIGtleXMuIElmIGVtcHR5LCBrZXlzIHdpbGwgYmUgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICovXG4gICAgICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIE5hbWUgb2YgdGhlIEFQSSBrZXkgKHVzZWQgd2hlbiBhdXRvLWdlbmVyYXRpbmcpXG4gICAgICAgICAqL1xuICAgICAgICBrZXlOYW1lPzogc3RyaW5nO1xuICAgIH07XG5cbiAgICAvKipcbiAgICAgKiBVc2FnZSBwbGFuIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBBUElcbiAgICAgKi9cbiAgICB1c2FnZVBsYW5zPzogSVVzYWdlUGxhbkNvbmZpZ1tdO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIEFQSSBrZXkgd2l0aGluIGEgdXNhZ2UgcGxhblxuICovXG5pbnRlcmZhY2UgSVVzYWdlUGxhbkFwaUtleUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogTGlzdCBvZiB2YWxpZCBBUEkga2V5cy4gSWYgZW1wdHksIGtleXMgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZFxuICAgICAqL1xuICAgIGtleXM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBOYW1lIHByZWZpeCBmb3IgdGhlIEFQSSBrZXlzICh1c2VkIHdoZW4gYXV0by1nZW5lcmF0aW5nKVxuICAgICAqL1xuICAgIGtleU5hbWVQcmVmaXg/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgYSB1c2FnZSBwbGFuXG4gKi9cbmludGVyZmFjZSBJVXNhZ2VQbGFuQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgbmFtZTogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIERlc2NyaXB0aW9uIG9mIHRoZSB1c2FnZSBwbGFuXG4gICAgICovXG4gICAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogUmF0ZSBsaW1pdCBwZXIgc2Vjb25kXG4gICAgICovXG4gICAgcmF0ZUxpbWl0PzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIEJ1cnN0IGxpbWl0XG4gICAgICovXG4gICAgYnVyc3RMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBsaW1pdCBwZXIgcGVyaW9kXG4gICAgICovXG4gICAgcXVvdGFMaW1pdD86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBRdW90YSBwZXJpb2RcbiAgICAgKi9cbiAgICBxdW90YVBlcmlvZD86IFBlcmlvZDtcbiAgICAvKipcbiAgICAgKiBBUEkga2V5IGNvbmZpZ3VyYXRpb24gZm9yIHRoaXMgdXNhZ2UgcGxhblxuICAgICAqL1xuICAgIGFwaUtleXM/OiBJVXNhZ2VQbGFuQXBpS2V5Q29uZmlnO1xufVxuXG5leHBvcnQgY2xhc3MgQVBJQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEFQSUNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gQVBJQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIE1haWxlckNvbnN0cnVjdC5uYW1lLCBEeW5hbW9EQkNvbnN0cnVjdC5uYW1lLCBBdXRoQ29uc3RydWN0Lm5hbWUsIFF1ZXVlQ29uc3RydWN0Lm5hbWUsIFRvcGljQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWUgXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgYXBpITogUmVzdEFwaTtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICB1c2FnZVBsYW5zOiBNYXA8c3RyaW5nLCB7IHBsYW46IFVzYWdlUGxhbjsgbmFtZTogc3RyaW5nIH0+ID0gbmV3IE1hcCgpO1xuICAgIGFwaUtleXM6IE1hcDxzdHJpbmcsIEFwaUtleVtdPiA9IG5ldyBNYXAoKTtcbiAgICBrZXlWYWx1ZXM6IE1hcDxzdHJpbmcsIEFwaUtleT4gPSBuZXcgTWFwKCk7XG5cbiAgICBwcml2YXRlIHJlc291cmNlczogSVJlc291cmNlW10gPSBbXTtcbiAgICBwcml2YXRlIG1ldGhvZHM6IE1ldGhvZFtdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBjb250cm9sbGVyU3RhY2tzID0gbmV3IE1hcDxzdHJpbmcsIHsgbWV0aG9kczogTWV0aG9kW10sIHJlc291cmNlczogSVJlc291cmNlW10sIGNvbnRyb2xsZXJzSGFzaDogc3RyaW5nW10gfT4oKTtcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgYXBpQ29uc3RydWN0Q29uZmlnOiBJQVBJQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIC8vIGh5ZHJhdGUgdGhlIGNvbmZpZyBvYmplY3Qgd2l0aCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZXg6IEFQSUdBVEVXQVlfQ09OVFJPTExFUlNcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoYXBpQ29uc3RydWN0Q29uZmlnLCAnQVBJR0FURVdBWScpO1xuICAgIH1cblxuICAgIC8vIGNvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFja1xuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIHNldCB0aGUgZGVmYXVsdCBhcGkgb3B0aW9uc1xuICAgICAgICBjb25zdCBwYXJhbXNBcGk6IE11dGFibGU8UmVzdEFwaVByb3BzPiA9IHsgLi4udGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuYXBpT3B0aW9ucyB8fCB7fSB9O1xuICAgICAgICAvLyBFbmFibGUgQ09SUyBpZiBkZWZpbmVkXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkVuYWJsaW5nIENPUlMuLi4gdGhpcy5jb25maWcuY29yczogXCIsIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvcnMpO1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9ucyA9IHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuZG9tYWluTmFtZSAmJiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlQ29uc3RydWN0ID0gbmV3IENlcnRpZmljYXRlQ29uc3RydWN0KHtcbiAgICAgICAgICAgICAgICBkb21haW5OYW1lOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5kb21haW5OYW1lLFxuICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlQXJuOiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jZXJ0aWZpY2F0ZUFyblxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlID0gY2VydGlmaWNhdGVDb25zdHJ1Y3Qub3V0cHV0WyBPdXRwdXRUeXBlLkNFUlRJRklDQVRFIF1bIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUgXTtcbiAgICAgICAgICAgIHBhcmFtc0FwaS5kb21haW5OYW1lID0ge1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmRvbWFpbk5hbWUsXG4gICAgICAgICAgICAgICAgY2VydGlmaWNhdGU6IGNlcnRpZmljYXRlLFxuICAgICAgICAgICAgICAgIGJhc2VQYXRoOiBwYXJhbXNBcGkuZGVwbG95T3B0aW9ucz8uc3RhZ2VOYW1lIHx8ICcvJyxcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gZm9yIG11bHRpc3RhY2sgYXBwbGljYXRpb24sIHNldCBkZXBsb3kgdG8gZmFsc2VcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoKSkge1xuICAgICAgICAgICAgcGFyYW1zQXBpLmRlcGxveSA9IGZhbHNlO1xuICAgICAgICAgICAgZGVsZXRlIHBhcmFtc0FwaS5kZXBsb3lPcHRpb25zO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgQVBJIEdhdGV3YXkuLi4gXCIpO1xuICAgICAgICAvLyBnZXQgdGhlIG1haW4gc3RhY2sgZnJvbSB0aGUgZnJhbWV3b3JrXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnN0YWNrTmFtZSwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgZ2F0ZXdheVxuICAgICAgICB0aGlzLmFwaSA9IG5ldyBSZXN0QXBpKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgLi4ucGFyYW1zQXBpLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodGhpcy5hcGlDb25zdHJ1Y3RDb25maWcuY29ycykge1xuICAgICAgICAgICAgY29uc3QgY29yc09yaWdpbnMgPSB0aGlzLmdldENvcnNQcmVmbGlnaHRPcHRpb25zKCkuYWxsb3dPcmlnaW5zPy5qb2luKCcsJyk7XG4gICAgICAgICAgICB0aGlzLmFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ2RlZmF1bHQ0eHgnLCB7XG4gICAgICAgICAgICAgICAgdHlwZTogUmVzcG9uc2VUeXBlLkRFRkFVTFRfNFhYLFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlSGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYCcke2NvcnNPcmlnaW5zfSdgLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5hcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdkZWZhdWx0NXh4Jywge1xuICAgICAgICAgICAgICAgIHR5cGU6IFJlc3BvbnNlVHlwZS5ERUZBVUxUXzVYWCxcbiAgICAgICAgICAgICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGAnJHtjb3JzT3JpZ2luc30nYCxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNldCB1cCB1c2FnZSBwbGFucyBpZiBjb25maWd1cmVkXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy51c2FnZVBsYW5zPy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgcGxhbkNvbmZpZyBvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy51c2FnZVBsYW5zKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXR1cFVzYWdlUGxhbihwbGFuQ29uZmlnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZncyNC5hZGRBUEkodGhpcy5uYW1lLCAncm9vdCcsIHRoaXMuYXBpLCBmYWxzZSk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ3Jlc3RBUEknLCB0aGlzLmFwaSwgT3V0cHV0VHlwZS5BUEksICdyZXN0QXBpSWQnKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCAncmVzdEFQSScsIHRoaXMuYXBpLCBPdXRwdXRUeXBlLkFQSSwgJ3Jlc3RBcGlSb290UmVzb3VyY2VJZCcpO1xuXG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5za2lwQ29udHJvbGxlcnMpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJDb250cm9sbGVycygpO1xuXG4gICAgICAgIC8vIGlmIG11bHRpL25lc3RlZC1zdGFjayBzZXR1cCwgdGhlbiBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2tcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgQVBJLWdhdGV3YXkgY29uc3RydWN0OiAke3RoaXMubmFtZX0gaGFzIGltcG9ydGVkIEFQSXM6ICR7dGhpcy5mdzI0Lmhhc0ltcG9ydGVkQVBJKHRoaXMubmFtZSl9YCk7XG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSAmJiB0aGlzLmZ3MjQudXNlTXVsdGlTdGFja1NldHVwKCkpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlRGVwbG95bWVudHMoKTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmZ3MjQuaGFzSW1wb3J0ZWRBUEkodGhpcy5uYW1lKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVTaW5nbGVEZXBsb3ltZW50KCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldEFQSSA9IChzdGFja05hbWU6IHN0cmluZyk6IElBUElSZWZlcmVuY2UgPT4ge1xuICAgICAgICBsZXQgY3VycmVudEFQSSA9IHRoaXMuZncyNC5nZXRBUEkodGhpcy5uYW1lLCAncm9vdCcpIGFzIElBUElSZWZlcmVuY2UgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gaWYgdGhlIHN0YWNrIGlzIG5vdCB0aGUgbWFpbiBzdGFjayBhbmQgaXRzIGEgbXVsdGktc3RhY2sgYXBwbGljYXRpb24gb3IgYSBuZXN0ZWQgc3RhY2ssIHRoZW4gaW1wb3J0IHRoZSBBUElcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHN0YWNrTmFtZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDdXJyZW50IFN0YWNrOiAke2N1cnJlbnRTdGFjay5zdGFja05hbWV9IGlzIG5lc3RlZCBzdGFjazogJHtjdXJyZW50U3RhY2sgaW5zdGFuY2VvZiBOZXN0ZWRTdGFja31gKTtcbiAgICAgICAgaWYgKHRoaXMuZncyNC51c2VNdWx0aVN0YWNrU2V0dXAoc3RhY2tOYW1lLCB0aGlzLm1haW5TdGFjaykgfHwgY3VycmVudFN0YWNrIGluc3RhbmNlb2YgTmVzdGVkU3RhY2spIHtcbiAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKSBhcyBJQVBJUmVmZXJlbmNlIHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgaWYgKCFjdXJyZW50QVBJKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0ZWRBUEkgPSBSZXN0QXBpLmZyb21SZXN0QXBpQXR0cmlidXRlcyhjdXJyZW50U3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke3N0YWNrTmFtZX0tYXBpYCwge1xuICAgICAgICAgICAgICAgICAgICByZXN0QXBpSWQ6IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdyZXN0QVBJX3Jlc3RBcGlJZCcsICdhcGknLCBjdXJyZW50U3RhY2spLFxuICAgICAgICAgICAgICAgICAgICByb290UmVzb3VyY2VJZDogdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ3Jlc3RBUElfcmVzdEFwaVJvb3RSZXNvdXJjZUlkJywgJ2FwaScsIGN1cnJlbnRTdGFjayksXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhpcy5mdzI0LmFkZEFQSSh0aGlzLm5hbWUsIHN0YWNrTmFtZSwgaW1wb3J0ZWRBUEksIHRydWUpO1xuICAgICAgICAgICAgICAgIGN1cnJlbnRBUEkgPSB0aGlzLmZ3MjQuZ2V0QVBJKHRoaXMubmFtZSwgc3RhY2tOYW1lKSBhcyBJQVBJUmVmZXJlbmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFjdXJyZW50QVBJKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFQSSBub3QgZm91bmQgZm9yIHN0YWNrOiAke3N0YWNrTmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjdXJyZW50QVBJO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVnaXN0ZXJDb250cm9sbGVycygpIHtcbiAgICAgICAgLy8gc2V0cyB0aGUgZGVmYXVsdCBjb250cm9sbGVycyBkaXJlY3RvcnkgaWYgbm90IGRlZmluZWRcbiAgICAgICAgY29uc3QgY29udHJvbGxlcnNEaXJlY3RvcnkgPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb250cm9sbGVyc0RpcmVjdG9yeSB8fCBcIi4vc3JjL2NvbnRyb2xsZXJzXCI7XG5cbiAgICAgICAgLy8gUGhhc2UgMTogQ29sbGVjdCBhbGwgY29udHJvbGxlciBkZXNjcmlwdG9yc1xuICAgICAgICBjb25zdCBjb250cm9sbGVyRGVzY3JpcHRvcnM6IEhhbmRsZXJEZXNjcmlwdG9yW10gPSBbXTtcbiAgICAgICAgY29uc3QgY29sbGVjdENvbnRyb2xsZXIgPSAoZGVzYzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHtcbiAgICAgICAgICAgIGNvbnRyb2xsZXJEZXNjcmlwdG9ycy5wdXNoKGRlc2MpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKGNvbnRyb2xsZXJzRGlyZWN0b3J5LCBjb2xsZWN0Q29udHJvbGxlcik7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIG1vZHVsZXMgXCIsIEFycmF5LmZyb20obW9kdWxlcy5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiTG9hZCBjb250cm9sbGVycyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG4gICAgICAgICAgICAgICAgSGVscGVyLnJlZ2lzdGVyQ29udHJvbGxlcnNGcm9tTW9kdWxlKG1vZHVsZSwgY29sbGVjdENvbnRyb2xsZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBUEktZ2F0ZXdheSBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIE5PIG1vZHVsZXMgXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUGhhc2UgMjogSGFuZGxlIHJvb3QgcmVzb3VyY2UgbWlncmF0aW9uIGZvciBuZXN0ZWQgY29udHJvbGxlcnNcbiAgICAgICAgdGhpcy5zZXR1cFJvb3RQYXRoUmVzb3VyY2VzKGNvbnRyb2xsZXJEZXNjcmlwdG9ycyk7XG5cbiAgICAgICAgLy8gUGhhc2UgMzogUmVnaXN0ZXIgYWxsIGNvbnRyb2xsZXJzXG4gICAgICAgIGZvciAoY29uc3QgZGVzYyBvZiBjb250cm9sbGVyRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJDb250cm9sbGVyKGRlc2MpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVnaXN0ZXIgc3lzdGVtIGNvbnRyb2xsZXJzIGZyb20gZncyNCBzaW5nbGV0b25cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNTeXN0ZW1Db250cm9sbGVycygpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkFQSS1nYXRld2F5IHN0YWNrOiBjb25zdHJ1Y3Q6IHJlZ2lzdGVyaW5nIHN5c3RlbSBjb250cm9sbGVyc1wiKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29weUFuZFJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcnMoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQVBJLWdhdGV3YXkgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBOTyBzeXN0ZW0gY29udHJvbGxlcnNcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXRzIHVwIHJvb3QgcGF0aCByZXNvdXJjZXMgaW4gdGhlIG1haW4gc3RhY2sgZm9yIG5lc3RlZCBjb250cm9sbGVycy5cbiAgICAgKiBJZiBlbmFibGVBdXRvUmVzb3VyY2VNaWdyYXRpb24gaXMgdHJ1ZSwgY3JlYXRlcyBhIG1pZ3JhdGlvbiByZXNvbHZlciB0byBoYW5kbGUgYW55IGNvbmZsaWN0cy5cbiAgICAgKi9cbiAgICBwcml2YXRlIHNldHVwUm9vdFBhdGhSZXNvdXJjZXMoZGVzY3JpcHRvcnM6IEhhbmRsZXJEZXNjcmlwdG9yW10pOiB2b2lkIHtcbiAgICAgICAgaWYgKCF0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb250cm9sbGVyUGFyZW50U3RhY2tOYW1lKSB7XG4gICAgICAgICAgICByZXR1cm47IC8vIE5vIG5lc3RlZCBzdGFja3MsIG5vdGhpbmcgdG8gZG9cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElkZW50aWZ5IHJvb3QgcGF0aHMgdGhhdCBoYXZlIE1VTFRJUExFIG5lc3RlZCBjb250cm9sbGVyc1xuICAgICAgICAvLyBPbmx5IHRoZXNlIG5lZWQgdG8gYmUgaW4gbWFpbiBzdGFjayAoc2hhcmVkIHJlc291cmNlKVxuICAgICAgICAvLyBTaW5nbGUtY29udHJvbGxlciBwYXRocyBzdGF5IGluIHRoZWlyIG5lc3RlZCBzdGFja1xuICAgICAgICBjb25zdCByb290UGF0aENvdW50cyA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgICAgIGZvciAoY29uc3QgZGVzYyBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgY29uc3QgeyBoYW5kbGVyQ2xhc3MsIGZpbGVOYW1lIH0gPSBkZXNjO1xuICAgICAgICAgICAgY29uc3QgZm9sZGVyUGF0aCA9IGZpbGVOYW1lLnNwbGl0KCcvJykuc2xpY2UoMCwgLTEpLmpvaW4oJy8nKTtcbiAgICAgICAgICAgIGNvbnN0IGhhbmRsZXJJbnN0YW5jZSA9IG5ldyBoYW5kbGVyQ2xhc3MoKTtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gZmlsZU5hbWUuaW5jbHVkZXMoJy8nKSA/IGZvbGRlclBhdGggKyAnLycgKyBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWUgOiBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWU7XG4gICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBjb250cm9sbGVyTmFtZS5zcGxpdCgnLycpO1xuICAgICAgICAgICAgaWYgKHBhdGhQYXJ0cy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgcm9vdFBhdGggPSBwYXRoUGFydHNbIDAgXTtcbiAgICAgICAgICAgICAgICByb290UGF0aENvdW50cy5zZXQocm9vdFBhdGgsIChyb290UGF0aENvdW50cy5nZXQocm9vdFBhdGgpIHx8IDApICsgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWx0ZXI6IG9ubHkgcm9vdCBwYXRocyB3aXRoIDIrIGNvbnRyb2xsZXJzIG5lZWQgdG8gYmUgaW4gbWFpbiBzdGFja1xuICAgICAgICBjb25zdCByb290UGF0aHMgPSBBcnJheS5mcm9tKHJvb3RQYXRoQ291bnRzLmVudHJpZXMoKSlcbiAgICAgICAgICAgIC5maWx0ZXIoKFsgXywgY291bnQgXSkgPT4gY291bnQgPiAxKVxuICAgICAgICAgICAgLm1hcCgoWyByb290UGF0aCwgXyBdKSA9PiByb290UGF0aCk7XG5cbiAgICAgICAgaWYgKHJvb3RQYXRocy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfj5fvuI8gIE1hbmFnaW5nICR7cm9vdFBhdGhzLmxlbmd0aH0gcm9vdCByZXNvdXJjZShzKSB3aXRoIG11bHRpcGxlIG5lc3RlZCBjb250cm9sbGVyczogJHtyb290UGF0aHMuam9pbignLCAnKX1gKTtcblxuICAgICAgICAvLyBDaGVjayBpZiBhdXRvbWF0aWMgcmVzb3VyY2UgbWlncmF0aW9uIGlzIGVuYWJsZWRcbiAgICAgICAgY29uc3QgYXV0b01pZ3JhdGlvbkVuYWJsZWQgPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZz8uZW5hYmxlQXV0b1Jlc291cmNlTWlncmF0aW9uID09PSB0cnVlO1xuXG4gICAgICAgIGxldCBtaWdyYXRpb25SZXNvbHZlcjogQXdzQ3VzdG9tUmVzb3VyY2UgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChhdXRvTWlncmF0aW9uRW5hYmxlZCkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIHJlc291cmNlIG1pZ3JhdGlvbiByZXNvbHZlciB0byBoYW5kbGUgYW55IGNvbmZsaWN0c1xuICAgICAgICAgICAgLy8gVGhlIHJlc29sdmVyIHF1ZXJpZXMgQVdTIHN0YXRlIGFuZCBvbmx5IGRlbGV0ZXMgcmVzb3VyY2VzIGlmIHRoZXkncmUgaW4gdGhlIHdyb25nIHN0YWNrXG4gICAgICAgICAgICAvLyBJdCdzIGlkZW1wb3RlbnQgYW5kIHNhZmUgdG8gcnVuIG9uIGV2ZXJ5IGRlcGxveW1lbnRcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCflIQgUmVzb3VyY2UgbWlncmF0aW9uIGVuYWJsZWQgLSB3aWxsIGhhbmRsZSBjb25mbGljdHMgYXV0b21hdGljYWxseWApO1xuICAgICAgICAgICAgbWlncmF0aW9uUmVzb2x2ZXIgPSB0aGlzLmNyZWF0ZVJlc291cmNlTWlncmF0aW9uUmVzb2x2ZXIocm9vdFBhdGhzKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBDcmVhdGUgcm9vdCByZXNvdXJjZXMgaW4gbWFpbiBzdGFja1xuICAgICAgICBmb3IgKGNvbnN0IHJvb3RQYXRoIG9mIHJvb3RQYXRocykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+GlSBDcmVhdGluZyAvJHtyb290UGF0aH0gaW4gbWFpbiBzdGFjayBhcyBDbG91ZEZvcm1hdGlvbiByZXNvdXJjZS4uLmApO1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgdGhlIHJlc291cmNlIGFzIGFuIGV4cGxpY2l0IENsb3VkRm9ybWF0aW9uIHJlc291cmNlXG4gICAgICAgICAgICAvLyBUaGlzIGlzIG5lY2Vzc2FyeSBiZWNhdXNlIHRoaXMuYXBpIGlzIGltcG9ydGVkLCBzbyBhZGRSZXNvdXJjZSgpIGRvZXNuJ3QgY3JlYXRlIENGTiByZXNvdXJjZXNcbiAgICAgICAgICAgIGNvbnN0IGNmblJlc291cmNlID0gbmV3IENmblJlc291cmNlKHRoaXMubWFpblN0YWNrLCBgUm9vdFJlc291cmNlLSR7cm9vdFBhdGh9YCwge1xuICAgICAgICAgICAgICAgIHBhcmVudElkOiB0aGlzLmFwaS5yb290LnJlc291cmNlSWQsXG4gICAgICAgICAgICAgICAgcGF0aFBhcnQ6IHJvb3RQYXRoLFxuICAgICAgICAgICAgICAgIHJlc3RBcGlJZDogdGhpcy5hcGkucmVzdEFwaUlkLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIElmIG1pZ3JhdGlvbiByZXNvbHZlciB3YXMgY3JlYXRlZCwgbWFrZSB0aGlzIHJlc291cmNlIGRlcGVuZCBvbiBpdFxuICAgICAgICAgICAgLy8gVGhpcyBlbnN1cmVzIGFueSBjb25mbGljdGluZyByZXNvdXJjZXMgYXJlIGRlbGV0ZWQgYmVmb3JlIHdlIHRyeSB0byBjcmVhdGUgbmV3IG9uZXNcbiAgICAgICAgICAgIGlmIChtaWdyYXRpb25SZXNvbHZlcikge1xuICAgICAgICAgICAgICAgIGNmblJlc291cmNlLm5vZGUuYWRkRGVwZW5kZW5jeShtaWdyYXRpb25SZXNvbHZlcik7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgICAg8J+UlyBBZGRlZCBkZXBlbmRlbmN5IG9uIG1pZ3JhdGlvbiByZXNvbHZlcmApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBXcmFwIHRoZSBDZm5SZXNvdXJjZSBpbiBhbiBJUmVzb3VyY2UgZm9yIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIGNvbnN0IHJvb3RSZXNvdXJjZSA9IFJlc291cmNlLmZyb21SZXNvdXJjZUF0dHJpYnV0ZXModGhpcy5tYWluU3RhY2ssIGBSb290UmVzb3VyY2VXcmFwcGVyLSR7cm9vdFBhdGh9YCwge1xuICAgICAgICAgICAgICAgIHJlc291cmNlSWQ6IGNmblJlc291cmNlLnJlZixcbiAgICAgICAgICAgICAgICByZXN0QXBpOiB0aGlzLmFwaSxcbiAgICAgICAgICAgICAgICBwYXRoOiBgLyR7cm9vdFBhdGh9YFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIERvbid0IGFkZCBDT1JTIHByZWZsaWdodCBoZXJlIC0gbmVzdGVkIHN0YWNrcyB3aWxsIGhhbmRsZSBpdFxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgICAg4oS577iPICBOZXN0ZWQgc3RhY2tzIHdpbGwgYWRkIENPUlMgcHJlZmxpZ2h0IG1ldGhvZHNgKTtcblxuICAgICAgICAgICAgLy8gU3RvcmUgcmVzb3VyY2UgSUQgLSBmdzI0IHdpbGwgcGFzcyB0aGlzIHRvIG5lc3RlZCBzdGFja3MgYXMgcGFyYW1ldGVyc1xuICAgICAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBgcmVzdEFQSV9jb250cm9sbGVyXyR7cm9vdFBhdGh9YCwgcm9vdFJlc291cmNlLCBPdXRwdXRUeXBlLlJFU09VUkNFLCAncmVzb3VyY2VJZCcpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+SviBTdG9yZWQgLyR7cm9vdFBhdGh9IHJlc291cmNlSWQgZm9yIG5lc3RlZCBzdGFjayBwYXJhbWV0ZXJzYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgcmVzb3VyY2UgbWlncmF0aW9uIHJlc29sdmVyIHRoYXQgaGFuZGxlcyBtaWdyYXRpb24gb2YgQVBJIEdhdGV3YXkgcmVzb3VyY2VzXG4gICAgICogZnJvbSBuZXN0ZWQgc3RhY2tzIHRvIHRoZSBtYWluIHN0YWNrLlxuICAgICAqIFxuICAgICAqIFRoaXMgcmVzb2x2ZXI6XG4gICAgICogMS4gUXVlcmllcyBhY3R1YWwgQVdTIHN0YXRlIChBUEkgR2F0ZXdheSArIENsb3VkRm9ybWF0aW9uKVxuICAgICAqIDIuIERldGVjdHMgd2hpY2ggcmVzb3VyY2VzIGFyZSBpbiB0aGUgd3Jvbmcgc3RhY2sgKG5lc3RlZCB2cyBtYWluKVxuICAgICAqIDMuIFNlbGVjdGl2ZWx5IGRlbGV0ZXMgb25seSBjb25mbGljdGluZyByZXNvdXJjZXMgZnJvbSBBV1NcbiAgICAgKiA0LiBBbGxvd3MgQ2xvdWRGb3JtYXRpb24gdG8gY3JlYXRlIHRoZW0gaW4gdGhlIGNvcnJlY3Qgc3RhY2tcbiAgICAgKiA1LiBJcyBpZGVtcG90ZW50IC0gc2FmZSB0byBydW4gb24gZXZlcnkgZGVwbG95bWVudFxuICAgICAqIFxuICAgICAqIEBwYXJhbSByb290UGF0aHMgLSBBbGwgcm9vdCBwYXRocyB0byBjaGVjayBhbmQgcG90ZW50aWFsbHkgbWlncmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlUmVzb3VyY2VNaWdyYXRpb25SZXNvbHZlcihyb290UGF0aHM6IHN0cmluZ1tdKTogQXdzQ3VzdG9tUmVzb3VyY2Uge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn6e5IENyZWF0aW5nIHJlc291cmNlIG1pZ3JhdGlvbiByZXNvbHZlciBmb3IgJHtyb290UGF0aHMubGVuZ3RofSBwYXRoKHMpLi4uYCk7XG5cbiAgICAgICAgY29uc3QgbWlncmF0aW9uSGFuZGxlciA9IHRoaXMuY3JlYXRlTWlncmF0aW9uSGFuZGxlckxhbWJkYSgpO1xuXG4gICAgICAgIC8vIFRoZSBjdXN0b20gcmVzb3VyY2UgY2FsbHMgdGhlIExhbWJkYSB3aGljaCB3aWxsOlxuICAgICAgICAvLyAxLiBRdWVyeSBBV1MgQVBJIEdhdGV3YXkgdG8gZ2V0IGFjdHVhbCByZXNvdXJjZSBsb2NhdGlvbnNcbiAgICAgICAgLy8gMi4gUXVlcnkgQ2xvdWRGb3JtYXRpb24gdG8gZGV0ZXJtaW5lIHdoaWNoIHN0YWNrIG93bnMgZWFjaCByZXNvdXJjZVxuICAgICAgICAvLyAzLiBJZGVudGlmeSBjb25mbGljdHMgKHJlc291cmNlIGluIG5lc3RlZCBzdGFjayBidXQgbmVlZGVkIGluIG1haW4pXG4gICAgICAgIC8vIDQuIERlbGV0ZSBPTkxZIHRob3NlIHJlc291cmNlcyB0aGF0IGFyZSBhY3R1YWxseSBjb25mbGljdGluZ1xuICAgICAgICAvLyA1LiBSZXR1cm4gZGV0YWlsZWQgaW5mb3JtYXRpb24gYWJvdXQgd2hhdCB3YXMgZG9uZVxuICAgICAgICAvLyBcbiAgICAgICAgLy8gVGhpcyBpcyBJREVNUE9URU5UIC0gaWYgcmVzb3VyY2VzIGFyZSBhbHJlYWR5IGluIHRoZSByaWdodCBwbGFjZSwgaXQgZG9lcyBub3RoaW5nLlxuICAgICAgICAvLyBUaGlzIHJ1bnMgQkVGT1JFIENsb3VkRm9ybWF0aW9uIGNyZWF0ZXMgdGhlIG5ldyByZXNvdXJjZXMgaW4gdGhlIG1haW4gc3RhY2suXG5cbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgICAgICAgIHJlc3RBcGlJZDogdGhpcy5hcGkucmVzdEFwaUlkLFxuICAgICAgICAgICAgcm9vdFBhdGhzOiByb290UGF0aHMsXG4gICAgICAgICAgICBtYWluU3RhY2tOYW1lOiBTdGFjay5vZih0aGlzLm1haW5TdGFjaykuc3RhY2tOYW1lLFxuICAgICAgICAgICAgbW9kZTogJ21pZ3JhdGUnXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzb2x2ZXJSZXNvdXJjZSA9IG5ldyBBd3NDdXN0b21SZXNvdXJjZSh0aGlzLm1haW5TdGFjaywgJ1Jlc291cmNlTWlncmF0aW9uUmVzb2x2ZXInLCB7XG4gICAgICAgICAgICBvbkNyZWF0ZToge1xuICAgICAgICAgICAgICAgIHNlcnZpY2U6ICdMYW1iZGEnLFxuICAgICAgICAgICAgICAgIGFjdGlvbjogJ2ludm9rZScsXG4gICAgICAgICAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICAgICBGdW5jdGlvbk5hbWU6IG1pZ3JhdGlvbkhhbmRsZXIuZnVuY3Rpb25OYW1lLFxuICAgICAgICAgICAgICAgICAgICBJbnZvY2F0aW9uVHlwZTogJ1JlcXVlc3RSZXNwb25zZScsXG4gICAgICAgICAgICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IFBoeXNpY2FsUmVzb3VyY2VJZC5vZihgcmVzb3VyY2UtbWlncmF0aW9uLXJlc29sdmVyLSR7RGF0ZS5ub3coKX1gKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG9uVXBkYXRlOiB7XG4gICAgICAgICAgICAgICAgc2VydmljZTogJ0xhbWJkYScsXG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnaW52b2tlJyxcbiAgICAgICAgICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogbWlncmF0aW9uSGFuZGxlci5mdW5jdGlvbk5hbWUsXG4gICAgICAgICAgICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnUmVxdWVzdFJlc3BvbnNlJyxcbiAgICAgICAgICAgICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZClcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogUGh5c2ljYWxSZXNvdXJjZUlkLm9mKGByZXNvdXJjZS1taWdyYXRpb24tcmVzb2x2ZXItJHtEYXRlLm5vdygpfWApXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcG9saWN5OiBBd3NDdXN0b21SZXNvdXJjZVBvbGljeS5mcm9tU3RhdGVtZW50cyhbXG4gICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsgJ2xhbWJkYTpJbnZva2VGdW5jdGlvbicgXSxcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbIG1pZ3JhdGlvbkhhbmRsZXIuZnVuY3Rpb25Bcm4gXVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICAgIGluc3RhbGxMYXRlc3RBd3NTZGs6IGZhbHNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBSZXNvdXJjZSBtaWdyYXRpb24gcmVzb2x2ZXIgY3JlYXRlZCAtIHdpbGwgcnVuIGJlZm9yZSByZXNvdXJjZSBjcmVhdGlvbmApO1xuICAgICAgICByZXR1cm4gcmVzb2x2ZXJSZXNvdXJjZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgTGFtYmRhIGZ1bmN0aW9uIHRoYXQgaGFuZGxlcyByZXNvdXJjZSBtaWdyYXRpb24uXG4gICAgICogVGhpcyBMYW1iZGE6XG4gICAgICogLSBWZXJpZmllcyBhY3R1YWwgcmVzb3VyY2UgbG9jYXRpb25zIGluIEFXU1xuICAgICAqIC0gRGV0ZWN0cyBjb25mbGljdHMgYW5kIG1pZ3JhdGlvbiBuZWVkc1xuICAgICAqIC0gU2VsZWN0aXZlbHkgZGVsZXRlcyBvbmx5IHByb2JsZW1hdGljIHJlc291cmNlc1xuICAgICAqIC0gUmV0dXJucyBkZXRhaWxlZCByZXNvbHV0aW9uIHJlcG9ydFxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlTWlncmF0aW9uSGFuZGxlckxhbWJkYSgpOiBOb2RlanNGdW5jdGlvbiB7XG4gICAgICAgIGNvbnN0IG1pZ3JhdGlvbkhhbmRsZXIgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssICdBcGlHYXRld2F5UmVzb3VyY2VNaWdyYXRpb25IYW5kbGVyJywge1xuICAgICAgICAgICAgZW50cnk6IGpvaW4oX19kaXJuYW1lLCAnYXBpLWdhdGV3YXktcmVzb3VyY2UtbWlncmF0aW9uLWhhbmRsZXIuanMnKSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICAgICAgICAgICAnQGF3cy1zZGsvY2xpZW50LWFwaS1nYXRld2F5JyxcbiAgICAgICAgICAgICAgICAgICAgJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZGZvcm1hdGlvbidcbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaW5pdGlhbFBvbGljeTogW1xuICAgICAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAnYXBpZ2F0ZXdheTpHRVQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2FwaWdhdGV3YXk6REVMRVRFJ1xuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIGBhcm46YXdzOmFwaWdhdGV3YXk6JHtTdGFjay5vZih0aGlzLm1haW5TdGFjaykucmVnaW9ufTo6L3Jlc3RhcGlzLyR7dGhpcy5hcGkucmVzdEFwaUlkfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBgYXJuOmF3czphcGlnYXRld2F5OiR7U3RhY2sub2YodGhpcy5tYWluU3RhY2spLnJlZ2lvbn06Oi9yZXN0YXBpcy8ke3RoaXMuYXBpLnJlc3RBcGlJZH0vKmBcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246TGlzdFN0YWNrcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246RGVzY3JpYmVTdGFja3MnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkRlc2NyaWJlU3RhY2tSZXNvdXJjZXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkxpc3RTdGFja1Jlc291cmNlcydcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbICcqJyBdICAvLyBMaXN0U3RhY2tzIHJlcXVpcmVzIHdpbGRjYXJkIHJlc291cmNlXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLCAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLCAnbG9nczpQdXRMb2dFdmVudHMnIF0sXG4gICAgICAgICAgICAgICAgICAgIHJlc291cmNlczogWyAnKicgXVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBtaWdyYXRpb25IYW5kbGVyO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgY29weUFuZFJlZ2lzdGVyU3lzdGVtQ29udHJvbGxlcnMoKSB7XG4gICAgICAgIGNvbnN0IHN5c3RlbUNvbnRyb2xsZXJzVGFyZ2V0RGlyID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICdkaXN0JywgJ3N5c3RlbS1jb250cm9sbGVycycpO1xuXG4gICAgICAgIC8vIEVuc3VyZSB0YXJnZXQgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIpKSB7XG4gICAgICAgICAgICBta2RpclN5bmMoc3lzdGVtQ29udHJvbGxlcnNUYXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzeXN0ZW1Db250cm9sbGVyIG9mIHRoaXMuZncyNC5nZXRTeXN0ZW1Db250cm9sbGVycygpKSB7XG4gICAgICAgICAgICBsZXQgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayA9ICcnO1xuICAgICAgICAgICAgLy8gRmFsbGJhY2s6IHVzZSB0aGUgbGFzdCBmZXcgZGlyZWN0b3JpZXMgdG8gcHJlc2VydmUgc3RydWN0dXJlXG4gICAgICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRoLnNwbGl0KCcvJyk7XG4gICAgICAgICAgICBjb25zdCByZWxldmFudFBhcnRzID0gcGF0aFBhcnRzLnNsaWNlKC0zKTsgLy8gZS5nLiwgWydzZWFyY2gnLCAnc3lzdGVtJywgJ3NlYXJjaC1jb250cm9sbGVyLmpzJ11cbiAgICAgICAgICAgIHJlbGF0aXZlUGF0aEZyb21GcmFtZXdvcmsgPSByZWxldmFudFBhcnRzLmpvaW4oJy8nKTtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgU3lzdGVtIGNvbnRyb2xsZXIgcmVsYXRpdmUgcGF0aDogJHtyZWxhdGl2ZVBhdGhGcm9tRnJhbWV3b3JrfWApO1xuXG4gICAgICAgICAgICBjb25zdCB0YXJnZXRGaWxlUGF0aCA9IHBhdGguam9pbihzeXN0ZW1Db250cm9sbGVyc1RhcmdldERpciwgcmVsYXRpdmVQYXRoRnJvbUZyYW1ld29yayk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXREaXJlY3RvcnkgPSBwYXRoLmRpcm5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU3lzdGVtIGNvbnRyb2xsZXIgdGFyZ2V0LWRpcmVjdG9yeTogJHt0YXJnZXREaXJlY3Rvcnl9LCB0YXJnZXRGaWxlUGF0aDogJHt0YXJnZXRGaWxlUGF0aH1gKTtcblxuICAgICAgICAgICAgLy8gRW5zdXJlIHRhcmdldCBzdWJkaXJlY3RvcnkgZXhpc3RzXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmModGFyZ2V0RGlyZWN0b3J5KSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyh0YXJnZXREaXJlY3RvcnksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBDb3B5IHRoZSBzeXN0ZW0gY29udHJvbGxlciBmaWxlXG4gICAgICAgICAgICBjb3B5RmlsZVN5bmMoc3lzdGVtQ29udHJvbGxlci5maWxlUGF0aCwgdGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ29waWVkIHN5c3RlbSBjb250cm9sbGVyIGZyb20gJHtzeXN0ZW1Db250cm9sbGVyLmZpbGVQYXRofSB0byAke3RhcmdldEZpbGVQYXRofWApO1xuXG4gICAgICAgICAgICAvLyBSZWdpc3RlciBmcm9tIHRoZSBjb3BpZWQgbG9jYXRpb25cbiAgICAgICAgICAgIGNvbnN0IGRpcmVjdG9yeSA9IHBhdGguZGlybmFtZSh0YXJnZXRGaWxlUGF0aCk7XG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9IHBhdGguYmFzZW5hbWUodGFyZ2V0RmlsZVBhdGgpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgc3lzdGVtIGNvbnRyb2xsZXI6ICR7ZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKFxuICAgICAgICAgICAgICAgIGRpcmVjdG9yeSxcbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyQ29udHJvbGxlcixcbiAgICAgICAgICAgICAgICBbIGZpbGVOYW1lIF1cbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKTogc3RyaW5nW10ge1xuICAgICAgICBsZXQgZW50cnlQYWNrYWdlcyA9IGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyB8fCBbXTtcblxuICAgICAgICBpZiAoaXNBcnJheShlbnRyeVBhY2thZ2VzKSkge1xuICAgICAgICAgICAgZW50cnlQYWNrYWdlcyA9IHtcbiAgICAgICAgICAgICAgICBvdmVycmlkZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgcGFja2FnZU5hbWVzOiBlbnRyeVBhY2thZ2VzXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiB0aGUgY29udHJvbGxlciBkb2VzIG5vdCB3YW50IHRvIG92ZXJyaWRlIHRoZSBhcHBsaWNhdGlvbi9tb2R1bGUgZW50cnkgcGFja2FnZXMgYW5kIGluY2x1ZGUgdGhlbSBhcyB3ZWxsXG4gICAgICAgIGlmICghZW50cnlQYWNrYWdlcy5vdmVycmlkZSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlRW50cnlQYWNrYWdlcyA9IG93bmVyTW9kdWxlPy5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCkgfHwgW107XG4gICAgICAgICAgICBjb25zdCBhcHBFbnRyeVBhY2thZ2VzID0gdGhpcy5mdzI0LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKTtcbiAgICAgICAgICAgIGVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzID0gW1xuICAgICAgICAgICAgICAgIC4uLmVudHJ5UGFja2FnZXMucGFja2FnZU5hbWVzLFxuICAgICAgICAgICAgICAgIC4uLm1vZHVsZUVudHJ5UGFja2FnZXMsXG4gICAgICAgICAgICAgICAgLi4uYXBwRW50cnlQYWNrYWdlc1xuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbnRyeVBhY2thZ2VzLnBhY2thZ2VOYW1lcy5tYXAodGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSk7XG4gICAgfVxuXG5cbiAgICAvLyByZWdpc3RlciBhIHNpbmdsZSBjb250cm9sbGVyXG4gICAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlckNvbnRyb2xsZXIgPSBhc3luYyAoY29udHJvbGxlckluZm86IEhhbmRsZXJEZXNjcmlwdG9yLCBvd25lck1vZHVsZT86IElGdzI0TW9kdWxlKSA9PiB7XG4gICAgICAgIGNvbnN0IHsgaGFuZGxlckNsYXNzLCBmaWxlUGF0aCwgZmlsZU5hbWUgfSA9IGNvbnRyb2xsZXJJbmZvO1xuICAgICAgICAvLyBBZGQgdGhlIGZvbGRlciBwYXRoIGZyb20gZmlsZW5hbWUgdG8gdGhlIGNvbnRyb2xsZXIgbmFtZVxuICAgICAgICBjb25zdCBmb2xkZXJQYXRoID0gZmlsZU5hbWUuc3BsaXQoJy8nKS5zbGljZSgwLCAtMSkuam9pbignLycpO1xuICAgICAgICBjb25zdCBoYW5kbGVySW5zdGFuY2UgPSBuZXcgaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gZmlsZU5hbWUuaW5jbHVkZXMoJy8nKSA/IGZvbGRlclBhdGggKyAnLycgKyBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWUgOiBoYW5kbGVySW5zdGFuY2UuY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnID0gaGFuZGxlckluc3RhbmNlPy5jb250cm9sbGVyQ29uZmlnIHx8IHt9O1xuICAgICAgICBjb25zdCBjb250cm9sbGVyU3RhY2tOYW1lID0gY29udHJvbGxlckNvbmZpZy5zdGFja05hbWUgfHwgY29udHJvbGxlck5hbWU7XG4gICAgICAgIGNvbnN0IHBhcmVudFN0YWNrTmFtZSA9IGNvbnRyb2xsZXJDb25maWcucGFyZW50U3RhY2tOYW1lIHx8IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmNvbnRyb2xsZXJQYXJlbnRTdGFja05hbWU7XG5cbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBjb250cm9sbGVyIHN0YWNrIGluZm8gaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuY29udHJvbGxlclN0YWNrcy5oYXMoY29udHJvbGxlclN0YWNrTmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMuY29udHJvbGxlclN0YWNrcy5zZXQoY29udHJvbGxlclN0YWNrTmFtZSwge1xuICAgICAgICAgICAgICAgIG1ldGhvZHM6IFtdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW10sXG4gICAgICAgICAgICAgICAgY29udHJvbGxlcnNIYXNoOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGNvbnRyb2xsZXIgc3RhY2sgZXhpc3RzXG4gICAgICAgIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lLCBwYXJlbnRTdGFja05hbWUpO1xuICAgICAgICBjb250cm9sbGVySW5mby5yb3V0ZXMgPSBoYW5kbGVySW5zdGFuY2Uucm91dGVzO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyBjb250cm9sbGVyICR7Y29udHJvbGxlck5hbWV9YCk7XG5cbiAgICAgICAgLy8gcHJlcGFyZSB0aGUgZW50cnkgcGFja2FnZXMgZm9yIHRoZSBjb250cm9sbGVyJ3MgbGFtYmRhIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXMgPSB0aGlzLnByZXBhcmVFbnRyeVBhY2thZ2VzKGNvbnRyb2xsZXJDb25maWcsIG93bmVyTW9kdWxlKTtcbiAgICAgICAgY29udHJvbGxlckNvbmZpZy5lbnRyeVBhY2thZ2VzID0gZW50cnlQYWNrYWdlcztcblxuICAgICAgICB0aGlzLnJlc291cmNlcyA9IFtdO1xuICAgICAgICB0aGlzLm1ldGhvZHMgPSBbXTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBhcGkgcmVzb3VyY2UgZm9yIHRoZSBjb250cm9sbGVyIGlmIGl0IGRvZXNuJ3QgZXhpc3RcbiAgICAgICAgY29uc3QgY29udHJvbGxlclJlc291cmNlID0gdGhpcy5nZXRPckNyZWF0ZUNvbnRyb2xsZXJSZXNvdXJjZShjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclN0YWNrTmFtZSk7XG5cbiAgICAgICAgbGV0IGNvbnRyb2xsZXJUYXJnZXQgPSBjb250cm9sbGVyQ29uZmlnLnRhcmdldDtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJJbnRlZ3JhdGlvbjogTGFtYmRhSW50ZWdyYXRpb24gfCBBd3NJbnRlZ3JhdGlvbiB8IHVuZGVmaW5lZDtcbiAgICAgICAgLy8gY3JlYXRlIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIGNvbnRyb2xsZXJcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJUYXJnZXQgPT09ICdmdW5jdGlvbicgfHwgY29udHJvbGxlclRhcmdldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgPSBjb250cm9sbGVyQ29uZmlnLmxvZ1JldGVudGlvbkRheXMgfHwgdGhpcy5hcGlDb25zdHJ1Y3RDb25maWcubG9nUmV0ZW50aW9uRGF5cztcbiAgICAgICAgICAgIGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSA9IGNvbnRyb2xsZXJDb25maWcubG9nUmVtb3ZhbFBvbGljeSB8fCB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5sb2dSZW1vdmFsUG9saWN5O1xuICAgICAgICAgICAgY29uc3QgY29udHJvbGxlckxhbWJkYSA9IHRoaXMuY3JlYXRlTGFtYmRhRnVuY3Rpb24oY29udHJvbGxlck5hbWUsIGZpbGVQYXRoLCBmaWxlTmFtZSwgY29udHJvbGxlckNvbmZpZywgY29udHJvbGxlclN0YWNrTmFtZSk7XG4gICAgICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyTGFtYmRhLCBPdXRwdXRUeXBlLkZVTkNUSU9OKTtcblxuICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gbmV3IExhbWJkYUludGVncmF0aW9uKGNvbnRyb2xsZXJMYW1iZGEsIHtcbiAgICAgICAgICAgICAgICByZXN0QXBpOiB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGksXG4gICAgICAgICAgICAgICAgcGF0aDogY29udHJvbGxlck5hbWUsXG4gICAgICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5pbnRlZ3JhdGlvblRpbWVvdXQgfHwgMjkpLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IGRlZmF1bHRBdXRob3JpemVyTmFtZSwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLCBkZWZhdWx0QXV0aG9yaXplckdyb3VwcywgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfSA9IHRoaXMuZXh0cmFjdERlZmF1bHRBdXRob3JpemVyKGNvbnRyb2xsZXJDb25maWcpO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlciBDb250cm9sbGVyIH4gRGVmYXVsdCBBdXRob3JpemVyOiBuYW1lOiAke2RlZmF1bHRBdXRob3JpemVyTmFtZX0gLSB0eXBlOiAke2RlZmF1bHRBdXRob3JpemVyVHlwZX0gLSBncm91cHM6ICR7ZGVmYXVsdEF1dGhvcml6ZXJHcm91cHN9YCk7XG5cbiAgICAgICAgLy8gU2V0IHVwIEFQSSBrZXkgaWYgcmVxdWlyZWRcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb25maWcucmVxdWlyZUFwaUtleSkge1xuICAgICAgICAgICAgdGhpcy5zZXR1cFVzYWdlUGxhbih1bmRlZmluZWQsIHRydWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IHVwIHJvdXRlcyBmb3IgdGhlIGNvbnRyb2xsZXJcbiAgICAgICAgZm9yIChjb25zdCByb3V0ZSBvZiBPYmplY3QudmFsdWVzKGNvbnRyb2xsZXJJbmZvLnJvdXRlcyA/PyB7fSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyByb3V0ZSAke3JvdXRlLmh0dHBNZXRob2R9ICR7cm91dGUucGF0aH1gKTtcbiAgICAgICAgICAgIGNvbnN0IHJvdXRlVGFyZ2V0ID0gcm91dGUudGFyZ2V0IHx8IGNvbnRyb2xsZXJUYXJnZXQ7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50UmVzb3VyY2UgPSB0aGlzLmdldE9yQ3JlYXRlUm91dGVSZXNvdXJjZShjb250cm9sbGVyUmVzb3VyY2UsIHJvdXRlLnBhdGgsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgY29uc3QgeyByb3V0ZUF1dGhvcml6ZXJOYW1lLCByb3V0ZUF1dGhvcml6ZXJUeXBlLCByb3V0ZUF1dGhvcml6ZXJHcm91cHMsIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB9ID0gdGhpcy5leHRyYWN0Um91dGVBdXRob3JpemVyKHJvdXRlLCBkZWZhdWx0QXV0aG9yaXplclR5cGUsIGRlZmF1bHRBdXRob3JpemVyTmFtZSwgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMsIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyByb3V0ZSBBdXRob3JpemVyOiAke3JvdXRlQXV0aG9yaXplck5hbWV9IC0gJHtyb3V0ZUF1dGhvcml6ZXJUeXBlfSAtICR7cm91dGVBdXRob3JpemVyR3JvdXBzfWApO1xuXG4gICAgICAgICAgICBsZXQgbWV0aG9kT3B0aW9ucyA9IHRoaXMuY3JlYXRlTWV0aG9kT3B0aW9ucyhyb3V0ZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyTmFtZSwgY29udHJvbGxlckNvbmZpZyk7XG5cbiAgICAgICAgICAgIGlmIChyb3V0ZVRhcmdldCA9PT0gJ3F1ZXVlJykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJvdXRlLnBhdGgucmVwbGFjZSgnLycsICcnKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVySW50ZWdyYXRpb24gPSB0aGlzLmNyZWF0ZVNRU0ludGVncmF0aW9uKHF1ZXVlTmFtZSwgY29udHJvbGxlck5hbWUsIGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLm1ldGhvZE9wdGlvbnMsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAocm91dGVUYXJnZXQgPT09ICd0b3BpYycpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0b3BpY05hbWUgPSByb3V0ZS5wYXRoLnJlcGxhY2UoJy8nLCAnJyk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlckludGVncmF0aW9uID0gdGhpcy5jcmVhdGVTTlNJbnRlZ3JhdGlvbih0b3BpY05hbWUsIGNvbnRyb2xsZXJOYW1lLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgICAgICAgICBtZXRob2RPcHRpb25zID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi5tZXRob2RPcHRpb25zLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjIwMlwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjUwMFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IG1ldGhvZCA9IGN1cnJlbnRSZXNvdXJjZS5hZGRNZXRob2Qocm91dGUuaHR0cE1ldGhvZCwgY29udHJvbGxlckludGVncmF0aW9uLCBtZXRob2RPcHRpb25zKTtcbiAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKG1ldGhvZCk7XG5cbiAgICAgICAgICAgIC8vIGlmIGF1dGhvcml6ZXIgaXMgQVdTX0lBTSwgdGhlbiBhZGQgdGhlIHJvdXRlIHRvIHRoZSBwb2xpY3lcbiAgICAgICAgICAgIGlmIChyb3V0ZUF1dGhvcml6ZXJUeXBlID09PSAnQVdTX0lBTScpIHtcbiAgICAgICAgICAgICAgICBsZXQgZnVsbFJvdXRlUGF0aCA9IGNvbnRyb2xsZXJOYW1lICsgcm91dGUucGF0aDtcblxuICAgICAgICAgICAgICAgIC8vICogcmVwbGFjZSBlYWNoIHBhcmFtIHBsYWNlaG9sZGVyIGB7aWR9YCB3aXRoIGFuIGAqYFxuICAgICAgICAgICAgICAgIHJvdXRlLnBhcmFtZXRlcnM/LmZvckVhY2gocGFyID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZnVsbFJvdXRlUGF0aCA9IGZ1bGxSb3V0ZVBhdGgucmVwbGFjZShgeyR7cGFyfX1gLCAnKicpO1xuICAgICAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgICAgICB0aGlzLmZ3MjQuYWRkUm91dGVUb1JvbGVQb2xpY3koZnVsbFJvdXRlUGF0aCwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8ga2VlcCB0cmFjayBvZiB0aGUgY29udHJvbGxlciBzdGFja3Mgd2l0aCBtZXRob2RzIGFuZCByZXNvdXJjZXMgaW4gYSBtdWx0aS1zdGFjayBzZXR1cCB0byBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2tcbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNJbXBvcnRlZEFQSSh0aGlzLm5hbWUpKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFja0luZm8gPSB0aGlzLmNvbnRyb2xsZXJTdGFja3MuZ2V0KGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICAgICAgaWYgKHN0YWNrSW5mbykge1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5tZXRob2RzID0gWyAuLi50aGlzLm1ldGhvZHMgXTtcbiAgICAgICAgICAgICAgICBzdGFja0luZm8ucmVzb3VyY2VzID0gWyAuLi50aGlzLnJlc291cmNlcyBdO1xuICAgICAgICAgICAgICAgIHN0YWNrSW5mby5jb250cm9sbGVyc0hhc2gucHVzaChjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoSlNPTi5zdHJpbmdpZnkoY29udHJvbGxlckNvbmZpZykpLmRpZ2VzdCgnaGV4JykpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gb3V0cHV0IHRoZSBhcGkgZW5kcG9pbnRcbiAgICAgICAgdGhpcy5vdXRwdXRBcGlFbmRwb2ludChjb250cm9sbGVyTmFtZSwgY29udHJvbGxlclJlc291cmNlLCB0aGlzLmdldFN0YWdlTmFtZSgpLCBjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldFN0YWdlTmFtZSA9ICgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmFwaU9wdGlvbnM/LmRlcGxveU9wdGlvbnM/LnN0YWdlTmFtZSB8fCAncHJvZCc7XG4gICAgfVxuXG4gICAgLy8gaWYgdGhlIEFQSSBpcyBpbXBvcnRlZCwgdGhlbiBjcmVhdGUgb25lIGRlcGxveW1lbnQgcGVyIGNvbnRyb2xsZXIgc3RhY2sgYW5kIGFkZCBtZXRob2QgYW5kIHJlc291cmNlIGFzIGRlcGVuZGVuY3lcbiAgICAvLyBUaGlzIGlzIG5lZWRlZCBiZWNhdXNlIGltcG9ydGVkIEFQSSBkb2VzIG5vdCBwcm9wb2dhdGUgQ09SUyBzZXR0aW5ncyB0byB0aGUgbWV0aG9kc1xuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlRGVwbG95bWVudHMoKSB7XG5cbiAgICAgICAgY29uc3Qgc3RhZ2VOYW1lID0gdGhpcy5nZXRTdGFnZU5hbWUoKTtcbiAgICAgICAgZm9yIChjb25zdCBbIGNvbnRyb2xsZXJTdGFja05hbWUsIHsgbWV0aG9kcywgcmVzb3VyY2VzLCBjb250cm9sbGVyc0hhc2ggfSBdIG9mIHRoaXMuY29udHJvbGxlclN0YWNrcy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIC8vIFRPRE86IGFkZCBiZXR0ZXIgbG9naWMgdG8gZm9yY2UgYSBkZXBsb3ltZW50IHdoZW4gdGhlcmUgaXMgYSBjaGFuZ2UgaW4gZnJhbWV3b3JrIGNvZGVcbiAgICAgICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyc0hhc2gucHVzaChyYW5kb21VVUlEKCkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjb250cm9sbGVySGFzaCA9IGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShKU09OLnN0cmluZ2lmeShjb250cm9sbGVyc0hhc2gpKS5kaWdlc3QoJ2hleCcpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGRlcGxveW1lbnQgZm9yIGNvbnRyb2xsZXIgc3RhY2sgJHtjb250cm9sbGVyU3RhY2tOYW1lfSB3aXRoIGhhc2ggJHtjb250cm9sbGVySGFzaH1gKTtcbiAgICAgICAgICAgIGNvbnN0IGRlcGxveW1lbnQgPSBuZXcgRGVwbG95bWVudCh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGBkZXBsb3ltZW50LSR7Y29udHJvbGxlckhhc2h9YCwge1xuICAgICAgICAgICAgICAgIGFwaTogdGhpcy5nZXRBUEkoY29udHJvbGxlclN0YWNrTmFtZSkuYXBpLFxuICAgICAgICAgICAgICAgIHN0YWdlTmFtZTogc3RhZ2VOYW1lLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgbWV0aG9kIG9mIG1ldGhvZHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIG1ldGhvZCBkZXBlbmRlbmN5ICR7bWV0aG9kLmh0dHBNZXRob2R9ICR7bWV0aG9kLnJlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShtZXRob2QpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGFkZCBkZXBlbmRlY3kgb24gYWxsIHJlc291cmNlcyBmb3IgdGhpcyBjb250cm9sbGVyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBBZGRpbmcgcmVzb3VyY2UgZGVwZW5kZW5jeSAke3Jlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGlmIHRoZSBhcGkgaXMgaW1wb3J0ZWQgYW5kIGl0J3Mgbm90IGEgbXVsdGktc3RhY2sgc2V0dXAsIHRoZW4gY3JlYXRlIGEgc2luZ2xlIGRlcGxveW1lbnQgZm9yIGFsbCBjb250cm9sbGVyc1xuICAgIC8vIFNpbmdsZSBkZXBsb3ltZW50IGlzIG5lZWRlZCB0byBhdm9pZCBzaW11bHRhdGlvbiBkZXBsb3ltZW50IHdoaWNoIGNhdXNlcyBlcnJvciBvbiBBUEkgR2F0ZXdheVxuICAgIHByaXZhdGUgYXN5bmMgY3JlYXRlU2luZ2xlRGVwbG95bWVudCgpIHtcbiAgICAgICAgY29uc3Qgc3RhZ2VOYW1lID0gdGhpcy5nZXRTdGFnZU5hbWUoKTtcbiAgICAgICAgaWYgKHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLmZvcmNlRGVwbG95bWVudCkge1xuICAgICAgICAgICAgdGhpcy5jb250cm9sbGVyU3RhY2tzLmZvckVhY2goYyA9PiBjLmNvbnRyb2xsZXJzSGFzaC5wdXNoKHJhbmRvbVVVSUQoKSkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSB0aGUgbmFtZSBmcm9tIGFsbCB0aGUgY29udHJvbGxlciBoYXNoIHZhbHVlcyBjb21iaW5lZCBhcyBhIHNpbmdsZSBoYXNoIGFuZCBhZGQgZGVwZW5kZW5jeSBvbiBhbGwgdGhlIGNvbnRyb2xsZXJzXG4gICAgICAgIGNvbnN0IGRlcGxveW1lbnROYW1lID0gYGRlcGxveW1lbnQtJHtjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoQXJyYXkuZnJvbSh0aGlzLmNvbnRyb2xsZXJTdGFja3MudmFsdWVzKCkpLm1hcChjID0+IGMuY29udHJvbGxlcnNIYXNoKS5qb2luKCctJykpLmRpZ2VzdCgnaGV4Jyl9YDtcblxuICAgICAgICBjb25zdCBkZXBsb3ltZW50ID0gbmV3IERlcGxveW1lbnQodGhpcy5mdzI0LmdldFN0YWNrKHRoaXMubmFtZSksIGRlcGxveW1lbnROYW1lLCB7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgICAgICAgc3RhZ2VOYW1lOiBzdGFnZU5hbWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZvciAoY29uc3QgWyBfY29udHJvbGxlclN0YWNrTmFtZSwgeyBtZXRob2RzLCByZXNvdXJjZXMgfSBdIG9mIHRoaXMuY29udHJvbGxlclN0YWNrcy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgbWV0aG9kIG9mIG1ldGhvZHMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQWRkaW5nIG1ldGhvZCBkZXBlbmRlbmN5ICR7bWV0aG9kLmh0dHBNZXRob2R9ICR7bWV0aG9kLnJlc291cmNlLnBhdGh9IHRvIGRlcGxveW1lbnRgKTtcbiAgICAgICAgICAgICAgICBkZXBsb3ltZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShtZXRob2QpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFkZGluZyByZXNvdXJjZSBkZXBlbmRlbmN5ICR7cmVzb3VyY2UucGF0aH0gdG8gZGVwbG95bWVudGApO1xuICAgICAgICAgICAgICAgIGRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KHJlc291cmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKTogQ29yc09wdGlvbnMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcbiAgICAgICAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIixcbiAgICAgICAgICAgICAgICBcIlgtQXBpLUtleVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotRGF0ZVwiLFxuICAgICAgICAgICAgICAgIFwiWC1BbXotQ29udGVudC1TaGEyNTZcIixcbiAgICAgICAgICAgICAgICBcIlgtQW16LVNlY3VyaXR5LVRva2VuXCIsXG4gICAgICAgICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFsc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiLFxuICAgICAgICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCIsXG4gICAgICAgICAgICAgICAgXCJJbXBlcnNvbmF0aW5nLVVzZXItU3ViXCIsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWxsb3dNZXRob2RzOiBbIFwiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiIF0sXG4gICAgICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxuICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiB0aGlzLmdldENvcnNPcmlnaW5zKCksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRDb3JzT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmICh0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSB0cnVlKSByZXR1cm4gQ29ycy5BTExfT1JJR0lOUztcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzID09PSBcInN0cmluZ1wiKSByZXR1cm4gWyB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIF07XG4gICAgICAgIHJldHVybiB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5jb3JzIHx8IFtdO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0T3JDcmVhdGVDb250cm9sbGVyUmVzb3VyY2UgPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogSVJlc291cmNlID0+IHtcbiAgICAgICAgbGV0IHJlc3RBUEkgPSB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKTtcbiAgICAgICAgbGV0IGNvbnRyb2xsZXJSZXNvdXJjZTogSVJlc291cmNlID0gcmVzdEFQSS5hcGkucm9vdDtcbiAgICAgICAgY29uc3QgY3VycmVudFN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpO1xuICAgICAgICBjb25zdCBwYXRoUGFydHMgPSBjb250cm9sbGVyTmFtZS5zcGxpdCgnLycpO1xuICAgICAgICBjb25zdCBpc05lc3RlZENvbnRyb2xsZXIgPSBwYXRoUGFydHMubGVuZ3RoID4gMTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhdGhQYXJ0IG9mIHBhdGhQYXJ0cykge1xuICAgICAgICAgICAgbGV0IGNoaWxkUmVzb3VyY2UgPSBjb250cm9sbGVyUmVzb3VyY2UuZ2V0UmVzb3VyY2UocGF0aFBhcnQpIGFzIElSZXNvdXJjZTtcbiAgICAgICAgICAgIGNvbnN0IGlzUm9vdFBhdGggPSBwYXRoUGFydCA9PT0gcGF0aFBhcnRzWyAwIF07XG5cbiAgICAgICAgICAgIC8vIEZvciBuZXN0ZWQgY29udHJvbGxlcnMsIHJvb3QgcmVzb3VyY2VzIHNob3VsZCBhbHdheXMgYmUgaW1wb3J0ZWQgZnJvbSBtYWluIHN0YWNrXG4gICAgICAgICAgICBpZiAoIWNoaWxkUmVzb3VyY2UgJiYgaXNOZXN0ZWRDb250cm9sbGVyICYmIGlzUm9vdFBhdGgpIHtcbiAgICAgICAgICAgICAgICAvLyBJbXBvcnQgdGhlIHJvb3QgcmVzb3VyY2UgZnJvbSBtYWluIHN0YWNrIChwYXNzZWQgYXMgcGFyYW1ldGVyIHRvIG5lc3RlZCBzdGFjaylcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgSW1wb3J0aW5nIHJvb3QgcmVzb3VyY2UgLyR7cGF0aFBhcnR9IGZyb20gbWFpbiBzdGFjayBmb3IgY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfWApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRyb2xsZXJSZXNvdXJjZUlkID0gdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoYHJlc3RBUElfY29udHJvbGxlcl8ke3BhdGhQYXJ0fV9yZXNvdXJjZUlkYCwgJ3Jlc291cmNlJywgY3VycmVudFN0YWNrKTtcblxuICAgICAgICAgICAgICAgIGlmIChjb250cm9sbGVyUmVzb3VyY2VJZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgRm91bmQgcmVzb3VyY2UgSUQgZnJvbSBtYWluIHN0YWNrIHBhcmFtZXRlcjogJHtjb250cm9sbGVyUmVzb3VyY2VJZH1gKTtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IFJlc291cmNlLmZyb21SZXNvdXJjZUF0dHJpYnV0ZXMoY3VycmVudFN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtjb250cm9sbGVyU3RhY2tOYW1lfS0ke3BhdGhQYXJ0fWAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlSWQ6IGNvbnRyb2xsZXJSZXNvdXJjZUlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdEFwaTogcmVzdEFQSS5hcGksXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiAnLycgKyBwYXRoUGFydFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIHNob3VsZCBub3QgaGFwcGVuIGlmIHNldHVwUm9vdFBhdGhSZXNvdXJjZXMgcmFuIGNvcnJlY3RseVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgQ1JJVElDQUw6IFJvb3QgcmVzb3VyY2UgLyR7cGF0aFBhcnR9IG5vdCBmb3VuZCBpbiBwYXJhbWV0ZXJzIGZvciBuZXN0ZWQgY29udHJvbGxlciAke2NvbnRyb2xsZXJOYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJvb3QgcmVzb3VyY2UgLyR7cGF0aFBhcnR9IG5vdCBhdmFpbGFibGUgZm9yIGltcG9ydC4gVGhpcyBpbmRpY2F0ZXMgYSBmcmFtZXdvcmsgYnVnLmApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoIWNoaWxkUmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICAvLyBDcmVhdGUgbm9uLXJvb3QgcmVzb3VyY2VzIG5vcm1hbGx5XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIHJlc291cmNlICR7cGF0aFBhcnR9IHVuZGVyICR7Y29udHJvbGxlclJlc291cmNlLnBhdGh9YCk7XG4gICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IGNvbnRyb2xsZXJSZXNvdXJjZS5hZGRSZXNvdXJjZShwYXRoUGFydCkgYXMgSVJlc291cmNlO1xuXG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIE5PVEU6IFdlIGRvbid0IHNldCBvdXRwdXQgZm9yIHJvb3QgcGF0aHMgaGVyZSBhbnltb3JlIC0gdGhhdCdzIGRvbmUgaW4gc2V0dXBSb290UGF0aFJlc291cmNlc1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb250cm9sbGVyUmVzb3VyY2UgPSBjaGlsZFJlc291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXJSZXNvdXJjZTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZUxhbWJkYUZ1bmN0aW9uID0gKGNvbnRyb2xsZXJOYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGZpbGVOYW1lOiBzdHJpbmcsIGNvbnRyb2xsZXJDb25maWc6IElDb250cm9sbGVyQ29uZmlnLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBOb2RlanNGdW5jdGlvbiA9PiB7XG4gICAgICAgIGNvbnN0IGZ1bmN0aW9uUHJvcHMgPSBtZXJnZShbXG4gICAgICAgICAgICB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzID8/IHt9LFxuICAgICAgICAgICAgY29udHJvbGxlckNvbmZpZz8uZnVuY3Rpb25Qcm9wcyA/PyB7fVxuICAgICAgICBdKSE7XG5cbiAgICAgICAgY29uc3QgZW52VmFyaWFibGVzID0gdGhpcy5mdzI0LnJlc29sdmVFbnZWYXJpYWJsZXMoY29udHJvbGxlckNvbmZpZy5lbnYsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSk7XG5cbiAgICAgICAgLy8gZG8gbm90IG92ZXJyaWRlIHRoZSBlbnRyeSBwYWNrYWdlcyBpZiBhbHJlYWR5IHNldFxuICAgICAgICBpZiAoIShFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyBpbiBlbnZWYXJpYWJsZXMpICYmIGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcykge1xuICAgICAgICAgICAgZW52VmFyaWFibGVzWyBFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyBdID0gKGNvbnRyb2xsZXJDb25maWcuZW50cnlQYWNrYWdlcyBhcyBBcnJheTxzdHJpbmc+KS5qb2luKCcsJyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgY29udHJvbGxlck5hbWUgKyBcIi1jb250cm9sbGVyXCIsIHtcbiAgICAgICAgICAgIGVudHJ5OiBmaWxlUGF0aCArIFwiL1wiICsgZmlsZU5hbWUsXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczogZW52VmFyaWFibGVzLFxuICAgICAgICAgICAgcG9saWNpZXM6IGNvbnRyb2xsZXJDb25maWc/LnBvbGljaWVzLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IGNvbnRyb2xsZXJDb25maWc/LnJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgYWxsb3dTZW5kRW1haWw6IHRydWUsXG4gICAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IGNvbnRyb2xsZXJDb25maWc/LmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgcHJvY2Vzc29yQXJjaGl0ZWN0dXJlOiBjb250cm9sbGVyQ29uZmlnPy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiBmdW5jdGlvblByb3BzLFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogY29udHJvbGxlckNvbmZpZy5sb2dSZXRlbnRpb25EYXlzLFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogY29udHJvbGxlckNvbmZpZy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGV4dHJhY3REZWZhdWx0QXV0aG9yaXplciA9IChjb250cm9sbGVyQ29uZmlnOiBJQ29udHJvbGxlckNvbmZpZ1dpdGhBdXRob3JpemVyKTogeyBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzOiBzdHJpbmdbXSwgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWc6IGJvb2xlYW4gfSA9PiB7XG4gICAgICAgIGxldCBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSB0aGlzLmZ3MjQuZ2V0RGVmYXVsdENvZ25pdG9BdXRob3JpemVyTmFtZSgpO1xuICAgICAgICBsZXQgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNvbnRyb2xsZXJDb25maWc/LmF1dGhvcml6ZXIpKSB7XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0QXV0aG9yaXplciA9IChjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIgYXMgSUF1dGhvcml6ZXJDb25maWdbXSkuZmluZCgoYXV0aCkgPT4gYXV0aC5kZWZhdWx0KSB8fCBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXJbIDAgXTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyTmFtZSA9IGRlZmF1bHRBdXRob3JpemVyLm5hbWUgfHwgZGVmYXVsdEF1dGhvcml6ZXJOYW1lO1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXIuZ3JvdXBzIHx8IFtdO1xuICAgICAgICAgICAgZGVmYXVsdFJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0QXV0aG9yaXplci5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplck5hbWUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplclR5cGUgPSBjb250cm9sbGVyQ29uZmlnLmF1dGhvcml6ZXIudHlwZTtcbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyLmdyb3VwcyB8fCBbXTtcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnID0gY29udHJvbGxlckNvbmZpZy5yZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnIHx8IGRlZmF1bHRSZXF1aXJlUm91dGVJbkdyb3VwQ29uZmlnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gY29udHJvbGxlckNvbmZpZy5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFkZWZhdWx0QXV0aG9yaXplclR5cGUgJiYgdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZSkge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlID0gdGhpcy5mdzI0LmdldENvbmZpZygpLmRlZmF1bHRBdXRob3JpemF0aW9uVHlwZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChkZWZhdWx0QXV0aG9yaXplckdyb3Vwcykge1xuXG4gICAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgZm9yIHRoZSBncm91cHMgaXMgYSB0ZW1wbGF0ZSBzdHJpbmcsIFxuICAgICAgICAgICAgLy8gcmVzb2x2ZSBpdCBbd2hlbiB0aGUgYXBwbGljYXRpb24gd2FudCB0byBhbGxvdyBtdWx0aXBsZSB1c2VyIGdyb3VwcyB0byBoYXZlIGFjY2Vzc11cbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgXCJlbnY6eHh4Omdyb3VwMVwiID09PiBcImdyb3VwMS1yZXNvbHZlZFwiIHx8IFwiZ3JvdXAxLGdyb3VwMlwiIHx8IFwiZW52Onh4eDpncm91cDEsZW52Onh4eDpncm91cDJcIlxuICAgICAgICAgICAgaWYgKGlzU3RyaW5nKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKSkge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gdGhpcy5mdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShkZWZhdWx0QXV0aG9yaXplckdyb3VwcylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIG5vdyBpZiB0aGUgcmVzb2x2ZWQgdmFsdWUgaXMgYWdhaW4gYSBzdHJpbmcsIHNwbGl0IGl0IGJ5IGNvbW1hXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSB2YWx1ZSBpcyBsaWtlIFwiZ3JvdXAxLGdyb3VwMlwiID09PiBbXCJncm91cDFcIiwgXCJncm91cDJcIl1cbiAgICAgICAgICAgIGlmIChpc1N0cmluZyhkZWZhdWx0QXV0aG9yaXplckdyb3VwcykpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzLnNwbGl0KCcsJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMubGVuZ3RoICYmIHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHMpIHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplckdyb3VwcyA9IHRoaXMuZncyNC5nZXRDb25maWcoKS5kZWZhdWx0QWRtaW5Hcm91cHM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHJlc29sdmUgdGhlIGdyb3VwIG5hbWVzIGZyb20gZncyNC1zY29wZSBpZiBpdCdzIGEgdGVtcGxhdGVcbiAgICAgICAgICAgIC8vIHdoZW4gdGhlIHZhbHVlIGlzIGxpa2UgW1wiZW52Onh4eDpncm91cDFcIixcImVudjp4eHg6Z3JvdXAyXCJdID09PiBbXCJncm91cDEtcmVzb2x2ZWRcIiwgXCJncm91cDItcmVzb2x2ZWRcIl1cbiAgICAgICAgICAgIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzID0gKGRlZmF1bHRBdXRob3JpemVyR3JvdXBzIGFzIEFycmF5PHN0cmluZz4pLm1hcCh0aGlzLmZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKTtcblxuICAgICAgICAgICAgLy8gZmxhdC1tYXAgdGhlIGdyb3VwcyBpZiB0aGV5IHJlc29sdmVkIGdyb3VwIHZhbHVlcyBhcmUgYWdhaW4gY29tbWEgc2VwYXJhdGVkXG4gICAgICAgICAgICAvLyB3aGVuIHRoZSByZXNvbHZlZCB2YWx1ZSBpcyBsaWtlIFtcImEsYlwiLCBcImMsZFwiXSA9PT4gW1wiYVwiLCBcImJcIiwgXCJjXCIsIFwiZFwiXVxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgPSBkZWZhdWx0QXV0aG9yaXplckdyb3Vwcy5mbGF0TWFwKGdyb3VwID0+IGdyb3VwLnNwbGl0KCcsJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRW5zdXJlIGRlZmF1bHRBdXRob3JpemVyR3JvdXBzIGlzIGFsd2F5cyBhbiBhcnJheVxuICAgICAgICBjb25zdCBub3JtYWxpemVkR3JvdXBzOiBzdHJpbmdbXSA9ICFkZWZhdWx0QXV0aG9yaXplckdyb3Vwc1xuICAgICAgICAgICAgPyBbXVxuICAgICAgICAgICAgOiBBcnJheS5pc0FycmF5KGRlZmF1bHRBdXRob3JpemVyR3JvdXBzKVxuICAgICAgICAgICAgICAgID8gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHNcbiAgICAgICAgICAgICAgICA6IFsgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHMgXTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJOYW1lLFxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJUeXBlLFxuICAgICAgICAgICAgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IG5vcm1hbGl6ZWRHcm91cHMsXG4gICAgICAgICAgICBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZ1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0T3JDcmVhdGVSb3V0ZVJlc291cmNlID0gKHBhcmVudFJlc291cmNlOiBJUmVzb3VyY2UsIHBhdGg6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogSVJlc291cmNlID0+IHtcbiAgICAgICAgbGV0IGN1cnJlbnRSZXNvdXJjZTogSVJlc291cmNlID0gcGFyZW50UmVzb3VyY2U7XG4gICAgICAgIGNvbnN0IHJlc3RBUEkgPSB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHBhdGhQYXJ0IG9mIHBhdGguc3BsaXQoXCIvXCIpKSB7XG4gICAgICAgICAgICBpZiAocGF0aFBhcnQgPT09IFwiXCIpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbGV0IGNoaWxkUmVzb3VyY2UgPSBjdXJyZW50UmVzb3VyY2UuZ2V0UmVzb3VyY2UocGF0aFBhcnQpO1xuICAgICAgICAgICAgaWYgKCFjaGlsZFJlc291cmNlKSB7XG4gICAgICAgICAgICAgICAgY2hpbGRSZXNvdXJjZSA9IGN1cnJlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZShwYXRoUGFydCk7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3RBUEkuaXNJbXBvcnRlZCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjb3JzUHJlZmxpZ2h0TWV0aG9kID0gY2hpbGRSZXNvdXJjZS5hZGRDb3JzUHJlZmxpZ2h0KHRoaXMuZ2V0Q29yc1ByZWZsaWdodE9wdGlvbnMoKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWV0aG9kcy5wdXNoKGNvcnNQcmVmbGlnaHRNZXRob2QpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc291cmNlcy5wdXNoKGNoaWxkUmVzb3VyY2UpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN1cnJlbnRSZXNvdXJjZSA9IGNoaWxkUmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3VycmVudFJlc291cmNlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFjdFJvdXRlQXV0aG9yaXplciA9IChyb3V0ZTogSVJvdXRlV2l0aEF1dGhvcml6ZXIsIGRlZmF1bHRBdXRob3JpemVyVHlwZTogc3RyaW5nLCBkZWZhdWx0QXV0aG9yaXplck5hbWU6IHN0cmluZywgZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM6IHN0cmluZ1tdLCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbik6IHsgcm91dGVBdXRob3JpemVyTmFtZTogc3RyaW5nLCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplckdyb3Vwczogc3RyaW5nW10sIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZzogYm9vbGVhbiB9ID0+IHtcbiAgICAgICAgbGV0IHJvdXRlQXV0aG9yaXplck5hbWUgPSBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgIGxldCByb3V0ZUF1dGhvcml6ZXJUeXBlID0gZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICBsZXQgcm91dGVBdXRob3JpemVyR3JvdXBzID0gZGVmYXVsdEF1dGhvcml6ZXJHcm91cHM7XG4gICAgICAgIGxldCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgPSBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcblxuICAgICAgICBpZiAocm91dGUuYXV0aG9yaXplciAmJiB0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyLnR5cGUgfHwgZGVmYXVsdEF1dGhvcml6ZXJUeXBlO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyTmFtZSA9IHJvdXRlLmF1dGhvcml6ZXIubmFtZSB8fCBkZWZhdWx0QXV0aG9yaXplck5hbWU7XG4gICAgICAgICAgICBjb25zdCByb3V0ZUdyb3VwcyA9IHJvdXRlLmF1dGhvcml6ZXIuZ3JvdXBzIHx8IGRlZmF1bHRBdXRob3JpemVyR3JvdXBzO1xuICAgICAgICAgICAgcm91dGVBdXRob3JpemVyR3JvdXBzID0gIXJvdXRlR3JvdXBzXG4gICAgICAgICAgICAgICAgPyBbXVxuICAgICAgICAgICAgICAgIDogQXJyYXkuaXNBcnJheShyb3V0ZUdyb3VwcylcbiAgICAgICAgICAgICAgICAgICAgPyByb3V0ZUdyb3Vwc1xuICAgICAgICAgICAgICAgICAgICA6IFsgcm91dGVHcm91cHMgXTtcbiAgICAgICAgICAgIHJvdXRlUmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyA9IHJvdXRlLmF1dGhvcml6ZXIucmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZyB8fCBkZWZhdWx0UmVxdWlyZVJvdXRlSW5Hcm91cENvbmZpZztcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygcm91dGUuYXV0aG9yaXplciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSByb3V0ZS5hdXRob3JpemVyO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHsgcm91dGVBdXRob3JpemVyTmFtZSwgcm91dGVBdXRob3JpemVyVHlwZSwgcm91dGVBdXRob3JpemVyR3JvdXBzLCByb3V0ZVJlcXVpcmVSb3V0ZUluR3JvdXBDb25maWcgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZU1ldGhvZE9wdGlvbnMgPSAocm91dGU6IElSb3V0ZVdpdGhBdXRob3JpemVyLCByb3V0ZUF1dGhvcml6ZXJUeXBlOiBzdHJpbmcsIHJvdXRlQXV0aG9yaXplck5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCwgY29udHJvbGxlckNvbmZpZzogSUNvbnRyb2xsZXJDb25maWcpOiBNZXRob2RPcHRpb25zID0+IHtcbiAgICAgICAgY29uc3QgcmVxdWVzdFBhcmFtZXRlcnM6IHsgWyBrZXk6IHN0cmluZyBdOiBib29sZWFuIH0gPSB7fTtcblxuICAgICAgICAvLyBBZGQgcGF0aCBwYXJhbWV0ZXJzXG4gICAgICAgIGZvciAoY29uc3QgcGFyYW0gb2Ygcm91dGUucGFyYW1ldGVycyB8fCBbXSkge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnNbIGBtZXRob2QucmVxdWVzdC5wYXRoLiR7cGFyYW19YCBdID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBBUEkga2V5IGhlYWRlciByZXF1aXJlbWVudCBpZiBzcGVjaWZpZWRcbiAgICAgICAgaWYgKGNvbnRyb2xsZXJDb25maWcucmVxdWlyZUFwaUtleSkge1xuICAgICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnNbICdtZXRob2QucmVxdWVzdC5oZWFkZXIueC1hcGkta2V5JyBdID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHRoZSBhdXRob3JpemVyIGlzIEpXVCwgY29udmVydCBpdCB0byBDVVNUT01cbiAgICAgICAgY29uc3QgYXV0aG9yaXplciA9IHRoaXMuZncyNC5nZXRBdXRob3JpemVyKHJvdXRlQXV0aG9yaXplclR5cGUsIHJvdXRlQXV0aG9yaXplck5hbWUpO1xuICAgICAgICBpZiAocm91dGVBdXRob3JpemVyVHlwZSA9PT0gJ0pXVCcpIHtcbiAgICAgICAgICAgIHJvdXRlQXV0aG9yaXplclR5cGUgPSAnQ1VTVE9NJztcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVycyxcbiAgICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiByb3V0ZUF1dGhvcml6ZXJUeXBlIGFzIEF1dGhvcml6YXRpb25UeXBlLFxuICAgICAgICAgICAgYXV0aG9yaXplcjogYXV0aG9yaXplcixcbiAgICAgICAgICAgIGFwaUtleVJlcXVpcmVkOiBjb250cm9sbGVyQ29uZmlnLnJlcXVpcmVBcGlLZXkgfHwgZmFsc2VcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZVNRU0ludGVncmF0aW9uID0gKHF1ZXVlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpOiBBd3NJbnRlZ3JhdGlvbiA9PiB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBTUVMgaW50ZWdyYXRpb24gZm9yIHF1ZXVlICR7cXVldWVOYW1lfSBpbiBjb250cm9sbGVyICR7Y29udHJvbGxlck5hbWV9IGluIHN0YWNrICR7Y29udHJvbGxlclN0YWNrTmFtZX1gKTtcbiAgICAgICAgY29uc3QgaW50ZWdyYXRpb25Sb2xlID0gbmV3IFJvbGUodGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLCBgJHtjb250cm9sbGVyTmFtZX0tJHtxdWV1ZU5hbWV9LXNxcy1pbnRlZ3JhdGlvbi1yb2xlYCwge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlQXJuID0gdGhpcy5mdzI0LmdldEFybignc3FzJywgdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUocXVldWVOYW1lICsgJ19xdWV1ZU5hbWUnLCAncXVldWUnLCB0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSkpKTtcbiAgICAgICAgY29uc3QgcXVldWVJbnN0YW5jZSA9IFF1ZXVlLmZyb21RdWV1ZUFybih0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3F1ZXVlTmFtZX0tcXVldWVgLCBxdWV1ZUFybik7XG4gICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRTZW5kTWVzc2FnZXMoaW50ZWdyYXRpb25Sb2xlKTtcbiAgICAgICAgcmV0dXJuIG5ldyBBd3NJbnRlZ3JhdGlvbih7XG4gICAgICAgICAgICBzZXJ2aWNlOiBcInNxc1wiLFxuICAgICAgICAgICAgcGF0aDogdGhpcy5mdzI0LmdldENvbmZpZygpLmFjY291bnQgKyBcIi9cIiArIHF1ZXVlSW5zdGFuY2UucXVldWVOYW1lLFxuICAgICAgICAgICAgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjcmVkZW50aWFsc1JvbGU6IGludGVncmF0aW9uUm9sZSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICAgICBcImludGVncmF0aW9uLnJlcXVlc3QuaGVhZGVyLkNvbnRlbnQtVHlwZVwiOiBcIidhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiYXBwbGljYXRpb24vanNvblwiOiBgQWN0aW9uPVNlbmRNZXNzYWdlJk1lc3NhZ2VCb2R5PSR1dGlsLnVybEVuY29kZSgkaW5wdXQuYm9keSlgLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDJcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI0MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogXCI1MDBcIixcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVTTlNJbnRlZ3JhdGlvbiA9ICh0b3BpY05hbWU6IHN0cmluZywgY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclN0YWNrTmFtZTogc3RyaW5nKTogQXdzSW50ZWdyYXRpb24gPT4ge1xuICAgICAgICBjb25zdCBpbnRlZ3JhdGlvblJvbGUgPSBuZXcgUm9sZSh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGAke2NvbnRyb2xsZXJOYW1lfS0ke3RvcGljTmFtZX0tc25zLWludGVncmF0aW9uLXJvbGVgLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwiYXBpZ2F0ZXdheS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSB0aGlzLmZ3MjQuZ2V0QXJuKCdzbnMnLCB0aGlzLmZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSh0b3BpY05hbWUgKyAnX3RvcGljTmFtZScsICd0b3BpYycsIHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSkpO1xuICAgICAgICBjb25zdCB0b3BpY0luc3RhbmNlID0gVG9waWMuZnJvbVRvcGljQXJuKHRoaXMuZncyNC5nZXRTdGFjayhjb250cm9sbGVyU3RhY2tOYW1lKSwgYCR7Y29udHJvbGxlck5hbWV9LSR7dG9waWNOYW1lfS10b3BpY2AsIHRvcGljQXJuKTtcbiAgICAgICAgdG9waWNJbnN0YW5jZS5ncmFudFB1Ymxpc2goaW50ZWdyYXRpb25Sb2xlKTtcbiAgICAgICAgcmV0dXJuIG5ldyBBd3NJbnRlZ3JhdGlvbih7XG4gICAgICAgICAgICBzZXJ2aWNlOiBcInNuc1wiLFxuICAgICAgICAgICAgcGF0aDogJy8nLFxuICAgICAgICAgICAgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjcmVkZW50aWFsc1JvbGU6IGludGVncmF0aW9uUm9sZSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICAgICBcImludGVncmF0aW9uLnJlcXVlc3QuaGVhZGVyLkNvbnRlbnQtVHlwZVwiOiBcIidhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiYXBwbGljYXRpb24vanNvblwiOiBgQWN0aW9uPVB1Ymxpc2gmVG9waWNBcm49JHV0aWwudXJsRW5jb2RlKCcke3RvcGljSW5zdGFuY2UudG9waWNBcm59JykmTWVzc2FnZT0kdXRpbC51cmxFbmNvZGUoJGlucHV0LmJvZHkpYCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiMjAyXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNDAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1c0NvZGU6IFwiNTAwXCIsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0QXBpRW5kcG9pbnQgPSAoY29udHJvbGxlck5hbWU6IHN0cmluZywgY29udHJvbGxlclJlc291cmNlOiBJUmVzb3VyY2UsIHN0YWdlTmFtZTogc3RyaW5nLCBjb250cm9sbGVyU3RhY2tOYW1lOiBzdHJpbmcpID0+IHtcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLmZ3MjQuZ2V0U3RhY2soY29udHJvbGxlclN0YWNrTmFtZSksIGBFbmRwb2ludCR7Y29udHJvbGxlck5hbWV9YCwge1xuICAgICAgICAgICAgdmFsdWU6ICdodHRwczovLycgKyB0aGlzLmdldEFQSShjb250cm9sbGVyU3RhY2tOYW1lKS5hcGkucmVzdEFwaUlkICsgJy5leGVjdXRlLWFwaS4nICsgdGhpcy5mdzI0LmdldFN0YWNrKGNvbnRyb2xsZXJTdGFja05hbWUpLnJlZ2lvbiArICcuYW1hem9uYXdzLmNvbS8nICsgc3RhZ2VOYW1lICsgJy8nICsgY29udHJvbGxlclJlc291cmNlLnBhdGguc2xpY2UoMSksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBUEkgR2F0ZXdheSBFbmRwb2ludCBmb3IgXCIgKyBjb250cm9sbGVyTmFtZSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzZXR1cFVzYWdlUGxhbihwbGFuQ29uZmlnPzogSVVzYWdlUGxhbkNvbmZpZywgY3JlYXRlS2V5OiBib29sZWFuID0gZmFsc2UpOiB7IHBsYW46IFVzYWdlUGxhbjsgbmFtZTogc3RyaW5nIH0ge1xuICAgICAgICAvLyBJZiBubyBwbGFuIGNvbmZpZyBpcyBwcm92aWRlZCBhbmQgd2UgbmVlZCBhIGtleSwgdXNlIHRoZSBmaXJzdCBjb25maWd1cmVkIHBsYW4gb3IgY3JlYXRlIGEgZGVmYXVsdCBvbmVcbiAgICAgICAgaWYgKCFwbGFuQ29uZmlnICYmIGNyZWF0ZUtleSkge1xuICAgICAgICAgICAgLy8gVHJ5IHRvIHVzZSB0aGUgZmlyc3QgY29uZmlndXJlZCBwbGFuIHRoYXQgaGFzIEFQSSBrZXlzXG4gICAgICAgICAgICBjb25zdCBjb25maWd1cmVkUGxhbiA9IHRoaXMuYXBpQ29uc3RydWN0Q29uZmlnLnVzYWdlUGxhbnM/LmZpbmQocGxhbiA9PiBwbGFuLmFwaUtleXMpO1xuICAgICAgICAgICAgaWYgKGNvbmZpZ3VyZWRQbGFuKSB7XG4gICAgICAgICAgICAgICAgcGxhbkNvbmZpZyA9IGNvbmZpZ3VyZWRQbGFuO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBJZiBubyBjb25maWd1cmVkIHBsYW4gd2l0aCBrZXlzIGV4aXN0cywgY3JlYXRlIGEgZGVmYXVsdCBwbGFuXG4gICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgYSBkZXRlcm1pbmlzdGljIGtleSBiYXNlZCBvbiBhcHAgbmFtZSBhbmQgYSBmaXhlZCBpZGVudGlmaWVyXG4gICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdEtleSA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgICAgICAgICAgICAgICAgIC51cGRhdGUoYCR7dGhpcy5mdzI0LmFwcE5hbWV9LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLmFjY291bnR9LSR7dGhpcy5mdzI0LmdldENvbmZpZygpLnJlZ2lvbn0tJHt0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZW52aXJvbm1lbnR9LWRlZmF1bHQtYXBpLWtleWApXG4gICAgICAgICAgICAgICAgICAgIC5kaWdlc3QoJ2hleCcpXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCAzMik7IC8vIFVzZSBmaXJzdCAzMiBjaGFycyBmb3IgYSByZWFzb25hYmxlIGtleSBsZW5ndGhcblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYE5vIHVzYWdlIHBsYW4gd2l0aCBBUEkga2V5cyBmb3VuZCwgY3JlYXRpbmcgYSBkZWZhdWx0IG9uZS4gVGhpcyBpcyBub3QgcmVjb21tZW5kZWQgZm9yIHByb2R1Y3Rpb24gZW52aXJvbm1lbnRzLiBQbGVhc2UgY29uZmlndXJlIGEgdXNhZ2UgcGxhbiB3aXRoIEFQSSBrZXlzIGZvciB5b3VyIEFQSS5gKTtcblxuICAgICAgICAgICAgICAgIHBsYW5Db25maWcgPSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGAke3RoaXMuZncyNC5hcHBOYW1lfS1kZWZhdWx0LXVzYWdlLXBsYW5gLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYERlZmF1bHQgdXNhZ2UgcGxhbiBmb3IgJHt0aGlzLmZ3MjQuYXBwTmFtZX1gLFxuICAgICAgICAgICAgICAgICAgICBhcGlLZXlzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXlzOiBbIGRlZmF1bHRLZXkgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBsYW5OYW1lID0gcGxhbkNvbmZpZz8ubmFtZSB8fCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tZGVmYXVsdC11c2FnZS1wbGFuYDtcblxuICAgICAgICBpZiAoIXRoaXMudXNhZ2VQbGFucy5oYXMocGxhbk5hbWUpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTZXR0aW5nIHVwIHVzYWdlIHBsYW46ICR7cGxhbk5hbWV9YCk7XG4gICAgICAgICAgICBjb25zdCB1c2FnZVBsYW4gPSBuZXcgVXNhZ2VQbGFuKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZ3MjQuYXBwTmFtZX0tJHtwbGFuTmFtZX0tdXNhZ2UtcGxhbmAsIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBwbGFuTmFtZSxcbiAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogcGxhbkNvbmZpZz8uZGVzY3JpcHRpb24gfHwgYFVzYWdlIHBsYW4gZm9yICR7dGhpcy5mdzI0LmFwcE5hbWV9YCxcbiAgICAgICAgICAgICAgICBhcGlTdGFnZXM6IFsge1xuICAgICAgICAgICAgICAgICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgICAgICAgICAgICAgICBzdGFnZTogdGhpcy5hcGkuZGVwbG95bWVudFN0YWdlXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgICAgIHRocm90dGxlOiB7XG4gICAgICAgICAgICAgICAgICAgIHJhdGVMaW1pdDogcGxhbkNvbmZpZz8ucmF0ZUxpbWl0IHx8IDEwLFxuICAgICAgICAgICAgICAgICAgICBidXJzdExpbWl0OiBwbGFuQ29uZmlnPy5idXJzdExpbWl0IHx8IDIwXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBxdW90YToge1xuICAgICAgICAgICAgICAgICAgICBsaW1pdDogcGxhbkNvbmZpZz8ucXVvdGFMaW1pdCB8fCAxMDAwMCxcbiAgICAgICAgICAgICAgICAgICAgcGVyaW9kOiBwbGFuQ29uZmlnPy5xdW90YVBlcmlvZCB8fCBQZXJpb2QuTU9OVEhcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMudXNhZ2VQbGFucy5zZXQocGxhbk5hbWUsIHsgcGxhbjogdXNhZ2VQbGFuLCBuYW1lOiBwbGFuTmFtZSB9KTtcbiAgICAgICAgICAgIHRoaXMuYXBpS2V5cy5zZXQocGxhbk5hbWUsIFtdKTtcblxuICAgICAgICAgICAgLy8gQ3JlYXRlIEFQSSBrZXlzIGlmIGNvbmZpZ3VyZWQgZm9yIHRoaXMgdXNhZ2UgcGxhblxuICAgICAgICAgICAgaWYgKHBsYW5Db25maWc/LmFwaUtleXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBDcmVhdGluZyBBUEkga2V5cyBmb3IgdXNhZ2UgcGxhbjogJHtwbGFuTmFtZX1gKTtcbiAgICAgICAgICAgICAgICBjb25zdCBrZXlzID0gcGxhbkNvbmZpZy5hcGlLZXlzLmtleXMgfHwgW107XG4gICAgICAgICAgICAgICAga2V5cy5mb3JFYWNoKChrZXksIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSB0aGUga2V5IG5hbWUgZnJvbSBjb25maWcgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgdXNlIHRoZSBwcmVmaXggb3IgZ2VuZXJhdGUgYSBuYW1lXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGtleU5hbWUgPSB0aGlzLmFwaUNvbnN0cnVjdENvbmZpZy5hcGlLZXlDb25maWc/LmtleU5hbWUgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgIChwbGFuQ29uZmlnLmFwaUtleXM/LmtleU5hbWVQcmVmaXhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGAke3BsYW5Db25maWcuYXBpS2V5cy5rZXlOYW1lUHJlZml4fS0ke2luZGV4fWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGAke3RoaXMuZncyNC5hcHBOYW1lfS1hcGkta2V5LSR7aW5kZXh9YCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYga2V5IGFscmVhZHkgZXhpc3RzXG4gICAgICAgICAgICAgICAgICAgIGxldCBleGlzdGluZ0tleSA9IHRoaXMua2V5VmFsdWVzLmdldChrZXkpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWV4aXN0aW5nS2V5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ0tleSA9IG5ldyBBcGlLZXkodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2tleU5hbWV9LWFwaS1rZXlgLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYEFQSSBrZXkgJHtpbmRleCArIDF9IGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGtleVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZncyNC5hcHBOYW1lfS0ke2tleU5hbWV9LWlkYCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiBleGlzdGluZ0tleS5rZXlJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogYEFQSSBLZXkgJHtpbmRleCArIDF9IElEIGZvciAke3RoaXMuZncyNC5hcHBOYW1lfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmtleVZhbHVlcy5zZXQoa2V5LCBleGlzdGluZ0tleSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB1c2FnZVBsYW4uYWRkQXBpS2V5KGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXBpS2V5c0xpc3QgPSB0aGlzLmFwaUtleXMuZ2V0KHBsYW5OYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFwaUtleXNMaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhcGlLZXlzTGlzdC5wdXNoKGV4aXN0aW5nS2V5KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdXNhZ2VQbGFuID0gdGhpcy51c2FnZVBsYW5zLmdldChwbGFuTmFtZSk7XG4gICAgICAgIGlmICghdXNhZ2VQbGFuKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVzYWdlIHBsYW4gJHtwbGFuTmFtZX0gbm90IGZvdW5kYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVzYWdlUGxhbjtcbiAgICB9XG5cbn1cbiJdfQ==